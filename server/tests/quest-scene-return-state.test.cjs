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

const OP = { LOC_ADD_CHANGE: 134, LOC_DEL: 135, REBUILD_NORMAL: 141 };
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
const LEDGER_METHODS = /^(sendVarbit|sendConfig|sendVarp|sendVarc|sendClientScript|sendInterfaceScript|sendSubInterface|mountSubInterface|closeSubInterface|closeInterface|closeCurrentChatbox|sendInterfaceRemoval|sendInterface|sendChatboxInterface|sendInterfaceDisplayState|sendInterfaceHidden|sendCamera\w*|sendPlayerOption|sendInteractionMode|sendResetInteractionMode|sendMinimap\w*|sendTab\w*|sendWalkable\w*|sendFlashingTab|sendWidgetHidden|\w*Hidden|\w*Lock\w*|\w*Mode\w*)$/;

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
