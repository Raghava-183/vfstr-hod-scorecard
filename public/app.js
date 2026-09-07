/* HoD's Score Card 2025-26 — Department of Computer Applications, VFSTR
   Shared deployment: every save goes to the department database. */

const BANDS = ['beginning', 'developing', 'proficient', 'exemplary'];
const LBL = { beginning:'Beginning', developing:'Developing', proficient:'Proficient',
              exemplary:'Exemplary', unrated:'Not rated' };
const CMT = {
  beginning:'There is scope for improvement',
  developing:'Good, achievable target is not far away',
  proficient:'Congratulations, you have achieved the target!',
  exemplary:'Outstanding performance!',
  unrated:'Not rated — please verify' };

const cv = b => `var(--${b})`;
const tv = b => `var(--${b}-t)`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const $ = id => document.getElementById(id);

/* ---------------- scoring engine ----------------
   Reads the four threshold columns from the sheet itself. The Beginning cell
   carries the direction: "< 85" means higher is better, "> 24" means lower. */
function n_(s){ if (s == null) return null; const m = String(s).match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; }
function opt_(s){ const m = String(s == null ? '' : s).match(/^\s*(\d+)\s*\)/); return m ? parseInt(m[1], 10) : null; }

function scoreRow(r) {
  const th = {}; BANDS.forEach(b => th[b] = (r[b] == null ? '' : String(r[b]).trim()));
  const resp = String(r.response == null ? '' : r.response).trim();
  if (resp === '' || ['na','n/a','-','nil'].includes(resp.toLowerCase())) return 'unrated';

  const opts = {}; let allOpts = true;
  BANDS.forEach(b => { opts[b] = opt_(th[b]); if (opts[b] === null) allOpts = false; });
  if (allOpts) {
    const v = n_(resp);
    for (const b of BANDS) if (v !== null && Math.round(v) === opts[b]) return b;
    return 'unrated';
  }

  if (n_(resp) === null || BANDS.some(b => th[b] !== '' && n_(th[b]) === null)) {
    for (let i = BANDS.length - 1; i >= 0; i--) {
      const b = BANDS[i];
      if (th[b] !== '' && th[b].toLowerCase() === resp.toLowerCase()) return b;
    }
    return 'unrated';
  }

  const v = n_(resp);
  const lowerBetter = th.beginning.startsWith('>');
  for (let i = BANDS.length - 1; i >= 1; i--) {
    const b = BANDS[i]; if (th[b] === '') continue;
    const c = n_(th[b]); if (c === null) continue;
    if (lowerBetter ? v <= c : v >= c) return b;
  }
  return 'beginning';
}

/* ---------------- state ---------------- */
let DATA = null, T = 0, ME = '';
const ROWS = [], SEC = {}, byNo = {}, trOf = {}, tickOf = {};
let pollTimer = null;

const tally = list => {
  const c = { beginning:0, developing:0, proficient:0, exemplary:0, unrated:0 };
  list.forEach(r => c[r.band]++); return c;
};
const pc = n => Math.round(n / T * 1000) / 10;
const commentOf = r => (r.note || '').trim() !== '' ? r.note : CMT[r.band];
const documented = r => ((r.just || '') + (r.proof || '') + (r.action || '')).trim() !== '' || (r.files || []).length > 0;

/* ---------------- network ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }
  if (!res.ok) { const e = new Error(json.error || `Request failed (${res.status})`); e.status = res.status; e.payload = json; throw e; }
  return json;
}

function setSync(state, msg) {
  const el = $('sync');
  el.className = 'sync' + (state === 'busy' ? ' busy' : state === 'err' ? ' err' : '');
  el.textContent = msg;
}

/* ---------------- sign-in ---------------- */
$('gate-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('g-go'); btn.disabled = true; $('g-err').textContent = '';
  try {
    const r = await api('/api/login', { method: 'POST',
      body: { name: $('g-name').value, password: $('g-pass').value } });
    ME = r.name;
    $('gate').hidden = true;
    await boot();
  } catch (err) {
    $('g-err').textContent = err.message;
  } finally { btn.disabled = false; }
});

$('btn-signout').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
};

/* ---------------- boot ---------------- */
(async function start() {
  try {
    const s = await api('/api/session');
    if (s.signedIn) { ME = s.name; await boot(); }
    else { $('gate').hidden = false; $('g-name').focus(); }
  } catch {
    $('gate').hidden = false;
  }
})();

async function boot() {
  DATA = await (await fetch('/metrics.json')).json();
  T = DATA.meta.total;

  ROWS.length = 0;
  DATA.sections.forEach(s => {
    const id = slug(s.name);
    SEC[id] = { name: s.name, note: s.note, rows: [] };
    s.rows.forEach(r => {
      r.sec = id; r.orig = r.response;
      r.note = ''; r.just = ''; r.proof = ''; r.action = '';
      r.files = []; r.updatedBy = ''; r.updatedAt = null;
      r.band = scoreRow(r);
      ROWS.push(r); SEC[id].rows.push(r); byNo[r.no] = r;
    });
  });

  buildShell();
  await pullState();
  $('shell').hidden = false;
  $('who-name').textContent = ME;
  pollTimer = setInterval(() => { if (vDetail.hidden && !document.hidden) pullState(true); }, 45000);
}

/** Merge server entries into the local model. */
async function pullState(quiet) {
  if (!quiet) setSync('busy', 'Loading…');
  try {
    const { entries } = await api('/api/state');
    ROWS.forEach(r => {
      const e = entries[r.no];
      if (!e) return;
      if (cur && cur.no === r.no) return;           // don't clobber an open editor
      if (e.response !== undefined) r.response = e.response;
      r.note = e.comment || '';
      r.just = e.justification || '';
      r.proof = e.proof || '';
      r.action = e.actionPlan || '';
      r.files = e.files || [];
      r.updatedBy = e.updatedBy || '';
      r.updatedAt = e.updatedAt || null;
      r.band = scoreRow(r);
      const ri = trOf[r.no];
      if (ri) { ri.querySelector('.r-in').value = r.response; ri.querySelector('.c-in').value = r.note; }
      paintRow(r, false);
    });
    repaint(); applyFilter();
    setSync('ok', 'Saved');
  } catch (err) {
    setSync('err', 'Offline — changes not saved');
  }
}

/* ---------------- shell ---------------- */
function buildShell() {
  $('t-sub').textContent =
    `${DATA.meta.dept} · ${DATA.meta.school}. ${T} metrics assessed across ${DATA.sections.length} areas against the four-band institutional scale.`;
  $('s-total').textContent = T;
  $('d-n').textContent = T;

  const ticks = $('ticks'), labels = $('spine-labels');
  let ti = 0;
  DATA.sections.forEach(sec => {
    const g = document.createElement('div');
    g.className = 'tick-group'; g.style.setProperty('--n', sec.rows.length);
    sec.rows.forEach(r => {
      const b = document.createElement('button');
      b.className = 'tick'; b.style.setProperty('--d', (ti++ * 5) + 'ms');
      b.onclick = () => jumpTo(r.no);
      tickOf[r.no] = b; g.appendChild(b);
    });
    ticks.appendChild(g);
    const l = document.createElement('div');
    l.className = 'spine-label'; l.style.setProperty('--n', sec.rows.length);
    l.textContent = sec.name; l.title = sec.name; labels.appendChild(l);
  });

  $('tally').innerHTML = BANDS.map(b => `
    <div class="card" style="--c:${cv(b)};--t:${tv(b)}" data-band="${b}">
      <div class="n num">0</div><div class="l">${LBL[b]}</div>
      <div class="p num"></div><div class="meter"><i style="--w:0%"></i></div>
    </div>`).join('');

  $('legend').innerHTML = BANDS.map(b => `<i style="--c:${cv(b)}">${LBL[b]}</i>`).join('');
  $('tb-links').innerHTML = DATA.sections.map(s => `<a href="#${slug(s.name)}">${esc(s.name)}</a>`).join('')
    + `<a href="#data-to-verify">Data to verify</a>`;

  $('chips').innerHTML = BANDS.map(b =>
    `<button class="chip" data-band="${b}" aria-pressed="false" style="--c:${cv(b)}">${LBL[b]}</button>`).join('');
  document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
    const b = c.dataset.band;
    active.has(b) ? active.delete(b) : active.add(b);
    c.setAttribute('aria-pressed', active.has(b)); applyFilter();
  });

  buildSheet();
  buildFlags();
}

function buildSheet() {
  let html = '';
  DATA.sections.forEach(sec => {
    const id = slug(sec.name);
    html += `<tr class="sec" id="${id}"><td colspan="10"><div class="sec-name">
        ${esc(sec.name)}<span class="sec-count num">${sec.rows.length} metrics</span>
        <span class="sec-bar"></span></div></td></tr>`;
    sec.rows.forEach(r => {
      const cell = b => `<td class="band num" data-b="${b}" style="--c:${cv(b)}">${esc(r[b]) || '—'}</td>`;
      html += `<tr class="metric" data-no="${r.no}" data-sec="${id}"
          data-text="${esc((r.no + ' ' + r.metric + ' ' + r.portfolio + ' ' + r.type + ' ' + sec.name).toLowerCase())}">
        <td class="sno num">${r.no}</td>
        <td class="type">${esc(r.type)}</td>
        <td class="port">${esc(r.portfolio)}</td>
        <td class="metric">${esc(r.metric)}</td>
        <td class="resp"><input class="r-in num" data-no="${r.no}" value="${esc(r.response)}"
          aria-label="Response for metric ${r.no}"></td>
        ${cell('beginning')}${cell('developing')}${cell('proficient')}${cell('exemplary')}
        <td class="cmt"><input class="c-in" data-no="${r.no}" value="" aria-label="Comment for metric ${r.no}"></td></tr>`;
    });
  });
  $('tbody').innerHTML = html;
  document.querySelectorAll('tr.metric').forEach(tr => trOf[tr.dataset.no] = tr);
  ROWS.forEach(r => paintRow(r, false));
}

function buildFlags() {
  const diffs = ROWS.filter(r => r.wbBand && r.wbBand !== r.band);
  const el = $('diff');
  if (diffs.length) {
    el.innerHTML = `<h3>${diffs.length} rows where the workbook's own scoring disagrees with its thresholds</h3>
    <p style="font-size:13px;color:var(--ink2);margin-bottom:9px">This page scores every response against the band values in the same sheet. These rows were recorded differently in the workbook, so the totals here differ from the Gist tab by that amount.</p>
    <table><tr><th>Row</th><th>Metric</th><th>Response</th><th>Thresholds</th><th>Workbook said</th><th>Computed</th></tr>
    ${diffs.map(r => `<tr><td class="num">${r.no}</td><td>${esc(r.metric.slice(0,68))}</td>
      <td class="num"><b>${esc(r.response)}</b></td>
      <td class="num">${esc([r.beginning,r.developing,r.proficient,r.exemplary].filter(x=>x!=='').join(' · '))}</td>
      <td><span class="tag" style="--c:${cv(r.wbBand)}">${LBL[r.wbBand]}</span></td>
      <td><span class="tag" style="--c:${cv(r.band)}">${LBL[r.band]}</span></td></tr>`).join('')}</table>`;
  } else el.hidden = true;

  $('flags').innerHTML = DATA.flags.map(f => `
    <div class="flag"><div class="no num">ROW ${f.no}</div>
    <h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></div>`).join('');
}

/* ---------------- painting ---------------- */
function paintRow(r, flash) {
  const tr = trOf[r.no]; if (!tr) return;
  tr.dataset.band = r.band;
  tr.style.setProperty('--c', cv(r.band));
  tr.style.setProperty('--t', tv(r.band));
  tr.querySelectorAll('td.band').forEach(td => td.classList.toggle('on', td.dataset.b === r.band));
  const ci = tr.querySelector('.c-in');
  ci.placeholder = CMT[r.band];
  tr.classList.toggle('edited', String(r.response) !== String(r.orig) || (r.note || '').trim() !== '');
  tr.classList.toggle('documented', documented(r));
  if (flash) { tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash'); }
}

function repaint() {
  const C = tally(ROWS);
  const met = C.proficient + C.exemplary;
  $('pills').innerHTML = `
    <span class="pill"><b>${met}</b> at or above target</span>
    <span class="pill"><b>${C.beginning + C.developing}</b> below target</span>
    <span class="pill"><b>${pc(met)}%</b> Proficient or Exemplary</span>`;

  const d1 = C.beginning / T * 360, d2 = d1 + C.developing / T * 360, d3 = d2 + C.proficient / T * 360;
  const dn = $('donut');
  dn.style.setProperty('--deg1', d1 + 'deg');
  dn.style.setProperty('--deg2', d2 + 'deg');
  dn.style.setProperty('--deg3', d3 + 'deg');

  document.querySelectorAll('.card').forEach(card => {
    const b = card.dataset.band;
    card.querySelector('.n').textContent = C[b];
    card.querySelector('.p').textContent = pc(C[b]) + '% of all metrics';
    card.querySelector('.meter i').style.setProperty('--w', pc(C[b]) + '%');
  });

  ROWS.forEach(r => {
    const t = tickOf[r.no]; if (!t) return;
    t.style.setProperty('--c', cv(r.band));
    t.title = `${r.no}. ${r.metric} — ${LBL[r.band]}`;
    t.setAttribute('aria-label', t.title);
  });

  Object.keys(SEC).forEach(id => {
    const bar = document.querySelector(`tr.sec[id="${id}"] .sec-bar`); if (!bar) return;
    const c = tally(SEC[id].rows);
    bar.innerHTML = BANDS.concat(['unrated']).filter(b => c[b])
      .map(b => `<i style="--c:${cv(b)};flex:${c[b]}"></i>`).join('');
  });

  const dc = ROWS.filter(documented).length;
  const dp = $('doc-count');
  dp.textContent = `${dc} of ${T} documented`;
  dp.style.background = dc ? 'var(--exemplary-i)' : 'var(--ink3)';
}

/* ---------------- inline editing ---------------- */
const saveTimers = {};
function queueSave(r) {
  clearTimeout(saveTimers[r.no]);
  setSync('busy', 'Saving…');
  saveTimers[r.no] = setTimeout(() => saveMetric(r), 900);
}

async function saveMetric(r, force) {
  try {
    setSync('busy', 'Saving…');
    const out = await api('/api/entry', { method: 'POST', body: {
      metricNo: r.no, response: r.response, comment: r.note,
      justification: r.just, proof: r.proof, actionPlan: r.action,
      baseUpdatedAt: r.updatedAt, force: !!force } });
    r.updatedBy = out.updatedBy; r.updatedAt = out.updatedAt;
    setSync('ok', 'Saved');
    return true;
  } catch (err) {
    if (err.status === 409) { showConflict(r, err.payload.theirs); setSync('err', 'Conflict'); return false; }
    setSync('err', err.message);
    return false;
  }
}

$('tbody').addEventListener('input', e => {
  const el = e.target, r = byNo[el.dataset.no]; if (!r) return;
  if (el.classList.contains('r-in')) {
    r.response = el.value.trim();
    const was = r.band; r.band = scoreRow(r);
    paintRow(r, was !== r.band);
  } else if (el.classList.contains('c-in')) {
    r.note = el.value; paintRow(r, false);
  }
  repaint(); applyFilter(); queueSave(r);
});

$('tbody').addEventListener('click', e => {
  if (e.target.closest('input,textarea,button')) return;
  const tr = e.target.closest('tr.metric');
  if (tr) openDetail(byNo[tr.dataset.no]);
});

$('tbody').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.classList.contains('r-in')) return;
  e.preventDefault();
  const all = [...document.querySelectorAll('tr.metric:not([hidden]) .r-in')];
  const i = all.indexOf(e.target);
  if (i > -1 && all[i + 1]) all[i + 1].focus();
});

/* ---------------- filter ---------------- */
const active = new Set();
const search = $('search'), noresult = $('noresult');
function applyFilter() {
  const q = search.value.trim().toLowerCase();
  const per = {}; let total = 0;
  document.querySelectorAll('tr.metric').forEach(r => {
    const ok = (!active.size || active.has(r.dataset.band)) && (!q || r.dataset.text.includes(q));
    r.hidden = !ok;
    if (ok) { per[r.dataset.sec] = (per[r.dataset.sec] || 0) + 1; total++; }
  });
  document.querySelectorAll('tr.sec').forEach(s => s.hidden = !per[s.id]);
  noresult.hidden = total > 0;
}
search.oninput = applyFilter;
$('btn-reset').onclick = () => {
  search.value = ''; active.clear();
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
  applyFilter();
};
$('btn-refresh').onclick = () => pullState();

function jumpTo(no) {
  $('btn-reset').click();
  const el = trOf[no]; if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  document.querySelectorAll('tr.hit').forEach(r => r.classList.remove('hit'));
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 2800);
}

/* ---------------- detail page ---------------- */
const vSheet = $('view-sheet'), vDetail = $('view-detail');
const fJust = $('f-just'), fProof = $('f-proof'), fAction = $('f-action'), dStatus = $('d-status');
let cur = null, scrollBack = 0;

function renderStrip(r) {
  $('d-strip').innerHTML = `
    <div class="d-no num">${r.no}</div>
    <div class="d-type">${esc(r.type)}</div>
    <div class="d-port">${esc(r.portfolio)}</div>
    <div class="d-met">${esc(r.metric)}</div>
    <div class="d-resp num">${esc(r.response) || '—'}</div>
    ${BANDS.map(b => `<div class="d-band${r.band === b ? ' on' : ''}" style="--c:${cv(b)}">${esc(r[b]) || '—'}</div>`).join('')}
    <div class="d-cmt">${esc(commentOf(r))}</div>`;
  const st = $('d-strip');
  st.style.setProperty('--c', cv(r.band));
  st.style.setProperty('--t', tv(r.band));
}

function renderFiles(r) {
  const kb = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  $('file-list').innerHTML = (r.files || []).map(f => `
    <div class="file" data-id="${f.id}">
      <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.filename || 'Attachment')}</a>
      <span class="meta">${kb(f.bytes)} · ${esc(f.uploadedBy || '')}</span>
      <button class="del" data-id="${f.id}">Remove</button>
    </div>`).join('');
}

function setStatus(msg, kind) {
  dStatus.textContent = msg;
  dStatus.className = 'd-status' + (kind === 'warn' ? ' warn' : '');
}

function openDetail(r) {
  if (!r) return;
  if (!cur) scrollBack = window.scrollY;
  cur = r;
  $('conflict').hidden = true;
  renderStrip(r); renderFiles(r);
  fJust.value = r.just; fProof.value = r.proof; fAction.value = r.action;
  const i = ROWS.indexOf(r);
  $('d-pos').textContent = `Metric ${i + 1} of ${ROWS.length} · ${SEC[r.sec].name}`;
  $('d-prev').disabled = i === 0;
  $('d-next').disabled = i === ROWS.length - 1;
  $('d-meta').textContent = r.updatedBy
    ? `Last saved by ${r.updatedBy} on ${new Date(r.updatedAt).toLocaleString()}.`
    : 'No entry saved for this metric yet.';
  setStatus(documented(r) ? 'Saved entry on file for this metric.' : '', 'ok');
  vSheet.hidden = true; vDetail.hidden = false;
  history.replaceState(null, '', '#m' + r.no);
  window.scrollTo(0, 0); fJust.focus({ preventScroll: true });
}

function closeDetail() {
  vDetail.hidden = true; vSheet.hidden = false;
  history.replaceState(null, '', location.pathname);
  const tr = cur ? trOf[cur.no] : null; cur = null;
  window.scrollTo(0, scrollBack);
  if (tr) { tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash'); }
  pullState(true);
}

$('d-back').onclick = closeDetail;
$('d-prev').onclick = () => openDetail(ROWS[ROWS.indexOf(cur) - 1]);
$('d-next').onclick = () => openDetail(ROWS[ROWS.indexOf(cur) + 1]);
[fJust, fProof, fAction].forEach(t =>
  t.addEventListener('input', () => setStatus('Unsaved changes on this page.', 'warn')));

$('d-save').onclick = async () => {
  if (!cur) return;
  cur.just = fJust.value; cur.proof = fProof.value; cur.action = fAction.value;
  setStatus('Saving…', 'warn');
  const ok = await saveMetric(cur);
  paintRow(cur, false); repaint();
  if (ok) {
    const n = ROWS.filter(documented).length;
    setStatus(`Saved to the department database. ${n} of ${ROWS.length} metrics now documented.`, 'ok');
    $('d-meta').textContent = `Last saved by ${cur.updatedBy} on ${new Date(cur.updatedAt).toLocaleString()}.`;
  }
};

/* conflict resolution */
function showConflict(r, theirs) {
  const box = $('conflict');
  box.hidden = false;
  box.innerHTML = `
    <h4>${esc(theirs.updatedBy || 'Someone else')} saved this metric while you were editing</h4>
    <p>Saved ${new Date(theirs.updatedAt).toLocaleString()}. Your version has not been written yet.</p>
    <pre>Response: ${esc(theirs.response || '—')}
Justification: ${esc(theirs.justification || '—')}
Proof: ${esc(theirs.proof || '—')}
Action plan: ${esc(theirs.actionPlan || '—')}</pre>
    <div class="row">
      <button class="btn" id="c-keep">Replace with mine</button>
      <button class="btn" id="c-take">Load their version</button>
    </div>`;
  $('c-keep').onclick = async () => {
    box.hidden = true;
    if (await saveMetric(r, true)) setStatus('Your version saved, replacing theirs.', 'ok');
  };
  $('c-take').onclick = () => {
    r.response = theirs.response; r.note = theirs.comment || '';
    r.just = theirs.justification; r.proof = theirs.proof; r.action = theirs.actionPlan;
    r.updatedBy = theirs.updatedBy; r.updatedAt = theirs.updatedAt;
    r.band = scoreRow(r);
    if (trOf[r.no]) trOf[r.no].querySelector('.r-in').value = r.response;
    paintRow(r, true); repaint();
    box.hidden = true;
    if (cur && cur.no === r.no) openDetail(r);
  };
}

/* ---------------- file upload ---------------- */
const MAX_BYTES = 10 * 1024 * 1024;
const drop = $('drop'), pick = $('file-pick'), upbar = $('upbar');

drop.onclick = () => pick.click();
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('over');
  if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
});
pick.onchange = () => { if (pick.files[0]) upload(pick.files[0]); pick.value = ''; };

$('file-list').addEventListener('click', async e => {
  const btn = e.target.closest('.del'); if (!btn || !cur) return;
  if (!confirm('Remove this proof file?')) return;
  try {
    await api('/api/attachment?id=' + btn.dataset.id, { method: 'DELETE' });
    cur.files = cur.files.filter(f => String(f.id) !== String(btn.dataset.id));
    renderFiles(cur); paintRow(cur, false); repaint();
    setStatus('File removed.', 'ok');
  } catch (err) { setStatus(err.message, 'warn'); }
});

async function upload(file) {
  if (!cur) return;
  if (file.size > MAX_BYTES) { setStatus('That file is over 10 MB. Please compress it first.', 'warn'); return; }
  upbar.hidden = false;
  const bar = upbar.querySelector('i');
  bar.style.width = '5%';
  setStatus('Uploading ' + file.name + '…', 'warn');
  try {
    const sig = await api('/api/upload-sign', { method: 'POST', body: { metricNo: cur.no } });
    const form = new FormData();
    form.append('file', file);
    form.append('api_key', sig.apiKey);
    form.append('timestamp', sig.timestamp);
    form.append('folder', sig.folder);
    form.append('signature', sig.signature);

    const up = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`);
      xhr.upload.onprogress = ev => {
        if (ev.lengthComputable) bar.style.width = Math.round(ev.loaded / ev.total * 90) + '%';
      };
      xhr.onload = () => xhr.status < 300
        ? resolve(JSON.parse(xhr.responseText))
        : reject(new Error('Cloudinary rejected the upload'));
      xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
      xhr.send(form);
    });

    bar.style.width = '100%';
    const saved = await api('/api/attachment', { method: 'POST', body: {
      metricNo: cur.no, url: up.secure_url, publicId: up.public_id,
      resourceType: up.resource_type, filename: file.name, bytes: up.bytes } });
    cur.files.push(saved.file);
    renderFiles(cur); paintRow(cur, false); repaint();
    setStatus('Uploaded ' + file.name + '.', 'ok');
  } catch (err) {
    setStatus(err.message, 'warn');
  } finally {
    setTimeout(() => { upbar.hidden = true; bar.style.width = '0'; }, 700);
  }
}

/* ---------------- CSV ---------------- */
$('btn-csv').onclick = () => {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['S.No.','Effectiveness / Efficiency','Portfolio','Metrics','Response (2025-26)',
    'Beginning','Developing','Proficient','Exemplary','Band','Comments',
    'Justification','Proof','Action plan','Proof files','Last saved by','Last saved at'];
  const lines = [head.map(q).join(',')];
  DATA.sections.forEach(sec => {
    lines.push(q(sec.name) + ','.repeat(head.length - 1));
    SEC[slug(sec.name)].rows.forEach(r => lines.push([
      r.no, r.type, r.portfolio, r.metric, r.response,
      r.beginning, r.developing, r.proficient, r.exemplary, LBL[r.band], commentOf(r),
      r.just, r.proof, r.action,
      (r.files || []).map(f => f.url).join(' | '),
      r.updatedBy, r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ''
    ].map(q).join(',')));
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'hod-scorecard-2025-26.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

/* ---------------- presentation ---------------- */
const stage = $('present'), pIn = $('p-in'), pLabel = $('p-label'), pDots = $('p-dots');
let slides = [], idx = 0;

function buildSlides() {
  slides = [{ label: 'Overview', render: () => {
    const C = tally(ROWS);
    return `<div class="p-eyebrow">${esc(DATA.meta.school)} · ${esc(DATA.meta.year)}</div>
    <h2>${esc(DATA.meta.dept)} — HoD's Score Card</h2>
    <p class="p-note">${T} metrics across ${DATA.sections.length} areas, scored against the four-band scale.</p>
    <div class="p-big">${BANDS.map(b => `<div style="--c:${cv(b)}">
      <div class="n num">${C[b]}</div><div class="l">${LBL[b]}</div></div>`).join('')}</div>
    <div class="p-bar">${Object.keys(SEC).map(id => { const c = tally(SEC[id].rows);
      return BANDS.concat(['unrated']).filter(b => c[b])
        .map(b => `<span style="--c:${cv(b)};flex:${c[b]}"></span>`).join(''); }).join('')}</div>
    <div class="p-legend">${Object.keys(SEC).map(id =>
      `<i style="--c:${cv('exemplary')}">${esc(SEC[id].name)} · ${SEC[id].rows.length}</i>`).join('')}</div>`; } }];

  Object.keys(SEC).forEach(id => slides.push({ label: SEC[id].name, render: () => {
    const s = SEC[id], c = tally(s.rows);
    return `<div class="p-eyebrow">${s.rows.length} metrics</div>
    <h2>${esc(s.name)}</h2><p class="p-note">${esc(s.note)}</p>
    <div class="p-bar">${BANDS.concat(['unrated']).filter(b => c[b])
      .map(b => `<span style="--c:${cv(b)};flex:${c[b]}"></span>`).join('')}</div>
    <div class="p-legend">${BANDS.concat(['unrated']).filter(b => c[b])
      .map(b => `<i style="--c:${cv(b)}">${c[b]} ${LBL[b]}</i>`).join('')}</div>
    <div class="p-rows">${s.rows.map(r => `<div class="p-row" style="--c:${cv(r.band)}">
      <div class="n num">${r.no}</div><div class="m">${esc(r.metric)}</div>
      <div class="v num">${esc(r.response) || '—'}</div></div>`).join('')}</div>`; } }));

  slides.push({ label: 'Data to verify', render: () => `
    <div class="p-eyebrow">${DATA.flags.length} rows</div><h2>Data to verify</h2>
    <p class="p-note">Values that look like gaps in the workbook rather than results.</p>
    <div class="p-flags">${DATA.flags.map(f => `<div class="p-flag">
      <h3>Row ${f.no}. ${esc(f.title)}</h3><p>${esc(f.body)}</p></div>`).join('')}</div>` });

  pDots.innerHTML = slides.map((s, i) =>
    `<button class="p-dot" data-i="${i}" aria-label="${esc(s.label)}"></button>`).join('');
}

function go(n) {
  idx = Math.max(0, Math.min(slides.length - 1, n));
  pIn.innerHTML = slides[idx].render();
  pLabel.textContent = `${idx + 1} / ${slides.length}  ·  ${slides[idx].label}`;
  pDots.querySelectorAll('.p-dot').forEach((d, i) => d.setAttribute('aria-current', i === idx));
  document.querySelector('.p-body').scrollTop = 0;
}
pDots.onclick = e => { const b = e.target.closest('.p-dot'); if (b) go(+b.dataset.i); };
function openP() { buildSlides(); stage.classList.add('on'); go(0); document.body.style.overflow = 'hidden'; }
function closeP() { stage.classList.remove('on'); document.body.style.overflow = ''; }
$('btn-present').onclick = openP;
$('p-next').onclick = () => go(idx + 1);
$('p-prev').onclick = () => go(idx - 1);
$('p-exit').onclick = closeP;

document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) { if (e.key === 'Escape' && cur) closeDetail(); return; }
  if (!vDetail.hidden) {
    if (e.key === 'Escape') closeDetail();
    if (e.key === 'ArrowRight') openDetail(ROWS[ROWS.indexOf(cur) + 1]);
    if (e.key === 'ArrowLeft') openDetail(ROWS[ROWS.indexOf(cur) - 1]);
    return;
  }
  if (!stage.classList.contains('on')) { if (e.key === 'p' || e.key === 'P') { e.preventDefault(); openP(); } return; }
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(idx + 1); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(idx - 1); }
  if (e.key === 'Escape') closeP();
  if (e.key === 'Home') go(0);
  if (e.key === 'End') go(slides.length - 1);
});

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#m') && DATA) {
    const r = byNo[location.hash.slice(2)];
    if (r) openDetail(r);
  }
});
