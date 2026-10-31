import { useEffect, useRef, useState } from 'react';
import type { SaveSlotMeta } from '../../domain/session/slots.ts';
import { compareGameVersions, SERVER_CATCHUP_WAIT_LAG_MS, type CloudCampaignView, type CloudLiveView, type CloudWaitReason } from '../../application/cloud/cloud-sync.ts';
import {
  activeCloudSettings, catchupWaitMs, cloudBridge, localCatchupRate, localSaveChars, openServerCampaign,
  type CloudConflict, type CloudServerWait,
} from './cloud.ts';
import './cloud.css';

const dateTime = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Game time: «19 ч 10 мин», «2 д 3 ч», «45 с». */
export function formatGameSpan(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1_000))} с`;
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${rest} мин`;
  return `${rest} мин`;
}

/** Wall time to wait: «≈ 40 с», «≈ 12 мин», «≈ 1 ч 30 мин». */
export function formatWait(ms: number | null): string {
  if (ms === null) return 'оцениваем…';
  const seconds = Math.max(1, Math.round(ms / 1_000));
  if (seconds < 60) return `≈ ${seconds} с`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `≈ ${minutes} мин`;
  return `≈ ${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

const rateText = (rate: number | null | undefined) => (rate ? `×${rate >= 10 ? Math.round(rate) : rate.toFixed(1).replace('.', ',')} реального времени` : 'измеряем…');

/**
 * What the wait window waits for now (null: the world can be taken). The
 * entry rule is decideCloudEntry's (cloud-sync.ts claimOrLocal); this reads
 * the polled campaign the same way.
 */
export function serverWaitReason(live: CloudLiveView | null, appVersion: string): CloudWaitReason | null {
  if (!live) return null;
  const order = compareGameVersions(live.gameVersion, appVersion);
  if (order > 0) return 'game-older';
  if (order < 0 || live.status === 'waiting-version') return 'server-updating';
  return live.status === 'running' && (live.lagMs ?? 0) > SERVER_CATCHUP_WAIT_LAG_MS ? 'catching-up' : null;
}

/** A newer game asks the server to update again this often while it waits (the server checks GitHub on request). */
const UPDATE_REQUEST_EVERY_MS = 2 * 60_000;
const POLL_MS = 3_000;

/**
 * «Мир догоняется на сервере»: the world stays on the server while it is
 * still catching up (or moving to this game's release), with its progress,
 * the server's speed and both estimates. When it is ready the game takes it
 * (onReady → the normal entry claims it in seconds). «Досчитать на этом ПК»
 * takes it now and replays the rest here; «Меню игры» leaves it on the server.
 */
export function ServerWaitWindow({ slot, wait, onReady, onTakeNow, onMenu }: {
  slot: SaveSlotMeta;
  wait: CloudServerWait;
  onReady: () => void;
  onTakeNow: () => void;
  onMenu: () => void;
}) {
  const [campaign, setCampaign] = useState(wait.campaign);
  const [error, setError] = useState<string | null>(null);
  // Polled (wall time, world time) pairs: the speed when the server does not report one.
  const samples = useRef<Array<{ at: number; worldAt: number }>>([]);
  const startLag = useRef(wait.campaign.live?.lagMs ?? 0);
  const ready = useRef(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [chars] = useState(() => localSaveChars(slot));
  useEffect(() => { menuRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onMenu(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onMenu]);
  useEffect(() => {
    const bridge = cloudBridge();
    if (!bridge) return undefined;
    let alive = true;
    let lastUpdateRequest = Date.now();
    const poll = async () => {
      const found = await bridge.campaign(slot.id).catch(() => ({ ok: false as const, code: 'network', error: 'Нет связи с сервером' }));
      if (!alive) return;
      if (!found.ok || !found.campaign) {
        setError(found.ok ? 'Кампании больше нет на сервере.' : `${found.error}. Мир остаётся на сервере; пробуем снова…`);
        return;
      }
      setError(null);
      const next = found.campaign;
      setCampaign(next);
      if (next.live) {
        samples.current = [...samples.current, { at: Date.now(), worldAt: next.live.worldAt }].filter((sample) => Date.now() - sample.at <= 120_000);
      }
      const reason = serverWaitReason(next.live, wait.appVersion);
      if (reason === null && !ready.current) {
        ready.current = true;
        onReadyRef.current();
        return;
      }
      if (reason === 'server-updating' && Date.now() - lastUpdateRequest >= UPDATE_REQUEST_EVERY_MS) {
        lastUpdateRequest = Date.now();
        void bridge.requestUpdate().catch(() => undefined);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [slot.id, wait.appVersion]);

  const live = campaign.live;
  const reason = serverWaitReason(live, wait.appVersion) ?? wait.reason;
  const lagMs = live?.lagMs ?? 0;
  const first = samples.current[0];
  const last = samples.current.at(-1);
  const polledRate = first && last && last.at - first.at >= 8_000 ? (last.worldAt - first.worldAt) / (last.at - first.at) : null;
  const serverRate = live?.rate ?? polledRate;
  const serverWait = live?.etaMs ?? catchupWaitMs(lagMs, serverRate);
  const local = localCatchupRate(slot.id, chars, serverRate ?? null);
  const localWait = catchupWaitMs(lagMs, local?.rate);
  if (startLag.current < lagMs) startLag.current = lagMs;
  const progress = startLag.current > 0 ? Math.min(1, Math.max(0, 1 - lagMs / startLag.current)) : 0;
  const title = reason === 'catching-up' ? 'Мир догоняется на сервере'
    : reason === 'server-updating' ? 'Сервер переносит мир в новую версию' : 'Мир на сервере живёт в более новой версии';
  const lead = reason === 'catching-up'
    ? `Пока вас не было, мир «${slot.name}» живёт на сервере, и он ещё не догнал текущее время. Когда догонит, игра заберёт его и войдёт за секунды.`
    : reason === 'server-updating'
      ? `Мир живёт на сервере в версии ${live?.gameVersion ?? '?'}, игра — ${wait.appVersion}. Сервер ставит новую версию и переносит мир в неё вместе со всем, что он уже прожил; затем игра заберёт его.`
      : `Мир живёт на сервере в версии ${live?.gameVersion ?? '?'}, а эта игра — ${wait.appVersion}. Обновите игру («Перезапустить и обновить» в главном меню): более старая версия не откроет этот мир.`;
  const takeNowNote = reason === 'catching-up'
    ? 'Сервер остановится, а остаток досчитает этот компьютер.'
    : 'Мир сервера сохранится резервной копией, а этот компьютер досчитает отсутствие от своего сохранения.';
  const fasterHere = reason === 'catching-up' && localWait !== null && serverWait !== null && localWait < serverWait * 0.8;
  return (
    <div className="menu-modal cloud-wait" role="presentation" data-qa-cloud-wait={reason}>
      <section className="menu-modal__card cloud-wait__card" role="dialog" aria-modal="true" aria-labelledby="cloud-wait-title">
        <small>ОБЛАЧНЫЙ МИР · {slot.name}</small>
        <h2 id="cloud-wait-title">{title}</h2>
        <p>{lead}</p>
        {reason === 'catching-up' ? (
          <div className="cloud-wait__progress" role="status" aria-live="polite">
            <div className="cloud-wait__track" role="progressbar" aria-label="Сервер догоняет время" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(progress * 100)}>
              <i style={{ transform: `scaleX(${progress})` }} />
            </div>
          </div>
        ) : <i className="cloud-entry__bar" aria-hidden="true"><i /></i>}
        <dl className="cloud-wait__facts">
          <div><dt>Осталось игрового времени</dt><dd data-qa-cloud-wait-lag={Math.round(lagMs)}>{live ? formatGameSpan(lagMs) : '—'}</dd></div>
          <div><dt>Мир прожит до</dt><dd>{live ? dateTime(live.worldAt) : '—'}</dd></div>
          {reason === 'catching-up' ? <>
            <div><dt>Скорость сервера</dt><dd data-qa-cloud-wait-rate={serverRate ?? ''}>{rateText(serverRate)}</dd></div>
            <div className={fasterHere ? '' : 'is-best'}><dt>Ждать сервер</dt><dd data-qa-cloud-wait-server={serverWait ?? ''}>{formatWait(serverWait)}</dd></div>
            <div className={fasterHere ? 'is-best' : ''}>
              <dt>Досчитать на этом ПК</dt>
              <dd data-qa-cloud-wait-local={localWait ?? ''}>{formatWait(localWait)}{local?.source === 'measured' ? '' : local ? ' (оценка)' : ''}</dd>
            </div>
          </> : <div><dt>Версия сервера / игры</dt><dd>{live?.gameVersion ?? '?'} / {wait.appVersion}</dd></div>}
        </dl>
        {error ? <p className="menu-message menu-message--error" role="status">{error}</p> : null}
        <p className="cloud-conflict__note">«Меню игры» оставляет мир на сервере. «Досчитать на этом ПК» — {takeNowNote}</p>
        <div className="menu-modal__actions">
          <button ref={menuRef} type="button" className="menu-btn" onClick={onMenu} data-qa-cloud-wait-menu>МЕНЮ ИГРЫ</button>
          <button type="button" className={`menu-btn${fasterHere ? ' menu-btn--primary' : ''}`} onClick={onTakeNow} data-qa-cloud-wait-take>
            ДОСЧИТАТЬ НА ЭТОМ ПК
          </button>
        </div>
      </section>
    </div>
  );
}

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

/** One line on what the server does with a campaign's world now. */
export function describeServerCampaign(campaign: CloudCampaignView): string {
  const head = campaign.head!;
  const live = campaign.live;
  const uploaded = `ревизия ${head.revision} · выгружено ${dateTime(head.savedAt)}`;
  if (!live) return `${uploaded} · хранится копия, мир не живёт`;
  const lived = `мир живёт на сервере (версия ${live.gameVersion}), прожит до ${dateTime(live.worldAt)}`;
  if (live.status === 'waiting-version') return `${uploaded} · ${lived} · ждёт обновления сервера`;
  if (live.status !== 'running') return `${uploaded} · ${lived} · сейчас не считается`;
  const lagMs = live.lagMs ?? 0;
  if (lagMs <= SERVER_CATCHUP_WAIT_LAG_MS) return `${uploaded} · ${lived} · в ногу со временем`;
  const eta = live.etaMs ?? catchupWaitMs(lagMs, live.rate);
  return `${uploaded} · ${lived} · отстаёт на ${formatGameSpan(lagMs)}, сервер догоняет его${live.rate ? ` (${rateText(live.rate)})` : ''}${eta !== null ? `, догонит ${formatWait(eta)}` : ''}`;
}

/**
 * «Загрузить игру → На сервере»: every campaign the server keeps. This
 * computer's own show what the server does with their world (alive, how far
 * behind) and load through the normal entry; the others (another PC, a
 * reinstall) are downloaded into a new slot.
 */
export function ServerCampaigns({ slots, onLoad, onOpened }: { slots: readonly SaveSlotMeta[]; onLoad: (slot: SaveSlotMeta) => void; onOpened: (slot: SaveSlotMeta) => void }) {
  const [state, setState] = useState<{ status: 'off' } | { status: 'loading' } | { status: 'error'; text: string } | { status: 'ok'; campaigns: CloudCampaignView[] }>({ status: 'off' });
  const [busy, setBusy] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    void activeCloudSettings().then(async (settings) => {
      const bridge = cloudBridge();
      if (!alive || !settings || !bridge) return;
      setState({ status: 'loading' });
      const refresh = async () => {
        const result = await bridge.server();
        if (!alive) return;
        setState(result.ok ? { status: 'ok', campaigns: result.campaigns } : { status: 'error', text: result.error });
      };
      await refresh();
      // A world catching up on the server: its lag moves while the screen is open.
      timer = window.setInterval(() => void refresh(), 10_000);
    });
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  if (state.status === 'off') return null;
  const campaigns = state.status === 'ok' ? state.campaigns.filter((campaign) => campaign.head) : [];
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
      {state.status === 'ok' && !campaigns.length ? <p className="cloud-remote__hint">На сервере пока нет кампаний: кампания выгружается, когда вы выходите из неё в меню.</p> : null}
      {campaigns.length ? (
        <ul>
          {campaigns.map((campaign) => {
            const local = slots.find((slot) => slot.id === campaign.id) ?? null;
            const behind = campaign.live?.status === 'running' && (campaign.live.lagMs ?? 0) > SERVER_CATCHUP_WAIT_LAG_MS;
            return (
              <li key={campaign.id} className={behind ? 'is-behind' : undefined} data-qa-cloud-remote-campaign={campaign.id} data-qa-cloud-remote-local={local ? 'yes' : 'no'}>
                <div>
                  <b>{campaign.name}{local ? <em className="menu-tag">НА ЭТОМ ПК</em> : null}</b>
                  <span data-qa-cloud-remote-status>{describeServerCampaign(campaign)}</span>
                </div>
                {local ? (
                  <button type="button" className="menu-btn" disabled={busy !== null} onClick={() => onLoad(local)} data-qa-cloud-remote-load={campaign.id}>ЗАГРУЗИТЬ</button>
                ) : (
                  <button type="button" className="menu-btn menu-btn--primary" disabled={busy !== null} onClick={() => void open(campaign)} data-qa-cloud-remote-open={campaign.id}>
                    {busy?.id === campaign.id ? busy.text : 'ЗАГРУЗИТЬ С СЕРВЕРА'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
