// Run after `yarn build`: node --test tests/fremennik-isles-bork-and-chest.test.cjs
// The Fremennik Isles: Bork's three supplies each gave their items every time they were picked (his menu stays up until
// all three are claimed), so tuna and strength and prayer potions could be farmed; and the jester chest checked for
// one free slot but gives four pieces, with its flag set first, so missing pieces were lost and the quest blocked.
// Real engine: every plugin loaded, a real Player at the quest's own stages, its dialogue actions and chest handler.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let QuestRuntime;
let next = 9200;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  QuestRuntime = require("../plugins/quests/QuestRuntime");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, stage) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("isles" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => p.setRegistered(false));
  QuestRuntime.questNamed("The Fremennik Isles").setStage(p, stage);
  return { p, inv: p.getInventory(), messages };
}

const action = (f, stepId) => PM.emitCustomEvent("npc-dialogue:action", { player: f.p, npcId: core.NpcIdentifiers.BORK_SIGMUNDSON, stepId, kind: "action" });

test("each of Bork's supplies is given once", (t) => {
  const f = actor(t, 18);
  action(f, "1eVvoF");
  action(f, "1eVvoF");
  assert.equal(f.inv.getAmount(I.RAW_TUNA) + f.inv.getAmount(I.TUNA), 10, "ten tuna, not twenty");
  action(f, "eJNB7e");
  action(f, "eJNB7e");
  assert.equal(f.inv.getAmount(I.STRENGTH_POTION_4_), 4);
});

test("a supply that does not fit is not claimed, so it can be asked for again", (t) => {
  const f = actor(t, 18);
  for (let slot = 0; slot < 25; slot++) f.inv.setItem(slot, new core.Item(I.LOGS, 1));
  action(f, "eCZJLI");
  assert.equal(f.inv.getAmount(I.PRAYER_POTION_3_), 0, "three free slots cannot take four potions");
  f.inv.setItem(24, new core.Item(-1, 0));
  action(f, "eCZJLI");
  assert.equal(f.inv.getAmount(I.PRAYER_POTION_3_), 4);
});

test("the jester chest needs room for all four pieces before it gives any", (t) => {
  const f = actor(t, 4);
  for (let slot = 0; slot < 26; slot++) f.inv.setItem(slot, new core.Item(I.LOGS, 1));
  const chest = { getId: () => JESTER_CHEST_ID(), getLocation: () => f.p.getLocation() };
  const open = () => PM.emitObjectInteraction({ player: f.p, object: chest, objectId: JESTER_CHEST_ID(), definition: { getActions: () => ["Open"], getName: () => "Chest" }, clickType: 1, location: f.p.getLocation(), handled: false });
  open();
  assert.equal(f.inv.getAmount(I.SILLY_JESTER_HAT), 0, "two free slots take nothing");
  for (let slot = 22; slot < 26; slot++) f.inv.setItem(slot, new core.Item(-1, 0));
  open();
  assert.deepEqual([I.SILLY_JESTER_HAT, I.SILLY_JESTER_TOP, I.SILLY_JESTER_TIGHTS, I.SILLY_JESTER_BOOTS].map((id) => f.inv.getAmount(id)), [1, 1, 1, 1]);
});

// The chest also replaces a lost costume: it gives whichever of the four pieces the player lacks (Wiki: "If the jester
// outfit is lost, a player can retrieve another one from the chest behind King Gjuki Sorvott IV's throne").
function jesterChest(f) {
  const chest = { getId: () => JESTER_CHEST_ID(), getLocation: () => f.p.getLocation() };
  return () => PM.emitObjectInteraction({ player: f.p, object: chest, objectId: JESTER_CHEST_ID(), definition: { getActions: () => ["Open"], getName: () => "Chest" }, clickType: 1, location: f.p.getLocation(), handled: false });
}
const jesterIds = () => [I.SILLY_JESTER_HAT, I.SILLY_JESTER_TOP, I.SILLY_JESTER_TIGHTS, I.SILLY_JESTER_BOOTS];
const jesterCounts = (f) => jesterIds().map((id) => f.inv.getAmount(id));

test("a reopened jester chest gives back only the lost piece", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  f.inv.delete(I.SILLY_JESTER_HAT, 1);
  open();
  assert.deepEqual(jesterCounts(f), [1, 1, 1, 1]);
  assert.equal(f.messages.at(-1), "You take the silly jester costume from the chest.");
});

test("a reopened jester chest gives all four after the whole costume is lost", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  for (const id of jesterIds()) f.inv.delete(id, 1);
  open();
  assert.deepEqual(jesterCounts(f), [1, 1, 1, 1]);
});

test("a jester chest gives nothing while the whole costume is held", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  open();
  assert.deepEqual(jesterCounts(f), [1, 1, 1, 1]);
  assert.equal(f.messages.at(-1), "You have already taken the jester costume.");
});

test("worn jester pieces count as owned", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  f.inv.delete(I.SILLY_JESTER_HAT, 1);
  f.p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.SILLY_JESTER_HAT, 1));
  open();
  assert.deepEqual(jesterCounts(f), [0, 1, 1, 1], "no second hat");
  assert.equal(f.messages.at(-1), "You have already taken the jester costume.");
});

test("a reopened jester chest needs a slot for every missing piece", (t) => {
  const f = actor(t, 4);
  const open = jesterChest(f);
  open();
  f.inv.delete(I.SILLY_JESTER_TOP, 1);
  f.inv.delete(I.SILLY_JESTER_TIGHTS, 1);
  for (let slot = 0; slot < 28; slot++) if (!(f.inv.get(slot)?.getId?.() > 0)) f.inv.setItem(slot, new core.Item(I.LOGS, 1));
  f.inv.setItem(27, new core.Item(-1, 0));
  open();
  assert.deepEqual(jesterCounts(f), [1, 0, 0, 1], "one free slot takes neither missing piece");
  assert.equal(f.messages.at(-1), "You need some free inventory space to take the costume.");
  f.inv.setItem(26, new core.Item(-1, 0));
  open();
  assert.equal(f.inv.getAmount(I.SILLY_JESTER_TOP) + f.inv.getAmount(I.SILLY_JESTER_TIGHTS), 2);
});

function JESTER_CHEST_ID() {
  return core.ObjectIdentifiers.CHEST_70; // the plugin's JESTER_CHEST (21299)
}
