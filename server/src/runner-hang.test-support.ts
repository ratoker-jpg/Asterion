// Tests only: the world runner (runner.ts) that never answers a `stop` request, like a
// runner stuck in a long computation. The server must kill it after its stop timeout.
import './runner.ts';

const emit = process.emit.bind(process) as (event: string, ...args: unknown[]) => boolean;
process.emit = ((event: string, ...args: unknown[]) => {
  if (event === 'message' && (args[0] as { type?: string } | undefined)?.type === 'stop') return true;
  return emit(event, ...args);
}) as typeof process.emit;
