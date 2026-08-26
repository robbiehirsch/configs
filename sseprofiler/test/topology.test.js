import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Topology, NODE, LOSS_NOTABLE } from '../src/model/topology.js';

const now = Date.now();
const ev = (kind, extra = {}) => ({ ts: now, app: 'a', instance: 'i', kind, known: true, ...extra });

function fanoutFixture() {
  const t = new Topology();
  // one kafka message -> 2 topics -> 2 subscribers each
  t.apply(ev('kafka.consume', { topic: 'orders', partition: 0, offset: 1, traceId: 'T1', group: 'g', lag: 5 }));
  t.apply(ev('pubsub.publish', { topic: 'orders.eu', msgId: 'm1', traceId: 'T1', bytes: 100 }));
  t.apply(ev('pubsub.publish', { topic: 'orders.us', msgId: 'm2', traceId: 'T1', bytes: 100 }));
  for (const [topic, subs] of [['orders.eu', ['c1', 'c2']], ['orders.us', ['c3', 'c4']]]) {
    for (const s of subs) {
      t.apply(ev('sse.open', { connId: s, topics: [topic] }));
      t.apply(ev('pubsub.deliver', { topic, msgId: 'm', subId: s, latencyMs: 3 }));
    }
  }
  return t;
}

test('infers the kafka -> topic edge from traceId alone', () => {
  const t = fanoutFixture();
  const ids = [...t.edges.keys()].filter((k) => k.startsWith('kafka:'));
  assert.deepEqual(ids.sort(), ['kafka:orders->topic:orders.eu', 'kafka:orders->topic:orders.us']);
});

test('does NOT invent a kafka edge when no traceId ties them together', () => {
  const t = new Topology();
  t.apply(ev('kafka.consume', { topic: 'orders', partition: 0, offset: 1, traceId: 'T1' }));
  t.apply(ev('pubsub.publish', { topic: 'orders.eu', msgId: 'm1' }));   // no traceId
  assert.equal([...t.edges.keys()].filter((k) => k.startsWith('kafka:')).length, 0);
});

test('computes fanout amplification per kafka topic', () => {
  const amp = fanoutFixture().signals(now).amplification;
  assert.equal(amp.length, 1);
  assert.equal(amp[0].kafkaTopic, 'orders');
  assert.equal(amp[0].consumed, 1);
  assert.equal(amp[0].delivered, 4);
  assert.equal(amp[0].factor, 4);
});

test('flags a topic published to with no subscribers', () => {
  const t = fanoutFixture();
  t.apply(ev('pubsub.publish', { topic: 'nobody.listening', msgId: 'x' }));
  const o = t.signals(now).orphanTopics;
  assert.deepEqual(o.map((x) => x.topic), ['nobody.listening']);
});

test('aggregates loss BY TOPIC, not per subscriber', () => {
  const t = fanoutFixture();
  // 4 drops on one subscriber of orders.eu (which has 1 delivery each on c1,c2)
  for (let i = 0; i < 4; i++) {
    t.apply(ev('pubsub.drop', { topic: 'orders.eu', subId: 'c1', reason: 'slow' }));
  }
  const lossy = t.signals(now).lossyTopics;
  assert.equal(lossy.length, 1, 'one finding per topic, not one per subscriber');
  assert.equal(lossy[0].topic, 'orders.eu');
  assert.equal(lossy[0].drops, 4);
  assert.equal(lossy[0].subsAffected, 1);
  assert.equal(lossy[0].subsTotal, 2);
  assert.deepEqual(lossy[0].reasons, { slow: 4 });
});

test('stays quiet below the notable-loss threshold so the signal means something', () => {
  const t = new Topology();
  t.apply(ev('sse.open', { connId: 'c1', topics: ['x'] }));
  for (let i = 0; i < 1000; i++) t.apply(ev('pubsub.deliver', { topic: 'x', msgId: `m${i}`, subId: 'c1' }));
  t.apply(ev('pubsub.drop', { topic: 'x', subId: 'c1', reason: 'slow' }));   // 0.1% loss
  assert.equal(t.signals(now).lossyTopics.length, 0);
  const need = Math.ceil((LOSS_NOTABLE * 1000) / (1 - LOSS_NOTABLE)) + 1;
  for (let i = 0; i < need; i++) t.apply(ev('pubsub.drop', { topic: 'x', subId: 'c1', reason: 'slow' }));
  assert.equal(t.signals(now).lossyTopics.length, 1);
});

test('distinguishes concentrated loss from broad loss', () => {
  // Each affected subscriber drops 60 of its 80 attempts, so total loss is
  // comfortably over LOSS_NOTABLE in BOTH cases — the test is isolating the
  // shape classifier, not re-testing the threshold.
  const mk = (affected, total) => {
    const t = new Topology();
    for (let i = 0; i < total; i++) {
      t.apply(ev('sse.open', { connId: `c${i}`, topics: ['x'] }));
      for (let d = 0; d < 20; d++) t.apply(ev('pubsub.deliver', { topic: 'x', msgId: `m${d}`, subId: `c${i}` }));
      if (i < affected) for (let d = 0; d < 60; d++) t.apply(ev('pubsub.drop', { topic: 'x', subId: `c${i}`, reason: 'slow' }));
    }
    const found = t.signals(now).lossyTopics[0];
    assert.ok(found, `fixture must exceed the loss threshold (affected=${affected}/${total})`);
    return found;
  };
  assert.equal(mk(1, 20).shape, 'concentrated', 'a few bad subscribers');
  assert.equal(mk(18, 20).shape, 'broad', 'the topic itself is over capacity');
});

test('tracks sse resume outcomes and stalls on the connection', () => {
  const t = new Topology();
  t.apply(ev('sse.open', { connId: 'c1', topics: ['x'] }));
  t.apply(ev('sse.resume', { connId: 'c1', outcome: 'miss', lastEventId: 'e-9' }));
  t.apply(ev('sse.stall', { connId: 'c1', pendingBytes: 4096 }));
  const n = t.nodes.get('sub:c1');
  assert.equal(n.meta.resume, 'miss');
  assert.equal(n.meta.stalls, 1);
  assert.equal(n.meta.active, true);
  t.apply(ev('sse.close', { connId: 'c1', reason: 'client-gone', durationMs: 1234 }));
  assert.equal(n.meta.active, false);
  assert.equal(n.meta.durationMs, 1234);
});

test('snapshot is JSON-serialisable (Sets and Maps must not leak)', () => {
  const t = fanoutFixture();
  const round = JSON.parse(JSON.stringify(t.snapshot(now)));
  assert.ok(Array.isArray(round.nodes));
  const kafka = round.nodes.find((n) => n.type === NODE.KAFKA);
  assert.deepEqual(kafka.meta.partitions, [0], 'Set must serialise as an array');
  assert.ok(round.edges.every((e) => typeof e.dropsByReason === 'object'));
});
