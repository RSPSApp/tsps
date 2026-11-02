/**
 * Awarding tasks from the game, driven by each task's `trigger` (the generator's, or the overlay's;
 * docs/leagues.md lists the kinds): kills of any NPC a task accepts, counted per task, level kinds
 * on `onPlayerLevelUp`, experience totals on `onExperienceGained`, quests on `quest:completed` by name. Level and quest kinds are also checked
 * at login, so a character who already qualifies is not kept waiting for the next event; kills are
 * not (nothing was counted before). No task is named here: a new mapping is data.
 *
 * A kill is credited from two sources: an NPC's death (`onNpcDeath`, to its killer) and the shared
 * credited-kill event `combat-achievements:kill` { player, monster, amount? } that scripted
 * encounters emit for each rewarded player when no NPC dies (the Nightmare's ending transforms
 * her instead) and that some bosses emit beside a death, under the main boss's name for a singles
 * boss (Artio counts as Callisto). Within one tick, a task takes the larger of the two counts, so
 * a kill reported both ways counts once and several kills in one tick all count. A kill with an
 * `area` counts only on the areas plugin's map there (`league:area-at`; the death's tile, or the
 * player's for a credited kill); one marked `credited` (a minigame's completion) only the credited
 * event, not a death of the same name.
 */
const Common = require("./Common.LeagueTasks");
const Complete = require("./Complete.LeagueTasks");

const LEVEL_KINDS = new Set(["level", "any-level", "total-level", "base-level", "combat-level"]);
const CA_KINDS = new Set(["ca-tier", "ca-count", "ca-bosses", "ca-boss"]);
/** League type -> { kills: Map(lower-cased npc name -> tasks), levels: tasks, quests: Map(plain quest name -> tasks) }. */
const index = new Map();
/** Player -> task id -> this tick's kill credit { tick, deaths, events, credited }. */
const tickCredit = new WeakMap();
let skillsByName = null;

const plainName = (name) => String(name ?? "").toLowerCase().replace(/^the /, "").replace(/[^a-z0-9]+/g, " ").trim();

function indexOf(type) {
  if (index.has(type)) return index.get(type);
  const entry = { kills: new Map(), killEach: new Map(), levels: [], levelUps: [], quests: new Map(), experience: [], experienceBySkill: new Map(), diaries: [], achievements: [] };
  for (const task of Common.catalog(type).tasks) {
    const trigger = task.trigger;
    if (!trigger) continue;
    if (trigger.kind === "kill") {
      // Every NPC the task accepts ("Callisto or Artio"); an overlay may still give one `npc`.
      for (const npc of trigger.npcs ?? [trigger.npc]) {
        const key = String(npc).toLowerCase();
        entry.kills.set(key, (entry.kills.get(key) ?? []).concat(task));
      }
    } else if (trigger.kind === "kill-each") {
      for (const npc of Object.keys(trigger.npcs)) {
        const key = npc.toLowerCase();
        entry.killEach.set(key, (entry.killEach.get(key) ?? []).concat(task));
      }
    } else if (LEVEL_KINDS.has(trigger.kind)) {
      entry.levels.push(task);
    } else if (CA_KINDS.has(trigger.kind)) {
      entry.achievements.push(task);
    } else if (trigger.kind === "diary") {
      entry.diaries.push(task);
    } else if (trigger.kind === "experience") {
      entry.experience.push(task);
      for (const skill of trigger.skills ?? []) entry.experienceBySkill.set(skill, (entry.experienceBySkill.get(skill) ?? []).concat(task));
    } else if (trigger.kind === "level-up") {
      entry.levelUps.push(task);
    } else if (trigger.kind === "quest") {
      const key = plainName(trigger.name);
      entry.quests.set(key, (entry.quests.get(key) ?? []).concat(task));
    }
  }
  index.set(type, entry);
  return entry;
}

/** The server's Skill constants by name (ATTACK, RUNECRAFTING...). */
function skills() {
  if (skillsByName) return skillsByName;
  const { Skill } = Common.core;
  skillsByName = new Map(Object.entries(Skill).filter(([, value]) => value instanceof Skill));
  return skillsByName;
}

function levelReached(player, trigger) {
  const manager = player.getSkillManager();
  const { Skill } = Common.core;
  switch (trigger.kind) {
    case "level": {
      const skill = skills().get(trigger.skill);
      return skill ? manager.getMaxLevel(skill) >= trigger.level : false;
    }
    case "any-level":
      return [...skills()].some(([name, skill]) => !(trigger.excluding ?? []).includes(name) && manager.getMaxLevel(skill) >= trigger.level);
    case "total-level":
      return manager.getTotalLevel() >= trigger.level;
    case "base-level":
      // Every skill of the leagues' day: Sailing came after both.
      return [...skills()].every(([name, skill]) => name === "SAILING" || manager.getMaxLevel(skill) >= trigger.level);
    case "combat-level":
      return manager.getCombatLevel() >= trigger.level;
    default:
      return false;
  }
}

function checkLevels(player) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  for (const task of indexOf(type).levels) {
    if (levelReached(player, task.trigger)) Complete.complete(player, task.id);
  }
}

/** `experience { skills, amount, count }`: at least `amount` XP in `count` of the skills. */
function checkExperience(player, gained = null) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  const entry = indexOf(type);
  // An XP drop asks only the tasks counting its skill; the login asks them all.
  const tasks = gained === null ? entry.experience : entry.experienceBySkill.get(gained) ?? [];
  if (!tasks.length) return;
  const manager = player.getSkillManager();
  const reached = tasks.filter((task) => {
    const { skills: names, amount, count } = task.trigger;
    return names.filter((name) => {
      const skill = skills().get(name);
      return skill && manager.getExperience(skill) >= amount;
    }).length >= (Number(count) || 1);
  });
  if (!reached.length) return;
  const done = new Set(Common.completedIds(player));
  for (const task of reached) if (!done.has(task.id)) Complete.complete(player, task.id, type);
}

/** The Skill constant's name (ATTACK) for the Skill an XP drop names. */
function skillName(skill) {
  for (const [name, each] of skills()) if (each === skill) return name;
  return null;
}

/** `diary { diary, tier }`: the diaries plugin says the tier is complete (`diary:is-complete`). */
function checkDiaries(player) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  const done = new Set(Common.completedIds(player));
  for (const task of indexOf(type).diaries) {
    if (done.has(task.id)) continue;
    const query = { player, diary: task.trigger.diary, tier: task.trigger.tier, complete: false };
    Common.api.emitCustomEvent("diary:is-complete", query);
    if (query.complete === true) Complete.complete(player, task.id, type);
  }
}

/** A monster's name as either side spells it ("Nightmare, The", "the Giant Mole"), compared plainly. */
const monsterKey = (name) => plainName(String(name ?? "").replace(/^(.*), the$/i, "the $1"));

/** Combat Achievements: a tier reached, a count of tasks (or speed tasks), every task of one monster or of N. */
function checkAchievements(player) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  const tasks = indexOf(type).achievements;
  if (!tasks.length) return;
  const done = new Set(Common.completedIds(player));
  const summary = { player, completed: 0, speed: 0, monsters: [] };
  Common.api.emitCustomEvent("combat-achievements:summary", summary);
  const finished = new Set((summary.monsters ?? []).map(monsterKey));
  for (const task of tasks) {
    if (done.has(task.id)) continue;
    const trigger = task.trigger;
    let reached = false;
    if (trigger.kind === "ca-tier") {
      const query = { player, tier: trigger.tier, unlocked: false };
      Common.api.emitCustomEvent("combat-achievements:tier", query);
      reached = query.unlocked === true;
    } else if (trigger.kind === "ca-count") {
      reached = (trigger.type === "speed" ? summary.speed : summary.completed) >= trigger.count;
    } else if (trigger.kind === "ca-bosses") {
      reached = finished.size >= trigger.count;
    } else if (trigger.kind === "ca-boss") {
      reached = finished.has(monsterKey(trigger.monster));
    }
    if (reached) Complete.complete(player, task.id, type);
  }
}

function achievementCompleted({ player }) {
  if (player) checkAchievements(player);
}

/** `diary:task` { player }: a diary task done (the diaries plugin, loaded first, has counted it). */
function diaryTask({ player }) {
  if (player) checkDiaries(player);
}

function experienceGained({ player, skill }) {
  if (!player) return;
  const name = skillName(skill);
  if (name !== null) checkExperience(player, name);
}

function levelUp({ player, oldLevel, newLevel }) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  if (newLevel > oldLevel) for (const task of indexOf(type).levelUps) Complete.complete(player, task.id);
  checkLevels(player);
}

function killsOf(player) {
  const value = player.getAttribute(Common.KILLS_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function npcName(npc) {
  return npc?.getCurrentDefinition?.()?.getName?.() ?? npc?.getDefinition?.()?.getName?.() ?? null;
}

/**
 * `amount` kills of the NPC `name` from `source` ("deaths" or "events") for the character's open
 * kill tasks that accept it: each task's progress takes this tick's larger count, then any task
 * that reached its count completes.
 */
function credit(player, type, name, source, amount, tile = null) {
  const tasks = indexOf(type).kills.get(String(name ?? "").toLowerCase());
  if (!tasks || !(amount > 0)) return;
  const done = new Set(Common.completedIds(player));
  // A `credited` task (a minigame's completion: "Complete the TzHaar Fight Cave") counts only the
  // credited event: the same NPC can die elsewhere (TzTok-Jad in TzHaar-Ket-Rak's Challenges).
  const open = tasks.filter((task) => !done.has(task.id) && inArea(task, type, tile ?? tileOf(player))
    && !(task.trigger.credited && source !== "events"));
  if (!open.length) return;
  const tick = Common.core.World.getProcessCycle?.() ?? 0;
  let perTask = tickCredit.get(player);
  if (!perTask) tickCredit.set(player, (perTask = new Map()));
  const progress = { ...killsOf(player) };
  for (const task of open) {
    let entry = perTask.get(task.id);
    if (!entry || entry.tick !== tick) perTask.set(task.id, (entry = { tick, deaths: 0, events: 0, credited: 0 }));
    entry[source] += amount;
    const due = Math.max(entry.deaths, entry.events) - entry.credited;
    if (due <= 0) continue;
    entry.credited += due;
    progress[task.id] = (Number(progress[task.id]) || 0) + due;
  }
  player.setAttribute(Common.KILLS_ATTRIBUTE, progress);
  for (const task of open) {
    if ((Number(progress[task.id]) || 0) >= (Number(task.trigger.count) || 1)) Complete.complete(player, task.id, type);
  }
}

function tileOf(entity) {
  const location = entity?.getLocation?.();
  return location ? { x: location.getX(), y: location.getY() } : null;
}

/**
 * A kill task with an `area` (the areas plugin's id) counts only kills on its map there; one with a
 * `place` (a guild, a dungeon: the catalog's `places`) only kills inside its bounds.
 */
function inArea(task, type, tile) {
  if (task.trigger.area === undefined && task.trigger.place === undefined) return true;
  if (!tile) return false;
  if (task.trigger.place !== undefined && !Common.inPlace(task.trigger.place, tile.x, tile.y)) return false;
  if (task.trigger.area === undefined) return true;
  const query = { x: tile.x, y: tile.y, league: type, area: null };
  Common.api.emitCustomEvent("league:area-at", query);
  return query.area === task.trigger.area;
}

/**
 * `kill-each { npcs: { name: count } }`: that many deaths of each NPC, counted per NPC in the task's
 * kills entry ({ name: kills }), in its area or place.
 */
function creditEach(player, type, name, tile) {
  const tasks = indexOf(type).killEach.get(String(name ?? "").toLowerCase());
  if (!tasks) return;
  const done = new Set(Common.completedIds(player));
  const progress = { ...killsOf(player) };
  const reached = [];
  for (const task of tasks) {
    if (done.has(task.id) || !inArea(task, type, tile)) continue;
    const wanted = Object.entries(task.trigger.npcs).find(([npc]) => npc.toLowerCase() === String(name).toLowerCase());
    const counts = { ...(progress[task.id] && typeof progress[task.id] === "object" ? progress[task.id] : {}) };
    counts[wanted[0]] = Math.min(Number(wanted[1]), (Number(counts[wanted[0]]) || 0) + 1);
    progress[task.id] = counts;
    if (Object.entries(task.trigger.npcs).every(([npc, need]) => (Number(counts[npc]) || 0) >= Number(need))) reached.push(task);
  }
  player.setAttribute(Common.KILLS_ATTRIBUTE, progress);
  for (const task of reached) Complete.complete(player, task.id, type);
}

function npcDeath(event) {
  const player = event?.killer;
  if (!player?.isPlayer?.() && !player?.getPacketSender) return;
  const type = Common.leagueOf(player);
  const at = event.location ? { x: Number(event.location.x ?? event.location.getX?.()), y: Number(event.location.y ?? event.location.getY?.()) } : tileOf(event.npc);
  if (type === null) return;
  credit(player, type, npcName(event.npc), "deaths", 1, at);
  creditEach(player, type, npcName(event.npc), at ?? tileOf(player));
}

/** `combat-achievements:kill` { player, monster, amount? }: a credited kill, from a death or a scripted ending. */
function creditedKill(request) {
  const player = request?.player;
  if (!player) return;
  const type = Common.leagueOf(player);
  if (type !== null) credit(player, type, request.monster, "events", Number(request.amount ?? 1));
}

function questCompleted({ player, quest }) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  for (const task of indexOf(type).quests.get(plainName(quest?.name)) ?? []) Complete.complete(player, task.id);
}

function checkQuests(player, type) {
  for (const [, tasks] of indexOf(type).quests) {
    for (const task of tasks) {
      const query = { player, name: task.trigger.name, complete: false };
      Common.api.emitCustomEvent("quest:is-complete", query);
      if (query.complete === true) Complete.complete(player, task.id);
    }
  }
}

function login({ player, league }) {
  if (!Common.catalog(league)) return;
  checkLevels(player);
  checkExperience(player);
  checkDiaries(player);
  checkAchievements(player);
  checkQuests(player, league);
}

module.exports = function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, {});
  api.onNpcDeath(npcDeath);
  api.onCustomEvent("combat-achievements:kill", creditedKill);
  api.onPlayerLevelUp(levelUp);
  api.onExperienceGained(experienceGained);
  api.onCustomEvent("diary:task", diaryTask);
  api.onCustomEvent("combat-achievements:completed", achievementCompleted);
  api.onCustomEvent("quest:completed", questCompleted);
  api.onCustomEvent("league:login", login);
};
