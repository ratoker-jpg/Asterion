import type { AudioBus, SoundKit } from './engine.ts';

/**
 * The Asterion sound palette: cold glass and low hull resonance. Every voice is
 * a short synthesised envelope (attack → exponential decay to 0.001, stop with
 * 10 ms padding), so nothing clicks and nothing lingers. Levels follow the
 * ui-sound-design bounds: hover 0.03–0.06, clicks ≤ 0.2, events ≤ 0.25.
 */

type Wave = OscillatorType;
type FilterSpec = { type: BiquadFilterType; freq: number; to?: number; q?: number };

type VoiceSpec = {
  type?: Wave;
  freq: number;
  to?: number;
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  detune?: number;
  filter?: FilterSpec;
  reverb?: number;
};

type NoiseSpec = {
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  filter: FilterSpec;
  reverb?: number;
};

type BellSpec = { freq: number; at?: number; dur: number; gain: number; ratio?: number; depth?: number; reverb?: number };

function shapeFilter(kit: SoundKit, spec: FilterSpec, start: number, end: number) {
  const filter = kit.ctx.createBiquadFilter();
  filter.type = spec.type;
  filter.Q.value = spec.q ?? 1;
  filter.frequency.setValueAtTime(spec.freq, start);
  if (spec.to) filter.frequency.exponentialRampToValueAtTime(spec.to, end);
  return filter;
}

function envelope(kit: SoundKit, start: number, attack: number, end: number, peak: number) {
  const gain = kit.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  return gain;
}

function send(kit: SoundKit, node: AudioNode, amount = 0) {
  node.connect(kit.out);
  if (amount > 0) {
    const wet = kit.ctx.createGain();
    wet.gain.value = amount;
    node.connect(wet).connect(kit.reverb);
  }
}

function voice(kit: SoundKit, spec: VoiceSpec) {
  const start = kit.now + (spec.at ?? 0);
  const end = start + spec.dur;
  const osc = kit.ctx.createOscillator();
  osc.type = spec.type ?? 'sine';
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.to) osc.frequency.exponentialRampToValueAtTime(spec.to, end);
  if (spec.detune) osc.detune.value = spec.detune;
  const gain = envelope(kit, start, spec.attack ?? 0.003, end, spec.gain);
  if (spec.filter) osc.connect(shapeFilter(kit, spec.filter, start, end)).connect(gain);
  else osc.connect(gain);
  send(kit, gain, spec.reverb);
  osc.start(start);
  osc.stop(end + 0.01);
}

function noise(kit: SoundKit, spec: NoiseSpec) {
  const start = kit.now + (spec.at ?? 0);
  const end = start + spec.dur;
  const source = kit.ctx.createBufferSource();
  source.buffer = kit.noise;
  const filter = shapeFilter(kit, spec.filter, start, end);
  const gain = envelope(kit, start, spec.attack ?? 0.002, end, spec.gain);
  source.connect(filter).connect(gain);
  send(kit, gain, spec.reverb);
  // A random window of the shared 2 s buffer: no two bursts are identical.
  source.start(start, Math.random() * Math.max(0, kit.noise.duration - spec.dur - 0.05));
  source.stop(end + 0.01);
  source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
}

/** FM bell: a sine carrier modulated at a non-integer ratio rings like glass or metal. */
function bell(kit: SoundKit, spec: BellSpec) {
  const start = kit.now + (spec.at ?? 0);
  const end = start + spec.dur;
  const carrier = kit.ctx.createOscillator();
  const modulator = kit.ctx.createOscillator();
  const depth = kit.ctx.createGain();
  carrier.frequency.value = spec.freq;
  modulator.frequency.value = spec.freq * (spec.ratio ?? 1.4);
  depth.gain.setValueAtTime(spec.depth ?? spec.freq * 1.2, start);
  depth.gain.exponentialRampToValueAtTime(1, start + spec.dur * 0.7);
  modulator.connect(depth).connect(carrier.frequency);
  const gain = envelope(kit, start, 0.004, end, spec.gain);
  carrier.connect(gain);
  send(kit, gain, spec.reverb);
  modulator.start(start);
  carrier.start(start);
  modulator.stop(end + 0.01);
  carrier.stop(end + 0.01);
}

type Sound = { bus: AudioBus; play: (kit: SoundKit) => void };

export const SOUNDS = {
  /** Pointer enters a header tab, map object or menu control: a breath of glass. */
  hover: {
    bus: 'interface',
    play: (k) => voice(k, { freq: 3150, to: 3400, dur: 0.05, gain: 0.03, attack: 0.006 }),
  },
  /** Pointer enters a large card (menu items, race cards, save slots): airy shimmer. */
  hoverCard: {
    bus: 'interface',
    play: (k) => {
      noise(k, { dur: 0.2, gain: 0.045, attack: 0.06, filter: { type: 'bandpass', freq: 900, to: 2800, q: 1.4 } });
      voice(k, { freq: 1318, dur: 0.18, gain: 0.012, attack: 0.02, reverb: 0.4 });
    },
  },
  click: {
    bus: 'interface',
    play: (k) => {
      noise(k, { dur: 0.024, gain: 0.14, filter: { type: 'bandpass', freq: 3200, q: 3 } });
      voice(k, { type: 'triangle', freq: 1250, to: 820, dur: 0.05, gain: 0.06 });
    },
  },
  /** Tabs, section menus and segmented filters. */
  tab: {
    bus: 'interface',
    play: (k) => {
      voice(k, { freq: 1480, to: 1720, dur: 0.06, gain: 0.055 });
      noise(k, { dur: 0.018, gain: 0.05, filter: { type: 'highpass', freq: 4200 } });
    },
  },
  /** A primary action (build, research, dispatch, next step): rising fifth with a body. */
  confirm: {
    bus: 'interface',
    play: (k) => {
      voice(k, { type: 'triangle', freq: 587, dur: 0.1, gain: 0.1 });
      voice(k, { type: 'triangle', freq: 880, at: 0.065, dur: 0.2, gain: 0.1, reverb: 0.25 });
      voice(k, { freq: 147, dur: 0.14, gain: 0.1 });
      noise(k, { dur: 0.03, gain: 0.05, filter: { type: 'bandpass', freq: 5200, q: 2 } });
    },
  },
  back: {
    bus: 'interface',
    play: (k) => {
      voice(k, { freq: 760, to: 470, dur: 0.12, gain: 0.08 });
      noise(k, { dur: 0.02, gain: 0.08, filter: { type: 'bandpass', freq: 2400, q: 2 } });
    },
  },
  /** Delete, danger and other heavy actions: a low hull thump. */
  heavy: {
    bus: 'interface',
    play: (k) => {
      voice(k, { freq: 170, to: 90, dur: 0.16, gain: 0.16 });
      noise(k, { dur: 0.06, gain: 0.07, filter: { type: 'lowpass', freq: 900 } });
    },
  },
  toggleOn: {
    bus: 'interface',
    play: (k) => voice(k, { freq: 520, to: 780, dur: 0.1, gain: 0.08 }),
  },
  toggleOff: {
    bus: 'interface',
    play: (k) => voice(k, { freq: 780, to: 520, dur: 0.1, gain: 0.07 }),
  },
  /** Slider drag: a dry tick per step. */
  tick: {
    bus: 'interface',
    play: (k) => voice(k, { freq: 2300, dur: 0.016, gain: 0.025, attack: 0.001 }),
  },
  /** A dialog or panel appears. */
  open: {
    bus: 'effects',
    play: (k) => {
      noise(k, { dur: 0.26, gain: 0.06, attack: 0.09, filter: { type: 'bandpass', freq: 380, to: 2600, q: 0.9 }, reverb: 0.2 });
      voice(k, { freq: 220, to: 440, dur: 0.22, gain: 0.04, attack: 0.04 });
    },
  },
  close: {
    bus: 'effects',
    play: (k) => {
      noise(k, { dur: 0.18, gain: 0.04, attack: 0.03, filter: { type: 'bandpass', freq: 2200, to: 420, q: 0.9 } });
      voice(k, { freq: 440, to: 250, dur: 0.16, gain: 0.03 });
    },
  },
  /** A new screen (route, zone, building interior): low swell and a far glint. */
  screen: {
    bus: 'effects',
    play: (k) => {
      noise(k, { dur: 0.36, gain: 0.06, attack: 0.12, filter: { type: 'lowpass', freq: 300, to: 1700, q: 0.7 }, reverb: 0.3 });
      voice(k, { freq: 96, to: 72, dur: 0.32, gain: 0.11, attack: 0.03 });
      voice(k, { freq: 1760, at: 0.09, dur: 0.3, gain: 0.012, reverb: 0.6 });
    },
  },
  /** Neutral toast: a single glass note. */
  info: {
    bus: 'effects',
    play: (k) => bell(k, { freq: 1318, dur: 0.4, gain: 0.03, ratio: 2, reverb: 0.35 }),
  },
  /** Something completed: a bright three-note arpeggio. */
  success: {
    bus: 'effects',
    play: (k) => {
      bell(k, { freq: 784, dur: 0.5, gain: 0.05, ratio: 2, reverb: 0.4 });
      bell(k, { freq: 988, at: 0.09, dur: 0.5, gain: 0.05, ratio: 2, reverb: 0.4 });
      bell(k, { freq: 1175, at: 0.18, dur: 0.7, gain: 0.05, ratio: 2, reverb: 0.5 });
    },
  },
  error: {
    bus: 'effects',
    play: (k) => {
      voice(k, { type: 'sawtooth', freq: 196, to: 165, dur: 0.14, gain: 0.07, filter: { type: 'lowpass', freq: 900 } });
      voice(k, { type: 'sawtooth', freq: 165, to: 139, at: 0.16, dur: 0.18, gain: 0.07, filter: { type: 'lowpass', freq: 800 } });
      noise(k, { dur: 0.08, gain: 0.04, filter: { type: 'lowpass', freq: 300 } });
    },
  },
  /** A new message or report. */
  notify: {
    bus: 'effects',
    play: (k) => {
      bell(k, { freq: 1046, dur: 0.6, gain: 0.06, reverb: 0.4 });
      bell(k, { freq: 1568, at: 0.12, dur: 0.75, gain: 0.045, reverb: 0.5 });
    },
  },
  /** Incoming attack: a two-tone alert, twice. */
  alarm: {
    bus: 'effects',
    play: (k) => {
      for (const offset of [0, 0.42]) {
        voice(k, { type: 'triangle', freq: 740, at: offset, dur: 0.14, gain: 0.09, filter: { type: 'lowpass', freq: 2400 } });
        voice(k, { type: 'triangle', freq: 554, at: offset + 0.17, dur: 0.18, gain: 0.09, filter: { type: 'lowpass', freq: 2400 } });
      }
    },
  },
  /** A decisive choice (race, campaign card): impact and a long crystal ring. */
  select: {
    bus: 'effects',
    play: (k) => {
      voice(k, { freq: 98, to: 49, dur: 0.6, gain: 0.2, attack: 0.004 });
      noise(k, { dur: 0.42, gain: 0.1, filter: { type: 'lowpass', freq: 1800, to: 180 } });
      bell(k, { freq: 1318, at: 0.03, dur: 1.2, gain: 0.045, ratio: 3.5, reverb: 0.6 });
      bell(k, { freq: 1976, at: 0.11, dur: 1, gain: 0.03, ratio: 3.5, reverb: 0.6 });
    },
  },
  /** Entering a campaign: a riser into a deep landing. */
  launch: {
    bus: 'effects',
    play: (k) => {
      noise(k, { dur: 1.1, gain: 0.09, attack: 0.9, filter: { type: 'bandpass', freq: 200, to: 5200, q: 1.5 } });
      voice(k, { freq: 55, to: 110, dur: 1.1, gain: 0.12, attack: 0.6 });
      voice(k, { freq: 82, to: 41, at: 1.02, dur: 0.9, gain: 0.24 });
      noise(k, { at: 1.02, dur: 0.8, gain: 0.13, filter: { type: 'lowpass', freq: 2200, to: 110 }, reverb: 0.5 });
      bell(k, { freq: 659, at: 1.04, dur: 1.8, gain: 0.045, ratio: 2, reverb: 0.7 });
    },
  },
} satisfies Record<string, Sound>;

export type SoundId = keyof typeof SOUNDS;
