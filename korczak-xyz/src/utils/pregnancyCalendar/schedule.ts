import type { Examination } from './types';

// Schedule of prenatal examinations based on the Polish standard of perinatal care
// (Standard organizacyjny opieki okoloporodowej, Rozporzadzenie Ministra Zdrowia).
// Week numbers are gestational weeks counted from the last menstrual period (LMP).
// `pl` is the primary (source) text; `en` is a translation.
//
// This is informational material only and is NOT a substitute for a physician's advice.

export const SCHEDULE: Examination[] = [
  // ---- Do 10 tc. — pierwsza wizyta / badania wstepne ----
  {
    id: 'first-visit',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'visit',
    name: {
      pl: 'Pierwsza wizyta u ginekologa / poloznej',
      en: 'First visit to the gynaecologist / midwife',
    },
    description: {
      pl: 'Potwierdzenie ciazy, wywiad ogolny i ginekologiczny, pomiar cisnienia, wzrostu i masy ciala, zalozenie karty ciazy oraz zlecenie badan wstepnych.',
      en: 'Confirmation of pregnancy, general and gynaecological history, blood pressure / height / weight measurement, opening the pregnancy card and ordering the initial panel of tests.',
    },
  },
  {
    id: 'blood-group-rh',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'blood',
    name: {
      pl: 'Grupa krwi i czynnik Rh',
      en: 'Blood group and Rh factor',
    },
    description: {
      pl: 'Oznaczenie grupy krwi ukladu ABO oraz czynnika Rh. Kluczowe dla oceny ryzyka konfliktu serologicznego u kobiet Rh-ujemnych.',
      en: 'ABO blood group and Rh factor typing. Essential for assessing the risk of Rh incompatibility in Rh-negative women.',
    },
  },
  {
    id: 'anti-rh-antibodies',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'blood',
    name: {
      pl: 'Przeciwciala odpornosciowe (anty-Rh)',
      en: 'Immune antibodies (anti-Rh screen)',
    },
    description: {
      pl: 'Badanie przeciwcial odpornosciowych (posrednie odczyn Coombsa). Wykrywa uodpornienie mogace prowadzic do choroby hemolitycznej plodu; powtarzane w ciazy.',
      en: 'Screen for immune antibodies (indirect Coombs test). Detects alloimmunisation that can cause haemolytic disease of the fetus; repeated during pregnancy.',
    },
  },
  {
    id: 'morphology-1',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'blood',
    name: {
      pl: 'Morfologia krwi',
      en: 'Complete blood count (CBC)',
    },
    description: {
      pl: 'Podstawowe badanie krwi oceniajace m.in. poziom hemoglobiny i plytek. Wykrywa niedokrwistosc czesta w ciazy.',
      en: 'Basic blood test assessing haemoglobin, platelets and more. Detects anaemia, which is common in pregnancy.',
    },
  },
  {
    id: 'urinalysis-1',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'screening',
    name: {
      pl: 'Badanie ogolne moczu',
      en: 'General urine test (urinalysis)',
    },
    description: {
      pl: 'Ocena obecnosci bialka, glukozy, cial ketonowych i infekcji drog moczowych. Powtarzane na kazdej wizycie.',
      en: 'Checks for protein, glucose, ketones and urinary tract infection. Repeated at every visit.',
    },
  },
  {
    id: 'fasting-glucose',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'blood',
    name: {
      pl: 'Glukoza na czczo',
      en: 'Fasting blood glucose',
    },
    description: {
      pl: 'Pomiar stezenia glukozy na czczo w celu wczesnego wykrycia zaburzen gospodarki weglowodanowej.',
      en: 'Fasting glucose measurement to detect carbohydrate metabolism disorders early.',
    },
  },
  {
    id: 'tsh',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'blood',
    name: {
      pl: 'TSH',
      en: 'TSH (thyroid function)',
    },
    description: {
      pl: 'Ocena czynnosci tarczycy. Nieleczona niedoczynnosc tarczycy moze wplywac na rozwoj plodu.',
      en: 'Assessment of thyroid function. Untreated hypothyroidism can affect fetal development.',
    },
  },
  {
    id: 'vdrl',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'serology',
    name: {
      pl: 'VDRL (kila)',
      en: 'VDRL (syphilis)',
    },
    description: {
      pl: 'Badanie przesiewowe w kierunku kily. Wczesne wykrycie i leczenie zapobiega kile wrodzonej.',
      en: 'Screening test for syphilis. Early detection and treatment prevents congenital syphilis.',
    },
  },
  {
    id: 'hiv-hcv',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'serology',
    name: {
      pl: 'HIV i HCV',
      en: 'HIV and HCV',
    },
    description: {
      pl: 'Badania w kierunku zakazenia wirusem HIV oraz wirusem zapalenia watroby typu C. Umozliwia dzialania ograniczajace transmisje na dziecko.',
      en: 'Testing for HIV and hepatitis C virus. Enables measures that reduce mother-to-child transmission.',
    },
  },
  {
    id: 'toxoplasmosis',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'serology',
    name: {
      pl: 'Toksoplazmoza (IgG, IgM)',
      en: 'Toxoplasmosis (IgG, IgM)',
    },
    description: {
      pl: 'Ocena odpornosci i ewentualnego swiezego zakazenia Toxoplasma gondii. Przy braku odpornosci badanie powtarza sie w ciazy.',
      en: 'Assessment of immunity and possible recent Toxoplasma gondii infection. If not immune, the test is repeated during pregnancy.',
    },
  },
  {
    id: 'rubella',
    weekStart: 6,
    weekEnd: 10,
    status: 'required',
    category: 'serology',
    name: {
      pl: 'Rozyczka (IgG, IgM)',
      en: 'Rubella (IgG, IgM)',
    },
    description: {
      pl: 'Sprawdzenie odpornosci na rozyczke. Zakazenie we wczesnej ciazy grozi ciezkimi wadami wrodzonymi.',
      en: 'Checks immunity to rubella. Infection in early pregnancy can cause severe congenital defects.',
    },
  },
  {
    id: 'cytology',
    weekStart: 6,
    weekEnd: 10,
    status: 'recommended',
    category: 'screening',
    name: {
      pl: 'Cytologia',
      en: 'Cervical cytology (Pap smear)',
    },
    description: {
      pl: 'Badanie cytologiczne szyjki macicy, jesli nie bylo wykonane w ciagu ostatnich miesiecy.',
      en: 'Cervical smear, if not performed in the preceding months.',
    },
  },
  {
    id: 'dental-1',
    weekStart: 6,
    weekEnd: 10,
    status: 'recommended',
    category: 'visit',
    name: {
      pl: 'Badanie stomatologiczne',
      en: 'Dental examination',
    },
    description: {
      pl: 'Ocena stanu jamy ustnej i uzebienia. Choroby przyzebia wiaza sie z ryzykiem powiklan ciazy.',
      en: 'Assessment of oral and dental health. Periodontal disease is linked to pregnancy complications.',
    },
  },

  // ---- 11–14 tc. — USG I trymestru, testy przesiewowe ----
  {
    id: 'usg-1',
    weekStart: 11,
    weekEnd: 14,
    status: 'required',
    category: 'usg',
    name: {
      pl: 'USG I trymestru (genetyczne)',
      en: 'First-trimester ultrasound (genetic)',
    },
    description: {
      pl: 'USG miedzy 11. a 13.+6 tygodniem. Pomiar przeziernosci karkowej (NT), ocena kosci nosowej i datowanie ciazy w ramach badan przesiewowych w kierunku wad genetycznych.',
      en: 'Ultrasound between 11 and 13+6 weeks. Nuchal translucency (NT) measurement, nasal bone assessment and pregnancy dating as part of screening for genetic anomalies.',
    },
  },
  {
    id: 'papp-a',
    weekStart: 11,
    weekEnd: 14,
    status: 'recommended',
    category: 'screening',
    name: {
      pl: 'Test PAPP-A (test podwojny)',
      en: 'PAPP-A test (combined/double test)',
    },
    description: {
      pl: 'Badanie z krwi matki: bialko PAPP-A i wolna podjednostka beta-hCG. W polaczeniu z NT ocenia ryzyko trisomii (zespol Downa, Edwardsa, Patau).',
      en: 'Maternal blood test: PAPP-A protein and free beta-hCG. Combined with NT it estimates the risk of trisomies (Down, Edwards, Patau syndromes).',
    },
  },
  {
    id: 'nipt',
    weekStart: 10,
    weekEnd: 14,
    status: 'optional',
    category: 'screening',
    name: {
      pl: 'Test NIPT (wolne DNA plodowe)',
      en: 'NIPT (cell-free fetal DNA test)',
    },
    description: {
      pl: 'Nieinwazyjny test z krwi matki o wysokiej czulosci dla najczestszych trisomii. Badanie dodatkowe, zwykle platne; wynik nieprawidlowy wymaga potwierdzenia.',
      en: 'Non-invasive maternal blood test with high sensitivity for the common trisomies. An optional, usually paid test; an abnormal result requires confirmation.',
    },
  },

  // ---- 15–20 tc. ----
  {
    id: 'morphology-2',
    weekStart: 15,
    weekEnd: 20,
    status: 'required',
    category: 'blood',
    name: {
      pl: 'Morfologia i badanie moczu',
      en: 'CBC and urine test',
    },
    description: {
      pl: 'Kontrolna morfologia krwi oraz badanie ogolne moczu w polowie ciazy.',
      en: 'Follow-up complete blood count and urinalysis at mid-pregnancy.',
    },
  },
  {
    id: 'afp',
    weekStart: 15,
    weekEnd: 20,
    status: 'optional',
    category: 'screening',
    name: {
      pl: 'AFP (wg wskazan)',
      en: 'AFP (if indicated)',
    },
    description: {
      pl: 'Oznaczenie alfa-fetoproteiny wykonywane wybiorczo, m.in. w ocenie ryzyka wad cewy nerwowej.',
      en: 'Alpha-fetoprotein measured selectively, e.g. to assess the risk of neural tube defects.',
    },
  },

  // ---- 18–22 tc. — USG polowkowe ----
  {
    id: 'usg-2',
    weekStart: 18,
    weekEnd: 22,
    status: 'required',
    category: 'usg',
    name: {
      pl: 'USG II trymestru (polowkowe)',
      en: 'Second-trimester ultrasound (anomaly scan)',
    },
    description: {
      pl: 'Szczegolowa ocena anatomii plodu miedzy 18. a 22. tygodniem: budowa serca, mozgu, kregoslupa, narzadow wewnetrznych oraz lozyska i ilosci wod plodowych.',
      en: 'Detailed assessment of fetal anatomy between 18 and 22 weeks: heart, brain, spine and internal organs, plus placenta and amniotic fluid volume.',
    },
  },

  // ---- 24–28 tc. — OGTT i badania kontrolne ----
  {
    id: 'ogtt',
    weekStart: 24,
    weekEnd: 28,
    status: 'required',
    category: 'blood',
    name: {
      pl: 'OGTT 75 g (test obciazenia glukoza)',
      en: 'OGTT 75 g (glucose tolerance test)',
    },
    description: {
      pl: 'Doustny test obciazenia 75 g glukozy z pomiarami na czczo, po 1 i 2 godzinach. Wykrywa cukrzyce ciazowa (GDM).',
      en: 'Oral 75 g glucose load with fasting, 1-hour and 2-hour measurements. Detects gestational diabetes (GDM).',
    },
  },
  {
    id: 'morphology-3',
    weekStart: 24,
    weekEnd: 28,
    status: 'required',
    category: 'blood',
    name: {
      pl: 'Morfologia, badanie moczu i przeciwciala',
      en: 'CBC, urine test and antibody screen',
    },
    description: {
      pl: 'Kontrolna morfologia, badanie ogolne moczu oraz ponowne oznaczenie przeciwcial odpornosciowych.',
      en: 'Follow-up CBC, urinalysis and a repeat immune antibody screen.',
    },
  },
  {
    id: 'dental-2',
    weekStart: 24,
    weekEnd: 28,
    status: 'recommended',
    category: 'visit',
    name: {
      pl: 'Kontrola stomatologiczna',
      en: 'Dental check-up',
    },
    description: {
      pl: 'Powtorna ocena stanu jamy ustnej w II trymestrze.',
      en: 'Repeat oral health assessment in the second trimester.',
    },
  },

  // ---- 28 tc. — profilaktyka anty-D ----
  {
    id: 'anti-d',
    weekStart: 28,
    weekEnd: 30,
    status: 'required',
    category: 'procedure',
    name: {
      pl: 'Profilaktyka anty-D (immunoglobulina)',
      en: 'Anti-D prophylaxis (immunoglobulin)',
    },
    description: {
      pl: 'Podanie immunoglobuliny anty-D kobietom Rh-ujemnym bez wykrytych przeciwcial (zwykle ok. 28. tygodnia), aby zapobiec konfliktowi serologicznemu.',
      en: 'Anti-D immunoglobulin given to Rh-negative women without detected antibodies (usually around week 28) to prevent Rh sensitisation.',
    },
  },

  // ---- 28–32 tc. — USG III trymestru ----
  {
    id: 'usg-3',
    weekStart: 28,
    weekEnd: 32,
    status: 'required',
    category: 'usg',
    name: {
      pl: 'USG III trymestru',
      en: 'Third-trimester ultrasound',
    },
    description: {
      pl: 'Ocena wzrastania plodu, jego ulozenia, lozyska, ilosci wod plodowych oraz przeplywow. Pomaga zaplanowac dalszy nadzor i porod.',
      en: 'Assessment of fetal growth and position, placenta, amniotic fluid volume and blood flow. Helps plan further monitoring and delivery.',
    },
  },

  // ---- 33–37 tc. — badania przed porodem ----
  {
    id: 'gbs',
    weekStart: 35,
    weekEnd: 37,
    status: 'required',
    category: 'screening',
    name: {
      pl: 'Posiew GBS (paciorkowce grupy B)',
      en: 'GBS culture (group B streptococcus)',
    },
    description: {
      pl: 'Wymaz z pochwy i odbytu miedzy 35. a 37. tygodniem. Dodatni wynik oznacza podanie antybiotyku podczas porodu, aby chronic noworodka.',
      en: 'Vaginal and rectal swab between 35 and 37 weeks. A positive result means antibiotics during labour to protect the newborn.',
    },
  },
  {
    id: 'morphology-4',
    weekStart: 33,
    weekEnd: 37,
    status: 'required',
    category: 'blood',
    name: {
      pl: 'Morfologia i badanie moczu',
      en: 'CBC and urine test',
    },
    description: {
      pl: 'Kontrolne badania krwi i moczu przed porodem.',
      en: 'Follow-up blood and urine tests before delivery.',
    },
  },
  {
    id: 'hbsag',
    weekStart: 33,
    weekEnd: 37,
    status: 'required',
    category: 'serology',
    name: {
      pl: 'HBsAg (WZW typu B)',
      en: 'HBsAg (hepatitis B)',
    },
    description: {
      pl: 'Badanie w kierunku wirusowego zapalenia watroby typu B. Wynik dodatni pozwala zabezpieczyc noworodka po porodzie.',
      en: 'Test for hepatitis B. A positive result allows the newborn to be protected after birth.',
    },
  },
  {
    id: 'serology-repeat',
    weekStart: 33,
    weekEnd: 37,
    status: 'recommended',
    category: 'serology',
    name: {
      pl: 'HIV, HCV, VDRL (wg wskazan)',
      en: 'HIV, HCV, VDRL (if indicated)',
    },
    description: {
      pl: 'Powtorzenie badan serologicznych w III trymestrze u kobiet ze zwiekszonym ryzykiem zakazenia.',
      en: 'Repeat serology in the third trimester for women at increased risk of infection.',
    },
  },
  {
    id: 'dental-3',
    weekStart: 33,
    weekEnd: 37,
    status: 'recommended',
    category: 'visit',
    name: {
      pl: 'Kontrola stomatologiczna',
      en: 'Dental check-up',
    },
    description: {
      pl: 'Koncowa ocena stanu jamy ustnej przed porodem.',
      en: 'Final oral health assessment before delivery.',
    },
  },

  // ---- 38–39 tc. ----
  {
    id: 'obstetric-visit',
    weekStart: 38,
    weekEnd: 39,
    status: 'required',
    category: 'visit',
    name: {
      pl: 'Wizyta poloznicza i ocena dobrostanu plodu',
      en: 'Obstetric visit and fetal wellbeing assessment',
    },
    description: {
      pl: 'Badanie poloznicze, ocena ulozenia plodu, w razie potrzeby KTG. Omowienie planu porodu.',
      en: 'Obstetric examination, assessment of fetal position, CTG if needed. Discussion of the birth plan.',
    },
  },

  // ---- od 40 tc. ----
  {
    id: 'post-term-monitoring',
    weekStart: 40,
    weekEnd: 42,
    status: 'required',
    category: 'visit',
    name: {
      pl: 'Nadzor po terminie (KTG, USG)',
      en: 'Post-term monitoring (CTG, ultrasound)',
    },
    description: {
      pl: 'Od 40. tygodnia intensywniejszy nadzor: KTG, USG i ocena ilosci wod plodowych, konsultacja poloznicza i planowanie zakonczenia ciazy.',
      en: 'From week 40 more intensive monitoring: CTG, ultrasound and amniotic fluid assessment, obstetric consultation and planning the end of pregnancy.',
    },
  },
];
