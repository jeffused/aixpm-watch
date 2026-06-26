/* AIxPM personal store — data layer (schema 2).
   The single source of truth for Jeff's personal layer: ratings, notes,
   personal tags, custom sections, archived + read state.

   - localStorage key `aixpm:doc` mirrors the gist file `aixpm-data.json`.
   - Every personal datum is a timestamped cell {v, t} (value + ms-epoch).
   - Merge is per-field last-write-wins on cells: a conflict's blast radius
     is one field of one article, never the whole document.
   - Sync cycle is read-merge-write (GET → merge → save → PATCH-if-differs),
     never a blind overwrite. iOS tab-kill is covered by a keepalive flush.

   Exposes window.AIxPMStore. UI / search / library code consume FLAT,
   tombstone-filtered views via the selectors — they never see {v,t} cells.

   See aixpm/UPGRADE-PRD-v3.md §4.1 for the binding contracts. */

(function () {
  'use strict';

  // ---------- Constants ----------
  var SCHEMA = 2;
  var BASE = '/aixpm-watch';                 // GH Pages project prefix, stripped from keys

  var LS_DOC = 'aixpm:doc';
  var LS_TOKEN = 'aixpm:ghToken';            // per-device PAT (reused from v1)
  var LS_DIRTY = 'aixpm:dirty';              // '1' when a local write awaits push

  // v1 localStorage keys (read once for migration, then left as backup)
  var LS_V1_READ = 'aixpm:read';
  var LS_V1_FAV = 'aixpm:favorites';

  var GIST_ID = '30403d8cfb240fcd1de38e13e48e3660';
  var GIST_FILE = 'aixpm-data.json';         // schema-2 store
  var GIST_FILE_V1 = 'aixpm-favorites.json'; // frozen v1 backup, read once for seed
  var GH_API = 'https://api.github.com/gists/' + GIST_ID;

  var PUSH_DELAY = 2500;                      // debounce window for pushes (ms)

  // ---------- Small utils ----------
  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }

  function unionKeys(a, b) {
    var seen = {};
    var out = [];
    [a || {}, b || {}].forEach(function (o) {
      Object.keys(o).forEach(function (k) { if (!seen[k]) { seen[k] = 1; out.push(k); } });
    });
    return out;
  }

  // ---------- Canonical article key (binding contract, §4.1) ----------
  // decoded, base-stripped, trailing-slash pathname: /YYYY/MM/DD/<title-slug>/
  function canon(href) {
    var path;
    try { path = new URL(href, location.href).pathname; }
    catch (e) { path = String(href == null ? '' : href); }
    try { path = decodeURIComponent(path); } catch (e) { /* keep raw on malformed % */ }
    if (BASE && path.lastIndexOf(BASE, 0) === 0) path = path.slice(BASE.length);
    return path;
  }

  // Derive YYYY-MM-DD from a canonical key when the caller has no explicit date.
  function dateFromKey(key) {
    var m = /^\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(key || '');
    return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
  }

  // ---------- Cell helpers ----------
  // Local writes stamp t = max(now, existingCell.t + 1) — defeats clock regressions.
  function stamp(cell) {
    var n = Date.now();
    var floor = (cell && typeof cell.t === 'number') ? cell.t + 1 : 0;
    return n > floor ? n : floor;
  }
  function cellVal(cell, dflt) {
    return (cell && typeof cell === 'object' && 'v' in cell) ? cell.v : dflt;
  }
  // Higher t wins; deterministic tie-break on serialized value.
  function newerCell(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    var ta = typeof a.t === 'number' ? a.t : 0;
    var tb = typeof b.t === 'number' ? b.t : 0;
    if (ta !== tb) return ta > tb ? a : b;
    return JSON.stringify(a.v) >= JSON.stringify(b.v) ? a : b;
  }

  // ---------- Document shape ----------
  function emptyDoc() {
    return { schema: SCHEMA, updatedAt: 0, meta: {}, articles: {}, sections: {} };
  }

  // Defensive normalization of a parsed doc into the canonical shape.
  function normalize(doc) {
    if (!isObj(doc)) return emptyDoc();
    var out = emptyDoc();
    out.schema = SCHEMA;
    out.meta = isObj(doc.meta) ? doc.meta : {};
    if (isObj(doc.articles)) {
      Object.keys(doc.articles).forEach(function (k) {
        var a = doc.articles[k];
        if (!isObj(a)) return;
        var m = {};
        ['read', 'rating', 'note', 'tags', 'archived'].forEach(function (f) {
          if (isObj(a[f]) && 't' in a[f]) m[f] = { v: a[f].v, t: a[f].t };
        });
        if (typeof a.title === 'string') m.title = a.title;
        if (typeof a.date === 'string') m.date = a.date;
        out.articles[k] = m;
      });
    }
    if (isObj(doc.sections)) {
      Object.keys(doc.sections).forEach(function (id) {
        var s = doc.sections[id];
        if (!isObj(s)) return;
        var m = { members: {} };
        if (isObj(s.name) && 't' in s.name) m.name = { v: s.name.v, t: s.name.t };
        if (isObj(s.deleted) && 't' in s.deleted) m.deleted = { v: s.deleted.v, t: s.deleted.t };
        if (isObj(s.members)) {
          Object.keys(s.members).forEach(function (mk) {
            var e = s.members[mk];
            if (isObj(e) && 't' in e) m.members[mk] = { v: e.v, t: e.t };
          });
        }
        out.sections[id] = m;
      });
    }
    out.updatedAt = computeUpdatedAt(out);
    return out;
  }

  function computeUpdatedAt(doc) {
    var max = 0;
    function bump(cell) { if (cell && typeof cell.t === 'number' && cell.t > max) max = cell.t; }
    Object.keys(doc.articles).forEach(function (k) {
      var a = doc.articles[k];
      ['read', 'rating', 'note', 'tags', 'archived'].forEach(function (f) { bump(a[f]); });
    });
    Object.keys(doc.sections).forEach(function (id) {
      var s = doc.sections[id];
      bump(s.name); bump(s.deleted);
      Object.keys(s.members || {}).forEach(function (mk) { bump(s.members[mk]); });
    });
    return max;
  }

  // ---------- Merge (per-field LWW) ----------
  // title/date are plain denormalized strings: prefer non-empty, then the
  // article entry whose newest cell is more recent.
  function newestArticleT(a) {
    var max = 0;
    ['read', 'rating', 'note', 'tags', 'archived'].forEach(function (f) {
      if (a[f] && typeof a[f].t === 'number' && a[f].t > max) max = a[f].t;
    });
    return max;
  }
  function pickMeta(lv, rv, la, ra) {
    var l = typeof lv === 'string' ? lv : '';
    var r = typeof rv === 'string' ? rv : '';
    if (l && !r) return l;
    if (r && !l) return r;
    if (!l && !r) return '';
    return newestArticleT(la) >= newestArticleT(ra) ? l : r;
  }

  function mergeDocs(L, R) {
    L = normalize(L); R = normalize(R);
    var out = emptyDoc();

    // meta — keep the earliest migration stamp if both present
    out.meta = {};
    Object.keys(L.meta).forEach(function (k) { out.meta[k] = L.meta[k]; });
    Object.keys(R.meta).forEach(function (k) {
      if (!(k in out.meta)) out.meta[k] = R.meta[k];
      else if (typeof out.meta[k] === 'number' && typeof R.meta[k] === 'number') {
        out.meta[k] = Math.min(out.meta[k], R.meta[k]);
      }
    });

    unionKeys(L.articles, R.articles).forEach(function (k) {
      var la = L.articles[k] || {}, ra = R.articles[k] || {};
      var m = {};
      ['read', 'rating', 'note', 'tags', 'archived'].forEach(function (f) {
        var c = newerCell(la[f], ra[f]);
        if (c) m[f] = c;
      });
      var t = pickMeta(la.title, ra.title, la, ra);
      var d = pickMeta(la.date, ra.date, la, ra);
      if (t) m.title = t;
      if (d) m.date = d;
      out.articles[k] = m;
    });

    unionKeys(L.sections, R.sections).forEach(function (id) {
      var ls = L.sections[id] || {}, rs = R.sections[id] || {};
      var m = { members: {} };
      var n = newerCell(ls.name, rs.name); if (n) m.name = n;
      var del = newerCell(ls.deleted, rs.deleted); if (del) m.deleted = del;
      unionKeys(ls.members, rs.members).forEach(function (mk) {
        var c = newerCell((ls.members || {})[mk], (rs.members || {})[mk]);
        if (c) m.members[mk] = c;
      });
      out.sections[id] = m;
    });

    out.updatedAt = computeUpdatedAt(out);
    return out;
  }

  // ---------- Persistence + in-memory cache ----------
  var cache = null;          // parsed, normalized doc (selectors read this)
  var listeners = [];

  function readLocal() {
    try {
      var raw = localStorage.getItem(LS_DOC);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (e) { return null; }
  }

  // Always return a usable doc, running migration on first ever load.
  function getDoc() {
    if (cache) return cache;
    var doc = readLocal();
    if (!doc) {
      doc = migrateLocalV1() || emptyDoc();
      writeLocal(doc);            // persist the migrated/empty baseline
    }
    cache = doc;
    return cache;
  }

  function writeLocal(doc) {
    doc.updatedAt = computeUpdatedAt(doc);
    try { localStorage.setItem(LS_DOC, JSON.stringify(doc)); } catch (e) { /* quota/denied */ }
    cache = doc;
  }

  // Read-modify-write against a FRESH localStorage copy (multi-tab safe),
  // then persist, flag dirty, schedule a push, and notify subscribers.
  function commit(mutate) {
    var doc = readLocal() || getDoc();
    mutate(doc);
    writeLocal(doc);
    writeGen++;                 // declared in the sync section (hoisted); tracks unpushed local writes
    setDirty(true);
    notify();
    schedulePush();
  }

  function setDirty(on) {
    try {
      if (on) localStorage.setItem(LS_DIRTY, '1');
      else localStorage.removeItem(LS_DIRTY);
    } catch (e) {}
  }
  function isDirty() {
    try { return localStorage.getItem(LS_DIRTY) === '1'; } catch (e) { return false; }
  }

  function notify() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function subscribe(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  // ---------- v1 migration (local, one-shot) ----------
  function migrateLocalV1() {
    var read = null, fav = null;
    try { read = JSON.parse(localStorage.getItem(LS_V1_READ) || 'null'); } catch (e) {}
    try { fav = JSON.parse(localStorage.getItem(LS_V1_FAV) || 'null'); } catch (e) {}
    if (!isObj(read) && !isObj(fav)) return null;   // nothing to migrate

    var doc = emptyDoc();
    var now = Date.now();
    doc.meta.migratedFromV1At = now;

    function art(key) {
      if (!doc.articles[key]) doc.articles[key] = {};
      return doc.articles[key];
    }
    if (isObj(read)) {
      Object.keys(read).forEach(function (href) {
        var ts = Number(read[href]) || now;
        art(canon(href)).read = { v: true, t: ts };
      });
    }
    if (isObj(fav)) {
      Object.keys(fav).forEach(function (href) {
        var info = fav[href] || {};
        var key = canon(href);
        var ts = Number(info.added) || now;
        var a = art(key);
        a.rating = { v: 4, t: ts };                 // hard-coded 4: inside "rated 4+", reserves 5
        if (info.title && !a.title) a.title = String(info.title);
        if (!a.date) { var d = dateFromKey(key); if (d) a.date = d; }
      });
    }
    return doc;
  }

  // Convert the frozen v1 remote file into a schema-2 doc (one-shot remote seed).
  function seedFromV1Remote(v1) {
    if (!isObj(v1)) return emptyDoc();
    var doc = emptyDoc();
    var now = Date.now();
    function art(key) { if (!doc.articles[key]) doc.articles[key] = {}; return doc.articles[key]; }
    if (isObj(v1.read)) {
      Object.keys(v1.read).forEach(function (href) {
        art(canon(href)).read = { v: true, t: Number(v1.read[href]) || now };
      });
    }
    if (isObj(v1.favorites)) {
      Object.keys(v1.favorites).forEach(function (href) {
        var info = v1.favorites[href] || {};
        var key = canon(href);
        var a = art(key);
        a.rating = { v: 4, t: Number(info.added) || now };
        if (info.title && !a.title) a.title = String(info.title);
        if (!a.date) { var d = dateFromKey(key); if (d) a.date = d; }
      });
    }
    doc.updatedAt = computeUpdatedAt(doc);
    return doc;
  }

  // ---------- Mutators (encode the cell-stamping rule in one place) ----------
  function ensureArticle(doc, key) {
    if (!doc.articles[key]) doc.articles[key] = {};
    return doc.articles[key];
  }

  function clampRating(n) {
    n = Math.round(Number(n) || 0);
    if (n < 0) n = 0; if (n > 5) n = 5;
    return n;
  }

  function setRead(url, on) {
    var key = canon(url);
    commit(function (doc) {
      var a = ensureArticle(doc, key);
      a.read = { v: !!on, t: stamp(a.read) };
    });
  }
  function setRating(url, n) {
    var key = canon(url);
    commit(function (doc) {
      var a = ensureArticle(doc, key);
      a.rating = { v: clampRating(n), t: stamp(a.rating) };
    });
  }
  function setNote(url, text) {
    var key = canon(url);
    var clean = (typeof text === 'string' && text.trim() !== '') ? text : '';
    commit(function (doc) {
      var a = ensureArticle(doc, key);
      a.note = { v: clean, t: stamp(a.note) };       // '' = tombstone (cleared)
    });
  }
  function setTags(url, arr) {
    var key = canon(url);
    var norm = normalizeTags(arr);
    commit(function (doc) {
      var a = ensureArticle(doc, key);
      a.tags = { v: norm, t: stamp(a.tags) };         // whole-array LWW
    });
  }
  function setArchived(url, on) {
    var key = canon(url);
    commit(function (doc) {
      var a = ensureArticle(doc, key);
      a.archived = { v: !!on, t: stamp(a.archived) };
    });
  }
  // Capture/refresh denormalized title+date (plain strings, no cell).
  function touchMeta(url, title, date) {
    var key = canon(url);
    var t = (typeof title === 'string') ? title.trim() : '';
    var d = (typeof date === 'string' && date) ? date : dateFromKey(key);
    commitQuiet(function (doc) {
      var a = ensureArticle(doc, key);
      var changed = false;
      if (t && a.title !== t) { a.title = t; changed = true; }
      if (d && a.date !== d) { a.date = d; changed = true; }
      return changed;
    });
  }
  // commitQuiet: persist only if the mutate fn reports a change; meta touches
  // must not flag dirty / trigger a push on every page view.
  function commitQuiet(mutate) {
    var doc = readLocal() || getDoc();
    var changed = mutate(doc);
    if (changed) { writeLocal(doc); /* no dirty flag, no push, no notify storm */ }
  }

  function normalizeTags(arr) {
    if (!Array.isArray(arr)) return [];
    var seen = Object.create(null);     // null-proto: a tag named "constructor"/"__proto__" can't collide
    var out = [];
    arr.forEach(function (raw) {
      if (typeof raw !== 'string') return;
      var t = raw.replace(/\s+/g, ' ').trim();
      if (!t) return;
      var fold = foldKey(t);
      if (seen[fold]) return;
      seen[fold] = 1;
      out.push(t);                                    // store as typed (accents welcome)
    });
    return out;
  }
  function foldKey(s) {
    var x = s.toLowerCase();
    try { x = x.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return x;
  }

  // ---------- Section mutators ----------
  function newSectionId() {
    return 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function createSection(name) {
    var id = newSectionId();
    var nm = (typeof name === 'string') ? name.trim() : '';
    commit(function (doc) {
      doc.sections[id] = {
        name: { v: nm, t: stamp() },
        deleted: { v: false, t: stamp() },
        members: {}
      };
    });
    return id;
  }
  function renameSection(id, name) {
    var nm = (typeof name === 'string') ? name.trim() : '';
    commit(function (doc) {
      var s = doc.sections[id]; if (!s) return;
      s.name = { v: nm, t: stamp(s.name) };
    });
  }
  function deleteSection(id) {
    commit(function (doc) {
      var s = doc.sections[id]; if (!s) return;
      s.deleted = { v: true, t: stamp(s.deleted) };   // tombstone; members kept for merge safety
    });
  }
  function setMember(id, url, on) {
    var key = canon(url);
    commit(function (doc) {
      var s = doc.sections[id]; if (!s) return;
      if (!s.members) s.members = {};
      s.members[key] = { v: !!on, t: stamp(s.members[key]) };
    });
  }

  // ---------- Selectors (flat, tombstone-filtered) ----------
  function flatArticle(key, a) {
    a = a || {};
    return {
      url: key,
      title: a.title || '',
      date: a.date || dateFromKey(key),
      read: !!cellVal(a.read, false),
      rating: clampRating(cellVal(a.rating, 0)),
      note: cellVal(a.note, '') || '',
      tags: Array.isArray(cellVal(a.tags, [])) ? cellVal(a.tags, []) : [],
      archived: !!cellVal(a.archived, false)
    };
  }
  function get(url) {
    var key = canon(url);
    return flatArticle(key, getDoc().articles[key]);
  }
  function allArticles() {
    var doc = getDoc();
    return Object.keys(doc.articles).map(function (k) { return flatArticle(k, doc.articles[k]); });
  }
  function liveSections() {
    var doc = getDoc();
    var out = [];
    Object.keys(doc.sections).forEach(function (id) {
      var s = doc.sections[id];
      if (cellVal(s.deleted, false) === true) return;       // tombstoned
      var members = [];
      Object.keys(s.members || {}).forEach(function (mk) {
        if (cellVal(s.members[mk], false) === true) members.push(mk);
      });
      out.push({ id: id, name: cellVal(s.name, '') || '', members: members });
    });
    out.sort(function (x, y) { return x.name.localeCompare(y.name, 'fr'); });
    return out;
  }
  function sectionsForArticle(url) {
    var key = canon(url);
    return liveSections().filter(function (s) { return s.members.indexOf(key) !== -1; });
  }
  function customTagVocabulary() {
    var seen = Object.create(null);
    var out = [];
    allArticles().forEach(function (a) {
      a.tags.forEach(function (t) {
        var f = foldKey(t);
        if (!seen[f]) { seen[f] = 1; out.push(t); }
      });
    });
    out.sort(function (x, y) { return x.localeCompare(y, 'fr'); });
    return out;
  }
  function counts() {
    var rated = 0, rated4plus = 0, withNote = 0, archived = 0, tagged = 0, lib = 0;
    allArticles().forEach(function (a) {
      if (a.archived) { archived++; return; }            // archived excluded from positive counts
      var hasRating = a.rating >= 1;
      var hasNote = !!a.note;
      var hasTags = a.tags.length > 0;
      if (hasRating) rated++;
      if (a.rating >= 4) rated4plus++;
      if (hasNote) withNote++;
      if (hasTags) tagged++;
      if (hasRating || hasNote || hasTags) lib++;
    });
    // a section membership also counts toward the library
    var members = {};
    liveSections().forEach(function (s) { s.members.forEach(function (m) { members[m] = 1; }); });
    Object.keys(members).forEach(function (m) {
      var a = get(m);
      if (a.archived) return;
      if (!(a.rating >= 1 || a.note || a.tags.length)) lib++;   // member-only, not already counted
    });
    return {
      rated: rated, rated4plus: rated4plus, withNote: withNote,
      archived: archived, tagged: tagged, sections: liveSections().length, libCount: lib
    };
  }

  // ---------- Sync: token + status ----------
  function getToken() { try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; } }
  function setToken(t) {
    try { if (t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN); } catch (e) {}
    setStatus(getToken() ? { state: 'idle', msg: STR.idleConnected } : { state: 'local', msg: STR.local });
  }
  function hasToken() { return !!getToken(); }

  var STR = {
    local: 'Non synchronisé — données stockées sur cet appareil seulement.',
    idleConnected: 'Synchro active — à jour.',
    syncing: 'Synchronisation…',
    ok: 'Synchronisé ✓',
    upToDate: 'Synchro active — à jour.',
    badToken: 'Token invalide — reconnectez-vous.',
    network: 'Synchro indisponible (réseau).',
    suspended: 'Document distant illisible — synchro suspendue.'
  };

  var status = { state: getToken() ? 'idle' : 'local', msg: getToken() ? STR.idleConnected : STR.local };
  function setStatus(s) { status = s; notify(); }
  function getStatus() { return status; }

  // ---------- Sync: read-merge-write ----------
  var syncing = false;        // a syncNow() is in flight
  var pendingSync = false;    // a sync was requested while one was in flight → re-run after
  var writeGen = 0;           // increments on every local mutation (commit)

  function ghHeaders(extra) {
    var h = { 'Authorization': 'Bearer ' + getToken(), 'Accept': 'application/vnd.github+json' };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  // Parse the gist payload into a remote schema-2 doc, or {error:true} on
  // unreadable v2 content (so we NEVER push over an unreadable remote).
  function parseRemote(gist) {
    var files = gist && gist.files;
    var f = files && files[GIST_FILE];
    if (f) {
      if (f.truncated && f.raw_url) {
        return fetch(f.raw_url, { cache: 'no-store' })
          .then(function (r) { return r.text(); })
          .then(function (txt) {
            try { return normalize(JSON.parse(txt)); }
            catch (e) { return { error: true }; }
          })
          .catch(function () { return { error: true }; });
      }
      try { return Promise.resolve(normalize(JSON.parse(f.content))); }
      catch (e) { return Promise.resolve({ error: true }); }
    }
    // No v2 file yet → one-shot seed from the frozen v1 file (empty on the live gist).
    var v1 = files && files[GIST_FILE_V1];
    if (v1 && v1.content) {
      try { return Promise.resolve(seedFromV1Remote(JSON.parse(v1.content))); }
      catch (e) { return Promise.resolve(emptyDoc()); }
    }
    return Promise.resolve(emptyDoc());
  }

  function patchGist(doc, keepalive) {
    var body = { files: {} };
    body.files[GIST_FILE] = { content: JSON.stringify(doc) };
    return fetch(GH_API, {
      method: 'PATCH',
      headers: ghHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      keepalive: !!keepalive
    });
  }

  // GET → merge → save → PATCH-if-differs. The one sanctioned write path.
  function syncNow() {
    if (!getToken()) return Promise.resolve();
    if (syncing) { pendingSync = true; return Promise.resolve(); }   // re-run after the in-flight one
    syncing = true;
    setStatus({ state: 'syncing', msg: STR.syncing });
    return fetch(GH_API, { headers: ghHeaders(), cache: 'no-store' })
      .then(function (res) {
        if (res.status === 401) { setStatus({ state: 'error', msg: STR.badToken }); throw new Error('401'); }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (gist) { return parseRemote(gist); })
      .then(function (remote) {
        if (remote && remote.error) {
          setStatus({ state: 'suspended', msg: STR.suspended });   // never push over an unreadable remote
          return;
        }
        var local = readLocal() || emptyDoc();
        var genAtMerge = writeGen;                 // writes after this snapshot are NOT in `merged`
        var merged = mergeDocs(local, remote);
        writeLocal(merged);
        notify();
        // A write that landed during this sync is excluded from `merged`: keep it
        // dirty + reschedule, so the flush net (isDirty) and a follow-up push catch it.
        function settle(ok) {
          if (writeGen !== genAtMerge) schedulePush();
          else if (ok) setDirty(false);
        }
        var mergedJSON = JSON.stringify(stripVolatile(merged));
        var remoteJSON = JSON.stringify(stripVolatile(remote));
        if (mergedJSON !== remoteJSON) {
          return patchGist(merged).then(function (res) {
            if (res.status === 401) { setStatus({ state: 'error', msg: STR.badToken }); }
            else if (res.ok) { setStatus({ state: 'ok', msg: STR.ok }); settle(true); }
            else { setStatus({ state: 'error', msg: 'Échec de la synchro (HTTP ' + res.status + ').' }); settle(false); }
          });
        } else {
          setStatus({ state: 'idle', msg: STR.upToDate });
          settle(true);
        }
      })
      .catch(function (e) {
        if (String(e.message) !== '401') setStatus({ state: 'error', msg: STR.network });
      })
      .then(function () {
        syncing = false;
        if (pendingSync) { pendingSync = false; syncNow(); }       // a sync requested mid-flight
      });
  }

  // updatedAt is derived; exclude it from the differs-comparison.
  function stripVolatile(doc) {
    return { schema: doc.schema, meta: doc.meta, articles: doc.articles, sections: doc.sections };
  }

  var pushTimer = null;
  function schedulePush() {
    if (!getToken()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; syncNow(); }, PUSH_DELAY);
  }

  function pull() { return syncNow(); }
  function push(immediate) {
    if (immediate) { if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; } return syncNow(); }
    schedulePush();
    return Promise.resolve();
  }
  function disconnect() {
    setToken('');
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  }

  // Best-effort last-write on tab hide / pagehide (iOS tab-kill case, CF-5).
  // No GET — keepalive can't read a response; push the local doc as-is.
  // Honor the same invariant as syncNow: never push over an unreadable remote.
  function flush() {
    if (!getToken() || !isDirty() || status.state === 'suspended') return;
    try { patchGist(readLocal() || getDoc(), true); } catch (e) {}
  }

  // ---------- Cross-tab + lifecycle wiring ----------
  function onStorage(e) {
    if (!e) return;
    if (e.key === LS_DOC || e.key === null) { cache = null; notify(); }
  }
  if (window.addEventListener) {
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', function () { if (isDirty()) syncNow(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  // ---------- Public API ----------
  window.AIxPMStore = {
    // identity / keying
    canon: canon,
    dateFromKey: dateFromKey,
    // mutators
    setRead: setRead,
    setRating: setRating,
    setNote: setNote,
    setTags: setTags,
    setArchived: setArchived,
    touchMeta: touchMeta,
    createSection: createSection,
    renameSection: renameSection,
    deleteSection: deleteSection,
    setMember: setMember,
    // selectors
    get: get,
    allArticles: allArticles,
    liveSections: liveSections,
    sectionsForArticle: sectionsForArticle,
    customTagVocabulary: customTagVocabulary,
    counts: counts,
    // reactivity
    subscribe: subscribe,
    // sync
    pull: pull,
    push: push,
    flush: flush,
    hasToken: hasToken,
    getToken: getToken,
    setToken: setToken,
    disconnect: disconnect,
    getStatus: getStatus,
    // exposed for tests / advanced use
    _mergeDocs: mergeDocs,
    _emptyDoc: emptyDoc,
    _normalize: normalize
  };

  // Prime the doc (runs migration on first load) and pull once if connected.
  getDoc();
  if (getToken()) syncNow();
})();
