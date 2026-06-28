"""
AIxPM taxonomy hook.

Two jobs:

1. on_config — scans every blog post under docs/posts/, extracts the [L1, L2]
   pair from each frontmatter, and exposes config.extra.aixpm_taxonomy for the
   overridden sidebar template (counts + the L1 -> L2 collapsible groups).
   L1 order is canonical (matches CLAUDE.md). L2 order within each L1 is derived
   from the data, sorted by descending count then alphabetically.

2. on_page_context + on_post_build — emits site/aixpm-index.json, a build
   manifest consumed by the unified search page (docs/javascripts/aixpm-search.js,
   v3 Session 4). One entry per blog post: {url, title, date, l1, l2, tags}.
   `url` is taken from page.url (never hand-built — project rule); it carries the
   dates and L1/L2 that Material's search_index.json lacks. site/ is gitignored,
   so this file never trips the CAPITALIZE pre-flight.

   The accumulator is reset in on_config so `mkdocs serve` rebuilds don't append
   duplicates across reloads (see UPGRADE-PRD-v3.md §4.3).
"""

import json
import re
from pathlib import Path

import yaml

L1_ORDER = [
    "AI-opportunites",
    "AI-limites",
    "AI-prerequis",
    "AI-impacts",
]

# Blog-post URL shape: YYYY/MM/DD/<slug>/ (root-relative, no base prefix).
_POST_URL_RE = re.compile(r"^(\d{4})/(\d{2})/(\d{2})/")

# Mutable build state. `posts` is reset every on_config (i.e. every serve
# rebuild) so the manifest never accumulates stale/duplicate entries. `dirty`
# is captured once in on_startup: under `mkdocs serve --dirty`, on_page_context
# only fires for changed pages, so on_post_build must overlay onto the prior
# manifest instead of overwriting from a partial accumulator.
_STATE = {"posts": [], "dirty": False}


def on_startup(command, dirty, **kwargs):
    _STATE["dirty"] = bool(dirty)


def _parse_frontmatter(text):
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    try:
        return yaml.safe_load(text[3:end])
    except yaml.YAMLError:
        return None


def _slug(name):
    return name.lower()


def on_config(config, **kwargs):
    # Reset the manifest accumulator so serve rebuilds start clean (no dupes).
    _STATE["posts"] = []

    posts_dir = Path(config["docs_dir"]) / "posts"
    if not posts_dir.exists():
        return config

    l1_count = {l1: 0 for l1 in L1_ORDER}
    l2_count = {l1: {} for l1 in L1_ORDER}
    total = 0
    pm_count = 0

    for post_file in sorted(posts_dir.glob("*.md")):
        fm = _parse_frontmatter(post_file.read_text(encoding="utf-8"))
        if not fm:
            continue
        tags = fm.get("tags") or []
        if isinstance(tags, list) and "project-management" in tags:
            pm_count += 1
        cats = fm.get("categories") or []
        if not isinstance(cats, list) or not cats:
            continue
        l1 = cats[0]
        if l1 not in l1_count:
            continue
        l1_count[l1] += 1
        total += 1
        if len(cats) > 1 and cats[1]:
            l2 = cats[1]
            l2_count[l1][l2] = l2_count[l1].get(l2, 0) + 1

    l1_payload = {}
    for l1 in L1_ORDER:
        l2_list = sorted(
            (
                {"label": name, "slug": _slug(name), "count": count}
                for name, count in l2_count[l1].items()
            ),
            key=lambda x: (-x["count"], x["label"]),
        )
        l1_payload[l1] = {
            "label": l1,
            "slug": _slug(l1),
            "count": l1_count[l1],
            "l2": l2_list,
        }

    config["extra"] = dict(config.get("extra") or {})
    config["extra"]["aixpm_taxonomy"] = {
        "total": total,
        "pm_count": pm_count,
        "l1_order": L1_ORDER,
        "l1": l1_payload,
    }
    return config


def _norm_list(value):
    """Return a clean list[str] from a frontmatter value (list or scalar)."""
    if isinstance(value, list):
        return [str(v) for v in value if v is not None and str(v).strip()]
    if value is None or str(value).strip() == "":
        return []
    return [str(value)]


def on_page_context(context, page, config, nav, **kwargs):
    """Collect one manifest entry per blog post.

    Fires per rendered page. We keep only blog posts (URL = YYYY/MM/DD/slug/);
    category/archive/synthèses/chrome pages are skipped. The search page joins
    this manifest to Material's search_index.json on the canonical article key,
    so it needs exactly what the index lacks: date + L1/L2 + curated tags.
    """
    url = getattr(page, "url", "") or ""
    m = _POST_URL_RE.match(url)
    if not m:
        return

    meta = getattr(page, "meta", None) or {}
    cats = _norm_list(meta.get("categories"))
    l1 = cats[0] if len(cats) >= 1 else None
    l2 = cats[1] if len(cats) >= 2 else None
    tags = _norm_list(meta.get("tags"))

    title = (getattr(page, "title", None) or meta.get("title") or "").strip()
    date = "{0}-{1}-{2}".format(m.group(1), m.group(2), m.group(3))  # from the URL, not meta

    _STATE["posts"].append(
        {
            "url": url,            # root-relative, no base prefix — joins to search_index location
            "title": title,
            "date": date,
            "l1": l1,
            "l2": l2,
            "tags": tags,
        }
    )


def on_post_build(config, **kwargs):
    """Write the accumulated manifest to site/aixpm-index.json (UTF-8)."""
    out_path = Path(config["site_dir"]) / "aixpm-index.json"
    posts = list(_STATE["posts"])

    # Under `mkdocs serve --dirty`, on_page_context fired only for changed pages,
    # so _STATE holds a partial set. Overlay onto the previously-written manifest
    # so unchanged posts keep their entries (a clean build overwrites fully).
    if _STATE.get("dirty") and out_path.exists():
        try:
            prev = json.loads(out_path.read_text(encoding="utf-8")).get("posts", [])
        except (ValueError, OSError):
            prev = []
        merged = {e["url"]: e for e in prev if isinstance(e, dict) and e.get("url")}
        for e in posts:
            merged[e["url"]] = e          # this rebuild's fresh entry wins
        posts = list(merged.values())

    # Dedupe by URL (keep first); sort newest first for stable diffs.
    seen = set()
    deduped = []
    for entry in posts:
        if entry["url"] in seen:
            continue
        seen.add(entry["url"])
        deduped.append(entry)
    deduped.sort(key=lambda e: (e["date"], e["url"]), reverse=True)

    out_path.write_text(
        json.dumps({"posts": deduped}, ensure_ascii=False),
        encoding="utf-8",
    )
