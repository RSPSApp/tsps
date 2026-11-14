// Run after `yarn build`: node --test tests/forester-campfire-rest.test.cjs
// Forester's Campfire Rest (docs/firemaking.md): rsprox local recording 1001336, rev 240.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const path = require("node:path");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const ready = CachePipeline.initialize(path.resolve(__dirname, ".."));

function harness({ pvp = false } = {}) {
  const tasks = [];
  const custom = {};
  const objectHooks = {};
  let disconnect;
  const api = {
    core,
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    getObjectManager: () => ({ register() {}, deregister() {} }),
    getItemOnGroundManager: () => ({ registerLocation() {}, getGroundItem() {}, deregister() {} }),
    getWorld: () => ({ getObjects: () => [] }),
    onCanUseItem() {}, onItemOnItem() {}, onItemOnGroundItem() {}, onGroundItemClick() {}, onItemOnObject() {},
    onCustomEvent: (name, handler) => (custom[name] ??= []).push(handler),
    onPlayerDisconnect: (handler) => { disconnect = handler; },
    onObjectInteraction: (name, actions) => { objectHooks[name] = { ...objectHooks[name], ...actions }; },
    log() {},
  };
  const oldPvp = core.Wilderness.isPvpArea;
  core.Wilderness.isPvpArea = () => pvp;
  const Firemaking = require("../plugins/skills/Firemaking.plugin");
  Firemaking.register(api);
  const messages = [];
  const animations = [];
  const player = {
    getLocation: () => new core.Location(2952, 3365), isRegistered: () => true,
    performAnimation: (animation) => animations.push(animation.getId()),
    sendMessage: (text) => messages.push(text),
    getSkillManager: () => ({ stopSkillable() {} }),
  };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) tasks[tasks.length - 1].execute(); };
  const emit = (name, event) => (custom[name] ?? []).forEach((handler) => handler(event));
  const rest = () => {
    emit("player:world-input", { player, packet: { type: "oploc" } });
    const event = { player, object: {}, objectId: core.ObjectIdentifiers.FORESTERS_CAMPFIRE, handled: false };
    objectHooks["Forester's Campfire"].Rest(event);
    return event;
  };
  return {
    player, messages, animations, tick, emit, rest, disconnect: () => disconnect({ player }),
    restore: () => { core.Wilderness.isPvpArea = oldPvp; },
  };
}

test("Rest sits down two ticks after the click and loops thirteen ticks later", async (t) => {
  await ready;
  const h = harness();
  t.after(h.restore);
  assert.equal(h.rest().handled, true);
  h.tick(1);
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.animations, []);
  h.tick(1);
  assert.deepEqual(h.messages, ["You rest by the welcoming fire."]);
  assert.deepEqual(h.animations, [10083]);
  h.tick(12);
  assert.deepEqual(h.animations, [10083]);
  h.tick(1);
  assert.deepEqual(h.animations, [10083, 10084]);
  h.tick(30);
  assert.deepEqual(h.animations, [10083, 10084], "the loop keeps playing without new sequences");
  assert.deepEqual(h.messages, ["You rest by the welcoming fire."]);
});

test("the next click resets a started sit and a click before it cancels the rest", async (t) => {
  await ready;
  const h = harness();
  t.after(h.restore);
  h.rest();
  h.tick(5);
  h.emit("player:world-input", { player: h.player, packet: { type: "move" } });
  assert.deepEqual(h.animations, [10083, -1]);
  h.tick(20);
  assert.deepEqual(h.animations, [10083, -1], "no loop after the player moved on");

  h.animations.length = 0;
  h.messages.length = 0;
  h.rest();
  h.tick(1);
  h.emit("player:world-input", { player: h.player, packet: { type: "move" } });
  h.tick(20);
  assert.deepEqual(h.animations, [], "walking off before sitting sends nothing");
  assert.deepEqual(h.messages, []);

  h.rest();
  h.disconnect();
  h.tick(20);
  assert.deepEqual(h.animations, []);
});

test("Rest does nothing where PvP is enabled (Wiki)", async (t) => {
  await ready;
  const h = harness({ pvp: true });
  t.after(h.restore);
  assert.equal(h.rest().handled, true);
  h.tick(20);
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.animations, []);
});
