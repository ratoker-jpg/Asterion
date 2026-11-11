/// <reference lib="webworker" />
// The live world away from the UI thread: the worker keeps the authoritative
// world, ticks it, runs long catch-ups and writes the save text; App mirrors
// it through record patches. Logic in application/live-world-engine.ts,
// messages in application/live-world-protocol.ts.
import { LiveWorldEngine, type LiveWorldEngineHost } from './application/live-world-engine.ts';
import type { LiveWorldRequest, LiveWorldResponse } from './application/live-world-protocol.ts';
import { nextWriteId } from './application/save-storage.ts';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// The page clock minus wall time (0 in the game; QA may move the page clock).
let clockOffsetMs = 0;
const host: LiveWorldEngineHost = {
  post: (message: LiveWorldResponse) => scope.postMessage(message),
  now: () => Date.now() + clockOffsetMs,
  yieldToMessages: () => new Promise((resolve) => setTimeout(resolve, 0)),
  later: (task, delayMs) => { setTimeout(task, delayMs); },
};
const engine = new LiveWorldEngine(host);

/**
 * Large saves go to the main process through this port as UTF-8 bytes (the
 * bytes are cloned on this thread, nothing is copied on the UI thread); the UI thread only hears
 * "saved". The main process answers on the same port once the file is in place.
 */
function attachSavePort(saveKey: string, port: MessagePort): void {
  const computeMsOf = new Map<string, number>();
  port.onmessage = (event: MessageEvent<{ ok: boolean; version: number; writeId: string; chars: number; error?: string }>) => {
    const reply = event.data;
    const computeMs = computeMsOf.get(reply.writeId) ?? 0;
    computeMsOf.delete(reply.writeId);
    if (reply.ok) {
      scope.postMessage({ type: 'saved', version: reply.version, writeId: reply.writeId, chars: reply.chars, computeMs } satisfies LiveWorldResponse);
      return;
    }
    host.sendSave = undefined;
    engine.savePortFailed();
    scope.postMessage({ type: 'save-port-failed', error: reply.error ?? 'unknown' } satisfies LiveWorldResponse);
  };
  host.sendSave = (version, bytes, chars, computeMs) => {
    const writeId = nextWriteId();
    computeMsOf.set(writeId, computeMs);
    // Not transferred: Electron's main-process port does not take a transferred ArrayBuffer (it arrives as null).
    // The copy is made here, on the worker thread; the UI thread touches nothing.
    port.postMessage({ key: saveKey, writeId, version, chars, bytes: new Uint8Array(bytes) });
    return true;
  };
}

scope.onmessage = (event: MessageEvent<LiveWorldRequest>) => {
  if (event.data.type === 'save-port') {
    attachSavePort(event.data.saveKey, event.data.port);
    return;
  }
  if (event.data.type === 'init') clockOffsetMs = event.data.clockOffsetMs;
  void engine.handle(event.data);
};
