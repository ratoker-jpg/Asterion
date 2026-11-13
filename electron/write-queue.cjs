// A bounded write queue for the live world worker's saves (audit 2.9).
// At most one write is in flight; while it runs only the NEWEST message waits,
// older waiting ones are dropped (reported to `onSkip`), so a slow or full disk
// holds at most two save buffers (50-500 MB each) in the main process, never a growing chain.
function createLatestWinsQueue(run, onSkip) {
  let running = false;
  let waiting = null;
  async function drain(message) {
    running = true;
    let current = message;
    try {
      while (current !== null) {
        try { await run(current); } catch { /* run reports its own failures */ }
        current = waiting;
        waiting = null;
      }
    } finally {
      running = false;
    }
  }
  return {
    push(message) {
      if (!running) { void drain(message); return; }
      if (waiting !== null) { try { onSkip(waiting); } catch { /* the skipped writer is gone */ } }
      waiting = message;
    },
    get busy() { return running; },
    get hasWaiting() { return waiting !== null; },
  };
}

module.exports = { createLatestWinsQueue };
