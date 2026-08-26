/* ------------------------------------------------------------------ SDK
 * Instrumentation client for pubsub-observer.
 *
 * FOUR HARD RULES. Every design choice below follows from them, and any
 * change that violates one is a bug regardless of what it buys:
 *
 *   1. NEVER THROW INTO THE HOST APP. Every public method is wrapped. A bug in
 *      telemetry must not become an incident in the thing being observed.
 *   2. NEVER BLOCK. All reporting is fire-and-forget onto an in-memory queue;
 *      nothing awaits the network on the request path.
 *   3. BOUNDED MEMORY. The queue is capped and drops oldest. An unreachable
 *      collector must not turn into an OOM in your app — the single most
 *      likely way a monitoring tool takes down production.
 *   4. DISABLED IS FREE. enabled:false makes every call an immediate return.
 */

import { shouldSample, ALWAYS_KEEP } from './sampling.js';

const DEFAULTS = {
  url: 'http://localhost:9099',
  app: 'unknown',
  instance: undefined,
  key: null,
  enabled: true,
  sampleRate: 1,
  flushMs: 500,
  maxBatch: 256,
  maxQueue: 10_000,
  maxBackoffMs: 30_000,
};

export function createObserver(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  cfg.instance = cfg.instance || `${cfg.app}-${process.pid}`;

  const q = [];
  let timer = null, failures = 0, sending = false;
  const stats = { queued: 0, sent: 0, dropped: 0, failed: 0 };

  const emit = (kind, fields) => {
    if (!cfg.enabled) return;
    try {
      if (cfg.sampleRate < 1 && !ALWAYS_KEEP.has(kind)
          && !shouldSample(kind, cfg.sampleRate, fields?.traceId)) return;
      if (q.length >= cfg.maxQueue) { q.shift(); stats.dropped++; }
      q.push({ ts: Date.now(), app: cfg.app, instance: cfg.instance, kind, ...fields });
      stats.queued++;
      if (q.length >= cfg.maxBatch) flush();
    } catch { /* rule 1 */ }
  };

  async function flush() {
    if (sending || !q.length || !cfg.enabled) return;
    sending = true;
    const batch = q.splice(0, cfg.maxBatch);
    try {
      const res = await fetch(`${cfg.url}/v1/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          ...(cfg.key ? { 'X-Observer-Key': cfg.key } : {}),
        },
        body: batch.map((e) => JSON.stringify(e)).join('\n'),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      stats.sent += batch.length;
      failures = 0;
    } catch {
      /* Dropped, not requeued. Requeuing a failed batch is how a brief
       * collector outage turns into an unbounded backlog that then stampedes
       * the collector on recovery — telemetry is not worth that risk. */
      stats.failed += batch.length;
      failures++;
    } finally {
      sending = false;
      schedule();
    }
  }

  /** Exponential backoff while the collector is unreachable. */
  function schedule() {
    if (timer || !cfg.enabled) return;
    const delay = failures
      ? Math.min(cfg.flushMs * 2 ** Math.min(failures, 8), cfg.maxBackoffMs)
      : cfg.flushMs;
    timer = setTimeout(() => { timer = null; flush(); }, delay);
    timer.unref?.();   // never hold the host process open
  }
  schedule();

  const api = {
    pubsub: {
      topic:   (f) => emit('pubsub.topic', f),
      sub:     (f) => emit('pubsub.sub', f),
      unsub:   (f) => emit('pubsub.unsub', f),
      publish: (f) => emit('pubsub.publish', f),
      deliver: (f) => emit('pubsub.deliver', f),
      drop:    (f) => emit('pubsub.drop', f),
    },
    kafka: {
      consume:   (f) => emit('kafka.consume', f),
      commit:    (f) => emit('kafka.commit', f),
      rebalance: (f) => emit('kafka.rebalance', f),
      error:     (f) => emit('kafka.error', f),
      /** Wrap a kafkajs-style consumer so consume/commit report themselves. */
      wrapConsumer(consumer, { group } = {}) {
        try {
          const orig = consumer.run?.bind(consumer);
          if (!orig) return consumer;
          consumer.run = (config = {}) => {
            const userHandler = config.eachMessage;
            if (!userHandler) return orig(config);
            return orig({
              ...config,
              eachMessage: async (payload) => {
                const { topic, partition, message } = payload;
                const traceId = message?.headers?.traceId?.toString?.()
                  || `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                emit('kafka.consume', {
                  topic, partition, offset: Number(message?.offset ?? -1),
                  group, traceId, bytes: message?.value?.length ?? 0,
                });
                // Hand the traceId to the app so it can propagate it onward —
                // without this the kafka -> topic edge can never be inferred.
                payload.observerTraceId = traceId;
                return userHandler(payload);
              },
            });
          };
        } catch { /* rule 1 */ }
        return consumer;
      },
    },
    sse: {
      open:   (f) => emit('sse.open', f),
      frame:  (f) => emit('sse.frame', f),
      resume: (f) => emit('sse.resume', f),
      stall:  (f) => emit('sse.stall', f),
      close:  (f) => emit('sse.close', f),
    },
    proc: {
      stats:  (f) => emit('proc.stats', f),
      attrib: (f) => emit('proc.attrib', f),
    },

    /**
     * Wrap an SSE ServerResponse so open/frame/close report themselves.
     * Returns the same response object — call it and keep writing normally.
     */
    instrumentSSE(res, { connId, topics = [], remote, ua } = {}) {
      if (!cfg.enabled) return res;
      try {
        const openedAt = Date.now();
        const id = connId || `c-${Math.random().toString(36).slice(2, 10)}`;
        emit('sse.open', { connId: id, topics, remote, ua });
        for (const t of topics) emit('pubsub.sub', { topic: t, subId: id, subscriberKind: 'sse' });

        const write = res.write.bind(res);
        res.write = (chunk, ...rest) => {
          const t0 = process.hrtime.bigint();
          const ok = write(chunk, ...rest);
          emit('sse.frame', {
            connId: id, bytes: chunk?.length ?? 0,
            writeNs: Number(process.hrtime.bigint() - t0),
          });
          // A false return means the socket buffer is full — the earliest
          // observable sign of a slow consumer, and worth reporting as such.
          if (!ok) emit('sse.stall', { connId: id, pendingBytes: res.writableLength ?? 0 });
          return ok;
        };
        const finish = (reason) => {
          emit('sse.close', { connId: id, reason, durationMs: Date.now() - openedAt });
          for (const t of topics) emit('pubsub.unsub', { topic: t, subId: id, reason });
        };
        res.once('close', () => finish('client-gone'));
        res.once('finish', () => finish('server-closed'));
        res.observerConnId = id;
      } catch { /* rule 1 */ }
      return res;
    },

    /** Report process health on an interval. Returns a stop function. */
    startProcessReporter({ intervalMs = 5000, conns = () => undefined } = {}) {
      if (!cfg.enabled) return () => {};
      let lastCpu = process.cpuUsage(), lastAt = Date.now();
      const t = setInterval(() => {
        try {
          const m = process.memoryUsage();
          const cpu = process.cpuUsage(lastCpu);
          const elapsedUs = (Date.now() - lastAt) * 1000;
          lastCpu = process.cpuUsage(); lastAt = Date.now();
          emit('proc.stats', {
            rssMB: +(m.rss / 1048576).toFixed(1),
            heapMB: +(m.heapUsed / 1048576).toFixed(1),
            cpuPct: elapsedUs ? +(((cpu.user + cpu.system) / elapsedUs) * 100).toFixed(1) : 0,
            conns: conns(),
          });
        } catch { /* rule 1 */ }
      }, intervalMs);
      t.unref?.();
      return () => clearInterval(t);
    },

    stats: () => ({ ...stats, queueDepth: q.length, failures }),
    flush,
    async close() {
      cfg.enabled = false;
      if (timer) { clearTimeout(timer); timer = null; }
      cfg.enabled = true; await flush(); cfg.enabled = false;
    },
  };
  return api;
}

export default createObserver;
