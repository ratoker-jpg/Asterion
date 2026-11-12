import { useCallback, useEffect, useState } from 'react';
import { describeServerStall, type CloudCampaignView } from '../../application/cloud/cloud-sync.ts';
import { cloudBridge, type CloudServerStatus, type CloudSettings } from './cloud.ts';
import { SettingsHead } from '../settings/SettingsParts.tsx';

const dateTime = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const oneDecimal = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const megabytes = (bytes: number) => `${oneDecimal.format(bytes / 1024 ** 2)} МБ`;
const gigabytes = (bytes: number) => `${oneDecimal.format(bytes / 1024 ** 3)} ГБ`;

function lag(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 60_000) return `отстаёт на ${Math.round(ms / 1000)} с`;
  return `отстаёт на ${Math.round(ms / 60_000)} мин`;
}

const HEAD_TEXT = 'Сохранения хранятся на вашем сервере с резервными копиями. Пока вас нет, сервер продолжает мир; при входе игра сразу берёт его, если на этом компьютере ничего не менялось.';

/** Settings → «Облачный мир»: address, key, on/off and what the relay did last. The key is never shown. */
export function CloudSettingsPanel() {
  const bridge = cloudBridge();
  const [settings, setSettings] = useState<CloudSettings | null>(null);
  const [unavailable, setUnavailable] = useState(!bridge);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [server, setServer] = useState<{ status: CloudServerStatus; campaigns: CloudCampaignView[] } | { error: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    if (!bridge) return;
    setChecking(true);
    const result = await bridge.server();
    setChecking(false);
    setServer(result.ok ? { status: result.status, campaigns: result.campaigns } : { error: result.error });
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    bridge.get().then((current) => {
      setSettings(current);
      setUrl(current.url);
      if (current.enabled && current.url && current.hasKey) void check();
    }, () => setUnavailable(true));
  }, [bridge, check]);

  const save = async (next: { enabled?: boolean }) => {
    if (!bridge) return;
    try {
      const saved = await bridge.set({ url, ...(key.trim() ? { key: key.trim() } : {}), ...next });
      setSettings(saved);
      setUrl(saved.url);
      setKey('');
      setMessage({ tone: 'ok', text: saved.enabled ? 'Сохранено. Облачный мир включён.' : 'Сохранено. Облачный мир выключен.' });
      if (saved.enabled && saved.url && saved.hasKey) void check();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error) });
    }
  };

  if (unavailable) {
    return (
      <section className="set-section" data-qa-cloud-settings="unavailable">
        <SettingsHead title="Облачный мир" text={HEAD_TEXT} />
        <div className="set-tile">
          <div className="set-tile-text">
            <strong>Только в приложении для Windows</strong>
            <span>Облачные сохранения и мир, который живёт на сервере, пока вас нет, подключаются в приложении Asterion для Windows.</span>
          </div>
        </div>
      </section>
    );
  }
  const upload = settings?.lastUpload ?? null;
  // A world that stopped on the server: one calm line per campaign, only when it happened.
  const stalls = server && 'campaigns' in server
    ? server.campaigns.flatMap((campaign) => { const note = describeServerStall(campaign.live, campaign.live?.status === 'failed' ? 'local' : campaign.live?.recovery?.recoveredAt !== undefined ? 'took-server' : 'waiting'); return note ? [`«${campaign.name}»: ${note}`] : []; })
    : [];
  const live = server && 'status' in server ? server.status.live : null;
  const liveCampaign = live && server && 'campaigns' in server ? server.campaigns.find((campaign) => campaign.id === live.campaignId) : null;
  const enabled = Boolean(settings?.enabled);
  return (
    <section className="set-section cloud-settings" data-qa-cloud-settings={enabled ? 'on' : 'off'}>
      <SettingsHead title="Облачный мир" text={HEAD_TEXT} />
      <div className="set-grid set-grid--cloud">
        <div className="set-tile">
          <div className="set-tile-text">
            <strong>Подключение</strong>
            <span>На другом компьютере введите тот же адрес и ключ, затем откройте партию в «Загрузить игру → На сервере».</span>
          </div>
          <div className="set-seg" role="group" aria-label="Облачный мир">
            <button type="button" className={enabled ? 'active' : ''} aria-pressed={enabled} onClick={() => void save({ enabled: true })} data-qa-cloud-toggle="on">Включён</button>
            <button type="button" className={settings && !enabled ? 'active' : ''} aria-pressed={Boolean(settings) && !enabled} onClick={() => void save({ enabled: false })} data-qa-cloud-toggle="off">Выключен</button>
          </div>
          <label className="set-field">
            <span>Адрес сервера</span>
            <input className="set-input" value={url} spellCheck={false} placeholder="https://сервер" onChange={(event) => setUrl(event.target.value)} data-qa-cloud-url />
          </label>
          <label className="set-field">
            <span>Ключ доступа</span>
            <input className="set-input" type="password" value={key} autoComplete="off" spellCheck={false}
              placeholder={settings?.hasKey ? 'ключ сохранён на этом компьютере' : 'вставьте ключ с сервера'} onChange={(event) => setKey(event.target.value)} data-qa-cloud-key />
          </label>
          <div className="set-actions">
            <button type="button" className="primary" onClick={() => void save({})} data-qa-cloud-save>Сохранить</button>
            <button type="button" disabled={checking || !enabled} onClick={() => void check()} data-qa-cloud-check>{checking ? 'Проверяем…' : 'Проверить связь'}</button>
          </div>
          {message ? <p className={`set-note cloud-settings__message is-${message.tone}`} role="status">{message.text}</p> : null}
          <p className="set-note">Ключ хранится в папке профиля игры и здесь не показывается.</p>
        </div>
        <div className="set-tile" data-qa-cloud-status>
          <div className="set-tile-text">
            <strong>Состояние</strong>
          </div>
          <dl className="set-facts set-facts--stack">
            <div><dt>Последняя копия на сервер</dt><dd data-qa-cloud-last-upload={upload ? (upload.ok ? 'ok' : 'error') : 'none'}>{upload
              ? `${dateTime(upload.at)} · ${upload.ok ? `копия №${upload.revision}${upload.gzBytes ? ` · ${megabytes(upload.gzBytes)}` : ''}${upload.left ? ' · мир передан серверу' : ''}` : `ошибка: ${upload.error}`}`
              : 'ещё не было'}</dd></div>
            <div><dt>Мир на сервере</dt><dd data-qa-cloud-live={live ? 'running' : 'none'}>{live
              ? `«${liveCampaign?.name ?? live.campaignId}» живёт до ${live.worldAt ? dateTime(live.worldAt) : '—'}${live.lagMs !== null ? ` · ${lag(live.lagMs)}` : ''}${live.cpuShare !== null ? ` · нагрузка ${oneDecimal.format(live.cpuShare * 100)}%` : ''}${live.rss ? ` · память ${Math.round(live.rss / 1024 ** 2)} МБ` : ''}`
              : server && 'status' in server ? 'сейчас на сервере не живёт ни один мир' : '—'}</dd></div>
            {stalls.length ? <div className="is-warn"><dt>Остановки мира</dt><dd data-qa-cloud-stall>{stalls.join(' ')}</dd></div> : null}
            <div className={server && 'error' in server ? 'is-bad' : ''}><dt>Сервер</dt><dd>{server && 'status' in server
              ? `версия ${server.status.version} · партий ${server.status.campaigns} · копии занимают ${gigabytes(server.status.storedBytes)}${server.status.disk ? ` · свободно ${gigabytes(server.status.disk.freeBytes)}` : ''}`
              : server && 'error' in server ? `не отвечает: ${server.error}` : enabled ? '—' : 'облачный мир выключен'}</dd></div>
            {settings?.lastError ? <div className="is-bad"><dt>Последняя ошибка</dt><dd>{dateTime(settings.lastError.at)} · {settings.lastError.text}</dd></div> : null}
            <div><dt>Версия игры</dt><dd>{settings?.appVersion ?? '—'}</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}
