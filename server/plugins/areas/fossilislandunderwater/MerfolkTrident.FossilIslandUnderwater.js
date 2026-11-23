/**
 * Merfolk trident (https://oldschool.runescape.wiki/w/Merfolk_trident): pufferfish used on it
 * store up to 10 charges, and Channel spends one underwater for a pufferfish's puff. Wielding it
 * underwater warns first and asks. Facts: docs/fossil-island-underwater.md, "Merfolk trident".
 *
 * rsprox 231/00715: Pufferfish on the trident takes as many as fit, with no message (t4879 0->1,
 * t5010 1->3, t5207 3->10 from 7 fish), and a full one says so in a messagebox (t5213). Check is
 * "Your trident has: N charges." (t4815, t5087, worn t5370). Channel (t5372, t5604-5613) restores
 * 15% oxygen, plays human_inhale_pufferfish and counts down; at 0 it says it has run out (t5616);
 * with the fishbowl helmet on it only says so (t4816). Wield underwater (t5302-5316): the warning,
 * then the choice. The charges are the player's varbit fossil_merfolk_trident_charges.
 */
const CHARGES_ATTRIBUTE = "fossil-island:merfolk-trident-charges";
const CHARGES_VARBIT = "fossil_merfolk_trident_charges";
const MAX_CHARGES = 10;
const INHALE_ANIMATION = 7701; // human_inhale_pufferfish

const FULL_MESSAGE = "Your trident is full.";
const HELMET_MESSAGE = "You don't need to do that with your helmet on.";
const EMPTY_MESSAGE = "Your trident has run out of charges.";
const CHANNEL_MESSAGE = "You channel the power of your trident, restoring some of your puff.";
const WIELD_WARNING = "<col=ff0000>WARNING!<br>If you have this item equipped you can not swim. Deeper water will kill you.";
const PLAY_SAFE = "Play it safe.";
// Wiki wording; rsprox 231/00715 t5313 has "I'll steer clear of deep water but wield this anyway."
const WIELD_ANYWAY = "I'll steer clear of deeper water but wield this anyway.";

let core;
let pluginApi;
let shared;
let puff = 0;

/** Players whose "wield this anyway" is equipping the trident right now. */
const confirmed = new WeakSet();

function charges(player) {
  return Number(player.getAttribute(CHARGES_ATTRIBUTE) ?? 0);
}

function syncCharges({ player }) {
  const id = core.CacheDefinitions.getVarbitId(CHARGES_VARBIT);
  if (id == null) return;
  const sender = player.getPacketSender();
  if (sender.getVarbit(id) !== charges(player)) sender.sendVarbit(id, charges(player));
}

function setCharges(player, value) {
  player.setAttribute(CHARGES_ATTRIBUTE, value);
  syncCharges({ player });
}

function chargeNoun(count) {
  return count === 1 ? "charge" : "charges";
}

function mesbox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

/** Pufferfish on the trident: every fish that fits goes in at once. */
function charge(event) {
  const { player } = event;
  event.handled = true;
  const room = MAX_CHARGES - charges(player);
  if (room <= 0) {
    mesbox(player, FULL_MESSAGE);
    return;
  }
  const fish = core.ItemIdentifiers.PUFFERFISH;
  const added = Math.min(room, player.getInventory().getAmount(fish));
  if (added <= 0) return;
  player.getInventory().delete(fish, added);
  setCharges(player, charges(player) + added);
}

// Ours: "1 charges" isn't recorded; Channel's count line is singular at 1, so this one is too.
function check({ player }) {
  const count = charges(player);
  player.sendMessage(`Your trident has: ${count} ${chargeNoun(count)}.`);
  return true;
}

/** Channel: only underwater (elsewhere it falls through, like Puff), and not with breathing gear on. */
function channel({ player }) {
  if (!shared.isDiving(player)) return false;
  if (shared.breathingGear(player)) {
    player.sendMessage(HELMET_MESSAGE);
    return true;
  }
  const count = charges(player);
  if (count <= 0) {
    player.sendMessage(EMPTY_MESSAGE);
    return true;
  }
  shared.changeOxygen(player, puff);
  setCharges(player, count - 1);
  player.performAnimation(new core.Animation(INHALE_ANIMATION));
  player.sendMessage(CHANNEL_MESSAGE);
  player.sendMessage(`You have ${count - 1} ${chargeNoun(count - 1)} left.`);
  return true;
}

/** "Wield this anyway": puts the trident on if the player still holds it. */
function wieldAnyway(player) {
  const { EquipPacketListener, Inventory, ItemIdentifiers } = core;
  const slot = player.getInventory().getSlotForItemId(ItemIdentifiers.MERFOLK_TRIDENT);
  if (slot < 0 || player.getHitpoints() <= 0) return;
  confirmed.add(player);
  try {
    EquipPacketListener.equip(player, ItemIdentifiers.MERFOLK_TRIDENT, slot, Inventory.INTERFACE_ID);
  } finally {
    confirmed.delete(player);
  }
}

function askToWield(player) {
  pluginApi.sendMultiChatboxPrompt(player, "Select an option", PLAY_SAFE, () => {}, WIELD_ANYWAY, () => wieldAnyway(player));
}

/** Wielding it underwater waits for the warning and the choice; on land it just goes on. */
function warnBeforeWield(event) {
  const { player, item } = event;
  if (Number(item?.getId?.()) !== core.ItemIdentifiers.MERFOLK_TRIDENT) return;
  if (confirmed.has(player) || !shared.isDiving(player)) return;
  event.allow = false;
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, WIELD_WARNING),
    new ActionDialogue(1, { execute: () => askToWield(player) }),
  ));
}

function attach(api, sharedHelpers, data) {
  core = api.core;
  pluginApi = api;
  shared = sharedHelpers;
  puff = data.puff;
  api.persistAttribute(CHARGES_ATTRIBUTE, 0);
  api.onItemOnItem("Pufferfish", "Merfolk trident", charge, { noted: false });
  api.onItemAction("Merfolk trident", { Check: check, Channel: channel });
  api.onCanEquip(warnBeforeWield);
  api.onCustomEvent("player:bootstrap-complete", syncCharges);
}

module.exports = {
  attach,
  _test: { charge, check, channel, warnBeforeWield, wieldAnyway, CHARGES_ATTRIBUTE, MAX_CHARGES, WIELD_WARNING, PLAY_SAFE, WIELD_ANYWAY },
};
