interface Button {
  icon: string;
  text: string;
  backgroundColor: string;
  to: string;
}

export const buttons: Button[] = [
  {
    icon: 'music',
    text: 'Songs',
    backgroundColor: 'bg-[#1db954]',
    to: '/songs/'
  },
  {
    icon: 'discord',
    text: 'Discord community',
    backgroundColor: 'bg-[#7289d9]',
    to: 'https://discord.gg/DwbvwjJM7N'
  },
  {
    icon: 'youtube',
    text: 'Youtube channel',
    backgroundColor: 'bg-[#ff0000]',
    to: 'https://www.youtube.com/@korczakxyz'
  },
  {
    icon: 'laptop-code',
    text: 'Courses',
    backgroundColor: 'bg-[#a4036f]',
    to: '/courses/'
  },
  {
    icon: 'lightbulb',
    text: 'Mentoring',
    backgroundColor: 'bg-[#048ba8]',
    to: '/mentoring/'
  },
  {
    icon: 'list-alt',
    text: 'Blog',
    backgroundColor: 'bg-[#87420D]',
    to: '/blog/'
  },
  {
    icon: 'github',
    text: 'Github',
    backgroundColor: 'bg-[#333]',
    to: 'https://github.com/oskarissimus'
  },
];

export const buttonsPl: Button[] = [
  {
    icon: 'music',
    text: 'Piosenki',
    backgroundColor: 'bg-[#1db954]',
    to: '/pl/songs/'
  },
  {
    icon: 'discord',
    text: 'Spolecznosc Discord',
    backgroundColor: 'bg-[#7289d9]',
    to: 'https://discord.gg/DwbvwjJM7N'
  },
  {
    icon: 'youtube',
    text: 'Kanal Youtube',
    backgroundColor: 'bg-[#ff0000]',
    to: 'https://www.youtube.com/@korczakxyz'
  },
  {
    icon: 'laptop-code',
    text: 'Kursy',
    backgroundColor: 'bg-[#a4036f]',
    to: '/pl/courses/'
  },
  {
    icon: 'lightbulb',
    text: 'Mentoring',
    backgroundColor: 'bg-[#048ba8]',
    to: '/pl/mentoring/'
  },
  {
    icon: 'list-alt',
    text: 'Blog',
    backgroundColor: 'bg-[#87420D]',
    to: '/pl/blog/'
  },
  {
    icon: 'github',
    text: 'Github',
    backgroundColor: 'bg-[#333]',
    to: 'https://github.com/oskarissimus'
  },
];
