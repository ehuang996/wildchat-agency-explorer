/* WildChat Structural-Agency Explorer
   Four tabs over a static payload: Examples (search + paginate the published rows),
   Prompts (the action labelling prompt), Analysis (domains x actions heatmap),
   Upload (read a verification JSONL back in and see it against the stored labels).

   index.json carries labels + the full user turn, so search and filtering are
   instant. Only the user turn is published; assistant responses are not part of
   the payload.

   Two populations, deliberately: only PII-cleared conversations are browsable, but
   Analysis counts the whole experiment (meta.analysis). The withheld rows are not a
   random sample, so analysing the published subset alone would understate the very
   findings the paper reports. */

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
const TABS = ['examples', 'prompts', 'analysis', 'upload'];
for (const id of TABS) {
  document.getElementById('tab-' + id).addEventListener('click', () => {
    for (const other of TABS) {
      const on = other === id;
      document.getElementById('tab-' + other).setAttribute('aria-selected', String(on));
      document.getElementById('panel-' + other).hidden = !on;
    }
    if (id === 'analysis') drawAnalysis();
    if (id === 'prompts') ensurePrompts();
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

  $('#brandsub').textContent =
    `${nf(meta.analysis.n)} conversations analysed · ${nf(meta.rows)} browsable · ` +
    `${nf(meta.withheld_for_pii)} withheld by the PII gate`;

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
       <div class="utext">${highlight(r.u, S.q)}</div>`;
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
  bars('#bars-domain', m.domains, m.domain_counts, A.n);

  $('#about').innerHTML =
    `<b>The figures on this page cover the whole experiment: ${nf(A.n)} conversations, ` +
    `not only the ${nf(S.meta.rows)} browsable in the Examples tab.</b> ` +
    `${nf(S.meta.withheld_for_pii)} conversations are withheld from browsing because a GPT-4o-mini ` +
    `reviewer flagged them as containing information that could identify a real person; they are ` +
    `excluded from publication entirely rather than shown in redacted form, but they are still ` +
    `counted here. Domain labels come from the filtering pipeline; action labels from an ` +
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
    <div class="vhead"><h2>Upload verification answers</h2></div>
    <p class="lede">
      Drop a verification JSONL from an earlier rating round. Nothing is uploaded
      anywhere — the file is read in your browser.
    </p>
    ${error ? `<div class="uerr">${esc(error)}</div>` : ''}
    <label class="drop" id="u-drop">
      <input type="file" id="u-file" accept=".jsonl,.ndjson,.json,.txt">
      <h3>Choose a file, or drop it here</h3>
      <p>verification_*.jsonl</p>
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
      drawUpload(parseAnswers(fr.result), file.name);
    } catch (err) {
      drawDrop(err.message);
    }
  };
  fr.readAsText(file);
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
      the rest are not in the published set (they may be rows withheld by the PII gate).</p>` : ''}`;

  $('#u-clear').addEventListener('click', () => drawDrop());
}
