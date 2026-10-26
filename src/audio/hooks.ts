import { useEffect, useRef, useSyncExternalStore } from 'react';
import { audio, playSound } from './engine.ts';
import type { MusicTheme } from './music.ts';
import type { SoundId } from './sounds.ts';

/** Keeps the background score of a screen tree playing while it is mounted. */
export function useMusic(theme: MusicTheme) {
  useEffect(() => {
    audio.setMusic(theme);
    return () => audio.setMusic(null);
  }, [theme]);
}

/** Plays `sound` whenever `count` grows (never on mount: a loaded save is not news). */
export function useSoundOnIncrease(count: number, sound: SoundId) {
  const previous = useRef(count);
  useEffect(() => {
    if (count > previous.current) playSound(sound);
    previous.current = count;
  }, [count, sound]);
}

export function useAudioPreferences() {
  return useSyncExternalStore(
    (listener) => audio.subscribe(listener),
    () => audio.getPreferences(),
  );
}
