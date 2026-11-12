// Run after `yarn build`: node --test tests/quest-scene-return-state.test.cjs
//
// What a quest scene leaves behind (#2640). Real Player, PlayerSession and ClientConnection, the real plugins, the real map and real
// packets: the scene is started with inventory_use_on (a talk click if that starts nothing) and played with dialogue_continue
// packets, the tablet is broken with inventory_action and the door opened with object_option. Each tick runs in the order of
// World.process: tasks, the player's packets, area, movement, the session's flush. No client ran.
//
// Two scenes of the same area class, Romeo and Juliet's potion scene (a copied map of Juliet's house) and Goblin Diplomacy's
// dressing room, and for each:
// - every varp, varbit, client script, interface mount, camera, hidden/display-state, player-option, mode and minimap packet the
//   scene sent has an undo (the quest's own stage and journal varbits, sent in bulk, are progress and not counted);
// - no sub-interface the player did not have before the scene is still mounted (the fade overlay, interface 174 on 161:1);
// - the map is rebuilt for the way out, a Varrock teleport tablet works and a door click sends what it sent before the scene.
// Daddy’s Home additionally checks its isolated parlour, translated demo, bystander map and exit/recovery paths.
// A fade in that closes its overlay must not close something else mounted on 161:1 in the meantime (LocTeleports, ferries,
// minecarts and many more share it): the last test mounts another interface there right after the scene's fade in.
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

const OP = { LOC_ADD_CHANGE: 134, LOC_DEL: 135, REBUILD_NORMAL: 141, REBUILD_REGION: 140 };
const OVERLAY_UID = (161 << 16) | 1;
const FADE_GROUP = 174;
const OTHER_GROUP = 9999; // nothing opens this group, so no plugin reacts to its mount
const VARROCK_SQUARE = [3213, 3424];
const SCENES = {
  juliet: { start: [3158, 3426, 1], key: "romeo_and_juliet", stage: 50, npc: "JULIET", item: "CADAVA_POTION", at: [3157, 3426, 1] },
  goblin: { start: [2957, 3512, 0], key: "goblin_diplomacy", stage: 1, npc: "GENERAL_BENTNOZE", item: "ORANGE_GOBLIN_MAIL", at: [2958, 3512, 0] },
};

let core;
let I;
let next = 1700; // the player list gives each test player its index; this only seeds the name

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const scene of Object.values(SCENES)) core.RegionManager.loadMapFiles(scene.start[0], scene.start[1]);
  core.RegionManager.loadMapFiles(3240, 3395);
  core.RegionManager.loadMapFiles(...VARROCK_SQUARE);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, scene) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player); // without it flushClient returns at once and no map or loc packet is ever sent
  player.setUsername("scene" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  assert.notEqual(player.getLongUsername(), 0n, "native fixture has a real login identity");
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...scene.start));
  player.needsPlacement = false;
  // Object spawns and removals are sent through World.forEachNetworkPlayer; the list registers the player and gives it its index.
  assert.equal(core.World.getPlayers().add(player), true, "the test player joins the world list");
  const connection = new ClientConnection(channel);
  connection.player = player;
  const f = { t, player, connection, scene, packets: [], tick: 0 };
  const send = session.sendClientPacket.bind(session);
  t.mock.method(session, "sendClientPacket", (frame) => {
    f.packets.push({ tick: f.tick, op: frame[0], frame });
    return send(frame);
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
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };
const quest = (key) => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === key);

// ---- tablet and door ------------------------------------------------------------------------------------------------

/** The Varrock teleport tablet, broken with a real inventory_action: whether the player left. */
async function breakTablet(f) {
  f.player.getInventory().add(new core.Item(I.VARROCK_TELEPORT, 1), false);
  const slot = f.player.getInventory().getSlotForItemId(I.VARROCK_TELEPORT);
  const start = f.player.getLocation().clone();
  await f.connection.dispatch([{ type: "inventory_action", slot, itemId: I.VARROCK_TELEPORT, widgetId: 3214, option: "Break" }]);
  ticks(f, 12);
  const end = f.player.getLocation();
  return Math.abs(end.getX() - start.getX()) + Math.abs(end.getY() - start.getY()) > 20;
}

/**
 * The ordinary doors (a wall loc with an Open option) of one kind, nearest first. A door stays open once clicked, so each use
 * needs its own, and a double door sends more packets than a single one, so only doors of the same id are compared.
 */
function doorsOfOneKind(around, level, radius = 20) {
  const byId = new Map();
  for (let x = around[0] - radius; x <= around[0] + radius; x++) {
    for (let y = around[1] - radius; y <= around[1] + radius; y++) {
      for (const object of core.MapObjects.getObjectsAt(new core.Location(x, y, level), null) ?? []) {
        const definition = core.ObjectDefinition.forId(object.getId());
        if (!/door|gate/i.test(definition?.getName?.() ?? "") || !(definition?.getActions?.() ?? []).includes("Open")) continue;
        const list = byId.get(object.getId()) ?? [];
        list.push({ object, x, y, level, distance: Math.abs(x - around[0]) + Math.abs(y - around[1]) });
        byId.set(object.getId(), list);
      }
    }
  }
  const kinds = [...byId.values()].filter((list) => list.length >= 2).sort((a, b) => Math.min(...a.map((d) => d.distance)) - Math.min(...b.map((d) => d.distance)));
  assert.ok(kinds.length, "two doors of one kind near " + around);
  return kinds[0].sort((a, b) => a.distance - b.distance);
}

/**
 * One door click as a real object_option, from the door's own tile and then its neighbours until one of them changes the door
 * (a wall door is used from either side; which side can reach it is not known here). What it sent: loc removals and additions.
 */
async function useDoor(f, door) {
  for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    f.player.moveTo(new core.Location(door.x + dx, door.y + dy, door.level));
    ticks(f, 3);
    const from = f.packets.length;
    await f.connection.dispatch([{ type: "object_option", id: door.object.getId(), x: door.x, y: door.y, clickType: 1 }]);
    ticks(f, 8);
    const sent = f.packets.slice(from);
    const removals = sent.filter((entry) => entry.op === OP.LOC_DEL).length;
    const additions = sent.filter((entry) => entry.op === OP.LOC_ADD_CHANGE).length;
    if (removals + additions > 0) return { removals, additions };
  }
  return { removals: 0, additions: 0 };
}

// ---- the undo ledger -------------------------------------------------------------------------------------------------
const LEDGER_METHODS = /^(sendVarbit|sendConfig|sendVarp|sendVarc|sendClientScript|sendInterfaceScript|sendSubInterface|mountSubInterface|closeSubInterface|closeInterface|closeCurrentChatbox|sendInterfaceRemoval|sendInterface|sendChatboxInterface|sendInterfaceDisplayState|sendInterfaceHidden|sendInterfacePosition|sendInterfaceAnimation|sendCamera\w*|sendPlayerOption|sendInteractionMode|sendResetInteractionMode|sendMinimap\w*|sendTab\w*|sendWalkable\w*|sendFlashingTab|sendWidgetHidden|\w*Hidden|\w*Lock\w*|\w*Mode\w*)$/;

/** Wraps the packet sender so every outer call of a state-changing method is written down with its arguments. */
function recordSender(f) {
  const sender = f.player.getPacketSender();
  f.ledger = { calls: [], before: null };
  let depth = 0;
  const proto = Object.getPrototypeOf(sender);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor" || typeof proto[name] !== "function" || !LEDGER_METHODS.test(name)) continue;
    const original = proto[name];
    sender[name] = function (...args) {
      if (depth === 0) {
        const entry = { tick: f.tick, name, args: args.map((arg) => (typeof arg === "object" && arg !== null ? "{" + Object.keys(arg).join(",") + "}" : arg)) };
        if (name === "sendVarbit") entry.was = sender.getVarbit(args[0]);
        if (name === "sendConfig" || name === "sendVarp") entry.was = sender.getVarp(args[0]);
        f.ledger.calls.push(entry);
      }
      depth++;
      try { return original.apply(this, args); } finally { depth--; }
    };
  }
  f.ledger.before = ledgerState(f);
}

function ledgerState(f) {
  const sender = f.player.getPacketSender();
  const state = { mounts: {}, chatbox: sender.getChatboxGroupId(), varbits: {}, varps: {} };
  for (const [group, mount] of sender.subInterfaceTargets) state.mounts[mount.targetUid] = group;
  for (const call of f.ledger?.calls ?? []) {
    if (call.name === "sendVarbit") state.varbits[call.args[0]] = sender.getVarbit(call.args[0]);
    if (call.name === "sendConfig" || call.name === "sendVarp") state.varps[call.args[0]] = sender.getVarp(call.args[0]);
  }
  return state;
}

/** Pairs what the scene sent with what undid it; what is left over. */
function unpaired(f) {
  const now = ledgerState(f);
  const before = f.ledger.before;
  const left = [];
  // A quest stage change re-sends a hundred varbits in one tick; they carry progress, not scene state.
  const perTick = {};
  for (const c of f.ledger.calls) if (c.was !== undefined) perTick[c.tick] = (perTick[c.tick] ?? 0) + 1;
  const bulk = new Set(Object.keys(perTick).filter((tickNumber) => perTick[tickNumber] >= 10).map(Number));
  const firstWas = {};
  for (const call of f.ledger.calls) {
    if (call.was === undefined || bulk.has(call.tick) || `${call.name}:${call.args[0]}` in firstWas) continue;
    firstWas[`${call.name}:${call.args[0]}`] = call.was;
  }
  for (const key of Object.keys(firstWas)) {
    const [name, id] = key.split(":");
    const kind = name === "sendVarbit" ? "varbits" : "varps";
    if (now[kind][id] !== firstWas[key]) left.push(`${kind.slice(0, -1)} ${id}: was ${firstWas[key]}, now ${now[kind][id]}`);
  }
  for (const uid of new Set([...Object.keys(before.mounts), ...Object.keys(now.mounts)])) {
    if (before.mounts[uid] !== now.mounts[uid]) left.push(`mount ${uid >>> 16}:${uid & 0xffff}: was group ${before.mounts[uid] ?? "none"}, now ${now.mounts[uid] ?? "none"}`);
  }
  if (before.chatbox !== now.chatbox) left.push(`chatbox group: was ${before.chatbox}, now ${now.chatbox}`);
  const camera = f.ledger.calls.filter((c) => /^sendCamera/.test(c.name));
  if (camera.length && !["sendCameraReset", "sendCameraUnlock"].includes(camera.at(-1).name)) left.push(`camera: last call is ${camera.at(-1).name}`);
  const toggles = {};
  for (const c of f.ledger.calls.filter((c) => /Hidden|DisplayState/.test(c.name))) (toggles[`${c.name}:${c.args[0]}`] ??= []).push(c.args.slice(1).join("/"));
  for (const [key, values] of Object.entries(toggles)) if (new Set(values).size === 1) left.push(`${key} only ever set to ${values[0]} (${values.length}x)`);
  return left;
}

// ---- playing a scene ---------------------------------------------------------------------------------------------------

/**
 * What a client does to keep a dialogue going: a Continue on the open chatbox, or the first option of a menu, as real
 * dialogue_continue packets; one world tick between clicks, until `done()`.
 */
async function clickThrough(f, done, limit = 600) {
  for (let i = 0; i < limit && !done(); i++) {
    const group = f.player.getPacketSender().getChatboxGroupId();
    if (MultiChatboxPrompt.getPending(f.player)) {
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 1 }]);
    } else if (f.player.getDialogueManager().isActive() && group >= 0) {
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 }]);
    }
    tick(f);
  }
}

/** Runs a scene as a player does, from the item used on the NPC to the player being out again; the area it was in. */
async function playScene(f) {
  const scene = f.scene;
  quest(scene.key).setStage(f.player, scene.stage);
  f.player.getInventory().add(new core.Item(I[scene.item], 1), false);
  const npc = core.NPC.create(core.NpcIdentifiers[scene.npc], new core.Location(...scene.at));
  core.World.getNpcs().add(npc);
  f.t.after(() => core.World.getNpcs().remove(npc));
  const slot = f.player.getInventory().getSlotForItemId(I[scene.item]);
  await f.connection.dispatch([{ type: "inventory_use_on", itemId: I[scene.item], slot, target: { kind: "npc", id: npc.getIndex() } }]);
  ticks(f, 6);
  if (!f.player.getDialogueManager().isActive() && !f.player.getArea()) {
    await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
    ticks(f, 6);
  }
  let inside = null;
  await clickThrough(f, () => {
    inside ??= f.player.getArea();
    return inside !== null && f.player.getArea() === null;
  });
  ticks(f, 8);
  return inside;
}

for (const which of Object.keys(SCENES)) {
  test(`${which}: after the scene every packet it sent is undone, nothing stays mounted, and the map, tablet and door are as before`, async (t) => {
    const scene = SCENES[which];
    const f = actor(t, scene);
    ticks(f, 3);
    const [controlDoor, door] = doorsOfOneKind(scene.start, scene.start[2]);
    const failures = [];

    // The control: the same checks on the same player before any scene.
    assert.equal(await breakTablet(f), true, "control: the tablet works before the scene");
    const baseline = await useDoor(f, controlDoor);
    assert.ok(baseline.removals >= 1 && baseline.additions >= 1, "control: a door click removes the closed door and adds the open one: " + JSON.stringify(baseline));
    f.player.moveTo(new core.Location(...scene.start));
    ticks(f, 4);
    f.packets.length = 0;
    const mountedBefore = [...f.player.getPacketSender().subInterfaceTargets.keys()];

    recordSender(f);
    const inside = await playScene(f);
    assert.ok(inside, "the player was inside the scene's area at some point");
    for (const entry of unpaired(f)) failures.push("unpaired: " + entry);
    const extra = [...f.player.getPacketSender().subInterfaceTargets.keys()].filter((group) => !mountedBefore.includes(group));
    if (extra.length) failures.push(`the scene left sub-interfaces mounted: ${JSON.stringify(extra)} (a fade overlay stays on 161:1)`);
    const now = {
      area: f.player.getArea(), privateArea: f.player.getPrivateArea(), busy: f.player.busy(), movementBlocked: f.player.getMovementQueue().isMovementBlocked(),
      teleporting: f.player.isTeleportingReturn(), untargetable: f.player.isUntargetable(), dialogueActive: f.player.getDialogueManager().isActive(),
    };
    for (const [name, value] of Object.entries({ area: null, privateArea: null, busy: false, movementBlocked: false, teleporting: false, untargetable: false, dialogueActive: false })) {
      if (now[name] !== value) failures.push(`after the scene ${name} is ${now[name]}, expected ${value}`);
    }
    if (!f.packets.some((entry) => entry.op === OP.REBUILD_NORMAL)) failures.push("no normal map rebuild reached the session when the scene ended");

    if (!(await breakTablet(f))) failures.push("the teleport tablet did not work after the scene");
    f.player.moveTo(new core.Location(...scene.start));
    ticks(f, 4);
    const opened = await useDoor(f, door);
    if (opened.removals !== baseline.removals || opened.additions !== baseline.additions) {
      failures.push(`a door click sent ${JSON.stringify(opened)} after the scene, ${JSON.stringify(baseline)} before`);
    }
    assert.deepEqual(failures, [], `${which}: ${failures.join("; ")}`);
  });
}

test("goblin: a fade in that closes its own overlay leaves another interface mounted on 161:1 inside that window alone", async (t) => {
  const f = actor(t, SCENES.goblin);
  ticks(f, 3);
  const sender = f.player.getPacketSender();
  // Right after each fade in of the scene, another plugin mounts its own interface on the same slot (a ladder or transport
  // clicked the moment controls came back). The fade's own close must not take it down.
  const mount = sender.mountSubInterface;
  let others = 0;
  sender.mountSubInterface = function (uid, group, type, options) {
    const mounted = mount.call(this, uid, group, type, options);
    const args = options?.postScripts?.[0]?.args;
    if (group === FADE_GROUP && args && args[1] === 0 && args[3] === 255) {
      core.TaskManager.submit(new core.CountdownTask(f.player, 1, () => { others++; sender.sendSubInterface(uid, OTHER_GROUP, 1); }));
    }
    return mounted;
  };
  await playScene(f);
  assert.ok(others > 0, "the scene faded in at least once");
  assert.equal(sender.subInterfaceTargets.get(OTHER_GROUP)?.targetUid, OVERLAY_UID, "the other interface is still mounted on 161:1");
  assert.equal(sender.subInterfaceTargets.has(FADE_GROUP), false, "and the fade overlay is not");
});

test("shared quest fade-in closes only its own mount after the animation", (t) => {
  const f = actor(t, SCENES.juliet);
  const sender = f.player.getPacketSender();
  const scenes = require("../plugins/quests/QuestScenes").createQuestScenes({ core });
  const mounted = () => sender.getSubInterfaceAt(OVERLAY_UID);

  scenes.fade(f.player, false);
  assert.equal(mounted()?.groupId, FADE_GROUP, "fade-in is initially mounted");
  ticks(f, 2);
  assert.equal(mounted()?.groupId, FADE_GROUP, "fade remains during the animation");
  ticks(f, 1);
  assert.equal(mounted(), undefined, "completed fade-in closes");

  scenes.fade(f.player, false);
  sender.sendSubInterface(OVERLAY_UID, OTHER_GROUP, 1);
  ticks(f, 3);
  assert.equal(mounted()?.groupId, OTHER_GROUP, "replacement interface survives");

  scenes.fade(f.player, false);
  scenes.fade(f.player, true);
  const laterFade = mounted();
  ticks(f, 3);
  assert.equal(mounted(), laterFade, "later fade-out survives the old fade-in close");

  scenes.fade(f.player, false);
  scenes.closeFade(f.player);
  sender.sendSubInterface(OVERLAY_UID, OTHER_GROUP, 1);
  ticks(f, 3);
  assert.equal(mounted()?.groupId, OTHER_GROUP, "an explicit close makes the delayed token stale");
});


// #4491: checkpoint seed is after removal; Talk-to and Listen are real packets, with real tasks/map/session.
const YARLO_SCENE = { start: [3240, 3395, 0] };
async function listenToYarlo(f) {
  const q = quest("daddys_home");
  assert.ok(q, "Daddy's Home is registered");
  q.setStage(f.player, 3);
  f.player.setAttribute("daddys-home:furniture", Array(7).fill(2));
  const npc = core.NPC.create(core.NpcIdentifiers.OLD_MAN_YARLO, new core.Location(3240, 3395, 0));
  assert.equal(core.World.getNpcs().add(npc), true);
  f.t.after(() => core.World.getNpcs().remove(npc));
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  ticks(f, 4);
  await clickThrough(f, () => f.player.getDialogueManager().getCurrent() instanceof core.OptionDialogue, 40);
  const menu = f.player.getDialogueManager().getCurrent();
  assert.ok(menu instanceof core.OptionDialogue, "ordinary Yarlo dialogue reaches the choice");
  assert.equal(menu.getOptions()[0], "Listen to Yarlo.");
  assert.equal(q.getStage(f.player), 3, "choice alone cannot advance the quest");
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: 1 }]);
  ticks(f, 4);
  return f.player.getArea();
}

test("Yarlo: current-cache parlour geometry is available for an isolated demonstration", () => {
  const { getTemplateRegion, templateChunkKey } = require("../dist/game/collision/TemplateRegionData");
  const room = require("../plugins/skills/construction/data/rooms.json").find(room => room.key === "PARLOUR");
  const region = getTemplateRegion(((room.sourceChunkX >> 3) << 8) | (room.sourceChunkY >> 3));
  assert.ok(region, "current cache contains the construction template region");
  const locs = region.chunks[templateChunkKey(0, room.sourceChunkX, room.sourceChunkY)];
  assert.ok(locs.length > 0, "candidate chunk contains real cache locs");
  assert.ok(locs.some(loc => loc.id === 4517 && loc.localX === 4 && loc.localY === 59 && loc.type === 10 && loc.face === 2),
    "current parlour has the chair hotspot used by the demonstration");
});

test("Yarlo: Listen replaces the Varrock house map with an isolated room and returns safely", async (t) => {
  const f = actor(t, YARLO_SCENE);
  ticks(f, 3);
  t.after(() => { const area = f.player.getArea(); if (area) area.leave(f.player, true); });
  const bystander = actor(t, YARLO_SCENE);
  ticks(bystander, 3);
  const realObjects = () => {
    const locs = [];
    for (let x = 3235; x <= 3247; x++) for (let y = 3390; y <= 3400; y++) {
      for (const o of core.MapObjects.getObjectsAt(new core.Location(x, y, 0), null) ?? []) locs.push(`${x},${y}:${o.getId()}:${o.getType()}:${o.getFace()}`);
    }
    return locs.sort();
  };
  const houseBefore = realObjects();
  assert.ok(houseBefore.length > 0, "bystander starts in the real house map");
  f.player.getInventory().add(new core.Item(I.PLANK, 2), false);
  const inventoryBefore = f.player.getInventory().getItems().map(i => [i.getId(), i.getAmount()]);
  const xpBefore = f.player.getSkillManager().getExperience(core.Skill.CONSTRUCTION);
  recordSender(f);
  const area = await listenToYarlo(f);
  assert.ok(area, "Listen starts the lecture's private scene");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true, "cinematic blocks movement");
  assert.equal(f.player.isUntargetable(), true, "cinematic protects its owner");
  assert.ok(area instanceof core.TemplatedInstanceArea,
    "Listen must rebuild a template map instead of drawing demonstration furniture over Yarlo's real Varrock house");
  assert.ok(f.player.getLocation().getX() >= 8192, "owner is moved to the allocated copy");
  const palette = area.buildScenePalette(f.player.getLocation().getX() >> 3, f.player.getLocation().getY() >> 3).palette.flat(2).filter(n => n !== -1);
  assert.ok(palette.length > 0, "client receives actual map chunks");
  for (const packed of palette) {
    const x = (packed >>> 14) & 1023, y = (packed >>> 3) & 2047;
    assert.ok(!(x >= 398 && x <= 410 && y >= 418 && y <= 430), "palette excludes the Varrock house and surrounding chunks");
  }
  const rebuild = f.packets.find(p => p.op === OP.REBUILD_REGION)?.frame;
  assert.ok(rebuild, "session sends an actual encoded instance rebuild");
  assert.deepEqual(decodeTemplateChunks(rebuild).sort((a, b) => a - b), palette.slice().sort((a, b) => a - b));
  assert.equal(palette.length, 4, "only the one-room chunk on each plane is copied");
  for (let z = 0; z < 4; z++) assert.deepEqual(area.getChunk(z, 0, 0), {
    sourceChunkX: 232, sourceChunkY: 887, sourcePlane: z, rotation: 0,
  });
  const template = area.getChunkObjects(0, 0, 0);
  for (const [id, x, y, type, face] of [[4517, 4, 3, 10, 2], [4521, 0, 1, 10, 0], [4523, 3, 7, 10, 1]]) {
    assert.ok(template.some(o => o.getId() === id && o.getLocation().getX() === area.getBaseX() + x &&
      o.getLocation().getY() === area.getBaseY() + y && o.getType() === type && o.getFace() === face), "cache hotspot geometry " + id);
  }
  const demo = area.getObjects();
  for (const [id, x, y, face] of [[6752, 4, 3, 2], [6768, 0, 1, 0], [6780, 3, 7, 1]]) {
    assert.ok(demo.some(o => o.getId() === id && o.getLocation().getX() === area.getBaseX() + x &&
      o.getLocation().getY() === area.getBaseY() + y && o.getType() === 10 && o.getFace() === face), "demonstration at matching hotspot " + id);
  }
  const builder = area.entities.find(n => n.isNpc?.() && n.getId() === core.NpcIdentifiers.OLD_MAN_YARLO_2);
  assert.ok(builder, "builder belongs to the private copy");
  assert.deepEqual([builder.getLocation().getX(), builder.getLocation().getY()], [area.getBaseX() + 5, area.getBaseY() + 5]);
  assert.deepEqual([builder.getPositionToFace().getX(), builder.getPositionToFace().getY()], [area.getBaseX() + 4, area.getBaseY() + 3]);
  const camera = f.ledger.calls.find(c => c.name === "sendCameraMoveTo");
  assert.deepEqual(camera?.args.slice(0, 2), [area.getBaseX() + 3, area.getBaseY() + 7], "camera follows translated room tiles");
  tick(bystander);
  assert.deepEqual(realObjects(), houseBefore, "owner's demonstration leaves the real house unchanged");
  assert.equal(bystander.player.getPrivateArea(), null);
  assert.ok(!bystander.packets.some(p => p.op === OP.REBUILD_REGION), "bystander stays on normal map");
  assert.equal(f.player.getInventory().getAmount(I.MARLOS_CRATE ?? 24940), 0, "lecture cannot award the quest reward");
  // Closing the held messagebox does not strand the cinematic; its timed completion still runs.
  f.player.getPacketSender().sendInterfaceRemoval();
  const beforeReturnFrames = f.packets.length;
  ticks(f, 160);
  await clickThrough(f, () => !f.player.getDialogueManager().isActive(), 80);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()], [3240, 3395, 0]);
  assert.equal(f.player.getArea(), null);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.isUntargetable(), false);
  assert.equal(quest("daddys_home").getStage(f.player), 5);
  assert.deepEqual(f.player.getAttribute("daddys-home:furniture"), Array(7).fill(2));
  assert.equal(f.player.getPacketSender().getVarbit(542), 0);
  assert.equal(f.player.getPacketSender().getVarbit(6719), 0);
  assert.ok(f.packets.slice(beforeReturnFrames).some(p => p.op === OP.REBUILD_NORMAL), "normal map is rebuilt on return");
  assert.equal(f.player.getAttribute("daddys-home:lecture-exit"), null);
  assert.deepEqual(f.player.getInventory().getItems().map(i => [i.getId(), i.getAmount()]), inventoryBefore, "lecture consumes no building supplies");
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.CONSTRUCTION), xpBefore, "lecture awards no building XP");
  assert.equal(area.isDestroyed(), true);
  assert.equal(f.player.getPacketSender().getSubInterfaceAt(OVERLAY_UID), undefined, "fade is closed");
});


/** Decode the client-bound REBUILD_REGION palette, independent of the area's internal chunk getters. */
function decodeTemplateChunks(frame) {
  assert.equal(frame.readUInt16BE(1), frame.length - 3);
  let bit = 80; // opcode/length + seven-byte rebuild header
  const read = count => {
    let n = 0;
    for (let i = 0; i < count; i++, bit++) { assert.ok(bit < frame.length * 8); n = n * 2 + ((frame[bit >> 3] >> (7 - (bit & 7))) & 1); }
    return n;
  };
  const chunks = [];
  for (let i = 0; i < 4 * 13 * 13; i++) if (read(1)) chunks.push(read(26));
  return chunks;
}

for (const how of ["walkout", "logout"]) {
  test(`Yarlo: ${how} destroys the copy, cancels lecture tasks and returns to a real exit`, async (t) => {
    const f = actor(t, YARLO_SCENE);
    ticks(f, 3);
    const area = await listenToYarlo(f);
    t.after(() => { if (!area.isDestroyed()) area.leave(f.player, true); });
    assert.ok(area instanceof core.TemplatedInstanceArea);
    assert.deepEqual(f.player.getAttribute("daddys-home:lecture-exit"), [3240, 3395, 0]);
    if (how === "logout") f.player.onLogout(); // actual production logout callback, with persistence disabled for fixture
    else {
      // Movement is normally blocked: forced boundary crossing exercises the area's ordinary leave caller.
      f.player.moveTo(area.tile(8, 3, 0));
      ticks(f, 2);
    }
    ticks(f, 160);
    assert.equal(area.isDestroyed(), true);
    assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()], [3240, 3395, 0]);
    assert.equal(f.player.getAttribute("daddys-home:lecture-exit"), null);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
    assert.equal(f.player.isUntargetable(), false);
    assert.equal(f.player.getPacketSender().getVarbit(542), 0);
    assert.equal(f.player.getPacketSender().getVarbit(6719), 0);
    assert.equal(f.player.getPacketSender().getSubInterfaceAt(OVERLAY_UID), undefined);
    assert.equal(quest("daddys_home").getStage(f.player), 5);
    assert.deepEqual(f.player.getAttribute("daddys-home:furniture"), Array(7).fill(2));
  });
}

test("Yarlo: a saved in-copy checkpoint recovers on login after the old scene is gone", async (t) => {
  const f = actor(t, YARLO_SCENE);
  ticks(f, 3);
  const area = await listenToYarlo(f);
  assert.ok(area instanceof core.TemplatedInstanceArea);
  const savedExit = [...f.player.getAttribute("daddys-home:lecture-exit")];
  const savedPosition = f.player.getLocation().clone();
  // Model the saved state at an abrupt stop. This is not a disk reload or a running-server restart.
  area.leave(f.player, true);
  const restored = actor(t, YARLO_SCENE);
  restored.player.setLocation(savedPosition);
  restored.player.setAttribute("daddys-home:lecture-exit", savedExit);
  restored.player.setAttribute("daddys-home:furniture", Array(7).fill(2));
  quest("daddys_home").setStage(restored.player, 3);
  PM.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername() });
  ticks(restored, 4);
  assert.deepEqual([restored.player.getLocation().getX(), restored.player.getLocation().getY(), restored.player.getLocation().getZ()], [3240, 3395, 0]);
  assert.equal(restored.player.getAttribute("daddys-home:lecture-exit"), null);
  assert.deepEqual(restored.player.getAttribute("daddys-home:furniture"), Array(7).fill(2));
  assert.equal(restored.player.getMovementQueue().isMovementBlocked(), false);
});


test("Yarlo: a forced death uses the real grave exit and cannot leave lecture tasks or an off-map player", async (t) => {
  const f = actor(t, YARLO_SCENE);
  ticks(f, 3);
  const area = await listenToYarlo(f);
  assert.ok(area instanceof core.TemplatedInstanceArea);
  t.after(() => { if (!area.isDestroyed()) area.leave(f.player, true); });
  // The cinematic is untargetable. This forces the engine's actual death task to cover recovery,
  // rather than claiming a naturally reachable combat death during the lecture.
  const request = { player: f.player, tile: { x: f.player.getLocation().getX(), y: f.player.getLocation().getY(), z: 0 } };
  PM.emitCustomEvent("gravestones:grave-location", request);
  assert.deepEqual(request.tile, { x: 3240, y: 3395, z: 0 });
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args.map(String).join(" ")));
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  core.TaskManager.submit(new PlayerDeathTask(f.player));
  ticks(f, 12);
  assert.deepEqual(errors, [], "death must not fall through its exception recovery");
  assert.equal(area.isDestroyed(), true);
  assert.ok(f.player.getLocation().getX() < 8192, "death cannot strand the player at the instance allocation");
  assert.equal(f.player.getAttribute("daddys-home:lecture-exit"), null);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.isUntargetable(), false);
  assert.equal(quest("daddys_home").getStage(f.player), 5);
  const returned = f.player.getLocation().clone();
  ticks(f, 160);
  assert.ok(f.player.getLocation().equals(returned), "cancelled lecture cannot teleport the player later");
});


// #4403: real NPC inputs for the free repeat service; checkpoint fixtures, not quest traversal.
const GIANT_DWARF_DOCKS = {
  mines: { root: 2432, transformed: 7726, npc: [2842, 10129, 0], start: [2841, 10129, 0], arrival: [2888, 10226, 0], greeting: "Want to go back to Keldagrim?" },
  city: { root: 2433, transformed: 2433, npc: [2888, 10227, 0], start: [2888, 10226, 0], arrival: [2841, 10129, 0], greeting: "Want me to take you back to the mines?" },
};
const giantDwarfPosition = f => {
  const at = f.player.getLocation();
  return [at.getX(), at.getY(), at.getZ()];
};
function giantDwarfState(f) {
  return {
    stage: quest("giant_dwarf").getStage(f.player),
    packedProgress: f.player.getPacketSender().getVarp(482),
    questPoints: f.player.getPacketSender().getVarp(QuestRuntime.QUEST_POINTS_VARP),
    savedQuestPoints: f.player.getAttribute("quest.points"),
    inventory: f.player.getInventory().getItems().map(item => [item.getId(), item.getAmount()]),
  };
}
function giantDwarfBoatman(t, dock, stage) {
  for (const at of [dock.npc, dock.start, dock.arrival]) core.RegionManager.loadMapFiles(at[0], at[1]);
  const f = actor(t, { start: dock.start });
  const q = quest("giant_dwarf");
  assert.ok(q, "The Giant Dwarf is registered before testing a journey");
  q.setStage(f.player, stage);
  f.player.getInventory().add(new core.Item(I.COINS, 123), false);
  const npc = core.NPC.create(dock.root, new core.Location(...dock.npc));
  assert.equal(core.World.getNpcs().add(npc), true);
  t.after(() => core.World.getNpcs().remove(npc));
  ticks(f, 3);
  assert.equal(core.RegionManager.blocked(new core.Location(...dock.start), null), false, "departure is legal active-cache land");
  assert.equal(core.RegionManager.blocked(new core.Location(...dock.arrival), null), false, "arrival is legal active-cache land");
  assert.equal(npc.getContentId(f.player), stage === 0 && dock.root === 2432 ? 7725 : dock.transformed, "actual root transforms for the checkpoint");
  const actions = npc.getCurrentDefinition(f.player).getActions();
  assert.equal(actions[0], "Talk-to");
  if (stage >= 5) assert.equal(actions[2], "Travel", "native option three really is Travel");
  recordSender(f);
  return { f, npc };
}
async function giantDwarfRepeatChoice(f, npc, choice) {
  const dock = GIANT_DWARF_DOCKS[npc.getId() === 2433 ? "city" : "mines"];
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 12 && !f.player.getDialogueManager().isActive(); i++) tick(f);
  const greeting = f.player.getDialogueManager().getCurrent();
  assert.ok(greeting?.getText?.().includes(dock.greeting), "actual outgoing greeting selects this dock's branch");
  await clickThrough(f, () => !!MultiChatboxPrompt.getPending(f.player), 40);
  const pending = MultiChatboxPrompt.getPending(f.player);
  assert.ok(pending, "ordinary Talk-to reaches the return menu");
  assert.equal(pending.options[0], "Yes, please take me.");
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: choice }]);
  tick(f);
}
for (const [name, dock] of Object.entries(GIANT_DWARF_DOCKS)) {
  for (const stage of [5, 50]) {
    for (const route of ["Talk-to Yes", "Travel"]) {
      test(`Giant Dwarf: ${name} ${route} at stage ${stage} makes a free repeat journey without replay`, async t => {
        const { f, npc } = giantDwarfBoatman(t, dock, stage);
        const before = giantDwarfState(f);
        if (route === "Travel") {
          await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 3 }]);
        } else {
          await giantDwarfRepeatChoice(f, npc, 1);
          assert.deepEqual(giantDwarfPosition(f), dock.start, "choosing Yes shows the player reply before departure");
          await clickThrough(f, () => giantDwarfPosition(f).join() === dock.arrival.join(), 30);
        }
        ticks(f, 8);
        assert.deepEqual(giantDwarfPosition(f), dock.arrival, "ordinary input reaches the opposite dock");
        assert.deepEqual(giantDwarfState(f), before, "free travel preserves stage, all packed quest flags and inventory");
        assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
        assert.equal(f.player.isUntargetable(), false);
        assert.ok(!f.ledger.calls.some(call => /^sendCamera/.test(call.name)), "repeat service never replays opening camera");
        const presentationGroups = new Set([151, 152, 172, 174]);
        const presentationOpens = f.ledger.calls.filter(call => {
          // recordSender records the outer call, so sendSubInterface hides its nested mount.
          if (["sendSubInterface", "mountSubInterface"].includes(call.name)) return presentationGroups.has(call.args[1]);
          if (call.name === "sendInterface") return presentationGroups.has(call.args[0]);
          return false;
        });
        assert.deepEqual(presentationOpens, [], "repeat service opens none of the story/title/crash/fade presentation groups");
      });
    }
  }
  test(`Giant Dwarf: ${name} declined return stays at its dock`, async t => {
    const { f, npc } = giantDwarfBoatman(t, dock, 5);
    const before = giantDwarfState(f);
    await giantDwarfRepeatChoice(f, npc, 2);
    await clickThrough(f, () => !f.player.getDialogueManager().isActive(), 40);
    ticks(f, 4);
    assert.deepEqual(giantDwarfPosition(f), dock.start);
    assert.deepEqual(giantDwarfState(f), before);
  });
  test(`Giant Dwarf: ${name} movement refusal cannot trigger native Travel`, async t => {
    const { f, npc } = giantDwarfBoatman(t, dock, 5);
    const before = giantDwarfState(f);
    f.player.getMovementQueue().setBlockMovement(true);
    t.after(() => f.player.getMovementQueue().setBlockMovement(false));
    await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 3 }]);
    ticks(f, 8);
    assert.deepEqual(giantDwarfPosition(f), dock.start);
    assert.deepEqual(giantDwarfState(f), before);
  });
}

for (const [name, dock] of Object.entries(GIANT_DWARF_DOCKS)) {
  test(`Giant Dwarf: ${name} modal refusal preserves the return service state`, async t => {
    const { f, npc } = giantDwarfBoatman(t, dock, 5);
    const before = giantDwarfState(f);
    f.player.getPacketSender().sendInterface(OTHER_GROUP);
    assert.equal(f.player.busy(), true, "real modal is a positive refusal precondition");
    t.after(() => f.player.getPacketSender().sendInterfaceRemoval());
    await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 3 }]);
    ticks(f, 8);
    assert.deepEqual(giantDwarfPosition(f), dock.start);
    assert.deepEqual(giantDwarfState(f), before);
    assert.equal(f.player.getInterfaceId(), OTHER_GROUP, "rejected Travel cannot remove the modal");
  });
}
test("Giant Dwarf: prequest mine transform has no native repeat Travel service", async t => {
  const dock = GIANT_DWARF_DOCKS.mines;
  const { f, npc } = giantDwarfBoatman(t, dock, 0);
  const before = giantDwarfState(f);
  assert.notEqual(npc.getCurrentDefinition(f.player).getActions()[2], "Travel");
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 3 }]);
  ticks(f, 8);
  assert.deepEqual(giantDwarfPosition(f), dock.start);
  assert.deepEqual(giantDwarfState(f), before, "invalid prequest native option cannot start or award the quest");
});


async function giantDwarfChoose(f, label) {
  await clickThrough(f, () => !!MultiChatboxPrompt.getPending(f.player), 80);
  const prompt = MultiChatboxPrompt.getPending(f.player);
  assert.ok(prompt, `ordinary dialogue reaches ${label}`);
  const index = prompt.options.indexOf(label);
  assert.ok(index >= 0, `actual current menu offers ${label}: ${prompt.options.join(" / ")}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}
async function giantDwarfInitial(t, valid = true, accept = "Yes.") {
  const { f, npc } = giantDwarfBoatman(t, GIANT_DWARF_DOCKS.mines, 0);
  if (valid) {
    for (const [skill, level] of [[core.Skill.CRAFTING, 12], [core.Skill.FIREMAKING, 16], [core.Skill.MAGIC, 33], [core.Skill.THIEVING, 14]]) {
      f.player.getSkillManager().setMaxLevels(skill, level, false);
      f.player.getSkillManager().setCurrentLevels(skill, level, false);
    }
  }
  f.player.setSpellbook(core.MagicSpellbook.NORMAL);
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  await giantDwarfChoose(f, "That's a deal!");
  await giantDwarfChoose(f, accept);
  return { f, npc };
}
test("Giant Dwarf: refused initial requirements never offer Skip or Play", async t => {
  const { f } = await giantDwarfInitial(t, false);
  ticks(f, 8);
  assert.equal(quest("giant_dwarf").getStage(f.player), 0);
  assert.ok(!MultiChatboxPrompt.getPending(f.player));
  assert.deepEqual(giantDwarfPosition(f), GIANT_DWARF_DOCKS.mines.start);
  assert.equal(f.player.getPrivateArea(), null, "refusal/decline cannot enter a private cutscene");
});
test("Giant Dwarf: optional Skip preserves initial acceptance and reaches Veldaban without the played map", async t => {
  const { f, npc } = await giantDwarfInitial(t);
  assert.equal(quest("giant_dwarf").getStage(f.player), 5, "ordinary Yes accepts before the Skip/Play choice");
  assert.equal(npc.getId(), 2432);
  assert.equal(npc.getContentId(f.player), 7726, "physical root now transforms while initial conversation retains its child context");
  await giantDwarfChoose(f, "Skip Cutscene");
  ticks(f, 4);
  assert.deepEqual(giantDwarfPosition(f), [2827, 10214, 0]);
  assert.equal(f.player.getDialogueManager().getCurrent()?.getText?.(), "Identify yourself, human!");
  assert.equal(quest("giant_dwarf").getStage(f.player), 5);
  assert.ok(!f.ledger.calls.some(call => ["sendSubInterface", "mountSubInterface"].includes(call.name) && call.args[1] === 172));
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});

test("Giant Dwarf: declining the initial departure leaves quest and dock unchanged", async t => {
  const { f } = await giantDwarfInitial(t, true, "No.");
  await clickThrough(f, () => !f.player.getDialogueManager().isActive(), 30);
  ticks(f, 4);
  assert.equal(quest("giant_dwarf").getStage(f.player), 0);
  assert.deepEqual(giantDwarfPosition(f), GIANT_DWARF_DOCKS.mines.start);
  assert.equal(f.player.getPrivateArea(), null, "refusal/decline cannot enter a private cutscene");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  const presentationGroups = new Set([151, 152, 172, 174]);
  assert.ok(!f.ledger.calls.some(call => (["sendSubInterface", "mountSubInterface"].includes(call.name) && presentationGroups.has(call.args[1]))
    || (call.name === "sendInterface" && presentationGroups.has(call.args[0]))));
});

// Opening contract: cache/native producer ordering and ordinary inputs, not a rendered movie.
test("Giant Dwarf: Play stages the opening and arrest in a private map, then restores the HQ offer", async t => {
  const { f } = await giantDwarfInitial(t);
  const q = quest("giant_dwarf");
  assert.equal(q.getStage(f.player), 5, "valid ordinary start acceptance precedes Play");
  const before = giantDwarfState(f);
  core.RegionManager.loadMapFiles(2878, 10177);
  const originalStatue = () => [0, 1, 2].map(plane => (core.MapObjects.getObjectsAt(new core.Location(2878, 10177, plane), null) ?? [])
    .map(object => [object.getId(), object.getType(), object.getFace()]));
  const realStatueBefore = originalStatue();
  assert.deepEqual(realStatueBefore.map(parts => parts.find(part => [7031, 7040, 7042].includes(part[0]))),
    [[7042, 10, 0], [7040, 10, 0], [7031, 10, 0]], "actual cache statue roots/effective planes precede the causal Play target");
  const bystander = actor(t, { start: GIANT_DWARF_DOCKS.city.start });
  ticks(bystander, 3);
  const bystanderPosition = giantDwarfPosition(bystander);
  const bystanderPacketStart = bystander.packets.length;
  t.after(() => {
    const area = f.player.getPrivateArea();
    if (area instanceof core.TemplatedInstanceArea && !area.isDestroyed()) area.leave(f.player, true);
  });
  await giantDwarfChoose(f, "Play Cutscene");
  const area = f.player.getPrivateArea();
  assert.ok(area instanceof core.TemplatedInstanceArea, "GIANT_DWARF4403_TARGET_STAGED_OPENING: accepted Play must allocate its private map");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true);
  assert.equal(f.player.isUntargetable(), true);
  assert.ok(f.player.getLocation().getX() >= 8192, "owner occupies the allocated copy");
  const rebuild = f.packets.find(packet => packet.op === OP.REBUILD_REGION)?.frame;
  assert.ok(rebuild, "real session sends an encoded template rebuild");
  const templateChunks = decodeTemplateChunks(rebuild);
  assert.ok(templateChunks.length > 0, "template rebuild has actual source chunks");
  assert.ok(templateChunks.some(packed => ((packed >>> 14) & 1023) === (2878 >> 3)
    && ((packed >>> 3) & 2047) === (10177 >> 3)), "actual rebuild includes the bound statue source chunk");
  const intact = area.getObjects().filter(object => [7032, 7041, 7043].includes(object.getId()));
  assert.deepEqual(intact.map(object => [object.getId(), object.getLocation().getX() - area.getBaseX(),
    object.getLocation().getY() - area.getBaseY(), object.getLocation().getZ(), object.getType(), object.getFace()]).sort((a, b) => a[3] - b[3]),
    [[7043, 78, 49, 0, 10, 0], [7041, 78, 49, 1, 10, 0], [7032, 78, 49, 2, 10, 0]], "only private concrete parts use the actual root placements");
  const mapLines = new Set(), dockLines = new Set(), guards = new Set();
  await clickThrough(f, () => {
    const current = f.player.getDialogueManager().getCurrent();
    const text = current?.getText?.();
    if (typeof text === "string" && f.player.getPacketSender().isSubInterfaceOpen(172)) mapLines.add(text);
    const currentGuards = area.entities.filter(npc => npc.isNpc?.() && npc.getId() === core.NpcIdentifiers.BLACK_GUARD_BERSERKER);
    for (const guard of currentGuards) guards.add(guard);
    if (typeof text === "string" && currentGuards.length === 2) {
      dockLines.add(text);
      assert.ok(!area.getObjects().some(object => [7032, 7041, 7043].includes(object.getId())), "dock phase no longer owns intact statue presentation");
    }
    // Both players share this world cycle; do not process global tasks a second time.
    bystander.tick++;
    AreaManager.process(bystander.player);
    bystander.player.getMovementQueue().process();
    bystander.player.getSession().flushClient(core.World.processCycle);
    bystander.player.resetUpdating();
    return giantDwarfPosition(f).join() === "2827,10214,0" && text === "Identify yourself, human!";
  }, 500);
  assert.deepEqual(giantDwarfPosition(f), [2827, 10214, 0], "normal end arrives at the real HQ");
  assert.equal(f.player.getDialogueManager().getCurrent()?.getText?.(), "Identify yourself, human!", "existing Veldaban offer resumes after teardown");
  assert.deepEqual(giantDwarfState(f), before, "presentation preserves accepted stage5, packed progress, inventory and QP");
  assert.ok(mapLines.has("Look, there's the statue of King Alvis, guarding the entrance to Keldagrim!"));
  assert.ok(mapLines.has("Amazing! And we're going to go straight past it?"));
  assert.ok(mapLines.has("Er, hold on! There's something wrong!"));
  assert.ok(mapLines.has("Aaargh!"), "ordinary map dialogue reaches the collision warning");
  assert.equal(guards.size, 2, "dock arrest uses two distinct private concrete guards");
  assert.ok([...guards].every(guard => guard.getOwner() === f.player && guard.isOwnerOnly()), "arrest actors belong only to the scene owner");
  assert.ok(dockLines.has("Halt! By order of the Black Guard, you are under arrest!"));
  assert.ok(dockLines.has("Come with us, human! Commander Veldaban wants a word with you!"));

  // WIDGET_OPEN_SUB is variable-short: opcode/length precede targetUID/group/type.
  const sceneOpens = f.packets.filter(packet => packet.op === 103 && packet.frame.readInt32BE(3) === ((161 << 16) | 16));
  const groups = sceneOpens.map(packet => packet.frame.readUInt16BE(7));
  const transitions = groups.filter((group, index) => index === 0 || groups[index - 1] !== group);
  assert.deepEqual(transitions, [152, 151, 152, 172], "native title, story, city/statue title and map producers occur in order");
  const visibleParents = f.ledger.calls.filter(call => call.name === "sendInterfaceDisplayState" && call.args[1] === false).map(call => call.args[0]);
  assert.deepEqual(visibleParents.filter(uid => uid >>> 16 === 151).map(uid => uid & 0xffff), [0, 1, 2, 3, 4, 5, 6, 7, 8], "all native story parent layers become visible in order");
  assert.deepEqual(visibleParents.filter(uid => uid >>> 16 === 152).map(uid => uid & 0xffff), [0, 3, 6], "only opening title parent layers are revealed");
  // WIDGET_SET_ANIMATION is fixed: opcode, UID, signed animation ID.
  const animationPackets = f.packets.filter(packet => packet.op === 114 && packet.frame.readInt32BE(1) === ((172 << 16) | 4));
  assert.deepEqual(animationPackets.map(packet => packet.frame.readInt16BE(5)), [-1, 2138], "fresh model is paused, then its native sequence released in canonical order");
  assert.ok(f.ledger.calls.filter(call => call.name === "sendCameraMoveTo").length >= 3, "palace/city/statue views are actual camera producers");
  assert.equal(f.ledger.calls.filter(call => /^sendCamera/.test(call.name)).at(-1)?.name, "sendCameraReset");
  assert.equal(area.isDestroyed(), true);
  assert.ok([...guards].every(guard => !guard.isRegistered()), "normal end removes the private arrest actors");
  assert.equal(f.player.getPrivateArea(), null);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.isUntargetable(), false);
  assert.equal(f.player.getPacketSender().getVarbit(542), 0);
  assert.equal(f.player.getPacketSender().getVarbit(6719), 0);
  for (const group of [151, 152, 172]) assert.equal(f.player.getPacketSender().isSubInterfaceOpen(group), false);
  assert.deepEqual(giantDwarfPosition(bystander), bystanderPosition);
  assert.deepEqual(originalStatue(), realStatueBefore, "private presentation never changes the real city's statue roots");
  assert.equal(bystander.player.getPrivateArea(), null);
  assert.ok(!bystander.packets.slice(bystanderPacketStart).some(packet => packet.op === OP.REBUILD_REGION), "bystander receives no private map rebuild");
  await giantDwarfChoose(f, "Yes, I will do this.");
  ticks(f, 4);
  const accepted = giantDwarfState(f);
  assert.equal(accepted.stage, 10, "ordinary Veldaban task acceptance still advances the existing stage");
  assert.deepEqual(accepted.inventory, before.inventory);
  assert.equal(accepted.questPoints, before.questPoints);
  assert.equal(accepted.savedQuestPoints, before.savedQuestPoints, "accepting the task does not award completion rewards");
});

for (const phase of ["held", "resumed"]) {
  test(`Giant Dwarf: foreign visible chatbox preserves its owner when the ${phase} scene chain is still current`, async t => {
    const { f } = await giantDwarfInitial(t);
    const before = giantDwarfState(f);
    t.after(() => {
      const area = f.player.getPrivateArea();
      if (area instanceof core.TemplatedInstanceArea && !area.isDestroyed()) area.leave(f.player, true);
    });
    await giantDwarfChoose(f, "Play Cutscene");
    const area = f.player.getPrivateArea();
    assert.ok(area instanceof core.TemplatedInstanceArea, "ordinary Play reaches a real held scene");
    const sender = f.player.getPacketSender(), manager = f.player.getDialogueManager();
    if (phase === "resumed") {
      await clickThrough(f, () => sender.isSubInterfaceOpen(172)
        && typeof manager.getCurrent()?.getText?.() === "string", 160);
      assert.equal(sender.isSubInterfaceOpen(172), true);
      assert.equal(typeof manager.getCurrent()?.getText?.(), "string", "canonical warning transcript has resumed");
    }
    const oldChainOwner = manager.getOwner(), oldEntry = manager.getCurrent();
    assert.ok(oldChainOwner, "held and resumed chains have an actual opaque owner");
    assert.equal(sender.getChatboxOwner(), oldChainOwner, "visible presentation initially belongs to the scene chain");
    const foreignOwner = Object.freeze({});
    const foreignGroup = sender.getChatboxGroupId() === 218 ? 231 : 218; // Both are native cache chatbox groups.
    sender.withChatboxOwner(foreignOwner, () => sender.sendChatboxInterface(foreignGroup));
    assert.equal(manager.getCurrent(), oldEntry, "actual sender replacement deliberately leaves the old manager entry intact");
    assert.equal(manager.getOwner(), oldChainOwner);
    assert.equal(sender.getChatboxOwner(), foreignOwner);
    ticks(f, 2); // Actual area process must detect loss of the visible presentation, not just chain identity.
    assert.equal(area.isDestroyed(), true);
    assert.equal(f.player.getPrivateArea(), null);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
    assert.equal(f.player.isUntargetable(), false);
    assert.equal(manager.isActive(), false, "retained scene chain is reset without closing foreign UI");
    assert.equal(sender.getChatboxGroupId(), foreignGroup);
    assert.equal(sender.getChatboxOwner(), foreignOwner);
    const afterCancel = f.packets.length;
    ticks(f, 200);
    assert.equal(sender.getChatboxGroupId(), foreignGroup, "delayed scene tasks cannot close the foreign presentation");
    assert.equal(sender.getChatboxOwner(), foreignOwner);
    assert.equal(manager.isActive(), false, "interruption never resumes the task offer");
    assert.deepEqual(giantDwarfState(f), before);
    assert.ok(!f.packets.slice(afterCancel).some(packet => packet.op === 103
      && packet.frame.readInt32BE(3) === ((161 << 16) | 16)
      && [151, 152, 172].includes(packet.frame.readUInt16BE(7))), "no delayed phase reopens the scene");
  });
}

async function giantDwarfOpenPhase(t, phase) {
  const { f } = await giantDwarfInitial(t);
  await giantDwarfChoose(f, "Play Cutscene");
  const area = f.player.getPrivateArea();
  assert.ok(area instanceof core.TemplatedInstanceArea, "ordinary Play establishes the private scene before interruption");
  t.after(() => { if (!area.isDestroyed()) area.leave(f.player, true); });
  if (phase === "map") {
    await clickThrough(f, () => f.player.getPacketSender().isSubInterfaceOpen(172)
      && typeof f.player.getDialogueManager().getCurrent()?.getText?.() === "string", 160);
    assert.equal(f.player.getPacketSender().isSubInterfaceOpen(172), true);
  } else if (phase === "dock") {
    await clickThrough(f, () => area.entities.filter(npc => npc.isNpc?.() && npc.getId() === core.NpcIdentifiers.BLACK_GUARD_BERSERKER).length === 2
      && typeof f.player.getDialogueManager().getCurrent()?.getText?.() === "string", 220);
    assert.equal(area.entities.filter(npc => npc.isNpc?.() && npc.getId() === core.NpcIdentifiers.BLACK_GUARD_BERSERKER).length, 2);
  }
  assert.deepEqual(f.player.getAttribute("giant-dwarf:boat-scene-exit"), [2827, 10214, 0]);
  return { f, area };
}
for (const phase of ["intro", "map", "dock"]) {
  for (const how of ["logout", "forced-exit", "Escape"]) {
    test(`Giant Dwarf: ${phase} ${how} restores controls and cancels the opening without a task offer`, async t => {
      const { f, area } = await giantDwarfOpenPhase(t, phase);
      const before = giantDwarfState(f);
      const actors = area.entities.filter(npc => npc.isNpc?.());
      if (how === "logout") f.player.onLogout();
      else if (how === "forced-exit") f.player.moveTo(area.tile(104, 98, 0)); // Outside the allocation as well as scene bounds.
      else await f.connection.dispatch([{ type: "interface_close" }]);
      ticks(f, 3);
      assert.equal(area.isDestroyed(), true);
      assert.deepEqual(giantDwarfPosition(f), [2827, 10214, 0], "safe real exit, including a forced step beyond the destroyed copy");
      assert.equal(f.player.getPrivateArea(), null);
      assert.equal(f.player.getAttribute("giant-dwarf:boat-scene-exit"), null);
      assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
      assert.equal(f.player.isUntargetable(), false);
      assert.equal(f.player.getPacketSender().getVarbit(542), 0);
      assert.equal(f.player.getPacketSender().getVarbit(6719), 0);
      assert.ok(actors.every(npc => !npc.isRegistered()));
      const afterExit = f.ledger.calls.length;
      ticks(f, 200);
      assert.deepEqual(giantDwarfPosition(f), [2827, 10214, 0]);
      assert.deepEqual(giantDwarfState(f), before);
      assert.equal(f.player.getDialogueManager().isActive(), false, "abnormal teardown never resumes Veldaban's task offer");
      assert.ok(!f.ledger.calls.slice(afterExit).some(call => ["sendSubInterface", "mountSubInterface"].includes(call.name)
        && [151, 152, 172].includes(call.args[1])), "cancelled phase tasks never reopen their presentation");
    });
  }
}
test("Giant Dwarf: a forced engine death recovers the grave and cannot resume the opening later", async t => {
  const { f, area } = await giantDwarfOpenPhase(t, "map");
  const request = { player: f.player, tile: { x: f.player.getLocation().getX(), y: f.player.getLocation().getY(), z: 0 } };
  PM.emitCustomEvent("gravestones:grave-location", request);
  assert.deepEqual(request.tile, { x: 2827, y: 10214, z: 0 });
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args.map(String).join(" ")));
  // Cinematic owners are untargetable; force the real engine death task, not an invented combat route.
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  core.TaskManager.submit(new PlayerDeathTask(f.player));
  ticks(f, 12);
  assert.deepEqual(errors, [], "forced death does not fall through exception recovery");
  assert.equal(area.isDestroyed(), true);
  assert.ok(f.player.getLocation().getX() < 8192);
  assert.equal(f.player.getAttribute("giant-dwarf:boat-scene-exit"), null);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.isUntargetable(), false);
  assert.equal(quest("giant_dwarf").getStage(f.player), 5);
  const returned = giantDwarfPosition(f);
  ticks(f, 200);
  assert.deepEqual(giantDwarfPosition(f), returned, "cancelled scene never teleports a respawned player");
});
test("Giant Dwarf: saved in-copy recovery uses the persisted real HQ exit", async t => {
  const { f, area } = await giantDwarfOpenPhase(t, "intro");
  const savedPosition = f.player.getLocation().clone(), savedExit = [...f.player.getAttribute("giant-dwarf:boat-scene-exit")];
  f.player.onLogout();
  assert.equal(area.isDestroyed(), true);
  const restored = actor(t, { start: [savedPosition.getX(), savedPosition.getY(), savedPosition.getZ()] });
  quest("giant_dwarf").setStage(restored.player, 5);
  restored.player.setAttribute("giant-dwarf:boat-scene-exit", savedExit);
  PM.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername() });
  ticks(restored, 4);
  assert.deepEqual(giantDwarfPosition(restored), [2827, 10214, 0]);
  assert.equal(restored.player.getAttribute("giant-dwarf:boat-scene-exit"), null);
  assert.equal(restored.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(quest("giant_dwarf").getStage(restored.player), 5);
});

test("Giant Dwarf: a replacement overlay lifetime survives scene cancellation", async t => {
  const { f, area } = await giantDwarfOpenPhase(t, "intro");
  const sender = f.player.getPacketSender(), target = (161 << 16) | 16;
  const replacement = sender.mountSubInterface(target, OTHER_GROUP, 1);
  ticks(f, 3);
  assert.equal(area.isDestroyed(), true);
  assert.equal(sender.getSubInterfaceAt(target), replacement, "old scene receipt cannot close the new overlay lifetime");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.isUntargetable(), false);
  assert.equal(f.player.getDialogueManager().isActive(), false);
  ticks(f, 200);
  assert.equal(sender.getSubInterfaceAt(target), replacement);
  assert.equal(quest("giant_dwarf").getStage(f.player), 5);
});

async function giantDwarfBeforeHandoff(t, handoff) {
  const { f, area } = await giantDwarfOpenPhase(t, handoff === "dock" ? "map" : "intro");
  const marker = handoff === "dock"
    ? call => call.name === "sendInterfaceAnimation" && call.args[0] === ((172 << 16) | 4) && call.args[1] === 2138
    : call => call.name === "sendInterfaceDisplayState" && call.args[0] === ((152 << 16) | 6) && call.args[1] === false;
  await clickThrough(f, () => f.ledger.calls.some(marker), 180);
  const at = f.ledger.calls.find(marker);
  assert.ok(at, "real phase producer establishes the deferred handoff boundary");
  assert.equal(f.tick, at.tick, "stop on the observed producer's own world cycle");
  ticks(f, handoff === "dock" ? 26 : 5);
  return { f, area };
}
for (const handoff of ["map", "dock"]) {
  test(`Giant Dwarf: foreign chatbox immediately before due ${handoff} callback prevents all handoff writes`, async t => {
    const { f, area } = await giantDwarfBeforeHandoff(t, handoff);
    const sender = f.player.getPacketSender(), manager = f.player.getDialogueManager();
    const previous = manager.getCurrent(), previousOwner = manager.getOwner(), foreignOwner = Object.freeze({});
    const foreignGroup = sender.getChatboxGroupId() === 218 ? 231 : 218;
    sender.withChatboxOwner(foreignOwner, () => sender.sendChatboxInterface(foreignGroup));
    assert.equal(manager.getCurrent(), previous); assert.equal(manager.getOwner(), previousOwner);
    let guardAdds = 0;
    const registry = core.World.getNpcs(), add = registry.add.bind(registry);
    t.mock.method(registry, "add", npc => {
      if (npc.getId() === core.NpcIdentifiers.BLACK_GUARD_BERSERKER && npc.getOwner() === f.player) guardAdds++;
      return add(npc); // Observe the actual producer; never substitute a registry outcome.
    });
    const beforeDue = f.ledger.calls.length;
    tick(f); // Tasks run before area process: this is precisely the due callback, not an early cancellation.
    assert.equal(area.isDestroyed(), true);
    assert.equal(guardAdds, 0, "no transient guard spawn before area cancellation");
    const dueCalls = f.ledger.calls.slice(beforeDue);
    assert.ok(!dueCalls.some(call => call.name === "sendCameraMoveTo" || call.name === "sendInterfaceAnimation"
      || ["mountSubInterface", "sendSubInterface"].includes(call.name) && [151, 152, 172].includes(call.args[1])), "lost presentation blocks phase writes before global-task execution");
    assert.equal(sender.getChatboxOwner(), foreignOwner); assert.equal(sender.getChatboxGroupId(), foreignGroup);
    assert.equal(manager.isActive(), false);
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
    ticks(f, 200);
    assert.equal(sender.getChatboxOwner(), foreignOwner); assert.equal(sender.getChatboxGroupId(), foreignGroup);
    assert.equal(manager.isActive(), false); assert.equal(quest("giant_dwarf").getStage(f.player), 5);
  });
}
test("Giant Dwarf: a new same-group story receipt immediately before reveal receives no old parent writes", async t => {
  const { f, area } = await giantDwarfOpenPhase(t, "intro");
  const sender = f.player.getPacketSender(), target = (161 << 16) | 16;
  await clickThrough(f, () => sender.isSubInterfaceOpen(151), 40);
  const mount = f.ledger.calls.find(call => call.name === "mountSubInterface" && call.args[1] === 151);
  assert.ok(mount); assert.equal(f.tick, mount.tick, "first reveal is due on the next native task cycle");
  const replacement = sender.mountSubInterface(target, 151, 1), beforeDue = f.ledger.calls.length;
  tick(f);
  assert.equal(area.isDestroyed(), true);
  assert.equal(sender.getSubInterfaceAt(target), replacement);
  assert.ok(!f.ledger.calls.slice(beforeDue).some(call => call.name === "sendInterfaceDisplayState" && call.args[0] >>> 16 === 151), "old queued reveal cannot mutate the replacement group's parent state");
  ticks(f, 200);
  assert.equal(sender.getSubInterfaceAt(target), replacement);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.getDialogueManager().isActive(), false);
});
test("Giant Dwarf: lost manager ownership at a due map handoff preserves the foreign chain", async t => {
  const { f, area } = await giantDwarfBeforeHandoff(t, "map");
  const sender = f.player.getPacketSender(), manager = f.player.getDialogueManager();
  const visibleOwner = sender.getChatboxOwner(), foreignOwner = Object.freeze({});
  const foreignEntry = new core.ActionDialogue(0, { execute() {} }, true);
  manager.startDialogues(new core.DialogueChainBuilder().add(foreignEntry), foreignOwner);
  assert.equal(sender.getChatboxOwner(), visibleOwner, "actual foreign action changes manager ownership without presenting another chatbox");
  const beforeDue = f.ledger.calls.length;
  tick(f);
  assert.equal(area.isDestroyed(), true);
  assert.equal(manager.getCurrent(), foreignEntry); assert.equal(manager.getOwner(), foreignOwner);
  assert.ok(!f.ledger.calls.slice(beforeDue).some(call => ["mountSubInterface", "sendSubInterface"].includes(call.name) && call.args[1] === 172));
  ticks(f, 200);
  assert.equal(manager.getCurrent(), foreignEntry); assert.equal(manager.getOwner(), foreignOwner);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});

for (const replacement of ["same-group", "end-scene"]) {
  test(`Giant Dwarf: synchronous story interface-open ${replacement} stops the original caller's writes`, async t => {
    const { f, area } = await giantDwarfOpenPhase(t, "intro");
    const sender = f.player.getPacketSender(), target = (161 << 16) | 16;
    let armed = true, fired = 0, foreignReceipt, beforeWrites;
    t.after(() => { armed = false; });
    PM.createApi(`GiantDwarfOpenedBoundary-${replacement}`).onCustomEvent("interface:opened", event => {
      if (!armed || event.player !== f.player || event.targetUid !== target || event.groupId !== 151) return;
      armed = false; fired++;
      if (replacement === "same-group") foreignReceipt = sender.mountSubInterface(target, 151, 1);
      else area.leave(f.player, false);
      beforeWrites = f.ledger.calls.length;
    });
    await clickThrough(f, () => fired > 0, 40);
    assert.equal(fired, 1, "actual one-shot interface:opened producer ran without recursive replacement");
    assert.equal(area.isDestroyed(), true);
    assert.ok(!f.ledger.calls.slice(beforeWrites).some(call => call.name === "sendInterfaceDisplayState" && call.args[0] >>> 16 === 151), "post-mount check precedes every original parent write");
    if (replacement === "same-group") assert.equal(sender.getSubInterfaceAt(target), foreignReceipt);
    else assert.equal(sender.getSubInterfaceAt(target), undefined, "a receipt returned after its scene ended is closed only if still current");
    assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
    assert.equal(f.player.getDialogueManager().isActive(), false);
    ticks(f, 200);
    if (replacement === "same-group") assert.equal(sender.getSubInterfaceAt(target), foreignReceipt);
    else assert.equal(sender.getSubInterfaceAt(target), undefined);
    assert.equal(quest("giant_dwarf").getStage(f.player), 5);
  });
}
