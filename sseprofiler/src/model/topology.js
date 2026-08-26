/* ----------------------------------------------------------------- topology
 * The live graph of what is talking to what. This is the primary view.
 *
 * The graph is derived purely from the event stream — nothing here knows what
 * your topics mean, which broker you run, or what language produced the
 * events. Three node types and two edge types cover the whole model:
 *
 *     kafka:<topic>  --(traceId join)-->  topic:<name>  --(delivery)-->  sub:<id>
 *
 * The kafka->topic edge is the one that cannot be observed directly: no single
 * event says "this Kafka message caused a publish on that topic". It is
 * *inferred* by joining on traceId, which is why traceId propagation is the
 * one thing the SDK must get right.
 */

import { Histogram, RateWindow } from './store.js';

export const NODE = { KAFKA: 'kafka', TOPIC: 'topic', SUB: 'sub' };

/* Loss rate above which a topic is called out. Set high enough that ordinary
 * background loss does not paint the whole graph red — a signal every topic
 * trips is not a signal. Tune to your own steady-state loss once you have a
 * baseline; the right value is "clearly above normal for us". */
export const LOSS_NOTABLE = 0.05;

const nodeId = (type, name) => `${type}:${name}`;
const edgeId = (from, to) => `${from}->${to}`;

export class Topology {
  constructor({ tickMs = 500, silentAfterMs = 30_000 } = {}) {
    this.tickMs = tickMs;
    this.silentAfterMs = silentAfterMs;
    this.nodes = new Map();
    this.edges = new Map();
    /* traceId -> kafka node id. Bounded separately from the store's trace map
     * because we only need the *origin*, not the whole trace, to attribute a
     * publish back to its Kafka source. */
    this.traceOrigin = new Map();
    this.traceOriginMax = 10_000;
  }

  #node(type, name, ts) {
    const id = nodeId(type, name);
    let n = this.nodes.get(id);
    if (!n) {
      n = {
        id, type, name, firstSeen: ts, lastSeen: ts,
        in: 0, out: 0, bytes: 0,
        rate: new RateWindow(), meta: {},
      };
      this.nodes.set(id, n);
    }
    n.lastSeen = ts;
    return n;
  }

  #edge(fromId, toId, ts) {
    const id = edgeId(fromId, toId);
    let e = this.edges.get(id);
    if (!e) {
      e = {
        id, from: fromId, to: toId, firstSeen: ts, lastSeen: ts,
        count: 0, bytes: 0, drops: 0, dropsByReason: new Map(),
        latency: new Histogram(), rate: new RateWindow(),
        weight: 1,           // 0..1, maintained by decayEdge()
      };
      this.edges.set(id, e);
    }
    e.lastSeen = ts;
    return e;
  }

  #rememberOrigin(traceId, kafkaNodeId) {
    if (this.traceOrigin.size >= this.traceOriginMax) {
      // Map preserves insertion order, so the first key is the oldest.
      const oldest = this.traceOrigin.keys().next().value;
      this.traceOrigin.delete(oldest);
    }
    this.traceOrigin.set(traceId, kafkaNodeId);
  }

  /** Fold one validated event into the graph. */
  apply(ev) {
    const ts = ev.ts;
    switch (ev.kind) {
      case 'kafka.consume': {
        const n = this.#node(NODE.KAFKA, ev.topic, ts);
        n.out++; n.rate.bump(); n.bytes += ev.bytes || 0;
        n.meta.group = ev.group ?? n.meta.group;
        n.meta.lag = ev.lag ?? n.meta.lag;
        n.meta.partitions = n.meta.partitions || new Set();
        if (ev.partition !== undefined) n.meta.partitions.add(ev.partition);
        if (ev.traceId) this.#rememberOrigin(ev.traceId, n.id);
        break;
      }
      case 'pubsub.topic': {
        const n = this.#node(NODE.TOPIC, ev.topic, ts);
        n.meta.declaredBy = ev.declaredBy ?? n.meta.declaredBy;
        break;
      }
      case 'pubsub.publish': {
        const n = this.#node(NODE.TOPIC, ev.topic, ts);
        n.in++; n.rate.bump(); n.bytes += ev.bytes || 0;
        n.meta.publisher = ev.publisher ?? n.meta.publisher;
        // The inferred kafka -> topic edge.
        const origin = ev.traceId && this.traceOrigin.get(ev.traceId);
        if (origin) {
          const e = this.#edge(origin, n.id, ts);
          e.count++; e.bytes += ev.bytes || 0; e.rate.bump();
        }
        break;
      }
      case 'pubsub.sub': {
        const t = this.#node(NODE.TOPIC, ev.topic, ts);
        const s = this.#node(NODE.SUB, ev.subId, ts);
        s.meta.subscriberKind = ev.subscriberKind ?? s.meta.subscriberKind ?? 'internal';
        s.meta.active = true;
        this.#edge(t.id, s.id, ts);
        break;
      }
      case 'pubsub.unsub': {
        const s = this.nodes.get(nodeId(NODE.SUB, ev.subId));
        if (s) { s.meta.active = false; s.meta.unsubReason = ev.reason; }
        const e = this.edges.get(edgeId(nodeId(NODE.TOPIC, ev.topic), nodeId(NODE.SUB, ev.subId)));
        if (e) e.weight = 0;   // explicit teardown — decay policy need not wait it out
        break;
      }
      case 'pubsub.deliver': {
        const t = this.#node(NODE.TOPIC, ev.topic, ts);
        const s = this.#node(NODE.SUB, ev.subId, ts);
        t.out++;
        s.in++; s.rate.bump();
        const e = this.#edge(t.id, s.id, ts);
        e.count++; e.rate.bump();
        if (ev.latencyMs != null) e.latency.add(ev.latencyMs);
        break;
      }
      case 'pubsub.drop': {
        const t = this.#node(NODE.TOPIC, ev.topic, ts);
        const target = ev.subId ? this.#node(NODE.SUB, ev.subId, ts) : null;
        const e = target ? this.#edge(t.id, target.id, ts) : null;
        if (e) {
          e.drops++;
          e.dropsByReason.set(ev.reason, (e.dropsByReason.get(ev.reason) || 0) + 1);
        } else {
          t.meta.drops = (t.meta.drops || 0) + 1;
          t.meta.lastDropReason = ev.reason;
        }
        break;
      }
      case 'sse.open': {
        const s = this.#node(NODE.SUB, ev.connId, ts);
        s.meta.subscriberKind = 'sse';
        s.meta.active = true;
        s.meta.remote = ev.remote;
        s.meta.openedAt = ts;
        for (const topic of ev.topics || []) {
          this.#edge(nodeId(NODE.TOPIC, topic), s.id, ts);
          this.#node(NODE.TOPIC, topic, ts);
        }
        break;
      }
      case 'sse.resume': {
        const s2 = this.#node(NODE.SUB, ev.connId, ts);
        s2.meta.subscriberKind = 'sse';
        s2.meta.resume = ev.outcome;
        s2.meta.lastEventId = ev.lastEventId;
        break;
      }
      case 'sse.stall': {
        const s2 = this.#node(NODE.SUB, ev.connId, ts);
        s2.meta.subscriberKind = 'sse';
        s2.meta.stalls = (s2.meta.stalls || 0) + 1;
        s2.meta.pendingBytes = ev.pendingBytes;
        break;
      }
      case 'sse.frame': {
        const s = this.#node(NODE.SUB, ev.connId, ts);
        s.meta.subscriberKind = 'sse';
        s.meta.frames = (s.meta.frames || 0) + 1;
        s.bytes += ev.bytes || 0;
        break;
      }
      case 'sse.close': {
        const s = this.nodes.get(nodeId(NODE.SUB, ev.connId));
        if (s) { s.meta.active = false; s.meta.closeReason = ev.reason; s.meta.durationMs = ev.durationMs; }
        break;
      }
      default: break;   // unknown/irrelevant kinds are stored but not graphed
    }
  }

  /* ==========================================================================
   * TODO(robbie) — edge/node lifetime policy. See sweep() below.
   *
   * This decides when something that has gone quiet stops being drawn. It is a
   * genuine product judgment, not a technical one: it determines what an
   * operator sees on the graph at 3am, and the right answer depends on your
   * real topic rate distribution.
   *
   * Three approaches, roughly increasing in cost and fidelity:
   *
   *  (a) HARD TTL — `return now - e.lastSeen > TTL ? 'drop' : 'keep'`
   *      Simple and predictable. Risk: a genuinely low-rate topic (the
   *      prototype had audit.trail at 0.6 msg/s, notify.push at 0.4) sits near
   *      the threshold and flickers in and out of the graph, which reads as
   *      instability that isn't there. If you pick this, TTL must be well
   *      above the inter-arrival time of your slowest real topic.
   *
   *  (b) EXPONENTIAL DECAY — multiply e.weight by a factor each sweep, reset to
   *      1 on activity; render weight as opacity; drop below some epsilon.
   *      Costs a multiply per edge per tick, but "going quiet" becomes a
   *      visible state rather than a binary, and it self-scales to each edge's
   *      own rate. This is the one I would default to.
   *
   *  (c) NEVER DROP, ONLY DIM — full session history, unbounded growth. Fine
   *      for a fixed known topic set, dangerous if subIds are per-connection
   *      (they are — every SSE reconnect mints a new one), which is why SUB
   *      nodes probably need a different policy from TOPIC nodes.
   *
   * Note the asymmetry (c) exposes: topics are few and long-lived, SSE
   * subscriber nodes are many and ephemeral. A single policy for both is
   * probably wrong — consider branching on `type`.
   *
   * @param {object} e     edge or node, has .lastSeen and .weight
   * @param {number} now   ms
   * @param {string} type  'edge' | node type ('kafka'|'topic'|'sub')
   * @returns {'keep'|'drop'}
   */
  decayEdge(e, now, type) {
    // PLACEHOLDER: retains everything forever. Correct-but-unbounded — option
    // (c) above. Replace before running against production volumes.
    return 'keep';
  }

  /** Advance rate windows and apply the lifetime policy. Driven by main.js. */
  sweep(now = Date.now()) {
    for (const e of this.edges.values()) {
      e.rate.roll();
      if (this.decayEdge(e, now, 'edge') === 'drop') this.edges.delete(e.id);
    }
    for (const n of this.nodes.values()) {
      n.rate.roll();
      if (this.decayEdge(n, now, n.type) === 'drop') {
        this.nodes.delete(n.id);
        for (const e of this.edges.values()) {
          if (e.from === n.id || e.to === n.id) this.edges.delete(e.id);
        }
      }
    }
  }

  /* ------------------------------------------------------ derived signals --
   * These are the things the prototype could not answer at all, and they are
   * the actual reason to build this: not "here is a graph" but "here is what
   * is wrong with your graph". */
  signals(now = Date.now()) {
    const orphanTopics = [];      // published to, nobody listening
    const silentSubscribers = []; // subscribed, receiving nothing

    const outByNode = new Map();
    /* Loss is aggregated PER TOPIC, not per edge. A per-edge list is useless at
     * real scale — 4000 SSE connections each dropping one frame produces 4000
     * findings and zero insight. The operator's question is "which topic is
     * lossy", and the per-subscriber detail only matters once loss is
     * concentrated on a few subscribers rather than spread across all of them,
     * which `subsAffected` vs `subsTotal` answers directly. */
    const lossByTopic = new Map();
    for (const e of this.edges.values()) {
      if (!outByNode.has(e.from)) outByNode.set(e.from, []);
      outByNode.get(e.from).push(e);
      if (!e.from.startsWith('topic:') || !e.to.startsWith('sub:')) continue;
      const topic = e.from.slice(6);
      let L = lossByTopic.get(topic);
      if (!L) { L = { topic, drops: 0, delivered: 0, subsAffected: 0, subsTotal: 0, reasons: new Map() }; lossByTopic.set(topic, L); }
      L.subsTotal++;
      L.delivered += e.count;
      L.drops += e.drops;
      if (e.drops > 0) L.subsAffected++;
      for (const [r, n] of e.dropsByReason) L.reasons.set(r, (L.reasons.get(r) || 0) + n);
    }

    const lossyTopics = [];
    for (const L of lossByTopic.values()) {
      const total = L.delivered + L.drops;
      if (!L.drops || !total) continue;
      const ratio = L.drops / total;
      if (ratio < LOSS_NOTABLE) continue;
      lossyTopics.push({
        topic: L.topic, drops: L.drops, delivered: L.delivered, ratio,
        subsAffected: L.subsAffected, subsTotal: L.subsTotal,
        /* Concentrated loss (a few bad subscribers) and broad loss (the topic
         * itself is over capacity) have completely different fixes, so the
         * shape is reported, not just the rate. */
        shape: L.subsAffected / L.subsTotal < 0.25 ? 'concentrated' : 'broad',
        reasons: Object.fromEntries(L.reasons),
      });
    }
    lossyTopics.sort((a, b) => b.ratio - a.ratio);

    for (const n of this.nodes.values()) {
      if (n.type === NODE.TOPIC) {
        const outs = (outByNode.get(n.id) || []).filter((e) => e.weight > 0);
        if (n.in > 0 && outs.length === 0) {
          orphanTopics.push({ topic: n.name, published: n.in, since: n.firstSeen });
        }
      }
      if (n.type === NODE.SUB && n.meta.active && n.in === 0 && now - n.firstSeen > this.silentAfterMs) {
        silentSubscribers.push({
          subId: n.name, kind: n.meta.subscriberKind, quietMs: now - n.firstSeen,
        });
      }
    }

    /* Fanout amplification: one Kafka message in, how many deliveries out?
     * A number that quietly climbs is how a fanout blowup announces itself
     * before it shows up as CPU. */
    const amplification = [];
    for (const n of this.nodes.values()) {
      if (n.type !== NODE.KAFKA) continue;
      let delivered = 0;
      for (const e of outByNode.get(n.id) || []) {
        for (const e2 of outByNode.get(e.to) || []) delivered += e2.count;
      }
      if (n.out > 0) amplification.push({ kafkaTopic: n.name, consumed: n.out, delivered, factor: delivered / n.out });
    }

    return { orphanTopics, silentSubscribers, lossyTopics, amplification };
  }

  /** Serialisable snapshot for the web UI / API. */
  snapshot(now = Date.now()) {
    const tick = this.tickMs;
    return {
      now,
      nodes: [...this.nodes.values()].map((n) => ({
        id: n.id, type: n.type, name: n.name,
        in: n.in, out: n.out, bytes: n.bytes,
        rate: n.rate.rate(tick), series: n.rate.series(),
        lastSeen: n.lastSeen, firstSeen: n.firstSeen,
        meta: { ...n.meta, partitions: n.meta.partitions ? [...n.meta.partitions] : undefined },
      })),
      edges: [...this.edges.values()].map((e) => ({
        id: e.id, from: e.from, to: e.to,
        count: e.count, bytes: e.bytes, drops: e.drops,
        dropsByReason: Object.fromEntries(e.dropsByReason),
        rate: e.rate.rate(tick), latency: e.latency.snapshot(),
        weight: e.weight, lastSeen: e.lastSeen,
      })),
      signals: this.signals(now),
    };
  }
}
