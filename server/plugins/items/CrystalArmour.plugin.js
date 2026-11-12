/**
 * Crystal armour (https://oldschool.runescape.wiki/w/Crystal_equipment#Crystal_armour).
 *
 * Each charged piece boosts the crystal bow and bow of Faerdhinen: helm
 * +5% accuracy / +2.5% damage, body +15% / +7.5%, legs +10% / +5% (30% / 15%
 * for the full set). Pieces start at 2,500 charges, lose one per successful
 * hit received and turn inactive at zero, losing their bonus; an inactive
 * piece can still be worn. Crystal shards add 100 charges each up to 20,000
 * (CrystalShards.js). A worn elven or celestial signet gives each piece a 10%
 * chance to keep its charge.
 *
 * Every Elven Clan colour (CrystalRecolour.plugin.js) and the Deadman pieces
 * behave as the base piece. Pieces are sung at a singing bowl
 * (CrystalSinging.plugin.js), and Revert returns the seeds while forfeiting
 * the loaded charges and the colour.
 */
const { promptShards, chargesWith } = require("./CrystalShards");

const START_CHARGES = 2500;
const MAX_CHARGES = 20000;
const CHARGES_META_KEY = "crystal-armour";
const SIGNET_SAVE_CHANCE = 0.10;
/** Colours with their own ids: every Elven Clan but Meilyr, whose colour is the base piece's, and Deadman. */
const COLOURS = ["hefin", "ithell", "iorwerth", "trahaearn", "cadarn", "crwys", "amlodd", "deadman"];

const PIECES = [
  { slotName: "HEAD", itemName: "Crystal helm", gameval: "crystal_helmet", accuracy: 0.05, damage: 0.025, label: "crystal helm", seeds: 1 },
  { slotName: "BODY", itemName: "Crystal body", gameval: "crystal_chestplate", accuracy: 0.15, damage: 0.075, label: "crystal body", seeds: 3 },
  { slotName: "LEG", itemName: "Crystal legs", gameval: "crystal_platelegs", accuracy: 0.10, damage: 0.05, label: "crystal legs", seeds: 2 },
];

let core = null;
let inactiveByActive = new Map();
let activeByInactive = new Map();
let activeIds = new Set();
let pieceByItemId = new Map();
let crystalWeaponIds = new Set();
let signetIds = new Set();

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

function wearingSignet(player) {
  const ring = player.getEquipment().getItems()[core.Equipment.RING_SLOT];
  return signetIds.has(Number(ring?.getId?.() ?? -1));
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

/** One charge per piece for each successful hit received; the signet's 10% is rolled per piece (ours). */
function onIncomingDamage(entity, hitDamage, random = Math.random) {
  if (!entity?.isPlayer?.() || !(hitDamage?.getDamage?.() > 0)) {
    return;
  }
  const player = entity.getAsPlayer();
  const signet = wearingSignet(player);
  for (const { item } of wornPieces(player)) {
    if (signet && random() < SIGNET_SAVE_CHANCE) continue;
    useCharge(player, item);
  }
}

function chargesLabel(piece, item) {
  return `Your ${piece.label} has ${charges(item).toLocaleString("en-US")} charges remaining.`;
}

function checkCharges({ player, item }) {
  const piece = pieceByItemId.get(item?.getId?.());
  if (piece) {
    player.sendMessage(chargesLabel(piece, item));
  }
}

/** Asks how many shards to add; an inactive piece comes back in its own colour. */
function addShardCharges(event) {
  const { player } = event;
  const piece = [event.usedItem, event.usedWithItem].find((candidate) => {
    const id = candidate?.getId?.();
    return activeIds.has(id) || activeByInactive.has(id);
  });
  if (!piece) {
    return;
  }
  const shardId = core.ItemIdentifiers.CRYSTAL_SHARD;
  event.handled = true;
  if (player.getInventory().getAmount(shardId) <= 0) {
    return;
  }
  const left = charges(piece);
  if (left >= MAX_CHARGES) {
    player.sendMessage("Your crystal armour cannot hold any more charges.");
    return;
  }
  promptShards(player, piece, charges, shardId, (count) => {
    const now = charges(piece);
    if (activeByInactive.has(piece.getId())) {
      piece.setId(activeByInactive.get(piece.getId()));
    }
    piece.setMetaValue(CHARGES_META_KEY, { charges: chargesWith(now, count) });
    refresh(player);
  });
}

/** Revert: returns the crystal armour seeds but forfeits the loaded charges and any colour. */
function dismantle(event) {
  const { player, item } = event;
  const piece = pieceByItemId.get(item?.getId?.());
  if (!piece) {
    return;
  }
  const inventory = player.getInventory();
  const worn = event.interfaceId === core.Equipment.INVENTORY_INTERFACE_ID;
  if (inventory.getFreeSlots() + (worn ? 0 : 1) < piece.seeds) {
    player.sendMessage("You need more inventory space to revert the crystal armour.");
    return;
  }
  let slot = event.slot;
  if (worn) {
    if (!core.EquipPacketListener.unequip(player, event.slot)) {
      return;
    }
    slot = inventory.getItems().indexOf(item);
  }
  item.setMetaValue(CHARGES_META_KEY, undefined);
  inventory.deleteItem(item, slot);
  inventory.adds(core.ItemIdentifiers.CRYSTAL_ARMOUR_SEED, piece.seeds);
  refresh(player);
  player.sendMessage(`You revert the ${piece.label} to ${piece.seeds === 1 ? "a crystal armour seed" : `${piece.seeds} crystal armour seeds`}.`);
}

/** Every colour's active and inactive id of the piece: [active, inactive] pairs. */
function idPairs(piece) {
  const obj = (name) => core.CacheDefinitions.getObjId(name);
  const pairs = [[obj(piece.gameval), obj(`${piece.gameval}_inactive`)]];
  for (const colour of COLOURS) {
    pairs.push([obj(`${piece.gameval}_${colour}`), obj(`${piece.gameval}_inactive_${colour}`)]);
  }
  return pairs.filter(([active, inactive]) => active != null && inactive != null);
}

function attach(pluginApi) {
  core = pluginApi.core;
  const { CRYSTAL_BOW_ALL_WEAPON_IDS, BOW_OF_FAERDHINEN_IDS, isChargedCrystalBow } = require("../../src/main/typescript/elvarg/game/content/combat/ranged/CrystalBow");
  inactiveByActive = new Map();
  activeByInactive = new Map();
  pieceByItemId = new Map();
  for (const piece of PIECES) {
    for (const [active, inactive] of idPairs(piece)) {
      inactiveByActive.set(active, inactive);
      activeByInactive.set(inactive, active);
      pieceByItemId.set(active, piece);
      pieceByItemId.set(inactive, piece);
    }
  }
  activeIds = new Set(inactiveByActive.keys());
  crystalWeaponIds = new Set(BOW_OF_FAERDHINEN_IDS);
  for (const id of CRYSTAL_BOW_ALL_WEAPON_IDS) {
    if (isChargedCrystalBow(id)) {
      crystalWeaponIds.add(id);
    }
  }
  const { ELVEN_SIGNET, CELESTIAL_SIGNET, CELESTIAL_SIGNET_UNCHARGED_ } = core.ItemIdentifiers;
  signetIds = new Set([ELVEN_SIGNET, CELESTIAL_SIGNET, CELESTIAL_SIGNET_UNCHARGED_].filter((id) => id != null));
}

module.exports = {
  name: "CrystalArmour",
  description: "Crystal armour in every colour: boosts crystal bow and Faerdhinen accuracy and damage, loses charges when hit, takes shards and reverts to seeds.",
  members: true,
  register(api) {
    attach(api);
    api.registerRangedAttackAccuracyModifier(applyCrystalAccuracy);
    api.registerRangedHitModifier(applyCrystalDamage);
    api.registerIncomingDamageModifier((entity, hitDamage) => onIncomingDamage(entity, hitDamage));
    for (const piece of PIECES) {
      api.onItemAction(piece.itemName, { Check: checkCharges, Revert: dismantle });
      api.onItemAction(`${piece.itemName} (inactive)`, { Revert: dismantle });
      api.onItemOnItem("Crystal shard", piece.itemName, addShardCharges, { noted: false });
      api.onItemOnItem("Crystal shard", `${piece.itemName} (inactive)`, addShardCharges, { noted: false });
    }
  },
  _test: {
    bonus, charges, useCharge, applyCrystalAccuracy, applyCrystalDamage, onIncomingDamage,
    PIECES, START_CHARGES, MAX_CHARGES, addShardCharges, dismantle, checkCharges,
    pieceOf: (id) => pieceByItemId.get(id), inactiveOf: (id) => inactiveByActive.get(id), activeOf: (id) => activeByInactive.get(id),
  },
};
