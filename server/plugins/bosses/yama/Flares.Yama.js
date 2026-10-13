/**
 * Void flares, as captured: a pair spawns on one of two pairs of tiles (12135), its charge bar
 * (headbar 75) filling from 3 ticks in; 26 ticks after spawning a flare still standing explodes
 * (12136, a red or blue spot), heals Yama and hits the challenger a tick later, then is gone.
 * In phases 1 and 2 one is fire and one shadow (which is which varies); phase 3's are shadow,
 * with half the hitpoints and half the blast (Wiki). How hard they hit and heal shrinks with
 * the hitpoints they have left, and a glyph of their element blocks them (Wiki).
 */
const Common = require("./Common.Yama");
const Hits = require("./Hits.Yama");
const Glyphs = require("./Glyphs.Yama");

/** Spawns `count` flares on free flare tiles (a pair's tiles first). */
function spawn(fight, count) {
  const { flares } = Common.data;
  const phase = String(fight.phase);
  const pair = flares.pairs[Math.floor(Math.random() * flares.pairs.length)];
  const taken = new Set(fight.flares.map((flare) => flare.tile.join()));
  const tiles = [...pair, ...flares.pairs.flat()].filter((tile, i, all) => all.findIndex((t) => t.join() === tile.join()) === i);
  const free = tiles.filter((tile) => !taken.has(tile.join())).slice(0, Math.min(count, flares.maxActive - fight.flares.length));
  const elements = fight.phase === 3 ? free.map(() => "shadow") : (Math.random() < 0.5 ? ["fire", "shadow"] : ["shadow", "fire"]);
  free.forEach((tile, i) => {
    const npc = fight.session.spawn(flares.npc, [...tile, 0], "SOUTH");
    if (!npc) return;
    const hitpoints = flares.hitpoints[phase];
    npc.setHitpoints?.(hitpoints);
    npc.__yamaFlare = true;
    npc.setAttribute("combat:demonbane-vulnerability", flares.demonbaneVulnerability);
    npc.setFlag?.("combat:no-retaliate", true);
    npc.getMovementQueue().setBlockMovement(true);
    npc.performAnimation(new Common.core.Animation(flares.spawnAnim));
    const flare = { npc, tile, element: elements[i] ?? "shadow", spawned: fight.tick, hitpoints };
    fight.flares.push(flare);
    fight.at(flares.chargeBar.afterTicks, () => {
      if (npc.isRegistered()) npc.showHeadbar(flares.chargeBar.id, { fill: 0, endFill: flares.chargeBar.fill, duration: flares.chargeBar.cycles });
    });
    fight.at(flares.explodeTicks, () => explode(fight, flare));
  });
}

function explode(fight, flare) {
  const { flares } = Common.data;
  const { npc } = flare;
  if (!npc.isRegistered() || npc.getHitpoints() <= 0 || !fight.flares.includes(flare)) return;
  const phase = String(fight.phase);
  const left = Math.max(0, npc.getHitpoints()) / flare.hitpoints;
  const [min, max] = flares.damage[phase];
  npc.performAnimation(new Common.core.Animation(flares.explodeAnim));
  npc.performGraphic(Hits.graphic(flares.explodeSpot[flare.element]));
  const heal = Math.floor(flares.heal[phase] * left);
  const yama = fight.yama;
  if (yama && heal > 0) yama.heal(heal);
  fight.player.performGraphic(Hits.graphic(flares.playerImpact[flare.element], { delay: flares.playerImpact.delay }));
  fight.at(1, () => {
    if (Glyphs.immune(fight, flare.element)) Glyphs.blocked(fight, flare.element);
    else Hits.damage(fight.player, Math.round(Hits.randomInt(min, max) * left));
  });
  fight.at(flares.removeAfterTicks, () => remove(fight, flare));
}

function remove(fight, flare) {
  fight.flares = fight.flares.filter((other) => other !== flare);
  if (flare.npc.isRegistered()) Common.api.removeNpc(flare.npc);
}

/** All flares go without exploding (the phase change, the end of the fight). */
function clear(fight) {
  for (const flare of [...fight.flares]) remove(fight, flare);
}

/** A flare killed by the player: gone from the fight. */
function onFlareDeath(event) {
  const fight = event.npc?.__yamaSession?.fight;
  if (!event.npc?.__yamaFlare || !fight) return;
  fight.flares = fight.flares.filter((flare) => flare.npc !== event.npc);
}

/** Flares give nothing (they are spells). */
function noLoot(event) {
  if (event.npc?.__yamaFlare) event.drops.length = 0;
}

/** Thrown weapons and chinchompas aren't standard ranged weapons (Wiki). */
const NOT_STANDARD_RANGED = /dart|knife|thrownaxe|chinchompa|blowpipe|toktz-xil-ul/i;

/** Magic and standard ranged weapons always land their max hit on a flare (Wiki: Void Flare). */
function flareHitRoll(roll) {
  if (!roll.target?.__yamaFlare || !roll.attacker?.isPlayer?.()) return;
  const { CombatType, Equipment, ItemDefinition } = Common.core;
  let sure = roll.combatType === CombatType.MAGIC;
  if (roll.combatType === CombatType.RANGED) {
    const weapon = roll.attacker.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() ?? -1;
    const name = weapon > 0 ? ItemDefinition.forId(weapon)?.getName?.() ?? "" : "";
    sure = !NOT_STANDARD_RANGED.test(name);
  }
  if (!sure) return;
  roll.forceAccurate = true;
  roll.forceMaxHit = true;
}

function attachFlares(api) {
  api.onCombatHitRoll(flareHitRoll);
  api.onNpcDeath(onFlareDeath);
  api.onCustomEvent("npc-drops:roll", noLoot);
}

module.exports = { attachFlares, spawn, clear };
