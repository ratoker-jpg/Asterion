import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';

import { COMMANDER_ABILITIES, type CommanderId } from './domain/combat/commanders.ts';
import { COMMANDER_COMBAT_CATALOG } from './domain/combat/catalog.ts';
import {
  moveCommanderBefore,
  moveCommanderByOffset,
  moveCommanderToEnd,
  persistCombatPriority,
  readCombatPriority,
  type CombatPriorityState,
} from './domain/combat/priority.ts';
import './fleet-combat-priority.css';
import './fleet-combat-priority-scroll.css';

type PrioritySide = keyof CombatPriorityState;
type SaveState = { kind: 'saved'; message: string } | { kind: 'error'; message: string };

type DragState = {
  side: PrioritySide;
  commanderId: CommanderId;
} | null;

const commanderById = new Map(COMMANDER_COMBAT_CATALOG.map((commander) => [commander.id, commander]));
const WORKSPACE_TOP = 246;
const WORKSPACE_BOTTOM_GAP = 58;
const FLEET_VERTICAL_PADDING = 52;

function PriorityList({
  side,
  title,
  order,
  dragState,
  onDragState,
  onReorder,
}: {
  side: PrioritySide;
  title: string;
  order: readonly CommanderId[];
  dragState: DragState;
  onDragState: (value: DragState) => void;
  onReorder: (side: PrioritySide, nextOrder: CommanderId[]) => void;
}) {
  const moveByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, commanderId: CommanderId) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const offset = event.key === 'ArrowUp' ? -1 : 1;
    onReorder(side, moveCommanderByOffset(order, commanderId, offset));
  };

  const startDrag = (event: DragEvent<HTMLElement>, commanderId: CommanderId) => {
    onDragState({ side, commanderId });
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', commanderId);
  };

  const dropBefore = (event: DragEvent<HTMLElement>, beforeCommanderId: CommanderId) => {
    event.preventDefault();
    event.stopPropagation();
    if (!dragState || dragState.side !== side) return;
    onReorder(side, moveCommanderBefore(order, dragState.commanderId, beforeCommanderId));
    onDragState(null);
  };

  const dropAtEnd = (event: DragEvent<HTMLOListElement>) => {
    event.preventDefault();
    if (!dragState || dragState.side !== side) return;
    onReorder(side, moveCommanderToEnd(order, dragState.commanderId));
    onDragState(null);
  };

  return (
    <section className="combat-priority-column-v1" aria-label={`Приоритет: ${title}`}>
      <header className="combat-priority-column-head-v1">
        <span>{side === 'defense' ? '◆' : '◇'}</span>
        <div><small>ПОРЯДОК СПОСОБНОСТЕЙ</small><h3>{title}</h3></div>
        <b>{order.length}</b>
      </header>

      <ol
        className="combat-priority-list-v1"
        onDragOver={(event) => {
          if (dragState?.side !== side) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={dropAtEnd}
      >
        {order.map((commanderId, index) => {
          const commander = commanderById.get(commanderId);
          const ability = COMMANDER_ABILITIES[commanderId];
          if (!commander) return null;

          return (
            <li
              key={commanderId}
              className={dragState?.side === side && dragState.commanderId === commanderId ? 'dragging' : ''}
              draggable
              onDragStart={(event) => startDrag(event, commanderId)}
              onDragEnd={() => onDragState(null)}
              onDragOver={(event) => {
                if (dragState?.side !== side) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => dropBefore(event, commanderId)}
            >
              <button
                type="button"
                className="combat-priority-handle-v1"
                aria-label={`${commander.name}: переместить. Стрелка вверх или вниз меняет позицию.`}
                title="Перетащи или используй ↑ / ↓"
                onKeyDown={(event) => moveByKeyboard(event, commanderId)}
              >
                <span aria-hidden="true">⋮⋮</span>
              </button>

              <strong className="combat-priority-number-v1">{index + 1}</strong>
              <span className="combat-priority-art-v1"><img src={commander.art} alt="" draggable={false} /></span>
              <span className="combat-priority-name-v1"><strong>{commander.name}</strong><small>{ability.ability}</small></span>

              <span className="combat-priority-info-wrap-v1">
                <button type="button" className="combat-priority-info-v1" aria-label={`Способность ${commander.name}`}>i</button>
                <span className="combat-priority-tooltip-v1" role="tooltip">
                  <strong>{ability.ability}</strong>
                  <span>{ability.description}</span>
                  <b>{ability.ratePerLevel}</b>
                  {ability.note ? <small>{ability.note}</small> : null}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function FleetCombatPriorityView({
  planetName,
  coords,
  onBack,
}: {
  planetName: string;
  coords: string;
  onBack: () => void;
}) {
  const [priority, setPriority] = useState<CombatPriorityState>(() => readCombatPriority());
  const [dragState, setDragState] = useState<DragState>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved', message: '✓ Сохранено' });

  useEffect(() => {
    const root = document.documentElement;
    let resizeObserver: ResizeObserver | null = null;

    const syncPageGeometry = () => {
      const view = document.querySelector<HTMLElement>('.combat-priority-view-v1');
      if (!view) return;

      const contentHeight = Math.ceil(view.scrollHeight);
      const workspaceHeight = contentHeight + FLEET_VERTICAL_PADDING;
      const stageHeight = WORKSPACE_TOP + workspaceHeight + WORKSPACE_BOTTOM_GAP;
      const rawScale = Number.parseFloat(getComputedStyle(root).getPropertyValue('--web-stage-scale'));
      const previewScale = root.classList.contains('web-preview') && Number.isFinite(rawScale) ? rawScale : 1;

      root.style.setProperty('--combat-priority-workspace-height', `${workspaceHeight}px`);
      root.style.setProperty('--combat-priority-stage-height', `${stageHeight}px`);
      root.style.setProperty('--combat-priority-viewport-height', `${Math.ceil(stageHeight * previewScale)}px`);
    };

    const activateLongPage = () => {
      root.classList.add('asterion-long-page', 'asterion-combat-priority-page');
      syncPageGeometry();
    };

    activateLongPage();
    window.scrollTo(0, 0);

    // Re-apply after sibling page cleanup effects. This avoids losing scrolling when the user
    // switches directly from Ships / Defense / Commander Ships / Repair Workshop to Priority.
    const delayedActivation = window.setTimeout(activateLongPage, 0);
    const geometryFrame = window.requestAnimationFrame(() => {
      syncPageGeometry();
      const view = document.querySelector<HTMLElement>('.combat-priority-view-v1');
      if (view && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(syncPageGeometry);
        resizeObserver.observe(view);
      }
    });

    window.addEventListener('resize', syncPageGeometry);

    return () => {
      window.clearTimeout(delayedActivation);
      window.cancelAnimationFrame(geometryFrame);
      window.removeEventListener('resize', syncPageGeometry);
      resizeObserver?.disconnect();

      root.classList.remove('asterion-combat-priority-page');
      root.style.removeProperty('--combat-priority-workspace-height');
      root.style.removeProperty('--combat-priority-stage-height');
      root.style.removeProperty('--combat-priority-viewport-height');

      // Defer generic long-page cleanup so a destination section can claim it first.
      window.requestAnimationFrame(() => {
        const destinationNeedsLongPage = Boolean(document.querySelector('.shipyard-view-v1, .repair-workshop-v1, .combat-priority-view-v1'))
          || root.classList.contains('asterion-repair-page');
        if (!destinationNeedsLongPage) root.classList.remove('asterion-long-page');
      });
      window.scrollTo(0, 0);
    };
  }, []);

  const commanderCount = useMemo(() => new Set([...priority.attack, ...priority.defense]).size, [priority]);

  const reorder = (side: PrioritySide, nextOrder: CommanderId[]) => {
    const nextPriority = { ...priority, [side]: nextOrder };
    const result = persistCombatPriority(nextPriority);
    setPriority(result.value);
    setSaveState(result.ok
      ? { kind: 'saved', message: '✓ Сохранено' }
      : { kind: 'error', message: `⚠ Ошибка сохранения: ${result.error}` });
  };

  return (
    <section className="combat-priority-view-v1">
      <header className="combat-priority-page-head-v1">
        <div>
          <small>УПРАВЛЕНИЕ ФЛОТОМ · {planetName} {coords}</small>
          <h2>БОЕВОЙ ПРИОРИТЕТ</h2>
          <p>Если в бою участвует несколько командирских кораблей, используется способность первого доступного командира в списке.</p>
        </div>
        <div className="combat-priority-page-actions-v1">
          <span className={`combat-priority-save-v1 ${saveState.kind}`} role="status" aria-live="polite">{saveState.message}</span>
          <button className="combat-priority-back-v1" type="button" onClick={onBack}>← К ФЛОТАМ</button>
        </div>
      </header>

      <div className="combat-priority-rule-v1">
        <span>01</span>
        <p><strong>Два независимых порядка.</strong> Перестановка защитного приоритета не меняет атакующий и наоборот.</p>
        <b>{commanderCount} КОМАНДИРОВ</b>
      </div>

      <div className="combat-priority-grid-v1">
        <PriorityList
          side="defense"
          title="ЗАЩИЩАЮЩИЙСЯ"
          order={priority.defense}
          dragState={dragState}
          onDragState={setDragState}
          onReorder={reorder}
        />
        <PriorityList
          side="attack"
          title="АТАКУЮЩИЙ"
          order={priority.attack}
          dragState={dragState}
          onDragState={setDragState}
          onReorder={reorder}
        />
      </div>
    </section>
  );
}
