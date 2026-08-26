/* ------------------------------------------------------------------ ingest
 * The rule this file exists to enforce: THE OBSERVER MUST NEVER BE THE REASON
 * AN APP IS SLOW. Everything here follows from that.
 *
 *   - respond 202 before doing any work; the sender is released immediately
 *   - never 4xx a whole batch for one bad line; count it and move on
 *   - shed load by dropping events, never by applying TCP backpressure
 *   - a body over the cap is truncated, not rejected
 */

import { createServer } from 'node:http';
import { gunzipSync, inflateSync } from 'node:zlib';
import { parseLine } from '../model/schema.js';

const MAX_BODY = 8 * 1024 * 1024;

export class Ingest {
  constructor({ store, topology, key = null, maxQueue = 50_000 }) {
    this.store = store;
    this.topology = topology;
    this.key = key;
    this.maxQueue = maxQueue;
    this.queue = [];
    this.draining = false;
    this.stats = {
      batches: 0, lines: 0, accepted: 0,
      badJson: 0, badSchema: 0, shed: 0, unauthorized: 0, oversize: 0,
    };
  }

  /** Constant-time-ish shared-secret check. Absent key = open collector. */
  authorized(req) {
    if (!this.key) return true;
    return req.headers['x-observer-key'] === this.key;
  }

  /** Push raw NDJSON text into the queue. Returns lines seen. */
  enqueue(text) {
    let lines = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      lines++;
      if (this.queue.length >= this.maxQueue) {
        /* Shed OLDEST, not newest. Under sustained overload the recent past is
         * what an operator is looking at; dropping the newest would freeze the
         * dashboard at the moment things got interesting. */
        this.queue.shift();
        this.stats.shed++;
      }
      this.queue.push(line);
    }
    this.stats.lines += lines;
    this.#scheduleDrain();
    return lines;
  }

  #scheduleDrain() {
    if (this.draining) return;
    this.draining = true;
    setImmediate(() => this.#drain());
  }

  /* Drain in slices so a large batch cannot monopolise the event loop and
   * stall the UI's own SSE stream — the same sliced-pumping trick the
   * prototype used in fanout(). */
  #drain() {
    const SLICE = 2_000;
    const now = Date.now();
    let n = 0;
    while (this.queue.length && n < SLICE) {
      const line = this.queue.shift();
      n++;
      const r = parseLine(line, now);
      if (!r.ok) {
        if (r.err === 'bad-json') this.stats.badJson++;
        else this.stats.badSchema++;
        continue;
      }
      this.stats.accepted++;
      if (this.store.add(r.event)) this.topology.apply(r.event);
    }
    if (this.queue.length) setImmediate(() => this.#drain());
    else this.draining = false;
  }

  #readBody(req, cb) {
    const chunks = [];
    let len = 0, over = false;
    req.on('data', (c) => {
      len += c.length;
      if (len > MAX_BODY) { over = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) this.stats.oversize++;
      let buf = Buffer.concat(chunks);
      const enc = req.headers['content-encoding'];
      try {
        if (enc === 'gzip') buf = gunzipSync(buf);
        else if (enc === 'deflate') buf = inflateSync(buf);
      } catch { /* corrupt compression — counted downstream as bad json */ }
      cb(buf.toString('utf8'));
    });
    req.on('error', () => cb(''));
  }

  /** Route handler for POST /v1/ingest. */
  handle(req, res) {
    if (!this.authorized(req)) {
      this.stats.unauthorized++;
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end('{"error":"unauthorized"}');
    }
    this.stats.batches++;
    // Ack first. Parsing happens after the response is on the wire.
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    this.#readBody(req, (text) => { if (text) this.enqueue(text); });
  }
}
