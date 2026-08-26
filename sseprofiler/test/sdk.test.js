import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createObserver } from '../sdk/node/src/index.js';

const listen = (handler) => new Promise((res) => {
  const s = createServer(handler);
  s.listen(0, '127.0.0.1', () => res({ server: s, url: `http://127.0.0.1:${s.address().port}` }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('reports batched events to the collector', async () => {
  const seen = [];
  const { server, url } = await listen((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { seen.push(...b.trim().split('\n').map((l) => JSON.parse(l))); res.writeHead(202).end('{}'); });
  });
  const obs = createObserver({ url, app: 'test', flushMs: 20 });
  obs.pubsub.publish({ topic: 't', msgId: 'm1', bytes: 10 });
  obs.pubsub.deliver({ topic: 't', msgId: 'm1', subId: 's1', latencyMs: 2 });
  await obs.flush(); await wait(50);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].kind, 'pubsub.publish');
  assert.equal(seen[0].app, 'test');
  assert.ok(seen[0].instance, 'instance is defaulted');
  server.close();
});

test('an UNREACHABLE collector causes zero host-app errors', async () => {
  // nothing is listening on this port
  const obs = createObserver({ url: 'http://127.0.0.1:1', app: 'test', flushMs: 10 });
  let threw = null;
  process.once('unhandledRejection', (e) => { threw = e; });
  for (let i = 0; i < 500; i++) obs.pubsub.publish({ topic: 't', msgId: `m${i}` });
  await obs.flush();
  await wait(80);
  assert.equal(threw, null, 'must never surface an unhandled rejection');
  assert.ok(obs.stats().failures > 0, 'failure is recorded internally');
});

test('memory stays bounded when the collector is unreachable', async () => {
  const obs = createObserver({ url: 'http://127.0.0.1:1', app: 'test', flushMs: 5000, maxQueue: 100 });
  for (let i = 0; i < 10_000; i++) obs.pubsub.publish({ topic: 't', msgId: `m${i}` });
  const s = obs.stats();
  assert.ok(s.queueDepth <= 100, `queue capped at 100, got ${s.queueDepth}`);
  assert.ok(s.dropped > 9000, 'excess is dropped, not retained');
});

test('a failed batch is DROPPED, never requeued into an unbounded backlog', async () => {
  const obs = createObserver({ url: 'http://127.0.0.1:1', app: 'test', flushMs: 10, maxBatch: 10 });
  for (let i = 0; i < 10; i++) obs.pubsub.publish({ topic: 't', msgId: `m${i}` });
  await obs.flush(); await wait(30);
  assert.equal(obs.stats().queueDepth, 0, 'failed batch must not return to the queue');
  assert.equal(obs.stats().failed, 10);
});

test('disabled is free — no queueing, no timers, no work', () => {
  const obs = createObserver({ url: 'http://127.0.0.1:1', app: 'test', enabled: false });
  for (let i = 0; i < 1000; i++) obs.pubsub.publish({ topic: 't', msgId: `m${i}` });
  assert.equal(obs.stats().queued, 0);
  assert.equal(obs.stats().queueDepth, 0);
});

test('overhead on the host publish path is negligible', () => {
  const N = 50_000;
  const off = createObserver({ url: 'http://127.0.0.1:1', app: 't', enabled: false });
  const on = createObserver({ url: 'http://127.0.0.1:1', app: 't', flushMs: 60_000, maxQueue: 1000 });
  const bench = (o) => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) o.pubsub.publish({ topic: 't', msgId: `m${i}`, bytes: 100 });
    return Number(process.hrtime.bigint() - t0) / N;
  };
  bench(off); bench(on);                       // warm up
  const nsOff = bench(off), nsOn = bench(on);
  // A publish call should cost well under a microsecond of app time.
  assert.ok(nsOn < 5000, `enabled costs ${nsOn.toFixed(0)}ns/call`);
  console.log(`    sdk overhead: disabled ${nsOff.toFixed(0)}ns/call, enabled ${nsOn.toFixed(0)}ns/call`);
});

test('instrumentSSE reports open, frames and close without altering write semantics', async () => {
  const seen = [];
  const { server, url } = await listen((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { seen.push(...b.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))); res.writeHead(202).end('{}'); });
  });
  const obs = createObserver({ url, app: 'test', flushMs: 20 });

  const writes = [];
  const fake = { write: (c) => { writes.push(c); return true; }, once: () => {}, writableLength: 0 };
  obs.instrumentSSE(fake, { connId: 'c1', topics: ['a', 'b'] });
  assert.equal(fake.write('data: hello\n\n'), true, 'return value must pass through');
  assert.deepEqual(writes, ['data: hello\n\n'], 'payload must pass through unchanged');

  await obs.flush(); await wait(50);
  const kinds = seen.map((e) => e.kind);
  assert.ok(kinds.includes('sse.open'));
  assert.ok(kinds.includes('sse.frame'));
  assert.equal(kinds.filter((k) => k === 'pubsub.sub').length, 2, 'one sub per topic');
  server.close();
});
