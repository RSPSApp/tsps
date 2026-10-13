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
  const logins = [];
  const ids = (id) => (Array.isArray(id) ? id : [id]);
  const api = {
    onInterfaceActionButton: (id, handler) => ids(id).forEach((one) => buttons.set(one, handler)),
    onCustomEvent: (name, handler) => events.set(name, handler),
    onPlayerLogin: (handler) => logins.push(handler),
  };
  Settings.register(new Proxy(api, { get: (target, prop) => (prop in target ? target[prop] : () => {}) }));
  return { buttons, events, logins };
}

function recordingPlayer() {
  const sent = [];
  const attributes = new Map();
  const vars = new Map();
  const sender = {
    sendVarbit: (id, value) => { vars.set(`varbit ${id}`, value); sent.push(`varbit ${id}=${value}`); return sender; },
    sendConfig: (id, value) => { vars.set(`varp ${id}`, value); sent.push(`varp ${id}=${value}`); return sender; },
    getVarbit: (id) => vars.get(`varbit ${id}`) ?? 0,
    getVarp: (id) => vars.get(`varp ${id}`) ?? 0,
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

test('XP orb mounts the counter only while enabled, and Setup opens the cached settings', () => {
  const { buttons, logins } = registered();
  const player = recordingPlayer();
  const sender = player.getPacketSender();
  sender.sendSubInterface = (uid, group, type) => { player.sent.push(`open ${uid}:${group}:${type}`); return sender; };
  sender.closeSubInterface = (uid) => { player.sent.push(`close ${uid}`); return sender; };
  const click = buttons.get((160 << 16) | 6);
  logins[0]({ player });
  assert.deepEqual(player.sent, ['varbit 4702=0'], 'fresh accounts have XP drops off');
  player.sent.length = 0;
  click({ player, opId: 1 });
  assert.equal(player.getAttribute('xp-drops:enabled'), true);
  assert.deepEqual(player.sent, ['varbit 4702=1', `open ${(161 << 16) | 7}:122:1`]);
  player.sent.length = 0;
  logins[0]({ player });
  assert.deepEqual(player.sent, ['varbit 4702=1'], 'login restores the saved toggle before bootstrap');
  player.sent.length = 0;
  click({ player, opId: 1 });
  assert.deepEqual(player.sent, ['varbit 4702=0', `close ${(161 << 16) | 7}`]);
  player.sent.length = 0;
  click({ player, opId: 2 });
  assert.deepEqual(player.sent, [`open ${(161 << 16) | 16}:137:0`]);
  assert.equal(player.getAttribute('xp-drops:enabled'), false);
  player.sent.length = 0;
  assert.equal(click({ player, opId: 3 }), false);
  assert.deepEqual(player.sent, []);
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

const CLICKZONE = (134 << 16) | 20;
const DROPDOWN = (134 << 16) | 29;
const DROPDOWN_CLOSE = (134 << 16) | 26;
const CATEGORIES = (134 << 16) | 24;
const SEARCH = (134 << 16) | 11;

/** The All Settings handlers and a player looking at them, starting on `category`. */
function allSettings(category) {
  const { buttons, logins } = registered();
  const player = recordingPlayer();
  const click = (component, slot) => { player.sent.length = 0; buttons.get(component)({ player, slot }); return player.sent; };
  if (category === 'search') click(SEARCH);
  else click(CATEGORIES, category);
  return { player, click, logins, varbit: (id) => player.getPacketSender().getVarbit(id) };
}

test('as captured: "Level-up pop-up notifications" from search results, each option', () => {
  const { player, click, varbit } = allSettings('search');
  // Search result 301 is setting 315; its category (Interfaces, 6) is shown behind the results.
  assert.deepEqual(click(CLICKZONE, 301), ['varbit 9657=315', 'varbit 9656=6']);
  const options = { 2: [1, 0], 5: [0, 0], 8: [0, 1] };
  for (const [button, [disabled, list]] of Object.entries(options)) {
    click(CLICKZONE, 301);
    const sent = click(DROPDOWN, Number(button));
    assert.equal(varbit(20157), disabled, `option ${button / 3 | 0}: option_level_up_message_disabled`);
    assert.equal(varbit(4371), list, `option ${button / 3 | 0}: option_level_up_popup_list`);
    assert.equal(sent.at(-1), 'varbit 9657=0', 'the selection clears after the vars change');
  }
  assert.deepEqual(player.getAttribute('settings:values'), { 'varbit:9656': 6, 'varbit:20157': 0, 'varbit:4371': 1 });
});

test('as captured: the level-up chatbox and guide lists are toggles beside it', () => {
  const { click, varbit } = allSettings('search');
  assert.deepEqual(click(CLICKZONE, 302), ['varbit 9657=493', 'varbit 9656=6', 'varbit 20158=1']);
  click(CLICKZONE, 302);
  assert.equal(varbit(20158), 0);
  assert.deepEqual(click(CLICKZONE, 303), ['varbit 9657=494', 'varbit 9656=6', 'varbit 20159=1']);
});

test('as captured: a category click ends the search', () => {
  const { click } = allSettings('search');
  assert.deepEqual(click(CATEGORIES, 0), ['varbit 16073=0', 'varbit 16074=0', 'varbit 9656=0', 'varbit 9657=0', 'script 2158']);
  assert.deepEqual(click(CATEGORIES, 2), ['varbit 9656=2', 'varbit 9657=0'], 'not searching: no search varbits');
});

test('as captured: toggles in a category flip their var; split private chat runs its script', () => {
  const { click } = allSettings(0);
  assert.deepEqual(click(CLICKZONE, 47), ['varbit 9657=5', 'varbit 10236=1'], 'Hitsplat tinting');
  assert.deepEqual(click(CLICKZONE, 47), ['varbit 9657=5', 'varbit 10236=0']);
  click(CATEGORIES, 2);
  assert.deepEqual(click(CLICKZONE, 5), ['varbit 9657=35', 'varp 287=1', 'script 83'], 'Split friends private chat');
});

test('as captured: a dropdown that sets one varbit to the option, and closing a dropdown', () => {
  const { click, varbit } = allSettings(0);
  click(CLICKZONE, 67);
  assert.deepEqual(click(DROPDOWN, 5), ['varbit 11865=1', 'varbit 9657=0'], 'LMS fog colour: Green');
  click(CLICKZONE, 67);
  assert.equal(click(DROPDOWN, 3 * 6 + 2).length, 0, 'the enum has six options');
  assert.deepEqual(click(DROPDOWN_CLOSE), ['varbit 9657=0']);
  assert.equal(varbit(11865), 1);
});

test('as captured: a keybind dropdown still binds its key', () => {
  const { click, varbit } = allSettings(3);
  assert.deepEqual(click(CLICKZONE, 40), ['varbit 9657=29']);
  assert.deepEqual(click(DROPDOWN, 41).slice(-2), ['varbit 4689=13', 'varbit 9657=0'], 'Logout: Esc');
  assert.equal(varbit(4689), 13);
});

test('login sends back every setting the player changed', () => {
  const { player, logins } = allSettings(0);
  player.setAttribute('settings:values', { 'varbit:20157': 1, 'varp:287': 0 });
  player.sent.length = 0;
  logins.find((login) => login.name === 'restoreSettings')({ player });
  assert.ok(player.sent.includes('varbit 20157=1'));
  assert.ok(player.sent.includes('varp 287=0'));
});
