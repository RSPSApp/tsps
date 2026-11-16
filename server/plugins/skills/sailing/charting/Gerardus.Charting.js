// Gerardus, master cartographer at Port Roberts (Wiki: Gerardus, Charred key; his transcript in
// npc-dialogues.json): with the captain's log, "Yes, have a look at my charts..." hands over a
// trinket for each fully charted ocean not shown to him before. Only the Unquiet Ocean's is here:
// the charred key, which opens the Charred Dungeon's Old chest (plugins/areas/CharredIsland.plugin.js).
// The other oceans' lines (a book about lighthouses, a black orb, a bedsheet) are skipped until
// their items do something.
//   No log: "You... don't appear to have any with you."; nothing new: "...you've shown me all of
//   these already."; otherwise "You show your charts to Gerardus." (the log in a box), his thanks,
//   and the key in a box, "For completely charting the Unquiet Ocean, Gerardus hands you... a
//   burned key?".
//   "Do you have any spare trinkets?" (once he has given one): a trinket the player no longer owns
//   (inventory, worn or banked) and hasn't used for paint comes back ("Of course!"); otherwise
//   "...you've gotten all the use out of anything I could give you." The transcript's hand-back
//   line is the lighthouse book's; the key's is ours.
const common = require("./Common.Charting");

const NPC_GERARDUS = "port_roberts_gerardus";
const CAPTAINS_LOGS = ["sailing_log_initial", "sailing_log"];
/** What Gerardus has handed over, by ocean name. */
const GIVEN_ATTRIBUTE = "sailing:gerardus-trinkets";
const CHEST_UNLOCKED_EVENT = "charred-island:old-chest-unlocked";

/** His transcript's ids: the condition steps, the trinket option and its message steps. */
const STEP = Object.freeze({
  NO_LOG: "9ns9ll", CHARTS: "kqTqdW", NOTHING_NEW: "HxhbKu",
  SHOW: "Y-NG_M", SPARE_OPTION: "dZUvQ_", ALL_USED: "STglNr", MISSING: "Jf8DMl", HAND_BACK: "i_1DtE",
});
/** The trinkets, by ocean: the item and its hand-over line's step. */
const TRINKETS = Object.freeze([
  { ocean: "Unquiet Ocean", item: "sailing_gerardus_unquiet_trinket", step: "Qz_mPA",
    usedEvent: CHEST_UNLOCKED_EVENT, again: "Gerardus hands you another burned key." },
]);
/** The other oceans' hand-over lines, whose trinkets aren't in yet. */
const NOT_YET = new Set(["5qaYl8", "saTpWp", "PCS897"]);

const cache = () => common.core().CacheDefinitions;
const isGerardus = (npcId) => cache().getNpcNames().get(npcId) === NPC_GERARDUS;
const itemId = (name) => cache().getObjId(name);
const given = (player) => {
  const value = player.getAttribute(GIVEN_ATTRIBUTE);
  return Array.isArray(value) ? value : [];
};
const hasLog = (player) => CAPTAINS_LOGS.some((name) => player.getInventory().contains(itemId(name)));

/** Whether the player has fully charted this ocean (by its name in the sea table). */
function oceanCharted(player, name) {
  const ocean = [...common.allSeas().values()].find((sea) => sea.type === common.SEA_TYPE.OCEAN && sea.name === name);
  if (!ocean) return false;
  common.allSpots(); // fills each sea's spots
  const charted = new Set(common.progress(player).charted);
  const spots = common.oceanSpots(ocean);
  return spots.length > 0 && spots.every((spot) => charted.has(spot.uid));
}

/** Trinkets earned and not yet handed over. */
const owed = (player) => TRINKETS.filter((trinket) => oceanCharted(player, trinket.ocean) && !given(player).includes(trinket.ocean));

/** A handed-over trinket the player no longer owns and hasn't used up. */
function missing(player) {
  return TRINKETS.filter((trinket) => {
    if (!given(player).includes(trinket.ocean)) return false;
    if (common.core().Bank.owns(player, itemId(trinket.item))) return false;
    const used = { player, unlocked: false };
    common.api().emitCustomEvent(trinket.usedEvent, used);
    return used.unlocked !== true;
  });
}

function answerCondition({ player, npcId, stepId }) {
  if (!isGerardus(npcId)) return null;
  if (stepId === STEP.NO_LOG) return !hasLog(player);
  if (stepId === STEP.CHARTS) return hasLog(player) && owed(player).length > 0;
  if (stepId === STEP.NOTHING_NEW) return hasLog(player) && owed(player).length === 0;
  if (stepId === STEP.SPARE_OPTION) return given(player).length > 0;
  if (stepId === STEP.ALL_USED) return missing(player).length === 0;
  if (stepId === STEP.MISSING) return missing(player).length > 0;
  return null;
}

function give(player, trinket) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  inventory.add(new (common.core().Item)(itemId(trinket.item), 1));
  return true;
}

/** His message steps: the log shown, each trinket handed over (or skipped), a lost one back. */
function onMessage(event) {
  const { player, stepId } = event;
  if (event.kind !== "message" || !isGerardus(event.npcId)) return;
  if (stepId === STEP.SHOW) {
    event.box = { items: [itemId(CAPTAINS_LOGS.find((name) => player.getInventory().contains(itemId(name))) ?? CAPTAINS_LOGS[1])] };
    return;
  }
  if (NOT_YET.has(stepId)) {
    event.handled = true;
    return;
  }
  if (stepId === STEP.HAND_BACK) {
    const trinket = missing(player)[0];
    if (!trinket || !give(player, trinket)) {
      event.handled = true;
      return;
    }
    event.text = trinket.again;
    event.box = { items: [itemId(trinket.item)] };
    return;
  }
  const trinket = TRINKETS.find((candidate) => candidate.step === stepId);
  if (!trinket) return;
  if (!owed(player).includes(trinket) || !give(player, trinket)) {
    event.handled = true;
    return;
  }
  player.setAttribute(GIVEN_ATTRIBUTE, [...given(player), trinket.ocean]);
  event.box = { items: [itemId(trinket.item)] };
}

function attach(api) {
  common.init(api);
  api.persistAttribute(GIVEN_ATTRIBUTE, []);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", onMessage);
}

module.exports = attach;
module.exports._test = { STEP, TRINKETS, GIVEN_ATTRIBUTE, answerCondition, onMessage, oceanCharted, missing };
