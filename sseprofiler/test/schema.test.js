import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, parseLine, domainOf, KINDS } from '../src/model/schema.js';

const base = { app: 'a', instance: 'i', kind: 'pubsub.publish', topic: 't', msgId: 'm' };

test('accepts a well-formed event', () => {
  const r = validate({ ...base, ts: Date.now() });
  assert.equal(r.ok, true);
  assert.equal(r.event.known, true);
});

test('rejects missing required fields per kind', () => {
  const r = validate({ app: 'a', kind: 'pubsub.publish', topic: 't' });
  assert.equal(r.ok, false);
  assert.match(r.err, /missing-field:pubsub\.publish\.msgId/);
});

test('rejects events with no app — an event with no tenant is unroutable', () => {
  assert.equal(validate({ kind: 'pubsub.topic', topic: 't' }).ok, false);
});

test('accepts UNKNOWN kinds so a newer SDK cannot be rejected by an older collector', () => {
  const r = validate({ app: 'a', kind: 'future.kind', anything: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.event.known, false, 'must be flagged unknown for the self-metrics counter');
  assert.equal(r.event.anything, 1, 'unknown fields must survive');
});

test('preserves unknown FIELDS on a known kind', () => {
  const r = validate({ ...base, futureField: 'keep me' });
  assert.equal(r.event.futureField, 'keep me');
});

test('clamps a skewed clock instead of dropping the event', () => {
  const now = Date.now();
  // an app whose clock is a year fast must still be visible
  const far = validate({ ...base, ts: now + 365 * 864e5 }, now);
  assert.equal(far.ok, true);
  assert.equal(far.event.ts, now);
  // ...and one a year slow
  const old = validate({ ...base, ts: now - 365 * 864e5 }, now);
  assert.equal(old.event.ts, now);
  // but a legitimately recent timestamp is left alone
  const fine = validate({ ...base, ts: now - 5000 }, now);
  assert.equal(fine.event.ts, now - 5000);
});

test('defaults instance so single-process apps need not set it', () => {
  const { instance, ...noInstance } = base;
  assert.equal(validate(noInstance).event.instance, 'default');
  assert.equal(validate(base).event.instance, 'i', 'an explicit instance is kept');
});

test('parseLine distinguishes bad JSON from a schema miss', () => {
  assert.equal(parseLine('{oops').err, 'bad-json');
  assert.match(parseLine('{"app":"a","kind":"pubsub.publish","topic":"t"}').err, /missing-field/);
});

test('domainOf routes every declared kind to a known domain', () => {
  for (const k of Object.keys(KINDS)) {
    assert.ok(['pubsub', 'kafka', 'sse', 'proc'].includes(domainOf(k)), `${k} -> ${domainOf(k)}`);
  }
});
