/* AIxPM personal layer — UI (Session 1 scope).
   Replaces the old aixpm.js. Renders on top of window.AIxPMStore.

   - « Lu » button kept verbatim (manual, never auto-set by rating).
   - « Favori » replaced by a 5-star rating widget on cards + article pages.
   - Archived attribute plumbed onto cards (toggle UI lands in Session 2).
   - Hide-read toolbar kept.
   - /favorites/ interim: lists rated articles from the store + sync panel.
   - Nav count fed from the store (rated-article count).

   Re-runs on every Material soft-nav via the document$ observable. */

(function () {
  'use strict';

  if (!window.AIxPMStore) { return; }            // store must load first
  var S = window.AIxPMStore;

  var KEY_HIDE_READ = 'aixpm:hideRead';

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
    var noteFlag = makeNoteIndicator(state.note);

    var wrap = document.createElement('span');
    wrap.className = 'aixpm-actions';
    wrap.appendChild(readBtn);
    wrap.appendChild(stars);
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

    var wrap = document.createElement('div');
    wrap.className = 'aixpm-actions aixpm-actions--article';
    wrap.appendChild(readBtn);
    wrap.appendChild(stars);

    if (h1 && h1.parentNode) h1.parentNode.insertBefore(wrap, h1.nextSibling);
    else content.insertBefore(wrap, content.firstChild);
  }

  // ---------- "Hide read" toolbar ----------
  function attachHideReadToggle() {
    if (!document.querySelector('.md-post--excerpt')) return;
    var host = document.querySelector('.md-content article') || document.querySelector('.md-content');
    if (!host) return;
    if (host.querySelector('.aixpm-toolbar')) return;

    var toolbar = document.createElement('div');
    toolbar.className = 'aixpm-toolbar';

    var label = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = loadJSON(KEY_HIDE_READ, false);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' Masquer les articles lus'));
    toolbar.appendChild(label);

    document.body.classList.toggle('aixpm-hide-read', !!cb.checked);
    cb.addEventListener('change', function () {
      saveJSON(KEY_HIDE_READ, cb.checked);
      document.body.classList.toggle('aixpm-hide-read', !!cb.checked);
    });

    var h1 = host.querySelector('h1');
    if (h1 && h1.parentNode) h1.parentNode.insertBefore(toolbar, h1.nextSibling);
    else host.insertBefore(toolbar, host.firstChild);
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
      }
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
  }

  var subscribed = false;

  // ---------- Main wiring ----------
  function onPageReady() {
    ensureLiveRegion();                          // register the SR live region before any interaction
    document.querySelectorAll('.md-post--excerpt').forEach(attachToPostCard);
    attachToArticlePage();
    attachHideReadToggle();
    renderFavoritesPage();
    attachSyncPanel();
    updateNavCount();
    if (!subscribed) { subscribed = true; S.subscribe(refreshFromStore); }
  }

  if (typeof document$ !== 'undefined' && document$.subscribe) {
    document$.subscribe(onPageReady);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }
})();
