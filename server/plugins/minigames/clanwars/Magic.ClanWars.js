/** Finite standard elemental casting; native rev242 enum917/918. See docs/clan-wars.md. */
const C = require("./Common.ClanWars");
const Tomes = require("../../items/elementaltomes/Common.ElementalTomes");

const STANDARD = 1;
const DISABLED = 4;
const SUPPORT = "Standard elemental spells only: the 20 strike, bolt, blast, wave and surge spells. Cast unarmed or with basic/elemental staves; use an empty offhand or an elemental tome. Other combat spells, casting weapons/offhands and magical specials are unsupported.";
const ACCOUNTING = "Runes and tome charges are used normally and are not restored by safe death, returning or leaving. In Standard-enabled battles, death, leaving and battle end discard queued battle hits without refund.";
const spells = new Set();
const staves = new Map();

function initialize() {
  spells.clear();
  staves.clear();
  for (const element of ["WIND", "WATER", "EARTH", "FIRE"]) {
    for (const family of ["STRIKE", "BOLT", "BLAST", "WAVE", "SURGE"]) {
      const spell = C.core.CombatSpells[`${element}_${family}`];
      if (!spell || typeof spell.spellId !== "function") throw new Error(`Missing canonical ${element}_${family}`);
      spells.add(spell);
    }
  }
  const names = ["STAFF", "MAGIC_STAFF", "BATTLESTAFF"];
  for (const element of ["AIR", "WATER", "EARTH", "FIRE"]) {
    names.push(`STAFF_OF_${element}`, `${element}_BATTLESTAFF`, `MYSTIC_${element}_STAFF`);
  }
  for (const element of ["LAVA", "MUD", "STEAM", "SMOKE", "MIST", "DUST"]) {
    names.push(`${element}_BATTLESTAFF`, `MYSTIC_${element}_STAFF`);
  }
  // These four cosmetic supplier identities are also explicit in canonical ElementalStaves.
  for (const element of ["LAVA", "STEAM"]) names.push(`${element}_BATTLESTAFF_3`, `MYSTIC_${element}_STAFF_3`);
  for (const name of names) {
    const id = C.core.ItemIdentifiers[name];
    if (!Number.isInteger(id)) throw new Error(`Missing canonical Clan Wars casting staff ${name}`);
    staves.set(id, true);
  }
}

function supportedSpell(spell) { return spell != null && spells.has(spell); }
function supportedLoadout(player) {
  const equipment = player.getEquipment();
  const weapon = equipment.get(C.core.Equipment.WEAPON_SLOT)?.getId() ?? -1;
  const offhand = equipment.get(C.core.Equipment.SHIELD_SLOT)?.getId() ?? -1;
  return (weapon <= 0 || C.core.ItemAliases.lookup(staves, weapon) === true)
    && (offhand <= 0 || Tomes.getDefinition(offhand) != null);
}
function selectedSpell(player) {
  const combat = player.getCombat();
  return combat.getCastSpell()
    ?? (C.core.Autocasting.isActive(player) ? combat.getAutocastSpell() : null);
}
function refusal(player, spell, rules) {
  if (rules.magic !== STANDARD) return "Magic is disabled in this Clan Wars battle.";
  if (!supportedSpell(spell)) return "Only the 20 standard elemental combat spells are supported in this Clan Wars battle.";
  if (!supportedLoadout(player)) return "For Clan Wars casting, use basic/elemental staves or no weapon, and an empty offhand or an elemental tome.";
  return null;
}
function canAttack(player, method, rules) {
  const message = refusal(player, selectedSpell(player), rules);
  if (message) { player.sendMessage(message); return false; }
  if (method !== C.core.CombatFactory.MAGIC_COMBAT) {
    player.sendMessage("Powered casts and magical specials are unsupported in this Clan Wars battle.");
    return false;
  }
  return true;
}

/** Participation/life boundary for Standard matches, not a rune or charge refund producer. */
function discardQueuedHits(player, rules) {
  if (rules.magic !== STANDARD) return;
  player.getCombat().getHitQueue().clearIncoming();
  C.core.HitQueue.dropHitsFrom(player);
  player.getCombat().setCastSpell(null);
}

module.exports = { STANDARD, DISABLED, SUPPORT, ACCOUNTING, initialize,
  supportedSpell, supportedLoadout, selectedSpell, refusal, canAttack, discardQueuedHits };
