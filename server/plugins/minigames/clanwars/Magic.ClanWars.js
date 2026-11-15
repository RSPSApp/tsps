/** Finite Standard combat casting; native rev242 enum917/918. See docs/clan-wars.md. */
const C = require("./Common.ClanWars");
const Tomes = require("../../items/elementaltomes/Common.ElementalTomes");

const STANDARD = 1;
const CLASSIC_F2P = 2;
const BINDING_ONLY = 3;
const DISABLED = 4;
const SUPPORT = "Standard combat: the 20 strike, bolt, blast, wave and surge spells plus manual Confuse, Weaken, Curse, Bind, Snare, Entangle, Vulnerability, Enfeeble and Stun (29 finite combat spells, not the complete Standard spellbook). Cast unarmed or with basic/elemental staves; use an empty offhand or an elemental tome. Other combat spells, casting weapons/offhands and magical specials are unsupported.";
const ACCOUNTING = "Runes, entangle sacks and tome charges are used normally and are not restored by safe death, returning or leaving. In Standard-enabled battles, death, leaving and battle end discard queued battle hits without refund.";
const BINDING_SUPPORT = "Binding only: Bind, Snare and Entangle. Cast manually with basic/elemental staves or no weapon, and an empty offhand or elemental tome. TSPS policy: other spell casts, including utility spells, are unsupported while joined to this battle. Magical specials and binding autocast are unsupported.";
const BINDING_ACCOUNTING = "Runes, entangle sacks and tome charges are used normally and are not restored. TSPS policy: joining, rejoining, elimination, leaving and battle end discard queued incoming and still-queued outgoing hits, including Bow/Melee and pre-entry hits, without refund. Applied effects and owner self/null-source pending damage are not reversed.";
const CLASSIC_SUPPORT = "Classic F2P combat: the 12 elemental strike, bolt and blast spells, Confuse, Weaken, Curse and Bind, cast manually. Existing basic/elemental staff and empty-offhand/tome limits are TSPS support, not retail F2P equipment rules. This is partial support: other casts, including Snare, Tele Block, undead-target spells, utilities, autocasts and magical specials, are unavailable while joined.";
const CLASSIC_ACCOUNTING = "Canonical runes, pouch/staff supplies and tome charges are used normally; entangle sacks fund Bind only in this spell set. TSPS policy: participation boundaries discard queued incoming and still-queued outgoing hits, including Bow/Melee and pre-entry hits, without refund. Applied effects and owner self/null-source pending damage are not reversed.";
const CLASSIC_REFUSAL = "Only the 12 elemental strike, bolt and blast spells, Confuse, Weaken, Curse and Bind are supported in Classic F2P combat.";
const CLASSIC_MANUAL_REFUSAL = "Classic F2P combat supports manual casts only; select a spell and cast it at an opposing fighter.";
const spells = new Set();
const classic = new Set();
const bindings = new Set();
const staves = new Map();

function initialize() {
  spells.clear();
  classic.clear();
  staves.clear();
  bindings.clear();
  for (const name of ["CONFUSE", "WEAKEN", "CURSE", "BIND", "SNARE", "ENTANGLE", "VULNERABILITY", "ENFEEBLE", "STUN"]) {
    const spell = C.core.CombatSpells[name];
    if (!spell || typeof spell.spellId !== "function") throw new Error(`Missing canonical ${name}`);
    spells.add(spell);
    if (["BIND", "SNARE", "ENTANGLE"].includes(name)) bindings.add(spell);
  }
  for (const element of ["WIND", "WATER", "EARTH", "FIRE"]) {
    for (const family of ["STRIKE", "BOLT", "BLAST", "WAVE", "SURGE"]) {
      const spell = C.core.CombatSpells[`${element}_${family}`];
      if (!spell || typeof spell.spellId !== "function") throw new Error(`Missing canonical ${element}_${family}`);
      spells.add(spell);
      if (["STRIKE", "BOLT", "BLAST"].includes(family)) classic.add(spell);
    }
  }
  for (const name of ["CONFUSE", "WEAKEN", "CURSE", "BIND"]) {
    const spell = C.core.CombatSpells[name];
    if (!spell || typeof spell.spellId !== "function") throw new Error(`Missing canonical ${name}`);
    classic.add(spell);
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

function enabled(mode) { return mode === STANDARD || mode === CLASSIC_F2P || mode === BINDING_ONLY; }
function support(mode) { return mode === CLASSIC_F2P ? CLASSIC_SUPPORT : mode === BINDING_ONLY ? BINDING_SUPPORT : SUPPORT; }
function accounting(mode) { return mode === CLASSIC_F2P ? CLASSIC_ACCOUNTING : mode === BINDING_ONLY ? BINDING_ACCOUNTING : ACCOUNTING; }
function supportedSpell(spell, mode = STANDARD) {
  return spell != null && (mode === CLASSIC_F2P ? classic : mode === BINDING_ONLY ? bindings : spells).has(spell);
}
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
  if (!enabled(rules.magic)) return "Magic is disabled in this Clan Wars battle.";
  if (!supportedSpell(spell, rules.magic)) return rules.magic === CLASSIC_F2P ? CLASSIC_REFUSAL : rules.magic === BINDING_ONLY
    ? "Only Bind, Snare and Entangle casts are supported in this Clan Wars battle."
    : "Only the 20 standard elemental spells plus manual Confuse, Weaken, Curse, Bind, Snare, Entangle, Vulnerability, Enfeeble and Stun are supported in this Clan Wars battle.";
  if (!supportedLoadout(player)) return "For Clan Wars casting, use basic/elemental staves or no weapon, and an empty offhand or an elemental tome.";
  // Area permission runs before MagicCombatMethod promotes an active autocast.
  // A native hand cast has an explicit castSpell even with autocast configured;
  // finished() clears it, so the next automatic turn is refused before payment.
  if (rules.magic === CLASSIC_F2P && player.getCombat().getCastSpell() == null) return CLASSIC_MANUAL_REFUSAL;
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

/** Explicit Standard/Binding-only participation policy; preserves the canonical queue helper scope. */
function discardQueuedHits(player, rules) {
  if (!enabled(rules.magic)) return;
  player.getCombat().getHitQueue().clearIncoming();
  C.core.HitQueue.dropHitsFrom(player);
  player.getCombat().setCastSpell(null);
}

module.exports = { STANDARD, CLASSIC_F2P, BINDING_ONLY, DISABLED, SUPPORT, ACCOUNTING, BINDING_SUPPORT, BINDING_ACCOUNTING, CLASSIC_SUPPORT, CLASSIC_ACCOUNTING, CLASSIC_REFUSAL, CLASSIC_MANUAL_REFUSAL,
  enabled, support, accounting, initialize,
  supportedSpell, supportedLoadout, selectedSpell, refusal, canAttack, discardQueuedHits };
