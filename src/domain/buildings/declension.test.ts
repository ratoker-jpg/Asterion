import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toAccusative } from './declension.ts';

test('feminine building names take the accusative case', () => {
  assert.equal(toAccusative('Фабрика'), 'Фабрику');
  assert.equal(toAccusative('Металлическая шахта III'), 'Металлическую шахту III');
  assert.equal(toAccusative('Газовая скважина I'), 'Газовую скважину I');
  assert.equal(toAccusative('Солнечная электростанция'), 'Солнечную электростанцию');
  assert.equal(toAccusative('Лаборатория'), 'Лабораторию');
  assert.equal(toAccusative('Палата управления'), 'Палату управления');
  assert.equal(toAccusative('Газовая железа II'), 'Газовую железу II');
  assert.equal(toAccusative('Ресурсная зона'), 'Ресурсную зону');
  assert.equal(toAccusative('РЕСУРСНАЯ ЗОНА'), 'РЕСУРСНУЮ ЗОНУ');
});

test('masculine, neuter and soft feminine names stay as they are', () => {
  for (const name of ['Верфь', 'Энергосеть', 'Склад металла', 'Ядерный реактор', 'Газовое хранилище', 'Звёздное гнездо', 'Боевой инкубатор', 'Минеральный нарост I', 'Ангар']) {
    assert.equal(toAccusative(name), name);
  }
});
