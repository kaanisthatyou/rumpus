// Settings → Phone: serve the UI to this person's phones over Tailscale, pair a phone with a QR, cut one off.
import type { PhoneState } from '@lonca/protocol';
import { Button, Icon, IconButton, Switch } from '@lonca/ui';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { core } from '../rpc';
import { useApp } from '../store';

export function PhonePanel() {
  const { t, i18n } = useTranslation();
  const patch = useApp((s) => s.patch);
  const flash = useApp((s) => s.flash);
  const [state, setState] = useState<PhoneState>();
  const [pair, setPair] = useState<{ url: string; qr: string; expires: number }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void core.call('phones.state').then(setState);
    return core.on('phones.changed', setState);
  }, []);

  const when = (ms: number) => new Date(ms).toLocaleString(i18n.language);
  return (
    <div className="stack">
      <p className="muted">{t('phone.intro')}</p>
      <div className="row-field">
        <Switch checked={state?.on ?? false} onChange={(on) => void patch({ phone: on })} label={t('phone.on')} />
        <span>{t('phone.on')}</span>
      </div>
      {state?.on && (
        <p className={`prov__protect ${state.url ? 'prov__protect--os' : 'prov__protect--none'}`}>
          <Icon name={state.url ? 'check' : 'alert'} size={14} />
          <span>
            {state.url ? t('phone.ready', { url: state.url }) : t(`phone.problem.${state.problem ?? 'tailscale'}`)}
          </span>
        </p>
      )}
      {state?.url && (
        <div className="stack">
          <div>
            <Button
              icon="plus"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const p = await core.call('phones.pair');
                  const qr = await QRCode.toDataURL(p.url, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
                  setPair({ ...p, qr });
                } catch {
                  flash(t('errors.no_address'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('phone.add')}
            </Button>
          </div>
          {pair && (
            <div className="phone__pair">
              <img className="phone__qr" src={pair.qr} alt={t('phone.qr')} width={180} height={180} />
              <div className="stack">
                <p>{t('phone.scan')}</p>
                <code className="l-mono phone__url">{pair.url}</code>
                <p className="muted">
                  {t('phone.once', { time: new Date(pair.expires).toLocaleTimeString(i18n.language) })}
                </p>
                <p className="muted">{t('phone.install')}</p>
              </div>
            </div>
          )}
        </div>
      )}
      {(state?.phones.length ?? 0) > 0 && (
        <ul className="prov__list" aria-label={t('phone.list')}>
          {state?.phones.map((p) => (
            <li key={p.id} className="prov l-card" aria-label={p.name}>
              <div className="prov__head">
                <Icon name="monitor" size={15} />
                <b>{p.name}</b>
                <span className="grow" />
                <IconButton
                  size="sm"
                  icon="trash"
                  label={t('phone.revoke', { name: p.name })}
                  onClick={async () => setState(await core.call('phones.revoke', { id: p.id }))}
                />
              </div>
              <span className="muted">
                {t('phone.paired', { time: when(p.created) })}
                {p.lastSeen ? ` · ${t('phone.seen', { time: when(p.lastSeen) })}` : ''}
                {` · ${p.push ? t('phone.pushYes') : t('phone.pushNo')}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
