/**
 * Crystal armour (https://oldschool.runescape.wiki/w/Crystal_equipment#Crystal_armour).
 *
 * Each charged piece boosts the crystal bow and bow of Faerdhinen: helm
 * +5% accuracy / +2.5% damage, body +15% / +7.5%, legs +10% / +5% (30% / 15%
 * for the full set). Pieces start at 2,500 charges, lose one per successful
 * hit received and turn inactive at zero, losing their bonus. Crystal shards
 * add 100 charges each up to 20,000.
 */
const START_CHARGES = 2500;
const MAX_CHARGES = 20000;
const SHARD_CHARGES = 100;
const CHARGES_META_KEY = "crystal-armour";

const PIECES = [
  { slotName: "HEAD", itemName: "Crystal helm", activeIdName: "CRYSTAL_HELM", inactiveIdName: "CRYSTAL_HELM_INACTIVE_", accuracy: 0.05, damage: 0.025, label: "crystal helm" },
  { slotName: "BODY", itemName: "Crystal body", activeIdName: "CRYSTAL_BODY", inactiveIdName: "CRYSTAL_BODY_INACTIVE_", accuracy: 0.15, damage: 0.075, label: "crystal body" },
  { slotName: "LEG", itemName: "Crystal legs", activeIdName: "CRYSTAL_LEGS", inactiveIdName: "CRYSTAL_LEGS_INACTIVE_", accuracy: 0.10, damage: 0.05, label: "crystal legs" },
];

let core = null;
let inactiveByActive = new Map();
let activeByInactive = new Map();
let activeIds = new Set();
let crystalWeaponIds = new Set();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY)?.charges);
  if (Number.isFinite(saved)) {
    return Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved)));
  }
  return activeIds.has(item?.getId?.()) ? START_CHARGES : 0;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function useCharge(player, item) {
  const left = charges(item) - 1;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, { charges: left });
    return;
  }
  item.setId(inactiveByActive.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("Your crystal armour has run out of charges.");
}

function wornPieces(player) {
  const items = player.getEquipment().getItems();
  const worn = [];
  for (const piece of PIECES) {
    const slot = core.Equipment[`${piece.slotName}_SLOT`];
    const item = items[slot];
    if (item && activeIds.has(item.getId())) {
      worn.push({ piece, item });
    }
  }
  return worn;
}

function wieldingCrystalWeapon(player) {
  const weaponId = Number(player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1);
  return crystalWeaponIds.has(weaponId);
}

function bonus(player) {
  if (!wieldingCrystalWeapon(player)) {
    return { accuracy: 0, damage: 0 };
  }
  let accuracy = 0;
  let damage = 0;
  for (const { piece } of wornPieces(player)) {
    accuracy += piece.accuracy;
    damage += piece.damage;
  }
  return { accuracy, damage };
}

function applyCrystalAccuracy(entity, value) {
  if (!entity?.isPlayer?.()) {
    return value;
  }
  const { accuracy } = bonus(entity.getAsPlayer());
  return accuracy > 0 ? value * (1 + accuracy) : value;
}

function applyCrystalDamage(entity, baseHit) {
  if (!entity?.isPlayer?.()) {
    return baseHit;
  }
  const { damage } = bonus(entity.getAsPlayer());
  return damage > 0 ? baseHit * (1 + damage) : baseHit;
}

/** One charge per piece for each successful hit received (Wiki). */
function onIncomingDamage(entity, hitDamage) {
  if (!entity?.isPlayer?.() || !(hitDamage?.getDamage?.() > 0)) {
    return;
  }
  const player = entity.getAsPlayer();
  for (const { item } of wornPieces(player)) {
    useCharge(player, item);
  }
}

function chargesLabel(piece, item) {
  return `Your ${piece.label} has ${charges(item).toLocaleString("en-US")} charges left.`;
}

function checkCharges({ player, item }) {
  for (const piece of PIECES) {
    if (item.getId() === core.ItemIdentifiers[piece.activeIdName] || item.getId() === core.ItemIdentifiers[piece.inactiveIdName]) {
      player.sendMessage(chargesLabel(piece, item));
      return;
    }
  }
}

function addShardCharges(event) {
  const { player } = event;
  const piece = [event.usedItem, event.usedWithItem].find((candidate) => {
    const id = candidate?.getId?.();
    return activeIds.has(id) || activeByInactive.has(id);
  });
  if (!piece) {
    return;
  }
  const shardCount = player.getInventory().getAmount(core.ItemIdentifiers.CRYSTAL_SHARD);
  if (shardCount <= 0) {
    return;
  }
  const left = charges(piece);
  if (left >= MAX_CHARGES) {
    player.sendMessage("Your crystal armour cannot hold any more charges.");
    event.handled = true;
    return;
  }
  const shards = Math.min(shardCount, Math.ceil((MAX_CHARGES - left) / SHARD_CHARGES));
  player.getInventory().deleteNumber(core.ItemIdentifiers.CRYSTAL_SHARD, shards);
  if (activeByInactive.has(piece.getId())) {
    piece.setId(activeByInactive.get(piece.getId()));
  }
  piece.setMetaValue(CHARGES_META_KEY, { charges: Math.min(MAX_CHARGES, left + shards * SHARD_CHARGES) });
  refresh(player);
  player.sendMessage(`You add ${shards} crystal shard${shards === 1 ? "" : "s"} to the armour.`);
  event.handled = true;
}

function attach(pluginApi) {
  core = pluginApi.core;
  const I = core.ItemIdentifiers;
  const { CRYSTAL_BOW_ALL_WEAPON_IDS, isChargedCrystalBow } = require("../../src/main/typescript/elvarg/game/content/combat/ranged/CrystalBow");
  inactiveByActive = new Map();
  activeByInactive = new Map();
  for (const piece of PIECES) {
    const active = I[piece.activeIdName];
    const inactive = I[piece.inactiveIdName];
    inactiveByActive.set(active, inactive);
    activeByInactive.set(inactive, active);
  }
  activeIds = new Set(inactiveByActive.keys());
  crystalWeaponIds = new Set([
    I.BOW_OF_FAERDHINEN, I.BOW_OF_FAERDHINEN_2,
    I.BOW_OF_FAERDHINEN_C_, I.BOW_OF_FAERDHINEN_C__2, I.BOW_OF_FAERDHINEN_C__3,
    I.BOW_OF_FAERDHINEN_C__4, I.BOW_OF_FAERDHINEN_C__5,
  ]);
  for (const id of CRYSTAL_BOW_ALL_WEAPON_IDS) {
    if (isChargedCrystalBow(id)) {
      crystalWeaponIds.add(id);
    }
  }
}

module.exports = {
  name: "CrystalArmour",
  members: true,
  register(api) {
    attach(api);
    api.registerRangedAttackAccuracyModifier(applyCrystalAccuracy);
    api.registerRangedHitModifier(applyCrystalDamage);
    api.registerIncomingDamageModifier(onIncomingDamage);
    for (const piece of PIECES) {
      api.onItemAction(piece.itemName, { Check: checkCharges });
      api.onItemAction(`${piece.itemName} (inactive)`, { Check: checkCharges });
    }
    api.onItemOnItem("Crystal shard", "Crystal helm", addShardCharges, { noted: false });
    api.onItemOnItem("Crystal shard", "Crystal helm (inactive)", addShardCharges, { noted: false });
    api.onItemOnItem("Crystal shard", "Crystal body", addShardCharges, { noted: false });
    api.onItemOnItem("Crystal shard", "Crystal body (inactive)", addShardCharges, { noted: false });
    api.onItemOnItem("Crystal shard", "Crystal legs", addShardCharges, { noted: false });
    api.onItemOnItem("Crystal shard", "Crystal legs (inactive)", addShardCharges, { noted: false });
  },
  _test: { bonus, charges, useCharge, applyCrystalAccuracy, applyCrystalDamage, onIncomingDamage, PIECES, START_CHARGES, MAX_CHARGES, addShardCharges },
};
