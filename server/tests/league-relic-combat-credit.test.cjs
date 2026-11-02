// Demonic Pacts relics that deal damage outside an attack, through the real combat and hit queue:
// what they take is credited to their owner, and they hit only what their owner may attack.
// Damage a Demonic Pacts relic deals outside an attack is credited to its owner through the real
// hit queue, so a kill is theirs (loot, kill count, tasks): Flask of Fervour's explosions.
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
let next = 2100;
/** The hit queues' cycle, one a turn (HitQueue.process skips a cycle it has run). */
let cycle = 1000000;
const AT = [1666, 3136, 0];
const FLASK_OF_FERVOUR = { 7: 3 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  GameConstants.setWorldProfile("league");
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function pactsCharacter(t, relics) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(`credit${next}`);
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

test("Flask of Fervour: an explosion's kill of an untouched NPC is the flask owner's", async (t) => {
  const f = pactsCharacter(t, FLASK_OF_FERVOUR);
  f.player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 99);
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  const id = [...Array(20000).keys()].find((each) => {
    const npc = core.CacheDefinitions.getNpc(each);
    return npc?.name === "Chicken" && (npc.actions ?? []).includes("Attack");
  });
  const chicken = core.NPC.create(id, new core.Location(AT[0] + 1, AT[1], 0));
  core.World.getNpcs().add(chicken);
  t.after(() => core.World.getNpcs().remove(chicken));
  f.player.getLocalNpcs = () => [chicken];
  const flask = core.ItemIdentifiers.FLASK_OF_FERVOUR;
  f.player.getInventory().add(new core.Item(flask), true);
  await f.connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16, slot: 0, itemId: flask, option: "Activate", optionIndex: 1 }]);
  f.connection.processTurnPackets();
  let killer = null;
  for (let tick = 0; tick < 8 && !killer; tick++) {
    core.TaskManager.process();
    cycle++;
    for (const npc of core.World.getNpcs()) npc?.getCombat?.().getHitQueue?.().process?.(cycle);
    if (chicken.getHitpoints() <= 0) killer = chicken.getCombat().getKiller(false);
  }
  assert.equal(chicken.getHitpoints(), 0, "the explosion kills the chicken");
  assert.equal(killer, f.player, "its killer is the flask's owner");
});

/** A Goblin beside the player, through the real NPC and world. */
function goblin(t, dx, dy) {
  const id = [...Array(20000).keys()].find((each) => {
    const npc = core.CacheDefinitions.getNpc(each);
    return npc?.name === "Goblin" && (npc.actions ?? []).includes("Attack");
  });
  const npc = core.NPC.create(id, new core.Location(AT[0] + dx, AT[1] + dy, 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  return npc;
}

/** The Minion whistle's real Blow: the minion beside its owner. */
async function blow(f) {
  const whistle = core.ItemIdentifiers.MINION_WHISTLE;
  f.player.getInventory().add(new core.Item(whistle), true);
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === whistle);
  await f.connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16, slot, itemId: whistle, option: "Blow", optionIndex: 1 }]);
  f.connection.processTurnPackets();
  // The world's loop adds a spawned NPC from its queue; here, at once.
  for (const npc of core.World.getAddNPCQueue().splice(0)) core.World.getNpcs().add(npc);
  const Minion = require("../plugins/modes/leaguerelics/Minion.LeagueRelics");
  const minion = Minion.minions.get(f.player);
  assert.ok(minion?.npc.isRegistered(), "the whistle summons the minion");
  return minion;
}

/** Turns of the world as far as these fights need: the tasks, then each NPC's hits due (by cycle). */
function turns(count, npcs) {
  for (let tick = 0; tick < count; tick++) {
    core.TaskManager.process();
    cycle++;
    for (const npc of npcs) npc.getCombat().getHitQueue().process(cycle);
  }
}

test("Minion: in single combat it never hits an NPC its owner is refused (held by another), and does hit one it may fight", async (t) => {
  const f = pactsCharacter(t, { 7: 2 });
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  const holder = goblin(t, 1, 0);
  const other = goblin(t, 0, 1);
  const minion = await blow(f);
  t.after(() => core.World.getNpcs().remove(minion.npc));
  t.mock.method(Math, "random", () => 0); // every Minion hit lands (its lowest, the min hit)
  // The holder's hit has landed on the owner in single combat, as a landed hit marks it (CombatFactory).
  holder.getCombat().attack(f.player);
  f.player.getCombat().setUnderAttack(holder);
  assert.ok(core.CombatFactory.isBeingAttacked(f.player), "the holder holds the owner");
  // The owner clicks Attack on the other: core refuses it and keeps it as the target to retry.
  f.player.getCombat().attack(other);
  assert.equal(core.CombatFactory.canAttackPermission(f.player, other), core.CanAttackResponse.ALREADY_UNDER_ATTACK);
  assert.equal(f.player.getCombat().getTarget(), other, "the refused target is kept");
  const hp = other.getHitpoints();
  turns(12, [holder, other]);
  assert.equal(other.getHitpoints(), hp, "the minion never touched the other goblin");
  assert.ok(minion.npc.isRegistered(), "the minion is still out");
  // Once the owner may fight it, the minion does.
  holder.getCombat().reset();
  core.World.getNpcs().remove(holder);
  f.player.getCombat().setUnderAttack(null);
  f.player.getCombat().attack(other);
  assert.equal(core.CombatFactory.canAttackPermission(f.player, other), core.CanAttackResponse.CAN_ATTACK);
  turns(12, [other]);
  assert.ok(other.getHitpoints() < hp, `the minion hits a target its owner may fight: ${other.getHitpoints()} of ${hp}`);
});
