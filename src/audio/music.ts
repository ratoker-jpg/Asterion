/**
 * Generative ambient score (the fallback when a recorded track cannot play). No loop file: a slow chord pad (two detuned voices
 * per note, 3–4 s swells) under a breathing low-pass, a sub drone on the root
 * and sparse crystal bells through a feedback delay. Chord order and bell
 * notes are drawn anew every cycle, so the score never repeats exactly.
 *
 * Levels follow the game-audio mixing guide: pad ≈ 0.03 per voice, bells ≈
 * 0.02 — the music bus is the quietest layer in the game.
 */

export type MusicTheme = 'menu' | 'game';
export type MusicHandle = {
  stop: (fadeSeconds: number) => void;
  /** Hidden window: stop decoding a streamed track (the synthesised score needs nothing). */
  pause?: () => void;
  resume?: () => void;
};

/** Level of a recorded track (mastered at about −20 LUFS) on the music bus. */
const TRACK_LEVEL = 0.8;

/**
 * A recorded score, streamed by an <audio> element into the music bus (a
 * decoded 3–4 min track would hold 60+ MB of samples). Swells in over 3 s,
 * loops, and calls `onFail` if the file cannot play so the engine can fall
 * back to the synthesised score.
 */
export function startTrack(ctx: AudioContext, out: AudioNode, url: string, onFail: () => void): MusicHandle {
  const element = new Audio(url);
  element.loop = true;
  element.preload = 'auto';
  const source = ctx.createMediaElementSource(element);
  const level = ctx.createGain();
  const begin = ctx.currentTime;
  level.gain.setValueAtTime(0.0001, begin);
  level.gain.exponentialRampToValueAtTime(TRACK_LEVEL, begin + 3);
  source.connect(level).connect(out);
  let stopped = false;
  const fail = () => { if (!stopped) onFail(); };
  element.addEventListener('error', fail, { once: true });
  element.play().catch(fail);
  return {
    stop(fadeSeconds) {
      stopped = true;
      const at = ctx.currentTime;
      level.gain.cancelScheduledValues(at);
      level.gain.setValueAtTime(Math.max(0.0001, level.gain.value), at);
      level.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.05, fadeSeconds));
      window.setTimeout(() => {
        element.pause();
        element.removeAttribute('src');
        element.load();
        source.disconnect();
        level.disconnect();
      }, Math.max(0.05, fadeSeconds) * 1000 + 100);
    },
    pause: () => element.pause(),
    resume: () => { if (!stopped) element.play().catch(() => {}); },
  };
}

type ThemeSpec = {
  /** MIDI notes per chord; the first one is the root. */
  chords: number[][];
  /** Notes the bells may pick (an octave above the pad). */
  bells: number[];
  chordSeconds: number;
  /** Chance of a bell on each half-second step. */
  bellChance: number;
  cutoff: number;
  level: number;
};

const THEMES: Record<MusicTheme, ThemeSpec> = {
  // D dorian, open and hopeful: Dm9 · Bbmaj7 · Gm9 · A7sus4.
  menu: {
    chords: [[50, 57, 62, 64, 65], [46, 53, 58, 62, 69], [43, 50, 55, 57, 58], [45, 52, 57, 59, 62]],
    bells: [74, 76, 77, 81, 84, 86, 88],
    chordSeconds: 11,
    bellChance: 0.16,
    cutoff: 1250,
    level: 1.4,
  },
  // C aeolian, lower and darker for long sessions: Cm9 · Abmaj7 · Fm9 · Gsus4.
  game: {
    chords: [[48, 55, 60, 62, 63], [44, 51, 56, 60, 67], [41, 48, 53, 55, 56], [43, 50, 55, 60, 62]],
    bells: [72, 74, 75, 79, 82, 84],
    chordSeconds: 15,
    bellChance: 0.06,
    cutoff: 900,
    level: 1.2,
  },
};

const LOOKAHEAD_S = 0.6;
const STEP_S = 0.5;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;

export function startMusic(ctx: AudioContext, out: AudioNode, reverb: AudioNode, theme: MusicTheme): MusicHandle {
  const spec = THEMES[theme];
  const begin = ctx.currentTime + 0.05;

  // Theme output: swells in over 4 s, crossfades out on stop.
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, begin);
  level.gain.exponentialRampToValueAtTime(spec.level, begin + 4);
  level.connect(out);
  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  level.connect(wet).connect(reverb);

  // The pad breathes: a 0.04 Hz LFO sweeps the low-pass ±40 %.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = spec.cutoff;
  tone.Q.value = 0.6;
  tone.connect(level);
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  lfo.frequency.value = 0.04;
  lfoDepth.gain.value = spec.cutoff * 0.4;
  lfo.connect(lfoDepth).connect(tone.frequency);
  lfo.start(begin);

  // Bells ring through a dark feedback delay before the reverb.
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.48;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.38;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2400;
  delay.connect(damp).connect(feedback).connect(delay);
  damp.connect(level);

  const padNote = (midi: number, start: number, length: number, gain: number) => {
    const attack = Math.min(3.5, length * 0.35);
    const release = 4.5;
    const end = start + length + release;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + attack);
    env.gain.setValueAtTime(gain, start + length);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(tone);
    for (const [type, detune] of [['sine', -6], ['triangle', 6]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz(midi);
      osc.detune.value = detune;
      osc.connect(env);
      osc.start(start);
      osc.stop(end + 0.05);
    }
  };

  const bellNote = (midi: number, start: number) => {
    const end = start + 2.6;
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const depth = ctx.createGain();
    carrier.frequency.value = hz(midi);
    modulator.frequency.value = hz(midi) * 3.5;
    depth.gain.setValueAtTime(hz(midi) * 0.8, start);
    depth.gain.exponentialRampToValueAtTime(1, start + 1.2);
    modulator.connect(depth).connect(carrier.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.018 + Math.random() * 0.01, start + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    carrier.connect(env);
    env.connect(level);
    env.connect(delay);
    modulator.start(start);
    carrier.start(start);
    modulator.stop(end + 0.05);
    carrier.stop(end + 0.05);
  };

  let order = [...spec.chords];
  let chordIndex = 0;
  let nextChord = begin;
  let nextStep = begin + 2;

  const schedule = () => {
    const horizon = ctx.currentTime + LOOKAHEAD_S;
    while (nextChord < horizon) {
      if (chordIndex === 0) order = [...spec.chords].sort(() => Math.random() - 0.5);
      const chord = order[chordIndex]!;
      chordIndex = (chordIndex + 1) % order.length;
      padNote(chord[0]! - 12, nextChord, spec.chordSeconds, 0.05);
      // Three or four chord tones, a different voicing each time.
      for (const note of chord.slice(1).filter(() => Math.random() > 0.2)) {
        padNote(note, nextChord + Math.random() * 0.6, spec.chordSeconds, 0.026);
      }
      nextChord += spec.chordSeconds;
    }
    while (nextStep < horizon) {
      if (Math.random() < spec.bellChance) bellNote(pick(spec.bells), nextStep + Math.random() * 0.12);
      nextStep += STEP_S;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 200);

  return {
    stop(fadeSeconds) {
      window.clearInterval(timer);
      const at = ctx.currentTime;
      level.gain.cancelScheduledValues(at);
      level.gain.setValueAtTime(Math.max(0.0001, level.gain.value), at);
      level.gain.exponentialRampToValueAtTime(0.0001, at + fadeSeconds);
      window.setTimeout(() => {
        lfo.stop();
        level.disconnect();
        delay.disconnect();
        damp.disconnect();
      }, (fadeSeconds + 6) * 1000);
    },
  };
}
