// Getting into and out of the Inferno.
// Rules: https://oldschool.runescape.wiki/w/The_Inferno#Getting_there
// TzHaar-Ket-Keh's talk is the wiki transcript (NpcDialogues plugin); this answers its
// conditions and carries out the fire cape hand-over.
const run = require("./InfernoRun");

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
 * The chasm (6x6 from 2493,5124) lies in an enclosed pit: its edge can't be walked to, and the
 * player jumps in from the tip of the walkway from TzHaar-Ket-Keh, (2496-2497, 5119). Route there
 * instead, so the jump doesn't fail its reach check.
 */
const WALKWAY_TIP = { minX: 2496, maxX: 2497, y: 5119 };

function routeToChasm(event) {
  if (event.objectId !== INFERNO_ENTRANCE) return;
  const x = Math.min(WALKWAY_TIP.maxX, Math.max(WALKWAY_TIP.minX, event.player.getLocation().getX()));
  event.destination = { x, y: WALKWAY_TIP.y, z: 0 };
}

function jumpIn({ player }) {
  if (!sacrificed(player)) {
    player.sendMessage("You'll need to sacrifice a fire cape to TzHaar-Ket-Keh before you can enter the Inferno.");
    return true;
  }
  if (run.sessionOf(player)) return true;
  player.sendMessage("You jump into the fiery cauldron of The Inferno; your heart is pulsating.");
  run.enter(player);
  return true;
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
};
