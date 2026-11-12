"use strict";

// The editor deliberately supports a small, validated subset of the brain's actions.
const fs = require("node:fs");
const path = require("node:path");
const FILE = path.join(process.cwd(), "data", "definitions", "bot-activities.local.json");

const SKILL_NAMES = new Set(['attack','defence','strength','hitpoints','ranged','prayer','magic','cooking','woodcutting','fletching','fishing','firemaking','crafting','smithing','mining','herblore','agility','thieving','slayer','farming','runecrafting','hunter','construction','sailing']);
function cleanCondition(condition, depth = 0) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition) || depth > 3 || Object.keys(condition).length !== 1) throw new Error("Choose one supported condition.");
  if (condition.and || condition.or) {
    const key = condition.and ? "and" : "or", rules = condition[key];
    if (!Array.isArray(rules) || rules.length < 1 || rules.length > 8) throw new Error(`${key.toUpperCase()} needs 1–8 conditions.`);
    return { [key]: rules.map(rule => cleanCondition(rule, depth + 1)) };
  }
  if (condition.not) return { not: cleanCondition(condition.not, depth + 1) };
  if (condition.hasItem) {
    const { id, present, min } = condition.hasItem;
    const legacyMinimum = present === undefined && Number.isInteger(min) && min >= 1 && min <= 2147483647;
    if (!Number.isInteger(id) || id <= 0 || (present !== undefined && typeof present !== "boolean") ||
        (min !== undefined && (!legacyMinimum || present !== undefined))) {
      throw new Error("Item condition needs a valid item and a true/false presence choice.");
    }
    // Normalize older quantity-based item tests to a presence test for the simpler editor UI.
    return { hasItem: { id, present: present ?? true } };
  }
  if (condition.skill) {
    const { id, min = 1, max = 99 } = condition.skill;
    if (!SKILL_NAMES.has(id) || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 99 || min > max) throw new Error("Skill condition needs a skill and valid level range (1–99).");
    return { skill: { id, min, max } };
  }
  if (condition.inventoryFull === true) return { inventoryFull: true };
  if (condition.inCombat === true) return { inCombat: true };
  if (condition.healthPercentBelow !== undefined) {
    const percent = condition.healthPercentBelow;
    if (!Number.isInteger(percent) || percent < 1 || percent > 99) throw new Error("Health threshold must be a percentage from 1–99.");
    return { healthPercentBelow: percent };
  }
  if (condition.inArea) {
    const { minX, maxX, minY, maxY, z } = condition.inArea;
    if (![minX,maxX,minY,maxY,z].every(Number.isInteger) || minX<0 || maxX>16383 || minY<0 || maxY>16383 || minX>maxX || minY>maxY || z<0 || z>3) throw new Error("Area condition needs valid coordinate bounds and plane.");
    return { inArea: { minX,maxX,minY,maxY,z } };
  }
  throw new Error("Choose a supported condition: item, skill, inventory full, combat, health, area, AND, OR, or NOT.");
}

function validateActivities(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Expected at most 100 activities.");
  const ids = new Set();
  return value.map((activity) => {
    if (!activity || typeof activity !== "object" || Array.isArray(activity)) throw new Error("Invalid activity.");
    const { id, repeat, actions } = activity;
    if (typeof id !== "string" || !/^custom_[a-z0-9_]{1,48}$/.test(id) || ids.has(id)) throw new Error("IDs must be unique and start with custom_, followed by lowercase letters, numbers or underscores.");
    ids.add(id);
    if (typeof repeat !== "boolean") throw new Error(`${id}: choose repeat.`);
    if (activity.graph !== undefined) {
      const { validateGraph } = require("./Graph.PlayerBots");
      validateGraph(activity.graph);
      const graph = {
        nodes: activity.graph.nodes.map(node => {
          if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 20000 || Math.abs(node.y) > 20000) throw new Error(`${id}: invalid node position.`);
          const base = { id: node.id, kind: node.kind, x: node.x, y: node.y };
          if (node.kind === "start") {
            const setup = node.setup ?? { location: null, skills: {}, inventory: [], equipment: [] };
            const loc = setup.location;
            if (loc !== null && (!loc || ![loc.x, loc.y, loc.z].every(Number.isInteger) || loc.x < 0 || loc.x > 16383 || loc.y < 0 || loc.y > 16383 || loc.z < 0 || loc.z > 3)) throw new Error(`${id}: invalid spawn location.`);
            const skills = setup.skills;
            const names = ['attack','defence','strength','hitpoints','ranged','prayer','magic','cooking','woodcutting','fletching','fishing','firemaking','crafting','smithing','mining','herblore','agility','thieving','slayer','farming','runecrafting','hunter','construction','sailing'];
            if (!skills || typeof skills !== 'object' || Array.isArray(skills) || Object.entries(skills).some(([name,level]) => !names.includes(name) || !Number.isInteger(level) || level < 1 || level > 99)) throw new Error(`${id}: invalid skill levels.`);
            const checkItems = (items, slots) => Array.isArray(items) && items.length <= slots.length && items.every(item => item && slots.includes(item.slot) && Number.isInteger(item.id) && item.id > 0 && Number.isInteger(item.amount) && item.amount > 0 && item.amount <= 2147483647) && new Set(items.map(item => item.slot)).size === items.length;
            if (!checkItems(setup.inventory, Array.from({length:28},(_,i)=>i)) || !checkItems(setup.equipment, [0,1,2,3,4,5,7,9,10,12,13])) throw new Error(`${id}: invalid starting items or duplicate slots.`);
            base.setup = { location: loc, skills: { ...skills }, inventory: setup.inventory.map(v=>({slot:v.slot,id:v.id,amount:v.amount})), equipment: setup.equipment.map(v=>({slot:v.slot,id:v.id,amount:v.amount})) };
          }
          if (node.kind === "action") {
            const inner = validateActivities([{ id: "custom_node", repeat: false, actions: [node.action] }])[0].actions[0];
            if (inner.type === "if") throw new Error("Use an If node for branching.");
            base.action = inner;
          }
          if (node.kind === "if" || node.kind === "interrupt") base.condition = cleanCondition(node.condition);
          if (node.kind === "interrupt") {
            const priority = node.priority ?? 0;
            if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new Error(`${id}: event trigger priority must be 0–100.`);
            base.priority = priority;
          }
          if (node.kind === "switch") {
            base.cases = node.cases.map(cleanCondition);
          }
          if (node.kind === "agent") {
            const prompt = typeof node.prompt === "string" ? node.prompt.trim() : "";
            if (!prompt || prompt.length > 500 || !Array.isArray(node.choices) || node.choices.length < 2 || node.choices.length > 8) throw new Error(`${id}: AI agent needs a prompt and 2–8 routes.`);
            const labels = new Set();
            base.prompt = prompt;
            base.choices = node.choices.map(choice => {
              const label = typeof choice?.label === "string" ? choice.label.trim() : "";
              const description = typeof choice?.description === "string" ? choice.description.trim() : "";
              if (!label || label.length > 40 || labels.has(label.toLowerCase()) || description.length > 200) throw new Error(`${id}: AI agent routes need unique labels (1–40 characters) and descriptions up to 200 characters.`);
              labels.add(label.toLowerCase());
              return { label, description };
            });
          }
          return base;
        }),
        edges: activity.graph.edges.map(edge => ({ from: edge.from, port: edge.port, to: edge.to })),
      };
      return { id, mode: id, manual: true, repeat, graph, actions: [] };
    }
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

function readActivities(file = FILE) {
  try { return validateActivities(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

module.exports = { FILE, validateActivities, readActivities };
