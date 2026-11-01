// Inventory "Open" on items that hand over their contents. data/openable-items.json holds them.
// OSRS Wiki: item packs give fixed amounts, noted unless already stackable; the loot entries are
// the "Casket", "Oyster", "Bag full of gems", "Hallowed sack", "Spoils of war", "Hunter kit" and
// "Dossier" tables. rsprox captures give the sounds, messages and the slot rewards land in; see
// docs/item-open-audit.md for those and for what else has Open and why it isn't here.
const DATA = require("./data/openable-items.json");

const PACK_SOUND = 3616;
const SPOILS_PET_RATE = 400;
const NO_SPACE = "You don't have enough inventory space.";
/** The main island, from dwarfcannon's Entrana area. The law altar and dungeon lie outside it. */
const ENTRANA = { minX: 2801, maxX: 2880, minY: 3328, maxY: 3392 };

let core;
let api;

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function rewardItem(name, amount, noted) {
  const id = core.ItemIdentifiers[name];
  const note = noted ? core.ItemDefinition.forId(id).getNoteId() : -1;
  return new core.Item(note >= 0 ? note : id, amount);
}

/** Every reward fits, each stack taking a new slot unless the inventory already holds it. */
function fits(inventory, rewards) {
  let free = inventory.getFreeSlots();
  for (const reward of rewards) {
    if (inventory.getAddableAmount(reward) < reward.getAmount()) return false;
    if (!inventory.contains(reward.getId())) free--;
  }
  return free >= 0;
}

/** Takes one from the clicked slot, leaving the rest of a stack. */
function takeOne(inventory, slot, item) {
  const left = item.getAmount() - 1;
  inventory.setItem(slot, left > 0 ? new core.Item(item.getId(), left) : new core.Item(-1, 0));
}

/**
 * Captures: a reward takes the slot the opened item left unless it joins a stack, and a batch of
 * unstackables takes the next free slots. forceAdd keeps the whole reward: what doesn't fit lands
 * under the player.
 */
function give(player, inventory, slot, reward) {
  const stackable = reward.getDefinition().isStackable();
  if (inventory.isSlotOccupied(slot) || (stackable && inventory.contains(reward.getId()))) {
    inventory.forceAdd(player, reward);
    return;
  }
  const inSlot = stackable ? reward.getAmount() : 1;
  inventory.setItem(slot, new core.Item(reward.getId(), inSlot));
  if (reward.getAmount() > inSlot) inventory.forceAdd(player, new core.Item(reward.getId(), reward.getAmount() - inSlot));
}

function openPack(pack, { player, item, slot }) {
  const inventory = player.getInventory();
  if (item.getDefinition().isNoted() || inventory.forSlot(slot) !== item) return false;
  player.getPacketSender().sendInterfaceRemoval();
  const rewards = pack.contents.map(({ item: name, amount }) => {
    const id = core.ItemIdentifiers[name];
    return rewardItem(name, amount, !core.ItemDefinition.forId(id).isStackable());
  });
  takeOne(inventory, slot, item);
  if (!fits(inventory, rewards)) {
    inventory.setItem(slot, item);
    player.sendMessage(NO_SPACE);
    return;
  }
  for (const reward of rewards) give(player, inventory, slot, reward);
  inventory.refreshItems();
  player.getPacketSender().sendSound(PACK_SOUND, 100, 0);
}

function entrySlots({ item: name, amount, noted }) {
  return noted || core.ItemDefinition.forId(core.ItemIdentifiers[name]).isStackable() ? 1 : amount[1];
}

/** The most slots one table can take: unstackables each take theirs, stacks only once per item. */
function tableSlots({ rolls, entries }) {
  const slots = entries.map(entrySlots);
  if (rolls === "all") return slots.reduce((sum, count) => sum + count, 0);
  const widest = Math.max(...slots);
  return widest > 1 ? rolls * widest : Math.min(rolls, entries.length);
}

function slotsNeeded(container) {
  return container.tables.reduce((sum, table) => sum + tableSlots(table), 0);
}

function onEntrana(player) {
  const location = player.getLocation();
  const { minX, maxX, minY, maxY } = ENTRANA;
  return location.getX() >= minX && location.getX() <= maxX && location.getY() >= minY && location.getY() <= maxY;
}

function rollEntry(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

function rollTable({ rolls, entries }) {
  if (rolls === "all") return entries;
  return Array.from({ length: rolls }, () => rollEntry(entries));
}

function rollPet(player, container) {
  if (container.name !== "Spoils of War" || Math.random() * SPOILS_PET_RATE >= 1) return;
  api.emitCustomEvent("pets:award", { player, itemId: core.ItemIdentifiers.LIL_CREATOR, source: "soul-wars:spoils-of-war", awarded: false });
}

/** The captured line's item: "some coins", "an uncut sapphire", or a bare "contract of ...". */
function rewardText(container, reward) {
  const name = reward.getDefinition().getName().toLowerCase();
  if (!container.article) return name;
  if (reward.getId() === core.ItemIdentifiers.COINS) return "some coins";
  return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
}

function itemBox(player, itemId, text) {
  player.sendMessage(text);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, itemId, text)));
}

function announce(player, container, first) {
  if (!container.message) return;
  const text = container.message.replace("{item}", rewardText(container, first));
  if (container.box) itemBox(player, first.getId(), text);
  else player.sendMessage(text);
}

function logRewards(player, rewards) {
  for (const reward of rewards) {
    const itemId = core.ItemDefinition.forId(reward.getId()).unNote();
    api.emitCustomEvent("collection-log:obtain", { player, itemId, amount: reward.getAmount() });
  }
}

function openLoot(container, { player, item, itemId, slot }) {
  const inventory = player.getInventory();
  const opensThisId = !container.items || container.items.some((name) => core.ItemIdentifiers[name] === itemId);
  if (!opensThisId || item.getDefinition().isNoted() || inventory.forSlot(slot) !== item) return false;
  player.getPacketSender().sendInterfaceRemoval();
  if (container.entrana && onEntrana(player)) {
    player.sendMessage(container.entrana);
    return;
  }
  const needed = slotsNeeded(container);
  const freed = item.getAmount() === 1 ? 1 : 0;
  if (inventory.getFreeSlots() + freed < needed) {
    itemBox(player, itemId, `You don't have enough inventory space to open that. You need at least ${needed} spaces.`);
    return;
  }
  takeOne(inventory, slot, item);
  const rewards = container.tables.flatMap(rollTable)
    .map(({ item: name, amount, noted }) => rewardItem(name, randomInt(amount[0], amount[1]), noted));
  for (const reward of rewards) give(player, inventory, slot, reward);
  inventory.refreshItems();
  if (container.sound) player.getPacketSender().sendSound(container.sound, 100, 0);
  announce(player, container, rewards[0]);
  logRewards(player, rewards);
  rollPet(player, container);
}

module.exports = {
  name: "OpenableItems",
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    for (const pack of DATA.packs) pluginApi.onItemAction(pack.name, { Open: openPack.bind(null, pack) });
    for (const container of DATA.loot) pluginApi.onItemAction(container.name, { Open: openLoot.bind(null, container) });
  },
};
