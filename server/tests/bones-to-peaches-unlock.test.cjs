// Run after `yarn build`: node --test tests/bones-to-peaches-unlock.test.cjs
// Bones to Peaches needs the Mage Training Arena unlock anywhere, not only inside the Arena (Wiki). Real engine: every
// plugin loaded, a real Player in Lumbridge, the spellbook click through ClientConnection.dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const HOME = [3222, 3218];
const BONES = 526, PEACH = 6883;
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9900);
  p.setUsername("peachcaster");
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => { messages.push(message); return sender; });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  const I = core.ItemIdentifiers;
  p.getInventory().add(new core.Item(BONES, 3), false);
  for (const [rune, amount] of [[I.NATURE_RUNE, 10], [I.EARTH_RUNE, 20], [I.WATER_RUNE, 20]]) p.getInventory().add(new core.Item(rune, amount), false);
  return { p, c, messages };
}

async function cast({ c }) {
  const spell = core.CacheDefinitions.getSpellByName("Bones to Peaches");
  const widgetId = spell.widgetId;
  await c.dispatch([{ type: "widget_action", widgetId, groupId: widgetId >>> 16, childId: widgetId & 65535, slot: -1, buttonNum: 1 }]);
  c.processTurnPackets();
}

test("Bones to Peaches outside the Arena: refused until the Arena unlocks it, then cast", async (t) => {
  const f = actor(t);
  await cast(f);
  assert.equal(f.p.getInventory().getAmount(PEACH), 0, "locked: no peaches");
  assert.equal(f.p.getInventory().getAmount(BONES), 3, "locked: the bones are kept");
  assert.ok(f.messages.includes("You can only learn this spell from the Mage Training Arena."), f.messages.join(" | "));
  f.p.setAttribute("mage-training-arena:bones-to-peaches", true);
  await cast(f);
  assert.equal(f.p.getInventory().getAmount(PEACH), 3, "unlocked: the bones become peaches");
});
