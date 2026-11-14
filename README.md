# process-metric-collector-kit

Polls `process.memoryUsage()` and `process.cpuUsage()` at a fixed interval and emits each reading as a structured `reading` event.

```js
import { createCollector } from 'process-metric-collector-kit';

const collector = createCollector({ intervalMs: 1000 });

collector.on('reading', ({ timestamp, memory, cpu }) => {
  console.log(timestamp, memory.heapUsed, cpu.user, cpu.system);
});

collector.start();
// later
collector.stop();
```

## Why this exists

Node exposes memory and cpu counters as raw process calls. Wiring them into a sampler usually means re-implementing the same three things: a timer, a baseline for cpu deltas, and a stable event shape. This library does only that. The trade-off is that it does not aggregate, smooth, or persist anything — it hands you one plain object per tick and gets out of the way. If you want rates, averages, or export to a metrics backend, do it in your listener.

## API

Exports from the package root:

- `ProcessMetricCollector` — class extending `EventEmitter`.
- `createCollector(options)` — returns a `ProcessMetricCollector`.

`options`:

- `intervalMs` (number, default `1000`) — polling interval, must be a finite number greater than 0.
- `now` (function, default `Date.now`) — clock used for the `timestamp` field. Inject one for deterministic tests.

`ProcessMetricCollector` members:

- `start()` — begins polling. Calling it while running is a no-op.
- `stop()` — stops polling.
- `sample()` — takes one reading immediately, emits `reading`, and returns the reading object.
- `intervalMs` (getter) — the configured interval.
- `running` (getter) — whether the timer is active.
- `'reading'` event — emitted with `{ timestamp, memory, cpu }`.

Reading shape:

- `timestamp` — value from the clock function.
- `memory` — `rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers`, all numbers.
- `cpu` — `user` and `system`, in microseconds, as deltas since the previous sample.

## The awkward edge

The first sample after construction (or after `start()`) has no previous cpu reading to subtract from, so `cpu.user` and `cpu.system` are both `0`. The second sample onwards carries real deltas. If you need absolute cpu totals, call `process.cpuUsage()` yourself; this library deliberately reports deltas so that consecutive readings can be summed without knowing the process start time.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

