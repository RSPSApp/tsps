// Cache confirmdestroy: setup 814 installs the mouse and 1/Y, 2/N listeners.
const GROUP_ID = 584;
const SETUP_SCRIPT = 814;
const CONFIRM_BUTTON = GROUP_ID << 16;
const PENDING_ATTRIBUTE = "destroy-item:pending";
// Live OSRS: rsprox 1541 sends synth 2381 after the confirmed inventory removal.
const DESTROY_SOUND = 2381;
const DEFAULT_QUESTION = "Are you sure you want to destroy this item?";
// Ours: the note for an item with no recorded one.
const DEFAULT_WARNING = "This item will be destroyed permanently.";
// Each item's own note (and question, where it differs), by obj gameval.
const NOTES = require("./data/destroy-notes.json").items;
/** Bank.INCINERATE_EVENT: a bank stack dropped on the bank's incinerator. */
const BANK_INCINERATE_EVENT = "bank:incinerate";

const pendingDestroys = new WeakMap();
let pluginApi = null;
/** obj id -> { question?, note } from NOTES, resolved on first use. */
let notesById = null;

function noteFor(itemId) {
  const definitions = pluginApi?.core?.CacheDefinitions;
  if (!notesById && typeof definitions?.getObjId === "function") {
    notesById = new Map();
    for (const [name, entry] of Object.entries(NOTES)) {
      const id = definitions.getObjId(name);
      if (Number.isInteger(id)) notesById.set(id, typeof entry === "string" ? { note: entry } : entry);
    }
  }
  return notesById?.get(itemId);
}

function close(player) {
  pendingDestroys.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
}

/**
 * The bank's incinerator prompt is a chatbox with this pending record as its owner: only the
 * prompt we opened may be closed or confirmed. A replacement 584 is left untouched, and the
 * bank modal behind our prompt stays open.
 */
function closeBankPrompt(player, pending) {
  const sender = player.getPacketSender();
  const owned = sender.closeChatboxFor(pending);
  pendingDestroys.delete(player);
  return owned;
}

/**
 * "destroy-item:prompt" `{ player, item, question, warning }`: the plugin that owns an item can
 * word its confirmation (the looting bag's names its contents).
 */
function present(player, item, pending, owner) {
  const own = noteFor(item.getId());
  const prompt = { player, item, question: own?.question ?? DEFAULT_QUESTION, warning: own?.note ?? DEFAULT_WARNING };
  pluginApi?.emitCustomEvent?.("destroy-item:prompt", prompt);
  pendingDestroys.set(player, pending);
  player.setAttribute(PENDING_ATTRIBUTE, item.getId());
  const sender = player.getPacketSender();
  const show = () => sender
    .sendChatboxInterface(GROUP_ID)
    .sendClientScript(SETUP_SCRIPT, item.getId(), item.getAmount(), prompt.question, prompt.warning);
  if (owner) sender.withChatboxOwner(owner, show);
  else show();
}

/**
 * "destroy-item:confirm" { player, item, slot, question, note, confirm }: another of the item's options
 * (Uncharge, Dismantle) asks on this same prompt. Yes calls confirm(player, item) while that item is
 * still in its inventory slot; No closes it.
 */
function openConfirm(request) {
  const { player, item, slot } = request;
  if (!item || player.getInventory().getItems()[slot] !== item) return;
  // Closing first clears any other 584 prompt's pending item, so Yes answers this one.
  player.getPacketSender().sendInterfaceRemoval();
  pendingDestroys.set(player, { kind: "confirm", itemId: item.getId(), item, slot, confirm: request.confirm });
  player.setAttribute(PENDING_ATTRIBUTE, item.getId());
  player.getPacketSender()
    .sendChatboxInterface(GROUP_ID)
    .sendClientScript(SETUP_SCRIPT, item.getId(), item.getAmount(), request.question, request.note);
  request.opened = true;
}

function open(player, item, slot) {
  present(player, item, { kind: "inventory", itemId: item.getId(), amount: item.getAmount(), slot });
}

/** A stack dropped on the bank's incinerator; the whole stack is destroyed when confirmed. */
/**
 * "destroy-item:allowed" { player, item, itemId, source, allowed, message }: an item's owner may refuse its destruction
 * where the inventory's drop policy doesn't run (the bank incinerator): a bond, a coal bag still holding coal. The
 * refusal's message is sent here.
 */
function destroyAllowed(player, item, source) {
  const request = { player, item, itemId: item.getId(), source, allowed: true, message: null };
  pluginApi.emitCustomEvent("destroy-item:allowed", request);
  if (request.allowed !== false) return true;
  if (request.message) player.sendMessage(request.message);
  return false;
}

function openBank({ player, item, tab, slot }) {
  if (!item || item.getAmount() <= 0 || !Number.isInteger(tab) || !Number.isInteger(slot)) return;
  if (!destroyAllowed(player, item, "bank")) return;
  const pending = {
    kind: "bank",
    itemId: item.getId(),
    amount: item.getAmount(),
    tab,
    slot,
    item: item.clone(),
  };
  present(player, item, pending, pending);
}

function pendingDestroy(player) {
  const pending = pendingDestroys.get(player);
  if (!pending || player.getAttribute(PENDING_ATTRIBUTE) !== pending.itemId) return undefined;
  if (!player.getPacketSender().isChatboxInterface(GROUP_ID)) return undefined;
  return pending;
}

function dropItem(event) {
  // Preset items are disposable by design; real untradeables still ask first.
  if (event.item.isPresetItem?.()) {
    event.player.getInventory().deleteAtSlot(event.slot, event.item.getAmount());
    event.handled = true;
    return;
  }
  if (event.item.isDropable()) return;
  // Confirmation re-runs the policy, including other plugins' vetoes.
  const pending = pendingDestroy(event.player);
  if (pending?.kind === "inventory" && pending.itemId === event.itemId) return;
  open(event.player, event.item, event.slot);
  event.handled = true;
}

function confirmDestroy({ player, action }) {
  // The native resume's dynamic child is 1 for Yes and 0 for No.
  if (action !== 0 && action !== 1) return false;
  const pending = pendingDestroy(player);
  if (!pending) return false;
  if (action === 0) {
    if (pending.kind === "bank") closeBankPrompt(player, pending);
    else close(player);
    return;
  }

  if (pending.kind === "confirm") {
    close(player);
    const item = player.getInventory().getItems()[pending.slot];
    if (item === pending.item && item.getId() === pending.itemId) pending.confirm(player, item);
    return;
  }

  if (pending.kind === "bank") {
    // Authorize only our own prompt. A replacement 584 (or a closed prompt) is left alone.
    if (!closeBankPrompt(player, pending)) return;
    if (pluginApi.core?.Bank?.isOpen?.(player) !== true) return;
    const bank = player.getBank(pending.tab);
    const item = bank?.getItems?.()[pending.slot];
    // Reordering or a changed stack invalidates the prompt: never destroy whatever now occupies
    // the old slot (the item id, amount and metadata must all still match).
    if (!item || !item.equals(pending.item)) return;
    // Asked again at the Yes: the coal bag may have been filled meanwhile.
    if (!destroyAllowed(player, item, "bank")) return;
    const discarded = item.clone();
    bank.deleteAtSlot(pending.slot, pending.amount);
    // Bank refresh may compact a same-ID neighbour into the deleted slot.
    if (item.getId() === pending.itemId && item.getAmount() >= pending.amount) return;
    pluginApi.emitCustomEvent("item:discarded", { player, item: discarded });
    pluginApi.emitCustomEvent("destroy-item:destroyed", { player, itemId: pending.itemId, amount: pending.amount });
    pluginApi.emitCustomEvent("persistence:save", { player, reason: "bank-incinerate" });
    return;
  }

  const item = player.getInventory().getItems()[pending.slot];
  if (item?.getId() !== pending.itemId) {
    close(player);
    return;
  }
  const event = {
    player,
    interfaceId: GROUP_ID,
    item,
    itemId: pending.itemId,
    slot: pending.slot,
    dropToGround: false,
    handled: false,
  };
  const amount = item.getAmount();
  pluginApi.core?.PluginManager?.emitItemDropPolicy(event);
  if (!event.handled) {
    const discarded = item.clone();
    player.getInventory().deleteAtSlot(pending.slot, pending.amount);
    pluginApi.emitCustomEvent("item:discarded", { player, item: discarded });
    // Containers and other item owners clear their state only after actual destruction.
    pluginApi.emitCustomEvent("destroy-item:destroyed", { player, itemId: pending.itemId, amount: pending.amount });
  }
  const remaining = player.getInventory().getItems()[pending.slot];
  if (remaining?.getId() !== pending.itemId || remaining.getAmount() < amount) {
    player.getPacketSender().sendSound(DESTROY_SOUND, 100, 0);
  }
  close(player);
}

module.exports = {
  name: "DestroyItem",
  description: "The destroy-item confirmation and its 1/Y and 2/N keys, with the destroy sound and each item's own warning; other options (Uncharge, Dismantle) can ask on it too.",
  register(api) {
    pluginApi = api;
    api.onItemDropPolicy(dropItem);
    api.onCustomEvent(BANK_INCINERATE_EVENT, openBank);
    api.onCustomEvent("destroy-item:confirm", openConfirm);
    api.onInterfaceActionButton(CONFIRM_BUTTON, confirmDestroy);
  },
};
