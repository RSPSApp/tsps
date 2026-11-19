"use strict";

// The editor deliberately supports a small, validated subset of the brain's actions.
const fs = require("node:fs");
const path = require("node:path");
const FILE = path.join(process.cwd(), "data", "definitions", "bot-activities.local.json");

const SKILL_NAMES = new Set(['attack','defence','strength','hitpoints','ranged','prayer','magic','cooking','woodcutting','fletching','fishing','firemaking','crafting','smithing','mining','herblore','agility','thieving','slayer','farming','runecrafting','hunter','construction','sailing']);
const isGraph = activity => activity?.graph !== undefined || activity?.subroutines !== undefined;

function validateActivities(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Expected at most 100 activities.");
  const ids = new Set();
  return value.map((activity) => {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) throw new Error("Invalid activity.");
    if (isGraph(activity)) throw new Error("Graph routines are no longer supported.");
    const { id, repeat, actions } = activity;
    if (typeof id !== "string" || !/^custom_[a-z0-9_]{1,48}$/.test(id) || ids.has(id)) throw new Error("IDs must be unique and start with custom_, followed by lowercase letters, numbers or underscores.");
    ids.add(id);
    if (typeof repeat !== "boolean") throw new Error(`${id}: choose repeat.`);
    if (!Array.isArray(actions) || !actions.length || actions.length > 50) throw new Error(`${id}: choose repeat and 1–50 actions.`);
    const clean = actions.map((action, index) => {
      const fail = () => { throw new Error(`${id}, action ${index + 1}: invalid parameters.`); };
      if (!action || typeof action !== "object") return fail();
      if (action.type === "if") {
        const item = action.condition?.hasItem?.id;
        const min = action.condition?.hasItem?.min;
        const validBranch = branch => branch === null || (branch && ["dropItems", "bank", "sellItems"].includes(branch.type) && Array.isArray(branch.itemIds) && branch.itemIds.length > 0 && branch.itemIds.length <= 28 && branch.itemIds.every(Number.isInteger) && branch.itemIds.every(id => id > 0));
        if (!Number.isInteger(item) || item < 0 || !Number.isInteger(min) || min < 1 || min > 2147483647 || !validBranch(action.then) || !validBranch(action.else)) return fail();
        const copy = branch => branch && ({ type: branch.type, itemIds: branch.itemIds });
        return { type: "if", condition: { hasItem: { id: item, min } }, then: copy(action.then), else: copy(action.else) };
      }
      if (action.type === "walkTo") {
        const { x, y, z, radius } = action;
        if (![x, y, z, radius].every(Number.isInteger) || x < 0 || x > 16383 || y < 0 || y > 16383 || z < 0 || z > 3 || radius < 0 || radius > 32) return fail();
        return { type: "walkTo", x, y, z, radius };
      }
      if (["cook", "lightFire"].includes(action.type)) return { type: action.type };
      if (action.type === "wander") {
        const allowed = new Set(["type", "walkRadius", "endpointLingerMs"]);
        if (Object.keys(action).some(key => !allowed.has(key))) return fail();
        if (action.walkRadius !== undefined && (!Number.isInteger(action.walkRadius) || action.walkRadius < 1 || action.walkRadius > 64)) return fail();
        if (action.endpointLingerMs !== undefined && (!Number.isInteger(action.endpointLingerMs) || action.endpointLingerMs < 0 || action.endpointLingerMs > 60000)) return fail();
        return { type: "wander", ...(action.walkRadius !== undefined ? { walkRadius: action.walkRadius } : {}), ...(action.endpointLingerMs !== undefined ? { endpointLingerMs: action.endpointLingerMs } : {}) };
      }
      if (action.type === "wait" && Number.isInteger(action.seconds) && action.seconds >= 1 && action.seconds <= 3600) return { type: "wait", seconds: action.seconds };
      if (action.type === "trainCombat") {
        const allowed = new Set(["type", "preset", "styles", "durationSeconds", "food", "foodAmount", "maxFailedTargets", "spreadDistance"]);
        if (action.preset !== "default" || Object.keys(action).some(key => !allowed.has(key))) return fail();
        const clean = { type: "trainCombat", preset: "default" };
        if (action.styles !== undefined) {
          if (!Array.isArray(action.styles) || action.styles.length < 1 || action.styles.length > 3 ||
              action.styles.some(style => !["melee", "ranged", "magic"].includes(style)) || new Set(action.styles).size !== action.styles.length) return fail();
          clean.styles = [...action.styles];
        }
        if (action.durationSeconds !== undefined) {
          const duration = action.durationSeconds;
          if (!duration || typeof duration !== "object" || Array.isArray(duration) ||
              Object.keys(duration).some(key => !["min", "max"].includes(key)) ||
              !Number.isInteger(duration.min) || !Number.isInteger(duration.max) ||
              duration.min < 30 || duration.max > 7200 || duration.min > duration.max) return fail();
          clean.durationSeconds = { min: duration.min, max: duration.max };
        }
        if (action.food !== undefined) {
          const foods = ["TROUT", "SALMON", "TUNA", "SWORDFISH", "LOBSTER", "SHARK", "MONKFISH", "MANTA_RAY", "SEA_TURTLE", "DARK_CRAB", "ANGLERFISH", "COOKED_KARAMBWAN"];
          if (!foods.includes(action.food)) return fail();
          clean.food = action.food;
        }
        for (const [key, min, max] of [["foodAmount", 1, 28], ["maxFailedTargets", 1, 50], ["spreadDistance", 1, 5000]]) {
          if (action[key] !== undefined) {
            if (!Number.isInteger(action[key]) || action[key] < min || action[key] > max) return fail();
            clean[key] = action[key];
          }
        }
        return clean;
      }
      if (action.type === "fish" && ["NET", "FISHING_ROD", "PIKE_ROD", "FLY_FISHING_ROD", "HARPOON", "SHARK_HARPOON", "BAREHAND_SHARK", "BAREHAND_HARPOON", "LOBSTER_POT", "BIG_NET", "MONKFISH_NET", "FROG_SPAWN_NET", "CAVE_EEL_ROD", "SWAMP_EEL_ROD", "LAVA_EEL_ROD", "INFERNAL_EEL_ROD", "SACRED_EEL_ROD", "ANGLERFISH_ROD", "DARK_CRAB_POT", "MINNOW_NET", "BARBARIAN_ROD", "KARAMBWANJI_NET", "PARK_NET", "KARAMBWAN_VESSEL"].includes(action.tool) && (action.bait === null || action.bait === undefined || Number.isInteger(action.bait) && action.bait > 0) && (action.baitAmount === undefined || Number.isInteger(action.bait) && action.bait > 0 && Number.isInteger(action.baitAmount) && action.baitAmount >= 1 && action.baitAmount <= 3000)) return { type: "fish", tool: action.tool, ...(Number.isInteger(action.bait) ? { bait: action.bait } : {}), ...(action.baitAmount !== undefined ? { baitAmount: action.baitAmount } : {}) };
      if (action.type === "smelt" && ["bronze bar", "iron bar", "silver bar", "steel bar", "gold bar", "mithril bar", "adamantite bar", "runite bar"].includes(action.bar)) return { type: action.type, bar: action.bar };
      if (action.type === "ensureItem" && action.item === "tinderbox") return { type: action.type, item: "tinderbox" };
      if (action.type === "equipTool" && ["axe", "pickaxe"].includes(action.tool)) return { type: action.type, tool: action.tool };
      if (action.type === "interactObject" && !action.catalog && Array.isArray(action.objectIds) && action.objectIds.length > 0 && action.objectIds.length <= 28 && action.objectIds.every(id => Number.isInteger(id) && id > 0) && typeof action.option === "string" && action.option.trim().length > 0 && action.option.trim().length <= 50) return { type: action.type, objectIds: action.objectIds, option: action.option.trim(), until: { inventoryFull: true }, stallSeconds: 120 };
      if (action.type === "interactObject" && ["tree", "rock"].includes(action.catalog)) {
        const tiers = action.catalog === "tree" ? ["normal", "oak", "willow", "maple", "yew"] : ["copper", "tin", "iron", "coal", "mithril", "adamantite", "runite"];
        if (!tiers.includes(action.tier)) return fail();
        if (action.objectIds !== undefined && (!Array.isArray(action.objectIds) || action.objectIds.length !== 1 || !Number.isInteger(action.objectIds[0]) || action.objectIds[0] <= 0)) return fail();
        return { type: action.type, catalog: action.catalog, tier: action.tier, ...(action.objectIds ? { objectIds: action.objectIds } : {}), option: action.catalog === "tree" ? "Chop down" : "Mine", until: { inventoryFull: true }, stallSeconds: 120 };
      }
      if (["dropItems", "bank", "sellItems"].includes(action.type) && Array.isArray(action.itemIds) && action.itemIds.length && action.itemIds.length <= 28 && action.itemIds.every(id => Number.isInteger(id) && id > 0)) return { type: action.type, itemIds: action.itemIds };
      return fail();
    });
    return { id, mode: id, manual: true, repeat, actions: clean };
  });
}

function readActivities(file = FILE, log) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(saved) || saved.length > 100) throw new Error("Expected at most 100 activities.");
    const ids = saved.filter(isGraph).map(activity => activity.id);
    if (ids.length) log?.("bot_graph_routines_skipped", { ids });
    return validateActivities(saved.filter(activity => !isGraph(activity)));
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

module.exports = { FILE, validateActivities, readActivities };
