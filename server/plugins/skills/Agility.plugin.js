const ObstacleRunner = require("./agility/ObstacleRunner.Agility");
const { COURSES } = require("./agility/courses/Courses.Agility");
const { SHORTCUTS } = require("./agility/shortcuts/Shortcuts.Agility");

/** Attribute holding { course, index } for the lap in progress. */
const PROGRESS_ATTRIBUTE = "agility.progress";
/** Persisted { [courseKey]: laps } map. */
const LAPS_ATTRIBUTE = "agility.laps";
/**
 * Persisted: the lap count chat message is off (Grace's Toggle Counter). Laps are still
 * counted (OSRS Wiki, Grace).
 */
const LAP_COUNTER_OFF_ATTRIBUTE = "agility.lap-counter-off";
/** Run energy (percent) a rooftop obstacle restores, and the fraction carried to the next one. */
const ROOFTOP_ENERGY_RESTORE = 1.5;
const ROOFTOP_ENERGY_CARRY_ATTRIBUTE = "agility.energy-carry";

/**
 * Marks of grace (Wiki: Mark of Grace, "Spawning mechanics"). Completing a lap rolls for a mark
 * once the player's cooldown since their last mark has run out: 3 minutes, counted in whole
 * clock minutes and kept across logouts. The roll is a course's `marks.chance`, else 2/6, cut to
 * a fifth when the player's unboosted Agility is 20+ over the course (unless the course sets
 * `overlevelPenalty: false`). A failed roll can be rerolled at `marks.rerolls`' chance, and
 * `marks.shortCooldown` can make the next cooldown 2 minutes, each for a completed diary tier.
 * A mark is the player's own and lasts 10 minutes on the floor, not counting time logged out.
 */
const MARK_COOLDOWN_ATTRIBUTE = "agility:mark-cooldown-minute";
const MARK_LAP_CHANCE = 2 / 6;
const MARK_OVERLEVELLED_MULTIPLIER = 0.2;
const MARK_OVERLEVEL_THRESHOLD = 20;
const MARK_COOLDOWN_MINUTES = 3;
const MARK_SHORT_COOLDOWN_MINUTES = 2;
const MARK_DESPAWN_TICKS = 1000;
const MINUTE_MS = 60_000;

/**
 * The Agility course helper (rsprox captures). A lap's first obstacle sets
 * `helper_agility_highlighted_course` to the course's `helper` id (enum 3507) as it starts, which
 * highlights the course, and runs `helper_agility_start_lap` with the clock when it ends. Every
 * course obstacle runs `helper_agility_add_xp` with the XP it gave, in tenths. The last one clears
 * the varbit and runs `helper_agility_end_lap` with the clock and the extra laps counted.
 */
const HIGHLIGHTED_COURSE_VARBIT = 13140;
const START_LAP_SCRIPT = 5173;
const END_LAP_SCRIPT = 5174;
const ADD_XP_SCRIPT = 5175;
/** The lap clock counts game ticks; the client only reads differences. From 2024 so it fits an int. */
const LAP_CLOCK_EPOCH_MS = Date.UTC(2024, 0, 1);
const TICK_MS = 600;

/** objectId -> obstacle entries; entries with `at` only match that object tile. */
const OBSTACLES_BY_OBJECT = new Map();
/** npcId -> the course obstacle done on that NPC (Werewolf's stick hand-in). */
const OBSTACLES_BY_NPC = new Map();
/** "x,y,z" -> the course obstacle played by stepping onto that tile (the Agility Pyramid's stone blocks). */
const OBSTACLES_BY_TILE = new Map();
/** player -> the tile key they last stepped onto inside a tile obstacle's area. */
const lastTileStepped = new WeakMap();

let pluginApi;
let core;
let ItemOnGroundManager;

function indexObstacle(obstacle) {
  if (obstacle.npc != null) {
    OBSTACLES_BY_NPC.set(obstacle.npc, obstacle);
    return;
  }
  if (obstacle.tiles) {
    for (const [x, y, z] of obstacle.tiles) {
      OBSTACLES_BY_TILE.set(tileKey(x, y, z), obstacle);
    }
    return;
  }
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
        // XP that depends on the player (the Agility Pyramid's doorway) is all lap, no bonus.
        const xp = typeof obstacle.xp === "number" ? obstacle.xp : 0;
        obstacleXp.set(obstacle.index, Math.max(obstacleXp.get(obstacle.index) ?? 0, xp));
      }
      indexObstacle(obstacle);
    }
    course.finalIndex = Math.max(...obstacleXp.keys());
    course.obstacleXp = obstacleXp;
  }
  for (const course of COURSES) {
    // The lap bonus tops a full lap up to the course's published lap experience. A course that
    // shares its first obstacles with another counts those too, once.
    const shared = course.sharesWith ? COURSES.find((other) => other.key === course.sharesWith.course) : null;
    const sharedXp = shared ? [...shared.obstacleXp].filter(([index]) => index <= course.sharesWith.through) : [];
    const lapTotal = [...course.obstacleXp.values(), ...sharedXp.map(([, xp]) => xp)].reduce((sum, xp) => sum + xp, 0);
    course.lapBonus = Math.max(0, Math.round((course.lapXp - lapTotal) * 10) / 10);
  }
  for (const shortcut of SHORTCUTS) {
    indexObstacle(shortcut);
  }
}

/**
 * The obstacle on that tile. An object in more than one course (a shared start or finish) is the
 * entry that continues the player's lap, else the first.
 */
function findObstacle(objectId, location, player = null) {
  const entries = OBSTACLES_BY_OBJECT.get(objectId);
  if (!entries || !location) return null;
  const here = entries.filter((entry) => !entry.at || (
    entry.at[0] === location.x && entry.at[1] === location.y && (entry.at[2] ?? location.z) === location.z
  ));
  if (here.length > 1 && player) {
    const progress = player.getAttribute(PROGRESS_ATTRIBUTE);
    const continuing = here.find((entry) => entry.course && continuesLap(progress, entry));
    if (continuing) return continuing;
  }
  return here[0] ?? null;
}

/**
 * Whether `obstacle` is the next one of the lap in `progress`: the same course, or a course that
 * shares its first obstacles (`sharesWith: { course, through }`) with the one the lap began on.
 * A course whose floors repeat its obstacles in another order (`anyOrder`, the Agility Pyramid)
 * only needs the lap to have begun.
 */
function continuesLap(progress, obstacle) {
  const course = obstacle.course;
  if (progress && course?.anyOrder && progress.course === course.key) return true;
  if (!progress || progress.index !== obstacle.index - 1) return false;
  if (progress.course === course.key) return true;
  return course.sharesWith?.course === progress.course && progress.index <= course.sharesWith.through;
}

function tileKey(x, y, z) {
  return `${x},${y},${z}`;
}

function objectContext(player, object) {
  const location = object.getLocation();
  const playerLocation = player.getLocation();
  const face = object.getFace?.() ?? 0;
  const definition = object.getDefinition?.();
  const [width, length] = [definition?.getSizeX?.() ?? 1, definition?.getSizeY?.() ?? 1];
  return {
    player,
    object,
    core,
    api: pluginApi,
    obj: {
      x: location.getX(), y: location.getY(), z: location.getZ(),
      face, type: object.getType?.() ?? 10, id: object.getId(),
      // The footprint on the map: a quarter turn swaps the definition's sizes.
      sizeX: face % 2 === 1 ? length : width,
      sizeY: face % 2 === 1 ? width : length,
    },
    pos: { x: playerLocation.getX(), y: playerLocation.getY(), z: playerLocation.getZ() },
  };
}

/** A tile obstacle's context: `obj` is the tile stepped on, facing the obstacle's `face`. */
function tileContext(player, obstacle) {
  const location = player.getLocation();
  const pos = { x: location.getX(), y: location.getY(), z: location.getZ() };
  return { player, object: null, core, api: pluginApi, obj: { ...pos, face: obstacle.face ?? 0, type: -1, id: -1 }, pos };
}

function resolve(value, context) {
  return typeof value === "function" ? value(context) : value;
}

function agilityLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.AGILITY);
}

/**
 * The OSRS skilling success roll the Wiki's success charts use: `low` and `high` out of 256,
 * interpolated over levels 1-99 (Wiki: Skilling success rate).
 */
function skillingChance(low, high, level) {
  const capped = Math.max(1, Math.min(99, level));
  return (1 + Math.floor((low * (99 - capped)) / 98 + (high * (capped - 1)) / 98 + 0.5)) / 256;
}

/**
 * Whether the obstacle succeeds. A `fail` block with `low`/`high` rolls the OSRS success chance;
 * the older linear one is `baseChance`% at the requirement, rising to certain success at
 * `neverFailLevel`. Obstacles without a `fail` block never fail.
 */
function rollSuccess(player, obstacle, requirement) {
  const fail = obstacle.fail;
  if (!fail) return true;
  const level = agilityLevel(player);
  if (fail.low != null && fail.high != null) {
    return Math.random() < skillingChance(fail.low, fail.high, level);
  }
  const never = fail.neverFailLevel ?? requirement + 20;
  if (level >= never) return true;
  const base = fail.baseChance ?? 75;
  const from = fail.fromLevel ?? requirement;
  const chance = base + (Math.max(0, level - from) * (100 - base)) / Math.max(1, never - from);
  return Math.random() * 100 < chance;
}

function lapClock() {
  return Math.floor((Date.now() - LAP_CLOCK_EPOCH_MS) / TICK_MS);
}

/** Agility XP; on a course, the helper is told what was actually gained (in tenths, after rates). */
function addAgilityXp(player, xp, course = null) {
  const skills = player.getSkillManager();
  const before = skills.getExperience(core.Skill.AGILITY);
  skills.addExperiences(core.Skill.AGILITY, xp);
  const gained = Math.round((skills.getExperience(core.Skill.AGILITY) - before) * 10);
  if (course?.helper != null && gained > 0) {
    player.getPacketSender().sendClientScript(ADD_XP_SCRIPT, gained);
  }
}

/** Whether `obstacle` begins a lap: obstacle 1, unless the course says otherwise (`startsLap`). */
function startsLap(obstacle, context) {
  if (!obstacle.course) return false;
  return obstacle.startsLap !== undefined ? resolve(obstacle.startsLap, context) === true : obstacle.index === 1;
}

/** The course highlight goes on with the obstacle's first visible step, after any wait or turn. */
function withHighlight(steps, helper) {
  const highlight = { varbit: [HIGHLIGHTED_COURSE_VARBIT, helper] };
  const at = steps.findIndex((step) => step && step.wait == null && !step.face && !step.faceDir);
  return at < 0 ? [...steps, highlight] : [...steps.slice(0, at), highlight, ...steps.slice(at)];
}

/**
 * A course's own progress varbit (Shayzien's, the Colossal Wyrm's), set to the obstacle the lap
 * has reached. A course that shares this one's first obstacles with `sharesWith.progress` has its
 * varbit follow them too (the Wyrm's advanced course: rsprox 1106 sets both on the shared ladder
 * and tightrope).
 */
function setProgressVarbit(player, course, index) {
  if (course.progressVarbit != null) {
    player.getPacketSender().sendVarbit(course.progressVarbit, index);
  }
  for (const other of COURSES) {
    const shares = other.sharesWith;
    if (shares?.course === course.key && shares.progress && other.progressVarbit != null && index <= shares.through) {
      player.getPacketSender().sendVarbit(other.progressVarbit, index);
    }
  }
}

/** A finished lap clears the course's progress varbit and, when they move together, the shared course's. */
function resetProgressVarbits(player, course) {
  setProgressVarbit(player, course, 0);
  const shared = course.sharesWith?.progress ? COURSES.find((other) => other.key === course.sharesWith.course) : null;
  if (shared?.progressVarbit != null) {
    player.getPacketSender().sendVarbit(shared.progressVarbit, 0);
  }
}

function getLaps(player) {
  const laps = player.getAttribute(LAPS_ATTRIBUTE);
  return laps && typeof laps === "object" ? laps : {};
}

function completeLap(player, course) {
  // Content may change what a lap counts for and pays ("agility:lap-reward", a league relic's double laps and bonus XP).
  const reward = { player, course: course.key, count: 1, xp: course.lapBonus };
  pluginApi.emitCustomEvent("agility:lap-reward", reward);
  const laps = { ...getLaps(player) };
  laps[course.key] = (laps[course.key] ?? 0) + Math.max(1, reward.count | 0);
  player.setAttribute(LAPS_ATTRIBUTE, laps);
  rollMarkOfGrace(player, course);
  if (reward.xp > 0) {
    addAgilityXp(player, reward.xp, course);
  }
  // XP in other skills for a full lap (`lapSkillXp`: Barbarian Outpost's Strength, Wiki).
  for (const [skillName, xp] of Object.entries(course.lapSkillXp ?? {})) {
    player.getSkillManager().addExperiences(core.Skill[skillName.toUpperCase()], xp);
  }
  // The diary's line comes before the lap count (rsprox 1788).
  if (course.diaryTask) {
    pluginApi.emitCustomEvent("diary:task", { player, ...course.diaryTask });
  }
  if (!player.getAttribute(LAP_COUNTER_OFF_ATTRIBUTE)) {
    player.sendMessage(`Your ${course.name} lap count is: <col=ff0000>${laps[course.key]}</col>.`);
  }
  resetProgressVarbits(player, course);
  if (course.helper != null) {
    player.getPacketSender().sendVarbit(HIGHLIGHTED_COURSE_VARBIT, 0);
    player.getPacketSender().sendClientScript(END_LAP_SCRIPT, lapClock(), Math.max(1, reward.count | 0) - 1);
  }
  pluginApi.emitCustomEvent("agility:lap", { player, course: course.key, laps: laps[course.key], count: Math.max(1, reward.count | 0) });
  // The giant squirrel rolls once per completed course.
  pluginApi.emitCustomEvent("agility:success", { player, skill: core.Skill.AGILITY, petBase: course.petBase });
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
  } else if (continuesLap(progress, obstacle)) {
    next = { course: course.key, index: obstacle.index };
  }
  if (next && obstacle.index === course.finalIndex) {
    player.setAttribute(PROGRESS_ATTRIBUTE, null);
    completeLap(player, course);
    return;
  }
  player.setAttribute(PROGRESS_ATTRIBUTE, next);
  setProgressVarbit(player, course, next?.index ?? 0);
}

function clockMinute() {
  return Math.floor(Date.now() / MINUTE_MS);
}

function diaryTierComplete(player, { diary, tier }) {
  const request = { player, diary, tier, complete: false };
  pluginApi.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** The chance of the first of `bonuses` ({ diary, tier, chance }) whose diary tier is done, else 0. */
function diaryBonusChance(player, bonuses) {
  const bonus = (bonuses ?? []).find((entry) => diaryTierComplete(player, entry));
  return bonus ? bonus.chance : 0;
}

function rollMarkOfGrace(player, course) {
  const marks = course.marks;
  if (!marks || marks.tiles.length === 0) return;
  const minute = clockMinute();
  if (minute < (player.getAttribute(MARK_COOLDOWN_ATTRIBUTE) ?? 0)) return;
  let chance = marks.chance ?? MARK_LAP_CHANCE;
  const unboosted = player.getSkillManager().getMaxLevel(core.Skill.AGILITY);
  if (marks.overlevelPenalty !== false && unboosted >= marks.level + MARK_OVERLEVEL_THRESHOLD) {
    chance *= MARK_OVERLEVELLED_MULTIPLIER;
  }
  // Content may set the lap's mark chance ("agility:mark-chance", a league relic's fixed 33%).
  const request = { player, course: course.key, chance };
  pluginApi.emitCustomEvent("agility:mark-chance", request);
  if (Number.isFinite(request.chance)) chance = request.chance;
  if (Math.random() >= chance && Math.random() >= diaryBonusChance(player, marks.rerolls)) return;
  const short = Math.random() < diaryBonusChance(player, marks.shortCooldown);
  player.setAttribute(MARK_COOLDOWN_ATTRIBUTE, minute + (short ? MARK_SHORT_COOLDOWN_MINUTES : MARK_COOLDOWN_MINUTES));
  const tile = marks.tiles[Math.floor(Math.random() * marks.tiles.length)];
  const position = new core.Location(tile[0], tile[1], tile[2]);
  const award = { player, minigame: "rooftop-agility", points: 1 };
  pluginApi.emitCustomEvent("minigame:points", award);
  // Content may add to what spawns with the mark ("agility:mark", a league relic's coins).
  const spawn = { player, location: position, items: [[core.ItemIds.MARK_OF_GRACE, award.points]] };
  pluginApi.emitCustomEvent("agility:mark", spawn);
  for (const [itemId, amount] of spawn.items) {
    ItemOnGroundManager.registerLocation(player, new core.Item(itemId, amount), position,
      player.getPrivateArea(), { goesGlobal: false, despawnDelay: MARK_DESPAWN_TICKS });
  }
}

/** The player's course marks on the floor; dropped marks go public and age as usual. */
function spawnedMarks(username) {
  return ItemOnGroundManager.ownedBy(username).filter(isCourseMark);
}

function isCourseMark(groundItem) {
  return groundItem.getItem().getId() === core.ItemIds.MARK_OF_GRACE && !groundItem.getgoesGlobal()
    && groundItem.getDespawnDelay() === MARK_DESPAWN_TICKS;
}

/** The course whose mark tiles hold `location`. */
function courseOfMark({ x, y, z }) {
  return COURSES.find((course) => course.marks?.tiles.some((tile) => tile[0] === x && tile[1] === y && tile[2] === z)) ?? null;
}

/**
 * A course mark picked up (one the inventory has room for). Content may make it finish a lap of
 * its course ("agility:mark-taken", a league relic): the lap is recorded and paid as the last
 * obstacle would, and `items` go to the inventory (the floor when it has no room).
 */
function takeMark(event) {
  const { player, groundItem } = event;
  if (!isCourseMark(groundItem) || ItemOnGroundManager.inventoryCapacity(player, groundItem.getItem()) <= 0) return;
  const course = courseOfMark(event.location);
  if (!course) return;
  const request = { player, course: course.key, completesLap: false, items: [] };
  pluginApi.emitCustomEvent("agility:mark-taken", request);
  if (!request.completesLap) return;
  player.setAttribute(PROGRESS_ATTRIBUTE, null);
  completeLap(player, course);
  for (const [itemId, amount] of request.items) {
    const item = new core.Item(itemId, amount);
    const added = Math.min(amount, player.getInventory().getAddableAmount(item));
    if (added > 0) player.getInventory().adds(itemId, added);
    if (amount > added) ItemOnGroundManager.registerLocation(player, new core.Item(itemId, amount - added), player.getLocation().clone());
  }
}

/**
 * An obstacle's own find (`gives`: { item (an ItemIdentifiers name), amount, message }, Prifddinas's portal shard): its line,
 * then the item to the inventory, the floor for what has no room. Content may change the amount
 * first ("agility:course-item" { player, course, itemId, amount }, a league relic's tenfold shards).
 */
function giveCourseItem(player, course, gives) {
  const itemId = core.ItemIdentifiers[gives.item];
  const request = { player, course: course?.key ?? null, itemId, amount: gives.amount };
  pluginApi.emitCustomEvent("agility:course-item", request);
  const amount = Math.max(0, request.amount | 0);
  if (amount <= 0) return;
  if (gives.message) player.sendMessage(gives.message);
  const item = new core.Item(itemId, amount);
  const added = Math.min(amount, player.getInventory().getAddableAmount(item));
  if (added > 0) player.getInventory().adds(itemId, added);
  if (amount > added) ItemOnGroundManager.registerLocation(player, new core.Item(itemId, amount - added), player.getLocation().clone());
}

function pauseMarksOnLogout({ player }) {
  spawnedMarks(player.getUsername()).forEach((item) => item.setAgingPaused(true));
}

function resumeMarksOnLogin({ player }) {
  spawnedMarks(player.getUsername()).forEach((item) => item.setAgingPaused(false));
}

function finishObstacle(player, obstacle, success, completed, fail = obstacle.fail, lapStart = false) {
  if (!completed) {
    return;
  }
  if (success && lapStart && obstacle.course.helper != null) {
    player.getPacketSender().sendClientScript(START_LAP_SCRIPT, lapClock());
  }
  // `diaryXp` ({ diary, tier, xp }) pays more once that diary tier is done (Pollnivneach's and
  // Rellekka's last obstacles); the lap bonus is worked out from the plain `xp`.
  const diaryXp = success && obstacle.diaryXp && diaryTierComplete(player, obstacle.diaryXp) ? obstacle.diaryXp.xp : null;
  const reward = success ? diaryXp ?? obstacle.xp : fail?.xp;
  const xp = typeof reward === "function" ? reward(player) : reward;
  if (xp > 0) {
    addAgilityXp(player, xp, obstacle.course);
  }
  const endMessage = success ? obstacle.end : fail?.end;
  if (endMessage) {
    ObstacleRunner.sendMessage(player, endMessage);
  }
  if (!success) {
    return;
  }
  // Rooftop obstacles restore 1.5% energy each (rsprox 339 and 3154, main game: 150 of 10,000 on
  // every XP tick); shortcuts and other courses do not. Energy is kept in whole percent, so the
  // half carries over to the next obstacle.
  if (obstacle.course?.name.includes("Rooftop")) {
    const restored = (player.getAttribute(ROOFTOP_ENERGY_CARRY_ATTRIBUTE) ?? 0) + ROOFTOP_ENERGY_RESTORE;
    player.setAttribute(ROOFTOP_ENERGY_CARRY_ATTRIBUTE, restored - Math.floor(restored));
    player.setRunEnergy(player.getRunEnergy() + Math.floor(restored));
    player.getPacketSender().sendRunEnergy();
  }
  obstacle.onSuccess?.(player);
  if (obstacle.gives != null) {
    giveCourseItem(player, obstacle.course, obstacle.gives);
  }
  if (obstacle.takes != null) {
    takeAll(player, obstacle.takes);
  }
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

function skillMessage(skillName, level) {
  const name = skillName[0].toUpperCase() + skillName.slice(1);
  const article = /^[AEIOU]/.test(name) ? "an" : "a";
  return `You need ${article} ${name} level of at least ${level} to attempt this.`;
}

/** Why `requirement` isn't met, or null. Quests and diaries this server doesn't know are no bar. */
function unmet(player, requirement) {
  for (const [skillName, level] of Object.entries(requirement.skills ?? {})) {
    const skill = core.Skill[skillName.toUpperCase()];
    if (player.getSkillManager().getCurrentLevel(skill) < level) return skillMessage(skillName, level);
  }
  const worn = player.getEquipment().getItems();
  for (const item of requirement.equipped ?? []) {
    const held = worn[core.Equipment[`${item.slot.toUpperCase()}_SLOT`]];
    const name = String(held?.getDefinition?.()?.getName?.() ?? "").toLowerCase();
    const matches = item.ids ? item.ids.includes(held?.getId?.()) : item.name ? name.includes(item.name) : false;
    if (!matches) return item.message;
  }
  for (const item of requirement.items ?? []) {
    if (!item.ids.some((id) => player.getInventory().contains(id))) return item.message;
  }
  for (const { key, stage = "complete", message } of [].concat(requirement.quest ?? [])) {
    const request = { player, key, complete: null, started: null };
    pluginApi.emitCustomEvent(stage === "started" ? "quest:is-started" : "quest:is-complete", request);
    if ((stage === "started" ? request.started : request.complete) === false) return message;
  }
  if (requirement.diary?.enforce) {
    const { key, tier, message } = requirement.diary;
    const request = { player, diary: key, tier, complete: null };
    pluginApi.emitCustomEvent("diary:is-complete", request);
    if (request.complete === false) return message;
  }
  return null;
}

/**
 * The obstacle as this player can use it: with `requires`, the first alternative they meet
 * (which may bring its own steps), else the refusal of the first alternative. Without it, the
 * Agility level.
 */
function usable(player, obstacle, level) {
  if (!obstacle.requires) {
    return agilityLevel(player) < level
      ? { refusal: `You need an Agility level of at least ${level} to attempt this.` }
      : { obstacle };
  }
  let refusal = null;
  for (const alternative of obstacle.requires) {
    const reason = unmet(player, alternative);
    if (!reason) {
      const { steps, start, end } = alternative;
      return { obstacle: { ...obstacle, ...(steps ? { steps } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) } };
    }
    refusal ??= reason;
  }
  return { refusal };
}

function attemptObstacle(player, context, entry) {
  const objectId = context.obj.id;
  const level = resolve(entry.level, context);
  const { obstacle, refusal } = usable(player, entry, level);
  if (refusal) {
    player.sendMessage(refusal);
    return;
  }
  const blocked = obstacle.precondition?.(context);
  if (blocked) {
    player.sendMessage(blocked);
    return;
  }
  // `forceFail` gives the failure the player gets whatever they roll (Ape Atoll without a greegree).
  const forced = obstacle.forceFail?.(context) ?? null;
  const fail = forced ?? obstacle.fail;
  // Content may make the roll succeed ("agility:roll", a league relic); a forced failure stays one.
  const roll = { player, objectId, success: !forced && rollSuccess(player, obstacle, level) };
  if (!forced) pluginApi.emitCustomEvent("agility:roll", roll);
  const success = roll.success;
  const resolved = resolve(success ? obstacle.steps : fail.steps, context);
  if (!resolved) return;
  const lapStart = success && startsLap(obstacle, context);
  const steps = lapStart && obstacle.course.helper != null ? withHighlight(resolved, obstacle.course.helper) : resolved;
  pluginApi.emitCustomEvent("agility:obstacle-start", { player, objectId, location: context.obj, success });
  const startMessage = success ? obstacle.start : fail?.start ?? obstacle.start;
  if (startMessage) {
    ObstacleRunner.sendMessage(player, startMessage);
  }
  ObstacleRunner.run(context, steps, {
    render: success ? obstacle.render : fail?.render ?? obstacle.render,
    busyVarbit: obstacle.course != null,
    onFinish: (completed) => {
      finishObstacle(player, obstacle, success, completed, fail, lapStart);
      if (completed && success) {
        // A shortcut's own name (agility-shortcuts.json's, "Stepping stone (Shilo Village)"); a course obstacle has none.
        pluginApi.emitCustomEvent("agility:obstacle", { player, objectId, location: context.obj, shortcut: obstacle.course ? null : obstacle.name ?? null });
      }
      if (completed && success && obstacle.skipTo != null) {
        skipAhead(player, obstacle, context);
      }
    },
  });
}

function routeToObstacle(event) {
  const location = event.object.getLocation();
  const obstacle = findObstacle(event.objectId, { x: location.getX(), y: location.getY(), z: location.getZ() }, event.player);
  if (!obstacle?.route || event.clickType !== 1) return;
  const tile = resolve(obstacle.route, objectContext(event.player, event.object));
  if (tile) {
    event.destination = { x: tile[0], y: tile[1], z: tile[2] ?? location.getZ() };
  }
}

function operateObstacle(event) {
  const obstacle = findObstacle(event.objectId, event.location, event.player);
  if (!obstacle) return false;
  if (ObstacleRunner.isBusy(event.player)) return true;
  attemptObstacle(event.player, objectContext(event.player, event.object), obstacle);
  return true;
}

/** Removes every `itemId` the player carries (Werewolf: all sticks go when one is handed in). */
function takeAll(player, itemId) {
  const amount = player.getInventory().getAmount(itemId);
  if (amount > 0) {
    player.getInventory().delete(itemId, amount);
  }
}

/**
 * A course obstacle done on an NPC (Werewolf's Agility Trainer, "Give-Stick"): its requirement
 * and precondition, then XP, end message and the lap, as for an object.
 */
function operateNpcObstacle(event) {
  const { player, npc } = event;
  const obstacle = OBSTACLES_BY_NPC.get(event.npcId ?? npc.getId());
  if (!obstacle) return false;
  if (ObstacleRunner.isBusy(player)) return true;
  const { refusal } = usable(player, obstacle, obstacle.level);
  const blocked = refusal ?? obstacle.precondition?.({ player, npc, core });
  if (blocked) {
    player.sendMessage(blocked);
    return true;
  }
  finishObstacle(player, obstacle, true, true);
  return true;
}

/** A course's own ladder (Shayzien's start) is an obstacle, not one the Ladders plugin climbs. */
function claimLadderObstacle(request) {
  const location = request.object.getLocation();
  const obstacle = findObstacle(request.objectId, { x: location.getX(), y: location.getY(), z: location.getZ() }, request.player);
  if (!obstacle) return;
  request.handled = true;
  if (ObstacleRunner.isBusy(request.player)) return;
  attemptObstacle(request.player, objectContext(request.player, request.object), obstacle);
}

/**
 * A tile obstacle plays once each time a player steps onto one of its tiles (not while they
 * stand there, nor when an obstacle puts them there).
 */
function stepOntoTile(player) {
  const location = player.getLocation();
  const key = tileKey(location.getX(), location.getY(), location.getZ());
  if (lastTileStepped.get(player) === key) return;
  lastTileStepped.set(player, key);
  const obstacle = OBSTACLES_BY_TILE.get(key);
  if (!obstacle || ObstacleRunner.isBusy(player)) return;
  attemptObstacle(player, tileContext(player, obstacle), obstacle);
}

/** Every tile obstacle's tiles as one Area, so only players standing on one are asked. */
function createTileObstacleArea() {
  class TileObstacleArea extends core.Area {
    process(character) {
      if (character.isPlayer()) stepOntoTile(character.getAsPlayer());
    }

    postLeave(character) {
      if (character.isPlayer()) lastTileStepped.delete(character.getAsPlayer());
    }
  }
  const boundaries = [...OBSTACLES_BY_TILE.keys()].map((key) => {
    const [x, y, z] = key.split(",").map(Number);
    return new core.Boundary(x, x, y, y, z);
  });
  return new TileObstacleArea(boundaries);
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
    core = api.core;
    ItemOnGroundManager = api.getItemOnGroundManager();
    ObstacleRunner.init(api);

    api.persistAttribute(PROGRESS_ATTRIBUTE);
    api.persistAttribute(LAPS_ATTRIBUTE);
    api.persistAttribute(LAP_COUNTER_OFF_ATTRIBUTE);
    api.persistAttribute(MARK_COOLDOWN_ATTRIBUTE, 0);
    api.onNpcInteraction("Grace", { "Toggle Counter": toggleLapCounter });
    api.onObjectRoute(routeToObstacle);
    api.onObjectFirstClick([...OBSTACLES_BY_OBJECT.keys()], operateObstacle);
    api.onCustomEvent("ladders:climb", claimLadderObstacle);
    api.onNpcInteraction("Agility Trainer", { "Give-Stick": operateNpcObstacle });
    api.registerArea(createTileObstacleArea());
    api.onCanTeleport(blockTeleportMidObstacle);
    api.onPlayerLogout(finishObstacleOnLogout);
    api.onPlayerLogout(pauseMarksOnLogout);
    api.onPlayerLogin(resumeMarksOnLogin);
    api.onGroundItemPickup(takeMark);

    api.log("registered", {
      courses: COURSES.length,
      shortcuts: SHORTCUTS.length,
      objects: OBSTACLES_BY_OBJECT.size,
    });
  },
};

module.exports.giveCourseItem = giveCourseItem;
