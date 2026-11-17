// Getting into and out of the Inferno.
// Rules: https://oldschool.runescape.wiki/w/The_Inferno#Getting_there
// TzHaar-Ket-Keh's talk is the wiki transcript (NpcDialogues plugin); this answers its
// conditions and carries out the fire cape hand-over.
const run = require("./Run.Inferno");

let api;
let core;

const ATTR_SACRIFICED = "inferno:cape-sacrificed";
const KET_KEH = "TzHaar-Ket-Keh";
// "You hand over your cape to TzHaar-Ket-Keh." in the standard dialogue.
const HAND_OVER_STEP = "9TOkei";
// the_inferno_multi: drawn as the open chasm once the cape is sacrificed.
const INFERNO_ENTRANCE = 30352;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const sacrificed = (player) => player.getAttribute(ATTR_SACRIFICED) === true;

function fireCape(player) {
  const { Equipment, ItemIdentifiers: Items } = core;
  if (player.getInventory().contains(Items.FIRE_CAPE)) return "inventory";
  if (player.getEquipment().get(Equipment.CAPE_SLOT)?.getId() === Items.FIRE_CAPE) return "equipped";
  return null;
}

function answerCondition({ player, definition, text }) {
  if (definition?.getName?.() !== KET_KEH) return null;
  const value = String(text).toLowerCase();
  if (value.includes("has not yet sacrificed")) return !sacrificed(player);
  if (value.includes("has sacrificed")) return sacrificed(player);
  if (value.includes("has not yet beaten the inferno")) return run.completions(player) === 0;
  if (value.includes("has beaten the inferno")) return run.completions(player) > 0;
  if (value.includes("fire cape in their inventory")) return fireCape(player) === "inventory";
  if (value.includes("fire cape equipped")) return fireCape(player) === "equipped";
  if (value.includes("does not have a fire cape")) return fireCape(player) === null;
  return null;
}

function handOverCape(event) {
  // A message step is announced twice: as an action, then as the message itself.
  if (event.kind !== "message" || event.stepId !== HAND_OVER_STEP) return;
  if (event.definition?.getName?.() !== KET_KEH) return;
  const { player } = event;
  if (!player.getInventory().contains(core.ItemIdentifiers.FIRE_CAPE)) {
    event.end = true;
    return;
  }
  player.getInventory().delete(core.ItemIdentifiers.FIRE_CAPE, 1);
  player.setAttribute(ATTR_SACRIFICED, true);
  showEntrance(player);
}

/**
 * Opens the chasm for this player. The multiloc's varbit and the stage that draws the
 * enterable chasm both come from the cache: the last stage whose loc has any options.
 */
function showEntrance(player) {
  if (!sacrificed(player)) return;
  // Preserve access for players who sacrificed their cape before the city gates were enforced.
  api.emitCustomEvent("mor-ul-rek:grant-access", { player });
  const { CacheDefinitions } = core;
  const loc = CacheDefinitions.getObject(INFERNO_ENTRANCE);
  if (!loc?.transforms || loc.transformVarbit === -1) return;
  // The last child is what a value past the list shows (30352: 30281, 30281, then 30282 with
  // "Jump-in" at 2), so it counts as a stage too.
  for (let stage = loc.transforms.length - 1; stage >= 0; stage--) {
    const child = loc.transforms[stage];
    if (child === -1 || !CacheDefinitions.getObject(child)?.actions?.some(Boolean)) continue;
    player.getPacketSender().sendVarbit(loc.transformVarbit, stage);
    return;
  }
}

function syncEntrance({ player }) {
  showEntrance(player);
}

/**
 * The chasm (6x6 from 2493,5124) lies in an enclosed pit whose edge can't be walked to. rsprox
 * 20261116T222326 (three jumps): the player walks to 2496,5115 on the walkway from TzHaar-Ket-Keh
 * and jumps the tick after arriving, whichever side they came from.
 */
const JUMP_TILE = { x: 2496, y: 5115 };

function routeToChasm(event) {
  if (event.objectId !== INFERNO_ENTRANCE) return;
  event.destination = { x: JUMP_TILE.x, y: JUMP_TILE.y, z: 0 };
}

/**
 * The jump and the fall, as recorded (rsprox 20261116T222326, three runs, the same each time), in
 * ticks from the jump: the player leaps 11 tiles north into the chasm (seq 6723, an exact move over
 * 15 client cycles), then message boxes without a continue tell the fall while the screen fades out
 * and back in around the landing. The player is held still until the last box closes.
 */
const FALL = {
  jumpAnim: 6723,
  leapTiles: 11,
  leapCycles: 15,
  boxes: [
    [5, "You jump into the fiery cauldron of the Inferno. Your heart is<br>pulsating."],
    [11, "You fall and fall and feel the temperature rising."],
    [14, "Your heart is in your throat..."],
    [16, "You hit the ground in the centre of The Inferno."],
  ],
  fadeOutTicks: 6,
  landTicks: 16,
  fadeInTicks: 17,
  // The capture never shows the overlay closed; as TzHaar-Ket-Rak's challenges, 2 ticks on.
  fadeCloseTicks: 19,
  releaseTicks: 26,
};
const ATTR_FALLING = "inferno:falling";
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

const falling = (player) => player.getAttribute(ATTR_FALLING) === true;

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }

    execute() {
      this.stop();
      action();
    }
  })());
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function jumpIn({ player }) {
  if (!sacrificed(player)) {
    player.sendMessage("You'll need to sacrifice a fire cape to TzHaar-Ket-Keh before you can enter the Inferno.");
    return true;
  }
  if (run.sessionOf(player) || falling(player)) return true;
  fall(player);
  return true;
}

function fall(player) {
  const { ForceMovement, ForceMovementTask, Location, StatementDialogue, TaskManager } = core;
  const from = player.getLocation().clone();
  player.setAttribute(ATTR_FALLING, true);
  player.getMovementQueue().setBlockMovement(true);
  player.getMovementQueue().reset();
  // North (direction 0), from where they stand into the chasm.
  TaskManager.submit(new ForceMovementTask(player, 1,
    new ForceMovement(from, new Location(0, FALL.leapTiles, 0), 0, FALL.leapCycles, 0, FALL.jumpAnim)));
  const live = () => player.isRegistered() && falling(player);
  for (const [ticks, text] of FALL.boxes) {
    later(ticks, () => live() && StatementDialogue.send(player, text, false));
  }
  later(FALL.fadeOutTicks, () => live() && fade(player, true));
  later(FALL.landTicks, () => live() && run.enter(player));
  later(FALL.fadeInTicks, () => live() && fade(player, false));
  later(FALL.fadeCloseTicks, () => live() && player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID));
  later(FALL.releaseTicks, () => {
    if (!live()) return;
    player.setAttribute(ATTR_FALLING, null);
    player.getPacketSender().sendInterfaceRemoval();
    player.getMovementQueue().setBlockMovement(false);
  });
}

/** Mid-fall nothing teleports the player out: they are in the air over the chasm. */
function noTeleportMidFall(event) {
  if (!falling(event.player)) return;
  event.allow = false;
}

/**
 * Logging out mid-fall: before the landing the jump is undone, back on the walkway, so nobody
 * logs back in standing in the chasm; after it, the run's own logout rules apply.
 */
function fallLogout({ player }) {
  if (!falling(player)) return;
  player.setAttribute(ATTR_FALLING, null);
  player.getMovementQueue().setBlockMovement(false);
  if (!run.sessionOf(player)) player.moveTo(new core.Location(JUMP_TILE.x, JUMP_TILE.y, 0));
}

function exitCave({ player }) {
  if (!run.sessionOf(player)) return false;
  api.sendMultiChatboxPrompt(player, "Really leave?",
    "Yes - really leave.", leaveNow,
    "No, I'll stay.", () => {});
  return true;
}

/** The cave exit's Quick-exit: out without being asked. */
function quickExit({ player }) {
  if (!run.sessionOf(player)) return false;
  leaveNow(player);
  return true;
}

function leaveNow(player) {
  if (run.sessionOf(player)) run.leave(player);
}

module.exports = {
  ATTR_SACRIFICED, INFERNO_ENTRANCE,
  init, answerCondition, handOverCape, syncEntrance, routeToChasm, jumpIn, exitCave, quickExit,
  noTeleportMidFall, fallLogout, FALL, JUMP_TILE,
};
