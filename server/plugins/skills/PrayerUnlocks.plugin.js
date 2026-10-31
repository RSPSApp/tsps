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
 *
 * The Knight Waves activity is not implemented, so completing King's Ransom stands in for
 * it; when the activity exists this should read its completion instead.
 */

const PRESERVE_UNLOCKED_ATTRIBUTE = "prayer:preserve-unlocked";
const RIGOUR_UNLOCKED_ATTRIBUTE = "prayer:rigour-unlocked";
const AUGURY_UNLOCKED_ATTRIBUTE = "prayer:augury-unlocked";

const PRESERVE_UNLOCKED_VARBIT = 5453;
const RIGOUR_UNLOCKED_VARBIT = 5451;
const AUGURY_UNLOCKED_VARBIT = 5452;

const KINGS_RANSOM_STAGE_ATTRIBUTE = "quest.kings_ransom.stage";
const KINGS_RANSOM_COMPLETE_STAGE = 85;

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
  ];
}

function scrollFor(itemId) {
  return scrolls().find((scroll) => scroll.itemId === itemId) ?? null;
}

function kingsRansomComplete(player) {
  return (Number(player.getAttribute(KINGS_RANSOM_STAGE_ATTRIBUTE)) || 0) >= KINGS_RANSOM_COMPLETE_STAGE;
}

function sendUnlock(player, scroll) {
  player.getPacketSender().sendVarbit(scroll.varbit, player.getAttribute(scroll.attribute) === true ? 1 : 0);
}

function syncUnlocks({ player }) {
  for (const scroll of scrolls()) sendUnlock(player, scroll);
}

function prayerRequirements(event) {
  const { prayer, player } = event;
  const knightPrayer = prayer === core.PrayerData.CHIVALRY || prayer === core.PrayerData.PIETY;
  const scroll = knightPrayer ? null : scrolls().find((candidate) => candidate.prayer === prayer);
  if (!knightPrayer && !scroll) return;
  // Bots have no quest or scroll progression; their loadouts already assume the unlocks.
  if (player.isPlayerBot?.() === true) return;
  // Minigames that hand everyone the prayers (Last Man Standing) say so here.
  const bypass = { player, prayer, bypass: false };
  api.emitCustomEvent("prayer:unlocks-bypass", bypass);
  if (bypass.bypass === true) return;
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
  const scroll = scrolls().find((candidate) => candidate.prayer === prayer);
  if (!scroll) return;
  player.setAttribute(scroll.attribute, true);
  sendUnlock(player, scroll);
}

function learnScroll(player, scroll) {
  if (player.getAttribute(scroll.attribute) === true) return;
  if (!player.getInventory().contains(scroll.itemId)) return;
  player.getInventory().deleteNumber(scroll.itemId, 1);
  player.setAttribute(scroll.attribute, true);
  sendUnlock(player, scroll);
  player.sendMessage(`You study the scroll and learn a new prayer: ${scroll.name}`);
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

const SCROLL_ITEM_NAMES = ["Dexterous prayer scroll", "Arcane prayer scroll", "Torn prayer scroll"];

module.exports = {
  name: "PrayerUnlocks",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.persistAttribute(PRESERVE_UNLOCKED_ATTRIBUTE, false);
    pluginApi.persistAttribute(RIGOUR_UNLOCKED_ATTRIBUTE, false);
    pluginApi.persistAttribute(AUGURY_UNLOCKED_ATTRIBUTE, false);
    pluginApi.onPlayerLogin(syncUnlocks);
    pluginApi.onPrayerDisabled(prayerRequirements);
    pluginApi.onCustomEvent("prayer:unlock", unlockPrayer);
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
  kingsRansomComplete,
  scrolls,
};
