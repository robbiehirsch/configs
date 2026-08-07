#!/usr/bin/env node
'use strict';
/* =============================================================================
 * client.js — SSE client + load generator.  Zero deps, Node 18+.
 *
 *   node client.js --host bench.local --port 8080                  # 1 conn
 *   node client.js --host bench.local --port 8080 --conns 50000    # load
 *
 * The observed connection is always a real, fully-parsed SSE stream: named
 * events, `id:` tracking, `retry:` hints, and reconnect that resumes via the
 * Last-Event-ID header. With --conns > 1 the rest are lightweight load sockets
 * on worker threads, and this box checks in with the server every second so the
 * server dashboard shows every teammate's machine.
 *
 * CLOCK SKEW: latency is measured against the server's clock via an NTP-style
 * probe of /time. Without it, cross-machine numbers are just clock disagreement.
 *
 * EPHEMERAL PORTS: one client IP -> one server IP:port caps near 28k-64k. That
 * is a 4-tuple limit, not a server limit. Spread with --ports, and on Linux
 * --local-addrs 127.0.0.2-127.0.0.50 (all of 127/8 is loopback, free).
 *
 * RAISE YOUR FD LIMIT FIRST:  ulimit -n 200000
 *
 * KEYS  q quit · space pause tail · f fields · s subscriptions · h headers
 *       / filter · r reconnect now
 * ===========================================================================*/

const http = require('http');
const net = require('net');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const HIST_MAX = 2000;   // one bucket per ms; slower samples land in overflow

/* ====================================================== load-gen thread entry */
if (!isMainThread && workerData && workerData.role === 'loadgen') {
  runLoadWorker(workerData);
  return;
}

/* ==================================================================== args */
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
/** "127.0.0.2-127.0.0.50,10.0.0.5" -> flat list. */
const expandAddrs = (spec) => {
  const out = [];
  for (const part of String(spec).split(',')) {
    const m = part.match(/^(\d+\.\d+\.\d+\.)(\d+)-(?:\1)?(\d+)$/);
    if (m) for (let i = +m[2]; i <= +m[3]; i++) out.push(m[1] + i);
    else out.push(part.trim());
  }
  return out;
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`client.js --host <ip> [--port 8080 | --ports 8080-8083] [--conns N]
          [--rate 5000] [--threads N] [--topics a,b] [--label name]
          [--duration sec] [--local-addrs 127.0.0.2-127.0.0.50]
          [--no-report] [--plain] [--timeout 30000] [--drop-ms 5000]
          [--no-reconnect] [--retry-ms 3000]`);
  process.exit(0);
}
const HOST = args.host || '127.0.0.1';
const PORTS = expandPorts(args.ports || args.port || '8080');
const CONNS = +(args.conns || 1);
const RATE = +(args.rate || 5000);
const THREADS = CONNS <= 1 ? 0 : Math.max(1, +(args.threads || Math.min(os.cpus().length, 8)));
const DURATION = +(args.duration || 0);
const LOCAL = args['local-addrs'] ? expandAddrs(args['local-addrs']) : [null];
const LABEL = args.label || `${os.hostname()}`.split('.')[0];
const REPORT = args['no-report'] !== 'true';
const PLAIN = args.plain === 'true' || !process.stdout.isTTY;
const WANT_TOPICS = args.topics ? args.topics.split(',').map((s) => s.trim()) : null;
// Read timeout must exceed the server heartbeat (15s) or every quiet period
// looks like a dead connection.
const TIMEOUT_MS = +(args.timeout || 30000);
const DROP_MS = +(args['drop-ms'] || 5000);
// Load sockets rebuild themselves after a server-side kill, so the pool holds
// its target count and you can watch the reconnect storm. --no-reconnect to
// leave them down instead.
const RECONNECT = args['no-reconnect'] !== 'true';
const RETRY_MS = +(args['retry-ms'] || 3000);

/* ============================================================== tiny ui kit */
const C = {
  rst: '\x1b[0m', bold: '\x1b[1m',
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
const BARC = { message: C.blue, delta: C.green, heartbeat: C.gray,
               snapshot: C.mag, error: C.red, reconnect: C.yellow };
const PROTO_BG = '\x1b[48;5;54m\x1b[38;5;189m';   // violet — protocol, not payload
const C_PROTO = '\x1b[38;5;141m';
const ITAL = '\x1b[3m';
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
function hstack(panels, widths, gap = 1) {
  const h = Math.max(...panels.map((p) => p.length));
  const out = [];
  for (let i = 0; i < h; i++) out.push(panels.map((p, j) => padE(p[i] ?? '', widths[j])).join(' '.repeat(gap)));
  return out;
}
function percentile(hist, total, p) {
  if (!total) return 0;
  let acc = 0, target = Math.ceil(total * p);
  for (let i = 0; i <= HIST_MAX; i++) { acc += hist[i]; if (acc >= target) return i; }
  return HIST_MAX;
}

/* ===========================================================================
 * CLOCK OFFSET — NTP style: keep the sample with the smallest round trip and
 * assume symmetric delay. Least-wrong assumption available without real NTP.
 * ===========================================================================*/
function measureOffset(cb, samples = 7) {
  let best = null, done = 0;
  const one = () => {
    const t0 = Date.now();
    const req = http.get({ host: HOST, port: PORTS[0], path: '/time', timeout: 2000 }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        const t1 = Date.now(), rtt = t1 - t0;
        try {
          const st = JSON.parse(b).t;
          if (!best || rtt < best.rtt) best = { rtt, offset: st + rtt / 2 - t1 };
        } catch {}
        next();
      });
    });
    req.on('error', next);
    req.on('timeout', () => { req.destroy(); next(); });
  };
  const next = () => (++done >= samples ? cb(best || { rtt: 0, offset: 0 }) : setTimeout(one, 30));
  one();
}

/* ===========================================================================
 *                                  STATE
 * ===========================================================================*/
const S = {
  state: 'connecting', url: '', pid: process.pid, started: Date.now(),
  connectedAt: null, lastEventId: null, retryMs: 3000, reconnects: 0, resumed: 0,
  headers: {}, lastFrame: {}, events: [], byType: new Map(), channels: new Map(),
  subs: new Set(), knownChannels: [], errors: [], total: 0, bytes: 0,
  rateHist: [], evtRate: 0, evtCount: 0, peakRate: 0, avgRate: 0,
  hist: new Int32Array(HIST_MAX + 1), cum: new Int32Array(HIST_MAX + 1),
  minLat: null, maxLat: 0, offset: { offset: 0, rtt: 0 },
  paused: false, fields: 0, showHeaders: true, filter: '', filterMode: false,
  protoMode: 'on', explain: true, replayRun: 0,
  lastData: Date.now(), offlineUntil: 0, timeouts: 0, stalled: false, replayed: 0,
  subCursor: 0, focus: 'tail',
  load: { conns: 0, opening: 0, msgs: 0, errs: {}, errTotal: 0, p50: 0, p95: 0, p99: 0, max: 0 },
};

const record = (ms) => {
  // Must round: the clock offset is fractional and a TypedArray silently
  // ignores fractional indices — hist[0.5]++ is a no-op, so sub-ms samples
  // would vanish from the histogram while still counting as messages.
  ms = Math.round(ms);
  if (ms < 0) ms = 0;
  if (S.minLat == null || ms < S.minLat) S.minLat = ms;
  if (ms > S.maxLat) S.maxLat = ms;
  S.hist[Math.min(ms, HIST_MAX)]++;
  S.cum[Math.min(ms, HIST_MAX)]++;
};
/** Push a protocol row into the same stream as messages, styled differently. */
const proto = (sub, text, note) => {
  if (S.paused) return;
  S.events.push({ t: new Date(), kind: 'proto', sub, text, note });
  if (S.events.length > 800) S.events.shift();
};
const logErr = (kind, text, color) => {
  S.errors.unshift({ t: new Date(), kind, text, color });
  if (S.errors.length > 40) S.errors.pop();
};

/* ===========================================================================
 *                        OBSERVED CONNECTION (real SSE)
 * ===========================================================================*/
let sock = null, reconnectTimer = null;

function connect(isReconnect) {
  clearTimeout(reconnectTimer);
  S.state = isReconnect ? 'reconnecting' : 'connecting';
  const port = PORTS[0];
  S.url = `http://${HOST}:${port}/events`;
  const topics = S.subs.size ? [...S.subs].join(',') : (WANT_TOPICS ? WANT_TOPICS.join(',') : '');
  const path = `/events${topics ? `?topics=${encodeURIComponent(topics)}` : ''}`;

  const s = net.connect({ host: HOST, port });
  sock = s;
  s.setNoDelay(true);
  let head = '', inBody = false, buf = '';

  s.on('connect', () => {
    S.state = 'open';
    S.connectedAt = Date.now();
    S.lastData = Date.now();
    // Last-Event-ID is what makes a reconnect a resume instead of a gap.
    s.write(`GET ${path} HTTP/1.1\r\nHost: ${HOST}\r\nAccept: text/event-stream\r\n` +
      `Connection: keep-alive\r\n` +
      (S.lastEventId ? `Last-Event-ID: ${S.lastEventId}\r\n` : '') + `\r\n`);
    proto('http-request', `GET ${path}  accept: text/event-stream` +
      (S.lastEventId ? `  Last-Event-ID: ${S.lastEventId}` : ''),
      S.lastEventId
        ? 'sending the last id we saw asks the server to backfill the gap, not restart the stream'
        : 'a single GET held open — no polling, no websocket upgrade, plain HTTP');
    if (isReconnect) {
      S.reconnects++;
      if (S.lastEventId) { S.resumed++; logErr('reconnect', `reconnect ${S.reconnects} · id ${S.lastEventId}`, C.yellow); }
      else logErr('reconnect', `reconnect ${S.reconnects} · no id, cold start`, C.yellow);
    }
  });

  s.on('data', (d) => {
    if (S.stalled) return;          // simulated stall: pretend the bytes never arrived
    S.lastData = Date.now();
    S.bytes += d.length;
    let str = d.toString('utf8');
    if (!inBody) {
      head += str;
      const i = head.indexOf('\r\n\r\n');
      if (i === -1) return;
      const raw = head.slice(0, i);
      str = head.slice(i + 4);
      inBody = true;
      S.headers = {};
      raw.split('\r\n').slice(1).forEach((line) => {
        const j = line.indexOf(':');
        if (j > 0) S.headers[line.slice(0, j).toLowerCase().trim()] = line.slice(j + 1).trim();
      });
      S.headers.__status = raw.split('\r\n')[0];
      proto('http-response', `${S.headers.__status}  ${S.headers['content-type'] || ''}` +
        `  ${S.headers['transfer-encoding'] ? 'transfer-encoding: chunked' : ''}`,
        'headers arrive immediately, then the body streams forever — this is one response, not many');
    }
    buf += str;
    // Chunked transfer: strip the size lines, then split on blank lines.
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      handleBlock(block);
    }
  });
  s.on('error', (e) => logErr('error', `${e.code || e.message}`, C.red));
  s.on('close', () => {
    if (S.state === 'closing') return;
    S.state = 'closed';
    logErr('error', 'connection closed by peer', C.red);
    proto('close', 'stream ended (FIN from server)',
      'a clean close is detected instantly — unlike a silent network partition, which needs a timeout');
    scheduleReconnect();
  });
}

function handleBlock(block) {
  let event = 'message', data = null, id = null, channel = null;
  for (let line of block.split('\n')) {
    line = line.replace(/^[0-9a-fA-F]+\r?$/, '').replace(/\r$/, '');   // chunk size lines
    if (!line) continue;
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('id: ')) id = line.slice(4).trim();
    else if (line.startsWith('channel: ')) channel = line.slice(9).trim();
    else if (line.startsWith('data: ')) data = line.slice(6);
    else if (line.startsWith('retry: ')) {
      S.retryMs = +line.slice(7).trim() || S.retryMs;
      proto('retry', `retry: ${S.retryMs}`,
        'the server dictates our reconnect delay; EventSource honours this automatically');
    }
    else if (line.startsWith(':')) {
      proto('comment', line.slice(0, 40),
        'a comment frame — carries no event, just keeps the socket and any proxy alive');
    }
  }
  if (data == null) return;
  if (id) {
    if (!S.lastEventId) proto('id', `id: ${id}`,
      'every frame carries an id; we store the latest and send it back as Last-Event-ID after a drop');
    S.lastEventId = id;
  }

  let lat = null, isReplay = false;
  try {
    const o = JSON.parse(data);
    if (o.ts) {
      lat = Math.round(Date.now() + S.offset.offset - o.ts);
      // An event published before this socket opened was replayed from the
      // server's buffer. Its age is the outage length, not transport latency —
      // recording it would put every post-outage percentile in the overflow
      // bucket and make p99 meaningless.
      isReplay = S.connectedAt != null && o.ts < S.connectedAt + S.offset.offset;
      if (isReplay) {
        S.replayed++;
        if (S.replayRun === 0) proto('resume', `replaying events published before this socket opened`,
          'these are backfilled from the server buffer — their age is the outage, not network latency');
        S.replayRun++;
      } else {
        if (S.replayRun > 0) {
          proto('resume-end', `caught up after ${S.replayRun} replayed event(s)`,
            'gap closed — the stream is live again with no events lost');
          S.replayRun = 0;
        }
        record(lat);
      }
    }
  } catch {}
  if (!channel) channel = '-';

  S.total++; S.evtCount++;
  S.byType.set(event, (S.byType.get(event) || 0) + 1);
  S.channels.set(channel, (S.channels.get(channel) || 0) + 1);
  S.lastFrame = { id, event, retry: S.retryMs };
  if (!S.paused) {
    S.events.push({ t: new Date(), seq: S.total, event, channel, bytes: Buffer.byteLength(data),
                    lat, id, data, replay: isReplay });
    if (S.events.length > 800) S.events.shift();
  }
}

/** Reconnect, unless we are inside a simulated outage window. */
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const wait = Math.max(S.retryMs, S.offlineUntil - Date.now());
  reconnectTimer = setTimeout(() => connect(true), wait);
}

/** Fire the read-timeout path — same code a real stalled link would hit. */
function readTimeout(simulated) {
  S.timeouts++;
  S.state = 'timeout';
  logErr('error', `read timeout after ${Math.round((Date.now() - S.lastData) / 1000)}s` +
    (simulated ? ' (simulated)' : ''), C.red);
  S.stalled = false;
  proto('timeout', `no data for ${(TIMEOUT_MS / 1000).toFixed(0)}s`,
    'silence is indistinguishable from a healthy idle stream — only a read timeout catches it');
  try { sock?.destroy(); } catch {}
  scheduleReconnect();
}

/** Drop the observed connection for ms, then resume via Last-Event-ID. */
function dropConnection(ms, why) {
  S.offlineUntil = Date.now() + ms;
  logErr('error', `${why} · offline ${(ms / 1000).toFixed(1)}s`, C.yellow);
  S.state = 'closing';
  try { sock?.destroy(); } catch {}
  S.state = 'offline';
  scheduleReconnect();
}

setInterval(() => {
  if (S.state === 'open' && Date.now() - S.lastData > TIMEOUT_MS) readTimeout(false);
}, 1000).unref();

/* ===========================================================================
 *                          LOAD THREADS (--conns > 1)
 * ===========================================================================*/
const threads = [];
const live = [];
function startLoad() {
  for (let i = 0; i < THREADS; i++) {
    const share = Math.floor((CONNS - 1) / THREADS) + (i < (CONNS - 1) % THREADS ? 1 : 0);
    const w = new Worker(__filename, {
      workerData: { role: 'loadgen', id: i, host: HOST, ports: PORTS, conns: share,
                    topics: WANT_TOPICS ? WANT_TOPICS.join(',') : '', rate: Math.ceil(RATE / THREADS),
                    local: LOCAL, offset: S.offset.offset, label: LABEL,
                    reconnect: RECONNECT, retryMs: RETRY_MS },
    });
    w.on('message', (m) => { live[i] = m; });
    w.on('error', (e) => logErr('error', `thread ${i}: ${e.message}`, C.red));
    threads.push(w);
  }
}
function collectLoad() {
  const h = new Int32Array(HIST_MAX + 1);
  let conns = 0, opening = 0, msgs = 0, max = 0, errTotal = 0, poolReconnects = 0;
  const errs = {};
  for (const s of live) {
    if (!s) continue;
    conns += s.connected; opening += s.opening; msgs += s.msgs;
    poolReconnects += s.reconnects || 0;
    max = Math.max(max, s.max);
    for (const k in s.errs) { errs[k] = (errs[k] || 0) + s.errs[k]; errTotal += s.errs[k]; }
    for (let i = 0; i <= HIST_MAX; i++) { h[i] += s.hist[i]; S.cum[i] += s.hist[i]; }
  }
  const total = h.reduce((a, b) => a + b, 0);
  // load.max resets every interval; keep a running peak so the summary's max
  // is consistent with percentiles (which pool observed + load samples).
  if (max > S.maxLat) S.maxLat = max;
  S.load = { conns, opening, msgs, errs, errTotal, max, poolReconnects, hist: h, total,
             p50: percentile(h, total, 0.5), p95: percentile(h, total, 0.95),
             p99: percentile(h, total, 0.99) };
}

/* ===========================================================================
 *                                 DASHBOARD
 * ===========================================================================*/
function render() {
  const W = Math.max(80, Math.min(process.stdout.columns || 120, 220));
  const H = Math.max(24, process.stdout.rows || 40);
  const up = Math.round((Date.now() - S.started) / 1000);
  const el = `${String(Math.floor(up / 3600)).padStart(2, '0')}:` +
    `${String(Math.floor(up / 60) % 60).padStart(2, '0')}:${String(up % 60).padStart(2, '0')}`;
  const dot = S.state === 'open' ? `${C.green}●` : S.state === 'closed' ? `${C.red}○` : `${C.yellow}◐`;

  const L = [];
  const left = `\x1b[48;5;24m${C.white} CLIENT ${C.rst} ${dot} ${C.white}${S.state}${C.rst} ` +
    `${C.gray}${S.url}${C.rst} ${C.dark}${S.headers.__status ? 'HTTP/1.1 keep-alive' : ''}${C.rst}`;
  const right = `${C.gray}pid${C.rst} ${C.white}${S.pid}${C.rst} ${C.gray}elapsed${C.rst} ${C.white}${el}${C.rst}`;
  L.push(' ' + left + padS(right, Math.max(1, W - vw(left) - 3)));
  L.push('');

  // ---- top row: connection | throughput | events by type
  const three = W >= 150, two = W >= 108;
  const w1 = three ? Math.floor(W * 0.30) : two ? Math.floor(W * 0.45) : W - 2;
  const w2 = three ? Math.floor(W * 0.36) : two ? W - w1 - 3 : W - 2;
  const w3 = three ? W - w1 - w2 - 4 : W - 2;

  const conn = ['',
    `  ${C.gray}state${C.rst}${padS(`${S.state === 'open' ? C.green : S.state === 'timeout' || S.state === 'closed' ? C.red : C.yellow}${S.state}${C.rst}${C.gray} · ${S.connectedAt ? Math.round((Date.now() - S.connectedAt) / 1000) + 's' : '-'}${C.rst}`, w1 - 10)}`,
    `  ${C.gray}last-event-id${C.rst}${padS(`${C.cyan}${S.lastEventId || '-'}${C.rst}`, w1 - 18)}`,
    `  ${C.gray}reconnects${C.rst}${padS(`${C.white}${S.reconnects}${C.rst}${S.resumed ? `${C.gray} (${S.resumed} resumed)${C.rst}` : ''}`, w1 - 15)}`,
    `  ${C.gray}retry hint${C.rst}${padS(`${C.white}${S.retryMs} ms${C.rst}`, w1 - 15)}`,
    `  ${C.gray}events received${C.rst}${padS(`${C.cyan}${num(S.total)}${C.rst}` +
      (S.replayed ? `${C.mag} +${num(S.replayed)} replayed${C.rst}` : ''), w1 - 20)}`,
    '', `  ${C.dark}${'─'.repeat(Math.max(0, w1 - 4))}${C.rst}`, ''];
  if (CONNS > 1) {
    conn.push(`  ${C.gray}concurrency${C.rst}${padS(`${C.white}${num(S.load.conns + 1)} / ${num(CONNS)}${C.rst}`, w1 - 16)}`);
    conn.push(`  ${C.gray}opening${C.rst}${padS(`${S.load.opening ? C.yellow : C.white}${num(S.load.opening)}${C.rst}`, w1 - 12)}`);
    conn.push(`  ${C.gray}ramp${C.rst}${padS(`${C.white}${num(RATE)} conns / s${C.rst}`, w1 - 9)}`);
    conn.push(`  ${C.gray}threads${C.rst}${padS(`${C.white}${THREADS}${C.rst}`, w1 - 12)}`);
    conn.push(`  ${C.gray}conn errors${C.rst}${padS(`${S.load.errTotal ? C.red : C.white}${num(S.load.errTotal)}${C.rst}`, w1 - 16)}`);
  conn.push(`  ${C.gray}pool reconnects${C.rst}${padS(`${C.white}${num(S.load.poolReconnects || 0)}${C.rst}`, w1 - 20)}`);
  } else {
    conn.push(`  ${C.gray}mode${C.rst}${padS(`${C.white}single connection${C.rst}`, w1 - 9)}`);
    conn.push(`  ${C.gray}payload avg${C.rst}${padS(`${C.white}${S.total ? Math.round(S.bytes / S.total) : 0} B${C.rst}`, w1 - 16)}`);
  }
  const offLeft = S.offlineUntil > Date.now() ? ((S.offlineUntil - Date.now()) / 1000).toFixed(1) : null;
  conn.push(`  ${C.gray}read timeout${C.rst}${padS(`${C.white}${(TIMEOUT_MS / 1000).toFixed(0)} s${C.rst}` +
    (S.timeouts ? `${C.red} ${S.timeouts} hit${C.rst}` : ''), w1 - 17)}`);
  if (offLeft) conn.push(`  ${C.yellow}offline${C.rst}${padS(`${C.yellow}${offLeft}s remaining${C.rst}`, w1 - 12)}`);
  conn.push(`  ${C.gray}clock offset${C.rst}${padS(`${C.white}${S.offset.offset >= 0 ? '+' : ''}${S.offset.offset.toFixed(0)} ms${C.rst}${C.gray} rtt ${S.offset.rtt}${C.rst}`, w1 - 17)}`);

  const totalH = S.cum.reduce((a, b) => a + b, 0);
  const thr = ['',
    `  ${C.cyan}${C.bold}${num(S.evtRate)}${C.rst} ${C.gray}evt/s · avg ${num(S.avgRate)} · peak ${num(S.peakRate)}${C.rst}`,
    '', '  ' + C.blue + spark(S.rateHist, w2 - 6) + C.rst,
    `  ${C.gray}-60 s${C.rst}`, '',
    `  ${C.gray}${padE('p50', 8)}${padE('p95', 8)}${padE('p99', 8)}${padE('min', 8)}${padE('max', 8)}${C.rst}`,
    `  ${heat(percentile(S.cum, totalH, 0.5), 250, 1000)}${padE(percentile(S.cum, totalH, 0.5) + ' ms', 8)}${C.rst}` +
    `${heat(percentile(S.cum, totalH, 0.95), 250, 1000)}${padE(percentile(S.cum, totalH, 0.95) + ' ms', 8)}${C.rst}` +
    `${heat(percentile(S.cum, totalH, 0.99), 250, 1000)}${padE(percentile(S.cum, totalH, 0.99) + ' ms', 8)}${C.rst}` +
    `${C.white}${padE((S.minLat ?? 0) + ' ms', 8)}${C.rst}` +
    `${heat(S.maxLat, 250, 1000)}${padE(S.maxLat + ' ms', 8)}${C.rst}`];
  if (CONNS > 1) {
    thr.push('', `  ${C.gray}load sockets p50 ${S.load.p50} · p95 ${S.load.p95} · p99 ${S.load.p99} ms` +
      ` · ${num(S.load.msgs)} evt/s${C.rst}`);
  }

  const types = [...S.byType.entries()].sort((a, b) => b[1] - a[1]);
  const maxT = Math.max(...types.map((t) => t[1]), 1);
  const ebt = [''];
  for (const [t, n] of types) {
    const bw = Math.max(0, Math.round((n / maxT) * (w3 - 26)));
    ebt.push(`  ${padE(badge(t), 12)}${padS(`${C.white}${num(n)}${C.rst}`, 8)}  ${BARC[t] || C.blue}${'█'.repeat(bw)}${C.rst}`);
  }
  if (!types.length) ebt.push(`  ${C.gray}waiting for events…${C.rst}`);
  ebt.push('', `  ${C.gray}${num(S.total)} total · ${S.errors.filter((e) => e.kind === 'error').length} errors${C.rst}`);

  const topPanels = three
    ? hstack([box('CONNECTION', w1, conn), box('THROUGHPUT & LATENCY', w2, thr), box('EVENTS BY TYPE', w3, ebt)], [w1, w2, w3])
    : two
    ? [...hstack([box('CONNECTION', w1, conn), box('THROUGHPUT & LATENCY', w2, thr)], [w1, w2]),
       ...box('EVENTS BY TYPE', w3, ebt)]
    : [...box('CONNECTION', w1, conn), ...box('THROUGHPUT & LATENCY', w2, thr)];
  L.push(...topPanels.map((l) => ' ' + l));

  // ---- bottom: received events | headers + subscriptions + errors
  const sideW = three ? Math.floor(W * 0.32) : 0;
  const tailW = three ? W - sideW - 3 : W - 2;
  const bodyRows = Math.max(6, H - L.length - 6);

  const FIELDSETS = [
    ['time', 'seq', 'event', 'channel', 'bytes', 'lat', 'last-event-id', 'data'],
    ['time', 'event', 'data'],
    ['time', 'seq', 'event', 'channel', 'bytes', 'lat', 'last-event-id'],
  ];
  const F = FIELDSETS[S.fields % FIELDSETS.length];
  const has = (f) => F.includes(f);
  const tail = [];
  const fl = `  ${C.gray}fields ${C.white}${F.join(' ')}${C.gray} · ${C.white}f${C.rst}`;
  tail.push(fl + padS(S.paused ? `\x1b[48;5;58m${C.yellow} PAUSED ${C.rst}` : `\x1b[48;5;22m${C.green} TAILING ${C.rst}`,
    Math.max(1, tailW - 4 - vw(fl))));
  tail.push(`  ${C.blue}▸${C.gray} pub/sub message   ${C_PROTO}⟩${C.gray} SSE protocol   ` +
    `${C.white}P${C.gray} protocol ${S.protoMode === 'only' ? C.yellow + 'ONLY' + C.gray : S.protoMode}   ` +
    `${C.white}e${C.gray} explanations ${S.explain ? 'on' : 'off'}${C.rst}`);
  if (S.showHeaders) {
    tail.push('  ' + C.gray + (has('time') ? padE('time', 13) : '') + (has('seq') ? padE('seq', 7) : '') +
      (has('event') ? padE('event', 12) : '') + (has('channel') ? padE('channel', 15) : '') +
      (has('bytes') ? padS('bytes', 7) + ' ' : '') + (has('lat') ? padS('lat', 6) + ' ' : '') +
      (has('last-event-id') ? padE('last-event-id', 15) : '') + (has('data') ? 'data' : '') + C.rst);
  }
  let feed = S.events;
  // 'only' isolates the protocol conversation — message volume buries it otherwise.
  if (S.protoMode === 'off') feed = feed.filter((e) => e.kind !== 'proto');
  else if (S.protoMode === 'only') feed = feed.filter((e) => e.kind === 'proto');
  if (S.filter) {
    const f = S.filter.toLowerCase();
    feed = feed.filter((e) => (e.kind === 'proto' ? `${e.sub} ${e.text} ${e.note}`
      : `${e.event}${e.channel}${e.data}`).toLowerCase().includes(f));
  }
  // Protocol rows can be two lines each, so slice generously and trim the
  // rendered lines afterwards rather than trusting an event count.
  const tailStart = tail.length;
  for (const e of feed.slice(-Math.max(3, bodyRows))) {
    const d = e.t;
    const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:` +
      `${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    if (e.kind === 'proto') {
      const pl = ` ${C_PROTO}⟩${C.rst} ${C.gray}${padE(ts, 13)}${C.rst}` +
        padE(`${PROTO_BG} ${e.sub} ${C.rst}`, 16) + `${C_PROTO}${cut(e.text, tailW - 38)}${C.rst}`;
      const room = tailW - vw(pl) - 8;
      if (S.explain && e.note && room > 26) tail.push(pl + `${C.dark}${ITAL}  — ${cut(e.note, room)}${C.rst}`);
      else if (S.explain && e.note) {
        tail.push(pl);
        tail.push(`   ${' '.repeat(14)}${C.dark}${ITAL}└ ${cut(e.note, tailW - 24)}${C.rst}`);
      } else tail.push(pl);
      continue;
    }
    let line = ` ${C.blue}▸${C.rst} `;
    if (has('time')) line += C.gray + padE(ts, 13) + C.rst;
    if (has('seq')) line += C.gray + padE('#' + String(e.seq).padStart(4, '0'), 7) + C.rst;
    if (has('event')) line += padE(badge(e.event), 12);
    if (has('channel')) line += C.blue + padE(cut(e.channel, 14), 15) + C.rst;
    if (has('bytes')) line += C.white + padS(e.bytes >= 1024 ? (e.bytes / 1024).toFixed(1) + 'K' : e.bytes + 'B', 7) + ' ' + C.rst;
    if (has('lat')) line += (e.replay ? C.mag + padS('replay', 6)
      : e.lat == null ? C.gray + padS('--', 6)
      : heat(e.lat, 250, 1000) + padS(e.lat + 'ms', 6)) + ' ' + C.rst;
    if (has('last-event-id')) line += C.gray + padE(e.id || '-', 15) + C.rst;
    if (has('data')) line += C.white + cut(e.data, Math.max(6, tailW - vw(line) - 5)) + C.rst;
    tail.push(line);
  }

  {
    const head = tail.slice(0, tailStart);
    const body = tail.slice(tailStart).slice(-Math.max(3, bodyRows - tailStart));
    tail.length = 0;
    tail.push(...head, ...body);
  }

  if (three) {
    const hdr = [''];
    hdr.push(`  ${C.white}${S.headers.__status || 'awaiting response'}${C.rst}`);
    for (const k of ['content-type', 'cache-control', 'connection', 'x-node-id']) {
      if (S.headers[k]) hdr.push(`  ${C.gray}${k}:${C.rst} ${C.white}${cut(S.headers[k], sideW - 20)}${C.rst}`);
    }
    hdr.push('', `  ${C.gray}last frame${C.rst}`,
      `  ${C.gray}id:${C.rst} ${C.cyan}${S.lastFrame.id || '-'}${C.rst}`,
      `  ${C.gray}event:${C.rst} ${C.white}${S.lastFrame.event || '-'}${C.rst}`,
      `  ${C.gray}retry:${C.rst} ${C.white}${S.retryMs}${C.rst}`);

    const chans = S.knownChannels.length ? S.knownChannels : [...S.channels.keys()];
    const sub = [''];
    chans.forEach((ch, i) => {
      const on = S.subs.size === 0 || S.subs.has(ch);
      const n = S.channels.get(ch) || 0;
      const cursor = i === S.subCursor ? `${C.yellow}›${C.rst}` : ' ';
      sub.push(`${cursor} ${on ? C.green + '[x]' : C.dark + '[ ]'}${C.rst} ` +
        `${on ? C.white : C.gray}${padE(cut(ch, 16), 17)}${C.rst}` +
        padS(`${C.gray}${n ? num(n) + ' evt' : '—'}${C.rst}`, sideW - 26));
    });
    if (!chans.length) sub.push(`  ${C.gray}discovering channels…${C.rst}`);
    sub.push('', `  ${C.gray}${C.white}space${C.gray} toggle · ${C.white}a${C.gray} all · ${C.white}↑↓${C.gray} move${C.rst}`);

    const err = [''];
    for (const e of S.errors.slice(0, 5)) {
      const ts = e.t.toTimeString().slice(0, 8);
      err.push(`  ${C.gray}${ts}${C.rst} ${e.color}${cut(e.text, sideW - 14)}${C.rst}`);
    }
    if (!S.errors.length) err.push(`  ${C.gray}none${C.rst}`);

    const side = [...box('EVENT HEADERS', sideW, hdr), ...box('SUBSCRIPTIONS', sideW, sub),
                  ...box('ERRORS & RECONNECTS', sideW, err)];
    const tailBox = box('RECEIVED EVENTS', tailW, padTo(tail, side.length - 2));
    L.push(...hstack([tailBox, side], [tailW, sideW]).map((l) => ' ' + l));
  } else {
    L.push(...box('RECEIVED EVENTS', tailW, tail).map((l) => ' ' + l));
  }

  const key = (k, d) => `${C.white}${k}${C.rst} ${C.gray}${d}${C.rst}`;
  L.push(' ' + [key('q', 'quit'), key('␣', 'pause tail'), key('f', 'fields'),
    key('s', 'subscriptions'), key('h', 'headers'), key('/', 'filter'),
    key('r', 'reconnect now'), key('x', `drop ${DROP_MS / 1000}s`),
    key('X', 'drop all'), key('t', 'timeout'), key('P', 'protocol'),
    key('e', 'explain')].join('  '));
  if (S.filterMode) L.push(` ${C.yellow}filter:${C.rst} ${S.filter}${C.yellow}▌${C.rst}  ${C.gray}enter apply · esc clear${C.rst}`);

  // Final guard: never emit more lines than the terminal has, or the frame
  // scrolls and the panel appears to grow downward forever.
  const out = L.slice(0, H - 1);
  process.stdout.write(C.home + out.map((l) => l + C.clrLine).join('\n') + '\n' + C.clrDown);
}
const padTo = (arr, n) => (arr.length >= n ? arr.slice(0, n) : arr.concat(Array(n - arr.length).fill('')));


/** stdin arrives in chunks — fast typing or a paste delivers several keys at
 *  once ("R3\r"). Split into individual keys, keeping escape sequences whole. */
function splitKeys(chunk) {
  const out = [];
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === '\x1b') {
      let j = i + 1;
      if (chunk[j] === '[' || chunk[j] === 'O') {
        j++;
        while (j < chunk.length && !/[A-Za-z~]/.test(chunk[j])) j++;
      }
      out.push(chunk.slice(i, j + 1));
      i = j;
    } else out.push(chunk[i]);
  }
  return out;
}

/* ===================================================================== keys */
function bindKeys() {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { for (const k of splitKeys(chunk)) handleKey(k); });
  function handleKey(k) {
    if (S.filterMode) {
      if (k === '\r' || k === '\n') S.filterMode = false;
      else if (k === '\x1b') { S.filter = ''; S.filterMode = false; }
      else if (k === '\x7f') S.filter = S.filter.slice(0, -1);
      else if (k >= ' ' && k <= '~') S.filter += k;
      return;
    }
    if (k === 'q' || k === '\u0003') return quit();
    else if (k === 'f') S.fields++;
    else if (k === 'h') S.showHeaders = !S.showHeaders;
    else if (k === '/') { S.filterMode = true; S.filter = ''; }
    else if (k === 's') S.focus = S.focus === 'subs' ? 'tail' : 'subs';
    else if (k === 'r') { S.offlineUntil = 0; S.state = 'closing'; sock?.destroy(); connect(true); }
    else if (k === 'x') dropConnection(DROP_MS, 'simulated network drop');
    else if (k === 'X') {
      dropConnection(DROP_MS, 'simulated drop (all sockets)');
      for (const w of threads) w.postMessage({ t: 'drop', ms: DROP_MS });
    }
    else if (k === 't') { S.stalled = true; readTimeout(true); }
    else if (k === 'P') S.protoMode = { on: 'only', only: 'off', off: 'on' }[S.protoMode];
    else if (k === 'e') S.explain = !S.explain;
    else if (k === '\x1b[A') S.subCursor = Math.max(0, S.subCursor - 1);
    else if (k === '\x1b[B') S.subCursor = Math.min(Math.max(0, channelList().length - 1), S.subCursor + 1);
    else if (k === 'a') { S.subs.clear(); resubscribe(); }
    else if (k === ' ') {
      if (S.focus === 'subs') {
        const chans = channelList();
        const ch = chans[S.subCursor];
        if (ch) {
          if (S.subs.size === 0) for (const c of chans) S.subs.add(c);   // start from all-on
          S.subs.has(ch) ? S.subs.delete(ch) : S.subs.add(ch);
          resubscribe();
        }
      } else S.paused = !S.paused;
    }
  }
}
const channelList = () => (S.knownChannels.length ? S.knownChannels : [...S.channels.keys()]);
function resubscribe() {
  logErr('reconnect', `resubscribe · ${S.subs.size || 'all'} channels`, C.yellow);
  S.state = 'closing';
  sock?.destroy();
  connect(true);
}
function quit() {
  if (!PLAIN) process.stdout.write(C.show + C.unalt);
  const total = S.cum.reduce((a, b) => a + b, 0);
  console.log(`\n--- ${LABEL} ------------------------------------------------`);
  console.log(`events received               ${num(S.total)}${CONNS > 1 ? ` (observed conn) · ${num(S.load.msgs)}/s across load sockets` : ''}`);
  if (CONNS > 1) console.log(`peak concurrent connections   ${num(S.load.conns + 1)} of ${num(CONNS)} requested`);
  console.log(`latency p50/p95/p99/max       ${percentile(S.cum, total, 0.5)} / ` +
    `${percentile(S.cum, total, 0.95)} / ${percentile(S.cum, total, 0.99)} / ${S.maxLat} ms  (clock-corrected)`);
  console.log(`reconnects / timeouts         ${S.reconnects} / ${S.timeouts} ` +
    `(${S.resumed} resumed, ${num(S.replayed)} events replayed — excluded from latency)`);
  if (S.load.errTotal) console.log(`conn errors                   ` +
    Object.entries(S.load.errs).map(([k, v]) => `${k}:${v}`).join(' '));
  for (const w of threads) w.terminate();
  process.exit(0);
}

/* ================================================================= reporting */
function reportToServer() {
  if (!REPORT) return;
  const sparse = [];
  const h = S.load.hist || S.hist;
  for (let i = 0; i <= HIST_MAX; i++) if (h[i]) sparse.push([i, h[i]]);
  const body = JSON.stringify({ label: LABEL, conns: S.load.conns + (S.state === 'open' ? 1 : 0),
    opening: S.load.opening, msgs: S.load.msgs + S.evtRate, errTotal: S.load.errTotal,
    p50: S.load.p50, p95: S.load.p95, p99: S.load.p99, max: S.load.max, hist: sparse });
  const req = http.request({ host: HOST, port: PORTS[0], method: 'POST', path: '/report',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => res.resume());
  req.on('error', () => {});
  req.end(body);
}

/* ============================================================== load worker */
function runLoadWorker(cfg) {
  const TS_KEY = '"ts":';
  const hist = new Int32Array(HIST_MAX + 1);
  let connected = 0, opening = 0, msgs = 0, max = 0, opened = 0;
  const errs = Object.create(null);

  let replayed = 0;
  const rec = (ms) => {
    ms = Math.round(ms);
    if (ms < 0) ms = 0;
    if (ms > max) max = ms;
    hist[Math.min(ms, HIST_MAX)]++;
    msgs++;
  };

  // Scan the raw stream for timestamps rather than parsing HTTP + JSON per
  // message. At 100k sockets, full parsing is what kills the generator first.
  function onData(buf) {
    const s = this;
    const str = (s._tail || '') + buf.toString('latin1');
    const now = Date.now() + cfg.offset;
    let idx = -1, curs = 0;
    for (;;) {
      idx = str.indexOf(TS_KEY, curs);
      if (idx === -1) break;
      let e = idx + TS_KEY.length;
      const start = e;
      while (e < str.length && str.charCodeAt(e) >= 48 && str.charCodeAt(e) <= 57) e++;
      if (e === str.length) break;               // number split across chunks
      const ts = Number(str.slice(start, e));
      // Same replay exclusion as the observed connection: anything published
      // before this socket opened is buffered history, not live latency.
      if (ts >= (s.__at || 0) + cfg.offset) rec(now - ts); else replayed++;
      curs = e;
    }
    s._tail = idx === -1 ? str.slice(-8) : str.slice(idx);
    if (s._tail.length > 64) s._tail = s._tail.slice(-64);
  }

  let draining = false, reconnects = 0;
  let rotor = 0;
  /** isRetry: rebuild an existing slot rather than adding to the ramp total. */
  const open = (isRetry) => {
    const port = cfg.ports[rotor % cfg.ports.length];
    const localAddress = cfg.local[rotor % cfg.local.length] || undefined;
    rotor++;
    if (!isRetry) opened++;
    opening++;
    const s = net.connect({ host: cfg.host, port, localAddress });
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
    s.setNoDelay(true);
    s.on('connect', () => {
      opening--; connected++;
      s.__at = Date.now();
      s.write(`GET /events${cfg.topics ? `?topics=${encodeURIComponent(cfg.topics)}` : ''} HTTP/1.1\r\n` +
        `Host: ${cfg.host}\r\nAccept: text/event-stream\r\nConnection: keep-alive\r\n\r\n`);
    });
    s.on('data', onData);
    s.on('error', (e) => { const c = e.code || 'ERR'; errs[c] = (errs[c] || 0) + 1; });
    s.on('close', () => {
      if (s.connecting) opening--; else connected--;
      if (draining || !cfg.reconnect) return;
      // Jitter the retry so the pool does not reconnect in perfect lockstep —
      // though the herd is exactly what you are trying to measure, so keep it tight.
      reconnects++;
      setTimeout(() => open(true), cfg.retryMs * (0.8 + Math.random() * 0.4));
    });
  };

  // Host-driven outage: drop every load socket, stay dark, then rebuild them.
  const sockets = new Set();
  parentPort.on('message', (m) => {
    if (m.t !== 'drop') return;
    const n = sockets.size;
    draining = true;                    // suppress auto-retry during the outage
    for (const s of sockets) { try { s.destroy(); } catch {} }
    sockets.clear();
    connected = 0; opening = 0;
    setTimeout(() => { draining = false; opened = 0; cfg.conns = n; armRamp(); }, m.ms);
  });

  // Ramp in slices — one burst just SYN-floods you into your own timeouts.
  const perTick = Math.max(1, Math.ceil(cfg.rate / 20));
  let ramp = null;
  const armRamp = () => {
    clearInterval(ramp);
    ramp = setInterval(() => {
      for (let i = 0; i < perTick && opened < cfg.conns; i++) open();
      if (opened >= cfg.conns) clearInterval(ramp);
    }, 50);
  };
  armRamp();

  setInterval(() => {
    parentPort.postMessage({ connected, opening, msgs, max, replayed, reconnects,
                             errs: { ...errs }, hist: Int32Array.from(hist) });
    hist.fill(0); msgs = 0; max = 0; replayed = 0;
    for (const k in errs) delete errs[k];
  }, 1000);
}

/* ================================================================== dispatch */
process.stdout.write(`probing clock offset against ${HOST}:${PORTS[0]}…\n`);
measureOffset((offset) => {
  S.offset = offset;
  // Learn the channel list up front so SUBSCRIPTIONS shows topics with no
  // traffic yet, instead of only ones that happen to have fired.
  const req = http.get({ host: HOST, port: PORTS[0], path: '/stats', timeout: 2000 }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => { try { S.knownChannels = JSON.parse(b).topics || []; } catch {} begin(); });
  });
  req.on('error', begin);
  req.on('timeout', () => { req.destroy(); begin(); });
});

let begun = false;
function begin() {
  if (begun) return;
  begun = true;
  connect(false);
  if (THREADS > 0) startLoad();

  let ticks = 0, rateSum = 0;
  setInterval(() => {
    ticks++;
    S.evtRate = S.evtCount; S.evtCount = 0;
    rateSum += S.evtRate;
    S.avgRate = rateSum / ticks;
    S.peakRate = Math.max(S.peakRate, S.evtRate);
    S.rateHist.push(S.evtRate);
    if (S.rateHist.length > 200) S.rateHist.shift();
    if (THREADS > 0) collectLoad();
    reportToServer();
    if (PLAIN) {
      console.log(`t=${ticks} state=${S.state} evt/s=${S.evtRate} conns=${S.load.conns + 1} ` +
        `opening=${S.load.opening} err=${S.load.errTotal} p50=${S.load.p50} p99=${S.load.p99} ` +
        `reconnects=${S.reconnects}`);
    }
    if (DURATION > 0 && ticks >= DURATION) quit();
  }, 1000);

  if (!PLAIN) {
    process.stdout.write(C.alt + C.hide);
    bindKeys();
    setInterval(render, 250).unref();
    process.on('exit', () => process.stdout.write(C.show + C.unalt));
  }
  process.on('SIGINT', quit);
}
