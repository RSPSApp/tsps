// Run after `yarn build`: node --test tests/settings-keybinds.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const Settings = require('../plugins/interface/Settings.plugin');

const CONTROLS = 3;
const COMBAT_KEY = 4675;
const INVENTORY_KEY = 4678;

function viewing(view) {
  const attributes = new Map([['settings-view', view]]);
  return { getAttribute: (key) => attributes.get(key) };
}

before(async () => {
  await CachePipeline.initialize();
});

test('All Settings > Controls: rows 27-40 are the keybinds (cache enum 1562)', () => {
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 27), COMBAT_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 36), INVENTORY_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 26), -1, 'the "external keyboard" note');
  assert.equal(Settings.keybindVarbitForRow(viewing(CONTROLS), 41), -1, 'Restore default keybinds');
});

test('the same row in another category is not a keybind', () => {
  assert.equal(Settings.keybindVarbitForRow(viewing(0), 27), -1);
});

test('search results number rows across every category, so the keybinds come after the first three', () => {
  const before = [0, 1, 2].reduce((rows, index) => {
    const category = CacheDefinitions.getStructParams(Number(CacheDefinitions.getEnumValues(422).get(index)));
    return rows + CacheDefinitions.getEnumValues(Number(category.get(745))).size;
  }, 0);
  assert.ok(before + 27 > 63, 'past the old 0..63 transmit range');
  assert.equal(Settings.keybindVarbitForRow(viewing(-1), before + 27), COMBAT_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(-1), before + 36), INVENTORY_KEY);
  assert.equal(Settings.keybindVarbitForRow(viewing(-1), 27), -1, 'row 27 of search is not Controls row 27');
});

/** The Settings plugin registered on a fake api; returns its button handlers and custom events. */
function registered() {
  const buttons = new Map();
  const events = new Map();
  const ids = (id) => (Array.isArray(id) ? id : [id]);
  const api = {
    onInterfaceActionButton: (id, handler) => ids(id).forEach((one) => buttons.set(one, handler)),
    onCustomEvent: (name, handler) => events.set(name, handler),
  };
  Settings.register(new Proxy(api, { get: (target, prop) => (prop in target ? target[prop] : () => {}) }));
  return { buttons, events };
}

function recordingPlayer() {
  const sent = [];
  const attributes = new Map();
  const sender = {
    sendVarbit: (id, value) => { sent.push(`varbit ${id}=${value}`); return sender; },
    sendClientScript: (id) => { sent.push(`script ${id}`); return sender; },
  };
  return { sent, getPacketSender: () => sender, setAttribute: (k, v) => attributes.set(k, v), getAttribute: (k) => attributes.get(k) };
}

test('as captured: the search bar takes the keyboard, and closing All Settings by any route gives it back', () => {
  const { buttons, events } = registered();
  const player = recordingPlayer();
  buttons.get((134 << 16) | 11)({ player });
  assert.deepEqual(player.sent, ['varbit 16073=1', 'varbit 16074=1', 'script 4020']);
  player.sent.length = 0;
  events.get('interface:closed')({ player, interfaceId: 134 });
  assert.deepEqual(player.sent, ['varbit 16073=0', 'varbit 16074=0', 'script 2158']);
  player.sent.length = 0;
  events.get('interface:closed')({ player, interfaceId: 12 });
  assert.deepEqual(player.sent, [], 'closing anything else leaves them alone');
});

test('both close routes announce interface:closed with the interface that closed', () => {
  const { PacketSender } = require('../dist/net/packet/PacketSender');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const emitted = [];
  const emit = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => emitted.push([name, payload.interfaceId]);
  try {
    for (const route of ['sendInterfaceRemoval', 'closeInterruptibleInterfaces']) {
      PacketSender.prototype[route].call({
        player: {},
        resetInterfaceState: () => 134,
        closeTrackedInterfaces: () => true,
        endBankSearch: () => {},
        sendSubInterface: () => {},
        emitInterfaceClosed: PacketSender.prototype.emitInterfaceClosed,
      });
    }
  } finally {
    PluginManager.emitCustomEvent = emit;
  }
  assert.deepEqual(emitted, [['interface:closed', 134], ['interface:closed', 134]]);
});
