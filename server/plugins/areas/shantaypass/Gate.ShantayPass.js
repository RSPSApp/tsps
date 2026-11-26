/**
 * The Shantay Pass gates, as rsprox captures show them: the main gate (loc 4031, 4x1 at
 * 3302-3305, 3116) and the two gates of the Ruins of Unkah (loc 41326, 4x2), east at
 * 3194-3195, 2841-2844 and south at 3166-3169, 2817-2818.
 *
 * - Going into the desert (south through the main gate, east or south out of the ruins) takes
 *   a Shantay pass ("The guard takes your Shantay Pass as you go through the gate."). Without
 *   one, the gate's guard says so. The elite Desert Diary lets a player through without a pass
 *   (Wiki).
 * - Until it is turned off, the desert warning (565, cws_warning_10) opens first, a tick after
 *   arriving. Each showing counts up varbit 3860 to 6; from then on it offers "Don't ask me
 *   this again", which sets 7: no more warnings. The WarningScreens plugin shows it, and the
 *   Doomsayer turns it back on.
 * - A tick after arriving (or at once on "Proceed regardless") the player steps onto the gate,
 *   a tile a tick until they are through it, and a tick later faces the way they went. Coming
 *   back is free.
 * - The main gate guard's "Pass" does the same from wherever the player stands north of it.
 * - "Look-at" reads the gate's billboard poster.
 */
const Common = require("./Common.ShantayPass");

const PASS_TAKEN_MESSAGE = "The guard takes your Shantay Pass as you go through the gate.";

const POSTER = [
  "<col=800000>The Desert is a VERY Dangerous place. Do not enter if you are<br><col=800000>afraid of dying. Beware of high temperatures, sand storms, robbers,<br><col=800000>and slavers. No responsibility is taken by Shantay if anything bad<br><col=800000>should happen to you in any circumstances whatsoever.",
  "Despite this warning lots of people seem to pass through the gate.",
];

/** `desert` is the side the desert is on; `guard` names the NPC that turns players back. */
const MAIN_GATE = {
  minX: 3302, maxX: 3305, minY: 3116, maxY: 3116, desert: "south",
  guard: "SHANTAY_GUARD_2",
  noPassLine: "You need a Shantay pass to get through this gate. See Shantay, he will sell you one for a very reasonable price.",
  billboard: ["You look at the huge stone gate.<br>Near the gate is a large billboard poster, it reads:", ...POSTER],
};
/** The Ruins of Unkah's gates are kept by the guards there who sell passes. */
const UNKAH_GATE = {
  guard: "SHANTAY_GUARD_3",
  noPassLine: "You need a Shantay pass to get through this gate. I'll sell you one for a very reasonable price.",
  billboard: ["You look at the huge dilapidated gate.<br>Near the gate is a large billboard poster, it reads:", ...POSTER],
};
const GATES = [
  MAIN_GATE,
  { ...UNKAH_GATE, minX: 3194, maxX: 3195, minY: 2841, maxY: 2844, desert: "east" },
  { ...UNKAH_GATE, minX: 3166, maxX: 3169, minY: 2817, maxY: 2818, desert: "south" },
];

/** cws_warning_10: the desert warning (565). */
const DESERT_WARNING = 10;

const DESERT_ROBES_TASK = "enter-the-desert-with-a-set-of-desert-robes-equi";

/** The tiles from `from` (not included) straight across to `to`. */
function line([fromX, fromY], [toX, toY]) {
  const dx = Math.sign(toX - fromX);
  const dy = Math.sign(toY - fromY);
  const path = [];
  for (let x = fromX, y = fromY; x !== toX || y !== toY;) {
    x += dx;
    y += dy;
    path.push([x, y]);
  }
  return path;
}

/** The crossing through `gate` from the tile `x, y` beside it, or null when not beside it. */
function crossingThrough(gate, x, y) {
  const across = (desert, to) => ({ gate, desert, path: line([x, y], to) });
  if (gate.desert === "south") {
    if (x < gate.minX || x > gate.maxX) return null;
    if (y === gate.maxY + 1) return across(true, [x, gate.minY - 1]);
    if (y === gate.minY - 1) return across(false, [x, gate.maxY + 1]);
    return null;
  }
  if (y < gate.minY || y > gate.maxY) return null;
  if (x === gate.minX - 1) return across(true, [gate.maxX + 1, y]);
  if (x === gate.maxX + 1) return across(false, [gate.minX - 1, y]);
  return null;
}

/**
 * The steps through a gate from `source`, the tile beside it the player stands on: `desert`
 * when they head into the desert.
 */
function crossingFor(source) {
  if (!source || !Number.isInteger(source.x) || !Number.isInteger(source.y) || source.z !== 0) return null;
  for (const gate of GATES) {
    const crossing = crossingThrough(gate, source.x, source.y);
    if (crossing) return crossing;
  }
  return null;
}

function sourceOf(player) {
  const at = player.getLocation();
  return { x: at.getX(), y: at.getY(), z: at.getZ() };
}

function mayEnterDesert(player) {
  const core = Common.getCore();
  return Common.diaryComplete(player, "elite")
    || player.getInventory().getAmount(core.ItemIdentifiers.SHANTAY_PASS) > 0;
}

function wearsDesertRobes(player) {
  const { Equipment, ItemIdentifiers } = Common.getCore();
  const equipment = player.getEquipment();
  const worn = (slot) => equipment.get(slot)?.getId?.();
  return worn(Equipment.BODY_SLOT) === ItemIdentifiers.DESERT_SHIRT
    && worn(Equipment.LEG_SLOT) === ItemIdentifiers.DESERT_ROBE
    && worn(Equipment.FEET_SLOT) === ItemIdentifiers.DESERT_BOOTS;
}

/** The steps, a tick apart, then facing on; the pass goes as the first step is taken. */
function walkThrough(player, crossing) {
  const core = Common.getCore();
  const queue = player.getMovementQueue();
  queue.reset();
  queue.setBlockMovement(true);
  if (crossing.desert && !Common.diaryComplete(player, "elite")) {
    player.getInventory().deleteNumber(core.ItemIdentifiers.SHANTAY_PASS, 1);
    player.getInventory().refreshItems();
    player.sendMessage(PASS_TAKEN_MESSAGE);
  }
  stepThrough(player, crossing, 0);
}

/** Step `index` of the crossing; after the last, the desert robes task and the facing. */
function stepThrough(player, crossing, index) {
  Common.step(player, crossing.path[index]);
  if (index < crossing.path.length - 1) {
    Common.later(player, 1, () => stepThrough(player, crossing, index + 1));
    return;
  }
  if (crossing.desert && wearsDesertRobes(player)) {
    Common.getApi().emitCustomEvent("diary:task", { player, diary: "desert", task: DESERT_ROBES_TASK });
  }
  Common.later(player, 1, () => faceOn(player, crossing));
}

/** Facing on the way the player went, and free to move again. */
function faceOn(player, crossing) {
  player.getMovementQueue().setBlockMovement(false);
  const { path } = crossing;
  const [lastX, lastY] = path[path.length - 1];
  const [beforeX, beforeY] = path[path.length - 2];
  const at = player.getLocation();
  player.setPositionToFace(Common.tile(at.getX() + lastX - beforeX, at.getY() + lastY - beforeY, at.getZ()));
}

/** Into the desert once the warning has been answered, if the player is still at the gate. */
function enterDesert(player, crossing) {
  const now = crossingFor(sourceOf(player));
  if (!now || now.gate !== crossing.gate || !now.desert || !mayEnterDesert(player)) return;
  walkThrough(player, now);
}

/** A tick after arriving: the guard, the warning or straight through. */
function cross(player, crossing) {
  if (crossing.desert && !mayEnterDesert(player)) {
    Common.npcLine(player, Common.getCore().NpcIdentifiers[crossing.gate.guard], crossing.gate.noPassLine);
    return;
  }
  if (!crossing.desert) {
    walkThrough(player, crossing);
    return;
  }
  const warning = { player, warning: DESERT_WARNING, proceed: () => enterDesert(player, crossing) };
  Common.getApi().emitCustomEvent("warning-screen:show", warning);
  if (!warning.handled) walkThrough(player, crossing);
}

function goThrough(event) {
  const { player } = event;
  const crossing = crossingFor(sourceOf(player));
  if (!crossing) return false;
  player.getMovementQueue().reset();
  Common.later(player, 1, () => cross(player, crossing));
  return true;
}

/** The main gate guard's "Pass": through the gate from where the player stands north of it. */
function passGuard(event) {
  const { player } = event;
  const at = player.getLocation();
  if (at.getZ() !== 0 || at.getY() <= MAIN_GATE.maxY) return false;
  const x = Math.min(MAIN_GATE.maxX, Math.max(MAIN_GATE.minX, at.getX()));
  const approach = [x, MAIN_GATE.maxY + 1];
  player.getMovementQueue().reset();
  walkThen(player, approach, () => cross(player, crossingFor({ x, y: approach[1], z: 0 })));
  return true;
}

/** A step a tick towards `target`, then `action` a tick after arriving. */
function walkThen(player, target, action) {
  Common.later(player, 1, () => {
    const at = player.getLocation();
    if (at.getX() === target[0] && at.getY() === target[1]) {
      action();
      return;
    }
    Common.step(player, target);
    walkThen(player, target, action);
  });
}

/** The gate whose footprint holds `location` (the clicked loc's corner). */
function gateAt(location) {
  return GATES.find((gate) => location
    && location.x >= gate.minX && location.x <= gate.maxX
    && location.y >= gate.minY && location.y <= gate.maxY) ?? MAIN_GATE;
}

function lookAt({ player, location }) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = Common.getCore();
  const { billboard } = gateAt(location);
  const chain = new DialogueChainBuilder();
  billboard.forEach((text, index) => chain.add(new StatementDialogue(index, text)));
  chain.add(new EndDialogue(billboard.length));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

function attach(api) {
  api.onObjectInteraction("Shantay pass", { "Go-through": goThrough, "Look-at": lookAt });
  api.onNpcInteraction("Shantay Guard", { Pass: passGuard });
}

module.exports = attach;
module.exports.crossingFor = crossingFor;
