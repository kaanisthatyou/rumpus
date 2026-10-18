// A phone that opened the address without being paired: how to pair it.
import { Mark } from '@lonca/ui';
import { useTranslation } from 'react-i18next';

export function Unpaired() {
  const { t } = useTranslation();
  return (
    <main className="unpaired">
      <Mark size={48} />
      <h1>{t('phone.unpaired.title')}</h1>
      <p className="muted">{t('phone.unpaired.how')}</p>
    </main>
  );
}
