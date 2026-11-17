// node --experimental-strip-types --test src/web/web.test.mjs
// Tests for the web version: the countdown resume math, the platform wording, and
// that every .web file provides everything the shared code imports from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planClipStart, CLIP_LAST_START_MS } from './clipResume.ts';
import * as androidCopy from '../platformCopy.ts';
import * as webCopy from '../platformCopy.web.ts';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ─── Resuming a countdown clip (e.g. after the iPhone was locked) ────────────

test('a clip whose start is still ahead starts as planned', () => {
  assert.deepEqual(planClipStart(10_000, 0, 8_000), { positionMs: 0, startInMs: 2000 });
  assert.deepEqual(planClipStart(10_000, 2000, 9_000), { positionMs: 2000, startInMs: 1000 });
});

test('resumed mid-countdown: passed beeps are skipped, the next one keeps its exact moment', () => {
  // Planned to start at t=10000 from position 0 (beeps at +100, +1100, +2100, go at +3100).
  // Now t=11500: the "3" and the "2" have passed; start at position 2000 at t=12000.
  assert.deepEqual(planClipStart(10_000, 0, 11_500), { positionMs: 2000, startInMs: 500 });
  // Right on a start point: too close to schedule safely, so the next one.
  assert.deepEqual(planClipStart(10_000, 0, 11_990), { positionMs: 3000, startInMs: 1010 });
  // Started from a later offset.
  assert.deepEqual(planClipStart(10_000, 1000, 10_400), { positionMs: 2000, startInMs: 600 });
});

test('resumed after the countdown is over: nothing plays', () => {
  assert.equal(planClipStart(10_000, 0, 13_100), null);
  assert.equal(planClipStart(10_000, 0, 60_000), null);
  assert.equal(planClipStart(10_000, CLIP_LAST_START_MS, 10_100), null);
});

test('the "go" is never moved: whatever position is chosen, it still lands at start + 3100 - offset', () => {
  const startAt = 50_000;
  for (const offset of [0, 1000, 2000, 3000]) {
    for (let now = startAt - 3000; now < startAt + 3500; now += 37) {
      const plan = planClipStart(startAt, offset, now);
      if (!plan) continue;
      const goAt = now + plan.startInMs + (3100 - plan.positionMs);
      assert.equal(goAt, startAt + 3100 - offset);
      assert.ok(plan.startInMs >= 20, 'never scheduled closer than the margin');
      assert.equal(plan.positionMs % 1000, 0);
    }
  }
});

// ─── Wording ─────────────────────────────────────────────────────────────────

test('the Android wording is exactly as before', () => {
  assert.deepEqual(
    androidCopy.ONBOARDING_SLIDES.map(s => s.title),
    ['Welcome to Flex', 'Import any workout', 'Build your own', 'Choose your countdown', 'Adjust on the fly', 'Free, with ads'],
  );
  assert.ok(androidCopy.ONBOARDING_SLIDES[5].body.includes('Free users get 7 imports each month.'));
  assert.ok(androidCopy.ONBOARDING_SLIDES[1].body.startsWith('Snap a photo'));
  assert.equal(androidCopy.LIBRARY_EMPTY_BODY, 'Start with a free starter workout, import one from a photo or text, or build your own.');
  assert.equal(androidCopy.LIBRARY_IMPORT_LABEL, 'Import a workout from a photo or text');
  assert.equal(androidCopy.PRIVACY_POLICY_URL, 'https://harshtalnikar.github.io/flex/privacy/');
});

test('the web wording has no photo import, no "with ads", no import limits', () => {
  const all = [
    ...webCopy.ONBOARDING_SLIDES.flatMap(s => [s.title, s.body]),
    webCopy.LIBRARY_EMPTY_BODY,
    webCopy.LIBRARY_IMPORT_LABEL,
  ].join('\n');
  assert.doesNotMatch(all, /photo|snap|camera/i);
  assert.doesNotMatch(all, /with ads|supported by ads|imports each month|free users/i);
  assert.match(all, /no ads/i);
  assert.match(all, /Add to Home Screen/);
  assert.equal(webCopy.PRIVACY_POLICY_URL, '/privacy.html');
});

test('both versions keep the same slide structure (preferences and starters on the same slides)', () => {
  assert.equal(webCopy.ONBOARDING_SLIDES.length, androidCopy.ONBOARDING_SLIDES.length);
  webCopy.ONBOARDING_SLIDES.forEach((s, i) => {
    assert.equal(!!s.preferences, !!androidCopy.ONBOARDING_SLIDES[i].preferences);
    assert.equal(!!s.starters, !!androidCopy.ONBOARDING_SLIDES[i].starters);
  });
});

// ─── Every .web file provides what the shared code imports from it ─────────

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)],
  );
}

function exportedNames(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class|type|interface)\s+(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default\b/.test(src)) names.add('default');
  if (/export\s*\*\s*from/.test(src)) names.add('*');
  return names;
}

function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of ['.ts', '.tsx']) if (fs.existsSync(base + ext)) return base;
  return null;
}

test('every .web file exports every name the shared code imports from that module', () => {
  const files = [...walk(path.join(APP_ROOT, 'src')), path.join(APP_ROOT, 'App.tsx'), path.join(APP_ROOT, 'index.ts')]
    .filter(f => /\.(ts|tsx)$/.test(f) && !/\.(web|test)\.(ts|tsx)$/.test(f))
    // A file that has its own .web replacement is never part of the web build.
    .filter(f => !['.web.ts', '.web.tsx'].some(ext => fs.existsSync(f.replace(/\.(ts|tsx)$/, ext))));
  const problems = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s+(type\s+)?([\w*{}\s,]+?)\s+from\s+'([^']+)'/g)) {
      const base = resolveModule(file, m[3]);
      if (!base) continue;
      const webFile = ['.web.ts', '.web.tsx'].map(ext => base + ext).find(f => fs.existsSync(f));
      if (!webFile) continue;
      const exported = exportedNames(webFile);
      if (exported.has('*')) continue;
      const clause = m[2].trim();
      const wanted = [];
      const braces = clause.match(/\{([^}]*)\}/);
      if (braces) {
        for (const part of braces[1].split(',')) {
          const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
          if (name) wanted.push(name);
        }
      }
      const head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
      if (head && !head.startsWith('*')) wanted.push('default');
      for (const name of wanted) {
        if (!exported.has(name)) problems.push(`${path.relative(APP_ROOT, file)} imports "${name}" from ${m[3]}, missing in ${path.relative(APP_ROOT, webFile)}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
