#!/usr/bin/env node
/* -------------------------------------------------------------------- main
 * Wires the collector together and owns the single timer that drives every
 * periodic behaviour. One interval, not several: the store's rate windows,
 * the topology sweep, and the dashboard broadcast must advance on the same
 * tick or the rates they report will disagree with each other.
 */

import { createServer } from 'node:http';
import { Store } from './model/store.js';
import { Topology } from './model/topology.js';
import { Ingest } from './ingest/server.js';
import { Api } from './api/http.js';

const env = (k, d) => process.env[k] ?? d;
const CONF = {
  port: +env('OBSERVER_PORT', 9099),
  /* Dual-stack by default. Binding 0.0.0.0 is IPv4-only, and Node 18+ fetch()
   * resolves "localhost" to ::1 FIRST — so an app configured with a localhost
   * collector URL would get ECONNREFUSED and, because a well-behaved SDK
   * swallows send errors, would fail completely silently. '::' accepts both. */
  host: env('OBSERVER_HOST', '::'),
  key: env('OBSERVER_KEY', null),
  tickMs: +env('OBSERVER_TICK_MS', 500),
  maxEventsPerApp: +env('OBSERVER_MAX_EVENTS_PER_APP', 20_000),
  maxTracesPerApp: +env('OBSERVER_MAX_TRACES_PER_APP', 2_000),
  maxApps: +env('OBSERVER_MAX_APPS', 64),
};

const startedAt = Date.now();
const store = new Store({ ...CONF, tickMs: CONF.tickMs });
const topology = new Topology({ tickMs: CONF.tickMs });
const ingest = new Ingest({ store, topology, key: CONF.key });
const api = new Api({ store, topology, ingest, startedAt });

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && url.pathname === '/v1/ingest') return ingest.handle(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return api.handle(req, res, url);
  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end('{"error":"method not allowed"}');
});

// Dashboards hold SSE connections open indefinitely; the defaults would reap them.
server.keepAliveTimeout = 0;
server.requestTimeout = 0;

setInterval(() => {
  const now = Date.now();
  store.tick();
  topology.sweep(now);
  api.broadcast({
    now,
    topology: topology.snapshot(now),
    apps: store.list().map((a) => ({
      app: a.app, lastSeen: a.lastSeen, events: a.counters.total,
      eventsPerSec: a.ingestRate.rate(CONF.tickMs),
      series: a.ingestRate.series(),
      instances: [...a.instances.values()],
    })),
    self: { queueDepth: ingest.queue.length, ingest: ingest.stats, store: store.selfMetrics() },
  });
}, CONF.tickMs).unref?.();

// Hosts with IPv6 disabled cannot bind '::' at all; fall back rather than die.
server.on('error', (e) => {
  if (e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL') {
    console.warn(`bind ${CONF.host} failed (${e.code}) — falling back to 0.0.0.0`);
    server.listen(CONF.port, '0.0.0.0');
    return;
  }
  console.error(`listen failed: ${e.code} ${e.message}`);
  process.exit(1);
});

server.listen(CONF.port, CONF.host, () => {
  console.log(`pubsub-observer listening on http://${CONF.host}:${CONF.port}`);
  console.log(`  ingest  POST /v1/ingest  ${CONF.key ? '(key required)' : '(open — set OBSERVER_KEY)'}`);
  console.log(`  ui      GET  /`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(); process.exit(0); });
}
