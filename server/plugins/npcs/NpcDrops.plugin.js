/**
 * NPC drop tables, driven by the OSRS Wiki dump.
 *
 * Regenerate in ../osrsreboxed-db with `python -m scripts.drops.update`, then copy:
 *   docs/drops-json/npc-drops.json -> data/definitions/npc-drops.json
 *   docs/drops-json/subtables.json -> data/definitions/npc-drop-subtables.json
 *
 * Shape: { tables: { "<tableId>": { label, main_max_roll, entries[], tertiary[] } },
 *           npcs:   { "<npcId>": { name, tables: ["<tableId>"] } } }
 * Entries carry `weight` out of `out_of`; `shared_table` entries roll one of the shared tables
 * (rare drop table, gem, herb, seed) held in the subtables file.
 */

const fs = require("fs");
const path = require("path");

const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const {
  autoCollectCurrencies,
  isWearingImbuedRingOfWealth,
  isWearingRingOfWealth,
} = require("../items/RingOfWealth.plugin");

const DROPS_FILE = "npc-drops.json";
const SUBTABLES_FILE = "npc-drop-subtables.json";
const CURRENCY_IDS = new Set([995, 6529, 21555]);
const RING_OF_WEALTH_TABLES = new Set(["rareDrop", "gem", "megaRare"]);
const KALPHITE_QUEEN_NOTED_ITEMS = new Set([
  1391, 3049, 207, 3051, 219, 2363, 1783, 444, 1513, 1621, 1619, 1617, 245, 3138, 1987, 5940, 6016,
]);

/** npcId -> array of shared table objects (one instance per distinct table) */
const tablesByNpc = new Map();
/** shared table name -> [{ itemId, quantity, weight }] */
const sharedTables = new Map();

let itemOnGroundManager = null;
let pluginApi = null;
let unusableSubtableRows = 0;
let conditionalTertiarySkipped = 0;

function definitionPath(fileName) {
  return path.join(GameConstants.DEFINITIONS_DIRECTORY, fileName);
}

function readJson(fileName) {
  const file = definitionPath(fileName);
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** `"3/128"` -> weight 3. Text rarities ("Common") have no numeric form and are skipped. */
function parseSharedRarity(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const weight = Number(match[1]);
  const outOf = Number(match[2]);
  return outOf > 0 && weight > 0 ? { weight, outOf } : null;
}

function parseQuantityRaw(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const single = /^(\d+)$/.exec(raw.trim());
  if (single) {
    const value = Number(single[1]);
    return [value, value];
  }
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(raw.trim());
  if (range) {
    return [Number(range[1]), Number(range[2])];
  }
  return null;
}

function isNotedQuantity(raw) {
  return typeof raw === "string" && /\(noted\)/i.test(raw);
}

function applyWikiCorrections(tableById) {
  const kalphiteQueen = tableById.kalphite_queen;
  if (!kalphiteQueen) {
    return;
  }
  for (const entry of kalphiteQueen.entries || []) {
    if (KALPHITE_QUEEN_NOTED_ITEMS.has(entry.item_id)) {
      entry.noted = true;
    }
    if (entry.section === "Consumables") {
      entry.roll_group = "kalphite_queen_consumable";
    }
  }
}

function loadDrops() {
  tablesByNpc.clear();
  sharedTables.clear();
  unusableSubtableRows = 0;

  const dump = readJson(DROPS_FILE);
  if (!dump || !dump.npcs) {
    return { npcs: 0, tables: 0, shared: 0 };
  }

  // Tables are stored once and referenced by id, so the same table shared by 40 npc ids is one
  // object rather than 40 copies.
  const tableById = dump.tables;
  if (!tableById) {
    console.error(
      "[NpcDrops] npc-drops.json has no `tables` section — regenerate it with the wiki dumper."
    );
    return { npcs: 0, tables: 0, shared: 0, unusableSubtableRows: 0 };
  }
  applyWikiCorrections(tableById);

  for (const [npcId, npc] of Object.entries(dump.npcs)) {
    const id = Number(npcId);
    if (!Number.isInteger(id) || !Array.isArray(npc.tables) || npc.tables.length === 0) {
      continue;
    }
    const resolved = [];
    for (const ref of npc.tables) {
      const table = tableById[ref];
      if (table) {
        resolved.push(table);
      } else {
        console.error(`[NpcDrops] npc ${id} references unknown drop table '${ref}'`);
      }
    }
    if (resolved.length > 0) {
      tablesByNpc.set(id, resolved);
    }
  }
  const tableCount = Object.keys(tableById).length;

  const subtables = readJson(SUBTABLES_FILE) || {};
  for (const [name, table] of Object.entries(subtables)) {
    const entries = [];
    for (const entry of table.entries || []) {
      const rarity = parseSharedRarity(entry.rarity_raw);
      if (!rarity) {
        unusableSubtableRows++;
        continue;
      }
      // A row is one of: a nested table (the rare drop table rolls the gem table on 20/128),
      // an empty slot, or an item. Only the last needs an id.
      if (entry.shared_table) {
        entries.push({ ref: entry.shared_table, weight: rarity.weight, outOf: rarity.outOf });
      } else if (entry.nothing) {
        entries.push({ nothing: true, weight: rarity.weight, outOf: rarity.outOf });
      } else if (Number.isInteger(entry.item_id)) {
        entries.push({
          itemId: entry.item_id,
          quantity: parseQuantityRaw(entry.quantity_raw) || [1, 1],
          noted: isNotedQuantity(entry.quantity_raw),
          weight: rarity.weight,
          outOf: rarity.outOf,
        });
      } else {
        unusableSubtableRows++;
      }
    }
    if (entries.length > 0) {
      sharedTables.set(name, entries);
    }
  }

  return {
    npcs: tablesByNpc.size,
    tables: tableCount,
    shared: sharedTables.size,
    unusableSubtableRows,
  };
}

function randomInt(bound) {
  return Math.floor(Math.random() * bound);
}

function rollQuantity(entry) {
  const quantity = Array.isArray(entry.quantity) ? entry.quantity : parseQuantityRaw(entry.quantity_raw);
  if (!quantity || quantity.length === 0) {
    return 1;
  }
  const [min, max] = [quantity[0], quantity[quantity.length - 1]];
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    return 1;
  }
  return min + randomInt(max - min + 1);
}

/** Independent `weight / out_of` chance. */
function hits(entry, doubleChance = false) {
  const outOf = Number(entry.out_of);
  if (!Number.isInteger(outOf) || outOf <= 0) {
    return false;
  }
  const weight = Number.isInteger(entry.weight) ? entry.weight : 1;
  return randomInt(outOf) < Math.min(outOf, weight * (doubleChance ? 2 : 1));
}

function rollSharedTable(name, player, depth = 0) {
  // Shared tables reference each other (rare -> gem -> mega-rare), so cap the chain.
  if (depth > 4) {
    return [];
  }
  const entries = sharedTables.get(name);
  if (!entries || entries.length === 0) {
    return [];
  }
  const pool = isWearingRingOfWealth(player) && RING_OF_WEALTH_TABLES.has(name)
    ? entries.filter((entry) => !entry.nothing)
    : entries;
  // Published as per-item n/outOf slots sharing one pool, so roll the pool once and walk
  // cumulative weights. A roll past the last slot is a miss, which is the empty part of the pool.
  const outOf = pool === entries
    ? entries[0].outOf
    : pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = randomInt(Math.max(1, outOf));
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) {
      if (entry.nothing) {
        return [];
      }
      if (entry.ref) {
        return rollSharedTable(entry.ref, player, depth + 1);
      }
      const [min, max] = entry.quantity;
      return [{
        itemId: entry.itemId,
        amount: min + randomInt(Math.max(1, max - min + 1)),
        noted: entry.noted === true,
      }];
    }
  }
  return [];
}

function resolveEntry(entry, player) {
  if (entry.nothing) {
    return [];
  }
  if (entry.shared_table) {
    return rollSharedTable(entry.shared_table, player);
  }
  if (!Number.isInteger(entry.item_id)) {
    return [];
  }
  const drops = [{ itemId: entry.item_id, amount: rollQuantity(entry), noted: entry.noted === true }];
  for (const bonus of entry.bonus_drops || []) {
    if (Number.isInteger(bonus.item_id)) {
      drops.push({ itemId: bonus.item_id, amount: rollQuantity(bonus), noted: bonus.noted === true });
    }
  }
  return drops;
}

/**
 * One kill: guaranteed drops, then a pre-roll (which replaces the main roll when it hits),
 * then a single weighted main-table roll, then independent separate/tertiary rolls.
 */
function rollTable(table, player, npc) {
  const drops = [];
  const entries = Array.isArray(table.entries) ? table.entries : [];

  const main = [];
  const separateGroups = new Map();
  let preRollHit = false;

  for (const entry of entries) {
    if (entry.always) {
      drops.push(...resolveEntry(entry, player));
    } else if (entry.pre_roll) {
      if (!preRollHit && hits(entry)) {
        drops.push(...resolveEntry(entry, player));
        preRollHit = true;
      }
    } else if (entry.separate_roll) {
      if (entry.roll_group) {
        const group = separateGroups.get(entry.roll_group) || [];
        group.push(entry);
        separateGroups.set(entry.roll_group, group);
      } else if (hits(entry)) {
        drops.push(...resolveEntry(entry, player));
      }
    } else if (Number.isInteger(entry.weight)) {
      main.push(entry);
    }
  }

  for (const group of separateGroups.values()) {
    const outOf = Number(group[0]?.out_of);
    let roll = randomInt(Number.isInteger(outOf) && outOf > 0 ? outOf : group.reduce((sum, entry) => sum + entry.weight, 0));
    for (const entry of group) {
      roll -= entry.weight;
      if (roll < 0) {
        drops.push(...resolveEntry(entry, player));
        break;
      }
    }
  }

  if (!preRollHit && main.length > 0) {
    const maxRoll = Number.isInteger(table.main_max_roll)
      ? table.main_max_roll
      : main.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = randomInt(Math.max(1, maxRoll));
    for (const entry of main) {
      roll -= entry.weight;
      if (roll < 0) {
        drops.push(...resolveEntry(entry, player));
        break;
      }
    }
  }

  for (const entry of table.tertiary || []) {
    // A tertiary at 1/1 is a conditional drop, not a guaranteed one: the wiki writes
    // "Always" for things that always drop *given* a condition (an active clue step, a quest,
    // a diary), and the condition only exists as free text in `notes`. Genuine 100% drops are
    // in the guaranteed section with `always`. Dropping these unconditionally hands out clue
    // keys and quest items from every kill, so skip them.
    if (Number(entry.out_of) <= 1) {
      conditionalTertiarySkipped++;
      continue;
    }
    const wildernessClue = /^clue scroll \((?!beginner\))/i.test(entry.name || "") &&
      isWearingImbuedRingOfWealth(player) && Wilderness.isInLocation(npc?.getLocation?.());
    if (hits(entry, wildernessClue)) {
      drops.push(...resolveEntry(entry, player));
    }
  }

  return drops;
}

function tableForNpc(npcId) {
  const tables = tablesByNpc.get(npcId);
  if (!tables || tables.length === 0) {
    return null;
  }
  // ponytail: ID variants are resolved by the exporter; context-dependent tables still
  // use the first entry until encounter/quest conditions have an executable contract.
  return tables[0];
}

function dropFor(player, npc, npcId, location) {
  const table = tableForNpc(npcId);
  if (!table || !itemOnGroundManager) {
    return 0;
  }

  const drops = rollTable(table, player, npc);
  for (const drop of drops) {
    if (!Number.isInteger(drop.itemId) || drop.amount <= 0) {
      continue;
    }
    if (CURRENCY_IDS.has(drop.itemId) && autoCollectCurrencies(player)) {
      const inventory = player.getInventory();
      if (inventory.contains(drop.itemId) || inventory.getFreeSlots() > 0) {
        inventory.adds(drop.itemId, drop.amount);
        continue;
      }
    }
    const definition = ItemDefinition.forId(drop.itemId);
    const noteId = definition.getNoteId();
    const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted()
      ? noteId
      : drop.itemId;
    const item = new Item(itemId, drop.amount);
    const stackable = item.getDefinition && item.getDefinition()
      ? item.getDefinition().isStackable()
      : false;
    if (stackable) {
      itemOnGroundManager.registerLocation(player, item, location);
    } else {
      for (let i = 0; i < drop.amount; i++) {
        itemOnGroundManager.registerLocation(player, new Item(itemId, 1), location);
      }
    }
  }
  return drops.length;
}

module.exports = {
  name: "NpcDrops",
  register(api) {
    pluginApi = api;
    itemOnGroundManager = api.getItemOnGroundManager();

    const stats = loadDrops();

    api.onNpcDeath(({ killer, npc, npcId }) => {
      if (!killer || !npc) {
        return;
      }
      const id = Number.isInteger(npcId) ? npcId : npc.getId?.();
      if (!Number.isInteger(id)) {
        return;
      }
      try {
        dropFor(killer, npc, id, npc.getLocation());
      } catch (error) {
        console.error("[NpcDrops] failed to roll drops for npc", id, error);
      }
    });

    api.registerCommand("reloaddrops", ({ player }) => {
      try {
        const reloaded = loadDrops();
        player.sendMessage(
          `Reloaded drops: ${reloaded.npcs} npcs, ${reloaded.tables} tables.`
        );
      } catch (error) {
        console.error("[NpcDrops] reload failed", error);
        player.sendMessage("Error reloading npc drops.");
      }
      return true;
    }, PlayerRights.OWNER);

    api.log("registered", stats);
  },

  // Exposed for the smoke test.
  __internals: { loadDrops, rollTable, rollSharedTable, tablesByNpc, sharedTables },
};
