/* WildChat Structural-Agency Explorer
   Tabs over a static payload: Examples (search + paginate the published rows),
   Prompts (the action labelling prompt), Analysis (domains x actions heatmap),
   Rate 100 (label a fixed hidden-label set and score against the pipeline),
   Survey (human-agreement study: six annotators, three disjoint groups of 30, CSV export),
   Relabel (adjudicate the 619 residual rows from a local file),
   Upload (read a Rate-100 JSON export or a legacy verification JSONL back in).
   Non-English rows carry a stored English translation ("lang"/"tr"), shown
   under the original text wherever the row appears.

   index.json carries labels + the full user turn, so search and filtering are
   instant. Only the user turn is published; assistant responses are not part of
   the payload.

   The Examples tab pages through the published rows (meta.rows); the Analysis
   tab reports the whole experiment (meta.analysis), which is the population the
   paper's figures describe. */

const PAGE = 50;
const S = {
  index: [], meta: null, prompts: null,
  filtered: [], page: 0,
  q: '', domain: new Set(), action: new Set(),
};
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pretty = (s) => s.replace(/_/g, ' ');
const nf = (n) => n.toLocaleString('en-US');

/* ---------------- tabs ---------------- */
const TABS = ['examples', 'prompts', 'analysis', 'rate', 'survey', 'relabel', 'upload'];
for (const id of TABS) {
  document.getElementById('tab-' + id).addEventListener('click', () => {
    for (const other of TABS) {
      const on = other === id;
      document.getElementById('tab-' + other).setAttribute('aria-selected', String(on));
      document.getElementById('panel-' + other).hidden = !on;
    }
    if (id === 'analysis') drawAnalysis();
    if (id === 'prompts') ensurePrompts();
    if (id === 'rate') ensureRate();
    if (id === 'survey') ensureSurvey();
    if (id === 'relabel') ensureRelabel();
    if (id === 'upload') ensureUpload();
  });
}

/* ---------------- boot ---------------- */
(async function boot() {
  const [meta, index] = await Promise.all([
    fetch('data/meta.json').then((r) => r.json()),
    fetch('data/index.json').then((r) => r.json()),
  ]);
  S.meta = meta;
  S.index = index;
  for (const row of S.index) row._s = row.u.toLowerCase();

  $('#brandsub').textContent = `${nf(meta.rows)} conversations`;

  buildFacet('#f-domain', meta.domains, meta.domain_counts, S.domain);
  buildFacet('#f-action', meta.actions, meta.action_counts, S.action);

  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); S.page = 0; run(); }, 140);
  });
  $('#prev').addEventListener('click', () => { if (S.page > 0) { S.page--; render(); scrollTop(); } });
  $('#next').addEventListener('click', () => {
    if ((S.page + 1) * PAGE < S.filtered.length) { S.page++; render(); scrollTop(); }
  });
  $('#clear').addEventListener('click', () => {
    S.q = ''; $('#q').value = '';
    for (const set of [S.domain, S.action]) set.clear();
    document.querySelectorAll('.facet button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    S.page = 0; run();
  });

  run();
})();

const scrollTop = () => $('#main-examples').scrollTo({ top: 0, behavior: 'smooth' });

function buildFacet(sel, keys, counts, set) {
  const host = $(sel);
  host.innerHTML = '';
  for (const k of keys) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `${esc(pretty(k))}<span class="n">${nf(counts[k] || 0)}</span>`;
    b.addEventListener('click', () => {
      if (set.has(k)) { set.delete(k); b.setAttribute('aria-pressed', 'false'); }
      else { set.add(k); b.setAttribute('aria-pressed', 'true'); }
      S.page = 0; run();
    });
    host.appendChild(b);
  }
}

/* ---------------- filter + render ---------------- */
function run() {
  const q = S.q;
  S.filtered = S.index.filter((r) => {
    if (q && !r._s.includes(q)) return false;
    if (S.domain.size && !r.d.some((d) => S.domain.has(d))) return false;
    if (S.action.size && !r.a.some((a) => S.action.has(a))) return false;
    return true;
  });
  render();
}

function highlight(text, q) {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function render() {
  const total = S.filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  S.page = Math.min(S.page, pages - 1);
  const slice = S.filtered.slice(S.page * PAGE, S.page * PAGE + PAGE);

  $('#count').textContent = nf(total);
  $('#pageinfo').textContent = total ? `page ${S.page + 1} of ${nf(pages)}` : '';
  $('#prev').disabled = S.page === 0;
  $('#next').disabled = S.page >= pages - 1;

  const host = $('#results');
  if (!total) {
    host.innerHTML = '<div class="empty">No conversations match those filters.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const r of slice) {
    const el = document.createElement('article');
    el.className = 'card';
    const tags = [
      ...r.d.map((d) => `<span class="tag d">${esc(pretty(d))}</span>`),
      ...r.a.map((a) => `<span class="tag a">${esc(pretty(a))}</span>`),
    ].join('');
    el.innerHTML =
      `<div class="meta"><code>${esc(r.h)}</code><span>${esc(r.t)}</span>${tags}</div>
       <div class="utext">${highlight(r.u, S.q)}</div>` +
      (r.tr ? `<div class="rtrans"><b>Translation (${esc(r.lang)})</b>${esc(r.tr)}</div>` : '');
    frag.appendChild(el);
  }
  host.innerHTML = '';
  host.appendChild(frag);
}

/* ---------------- prompts ---------------- */
let promptsReady = false;
async function ensurePrompts() {
  if (promptsReady) return;
  promptsReady = true;
  S.prompts = await fetch('data/prompts.json').then((r) => r.json());
  const groups = [['actions', '#nav-actions']];
  let first = null;
  for (const [key, sel] of groups) {
    const host = $(sel);
    host.innerHTML = '';
    for (const p of S.prompts[key]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.title;
      b.addEventListener('click', () => showPrompt(key, p, b));
      host.appendChild(b);
      if (!first) first = [key, p, b];
    }
  }
  if (first) showPrompt(...first);
}

const SUBS = {
  actions: 'What the user asked the model to do — 7 codes, one or more per conversation, no upper cap. Judged BLIND by Claude Opus 4.8: only the user turn is shown, never the reply.',
};

function showPrompt(key, p, btn) {
  document.querySelectorAll('.navlist button').forEach((b) => b.removeAttribute('aria-current'));
  btn.setAttribute('aria-current', 'true');
  $('#p-title').textContent = p.title;
  $('#p-sub').textContent = SUBS[key] || '';
  $('#p-body').textContent = p.text;
}

/* ---------------- analysis ---------------- */
let analysisReady = false;
function drawAnalysis() {
  if (analysisReady) return;
  analysisReady = true;
  // Analysis reads the full-corpus counts. The Examples sidebar keeps using the
  // published counts, because a facet count there has to match the rows you can
  // actually open. Mixing the two would make the site contradict itself.
  const A = S.meta.analysis;
  const m = { ...S.meta, ...A };

  // Sequential single-hue ramp: magnitude is one variable, so one hue, light to dark.
  const ramp = ['#eef3f7', '#cfe0eb', '#a8c6db', '#7aa5c6', '#4c81ab', '#2e5c7e'];
  document.documentElement.style.setProperty('--h0', ramp[0]);
  document.documentElement.style.setProperty('--h5', ramp[5]);

  const rowMax = {};
  for (const d of m.domains) {
    rowMax[d] = Math.max(...m.actions.map((a) => (m.crosstab[`${d}|${a}`] || 0) / (m.domain_counts[d] || 1)));
  }
  const globalMax = Math.max(...Object.values(rowMax));
  $('#scalemax').textContent = Math.round(globalMax * 100) + '%';

  let html = '<thead><tr><th></th>' +
    m.actions.map((a) => `<th>${esc(pretty(a))}</th>`).join('') +
    '<th class="marg">rows</th></tr></thead><tbody>';
  for (const d of m.domains) {
    const denom = m.domain_counts[d] || 1;
    html += `<tr><th>${esc(pretty(d))}</th>`;
    for (const a of m.actions) {
      const n = m.crosstab[`${d}|${a}`] || 0;
      const share = n / denom;
      const idx = Math.min(ramp.length - 1, Math.floor((share / globalMax) * ramp.length));
      const dark = idx >= 4;
      html += `<td style="background:${ramp[idx]};color:${dark ? '#fff' : '#16191f'}"
                   title="${esc(pretty(d))} × ${esc(pretty(a))}: ${nf(n)} conversations">
                 ${nf(n)}<span class="pct">${(share * 100).toFixed(0)}%</span></td>`;
    }
    html += `<td class="marg">${nf(denom)}</td></tr>`;
  }
  html += '</tbody>';
  $('#heat').innerHTML = html;

  const top = [];
  for (const d of m.domains) {
    for (const a of m.actions) {
      const share = (m.crosstab[`${d}|${a}`] || 0) / (m.domain_counts[d] || 1);
      top.push([share, d, a]);
    }
  }
  top.sort((x, y) => y[0] - x[0]);
  $('#heatnote').innerHTML =
    `Cells are shaded by the share of that domain's rows, so a small domain is comparable ` +
    `to a large one. Strongest pairings: ` +
    top.slice(0, 3).map(([sh, d, a]) =>
      `<b>${esc(pretty(d))} → ${esc(pretty(a))}</b> (${(sh * 100).toFixed(0)}%)`).join(', ') + '.';

  bars('#bars-action', m.actions, m.action_counts, A.n);
  bars('#bars-domain', m.domains, S.meta.corpus_domain_counts, S.meta.corpus);

  $('#about').innerHTML =
    `<b>Domain bars cover all ${nf(S.meta.corpus)} post-adjudication conversations; ` +
    `action bars and the cross-tab cover the ${nf(A.n)} with valid action labels.</b> ` +
    `Domain labels are the final post-adjudication labels, including human assignments ` +
    `for recovered residual cases; action labels come from an ` +
    `independent Claude Opus 4.8 pass shown only the user turn, never the reply.`;
}

function bars(sel, keys, counts, total) {
  const host = $(sel);
  host.innerHTML = '';
  const max = Math.max(...keys.map((k) => counts[k] || 0));
  for (const k of keys) {
    const n = counts[k] || 0;
    const lab = document.createElement('div');
    lab.className = 'lab'; lab.textContent = pretty(k);
    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = (max ? (n / max) * 100 : 0) + '%';
    track.appendChild(fill);
    const val = document.createElement('div');
    val.className = 'val';
    val.textContent = `${nf(n)} · ${((n / total) * 100).toFixed(1)}%`;
    host.append(lab, track, val);
  }
}

/* Shared by the Upload tab: the confusion matrix and per-disagreement list for a
   set of yes/no answers compared against the stored labels. */
function reportHTML(rows) {
  const cell = (y, o) => rows.filter((r) => r.your_answer === y && r.opus_answer === o).length;
  const tp = cell('yes', 'yes'), fp = cell('yes', 'no');
  const fn = cell('no', 'yes'), tn = cell('no', 'no');
  const misses = rows.filter((r) => r.agree === false);

  return `
    <section>
      <h2>Against your judgment</h2>
      <table class="vconf">
        <thead><tr><th></th><th>Opus assigned</th><th>Opus rejected</th></tr></thead>
        <tbody>
          <tr><th>You would assign</th>
            <td class="hit">${tp}<span class="sub">agreed</span></td>
            <td class="miss">${fp}<span class="sub">Opus missed it</span></td></tr>
          <tr><th>You would reject</th>
            <td class="miss">${fn}<span class="sub">Opus over-assigned</span></td>
            <td class="hit">${tn}<span class="sub">agreed</span></td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Disagreements <span class="vn">${misses.length}</span></h2>
      <div class="vmisses">${misses.length
        ? misses.map((r) => `
          <article class="vmiss">
            <div class="vmeta">
              <span class="vfacet ${r.facet[0]}">${r.facet}</span>
              <b>${esc(pretty(r.code))}</b>
              <span class="verdict ${r.opus_answer === 'yes' ? 'over' : 'under'}">${
                r.opus_answer === 'yes'
                  ? 'Opus assigned it \u2014 you would not'
                  : 'you would assign it \u2014 Opus did not'}</span>
              <code>${esc(r.hash)}</code>
            </div>
            ${r.user_input ? `<div class="vtext short">${esc(r.user_input)}</div>` : ''}
          </article>`).join('')
        : '<div class="empty">No disagreements.</div>'}</div>
    </section>`;
}

/* ---------------- upload ----------------
   Load a verification JSONL (from an earlier rating round) and see it against the
   stored labels: confusion matrix plus the disagreement list. Conversation text is
   recovered by matching each record's hash against the published index, so files
   from any question set render. */

let uploadReady = false;
function ensureUpload() {
  if (uploadReady) return;
  uploadReady = true;
  drawDrop();
}

function drawDrop(error) {
  $('#u-root').innerHTML = `
    <div class="vhead"><h2>Upload results</h2></div>
    <p class="lede">
      Drop a <b>Rate-100 JSON export</b> (from the Rate&nbsp;100 tab — yours or someone
      else's) or a legacy verification JSONL. Nothing is uploaded anywhere — the file
      is read in your browser.
    </p>
    ${error ? `<div class="uerr">${esc(error)}</div>` : ''}
    <label class="drop" id="u-drop">
      <input type="file" id="u-file" accept=".jsonl,.ndjson,.json,.txt">
      <h3>Choose a file, or drop it here</h3>
      <p>rate100_vs_final_labels.json · legacy rate100_vs_opus.json · verification_*.jsonl</p>
    </label>`;

  const zone = $('#u-drop'), input = $('#u-file');
  input.addEventListener('change', () => { if (input.files[0]) readFile(input.files[0]); });
  for (const ev of ['dragenter', 'dragover']) {
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); });
  }
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });
}

function readFile(file) {
  const fr = new FileReader();
  fr.onerror = () => drawDrop('Could not read that file.');
  fr.onload = () => {
    try {
      const text = String(fr.result);
      // Rate-100 export: a single JSON object with an items array.
      if (text.trim().startsWith('{')) {
        let obj = null;
        try { obj = JSON.parse(text); } catch { obj = null; }
        if (obj && Array.isArray(obj.items) && obj.items.length) {
          drawRateFile(obj, file.name);
          return;
        }
      }
      drawUpload(parseAnswers(text), file.name);
    } catch (err) {
      drawDrop(err.message);
    }
  };
  fr.readAsText(file);
}

/* A Rate-100 JSON export, re-rendered: scores and matrices are recomputed from
   the item records rather than trusted from the file's own summary block. */
function drawRateFile(obj, filename) {
  // Accept both the corrected reference_* schema and older local exports.
  const items = obj.items.map((it) => ({
    ...it,
    reference_domains: it.reference_domains || it.opus_domains,
    reference_actions: it.reference_actions || it.opus_actions,
  })).filter((it) =>
    Array.isArray(it.your_domains) && Array.isArray(it.reference_domains) &&
    Array.isArray(it.your_actions) && Array.isArray(it.reference_actions));
  if (!items.length) { drawDrop('That file has no usable Rate-100 items.'); return; }
  const N = items.length;

  const facet = (labels, yk, ok) => {
    let exact = 0, overlap = 0, tp = 0, fp = 0, fn = 0, tn = 0;
    const per = [];
    for (const it of items) {
      const ys = new Set(it[yk]), t = new Set(it[ok]);
      const eq = ys.size === t.size && [...ys].every((l) => t.has(l));
      if (eq) exact++;
      if ([...ys].some((l) => t.has(l))) overlap++;
      for (const l of labels) {
        const a = ys.has(l), b = t.has(l);
        if (a && b) tp++; else if (a && !b) fp++;
        else if (!a && b) fn++; else tn++;
      }
      per.push(eq);
    }
    return { exact, overlap, tp, fp, fn, tn, per };
  };
  const dom = facet(S.meta.domains, 'your_domains', 'reference_domains');
  const act = facet(S.meta.actions, 'your_actions', 'reference_actions');
  const pct = (n) => ((n / N) * 100).toFixed(0) + '%';
  const chips = (list, other, cls) => list.map((l) =>
    `<span class="tag ${cls}${other.includes(l) ? '' : ' x'}">${esc(pretty(l))}</span>`).join('');
  const diffs = items.filter((_, i) => !(dom.per[i] && act.per[i]));

  $('#u-root').innerHTML = `
    <div class="ufile">
      <b>${esc(filename)}</b>
      <span>${N} items · Rate-100 export${obj.generated_at ? ` · ${esc(String(obj.generated_at).slice(0, 10))}` : ''}</span>
      <button type="button" id="u-clear">Load another</button>
    </div>
    <div class="rscore">
      <div class="box"><div class="big">${pct(dom.exact)}</div>
        <div class="lbl">domains: exact match (${dom.exact}/${N}); overlap ${pct(dom.overlap)}</div></div>
      <div class="box"><div class="big">${pct(act.exact)}</div>
        <div class="lbl">actions: exact match (${act.exact}/${N}); overlap ${pct(act.overlap)}</div></div>
    </div>
    <div class="rmats">${matrixHTML('Domains', dom)}${matrixHTML('Actions', act)}</div>
    <section><h2>Disagreements <span class="vn">${diffs.length}</span></h2>
      ${diffs.map((it) => `
        <article class="rrev">
          ${it.user_input ? `<div class="txt">${esc(it.user_input)}</div>` : ''}
          ${it.translation ? `<div class="rtrans"><b>Translation (${esc(it.language || '')})</b>${esc(it.translation)}</div>` : ''}
          <div class="who">Rater picked</div>
          <div>${chips(it.your_domains, it.reference_domains, 'd')}${chips(it.your_actions, it.reference_actions, 'a')}</div>
          <div class="who">Final reference labels</div>
          <div>${chips(it.reference_domains, it.your_domains, 'd')}${chips(it.reference_actions, it.your_actions, 'a')}</div>
        </article>`).join('') || '<div class="empty">Full agreement on every item.</div>'}
    </section>`;
  $('#u-clear').addEventListener('click', () => drawDrop());
}

/* Lenient by design: a row counts if it carries the fields the report needs, whether
   or not it is tagged record:"answer". Malformed lines are counted and reported
   rather than silently dropped — a file that half-parsed would otherwise produce a
   confident report over partial data. */
function parseAnswers(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) throw new Error('That file is empty.');

  const answers = [];
  let summary = null, bad = 0;
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { bad++; continue; }
    if (!o || typeof o !== 'object') { bad++; continue; }
    if (o.record === 'summary') { summary = o; continue; }
    const ok = o.facet && o.code && (o.your_answer === 'yes' || o.your_answer === 'no')
      && (o.opus_answer === 'yes' || o.opus_answer === 'no');
    if (!ok) { bad++; continue; }
    answers.push({
      item: o.item, hash: String(o.conversation_hash || ''), qid: o.qid || '',
      facet: o.facet, code: o.code,
      your_answer: o.your_answer, opus_answer: o.opus_answer,
      // Recompute rather than trust the file's own agree flag.
      agree: o.your_answer === o.opus_answer,
    });
  }
  if (!answers.length) {
    throw new Error(`No usable answer records found in ${lines.length} line(s). ` +
      'Expected a verification JSONL from a rating round.');
  }
  return { answers, summary, bad, lines: lines.length };
}

// The published index keys on a 10-char hash prefix; exported records carry 12.
let textByHash = null;
function conversationText(hash) {
  if (!textByHash) {
    textByHash = new Map();
    for (const r of S.index) textByHash.set(r.h, r.u);
  }
  return textByHash.get(String(hash).slice(0, 10)) || '';
}

function drawUpload(parsed, filename) {
  const rows = parsed.answers.map((r) => ({ ...r, user_input: conversationText(r.hash) }));
  const n = rows.length;
  const agree = rows.filter((r) => r.agree).length;
  const byFacet = ['action', 'request', 'domain']
    .map((f) => ({ f, r: rows.filter((x) => x.facet === f) }))
    .filter((x) => x.r.length);
  const resolved = rows.filter((r) => r.user_input).length;

  $('#u-root').innerHTML = `
    <div class="ufile">
      <b>${esc(filename)}</b>
      <span>${n} labels${parsed.summary?.set_id ? ` · set ${esc(parsed.summary.set_id)}` : ''}${
        parsed.summary?.completed_at ? ` · ${esc(String(parsed.summary.completed_at).slice(0, 10))}` : ''}</span>
      <button type="button" id="u-clear">Load another</button>
    </div>

    ${parsed.bad ? `<div class="uerr">${parsed.bad} of ${parsed.lines} line(s) could not be
      read as answer records and were skipped. The report below covers the ${n} that could.</div>` : ''}

    <div class="vscore">
      <div class="vbig">${((agree / n) * 100).toFixed(0)}<span>%</span></div>
      <div>
        <h2>Opus matched this rater on ${agree} of ${n} labels</h2>
        <p class="note">
          ${byFacet.map((x) =>
            `${x.f} ${x.r.filter((r) => r.agree).length}/${x.r.length}`).join(' · ')}
        </p>
      </div>
    </div>
    ${reportHTML(rows)}
    ${resolved < n ? `<p class="note">Conversation text shown for ${resolved} of ${n} labels;
      the rest are not in the published set.</p>` : ''}`;

  $('#u-clear').addEventListener('click', () => drawDrop());
}

/* ---------------- Rate 100 ----------------
   A fixed, seeded 100-conversation set with labels hidden. The visitor assigns
   domains (9 + other) and actions (6 + other), then sees agreement with the
   final post-adjudication reference labels: per-facet scores, label-level 2x2 confusion
   matrices, an item-by-item comparison view, and a JSON download. Everything is
   client-side; progress persists in localStorage. */

// Fixed historical RNG seed; this number is not a corpus-size constant.
const RATE_N = 100, RATE_SEED = 11997, RATE_LS = 'sa_rate_v1';
let rateReady = false;
const R = { items: [], cursor: 0, answers: new Map(), view: 'intro', revFilter: 'diff' };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rateItems() {
  // Deterministic: sort by hash, seeded shuffle, first 100. Same set for everyone.
  const rows = [...S.index].sort((x, y) => (x.h < y.h ? -1 : 1));
  const rnd = mulberry32(RATE_SEED);
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows.slice(0, RATE_N);
}

function ensureRate() {
  if (!rateReady) {
    rateReady = true;
    R.items = rateItems();
    try {
      const saved = JSON.parse(localStorage.getItem(RATE_LS) || 'null');
      if (saved && saved.answers) {
        for (const it of R.items) {
          const a = saved.answers[it.h];
          if (a) R.answers.set(it.h, { d: new Set(a.d), a: new Set(a.a) });
        }
        R.cursor = Math.min(saved.cursor || 0, RATE_N - 1);
        if (R.answers.size >= RATE_N) R.view = 'results';
        else if (R.answers.size) R.view = 'item';
      }
    } catch { /* fresh start */ }
  }
  drawRate();
}

function saveRate() {
  const answers = {};
  for (const [h, v] of R.answers) answers[h] = { d: [...v.d], a: [...v.a] };
  localStorage.setItem(RATE_LS, JSON.stringify({ answers, cursor: R.cursor }));
}

function drawRate() {
  const host = $('#r-root');
  if (R.view === 'intro') return drawRateIntro(host);
  if (R.view === 'item') return drawRateItem(host);
  if (R.view === 'results') return drawRateResults(host);
  if (R.view === 'review') return drawRateReview(host);
}

function drawRateIntro(host) {
  const done = R.answers.size;
  host.innerHTML = `<div class="rwrap">
    <h2>Rate 100 conversations yourself</h2>
    <p class="lede">You will see the same fixed set of 100 published conversations with their
      labels hidden. For each one, pick every domain that applies (or <b>other</b> if none do)
      and every action (or <b>other</b>). At the end you will see how your judgments compare
      with the final post-adjudication reference labels, including 2×2 confusion matrices,
      an item-by-item comparison, and a downloadable JSON of your answers.</p>
    <p class="rnote">Nothing is uploaded anywhere; your progress is saved in this browser only.</p>
    <div class="rnav">
      <button class="primary" id="r-start">${done ? `Resume (${done}/${RATE_N} done)` : 'Start'}</button>
      ${done ? '<button id="r-reset">Start over</button>' : ''}
    </div>
  </div>`;
  $('#r-start').addEventListener('click', () => { R.view = 'item'; drawRate(); });
  const rs = $('#r-reset');
  if (rs) rs.addEventListener('click', rateReset);
}

function rateReset() {
  R.answers.clear(); R.cursor = 0; R.view = 'intro';
  localStorage.removeItem(RATE_LS);
  drawRate();
}

function toggleLabel(set, label) {
  // `other` means "none of the listed ones fit" in both facets, so it never combines.
  if (label === 'other') {
    if (set.has('other')) set.delete('other');
    else { set.clear(); set.add('other'); }
  } else {
    set.delete('other');
    if (set.has(label)) set.delete(label); else set.add(label);
  }
}

function drawRateItem(host) {
  const it = R.items[R.cursor];
  if (!R.answers.has(it.h)) R.answers.set(it.h, { d: new Set(), a: new Set() });
  const ans = R.answers.get(it.h);

  const chiprow = (cls, labels, set) => `<div class="rchips ${cls}">` +
    labels.map((l) =>
      `<button type="button" data-l="${l}" aria-pressed="${set.has(l)}">${esc(pretty(l))}</button>`
    ).join('') + '</div>';

  host.innerHTML = `<div class="rwrap">
    <div class="resbar"><span><b>${R.cursor + 1}</b> of ${RATE_N}</span>
      <span>${R.answers.size} answered</span></div>
    <div class="rprog"><i style="width:${(R.cursor / RATE_N) * 100}%"></i></div>
    <div class="rtext">${esc(it.u)}</div>
    ${it.tr ? `<div class="rtrans"><b>Translation (${esc(it.lang)})</b>${esc(it.tr)}</div>` : ''}
    <div class="rgroup"><h3>Domains — pick every one that applies</h3>
      ${chiprow('dd', S.meta.domains, ans.d)}</div>
    <div class="rgroup"><h3>Actions — what did the user ask the model to do?</h3>
      ${chiprow('aa', S.meta.actions, ans.a)}</div>
    <div class="rnav">
      <button id="r-back" ${R.cursor === 0 ? 'disabled' : ''}>&larr; Back</button>
      <button class="primary" id="r-next" ${ans.d.size && ans.a.size ? '' : 'disabled'}>
        ${R.cursor === RATE_N - 1 ? 'Finish' : 'Next →'}</button>
      <span class="rnote">pick at least one in each group · <b>other</b> stands alone</span>
    </div>
  </div>`;

  host.querySelectorAll('.rchips.dd button').forEach((b) =>
    b.addEventListener('click', () => { toggleLabel(ans.d, b.dataset.l); saveRate(); drawRate(); }));
  host.querySelectorAll('.rchips.aa button').forEach((b) =>
    b.addEventListener('click', () => { toggleLabel(ans.a, b.dataset.l); saveRate(); drawRate(); }));
  $('#r-back').addEventListener('click', () => { R.cursor--; saveRate(); drawRate(); });
  $('#r-next').addEventListener('click', () => {
    if (R.cursor === RATE_N - 1) { R.view = 'results'; }
    else R.cursor++;
    saveRate(); drawRate();
  });
}

/* Scores + label-level 2x2 per facet. Reference = final labels in the index.
   Domains include human assignments for residual cases; actions come from Opus 4.8. */
function rateReport() {
  const facet = (labels, yours, truth) => {
    let exact = 0, overlap = 0, tp = 0, fp = 0, fn = 0, tn = 0;
    const per = [];
    for (const it of R.items) {
      const y = yours(it), t = new Set(truth(it));
      const ys = new Set(y);
      const eq = ys.size === t.size && [...ys].every((l) => t.has(l));
      const ov = [...ys].some((l) => t.has(l));
      if (eq) exact++;
      if (ov) overlap++;
      for (const l of labels) {
        const a = ys.has(l), b = t.has(l);
        if (a && b) tp++; else if (a && !b) fp++;
        else if (!a && b) fn++; else tn++;
      }
      per.push({ hash: it.h, eq, yours: [...ys], opus: [...t] });
    }
    return { exact, overlap, tp, fp, fn, tn, per };
  };
  const dTruth = (it) => it.d;
  const aTruth = (it) => it.a;
  return {
    domain: facet(S.meta.domains, (it) => R.answers.get(it.h).d, dTruth),
    action: facet(S.meta.actions, (it) => R.answers.get(it.h).a, aTruth),
  };
}

function matrixHTML(name, m) {
  return `<div><h3>${name} — label-level 2×2</h3>
    <table class="vconf">
      <thead><tr><th></th><th>Reference includes</th><th>Reference does not</th></tr></thead>
      <tbody>
        <tr><th>You assigned</th>
          <td class="hit">${nf(m.tp)}<span class="sub">agreed yes</span></td>
          <td class="miss">${nf(m.fp)}<span class="sub">you only</span></td></tr>
        <tr><th>You did not</th>
          <td class="miss">${nf(m.fn)}<span class="sub">reference only</span></td>
          <td class="hit">${nf(m.tn)}<span class="sub">agreed no</span></td></tr>
      </tbody>
    </table></div>`;
}

function drawRateResults(host) {
  const rep = rateReport();
  const pct = (n) => ((n / RATE_N) * 100).toFixed(0) + '%';
  host.innerHTML = `<div class="rwrap">
    <h2>Your 100 vs the final reference labels</h2>
    <div class="rscore">
      <div class="box"><div class="big">${pct(rep.domain.exact)}</div>
        <div class="lbl">domains: exact set match (${rep.domain.exact}/${RATE_N}); any overlap ${pct(rep.domain.overlap)}</div></div>
      <div class="box"><div class="big">${pct(rep.action.exact)}</div>
        <div class="lbl">actions: exact set match (${rep.action.exact}/${RATE_N}); any overlap ${pct(rep.action.overlap)}</div></div>
    </div>
    <div class="rmats">${matrixHTML('Domains', rep.domain)}${matrixHTML('Actions', rep.action)}</div>
    <p class="rnote">Matrix cells count label-level decisions: ${RATE_N}×${S.meta.domains.length}
      for domains, ${RATE_N}×${S.meta.actions.length} for actions.</p>
    <div class="rnav">
      <button class="primary" id="r-compare">Compare your results</button>
      <button id="r-download">Download JSON</button>
      <button id="r-again">Start over</button>
    </div>
  </div>`;
  $('#r-compare').addEventListener('click', () => { R.view = 'review'; drawRate(); });
  $('#r-download').addEventListener('click', () => rateDownload(rep));
  $('#r-again').addEventListener('click', rateReset);
}

function rateDownload(rep) {
  const items = R.items.map((it) => {
    const a = R.answers.get(it.h);
    const rec = {
      conversation_hash: it.h,
      user_input: it.u,
      your_domains: [...a.d], reference_domains: it.d,
      your_actions: [...a.a], reference_actions: it.a,
    };
    if (it.tr) { rec.language = it.lang; rec.translation = it.tr; }
    return rec;
  });
  const out = {
    generated_at: new Date().toISOString(),
    set: { seed: RATE_SEED, n: RATE_N, source: 'published rows, seeded shuffle' },
    summary: {
      domains: { exact: rep.domain.exact, overlap: rep.domain.overlap,
                 matrix: { both_yes: rep.domain.tp, you_only: rep.domain.fp, reference_only: rep.domain.fn, both_no: rep.domain.tn } },
      actions: { exact: rep.action.exact, overlap: rep.action.overlap,
                 matrix: { both_yes: rep.action.tp, you_only: rep.action.fp, reference_only: rep.action.fn, both_no: rep.action.tn } },
    },
    items,
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rate100_vs_final_labels.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function drawRateReview(host) {
  const rep = rateReport();
  const rows = R.items.map((it, i) => {
    const d = rep.domain.per[i], a = rep.action.per[i];
    return { it, d, a, diff: !(d.eq && a.eq) };
  });
  const shown = R.revFilter === 'diff' ? rows.filter((r) => r.diff) : rows;

  const chips = (labels, mine, theirs) => labels.map((l) => {
    const cls = theirs.includes(l) ? '' : ' x';
    return `<span class="tag d${cls}">${esc(pretty(l))}</span>`;
  }).join('');
  const chipsA = (labels, theirs) => labels.map((l) => {
    const cls = theirs.includes(l) ? '' : ' x';
    return `<span class="tag a${cls}">${esc(pretty(l))}</span>`;
  }).join('');

  host.innerHTML = `<div class="rwrap">
    <div class="resbar">
      <span><b>${shown.length}</b> of ${RATE_N} shown</span>
      <span>
        <button id="r-fdiff" ${R.revFilter === 'diff' ? 'disabled' : ''}>Disagreements</button>
        <button id="r-fall"  ${R.revFilter === 'all' ? 'disabled' : ''}>All 100</button>
        <button id="r-backres">&larr; Back to results</button>
      </span>
    </div>
    ${shown.map(({ it, d, a }) => `
      <article class="rrev">
        <div class="txt">${esc(it.u)}</div>
        ${it.tr ? `<div class="rtrans"><b>Translation (${esc(it.lang)})</b>${esc(it.tr)}</div>` : ''}
        <div class="who">You picked ${d.eq && a.eq ? '<span class="rok">— full agreement</span>' : ''}</div>
        <div>${chips(d.yours, d.yours, d.opus)}${chipsA(a.yours, a.opus)}</div>
        <div class="who">Final reference labels</div>
        <div>${chips(d.opus, d.opus, d.yours)}${chipsA(a.opus, a.yours)}</div>
      </article>`).join('') || '<div class="empty">Nothing to show.</div>'}
  </div>`;
  $('#r-fdiff').addEventListener('click', () => { R.revFilter = 'diff'; drawRate(); });
  $('#r-fall').addEventListener('click', () => { R.revFilter = 'all'; drawRate(); });
  $('#r-backres').addEventListener('click', () => { R.view = 'results'; drawRate(); });
}

/* ---------------- Relabel (local file, never uploaded) ----------------
   Manual adjudication of the 619 raw automated residual candidates. The rows
   are PII-mixed, so they are NOT bundled with the public site: the labeler
   loads sa_dataset_other619.csv from disk, everything stays in the browser,
   and progress persists in localStorage. Export = CSV. */

const RL_LS = 'sa_relabel_v1';
let relabelReady = false;
const RL = { items: [], cursor: 0, answers: new Map(), view: 'drop' };

function ensureRelabel() {
  if (!relabelReady) {
    relabelReady = true;
    try {
      const saved = JSON.parse(localStorage.getItem(RL_LS) || 'null');
      if (saved && saved.items && saved.items.length) {
        RL.items = saved.items;
        RL.cursor = Math.min(saved.cursor || 0, saved.items.length - 1);
        RL.answers = new Map(Object.entries(saved.answers || {}).map(([k, v]) => [k, new Set(v)]));
        RL.view = 'label';
      }
    } catch (e) { /* fresh start */ }
  }
  drawRelabel();
}

function saveRelabel() {
  const answers = {};
  for (const [k, v] of RL.answers) answers[k] = [...v];
  try {
    localStorage.setItem(RL_LS, JSON.stringify({ items: RL.items, answers, cursor: RL.cursor }));
  } catch (e) { /* storage full/blocked: keep going in-memory */ }
}

/* CSV parser that survives quoted multiline fields. */
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function relabelLoad(file) {
  const fr = new FileReader();
  fr.onerror = () => drawRelabelDrop('Could not read that file.');
  fr.onload = () => {
    const text = fr.result;
    let items = [];
    try {
      if (/^\s*\{/.test(text)) {                      // jsonl of {user_input}
        items = text.split('\n').filter((l) => l.trim())
          .map((l, i) => ({ id: 'row' + (i + 1), u: JSON.parse(l).user_input }));
      } else {                                         // csv with header
        const rows = parseCSV(text);
        const head = rows[0].map((s) => s.trim().toLowerCase());
        const hi = head.indexOf('conversation_hash'), ui = head.indexOf('user_input');
        if (ui < 0) throw new Error('no user_input column');
        items = rows.slice(1).map((r, i) => ({ id: hi >= 0 ? r[hi] : 'row' + (i + 1), u: r[ui] }));
      }
    } catch (e) {
      return drawRelabelDrop('Could not parse that file: ' + e.message);
    }
    if (!items.length) return drawRelabelDrop('No rows found in that file.');
    RL.items = items; RL.cursor = 0; RL.answers = new Map(); RL.view = 'label';
    saveRelabel(); drawRelabel();
  };
  fr.readAsText(file);
}

function drawRelabelDrop(error) {
  $('#rl-root').innerHTML = `
    <div class="vhead"><h2>Relabel the residual</h2></div>
    <p class="lede">
      Adjudicate the 619 raw automated residual candidates. Load your local
      <code>sa_dataset_other619.csv</code> — the file is read <b>in your browser only</b>,
      nothing is uploaded or published. Pick the domains that apply, or <b>other</b>
      (structural agency, but no domain fits), or <b>Not SA</b>. Progress is saved in
      this browser; export a CSV when done.
    </p>
    ${error ? `<div class="uerr">${esc(error)}</div>` : ''}
    <label class="drop" id="rl-drop">
      <input type="file" id="rl-file" accept=".csv,.jsonl,.ndjson,.txt">
      <h3>Choose the file, or drop it here</h3>
      <p>sa_dataset_other619.csv · sa_dataset_other619_annotation.jsonl</p>
    </label>`;
  const zone = $('#rl-drop'), input = $('#rl-file');
  input.addEventListener('change', () => { if (input.files[0]) relabelLoad(input.files[0]); });
  for (const ev of ['dragenter', 'dragover'])
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
  for (const ev of ['dragleave', 'drop'])
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); });
  zone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) relabelLoad(f); });
}

function rlToggle(set, label) {
  // domains multi-select; `other` and `not_sa` each stand alone
  if (label === 'other' || label === 'not_sa') {
    if (set.has(label)) set.delete(label);
    else { set.clear(); set.add(label); }
  } else {
    set.delete('other'); set.delete('not_sa');
    if (set.has(label)) set.delete(label); else set.add(label);
  }
}

function relabelCSV() {
  const lines = ['conversation_hash,labels'];
  for (const it of RL.items) {
    const ans = RL.answers.get(it.id);
    lines.push(`${it.id},${ans && ans.size ? [...ans].join('|') : ''}`);
  }
  return lines.join('\n') + '\n';
}

function drawRelabel() {
  const host = $('#rl-root');
  if (RL.view === 'drop' || !RL.items.length) return drawRelabelDrop();
  if (RL.view === 'done') return drawRelabelDone(host);

  const it = RL.items[RL.cursor];
  if (!RL.answers.has(it.id)) RL.answers.set(it.id, new Set());
  const ans = RL.answers.get(it.id);
  const N = RL.items.length;
  const domains = S.meta.domains.filter((d) => d !== 'other');
  const answered = [...RL.answers.values()].filter((s) => s.size).length;

  host.innerHTML = `<div class="rwrap">
    <div class="resbar"><span><b>${RL.cursor + 1}</b> of ${N}</span>
      <span>${answered} labelled</span>
      <span class="pager">
        <button id="rl-export">Download CSV</button>
        <button id="rl-reset">Start over</button>
      </span></div>
    <div class="rprog"><i style="width:${(answered / N) * 100}%"></i></div>
    <div class="rtext">${esc(it.u)}</div>
    <div class="rgroup"><h3>Domains — pick every one that applies</h3>
      <div class="rchips dd">${domains.map((l) =>
        `<button type="button" data-l="${l}" aria-pressed="${ans.has(l)}">${esc(pretty(l))}</button>`).join('')}
      </div></div>
    <div class="rgroup"><h3>Or:</h3>
      <div class="rchips nn">
        <button type="button" data-l="other" aria-pressed="${ans.has('other')}">other (SA, no domain fits)</button>
        <button type="button" data-l="not_sa" class="notsa" aria-pressed="${ans.has('not_sa')}">Not SA</button>
      </div></div>
    <div class="rnav">
      <button id="rl-back" ${RL.cursor === 0 ? 'disabled' : ''}>&larr; Back</button>
      <button class="primary" id="rl-next" ${ans.size ? '' : 'disabled'}>
        ${RL.cursor === N - 1 ? 'Finish' : 'Next →'}</button>
      <span class="rnote"><b>other</b> and <b>Not SA</b> stand alone</span>
    </div>
  </div>`;

  host.querySelectorAll('.rchips button').forEach((b) =>
    b.addEventListener('click', () => { rlToggle(ans, b.dataset.l); saveRelabel(); drawRelabel(); }));
  $('#rl-back').addEventListener('click', () => { RL.cursor--; saveRelabel(); drawRelabel(); });
  $('#rl-next').addEventListener('click', () => {
    if (RL.cursor === RL.items.length - 1) RL.view = 'done';
    else RL.cursor++;
    saveRelabel(); drawRelabel();
  });
  $('#rl-export').addEventListener('click', relabelDownload);
  $('#rl-reset').addEventListener('click', () => {
    if (!confirm('Discard all relabel progress?')) return;
    localStorage.removeItem(RL_LS);
    RL.items = []; RL.answers = new Map(); RL.cursor = 0; RL.view = 'drop';
    drawRelabel();
  });
}

function relabelDownload() {
  const blob = new Blob([relabelCSV()], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'other619_relabelled.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function drawRelabelDone(host) {
  const counts = new Map();
  let unlabelled = 0;
  for (const it of RL.items) {
    const ans = RL.answers.get(it.id);
    if (!ans || !ans.size) { unlabelled++; continue; }
    for (const l of ans) counts.set(l, (counts.get(l) || 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  host.innerHTML = `<div class="rwrap">
    <div class="vhead"><h2>Relabel complete</h2></div>
    <p class="lede">${RL.items.length - unlabelled} of ${RL.items.length} conversations labelled${
      unlabelled ? ` — <b>${unlabelled} still unlabelled</b> (use Review to finish them)` : ''}.</p>
    <div class="bars">${rows.map(([l, n]) => `
      <div class="bar"><span class="blabel">${esc(pretty(l))}</span>
        <span class="btrack"><i style="width:${(n / max) * 100}%"></i></span>
        <span class="bval">${n}</span></div>`).join('')}
    </div>
    <div class="rnav">
      <button class="primary" id="rl-dl">Download CSV</button>
      <button id="rl-review">&larr; Review / keep editing</button>
    </div>
  </div>`;
  $('#rl-dl').addEventListener('click', relabelDownload);
  $('#rl-review').addEventListener('click', () => { RL.view = 'label'; RL.cursor = 0; drawRelabel(); });
}

/* ---------------- Survey (human agreement) ----------------
   Six annotators (A1-A6) label three disjoint groups of published
   conversations, one independent pair per group (A1+A2 -> group 1,
   A3+A4 -> group 2, A5+A6 -> group 3), mirroring EUDAIMONIA
   (arXiv:2605.30654, Appendix F.1). Items and the pipeline's own definitions
   come from data/survey_items.json, which carries NO pipeline labels.
   Answers stay in this browser (localStorage, per annotator) until the
   annotator downloads the CSV and sends it to the study lead. */

const SV_LS = 'sa_survey_v1';
let surveyLoading = null;
const SV = { data: null, annotator: null, group: null, items: [], cursor: 0, answers: new Map(), view: 'intro' };

async function ensureSurvey() {
  if (!SV.data) {
    if (!surveyLoading) surveyLoading = fetch('data/survey_items.json').then((r) => r.json());
    try { SV.data = await surveyLoading; }
    catch (e) {
      surveyLoading = null;
      $('#sv-root').innerHTML = '<div class="empty">Could not load data/survey_items.json.</div>';
      return;
    }
  }
  drawSurvey();
}

const svGroupOf = (a) => Object.keys(SV.data.groups).find((g) => SV.data.groups[g].annotators.includes(a));
const svKey = (a) => `${SV_LS}:${a}`;
const svDone = (ans) => !!ans && (ans.sa === 'no' || (ans.sa === 'yes' && ans.d.size > 0 && ans.a.size > 0));

function svSavedCount(a) {
  try {
    const saved = JSON.parse(localStorage.getItem(svKey(a)) || 'null');
    if (!saved || !saved.answers) return 0;
    return Object.values(saved.answers)
      .filter((v) => v.sa === 'no' || (v.sa === 'yes' && (v.d || []).length && (v.a || []).length)).length;
  } catch (e) { return 0; }
}

function svSelect(a) {
  SV.annotator = a; SV.group = svGroupOf(a);
  SV.items = SV.data.groups[SV.group].items.map((h) => ({ h, ...SV.data.items[h] }));
  SV.answers = new Map(); SV.cursor = 0; SV.view = 'item';
  try {
    const saved = JSON.parse(localStorage.getItem(svKey(a)) || 'null');
    if (saved && saved.answers) {
      for (const it of SV.items) {
        const v = saved.answers[it.h];
        if (v) SV.answers.set(it.h, { sa: v.sa || null, d: new Set(v.d || []), a: new Set(v.a || []), note: v.note || '', t: v.t || '' });
      }
      SV.cursor = Math.min(saved.cursor || 0, SV.items.length - 1);
      if (SV.items.every((it) => svDone(SV.answers.get(it.h)))) SV.view = 'done';
    }
  } catch (e) { /* fresh start */ }
  drawSurvey();
}

function saveSurvey() {
  if (!SV.annotator) return;
  const answers = {};
  for (const [h, v] of SV.answers) answers[h] = { sa: v.sa, d: [...v.d], a: [...v.a], note: v.note, t: v.t };
  try {
    localStorage.setItem(svKey(SV.annotator),
      JSON.stringify({ annotator: SV.annotator, group: SV.group, answers, cursor: SV.cursor }));
  } catch (e) { /* storage blocked: keep going in-memory */ }
}

function svDefsHTML(open) {
  const D = SV.data.definitions;
  return `<details class="svdefs" ${open ? 'open' : ''}>
    <summary>Definitions used by the pipeline (read before you start)</summary>
    <h4>Structural agency</h4>
    <p>${esc(D.structural_agency.definition)}</p>
    <p>A conversation counts when the user's message shows at least one of these purposes:</p>
    <ul>${D.structural_agency.purposes.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    <h4>Domains (pick every one that applies)</h4>
    <dl>${D.domains.map((d) =>
      `<dt>${esc(pretty(d.key))}<span class="svt">${esc(d.title)}</span></dt><dd>${esc(d.scope)}</dd>`).join('')}
      <dt>other</dt><dd>Structural agency, but none of the nine domains fits. Stands alone.</dd></dl>
    <h4>Actions (what the user asked the model to produce)</h4>
    <dl>${D.actions.map((a) => `<dt>${esc(a.key)}</dt><dd>${esc(a.definition)}</dd>`).join('')}</dl>
  </details>`;
}

function drawSurvey() {
  const host = $('#sv-root');
  if (SV.view === 'intro' || !SV.annotator) return drawSurveyIntro(host);
  if (SV.view === 'done') return drawSurveyDone(host);
  return drawSurveyItem(host);
}

function drawSurveyIntro(host) {
  const per = SV.data.per_group, G = SV.data.groups;
  const ann = Object.keys(G).flatMap((g) => G[g].annotators.map((a) => ({ a, g })));
  host.innerHTML = `<div class="rwrap">
    <h2>Human agreement survey</h2>
    <p class="lede">Six annotators label three disjoint groups of ${per} published conversations,
      one pair per group, following the protocol of EUDAIMONIA (Appendix F.1). For each
      conversation you decide whether it is <b>structural agency</b>; if it is, you also pick every
      <b>domain</b> that applies and the <b>action</b> the user asked for. The pipeline's own labels
      are hidden. Both members of a pair see the same ${per} conversations; please work independently
      and do not look the conversations up in the Examples tab.</p>
    <p class="rnote">Nothing is uploaded. Your answers are saved in this browser under your annotator ID;
      when you finish, download the CSV and send it to the study lead.</p>
    <h3>Choose your annotator ID</h3>
    <div class="svpick">${ann.map(({ a, g }) => {
      const n = svSavedCount(a);
      return `<button type="button" data-a="${a}"><b>${a}</b><span>Group ${g} · ${n ? `${n}/${per} done` : 'not started'}</span></button>`;
    }).join('')}</div>
    ${svDefsHTML(true)}
  </div>`;
  host.querySelectorAll('.svpick button').forEach((b) => b.addEventListener('click', () => svSelect(b.dataset.a)));
}

function drawSurveyItem(host) {
  const N = SV.items.length, it = SV.items[SV.cursor];
  if (!SV.answers.has(it.h)) SV.answers.set(it.h, { sa: null, d: new Set(), a: new Set(), note: '', t: '' });
  const ans = SV.answers.get(it.h);
  const answered = SV.items.filter((x) => svDone(SV.answers.get(x.h))).length;
  const domains = SV.data.definitions.domains.map((d) => d.key).concat('other');
  const actions = SV.data.definitions.actions.map((a) => a.key);
  const chiprow = (cls, labels, set) => `<div class="rchips ${cls}">` + labels.map((l) =>
    `<button type="button" data-l="${l}" aria-pressed="${set.has(l)}">${esc(pretty(l))}</button>`).join('') + '</div>';

  host.innerHTML = `<div class="rwrap">
    <div class="resbar"><span><b>${SV.cursor + 1}</b> of ${N} · ${SV.annotator} · group ${SV.group}</span>
      <span>${answered} answered</span>
      <span class="pager"><button id="sv-export">Download CSV</button><button id="sv-switch">Switch annotator</button></span></div>
    <div class="rprog"><i style="width:${(answered / N) * 100}%"></i></div>
    <div class="rtext">${esc(it.u)}</div>
    ${it.tr ? `<div class="rtrans"><b>Translation (${esc(it.lang || '')})</b>${esc(it.tr)}</div>` : ''}
    <div class="rgroup"><h3>1. Is this conversation structural agency?</h3>
      <div class="rchips sv-yn">
        <button type="button" data-v="yes" aria-pressed="${ans.sa === 'yes'}">Yes, structural agency</button>
        <button type="button" data-v="no" class="notsa" aria-pressed="${ans.sa === 'no'}">No, not structural agency</button>
      </div></div>
    ${ans.sa === 'yes' ? `
    <div class="rgroup"><h3>2. Domains — pick every one that applies</h3>${chiprow('dd', domains, ans.d)}</div>
    <div class="rgroup"><h3>3. Action — what did the user ask the model to do?</h3>${chiprow('aa', actions, ans.a)}</div>` : ''}
    <div class="rgroup"><h3>Note (optional)</h3>
      <textarea class="svnote" id="sv-note" rows="2" placeholder="anything unclear about this item">${esc(ans.note)}</textarea></div>
    <div class="rnav">
      <button id="sv-back" ${SV.cursor === 0 ? 'disabled' : ''}>&larr; Back</button>
      <button class="primary" id="sv-next" ${svDone(ans) ? '' : 'disabled'}>${SV.cursor === N - 1 ? 'Finish' : 'Next →'}</button>
      <span class="rnote">${ans.sa === 'yes'
        ? 'pick at least one domain and one action · <b>other</b> stands alone'
        : 'answer question 1 first'}</span>
    </div>
    ${svDefsHTML(false)}
  </div>`;

  const touch = () => { ans.t = new Date().toISOString(); saveSurvey(); };
  host.querySelectorAll('.sv-yn button').forEach((b) => b.addEventListener('click', () => {
    ans.sa = ans.sa === b.dataset.v ? null : b.dataset.v; touch(); drawSurvey();
  }));
  host.querySelectorAll('.rchips.dd button').forEach((b) =>
    b.addEventListener('click', () => { toggleLabel(ans.d, b.dataset.l); touch(); drawSurvey(); }));
  host.querySelectorAll('.rchips.aa button').forEach((b) =>
    b.addEventListener('click', () => { toggleLabel(ans.a, b.dataset.l); touch(); drawSurvey(); }));
  $('#sv-note').addEventListener('input', (e) => { ans.note = e.target.value; touch(); });
  $('#sv-back').addEventListener('click', () => { SV.cursor--; saveSurvey(); drawSurvey(); });
  $('#sv-next').addEventListener('click', () => {
    if (SV.cursor === N - 1) {
      const missing = SV.items.findIndex((x) => !svDone(SV.answers.get(x.h)));
      if (missing >= 0) SV.cursor = missing; else SV.view = 'done';
    } else SV.cursor++;
    saveSurvey(); drawSurvey();
  });
  $('#sv-export').addEventListener('click', surveyDownload);
  $('#sv-switch').addEventListener('click', () => { saveSurvey(); SV.annotator = null; SV.view = 'intro'; drawSurvey(); });
}

function drawSurveyDone(host) {
  const N = SV.items.length;
  let yes = 0, no = 0;
  const dc = new Map(), ac = new Map();
  for (const it of SV.items) {
    const v = SV.answers.get(it.h);
    if (!v) continue;
    if (v.sa === 'yes') {
      yes++;
      for (const l of v.d) dc.set(l, (dc.get(l) || 0) + 1);
      for (const l of v.a) ac.set(l, (ac.get(l) || 0) + 1);
    } else if (v.sa === 'no') no++;
  }
  const bars = (m) => {
    const rows = [...m.entries()].sort((x, y) => y[1] - x[1]);
    const max = rows.length ? rows[0][1] : 1;
    return `<div class="bars">${rows.map(([l, n]) => `
      <div class="bar"><span class="blabel">${esc(pretty(l))}</span>
        <span class="btrack"><i style="width:${(n / max) * 100}%"></i></span>
        <span class="bval">${n}</span></div>`).join('') || '<div class="empty">none</div>'}</div>`;
  };
  host.innerHTML = `<div class="rwrap">
    <div class="vhead"><h2>Survey complete — ${SV.annotator}, group ${SV.group}</h2></div>
    <p class="lede">${N} conversations labelled: <b>${yes}</b> structural agency, <b>${no}</b> not.
      Download the CSV and send it to the study lead.</p>
    <div class="rnav">
      <button class="primary" id="sv-dl">Download CSV</button>
      <button id="sv-review">&larr; Review / edit answers</button>
      <button id="sv-switch2">Switch annotator</button>
    </div>
    <h3>Your domain labels</h3>${bars(dc)}
    <h3>Your action labels</h3>${bars(ac)}
  </div>`;
  $('#sv-dl').addEventListener('click', surveyDownload);
  $('#sv-review').addEventListener('click', () => { SV.view = 'item'; SV.cursor = 0; saveSurvey(); drawSurvey(); });
  $('#sv-switch2').addEventListener('click', () => { SV.annotator = null; SV.view = 'intro'; drawSurvey(); });
}

function surveyCSV() {
  const q = (s) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
  const lines = ['annotator,group,item,conversation_hash,is_sa,domains,actions,note,answered_at'];
  SV.items.forEach((it, i) => {
    const v = SV.answers.get(it.h) || { sa: null, d: new Set(), a: new Set(), note: '', t: '' };
    const yes = v.sa === 'yes';
    lines.push([SV.annotator, SV.group, i + 1, it.h, v.sa || '',
      yes ? [...v.d].join('|') : '', yes ? [...v.a].join('|') : '', q(v.note), v.t].join(','));
  });
  return lines.join('\n') + '\n';
}

function surveyDownload() {
  const blob = new Blob([surveyCSV()], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `survey_${SV.annotator}_group${SV.group}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
