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

function JESTER_CHEST_ID() {
  return core.ObjectIdentifiers.CHEST_70; // the plugin's JESTER_CHEST (21299)
}
