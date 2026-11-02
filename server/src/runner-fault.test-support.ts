// Tests only: the world runner (runner.ts) with a crash built in, to check that
// the server raises the world again and that the world is the same after it.
//
// ASTERION_TEST_FAULT names a JSON file { crashes, afterStatuses, done? }. Until
// `crashes` crashes have happened (the count is kept in the file, so it survives
// the restarts), the runner dies in the middle of the tick that follows its
// `afterStatuses`-th status report: either inside the NPC journal hook while the
// world is being computed, or when the tick reports. Change `crashes` to 0 in the
// file and the next runner lives.
import fs from 'node:fs';
import { getNpcJournalSink, setNpcJournalSink, type NpcJournalSink } from '../../src/application/npc-journal.ts';
import './runner.ts';

const file = process.env.ASTERION_TEST_FAULT;
if (file && process.send) {
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8')) as { crashes: number; afterStatuses: number; done?: number };
  let statuses = 0;
  let armed = false;
  const die = (): never => {
    const fault = read();
    fault.done = (fault.done ?? 0) + 1;
    fs.writeFileSync(file, JSON.stringify(fault));
    throw new Error(`Injected fault #${fault.done} in the middle of a step`);
  };
  const due = () => { const fault = read(); return armed && (fault.done ?? 0) < fault.crashes; };
  const send = process.send.bind(process);
  process.send = ((message: { type?: string }, ...rest: unknown[]) => {
    if (message?.type === 'status') {
      statuses += 1;
      if (statuses > read().afterStatuses) armed = true;
      if (due()) die();
    }
    return (send as (...args: unknown[]) => boolean)(message, ...rest);
  }) as typeof process.send;
  const inner = getNpcJournalSink();
  if (inner) {
    const hooked: NpcJournalSink = {
      detailed: (ownerId) => inner.detailed(ownerId),
      decision: (entry) => { if (due()) die(); inner.decision(entry); },
      ...(inner.style ? { style: (entry) => { if (due()) die(); inner.style!(entry); } } : {}),
      ...(inner.outcome ? { outcome: (entry) => { if (due()) die(); inner.outcome!(entry); } } : {}),
      ...(inner.sun ? { sun: (entry) => { if (due()) die(); inner.sun!(entry); } } : {}),
    };
    setNpcJournalSink(hooked);
  }
}
