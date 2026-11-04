/**
 * Auto-resume for idle accounts (plugins/modes/data/idle-mode.json "auto"). The last thing an idle
 * player clicked that led to an idle skill's gather (a "Willow tree", "Chop down"; a "Fishing spot",
 * "Lure") is remembered with where it happened, and saved with the account. When the gathering
 * stops (nothing gathered for `restartAfterSeconds`), the character walks to the nearest one of the
 * same name around that place and uses the same option, as a click would. It leaves the player be
 * while they are busy, moving, fighting, or more than `leashTiles` from the place: walking off to
 * do something else pauses it, coming back resumes it. `::idle auto on|off` switches it.
 */
const Common = require("./Common.IdleMode");

/** Saved: { skill, kind: "object" | "npc", name, option, anchor: { x, y, z } }. */
const TARGET_ATTRIBUTE = "idle-mode:auto-target";
/** Saved: false when the player turned auto-resume off. */
const AUTO_ATTRIBUTE = "idle-mode:auto";

/** player -> the last object or NPC option clicked: { kind, name, option, at }. */
const clicks = new Map();
/** player -> { lastGatherAt, lastAttemptAt }. */
const states = new Map();
/** Idle players with a remembered target, looked at every few ticks. */
const tracked = new Set();

function config() {
  return Common.data.auto;
}

function stateOf(player) {
  let state = states.get(player);
  if (!state) states.set(player, (state = { lastGatherAt: 0, lastAttemptAt: 0 }));
  return state;
}

function autoOn(player) {
  return config().enabled && Common.isIdle(player) && player.getAttribute(AUTO_ATTRIBUTE) !== false;
}

function remember(player, kind, name, option) {
  if (!name || !option || !Common.isIdle(player)) return;
  clicks.set(player, { kind, name, option, at: Date.now() });
}

function observeObject(event) {
  const definition = event.definition ?? event.object?.getDefinition?.();
  remember(event.player, "object", definition?.getName?.(), event.option ?? definition?.getInteractions?.()?.[event.clickType - 1]);
}

function observeNpc(event) {
  const definition = event.definition ?? event.npc?.getDefinition?.();
  remember(event.player, "npc", definition?.getName?.(), definition?.getActions?.()?.[event.clickType - 1]);
}

function sameTarget(a, b) {
  return !!a && !!b && a.kind === b.kind && a.name === b.name && a.option.toLowerCase() === b.option.toLowerCase();
}

function chebyshev(location, point) {
  return Math.max(Math.abs(location.getX() - point.x), Math.abs(location.getY() - point.y));
}

/** `storage:gather`: an idle skill gathered; a click just before it becomes the target. */
function gathered(request) {
  const { player } = request;
  if (!Common.idleGather(player, request.skill)) return;
  const now = Date.now();
  stateOf(player).lastGatherAt = now;
  const click = clicks.get(player);
  if (!click || now - click.at > config().rememberClickSeconds * 1000) return;
  clicks.delete(player);
  const location = player.getLocation();
  const previous = player.getAttribute(TARGET_ATTRIBUTE);
  const keepAnchor = sameTarget(previous, click) && previous.anchor.z === location.getZ() &&
    chebyshev(location, previous.anchor) <= config().searchTiles;
  player.setAttribute(TARGET_ATTRIBUTE, {
    skill: Common.skillKey(request.skill),
    kind: click.kind,
    name: click.name,
    option: click.option,
    anchor: keepAnchor ? previous.anchor : { x: location.getX(), y: location.getY(), z: location.getZ() },
  });
  tracked.add(player);
}

function optionIndex(options, option) {
  const wanted = option.toLowerCase();
  return (options ?? []).findIndex((entry) => typeof entry === "string" && entry.toLowerCase() === wanted) + 1;
}

/** The nearest object called `name` with `option` around the anchor, nearest the player first. */
function findObject(player, target) {
  const { Location, ObjectManager } = Common.core;
  const { anchor } = target;
  const radius = config().searchTiles;
  const here = player.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (let x = anchor.x - radius; x <= anchor.x + radius; x++) {
    for (let y = anchor.y - radius; y <= anchor.y + radius; y++) {
      for (const object of ObjectManager.objectsAt(new Location(x, y, anchor.z))) {
        const definition = object.getDefinition?.();
        if (definition?.getName?.() !== target.name || optionIndex(definition.getInteractions?.(), target.option) === 0) continue;
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

function findNpc(player, target) {
  const { Location, World } = Common.core;
  const { anchor } = target;
  const here = player.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (const npc of World.getNpcsNear(new Location(anchor.x, anchor.y, anchor.z), config().searchTiles)) {
    const definition = npc.getDefinition?.();
    if (npc.isRegistered?.() === false || definition?.getName?.() !== target.name) continue;
    if (optionIndex(definition.getActions?.(), target.option) === 0) continue;
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
      Common.api.emitObjectInteraction({
        player, object, objectId: object.getId(), clickType, location: at(object), sourceLocation: at(player), handled: false,
      });
    },
  });
}

function useNpc(player, npc, target) {
  player.getMovementQueue().walkToEntity(npc, () => {
    const clickType = optionIndex(npc.getDefinition().getActions(), target.option);
    player.setPositionToFace(npc.getLocation());
    Common.api.emitNpcInteraction({
      player, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), clickType, location: at(npc), handled: false,
    });
  }, 1);
}

/** Whether the player is free for the character to go back to work. */
function free(player) {
  if (player.busy?.() || player.getMovementQueue().size() > 0) return false;
  const combat = player.getCombat?.();
  return !combat?.getTarget?.() && !combat?.getAttacker?.();
}

/** One look at a tracked player: resumes the gathering when it has stopped. "resumed" when it did. */
function resume(player, now) {
  const target = player.getAttribute(TARGET_ATTRIBUTE);
  if (!target || !autoOn(player)) return "off";
  const state = stateOf(player);
  const { restartAfterSeconds, retrySeconds, leashTiles } = config();
  if (now - state.lastGatherAt < restartAfterSeconds * 1000 || now - state.lastAttemptAt < retrySeconds * 1000) return "gathering";
  if (!free(player)) return "busy";
  const location = player.getLocation();
  if (location.getZ() !== target.anchor.z || chebyshev(location, target.anchor) > leashTiles) return "away";
  const entity = target.kind === "npc" ? findNpc(player, target) : findObject(player, target);
  if (!entity) return "none";
  state.lastAttemptAt = now;
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
  const state = player.getAttribute(AUTO_ATTRIBUTE) === false ? "off" : "on";
  if (!target) return `Auto-resume is ${state}. Start gathering and your character will keep at it.`;
  return `Auto-resume is ${state}: ${target.option.toLowerCase()} the nearest ${target.name.toLowerCase()} here.`;
}

/** `::idle auto [on|off]`. */
function autoCommand(player, choice) {
  if (choice === "on") player.setAttribute(AUTO_ATTRIBUTE, true);
  else if (choice === "off") player.setAttribute(AUTO_ATTRIBUTE, false);
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
  api.onCustomEvent("storage:gather", gathered);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onServerStartup(startTask);
};

module.exports.TARGET_ATTRIBUTE = TARGET_ATTRIBUTE;
module.exports.AUTO_ATTRIBUTE = AUTO_ATTRIBUTE;
module.exports.autoCommand = autoCommand;
module.exports.resume = resume;
module.exports.tick = tick;
module.exports.tracked = tracked;
