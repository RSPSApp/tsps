"use strict";

/**
 * Protective Slayer equipment (data/slayer-gear.json, from the Wiki):
 * - A monster that punishes the unprotected (banshees without earmuffs, dust devils without a
 *   facemask...) lands its hit, at its unprotected max, and drains stats.
 * - Kurask and turoth only take damage from leaf-bladed weapons, broad ammunition and Magic Dart.
 */
const GEAR = require("../data/slayer-gear.json");

let core = null;
const byName = new Map();
const immuneNames = new Set(GEAR.immune.names);

function init(api) {
  core = api.core;
  for (const monster of GEAR.monsters) for (const name of monster.names) byName.set(name, monster);
}

function npcName(npc) {
  return (npc?.getCurrentDefinition?.() ?? npc?.getDefinition?.())?.getName?.() ?? "";
}

function equippedNames(player) {
  return (player.getEquipment?.()?.getItems?.() ?? [])
    .filter((item) => item && item.getId() > 0)
    .map((item) => String(core.ItemDefinition.forId(item.getId())?.getName?.() ?? ""));
}

function protectedFrom(player, monster) {
  const names = equippedNames(player);
  return monster.protection.some((prefix) => names.some((name) => name.startsWith(prefix)));
}

/** The monster's rule when it attacks this player unprotected, or null. */
function unprotectedRule(attacker, target) {
  if (!attacker?.isNpc?.() || !target?.isPlayer?.()) return null;
  const monster = byName.get(npcName(attacker));
  return monster && !protectedFrom(target, monster) ? monster : null;
}

function hitRoll(event) {
  const monster = unprotectedRule(event.attacker, event.target);
  if (!monster) return;
  event.forceAccurate = true;
  if (monster.hit) event.forceMaxHit = true;
  if (monster.bypassPrayer) event.bypassProtectionPrayer = true;
}

/** A landed unprotected hit is the monster's unprotected max (run after prayers). */
function incomingDamage(victim, hitDamage, context = {}) {
  const monster = unprotectedRule(context.attacker, victim);
  if (monster?.hit) hitDamage.setDamage(monster.hit);
}

function hitResolved({ attacker, target }) {
  const monster = unprotectedRule(attacker, target);
  if (monster) drain(target, monster);
}

function drain(player, monster) {
  const skills = player.getSkillManager();
  const set = (name, level) => {
    const skill = core.Skill[name];
    skills.setCurrentLevel(skill, Math.max(0, Math.min(skills.getCurrentLevel(skill), level)), true);
  };
  for (const [name, how] of Object.entries(monster.drainTo ?? {})) {
    set(name, how === "all" ? 0 : Math.floor(skills.getCurrentLevel(core.Skill[name]) / 2));
  }
  for (const name of monster.drain ?? []) {
    const skill = core.Skill[name];
    const amount = Math.max(1, Math.floor(skills.getMaxLevel(skill) * (monster.drainPercent ?? 10) / 100));
    set(name, skills.getCurrentLevel(skill) - amount);
  }
}

/** Whether this attack can hurt a kurask or turoth. */
function hurtsImmune(player, hit) {
  const { CombatType, Equipment, CombatSpells } = core;
  const type = hit.getCombatType?.();
  const item = (slot) => {
    const entry = player.getEquipment().getItems()[slot];
    return entry && entry.getId() > 0 ? String(core.ItemDefinition.forId(entry.getId())?.getName?.() ?? "") : "";
  };
  if (type === CombatType.MAGIC) {
    const spell = player.getCombat().getSelectedSpell?.() ?? player.getCombat().getPreviousCast?.();
    return GEAR.immune.spells.some((name) => CombatSpells[name] === spell);
  }
  if (type === CombatType.RANGED) {
    const ammo = item(Equipment.AMMUNITION_SLOT).toLowerCase();
    return GEAR.immune.ammo.some((word) => ammo.includes(word));
  }
  const weapon = item(Equipment.WEAPON_SLOT);
  return GEAR.immune.weapons.some((prefix) => weapon.startsWith(prefix));
}

function npcHit({ npc, hit }) {
  if (!immuneNames.has(npcName(npc))) return;
  const attacker = hit?.getAttacker?.();
  if (!attacker?.isPlayer?.()) return;
  if (!hurtsImmune(attacker.getAsPlayer?.() ?? attacker, hit)) hit.setTotalDamage(0);
}

function attach(api) {
  api.onCombatHitRoll(hitRoll);
  api.registerIncomingDamageModifier(incomingDamage);
  api.onCombatHitResolved(hitResolved);
  api.onNpcHitModify(npcHit);
}

module.exports = { init, attach, hitRoll, hitResolved, incomingDamage, npcHit, protectedFrom, GEAR };
