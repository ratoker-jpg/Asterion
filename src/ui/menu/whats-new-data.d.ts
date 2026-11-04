/** Generated from changelog/notes at build time (tools/changelog.mjs). Same shape as WhatsNewRelease in whats-new.ts. */
declare module 'virtual:asterion-whats-new' {
  export const WHATS_NEW_RELEASES: Array<{
    version: string | null;
    date: string | null;
    headline: string;
    items: Array<{ title: string; text: string; where: string; image?: string; imageAlt?: string }>;
  }>;
}
