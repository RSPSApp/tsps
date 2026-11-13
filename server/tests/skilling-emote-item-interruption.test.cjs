// Run after `yarn build`: node --test tests/skilling-emote-item-interruption.test.cjs
// An accepted emote, or an inventory item action (osrs-docs: Entity Interactions - Interruptions),
// ends fishing and mining as it ends woodcutting (woodcutting-emote-interruption.test.cjs).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const Fishing = require("../plugins/skills/Fishing.plugin");

const SPOT_TILE = { x: 3105, y: 3424 };
const ROCK_TILE = { x: 3110, y: 3424 };
const YES_EMOTE_SLOT = 0;
let core, next = 2600;
const previousBots = process.env.DISABLE_PLAYER_BOTS;
const random = Math.random;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(SPOT_TILE.x, SPOT_TILE.y);
  PM.emitServerStartup({});
});
after(() => {
  Math.random = random;
  try { PM.emitServerShutdown({}); } finally {
    if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = previousBots;
  }
});

/** A real Player in the World with a client connection; every catch and ore roll succeeds. */
function actor(t, at, skill) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername("interrupt" + next++);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at.x, at.y, 0));
  assert.equal(core.World.getPlayers().add(p), true);
  p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => {
    core.TaskManager.cancelTasks(p.getIndex());
    if (p.isRegistered()) core.World.getPlayers().removes(p);
  });
  const skills = p.getSkillManager();
  skills.setExperience(skill, SkillManager.getExperienceForLevel(40));
  skills.setMaxLevel(skill, 40);
  skills.setCurrentLevel(skill, 40, true);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.TROUT), true);
  p.setHitpoints(3);
  Math.random = () => {
    const stack = new Error().stack;
    if (stack.includes("rollCatch")) return 0;
    if (stack.includes("rollClueBottles") || stack.includes("Pet") || stack.includes("pet")) return 0.999999;
    return random();
  };
  t.after(() => { Math.random = random; });
  return { p, c };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function ticks(n) {
  for (let i = 0; i < n; i++) core.World.process();
}

function eatPacket(f) {
  const ids = core.ItemIdentifiers;
  return { type: "inventory_action", widgetId: 149 << 16, slot: f.p.getInventory().getSlotForItemId(ids.TROUT), itemId: ids.TROUT, option: "Eat", optionIndex: 1 };
}

const EMOTE_PACKET = { type: "widget_action", widgetId: (216 << 16) | 2, groupId: 216, childId: 2, slot: YES_EMOTE_SLOT, buttonNum: 1, opId: 1, itemId: -1 };

function fishingScene(t) {
  const { ItemIdentifiers: I, NpcIdentifiers: N, NPC, Location, World } = core;
  const f = actor(t, { x: SPOT_TILE.x - 1, y: SPOT_TILE.y }, core.Skill.FISHING);
  f.p.getInventory().add(new core.Item(I.FLY_FISHING_ROD), true);
  f.p.getInventory().add(new core.Item(I.FEATHER, 50), true);
  const spot = NPC.create(N.ROD_FISHING_SPOT_10, new Location(SPOT_TILE.x, SPOT_TILE.y, 0));
  spot.setScriptedMovement(true);
  assert.equal(World.getNpcs().add(spot), true);
  spot.needsPlacement = false;
  t.after(() => { if (spot.isRegistered()) World.getNpcs().removes(spot); });
  ticks(1);
  f.p.needsPlacement = false;
  spot.needsPlacement = false;
  const definition = spot.getCurrentDefinition(f.p);
  const clickType = definition.getActions().indexOf("Lure") + 1;
  assert.ok(clickType > 0);
  assert.equal(PM.emitNpcInteraction({ player: f.p, npc: spot, npcId: spot.getId(), definition, clickType, handled: false }), true);
  // Trout or salmon at level 40: each catch uses a feather.
  return { ...f, caught: () => 50 - f.p.getInventory().getAmount(I.FEATHER) };
}

function miningScene(t) {
  const { ItemIdentifiers: I, CacheDefinitions, GameObject, Location, ObjectManager } = core;
  const f = actor(t, { x: ROCK_TILE.x - 1, y: ROCK_TILE.y }, core.Skill.MINING);
  f.p.getInventory().add(new core.Item(I.BRONZE_PICKAXE), true);
  const rock = new GameObject(CacheDefinitions.getLocId("copperrock1"), new Location(ROCK_TILE.x, ROCK_TILE.y, 0), 10, 0, null);
  ObjectManager.register(rock, true);
  t.after(() => ObjectManager.deregister(rock, true));
  return { ...f, rock, mined: () => f.p.getInventory().getAmount(I.COPPER_ORE) };
}

test("control: fishing and mining go on without an interruption", async (t) => {
  const fishing = fishingScene(t);
  ticks(8);
  assert.ok(fishing.caught() > 0, "the trout spot lands a catch");

  const mining = miningScene(t);
  await send(mining, { type: "object_option", id: mining.rock.getId(), x: ROCK_TILE.x, y: ROCK_TILE.y, action: "Mine" });
  ticks(10);
  assert.ok(mining.mined() > 0, "the copper rock gives ore");
});

for (const [name, packet] of [["an accepted emote", () => EMOTE_PACKET], ["eating from the inventory", eatPacket]]) {
  test(`${name} stops fishing`, async (t) => {
    const fishing = fishingScene(t);
    ticks(1);
    assert.equal(Fishing.isFishingActive(fishing.p), true, "fishing has started");
    const caught = fishing.caught();
    await send(fishing, packet(fishing));
    if (packet === eatPacket) assert.equal(fishing.p.getInventory().getAmount(core.ItemIdentifiers.TROUT), 0, "the trout was eaten");
    else assert.equal(fishing.p.getAnimation()?.getId(), 855, "the Yes emote played");
    ticks(10);
    assert.equal(Fishing.isFishingActive(fishing.p), false);
    assert.equal(fishing.caught(), caught, "no catch after the interruption");
  });
}

test("an accepted emote stops mining", async (t) => {
  const mining = miningScene(t);
  await send(mining, { type: "object_option", id: mining.rock.getId(), x: ROCK_TILE.x, y: ROCK_TILE.y, action: "Mine" });
  ticks(1);
  await send(mining, EMOTE_PACKET);
  assert.equal(mining.p.getAnimation()?.getId(), 855, "the Yes emote plays");
  ticks(10);
  assert.equal(mining.mined(), 0, "no ore after the emote");
});
