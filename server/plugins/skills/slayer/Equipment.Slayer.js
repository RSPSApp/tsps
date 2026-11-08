"use strict";

/**
 * Protective Slayer equipment (data/slayer-gear.json, from the Wiki):
 * - A monster that punishes the unprotected (banshees without earmuffs, dust devils without a
 *   facemask...) lands its hit, at its unprotected max, and drains stats.
 * - Kurask and turoth only take damage from leaf-bladed weapons, broad ammunition and Magic Dart.
 * - A thrall deals them, and a Vyrewatch Sentinel, no damage ("magic:thrall-attack").
 * Content may give a Slayer helmet's protection without one ("slayer:helmet", a league relic).
 */
const GEAR = require("../data/slayer-gear.json");

let core = null;
let api = null;
/** The protection every Slayer helmet gives (data/slayer-gear.json). */
const HELMET = "Slayer helmet";
const byName = new Map();
const immuneNames = new Set(GEAR.immune.names);
const thrallImmuneNames = new Set(GEAR.thrallImmune);

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
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

/** Every recolour of the Slayer helmet, imbued or not, has the plain helmet's protection (Wiki: Slayer helmet). */
function isSlayerHelmet(name) {
  return name.toLowerCase().includes("slayer helmet");
}

function protectedFrom(player, monster) {
  const names = equippedNames(player);
  if (monster.protection.some((prefix) => names.some((name) => (prefix === HELMET ? isSlayerHelmet(name) : name.startsWith(prefix))))) return true;
  return monster.protection.includes(HELMET) && helmetGiven(player);
}

/** Whether content gives the player a Slayer helmet's effects without one ("slayer:helmet", a league relic). */
function helmetGiven(player) {
  const request = { player, worn: null };
  api?.emitCustomEvent("slayer:helmet", request);
  return request.worn === "imbued" || request.worn === "plain";
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
  if (monster.hit || monster.hitRange || monster.hitHitpointsPercent) event.forceMaxHit = true;
  if (monster.bypassPrayer) event.bypassProtectionPrayer = true;
}

/** A landed unprotected hit is the monster's unprotected max (run after prayers). */
function incomingDamage(victim, hitDamage, context = {}) {
  const monster = unprotectedRule(context.attacker, victim);
  const damage = monster ? unprotectedHit(monster, victim) : 0;
  if (damage) hitDamage.setDamage(damage);
}

/** The damage an unprotected player takes from this monster's hit, 0 when the rule sets none. */
function unprotectedHit(monster, player) {
  if (monster.hit) return monster.hit;
  if (monster.hitRange) {
    const [low, high] = monster.hitRange;
    return low + Math.floor(Math.random() * (high - low + 1));
  }
  if (monster.hitHitpointsPercent) {
    const level = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
    return Math.max(1, Math.floor((level * monster.hitHitpointsPercent) / 100));
  }
  return 0;
}

function hitResolved({ attacker, target }) {
  const monster = unprotectedRule(attacker, target);
  if (!monster) return;
  drain(target, monster);
  if (monster.forceChat) target.forceChat?.(monster.forceChat);
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

/** The item a monster needs worn to be harmed (GEAR.needsWorn), by its name. */
const needsWornByName = new Map((GEAR.needsWorn ?? []).flatMap((rule) => rule.names.map((name) => [name, rule])));

function npcHit({ npc, hit }) {
  const needs = needsWornByName.get(npcName(npc));
  if (needs) {
    const attacker = hit?.getAttacker?.();
    if (attacker?.isPlayer?.() && !equippedNames(attacker.getAsPlayer?.() ?? attacker).some((name) => needs.worn.includes(name))) {
      hit.setTotalDamage(0);
    }
    return;
  }
  if (!immuneNames.has(npcName(npc))) return;
  const attacker = hit?.getAttacker?.();
  if (!attacker?.isPlayer?.()) return;
  if (!hurtsImmune(attacker.getAsPlayer?.() ?? attacker, hit)) hit.setTotalDamage(0);
}

/** `magic:thrall-attack`: no damage to a monster thralls can't hurt (Wiki, Thrall; Vyrewatch Sentinel). */
function thrallAttack(event) {
  if (thrallImmuneNames.has(npcName(event?.target))) event.cancelled = true;
}

function attach(api) {
  api.onCombatHitRoll(hitRoll);
  api.registerIncomingDamageModifier(incomingDamage);
  api.onCombatHitResolved(hitResolved);
  api.onNpcHitModify(npcHit);
  api.onCustomEvent("magic:thrall-attack", thrallAttack);
}

module.exports = { init, attach, hitRoll, hitResolved, incomingDamage, npcHit, thrallAttack, protectedFrom, GEAR };
