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
    'Search': 'Search',
    'No songs found': 'No songs found',
    'songs added over': 'songs added over',
    'year': 'year',
    'years': 'years',

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
    'song.chordShapes': 'Chord shapes',

    // Auth
    'Login': 'Login',
    'Logout': 'Logout',

    // Apps
    'Apps': 'Apps',
    'Typing': 'Typing Trainer',
    'typing.desc': 'Type through a book',
    'Flashcards': 'Guitar Flashcards',
    'flashcards.desc': 'Notes on the neck and chords between keys, on one schedule',
    'TypingStats': 'Typing Stats',
    'TypingKeyStats': 'Key Stats',
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

    // Guitar tuner
    'Tuner': 'Guitar Tuner',
    'tuner.title': 'Guitar Tuner',
    'tuner.desc': 'Tune by microphone',

    // Installable web apps. The short names are what iOS writes under the home screen icon,
    // so they have to survive being truncated to about twelve characters.
    'pwa.site.name': 'korczak.xyz',
    'pwa.site.short': 'korczak.xyz',
    'pwa.site.desc': 'Personal website of Oskar Korczak',
    'pwa.tuner.short': 'Tuner',
    'pwa.songs.short': 'Songs',
    'pwa.songs.desc': 'Lyrics and chords, available offline',
    'pwa.flashcards.short': 'Flashcards',
    'pwa.babySleep.short': 'Baby Sleep',
    'pwa.events.short': 'Events',
    'pwa.transit.short': 'Metro',
    'pwa.offline.title': 'Offline',
    'pwa.offline.heading': 'No connection',
    'pwa.offline.message': 'This page has not been saved for offline use. Reconnect and try again.',
    'pwa.offline.retry': 'Try again',
    'pwa.video.offline': 'Video unavailable offline',

    // Status bar
    'statusBar.lastUpdated': 'Last updated:',
    // Narrow-screen variant, so the status bar stays on one line.
    'statusBar.updated': 'Updated:',

    // Anesthesia Quiz
    'AnesthesiaQuiz': 'Anesthesia Quiz',
    'anesthesia.quizDesc': 'Medical Knowledge Test',
    'PregnancyCalendar': 'Pregnancy Calendar',
    'pregnancy.desc': 'Prenatal examination schedule',
    'BabySleep': 'Baby Sleep Log',
    'babySleep.desc': 'Nights, naps and what they average out to',
    'Events': 'Event Watch',
    'events.desc': 'Concerts, festivals and premieres worth a ticket',
    'Transit': 'Metro Watch',
    'transit.desc': 'Warsaw metro disruptions on the stretch you actually ride',
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

    // Island hydration failure dialog
    'hydrationError.title': 'Loading Error',
    'hydrationError.message': 'Parts of this page could not be loaded. Check your internet connection and try again.',
    'hydrationError.reload': 'Reload',
    'anesthesia.andMoreErrors': 'and {count} more errors',

    // Privacy page
    'privacy.title': 'Privacy',
    'privacy.updated': 'Last updated: 8 September 2026',
    'privacy.who.title': 'Who runs this site',
    'privacy.who.body': 'korczak.xyz is a personal site run by Oskar Korczak. Anything on this page can be asked about at oskar.jan.korczak@gmail.com.',
    'privacy.publicPages.title': 'What the public pages collect',
    'privacy.publicPages.body': 'Nothing. The blog, the songbook, the course notes and the rest of the public pages carry no analytics, no advertising and no third-party tracking scripts. The visitor counter in the footer is a decoration from 1997 and counts nobody.',
    'privacy.localData.title': 'The apps keep their data in your browser',
    'privacy.localData.body': 'The small apps — the typing trainer, the guitar flashcards, the tuner, the sleep log, the games and the others — store what you do on your own device, in your browser’s local storage. That copy stays on the device and is sent nowhere unless you sign in.',
    'privacy.account.title': 'Signing in',
    'privacy.account.body': 'Signing in uses Firebase Authentication with an email address and a password. It exists for my own accounts rather than as a public sign-up. While signed in, app data — typing progress, flashcard schedules, sleep-log entries, notification subscriptions and diagnostic logs — syncs to Google Cloud Firestore in the project korczak-xyz-501720, so it survives a lost device and reaches another one. Google holds it as the hosting provider; nobody else receives it, and none of it is sold, shared or used for advertising.',
    'privacy.notifications.title': 'Notifications',
    'privacy.notifications.body': 'If you turn notifications on in one of the apps, your browser creates a push subscription, and its address is stored with your account so a scheduled job can deliver the alert. Turning notifications off removes it.',
    'privacy.hosting.title': 'Hosting',
    'privacy.hosting.body': 'Cloudflare serves the site and sees what any web server sees — your IP address, the page you asked for, your browser’s user agent — and uses it to deliver pages and to block attacks.',
    'privacy.contact.title': 'Your data and your choices',
    'privacy.contact.body': 'Clearing your browser storage removes the local copy of everything the apps hold. To ask what is stored under an account, or to have it deleted, write to oskar.jan.korczak@gmail.com. If this page changes, the date above changes with it.',

    // Terms page
    'terms.title': 'Terms',
    'terms.updated': 'Last updated: 8 September 2026',
    'terms.nature.title': 'What this is',
    'terms.nature.body': 'korczak.xyz is a personal site: a blog, a songbook, some course notes, and a set of small apps I build for myself and leave open to anyone who finds them useful. It is not a commercial service, and nothing here is for sale.',
    'terms.availability.title': 'Provided as it is',
    'terms.availability.body': 'The site and its apps are provided as they are, with no warranty of any kind. They may change, break or disappear without notice, and no uptime is promised.',
    'terms.yourData.title': 'Keep your own copies',
    'terms.yourData.body': 'The apps are not a backup service. Data held in your browser is gone when you clear your browser storage, and synced data can be lost too. Export or copy anything you would miss.',
    'terms.accounts.title': 'Accounts',
    'terms.accounts.body': 'The accounts on this site are mine. Please do not try to sign in to one you were not given, or to reach data through the site that was not meant for you.',
    'terms.content.title': 'Content',
    'terms.content.body': 'The writing, the code and the design here are mine unless stated otherwise. Song lyrics and chords in the songbook belong to their respective rights holders and are reproduced for personal and educational use; if you hold rights to something there and would rather it went, write to me and it goes.',
    'terms.liability.title': 'Liability',
    'terms.liability.body': 'So far as the law allows, I am not liable for any loss arising from using this site — lost data, a missed notification, or anything you trusted one of the apps to remember.',
    'terms.contact.title': 'Contact and changes',
    'terms.contact.body': 'Questions go to oskar.jan.korczak@gmail.com. These terms may change, and the date above says when they last did. Polish law applies.',

    // Footer
    'footer.marquee': '*** Welcome to korczak.xyz! *** 7 years of coding experience *** Python, JavaScript, Docker, Kubernetes *** Contact me for mentoring! *** Best viewed in Netscape Navigator 4.0 ***',
    // Split around the korczak.xyz link, which is a brand name and stays untranslated.
    'footer.underConstruction': 'Under Construction',
    'footer.established': 'Est. 2024',
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
    'Search': 'Szukaj',
    'No songs found': 'Nie znaleziono piosenek',
    'songs added over': 'piosenek dodanych przez',
    'year': 'rok',
    'years': 'lata',

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
    'song.chordShapes': 'Układy akordów',

    // Auth
    'Login': 'Logowanie',
    'Logout': 'Wyloguj',

    // Apps
    'Apps': 'Aplikacje',
    'Typing': 'Trening Pisania',
    'typing.desc': 'Przepisuj książkę',
    'Flashcards': 'Fiszki gitarowe',
    'flashcards.desc': 'Dźwięki na gryfie i akordy między tonacjami, w jednym harmonogramie',
    'TypingStats': 'Statystyki Pisania',
    'TypingKeyStats': 'Statystyki Klawiszy',
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

    // Guitar tuner
    'Tuner': 'Stroik gitarowy',
    'tuner.title': 'Stroik gitarowy',
    'tuner.desc': 'Strojenie przez mikrofon',

    // Aplikacje instalowane na ekranie głównym
    'pwa.site.name': 'korczak.xyz',
    'pwa.site.short': 'korczak.xyz',
    'pwa.site.desc': 'Strona osobista Oskara Korczaka',
    'pwa.tuner.short': 'Stroik',
    'pwa.songs.short': 'Teksty',
    'pwa.songs.desc': 'Teksty i akordy, dostępne offline',
    // "Fiszki gitarowe" and "Dziennik snu dziecka" are the full names; iOS truncates a home
    // screen label at about twelve characters, so these two are shortened rather than cut.
    'pwa.flashcards.short': 'Fiszki',
    'pwa.babySleep.short': 'Sen',
    'pwa.events.short': 'Wydarzenia',
    'pwa.transit.short': 'Metro',
    'pwa.offline.title': 'Offline',
    'pwa.offline.heading': 'Brak połączenia',
    'pwa.offline.message': 'Ta strona nie została zapisana do użytku offline. Połącz się i spróbuj ponownie.',
    'pwa.offline.retry': 'Spróbuj ponownie',
    'pwa.video.offline': 'Wideo niedostępne offline',

    // Status bar
    'statusBar.lastUpdated': 'Aktualizacja:',
    'statusBar.updated': 'Aktualizacja:',

    // Anesthesia Quiz
    'AnesthesiaQuiz': 'Quiz Anestezjologiczny',
    'anesthesia.quizDesc': 'Test Wiedzy Medycznej',
    'PregnancyCalendar': 'Kalendarz ciąży',
    'pregnancy.desc': 'Harmonogram badań prenatalnych',
    'BabySleep': 'Dziennik snu dziecka',
    'babySleep.desc': 'Noce, drzemki i ich średnie',
    'Events': 'Na tropie wydarzeń',
    'events.desc': 'Koncerty, festiwale i premiery warte biletu',
    'Transit': 'Metro na oku',
    'transit.desc': 'Utrudnienia w metrze na odcinku, którym naprawdę jeździsz',
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

    // Island hydration failure dialog
    'hydrationError.title': 'Blad ladowania',
    'hydrationError.message': 'Nie udalo sie zaladowac czesci tej strony. Sprawdz polaczenie z internetem i sprobuj ponownie.',
    'hydrationError.reload': 'Odswiez',

    // Privacy page
    'privacy.title': 'Prywatność',
    'privacy.updated': 'Ostatnia aktualizacja: 8 września 2026',
    'privacy.who.title': 'Kto prowadzi tę stronę',
    'privacy.who.body': 'korczak.xyz to prywatna strona prowadzona przez Oskara Korczaka. O wszystko, co jest na tej stronie, można zapytać pod adresem oskar.jan.korczak@gmail.com.',
    'privacy.publicPages.title': 'Co zbierają publiczne podstrony',
    'privacy.publicPages.body': 'Nic. Blog, śpiewnik, notatki z kursów i pozostałe publiczne podstrony nie mają analityki, reklam ani skryptów śledzących innych firm. Licznik odwiedzin w stopce to ozdoba z 1997 roku i nikogo nie liczy.',
    'privacy.localData.title': 'Aplikacje trzymają dane w Twojej przeglądarce',
    'privacy.localData.body': 'Małe aplikacje — trener pisania, fiszki gitarowe, tuner, dziennik snu, gry i pozostałe — zapisują to, co robisz, na Twoim urządzeniu, w pamięci lokalnej przeglądarki. Ta kopia zostaje na urządzeniu i nigdzie nie jest wysyłana, dopóki się nie zalogujesz.',
    'privacy.account.title': 'Logowanie',
    'privacy.account.body': 'Logowanie działa przez Firebase Authentication, adresem e-mail i hasłem. Służy moim własnym kontom, a nie publicznej rejestracji. Po zalogowaniu dane aplikacji — postępy w pisaniu, harmonogramy fiszek, wpisy dziennika snu, subskrypcje powiadomień i logi diagnostyczne — synchronizują się z Google Cloud Firestore w projekcie korczak-xyz-501720, żeby przetrwały utratę urządzenia i trafiły na kolejne. Google przechowuje je jako dostawca hostingu; nikt inny ich nie dostaje, nie są sprzedawane, udostępniane ani używane do reklam.',
    'privacy.notifications.title': 'Powiadomienia',
    'privacy.notifications.body': 'Jeśli włączysz powiadomienia w którejś z aplikacji, przeglądarka tworzy subskrypcję push, a jej adres zapisywany jest przy Twoim koncie, żeby zaplanowane zadanie mogło wysłać alert. Wyłączenie powiadomień go usuwa.',
    'privacy.hosting.title': 'Hosting',
    'privacy.hosting.body': 'Stronę serwuje Cloudflare, który widzi to, co widzi każdy serwer WWW — Twój adres IP, żądaną podstronę, identyfikator przeglądarki — i używa tego do dostarczania stron oraz blokowania ataków.',
    'privacy.contact.title': 'Twoje dane i Twoje wybory',
    'privacy.contact.body': 'Wyczyszczenie pamięci przeglądarki usuwa lokalną kopię wszystkiego, co trzymają aplikacje. Żeby zapytać, co jest zapisane przy koncie, albo poprosić o usunięcie, napisz na oskar.jan.korczak@gmail.com. Jeśli ta strona się zmieni, zmieni się też data powyżej.',

    // Terms page
    'terms.title': 'Regulamin',
    'terms.updated': 'Ostatnia aktualizacja: 8 września 2026',
    'terms.nature.title': 'Czym to jest',
    'terms.nature.body': 'korczak.xyz to prywatna strona: blog, śpiewnik, notatki z kursów i zestaw małych aplikacji, które robię dla siebie i zostawiam otwarte dla każdego, komu się przydadzą. To nie jest usługa komercyjna i nic tu nie jest na sprzedaż.',
    'terms.availability.title': 'Udostępniane takimi, jakie są',
    'terms.availability.body': 'Strona i jej aplikacje są udostępniane takimi, jakie są, bez żadnej gwarancji. Mogą się zmienić, zepsuć albo zniknąć bez uprzedzenia i nie obiecuję żadnej dostępności.',
    'terms.yourData.title': 'Rób własne kopie',
    'terms.yourData.body': 'Aplikacje nie są usługą backupu. Dane w przeglądarce znikają, gdy wyczyścisz jej pamięć, a dane zsynchronizowane też można stracić. Wyeksportuj albo skopiuj to, czego byłoby Ci szkoda.',
    'terms.accounts.title': 'Konta',
    'terms.accounts.body': 'Konta na tej stronie są moje. Proszę nie próbować logować się na konto, którego nie dostałeś, ani sięgać przez stronę po dane, które nie były dla Ciebie.',
    'terms.content.title': 'Treści',
    'terms.content.body': 'Teksty, kod i projekt graficzny są moje, o ile nie zaznaczono inaczej. Teksty piosenek i akordy w śpiewniku należą do właścicieli praw i są udostępnione do użytku osobistego i edukacyjnego; jeśli masz prawa do czegoś stamtąd i wolisz, żeby zniknęło, napisz do mnie — zniknie.',
    'terms.liability.title': 'Odpowiedzialność',
    'terms.liability.body': 'W zakresie dozwolonym przez prawo nie odpowiadam za szkody wynikające z korzystania z tej strony — utracone dane, nieotrzymane powiadomienie ani cokolwiek, o czym zawierzyłeś, że aplikacja to zapamięta.',
    'terms.contact.title': 'Kontakt i zmiany',
    'terms.contact.body': 'Pytania na oskar.jan.korczak@gmail.com. Regulamin może się zmienić, a data powyżej mówi, kiedy zmienił się ostatnio. Obowiązuje prawo polskie.',

    // Footer
    'footer.marquee': '*** Witaj na korczak.xyz! *** 7 lat doświadczenia w programowaniu *** Python, JavaScript, Docker, Kubernetes *** Napisz do mnie w sprawie mentoringu! *** Najlepiej oglądać w Netscape Navigator 4.0 ***',
    'footer.underConstruction': 'Strona w budowie',
    'footer.established': 'Od 2024',
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
