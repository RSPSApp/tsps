// Run after `yarn build`: node --test tests/eternal-teleport-crystal.test.cjs
// The Eternal teleport crystal: Lletya and Prifddinas with no charge used, and Toggle swapping which
// is the first option (mourning_teleport_destination_toggle).
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Crystal = require("../plugins/items/EternalTeleportCrystal.plugin");

const { TOGGLE_ATTRIBUTE, TELEPORTED_EVENT, PRIFDDINAS_DEFAULT_MESSAGE, LLETYA, PRIFDDINAS, PRIFDDINAS_RADIUS } = Crystal._test;
const TOGGLE_VARBIT = 9666;

const hooks = { name: null, actions: null, login: null, persisted: [] };
const teleports = [];
const confirms = [];
const events = [];
let reqsPass = true;
let offsets = [];
Crystal.register({
  core: {
    Location: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
    CacheDefinitions: { getVarbitId: (name) => (name === "mourning_teleport_destination_toggle" ? TOGGLE_VARBIT : -1) },
    Misc: { randomInclusive: (min, max) => { const value = offsets.length ? offsets.shift() : 0; assert.ok(value >= min && value <= max); return value; } },
    TeleportType: { NORMAL: "normal" },
    TeleportHandler: {
      checkReqs: () => reqsPass,
      confirm: (player, destination, go, level, options) => { confirms.push({ level, options }); go(); },
      teleport: (player, destination, type, _warning, onArrive) => teleports.push({ destination, type, onArrive }),
    },
  },
  persistAttribute: (key, value) => hooks.persisted.push([key, value]),
  emitCustomEvent: (name, payload) => events.push({ name, payload }),
  onItemAction: (name, actions) => Object.assign(hooks, { name, actions }),
  onPlayerLogin: (handler) => { hooks.login = handler; },
});

function createPlayer() {
  const attributes = new Map();
  const varbits = new Map();
  const sent = [];
  const messages = [];
  return {
    messages, sent,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => messages.push(text),
    getPacketSender: () => ({
      getVarbit: (id) => varbits.get(id) ?? 0,
      sendVarbit: (id, value) => { varbits.set(id, value); sent.push([id, value]); },
    }),
  };
}

const ITEM = 23946;
function click(player, clickType) {
  const option = ["Lletya", "Prifddinas", "Toggle"][clickType - 1];
  return hooks.actions[option]({ player, itemId: ITEM, clickType });
}

test("its three cache options are answered and the toggle is saved, Lletya first for a new player", () => {
  assert.equal(hooks.name, "Eternal teleport crystal");
  assert.deepEqual(Object.keys(hooks.actions), ["Lletya", "Prifddinas", "Toggle"]);
  assert.deepEqual(hooks.persisted, [[TOGGLE_ATTRIBUTE, false]]);
});

test("Lletya and Prifddinas teleport the standard way, with no message, and the arrival is the deed", () => {
  teleports.length = 0; events.length = 0; confirms.length = 0;
  const player = createPlayer();
  assert.equal(click(player, 1), true);
  assert.deepEqual({ ...teleports[0].destination }, LLETYA);
  assert.equal(teleports[0].type, "normal");
  assert.deepEqual(confirms[0], { level: 20, options: { item: ITEM } });
  assert.equal(events.length, 0, "nothing before the arrival");
  teleports[0].onArrive();
  assert.deepEqual(events, [{ name: TELEPORTED_EVENT, payload: { player, itemId: ITEM, destination: "lletya" } }]);

  offsets = [-2, 2];
  click(player, 2);
  assert.deepEqual({ ...teleports[1].destination }, { x: PRIFDDINAS.x - 2, y: PRIFDDINAS.y + 2, z: 0 });
  assert.equal(PRIFDDINAS_RADIUS, 2);
  assert.deepEqual(player.messages, []);
});

test("a refused teleport (the usual Wilderness, Tele Block and busy rules) goes nowhere", () => {
  teleports.length = 0;
  reqsPass = false;
  click(createPlayer(), 1);
  reqsPass = true;
  assert.equal(teleports.length, 0);
});

test("Toggle makes Prifddinas the first option and sets the varbit; toggled back, Lletya again", () => {
  teleports.length = 0;
  const player = createPlayer();
  click(player, 3);
  assert.deepEqual(player.messages, [PRIFDDINAS_DEFAULT_MESSAGE]);
  assert.deepEqual(player.sent, [[TOGGLE_VARBIT, 1]]);
  click(player, 1);
  click(player, 2);
  assert.equal(teleports[0].destination.y > 6000, true, "the first option is Prifddinas");
  assert.deepEqual({ ...teleports[1].destination }, LLETYA, "the second is Lletya");

  click(player, 3);
  assert.deepEqual(player.sent, [[TOGGLE_VARBIT, 1], [TOGGLE_VARBIT, 0]]);
  assert.equal(player.messages.length, 1);
  click(player, 1);
  assert.deepEqual({ ...teleports[2].destination }, LLETYA);
});

test("the saved toggle is sent at login, and nothing is sent when it is off", () => {
  const on = createPlayer();
  on.setAttribute(TOGGLE_ATTRIBUTE, true);
  hooks.login({ player: on });
  assert.deepEqual(on.sent, [[TOGGLE_VARBIT, 1]]);
  const off = createPlayer();
  hooks.login({ player: off });
  assert.deepEqual(off.sent, []);
});
