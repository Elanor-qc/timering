const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('resources/js/app.js', 'utf8');
function harness() {
  const handlers = {};
  const node = () => ({ innerHTML: '', style: {}, hidden: true, children: [],
    setAttribute(k, v) { this[k] = v; }, append(p) { this.children.push(p); } });
  const svg = { ...node(),
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 500 }),
    getScreenCTM: () => ({ inverse: () => ({}) }),
    createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x - 10, y: this.y - 70 }; } }),
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => true,
    addEventListener(name, cb) { handlers[name] = cb; } };
  const tip = node(), preview = node(), opened = [], dayHandlers = {};
  const day = { addEventListener(name, cb) { dayHandlers[name] = cb; } };
  const ctx = vm.createContext({ Math, document: { createElementNS: node },
    $: selector => selector === '#dayView' ? day : tip, ringSvg: svg, gPreview: preview, segments: [],
    spanOf: s => ((s.end - s.start + 1440) % 1440) || 1440,
    CX: 200, CY: 200, TRACK_R: 150, ARC_W: 26,
    minToHM: String, fmtDur: String, openPopover: x => opened.push(x) });
  vm.runInContext(source.slice(source.indexOf('function polar('), source.indexOf('function buildRing(')), ctx);
  vm.runInContext(source.slice(source.indexOf('let dragging = null;'), source.indexOf('/* ============================== 弹窗')), ctx);
  const event = (min, extra = {}) => {
    const rad = min / 1440 * Math.PI * 2 - Math.PI / 2;
    return { clientX: 210 + 150 * Math.cos(rad), clientY: 270 + 150 * Math.sin(rad),
      pointerId: 1, button: 0, target: {}, shiftKey: false, preventDefault() {}, ...extra };
  };
  return { ctx, handlers, dayHandlers, event, opened, preview, tip };
}

test('application parses', () => { new vm.Script(source); });
test('six-hour arc ends at the 6-hour tick', () => {
  const { ctx } = harness();
  assert.match(vm.runInContext('arcPath(0, 360)', ctx), /0 0 1 350\.00 200\.00$/);
});
test('full-day arc uses two halves', () => {
  const { ctx } = harness();
  assert.equal((vm.runInContext('arcPath(0, 1440)', ctx).match(/ A /g) || []).length, 2);
});
test('pointer coordinates respect SVG letterboxing', () => {
  const { ctx, event } = harness(); ctx.e = event(180);
  assert.ok(Math.abs(vm.runInContext('pointerToMin(e).min', ctx) - 180) < 0.001);
});
test('zero-length drag has no preview arc', () => {
  const { handlers, event, preview } = harness(); handlers.pointerdown(event(360));
  assert.equal(preview.children.length, 0);
});
test('precision and start stay fixed when Shift changes during drag; release uses final position', () => {
  const { handlers, event, opened } = harness();
  handlers.pointerdown(event(367)); handlers.pointermove(event(401, { shiftKey: true }));
  handlers.pointerup(event(420, { shiftKey: true }));
  assert.equal(opened[0].start, 360); assert.equal(opened[0].end, 420);
});
test('Shift at start selects five-minute precision across midnight', () => {
  const { handlers, event, opened } = harness();
  handlers.pointerdown(event(1431, { shiftKey: true })); handlers.pointerup(event(11));
  assert.equal(opened[0].start, 1430); assert.equal(opened[0].end, 10);
});
test('small backwards movement does not select nearly 24 hours', () => {
  const { handlers, event, opened } = harness();
  handlers.pointerdown(event(360)); handlers.pointerup(event(345)); assert.equal(opened.length, 0);
});
test('cancellation and other pointers do not create records', () => {
  const { handlers, event, opened, tip } = harness();
  handlers.pointerdown(event(360)); handlers.pointerup(event(450, { pointerId: 2 }));
  handlers.pointercancel(event(450)); handlers.pointerup(event(450));
  assert.equal(opened.length, 0); assert.equal(tip.hidden, true);
});

test('overlapping events occupy separate lanes, including across midnight and full days', () => {
  const { ctx } = harness();
  for (const entries of [
    [{ start: 60, end: 180 }, { start: 120, end: 240 }],
    [{ start: 1380, end: 60 }, { start: 30, end: 90 }],
    [{ start: 300, end: 300 }, { start: 600, end: 660 }],
    [{ start: 60, end: 120 }, { start: 60, end: 120 }]
  ]) {
    ctx.entries = entries;
    assert.equal(vm.runInContext('layoutSegments(entries).count', ctx), 2);
  }
});

test('adjacent and disjoint events share a lane; layout preserves every event', () => {
  const { ctx } = harness();
  ctx.entries = [{ start: 1380, end: 60 }, { start: 60, end: 120 }, { start: 120, end: 180 }];
  assert.equal(vm.runInContext('layoutSegments(entries).count', ctx), 1);
  assert.equal(vm.runInContext('layoutSegments(entries).items.length', ctx), 3);
});

test('clicking blank ring or page space opens a single creation dialog without preset times', () => {
  const { handlers, dayHandlers, event, opened } = harness();
  handlers.pointerdown(event(360)); handlers.pointerup(event(360)); handlers.click(event(360));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].mode, 'create'); assert.equal(opened[0].start, undefined); assert.equal(opened[0].end, undefined);
  dayHandlers.click({ target: {} });
  assert.equal(opened.length, 2);
});

test('drag completion click does not open a second creation dialog', () => {
  const { handlers, event, opened } = harness();
  handlers.pointerdown(event(360)); handlers.pointermove(event(420)); handlers.pointerup(event(420));
  handlers.click(event(420));
  assert.equal(opened.length, 1); assert.equal(opened[0].start, 360); assert.equal(opened[0].end, 420);
});

test('page clicks on existing events and buttons do not create events', () => {
  const { dayHandlers, opened } = harness();
  for (const element of ['#ring', 'button', '.legend-row']) {
    dayHandlers.click({ target: { closest: () => ({ element }) } });
  }
  assert.equal(opened.length, 0);
});

test('blank event times must be filled; saving an overlapping event keeps both events', () => {
  const inputs = {
    '#popStart': { value: '', checkValidity: () => true, focus() {} },
    '#popEnd': { value: '03:00', checkValidity: () => true, focus() {} },
    '#popLabel': { value: 'new' }
  };
  let persisted = 0, closed = 0;
  const ctx = vm.createContext({
    popCtx: { mode: 'create' }, uid: 2,
    segments: [{ id: 1, start: 60, end: 150, label: 'old' }],
    $: selector => inputs[selector], toast() {},
    persist() { persisted++; }, closePopover() { closed++; },
    hmToMin: s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; },
    spanOf: s => ((s.end - s.start + 1440) % 1440) || 1440
  });
  vm.runInContext(source.slice(source.indexOf('function savePopover()'), source.indexOf('function persist()')), ctx);
  vm.runInContext('savePopover()', ctx);
  assert.equal(persisted, 0); assert.equal(closed, 0);
  inputs['#popStart'].value = '02:00';
  vm.runInContext('savePopover()', ctx);
  assert.equal(ctx.segments.length, 2); assert.equal(persisted, 1); assert.equal(closed, 1);
  assert.equal(ctx.segments[0].start, 60); assert.equal(ctx.segments[1].start, 120);
});
