// Runs the puzzle validator + a few unit checks against the core script in index.html.
// Usage: node tools/validate.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const Fritz = vm.runInNewContext(core + '\n;Fritz', {});

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`); }
};

console.log('\nValidator (5,000 random inputs per machine)');
for (const r of Fritz.validate()) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(18)} glitch rate ${(r.rate * 100).toFixed(1)}%`);
  r.errors.forEach(e => console.log(`        - ${e}`));
  if (!r.pass) failed++;
}

console.log('\nUnit checks');
check('launch day is #1, Vowel Counter', () => {
  assert.equal(Fritz.puzzleNumber(new Date(2026, 9, 12, 0, 5)), 1);
  assert.equal(Fritz.puzzleFor(1).name, 'Vowel Counter');
});
check('Fri 2026-10-16 is #5, Leap Year Oracle', () => {
  assert.equal(Fritz.puzzleNumber(new Date(2026, 9, 16, 23, 59)), 5);
  assert.equal(Fritz.puzzleFor(5).name, 'Leap Year Oracle');
});
check('every puzzle lands on its own weekday', () => {
  for (let i = 0; i < 60; i++) {
    const d = new Date(2026, 9, 12 + i, 12);
    const p = Fritz.puzzleFor(Fritz.puzzleNumber(d));
    assert.equal(p.day, d.toLocaleDateString('en-US', { weekday: 'short' }));
  }
});
check('DST change (US, 1 Nov 2026) does not skip a puzzle', () => {
  assert.equal(Fritz.puzzleNumber(new Date(2026, 10, 2, 0, 30)) - Fritz.puzzleNumber(new Date(2026, 10, 1, 0, 30)), 1);
});
check('share text: win', () => {
  const s = Fritz.shareText({ num: 23, puzzle: Fritz.PUZZLES[5], hard: false, won: true, runsUsed: 3, maxRuns: 8, predictions: [true, true, false] });
  assert.equal(s, 'Fritz #23 · Tip-o-matic\nGlitch hunter\nFound it in 3 runs, 2 under par  ⬜⬜🟥\nPredicted 2 of 3  ✅✅❌\nshivanshi-das.github.io/fritz');
});
check('share text: hard-mode loss', () => {
  const s = Fritz.shareText({ num: 23, puzzle: Fritz.PUZZLES[5], hard: true, won: false, runsUsed: 4, maxRuns: 4, predictions: [] });
  assert.equal(s, 'Fritz #23 · Tip-o-matic · hard mode\nThe glitch survived\nNot found in 4 runs  ⬜⬜⬜⬜\nshivanshi-das.github.io/fritz');
});
check('ranks', () => {
  const r = (won, runsUsed) => Fritz.rank({ won, runsUsed, par: 4 });
  assert.deepEqual([r(true, 1), r(true, 3), r(true, 4), r(true, 6), r(false, 8)],
    ['Clairvoyant', 'Glitch hunter', 'Debugger', 'Persistent', 'The glitch survived']);
});
check('predictions: 3 unique, unran, >=1 glitch and >=1 normal, even if player ran the whole pool', () => {
  for (const p of Fritz.PUZZLES) {
    const g = p.predictionPool.filter(p.isGlitchCase);
    const scenarios = [[], g, p.predictionPool.filter(x => !p.isGlitchCase(x)), p.predictionPool];
    for (const ran of scenarios) for (let seed = 1; seed <= 20; seed++) {
      const picks = Fritz.pickPredictions(p, seed, ran);
      const keys = picks.map(Fritz.inputKey);
      assert.equal(new Set(keys).size, 3, p.name);
      assert.ok(!ran.some(x => keys.includes(Fritz.inputKey(x))), `${p.name}: picked a ran input`);
      assert.ok(picks.some(p.isGlitchCase) && picks.some(x => !p.isGlitchCase(x)), `${p.name}: missing a kind`);
    }
  }
});
check('options always contain the machine output, 2-4 unique choices', () => {
  for (const p of Fritz.PUZZLES) for (const x of p.predictionPool) {
    const o = Fritz.buildOptions(p, x, 1);
    assert.ok(o.includes(Fritz.out(p, 'buggy', x)), `${p.name} ${Fritz.inputKey(x)}`);
    assert.ok(o.length >= 2 && o.length <= 4 && new Set(o).size === o.length, `${p.name} ${JSON.stringify(o)}`);
  }
});
check('input validation', () => {
  const f = (type, raw, extra = {}) => Fritz.parseField({ type, ...extra }, raw).ok;
  assert.equal(f('money', '12.345'), false);
  assert.equal(f('money', '$12.34'), true);
  assert.equal(f('int', '1.5', { min: 1, max: 9 }), false);
  assert.equal(f('int', '0', { min: 1, max: 9 }), false);
  assert.equal(f('list', 'a,,b'), false);
  assert.equal(f('text', 'a\tb'), false);
  assert.equal(f('text', '  '), true);
  assert.equal(f('date', '2023-02-29'), false);
  assert.equal(f('date', '2024-02-29'), true);
});
check('Tomorrow Machine edge cases', () => {
  const p = Fritz.PUZZLES[6];
  const b = d => Fritz.out(p, 'buggy', { date: d });
  assert.equal(b('2024-02-28'), '2024-03-01');
  assert.equal(b('2024-02-29'), '2024-03-01');
  assert.equal(b('2025-12-31'), '2026-01-01');
  assert.equal(Fritz.out(p, 'reference', { date: '2024-02-28' }), '2024-02-29');
});

check('stats: streaks, missed days, losses, histogram', () => {
  const W = (runsUsed, correct = 3) => ({ won: true, runsUsed, correct }), L = { won: false, runsUsed: 8, correct: 0 };
  let s = Fritz.computeStats({}, 10);
  assert.deepEqual([s.played, s.winPct, s.current, s.best, s.avgCorrect], [0, 0, 0, 0, null]);
  // won 3..5, lost 6, won 8..9 (7 missed). Today = 10, unplayed: streak still alive at 2.
  const h = { 3: W(2), 4: W(3, 1), 5: W(2, 2), 6: L, 8: W(1), 9: W(5, 0) };
  s = Fritz.computeStats(h, 10);
  assert.deepEqual([s.played, s.winPct, s.current, s.best, s.losses], [6, 83, 2, 3, 1]);
  assert.equal(s.hist[2], 2); assert.equal(s.hist[1], 1); assert.equal(s.avgCorrect, 1.8);
  assert.equal(Fritz.computeStats(h, 11).current, 0, 'missed yesterday breaks it');
  assert.equal(Fritz.computeStats({ ...h, 10: L }, 10).current, 0, 'loss today breaks it');
  assert.equal(Fritz.computeStats({ ...h, 10: W(4) }, 10).current, 3);
});

// The core runs in its own vm realm, so its arrays need flattening before a strict deepEqual with ours.
const plain = v => JSON.parse(JSON.stringify(v));

console.log('\nHints');
check('every machine has 2-3 distinct, non-empty hints', () => {
  for (const p of [...Fritz.PUZZLES, Fritz.TUTORIAL]) {
    assert.ok(p.hints.length >= 2 && p.hints.length <= 3, p.name);
    assert.ok(p.hints.every(h => typeof h === 'string' && h.trim()), p.name);
    assert.equal(new Set(p.hints).size, p.hints.length, p.name);
  }
});
check('hints: available from the start, one per tap, capped, never after the game is over', () => {
  const p = Fritz.PUZZLES[4], n = p.hints.length; // Leap Year Oracle, 3 hints
  assert.equal(Fritz.canHint(p, 0), true, 'available before any run');
  assert.deepEqual(plain(Fritz.shownHints(p, 0)), [], 'nothing shows until asked');
  let used = 0;
  for (let i = 1; i <= n; i++) {
    used = Fritz.revealHint(p, used);
    assert.equal(used, i);
    assert.deepEqual(Fritz.shownHints(p, used), p.hints.slice(0, i), 'in order, one more each tap');
  }
  assert.equal(Fritz.canHint(p, used), false);
  assert.equal(Fritz.revealHint(p, used), n, 'capped at the last hint');
  assert.equal(Fritz.revealHint(p, 1, false), 1, 'no reveal once the glitch is found or runs are out');
  assert.equal(Fritz.canHint(p, 0, false), false);
});
check('hints: a saved count survives a reload, and bad saved values are made safe', () => {
  const p = Fritz.PUZZLES[0];
  const reloaded = JSON.parse(JSON.stringify({ hints: 2 })).hints;
  assert.deepEqual(Fritz.shownHints(p, reloaded), p.hints.slice(0, 2));
  assert.deepEqual([undefined, null, -3, 99, 'x', 1.9].map(v => Fritz.clampHints(p, v)), [0, 0, 0, p.hints.length, 0, 1]);
});
check('share text: hints and time are words on the card, and nothing from the hint text leaks', () => {
  const p = Fritz.PUZZLES[5];
  const base = { num: 23, puzzle: p, hard: false, runsUsed: 3, maxRuns: 8 };
  const win = Fritz.shareText({ ...base, won: true, predictions: [true, true, false], hints: 1, ms: 134000 });
  assert.equal(win, 'Fritz #23 · Tip-o-matic\nGlitch hunter · 1 hint\nFound it in 3 runs, 2 under par  ⬜⬜🟥\nPredicted 2 of 3  ✅✅❌\nTime 2:14\nshivanshi-das.github.io/fritz');
  const loss = Fritz.shareText({ ...base, won: false, runsUsed: 8, predictions: [], hints: 3 });
  assert.equal(loss, 'Fritz #23 · Tip-o-matic\nThe glitch survived · 3 hints\nNot found in 8 runs  ⬜⬜⬜⬜⬜⬜⬜⬜\nshivanshi-das.github.io/fritz');
  for (const h of p.hints) assert.ok(!win.includes(h) && !loss.includes(h));
  assert.ok(!win.includes(p.glitchRule));
  const plain = Fritz.shareText({ ...base, won: true, predictions: [true, true, true], hints: 0, ms: null });
  assert.ok(!/hint|Time/.test(plain), 'no hints, no time: card is unchanged');
  assert.deepEqual([Fritz.hintWord(0), Fritz.hintWord(1), Fritz.hintWord(2)], ['', '1 hint', '2 hints']);
});

console.log('\nPlaytest timer');
check('timer: first run to result, wall and active time', () => {
  const T = Fritz.timer;
  let r = T.start(null, 1000);
  assert.deepEqual([r.startedAt, r.endedAt, r.activeMs], [1000, null, 0]);
  assert.equal(T.start(r, 5000).startedAt, 1000, 'a second run does not restart the clock');
  assert.equal(T.active(r, 4000), 3000, 'live reading while running');
  r = T.stop(r, 61000);
  assert.deepEqual([r.endedAt, r.wallMs, r.activeMs], [61000, 60000, 60000]);
  assert.equal(T.stop(r, 99000).wallMs, 60000, 'stopping twice changes nothing');
  assert.equal(T.active(r, 99000), 60000);
});
check('timer: hidden tab pauses active time; a reload never counts time away', () => {
  const T = Fritz.timer;
  let r = T.start(null, 0);
  r = T.pause(r, 10000);                 // tab hidden after 10s
  assert.equal(T.pause(r, 500000).activeMs, 10000, 'pausing twice adds nothing');
  assert.equal(T.active(r, 500000), 10000);
  r = T.resume(r, 600000);               // back 10 minutes later
  assert.equal(T.resume(r, 700000).resumedAt, 600000, 'resuming twice does not move the mark');
  r = T.stop(r, 605000);
  assert.deepEqual([r.activeMs, r.wallMs], [15000, 605000]);
  // Page killed without a pause event: the open stretch is dropped on reopen, not counted.
  let k = T.start(null, 0);
  k = JSON.parse(JSON.stringify(k));     // what localStorage hands back
  k = T.reopen(k, 3600000);
  assert.equal(T.stop(k, 3605000).activeMs, 5000);
  assert.equal(T.reopen(null, 5), null);
  assert.equal(T.reopen(r, 9e9), r, 'a finished record is left alone');
});
check('timer: extra fields survive, export is plain JSON for both storage sets', () => {
  const T = Fritz.timer;
  const done = { ...T.stop({ ...T.start(null, Date.UTC(2026, 10, 13, 12)), machine: 'Leap Year Oracle', hard: false }, Date.UTC(2026, 10, 13, 12, 2, 14)), runs: 6, hints: 1, won: true };
  const open = T.start(null, Date.UTC(2026, 10, 14, 9));
  const now = Date.UTC(2026, 10, 14, 9, 0, 30);
  const x = JSON.parse(JSON.stringify(Fritz.exportTimes({ real: { tutorial: null, days: { 34: open, 33: done } }, dev: { tutorial: null, days: {} } }, now)));
  assert.deepEqual(x.real.days.map(d => d.num), [33, 34]);
  assert.deepEqual(x.real.days[0], { machine: 'Leap Year Oracle', hard: false, runs: 6, hints: 1, won: true, num: 33,
    startedAt: '2026-11-13T12:00:00.000Z', endedAt: '2026-11-13T12:02:14.000Z', finished: true, activeMs: 134000, wallMs: 134000 });
  assert.deepEqual([x.real.days[1].finished, x.real.days[1].activeMs, x.real.days[1].endedAt], [false, 30000, null]);
  assert.deepEqual(x.dev, { tutorial: null, days: [] });
  assert.deepEqual([Fritz.fmtDuration(134000), Fritz.fmtDuration(5000), Fritz.fmtDuration(3723000)], ['2:14', '0:05', '1:02:03']);
});

console.log('\nMachine format');
const goodMachine = () => ({
  name: 'Sign Flipper', day: 'Wed',
  description: 'Flips the sign of a whole number.',
  inputs: [{ key: 'n', label: 'Number', type: 'int', min: -99, max: 99 }],
  examples: [{ n: 4 }, { n: 0 }],
  correct: ({ n }) => -n,
  buggy: ({ n }) => (n < 0 ? n : -n),
  predictions: [{ n: -5 }, { n: 5 }, { n: 12 }],
  decoys: ({ n }) => [n, -n + 1],
  par: 3,
  explanation: 'It leaves negative numbers as they are.',
  hints: ['Both examples sit on one side of zero.', 'Try a number that already has a sign.'],
});
check('one object is a whole machine: it passes the validator and joins its weekday rotation', () => {
  const { machines, rejected } = Fritz.defineMachines([goodMachine()]);
  assert.deepEqual(plain(rejected), []);
  const [p] = machines;
  assert.deepEqual([p.name, p.day, p.difficulty, p.slot, p.spec, p.glitchRule], ['Sign Flipper', 'Wed', 'medium', 0, 'Flips the sign of a whole number.', 'It leaves negative numbers as they are.']);
  assert.equal(p.isGlitchCase({ n: -2 }), true, 'glitch derived from buggy vs correct');
  assert.equal(Fritz.out(p, 'buggy', { n: 3 }), '-3');
  const [row] = Fritz.validate(2000, 7, machines, []);
  assert.ok(row.pass, row.errors.join('; '));
});
check('a broken machine is rejected (kept out of rotation) and fails the validator', () => {
  const bad = {
    'needs 2 or 3 hints': { hints: ['only one'] },
    'hints must be non-empty': { hints: ['same', 'same'] },
    'par must be': { par: 12 },
    'explanation is missing': { explanation: ' ' },
    'day must be': { day: 'Someday' },
    'example 1 does not pass': { examples: [{ n: -1 }, { n: 2 }] },
    'no glitch case': { predictions: [{ n: 1 }, { n: 2 }, { n: 3 }] },
    'fewer than 2 choices': { decoys: undefined },
    'not a valid machine': { correct: undefined },
  };
  for (const [msg, patch] of Object.entries(bad)) {
    const { machines, rejected } = Fritz.defineMachines([{ ...goodMachine(), ...patch }]);
    assert.equal(machines.length, 0, msg);
    assert.ok(rejected[0].errors.some(e => e.includes(msg)), `${msg}: got ${rejected[0].errors.join('; ')}`);
    const rows = Fritz.validate(100, 1, machines, rejected);
    assert.ok(rows.length === 1 && !rows[0].pass, 'validator reports it');
  }
  const dupe = Fritz.defineMachines([goodMachine(), goodMachine()]);
  assert.deepEqual([dupe.machines.length, dupe.rejected.length], [1, 1]);
  assert.deepEqual(plain(Fritz.REJECTED), [], 'nothing shipped is rejected');
});
check('a stated glitchWhen that disagrees with the code is caught by the random check', () => {
  const { machines } = Fritz.defineMachines([{ ...goodMachine(), glitchWhen: ({ n }) => n < 0 || n === 1 }]);
  const [row] = Fritz.validate(2000, 7, machines, []);
  assert.equal(row.pass, false);
});
check('rotation: each weekday cycles through its own machines; shipped schedule is unchanged', () => {
  const names = n => Fritz.puzzleFor(n).name;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(names), plain(Fritz.PUZZLES.map(p => p.name)));
  assert.deepEqual([8, 33, 700].map(names), [1, 5, 7].map(names), 'one machine per weekday: repeats weekly');
  for (const d of Fritz.DAYS) assert.ok(Fritz.PUZZLES.some(p => p.day === d), `${d} has a machine`);
});

console.log(failed ? `\n${failed} failure(s)\n` : '\nAll good.\n');
process.exit(failed ? 1 : 0);
