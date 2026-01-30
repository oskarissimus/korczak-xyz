export const languages = {
  en: 'English',
  pl: 'Polski',
} as const;

export const defaultLang = 'en' as const;

export type Lang = keyof typeof languages;
export type TranslationKey = keyof typeof ui[typeof defaultLang];
export type TranslateFunction = (key: TranslationKey) => string;

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

    // Homepage
    'hero.welcome': 'Welcome to Oskar\'s Homepage!',
    'hero.subtitle': 'Software Engineer | Mentor | Builder',
    'hero.visitors': 'Visitors',
    'hero.myLinks': 'My Links',

    // Button texts
    'btn.songs': 'Songs',
    'btn.discord': 'Discord community',
    'btn.youtube': 'Youtube channel',
    'btn.courses': 'Courses',
    'btn.mentoring': 'Mentoring',
    'btn.blog': 'Blog',
    'btn.github': 'Github',
    'btn.linkedin': 'LinkedIn',

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
    'mentoring.scheduleMeeting': 'Schedule a Meeting',
    'mentoring.contactForm': 'Contact Form',

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

    // Songs
    'Date added': 'Date added',
    'Search songs...': 'Search songs...',
    'No songs found': 'No songs found',

    // Song controls
    'song.chords': 'Chords',
    'song.text': 'Text',
    'song.transpose': 'Transpose',
    'song.light': 'Light',
    'song.dark': 'Dark',
    'song.font': 'Font',
    'song.columns': 'Columns',
    'song.layoutSide': 'Side',
    'song.layoutTop': 'Top',
    'song.scroll': 'Scroll',
    'song.scrollPause': 'Pause',
    'song.speed': 'Speed',
    'song.video': 'Video',
    'song.videoHide': 'Hide Video',

    // Games
    'Games': 'Games',
    'Solitaire': 'Solitaire',
    'solitaire.newGame': 'New Game',
    'solitaire.undo': 'Undo',
    'solitaire.draw1': 'Draw 1',
    'solitaire.draw3': 'Draw 3',
    'solitaire.score': 'Score',
    'solitaire.moves': 'Moves',
    'solitaire.youWin': 'You Win!',
    'solitaire.playAgain': 'Play Again',
    'solitaire.time': 'Time',

    // Minesweeper
    'Minesweeper': 'Minesweeper',
    'minesweeper.classicPuzzle': 'Classic Puzzle',
    'minesweeper.newGame': 'New Game',
    'minesweeper.beginner': 'Beginner',
    'minesweeper.intermediate': 'Intermediate',
    'minesweeper.expert': 'Expert',
    'minesweeper.mines': 'Mines',
    'minesweeper.time': 'Time',
    'minesweeper.youWin': 'You Win!',
    'minesweeper.gameOver': 'Game Over!',
    'minesweeper.flagMode': 'Flag Mode',
    'minesweeper.digMode': 'Dig Mode',

    // Pipes
    'Pipes': '3D Pipes',
    'pipes.title': '3D Pipes',
    'pipes.screensaver': 'Screensaver',
    'pipes.pause': 'Pause',
    'pipes.play': 'Play',
    'pipes.reset': 'Reset',
    'pipes.fullscreen': 'Fullscreen',

    // Status bar
    'statusBar.lastUpdated': 'Last updated:',

    // Anesthesia Quiz
    'AnesthesiaQuiz': 'Anesthesia Quiz',
    'anesthesia.quizDesc': 'Medical Knowledge Test',
    'anesthesia.title': 'Anesthesia Quiz',
    'anesthesia.admin': 'Admin Panel',
    'anesthesia.selectCategories': 'Select Categories',
    'anesthesia.selectDifficulty': 'Select Difficulty',
    'anesthesia.questionCount': 'Number of Questions',
    'anesthesia.allCategoriesHint': 'No selection = all categories',
    'anesthesia.allDifficultiesHint': 'No selection = all difficulties',
    'anesthesia.categoriesSelected': 'selected',
    'anesthesia.difficultiesSelected': 'selected',
    'anesthesia.availableQuestions': 'Available questions',
    'anesthesia.yourStats': 'Your Statistics',
    'anesthesia.quizzesCompleted': 'Quizzes',
    'anesthesia.averageScore': 'Average',
    'anesthesia.bestScore': 'Best',
    'anesthesia.startQuiz': 'Start Quiz',
    'anesthesia.noQuestionsAvailable': 'No questions available with selected filters',
    'anesthesia.question': 'Question',
    'anesthesia.correct': 'Correct',
    'anesthesia.incorrect': 'Incorrect',
    'anesthesia.explanation': 'Explanation',
    'anesthesia.nextQuestion': 'Next Question',
    'anesthesia.viewResults': 'View Results',
    'anesthesia.quizComplete': 'Quiz Complete!',
    'anesthesia.scoreExcellent': 'Excellent work!',
    'anesthesia.scoreGood': 'Good job!',
    'anesthesia.scoreFair': 'Not bad!',
    'anesthesia.scoreKeepPracticing': 'Keep practicing!',
    'anesthesia.score': 'Score',
    'anesthesia.correctAnswers': 'Correct Answers',
    'anesthesia.points': 'Points',
    'anesthesia.time': 'Time',
    'anesthesia.questionBreakdown': 'Question Breakdown',
    'anesthesia.categoryPerformance': 'Performance by Category',
    'anesthesia.difficultyPerformance': 'Performance by Difficulty',
    'anesthesia.playAgain': 'Play Again',
    // Categories
    'anesthesia.cat.pharmacology': 'Pharmacology',
    'anesthesia.cat.physiology': 'Physiology',
    'anesthesia.cat.equipment': 'Equipment',
    'anesthesia.cat.procedures': 'Procedures',
    'anesthesia.cat.emergencies': 'Emergencies',
    'anesthesia.cat.pediatric': 'Pediatric',
    'anesthesia.cat.obstetric': 'Obstetric',
    'anesthesia.cat.pain': 'Pain Management',
    'anesthesia.cat.general': 'General',
    // Difficulties
    'anesthesia.diff.easy': 'Easy',
    'anesthesia.diff.medium': 'Medium',
    'anesthesia.diff.hard': 'Hard',
    // Admin
    'anesthesia.questionList': 'Question List',
    'anesthesia.addQuestion': 'Add Question',
    'anesthesia.editQuestion': 'Edit Question',
    'anesthesia.importExport': 'Import/Export',
    'anesthesia.backToQuiz': 'Back to Quiz',
    'anesthesia.searchQuestions': 'Search questions...',
    'anesthesia.allCategories': 'All Categories',
    'anesthesia.allDifficulties': 'All Difficulties',
    'anesthesia.showing': 'Showing',
    'anesthesia.questions': 'questions',
    'anesthesia.noQuestionsFound': 'No questions found',
    'anesthesia.edit': 'Edit',
    'anesthesia.delete': 'Delete',
    'anesthesia.confirmDelete': 'Are you sure you want to delete this question?',
    'anesthesia.category': 'Category',
    'anesthesia.difficulty': 'Difficulty',
    'anesthesia.questionText': 'Question Text',
    'anesthesia.questionPlaceholder': 'Enter the question...',
    'anesthesia.answerOptions': 'Answer Options',
    'anesthesia.option': 'Option',
    'anesthesia.explanationPlaceholder': 'Explain why the correct answer is correct...',
    'anesthesia.cancel': 'Cancel',
    'anesthesia.save': 'Save',
    'anesthesia.update': 'Update',
    'anesthesia.errorQuestionRequired': 'Question text is required',
    'anesthesia.errorOptionRequired': 'Option is required:',
    'anesthesia.errorExplanationRequired': 'Explanation is required',
    'anesthesia.exportQuestions': 'Export Questions',
    'anesthesia.exportDescription': 'Download all questions as a JSON file for backup or sharing.',
    'anesthesia.downloadJSON': 'Download JSON',
    'anesthesia.copyToClipboard': 'Copy to Clipboard',
    'anesthesia.copiedToClipboard': 'Copied to clipboard!',
    'anesthesia.totalQuestions': 'Total questions',
    'anesthesia.importQuestions': 'Import Questions',
    'anesthesia.importDescription': 'Import questions from a JSON file.',
    'anesthesia.mergeMode': 'Merge',
    'anesthesia.mergeModeDescription': 'Add new questions and update existing ones',
    'anesthesia.replaceMode': 'Replace',
    'anesthesia.replaceModeDescription': 'Replace all existing questions',
    'anesthesia.selectFile': 'Select File',
    'anesthesia.importErrors': 'Import errors',
    'anesthesia.importSuccess': 'Successfully imported',
    'anesthesia.confirmReplace': 'This will replace ALL existing questions. Continue?',
    'anesthesia.errorReadingFile': 'Error reading file',
    'anesthesia.errorNoQuestions': 'No valid questions found in file',
    'anesthesia.errorCopyingClipboard': 'Error copying to clipboard',
    'anesthesia.andMoreErrors': 'and {count} more errors',
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

    // Homepage
    'hero.welcome': 'Witaj na stronie Oskara!',
    'hero.subtitle': 'Programista | Mentor | Builder',
    'hero.visitors': 'Odwiedziny',
    'hero.myLinks': 'Moje Linki',

    // Button texts
    'btn.songs': 'Piosenki',
    'btn.discord': 'Spolecznosc Discord',
    'btn.youtube': 'Kanal Youtube',
    'btn.courses': 'Kursy',
    'btn.mentoring': 'Mentoring',
    'btn.blog': 'Blog',
    'btn.github': 'Github',
    'btn.linkedin': 'LinkedIn',

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
    'mentoring.scheduleMeeting': 'Umow spotkanie',
    'mentoring.contactForm': 'Formularz kontaktowy',

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

    // Songs
    'Date added': 'Dodano',
    'Search songs...': 'Szukaj...',
    'No songs found': 'Nie znaleziono piosenek',

    // Song controls
    'song.chords': 'Akordy',
    'song.text': 'Tekst',
    'song.transpose': 'Transpozycja',
    'song.light': 'Jasny',
    'song.dark': 'Ciemny',
    'song.font': 'Czcionka',
    'song.columns': 'Kolumny',
    'song.layoutSide': 'Z boku',
    'song.layoutTop': 'U góry',
    'song.scroll': 'Przewijaj',
    'song.scrollPause': 'Pauza',
    'song.speed': 'Tempo',
    'song.video': 'Wideo',
    'song.videoHide': 'Ukryj Wideo',

    // Games
    'Games': 'Gry',
    'Solitaire': 'Pasjans',
    'solitaire.newGame': 'Nowa Gra',
    'solitaire.undo': 'Cofnij',
    'solitaire.draw1': 'Dobierz 1',
    'solitaire.draw3': 'Dobierz 3',
    'solitaire.score': 'Wynik',
    'solitaire.moves': 'Ruchy',
    'solitaire.youWin': 'Wygrales!',
    'solitaire.playAgain': 'Zagraj Ponownie',
    'solitaire.time': 'Czas',

    // Minesweeper
    'Minesweeper': 'Saper',
    'minesweeper.classicPuzzle': 'Klasyczna Zagadka',
    'minesweeper.newGame': 'Nowa Gra',
    'minesweeper.beginner': 'Poczatkujacy',
    'minesweeper.intermediate': 'Sredni',
    'minesweeper.expert': 'Ekspert',
    'minesweeper.mines': 'Miny',
    'minesweeper.time': 'Czas',
    'minesweeper.youWin': 'Wygrales!',
    'minesweeper.gameOver': 'Koniec Gry!',
    'minesweeper.flagMode': 'Tryb Flagi',
    'minesweeper.digMode': 'Tryb Kopania',

    // Pipes
    'Pipes': 'Rury 3D',
    'pipes.title': 'Rury 3D',
    'pipes.screensaver': 'Wygaszacz ekranu',
    'pipes.pause': 'Pauza',
    'pipes.play': 'Graj',
    'pipes.reset': 'Reset',
    'pipes.fullscreen': 'Pelny ekran',

    // Status bar
    'statusBar.lastUpdated': 'Aktualizacja:',

    // Anesthesia Quiz
    'AnesthesiaQuiz': 'Quiz Anestezjologiczny',
    'anesthesia.quizDesc': 'Test Wiedzy Medycznej',
    'anesthesia.title': 'Quiz Anestezjologiczny',
    'anesthesia.admin': 'Panel Administratora',
    'anesthesia.selectCategories': 'Wybierz Kategorie',
    'anesthesia.selectDifficulty': 'Wybierz Poziom Trudnosci',
    'anesthesia.questionCount': 'Liczba Pytan',
    'anesthesia.allCategoriesHint': 'Brak wyboru = wszystkie kategorie',
    'anesthesia.allDifficultiesHint': 'Brak wyboru = wszystkie poziomy',
    'anesthesia.categoriesSelected': 'wybranych',
    'anesthesia.difficultiesSelected': 'wybranych',
    'anesthesia.availableQuestions': 'Dostepne pytania',
    'anesthesia.yourStats': 'Twoje Statystyki',
    'anesthesia.quizzesCompleted': 'Quizy',
    'anesthesia.averageScore': 'Srednia',
    'anesthesia.bestScore': 'Najlepszy',
    'anesthesia.startQuiz': 'Rozpocznij Quiz',
    'anesthesia.noQuestionsAvailable': 'Brak pytan dla wybranych filtrow',
    'anesthesia.question': 'Pytanie',
    'anesthesia.correct': 'Poprawnie',
    'anesthesia.incorrect': 'Niepoprawnie',
    'anesthesia.explanation': 'Wyjasnienie',
    'anesthesia.nextQuestion': 'Nastepne Pytanie',
    'anesthesia.viewResults': 'Zobacz Wyniki',
    'anesthesia.quizComplete': 'Quiz Ukonczony!',
    'anesthesia.scoreExcellent': 'Swietna robota!',
    'anesthesia.scoreGood': 'Dobra robota!',
    'anesthesia.scoreFair': 'Niezle!',
    'anesthesia.scoreKeepPracticing': 'Cwicz dalej!',
    'anesthesia.score': 'Wynik',
    'anesthesia.correctAnswers': 'Poprawne Odpowiedzi',
    'anesthesia.points': 'Punkty',
    'anesthesia.time': 'Czas',
    'anesthesia.questionBreakdown': 'Szczegoly Pytan',
    'anesthesia.categoryPerformance': 'Wyniki wg Kategorii',
    'anesthesia.difficultyPerformance': 'Wyniki wg Trudnosci',
    'anesthesia.playAgain': 'Zagraj Ponownie',
    // Categories
    'anesthesia.cat.pharmacology': 'Farmakologia',
    'anesthesia.cat.physiology': 'Fizjologia',
    'anesthesia.cat.equipment': 'Sprzet',
    'anesthesia.cat.procedures': 'Procedury',
    'anesthesia.cat.emergencies': 'Stany Nagle',
    'anesthesia.cat.pediatric': 'Pediatria',
    'anesthesia.cat.obstetric': 'Poloznictwo',
    'anesthesia.cat.pain': 'Leczenie Bolu',
    'anesthesia.cat.general': 'Ogolne',
    // Difficulties
    'anesthesia.diff.easy': 'Latwy',
    'anesthesia.diff.medium': 'Sredni',
    'anesthesia.diff.hard': 'Trudny',
    // Admin
    'anesthesia.questionList': 'Lista Pytan',
    'anesthesia.addQuestion': 'Dodaj Pytanie',
    'anesthesia.editQuestion': 'Edytuj Pytanie',
    'anesthesia.importExport': 'Import/Eksport',
    'anesthesia.backToQuiz': 'Powrot do Quizu',
    'anesthesia.searchQuestions': 'Szukaj pytan...',
    'anesthesia.allCategories': 'Wszystkie Kategorie',
    'anesthesia.allDifficulties': 'Wszystkie Poziomy',
    'anesthesia.showing': 'Wyswietlanie',
    'anesthesia.questions': 'pytan',
    'anesthesia.noQuestionsFound': 'Nie znaleziono pytan',
    'anesthesia.edit': 'Edytuj',
    'anesthesia.delete': 'Usun',
    'anesthesia.confirmDelete': 'Czy na pewno chcesz usunac to pytanie?',
    'anesthesia.category': 'Kategoria',
    'anesthesia.difficulty': 'Poziom trudnosci',
    'anesthesia.questionText': 'Tresc Pytania',
    'anesthesia.questionPlaceholder': 'Wpisz pytanie...',
    'anesthesia.answerOptions': 'Opcje Odpowiedzi',
    'anesthesia.option': 'Opcja',
    'anesthesia.explanationPlaceholder': 'Wyjasnij dlaczego ta odpowiedz jest poprawna...',
    'anesthesia.cancel': 'Anuluj',
    'anesthesia.save': 'Zapisz',
    'anesthesia.update': 'Aktualizuj',
    'anesthesia.errorQuestionRequired': 'Tresc pytania jest wymagana',
    'anesthesia.errorOptionRequired': 'Wymagana opcja:',
    'anesthesia.errorExplanationRequired': 'Wyjasnienie jest wymagane',
    'anesthesia.exportQuestions': 'Eksportuj Pytania',
    'anesthesia.exportDescription': 'Pobierz wszystkie pytania jako plik JSON do kopii zapasowej lub udostepnienia.',
    'anesthesia.downloadJSON': 'Pobierz JSON',
    'anesthesia.copyToClipboard': 'Kopiuj do Schowka',
    'anesthesia.copiedToClipboard': 'Skopiowano do schowka!',
    'anesthesia.totalQuestions': 'Laczna liczba pytan',
    'anesthesia.importQuestions': 'Importuj Pytania',
    'anesthesia.importDescription': 'Importuj pytania z pliku JSON.',
    'anesthesia.mergeMode': 'Polacz',
    'anesthesia.mergeModeDescription': 'Dodaj nowe pytania i zaktualizuj istniejace',
    'anesthesia.replaceMode': 'Zastap',
    'anesthesia.replaceModeDescription': 'Zastap wszystkie istniejace pytania',
    'anesthesia.selectFile': 'Wybierz Plik',
    'anesthesia.importErrors': 'Bledy importu',
    'anesthesia.importSuccess': 'Pomyslnie zaimportowano',
    'anesthesia.confirmReplace': 'To zastapi WSZYSTKIE istniejace pytania. Kontynuowac?',
    'anesthesia.errorReadingFile': 'Blad odczytu pliku',
    'anesthesia.errorNoQuestions': 'Nie znaleziono prawidlowych pytan w pliku',
    'anesthesia.errorCopyingClipboard': 'Blad kopiowania do schowka',
    'anesthesia.andMoreErrors': 'i {count} wiecej bledow',
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
