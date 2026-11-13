// Run after `yarn build`: node --test tests/jewellery-quest-destinations.test.cjs
// Wiki (Games necklace): Tears of Guthix "Requires completion of Tears of Guthix quest"; (Ring of wealth): Miscellania
// "Requires completion of Throne of Miscellania", Dondakan "Requires completion of Between a Rock...". The jewellery
// and the house's jewellery box teleported there without them, and the box's menu showed them open. Real engine:
// every plugin loaded, real Players and items, the real quests' stages; the teleport itself is recorded.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Ring, Box, next = 9950;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  Ring = require("../plugins/items/RingOfWealth.plugin")._test;
  Box = require("../plugins/skills/construction/JewelleryBox.Construction")._test;
});
after(() => PM.emitServerShutdown({}));

const quest = (key) => require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === key);

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("jwq" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  const teleports = [];
  t.mock.method(core.TeleportHandler, "teleport", (_p, to) => teleports.push([to.getX(), to.getY()]));
  return { p, teleports };
}

for (const [label, key] of [["Miscellania", "throne_of_miscellania"], ["Dondakan", "between_a_rock"]]) {
  test(`the ring of wealth's ${label} needs ${key}`, (t) => {
    const f = actor(t);
    const q = quest(key); assert.ok(q, key);
    const ring = new core.Item(core.ItemIdentifiers.RING_OF_WEALTH_5_, 1);
    f.p.getInventory().setItem(0, ring);
    const event = { interfaceId: 3214, slot: 0 };
    const target = Ring.TELEPORTS.find((entry) => entry.label === label).destination;
    q.setStage(f.p, 0);
    Ring.teleport(f.p, event, ring, target);
    assert.equal(f.teleports.length, 0, "refused before the quest");
    assert.equal(f.p.getInventory().getItems()[0].getId(), core.ItemIdentifiers.RING_OF_WEALTH_5_, "no charge");
    q.setStage(f.p, q.completionValue);
    Ring.teleport(f.p, event, ring, target);
    assert.equal(f.teleports.length, 1, "teleports after it");
  });
}

test("the jewellery box strikes out and refuses Tears of Guthix, Miscellania and Dondakan's Rock until their quests", (t) => {
  const f = actor(t);
  const keys = { "Tears of Guthix": "tears_of_guthix", "Miscellania": "throne_of_miscellania", "Dondakan's Rock": "between_a_rock" };
  const bits = { "Tears of Guthix": 0b00001, "Miscellania": 0b00100, "Dondakan's Rock": 0b01000 };
  for (const key of Object.values(keys)) quest(key).setStage(f.p, 0);
  const mask = Box.destinationMask(f.p);
  for (const [label, bit] of Object.entries(bits)) assert.equal(mask & bit, 0, `${label} struck out`);
  assert.equal(mask & 0b00010, 0, "Kourend struck out before Veos's first trip (jewellery-kourend-visit)");
  for (const [label, key] of Object.entries(keys)) {
    const slot = Box.DESTINATIONS.findIndex((entry) => entry.label === label);
    assert.notEqual(slot, -1, label);
    t.mock.method(core.TeleportHandler, "checkReqs", () => true);
    const before = f.teleports.length;
    Box.teleport(f.p, slot);
    assert.equal(f.teleports.length, before, `${label}: refused`);
    quest(key).setStage(f.p, quest(key).completionValue);
    Box.teleport(f.p, slot);
    assert.equal(f.teleports.length, before + 1, `${label}: teleports after ${key}`);
    t.mock.restoreAll();
    t.mock.method(core.TeleportHandler, "teleport", (_p, to) => f.teleports.push([to.getX(), to.getY()]));
  }
  const open = Box.destinationMask(f.p);
  for (const [label, bit] of Object.entries(bits)) assert.equal(open & bit, bit, `${label} open after its quest`);
});
