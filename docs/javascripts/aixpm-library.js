/* AIxPM personal layer — « Ma bibliothèque » hub (Session 3 scope).
   Client-rendered page at /bibliotheque/. No-ops everywhere else.

   Renders, into the [data-aixpm-library] mount in bibliotheque.md:
   - Sync panel (moved here from the old /favorites/ page).
   - A preset-link row into the unified search (/recherche/, built in S4).
   - Custom sections: management (create / rename / delete) + hash-routed
     section views at /bibliotheque/#sections/<id>. Archived members stay
     listed, dimmed, with an « archivé » marker (Jeff's decision, §4.2).
   - Archivés view at /bibliotheque/#archives — recovery for archived articles.

   Reads window.AIxPMStore via its flat selectors / typed mutators only;
   it never sees {v,t} cells. XSS discipline: personal data (section names,
   titles) reaches the DOM via textContent only — never innerHTML.

   Re-renders on document$ (soft-nav), hashchange (in-page routing) and store
   notify (live counts), guarding the token input against clobber. */

(function () {
  'use strict';

  if (!window.AIxPMStore) { return; }
  var S = window.AIxPMStore;

  function isLibraryPage() { return /\/bibliotheque\/?$/.test(location.pathname); }

  // ---------- URL helpers ----------
  // Base path of the deployment, derived from the hub's own pathname so links
  // survive a future custom-domain / base-prefix change (never hardcode BASE).
  function basePath() { return location.pathname.replace(/\/bibliotheque\/?$/, ''); }
  function hubHref(hash) { return basePath() + '/bibliotheque/' + (hash || ''); }
  function searchHref(query) { return basePath() + '/recherche/' + (query || ''); }
  function articleHref(key) { return basePath() + key; }   // key is base-stripped, starts with '/'

  function parseHash(hash) {
    var h = (hash != null ? String(hash) : (location.hash || '')).replace(/^#/, '');
    if (h.indexOf('sections/') === 0) return { kind: 'section', id: h.slice('sections/'.length) };
    if (h === 'archives') return { kind: 'archives' };
    return { kind: 'overview' };
  }

  // ---------- DOM helpers ----------
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function txt(tag, cls, text) { var e = el(tag, cls); e.textContent = text; return e; }
  function btn(cls, text) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    return b;
  }
  function frDate(d) {
    if (!d) return '';
    var p = String(d).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d);
  }
  function articleLink(key, title) {
    var a = el('a', 'aixpm-lib-link');
    a.href = articleHref(key);
    a.textContent = title || key;
    return a;
  }

  function mount() { return document.querySelector('[data-aixpm-library]'); }

  // ---------- Sync panel (moved from /favorites/, copy = « données personnelles ») ----------
  function buildSyncPanel() {
    var hasToken = S.hasToken();
    var panel = el('div', 'aixpm-sync');

    var intro = txt('p', 'aixpm-sync__intro',
      'Vos données personnelles (notes, étoiles, tags, sections) sont stockées sur cet appareil. '
      + 'Connectez la synchro pour les retrouver sur vos autres appareils.');
    panel.appendChild(intro);

    var statusEl = el('div', 'aixpm-sync__status');
    var st = S.getStatus();
    statusEl.textContent = st.msg;
    if (st.state === 'error' || st.state === 'suspended') statusEl.classList.add('aixpm-sync__status--err');

    var row = el('div', 'aixpm-sync__row');

    if (hasToken) {
      var off = btn('aixpm-btn', 'Déconnecter cet appareil');
      off.addEventListener('click', function () { S.disconnect(); render(); });
      row.appendChild(off);
    } else {
      var help = el('a', 'aixpm-sync__help');
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
      var on = btn('aixpm-btn', 'Connecter');
      on.addEventListener('click', function () {
        var t = input.value.trim();
        if (!t) return;
        S.setToken(t);
        S.pull();
        render();
      });
      row.appendChild(input);
      row.appendChild(on);
    }

    panel.appendChild(statusEl);
    panel.appendChild(row);
    return panel;          // NOTE: never S.pull() here — render() runs on every notify, and pull()→notify() would loop
  }

  // ---------- Preset links into search ----------
  function buildPresetRow() {
    var wrap = el('div', 'aixpm-lib-presets');
    wrap.appendChild(txt('span', 'aixpm-lib-presets__label', 'Parcourir :'));
    [
      { label: 'Notés', q: '?min=1' },
      { label: 'Avec note', q: '?note=1' },
      { label: 'Mes tags', q: '' }
    ].forEach(function (p) {
      var a = el('a', 'aixpm-lib-preset');
      a.href = searchHref(p.q);
      a.textContent = p.label;
      wrap.appendChild(a);
    });
    return wrap;
  }

  // ---------- Sections manager (overview) ----------
  function buildSectionsManager() {
    var box = el('section', 'aixpm-lib-block');
    var head = el('div', 'aixpm-lib-block__head');
    head.appendChild(txt('h2', 'aixpm-lib-block__title', 'Mes sections'));
    var add = btn('aixpm-btn', '+ Nouvelle section');
    add.addEventListener('click', function () {
      var name = window.prompt('Nom de la nouvelle section :', '');
      if (name === null) return;
      name = name.replace(/\s+/g, ' ').trim();
      if (name) S.createSection(name);     // notify → re-render
    });
    head.appendChild(add);
    box.appendChild(head);

    var sections = S.liveSections();
    if (!sections.length) {
      box.appendChild(txt('p', 'aixpm-lib-empty', 'Rien ici pour le moment.'));
      return box;
    }

    var ul = el('ul', 'aixpm-lib-list');
    sections.forEach(function (s) {
      var li = el('li', 'aixpm-lib-list__item');

      var a = el('a', 'aixpm-lib-link');
      a.href = hubHref('#sections/' + s.id);
      a.textContent = s.name || '(sans nom)';
      var count = txt('span', 'aixpm-count', '(' + s.members.length + ')');
      a.appendChild(document.createTextNode(' '));
      a.appendChild(count);
      li.appendChild(a);

      var actions = el('span', 'aixpm-lib-list__actions');
      var ren = btn('aixpm-btn', 'Renommer');
      ren.setAttribute('aria-label', 'Renommer la section ' + (s.name || ''));
      ren.addEventListener('click', function () { promptRename(s); });
      var del = btn('aixpm-btn', 'Supprimer');
      del.setAttribute('aria-label', 'Supprimer la section ' + (s.name || ''));
      del.addEventListener('click', function () { promptDelete(s); });
      actions.appendChild(ren);
      actions.appendChild(del);
      li.appendChild(actions);

      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }

  function promptRename(s) {
    var name = window.prompt('Renommer la section :', s.name || '');
    if (name === null) return;
    name = name.replace(/\s+/g, ' ').trim();
    if (name) S.renameSection(s.id, name);
  }
  function promptDelete(s) {
    var msg = 'Supprimer la section « ' + (s.name || '') + ' » ? Les articles ne seront pas supprimés.';
    if (window.confirm(msg)) S.deleteSection(s.id);
  }

  // ---------- Archivés link (overview) ----------
  function buildArchivesLink() {
    var n = S.counts().archived;
    var wrap = el('div', 'aixpm-lib-archlink');
    var a = el('a', 'aixpm-lib-link');
    a.href = hubHref('#archives');
    a.textContent = 'Archivés';
    a.appendChild(document.createTextNode(' '));
    a.appendChild(txt('span', 'aixpm-count', '(' + n + ')'));
    wrap.appendChild(a);
    return wrap;
  }

  // ---------- Overview route ----------
  function renderOverview(host) {
    host.appendChild(buildSyncPanel());
    host.appendChild(buildPresetRow());
    host.appendChild(buildSectionsManager());
    host.appendChild(buildArchivesLink());
  }

  // ---------- Section view route ----------
  function backLink() {
    var a = el('a', 'aixpm-lib-back');
    a.href = hubHref('');
    a.textContent = '← Ma bibliothèque';
    return a;
  }

  function renderSection(host, id) {
    host.appendChild(backLink());
    var s = S.liveSections().filter(function (x) { return x.id === id; })[0];
    if (!s) {
      host.appendChild(txt('p', 'aixpm-lib-empty', 'Section introuvable.'));
      return;
    }

    var head = el('div', 'aixpm-lib-block__head');
    head.appendChild(txt('h2', 'aixpm-lib-block__title', s.name || '(sans nom)'));
    var ren = btn('aixpm-btn', 'Renommer');
    ren.addEventListener('click', function () { promptRename(s); });
    var del = btn('aixpm-btn', 'Supprimer');
    del.addEventListener('click', function () {
      var msg = 'Supprimer la section « ' + (s.name || '') + ' » ? Les articles ne seront pas supprimés.';
      if (window.confirm(msg)) { S.deleteSection(s.id); goOverview(); }
    });
    head.appendChild(ren);
    head.appendChild(del);
    host.appendChild(head);

    if (!s.members.length) {
      host.appendChild(txt('p', 'aixpm-lib-empty', 'Aucun article dans cette section.'));
      return;
    }

    var rows = s.members.map(function (key) { return { key: key, st: S.get(key) }; });
    rows.sort(function (a, b) { return (b.st.date || '').localeCompare(a.st.date || ''); });

    var ul = el('ul', 'aixpm-lib-list');
    rows.forEach(function (r) {
      var li = el('li', 'aixpm-lib-list__item');
      if (r.st.archived) li.classList.add('aixpm-lib-archived');

      var main = el('span', 'aixpm-lib-list__main');
      main.appendChild(articleLink(r.key, r.st.title));
      if (r.st.date) main.appendChild(txt('span', 'aixpm-lib-date', frDate(r.st.date)));
      if (r.st.archived) main.appendChild(txt('span', 'aixpm-lib-badge', 'archivé'));
      li.appendChild(main);

      var rm = btn('aixpm-btn', 'Retirer');
      rm.setAttribute('aria-label', 'Retirer ' + (r.st.title || r.key) + ' de la section');
      rm.addEventListener('click', function () { S.setMember(s.id, r.key, false); });   // notify → re-render
      li.appendChild(rm);

      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  // ---------- Archivés view route ----------
  function renderArchives(host) {
    host.appendChild(backLink());
    host.appendChild(txt('h2', 'aixpm-lib-block__title', 'Archivés'));

    var entries = S.allArticles().filter(function (a) { return a.archived; })
      .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

    if (!entries.length) {
      host.appendChild(txt('p', 'aixpm-lib-empty', 'Aucun article archivé.'));
      return;
    }

    var ul = el('ul', 'aixpm-lib-list');
    entries.forEach(function (e) {
      var li = el('li', 'aixpm-lib-list__item aixpm-lib-archived');
      var main = el('span', 'aixpm-lib-list__main');
      main.appendChild(articleLink(e.url, e.title));
      if (e.date) main.appendChild(txt('span', 'aixpm-lib-date', frDate(e.date)));
      li.appendChild(main);
      var un = btn('aixpm-btn', 'Désarchiver');
      un.setAttribute('aria-label', 'Désarchiver ' + (e.title || e.url));
      un.addEventListener('click', function () { S.setArchived(e.url, false); });   // notify → re-render
      li.appendChild(un);
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  // ---------- Router ----------
  function goOverview() {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    render();
  }

  // hash arg (optional): when re-rendering from a navigation event, pass the
  // EVENT's target hash rather than reading window.location.hash, which can lag
  // a History-API update by a tick. Absent → parseHash reads location.hash.
  function render(hash) {
    if (!isLibraryPage()) return;
    var host = mount();
    if (!host) return;
    host.textContent = '';
    var route = parseHash(hash);
    if (route.kind === 'section') renderSection(host, route.id);
    else if (route.kind === 'archives') renderArchives(host);
    else renderOverview(host);
  }

  // Store changes re-render — but never clobber the token field mid-typing.
  function onStoreChange() {
    if (!isLibraryPage()) return;
    var ae = document.activeElement;
    if (ae && ae.className && String(ae.className).indexOf('aixpm-sync__input') !== -1) return;
    render();
  }

  var wired = false;
  function onPageReady() {
    render();
    // Refresh from the gist ONCE per hub visit — never inside render()/buildSyncPanel
    // (those run on every notify; pull()→notify() would loop).
    if (isLibraryPage() && S.hasToken()) S.pull();
    if (!wired) {
      wired = true;
      S.subscribe(onStoreChange);
      // Hash routing under Material instant navigation: clicking a same-page hash
      // link (e.g. a section from the hub or the sidebar) is handled via the
      // History API, which does NOT fire a native 'hashchange'. So also react to
      // Material's location$ (fed by clicks + popstate), rendering with the
      // EMITTED url's hash. Keep 'hashchange' for the non-instant fallback.
      window.addEventListener('hashchange', function () { render(); });
      if (typeof location$ !== 'undefined' && location$.subscribe) {
        location$.subscribe(function (u) {
          try { if (u && /\/bibliotheque\/?$/.test(u.pathname)) render(u.hash); } catch (e) {}
        });
      }
    }
  }

  // Exposed for tests (pure routing).
  window.AIxPMLibrary = { _parseHash: parseHash };

  if (typeof document$ !== 'undefined' && document$.subscribe) {
    document$.subscribe(onPageReady);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }
})();
