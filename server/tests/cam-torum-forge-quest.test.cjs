// Run after `yarn build`: node --test tests/cam-torum-forge-quest.test.cjs
// Cam Torum's Forge "can be used as a regular furnace after the completion of Perilous Moons" (OSRS Wiki,
// Forge (Cam Torum)); rsprox_transcripts/237/01098.txt has Smelt on loc 51496 after the quest. Before it, the
// Forge refuses (our line: live's refusal is unrecorded). Real engine: every plugin loaded, real Players,
// a real loc, the clicks through PluginManager's object and item-on-object dispatch, the quest's real stage.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core, next = 9850;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const FORGE_TILE = [1453, 9582, 1];
const REFUSAL = "You need to have completed Perilous Moons to use the Forge.";
const STAGE_COMPLETE = 36;
const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "perilous_moons");

function setup(t, stage) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("forge" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  core.RegionManager.loadMapFiles(FORGE_TILE[0], FORGE_TILE[1]);
  p.setLocation(new core.Location(FORGE_TILE[0] + 1, FORGE_TILE[1] - 1, FORGE_TILE[2])); p.needsPlacement = false;
  const conn = new ClientConnection(channel); conn.player = p;
  const forgeId = core.CacheDefinitions.getLocId("cam_torum_sacred_forge");
  const forge = new core.GameObject(forgeId, new core.Location(...FORGE_TILE), 10, 0, null);
  core.ObjectManager.register(forge, true);
  t.after(() => {
    core.ObjectManager.deregister(forge, true);
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false);
  });
  if (stage) quest().setStage(p, stage);
  for (const id of [core.ItemIdentifiers.COPPER_ORE, core.ItemIdentifiers.TIN_ORE]) p.getInventory().add(new core.Item(id, 1), false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, forge, messages };
}

function smelt({ p, forge }) {
  const definition = core.ObjectDefinition.forPlayer(forge.getId(), p);
  const clickType = definition.getInteractions().indexOf("Smelt") + 1;
  assert.ok(clickType > 0, "the cache's Smelt option");
  const event = { player: p, object: forge, definition, objectId: forge.getId(), clickType, option: "Smelt",
    location: { x: FORGE_TILE[0], y: FORGE_TILE[1], z: FORGE_TILE[2] }, handled: false };
  PM.emitObjectInteraction(event);
  return event;
}

function useOre({ p, forge }) {
  const itemId = core.ItemIdentifiers.COPPER_ORE;
  const itemSlot = p.getInventory().getSlotForItemId(itemId);
  const event = { player: p, object: forge, definition: core.ObjectDefinition.forPlayer(forge.getId(), p) ?? undefined,
    objectId: forge.getId(), item: p.getInventory().getItems()[itemSlot], itemId, itemSlot, interfaceType: 0,
    location: { x: FORGE_TILE[0], y: FORGE_TILE[1], z: FORGE_TILE[2] }, handled: false };
  PM.emitItemOnObject(event);
  return event;
}

test("the loc is named Forge and listed as a quest furnace", () => {
  const forgeId = core.CacheDefinitions.getLocId("cam_torum_sacred_forge");
  assert.equal(forgeId, core.ObjectIdentifiers.FORGE);
  assert.equal(core.ObjectDefinition.forId(forgeId).getName(), "Forge");
  assert.equal(require("../plugins/skills/data/furnaces.json").quests.Forge.quest, "perilous_moons");
});

test("before Perilous Moons, Smelt and ore used on the Forge are refused and nothing is smelted", (t) => {
  const f = setup(t, 0);
  assert.equal(quest().isComplete(f.p), false);
  const click = smelt(f);
  assert.equal(click.handled, true);
  const use = useOre(f);
  assert.equal(use.handled, true);
  assert.deepEqual(f.messages, [REFUSAL, REFUSAL]);
  for (let i = 0; i < 6; i++) core.TaskManager.process();
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.COPPER_ORE), 1);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.BRONZE_BAR), 0);
});

test("mid-quest is still refused", (t) => {
  const f = setup(t, STAGE_COMPLETE - 1);
  assert.equal(smelt(f).handled, true);
  assert.deepEqual(f.messages, [REFUSAL]);
});

test("after Perilous Moons the Forge works as a furnace", (t) => {
  const f = setup(t, STAGE_COMPLETE);
  assert.equal(quest().isComplete(f.p), true);
  const click = smelt(f);
  assert.equal(click.handled, true, "the smelting menu takes the click");
  const use = useOre(f);
  assert.equal(use.handled, true, "the ore opens the smelting menu");
  assert.equal(f.messages.includes(REFUSAL), false);
});
