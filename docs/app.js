'use strict';
/* Deck Lab — front end for the Forge swap-test harness in this repo.
   Reads everything from GitHub; writes (decks, queued tests) through the GitHub API with a token kept in localStorage. */
const REPO = 'michaelsabramson/sisko-forge-tests', BR = 'main';
const OPP_DEFAULT = ['Atraxa', 'Prossh', 'UrDragon', 'Edgar', 'Meren'];
const SHARDS = 38, GPM = 1.1;           // runners per test, games per process-minute (measured)
const BASE_P = 0.19;                    // typical win rate for precision estimates

const S = {
  token: lsGet('ghToken') || '', head: null, tree: [], rawCache: {}, forge: null, forgeLc: null, forgeNames: [],
  sf: {}, decks: {}, tab: 'results', deck: null, deckDirty: false, deckText: false,
  test: { mode: 'swap', base: '', slots: [{ out: '', ins: [] }], decks: ['', ''], opps: [...OPP_DEFAULT], minutes: 160, name: '' },
  results: null, runs: null, runTimer: null, search: ''
};

/* ---------- utils ---------- */
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
function toast(msg, bad) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, bad ? 6000 : 3500); }
function b64(s) { const b = new TextEncoder().encode(s); let out = ''; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(out); }
function ago(iso) { const m = Math.round((Date.now() - new Date(iso)) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 36) return h + ' h ago'; return Math.round(h / 24) + ' days ago'; }
function fmtTime(d) { return new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function prettyName(n) { return n.replace(/_peek$/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()); }
const isGen = n => n.includes('__');
function needToken() { if (S.token) return false; toast('Add a GitHub token first (key button, top right).', true); openSettings(); return true; }

/* ---------- GitHub ---------- */
async function api(path, opt = {}) {
  const h = { Accept: 'application/vnd.github+json' };
  if (S.token) h.Authorization = 'Bearer ' + S.token;
  if (opt.body) h['Content-Type'] = 'application/json';
  const r = await fetch('https://api.github.com' + path, { method: opt.method || 'GET', headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined, cache: 'no-store' });
  if (!r.ok) { let m = ''; try { m = (await r.json()).message; } catch {} const e = new Error(`${r.status} ${m || r.statusText}`); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}
async function loadTree() {
  const b = await api(`/repos/${REPO}/branches/${BR}`);
  S.head = b.commit.sha;
  const t = await api(`/repos/${REPO}/git/trees/${b.commit.commit.tree.sha}?recursive=1`);
  S.tree = t.tree.filter(e => e.type === 'blob').map(e => e.path);
}
async function raw(path, sha = S.head) {
  const key = sha + ':' + path;
  if (S.rawCache[key] != null) return S.rawCache[key];
  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${encPath(path)}`);
  if (!r.ok) throw new Error(`${r.status} reading ${path}`);
  return (S.rawCache[key] = await r.text());
}
async function putFile(path, text, message) {
  let sha;
  try { sha = (await api(`/repos/${REPO}/contents/${encPath(path)}?ref=${BR}`)).sha; } catch (e) { if (e.status !== 404) throw e; }
  const r = await api(`/repos/${REPO}/contents/${encPath(path)}`, { method: 'PUT', body: { message, content: b64(text), branch: BR, ...(sha ? { sha } : {}) } });
  S.head = r.commit.sha; if (!S.tree.includes(path)) S.tree.push(path);
  S.rawCache[S.head + ':' + path] = text;
}
async function deleteFile(path, message) {
  const cur = await api(`/repos/${REPO}/contents/${encPath(path)}?ref=${BR}`);
  const r = await api(`/repos/${REPO}/contents/${encPath(path)}`, { method: 'DELETE', body: { message, sha: cur.sha, branch: BR } });
  S.head = r.commit.sha; S.tree = S.tree.filter(p => p !== path);
}
const dispatch = (wf, inputs) => api(`/repos/${REPO}/actions/workflows/${wf}/dispatches`, { method: 'POST', body: { ref: BR, inputs } });

/* ---------- Forge card list & Scryfall ---------- */
async function loadForge() {
  if (S.forge) return;
  const txt = await (await fetch('forge-cards.txt')).text();
  S.forge = new Map(); S.forgeLc = new Map();
  for (const line of txt.split('\n')) {
    if (!line || line[0] === '#') continue;
    const [n, f = ''] = line.split('\t');
    S.forge.set(n, f); S.forgeLc.set(n.toLowerCase(), n);
  }
  S.forgeNames = [...S.forge.keys()];
}
function forgeName(n) { if (!S.forge) return n; if (S.forge.has(n)) return n; const f = n.split(' // ')[0]; return S.forgeLc.get(f.toLowerCase()) || S.forgeLc.get(n.toLowerCase()) || null; }
function flagPill(name) {
  if (!S.forge) return '';
  if (!S.forge.has(name)) return '<span class="pill bad" title="Forge has no script for this card, so it can\'t be simulated">Not in Forge</span>';
  const f = S.forge.get(name);
  if (f === 'A') return '<span class="pill warn" title="Forge marks this card as one its AI can\'t play well. Sim results will likely undervalue it.">AI weak</span>';
  if (f === 'R') return '<span class="pill" title="Forge marks this card as one its AI plays unreliably. Results may undervalue it somewhat.">AI so-so</span>';
  return '';
}
async function sfLoad(names) {
  const need = [...new Set(names)].filter(n => !(n in S.sf));
  for (let i = 0; i < need.length; i += 75) {
    const chunk = need.slice(i, i + 75);
    try {
      const r = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifiers: chunk.map(name => ({ name })) }) });
      const j = await r.json();
      for (const c of j.data || []) {
        const face = c.card_faces ? c.card_faces[0] : null;
        const info = { type: (c.type_line || '').split(' // ')[0], cmc: c.cmc || 0, ci: c.color_identity || [], mana: c.mana_cost || face?.mana_cost || '', img: c.image_uris?.normal || face?.image_uris?.normal || '' };
        S.sf[c.name] = info; S.sf[c.name.split(' // ')[0]] = info;
        if (face) S.sf[face.name] = info;
      }
      for (const nf of j.not_found || []) S.sf[nf.name] = null;
    } catch { /* offline or blocked: leave unknown */ }
    for (const n of chunk) if (!(n in S.sf)) S.sf[n] = null;
    if (i + 75 < need.length) await sleep(110);
  }
}
const TYPE_ORDER = ['Commander', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other'];
function typeOf(name) { const t = S.sf[name]?.type || ''; for (const k of TYPE_ORDER.slice(1, -1)) if (t.includes(k)) return k; return S.sf[name] ? 'Other' : 'Other'; }

/* ---------- decks ---------- */
function parseDck(txt) {
  let sec = null; const d = { commander: [], main: [] };
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\[(\w+)\]/); if (m) { sec = m[1]; continue; }
    const c = line.match(/^(\d+)\s+(.+)$/);
    if (c && sec === 'Commander') d.commander.push(c[2].split('|')[0].trim());
    if (c && sec === 'Main') d.main.push({ n: +c[1], name: c[2].split('|')[0].trim() });
  }
  return d;
}
function toDck(name, d) { return `[metadata]\nName=${name}\n[Commander]\n${d.commander.map(c => '1 ' + c).join('\n')}${d.commander.length ? '\n' : ''}[Main]\n${d.main.map(r => r.n + ' ' + r.name).join('\n')}\n`; }
function toText(d) { return 'Commander\n' + d.commander.map(c => '1 ' + c).join('\n') + '\n\nDeck\n' + d.main.map(r => r.n + ' ' + r.name).join('\n') + '\n'; }
function parseText(txt) {
  // accepts Moxfield/Archidekt/MTGO style lists; "Commander" header or *CMDR* marks commanders
  const d = { commander: [], main: [] }; let sec = 'main'; const bad = [];
  for (let line of txt.split(/\r?\n/)) {
    line = line.trim(); if (!line || line.startsWith('#')) continue;
    const h = line.replace(/^\/\/\s*|^\[|\]$|:$/g, '').trim().toLowerCase();
    if (/^(commanders?|command zone)$/.test(h)) { sec = 'cmd'; continue; }
    if (/^(deck|main(board)?|mainboard|library|creatures?|lands?|instants?|sorcer(y|ies)|artifacts?|enchantments?|planeswalkers?|battles?|other|spells?)(\s*\(\d+\))?$/.test(h)) { sec = 'main'; continue; }
    if (/^(sideboard|maybeboard|considering|tokens?)/.test(h)) { sec = 'skip'; continue; }
    if (sec === 'skip') continue;
    let cmd = /\*CMDR\*/i.test(line);
    let m = line.match(/^(\d+)\s*x?\s+(.+)$/i); let n = 1, name = line;
    if (m) { n = +m[1]; name = m[2]; }
    name = name.replace(/\*[A-Z]+\*/gi, '').replace(/\s+\([A-Za-z0-9]{2,6}\)\s*[\w-]*\s*$/, '').replace(/\s+\[[^\]]+\]\s*$/, '').replace(/\s+#.*$/, '').trim();
    const fn = forgeName(name) || name.split(' // ')[0];
    if (!forgeName(name)) bad.push(name);
    if (sec === 'cmd' || cmd) d.commander.push(fn);
    else { const ex = d.main.find(r => r.name === fn); ex ? ex.n += n : d.main.push({ n, name: fn }); }
  }
  return { d, bad };
}
async function loadDeck(name) {
  if (S.decks[name]) return S.decks[name];
  const d = parseDck(await raw(`decks/${name}.dck`));
  return (S.decks[name] = d);
}
function deckNames() { return S.tree.filter(p => /^decks\/[^/]+\.dck$/.test(p)).map(p => p.slice(6, -4)); }
function myDecks() { return deckNames().filter(n => !isGen(n) && !OPP_DEFAULT.includes(n)).sort(); }

/* ---------- autocomplete ---------- */
function attachAuto(input, onPick, filter) {
  const wrap = input.parentElement; let list = null, items = [], idx = 0;
  const close = () => { list?.remove(); list = null; };
  const show = () => {
    const q = input.value.trim().toLowerCase(); close(); if (q.length < 2 || !S.forge) return;
    const pre = [], sub = [];
    for (const n of S.forgeNames) { const l = n.toLowerCase(); if (l.startsWith(q)) pre.push(n); else if (l.includes(q)) sub.push(n); if (pre.length > 40) break; }
    items = [...pre.sort((a, b) => a.length - b.length), ...sub].filter(n => !filter || filter(n)).slice(0, 12);
    if (!items.length) return; idx = 0;
    list = document.createElement('div'); list.className = 'ac-list';
    list.innerHTML = items.map((n, i) => `<div data-i="${i}" class="${i ? '' : 'on'}"><span>${esc(n)}</span>${flagPill(n)}</div>`).join('');
    list.addEventListener('mousedown', e => { const el = e.target.closest('[data-i]'); if (el) { e.preventDefault(); pick(items[+el.dataset.i]); } });
    wrap.appendChild(list);
  };
  const pick = n => { input.value = ''; close(); onPick(n); input.focus(); };
  input.addEventListener('input', show);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    if (!list) { if (e.key === 'Enter') { e.preventDefault(); const f = forgeName(input.value.trim()); if (f) pick(f); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; $$('[data-i]', list).forEach((el, i) => el.classList.toggle('on', i === idx)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(items[idx]); }
    else if (e.key === 'Escape') close();
  });
}

/* ---------- card hover preview ---------- */
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-card]'); const pv = $('#preview');
  if (!el) { pv.hidden = true; return; }
  const info = S.sf[el.dataset.card]; if (!info?.img) { pv.hidden = true; return; }
  pv.innerHTML = `<img src="${esc(info.img)}" alt="">`; pv.hidden = false;
  const r = el.getBoundingClientRect(); const left = r.right + 260 < innerWidth ? r.right + 14 : r.left - 258;
  pv.style.left = Math.max(8, left) + 'px'; pv.style.top = Math.min(innerHeight - 350, Math.max(70, r.top - 120)) + 'px';
});

/* ---------- results ---------- */
function parseResult(path, md) {
  const name = path.slice(8, -3); const peek = name.endsWith('_peek');
  const dm = md.match(/<!-- data (\{.*\}) -->/);
  let arms = [], gaps = [];
  if (dm) {
    const d = JSON.parse(dm[1]); arms = d.arms.map(a => ({ deck: a.deck, card: a.card, games: a.games, wins: a.wins, reused: a.reused || 0 }));
    const lab = a => a.card || a.deck;
    for (const [b, i] of d.compare) {
      const A = arms[b], B = arms[i]; const p0 = A.wins / Math.max(1, A.games), p1 = B.wins / Math.max(1, B.games);
      const se = Math.sqrt(p0 * (1 - p0) / Math.max(1, A.games) + p1 * (1 - p1) / Math.max(1, B.games));
      gaps.push({ label: lab(B), vs: lab(A), diff: 100 * (p1 - p0), ci: 196 * se });
    }
  } else {
    for (const m of md.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)%\s*\|$/gm)) arms.push({ deck: m[1], card: m[2], games: +m[3], wins: +m[4] });
    const baseHdr = (md.match(/Gaps vs ([^(]+?)\s*\(95%/) || [])[1];
    for (const m of md.matchAll(/^- \*\*(.+?): ([+-]?\d+(?:\.\d+)?) ± (\d+(?:\.\d+)?) points\*\*/gm)) {
      let label = m[1], vs = baseHdr || '';
      const v = label.match(/^(.+) vs (.+)$/); if (v) { label = v[1]; vs = v[2]; }
      gaps.push({ label, vs, diff: +m[2], ci: +m[3] });
    }
    for (const m of md.matchAll(/\*\*Gap \((\S+) − (\S+)\): ([+-]?\d+(?:\.\d+)?) ± (\d+(?:\.\d+)?) points\*\*/g)) {
      const card = dk => arms.find(a => a.deck === dk)?.card || dk;
      gaps.push({ label: card(m[1]), vs: card(m[2]), diff: +m[3], ci: +m[4] });
    }
  }
  const title = (md.match(/^# (.+)$/m) || [])[1] || name;
  const intro = (md.split('\n').find(l => l && !l.startsWith('#') && !l.startsWith('|')) || '');
  return { path, name, peek, title, intro, arms, gaps, games: arms.reduce((s, a) => s + a.games, 0) };
}
function verdict(g) {
  const lo = g.diff - g.ci, hi = g.diff + g.ci;
  if (lo > 0) return ['good', 'Better'];
  if (hi < 0) return ['bad', 'Worse'];
  if (Math.abs(g.diff) < 0.5) return ['', 'No difference'];
  return ['', g.diff > 0 ? 'Leans better' : 'Leans worse'];
}
function forestSVG(gaps) {
  const nar = innerWidth < 640; const W = nar ? 360 : 900, rowH = nar ? 30 : 36, padL = nar ? 120 : 250, padR = nar ? 44 : 80, H = gaps.length * rowH + 26;
  const span = Math.max(4, ...gaps.map(g => Math.abs(g.diff) + g.ci)) * 1.1;
  const x = v => padL + (v + span) / (2 * span) * (W - padL - padR);
  const step = span > 12 ? 5 : span > 6 ? 2 : 1; const ticks = [];
  for (let t = -Math.floor(span / step) * step; t <= span; t += step) ticks.push(t);
  const tks = nar ? ticks.filter((t, i) => i % 2 === ticks.indexOf(0) % 2) : ticks;
  let s = `<svg class="forest" viewBox="0 0 ${W} ${H}" role="img" aria-label="Win-rate gaps with 95% intervals">`;
  for (const t of tks) s += `<line class="ax" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - 20}"/><text class="tick" x="${x(t)}" y="${H - 5}" text-anchor="middle">${t > 0 ? '+' : ''}${t}</text>`;
  s += `<line class="zero" x1="${x(0)}" x2="${x(0)}" y1="0" y2="${H - 20}"/>`;
  gaps.forEach((g, i) => {
    const y = i * rowH + rowH / 2 + 2; const [cls] = verdict(g);
    const col = cls === 'good' ? 'var(--good)' : cls === 'bad' ? 'var(--bad)' : 'var(--muted)';
    const L = nar ? 17 : 32; const lab = g.label.length > L ? g.label.slice(0, L - 1) + '…' : g.label;
    s += `<text x="0" y="${y + 4}"><title>${esc(g.label)} vs ${esc(g.vs)}</title>${esc(lab)}</text>`;
    s += `<line x1="${x(g.diff - g.ci)}" x2="${x(g.diff + g.ci)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="4" stroke-linecap="round" opacity=".45"/>`;
    s += `<circle cx="${x(g.diff)}" cy="${y}" r="6" fill="${col}"/>`;
    s += `<text x="${W - padR + (nar ? 6 : 10)}" y="${y + 4}" class="num" font-weight="700" fill="${col}">${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)}</text>`;
  });
  return s + '</svg>';
}
async function loadResults() {
  const files = S.tree.filter(p => /^results\/[^/]+\.md$/.test(p));
  const dates = {};
  try {
    const cs = await api(`/repos/${REPO}/commits?path=results&per_page=100`);
    for (const c of cs) { const m = c.commit.message.match(/^(?:Results|Early read): (\S+)/); const k = m ? m[1] + (c.commit.message.startsWith('Early') ? '_peek' : '') : null; if (k && !dates[k]) dates[k] = c.commit.author.date; }
    for (const c of cs) for (const f of files) { const n = f.slice(8, -3); if (!dates[n] && c.commit.message.toLowerCase().includes(n.replace(/_/g, ' ').slice(0, 12))) dates[n] = c.commit.author.date; }
  } catch {}
  const out = await Promise.all(files.map(async f => { try { const r = parseResult(f, await raw(f)); r.date = dates[r.name]; return r; } catch { return null; } }));
  S.results = out.filter(r => r && r.arms.length).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
}
async function viewResults(v) {
  v.innerHTML = `<div class="pagehead"><div><h1>Results</h1><p class="muted">Win-rate change from each swap, with its 95% range. A range that crosses zero means no clear difference yet.</p></div>
    <input id="rsearch" placeholder="Filter by card or test…" style="max-width:280px" value="${esc(S.search)}"></div><div id="rlist" class="results"><div class="empty"><span class="spin"></span> Loading results…</div></div>`;
  $('#rsearch').addEventListener('input', e => { S.search = e.target.value; drawResults(); });
  if (!S.results) await loadResults();
  drawResults();
}
function drawResults() {
  const el = $('#rlist'); if (!el) return;
  const q = S.search.trim().toLowerCase();
  const list = S.results.filter(r => !q || r.name.includes(q.replace(/\s+/g, '_')) || r.arms.some(a => (a.card + ' ' + a.deck).toLowerCase().includes(q)));
  if (!list.length) { el.innerHTML = '<div class="empty">No results match.</div>'; return; }
  el.innerHTML = list.map(r => {
    const best = r.gaps.map(verdict);
    return `<article class="card">
      <div class="res-head"><div><div class="res-title">${esc(prettyName(r.name))}</div>
        <div class="muted small">${r.games.toLocaleString()} games${r.date ? ' · ' + esc(ago(r.date)) : ''}</div></div>
        <div class="row">${r.peek ? '<span class="pill gold">Early read · run still going</span>' : ''}${best.map((b, i) => b[0] ? `<span class="pill ${b[0]}">${esc(r.gaps[i].label.split(',')[0])}: ${b[1]}</span>` : '').join('')}</div></div>
      ${r.gaps.length ? forestSVG(r.gaps) : ''}
      <details><summary>Details</summary><p class="small muted">${esc(r.intro)}</p><table><thead><tr><th>List</th><th>Card tested</th><th class="r">Games</th><th class="r">Win rate</th></tr></thead><tbody>
      ${r.arms.map(a => `<tr><td>${esc(a.deck)}</td><td>${esc(a.card || '—')}</td><td class="r num">${a.games.toLocaleString()}${a.reused ? ` <span class="muted small">(${a.reused.toLocaleString()} reused)</span>` : ''}</td><td class="r num">${(100 * a.wins / Math.max(1, a.games)).toFixed(1)}%</td></tr>`).join('')}
      </tbody></table><p class="small muted">${r.gaps.map(g => `${esc(g.label)} vs ${esc(g.vs)}: ${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)} ± ${g.ci.toFixed(1)} points`).join('<br>')}</p></details>
    </article>`;
  }).join('');
}

/* ---------- decks view ---------- */
async function viewDecks(v) {
  const mine = myDecks();
  if (!S.deck) S.deck = { name: mine.includes('SiskoFinal') ? 'SiskoFinal' : mine[0] || '', d: null, isNew: false };
  v.innerHTML = `<div class="decks"><aside class="decklist">
      <button class="primary" id="newDeck" style="text-align:center;margin-bottom:6px">+ New deck</button>
      <h3>Your decks</h3>${mine.map(n => `<button data-deck="${esc(n)}" class="${S.deck.name === n ? 'on' : ''}">${esc(n)}</button>`).join('')}
      <h3>Opponent pool</h3>${OPP_DEFAULT.filter(n => deckNames().includes(n)).map(n => `<button data-deck="${esc(n)}" class="${S.deck.name === n ? 'on' : ''}">${esc(n)}</button>`).join('')}
    </aside><section id="editor"></section></div>`;
  $$('[data-deck]', v).forEach(b => b.onclick = async () => { if (S.deckDirty && !confirm('Discard unsaved changes?')) return; S.deck = { name: b.dataset.deck, d: null }; S.deckDirty = false; S.deckText = false; viewDecks(v); });
  $('#newDeck').onclick = () => { if (S.deckDirty && !confirm('Discard unsaved changes?')) return; S.deck = { name: '', d: { commander: [], main: [] }, isNew: true }; S.deckDirty = false; S.deckText = true; viewDecks(v); };
  const ed = $('#editor');
  if (!S.deck.d && S.deck.name) { ed.innerHTML = '<div class="empty"><span class="spin"></span></div>'; S.deck.d = structuredClone(await loadDeck(S.deck.name)); }
  if (!S.deck.d) { ed.innerHTML = '<div class="empty">No decks yet.</div>'; return; }
  drawEditor();
  const d = S.deck.d; await sfLoad([...d.commander, ...d.main.map(r => r.name)]); if (S.tab === 'decks') drawEditor();
}
function deckStats(d) {
  const count = d.commander.length + d.main.reduce((s, r) => s + r.n, 0);
  const ci = new Set(); d.commander.forEach(c => (S.sf[c]?.ci || []).forEach(x => ci.add(x)));
  const curve = Array(8).fill(0); let mv = 0, nonland = 0;
  for (const r of d.main) { const t = S.sf[r.name]; if (!t || t.type.includes('Land')) continue; const c = Math.min(7, Math.round(t.cmc)); curve[c] += r.n; mv += t.cmc * r.n; nonland += r.n; }
  const issues = [];
  if (count !== 100) issues.push(`${count} cards (Commander decks are 100)`);
  for (const r of d.main) if (r.n > 1 && !/^(Plains|Island|Swamp|Mountain|Forest|Wastes|Snow-Covered .+)$/.test(r.name) && !/any number of cards named/i.test(S.sf[r.name]?.type || '')) issues.push(`${r.n} copies of ${r.name}`);
  if (ci.size) { const off = d.main.filter(r => { const c = S.sf[r.name]?.ci; return c && c.some(x => !ci.has(x)); }).map(r => r.name);
    if (off.length) issues.push(`Outside the commander's colors (${off.length}): ${off.slice(0, 8).join(', ')}${off.length > 8 ? '…' : ''}`); }
  const missing = [...d.commander, ...d.main.map(r => r.name)].filter(n => S.forge && !S.forge.has(n));
  return { count, ci: [...ci], curve, avg: nonland ? mv / nonland : 0, issues, missing };
}
function drawEditor() {
  const ed = $('#editor'); if (!ed) return; const { d } = S.deck; const st = deckStats(d);
  const groups = {}; d.commander.forEach(c => (groups.Commander ||= []).push({ n: 1, name: c, cmd: true }));
  d.main.forEach(r => (groups[typeOf(r.name)] ||= []).push(r));
  const mx = Math.max(1, ...st.curve); const pips = { W: '#f3ead0', U: '#4a90d9', B: '#4b4542', R: '#d9533f', G: '#3f9a5a' };
  const weak = [...d.commander, ...d.main.map(r => r.name)].filter(n => S.forge?.get(n) === 'A');
  ed.innerHTML = `<div class="card stack">
    <div class="row"><input id="dname" class="grow" style="max-width:320px;font-weight:700;font-size:17px" placeholder="DeckName (letters, digits, -)" value="${esc(S.deck.name)}" ${S.deck.isNew ? '' : 'readonly title="Use Save as to copy under a new name"'}>
      <span class="grow"></span>
      <button id="txtBtn" class="ghost">${S.deckText ? 'Visual view' : 'Edit as text'}</button>
      ${S.deck.isNew ? '' : '<button id="saveAs">Save as…</button><button id="testIt">Test a swap</button>'}
      <button id="saveDeck" class="primary" ${S.deckDirty || S.deck.isNew ? '' : 'disabled'}>Save</button></div>
    <div class="stats">
      <div class="stat"><b class="num">${st.count}</b><span>cards</span></div>
      <div class="stat"><b>${st.ci.length ? st.ci.map(c => `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${pips[c]};border:1px solid var(--line);margin-right:2px"></span>`).join('') : '—'}</b><span>colors</span></div>
      <div class="stat"><b class="num">${st.avg.toFixed(2)}</b><span>avg mana value</span></div>
      <div class="stat"><div class="curve">${st.curve.map((c, i) => `<div style="height:${(c / mx) * 44 + 2}px" title="${c} at ${i}${i === 7 ? '+' : ''}"><span>${i}${i === 7 ? '+' : ''}</span></div>`).join('')}</div><span style="display:block;margin-top:16px">curve</span></div>
    </div>
    ${st.missing.length ? `<div class="note bad"><b>Not in Forge:</b> ${st.missing.map(esc).join(', ')}. These can't be simulated; fix the name or swap them out.</div>` : ''}
    ${weak.length ? `<div class="note"><b>Forge's AI plays these poorly:</b> ${weak.map(esc).join(', ')}. Tests will tend to undervalue them.</div>` : ''}
    ${st.issues.length ? `<div class="note">${st.issues.map(esc).join('<br>')}</div>` : ''}
    ${S.deckText ? `<textarea id="dtext" spellcheck="false" placeholder="Paste a list: Moxfield, Archidekt or plain '1 Sol Ring' lines. Put commanders under a 'Commander' line.">${esc(d.commander.length || d.main.length ? toText(d) : '')}</textarea>
      <div class="row end"><button id="applyText" class="primary">Apply</button></div>` :
      `<div class="row"><div class="ac grow" style="max-width:420px"><input id="addCard" placeholder="Add a card…"></div>
        <label class="chk"><input type="checkbox" id="asCmd"> as commander</label></div>
      <div class="groups">${TYPE_ORDER.filter(t => groups[t]).map(t => `<div class="group"><h3>${t} <span class="muted">${groups[t].reduce((s, r) => s + r.n, 0)}</span></h3>
        ${groups[t].sort((a, b) => (S.sf[a.name]?.cmc ?? 99) - (S.sf[b.name]?.cmc ?? 99) || a.name.localeCompare(b.name)).map(r => `<div class="crow"><span class="q">${r.n}</span><span class="n" data-card="${esc(r.name)}">${esc(r.name)}</span>${flagPill(r.name)}<span class="mana">${esc((S.sf[r.name]?.mana || '').replace(/[{}]/g, ''))}</span><button class="x" data-rm="${esc(r.name)}" data-cmd="${r.cmd ? 1 : ''}" title="Remove">×</button></div>`).join('')}</div>`).join('')}</div>`}
  </div>`;
  const dirty = () => { S.deckDirty = true; drawEditor(); };
  $('#txtBtn').onclick = () => { S.deckText = !S.deckText; drawEditor(); };
  $('#saveDeck').onclick = () => saveDeck(false);
  $('#saveAs') && ($('#saveAs').onclick = () => saveDeck(true));
  $('#testIt') && ($('#testIt').onclick = () => { S.test.mode = 'swap'; S.test.base = S.deck.name; S.test.slots = [{ out: '', ins: [] }]; go('test'); });
  if (S.deck.isNew) $('#dname').oninput = e => S.deck.name = e.target.value.trim();
  if (S.deckText) {
    $('#applyText').onclick = async () => {
      await loadForge(); const { d: nd, bad } = parseText($('#dtext').value);
      S.deck.d = nd; S.deckText = false; S.deckDirty = true; drawEditor();
      if (bad.length) toast(`${bad.length} card name(s) not found in Forge: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}`, true);
      await sfLoad([...nd.commander, ...nd.main.map(r => r.name)]); drawEditor();
    };
  } else {
    attachAuto($('#addCard'), async n => {
      if ($('#asCmd').checked) { if (!d.commander.includes(n)) d.commander.push(n); }
      else { const ex = d.main.find(r => r.name === n); ex ? ex.n++ : d.main.push({ n: 1, name: n }); }
      await sfLoad([n]); dirty(); $('#addCard')?.focus();
    });
    $$('[data-rm]').forEach(b => b.onclick = () => {
      const n = b.dataset.rm;
      if (b.dataset.cmd) d.commander = d.commander.filter(c => c !== n);
      else { const r = d.main.find(x => x.name === n); if (r && --r.n <= 0) d.main = d.main.filter(x => x !== r); }
      dirty();
    });
  }
}
async function saveDeck(as) {
  if (needToken()) return;
  let name = S.deck.name;
  if (as) { name = prompt('Save a copy as (letters, digits, dashes):', name + '-v2'); if (!name) return; }
  name = name.trim();
  if (!/^[A-Za-z][A-Za-z0-9-]{1,40}$/.test(name)) { toast('Deck names: start with a letter; letters, digits and dashes only.', true); return; }
  if ((as || S.deck.isNew) && deckNames().includes(name) && !confirm(`${name} already exists. Overwrite it?`)) return;
  if (OPP_DEFAULT.includes(name) && !confirm(`${name} is in the opponent pool. Changing it changes every future test. Continue?`)) return;
  const btn = $('#saveDeck'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try {
    await putFile(`decks/${name}.dck`, toDck(name, S.deck.d), `Deck Lab: save ${name}`);
    S.decks[name] = structuredClone(S.deck.d); S.deck = { name, d: S.deck.d, isNew: false }; S.deckDirty = false;
    toast(`Saved ${name}`); viewDecks($('#view'));
  } catch (e) { toast('Save failed: ' + e.message, true); btn.disabled = false; btn.textContent = 'Save'; }
}

/* ---------- new test ---------- */
function estimate(arms, minutes) {
  const n = Math.round(SHARDS * 4 / arms * minutes * GPM);
  const pm = 196 * Math.sqrt(2 * BASE_P * (1 - BASE_P) / n);
  const total = minutes + 15; return { n, pm, total };
}
async function viewTest(v) {
  const T = S.test; const mine = myDecks();
  if (!T.base || !mine.includes(T.base)) T.base = mine.includes('SiskoFinal') ? 'SiskoFinal' : mine[0];
  const base = T.base ? await loadDeck(T.base) : { main: [], commander: [] };
  await sfLoad(base.main.map(r => r.name));
  const arms = T.mode === 'swap' ? T.slots.reduce((s, sl) => s + 1 + sl.ins.length, 0) : T.decks.filter(Boolean).length;
  const est = estimate(Math.max(2, arms), T.minutes);
  const inDeck = new Set([...base.main.map(r => r.name), ...base.commander]);
  const flagged = T.mode === 'swap' ? T.slots.flatMap(s => s.ins).filter(n => S.forge?.get(n) === 'A') : [];
  const autoName = T.mode === 'swap'
    ? T.slots.filter(s => s.out && s.ins.length).map(s => s.ins.map(c => c.split(',')[0]).join(' and ') + ' for ' + s.out.split(',')[0]).join('; ')
    : T.decks.filter(Boolean).join(' vs ');
  const allOpp = deckNames().filter(n => !isGen(n) && !(T.mode === 'decks' ? T.decks : [T.base]).includes(n));
  const oppList = [...OPP_DEFAULT.filter(n => allOpp.includes(n)), ...allOpp.filter(n => !OPP_DEFAULT.includes(n)).sort()];
  v.innerHTML = `<div class="pagehead"><div><h1>New test</h1><p class="muted">Each version plays thousands of 4-player pods against the same opponents and seats, so only the change differs.</p></div>
      <div class="seg"><button data-mode="swap" class="${T.mode === 'swap' ? 'on' : ''}">Swap cards</button><button data-mode="decks" class="${T.mode === 'decks' ? 'on' : ''}">Compare whole decks</button></div></div>
    <div class="card stack">
    ${T.mode === 'swap' ? `
      <label class="fld"><span>Base deck</span><select id="tbase">${mine.map(n => `<option ${n === T.base ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      ${T.slots.map((s, i) => `<div class="slot stack" data-slot="${i}">
        <div class="row"><b>Slot ${i + 1}</b><span class="grow"></span>${T.slots.length > 1 ? `<button class="sm ghost danger" data-delslot="${i}">Remove slot</button>` : ''}</div>
        <div class="grid2">
          <label class="fld"><span>Take out</span><select data-out="${i}"><option value="">Choose a card…</option>${[...base.main].sort((a, b) => a.name.localeCompare(b.name)).map(r => `<option ${r.name === s.out ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
          <label class="fld"><span>Try instead (each is its own version)</span><div class="ac"><input data-in="${i}" placeholder="Search Forge's card list…"></div></label>
        </div>
        <div class="row">${s.ins.map((c, j) => `<span class="chip" data-card="${esc(c)}">${esc(c)} ${flagPill(c)}<button data-delin="${i}:${j}" aria-label="Remove">×</button></span>`).join('') || '<span class="muted small">No cards yet.</span>'}</div>
      </div>`).join('')}
      <div><button class="sm" id="addSlot">+ Test another slot</button> <span class="muted small">Each slot also runs the original card as its baseline.</span></div>`
    : `<div class="grid2">${T.decks.map((dn, i) => `<label class="fld"><span>${i ? 'Challenger ' + i : 'Baseline'}</span><select data-dk="${i}"><option value="">${i > 1 ? '(none)' : 'Choose…'}</option>${mine.map(n => `<option ${n === dn ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`).join('')}</div>
      ${T.decks.length < 4 ? '<div><button class="sm" id="addDk">+ Add a deck</button></div>' : ''}
      <p class="small muted">Nothing is forced into the opening hand here, so differences need more games to show up than a single-card swap.</p>`}
      <div class="fld"><span>Opponents (${T.opps.length} selected, each pod draws 3)</span><div class="row">${[...new Set([...OPP_DEFAULT.filter(n => oppList.includes(n)), ...T.opps])].map(n => `<label class="chk ${T.opps.includes(n) ? 'on' : ''}"><input type="checkbox" data-opp="${esc(n)}" ${T.opps.includes(n) ? 'checked' : ''}>${esc(n)}</label>`).join('')}
        <select id="addOpp" style="width:auto"><option value="">+ Add a deck…</option>${oppList.filter(n => !OPP_DEFAULT.includes(n) && !T.opps.includes(n)).map(n => `<option>${esc(n)}</option>`).join('')}</select></div></div>
      <div class="grid2">
        <label class="fld"><span>Run length</span><select id="tmin">${[40, 80, 120, 160].map(m => `<option value="${m}" ${m === T.minutes ? 'selected' : ''}>${m} minutes of games</option>`).join('')}</select></label>
        <label class="fld"><span>Name</span><input id="tname" placeholder="${esc(autoName || 'Test name')}" value="${esc(T.name)}"></label>
      </div>
      <div class="est"><div class="stat"><b class="num">~${est.n.toLocaleString()}</b><span>games per version</span></div>
        <div class="stat"><b class="num">±${est.pm.toFixed(1)}</b><span>points, 95% range on each gap</span></div>
        <div class="stat"><b class="num">~${Math.round(est.total / 6) / 10} h</b><span>once it starts</span></div></div>
      <p class="small muted" style="margin:0">Versions already played with this exact deck, card and opponents reuse those games, so the others get more of the run, and a test that's fully covered returns right away.</p>
      ${flagged.length ? `<div class="note">Forge's AI plays ${flagged.map(esc).join(', ')} poorly, so a loss here may mean the AI misplays it rather than the card being weak.</div>` : ''}
      <div class="row end"><span id="terr" class="small" style="color:var(--bad)"></span><button class="primary" id="queueBtn">Queue test</button></div>
    </div>`;
  $$('[data-mode]').forEach(b => b.onclick = () => { T.mode = b.dataset.mode; if (T.mode === 'decks' && !T.decks[0]) T.decks = [T.base, '']; viewTest(v); });
  if (T.mode === 'swap') {
    $('#tbase').onchange = e => { T.base = e.target.value; T.slots = [{ out: '', ins: [] }]; viewTest(v); };
    $$('[data-out]').forEach(s => s.onchange = () => { T.slots[+s.dataset.out].out = s.value; viewTest(v); });
    $$('[data-in]').forEach(inp => attachAuto(inp, n => { const sl = T.slots[+inp.dataset.in]; if (inDeck.has(n)) { toast(`${n} is already in ${T.base}`, true); return; } if (!sl.ins.includes(n)) sl.ins.push(n); sfLoad([n]); viewTest(v).then(() => $(`[data-in="${inp.dataset.in}"]`)?.focus()); }, n => !inDeck.has(n)));
    $$('[data-delin]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.delin.split(':').map(Number); T.slots[i].ins.splice(j, 1); viewTest(v); });
    $$('[data-delslot]').forEach(b => b.onclick = () => { T.slots.splice(+b.dataset.delslot, 1); viewTest(v); });
    $('#addSlot').onclick = () => { T.slots.push({ out: '', ins: [] }); viewTest(v); };
  } else {
    $$('[data-dk]').forEach(s => s.onchange = () => { T.decks[+s.dataset.dk] = s.value; viewTest(v); });
    $('#addDk') && ($('#addDk').onclick = () => { T.decks.push(''); viewTest(v); });
  }
  $$('[data-opp]').forEach(c => c.onchange = () => { const n = c.dataset.opp; T.opps = c.checked ? [...T.opps, n] : T.opps.filter(x => x !== n); viewTest(v); });
  $('#addOpp').onchange = e => { if (e.target.value) { T.opps.push(e.target.value); viewTest(v); } };
  $('#tmin').onchange = e => { T.minutes = +e.target.value; viewTest(v); };
  $('#tname').oninput = e => T.name = e.target.value;
  $('#queueBtn').onclick = () => queueTest(autoName);
}
async function queueTest(autoName) {
  const T = S.test, err = m => { $('#terr').textContent = m; };
  let req;
  if (T.mode === 'swap') {
    const slots = T.slots.filter(s => s.out && s.ins.length);
    if (!slots.length) return err('Pick a card to take out and at least one to try.');
    if (T.slots.some(s => (s.out && !s.ins.length) || (!s.out && s.ins.length))) return err('Every slot needs a card out and at least one card in.');
    if (new Set(slots.map(s => s.out)).size !== slots.length) return err('Each slot must take out a different card.');
    req = { mode: 'swap', base: T.base, slots: slots.map(s => ({ out: s.out, ins: s.ins })) };
  } else {
    const ds = T.decks.filter(Boolean);
    if (ds.length < 2 || new Set(ds).size !== ds.length) return err('Choose at least two different decks.');
    req = { mode: 'decks', decks: ds };
  }
  const arms = req.mode === 'swap' ? req.slots.reduce((s, x) => s + 1 + x.ins.length, 0) : req.decks.length;
  if (arms > 8) return err('Keep it to 8 versions or fewer per test (split it into two tests).');
  if (T.opps.length < 3) return err('Pick at least 3 opponents.');
  if (needToken()) return;
  const name = (T.name || autoName || 'test').trim();
  Object.assign(req, { name, minutes: T.minutes, shards: SHARDS, opponents: T.opps, submitted: new Date().toISOString() });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const file = `queue/${stamp}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.json`;
  const b = $('#queueBtn'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Queuing';
  try {
    await putFile(file, JSON.stringify(req, null, 2) + '\n', `Deck Lab: queue ${name}`);
    T.slots = [{ out: '', ins: [] }]; T.name = '';
    toast('Queued. It starts as soon as the runners are free.'); S.runs = null; go('runs');
  } catch (e) { toast('Could not queue: ' + e.message, true); b.disabled = false; b.textContent = 'Queue test'; }
}

/* ---------- runs ---------- */
async function loadRuns() {
  const r = await api(`/repos/${REPO}/actions/workflows/swaptest.yml/runs?per_page=8`);
  const runs = await Promise.all(r.workflow_runs.map(async w => {
    let req = null; try { req = JSON.parse(await raw('tests/request.json', w.head_sha)); } catch {}
    return { id: w.id, status: w.status, conclusion: w.conclusion, started: w.run_started_at || w.created_at, updated: w.updated_at, url: w.html_url, req };
  }));
  const qfiles = S.tree.filter(p => /^queue\/.+\.json$/.test(p)).sort();
  const queue = await Promise.all(qfiles.map(async p => { try { return { path: p, req: JSON.parse(await raw(p)) }; } catch { return { path: p, req: null }; } }));
  S.runs = { runs, queue, at: Date.now() };
}
function reqSummary(q) {
  if (!q) return '';
  if (q.mode === 'decks' || (!q.slots && q.decks)) return (q.decks || []).join(' vs ');
  if (q.slots) return q.slots.map(s => `${s.ins.join(', ')} in for ${s.out}`).join(' · ');
  if (q.arms) return q.arms.map(a => a.card || a.deck).filter((x, i, A) => A.indexOf(x) === i).join(' · ');
  return '';
}
async function viewRuns(v) {
  v.innerHTML = `<div class="pagehead"><div><h1>Runs</h1><p class="muted">Tests run one at a time on 38 GitHub runners. Queued tests start automatically.</p></div><button id="rrefresh" class="sm">Refresh</button></div><div id="runsBody"><div class="empty"><span class="spin"></span></div></div>`;
  $('#rrefresh').onclick = async () => { await loadTree().catch(() => {}); S.runs = null; viewRuns(v); };
  try { if (!S.runs || Date.now() - S.runs.at > 20000) await loadRuns(); } catch (e) { $('#runsBody').innerHTML = `<div class="note bad">Couldn't load runs: ${esc(e.message)}${S.token ? '' : '. Without a token GitHub allows 60 requests an hour; adding one lifts that.'}</div>`; return; }
  drawRuns();
  clearInterval(S.runTimer);
  S.runTimer = setInterval(async () => { if (S.tab !== 'runs') return clearInterval(S.runTimer); try { await loadTree(); await loadRuns(); drawRuns(); } catch {} }, S.token ? 45000 : 150000);
}
function drawRuns() {
  const el = $('#runsBody'); if (!el) return; const { runs, queue } = S.runs;
  const active = runs.filter(r => r.status !== 'completed').sort((a, b) => (b.status === 'in_progress') - (a.status === 'in_progress'));
  const badge = $('#runBadge'); const n = active.length + queue.length; badge.hidden = !n; badge.textContent = n;
  const card = r => {
    const q = r.req || {}; const mins = (q.minutes || 160) + 15; const el = (Date.now() - new Date(r.started)) / 60000;
    const running = r.status === 'in_progress', waiting = r.status !== 'completed' && !running;
    const pct = r.status === 'completed' ? 100 : running ? Math.min(98, el / mins * 100) : 0;
    const eta = new Date(new Date(r.started).getTime() + mins * 60000);
    const resName = q.name; const hasRes = S.tree.includes(`results/${resName}.md`), hasPeek = S.tree.includes(`results/${resName}_peek.md`);
    const st = running ? `<span class="pill gold">Running · ${Math.round(el)} min</span>` : waiting ? '<span class="pill">Waiting for runners</span>'
      : r.conclusion === 'success' ? '<span class="pill good">Done</span>' : r.conclusion === 'cancelled' ? '<span class="pill">Cancelled</span>' : `<span class="pill bad">${esc(r.conclusion || 'failed')}</span>`;
    return `<div class="card"><div class="res-head"><div><div class="res-title">${esc(prettyName(resName || 'unknown test'))}</div><div class="small muted">${esc(reqSummary(q))}</div></div>${st}</div>
      ${r.status !== 'completed' ? `<div class="prog"><div style="width:${pct}%"></div></div><div class="small muted">${running ? `Results around ${fmtTime(eta)}` : 'Starts when the current run finishes'}${hasPeek ? ' · early read available' : ''}</div>` : `<div class="small muted" style="margin-top:6px">Finished ${esc(ago(r.updated))}</div>`}
      <div class="row" style="margin-top:10px">
        ${(hasRes || hasPeek) ? `<button class="sm" data-goto="${esc(resName)}">View ${hasRes ? 'results' : 'early read'}</button>` : ''}
        ${running && el > 25 ? `<button class="sm" data-peek="${r.id}">Get early read</button>` : ''}
        ${r.status !== 'completed' ? `<button class="sm ghost danger" data-cancel="${r.id}">Cancel</button>` : ''}
        <a class="small" href="${esc(r.url)}" target="_blank" rel="noopener" style="margin-left:auto">GitHub run ↗</a></div></div>`;
  };
  el.innerHTML = `<div class="stack">
    ${active.length ? `<h2>Now</h2>${active.map(card).join('')}` : '<div class="card muted">No test running.</div>'}
    <h2 style="margin-top:22px">Queue</h2>${queue.length ? queue.map((q, i) => `<div class="card row"><div class="grow"><b>${i + 1}. ${esc(q.req?.name || q.path)}</b><div class="small muted">${esc(reqSummary(q.req))} · ${q.req?.minutes || '?'} min</div></div><button class="sm ghost danger" data-unq="${esc(q.path)}">Remove</button></div>`).join('') : '<div class="card muted small">Nothing queued. Start one from New test.</div>'}
    <h2 style="margin-top:22px">Recent</h2>${runs.filter(r => r.status === 'completed').slice(0, 5).map(card).join('') || '<div class="muted">None yet.</div>'}
  </div>`;
  $$('[data-goto]').forEach(b => b.onclick = () => { S.search = b.dataset.goto.replace(/_/g, ' '); S.results = null; go('results'); });
  $$('[data-peek]').forEach(b => b.onclick = async () => { if (needToken()) return; b.disabled = true; try { await dispatch('peek.yml', { run_id: b.dataset.peek }); toast('Early read requested. It lands in Results in about 5 minutes.'); } catch (e) { toast(e.message, true); b.disabled = false; } });
  $$('[data-cancel]').forEach(b => b.onclick = async () => { if (needToken() || !confirm('Cancel this run? Games played so far are still tallied.')) return; try { await api(`/repos/${REPO}/actions/runs/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast('Cancelling…'); } catch (e) { toast(e.message, true); } });
  $$('[data-unq]').forEach(b => b.onclick = async () => { if (needToken() || !confirm('Remove this queued test?')) return; try { await deleteFile(b.dataset.unq, 'Deck Lab: remove queued test'); S.runs.queue = S.runs.queue.filter(q => q.path !== b.dataset.unq); drawRuns(); } catch (e) { toast(e.message, true); } });
}

/* ---------- shell ---------- */
async function go(tab) {
  S.tab = tab; lsSet('tab', tab); if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = $('#view'); $('#preview').hidden = true;
  try {
    if (tab === 'results') await viewResults(v);
    else if (tab === 'decks') await viewDecks(v);
    else if (tab === 'test') await viewTest(v);
    else if (tab === 'runs') await viewRuns(v);
  } catch (e) { v.innerHTML = `<div class="note bad">Something went wrong: ${esc(e.message)}</div>`; console.error(e); }
}
function openSettings() { $('#tokenIn').value = S.token; $('#settings').showModal(); }
function setToken(t) { S.token = t; lsSet('ghToken', t || null); $('#keyDot').classList.toggle('ok', !!t); }
async function boot() {
  $('#keyDot').classList.toggle('ok', !!S.token);
  $$('.tabs button').forEach(b => b.onclick = () => { if (S.tab === 'decks' && S.deckDirty && b.dataset.tab !== 'decks' && !confirm('Discard unsaved deck changes?')) return; go(b.dataset.tab); });
  $('#settingsBtn').onclick = openSettings;
  $('#settings').addEventListener('close', async () => {
    const v = $('#settings').returnValue;
    if (v === 'clear') { setToken(''); toast('Token removed from this browser.'); }
    if (v === 'save') {
      const t = $('#tokenIn').value.trim(); if (!t) return;
      setToken(t);
      try { const r = await api(`/repos/${REPO}`); toast(r.permissions?.push ? 'Token works: you can save decks and queue tests.' : 'Token is read-only for this repo. Give it Contents and Actions write.', !r.permissions?.push); }
      catch (e) { toast('Token check failed: ' + e.message, true); }
    }
  });
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t !== S.tab && ['results', 'decks', 'test', 'runs'].includes(t)) go(t); });
  window.addEventListener('beforeunload', e => { if (S.deckDirty) { e.preventDefault(); e.returnValue = ''; } });
  $('#view').innerHTML = '<div class="empty"><span class="spin"></span> Loading…</div>';
  try { await Promise.all([loadTree(), loadForge()]); }
  catch (e) { $('#view').innerHTML = `<div class="note bad">Couldn't reach GitHub: ${esc(e.message)}</div>`; return; }
  const want = location.hash.slice(1) || lsGet('tab') || 'results';
  go(['results', 'decks', 'test', 'runs'].includes(want) ? want : 'results');
  // runs badge on load
  loadRuns().then(() => { const n = S.runs.runs.filter(r => r.status !== 'completed').length + S.runs.queue.length; const b = $('#runBadge'); b.hidden = !n; b.textContent = n; }).catch(() => {});
}
boot();
