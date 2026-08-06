#!/usr/bin/env node
'use strict';
/* =============================================================================
 * server.js — SSE pub/sub server + live dashboard.  Zero deps, Node 18+.
 *
 *   node --max-old-space-size=8192 server.js --port 8080 --workers 4
 *
 * Speaks real SSE: named event types, `id:` with Last-Event-ID resume from a
 * per-topic replay buffer, `retry:` hints, per-topic subscriptions, and a set
 * of synthetic publishers so the pub/sub panel reflects actual traffic.
 *
 * ENDPOINTS
 *   GET  /events?topics=a,b     SSE stream (Last-Event-ID header resumes)
 *   POST /publish?topic=        broadcast body verbatim
 *   POST /report                client check-in (client.js)
 *   GET  /time                  clock-offset probe
 *   GET  /stats  /health
 *
 * KEYS  q quit · space pause · f fields · p pub/sub · h headers · / filter
 *       up/down scroll · r reset · +/- publish rate
 *
 * TUNE FIRST or the numbers are fiction:
 *   ulimit -n 2000000
 *   sysctl -w fs.file-max=2000000 fs.nr_open=2000000
 *   sysctl -w net.core.somaxconn=65535 net.ipv4.tcp_max_syn_backlog=65535
 *   sysctl -w net.ipv4.ip_local_port_range="1024 65535"
 * ===========================================================================*/

const http = require('http');
const cluster = require('cluster');
const os = require('os');
const crypto = require('crypto');
const { monitorEventLoopDelay } = require('perf_hooks');

// ==================================================================== args
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return o;
}
const expandPorts = (spec) => {
  const out = [];
  for (const part of String(spec).split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let p = +m[1]; p <= +m[2]; p++) out.push(p);
    else out.push(+part);
  }
  return out;
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`server.js [--port 8080 | --ports 8080-8083] [--workers N] [--host 0.0.0.0]
          [--retry 3000] [--replay 128] [--batch 5000] [--plain]`);
  process.exit(0);
}
const PORTS = expandPorts(args.ports || args.port || '8080');
const HOST = args.host || '0.0.0.0';
const WORKERS = Math.max(1, +(args.workers || 1));
const BATCH = +(args.batch || 5000);
const RETRY_MS = +(args.retry || 3000);
const REPLAY = +(args.replay || 128);
const PLAIN = args.plain === 'true' || !process.stdout.isTTY;
const MAX_BODY = 1 << 20;
const SESSION = crypto.randomBytes(2).toString('hex');

// Synthetic publishers. Each drives one topic at its own rate, so the pub/sub
// panel shows real fanout instead of one global broadcast loop.
const PUBLISHERS = [
  { pub: 'svc-orders',    topic: 'orders.eu',    rate: 4,   event: 'message', bytes: 480 },
  { pub: 'svc-orders',    topic: 'orders.us',    rate: 3.5, event: 'message', bytes: 480 },
  { pub: 'svc-pricing',   topic: 'pricing.tick', rate: 12,  event: 'delta',   bytes: 96 },
  { pub: 'svc-inventory', topic: 'inv.delta',    rate: 1.5, event: 'delta',   bytes: 128,
    snapshotEvery: 12, snapshotBytes: 2100 },
  { pub: 'svc-audit',     topic: 'audit.trail',  rate: 0.6, event: 'message', bytes: 164 },
  { pub: 'svc-notify',    topic: 'notify.push',  rate: 0.4, event: 'message', bytes: 512 },
];
const TOPICS = [...new Set(PUBLISHERS.map((p) => p.topic))];
const HEARTBEAT_MS = 15000;

/* ============================================================== tiny ui kit */
const C = {
  rst: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  gray: '\x1b[38;5;244m', dark: '\x1b[38;5;238m', white: '\x1b[38;5;253m',
  cyan: '\x1b[38;5;80m', blue: '\x1b[38;5;75m', green: '\x1b[38;5;114m',
  yellow: '\x1b[38;5;179m', red: '\x1b[38;5;203m', mag: '\x1b[38;5;176m',
  alt: '\x1b[?1049h', unalt: '\x1b[?1049l', hide: '\x1b[?25l', show: '\x1b[?25h',
  home: '\x1b[H', clrLine: '\x1b[K', clrDown: '\x1b[J',
};
const BADGE = {
  message:   '\x1b[48;5;24m\x1b[38;5;153m',
  delta:     '\x1b[48;5;23m\x1b[38;5;115m',
  snapshot:  '\x1b[48;5;53m\x1b[38;5;183m',
  heartbeat: '\x1b[48;5;236m\x1b[38;5;245m',
  error:     '\x1b[48;5;52m\x1b[38;5;210m',
  reconnect: '\x1b[48;5;58m\x1b[38;5;222m',
};
const SPARK = '▁▂▃▄▅▆▇█';
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const vw = (s) => strip(s).length;
const padE = (s, w) => s + ' '.repeat(Math.max(0, w - vw(s)));
const padS = (s, w) => ' '.repeat(Math.max(0, w - vw(s))) + s;
const cut = (s, n) => (s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…');
const num = (n) => (n == null ? '-' : Math.round(n).toLocaleString('en-US').replace(/,/g, ' '));
const badge = (t) => `${BADGE[t] || BADGE.message} ${t} ${C.rst}`;
const heat = (v, warn, bad) => (v >= bad ? C.red : v >= warn ? C.yellow : C.green);
const spark = (d, w) => {
  const a = d.slice(-w);
  if (!a.length) return '';
  const mx = Math.max(...a, 1);
  return a.map((v) => SPARK[Math.min(7, Math.floor((v / mx) * 7.99))]).join('');
};
/** Panel with an inset title: ┌ TITLE ─────┐ */
function box(title, width, lines) {
  const inner = width - 2;
  const head = title
    ? `${C.dark}┌${C.rst} ${C.gray}${title}${C.rst} ${C.dark}${'─'.repeat(Math.max(0, inner - vw(title) - 3))}┐${C.rst}`
    : `${C.dark}┌${'─'.repeat(inner)}┐${C.rst}`;
  const out = [head];
  for (const l of lines) out.push(`${C.dark}│${C.rst}${padE(l, inner)}${C.dark}│${C.rst}`);
  out.push(`${C.dark}└${'─'.repeat(inner)}┘${C.rst}`);
  return out;
}
/** Place panels side by side, padding each to its declared width. */
function hstack(panels, widths, gap = 1) {
  const h = Math.max(...panels.map((p) => p.length));
  const out = [];
  for (let i = 0; i < h; i++) {
    out.push(panels.map((p, j) => padE(p[i] ?? '', widths[j])).join(' '.repeat(gap)));
  }
  return out;
}

/* ================================================================== primary */
if (WORKERS > 1 && cluster.isPrimary) {
  cluster.schedulingPolicy = cluster.SCHED_NONE;   // kernel spreads accepts
  const wstats = new Map();
  const hub = createHub();

  const fork = () => {
    const w = cluster.fork();
    w.on('message', (m) => {
      if (m.t === 'stats') wstats.set(w.id, m.v);
      else if (m.t === 'report') hub.ingestReport(m.v);
      else if (m.t === 'pub') hub.publishRaw(m.topic, m.data, 'message', 'api');
    });
    w.on('exit', (c, sg) => {
      hub.logLine(`worker ${w.pid} exited (${c}/${sg}) — restarting`);
      wstats.delete(w.id);
      setTimeout(fork, 500);
    });
  };
  for (let i = 0; i < WORKERS; i++) fork();

  setInterval(() => {
    const agg = { conns: 0, total: 0, closed: 0, dropped: 0, reconnects: 0, slowWrites: 0,
                  rssMB: 0, heapMB: 0, cpuPct: 0, lagMs: 0, subs: {}, sample: {} };
    for (const s of wstats.values()) {
      agg.conns += s.conns; agg.total += s.total; agg.closed += s.closed;
      agg.dropped += s.dropped; agg.reconnects += s.reconnects; agg.slowWrites += s.slowWrites;
      agg.rssMB += s.rssMB; agg.heapMB += s.heapMB; agg.cpuPct += s.cpuPct;
      agg.lagMs = Math.max(agg.lagMs, s.lagMs);
      for (const t in s.subs) agg.subs[t] = (agg.subs[t] || 0) + s.subs[t];
      for (const t in s.sample) agg.sample[t] = s.sample[t];
    }
    hub.setServer(agg);
  }, 500).unref();

  hub.start((topic, frame) => {
    for (const id in cluster.workers) cluster.workers[id].send({ t: 'frame', topic, frame });
  });
  return;
}

/* =================================================================== worker */
const subs = new Map();          // topic -> Set<socket>
const replay = new Map();        // topic -> [{id, frame}]
const stats = { conns: 0, total: 0, closed: 0, dropped: 0, reconnects: 0, slowWrites: 0,
                rssMB: 0, heapMB: 0, cpuPct: 0, lagMs: 0 };
let connSeq = 0;
const sampleId = {};             // topic -> a recent client id, for the stream panel
const localHub = cluster.isWorker ? null : createHub();
const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();
for (const t of TOPICS) { subs.set(t, new Set()); replay.set(t, []); }

const chunk = (payload) => {
  const b = Buffer.from(payload);
  return Buffer.concat([Buffer.from(b.length.toString(16) + '\r\n'), b, Buffer.from('\r\n')]);
};

function subscribe(topics, socket, lastEventId) {
  const id = `c-${(connSeq++).toString(16).padStart(4, '0')}`;
  socket.__id = id;
  stats.conns++; stats.total++;
  for (const t of topics) {
    if (!subs.has(t)) { subs.set(t, new Set()); replay.set(t, []); }
    subs.get(t).add(socket);
    sampleId[t] = id;
  }
  if (lastEventId) {
    stats.reconnects++;
    // Replay everything newer than the id the client last saw. This is the
    // entire point of `id:` — without it, a reconnect silently loses events.
    for (const t of topics) {
      const buf = replay.get(t) || [];
      const at = buf.findIndex((e) => e.id === lastEventId);
      if (at >= 0) for (let i = at + 1; i < buf.length; i++) socket.write(buf[i].frame);
    }
  }
  socket.once('close', () => {
    stats.conns--; stats.closed++;
    for (const t of topics) subs.get(t)?.delete(socket);
  });
  return id;
}

/** Fan out in slices so one big broadcast can't stall accepts or reads. */
function fanout(topic, frameBuf, done) {
  const set = subs.get(topic);
  if (!set || !set.size) return done && done(0, 0);
  const it = set.values();               // live iterator, safe across closes
  const t0 = process.hrtime.bigint();
  let n = 0;
  (function pump() {
    let i = 0;
    for (;;) {
      const r = it.next();
      if (r.done) return done && done(n, Number(process.hrtime.bigint() - t0) / 1e6);
      const s = r.value;
      if (!s.destroyed && s.writable) {
        if (!s.write(frameBuf)) stats.slowWrites++;   // kernel buffer backing up
        n++;
      } else stats.dropped++;
      if (++i >= BATCH) break;
    }
    setImmediate(pump);
  })();
}

function acceptFrame(topic, frameStr) {
  const buf = chunk(frameStr);
  const m = frameStr.match(/^id: (.+)$/m);
  if (m) {
    const b = replay.get(topic) || [];
    b.push({ id: m[1], frame: buf });
    if (b.length > REPLAY) b.shift();
    replay.set(topic, b);
  }
  fanout(topic, buf);
}

if (cluster.isWorker) {
  process.on('message', (m) => { if (m.t === 'frame') acceptFrame(m.topic, m.frame); });
}

let lastCpu = process.cpuUsage(), lastT = Date.now();
setInterval(() => {
  const c = process.cpuUsage(), now = Date.now();
  stats.cpuPct = Math.round((((c.user - lastCpu.user) + (c.system - lastCpu.system)) /
                             ((now - lastT) * 1000)) * 100);
  lastCpu = c; lastT = now;
  const mu = process.memoryUsage();
  stats.rssMB = Math.round(mu.rss / 1048576);
  stats.heapMB = Math.round(mu.heapUsed / 1048576);
  stats.lagMs = +(lag.mean / 1e6).toFixed(1);
  lag.reset();
  const subCounts = {};
  for (const [t, s] of subs) subCounts[t] = s.size;
  if (cluster.isWorker) process.send({ t: 'stats', v: { ...stats, subs: subCounts, sample: sampleId } });
  else localHub.setServer({ ...stats, subs: subCounts, sample: sampleId });
}, 500).unref();

const json = (res, o, code = 200) => {
  const b = Buffer.from(JSON.stringify(o));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length });
  res.end(b);
};
const readBody = (req, cb) => {
  let body = '', size = 0;
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) return req.destroy(); body += c; });
  req.on('end', () => cb(body));
};

function handler(req, res) {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/events') {
    const wanted = (url.searchParams.get('topics') || url.searchParams.get('topic') || TOPICS.join(','))
      .split(',').map((s) => s.trim()).filter(Boolean);
    const socket = res.socket;
    socket.setNoDelay(true);
    socket.setTimeout(0);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Node-Id': `srv-${process.pid}`,
    });
    res.flushHeaders();
    // Past this point we write pre-framed chunks straight to the socket and
    // never touch `res` again — that skips the ServerResponse write path.
    socket.write(chunk(`retry: ${RETRY_MS}\n\n`));
    subscribe(wanted, socket, req.headers['last-event-id'] || url.searchParams.get('lastEventId'));
    return;
  }

  if (url.pathname === '/publish') {
    const topic = url.searchParams.get('topic') || TOPICS[0];
    return readBody(req, (b) => {
      if (cluster.isWorker) process.send({ t: 'pub', topic, data: b || '{}' });
      else localHub.publishRaw(topic, b || '{}', 'message', 'api');
      json(res, { ok: true, topic });
    });
  }
  if (url.pathname === '/report') {
    return readBody(req, (b) => {
      try {
        const v = JSON.parse(b);
        if (cluster.isWorker) process.send({ t: 'report', v });
        else localHub.ingestReport(v);
      } catch {}
      json(res, { ok: true });
    });
  }
  if (url.pathname === '/time') return json(res, { t: Date.now() });
  if (url.pathname === '/stats') {
    const s = {};
    for (const [t, set] of subs) s[t] = set.size;
    return json(res, { pid: process.pid, cpus: os.cpus().length, worker: stats, subs: s,
                       topics: TOPICS, uptimeSec: Math.round(process.uptime()) });
  }
  if (url.pathname === '/health') return json(res, { ok: true });
  json(res, { endpoints: ['/events', '/publish', '/report', '/time', '/stats'] }, 404);
}

for (const port of PORTS) {
  const server = http.createServer(handler);
  // Mandatory for SSE: Node otherwise kills any request at 300s (requestTimeout)
  // and idle sockets at 5s (keepAliveTimeout). Never set maxConnections — 0
  // means zero, not unlimited.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 0;
  server.timeout = 0;
  server.listen(port, HOST, () => { if (PLAIN) console.log(`listening ${HOST}:${port}`); });
  server.on('error', (e) => console.error(`${port}: ${e.message}`));
}
process.on('uncaughtException', (e) => {
  if (e.code === 'ECONNRESET' || e.code === 'EPIPE') return;
  console.error('[uncaught]', e);
});
if (!cluster.isWorker) localHub.start((topic, frame) => acceptFrame(topic, frame));

/* ===========================================================================
 *                    HUB — publishing, aggregation, dashboard
 * ===========================================================================*/
function createHub() {
  const S = {
    server: { conns: 0, total: 0, closed: 0, dropped: 0, reconnects: 0, slowWrites: 0,
              rssMB: 0, heapMB: 0, cpuPct: 0, lagMs: 0, subs: {}, sample: {} },
    topics: new Map(),
    stream: [], connHist: [], clients: new Map(),
    peak: 0, accept: 0, lastTotal: 0, rateMul: 1, evtRate: 0, evtCount: 0,
    paused: false, scroll: 0, fields: 0, showHeaders: true, expandPubSub: false,
    filter: '', filterMode: false, logs: [], started: Date.now(), baseRSS: null,
  };
  for (const p of PUBLISHERS) {
    S.topics.set(p.topic, { pub: p.pub, seq: 0, sent: 0, rate: 0, queue: 0, last: 0, lastMs: 0 });
  }
  let emit = null;

  const logLine = (s) => {
    S.logs.push(`${new Date().toTimeString().slice(0, 8)}  ${s}`);
    if (S.logs.length > 40) S.logs.shift();
    if (PLAIN) console.log(s);
  };
  const ingestReport = (v) => { if (v?.label) S.clients.set(v.label, { ...v, lastSeen: Date.now() }); };
  const setServer = (v) => {
    Object.assign(S.server, v);
    S.peak = Math.max(S.peak, v.conns);
    if (v.conns === 0 && v.rssMB > 0) S.baseRSS = S.baseRSS == null ? v.rssMB : Math.min(S.baseRSS, v.rssMB);
  };

  const payload = (p, type) => {
    const base = p.topic === 'pricing.tick'
      ? { sym: ['EURUSD', 'GBPUSD', 'USDJPY'][Math.floor(Math.random() * 3)],
          d: +(Math.random() * 0.004 - 0.002).toFixed(4) }
      : p.topic === 'inv.delta'
      ? { sku: `SKU-${4000 + Math.floor(Math.random() * 6000)}`, qty: Math.floor(Math.random() * 200) }
      : { orderId: `A-${8000 + Math.floor(Math.random() * 2000)}`,
          status: ['paid', 'pending', 'shipped'][Math.floor(Math.random() * 3)] };
    const target = type === 'snapshot' ? p.snapshotBytes || 2100 : p.bytes;
    const obj = { ...base, ts: Date.now() };
    let s = JSON.stringify(obj);
    if (s.length < target) s = JSON.stringify({ ...obj, pad: 'x'.repeat(target - s.length - 9) });
    return s;
  };

  /** Build a full SSE frame and hand it to the fanout path. */
  const emitFrame = (topic, type, data, pubName) => {
    let t = S.topics.get(topic);
    if (!t) { t = { pub: pubName || 'api', seq: 0, sent: 0, rate: 0, queue: 0, last: 0, lastMs: 0 };
              S.topics.set(topic, t); }
    const id = `${SESSION}-${(++t.seq).toString().padStart(4, '0')}`;
    // `channel:` is a custom SSE field. The spec requires unknown fields to be
    // ignored, so this is safe for any compliant client, and it means our
    // client knows the topic instead of guessing it from the payload shape.
    const frame = `event: ${type}\nid: ${id}\nchannel: ${topic}\ndata: ${data}\n\n`;
    t.queue++;
    const t0 = Date.now();
    emit(topic, frame);
    t.queue--;
    t.last = t0;
    t.lastMs = Date.now() - t0;
    t.sent += S.server.subs[topic] || 0;
    S.evtCount++;
    if (!S.paused) {
      S.stream.push({ t: new Date(), seq: t.seq, client: S.server.sample[topic] || '-',
                      event: type, channel: topic, bytes: Buffer.byteLength(data),
                      lat: t.lastMs, id, payload: data });
      if (S.stream.length > 800) S.stream.shift();
    }
  };
  const publishRaw = (topic, data, type, pub) => emitFrame(topic, type || 'message', data, pub);

  const timers = [];
  const armPublishers = () => {
    for (const tm of timers) clearInterval(tm);
    timers.length = 0;
    for (const p of PUBLISHERS) {
      let n = 0;
      const every = Math.max(20, 1000 / (p.rate * S.rateMul));
      timers.push(setInterval(() => {
        const type = p.snapshotEvery && ++n % p.snapshotEvery === 0 ? 'snapshot' : p.event;
        emitFrame(p.topic, type, payload(p, type), p.pub);
      }, every));
    }
    timers.push(setInterval(() => {
      for (const t of TOPICS) emitFrame(t, 'heartbeat', ': keep-alive', 'server');
    }, HEARTBEAT_MS));
  };

  /* ------------------------------------------------------------- rendering */
  const localIP = () => {
    for (const l of Object.values(os.networkInterfaces() || {}))
      for (const i of l || []) if (i.family === 'IPv4' && !i.internal) return i.address;
    return '127.0.0.1';
  };

  function render() {
    const W = Math.max(80, Math.min(process.stdout.columns || 120, 200));
    const H = Math.max(24, process.stdout.rows || 40);
    const s = S.server;
    const up = Math.round((Date.now() - S.started) / 1000);
    const hhmmss = `${String(Math.floor(up / 3600)).padStart(2, '0')}:` +
      `${String(Math.floor(up / 60) % 60).padStart(2, '0')}:${String(up % 60).padStart(2, '0')}`;
    S.connHist.push(s.conns);
    if (S.connHist.length > 200) S.connHist.shift();

    const L = [];
    const left = `\x1b[48;5;22m${C.green} SERVER ${C.rst} ${C.gray}port${C.rst} ${C.white}${PORTS[0]}${C.rst} ` +
      `${C.gray}pid${C.rst} ${C.white}${process.pid}${C.rst} ${C.gray}node${C.rst} ${C.white}${process.version}${C.rst} ` +
      `${C.gray}uptime${C.rst} ${C.white}${hhmmss}${C.rst}`;
    const right = `${C.gray}heap${C.rst} ${C.white}${s.heapMB} MB${C.rst}  ` +
      `${C.gray}evt loop lag${C.rst} ${heat(s.lagMs, 20, 100)}${s.lagMs} ms${C.rst}`;
    L.push(' ' + left + padS(right, Math.max(1, W - vw(left) - 3)));
    L.push('');

    const wide = W >= 110;
    const wL = wide ? Math.floor(W * 0.36) : W - 2;
    const wR = wide ? W - wL - 3 : W - 2;
    const perConn = S.baseRSS != null && s.conns ? ((s.rssMB - S.baseRSS) * 1024) / s.conns : null;
    const live = [...S.clients.values()].filter((c) => Date.now() - c.lastSeen < 5000);

    const cc = [
      '',
      `  ${C.cyan}${C.bold}${num(s.conns)}${C.rst}    ${C.white}${num(s.total)}${C.rst}`,
      `  ${C.gray}currently connected   total since start${C.rst}`,
      '',
      '  ' + C.blue + spark(S.connHist, wL - 6) + C.rst,
      `  ${C.gray}60 s window${C.rst}${padS(`${C.gray}peak ${num(S.peak)}${C.rst}`, wL - 17)}`,
      '',
      `  ${C.gray}accept rate${C.rst}${padS(`${C.green}+${S.accept} /s${C.rst}`, wL - 16)}`,
      `  ${C.gray}closed${C.rst}${padS(`${C.white}${num(s.closed)}${C.rst}`, wL - 11)}`,
      `  ${C.gray}dropped${C.rst}${padS(`${s.dropped ? C.red : C.white}${num(s.dropped)}${C.rst}`, wL - 12)}`,
      `  ${C.gray}reconnects${C.rst}${padS(`${C.white}${num(s.reconnects)}${C.rst}`, wL - 15)}`,
      `  ${C.gray}memory${C.rst}${padS(`${C.white}${num(s.rssMB)} MB${C.rst}${perConn ? `${C.gray} ${perConn.toFixed(1)}K/c${C.rst}` : ''}`, wL - 11)}`,
    ];
    if (live.length) {
      cc.push('', `  ${C.gray}client boxes${C.rst}`);
      for (const c of live.slice(0, 3)) {
        cc.push(`  ${C.white}${cut(c.label, 12)}${C.rst}` +
          padS(`${C.gray}${num(c.conns)} conns · p99 ${c.p99}ms${C.rst}`, wL - 16));
      }
    }

    const ps = [''];
    ps.push(`  ${C.gray}${padE('publisher', 15)}${padE('topic', 16)}${padS('subs', 6)}` +
      `${padS('fanout/s', 10)}${padS('queue', 7)}${padS('last publish', 15)}${C.rst}`);
    const rows = [...S.topics.entries()].sort((a, b) => (s.subs[b[0]] || 0) - (s.subs[a[0]] || 0));
    const shown = S.expandPubSub ? rows : rows.slice(0, 6);
    for (const [topic, t] of shown) {
      const ago = t.last ? Date.now() - t.last : null;
      const agoS = ago == null ? '-' : ago < 1000 ? `${ago} ms ago` : `${(ago / 1000).toFixed(1)} s ago`;
      ps.push(`  ${C.mag}${padE(cut(t.pub, 14), 15)}${C.rst}${C.cyan}${padE(cut(topic, 15), 16)}${C.rst}` +
        padS(`${C.white}${num(s.subs[topic] || 0)}${C.rst}`, 6) +
        padS(`${C.green}${num(t.rate)}${C.rst}`, 10) +
        padS(`${t.queue ? C.yellow : C.gray}${t.queue}${C.rst}`, 7) +
        padS(`${C.gray}${agoS}${C.rst}`, 15));
    }
    if (rows.length > shown.length) {
      ps.push(`  ${C.dark}└${C.rst} ${C.gray}${rows.length - shown.length} more · ${C.white}p${C.gray} to expand${C.rst}`);
    }

    const top = wide
      ? hstack([box('CONNECTED CLIENTS', wL, cc), box('PUB / SUB RELATIONSHIPS', wR, ps)], [wL, wR])
      : [...box('CONNECTED CLIENTS', wL, cc), ...box('PUB / SUB RELATIONSHIPS', wR, ps)];
    L.push(...top.map((l) => ' ' + l));

    // ---- stream panel
    const rowsAvail = Math.max(4, H - L.length - 8);
    const FIELDSETS = [
      ['time', 'seq', 'client', 'event', 'channel', 'bytes', 'lat', 'last-event-id', 'payload'],
      ['time', 'event', 'channel', 'payload'],
      ['time', 'seq', 'client', 'event', 'channel', 'bytes', 'lat', 'last-event-id'],
    ];
    const F = FIELDSETS[S.fields % FIELDSETS.length];
    const has = (f) => F.includes(f);
    const stream = [];
    const fieldsLine = `  ${C.gray}fields ${C.white}${F.join(' ')}${C.gray} · ${C.white}f${C.gray} to toggle${C.rst}`;
    stream.push(fieldsLine + padS(`${C.gray}filter ${S.filter ? C.yellow + S.filter : C.gray + 'none'}${C.rst} ` +
      (S.paused ? `\x1b[48;5;58m${C.yellow} PAUSED ${C.rst}` : `\x1b[48;5;22m${C.green} LIVE ${C.rst}`),
      Math.max(1, W - 6 - vw(fieldsLine))));
    if (S.showHeaders) {
      stream.push('  ' + C.gray +
        (has('time') ? padE('time', 13) : '') + (has('seq') ? padE('seq', 7) : '') +
        (has('client') ? padE('client', 9) : '') + (has('event') ? padE('event', 12) : '') +
        (has('channel') ? padE('channel', 15) : '') + (has('bytes') ? padS('bytes', 7) + ' ' : '') +
        (has('lat') ? padS('lat', 6) + ' ' : '') + (has('last-event-id') ? padE('last-event-id', 15) : '') +
        (has('payload') ? 'payload' : '') + C.rst);
    }
    let feed = S.stream;
    if (S.filter) {
      const f = S.filter.toLowerCase();
      feed = feed.filter((e) => (e.channel + e.event + e.payload + e.client).toLowerCase().includes(f));
    }
    const end = Math.max(0, feed.length - S.scroll);
    for (const e of feed.slice(Math.max(0, end - rowsAvail), end)) {
      const d = e.t;
      const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:` +
        `${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
      let line = '  ';
      if (has('time')) line += C.gray + padE(ts, 13) + C.rst;
      if (has('seq')) line += C.gray + padE('#' + String(e.seq).padStart(4, '0'), 7) + C.rst;
      if (has('client')) line += C.cyan + padE(e.client, 9) + C.rst;
      if (has('event')) line += padE(badge(e.event), 12);
      if (has('channel')) line += C.blue + padE(cut(e.channel, 14), 15) + C.rst;
      if (has('bytes')) line += C.white + padS(e.bytes >= 1024 ? (e.bytes / 1024).toFixed(1) + 'K' : e.bytes + 'B', 7) + ' ' + C.rst;
      if (has('lat')) line += heat(e.lat, 250, 1000) + padS(e.lat.toFixed(0) + 'ms', 6) + ' ' + C.rst;
      if (has('last-event-id')) line += C.gray + padE(e.id, 15) + C.rst;
      if (has('payload')) line += C.white + cut(e.payload, Math.max(8, W - vw(line) - 6)) + C.rst;
      stream.push(line);
    }
    while (stream.length < rowsAvail + 2) stream.push('');
    stream.push(`  ${C.gray}${S.paused ? '⏸ paused' : '▼ tailing'} · ${num(S.stream.length)} buffered · ` +
      `${num(S.evtRate)} evt/s published${C.rst}` + (S.scroll ? `${C.yellow}  ↑ ${S.scroll} back${C.rst}` : ''));
    L.push(...box('SSE STREAM', W - 2, stream).map((l) => ' ' + l));

    const key = (k, d) => `${C.white}${k}${C.rst} ${C.gray}${d}${C.rst}`;
    L.push(' ' + [key('q', 'quit'), key('␣', 'pause'), key('f', 'fields'), key('p', 'pub/sub'),
      key('h', 'headers'), key('/', 'filter'), key('↑↓', 'scroll'), key('r', 'reset'),
      key('+/-', `rate ${S.rateMul}x`)].join('  '));
    if (S.filterMode) {
      L.push(` ${C.yellow}filter:${C.rst} ${S.filter}${C.yellow}▌${C.rst}  ${C.gray}enter apply · esc clear${C.rst}`);
    }
    process.stdout.write(C.home + L.map((l) => l + C.clrLine).join('\n') + '\n' + C.clrDown);
  }

  /* ----------------------------------------------------------------- input */
  function bindKeys() {
    if (!process.stdin.isTTY) return;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (k) => {
      if (S.filterMode) {
        if (k === '\r' || k === '\n') S.filterMode = false;
        else if (k === '\x1b') { S.filter = ''; S.filterMode = false; }
        else if (k === '\x7f') S.filter = S.filter.slice(0, -1);
        else if (k >= ' ' && k <= '~') S.filter += k;
        return;
      }
      if (k === 'q' || k === '\u0003') return quit();
      else if (k === ' ') S.paused = !S.paused;
      else if (k === 'f') S.fields++;
      else if (k === 'p') S.expandPubSub = !S.expandPubSub;
      else if (k === 'h') S.showHeaders = !S.showHeaders;
      else if (k === '/') { S.filterMode = true; S.filter = ''; }
      else if (k === '\x1b[A') { S.paused = true; S.scroll += 1; }
      else if (k === '\x1b[B') S.scroll = Math.max(0, S.scroll - 1);
      else if (k === '\x1b[5~') { S.paused = true; S.scroll += 10; }
      else if (k === '\x1b[6~') S.scroll = Math.max(0, S.scroll - 10);
      else if (k === 'r') { S.stream.length = 0; S.scroll = 0; S.connHist.length = 0;
                            stats.closed = stats.dropped = stats.reconnects = 0; logLine('counters reset'); }
      else if (k === '+' || k === '=') { S.rateMul = Math.min(64, S.rateMul * 2); armPublishers(); }
      else if (k === '-' || k === '_') { S.rateMul = Math.max(0.125, S.rateMul / 2); armPublishers(); }
    });
  }
  function quit() {
    if (!PLAIN) process.stdout.write(C.show + C.unalt);
    const s = S.server;
    console.log(`\npeak connections ${num(S.peak)} · closed ${num(s.closed)} · dropped ${num(s.dropped)} · ` +
      `reconnects ${num(s.reconnects)}`);
    console.log(`server RSS ${num(s.rssMB)} MB` +
      (S.baseRSS != null && S.peak ? ` (~${(((s.rssMB - S.baseRSS) * 1024) / S.peak).toFixed(1)} KB/conn)` : ''));
    process.exit(0);
  }

  const start = (fn) => {
    emit = fn;
    armPublishers();
    setInterval(() => {
      for (const t of S.topics.values()) { t.rate = t.sent; t.sent = 0; }
      S.accept = Math.max(0, S.server.total - S.lastTotal);
      S.lastTotal = S.server.total;
      S.evtRate = S.evtCount; S.evtCount = 0;
    }, 1000).unref();

    if (PLAIN) {
      logLine(`listening ${HOST}:${PORTS.join(',')} · clients: node client.js --host ${localIP()}`);
      setInterval(() => {
        const s = S.server;
        console.log(`conns=${s.conns} accept=${S.accept}/s closed=${s.closed} dropped=${s.dropped} ` +
          `reconn=${s.reconnects} cpu=${s.cpuPct}% lag=${s.lagMs}ms rss=${s.rssMB}MB`);
      }, 2000).unref();
      return;
    }
    process.stdout.write(C.alt + C.hide);
    bindKeys();
    setInterval(render, 250).unref();
    process.on('exit', () => process.stdout.write(C.show + C.unalt));
    process.on('SIGINT', quit);
  };

  return { start, logLine, ingestReport, setServer, publishRaw };
}
