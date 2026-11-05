/**
 * Idle combat (plugins/modes/data/idle-mode.json "combat"). An idle player who attacks a monster
 * (`onNpcAttackOption`) and kills it within `rememberAttackSeconds` makes that monster's name the
 * target, with where they stood, saved with the account. Every few ticks, for an idle player with a
 * target and auto-resume on:
 *
 * - below `eatBelowPercent` hitpoints it eats the first food in the inventory (an "Eat" option),
 *   as a click would; below `stopBelowPercent` with no food left it stops and says so;
 * - attacked while not attacking, it fights back;
 * - otherwise, free and within `leashTiles` of the place, it attacks the nearest monster of that
 *   name within `searchTiles` that it may attack and no other player is fighting.
 *
 * Clicking something else (an object, an NPC option, another kind of monster) pauses it until the
 * next kill of the target. A monster attacked that is still alive, unfought, at the next look (the
 * attack never took: out of reach) is left alone for `skipSeconds`, and after `maxFailedAttempts`
 * attacks in a row with no kill it pauses, said once. `::idle auto on` lifts a pause. Pressing logout or losing the
 * connection stops it starting new fights, so the 10 seconds after combat can pass and the
 * player leaves (with the offline progress).
 *
 * The loot of a kill of the target (or of a monster just chosen) goes to the bank
 * (`npc-drops:generated`), and each such kill is recorded for the offline progress, with the
 * combat skills' XP; a monster that came at a gathering player changes nothing. One activity at a time: a kill replaces the
 * gathering target and a gather replaces this one.
 */
const Common = require("./Common.IdleMode");
const Offline = require("./Offline.IdleMode");

const TARGET_ATTRIBUTE = Common.COMBAT_TARGET_ATTRIBUTE;

/** player -> the last monster the player chose to attack: { name, at }. */
const attacks = new Map();
/**
 * player -> { lastAttemptAt, warned, failedAttempts, paused: null | "click" | "stuck" | "logout",
 * lastNpc (the last attacked), skips (npc -> until when it is left alone) }.
 */
const states = new Map();
const tracked = new Set();

function config() {
  return Common.data.combat;
}

function stateOf(player) {
  let state = states.get(player);
  if (!state) {
    states.set(player, (state = { lastAttemptAt: 0, warned: false, failedAttempts: 0, paused: null, lastNpc: null, skips: new Map() }));
  }
  return state;
}

function active(player) {
  return config().enabled && Common.autoOn(player);
}

function npcName(npc) {
  return npc?.getDefinition?.()?.getName?.() ?? null;
}

function attackChosen({ player, npc }) {
  const name = npcName(npc);
  if (!name || !Common.isIdle(player) || !config().enabled) return;
  attacks.set(player, { name, at: Date.now() });
  if (player.getAttribute(TARGET_ATTRIBUTE)?.name !== name) pause(player);
}

/** The player doing something else: leave them to it until the next kill of the target. */
function pause(player) {
  if (!player.getAttribute(TARGET_ATTRIBUTE) || stateOf(player).paused) return;
  stateOf(player).paused = "click";
  Common.changed(player);
}

function otherClick({ player }) {
  if (Common.isIdle(player)) pause(player);
}

/**
 * Makes `target` ({ name, anchor }) what idle combat fights, at once and unpaused (a travel to
 * it). One activity at a time: the gathering target goes.
 */
function adopt(player, target) {
  Common.setActivity(player, TARGET_ATTRIBUTE, target);
  const state = stateOf(player);
  state.paused = null;
  state.failedAttempts = 0;
  state.lastAttemptAt = 0;
  state.lastNpc = null;
  state.skips.clear();
  attacks.delete(player);
  tracked.add(player);
  Common.changed(player);
}

/** Logout pressed (`onCanLogout`, answered by others) or the connection lost: no new fights. */
function leaving({ player }) {
  if (player.getAttribute(TARGET_ATTRIBUTE) && Common.isIdle(player)) stateOf(player).paused = "logout";
}

/** `::idle auto on` lifts a pause. */
function unpause(player) {
  const state = stateOf(player);
  state.paused = null;
  state.failedAttempts = 0;
  state.lastNpc = null;
  state.skips.clear();
}

/** `npc-drops:generated`: an idle kill. Banks the loot, records it, and may set the target. */
function killed(event) {
  const { player, npc, drops } = event;
  if (!player || !Common.isIdle(player) || !config().enabled) return;
  const items = {};
  for (const drop of drops ?? []) {
    if (Number.isInteger(drop.itemId) && drop.amount > 0) items[drop.itemId] = (items[drop.itemId] ?? 0) + drop.amount;
  }
  const attack = attacks.get(player);
  const name = npcName(npc);
  const chosen = attack?.name === name && Date.now() - attack.at <= config().rememberAttackSeconds * 1000;
  const previous = player.getAttribute(TARGET_ATTRIBUTE);
  // Only the monster being trained counts: one that came at a gathering player does not.
  if (!chosen && previous?.name !== name) return;
  const state = stateOf(player);
  state.paused = null;
  state.failedAttempts = 0;
  if (state.lastNpc === npc) state.lastNpc = null;
  if (config().bankLoot && Array.isArray(drops)) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const drop = drops[i];
      if (Number.isInteger(drop.itemId) && drop.amount > 0 && Common.bank(player, drop.itemId, drop.amount)) drops.splice(i, 1);
    }
  }
  Offline.record(player, "COMBAT", Common.combatSkillList(), items, config().maxGapSeconds);
  if (!chosen) return;
  const location = player.getLocation();
  const keepAnchor = previous?.name === name && previous.anchor.z === location.getZ() &&
    Common.chebyshev(location, previous.anchor) <= config().searchTiles;
  Common.setActivity(player, TARGET_ATTRIBUTE, {
    name,
    anchor: keepAnchor ? previous.anchor : { x: location.getX(), y: location.getY(), z: location.getZ() },
  });
  tracked.add(player);
  Common.changed(player);
}

/** The first food in the inventory: its slot, id and the "Eat" option's click. */
function findFood(player) {
  const items = player.getInventory().getItems();
  for (let slot = 0; slot < items.length; slot++) {
    const itemId = items[slot]?.getId?.();
    if (!Number.isInteger(itemId) || itemId < 0) continue;
    const actions = Common.core.CacheDefinitions.getItem(itemId)?.inventoryActions ?? [];
    const index = actions.findIndex((action) => typeof action === "string" && action.toLowerCase() === "eat");
    if (index >= 0) return { slot, itemId, clickType: index + 1 };
  }
  return null;
}

function eat(player, food) {
  const { ItemActionPacketListener, Inventory } = Common.core;
  ItemActionPacketListener.handleAction(player, Inventory.INTERFACE_ID, food.itemId, food.slot, food.clickType, "Eat");
}

function hitpointsPercent(player) {
  const max = player.getSkillManager().getMaxLevel(Common.core.Skill.HITPOINTS);
  return max > 0 ? (player.getHitpoints() * 100) / max : 100;
}

/** A monster this player may attack: alive, not fought by another player, and allowed. */
function attackable(player, npc) {
  if (npc.isRegistered?.() === false || !(npc.getHitpoints?.() > 0)) return false;
  const fighting = npc.getCombat?.()?.getAttacker?.();
  if (fighting && fighting !== player && fighting.isPlayer?.()) return false;
  const { CombatFactory, CanAttackResponse } = Common.core;
  return CombatFactory.canAttackPermission(player, npc, false, CombatFactory.getMethod(player)) === CanAttackResponse.CAN_ATTACK;
}

function findMonster(player, target, usable) {
  const { Location, World } = Common.core;
  const { anchor } = target;
  const here = player.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (const npc of World.getNpcsNear(new Location(anchor.x, anchor.y, anchor.z), config().searchTiles)) {
    if (npcName(npc) !== target.name || !usable(npc) || !attackable(player, npc)) continue;
    const distance = Common.chebyshev(here, { x: npc.getLocation().getX(), y: npc.getLocation().getY() });
    if (distance < bestDistance) {
      best = npc;
      bestDistance = distance;
    }
  }
  return best;
}

/** One look at a tracked player; what it did ("ate", "attacking", ...) for the tests and logs. */
function fight(player, now) {
  const target = player.getAttribute(TARGET_ATTRIBUTE);
  if (!target || !active(player)) return "off";
  const state = stateOf(player);
  if (state.paused) return "paused";
  const hp = hitpointsPercent(player);
  if (hp < config().eatBelowPercent) {
    const food = findFood(player);
    if (food) {
      eat(player, food);
      return "ate";
    }
    if (hp < config().stopBelowPercent) {
      if (!state.warned) player.sendMessage("You're out of food: idle combat waits until you have healed.");
      state.warned = true;
      return "low";
    }
  }
  state.warned = false;
  const combat = player.getCombat();
  if (combat.getTarget()) return "fighting";
  const attacker = combat.getAttacker();
  if (attacker?.isNpc?.() && attacker.getHitpoints?.() > 0) {
    combat.attack(attacker);
    return "retaliating";
  }
  if (!Common.free(player)) return "busy";
  const location = player.getLocation();
  if (location.getZ() !== target.anchor.z || Common.chebyshev(location, target.anchor) > config().leashTiles) return "away";
  if (now - state.lastAttemptAt < config().retrySeconds * 1000) return "waiting";
  // The last one attacked is alive and not being fought: the attack never took (out of reach).
  if (state.lastNpc?.getHitpoints?.() > 0 && state.lastNpc.isRegistered?.() !== false) {
    state.skips.set(state.lastNpc, now + config().skipSeconds * 1000);
  }
  state.lastNpc = null;
  const npc = findMonster(player, target, (candidate) => !(state.skips.get(candidate) > now));
  if (!npc) return "none";
  if (++state.failedAttempts > config().maxFailedAttempts) {
    state.paused = "stuck";
    Common.changed(player);
    player.sendMessage(`Idle combat has paused: your character can't get a fight with a ${target.name.toLowerCase()}. Kill one to restart it.`);
    return "paused";
  }
  state.lastAttemptAt = now;
  state.lastNpc = npc;
  combat.attack(npc);
  return "attacking";
}

function tick() {
  const now = Date.now();
  for (const player of tracked) {
    if (player.isRegistered?.() === false) {
      forget(player);
      continue;
    }
    fight(player, now);
  }
}

function forget(player) {
  tracked.delete(player);
  states.delete(player);
  attacks.delete(player);
}

function login({ player }) {
  if (player.getAttribute(TARGET_ATTRIBUTE)) tracked.add(player);
}

function logout({ player }) {
  forget(player);
}

function startTask() {
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class IdleCombatTask extends Task {
    constructor() { super(Math.max(1, config().tickInterval | 0)); }
    execute() { tick(); }
  })());
}

module.exports = function attach(api) {
  api.persistAttribute(TARGET_ATTRIBUTE, null);
  api.onNpcAttackOption(attackChosen);
  api.onBeforeObjectInteraction(otherClick);
  api.onBeforeNpcInteraction(otherClick);
  api.onCanLogout(leaving);
  api.onPlayerDisconnect(leaving);
  api.onCustomEvent("npc-drops:generated", killed);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onServerStartup(startTask);
};

module.exports.TARGET_ATTRIBUTE = TARGET_ATTRIBUTE;
module.exports.fight = fight;
module.exports.unpause = unpause;
module.exports.adopt = adopt;
/** Why idle combat is paused ("click", "stuck", "logout"), or null. */
module.exports.pausedFor = (player) => states.get(player)?.paused ?? null;
module.exports.tracked = tracked;
