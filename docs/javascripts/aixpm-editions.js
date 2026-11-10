/* AIxPM editions — paragraph-level personal notes + personal tags.

   Edition pages (docs/editions/*) and theme pages (docs/themes/*) are generated
   by aixpm/publish-edition.py. Every annotatable block (a summary line or an
   item) carries:
     class="aixpm-item"  data-aixpm-key="/editions/<edition>/<item>/"
     data-aixpm-date="YYYY-MM-DD"  [data-aixpm-title="headline"]

   The key is a pseudo-path used as the store key, so the existing store
   (cells, merge, gist sync) handles paragraph annotations unchanged, and the
   same item shows the same note on its edition page and on every theme page.

   - ✎ button on each block opens a panel: note editor + personal tags
     (the same widgets as article pages, reused from window.AIxPMUI).
   - Annotated blocks stay open and are marked with an accent rule.
   - /annotations/ lists every annotation (filter by personal tag, copy as
     Markdown) — the raw material for later writing.
   - Notes live in this browser until the device is connected to the gist sync
     (« Ma bibliothèque »). While it is not, every open panel and /annotations/
     say so, with a link to connect.
   - Microcopy on these pages is English (the editions are); the shared widgets
     take the labels below.

   XSS discipline (binding): personal data only reaches the DOM via
   textContent / createTextNode — never innerHTML. */

(function () {
  'use strict';

  if (!window.AIxPMStore || !window.AIxPMUI || !window.AIxPMUI._buildNotePanel) { return; }
  var S = window.AIxPMStore;
  var UI = window.AIxPMUI;

  var NOTE_EN = { label: 'My note', saved: 'Saved ✓', saving: 'Saving…',
                  edit: 'Edit', add: '+ Add a note', done: 'Done' };
  var TAGS_EN = { label: 'My tags', add: 'Add a tag', remove: 'Remove tag ' };

  function siteBase() {
    // Deployment base ('/aixpm-watch/' on GH Pages, '/' locally), from the logo link.
    var a = document.querySelector('a.md-logo');
    try { return a ? new URL(a.href).pathname : '/'; } catch (e) { return '/'; }
  }
  // "Not synced" notice: shown only while this device is not connected.
  function buildSyncNotice() {
    var p = el('p', 'aixpm-sync-note');
    function paint() {
      p.textContent = '';
      var st = S.getStatus ? S.getStatus() : null;
      var broken = !!st && (st.state === 'error' || st.state === 'suspended');
      if (S.hasToken() && !broken) { p.hidden = true; return; }
      p.hidden = false;
      p.appendChild(document.createTextNode(broken
        ? 'Sync problem — saved on this device only. '
        : 'Saved on this device only. '));
      var a = el('a', null, broken ? 'Check the connection' : 'Connect sync');
      a.href = siteBase() + 'bibliotheque/';
      p.appendChild(a);
      p.appendChild(document.createTextNode(broken ? '.' : ' to find your notes on every device.'));
    }
    paint();
    return { el: p, paint: paint };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function hasContent(key) {
    var st = S.get(key);
    return !!st.note || st.tags.length > 0;
  }
  function blockTitle(node) {
    var t = node.getAttribute('data-aixpm-title');
    if (t) return t;
    var clone = node.cloneNode(true);
    clone.querySelectorAll('.aixpm-item__toggle, .aixpm-item__panel').forEach(function (n) { n.remove(); });
    t = clone.textContent.replace(/\s+/g, ' ').trim();
    return t.length > 320 ? t.slice(0, 317) + '…' : t;   // summary lines are kept whole
  }

  // ---------- One annotatable block ----------
  function attachItem(node) {
    if (node.dataset.aixpmItemInit === '1') return;
    var key = node.getAttribute('data-aixpm-key');
    if (!key) return;
    node.dataset.aixpmItemInit = '1';
    var date = node.getAttribute('data-aixpm-date') || '';
    var title = blockTitle(node);

    var toggle = el('button', 'aixpm-item__toggle', '✎');
    toggle.type = 'button';
    toggle.title = 'Add a note on this paragraph';
    toggle.setAttribute('aria-label', 'Add a note on this paragraph');
    toggle.setAttribute('aria-expanded', 'false');

    var panel = el('div', 'aixpm-item__panel');
    panel.hidden = true;
    var notePanel = null;
    var syncNote = null;

    function build() {
      if (notePanel) return;
      notePanel = UI._buildNotePanel(key, 'Your reaction to this paragraph', NOTE_EN);
      var tagsPanel = UI._buildTagsPanel(key, TAGS_EN);
      syncNote = buildSyncNotice();
      panel.appendChild(notePanel.el);
      panel.appendChild(tagsPanel.el);
      panel.appendChild(syncNote.el);
    }
    function paint() {
      var on = hasContent(key);
      if (on) node.setAttribute('data-aixpm-annotated', 'true');
      else node.removeAttribute('data-aixpm-annotated');
      toggle.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    }
    function open(startEditing) {
      build();
      S.touchMeta(key, title, date);          // so /annotations/ can label the entry
      panel.hidden = false;
      if (startEditing && !S.get(key).note) {
        var add = panel.querySelector('.aixpm-note__add');
        if (add) add.click();                  // straight into the textarea
      }
      paint();
    }
    function close() {
      if (notePanel) notePanel.flush();
      if (!hasContent(key)) panel.hidden = true;   // an annotated block stays open
      paint();
    }

    toggle.addEventListener('click', function () {
      if (panel.hidden) open(true);
      else if (notePanel && notePanel.isEditing()) { notePanel.flush(); paint(); }
      else close();
    });

    node.appendChild(toggle);
    node.appendChild(panel);
    node._aixpmRefresh = function () {
      if (hasContent(key) && panel.hidden) open(false);   // e.g. a note arriving from sync
      if (syncNote) syncNote.paint();
      paint();
    };
    if (hasContent(key)) open(false);
    paint();
  }

  function attachItems() {
    document.querySelectorAll('.aixpm-item[data-aixpm-key]').forEach(attachItem);
  }
  function refreshItems() {
    document.querySelectorAll('.aixpm-item[data-aixpm-key]').forEach(function (n) {
      if (n._aixpmRefresh) n._aixpmRefresh();
    });
  }

  // ---------- Nav count ----------
  function updateNavCount() {
    var nodes = document.querySelectorAll('[data-aixpm-ann-count]');
    if (!nodes.length) return;
    var n = S.annotations().length;
    nodes.forEach(function (x) { x.textContent = '(' + n + ')'; });
  }

  // ---------- /annotations/ ----------
  function isAnnotationsPage() { return /\/annotations\/?$/.test(location.pathname); }
  function basePrefix() { return location.pathname.replace(/annotations\/?$/, ''); }
  function parseKey(key) {
    var m = /^\/editions\/([^/]+)\/([^/]+)\/$/.exec(key);
    return m ? { edition: m[1], item: m[2] } : null;
  }
  function itemHref(key) {
    var k = parseKey(key);
    return k ? basePrefix() + 'editions/' + k.edition + '/#' + k.item : basePrefix();
  }
  function sortedAnnotations() {
    return S.annotations().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.url < b.url ? -1 : 1;
    });
  }
  function toMarkdown(list) {
    return list.map(function (a) {
      var k = parseKey(a.url);
      var lines = ['## ' + (a.title || a.url)];
      lines.push('Source: ' + location.origin + itemHref(a.url) + (k ? ' (edition ' + k.edition + ')' : ''));
      if (a.note) lines.push('', a.note.split('\n').map(function (l) { return '> ' + l; }).join('\n'));
      if (a.tags.length) lines.push('', 'Tags: ' + a.tags.join(', '));
      return lines.join('\n');
    }).join('\n\n');
  }
  function copyText(text, btn) {
    function done() {
      var old = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = old; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      ta.remove();
    }
  }

  var annFilter = '';       // personal tag currently filtered on (survives re-render)

  function renderAnnotations() {
    var mount = document.querySelector('[data-aixpm-annotations]');
    if (!mount || !isAnnotationsPage()) return;
    mount.textContent = '';

    var all = sortedAnnotations();
    if (!all.length) {
      mount.appendChild(el('p', 'aixpm-lib-empty',
        'No notes yet. Open an edition and click ✎ next to a paragraph.'));
      return;
    }

    var vocab = [];
    all.forEach(function (a) { a.tags.forEach(function (t) { if (vocab.indexOf(t) === -1) vocab.push(t); }); });
    vocab.sort(function (x, y) { return x.localeCompare(y, 'en'); });
    if (annFilter && vocab.indexOf(annFilter) === -1) annFilter = '';
    var list = annFilter ? all.filter(function (a) { return a.tags.indexOf(annFilter) !== -1; }) : all;

    var bar = el('div', 'aixpm-ann-bar');
    var sel = el('select', 'aixpm-search-select');
    sel.setAttribute('aria-label', 'Filter by personal tag');
    var o0 = el('option', null, 'All tags'); o0.value = ''; sel.appendChild(o0);
    vocab.forEach(function (t) {
      var o = el('option', null, t); o.value = t;
      if (t === annFilter) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { annFilter = sel.value; renderAnnotations(); });
    var count = el('span', 'aixpm-ann-count', list.length + (list.length > 1 ? ' notes' : ' note'));
    var copy = el('button', 'aixpm-btn', 'Copy as Markdown');
    copy.type = 'button';
    copy.addEventListener('click', function () { copyText(toMarkdown(list), copy); });
    bar.appendChild(sel); bar.appendChild(count); bar.appendChild(copy);
    mount.appendChild(bar);
    mount.appendChild(buildSyncNotice().el);

    list.forEach(function (a) {
      var k = parseKey(a.url);
      var card = el('div', 'aixpm-ann');
      var head = el('div', 'aixpm-ann__head');
      var link = el('a', 'aixpm-ann__title', a.title || a.url);
      link.href = itemHref(a.url);
      head.appendChild(link);
      head.appendChild(el('span', 'aixpm-ann__meta', (k ? k.edition : '') + (a.date ? ' · ' + a.date : '')));
      card.appendChild(head);
      if (a.note) {
        var note = el('div', 'aixpm-note__content');
        note.appendChild(UI._buildLinkified(a.note));
        card.appendChild(note);
      }
      if (a.tags.length) {
        var chips = el('div', 'aixpm-ann__tags');
        a.tags.forEach(function (t) { chips.appendChild(el('span', 'aixpm-tag', t)); });
        card.appendChild(chips);
      }
      mount.appendChild(card);
    });
  }

  // ---------- Wiring ----------
  var subscribed = false;
  function onStoreChange() {
    refreshItems();
    updateNavCount();
    renderAnnotations();
  }
  function onPageReady() {
    attachItems();
    updateNavCount();
    renderAnnotations();
    if (!subscribed) { subscribed = true; S.subscribe(onStoreChange); }
  }

  window.AIxPMEditions = { _toMarkdown: toMarkdown, _parseKey: parseKey };

  if (typeof document$ !== 'undefined' && document$.subscribe) {
    document$.subscribe(onPageReady);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }
})();
