const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const ObstacleRunner = require("./agility/ObstacleRunner");
const { COURSES } = require("./agility/courses");
const { SHORTCUTS } = require("./agility/shortcuts");

/** Attribute holding { course, index } for the lap in progress. */
const PROGRESS_ATTRIBUTE = "agility.progress";
/** Persisted { [courseKey]: laps } map. */
const LAPS_ATTRIBUTE = "agility.laps";
/**
 * Persisted: the lap count chat message is off (Grace's Toggle Counter). Laps are still
 * counted (OSRS Wiki, Grace).
 */
const LAP_COUNTER_OFF_ATTRIBUTE = "agility.lap-counter-off";

/**
 * Marks of grace appear on rooftop courses while a lap is in progress. One roll per
 * lap, at the first obstacle; players 20+ levels over the course get a lower rate.
 */
const MARK_LAP_CHANCE = 1 / 4;
const MARK_OVERLEVELLED_MULTIPLIER = 0.75;
const MARK_OVERLEVEL_THRESHOLD = 20;

/** objectId -> obstacle entries; entries with `at` only match that object tile. */
const OBSTACLES_BY_OBJECT = new Map();

let pluginApi;
let ItemOnGroundManager;

function indexObstacle(obstacle) {
  const objects = Array.isArray(obstacle.object) ? obstacle.object : [obstacle.object];
  for (const objectId of objects) {
    if (!Number.isInteger(objectId)) {
      throw new Error(`Agility obstacle "${obstacle.course?.name ?? "shortcut"}" has an invalid object id`);
    }
    const entries = OBSTACLES_BY_OBJECT.get(objectId) ?? [];
    entries.push(obstacle);
    OBSTACLES_BY_OBJECT.set(objectId, entries);
  }
}

function buildIndex() {
  for (const course of COURSES) {
    const obstacleXp = new Map();
    for (const obstacle of course.obstacles) {
      obstacle.course = course;
      if (obstacle.index != null) {
        obstacleXp.set(obstacle.index, Math.max(obstacleXp.get(obstacle.index) ?? 0, obstacle.xp ?? 0));
      }
      indexObstacle(obstacle);
    }
    course.finalIndex = Math.max(...obstacleXp.keys());
    // The lap bonus tops a full lap up to the course's published lap experience.
    const lapTotal = [...obstacleXp.values()].reduce((sum, xp) => sum + xp, 0);
    course.lapBonus = Math.max(0, Math.round((course.lapXp - lapTotal) * 10) / 10);
  }
  for (const shortcut of SHORTCUTS) {
    indexObstacle(shortcut);
  }
}

function findObstacle(objectId, location) {
  const entries = OBSTACLES_BY_OBJECT.get(objectId);
  if (!entries || !location) return null;
  return entries.find((entry) => !entry.at || (
    entry.at[0] === location.x && entry.at[1] === location.y && (entry.at[2] ?? location.z) === location.z
  )) ?? null;
}

function objectContext(player, object) {
  const location = object.getLocation();
  const playerLocation = player.getLocation();
  return {
    player,
    object,
    obj: {
      x: location.getX(), y: location.getY(), z: location.getZ(),
      face: object.getFace?.() ?? 0, type: object.getType?.() ?? 10, id: object.getId(),
    },
    pos: { x: playerLocation.getX(), y: playerLocation.getY(), z: playerLocation.getZ() },
  };
}

function resolve(value, context) {
  return typeof value === "function" ? value(context) : value;
}

function agilityLevel(player) {
  return player.getSkillManager().getCurrentLevel(Skill.AGILITY);
}

/**
 * Linear success chance: `base`% at the requirement, rising to certain success at
 * `never`. Obstacles without a `fail` block never fail.
 */
function rollSuccess(player, obstacle, requirement) {
  const fail = obstacle.fail;
  if (!fail) return true;
  const level = agilityLevel(player);
  const never = fail.neverFailLevel ?? requirement + 20;
  if (level >= never) return true;
  const base = fail.baseChance ?? 75;
  const from = fail.fromLevel ?? requirement;
  const chance = base + (Math.max(0, level - from) * (100 - base)) / Math.max(1, never - from);
  return Math.random() * 100 < chance;
}

function getLaps(player) {
  const laps = player.getAttribute(LAPS_ATTRIBUTE);
  return laps && typeof laps === "object" ? laps : {};
}

function completeLap(player, course) {
  const laps = { ...getLaps(player) };
  laps[course.key] = (laps[course.key] ?? 0) + 1;
  player.setAttribute(LAPS_ATTRIBUTE, laps);
  if (course.lapBonus > 0) {
    player.getSkillManager().addExperiences(Skill.AGILITY, course.lapBonus);
  }
  if (!player.getAttribute(LAP_COUNTER_OFF_ATTRIBUTE)) {
    player.sendMessage(`Your ${course.name} lap count is: <col=ff0000>${laps[course.key]}</col>.`);
  }
  pluginApi.emitCustomEvent("agility:lap", { player, course: course.key, laps: laps[course.key] });
  // The giant squirrel rolls once per completed course.
  pluginApi.emitCustomEvent("agility:success", { player, skill: Skill.AGILITY, petBase: course.petBase });
}

/** Grace's Toggle Counter: turns the lap count message off or back on. Guessed messages. */
function toggleLapCounter({ player }) {
  const off = !player.getAttribute(LAP_COUNTER_OFF_ATTRIBUTE);
  player.setAttribute(LAP_COUNTER_OFF_ATTRIBUTE, off);
  player.sendMessage(off
    ? "Your lap count will no longer be shown when you complete a lap."
    : "Your lap count will now be shown when you complete a lap.");
}

/**
 * Tracks lap order: obstacle 1 always starts a lap; any other obstacle only
 * continues it when it directly follows the last one (alternates share an index).
 */
function advanceCourse(player, obstacle) {
  const course = obstacle.course;
  const progress = player.getAttribute(PROGRESS_ATTRIBUTE);
  let next = null;
  if (obstacle.index === 1) {
    next = { course: course.key, index: 1 };
    rollMarkOfGrace(player, course);
  } else if (progress?.course === course.key && progress.index === obstacle.index - 1) {
    next = { course: course.key, index: obstacle.index };
  }
  if (next && obstacle.index === course.finalIndex) {
    player.setAttribute(PROGRESS_ATTRIBUTE, null);
    completeLap(player, course);
    return;
  }
  player.setAttribute(PROGRESS_ATTRIBUTE, next);
}

function rollMarkOfGrace(player, course) {
  const marks = course.marks;
  if (!marks || marks.tiles.length === 0) return;
  let chance = MARK_LAP_CHANCE;
  if (agilityLevel(player) >= marks.level + MARK_OVERLEVEL_THRESHOLD) {
    chance *= MARK_OVERLEVELLED_MULTIPLIER;
  }
  if (Math.random() >= chance) return;
  const tile = marks.tiles[Math.floor(Math.random() * marks.tiles.length)];
  const position = new Location(tile[0], tile[1], tile[2]);
  ItemOnGroundManager.registerNonGlobals(player, new Item(ItemIds.MARK_OF_GRACE, 1), position);
}

function finishObstacle(player, obstacle, success, completed) {
  if (!completed) {
    return;
  }
  const reward = success ? obstacle.xp : obstacle.fail?.xp;
  const xp = typeof reward === "function" ? reward(player) : reward;
  if (xp > 0) {
    player.getSkillManager().addExperiences(Skill.AGILITY, xp);
  }
  const endMessage = success ? obstacle.end : obstacle.fail?.end;
  if (endMessage) {
    player.sendMessage(endMessage);
  }
  if (!success) {
    return;
  }
  // OSRS rooftop obstacles restore 1–2% energy; shortcuts and other courses do not.
  // ponytail: use the documented 1% minimum until per-obstacle captures establish 2% overrides.
  if (obstacle.course?.name.includes("Rooftop")) {
    player.setRunEnergy(player.getRunEnergy() + 1);
    player.getPacketSender().sendRunEnergy();
  }
  obstacle.onSuccess?.(player);
  if (obstacle.course && obstacle.index != null) {
    advanceCourse(player, obstacle);
  }
}

/** Shortcuts within a course (portals) continue the lap from a later obstacle. */
function skipAhead(player, obstacle, context) {
  const progress = player.getAttribute(PROGRESS_ATTRIBUTE);
  if (progress?.course === obstacle.course?.key) {
    player.setAttribute(PROGRESS_ATTRIBUTE, { course: progress.course, index: resolve(obstacle.skipTo, context) });
  }
}

function attemptObstacle(player, object, obstacle) {
  const context = objectContext(player, object);
  const level = resolve(obstacle.level, context);
  if (agilityLevel(player) < level) {
    player.sendMessage(`You need an Agility level of at least ${level} to attempt this.`);
    return;
  }
  const blocked = obstacle.precondition?.(context);
  if (blocked) {
    player.sendMessage(blocked);
    return;
  }
  const success = rollSuccess(player, obstacle, level);
  const steps = resolve(success ? obstacle.steps : obstacle.fail.steps, context);
  if (!steps) return;
  const startMessage = success ? obstacle.start : obstacle.fail?.start ?? obstacle.start;
  if (startMessage) {
    player.sendMessage(startMessage);
  }
  ObstacleRunner.run(context, steps, {
    render: success ? obstacle.render : obstacle.fail?.render ?? obstacle.render,
    onFinish: (completed) => {
      finishObstacle(player, obstacle, success, completed);
      if (completed && success && obstacle.skipTo != null) {
        skipAhead(player, obstacle, context);
      }
    },
  });
}

function routeToObstacle(event) {
  const location = event.object.getLocation();
  const obstacle = findObstacle(event.objectId, { x: location.getX(), y: location.getY(), z: location.getZ() });
  if (!obstacle?.route || event.clickType !== 1) return;
  const tile = resolve(obstacle.route, objectContext(event.player, event.object));
  if (tile) {
    event.destination = { x: tile[0], y: tile[1], z: tile[2] ?? location.getZ() };
  }
}

function operateObstacle(event) {
  const obstacle = findObstacle(event.objectId, event.location);
  if (!obstacle) return false;
  if (ObstacleRunner.isBusy(event.player)) return true;
  attemptObstacle(event.player, event.object, obstacle);
  return true;
}

function blockTeleportMidObstacle(event) {
  if (ObstacleRunner.isBusy(event.player)) {
    event.allow = false;
  }
}

function finishObstacleOnLogout({ player }) {
  ObstacleRunner.completeNow(player);
}

buildIndex();

module.exports = {
  name: "Agility",
  members: true,
  register(api) {
    pluginApi = api;
    ItemOnGroundManager = api.getItemOnGroundManager();
    ObstacleRunner.init(api);

    api.persistAttribute(LAPS_ATTRIBUTE);
    api.persistAttribute(LAP_COUNTER_OFF_ATTRIBUTE);
    api.onNpcInteraction("Grace", { "Toggle Counter": toggleLapCounter });
    api.onObjectRoute(routeToObstacle);
    api.onObjectFirstClick([...OBSTACLES_BY_OBJECT.keys()], operateObstacle);
    api.onCanTeleport(blockTeleportMidObstacle);
    api.onPlayerLogout(finishObstacleOnLogout);

    api.log("registered", {
      courses: COURSES.length,
      shortcuts: SHORTCUTS.length,
      objects: OBSTACLES_BY_OBJECT.size,
    });
  },
};
