import Cal, { getCalApi } from '@calcom/embed-react';
import { useEffect, useState } from 'react';

function getTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export default function Calendar() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    setTheme(getTheme());

    const observer = new MutationObserver(() => {
      setTheme(getTheme());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
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
