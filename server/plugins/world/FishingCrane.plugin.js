"use strict";

/**
 * Fishing cranes in Port Piscarilius (object 27555 broken, 27556 repaired):
 * https://oldschool.runescape.wiki/w/Fishing_Crane
 *
 * Needs 30 Crafting and 30 Construction, a hammer, three planks of one type and nine nails.
 * The first attempt is made on the tick after Repair, then every ten ticks while it keeps
 * failing; each failure bends one nail. Success rolls on the higher visible Crafting or
 * Construction level (16% at 1, 30% at 99) and immediately awards every character within reach
 * who is still repairing a crane within ten ticks of their last attempt, consuming nine nails
 * and three planks from each; another player's success interrupts their attempt. A repaired
 * crane falls back into disrepair after 30-60 seconds.
 *
 * Repeated clicks under seven ticks cancel the automatic attempts; the same seven-tick lock
 * prevents starting another crane. Logout, disconnect and death end the attempt. Walking away
 * does not (Wiki: the ten-tick window, not the animation, is what matters).
 *
 * The success chance is the standard skilling roll fitted to the Wiki's chart (41/256 at level
 * 1 and 76/256 at 99). The requirement, hammer, plank, nail and bent-nail lines are calibrated:
 * the Wiki documents the checks and the success line, not those wording details.
 */

const HAMMERS = [2347, 2348];
const PLANKS = [960, 8778, 8780, 8782];
const NAILS = [4819, 4820, 4821, 4822, 4823, 4824];
const BROKEN = 27555;
const REPAIRED = 27556;
const LEVEL = 30;
const PLANKS_PER_REPAIR = 3;
const NAILS_PER_REPAIR = 9;
const ATTEMPT_TICKS = 10;
const RETRY_LOCK_TICKS = 7;
/** "Close enough to the repaired crane": the Wiki gives no number; this is its working reach. */
const SHARE_RADIUS = 8;
/** 30-60 seconds between the repaired crane and it breaking again. */
const MIN_REPAIR_TICKS = 50;
const MAX_REPAIR_TICKS = 100;
/** Standard OSRS skilling roll, 256ths: 41 at level 1 to 76 at 99. */
const LOW = 41;
const HIGH = 76;

const MESSAGES = {
  level: `You need a Crafting and Construction level of ${LEVEL} to repair the fishing crane.`,
  hammer: "You need a hammer to repair the fishing crane.",
  planks: "You need three planks of the same type to repair the fishing crane.",
  nails: `You need at least ${NAILS_PER_REPAIR} nails to repair the fishing crane.`,
  repaired: "You successfully repair the fishing crane.",
  bent: "You bend a nail.",
};

let api;
let core;
let currentTick = 0;
const sessions = new Map();
const lastAttempt = new Map();

function amount(player, ids) {
  const inventory = player.getInventory();
  return ids.reduce((total, id) => total + inventory.getAmount(id), 0);
}

function take(player, ids, wanted) {
  const inventory = player.getInventory();
  let left = wanted;
  for (const id of ids) {
    if (left <= 0) return;
    const taken = Math.min(left, inventory.getAmount(id));
    if (taken > 0) {
      inventory.deleteNumber(id, taken);
      left -= taken;
    }
  }
}

/** The first plank type the player has three of, or 0. */
function plankType(player) {
  return PLANKS.find((id) => player.getInventory().getAmount(id) >= PLANKS_PER_REPAIR) ?? 0;
}

/** 16% at level 1 rising to 30% at level 99 on the higher visible skill. */
function successChance(level) {
  const capped = Math.min(99, Math.max(1, level));
  return (1 + Math.floor((LOW * (99 - capped)) / 98 + (HIGH * (capped - 1)) / 98 + 0.5)) / 256;
}

function levels(player) {
  const skills = player.getSkillManager();
  return {
    crafting: skills.getCurrentLevel(core.Skill.CRAFTING),
    construction: skills.getCurrentLevel(core.Skill.CONSTRUCTION),
  };
}

function stopSession(player) {
  sessions.delete(player);
}

function cleanup(player) {
  sessions.delete(player);
  lastAttempt.delete(player);
}

/** Recheck supplies when an automatic attempt or shared completion can award XP. */
function supplies(player, selectedPlank) {
  const { crafting, construction } = levels(player);
  if (crafting < LEVEL || construction < LEVEL) {
    player.sendMessage(MESSAGES.level);
    return 0;
  }
  if (amount(player, HAMMERS) <= 0) {
    player.sendMessage(MESSAGES.hammer);
    return 0;
  }
  const plank = selectedPlank ?? plankType(player);
  if (!plank || player.getInventory().getAmount(plank) < PLANKS_PER_REPAIR) {
    player.sendMessage(MESSAGES.planks);
    return 0;
  }
  if (amount(player, NAILS) < NAILS_PER_REPAIR) {
    player.sendMessage(MESSAGES.nails);
    return 0;
  }

  return plank;
}

function repair(event) {
  const { player, object } = event;
  if (event.objectId !== BROKEN || object?.getId?.() === REPAIRED) return false;
  const now = currentTick;
  const session = sessions.get(player);
  const last = lastAttempt.get(player);

  // A repeated click under the seventh tick cancels the automatic attempts; the same lock
  // stops a fresh crane before its seven ticks are up.
  if (session && now - session.lastAttemptTick < RETRY_LOCK_TICKS) {
    stopSession(player);
    return true;
  }
  if (!session && last != null && now - last < RETRY_LOCK_TICKS) return true;

  const plank = supplies(player);
  if (!plank) return true;

  const started = {
    object,
    objectId: BROKEN,
    x: object?.getLocation?.()?.getX?.(),
    y: object?.getLocation?.()?.getY?.(),
    z: object?.getLocation?.()?.getZ?.(),
    plank,
    lastAttemptTick: now,
    nextAttemptTick: now + ATTEMPT_TICKS,
  };
  sessions.set(player, started);
  lastAttempt.set(player, now);
  attempt(player, started, now);
  return true;
}

function attempt(player, session, now) {
  if (session.object?.getId?.() !== BROKEN) {
    stopSession(player);
    return;
  }
  if (!supplies(player, session.plank)) {
    stopSession(player);
    return;
  }
  session.lastAttemptTick = now;
  lastAttempt.set(player, now);
  session.nextAttemptTick = now + ATTEMPT_TICKS;
  const { crafting, construction } = levels(player);
  if (Math.random() < successChance(Math.max(crafting, construction))) {
    complete(player, session, now);
    return;
  }
  if (amount(player, NAILS) <= 0) {
    player.sendMessage(MESSAGES.nails);
    stopSession(player);
    return;
  }
  take(player, NAILS, 1);
  player.sendMessage(MESSAGES.bent);
}

function distanceTo(session, object) {
  const target = object?.getLocation?.();
  if (!target || session.x == null || session.y == null) return Infinity;
  if (session.z !== target.getZ?.()) return Infinity;
  return Math.max(Math.abs(session.x - target.getX()), Math.abs(session.y - target.getY()));
}

function complete(initiator, initiatorSession, now) {
  const object = initiatorSession.object;
  const participants = [];
  for (const [player, session] of sessions) {
    if (player.getHitpoints?.() <= 0 || player.isRegistered?.() === false) continue;
    if (now - session.lastAttemptTick > ATTEMPT_TICKS) continue;
    if (distanceTo(session, object) > SHARE_RADIUS) continue;
    participants.push([player, session]);
  }
  if (!participants.some(([player]) => player === initiator)) {
    participants.push([initiator, initiatorSession]);
  }

  for (const [player, session] of participants) {
    if (!supplies(player, session.plank)) {
      stopSession(player);
      continue;
    }
    const own = levels(player);
    take(player, [session.plank], PLANKS_PER_REPAIR);
    take(player, NAILS, NAILS_PER_REPAIR);
    player.getSkillManager().addExperiences(core.Skill.CRAFTING, own.crafting * 4);
    player.getSkillManager().addExperiences(core.Skill.CONSTRUCTION, own.construction * 4);
    player.sendMessage(MESSAGES.repaired);
    stopSession(player);
    api.emitCustomEvent("piscarilius-crane:repaired", {
      player, objectId: BROKEN, repairedBy: initiator,
    });
  }

  replaceRepaired(object);
}

function replaceRepaired(object) {
  if (!object || object.getId?.() !== BROKEN) return;
  const location = object.getLocation();
  const repaired = new core.GameObject(
    REPAIRED,
    new core.Location(location.getX(), location.getY(), location.getZ()),
    object.getType(),
    object.getFace(),
    null,
  );
  const ticks = MIN_REPAIR_TICKS + Math.floor(Math.random() * (MAX_REPAIR_TICKS - MIN_REPAIR_TICKS + 1));
  api.getTaskManager().submit(new core.TimedObjectReplacementTask(object, repaired, ticks));
}

function processTick(now) {
  for (const [player, session] of sessions) {
    if (player.isRegistered?.() === false || player.getHitpoints?.() <= 0) {
      cleanup(player);
      continue;
    }
    if (session.object?.getId?.() !== BROKEN) {
      stopSession(player);
      continue;
    }
    if (now >= session.nextAttemptTick) attempt(player, session, now);
  }
}

function onPlayerLogout({ player }) {
  cleanup(player);
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onObjectInteraction("Fishing Crane", { Repair: repair });
  pluginApi.onPlayerLogout(onPlayerLogout);
  pluginApi.onPlayerDisconnect(onPlayerLogout);
  pluginApi.onPlayerDeath(onPlayerLogout);
  pluginApi.getTaskManager().submit(new (class FishingCraneTask extends core.Task {
    constructor() { super(1); }
    execute() {
      currentTick++;
      processTick(currentTick);
    }
  })());
}

module.exports = {
  name: "FishingCrane",
  members: true,
  register(pluginApi) {
    attach(pluginApi);
  },
  _test: {
    HAMMERS, PLANKS, NAILS, BROKEN, REPAIRED, LEVEL, PLANKS_PER_REPAIR, NAILS_PER_REPAIR,
    ATTEMPT_TICKS, RETRY_LOCK_TICKS, SHARE_RADIUS, MESSAGES,
    amount, take, plankType, successChance, repair, attempt, complete, replaceRepaired, processTick,
    sessions, lastAttempt, cleanup,
    setTick(value) { currentTick = value; },
    get tick() { return currentTick; },
  },
};
