import { type Lang, getLocalizedPath } from '../i18n';

interface Button {
  icon: string;
  text: string;
  backgroundColor: string;
  to: string;
}

interface ButtonConfig {
  icon: string;
  textKey: string;
  backgroundColor: string;
  path?: string;
  externalUrl?: string;
}

const buttonConfigs: ButtonConfig[] = [
  {
    icon: 'music',
    textKey: 'btn.songs',
    backgroundColor: 'bg-[#1db954]',
    path: '/songs/'
  },
  {
    icon: 'discord',
    textKey: 'btn.discord',
    backgroundColor: 'bg-[#7289d9]',
    externalUrl: 'https://discord.gg/DwbvwjJM7N'
  },
  {
    icon: 'youtube',
    textKey: 'btn.youtube',
    backgroundColor: 'bg-[#ff0000]',
    externalUrl: 'https://www.youtube.com/@korczakxyz'
  },
  {
    icon: 'laptop-code',
    textKey: 'btn.courses',
    backgroundColor: 'bg-[#a4036f]',
    path: '/courses/'
  },
  {
    icon: 'lightbulb',
    textKey: 'btn.mentoring',
    backgroundColor: 'bg-[#048ba8]',
    path: '/mentoring/'
  },
  {
    icon: 'list-alt',
    textKey: 'btn.blog',
    backgroundColor: 'bg-[#87420D]',
    path: '/blog/'
  },
  {
    icon: 'github',
    textKey: 'btn.github',
    backgroundColor: 'bg-[#333]',
    externalUrl: 'https://github.com/oskarissimus'
  },
  {
    icon: 'linkedin',
    textKey: 'btn.linkedin',
    backgroundColor: 'bg-[#0077b5]',
    externalUrl: 'https://www.linkedin.com/in/oskar-korczak/'
  },
];

export function getButtons(lang: Lang, t: (key: string) => string): Button[] {
  return buttonConfigs.map(config => ({
    icon: config.icon,
    text: t(config.textKey),
    backgroundColor: config.backgroundColor,
    to: config.externalUrl || getLocalizedPath(config.path!, lang),
  }));
}
