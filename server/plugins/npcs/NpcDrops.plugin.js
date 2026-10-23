/**
 * NPC drop tables, driven by the OSRS Wiki dump.
 *
 * Regenerate in ../osrsreboxed-db with `python -m scripts.drops.update`, then copy:
 *   docs/drops-json/npc-drops.json -> data/definitions/npc-drops.json
 *   docs/drops-json/subtables.json -> data/definitions/npc-drop-subtables.json
 * Hand edits live in data/definitions/npc-drop-overrides.json, applied on top of the dump, never
 * in the generated files (docs/npc-drops.md).
 *
 * Shape: { tables: { "<tableId>": { label, main_max_roll, rolls?, entries[], tertiary[] } },
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
const OVERRIDES_FILE = "npc-drop-overrides.json";
const CURRENCY_IDS = new Set([995, 6529, 21555]);
const RING_OF_WEALTH_TABLES = new Set(["rareDrop", "gem", "megaRare"]);
/** Brimstone key, Larran's key. */
const SLAYER_KEYS = new Set([23083, 23490]);
const KALPHITE_QUEEN_NOTED_ITEMS = new Set([
  1391, 3049, 207, 3051, 219, 2363, 1783, 444, 1513, 1621, 1619, 1617, 245, 3138, 1987, 5940, 6016,
]);

/**
 * Wiki, Looting bag: "obtained as a drop from any monster in the Wilderness, excluding aviansie,
 * abyssal demons, and Black chinchompas". The tables list it on monsters found everywhere (rats,
 * black demons...), so where the monster dies decides it.
 */
const LOOTING_BAG = "Looting bag";
const LOOTING_BAG_EXCLUDED = new Set(["Aviansie", "Abyssal demon", "Black chinchompa"]);

function lootingBagDrops(npc) {
  if (!Wilderness.isInLocation(npc?.getLocation?.())) return false;
  const name = (npc.getCurrentDefinition?.() ?? npc.getDefinition?.())?.getName?.();
  return !LOOTING_BAG_EXCLUDED.has(name);
}

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

/**
 * npc-drop-overrides.json on top of the dump: NPCs removed or added, entries added to tables, and
 * shared tables the dumper doesn't export. Where the dump already has an NPC or shared table, the
 * dump's wins, so a dumper that learns to export it makes the override a no-op.
 */
function applyOverrides(dump, subtables, overrides) {
  for (const id of Object.keys(overrides.removeNpcs ?? {})) delete dump.npcs[id];
  for (const [id, npc] of Object.entries(overrides.addNpcs ?? {})) {
    if (id !== "$comment" && !dump.npcs[id]) dump.npcs[id] = npc;
  }
  for (const [tableId, change] of Object.entries(overrides.tables ?? {})) {
    const table = dump.tables[tableId];
    if (!table) {
      console.error(`[NpcDrops] npc-drop-overrides.json changes unknown table '${tableId}'`);
      continue;
    }
    for (const [key, field] of [["addEntries", "entries"], ["addTertiary", "tertiary"]]) {
      for (const entry of change[key] ?? []) {
        table[field] ??= [];
        if (!table[field].some((existing) => existing.item_id === entry.item_id)) table[field].push(entry);
      }
    }
    // Sections the Wiki lists on the page but that are not this table's normal kill (a boss's
    // contract rewards, say): left out of every roll.
    const removed = new Set(change.removeSections ?? []);
    if (removed.size > 0) {
      for (const field of ["entries", "tertiary"]) {
        if (table[field]) table[field] = table[field].filter((entry) => !removed.has(entry.section));
      }
    }
  }
  for (const [name, table] of Object.entries(overrides.subtables ?? {})) subtables[name] ??= table;
}

function applyWikiCorrections(tableById) {
  // Brimstone and Larran's keys drop from Konar's and Krystilia's task kills at a chance set by
  // the monster's combat level (plugins/skills/slayer/Keys.Slayer.js). The Wiki lists them on
  // some tables as "Always" (Konar task bonus) or a fixed rate, which dropped them on any kill.
  for (const table of Object.values(tableById)) {
    for (const field of ["entries", "tertiary"]) {
      if (table[field]) table[field] = table[field].filter((entry) => !SLAYER_KEYS.has(entry.item_id));
    }
  }
  // Each bronze piece survives on its own 9/10 roll (Wiki: 72.9% to get all three back); the
  // export flattened them into one 27-slot roll that always returns exactly one piece.
  for (const entry of tableById.animated_bronze_armour?.entries || []) {
    if (entry.section === "Armour") {
      Object.assign(entry, { separate_roll: true, weight: 9, out_of: 10 });
    }
  }
  // Zulrah: two rolls on its table per kill, tertiary drops excluded (Wiki, Drops).
  if (tableById.zulrah) {
    tableById.zulrah.rolls = 2;
  }
  // Vorkath: two rolls on its table per kill, tertiary drops excluded (Wiki, Drops).
  if (tableById.vorkath) {
    tableById.vorkath.rolls = 2;
  }
  correctMadAngel(tableById.mad_angel);
  correctSkotizo(tableById.skotizo);
  correctAmoxliatl(tableById.amoxliatl);
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

const MAD_ANGEL_SUNSTONE_CRYSTAL = 34032;
const MAD_ANGEL_TELEPORT = 34033;
const MAD_ANGEL_SUPPLY_FISH = new Set([385, 32328]);
/** Super combat potion(3), raw monkfish, emerald and sapphire: "(noted)" on the Wiki, lost by the export. */
const MAD_ANGEL_NOTED = new Set([12697, 7944, 1605, 1607]);
const MAD_ANGEL_SUPPLY_BONUS = [
  { item_id: 141, name: "Prayer potion(2)", quantity: [1, 1] },
  { item_id: 12701, name: "Super combat potion(1)", quantity: [1, 1] },
];

/**
 * The Mad Angel (Wiki, Drops): the sunstone crystal belongs to Fallen From Grace (not on this
 * server); the Ardeaglais teleport pre-roll is 1/25; and a supply batch (16/150) is either
 * sharks or yellowfins, bundled with a prayer potion(2) and a super combat potion(1) - the
 * export listed the four as separate rolls on a 182 table.
 */
function correctMadAngel(table) {
  if (!table) return;
  table.entries = (table.entries || []).filter((entry) => entry.item_id !== MAD_ANGEL_SUNSTONE_CRYSTAL
    && !(entry.section === "Supply batch" && !MAD_ANGEL_SUPPLY_FISH.has(entry.item_id)));
  for (const entry of table.entries) {
    if (entry.item_id === MAD_ANGEL_TELEPORT) entry.out_of = 25;
    if (entry.section === "Supply batch") entry.bonus_drops = MAD_ANGEL_SUPPLY_BONUS;
    if (MAD_ANGEL_NOTED.has(entry.item_id)) entry.noted = true;
    if (Number.isInteger(entry.out_of) && entry.out_of === table.main_max_roll) entry.out_of = 150;
  }
  table.main_max_roll = 150;
}

const SKOTIZO_TOTEMS = new Set([19679, 19681, 19683, 19685]);

/**
 * Skotizo (Wiki, Drops): one guaranteed roll of the ancient shard table (75/15/5/4/1 in 100) on
 * top of a main table out of 100 - the export folded the shards into the main roll out of 199.
 * His totem table (4/128: a whole totem or the piece the player lacks) is the Skotizo plugin's,
 * so the four flat totem tertiaries go.
 */
function correctSkotizo(table) {
  if (!table) return;
  for (const entry of table.entries || []) {
    if (entry.section === "Ancient shards") Object.assign(entry, { separate_roll: true, roll_group: "skotizo_shards", out_of: 100 });
    else if (Number.isInteger(entry.out_of) && entry.out_of === table.main_max_roll) entry.out_of = 100;
  }
  table.main_max_roll = 100;
  table.tertiary = (table.tertiary || []).filter((entry) => !SKOTIZO_TOTEMS.has(entry.item_id));
}

/**
 * Amoxliatl (Wiki, Drops): two rolls on her table plus one frozen tear roll per kill. The
 * export lists the tears' three amounts as separate rolls of their own (6/10, 3/10, 1/10); they
 * are one roll of 10, made once per kill rather than with each main roll.
 */
function correctAmoxliatl(table) {
  if (!table) return;
  table.rolls = 2;
  for (const entry of table.entries || []) {
    if (entry.section === "Frozen tears") Object.assign(entry, { roll_group: "amoxliatl_tears", once_per_kill: true });
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
  const subtables = readJson(SUBTABLES_FILE) || {};
  applyOverrides(dump, subtables, readJson(OVERRIDES_FILE) || {});
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

/** Independent `weight / out_of` chance, `multiplier` times as likely. */
function hits(entry, multiplier = 1) {
  const outOf = Number(entry.out_of);
  if (!Number.isInteger(outOf) || outOf <= 0) {
    return false;
  }
  const weight = Number.isInteger(entry.weight) ? entry.weight : 1;
  return Math.random() * outOf < Math.min(outOf, weight * multiplier);
}

const WILDERNESS_CLUE = /^clue scroll \((?!beginner\))/i;

/**
 * What makes tertiary drops likelier for this kill, asked once per kill: rules
 * { pattern, multiplier } matched against each entry's name. An imbued ring of wealth doubles
 * clue scrolls in the Wilderness, and plugins answer npc-drops:tertiary-chance
 * { player, npc, npcId, rules } by pushing their own (Mortimer's clue tasks).
 */
function tertiaryRules(player, npc) {
  const rules = [];
  if (isWearingImbuedRingOfWealth(player) && Wilderness.isInLocation(npc?.getLocation?.())) {
    rules.push({ pattern: WILDERNESS_CLUE, multiplier: 2 });
  }
  pluginApi?.emitCustomEvent("npc-drops:tertiary-chance", { player, npc, npcId: npc?.getId?.(), rules });
  return rules;
}

function tertiaryMultiplier(entry, rules) {
  let multiplier = 1;
  for (const rule of rules) {
    if (rule.pattern.test(entry.name || "")) multiplier *= rule.multiplier;
  }
  return multiplier;
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
 * One roll on a table: its pre-roll, main roll and separate rolls. Separate rolls marked
 * `once_per_kill` are made on the first of a table's `rolls` only.
 */
function rollOnce(table, entries, player, first = true) {
  const drops = [];
  const main = [];
  const separateGroups = new Map();
  let preRollHit = false;

  for (const entry of entries) {
    if (entry.always) {
      continue;
    } else if (entry.pre_roll) {
      if (!preRollHit && hits(entry)) {
        drops.push(...resolveEntry(entry, player));
        preRollHit = true;
      }
    } else if (entry.separate_roll) {
      if (entry.once_per_kill && !first) continue;
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

  return drops;
}

/**
 * One kill: guaranteed drops, then a pre-roll (which replaces the main roll when it hits),
 * then a single weighted main-table roll, then independent separate/tertiary rolls. A table
 * with `rolls` repeats everything but the guaranteed, tertiary and `once_per_kill` drops that many times.
 */
function rollTable(table, player, npc) {
  const drops = [];
  const entries = Array.isArray(table.entries) ? table.entries : [];
  for (const entry of entries) {
    if (entry.always) {
      drops.push(...resolveEntry(entry, player));
    }
  }
  const rolls = Number.isInteger(table.rolls) && table.rolls > 1 ? table.rolls : 1;
  for (let roll = 0; roll < rolls; roll++) {
    drops.push(...rollOnce(table, entries, player, roll === 0));
  }

  const rules = table.tertiary?.length ? tertiaryRules(player, npc) : [];
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
    if (entry.name === LOOTING_BAG && !lootingBagDrops(npc)) continue;
    if (hits(entry, tertiaryMultiplier(entry, rules))) {
      drops.push(...resolveEntry(entry, player));
    }
  }

  return drops;
}

/**
 * Answers npc-drops:extra-rolls { player, npc, npcId, rolls, drops }: `rolls` more rolls of the
 * NPC's table, without its always-drops, pushed onto `drops` (Chambers of Xeric scavenger beasts
 * drop three items at a time).
 */
function extraRolls(event) {
  ensureDropsLoaded?.();
  const table = tableForNpc(event.npcId);
  if (!table || !Array.isArray(event.drops)) return;
  const rolling = { ...table, entries: (table.entries || []).filter((entry) => !entry.always), tertiary: [] };
  for (let i = 0; i < (event.rolls ?? 0); i++) event.drops.push(...rollTable(rolling, event.player, event.npc));
}

let ensureDropsLoaded = null;

function tableForNpc(npcId) {
  const tables = tablesByNpc.get(npcId);
  if (!tables || tables.length === 0) {
    return null;
  }
  // ponytail: ID variants are resolved by the exporter; context-dependent tables still
  // use the first entry until encounter/quest conditions have an executable contract.
  return tables[0];
}

function dropFor(player, npc, npcId, location, damagers = []) {
  const table = tableForNpc(npcId);
  if (!table || !itemOnGroundManager) {
    return 0;
  }

  const drops = rollTable(table, player, npc);
  // Loot that depends on where or what the NPC was rather than its table (the Catacombs of
  // Kourend's totem pieces and shards), added before anything below reads the drops.
  pluginApi?.emitCustomEvent("npc-drops:add", { player, npc, npcId, drops });
  // Drops that depend on the killer's progress (Warriors' Guild defenders) are edited in place.
  // `damagers`: every player who damaged the npc (an Ironman gets nothing when others helped).
  pluginApi?.emitCustomEvent("npc-drops:roll", { player, npc, npcId, drops, damagers });
  const event = { player, npc, npcId, drops, handled: false };
  pluginApi.emitCustomEvent("npc-drops:generated", event);
  if (event.handled) return drops.length;
  // Where the loot lands; a boss whose body is out of reach (Zulrah) moves it under the killer.
  const where = { player, npc, npcId, location };
  pluginApi.emitCustomEvent("npc-drops:location", where);
  placeDrops(player, drops, where.location);
  return drops.length;
}

/**
 * Puts rolled drops on the ground for `player` (noted where the table says), or currency in the
 * pack when a worn ring of wealth has Coin collection on.
 */
function placeDrops(player, drops, location) {
  for (const drop of drops) {
    if (!Number.isInteger(drop.itemId) || drop.amount <= 0) {
      continue;
    }
    if (CURRENCY_IDS.has(drop.itemId) && isWearingRingOfWealth(player) && autoCollectCurrencies(player)) {
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
}

module.exports = {
  name: "NpcDrops",
  register(api) {
    pluginApi = api;
    itemOnGroundManager = api.getItemOnGroundManager();

    // Parsed on the first NPC death rather than at boot: an idle world (or one with no
    // combat) never needs the ~10 MiB of drop tables.
    let stats = null;
    const ensureDrops = () => {
      if (!stats) stats = loadDrops();
      return stats;
    };
    ensureDropsLoaded = ensureDrops;
    api.onCustomEvent("npc-drops:extra-rolls", extraRolls);

    // "npc-drops:roll-table" { player, table, drops }: a table outside an NPC's own (a boss's
    // chest) rolled with the same roller and shared tables; the drops are pushed onto `drops`.
    // { player, npcId, drops, npc? } rolls that NPC's own table instead, for a boss that rewards
    // several players without dying to each (the Nightmare); `npc` places it (looting bags), and
    // `entryFilter(entry)` keeps only some of its entries (a shared kill rolling its parts apart).
    api.onCustomEvent("npc-drops:roll-table", (request) => {
      ensureDrops();
      let table = request.table ?? tableForNpc(request.npcId);
      if (table && typeof request.entryFilter === "function") {
        table = {
          ...table,
          entries: (table.entries || []).filter(request.entryFilter),
          tertiary: (table.tertiary || []).filter(request.entryFilter),
        };
      }
      if (table) request.drops.push(...rollTable(table, request.player, request.npc ?? null));
    });
    // "npc-drops:place" { player, drops, location }: drops rolled elsewhere, put down as a kill's.
    api.onCustomEvent("npc-drops:place", ({ player, drops, location }) => placeDrops(player, drops, location));

    api.onNpcDeath(({ killer, npc, npcId, damagers }) => {
      if (!killer || !npc) {
        return;
      }
      const id = Number.isInteger(npcId) ? npcId : npc.getId?.();
      if (!Number.isInteger(id)) {
        return;
      }
      // "npc-drops:claim": a boss that shares its loot between players (the Wilderness bosses)
      // takes the kill over, rolling each share with npc-drops:roll-table and placing it with
      // npc-drops:place.
      const claim = { killer, npc, npcId: id, damagers: damagers ?? [], handled: false };
      api.emitCustomEvent("npc-drops:claim", claim);
      if (claim.handled) {
        return;
      }
      try {
        ensureDrops();
        dropFor(killer, npc, id, npc.getLocation(), damagers ?? []);
      } catch (error) {
        console.error("[NpcDrops] failed to roll drops for npc", id, error);
      }
    });

    api.registerCommand("reloaddrops", ({ player }) => {
      try {
        stats = loadDrops();
        player.sendMessage(
          `Reloaded drops: ${stats.npcs} npcs, ${stats.tables} tables.`
        );
      } catch (error) {
        console.error("[NpcDrops] reload failed", error);
        player.sendMessage("Error reloading npc drops.");
      }
      return true;
    }, PlayerRights.OWNER, "Reload NPC drops");

    api.log("registered", { lazy: true });
  },
  _test: { loadDrops, tablesByNpc, sharedTables },

  // Exposed for the smoke test.
  __internals: { loadDrops, rollTable, rollSharedTable, placeDrops, tablesByNpc, sharedTables },
};
