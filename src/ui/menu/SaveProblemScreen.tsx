import { useState, type ReactNode } from 'react';
import { getBrowserSaveStorage } from '../../application/save-storage.ts';
import { createPersistenceFacade, loadSavedState, SAVE_SCHEMA_VERSION } from '../../application/persistence.ts';
import { describeSaveProblem, type SaveProblem } from '../../domain/session/save-health.ts';
import './menu.css';

function downloadRaw(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Test Mode opens straight into the game, so its save is checked here: an
 * unreadable save is shown instead of being replaced by fresh fixtures, and
 * is only discarded when the player confirms it.
 */
export function TestSaveGuard({ children }: { children: ReactNode }) {
  const [problem, setProblem] = useState<SaveProblem | null>(() => {
    const loaded = loadSavedState({ mode: 'test' });
    return 'problem' in loaded ? loaded.problem : null;
  });
  const [confirming, setConfirming] = useState(false);
  if (!problem) return <>{children}</>;
  const facade = createPersistenceFacade({ mode: 'test' });
  const exportRaw = () => {
    let raw: string | null = null;
    try { raw = getBrowserSaveStorage()?.getItem(facade.saveKey) ?? null; } catch { raw = null; }
    if (raw !== null) downloadRaw(`asterion-test-save-${new Date().toISOString().slice(0, 10)}.json`, raw);
  };
  return (
    <div className="menu-viewport" data-qa-save-problem={problem.status}>
      <div className="menu-modal" role="presentation">
        <section className="menu-modal__card" role="alertdialog" aria-modal="true" aria-label="Сохранение не загружено">
          <small>СОХРАНЕНИЕ НЕ ЗАГРУЖЕНО</small>
          <h2>Тестовая кампания не открыта</h2>
          <p>{describeSaveProblem(problem, SAVE_SCHEMA_VERSION)} Данные не изменены: сначала можно экспортировать их в файл.</p>
          <div className="menu-modal__actions">
            <button type="button" className="menu-btn menu-btn--primary" onClick={exportRaw} data-qa-save-problem-export>ЭКСПОРТ В ФАЙЛ</button>
            {confirming ? (
              <button
                type="button"
                className="menu-btn menu-btn--danger"
                onClick={() => { facade.clear(); setProblem(null); }}
                data-qa-save-problem-reset-confirm
              >
                ТОЧНО УДАЛИТЬ И НАЧАТЬ ЗАНОВО
              </button>
            ) : (
              <button type="button" className="menu-btn menu-btn--danger" onClick={() => setConfirming(true)} data-qa-save-problem-reset>НАЧАТЬ ЗАНОВО</button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
