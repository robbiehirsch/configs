# pubsub-observer

An admin tool for watching a server's **pub/sub topology**, **Kafka fanout**, and
**SSE connection lifecycle** — across several apps, in mixed languages, from one
container.

It is a **passive collector**. It generates no traffic, brokers nothing, and has
no opinion about how your apps are written. Apps push telemetry at it over plain
HTTP; it holds a bounded in-memory window and renders it.

```
  app-a (TS) ─┐
  app-b (TS) ─┼─ batched NDJSON ──▶  observer container  ──▶  web UI :9099
  app-c (any) ┘   POST /v1/ingest       (zero deps)
```

## Quick start

```bash
docker compose up          # observer + a synthetic app, populated dashboard
open http://localhost:9099
```

Or without Docker:

```bash
node src/main.js           # collector on :9099
node tools/synth.js        # fake app, speaks the public protocol
npm test
```

## What it answers

| View | Question |
|---|---|
| **Topology** | What is publishing to what, who is subscribed, where is it lossy? |
| **Kafka fanout** | This Kafka message — which topics and connections did it reach, and where did it die? |
| **SSE lifecycle** | Who is connected, for how long, are they reconnect-looping or stalling? |
| **Apps** | Per-app health, and how much work is broker vs transport? |

Derived signals it surfaces without being asked: **orphaned topics** (published
to, nobody listening), **silent subscribers** (subscribed, receiving nothing),
**lossy topics** classified as *concentrated* (a few slow subscribers) or *broad*
(the topic is over capacity), and **fanout amplification** (deliveries per
consumed Kafka message).

## Configuration

All via environment variables.

| Var | Default | Meaning |
|---|---|---|
| `OBSERVER_PORT` | `9099` | listen port |
| `OBSERVER_HOST` | `::` | dual-stack; see note below |
| `OBSERVER_KEY` | *(none)* | shared secret required in `X-Observer-Key` |
| `OBSERVER_TICK_MS` | `500` | aggregation + broadcast cadence |
| `OBSERVER_MAX_EVENTS_PER_APP` | `20000` | raw ring buffer size — the memory cap |
| `OBSERVER_MAX_TRACES_PER_APP` | `2000` | retained traces for fanout reconstruction |
| `OBSERVER_MAX_APPS` | `64` | tenant cap |

> **Bind note.** The default is `::`, not `0.0.0.0`. Node 18+ `fetch()` resolves
> `localhost` to `::1` first, so an IPv4-only bind makes an app configured with
> `http://localhost:9099` fail — and because a correct SDK swallows send errors,
> it fails *completely silently*. If IPv6 is unavailable the server falls back
> to `0.0.0.0` on its own.

Retention is **in-memory only**. A restart loses history. This is deliberate: it
is a live-debugging tool, not a metrics store.

## Wire protocol

`POST /v1/ingest`, body is NDJSON (one JSON object per line), optionally
gzipped. Responds `202` immediately and parses afterwards — it never blocks a
sender. Malformed lines are counted and skipped, never failing the batch.

Every event: `{ ts, app, instance, kind, ...payload }`. `ts` and `instance` are
optional. Unknown `kind` values are accepted and counted, so a newer app can
never be rejected by an older collector.

| kind | required | optional |
|---|---|---|
| `pubsub.topic` | `topic` | `declaredBy` |
| `pubsub.sub` | `topic`, `subId` | `subscriberKind` (`sse`\|`worker`\|`internal`) |
| `pubsub.unsub` | `topic`, `subId` | `reason` |
| `pubsub.publish` | `topic`, `msgId` | `bytes`, `traceId`, `publisher` |
| `pubsub.deliver` | `topic`, `msgId`, `subId` | `latencyMs`, `traceId` |
| `pubsub.drop` | `topic`, `reason` | `msgId`, `subId`, `traceId` |
| `kafka.consume` | `topic`, `partition`, `offset` | `lag`, `group`, `msgId`, `traceId`, `bytes` |
| `kafka.commit` | `topic`, `partition`, `offset` | `group` |
| `kafka.rebalance` | `group` | `assigned`, `revoked` |
| `kafka.error` | `message` | `topic`, `partition`, `group` |
| `sse.open` | `connId` | `topics`, `remote`, `ua` |
| `sse.resume` | `connId`, `outcome` (`ok`\|`miss`\|`off`) | `lastEventId` |
| `sse.frame` | `connId` | `topic`, `bytes`, `writeNs`, `traceId`, `msgId` |
| `sse.stall` | `connId` | `pendingBytes` |
| `sse.close` | `connId` | `reason`, `durationMs` |
| `proc.stats` | — | `rssMB`, `heapMB`, `cpuPct`, `lagMs`, `conns` |
| `proc.attrib` | — | `pubsubNs`, `sseNs`, `writes` |

`src/model/schema.js` is the normative definition.

### traceId is the one thing that matters

Everything else is a counter. `traceId` is what makes fanout answerable: set it
when you consume from Kafka, carry it through publish → deliver → frame, and the
collector reconstructs the whole blast radius by joining on it. **Without
traceId propagation there is no Kafka→topic edge at all** — no single event says
"this Kafka message caused that publish", so it can only ever be inferred.

## Instrumenting an app

### Node / TypeScript

```js
import { createObserver } from '@yourorg/observer-sdk';

const obs = createObserver({ url: 'http://observer:9099', app: 'checkout', key: process.env.OBSERVER_KEY });

obs.pubsub.publish({ topic, msgId, bytes, traceId, publisher: 'svc-orders' });
obs.instrumentSSE(res, { connId, topics });   // auto open/frame/stall/close
obs.kafka.wrapConsumer(consumer, { group });  // auto consume, mints traceId
obs.startProcessReporter({ conns: () => pool.size });
```

The SDK will not throw into your app, will not block your request path, caps its
own memory, and drops telemetry rather than retaining it when the collector is
unreachable. `enabled: false` makes every call a no-op.

### Any other language

There is no SDK and none is needed — the protocol is the integration surface.

```python
# Python
import json, time, threading, urllib.request
_buf, _lock = [], threading.Lock()

def emit(kind, **f):
    with _lock:
        _buf.append({"ts": int(time.time()*1000), "app": "billing",
                     "instance": INSTANCE, "kind": kind, **f})

def _flush():
    while True:
        time.sleep(0.5)
        with _lock:
            batch, _buf[:] = _buf[:], []
        if not batch: continue
        body = "\n".join(json.dumps(e) for e in batch).encode()
        req = urllib.request.Request(URL + "/v1/ingest", body,
                                     {"Content-Type": "application/x-ndjson"})
        try: urllib.request.urlopen(req, timeout=2)
        except Exception: pass          # never let telemetry break the app
threading.Thread(target=_flush, daemon=True).start()
```

```bash
# anything that can curl
curl -X POST http://observer:9099/v1/ingest \
  -H 'Content-Type: application/x-ndjson' \
  --data-binary $'{"app":"billing","kind":"pubsub.publish","topic":"invoices","msgId":"1"}'
```

Whatever you write, follow the same four rules the SDK does: **never throw into
the host app, never block, cap your buffer, drop rather than retain.**

## Read API

Every view is scriptable — the UI is just another client.

| Endpoint | Returns |
|---|---|
| `GET /v1/apps` | tenants, rates, per-instance health |
| `GET /v1/topology` | full node/edge graph plus derived signals |
| `GET /v1/events?app=&kind=&n=` | raw event tail, optionally filtered by kind prefix |
| `GET /v1/trace?app=&id=` | every event sharing a traceId |
| `GET /v1/live` | SSE stream of snapshots (what the dashboard consumes) |
| `GET /v1/self` | the collector's own health — ingest counters, buffer occupancy, RSS |
| `GET /health` | liveness |

## Layout

```
src/model/schema.js      wire protocol — the single source of truth
src/model/store.js       ring buffers, histograms, rate windows, trace joins
src/model/topology.js    live graph + derived signals
src/ingest/server.js     NDJSON ingest; never blocks producers
src/api/http.js          read API + live stream + static UI
src/ui/web/              four-view dashboard (zero deps, no build)
src/ui/kit.js            ANSI helpers salvaged from the prototype
sdk/node/                TypeScript-friendly Node SDK
tools/synth.js           dev fixture — an ordinary ingest client
```

## Two decisions left open

Both are marked `TODO(robbie)` in the source with the trade-offs written out,
because they depend on your real traffic shape rather than on anything the code
can determine:

1. **`src/model/topology.js` → `decayEdge()`** — when a quiet topic or a closed
   connection leaves the graph. Currently retains everything, which is correct
   but grows without bound (SSE `subId`s are per-connection, so they accumulate
   fast). **Set this before running against production volumes.**
2. **`sdk/node/src/sampling.js` → `shouldSample()`** — currently reports
   everything. Correct, but not free above some rate you should measure.
