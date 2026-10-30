import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CloudCampaignView } from '../../application/cloud/cloud-sync.ts';
import { cloudBridge, type CloudServerStatus, type CloudSettings } from './cloud.ts';

const dateTime = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const megabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;

function lag(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 60_000) return `отстаёт на ${Math.round(ms / 1000)} с`;
  return `отстаёт на ${Math.round(ms / 60_000)} мин`;
}

/** Settings → «Облачный мир»: address, key, on/off and what the relay did last. */
export function CloudSettingsPanel({ heading }: { heading: (props: { eyebrow: string; title: string; description: string }) => ReactNode }) {
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
      <section className="settings-panel-v2" data-qa-cloud-settings="unavailable">
        {heading({ eyebrow: 'СИНХРОНИЗАЦИЯ', title: 'ОБЛАЧНЫЙ МИР', description: 'Облачное сохранение и мир, который живёт на сервере, пока вас нет, доступны в приложении Asterion для Windows.' })}
      </section>
    );
  }
  const upload = settings?.lastUpload ?? null;
  const live = server && 'status' in server ? server.status.live : null;
  const liveCampaign = live && server && 'campaigns' in server ? server.campaigns.find((campaign) => campaign.id === live.campaignId) : null;
  return (
    <section className="settings-panel-v2 cloud-settings" data-qa-cloud-settings={settings?.enabled ? 'on' : 'off'}>
      {heading({
        eyebrow: 'СИНХРОНИЗАЦИЯ',
        title: 'ОБЛАЧНЫЙ МИР',
        description: 'Сохранения кампаний хранятся на вашем сервере с резервными копиями. Пока вас нет в игре, сервер продолжает мир; при входе игра сразу получает его, если на этом компьютере ничего не менялось.',
      })}
      <div className="settings-grid-v2">
        <div className="settings-card-v2">
          <h3 className="utility-section-title">ПОДКЛЮЧЕНИЕ</h3>
          <div className="settings-segment-v2">
            <button type="button" className={`utility-control ${settings?.enabled ? 'active' : ''}`} onClick={() => void save({ enabled: true })} data-qa-cloud-toggle="on">ВКЛЮЧЁН</button>
            <button type="button" className={`utility-control ${settings && !settings.enabled ? 'active' : ''}`} onClick={() => void save({ enabled: false })} data-qa-cloud-toggle="off">ВЫКЛЮЧЕН</button>
          </div>
          <label className="settings-select-v2">
            <span className="utility-secondary">АДРЕС СЕРВЕРА</span>
            <input className="utility-control cloud-settings__input" value={url} spellCheck={false} placeholder="https://сервер" onChange={(event) => setUrl(event.target.value)} data-qa-cloud-url />
          </label>
          <label className="settings-select-v2">
            <span className="utility-secondary">КЛЮЧ ДОСТУПА</span>
            <input className="utility-control cloud-settings__input" type="password" value={key} autoComplete="off" spellCheck={false}
              placeholder={settings?.hasKey ? 'ключ сохранён на этом компьютере' : 'вставьте ключ с сервера'} onChange={(event) => setKey(event.target.value)} data-qa-cloud-key />
          </label>
          <div className="settings-presets-v2">
            <button type="button" className="utility-control" onClick={() => void save({})} data-qa-cloud-save>СОХРАНИТЬ</button>
            <button type="button" className="utility-control" disabled={checking || !settings?.enabled} onClick={() => void check()} data-qa-cloud-check>{checking ? 'ПРОВЕРКА…' : 'ПРОВЕРИТЬ СВЯЗЬ'}</button>
          </div>
          {message ? <small className={`utility-helper cloud-settings__message is-${message.tone}`} role="status">{message.text}</small> : null}
          <small className="utility-helper">Ключ хранится в папке профиля игры (cloud-key.txt) и не показывается здесь. На другом компьютере введите тот же адрес и ключ, затем откройте кампанию в «Загрузить игру → На сервере».</small>
        </div>
        <div className="settings-card-v2" data-qa-cloud-status>
          <h3 className="utility-section-title">СОСТОЯНИЕ</h3>
          <dl className="cloud-settings__facts">
            <div><dt>Последняя выгрузка</dt><dd data-qa-cloud-last-upload={upload ? (upload.ok ? 'ok' : 'error') : 'none'}>{upload
              ? `${dateTime(upload.at)} · ${upload.ok ? `ревизия ${upload.revision}${upload.gzBytes ? ` · ${megabytes(upload.gzBytes)}` : ''}${upload.left ? ' · мир передан серверу' : ''}` : `ошибка: ${upload.error}`}`
              : 'ещё не было'}</dd></div>
            <div><dt>Мир на сервере</dt><dd data-qa-cloud-live={live ? 'running' : 'none'}>{live
              ? `«${liveCampaign?.name ?? live.campaignId}» жив до ${live.worldAt ? dateTime(live.worldAt) : '—'}${live.lagMs !== null ? ` · ${lag(live.lagMs)}` : ''}${live.cpuShare !== null ? ` · CPU ${(live.cpuShare * 100).toFixed(1)}%` : ''}${live.rss ? ` · ${Math.round(live.rss / 1024 ** 2)} МБ` : ''}`
              : server && 'status' in server ? 'сейчас никакой мир не живёт на сервере' : '—'}</dd></div>
            <div><dt>Сервер</dt><dd>{server && 'status' in server
              ? `версия ${server.status.version} · кампаний ${server.status.campaigns} · копии ${gigabytes(server.status.storedBytes)}${server.status.disk ? ` · свободно ${gigabytes(server.status.disk.freeBytes)}` : ''}`
              : server && 'error' in server ? `недоступен: ${server.error}` : '—'}</dd></div>
            {settings?.lastError ? <div><dt>Последняя ошибка</dt><dd>{dateTime(settings.lastError.at)} · {settings.lastError.text}</dd></div> : null}
            <div><dt>Версия игры</dt><dd>{settings?.appVersion ?? '—'}</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}
