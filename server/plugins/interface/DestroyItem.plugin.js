// Cache confirmdestroy: setup 814 installs the mouse and 1/Y, 2/N listeners.
const GROUP_ID = 584;
const SETUP_SCRIPT = 814;
const CONFIRM_BUTTON = GROUP_ID << 16;
const PENDING_ATTRIBUTE = "destroy-item:pending";
const DEFAULT_QUESTION = "Are you sure you want to destroy this item?";
const DEFAULT_WARNING = "This item will be destroyed permanently.";

const pendingDestroys = new WeakMap();
let pluginApi = null;

function close(player) {
  pendingDestroys.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
}

/**
 * "destroy-item:prompt" `{ player, item, question, warning }`: the plugin that owns an item can
 * word its confirmation (the looting bag's names its contents).
 */
function open(player, item, slot) {
  const prompt = { player, item, question: DEFAULT_QUESTION, warning: DEFAULT_WARNING };
  pluginApi?.emitCustomEvent?.("destroy-item:prompt", prompt);
  pendingDestroys.set(player, { itemId: item.getId(), amount: item.getAmount(), slot });
  player.setAttribute(PENDING_ATTRIBUTE, item.getId());
  player
    .getPacketSender()
    .sendChatboxInterface(GROUP_ID)
    .sendClientScript(SETUP_SCRIPT, item.getId(), item.getAmount(), prompt.question, prompt.warning);
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
  if (pending && pending.itemId === event.itemId) return;
  open(event.player, event.item, event.slot);
  event.handled = true;
}

function confirmDestroy({ player, action }) {
  // The native resume's dynamic child is 1 for Yes and 0 for No.
  if (action !== 0 && action !== 1) return false;
  const pending = pendingDestroy(player);
  if (!pending) return false;
  if (action === 0) {
    close(player);
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
  pluginApi.core?.PluginManager?.emitItemDropPolicy(event);
  if (!event.handled) {
    const discarded = item.clone();
    player.getInventory().deleteAtSlot(pending.slot, pending.amount);
    pluginApi.emitCustomEvent("item:discarded", { player, item: discarded });
    // Containers and other item owners clear their state only after actual destruction.
    pluginApi.emitCustomEvent("destroy-item:destroyed", { player, itemId: pending.itemId, amount: pending.amount });
  }
  close(player);
}

module.exports = {
  name: "DestroyItem",
  register(api) {
    pluginApi = api;
    api.onItemDropPolicy(dropItem);
    api.onInterfaceActionButton(CONFIRM_BUTTON, confirmDestroy);
  },
};
