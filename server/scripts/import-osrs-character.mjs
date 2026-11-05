#!/usr/bin/env node
/**
 * Imports a character from a RuneLite Account Data Exporter JSON file into their
 * save. Run it with the server stopped, after logging in with the character's
 * exact name once, so the account exists:
 *
 *   yarn saves:import-osrs-character "Player Name" --input <export.json>                  # what would change
 *   yarn saves:import-osrs-character "Player Name" --input <export.json> --apply          # do it
 *   yarn saves:import-osrs-character "Player Name" --input <export.json> --progress       # + quests/diaries/CAs
 *   yarn saves:import-osrs-character "Player Name" --input <export.json> --database <path> [--apply]
 *
 * The Account Data Exporter plugin dumps a full character snapshot under
 * %USERPROFILE%/.runelite/account-data-exporter/<rsn>.json: every skill by
 * name, the bank (with OSRS item ids and quantities), inventory, equipment,
 * quest states, achievement diaries and combat achievements. This import
 * copies:
 *
 * - by default: skills, plus the items of the bank, inventory and equipment;
 * - with --items-only: the items alone, leaving the skills as they are;
 * - with --progress: quests (stage-completed), achievement diaries (completed
 *   tiers) and combat achievements (individual task completions).
 *
 * The bank, inventory and equipment are replaced, not merged: whatever the
 * character held on this server before is in the pre-import copy only.
 *
 * Skill XP lands as saved XP with levels derived from the OSRS XP table,
 * capped at 99: the server models no virtual levels beyond 99, and its own
 * formulas assume levels <= 99. The export's own skills and a summary of the
 * import go in a provenance record under the "osrs-account-import:data"
 * attribute. No plugin registers that attribute as persistent, so the server
 * drops it on the player's first save after login: from then on the record is
 * kept only in the "account-exporter-import" copy in the save history.
 *
 * Items land as { id, amount } OSRS item ids; this server's item definitions
 * come from the OSRS cache, so ids are used verbatim. The script does not load
 * the cache, so it cannot check an id against it: bank entries the export
 * itself could not name are listed in the dry-run output instead. Bank tabs
 * are rebuilt from the export's per-tab
 * sizes (the BANK_TAB_1..9 varbits): the OSRS bank stores tab 1's items
 * first, then each later tab, and the main tab's items last - the same order
 * this server's own Bank.layout() walks - so the split is faithful. A tab
 * grows as items are added, and a save loads whole, so no tab is split up.
 * When the sizes don't describe a clean split (missing, more than the bank
 * holds, or an empty tab before a used one) everything collapses into tab 0
 * instead, and the reason is reported and kept in the provenance attribute.
 * A bank over Bank.MAX_SLOTS (1410) items is refused.
 *
 * Progress (--progress) notes:
 * - Quests: the export marks each quest FINISHED / IN_PROGRESS / NOT_STARTED.
 *   The importer maps the export's quest names onto the server's own quest
 *   plugins (plugins/quests/quests/*.Quest.js, each one run against a stub
 *   api so its own registerQuest call hands over the key/name/completionValue/
 *   questPoints the server uses) and writes the standard
 *   stage attribute ("quest.<key>.stage" = completionValue) plus a recomputed
 *   "quest.points". Per-quest post-completion sub-state (delivered-ingredient
 *   flags, unlocked shops, teleport unlocks) is NOT written - stage completion
 *   is what the quest list, quest points and client show, but a handful of
 *   plugins gate extra perks on their own flags; those are listed in the
 *   provenance record. Recipe for Disaster is skipped entirely: the server
 *   models it as one plugin with per-member flags rather than ten sub-quests,
 *   and the export's RFD rows carry no flags. Quests the server has not built
 *   yet (no registerQuest def) are reported, not guessed.
 * - Diaries: the export only says which tier of each region diary is fully
 *   complete, so the importer marks every task key of every completed tier
 *   (achievement-diaries:tasks) and claims those tiers (achievement-diaries:
 *   rewards), matching what an actual completion would look like.
 * - Combat achievements: the export includes each task with its id, so the
 *   importer writes the same bitmap the server uses (combat-achievements:
 *   completed). Claimed tier rewards are not inferred; claim them in game.
 * - F2P caveat: quest plugins excluded from a world's quest list (Quests.plugin.js)
 *   still exist as defs; verify on a members world, where all of them load.
 *
 * --apply first copies the database to
 * data/saves/players-before-account-import-<time>.sqlite, then rewrites the
 * one player in one transaction, recording the previous save as
 * "pre-account-import" and the import as "account-exporter-import" in the save
 * history.
 */
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const { SqliteSaveHistory } = require("../plugins/persistence/SaveHistory.SqlitePlayerPersistence.js");

const PRE_IMPORT_REASON = "pre-account-import";
const IMPORT_REASON = "account-exporter-import";
const IMPORT_ATTRIBUTE = "osrs-account-import:data";
const QUEST_POINTS_ATTRIBUTE = "quest.points"; // as QuestRuntime.js declares it
const DIARIES_TASKS_ATTRIBUTE = "achievement-diaries:tasks";
const DIARIES_REWARDS_ATTRIBUTE = "achievement-diaries:rewards";
const CA_COMPLETED_ATTRIBUTE = "combat-achievements:completed";
const MAX_SKILL_LEVEL = 99; // the server's getMaxAchievingLevel; virtual levels aren't modelled
const OSRS_XP_CAP = 200_000_000;
const MAX_INVENTORY_SLOTS = 28;
const MAX_EQUIPMENT_SLOTS = 14;
const CA_BITMAP_WORDS = 21; // as Data.CombatAchievements.js TASK_VARPS
const BANK_MAX_SLOTS = 1410; // Bank.MAX_SLOTS
const MAX_STACK_AMOUNT = 0x7fffffff; // StackType.ts MAX_STACK_AMOUNT: item packets carry a signed 32-bit amount

/** A stack amount the server can hold and send: a whole number from 1 to MAX_STACK_AMOUNT. */
function validAmount(amount) {
  return Number.isInteger(amount) && amount > 0 && amount <= MAX_STACK_AMOUNT;
}

/**
 * Skill order and names exactly as saved (Skill.ts `VALUES`). The exporter
 * spells "Runecraft", not "Runecrafting", so one alias. Saved skill arrays
 * predate OSRS's Hunter/Construction order on purpose (Skill.ts translates for
 * the client), and the importer only ever writes saved-order indices.
 */
const SKILLS = [
  "Attack", "Defence", "Strength", "Hitpoints", "Ranged", "Prayer", "Magic",
  "Cooking", "Woodcutting", "Fletching", "Fishing", "Firemaking", "Crafting",
  "Smithing", "Mining", "Herblore", "Agility", "Thieving", "Slayer", "Farming",
  "Runecrafting", "Construction", "Hunter", "Sailing",
];
const SKILL_ALIASES = { runecraft: "Runecrafting" };
const HITPOINTS = "Hitpoints";
const NUMBER_OF_SKILLS = SKILLS.length;

/** XP needed for each level 1..maxLevel (thresholds[i] = XP for level i+1), OSRS formula. */
function buildXpTable(maxLevel = 135) {
  const thresholds = new Array(maxLevel).fill(0); // level 1 costs nothing
  let points = 0;
  for (let level = 1; level + 1 <= maxLevel; level++) {
    points += Math.floor(level + 300.0 * Math.pow(2.0, level / 7.0));
    thresholds[level] = Math.floor(points / 4); // XP that reaches level + 1
  }
  return thresholds;
}
const XP_TABLE = buildXpTable();

function virtualLevelForXp(xp) {
  if (xp <= 0) return 1;
  let level = 1;
  while (level < XP_TABLE.length && XP_TABLE[level] <= xp) level++;
  return level;
}

function parseArgs(argv) {
  const args = { rsn: null, input: null, apply: false, database: null, itemsOnly: false, progress: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--items-only") args.itemsOnly = true;
    else if (arg === "--progress") args.progress = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--database") args.database = argv[++i];
    else if (arg === "--input") args.input = argv[++i];
    else if (arg === "--rsn") args.rsn = argv[++i];
    else if (!arg.startsWith("--") && args.rsn === null) args.rsn = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.rsn) {
    throw new Error(
      'Usage: yarn saves:import-osrs-character "Player Name" --input <export.json> [--items-only] [--progress] [--apply] [--database <path>]'
    );
  }
  if (!args.input) {
    throw new Error(
      "--input <file.json> is required (e.g. %USERPROFILE%/.runelite/account-data-exporter/<rsn>.json)"
    );
  }
  // Official OSRS names: 1-12 letters/digits/spaces/underscores/hyphens.
  const rsn = String(args.rsn).trim();
  if (!/^[A-Za-z0-9_\- ]{1,12}$/.test(rsn)) {
    throw new Error(
      `"${rsn}" is not a legal OSRS display name (1-12 letters, digits, spaces, underscores or hyphens).`
    );
  }
  return args;
}

/**
 * Reads and validates a RuneLite Account Data Exporter snapshot, normalizing the
 * parts this import consumes. Throws with a readable message on unusable exports.
 */
function readExport(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  let exportRoot = null;
  try {
    exportRoot = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${inputPath}: not valid JSON (${error.message})`);
  }
  if (!exportRoot || typeof exportRoot !== "object") {
    throw new Error(`${inputPath}: not an Account Data Exporter snapshot`);
  }
  const rsn = exportRoot.rsn;
  if (typeof rsn !== "string" || rsn.length === 0) {
    throw new Error(`${inputPath}: snapshot has no rsn`);
  }
  const skills = exportRoot.skills ?? {};
  const container = (name) => {
    const value = exportRoot[name] ?? { items: [] };
    return Array.isArray(value.items) ? value.items : [];
  };
  const bank = container("bank");
  const knownName = (entry) => typeof entry?.name === "string" && entry.name.length > 0;
  const unknownBank = bank.filter(
    (entry) => Number.isFinite(entry?.id) && entry.id > 0 && !knownName(entry)
  );
  // The exporter's quests field: a box of { notStarted, inProgress, finished,
  // unknown, total, questPoints, entries } - entries is the authoritative list.
  const questBox = exportRoot.quests ?? {};
  const quests = Array.isArray(questBox.entries)
    ? questBox.entries
    : [
        ...(questBox.finished ?? []),
        ...(questBox.inProgress ?? []),
        ...(questBox.notStarted ?? []),
        ...(questBox.unknown ?? []),
      ];
  return {
    rsn,
    schemaVersion: String(exportRoot.schemaVersion ?? "unknown"),
    accountTypeName: String(exportRoot.accountTypeName ?? "unknown"),
    timestampIso: String(exportRoot.timestampIso ?? "unknown"),
    skills,
    totalLevel: Number(exportRoot.totalLevel ?? 0),
    totalXp: Number(exportRoot.totalXp ?? 0),
    combatLevel: Number(exportRoot.combatLevel ?? 0),
    bank,
    bankTabSizes: exportRoot.bankTabSizes ?? null,
    inventory: container("inventory"),
    equipment: container("equipment"),
    quests,
    questTotals: {
      total: Number(questBox.total ?? 0),
      questPoints: Number(questBox.questPoints ?? 0),
    },
    achievementDiaries: exportRoot.achievementDiaries ?? null,
    combatAchievements: exportRoot.combatAchievements ?? null,
    unknownBank,
  };
}

/** RFD sub-quests: one server plugin with member flags, no import path; always untouched. */
function isRecipeForDisasterRow(id) {
  return String(id ?? "").startsWith("RECIPE_FOR_DISASTER");
}

// ---------------------------------------------------------------------------
// Quest defs, read from the quest plugins' own registerQuest calls.
// ---------------------------------------------------------------------------

/**
 * A stand-in for the plugin api and for core modules: every property is another
 * stand-in, every call returns one, and it reads as 0 where a number is wanted.
 * Quest plugins only wire hooks while registering, so this lets each one run its
 * register function far enough to call registerQuest without a running server.
 */
function standIn() {
  return new Proxy(function standInTarget() {}, {
    get: (_target, prop) => {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "then") return undefined; // not a promise
      return standIn();
    },
    apply: () => standIn(),
    construct: () => standIn(),
  });
}

/**
 * One entry per quest plugin under plugins/quests/quests/*.Quest.js:
 * { key, name, completion, points, file }. Each plugin's register function runs
 * against a stand-in api with QuestRuntime.registerQuest swapped for a recorder,
 * so the values are the ones that plugin itself registers (the same stage its
 * own completion sets) rather than a reading of its source text. Requires of
 * the TypeScript core are answered with stand-ins too, and both swaps are undone
 * before returning. A plugin that fails to load, or a def without a usable
 * completion value, is reported under `failed` and never imported.
 */
function loadQuestDefs(serverDir, log) {
  const questDir = path.join(serverDir, "plugins", "quests", "quests");
  if (!fs.existsSync(questDir)) throw new Error(`No quest plugins at ${questDir}`);
  const questRuntime = require(path.join(serverDir, "plugins", "quests", "QuestRuntime.js"));
  const recorded = [];
  const originalRegisterQuest = questRuntime.registerQuest;
  const originalLoad = Module._load;
  questRuntime.registerQuest = (_api, def) => {
    recorded.push(def);
    return standIn();
  };
  Module._load = function loadWithStandIns(request, ...rest) {
    if (String(request).replace(/\\/g, "/").includes("src/main/typescript")) return standIn();
    return originalLoad.call(this, request, ...rest);
  };
  const defs = [];
  const failed = [];
  try {
    for (const file of fs.readdirSync(questDir).filter((f) => f.endsWith(".Quest.js")).sort()) {
      const before = recorded.length;
      try {
        const plugin = require(path.join(questDir, file));
        const register = typeof plugin === "function" ? plugin : plugin?.register;
        if (typeof register === "function") register(standIn());
      } catch (error) {
        failed.push(`${file}: ${String(error?.message ?? error).split("\n")[0]}`);
        continue;
      }
      for (const def of recorded.slice(before)) {
        const completion = def.completionValue ?? 2; // QuestRuntime's isComplete default
        const points = def.questPoints ?? 0;
        if (typeof def.key !== "string" || typeof def.name !== "string" || !Number.isInteger(completion) || completion <= 0 || !Number.isInteger(points)) {
          failed.push(`${file}: no usable key/name/completionValue/questPoints`);
          continue;
        }
        defs.push({ key: def.key, name: def.name, completion, points, file });
      }
    }
  } finally {
    questRuntime.registerQuest = originalRegisterQuest;
    Module._load = originalLoad;
  }
  if (log) log(`Loaded ${defs.length} quest definition(s) from the quest plugins.`);
  for (const entry of failed) log?.(`  (quest plugin not read, its quest is never imported: ${entry})`);
  return { defs, failed };
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function questDefIndex(defs) {
  const byNorm = new Map();
  for (const def of defs) {
    for (const label of [def.name, def.key]) {
      if (label) byNorm.set(norm(label), def);
    }
  }
  return byNorm;
}

/**
 * Maps the export's quest states onto server defs:
 * `import` = finished quests with a known def and a resolvable completion value.
 * Everything else is reported: unbuilt quests, the RFD plugin (no flag
 * import), and in-progress quests are left untouched. A quest plugin that
 * could not be read stops the import, rather than reporting its quest as unbuilt.
 */
function questImport(exportData, { defs, failed }, currentAttributes, log) {
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} quest plugin(s) could not be read, so their quests can't be imported:\n  ` +
        failed.join("\n  ")
    );
  }
  const byNorm = questDefIndex(defs);
  const stageAttribute = (key) => `quest.${key}.stage`;
  const importStage = new Map(); // key -> { attribute, value, points, name }
  const reported = { skippedRfd: [], unbuilt: [], inProgress: [], notStarted: 0 };
  for (const row of exportData.quests) {
    if (row.state === "NOT_STARTED") {
      reported.notStarted++;
      continue;
    }
    if (row.state === "IN_PROGRESS") {
      reported.inProgress.push(row.name);
      continue;
    }
    if (isRecipeForDisasterRow(row.id)) {
      reported.skippedRfd.push(row.name);
      continue;
    }
    const def = byNorm.get(norm(row.name));
    if (!def) {
      reported.unbuilt.push(row.name);
      continue;
    }
    const existingStage = Number(currentAttributes?.[stageAttribute(def.key)]);
    const finalStage = Number.isFinite(existingStage) ? Math.max(existingStage, def.completion) : def.completion;
    importStage.set(def.key, {
      attribute: stageAttribute(def.key),
      value: finalStage,
      points: def.points,
      name: def.name,
    });
  }
  // quest.points: the save's own total plus the points of each quest this import
  // completes. Not recounted from stages: some quests award points outside their
  // stage (Recipe for Disaster gives one per finished sub-quest through its own
  // flags), and a recount would drop them.
  const existingPoints = Number(currentAttributes?.[QUEST_POINTS_ATTRIBUTE]);
  let questPoints = Number.isFinite(existingPoints) ? existingPoints : 0;
  for (const [key, entry] of importStage) {
    const def = defs.find((d) => d.key === key);
    const existingStage = Number(currentAttributes?.[stageAttribute(key)]);
    const alreadyComplete = Number.isFinite(existingStage) && existingStage >= def.completion;
    if (!alreadyComplete) questPoints += entry.points;
  }
  return { importStage, pointsAttribute: { attribute: QUEST_POINTS_ATTRIBUTE, value: questPoints }, reported };
}

// ---------------------------------------------------------------------------
// Achievement diaries.
// ---------------------------------------------------------------------------

function diariesImport(exportData, currentAttributes, serverDir, log) {
  const diariesDataPath = path.join(
    serverDir,
    "plugins",
    "achievements",
    "diaries",
    "data",
    "achievement-diaries.json"
  );
  const data = JSON.parse(fs.readFileSync(diariesDataPath, "utf8"));
  const diaries = data.diaries ?? [];
  const byKey = new Map(diaries.map((diary) => [diary.key, diary]));
  const tasks = { ...(currentAttributes?.[DIARIES_TASKS_ATTRIBUTE] ?? {}) };
  const rewards = { ...(currentAttributes?.[DIARIES_REWARDS_ATTRIBUTE] ?? {}) };
  // The exporter spells some region keys differently to the server's diary keys.
  const REGION_ALIASES = {
    "kourend-kebos": "kourend",
    "kourend_kebos": "kourend",
    "lumbridge-draynor": "lumbridge",
    "lumbridge_draynor": "lumbridge",
    "western-provinces": "western",
    "western_provinces": "western",
  };
  const regions = exportData.achievementDiaries?.regions ?? [];
  let importedTiers = 0;
  let importedTasks = 0;
  const unknownRegions = [];
  for (const region of regions) {
    const raw = String(region.key).toLowerCase();
    const diary = byKey.get(REGION_ALIASES[raw] ?? raw);
    if (!diary) {
      unknownRegions.push(region.key);
      continue;
    }
    for (const tier of ["easy", "medium", "hard", "elite"]) {
      if (!region[tier]?.complete) continue;
      const tierTasks = diary.tiers?.[tier]?.tasks ?? [];
      const keys = tierTasks.map((task) => task.key);
      const merged = new Set([...(tasks[diary.key] ?? []), ...keys]);
      tasks[diary.key] = [...merged].sort();
      const claimedTiers = new Set([...(rewards[diary.key] ?? []), tier]);
      rewards[diary.key] = [...claimedTiers];
      importedTiers++;
      importedTasks += keys.length;
    }
  }
  return {
    tasksAttribute: { attribute: DIARIES_TASKS_ATTRIBUTE, value: tasks },
    rewardsAttribute: { attribute: DIARIES_REWARDS_ATTRIBUTE, value: rewards },
    importedTiers,
    importedTasks,
    unknownRegions,
  };
}

// ---------------------------------------------------------------------------
// Combat achievements.
// ---------------------------------------------------------------------------

function combatAchievementsImport(exportData, currentAttributes, log) {
  // task id N -> bit N % 32 of word N / 32 (as Progress.CombatAchievements.js).
  const words = [...(currentAttributes?.[CA_COMPLETED_ATTRIBUTE] ?? new Array(CA_BITMAP_WORDS).fill(0))];
  while (words.length < CA_BITMAP_WORDS) words.push(0);
  let imported = 0;
  const completedNames = [];
  for (const tier of exportData.combatAchievements?.tiers ?? []) {
    for (const task of tier.tasks ?? []) {
      if (!task.completed) continue;
      const id = Number(task.id);
      if (!Number.isInteger(id) || id < 0 || id >= CA_BITMAP_WORDS * 32) continue;
      const bit = 1 << (id % 32);
      if (!(words[id / 32 | 0] & bit)) imported++;
      words[id / 32 | 0] |= bit;
      completedNames.push(`[${tier.name}] ${task.name} (id ${id})`);
    }
  }
  return {
    completedAttribute: { attribute: CA_COMPLETED_ATTRIBUTE, value: words },
    imported,
    completedNames,
  };
}

/**
 * Saved skill arrays from an export. Unpublished skills (0 XP, no skill
 * object) are left at a fresh character's value (level 1, Hitpoints 10); the
 * export is authoritative and this import does not guess.
 */
function skillArraysFor(skills) {
  const byName = new Map();
  for (const [name, stats] of Object.entries(skills ?? {})) {
    const normalized = SKILL_ALIASES[name.toLowerCase()] ?? name;
    byName.set(String(normalized).toLowerCase(), stats);
  }
  const xp = new Array(NUMBER_OF_SKILLS).fill(0);
  const level = new Array(NUMBER_OF_SKILLS).fill(1);
  const maxLevel = new Array(NUMBER_OF_SKILLS).fill(1);
  for (let index = 0; index < NUMBER_OF_SKILLS; index++) {
    const name = SKILLS[index];
    const stats = byName.get(name.toLowerCase());
    const exportedXp = Number(stats?.xp);
    const hitpoints = name === HITPOINTS;
    if (Number.isFinite(exportedXp) && exportedXp > 0) {
      xp[index] = Math.round(Math.min(OSRS_XP_CAP, exportedXp));
      maxLevel[index] = Math.max(hitpoints ? 10 : 1, Math.min(MAX_SKILL_LEVEL, virtualLevelForXp(xp[index])));
    } else if (hitpoints) {
      xp[index] = 1_154; // XP for level 10, as a new Skills() starts
      maxLevel[index] = 10;
    }
    level[index] = maxLevel[index]; // log in with full stats; in-play buffs are recalculated per tick
  }
  return { xp, level, maxLevel };
}

/**
 * Items as the save stores them ({ id, amount }), in container slot order.
 * Unpublished id/quantity pairs become empty slots (-1, 0); nothing is guessed.
 */
function itemsFor(entries, maxSlots) {
  const items = new Array(maxSlots).fill(null).map(() => ({ id: -1, amount: 0 }));
  let imported = 0;
  let skipped = 0;
  const oversized = [];
  for (const entry of entries ?? []) {
    const slot = Number(entry?.slot);
    const id = Number(entry?.id);
    const amount = Number(entry?.quantity);
    if (!Number.isInteger(slot) || slot < 0 || slot >= maxSlots) {
      skipped++;
      continue;
    }
    if (!Number.isInteger(id) || !(id > 0) || !validAmount(amount)) {
      skipped++;
      if (Number.isInteger(amount) && amount > MAX_STACK_AMOUNT) oversized.push({ slot, id, amount });
      continue;
    }
    items[slot] = { id, amount, meta: null };
    imported++;
  }
  return { items, imported, skipped, oversized };
}

/**
 * The bank in the export's slot order. `slots` is every slot the export lists,
 * placeholders and other empty entries included: the tab sizes count them, so
 * tab boundaries are measured in slots. `items` is just the real items, each
 * tagged with its slot for the split. When any entry lacks a slot number the
 * list order stands in for every entry's slot, so none can collide.
 */
function bankFor(entries) {
  const list = entries ?? [];
  const slotted = list.every((entry) => Number.isInteger(entry?.slot) && entry.slot >= 0);
  const slots = list
    .map((entry, index) => ({ entry, slot: slotted ? entry.slot : index }))
    .sort((a, b) => a.slot - b.slot);
  const items = slots
    .filter(({ entry }) => Number.isInteger(entry?.id) && entry.id > 0 && validAmount(entry?.quantity))
    .map(({ entry, slot }) => ({ slot, item: { id: entry.id, amount: entry.quantity, meta: null } }));
  // Over the stack limit: skipped (its slot still counts toward the tab split).
  const oversized = slots
    .filter(({ entry }) => Number.isInteger(entry?.id) && entry.id > 0 && Number.isInteger(entry?.quantity) && entry.quantity > MAX_STACK_AMOUNT)
    .map(({ entry, slot }) => ({ slot, id: entry.id, amount: entry.quantity }));
  const slotCount = slots.length > 0 ? slots[slots.length - 1].slot + 1 : 0;
  return { items, slotCount, imported: items.length, skipped: oversized.length, oversized };
}

/**
 * Splits the bank into tabs using the export's per-tab sizes. The sizes read
 * the game's BANK_TAB_1..9 varbits at snapshot time, and the OSRS bank stores
 * tab 1's slots first, ..., the main tab's slots last: this server's own
 * Bank.layout() (the bank container sent to the client) walks [1, 2, ..., 9, 0]
 * in exactly that order. So slots [0..size of tab 1) are tab 1, the next block
 * is tab 2, and every slot after the last sub-tab's block is the main tab (tab 0).
 * Sizes count placeholders, so the split is by slot number. Placeholders are
 * then dropped: the server's banks can hold them, but the export's placeholder
 * entries would need mapping to this cache's placeholder ids, so the imported
 * bank has none (a tab of placeholders alone disappears).
 *
 * Used tabs must come first (1..N, then empty ones), as the server treats tabs
 * as consecutive (Bank.getTabCount stops at the first empty one) and OSRS
 * itself collapses a gap. A tab grows as items are added and a save loads
 * whole (PlayerSave applies banks with Bank.withoutLimit), so no tab is split.
 * Anything unusable falls back to the single main-tab import with a report.
 */
function bankTabsFor(exportData, bank, log) {
  const sizes = (exportData.bankTabSizes ?? []).map(Number);
  const sizesSum = sizes.reduce((sum, size) => sum + size, 0);
  const report = { sizes, sizesSum, slotCount: bank.slotCount, used: false, reason: null, tabs: [] };
  const allItems = bank.items.map(({ item }) => item);
  const usable =
    sizes.length >= 1 &&
    sizes.every((size) => Number.isInteger(size) && size >= 0) &&
    sizesSum > 0 &&
    sizesSum <= bank.slotCount;
  const firstEmpty = sizes.findIndex((size) => size === 0);
  const cleanPrefix = firstEmpty === -1 || firstEmpty === sizes.filter((size) => size > 0).length;
  if (!usable) {
    report.reason = `tab sizes unusable (missing, or ${sizesSum} slots of tabs in a bank of ${bank.slotCount})`;
    return { tabs: [{ tab: 0, items: allItems }], report };
  }
  if (!cleanPrefix) {
    report.reason = "tab sizes have an empty tab before a used one (the server models consecutive tabs)";
    return { tabs: [{ tab: 0, items: allItems }], report };
  }
  const tabs = [];
  let start = 0;
  for (const size of sizes) {
    if (size <= 0) continue;
    const end = start + size;
    const items = bank.items.filter(({ slot }) => slot >= start && slot < end).map(({ item }) => item);
    // A tab of placeholders alone holds nothing here; the later tabs move up so
    // they stay consecutive.
    if (items.length > 0) tabs.push({ tab: tabs.length + 1, items });
    start = end;
  }
  tabs.push({ tab: 0, items: bank.items.filter(({ slot }) => slot >= start).map(({ item }) => item) });
  report.used = true;
  report.tabs = tabs.map(({ tab, items }) => ({ tab, count: items.length }));
  if (log) log(`Bank tabs from the export: sub-tab slots [${sizes.filter((s) => s > 0).join(", ")}], main ${bank.slotCount - start} slot(s).`);
  return { tabs, report };
}

/**
 * A compact summary of an import, stored whole under the
 * "osrs-account-import:data" attribute. It lasts in the live save only until
 * the player's first save after login (the attribute isn't persisted); the
 * save history's "account-exporter-import" copy keeps it.
 */
function provenanceRecord(exportData, result, nowIso) {
  return JSON.stringify(
    {
      importedAt: nowIso,
      rsn: exportData.rsn,
      accountType: exportData.accountTypeName,
      exportSchemaVersion: exportData.schemaVersion,
      exportTimestamp: exportData.timestampIso,
      exportFile: result.inputPath,
      source: "RuneLite Account Data Exporter snapshot",
      note:
        "levels applied are capped at 99 (the server has no virtual levels); " +
        "the bank is split into tabs by the export's per-tab sizes (tab 1 first, main tab last, " +
        "as OSRS stores them); counts.bankTabsReport holds the layout actually applied; " +
        "quests imported stage-complete only (per-quest post-completion sub-state is not written); " +
        "Recipe for Disaster rows untouched; completed diary tiers are marked claimed; claimed combat achievement " +
        "tiers and kill counts are not inferred",
      skills: exportData.skills,
      bankTabSizes: exportData.bankTabSizes,
      counts: result.counts,
      quests: result.quests ?? null,
      diaries: result.diaries ?? null,
      combatAchievements: result.combatAchievements ?? null,
    },
    null,
    0
  );
}

function serverRunning(databasePath) {
  try {
    const pid = Number(fs.readFileSync(`${databasePath}.pid`, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return pid;
  } catch {
    return false;
  }
}

/** As SqlitePlayerPersistence.normalizeUsername, for a name given on the command line. */
function normalizeUsername(username) {
  const safe = String(username ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe.length > 0 ? safe : "player";
}

function formatXp(xp) {
  return Math.round(xp).toLocaleString("en-US");
}

/**
 * Reads the player's current save for display. No rows without a save; imports
 * never create accounts, the login does.
 */
function readPlayer(database, rsn) {
  const username = normalizeUsername(rsn);
  const row = database
    .prepare("SELECT save_json AS json FROM player_saves WHERE username = ?")
    .get(username);
  if (!row) {
    throw new Error(
      `No save for "${rsn}" in this database yet. Start the server, log in with exactly that name, stop it, then import.`
    );
  }
  return { username, json: row.json };
}

function describeSkillChange(before, after) {
  const oldXp = before?.experience ?? [];
  const oldLevel = before?.maxLevel ?? [];
  const at = (array, index) => {
    const value = Number(array?.[index]);
    return Number.isFinite(value) ? value : null;
  };
  const lines = [];
  for (let index = 0; index < NUMBER_OF_SKILLS; index++) {
    const name = SKILLS[index];
    const from = at(oldXp, index);
    const fromLevel = at(oldLevel, index);
    const changed = from === null || from !== after.xp[index] || fromLevel !== after.maxLevel[index];
    const fromText = from === null ? "fresh" : `${formatXp(from)} (${fromLevel})`;
    const toText = `${formatXp(after.xp[index])} (${after.maxLevel[index]})`;
    lines.push(`  ${name.padEnd(13)} ${fromText.padStart(30)} -> ${toText}${changed ? "" : " (unchanged)"}`);
  }
  return lines;
}

/** The one-line-per-slot difference for a small container (inventory/equipment). */
function describeContainerChange(before, after, label) {
  const lines = [];
  for (let index = 0; index < after.length; index++) {
    const oldItem = before?.[index];
    const oldId = Number(oldItem?.id ?? -1);
    const newId = after[index].id;
    if (oldId === newId && Number(oldItem?.amount ?? 0) === after[index].amount) continue;
    lines.push(
      `  ${label ?? "slot"} ${index}: ` +
        `${oldId > 0 ? `id ${oldId} x${oldItem.amount}` : "empty"} -> ` +
        `${newId > 0 ? `id ${newId} x${after[index].amount}` : "empty"}`
    );
  }
  return lines;
}

export async function run(argv, { log = console.log, now = new Date() } = {}) {
  const args = parseArgs(argv);

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) throw new Error(`No export file at ${inputPath}`);
  const exportData = readExport(inputPath);
  if (exportData.rsn.toLowerCase() !== args.rsn.toLowerCase()) {
    throw new Error(
      `Snapshot is for "${exportData.rsn}", but "${args.rsn}" was requested. ` +
        `Import "${args.rsn}" from ${args.rsn}.json (export it with the Account Data Exporter plugin).`
    );
  }

  const databasePath = path.resolve(
    args.database ??
      process.env.PLAYER_SAVE_DATABASE_PATH ??
      path.join(process.cwd(), "data", "saves", "players.sqlite")
  );
  if (!fs.existsSync(databasePath)) throw new Error(`No save database at ${databasePath}`);
  const serverDir = path.resolve(process.cwd(), ".");
  const pid = serverRunning(databasePath);
  if (pid) throw new Error(`The server (pid ${pid}) has ${databasePath} open. Stop it first.`);

  const skills = skillArraysFor(exportData.skills);
  const bank = bankFor(exportData.bank);
  if (bank.imported > BANK_MAX_SLOTS) {
    throw new Error(`The export's bank holds ${bank.imported} items; a bank here holds at most ${BANK_MAX_SLOTS}.`);
  }
  const bankTabs = bankTabsFor(exportData, bank, log);
  const inventory = itemsFor(exportData.inventory, MAX_INVENTORY_SLOTS);
  const equipment = itemsFor(exportData.equipment, MAX_EQUIPMENT_SLOTS);
  const counts = {
    bankItems: bank.imported,
    bankTabs: bankTabs.report.used
      ? bankTabs.report.tabs.filter((entry) => entry.tab !== 0).length
      : 0,
    bankTabsReport: bankTabs.report,
    inventoryItems: inventory.imported,
    equipmentItems: equipment.imported,
    containerEntriesSkipped: inventory.skipped + equipment.skipped,
    bankEntriesOverStackLimit: bank.skipped,
    bankEntriesWithUnknownName: exportData.unknownBank.length,
    itemsOnly: args.itemsOnly,
    progress: args.progress,
  };

  const database = new DatabaseSync(databasePath);
  try {
    const player = readPlayer(database, args.rsn);
    const save = JSON.parse(player.json);
    const attributes = save.attributes ?? {};
    const currentSkills = save.skills ?? {};

    const questResult = args.progress
      ? questImport(exportData, loadQuestDefs(serverDir, log), attributes, log)
      : null;
    const diariesResult = args.progress ? diariesImport(exportData, attributes, serverDir, log) : null;
    const caResult = args.progress ? combatAchievementsImport(exportData, attributes, log) : null;

    const record = provenanceRecord(
      exportData,
      {
        counts,
        inputPath,
        bankTabs: bankTabs.report,
        quests: questResult
          ? {
              importedQuests: [...questResult.importStage.values()].map(({ name }) => name),
              questPoints: questResult.pointsAttribute.value,
              inProgressUntouched: questResult.reported.inProgress,
              unbuiltQuests: questResult.reported.unbuilt,
              skippedRfdRows: questResult.reported.skippedRfd,
            }
          : null,
        diaries: diariesResult
          ? {
              importedTiers: diariesResult.importedTiers,
              importedTasks: diariesResult.importedTasks,
              rewards: diariesResult.rewardsAttribute.value,
              unknownRegions: diariesResult.unknownRegions,
            }
          : null,
        combatAchievements: caResult
          ? {
              importedTasks: caResult.imported,
              completedNames: caResult.completedNames,
            }
          : null,
      },
      now.toISOString()
    );

    log("");
    log(`Character: ${exportData.rsn} (${exportData.accountTypeName}, exported ${exportData.timestampIso})`);
    log(
      `  Official totals from the export: level ${exportData.totalLevel}, ` +
        `XP ${formatXp(exportData.totalXp)}, combat ${exportData.combatLevel}`
    );
    log("");
    if (!args.itemsOnly) {
      log("Skill XP now in the save -> imported:");
      for (const line of describeSkillChange(currentSkills, skills)) log(line);
    } else {
      log("Skills: left untouched (--items-only).");
    }
    log("");
    log(`Bank: ${counts.bankItems} item(s) in slot order${bankTabs.report.used ? ", split into tabs" : ", all into tab 0 (collapsed)"}.`);
    for (const entry of exportData.unknownBank.slice(0, 10)) {
      log(`  (bank entry the export could not name: slot ${entry.slot} id ${entry.id})`);
    }
    if (exportData.unknownBank.length > 10) log(`  ... and ${exportData.unknownBank.length - 10} more.`);
    for (const entry of [
      ...bank.oversized.map((e) => ({ ...e, where: "bank" })),
      ...inventory.oversized.map((e) => ({ ...e, where: "inventory" })),
      ...equipment.oversized.map((e) => ({ ...e, where: "equipment" })),
    ]) {
      log(`  (skipped, over the ${MAX_STACK_AMOUNT} stack limit: ${entry.where} slot ${entry.slot} id ${entry.id} x${entry.amount})`);
    }
    if (bankTabs.report.used) {
      log(
        `Bank tabs rebuilt: ` +
          bankTabs.report.tabs.map((entry) => (entry.tab === 0 ? `main ${entry.count}` : `tab ${entry.tab}: ${entry.count}`)).join(", ")
      );
    } else {
      log(`  (tab layout collapsed into tab 0: ${bankTabs.report.reason})`);
    }
    log("");
    log(`Inventory: ${counts.inventoryItems} item(s) of ${MAX_INVENTORY_SLOTS} slots.`);
    for (const line of describeContainerChange(save.inventory, inventory.items, "inventory")) log(line);
    log(`Equipment: ${counts.equipmentItems} item(s) of ${MAX_EQUIPMENT_SLOTS} slots.`);
    for (const line of describeContainerChange(save.equipment, equipment.items, "equipment")) log(line);
    log("");

    if (args.progress && questResult) {
      const names = [...questResult.importStage.values()];
      log(
        `Quests: ${names.length} finished quest(s) map onto server plugins ` +
          `(${questResult.pointsAttribute.value} quest points total after import); ` +
          `${questResult.reported.notStarted} not started.`
      );
      for (const entry of questResult.reported.unbuilt) {
        log(`  (finished on OSRS but not built on this server, left out: ${entry})`);
      }
      if (questResult.reported.skippedRfd.length > 0) {
        log(`  (Recipe for Disaster rows ${questResult.reported.skippedRfd.length} - skipped entirely, flagged in provenance)`);
      }
      if (questResult.reported.inProgress.length > 0) {
        log(`  (in progress on OSRS, left untouched: ${questResult.reported.inProgress.join(", ")})`);
      }
      log(`  post-completion sub-state (unlocked shops, teleports) is not written: see provenance.`);
      log("");
    }
    if (args.progress && diariesResult) {
      log(
        `Achievement diaries: ${diariesResult.importedTiers} tier(s) claimed, ` +
          `${diariesResult.importedTasks} task(s) marked complete ` +
          `(rewards: ${Object.entries(diariesResult.rewardsAttribute.value).map(([k, v]) => `${k}=[${v.join(", ")}]`).join("; ") || "none"}).`
      );
      for (const region of diariesResult.unknownRegions) log(`  (unknown region in export: ${region})`);
      log("");
    }
    if (args.progress && caResult) {
      log(`Combat achievements: ${caResult.imported} task(s) newly marked complete (claimed tiers left unclaimed).`);
      for (const line of caResult.completedNames.slice(0, 12)) log(`  - ${line}`);
      if (caResult.completedNames.length > 12) log(`  ... and ${caResult.completedNames.length - 12} more (verbatim in provenance).`);
      log("");
    }

    if (!args.apply) {
      log("Dry run: nothing changed. Add --apply to import.");
      return { applied: false };
    }

    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const backup = path.join(
      path.dirname(databasePath),
      `players-before-account-import-${stamp}.sqlite`
    );
    database.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    log(`Copied the database to ${backup}.`);

    if (!args.itemsOnly) save.skills = { level: skills.level, maxLevel: skills.maxLevel, experience: skills.xp };
    save.inventory = inventory.items;
    save.equipment = equipment.items;
    save.banks = {
      __type: "Map",
      entries: bankTabs.tabs.map(({ tab, items }) => [tab, items]),
    };
    save.attributes = { ...attributes, [IMPORT_ATTRIBUTE]: record };
    if (questResult) {
      for (const { attribute, value } of questResult.importStage.values()) save.attributes[attribute] = value;
      save.attributes[QUEST_POINTS_ATTRIBUTE] = questResult.pointsAttribute.value;
    }
    if (diariesResult) {
      save.attributes[DIARIES_TASKS_ATTRIBUTE] = diariesResult.tasksAttribute.value;
      save.attributes[DIARIES_REWARDS_ATTRIBUTE] = diariesResult.rewardsAttribute.value;
    }
    if (caResult) save.attributes[CA_COMPLETED_ATTRIBUTE] = caResult.completedAttribute.value;

    const serialized = JSON.stringify(save);
    const savedAt = now.toISOString();
    const history = new SqliteSaveHistory(database);
    database.exec("BEGIN");
    try {
      history.record(player.username, player.json, PRE_IMPORT_REASON, savedAt);
      database
        .prepare("UPDATE player_saves SET save_json = ?, updated_at = ? WHERE username = ?")
        .run(serialized, savedAt, player.username);
      history.record(player.username, serialized, IMPORT_REASON, savedAt);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    log(`Imported ${exportData.rsn} into ${player.username}'s save.`);
    log(`Log in as ${exportData.rsn} and check the skills tab, bank, quest list, diaries and combat achievements;`);
    log(`::snapshots lists the pre-import copy. The import record (${IMPORT_ATTRIBUTE}) is dropped from`);
    log(`the live save at the first login; the "${IMPORT_REASON}" history copy keeps it.`);
    return { applied: true, backup };
  } finally {
    database.close();
  }
}

// Entry point: the wrapper only runs `run` when executed as the script itself, so the
// exported `run` stays testable. Windows paths differ in case between argv and the
// resolved file URL.
const executablePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === executablePath.toLowerCase()) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
