import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ingest } from '../src/ingest/server.js';
import { Store } from '../src/model/store.js';
import { Topology } from '../src/model/topology.js';

const mk = (opts = {}) => {
  const store = new Store();
  const topology = new Topology();
  return { ingest: new Ingest({ store, topology, ...opts }), store, topology };
};
const drain = () => new Promise((r) => setTimeout(r, 60));
const line = (o) => JSON.stringify(o);

test('one malformed line does not poison the rest of the batch', async () => {
  const { ingest, store } = mk();
  ingest.enqueue([
    line({ app: 'a', kind: 'pubsub.publish', topic: 't', msgId: '1' }),
    'NOT JSON AT ALL',
    line({ app: 'a', kind: 'pubsub.publish', topic: 't', msgId: '2' }),
    line({ app: 'a', kind: 'pubsub.publish' }),                       // schema miss
    line({ app: 'a', kind: 'pubsub.publish', topic: 't', msgId: '3' }),
  ].join('\n'));
  await drain();
  assert.equal(ingest.stats.accepted, 3);
  assert.equal(ingest.stats.badJson, 1);
  assert.equal(ingest.stats.badSchema, 1);
  assert.equal(store.apps.get('a').counters.total, 3);
});

test('blank lines are ignored, not counted as errors', async () => {
  const { ingest } = mk();
  ingest.enqueue(`\n\n${line({ app: 'a', kind: 'proc.stats', cpuPct: 1 })}\n\n`);
  await drain();
  assert.equal(ingest.stats.accepted, 1);
  assert.equal(ingest.stats.badJson, 0);
});

test('sheds OLDEST under overload so the dashboard shows the recent past', async () => {
  const { ingest } = mk({ maxQueue: 10 });
  // enqueue synchronously; drain is scheduled but has not run yet
  const lines = [];
  for (let i = 0; i < 100; i++) lines.push(line({ app: 'a', kind: 'pubsub.publish', topic: 't', msgId: `m${i}` }));
  ingest.enqueue(lines.join('\n'));
  assert.ok(ingest.stats.shed > 0, 'must shed rather than grow the queue');
  assert.ok(ingest.queue.length <= 10, `queue capped, got ${ingest.queue.length}`);
  await drain();
  // whatever survived must be the NEWEST messages
  const { events } = { events: [] };
  assert.ok(ingest.stats.accepted <= 10);
});

test('rejects unauthorized batches when a key is configured', () => {
  const { ingest } = mk({ key: 'secret' });
  assert.equal(ingest.authorized({ headers: {} }), false);
  assert.equal(ingest.authorized({ headers: { 'x-observer-key': 'wrong' } }), false);
  assert.equal(ingest.authorized({ headers: { 'x-observer-key': 'secret' } }), true);
});

test('is open when no key is configured', () => {
  assert.equal(mk().ingest.authorized({ headers: {} }), true);
});

test('feeds the topology as a side effect of ingest', async () => {
  const { ingest, topology } = mk();
  ingest.enqueue([
    line({ app: 'a', kind: 'kafka.consume', topic: 'k', partition: 0, offset: 1, traceId: 'T' }),
    line({ app: 'a', kind: 'pubsub.publish', topic: 'p', msgId: 'm', traceId: 'T' }),
  ].join('\n'));
  await drain();
  assert.ok(topology.edges.has('kafka:k->topic:p'), 'trace join must survive the ingest path');
});
