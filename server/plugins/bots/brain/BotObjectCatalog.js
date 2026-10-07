"use strict";

const Woodcutting = require("../../skills/Woodcutting.plugin");
const Mining = require("../../skills/Mining.plugin");
const Smithing = require("../../skills/Smithing.plugin");
const {
  CacheDefinitions,
} = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");

const CATALOGS = {
  tree: () =>
    (Woodcutting.TREES ?? []).map((tree) => ({
      name: tree.name,
      objectNames: tree.objectNames ?? [],
      ids: tree.objectIds ?? [],
    })),
  rock: () =>
    (Mining.ROCKS ?? []).map((rock) => ({
      name: rock.objectName,
      objectNames: rock.objectName ? [rock.objectName] : [],
      ids: rock.objectIds ?? [],
    })),
  furnace: () => [
    {
      name: "furnace",
      objectNames: ["Furnace"],
      ids: [...(Smithing.FURNACE_OBJECT_IDS ?? [])].filter(Number.isInteger),
    },
  ],
};

let idsByName = null;

/**
 * The hand-written id lists in the skill plugins can go stale when the cache
 * revision changes (rock ids now point at stumps). Resolve ids by cache object
 * name instead, which is what the plugins' interaction hooks match on.
 */
function buildNameIndex() {
  idsByName = new Map();
  const wanted = new Set();
  for (const load of Object.values(CATALOGS)) {
    for (const entry of load()) {
      for (const name of entry.objectNames) {
        if (name) {
          wanted.add(name);
        }
      }
    }
  }
  try {
    const count = CacheDefinitions.getCounts?.().objects ?? 0;
    for (let id = 0; id < count; id++) {
      const name = CacheDefinitions.getObject(id)?.name;
      if (!name || !wanted.has(name)) {
        continue;
      }
      const list = idsByName.get(name) ?? [];
      list.push(id);
      idsByName.set(name, list);
    }
  } catch (_) {
    // Fall back to the plugin's own id lists when definitions are unavailable.
  }
}

function normalize(value) {
  return String(value ?? "").toLowerCase();
}

function matchEntry(kind, tier) {
  const load = CATALOGS[kind];
  if (!load) {
    throw new Error(`[bot activities] unknown object catalog '${kind}'`);
  }
  const entries = load().filter(
    (entry) => entry.ids.length > 0 || entry.objectNames.length > 0
  );
  if (!tier) {
    return entries;
  }
  const wanted = normalize(tier);
  const match = entries.find((entry) => {
    const name = normalize(entry.name);
    return (
      name === wanted ||
      name === `${wanted} tree` ||
      name === `${wanted} rocks` ||
      name.startsWith(`${wanted} `)
    );
  });
  return match ? [match] : [];
}

function resolveEntryIds(entry) {
  if (!idsByName) {
    buildNameIndex();
  }
  const resolved = [];
  for (const name of entry.objectNames) {
    resolved.push(...(idsByName.get(name) ?? []));
  }
  return resolved.length > 0 ? resolved : entry.ids;
}

function resolveCatalogObjectIds(spec = {}) {
  if (Array.isArray(spec.objectIds) && spec.objectIds.length > 0) {
    return spec.objectIds.map(Number).filter(Number.isFinite);
  }
  const kind = spec.catalog ?? (spec.treeTier ? "tree" : null);
  if (!kind) {
    return [];
  }
  const entries = matchEntry(kind, spec.tier ?? spec.treeTier ?? null);
  const ids = new Set();
  for (const entry of entries) {
    for (const id of resolveEntryIds(entry)) {
      ids.add(id);
    }
  }
  return [...ids];
}

/** Every catalog id, for boot-time index tracking before the dump is built. */
function listCatalogObjectIds() {
  const ids = new Set();
  for (const kind of Object.keys(CATALOGS)) {
    for (const entry of matchEntry(kind, null)) {
      for (const id of resolveEntryIds(entry)) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

module.exports = {
  resolveCatalogObjectIds,
  listCatalogObjectIds,
};
