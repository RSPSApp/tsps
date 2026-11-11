/**
 * The Hunters' Guild meat and fur pouches (docs/storage-items.md; Wiki: Small meat pouch, Large
 * meat pouch, Fur pouch, Small/Medium/Large fur pouch).
 *
 * - A meat pouch holds 14 (small) or 28 (large) raw hunter meats, not raw bird meat; a fur pouch
 *   14, 21 or 28 hunter furs, not tatty fur or fur from combat (`data/storage-items.json`).
 * - Every pouch of a kind shares one store ("The pouch shares its inventory with every meat
 *   pouch the player owns"), so the largest one carried sets the room and an upgrade keeps it.
 * - Open, a pouch takes the meat or fur a Hunter catch gives (Hunter's `storage:gather`).
 * - A meat pouch empties into the bank while the bank is open, and into the inventory at a bank
 *   or on the Hunters' Guild's top floor; elsewhere "You can't empty your meat pouch here."
 *   (Wiki: Bank-use item). A fur pouch empties only into an open bank.
 * - Sewing them is Crafting's needle recipe (`skills/data/crafting.json`, leather).
 *
 * No capture covers them: every other line here is Ours.
 */
const Storage = require("./Common.StorageItems");

/** Wiki: Bank-use item, the line for both meat pouches outside a bank. */
const CANT_EMPTY_MEAT_HERE = "You can't empty your meat pouch here.";

/**
 * The Hunters' Guild's top floor (Wiki: Small meat pouch, "on the top floor of the Hunters' Guild"):
 * plane 2, inside the guild's walls there (cache map; the rope from the ground floor lands at
 * 1556, 3046, 2).
 */
const GUILD_TOP_FLOOR = { minX: 1552, maxX: 1564, minY: 3033, maxY: 3053, z: 2 };

const KINDS = [
  {
    key: "meat-pouch",
    noun: "meat",
    contents: "pieces of meat",
    data: "hunterMeat",
    tiers: [
      { names: ["Small meat pouch", "Small meat pouch (open)"], pair: ["hg_meatpouch_small", "hg_meatpouch_small_open"], holds: 14 },
      { names: ["Large meat pouch", "Large meat pouch (open)"], pair: ["hg_meatpouch_large", "hg_meatpouch_large_open"], holds: 28 },
    ],
    emptiesToInventory: true,
  },
  {
    key: "fur-pouch",
    noun: "fur",
    contents: "pieces of fur",
    data: "hunterFur",
    tiers: [
      { names: ["Small fur pouch", "Small fur pouch (open)"], pair: ["hg_furpouch_small", "hg_furpouch_small_open"], holds: 14 },
      { names: ["Medium fur pouch", "Medium fur pouch (open)"], pair: ["hg_furpouch_med", "hg_furpouch_med_open"], holds: 21 },
      { names: ["Large fur pouch", "Large fur pouch (open)"], pair: ["hg_furpouch_large", "hg_furpouch_large_open"], holds: 28 },
    ],
    emptiesToInventory: false,
  },
];

/** Ours (not captured): the lines for one kind of pouch. */
function messages(kind) {
  return {
    NOTHING: `You have no ${kind.noun} to put in the pouch.`,
    FULL: "Your pouch is full.",
    EMPTY: "Your pouch is empty.",
    HOLDS: (amount) => `Your pouch contains ${amount} ${amount === 1 ? kind.contents.replace("pieces", "piece") : kind.contents}.`,
    EMPTIED: "You empty your pouch.",
    SOME_LEFT: `You empty as much ${kind.noun} as you can carry.`,
    BANK_ONLY: `You can only empty your ${kind.noun} pouch into a bank.`,
  };
}

function inGuildTopFloor(player) {
  const here = player.getLocation?.();
  if (!here) return false;
  const { minX, maxX, minY, maxY, z } = GUILD_TOP_FLOOR;
  return here.getZ() === z && here.getX() >= minX && here.getX() <= maxX && here.getY() >= minY && here.getY() <= maxY;
}

/** A bank's tiles, as the chugging barrel asks them (LeagueMode's `league:near-bank`). */
function nearBank(player) {
  const query = { player, near: false };
  Storage.api.emitCustomEvent("league:near-bank", query);
  return query.near === true;
}

function makeKind(kind) {
  const lines = messages(kind);
  let accepted = null;
  const ids = () => (accepted ??= Storage.idsOf(Storage.DATA[kind.data]));

  /** The largest carried pouch's room; 0 with none carried. */
  function capacity(player) {
    const carried = Storage.carried(player, family).map(Storage.nameOf);
    return kind.tiers.reduce((most, tier) => (tier.names.some((name) => carried.includes(name)) ? Math.max(most, tier.holds) : most), 0);
  }

  const family = {
    key: kind.key,
    names: kind.tiers.flatMap((tier) => tier.names),
    pairs: kind.tiers.map((tier) => tier.pair),
    openNames: kind.tiers.map((tier) => tier.names[1]),
    accepts: (id) => ids().has(id),
    room: (player, _id, held) => capacity(player) - held.reduce((sum, entry) => sum + entry.amount, 0),
    gathers: (player, event) => event?.skill === Storage.core.Skill.HUNTER && Storage.hasOpen(player, family),
    gathered: (player) => {
      if (Storage.total(player, family) >= capacity(player)) player.sendMessage(lines.FULL);
    },
    bankEmpty: (player) => emptyIntoBank(player),
  };

  function fill({ player }) {
    const held = Storage.inventoryIds(player).filter(family.accepts);
    if (!held.length) {
      player.sendMessage(lines.NOTHING);
      return;
    }
    if (Storage.total(player, family) >= capacity(player)) {
      player.sendMessage(lines.FULL);
      return;
    }
    for (const id of held) Storage.fillFrom(player, family, id);
    if (Storage.total(player, family) >= capacity(player)) player.sendMessage(lines.FULL);
  }

  function check({ player }) {
    const amount = Storage.total(player, family);
    player.sendMessage(amount === 0 ? lines.EMPTY : lines.HOLDS(amount));
  }

  function emptyIntoBank(player) {
    if (Storage.total(player, family) === 0) {
      player.sendMessage(lines.EMPTY);
      return;
    }
    Storage.emptyToBank(player, family);
  }

  function empty({ player }) {
    if (Storage.core.Bank.isOpen(player)) {
      emptyIntoBank(player);
      return;
    }
    if (!kind.emptiesToInventory) {
      player.sendMessage(lines.BANK_ONLY);
      return;
    }
    if (!nearBank(player) && !inGuildTopFloor(player)) {
      player.sendMessage(CANT_EMPTY_MEAT_HERE);
      return;
    }
    if (Storage.total(player, family) === 0) {
      player.sendMessage(lines.EMPTY);
      return;
    }
    const { moved, left } = Storage.emptyToInventory(player, family);
    if (moved === 0) player.getInventory().full();
    else player.sendMessage(left > 0 ? lines.SOME_LEFT : lines.EMPTIED);
  }

  function toggle({ player, item }) {
    Storage.toggle(player, family, item);
  }

  /** Meat or fur used on its pouch fills it. */
  function useOnPouch(event) {
    const { player, usedItem, usedWithItem } = event;
    const ours = (item) => family.names.includes(Storage.nameOf(item));
    const pouch = ours(usedItem) ? usedItem : ours(usedWithItem) ? usedWithItem : null;
    const other = pouch === usedItem ? usedWithItem : usedItem;
    if (!pouch || !family.accepts(other?.getId?.())) return;
    event.handled = true;
    fill({ player });
  }

  return { family, lines, fill, check, empty, toggle, useOnPouch, capacity };
}

const UNITS = KINDS.map(makeKind);

module.exports = (api) => {
  for (const unit of UNITS) {
    Storage.register(unit.family);
    for (const name of unit.family.names) {
      api.onItemAction(name, { Fill: unit.fill, Empty: unit.empty, Check: unit.check, Open: unit.toggle, Close: unit.toggle });
    }
    api.onItemOnItem(unit.useOnPouch);
  }
};

Object.assign(module.exports, { KINDS, UNITS, CANT_EMPTY_MEAT_HERE, GUILD_TOP_FLOOR, inGuildTopFloor });
