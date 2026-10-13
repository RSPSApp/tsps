/**
 * Vorkath's Combat Achievements (plugins/combatachievements/) that her fight decides. A fight is
 * timed from her waking (the speed tasks); her specials' damage (acid pools, rapid fire, the
 * zombified spawn's explosion) and the player's prayer are watched through it; kills in a row
 * without leaving her area count for Extended Encounter and, with no special damage, Dodging the
 * Dragon; and an acid phase's hits on her count for The Walk. Her kill count goes by her NPC's
 * death; the melee, fists and zombified spawn tasks are fight rules (combatachievements/tasks/).
 */
const Shared = require("./Shared.Vorkath");

const SPEED = [["Vorkath Speed-Chaser", 75], ["Vorkath Speed-Runner", 54]];
const EXTENDED_ENCOUNTER_KILLS = 10;
const DODGING_KILLS = 5;
const THE_WALK_HITS = 12;

/** player -> { fight, kills, cleanKills, walk } while they are in her area. */
const states = new WeakMap();
let api = null;
let core = null;

const tick = () => core.World.getProcessCycle();
const prayerOf = (player) => player.getSkillManager().getCurrentLevel(core.Skill.PRAYER);
const complete = (player, task) => api.emitCustomEvent("combat-achievements:complete", { player, task });

function stateOf(player) {
  if (!states.has(player)) states.set(player, { fight: null, kills: 0, cleanKills: 0, walk: null });
  return states.get(player);
}

/** She wakes for this player: the fight starts. */
function woke(player) {
  stateOf(player).fight = { startTick: tick(), specialDamage: 0, prayer: prayerOf(player), prayerLost: false };
}

/** Damage from one of her specials; `acid` for the acid phase's pools and rapid fire. */
function specialDamage(player, amount, { acid = false } = {}) {
  const state = states.get(player);
  if (!state || amount <= 0) return;
  if (state.fight) state.fight.specialDamage += amount;
  if (acid && state.walk) state.walk.spoiled = true;
}

/** An acid phase starts against this player. */
function acidStarted(player) {
  stateOf(player).walk = { hits: 0, spoiled: false };
}

function acidEnded(player) {
  const state = states.get(player);
  if (state) state.walk = null;
}

/** onPlayerDealtDamage: hits on her during the acid phase. */
function dealt({ player, target }) {
  const walk = states.get(player)?.walk;
  if (!walk || walk.spoiled || target?.getId?.() !== Shared.AWAKE_ID) return;
  walk.hits++;
  if (walk.hits >= THE_WALK_HITS) {
    walk.spoiled = true;
    complete(player, "The Walk");
  }
}

/** Each tick in her area: has a prayer point gone? */
function tickPlayer(player) {
  const fight = states.get(player)?.fight;
  if (!fight) return;
  const prayer = prayerOf(player);
  if (prayer < fight.prayer) fight.prayerLost = true;
  fight.prayer = prayer;
}

/** She died; `player` killed her. */
function killed(player) {
  const state = states.get(player);
  const fight = state?.fight;
  if (!fight) return;
  state.fight = null;
  const seconds = (tick() - fight.startTick) * 0.6;
  for (const [task, limit] of SPEED) if (seconds < limit) complete(player, task);
  if (!fight.prayerLost) complete(player, "Faithless Encounter");
  state.kills++;
  state.cleanKills = fight.specialDamage === 0 ? state.cleanKills + 1 : 0;
  if (state.kills >= EXTENDED_ENCOUNTER_KILLS) complete(player, "Extended Encounter");
  if (state.cleanKills >= DODGING_KILLS) complete(player, "Dodging the Dragon");
}

/** Leaving her area ends the run of kills. */
function left(player) {
  states.delete(player);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onPlayerDealtDamage(dealt);
}

module.exports = { attach, woke, specialDamage, acidStarted, acidEnded, dealt, tick: tickPlayer, killed, left };
