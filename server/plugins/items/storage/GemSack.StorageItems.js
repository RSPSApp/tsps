/** Gem sack: combines the gem bag and tote stores (Jagex, 13 May 2026). */
const Storage = require("./Common.StorageItems");
const NAMES = ["Gem sack", "Open gem sack"];
const PER_GEM = 60;
// Sack-specific feedback is server wording; no sack transcript is retained.
const STRAIGHT_IN = "You put it straight into your open gem sack.";
const MESSAGE = {
  NO_GEMS: "You have nothing suitable for storing in the sack.",
  FULL: "Your sack is too full to hold all your gems.",
  EMPTY: "The gem sack is empty.",
};
let gems;
function gemIds() {
  gems ??= [...Storage.idsOf([...Storage.DATA.semiPreciousGems, ...Storage.DATA.gems])];
  return gems;
}
const family = {
  key: "gem-sack", names: NAMES, pairs: [["gem_sack", "gem_sack_open"]],
  openNames: ["Open gem sack"], accepts: (id) => gemIds().includes(id),
  room: (_player, id, held) => PER_GEM - (held.find((entry) => entry.id === id)?.amount ?? 0),
  gathers: (player, event) => Storage.hasOpen(player, family)
    && (Storage.FAMILIES.get("gem-bag").accepts(event.itemId) || event.skill === Storage.core.Skill.MINING),
  bankEmpty: emptyToBank,
};
function fill({ player }) {
  const held = Storage.inventoryIds(player).filter(family.accepts);
  if (!held.length) { player.sendMessage(MESSAGE.NO_GEMS); return; }
  const moved = held.reduce((sum, id) => sum + Storage.fillFrom(player, family, id), 0);
  if (moved === 0) player.sendMessage(MESSAGE.FULL);
}
function check({ player }) {
  player.sendMessage(gemIds().map((id) => {
    const gem = Storage.itemName(id).replace(/^Uncut /, "");
    return `${gem.charAt(0).toUpperCase()}${gem.slice(1)}: ${Storage.amountOf(player, family, id)}`;
  }).join(" / "));
}
function empty({ player }) {
  if (Storage.core.Bank.isOpen(player)) return emptyToBank(player);
  if (Storage.total(player, family) === 0) { player.sendMessage(MESSAGE.EMPTY); return; }
  Storage.emptyToInventory(player, family);
}
function emptyToBank(player) {
  if (Storage.total(player, family) === 0) { player.sendMessage(MESSAGE.EMPTY); return; }
  Storage.emptyToBank(player, family);
}
function toggle({ player, item }) { Storage.toggle(player, family, item); }

/** Refuse inconsistent old saves instead of dropping or duplicating entries during migration. */
function checkedContents(player, source) {
  const raw = player.getAttribute(Storage.attributeOf(source));
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const entries = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 2) return null;
    const [id, amount] = row;
    if (!Number.isInteger(id) || !Number.isInteger(amount) || amount <= 0 || amount > PER_GEM
      || !source.accepts(id) || seen.has(id)) return null;
    seen.add(id);
    entries.push({ id, amount });
  }
  return entries;
}
function countOwned(player, ids) {
  let count = 0;
  const countIn = (container) => {
    for (const item of container.getValidItems()) if (ids.includes(item.getId())) count += item.getAmount();
  };
  countIn(player.getInventory());
  countIn(player.getEquipment());
  const { Bank } = Storage.core;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX) countIn(player.getBank(tab));
  }
  return count;
}
function sew(event) {
  if (event.handled) return;
  const { player, usedItemId, usedWithItemId } = event;
  if (usedItemId === usedWithItemId) return;
  const { ItemIdentifiers: I, CacheDefinitions, Skill } = Storage.core;
  const obj = (name) => CacheDefinitions.getObjId(name);
  const totes = [obj("gem_tote"), obj("gem_tote_open")];
  const bags = [obj("gem_bag"), obj("gem_bag_open")];
  const unique = [...totes, ...bags, I.IMMACULATE_MOLE_SKIN];
  const pair = [usedItemId, usedWithItemId];
  const allowed = [...unique, I.NEEDLE, I.COSTUME_NEEDLE, I.THREAD];
  if (!pair.every((id) => allowed.includes(id)) || !pair.some((id) => unique.includes(id))) return;
  event.handled = true;
  const inv = player.getInventory();
  const tote = totes.find((id) => inv.contains(id));
  const bag = bags.find((id) => inv.contains(id));
  const costume = inv.contains(I.COSTUME_NEEDLE);
  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 81) {
    player.sendMessage("You need a Crafting level of 81 to make a gem sack.");
    return;
  }
  const missing = tote == null ? "gem tote" : bag == null ? "gem bag"
    : !inv.contains(I.IMMACULATE_MOLE_SKIN) ? "immaculate mole skin"
    : !costume && !inv.contains(I.NEEDLE) ? "needle"
    : !costume && !inv.contains(I.THREAD) ? "thread" : null;
  if (missing) {
    player.sendMessage(`You need ${missing} to make a gem sack.`);
    return;
  }
  const bagFamily = Storage.FAMILIES.get("gem-bag");
  const pouchFamily = Storage.FAMILIES.get("gem-pouch");
  const bagContents = checkedContents(player, bagFamily);
  const pouchContents = checkedContents(player, pouchFamily);
  const sackContents = checkedContents(player, family);
  const pouchIds = [obj("gem_pouch"), obj("gem_pouch_open"), obj("gem_satchel"), obj("gem_satchel_open"), ...totes];
  // This server formerly allowed duplicate lower tiers. Leave every item and store intact in that state.
  if (!bagContents || !pouchContents || !sackContents
    || countOwned(player, bags) !== 1 || countOwned(player, pouchIds) !== 1 || Storage.owns(player, family)) {
    player.sendMessage("Empty or remove your other gem containers before upgrading.");
    return;
  }
  // An unowned sack can leave a valid store behind; retain it when its replacement is sewn.
  const totals = new Map();
  for (const { id, amount } of [...pouchContents, ...bagContents, ...sackContents]) {
    const total = (totals.get(id) ?? 0) + amount;
    if (total > PER_GEM) {
      player.sendMessage("The gem sack cannot hold all your stored gems.");
      return;
    }
    totals.set(id, total);
  }
  const combined = [...totals].map(([id, amount]) => ({ id, amount }));
  if (!costume) inv.deleteNumber(I.THREAD, 1);
  inv.deleteNumber(I.IMMACULATE_MOLE_SKIN, 1);
  inv.deleteNumber(tote, 1);
  inv.deleteNumber(bag, 1);
  inv.adds(obj("gem_sack"), 1);
  Storage.setContents(player, family, combined);
  Storage.setContents(player, pouchFamily, []);
  Storage.setContents(player, bagFamily, []);
  player.getSkillManager().addExperiences(Skill.CRAFTING, 300);
  player.sendMessage("You sew a gem sack.");
}
module.exports = (api) => {
  Storage.register(family);
  for (const name of NAMES) api.onItemAction(name, { Fill: fill, Open: toggle, Close: toggle, Check: check, Empty: empty });
  api.onItemOnItem(sew, { noted: false });
};
Object.assign(module.exports, { STRAIGHT_IN });
