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
const { asPlayer } = require("./GearChecks.EquipmentEffects");

const BONUS_PERCENT = 10;
let core;
let staves = null;

/** Smoke staff ids from core.ItemIdentifiers, built on first use. */
function smokeStaves() {
  const ids = core.ItemIdentifiers;
  return (staves ??= new Set([ids.SMOKE_BATTLESTAFF, ids.MYSTIC_SMOKE_STAFF, ids.TWINFLAME_STAFF]));
}

/** The entity wields a smoke staff and `spell` is from the standard spellbook. */
function boosts(entity, spell) {
  const player = asPlayer(entity);
  if (!player || spell?.getSpellbook == null) return false;
  if (spell.getSpellbook() !== core.MagicSpellbook.NORMAL) return false;
  const weapon = player.getEquipment?.()?.getItems?.()?.[core.Equipment.WEAPON_SLOT];
  return smokeStaves().has(weapon?.getId?.() ?? -1);
}

function magicAccuracyPercent(entity, percent, spell) {
  return boosts(entity, spell) ? percent + BONUS_PERCENT : percent;
}

function magicDamageBonus(entity, permille, spell) {
  return boosts(entity, spell) ? permille + BONUS_PERCENT * 10 : permille;
}

module.exports = function registerSmokeStaffEffects(api) {
  core = api.core;
  api.registerMagicAccuracyPercentModifier(magicAccuracyPercent);
  api.registerMagicDamageBonusModifier(magicDamageBonus);
};

module.exports._test = { boosts, magicAccuracyPercent, magicDamageBonus, smokeStaves };
