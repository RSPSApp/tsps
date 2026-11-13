/**
 * The Hunters' Guild meat and fur pouches (docs/storage-items.md; Wiki: Small meat pouch, Large
 * meat pouch, Fur pouch, Small/Medium/Large fur pouch).
 *
 * - A meat pouch holds 14 (small) or 28 (large) raw hunter meats, not raw bird meat; a fur pouch
 *   14, 21 or 28 hunter furs, not tatty fur or fur from combat (`data/storage-items.json`).
 * - Every pouch of a kind shares one store, so the largest one carried sets the room; an upgrade
 *   keeps it and destroying the only pouch loses it (both captured).
 * - Open, a pouch takes the meat or fur a Hunter catch gives (Hunter's `storage:gather`).
 *
 * rsprox captures (pyre-fur-and-smallpouch-1 to -4, rev 242, small and large meat pouch):
 * - Fill and using a meat on the pouch put every meat carried in, silently; with none "You don't
 *   have any meats that can go into this pouch.", full "Your pouch is full.". Filling up from a
 *   catch says nothing.
 * - Check: "Your meat pouch is currently holding # meat." (also 0).
 * - Open / Close: "You open your small meat pouch." / "You close your large meat pouch.".
 * - Empty: an empty pouch "Your meat pouch is empty."; away from a bank "You can't empty your meat
 *   pouch here."; next to one (bank closed) into the inventory, silently; the bank panel's op9 into
 *   the bank, "You deposit some meat into your bank." (spam) with sound 2285.
 * - Destroy: "If you destroy this item, you will lose all contents stored within."
 * The fur pouches weren't captured: their lines follow the meat pouches' with "fur" (ours), and as the
 * Wiki says they empty only into a bank. The Hunters' Guild top floor is the Wiki's.
 */
const Storage = require("./Common.StorageItems");

/** The bank panel's deposit sound (captured: apple_splat). */
const DEPOSIT_SOUND = 2285;
const DESTROY_WARNING = "If you destroy this item, you will lose all contents stored within.";

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
    plural: "meats",
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
    plural: "furs",
    data: "hunterFur",
    tiers: [
      { names: ["Small fur pouch", "Small fur pouch (open)"], pair: ["hg_furpouch_small", "hg_furpouch_small_open"], holds: 14 },
      { names: ["Medium fur pouch", "Medium fur pouch (open)"], pair: ["hg_furpouch_med", "hg_furpouch_med_open"], holds: 21 },
      { names: ["Large fur pouch", "Large fur pouch (open)"], pair: ["hg_furpouch_large", "hg_furpouch_large_open"], holds: 28 },
    ],
    emptiesToInventory: false,
  },
];

/** The lines for one kind of pouch: captured for meat, the same with "fur" for the fur pouches (ours). */
function messages(kind) {
  return {
    NOTHING: `You don't have any ${kind.plural} that can go into this pouch.`,
    FULL: "Your pouch is full.",
    EMPTY: `Your ${kind.noun} pouch is empty.`,
    HOLDS: (amount) => `Your ${kind.noun} pouch is currently holding ${amount} ${kind.noun}.`,
    CANT_EMPTY: `You can't empty your ${kind.noun} pouch here.`,
    DEPOSITED: `You deposit some ${kind.noun} into your bank.`,
    OPENED: (name) => `You open your ${name.toLowerCase()}.`,
    CLOSED: (name) => `You close your ${name.toLowerCase()}.`,
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
    // Golem crafting consumes hunter furs directly from a carried fur pouch.
    // Meat remains available only through the pouch's existing inventory actions.
    usable: (id) => kind.key === "fur-pouch" && ids().has(id),
    room: (player, _id, held) => capacity(player) - held.reduce((sum, entry) => sum + entry.amount, 0),
    gathers: (player, event) => event?.skill === Storage.core.Skill.HUNTER && Storage.hasOpen(player, family),
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
  }

  function check({ player }) {
    player.sendMessage(lines.HOLDS(Storage.total(player, family)));
  }

  function emptyIntoBank(player) {
    if (Storage.total(player, family) === 0) {
      player.sendMessage(lines.EMPTY);
      return;
    }
    if (Storage.emptyToBank(player, family) <= 0) return;
    player.getPacketSender().sendTypedMessage(Storage.core.ChatType.SPAM, lines.DEPOSITED);
    Storage.core.Sounds.sendSound(player, new Storage.core.Sound(DEPOSIT_SOUND, 1, 0, 0));
  }

  function empty({ player }) {
    if (Storage.total(player, family) === 0) {
      player.sendMessage(lines.EMPTY);
      return;
    }
    if (Storage.core.Bank.isOpen(player)) {
      emptyIntoBank(player);
      return;
    }
    if (!kind.emptiesToInventory || (!nearBank(player) && !inGuildTopFloor(player))) {
      player.sendMessage(lines.CANT_EMPTY);
      return;
    }
    // Silent next to a bank (captured); a full inventory's line is ours.
    if (Storage.emptyToInventory(player, family).moved === 0) player.getInventory().full();
  }

  function toggle({ player, item }) {
    const name = closedName(item);
    const opening = !Storage.isOpen(family, item);
    Storage.toggle(player, family, item);
    player.sendMessage(opening ? lines.OPENED(name) : lines.CLOSED(name));
  }

  /** "Small meat pouch" for either copy. */
  function closedName(item) {
    return Storage.nameOf(item).replace(/ \(open\)$/, "");
  }

  function destroyPrompt(event) {
    if (family.names.includes(Storage.nameOf(event.item))) event.warning = DESTROY_WARNING;
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

  return { family, lines, fill, check, empty, toggle, useOnPouch, destroyPrompt, capacity };
}

const UNITS = KINDS.map(makeKind);

module.exports = (api) => {
  for (const unit of UNITS) {
    Storage.register(unit.family);
    for (const name of unit.family.names) {
      api.onItemAction(name, { Fill: unit.fill, Empty: unit.empty, Check: unit.check, Open: unit.toggle, Close: unit.toggle });
    }
    api.onItemOnItem(unit.useOnPouch);
    api.onCustomEvent("destroy-item:prompt", unit.destroyPrompt);
  }
};

Object.assign(module.exports, { KINDS, UNITS, DESTROY_WARNING, GUILD_TOP_FLOOR, inGuildTopFloor });
