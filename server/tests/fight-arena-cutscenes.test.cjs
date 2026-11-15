// Run after `yarn build`: node --test tests/fight-arena-cutscenes.test.cjs
//
// Fight Arena's cutscenes against rsprox_transcripts/241/911665.txt (rev 241; 242/912123.txt plays the
// same cameras and cast). Real Player, PlayerSession and ClientConnection, the real plugins, the real map
// and real packets: the keys are used on Sammy's door with inventory_use_on and the conversations are
// continued with dialogue_continue packets; each tick runs in the order of World.process. The beasts'
// deaths are the death event the NPC's death task emits. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const CUTSCENE_STATUS = 542;
const SCORPION_SEEN_VARBIT = 14718; // arenaquest_scorpion_cutscene
const BOUNCER_SEEN_VARBIT = 14719; // arenaquest_bouncer_cutscene
const SAMMY_DOOR = { id: 80, x: 2617, y: 3167 }; // arena_jeremydoor
let core;
let next = 3100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/skills/shootingstars/Noticeboard.ShootingStars").resetForTests();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  // The arena and the 13 x 13 chunks from 2568,3120 its scenes copy.
  for (let x = 2560; x <= 2688; x += 64) for (let y = 3072; y <= 3264; y += 64) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, start) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("arena" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...start));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const f = { t, player, connection, tick: 0, cameras: [] };
  // The camera as live sends it, in the scene's own (source) tiles.
  const sender = player.getPacketSender();
  const move = sender.sendCameraMoveTo.bind(sender);
  t.mock.method(sender, "sendCameraMoveTo", (x, y, height, rates) => {
    const area = player.getArea();
    const at = area?.toSource ? area.toSource(new core.Location(x, y, 0)) : new core.Location(x, y, 0);
    f.cameras.push([at.getX(), at.getY(), height]);
    return move(x, y, height, rates);
  });
  t.after(() => {
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  return f;
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  for (const npc of core.World.getNpcs()) if (npc?.getOwner?.() === f.player) npc.getMovementQueue().process();
  core.World.updateLocalNpcs(f.player, [...core.World.getNpcs()]);
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

/** A Continue on the open chatbox (the first option of a menu), one tick between clicks, until `done()`. */
async function clickThrough(f, done, limit = 400) {
  for (let i = 0; i < limit && !done(); i++) {
    const group = f.player.getPacketSender().getChatboxGroupId();
    if (MultiChatboxPrompt.getPending(f.player)) {
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 1 }]);
    } else if (f.player.getDialogueManager().isActive() && group >= 0) {
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 }]);
    }
    tick(f);
  }
  assert.ok(done(), `clickThrough stopped after ${limit} ticks`);
}

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fight_arena");
const xyz = (location) => [location.getX(), location.getY(), location.getZ()];
const inScene = (f) => f.player.getArea() instanceof core.TemplatedInstanceArea;
const npcName = (name) => core.CacheDefinitions.getNpcId(name);

/** The scene's cast by cache id, at their source tiles. */
function cast(f) {
  const area = f.player.getArea();
  return area.entities.filter((entity) => entity.isNpc?.()).map((npc) => [npc.getId(), ...xyz(area.toSource(npc.getLocation()))]);
}

/** The player's own fight NPC with this id on the real map. */
function fightNpc(f, id) {
  return [...core.World.getNpcs()].find((npc) => npc?.getId() === id && npc.getOwner?.() === f.player && npc.isRegistered());
}

/** The death event NPCDeathTask emits for a kill by this player, and the NPC gone. */
function kill(f, npc) {
  PM.emitNpcDeath({ killer: f.player, damagers: [f.player], npc, npcId: npc.getContentId(f.player), location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: 0 }, remains: null });
  core.World.getNpcs().remove(npc);
}

async function freeSammy(f) {
  quest().setStage(f.player, 5);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.KHAZARD_CELL_KEYS, 1), false);
  ticks(f, 2);
  const slot = f.player.getInventory().getSlotForItemId(core.ItemIdentifiers.KHAZARD_CELL_KEYS);
  await f.connection.dispatch([{ type: "inventory_use_on", itemId: core.ItemIdentifiers.KHAZARD_CELL_KEYS, slot, target: { kind: "loc", id: SAMMY_DOOR.id, x: SAMMY_DOOR.x, y: SAMMY_DOOR.y } }]);
  ticks(f, 3);
}

test("the keys on Sammy's door play the cell cutscene in a copy and start the ogre fight where live starts it", async (t) => {
  const f = actor(t, [2617, 3166, 0]);
  ticks(f, 3);
  await freeSammy(f);
  await clickThrough(f, () => inScene(f), 60);
  const area = f.player.getArea();
  assert.deepEqual(xyz(area.toSource(f.player.getLocation())), [2617, 3168, 0], "tick 7461: the player in the corridor");
  assert.equal(f.player.getPacketSender().getVarbit(CUTSCENE_STATUS), 1);
  assert.equal(quest().getStage(f.player), 5, "nothing moves on before the ogre's attack");
  assert.deepEqual(cast(f).sort(), [
    [npcName("arena_bouncer_cutscene"), 2608, 3162, 0],
    [npcName("arena_ogre_cutscene"), 2608, 3165, 0],
    [npcName("sammy_servil_cutscene"), 2616, 3167, 0],
    [npcName("arena_scorpion_cutscene"), 2608, 3159, 0],
  ].sort(), "tick 7461: the cutscene cast in their places");

  await clickThrough(f, () => !inScene(f) && fightNpc(f, core.NpcIdentifiers.KHAZARD_OGRE), 200);
  assert.deepEqual(f.cameras.slice(0, 4), [[2617, 3158, 500], [2601, 3162, 490], [2600, 3161, 490], [2600, 3157, 490]],
    "ticks 7462, 7490, 7497, 7500: the camera moves");
  assert.equal(quest().getStage(f.player), 6);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.KHAZARD_CELL_KEYS), 0, "tick 7509: the keys go");
  assert.deepEqual(xyz(f.player.getLocation()), [2605, 3153, 0], "tick 7511: the player's fight tile");
  assert.deepEqual(xyz(fightNpc(f, core.NpcIdentifiers.KHAZARD_OGRE).getLocation()), [2602, 3165, 0], "tick 7512: the ogre's");
  assert.equal(area.isDestroyed(), true);
  ticks(f, 3);
  assert.equal(f.player.getPacketSender().getVarbit(CUTSCENE_STATUS), 0);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false, "tick 7513: control is back with the fade in");
  assert.equal(f.player.getDialogueManager().isActive(), false);
});

test("each kill plays its scene: Khazard, the jail and Hengrad, the scorpion's and Bouncer's pens, then Khazard's fight", async (t) => {
  const f = actor(t, [2605, 3153, 0]);
  ticks(f, 3);
  quest().setStage(f.player, 5);
  // The ogre's step outside the cell scene (a replayed conversation): the plain way into the fight.
  PM.emitCustomEvent("npc-dialogue:action", { player: f.player, npcId: core.NpcIdentifiers.SAMMY_SERVIL, stepId: "jXf_Wp", handled: false });
  assert.equal(quest().getStage(f.player), 6);
  ticks(f, 2);

  kill(f, fightNpc(f, core.NpcIdentifiers.KHAZARD_OGRE));
  assert.equal(quest().getStage(f.player), 8);
  ticks(f, 2);
  assert.ok(inScene(f), "tick 7570: Khazard's scene two ticks after the ogre goes");
  assert.deepEqual(xyz(f.player.getArea().toSource(f.player.getLocation())), [2599, 3159, 0]);
  assert.ok(cast(f).some(([id, x, y]) => id === npcName("general_khazard_cutscene") && x === 2604 && y === 3153));
  await clickThrough(f, () => !inScene(f) && quest().getStage(f.player) === 9, 200);
  assert.deepEqual(xyz(f.player.getLocation()), [2598, 3143, 0], "tick 7627: Hengrad's cell");
  ticks(f, 4);
  assert.equal(f.player.getDialogueManager().isActive(), true, "tick 7631: Hengrad speaks first");

  await clickThrough(f, () => fightNpc(f, core.NpcIdentifiers.KHAZARD_SCORPION) && !inScene(f), 200);
  assert.equal(f.player.getPacketSender().getVarbit(SCORPION_SEEN_VARBIT), 1, "tick 7686: arenaquest_scorpion_cutscene");
  assert.deepEqual(xyz(f.player.getLocation()), [2604, 3155, 0]);
  assert.deepEqual(xyz(fightNpc(f, core.NpcIdentifiers.KHAZARD_SCORPION).getLocation()), [2601, 3159, 0], "tick 7689");
  ticks(f, 3);

  kill(f, fightNpc(f, core.NpcIdentifiers.KHAZARD_SCORPION));
  assert.equal(quest().getStage(f.player), 10);
  await clickThrough(f, () => fightNpc(f, core.NpcIdentifiers.BOUNCER) && !inScene(f), 200);
  assert.equal(f.player.getPacketSender().getVarbit(BOUNCER_SEEN_VARBIT), 1, "tick 7740: arenaquest_bouncer_cutscene");
  assert.deepEqual(xyz(fightNpc(f, core.NpcIdentifiers.BOUNCER).getLocation()), [2603, 3162, 0], "tick 7743");
  ticks(f, 3);

  kill(f, fightNpc(f, core.NpcIdentifiers.BOUNCER));
  assert.equal(quest().getStage(f.player), 11);
  await clickThrough(f, () => fightNpc(f, core.NpcIdentifiers.GENERAL_KHAZARD) && !inScene(f), 200);
  assert.equal(quest().getStage(f.player), 12, "tick 7937: the Servils are let go");
  assert.deepEqual(xyz(f.player.getLocation()), [2601, 3156, 0]);
  assert.deepEqual(xyz(fightNpc(f, core.NpcIdentifiers.GENERAL_KHAZARD).getLocation()), [2600, 3153, 0], "tick 7940");
  const moves = f.cameras.map(([x, y, h]) => `${x},${y},${h}`);
  for (const wanted of ["2601,3165,600", "2601,3164,600", "2601,3156,500", "2601,3159,460", "2599,3164,590"]) {
    assert.ok(moves.includes(wanted), `the camera move ${wanted} was sent`);
  }
  ticks(f, 3);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});

test("a logout mid-scene saves the scene's exit, keeps the keys and stage, and the seen pen is skipped on the way back", async (t) => {
  const f = actor(t, [2617, 3166, 0]);
  ticks(f, 3);
  await freeSammy(f);
  await clickThrough(f, () => inScene(f), 60);
  const area = f.player.getArea();
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.equal(area.isDestroyed(), true);
  assert.deepEqual(xyz(f.player.getLocation()), [2617, 3166, 0], "the cell scene's exit");
  assert.equal(quest().getStage(f.player), 5);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.KHAZARD_CELL_KEYS), 1);

  const g = actor(t, [2598, 3143, 0]);
  ticks(g, 3);
  quest().setStage(g.player, 9);
  g.player.setAttribute("fight-arena:scorpion-cutscene-seen", 1);
  PM.emitCustomEvent("npc-dialogue:action", { player: g.player, npcId: core.NpcIdentifiers.HENGRAD, stepId: "XDkdB3", handled: false });
  assert.equal(inScene(g), false);
  assert.deepEqual(xyz(g.player.getLocation()), [2604, 3155, 0], "a seen scorpion scene goes straight to the fight");
  assert.ok(fightNpc(g, core.NpcIdentifiers.KHAZARD_SCORPION));
});

test("a logout after the Servils are let go (stage 12) brings General Khazard back at login, once", (t) => {
  const f = actor(t, [2601, 3156, 0]);
  ticks(f, 3);
  quest().setStage(f.player, 12);
  assert.equal(fightNpc(f, core.NpcIdentifiers.GENERAL_KHAZARD), undefined);
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
  const generals = [...core.World.getNpcs()].filter((npc) => npc?.getId() === core.NpcIdentifiers.GENERAL_KHAZARD && npc.getOwner?.() === f.player && npc.isRegistered());
  assert.equal(generals.length, 1);
  assert.deepEqual(xyz(generals[0].getLocation()), [2600, 3153, 0]);
  kill(f, generals[0]);
  assert.equal(quest().getStage(f.player), 13);
});
