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
  test: { mode: 'swap', base: '', slots: [{ out: '', ins: [] }], packages: [{ out: [], in: [] }], decks: ['', ''], opps: [...OPP_DEFAULT], precision: 1.5, name: '' },
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
        const info = { type: (c.type_line || '').split(' // ')[0], cmc: c.cmc || 0, ci: c.color_identity || [], mana: c.mana_cost || face?.mana_cost || '', img: c.image_uris?.normal || face?.image_uris?.normal || '', art: c.image_uris?.art_crop || face?.image_uris?.art_crop || '' };
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
function myDecks() { return deckNames().filter(n => !isGen(n) && !OPP_DEFAULT.includes(n) && !(S.lab ? poolDecks() : []).includes(n)).sort(); }

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
    const d = JSON.parse(dm[1]); var pool = poolOf(d.opponents); arms = d.arms.map(a => ({ deck: a.deck, card: a.card, label: a.label, swap: a.swap, games: a.games, wins: a.wins, reused: a.reused || 0 }));
    const lab = a => a.label || a.card || a.deck;
    for (const [b, i] of d.compare) {
      const A = arms[b], B = arms[i]; const p0 = A.wins / Math.max(1, A.games), p1 = B.wins / Math.max(1, B.games);
      const se = Math.sqrt(p0 * (1 - p0) / Math.max(1, A.games) + p1 * (1 - p1) / Math.max(1, B.games));
      gaps.push({ label: lab(B), vs: lab(A), diff: 100 * (p1 - p0), ci: 196 * se, base: A.deck, mode: d.mode || 'swap', games: B.games, swap: B.swap, other: B.deck, pool, aswap: A.swap, agames: A.games });
    }
  } else {
    for (const m of md.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+)%\s*\|$/gm)) arms.push({ deck: m[1], card: m[2], games: +m[3], wins: +m[4] });
    const baseHdr = (md.match(/Gaps vs ([^(]+?)\s*\(95%/) || [])[1];
    for (const m of md.matchAll(/^- \*\*(.+?): ([+-]?\d+(?:\.\d+)?) ± (\d+(?:\.\d+)?) points\*\*/gm)) {
      let label = m[1], vs = baseHdr || '';
      const v = label.match(/^(.+) vs (.+)$/); if (v) { label = v[1]; vs = v[2]; }
      gaps.push({ label, vs, diff: +m[2], ci: +m[3], base: arms[0]?.deck, mode: 'swap', games: arms.find(a => a.card === label)?.games });
    }
    for (const m of md.matchAll(/\*\*Gap \((\S+) − (\S+)\): ([+-]?\d+(?:\.\d+)?) ± (\d+(?:\.\d+)?) points\*\*/g)) {
      const card = dk => arms.find(a => a.deck === dk)?.card || dk;
      gaps.push({ label: card(m[1]), vs: card(m[2]), diff: +m[3], ci: +m[4], base: arms[0]?.deck, mode: 'swap', games: arms.find(a => a.deck === m[1])?.games });
    }
  }
  const title = (md.match(/^# (.+)$/m) || [])[1] || name;
  const intro = (md.split('\n').find(l => l && !l.startsWith('#') && !l.startsWith('|')) || '');
  for (const g of gaps) g.pool ||= '3';
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
/* ---------- deck manifest ---------- */
async function loadLab() {
  try { S.lab = JSON.parse(await raw('decks/lab.json')); } catch { S.lab = { decks: myDecks().map(name => ({ name })) }; }
  S.lab.decks = S.lab.decks.filter(d => deckNames().includes(d.name));
  if (!S.test.oppsTouched) S.test.opps = [...(POOLS()[3]?.decks || OPP_DEFAULT)];
}
const primary = () => S.lab.decks.map(d => d.name);
const POOLS = () => S.lab.pools || { 3: { label: 'Bracket 3', decks: OPP_DEFAULT } };
const poolDecks = () => Object.values(POOLS()).flatMap(p => p.decks);
const deckBracket = n => S.lab.decks.find(d => d.name === n)?.bracket || 3;
function poolOf(opps) {
  const o = [...(opps || OPP_DEFAULT)].sort().join('|');
  for (const [b, p] of Object.entries(POOLS())) if ([...p.decks].sort().join('|') === o) return b;
  return 'custom';
}
const poolName = b => b === 'custom' ? 'custom opponents' : `bracket ${b}`;
const deckTitle = n => S.lab.decks.find(d => d.name === n)?.title || n;
async function addToLab(name) {
  if (primary().includes(name)) return;
  S.lab.decks.push({ name, title: name, bracket: 3 });
  await putFile('decks/lab.json', JSON.stringify({ ...S.lab, decks: S.lab.decks }, null, 2) + '\n', `Deck Lab: list ${name}`);
}
function testsFor(name) {
  // every gap measured against this deck, newest first; early reads are dropped once the final result exists
  const finals = new Set(S.results.filter(r => !r.peek).map(r => r.name));
  const rows = [];
  for (const r of S.results) {
    if (r.peek && finals.has(r.name.replace(/_peek$/, ''))) continue;
    for (const g of r.gaps) {
      if (g.base === name) rows.push({ ...g, ...(g.mode === 'decks' ? { label: deckTitle(g.other || g.label) } : {}), test: r.name, date: r.date, peek: r.peek });
      else if (g.mode === 'swap' && g.aswap && g.swap && g.base.startsWith(name + '__') && g.other.startsWith(name + '__') && g.aswap.out.join() === g.swap.out.join())
        rows.push({ ...g, direct: true, vs: g.swap.out[0], dlabel: `${g.label} vs ${g.aswap.in.join(', ')}`, test: r.name, date: r.date, peek: r.peek });
      else if (g.mode === 'decks' && g.other === name) rows.push({ ...g, label: deckTitle(g.base), vs: name, diff: -g.diff, base: name, other: g.base, test: r.name, date: r.date, peek: r.peek });
    }
  }
  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function activeFor(name) {
  if (!S.runs) return [];
  const out = [];
  for (const r of S.runs.runs) if (r.status !== 'completed' && r.req?.arms?.[0]?.deck === name) out.push({ label: reqSummary(r.req), state: r.status === 'in_progress' ? 'Testing now' : 'Waiting to start' });
  for (const q of S.runs.queue) if ((q.req?.base || q.req?.decks?.[0]) === name) out.push({ label: reqSummary(q.req), state: 'Queued' });
  return out;
}

/* ---------- home: decks ---------- */
async function viewHome(v) {
  const prim = primary();
  const others = deckNames().filter(n => !prim.includes(n) && !poolDecks().includes(n)).sort();
  v.innerHTML = `<div class="pagehead"><div><h1>Decks</h1><p class="muted">Pick a deck to see every card tested in it, edit the list, or start a test.</p></div>
      <div class="row"><a class="btn" href="#test/${encodeURIComponent(prim[0] || '')}?mode=decks">Head to head</a><button class="primary" id="newDeck">+ New deck</button></div></div>
    <div class="deckgrid" id="dgrid">${prim.map(n => `<a class="dcard" href="#deck/${encodeURIComponent(n)}" data-name="${esc(n)}"><div class="art"></div><div class="body"><div class="res-title">${esc(deckTitle(n))}</div><div class="small muted">${esc(n)} · bracket ${deckBracket(n)}</div><div class="dmeta small muted"><span class="spin"></span></div></div></a>`).join('')}</div>
    <details class="more"><summary>Test variants and older lists (${others.length})</summary><div class="row" style="margin-top:10px">${others.map(n => `<a class="pill" href="#deck/${encodeURIComponent(n)}/list">${esc(n)}</a>`).join('')}</div></details>
    <details class="more"><summary>Opponent pools</summary>${Object.entries(POOLS()).map(([b, p]) => `<div style="margin-top:10px"><div class="small"><b>${esc(p.label)}</b></div><div class="row" style="margin-top:6px">${p.decks.map(n => `<a class="pill" href="#deck/${encodeURIComponent(n)}/list">${esc(n)}</a>`).join('')}</div></div>`).join('')}</details>`;
  $('#newDeck').onclick = () => { location.hash = '#new'; };
  if (!S.results) await loadResults();
  const decks = await Promise.all(prim.map(n => loadDeck(n).catch(() => null)));
  await sfLoad(decks.filter(Boolean).flatMap(d => d.commander));
  prim.forEach((n, k) => {
    const el = $(`.dcard[data-name="${CSS.escape(n)}"]`); if (!el) return; const d = decks[k];
    const art = d && S.sf[d.commander[0]]?.art; if (art) $('.art', el).style.backgroundImage = `url("${art}")`;
    const rows = testsFor(n); const best = rows.filter(g => verdict(g)[0] === 'good').sort((a, b) => b.diff - a.diff)[0];
    const act = activeFor(n);
    $('.dmeta', el).innerHTML = `${d ? esc(d.commander.join(' + ')) + '<br>' : ''}${rows.length ? `${new Set(rows.map(r => r.label)).size} cards tested${rows[0].date ? ' · last ' + esc(ago(rows[0].date)) : ''}` : 'No tests yet'}
      ${best ? `<div style="margin-top:6px"><span class="pill good">${esc(best.label.split(',')[0])} for ${esc(best.vs.split(',')[0])}: +${best.diff.toFixed(1)}</span></div>` : ''}
      ${act.length ? `<div style="margin-top:6px"><span class="pill gold">${esc(act[0].state)}${act.length > 1 ? ` +${act.length - 1}` : ''}</span></div>` : ''}`;
  });
}

/* ---------- deck page ---------- */
async function viewDeck(v, name, sub = 'tests') {
  if (!deckNames().includes(name)) { v.innerHTML = `<div class="note bad">No deck called ${esc(name)}.</div>`; return; }
  if (S.deck?.name !== name || S.deck?.isNew) { S.deck = { name, d: null, isNew: false }; S.deckDirty = false; S.deckText = false; }
  const isOpp = poolDecks().includes(name) || OPP_DEFAULT.includes(name);
  v.innerHTML = `<a href="#decks" class="back small">← Decks</a>
    <div class="pagehead" style="margin-top:6px"><div><h1>${esc(deckTitle(name))}</h1><p class="muted small" id="dsub">${esc(name)}</p></div>
      ${isOpp ? '' : `<a class="btn primary" href="#test/${encodeURIComponent(name)}">New test</a>`}</div>
    <div class="seg" style="margin-bottom:16px">${[['tests', 'Tests'], ['list', 'List'], ['notes', 'Notes'], ['history', 'History']].map(([k, l]) => `<a href="#deck/${encodeURIComponent(name)}/${k}" class="${k === sub ? 'on' : ''}">${l}</a>`).join('')}</div>
    <section id="dbody"><div class="empty"><span class="spin"></span></div></section>`;
  if (!S.deck.d) S.deck.d = structuredClone(await loadDeck(name));
  $('#dsub').innerHTML = `${esc(name)} · ${esc(S.deck.d.commander.join(' + ') || 'no commander')}${primary().includes(name) ? ` · <select id="dbr" class="sm" style="width:auto;padding:2px 6px;font-size:13px">${[2, 3, 4].map(b => `<option value="${b}" ${b === deckBracket(name) ? 'selected' : ''}>Bracket ${b}</option>`).join('')}</select>` : ''}`;
  $('#dbr') && ($('#dbr').onchange = async e => { if (needToken()) { e.target.value = deckBracket(name); return; } S.lab.decks.find(d => d.name === name).bracket = +e.target.value; try { await putFile('decks/lab.json', JSON.stringify(S.lab, null, 2) + '\n', `Deck Lab: ${name} is bracket ${e.target.value}`); toast('Saved. New tests default to that bracket\'s opponents.'); } catch (err) { toast(err.message, true); } });
  const body = $('#dbody');
  if (sub === 'list') { body.innerHTML = '<div id="editor"></div>'; drawEditor(); const d = S.deck.d; await sfLoad([...d.commander, ...d.main.map(r => r.name)]); drawEditor(); }
  else if (sub === 'notes') await drawNotes(body, name);
  else if (sub === 'history') await drawHistory(body, name);
  else await drawDeckTests(body, name);
}
async function drawDeckTests(body, name) {
  if (!S.results) await loadResults();
  if (!S.runs) { try { await loadRuns(); } catch {} }
  const rows = testsFor(name), act = activeFor(name); S.rendered = [];
  const inList = new Set(S.deck.d.main.map(r => r.name));
  const slots = new Map();
  for (const g of rows) { const k = (g.mode === 'decks' ? '\u0000decks' : g.mode === 'package' ? '\u0001pkg' : g.vs) + '\u0002' + g.pool; (slots.get(k) || slots.set(k, []).get(k)).push(g); }
  await Promise.all([...new Set(rows.filter(g => g.mode === 'decks').map(g => g.other))].map(n => loadDeck(n).catch(() => null)));
  const hist = await loadHistory(name); const lastChange = hist.length ? hist[hist.length - 1].date : null;
  let h = act.map(a => `<div class="note" style="margin-bottom:12px"><b>${esc(a.state)}:</b> ${esc(a.label)} · <a href="#runs">Runs</a></div>`).join('');
  if (!rows.length) h += `<div class="card empty">No tests for this deck yet.<br><a class="btn primary" style="display:inline-block;margin-top:12px" href="#test/${encodeURIComponent(name)}">Start one</a></div>`;
  else h += `<p class="muted small" style="margin:0 0 12px">${new Set(rows.map(r => r.label)).size} cards tested across ${slots.size} slots. Each row is the win-rate change from putting that card in place of the slot's card, with its 95% range; ranges crossing zero mean no clear difference.</p><div class="results">`;
  const short = c => c.split(',')[0];
  const latestBy = (list, keyf) => { const m = new Map(); for (const g of list) { const k = keyf(g), cur = m.get(k); if (!cur || (g.date || '') > (cur.date || '')) m.set(k, g); } return m; };
  for (let [key, gs] of slots) {
    const [slot, pool] = key.split('\u0002');
    const isDecks = slot === '\u0000decks', isPkg = slot === '\u0001pkg';
    const direct = gs.filter(g => g.direct); gs = gs.filter(g => !g.direct); if (!gs.length && !direct.length) continue;
    // which card holds this slot now: the original, or a candidate that was promoted into it
    const candidates = new Set([...gs.map(g => g.label), ...direct.flatMap(g => [g.label, g.aswap.in[0]])]);
    const promoted = !isDecks && !isPkg && !inList.has(slot) ? [...candidates].find(c => inList.has(c)) : null;
    const cur = promoted || slot;
    // "vs the current card" rows: against the original card, or (after a promotion) the head-to-heads with the promoted card
    let vsCur;
    if (promoted) vsCur = direct.filter(g => g.label === promoted || g.aswap.in[0] === promoted).map(g => g.label === promoted
      ? { ...g, label: g.aswap.in[0], diff: -g.diff, swap: { out: [promoted], in: [g.aswap.in[0]] }, vs: promoted, games: g.agames }
      : { ...g, vs: promoted, swap: { out: [promoted], in: [g.label] } });
    else vsCur = gs;
    const latest = latestBy(vsCur, g => g.label);
    const sorted = [...latest.values()].sort((a, b) => b.diff - a.diff);
    // head to head between candidates (pairs not involving the current card), oriented so the leader is named first
    const pairs = direct.filter(g => !promoted || (g.label !== promoted && g.aswap.in[0] !== promoted)).map(g => {
      const a = g.label, b = g.aswap.in[0];
      return g.diff >= 0 ? { ...g, label: `${short(a)} vs ${short(b)}`, lead: a, trail: b } : { ...g, label: `${short(b)} vs ${short(a)}`, diff: -g.diff, lead: b, trail: a };
    });
    const h2h = [...latestBy(pairs, g => [g.lead, g.trail].sort().join('|')).values()].sort((a, b) => b.diff - a.diff);
    const detailRows = [...(promoted ? [...vsCur, ...gs] : gs)].sort((a, b) => b.diff - a.diff || (b.date || '').localeCompare(a.date || ''));
    const now = isDecks || isPkg ? '' : promoted ? '<span class="pill good">promoted</span>' : inList.has(slot) ? '<span class="pill">in the list now</span>' : '<span class="pill warn">no longer in the list</span>';
    const all = [...gs, ...direct].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    h += `<article class="card"><div class="res-head"><div><div class="res-title">${isDecks ? 'Head to head' : isPkg ? 'Packages' : esc(cur) + ' slot'}${promoted ? ` <span class="small muted" style="font-weight:500">(was ${esc(slot)})</span>` : ''}</div>
        <div class="small muted"><span class="pill ${pool === String(deckBracket(name)) ? '' : 'accent'}">vs ${esc(poolName(pool))}</span> ${all.length} result${all.length > 1 ? 's' : ''} · latest ${all[0]?.date ? esc(ago(all[0].date)) : 'date unknown'}</div></div>
        <div class="row">${now}${isDecks || isPkg || !inList.has(cur) ? '' : `<a class="btn sm" href="#test/${encodeURIComponent(name)}?out=${encodeURIComponent(cur)}&pool=${pool}">Test more here</a>`}</div></div>
      ${h2h.length ? `<div class="seg panes" style="margin-top:12px"><button class="on" data-pane="cur">vs ${esc(short(cur))}</button><button data-pane="cvc">Challenger vs challenger <span class="muted">${h2h.length}</span></button></div>` : ''}
      <div class="pane" data-pane-body="cur">
      ${sorted.length ? forestSVG(sorted.map(g => ({ ...g, label: g.label + (g.peek ? ' (early)' : '') }))) : `<p class="small muted">No challengers tested against ${esc(cur)} yet.</p>`}
      <details><summary>Details and promote</summary><table><thead><tr><th>${isDecks ? 'Deck' : isPkg ? 'Package' : 'Card in'}</th><th>For</th><th class="r">Change</th><th class="r">Games</th><th>When</th><th></th></tr></thead><tbody>
      ${detailRows.map(g => { const [c] = verdict(g); const old = (lastChange && (!g.date || g.date < lastChange)) || (promoted && g.vs === slot); return `<tr${latest.get(g.label) === g ? '' : ' class="superseded"'}><td>${esc(g.label)}${g.peek ? ' <span class="pill gold">early read</span>' : ''}</td><td class="small">${esc(isDecks ? '' : g.vs)}</td><td class="r num"><span class="pill ${c}">${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)} ± ${g.ci.toFixed(1)}</span></td><td class="r num">${g.games ? g.games.toLocaleString() : '—'}</td><td class="small muted" title="${esc(prettyName(g.test))}">${g.date ? esc(ago(g.date)) : '—'}${old ? ' <span class="pill" title="The list has changed since this test, so treat it as approximate">older list</span>' : ''}</td><td class="r">${promoteBtn(g, name)}</td></tr>`; }).join('')}
      </tbody></table></details></div>
      ${h2h.length ? `<div class="pane" data-pane-body="cvc" hidden>
        <p class="small muted" style="margin:10px 0 0">Challengers tested directly against each other in this slot. The leader of each pair is named first.</p>
        ${forestSVG(h2h)}
        <ul class="h2h">${h2h.map(g => { const [c] = verdict(g); return `<li><b>${esc(g.label)}</b>: ${c === 'good' ? `<span class="pill good">${esc(short(g.lead))} is better</span>` : '<span class="pill">no clear winner yet</span>'} <span class="small muted">${g.games && g.agames ? (g.games + g.agames).toLocaleString() + ' games · ' : ''}${g.date ? esc(ago(g.date)) : ''}</span>${g.peek ? ' <span class="pill gold">early read</span>' : ''}</li>`; }).join('')}</ul>
      </div>` : ''}</article>`;
  }
  body.innerHTML = h + (rows.length ? '</div>' : '');
  $$('[data-promote]', body).forEach(b => b.onclick = () => promote(name, S.rendered[+b.dataset.promote]));
  $$('[data-pane]', body).forEach(b => b.onclick = () => {
    const card = b.closest('article');
    $$('[data-pane]', card).forEach(x => x.classList.toggle('on', x === b));
    $$('[data-pane-body]', card).forEach(p => p.hidden = p.dataset.paneBody !== b.dataset.pane);
  });
}
function mdLite(src) {
  // headings, bullets, bold, italics, links; everything escaped first
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<i>$2</i>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let out = '', inList = false;
  for (const line of src.split('\n')) {
    const h = line.match(/^(#{1,3})\s+(.*)/), li = line.match(/^\s*[-*]\s+(.*)/);
    if (!li && inList) { out += '</ul>'; inList = false; }
    if (h) out += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`;
    else if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(li[1])}</li>`; }
    else if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  return out + (inList ? '</ul>' : '');
}
const NOTES_TEMPLATE = `## Game plan\n- \n\n## Mulligan\n- \n\n## Key cards and how to play them\n- \n\n## Hints for the simulator\n- Cards the AI should play a particular way (these need Forge AI hints before tests are fair)\n`;
async function drawNotes(body, name, editing = false) {
  const path = `decks/${name}.notes.md`;
  let txt = ''; if (S.tree.includes(path)) { try { txt = await raw(path); } catch {} }
  if (editing) {
    body.innerHTML = `<div class="card stack"><textarea id="ntext" spellcheck="true" style="min-height:460px;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${esc(txt || NOTES_TEMPLATE)}</textarea>
      <div class="row end"><span class="small muted grow">Markdown: ## headings, - bullets, **bold**.</span><button id="ncancel" class="ghost">Cancel</button><button id="nsave" class="primary">Save notes</button></div></div>`;
    $('#ncancel').onclick = () => drawNotes(body, name);
    $('#nsave').onclick = async () => {
      if (needToken()) return; const b = $('#nsave'); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      try { await putFile(path, $('#ntext').value.replace(/\s+$/, '') + '\n', `Deck Lab: notes for ${name}`); toast('Notes saved'); drawNotes(body, name); }
      catch (e) { toast('Save failed: ' + e.message, true); b.disabled = false; b.textContent = 'Save notes'; }
    };
    return;
  }
  body.innerHTML = `<div class="card"><div class="row" style="justify-content:flex-end"><button id="nedit" class="sm">${txt ? 'Edit notes' : 'Write notes'}</button></div>
    <div class="notes">${txt ? mdLite(txt) : '<p class="muted">No notes yet. Game plan, mulligan rules, how key cards should be played, and anything the simulator needs to know.</p>'}</div></div>`;
  $('#nedit').onclick = () => drawNotes(body, name, true);
}
async function viewNewDeck(v) {
  if (!S.deck?.isNew) { S.deck = { name: '', d: { commander: [], main: [] }, isNew: true }; S.deckDirty = false; S.deckText = true; }
  v.innerHTML = `<a href="#decks" class="back small">← Decks</a><div class="pagehead" style="margin-top:6px"><div><h1>New deck</h1><p class="muted">Paste a list from Moxfield, Archidekt or anywhere, or switch to the visual view and add cards one by one.</p></div></div><div id="editor"></div>`;
  drawEditor();
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
      ${S.deck.isNew ? '' : '<button id="saveAs">Save as…</button>'}
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
    S.decks[name] = structuredClone(S.deck.d); const wasNew = S.deck.isNew || as; S.deck = { name, d: S.deck.d, isNew: false }; S.deckDirty = false;
    if (wasNew && !OPP_DEFAULT.includes(name)) { try { await addToLab(name); } catch {} }
    toast(`Saved ${name}`); location.hash = `#deck/${encodeURIComponent(name)}/list`; route();
  } catch (e) { toast('Save failed: ' + e.message, true); btn.disabled = false; btn.textContent = 'Save'; }
}


/* ---------- promote tested changes ---------- */
async function loadHistory(name) {
  const path = `decks/${name}.history.json`;
  if (!S.tree.includes(path)) return [];
  try { return JSON.parse(await raw(path)); } catch { return []; }
}
function swapFor(g) {
  if (g.swap) return g.swap;
  if (g.mode === 'swap' && g.vs && g.label) return { out: [g.vs], in: [g.label.replace(/ \(early\)$/, '')] };
  return null;
}
function promoteBtn(g, name) {
  if (g.peek) return '<span class="small muted" title="Wait for the full run">early</span>';
  const d = S.deck?.d; if (!d) return '';
  const idx = S.rendered.push(g) - 1;
  if (g.mode === 'decks') { const o = S.decks[g.other]; return o && o.commander.join() === d.commander.join() ? `<button class="sm" data-promote="${idx}" title="Replace this list with ${esc(g.other)}">Make main</button>` : ''; }
  const sw = swapFor(g);
  if (!sw) return '';
  const names = d.main.map(r => r.name);
  if (sw.in.every(c => names.includes(c)) && sw.out.every(c => !names.includes(c))) return '<span class="pill good">in the list</span>';
  if (!sw.out.every(c => names.includes(c))) return '<span class="small muted" title="The cards this replaces are no longer in the list">n/a</span>';
  return `<button class="sm" data-promote="${idx}">Promote</button>`;
}
function applySwap(d, out, ins) {
  const m = d.main.map(r => ({ ...r }));
  for (const o of out) { const r = m.find(x => x.name === o && x.n > 0); if (!r) throw new Error(`${o} is not in the list any more`); r.n--; }
  for (const c of ins) { const r = m.find(x => x.name === c); if (r && !/^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(c)) throw new Error(`${c} is already in the list`); r ? r.n++ : m.push({ n: 1, name: c }); }
  return { commander: d.commander, main: m.filter(r => r.n > 0) };
}
async function promote(name, g) {
  if (needToken()) return;
  await loadTree(); delete S.decks[name];
  const cur = await loadDeck(name);
  let next, out, ins;
  if (g.mode === 'decks') {
    const other = await loadDeck(g.other);
    const cnt = d => { const c = {}; d.main.forEach(r => c[r.name] = (c[r.name] || 0) + r.n); return c; };
    const a = cnt(cur), b = cnt(other); out = []; ins = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const df = (b[k] || 0) - (a[k] || 0); for (let i = 0; i < Math.abs(df); i++) (df > 0 ? ins : out).push(k); }
    next = { commander: other.commander, main: other.main };
  } else {
    const sw = swapFor(g); out = sw.out; ins = sw.in;
    try { next = applySwap(cur, out, ins); } catch (e) { toast(e.message, true); return; }
  }
  const [cls] = verdict(g); const res = `${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)} ± ${g.ci.toFixed(1)} points`;
  const what = `${ins.join(', ')} in for ${out.join(', ')}`;
  let msg = `Promote: ${what}?\n\nTest result: ${res}${g.games ? ` over ${g.games.toLocaleString()} games` : ''}.`;
  if (cls !== 'good') msg += `\n\nThis result doesn't show the change is better. Promote anyway?`;
  else if (g.ci > 1.1) msg += `\n\nTip: a Careful re-test would confirm it cheaply, since both sides' games are reused.`;
  if (!confirm(msg)) return;
  try {
    await putFile(`decks/${name}.dck`, toDck(name, next), `Deck Lab: promote ${what} in ${name} (${res})`);
    const hist = await loadHistory(name);
    hist.push({ date: new Date().toISOString(), out, in: ins, result: { diff: +g.diff.toFixed(2), ci: +g.ci.toFixed(2), games: g.games || null, test: g.test, verdict: verdict(g)[1] } });
    await putFile(`decks/${name}.history.json`, JSON.stringify(hist, null, 2) + '\n', `Deck Lab: log change to ${name}`);
    S.decks[name] = next; S.deck = { name, d: structuredClone(next), isNew: false };
    toast(`Promoted: ${what}`); route();
  } catch (e) { toast('Promote failed: ' + e.message, true); }
}
async function drawHistory(body, name) {
  const hist = await loadHistory(name);
  if (!hist.length) { body.innerHTML = '<div class="card empty">No changes promoted yet. Promote a tested card from the Tests tab (open Details and promote on any slot).</div>'; return; }
  body.innerHTML = `<div class="stack">${hist.map((h, i) => ({ h, i })).reverse().map(({ h, i }) => `<div class="card row">
      <div class="grow"><div><b>${h.undo ? 'Undid: ' : ''}${esc(h.in.join(', '))}</b> <span class="muted">in for</span> <b>${esc(h.out.join(', '))}</b></div>
        <div class="small muted">${esc(new Date(h.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}${h.result ? ` · ${h.result.diff > 0 ? '+' : ''}${h.result.diff} ± ${h.result.ci} points (${esc(h.result.verdict || '')})${h.result.games ? ', ' + h.result.games.toLocaleString() + ' games' : ''} · ${esc(prettyName(h.result.test || ''))}` : ''}</div></div>
      ${h.undo || hist.some(x => x.undo === i) ? '' : `<button class="sm" data-undo="${i}">Undo</button>`}</div>`).join('')}</div>`;
  $$('[data-undo]', body).forEach(b => b.onclick = async () => {
    if (needToken()) return; const i = +b.dataset.undo, h = hist[i];
    if (!confirm(`Undo: put ${h.out.join(', ')} back in for ${h.in.join(', ')}?`)) return;
    try {
      await loadTree(); delete S.decks[name]; const cur = await loadDeck(name); const next = applySwap(cur, h.in, h.out);
      await putFile(`decks/${name}.dck`, toDck(name, next), `Deck Lab: undo ${h.in.join(', ')} in ${name}`);
      hist.push({ date: new Date().toISOString(), out: h.in, in: h.out, undo: i });
      await putFile(`decks/${name}.history.json`, JSON.stringify(hist, null, 2) + '\n', `Deck Lab: log undo in ${name}`);
      S.decks[name] = next; S.deck = { name, d: structuredClone(next), isNew: false }; toast('Undone'); route();
    } catch (e) { toast('Undo failed: ' + e.message, true); }
  });
}

/* ---------- new test ---------- */
const PRECISION = [[2.0, 'Quick'], [1.5, 'Standard'], [1.0, 'Careful']];
function estimate(arms, precision) {
  // worst case: nothing reused from earlier tests
  const n = Math.ceil(2 * BASE_P * (1 - BASE_P) * (196 / precision) ** 2);
  const total = Math.min(170, Math.ceil(arms * n / (SHARDS * 4 * GPM) * 1.12)) + 15; return { n, total };
}
async function viewTest(v) {
  const T = S.test; const mine = [...primary(), ...myDecks().filter(n => !primary().includes(n))];
  if (!T.base || !mine.includes(T.base)) T.base = primary()[0] || mine[0];
  if (!T.oppsTouched && POOLS()[deckBracket(T.base)]) T.opps = [...POOLS()[deckBracket(T.base)].decks];
  const base = T.base ? await loadDeck(T.base) : { main: [], commander: [] };
  await sfLoad(base.main.map(r => r.name));
  const pkKey = p => [...p.out].sort().join('|');
  const arms = T.mode === 'swap' ? T.slots.reduce((s, sl) => s + 1 + sl.ins.length, 0) : T.mode === 'package' ? T.packages.length + new Set(T.packages.map(pkKey)).size : T.decks.filter(Boolean).length;
  const est = estimate(Math.max(2, arms), T.precision);
  const inDeck = new Set([...base.main.map(r => r.name), ...base.commander]);
  const flagged = (T.mode === 'swap' ? T.slots.flatMap(s => s.ins) : T.mode === 'package' ? T.packages.flatMap(p => p.in) : []).filter(n => S.forge?.get(n) === 'A');
  const autoName = T.mode === 'swap'
    ? T.slots.filter(s => s.out && s.ins.length).map(s => s.ins.map(c => c.split(',')[0]).join(' and ') + ' for ' + s.out.split(',')[0]).join('; ')
    : T.mode === 'package' ? T.packages.filter(p => p.in.length).map(p => 'Package: ' + p.in.map(c => c.split(',')[0]).join(', ') + ' for ' + p.out.map(c => c.split(',')[0]).join(', ')).join('; ')
    : T.decks.filter(Boolean).join(' vs ');
  const allOpp = deckNames().filter(n => !isGen(n) && !(T.mode === 'decks' ? T.decks : [T.base]).includes(n));
  const oppList = [...OPP_DEFAULT.filter(n => allOpp.includes(n)), ...allOpp.filter(n => !OPP_DEFAULT.includes(n)).sort()];
  v.innerHTML = `<a href="#deck/${encodeURIComponent(T.base)}" class="back small">← ${esc(deckTitle(T.base))}</a><div class="pagehead" style="margin-top:6px"><div><h1>New test</h1><p class="muted">Each version plays thousands of 4-player pods against the same opponents and seats, so only the change differs.</p></div>
      <div class="seg"><button data-mode="swap" class="${T.mode === 'swap' ? 'on' : ''}">Swap cards</button><button data-mode="package" class="${T.mode === 'package' ? 'on' : ''}">Package</button><button data-mode="decks" class="${T.mode === 'decks' ? 'on' : ''}">Head to head</button></div></div>
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
    : T.mode === 'package' ? `
      <label class="fld"><span>Base deck</span><select id="tbase">${mine.map(n => `<option ${n === T.base ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      ${T.packages.map((pk, i) => `<div class="slot stack">
        <div class="row"><b>Package ${i + 1}</b><span class="small ${pk.out.length === pk.in.length ? 'muted' : ''}" style="${pk.out.length === pk.in.length ? '' : 'color:var(--bad)'}">${pk.out.length} out · ${pk.in.length} in</span><span class="grow"></span>${T.packages.length > 1 ? `<button class="sm ghost danger" data-delpk="${i}">Remove</button>` : ''}</div>
        <div class="grid2">
          <div class="fld"><span>Take out</span><div class="ac"><input data-pkout="${i}" placeholder="Cards in ${esc(T.base)}…"></div>
            <div class="row" style="margin-top:8px">${pk.out.map((c, j) => `<span class="chip" data-card="${esc(c)}">${esc(c)}<button data-delpo="${i}:${j}" aria-label="Remove">×</button></span>`).join('')}</div></div>
          <div class="fld"><span>Put in</span><div class="ac"><input data-pkin="${i}" placeholder="Search Forge's card list…"></div>
            <div class="row" style="margin-top:8px">${pk.in.map((c, j) => `<span class="chip" data-card="${esc(c)}">${esc(c)} ${flagPill(c)}<button data-delpi="${i}:${j}" aria-label="Remove">×</button></span>`).join('')}</div></div>
        </div></div>`).join('')}
      <div><button class="sm" id="addPk">+ Another package</button> <span class="muted small">Each package is its own version. Each game forces one package card into the opening hand, rotating through them; the baseline forces the matching card being cut. Order the two lists so cards pair up (first out ↔ first in).</span></div>`
    : `<div class="grid2">${T.decks.map((dn, i) => `<label class="fld"><span>${i ? (T.decks.length > 2 ? 'Deck ' + (i + 1) : 'Versus') : 'Deck 1'}</span><select data-dk="${i}"><option value="">${i > 1 ? '(none)' : 'Choose…'}</option>
        <optgroup label="Decks">${primary().map(n => `<option value="${esc(n)}" ${n === dn ? 'selected' : ''}>${esc(deckTitle(n))}</option>`).join('')}</optgroup>
        <optgroup label="Other lists">${mine.filter(n => !primary().includes(n)).map(n => `<option ${n === dn ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup></select></label>`).join('')}</div>
      ${T.decks.length < 4 ? '<div><button class="sm" id="addDk">+ Add another deck</button></div>' : ''}
      <p class="small muted">Each deck plays its own games against the same opponent pool and seats, as built, with nothing forced into the opening hand. Works across different commanders too. Small differences between similar lists need more games to show up than a single-card swap.</p>`}
      <div class="fld"><span>Target bracket</span><div class="seg">${Object.keys(POOLS()).map(b => `<button data-pool="${b}" class="${poolOf(T.opps) === b ? 'on' : ''}">Bracket ${b}</button>`).join('')}${poolOf(T.opps) === 'custom' ? '<button class="on">Custom</button>' : ''}</div>
        <div class="small muted" style="margin-top:6px">${esc(POOLS()[poolOf(T.opps)]?.label || 'Custom opponent mix. Results won’t line up with the standard pools.')}</div></div>
      <div class="fld"><span>Opponents (${T.opps.length} selected, each pod draws 3)</span><div class="row">${[...new Set([...(POOLS()[poolOf(T.opps)]?.decks || []), ...T.opps])].map(n => `<label class="chk ${T.opps.includes(n) ? 'on' : ''}"><input type="checkbox" data-opp="${esc(n)}" ${T.opps.includes(n) ? 'checked' : ''}>${esc(n)}</label>`).join('')}
        <select id="addOpp" style="width:auto"><option value="">+ Add a deck…</option>${[...poolDecks(), ...oppList].filter((n, i, A) => A.indexOf(n) === i && !T.opps.includes(n)).map(n => `<option>${esc(n)}</option>`).join('')}</select></div></div>
      <div class="grid2">
        <label class="fld"><span>Precision</span><select id="tmin">${PRECISION.map(([v, l]) => `<option value="${v}" ${v === T.precision ? 'selected' : ''}>${l}: ±${v.toFixed(1)} points</option>`).join('')}</select></label>
        <label class="fld"><span>Name</span><input id="tname" placeholder="${esc(autoName || 'Test name')}" value="${esc(T.name)}"></label>
      </div>
      <div class="est"><div class="stat"><b class="num">~${est.n.toLocaleString()}</b><span>games per version</span></div>
        <div class="stat"><b class="num">≤ ${est.total < 60 ? est.total + ' min' : (Math.round(est.total / 6) / 10) + ' h'}</b><span>once it starts</span></div></div>
      <p class="small muted" style="margin:0">${T.precision >= 2 ? 'Quick catches big swings (3+ points) but misses about half of 2-point improvements. Good for screening ideas.' : T.precision >= 1.5 ? 'Standard catches about 3 in 4 real 2-point improvements.' : 'Careful catches nearly every real 2-point improvement. Use it to confirm a change before you make it official.'}</p>
      <p class="small muted" style="margin:0">Time shown assumes nothing is reused. Versions already played with this exact deck, card and opponents reuse those games, so most tests finish well under it, and a fully covered test returns in a couple of minutes.</p>
      ${flagged.length ? `<div class="note">Forge's AI plays ${flagged.map(esc).join(', ')} poorly, so a loss here may mean the AI misplays it rather than the card being weak.</div>` : ''}
      <div class="row end"><span id="terr" class="small" style="color:var(--bad)"></span><button class="primary" id="queueBtn">Queue test</button></div>
    </div>`;
  $$('[data-mode]').forEach(b => b.onclick = () => { T.mode = b.dataset.mode; if (T.mode === 'decks' && !T.decks[0]) T.decks = [T.base, '']; viewTest(v); });
  if (T.mode === 'swap') {
    $('#tbase').onchange = e => { T.base = e.target.value; T.slots = [{ out: '', ins: [] }]; history.replaceState(null, '', '#test/' + encodeURIComponent(T.base)); viewTest(v); };
    $$('[data-out]').forEach(s => s.onchange = () => { T.slots[+s.dataset.out].out = s.value; viewTest(v); });
    $$('[data-in]').forEach(inp => attachAuto(inp, n => { const sl = T.slots[+inp.dataset.in]; if (inDeck.has(n)) { toast(`${n} is already in ${T.base}`, true); return; } if (!sl.ins.includes(n)) sl.ins.push(n); sfLoad([n]); viewTest(v).then(() => $(`[data-in="${inp.dataset.in}"]`)?.focus()); }, n => !inDeck.has(n)));
    $$('[data-delin]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.delin.split(':').map(Number); T.slots[i].ins.splice(j, 1); viewTest(v); });
    $$('[data-delslot]').forEach(b => b.onclick = () => { T.slots.splice(+b.dataset.delslot, 1); viewTest(v); });
    $('#addSlot').onclick = () => { T.slots.push({ out: '', ins: [] }); viewTest(v); };
  } else if (T.mode === 'package') {
    $('#tbase').onchange = e => { T.base = e.target.value; T.packages = [{ out: [], in: [] }]; history.replaceState(null, '', '#test/' + encodeURIComponent(T.base)); viewTest(v); };
    const deckCards = new Set(base.main.map(r => r.name));
    $$('[data-pkout]').forEach(inp => attachAuto(inp, n => { const pk = T.packages[+inp.dataset.pkout]; if (!pk.out.includes(n)) pk.out.push(n); viewTest(v).then(() => $(`[data-pkout="${inp.dataset.pkout}"]`)?.focus()); }, n => deckCards.has(n) && !T.packages[+inp.dataset.pkout].out.includes(n)));
    $$('[data-pkin]').forEach(inp => attachAuto(inp, n => { const pk = T.packages[+inp.dataset.pkin]; if (inDeck.has(n)) { toast(`${n} is already in ${T.base}`, true); return; } if (!pk.in.includes(n)) pk.in.push(n); sfLoad([n]); viewTest(v).then(() => $(`[data-pkin="${inp.dataset.pkin}"]`)?.focus()); }, n => !inDeck.has(n)));
    $$('[data-delpo]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.delpo.split(':').map(Number); T.packages[i].out.splice(j, 1); viewTest(v); });
    $$('[data-delpi]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.delpi.split(':').map(Number); T.packages[i].in.splice(j, 1); viewTest(v); });
    $$('[data-delpk]').forEach(b => b.onclick = () => { T.packages.splice(+b.dataset.delpk, 1); viewTest(v); });
    $('#addPk').onclick = () => { T.packages.push({ out: [], in: [] }); viewTest(v); };
  } else {
    $$('[data-dk]').forEach(s => s.onchange = () => { T.decks[+s.dataset.dk] = s.value; viewTest(v); });
    $('#addDk') && ($('#addDk').onclick = () => { T.decks.push(''); viewTest(v); });
  }
  $$('[data-opp]').forEach(c => c.onchange = () => { const n = c.dataset.opp; T.opps = c.checked ? [...T.opps, n] : T.opps.filter(x => x !== n); T.oppsTouched = true; viewTest(v); });
  $$('[data-pool]').forEach(b => b.onclick = () => { T.opps = [...POOLS()[b.dataset.pool].decks]; T.oppsTouched = true; viewTest(v); });
  $('#addOpp').onchange = e => { if (e.target.value) { T.opps.push(e.target.value); viewTest(v); } };
  $('#tmin').onchange = e => { T.precision = +e.target.value; viewTest(v); };
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
  } else if (T.mode === 'package') {
    const pks = T.packages.filter(p => p.out.length || p.in.length);
    if (!pks.length) return err('Add cards to take out and put in.');
    if (pks.some(p => !p.out.length || p.out.length !== p.in.length)) return err('Each package must take out as many cards as it puts in.');
    req = { mode: 'package', base: T.base, packages: pks.map(p => ({ out: p.out, in: p.in })) };
  } else {
    const ds = T.decks.filter(Boolean);
    if (ds.length < 2 || new Set(ds).size !== ds.length) return err('Choose at least two different decks.');
    req = { mode: 'decks', decks: ds };
  }
  const arms = req.mode === 'swap' ? req.slots.reduce((s, x) => s + 1 + x.ins.length, 0) : req.mode === 'package' ? req.packages.length + new Set(req.packages.map(p => [...p.out].sort().join('|'))).size : req.decks.length;
  if (arms > 8) return err('Keep it to 8 versions or fewer per test (split it into two tests).');
  if (T.opps.length < 3) return err('Pick at least 3 opponents.');
  if (needToken()) return;
  const name = (T.name || autoName || 'test').trim();
  Object.assign(req, { name, precision: T.precision, shards: SHARDS, opponents: T.opps, submitted: new Date().toISOString() });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const file = `queue/${stamp}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.json`;
  const b = $('#queueBtn'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Queuing';
  try {
    await putFile(file, JSON.stringify(req, null, 2) + '\n', `Deck Lab: queue ${name}`);
    T.slots = [{ out: '', ins: [] }]; T.packages = [{ out: [], in: [] }]; T.name = ''; T.oppsTouched = false;
    toast('Queued. It starts as soon as the runners are free.'); S.runs = null; location.hash = '#runs';
  } catch (e) { toast('Could not queue: ' + e.message, true); b.disabled = false; b.textContent = 'Queue test'; }
}

/* ---------- runs ---------- */
async function loadRuns() {
  const r = await api(`/repos/${REPO}/actions/workflows/swaptest.yml/runs?per_page=8`);
  const runs = await Promise.all(r.workflow_runs.map(async w => {
    let req = null; try { req = JSON.parse(await raw('tests/request.json', w.head_sha)); } catch {}
    return { id: w.id, status: w.status, conclusion: w.conclusion, started: w.run_started_at || w.created_at, updated: w.updated_at, url: w.html_url, req };
  }));
  const qfiles = S.tree.filter(p => /^queue\/[^/]+\.json$/.test(p)).sort();
  const queue = await Promise.all(qfiles.map(async p => { try { return { path: p, req: JSON.parse(await raw(p)) }; } catch { return { path: p, req: null }; } }));
  S.runs = { runs, queue, at: Date.now() };
}
function reqSummary(q) {
  if (!q) return '';
  if (q.mode === 'decks' || (!q.slots && q.decks)) return (q.decks || []).join(' vs ');
  if (q.packages) return q.packages.map(p => `${p.in.join(', ')} in for ${p.out.join(', ')}`).join(' · ');
  if (q.slots) return q.slots.map(s => `${s.ins.join(', ')} in for ${s.out}`).join(' · ');
  if (q.arms && q.compare) {
    const by = new Map(); for (const [b, i] of q.compare) { const k = q.arms[i].label || q.arms[i].card || q.arms[i].deck; (by.get(k) || by.set(k, []).get(k)).push(q.arms[b].label || q.arms[b].card || q.arms[b].deck); }
    return [...by].map(([c, outs]) => q.mode === 'decks' ? `${c} vs ${outs.join(', ')}` : q.mode === 'package' ? c : `${c} in for ${outs.join(', ')}`).join(' · ');
  }
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
        ${(hasRes || hasPeek) ? `<button class="sm" data-goto="${esc(resName)}" data-base="${esc(q.arms?.[0]?.deck || '')}">View ${hasRes ? 'results' : 'early read'}</button>` : ''}
        ${running && el > 25 ? `<button class="sm" data-peek="${r.id}">Get early read</button>` : ''}
        ${r.status !== 'completed' ? `<button class="sm ghost danger" data-cancel="${r.id}">Cancel</button>` : ''}
        <a class="small" href="${esc(r.url)}" target="_blank" rel="noopener" style="margin-left:auto">GitHub run ↗</a></div></div>`;
  };
  el.innerHTML = `<div class="stack">
    ${active.length ? `<h2>Now</h2>${active.map(card).join('')}` : '<div class="card muted">No test running.</div>'}
    <h2 style="margin-top:22px">Queue</h2>${queue.length ? queue.map((q, i) => `<div class="card row"><div class="grow"><b>${i + 1}. ${esc(q.req?.name || q.path)}</b><div class="small muted">${esc(reqSummary(q.req))} · ${q.req?.precision ? '±' + q.req.precision : (q.req?.minutes || '?') + ' min'}</div></div><button class="sm ghost danger" data-unq="${esc(q.path)}">Remove</button></div>`).join('') : '<div class="card muted small">Nothing queued. Start one from New test.</div>'}
    <h2 style="margin-top:22px">Recent</h2>${runs.filter(r => r.status === 'completed').slice(0, 5).map(card).join('') || '<div class="muted">None yet.</div>'}
  </div>`;
  $$('[data-goto]').forEach(b => b.onclick = () => { S.results = null; location.hash = '#deck/' + encodeURIComponent(b.dataset.base || primary()[0]); });
  $$('[data-peek]').forEach(b => b.onclick = async () => { if (needToken()) return; b.disabled = true; try { await dispatch('peek.yml', { run_id: b.dataset.peek }); toast('Early read requested. It lands in Results in about 5 minutes.'); } catch (e) { toast(e.message, true); b.disabled = false; } });
  $$('[data-cancel]').forEach(b => b.onclick = async () => { if (needToken() || !confirm('Cancel this run? Games played so far are still tallied.')) return; try { await api(`/repos/${REPO}/actions/runs/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast('Cancelling…'); } catch (e) { toast(e.message, true); } });
  $$('[data-unq]').forEach(b => b.onclick = async () => { if (needToken() || !confirm('Remove this queued test?')) return; try { await deleteFile(b.dataset.unq, 'Deck Lab: remove queued test'); S.runs.queue = S.runs.queue.filter(q => q.path !== b.dataset.unq); drawRuns(); } catch (e) { toast(e.message, true); } });
}

/* ---------- shell ---------- */
function parseRoute() {
  const [path, qs] = location.hash.slice(1).split('?'); const parts = path.split('/').map(decodeURIComponent);
  return { page: parts[0] || 'decks', arg: parts[1], sub: parts[2], q: new URLSearchParams(qs || '') };
}
async function route() {
  const r = parseRoute(); const page = ['decks', 'deck', 'test', 'runs', 'new'].includes(r.page) ? r.page : 'decks';
  if (S.deckDirty && !(page === 'deck' && r.arg === S.deck?.name && r.sub === 'list') && !(page === 'new' && S.deck?.isNew)) {
    if (!confirm('Discard unsaved deck changes?')) { history.back(); return; }
    S.deckDirty = false; if (S.deck?.isNew) S.deck = null; else if (S.deck) S.deck.d = null;
  }
  S.tab = page === 'runs' ? 'runs' : 'decks';
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  const v = $('#view'); $('#preview').hidden = true; scrollTo(0, 0);
  try {
    if (page === 'runs') await viewRuns(v);
    else if (page === 'deck') await viewDeck(v, r.arg, r.sub || 'tests');
    else if (page === 'new') await viewNewDeck(v);
    else if (page === 'test') {
      if (r.arg && r.arg !== S.test.base) { S.test.base = r.arg; S.test.slots = [{ out: '', ins: [] }]; }
      if (r.q.get('mode') === 'decks') { S.test.mode = 'decks'; if (!S.test.decks[0]) S.test.decks = [S.test.base, '']; history.replaceState(null, '', '#test/' + encodeURIComponent(S.test.base)); }
      if (r.q.get('pool') && POOLS()[r.q.get('pool')]) { S.test.opps = [...POOLS()[r.q.get('pool')].decks]; S.test.oppsTouched = true; }
      if (r.q.get('out')) { S.test.mode = 'swap'; S.test.slots = [{ out: r.q.get('out'), ins: [] }]; history.replaceState(null, '', '#test/' + encodeURIComponent(S.test.base)); }
      await viewTest(v);
    } else await viewHome(v);
  } catch (e) { v.innerHTML = `<div class="note bad">Something went wrong: ${esc(e.message)}</div>`; console.error(e); }
}
function go(tab) { location.hash = '#' + tab; }
function openSettings() { $('#tokenIn').value = S.token; $('#settings').showModal(); }
function setToken(t) { S.token = t; lsSet('ghToken', t || null); $('#keyDot').classList.toggle('ok', !!t); }
async function boot() {
  $('#keyDot').classList.toggle('ok', !!S.token);
  $$('.tabs button').forEach(b => b.onclick = () => { location.hash = '#' + b.dataset.tab; });
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
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', e => { if (S.deckDirty) { e.preventDefault(); e.returnValue = ''; } });
  $('#view').innerHTML = '<div class="empty"><span class="spin"></span> Loading…</div>';
  try { await Promise.all([loadTree(), loadForge()]); await loadLab(); }
  catch (e) { $('#view').innerHTML = `<div class="note bad">Couldn't reach GitHub: ${esc(e.message)}</div>`; return; }
  route();
  // runs badge on load
  loadRuns().then(() => { const n = S.runs.runs.filter(r => r.status !== 'completed').length + S.runs.queue.length; const b = $('#runBadge'); b.hidden = !n; b.textContent = n; }).catch(() => {});
}
boot();
