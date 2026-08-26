/* ----------------------------------------------------------------- sampling
 * TODO(robbie) — sampling policy. See shouldSample() at the bottom.
 *
 * At production message rates, reporting every event costs more than it is
 * worth. But sampling is not a volume dial you can turn freely, because two
 * things break in ways that are worse than the cost you saved:
 *
 *  1. NAIVE PER-EVENT SAMPLING DESTROYS TRACE JOINS. Keep 10% of events and a
 *     trace shows a kafka.consume, no publish, and two of its nine deliveries.
 *     On the fanout view that is indistinguishable from a real, serious bug —
 *     so the tool starts lying, and an observability tool that lies is worse
 *     than no tool. If you sample, sample PER TRACE: hash the traceId and keep
 *     or drop the whole trace together, so every retained trace is complete
 *     end-to-end and the amplification factor stays correct.
 *
 *  2. UNIFORM SAMPLING HIDES RARE EVENTS, WHICH ARE THE INTERESTING ONES.
 *     Drops, stalls, errors, resume misses, rebalances and connection
 *     lifecycle are low-volume and high-signal. They should be kept at 100%
 *     regardless of rate — see ALWAYS_KEEP below. What is actually expensive
 *     is the high-volume, low-information majority: pubsub.deliver and
 *     sse.frame at one event per message per subscriber.
 *
 * A reasonable shape, if you want a starting point:
 *     if (ALWAYS_KEEP.has(kind)) return true;
 *     if (traceId) return hash32(traceId) % 10000 < rate * 10000;   // whole trace
 *     return Math.random() < rate;
 * with `rate` adapted from observed volume rather than hardcoded.
 *
 * You know your traffic shape; I do not. Fill this in before enabling
 * sampling — until then the SDK reports everything, which is correct but only
 * affordable up to some rate you should measure.
 */

/** Kinds that must never be sampled away: low volume, high diagnostic value. */
export const ALWAYS_KEEP = new Set([
  'pubsub.drop', 'pubsub.sub', 'pubsub.unsub', 'pubsub.topic',
  'kafka.error', 'kafka.rebalance',
  'sse.open', 'sse.close', 'sse.resume', 'sse.stall',
  'proc.stats', 'proc.attrib',
]);

/** Stable 32-bit hash — same traceId must decide the same way in every process. */
export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * @param {string} kind      event kind
 * @param {number} rate      configured sample rate, 0..1 (1 = keep everything)
 * @param {string} [traceId] correlation id, when the event has one
 * @returns {boolean} true to report this event
 */
export function shouldSample(kind, rate, traceId) {
  // PLACEHOLDER: reports everything. Correct, and the only option that cannot
  // silently mislead — but it is not free. Replace per the notes above.
  return true;
}
