/* -------------------------------------------------------------------- store
 * Per-app bounded storage. Memory is capped by construction: every structure
 * here has a fixed size chosen at startup, so a misbehaving app cannot grow
 * the collector's heap. That property is the whole reason this is a ring
 * buffer and not an array with a periodic prune.
 *
 * Two tiers:
 *   - raw ring    : the last N events verbatim, for the live tail + trace joins
 *   - rollups     : per-topic counters aggregated on a fixed cadence, which is
 *                   what the topology view and all the rate math read from
 */

import { domainOf } from './schema.js';

/** Fixed-capacity circular buffer. Overwrites oldest on push. */
export class Ring {
  constructor(capacity) {
    this.cap = capacity;
    this.buf = new Array(capacity);
    this.head = 0;      // next write slot
    this.size = 0;
    this.evicted = 0;   // lifetime count of overwritten entries — surfaced in self-metrics
  }
  push(v) {
    if (this.size === this.cap) this.evicted++;
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.cap;
    if (this.size < this.cap) this.size++;
  }
  /** Oldest-first iteration. */
  *[Symbol.iterator]() {
    const start = (this.head - this.size + this.cap) % this.cap;
    for (let i = 0; i < this.size; i++) yield this.buf[(start + i) % this.cap];
  }
  /** Most recent `n`, oldest-first. */
  tail(n) {
    const out = [];
    const take = Math.min(n, this.size);
    const start = (this.head - take + this.cap) % this.cap;
    for (let i = 0; i < take; i++) out.push(this.buf[(start + i) % this.cap]);
    return out;
  }
  toArray() { return this.tail(this.size); }
  /** Oldest entry without removing it — used to know what a push is about to
   *  overwrite. Distinct from tail(1), which is the *newest*. */
  peekOldest() {
    if (!this.size) return undefined;
    return this.buf[(this.head - this.size + this.cap) % this.cap];
  }
}

/**
 * Streaming percentile estimator over a fixed log-ish bucket set.
 * Chosen over keeping raw samples because it is O(1) memory per topic and the
 * operator only ever reads p50/p95/p99 — exact values buy nothing here.
 */
export class Histogram {
  constructor() { this.buckets = new Map(); this.count = 0; this.sum = 0; this.max = 0; }
  add(ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    // bucket by 1/4 powers of 2 — ~19% granularity, plenty for latency triage
    const b = ms < 1 ? 0 : Math.round(Math.log2(ms) * 4);
    this.buckets.set(b, (this.buckets.get(b) || 0) + 1);
    this.count++; this.sum += ms;
    if (ms > this.max) this.max = ms;
  }
  percentile(p) {
    if (!this.count) return null;
    const target = this.count * p;
    let seen = 0;
    for (const b of [...this.buckets.keys()].sort((x, y) => x - y)) {
      seen += this.buckets.get(b);
      if (seen >= target) return b === 0 ? 1 : Math.pow(2, b / 4);
    }
    return this.max;
  }
  get mean() { return this.count ? this.sum / this.count : null; }
  snapshot() {
    return {
      count: this.count, mean: this.mean, max: this.max,
      p50: this.percentile(0.5), p95: this.percentile(0.95), p99: this.percentile(0.99),
    };
  }
}

/** Fixed-length rolling window of per-tick counts, for rate + sparklines. */
export class RateWindow {
  constructor(slots = 120) {
    this.slots = new Array(slots).fill(0);
    this.i = 0;
    /* Slots actually elapsed, capped at length. Without this the first minute
     * of every window divides by the FULL window and under-reports by up to
     * 120x — so a freshly started collector, or a topic that just appeared,
     * shows a rate far below the truth precisely when someone is watching it
     * most closely. */
    this.filled = 1;
  }
  bump(n = 1) { this.slots[this.i] += n; }
  /** Advance one tick. Called by the aggregator, not by the writer. */
  roll() {
    this.i = (this.i + 1) % this.slots.length;
    this.slots[this.i] = 0;
    if (this.filled < this.slots.length) this.filled++;
  }
  /** Events per second, given the tick interval in ms. Excludes the in-progress slot. */
  rate(tickMs) {
    const total = this.slots.reduce((a, b) => a + b, 0) - this.slots[this.i];
    const elapsed = Math.max(1, this.filled - 1);   // completed slots only
    const span = (elapsed * tickMs) / 1000;
    return span > 0 ? total / span : 0;
  }
  series() {
    // oldest-first, excluding the in-progress slot so the sparkline never dips
    // at the head. Only the elapsed portion, so a new topic draws a short line
    // rather than a long stretch of fake zeros.
    const out = [];
    const n = this.filled;
    for (let k = this.slots.length - n + 1; k < this.slots.length; k++) {
      out.push(this.slots[(this.i + k) % this.slots.length]);
    }
    return out;
  }
}

/** Everything the collector knows about one app. */
class AppState {
  constructor(app, opts) {
    this.app = app;
    this.firstSeen = opts.now;
    this.lastSeen = opts.now;
    this.instances = new Map();               // instance -> { lastSeen, stats, attrib }
    this.events = new Ring(opts.maxEvents);   // raw tail
    this.traces = new Map();                  // traceId -> event[]  (bounded, see below)
    this.traceOrder = new Ring(opts.maxTraces); // traceIds oldest-first, for eviction
    this.counters = { total: 0, byKind: new Map(), byDomain: new Map(), unknownKinds: new Map() };
    this.ingestRate = new RateWindow();
  }
}

export class Store {
  constructor({
    maxEventsPerApp = 20_000,
    maxTracesPerApp = 2_000,
    maxApps = 64,
    tickMs = 500,
  } = {}) {
    this.opts = { maxEventsPerApp, maxTracesPerApp, maxApps, tickMs };
    this.apps = new Map();
    this.dropped = { unknownApp: 0, appCap: 0 };
    this.tickMs = tickMs;
  }

  app(name, now = Date.now()) {
    let a = this.apps.get(name);
    if (!a) {
      if (this.apps.size >= this.opts.maxApps) { this.dropped.appCap++; return null; }
      a = new AppState(name, {
        now, maxEvents: this.opts.maxEventsPerApp, maxTraces: this.opts.maxTracesPerApp,
      });
      this.apps.set(name, a);
    }
    return a;
  }

  /** Ingest one validated event. Returns the AppState it landed in, or null if shed. */
  add(ev) {
    const a = this.app(ev.app, ev.ts);
    if (!a) return null;
    a.lastSeen = ev.ts;
    a.events.push(ev);
    a.ingestRate.bump();
    a.counters.total++;

    const d = domainOf(ev.kind);
    a.counters.byKind.set(ev.kind, (a.counters.byKind.get(ev.kind) || 0) + 1);
    a.counters.byDomain.set(d, (a.counters.byDomain.get(d) || 0) + 1);
    if (!ev.known) a.counters.unknownKinds.set(ev.kind, (a.counters.unknownKinds.get(ev.kind) || 0) + 1);

    let inst = a.instances.get(ev.instance);
    if (!inst) { inst = { instance: ev.instance, lastSeen: ev.ts, stats: null, attrib: null }; a.instances.set(ev.instance, inst); }
    inst.lastSeen = ev.ts;
    if (ev.kind === 'proc.stats') inst.stats = ev;
    if (ev.kind === 'proc.attrib') inst.attrib = ev;

    if (ev.traceId) this.#joinTrace(a, ev);
    return a;
  }

  /* Trace joins are what make Kafka fanout answerable: one traceId accumulates
   * consume -> publish -> deliver -> frame. Bounded by evicting whole traces
   * oldest-first, so a trace is always either complete-as-far-as-it-got or
   * entirely absent — never half-evicted, which would read as a phantom drop. */
  #joinTrace(a, ev) {
    let t = a.traces.get(ev.traceId);
    if (!t) {
      t = [];
      a.traces.set(ev.traceId, t);
      const evictedId = a.traceOrder.size === a.traceOrder.cap
        ? a.traceOrder.peekOldest() : null;
      a.traceOrder.push(ev.traceId);
      if (evictedId && evictedId !== ev.traceId) a.traces.delete(evictedId);
    }
    t.push(ev);
  }

  /** Advance all rate windows. Driven by one interval in main.js. */
  tick() {
    for (const a of this.apps.values()) a.ingestRate.roll();
  }

  list() { return [...this.apps.values()]; }

  selfMetrics() {
    let events = 0, traces = 0, evicted = 0;
    for (const a of this.apps.values()) {
      events += a.events.size; traces += a.traces.size; evicted += a.events.evicted;
    }
    return { apps: this.apps.size, events, traces, evicted, dropped: { ...this.dropped } };
  }
}
