"use strict";

/**
 * Inside the arena: the gap out, the burrow hole, the rules on hitting the Doom and its larvae,
 * and what death and logging out do to a run.
 *
 * Wiki: death sends the player back to the lobby, where their grave is (this server has no
 * graves, so what would drop lands there); a melee charge is stopped only by melee, which
 * always hits and adds a fifth of the Strength bonus; larvae take one damage a hit unless it
 * is demonbane; two destroyed volatile earth make the earthen shield. Larvae and volatile earth
 * can be attacked on cooldown; attacks while the Doom charges (melee during the melee charge, any
 * while burrowed) are 100% accurate.
 * Capture (a demonbane bow, speed 4): a larva shot on cooldown leaves the timer as it was (Doom
 * 359, larva 360, Doom 363), and one shot off cooldown makes the next attack wait 1 tick (larva
 * 350, Doom 351); volatile earth shot on cooldown sets the bow's full delay (Doom 246, earth 248
 * and 250, Doom 254). Wiki: other weapons on larvae get their normal delay. The capture's shots on
 * cooldown were each at a new target (earth 248 and 250 were two different ones): attacking the
 * same one again waits for the timer, so auto-attack doesn't fire a tick later.
 */

const Shared = require("./DoomShared");
const Run = require("./DoomRun");
const Boss = require("./DoomBoss");
const Rewards = require("./Rewards.Doom");
const Records = require("./DoomRecords");
const { onObject } = require("./Lobby.Doom");
const { isDemonbane } = require("./DoomHazards");

const { NPC, OBJECT } = Shared;

function runIn(player) {
  const run = Run.runOf(player);
  return run && Shared.inArena(player.getLocation()) ? run : null;
}

// ---------------------------------------------------------------- objects

function useExit(event) {
  const run = runIn(event.player);
  if (!run) return false;
  if (event.option === "Quick-exit") run.end("exit");
  else run.askToExit();
  return true;
}

/** In the game the hole is used from wherever it's clicked: no walk to it. */
function holeFromAnywhere(event) {
  if (event.objectId !== OBJECT.BURROW_HOLE || !runIn(event.player)) return;
  const at = event.player.getLocation();
  event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
}

function useHole(event) {
  const run = runIn(event.player);
  if (!run) return false;
  if (event.option === "Descend") run.askToDescend();
  else if (run.stage === "claimed") Rewards.openClaim(run.player, { level: run.level });
  else if (run.stage === "hole") Rewards.openHole(run);
  return true;
}

// ---------------------------------------------------------------- combat

function ownRun(npc) {
  return npc?.__doomRun ?? null;
}

/** The Doom's NPCs belong to their run's player; the shield and a Doom not yet up can't be hit. */
function onlyOwnRun(event) {
  const npc = ownRun(event.target) ? event.target : ownRun(event.attacker) ? event.attacker : null;
  if (!npc) return;
  const run = ownRun(npc);
  const other = npc === event.target ? event.attacker : event.target;
  if (other?.isPlayer?.() && other !== run.player) {
    event.allow = false;
    return;
  }
  if (npc === event.attacker) {
    event.allow = false;
    return;
  }
  if (npc.getId() === NPC.EARTHEN_SHIELD) event.allow = false;
  else if (npc === run.boss && run.stage !== "fight") event.allow = false;
}

function npcDowned(event) {
  const npc = event.npc;
  const run = ownRun(npc);
  if (!run) return;
  if (npc === run.boss) {
    event.preventDeath = true;
    run.defeated();
  } else if (npc.__doomLarva) {
    event.preventDeath = true;
    run.hazards.larvaKilled(npc);
  } else if (npc.__doomEarth) {
    event.preventDeath = true;
    run.hazards.earthDestroyed(npc);
  }
}

/** The melee charge: only melee lands, always, with its bonus (Wiki) a tick later (capture). */
function chargedHit(run, hit) {
  const { CombatType } = Shared.core();
  const attacks = run.attacks;
  if (!attacks.charging) return;
  if (hit.getCombatType() !== CombatType.MELEE) {
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    return;
  }
  const attacker = hit.getAttacker();
  const bonus = attacker?.isPlayer?.() ? attacks.punish(attacker) : 0;
  for (const part of hit.getHits()) part.setDamage(Math.max(1, part.getDamage()));
  hit.updateTotalDamage();
  // Capture: the bonus lands the next tick as its own hitsplat, one for each of the hit's.
  const parts = hit.getHits().length;
  if (bonus > 0) {
    attacks.after(1, () => {
      for (let index = 0; index < parts; index++) Shared.damage(run.boss, bonus, "RED", Shared.SPLAT.BONUS);
    });
  }
}

/** Hits on the Doom: the shield, the burrowed charge, the melee charge, then acid (delve 3+). */
function bossHit(run, hit) {
  const phase = run.attacks.phase;
  if (phase === "shield") {
    run.shield.hit(hit);
    return;
  }
  if (phase === "burrow") {
    run.burrow.hit();
    return;
  }
  chargedHit(run, hit);
  if (hit.getTotalDamage() > 0) run.acid.spray();
}

/** A new larva or volatile earth: hit on cooldown; demonbane on a larva leaves the timer, plus 1 tick (capture). */
function attackTiming(event) {
  const npc = event.target;
  const run = ownRun(npc);
  if (!run || event.attacker !== run.player || !(npc.__doomLarva || npc.__doomEarth)) return;
  if (!event.newTarget) return;
  event.ignoreDelay = true;
  if (npc.__doomLarva && isDemonbane(event.attacker)) {
    event.keepDelay = true;
    event.minimumDelay = LARVA_DEMONBANE_DELAY;
  }
}

/** Capture: after a demonbane attack on a larva the next attack may come the tick after. */
const LARVA_DEMONBANE_DELAY = 1;

/** Wiki: attacks while the Doom charges are 100% accurate (melee for the melee charge). */
function chargedAccuracy(event) {
  const run = ownRun(event.target);
  if (!run || event.target !== run.boss || event.attacker !== run.player) return;
  const { CombatType } = Shared.core();
  const meleeCharge = run.attacks.charging && event.combatType === CombatType.MELEE;
  const burrowCharge = run.attacks.phase === "burrow" && Number.isFinite(run.burrow.firesAt);
  if (meleeCharge || burrowCharge) event.forceAccurate = true;
}

function modifyHit(event) {
  const { npc, hit } = event;
  const run = ownRun(npc);
  if (!run) return;
  if (npc.__doomLarva) run.hazards.modifyLarvaHit(npc, hit);
  else if (npc === run.boss) bossHit(run, hit);
}

// ---------------------------------------------------------------- death and logging in

/** What would drop lands in the lobby, as the grave would be. */
function dropInLobby(event) {
  if (!Run.runOf(event.player) || !event.dropEligible) return;
  const { ItemOnGroundManager } = Shared.core();
  ItemOnGroundManager.registerLocation(event.player, event.item, Shared.loc(Shared.TILES.RESPAWN));
  event.handled = true;
}

function dieInRun(event) {
  const run = Run.runOf(event.player);
  if (!run) return;
  event.handled = true;
  Records.died(event.player);
  run.end("death");
  event.player.moveTo(Shared.loc(Shared.TILES.RESPAWN));
}

/** Logged back in where a run was (it ended at logout): out by the gap. */
function returnToLobby({ player }) {
  if (Run.runOf(player)) return;
  if (player.getAttribute(Run.ATTR.RUN) !== true && !Shared.inArena(player.getLocation())) return;
  player.setAttribute(Run.ATTR.RUN, null);
  player.moveTo(Shared.loc(Shared.TILES.LOBBY_GAP));
}

module.exports = function registerDoomDelve(api) {
  Shared.bind(api);
  for (const key of Object.values(Run.ATTR)) api.persistAttribute(key);
  const idle = Boss.idleMethod();
  api.registerNpcCombatMethodProvider([NPC.DOOM, NPC.DOOM_SHIELDED, NPC.DOOM_BURROWED, NPC.LARVA, NPC.LARVA_RANGED,
    NPC.LARVA_MAGIC, NPC.LARVA_MELEE, NPC.VOLATILE_EARTH, NPC.EARTHEN_SHIELD, NPC.GIANT_LARVA_RANGED,
    NPC.GIANT_LARVA_MAGIC], idle, { singleton: false });
  onObject(api, OBJECT.GAP_EXIT, useExit);
  onObject(api, OBJECT.BURROW_HOLE, useHole);
  api.onObjectRoute(holeFromAnywhere);
  api.onCanAttack(onlyOwnRun);
  api.onNpcBeforeDeath(npcDowned);
  api.onNpcHitModify(modifyHit);
  api.onAttackTiming(attackTiming);
  api.onCombatHitRoll(chargedAccuracy);
  api.onPlayerDeathItemDrop(dropInLobby);
  api.onPlayerDeath(dieInRun);
  api.onPlayerLogin(returnToLobby);
};

Object.assign(module.exports, { useExit, useHole, holeFromAnywhere, onlyOwnRun, npcDowned, modifyHit, attackTiming, chargedAccuracy, dieInRun, returnToLobby });
