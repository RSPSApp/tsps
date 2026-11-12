"use strict";

const Warning = require("../../interface/ValueWarning");
const KEYS_ATTRIBUTE = "steel-key-ring:keys";
const SETUP_SCRIPT = 861; // rev242 script861; keytotal and native remove/previous/next callbacks
const HIGHLIGHT_MODEL = 5623; // favour_keyring's highlighted key
// Wiki Steel key ring's explicit whitelist. Bone key is Shilo Village's 605, not Ghosts Ahoy's 4272.
const KEYS = [
  ["ANCESTRAL_KEY", "Allows access to the Spirits of the Elid cave."],
  ["BATTERED_KEY", "Allows access to the Elemental Workshop."],
  ["BONE_KEY", "Allows access to Rashiliyia's tomb."],
  ["BRASS_KEY", "Allows access to Edgeville dungeon."],
  ["CRYSTAL_MINE_KEY", "Allows access to the crystal mine."],
  ["DUSTY_KEY", "Allows access to the depths of Taverley dungeon."],
  ["ENCHANTED_KEY", "An enchanted key."],
  ["MAZE_KEY", "Allows access to Melzar's Maze."],
  ["METAL_KEY", "Allows access to the Desert Mining Camp."],
  ["NEW_KEY", "Allows access to the Mourner Tunnels."],
  ["SHINY_KEY", "Allows access to the shed in McGrubor's Wood."],
  ["WEAPON_STORE_KEY", "Allows access to the Phoenix Gang's weapon store."],
  ["WROUGHT_IRON_KEY", "Allows access to the mine in the Desert Mining Camp."],
];
let api;
let core;
const selections = new WeakMap();

function ringId() { return core.ItemIdentifiers.STEEL_KEY_RING; }
function carried(player) { return player.getInventory().contains(ringId()); }
function banked(player) {
  return (player.getBanks() ?? []).some((bank, tab) => tab !== core.Bank.BANK_SEARCH_TAB_INDEX && bank?.contains(ringId()));
}
function keyData(id) { return KEYS.find(([name]) => core.ItemIdentifiers[name] === id); }
function contents(player) {
  const saved = player.getAttribute(KEYS_ATTRIBUTE);
  return Array.isArray(saved) ? [...new Set(saved.filter((id) => Number.isInteger(id) && keyData(id)))] : [];
}
function setContents(player, keys) { player.setAttribute(KEYS_ATTRIBUTE, keys); }
function contains(request) {
  if (keyData(request.itemId) && carried(request.player) && contents(request.player).includes(request.itemId)) request.available = true;
}
function component(name) { return core.CacheDefinitions.getComponentId(`favour_keyring:${name}`); }
function group() { return component("buttons") >>> 16; }
function nameOf(id) { return core.CacheDefinitions.getItem(id).name; }
function open({ player, itemId }) {
  if (itemId !== ringId() || !carried(player)) return;
  selections.set(player, 0);
  player.getPacketSender().sendInterface(group());
  refresh(player);
}
function refresh(player) {
  const keys = contents(player);
  const index = Math.min(selections.get(player) ?? 0, Math.max(0, keys.length - 1));
  selections.set(player, index);
  const id = keys[index] ?? -1;
  const sender = player.getPacketSender();
  sender.sendString(id < 0 ? "Steel key ring" : nameOf(id), component("name"));
  sender.sendString(id < 0 ? "There are no keys on your key ring." : keyData(id)[1], component("desc"));
  sender.sendInterfaceDisplayState(component("main"), id < 0);
  sender.sendInterfaceDisplayState(component("main_highlight"), id < 0);
  if (id >= 0) {
    sender.sendInterfaceRawModel(component("main"), core.CacheDefinitions.getItem(id).model);
    sender.sendInterfaceRawModel(component("main_highlight"), HIGHLIGHT_MODEL);
  }
  for (let offset = 1; offset <= 5; offset++) {
    const next = keys[index + offset - 1];
    sender.sendInterfaceDisplayState(component(`plus${offset}`), next == null);
    if (next != null) sender.sendInterfaceRawModel(component(`plus${offset}`), core.CacheDefinitions.getItem(next).model);
  }
  sender.sendClientScript(SETUP_SCRIPT, id, keys[index - 1] ?? -1, keys[index + 1] ?? -1, keys.length);
  // Client scripts 862/864 forward native controls to hidden buttons' dynamic children 0,1,2.
  sender.sendInterfaceFlagsRange(component("buttons"), 0, 2, 1);
}
function click(event) {
  if (event.groupId !== group() || event.childId !== (component("buttons") & 65535)) return;
  event.handled = true;
  const { player } = event;
  if (player.getInterfaceId() !== group() || !selections.has(player) || !carried(player)) return;
  // RESUME_PAUSEBUTTON carries the dynamic child as action, not a widget slot/op.
  const action = event.action;
  const keys = contents(player), index = selections.get(player);
  if (action === 0 && keys[index] != null) {
    const id = keys[index], inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) { inventory.full(); return; }
    const before = inventory.getAmount(id);
    inventory.adds(id, 1);
    if (inventory.getAmount(id) !== before + 1) return;
    keys.splice(index, 1);
    setContents(player, keys);
    player.sendMessage(`You remove the ${nameOf(id).toLowerCase()} from your key ring.`);
  } else if (action === 1 && index > 0) selections.set(player, index - 1);
  else if (action === 2 && index + 1 < keys.length) selections.set(player, index + 1);
  refresh(player);
}
function use(event) {
  const { player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot } = event;
  if (usedItemId !== ringId() && usedWithItemId !== ringId()) return;
  event.handled = true;
  const ringSlot = usedItemId === ringId() ? usedItemSlot : usedWithItemSlot;
  const keySlot = usedItemId === ringId() ? usedWithItemSlot : usedItemSlot;
  const inventory = player.getInventory(), items = inventory.getItems();
  const ring = items[ringSlot], key = items[keySlot];
  if (ring?.getId() !== ringId() || !key || keySlot === ringSlot) return;
  const id = key.getId();
  if (!keyData(id)) { player.sendMessage("That key cannot be added to your key ring."); return; }
  if (Object.keys(key.getMeta() ?? {}).length || key.isPresetItem()) {
    player.sendMessage("You cannot add that item to your key ring."); return;
  }
  const keys = contents(player);
  if (keys.includes(id)) { player.sendMessage("That key is already on your key ring."); return; }
  const before = inventory.getAmount(id);
  inventory.deleteAtSlot(keySlot, 1);
  if (inventory.getAmount(id) !== before - 1) return;
  keys.push(id);
  setContents(player, keys);
  player.sendMessage(`You add the ${nameOf(id).toLowerCase()} to your key ring.`);
}
function discarded({ player, item }) {
  if (item.getId() !== ringId()) return;
  // Wiki: dropping any copy loses the keys unless there is a ring in the bank.
  if (!banked(player)) setContents(player, []);
  selections.delete(player);
}
function login({ player }) {
  if (!carried(player) && !banked(player)) setContents(player, []);
}
function logout({ player }) { selections.delete(player); }
function keepOnDeath(event) { if (event.item.getId() === ringId()) event.keep = true; }
function dropWarning(request) {
  if (request.warned || request.itemId !== ringId() || contents(request.player).length === 0 || request.answered.includes("steel-key-ring:contents")) return;
  request.warned = true;
  Warning.confirm(core, request.player, {
    itemId: ringId(), text: "Dropping your key ring will lose its keys unless you have another key ring in the bank.",
    title: "Drop your key ring?", yes: "Yes, drop it.", no: "No, keep it.",
    proceed: () => request.proceed("steel-key-ring:contents"),
  });
}
function destroyPrompt(event) {
  if (event.item.getId() === ringId() && contents(event.player).length) event.warning = "The keys on your key ring will be lost.";
}
module.exports = function attach(pluginApi) {
  api = pluginApi; core = api.core;
  api.persistAttribute(KEYS_ATTRIBUTE, []);
  api.onItemAction("Steel key ring", { "Check-keys": open });
  api.onItemOnItem(use, { noted: false });
  api.onInterfaceActionClick(click);
  api.onCustomEvent("item:drop-warning", dropWarning);
  api.onCustomEvent("item:discarded", discarded);
  api.onCustomEvent("destroy-item:prompt", destroyPrompt);
  api.onCustomEvent("steel-key-ring:contains", contains);
  api.onShouldKeepItemOnDeath(keepOnDeath);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
};
