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
 *
 * A kill may also carry conditions, kept in a separate list and read off the killing blow when the
 * NPC dies (`onCombatHitResolved` records the last hit each player landed, keyed by the NPC, and
 * `onNpcDeath` reads it): `weapon`/`weapons` (the final blow from one of those items), `spell`/`spells`
 * (from one of those spells), `style` ("melee", "ranged", "magic"), `worn` (that equipment on at the
 * death), `oneHit` (one blow of at least the target's hitpoints), `noDamage` (the target never hurt a
 * player), `solo` (no other player damaged it) and `window { count, ticks }` (the count of its kills
 * within that many ticks). A creature killed with a named weapon whatever it is ("5 creatures with a
 * mace as the final hit") is `kill-any-with { items, count }`, counted on any attackable NPC's death;
 * "any one of a group N times" (the God Wars bosses) is `kill-any-one { npcs, count }`, one of them
 * reaching N, not their total; and a `kill-each` may add `noLeave` (every one of its NPCs without
 * leaving, one after the other, reset when the player does).
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
  const entry = { kills: new Map(), killEach: new Map(), killEachNoLeave: [], conditional: new Map(), anyWith: [], anyOne: new Map(), caTasks: new Map(), levels: [], levelUps: [], quests: new Map(), experience: [], experienceBySkill: new Map(), diaries: [], achievements: [] };
  for (const task of Common.catalog(type).tasks) {
    const trigger = task.trigger;
    if (!trigger) continue;
    if (trigger.kind === "kill") {
      // Every NPC the task accepts ("Callisto or Artio"); an overlay may still give one `npc`. A kill
      // with a condition (a named weapon, a time window) is read off the killing blow instead.
      const bucket = conditionalKill(trigger) ? entry.conditional : entry.kills;
      for (const npc of trigger.npcs ?? [trigger.npc]) {
        const key = String(npc).toLowerCase();
        bucket.set(key, (bucket.get(key) ?? []).concat(task));
      }
    } else if (trigger.kind === "kill-any-with") {
      entry.anyWith.push(task);
    } else if (trigger.kind === "kill-any-one") {
      for (const npc of trigger.npcs ?? []) {
        const key = String(npc).toLowerCase();
        entry.anyOne.set(key, (entry.anyOne.get(key) ?? []).concat(task));
      }
    } else if (trigger.kind === "ca-complete") {
      const key = String(trigger.task).toLowerCase();
      entry.caTasks.set(key, (entry.caTasks.get(key) ?? []).concat(task));
    } else if (trigger.kind === "kill-each") {
      for (const npc of Object.keys(trigger.npcs)) {
        const key = npc.toLowerCase();
        entry.killEach.set(key, (entry.killEach.get(key) ?? []).concat(task));
      }
      // A `noLeave` one resets when the player is outside its place (every NPC of it in one sitting).
      if (trigger.noLeave) entry.killEachNoLeave.push(task);
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
      // The league's skills only (their 2277 is 23 x 99): Sailing came after the first two, and Demonic Pacts left it
      // out (Wiki: "Sailing was not included in the Demonic Pacts League").
      return [...skills()].reduce((sum, [name, skill]) => sum + (name === "SAILING" ? 0 : manager.getMaxLevel(skill)), 0) >= trigger.level;
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

/**
 * Combat Achievements: a tier reached, a count of tasks (or speed tasks), every task of one monster or of N,
 * and a named task done (`ca-complete`). All read the achievements plugin's own state, so a character who
 * qualified before their league task existed is backfilled at login (a CA cannot be done twice).
 */
function checkAchievements(player) {
  const type = Common.leagueOf(player);
  if (type === null) return;
  const entry = indexOf(type);
  // "ca-complete": the named Combat Achievement is already done (the plugin's authoritative progress).
  checkAchievementTasks(player, type, entry.caTasks);
  const tasks = entry.achievements;
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

/**
 * `ca-complete { task }`: the named achievement is done. Asked of the achievements plugin whatever else
 * happened, so it backfills every such league task at login. `completedIds` keeps it idempotent.
 */
function checkAchievementTasks(player, type, caTasks) {
  if (!caTasks.size) return;
  const done = new Set(Common.completedIds(player));
  for (const tasks of caTasks.values()) {
    const open = tasks.filter((task) => !done.has(task.id));
    if (!open.length) continue;
    // The achievements plugin matches the name to its own tasks and reports whether this player has it.
    const query = { player, task: open[0].trigger.task, done: false };
    Common.api.emitCustomEvent("combat-achievements:has-task", query);
    if (query.done !== true) continue;
    for (const task of open) Complete.complete(player, task.id, type);
  }
}

function achievementCompleted({ player, task }) {
  if (!player) return;
  const type = Common.leagueOf(player);
  if (type !== null && task?.name) {
    const done = new Set(Common.completedIds(player));
    for (const each of indexOf(type).caTasks.get(String(task.name).toLowerCase()) ?? []) {
      if (!done.has(each.id)) Complete.complete(player, each.id, type);
    }
  }
  checkAchievements(player);
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
 * How long a death and its plugin's own report of that kill are one kill. Araxxor's corpse reports 5 ticks after the
 * death and Skotizo's report comes about 15 ticks before it, so a same-tick merge counted both. Within the window each
 * source still adds up on its own (two deaths are two kills), so only a death paired with its own report collapses.
 * The window is measured from the task's latest death or report.
 */
const CREDIT_WINDOW_TICKS = 20;

/** "The Hueycoatl" and "Hueycoatl, The" are one name: a plugin's kill report may use either form. */
function articleSwapped(key) {
  const leading = /^the (.+)$/.exec(key);
  if (leading) return `${leading[1]}, the`;
  const trailing = /^(.+), the$/.exec(key);
  return trailing ? `the ${trailing[1]}` : null;
}

/**
 * A `kill` with a condition (a named weapon or spell, a combat style, worn equipment, one hit, no
 * damage taken, solo, or a time window): read off the killing blow rather than a plain count.
 */
function conditionalKill(trigger) {
  return trigger.weapon !== undefined || trigger.weapons !== undefined || trigger.spell !== undefined || trigger.spells !== undefined
    || trigger.style !== undefined || trigger.worn !== undefined || trigger.oneHit === true || trigger.noDamage === true
    || trigger.solo === true || trigger.window !== undefined;
}

/** NPC -> Map(player -> the last hit the player landed on it; its killing blow at death). */
const lastHits = new WeakMap();
/** The NPCs that have damaged a player this life (a `noDamage` kill must not have). */
const hurtPlayers = new WeakSet();
/** Player -> task id -> the ticks of its `window` kills, newest last (a session, not persisted). */
const killWindows = new WeakMap();

const WEAPON_SLOT = 3;

function equippedWeaponId(player) {
  const item = player.getEquipment?.()?.getItems?.()?.[WEAPON_SLOT];
  return item && Number(item.getId?.()) >= 0 ? Number(item.getId()) : -1;
}

function wornIds(player) {
  const ids = new Set();
  for (const item of player.getEquipment?.()?.getItems?.() ?? []) if (item && Number(item.getId?.()) >= 0) ids.add(Number(item.getId()));
  return ids;
}

/** The server's combat spell by name (CombatSpells' key: EARTH_BLAST is "earth blast"). */
let spellNames = null;
function spellNameOf(spell) {
  if (!spell) return null;
  if (!spellNames) {
    spellNames = new Map();
    for (const key of Object.getOwnPropertyNames(Common.core.CombatSpells ?? {})) {
      const value = Common.core.CombatSpells[key];
      if (value && typeof value.spellId === "function") spellNames.set(value, key.toLowerCase().replace(/_/g, " "));
    }
  }
  return spellNames.get(spell) ?? null;
}

/** A hit's combat style as a task names it: "melee", "ranged" or "magic". */
function styleName(type) {
  const { MELEE, RANGED, MAGIC } = Common.core.CombatType ?? {};
  return type === MELEE ? "melee" : type === RANGED ? "ranged" : type === MAGIC ? "magic" : null;
}

/** What a player's blow was: the weapon, the spell, the style, the damage, what was worn, the target's HP. */
function blowOf(player, hit, target) {
  return {
    weapon: equippedWeaponId(player),
    spell: spellNameOf(hit?.getSpell?.()),
    style: styleName(hit?.getCombatType?.()),
    damage: Number(hit?.getTotalDamage?.() ?? 0),
    worn: wornIds(player),
    hitpoints: Number(target?.getMaxHitpoints?.() ?? 0),
  };
}

function blowFor(npc, player) {
  return lastHits.get(npc)?.get(player) ?? null;
}

/** The last hit each player landed on the npc (the killing blow among them), and who the npc hurt. */
function combatHitResolved({ attacker, target, hit }) {
  if (!attacker || !target) return;
  if (attacker.isPlayer?.() && target.isNpc?.()) {
    const player = attacker.getAsPlayer();
    let byPlayer = lastHits.get(target);
    if (!byPlayer) lastHits.set(target, (byPlayer = new Map()));
    byPlayer.set(player, blowOf(player, hit, target));
  } else if (attacker.isNpc?.() && target.isPlayer?.()) {
    hurtPlayers.add(attacker);
  }
}

/** Whether a blow satisfies a conditional kill's conditions (and the death event, for solo). */
function blowSatisfies(task, blow, event, player) {
  const trigger = task.trigger;
  if (!blow) return trigger.noDamage === true && trigger.worn === undefined && trigger.oneHit !== true && trigger.solo !== true;
  const weapons = trigger.weapons ?? trigger.weapon;
  if (weapons !== undefined && !weapons.map(Number).includes(blow.weapon)) return false;
  const spells = trigger.spells ?? trigger.spell;
  if (spells !== undefined && !spells.includes(blow.spell)) return false;
  if (trigger.style !== undefined && trigger.style !== blow.style) return false;
  if (trigger.worn !== undefined && !(trigger.worn.map(Number).some((id) => blow.worn.has(id)))) return false;
  if (trigger.oneHit === true && !(blow.hitpoints > 0 && blow.damage >= blow.hitpoints)) return false;
  if (trigger.noDamage === true && hurtPlayers.has(event.npc)) return false;
  if (trigger.solo === true && (event.damagers ?? []).some((each) => each !== player && each?.isRegistered?.())) return false;
  return true;
}

/** `kill { ...conditions }`: credit the open conditional tasks for the NPC, if the blow meets them. */
function creditConditional(player, type, name, npcId, at, event) {
  const entry = indexOf(type);
  const tasks = [...(entry.conditional.get(String(name ?? "").toLowerCase()) ?? []), ...(entry.conditional.get(String(npcId)) ?? [])];
  if (!tasks.length) return;
  const blow = blowFor(event.npc, player);
  const done = new Set(Common.completedIds(player));
  const progress = { ...killsOf(player) };
  const reached = [];
  for (const task of tasks) {
    if (done.has(task.id) || !inArea(task, type, at ?? tileOf(player)) || !blowSatisfies(task, blow, event, player)) continue;
    if (task.trigger.window) {
      const ticks = windowOf(player, task.id, Number(task.trigger.window.ticks));
      const tick = Common.core.World.getProcessCycle?.() ?? 0;
      ticks.push(tick);
      while (ticks.length && tick - ticks[0] > Number(task.trigger.window.ticks)) ticks.shift();
      if (ticks.length >= (Number(task.trigger.window.count) || Number(task.trigger.count) || 1)) { deleteWindow(player, task.id); reached.push(task); }
      continue;
    }
    const total = (Number(progress[task.id]) || 0) + 1;
    if (total >= (Number(task.trigger.count) || 1)) { delete progress[task.id]; reached.push(task); }
    else progress[task.id] = total;
  }
  player.setAttribute(Common.KILLS_ATTRIBUTE, progress);
  for (const task of reached) Complete.complete(player, task.id, type);
}

function windowOf(player, taskId, ticks) {
  let perPlayer = killWindows.get(player);
  if (!perPlayer) killWindows.set(player, (perPlayer = new Map()));
  let list = perPlayer.get(taskId);
  if (!list) perPlayer.set(taskId, (list = []));
  return list;
}
function deleteWindow(player, taskId) { killWindows.get(player)?.delete(taskId); }

/** `kill-any-with { items, count }`: any NPC killed with one of the items as the final blow. */
function creditAnyWith(player, type, npc, at) {
  const tasks = indexOf(type).anyWith;
  if (!tasks.length) return;
  const blow = blowFor(npc, player);
  if (!blow) return;
  const done = new Set(Common.completedIds(player));
  const progress = { ...killsOf(player) };
  const reached = [];
  for (const task of tasks) {
    if (done.has(task.id) || !inArea(task, type, at ?? tileOf(player))) continue;
    if (!task.trigger.items.map(Number).includes(blow.weapon)) continue;
    const total = (Number(progress[task.id]) || 0) + 1;
    if (total >= (Number(task.trigger.count) || 1)) { delete progress[task.id]; reached.push(task); }
    else progress[task.id] = total;
  }
  player.setAttribute(Common.KILLS_ATTRIBUTE, progress);
  for (const task of reached) Complete.complete(player, task.id, type);
}

/** `kill-any-one { npcs, count }`: one of the group reaching the count (its own kills, not the total). */
function creditAnyOne(player, type, name, at) {
  const tasks = indexOf(type).anyOne.get(String(name ?? "").toLowerCase());
  if (!tasks) return;
  const done = new Set(Common.completedIds(player));
  const progress = { ...killsOf(player) };
  const reached = [];
  for (const task of tasks) {
    if (done.has(task.id) || !inArea(task, type, at ?? tileOf(player))) continue;
    const wanted = (task.trigger.npcs ?? []).find((npc) => String(npc).toLowerCase() === String(name ?? "").toLowerCase());
    const counts = { ...(progress[task.id] && typeof progress[task.id] === "object" ? progress[task.id] : {}) };
    counts[wanted] = (Number(counts[wanted]) || 0) + 1;
    progress[task.id] = counts;
    if (counts[wanted] >= (Number(task.trigger.count) || 1)) reached.push(task);
  }
  player.setAttribute(Common.KILLS_ATTRIBUTE, progress);
  for (const task of reached) Complete.complete(player, task.id, type);
}
/**
 * `amount` kills of the NPC `name` from `source` ("deaths" or "events") for the character's open
 * kill tasks that accept it: each task's progress takes the window's larger count, then any task
 * that reached its count completes.
 */

function credit(player, type, name, source, amount, tile = null) {
  const kills = indexOf(type).kills;
  const keys = Array.isArray(name) ? name : [name];
  const tasks = keys.flatMap((each) => {
    const key = String(each ?? "").toLowerCase();
    return kills.get(key) ?? kills.get(articleSwapped(key)) ?? [];
  });
  if (!tasks.length || !(amount > 0)) return;
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
    if (!entry || tick - entry.tick > CREDIT_WINDOW_TICKS || tick < entry.tick) {
      perTask.set(task.id, (entry = { tick, deaths: 0, events: 0, credited: 0 }));
    }
    // The window runs from the latest event: a second kill inside it opens its own window for its report.
    entry.tick = tick;
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
 * kills entry ({ name: kills }), in its area or place. A `noLeave` one keeps its counts only while
 * the player stays inside it: leaving it wipes them, so the kills must be one sitting. Leaving is read
 * off the edges (a zone exit for the place, a map square crossed, and login), never a per-tick hook.
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

/**
 * A `noLeave` task's counts need the player inside its place. Wipe those of a task whose place the
 * player has left (and any stale from a previous session, at login). A place the player is still inside
 * keeps its counts; several boxes are one place (`Common.inPlace`).
 */
function checkKillEachLeft(player) {
  if (!player) return;
  const type = Common.leagueOf(player);
  if (type === null) return;
  const tasks = indexOf(type).killEachNoLeave;
  if (!tasks.length) return;
  const at = tileOf(player);
  const progress = killsOf(player);
  const done = new Set(Common.completedIds(player));
  const kept = { ...progress };
  let changed = false;
  for (const task of tasks) {
    if (done.has(task.id) || kept[task.id] === undefined) continue;
    if (at && task.trigger.place !== undefined && Common.inPlace(task.trigger.place, at.x, at.y)) continue;
    if (inArea(task, type, at)) continue;
    delete kept[task.id];
    changed = true;
  }
  if (changed) player.setAttribute(Common.KILLS_ATTRIBUTE, kept);
}

/** `kill-each` noLeave: a zone exit from the place, a crossed map square and login are the only edges. */
function onPlaceExit({ player } = {}) {
  checkKillEachLeft(player);
}

/** A 64x64 map square crossed (walking or a teleport) can be the leaving edge; login covers the rest. */
function onMapSquareChange({ player } = {}) {
  checkKillEachLeft(player);
}

/** The places some league's `kill-each` noLeave task names, each box a zone watched for its exit. */
function watchNoLeavePlaces(api) {
  const named = new Set();
  for (const type of Common.types()) {
    for (const task of Common.catalog(type).tasks) if (task.trigger?.kind === "kill-each" && task.trigger.noLeave && task.trigger.place !== undefined) named.add(task.trigger.place);
  }
  for (const place of named) {
    for (const [minX, minY, maxX, maxY] of Common.places[place]?.rects ?? []) api.onZoneExit({ minX, maxX, minY, maxY }, onPlaceExit);
  }
}

function npcDeath(event) {
  const player = event?.killer;
  if (!player?.isPlayer?.() && !player?.getPacketSender) return;
  const type = Common.leagueOf(player);
  const at = event.location ? { x: Number(event.location.x ?? event.location.getX?.()), y: Number(event.location.y ?? event.location.getY?.()) } : tileOf(event.npc);
  if (type === null) return;
  const name = npcName(event.npc);
  credit(player, type, [name, event.npcId], "deaths", 1, at);
  creditConditional(player, type, name, event.npcId, at, event);
  creditAnyWith(player, type, event.npc, at);
  creditAnyOne(player, type, name, at);
  creditEach(player, type, name, at ?? tileOf(player));
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
  checkKillEachLeft(player);
}

module.exports = function attach(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, {});
  api.onNpcDeath(npcDeath);
  // A `noLeave` task resets on leaving its place: zone exits (walking out, a teleport) and crossed map
  // squares, plus the login sweep, instead of a hook that runs for every player every tick.
  watchNoLeavePlaces(api);
  api.onPlayerMapSquareChange(onMapSquareChange);
  api.onCustomEvent("combat-achievements:kill", creditedKill);
  api.onCombatHitResolved(combatHitResolved);
  api.onPlayerLevelUp(levelUp);
  api.onExperienceGained(experienceGained);
  api.onCustomEvent("diary:task", diaryTask);
  api.onCustomEvent("combat-achievements:completed", achievementCompleted);
  api.onCustomEvent("quest:completed", questCompleted);
  api.onCustomEvent("league:login", login);
};
// The pure decision the kill conditions make, for tests (a task's trigger, a recorded blow, the death).
module.exports._test = { blowSatisfies, conditionalKill };
