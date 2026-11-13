// A phone that opened the address without being paired: how to pair it.
import { Bub } from '@lonca/ui';
import { useTranslation } from 'react-i18next';

export function Unpaired() {
  const { t } = useTranslation();
  return (
    <main className="unpaired">
      <Bub pose="wave" size={96} />
      <h1>{t('phone.unpaired.title')}</h1>
      <p className="muted">{t('phone.unpaired.how')}</p>
    </main>
  );
}
