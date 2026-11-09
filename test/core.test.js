import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessMetricCollector, createCollector } from '../src/index.js';

test('constructor rejects non-positive intervals', () => {
  assert.throws(() => new ProcessMetricCollector({ intervalMs: 0 }), RangeError);
  assert.throws(() => new ProcessMetricCollector({ intervalMs: -1 }), RangeError);
  assert.throws(() => new ProcessMetricCollector({ intervalMs: NaN }), RangeError);
});

test('constructor rejects a non-function clock', () => {
  assert.throws(() => new ProcessMetricCollector({ now: 42 }), TypeError);
});

test('createCollector returns a ProcessMetricCollector', () => {
  const c = createCollector({ intervalMs: 50 });
  assert.ok(c instanceof ProcessMetricCollector);
  assert.equal(c.intervalMs, 50);
  assert.equal(c.running, false);
});

test('sample emits a reading with the injected timestamp', () => {
  let t = 1000;
  const c = new ProcessMetricCollector({ now: () => t });
  const seen = [];
  c.on('reading', (r) => seen.push(r));
  const r = c.sample();
  assert.equal(seen.length, 1);
  assert.equal(r.timestamp, 1000);
  assert.equal(seen[0], r);
});

test('first sample reports zero cpu delta', () => {
  const c = new ProcessMetricCollector({ now: () => 1 });
  const r = c.sample();
  assert.equal(r.cpu.user, 0);
  assert.equal(r.cpu.system, 0);
});

test('memory reading contains the expected numeric fields', () => {
  const c = new ProcessMetricCollector({ now: () => 1 });
  const r = c.sample();
  for (const key of ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']) {
    assert.equal(typeof r.memory[key], 'number', `memory.${key} should be a number`);
  }
});

test('start is idempotent and stop clears running state', () => {
  const c = new ProcessMetricCollector({ intervalMs: 100000, now: () => 1 });
  c.start();
  assert.equal(c.running, true);
  c.start();
  assert.equal(c.running, true);
  c.stop();
  assert.equal(c.running, false);
  c.stop();
  assert.equal(c.running, false);
});

test('start resets the cpu baseline so the next sample is a real delta', () => {
  const c = new ProcessMetricCollector({ intervalMs: 100000, now: () => 1 });
  c.start();
  // Stop before any tick fires; the baseline set by start() is still in place.
  c.stop();
  const r = c.sample();
  assert.equal(typeof r.cpu.user, 'number');
  assert.equal(typeof r.cpu.system, 'number');
  assert.ok(r.cpu.user >= 0);
  assert.ok(r.cpu.system >= 0);
});

test('cpu deltas are non-negative across consecutive samples', () => {
  const c = new ProcessMetricCollector({ now: () => 1 });
  c.sample();
  const r = c.sample();
  assert.ok(r.cpu.user >= 0);
  assert.ok(r.cpu.system >= 0);
});

test('sample returns a fresh object each call', () => {
  const c = new ProcessMetricCollector({ now: () => 1 });
  const a = c.sample();
  const b = c.sample();
  assert.notEqual(a, b);
  assert.notEqual(a.memory, b.memory);
  assert.notEqual(a.cpu, b.cpu);
});

test('event listener receives the same object returned by sample', () => {
  const c = new ProcessMetricCollector({ now: () => 7 });
  let captured = null;
  c.once('reading', (r) => { captured = r; });
  const returned = c.sample();
  assert.equal(captured, returned);
  assert.equal(captured.timestamp, 7);
});

test('multiple listeners all receive the reading', () => {
  const c = new ProcessMetricCollector({ now: () => 3 });
  const a = [];
  const b = [];
  c.on('reading', (r) => a.push(r));
  c.on('reading', (r) => b.push(r));
  c.sample();
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0], b[0]);
});
