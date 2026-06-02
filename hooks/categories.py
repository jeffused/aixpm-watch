"""
AIxPM taxonomy hook.

Scans every blog post under docs/posts/, extracts the [L1, L2] pair from each
frontmatter, and exposes config.extra.aixpm_taxonomy for the overridden
sidebar template to render counts and the L1 -> L2 collapsible groups.

L1 order is canonical (matches CLAUDE.md). L2 order within each L1 is derived
from the data, sorted by descending count then alphabetically.
"""

from pathlib import Path

import yaml

L1_ORDER = [
    "AI-opportunites",
    "AI-limites",
    "AI-prerequis",
    "AI-impacts",
]


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
