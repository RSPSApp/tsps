"use strict";

// Reads the loaded cache into the shapes an agent or an editor needs: one definition with its values
// and outbound links, a name search, and the reverse question ("what references this id?").
//
// Everything here is read-only. Nothing resolves a link by guessing: a target is `known`, `missing`
// or `unverified` (no decoder for that kind yet), and a multi-def says so instead of pretending the
// id it was asked about is the thing a player sees.

const { KINDS, CUSTOM_ITEM_RANGE, kindOf, fieldsOf, referenceFields, referencedKinds, readField } = require("./Fields.CacheEditor");

// Uploaded asset names, so a link or a value can read `model 1000000 (my_loc.dat)` instead of a bare
// id. Set once at startup by the plugin; the inspector never reads the filesystem itself.
let assetNames = new Map();
function setAssetNames(names) { assetNames = names; }
const assetNameOf = (kind, id) => assetNames.get(`${kind}:${id}`) ?? null;

/** Name maps the cache exposes, by kind. Missing entries mean "this server has no reverse map yet". */
function namesOf(core, kind) {
  const cache = core.CacheDefinitions;
  switch (kind) {
    case "loc": return cache.getLocNames();
    case "npc": return cache.getNpcNames();
    case "item": return cache.getObjNames();
    case "seq": return cache.getSeqNames();
    case "spotanim": return cache.getSpotanimNames?.();
    case "varp": return cache.getVarpNames?.();
    case "varbit": return cache.getVarbitNames?.();
    case "dbro": return cache.getDbRowNames?.();
    case "dbtable": return cache.getDbTableNames?.();
    case "inv": return cache.getInventoryNames?.();
    default: return undefined;
  }
}

function customItems(core) {
  try {
    return core.CacheDefinitions.getCustomItems() ?? [];
  } catch {
    return [];
  }
}

/** The definition object for a kind, or null when this server has no decoder for it. */
function definitionOf(core, kind, id) {
  const cache = core.CacheDefinitions;
  switch (kind) {
    case "loc": return cache.getObject(id);
    case "npc": return cache.getNpc(id);
    case "item": return cache.getItem(id);
    case "varbit": return cache.getVarbit(id);
    case "seq": return cache.getSeq(id);
    case "spotanim": return cache.getSpotanim(id);
    case "struct": return { params: cache.getStructParams(id) };
    case "enum": return { values: cache.getEnumValues(id) };
    case "dbro": return cache.getDbRow(id);
    case "dbtable": {
      const columns = cache.getDbColumns(id);
      const rows = cache.getDbTableRows(id);
      return { columns, rowCount: rows.length, rows };
    }
    default: return null;
  }
}

/** A display name: the definition's own name, the cache's gameval name, or null. */
function nameOf(core, kind, id) {
  const definition = definitionOf(core, kind, id);
  if (definition?.name) return definition.name;
  const names = namesOf(core, kind);
  const named = names?.get?.(id);
  if (named) return named;
  if (kind === "item") {
    const custom = customItems(core).find((row) => row.id === id);
    if (custom?.objType?.name) return custom.objType.name;
  }
  return null;
}

/** The id space a kind is known to occupy, when the cache reports it. */
function countOf(core, kind) {
  const counts = core.CacheDefinitions.getCounts();
  switch (kind) {
    case "loc": return counts.objects;
    case "npc": return counts.npcs;
    case "item": return counts.items;
    default: return null;
  }
}

/**
 * `known` / `missing` / `unverified` for one id in one kind.
 *
 * Only a kind with a known id space can be proven absent. Sequences, graphics and varps have no
 * reported count, and gamevals do not name every id, so an id that is merely unnamed stays
 * `unverified` — the alternative is calling real entries missing.
 */
function resolveId(core, kind, id) {
  if (!Number.isInteger(id) || id < 0) return "missing";
  // The archive answers existence; the name list only adds an id we could not prove absent.
  const known = core.CacheDefinitions.hasDefinition?.(kind, id);
  if (known === true) return "known";
  if (known === false) return "missing";
  return namesOf(core, kind)?.has?.(id) ? "known" : "unverified";
}

const values = (value) => (Array.isArray(value) ? value : [value]).filter((entry) => Number.isInteger(entry) && entry >= 0);

/**
 * One cache entry: its values, every link it holds, and its multi-def, if any.
 * `player` adds the resolved child for a logged-in player, which is what a tile actually shows.
 */
function describe(core, { kind, id, player = null, skipUnset = true }) {
  const entry = kindOf(kind);
  if (!Number.isInteger(id) || id < 0) throw new Error(`A ${kind} id must be a non-negative integer`);
  if (core.CacheDefinitions.hasDefinition?.(kind, id) === false) {
    return { kind, id, name: null, label: entry.label, exists: false, note: `No ${kind} ${id} in this cache.` };
  }
  const definition = definitionOf(core, kind, id);
  const fields = fieldsOf(kind);
  const out = {
    kind,
    id,
    exists: true,
    name: nameOf(core, kind, id),
    label: entry.label,
    custom: kind === "item" && id >= CUSTOM_ITEM_RANGE ? customItems(core).some((row) => row.id === id) : false,
  };
  if (!definition) {
    out.note = `No ${kind} decoder on this server yet; the id and its name resolve, its fields do not.`;
    return out;
  }
  const list = Array.isArray(definition) ? definition : null;
  if (list) out.rows = list.length;
  out.values = {};
  out.links = [];
  for (const field of fields ?? []) {
    const value = readField(kind, definition, field.name);
    if (value === undefined || value === null) continue;
    if (skipUnset && (value === -1 || value === "" || (Array.isArray(value) && value.length === 0)
      || (value instanceof Map && value.size === 0))) continue;
    out.values[field.name] = Array.isArray(value) ? value : value instanceof Map ? Object.fromEntries(value) : value;
    if (!field.ref) continue;
    // A param map's keys are the links; the values are just data.
    const targets = value instanceof Map ? [...value.keys()] : values(value);
    for (const target of targets) {
      out.links.push({
        field: field.name,
        kind: field.ref,
        id: target,
        name: nameOf(core, field.ref, target) ?? assetNameOf(field.ref, target),
        exists: resolveId(core, field.ref, target),
        ...(field.note ? { note: field.note } : {}),
      });
    }
  }
  const transforms = definition.transforms;
  if (Array.isArray(transforms) && transforms.length) {
    const gatedBy = definition.transformVarbit >= 0
      ? { kind: "varbit", id: definition.transformVarbit, name: nameOf(core, "varbit", definition.transformVarbit) }
      : definition.transformVarp >= 0
        ? { kind: "varp", id: definition.transformVarp, name: nameOf(core, "varp", definition.transformVarp) }
        : null;
    const children = transforms.filter((child) => Number.isInteger(child) && child >= 0);
    out.transforms = {
      gatedBy,
      children: children.map((child, index) => ({
        id: child, name: nameOf(core, kind, child), exists: resolveId(core, kind, child),
        ...(index === children.length - 1 ? { fallback: true } : {}),
      })),
      note: "This id is a placeholder: a player sees the child its gating variable selects.",
    };
    if (player && (kind === "loc" || kind === "npc")) {
      try {
        const resolved = kind === "loc"
          ? core.ObjectDefinition.forPlayer(id, player)?.id
          : core.CacheDefinitions.resolveNpc(id, player.getPacketSender())?.id;
        out.transforms.resolvedForPlayer = resolved ?? null;
      } catch {
        out.transforms.resolvedForPlayer = null;
      }
    }
  }
  if (kind === "dbro" && definition.columns) {
    const tableId = Number(out.values.tableId);
    const columns = Number.isInteger(tableId) ? core.CacheDefinitions.getDbColumns(tableId) : [];
    out.values.columns = Object.fromEntries([...definition.columns].map(([column, values]) => [
      `${column}${columns[column] ? ` (${columns[column]})` : ""}`, values,
    ]));
  }
  return out;
}

/** Name or id search within one kind, or across every named kind when `kind` is omitted. */
function search(core, { kind = null, text = "", limit = 20 }) {
  const needle = String(text ?? "").trim();
  if (!needle) throw new Error("Give some text to search for, or an id");
  const numeric = /^\d+$/.test(needle) ? Number(needle) : null;
  const lower = needle.toLowerCase();
  const kinds = kind ? [kindOf(kind) && kind] : Object.keys(KINDS).filter((entry) => KINDS[entry].gameval);
  const hits = [];
  for (const entry of kinds) {
    const names = namesOf(core, entry) ?? new Map();
    for (const [id, name] of names) {
      if (hits.length >= limit) break;
      if (numeric !== null ? id === numeric : String(name).toLowerCase().includes(lower)) {
        hits.push({ kind: entry, id, name });
      }
    }
    if (entry === "item" && hits.length < limit) {
      for (const row of customItems(core)) {
        const name = row.objType?.name ?? "";
        if (numeric !== null ? row.id === numeric : name.toLowerCase().includes(lower)) {
          hits.push({ kind: "item", id: row.id, name, custom: true });
        }
      }
    }
  }
  return hits.slice(0, limit);
}

// Reverse index, built once per loaded cache: target kind -> id -> who points at it.
let index;

/** Changes whenever an overlay, a custom item or a definition archive is installed. */
function overlayState(core) {
  try {
    const counts = core.CacheDefinitions.getCounts();
    return JSON.stringify([counts, customItems(core).length, core.CacheDefinitions.getDefinitionArchiveBundles?.().length ?? 0]);
  } catch {
    return "unknown";
  }
}

function buildIndex(core, sourceKinds) {
  const cache = core.CacheDefinitions;
  const state = overlayState(core);
  if (index?.cache === cache && index?.state === state && sourceKinds.every((kind) => index.done.has(kind))) return index;
  if (index?.cache !== cache || index?.state !== state) index = { cache, state, done: new Set(), map: new Map() };
  for (const source of sourceKinds) {
    if (index.done.has(source)) continue;
    const refs = referenceFields(source);
    const count = { loc: "objects", npc: "npcs", item: "items" }[source];
    const total = count ? cache.getCounts()[count] : 0;
    for (let id = 0; id < total; id++) {
      const definition = definitionOf(core, source, id);
      if (!definition) continue;
      for (const field of refs) {
        for (const target of values(readField(source, definition, field.name))) {
          if (target === -1) continue;
          const key = `${field.ref}:${target}`;
          const list = index.map.get(key) ?? [];
          list.push({ kind: source, id, name: nameOf(core, source, id), field: field.name });
          index.map.set(key, list);
        }
      }
    }
    index.done.add(source);
  }
  if (sourceKinds.includes("item")) {
    for (const row of customItems(core)) {
      for (const target of values(row.itemDef?.countObj ?? row.countObj ?? [])) {
        const key = `item:${target}`;
        index.map.set(key, [...(index.map.get(key) ?? []), { kind: "item", id: row.id, name: row.objType?.name ?? null, field: "custom" }]);
      }
    }
  }
  return index;
}

/** Which locs, npcs and items point at this id. Scans the definitions, so it is memoised. */
function usedBy(core, { kind, id, limit = 50 }) {
  kindOf(kind);
  const sources = ["loc", "npc", "item"].filter((source) => referencedKinds(source).includes(kind));
  if (!sources.length) return { kind, id, sources: [], note: `Nothing in loc/npc/item points at a ${kind}.` };
  const found = buildIndex(core, sources).map.get(`${kind}:${id}`) ?? [];
  return { kind, id, count: found.length, sources: found.slice(0, limit), scanned: sources };
}

/** Every kind the editor knows, with counts where the cache reports them. */
function kinds(core) {
  const counts = core.CacheDefinitions.getCounts();
  return Object.entries(KINDS).map(([kind, entry]) => ({
    kind,
    label: entry.label,
    archive: entry.archive,
    decoded: entry.decoded !== false,
    // Something the browser can actually open or search: a decoder, a name map, or both.
    usable: entry.decoded !== false || !!namesOf(core, kind),
    ...(entry.count ? { count: counts[entry.count] } : {}),
    ...(namesOf(core, kind) ? { named: namesOf(core, kind).size } : {}),
    // `searchable` says a picker may offer this kind: there is a name map to filter by.
    searchable: !!namesOf(core, kind),
  }));
}

/** The fields of a kind, with the target kind for each reference, so a picker can offer them. */
function fields(kind, { referencesOnly = true } = {}) {
  kindOf(kind);
  const entries = referencesOnly ? referenceFields(kind) : (fieldsOf(kind) ?? []);
  return entries.map((entry) => ({
    name: entry.name,
    type: entry.type,
    ...(entry.ref ? { ref: entry.ref } : {}),
    ...(entry.many ? { many: true } : {}),
    ...(entry.note ? { note: entry.note } : {}),
  }));
}

module.exports = { describe, search, usedBy, kinds, nameOf, resolveId, definitionOf, fields, setAssetNames, assetNameOf };
