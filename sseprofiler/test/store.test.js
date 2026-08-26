import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ring, Histogram, RateWindow, Store } from '../src/model/store.js';

test('Ring overwrites oldest and counts evictions', () => {
  const r = new Ring(3);
  [1, 2, 3, 4, 5].forEach((v) => r.push(v));
  assert.deepEqual(r.toArray(), [3, 4, 5]);
  assert.equal(r.evicted, 2);
  assert.equal(r.size, 3);
});

test('Ring peekOldest is the oldest, tail(1) is the newest', () => {
  const r = new Ring(3);
  [1, 2, 3, 4].forEach((v) => r.push(v));
  assert.equal(r.peekOldest(), 2);
  assert.equal(r.tail(1)[0], 4);
});

test('Histogram percentiles land in the right bucket', () => {
  const h = new Histogram();
  for (let i = 1; i <= 1000; i++) h.add(i);
  const s = h.snapshot();
  assert.equal(s.count, 1000);
  assert.ok(s.p50 > 400 && s.p50 < 600, `p50=${s.p50}`);
  assert.ok(s.p99 > 800, `p99=${s.p99}`);
  assert.equal(s.max, 1000);
});

test('RateWindow reports the true rate DURING warm-up, not a fraction of it', () => {
  const w = new RateWindow(120);
  for (let t = 0; t < 10; t++) { for (let k = 0; k < 6; k++) w.bump(); w.roll(); }
  // 6 events per 500ms tick == 12/s, even though only 10 of 120 slots are used
  assert.ok(Math.abs(w.rate(500) - 12) < 0.01, `warm-up rate=${w.rate(500)}`);
  for (let t = 0; t < 300; t++) { for (let k = 0; k < 6; k++) w.bump(); w.roll(); }
  assert.ok(Math.abs(w.rate(500) - 12) < 0.01, `steady rate=${w.rate(500)}`);
});

test('RateWindow series grows only as far as elapsed time', () => {
  const w = new RateWindow(120);
  for (let t = 0; t < 5; t++) w.roll();
  assert.equal(w.series().length, 5);
});

const ev = (kind, extra = {}) => ({ ts: Date.now(), app: 'a', instance: 'i', kind, known: true, ...extra });

test('Store caps app count rather than growing without bound', () => {
  const s = new Store({ maxApps: 2 });
  s.add({ ...ev('pubsub.topic', { topic: 't' }), app: 'one' });
  s.add({ ...ev('pubsub.topic', { topic: 't' }), app: 'two' });
  assert.equal(s.add({ ...ev('pubsub.topic', { topic: 't' }), app: 'three' }), null);
  assert.equal(s.dropped.appCap, 1);
});

test('traces evict WHOLE traces oldest-first, never partially', () => {
  const s = new Store({ maxTracesPerApp: 2 });
  for (const t of ['t1', 't2', 't3']) {
    s.add(ev('pubsub.publish', { traceId: t, topic: 'x', msgId: '1' }));
    s.add(ev('pubsub.deliver', { traceId: t, topic: 'x', msgId: '1', subId: 's' }));
  }
  const a = s.apps.get('a');
  assert.deepEqual([...a.traces.keys()], ['t2', 't3'], 'oldest trace evicted');
  // a surviving trace must still be complete — a half-evicted trace would read
  // as a phantom "message that was published but never delivered"
  assert.equal(a.traces.get('t2').length, 2);
});

test('per-instance proc stats are retained separately', () => {
  const s = new Store();
  s.add({ ...ev('proc.stats', { cpuPct: 10 }), instance: 'i1' });
  s.add({ ...ev('proc.stats', { cpuPct: 90 }), instance: 'i2' });
  const a = s.apps.get('a');
  assert.equal(a.instances.get('i1').stats.cpuPct, 10);
  assert.equal(a.instances.get('i2').stats.cpuPct, 90);
});
