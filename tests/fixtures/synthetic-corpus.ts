/**
 * Synthetic Corpus — 10 conversation windows covering hard extraction cases.
 *
 * Each window is a ConversationTurn[] with fictional names and realistic dialogue.
 */

import type { ConversationTurn } from '../../src/compiler/schemas.js'

// ---------------------------------------------------------------------------
// 1. Pronoun-heavy identity
// ---------------------------------------------------------------------------
const window1: ConversationTurn[] = [
  { role: 'user', content: 'I met Vanessa at the conference last week. She was presenting on climate modeling.' },
  { role: 'assistant', content: 'That sounds interesting! What was her talk about?' },
  { role: 'user', content: 'She discussed how ocean temperature data from NOAA can improve hurricane predictions. She\'s been doing this for twelve years at Meridian Labs.' },
  { role: 'assistant', content: 'Twelve years is impressive. Did she mention any results?' },
  { role: 'user', content: 'Yes, she said their model reduced prediction error by 23%. She was really proud of it.' },
]

// ---------------------------------------------------------------------------
// 2. Changed schedules
// ---------------------------------------------------------------------------
const window2: ConversationTurn[] = [
  { role: 'user', content: 'The design review with Marcus is set for Tuesday at 2pm.' },
  { role: 'assistant', content: 'Got it. I\'ll note that down.' },
  { role: 'user', content: 'Actually, Marcus just messaged me. He wants to move it to Thursday at 10am instead.' },
  { role: 'assistant', content: 'Okay, updated. The design review with Marcus is now Thursday at 10am.' },
  { role: 'user', content: 'Perfect. And remind me to send him the mockups before the meeting.' },
]

// ---------------------------------------------------------------------------
// 3. Multi-hop (Alice → Acme → Boston)
// ---------------------------------------------------------------------------
const window3: ConversationTurn[] = [
  { role: 'user', content: 'Alice Chen joined Acme Robotics as a senior engineer last March.' },
  { role: 'assistant', content: 'That\'s great! Acme Robotics is doing interesting work.' },
  { role: 'user', content: 'Yeah, their headquarters moved to Boston after they got Series B funding.' },
  { role: 'assistant', content: 'So Alice is working out of Boston now?' },
  { role: 'user', content: 'Exactly. She relocated from Portland for the role.' },
]

// ---------------------------------------------------------------------------
// 4. Repeated fact with update (Bob: sales → engineering)
// ---------------------------------------------------------------------------
const window4: ConversationTurn[] = [
  { role: 'user', content: 'Bob Martinez has been in the sales department for three years.' },
  { role: 'assistant', content: 'He must know the product inside and out by now.' },
  { role: 'user', content: 'He did, but he just transferred to engineering last month. He wanted to work on the technical side.' },
  { role: 'assistant', content: 'That\'s a big switch. Is he enjoying it?' },
  { role: 'user', content: 'He loves it. Says he should have done it sooner.' },
]

// ---------------------------------------------------------------------------
// 5. Vague time references
// ---------------------------------------------------------------------------
const window5: ConversationTurn[] = [
  { role: 'user', content: 'Clara went to Japan last year for a research sabbatical.' },
  { role: 'assistant', content: 'How long was she there?' },
  { role: 'user', content: 'A few months, I think. Maybe around three or four months. She got back a while ago.' },
  { role: 'assistant', content: 'What was she researching?' },
  { role: 'user', content: 'Something about traditional fermentation techniques. She partnered with a lab at Kyoto University.' },
]

// ---------------------------------------------------------------------------
// 6. Two-hop event question
// ---------------------------------------------------------------------------
const window6: ConversationTurn[] = [
  { role: 'user', content: 'Derek came back from his Paris trip in September. Right after that he proposed to Mia.' },
  { role: 'assistant', content: 'Oh wow! How did Mia react?' },
  { role: 'user', content: 'She said yes immediately. They started planning the wedding the next week.' },
  { role: 'assistant', content: 'That\'s exciting! Do they have a date set?' },
  { role: 'user', content: 'They\'re thinking next June, probably in Mia\'s hometown of Savannah.' },
]

// ---------------------------------------------------------------------------
// 7. Conflicting preference (coffee → tea)
// ---------------------------------------------------------------------------
const window7: ConversationTurn[] = [
  { role: 'user', content: 'Elena absolutely loves coffee. She drinks at least four cups a day.' },
  { role: 'assistant', content: 'That\'s a lot of coffee!' },
  { role: 'user', content: 'Well, actually, she told me last week she switched to tea. Her doctor said the coffee was affecting her sleep.' },
  { role: 'assistant', content: 'That makes sense. What kind of tea?' },
  { role: 'user', content: 'Green tea mostly. She says she doesn\'t miss the coffee at all.' },
]

// ---------------------------------------------------------------------------
// 8. Entity with aliases (Robert / Rob / Bobby)
// ---------------------------------------------------------------------------
const window8: ConversationTurn[] = [
  { role: 'user', content: 'Robert Nakamura is our new project lead. Everyone calls him Rob.' },
  { role: 'assistant', content: 'Good to know. What project is he leading?' },
  { role: 'user', content: 'The Atlas migration project. His old team used to call him Bobby.' },
  { role: 'assistant', content: 'Rob, Bobby — same person, got it. How\'s the Atlas project going?' },
  { role: 'user', content: 'Pretty well. Rob has a lot of experience with large-scale migrations from his time at Dataflow Inc.' },
]

// ---------------------------------------------------------------------------
// 9. Plan that gets cancelled
// ---------------------------------------------------------------------------
const window9: ConversationTurn[] = [
  { role: 'user', content: 'We\'re planning a team offsite in Denver for next month.' },
  { role: 'assistant', content: 'That sounds fun! How many people are going?' },
  { role: 'user', content: 'About fifteen. Fiona is organizing the whole thing.' },
  { role: 'assistant', content: 'Great. Is there an agenda yet?' },
  { role: 'user', content: 'Actually, I just got an email. The offsite is cancelled. Budget cuts.' },
  { role: 'assistant', content: 'That\'s too bad. Maybe it can be rescheduled later.' },
  { role: 'user', content: 'Yeah, Fiona said she\'ll try again next quarter.' },
]

// ---------------------------------------------------------------------------
// 10. Relationship claim
// ---------------------------------------------------------------------------
const window10: ConversationTurn[] = [
  { role: 'user', content: 'Sarah Okafor is married to Tom Okafor. They\'ve been together for eight years.' },
  { role: 'assistant', content: 'That\'s a lovely milestone.' },
  { role: 'user', content: 'They have two kids — Liam, who is six, and Nora, who is three.' },
  { role: 'assistant', content: 'A nice family. Do they live nearby?' },
  { role: 'user', content: 'Yes, they live in Cedar Park. Sarah works at Brightpath Academy as a teacher, and Tom is a freelance graphic designer.' },
]

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const SYNTHETIC_CORPUS: ConversationTurn[][] = [
  window1,
  window2,
  window3,
  window4,
  window5,
  window6,
  window7,
  window8,
  window9,
  window10,
]

export interface CorpusQuestion {
  windowIndex: number
  question: string
  expectedAnswer: string
}

export const CORPUS_QUESTIONS: CorpusQuestion[] = [
  // Window 1: Pronoun-heavy identity
  { windowIndex: 0, question: 'Where does Vanessa work?', expectedAnswer: 'Meridian Labs' },
  { windowIndex: 0, question: 'How much did Vanessa\'s model reduce prediction error?', expectedAnswer: '23%' },

  // Window 2: Changed schedules
  { windowIndex: 1, question: 'When is the design review with Marcus?', expectedAnswer: 'Thursday at 10am (moved from Tuesday at 2pm)' },
  { windowIndex: 1, question: 'What needs to be sent to Marcus before the meeting?', expectedAnswer: 'The mockups' },

  // Window 3: Multi-hop
  { windowIndex: 2, question: 'Where does Alice Chen work?', expectedAnswer: 'Acme Robotics in Boston' },
  { windowIndex: 2, question: 'Where did Alice relocate from?', expectedAnswer: 'Portland' },

  // Window 4: Repeated fact with update
  { windowIndex: 3, question: 'What department is Bob Martinez in now?', expectedAnswer: 'Engineering (transferred from sales)' },
  { windowIndex: 3, question: 'How long was Bob in sales?', expectedAnswer: 'Three years' },

  // Window 5: Vague time references
  { windowIndex: 4, question: 'When did Clara go to Japan?', expectedAnswer: 'Last year (vague)' },
  { windowIndex: 4, question: 'What university did Clara partner with?', expectedAnswer: 'Kyoto University' },

  // Window 6: Two-hop event
  { windowIndex: 5, question: 'What happened after Derek\'s Paris trip?', expectedAnswer: 'He proposed to Mia' },
  { windowIndex: 5, question: 'Where are Derek and Mia planning the wedding?', expectedAnswer: 'Savannah (Mia\'s hometown)' },

  // Window 7: Conflicting preference
  { windowIndex: 6, question: 'Does Elena prefer coffee or tea?', expectedAnswer: 'Tea (switched from coffee on doctor\'s advice)' },
  { windowIndex: 6, question: 'Why did Elena switch from coffee to tea?', expectedAnswer: 'Her doctor said coffee was affecting her sleep' },

  // Window 8: Entity with aliases
  { windowIndex: 7, question: 'Who is leading the Atlas migration project?', expectedAnswer: 'Robert Nakamura (also known as Rob / Bobby)' },
  { windowIndex: 7, question: 'Where did Rob work before?', expectedAnswer: 'Dataflow Inc' },

  // Window 9: Plan that gets cancelled
  { windowIndex: 8, question: 'Is the Denver offsite still happening?', expectedAnswer: 'No, it was cancelled due to budget cuts' },
  { windowIndex: 8, question: 'Who is organizing the offsite?', expectedAnswer: 'Fiona' },

  // Window 10: Relationship claim
  { windowIndex: 9, question: 'Who is Sarah Okafor married to?', expectedAnswer: 'Tom Okafor' },
  { windowIndex: 9, question: 'How many children do Sarah and Tom have?', expectedAnswer: 'Two — Liam (age 6) and Nora (age 3)' },
]
