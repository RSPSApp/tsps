/**
 * The ghost disciples hand over the ecto-tokens worship earns and, after the hard Morytania diary,
 * the bonecrusher. Their Wiki transcript (npc-dialogues.json) holds the words; this picks the
 * variant and answers its conditions. A ghostspeak amulet or Morytania legs 2 or better are needed
 * to understand them (Wiki).
 *
 * As captured (rsprox recordings 376, 377, 703, 1857): with tokens waiting, Talk-to opens on "Can I
 * have the tokens I have earned?"; without the amulet the disciple only says "Woooo wooo wooooo
 * woooo"; the bonecrusher is in the inventory as "Compliments of Morytania for your efforts
 * throughout the tasks set." shows.
 */
const Common = require("./Common.Ectofuntus");

const GHOST_DISCIPLE = "Ghost disciple";
const NO_GHOSTSPEAK_VARIANT = "without-a-ghostspeak-amulet";
const CLAIM_VARIANT = "claiming-tokens";
const BONECRUSHER_VARIANT = "after-completing-the-hard-morytania-diary";
const FULL_INVENTORY = "If the player has a full inventory";
const ROOM_IN_INVENTORY = "If the player has room in their inventory";
const NO_BONECRUSHER = "If the player does not have a bonecrusher:";
const HAS_BONECRUSHER = "If the player already has a bonecrusher:";
const CLAIM_LINE = "Certainly, mortal. Here's [number] ectotokens.";
const NO_ROOM_LINE = "I have [number] ectotokens waiting for you mortal, but you do not have room in your inventory for them.";
const BONECRUSHER_LINE = "Compliments of Morytania for your efforts throughout the tasks set.";

const isDisciple = (definition) => definition?.getName?.() === GHOST_DISCIPLE;

function understands(player) {
  const { Equipment, ItemIdentifiers } = Common.core;
  const equipment = player.getEquipment();
  const amulet = equipment.get(Equipment.AMULET_SLOT)?.getId?.();
  const legs = equipment.get(Equipment.LEG_SLOT)?.getId?.();
  return [ItemIdentifiers.GHOSTSPEAK_AMULET, ItemIdentifiers.GHOSTSPEAK_AMULET_2].includes(amulet) ||
    [ItemIdentifiers.MORYTANIA_LEGS_2, ItemIdentifiers.MORYTANIA_LEGS_3, ItemIdentifiers.MORYTANIA_LEGS_4].includes(legs);
}

function hardDiaryDone(player) {
  const request = { player, diary: "morytania", tier: "hard", complete: false };
  Common.api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function ownsBonecrusher(player) {
  const id = Common.core.ItemIdentifiers.BONECRUSHER;
  return player.getInventory().contains(id) ||
    player.getBanks?.()?.some((bank) => bank && bank.getAmount(id) > 0) === true;
}

function hasRoomForTokens(player) {
  const inventory = player.getInventory();
  const count = Common.tokens(player);
  if (count <= 0) return false;
  // add() can clamp an existing token stack even when the inventory has a free slot.
  return inventory.getAddableAmount(new Common.core.Item(Common.core.ItemIdentifiers.ECTO_TOKEN, count)) === count;
}

function dialogueVariant({ player, definition }) {
  if (!isDisciple(definition)) return null;
  if (!understands(player)) return NO_GHOSTSPEAK_VARIANT;
  if (Common.tokens(player) > 0) return CLAIM_VARIANT;
  return hardDiaryDone(player) ? BONECRUSHER_VARIANT : null;
}

function dialogueCondition({ player, definition, text }) {
  if (!isDisciple(definition)) return null;
  switch (String(text).trim()) {
    case FULL_INVENTORY: return !hasRoomForTokens(player);
    case ROOM_IN_INVENTORY: return hasRoomForTokens(player);
    case NO_BONECRUSHER: return !ownsBonecrusher(player);
    case HAS_BONECRUSHER: return ownsBonecrusher(player);
    default: return null;
  }
}

function claimTokens(player) {
  const count = Common.tokens(player);
  if (count <= 0 || !hasRoomForTokens(player)) return;
  player.getInventory().adds(Common.core.ItemIdentifiers.ECTO_TOKEN, count);
  Common.setTokens(player, 0);
}

function giveBonecrusher(player) {
  if (ownsBonecrusher(player)) return;
  player.getInventory().adds(Common.core.ItemIdentifiers.BONECRUSHER, 1);
}

function dialogueLine(request) {
  if (!isDisciple(request?.definition)) return;
  const { player, text } = request;
  if (text === CLAIM_LINE || text === NO_ROOM_LINE) {
    request.text = text.replace("[number]", Common.tokens(player).toLocaleString("en-GB"));
    if (text === CLAIM_LINE) request.before = () => claimTokens(player);
  } else if (text === BONECRUSHER_LINE) {
    request.before = () => giveBonecrusher(player);
  }
}

module.exports = function attachDisciples(api) {
  api.onNpcDialogueVariant(dialogueVariant);
  api.onNpcDialogueCondition(dialogueCondition);
  api.onCustomEvent("npc-dialogue:line", dialogueLine);
};
