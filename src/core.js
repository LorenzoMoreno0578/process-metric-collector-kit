import { EventEmitter } from 'node:events';

/**
 * Default clock uses Date.now(). Injected as a constructor argument so tests can
 * advance time deterministically without sleeping.
 */
const defaultNow = () => Date.now();

/**
 * ProcessMetricCollector polls process.memoryUsage() and process.cpuUsage()
 * on a fixed interval and emits a single structured event per tick.
 *
 * Why a fixed interval rather than a moving one: callers asked for steady
 * sampling, and a steady cadence makes downstream aggregation (e.g. rate per
 * second) trivial. The trade-off is that a slow tick does not shift the next
 * one; ticks are scheduled from the wall clock, so a stalled tick simply
 * produces a larger delta in the next cpuUsage reading.
 *
 * The first tick emits deltas of zero for cpuUsage because there is no prior
 * sample to subtract from. This is deliberate: a caller that wants absolute
 * cpu totals should call process.cpuUsage() itself.
 */
export class ProcessMetricCollector extends EventEmitter {
  #intervalMs;
  #now;
  #timer = null;
  #lastCpu = null;
  #running = false;

  /**
   * @param {object} [options]
   * @param {number} [options.intervalMs=1000] polling interval in milliseconds
   * @param {() => number} [options.now] clock function, injectable for tests
   */
  constructor(options = {}) {
    super();
    const { intervalMs = 1000, now = defaultNow } = options;
    if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError('intervalMs must be a finite number greater than 0');
    }
    if (typeof now !== 'function') {
      throw new TypeError('now must be a function returning a number');
    }
    this.#intervalMs = intervalMs;
    this.#now = now;
  }

  get intervalMs() {
    return this.#intervalMs;
  }

  get running() {
    return this.#running;
  }

  /**
   * Start polling. Calling start() while already running is a no-op so that
   * callers do not accidentally stack timers.
   */
  start() {
    if (this.#running) return;
    this.#running = true;
    this.#lastCpu = process.cpuUsage();
    this.#timer = setInterval(() => this.#tick(), this.#intervalMs);
    // Do not hold the event loop open purely for metrics; callers that want
    // the process to stay alive should keep their own handles.
    if (typeof this.#timer.unref === 'function') this.#timer.unref();
  }

  stop() {
    if (!this.#running) return;
    this.#running = false;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Take one sample synchronously and emit it. Exposed so callers (and tests)
   * can sample without starting a timer.
   * @returns {{ timestamp: number, memory: object, cpu: object }}
   */
  sample() {
    const timestamp = this.#now();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const last = this.#lastCpu;
    this.#lastCpu = cpu;
    const cpuDelta = last
      ? { user: cpu.user - last.user, system: cpu.system - last.system }
      : { user: 0, system: 0 };
    const reading = {
      timestamp,
      memory: {
        rss: memory.rss,
        heapTotal: memory.heapTotal,
        heapUsed: memory.heapUsed,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
      cpu: cpuDelta,
    };
    this.emit('reading', reading);
    return reading;
  }

  #tick() {
    this.sample();
  }
}

/**
 * Convenience factory. Kept separate from the class so callers can avoid the
 * `new` keyword when wiring the collector into a larger pipeline.
 * @param {object} [options]
 * @returns {ProcessMetricCollector}
 */
export function createCollector(options) {
  return new ProcessMetricCollector(options);
}
