// Seed data for Anesthesia Quiz
import type { Question } from './types';

export const SEED_QUESTIONS: Question[] = [
  {
    id: 'seed-001',
    category: 'pharmacology',
    difficulty: 'easy',
    questionText: 'Which induction agent has the fastest onset of action?',
    options: ['Propofol', 'Etomidate', 'Ketamine', 'Thiopental'],
    correctIndex: 0,
    explanation:
      'Propofol has a rapid onset (30-40 seconds) due to its high lipid solubility and rapid distribution to the brain. While thiopental also has rapid onset, propofol is generally considered to have the fastest clinical effect.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'seed-002',
    category: 'pharmacology',
    difficulty: 'medium',
    questionText: 'What is the mechanism of action of succinylcholine?',
    options: [
      'Non-depolarizing neuromuscular blockade',
      'Depolarizing neuromuscular blockade',
      'Central nervous system depression',
      'Acetylcholinesterase inhibition',
    ],
    correctIndex: 1,
    explanation:
      'Succinylcholine is a depolarizing neuromuscular blocking agent. It mimics acetylcholine at the neuromuscular junction, causing initial depolarization (fasciculations) followed by sustained depolarization and muscle paralysis.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'seed-003',
    category: 'physiology',
    difficulty: 'easy',
    questionText: 'What is the normal oxygen saturation range in arterial blood?',
    options: ['85-90%', '90-94%', '95-100%', '80-85%'],
    correctIndex: 2,
    explanation:
      'Normal arterial oxygen saturation (SaO2) is 95-100%. Values below 90% indicate hypoxemia and require immediate attention.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'seed-004',
    category: 'physiology',
    difficulty: 'medium',
    questionText: 'Which factor does NOT shift the oxygen-hemoglobin dissociation curve to the right?',
    options: [
      'Increased temperature',
      'Increased pH (alkalosis)',
      'Increased 2,3-DPG',
      'Increased CO2',
    ],
    correctIndex: 1,
    explanation:
      'Alkalosis (increased pH) shifts the curve to the LEFT, increasing hemoglobin\'s affinity for oxygen. The other factors (increased temperature, 2,3-DPG, and CO2) all shift the curve RIGHT, facilitating oxygen release to tissues.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'seed-005',
    category: 'equipment',
    difficulty: 'easy',
    questionText: 'What color is the oxygen cylinder according to international standards?',
    options: ['Blue', 'Green', 'White', 'Yellow'],
    correctIndex: 2,
    explanation:
      'According to ISO standards, oxygen cylinders are white. In the US, they may be green. Always verify cylinder contents regardless of color coding.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'seed-006',
    category: 'emergencies',
    difficulty: 'hard',
    questionText: 'What is the initial treatment dose of dantrolene for malignant hyperthermia?',
    options: ['0.5 mg/kg', '1 mg/kg', '2.5 mg/kg', '5 mg/kg'],
    correctIndex: 2,
    explanation:
      'The initial dose of dantrolene for malignant hyperthermia is 2.5 mg/kg IV, repeated every 5 minutes as needed up to a maximum of 10 mg/kg. Prompt administration is crucial for survival.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'seed-007',
    category: 'procedures',
    difficulty: 'medium',
    questionText: 'At which vertebral level is a lumbar puncture typically performed?',
    options: ['L1-L2', 'L2-L3', 'L3-L4 or L4-L5', 'L5-S1'],
    correctIndex: 2,
    explanation:
      'Lumbar puncture is typically performed at L3-L4 or L4-L5 interspace. The spinal cord ends at L1-L2 in adults (conus medullaris), so puncture below this level avoids spinal cord injury.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'seed-008',
    category: 'pediatric',
    difficulty: 'medium',
    questionText: 'What is the appropriate uncuffed endotracheal tube size formula for children over 1 year?',
    options: [
      '(Age/2) + 4',
      '(Age/4) + 4',
      '(Age/4) + 3',
      '(Age + 16) / 4',
    ],
    correctIndex: 1,
    explanation:
      'The formula for uncuffed ETT size in children over 1 year is (Age in years / 4) + 4. For example, a 4-year-old would use a 5.0 mm tube.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'seed-009',
    category: 'obstetric',
    difficulty: 'hard',
    questionText: 'What is the most common cause of maternal mortality related to anesthesia?',
    options: [
      'Local anesthetic toxicity',
      'Failed intubation/airway complications',
      'Spinal headache',
      'Allergic reaction',
    ],
    correctIndex: 1,
    explanation:
      'Airway management failure, including failed intubation and aspiration, remains the leading cause of anesthesia-related maternal deaths. This is why regional anesthesia is preferred when possible for cesarean delivery.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'seed-010',
    category: 'pain',
    difficulty: 'easy',
    questionText: 'Which of the following is a commonly used WHO Step 1 analgesic?',
    options: ['Morphine', 'Tramadol', 'Paracetamol (Acetaminophen)', 'Fentanyl'],
    correctIndex: 2,
    explanation:
      'The WHO pain ladder Step 1 includes non-opioid analgesics like paracetamol (acetaminophen) and NSAIDs. Step 2 includes weak opioids like tramadol, and Step 3 includes strong opioids like morphine and fentanyl.',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];
