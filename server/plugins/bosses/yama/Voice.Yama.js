/**
 * The Voice of Yama, at the bottom of the Chasm of Fire, as captured:
 * - its variant follows varbit chasm_voice_progress: Talk-to only until the first talk, which
 *   plays the Wiki's first-time transcript and sets it to 2 (Talk-to, Travel, Join) as its menu
 *   comes up; later talks play the short one;
 * - "Enter Yama's domain." and Travel take the player into the domain (Domain.Yama).
 * Open access: A Kingdom Divided isn't asked for (docs/yama.md).
 *
 * OSRS keeps what a challenger drops in a gravestone by the Voice. tsps has no gravestones, so the
 * Voice holds it, as Zul-Gwenwynig does at Zulrah; Talk-to hands it back for the gravestone's fee
 * (Wiki), and an unsafe death anywhere else first loses it.
 */
const Common = require("./Common.Yama");
const Domain = require("./Domain.Yama");

const COINS = 995;
const FIRST_TIME = "standard-dialogue-first-time";
const SUBSEQUENT = "standard-dialogue-subsequent-times";
const ENTER_OPTION = "Enter Yama's domain.";
const STAY_OPTION = "Stay.";

const isVoice = (npcId) => npcId === Common.data.npcs.voice || Common.data.npcs.voiceVariants.includes(npcId);
const progress = (player) => Common.count(player, Common.VOICE_PROGRESS_ATTRIBUTE);

function setProgress(player, value) {
  player.setAttribute(Common.VOICE_PROGRESS_ATTRIBUTE, value);
  player.getPacketSender().sendVarbit(Common.data.varbits.voiceProgress, value);
}

function syncProgress({ player }) {
  const value = progress(player);
  if (value > 0) player.getPacketSender().sendVarbit(Common.data.varbits.voiceProgress, value);
}

function voiceVariant({ player, npcId }) {
  if (!isVoice(npcId)) return null;
  return progress(player) >= Common.data.varbits.voiceMet ? SUBSEQUENT : FIRST_TIME;
}

/** The menu's answer: the first talk is over either way. */
function answerVoice({ player, npcId, option }) {
  if (!isVoice(npcId) || (option !== ENTER_OPTION && option !== STAY_OPTION)) return;
  if (progress(player) < Common.data.varbits.voiceMet) setProgress(player, Common.data.varbits.voiceMet);
}

/**
 * "Enter Yama's domain." leads to the transcript's narration of the trip ("Player is transported
 * to Yama's Domain."), which ends the chat; the trip itself starts once the chat has closed, on
 * the same tick, so its first message box isn't closed with it.
 */
function enterFromChat(action) {
  if (!isVoice(action.npcId) || action.action !== "teleport") return;
  action.handled = true;
  action.end = true;
  const { player } = action;
  queueMicrotask(() => Domain.enter(player));
}

/** Duo fights aren't in yet: the Voice turns pairs away (our line, docs/yama.md). */
function join({ player }) {
  voiceSays(player, Common.data.voice.noDuo);
  return true;
}

function travel({ player }) {
  Domain.enter(player);
  return true;
}

// ---------------------------------------------------------------- what the Voice holds

const heldItems = (player) => {
  const held = player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE);
  return held && Array.isArray(held.items) && held.items.length > 0 ? held : null;
};

/** A death in the domain: what would drop stays with the Voice. Elsewhere, an unsafe death loses it. */
function holdForVoice(event) {
  const { player, item } = event;
  if (!Domain.sessionOf(player)) {
    if (event.shouldDropItems && heldItems(player)) {
      player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, null);
      player.sendMessage(Common.data.retrieval.lostMessage);
    }
    return;
  }
  if (!event.dropEligible) return;
  const held = heldItems(player) ?? { items: [], paid: false };
  held.items.push([item.getId(), item.getAmount()]);
  held.announce = true;
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, held);
  event.handled = true;
}

/**
 * The gravestone's fee (Wiki): per item by its value, capped, halved for Ironmen; Yama's own
 * discount takes 75% off until the player has 10 successes.
 */
function retrievalFee(player, items) {
  const { tiers, cap, ironmanFactor, discountedKills, discountFactor } = Common.data.retrieval;
  const { ItemDefinition } = Common.core;
  let fee = 0;
  for (const [id, amount] of items) {
    const value = ItemDefinition.forId(id)?.getGrandExchangeValue?.() ?? 0;
    const tier = tiers.find(([below]) => below === null || value < below);
    fee += (tier?.[1] ?? 0) * amount;
  }
  fee = Math.min(cap, fee);
  const mode = { player, mode: null };
  Common.api.emitCustomEvent("ironman:mode", mode);
  if (mode.mode && mode.mode !== "none") fee *= ironmanFactor;
  if (Common.count(player, Common.SUCCESS_COUNT_ATTRIBUTE) < discountedKills) fee *= discountFactor;
  return Math.floor(fee);
}

function voiceSays(player, text) {
  const { DialogueChainBuilder, NpcDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, Common.data.npcs.voiceVariants[0], text),
  ));
}

/** While the Voice holds items, Talk-to is about them: the fee, then everything that fits. */
function talkToVoice({ player }) {
  const held = heldItems(player);
  if (!held) return false;
  const { retrieval } = Common.data;
  if (!held.paid) {
    const fee = retrievalFee(player, held.items);
    const inventory = player.getInventory();
    if (fee > 0 && inventory.getAmount(COINS) < fee) {
      voiceSays(player, retrieval.feeLine.replace("[fee]", fee.toLocaleString("en-GB")));
      return true;
    }
    if (fee > 0) inventory.delete(COINS, fee);
    held.paid = true;
  }
  const { Item, ItemDefinition } = Common.core;
  const inventory = player.getInventory();
  const left = [];
  for (const [id, amount] of held.items) {
    const stackable = ItemDefinition.forId(id)?.isStackable?.();
    const fits = stackable ? inventory.contains(id) || inventory.getFreeSlots() > 0 : inventory.getFreeSlots() > 0;
    if (fits) inventory.add(new Item(id, amount), false);
    else left.push([id, amount]);
  }
  inventory.refreshItems?.();
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, left.length > 0 ? { items: left, paid: true } : null);
  player.sendMessage(left.length > 0 ? retrieval.partialMessage : retrieval.collectedMessage);
  return true;
}

function attachVoice(api) {
  api.onCustomEvent("item-retrieval:items", retrievalItems);
  api.persistAttribute(Common.VOICE_PROGRESS_ATTRIBUTE);
  api.persistAttribute(Common.HELD_ITEMS_ATTRIBUTE);
  api.onPlayerLogin(syncProgress);
  api.onNpcDialogueVariant(voiceVariant);
  api.onCustomEvent("npc-dialogue:choice", answerVoice);
  api.onCustomEvent("npc-dialogue:action", enterFromChat);
  api.onNpcInteraction("Voice of Yama", { "Talk-to": talkToVoice, Travel: travel, Join: join });
  api.onPlayerDeathItemDrop(holdForVoice);
}

function retrievalItems(request) {
  for (const [itemId, amount] of heldItems(request.player)?.items ?? []) request.items.push({itemId, amount});
}

module.exports = { attachVoice, retrievalFee, retrievalItems };
