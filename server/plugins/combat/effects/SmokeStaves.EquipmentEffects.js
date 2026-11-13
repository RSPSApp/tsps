/**
 * Smoke battlestaff, mystic smoke staff and twinflame staff (Wiki: Smoke battlestaff, Mystic
 * smoke staff, Twinflame staff): wielded, they give "a 10% increase to Magic accuracy and
 * damage when casting spells from the standard spellbook", curses and other non-damaging
 * spells included (the Smoke battlestaff page's note citing Mod Ash), and nothing to the
 * other spellbooks. The bonus is not shown on the equipment stats.
 *
 * As the Wiki DPS calculator applies it: the accuracy adds 10 to the additive percentage the
 * salve amulet (i)/(ei) also adds to, and the damage adds 10% (100 permille) to the magic
 * damage bonus.
 */
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { MagicSpellbook } = require("../../../src/main/typescript/elvarg/game/model/MagicSpellbook");
const { asPlayer } = require("./GearChecks.EquipmentEffects");

const BONUS_PERCENT = 10;
const STAVES = new Set([
  ItemIdentifiers.SMOKE_BATTLESTAFF,
  ItemIdentifiers.MYSTIC_SMOKE_STAFF,
  ItemIdentifiers.TWINFLAME_STAFF,
]);

/** The entity wields a smoke staff and `spell` is from the standard spellbook. */
function boosts(entity, spell) {
  const player = asPlayer(entity);
  if (!player || spell?.getSpellbook?.() !== MagicSpellbook.NORMAL) return false;
  const weapon = player.getEquipment?.()?.getItems?.()?.[Equipment.WEAPON_SLOT];
  return STAVES.has(weapon?.getId?.() ?? -1);
}

function magicAccuracyPercent(entity, percent, spell) {
  return boosts(entity, spell) ? percent + BONUS_PERCENT : percent;
}

function magicDamageBonus(entity, permille, spell) {
  return boosts(entity, spell) ? permille + BONUS_PERCENT * 10 : permille;
}

module.exports = function registerSmokeStaffEffects(api) {
  api.registerMagicAccuracyPercentModifier(magicAccuracyPercent);
  api.registerMagicDamageBonusModifier(magicDamageBonus);
};

module.exports._test = { boosts, magicAccuracyPercent, magicDamageBonus, STAVES };
