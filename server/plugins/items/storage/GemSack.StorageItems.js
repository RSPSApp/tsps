/** Gem sack: combines the gem bag and tote stores (Jagex, 13 May 2026). */
const Storage = require("./Common.StorageItems");
const NAMES = ["Gem sack", "Open gem sack"];
const PER_GEM = 60;
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
  bankEmpty: (player) => Storage.emptyToBank(player, family),
};
function fill({ player }) {
  for (const id of Storage.inventoryIds(player).filter(family.accepts)) Storage.fillFrom(player, family, id);
}
function check({ player }) {
  player.sendMessage(gemIds().map((id) => `${Storage.itemName(id)}: ${Storage.amountOf(player, family, id)}`).join(" / "));
}
function empty({ player }) {
  if (Storage.core.Bank.isOpen(player)) return family.bankEmpty(player);
  Storage.emptyToInventory(player, family);
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
  if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < 81 || tote == null || bag == null
    || !inv.contains(I.IMMACULATE_MOLE_SKIN) || (!costume && (!inv.contains(I.NEEDLE) || !inv.contains(I.THREAD)))) return;
  const bagFamily = Storage.FAMILIES.get("gem-bag");
  const pouchFamily = Storage.FAMILIES.get("gem-pouch");
  const bagContents = checkedContents(player, bagFamily);
  const pouchContents = checkedContents(player, pouchFamily);
  const sackContents = checkedContents(player, family);
  const pouchIds = [obj("gem_pouch"), obj("gem_pouch_open"), obj("gem_satchel"), obj("gem_satchel_open"), ...totes];
  // This server formerly allowed duplicate lower tiers. Leave every item and store intact in that state.
  if (!bagContents || !pouchContents || !sackContents || sackContents.length
    || countOwned(player, bags) !== 1 || countOwned(player, pouchIds) !== 1 || Storage.owns(player, family)) {
    player.sendMessage("Empty or remove your other gem containers before upgrading.");
    return;
  }
  const combined = [...pouchContents, ...bagContents];
  if (new Set(combined.map((entry) => entry.id)).size !== combined.length) return;
  if (!costume) inv.deleteNumber(I.THREAD, 1);
  inv.deleteNumber(I.IMMACULATE_MOLE_SKIN, 1);
  inv.deleteNumber(tote, 1);
  inv.deleteNumber(bag, 1);
  inv.adds(obj("gem_sack"), 1);
  Storage.setContents(player, family, combined);
  Storage.setContents(player, pouchFamily, []);
  Storage.setContents(player, bagFamily, []);
  player.getSkillManager().addExperiences(Skill.CRAFTING, 300);
}
module.exports = (api) => {
  Storage.register(family);
  for (const name of NAMES) api.onItemAction(name, { Fill: fill, Open: toggle, Close: toggle, Check: check, Empty: empty });
  api.onItemOnItem(sew, { noted: false });
};
