/**
 * Kylie Minnow's fishing platform at the Fishing Guild (OSRS Wiki: Fishing Guild, Kylie Minnow and
 * her transcript). She lets a player onto it for good once they talk to her with 82 Fishing (not
 * boostable), Fishing Contest complete and the full angler's outfit worn. The row boat on the
 * guild's north dock then takes them out; the boat on the platform brings them back.
 *
 * Access is varbit 5669, which Kylie's spawn (7735) transforms on: 0-1 show her as 7727
 * (Talk-to), 2 as 7728 (Talk-to, Trade). 1 marks that the player has heard her introduction.
 */
const QuestRuntime = require("../../quests/QuestRuntime");
const AnglerOutfit = require("./AnglerOutfit.Fishing");

const ACCESS_VARBIT = 5669;
const SPOKEN = 1;
const ACCESS = 2;
const ACCESS_ATTRIBUTE = "fishing:minnow-platform";
const PLATFORM_LEVEL = 82;
const PAGE = "Kylie Minnow";
const FIRST_TALK = "standard-dialogue-first-time-talking-to-kylie-minnow-without-the-requirements";
const ASK_AGAIN = "So, how about letting me out onto your fishing platform?";
const AFTER_ACCESS = "after-gaining-access-talking-to-kylie";
const BOAT_WITHOUT_LEVEL = "standard-dialogue-attempting-to-board-the-boat-without-82-fishing";
const BOAT_WITHOUT_ACCESS = "standard-dialogue-attempting-to-board-the-boat-before-speaking-to-kylie";
const MINNOWS_PER_SHARK = 40;

// The guild boat (30376) is the 3x3 at 2599,3426 with the dock below it; the platform boat (30377)
// is the 3x3 at 2613,3437 with the platform above it. Both landing tiles are walkable in the cache.
const PLATFORM_LANDING = Object.freeze([2614, 3440, 0]);
const DOCK_LANDING = Object.freeze([2600, 3425, 0]);

// --- Minnow fishing (OSRS Wiki: Minnow, Fishing spot (minnow)) ---

// Spots move one tile clockwise every 25 ticks. The cache map has two 4x2 ponds on the platform
// with two spots each, at opposite corners of the pond's 8-tile loop, so each spot circles its pond.
const ROTATION_TICKS = 25;
const PONDS = Object.freeze([{ x: 2609, y: 3443 }, { x: 2617, y: 3443 }]);

// ponytail: the Wiki gives no catch chart for minnows. These are fitted to its catches per hour
// (minnows/h over minnows per catch: 1,500 at 82, 1,545 at 85, 1,625 at 90, 1,692 at 95) with an
// attempt every 2 ticks; "at most 10 XP drops per spot position" (25 ticks) rules out 5-tick
// attempts. Replace both with the real values when a source turns up.
const ATTEMPT_INTERVAL_TICKS = 2;
const CATCH_CHART = Object.freeze([24, 148]);

// Wiki table: 10 at 82, 11 at 85, 12 at 90, 13 at 95; "10-14" puts 14 at 99.
const MINNOWS_BY_LEVEL = Object.freeze([[99, 14], [95, 13], [90, 12], [85, 11], [0, 10]]);

// After a spot moves, the first click on it has a 1/10 chance of a flying fish, which eats 16-26
// minnows from the player each catch until the spot moves again.
const FLYING_FISH_CHANCE = 10;
const FLYING_FISH_EATS = Object.freeze([16, 26]);

let api = null;
let core = null;
let kylieIds = new Set();
let spotIds = new Set();
/** npc index -> true/false once the spot's flying fish roll has happened since it last moved. */
const flyingFish = new Map();

function pondLoop({ x, y }) {
  return [[x, y + 1], [x + 1, y + 1], [x + 2, y + 1], [x + 3, y + 1], [x + 3, y], [x + 2, y], [x + 1, y], [x, y]];
}

/** The next tile clockwise around whichever pond holds (x, y), or null off the ponds. */
function nextSpotTile(x, y) {
  for (const pond of PONDS) {
    const loop = pondLoop(pond);
    const index = loop.findIndex(([tileX, tileY]) => tileX === x && tileY === y);
    if (index >= 0) return loop[(index + 1) % loop.length];
  }
  return null;
}

function rotateSpots() {
  for (const npc of api.getWorld().getNpcs()) {
    if (!npc || !spotIds.has(npc.getId())) continue;
    const location = npc.getLocation();
    const next = nextSpotTile(location.getX(), location.getY());
    if (!next) continue;
    npc.moveTo(new core.Location(next[0], next[1], location.getZ()));
    flyingFish.delete(npc.getIndex());
  }
}

function minnowsPerCatch(player) {
  const level = player.getSkillManager().getMaxLevel(core.Skill.FISHING);
  return MINNOWS_BY_LEVEL.find(([from]) => level >= from)[1];
}

/** Fishing.plugin calls this when a player starts on a minnow spot. */
function onStart(_player, npc, random = Math.random) {
  if (!flyingFish.has(npc.getIndex())) {
    flyingFish.set(npc.getIndex(), Math.floor(random() * FLYING_FISH_CHANCE) === 0);
  }
}

/** Fishing.plugin calls this on each catch; true when a flying fish took it instead. */
function takesCatch(player, npc, random = Math.random) {
  if (!flyingFish.get(npc.getIndex())) return false;
  const [least, most] = FLYING_FISH_EATS;
  const held = player.getInventory().getAmount(core.ItemIdentifiers.MINNOW);
  const eaten = Math.min(held, least + Math.floor(random() * (most - least + 1)));
  if (eaten > 0) {
    player.getInventory().deleteNumber(core.ItemIdentifiers.MINNOW, eaten);
  }
  player.sendMessage("A flying fish jumps up and eats some of your minnows!");
  return true;
}

function accessState(player) {
  return Number(player.getAttribute(ACCESS_ATTRIBUTE)) || 0;
}

function setAccessState(player, value) {
  player.setAttribute(ACCESS_ATTRIBUTE, value);
  player.getPacketSender().sendVarbit(ACCESS_VARBIT, value);
}

function hasAccess(player) {
  return accessState(player) >= ACCESS;
}

function hasPlatformLevel(player) {
  return player.getSkillManager().getMaxLevel(core.Skill.FISHING) >= PLATFORM_LEVEL;
}

function completedFishingContest(player) {
  const quest = QuestRuntime.getRegisteredQuests().find((registered) => registered.name === "Fishing Contest");
  return !quest || quest.isComplete(player);
}

function meetsRequirements(player) {
  return hasPlatformLevel(player) && completedFishingContest(player) && AnglerOutfit.wearsFullOutfit(player);
}

/** Plays Kylie's lines from her transcript page (data/definitions/npc-dialogues.json). */
function sayAsKylie(player, npcId, steps) {
  const record = QuestRuntime.loadTranscripts(api)?.[PAGE];
  if (!Array.isArray(steps) || !record) return false;
  const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");
  const definition = core.NpcDefinition.forId(npcId);
  const context = { player, npc: null, npcId, definition, pages: [{ page: PAGE, variants: [] }] };
  startDialogue(api, { player, npcId, npc: null, definition }, steps, record.branches, context);
  return true;
}

function variant(name) {
  return QuestRuntime.loadTranscripts(api)?.[PAGE]?.variants?.[name];
}

function talkToKylie({ player }) {
  const { NpcIdentifiers: N } = core;
  if (hasAccess(player)) {
    return sayAsKylie(player, N.KYLIE_MINNOW_2, variant(AFTER_ACCESS));
  }
  const intro = variant(FIRST_TALK);
  if (accessState(player) < SPOKEN) {
    setAccessState(player, SPOKEN);
    return sayAsKylie(player, N.KYLIE_MINNOW, intro);
  }
  // The transcript's "talking again" variant is the same ask, pointing back at the first talk.
  const ask = intro?.findIndex((step) => step.player === ASK_AGAIN) ?? -1;
  return sayAsKylie(player, N.KYLIE_MINNOW, ask >= 0 ? intro.slice(ask) : intro);
}

function minnows(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.MINNOW);
}

/** Answers the prose conditions in Kylie's transcript; meeting them is what grants access. */
function kylieCondition({ player, npcId, text }) {
  if (!kylieIds.has(npcId)) return null;
  switch (text) {
    case "If the player meets all the requirements:":
      if (!meetsRequirements(player)) return false;
      setAccessState(player, ACCESS);
      return true;
    case "If the player doesn't have 82 Fishing:":
      return !hasPlatformLevel(player);
    case "If the player hasn't completed the Fishing Contest:":
      return !completedFishingContest(player);
    case "If the player isn't wearing the Angler's outfit:":
      return !AnglerOutfit.wearsFullOutfit(player);
    case "With open inventory space and at least 40 minnows:":
      return player.getInventory().getFreeSlots() > 0 && minnows(player) >= MINNOWS_PER_SHARK;
    case "Without at least 40 minnows:":
      return minnows(player) < MINNOWS_PER_SHARK;
    case "Without free inventory space:":
      return player.getInventory().getFreeSlots() === 0;
    default:
      return null;
  }
}

function travelToPlatform({ player }) {
  const { NpcIdentifiers: N } = core;
  if (!hasPlatformLevel(player)) {
    return sayAsKylie(player, N.KYLIE_MINNOW, variant(BOAT_WITHOUT_LEVEL));
  }
  if (!hasAccess(player)) {
    return sayAsKylie(player, N.KYLIE_MINNOW, variant(BOAT_WITHOUT_ACCESS));
  }
  player.moveTo(new core.Location(...PLATFORM_LANDING));
  return true;
}

function leavePlatform({ player }) {
  player.moveTo(new core.Location(...DOCK_LANDING));
  return true;
}

// --- Kylie's minnow exchange: 40 minnows for one noted raw shark (Wiki: Kylie Minnow) ---

function exchangeMinnows(player) {
  const { ItemIdentifiers: I, NpcIdentifiers: N, ItemDefinition, Item } = core;
  const affordable = Math.floor(minnows(player) / MINNOWS_PER_SHARK);
  if (affordable < 1) {
    return sayAsKylie(player, N.KYLIE_MINNOW_2, variant("after-gaining-access-trade-option-without-at-least-40-minnows"));
  }
  const notedShark = ItemDefinition.forId(I.RAW_SHARK).getNoteId();
  if (player.getInventory().getFreeSlots() === 0 && !player.getInventory().contains(notedShark)) {
    return sayAsKylie(player, N.KYLIE_MINNOW_2, [{ npc: "I can't trade you any sharks while you don't have any space for them!" }]);
  }
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredAmountAction({
    execute: (amount) => {
      const sharks = Math.min(Math.floor(Number(amount)), Math.floor(minnows(player) / MINNOWS_PER_SHARK));
      if (!(sharks > 0)) return;
      player.getInventory().deleteNumber(I.MINNOW, sharks * MINNOWS_PER_SHARK);
      player.getInventory().addItem(new Item(notedShark, sharks));
    },
  });
  player.getPacketSender().sendEnterAmountPrompt("How many sharks would you like?");
  return true;
}

function tradeWithKylie({ player }) {
  return exchangeMinnows(player);
}

/** Her dialogue's "opens Minnow exchange" step. */
function openExchange(request) {
  if (!kylieIds.has(request.npcId) || request.action !== "open_interface" || request.target !== "Minnow exchange") return;
  request.handled = true;
  exchangeMinnows(request.player);
}

function restoreAccess({ player }) {
  const state = accessState(player);
  if (state > 0) {
    player.getPacketSender().sendVarbit(ACCESS_VARBIT, state);
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  const { NpcIdentifiers: N } = core;
  kylieIds = new Set([N.KYLIE_MINNOW, N.KYLIE_MINNOW_2]);
  spotIds = new Set([N.FISHING_SPOT_87, N.FISHING_SPOT_88, N.FISHING_SPOT_89, N.FISHING_SPOT_90]);

  api.persistAttribute(ACCESS_ATTRIBUTE);
  api.onPlayerLogin(restoreAccess);
  api.onNpcInteraction("Kylie Minnow", { "Talk-to": talkToKylie, Trade: tradeWithKylie });
  api.onNpcDialogueCondition(kylieCondition);
  api.onCustomEvent("npc-dialogue:action", openExchange);
  api.onObjectInteraction("Row boat", { "Travel to platform": travelToPlatform, "Leave platform": leavePlatform });
  api.getTaskManager().submit(new (class extends core.Task {
    constructor() { super(ROTATION_TICKS); }
    execute() { rotateSpots(); }
  })());
}

module.exports = {
  attach, hasAccess, talkToKylie, kylieCondition, travelToPlatform, leavePlatform,
  onStart, takesCatch, minnowsPerCatch, nextSpotTile, rotateSpots, exchangeMinnows,
  ACCESS_VARBIT, ACCESS_ATTRIBUTE, PLATFORM_LANDING, DOCK_LANDING, ATTEMPT_INTERVAL_TICKS, CATCH_CHART,
};
