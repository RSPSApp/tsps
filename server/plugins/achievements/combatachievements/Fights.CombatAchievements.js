/**
 * What happened in a fight, for the tasks that are about how a monster died ("using only magical
 * damage", "without taking any damage from her", "with the Protect from Melee prayer activated",
 * "with a stab weapon", "solo", "in less than 1 minute"). From the first hit either way between a
 * player and an NPC to the NPC's death it keeps, per player:
 *   - every hit the player dealt: tick, combat type, melee attack type, special attack, weapon
 *   - every hit the player took, from any NPC: tick, the NPC, its combat type, the damage
 *   - the killing blow and the player's prayers when it landed
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
const combatTypeName = (hit) => String(hit?.getCombatType?.() ?? "").toUpperCase();

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

/** onPlayerDealtDamage: a hit the player has queued on its target. */
function onDealt({ player, target, hit }) {
  if (!isNpc(target) || !player || !watched(target)) return;
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
  if (isPlayer(attacker) && isNpc(target) && target.getHitpoints?.() <= 0 && watched(target)) {
    const fight = recordFor(attacker, target);
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
function summary(player, npc, record, event) {
  const now = tick();
  const hitsTaken = (taken.get(player) ?? []).filter((entry) => entry.tick >= record.startTick);
  const damagers = (event.damagers ?? []).filter(Boolean);
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
  if (npc?.getMaxHitpoints?.() === 1) return;
  const list = rules.get(npcName(npc).toLowerCase());
  if (!byPlayer || !list?.length) return;
  const now = tick();
  for (const [player, record] of byPlayer) {
    // Left alone past IDLE_TICKS the fight was over (recordFor would have started it over).
    if (player.isRegistered?.() === false || now - record.lastTick > IDLE_TICKS) continue;
    const fight = summary(player, npc, record, event);
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

Object.assign(module.exports, { onKill, onDealt, onHitResolved, onNpcDeath, summary, rules, _test: { taken } });
