/**
 * Crystal armour (https://oldschool.runescape.wiki/w/Crystal_equipment#Crystal_armour).
 *
 * Each charged piece boosts the crystal bow and bow of Faerdhinen: helm
 * +5% accuracy / +2.5% damage, body +15% / +7.5%, legs +10% / +5% (30% / 15%
 * for the full set). Pieces start at 2,500 charges, lose one per successful
 * hit received and turn inactive at zero, losing their bonus. Crystal shards
 * add 100 charges each up to 20,000.
 *
 * Pieces are sung from crystal armour seeds and shards at a singing bowl
 * (requiring Song of the Elves), and Revert returns the seeds while
 * forfeiting the loaded charges.
 */
const START_CHARGES = 2500;
const MAX_CHARGES = 20000;
const SHARD_CHARGES = 100;
const CHARGES_META_KEY = "crystal-armour";
const SONG_OF_THE_ELVES = "song_of_the_elves";
const SINGING_SEQUENCE = "prif_crystal_singing";
const SINGING_SOUND = 8;
const NO_MATERIALS = "You do not have all of the required materials and requirements to make anything.";
const LEVEL_TOO_LOW = "You need to be at least level {level} Crafting and Smithing to create anything through crystal singing.";
const SONG_LOCKED = "You need to complete Song of the Elves to create crystal armour.";

const PIECES = [
  { slotName: "HEAD", itemName: "Crystal helm", activeIdName: "CRYSTAL_HELM", inactiveIdName: "CRYSTAL_HELM_INACTIVE_", accuracy: 0.05, damage: 0.025, label: "crystal helm", seeds: 1, shards: 50, level: 70, xp: 2500 },
  { slotName: "BODY", itemName: "Crystal body", activeIdName: "CRYSTAL_BODY", inactiveIdName: "CRYSTAL_BODY_INACTIVE_", accuracy: 0.15, damage: 0.075, label: "crystal body", seeds: 3, shards: 150, level: 74, xp: 7500 },
  { slotName: "LEG", itemName: "Crystal legs", activeIdName: "CRYSTAL_LEGS", inactiveIdName: "CRYSTAL_LEGS_INACTIVE_", accuracy: 0.10, damage: 0.05, label: "crystal legs", seeds: 2, shards: 100, level: 72, xp: 5000 },
];

let core = null;
let pluginApi = null;
let inactiveByActive = new Map();
let activeByInactive = new Map();
let activeIds = new Set();
let pieceByItemId = new Map();
let crystalWeaponIds = new Set();

const activeId = (piece) => core.ItemIdentifiers[piece.activeIdName];
const inactiveId = (piece) => core.ItemIdentifiers[piece.inactiveIdName];

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
  const piece = pieceByItemId.get(item?.getId?.());
  if (piece) {
    player.sendMessage(chargesLabel(piece, item));
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

function songOfTheElvesComplete(player) {
  const request = { player, key: SONG_OF_THE_ELVES, complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function maxCraftable(player, piece) {
  const inventory = player.getInventory();
  return Math.min(
    Math.floor(inventory.getAmount(core.ItemIdentifiers.CRYSTAL_ARMOUR_SEED) / piece.seeds),
    Math.floor(inventory.getAmount(core.ItemIdentifiers.CRYSTAL_SHARD) / piece.shards),
  );
}

function meetsLevels(player, piece) {
  const skills = player.getSkillManager();
  return skills.getCurrentLevel(core.Skill.CRAFTING) >= piece.level
    && skills.getCurrentLevel(core.Skill.SMITHING) >= piece.level;
}

function openCreationMenu(player) {
  const items = PIECES.map(activeId);
  player.getPacketSender().sendCreationMenu(new core.CreationMenu("What would you like to make?", items, {
    execute: (itemId, amount) => {
      const piece = PIECES.find((candidate) => activeId(candidate) === itemId);
      if (piece) {
        makeArmour(player, piece, amount);
      }
    },
  }));
}

/** Sings up to `amount` pieces, consuming the seeds and shards for each. */
function makeArmour(player, piece, amount = 1) {
  if (!piece) {
    return false;
  }
  if (!songOfTheElvesComplete(player)) {
    player.sendMessage(SONG_LOCKED);
    return false;
  }
  const made = Math.min(Math.max(1, Math.floor(Number(amount) || 1)), maxCraftable(player, piece));
  if (made <= 0) {
    player.sendMessage(NO_MATERIALS);
    return false;
  }
  if (!meetsLevels(player, piece)) {
    player.sendMessage(LEVEL_TOO_LOW.replace("{level}", piece.level));
    return false;
  }
  const inventory = player.getInventory();
  inventory.deleteNumber(core.ItemIdentifiers.CRYSTAL_ARMOUR_SEED, piece.seeds * made);
  inventory.deleteNumber(core.ItemIdentifiers.CRYSTAL_SHARD, piece.shards * made);
  for (let index = 0; index < made; index++) {
    inventory.adds(activeId(piece), 1);
  }
  const sequence = core.CacheDefinitions?.getSeqId?.(SINGING_SEQUENCE);
  if (sequence != null) {
    player.performAnimation(new core.Animation(sequence));
  }
  player.getPacketSender().sendSound(SINGING_SOUND, 1, 0);
  const skills = player.getSkillManager();
  skills.addExperiences(core.Skill.SMITHING, piece.xp * made);
  skills.addExperiences(core.Skill.CRAFTING, piece.xp * made);
  inventory.refreshItems();
  player.sendMessage(`You sing the crystal into ${made === 1 ? `a ${piece.label}` : `${made} ${piece.label} pieces`}.`);
  return true;
}

/** Using a seed on a singing bowl opens the three armour recipes. */
function useSeedOnBowl(event) {
  const { player } = event;
  if (!songOfTheElvesComplete(player)) {
    player.sendMessage(SONG_LOCKED);
    return true;
  }
  if (!PIECES.some((piece) => maxCraftable(player, piece) > 0)) {
    player.sendMessage(NO_MATERIALS);
    return true;
  }
  openCreationMenu(player);
  return true;
}

/** Revert: returns the crystal armour seeds but forfeits the loaded charges. */
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

/** Inactive pieces have no stats, so they cannot be equipped until recharged. */
function canEquip(event) {
  const itemId = event?.item?.getId?.();
  if (!itemId || !activeByInactive.has(itemId)) {
    return;
  }
  event.allow = false;
  event.player.sendMessage("This crystal armour is inactive. Add crystal shards to it before wearing it.");
}

function attach(pluginApiInstance) {
  pluginApi = pluginApiInstance;
  core = pluginApi.core;
  const { CRYSTAL_BOW_ALL_WEAPON_IDS, BOW_OF_FAERDHINEN_IDS, isChargedCrystalBow } = require("../../src/main/typescript/elvarg/game/content/combat/ranged/CrystalBow");
  inactiveByActive = new Map();
  activeByInactive = new Map();
  pieceByItemId = new Map();
  for (const piece of PIECES) {
    const active = activeId(piece);
    const inactive = inactiveId(piece);
    inactiveByActive.set(active, inactive);
    activeByInactive.set(inactive, active);
    pieceByItemId.set(active, piece);
    pieceByItemId.set(inactive, piece);
  }
  activeIds = new Set(inactiveByActive.keys());
  crystalWeaponIds = new Set(BOW_OF_FAERDHINEN_IDS);
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
    api.onCanEquip(canEquip);
    for (const piece of PIECES) {
      api.onItemAction(piece.itemName, { Check: checkCharges, Revert: dismantle });
      api.onItemAction(`${piece.itemName} (inactive)`, { Revert: dismantle });
      api.onItemOnItem("Crystal shard", piece.itemName, addShardCharges, { noted: false });
      api.onItemOnItem("Crystal shard", `${piece.itemName} (inactive)`, addShardCharges, { noted: false });
    }
    api.onItemOnObject("Crystal armour seed", "Singing bowl", useSeedOnBowl, { noted: false });
  },
  _test: {
    bonus, charges, useCharge, applyCrystalAccuracy, applyCrystalDamage, onIncomingDamage,
    PIECES, START_CHARGES, MAX_CHARGES, addShardCharges, makeArmour, useSeedOnBowl,
    dismantle, canEquip, songOfTheElvesComplete,
  },
};
