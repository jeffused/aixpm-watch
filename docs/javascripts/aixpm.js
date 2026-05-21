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
    return !!read[url];
  }
  function toggleFav(url, title) {
    var fav = loadFav();
    if (fav[url]) delete fav[url];
    else fav[url] = { title: title, added: Date.now() };
    saveJSON(KEY_FAV, fav);
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

  // ---------- Main wiring ----------
  function onPageReady() {
    document.querySelectorAll('.md-post--excerpt').forEach(attachToPostCard);
    attachToArticlePage();
    attachHideReadToggle();
    renderFavoritesPage();
    updateFavCount();
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
