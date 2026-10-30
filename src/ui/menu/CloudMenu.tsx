import { useEffect, useRef, useState } from 'react';
import type { SaveSlotMeta } from '../../domain/session/slots.ts';
import type { CloudCampaignView } from '../../application/cloud/cloud-sync.ts';
import { activeCloudSettings, cloudBridge, openServerCampaign, type CloudConflict } from './cloud.ts';
import './cloud.css';

const dateTime = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** «Получаем мир с сервера…» while a slot waits for the cloud relay. */
export function CloudEntryBanner({ text }: { text: string }) {
  return (
    <div className="menu-modal cloud-entry" role="status" aria-live="polite" data-qa-cloud-entry="busy">
      <section className="menu-modal__card cloud-entry__card">
        <small>ОБЛАЧНЫЙ МИР</small>
        <h2>{text}</h2>
        <i className="cloud-entry__bar" aria-hidden="true"><i /></i>
        <p>Если сервер не ответит, игра откроет сохранение этого компьютера.</p>
      </section>
    </div>
  );
}

/** Local and server copies went different ways: the player chooses, nothing is overwritten silently. */
export function CloudConflictDialog({ slotName, conflict, onChoose, onCancel }: {
  slotName: string;
  conflict: CloudConflict;
  onChoose: (choice: 'server' | 'local') => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return (
    <div className="menu-modal" role="presentation" onMouseDown={onCancel}>
      <section className="menu-modal__card cloud-conflict" role="alertdialog" aria-modal="true" aria-label="Выбор копии кампании" onMouseDown={(event) => event.stopPropagation()} data-qa-cloud-conflict={conflict.reason}>
        <small>ОБЛАЧНЫЙ МИР · ДВЕ КОПИИ</small>
        <h2>Какую копию «{slotName}» продолжить?</h2>
        <p>{conflict.text}</p>
        <dl className="cloud-conflict__copies">
          <div>
            <dt>Этот компьютер</dt>
            <dd>{conflict.localSavedAt ? `сохранено ${dateTime(conflict.localSavedAt)}` : 'копии нет'}</dd>
          </div>
          <div>
            <dt>Сервер · ревизия {conflict.server.revision}</dt>
            <dd>
              выгружено {dateTime(conflict.server.savedAt)}
              <br />мир прожит до {dateTime(conflict.server.worldAt)}
              {conflict.server.liveSince ? <><br />живёт на сервере с {dateTime(conflict.server.liveSince)}</> : null}
            </dd>
          </div>
        </dl>
        <p className="cloud-conflict__note">Выбранная копия продолжится; другая не удаляется: копия компьютера останется отдельным слотом, серверная — в резервных копиях сервера.</p>
        <div className="menu-modal__actions">
          <button type="button" className="menu-btn menu-btn--primary" onClick={() => onChoose('server')} data-qa-cloud-choose="server">ВЗЯТЬ С СЕРВЕРА</button>
          <button type="button" className="menu-btn" onClick={() => onChoose('local')} data-qa-cloud-choose="local">ОСТАВИТЬ ЭТУ КОПИЮ</button>
          <button ref={cancelRef} type="button" className="menu-btn" onClick={onCancel} data-qa-cloud-choose="cancel">ОТМЕНА</button>
        </div>
      </section>
    </div>
  );
}

/** «Загрузить игру»: campaigns the server keeps that this computer does not have (another PC, a reinstall). */
export function ServerCampaigns({ localIds, onOpened }: { localIds: readonly string[]; onOpened: (slot: SaveSlotMeta) => void }) {
  const [state, setState] = useState<{ status: 'off' } | { status: 'loading' } | { status: 'error'; text: string } | { status: 'ok'; campaigns: CloudCampaignView[] }>({ status: 'off' });
  const [busy, setBusy] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void activeCloudSettings().then(async (settings) => {
      const bridge = cloudBridge();
      if (!alive || !settings || !bridge) return;
      setState({ status: 'loading' });
      const result = await bridge.server();
      if (!alive) return;
      setState(result.ok ? { status: 'ok', campaigns: result.campaigns } : { status: 'error', text: result.error });
    });
    return () => { alive = false; };
  }, []);
  if (state.status === 'off') return null;
  const remote = state.status === 'ok' ? state.campaigns.filter((campaign) => campaign.head && !localIds.includes(campaign.id)) : [];
  const open = async (campaign: CloudCampaignView) => {
    setError(null);
    setBusy({ id: campaign.id, text: 'Получаем кампанию с сервера…' });
    const result = await openServerCampaign(campaign, (text) => setBusy({ id: campaign.id, text }));
    setBusy(null);
    if (result.ok) onOpened(result.slot);
    else setError(result.error);
  };
  return (
    <section className="cloud-remote" aria-label="Кампании на сервере" data-qa-cloud-remote={state.status}>
      <h2>НА СЕРВЕРЕ</h2>
      {state.status === 'loading' ? <p className="cloud-remote__hint">Спрашиваем сервер…</p> : null}
      {state.status === 'error' ? <p className="menu-message menu-message--error" role="status">Сервер недоступен: {state.text}</p> : null}
      {error ? <p className="menu-message menu-message--error" role="status">{error}</p> : null}
      {state.status === 'ok' && !remote.length ? <p className="cloud-remote__hint">Все кампании сервера уже есть на этом компьютере.</p> : null}
      {remote.length ? (
        <ul>
          {remote.map((campaign) => (
            <li key={campaign.id} data-qa-cloud-remote-campaign={campaign.id}>
              <div>
                <b>{campaign.name}</b>
                <span>ревизия {campaign.head!.revision} · выгружено {dateTime(campaign.head!.savedAt)}{campaign.live ? ` · мир живёт на сервере, прожит до ${dateTime(campaign.live.worldAt)}` : ''}</span>
              </div>
              <button type="button" className="menu-btn menu-btn--primary" disabled={busy !== null} onClick={() => void open(campaign)} data-qa-cloud-remote-open={campaign.id}>
                {busy?.id === campaign.id ? busy.text : 'ЗАГРУЗИТЬ С СЕРВЕРА'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
