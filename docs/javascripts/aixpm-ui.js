/* AIxPM personal layer — UI (Sessions 1-2 scope).
   Replaces the old aixpm.js. Renders on top of window.AIxPMStore.

   Session 1:
   - « Lu » button kept verbatim (manual, never auto-set by rating).
   - « Favori » replaced by a 5-star rating widget on cards + article pages.
   - /favorites/ interim: lists rated articles from the store + sync panel.
   - Nav count fed from the store (rated-article count).

   Session 2:
   - Article personal panel: note box (autosave + flush, URLs auto-linkified)
     and personal-tag chips with a native datalist.
   - Archive: button on article pages + icon button on cards, archived banner,
     « Afficher les articles archivés » toggle + « (n masqués) » count.
   - Card indicators: ✎ when a note exists.

   XSS discipline (binding): personal data (note, tags, title, status) only ever
   reaches the DOM via textContent / createTextNode — never innerHTML.

   Re-runs on every Material soft-nav via the document$ observable. */

(function () {
  'use strict';

  if (!window.AIxPMStore) { return; }            // store must load first
  var S = window.AIxPMStore;

  var KEY_HIDE_READ = 'aixpm:hideRead';
  var KEY_SHOW_ARCHIVED = 'aixpm:showArchived';
  var activeNoteFlush = null;   // flush fn of the article note editor currently on screen

  function loadJSON(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  // ---------- ARIA live region (shared) ----------
  // Inserted EMPTY at page-ready so it is registered in the a11y tree before any
  // interaction — a region created + populated in the same tick drops its first
  // announcement in NVDA/VoiceOver.
  var liveRegion = null;
  function ensureLiveRegion() {
    if (liveRegion && document.body && document.body.contains(liveRegion)) return;
    liveRegion = document.createElement('div');
    liveRegion.className = 'aixpm-sr-only';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    if (document.body) document.body.appendChild(liveRegion);
  }
  function announce(msg) {
    ensureLiveRegion();
    if (liveRegion) liveRegion.textContent = msg;
  }

  // ---------- Heading title extraction (strips permalink ¶) ----------
  function headingTitle(el) {
    if (!el) return '';
    var clone = el.cloneNode(true);
    clone.querySelectorAll('.headerlink').forEach(function (n) { n.remove(); });
    return clone.textContent.trim();
  }

  // ---------- Per-post info (list views) ----------
  function postInfo(article) {
    var link = article.querySelector('.md-post__content > h2 > a.toclink, .md-post__content > h1 > a.toclink, .md-post__content h2 a.toclink, .md-post__content h1 a.toclink');
    if (!link) return null;
    var href = link.getAttribute('href');
    if (!href) return null;
    return { url: S.canon(href), title: link.textContent.trim() };
  }

  // ---------- « Lu » button (unchanged behavior) ----------
  function makeReadBtn(pressed, label) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aixpm-btn aixpm-btn--read';
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.textContent = label;
    return btn;
  }

  // ---------- 5-star rating widget ----------
  function paintStars(group, n) {
    group.querySelectorAll('.aixpm-star').forEach(function (b) {
      var on = Number(b.dataset.val) <= n;
      b.textContent = on ? '★' : '☆';                 // ★ / ☆
      b.classList.toggle('aixpm-star--on', on);
    });
  }
  function makeStars(url, title) {
    var group = document.createElement('span');
    group.className = 'aixpm-stars';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Ma note sur 5');
    function current() { return S.get(url).rating; }
    for (var i = 1; i <= 5; i++) {
      (function (val) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'aixpm-star';
        b.dataset.val = String(val);
        b.setAttribute('aria-label', 'Noter ' + val + ' sur 5');
        b.textContent = '☆';
        b.addEventListener('click', function () {
          var cur = current();
          var next = (cur === val) ? 0 : val;                   // tap current rating → clear
          S.touchMeta(url, title);
          S.setRating(url, next);
          paintStars(group, next);
          announce(next === 0 ? 'Note effacée' : 'Noté ' + next + ' sur 5');
        });
        b.addEventListener('mouseenter', function () { paintStars(group, val); });
        group.appendChild(b);
      })(i);
    }
    group.addEventListener('mouseleave', function () { paintStars(group, current()); });
    paintStars(group, current());
    return group;
  }

  // ---------- Attach to a post card ----------
  function attachToPostCard(article) {
    if (article.dataset.aixpmInit === '1') return;
    var info = postInfo(article);
    if (!info) return;
    article.dataset.aixpmInit = '1';
    article.dataset.aixpmUrl = info.url;

    var state = S.get(info.url);
    if (state.read) article.setAttribute('data-aixpm-read', 'true');
    if (state.archived) article.setAttribute('data-aixpm-archived', 'true');

    var readBtn = makeReadBtn(state.read, 'Lu');
    readBtn.addEventListener('click', function () {
      var now = !S.get(info.url).read;
      S.touchMeta(info.url, info.title);
      S.setRead(info.url, now);
      readBtn.setAttribute('aria-pressed', now ? 'true' : 'false');
      if (now) article.setAttribute('data-aixpm-read', 'true');
      else article.removeAttribute('data-aixpm-read');
    });

    var stars = makeStars(info.url, info.title);
    var archiveBtn = makeCardArchiveBtn(info.url, article);
    var noteFlag = makeNoteIndicator(state.note);

    var wrap = document.createElement('span');
    wrap.className = 'aixpm-actions';
    wrap.appendChild(readBtn);
    wrap.appendChild(stars);
    wrap.appendChild(archiveBtn);
    if (noteFlag) wrap.appendChild(noteFlag);

    var metaList = article.querySelector('.md-post__meta .md-meta__list');
    if (metaList) {
      var li = document.createElement('li');
      li.className = 'md-meta__item aixpm-actions__item';
      li.appendChild(wrap);
      metaList.appendChild(li);
    } else {
      var content = article.querySelector('.md-post__content');
      if (content) content.insertBefore(wrap, content.firstChild);
    }
  }

  // Small ✎ indicator shown on cards when a note exists (read-only here).
  function makeNoteIndicator(note) {
    if (!note) return null;
    var span = document.createElement('span');
    span.className = 'aixpm-note-flag';
    span.textContent = '✎';                                // ✎
    span.title = 'Note personnelle';
    span.setAttribute('aria-label', 'Note personnelle');
    return span;
  }

  // ---------- Note rendering — auto-linkify URLs (DOM-built, never innerHTML) ----------
  // Split into plain-text / link segments. Pure + testable.
  var URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g;
  function splitLinkify(text) {
    var segs = [], last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
      if (m.index > last) segs.push({ t: 'text', v: text.slice(last, m.index) });
      segs.push({ t: 'link', v: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) segs.push({ t: 'text', v: text.slice(last) });
    return segs;
  }
  function buildLinkified(text) {
    var frag = document.createDocumentFragment();
    splitLinkify(text || '').forEach(function (s) {
      if (s.t === 'link') {
        var a = document.createElement('a');
        a.href = s.v;                       // only https?:// matched → safe scheme
        a.textContent = s.v;                // textContent, not innerHTML
        a.target = '_blank';
        a.rel = 'noopener nofollow';
        frag.appendChild(a);
      } else {
        frag.appendChild(document.createTextNode(s.v));
      }
    });
    return frag;
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

  // ---------- Note panel (article pages only) ----------
  // Self-managing editor: debounced autosave (1.5s) + immediate flush on blur,
  // on tab-hide (via store pre-flush), and at the top of every onPageReady
  // (covers Material instant-nav away mid-typing). Saving empty deletes the note.
  function buildNotePanel(url) {
    var box = document.createElement('div');
    box.className = 'aixpm-note';
    var label = document.createElement('span');
    label.className = 'aixpm-note__label';
    label.textContent = 'Ma note';                 // §4.2 canonical string (mirrors « Mes tags »)
    var inner = document.createElement('div');
    inner.className = 'aixpm-note__body';
    box.appendChild(label);
    box.appendChild(inner);
    var statusEl = document.createElement('span');
    statusEl.className = 'aixpm-note__status';
    var saveTimer = null;
    var pending = null;                      // text awaiting save, or null when clean

    function doSave(text) {
      pending = null;
      S.setNote(url, text);
      statusEl.textContent = 'Enregistré ✓';
    }
    function schedule(text) {
      pending = text;
      statusEl.textContent = 'Enregistrement…';
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { saveTimer = null; doSave(text); }, 1500);
    }
    function flush() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (pending !== null) doSave(pending);
    }

    function renderView() {
      flush();                                // never lose an in-progress edit on rerender
      inner.textContent = '';
      box.classList.remove('aixpm-note--editing');
      var note = S.get(url).note;
      if (note) {
        var content = document.createElement('div');
        content.className = 'aixpm-note__content';
        content.appendChild(buildLinkified(note));
        var edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'aixpm-btn aixpm-note__edit';
        edit.textContent = 'Modifier';
        edit.addEventListener('click', function () { renderEdit(note); });
        inner.appendChild(content);
        inner.appendChild(edit);
      } else {
        var add = document.createElement('button');
        add.type = 'button';
        add.className = 'aixpm-btn aixpm-note__add';
        add.textContent = '+ Ajouter une note';
        add.addEventListener('click', function () { renderEdit(''); });
        inner.appendChild(add);
      }
    }
    function renderEdit(initial) {
      inner.textContent = '';
      box.classList.add('aixpm-note--editing');
      var ta = document.createElement('textarea');
      ta.className = 'aixpm-note__input';
      ta.value = initial;
      ta.placeholder = 'Vos notes personnelles sur cet article…';
      ta.setAttribute('aria-label', 'Vos notes personnelles sur cet article');
      ta.addEventListener('input', function () { autoGrow(ta); schedule(ta.value); });
      ta.addEventListener('blur', function () { flush(); });
      var done = document.createElement('button');
      done.type = 'button';
      done.className = 'aixpm-btn';
      done.textContent = 'Terminer';
      done.addEventListener('click', function () { flush(); renderView(); });
      var row = document.createElement('div');
      row.className = 'aixpm-note__editrow';
      row.appendChild(done);
      row.appendChild(statusEl);
      inner.appendChild(ta);
      inner.appendChild(row);
      autoGrow(ta);
      ta.focus();
    }

    activeNoteFlush = flush;                   // registered for tab-hide / nav flush
    renderView();
    return { el: box, flush: flush, isEditing: function () { return box.classList.contains('aixpm-note--editing'); } };
  }

  // ---------- Personal tags (article pages) ----------
  function ensureTagDatalist() {
    var dl = document.getElementById('aixpm-tag-vocab');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'aixpm-tag-vocab'; document.body.appendChild(dl); }
    dl.textContent = '';
    S.customTagVocabulary().forEach(function (t) {
      var o = document.createElement('option');
      o.value = t;                            // DOM property, not HTML — safe
      dl.appendChild(o);
    });
  }
  function buildTagsPanel(url) {
    var wrap = document.createElement('div');
    wrap.className = 'aixpm-tags';

    function commit(input, raw) {
      var val = (raw || '').replace(/,\s*$/, '').replace(/\s+/g, ' ').trim();
      if (!val) return;
      var cur = S.get(url).tags.slice();
      cur.push(val);
      S.setTags(url, cur);                    // store normalizes + dedupes
      render();
      var ni = wrap.querySelector('.aixpm-tag__input');
      if (ni) ni.focus();
    }
    function render() {
      wrap.textContent = '';
      var label = document.createElement('span');
      label.className = 'aixpm-tags__label';
      label.textContent = 'Mes tags';
      wrap.appendChild(label);

      S.get(url).tags.forEach(function (t) {
        var chip = document.createElement('span');
        chip.className = 'aixpm-tag';
        var txt = document.createElement('span');
        txt.textContent = t;                  // textContent — no innerHTML
        chip.appendChild(txt);
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'aixpm-tag__rm';
        rm.textContent = '×';
        rm.setAttribute('aria-label', 'Retirer le tag ' + t);
        rm.addEventListener('click', function () {
          var next = S.get(url).tags.filter(function (x) { return x !== t; });
          S.setTags(url, next);
          render();
        });
        chip.appendChild(rm);
        wrap.appendChild(chip);
      });

      var input = document.createElement('input');
      input.className = 'aixpm-tag__input';
      input.setAttribute('list', 'aixpm-tag-vocab');
      input.setAttribute('aria-label', 'Ajouter un tag');
      input.placeholder = 'Ajouter un tag…';
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(input, input.value); }
      });
      input.addEventListener('blur', function () { if (input.value.trim()) commit(input, input.value); });
      wrap.appendChild(input);
      ensureTagDatalist();
    }
    render();
    return { el: wrap, rerender: render };
  }

  // ---------- Archive controls ----------
  function makeArchiveBtn(url, onChange) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aixpm-btn aixpm-btn--archive';
    function paint() {
      var arch = S.get(url).archived;
      btn.setAttribute('aria-pressed', arch ? 'true' : 'false');
      btn.textContent = arch ? 'Désarchiver' : 'Archiver';
    }
    btn.addEventListener('click', function () {
      S.setArchived(url, !S.get(url).archived);
      paint();
      if (onChange) onChange();
    });
    paint();
    return btn;
  }
  function makeCardArchiveBtn(url, article) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aixpm-btn aixpm-btn--archive-icon';
    btn.textContent = '⤓';                                  // ⤓
    function paint() {
      var arch = S.get(url).archived;
      btn.setAttribute('aria-pressed', arch ? 'true' : 'false');
      btn.setAttribute('aria-label', arch ? 'Désarchiver' : 'Archiver');
      btn.title = arch ? 'Désarchiver' : 'Archiver';
    }
    btn.addEventListener('click', function () {
      var now = !S.get(url).archived;
      S.setArchived(url, now);
      paint();
      if (now) article.setAttribute('data-aixpm-archived', 'true');
      else article.removeAttribute('data-aixpm-archived');
      updateMaskedCount();
    });
    paint();
    return btn;
  }
  function renderArchivedBanner(url, content) {
    var existing = content.querySelector('.aixpm-archived-banner');
    var arch = S.get(url).archived;
    if (arch && !existing) {
      var banner = document.createElement('div');
      banner.className = 'aixpm-archived-banner';
      var span = document.createElement('span');
      span.textContent = 'Article archivé';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'aixpm-btn';
      btn.textContent = 'Désarchiver';
      btn.addEventListener('click', function () {
        S.setArchived(url, false);
        banner.remove();
      });
      banner.appendChild(span);
      banner.appendChild(btn);
      content.insertBefore(banner, content.firstChild);
    } else if (!arch && existing) {
      existing.remove();
    }
  }

  // ---------- Attach to a single article page ----------
  function attachToArticlePage() {
    if (!/\/\d{4}\/\d{2}\/\d{2}\//.test(location.pathname)) return;
    var content = document.querySelector('.md-content');
    if (!content) return;
    if (content.dataset.aixpmArticleInit === '1') return;
    content.dataset.aixpmArticleInit = '1';

    var url = S.canon(location.pathname);
    var h1 = content.querySelector('h1');
    var title = headingTitle(h1) || document.title;

    var state = S.get(url);
    var readBtn = makeReadBtn(state.read, state.read ? 'Marquer comme non lu' : 'Marquer comme lu');
    readBtn.addEventListener('click', function () {
      var now = !S.get(url).read;
      S.touchMeta(url, title);
      S.setRead(url, now);
      readBtn.setAttribute('aria-pressed', now ? 'true' : 'false');
      readBtn.textContent = now ? 'Marquer comme non lu' : 'Marquer comme lu';
    });

    var stars = makeStars(url, title);
    var archiveBtn = makeArchiveBtn(url, function () { renderArchivedBanner(url, content); });

    var wrap = document.createElement('div');
    wrap.className = 'aixpm-actions aixpm-actions--article';
    wrap.appendChild(readBtn);
    wrap.appendChild(stars);
    wrap.appendChild(archiveBtn);

    if (h1 && h1.parentNode) h1.parentNode.insertBefore(wrap, h1.nextSibling);
    else content.insertBefore(wrap, content.firstChild);

    // Personal panel: note editor + personal tags (capture meta so they display elsewhere)
    S.touchMeta(url, title);
    var notePanel = buildNotePanel(url);
    var tagsPanel = buildTagsPanel(url);
    var panel = document.createElement('div');
    panel.className = 'aixpm-panel';
    panel.appendChild(notePanel.el);
    panel.appendChild(tagsPanel.el);
    wrap.parentNode.insertBefore(panel, wrap.nextSibling);

    renderArchivedBanner(url, content);
  }

  // ---------- List toolbar: hide-read + show-archived + masked count ----------
  function applyHideRead(on) { document.body.classList.toggle('aixpm-hide-read', !!on); }
  function applyShowArchived(on) { document.body.classList.toggle('aixpm-show-archived', !!on); }

  function updateMaskedCount() {
    var count = document.querySelector('.aixpm-toolbar__count');
    if (!count) return;
    var hideRead = document.body.classList.contains('aixpm-hide-read');
    var showArch = document.body.classList.contains('aixpm-show-archived');
    var n = 0;
    document.querySelectorAll('.md-post--excerpt[data-aixpm-url]').forEach(function (article) {
      var st = S.get(article.dataset.aixpmUrl);
      if ((hideRead && st.read) || (!showArch && st.archived)) n++;
    });
    count.textContent = n > 0 ? '(' + n + ' masqués)' : '';
  }

  function attachListToolbar() {
    if (!document.querySelector('.md-post--excerpt')) return;
    var host = document.querySelector('.md-content article') || document.querySelector('.md-content');
    if (!host) return;
    if (host.querySelector('.aixpm-toolbar')) return;

    var toolbar = document.createElement('div');
    toolbar.className = 'aixpm-toolbar';

    var l1 = document.createElement('label');
    var cb1 = document.createElement('input');
    cb1.type = 'checkbox';
    cb1.checked = !!loadJSON(KEY_HIDE_READ, false);
    l1.appendChild(cb1);
    l1.appendChild(document.createTextNode(' Masquer les articles lus'));

    var l2 = document.createElement('label');
    var cb2 = document.createElement('input');
    cb2.type = 'checkbox';
    cb2.checked = !!loadJSON(KEY_SHOW_ARCHIVED, false);
    l2.appendChild(cb2);
    l2.appendChild(document.createTextNode(' Afficher les articles archivés'));

    var count = document.createElement('span');
    count.className = 'aixpm-toolbar__count';

    toolbar.appendChild(l1);
    toolbar.appendChild(l2);
    toolbar.appendChild(count);

    applyHideRead(cb1.checked);
    applyShowArchived(cb2.checked);

    cb1.addEventListener('change', function () {
      saveJSON(KEY_HIDE_READ, cb1.checked);
      applyHideRead(cb1.checked);
      updateMaskedCount();
    });
    cb2.addEventListener('change', function () {
      saveJSON(KEY_SHOW_ARCHIVED, cb2.checked);
      applyShowArchived(cb2.checked);
      updateMaskedCount();
    });

    var h1 = host.querySelector('h1');
    if (h1 && h1.parentNode) h1.parentNode.insertBefore(toolbar, h1.nextSibling);
    else host.insertBefore(toolbar, host.firstChild);

    updateMaskedCount();
  }

  // ---------- /favorites/ interim — rated articles list ----------
  function isFavoritesPage() { return /\/favorites\/?$/.test(location.pathname); }

  function renderFavoritesPage() {
    if (!isFavoritesPage()) return;
    var host = document.querySelector('.md-content article') || document.querySelector('.md-content');
    if (!host) return;

    host.querySelectorAll('.aixpm-favorites-list, .aixpm-favorites-empty').forEach(function (n) { n.remove(); });

    var entries = S.allArticles().filter(function (a) { return a.rating >= 1 && !a.archived; })
      .sort(function (a, b) {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return (b.date || '').localeCompare(a.date || '');
      });

    if (entries.length === 0) {
      var p = document.createElement('p');
      p.className = 'aixpm-favorites-empty';
      p.textContent = 'Aucun article noté pour le moment. Attribuez des étoiles à un article pour le retrouver ici.';
      host.appendChild(p);
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'aixpm-favorites-list';
    entries.forEach(function (e) {
      var li = document.createElement('li');

      var a = document.createElement('a');
      a.href = (e.url || '').replace(/^\//, '/aixpm-watch/');    // back to a navigable URL
      a.textContent = e.title || e.url;

      var stars = makeStars(e.url, e.title);

      var meta = document.createElement('span');
      meta.className = 'aixpm-fav-meta';
      if (e.date) {
        var parts = e.date.split('-');
        meta.textContent = parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : e.date;
      }
      if (e.note) {
        var flag = makeNoteIndicator(e.note);
        if (flag) meta.appendChild(flag);
      }

      li.appendChild(a);
      li.appendChild(stars);
      li.appendChild(meta);
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  // ---------- Nav count ----------
  function updateNavCount() {
    var nodes = document.querySelectorAll('[data-aixpm-fav-count]');
    if (!nodes.length) return;
    var n = S.counts().rated;
    nodes.forEach(function (el) { el.textContent = '(' + n + ')'; });
  }

  // ---------- Sync panel (/favorites/) ----------
  function attachSyncPanel() {
    if (!isFavoritesPage()) return;
    var host = document.querySelector('.md-content article') || document.querySelector('.md-content');
    if (!host) return;
    var prior = host.querySelector('.aixpm-sync');
    if (prior) prior.remove();

    var hasToken = S.hasToken();
    var panel = document.createElement('div');
    panel.className = 'aixpm-sync';

    var statusEl = document.createElement('div');
    statusEl.className = 'aixpm-sync__status';
    var st = S.getStatus();
    statusEl.textContent = st.msg;
    if (st.state === 'error' || st.state === 'suspended') statusEl.classList.add('aixpm-sync__status--err');

    var row = document.createElement('div');
    row.className = 'aixpm-sync__row';

    if (hasToken) {
      var off = document.createElement('button');
      off.type = 'button';
      off.className = 'aixpm-btn';
      off.textContent = 'Déconnecter cet appareil';
      off.addEventListener('click', function () { S.disconnect(); attachSyncPanel(); });
      row.appendChild(off);
    } else {
      var help = document.createElement('a');
      help.className = 'aixpm-sync__help';
      help.href = 'https://github.com/settings/tokens/new?scopes=gist&description=AIxPM%20personal%20data%20sync';
      help.target = '_blank';
      help.rel = 'noopener';
      help.textContent = 'Créer un token (scope « gist »)';
      panel.appendChild(help);

      var input = document.createElement('input');
      input.type = 'password';
      input.className = 'aixpm-sync__input';
      input.placeholder = 'Collez votre token GitHub (scope gist)';
      input.setAttribute('aria-label', 'Token GitHub (scope « gist »)');
      input.autocomplete = 'off';
      var on = document.createElement('button');
      on.type = 'button';
      on.className = 'aixpm-btn';
      on.textContent = 'Connecter';
      on.addEventListener('click', function () {
        var t = input.value.trim();
        if (!t) return;
        S.setToken(t);
        attachSyncPanel();
        S.pull();
      });
      row.appendChild(input);
      row.appendChild(on);
    }

    panel.appendChild(statusEl);
    panel.appendChild(row);

    var h1 = host.querySelector('h1');
    if (h1 && h1.parentNode) h1.parentNode.insertBefore(panel, h1.nextSibling);
    else host.insertBefore(panel, host.firstChild);

    if (hasToken) S.pull();
  }

  // ---------- Refresh on store change (cross-tab, post-sync) ----------
  function refreshFromStore() {
    document.querySelectorAll('.md-post--excerpt[data-aixpm-url]').forEach(function (article) {
      var url = article.dataset.aixpmUrl;
      var state = S.get(url);
      var rb = article.querySelector('.aixpm-btn--read');
      if (rb) rb.setAttribute('aria-pressed', state.read ? 'true' : 'false');
      if (state.read) article.setAttribute('data-aixpm-read', 'true');
      else article.removeAttribute('data-aixpm-read');
      if (state.archived) article.setAttribute('data-aixpm-archived', 'true');
      else article.removeAttribute('data-aixpm-archived');
      var grp = article.querySelector('.aixpm-stars');
      if (grp) paintStars(grp, state.rating);
      var ab = article.querySelector('.aixpm-btn--archive-icon');
      if (ab) {
        ab.setAttribute('aria-pressed', state.archived ? 'true' : 'false');
        ab.setAttribute('aria-label', state.archived ? 'Désarchiver' : 'Archiver');
        ab.title = state.archived ? 'Désarchiver' : 'Archiver';
      }
      var wrapEl = article.querySelector('.aixpm-actions');
      if (wrapEl) {
        var flag = wrapEl.querySelector('.aixpm-note-flag');
        if (state.note && !flag) { var nf = makeNoteIndicator(state.note); if (nf) wrapEl.appendChild(nf); }
        else if (!state.note && flag) flag.remove();
      }
    });
    if (/\/\d{4}\/\d{2}\/\d{2}\//.test(location.pathname)) {
      var u = S.canon(location.pathname);
      var state2 = S.get(u);
      var wrap = document.querySelector('.aixpm-actions--article');
      if (wrap) {
        var rb2 = wrap.querySelector('.aixpm-btn--read');
        if (rb2) {
          rb2.setAttribute('aria-pressed', state2.read ? 'true' : 'false');
          rb2.textContent = state2.read ? 'Marquer comme non lu' : 'Marquer comme lu';
        }
        var grp2 = wrap.querySelector('.aixpm-stars');
        if (grp2) paintStars(grp2, state2.rating);
        var arb = wrap.querySelector('.aixpm-btn--archive');
        if (arb) {
          arb.setAttribute('aria-pressed', state2.archived ? 'true' : 'false');
          arb.textContent = state2.archived ? 'Désarchiver' : 'Archiver';
        }
      }
      var content2 = document.querySelector('.md-content');   // reconcile the archived banner (same-tab + cross-tab)
      if (content2) renderArchivedBanner(u, content2);
    }
    if (isFavoritesPage()) {
      renderFavoritesPage();
      var st = S.getStatus();
      var statusEl = document.querySelector('.aixpm-sync__status');
      if (statusEl) {
        statusEl.textContent = st.msg;
        statusEl.classList.toggle('aixpm-sync__status--err', st.state === 'error' || st.state === 'suspended');
      }
    }
    updateNavCount();
    updateMaskedCount();
  }

  var subscribed = false;

  // ---------- Main wiring ----------
  function onPageReady() {
    if (activeNoteFlush) activeNoteFlush();       // save any in-progress note before re-render / soft-nav
    activeNoteFlush = null;
    ensureLiveRegion();                          // register the SR live region before any interaction
    document.querySelectorAll('.md-post--excerpt').forEach(attachToPostCard);
    attachToArticlePage();
    attachListToolbar();
    renderFavoritesPage();
    attachSyncPanel();
    updateNavCount();
    updateMaskedCount();
    if (!subscribed) {
      subscribed = true;
      S.subscribe(refreshFromStore);
      S.registerPreFlush(function () { if (activeNoteFlush) activeNoteFlush(); });
    }
  }

  // Exposed for tests (pure linkify split + DOM-safe builder)
  window.AIxPMUI = { _splitLinkify: splitLinkify, _buildLinkified: buildLinkified };

  if (typeof document$ !== 'undefined' && document$.subscribe) {
    document$.subscribe(onPageReady);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }
})();
