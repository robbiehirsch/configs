#!/usr/bin/env node
/* -------------------------------------------------------------------- synth
 * Development fixture, descended from the prototype's PUBLISHERS table. It is
 * NOT part of the collector: it is an ordinary client that speaks the public
 * ingest protocol, exactly as a real instrumented app would.
 *
 * That distinction is the point. Because synth has no privileged access, if
 * the dashboard looks right against synth, the protocol is genuinely
 * sufficient — there is no back channel quietly making the demo work.
 *
 *   node tools/synth.js --url http://localhost:9099 --app checkout --conns 40
 */

import { randomUUID } from 'node:crypto';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i];
}
const URL_ = args.url || 'http://localhost:9099';
const APP = args.app || 'checkout';
const INSTANCE = args.instance || `synth-${process.pid}`;
const KEY = args.key || process.env.OBSERVER_KEY || null;
const CONNS = +(args.conns || 40);
const RATE_MUL = +(args.rate || 1);

/* The prototype's traffic model, preserved — realistic mixed rates and sizes,
 * including the two deliberately slow topics that make the edge-decay policy
 * question a real one. */
const PUBLISHERS = [
  { pub: 'svc-orders',    topic: 'orders.eu',    kafka: 'orders',    rate: 4,   bytes: 480, loss: 0.002 },
  { pub: 'svc-orders',    topic: 'orders.us',    kafka: 'orders',    rate: 3.5, bytes: 480, loss: 0.002 },
  { pub: 'svc-pricing',   topic: 'pricing.tick', kafka: 'marketdata',rate: 12,  bytes: 96,  loss: 0.001 },
  { pub: 'svc-inventory', topic: 'inv.delta',    kafka: 'inventory', rate: 1.5, bytes: 128, loss: 0.002 },
  { pub: 'svc-audit',     topic: 'audit.trail',  kafka: null,        rate: 0.6, bytes: 164, loss: 0.001 },
  /* Deliberately sick, and sick in a *specific* way: loss concentrated on a
   * few slow subscribers rather than spread evenly. A fixture where everything
   * is slightly broken teaches nothing — the anomaly has to stand out against
   * a quiet background, and it has to have a diagnosable shape. */
  { pub: 'svc-notify',    topic: 'notify.push',  kafka: null,        rate: 0.4, bytes: 512, loss: 0.35, lossConcentrated: true },
];

const TOPICS = PUBLISHERS.map((p) => p.topic);
let batch = [];
let seq = 0;
const offsets = new Map();

const emit = (kind, fields) => batch.push({ ts: Date.now(), app: APP, instance: INSTANCE, kind, ...fields });

async function flush() {
  if (!batch.length) return;
  const body = batch.map((e) => JSON.stringify(e)).join('\n');
  batch = [];
  try {
    await fetch(`${URL_}/v1/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson', ...(KEY ? { 'X-Observer-Key': KEY } : {}) },
      body,
    });
  } catch (e) {
    // A real SDK must behave exactly like this: an unreachable collector is
    // never the app's problem. Drop the batch, keep running.
    // --debug exists because that silence is correct in production and
    // maddening during setup: it is exactly how a misconfigured URL, a wrong
    // key, or an IPv4/IPv6 mismatch presents.
    if (args.debug) console.error('flush failed:', e.cause?.code || e.message);
  }
}

/* ---- simulated SSE connection pool ---- */
const conns = new Map();   // connId -> { topics, openedAt }
function openConn() {
  const id = `c-${randomUUID().slice(0, 8)}`;
  // each connection subscribes to a random 1-3 topics
  const n = 1 + Math.floor(Math.random() * 3);
  const topics = [...TOPICS].sort(() => Math.random() - 0.5).slice(0, n);
  // ~15% of connections are "slow consumers" — the population a concentrated
  // loss pattern falls on.
  conns.set(id, { topics, openedAt: Date.now(), slow: Math.random() < 0.15 });
  emit('sse.open', { connId: id, topics, remote: `10.0.${Math.floor(Math.random() * 5)}.${Math.floor(Math.random() * 254)}` });
  for (const t of topics) emit('pubsub.sub', { topic: t, subId: id, subscriberKind: 'sse' });
  return id;
}
function closeConn(id, reason) {
  const c = conns.get(id);
  if (!c) return;
  conns.delete(id);
  for (const t of c.topics) emit('pubsub.unsub', { topic: t, subId: id, reason });
  emit('sse.close', { connId: id, reason, durationMs: Date.now() - c.openedAt });
}

/* ---- publish one message and fan it out ---- */
function publish(p) {
  const msgId = `m-${++seq}`;
  const traceId = p.kafka ? `tr-${randomUUID().slice(0, 12)}` : undefined;

  if (p.kafka) {
    const off = (offsets.get(p.kafka) || 0) + 1;
    offsets.set(p.kafka, off);
    emit('kafka.consume', {
      topic: p.kafka, partition: seq % 3, offset: off, group: `${APP}-consumers`,
      lag: Math.floor(Math.random() * 40), msgId, traceId, bytes: p.bytes,
    });
  }

  emit('pubsub.publish', { topic: p.topic, msgId, bytes: p.bytes, traceId, publisher: p.pub });

  for (const [id, c] of conns) {
    if (!c.topics.includes(p.topic)) continue;
    /* Concentrated loss hits only the connections flagged slow at open time,
     * so the "concentrated vs broad" classifier has a real case to detect. */
    const lossRate = p.lossConcentrated ? (c.slow ? p.loss : 0) : p.loss;
    if (Math.random() < lossRate) {
      emit('pubsub.drop', { topic: p.topic, msgId, subId: id, traceId, reason: Math.random() < 0.5 ? 'slow' : 'backpressure' });
      continue;
    }
    emit('pubsub.deliver', { topic: p.topic, msgId, subId: id, traceId, latencyMs: +(0.5 + Math.random() * 12).toFixed(2) });
    emit('sse.frame', { connId: id, topic: p.topic, bytes: p.bytes, traceId, msgId, writeNs: Math.floor(2000 + Math.random() * 18000) });
  }
}

/* ---- wire it up ---- */
for (const p of PUBLISHERS) {
  emit('pubsub.topic', { topic: p.topic, declaredBy: p.pub });
  setInterval(() => publish(p), Math.max(20, 1000 / (p.rate * RATE_MUL)));
}
for (let i = 0; i < CONNS; i++) openConn();

// churn: connections come and go, which is what makes the SSE lifecycle view
// worth having and what stresses the sub-node lifetime policy
/* Churn holds the pool near CONNS instead of drifting: close when above
 * target, open when below, coin-flip at target. The previous version opened
 * more often than it closed and grew without bound. */
setInterval(() => {
  const over = conns.size - CONNS;
  const shouldClose = over > 0 ? true : over < 0 ? false : Math.random() < 0.5;
  if (shouldClose && conns.size) {
    closeConn([...conns.keys()][Math.floor(Math.random() * conns.size)],
      Math.random() < 0.3 ? 'client-gone' : 'idle-timeout');
  } else {
    const id = openConn();
    if (Math.random() < 0.4) emit('sse.resume', { connId: id, outcome: Math.random() < 0.8 ? 'ok' : 'miss', lastEventId: `e-${seq}` });
  }
}, 1500);

setInterval(() => {
  emit('proc.stats', {
    rssMB: +(180 + Math.random() * 60).toFixed(1), heapMB: +(90 + Math.random() * 30).toFixed(1),
    cpuPct: +(15 + Math.random() * 35).toFixed(1), lagMs: +(Math.random() * 8).toFixed(2), conns: conns.size,
  });
  emit('proc.attrib', {
    pubsubNs: Math.floor(1e6 + Math.random() * 5e5), sseNs: Math.floor(2e6 + Math.random() * 1e6),
    writes: seq,
  });
}, 1000);

setInterval(flush, 250);

console.log(`synth -> ${URL_}  app=${APP} instance=${INSTANCE} conns=${CONNS} topics=${TOPICS.length}`);
process.on('SIGINT', async () => { await flush(); process.exit(0); });
