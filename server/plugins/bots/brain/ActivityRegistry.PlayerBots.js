"use strict";

const fs = require("fs");
const path = require("path");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { ItemIds } = require("../../../src/main/typescript/elvarg/util/IdEnums");
const { createInteractObjectAction } = require("./actions/InteractObject.PlayerBots");
const { createDropItemsAction } = require("./actions/DropItems.PlayerBots");
const { createChooseAction } = require("./actions/Choose.PlayerBots");
const { createIfAction } = require("./actions/If.PlayerBots");
const { createGraphAction } = require("./Graph.PlayerBots");
const { createAiAgentAction } = require("./actions/AiAgent.PlayerBots");
const { createSellItemsAction } = require("./actions/SellItems.PlayerBots");
const { createEquipToolAction } = require("./actions/EquipTool.PlayerBots");
const { createBankAction } = require("./actions/Bank.PlayerBots");
const { readBotSites } = require("./Sites.PlayerBots");
const { createOrElseAction } = require("./actions/OrElse.PlayerBots");
const { createWalkToAction } = require("./actions/WalkTo.PlayerBots");
const { createEnsureItemAction } = require("./actions/EnsureItem.PlayerBots");
const { createLightFireAction } = require("./actions/LightFire.PlayerBots");
const { createSmeltAction } = require("./actions/Smelt.PlayerBots");
const { createTrainCombatAction } = require("./actions/TrainCombat.PlayerBots");
const { createPvpCombatAction } = require("./actions/PvpCombat.PlayerBots");
const { createWanderAction } = require("./actions/Wander.PlayerBots");
const { createFollowOwnerAction } = require("./actions/FollowOwner.PlayerBots");
const { createFishAction } = require("./actions/Fish.PlayerBots");
const { createCookAction } = require("./actions/Cook.PlayerBots");
const { createWaitAction } = require("./actions/Wait.PlayerBots");

const DEFAULT_DEFINITIONS_PATH = path.join(
  process.cwd(),
  "data",
  "definitions",
  "bot-activities.json"
);

const DEFAULT_SITES_PATH = path.join(process.cwd(), "data", "definitions", "bot-sites.json");

// Modes a site never rotates through: PvP and roaming belong to the wilderness pool.
const NON_SITE_MODES = new Set(["pvp", "roaming"]);

const SITE_DEFAULTS = Object.freeze({
  spawnRadius: 6,
});

function applyFields(value, fields) {
  if (typeof value === "string") {
    if (value.startsWith("$") && Object.prototype.hasOwnProperty.call(fields, value.slice(1))) {
      return fields[value.slice(1)];
    }
    return value.replace(/\$([A-Za-z0-9_]+)/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(fields, key) ? String(fields[key]) : match
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => applyFields(entry, fields));
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = applyFields(entry, fields);
    }
    return next;
  }
  return value;
}

function resolveItemId(name) {
  if (Number.isInteger(name)) {
    return name;
  }
  const key = String(name).trim().toUpperCase().replace(/[\s-]+/g, "_");
  return ItemIds[key] ?? null;
}

function resolveSkill(name) {
  const key = String(name).trim().toUpperCase().replace(/[\s-]+/g, "_");
  return Skill[key] ?? null;
}

function createCondition(spec) {
  if (spec.and) {
    const rules = spec.and.map(createCondition);
    return { id: `and:${rules.map(rule => rule.id).join("&")}`, check(ctx) { return rules.every(rule => rule.check(ctx)); } };
  }
  if (spec.or) {
    const rules = spec.or.map(createCondition);
    return { id: `or:${rules.map(rule => rule.id).join("|")}`, check(ctx) { return rules.some(rule => rule.check(ctx)); } };
  }
  if (spec.not) {
    const rule = createCondition(spec.not);
    return { id: `not:${rule.id}`, check(ctx) { return !rule.check(ctx); } };
  }
  if (spec.healthPercentBelow !== undefined) {
    const threshold = Number(spec.healthPercentBelow);
    return { id: `health:below:${threshold}`, check(ctx) {
      const manager = ctx.player?.getSkillManager?.();
      const current = manager?.getCurrentLevel?.(Skill.HITPOINTS) ?? 0;
      const maximum = manager?.getMaxLevel?.(Skill.HITPOINTS) ?? 0;
      return maximum > 0 && current / maximum * 100 < threshold;
    } };
  }
  if (spec.skill) {
    const skill = resolveSkill(spec.skill.id);
    const min = Number(spec.skill.min ?? 1);
    const max = Number(spec.skill.max ?? 99);
    return {
      id: `skill:${spec.skill.id}`,
      check(ctx) {
        const level = ctx.player?.getSkillManager?.().getCurrentLevel?.(skill) ?? 0;
        return level >= min && level <= max;
      },
    };
  }
  if (spec.hasItem) {
    const ids = (Array.isArray(spec.hasItem.id) ? spec.hasItem.id : [spec.hasItem.id])
      .map(resolveItemId)
      .filter((id) => Number.isInteger(id));
    const present = typeof spec.hasItem.present === "boolean" ? spec.hasItem.present : null;
    const min = Number(spec.hasItem.min ?? 1);
    return {
      id: `item:${spec.hasItem.id}`,
      resolverKey: spec.resolver ?? `item:${spec.hasItem.id}`,
      check(ctx) {
        const inventory = ctx.player?.getInventory?.();
        if (!inventory) return false;
        if (present !== null) return ids.some(id => inventory.getAmount(id) > 0) === present;
        return ids.some((id) => inventory.getAmount(id) >= min);
      },
    };
  }
  if (spec.inventoryFull === true) {
    return { id: "inventory:full", check(ctx) { return ctx.player?.getInventory?.()?.isFull?.() === true; } };
  }
  if (spec.inCombat === true) {
    return { id: "combat:active", check(ctx) { return !!ctx.player?.getCombat?.()?.getTarget?.() || !!ctx.player?.getCombat?.()?.getAttacker?.(); } };
  }
  if (spec.inArea) {
    const area = spec.inArea;
    return {
      id: `area:${area.minX},${area.minY}`,
      resolverKey: spec.resolver ?? "area",
      check(ctx) {
        const loc = ctx.player?.getLocation?.();
        if (!loc) {
          return false;
        }
        return (
          loc.getX() >= area.minX &&
          loc.getX() <= area.maxX &&
          loc.getY() >= area.minY &&
          loc.getY() <= area.maxY &&
          loc.getZ() === (area.z ?? loc.getZ())
        );
      },
    };
  }
  throw new Error(`[bot activities] unknown condition ${JSON.stringify(spec)}`);
}

function createAction(spec, world) {
  if (spec.orElse) {
    const { orElse, ...primary } = spec;
    return createOrElseAction(createAction(primary, world), createAction(orElse, world));
  }
  if (spec.type === "if") {
    return createIfAction(createCondition(spec.condition), spec.then ? createAction(spec.then, world) : null, spec.else ? createAction(spec.else, world) : null);
  }
  if (spec.type === "interactObject") {
    return createInteractObjectAction(spec, world);
  }
  if (spec.type === "choose") {
    return createChooseAction(spec, (option) => createAction(option, world));
  }
  if (spec.type === "sellItems") {
    return createSellItemsAction(
      { ...spec, itemIds: (spec.itemIds ?? []).map(resolveItemId).filter((id) => Number.isInteger(id)) },
      world
    );
  }
  if (spec.type === "dropItems") {
    return createDropItemsAction({
      ...spec,
      itemIds: (spec.itemIds ?? []).map(resolveItemId).filter((id) => Number.isInteger(id)),
    });
  }
  if (spec.type === "equipTool") {
    return createEquipToolAction(spec);
  }
  if (spec.type === "bank") {
    return createBankAction(
      {
        ...spec,
        itemIds: (spec.itemIds ?? []).map(resolveItemId).filter((id) => Number.isInteger(id)),
        withdraw: (spec.withdraw ?? [])
          .map((entry) => ({
            item: resolveItemId(entry.item),
            amount: Math.max(1, Math.floor(Number(entry.amount ?? 1))),
          }))
          .filter((entry) => Number.isInteger(entry.item)),
      },
      world
    );
  }
  if (spec.type === "walkTo") {
    return createWalkToAction(spec);
  }
  if (spec.type === "ensureItem") {
    return createEnsureItemAction({
      ...spec,
      item: resolveItemId(spec.item),
    });
  }
  if (spec.type === "lightFire") {
    return createLightFireAction(spec, world);
  }
  if (spec.type === "smelt") {
    return createSmeltAction(spec, world);
  }
  if (spec.type === "trainCombat") {
    if (spec.preset === "default") {
      const raw = JSON.parse(fs.readFileSync(DEFAULT_DEFINITIONS_PATH, "utf8"));
      const gears = JSON.parse(fs.readFileSync(path.join(path.dirname(DEFAULT_DEFINITIONS_PATH), "bot-combat-gear.json"), "utf8"));
      const configured = raw.activities.find(activity => activity.id === "combat_training")?.actions?.find(action => action.type === "trainCombat");
      if (!configured) throw new Error("[bot activities] default combat training preset is unavailable");
      const preset = expandGearRefs({ id: "editor_combat_training", actions: [configured] }, gears).actions[0];
      const { type: _type, preset: _preset, ...overrides } = spec;
      return createTrainCombatAction({ ...preset, ...overrides }, world);
    }
    return createTrainCombatAction(spec, world);
  }
  if (spec.type === "pvpCombat") {
    return createPvpCombatAction(spec, world?.pvpController ?? null);
  }
  if (spec.type === "wander") {
    return createWanderAction(spec, world);
  }
  if (spec.type === "followOwner") {
    return createFollowOwnerAction(spec, world);
  }
  if (spec.type === "fish") {
    return createFishAction({ ...spec, bait: spec.bait ? resolveItemId(spec.bait) : null }, world);
  }
  if (spec.type === "cook") {
    return createCookAction(spec, world);
  }
  if (spec.type === "wait") return createWaitAction(spec);
  throw new Error(`[bot activities] unknown action type '${spec.type}'`);
}

function compileActivity(definition, templates, world, options = {}) {
  const template = definition.template ? templates[definition.template] : null;
  if (definition.template && !template) {
    throw new Error(`[bot activities] unknown template '${definition.template}'`);
  }
  const merged = applyFields(
    template ? { ...template, ...definition } : definition,
    definition.fields ?? {}
  );
  return {
    id: merged.id,
    resolver: options.resolver === true,
    resolves: options.resolver === true ? merged.resolves ?? null : null,
    mode: merged.mode ?? null,
    capacity: Number.isFinite(merged.capacity) ? Math.max(1, Math.floor(merged.capacity)) : 1,
    repeat: merged.repeat === true,
    spawnSetup: merged.graph?.nodes?.find(node => node.kind === "start")?.setup ?? null,
    usesAiAgent: merged.graph?.nodes?.some(node => node.kind === "agent") === true,
    oneShot: !!merged.graph && merged.repeat !== true,
    ephemeral: merged.ephemeral === true,
    manual: merged.manual === true,
    failureCooldownMs: Math.max(
      0,
      Math.floor(Number(merged.failureCooldownSeconds ?? 15)) * 1000
    ),
    requires: (merged.requires ?? []).map(createCondition),
    setup: (merged.setup ?? []).map(createCondition),
    actions: merged.graph ? [createGraphAction(merged.graph, action => createAction(action, world), createCondition, node => createAiAgentAction(node, world))] : (merged.actions ?? []).map((action) => createAction(action, world)),
    produces: merged.produces ?? [],
    site: merged.site ?? null,
  };
}

/**
 * An action may name a gear table (`gearRef`) instead of carrying one inline; the tables
 * live in bot-combat-gear.json next to the activity definitions.
 */
function expandGearRefs(definition, gearTables) {
  if (!Array.isArray(definition?.actions)) {
    return definition;
  }
  const actions = definition.actions.map((action) => {
    const gearRef = action?.gearRef;
    if (!gearRef) {
      return action;
    }
    const gear = gearTables[gearRef];
    if (!gear) {
      throw new Error(`[bot activities] '${definition.id}' references unknown gear '${gearRef}'`);
    }
    const { gearRef: _ref, ...rest } = action;
    return { ...rest, ...gear };
  });
  return { ...definition, actions };
}

/**
 * Loads data-driven activities, their resolver links and sites. Capacity slots
 * cap how many bots may run an activity at once; assignment happens only when a
 * brain goes idle, never per tick.
 */
function createBotActivityRegistry(options = {}) {
  const api = options.api ?? null;
  const world = options.world ?? {};
  const definitionsPath = options.definitionsPath ?? DEFAULT_DEFINITIONS_PATH;
  const raw = JSON.parse(fs.readFileSync(definitionsPath, "utf8"));
  if (!raw || typeof raw !== "object") {
    throw new Error("[bot activities] definitions must be an object");
  }
  const gearPath = options.combatGearPath ?? path.join(path.dirname(definitionsPath), "bot-combat-gear.json");
  const gearTables = JSON.parse(fs.readFileSync(gearPath, "utf8"));
  const templates = raw.templates ?? {};
  const activities = [];
  const resolvers = [];
  const byId = new Map();
  const fieldsById = new Map();
  const { readActivities } = require("./Editor.PlayerBots");
  for (const definition of [...(raw.activities ?? []), ...readActivities(options.editorPath)]) {
    if (!definition?.id || byId.has(definition.id)) {
      throw new Error("[bot activities] activity ids must be unique");
    }
    // `fieldsFrom` copies another activity's fields first (a burn tier reuses its tree's
    // level and log), so only the differences stay in the file.
    let fields = definition.fields;
    if (definition.fieldsFrom) {
      const inherited = fieldsById.get(definition.fieldsFrom);
      if (!inherited) {
        throw new Error(
          `[bot activities] '${definition.id}' fieldsFrom unknown activity '${definition.fieldsFrom}'`
        );
      }
      fields = { ...inherited, ...(definition.fields ?? {}) };
    }
    fieldsById.set(definition.id, fields);
    const activity = compileActivity(expandGearRefs({ ...definition, fields }, gearTables), templates, world);
    activities.push(activity);
    byId.set(activity.id, activity);
  }
  for (const definition of raw.resolvers ?? []) {
    if (!definition?.id || byId.has(definition.id)) {
      throw new Error("[bot activities] resolver ids must be unique");
    }
    const resolver = compileActivity(definition, templates, world, { resolver: true });
    if (!resolver.resolves) {
      throw new Error(`[bot activities] resolver '${resolver.id}' needs a resolves key`);
    }
    resolvers.push(resolver);
    byId.set(resolver.id, resolver);
  }
  // A tier picks one activity per mode: the highest-level activity its
  // weakest bot can do (a 60 woodcutter chops yews, not normal trees).
  const siteCandidates = activities.filter(
    (activity) => !activity.manual && !activity.ephemeral && activity.mode && !NON_SITE_MODES.has(activity.mode)
  );
  const requiredLevel = (activity) => Number(fieldsById.get(activity.id)?.level ?? 1);
  function activitiesForLevel(lowest) {
    const bestByMode = new Map();
    for (const activity of siteCandidates) {
      const level = requiredLevel(activity);
      const best = bestByMode.get(activity.mode);
      if (level <= lowest && (!best || level > requiredLevel(best))) {
        bestByMode.set(activity.mode, activity);
      }
    }
    return siteCandidates.filter((activity) => bestByMode.get(activity.mode) === activity);
  }

  // bot-sites.json: a skilling site's `bots` maps each mode to a count, split evenly over
  // the tiers (here, in `tiers`; the lowest tiers take any remainder), or to per-tier counts. Each mode x tier is a
  // runtime site `<site>_<mode>_<tier>` whose bots only do that tier's activity for the mode.
  // A tier rolls every skill in its `skills` band and the combat stats into its `combat`
  // level band. PvP sites (with a `pvp` block) are hotspots, loaded by WildernessHotspotRegistry.
  // The world config's pluginConfig "PlayerBots:sites" switches sites on or off (Sites.PlayerBots.js).
  const sitesFile = readBotSites(options.sitesPath ?? DEFAULT_SITES_PATH);
  const tiers = Object.entries(raw.tiers ?? {});
  for (const [tierName, tier] of tiers) {
    if (!Array.isArray(tier?.skills) || tier.skills.length !== 2 || !Array.isArray(tier.combat)) {
      throw new Error(`[bot activities] tier '${tierName}' needs skills and combat bands`);
    }
  }
  const siteModes = new Set(siteCandidates.map((activity) => activity.mode));
  const sites = [];
  for (const place of sitesFile.sites ?? []) {
    if (place.pvp) continue;
    const placeSites = [];
    for (const [mode, counts] of Object.entries(place.bots ?? {})) {
      if (!siteModes.has(mode)) {
        throw new Error(`[bot sites] site '${place.id}' has unknown mode '${mode}' (${[...siteModes].join(", ")})`);
      }
      // A number is split over every tier; an object gives per-tier counts (missing tiers get none).
      const perTier = typeof counts === "object" && counts !== null;
      const unknownTier = perTier && Object.keys(counts).find((name) => !tiers.some(([tierName]) => tierName === name));
      if (unknownTier) {
        throw new Error(`[bot sites] site '${place.id}' ${mode} has unknown tier '${unknownTier}'`);
      }
      tiers.forEach(([tierName, tier], index) => {
        const count = perTier
          ? Number(counts[tierName] ?? 0)
          : Math.floor(counts / tiers.length) + (index < counts % tiers.length ? 1 : 0);
        const activity = activitiesForLevel(tier.skills[0]).find((candidate) => candidate.mode === mode);
        if (count === 0 || !activity) return;
        placeSites.push({
          ...SITE_DEFAULTS,
          ...(place.radius != null ? { spawnRadius: place.radius } : {}),
          id: `${place.id}_${mode}_${tierName}`,
          tier: tierName,
          enabled: place.enabled === true,
          anchor: { x: place.x, y: place.y, z: place.z ?? 0 },
          count,
          levels: { all: [tier.skills[0], tier.skills[1]], combat: [tier.combat[0], tier.combat[1]] },
          activities: [activity],
          rotation: null,
        });
      });
    }
    // `switchMinutes: [min, max]` lets a bot change mode within its tier: each bot rolls its
    // own timer in the range, and the next mode is weighted by the tier's counts so the
    // mix stays near the configured one. Omitted, bots stay on their mode.
    if (place.switchMinutes != null) {
      const [min, max] = place.switchMinutes;
      if (!(min > 0 && max >= min)) {
        throw new Error(`[bot sites] site '${place.id}' switchMinutes must be [min, max] minutes`);
      }
      for (const [tierName] of tiers) {
        const tierSites = placeSites.filter((site) => site.tier === tierName);
        if (tierSites.length < 2) continue;
        const rotation = {
          activityIds: tierSites.map((site) => site.activities[0].id),
          weights: Object.fromEntries(tierSites.map((site) => [site.activities[0].id, site.count])),
          switchAfterMs: { min: min * 60000, max: max * 60000 },
        };
        for (const site of tierSites) site.rotation = rotation;
      }
    }
    sites.push(...placeSites);
  }
  const slots = new Map();
  const lastActivityByPlayer = new WeakMap();
  const blockedUntilByPlayer = new WeakMap();

  function isBlocked(player, activityId, nowMs) {
    const until = blockedUntilByPlayer.get(player)?.get(activityId);
    return until !== undefined && until > nowMs;
  }

  function available(player, nowMs) {
    return activities.filter(
      (activity) =>
        activity.manual !== true &&
        (slots.get(activity.id) ?? 0) < activity.capacity &&
        !isBlocked(player, activity.id, nowMs) &&
        activity.requires.every((condition) => condition.check({ player }))
    );
  }

  return {
    activities,
    resolvers,
    byId,
    sites,
    hasRoom(activityId) {
      const activity = byId.get(activityId);
      return (
        !!activity && (slots.get(activity.id) ?? 0) < activity.capacity
      );
    },
    occupy(activity) {
      slots.set(activity.id, (slots.get(activity.id) ?? 0) + 1);
    },
    release(activity) {
      const next = Math.max(0, (slots.get(activity.id) ?? 0) - 1);
      slots.set(activity.id, next);
    },
    blockActivity(player, activityId, nowMs = Date.now(), durationMs = 15000) {
      let blocked = blockedUntilByPlayer.get(player);
      if (!blocked) {
        blocked = new Map();
        blockedUntilByPlayer.set(player, blocked);
      }
      blocked.set(activityId, nowMs + Math.max(0, durationMs));
    },
    /** `allowed` limits the pick to those ids; `avoid` excludes one (a rotation switch). */
    /** `weights` (id -> weight, default 1) biases a fresh pick, e.g. by a site's mode counts. */
    pickActivity(player, nowMs = Date.now(), { allowed = null, avoid = null, own = null, weights = null } = {}) {
      if (own) {
        // A bot going back to the activity it was given: only its failure cooldown
        // holds it back (capacity and `manual` are about handing out new activities).
        const activity = byId.get(own) ?? null;
        return activity && !isBlocked(player, own, nowMs) ? activity : null;
      }
      const previousId = lastActivityByPlayer.get(player);
      const candidates = available(player, nowMs).filter(
        (activity) => activity.id !== avoid && (!allowed || allowed.includes(activity.id))
      );
      const previous = candidates.find((activity) => activity.id === previousId);
      const weightOf = (activity) => Math.max(0, Number(weights?.[activity.id] ?? 1));
      let roll = Math.random() * candidates.reduce((sum, activity) => sum + weightOf(activity), 0);
      const picked = previous ?? candidates.find((activity) => (roll -= weightOf(activity)) < 0) ?? candidates[0] ?? null;
      if (picked) {
        lastActivityByPlayer.set(player, picked.id);
      }
      return picked;
    },
    resolversFor(condition) {
      const key = condition?.resolverKey;
      if (!key) {
        return [];
      }
      return resolvers.filter((resolver) => resolver.resolves === key);
    },
    getSite(siteId) {
      return sites.find((site) => site.id === siteId) ?? null;
    },
  };
}

module.exports = {
  createBotActivityRegistry,
};
