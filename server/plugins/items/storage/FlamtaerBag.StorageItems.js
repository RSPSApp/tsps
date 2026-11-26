/**
 * Flamtaer bag (https://oldschool.runescape.wiki/w/Flamtaer_bag; docs/storage-items.md): 60 timber
 * beams, 60 limestone bricks and 500 swamp paste. Repairs at the Flamtaer temple use its timber
 * beams and limestone bricks without withdrawing them (the quest asks through `storage:amount` /
 * `storage:take`). Only one bag can be owned; the catacombs' chests stop giving a second one in
 * Rewards.ShadesOfMortton. It is never kept on death and its contents are lost with it (Wiki),
 * which NeverKeptOnDeath handles for the item and the death hook below for the store.
 *
 * Fill, Check and Empty wording is ours (not captured); the plank refusal is the Wiki's trivia.
 */
const Storage = require("./Common.StorageItems");

const NAME = "Flamtaer bag";
const MESSAGE = {
  FILLED: "You fill the Flamtaer bag.",
  NOTHING: "You have nothing suitable to put in the Flamtaer bag.",
  FULL: "The Flamtaer bag is full.",
  EMPTY: "The Flamtaer bag is empty.",
  PLANKS: "The bag takes timber beams, not planks.",
};

function capacities() {
  const { TIMBER_BEAM, LIMESTONE_BRICK, SWAMP_PASTE } = Storage.core.ItemIdentifiers;
  return new Map([[TIMBER_BEAM, 60], [LIMESTONE_BRICK, 60], [SWAMP_PASTE, 500]]);
}

const family = {
  key: "flamtaer-bag",
  names: [NAME],
  pairs: [],
  usable: () => true,
  accepts: (id) => capacities().has(id),
  room: (_player, id, held) => (capacities().get(id) ?? 0) - (held.find((entry) => entry.id === id)?.amount ?? 0),
  bankEmpty: emptyToBank,
};

function fill({ player }) {
  const held = Storage.inventoryIds(player).filter(family.accepts);
  if (!held.length) {
    const hasPlank = Storage.inventoryIds(player).includes(Storage.core.ItemIdentifiers.PLANK);
    player.sendMessage(hasPlank ? MESSAGE.PLANKS : MESSAGE.NOTHING);
    return;
  }
  let moved = 0;
  for (const id of held) moved += Storage.fillFrom(player, family, id);
  player.sendMessage(moved > 0 ? MESSAGE.FILLED : MESSAGE.FULL);
}

function check({ player }) {
  const { TIMBER_BEAM, LIMESTONE_BRICK, SWAMP_PASTE } = Storage.core.ItemIdentifiers;
  const count = (id) => Storage.amountOf(player, family, id);
  player.sendMessage(`Timber beams: ${count(TIMBER_BEAM)} / Limestone bricks: ${count(LIMESTONE_BRICK)} / Swamp paste: ${count(SWAMP_PASTE)}`);
}

function empty({ player }) {
  if (Storage.core.Bank.isOpen(player)) return emptyToBank(player);
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  Storage.emptyToInventory(player, family);
}

function emptyToBank(player) {
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  Storage.emptyToBank(player, family);
}

/** Wiki: the bag is lost on death along with its contents (a banked bag keeps them). */
function deathDrops(event) {
  const bagId = Storage.core.CacheDefinitions.getObjId("flamtaer_bag");
  const carried = [...event.layout.inventory, ...event.layout.equipment].includes(bagId);
  if (carried) Storage.setContents(event.player, family, []);
}

module.exports = (api) => {
  Storage.register(family);
  api.onItemAction(NAME, { Fill: fill, Check: check, Empty: empty });
  api.onPlayerDeathDrops(deathDrops);
};

Object.assign(module.exports, { NAME, MESSAGE, family, _test: { deathDrops } });
