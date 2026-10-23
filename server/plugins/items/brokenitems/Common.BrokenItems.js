"use strict";

/**
 * Broken items: what the units share - the plugin api, and every form of each item in
 * data/broken-items.json, found in the cache by name (docs/broken-items.md).
 *
 * An item "X" breaks into "X (broken)". Locked, it is "X (l)", which breaks into
 * "X (l) (broken)" and, above level 20 Wilderness, "X (l) (mangled)". An "X (l)" that Perdu no
 * longer locks (a fire cape (l), from before the Trouver rework) breaks into "X (broken)", as
 * the plain item does (Wiki: (l)).
 */
const DATA = require("../data/broken-items.json");

const TROUVER_PARCHMENT = "Trouver parchment";

let api = null;
let core = null;
/** Item id -> { entry, form }, built on first use. */
let formsById = null;
/** Real item ids (not notes or placeholders) by name, built on first use. */
let idsByName = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function getApi() {
  return api;
}

function getCore() {
  return core;
}

/** An item's name, or undefined for a note, a placeholder or no item at all. */
function itemName(itemId) {
  if (!core.CacheDefinitions.hasItem(itemId)) return undefined;
  const definition = core.CacheDefinitions.getItem(itemId);
  return definition && definition.noteTemplate < 0 && definition.placeholderTemplate < 0 ? definition.name : undefined;
}

/** The id of the real item named `name`, the lowest when several share it, or null. */
function idOf(name) {
  if (!idsByName) {
    idsByName = new Map();
    const { items } = core.CacheDefinitions.getCounts();
    for (let id = 0; id < items; id++) {
      const name = itemName(id);
      if (name && !idsByName.has(name)) idsByName.set(name, id);
    }
  }
  return idsByName.get(name) ?? null;
}

/** "Dizana's quiver (uncharged)" -> "Dizana's quiver (l) (uncharged)" for the entry "Dizana's quiver". */
function lockedName(entry, name) {
  return `${entry.name} (l)${name.slice(entry.name.length)}`;
}

/**
 * The forms of one entry, by id. `unlocked`/`locked` are the wearable item; `broken`, `lockedBroken`
 * and `mangled` what a death leaves; each knows the item it repairs or locks into.
 */
function formsOf(entry) {
  const forms = [];
  const add = (name, form) => {
    const id = idOf(name);
    if (id != null) forms.push({ id, ...form });
    return id;
  };
  const broken = idOf(`${entry.name} (broken)`);
  const repaired = idOf(entry.repairsTo ?? entry.name);
  for (const name of [entry.name, ...(entry.forms ?? [])]) {
    const unlockedId = idOf(name);
    if (unlockedId == null) continue;
    const lockedId = entry.lockable ? idOf(lockedName(entry, name)) : null;
    forms.push({ id: unlockedId, kind: "unlocked", lockedId, brokenId: broken });
    if (lockedId != null) forms.push({ id: lockedId, kind: "locked", unlockedId });
  }
  if (entry.lockable) {
    const lockedRepaired = idOf(lockedName(entry, entry.repairsTo ?? entry.name));
    const lockedBroken = add(`${entry.name} (l) (broken)`, { kind: "broken", repairsTo: lockedRepaired });
    const mangled = add(`${entry.name} (l) (mangled)`, { kind: "mangled", repairsTo: lockedRepaired });
    for (const form of forms) {
      if (form.kind !== "locked") continue;
      form.brokenId = lockedBroken;
      form.mangledId = mangled;
    }
  } else {
    // Locked before the Trouver rework: breaks as the plain item does.
    add(`${entry.name} (l)`, { kind: "unlocked", lockedId: null, brokenId: broken });
  }
  if (broken != null) forms.push({ id: broken, kind: "broken", repairsTo: repaired });
  return forms;
}

/** { entry, form } for an item id that is one of the items in data/broken-items.json, or null. */
function lookup(itemId) {
  if (!formsById) {
    formsById = new Map();
    for (const entry of DATA.items) {
      for (const form of formsOf(entry)) {
        if (!formsById.has(form.id)) formsById.set(form.id, { entry, form });
      }
    }
  }
  return formsById.get(itemId) ?? null;
}

/** What Perdu charges to repair `entry`'s broken form, and what a killer gets for it. */
function repairCost(entry) {
  let cost = entry.repairCost ?? 0;
  if (entry.repairCostPlusPriceOf) {
    const id = idOf(entry.repairCostPlusPriceOf);
    if (id != null) cost += core.ItemDefinition.forId(id).getGrandExchangeValue();
  }
  return cost;
}

/** The fee to repair the item with this id, or 0 when it isn't broken or mangled. */
function repairFee(itemId) {
  const found = lookup(itemId);
  if (!found) return 0;
  if (found.form.kind === "mangled") return DATA.mangledRepairCost;
  return found.form.kind === "broken" ? repairCost(found.entry) : 0;
}

function formatCoins(amount) {
  return Number(amount).toLocaleString("en-US");
}

module.exports = {
  DATA,
  TROUVER_PARCHMENT,
  init,
  getApi,
  getCore,
  itemName,
  idOf,
  lookup,
  repairCost,
  repairFee,
  formatCoins,
};
