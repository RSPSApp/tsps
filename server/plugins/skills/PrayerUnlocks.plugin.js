"use strict";

/**
 * Prayers that Prayer level alone does not unlock.
 *
 * Wiki:
 *  - Chivalry: King's Ransom, the Knight Waves, 60 Prayer and 65 Defence.
 *  - Piety: King's Ransom, the Knight Waves, 70 Prayer and 70 Defence.
 *  - Rigour: read a dexterous prayer scroll (21034), 74 Prayer and 70 Defence.
 *  - Augury: read an arcane prayer scroll (21079), 77 Prayer and 70 Defence.
 *  - Preserve: read a torn prayer scroll (21047), 55 Prayer.
 *  - Deadeye / Mystic Vigour: read a Deadeye (30626) / Mystic vigour (30627) prayer scroll, 62 /
 *    63 Prayer. They don't add a prayer: they replace Eagle Eye / Mystic Might in the book, so the
 *    slot's own prayer stays usable and PrayerHandler applies the upgrade (Wiki: Deadeye, Mystic
 *    Vigour).
 *
 * The Knight Waves activity is not implemented, so completing King's Ransom stands in for
 * it; when the activity exists this should read its completion instead.
 *
 * Events:
 *  - "prayer:unlocks-bypass" { player, prayer, bypass } -> in: a mode or minigame that hands
 *    the prayers out answers with bypass = true. It never writes the earned attributes.
 *  - "prayer:unlock" { player, prayer } -> in: the admin command grants a scroll prayer.
 *  - "prayer:sync-unlocks" { player } -> in: a bypass just started or ended, so re-send the
 *    client flags for its new effective state.
 *  - "ironman:mode-changed" { player } -> in: the account type decides PvP mode's bypass (an
 *    Ironman, so every league character, gets none), so re-send the flags too.
 */

const PRESERVE_UNLOCKED_ATTRIBUTE = "prayer:preserve-unlocked";
const RIGOUR_UNLOCKED_ATTRIBUTE = "prayer:rigour-unlocked";
const AUGURY_UNLOCKED_ATTRIBUTE = "prayer:augury-unlocked";

const PRESERVE_UNLOCKED_VARBIT = 5453;
const RIGOUR_UNLOCKED_VARBIT = 5451;
const AUGURY_UNLOCKED_VARBIT = 5452;
const DEADEYE_UNLOCKED_VARBIT = 16097; // prayer_deadeye_unlocked
const MYSTIC_VIGOUR_UNLOCKED_VARBIT = 16098; // prayer_mystic_vigour_unlocked
// The client reveals Chivalry and Piety when KR_KNIGHTWAVES_STATE reaches 8.
const KNIGHT_WAVES_STATE_VARBIT = 3909;
const KNIGHT_WAVES_COMPLETE = 8;

const KINGS_RANSOM_KEY = "kings_ransom";

// OSRS Wiki transcripts: Transcript:Dexterous prayer scroll, Transcript:Arcane prayer scroll and
// Transcript:Torn prayer scroll.
const SCROLL_INTRO = "You can make out some faded words on the ancient parchment. "
  + "It appears to be an archaic invocation of the gods! Would you like to absorb its power? "
  + "This will consume the scroll.";
const ALREADY_LEARNED = "You can make out some faded words on the ancient parchment. "
  + "It appears to be an archaic invocation of the gods. However there's nothing more for you to learn.";

// No OSRS Wiki source: these two are our own wording for a locked prayer.
const PRAYER_LOCKED = "You have not unlocked that prayer.";
const KINGS_RANSOM_LOCKED = "Complete King's Ransom to unlock";

let api = null;
let core = null;

/** The scroll, prayer and state for a prayer that is learned from a scroll. */
function scrolls() {
  const { ItemIdentifiers, PrayerData } = core;
  return [
    { itemId: ItemIdentifiers.TORN_PRAYER_SCROLL, prayer: PrayerData.PRESERVE, name: "Preserve",
      attribute: PRESERVE_UNLOCKED_ATTRIBUTE, varbit: PRESERVE_UNLOCKED_VARBIT },
    { itemId: ItemIdentifiers.DEXTEROUS_PRAYER_SCROLL, prayer: PrayerData.RIGOUR, name: "Rigour",
      attribute: RIGOUR_UNLOCKED_ATTRIBUTE, varbit: RIGOUR_UNLOCKED_VARBIT },
    { itemId: ItemIdentifiers.ARCANE_PRAYER_SCROLL, prayer: PrayerData.AUGURY, name: "Augury",
      attribute: AUGURY_UNLOCKED_ATTRIBUTE, varbit: AUGURY_UNLOCKED_VARBIT },
    ...upgradeScrolls(),
  ];
}

/** Scrolls that upgrade a book slot's prayer rather than unlock one (`upgrades` is the slot's prayer id). */
function upgradeScrolls() {
  const { ItemIdentifiers, PrayerData, PrayerHandler } = core;
  return [
    { itemId: ItemIdentifiers.DEADEYE_PRAYER_SCROLL, prayer: PrayerData.EAGLE_EYE, name: "Deadeye",
      attribute: PrayerHandler.DEADEYE_UNLOCKED_ATTRIBUTE, varbit: DEADEYE_UNLOCKED_VARBIT, upgrades: PrayerHandler.EAGLE_EYE,
      readLevel: 62 },
    { itemId: ItemIdentifiers.MYSTIC_VIGOUR_PRAYER_SCROLL, prayer: PrayerData.MYSTIC_MIGHT, name: "Mystic Vigour",
      attribute: PrayerHandler.MYSTIC_VIGOUR_UNLOCKED_ATTRIBUTE, varbit: MYSTIC_VIGOUR_UNLOCKED_VARBIT,
      upgrades: PrayerHandler.MYSTIC_MIGHT, readLevel: 63 },
  ];
}

/** A scroll that locks its prayer until read (not an upgrade: Eagle Eye works without Deadeye). */
function lockingScroll(prayer) {
  return scrolls().find((candidate) => candidate.prayer === prayer && candidate.upgrades === undefined) ?? null;
}

function scrollFor(itemId) {
  return scrolls().find((scroll) => scroll.itemId === itemId) ?? null;
}

/** Disabled or unavailable quests impose no requirement, as with quest equipment. */
function kingsRansomComplete(player) {
  const request = { player, key: KINGS_RANSOM_KEY, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete !== false;
}

/**
 * Modes and minigames that hand the prayers out (PvP-mode presets, Last Man Standing) answer
 * this. The bypass is never persisted: it only changes the effective state while it applies.
 */
function unlocksBypassed(player, prayer) {
  const event = { player, prayer, bypass: false };
  api.emitCustomEvent("prayer:unlocks-bypass", event);
  return event.bypass === true;
}

/** What the server lets the player use: earned scroll or quest progress, or a live bypass. */
function scrollUnlocked(player, scroll) {
  if (player.getAttribute(scroll.attribute) === true) return true;
  // A bypass hands out locked prayers; an upgrade is only ever the scroll read (PrayerHandler
  // reads that attribute alone), so the book never shows a Deadeye the server doesn't apply.
  return scroll.upgrades === undefined && unlocksBypassed(player, scroll.prayer);
}

/** The varbit is shared by Chivalry and Piety, so a bypass on either reveals both. */
function knightWavesUnlocked(player) {
  return kingsRansomComplete(player)
    || unlocksBypassed(player, core.PrayerData.CHIVALRY)
    || unlocksBypassed(player, core.PrayerData.PIETY);
}

function sendUnlock(player, scroll) {
  player.getPacketSender().sendVarbit(scroll.varbit, scrollUnlocked(player, scroll) ? 1 : 0);
}

function sendKnightWaves(player) {
  player.getPacketSender()
    .sendVarbit(KNIGHT_WAVES_STATE_VARBIT, knightWavesUnlocked(player) ? KNIGHT_WAVES_COMPLETE : 0);
}

function syncUnlocks({ player }) {
  sendKnightWaves(player);
  for (const scroll of scrolls()) sendUnlock(player, scroll);
  deactivateLocked(player);
}

/** A prayer whose unlock just went away (a relic reset, becoming an Ironman) does not stay on. */
function deactivateLocked(player) {
  const { PrayerHandler, PrayerData } = core;
  const active = player.getPrayerActive?.();
  if (!active || !PrayerHandler) return;
  for (const name of ["CHIVALRY", "PIETY", "RIGOUR", "AUGURY", "PRESERVE"]) {
    if (active[PrayerHandler[name]] !== true) continue;
    const event = { player, prayer: PrayerData[name], disabled: null };
    prayerRequirements(event);
    if (event.disabled === true) PrayerHandler.deactivatePrayer(player, PrayerHandler[name]);
  }
}

/** King's Ransom stands in for the Knight Waves, so its stage drives the varbit. */
function kingsRansomStageChanged({ player, key }) {
  if (key !== KINGS_RANSOM_KEY) return;
  sendKnightWaves(player);
}

function prayerRequirements(event) {
  const { prayer, player } = event;
  const knightPrayer = prayer === core.PrayerData.CHIVALRY || prayer === core.PrayerData.PIETY;
  const scroll = knightPrayer ? null : lockingScroll(prayer);
  if (!knightPrayer && !scroll) return;
  // Bots have no quest or scroll progression; their loadouts already assume the unlocks.
  if (player.isPlayerBot?.() === true) return;
  // Minigames that hand everyone the prayers (Last Man Standing) and PvP mode say so here.
  if (unlocksBypassed(player, prayer)) return;
  if (knightPrayer) {
    if (kingsRansomComplete(player)) return;
    event.message = `${KINGS_RANSOM_LOCKED} ${prayer.getPrayerName()}.`;
    event.disabled = true;
    return;
  }
  if (player.getAttribute(scroll.attribute) !== true) {
    event.message = PRAYER_LOCKED;
    event.disabled = true;
  }
}

/** Admin command: grant a scroll prayer without going through the scroll. */
function unlockPrayer({ player, prayer }) {
  const scroll = lockingScroll(prayer);
  if (!scroll) return;
  player.setAttribute(scroll.attribute, true);
  sendUnlock(player, scroll);
}

/**
 * Wiki (Deadeye prayer scroll): "Reading it requires level 62 Prayer" (Mystic Vigour's 63). Read
 * below it, the slot would ask for a level the player lacks and Eagle Eye would be lost.
 */
function belowReadLevel(player, scroll) {
  return scroll.readLevel !== undefined
    && player.getSkillManager().getMaxLevel(core.Skill.PRAYER) < scroll.readLevel;
}

// Ours: the Wiki gives the requirement but not the refusal's wording.
function readLevelMessage(scroll) {
  return `You need a Prayer level of at least ${scroll.readLevel} to learn ${scroll.name}.`;
}

function learnScroll(player, scroll) {
  if (player.getAttribute(scroll.attribute) === true) return;
  if (belowReadLevel(player, scroll)) {
    player.sendMessage(readLevelMessage(scroll));
    return;
  }
  if (!player.getInventory().contains(scroll.itemId)) return;
  player.getInventory().deleteNumber(scroll.itemId, 1);
  player.setAttribute(scroll.attribute, true);
  sendUnlock(player, scroll);
  if (scroll.upgrades !== undefined) core.PrayerHandler.syncUpgrade(player, scroll.upgrades);
  player.sendMessage(`You study the scroll and learn a new prayer: ${scroll.name}`);
  // "prayer:scroll-read" { player, itemId }: a prayer scroll read, its prayer learnt.
  api.emitCustomEvent("prayer:scroll-read", { player, itemId: scroll.itemId });
}

function readScroll(event) {
  const scroll = scrollFor(event.itemId);
  if (!scroll) return false;
  if (event.player.busy()) {
    event.player.sendMessage("You cannot do that right now.");
    return true;
  }
  if (event.player.getAttribute(scroll.attribute) === true) {
    event.player.sendMessage(ALREADY_LEARNED);
    return true;
  }
  if (belowReadLevel(event.player, scroll)) {
    event.player.sendMessage(readLevelMessage(scroll));
    return true;
  }
  api.sendMultiChatboxPrompt(
    event.player,
    SCROLL_INTRO,
    `Learn ${scroll.name}`,
    () => learnScroll(event.player, scroll),
    "Cancel",
    () => {},
  );
  return true;
}

const SCROLL_ITEM_NAMES = [
  "Dexterous prayer scroll", "Arcane prayer scroll", "Torn prayer scroll",
  "Deadeye prayer scroll", "Mystic vigour prayer scroll",
];

module.exports = {
  name: "PrayerUnlocks",
  description: "Gates prayers that need more than a level: Chivalry and Piety via King's Ransom, and Rigour, Augury and Preserve via scrolls; Deadeye and Mystic Vigour scrolls upgrade Eagle Eye and Mystic Might.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.persistAttribute(PRESERVE_UNLOCKED_ATTRIBUTE, false);
    pluginApi.persistAttribute(RIGOUR_UNLOCKED_ATTRIBUTE, false);
    pluginApi.persistAttribute(AUGURY_UNLOCKED_ATTRIBUTE, false);
    pluginApi.persistAttribute(pluginApi.core.PrayerHandler.DEADEYE_UNLOCKED_ATTRIBUTE, false);
    pluginApi.persistAttribute(pluginApi.core.PrayerHandler.MYSTIC_VIGOUR_UNLOCKED_ATTRIBUTE, false);
    pluginApi.onPlayerLogin(syncUnlocks);
    pluginApi.onPrayerDisabled(prayerRequirements);
    pluginApi.onCustomEvent("prayer:unlock", unlockPrayer);
    pluginApi.onCustomEvent("prayer:sync-unlocks", syncUnlocks);
    pluginApi.onCustomEvent("ironman:mode-changed", syncUnlocks);
    pluginApi.onCustomEvent("quest:stage-changed", kingsRansomStageChanged);
    for (const name of SCROLL_ITEM_NAMES) {
      pluginApi.onItemAction(name, { Read: readScroll });
    }
  },
};

module.exports._test = {
  prayerRequirements,
  readScroll,
  learnScroll,
  syncUnlocks,
  unlockPrayer,
  kingsRansomStageChanged,
  kingsRansomComplete,
  unlocksBypassed,
  scrollUnlocked,
  knightWavesUnlocked,
  scrolls,
};
