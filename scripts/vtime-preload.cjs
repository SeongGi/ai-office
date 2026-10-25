// Virtual time for scripted recordings. Loaded as a preload (context isolation
// off) so it replaces the page's clock before any app code runs. The recorder
// advances time one video frame at a time with __vt.step(ms), so every frame
// is fully rendered no matter how long it takes: no drops, no stutter.
(() => {
  const RealDate = Date;
  const epoch = RealDate.now();
  let vt = 0; // virtual milliseconds since load
  let nextId = 1;
  let raf = [];
  const timers = new Map();
  const seen = new WeakMap(); // CSS animation -> virtual time it started

  // Keep the real frame clock for the recorder's "has this frame been drawn" fence.
  const realRaf = window.requestAnimationFrame.bind(window);
  window.__drawn = () => new Promise((r) => realRaf(() => realRaf(() => r(true))));

  performance.now = () => vt;
  class VDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(epoch + vt);
    }
    static now() {
      return epoch + vt;
    }
  }
  window.Date = VDate;

  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    raf.push([id, cb]);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    raf = raf.filter(([i]) => i !== id);
  };
  window.setTimeout = (cb, ms = 0, ...args) => {
    const id = nextId++;
    timers.set(id, { at: vt + Math.max(0, Number(ms) || 0), cb: () => (typeof cb === 'function' ? cb(...args) : undefined) });
    return id;
  };
  window.setInterval = (cb, ms = 0, ...args) => {
    const id = nextId++;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: vt + every, every, cb: () => cb(...args) });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);

  window.__vt = {
    now: () => vt,
    /** Advance the clock by ms: fire due timers in order, then one animation frame. */
    step(ms) {
      const target = vt + ms;
      for (let guard = 0; guard < 10000; guard++) {
        let due = null;
        for (const [id, t] of timers) if (t.at <= target && (!due || t.at < due[1].at)) due = [id, t];
        if (!due) break;
        const [id, t] = due;
        vt = Math.max(vt, t.at);
        if (t.every) t.at += t.every;
        else timers.delete(id);
        try {
          t.cb();
        } catch (e) {
          console.error(e);
        }
      }
      vt = target;
      const frame = raf;
      raf = [];
      for (const [, cb] of frame) {
        try {
          cb(vt);
        } catch (e) {
          console.error(e);
        }
      }
      // CSS transitions and animations follow virtual time too.
      for (const a of document.getAnimations()) {
        if (!seen.has(a)) {
          seen.set(a, vt);
          a.pause();
        }
        a.currentTime = vt - seen.get(a);
      }
    },
  };
})();
