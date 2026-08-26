/* ------------------------------------------------------------------- schema
 * The normative definition of the ingest wire protocol. Every other module —
 * ingest, store, topology, the UI, the SDK, tools/synth.js — treats this file
 * as the single source of truth for what an event is.
 *
 * Design rules, in priority order:
 *   1. Forward compatible. An unknown `kind` is retained and counted, never a
 *      hard error: an older collector must not reject a newer app's events.
 *   2. Cheap. Validation runs on every ingested line at production rates, so
 *      it is hand-rolled field checks — no schema library, no regex per field.
 *   3. Non-destructive. Unknown *fields* on a known kind are preserved, so a
 *      newer SDK can add detail an older collector still passes through.
 */

/** Envelope fields present on every event regardless of kind. */
export const ENVELOPE = ['ts', 'app', 'instance', 'kind'];

/**
 * kind -> { req: [...], opt: [...] }
 * `req` fields must be present and non-null; a missing one rejects the line.
 * Keep this table flat and additive — adding a kind must never require
 * touching the ingest or store code.
 */
export const KINDS = {
  /* --- pub/sub: the primary view ------------------------------------- */
  'pubsub.topic':   { req: ['topic'],                  opt: ['declaredBy'] },
  'pubsub.sub':     { req: ['topic', 'subId'],         opt: ['subscriberKind'] },
  'pubsub.unsub':   { req: ['topic', 'subId'],         opt: ['reason'] },
  'pubsub.publish': { req: ['topic', 'msgId'],         opt: ['bytes', 'traceId', 'publisher'] },
  'pubsub.deliver': { req: ['topic', 'msgId', 'subId'],opt: ['latencyMs', 'traceId'] },
  'pubsub.drop':    { req: ['topic', 'reason'],        opt: ['msgId', 'subId', 'traceId'] },

  /* --- kafka: fanout origin ------------------------------------------ */
  'kafka.consume':  { req: ['topic', 'partition', 'offset'], opt: ['lag', 'group', 'msgId', 'traceId', 'bytes'] },
  'kafka.commit':   { req: ['topic', 'partition', 'offset'], opt: ['group'] },
  'kafka.rebalance':{ req: ['group'],                  opt: ['assigned', 'revoked'] },
  'kafka.error':    { req: ['message'],                opt: ['topic', 'partition', 'group'] },

  /* --- sse: connection lifecycle ------------------------------------- */
  'sse.open':       { req: ['connId'],                 opt: ['topics', 'remote', 'ua'] },
  'sse.resume':     { req: ['connId', 'outcome'],      opt: ['lastEventId'] },
  'sse.frame':      { req: ['connId'],                 opt: ['topic', 'bytes', 'writeNs', 'traceId', 'msgId'] },
  'sse.stall':      { req: ['connId'],                 opt: ['pendingBytes'] },
  'sse.close':      { req: ['connId'],                 opt: ['reason', 'durationMs'] },

  /* --- process health + the CPU-attribution thesis ------------------- */
  'proc.stats':     { req: [],                         opt: ['rssMB', 'heapMB', 'cpuPct', 'lagMs', 'conns'] },
  'proc.attrib':    { req: [],                         opt: ['pubsubNs', 'sseNs', 'writes'] },
};

/** Enumerations the UI colours by. Unlisted values render, they just don't theme. */
export const DROP_REASONS = ['slow', 'closed', 'nosub', 'backpressure'];
export const RESUME_OUTCOMES = ['ok', 'miss', 'off'];
export const SUBSCRIBER_KINDS = ['sse', 'worker', 'internal'];

/** Which domain a kind belongs to — drives view routing and per-domain counters. */
export function domainOf(kind) {
  const dot = kind.indexOf('.');
  return dot === -1 ? 'unknown' : kind.slice(0, dot);
}

const MAX_STR = 512;      // defensive cap: a malicious/buggy app can't blow memory via one field
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate and normalise one parsed event object.
 * Returns { ok: true, event } or { ok: false, err } — never throws, because
 * this runs inside the ingest hot loop where a throw would cost a whole batch.
 */
export function validate(raw, now = Date.now()) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, err: 'not-an-object' };
  }
  if (!isStr(raw.kind) || !raw.kind) return { ok: false, err: 'missing-kind' };
  if (!isStr(raw.app) || !raw.app) return { ok: false, err: 'missing-app' };

  const spec = KINDS[raw.kind];
  if (spec) {
    for (const f of spec.req) {
      if (raw[f] === undefined || raw[f] === null) {
        return { ok: false, err: `missing-field:${raw.kind}.${f}` };
      }
    }
  }

  // Timestamps come from the *app's* clock, which may be skewed or absent.
  // Clamp rather than reject: a wrong clock should not make an app invisible,
  // but it must not be allowed to corrupt time-ordered buffers either.
  let ts = isNum(raw.ts) ? raw.ts : now;
  if (ts > now + 60_000 || ts < now - 3_600_000) ts = now;

  const event = { ...raw, ts, app: raw.app.slice(0, MAX_STR), kind: raw.kind.slice(0, MAX_STR) };
  event.instance = isStr(raw.instance) ? raw.instance.slice(0, MAX_STR) : 'default';
  event.known = spec !== undefined;
  return { ok: true, event };
}

/** Parse one NDJSON line. Separated from validate() so callers can count
 *  parse failures and schema failures distinctly — they mean different things:
 *  a parse failure is a broken sender, a schema failure is a version mismatch. */
export function parseLine(line, now = Date.now()) {
  let raw;
  try { raw = JSON.parse(line); } catch { return { ok: false, err: 'bad-json' }; }
  return validate(raw, now);
}
