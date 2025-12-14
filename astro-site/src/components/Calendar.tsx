import Cal, { getCalApi } from '@calcom/embed-react';
import { useStore } from '@nanostores/react';
import { useEffect } from 'react';
import { themeStore, initTheme } from '../stores/theme';

export default function Calendar() {
  const theme = useStore(themeStore);

  useEffect(() => {
    initTheme();
  }, []);

  useEffect(() => {
    async function setupCal() {
      const cal = await getCalApi();
      cal('ui', { theme, hideEventTypeDetails: true });
    }
    setupCal();
  }, [theme]);

  return <Cal calLink="oskarissimus/mentoring" config={{ theme }} />;
}
