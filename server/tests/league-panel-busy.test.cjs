/**
 * The league side panel's View Demonic Pacts, View Relics, View Areas and View Tasks answer a locked
 * player (mid-teleport, on an agility obstacle) with "Please finish what you are doing first." and open
 * nothing; other buttons keep their old handling.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { InterfaceActionClickOpcode } = require("../dist/net/packet/impl/InterfaceActionClickOpcode");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

const uid = (group, child) => (group << 16) | child;
const PANEL_BUTTONS = {
  pacts: uid(656, 32),
  relics: uid(656, 44),
  areas: uid(656, 40),
  tasks: uid(656, 36),
};

function recordingApi() {
  const refused = [];
  // Everything else (core, hooks, config) answers as a no-op.
  const noop = new Proxy(function () {}, { get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop });
  const api = new Proxy({
    core,
    refuseWhileBusy: (ids) => refused.push(...[].concat(ids)),
    getPluginConfig: (_key, fallback) => fallback,
  }, {
    get: (target, key) => (key in target ? target[key] : noop),
  });
  return { api, refused };
}

test("each panel opener registers its button to refuse while busy", () => {
  const modules = {
    pacts: "../plugins/modes/Pacts.LeagueMode",
    relics: "../plugins/modes/Relics.LeagueMode",
    areas: "../plugins/modes/AreaUnlocks.LeagueMode",
    tasks: "../plugins/modes/Tasks.LeagueMode",
  };
  for (const [name, path] of Object.entries(modules)) {
    const { api, refused } = recordingApi();
    require(path).register(api);
    assert.deepEqual(refused, [PANEL_BUTTONS[name]], name);
  }
});

function makePlayer({ locked = false, teleporting = false } = {}) {
  const messages = [];
  return {
    messages,
    getHitpoints: () => 10,
    isTeleportingReturn: () => teleporting,
    isLocked: () => locked || teleporting,
    sendMessage: (text) => messages.push(text),
  };
}

test("a busy-refusing button tells a locked player to finish first and runs no handler", (t) => {
  const hookCount = PluginManager.interfaceActionClickHooks.length;
  const button = PANEL_BUTTONS.relics;
  const other = uid(656, 7);
  t.after(() => {
    PluginManager.interfaceActionClickHooks.splice(hookCount);
    PluginManager.busyRefusalButtons.delete(button);
  });
  const api = PluginManager.createApi("LeaguePanelBusyTest");
  const opened = [];
  api.refuseWhileBusy(button);
  api.onInterfaceActionButton([button, other], ({ buttonId }) => { opened.push(buttonId); return true; });
  const press = (player, id) => InterfaceActionClickOpcode.handle(player, id, 1, { opId: 1, slot: -1 });

  const locked = makePlayer({ locked: true });
  assert.equal(press(locked, button), true);
  assert.deepEqual(locked.messages, ["Please finish what you are doing first."]);

  const teleporting = makePlayer({ teleporting: true });
  assert.equal(press(teleporting, button), true);
  assert.deepEqual(teleporting.messages, ["Please finish what you are doing first."]);
  // A button without the refusal is still dropped silently during a teleport.
  assert.equal(press(teleporting, other), false);
  assert.deepEqual(teleporting.messages, ["Please finish what you are doing first."]);
  assert.deepEqual(opened, []);

  // Locked but not teleporting: a button without the refusal still works.
  assert.equal(press(locked, other), true);
  const free = makePlayer();
  assert.equal(press(free, button), true);
  assert.deepEqual(free.messages, []);
  assert.deepEqual(opened, [other, button]);
});

test("a player is locked by a teleport, a forced move or an agility obstacle, not by other movement holds", () => {
  const state = (overrides) => ({
    isTeleportingReturn: () => false,
    forceMovement: null,
    attributes: {},
    getAttribute(key) { return this.attributes[key]; },
    getMovementQueue: () => ({ isMovementBlocked: () => true }),
    ...overrides,
  });
  const isLocked = (overrides) => Player.prototype.isLocked.call(state(overrides));
  // Blocked movement alone (a freeze, a boss's stun, a cutscene) is not a lock.
  assert.equal(isLocked({}), false);
  assert.equal(isLocked({ isTeleportingReturn: () => true }), true);
  assert.equal(isLocked({ forceMovement: {} }), true);
  assert.equal(isLocked({ attributes: { "agility.obstacle": {} } }), true);
});
