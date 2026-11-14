import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { whatsNewVitePlugin } from './tools/changelog.mjs';

/**
 * Content-Security-Policy of the built game (audit 13.11, 2.12). Only the build gets it: the dev server's
 * hot reload needs inline scripts. The game loads nothing from the network (the cloud is reached by
 * the main process), so every source is its own file; blob: and data: cover saved files, images and workers.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const contentSecurityPolicy = () => ({
  name: 'asterion-content-security-policy',
  apply: 'build' as const,
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' as const }],
});

export default defineConfig({
  base: './',
  plugins: [react(), whatsNewVitePlugin(), contentSecurityPolicy()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
