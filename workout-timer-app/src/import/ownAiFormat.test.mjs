// node --experimental-strip-types --test src/import/ownAiFormat.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EXERCISES,
  MAX_PLAN_CHARS,
  OWN_AI_DEFAULT_REST_BETWEEN_ROUNDS_SECONDS,
  OWN_AI_DEFAULT_REST_SECONDS,
  OWN_AI_PROMPT,
  parseDuration,
  parseOwnAiPlan,
} from './ownAiFormat.ts';

const ok = text => {
  const r = parseOwnAiPlan(text);
  assert.equal(r.ok, true, r.ok ? '' : `expected a plan, got ${r.error}`);
  return r.plan;
};
const fails = (text, error) => {
  const r = parseOwnAiPlan(text);
  assert.equal(r.ok, false);
  assert.equal(r.error, error);
  assert.ok(r.message.length > 10);
  return r;
};
const short = ex => ex.map(e => [e.name, e.sets, e.reps, e.workSeconds, e.restSeconds]);

const CLEAN = `WORKOUT: Upper Body Push
ROUNDS: 1
- Arm circles | 1 set | 30s | rest 10s
- Push-ups | 3 sets | 10 reps | rest 60s
- Plank | 3 sets | 40s | rest 30s
- Reverse lunges (each side) | 2 sets | 8 reps | rest 45s`;

const CLEAN_EXERCISES = [
  ['Arm circles', 1, null, 30, 10],
  ['Push-ups', 3, 10, 0, 60],
  ['Plank', 3, null, 40, 30],
  ['Reverse lunges (each side)', 2, 8, 0, 45],
];

test('the exact format', () => {
  const p = ok(CLEAN);
  assert.equal(p.name, 'Upper Body Push');
  assert.equal(p.rounds, 1);
  assert.equal(p.restBetweenRoundsSeconds, null);
  assert.deepEqual(short(p.exercises), CLEAN_EXERCISES);
  assert.deepEqual(p.notes, []);
});

test('the example inside the prompt parses to the same plan', () => {
  const example = OWN_AI_PROMPT.slice(OWN_AI_PROMPT.indexOf('Example:'));
  const p = ok(example);
  assert.equal(p.name, 'Upper Body Push');
  assert.deepEqual(short(p.exercises), CLEAN_EXERCISES);
});

test('the prompt asks for the format and gives an example', () => {
  assert.ok(OWN_AI_PROMPT.startsWith('Create my workout plan in exactly this format'));
  assert.ok(OWN_AI_PROMPT.includes('Example:'));
  assert.ok(OWN_AI_PROMPT.length < 2500);
});

test('chatty text before and after the plan is ignored', () => {
  const p = ok(`Sure! Based on what you told me about your knee, here's a plan that avoids jumping.

${CLEAN}

Tips:
- Warm up properly before you start.
- Rest when you need to; listen to your body.
Let me know if you'd like a harder version!`);
  assert.deepEqual(short(p.exercises), CLEAN_EXERCISES);
  assert.deepEqual(p.notes, []);
});

test('markdown: code fences, bold, headings, numbered and other bullets', () => {
  const p = ok(`### Your plan
\`\`\`text
**WORKOUT:** Upper Body Push
**ROUNDS:** 1
1. **Arm circles** | 1 set | 30s | rest 10s
2) Push-ups | 3 sets | 10 reps | rest 60s
* Plank | 3 sets | 40s | rest 30s
• \`Reverse lunges (each side)\` | 2 sets | 8 reps | rest 45s
\`\`\``);
  assert.equal(p.name, 'Upper Body Push');
  assert.deepEqual(short(p.exercises), CLEAN_EXERCISES);
});

test('missing rest, sets or rounds fall back to defaults', () => {
  const p = ok(`WORKOUT: Quick
- Squats | 15 reps
- Wall sit | 45 seconds`);
  assert.deepEqual(short(p.exercises), [
    ['Squats', 1, 15, 0, OWN_AI_DEFAULT_REST_SECONDS],
    ['Wall sit', 1, null, 45, OWN_AI_DEFAULT_REST_SECONDS],
  ]);
  assert.equal(p.rounds, 1);
});

test('rounds, with and without a rest between rounds', () => {
  let p = ok(`WORKOUT: Circuit\nROUNDS: 3\nREST BETWEEN ROUNDS: 2 min\n- Burpees | 40s | rest 20s`);
  assert.equal(p.rounds, 3);
  assert.equal(p.restBetweenRoundsSeconds, 120);
  p = ok(`ROUNDS: 4\n- Burpees | 40s | rest 20s`);
  assert.equal(p.restBetweenRoundsSeconds, OWN_AI_DEFAULT_REST_BETWEEN_ROUNDS_SECONDS);
  assert.equal(p.name, null, 'no WORKOUT line: the app suggests a name');
});

test('other ways of writing sets, reps and times', () => {
  const p = ok(`- Squats | 3x12 | rest 90 seconds
- Rows | 4 × 8 reps | Rest: 1 min
- Plank | 3 x 30s | rest 1:00
- Curls | 3 sets | 8-12 reps | rest 45 sec
- Run | 1 set | 5 min | rest 1 min 30 s
- Hold | 1:30 | no rest
- Lunges | 3 sets | 10 reps each leg | rest 60s
- Side plank | 2 sets | 30s per side | rest 15s`);
  assert.deepEqual(short(p.exercises), [
    ['Squats', 3, 12, 0, 90],
    ['Rows', 4, 8, 0, 60],
    ['Plank', 3, null, 30, 60],
    ['Curls', 3, 8, 0, 45], // a range: its first number
    ['Run', 1, null, 300, 90],
    ['Hold', 1, null, 90, 0],
    ['Lunges (each side)', 3, 10, 0, 60],
    ['Side plank (each side)', 2, null, 30, 15],
  ]);
});

test('a time wins when an exercise has both a time and reps', () => {
  const p = ok('- Jump rope | 50 reps | 60s | rest 30s');
  assert.deepEqual(short(p.exercises), [['Jump rope', 1, null, 60, 30]]);
});

test('a markdown table is read by its columns', () => {
  const p = ok(`Here you go:

| Exercise | Sets | Reps | Rest |
|---|---|---|---|
| Push-ups | 3 | 10 | 60 |
| Plank | 3 | 40s | 30s |
| **Squats** | 4 | 12 | 90 |`);
  assert.deepEqual(short(p.exercises), [
    ['Push-ups', 3, 10, 0, 60],
    ['Plank', 3, null, 40, 30],
    ['Squats', 4, 12, 0, 90],
  ]);
});

test('a table with a Time column', () => {
  const p = ok(`| Move | Time | Rest |\n|:--|:--:|--:|\n| Burpees | 40 | 20 |\n| High knees | 40 | 20 |`);
  assert.deepEqual(short(p.exercises), [['Burpees', 1, null, 40, 20], ['High knees', 1, null, 40, 20]]);
});

test('"Rest" written as its own line becomes the rest after the exercise before it', () => {
  const p = ok(`- Rest | 30s\n- Push-ups | 10 reps\n- Rest | 90s\n- Squats | 12 reps`);
  assert.deepEqual(short(p.exercises), [['Push-ups', 1, 10, 0, 90], ['Squats', 1, 12, 0, 45]]);
});

test('a table with a notes column', () => {
  const p = ok(`| Exercise | Reps | Rest | Notes |\n|--|--|--|--|\n| Lunges | 8 | 45 | Keep your knee over your ankle |\n| Plank | 30s | 30 | Brace, don't hold your breath |`);
  assert.deepEqual(short(p.exercises), [['Lunges', 1, 8, 0, 45], ['Plank', 1, null, 30, 30]]);
});

test('lines in the format that cannot be read are left out, and the user is told', () => {
  const p = ok(`- Push-ups | 3 sets | 10 reps
- Squats | 3 sets
- Pull-ups | as many as you can`);
  assert.deepEqual(p.exercises.map(e => e.name), ['Push-ups']);
  assert.equal(p.notes.length, 1);
  assert.match(p.notes[0], /^2 lines weren't in the format/);
});

test('only the first of several workouts is used', () => {
  const p = ok(`WORKOUT: Day 1\n- Squats | 10 reps\nWORKOUT: Day 2\n- Push-ups | 10 reps`);
  assert.equal(p.name, 'Day 1');
  assert.deepEqual(p.exercises.map(e => e.name), ['Squats']);
  assert.ok(p.notes.some(n => /more than one workout/.test(n)));
});

test('a "Workout:" line in the chatter before the plan is replaced by the real one', () => {
  const p = ok(`Workout: here is something for you!\n\nWORKOUT: Legs\n- Squats | 10 reps`);
  assert.equal(p.name, 'Legs');
});

test('values are clamped to sane ranges', () => {
  const p = ok(`ROUNDS: 500\nREST BETWEEN ROUNDS: 99999s\n- Squats | 999 sets | 100000 reps | rest 50000s\n- Hold | 9999 min`);
  assert.equal(p.rounds, 20);
  assert.equal(p.restBetweenRoundsSeconds, 900);
  assert.deepEqual(short(p.exercises), [['Squats', 20, 999, 0, 900], ['Hold', 1, null, 3600, 45]]);
});

test('long names are cut', () => {
  const p = ok(`WORKOUT: ${'A'.repeat(200)}\n- ${'B'.repeat(200)} | 10 reps`);
  assert.equal(p.name.length, 60);
  assert.equal(p.exercises[0].name.length, 60);
});

test('empty input', () => {
  for (const v of ['', '   ', '\n\n\t', null, undefined, 42, {}]) fails(v, 'empty');
});

test('very long input is refused before any parsing', () => {
  const huge = CLEAN + '\n' + 'x'.repeat(MAX_PLAN_CHARS);
  const started = Date.now();
  fails(huge, 'too_long');
  assert.ok(Date.now() - started < 50);
  fails('- Squats | 10 reps\n'.repeat(Math.ceil((MAX_PLAN_CHARS + 1) / 19)), 'too_long');
});

test('right at the limit still works, and stays fast', () => {
  const line = '- Squats | 3 sets | 10 reps | rest 60s\n';
  const text = (CLEAN + '\n').padEnd(MAX_PLAN_CHARS - line.length, '\n') + line;
  assert.equal(text.length, MAX_PLAN_CHARS);
  const started = Date.now();
  const p = ok(text);
  assert.equal(p.exercises.length, 5);
  assert.deepEqual(p.notes, []);
  assert.ok(Date.now() - started < 200);
});

test('pathological lines do not hang the parser', () => {
  const nasty = ['|'.repeat(290), '- ' + '1 '.repeat(140) + '| rest', '-'.repeat(299) + '|', '1:'.repeat(140) + '| 10 reps', ' '.repeat(250) + 'a|1s'];
  const started = Date.now();
  for (let i = 0; i < 60; i++) parseOwnAiPlan(nasty.join('\n'));
  assert.ok(Date.now() - started < 1000);
});

test('very long single lines are skipped', () => {
  const p = ok(`- Squats | 10 reps\n- ${'x'.repeat(400)} | 10 reps`);
  assert.deepEqual(p.exercises.map(e => e.name), ['Squats']);
  assert.match(p.notes[0], /^1 line wasn't in the format/);
});

test('more than the maximum number of exercises is capped', () => {
  const text = Array.from({ length: MAX_EXERCISES + 5 }, (_, i) => `- Move ${i + 1} | 10 reps`).join('\n');
  const p = ok(text);
  assert.equal(p.exercises.length, MAX_EXERCISES);
  assert.ok(p.notes.some(n => n.includes(String(MAX_EXERCISES))));
});

test('text that is not in the format fails clearly', () => {
  for (const text of [
    'Do 3 sets of 10 push-ups, then plank for 40 seconds, then 12 squats.',
    'WORKOUT: Legs\nROUNDS: 3',
    '1. Push-ups: 3 sets of 10\n2. Squats: 3 x 12',
    '| Exercise | Sets | Reps |\n|---|---|---|',
    'I\'m sorry, I can\'t help with that.',
    '```\n```',
  ]) {
    const r = fails(text, 'no_exercises');
    assert.match(r.message, /Flex format/);
  }
});

test('Windows and old Mac line endings', () => {
  assert.deepEqual(short(ok(CLEAN.replace(/\n/g, '\r\n')).exercises), CLEAN_EXERCISES);
  assert.deepEqual(short(ok(CLEAN.replace(/\n/g, '\r')).exercises), CLEAN_EXERCISES);
});

test('parseDuration', () => {
  assert.equal(parseDuration('40s'), 40);
  assert.equal(parseDuration('40 sec'), 40);
  assert.equal(parseDuration('1.5 min'), 90);
  assert.equal(parseDuration('2:05'), 125);
  assert.equal(parseDuration('1 minute 15 seconds'), 75);
  assert.equal(parseDuration('3 sets'), null);
  assert.equal(parseDuration('10 reps'), null);
  assert.equal(parseDuration('soon'), null);
});
