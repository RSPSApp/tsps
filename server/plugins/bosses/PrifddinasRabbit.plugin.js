"use strict";

/**
 * The Rabbit (Prifddinas) (https://oldschool.runescape.wiki/w/Rabbit_(Prifddinas)), cache
 * `caerbannog`: the combat level 2 pseudo-boss with 2,000 Hitpoints alone in the Elven rabbit
 * cave north of Prifddinas (https://oldschool.runescape.wiki/w/Elven_rabbit_cave). It always
 * drops a crystal grail.
 *
 * Already in data, not here: its spawn (npc-spawns.json, the Wiki pin 3295,12581, wandering the
 * whole cave floor as captured; docs/npc-spawn-captures.md), stats, max hit 40, its death timing
 * (npc-combat-defs.json), poison and venom immunity (monsters-complete.json, npc-status-immunities.json), the grail and the
 * Rag and Bone Man II rabbit bone (npc-drops.json), the cave's Enter and Exit
 * (plugins/world/data/loc-teleports.json, docs/loc-teleports.md) and the cannon refusal
 * (plugins/items/data/cannon-restrictions.json).
 *
 * This plugin adds what the Wiki says on top:
 * - a respawn of 6 hours once killed; the cave is not instanced, so there is one rabbit for all;
 * - its Magic defence roll uses its Defence level instead of its Magic level;
 * - no thralls: "You can't resurrect a thrall here." anywhere in the cave (captured), and one that
 *   got in anyway lands no hit (the Wiki infobox's "immunethrall"). A thrall raised outside stays
 *   outside: captured (ticks 7393-7490), it waited by the Cave through every visit, with no message,
 *   until its time ran out. Nothing here is needed for that: only pets teleport after their owner,
 *   so its follow simply ends when the owner crosses into the cave, and it picks the owner up
 *   again on the way out;
 * - a freezing spell (Ice Barrage) never holds it. The Wiki's "only a visual freeze lasting
 *   around a second" is a brief look of a stall, not a freeze: the spell lands with its graphic
 *   and the rabbit keeps moving. Captured (20261115T123023-f20d3d7, world 370): two Ice Barrage
 *   hits (ice_barrage_impact 369 and a 41 at ticks 46 and 151) and eight splashes, and on every
 *   one it stepped on the hit's own tick and each tick after, chasing the caster. The stall is
 *   its defend animation (6091), queued with the impact graphic when the spell is cast;
 * - it walks under players: since 1 August 2019 ("The rabbit can no longer be blocked by
 *   another player") a second player standing in its way can't stop it reaching the one behind;
 * - Monster Examine and Monster Inspect can't be cast on it ("A strange magic stops your spell
 *   from casting.", captured);
 * - leaving the cave resets its aggression towards the player and its stats, but not its
 *   Hitpoints, so the Wiki's hit-and-leave kills work. The Eye of Ayak's Magic defence drain
 *   lowers a bonus, not a level, so it stays, as the Wiki says;
 * - it regenerates slowly, 1 Hitpoint every 10 ticks, in place of the server's NPC default
 *   (a tenth of its Hitpoints a tick once out of combat, which would undo every hit-and-leave);
 * - it attacks every 4 ticks (captured), not the 3 the generated monster data gives it.
 *
 * Checked against RSProx captures (2026-11-15, live worlds 369 and 370, rev 242):
 * - it attacks with 6090 and blocks with 6091 (rabbit_update_attack / _defend), walks after a
 *   player, and never starts a fight. Standing, its attacks were 4 ticks apart every time
 *   (35 back to back in 20261115T080012-f20d3d7 ticks 8219-8251 and 20261115T101929-f20d3d7
 *   ticks 21-49); the longer gaps were all while it walked;
 * - its death (data/definitions/npc-combat-defs.json, deathTicks 5): the killing hit on tick T
 *   (13732), its menu options cleared on T+1, rabbit_update_death (6092) on T+3, and the grail
 *   (ObjAddSpecific 24000, on the rabbit's own tile, public after 100 ticks) with its removal on
 *   T+6. Ours plays the death animation on T+1 (NPCDeathTask) and drops on T+6;
 * - a second player standing on its path (3295,12577, between it and its target, ticks
 *   9489-9496) was walked through both ways;
 * - Monster Examine: "A strange magic stops your spell from casting." (20261115T101929 tick 837);
 * - a player who left mid-fight found it on the same tile on return, not fighting until attacked
 *   again;
 * - damage stays: its health bar (160 steps for 2,000 Hitpoints) read 152 after a 100 hit and kept
 *   152 through three exits and returns; after a 34 hit it read 149, and 150 two visits (22 ticks)
 *   later. The recording is 20261115T080012-f20d3d7 (the user's own; ticks 1848-1930). With a
 *   floored bar, 152 at tick 1892 means at most 1,911 Hitpoints, so it healed at most 8 in the 60
 *   ticks from the 100 hit (1848) to the 34 hit (1908); 149 then 150 means at least 1 in the 22
 *   ticks to 1930. A steady rate inside both is 1 per 7.5 to 22 ticks;
 * - a full solo kill pins it at 1 per 10 ticks: from full Hitpoints (tick 8196) to its death
 *   (13732) its hitsplats add up to 2,553, so it healed 553 in 5,536 ticks (0.0999 a tick). It
 *   heals at that rate in a fight and with nobody in the cave (+25 over a 252-tick bank trip,
 *   ticks 11737-11989). The Wiki gives no rate for monsters;
 * - with a crystal grail or ale of the gods wielded the player stands 3040, walks 3039 and
 *   keeps the default turn (823), sidestep and back steps (820-822) and run (824): the items'
 *   rows in data/definitions/item-gameplay.json.
 */

/** Wiki: "The rabbit also has a respawn time of 6 hours once killed." 6 h of 0.6 s ticks. */
const RESPAWN_TICKS = 36000;
/** Wiki (Rabbit (Prifddinas), Trivia): the message for Monster Examine or Monster Inspect. */
const EXAMINE_REFUSAL = "A strange magic stops your spell from casting.";
/** Captured (2026-11-15): every Resurrect cast inside the cave. */
const THRALL_REFUSAL = "You can't resurrect a thrall here.";
/** 1 Hitpoint per 10 ticks (captured over a whole kill; see the header). */
const REGEN_TICKS = 10;
/** Captured: 4 ticks between its attacks (monsters-complete.json says 3). */
const ATTACK_SPEED = 4;
/** Turns off the server's default NPC regeneration (as for Vet'ion's hounds); REGEN_TICKS replaces it. */
const NO_REGEN_FLAG = "combat:no-regen";
/**
 * The cave's walkable floor, the closed 95-tile collision component around the Wiki pin
 * (3295,12581), the Steps' landing (3295,12574) among it; the cannon refusal uses the same one.
 */
const CAVE = { minX: 3291, maxX: 3300, minY: 12574, maxY: 12583, z: 0 };
/** An NPC's own combat levels, all restored when the stats reset. */
const COMBAT_SKILLS = ["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC"];

/** The cycle each rabbit last regenerated on. A respawn is a new NPC, so it starts again. */
const lastRegen = new WeakMap();

function isRabbit(core, mobile) {
  return mobile?.isNpc?.() === true && mobile.getId() === core.NpcIdentifiers.RABBIT_12;
}

function inCave(location) {
  return location != null && location.getZ() === CAVE.z
    && location.getX() >= CAVE.minX && location.getX() <= CAVE.maxX
    && location.getY() >= CAVE.minY && location.getY() <= CAVE.maxY;
}

function setRespawn(core) {
  core.NpcDefinition.forId(core.NpcIdentifiers.RABBIT_12).setRespawn(RESPAWN_TICKS);
}

/**
 * `combat:magic-defence-roll`: the roll (Magic + 9) x (Magic defence + 64) becomes
 * (Defence + 9) x (Magic defence + 64). Scaled rather than rebuilt, so a ring of shadows or
 * brimstone ring handler that already changed it keeps its share.
 */
function magicDefenceRoll(core, request) {
  if (!isRabbit(core, request?.target)) return;
  const npc = request.target.getAsNpc();
  const magic = npc.getCurrentLevel(core.Skill.MAGIC) + 9;
  const defence = npc.getCurrentLevel(core.Skill.DEFENCE) + 9;
  request.defenceRoll = Math.floor((request.defenceRoll * defence) / magic);
}

/** `magic:can-resurrect-thrall`: no thrall rises in the cave (captured). */
function refuseThrall(request) {
  if (inCave(request?.player?.getLocation?.())) request.refusal = THRALL_REFUSAL;
}

/** `magic:thrall-attack`: Wiki infobox "immunethrall = Yes". The thrall still attacks; no hit lands. */
function thrallAttack(core, event) {
  if (isRabbit(core, event?.target)) event.cancelled = true;
}

/** `onAttackSpeed`: its own attacks come every ATTACK_SPEED ticks. */
function attackSpeed(core, event) {
  if (isRabbit(core, event?.attacker)) event.speed = ATTACK_SPEED;
}

/** Since 1 August 2019 a player can't block it: it walks under players (and anything else). */
function ensureWalkThrough(core, npc) {
  if (!npc.hasFlag(core.NPC.WALK_THROUGH_ENTITIES_FLAG)) npc.setFlag(core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
}

/**
 * 1 Hitpoint per REGEN_TICKS, counted from the game cycle so ticks it wasn't processed still
 * count; the server's own regeneration is off.
 */
function regenerate(core, npc) {
  if (!npc.hasFlag(NO_REGEN_FLAG)) npc.setFlag(NO_REGEN_FLAG, true);
  const now = core.World.getProcessCycle();
  const since = lastRegen.get(npc);
  if (since === undefined) {
    lastRegen.set(npc, now);
    return;
  }
  const steps = Math.floor((now - since) / REGEN_TICKS);
  if (steps <= 0) return;
  lastRegen.set(npc, since + steps * REGEN_TICKS);
  const hitpoints = npc.getHitpoints();
  const max = npc.getMaxHitpoints();
  if (hitpoints > 0 && hitpoints < max) npc.setHitpoints(Math.min(max, hitpoints + steps));
}

/** `magic:can-examine-npc`: Monster Examine and Monster Inspect are refused on it (Wiki). */
function refuseExamine(core, event) {
  if (isRabbit(core, event?.npc)) event.refusal = EXAMINE_REFUSAL;
}

/** Its levels back to its own, its fight with whoever it was on dropped. Its Hitpoints stay. */
function resetRabbit(core, npc) {
  npc.getCombat().reset();
  for (const skill of COMBAT_SKILLS) npc.setCurrentLevels(core.Skill[skill], npc.getMaxLevel(core.Skill[skill]));
}

/** Its target walked out, or nobody is left in the cave: its aggression and stats reset (Wiki). */
function playerLeft(core, area, player) {
  const players = area.getPlayers().filter((other) => other !== player);
  for (const npc of area.getNpcs()) {
    if (!isRabbit(core, npc) || npc.getHitpoints() <= 0) continue;
    if (npc.getCombat().getTarget() === player || players.length === 0) resetRabbit(core, npc);
  }
}

function createCave(api) {
  const { core } = api;
  class ElvenRabbitCave extends core.Area {
    constructor() {
      super([new core.Boundary(CAVE.minX, CAVE.maxX, CAVE.minY, CAVE.maxY, CAVE.z)]);
    }

    getName() {
      return "Elven rabbit cave";
    }

    /** Wiki: a freezing spell only looks like a stall; the rabbit is never held. */
    canFreeze(target) {
      return isRabbit(core, target) ? false : null;
    }

    /** Every tick, so a fresh or respawned rabbit (a new NPC) gets its rules too. */
    process(mobile) {
      if (!isRabbit(core, mobile)) return;
      ensureWalkThrough(core, mobile);
      regenerate(core, mobile);
    }

    postLeave(mobile) {
      if (mobile?.isPlayer?.()) playerLeft(core, this, mobile);
    }
  }
  return new ElvenRabbitCave();
}

module.exports = {
  name: "PrifddinasRabbit",
  description: "The Prifddinas rabbit in the Elven rabbit cave: its 6-hour respawn, Defence-based Magic defence, slow regeneration, walking under players, no thralls, freeze and Monster Examine immunity, and the reset when a player leaves.",
  members: true,
  CAVE,
  EXAMINE_REFUSAL,
  THRALL_REFUSAL,
  REGEN_TICKS,
  RESPAWN_TICKS,
  ATTACK_SPEED,
  register(api) {
    api.onServerStartup(setRespawn.bind(null, api.core));
    api.onAttackSpeed(attackSpeed.bind(null, api.core));
    api.onCustomEvent("combat:magic-defence-roll", magicDefenceRoll.bind(null, api.core));
    api.onCustomEvent("magic:can-resurrect-thrall", refuseThrall);
    api.onCustomEvent("magic:thrall-attack", thrallAttack.bind(null, api.core));
    api.onCustomEvent("magic:can-examine-npc", refuseExamine.bind(null, api.core));
    api.registerArea(createCave(api));
  },
};
