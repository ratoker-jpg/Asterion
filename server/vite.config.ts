// The server bundle (asterion-server-X.Y.Z.tgz, see server/deploy/README.md):
// the supervisor and the world runner as plain Node ESM, with the game code
// the client runs compiled in. Image imports become their file names only.
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const version = process.env.ASTERION_VERSION || (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  publicDir: false,
  define: { __ASTERION_SERVER_VERSION__: JSON.stringify(version) },
  build: {
    ssr: true,
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: { server: 'server/src/server.ts', runner: 'server/src/runner.ts' },
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
    },
  },
});
