"use strict";

/**
 * The Corporeal Beast: its stomp, regeneration, damage reduction and the damage overlay's count.
 * The attacks themselves are in CorpAttacks.js; the dark energy core in DarkCore.*, which a
 * big hit here or an attack below 1,000 hitpoints can send out.
 *
 * Wiki ("Corporeal Beast/Strategies", Mechanics; the infobox):
 * - Every 7 ticks it checks for players under it and stomps them for 30-51, which no
 *   protection prayer stops.
 * - The same 7-tick timer: with nobody in the room it heals 75, then 10 more each time
 *   (75, 85, 95...); with 8 or more players in, it regenerates 5 per player.
 * - Drained stats come back once every 20 ticks.
 * - Melee and ranged deal half damage unless the weapon is Corpbane (spears, halberds,
 *   Osmumten's fang, the Thunder khopesh, King's barrage) on a stab style; magic is unaffected.
 * - It respawns 50 ticks after dying.
 * Capture: the overlay's "Damage: N" is varbit 999 (script 693); its overhead health bar is
 * type 22, 160 wide (no boss health HUD is opened).
 * RuneLite (gameval): the stomp is CORP_DOUBLE_STOMP (1686), as Offline_Scape uses; Offline_Scape's
 * "You get trampled under the Beast's massive legs." is the stomp's message.
 */

const Shared = require("./CorpShared");
const Attacks = require("./CorpAttacks");
const DarkCore = require("./DarkCore.CorporealBeast");

const RESPAWN_TICKS = 50;
const SIZE = 5;
const TIMER = 7;
const STOMP = { anim: 1686, min: 30, max: 51 };
const REGEN = { first: 75, step: 10, crowd: 8, perPlayer: 5 };
const STAT_RESTORE_TICKS = 20;
const CORPBANE = /\bspear\b|warspear|sunspear|halberd|osmumten's fang|thunder khopesh|king's barrage/i;
const STAB = 0;
const HEALTH_BAR = { id: 22, width: 160 };

/** Each Beast's own state: its 7-tick timer, its empty-room heal and who has hurt it how much. */
function stateOf(npc) {
  if (!npc.__corp) {
    npc.__corp = { ticks: 0, regen: 0, damage: new Map(), core: null };
    npc.setStatRestoreTicks?.(STAT_RESTORE_TICKS);
    npc.setHealthBar?.(HEALTH_BAR);
  }
  return npc.__corp;
}

function isCorp(npc) {
  return npc?.getId?.() === Shared.NPC.CORP;
}

function underneath(npc, player) {
  const at = npc.getLocation();
  const p = player.getLocation();
  return p.getX() >= at.getX() && p.getX() < at.getX() + SIZE && p.getY() >= at.getY() && p.getY() < at.getY() + SIZE;
}

function stomp(npc, players) {
  const { Animation, HitDamage, HitMask } = Shared.core();
  const victims = players.filter((player) => underneath(npc, player));
  if (victims.length === 0) return;
  npc.performAnimation(new Animation(STOMP.anim));
  for (const player of victims) {
    player.sendMessage("You get trampled under the Beast's massive legs.");
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(Shared.randomInclusive(STOMP.min, STOMP.max), HitMask.RED)]);
  }
}

/** Nobody in the room: 75, then 10 more each time; a crowd of 8+ adds 5 a player. */
function regenerate(npc, state, players) {
  if (players.length === 0) {
    npc.heal(REGEN.first + state.regen * REGEN.step);
    state.regen++;
    state.damage.clear();
    return;
  }
  state.regen = 0;
  if (players.length >= REGEN.crowd) npc.heal(REGEN.perPlayer * players.length);
}

function tickBeast(npc) {
  if (npc.getHitpoints() <= 0 || !npc.isRegistered()) return;
  const state = stateOf(npc);
  if (++state.ticks % TIMER !== 0) return;
  const players = Shared.playersNear(npc);
  stomp(npc, players);
  regenerate(npc, state, players);
}

function tick() {
  Shared.core().World.getNpcs().forEach((npc) => {
    if (isCorp(npc)) tickBeast(npc);
  });
}

/** Half damage from melee and ranged, unless a Corpbane weapon is used to stab. */
function halved(attacker, combatType) {
  const { CombatType, Equipment } = Shared.core();
  if (combatType === CombatType.MAGIC) return false;
  if (combatType !== CombatType.MELEE) return true;
  const weapon = attacker.getEquipment?.().getItems?.()[Equipment.WEAPON_SLOT];
  const name = weapon && weapon.getId() >= 0 ? weapon.getDefinition?.()?.getName?.() ?? "" : "";
  const stab = attacker.getFightType?.()?.getBonusType?.() === STAB;
  return !(stab && CORPBANE.test(name));
}

/** A blow on the Beast: the reduction, then the overlay's count for the attacker. */
function onHit({ npc, hit }) {
  if (!isCorp(npc)) return;
  const attacker = hit.getAttacker?.();
  if (!attacker?.isPlayer?.()) return;
  if (halved(attacker, hit.getCombatType())) {
    for (const part of hit.getHits()) part.setDamage(Math.floor(part.getDamage() / 2));
    hit.updateTotalDamage();
  }
  const damage = Math.min(hit.getTotalDamage(), npc.getHitpoints());
  const state = stateOf(npc);
  const total = (state.damage.get(attacker) ?? 0) + damage;
  state.damage.set(attacker, total);
  attacker.getPacketSender().sendVarbit(Shared.VARBIT.DAMAGE, total);
  DarkCore.beastHit(npc, hit.getTotalDamage());
}

/** It has died: everyone's count starts again. */
function onDeath({ npc }) {
  if (!isCorp(npc)) return;
  const state = stateOf(npc);
  for (const player of state.damage.keys()) player.getPacketSender().sendVarbit(Shared.VARBIT.DAMAGE, 0);
  state.damage.clear();
  state.regen = 0;
  state.ticks = 0;
  DarkCore.beastDied(npc);
}

function start() {
  Shared.core().NpcDefinition.forId(Shared.NPC.CORP).setRespawn(RESPAWN_TICKS);
  Shared.repeat("corporeal-beast", 1, () => tick());
}

module.exports = function registerCorporealBeast(api) {
  Shared.bind(api);
  api.registerNpcCombatMethodProvider([Shared.NPC.CORP], Attacks.method(), { singleton: false });
  api.onServerStartup(start);
  api.onNpcHitModify(onHit);
  api.onNpcDeath(onDeath);
};

Object.assign(module.exports, {
  RESPAWN_TICKS, HEALTH_BAR, TIMER, STOMP, REGEN, STAT_RESTORE_TICKS,
  start, tickBeast, stomp, regenerate, halved, onHit, onDeath, stateOf,
});
