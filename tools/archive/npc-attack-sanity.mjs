// NPC attack sanity (owner report 04.11.2026): reads bot journals (bot-lab `bots-journal.jsonl`, or an owner's
// `*.bots.jsonl` next to a save) and tells how many attacks were lost and what they cost against what they brought.
//
//   node tools/npc-attack-sanity.mjs JOURNAL.jsonl [JOURNAL2.jsonl ...]   (one line of numbers per journal, JSON on stdout)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summarizeAttacks(lines) {
  const entries = lines.filter(Boolean).map((line) => JSON.parse(line));
  const battles = entries.filter((entry) => entry.k === 'battle' && entry.d?.side === 'attacker' && entry.d?.m === 'attack');
  const won = battles.filter((entry) => entry.d.won === 1);
  const lost = battles.filter((entry) => entry.d.won !== 1);
  const sum = (list, key) => list.reduce((total, entry) => total + (Number(entry.d[key]) || 0), 0);
  const gained = sum(battles, 'gain');
  const spent = sum(battles, 'loss');
  return {
    attacksDecided: entries.filter((entry) => entry.k === 'attack' && entry.ok === 1).length,
    spyDecided: entries.filter((entry) => entry.k === 'recon' && entry.ok === 1 && /:espionage:/.test(entry.c ?? '')).length,
    battles: battles.length, won: won.length, lost: lost.length,
    lostShare: battles.length ? +(lost.length / battles.length).toFixed(3) : 0,
    valueGained: Math.round(gained), valueLost: Math.round(spent), net: Math.round(gained - spent),
    lostValue: Math.round(sum(lost, 'loss')), damageDealt: Math.round(sum(battles, 'hit')),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of process.argv.slice(2)) {
    console.log(JSON.stringify({ file, ...summarizeAttacks(fs.readFileSync(file, 'utf8').split(String.fromCharCode(10))) }));
  }
}
