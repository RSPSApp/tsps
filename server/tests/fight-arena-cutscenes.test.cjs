// Run after `yarn build`: node --test tests/fight-arena-cutscenes.test.cjs
//
// Fight Arena's cutscenes and fights against rsprox recordings local 1001680 (rev 241, the whole quest) and
// local 1002138 (rev 242: the same cameras, cast and fight copies). Real Player, PlayerSession and
// ClientConnection, the real plugins, the real map and real packets: the keys are used on Sammy's door with
// inventory_use_on and the conversations are continued with dialogue_continue packets; each tick runs in the
// order of World.process. The beasts' deaths are the death event the NPC's death task emits. No client ran.
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
  // The world's spawn table, which the fights' copies take the arena's NPCs from.
  new (require("../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader").NpcSpawnDefinitionLoader)().load();
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
    if (MultiChatboxPrompt.getPending(f.player) || f.player.getPacketSender().getChatboxGroupId() === 219) {
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
const copy = (f) => (f.player.getArea() instanceof core.TemplatedInstanceArea ? f.player.getArea() : null);
/** In a cutscene's copy (not a fight's). */
const inScene = (f) => !!copy(f) && !/ fight scene$/.test(copy(f).getName());
/** In the fight copy against `kind`. */
const inFight = (f, kind) => copy(f)?.getName() === `Fight Arena ${kind} fight scene`;
const npcName = (name) => core.CacheDefinitions.getNpcId(name);
const ESCAPE_DOOR = () => core.CacheDefinitions.getLocId("fightarena_door2_escape");
/** Where the player stands, in source tiles when in a copy. */
const at = (f) => xyz(copy(f) ? copy(f).toSource(f.player.getLocation()) : f.player.getLocation());

/** The scene's cast by cache id, at their source tiles. */
function cast(f) {
  const area = f.player.getArea();
  return area.entities.filter((entity) => entity.isNpc?.()).map((npc) => [npc.getId(), ...xyz(area.toSource(npc.getLocation()))]);
}

/** The player's own fight NPC with this id. */
function fightNpc(f, id) {
  return [...core.World.getNpcs()].find((npc) => npc?.getId() === id && npc.getOwner?.() === f.player && npc.isRegistered());
}
/** An NPC's source tile in the player's copy. */
const npcAt = (f, npc) => xyz(copy(f).toSource(npc.getLocation()));

/** The fight copy's escape door, where live puts it (tick 11838: 2606,3152, shape 9). */
function escapeDoor(f) {
  const door = copy(f).entities.find((entity) => entity?.getId?.() === ESCAPE_DOOR() && !entity.isNpc?.());
  assert.ok(door, "the escape door is in the copy");
  assert.deepEqual(xyz(copy(f).toSource(door.getLocation())), [2606, 3152, 0]);
  return door;
}

function clickEscape(f, clickType = 1) {
  const door = escapeDoor(f);
  const location = door.getLocation();
  PM.emitObjectInteraction({ player: f.player, object: door, objectId: door.getId(), clickType, location: { x: location.getX(), y: location.getY(), z: location.getZ() }, handled: false });
}

/** The real arena door, opened from outside (loc 82 at 2606,3152). */
function openArenaDoor(f) {
  const object = { getId: () => 82, getLocation: () => new core.Location(2606, 3152, 0) };
  const event = { player: f.player, object, objectId: 82, option: "Open", location: { x: 2606, y: 3152, z: 0 }, handled: false };
  PM.emitCustomEvent("door:toggle", event);
  return event;
}

const menuTitle = (f) => f.player.getDialogueManager().getCurrent?.()?.getTitle?.() ?? f.player.getDialogueManager().getCurrent?.()?.title;

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

  await clickThrough(f, () => inFight(f, "ogre"), 200);
  assert.deepEqual(f.cameras.slice(0, 4), [[2617, 3158, 500], [2601, 3162, 490], [2600, 3161, 490], [2600, 3157, 490]],
    "ticks 7462, 7490, 7497, 7500: the camera moves");
  assert.equal(quest().getStage(f.player), 6);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.KHAZARD_CELL_KEYS), 0, "tick 7509: the keys go");
  assert.equal(area.isDestroyed(), true);
  // The fight plays in its own copy (local 1002138 tick 11838: rebuild_region from 2552,3104).
  assert.deepEqual(at(f), [2605, 3153, 0], "tick 11838: the player's fight tile");
  const ogre = fightNpc(f, core.NpcIdentifiers.KHAZARD_OGRE);
  assert.deepEqual(npcAt(f, ogre), [2602, 3165, 0], "tick 11839: the ogre's");
  ticks(f, 1);
  assert.equal(ogre.getCombat().getTarget?.(), f.player, "tick 11840: the ogre comes for the player");
  const fightCast = cast(f);
  const has = (name, x, y) => fightCast.some(([id, cx, cy]) => id === npcName(name) && cx === x && cy === y);
  assert.ok(has("arena_scorpion_cutscene", 2608, 3159) && has("arena_bouncer_cutscene", 2608, 3162), "the pens still to come");
  assert.ok(!fightCast.some(([id]) => id === npcName("arena_ogre_cage")), "no caged ogre beside the loose one");
  assert.ok(has("hengrad", 2598, 3142) && has("sammy_servil_arena", 2603, 3153), "the arena's NPCs are copied in");
  escapeDoor(f);
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

  assert.ok(inFight(f, "ogre"), "the plain way into the fight opens its copy too");
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

  await clickThrough(f, () => inFight(f, "scorpion"), 200);
  assert.equal(f.player.getPacketSender().getVarbit(SCORPION_SEEN_VARBIT), 1, "tick 7686: arenaquest_scorpion_cutscene");
  assert.deepEqual(at(f), [2604, 3155, 0]);
  assert.deepEqual(npcAt(f, fightNpc(f, core.NpcIdentifiers.KHAZARD_SCORPION)), [2601, 3159, 0], "tick 11992");
  ticks(f, 3);

  kill(f, fightNpc(f, core.NpcIdentifiers.KHAZARD_SCORPION));
  assert.equal(quest().getStage(f.player), 10);
  await clickThrough(f, () => inFight(f, "bouncer"), 200);
  assert.equal(f.player.getPacketSender().getVarbit(BOUNCER_SEEN_VARBIT), 1, "tick 7740: arenaquest_bouncer_cutscene");
  assert.deepEqual(npcAt(f, fightNpc(f, core.NpcIdentifiers.BOUNCER)), [2603, 3162, 0], "tick 12037");
  ticks(f, 3);

  kill(f, fightNpc(f, core.NpcIdentifiers.BOUNCER));
  assert.equal(quest().getStage(f.player), 11);
  await clickThrough(f, () => inFight(f, "khazard"), 200);
  assert.equal(quest().getStage(f.player), 12, "tick 7937: the Servils are let go");
  assert.deepEqual(at(f), [2601, 3156, 0]);
  const khazard = fightNpc(f, core.NpcIdentifiers.GENERAL_KHAZARD);
  assert.deepEqual(npcAt(f, khazard), [2600, 3153, 0], "tick 12205");
  ticks(f, 1);
  assert.equal(khazard.getCombat().getTarget?.(), f.player, "tick 12206: Khazard hits first");
  assert.equal(cast(f).filter(([id]) => id === npcName("general_khazard_arena")).length, 0,
    "the stand's Khazard is not in his own fight (#3777: a second Khazard stood by the gates)");
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
  assert.ok(inFight(g, "scorpion"), "a seen scorpion scene goes straight to the fight");
  assert.deepEqual(at(g), [2604, 3155, 0]);
  assert.ok(fightNpc(g, core.NpcIdentifiers.KHAZARD_SCORPION));
});

test("the escape door asks first, then leaves the fight outside the arena door at the same stage", async (t) => {
  const f = actor(t, [2607, 3151, 0]);
  ticks(f, 3);
  quest().setStage(f.player, 9);
  f.player.setAttribute("fight-arena:scorpion-cutscene-seen", 1);
  PM.emitCustomEvent("npc-dialogue:action", { player: f.player, npcId: core.NpcIdentifiers.HENGRAD, stepId: "XDkdB3", handled: false });
  const area = copy(f);
  assert.ok(inFight(f, "scorpion"));
  ticks(f, 2);

  clickEscape(f);
  assert.ok(MultiChatboxPrompt.getPending(f.player) || f.player.getDialogueManager().isActive(), "tick 7948: the question");
  assert.ok(inFight(f, "scorpion"), "nothing moves before the answer");
  await clickThrough(f, () => !f.player.getDialogueManager().isActive() && !MultiChatboxPrompt.getPending(f.player), 3);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true, "tick 7949: the fade out, held");
  ticks(f, 2);
  assert.equal(area.isDestroyed(), true, "tick 7951: the copy goes");
  assert.deepEqual(xyz(f.player.getLocation()), [2607, 3151, 0], "tick 7951: outside the arena door");
  assert.equal(fightNpc(f, core.NpcIdentifiers.KHAZARD_SCORPION), undefined, "the scorpion goes with its copy");
  assert.equal(quest().getStage(f.player), 9, "the fight is still to win");
  ticks(f, 2);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false, "tick 7953: the fade in");

  // The arena door from outside: "Return to the arena?" (the Wiki's Re-entering the arena), then the same fight.
  const event = openArenaDoor(f);
  assert.equal(event.handled, true);
  assert.equal(menuTitle(f), "Return to the arena?");
  await clickThrough(f, () => !f.player.getDialogueManager().isActive(), 3);
  ticks(f, 3);
  assert.ok(inFight(f, "scorpion"), "back in the scorpion's fight");
  assert.deepEqual(npcAt(f, fightNpc(f, core.NpcIdentifiers.KHAZARD_SCORPION)), [2601, 3159, 0]);

  // Quick-escape, clicked as the client sends it: the same way out without the question.
  const door = escapeDoor(f).getLocation();
  await f.connection.dispatch([{ type: "object_option", id: ESCAPE_DOOR(), x: door.getX(), y: door.getY(), action: "Quick-escape" }]);
  ticks(f, 8);
  assert.equal(menuTitle(f) ?? null, null, "no question");
  assert.equal(copy(f), null);
  assert.deepEqual(xyz(f.player.getLocation()), [2607, 3151, 0]);
});

test("a logout in a fight comes back outside the arena door, with nothing spawned at login; after Khazard attacks there is no way back in", async (t) => {
  const f = actor(t, [2607, 3151, 0]);
  ticks(f, 3);
  quest().setStage(f.player, 10);
  f.player.setAttribute("fight-arena:bouncer-cutscene-seen", 1);
  assert.equal(openArenaDoor(f).handled, true);
  await clickThrough(f, () => !f.player.getDialogueManager().isActive(), 3);
  ticks(f, 3);
  assert.ok(inFight(f, "bouncer"), "stage 10, Bouncer's pen seen: straight to his fight");
  const area = copy(f);
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.equal(area.isDestroyed(), true);
  assert.deepEqual(xyz(f.player.getLocation()), [2607, 3151, 0], "saved at the door outside");
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
  assert.equal(fightNpc(f, core.NpcIdentifiers.BOUNCER), undefined, "no beast on the real map at login");

  quest().setStage(f.player, 12);
  const texts = [];
  const settext = f.player.getPacketSender().sendString?.bind(f.player.getPacketSender());
  if (settext) t.mock.method(f.player.getPacketSender(), "sendString", (...args) => { texts.push(String(args[0])); return settext(...args); });
  assert.equal(openArenaDoor(f).handled, true, "the door stays shut once Khazard has attacked");
  ticks(f, 1);
  assert.equal(f.player.getDialogueManager().isActive(), true, "a guard by the door speaks");
  await clickThrough(f, () => texts.some((text) => text.includes("You're the one who killed Bouncer")), 4);
  assert.equal(copy(f), null);
  PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername(), isNewAccount: false });
  assert.equal(fightNpc(f, core.NpcIdentifiers.GENERAL_KHAZARD), undefined, "Khazard is not spawned on the real map at login");
});
