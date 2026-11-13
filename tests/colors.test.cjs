const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('resources/js/app.js', 'utf8');
function colors(entries) {
  const ctx = vm.createContext({ entries, $: () => ({}),
    spanOf: s => ((s.end - s.start + 1440) % 1440) || 1440 });
  vm.runInContext(source.slice(source.indexOf('const PALETTE ='), source.indexOf('const SNAP =')), ctx);
  vm.runInContext(source.slice(source.indexOf('function hashColor('), source.indexOf('function totalMinutes(')), ctx);
  vm.runInContext(source.slice(source.indexOf('function segmentsOverlap('), source.indexOf('function buildRing(')), ctx);
  return Array.from(vm.runInContext('Array.from(assignEventColors(entries).values())', ctx));
}
test('adjacent identically named events use different colors, including midnight', () => {
  const entries = Array.from({length: 11}, (_, id) => ({ id, start: id * 120, end: (id + 1) * 120, label: '未命名' }));
  const result = colors(entries);
  for (let i = 0; i < result.length; i++) assert.notEqual(result[i], result[(i + 1) % result.length]);
  assert.deepEqual(colors(entries), result);
});
test('overlapping events use distinct colors while the palette has capacity', () => {
  const entries = Array.from({length: 8}, (_, id) => ({ id, start: id, end: 600, label: 'same' }));
  assert.equal(new Set(colors(entries)).size, 8);
});
test('crowded overlap keeps neighboring events distinguishable after palette reuse', () => {
  const entries = Array.from({length: 20}, (_, id) => ({ id, start: id, end: 600, label: 'same' }));
  const result = colors(entries);
  for (let i = 0; i < result.length; i++) assert.notEqual(result[i], result[(i + 1) % result.length]);
});
