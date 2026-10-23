"use strict";
const Runtime = require("./Runtime.BeginnerTreasureTrails");
const MINOR_ATTRIBUTE = "treasure-trails:beginner-minor-case";
const MAJOR_ATTRIBUTE = "treasure-trails:beginner-major-case";
let api;
let core;

function capacity(player) { return 2 + (player.getAttribute(MINOR_ATTRIBUTE) === true ? 1 : 0) + (player.getAttribute(MAJOR_ATTRIBUTE) === true ? 1 : 0); }

function containers(player) { return [player.getInventory(), ...Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank?.(tab))]; }

function milestoneRewards(player, completed, milestones) {
  return milestones.filter(milestone => {
    if (!milestone.item_id || completed < milestone.completed) return false;
    const attribute = milestone.item_id === core.ItemIdentifiers.MINOR_BEGINNER_SCROLL_CASE ? MINOR_ATTRIBUTE : MAJOR_ATTRIBUTE;
    return player.getAttribute(attribute) !== true && !containers(player).some(container =>
      container?.getItems?.().some(item => item?.getId() === milestone.item_id && item.getAmount() > 0));
  }).map(milestone => ({ itemId: milestone.item_id, amount: 1, noted: false }));
}

function count(player) {
  const I = core.ItemIdentifiers;
  const ids = [I.CLUE_SCROLL_BEGINNER_, I.CLUE_BOTTLE_BEGINNER_, I.CLUE_NEST_BEGINNER_, I.CLUE_GEODE_BEGINNER_, I.SCROLL_BOX_BEGINNER_];
  return containers(player).reduce((sum, container) => sum + (container?.getItems?.() ?? []).reduce((sum, item) => sum + (item && ids.includes(item.getId()) ? Math.max(0, item.getAmount()) : 0), 0), 0);
}

function canReceive(request) {
  if (String(request.tier).toLowerCase() !== "beginner") return;
  request.allowed = count(request.player) < capacity(request.player);
}

function filterDrops(request) {
  if (!request.player || !Array.isArray(request.drops)) return;
  let remaining = Math.max(0, capacity(request.player) - count(request.player));
  for (let i = request.drops.length - 1; i >= 0; i--) {
    const drop = request.drops[i];
    if (drop.itemId !== Runtime.data().scroll && drop.itemId !== Runtime.data().box) continue;
    if (remaining < 1) request.drops.splice(i, 1);
    else { drop.amount = Math.min(drop.amount, remaining); remaining -= drop.amount; }
  }
}

function openBox(event) {
  const inventory = event.player.getInventory();
  const item = inventory.getItems()[event.slot];
  if (!item || item.getId() !== Runtime.data().box || item.getAmount() < 1 || event.item && item !== event.item) return false;
  if (item.getAmount() > 1 && inventory.isFull()) { event.player.sendMessage("You need an inventory space to open the scroll box."); return true; }
  inventory.deleteAtSlot(event.slot, 1);
  inventory.adds(Runtime.data().scroll, 1);
  return true;
}

function sync({ player }) {
  for (const [name, attribute] of [["scroll_case_beginner_minor", MINOR_ATTRIBUTE], ["scroll_case_beginner_major", MAJOR_ATTRIBUTE]]) {
    const varbit = core.CacheDefinitions.getVarbitId(name);
    if (varbit != null) player.getPacketSender().sendVarbit(varbit, player.getAttribute(attribute) === true ? 1 : 0);
  }
}

function openCase(event) {
  const item = event.player.getInventory().getItems()[event.slot];
  const minor = core.ItemIdentifiers.MINOR_BEGINNER_SCROLL_CASE;
  const major = core.ItemIdentifiers.MAJOR_BEGINNER_SCROLL_CASE;
  if (!item || ![minor, major].includes(item.getId()) || item.getAmount() < 1 || event.item && item !== event.item) return false;
  const attribute = item.getId() === minor ? MINOR_ATTRIBUTE : MAJOR_ATTRIBUTE;
  if (event.player.getAttribute(attribute) === true) {
    event.player.sendMessage("You have already increased your beginner clue capacity with this scroll case.");
    return true;
  }
  event.player.getInventory().deleteAtSlot(event.slot, 1);
  event.player.setAttribute(attribute, true);
  sync(event);
  event.player.sendMessage(`You can now hold ${capacity(event.player)} beginner clues.`);
  return true;
}

module.exports = function attachCapacity(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.persistAttribute(MINOR_ATTRIBUTE, false);
  api.persistAttribute(MAJOR_ATTRIBUTE, false);
  api.onCustomEvent("treasure-trails:can-receive", canReceive);
  api.onCustomEvent("npc-drops:roll", filterDrops);
  api.onItemAction("Scroll box (beginner)", { Open: openBox });
  api.onItemAction("Minor beginner scroll case", { Open: openCase });
  api.onItemAction("Major beginner scroll case", { Open: openCase });
  api.onPlayerLogin(sync);
};
Object.assign(module.exports, { MINOR_ATTRIBUTE, MAJOR_ATTRIBUTE, capacity, count, canReceive, filterDrops, openBox, openCase, milestoneRewards });
