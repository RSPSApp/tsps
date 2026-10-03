"use strict";

/**
 * Al Kharid toll gate (between Lumbridge and Al Kharid).
 *
 * The gate is two cache locs (44598/44599) whose client-side appearance is a
 * multi-loc resolved from Prince Ali Rescue's varp 273: 44052/44053 with the
 * Pay-toll(10gp) option before the quest, 44050/44051 (free passage) after it.
 *
 * Opening the gate starts the Border Guard dialogue. The transcript's "Yes, ok."
 * branch resolves its prose conditions through onNpcDialogueCondition and its
 * pay-and-cross action (hyXjU_) through npc-dialogue:action: the toll leaves the
 * player's backpack, both leaves swing open (visually only; the clipping stays),
 * the player is force-walked through and the gate shuts behind them. Pay-toll
 * pays directly.
 *
 * Cache ids: 44598/44599 raw leaves (3268,3227)/(3268,3228); 1571/1572 open
 * leaves (METALGATEOPENL/R); 44052/44053/44050/44051 resolved closed variants.
 */
const { startTranscript } = require("../quests/QuestRuntime");
const ObstacleRunner = require("../skills/agility/ObstacleRunner");

const GATE_LEAF_IDS = new Set([44598, 44599]);
const OPEN_LEFT_ID = 1571;
const OPEN_RIGHT_ID = 1572;
const BORDER_GUARD_IDS = new Set([4287, 4288]);
const TOLL = 10;
// The gate stays open this long after the last player through it arrives.
const GATE_CLOSE_DELAY_TICKS = 2;

// Prince Ali Rescue stage (plugins/quests/quests/PrinceAliRescue.Quest.js).
const QUEST_STAGE_ATTRIBUTE = "quest.prince_ali_rescue.stage";
const QUEST_COMPLETE_STAGE = 110;
const VARIANT_BEFORE_QUEST = "before-completing-prince-ali-rescue-quest";
const VARIANT_AFTER_QUEST = "after-completing-prince-ali-rescue-quest";

// Transcript step ids: pay + cross, and the free cross after the quest.
const PAY_AND_CROSS_STEP = "hyXjU_";
const FREE_CROSS_STEP = "jt5lUt";

const GATE_ATTRIBUTE = "alkharid-gate:leaf";

let api;
let core;
let TaskManager;

// Crossings in progress per gate; it shuts once the last one is through.
const openCrossings = new Map();

function questStage(player) {
  const stage = Number(player.getAttribute(QUEST_STAGE_ATTRIBUTE));
  return Number.isFinite(stage) ? stage : 0;
}

function hasToll(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS) >= TOLL;
}

function rememberGate(player, object) {
  const location = object.getLocation();
  player.setAttribute(GATE_ATTRIBUTE, `${location.getX()},${location.getY()},${location.getZ()}`);
}

function rememberedGate(player) {
  const value = player.getAttribute(GATE_ATTRIBUTE);
  if (!value) return null;
  const [x, y, z] = String(value).split(",").map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { x, y, z: Number.isInteger(z) ? z : 0 };
}

function startGuardDialogue(player, object) {
  rememberGate(player, object);
  const variant = questStage(player) >= QUEST_COMPLETE_STAGE ? VARIANT_AFTER_QUEST : VARIANT_BEFORE_QUEST;
  const guardId = player.getLocation().getX() < object.getLocation().getX()
    ? core.NpcIdentifiers.BORDER_GUARD
    : core.NpcIdentifiers.BORDER_GUARD_2;
  startTranscript(api, player, guardId, "Border Guard", variant);
}

/**
 * `door:toggle` is emitted by Doors.plugin.js before it swings a gate. The toll
 * gate is never swung by the generic handler; it opens per player after paying.
 */
function interceptGate(event) {
  if (event.handled || !GATE_LEAF_IDS.has(event.objectId)) return;
  event.handled = true;
  startGuardDialogue(event.player, event.object);
}

function answerCondition({ player, npcId, text }) {
  if (!BORDER_GUARD_IDS.has(npcId)) return null;
  const value = String(text).toLowerCase();
  if (value.includes("does not have 10gp")) return !hasToll(player);
  if (value.includes("has 10gp")) return hasToll(player);
  return null;
}

function tryPay(player) {
  if (!hasToll(player)) return false;
  player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, TOLL);
  return true;
}

function payToll({ player, object }) {
  if (ObstacleRunner.isBusy(player)) return;
  const location = object.getLocation();
  const gate = { x: location.getX(), y: location.getY(), z: location.getZ() };
  if (!tryPay(player)) {
    player.sendMessage("You don't have enough coins.");
    return;
  }
  player.sendMessage("You pay the guard.");
  crossGate(player, gate);
}

function handleDialogueAction(event) {
  if (!BORDER_GUARD_IDS.has(event.npcId)) return;
  if (event.stepId === PAY_AND_CROSS_STEP) {
    const gate = rememberedGate(event.player);
    if (!gate || !atGate(event.player.getLocation(), gate)) return;
    if (!tryPay(event.player)) return;
    event.player.setAttribute(GATE_ATTRIBUTE, null);
    event.handled = true;
    event.end = false;
    crossGate(event.player, gate);
    return;
  }
  if (event.stepId === FREE_CROSS_STEP) {
    const gate = rememberedGate(event.player);
    if (!gate || !atGate(event.player.getLocation(), gate)) return;
    event.player.setAttribute(GATE_ATTRIBUTE, null);
    event.handled = true;
    event.end = false;
    crossGate(event.player, gate);
  }
}

/** The two closed leaves around the clicked tile, resolved from the map, low y first. */
function gateLeaves(gate) {
  const leaves = [];
  for (const id of GATE_LEAF_IDS) {
    for (const dy of [0, 1, -1]) {
      const object = core.MapObjects.get(id, new core.Location(gate.x, gate.y + dy, gate.z), null);
      if (object) leaves.push(object);
    }
  }
  return leaves.sort((a, b) => a.getLocation().getY() - b.getLocation().getY());
}

/**
 * Open leaves swing west of the closed line, per the Doors special double-door
 * transform for this gate family (face 0 -> left face 3, right face 1).
 */
function gateObjects(gate) {
  const leaves = gateLeaves(gate);
  if (leaves.length !== 2) return null;
  return {
    closed: leaves.map((leaf) => new core.GameObject(
      leaf.getId(), leaf.getLocation().clone(), leaf.getType(), leaf.getFace(), null)),
    open: leaves.map((leaf, index) => new core.GameObject(
      index === 0 ? OPEN_LEFT_ID : OPEN_RIGHT_ID,
      new core.Location(gate.x - 1, leaf.getLocation().getY(), gate.z),
      leaf.getType(),
      index === 0 ? 3 : 1,
      null)),
  };
}

/**
 * Swings the leaves for everyone with the gate in view. Only the client sees it
 * open: the server keeps the closed leaves' clipping, so nobody else can follow
 * a paying player through.
 */
function swingGate(gate, opening) {
  const objects = gateObjects(gate);
  if (!objects) return;
  const from = opening ? objects.closed : objects.open;
  const to = opening ? objects.open : objects.closed;
  core.World.forEachNetworkPlayer((viewer) => {
    const area = viewer.getPrivateArea?.();
    if (area && !area.countsAsMainWorld?.()) return;
    if (!viewer.getSession().isTileInScene(gate.x, gate.y, gate.z)) return;
    const sender = viewer.getPacketSender();
    for (const object of from) sender.sendObjectRemoval(object);
    for (const object of to) sender.sendObject(object);
  });
}

const gateKey = (gate) => `${gate.x},${gate.z}`;

function openGate(gate) {
  const count = openCrossings.get(gateKey(gate)) ?? 0;
  openCrossings.set(gateKey(gate), count + 1);
  if (count === 0) swingGate(gate, true);
}

function closeGateLater(gate) {
  const task = new core.Task(GATE_CLOSE_DELAY_TICKS, false);
  task.execute = () => {
    task.stop();
    const count = (openCrossings.get(gateKey(gate)) ?? 1) - 1;
    if (count > 0) {
      openCrossings.set(gateKey(gate), count);
      return;
    }
    openCrossings.delete(gateKey(gate));
    swingGate(gate, false);
  };
  TaskManager.submit(task);
}

/**
 * Either side of the closed gate line, or on the gate tile itself: the wall only
 * blocks the west edge, so from the east the reach code can park the player on
 * the leaf tile.
 */
function atGate(location, gate) {
  return location.getZ() === gate.z
    && Math.abs(location.getX() - gate.x) <= 1
    && Math.abs(location.getY() - gate.y) <= 1;
}

/**
 * Opens the gate and force-walks the player one tile past the gate line. The walk is the
 * agility runner's: one tile per tick through the closed leaves' clipping, which
 * the client animates as a normal walk with the player's own weapon walk anim.
 * The runner blocks teleports and finishes the walk on logout.
 */
function crossGate(player, gate) {
  if (!gate || ObstacleRunner.isBusy(player)) return;
  const from = player.getLocation();
  if (!atGate(from, gate) || gateLeaves(gate).length !== 2) return;
  // The gate line is the leaf tile's west edge: one tile past it is the leaf
  // tile going east, the tile west of it going west. Keep the player's row.
  const destinationX = from.getX() < gate.x ? gate.x : gate.x - 1;
  openGate(gate);
  // The leading wait keeps it to one tile per tick: a crossing started from a
  // dialogue packet would otherwise step once on submit and again on the next
  // task tick, which the client shows as a two-tile jump.
  ObstacleRunner.run({ player }, [{ wait: 1 }, { walk: [[destinationX, from.getY()]] }], {
    onFinish: () => closeGateLater(gate),
  });
}

module.exports = {
  name: "AlKharidGate",
  // Exported for tests/wooden-gate.test.cjs; nothing else reads them.
  interceptGate,
  answerCondition,
  handleDialogueAction,
  register(registry) {
    api = registry;
    core = registry.core;
    TaskManager = registry.getTaskManager();
    ObstacleRunner.init(registry);
    registry.onCustomEvent("door:toggle", interceptGate);
    registry.onObjectInteraction("Gate", { "Pay-toll(10gp)": payToll });
    registry.onNpcDialogueCondition(answerCondition);
    registry.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  },
};
