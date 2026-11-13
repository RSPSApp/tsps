/**
 * A boat's keg (OSRS Wiki: Keg (facility)). Built in the shipyard like any facility; at sea:
 * - Using 25 of an ale on the empty keg, noted or not (not a mixture), pours them all in: "You
 *   carefully pour all of the alcohol into the keg. ..." in a box showing the ale, human_pickuptable,
 *   synth 2401, the hotspot's extra data set to the ale and the keg's loc changed to the filled one.
 * - Check: the empty keg's "Unfortunately this keg is empty..." with a beer glass, or the filled
 *   keg's "This keg is filled with <ale>. A keg of <ale> <effect>" with the ale.
 * - A beer glass on a filled keg: "You fill a glass from the keg.", poh_barrel_use1, synth 2609 and
 *   the glass becomes the ale in its own slot. The keg never runs out.
 * - Empty: "Are you sure you wish to empty the keg?<br>All of its contents will be lost.", and on
 *   "Yes, empty the keg." the keg is empty again; nothing is returned.
 * While its owner is aboard, a filled keg's effect applies: horizon's lure +2.5% Sailing XP,
 * whirlpool surprise a crew minimum of 2 Deckhandiness and 2 Helmsmanship (and the sidepanel's
 * sailing_sidepanel_whirlpool_surprise_active), perildance bitter +1 cannon max hit.
 * Ours: the Check text of the kraken ink stout, perildance bitter and trawler's trust kegs (live's
 * wording for the other two, with Charles's effect lines); the lines for too few ales, for Fill
 * without them and for emptying (none recorded). Kraken ink stout shortens the ocean encounter
 * timer (ClueTurtle.Sailing.js); trawler's trust's extra fish do nothing: there is no deep sea
 * trawling yet.
 */
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { ItemStatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ItemStatementDialogue");
const facilities = require("./BoatFacilities.Sailing");
const { hotspotDataVarbit } = require("./BoatVarbits.Sailing");
const { playSound } = require("./SailingContent.Sailing");

/**
 * The ales a keg takes, by the hotspot extra data that holds them (the filled keg's loc is the
 * empty keg's plus this): each one's glass, its noted form and what Check says it does.
 */
const ALES = Object.freeze([
  { data: 3, key: "whirlpool_surprise", name: "whirlpool surprise", glass: 31811, noted: 31812,
    effect: "gives your crew a minimum of 2 Deckhandiness and 2 Helmsmanship." },
  { data: 4, key: "kraken_ink_stout", name: "kraken ink stout", glass: 31814, noted: 31815,
    effect: "improves the chance of random encounters spawning at sea by 4%." },
  { data: 5, key: "perildance_bitter", name: "perildance bitter", glass: 31817, noted: 31818,
    effect: "increases the max hit of your cannons by one." },
  { data: 6, key: "trawlers_trust", name: "trawler's trust", glass: 31820, noted: 31821,
    effect: "gives a 5% chance to catch an extra fish whilst deep sea trawling." },
  { data: 7, key: "horizons_lure", name: "horizon's lure", glass: 31823, noted: 31824,
    effect: "gives a 2.5% boost to all Sailing experience gained." },
]);
const KEG_SIZE = 25;
const BEER_GLASS = 1919;
const SEQ_POUR = 832; // human_pickuptable
const SEQ_FILL_GLASS = 3660; // poh_barrel_use1
const SEQ_FILL_GLASS_DELAY = 11;
const SOUND_POUR = 2401;
const SOUND_POUR_DELAY = 5;
const SOUND_FILL_GLASS = 2609;
const VARBIT_WHIRLPOOL_ACTIVE = 19180;
const HORIZONS_LURE_XP = 1.025;
const WHIRLPOOL_MINIMUM = 2;
const PERILDANCE_MAX_HIT = 1;
/** Crew stats whirlpool surprise raises (crew/Common.Crew.js STAT: Helmsmanship, Deckhandiness). */
const WHIRLPOOL_STATS = Object.freeze([1, 3]);

const POURED = "You carefully pour all of the alcohol into the keg. Once done, you do a double take as somehow there appears to be far more inside the keg than you actually put in.";
const EMPTY_KEG = "Unfortunately this keg is empty... On the bright side, it is now ready to be filled with some nice cold drinks.";
const FILLED_GLASS = "You fill a glass from the keg.";
const CONFIRM_EMPTY = "Are you sure you wish to empty the keg?<br>All of its contents will be lost.";
const TOO_FEW = `You need ${KEG_SIZE} of an ale, all noted or all unnoted, to fill the keg.`;

let pluginApi;

function aleByData(data) {
  return ALES.find((ale) => ale.data === data);
}

function aleByItem(itemId) {
  return ALES.find((ale) => ale.glass === itemId || ale.noted === itemId);
}

function isKegLoc(id) {
  return id === facilities.KEG_EMPTY || ALES.some((ale) => ale.data + facilities.KEG_EMPTY === id);
}

/** The ale in a boat's keg on a hotspot, or undefined when it's empty. */
function aleAt(owned, hotspot) {
  return aleByData(owned?.hotspotData?.[hotspot] ?? 0);
}

/** Whether a boat has a keg of an ale (by key) on any hotspot. */
function hasKeg(owned, key) {
  return (owned?.hotspotData ?? []).some((data) => aleByData(data)?.key === key);
}

/** The player's own boat while they're aboard it, with its saved record. */
function ownBoat(player) {
  const boat = Sailing.instanceAboard(player);
  const owned = boat && Sailing.activeBoat(player);
  return boat && owned ? { boat, owned } : undefined;
}

/** Whether the player is aboard their own boat with a keg of this ale on it. */
function aboardWithKeg(player, key) {
  return hasKeg(ownBoat(player)?.owned, key);
}

/** The keg the player clicked on their boat: its hotspot and deck loc. */
function clickedKeg(player, location) {
  const aboard = ownBoat(player);
  if (!aboard || !location) return undefined;
  const x = location.x - aboard.boat.deckBaseX;
  const y = location.y - aboard.boat.deckBaseY;
  const loc = (BoatManager.getSpec(aboard.boat)?.locs ?? []).find((candidate) =>
    candidate.hotspot !== undefined && candidate.x === x && candidate.y === y && isKegLoc(candidate.id));
  return loc ? { ...aboard, hotspot: loc.hotspot, loc } : undefined;
}

function itemBox(player, item, text) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, item, text)));
}

/** Sends the whirlpool surprise's sidepanel flag for the boat the player is aboard (0 ashore). */
function sendWhirlpool(player, owned) {
  player.getPacketSender().sendVarbit(VARBIT_WHIRLPOOL_ACTIVE, hasKeg(owned, "whirlpool_surprise") ? 1 : 0);
}

/** Puts an ale (or nothing) in the keg: the saved data, its varbit, the deck loc and the sidepanel. */
function setContents(player, keg, ale) {
  const { owned, boat, hotspot, loc } = keg;
  const data = owned.hotspotData ?? [];
  data[hotspot] = ale?.data ?? 0;
  for (let i = 0; i < data.length; i++) data[i] = data[i] ?? 0;
  owned.hotspotData = data;
  player.getPacketSender().sendVarbit(hotspotDataVarbit(owned.slot, hotspot), data[hotspot]);
  BoatManager.setDeckLoc(boat, { ...loc, id: facilities.KEG_EMPTY + data[hotspot] });
  sendWhirlpool(player, owned);
}

/** The 25 ales to pour, as the stack used (noted or not) if it has enough, else the other form. */
function pourable(player, ale, usedId) {
  const inventory = player.getInventory();
  const forms = usedId === ale.noted ? [ale.noted, ale.glass] : [ale.glass, ale.noted];
  return forms.find((form) => inventory.getAmount(form) >= KEG_SIZE);
}

function fill(player, keg, ale, usedId) {
  const form = pourable(player, ale, usedId);
  if (form === undefined) {
    player.sendMessage(TOO_FEW);
    return;
  }
  player.getInventory().delete(form, KEG_SIZE);
  setContents(player, keg, ale);
  player.performAnimation(new Animation(SEQ_POUR));
  playSound(player, SOUND_POUR, SOUND_POUR_DELAY);
  itemBox(player, ale.glass, POURED);
}

/** The beer glass becomes the ale in its own slot. */
function fillGlass(player, ale, slot) {
  const inventory = player.getInventory();
  const held = inventory.getItems?.()[slot];
  if (held?.getId?.() === BEER_GLASS && held.getAmount() === 1) {
    inventory.setItem(slot, new Item(ale.glass, 1));
    inventory.refreshItems();
  } else {
    inventory.delete(BEER_GLASS, 1);
    inventory.add(new Item(ale.glass, 1));
  }
  player.sendMessage(FILLED_GLASS);
  player.performAnimation(new Animation(SEQ_FILL_GLASS, SEQ_FILL_GLASS_DELAY));
  playSound(player, SOUND_FILL_GLASS);
}

/** An ale or a beer glass used on a keg. */
function useOnKeg(event) {
  if (!isKegLoc(event.objectId)) return false;
  const keg = clickedKeg(event.player, event.location);
  if (!keg) return false;
  const inKeg = aleAt(keg.owned, keg.hotspot);
  if (!inKeg) {
    const ale = aleByItem(event.itemId);
    if (!ale) return false;
    event.handled = true;
    fill(event.player, keg, ale, event.itemId);
    return true;
  }
  if (event.itemId !== BEER_GLASS) return false;
  event.handled = true;
  fillGlass(event.player, inKeg, event.itemSlot);
  return true;
}

function check(player, keg) {
  const ale = aleAt(keg.owned, keg.hotspot);
  if (!ale) itemBox(player, BEER_GLASS, EMPTY_KEG);
  else itemBox(player, ale.glass, `This keg is filled with ${ale.name}. A keg of ${ale.name} ${ale.effect}`);
}

/** The empty keg's Fill: pours the first ale the player has enough of. */
function fillFromInventory(player, keg) {
  const ale = ALES.find((candidate) => pourable(player, candidate, candidate.glass) !== undefined);
  if (!ale) {
    player.sendMessage(TOO_FEW);
    return;
  }
  fill(player, keg, ale, ale.glass);
}

function confirmEmpty(player, keg) {
  pluginApi.sendMultiChatboxPrompt(player, CONFIRM_EMPTY,
    "Yes, empty the keg.", () => {
      if (ownBoat(player)?.boat !== keg.boat || !aleAt(keg.owned, keg.hotspot)) return;
      setContents(player, keg, undefined);
    },
    "No, do not empty the keg.", () => {});
}

/** Check (op1) on any keg; Fill (op2) on the empty one and Empty (op2) on a filled one. */
function onKeg(event) {
  if (!isKegLoc(event.objectId) || (event.clickType !== 1 && event.clickType !== 2)) return;
  const keg = clickedKeg(event.player, event.location);
  if (!keg) return;
  event.handled = true;
  if (event.clickType === 1) check(event.player, keg);
  else if (aleAt(keg.owned, keg.hotspot)) confirmEmpty(event.player, keg);
  else fillFromInventory(event.player, keg);
}

/** Horizon's lure: +2.5% Sailing XP while aboard. */
function horizonsLure(event) {
  if (event.skill !== Skill.SAILING || !aboardWithKeg(event.player, "horizons_lure")) return;
  event.multiplier = (Number.isFinite(event.multiplier) ? event.multiplier : 1) * HORIZONS_LURE_XP;
}

/** A crewmate's stat on a boat: whirlpool surprise raises Helmsmanship and Deckhandiness to 2. */
function crewStat(owned, base, stat) {
  const value = Number(base) || 0;
  return WHIRLPOOL_STATS.includes(Number(stat)) && hasKeg(owned, "whirlpool_surprise")
    ? Math.max(value, WHIRLPOOL_MINIMUM)
    : value;
}

/** What a keg adds to cannon max hits on the player's boat: perildance bitter's 1. */
function cannonMaxHitBonus(player) {
  return aboardWithKeg(player, "perildance_bitter") ? PERILDANCE_MAX_HIT : 0;
}

function onBoarded({ player, owned }) {
  if (owned && Sailing.activeBoat(player) === owned) sendWhirlpool(player, owned);
}

function onLeft({ player, reason }) {
  if (reason !== "logout") sendWhirlpool(player, undefined);
}

module.exports = {
  ALES,
  KEG_SIZE,
  aleAt,
  hasKeg,
  crewStat,
  cannonMaxHitBonus,
  register(api) {
    pluginApi = api;
    api.onObjectInteraction(onKeg);
    api.onItemOnObject(useOnKeg);
    api.onCanGainExperience(horizonsLure);
    api.onCustomEvent("sailing:boarded", onBoarded);
    api.onCustomEvent("sailing:left", onLeft);
  },
};
