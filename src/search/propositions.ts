// @ts-nocheck
/**
 * Proposition extraction module for Engram.
 *
 * Extracts atomic factual propositions from conversational text at ingestion
 * time so that embedding-based retrieval can match questions to facts even
 * when phrasing differs significantly from the raw conversational entry.
 *
 * Pure TypeScript – no external dependencies.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface Proposition {
  text: string;
  parentId: string;
  embedding?: number[];
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Words that are pure filler in conversational speech. */
const FILLER_WORDS = new Set([
  'yeah', 'yep', 'yup', 'nah', 'oh', 'well', 'um', 'uh', 'hmm', 'hm',
  'ah', 'er', 'like', 'so', 'anyway', 'anyways', 'basically', 'actually',
  'literally', 'right', 'okay', 'ok', 'lol', 'haha', 'heh',
]);

/** Greeting / acknowledgment patterns to skip entirely. */
const SKIP_PATTERNS = [
  /^(hi|hey|hello|howdy|sup|yo|what'?s up|good (morning|afternoon|evening|night))[\s!.?]*$/i,
  /^(thanks|thank you|thx|ty|bye|goodbye|see ya|later|take care|cheers)[\s!.?]*$/i,
  /^(yes|no|yep|nope|sure|ok|okay|alright|cool|nice|great|awesome|wow|huh|mhm|mmhm|uh-huh|right|exactly|totally|definitely|absolutely|agreed|indeed)[\s!.?]*$/i,
];

/** Verb patterns that express personal facts (used after "I"). */
const PERSONAL_VERB_RE =
  /^(have been|had been|have|had|like|liked|love|loved|enjoy|enjoyed|want|wanted|need|needed|went to|went|go to|go|moved to|moved|live in|live|lived in|lived|work at|work in|work|worked at|worked in|worked|studied at|studied|study|started|start|am|was|been looking into|been interested in|been doing|been|got into|got|did|do|made|make|think|thought|prefer|preferred|play|played|bought|sold|visited|visit|learned|learn|teach|taught|grew up in|grew up|come from|came from)\b/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split text on sentence boundaries. Handles '.', '!', '?' and newlines.
 * Also splits compound personal statements like "I work at X and I studied at Y".
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space/end, or on newlines.
  let raw = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  // Further split on " and I " / " but I " to separate compound personal statements
  const expanded: string[] = [];
  for (const s of raw) {
    const parts = s.split(/\s+(?:and|but)\s+(?=I\s)/i);
    if (parts.length > 1) {
      expanded.push(...parts.map(p => p.trim()).filter(Boolean));
    } else {
      expanded.push(s);
    }
  }
  return expanded;
}

/**
 * Remove filler words that appear as standalone tokens (not inside compound
 * words). "like" is only removed when it appears as filler, not as a verb
 * (heuristic: filler "like" is preceded by a comma or is the first word).
 */
function removeFiller(sentence: string): string {
  const tokens = sentence.split(/\s+/);
  const cleaned: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase().replace(/[,.:;!?]+$/, '');

    // "like" is tricky – only strip it when it looks like filler
    if (lower === 'like') {
      // Keep "like" when it follows I/you/we/they or is preceded by "would/really/don't"
      const prev = (cleaned[cleaned.length - 1] || '').toLowerCase();
      const verbContexts = ['i', 'you', 'we', 'they', 'would', 'really', "don't", 'dont', 'also', 'to'];
      if (verbContexts.includes(prev)) {
        cleaned.push(tokens[i]);
        continue;
      }
      // Otherwise treat as filler and skip
      continue;
    }

    if (FILLER_WORDS.has(lower)) {
      continue;
    }

    cleaned.push(tokens[i]);
  }

  let result = cleaned.join(' ').trim();
  // Clean up leading commas / stray punctuation left behind
  result = result.replace(/^[,;:\s]+/, '').trim();
  return result;
}

/**
 * Extract the speaker name from a "Speaker: message" formatted line.
 * Returns [speaker | null, messageBody].
 */
function parseSpeakerLine(line: string): [string | null, string] {
  const m = line.match(/^([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?):\s*(.+)/);
  if (m) return [m[1], m[2]];
  return [null, line];
}

/**
 * Detect named entities – capitalized words that are NOT at the very start of
 * the clause and are not common sentence-start words.
 */
function findNamedEntities(sentence: string): string[] {
  const entities: string[] = [];
  // Match capitalized words not at position 0
  const re = /(?<=\s)([A-Z][a-zA-Z]{1,})/g;
  let m: RegExpExecArray | null;
  const commonWords = new Set([
    'I', 'The', 'This', 'That', 'These', 'Those', 'My', 'His', 'Her',
    'Its', 'Our', 'Your', 'Their', 'We', 'He', 'She', 'It', 'And',
    'But', 'Or', 'So', 'If', 'When', 'Then', 'Also', 'Just', 'Even',
    'Still', 'Maybe', 'Lately', 'Recently', 'Actually', 'Basically',
    'Really', 'Sometimes', 'Usually', 'Always', 'Never', 'After',
    'Before', 'During', 'Since', 'About', 'Like', 'Very', 'Pretty',
    'Quite', 'Some', 'Many', 'Much', 'Most', 'More', 'Other',
  ]);
  while ((m = re.exec(sentence)) !== null) {
    if (!commonWords.has(m[1])) {
      entities.push(m[1]);
    }
  }
  return [...new Set(entities)];
}

/**
 * Expand comma-separated lists into individual items.
 * "pottery, camping, and painting" -> ["pottery", "camping", "painting"]
 *
 * Only triggers when there are actual commas (indicating an enumeration).
 * Plain "X and Y" without commas is only split when both sides are short
 * (1-2 words each), to avoid splitting compound phrases like
 * "counseling and mental health".
 */
function expandList(fragment: string): string[] {
  const hasComma = fragment.includes(',');
  const hasAnd = /\band\b/i.test(fragment);
  if (!hasComma && !hasAnd) return [fragment];

  if (hasComma) {
    // Comma-separated list: "A, B, and C" or "A, B, C"
    const parts = fragment
      .split(/,\s*(?:and\s+)?|\s+and\s+/i)
      .map(s => s.trim())
      .filter(Boolean);
    // Only treat as list if items are short (single concepts)
    if (parts.length >= 2 && parts.every(p => p.split(/\s+/).length <= 4)) {
      return parts;
    }
    return [fragment];
  }

  // "and" without commas – only split if both halves are very short (1-2 words)
  const andParts = fragment.split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
  if (andParts.length === 2 && andParts.every(p => p.split(/\s+/).length <= 2)) {
    return andParts;
  }
  return [fragment];
}

/**
 * Try to extract a verb-phrase personal fact from a sentence starting with
 * "I verb …".  Returns the verb and object portion, or null.
 */
function parsePersonalFact(body: string): { verb: string; object: string } | null {
  // Strip leading filler like "Lately," / "Recently," etc.
  const stripped = body.replace(/^(lately|recently|honestly|personally|currently|right now|these days|at the moment)[,;]?\s*/i, '');

  const m = stripped.match(/^I(?:'ve|'m|'d)?\s+(.+)/i);
  if (!m) return null;

  const rest = m[1];
  const verbMatch = rest.match(PERSONAL_VERB_RE);
  if (!verbMatch) return null;

  const verb = verbMatch[0].toLowerCase();
  let object = rest.slice(verbMatch[0].length).trim().replace(/[.!?]+$/, '').trim();
  if (!object) return null;

  // Lowercase the first word of object unless it looks like a proper noun.
  // Heuristic: if the word following the capital is all lowercase and is a
  // common English word (not a name), lowercase it. We use a simple check:
  // if the verb already contains a preposition (at, in, to, from) the next
  // word is likely a proper noun destination, so keep it capitalized.
  const verbHasPrep = /\b(at|in|to|from|into)\s*$/i.test(verb);
  if (!verbHasPrep) {
    object = object.replace(/^([A-Z])([a-z])/, (_m, c1, c2) => c1.toLowerCase() + c2);
  }

  return { verb, object };
}

/**
 * Normalize a proposition string: trim, collapse whitespace, strip trailing
 * punctuation, ensure first letter is capitalized.
 */
function normalize(s: string): string {
  let r = s.trim().replace(/\s+/g, ' ').replace(/[.!?;,]+$/, '').trim();
  if (r.length === 0) return r;
  return r;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Extract atomic factual propositions from conversational text.
 *
 * Input is either a single conversational turn ("Caroline: I moved here from
 * Sweden about 4 years ago.") or a block of multiple turns separated by
 * newlines.
 *
 * Returns an array of proposition strings suitable for embedding and
 * similarity search.
 */
export function extractPropositions(content: string): string[] {
  if (!content || typeof content !== 'string') return [];

  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const propositions: string[] = [];

  for (const line of lines) {
    const [speaker, body] = parseSpeakerLine(line);
    const sentences = splitSentences(body);

    for (const rawSentence of sentences) {
      // Skip very short utterances
      if (rawSentence.length < 10) continue;

      // Skip greetings / acknowledgments
      if (SKIP_PATTERNS.some(p => p.test(rawSentence))) continue;

      // Remove filler
      const cleaned = removeFiller(rawSentence);
      if (cleaned.length < 10) continue;

      const label = speaker || '';

      // ── Personal fact pattern ("I verb object") ────────────────────
      const personal = parsePersonalFact(cleaned);
      if (personal) {
        const items = expandList(personal.object);

        if (items.length > 1) {
          // Expand list into individual propositions
          for (const item of items) {
            const prop = label
              ? `${label}: ${personal.verb} ${normalize(item)}`
              : `${personal.verb} ${normalize(item)}`;
            const n = normalize(prop);
            if (n.length >= 8) propositions.push(n);
          }
        } else {
          const prop = label
            ? `${label}: ${personal.verb} ${normalize(personal.object)}`
            : `${personal.verb} ${normalize(personal.object)}`;
          const n = normalize(prop);
          if (n.length >= 8) propositions.push(n);
        }
        continue;
      }

      // ── Named entity facts ────────────────────────────────────────
      const entities = findNamedEntities(cleaned);
      if (entities.length > 0 && !speaker) {
        // If no speaker prefix but there are named entities, use them as labels
        for (const entity of entities) {
          const factPart = cleaned
            .replace(new RegExp(`\\b${entity}\\b`, 'g'), '')
            .replace(/\s+/g, ' ')
            .trim();
          const n = normalize(`${entity}: ${factPart}`);
          if (n.length >= 8) propositions.push(n);
        }
        continue;
      }

      // ── Fallback: keep the cleaned sentence with speaker label ────
      const prop = label ? `${label}: ${normalize(cleaned)}` : normalize(cleaned);
      if (prop.length >= 8) propositions.push(prop);
    }
  }

  // Deduplicate
  return [...new Set(propositions)];
}
