/**
 * Infernal pickaxe (OSRS Wiki): a 1/3 chance that each ore is destroyed as it is
 * mined, granting half the Smithing experience a bar would give and using one of
 * 5,000 charges. Mining experience is unaffected. An empty pickaxe turns into its
 * uncharged form, which mines like a dragon pickaxe. Created and recharged by
 * using a smouldering stone (or dragon pickaxe) on it at 85 Smithing.
 */
const COMBUST_CHANCE = 3;
const MAX_CHARGES = 5000;
const CHARGES_META_KEY = "infernal-pickaxe";
const SMITHING_LEVEL = 85;

let api = null;
let core = null;
let ItemIds = null;
let unchargedByCharged = new Map();
let chargedIds = new Set();
let rechargeSourceIds = new Set();
/** Wiki: Smithing experience per combusted ore, built once ItemIds is attached. */
let oreXpByItem = new Map();

function oreXp(oreId) {
  return oreXpByItem.get(Number(oreId));
}

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY)?.charges);
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : MAX_CHARGES;
}

function findChargedPickaxe(player, pickaxeId) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  if (weapon?.getId() === pickaxeId) {
    return weapon;
  }
  return player.getInventory().getItems().find((item) => item?.getId() === pickaxeId) ?? null;
}

function useCharge(player, item) {
  const left = charges(item) - 1;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, { charges: left });
    return;
  }
  item.setId(unchargedByCharged.get(item.getId()) ?? item.getId());
  item.setMetaValue(CHARGES_META_KEY, undefined);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.sendMessage("Your infernal pickaxe has run out of charges.");
}

/** Returns true when the ore was incinerated instead of being added. */
function tryCombustOre(player, pickaxeId, oreId) {
  const xp = oreXp(oreId);
  if (!chargedIds.has(pickaxeId) || !(xp > 0) || Math.floor(Math.random() * COMBUST_CHANCE) !== 0) {
    return false;
  }
  const item = findChargedPickaxe(player, pickaxeId);
  if (!item) {
    return false;
  }
  player.getSkillManager().addExperiences(core.Skill.SMITHING, xp / 2);
  useCharge(player, item);
  return true;
}

/** Creation needs 85 Smithing; recharging an uncharged pickaxe only restores charges. */
function handlePickaxeCreation(player, sourceItem, pickaxeItem) {
  const smithing = player.getSkillManager().getCurrentLevel(core.Skill.SMITHING);
  if (smithing < SMITHING_LEVEL) {
    player.sendMessage(`You need a Smithing level of ${SMITHING_LEVEL} to do this.`);
    return true;
  }
  const creating = pickaxeItem.getId() === ItemIds.DRAGON_PICKAXE;
  if (creating) {
    player.getSkillManager().addExperiences(core.Skill.MINING, 200);
    player.getSkillManager().addExperiences(core.Skill.SMITHING, 350);
  }
  player.getInventory().deleteNumber(sourceItem.getId(), 1);
  pickaxeItem.setId(ItemIds.INFERNAL_PICKAXE);
  pickaxeItem.setMetaValue(CHARGES_META_KEY, { charges: MAX_CHARGES });
  player.getInventory().refreshItems();
  player.sendMessage(
    creating
      ? "You infuse the pickaxe with the smouldering stone; it bursts into flame."
      : "You recharge your infernal pickaxe."
  );
  return true;
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  ItemIds = core.ItemIds;
  unchargedByCharged = new Map([
    [ItemIds.INFERNAL_PICKAXE, ItemIds.INFERNAL_PICKAXE_UNCHARGED_],
    [ItemIds.INFERNAL_PICKAXE_OR_, ItemIds.INFERNAL_PICKAXE_UNCHARGED__2],
    [ItemIds.INFERNAL_PICKAXE_OR__3, ItemIds.INFERNAL_PICKAXE_UNCHARGED__4],
  ]);
  chargedIds = new Set(unchargedByCharged.keys());
  rechargeSourceIds = new Set([
    ItemIds.SMOULDERING_STONE,
    ItemIds.DRAGON_PICKAXE,
  ]);
  oreXpByItem = new Map([
    [ItemIds.BLURITE_ORE, 4],
    [ItemIds.COPPER_ORE, 3.6],
    [ItemIds.TIN_ORE, 3.6],
    [ItemIds.IRON_ORE, 5.5],
    [ItemIds.SILVER_ORE, 5.5],
    [ItemIds.COAL, 6],
    [ItemIds.GOLD_ORE, 9],
    [ItemIds.MITHRIL_ORE, 12],
    [ItemIds.ADAMANTITE_ORE, 18.75],
    [ItemIds.RUNITE_ORE, 25],
  ]);

  api.onItemOnItem((event) => {
    const pickaxeItem = event.usedItem?.getId?.() === ItemIds.INFERNAL_PICKAXE_UNCHARGED_
      ? event.usedItem
      : event.usedWithItem?.getId?.() === ItemIds.INFERNAL_PICKAXE_UNCHARGED_
        ? event.usedWithItem
        : null;
    const sourceItem = pickaxeItem === event.usedItem ? event.usedWithItem : event.usedItem;
    if (!pickaxeItem || !rechargeSourceIds.has(sourceItem?.getId?.())) {
      return;
    }
    event.handled = handlePickaxeCreation(event.player, sourceItem, pickaxeItem);
  });

  // Standard smouldering stone onto a tradeable dragon pickaxe creates the infernal pickaxe.
  api.onItemOnItem((event) => {
    const stoneItem = event.usedItem?.getId?.() === ItemIds.SMOULDERING_STONE
      ? event.usedItem
      : event.usedWithItem?.getId?.() === ItemIds.SMOULDERING_STONE
        ? event.usedWithItem
        : null;
    const pickaxeItem = stoneItem === event.usedItem ? event.usedWithItem : event.usedItem;
    if (!stoneItem || pickaxeItem?.getId?.() !== ItemIds.DRAGON_PICKAXE) {
      return;
    }
    event.handled = handlePickaxeCreation(event.player, stoneItem, pickaxeItem);
  });
}

module.exports = {
  attach,
  tryCombustOre,
  MAX_CHARGES,
  _test: { charges, useCharge, handlePickaxeCreation, oreXp: (oreId) => oreXp(oreId) },
};
