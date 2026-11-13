/**
 * What happened in a fight, for the tasks that are about how a monster died ("using only magical
 * damage", "without taking any damage from her", "with the Protect from Melee prayer activated",
 * "with a stab weapon", "solo", "in less than 1 minute"). From the first hit either way between a
 * player and an NPC to the NPC's death it keeps, per player:
 *   - every hit the player dealt: tick, combat type, melee attack type, special attack, weapon
 *   - every hit the player took, from any NPC: tick, the NPC, its combat type, the damage
 *   - the killing blow and the player's prayers when it landed
 * and, per NPC, which player last lowered its Defence.
 * Only NPCs with rules are tracked, and hits taken only while the player is in such a fight: every
 * other hit in the world would otherwise cost something, and the history grew for as long as a
 * player kept fighting anything. When the NPC dies, the rules registered for its name decide which
 * tasks each player who fought it has finished:
 *
 *   Fights.onKill("King Black Dragon", {
 *     "Claw Clipper": (fight) => fight.prayedAtKill("PROTECT_FROM_MELEE"),
 *     "Hide Penetration": (fight) => fight.onlyMelee("stab"),
 *   });
 *
 * A rule gets the fight (see summary()) and the death event, and returns true when the task is done.
 */
const Data = require("./Data.CombatAchievements");
const Progress = require("./Progress.CombatAchievements");
const Derived = require("./DerivedRules.CombatAchievements");

const MELEE_ATTACK_TYPES = ["stab", "slash", "crush"];
/** The protection prayer that blocks each combat type (PrayerHandler names). */
const PROTECTION = { MELEE: "PROTECT_FROM_MELEE", RANGED: "PROTECT_FROM_MISSILES", MAGIC: "PROTECT_FROM_MAGIC" };
/** Damage taken is kept this many ticks back, the longest fight a rule reads. */
const TAKEN_HISTORY_TICKS = 6000;
/** A fight left alone this long starts over: the player walked off, died or logged out. */
const IDLE_TICKS = 100;

/** npc -> Map(player -> fight record). */
const fights = new WeakMap();
/** player -> [{ tick, npc, npcName, type, damage }], hits taken from NPCs, oldest first. */
const taken = new WeakMap();
/** player -> the last tick they hit, or were hit by, an NPC with rules. */
const lastFought = new WeakMap();
/** npc -> { level, by }: its Defence when last seen, and the player who last lowered it. */
const defence = new WeakMap();
/** NPC name (lower case) -> [{ task, test }]. */
const rules = new Map();

let core;
let pluginApi;
let derived = false;
/** Rules registered by task name, resolved against the cache on the first death. */
const pending = [];

function addRule(name, task, test) {
  const key = String(name).toLowerCase();
  if (!rules.has(key)) rules.set(key, []);
  rules.get(key).push({ task, test });
}

/** The registered rules and those the task descriptions make (DerivedRules.CombatAchievements), once the cache is loaded. */
function ensureRules() {
  if (derived) return;
  derived = true;
  resolvePending();
  for (const [name, task, test] of Derived.derive(pluginApi)) addRule(name, task, test);
}

function resolvePending() {
  for (const [name, taskName, test] of pending.splice(0)) {
    const task = Data.taskNamed(taskName);
    if (task) addRule(name, task, test);
    else console.warn(`[combat-achievements] no task is called "${taskName}"`);
  }
}

const tick = () => core.World.getProcessCycle();
const isPlayer = (mobile) => mobile?.isPlayer?.() === true;
const isNpc = (mobile) => mobile?.isNpc?.() === true;
const npcName = (npc) => String(npc?.getCurrentDefinition?.()?.getName?.() ?? npc?.getDefinition?.()?.getName?.() ?? "");
/** "MELEE", "RANGED" or "MAGIC": a hit's CombatType is a numeric enum, so read its name. */
function combatTypeName(hit) {
  const type = hit?.getCombatType?.();
  if (typeof type === "number") return String(core?.CombatType?.[type] ?? "").toUpperCase();
  return String(type ?? "").toUpperCase();
}

/**
 * Whether this hit kills the NPC. A resolved hit's damage is queued, not yet taken (HitQueue
 * applies it after the hit resolves), so it kills when the queued damage reaches the hitpoints.
 */
function lethal(npc) {
  const hitpoints = Number(npc.getHitpoints?.() ?? 1);
  const queued = Number(npc.getCombat?.()?.getHitQueue?.()?.getQueuedDamage?.() ?? 0);
  return hitpoints <= queued;
}

function weaponId(player) {
  const weapon = player.getEquipment?.()?.getItems?.()?.[core.Equipment.WEAPON_SLOT];
  const id = weapon?.getId?.() ?? -1;
  return id > 0 ? id : -1;
}

/** Whether a rule reads this NPC's fights. */
function watched(npc) {
  ensureRules();
  return rules.has(npcName(npc).toLowerCase());
}

/** In a fight a rule may read: one touched within IDLE_TICKS, so not yet started over. */
function engaged(player, now) {
  return now - (lastFought.get(player) ?? -Infinity) <= IDLE_TICKS;
}

function recordFor(player, npc) {
  if (!fights.has(npc)) fights.set(npc, new Map());
  const byPlayer = fights.get(npc);
  const now = tick();
  lastFought.set(player, now);
  const record = byPlayer.get(player);
  if (!record || now - record.lastTick > IDLE_TICKS) {
    byPlayer.set(player, { startTick: now, lastTick: now, dealt: [], killingBlow: null });
  } else {
    record.lastTick = now;
  }
  return byPlayer.get(player);
}

function defenceLevel(npc) {
  const level = Number(npc?.getDefenceLevel?.());
  return Number.isFinite(level) ? level : null;
}

/**
 * Defence drains happen while a hit resolves: a special attack's or a spell's after a player's hit
 * (the dragon warhammer, the bone dagger, Curse), a worn item's on the NPC's hit (the black mask).
 * So a drop since the NPC was last seen is credited to the player in the hit that just resolved.
 * It is first seen when a hit on it is queued (onDealt), before that hit's own drain lands: the
 * bone dagger opening the fight counts, a drain from before the fight doesn't. Seen first on its
 * own hit, it compares against its base level.
 */
function noteDefence(npc, player) {
  const level = defenceLevel(npc);
  if (level === null) return;
  const seen = defence.get(npc);
  const base = Number(npc.getMaxLevel?.(core.Skill?.DEFENCE));
  const before = seen?.level ?? (Number.isFinite(base) ? base : level);
  const by = level < before ? player : seen?.by ?? null;
  defence.set(npc, { level, by });
}

/**
 * Before a hit resolves: the level a drain is measured from. Restoration only raises Defence, so
 * a level above the last one seen is caught up, and a later drain isn't hidden by it.
 */
function raiseDefence(npc) {
  const seen = defence.get(npc);
  const level = defenceLevel(npc);
  if (level === null) return;
  if (!seen) defence.set(npc, { level, by: null });
  else if (level > seen.level) seen.level = level;
}

/** onPlayerDealtDamage: a hit the player has queued on its target. */
function onDealt({ player, target, hit }) {
  if (!isNpc(target) || !player || !watched(target)) return;
  raiseDefence(target);
  const fight = recordFor(player, target);
  const fightType = player.getFightType?.();
  fight.dealt.push({
    tick: tick(),
    type: combatTypeName(hit),
    attackType: MELEE_ATTACK_TYPES[fightType?.getBonusType?.()] ?? null,
    special: player.isSpecialActivated?.() === true,
    weapon: weaponId(player),
    damage: Number(hit?.getTotalDamage?.() ?? 0),
  });
}

function prayersOf(player) {
  const { PrayerHandler } = core;
  const active = new Set();
  for (const [name, id] of Object.entries(PrayerHandler)) {
    if (typeof id === "number" && /^[A-Z_]+$/.test(name) && PrayerHandler.isActivated(player, id)) active.add(name);
  }
  return active;
}

/** onCombatHitResolved: damage taken from NPCs, and the blow that kills an NPC. */
function onHitResolved({ attacker, target, hit }) {
  if (isPlayer(target) && isNpc(attacker) && watched(attacker)) noteDefence(attacker, target);
  if (isPlayer(attacker) && isNpc(target) && watched(target)) noteDefence(target, attacker);
  if (isPlayer(target) && isNpc(attacker)) {
    const damage = Number(hit?.getTotalDamage?.() ?? 0);
    if (damage <= 0) return;
    const now = tick();
    if (watched(attacker)) recordFor(target, attacker);
    // No fight a rule reads is open, so no future one starts before now: nothing here is needed.
    if (!engaged(target, now)) {
      taken.delete(target);
      return;
    }
    const log = taken.get(target) ?? [];
    let stale = 0;
    while (stale < log.length && now - log[stale].tick > TAKEN_HISTORY_TICKS) stale++;
    if (stale > 0) log.splice(0, stale);
    const type = combatTypeName(hit);
    const prayer = core.PrayerHandler[PROTECTION[type]];
    const onPrayer = prayer !== undefined && core.PrayerHandler.isActivated(target, prayer);
    log.push({ tick: now, npc: attacker, npcName: npcName(attacker), type, damage, onPrayer });
    taken.set(target, log);
    return;
  }
  if (isPlayer(attacker) && isNpc(target) && watched(target) && lethal(target)) {
    const fight = recordFor(attacker, target);
    // Only the first lethal blow: a later hit landing on the same tick hits a dead NPC.
    if (fight.killingBlow) return;
    fight.killingBlow = {
      tick: tick(),
      type: combatTypeName(hit),
      special: fight.dealt.at(-1)?.special ?? false,
      weapon: weaponId(attacker),
      prayers: prayersOf(attacker),
    };
  }
}

/** What a rule reads about one player's fight with the NPC that just died. */
function summary(player, npc, record, event, loweredBy = defence.get(npc)?.by ?? null) {
  const now = tick();
  const hitsTaken = (taken.get(player) ?? []).filter((entry) => entry.tick >= record.startTick);
  const damagers = (event.damagers ?? []).filter(Boolean);
  /** The damage that took its last hitpoints: a hit, or reflected damage such as Vengeance's. */
  const finalDamage = npc?.getCombat?.()?.getHitQueue?.()?.getLastAppliedHit?.() ?? null;
  const fight = {
    player,
    npc,
    npcName: npcName(npc),
    killer: event.killer === player,
    solo: damagers.length <= 1,
    ticks: now - record.startTick,
    dealt: record.dealt,
    hitsTaken,
    killingBlow: record.killingBlow,
    /** Every damaging hit was of these combat types ("MELEE", "RANGED", "MAGIC"). */
    only(...types) {
      const damaging = record.dealt.filter((hit) => hit.damage > 0);
      return damaging.length > 0 && damaging.every((hit) => types.includes(hit.type));
    },
    /** Every hit was melee (with that attack type, when given: "stab", "slash", "crush"). */
    onlyMelee(attackType = null) {
      return record.dealt.length > 0 && record.dealt.every((hit) => hit.type === "MELEE" && (!attackType || hit.attackType === attackType));
    },
    /** Every damaging hit was a special attack. */
    onlySpecials() {
      const damaging = record.dealt.filter((hit) => hit.damage > 0);
      return damaging.length > 0 && damaging.every((hit) => hit.special);
    },
    /** Every hit was dealt with one of these weapons (item ids). */
    onlyWeapons(...ids) {
      return record.dealt.length > 0 && record.dealt.every((hit) => ids.includes(hit.weapon));
    },
    /** Every hit was dealt with a weapon whose name starts so ("Verac's flail" for every degraded one). */
    onlyWeaponsNamed(prefix) {
      const named = (id) => String(core.CacheDefinitions.getItem(id)?.name ?? "").startsWith(prefix);
      return record.dealt.length > 0 && record.dealt.every((hit) => hit.weapon > 0 && named(hit.weapon));
    },
    /** Damage taken in the fight: from this NPC, or from NPCs of these names. */
    damageTaken(...names) {
      const wanted = names.map((name) => name.toLowerCase());
      return hitsTaken
        .filter((entry) => (wanted.length ? wanted.includes(entry.npcName.toLowerCase()) : entry.npc === npc))
        .reduce((sum, entry) => sum + entry.damage, 0);
    },
    /** Damage of this combat type taken in the fight, from this NPC or NPCs of these names. */
    damageTakenOfType(type, ...names) {
      const wanted = names.map((name) => name.toLowerCase());
      return hitsTaken
        .filter((entry) => entry.type === type && (wanted.length ? wanted.includes(entry.npcName.toLowerCase()) : entry.npc === npc))
        .reduce((sum, entry) => sum + entry.damage, 0);
    },
    /** Damage taken in the fight without the protection prayer for its combat type, from any NPC. */
    damageTakenOffPrayer() {
      return hitsTaken.filter((entry) => !entry.onPrayer).reduce((sum, entry) => sum + entry.damage, 0);
    },
    /** The player's prayer (a PrayerHandler name, "PROTECT_FROM_MELEE") was on for the killing blow. */
    prayedAtKill(prayer) {
      return record.killingBlow?.prayers?.has(prayer) === true;
    },
    /** This player was the last to lower the NPC's Defence (a drain still counts once restored). */
    loweredDefenceLast() {
      return loweredBy === player;
    },
    /** The finishing blow was this player's Vengeance (cast by them, or on them by Vengeance Other). */
    killedByVengeance() {
      return finalDamage?.getOrigin?.() === "vengeance" && finalDamage.getSource?.() === player;
    },
    /** The fight lasted under this many seconds (0.6 s a tick). */
    within(seconds) {
      return fight.ticks * 0.6 < seconds;
    },
  };
  return fight;
}

/** Registers the tasks a monster's death can finish, by its NPC name and the task's cache name. */
function onKill(name, tests) {
  for (const [taskName, test] of Object.entries(tests)) pending.push([name, taskName, test]);
  // Registered after the rules were first needed: resolve these now.
  if (derived) resolvePending();
}

/** onNpcDeath: every player who fought it, against its rules; then the fight is forgotten. */
function onNpcDeath(event) {
  const { npc } = event ?? {};
  ensureRules();
  const byPlayer = npc ? fights.get(npc) : null;
  fights.delete(npc);
  // Read once and forgotten with the fight: an NPC that is reused for its respawn starts clean.
  const loweredBy = npc ? defence.get(npc)?.by ?? null : null;
  if (npc) defence.delete(npc);
  if (npc?.getMaxHitpoints?.() === 1) return;
  const list = rules.get(npcName(npc).toLowerCase());
  if (!byPlayer || !list?.length) return;
  const now = tick();
  for (const [player, record] of byPlayer) {
    // Left alone past IDLE_TICKS the fight was over (recordFor would have started it over).
    if (player.isRegistered?.() === false || now - record.lastTick > IDLE_TICKS) continue;
    const fight = summary(player, npc, record, event, loweredBy);
    for (const { task, test } of list) {
      if (Progress.isComplete(player, task.id)) continue;
      let done = false;
      try {
        done = test(fight, event) === true;
      } catch (error) {
        console.warn(`[combat-achievements] rule for "${task.name}" threw`, error);
      }
      if (done) Progress.complete(player, task);
    }
  }
}

module.exports = function attachFights(api) {
  pluginApi = api;
  core = api.core;
  api.onNpcDeath(onNpcDeath);
  api.onPlayerDealtDamage(onDealt);
  api.onCombatHitResolved(onHitResolved);
};

Object.assign(module.exports, { onKill, onDealt, onHitResolved, onNpcDeath, summary, rules, _test: { taken, defence } });
