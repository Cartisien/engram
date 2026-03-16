/**
 * Synthetic Corpus — 10 conversation windows covering hard extraction cases.
 *
 * Each window is a ConversationTurn[] with fictional names and realistic dialogue.
 */
import type { ConversationTurn } from '../../src/compiler/schemas.js';
export declare const SYNTHETIC_CORPUS: ConversationTurn[][];
export interface CorpusQuestion {
    windowIndex: number;
    question: string;
    expectedAnswer: string;
}
export declare const CORPUS_QUESTIONS: CorpusQuestion[];
//# sourceMappingURL=synthetic-corpus.d.ts.map