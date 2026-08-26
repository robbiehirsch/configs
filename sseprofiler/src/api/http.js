/* --------------------------------------------------------------------- api
 * Read-only query surface + the collector's own SSE stream. The UI is just
 * another consumer of these endpoints, which keeps the tool scriptable: you
 * can curl any view.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', 'ui', 'web');

const json = (res, obj, code = 200) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

export class Api {
  constructor({ store, topology, ingest, startedAt }) {
    Object.assign(this, { store, topology, ingest, startedAt });
    this.live = new Set();   // SSE subscribers to the collector's own stream
  }

  /** Push a snapshot to every connected dashboard. Called on the tick. */
  broadcast(payload) {
    if (!this.live.size) return;
    const frame = `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.live) {
      // Never let a slow dashboard back up into the collector.
      if (res.writableLength > 1 << 20) continue;
      res.write(frame);
    }
  }

  #appOr404(req, res, url) {
    const name = url.searchParams.get('app');
    if (!name) { json(res, { error: 'app query param required' }, 400); return null; }
    const a = this.store.apps.get(name);
    if (!a) { json(res, { error: `unknown app: ${name}` }, 404); return null; }
    return a;
  }

  handle(req, res, url) {
    const p = url.pathname;

    if (p === '/health') {
      return json(res, { ok: true, uptimeMs: Date.now() - this.startedAt });
    }

    if (p === '/v1/self') {
      return json(res, {
        uptimeMs: Date.now() - this.startedAt,
        ingest: this.ingest.stats,
        queueDepth: this.ingest.queue.length,
        store: this.store.selfMetrics(),
        rssMB: +(process.memoryUsage().rss / 1048576).toFixed(1),
        heapMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
        liveDashboards: this.live.size,
      });
    }

    if (p === '/v1/apps') {
      return json(res, {
        apps: this.store.list().map((a) => ({
          app: a.app, firstSeen: a.firstSeen, lastSeen: a.lastSeen,
          events: a.counters.total,
          eventsPerSec: a.ingestRate.rate(this.store.tickMs),
          instances: [...a.instances.values()].map((i) => ({
            instance: i.instance, lastSeen: i.lastSeen,
            stats: i.stats ?? null, attrib: i.attrib ?? null,
          })),
          byDomain: Object.fromEntries(a.counters.byDomain),
          unknownKinds: Object.fromEntries(a.counters.unknownKinds),
        })),
      });
    }

    if (p === '/v1/topology') {
      // Topology is currently global; per-app graphs land with tenant isolation.
      return json(res, this.topology.snapshot());
    }

    if (p === '/v1/events') {
      const a = this.#appOr404(req, res, url);
      if (!a) return;
      const n = Math.min(+(url.searchParams.get('n') || 200), 2000);
      const kind = url.searchParams.get('kind');
      /* Filter across the whole ring rather than over-fetching a slice: the
       * ring is bounded at startup, so a full scan is cheap and bounded, and
       * any over-fetch factor is wrong for selective kinds (a `kafka` filter
       * finds nothing in the last N events when pubsub traffic dominates). */
      const evs = kind
        ? a.events.toArray().filter((e) => e.kind.startsWith(kind)).slice(-n)
        : a.events.tail(n);
      return json(res, { app: a.app, events: evs });
    }

    if (p === '/v1/trace') {
      const a = this.#appOr404(req, res, url);
      if (!a) return;
      const id = url.searchParams.get('id');
      if (!id) return json(res, { error: 'id required' }, 400);
      const evs = a.traces.get(id);
      if (!evs) return json(res, { error: 'trace not found or evicted' }, 404);
      return json(res, { traceId: id, events: [...evs].sort((x, y) => x.ts - y.ts) });
    }

    if (p === '/v1/live') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      this.live.add(res);
      req.on('close', () => this.live.delete(res));
      return;
    }

    // static web UI
    if (p === '/' || p === '/index.html') return this.#static(res, 'index.html', 'text/html; charset=utf-8');
    if (p === '/app.js') return this.#static(res, 'app.js', 'text/javascript; charset=utf-8');
    if (p === '/app.css') return this.#static(res, 'app.css', 'text/css; charset=utf-8');

    return json(res, {
      error: 'not found',
      endpoints: ['POST /v1/ingest', 'GET /v1/apps', 'GET /v1/topology', 'GET /v1/events?app=',
                  'GET /v1/trace?app=&id=', 'GET /v1/live', 'GET /v1/self', 'GET /health'],
    }, 404);
  }

  #static(res, name, type) {
    try {
      const body = readFileSync(join(WEB, name));
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not built');
    }
  }
}
