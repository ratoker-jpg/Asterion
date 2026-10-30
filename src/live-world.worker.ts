/// <reference lib="webworker" />
// The live world away from the UI thread: the worker keeps the authoritative
// world, ticks it, runs long catch-ups and writes the save text; App mirrors
// it through record patches. Logic in application/live-world-engine.ts,
// messages in application/live-world-protocol.ts.
import { LiveWorldEngine } from './application/live-world-engine.ts';
import type { LiveWorldRequest, LiveWorldResponse } from './application/live-world-protocol.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// The page clock minus wall time (0 in the game; QA may move the page clock).
let clockOffsetMs = 0;
const engine = new LiveWorldEngine({
  post: (message: LiveWorldResponse) => scope.postMessage(message),
  now: () => Date.now() + clockOffsetMs,
  yieldToMessages: () => new Promise((resolve) => setTimeout(resolve, 0)),
  later: (task, delayMs) => { setTimeout(task, delayMs); },
});

scope.onmessage = (event: MessageEvent<LiveWorldRequest>) => {
  if (event.data.type === 'init') clockOffsetMs = event.data.clockOffsetMs;
  void engine.handle(event.data);
};
