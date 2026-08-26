/* ---------------------------------------------------------------- app.js
 * Dashboard. Zero dependencies, no build step — it is served as-is.
 *
 * LAYOUT DECISION worth stating plainly, because it drives everything below:
 * the topology graph is LAYERED (kafka | topic | subscribers), not
 * force-directed. Two reasons, and the second is the important one:
 *   1. The data has an inherent direction. A pipeline drawn as a pipeline is
 *      read faster than the same pipeline drawn as a cloud.
 *   2. Positions must be STABLE across the 2/s update. A force simulation
 *      re-settles on every tick, so nodes drift and swap places while you are
 *      looking at them — which makes a live graph actively harder to read than
 *      a static one. Layering gives deterministic positions: a node sits in
 *      the same place until the topic set itself changes.
 * Nodes are ordered by name (not by rate) for the same reason — sorting by a
 * live metric makes rows jump every tick.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SERIES = ['--s1','--s2','--s3','--s4','--s5','--s6','--s7','--s8'];
/* Must match LOSS_NOTABLE in model/topology.js. If the graph paints an edge red
 * that the Signals panel does not list, these two have drifted apart. */
const LOSS_NOTABLE = 0.05;

const state = {
  app: '', view: 'topology', snap: null,
  colorFor: new Map(),        // topic name -> css var; assigned in fixed order, never recycled
  trace: null, traceId: null,
  conns: new Map(),           // connId -> row (built from the sse event feed)
  churn: [], durations: [],
};

/* Colour follows the entity for the life of the session: a topic keeps its hue
 * even if other topics come and go, so a filter never repaints the survivors. */
function colorOf(name) {
  if (!state.colorFor.has(name)) {
    const used = state.colorFor.size;
    state.colorFor.set(name, used < SERIES.length ? SERIES[used] : null); // null => "Other"
  }
  const v = state.colorFor.get(name);
  return v ? `var(${v})` : 'var(--ink-muted)';
}

const fmt = (n, d = 0) => n == null || !isFinite(n) ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const rate = (n) => n == null ? '–' : n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-US');
const ago = (ts) => { const s = (Date.now() - ts) / 1000; return s < 60 ? `${s.toFixed(0)}s` : s < 3600 ? `${(s/60).toFixed(0)}m` : `${(s/3600).toFixed(1)}h`; };
const dur = (ms) => ms == null ? '–' : ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms/1000).toFixed(1)}s` : `${(ms/60000).toFixed(1)}m`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

/* ------------------------------------------------------------- tooltip -- */
const tip = $('#tip');
function showTip(html, ev) {
  tip.innerHTML = html; tip.classList.add('on');
  const pad = 12, r = tip.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}
const hideTip = () => tip.classList.remove('on');
function bindTip(el, html) {
  el.addEventListener('mousemove', (e) => showTip(html, e));
  el.addEventListener('mouseleave', hideTip);
}

/* ---------------------------------------------------------- sparkline -- */
function sparkline(series, w = 120, h = 26, stroke = 'var(--s1)') {
  if (!series || series.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const max = Math.max(...series, 1);
  const step = w / (series.length - 1);
  const pts = series.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - (v / max) * (h - 3)).toFixed(1)}`);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${stroke}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/* ==========================================================================
 * Topology — layered SVG
 * ====================================================================== */
function renderTopology() {
  const t = state.snap?.topology;
  const wrap = $('#topoWrap');
  if (!t || !t.nodes.length) { wrap.innerHTML = '<div class="empty">no events received yet</div>'; return; }

  const kafka = t.nodes.filter((n) => n.type === 'kafka').sort((a, b) => a.name.localeCompare(b.name));
  const topics = t.nodes.filter((n) => n.type === 'topic').sort((a, b) => a.name.localeCompare(b.name));
  const subs   = t.nodes.filter((n) => n.type === 'sub');

  /* Individual SSE connections are far too many to draw — and drawing them
   * would answer a question nobody asks ("which of my 4000 sockets?").
   * Aggregate per topic into one terminal node showing the count, which is
   * the question actually being asked ("how many, and are they getting it?"). */
  const subsByTopic = new Map();
  for (const e of t.edges) {
    if (!e.from.startsWith('topic:') || !e.to.startsWith('sub:')) continue;
    const topic = e.from.slice(6);
    let g = subsByTopic.get(topic);
    if (!g) { g = { topic, count: 0, delivered: 0, drops: 0, p99: null, kinds: new Set() }; subsByTopic.set(topic, g); }
    g.count++; g.delivered += e.count; g.drops += e.drops;
    if (e.latency?.p99 != null) g.p99 = Math.max(g.p99 ?? 0, e.latency.p99);
    for (const k of Object.keys(e.dropsByReason)) g.kinds.add(k);
  }

  const LANE = [110, 430, 760];
  const BOXW = 210, BOXH = 34, GAP = 12;
  const rows = Math.max(kafka.length, topics.length, subsByTopic.size, 1);
  const H = 46 + rows * (BOXH + GAP);
  const W = 1000;
  const y = (i) => 46 + i * (BOXH + GAP);

  const pos = new Map();
  kafka.forEach((n, i) => pos.set(n.id, { x: LANE[0], y: y(i) }));
  topics.forEach((n, i) => pos.set(n.id, { x: LANE[1], y: y(i) }));
  const topicOrder = new Map(topics.map((n, i) => [n.name, i]));
  const subGroups = [...subsByTopic.values()].sort((a, b) => (topicOrder.get(a.topic) ?? 0) - (topicOrder.get(b.topic) ?? 0));
  subGroups.forEach((g, i) => pos.set(`subs:${g.topic}`, { x: LANE[2], y: y(i) }));

  const maxRate = Math.max(...t.edges.map((e) => e.rate), 1);
  const strokeW = (r) => Math.max(1.2, Math.min(7, 1.2 + (r / maxRate) * 5.8));

  let edges = '';
  const curve = (a, b) => {
    const x1 = a.x + BOXW, y1 = a.y + BOXH / 2, x2 = b.x, y2 = b.y + BOXH / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };
  // kafka -> topic (the inferred, traceId-joined edges)
  for (const e of t.edges) {
    if (!e.from.startsWith('kafka:') || !e.to.startsWith('topic:')) continue;
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    edges += `<path class="edge" d="${curve(a, b)}" stroke="${colorOf(e.to.slice(6))}" stroke-width="${strokeW(e.rate)}" opacity="0.55"/>`;
  }
  // topic -> subscriber group, tinted by loss
  for (const g of subGroups) {
    const a = pos.get(`topic:${g.topic}`), b = pos.get(`subs:${g.topic}`);
    if (!a || !b) continue;
    const total = g.delivered + g.drops;
    const lossy = total > 0 && g.drops / total > LOSS_NOTABLE;
    const tn = t.nodes.find((n) => n.id === `topic:${g.topic}`);
    edges += `<path class="edge" d="${curve(a, b)}" stroke="${lossy ? 'var(--critical)' : colorOf(g.topic)}"
      stroke-width="${strokeW(tn?.rate ?? 0)}" opacity="${lossy ? 0.9 : 0.55}"${lossy ? ' stroke-dasharray="7 4"' : ''}/>`;
  }

  const box = (id, p, title, meta, accent, tipHtml) => `
    <g class="node" data-id="${esc(id)}" data-tip="${esc(tipHtml)}">
      <rect class="nodebox" x="${p.x}" y="${p.y}" width="${BOXW}" height="${BOXH}" rx="7" fill="var(--surface-2)"/>
      <rect x="${p.x}" y="${p.y}" width="3.5" height="${BOXH}" rx="2" fill="${accent}"/>
      <text class="nlabel" x="${p.x + 12}" y="${p.y + 15}">${esc(title)}</text>
      <text class="nmeta"  x="${p.x + 12}" y="${p.y + 27}">${esc(meta)}</text>
    </g>`;

  let boxes = '';
  for (const n of kafka) {
    const p = pos.get(n.id);
    boxes += box(n.id, p, n.name, `${rate(n.rate)}/s · lag ${fmt(n.meta.lag)} · p${(n.meta.partitions || []).length}`, 'var(--ink-muted)',
      `<b>kafka: ${n.name}</b><div class="kv"><span>consumed</span><span>${fmt(n.out)}</span></div>
       <div class="kv"><span>rate</span><span>${rate(n.rate)}/s</span></div>
       <div class="kv"><span>group</span><span>${esc(n.meta.group ?? '–')}</span></div>
       <div class="kv"><span>lag</span><span>${fmt(n.meta.lag)}</span></div>`);
  }
  for (const n of topics) {
    const p = pos.get(n.id);
    const g = subsByTopic.get(n.name);
    boxes += box(n.id, p, n.name, `${rate(n.rate)}/s · ${g ? g.count : 0} subs`, colorOf(n.name),
      `<b>topic: ${n.name}</b><div class="kv"><span>published</span><span>${fmt(n.in)}</span></div>
       <div class="kv"><span>delivered</span><span>${fmt(n.out)}</span></div>
       <div class="kv"><span>rate</span><span>${rate(n.rate)}/s</span></div>
       <div class="kv"><span>publisher</span><span>${esc(n.meta.publisher ?? '–')}</span></div>`);
  }
  for (const g of subGroups) {
    const p = pos.get(`subs:${g.topic}`);
    const total = g.delivered + g.drops;
    const lossPct = total ? (g.drops / total) * 100 : 0;
    boxes += box(`subs:${g.topic}`, p, `${g.count} subscriber${g.count === 1 ? '' : 's'}`,
      `${fmt(g.delivered)} delivered${g.drops ? ` · ${lossPct.toFixed(1)}% lost` : ''}`,
      lossPct > LOSS_NOTABLE * 100 ? 'var(--critical)' : colorOf(g.topic),
      `<b>${g.topic} subscribers</b><div class="kv"><span>subscribers</span><span>${g.count}</span></div>
       <div class="kv"><span>delivered</span><span>${fmt(g.delivered)}</span></div>
       <div class="kv"><span>dropped</span><span>${fmt(g.drops)} (${lossPct.toFixed(2)}%)</span></div>
       <div class="kv"><span>worst p99</span><span>${g.p99 != null ? g.p99.toFixed(1) + 'ms' : '–'}</span></div>
       ${g.kinds.size ? `<div class="kv"><span>reasons</span><span>${[...g.kinds].join(', ')}</span></div>` : ''}`);
  }

  wrap.innerHTML = `<svg class="topo" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
      aria-label="pub/sub topology: ${kafka.length} kafka topics, ${topics.length} pubsub topics, ${subs.length} subscribers">
    <text class="lane" x="${LANE[0]}" y="26">kafka</text>
    <text class="lane" x="${LANE[1]}" y="26">pub/sub topic</text>
    <text class="lane" x="${LANE[2]}" y="26">subscribers</text>
    ${edges}${boxes}
  </svg>`;

  for (const g of $$('#topoWrap g.node')) bindTip(g, g.dataset.tip);

  /* tiles */
  const totalDeliv = [...subsByTopic.values()].reduce((a, b) => a + b.delivered, 0);
  const totalDrops = [...subsByTopic.values()].reduce((a, b) => a + b.drops, 0);
  const lossPct = totalDeliv + totalDrops ? (totalDrops / (totalDeliv + totalDrops)) * 100 : 0;
  const evPerSec = (state.snap.apps || []).reduce((a, b) => a + b.eventsPerSec, 0);
  $('#topoTiles').innerHTML = [
    tile('ingest', rate(evPerSec), 'events/s', ''),
    tile('topics', topics.length, '', `${kafka.length} kafka sources`),
    tile('subscribers', subs.filter((s) => s.meta.active).length, '', `${subs.length} seen this session`),
    tile('delivery loss', lossPct.toFixed(2), '%', `${fmt(totalDrops)} dropped`, lossPct > LOSS_NOTABLE * 100),
  ].join('');

  /* topic table */
  $('#topicTable').innerHTML = `
    <thead><tr><th>Topic</th><th class="n">Rate</th><th>Trend</th><th class="n">Subs</th>
    <th class="n">p99</th><th class="n">Loss</th><th class="n">Last</th></tr></thead><tbody>
    ${topics.map((n) => {
      const g = subsByTopic.get(n.name);
      const total = g ? g.delivered + g.drops : 0;
      const loss = total ? (g.drops / total) * 100 : 0;
      return `<tr>
        <td><span class="name"><i class="swatch" style="background:${colorOf(n.name)}"></i>${esc(n.name)}</span></td>
        <td class="n">${rate(n.rate)}/s</td>
        <td>${sparkline(n.series, 90, 20, colorOf(n.name))}</td>
        <td class="n">${g ? g.count : 0}</td>
        <td class="n">${g?.p99 != null ? g.p99.toFixed(1) : '–'}</td>
        <td class="n" ${loss > LOSS_NOTABLE * 100 ? 'style="color:var(--critical)"' : ''}>${loss ? loss.toFixed(2) + '%' : '–'}</td>
        <td class="n">${ago(n.lastSeen)}</td></tr>`;
    }).join('')}</tbody>`;

  renderSignals(t.signals);
}

function tile(k, v, unit, sub, alert = false) {
  return `<div class="tile${alert ? ' alert' : ''}"><div class="k">${esc(k)}</div>
    <div class="v">${esc(String(v))}${unit ? `<small>${esc(unit)}</small>` : ''}</div>
    <div class="sub">${esc(sub || '')}</div></div>`;
}

function renderSignals(s) {
  const parts = [];
  const section = (title, items, render, tone) => {
    if (!items.length) return;
    parts.push(`<div style="margin-bottom:12px"><div class="pill ${tone}"><b>${items.length}</b> ${esc(title)}</div>
      <table style="margin-top:6px"><tbody>${items.slice(0, 12).map(render).join('')}</tbody></table></div>`);
  };
  section('orphaned topics', s.orphanTopics, (o) =>
    `<tr><td>${esc(o.topic)}</td><td class="n">${fmt(o.published)} published</td><td class="n">0 subscribers</td></tr>`, 'warning');
  section('lossy topics', s.lossyTopics ?? [], (l) =>
    `<tr><td><span class="name"><i class="swatch" style="background:${colorOf(l.topic)}"></i>${esc(l.topic)}</span></td>
     <td class="n">${(l.ratio * 100).toFixed(1)}% lost</td>
     <td class="n">${l.subsAffected}/${l.subsTotal} subs</td>
     <td>${l.shape === 'concentrated'
        ? '<span class="pill warning">⚠ concentrated &mdash; slow subscribers</span>'
        : '<span class="pill critical">⚠ broad &mdash; topic over capacity</span>'}</td>
     <td class="n">${esc(Object.entries(l.reasons).map(([k, v]) => `${k}×${v}`).join(' '))}</td></tr>`, 'critical');
  section('silent subscribers', s.silentSubscribers, (x) =>
    `<tr><td class="mono">${esc(x.subId)}</td><td>${esc(x.kind || '')}</td><td class="n">quiet ${dur(x.quietMs)}</td></tr>`, 'warning');
  $('#signals').innerHTML = parts.length ? parts.join('')
    : '<div class="empty">✓ no orphaned topics, lossy topics, or silent subscribers</div>';
}

/* ==========================================================================
 * Kafka fanout
 * ====================================================================== */
async function refreshTraceList() {
  const app = state.app || state.snap?.apps?.[0]?.app;
  if (!app) return;
  /* Freeze the list once something is selected. A list that reshuffles every
   * 3s moves the row out from under the cursor between mousedown and click —
   * you end up inspecting a different message than the one you aimed at. */
  if (state.traceId) return;
  try {
    const r = await fetch(`/v1/events?app=${encodeURIComponent(app)}&kind=kafka.consume&n=40`);
    const { events } = await r.json();
    const list = events.filter((e) => e.traceId).reverse();
    $('#traceList').innerHTML = list.length ? list.map((e) => `
      <button data-trace="${esc(e.traceId)}" aria-current="${e.traceId === state.traceId}">
        ${esc(e.topic)}<span style="color:var(--ink-muted)"> p${e.partition} @${e.offset} · ${ago(e.ts)} ago</span>
      </button>`).join('') : '<div class="empty">no traced kafka messages yet</div>';
    for (const b of $$('#traceList button')) b.onclick = () => loadTrace(app, b.dataset.trace);
  } catch { /* transient */ }
}

async function loadTrace(app, id) {
  state.traceId = id;
  $('#traceHint').hidden = false;
  for (const b of $$('#traceList button')) b.setAttribute('aria-current', String(b.dataset.trace === id));
  const r = await fetch(`/v1/trace?app=${encodeURIComponent(app)}&id=${encodeURIComponent(id)}`);
  const data = await r.json();
  if (data.error) { $('#traceTree').innerHTML = `<div class="empty">${esc(data.error)}</div>`; return; }
  renderTrace(data);
}

/* The tree is grouped by hop, not flat, because the question is "where did it
 * stop", and a flat 400-line list of deliveries buries that. */
function renderTrace(data) {
  const evs = data.events;
  const t0 = evs[0]?.ts ?? 0;
  const by = (k) => evs.filter((e) => e.kind === k);
  const consume = by('kafka.consume')[0];
  const pubs = by('pubsub.publish');
  const delivers = by('pubsub.deliver');
  const drops = by('pubsub.drop');
  const frames = by('sse.frame');

  const hop = (rail, kind, det, color) =>
    `<div class="hop"><span class="rail">${rail}</span><span class="kind" style="color:${color}">${esc(kind)}</span><span class="det">${det}</span></div>`;

  let html = '';
  if (consume) html += hop('', 'kafka.consume', `<b>${esc(consume.topic)}</b> partition ${consume.partition} offset ${consume.offset} · lag ${fmt(consume.lag)}`, 'var(--ink)');
  for (const p of pubs) {
    const d = delivers.filter((x) => x.topic === p.topic);
    const dr = drops.filter((x) => x.topic === p.topic);
    const f = frames.filter((x) => x.topic === p.topic);
    html += hop('└─ ', 'pubsub.publish', `<b>${esc(p.topic)}</b> ${fmt(p.bytes)}B · +${(p.ts - t0)}ms`, colorOf(p.topic));
    html += hop('   ├─ ', 'pubsub.deliver', `${d.length} subscriber${d.length === 1 ? '' : 's'}${d.length ? ` · latency ${Math.min(...d.map(x=>x.latencyMs??0)).toFixed(1)}–${Math.max(...d.map(x=>x.latencyMs??0)).toFixed(1)}ms` : ''}`, 'var(--good)');
    html += hop('   ├─ ', 'sse.frame', `${f.length} frame${f.length === 1 ? '' : 's'} written`, 'var(--good)');
    if (dr.length) html += hop('   └─ ', 'pubsub.drop', `<b style="color:var(--critical)">${dr.length} dropped</b> · ${esc([...new Set(dr.map(x=>x.reason))].join(', '))}`, 'var(--critical)');
  }
  const span = evs.length ? evs[evs.length - 1].ts - t0 : 0;
  $('#traceTree').innerHTML = `<div class="tree">${html}</div>
    <div class="legend"><span>trace <code>${esc(data.traceId)}</code></span>
    <span>${evs.length} events</span><span>span ${span}ms</span>
    <span>amplification ×${pubs.length ? (delivers.length / 1).toFixed(0) : 0}</span></div>`;
}

function renderAmp() {
  const s = state.snap?.topology?.signals?.amplification ?? [];
  $('#ampTable').innerHTML = s.length ? `
    <thead><tr><th>Kafka topic</th><th class="n">Consumed</th><th class="n">Delivered</th><th class="n">Factor</th></tr></thead>
    <tbody>${s.sort((a,b)=>b.factor-a.factor).map((a) => `<tr>
      <td>${esc(a.kafkaTopic)}</td><td class="n">${fmt(a.consumed)}</td>
      <td class="n">${fmt(a.delivered)}</td>
      <td class="n"><b>×${a.factor.toFixed(1)}</b></td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="empty">no traced kafka traffic yet</td></tr></tbody>';
}

/* ==========================================================================
 * SSE lifecycle
 *
 * Connection STATE comes from the topology engine, not from the raw event
 * tail. Rebuilding it client-side from the last N events was wrong: sse.frame
 * outnumbers sse.open by orders of magnitude, so a 1500-event tail covers only
 * a few seconds and the view reported "2 open connections" when 30 were live.
 * The event tail is still the right source for the churn TIMELINE — that is a
 * genuine time series — but never for "what exists right now".
 * ====================================================================== */
function sseConnections() {
  const t = state.snap?.topology;
  if (!t) return { conns: [], topicsBySub: new Map() };
  const topicsBySub = new Map();
  for (const e of t.edges) {
    if (!e.from.startsWith('topic:') || !e.to.startsWith('sub:')) continue;
    const id = e.to.slice(4);
    if (!topicsBySub.has(id)) topicsBySub.set(id, []);
    topicsBySub.get(id).push(e.from.slice(6));
  }
  const conns = t.nodes
    .filter((n) => n.type === 'sub' && n.meta.subscriberKind === 'sse')
    .map((n) => ({
      connId: n.name, topics: topicsBySub.get(n.name) || [],
      frames: n.meta.frames || 0, bytes: n.bytes,
      openedAt: n.meta.openedAt ?? n.firstSeen, remote: n.meta.remote,
      active: !!n.meta.active, closeReason: n.meta.closeReason,
      durationMs: n.meta.durationMs, resume: n.meta.resume, stalls: n.meta.stalls || 0,
      lastSeen: n.lastSeen,
    }));
  return { conns, topicsBySub };
}

async function refreshSse() {
  const { conns } = sseConnections();
  const open = conns.filter((c) => c.active);
  const closed = conns.filter((c) => !c.active);
  const resumeOk = conns.filter((c) => c.resume === 'ok').length;
  const resumeMiss = conns.filter((c) => c.resume && c.resume !== 'ok').length;
  const stalls = conns.reduce((a, c) => a + c.stalls, 0);

  $('#sseTiles').innerHTML = [
    tile('open connections', open.length, '', `${conns.length} seen this session`),
    tile('closed', closed.length, '', 'this session'),
    tile('resume misses', resumeMiss, '', `${resumeOk} resumed cleanly`, resumeMiss > resumeOk),
    tile('stalls', stalls, '', 'slow-consumer backpressure', stalls > 0),
  ].join('');

  renderDurations(closed.map((c) => c.durationMs).filter((d) => d != null));

  $('#connTable').innerHTML = `
    <thead><tr><th>Connection</th><th>Topics</th><th class="n">Frames</th><th class="n">Bytes</th>
    <th class="n">Age</th><th>Resume</th><th>State</th></tr></thead><tbody>
    ${conns.sort((a, b) => b.openedAt - a.openedAt).slice(0, 200).map((c) => `<tr>
      <td class="mono">${esc(c.connId)}<span style="color:var(--ink-muted)"> ${esc(c.remote || '')}</span></td>
      <td>${c.topics.slice(0, 3).map((t) => `<span class="name" style="display:inline-flex;margin-right:7px"><i class="swatch" style="background:${colorOf(t)}"></i>${esc(t)}</span>`).join('')}${c.topics.length > 3 ? `<span style="color:var(--ink-muted)">+${c.topics.length - 3}</span>` : ''}</td>
      <td class="n">${fmt(c.frames)}</td>
      <td class="n">${fmt(c.bytes / 1024, 1)}K</td>
      <td class="n">${c.active ? ago(c.openedAt) : dur(c.durationMs)}</td>
      <td>${c.resume ? `<span class="pill ${c.resume === 'ok' ? 'good' : 'warning'}">${c.resume === 'ok' ? '✓' : '⚠'} ${esc(c.resume)}</span>` : ''}</td>
      <td>${c.active ? '<span class="pill good">● open</span>' : `<span class="pill">○ ${esc(c.closeReason || 'closed')}</span>`}</td>
    </tr>`).join('')}</tbody>`;

  // Churn timeline still comes from the raw feed — it is a real time series.
  const app = state.app || state.snap?.apps?.[0]?.app;
  if (!app) return;
  try {
    const r = await fetch(`/v1/events?app=${encodeURIComponent(app)}&kind=sse.&n=2000`);
    const { events } = await r.json();
    const lifecycle = events.filter((e) => e.kind === 'sse.open' || e.kind === 'sse.close');
    if (!lifecycle.length) { $('#churn').innerHTML = '<div class="empty">no connection churn in window</div>'; return; }
    const B = 40;
    const t0 = lifecycle[0].ts, t1 = lifecycle[lifecycle.length - 1].ts;
    const openB = new Array(B).fill(0), closeB = new Array(B).fill(0);
    for (const e of lifecycle) {
      const i = Math.min(B - 1, Math.floor(((e.ts - t0) / Math.max(t1 - t0, 1)) * B));
      (e.kind === 'sse.open' ? openB : closeB)[i]++;
    }
    $('#churn').innerHTML = `
      ${sparkline(openB, 460, 54, 'var(--s1)')}
      ${sparkline(closeB, 460, 54, 'var(--s2)')}
      <div class="legend">
        <span><i class="swatch" style="background:var(--s1)"></i>opened</span>
        <span><i class="swatch" style="background:var(--s2)"></i>closed</span>
        <span style="color:var(--ink-muted)">${lifecycle.length} events over ${dur(t1 - t0)}</span>
      </div>`;
  } catch { /* transient */ }
}

/* Duration histogram in plain HTML, not SVG: bar widths are percentages, which
 * a browser lays out responsively for free. The SVG version needed viewBox
 * arithmetic and letterboxed its own labels off-centre at narrow widths.
 * Log-ish buckets because lifetimes span milliseconds (a reconnect storm) to
 * hours (a healthy dashboard), and a linear axis hides the short-lived tail
 * that is the entire reason to look. */
function renderDurations(ds) {
  if (!ds.length) { $('#durHist').innerHTML = '<div class="empty">no closed connections yet</div>'; return; }
  const edges = [0, 1e3, 5e3, 15e3, 60e3, 300e3, 900e3, Infinity];
  const labels = ['<1s', '1–5s', '5–15s', '15–60s', '1–5m', '5–15m', '>15m'];
  const counts = new Array(labels.length).fill(0);
  for (const d of ds) for (let i = 0; i < labels.length; i++) if (d >= edges[i] && d < edges[i + 1]) { counts[i]++; break; }
  const max = Math.max(...counts, 1);
  const shortLived = counts[0] + counts[1];
  $('#durHist').innerHTML = `
    <div class="hbars">
      ${labels.map((l, i) => `
        <div class="hbar">
          <span class="hlabel">${l}</span>
          <span class="htrack"><i style="width:${(counts[i] / max) * 100}%;background:${i < 2 && counts[i] ? 'var(--critical)' : 'var(--s1)'}"></i></span>
          <span class="hval">${counts[i] || ''}</span>
        </div>`).join('')}
    </div>
    ${shortLived ? `<div class="pill critical" style="margin-top:8px">⚠ <b>${shortLived}</b> connection${shortLived === 1 ? '' : 's'} lived under 5s — likely a reconnect loop</div>` : ''}`;
}

/* ==========================================================================
 * Apps
 * ====================================================================== */
function renderApps() {
  const apps = state.snap?.apps ?? [];
  $('#appCards').innerHTML = apps.length ? apps.map((a) => {
    const inst = a.instances || [];
    return `<div class="panel"><h2>${esc(a.app)}</h2><div class="body">
      <div class="tiles">
        ${tile('events/s', rate(a.eventsPerSec), '', `${fmt(a.events)} total`)}
        ${tile('instances', inst.length, '', inst.map(i=>i.instance).slice(0,2).join(', '))}
        ${tile('last seen', ago(a.lastSeen), '', '')}
      </div>
      <div style="margin-top:10px">${sparkline(a.series, 900, 40, 'var(--s1)')}</div>
      <table style="margin-top:10px"><thead><tr><th>Instance</th><th class="n">RSS</th><th class="n">Heap</th>
      <th class="n">CPU</th><th class="n">Lag</th><th class="n">Conns</th><th>Work attribution</th></tr></thead><tbody>
      ${inst.map((i) => {
        const s = i.stats || {}, at = i.attrib || {};
        const tot = (at.pubsubNs || 0) + (at.sseNs || 0);
        const pub = tot ? (at.pubsubNs / tot) * 100 : 0;
        return `<tr>
          <td class="mono">${esc(i.instance)}</td>
          <td class="n">${fmt(s.rssMB, 0)}M</td><td class="n">${fmt(s.heapMB, 0)}M</td>
          <td class="n" ${s.cpuPct > 70 ? 'style="color:var(--critical)"' : ''}>${fmt(s.cpuPct, 0)}%</td>
          <td class="n" ${s.lagMs > 20 ? 'style="color:var(--warning)"' : ''}>${fmt(s.lagMs, 1)}ms</td>
          <td class="n">${fmt(s.conns)}</td>
          <td>${tot ? `<div class="attrib" title="broker ${pub.toFixed(0)}% / transport ${(100-pub).toFixed(0)}%">
              <i style="width:${pub}%;background:var(--s1)"></i><i style="width:${100-pub}%;background:var(--s3)"></i></div>
              <div class="legend"><span><i class="swatch" style="background:var(--s1)"></i>broker ${pub.toFixed(0)}%</span>
              <span><i class="swatch" style="background:var(--s3)"></i>transport ${(100-pub).toFixed(0)}%</span></div>` : '–'}</td>
        </tr>`;
      }).join('')}</tbody></table>
    </div></div>`;
  }).join('') : '<div class="panel"><div class="empty">no apps reporting — point one at POST /v1/ingest</div></div>';

  const s = state.snap?.self;
  if (s) {
    const i = s.ingest;
    $('#selfTable').innerHTML = `<thead><tr><th>Accepted</th><th class="n">Bad JSON</th><th class="n">Schema rejects</th>
      <th class="n">Shed</th><th class="n">Queue</th><th class="n">Buffered events</th><th class="n">Evicted</th></tr></thead>
      <tbody><tr><td class="n">${fmt(i.accepted)}</td>
      <td class="n" ${i.badJson ? 'style="color:var(--critical)"' : ''}>${fmt(i.badJson)}</td>
      <td class="n" ${i.badSchema ? 'style="color:var(--warning)"' : ''}>${fmt(i.badSchema)}</td>
      <td class="n" ${i.shed ? 'style="color:var(--critical)"' : ''}>${fmt(i.shed)}</td>
      <td class="n">${fmt(s.queueDepth)}</td>
      <td class="n">${fmt(s.store.events)}</td>
      <td class="n">${fmt(s.store.evicted)}</td></tr></tbody>`;
  }
}

/* ==========================================================================
 * live stream + routing
 * ====================================================================== */
function render() {
  if (state.view === 'topology') renderTopology();
  else if (state.view === 'fanout') renderAmp();
  else if (state.view === 'apps') renderApps();
}

function connect() {
  const es = new EventSource('/v1/live');
  es.addEventListener('open', () => { $('#dot').classList.add('on'); $('#conn').textContent = 'live'; });
  es.addEventListener('error', () => { $('#dot').classList.remove('on'); $('#conn').textContent = 'reconnecting…'; });
  es.addEventListener('snapshot', (e) => {
    state.snap = JSON.parse(e.data);
    const sel = $('#appPick');
    const names = state.snap.apps.map((a) => a.app);
    if (sel.options.length - 1 !== names.length) {
      sel.innerHTML = '<option value="">all</option>' + names.map((n) => `<option>${esc(n)}</option>`).join('');
      sel.value = state.app;
    }
    render();
  });
}

for (const b of $$('nav.tabs button')) {
  b.onclick = () => {
    state.view = b.dataset.view;
    for (const o of $$('nav.tabs button')) o.setAttribute('aria-selected', String(o === b));
    for (const v of $$('.view')) v.hidden = v.id !== `v-${state.view}`;
    render();
    if (state.view === 'fanout') refreshTraceList();
    if (state.view === 'sse') refreshSse();
  };
}
$('#unfreeze').onclick = () => {
  state.traceId = null;
  $('#traceHint').hidden = true;
  $('#traceTree').innerHTML = '<div class="empty">select a message to reconstruct its blast radius</div>';
  refreshTraceList();
};
$('#appPick').onchange = (e) => { state.app = e.target.value; render(); };
$('#themeBtn').onclick = () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
  if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('obs-theme', next); } catch {}
  render();
};
try { const t = localStorage.getItem('obs-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
$('#hostLabel').textContent = location.host;

setInterval(() => { if (state.view === 'fanout') refreshTraceList(); if (state.view === 'sse') refreshSse(); }, 3000);
connect();
