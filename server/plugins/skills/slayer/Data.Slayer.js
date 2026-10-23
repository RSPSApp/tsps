"use strict";

/**
 * Slayer's data, read from the cache's own tables (by their gameval names, so moved columns
 * follow a cache update) plus plugins/skills/data/slayer-masters.json for what the cache does not
 * hold (master NPC names, requirements, points, block costs).
 *
 * - slayer_task: a task's id (the slayer_target varp value), names, combat and stat
 *   requirements, extension ranges and the unlock that lengthens it.
 * - slayer_master_task: a master's tasks with weight and amount range, Konar's areas, the
 *   unlock a task needs, Mortimer's modifiers.
 * - slayer_task_sublist: the boss tasks behind the "Boss" task (subtable 1), by boss id.
 * - slayer_area: Konar's locations. slayer_unlock: the Rewards interface's unlocks (bit, cost).
 * - slayer_modifiers: Mortimer's task modifiers and the Mortimer tasks each needs completed.
 * - NPC param 50 is the Slayer task id an NPC counts for; boss NPCs are named per boss task in
 *   slayer-masters.json, since the cache has no NPC-to-boss link.
 */
const MASTERS_FILE = require("../data/slayer-masters.json");
/** Where each area is (the cache has none): boxes per area id. */
const AREAS_FILE = require("../data/slayer-areas.json");

/** NPC params: the Slayer task an NPC counts for; set on bosses (the cache marks them with it). */
const NPC_TASK_PARAM = 50;
const NPC_BOSS_PARAM = 1361;
/** The boss sub-list of the "Boss" task. */
const BOSS_SUBTABLE = 1;
/** The "Boss" task's id. */
const BOSS_TASK_ID = 98;
/** Mortimer's master id (slayer_master_task.master_id, the slayer_master varbit). */
const MORTIMER = 10;
/** Mortimer tasks completed before he offers a third choice (the choice interface's script 9739). */
const THIRD_CHOICE_TASKS = 50;
/** slayer_modifiers ids. */
const MODIFIER = { POINTS: 1, QUANTITY: 2, CLUES: 3, SUPERIOR_UNIQUES: 4, XP: 5 };

let core = null;
let data = null;

function init(api) {
  core = api.core;
}

/** One table's rows as plain objects keyed by column name (values are arrays). */
function readTable(name) {
  const { CacheDefinitions } = core;
  const tableId = CacheDefinitions.getDbTableId(name);
  if (tableId == null) throw new Error(`Slayer: cache table ${name} is missing`);
  const names = CacheDefinitions.getDbColumns(tableId);
  return CacheDefinitions.getDbTableRows(tableId).map((row) => {
    const out = { row: row.id };
    for (const [column, values] of row.columns) out[names[column] ?? `col${column}`] = values;
    return out;
  });
}

const first = (values, fallback = null) => (Array.isArray(values) && values.length > 0 ? values[0] : fallback);

/**
 * Mortimer's modifiers on a slayer_master_task row: (id, min, max) triples. A negative range
 * (quantity -15 to -30) is held as positive bounds with `negative` set, as the varbits hold it.
 */
function modifierRanges(values) {
  const out = [];
  for (let i = 0; values && i + 2 < values.length; i += 3) {
    const [id, a, b] = [values[i], values[i + 1], values[i + 2]];
    const negative = a < 0 || b < 0;
    const [low, high] = [Math.abs(a), Math.abs(b)].sort((x, y) => x - y);
    out.push({ id, min: low, max: high, negative });
  }
  return out;
}

/** [level, skill] pairs, as the cache stores them. */
function pairs(values) {
  const out = [];
  for (let i = 0; values && i + 1 < values.length; i += 2) out.push({ level: values[i], skill: values[i + 1] });
  return out;
}

function build() {
  const tasks = new Map();
  const taskById = new Map();
  for (const row of readTable("slayer_task")) {
    const extension = row.extension_min_max ?? row.extension_additive;
    const task = {
      row: row.row,
      id: first(row.id, -1),
      name: first(row.name_lowercase, ""),
      displayName: first(row.name_uppercase, ""),
      minCombat: first(row.min_comlevel, 0),
      statsAll: pairs(row.min_stat_requirement_all),
      statsAny: pairs(row.min_stat_requirement_any),
      extension: extension ? { unlockRow: extension[0], min: extension[1], max: extension[2], additive: !!row.extension_additive } : null,
      blockedByUnlockRow: first(row.block_unlock),
    };
    tasks.set(task.row, task);
    if (task.id >= 0) taskById.set(task.id, task);
  }

  const masterTasks = new Map();
  for (const row of readTable("slayer_master_task")) {
    const masterId = first(row.master_id);
    const entry = {
      row: row.row,
      masterId,
      task: tasks.get(first(row.task)),
      weight: first(row.weight, 0),
      min: first(row.min_amount, 0),
      max: first(row.max_amount, 0),
      areaRows: row.areas ?? [],
      unlockRow: first(row.task_unlock),
      modifiers: modifierRanges(row.modifier),
    };
    if (!entry.task) continue;
    if (!masterTasks.has(masterId)) masterTasks.set(masterId, []);
    masterTasks.get(masterId).push(entry);
  }

  const bosses = new Map();
  for (const row of readTable("slayer_task_sublist")) {
    if (first(row.subtable_id) !== BOSS_SUBTABLE) continue;
    const task = tasks.get(first(row.task));
    if (task) bosses.set(first(row.task_subtable_id), task);
  }

  const areas = new Map();
  for (const row of readTable("slayer_area")) {
    areas.set(row.row, {
      row: row.row,
      id: first(row.area_id),
      text: first(row.area_text, ""),
      name: first(row.area_name_in_helper, ""),
      hint: first(row.area_hint, ""),
      boxes: AREAS_FILE.areas[String(first(row.area_id))]?.boxes ?? [],
    });
  }

  const unlocks = new Map();
  const unlockByBit = new Map();
  for (const row of readTable("slayer_unlock")) {
    const unlock = {
      row: row.row,
      bit: first(row.bit),
      cost: first(row.cost, 0),
      name: first(row.name, ""),
      description: first(row.description, ""),
      refundable: first(row.refundable, 0) === 1,
      relatedTaskRow: first(row.related_task),
      /** The Rewards tab it is listed on: 0 Unlock, 1 Extend, -1 neither (list_position). */
      tab: first(row.list_position, -1),
    };
    unlocks.set(unlock.row, unlock);
    unlockByBit.set(unlock.bit, unlock);
  }

  /** Modifier id -> { id, name, requirement (Mortimer tasks completed) }. */
  const modifiers = new Map();
  for (const row of readTable("slayer_modifiers")) {
    const id = first(row.id, 0);
    if (id > 0) modifiers.set(id, { id, name: first(row.name, ""), requirement: first(row.requirement, 0) });
  }

  const masters = new Map();
  const masterByName = new Map();
  for (const [id, master] of Object.entries(MASTERS_FILE.masters)) {
    const entry = { ...master, id: Number(id), tasks: masterTasks.get(Number(id)) ?? [] };
    masters.set(entry.id, entry);
    for (const name of master.names) masterByName.set(name, entry);
  }

  const bossNames = new Map(Object.entries(MASTERS_FILE.bosses).map(([id, names]) => [Number(id), new Set(names)]));
  const namedTaskNpcs = new Map(Object.entries(MASTERS_FILE.taskNpcs).map(([id, names]) => [Number(id), new Set(names)]));
  const taskLevels = taskSlayerLevels(namedTaskNpcs);

  return {
    tasks, taskById, masterTasks, bosses, bossNames, namedTaskNpcs, areas, unlocks, unlockByBit, modifiers,
    masters, masterByName, taskLevels,
  };
}

/**
 * The Slayer level each task needs: the most common level among the attackable monsters that
 * count for it (levels from the NPC definitions; none counts as 1), lower on a tie. Disguises
 * (a whirlpool, a hole in the wall) have no Attack option, and bosses that share a task id
 * (K'ril counts for greater demons) are left out. Masters only assign tasks the player has the
 * level for (Wiki: Slayer task).
 */
function taskSlayerLevels(namedTaskNpcs) {
  const counts = new Map();
  const add = (taskId, npcId) => {
    const level = Math.max(1, core.NpcDefinition.forId(npcId).getSlayerLevel?.() ?? 1);
    if (!counts.has(taskId)) counts.set(taskId, new Map());
    const byLevel = counts.get(taskId);
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  };
  const total = core.CacheDefinitions.getCounts().npcs;
  for (let id = 0; id < total; id++) {
    const type = core.CacheDefinitions.getNpc(id);
    if (!type?.name || !(type.actions ?? []).includes("Attack") || npcParam(id, NPC_BOSS_PARAM) >= 0) continue;
    const taskId = npcTaskId(id);
    if (taskId >= 0) add(taskId, id);
    for (const [namedTask, names] of namedTaskNpcs) {
      if (names.has(type.name)) add(namedTask, id);
    }
  }
  const levels = new Map();
  for (const [taskId, byLevel] of counts) {
    let best = null;
    for (const [level, count] of byLevel) {
      if (!best || count > best.count || (count === best.count && level < best.level)) best = { level, count };
    }
    levels.set(taskId, best.level);
  }
  return levels;
}

function get() {
  data ??= build();
  return data;
}

/** The master an NPC is (by its resolved name: Turael, Steve, Kuradal...), or null. */
function masterForNpcName(name) {
  return get().masterByName.get(name) ?? null;
}

/** The task id an NPC counts for (param 50), or -1. */
function npcTaskId(npcId) {
  return npcParam(npcId, NPC_TASK_PARAM);
}

/** Whether an NPC (by its name) counts for a boss task. */
function isBossNpc(bossId, npcName) {
  return get().bossNames.get(bossId)?.has(npcName) === true;
}

/**
 * Whether a kill of this NPC counts for a task: its param 50 is the task's id, or it is one of
 * the task's named monsters (the sub-tasks whose monsters carry their parent's id).
 */
function npcCountsFor(taskId, npcId, npcName) {
  return npcTaskId(npcId) === taskId || get().namedTaskNpcs.get(taskId)?.has(npcName) === true;
}

/** Whether a location is inside an area's boxes; an area without boxes holds everything. */
function inArea(area, location) {
  if (!area?.boxes?.length) return true;
  const x = location.getX();
  const y = location.getY();
  return area.boxes.some(([minX, minY, maxX, maxY]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
}

/** The quests a task needs ({ any: [quest keys], started }), or null. */
function taskQuests(taskId) {
  return MASTERS_FILE.taskQuests[String(taskId)] ?? null;
}

/** The Slayer level a task needs. */
function taskLevel(taskId) {
  return get().taskLevels.get(taskId) ?? 1;
}

function npcParam(npcId, param) {
  const type = core.CacheDefinitions.getNpc(npcId);
  const value = type?.params?.get?.(param);
  return Number.isInteger(value) ? value : -1;
}

module.exports = {
  init,
  get,
  masterForNpcName,
  npcTaskId,
  isBossNpc,
  npcCountsFor,
  taskLevel,
  taskQuests,
  inArea,
  BOSS_TASK_ID,
  MORTIMER,
  THIRD_CHOICE_TASKS,
  MODIFIER,
  config: MASTERS_FILE,
};
