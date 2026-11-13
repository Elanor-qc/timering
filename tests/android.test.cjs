const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('resources/js/app.js', 'utf8');
function androidStore(days = new Map(), error = null) {
  const ctx = vm.createContext({
    ANDROID: true, NATIVE: false,
    segments: [],
    minToHM: min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`,
    TimeringAndroid: {
      readDay(date) { return JSON.stringify({ segments: days.has(date) ? JSON.parse(days.get(date)) : null }); },
      writeDay(date, raw) { if (error) return JSON.stringify({ error }); days.set(date, raw); return '{}'; },
      listDays() { return JSON.stringify({ days: [...days.keys()] }); }
    }
  });
  vm.runInContext(source.slice(source.indexOf('const Store ='), source.indexOf('/* ============================== 环形几何')), ctx);
  return ctx;
}

test('Android saves to native storage and reopens overlapping Unicode events and midnight times', async () => {
  const days = new Map(), ctx = androidStore(days);
  ctx.segments = [
    { start: 1380, end: 60, label: '读书📚' },
    { start: 30, end: 90, label: '音乐' }
  ];
  await vm.runInContext('Store.writeDay("2026-11-12")', ctx);
  const reopened = androidStore(days);
  const segments = await vm.runInContext('Store.readDay("2026-11-12")', reopened);
  assert.deepEqual(JSON.parse(JSON.stringify(segments)), [
    { start: '23:00', end: '01:00', label: '读书📚' },
    { start: '00:30', end: '01:30', label: '音乐' }
  ]);
  assert.equal(await vm.runInContext('Store.readDay("2026-11-11")', reopened), null);
});

test('Android history uses native dates in descending order', async () => {
  const ctx = androidStore(new Map([['2026-11-10', '[]'], ['2026-11-12', '[]']]));
  const days = await vm.runInContext('Store.listDays()', ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(days)), ['2026-11-12', '2026-11-10']);
});

test('native write errors propagate instead of reporting a successful save', async () => {
  const ctx = androidStore(new Map(), 'disk full');
  await assert.rejects(vm.runInContext('Store.writeDay("2026-11-12")', ctx), /disk full/);
});

test('Android back closes a dialog or history before leaving the app', () => {
  const elements = { '#settingsPop': { hidden: true }, '#historyView': { hidden: true }, '#dayView': { hidden: false } };
  const pop = { hidden: false }, calls = [];
  const ctx = vm.createContext({
    window: {}, pop, $: selector => elements[selector],
    closePopover() { pop.hidden = true; calls.push('close event'); },
    closeSettings() { elements['#settingsPop'].hidden = true; calls.push('close settings'); }
  });
  vm.runInContext(source.slice(source.indexOf('window.timeringBack =')), ctx);
  assert.equal(ctx.window.timeringBack(), true);
  elements['#settingsPop'].hidden = false;
  assert.equal(ctx.window.timeringBack(), true);
  elements['#historyView'].hidden = false; elements['#dayView'].hidden = true;
  assert.equal(ctx.window.timeringBack(), true);
  assert.equal(elements['#dayView'].hidden, false);
  assert.equal(ctx.window.timeringBack(), false);
  assert.deepEqual(calls, ['close event', 'close settings']);
});


test('manual Android events accept future times at arbitrary minute precision', () => {
  const html = fs.readFileSync('resources/index.html', 'utf8');
  for (const id of ['popStart', 'popEnd']) {
    const tag = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'))[0];
    assert.match(tag, /step="60"/, 'manual time entry must accept every minute');
    assert.doesNotMatch(tag, /\b(?:min|max)=/, 'manual times must not be limited by the current time');
  }
  const inputs = {
    '#popStart': { value: '23:11', checkValidity: () => true },
    '#popEnd': { value: '23:57', checkValidity: () => true },
    '#popLabel': { value: 'future event' }
  };
  let persisted = false;
  const ctx = vm.createContext({
    ANDROID: true, currentDate: '2026-11-13',
    Date: class extends Date { constructor() { super('2026-11-13T10:00:00+08:00'); } },
    popCtx: { mode: 'create' }, uid: 1, segments: [],
    $: selector => inputs[selector],
    hmToMin: value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; },
    spanOf: s => ((s.end - s.start + 1440) % 1440) || 1440,
    toast() {}, closePopover() {}, persist() { persisted = true; }
  });
  vm.runInContext(source.slice(source.indexOf('function savePopover()'), source.indexOf('function persist()')), ctx);
  vm.runInContext('savePopover()', ctx);
  assert.equal(persisted, true);
  assert.equal(ctx.segments.length, 1);
  assert.equal(ctx.segments[0].start, 1391);
  assert.equal(ctx.segments[0].end, 1437);
});
