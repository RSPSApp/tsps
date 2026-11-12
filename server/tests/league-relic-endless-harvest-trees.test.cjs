// Demonic Pacts' Endless Harvest through the real Woodcutting: a tree the relic keeps standing is
// chopped on, not left mid-swing (docs/leagues.md, Demonic Pacts' relics); without the relic the
// same tree falls after its log and the chopping stops.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { GameConstants } = require("../dist/game/GameConstants");

let core;
let next = 1900;
const AT = [1666, 3136, 0];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  GameConstants.setWorldProfile("league");
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** A new Demonic Pacts character, logged in through the real hooks, its tutorial done, `relics` picked. */
function pactsCharacter(t, relics) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(`harvest${next}`);
  player.setProfile("league");
  player.setRegistered(true);
  player.setLocation(new core.Location(...AT));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  PM.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: true, profile: "league" });
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  player.setAttribute("league:tutorial-stage", 14);
  player.setAttribute("league:relics", relics);
  player.moveTo(new core.Location(...AT));
  player.needsPlacement = false;
  player.getInventory().resetItems();
  player.getPacketSender().sendInterfaceRemoval();
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection };
}

async function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.player.getIndex());
    f.player.getMovementQueue().process();
    core.TaskManager.process();
  }
}

/** A normal tree beside the player, chopped with every roll a log (none a nest) for `count` ticks. */
async function chop(t, f, count) {
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.WOODCUTTING, 99);
  skills.setCurrentLevel(core.Skill.WOODCUTTING, 99);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_AXE), true);
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  const tree = new core.GameObject(core.ObjectIdentifiers.TREE, new core.Location(AT[0] + 1, AT[1], 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => core.ObjectManager.deregister(tree, true));
  t.mock.method(Math, "random", () => (new Error().stack.includes("maybeDropBirdNest") ? 0.99 : 0));
  await f.connection.dispatch([{ type: "object_option", id: tree.getId(), x: AT[0] + 1, y: AT[1], action: "Chop down" }]);
  f.connection.processTurnPackets();
  await ticks(f, count);
  return tree;
}

function logs(f) {
  const id = core.ItemIdentifiers.LOGS;
  return f.player.getInventory().getAmount(id) + f.player.getBank(0).getAmount(id);
}

const Woodcutting = () => require("../plugins/skills/Woodcutting.plugin");

test("Endless Harvest: the tree it keeps standing is chopped on, two logs a log", async (t) => {
  const f = pactsCharacter(t, { 0: 1 });
  const tree = await chop(t, f, 20);
  assert.equal(Woodcutting().isWoodcuttingActive(f.player), true, "still chopping");
  assert.ok(core.ObjectManager.objectsAt(tree.getLocation()).some((o) => o.getId() === tree.getId()), "the tree stands, no stump");
  assert.ok(logs(f) >= 6, `logs keep coming: ${logs(f)}`);
  assert.equal(logs(f) % 2, 0, "each log is doubled");
});

test("without the relic: the same tree falls after its log and the chopping stops", async (t) => {
  const f = pactsCharacter(t, {});
  const tree = await chop(t, f, 20);
  assert.equal(Woodcutting().isWoodcuttingActive(f.player), false);
  assert.equal(core.ObjectManager.objectsAt(tree.getLocation()).some((o) => o.getId() === tree.getId()), false, "a stump in its place");
  assert.equal(logs(f), 1);
});

// Wiki: Endless Harvest (Demonic Pacts), automatic fishing relocation applies to all fish types.
async function fish(t, f, { minnow = false } = {}) {
  const { ItemIdentifiers: I, NpcIdentifiers: N, NPC, Location, World, Skill } = core;
  const at = minnow ? [2608, 3444, 0] : [2845, 3429, 0];
  f.player.setAttribute("league:areas", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  core.RegionManager.loadMapFiles(...at);
  f.player.setLocation(new Location(...at));
  f.player.needsPlacement = false;
  f.player.getSkillManager().setExperience(Skill.FISHING, core.SkillManager.getExperienceForLevel(99));
  f.player.getSkillManager().setMaxLevel(Skill.FISHING, 99);
  f.player.getSkillManager().setCurrentLevel(Skill.FISHING, 99);
  f.player.getInventory().add(new core.Item(minnow ? I.SMALL_FISHING_NET : I.LOBSTER_POT), true);
  const npc = NPC.create(minnow ? N.FISHING_SPOT_87 : N.FISHING_SPOT_10,
    new Location(at[0] + 1, at[1], 0));
  npc.setScriptedMovement(true);
  assert.equal(World.getNpcs().add(npc), true);
  npc.needsPlacement = false;
  t.after(() => { if (npc.isRegistered()) World.getNpcs().removes(npc); });
  t.mock.method(Math, "random", () => {
    const stack = new Error().stack;
    // Force ordinary simulated movement, while avoiding flying fish and unrelated reward rolls.
    return stack.includes("getRandom") && stack.includes("FishingTask") ? 0 :
      stack.includes("rollCatch") ? 0 : 0.5;
  });
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: npc.getDefinition().getActions().findIndex((action) => action?.toLowerCase() === (minnow ? "small net" : "cage")) + 1 }]);
  f.connection.processTurnPackets();
  await ticks(f, 10);
  return { npc, item: minnow ? I.MINNOW : I.RAW_LOBSTER };
}

function catches(f, item) {
  return f.player.getInventory().getAmount(item) + f.player.getBank(0).getAmount(item);
}

test("Demonic Endless Harvest fishes through forced random stops; ordinary and Reloaded fishing stop", async (t) => {
  for (const [league, relics, expected] of [[6, { 0: 1 }, true], [6, {}, false], [4, { 0: 1 }, false]]) {
    const f = pactsCharacter(t, relics);
    f.player.setAttribute("league:type", league);
    const { item } = await fish(t, f);
    assert.equal(require("../plugins/skills/Fishing.plugin").isFishingActive(f.player), expected, "league " + league);
    assert.ok(catches(f, item) > 0);
    const before = catches(f, item);
    await ticks(f, 12);
    assert.equal(catches(f, item) > before, expected);
  }
});

test("Demonic Endless Harvest does not chase a moved minnow spot", async (t) => {
  // Wiki: Endless Harvest (Demonic Pacts League), notes: "Your character will chase the fishing spot as
  // it moves. You will not chase minnows, and will stop harvesting when they move." The 23 April 2026
  // changelog's "this applies to all fish types" is the relocation the line above it describes.
  const f = pactsCharacter(t, { 0: 1 });
  const { npc } = await fish(t, f, { minnow: true });
  const start = f.player.getLocation().getX();
  npc.moveTo(new core.Location(2611, 3444, 0));
  await ticks(f, 12);
  assert.equal(require("../plugins/skills/Fishing.plugin").isFishingActive(f.player), false, "harvesting stops when the minnows move");
  assert.equal(f.player.getLocation().getX(), start, "the player does not walk after them");
});

test("relocated spots stop without Demonic Endless Harvest; resumption rechecks the tool and relic", async (t) => {
  for (const mode of ["ordinary", "reloaded", "tool", "relic", "plane"]) {
    const f = pactsCharacter(t, mode === "ordinary" ? {} : { 0: 1 });
    if (mode === "reloaded") {
      f.player.setAttribute("league:type", 4);
      f.player.setAttribute("league:relics", { 0: 1 });
    }
    const { npc, item } = await fish(t, f, { minnow: true });
    const before = catches(f, item);
    if (mode === "tool") f.player.getInventory().resetItems();
    if (mode === "relic") f.player.setAttribute("league:relics", {});
    npc.moveTo(new core.Location(2611, 3444, mode === "plane" ? 1 : 0));
    await ticks(f, 12);
    assert.equal(require("../plugins/skills/Fishing.plugin").isFishingActive(f.player), false, mode);
    assert.equal(catches(f, item), before, mode + " gains no catch");
  }
});

test("starting combat without stepping cancels Endless Harvest before a relocated spot can reset the attack", async (t) => {
  const f = pactsCharacter(t, { 0: 1 });
  const { npc, item } = await fish(t, f, { minnow: true });
  const target = core.NPC.create(core.NpcIdentifiers.GOBLIN, new core.Location(2608, 3443, 0));
  assert.equal(core.World.getNpcs().add(target), true);
  target.needsPlacement = false;
  t.after(() => { if (target.isRegistered()) core.World.getNpcs().removes(target); });
  const clickType = target.getDefinition().getActions().findIndex((action) => action?.toLowerCase() === "attack") + 1;
  assert.ok(clickType > 0);
  await f.connection.dispatch([{ type: "npc_option", index: target.getIndex(), clickType }]);
  f.connection.processTurnPackets();
  assert.equal(f.player.getCombat().getTarget(), target);
  assert.equal(f.player.getMovementQueue().size(), 0, "combat starts without a step");
  const before = catches(f, item);
  npc.moveTo(new core.Location(2611, 3444, 0));
  core.TaskManager.process();
  assert.equal(require("../plugins/skills/Fishing.plugin").isFishingActive(f.player), false);
  assert.equal(f.player.getCombat().getTarget(), target, "auto fishing must not reset the chosen attack");
  await ticks(f, 8);
  assert.equal(catches(f, item), before);
});
