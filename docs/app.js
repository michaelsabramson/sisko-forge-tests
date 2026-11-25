'use strict';
/* Deck Lab — front end for the Forge swap-test harness in this repo.
   Reads everything from GitHub; writes (decks, queued tests) through the GitHub API with a token kept in localStorage. */
// the repo this page is served from (<owner>.github.io/<repo>/), so the app keeps working if the repo moves accounts
const REPO = (() => { const o = location.hostname.match(/^([\w-]+)\.github\.io$/), r = location.pathname.split('/')[1];
  return o && r ? `${o[1]}/${r}` : 'michaelsabramson/sisko-forge-tests'; })(), BR = 'main';
const OPP_DEFAULT = ['Atraxa', 'Prossh', 'UrDragon', 'Edgar', 'Meren'];
const SHARDS = 38, GPM_FALLBACK = 1.1;  // runners per test (38 on Pro's 40-job limit; 58 on Team's 60); games per process-minute until runs have measured it
let GPM = GPM_FALLBACK;                 // replaced by the measured speed (cache/speed.json) once loaded
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
function prettyName(n, title) { if (title) return title; return n.replace(/_peek$/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()); }
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
  // notice when a newer version of the app itself has been published (an open tab keeps running the old code)
  const appSig = t.tree.filter(e => /^docs\/(app\.js|app\.css|index\.html)$/.test(e.path)).map(e => e.sha).join('');
  if (!S.appSig) S.appSig = appSig;
  else if (appSig && appSig !== S.appSig && !$('#updBar')) {
    const b = document.createElement('div'); b.id = 'updBar'; b.className = 'updbar';
    b.innerHTML = 'A new version of Deck Lab is available. <button class="sm">Reload</button>';
    b.querySelector('button').onclick = () => location.reload(); document.body.appendChild(b);
  }
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
        const info = { type: (c.type_line || '').split(' // ')[0], text: c.oracle_text || face?.oracle_text || '', produces: (c.produced_mana || []).length > 0, cmc: c.cmc || 0, ci: c.color_identity || [], mana: c.mana_cost || face?.mana_cost || '', img: c.image_uris?.normal || face?.image_uris?.normal || '', art: c.image_uris?.art_crop || face?.image_uris?.art_crop || '' };
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
  // accepts Moxfield / Archidekt / MTGO / Arena / ManaBox / DeckCheck text lists and CSV exports (ManaBox, Archidekt,
  // Moxfield); a "Commander" header, *CMDR* or a trailing "(Commander)" marks commanders
  const d = { commander: [], main: [] }; const bad = [];
  const add = (name, n, cmd) => {
    name = name.replace(/\s+\^[^^]*\^\s*$/, '').replace(/\s+\[[^\]]*\]\s*$/, '').replace(/\*[A-Z]+\*/gi, '').trim()
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+\S+)?\s*$/, '').replace(/\s+\[[A-Za-z0-9]{2,6}\](\s+\S+)?\s*$/, '').replace(/\s+#.*$/, '').trim();
    if (!name) return;
    const fn = forgeName(name) || name.split(' // ')[0];
    if (!forgeName(name)) bad.push(name);
    if (cmd) d.commander.push(fn);
    else { const ex = d.main.find(r => r.name === fn); ex ? ex.n += n : d.main.push({ n, name: fn }); }
  };
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/);
  // CSV export: a header row naming the card column (Name / Card Name) and usually a quantity column
  const csvSplit = s => { const out = []; let cur = '', q = false; for (const ch of s) { if (ch === '"') q = !q; else if ((ch === ',' || ch === ';' || ch === '\t') && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()); };
  const head = csvSplit(lines[0] || '').map(h => h.toLowerCase());
  const ni = head.findIndex(h => h === 'name' || h === 'card name' || h === 'card'), qi = head.findIndex(h => /^(quantity|qty|count|amount)$/.test(h));
  if (ni >= 0 && head.length > 2) {
    const bi = head.findIndex(h => /^(board|category|categories|section|zone|type)$/.test(h)), ci = head.findIndex(h => /commander/.test(h) && h !== 'name');
    for (const l of lines.slice(1)) {
      if (!l.trim()) continue; const c = csvSplit(l); const board = (bi >= 0 ? c[bi] : '').toLowerCase();
      if (/side|maybe|consider|token/.test(board)) continue;
      add(c[ni] || '', qi >= 0 ? (+c[qi] || 1) : 1, /commander/.test(board) || (ci >= 0 && /^(true|yes|1|x)$/i.test(c[ci] || '')));
    }
    return { d, bad };
  }
  let sec = 'main'; const tail = [];
  for (let line of lines) {
    line = line.trim();
    if (!line) { if (sec === 'skip' || sec === 'tail') { sec = 'tail'; tail.length = 0; } continue; }
    if (line.startsWith('#')) continue;
    if (sec === 'tail' && /^\d+\s*x?\s+\S/.test(line)) { tail.push(line.replace(/^\d+\s*x?\s+/, '')); continue; }
    const h = line.replace(/^\/\/\s*|^\[|\]$|:$/g, '').trim().toLowerCase();
    if (/^(commanders?|command zone|commander zone)(\s*\(\d+\))?$/.test(h)) { sec = 'cmd'; continue; }
    if (/^(sideboard|maybeboard|maybe|considering|tokens?|companion)(\s*\(\d+\))?/.test(h)) { sec = 'skip'; continue; }
    // any other header: a known section name, or a category label with no quantity in front, like "Ramp (10)"
    if (/^(about|name\s.*|deck|main(board)?|library|creatures?|lands?|instants?|sorcer(y|ies)|artifacts?|enchantments?|planeswalkers?|battles?|other|spells?)(\s*\(\d+\))?$/.test(h)
        || (!/^\d/.test(line) && /\(\d+\)\s*:?$/.test(line))) { sec = 'main'; continue; }
    if (sec === 'skip') continue;
    if (/\[(maybeboard|sideboard|considering)[^\]]*\]|\{noDeck\}/i.test(line)) continue;
    const cmd = /\*CMDR\*/i.test(line) || /\s*[\(\[](commander|cmdr)[\)\]]\s*$/i.test(line) || /\[commander[^\]]*\]/i.test(line);
    line = line.replace(/\s*[\(\[](commander|cmdr)[\)\]]\s*$/i, '');
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i) || line.match(/^(\d+)\t(.+)$/);
    add(m ? m[2] : line, m ? +m[1] : 1, sec === 'cmd' || cmd);
  }
  if (!d.commander.length && tail.length && tail.length <= 2) tail.forEach(n => add(n, 1, true));
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
  if (md.includes('"mode": "pilot"') || md.includes('"hidden": true')) return null;   // AI pilot comparisons are backend experiments, not deck results
  const name = path.slice(8, -3); const peek = name.endsWith('_peek');
  const dm = md.match(/<!-- data (\{.*\}) -->/);
  let arms = [], gaps = [];
  if (dm) {
    const d = JSON.parse(dm[1]); var pool = poolOf(d.opponents); arms = d.arms.map(a => ({ deck: a.deck, card: a.card, label: a.label, swap: a.swap, games: a.games, wins: a.wins, reused: a.reused || 0 }));
    const lab = a => a.label || a.card || a.deck;
    for (const [b, i] of d.compare) {
      const A = arms[b], B = arms[i]; const p0 = A.wins / Math.max(1, A.games), p1 = B.wins / Math.max(1, B.games);
      const se = Math.sqrt(p0 * (1 - p0) / Math.max(1, A.games) + p1 * (1 - p1) / Math.max(1, B.games));
      gaps.push({ label: lab(B) + (d.profile && d.profile !== 'Default' && d.opp_profile !== d.profile ? ` (${d.profile} AI)` : ''), vs: lab(A), diff: 100 * (p1 - p0), ci: 196 * se, base: A.deck, mode: d.mode || 'swap', games: B.games, swap: B.swap, other: B.deck, pool, aswap: A.swap, agames: A.games });
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
  const title = renameAudit((md.match(/^# (.+)$/m) || [])[1] || name);
  const intro = (md.split('\n').find(l => l && !l.startsWith('#') && !l.startsWith('|')) || '');
  for (const g of gaps) g.pool ||= '3';
  const audit = dm ? JSON.parse(dm[1]).audit : null;
  let usage = dm ? JSON.parse(dm[1]).usage : null;
  if (!usage && md.includes('Card usage:')) {
    const cards = [];
    for (const m of md.matchAll(/^\| (.+?) \| (\d+) \| (\d+)% \| ([\d-]+) \| (\d+)% \|$/gm)) cards.push({ card: m[1], games: +m[2], cast: +m[3] / 100, median_wait: m[4] === '-' ? null : +m[4], stuck: +m[5] / 100 });
    usage = { deck: arms[0]?.deck, cards, forced: [] };
  } const auditPool = dm ? poolOf(JSON.parse(dm[1]).opponents) : '3';
  const dtitle = dm ? renameAudit(JSON.parse(dm[1]).title) : null;
  return { path, name, peek, title, dtitle, intro, arms, gaps, audit, auditPool, usage, games: arms.reduce((s, a) => s + a.games, 0) };
}
function verdict(g) {
  const lo = g.diff - g.ci, hi = g.diff + g.ci;
  if (lo > 0) return ['good', 'Better'];
  if (hi < 0) return ['bad', 'Worse'];
  if (Math.abs(g.diff) < 0.5) return ['', 'No difference'];
  return ['', g.diff > 0 ? 'Leans better' : 'Leans worse'];
}
// Rank tiers relative to the deck's own spread: every deck has cards that score below zero (answers drawn early
// displace development), so "below zero" flags too much. Each score is first pulled toward the deck average in
// proportion to its noise (empirical Bayes); an outlier sits more than 1.5 deck spreads below the typical card.
function rankTiers(cards) {
  const n = cards.length; if (n < 10) return new Map();
  const se2 = cards.map(c => (c.ci / 1.96) ** 2), mu = cards.reduce((s, c) => s + c.diff, 0) / n;
  const varObs = cards.reduce((s, c) => s + (c.diff - mu) ** 2, 0) / (n - 1), tau2 = Math.max(0, varObs - se2.reduce((s, v) => s + v, 0) / n);
  const shrunk = cards.map((c, i) => mu + (tau2 > 0 ? tau2 / (tau2 + se2[i]) : 0) * (c.diff - mu));
  const med = [...shrunk].sort((a, b) => a - b)[Math.floor(n / 2)], tau = Math.sqrt(tau2);
  return new Map(cards.map((c, i) => [c.card, tau > 0 && shrunk[i] < med - 1.5 * tau ? 'outlier' : c.diff + c.ci < med ? 'below' : '']));
}
const tierCls = t => t === 'outlier' ? 'bad' : t === 'below' ? 'warn' : '';
// adaptive Rank: verdicts from extra games where the card was forced into the opening hand vs a typical card
const checkedOf = a => new Map((a?.audit?.targeted?.rows || []).map(r => [r.card, r]));
const VERDICT = { outlier: ['bad', 'Confirmed outlier'], weak: ['warn', 'Below typical'], cleared: ['', 'Not an outlier'], unclear: ['', 'Unclear'] };
const vpill = r => r ? `<span class="pill ${VERDICT[r.verdict]?.[0] || ''}" title="Forced into the opening hand: ${r.gap > 0 ? '+' : ''}${r.gap.toFixed(1)} ± ${r.ci.toFixed(1)} vs a typical card">${VERDICT[r.verdict]?.[1] || ''}</span>` : '';
// Mana balance (the user's method): compare how lands score in the Rank with how spells score. If an extra land in
// the early cards is worth more than an extra spell on average, the deck is short on mana, and the reverse.
// Ramp = permanents that make mana, or spells that fetch lands onto the battlefield; it is shown on its own.
function isRamp(name) {
  const s = S.sf[name]; if (!s || s.type.includes('Land')) return false;
  return (s.produces && /Creature|Artifact|Enchantment/.test(s.type)) || /search your library for[^.]{0,60}land[^.]{0,80}onto the battlefield/i.test(s.text || '');
}
function manaBalance(rows, games, curve, only) {
  const avg = g => { if (!g.length) return null; const w = g.map(c => 1 / Math.max(0.01, (c.ci / 1.96) ** 2));
    const W = w.reduce((s, x) => s + x, 0); return { n: g.length, diff: g.reduce((s, c, i) => s + c.diff * w[i], 0) / W, ci: 1.96 / Math.sqrt(W) }; };
  const allLand = rows.filter(c => (S.sf[c.card]?.type || '').includes('Land'));
  const ramp = rows.filter(c => isRamp(c.card)), other = rows.filter(c => !allLand.includes(c) && !ramp.includes(c));
  const R = avg(ramp), O = avg(other); if (!O) return '';
  // Land side: with the land curve (lands in the first 10 cards, basics counted by copies) the value of one more land;
  // older Ranks without it fall back to the average score of the land cards that can be scored.
  let L, landLabel, note = '';
  if (curve) { L = { diff: curve.value, ci: curve.ci }; landLabel = 'One more land'; }
  else {
    const land = allLand.filter(c => !games || c.seen < 0.9 * games), A = avg(land); if (!A || A.n < 3) return '';
    L = A; landLabel = `Lands (${A.n})`;
    const skipped = allLand.filter(c => !land.includes(c)).map(c => S.deck.d.main.find(r => r.name === c.card)).filter(Boolean);
    if (skipped.length) note = `<p class="small muted" style="margin:4px 0 0">Based on the ${A.n} other lands: ${skipped.map(r => r.n > 1 ? `your ${r.n} ${esc(r.name)}s` : esc(r.name)).join(', ')} show up in almost every game, so this Rank can't score them.${A.n < 8 ? ' Few lands to go on, so treat this as rough.' : ''}</p>`;
  }
  // which of the three the deck wants: a group "wins" when its score is clearly above a typical spell's
  const clear = X => X.diff - X.ci > 0;
  const gap = L.diff - O.diff, gci = Math.hypot(L.ci, O.ci), f = v => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  const lc = clear({ diff: gap, ci: gci }) , rc = R && clear({ diff: R.diff - O.diff, ci: Math.hypot(R.ci, O.ci) });
  const [cls, head, say] =
      lc && rc ? ['warn', 'Short on mana', `More lands (${f(L.diff)}) and more ramp (${f(R.diff)}) both beat a typical spell (${f(O.diff)}). ${R.diff > L.diff + 0.5 ? 'Ramp scores higher: the deck also wants to be faster.' : L.diff > R.diff + 0.5 ? 'Lands score higher.' : 'Either works.'} Cut from the weakest spells.`]
    : lc ? ['warn', 'Needs lands', `One more land (${f(L.diff)}) beats a typical spell (${f(O.diff)})${R ? `, and ramp (${f(R.diff)}) doesn't` : ''}. Try 1–2 more lands, cutting from the weakest spells.`]
    : rc ? ['warn', 'Needs ramp', `The land count looks fine, but ramp (${f(R.diff)}) beats a typical spell (${f(O.diff)}): the deck wants to be faster. Try 1–2 more ramp pieces, cutting from the weakest spells.`]
    : gap + gci < 0 ? ['warn', 'Heavy on lands', `A typical spell (${f(O.diff)}) beats one more land (${f(L.diff)}). Try 1–2 fewer lands for spells.`]
    : ['good', 'Balanced', 'Lands, ramp and spells score about the same: the mana looks right.'];
  if (only) return { cls, head, say: `One more land ${f(L.diff)}${R ? `, ramp ${f(R.diff)}` : ''}, a typical spell ${f(O.diff)}.` };
  const gaps = [{ label: landLabel, diff: L.diff, ci: L.ci, cls: '' }, ...(R ? [{ label: `Ramp (${R.n})`, diff: R.diff, ci: R.ci, cls: '' }] : []), { label: `Typical spell (${O.n})`, diff: O.diff, ci: O.ci, cls: '' }];
  const bars = '';
  return `<div class="sect" id="mana">Mana balance</div>
    <div class="row" style="align-items:baseline;gap:8px;margin:4px 0 2px"><span class="pill ${cls}">${head}</span></div>
    <p class="small" style="margin:4px 0 6px">${say}</p>
    ${forestSVG(gaps)}${note}${bars}
    <p class="small muted" style="margin:6px 0 0">${curve ? 'One more land: win-rate gain per extra land in the first 10 cards. ' : ''}Ramp and typical spell: average card score.</p>`;
}
// Speed curve: share of games the deck has won by the end of each round, against the pool's par (the average
// opponent's share, cache/par.json). Stalls count as no win on both sides.
function speedCurve(pace, pool, only) {
  const par = S.par?.[pool]; if (!pace || !par) return '';
  const R = pace.rounds.filter(r => r >= 6 && r <= 13), me = R.map(r => pace.won[pace.rounds.indexOf(r)]), pr = R.map(r => par.par[par.rounds.indexOf(r)]);
  if (pr.some(v => v == null)) return '';
  const at = r => { const i = R.indexOf(r); return me[i] - pr[i]; }, early = at(8), end = me[me.length - 1] - pr[pr.length - 1], late = end - early;
  const head = early >= 1.5 ? 'Fast start' : early <= -2.5 ? 'Behind from the start' : 'Keeps pace early';
  const tail = late <= -2 ? ', fades late' : late >= 2 ? ', strong late' : '';
  const cls = end >= -1 ? 'good' : end <= -3 ? 'warn' : '';
  const say = early <= -2.5 ? 'Opponents close out games before this deck gets going: it needs to be faster.'
    : late <= -2 ? 'Level with the table early, but wins far fewer long games: it needs more late-game closing power.'
    : late >= 2 ? 'Wins more of the long games than the table: its strength is the late game.'
    : end >= -1 ? 'Wins at the same rate as the table at every stage.' : 'A little behind the table throughout.';
  if (only) return { cls, head: head + tail, say: `${early > 0 ? '+' : ''}${early.toFixed(1)} vs par by round 8, ${end > 0 ? '+' : ''}${end.toFixed(1)} by the end.`, win: me[me.length - 1], par: pr[pr.length - 1] };
  const W = 340, H = 140, pl = 30, pr2 = 8, pt = 8, pb = 22, ymax = Math.max(10, Math.ceil(Math.max(...me, ...pr) / 10) * 10);
  const x = i => pl + i * (W - pl - pr2) / (R.length - 1), y = v => pt + (1 - v / ymax) * (H - pt - pb);
  const line = vs => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = []; for (let v = 0; v <= ymax; v += 10) ticks.push(v);
  const svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:520px;display:block" role="img" aria-label="Share of games won by each round, this deck vs par">
    ${ticks.map(v => `<line x1="${pl}" x2="${W - pr2}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl - 5}" y="${y(v) + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)">${v}%</text>`).join('')}
    ${R.map((r, i) => i % 2 ? '' : `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${i ? '' : 'Round '}${r}</text>`).join('')}
    <path d="${line(pr)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 4"/>
    <path d="${line(me)}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <text x="${x(R.length - 1) - 2}" y="${y(pr[pr.length - 1]) - 5}" text-anchor="end" font-size="10" fill="var(--muted)">Par</text>
    <text x="${x(R.length - 1) - 2}" y="${y(me[me.length - 1]) + 13}" text-anchor="end" font-size="10" fill="var(--accent)" font-weight="600">This deck</text></svg>`;
  return `<div class="sect" id="speed">Speed</div>
    <div class="row" style="align-items:baseline;gap:8px;margin:4px 0 6px"><span class="pill ${cls}">${head}${tail}</span><span class="small muted">${early > 0 ? '+' : ''}${early.toFixed(1)} vs par by round 8, ${end > 0 ? '+' : ''}${end.toFixed(1)} by the end</span></div>
    ${svg}
    <p class="small muted" style="margin:4px 0 0">Share of games won by each round.</p>`;
}
function forestSVG(gaps, link) {
  const nar = innerWidth < 640; const W = nar ? 360 : 900, rowH = nar ? 30 : 36, padL = nar ? 132 : 250, padR = nar ? 44 : 80, H = gaps.length * rowH + 26;
  const span = Math.max(4, ...gaps.map(g => Math.abs(g.diff) + g.ci)) * 1.1;
  const x = v => padL + (v + span) / (2 * span) * (W - padL - padR);
  const step = span > 12 ? 5 : span > 6 ? 2 : 1; const ticks = [];
  for (let t = -Math.floor(span / step) * step; t <= span; t += step) ticks.push(t);
  const tks = nar ? ticks.filter((t, i) => i % 2 === ticks.indexOf(0) % 2) : ticks;
  let s = `<svg class="forest" viewBox="0 0 ${W} ${H}" role="img" aria-label="Win-rate gaps with 95% intervals">`;
  for (const t of tks) s += `<line class="ax" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - 20}"/><text class="tick" x="${x(t)}" y="${H - 5}" text-anchor="middle">${t > 0 ? '+' : ''}${t}</text>`;
  s += `<line class="zero" x1="${x(0)}" x2="${x(0)}" y1="0" y2="${H - 20}"/>`;
  gaps.forEach((g, i) => {
    const y = i * rowH + rowH / 2 + 2;
    if (link) s += `<a href="${esc(link(g))}" class="frow"><title>Test replacements for ${esc(g.label)}</title><rect x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" rx="6"/>`; const [cls] = g.cls !== undefined ? [g.cls] : verdict(g);
    const col = cls === 'good' ? 'var(--good)' : cls === 'bad' ? 'var(--bad)' : cls === 'warn' ? 'var(--warn)' : 'var(--muted)';
    const L = nar ? 19 : 34; const early = g.label.endsWith(' (early)'); const base0 = early ? g.label.slice(0, -8) : g.label; const sh = base0.split(' vs ').map(x => x.includes(' for ') ? x : x.split(',')[0]).join(' vs ') + (early ? ' (early)' : ''); const lab = sh.length > L ? sh.slice(0, L - 1) + '…' : sh;
    s += `<text x="0" y="${y + 4}"><title>${esc(g.label)} vs ${esc(g.vs)}</title>${esc(lab)}</text>`;
    s += `<line x1="${x(g.diff - g.ci)}" x2="${x(g.diff + g.ci)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="4" stroke-linecap="round" opacity=".45"/>`;
    s += `<circle cx="${x(g.diff)}" cy="${y}" r="6" fill="${col}"/>`;
    s += `<text x="${W - padR + (nar ? 6 : 10)}" y="${y + 4}" class="num" font-weight="700" fill="${col}">${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)}</text>`;
    if (link) s += '</a>';
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
  const out = await Promise.all(files.map(async f => { try { const r = parseResult(f, await raw(f)); if (!r) return null; r.date = dates[r.name]; return r; } catch { return null; } }));
  S.results = out.filter(r => r && (r.arms.length || r.audit || r.usage)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
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
      if (g.base === name) rows.push({ ...g, ...(g.mode === 'decks' ? { label: 'vs ' + deckTitle(g.other || g.label).replace(/ · Bracket \d+$/, ''), diff: -g.diff } : {}), test: r.name, date: r.date, peek: r.peek });   // head to head: this deck's side, + = this deck did better
      else if (g.mode === 'swap' && g.aswap && g.swap && g.base.startsWith(name + '__') && g.other.startsWith(name + '__') && g.aswap.out.join() === g.swap.out.join())
        rows.push({ ...g, direct: true, vs: g.swap.out[0], dlabel: `${g.label} vs ${g.aswap.in.join(', ')}`, test: r.name, date: r.date, peek: r.peek });
      else if (g.mode === 'decks' && g.other === name) rows.push({ ...g, label: 'vs ' + deckTitle(g.base).replace(/ · Bracket \d+$/, ''), vs: name, diff: g.diff, base: name, other: g.base, test: r.name, date: r.date, peek: r.peek });
    }
  }
  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function activeFor(name) {
  if (!S.runs) return [];
  const out = [];
  const setup = q => q && (q.mode === 'cardcheck' || q.mode === 'usage');   // background deck setup isn't shown as a test
  for (const r of S.runs.runs) if (r.status !== 'completed' && !setup(r.req) && r.req?.arms?.[0]?.deck === name) out.push({ label: reqSummary(r.req), state: r.status === 'in_progress' ? 'Testing now' : 'Waiting to start' });
  for (const q of S.runs.queue) if (!setup(q.req) && (q.req?.base || q.req?.decks?.[0]) === name) out.push({ label: reqSummary(q.req), state: 'Queued' });
  return out;
}

/* ---------- home: decks ---------- */
async function viewHome(v) {
  const prim = primary();
  const others = deckNames().filter(n => !prim.includes(n) && !poolDecks().includes(n)).sort();
  v.innerHTML = `<div class="pagehead"><div><h1>Decks</h1><p class="muted">Pick a deck to see every card tested in it, edit the list, or start a test.</p></div>
      <div class="row"><a class="btn" href="#test/${encodeURIComponent(prim[0] || '')}?mode=decks">Head to head</a><button class="primary" id="newDeck">+ New deck</button></div></div>
    <div class="deckgrid" id="dgrid">${prim.map(n => `<a class="dcard" href="#deck/${encodeURIComponent(n)}" data-name="${esc(n)}"><div class="art"></div><div class="body"><div class="res-title">${esc(deckTitle(n))}</div>${/bracket/i.test(deckTitle(n)) ? '' : `<div class="small muted">Bracket ${deckBracket(n)}</div>`}<div class="dmeta small muted"><span class="spin"></span></div></div></a>`).join('')}</div>
    <details class="more"><summary>Test variants and older lists (${others.length})</summary><div class="row" style="margin-top:10px">${others.map(n => `<a class="pill" href="#deck/${encodeURIComponent(n)}/list">${esc(n)}</a>`).join('')}</div></details>
    <details class="more"><summary>Opponent pools</summary>${Object.entries(POOLS()).map(([b, p]) => `<div style="margin-top:10px"><div class="small"><b>${esc(p.label)}</b></div><div class="row" style="margin-top:6px">${p.decks.map(n => `<a class="pill" href="#deck/${encodeURIComponent(n)}/list">${esc(n)}</a>`).join('')}</div></div>`).join('')}</details>`;
  $('#newDeck').onclick = () => { location.hash = '#new'; };
  if (!S.results) await loadResults();
  await loadCardMeta();
  const decks = await Promise.all(prim.map(n => loadDeck(n).catch(() => null)));
  await sfLoad(decks.filter(Boolean).flatMap(d => d.commander));
  prim.forEach((n, k) => {
    const el = $(`.dcard[data-name="${CSS.escape(n)}"]`); if (!el) return; const d = decks[k];
    const art = d && S.sf[d.commander[0]]?.art; if (art) $('.art', el).style.backgroundImage = `url("${art}")`;
    const rows = testsFor(n);
    // highlight only a current upgrade: latest result per matchup, not measured on an older engine, early reads excluded
    const engineDate = Object.values(S.hints || {}).map(h => h.since).sort().pop() || '';
    const seen = new Set(), current = [];
    for (const g of [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''))) { const k = g.label + '|' + g.vs + '|' + !!g.direct; if (seen.has(k)) continue; seen.add(k); current.push(g); }
    const best = current.filter(g => !g.direct && !g.peek && g.mode === 'swap' && (!engineDate || (g.date || '') >= engineDate) && verdict(g)[0] === 'good').sort((a, b) => b.diff - a.diff)[0];
    const act = activeFor(n);
    $('.dmeta', el).innerHTML = `${d ? esc(d.commander.join(' + ')) + '<br>' : ''}${rows.length ? `${new Set(rows.map(r => r.label)).size} cards tested${rows[0].date ? ' · last ' + esc(ago(rows[0].date)) : ''}` : 'No tests yet'}
      ${best ? `<div style="margin-top:6px"><span class="pill good">${esc(best.label.split(',')[0])} for ${esc(best.vs.split(',')[0])}: +${best.diff.toFixed(1)}</span></div>` : ''}
      ${act.length ? `<div style="margin-top:6px"><span class="pill gold">${esc(act[0].state)}${act.length > 1 ? ` +${act.length - 1}` : ''}</span></div>` : ''}`;
  });
}

/* ---------- deck page ---------- */
async function viewDeck(v, name, sub = 'overview') {
  if (!deckNames().includes(name)) { v.innerHTML = `<div class="note bad">No deck called ${esc(name)}.</div>`; return; }
  if (S.deck?.name !== name || S.deck?.isNew) { S.deck = { name, d: null, isNew: false }; S.deckDirty = false; S.deckText = false; }
  const isOpp = poolDecks().includes(name) || OPP_DEFAULT.includes(name);
  v.innerHTML = `<a href="#decks" class="back small">← Decks</a>
    <div class="pagehead" style="margin-top:6px"><div><h1>${esc(deckTitle(name))}</h1><p class="muted small" id="dsub">${esc(name)}</p></div>
      ${isOpp ? '' : `<a class="btn primary" href="#test/${encodeURIComponent(name)}">New test</a>`}</div>
    <div class="seg" style="margin-bottom:16px">${[['overview', 'Overview'], ['tests', 'Tests'], ['audit', 'Rank'], ['list', 'List']].map(([k, l]) => `<a href="#deck/${encodeURIComponent(name)}/${k}" class="${k === sub ? 'on' : ''}">${l}</a>`).join('')}</div>
    <section id="dbody"><div class="empty"><span class="spin"></span></div></section>`;
  if (!S.deck.d) S.deck.d = structuredClone(await loadDeck(name));
  $('#dsub').innerHTML = `${esc(name)} · ${esc(S.deck.d.commander.join(' + ') || 'no commander')}${primary().includes(name) ? ` · <select id="dbr" class="sm" style="width:auto;padding:2px 6px;font-size:13px">${[2, 3, 4].map(b => `<option value="${b}" ${b === deckBracket(name) ? 'selected' : ''}>Bracket ${b}</option>`).join('')}</select>` : ''}`;
  $('#dbr') && ($('#dbr').onchange = async e => { if (needToken()) { e.target.value = deckBracket(name); return; } S.lab.decks.find(d => d.name === name).bracket = +e.target.value; try { await putFile('decks/lab.json', JSON.stringify(S.lab, null, 2) + '\n', `Deck Lab: ${name} is bracket ${e.target.value}`); toast('Saved. New tests default to that bracket\'s opponents.'); } catch (err) { toast(err.message, true); } });
  const body = $('#dbody');
  if (sub === 'list') { await loadCardMeta(); if (!S.results) await loadResults(); S.usageNow = usageFor(name); body.innerHTML = `<details class="info"><summary>ⓘ Tap a card for its AI status, test history and notes</summary><p class="small muted">Dots: <span class="sdot" style="background:var(--good)"></span>AI plays it normally <span class="sdot" style="background:var(--warn)"></span>often held or flagged <span class="sdot" style="background:var(--bad)"></span>AI rarely plays it <span class="sdot" style="background:var(--accent)"></span>hint added, not re-checked <span class="sdot" style="background:var(--line)"></span>not checked yet</p></details><div id="editor"></div>`; drawEditor(); const d = S.deck.d; await sfLoad([...d.commander, ...d.main.map(r => r.name)]); drawEditor(); }
  else if (sub === 'notes') await drawNotes(body, name);
  else if (sub === 'history') await drawHistory(body, name);
  else if (sub === 'audit') { await drawAudit(body, name); if (S.goTo) { document.getElementById(S.goTo)?.scrollIntoView({ block: 'start' }); S.goTo = null; } }
  else if (sub === 'tests') await drawDeckTests(body, name);
  else await drawOverview(body, name);
  if (sub === 'notes' || sub === 'history') body.insertAdjacentHTML('afterbegin', `<div class="small muted" style="margin:-6px 0 10px">${sub === 'notes' ? 'Notes' : 'History'} · <a href="#deck/${encodeURIComponent(name)}/${sub === 'notes' ? 'history' : 'notes'}">${sub === 'notes' ? 'History' : 'Notes'}</a></div>`);
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
  await loadCardMeta(); const engineDate = Object.values(S.hints || {}).map(h => h.since).sort().pop() || '';
  const nRun = act.filter(a => a.state === 'Testing now').length, nQ = act.length - nRun;
  let h = act.length ? `<div class="note" style="margin-bottom:12px">${[nRun ? `${nRun} test running` : '', nQ ? `${nQ} queued` : ''].filter(Boolean).join(' · ')} · <a href="#runs">Runs</a></div>` : '';
  if (!rows.length) h += `<div class="card empty">No tests for this deck yet.<br><a class="btn primary" style="display:inline-block;margin-top:12px" href="#test/${encodeURIComponent(name)}">Start one</a></div>`;
  else h += `<p class="muted small" style="margin:0 0 4px">${new Set(rows.map(r => r.label)).size} cards tested across ${slots.size} slots.${engineDate && rows.some(g => !g.date || g.date < engineDate) ? ' Some results predate the latest AI fixes (tagged inside Details).' : ''}</p><details class="info"><summary>ⓘ How to read this</summary><p class="small muted">Each row is the win-rate change from putting that card in place of the slot's card, with its 95% range. A range that crosses zero means no clear difference. Results tagged <b>older list</b> or <b>older engine</b> were measured before the deck or the AI changed, so treat them as approximate.</p></details><div class="results">`;
  const short = c => c.split(',')[0];
  let hOld = '', nOld = 0;
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
    const now = isDecks || isPkg ? '' : promoted ? '<span class="pill good">promoted</span>' : inList.has(slot) ? '' : '<span class="pill warn">no longer in the list</span>';
    const all = [...gs, ...direct].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const anyOld = engineDate && [...gs, ...direct].some(g => !g.date || g.date < engineDate);
    const part = `<article class="card"><div class="res-head"><div><div class="res-title">${isDecks ? 'Head to head' : isPkg ? 'Packages' : esc(cur) + ' slot'}${promoted ? ` <span class="small muted" style="font-weight:500">(was ${esc(slot)})</span>` : ''}</div>
        <div class="small muted">${pool === String(deckBracket(name)) ? '' : `<span class="pill accent">vs ${esc(poolName(pool))}</span> `}${all.length} result${all.length > 1 ? 's' : ''} · latest ${all[0]?.date ? esc(ago(all[0].date)) : 'date unknown'}</div></div>
        <div class="row">${now}${isDecks || isPkg || !inList.has(cur) ? '' : `<a class="btn sm" href="#test/${encodeURIComponent(name)}?out=${encodeURIComponent(cur)}&pool=${pool}">Test more here</a>`}</div></div>
      ${h2h.length ? `<div class="seg panes" style="margin-top:12px"><button class="on" data-pane="cur">vs current card</button><button data-pane="cvc">Challengers <span class="muted">${h2h.length}</span></button></div>` : ''}
      <div class="pane" data-pane-body="cur">
      ${sorted.length ? forestSVG(sorted.map(g => ({ ...g, label: g.label + (g.peek ? ' (early)' : '') }))) : `<p class="small muted">No challengers tested against ${esc(cur)} yet.</p>`}
      ${(() => {
        // one row per card (its latest result); repeats from earlier tests tucked away
        const cur0 = detailRows.filter(g => latest.get(g.label) === g), older = detailRows.filter(g => latest.get(g.label) !== g);
        const mixedFor = new Set(detailRows.map(g => g.vs)).size > 1;
        const row = g => { const [c] = verdict(g); const old = (lastChange && (!g.date || g.date < lastChange)) || (promoted && g.vs === slot); const oldEng = engineDate && (!g.date || g.date < engineDate);
          const sub = [mixedFor && !isDecks ? 'in for ' + g.vs.split(',')[0] : '', g.games ? g.games.toLocaleString() + ' games' : '', g.date ? ago(g.date) : '', g.peek ? 'early read' : '', old ? 'older list' : '', oldEng ? 'older engine' : ''].filter(Boolean).join(' · ');
          return `<tr><td><div class="dn">${esc(isDecks || isPkg ? g.label : g.label.split(',')[0])}</div><div class="ds">${esc(sub)}</div></td><td class="r num"><span class="pill ${c}">${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)}</span><div class="ds">± ${g.ci.toFixed(1)}</div></td><td class="r">${promoteBtn(g, name)}</td></tr>`; };
        return `<details><summary>Details</summary><table class="dt"><tbody>${cur0.map(row).join('')}</tbody></table>${older.length ? `<details class="older"><summary>Show ${older.length} earlier result${older.length > 1 ? 's' : ''}</summary><table class="dt"><tbody>${older.map(row).join('')}</tbody></table></details>` : ''}</details></div>`;
      })()}
      ${h2h.length ? `<div class="pane" data-pane-body="cvc" hidden>
        <p class="small muted" style="margin:10px 0 0">Challengers tested directly against each other in this slot. The leader of each pair is named first.</p>
        ${forestSVG(h2h)}
        <ul class="h2h">${h2h.map(g => { const [c] = verdict(g); return `<li><b>${esc(g.label)}</b>: ${c === 'good' ? `<span class="pill good">${esc(short(g.lead))} is better</span>` : '<span class="pill">no clear winner yet</span>'} <span class="small muted">${g.games && g.agames ? (g.games + g.agames).toLocaleString() + ' games · ' : ''}${g.date ? esc(ago(g.date)) : ''}</span>${g.peek ? ' <span class="pill gold">early read</span>' : ''}</li>`; }).join('')}</ul>
      </div>` : ''}</article>`;
    if (isDecks || isPkg || inList.has(cur)) h += part; else { hOld += part; nOld++; }
  }
  if (nOld) h += `<details class="more" style="margin-top:12px"><summary>Tests for ${nOld} card${nOld > 1 ? 's' : ''} no longer in the list</summary>${hOld}</details>`;
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
  if (!d.commander.length && count) issues.push('No commander found: put it under a "Commander" line, or add "(Commander)" after its name');
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
    ${S.deckText ? `<textarea id="dtext" spellcheck="false" placeholder="Paste a list or CSV: Moxfield, Archidekt, ManaBox, DeckCheck, Arena or plain '1 Sol Ring' lines. Put commanders under a 'Commander' line.">${esc(d.commander.length || d.main.length ? toText(d) : '')}</textarea>
      <div class="row end"><button id="applyText" class="primary">Apply</button></div>` :
      `<div class="row"><div class="ac grow" style="max-width:420px"><input id="addCard" placeholder="Add a card…"></div>
        <label class="chk"><input type="checkbox" id="asCmd"> as commander</label></div>
      <div class="groups">${TYPE_ORDER.filter(t => groups[t]).map(t => `<div class="group"><h3>${t} <span class="muted">${groups[t].reduce((s, r) => s + r.n, 0)}</span></h3>
        ${groups[t].sort((a, b) => (S.sf[a.name]?.cmc ?? 99) - (S.sf[b.name]?.cmc ?? 99) || a.name.localeCompare(b.name)).map(r => `<div class="crow"><span class="q">${r.n}</span>${S.hints ? statusDot(cardStatus(r.name, S.deck.name, S.usageNow)) : ''}<span class="n clickable" data-card="${esc(r.name)}" data-open="${esc(r.name)}">${esc(r.name)}</span>${flagPill(r.name)}<span class="mana">${esc((S.sf[r.name]?.mana || '').replace(/[{}]/g, ''))}</span><button class="x" data-rm="${esc(r.name)}" data-cmd="${r.cmd ? 1 : ''}" title="Remove">×</button></div>`).join('')}</div>`).join('')}</div>`}
  </div>`;
  const dirty = () => { S.deckDirty = true; drawEditor(); };
  $$('[data-open]', ed).forEach(el => el.onclick = () => !S.deck.isNew && openCard(el.dataset.open, S.deck.name));
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
  const before = new Set(deckNames().includes(name) && S.decks[name] ? [...S.decks[name].main.map(r => r.name), ...S.decks[name].commander] : []);
  try {
    await putFile(`decks/${name}.dck`, toDck(name, S.deck.d), `Deck Lab: save ${name}`);
    const added = [...S.deck.d.main.map(r => r.name), ...S.deck.d.commander].filter(c => !before.has(c));
    if (!OPP_DEFAULT.includes(name) && !poolDecks().includes(name)) queueCardCheck(name, added, 'deck saved');
    S.decks[name] = structuredClone(S.deck.d); const wasNew = S.deck.isNew || as; S.deck = { name, d: S.deck.d, isNew: false }; S.deckDirty = false;
    if (wasNew && !OPP_DEFAULT.includes(name)) { try { await addToLab(name); } catch {} }
    toast(`Saved ${name}`); location.hash = `#deck/${encodeURIComponent(name)}/list`; route();
  } catch (e) { toast('Save failed: ' + e.message, true); btn.disabled = false; btn.textContent = 'Save'; }
}




/* ---------- card pages: AI status, history, notes ---------- */
async function loadCardMeta() {
  if (!S.speedLoaded) {
    S.speedLoaded = true;
    if (S.tree.includes('cache/par.json')) { try { S.par = JSON.parse(await raw('cache/par.json')); } catch {} }
    if (S.tree.includes('cache/speed.json')) {
      try { const rows = JSON.parse(await raw('cache/speed.json'))['*'] || [];
        const g = rows.reduce((t, r) => t + r[0], 0), ms = rows.reduce((t, r) => t + r[1], 0);
        if (g >= 50 && ms > 0) GPM = g / (ms / 60000); } catch {}
    }
  }
  if (!S.hints) { try { S.hints = (await (await fetch('ai-hints.json', { cache: 'no-store' })).json()).cards; } catch { S.hints = {}; } }
  if (!S.cardNotes) { S.cardNotes = {}; if (S.tree.includes('decks/card-notes.json')) { try { S.cardNotes = JSON.parse(await raw('decks/card-notes.json')); } catch {} } }
}
function usageFor(deck) {
  // newest measurement of each card in this deck (card checks and full usage runs)
  const out = {};
  for (const r of [...S.results].filter(r => r.usage?.deck === deck).sort((a, b) => (b.date || '').localeCompare(a.date || '')))
    for (const u of r.usage.cards) if (!out[u.card]) out[u.card] = { ...u, date: r.date, test: r.name, forced: r.usage.forced?.includes(u.card) };
  return out;
}
function cardStatus(name, deck, usage) {
  const hint = S.hints?.[name], u = usage?.[name], flag = S.forge?.get(name), note = S.cardNotes?.[name];
  const land = (S.sf[name]?.type || '').includes('Land');
  const stale = u && hint && (u.date || '') < hint.since;
  let cls = 'unknown', label = 'Not checked yet';
  if (land) { cls = 'land'; label = 'Land'; }
  else if (u && u.games >= 20 && !stale) {
    if (u.cast < 0.1) { cls = 'bad'; label = 'AI never or rarely plays this'; }
    else if (u.stuck >= 0.3) { cls = 'warn'; label = 'AI often holds this without casting it'; }
    else { cls = 'ok'; label = 'AI plays this normally'; }
  } else if (hint) { cls = 'hint'; label = 'AI hint added, not re-checked yet'; }
  else if (flag === 'A') { cls = 'warn'; label = "Forge marks this as one its AI can't play well"; }
  if (cls === 'ok' && hint) label += ' (with hint)';
  return { cls, label, hint, u, stale, flag, note };
}
const DOT = { ok: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', hint: 'var(--accent)', unknown: 'var(--line)', land: 'transparent' };
function statusDot(st) { return st.cls === 'land' ? '<span class="sdot"></span>' : `<span class="sdot" style="background:${DOT[st.cls]}" title="${esc(st.label)}"></span>`; }
async function openCard(name, deck) {
  await loadCardMeta(); if (!S.results) await loadResults(); await sfLoad([name]);
  const st = cardStatus(name, deck, usageFor(deck)), info = S.sf[name] || {};
  const audit = S.results.filter(r => r.audit?.deck === deck && !r.peek).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const ac = audit?.audit.cards.find(c => c.card === name);
  const tests = testsFor(deck).filter(g => g.label === name || g.vs === name || g.swap?.in?.includes(name) || g.swap?.out?.includes(name));
  const n = st.note || {};
  let d = $('#cardDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'cardDlg'; document.body.appendChild(d); d.addEventListener('click', e => { if (e.target === d) d.close(); }); }
  const u = st.u;
  d.innerHTML = `<div class="dlg cardpage">
    <div class="cp-img">${info.img ? `<img src="${esc(info.img)}" alt="${esc(name)}">` : ''}</div>
    <div class="cp-body stack">
      <div class="row"><h2 class="grow">${esc(name)}</h2><button class="ghost sm" id="cpClose" aria-label="Close">✕</button></div>
      <div class="small muted">${esc(info.type || '')}</div>
      <div class="cp-sect"><div class="sect" style="margin:0">AI status</div>
        <div class="row" style="margin-top:6px"><span class="pill ${st.cls === 'ok' ? 'good' : st.cls === 'bad' ? 'bad' : st.cls === 'warn' ? 'warn' : st.cls === 'hint' ? 'accent' : ''}">${esc(st.label)}</span></div>
        ${u ? `<p class="small" style="margin:6px 0 0">Deck setup (${u.games.toLocaleString()} games held${u.date ? ', ' + esc(ago(u.date)) : ''}): cast ${Math.round(u.cast * 100)}%, stuck in hand ${Math.round(u.stuck * 100)}%${u.median_wait != null ? (u.median_wait === 0 ? ', usually cast as soon as it can be' : `, usually cast after waiting ${u.median_wait} turn${u.median_wait === 1 ? '' : 's'} it could have been cast`) : ''}.${st.stale ? ' <b>Measured before the hint was added.</b>' : ''}</p>` : ''}
        ${st.hint ? `<p class="small" style="margin:6px 0 0"><b>Hint:</b> ${esc(st.hint.hint)}</p>` : ''}
        ${st.flag === 'A' ? `<p class="small muted" style="margin:6px 0 0">Forge marks this card as one its AI can't play well.</p>` : ''}</div>
      <div class="cp-sect"><div class="sect" style="margin:0">Test history in ${esc(deckTitle(deck))}</div>
        ${ac ? `<p class="small" style="margin:6px 0 0">Ranking: <span class="pill ${verdict(ac)[0]}">${ac.diff > 0 ? '+' : ''}${ac.diff.toFixed(1)} ± ${ac.ci.toFixed(1)}</span> when drawn early${audit.date ? ' · ' + esc(ago(audit.date)) : ''}</p>` : '<p class="small muted" style="margin:6px 0 0">Not ranked yet.</p>'}
        ${tests.length ? (() => { const seen = new Set(), latest = [], older = []; for (const g of [...tests].sort((a, b) => (b.date || '').localeCompare(a.date || ''))) { const k = g.label + '|' + (g.direct ? g.aswap?.in?.[0] : g.vs) + '|' + !!g.direct; (seen.has(k) ? older : latest).push(g); seen.add(k); }
          const li = g => `<li class="small">${esc(g.label.split(',')[0])} ${g.direct ? 'vs' : 'in for'} ${esc((g.direct ? g.aswap?.in?.[0] : g.vs || '').split(',')[0])}: <span class="pill ${verdict(g)[0]}">${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)} ± ${g.ci.toFixed(1)}</span>${g.date ? ' <span class="muted">' + esc(ago(g.date)) + '</span>' : ''}</li>`;
          return `<ul class="h2h">${latest.map(li).join('')}</ul>${older.length ? `<details><summary>${older.length} earlier result${older.length > 1 ? 's' : ''}</summary><ul class="h2h">${older.map(li).join('')}</ul></details>` : ''}`; })() : ''}
        ${'' && tests.length ? `<ul class="h2h">${tests.slice(0, 8).map(g => `<li class="small">${esc(g.label.split(',')[0])} ${g.direct ? 'vs' : 'in for'} ${esc((g.direct ? g.aswap?.in?.[0] : g.vs || '').split(',')[0])}: <span class="pill ${verdict(g)[0]}">${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)} ± ${g.ci.toFixed(1)}</span>${g.date ? ' <span class="muted">' + esc(ago(g.date)) + '</span>' : ''}</li>`).join('')}</ul>` : ''}</div>
      <div class="cp-sect stack"><div class="sect" style="margin:0">Your notes</div>
        <textarea id="cpNote" class="prose" style="min-height:80px" placeholder="How you play it, why it's in the deck…">${esc(n.note || '')}</textarea>
        <label class="fld"><span>How should the AI play this? (optional)</span><textarea id="cpReq" class="prose" style="min-height:60px" placeholder="e.g. Cast it early; pick the draw mode unless below 10 life.">${esc(n.request || '')}</textarea></label>
        <label class="chk ${n.needsHint ? 'on' : ''}" style="align-self:flex-start"><input type="checkbox" id="cpNeeds" ${n.needsHint ? 'checked' : ''}>Needs an AI hint</label></div>
      <div class="row end"><a class="btn sm" href="#test/${encodeURIComponent(deck)}?out=${encodeURIComponent(name)}" id="cpTest">Find a replacement</a><button class="primary" id="cpSave">Save notes</button></div>
    </div></div>`;
  d.showModal();
  $('#cpClose').onclick = () => d.close();
  $('#cpTest').onclick = () => d.close();
  $('#cpNeeds').onchange = e => e.target.parentElement.classList.toggle('on', e.target.checked);
  $('#cpSave').onclick = async () => {
    if (needToken()) return; const b = $('#cpSave'); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
    try {
      await loadTree(); let all = {}; if (S.tree.includes('decks/card-notes.json')) { try { all = JSON.parse(await raw('decks/card-notes.json')); } catch {} }
      const entry = { note: $('#cpNote').value.trim(), request: $('#cpReq').value.trim(), needsHint: $('#cpNeeds').checked, updated: new Date().toISOString() };
      if (!entry.note && !entry.request && !entry.needsHint) delete all[name]; else all[name] = entry;
      await putFile('decks/card-notes.json', JSON.stringify(all, null, 2) + '\n', `Deck Lab: notes for ${name}`);
      S.cardNotes = all; toast('Saved'); d.close(); if (S.tab === 'decks') drawEditor();
    } catch (e) { toast('Save failed: ' + e.message, true); b.disabled = false; b.textContent = 'Save notes'; }
  };
}
async function queueCardCheck(deck, cards, why) {
  // quick forced-hand check of cards new to a deck, so AI trouble shows up before it skews a test
  await loadCardMeta(); if (!S.results) await loadResults();
  const usage = usageFor(deck);
  const todo = cards.filter(c => !(S.sf[c]?.type || '').includes('Land') && !(usage[c] && usage[c].games >= 20 && !(S.hints[c] && (usage[c].date || '') < S.hints[c].since)));
  if (!todo.length || !S.token) return;
  const req = todo.length > 12
    ? { mode: 'usage', base: deck, name: `Setup of ${deck}`, minutes: 25, shards: SHARDS }
    : { mode: 'cardcheck', base: deck, cards: todo, name: `Setup of new cards in ${deck}`, minutes: 8, shards: SHARDS };
  req.opponents = POOLS()[deckBracket(deck)]?.decks || OPP_DEFAULT; req.reason = why;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  try { await putFile(`queue/${stamp}-check-${deck.toLowerCase()}.json`, JSON.stringify(req, null, 2) + '\n', `Deck Lab: queue AI check of new cards in ${deck}`); toast(`Setting up ${todo.length > 12 ? 'the deck' : todo.length + ' new card' + (todo.length > 1 ? 's' : '')} in the background (a few minutes), so the AI plays ${todo.length === 1 ? 'it' : 'them'} properly in tests.`); } catch {}
}

/* ---------- deck audit (shown as "Rank") ---------- */
const renameAudit = t => t && t.replace(/^Audit of /, 'Ranking of ').replace(/^audit_of_/, 'ranking_of_');
// Overview: the deck's front page, one short screen of verdicts that each lead to the detail
async function drawOverview(body, name) {
  if (!S.results) await loadResults();
  if (!S.runs) { try { await loadRuns(); } catch {} }
  await loadCardMeta(); S.rendered = [];
  const enc = encodeURIComponent(name), d = S.deck.d, inList = new Set(d.main.map(r => r.name));
  const finals = new Set(S.results.filter(r => !r.peek).map(r => r.name));
  const a = S.results.filter(r => r.audit?.deck === name && !(r.peek && finals.has(r.name.replace(/_peek$/, '')))).sort((x, y) => (y.date || '').localeCompare(x.date || ''))[0];
  const tile = (title, href, inner) => `<a class="card ovtile" href="${href.replace(/#(mana|speed)$/, '')}" ${/#(mana|speed)$/.test(href) ? `data-go="${href.split('#').pop()}"` : ''} style="display:block;color:inherit;text-decoration:none"><div class="sect" style="margin:0 0 6px">${title}</div>${inner}</a>`;
  const f = v => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  let h = '';
  const act = activeFor(name);
  if (act.length) h += `<div class="note" style="margin-bottom:12px">${act.map(x => `${esc(x.state)}: ${esc(x.label)}`).join('<br>')} · <a href="#runs">Runs</a></div>`;
  // upgrades: a challenger clearly beat a card that is still in the list
  const tests = testsFor(name), seen = new Set(), ups = [];
  for (const g of tests) {
    if (g.mode === 'decks' || g.peek || !inList.has(g.vs) || inList.has(g.label) || verdict(g)[0] !== 'good') continue;
    const k = g.vs; if (seen.has(k)) continue; seen.add(k); ups.push(g);
  }
  ups.sort((x, y) => y.diff - x.diff);
  if (a) await sfLoad(a.audit.cards.map(c => c.card));
  const rows = a ? a.audit.cards.filter(c => inList.has(c.card)) : [];
  const spells = rows.filter(c => !(S.sf[c.card]?.type || '').includes('Land'));
  const tier = a ? rankTiers(a.audit.cards) : new Map(), chk = checkedOf(a);
  for (const [k, r] of chk) if (r.verdict === 'cleared' && tier.get(k) === 'outlier') tier.set(k, 'below');
  const cuts = spells.filter(c => tier.get(c.card) === 'outlier').sort((x, y) => x.diff - y.diff);
  const sp = a ? speedCurve(a.audit.pace, a.auditPool, true) : null, mb = a ? manaBalance(rows, a.arms?.[0]?.games, a.audit.lands, true) : null;
  // power: win rate against the pool's par, plus head-to-heads
  const h2h = tests.filter(g => g.mode === 'decks' && !g.peek);
  const h2hLatest = [...new Map(h2h.map(g => [g.other, g])).values()];
  if (sp || h2hLatest.length) h += tile('Power', `#deck/${enc}/tests`, `${sp ? `<div class="row" style="align-items:baseline;gap:8px"><span class="pill ${sp.win - sp.par >= -1 ? 'good' : sp.win - sp.par <= -3 ? 'warn' : ''}">Wins ${sp.win.toFixed(1)}%</span><span class="small muted">par ${sp.par.toFixed(1)}% (average opponent)</span></div>` : ''}
    ${h2hLatest.length ? `<div class="small" style="margin-top:6px">${h2hLatest.map(g => `${esc(g.label)}: <span class="pill ${verdict(g)[0]}">${f(g.diff)}</span>`).join(' · ')}</div>` : ''}`);
  // mana and speed in full, with their charts (the same sections as on the Cards tab)
  if (a) { const m = manaBalance(rows, a.arms?.[0]?.games, a.audit.lands), s = speedCurve(a.audit.pace, a.auditPool);
    if (m) h += `<div class="card">${m}</div>`; if (s) h += `<div class="card">${s}</div>`; }
  if (!a) h += `<div class="card"><div class="sect" style="margin:0 0 6px">No ranking yet</div><p class="small muted" style="margin:0">Run a ranking on the Rank tab to get power, mana and speed for this deck.</p><a class="btn sm" style="margin-top:8px;display:inline-block" href="#deck/${enc}/audit">Go to Rank</a></div>`;
  if (!h) h = `<div class="card empty">No tests for this deck yet.<br><a class="btn primary" style="display:inline-block;margin-top:12px" href="#test/${enc}">Start one</a></div>`;
  h += `<p class="small muted" style="margin:14px 0 0">${a ? `From the latest ranking (${a.audit.pace?.games?.toLocaleString() || ''} games, ${esc(ago(a.date))}) and tests. ` : ''}<a href="#deck/${enc}/notes">Notes</a> · <a href="#deck/${enc}/history">History</a></p>`;
  body.innerHTML = `<div class="stack">${h}</div>`;
  $$('[data-promote]', body).forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); promote(name, S.rendered[+b.dataset.promote]); });
}
async function drawAudit(body, name) {
  if (!S.results) await loadResults();
  if (!S.runs) { try { await loadRuns(); } catch {} }
  await loadCardMeta();
  const finals = new Set(S.results.filter(r => !r.peek).map(r => r.name));
  // an early read is dropped once its run's final result exists
  const audits = S.results.filter(r => r.audit?.deck === name && !(r.peek && finals.has(r.name.replace(/_peek$/, '')))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const a = audits[0]; const act = activeFor(name).filter(x => /ranking|audit/i.test(x.label));
  const runBtn = `<div class="row"><select id="aprec" style="width:auto">${[[2.0, 'Quick ±2.0 · ~2 h'], [1.5, 'Standard ±1.5 · ~3.5 h']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button class="primary" id="arun">Run a new ranking</button></div>`;
  let h = act.length ? `<div class="note" style="margin-bottom:12px">Ranking ${act.some(x => x.state === 'Testing now') ? 'running' : 'queued'} · <a href="#runs">Runs</a></div>` : '';
  if (!a) {
    body.innerHTML = h + `<div class="card stack"><h2>Find this deck's weakest slots</h2>
      <p class="muted">A ranking plays the list as built against the ${esc(poolName(String(deckBracket(name))))} pool and logs each game's kept opening hand plus the next three draws. Every card is then scored by how the deck does when the shuffle gives it to you early, compared with games where it didn't. One run covers every card at once.</p>${runBtn}</div>`;
    bindAuditRun(name); return;
  }
  const inList = new Set([...S.deck.d.main.map(r => r.name)]);
  await sfLoad(a.audit.cards.map(c => c.card));
  const isLand = c => (S.sf[c]?.type || '').includes('Land');
  const rows = a.audit.cards.filter(c => inList.has(c.card));
  const spells = rows.filter(c => !isLand(c.card)).sort((x, y) => y.diff - x.diff), lands = rows.filter(c => isLand(c.card)).sort((x, y) => y.diff - x.diff);
  const tier = rankTiers(a.audit.cards), chk = checkedOf(a);
  for (const [k, r] of chk) if (r.verdict === 'cleared' && tier.get(k) === 'outlier') tier.set(k, 'below');   // extra games cleared it
  const byDiff = [...spells].sort((x, y) => x.diff - y.diff);
  const outliers = byDiff.filter(c => tier.get(c.card) === 'outlier'), weakest = byDiff.filter(c => tier.get(c.card) !== 'outlier').slice(0, Math.max(3, 8 - outliers.length));
  const toGap = c => ({ label: c.card, diff: c.diff, ci: c.ci, cls: tierCls(tier.get(c.card)) || (c.diff - c.ci > 0 ? 'good' : '') });
  const weakRow = c => { const tr = tier.get(c.card), cls = tierCls(tr); return `<tr class="clickrow" onclick="location.hash='${esc(testLink({ label: c.card }))}'"><td data-card="${esc(c.card)}">${esc(c.card.split(',')[0])} ${S.forge?.get(c.card) === 'A' ? '<span class="pill warn">AI weak</span>' : ''} ${vpill(chk.get(c.card))}</td><td class="r num"><span class="pill ${cls}">${c.diff > 0 ? '+' : ''}${c.diff.toFixed(1)}</span></td><td class="r"><a class="btn sm" href="#test/${encodeURIComponent(name)}?out=${encodeURIComponent(c.card)}&pool=${a.auditPool}">Replace</a></td></tr>`; };
  const testLink = g => `#test/${encodeURIComponent(name)}?out=${encodeURIComponent(g.label)}&pool=${a.auditPool}`;
  const N = a.arms[0]?.games || 0;
  h += `<div class="card"><div class="res-head"><div><div class="res-title">Card rank</div>
      <div class="small muted"><span class="pill">vs ${esc(poolName(a.auditPool))}</span> ${N.toLocaleString()} games${a.date ? ' · ' + esc(ago(a.date)) : ''}${(() => { const ed = Object.values(S.hints || {}).map(h => h.since).sort().pop() || ''; return ed && (a.date || '') < ed && !a.peek ? ' · <span class="pill" title="Measured before the latest AI fixes; a fresh ranking will replace it">older engine</span>' : ''; })()}${a.peek ? ' · <span class="pill gold">still running · early read, refreshes every ~20 min</span>' : a.audit.partial ? ' · <span class="pill gold">more games coming</span>' : ''}</div></div></div>
<details class="info"><summary>ⓘ How to read this</summary><p class="small muted">Each card's change in win rate when the shuffle put it in your kept opening hand or next three draws, compared with games where it didn't. Cards that matter late (finishers, answers to specific threats) can score lower than their real value, and with this many cards a few will look bad by chance. Confirm a weak slot with a swap test before cutting it.</p></details>
    ${outliers.length ? `<div class="sect">Outliers <span style="text-transform:none;font-weight:500;letter-spacing:0">· test a replacement first</span></div>
    <p class="small muted" style="margin:4px 0 6px">Far below the rest of this deck, beyond its normal spread and noise.</p>
    <table class="weak"><tbody>${outliers.map(weakRow).join('')}</tbody></table>` : ''}
    <div class="sect">${outliers.length ? 'Next weakest' : 'Weakest slots'}</div>
    <p class="small muted" style="margin:4px 0 6px">${outliers.length ? '' : 'No outliers: nothing stands out from the deck\'s normal spread. '}Amber = below this deck's typical card; grey = within its normal spread or noise. Every deck has cards below zero, answers especially.</p>
    <table class="weak"><tbody>${weakest.map(weakRow).join('')}</tbody></table>
    ${chk.size ? `<div class="sect">Double-checked</div>
    <p class="small muted" style="margin:4px 0 6px">The ranking's closest calls got extra games with the card forced into the opening hand, against a typical card from this deck (${esc(a.audit.targeted.ref.split(',')[0])}). Their scores below and on the chart combine both kinds of games.</p>
    <table class="weak"><tbody>${[...chk.values()].sort((x, y) => (x.diff ?? x.gap) - (y.diff ?? y.gap)).map(r => `<tr class="clickrow" onclick="location.hash='${esc(testLink({ label: r.card }))}'"><td data-card="${esc(r.card)}">${esc(r.card.split(',')[0])}</td><td class="r small muted num">${r.rank_diff != null ? `${r.rank_diff > 0 ? '+' : ''}${r.rank_diff.toFixed(1)} → ` : ''}<b>${(r.diff ?? r.gap) > 0 ? '+' : ''}${(r.diff ?? r.gap).toFixed(1)}</b></td><td class="r">${vpill(r)}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="sect">All spells <span style="text-transform:none;font-weight:500;letter-spacing:0">· tap one to test replacements</span></div>${forestSVG(spells.map(toGap), testLink)}
    <details><summary>Lands (${lands.length})</summary>${forestSVG(lands.map(toGap), testLink)}</details>
    <details class="info" style="margin-top:14px"><summary>Run a new ranking</summary><div style="margin-top:8px">${runBtn}</div></details>
    ${audits.length > 1 ? `<p class="small muted">${audits.length - 1} earlier ranking${audits.length > 2 ? 's' : ''} of this deck kept in the history.</p>` : ''}</div>`;
  body.innerHTML = h; bindAuditRun(name);
}
function bindAuditRun(name) {
  const b = $('#arun'); if (!b) return;
  b.onclick = async () => {
    if (needToken()) return;
    const precision = +$('#aprec').value, pool = POOLS()[deckBracket(name)]?.decks || OPP_DEFAULT;
    const req = { mode: 'audit', base: name, name: `Ranking of ${name}`, precision, shards: SHARDS, opponents: pool, submitted: new Date().toISOString() };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    b.disabled = true; b.innerHTML = '<span class="spin"></span> Queuing';
    try { await putFile(`queue/${stamp}-audit-${name.toLowerCase()}.json`, JSON.stringify(req, null, 2) + '\n', `Deck Lab: queue ranking of ${name}`); toast('Ranking queued.'); S.runs = null; location.hash = '#runs'; }
    catch (e) { toast('Could not queue: ' + e.message, true); b.disabled = false; b.textContent = 'Run a new ranking'; }
  };
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
    toast(`Promoted: ${what}`); queueCardCheck(name, ins, 'promotion'); route();
  } catch (e) { toast('Promote failed: ' + e.message, true); }
}
async function drawHistory(body, name) {
  const hist = await loadHistory(name);
  if (!hist.length) { body.innerHTML = '<div class="card empty">No changes promoted yet. Promote a tested card from the Tests tab (open Details on any slot).</div>'; return; }
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
  const total = Math.min(170, Math.ceil(arms * n / (SHARDS * 4 * GPM) + 1.5)) + 12; return { n, total };   // runs now stop when their games are done
}
async function viewTest(v) {
  await loadCardMeta();   // also loads the measured game speed used by the time estimate
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
  v.innerHTML = `<a href="#deck/${encodeURIComponent(T.base)}" class="back small">← ${esc(deckTitle(T.base))}</a><div class="pagehead" style="margin-top:6px"><div><h1>New test</h1></div>
      <div class="seg"><button data-mode="swap" class="${T.mode === 'swap' ? 'on' : ''}">Swap cards</button><button data-mode="package" class="${T.mode === 'package' ? 'on' : ''}">Package</button><button data-mode="decks" class="${T.mode === 'decks' ? 'on' : ''}">Head to head</button></div></div>
    <div class="card stack">
    ${T.mode === 'swap' ? `
      <label class="fld"><span>Base deck</span><select id="tbase">${mine.map(n => `<option ${n === T.base ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      ${T.slots.map((s, i) => `<div class="slot stack" data-slot="${i}">
        ${T.slots.length > 1 ? `<div class="row"><b>${s.out ? 'Replacing ' + esc(s.out.split(',')[0]) : 'Card ' + (i + 1)}</b><span class="grow"></span><button class="sm ghost danger" data-delslot="${i}">Remove</button></div>` : ''}
        <div class="grid2">
          <label class="fld"><span>Card to replace</span><select data-out="${i}"><option value="">Choose a card…</option>${[...base.main].sort((a, b) => a.name.localeCompare(b.name)).map(r => `<option ${r.name === s.out ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
          <label class="fld"><span>Cards to try in its place</span><div class="ac"><input data-in="${i}" placeholder="Search Forge's card list…"></div></label>
        </div>
        <div class="row">${s.ins.map((c, j) => `<span class="chip" data-card="${esc(c)}">${esc(c)} ${flagPill(c)}<button data-delin="${i}:${j}" aria-label="Remove">×</button></span>`).join('') || '<span class="muted small">No cards yet.</span>'}</div>
      </div>`).join('')}
      `
    : T.mode === 'package' ? `
      <label class="fld"><span>Base deck</span><select id="tbase">${mine.map(n => `<option ${n === T.base ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      ${T.packages.map((pk, i) => `<div class="slot stack">
        <div class="row"><span class="small ${pk.out.length === pk.in.length ? 'muted' : ''}" style="${pk.out.length === pk.in.length ? '' : 'color:var(--bad)'}">${pk.out.length} out · ${pk.in.length} in${pk.out.length === pk.in.length ? '' : ' (should match)'}</span><span class="grow"></span>${T.packages.length > 1 ? `<button class="sm ghost danger" data-delpk="${i}">Remove</button>` : ''}</div>
        <div class="grid2">
          <div class="fld"><span>Take out</span><div class="ac"><input data-pkout="${i}" placeholder="Cards in ${esc(T.base)}…"></div>
            <div class="row" style="margin-top:8px">${pk.out.map((c, j) => `<span class="chip" data-card="${esc(c)}">${esc(c)}<button data-delpo="${i}:${j}" aria-label="Remove">×</button></span>`).join('')}</div></div>
          <div class="fld"><span>Put in</span><div class="ac"><input data-pkin="${i}" placeholder="Search Forge's card list…"></div>
            <div class="row" style="margin-top:8px">${pk.in.map((c, j) => `<span class="chip" data-card="${esc(c)}">${esc(c)} ${flagPill(c)}<button data-delpi="${i}:${j}" aria-label="Remove">×</button></span>`).join('')}</div></div>
        </div></div>`).join('')}
      <p class="muted small" style="margin:0">Cards pair up in order: first out ↔ first in.</p>`
    : `<div class="grid2">${T.decks.map((dn, i) => `<label class="fld"><span>${i ? (T.decks.length > 2 ? 'Deck ' + (i + 1) : 'Versus') : 'Deck 1'}</span><select data-dk="${i}"><option value="">${i > 1 ? '(none)' : 'Choose…'}</option>
        <optgroup label="Decks">${primary().map(n => `<option value="${esc(n)}" ${n === dn ? 'selected' : ''}>${esc(deckTitle(n))}</option>`).join('')}</optgroup>
        <optgroup label="Other lists">${mine.filter(n => !primary().includes(n)).map(n => `<option ${n === dn ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup></select></label>`).join('')}</div>
      ${T.decks.length < 4 ? '<div><button class="sm" id="addDk">+ Add another deck</button></div>' : ''}
      <p class="small muted">Each deck plays its own games against the same opponent pool and seats, as built, with nothing forced into the opening hand. Works across different commanders too. Small differences between similar lists need more games to show up than a single-card swap.</p>`}
      <details class="more opp" ${S.oppOpen ? 'open' : ''}><summary>Opponents: <b>${poolOf(T.opps) === 'custom' ? 'custom mix' : 'bracket ' + poolOf(T.opps) + ' pool'}</b> <span class="muted small">· change</span></summary><div class="stack" style="margin-top:10px">
      <div class="fld"><span>Target bracket</span><div class="seg">${Object.keys(POOLS()).map(b => `<button data-pool="${b}" class="${poolOf(T.opps) === b ? 'on' : ''}">Bracket ${b}</button>`).join('')}${poolOf(T.opps) === 'custom' ? '<button class="on">Custom</button>' : ''}</div>
        <div class="small muted" style="margin-top:6px">${esc(POOLS()[poolOf(T.opps)]?.label || 'Custom opponent mix. Results won’t line up with the standard pools.')}</div></div>
      <div class="fld"><span>Opponents (${T.opps.length} selected, each pod draws 3)</span><div class="row">${[...new Set([...(POOLS()[poolOf(T.opps)]?.decks || []), ...T.opps])].map(n => `<label class="chk ${T.opps.includes(n) ? 'on' : ''}"><input type="checkbox" data-opp="${esc(n)}" ${T.opps.includes(n) ? 'checked' : ''}>${esc(n)}</label>`).join('')}
        <select id="addOpp" style="width:auto"><option value="">+ Add a deck…</option>${[...poolDecks(), ...oppList].filter((n, i, A) => A.indexOf(n) === i && !T.opps.includes(n)).map(n => `<option>${esc(n)}</option>`).join('')}</select></div></div>
      </div></details>
      <div class="grid2">
        <label class="fld"><span>Precision</span><select id="tmin">${PRECISION.map(([v, l]) => `<option value="${v}" ${v === T.precision ? 'selected' : ''}>${l}: ±${v.toFixed(1)} points</option>`).join('')}</select></label>
        <label class="fld"><span>Name</span><input id="tname" placeholder="${esc(autoName || 'Test name')}" value="${esc(T.name)}"></label>
      </div>
      <div class="est"><div class="stat"><b class="num">~${est.n.toLocaleString()}</b><span>games per version</span></div>
        <div class="stat"><b class="num">≤ ${est.total < 60 ? est.total + ' min' : (Math.round(est.total / 6) / 10) + ' h'}</b><span>once it starts</span></div></div>
      <details class="info"><summary>ⓘ About precision and time</summary><p class="small muted">Each version plays thousands of 4-player pods against the same opponents and seats, so only the change differs. ${T.precision >= 2 ? 'Quick catches big swings (3+ points) but misses about half of 2-point improvements. Good for screening ideas.' : T.precision >= 1.5 ? 'Standard catches about 3 in 4 real 2-point improvements.' : 'Careful catches nearly every real 2-point improvement. Use it to confirm a change before you make it official.'} Time shown assumes nothing is reused; versions already played with this exact deck, card and opponents reuse those games, so most tests finish well under it.</p></details>
      ${flagged.length ? `<div class="note">Forge's AI plays ${flagged.map(esc).join(', ')} poorly, so a loss here may mean the AI misplays it rather than the card being weak.</div>` : ''}
      <div class="row end"><span id="terr" class="small" style="color:var(--bad)"></span><button class="primary" id="queueBtn">Queue test</button></div>
    </div>`;
  $('details.opp')?.addEventListener('toggle', e => { S.oppOpen = e.target.open; });
  $$('[data-mode]').forEach(b => b.onclick = () => { T.mode = b.dataset.mode; if (T.mode === 'decks' && !T.decks[0]) T.decks = [T.base, '']; viewTest(v); });
  if (T.mode === 'swap') {
    $('#tbase').onchange = e => { T.base = e.target.value; T.slots = [{ out: '', ins: [] }]; history.replaceState(null, '', '#test/' + encodeURIComponent(T.base)); viewTest(v); };
    $$('[data-out]').forEach(s => s.onchange = () => { T.slots[+s.dataset.out].out = s.value; viewTest(v); });
    $$('[data-in]').forEach(inp => attachAuto(inp, n => { const sl = T.slots[+inp.dataset.in]; if (inDeck.has(n)) { toast(`${n} is already in ${T.base}`, true); return; } if (!sl.ins.includes(n)) sl.ins.push(n); sfLoad([n]); viewTest(v).then(() => $(`[data-in="${inp.dataset.in}"]`)?.focus()); }, n => !inDeck.has(n)));
    $$('[data-delin]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.delin.split(':').map(Number); T.slots[i].ins.splice(j, 1); viewTest(v); });
    $$('[data-delslot]').forEach(b => b.onclick = () => { T.slots.splice(+b.dataset.delslot, 1); viewTest(v); });
    $('#addSlot') && ($('#addSlot').onclick = () => { T.slots.push({ out: '', ins: [] }); viewTest(v); });
  } else if (T.mode === 'package') {
    $('#tbase').onchange = e => { T.base = e.target.value; T.packages = [{ out: [], in: [] }]; history.replaceState(null, '', '#test/' + encodeURIComponent(T.base)); viewTest(v); };
    const deckCards = new Set(base.main.map(r => r.name));
    $$('[data-pkout]').forEach(inp => attachAuto(inp, n => { const pk = T.packages[+inp.dataset.pkout]; if (!pk.out.includes(n)) pk.out.push(n); viewTest(v).then(() => $(`[data-pkout="${inp.dataset.pkout}"]`)?.focus()); }, n => deckCards.has(n) && !T.packages[+inp.dataset.pkout].out.includes(n)));
    $$('[data-pkin]').forEach(inp => attachAuto(inp, n => { const pk = T.packages[+inp.dataset.pkin]; if (inDeck.has(n)) { toast(`${n} is already in ${T.base}`, true); return; } if (!pk.in.includes(n)) pk.in.push(n); sfLoad([n]); viewTest(v).then(() => $(`[data-pkin="${inp.dataset.pkin}"]`)?.focus()); }, n => !inDeck.has(n)));
    $$('[data-delpo]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.delpo.split(':').map(Number); T.packages[i].out.splice(j, 1); viewTest(v); });
    $$('[data-delpi]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.delpi.split(':').map(Number); T.packages[i].in.splice(j, 1); viewTest(v); });
    $$('[data-delpk]').forEach(b => b.onclick = () => { T.packages.splice(+b.dataset.delpk, 1); viewTest(v); });
    $('#addPk') && ($('#addPk').onclick = () => { T.packages.push({ out: [], in: [] }); viewTest(v); });
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
  if (q.mode === 'cardcheck') return `Setting up new cards: ${(q.cards || []).join(', ')}`;
  if (q.mode === 'usage') return 'Setting up the deck';
  if (q.mode === 'audit') return 'Ranking: every card scored from the shuffle';
  if (q.packages) return q.packages.map(p => `${p.in.join(', ')} in for ${p.out.join(', ')}`).join(' · ');
  if (q.slots) return q.slots.map(s => `${s.ins.join(', ')} in for ${s.out}`).join(' · ');
  if (q.arms && q.compare) {
    const by = new Map(); for (const [b, i] of q.compare) { if (q.arms[b].swap) continue; // challenger-vs-challenger pairs aren't part of the summary
      const k = q.arms[i].label || q.arms[i].card || q.arms[i].deck; (by.get(k) || by.set(k, []).get(k)).push(q.arms[b].label || q.arms[b].card || q.arms[b].deck); }
    return [...by].map(([c, outs]) => q.mode === 'decks' ? `${c} vs ${outs.join(', ')}` : q.mode === 'package' ? c : `${c} in for ${outs.join(', ')}`).join(' · ');
  }
  if (q.arms) return q.arms.map(a => a.card || a.deck).filter((x, i, A) => A.indexOf(x) === i).join(' · ');
  return '';
}
async function viewRuns(v) {
  v.innerHTML = `<div class="pagehead"><div><h1>Runs</h1></div></div><div id="runsBody"><div class="empty"><span class="spin"></span></div></div>`;
  try { if (!S.runs || Date.now() - S.runs.at > 20000) await loadRuns(); } catch (e) { $('#runsBody').innerHTML = `<div class="note bad">Couldn't load runs: ${esc(e.message)}${S.token ? '' : '. Without a token GitHub allows 60 requests an hour; adding one lifts that.'}</div>`; return; }
  drawRuns();
  clearInterval(S.runTimer);
  S.runTimer = setInterval(async () => { if (S.tab !== 'runs') return clearInterval(S.runTimer); try { await loadTree(); await loadRuns(); drawRuns(); } catch {} }, S.token ? 45000 : 150000);
}
function drawRuns() {
  const el = $('#runsBody'); if (!el) return; let { runs, queue } = S.runs;
  const isSetup = q => q && (q.mode === 'cardcheck' || q.mode === 'usage');   // deck setup (how the AI plays new cards): background work, not a test
  const setupRuns = runs.filter(r => r.status !== 'completed' && isSetup(r.req)), setupQ = queue.filter(q => isSetup(q.req));
  const active = runs.filter(r => r.status !== 'completed' && !isSetup(r.req)).sort((a, b) => (b.status === 'in_progress') - (a.status === 'in_progress'));
  queue = queue.filter(q => !isSetup(q.req));
  const badge = $('#runBadge'); const n = active.length + queue.length; badge.hidden = !n; badge.textContent = n;
  const setupNote = (setupRuns.length || setupQ.length) ? `<p class="small muted" style="margin:4px 0 14px">${[...setupRuns.map(r => r.req), ...setupQ.map(q => q.req)].map(q => `${esc(deckTitle(q.base || ''))}: ${esc(reqSummary(q).toLowerCase())}`).join(' · ')} (in the background).</p>` : '';
  const card = r => {
    const q = r.req || {}; const mins = (q.minutes || 160) + 15; const el = (Date.now() - new Date(r.started)) / 60000;
    const running = r.status === 'in_progress', waiting = r.status !== 'completed' && !running;
    const pct = r.status === 'completed' ? 100 : running ? Math.min(98, el / mins * 100) : 0;
    const eta = new Date(new Date(r.started).getTime() + mins * 60000);
    const resName = q.name; const hasRes = S.tree.includes(`results/${resName}.md`), hasPeek = S.tree.includes(`results/${resName}_peek.md`);
    const st = running ? `<span class="pill gold">Running · ${Math.round(el)} min</span>` : waiting ? '<span class="pill">Waiting for runners</span>'
      : (r.conclusion === 'success' || hasRes) ? '<span class="pill good">Done</span>' : r.conclusion === 'cancelled' ? '<span class="pill">Cancelled</span>' : `<span class="pill bad">${esc(r.conclusion || 'failed')}</span>`;
    return `<div class="card"><div class="res-head"><div><div class="res-title">${esc(prettyName(resName || 'unknown test', q.title))}</div><div class="small muted">${esc(reqSummary(q))}</div></div>${st}</div>
      ${r.status !== 'completed' ? `<div class="prog"><div style="width:${pct}%"></div></div><div class="small muted">${running ? `Results around ${fmtTime(eta)}` : 'Starts when the current run finishes'}${hasPeek ? ' · early read available' : ''}</div>` : `<div class="small muted" style="margin-top:6px">Finished ${esc(ago(r.updated))}</div>`}
      <div class="row" style="margin-top:10px">
        ${(hasRes || hasPeek) ? `<button class="sm" data-goto="${esc(resName)}" data-base="${esc(q.arms?.[0]?.deck || '')}" data-mode="${esc(q.mode || '')}">View ${hasRes ? 'results' : 'early read'}</button>` : ''}
        ${running && el > 25 ? `<button class="sm" data-peek="${r.id}">Get early read</button>` : ''}
        ${r.status !== 'completed' ? `<button class="sm ghost danger" data-cancel="${r.id}">Cancel</button>` : ''}
        <a class="small" href="${esc(r.url)}" target="_blank" rel="noopener" style="margin-left:auto">GitHub run ↗</a></div></div>`;
  };
  el.innerHTML = `<div class="stack">
    ${active.length ? `<h2>Now</h2>${active.map(card).join('')}` : '<div class="card muted">No test running.</div>'}${setupNote}
    <h2 style="margin-top:22px">Queue</h2>${queue.length ? queue.map((q, i) => `<div class="card row"><div class="grow"><b>${i + 1}. ${esc(q.req?.name || q.path)}</b><div class="small muted">${esc(reqSummary(q.req))} · ${q.req?.precision ? '±' + q.req.precision : (q.req?.minutes || '?') + ' min'}</div></div><button class="sm ghost danger" data-unq="${esc(q.path)}">Remove</button></div>`).join('') : '<div class="card muted small">Nothing queued. Start one from New test.</div>'}
    <h2 style="margin-top:22px">Recent</h2><div class="card" style="padding:4px 12px">${runs.filter(r => r.status === 'completed' && !isSetup(r.req)).slice(0, 8).map(r => { const q = r.req || {}; const hasRes = S.tree.includes(`results/${q.name}.md`); const ok = r.conclusion === 'success' || hasRes;
      return `<div class="rrow"><div class="grow"><div class="rt">${esc(prettyName(q.name || 'unknown test', q.title))}</div><div class="small muted">${ok ? 'Done' : r.conclusion === 'cancelled' ? 'Cancelled' : 'Failed'} · ${esc(ago(r.updated))}</div></div>${hasRes ? `<button class="sm" data-goto="${esc(q.name)}" data-base="${esc(q.arms?.[0]?.deck || '')}">Results</button>` : `<a class="small" href="${esc(r.url)}" target="_blank" rel="noopener">GitHub ↗</a>`}</div>`; }).join('') || '<div class="muted small" style="padding:10px 0">None yet.</div>'}</div>
  </div>`;
  $$('[data-goto]').forEach(b => b.onclick = () => { S.results = null; location.hash = '#deck/' + encodeURIComponent(b.dataset.base || primary()[0]) + (b.dataset.mode === 'audit' ? '/audit' : ''); });
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
    else if (page === 'deck') await viewDeck(v, r.arg, r.sub || 'overview');
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadTree().catch(() => {}); });
  setInterval(() => { if (!document.hidden) loadTree().catch(() => {}); }, 600000);
  window.addEventListener('beforeunload', e => { if (S.deckDirty) { e.preventDefault(); e.returnValue = ''; } });
  $('#view').innerHTML = '<div class="empty"><span class="spin"></span> Loading…</div>';
  try { await Promise.all([loadTree(), loadForge()]); await loadLab(); }
  catch (e) { $('#view').innerHTML = `<div class="note bad">Couldn't reach GitHub: ${esc(e.message)}</div>`; return; }
  route();
  // runs badge on load
  loadRuns().then(() => { const n = S.runs.runs.filter(r => r.status !== 'completed').length + S.runs.queue.length; const b = $('#runBadge'); b.hidden = !n; b.textContent = n; }).catch(() => {});
}
boot();
