/* WildChat Structural-Agency Explorer
   Five tabs over a static payload: Examples (search + paginate the published rows),
   Prompts (every production prompt), Analysis (actions x requests heatmap),
   Verify (blind agreement test against the Opus labels), Upload (read a
   verification JSONL back in and see it against Opus).

   index.json carries labels + the full user turn, so search and filtering are
   instant. Assistant responses live in 250-row shards fetched on demand — a card
   only pulls its shard when you expand it.

   Two populations, deliberately: only PII-cleared conversations are browsable, but
   Analysis counts the whole experiment (meta.analysis). The withheld rows are not a
   random sample, so analysing the published subset alone would understate the very
   findings the paper reports. */

const PAGE = 50;
const S = {
  index: [], meta: null, prompts: null,
  filtered: [], page: 0,
  q: '', domain: new Set(), action: new Set(), request: new Set(),
  shards: new Map(),
};
const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pretty = (s) => s.replace(/_/g, ' ');
const nf = (n) => n.toLocaleString('en-US');

/* ---------------- tabs ---------------- */
const TABS = ['examples', 'prompts', 'analysis', 'verify', 'upload'];
for (const id of TABS) {
  document.getElementById('tab-' + id).addEventListener('click', () => {
    for (const other of TABS) {
      const on = other === id;
      document.getElementById('tab-' + other).setAttribute('aria-selected', String(on));
      document.getElementById('panel-' + other).hidden = !on;
    }
    if (id === 'analysis') drawAnalysis();
    if (id === 'prompts') ensurePrompts();
    if (id === 'verify') ensureVerify();
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
  buildFacet('#f-request', meta.requests, meta.request_counts, S.request);

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
    for (const set of [S.domain, S.action, S.request]) set.clear();
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
    if (S.request.size && !r.r.some((x) => S.request.has(x))) return false;
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
      ...r.r.map((x) => `<span class="tag r">${esc(pretty(x))}</span>`),
    ].join('');
    el.innerHTML =
      `<div class="meta"><code>${esc(r.h)}</code><span>${esc(r.t)}</span>${tags}</div>
       <div class="utext">${highlight(r.u, S.q)}</div>
       <details data-i="${r.i}"><summary>assistant response</summary>
         <div class="atext">loading…</div></details>`;
    frag.appendChild(el);
  }
  host.innerHTML = '';
  host.appendChild(frag);

  host.querySelectorAll('details').forEach((d) => {
    d.addEventListener('toggle', async () => {
      if (!d.open || d.dataset.done) return;
      d.dataset.done = '1';
      const i = Number(d.dataset.i);
      const body = d.querySelector('.atext');
      try {
        body.textContent = await assistantFor(i);
      } catch {
        body.textContent = '(could not load the assistant response)';
      }
    }, { once: false });
  });
}

async function assistantFor(i) {
  const size = S.meta.shard_size;
  const n = Math.floor(i / size);
  if (!S.shards.has(n)) {
    S.shards.set(n, fetch(`data/rows/${String(n).padStart(3, '0')}.json`).then((r) => r.json()));
  }
  const shard = await S.shards.get(n);
  return shard[i % size] || '(empty)';
}

/* ---------------- prompts ---------------- */
let promptsReady = false;
async function ensurePrompts() {
  if (promptsReady) return;
  promptsReady = true;
  S.prompts = await fetch('data/prompts.json').then((r) => r.json());
  const groups = [['actions', '#nav-actions'], ['requests', '#nav-requests'], ['domains', '#nav-domains']];
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
  actions: 'Stage 03 — judges WHY the person is asking. 1–3 of 6 codes. Claude Opus 4.8.',
  requests: 'Stage 04 — judges WHAT they asked the model to produce. 1–3 of 5 codes. Claude Opus 4.8.',
  domains: 'Stage 02 — the recall gate, nine per-domain cascades, and the general residual filter.',
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
  for (const a of m.actions) {
    rowMax[a] = Math.max(...m.requests.map((r) => (m.crosstab[`${a}|${r}`] || 0) / (m.action_counts[a] || 1)));
  }
  const globalMax = Math.max(...Object.values(rowMax));
  $('#scalemax').textContent = Math.round(globalMax * 100) + '%';

  let html = '<thead><tr><th></th>' +
    m.requests.map((r) => `<th>${esc(pretty(r))}</th>`).join('') +
    '<th class="marg">rows</th></tr></thead><tbody>';
  for (const a of m.actions) {
    const denom = m.action_counts[a] || 1;
    html += `<tr><th>${esc(pretty(a))}</th>`;
    for (const r of m.requests) {
      const n = m.crosstab[`${a}|${r}`] || 0;
      const share = n / denom;
      const idx = Math.min(ramp.length - 1, Math.floor((share / globalMax) * ramp.length));
      const dark = idx >= 4;
      html += `<td style="background:${ramp[idx]};color:${dark ? '#fff' : '#16191f'}"
                   title="${esc(pretty(a))} × ${esc(pretty(r))}: ${nf(n)} conversations">
                 ${nf(n)}<span class="pct">${(share * 100).toFixed(0)}%</span></td>`;
    }
    html += `<td class="marg">${nf(denom)}</td></tr>`;
  }
  html += '</tbody>';
  $('#heat').innerHTML = html;

  const top = [];
  for (const a of m.actions) {
    for (const r of m.requests) {
      const share = (m.crosstab[`${a}|${r}`] || 0) / (m.action_counts[a] || 1);
      top.push([share, a, r]);
    }
  }
  top.sort((x, y) => y[0] - x[0]);
  $('#heatnote').innerHTML =
    `Cells are shaded by the share of that action's rows, so rows are comparable to each other ` +
    `rather than to the largest action. Strongest pairings: ` +
    top.slice(0, 3).map(([s, a, r]) =>
      `<b>${esc(pretty(a))} → ${esc(pretty(r))}</b> (${(s * 100).toFixed(0)}%)`).join(', ') + '.';

  bars('#bars-action', m.actions, m.action_counts, A.n);
  bars('#bars-request', m.requests, m.request_counts, A.n);
  bars('#bars-domain', m.domains, m.domain_counts, A.n);

  $('#about').innerHTML =
    `<b>The figures on this page cover the whole experiment: ${nf(A.n)} conversations, ` +
    `not only the ${nf(S.meta.rows)} browsable in the Examples tab.</b> ` +
    `${nf(S.meta.withheld_for_pii)} conversations are withheld from browsing because a GPT-4o-mini ` +
    `reviewer flagged them as containing information that could identify a real person; they are ` +
    `excluded from publication entirely rather than shown in redacted form, but they are still ` +
    `counted here.`;
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

/* ---------------- verify ----------------
   A blind agreement test. Each of 25 conversations is shown with three candidate
   labels — one action, one request, one domain — and you say whether it belongs.
   Opus's verdict is never rendered before you answer; roughly half the candidates
   are labels Opus did NOT assign, so "yes" to everything scores ~50%. */

const V = { data: null, i: 0, ans: new Map(), done: false };
const LS_PREFIX = 'sa-verify-answers:';

let verifyReady = false;
async function ensureVerify() {
  if (verifyReady) return;
  verifyReady = true;
  try {
    V.data = await fetch('data/verify.json').then((r) => r.json());
  } catch {
    $('#v-root').innerHTML = '<div class="empty">Could not load the verification set.</div>';
    return;
  }
  // Answers are stored under the question set's fingerprint. A rebuilt set has a new
  // id, so old answers are simply not found rather than reattached to questions that
  // now mean something different.
  try {
    const saved = JSON.parse(localStorage.getItem(LS_PREFIX + V.data.set_id) || '{}');
    for (const [k, v] of Object.entries(saved)) V.ans.set(k, v);
  } catch { /* corrupt or unavailable storage — start clean */ }
  drawVerify();
}

const persist = () => {
  try {
    localStorage.setItem(LS_PREFIX + V.data.set_id, JSON.stringify(Object.fromEntries(V.ans)));
  } catch { /* private mode or quota — the quiz still works, it just will not resume */ }
};
const allQuestions = () => V.data.items.flatMap((it) => it.questions);
const answeredCount = () => allQuestions().filter((q) => V.ans.has(q.qid)).length;

function drawVerify() {
  if (V.done) return drawScore();
  const d = V.data;
  const it = d.items[V.i];
  const n = answeredCount();
  const itemDone = it.questions.every((q) => V.ans.has(q.qid));

  const ASK = {
    action: 'Why is this person asking — does the conversation belong under',
    request: 'What did they ask the model to produce — does it belong under',
    domain: 'Which institutional domain — does it belong under',
  };
  const blocks = it.blocks.map((b) => `
    <section class="vblock">
      <h3><span class="vfacet ${b.facet[0]}">${b.facet}</span>
        <span class="vsub">${b.questions.length} to judge</span></h3>
      ${b.questions.map((q) => {
        const a = V.ans.get(q.qid);
        return `<div class="vq" data-qid="${q.qid}">
          <div class="vask">${ASK[q.facet]} <b>${esc(pretty(q.code))}</b>?</div>
          <div class="vdef">${esc(q.definition)}</div>
          <div class="vbtns">
            <button type="button" data-v="yes" aria-pressed="${a === 'yes'}">Yes</button>
            <button type="button" data-v="no"  aria-pressed="${a === 'no'}">No</button>
          </div>
        </div>`;
      }).join('')}
    </section>`).join('');

  $('#v-root').innerHTML = `
    <div class="vhead"><h2>Human verification</h2></div>
    <div class="vbar">
      <div class="vtrack"><div class="vfill" style="width:${(n / d.n_questions) * 100}%"></div></div>
      <span class="vcount">${n} / ${d.n_questions} answered</span>
      <button type="button" class="vreset" id="v-reset">Reset</button>
    </div>

    <article class="vcard">
      <div class="vmeta">Conversation ${it.item} of ${d.n_items} <code>${esc(it.hash)}</code></div>
      <div class="vtext">${esc(it.user_input)}</div>
    </article>

    <div class="vqs">${blocks}</div>

    <div class="vnav">
      <button type="button" id="v-prev" ${V.i === 0 ? 'disabled' : ''}>&larr; Previous</button>
      <span class="vhint">${itemDone ? '' : `${it.questions.length - it.questions.filter((q) => V.ans.has(q.qid)).length} left on this conversation.`}</span>
      ${V.i === d.n_items - 1
        ? `<button type="button" id="v-finish" class="primary" ${n < d.n_questions ? 'disabled' : ''}>See my score</button>`
        : `<button type="button" id="v-next" class="primary" ${itemDone ? '' : 'disabled'}>Next &rarr;</button>`}
    </div>`;

  // Answering updates in place rather than re-rendering. A full redraw would reset
  // the scroll position inside a long conversation the moment you answered — you
  // would lose your place in the text you are being asked about.
  $('#v-root').querySelectorAll('.vq').forEach((el) => {
    el.querySelectorAll('button[data-v]').forEach((b) => {
      b.addEventListener('click', () => {
        V.ans.set(el.dataset.qid, b.dataset.v);
        persist();
        el.querySelectorAll('button[data-v]').forEach((o) =>
          o.setAttribute('aria-pressed', String(o === b)));
        refreshProgress(it);
      });
    });
  });
  const prev = $('#v-prev'), next = $('#v-next'), fin = $('#v-finish');
  if (prev) prev.addEventListener('click', () => { V.i--; drawVerify(); vtop(); });
  if (next) next.addEventListener('click', () => { V.i++; drawVerify(); vtop(); });
  if (fin) fin.addEventListener('click', () => { V.done = true; drawScore(); vtop(); });
  $('#v-reset').addEventListener('click', () => {
    if (!confirm('Clear all your answers and start over?')) return;
    V.ans.clear(); V.i = 0; V.done = false; persist(); drawVerify(); vtop();
  });
}

function refreshProgress(it) {
  const n = answeredCount();
  const total = V.data.n_questions;
  $('.vfill').style.width = (n / total) * 100 + '%';
  $('.vcount').textContent = `${n} / ${total} answered`;
  const itemDone = it.questions.every((q) => V.ans.has(q.qid));
  const hint = $('#v-root .vhint');
  const left = it.questions.filter((q) => !V.ans.has(q.qid)).length;
  if (hint) hint.textContent = itemDone ? '' : `${left} left on this conversation.`;
  const next = $('#v-next'), fin = $('#v-finish');
  if (next) next.disabled = !itemDone;
  if (fin) fin.disabled = n < total;
}

const vtop = () => document.querySelector('#panel-verify .main').scrollTo({ top: 0, behavior: 'smooth' });

function scored() {
  const rows = [];
  for (const it of V.data.items) {
    for (const q of it.questions) {
      const you = V.ans.get(q.qid) === 'yes';
      rows.push({
        item: it.item, hash: it.hash, qid: q.qid, facet: q.facet, code: q.code,
        your_answer: V.ans.get(q.qid) || null, opus_answer: q.opus ? 'yes' : 'no',
        agree: V.ans.has(q.qid) ? you === q.opus : null,
        user_input: it.user_input,
      });
    }
  }
  return rows;
}

function drawScore() {
  const rows = scored();
  const n = rows.length;
  const agree = rows.filter((r) => r.agree).length;

  $('#v-root').innerHTML = `
    <div class="vscore">
      <div class="vbig">${((agree / n) * 100).toFixed(0)}<span>%</span></div>
      <div>
        <h2>Opus matched your judgment on ${agree} of ${n} labels</h2>
        <p class="note">Download the JSONL for the per-label record.</p>
      </div>
    </div>
    ${reportHTML(rows)}
    <div class="vnav">
      <button type="button" id="v-again">Review my answers</button>
      <span class="vhint"></span>
      <button type="button" id="v-dl" class="primary">Download JSONL</button>
    </div>`;

  $('#v-again').addEventListener('click', () => { V.done = false; V.i = 0; drawVerify(); vtop(); });
  $('#v-dl').addEventListener('click', () => download(rows, agree, n));
}

/* The matrix and the disagreement list are shared by the Verify score screen and the
   Upload tab, so both read identically whether the answers were just entered or
   loaded from a file. `rows` needs: facet, code, your_answer, opus_answer, agree,
   hash, and optionally user_input. */
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

function download(rows, agree, n) {
  const stamp = new Date().toISOString();
  const lines = rows.map((r) => JSON.stringify({
    record: 'answer', item: r.item, conversation_hash: r.hash, qid: r.qid,
    facet: r.facet, code: r.code, your_answer: r.your_answer,
    opus_answer: r.opus_answer, agree: r.agree,
  }));
  // Just the raw record. Every per-answer line carries your_answer, opus_answer and
  // agree, so any statistic can be computed downstream from the file itself.
  lines.push(JSON.stringify({
    record: 'summary', completed_at: stamp, set_id: V.data.set_id,
    conversations: V.data.n_items, questions: n, agreements: agree,
    agreement_rate: Number((agree / n).toFixed(4)),
  }));

  const blob = new Blob([lines.join('\n') + '\n'], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `verification_${stamp.slice(0, 19).replace(/[:T]/g, '-')}.jsonl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- upload ----------------
   Load a verification JSONL back in and see it against Opus. Same matrix and
   disagreement list as the Verify score screen, so a file someone else produced
   reads exactly like your own run. Conversation text is recovered by matching the
   record's hash against the published index, which means the report works for any
   question set, not just the one currently shipped in verify.json. */

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
      Drop the JSONL downloaded from the Verify tab. Nothing is uploaded anywhere —
      the file is read in your browser.
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
      'Expected the JSONL downloaded from the Verify tab.');
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
