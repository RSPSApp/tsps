// Run after `yarn build`: node --test tests/settings-gameframe-orbs.test.cjs
// All Settings > Interfaces: "Game client layout" (12) switches the gameframe as the side panel's
// dropdown does, and "Show data orbs" (8) closes and opens the orbs interface with its varbit.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { encodeGameframeBootstrap, MOBILE_CLIENT_ATTRIBUTE } = require('../dist/net/protocol/ClientProtocol');
const Settings = require('../plugins/interface/Settings.plugin');

const ORBS_DISABLED = 4084;
const ORBS_PANE = (161 << 16) | 33;
const handlers = {};
const listeners = new Map();
const slots = new Map();

before(async () => {
  await CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    onInterfaceActionButton: (_id, fn) => { handlers[fn.name] = fn; },
    onPlayerLogin: (fn) => { handlers[fn.name] = fn; },
    onCustomEvent: (name, fn) => { handlers[fn.name] = fn; listeners.set(name, [...(listeners.get(name) ?? []), fn]); },
    emitCustomEvent: (name, request) => { for (const fn of listeners.get(name) ?? []) fn(request); },
  };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  for (const [, structId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const settings = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    settings.forEach(([, s], slot) => slots.set(Number(CacheDefinitions.getStructParams(Number(s)).get(1077)), { category: Number(category.get(743)), slot }));
  }
});

/** A player that records the roots, interface opens and closes sent to it. */
function player(attributes = new Map()) {
  const varps = new Map();
  const sent = { roots: [], opened: [], closed: [] };
  const bits = (id) => {
    const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
    return { baseVar, startBit, mask: (2 ** (endBit - startBit + 1) - 1) };
  };
  const sender = {
    getVarp: (id) => varps.get(id) ?? 0,
    sendConfig(id, value) { varps.set(id, value); return sender; },
    getVarbit(id) { const b = bits(id); return ((varps.get(b.baseVar) ?? 0) >>> b.startBit) & b.mask; },
    sendVarbit(id, value) {
      const b = bits(id);
      varps.set(b.baseVar, ((varps.get(b.baseVar) ?? 0) & ~(b.mask << b.startBit)) | ((value & b.mask) << b.startBit));
      return sender;
    },
    sendClientScript() { return sender; },
    sendRootInterface(id) { sent.roots.push(id); return sender; },
    sendSubInterface(uid, group) { sent.opened.push([uid, group]); return sender; },
    closeSubInterface(uid) { sent.closed.push(uid); return sender; },
  };
  return {
    sent, attributes,
    sendMessage() {},
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    getPacketSender: () => sender,
    getSession: () => ({ sendClientPacket() {} }),
  };
}

function click(p, settingId) {
  const { category, slot } = slots.get(settingId);
  p.setAttribute('settings-view', category);
  return handlers.clickSetting({ player: p, slot });
}

function choose(p, settingId, option) {
  click(p, settingId);
  return handlers.clickDropdownOption({ player: p, slot: option * 3 });
}

test('Game client layout in All Settings switches the root and keeps it, for each of its options', () => {
  for (const [option, root] of [[0, 548], [1, 164], [2, 161]]) {
    const p = player();
    assert.equal(choose(p, 12, option), true, `option ${option} is handled`);
    assert.deepEqual(p.sent.roots, [root], `option ${option} opens root ${root}`);
    assert.equal(p.getAttribute('client-layout-root'), root, 'saved for the next login');
    assert.equal(p.getAttribute('client-layout317'), false);
    assert.deepEqual(p.sent.opened, [[ORBS_PANE, 160]], 'the orbs reopen for the new layout');
  }
});

test('Game client layout keeps a mobile client on the mobile layout without saving it', () => {
  const p = player(new Map([[MOBILE_CLIENT_ATTRIBUTE, true], ['client-layout-root', 164]]));
  assert.equal(choose(p, 12, 0), true);
  assert.deepEqual(p.sent.roots, [601]);
  assert.deepEqual(p.sent.opened, [[ORBS_PANE, 897]], 'the mobile orbs');
  assert.equal(p.getAttribute('client-layout-root'), 164);
});

test('Show data orbs closes the orbs when turned off and opens them when turned back on, and is kept at login', () => {
  const p = player();
  handlers.restoreSettings({ player: p });
  assert.equal(p.getPacketSender().getVarbit(ORBS_DISABLED), 0, 'shown by default');
  assert.equal(click(p, 8), true);
  assert.equal(p.getPacketSender().getVarbit(ORBS_DISABLED), 1);
  assert.deepEqual(p.sent.closed, [ORBS_PANE]);
  assert.deepEqual(p.sent.opened, []);

  const next = player(p.attributes);
  handlers.restoreSettings({ player: next });
  assert.equal(next.getPacketSender().getVarbit(ORBS_DISABLED), 1, 'still hidden after a relog');
  choose(next, 12, 1);
  assert.deepEqual(next.sent.opened, [], 'a layout change leaves hidden orbs closed');
  click(next, 8);
  assert.equal(next.getPacketSender().getVarbit(ORBS_DISABLED), 0);
  assert.deepEqual(next.sent.opened, [[ORBS_PANE, 160]], 'opened again on the layout in use');
});

test('the login gameframe leaves the orbs out while they are hidden', () => {
  // An open-sub's payload starts with the pane's packed id, then the interface: 161:33, then 160.
  const orbs = Buffer.from([0, 161, 0, 33, 0, 160]);
  const opensOrbs = (packets) => packets.some((packet) => packet.includes(orbs));
  const shown = encodeGameframeBootstrap('Someone', 161, false, 'REGULAR');
  const hidden = encodeGameframeBootstrap('Someone', 161, false, 'REGULAR', false);
  assert.equal(opensOrbs(shown), true);
  assert.equal(opensOrbs(hidden), false);
  assert.equal(shown.length - hidden.length, 1, 'nothing else is left out');
  const core = PluginManager.getCoreApi();
  const p = player();
  assert.equal(core.dataOrbsHidden(p), false);
  p.getPacketSender().sendVarbit(ORBS_DISABLED, 1);
  assert.equal(core.dataOrbsHidden(p), true);
});

test('restoring the data orbs after a tutorial puts back the player\'s own choice', () => {
  const fresh = player();
  fresh.getPacketSender().sendVarbit(ORBS_DISABLED, 1);
  handlers.restoreDataOrbs({ player: fresh });
  assert.equal(fresh.getPacketSender().getVarbit(ORBS_DISABLED), 0);
  assert.deepEqual(fresh.sent.opened, [[ORBS_PANE, 160]]);

  const hid = player();
  click(hid, 8);
  hid.sent.closed.length = 0;
  hid.getPacketSender().sendVarbit(ORBS_DISABLED, 0);
  handlers.restoreDataOrbs({ player: hid });
  assert.equal(hid.getPacketSender().getVarbit(ORBS_DISABLED), 1, 'a player who hid them keeps them hidden');
  assert.deepEqual(hid.sent.closed, [ORBS_PANE]);
});
