/**
 * Item retrieval (Wiki): a death in The Nightmare's dream leaves what the player would drop with
 * Shura, in Phosani's with Sister Senga (whose message is as captured), returned for a flat 60,000
 * coins. Collect, or "Do you have any of my items?" in their transcripts, hands it back. Another
 * unsafe death first loses it, in a dream too (Wiki: "Any unsafe death will delete all items left
 * inside the deathbank"): a second dream death's keeper holds only that death's items.
 */
const Common = require("./Common.Nightmare");
const Dream = require("./Dream.Nightmare");

const COINS = 995;
const HOLDERS = { shura: "Shura", senga: "Sister Senga" };

const heldItems = (player) => {
  const held = player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE);
  return held && Array.isArray(held.items) && held.items.length > 0 ? held : null;
};

function retrievalItems(request) {
  for (const [itemId, amount] of heldItems(request.player)?.items ?? []) request.items.push({itemId, amount});
}

/** An item's meta (charges, degradation) as the save keeps it, or null. */
function metaOf(item) {
  const meta = item.getMeta?.();
  return meta == null ? null : JSON.parse(JSON.stringify(meta));
}

/**
 * player -> the death (its position object, one per PlayerDeathTask.dropItems call) whose items the keeper
 * holds now, so a death's later items join its own lot and only a new death loses the old one.
 */
const heldDeath = new WeakMap();

/** An unsafe death loses what a keeper held from an earlier death. */
function loseHeld(player, death) {
  const held = heldItems(player);
  if (!held || heldDeath.get(player) === death) return;
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, null);
  player.sendMessage(Common.data.retrieval.lost.replace("[holder]", HOLDERS[held.holder]));
}

/** A death in a dream: what would drop stays with its keeper, and an earlier lot is lost. Elsewhere, an unsafe death loses it. */
function hold(event) {
  const { player, item } = event;
  if (event.shouldDropItems) loseHeld(player, event.location);
  const dream = Dream.dreamOf(player);
  if (!dream) return;
  heldDeath.set(player, event.location);
  if (!event.dropEligible) return;
  const holder = dream.phosani ? "senga" : "shura";
  const held = heldItems(player) ?? { holder, items: [] };
  held.holder = holder;
  held.items.push([item.getId(), item.getAmount(), metaOf(item)]);
  held.paid = false;
  held.announce = true;
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, held);
  event.handled = true;
}

/** Once per death, also when it loses nothing: an unsafe death with no items still loses the held lot. */
function deathDrops(event) {
  loseHeld(event.player, event.location);
  if (Dream.dreamOf(event.player)) heldDeath.set(event.player, event.location);
}

/** Said once the player wakes by the Pool (Dream.Nightmare). */
function announce(player) {
  const held = heldItems(player);
  if (!held?.announce) return;
  held.announce = false;
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, held);
  player.sendMessage(Common.data.retrieval.held.replace("[holder]", HOLDERS[held.holder]));
}

function holderOf(npcName) {
  return npcName === "Shura" ? "shura" : npcName === "Sister Senga" ? "senga" : null;
}

/** The fee, then everything that fits. */
function collect(player, holder) {
  const held = heldItems(player);
  if (!held || held.holder !== holder) return false;
  const { retrieval } = Common.data;
  const inventory = player.getInventory();
  const name = HOLDERS[holder];
  if (!held.paid) {
    if (inventory.getAmount(COINS) < retrieval.fee) {
      player.sendMessage(retrieval.noFee.replace("[fee]", retrieval.fee.toLocaleString("en-GB")));
      return true;
    }
    inventory.delete(COINS, retrieval.fee);
    held.paid = true;
  }
  const { Item } = Common.core;
  const left = [];
  for (const [id, amount, meta = null] of held.items) {
    // An item with meta (charges, degradation) goes back as itself, stacking only onto the same meta.
    const copy = (n) => (meta == null ? new Item(id, n) : new Item(id, n, JSON.parse(JSON.stringify(meta))));
    // Only what fits moves (free slots, or a stack's cap): the rest stays here.
    const moved = inventory.getAddableAmount(copy(amount));
    if (moved > 0) inventory.add(copy(moved), false);
    if (moved < amount) left.push([id, amount - moved, meta]);
  }
  inventory.refreshItems?.();
  player.setAttribute(Common.HELD_ITEMS_ATTRIBUTE, left.length > 0 ? { holder, items: left, paid: true } : null);
  player.sendMessage((left.length > 0 ? retrieval.partial : retrieval.collected).replace("[holder]", name));
  return true;
}

function collectOption({ player, definition }) {
  const holder = holderOf(definition?.getName?.());
  if (!holder) return false;
  if (!collect(player, holder)) {
    const { DialogueChainBuilder, NpcDialogue } = Common.core;
    const line = holder === "shura"
      ? "Doesn't look like it. If I did have any of your items, but you died before collecting them, they'll now be lost."
      : "Sorry, but I don't have anything for you. If I did have any of your items, but you died before collecting them, they'll now be lost.";
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, definition.getId(), line)));
  }
  return true;
}

/** Their transcripts ask whether they hold anything for the player. */
function answerCondition({ player, definition, text }) {
  const holder = holderOf(definition?.getName?.());
  if (!holder || !/items in (Shura|Sister Senga)'s collection/.test(text ?? "")) return null;
  const has = heldItems(player)?.holder === holder;
  return /has no items/.test(text) ? !has : has;
}

/** "...'s Item Retrieval Service": we hand the items back there and then. */
function openService(request) {
  if (request.action !== "open_interface" || !/Item Retrieval Service/.test(request.target ?? "")) return;
  const holder = /^Shura/.test(request.target) ? "shura" : /^Sister Senga/.test(request.target) ? "senga" : null;
  if (!holder) return;
  request.handled = true;
  request.player.getPacketSender().sendInterfaceRemoval();
  collect(request.player, holder);
}

function attachRetrieval(api) {
  api.onCustomEvent("item-retrieval:items", retrievalItems);
  api.persistAttribute(Common.HELD_ITEMS_ATTRIBUTE);
  api.onPlayerDeathItemDrop(hold);
  api.onPlayerDeathDrops(deathDrops);
  api.onNpcsInteraction(["Shura", "Sister Senga"], { Collect: collectOption });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", openService);
}

module.exports = { attachRetrieval, announce, retrievalItems };
