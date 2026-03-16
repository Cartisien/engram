/**
 * A/B Evaluation — Question Set
 *
 * 20 questions covering all 10 synthetic corpus windows (2 per window).
 * Each question has a corpus window index and an expected_answer for scoring.
 */

export interface EvalQuestion {
  id: number
  windowIndex: number
  question: string
  expected_answer: string
}

export const EVAL_QUESTIONS: EvalQuestion[] = [
  // Window 0: Pronoun-heavy identity (Vanessa)
  {
    id: 1,
    windowIndex: 0,
    question: 'Where does Vanessa work?',
    expected_answer: 'Meridian Labs',
  },
  {
    id: 2,
    windowIndex: 0,
    question: 'By how much did the climate model reduce prediction error?',
    expected_answer: '23%',
  },

  // Window 1: Changed schedules (Marcus)
  {
    id: 3,
    windowIndex: 1,
    question: 'When is the design review with Marcus?',
    expected_answer: 'Thursday at 10am',
  },
  {
    id: 4,
    windowIndex: 1,
    question: 'What should be sent to Marcus before the meeting?',
    expected_answer: 'mockups',
  },

  // Window 2: Multi-hop (Alice → Acme → Boston)
  {
    id: 5,
    windowIndex: 2,
    question: 'What company does Alice Chen work for?',
    expected_answer: 'Acme Robotics',
  },
  {
    id: 6,
    windowIndex: 2,
    question: 'Where did Alice Chen relocate from?',
    expected_answer: 'Portland',
  },

  // Window 3: Repeated fact with update (Bob)
  {
    id: 7,
    windowIndex: 3,
    question: 'What department does Bob Martinez work in now?',
    expected_answer: 'engineering',
  },
  {
    id: 8,
    windowIndex: 3,
    question: 'How long was Bob Martinez in sales before transferring?',
    expected_answer: 'three years',
  },

  // Window 4: Vague time references (Clara)
  {
    id: 9,
    windowIndex: 4,
    question: 'What university did Clara partner with in Japan?',
    expected_answer: 'Kyoto University',
  },
  {
    id: 10,
    windowIndex: 4,
    question: 'What was Clara researching in Japan?',
    expected_answer: 'traditional fermentation techniques',
  },

  // Window 5: Two-hop event (Derek & Mia)
  {
    id: 11,
    windowIndex: 5,
    question: 'Who did Derek propose to after his Paris trip?',
    expected_answer: 'Mia',
  },
  {
    id: 12,
    windowIndex: 5,
    question: 'Where are Derek and Mia planning their wedding?',
    expected_answer: 'Savannah',
  },

  // Window 6: Conflicting preference (Elena)
  {
    id: 13,
    windowIndex: 6,
    question: 'What does Elena drink now?',
    expected_answer: 'tea',
  },
  {
    id: 14,
    windowIndex: 6,
    question: 'Why did Elena stop drinking coffee?',
    expected_answer: 'doctor said it was affecting her sleep',
  },

  // Window 7: Entity aliases (Robert/Rob/Bobby)
  {
    id: 15,
    windowIndex: 7,
    question: 'Who leads the Atlas migration project?',
    expected_answer: 'Robert Nakamura',
  },
  {
    id: 16,
    windowIndex: 7,
    question: 'Where did Robert Nakamura previously work?',
    expected_answer: 'Dataflow Inc',
  },

  // Window 8: Plan cancellation (Denver offsite)
  {
    id: 17,
    windowIndex: 8,
    question: 'Is the Denver team offsite still happening?',
    expected_answer: 'no, cancelled due to budget cuts',
  },
  {
    id: 18,
    windowIndex: 8,
    question: 'Who was organizing the team offsite?',
    expected_answer: 'Fiona',
  },

  // Window 9: Relationship claim (Sarah & Tom)
  {
    id: 19,
    windowIndex: 9,
    question: 'Who is Sarah Okafor married to?',
    expected_answer: 'Tom Okafor',
  },
  {
    id: 20,
    windowIndex: 9,
    question: 'What are the names and ages of Sarah and Tom\'s children?',
    expected_answer: 'Liam age 6 and Nora age 3',
  },
]
