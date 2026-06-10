/* AIxPM client-side state.
   - Read/unread per article (localStorage)
   - Favorites per article (localStorage)
   - Injects buttons on list cards and article pages
   - "Hide read" toggle on list pages
   - Populates the /favorites/ page from localStorage
   Re-runs on every Material soft-nav via the document$ observable. */

(function () {
  'use strict';

  var KEY_READ = 'aixpm:read';
  var KEY_FAV = 'aixpm:favorites';
  var KEY_HIDE_READ = 'aixpm:hideRead';

  // ---------- Cross-device sync (GitHub Gist backend) ----------
  // Single-user sync: read/unread + favorites live in a secret Gist.
  // "Login" = a classic gist-scoped PAT pasted once per device (localStorage).
  // The gist id is not secret; the token is. Data is fetched on load and
  // pushed (debounced) on every change. hideRead stays device-local on purpose.
  var GIST_ID = '30403d8cfb240fcd1de38e13e48e3660';
  var GIST_FILE = 'aixpm-favorites.json';
  var GH_API = 'https://api.github.com/gists/' + GIST_ID;
  var KEY_TOKEN = 'aixpm:ghToken';       // per-device PAT
  var KEY_UPDATED = 'aixpm:updatedAt';   // local last-change timestamp (ms)
  var KEY_SYNCED = 'aixpm:syncedOnce';   // '1' after first union merge on this device
  var PUSH_DELAY = 1500;                  // debounce window for pushes (ms)

  // ---------- Storage helpers ----------
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { /* quota or denied */ }
  }
  function loadRead() { return loadJSON(KEY_READ, {}); }
  function loadFav()  { return loadJSON(KEY_FAV, {}); }

  // ---------- Sync storage helpers ----------
  function getToken() {
    try { return localStorage.getItem(KEY_TOKEN) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try { if (t) localStorage.setItem(KEY_TOKEN, t); else localStorage.removeItem(KEY_TOKEN); }
    catch (e) { /* denied */ }
  }
  function localUpdated() {
    var v = 0;
    try { v = parseInt(localStorage.getItem(KEY_UPDATED) || '0', 10); } catch (e) {}
    return isNaN(v) ? 0 : v;
  }
  function touchUpdated() {
    var now = Date.now();
    try { localStorage.setItem(KEY_UPDATED, String(now)); } catch (e) {}
    return now;
  }

  // ---------- URL normalization ----------
  function canon(href) {
    try { return new URL(href, location.href).pathname; }
    catch (e) { return href; }
  }

  // ---------- Heading title extraction (strips permalink ¶) ----------
  function headingTitle(el) {
    if (!el) return '';
    var clone = el.cloneNode(true);
    clone.querySelectorAll('.headerlink').forEach(function (n) { n.remove(); });
    return clone.textContent.trim();
  }

  // ---------- Per-post info extraction (list views) ----------
  function postInfo(article) {
    var link = article.querySelector('.md-post__content > h2 > a.toclink, .md-post__content > h1 > a.toclink, .md-post__content h2 a.toclink, .md-post__content h1 a.toclink');
    if (!link) return null;
    var href = link.getAttribute('href');
    if (!href) return null;
    return { url: canon(href), title: link.textContent.trim() };
  }

  // ---------- Button factory ----------
  function makeBtn(kind, pressed, label) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aixpm-btn aixpm-btn--' + kind;
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.textContent = label;
    return btn;
  }

  // ---------- Toggle helpers ----------
  function toggleRead(url) {
    var read = loadRead();
    if (read[url]) delete read[url];
    else read[url] = Date.now();
    saveJSON(KEY_READ, read);
    afterLocalChange();
    return !!read[url];
  }
  function toggleFav(url, title) {
    var fav = loadFav();
    if (fav[url]) delete fav[url];
    else fav[url] = { title: title, added: Date.now() };
    saveJSON(KEY_FAV, fav);
    afterLocalChange();
    return !!fav[url];
  }

  // ---------- Attach buttons to a post card ----------
  function attachToPostCard(article) {
    if (article.dataset.aixpmInit === '1') return;
    var info = postInfo(article);
    if (!info) return;
    article.dataset.aixpmInit = '1';
    article.dataset.aixpmUrl = info.url;

    var read = loadRead();
    var fav = loadFav();
    var isRead = !!read[info.url];
    var isFav = !!fav[info.url];
    if (isRead) article.setAttribute('data-aixpm-read', 'true');

    var readBtn = makeBtn('read', isRead, 'Lu');
    var favBtn = makeBtn('fav', isFav, 'Favori');

    readBtn.addEventListener('click', function () {
      var now = toggleRead(info.url);
      readBtn.setAttribute('aria-pressed', now ? 'true' : 'false');
      if (now) article.setAttribute('data-aixpm-read', 'true');
      else article.removeAttribute('data-aixpm-read');
    });
    favBtn.addEventListener('click', function () {
      var now = toggleFav(info.url, info.title);
      favBtn.setAttribute('aria-pressed', now ? 'true' : 'false');
      updateFavCount();
    });

    var wrap = document.createElement('span');
    wrap.className = 'aixpm-actions';
    wrap.appendChild(readBtn);
    wrap.appendChild(favBtn);

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

  // ---------- Attach buttons to a single article page ----------
  function attachToArticlePage() {
    if (!/\/\d{4}\/\d{2}\/\d{2}\//.test(location.pathname)) return;
    var content = document.querySelector('.md-content');
    if (!content) return;
    if (content.dataset.aixpmArticleInit === '1') return;
    content.dataset.aixpmArticleInit = '1';

    var url = canon(location.pathname);
    var h1 = content.querySelector('h1');
    var title = headingTitle(h1) || document.title;

    var read = loadRead();
    var fav = loadFav();
    var readBtn = makeBtn('read', !!read[url], 'Marquer comme lu');
    var favBtn = makeBtn('fav', !!fav[url], 'Favori');

    readBtn.addEventListener('click', function () {
      var now = toggleRead(url);
      readBtn.setAttribute('aria-pressed', now ? 'true' : 'false');
      readBtn.textContent = now ? 'Marquer comme non lu' : 'Marquer comme lu';
    });
    if (read[url]) readBtn.textContent = 'Marquer comme non lu';
    favBtn.addEventListener('click', function () {
      var now = toggleFav(url, title);
      favBtn.setAttribute('aria-pressed', now ? 'true' : 'false');
      updateFavCount();
    });

    var wrap = document.createElement('div');
    wrap.className = 'aixpm-actions aixpm-actions--article';
    wrap.appendChild(readBtn);
    wrap.appendChild(favBtn);

    if (h1 && h1.parentNode) {
      h1.parentNode.insertBefore(wrap, h1.nextSibling);
    } else {
      content.insertBefore(wrap, content.firstChild);
    }
  }

  // ---------- "Hide read" toolbar on list pages ----------
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

    applyHideRead(cb.checked);
    cb.addEventListener('change', function () {
      saveJSON(KEY_HIDE_READ, cb.checked);
      applyHideRead(cb.checked);
    });

    var h1 = host.querySelector('h1');
    if (h1 && h1.parentNode) {
      h1.parentNode.insertBefore(toolbar, h1.nextSibling);
    } else {
      host.insertBefore(toolbar, host.firstChild);
    }
  }

  function applyHideRead(on) {
    document.body.classList.toggle('aixpm-hide-read', !!on);
  }

  // ---------- Favorites page ----------
  function renderFavoritesPage() {
    if (!/\/favorites\/?$/.test(location.pathname)) return;
    var host = document.querySelector('.md-content article') || document.querySelector('.md-content');
    if (!host) return;

    var prior = host.querySelectorAll('.aixpm-favorites-list, .aixpm-favorites-empty');
    prior.forEach(function (n) { n.remove(); });

    var fav = loadFav();
    var entries = Object.keys(fav).map(function (url) {
      return { url: url, info: fav[url] };
    }).sort(function (a, b) {
      return (b.info.added || 0) - (a.info.added || 0);
    });

    if (entries.length === 0) {
      var p = document.createElement('p');
      p.className = 'aixpm-favorites-empty';
      p.textContent = 'Aucun favori pour le moment. Cliquez sur « Favori » sur un article pour l’ajouter ici.';
      host.appendChild(p);
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'aixpm-favorites-list';
    entries.forEach(function (e) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = e.url;
      a.textContent = e.info.title || e.url;
      var meta = document.createElement('span');
      meta.className = 'aixpm-fav-meta';
      if (e.info.added) {
        meta.textContent = new Date(e.info.added).toLocaleDateString('fr-FR');
      }
      li.appendChild(a);
      li.appendChild(meta);
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  // ---------- Favorites count in sidebar ----------
  function updateFavCount() {
    var nodes = document.querySelectorAll('[data-aixpm-fav-count]');
    if (!nodes.length) return;
    var n = Object.keys(loadFav()).length;
    nodes.forEach(function (el) { el.textContent = '(' + n + ')'; });
  }

  // ============================================================
  // Cross-device sync
  // ============================================================

  var pulling = false;          // guard against overlapping pulls
  var didInitialPull = false;   // pull once per session on non-favorites pages
  var pushTimer = null;         // debounce handle

  // Build the sync document from this device's local state.
  function buildLocalDoc() {
    return { read: loadRead(), favorites: loadFav(), updatedAt: localUpdated() };
  }

  // Persist a remote document onto this device wholesale.
  function applyDoc(doc) {
    saveJSON(KEY_READ, doc.read || {});
    saveJSON(KEY_FAV, doc.favorites || {});
    try { localStorage.setItem(KEY_UPDATED, String(doc.updatedAt || 0)); } catch (e) {}
  }

  // Loss-free union of two states — used only on a device's first connect.
  function unionMerge(local, remote) {
    var read = {};
    [remote.read || {}, local.read || {}].forEach(function (src) {
      Object.keys(src).forEach(function (url) {
        read[url] = Math.max(read[url] || 0, src[url] || 0);
      });
    });
    var fav = {};
    [remote.favorites || {}, local.favorites || {}].forEach(function (src) {
      Object.keys(src).forEach(function (url) {
        var cur = fav[url], cand = src[url] || {};
        if (!cur || (cand.added || 0) > (cur.added || 0)) fav[url] = cand;
      });
    });
    return { read: read, favorites: fav, updatedAt: Date.now() };
  }

  // GET the gist, merge, persist, refresh the UI.
  function pull() {
    var token = getToken();
    if (!token || pulling) return Promise.resolve();
    pulling = true;
    return fetch(GH_API, {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' },
      cache: 'no-store'
    }).then(function (res) {
      if (res.status === 401) { syncStatus('Token invalide — reconnectez-vous.', true); throw new Error('401'); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (gist) {
      var file = gist.files && gist.files[GIST_FILE];
      var remote = file && file.content ? JSON.parse(file.content) : { read: {}, favorites: {}, updatedAt: 0 };
      var local = buildLocalDoc();
      var syncedOnce = false;
      try { syncedOnce = localStorage.getItem(KEY_SYNCED) === '1'; } catch (e) {}

      if (!syncedOnce) {
        // First connect on this device: never lose anything on either side.
        var merged = unionMerge(local, remote);
        applyDoc(merged);
        try { localStorage.setItem(KEY_SYNCED, '1'); } catch (e) {}
        refreshUI();
        push(true);                       // upload the union so the gist holds it too
        syncStatus('Synchro active — fusion initiale faite.');
      } else if ((remote.updatedAt || 0) > local.updatedAt) {
        // A newer state from another device wins wholesale (propagates deletes).
        applyDoc(remote);
        refreshUI();
        syncStatus('Synchro active — à jour.');
      } else {
        syncStatus('Synchro active — à jour.');
      }
    }).catch(function (e) {
      if (String(e.message) !== '401') syncStatus('Synchro indisponible (réseau).', true);
    }).then(function () { pulling = false; });
  }

  // PATCH the gist with this device's state. `immediate` skips the debounce.
  function push(immediate) {
    var token = getToken();
    if (!token) return;
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    var run = function () {
      var doc = buildLocalDoc();
      var body = {}; body[GIST_FILE] = { content: JSON.stringify(doc) };
      fetch(GH_API, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ files: body })
      }).then(function (res) {
        if (res.status === 401) syncStatus('Token invalide — reconnectez-vous.', true);
        else if (res.ok) syncStatus('Synchronisé ✓');
        else syncStatus('Échec de la synchro (HTTP ' + res.status + ').', true);
      }).catch(function () { syncStatus('Synchro indisponible (réseau).', true); });
    };
    if (immediate) run(); else pushTimer = setTimeout(run, PUSH_DELAY);
  }

  // Called after any local read/favorite toggle.
  function afterLocalChange() {
    touchUpdated();
    if (getToken()) push(false);
  }

  // Re-derive pressed states / favorites list after a remote pull.
  function refreshUI() {
    var read = loadRead(), fav = loadFav();
    document.querySelectorAll('.md-post--excerpt[data-aixpm-url]').forEach(function (article) {
      var url = article.dataset.aixpmUrl;
      var rb = article.querySelector('.aixpm-btn--read');
      var fb = article.querySelector('.aixpm-btn--fav');
      if (rb) rb.setAttribute('aria-pressed', read[url] ? 'true' : 'false');
      if (fb) fb.setAttribute('aria-pressed', fav[url] ? 'true' : 'false');
      if (read[url]) article.setAttribute('data-aixpm-read', 'true');
      else article.removeAttribute('data-aixpm-read');
    });
    if (/\/\d{4}\/\d{2}\/\d{2}\//.test(location.pathname)) {
      var u = canon(location.pathname);
      var wrap = document.querySelector('.aixpm-actions--article');
      if (wrap) {
        var rb2 = wrap.querySelector('.aixpm-btn--read');
        var fb2 = wrap.querySelector('.aixpm-btn--fav');
        if (rb2) { rb2.setAttribute('aria-pressed', read[u] ? 'true' : 'false'); rb2.textContent = read[u] ? 'Marquer comme non lu' : 'Marquer comme lu'; }
        if (fb2) fb2.setAttribute('aria-pressed', fav[u] ? 'true' : 'false');
      }
    }
    renderFavoritesPage();
    updateFavCount();
  }

  // ---------- Sync status line (favorites page panel) ----------
  function syncStatus(msg, isErr) {
    var el = document.querySelector('.aixpm-sync__status');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('aixpm-sync__status--err', !!isErr);
  }

  // ---------- Sync panel on the favorites page ----------
  function attachSyncPanel() {
    if (!/\/favorites\/?$/.test(location.pathname)) return;
    var host = document.querySelector('.md-content article') || document.querySelector('.md-content');
    if (!host) return;
    var prior = host.querySelector('.aixpm-sync');
    if (prior) prior.remove();

    var hasToken = !!getToken();
    var panel = document.createElement('div');
    panel.className = 'aixpm-sync';

    var status = document.createElement('div');
    status.className = 'aixpm-sync__status';
    status.textContent = hasToken ? 'Synchro active.' : 'Non synchronisé — favoris stockés sur cet appareil seulement.';

    var row = document.createElement('div');
    row.className = 'aixpm-sync__row';

    if (hasToken) {
      var off = document.createElement('button');
      off.type = 'button';
      off.className = 'aixpm-btn';
      off.textContent = 'Déconnecter cet appareil';
      off.addEventListener('click', function () {
        setToken('');
        try { localStorage.removeItem(KEY_SYNCED); } catch (e) {}
        attachSyncPanel();
      });
      row.appendChild(off);
    } else {
      var input = document.createElement('input');
      input.type = 'password';
      input.className = 'aixpm-sync__input';
      input.placeholder = 'Collez votre token GitHub (scope gist)';
      input.autocomplete = 'off';
      var on = document.createElement('button');
      on.type = 'button';
      on.className = 'aixpm-btn';
      on.textContent = 'Connecter';
      on.addEventListener('click', function () {
        var t = input.value.trim();
        if (!t) return;
        setToken(t);
        try { localStorage.removeItem(KEY_SYNCED); } catch (e) {} // force union merge on connect
        attachSyncPanel();
        pull();
      });
      row.appendChild(input);
      row.appendChild(on);

      var help = document.createElement('a');
      help.className = 'aixpm-sync__help';
      help.href = 'https://github.com/settings/tokens/new?scopes=gist&description=AIxPM%20favorites%20sync';
      help.target = '_blank';
      help.rel = 'noopener';
      help.textContent = 'Créer un token (scope « gist »)';
      panel.appendChild(help);
    }

    panel.appendChild(status);
    panel.appendChild(row);

    var h1 = host.querySelector('h1');
    if (h1 && h1.parentNode) h1.parentNode.insertBefore(panel, h1.nextSibling);
    else host.insertBefore(panel, host.firstChild);

    if (hasToken) pull(); // refresh the favorites list on every visit
  }

  // ---------- Main wiring ----------
  function onPageReady() {
    document.querySelectorAll('.md-post--excerpt').forEach(attachToPostCard);
    attachToArticlePage();
    attachHideReadToggle();
    renderFavoritesPage();
    attachSyncPanel();
    updateFavCount();
    if (getToken() && !didInitialPull) { didInitialPull = true; pull(); }
  }

  // Material exposes document$ globally. It fires on initial load AND on
  // every SPA soft-nav (navigation.instant). Fall back if absent.
  if (typeof document$ !== 'undefined' && document$.subscribe) {
    document$.subscribe(onPageReady);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }
})();
