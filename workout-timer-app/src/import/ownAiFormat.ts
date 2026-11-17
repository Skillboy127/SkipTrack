/**
 * "Use your own AI" import: the prompt the user gives their own assistant, and a
 * local parser for the plain-text plan it sends back. Nothing here touches the
 * network, the server or the import allowance.
 *
 * The format, one workout per paste:
 *
 *   WORKOUT: Upper Body Push
 *   ROUNDS: 1
 *   REST BETWEEN ROUNDS: 90s          (only when ROUNDS is more than 1)
 *   - Push-ups | 3 sets | 10 reps | rest 60s
 *   - Plank | 3 sets | 40s | rest 30s
 *
 * The parser is forgiving about what assistants add around it: text before and
 * after, code fences, markdown bold, headings, other bullet styles, numbered lists,
 * markdown tables, "3 x 10", "1:30", "1 min", missing rest or sets. It is strict
 * about one thing: an exercise is a line with "|"-separated fields and either a
 * rep count or a time, so ordinary prose is never mistaken for an exercise.
 *
 * Pure and dependency-free so it can be unit-tested with node directly.
 */

export const MAX_PLAN_CHARS = 20_000;
export const MAX_EXERCISES = 60;
const MAX_LINE_CHARS = 300;
const MAX_NAME_CHARS = 60;

// Same defaults as a server import (api.ts), so both imports behave alike.
export const OWN_AI_DEFAULT_REST_SECONDS = 45;
export const OWN_AI_DEFAULT_REST_BETWEEN_ROUNDS_SECONDS = 90;

export const OWN_AI_PROMPT = `Create my workout plan in exactly this format, so I can paste it into my workout timer app (Flex).

Format rules:
- Exactly ONE workout.
- First line: WORKOUT: <short name>
- Second line: ROUNDS: <number> (how many times the whole list repeats; use 1 unless it is a circuit)
- Only if ROUNDS is more than 1, add: REST BETWEEN ROUNDS: <seconds>s
- Then one exercise per line, starting with "- ", fields separated by " | ":
  - <exercise name> | <sets> sets | <reps> reps | rest <seconds>s
  - or, for a timed exercise: <exercise name> | <sets> sets | <seconds>s | rest <seconds>s
- Each exercise has EITHER reps OR a time, never both. Whole numbers only, no ranges.
- For a move done on each side, write "(each side)" in the name and give the count for one side.
- If you include a warm-up or cool-down, list them as exercises and use ROUNDS: 1.
- Reply with only the plan inside one code block. No tables, headings or notes.

Example:
WORKOUT: Upper Body Push
ROUNDS: 1
- Arm circles | 1 set | 30s | rest 10s
- Push-ups | 3 sets | 10 reps | rest 60s
- Plank | 3 sets | 40s | rest 30s
- Reverse lunges (each side) | 2 sets | 8 reps | rest 45s

Use what you know about my goals, fitness level, equipment and any injuries or limits. If you need to know something important, ask me first.

What I want: `;

export type OwnAiExercise = {
  name: string;
  sets: number;
  /** Set for a rep exercise (then workSeconds is 0). */
  reps: number | null;
  workSeconds: number;
  restSeconds: number;
};

export type OwnAiPlan = {
  /** null when the text had no WORKOUT: line. */
  name: string | null;
  rounds: number;
  restBetweenRoundsSeconds: number | null;
  exercises: OwnAiExercise[];
  /** Short things the user should know (lines left out, a second workout ignored). */
  notes: string[];
};

export type OwnAiErrorCode = 'empty' | 'too_long' | 'no_exercises';

export type OwnAiParseResult =
  | { ok: true; plan: OwnAiPlan }
  | { ok: false; error: OwnAiErrorCode; message: string };

const MESSAGES: Record<OwnAiErrorCode, string> = {
  empty: 'Paste the plan your AI wrote first.',
  too_long: `That's too long to be one workout (over ${MAX_PLAN_CHARS.toLocaleString('en-US')} characters). Paste just the plan.`,
  no_exercises:
    "That isn't in the Flex format, so no exercises were found. Each exercise needs its own line, like " +
    '"- Push-ups | 3 sets | 10 reps | rest 60s". Copy the prompt again and ask your AI to follow it exactly.',
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Strips list markers, markdown emphasis, headings, quotes and table edges. */
function cleanLine(raw: string): string {
  let s = raw.replace(/\t/g, ' ').trim();
  s = s.replace(/[*`]/g, '').replace(/__/g, '').trim();
  // Headings, quotes, bullets and numbering, possibly stacked ("> - 1. ").
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/^(?:#{1,6}\s*|>\s*|[-+•·▪◦‣–—](?=\s|[A-Za-z])\s*|\d{1,3}[.)]\s+|\(\d{1,3}\)\s+)/, '').trim();
    if (next === s) break;
    s = next;
  }
  // Markdown table edges: "| a | b |" -> "a | b".
  s = s.replace(/^\|\s*/, '').replace(/\s*\|$/, '').trim();
  return s;
}

/** Seconds in a field such as "40s", "40 sec", "1 min", "1:30", "1 min 30 s", "90 seconds". null if none. */
export function parseDuration(field: string): number | null {
  const f = field.toLowerCase();
  const clock = f.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  let total = 0;
  let found = false;
  const min = f.match(/(\d+(?:\.\d+)?)\s*(?:m|mins?|minutes?)\b/);
  if (min) {
    total += Math.round(Number(min[1]) * 60);
    found = true;
  }
  const sec = f.match(/(\d+)\s*(?:s|secs?|seconds?)\b/);
  if (sec) {
    total += Number(sec[1]);
    found = true;
  }
  return found ? total : null;
}

const SIDE_WORDS = /\b(?:each|per|a)\s+(?:side|leg|arm)\b|\/\s*(?:side|leg|arm)\b/;

type FieldResult = { sets?: number; reps?: number; workSeconds?: number; restSeconds?: number; perSide?: boolean };

function readField(raw: string): FieldResult {
  const f = raw.toLowerCase().replace(/×/g, 'x').replace(/[–—]/g, '-').trim();
  const out: FieldResult = {};
  if (SIDE_WORDS.test(f)) out.perSide = true;

  if (/\b(?:rest|recovery|break)\b/.test(f)) {
    if (/\bno rest\b/.test(f)) out.restSeconds = 0;
    else {
      const d = parseDuration(f) ?? (f.match(/\b(\d+)\b/) ? Number(f.match(/\b(\d+)\b/)![1]) : null);
      if (d != null) out.restSeconds = d;
    }
    return out;
  }

  // "3 x 10", "3x10 reps", "3 x 30s"
  const sx = f.match(/^(\d+)\s*x\s*(\d+)\s*(s|secs?|seconds?|reps?)?\b/);
  if (sx) {
    out.sets = Number(sx[1]);
    if (sx[3] && sx[3].startsWith('s')) out.workSeconds = Number(sx[2]);
    else out.reps = Number(sx[2]);
    return out;
  }

  const sets = f.match(/(\d+)\s*(?:sets?|rounds?)\b/);
  if (sets) out.sets = Number(sets[1]);
  const reps = f.match(/(\d+)(?:\s*-\s*\d+)?\s*(?:reps?|repetitions|times)\b/);
  if (reps) out.reps = Number(reps[1]);
  if (!sets && !reps) {
    const d = parseDuration(f);
    if (d != null) out.workSeconds = d;
  }
  return out;
}

// A markdown table's header row names its columns; a bare number in a row is then
// read by its column ("| Squats | 3 | 10 | 60 |" under "Sets | Reps | Rest").
type ColumnKind = 'sets' | 'reps' | 'time' | 'rest' | 'other';

function columnKind(header: string): ColumnKind | null {
  const h = header.toLowerCase().replace(/[^a-z ]/g, ' ').trim();
  if (/^(?:exercises?|exercise name|name|movements?|moves?)$/.test(h)) return 'other';
  if (/\brest\b|\brecovery\b/.test(h)) return 'rest';
  if (/\bsets?\b|\brounds?\b/.test(h)) return 'sets';
  if (/\breps?\b|\brepetitions\b/.test(h)) return 'reps';
  if (/\btime\b|\bduration\b|\bwork\b|\bseconds?\b|\bhold\b/.test(h)) return 'time';
  if (/^(?:notes?|tips?|cues?|equipment)$/.test(h)) return 'other';
  return null;
}

/** The column kinds when this line is a table header row, otherwise null. */
function readTableHeader(fields: string[]): ColumnKind[] | null {
  if (fields.some(f => /\d/.test(f))) return null;
  const kinds = fields.map(columnKind);
  if (kinds.some(k => k === null)) return null;
  if (!kinds.slice(1).some(k => k !== 'other')) return null;
  return kinds as ColumnKind[];
}

function withColumnUnit(field: string, kind: ColumnKind | undefined): string {
  if (!/^\d+$/.test(field.trim())) return field;
  if (kind === 'sets') return `${field} sets`;
  if (kind === 'reps') return `${field} reps`;
  if (kind === 'time') return `${field}s`;
  if (kind === 'rest') return `rest ${field}s`;
  return field;
}

/** One exercise line (an object), a line in the format that can't be read ('unreadable'), or null. */
function readExercise(fields: string[], columns: ColumnKind[] | null): OwnAiExercise | 'unreadable' | null {
  let name = fields[0].replace(/[:\-–—\s]+$/, '').trim();
  if (!/[a-z]/i.test(name)) return null;

  let sets: number | undefined;
  let reps: number | undefined;
  let workSeconds: number | undefined;
  let restSeconds: number | undefined;
  let perSide = SIDE_WORDS.test(name.toLowerCase());
  for (let i = 1; i < fields.length; i++) {
    const kind = columns?.[i];
    if (kind === 'rest' && !/\b(?:rest|recovery|break)\b/i.test(fields[i]) && /\d/.test(fields[i])) {
      fields[i] = `rest ${withColumnUnit(fields[i], 'time')}`;
    }
    const r = readField(withColumnUnit(fields[i], kind));
    if (r.sets != null && sets == null) sets = r.sets;
    if (r.reps != null && reps == null) reps = r.reps;
    if (r.workSeconds != null && workSeconds == null) workSeconds = r.workSeconds;
    if (r.restSeconds != null && restSeconds == null) restSeconds = r.restSeconds;
    if (r.perSide) perSide = true;
  }
  const hasTime = workSeconds != null && workSeconds > 0;
  const hasReps = reps != null && reps > 0;
  if (!hasTime && !hasReps) return 'unreadable';

  if (perSide && !SIDE_WORDS.test(name.toLowerCase()) && !/\b(?:left|right)\b/i.test(name)) name = `${name} (each side)`;
  return {
    name: name.slice(0, MAX_NAME_CHARS).trim(),
    sets: clamp(Math.floor(sets ?? 1), 1, 20),
    // A time wins when both are given, as in a server import.
    reps: hasTime ? null : clamp(Math.floor(reps!), 1, 999),
    workSeconds: hasTime ? clamp(Math.round(workSeconds!), 1, 3600) : 0,
    restSeconds: clamp(Math.round(restSeconds ?? OWN_AI_DEFAULT_REST_SECONDS), 0, 900),
  };
}

export function parseOwnAiPlan(input: unknown): OwnAiParseResult {
  const fail = (error: OwnAiErrorCode): OwnAiParseResult => ({ ok: false, error, message: MESSAGES[error] });
  if (typeof input !== 'string' || input.trim() === '') return fail('empty');
  if (input.length > MAX_PLAN_CHARS) return fail('too_long');

  let name: string | null = null;
  let rounds: number | null = null;
  let restBetweenRounds: number | null = null;
  const exercises: OwnAiExercise[] = [];
  let unreadable = 0;
  let longLines = 0;
  let secondWorkout = false;
  let tooMany = false;
  let columns: ColumnKind[] | null = null;

  for (const raw of input.split(/\r\n|\r|\n/)) {
    if (raw.length > MAX_LINE_CHARS) {
      if (raw.includes('|')) longLines++;
      continue;
    }
    const line = cleanLine(raw);
    if (!line || line.startsWith('```') || line.startsWith('~~~')) continue;

    const workout = line.match(/^workout(?:\s*name)?\s*[:：]\s*(.+)$/i);
    if (workout) {
      if (exercises.length > 0) {
        secondWorkout = true;
        break;
      }
      name = workout[1].replace(/\s*\|.*$/, '').trim().slice(0, MAX_NAME_CHARS) || null;
      continue;
    }
    const between = line.match(/^rest\s+between\s+rounds\s*[:：]\s*(.+)$/i);
    if (between) {
      const d = parseDuration(between[1]) ?? (between[1].match(/^\d+/) ? Number(between[1].match(/^\d+/)![0]) : null);
      if (d != null && restBetweenRounds == null) restBetweenRounds = clamp(d, 0, 900);
      continue;
    }
    const roundsMatch = line.match(/^rounds?\s*[:：]\s*(\d+)/i);
    if (roundsMatch) {
      if (rounds == null) rounds = clamp(Number(roundsMatch[1]), 1, 20);
      continue;
    }

    if (!line.includes('|') || /^[\s|:\-]+$/.test(line)) continue; // prose, or a table separator
    const fields = line.split('|').map(s => s.trim()).filter(Boolean);
    if (fields.length < 2) continue;
    const header = readTableHeader(fields);
    if (header) {
      columns = header;
      continue;
    }
    // "- Rest | 60s" as its own line: the rest after the previous exercise.
    if (/^(?:rest|recovery|break)\b/i.test(fields[0])) {
      const d = parseDuration(fields.slice(1).join(' ')) ?? parseDuration(fields[0]);
      if (d != null && exercises.length > 0) exercises[exercises.length - 1].restSeconds = clamp(d, 0, 900);
      continue;
    }
    const ex = readExercise(fields, columns);
    if (ex === 'unreadable') unreadable++;
    else if (ex) {
      if (exercises.length >= MAX_EXERCISES) {
        tooMany = true;
        break;
      }
      exercises.push(ex);
    }
  }

  if (exercises.length === 0) return fail('no_exercises');

  const finalRounds = rounds ?? 1;
  const notes: string[] = [];
  const skipped = unreadable + longLines;
  if (skipped > 0) {
    notes.push(`${skipped} line${skipped === 1 ? " wasn't" : "s weren't"} in the format and ${skipped === 1 ? 'was' : 'were'} left out. Check the list before saving.`);
  }
  if (secondWorkout) notes.push('Your text had more than one workout. Only the first one was imported.');
  if (tooMany) notes.push(`Only the first ${MAX_EXERCISES} exercises were imported.`);

  return {
    ok: true,
    plan: {
      name,
      rounds: finalRounds,
      restBetweenRoundsSeconds: finalRounds > 1 ? restBetweenRounds ?? OWN_AI_DEFAULT_REST_BETWEEN_ROUNDS_SECONDS : null,
      exercises,
      notes,
    },
  };
}
