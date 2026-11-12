const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('resources/js/app.js', 'utf8');
async function boot(os = 'Linux') {
  const handlers = new Map(), calls = [], extracted = [], spawned = [];
  const ctx = vm.createContext({
    dataDir: '',
    NL_OS: os, NL_PID: 1234,
    Neutralino: {
      init() {},
      events: { async on(name, handler) { handlers.set(name, handler); } },
      window: { async hide() { calls.push('hide'); } },
      app: { async exit() { calls.push('exit'); } },
      resources: { async extractFile(from, to) { extracted.push([from, to]); } },
      os: { async getEnv() { return 'C:/AppData'; }, async setTray() { calls.push('nativeTray'); },
        async spawnProcess(command) { spawned.push(command); } }
    },
    async mkdirp() {}, async singleInstance() {},
    async showWindow() { calls.push('show'); },
    async loadDay(date) { calls.push(date); }, todayStr: () => '2026-11-12'
  });
  vm.runInContext(source.slice(source.indexOf('async function bootNative()'), source.indexOf('async function mkdirp(')), ctx);
  await vm.runInContext('bootNative()', ctx);
  calls.length = 0;
  return { handlers, calls, extracted, spawned, ctx };
}

test('native tray quit event exits the application', async () => {
  const { handlers, calls } = await boot();
  assert.ok(handlers.has('trayMenuItemClicked'), 'subscribe to the event emitted by the bundled runtime');
  await handlers.get('trayMenuItemClicked')({ detail: { id: 'quit' } });
  assert.deepEqual(calls, ['exit']);
});

test('window close hides the window without exiting', async () => {
  const { handlers, calls } = await boot();
  await handlers.get('windowClose')();
  assert.deepEqual(calls, ['hide']);
});

test('tray show and today actions open the window', async () => {
  const { handlers, calls } = await boot();
  assert.ok(handlers.has('trayMenuItemClicked'));
  const onClick = handlers.get('trayMenuItemClicked');
  await onClick({ detail: { id: 'show' } });
  await onClick({ detail: { id: 'today' } });
  assert.deepEqual(calls, ['show', '2026-11-12', 'show']);
});

test('Windows starts a separate native tray with this app PID and signal path', async () => {
  const { calls, extracted, spawned } = await boot('Windows');
  assert.equal(extracted[0][0], '/resources/native/tray-helper.exe');
  assert.equal(extracted[1][0], '/resources/icons/trayIcon.png');
  assert.equal(spawned.length, 1);
  assert.match(spawned[0], /1234 "C:\/AppData\/timering\/tray-1234.signal"/);
  assert.deepEqual(calls, []);
});

test('Windows tray signals dispatch show, today and quit once', async () => {
  for (const [action, expected] of [['show', ['show']], ['today', ['2026-11-12', 'show']], ['quit', ['exit']]]) {
    const { calls, ctx } = await boot('Windows');
    let removed = false;
    ctx.Neutralino.filesystem = {
      async readFile(path) {
        if (!path.endsWith('tray-1234.signal') || removed) throw new Error('No signal');
        return action;
      },
      async remove() { removed = true; }
    };
    ctx.localStorage = { getItem: () => null };
    vm.runInContext(source.slice(source.indexOf('async function pollSignal()'), source.indexOf('async function showWindow()')), ctx);
    await vm.runInContext('pollSignal()', ctx);
    await vm.runInContext('pollSignal()', ctx);
    assert.deepEqual(calls, expected);
    assert.equal(removed, true);
  }
});

test('opening the window restores it from minimized state and focuses it', async () => {
  const { calls, ctx } = await boot();
  ctx.Neutralino.window = {
    async show() { calls.push('show'); }, async isMinimized() { return true; },
    async unminimize() { calls.push('restore'); }, async focus() { calls.push('focus'); }
  };
  vm.runInContext(source.slice(source.indexOf('async function showWindow()'), source.indexOf('/* ---------- 注册表')), ctx);
  await vm.runInContext('showWindow()', ctx);
  assert.deepEqual(calls, ['show', 'restore', 'focus']);
});
