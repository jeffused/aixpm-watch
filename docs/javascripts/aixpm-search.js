/* AIxPM personal layer — unified search (v3 Session 4).
   Client-rendered page at /recherche/. No-ops everywhere else.

   Joins THREE data sources on the canonical article key (§4.1):
   1. Material's built search/search_index.json — title + full body text.
   2. site/aixpm-index.json — build manifest (date + L1/L2 + curated tags),
      emitted by hooks/categories.py.
   3. window.AIxPMStore flat selectors — ratings, notes, personal tags,
      sections, archived + read state.

   Matching is hand-rolled (no vendored lib): length-preserving French folding
   so folded indexOf positions slice the ORIGINAL string for <mark> snippets;
   AND semantics, substring, per-term best-field weighting (§4.3).

   XSS discipline (binding): every string that reaches the DOM — titles, body
   snippets, notes, personal tags, section names — goes via textContent /
   createTextNode. No innerHTML anywhere, including <mark> highlighting.

   Routing caution (S3 hotfix d7540a1): in-page History-API navigation fires no
   native popstate-only signal you can rely on, so we re-parse the query on
   BOTH document$ and Material's location$ (clicks + popstate), using the
   EMITTED url, never just document$. See UPGRADE-PRD-v3.md §4.3. */

(function () {
  'use strict';

  if (!window.AIxPMStore) { return; }
  var S = window.AIxPMStore;

  var INDEX_TTL = 3600000;     // refetch the index if older than 1 hour
  var RENDER_DEBOUNCE = 200;   // ms, per-keystroke
  var PAGE_SIZE = 30;          // incremental render block

  // ---------- Page guard + base path ----------
  function isSearchPage() { return /\/recherche\/?$/.test(location.pathname); }
  // Deployment base derived from the page's own pathname (never hardcode it):
  // '/aixpm-watch/' on GH Pages, '/' on a local serve.
  function basePrefix() { return location.pathname.replace(/recherche\/?$/, ''); }
  function keyFromLocation(loc) { return S.canon(basePrefix() + String(loc == null ? '' : loc)); }
  function articleHref(key) { return basePrefix() + String(key).replace(/^\//, ''); }

  // ---------- Length-preserving French fold (1 code unit -> 1 code unit) ----------
  // Distinct from the store's NFD foldKey (which is for matching only): here the
  // folded string MUST keep the same length as the original so indexOf positions
  // map straight back onto the original for snippet slicing + highlighting.
  var FOLD = (function () {
    var m = {};
    for (var c = 65; c <= 90; c++) m[String.fromCharCode(c)] = String.fromCharCode(c + 32); // A-Z -> a-z
    var groups = {
      a: 'àáâäãåÀÁÂÄÃÅæÆ',
      c: 'çÇ',
      e: 'èéêëÈÉÊË',
      i: 'ìíîïÌÍÎÏ',
      n: 'ñÑ',
      o: 'òóôöõÒÓÔÖÕœŒøØ',   // œ/Œ -> o special-cased (§4.3) to stay length-preserving
      u: 'ùúûüÙÚÛÜ',
      y: 'ýÿÝŸ'
    };
    Object.keys(groups).forEach(function (base) {
      for (var i = 0; i < groups[base].length; i++) m[groups[base].charAt(i)] = base;
    });
    return m;
  })();
  function fold(s) {
    s = String(s == null ? '' : s);
    var out = '';
    for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); out += (FOLD[ch] || ch); }
    return out;
  }

  // ---------- HTML strip + entity decode (regex + map, never innerHTML) ----------
  var ENT = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–',
    rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', eacute: 'é', egrave: 'è',
    agrave: 'à', ccedil: 'ç', ugrave: 'ù', acirc: 'â', ecirc: 'ê', icirc: 'î',
    ocirc: 'ô', ucirc: 'û', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', deg: '°',
    euro: '€', copy: '©', reg: '®', trade: '™'
  };
  function decodeEntities(s) {
    return String(s).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, function (whole, body) {
      if (body.charAt(0) === '#') {
        var code = (body.charAt(1) === 'x' || body.charAt(1) === 'X')
          ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (isFinite(code) && code > 0) { try { return String.fromCodePoint(code); } catch (e) { return whole; } }
        return whole;
      }
      var key = body.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENT, key) ? ENT[key] : whole;
    });
  }
  function cleanText(html) {
    var s = String(html == null ? '' : html);
    s = s.replace(/<[^>]+>/g, ' ');   // strip tags first
    s = decodeEntities(s);
    return s.replace(/\s+/g, ' ').trim();
  }

  // ---------- Build records (join index + manifest) ----------
  function buildRecords(searchIndex, manifest) {
    var byKey = {};
    (searchIndex.docs || []).forEach(function (doc) {
      var loc = doc.location || '';
      var hi = loc.indexOf('#');
      var base = hi === -1 ? loc : loc.slice(0, hi);
      var anchor = hi === -1 ? '' : loc.slice(hi + 1);
      if (!base) return;
      var isPost = /^\d{4}\/\d{2}\/\d{2}\/[^#]*$/.test(base);
      var isSynth = /^syntheses\/[^/]+\/$/.test(base);   // digest pages, not the bare index
      if (!isPost && !isSynth) return;

      var key = keyFromLocation(base);
      if (!byKey[key]) byKey[key] = { key: key, base: base, title: '', texts: [], synthese: isSynth };
      var rec = byKey[key];
      if (anchor === '') {
        rec.title = doc.title || rec.title;
        if (doc.text) rec.texts.push(cleanText(doc.text));
      } else if (anchor !== 'editor-notes' && anchor !== 'sources') {
        // Merge sub-section text (heading + body); skip editor-notes + #sources.
        var t = (doc.title ? doc.title + ' ' : '') + (doc.text || '');
        if (t.trim()) rec.texts.push(cleanText(t));
      }
    });

    var mfByKey = {};
    if (manifest && Array.isArray(manifest.posts)) {
      manifest.posts.forEach(function (p) { if (p && p.url) mfByKey[keyFromLocation(p.url)] = p; });
    }

    return Object.keys(byKey).map(function (key) {
      var b = byKey[key];
      var mf = mfByKey[key] || null;
      var body = b.texts.join(' ').replace(/\s+/g, ' ').trim();
      var rec = {
        key: key,
        title: b.title || (mf && mf.title) || b.base,
        body: body,
        date: mf ? (mf.date || '') : (S.dateFromKey(key) || ''),
        l1: mf ? (mf.l1 || null) : null,
        l2: mf ? (mf.l2 || null) : null,
        ctags: (mf && Array.isArray(mf.tags)) ? mf.tags : [],
        synthese: b.synthese
      };
      rec.fTitle = fold(rec.title);
      rec.fBody = fold(rec.body);
      rec.fCtags = rec.ctags.map(fold);
      return rec;
    });
  }

  // ---------- Matching ----------
  function isWordChar(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
  }
  function isWholeWordAt(folded, idx, len) {
    var before = idx === 0 ? '' : folded.charAt(idx - 1);
    var after = (idx + len >= folded.length) ? '' : folded.charAt(idx + len);
    return !isWordChar(before) && !isWordChar(after);
  }
  function fieldHit(folded, term) {
    var idx = folded.indexOf(term);
    if (idx === -1) return null;
    return { whole: isWholeWordAt(folded, idx, term.length) };
  }
  function arrHit(foldedArr, term) {
    var whole = false, found = false;
    for (var i = 0; i < foldedArr.length; i++) {
      var h = fieldHit(foldedArr[i], term);
      if (h) { found = true; if (h.whole) { whole = true; break; } }
    }
    return found ? { whole: whole } : null;
  }

  // Per term: best field weight (×1.5 if that field matched whole-word)
  // + 0.25 per extra field hit. AND semantics: a term that hits no field kills
  // the record. Field weights §4.3: title 10, note 8, tags 6, body 1.
  function evalRecord(rec, st, foldedTerms) {
    var fNote = fold(st.note || '');
    var fPtags = (st.tags || []).map(fold);
    var fields = [
      { kind: 'title', w: 10, f: rec.fTitle },
      { kind: 'note', w: 8, f: fNote },
      { kind: 'ctag', w: 6, arr: rec.fCtags },
      { kind: 'ptag', w: 6, arr: fPtags },
      { kind: 'body', w: 1, f: rec.fBody }
    ];
    var score = 0, hitNote = false, hitBody = false, hitTitle = false, hitTag = false;
    for (var t = 0; t < foldedTerms.length; t++) {
      var term = foldedTerms[t];
      if (!term) continue;
      var hitCount = 0, best = 0;
      for (var fi = 0; fi < fields.length; fi++) {
        var fld = fields[fi];
        var h = (fld.f != null) ? fieldHit(fld.f, term) : arrHit(fld.arr, term);
        if (!h) continue;
        hitCount++;
        var cand = fld.w * (h.whole ? 1.5 : 1);
        if (cand > best) best = cand;
        if (fld.kind === 'title') hitTitle = true;
        else if (fld.kind === 'note') hitNote = true;
        else if (fld.kind === 'body') hitBody = true;
        else hitTag = true;
      }
      if (hitCount === 0) return null;   // AND: term missed every field
      score += best + 0.25 * (hitCount - 1);
    }
    return { score: score, hitNote: hitNote, hitBody: hitBody, hitTitle: hitTitle, hitTag: hitTag };
  }

  // ---------- Snippet (positions valid on the original — same length as folded) ----------
  function firstMatch(folded, terms) {
    var best = -1;
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      if (!term) continue;
      var idx = folded.indexOf(term);
      if (idx !== -1 && (best === -1 || idx < best)) best = idx;
    }
    return best;
  }
  function snippetSegments(original, folded, terms, ctx, span) {
    ctx = (ctx == null) ? 60 : ctx;
    span = (span == null) ? 200 : span;
    original = String(original == null ? '' : original);
    var first = (terms && terms.length) ? firstMatch(folded, terms) : -1;
    var start, end;
    if (first === -1) { start = 0; end = Math.min(original.length, span); }
    else { start = Math.max(0, first - ctx); end = Math.min(original.length, start + span); }
    // Snap window edges off surrogate pairs so a slice never emits a lone
    // surrogate (would render as U+FFFD). Match offsets are ASCII-aligned, so
    // only the context window edges can land mid-pair.
    if (start > 0) { var sc = original.charCodeAt(start); if (sc >= 0xDC00 && sc <= 0xDFFF) start--; }
    if (end < original.length) { var ec = original.charCodeAt(end - 1); if (ec >= 0xD800 && ec <= 0xDBFF) end--; }

    var ranges = [];
    (terms || []).forEach(function (term) {
      if (!term) return;
      var from = start;
      while (from < end) {
        var idx = folded.indexOf(term, from);
        if (idx === -1 || idx >= end) break;
        ranges.push([idx, Math.min(idx + term.length, end)]);
        from = idx + term.length;
      }
    });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });

    var segs = [];
    if (start > 0) segs.push({ mark: false, ell: true, text: '… ' });
    var cursor = start;
    merged.forEach(function (r) {
      if (r[0] > cursor) segs.push({ mark: false, text: original.slice(cursor, r[0]) });
      segs.push({ mark: true, text: original.slice(r[0], r[1]) });
      cursor = r[1];
    });
    if (cursor < end) segs.push({ mark: false, text: original.slice(cursor, end) });
    if (end < original.length) segs.push({ mark: false, ell: true, text: ' …' });
    return segs;
  }
  function segmentsToDom(segs) {
    var frag = document.createDocumentFragment();
    segs.forEach(function (s) {
      if (s.mark) {
        var mk = document.createElement('mark');
        mk.textContent = s.text;
        frag.appendChild(mk);
      } else {
        frag.appendChild(document.createTextNode(s.text));
      }
    });
    return frag;
  }

  // ---------- URL state ----------
  function clampInt(v, lo, hi) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return 0;
    if (n < lo) n = lo; if (n > hi) n = hi;
    return n;
  }
  // NB: the free-text query rides in the `s` param, NOT `q`. Material reserves
  // `q` for its header search-share feature: a full load of /recherche/?q=…
  // would pop Material's own search overlay, steal focus, and strip `q` from the
  // URL — breaking the §4.3 bookmark/deep-link contract. (PRD §4.3 names `q`;
  // this is a deliberate, logged deviation — see §9.)
  function parseParams(search) {
    var p = new URLSearchParams(search || '');
    var lu = p.get('lu');
    return {
      q: p.get('s') || '',
      min: clampInt(p.get('min'), 0, 5),
      note: p.get('note') === '1',
      tagp: p.get('tagp') || '',
      sec: p.get('sec') || '',
      lu: (lu === 'non' || lu === 'lu') ? lu : '',
      arch: p.get('arch') === '1',
      cat: (p.get('cat') || '').split(',').filter(Boolean),
      pages: Math.max(1, clampInt(p.get('p'), 1, 999) || 1)
    };
  }
  function serializeParams(st) {
    var p = new URLSearchParams();
    if (st.q) p.set('s', st.q);     // `s`, not Material's reserved `q` (see parseParams)
    if (st.min >= 1) p.set('min', String(st.min));
    if (st.note) p.set('note', '1');
    if (st.tagp) p.set('tagp', st.tagp);
    if (st.sec) p.set('sec', st.sec);
    if (st.lu) p.set('lu', st.lu);
    if (st.arch) p.set('arch', '1');
    if (st.cat.length) p.set('cat', st.cat.join(','));
    if (st.pages > 1) p.set('p', String(st.pages));
    var s = p.toString();
    return s ? '?' + s : '';
  }

  // ---------- Module state ----------
  var L1_LABELS = ['AI-opportunites', 'AI-limites', 'AI-prerequis', 'AI-impacts'];
  var indexData = null;        // { error, loadedAt, records }
  var indexPromise = null;
  var state = defaultState();
  var period = 0;              // ephemeral (not in URL): 0 / 30 / 90 / 365 days
  var ui = null;               // built-DOM handles for the current mount
  var renderTimer = null;
  var subscribed = false;

  function defaultState() {
    return { q: '', min: 0, note: false, tagp: '', sec: '', lu: '', arch: false, cat: [], pages: 1 };
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function loadIndex() {
    if (indexData && (Date.now() - indexData.loadedAt) < INDEX_TTL) return Promise.resolve(indexData);
    if (indexPromise) return indexPromise;
    indexPromise = Promise.all([
      fetchJSON(basePrefix() + 'search/search_index.json'),
      fetchJSON(basePrefix() + 'aixpm-index.json').catch(function () { return null; })  // manifest optional
    ]).then(function (arr) {
      var si = arr[0];
      if (!si || !Array.isArray(si.docs)) indexData = { error: true, loadedAt: Date.now(), records: [] };
      else indexData = { error: false, loadedAt: Date.now(), records: buildRecords(si, arr[1]) };
      indexPromise = null;
      return indexData;
    }).catch(function () {
      indexData = { error: true, loadedAt: Date.now(), records: [] };
      indexPromise = null;
      return indexData;
    });
    return indexPromise;
  }

  // ---------- Query execution ----------
  function sectionMembers(id) {
    var s = S.liveSections().filter(function (x) { return x.id === id; })[0];
    return s ? s.members : [];
  }
  function passFilters(rec, st, secMembers) {
    if (!state.arch && st.archived) return false;
    if (state.min >= 1 && st.rating < state.min) return false;
    if (state.note && !st.note) return false;
    if (state.lu === 'non' && st.read) return false;
    if (state.lu === 'lu' && !st.read) return false;
    if (state.tagp) {
      var ft = fold(state.tagp);
      if (!(st.tags || []).some(function (t) { return fold(t) === ft; })) return false;
    }
    if (state.sec) { if (secMembers.indexOf(rec.key) === -1) return false; }
    if (state.cat.length) { if (!rec.l1 || state.cat.indexOf(rec.l1) === -1) return false; }
    if (period > 0) {
      if (!rec.date) return false;
      var cutoff = new Date(Date.now() - period * 86400000);
      var cs = cutoff.getFullYear() + '-' +
        ('0' + (cutoff.getMonth() + 1)).slice(-2) + '-' +
        ('0' + cutoff.getDate()).slice(-2);
      if (rec.date < cs) return false;
    }
    return true;
  }

  function runQuery() {
    if (!indexData || indexData.error) return { error: !!(indexData && indexData.error), results: [] };
    var foldedTerms = fold(state.q).split(/\s+/).filter(Boolean);
    var hasQuery = foldedTerms.length > 0;
    var secMembers = state.sec ? sectionMembers(state.sec) : [];
    var out = [];
    indexData.records.forEach(function (rec) {
      var st = S.get(rec.key);
      if (!passFilters(rec, st, secMembers)) return;
      if (hasQuery) {
        var ev = evalRecord(rec, st, foldedTerms);
        if (!ev) return;
        out.push({ rec: rec, st: st, score: ev.score, hitNote: ev.hitNote });
      } else {
        out.push({ rec: rec, st: st, score: 0, hitNote: false });
      }
    });
    out.sort(function (a, b) {
      if (hasQuery) {
        if (b.score !== a.score) return b.score - a.score;
        if (b.st.rating !== a.st.rating) return b.st.rating - a.st.rating;   // tie-break only
      }
      return (b.rec.date || '').localeCompare(a.rec.date || '');
    });
    return { error: false, results: out, hasQuery: hasQuery, terms: foldedTerms };
  }

  // ---------- DOM helpers ----------
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function txt(tag, cls, text) { var e = el(tag, cls); e.textContent = text; return e; }
  function frDate(d) {
    if (!d) return '';
    var p = String(d).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(d);
  }

  function staticStars(rating) {
    var span = el('span', 'aixpm-search-stars');
    span.setAttribute('aria-label', 'Note ' + rating + ' sur 5');
    for (var i = 1; i <= 5; i++) {
      var s = el('span', 'aixpm-search-star' + (i <= rating ? ' aixpm-search-star--on' : ''));
      s.textContent = i <= rating ? '★' : '☆';
      span.appendChild(s);
    }
    return span;
  }

  // ---------- Result card ----------
  function buildCard(item, terms) {
    var rec = item.rec, st = item.st;
    var card = el('article', 'aixpm-result');

    var head = el('div', 'aixpm-result__head');
    var a = el('a', 'aixpm-result__title');
    a.href = articleHref(rec.key);
    a.textContent = rec.title;
    head.appendChild(a);
    if (st.rating >= 1) head.appendChild(staticStars(st.rating));
    card.appendChild(head);

    var meta = el('div', 'aixpm-result__meta');
    if (rec.date) meta.appendChild(txt('span', 'aixpm-result__date', frDate(rec.date)));
    if (rec.synthese) meta.appendChild(txt('span', 'aixpm-result__badge', 'Synthèse'));
    if (rec.l1) meta.appendChild(txt('span', 'aixpm-result__cat', rec.l1 + (rec.l2 ? ' · ' + rec.l2 : '')));
    card.appendChild(meta);

    // Snippet: a note hit shows « Note perso — … » and outranks the body snippet.
    var snip = el('p', 'aixpm-result__snippet');
    if (item.hitNote && st.note) {
      snip.appendChild(txt('span', 'aixpm-result__snippet-label', 'Note perso — '));
      snip.appendChild(segmentsToDom(snippetSegments(st.note, fold(st.note), terms)));
    } else if (rec.body) {
      snip.appendChild(segmentsToDom(snippetSegments(rec.body, rec.fBody, terms)));
    }
    if (snip.childNodes.length) card.appendChild(snip);

    // Personal tags + section names
    var ptags = st.tags || [];
    var sections = S.sectionsForArticle(rec.key);
    if (ptags.length || sections.length) {
      var chips = el('div', 'aixpm-result__chips');
      ptags.forEach(function (t) { chips.appendChild(txt('span', 'aixpm-tag', t)); });
      sections.forEach(function (s) { chips.appendChild(txt('span', 'aixpm-section-chip', s.name || '(sans nom)')); });
      card.appendChild(chips);
    }
    return card;
  }

  // ---------- Render ----------
  function anyFilterActive() {
    return state.min >= 1 || state.note || !!state.tagp || !!state.sec ||
      !!state.lu || state.arch || state.cat.length > 0 || period > 0;
  }
  function storeHasPersonalData() {
    var c = S.counts();
    return (c.rated + c.withNote + c.tagged + c.archived + c.sections) > 0;
  }

  function renderResults() {
    if (!ui) return;
    var box = ui.results, statusEl = ui.status;
    box.textContent = '';
    statusEl.textContent = '';
    statusEl.classList.remove('aixpm-search-status--err');

    if (!indexData) { statusEl.textContent = 'Chargement de l’index…'; return; }
    if (indexData.error) {
      statusEl.textContent = 'Index de recherche illisible — vérifier la version Material.';
      statusEl.classList.add('aixpm-search-status--err');
      return;
    }

    var hasQuery = fold(state.q).split(/\s+/).filter(Boolean).length > 0;
    if (!hasQuery && !anyFilterActive()) {
      var hint = el('p', 'aixpm-search-hint');
      if (!storeHasPersonalData()) {
        hint.textContent = 'Tapez pour rechercher dans les articles. '
          + 'Notez, annotez et taguez des articles pour les retrouver ici par vos étoiles, vos notes et vos tags.';
      } else {
        hint.textContent = 'Tapez pour rechercher, ou utilisez les filtres ci-dessus.';
      }
      box.appendChild(hint);
      return;
    }

    var q = runQuery();
    var results = q.results;
    statusEl.textContent = results.length + (results.length === 1 ? ' résultat' : ' résultats');

    if (!results.length) { box.appendChild(txt('p', 'aixpm-search-hint', 'Aucun résultat.')); return; }

    var shown = Math.min(results.length, state.pages * PAGE_SIZE);
    for (var i = 0; i < shown; i++) box.appendChild(buildCard(results[i], q.terms || []));

    if (shown < results.length) {
      var more = el('button', 'aixpm-btn aixpm-search-more');
      more.type = 'button';
      more.textContent = 'Afficher plus';
      more.addEventListener('click', function () {
        state.pages += 1;
        pushUrl();
        renderResults();
      });
      box.appendChild(more);
    }
  }

  // ---------- Controls ----------
  function syncControls() {
    if (!ui) return;
    if (document.activeElement !== ui.input) ui.input.value = state.q;
    ui.min.value = String(state.min);
    ui.note.checked = state.note;
    ui.lu.value = state.lu;
    ui.arch.checked = state.arch;
    if (ui.tagp) ui.tagp.value = state.tagp;
    if (ui.sec) ui.sec.value = state.sec;
    ui.period.value = String(period);
    ui.catChips.forEach(function (b) {
      var on = state.cat.indexOf(b.dataset.l1) !== -1;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function refreshVocab() {
    if (!ui) return;
    // Personal tag <select>
    if (ui.tagp && document.activeElement !== ui.tagp) {
      var tags = S.customTagVocabulary();
      ui.tagp.textContent = '';
      ui.tagp.appendChild(optionEl('', 'Tag perso'));
      tags.forEach(function (t) { ui.tagp.appendChild(optionEl(t, t)); });
      ui.tagp.value = state.tagp;
    }
    // Section <select>
    if (ui.sec && document.activeElement !== ui.sec) {
      var secs = S.liveSections();
      ui.sec.textContent = '';
      ui.sec.appendChild(optionEl('', 'Section'));
      secs.forEach(function (s) { ui.sec.appendChild(optionEl(s.id, (s.name || '(sans nom)') + ' (' + s.members.length + ')')); });
      ui.sec.value = state.sec;
    }
  }
  function optionEl(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;          // textContent — section/tag names are personal data
    return o;
  }

  function commit(immediate) {
    state.pages = 1;
    pushUrl();
    if (immediate) renderResults();
    else {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(function () { renderTimer = null; renderResults(); }, RENDER_DEBOUNCE);
    }
  }
  function pushUrl() {
    try {
      var qs = serializeParams(state);
      history.replaceState(history.state, '', location.pathname + qs + location.hash);
    } catch (e) {}
  }

  function buildShell(mount) {
    mount.textContent = '';
    var wrap = el('div', 'aixpm-search');

    // Search box
    var input = document.createElement('input');
    input.type = 'search';
    input.className = 'aixpm-search-input';
    input.placeholder = 'Rechercher dans les articles et vos notes…';
    input.setAttribute('aria-label', 'Rechercher dans les articles et vos notes');
    input.autocomplete = 'off';
    input.addEventListener('input', function () { state.q = input.value; commit(false); });
    wrap.appendChild(input);

    // Filter bar
    var bar = el('div', 'aixpm-search-filters');

    var min = document.createElement('select');
    min.className = 'aixpm-search-select';
    min.setAttribute('aria-label', 'Note minimale');
    min.appendChild(optionEl('0', 'Note minimale'));
    ['1', '2', '3', '4', '5'].forEach(function (n) { min.appendChild(optionEl(n, '★ ' + n + '+')); });
    min.addEventListener('change', function () { state.min = clampInt(min.value, 0, 5); commit(true); });
    bar.appendChild(min);

    var noteLab = el('label', 'aixpm-search-check');
    var note = document.createElement('input'); note.type = 'checkbox';
    note.addEventListener('change', function () { state.note = note.checked; commit(true); });
    noteLab.appendChild(note); noteLab.appendChild(document.createTextNode(' Avec note'));
    bar.appendChild(noteLab);

    var lu = document.createElement('select');
    lu.className = 'aixpm-search-select';
    lu.setAttribute('aria-label', 'État de lecture');
    lu.appendChild(optionEl('', 'Tous'));
    lu.appendChild(optionEl('non', 'Non lus'));
    lu.appendChild(optionEl('lu', 'Lus'));
    lu.addEventListener('change', function () { state.lu = lu.value; commit(true); });
    bar.appendChild(lu);

    var tagp = document.createElement('select');
    tagp.className = 'aixpm-search-select';
    tagp.setAttribute('aria-label', 'Tag perso');
    tagp.addEventListener('change', function () { state.tagp = tagp.value; commit(true); });
    bar.appendChild(tagp);

    var sec = document.createElement('select');
    sec.className = 'aixpm-search-select';
    sec.setAttribute('aria-label', 'Section');
    sec.addEventListener('change', function () { state.sec = sec.value; commit(true); });
    bar.appendChild(sec);

    var per = document.createElement('select');
    per.className = 'aixpm-search-select';
    per.setAttribute('aria-label', 'Période');
    [['0', 'Toutes'], ['30', '30 j'], ['90', '3 mois'], ['365', '12 mois']].forEach(function (o) {
      per.appendChild(optionEl(o[0], o[1]));
    });
    per.addEventListener('change', function () { period = clampInt(per.value, 0, 100000); commit(true); });
    bar.appendChild(per);

    var archLab = el('label', 'aixpm-search-check');
    var arch = document.createElement('input'); arch.type = 'checkbox';
    arch.addEventListener('change', function () { state.arch = arch.checked; commit(true); });
    archLab.appendChild(arch); archLab.appendChild(document.createTextNode(' Inclure les archivés'));
    bar.appendChild(archLab);

    wrap.appendChild(bar);

    // L1 category chips (OR within)
    var chipsRow = el('div', 'aixpm-search-cats');
    var catChips = [];
    L1_LABELS.forEach(function (l1) {
      var b = el('button', 'aixpm-search-cat');
      b.type = 'button';
      b.dataset.l1 = l1;
      b.textContent = l1;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        var i = state.cat.indexOf(l1);
        if (i === -1) state.cat.push(l1); else state.cat.splice(i, 1);
        b.setAttribute('aria-pressed', i === -1 ? 'true' : 'false');
        commit(true);
      });
      catChips.push(b);
      chipsRow.appendChild(b);
    });
    wrap.appendChild(chipsRow);

    var status = el('div', 'aixpm-search-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    wrap.appendChild(status);

    var results = el('div', 'aixpm-search-results');
    wrap.appendChild(results);

    mount.appendChild(wrap);
    mount.dataset.aixpmSearchInit = '1';
    ui = {
      input: input, min: min, note: note, lu: lu, tagp: tagp, sec: sec,
      period: per, arch: arch, catChips: catChips, status: status, results: results
    };
    refreshVocab();
  }

  // A section/tag id from a deep-linked or bookmarked URL may reference something
  // since deleted (section tombstoned, tag removed from every article) — that
  // would filter to zero results while the <select> shows a blank placeholder
  // (no visibly-active filter). Drop stale refs and rewrite the URL so the page
  // falls back to a normal view instead of an unexplained empty one. Returns
  // true if anything was cleared.
  function reconcileStaleFilters() {
    var changed = false;
    if (state.sec && !S.liveSections().some(function (s) { return s.id === state.sec; })) {
      state.sec = ''; changed = true;
    }
    if (state.tagp) {
      var ft = fold(state.tagp);
      if (!S.customTagVocabulary().some(function (t) { return fold(t) === ft; })) { state.tagp = ''; changed = true; }
    }
    if (state.cat.length) {
      var kept = state.cat.filter(function (c) { return L1_LABELS.indexOf(c) !== -1; });
      if (kept.length !== state.cat.length) { state.cat = kept; changed = true; }
    }
    return changed;
  }

  // ---------- Apply URL → state → controls → results ----------
  function applyFromUrl(search) {
    state = parseParams(search != null ? search : location.search);
    if (reconcileStaleFilters()) pushUrl();
    refreshVocab();
    syncControls();
    renderResults();
  }

  // ---------- Page wiring ----------
  function onStoreChange() {
    if (!isSearchPage() || !ui) return;
    if (reconcileStaleFilters()) pushUrl();   // a just-deleted section/tag stops phantom-filtering
    refreshVocab();
    syncControls();
    renderResults();
  }

  function onPageReady() {
    if (!isSearchPage()) { ui = null; return; }
    var mount = document.querySelector('[data-aixpm-search]');
    if (!mount) return;
    if (mount.dataset.aixpmSearchInit !== '1' || !ui || ui.results !== mount.querySelector('.aixpm-search-results')) {
      buildShell(mount);
    }
    state = parseParams(location.search);
    period = 0;                       // ephemeral — resets per visit
    syncControls();
    renderResults();                  // shows « Chargement… » until index resolves
    loadIndex().then(function () {
      if (!isSearchPage()) return;
      refreshVocab();
      if (reconcileStaleFilters()) pushUrl();   // clear stale deep-linked section/tag
      syncControls();
      renderResults();
    });

    if (!subscribed) {
      subscribed = true;
      S.subscribe(onStoreChange);
      // Re-parse the query on Material's location$ (fed by clicks + popstate),
      // using the EMITTED url — in-page History-API nav fires no reliable native
      // event (S3 hotfix d7540a1). Fall back to popstate only when location$ is
      // absent, so we don't double-handle the back button under Material.
      if (typeof location$ !== 'undefined' && location$.subscribe) {
        location$.subscribe(function (u) {
          try { if (u && /\/recherche\/?$/.test(u.pathname)) applyFromUrl(u.search || ''); } catch (e) {}
        });
      } else {
        window.addEventListener('popstate', function () { if (isSearchPage()) applyFromUrl(location.search); });
      }
    }
  }

  // Exposed for tests (pure logic).
  window.AIxPMSearch = {
    _fold: fold,
    _cleanText: cleanText,
    _decodeEntities: decodeEntities,
    _evalRecord: evalRecord,
    _snippetSegments: snippetSegments,
    _firstMatch: firstMatch,
    _isWholeWordAt: isWholeWordAt,
    _parseParams: parseParams,
    _serializeParams: serializeParams,
    _buildRecords: buildRecords
  };

  if (typeof document$ !== 'undefined' && document$.subscribe) {
    document$.subscribe(onPageReady);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }
})();
