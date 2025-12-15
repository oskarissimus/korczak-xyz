export const languages = {
  en: 'English',
  pl: 'Polski',
} as const;

export const defaultLang = 'en' as const;

export type Lang = keyof typeof languages;

export const ui = {
  en: {
    // Navigation
    'Home': 'Home',
    'About': 'About',
    'Mentoring': 'Mentoring',
    'Courses': 'Courses',
    'Blog': 'Blog',
    'Songs': 'Songs',
    'Oskar live': 'Oskar live',

    // About page
    'As a software development expert with 7 years of experience, I\'ve built a unique skill set that spans Python, JavaScript, Java, Bash, SQL, and C#. Also, I\'ve developed a strong foundation in DevOps practices, leveraging tools like Docker and Kubernetes to create efficient and scalable applications. 💪': 'As a software development expert with 7 years of experience, I\'ve built a unique skill set that spans Python, JavaScript, Java, Bash, SQL, and C#. Also, I\'ve developed a strong foundation in DevOps practices, leveraging tools like Docker and Kubernetes to create efficient and scalable applications. 💪',
    'Throughout my journey, I\'ve devoted myself to inspiring growth in others 🌱, sharing my knowledge as an experienced teacher and mentor. Being a part of numerous successful projects 🏆 has helped me understand what works best when collaborating with diverse teams.': 'Throughout my journey, I\'ve devoted myself to inspiring growth in others 🌱, sharing my knowledge as an experienced teacher and mentor. Being a part of numerous successful projects 🏆 has helped me understand what works best when collaborating with diverse teams.',
    'Let\'s join forces as we continue honing our skills and pushing the boundaries of software development. Connect with me, and together we\'ll harness the power of code to create lasting impact! 🚀😄': 'Let\'s join forces as we continue honing our skills and pushing the boundaries of software development. Connect with me, and together we\'ll harness the power of code to create lasting impact! 🚀😄',

    // Mentoring page
    'I am a programmer with lots of experience in commercial projects. I have a desire to educate future developers. I have experience with teaching and mentoring. I can educate, and guide you in exchange for feedback about needs, problems and expectations of a beginner. Please use calendar below to schedule meeting, or contact me using form on the bottom of this page. First meeting is free 😉': 'I am a programmer with lots of experience in commercial projects. I have a desire to educate future developers. I have experience with teaching and mentoring. I can educate, and guide you in exchange for feedback about needs, problems and expectations of a beginner. Please use calendar below to schedule meeting, or contact me using form on the bottom of this page. First meeting is free 😉',
    'I can help you with:': 'I can help you with:',
    'Python': 'Python',
    'Environment setup': 'Environment setup',
    'Linux command-line': 'Linux command-line',
    'Docker': 'Docker',
    'Kubernetes': 'Kubernetes',
    'React': 'React',
    'Mentoring sessions are up to 1 hour long.': 'Mentoring sessions are up to 1 hour long.',

    // Contact form
    'Name': 'Name',
    'Enter name': 'Enter name',
    'Email': 'Email',
    'Enter email': 'Enter email',
    'Message': 'Message',
    'Enter message': 'Enter message',
    'Submit': 'Submit',

    // 404
    'Page not found': 'Page not found',

    // Courses
    'Read more': 'Read more',
  },
  pl: {
    // Navigation
    'Home': 'Główna',
    'About': 'O mnie',
    'Mentoring': 'Mentoring',
    'Courses': 'Kursy',
    'Blog': 'Blog',
    'Songs': 'Teksty',
    'Oskar live': 'Oskar live',

    // About page
    'As a software development expert with 7 years of experience, I\'ve built a unique skill set that spans Python, JavaScript, Java, Bash, SQL, and C#. Also, I\'ve developed a strong foundation in DevOps practices, leveraging tools like Docker and Kubernetes to create efficient and scalable applications. 💪': 'Jako programista z 7-letnim doświadczeniem 🌱, zgromadziłem bogaty zestaw umiejętności, w tym Python, JavaScript, Java, Bash, SQL i C#. Ponadto, zagłębiłem się w praktyki DevOps, korzystając znarzędzi takich jak Docker i Kubernetes, by tworzyć efektywne i łatwo skalowalne aplikacje 💪.',
    'Throughout my journey, I\'ve devoted myself to inspiring growth in others 🌱, sharing my knowledge as an experienced teacher and mentor. Being a part of numerous successful projects 🏆 has helped me understand what works best when collaborating with diverse teams.': 'Przez całą moją karierę konsekwentnie dążyłem do inspirowania innych, dzieląc się swoją wiedzą w roli nauczyciela i mentora. Uczestniczenie w wielu udanych projektach 🏆 nauczyło mnie, jak skutecznie współpracować z różnorodnymi zespołami.',
    'Let\'s join forces as we continue honing our skills and pushing the boundaries of software development. Connect with me, and together we\'ll harness the power of code to create lasting impact! 🚀😄': 'Chcesz połączyć siły? Pracujmy razem nad doskonaleniem naszych umiejętności i przesuwaniem granic w świecie oprogramowania. Skontaktuj się ze mną, a razem wykorzystajmy moc kodu, by tworzyć realną wartość! 🚀😄',

    // Mentoring page
    'I am a programmer with lots of experience in commercial projects. I have a desire to educate future developers. I have experience with teaching and mentoring. I can educate, and guide you in exchange for feedback about needs, problems and expectations of a beginner. Please use calendar below to schedule meeting, or contact me using form on the bottom of this page. First meeting is free 😉': 'Jestem programistą z wieloletnim doświadczeniem w projektach komercyjnych. Mam pragnienie edukowania przyszłych programistów. Posiadam doświadczenie w nauczaniu i mentorowaniu. Mogę Cię uczyć i prowadzić w zamian za opinie na temat potrzeb, problemów i oczekiwań początkującego. Skorzystaj z kalendarza poniżej, aby zaplanować spotkanie, lub skontaktuj się ze mną używając formularza na dole tej strony. Pierwsze spotkanie jest darmowe 😉',
    'I can help you with:': 'Mogę Ci pomóc w:',
    'Python': 'Python',
    'Environment setup': 'Konfiguracja środowiska',
    'Linux command-line': 'Wiersz poleceń Linux',
    'Docker': 'Docker',
    'Kubernetes': 'Kubernetes',
    'React': 'React',
    'Mentoring sessions are up to 1 hour long.': 'Sesje trwają do 1 godziny.',

    // Contact form
    'Name': 'Imię',
    'Enter name': 'Podaj swoje imię',
    'Email': 'Email',
    'Enter email': 'Podaj swój adres email',
    'Message': 'Wiadomość',
    'Enter message': 'Wpisz swoją wiadomość',
    'Submit': 'Wyślij',

    // 404
    'Page not found': 'Strona nie znaleziona',

    // Courses
    'Read more': 'Czytaj więcej',
  },
} as const;

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/');
  if (lang in languages) return lang as Lang;
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(key: keyof typeof ui[typeof defaultLang]): string {
    return ui[lang][key] || ui[defaultLang][key];
  };
}

export function getLocalizedPath(path: string, lang: Lang): string {
  if (lang === defaultLang) return path;
  return `/${lang}${path}`;
}

export function getAlternateLangPath(currentPath: string, currentLang: Lang, targetLang: Lang): string {
  if (currentLang === defaultLang) {
    // English to Polish: add /pl prefix
    if (targetLang === 'pl') {
      return `/pl${currentPath}`;
    }
    return currentPath;
  } else {
    // Polish to English: remove /pl prefix
    if (targetLang === defaultLang) {
      return currentPath.replace(/^\/pl/, '') || '/';
    }
    return currentPath;
  }
}
