"use strict";

/**
 * The tombs' own consumables, usable only inside a raid.
 * Wiki: https://oldschool.runescape.wiki/w/Tombs_of_Amascut#Supplies
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

const CONSUME_ANIMATION = 829;
const ATTR_EFFECTS = "toa:supply-effects";

const SALTS_DURATION = 800;
const SALTS_REFRESH = 25;
const SCARAB_DURATION = 36;
const SCARAB_INTERVAL = 4;
const SCARAB_RESTORE = 8;
const SILK_DURATION = 100;
const SILK_INTERVAL = 5;
const SILK_HEAL = 5;
const ADRENALINE_DURATION = 250;
const HONEY_LOCUST_HEAL = 20;

function skills() {
  const { Skill } = Shared.core();
  return {
    combat: [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC],
    all: Skill.values().filter((skill) => skill !== Skill.HITPOINTS && skill !== Skill.PRAYER),
    Skill,
  };
}

function effectsOf(player) {
  let effects = player.getAttribute(ATTR_EFFECTS);
  if (!effects) {
    effects = { salts: 0, scarab: 0, silk: 0, adrenaline: 0, lastSpecial: null };
    player.setAttribute(ATTR_EFFECTS, effects);
  }
  return effects;
}

function boost(player, skill, percent, flat) {
  const manager = player.getSkillManager();
  const max = manager.getMaxLevel(skill);
  manager.setCurrentLevels(skill, Math.max(manager.getCurrentLevel(skill), max + Math.floor(max * percent) + flat));
}

function drain(player, skill, percent, flat) {
  const manager = player.getSkillManager();
  const max = manager.getMaxLevel(skill);
  manager.decreaseCurrentLevel(skill, Math.floor(max * percent) + flat, 0);
}

function restore(player, skill, percent, flat) {
  const manager = player.getSkillManager();
  const max = manager.getMaxLevel(skill);
  const current = manager.getCurrentLevel(skill);
  if (current < max) manager.setCurrentLevels(skill, Math.min(max, current + Math.floor(max * percent) + flat));
}

function heal(player, amount, overheal) {
  const { Skill } = Shared.core();
  const max = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
  const current = player.getHitpoints();
  const cap = max + overheal;
  if (current < cap) player.setHitpoints(Math.min(cap, current + amount));
}

/** Nectar: heals 15% + 3 past full, at the cost of 5% + 5 of each combat stat. */
function nectar(player) {
  const { combat, Skill } = skills();
  const max = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
  const amount = Math.floor(max * 0.15) + 3;
  heal(player, amount, amount);
  for (const skill of combat) drain(player, skill, 0.05, 5);
  player.sendMessage("You drink some of the nectar. It hurts! This was not made for mortals.");
}

/** Tears: restores stats and prayer, and some prayer to anyone standing next to you. */
function tears(player) {
  const { all, Skill } = skills();
  for (const skill of all) restore(player, skill, 0.25, 3);
  const prayerMax = player.getSkillManager().getMaxLevel(Skill.PRAYER);
  restoreAbove(player, Skill.PRAYER, Math.floor(prayerMax / 4) + 10);
  const raid = Raid.raidOf(player);
  for (const other of raid?.players ?? []) {
    if (other === player || raid.member(other).ghost || other.getLocation().getDistance(player.getLocation()) > 1) continue;
    const otherMax = other.getSkillManager().getMaxLevel(Skill.PRAYER);
    if (other.getSkillManager().getCurrentLevel(Skill.PRAYER) >= otherMax) continue;
    restoreAbove(other, Skill.PRAYER, Math.floor(otherMax / 10) + 10);
    other.sendMessage(`${Shared.displayName(player)} has restored some of your prayer points.`);
  }
}

function restoreAbove(player, skill, amount) {
  const manager = player.getSkillManager();
  const max = manager.getMaxLevel(skill);
  manager.setCurrentLevels(skill, Math.min(max, manager.getCurrentLevel(skill) + amount));
}

/** Ambrosia: everything restored, hitpoints and prayer over their maximum. */
function ambrosia(player) {
  const { all, Skill } = skills();
  const manager = player.getSkillManager();
  for (const skill of all) restore(player, skill, 1, 0);
  const hp = manager.getMaxLevel(Skill.HITPOINTS);
  player.setHitpoints(hp + Math.floor(hp * 0.25) + 2);
  const prayer = manager.getMaxLevel(Skill.PRAYER);
  manager.setCurrentLevels(Skill.PRAYER, Math.max(manager.getCurrentLevel(Skill.PRAYER), prayer) + Math.floor(prayer * 0.2) + 5);
  player.setRunEnergy(100);
  player.getPacketSender().sendRunEnergy?.();
  player.setPoisonDamage?.(0);
  player.setVenomed?.(false);
  player.sendMessage("You drink the ambrosia. You feel reinvigorated.");
}

function applySalts(player) {
  for (const skill of skills().combat) boost(player, skill, 0.16, 11);
}

function salts(player) {
  effectsOf(player).salts = SALTS_DURATION;
  applySalts(player);
  player.sendMessage("You crush the salts. Your heart rate increases.");
}

function scarab(player) {
  effectsOf(player).scarab = SCARAB_DURATION;
  player.sendMessage("You consume the blessed crystal scarab.");
}

function adrenaline(player) {
  const effects = effectsOf(player);
  effects.adrenaline = ADRENALINE_DURATION;
  effects.lastSpecial = player.getSpecialPercentage();
  player.sendMessage("You drink some of the potion, reducing the energy cost of your special attacks.");
}

function silkDressing(player) {
  effectsOf(player).silk = SILK_DURATION;
  player.sendMessage("You consume the silk dressing.");
}

function honeyLocust(player) {
  heal(player, HONEY_LOCUST_HEAL, HONEY_LOCUST_HEAL);
  player.sendMessage("It heals some health.");
}

/** item name -> { effect, chain (most doses first), food } */
function definitions() {
  const I = Shared.core().ItemIdentifiers;
  return {
    Nectar: { effect: nectar, chain: [I.NECTAR_4_, I.NECTAR_3_, I.NECTAR_2_, I.NECTAR_1_] },
    "Tears of elidinis": { effect: tears, chain: [I.TEARS_OF_ELIDINIS_4_, I.TEARS_OF_ELIDINIS_3_, I.TEARS_OF_ELIDINIS_2_, I.TEARS_OF_ELIDINIS_1_] },
    Ambrosia: { effect: ambrosia, chain: [I.AMBROSIA_2_, I.AMBROSIA_1_] },
    "Smelling salts": { effect: salts, chain: [I.SMELLING_SALTS_2_, I.SMELLING_SALTS_1_] },
    "Blessed crystal scarab": { effect: scarab, chain: [I.BLESSED_CRYSTAL_SCARAB_2_, I.BLESSED_CRYSTAL_SCARAB_1_] },
    "Liquid adrenaline": { effect: adrenaline, chain: [I.LIQUID_ADRENALINE_2_, I.LIQUID_ADRENALINE_1_] },
    "Silk dressing": { effect: silkDressing, chain: [I.SILK_DRESSING_2_, I.SILK_DRESSING_1_], food: true },
    "Honey locust": { effect: honeyLocust, chain: [I.HONEY_LOCUST], food: true },
  };
}

let supplyByItem = null;

function supplyFor(itemId) {
  if (!supplyByItem) {
    supplyByItem = new Map();
    for (const definition of Object.values(definitions())) {
      definition.chain.forEach((id, index) => supplyByItem.set(id, { ...definition, next: definition.chain[index + 1] ?? -1 }));
    }
  }
  return supplyByItem.get(itemId) ?? null;
}

function consume(event) {
  const { player, itemId, slot } = event;
  const supply = supplyFor(itemId);
  if (!supply) return false;
  const raid = Raid.raidOf(player);
  if (!raid || !Shared.inTombs(player.getLocation())) {
    player.sendMessage("You can only use this within the Tombs of Amascut.");
    return true;
  }
  const api = Shared.api();
  const allowed = supply.food ? api.emitCanEat(player, itemId) : api.emitCanDrink(player, itemId);
  if (allowed === false) return true;
  const { TimerKey, Animation, Item } = Shared.core();
  const timer = supply.food ? TimerKey.FOOD : TimerKey.POTION;
  if (player.getTimers().has(timer)) return true;
  player.getTimers().registers(timer, 3);
  player.getInventory().deleteAtSlot(slot, 1, false);
  if (supply.next !== -1) player.getInventory().setItem(slot, new Item(supply.next, 1));
  player.getInventory().refreshItems();
  player.performAnimation(new Animation(CONSUME_ANIMATION));
  supply.effect(player);
  return true;
}

/** Ticks the lasting effects: salts re-boost, scarab and silk restore, adrenaline refunds. */
function tickEffects({ player }) {
  const effects = player.getAttribute(ATTR_EFFECTS);
  if (!effects) return;
  const { Skill } = Shared.core();
  if (effects.salts > 0) {
    effects.salts--;
    if (effects.salts === SALTS_REFRESH) player.sendMessage("<col=ef1020>Your smelling salts effect has almost run out!");
    if (effects.salts === 0) {
      for (const skill of skills().combat) {
        player.getSkillManager().setCurrentLevels(skill, player.getSkillManager().getMaxLevel(skill));
      }
      player.sendMessage("<col=ff3045>The boost from the smelling salts has worn off!</col>");
    } else if (effects.salts % SALTS_REFRESH === 0) {
      applySalts(player);
    }
  }
  if (effects.scarab > 0) {
    effects.scarab--;
    if (effects.scarab % SCARAB_INTERVAL === 0) restoreAbove(player, Skill.PRAYER, SCARAB_RESTORE);
  }
  if (effects.silk > 0) {
    effects.silk--;
    if (effects.silk % SILK_INTERVAL === 0) heal(player, SILK_HEAL, 0);
  }
  if (effects.adrenaline > 0) {
    effects.adrenaline--;
    // Half of every special attack's energy comes back while the adrenaline lasts.
    const now = player.getSpecialPercentage();
    if (effects.lastSpecial !== null && now < effects.lastSpecial) {
      player.setSpecialPercentage(Math.min(100, now + Math.floor((effects.lastSpecial - now) / 2)));
    }
    effects.lastSpecial = player.getSpecialPercentage();
    if (effects.adrenaline === 0) {
      player.sendMessage("<col=ff3045>The energy cost of your special attacks has returned to normal.</col>");
    }
  }
  if (!effects.salts && !effects.scarab && !effects.silk && !effects.adrenaline) player.setAttribute(ATTR_EFFECTS, null);
}

/** Leaving the tombs ends every supply effect. */
function clearEffectsOutside({ player }) {
  if (!player.getAttribute(ATTR_EFFECTS) || Shared.inTombs(player.getLocation())) return;
  const effects = effectsOf(player);
  if (effects.salts > 0) {
    for (const skill of skills().combat) player.getSkillManager().setCurrentLevels(skill, player.getSkillManager().getMaxLevel(skill));
  }
  player.setAttribute(ATTR_EFFECTS, null);
}

/** A supply's doses and its family (most doses first), or null for anything else. */
function doses(itemId) {
  const supply = supplyFor(itemId);
  if (!supply) return null;
  return { chain: supply.chain, doses: supply.chain.length - supply.chain.indexOf(itemId) };
}

module.exports = function registerTombsSupplies(api) {
  Shared.bind(api);
  api.onItemFirstAction(consume);
  api.onPlayerProcess(tickEffects);
  api.onPlayerProcess(clearEffectsOutside);
};
module.exports.doses = doses;
