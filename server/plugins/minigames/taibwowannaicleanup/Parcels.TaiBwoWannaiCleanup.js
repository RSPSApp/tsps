/**
 * Tai Bwo Wannai Cleanup: Rionasta's parcel service (https://oldschool.runescape.wiki/w/Rionasta),
 * items sent from the inventory to the bank for trading sticks.
 *
 * His transcript's "Can I send a parcel please?" needs 10 sticks ("It costs at least 10 trading
 * sticks...") and then opens the Tai Bwo Wannai Parcel Service, interface tai_bwo_wannai_post.
 * Its onload script (2851) draws the inventory into `items` and script 2855 gives every item the
 * ops Value, Pack-1, Pack-5, Pack-10, Pack-All, Pack-X and Examine; no recording uses it, so those
 * ops are what is answered here. The price is his own line, "It costs 10 trading sticks per item,
 * unfortunately, even stackable items cost the same.", read as the Rionasta Wiki page reads it:
 * 10 per item in a stack (the Cleanup page says 10 a stack). Currencies (the Wiki's list) and
 * Karamjan rum are refused with the Wiki's messages; anything the bank refuses stays. The
 * Send-parcel op does what the conversation does.
 */
const Common = require("./Common.TaiBwoWannaiCleanup");

const parcels = () => Common.data.parcels;
const cache = () => Common.core.CacheDefinitions;
const interfaceId = () => cache().getInterfaceId(parcels().interface);
const itemsComponent = () => cache().getComponentId(parcels().items);
/** Transmit ops 1-7 on each item (the seven script 2855 sets). */
const ITEM_OPS_FLAGS = 0xfe;
const DEPOSIT_SOURCE = "deposit-box";
const MAIN_MODAL = (161 << 16) | 16;

const sticksId = () => Common.objId(Common.data.sticks.item);
const sticksHeld = (player) => player.getInventory().getAmount(sticksId());
const isRionasta = (event) => event.definition?.getName?.() === "Rionasta";

function open(player) {
  if (Common.api.emitCanBank(player, DEPOSIT_SOURCE) === false) return;
  const sender = player.getPacketSender();
  sender.sendInterface(interfaceId());
  sender.sendInterfaceFlagsRange(itemsComponent(), 0, 27, ITEM_OPS_FLAGS);
}

const isOpen = (player) => player.getInterfaceId?.() === interfaceId();

/** Why `item` can't go, as a message, or null. Currencies and rum by name (Wiki). */
function refusal(item) {
  const name = String(item.getDefinition().getName() ?? "").toLowerCase();
  if (name === parcels().rum.toLowerCase()) return Common.message("parcelRum");
  if (parcels().currencies.some((currency) => name === currency.toLowerCase())) return Common.message("parcelCurrency");
  return null;
}

/** Sends up to `amount` (-1 for all) of the item in `slot`, at 10 sticks each, as many as are paid for. */
function send(player, slot, itemId, amount) {
  if (!isOpen(player) || Common.api.emitCanBank(player, DEPOSIT_SOURCE) === false) return 0;
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (!item || item.getId() !== itemId || itemId <= 0) return 0;
  const refused = refusal(item);
  if (refused) {
    player.sendMessage(refused);
    return 0;
  }
  // The bank's own veto (untradeable quest items and the like) sends its own message, if any.
  if (Common.api.emitCanBankItem(player, item) === false) return 0;
  const affordable = Math.floor(sticksHeld(player) / parcels().perItem);
  if (affordable <= 0) {
    player.sendMessage(Common.message("parcelNoSticks"));
    return 0;
  }
  const before = inventory.getAmount(itemId);
  const wanted = amount < 0 ? before : Math.min(amount, before);
  if (wanted <= 0) return 0;
  Common.core.Bank.deposit(player, itemId, slot, Math.min(wanted, affordable), true);
  const sent = before - inventory.getAmount(itemId);
  if (sent > 0) {
    inventory.deleteNumber(sticksId(), sent * parcels().perItem);
    inventory.refreshItems();
  }
  if (wanted > affordable && sent > 0) player.sendMessage(Common.message("parcelNoSticks"));
  return sent;
}

function promptAmount(player, slot, itemId) {
  if (player.getEnteredAmountAction?.() != null) return;
  player.setEnteredAmountAction({ execute: (amount) => send(player, slot, itemId, amount) });
  player.getPacketSender().sendEnterAmountPrompt("How many would you like to send?");
}

function onItemClick(event) {
  const { player } = event;
  if (event.buttonId !== itemsComponent() || !isOpen(player)) return;
  event.handled = true;
  const { ops } = parcels();
  const item = player.getInventory().getItems()[event.slot];
  if (!item || item.getId() <= 0) return;
  // The packet names the item it was clicked on; a slot that has since changed is a stale click.
  const itemId = Number.isInteger(event.itemId) && event.itemId > 0 ? event.itemId : item.getId();
  if (item.getId() !== itemId) return;
  const amount = ops.amounts[String(event.action)];
  if (amount !== undefined) send(player, event.slot, itemId, amount);
  else if (event.action === ops.x) promptAmount(player, event.slot, itemId);
  else if (event.action === ops.value) player.sendMessage(Common.message("parcelValue", { item: item.getDefinition().getName() }));
  else if (event.action === ops.examine) player.sendMessage(item.getDefinition().getExamine() || item.getDefinition().getName());
}

/** "If the player does not have at least 10 trading sticks in their inventory:" */
function answerCondition(event) {
  if (!isRionasta(event) || event.text !== parcels().condition) return undefined;
  return sticksHeld(event.player) < parcels().perItem;
}

/** His transcript's open_interface: the conversation closes, then the service opens next tick. */
function onAction(event) {
  if (!isRionasta(event) || event.action !== "open_interface" || event.target !== parcels().action) return;
  event.handled = true;
  event.end = true;
  Common.later(event.player, 1, () => {
    // Keep a newer main interface in place while this request was deferred.
    if (!event.player.getPacketSender().getSubInterfaceAt(MAIN_MODAL)) open(event.player);
  });
}

/** Send-parcel: as the conversation's request, without the talk. */
function sendParcel(event) {
  const { player } = event;
  event.handled = true;
  if (sticksHeld(player) >= parcels().perItem) {
    open(player);
    return true;
  }
  const { DialogueChainBuilder, EndDialogue, NpcDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, cache().getNpcId("tbwcu_rionasta"), Common.message("parcelTooFew")),
    new EndDialogue(1),
  ));
  return true;
}

function attachParcels(api) {
  api.onNpcInteraction("Rionasta", { "Send-parcel": sendParcel });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", onAction);
  api.onInterfaceActionClick(onItemClick);
}

module.exports = { attachParcels, open, send, refusal, answerCondition };
