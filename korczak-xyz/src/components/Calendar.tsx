import Cal, { getCalApi } from '@calcom/embed-react';
import { useEffect, useState } from 'react';

function getTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

// Win95 color palette for Cal.com embed
// Note: Cal.com cssVarsPerTheme uses variable names WITHOUT the -- prefix
const win95CssVars = {
  // Backgrounds - use navy/teal
  'cal-bg': '#000080',           // Navy blue
  'cal-bg-muted': '#000080',
  'cal-bg-subtle': '#008080',    // Teal for hover states
  'cal-bg-emphasis': '#008080',

  // Text - cyan, yellow, white
  'cal-text': '#ffffff',
  'cal-text-emphasis': '#00ffff', // Cyan for emphasis
  'cal-text-subtle': '#c0c0c0',   // Gray
  'cal-text-muted': '#808080',    // Dark gray

  // Borders - gray for Win95 3D effect
  'cal-border': '#c0c0c0',
  'cal-border-subtle': '#808080',
  'cal-border-emphasis': '#ffffff',
  'cal-border-booker': '#c0c0c0',

  // Brand colors
  'cal-brand': '#008080',         // Teal
  'cal-brand-emphasis': '#00ffff',
  'cal-brand-text': '#000000',

  // Remove rounded corners for retro look
  'cal-radius': '0px',
  'cal-radius-sm': '0px',
  'cal-radius-md': '0px',
  'cal-radius-lg': '0px',
  'cal-radius-xl': '0px',
  'cal-radius-2xl': '0px',
  'cal-radius-3xl': '0px',
  'cal-radius-full': '0px',
};

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
      cal('ui', {
        theme,
        hideEventTypeDetails: true,
        cssVarsPerTheme: {
          light: win95CssVars,
          dark: win95CssVars,
        },
      });
    }
    setupCal();
  }, [theme]);

  return <Cal calLink="oskarissimus/mentoring" config={{ theme }} />;
}
