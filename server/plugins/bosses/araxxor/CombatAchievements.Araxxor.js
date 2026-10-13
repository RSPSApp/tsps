/**
 * Araxxor's Combat Achievements (plugins/combatachievements/) that her fight decides. The kill
 * count is Combat Achievements' own: a kill is reported with "combat-achievements:kill", and the
 * total it answers is what the kill message shows (and the boss page's varp). Each fight is
 * watched from her spawn: the damage Perfect Araxxor forbids, hits on her while enraged, venom
 * or poison immunity, eggs destroyed before they hatch and whether she ever moved. Kills in one
 * stay in the lair count for the speed tasks and Arachnid Lover; a Ruptura araxyte killing three
 * others in its explosion is Araxyte Betrayal.
 *
 * Where the task text leaves it open (Wiki: Araxxor#Combat achievements):
 *  - Relaxxor counts eggs killed before they hatch; overdamaged eggs that Araxxor tries to hatch
 *    do not count (Wiki strategy).
 *  - The speed tasks time N kills in one stay, from the first of them spawning to the last dying.
 *  - Araxyte Betrayal counts hatched araxytes killed by one explosion (not eggs or Araxxor).
 */
const Shared = require("./Shared.Araxxor");

const SPEED = Object.freeze([
  ["Araxxor Speed-Trialist", 4],
  ["Araxxor Speed-Chaser", 5],
  ["Araxxor Speed-Runner", 6],
]);
/** 10:00 in ticks. */
const SPEED_LIMIT_TICKS = 1000;
const RELAXXOR_EGGS = 6;
const ARACHNID_LOVER_KILLS = 10;
const BETRAYAL_KILLS = 3;
const MONSTER = "Araxxor";

const EGG_IDS = new Set(Object.values(Shared.EGG_ID));
const MINION_IDS = new Set(Object.values(Shared.MINION_ID));

/** player -> { kills: [{ spawnedAt, killedAt }], fight } while they are in the lair. */
const states = new WeakMap();
let api = null;
let core = null;
let PrayerHandler = null;

const tick = () => core.World.getProcessCycle();
const complete = (player, task) => api.emitCustomEvent("combat-achievements:complete", { player, task });

function stateOf(player) {
  if (!states.has(player)) states.set(player, { kills: [], fight: null });
  return states.get(player);
}

function fightOf(player) {
  return states.get(player)?.fight ?? null;
}

function immune(player) {
  return player.getCombat?.()?.getPoisonImmunityTimer?.()?.finished?.() === false;
}

/** Araxxor spawned for this player: a fight starts. */
function spawned(player, boss) {
  const at = boss.getLocation();
  stateOf(player).fight = {
    spawnedAt: tick(),
    bossTile: { x: at.getX(), y: at.getY() },
    avoidableDamage: 0,
    hitEnraged: false,
    immune: immune(player),
    eggsDestroyed: 0,
    moved: false,
  };
}

/** Each tick in the lair: venom or poison immunity, and whether she has moved. */
function tickPlayer(player, boss) {
  const fight = fightOf(player);
  if (!fight) return;
  if (immune(player)) fight.immune = true;
  if (!boss?.isRegistered?.() || boss.getAttribute?.(Shared.ATTR_DYING) === true) return;
  const at = boss.getLocation();
  if (at.getX() !== fight.bossTile.x || at.getY() !== fight.bossTile.y) fight.moved = true;
}

/** Damage Perfect Araxxor forbids: her ranged and magic, unprayed melee, minions, acid. */
function avoidableDamage(player, amount) {
  const fight = player ? fightOf(player) : null;
  if (fight && amount > 0) fight.avoidableDamage += amount;
}

/** One explosion killed `kills` other araxytes. */
function betrayal(player, kills) {
  if (player && kills >= BETRAYAL_KILLS) complete(player, "Araxyte Betrayal");
}

/** Hits the engine resolves: hers and her minions' on the player, the player's on her. */
function hitResolved({ attacker, target, hit }) {
  const damage = hit?.getTotalDamage?.() ?? 0;
  if (attacker?.isNpc?.() && target?.isPlayer?.()) {
    const id = attacker.getId?.();
    if (MINION_IDS.has(id)) {
      avoidableDamage(target.getAsPlayer(), damage);
    } else if (id === Shared.BOSS_ID) {
      const player = target.getAsPlayer();
      const distant = hit.araxxorKind === Shared.Attack.RANGED || hit.araxxorKind === Shared.Attack.MAGIC;
      if (distant || !PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MELEE)) avoidableDamage(player, damage);
    }
    return;
  }
  if (attacker?.isPlayer?.() && target?.getId?.() === Shared.BOSS_ID
    && target.getAttribute?.(Shared.ATTR_ENRAGED) === true) {
    const fight = fightOf(attacker.getAsPlayer());
    if (fight) fight.hitEnraged = true;
  }
}

/** An egg killed before it hatched counts for Relaxxor. */
function npcDeath({ npc }) {
  if (!EGG_IDS.has(npc?.getId?.())) return;
  const player = npc.getAttribute?.(Shared.ATTR_ENCOUNTER)?.player ?? null;
  const fight = player ? fightOf(player) : null;
  if (fight) fight.eggsDestroyed += 1;
}

/**
 * Araxxor is dead: the kill goes to Combat Achievements, `announce(kills)` tells the player
 * (with Combat Achievements' total, or `ownKills` when it is not running) before any task
 * message, as live orders them, and then the tasks the fight earned are finished. Returns
 * Combat Achievements' total, or null.
 */
function killed(player, ownKills, announce) {
  let announced = false;
  const request = {
    player,
    monster: MONSTER,
    count: ownKills,
    announce: (kills) => {
      announced = true;
      announce?.(kills);
    },
  };
  api.emitCustomEvent("combat-achievements:kill", request);
  const total = Number.isInteger(request.total) ? request.total : null;
  if (!announced) announce?.(ownKills);

  const state = stateOf(player);
  const fight = state.fight;
  state.fight = null;
  if (!fight) return total;
  const now = tick();
  state.kills.push({ spawnedAt: fight.spawnedAt, killedAt: now });
  for (const [task, kills] of SPEED) {
    const first = state.kills[state.kills.length - kills];
    if (first && now - first.spawnedAt <= SPEED_LIMIT_TICKS) complete(player, task);
  }
  if (state.kills.length >= ARACHNID_LOVER_KILLS) complete(player, "Arachnid Lover");
  if (fight.eggsDestroyed >= RELAXXOR_EGGS) complete(player, "Relaxxor");
  if (!fight.immune) complete(player, "Let it seep in");
  if (!fight.moved) complete(player, "Swimming in Venom");
  if (fight.avoidableDamage === 0) {
    complete(player, "Perfect Araxxor");
    if (!fight.hitEnraged) complete(player, "Perfect Araxxor 2");
  }
  return total;
}

/** Leaving the lair ends the run of kills. */
function left(player) {
  states.delete(player);
}

function answerKillCount({ player, counts }) {
  const kills = Number(player.getAttribute(Shared.ATTR_KILLS)) || 0;
  if (kills > 0) counts[MONSTER] = kills;
}

function answerPersonalBest(request) {
  if (request.monster !== MONSTER) return;
  const best = Number(request.player.getAttribute(Shared.ATTR_BEST_TICKS)) || 0;
  if (best > 0) request.best = best;
}

function resetBest(request) {
  if (request.monster !== MONSTER) return;
  request.player.setAttribute(Shared.ATTR_BEST_TICKS, null);
  request.handled = true;
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  PrayerHandler = pluginApi.getPrayerHandler();
  pluginApi.onCombatHitResolved(hitResolved);
  pluginApi.onNpcDeath(npcDeath);
  pluginApi.onCustomEvent("combat-achievements:kill-count", answerKillCount);
  pluginApi.onCustomEvent("combat-achievements:personal-best", answerPersonalBest);
  pluginApi.onCustomEvent("combat-achievements:reset-best", resetBest);
}

module.exports = {
  attach,
  spawned,
  tick: tickPlayer,
  avoidableDamage,
  betrayal,
  hitResolved,
  npcDeath,
  killed,
  left,
  _test: { states, SPEED_LIMIT_TICKS },
};
