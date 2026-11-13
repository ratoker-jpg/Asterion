#!/usr/bin/env node
'use strict';
// Слепое A/B для кадров «до/после» (см. SKILL.md рядом).
// Идея вердикта до раскрытия взята из gauntlet в studioigor-skill (MIT); код написан заново.
//
//   node ab.cjs <before> <after> --out <round>   перемешать в <round>/A, <round>/B + key.json
//   node ab.cjs --reveal <round>                 раскрыть ключ (нужен verdict.md)
//   node ab.cjs --self-check                     проверка на временных папках
//
// Только стандартная библиотека Node, работает на Windows, macOS и Linux.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

function coinFlip() {
  return crypto.randomInt(0, 2) === 1;
}

function listImages(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`нет папки: ${dir}`);
  }
  return fs.readdirSync(dir).filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase())).sort();
}

// Перемешивает пары. flip(i) -> true: «после» кладётся в A. Для тестов можно подставить свой.
function shuffle(beforeDir, afterDir, outDir, flip = coinFlip) {
  const before = listImages(beforeDir);
  const after = listImages(afterDir);
  if (before.length === 0) throw new Error('в папке «до» нет кадров');
  const onlyBefore = before.filter((f) => !after.includes(f));
  const onlyAfter = after.filter((f) => !before.includes(f));
  if (onlyBefore.length || onlyAfter.length) {
    throw new Error(
      `имена файлов в папках не совпадают. Только в «до»: ${onlyBefore.join(', ') || '-'}; ` +
        `только в «после»: ${onlyAfter.join(', ') || '-'}`
    );
  }
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new Error(`папка ${outDir} не пуста: возьми новую, старый ключ затирать нельзя`);
  }
  fs.mkdirSync(path.join(outDir, 'A'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'B'), { recursive: true });
  const pairs = [];
  before.forEach((name, i) => {
    const n = String(i + 1).padStart(2, '0');
    const ext = path.extname(name).toLowerCase();
    const afterInA = flip(i);
    const aSrc = path.join(afterInA ? afterDir : beforeDir, name);
    const bSrc = path.join(afterInA ? beforeDir : afterDir, name);
    fs.copyFileSync(aSrc, path.join(outDir, 'A', n + ext));
    fs.copyFileSync(bSrc, path.join(outDir, 'B', n + ext));
    pairs.push({ n: n + ext, source: name, A: afterInA ? 'after' : 'before', B: afterInA ? 'before' : 'after' });
  });
  fs.writeFileSync(path.join(outDir, 'key.json'), JSON.stringify({ pairs }, null, 2) + '\n');
  return pairs.length;
}

const CRITERION = /^[ \t]*(?:\*\*)?КРИТЕРИЙ[ \t]+(.+?):[ \t]*(A|B|ничья)\b/gimu;
const GAP = /^[ \t]*(?:\*\*)?ГЛАВНЫЙ[ \t]+РАЗРЫВ(?:\*\*)?:[ \t]*(\S.*?)[ \t]*$/gimu;

function parseVerdict(text) {
  const criteria = [...text.matchAll(CRITERION)].map((m) => ({ name: m[1].trim(), pick: m[2].toUpperCase() === 'НИЧЬЯ' ? 'TIE' : m[2].toUpperCase() }));
  const gaps = [...text.matchAll(GAP)].map((m) => m[1]);
  return { criteria, gaps };
}

// Раскрывает ключ. Возвращает {lines, tally}; бросает ошибку, если вердикт не готов.
function reveal(roundDir) {
  const verdictPath = path.join(roundDir, 'verdict.md');
  const keyPath = path.join(roundDir, 'key.json');
  if (!fs.existsSync(keyPath)) throw new Error(`нет ${keyPath}: сначала перемешать кадры`);
  if (!fs.existsSync(verdictPath)) throw new Error('нет verdict.md: сначала вердикт, потом ключ');
  const { criteria, gaps } = parseVerdict(fs.readFileSync(verdictPath, 'utf8'));
  if (criteria.length === 0) {
    throw new Error('в verdict.md нет строк вида «КРИТЕРИЙ <название>: A|B|ничья — почему»');
  }
  if (gaps.length !== 1) {
    throw new Error('нужна ровно одна строка «ГЛАВНЫЙ РАЗРЫВ: ...», а не список');
  }
  const { pairs } = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  // Сторона определяется по каждому кадру; в одиночных критериях без номера берём общую картину:
  // считаем, сколько кадров из A оказались «после».
  const afterInA = pairs.filter((p) => p.A === 'after').length;
  const lines = [];
  lines.push(`Ключ по кадрам: «после» в A у ${afterInA} из ${pairs.length}, в B у ${pairs.length - afterInA}.`);
  for (const p of pairs) lines.push(`  ${p.n} (${p.source}): A = ${p.A === 'before' ? 'до' : 'после'}, B = ${p.B === 'before' ? 'до' : 'после'}`);
  const tally = { before: 0, after: 0, tie: 0, mixed: 0 };
  if (pairs.length === 1 || afterInA === 0 || afterInA === pairs.length) {
    // стороны единые для всех кадров: можно честно перевести каждый критерий
    const afterSide = pairs[0].A === 'after' ? 'A' : 'B';
    for (const c of criteria) {
      const res = c.pick === 'TIE' ? 'ничья' : c.pick === afterSide ? 'после' : 'до';
      if (c.pick === 'TIE') tally.tie++;
      else if (c.pick === afterSide) tally.after++;
      else tally.before++;
      lines.push(`Критерий «${c.name}»: выбрано ${c.pick}, значит ${res}`);
    }
  } else {
    tally.mixed = criteria.length;
    lines.push('Стороны в парах разные: критерии со словом A/B относятся к конкретной паре, сверь по списку выше.');
  }
  lines.push(`Главный разрыв: ${gaps[0]}`);
  if (tally.after > 0) {
    lines.push('Проверка узнавания: ты сам делал сторону «после». Перечитай критерий; если причину не подтвердить кадром, засчитай «до».');
  }
  fs.appendFileSync(verdictPath, '\n## Раскрытие\n' + lines.map((l) => '- ' + l.trim()).join('\n') + '\n');
  return { lines, tally };
}

function selfCheck() {
  const assert = require('assert');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-ab-'));
  try {
    const before = path.join(root, 'before');
    const after = path.join(root, 'after');
    fs.mkdirSync(before);
    fs.mkdirSync(after);
    for (const n of ['menu.png', 'wizard.png', 'planet.png']) {
      fs.writeFileSync(path.join(before, n), 'before:' + n);
      fs.writeFileSync(path.join(after, n), 'after:' + n);
    }
    // 1. перемешивание: ключ сходится с содержимым файлов
    const out = path.join(root, 'round');
    assert.strictEqual(shuffle(before, after, out), 3);
    const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
    for (const p of key.pairs) {
      const a = fs.readFileSync(path.join(out, 'A', p.n), 'utf8');
      const b = fs.readFileSync(path.join(out, 'B', p.n), 'utf8');
      assert.ok(a.startsWith(p.A === 'after' ? 'after:' : 'before:'), 'A не совпадает с ключом');
      assert.ok(b.startsWith(p.B === 'after' ? 'after:' : 'before:'), 'B не совпадает с ключом');
      assert.notStrictEqual(p.A, p.B);
    }
    // 2. раскрытие без вердикта отказывает
    assert.throws(() => reveal(out), /verdict\.md/);
    // 3. плохой вердикт (нет разрыва, два разрыва) отказывает
    const vp = path.join(out, 'verdict.md');
    fs.writeFileSync(vp, 'КРИТЕРИЙ читаемость: A — крупнее\n');
    assert.throws(() => reveal(out), /РАЗРЫВ/);
    fs.writeFileSync(vp, 'КРИТЕРИЙ читаемость: A\nГЛАВНЫЙ РАЗРЫВ: один\nГЛАВНЫЙ РАЗРЫВ: два\n');
    assert.throws(() => reveal(out), /РАЗРЫВ/);
    // 4. хороший вердикт: ключ раскрывается и дописывается в verdict.md
    fs.writeFileSync(vp, 'КРИТЕРИЙ читаемость: A — крупнее\nКРИТЕРИЙ иерархия: ничья\nГЛАВНЫЙ РАЗРЫВ: кнопка не видна\n');
    const res = reveal(out);
    assert.ok(res.lines.length > 3);
    assert.ok(fs.readFileSync(vp, 'utf8').includes('## Раскрытие'));
    // 5. единые стороны: A всегда «после», вердикт A = победа «после»
    const out2 = path.join(root, 'round2');
    shuffle(before, after, out2, () => true);
    fs.writeFileSync(path.join(out2, 'verdict.md'), 'КРИТЕРИЙ читаемость: A\nКРИТЕРИЙ стиль: B\nГЛАВНЫЙ РАЗРЫВ: x\n');
    const r2 = reveal(out2);
    assert.deepStrictEqual([r2.tally.after, r2.tally.before], [1, 1]);
    // 6. несовпадающие имена и непустая папка отказывают
    fs.writeFileSync(path.join(after, 'extra.png'), 'x');
    assert.throws(() => shuffle(before, after, path.join(root, 'round3')), /не совпадают/);
    assert.throws(() => shuffle(before, after, out), /не пуста|не совпадают/);
    console.log('ab.cjs self-check: OK');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main(argv) {
  if (argv.includes('--self-check')) return selfCheck();
  const ri = argv.indexOf('--reveal');
  if (ri !== -1) {
    const dir = argv[ri + 1];
    if (!dir) throw new Error('usage: ab.cjs --reveal <round>');
    const { lines } = reveal(dir);
    console.log(lines.join('\n'));
    return;
  }
  const oi = argv.indexOf('--out');
  const rest = argv.filter((_, i) => i !== oi && i !== oi + 1);
  if (oi === -1 || !argv[oi + 1] || rest.length !== 2) {
    throw new Error('usage: ab.cjs <before> <after> --out <round> | --reveal <round> | --self-check');
  }
  const n = shuffle(rest[0], rest[1], argv[oi + 1]);
  console.log(`Готово: ${n} пар в ${path.join(argv[oi + 1], 'A')} и ${path.join(argv[oi + 1], 'B')}.`);
  console.log('Ключ в key.json не открывать. Сначала напиши verdict.md, потом: node ab.cjs --reveal ' + argv[oi + 1]);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error('ошибка: ' + e.message);
    process.exit(1);
  }
}

module.exports = { shuffle, reveal, parseVerdict };
