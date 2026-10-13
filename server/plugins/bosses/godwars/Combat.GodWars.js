"use strict";

/**
 * The generals' and bodyguards' attacks, built from captured specs (rsprox): the NPC's sequence
 * and spot animation, the sound, the projectile with its launch cycle, arc and height, and how its
 * flight time grows per tile. The hit lands as the projectile does (whole ticks of 30 cycles),
 * a melee hit on the attack's own tick.
 *
 *   { style: "MELEE" | "RANGED" | "MAGIC", anim, sound?, maxHit?, minHit?, npcGfx?: [id, height],
 *     projectile?: { id, start, base, perTile, angle, progress, startHeight, endHeight },
 *     targetGfx?: { id, delay?: number | "impact", height? }, room?: true, accuracyAs?: style }
 *
 * `maxHit` defaults to the NPC's own; `room` hits every player in the chamber.
 */
const Common = require("./Common.GodWars");

const CYCLES_PER_TICK = 30;
const ROOM_SCAN_DISTANCE = 16;

function flightCycles(projectile, distance) {
  return projectile.base + projectile.perTile * distance;
}

function distanceBetween(npc, target) {
  const { Projectile } = Common.core;
  return Projectile.centreOf(npc).getDistance(Projectile.centreOf(target));
}

/** Players in the NPC's chamber: its instance, or the shared chamber's box. */
function chamberPlayers(npc) {
  const chamber = npc.__godwarsChamber;
  if (chamber) return chamber.area.getPlayers().filter((player) => player.getHitpoints() > 0);
  const faction = Common.factionForRoom(npc.getLocation());
  if (!faction) return [];
  return npc.getPlayersWithinDistance(ROOM_SCAN_DISTANCE).filter((player) => {
    const at = player.getLocation();
    return player.getHitpoints() > 0 && Common.inBox(faction.room, at.getX(), at.getY(), at.getZ());
  });
}

function sendProjectile(npc, target, projectile) {
  const { Projectile } = Common.core;
  const end = flightCycles(projectile, distanceBetween(npc, target));
  Projectile.createProjectile(npc, target, projectile.id, projectile.start, end, projectile.startHeight, projectile.endHeight)
    .withAngle(projectile.angle)
    .withProgress(projectile.progress)
    .sendProjectile();
  return end;
}

/**
 * A combat method that plays `choose(npc, target)`'s attack. `reach` is how far the NPC attacks
 * from (melee only: 1).
 */
function createMethod({ choose, reach = 1, onHit = null }) {
  const { CombatMethod, CombatType, CombatFactory, PendingHit, Animation } = Common.core;
  return class GodWarsCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.attack = null;
      this.landing = new Map();
    }

    type() {
      return CombatType[this.attack?.style ?? "MELEE"];
    }

    attackDistance() {
      return reach;
    }

    accuracyDefenceType(type) {
      return this.attack?.accuracyAs ? CombatType[this.attack.accuracyAs] : type;
    }

    start(npc, target) {
      const attack = choose(npc, target);
      this.attack = attack;
      this.landing.clear();
      if (!attack) return;
      npc.performAnimation(new Animation(attack.anim));
      if (attack.npcGfx) npc.performGraphic(Common.graphic(attack.npcGfx[0], { height: attack.npcGfx[1] ?? 0 }));
      if (attack.sound) Common.areaSound(npc, attack.sound);
      if (attack.say) npc.forceChat(attack.say);
      for (const victim of this.victims(npc, target)) {
        const end = attack.projectile ? sendProjectile(npc, victim, attack.projectile) : 0;
        this.landing.set(victim, end);
        if (attack.targetGfx) {
          const delay = attack.targetGfx.delay === "impact" ? end : attack.targetGfx.delay ?? 0;
          victim.performGraphic(Common.graphic(attack.targetGfx.id, { delay, height: attack.targetGfx.height ?? 0 }));
        }
      }
    }

    victims(npc, target) {
      if (!this.attack?.room) return [target];
      const players = chamberPlayers(npc);
      return players.includes(target) ? players : [target, ...players];
    }

    hits(npc, target) {
      const attack = this.attack;
      if (!attack) return [];
      const maxHit = attack.maxHit ?? npc.getDefinition().getMaxHit();
      const hits = [];
      for (const [victim, end] of this.landing) {
        const delay = attack.hitDelay ?? (attack.projectile ? Math.max(1, Math.floor(end / CYCLES_PER_TICK)) : 0);
        const hit = new PendingHit(npc, victim, this, delay);
        CombatFactory.applyStyleDamage(hit, maxHit, { minHit: attack.minHit ?? 0, bypassProtectionPrayer: attack.throughPrayer === true });
        hits.push(hit);
      }
      return hits;
    }

    handleAfterHitEffects(hit) {
      onHit?.(this.attack, hit);
    }
  };
}

/** One attack, always the same: a bodyguard. */
function single(attack, reach) {
  return createMethod({ choose: () => attack, reach });
}

/**
 * The general and bodyguards attack whoever is in their chamber on sight (Wiki); ordinary
 * aggression only reaches a few tiles from their spawns. `npcs` are the chamber's candidates.
 */
function engage(player, faction, npcs) {
  const { CombatFactory } = Common.core;
  for (const npc of npcs) {
    if (!npc || npc.getHitpoints() <= 0 || npc.getPrivateArea() !== player.getPrivateArea()) continue;
    if (npc.getId() !== faction.general && !faction.bodyguards.includes(npc.getId())) continue;
    if (CombatFactory.inCombat(npc) || npc.getCombat().getTarget()) continue;
    npc.getCombat().attack(player);
  }
}

/** Armadyl's followers can only be hit in melee with a halberd or salamander (Wiki). */
function deniesMelee(attacker, target, method) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return null;
  const faction = Common.factionForNpc(target.getId());
  if (faction?.key !== "armadyl" || method?.type?.() !== Common.core.CombatType.MELEE) return null;
  const { Equipment, ItemDefinition } = Common.core;
  const weapon = attacker.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
  const name = weapon > 0 ? ItemDefinition.forId(weapon)?.getName?.()?.toLowerCase?.() ?? "" : "";
  if (name.includes("halberd") || name.includes("salamander")) return null;
  attacker.sendMessage(`${target.getCurrentDefinition().getName()} is flying too high for you to attack using melee.`);
  return false;
}

module.exports = { createMethod, single, engage, deniesMelee, chamberPlayers };
