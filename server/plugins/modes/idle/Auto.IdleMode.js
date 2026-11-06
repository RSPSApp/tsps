/**
 * Auto-resume for idle accounts (plugins/modes/data/idle-mode.json "auto"). The last thing an idle
 * player clicked that led to an idle skill's gather (a "Willow tree", "Chop down"; a "Fishing spot",
 * "Lure") is remembered with where it happened, and saved with the account. When the gathering
 * stops (nothing gathered for `restartAfterSeconds`), the character walks to the nearest one of the
 * same name around that place and uses the same option, as a click would. It leaves the player be
 * while they are busy, moving, fighting, or more than `leashTiles` from the place: walking off to
 * do something else pauses it, coming back resumes it. Clicking something else (another object or
 * NPC, an attack) pauses it until the next gather. A try that gathers nothing (a rock out of reach
 * from this side) leaves that one alone for `skipSeconds` and tries the next nearest; after
 * `maxFailedAttempts` such tries in a row (no axe, too low a level) it pauses, said once.
 * `::idle auto on|off` switches it.
 */
const Common = require("./Common.IdleMode");
const Combat = require("./Combat.IdleMode");
const Production = require("./Production.IdleMode");
const Thieving = require("./Thieving.IdleMode");

const { chebyshev } = Common;

/** Saved: { skill, kind: "object" | "npc", name, option, anchor: { x, y, z } }. */
const TARGET_ATTRIBUTE = Common.GATHER_TARGET_ATTRIBUTE;
const AUTO_ATTRIBUTE = Common.AUTO_ATTRIBUTE;

/** player -> the last object or NPC option clicked: { kind, name, option, at }. */
const clicks = new Map();
/**
 * player -> { lastGatherAt, lastAttemptAt, failedAttempts, paused: null | "click" | "stuck",
 * lastEntity (what the last try used), skips (entity -> until when it is left alone) }.
 */
const states = new Map();
/** Idle players with a remembered target, looked at every few ticks. */
const tracked = new Set();

function config() {
  return Common.data.auto;
}

function stateOf(player) {
  let state = states.get(player);
  if (!state) {
    states.set(player, (state = { lastGatherAt: 0, lastAttemptAt: 0, failedAttempts: 0, paused: null, lastEntity: null, skips: new Map() }));
  }
  return state;
}

function autoOn(player) {
  return config().enabled && Common.autoOn(player);
}

function remember(player, kind, name, option) {
  if (!name || !option || !Common.isIdle(player)) return;
  const click = { kind, name, option, at: Date.now() };
  clicks.set(player, click);
  // The player doing something else: leave them to it until they gather again.
  if (!sameTarget(player.getAttribute(TARGET_ATTRIBUTE), click) && !stateOf(player).paused) {
    stateOf(player).paused = "click";
    Common.changed(player);
  }
}

function observeObject(event) {
  const definition = event.definition ?? event.object?.getDefinition?.();
  remember(event.player, "object", definition?.getName?.(), event.option ?? definition?.getInteractions?.()?.[event.clickType - 1]);
}

function observeNpc(event) {
  const definition = event.definition ?? event.npc?.getDefinition?.();
  remember(event.player, "npc", definition?.getName?.(), definition?.getActions?.()?.[event.clickType - 1]);
}

/** `onNpcAttackOption`: an attack is something else too. */
function observeAttack(event) {
  remember(event.player, "attack", event.npc?.getDefinition?.()?.getName?.(), "Attack");
}

function sameTarget(a, b) {
  return !!a && !!b && a.kind === b.kind && a.name === b.name && a.option.toLowerCase() === b.option.toLowerCase();
}

/** `storage:gather`: an idle skill gathered; a click just before it becomes the target. */
function gathered(request) {
  const { player } = request;
  if (!Common.idleGather(player, request.skill)) return;
  const now = Date.now();
  const state = stateOf(player);
  state.lastGatherAt = now;
  state.failedAttempts = 0;
  if (state.paused) {
    state.paused = null;
    Common.changed(player);
  }
  const click = clicks.get(player);
  if (!click || now - click.at > config().rememberClickSeconds * 1000) return;
  clicks.delete(player);
  const location = player.getLocation();
  const previous = player.getAttribute(TARGET_ATTRIBUTE);
  const keepAnchor = sameTarget(previous, click) && previous.anchor.z === location.getZ() &&
    chebyshev(location, previous.anchor) <= config().searchTiles;
  // One activity at a time: gathering now replaces idle combat's and production's targets.
  Common.setActivity(player, TARGET_ATTRIBUTE, {
    skill: Common.skillKey(request.skill),
    kind: click.kind,
    name: click.name,
    option: click.option,
    anchor: keepAnchor ? previous.anchor : { x: location.getX(), y: location.getY(), z: location.getZ() },
  });
  tracked.add(player);
  Common.changed(player);
}

/** `thieving:done`: a pickpocket that failed (a stun) was still work, not a try that went nowhere. */
function stolen({ player, succeeded }) {
  if (succeeded || !Common.idleGather(player, Common.core.Skill.THIEVING) || !player.getAttribute(TARGET_ATTRIBUTE)) return;
  const state = stateOf(player);
  state.lastGatherAt = Date.now();
  state.failedAttempts = 0;
}

function optionIndex(options, option) {
  const wanted = option.toLowerCase();
  return (options ?? []).findIndex((entry) => typeof entry === "string" && entry.toLowerCase() === wanted) + 1;
}

/** The nearest object called `name` with `option` around the anchor that `usable` allows. */
function findObject(player, target, usable) {
  const { MapObjects } = Common.core;
  const { anchor } = target;
  const radius = config().searchTiles;
  const here = player.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (let x = anchor.x - radius; x <= anchor.x + radius; x++) {
    for (let y = anchor.y - radius; y <= anchor.y + radius; y++) {
      // The map's objects (trees, rocks) and the ones placed at runtime are both in MapObjects.
      for (const object of MapObjects.mapObjects.get(MapObjects.getHash(x, y, anchor.z)) ?? []) {
        const definition = object.getDefinition?.();
        if (definition?.getName?.() !== target.name || optionIndex(definition.getInteractions?.(), target.option) === 0) continue;
        if (!usable(object)) continue;
        const distance = Math.max(Math.abs(here.getX() - x), Math.abs(here.getY() - y));
        if (distance < bestDistance) {
          best = object;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

function findNpc(player, target, usable) {
  const { Location, World } = Common.core;
  const { anchor } = target;
  const here = player.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (const npc of World.getNpcsNear(new Location(anchor.x, anchor.y, anchor.z), config().searchTiles)) {
    const definition = npc.getDefinition?.();
    if (npc.isRegistered?.() === false || definition?.getName?.() !== target.name) continue;
    if (optionIndex(definition.getActions?.(), target.option) === 0 || !usable(npc)) continue;
    const distance = chebyshev(here, { x: npc.getLocation().getX(), y: npc.getLocation().getY() });
    if (distance < bestDistance) {
      best = npc;
      bestDistance = distance;
    }
  }
  return best;
}

function at(entity) {
  const location = entity.getLocation();
  return { x: location.getX(), y: location.getY(), z: location.getZ() };
}

/** Walks to the object and uses the option on arrival, as a click would. */
function useObject(player, object, target) {
  player.getMovementQueue().walkToObject(object, {
    execute: () => {
      const clickType = optionIndex(object.getDefinition().getInteractions(), target.option);
      player.setPositionToFace(object.getLocation());
      Common.act(player, () => Common.api.emitObjectInteraction({
        player, object, objectId: object.getId(), clickType, location: at(object), sourceLocation: at(player), handled: false,
      }));
    },
  });
}

function useNpc(player, npc, target) {
  player.getMovementQueue().walkToEntity(npc, () => {
    const clickType = optionIndex(npc.getDefinition().getActions(), target.option);
    player.setPositionToFace(npc.getLocation());
    Common.act(player, () => Common.api.emitNpcInteraction({
      player, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), clickType, location: at(npc), handled: false,
    }));
  }, 1);
}

/** One look at a tracked player: resumes the gathering when it has stopped. "resumed" when it did. */
function resume(player, now) {
  const target = player.getAttribute(TARGET_ATTRIBUTE);
  if (!target || !autoOn(player)) return "off";
  const state = stateOf(player);
  if (state.paused) return "paused";
  const { restartAfterSeconds, retrySeconds, leashTiles, maxFailedAttempts } = config();
  if (now - state.lastGatherAt < restartAfterSeconds * 1000 || now - state.lastAttemptAt < retrySeconds * 1000) return "gathering";
  if (!Common.mayWork(player)) return "busy";
  const location = player.getLocation();
  if (location.getZ() !== target.anchor.z || chebyshev(location, target.anchor) > leashTiles) return "away";
  // The last try gathered nothing: leave that one alone a while, and after a few such tries stop
  // until the player gathers again.
  if (state.lastEntity && state.lastAttemptAt > state.lastGatherAt) {
    state.skips.set(state.lastEntity, now + config().skipSeconds * 1000);
    state.lastEntity = null;
    if (++state.failedAttempts >= maxFailedAttempts) {
      state.paused = "stuck";
      Common.changed(player);
      player.sendMessage(`Auto-resume has paused: your character can't ${target.option.toLowerCase()} the ${target.name.toLowerCase()}. Gather again to restart it.`);
      return "paused";
    }
  }
  // A pickpocket can hurt: eat first, or wait to heal with no food left.
  if (target.skill === "THIEVING" && target.kind === "npc") {
    const health = Thieving.health(player);
    if (health !== "ok") return health;
  }
  const usable = (entity) => !(state.skips.get(entity) > now);
  const entity = target.kind === "npc" ? findNpc(player, target, usable) : findObject(player, target, usable);
  if (!entity) return "none";
  if (!Common.mayWork(player)) return "busy";
  state.lastAttemptAt = now;
  state.lastEntity = entity;
  if (target.kind === "npc") useNpc(player, entity, target);
  else useObject(player, entity, target);
  return "resumed";
}

function tick() {
  const now = Date.now();
  for (const player of tracked) {
    if (player.isRegistered?.() === false) {
      forget(player);
      continue;
    }
    resume(player, now);
  }
}

function forget(player) {
  tracked.delete(player);
  states.delete(player);
  clicks.delete(player);
}

function login({ player }) {
  if (player.getAttribute(TARGET_ATTRIBUTE)) tracked.add(player);
}

function logout({ player }) {
  forget(player);
}

function describe(player) {
  const target = player.getAttribute(TARGET_ATTRIBUTE);
  const fight = player.getAttribute(Common.COMBAT_TARGET_ATTRIBUTE);
  const state = player.getAttribute(AUTO_ATTRIBUTE) === false ? "off" : "on";
  if (fight) return `Auto-resume is ${state}: fight the nearest ${fight.name.toLowerCase()} here.`;
  const make = player.getAttribute(Common.PRODUCTION_TARGET_ATTRIBUTE);
  if (make) return `Auto-resume is ${state}: ${Production.doing(make).toLowerCase()} from your bank here.`;
  if (!target) return `Auto-resume is ${state}. Start gathering, fighting or making something and your character will keep at it.`;
  return `Auto-resume is ${state}: ${target.option.toLowerCase()} the nearest ${target.name.toLowerCase()} here.`;
}

/** Turns auto-resume (gathering and combat) on or off; on also lifts a pause. */
function setAuto(player, enabled) {
  player.setAttribute(AUTO_ATTRIBUTE, enabled === true);
  if (enabled) {
    const state = stateOf(player);
    state.paused = null;
    state.failedAttempts = 0;
    state.lastEntity = null;
    state.skips.clear();
    Combat.unpause(player);
    Production.unpause(player);
  }
  Common.changed(player);
}

/**
 * Makes `target` ({ skill, kind, name, option, anchor }) what auto-resume gathers, at once and
 * unpaused (a travel to it). One activity at a time: idle combat's target goes.
 */
function adopt(player, target) {
  Common.setActivity(player, TARGET_ATTRIBUTE, target);
  const state = stateOf(player);
  state.paused = null;
  state.failedAttempts = 0;
  state.lastGatherAt = 0;
  state.lastAttemptAt = 0;
  state.lastEntity = null;
  state.skips.clear();
  clicks.delete(player);
  tracked.add(player);
  Common.changed(player);
}

/** Why gathering auto-resume is paused ("click", "stuck"), or null. */
function pausedFor(player) {
  return states.get(player)?.paused ?? null;
}

/** `::idle auto [on|off]`; turning it on also lifts a pause. */
function autoCommand(player, choice) {
  if (choice === "on") setAuto(player, true);
  else if (choice === "off") setAuto(player, false);
  else if (choice) {
    player.sendMessage("Use ::idle auto on or ::idle auto off.");
    return;
  }
  player.sendMessage(describe(player));
}

function startTask() {
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class AutoResumeTask extends Task {
    constructor() { super(Math.max(1, config().tickInterval | 0)); }
    execute() { tick(); }
  })());
}

module.exports = function attach(api) {
  api.persistAttribute(TARGET_ATTRIBUTE, null);
  api.persistAttribute(AUTO_ATTRIBUTE, true);
  api.onBeforeObjectInteraction(observeObject);
  api.onBeforeNpcInteraction(observeNpc);
  api.onNpcAttackOption(observeAttack);
  api.onCustomEvent("storage:gather", gathered);
  api.onCustomEvent("thieving:done", stolen);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onServerStartup(startTask);
};

module.exports.TARGET_ATTRIBUTE = TARGET_ATTRIBUTE;
module.exports.AUTO_ATTRIBUTE = AUTO_ATTRIBUTE;
module.exports.autoCommand = autoCommand;
module.exports.resume = resume;
module.exports.stateOf = stateOf;
module.exports.setAuto = setAuto;
module.exports.adopt = adopt;
module.exports.pausedFor = pausedFor;
module.exports.tick = tick;
module.exports.tracked = tracked;
