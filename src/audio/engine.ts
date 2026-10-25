import {
  channelGain,
  normalizeAudioPreferences,
  persistAudioPreferences,
  readAudioPreferences,
  type AudioPreferencesV1,
} from '../domain/settings/audio.ts';
import { startMusic, type MusicHandle, type MusicTheme } from './music.ts';
import { SOUNDS, type SoundId } from './sounds.ts';

/**
 * ASTERION AUDIO ENGINE
 * One AudioContext for the whole app, created on the first user gesture
 * (autoplay policy). Every sound is synthesised (Web Audio API, no files):
 *
 *   effects bus ─┐
 *   interface bus┼─> master ─> compressor ─> speakers
 *   music bus ───┘      ^
 *   reverb (generated impulse) ──┘   (any voice may send into it)
 *
 * Contract and the sound map: docs/ui/sound-system.md.
 */

export type AudioBus = 'effects' | 'interface' | 'music';

/** What a sound recipe gets: a running context, its bus and the shared reverb. */
export type SoundKit = {
  ctx: AudioContext;
  now: number;
  out: AudioNode;
  reverb: AudioNode;
  noise: AudioBuffer;
};

type Listener = (preferences: AudioPreferencesV1) => void;

/** The same sound fired again within this window is dropped (hover sweeps, double events). */
const MIN_REPEAT_MS: Partial<Record<SoundId, number>> = {
  hover: 55,
  hoverCard: 90,
  tick: 35,
  screen: 220,
  open: 120,
  close: 120,
  info: 400,
  notify: 600,
  alarm: 2500,
};

function createImpulse(ctx: AudioContext, seconds: number, decay: number) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return impulse;
}

function createNoise(ctx: AudioContext) {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<AudioBus, GainNode>();
  private reverb: ConvolverNode | null = null;
  private noise: AudioBuffer | null = null;
  private preferences: AudioPreferencesV1 = readAudioPreferences();
  private listeners = new Set<Listener>();
  private lastPlayed = new Map<SoundId, number>();
  private wantedTheme: MusicTheme | null = null;
  private music: { theme: MusicTheme; handle: MusicHandle } | null = null;

  getPreferences() {
    return this.preferences;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  setPreferences(next: AudioPreferencesV1) {
    this.preferences = normalizeAudioPreferences(next);
    persistAudioPreferences(this.preferences);
    this.applyGains();
    this.syncMusic();
    for (const listener of this.listeners) listener(this.preferences);
  }

  /** Called from the first pointer/key gesture: creates or resumes the context. */
  unlock() {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      try {
        this.build(new AudioContext({ latencyHint: 'interactive' }));
      } catch {
        return;
      }
    }
    if (this.ctx?.state === 'suspended' && document.visibilityState === 'visible') void this.ctx.resume();
    this.syncMusic();
  }

  /** The background loop of a screen; it starts once the context is unlocked. */
  setMusic(theme: MusicTheme | null) {
    this.wantedTheme = theme;
    this.syncMusic();
  }

  play(id: SoundId) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.reverb || !this.noise) return;
    const sound = SOUNDS[id];
    if (channelGain(this.preferences, sound.bus) <= 0) return;
    const at = performance.now();
    const gap = MIN_REPEAT_MS[id];
    if (gap && at - (this.lastPlayed.get(id) ?? -Infinity) < gap) return;
    this.lastPlayed.set(id, at);
    try {
      sound.play({ ctx, now: ctx.currentTime + 0.005, out: this.buses.get(sound.bus)!, reverb: this.reverb, noise: this.noise });
    } catch {
      // A failed voice must never break the click that triggered it.
    }
  }

  private build(ctx: AudioContext) {
    this.ctx = ctx;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(compressor);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = createImpulse(ctx, 2.8, 2.6);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.42;
    this.reverb.connect(reverbReturn).connect(this.master);

    for (const bus of ['effects', 'interface', 'music'] as const) {
      const gain = ctx.createGain();
      gain.connect(this.master);
      this.buses.set(bus, gain);
    }
    this.noise = createNoise(ctx);
    this.applyGains(true);

    // A hidden window keeps nothing playing and costs no CPU.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private applyGains(immediate = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [bus, node] of this.buses) {
      const value = channelGain(this.preferences, bus);
      if (immediate) node.gain.value = value;
      else node.gain.setTargetAtTime(value, ctx.currentTime, 0.05);
    }
  }

  private syncMusic() {
    const ctx = this.ctx;
    if (!ctx || !this.reverb) return;
    const theme = channelGain(this.preferences, 'music') > 0 ? this.wantedTheme : null;
    if (this.music?.theme === theme) return;
    // Crossfade: the old loop fades for 3 s while the new one swells in.
    this.music?.handle.stop(3);
    this.music = theme ? { theme, handle: startMusic(ctx, this.buses.get('music')!, this.reverb, theme) } : null;
  }
}

export const audio = new AudioEngine();

export function playSound(id: SoundId) {
  audio.play(id);
}
