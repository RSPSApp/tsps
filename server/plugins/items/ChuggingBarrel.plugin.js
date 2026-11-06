/**
 * Chugging barrel (https://oldschool.runescape.wiki/w/Chugging_barrel): assembled (30000) it holds up
 * to five potions, 100 doses each; it drinks one dose of every stored potion in one click. Dismantling
 * it loses the stored potions. Captured in rsprox 4236 (assemble, dismantle, the destroy confirm,
 * "can't store" and "no space" refusals), 4242 (drink, one dose of each potion per click).
 *
 * Not built yet: Open and the bank loadout interface (no capture of the interface), Empty, filling
 * from the bank, reordering, and the bank-only restriction (no capture of the rule's refusal message).
 */
const Potions = require("./Potions.plugin");

const CONTENTS_ATTRIBUTE = "chugging-barrel:potions";
/** Wiki: a maximum of 100 doses per potion, and up to five different potions. */
const DOSES_PER_POTION = 100;
const POTION_TYPES = 5;
/** Captured: the assemble and dismantle animation (rsprox 4236, line 3382). */
const ASSEMBLE_ANIMATION = 10097;
/** Captured: the drink animation (rsprox 4242, line 48334). */
const DRINK_ANIMATION = 11645;
const ASSEMBLED_NAME = "Chugging barrel";
const DISASSEMBLED_NAME = "Chugging barrel (disassembled)";

const MESSAGE = {
  /** Captured (4236). */
  ASSEMBLE: "You assemble the Chugging barrel.",
  DISASSEMBLE: "You disassemble the Chugging barrel.",
  NO_POTIONS: "You have no potions in your barrel that you can drink.",
  CANNOT_STORE: "You can't store that in the chugging barrel.",
  FULL: (name) => `Your chugging barrel doesn't have space to store any more ${name}.`,
  FILLED: (doses, name) => `Your chugging barrel has been filled with ${doses} ${doses === 1 ? "dose" : "doses"} of ${name}.`,
  DRINK: (name) => `You drink some of your ${name}.`,
  /** Captured (4236): the warning shown before dismantling a barrel that still holds potions. */
  DISMANTLE_WARNING: "Are you sure you want to disassemble the barrel?<br>The potions stored will be lost.",
};

let api = null;
let core = null;

function contents(player) {
  return player.getAttribute(CONTENTS_ATTRIBUTE) ?? {};
}

function save(player, next) {
  player.setAttribute(CONTENTS_ATTRIBUTE, next);
}

/** "Prayer potion(4)" -> "Prayer potion". */
function baseName(item) {
  return core.CacheDefinitions.getItem(item.getId()).name.replace(/\(\d+\)$/, "");
}

/** "Prayer potion(4)" -> "Prayer potion(1)", the form the barrel's messages use. */
function oneDoseName(item) {
  return `${baseName(item)}(1)`;
}

function setItem(player, item, id) {
  item.setId(id);
  player.getInventory().refreshItems();
}

function assemble({ player, item }) {
  setItem(player, item, core.ItemIdentifiers.CHUGGING_BARREL);
  player.performAnimation(new core.Animation(ASSEMBLE_ANIMATION));
  player.sendMessage(MESSAGE.ASSEMBLE);
}

function dismantle({ player, item }) {
  const next = () => {
    setItem(player, item, core.ItemIdentifiers.CHUGGING_BARREL_DISASSEMBLED_);
    player.performAnimation(new core.Animation(ASSEMBLE_ANIMATION));
    player.sendMessage(MESSAGE.DISASSEMBLE);
  };
  if (Object.keys(contents(player)).length === 0) {
    next();
    return;
  }
  player.getPacketSender().sendInterfaceRemoval();
  api.sendMultiChatboxPrompt(player, MESSAGE.DISMANTLE_WARNING, "Yes.", () => {
    save(player, {});
    next();
  });
}

function drink({ player }) {
  const stored = contents(player);
  const potions = Object.entries(stored).slice(0, POTION_TYPES);
  if (potions.length === 0) {
    player.sendMessage(MESSAGE.NO_POTIONS);
    return;
  }
  player.performAnimation(new core.Animation(DRINK_ANIMATION));
  for (const [key, store] of potions) {
    const dose = Potions.doseOf(store.itemId);
    if (!dose) continue;
    dose.potion.effect(player);
    player.sendMessage(MESSAGE.DRINK(store.name));
    if (store.doses - 1 > 0) stored[key] = { ...store, doses: store.doses - 1 };
    else delete stored[key];
  }
  save(player, stored);
}

function fill(player, item) {
  const dose = Potions.doseOf(item.getId());
  if (!dose) {
    player.sendMessage(MESSAGE.CANNOT_STORE);
    return;
  }
  const key = dose.potion.name;
  const stored = contents(player);
  const current = stored[key]?.doses ?? 0;
  if (!stored[key] && Object.keys(stored).length >= POTION_TYPES) {
    player.sendMessage(MESSAGE.CANNOT_STORE);
    return;
  }
  if (current + dose.doses > DOSES_PER_POTION) {
    player.sendMessage(MESSAGE.FULL(oneDoseName(item)));
    return;
  }
  stored[key] = { itemId: item.getId(), name: baseName(item).toLowerCase(), doses: current + dose.doses };
  save(player, stored);
  const inventory = player.getInventory();
  const slot = inventory.getItems().findIndex((candidate) => candidate?.getId?.() === item.getId());
  const replacement = dose.emptyItemId;
  inventory.setItem(slot, new core.Item(replacement, replacement === -1 ? 0 : 1)).refreshItems();
  player.sendMessage(MESSAGE.FILLED(dose.doses, oneDoseName(item)));
}

function useOnBarrel(event) {
  const { player, usedItem, usedWithItem } = event;
  const barrel = usedItem?.getId?.() === core.ItemIdentifiers.CHUGGING_BARREL ? usedItem : usedWithItem?.getId?.() === core.ItemIdentifiers.CHUGGING_BARREL ? usedWithItem : null;
  if (!barrel) return;
  event.handled = true;
  fill(player, barrel === usedItem ? usedWithItem : usedItem);
}

module.exports = {
  name: "ChuggingBarrel",
  members: true,
  dependsOn: ["Potions"],
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(CONTENTS_ATTRIBUTE, null);
    api.onItemAction(ASSEMBLED_NAME, { Drink: drink, Dismantle: dismantle });
    api.onItemAction(DISASSEMBLED_NAME, { Assemble: assemble });
    api.onItemOnItem(useOnBarrel);
  },
};
