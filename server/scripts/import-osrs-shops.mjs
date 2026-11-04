#!/usr/bin/env node
/**
 * Regenerate server/data/definitions/shops.json from the osrsreboxed shop dumps.
 *
 * Inputs (from the osrsreboxed-db checkout):
 *   docs/shops-items-by-shop.json  - shop stock, currency and resolved owners
 *   docs/shops-by-npc.json         - which NPC option opens each shop (optional)
 *
 * The script preserves the ids of shops already in shops.json (ids are
 * referenced by plugins) and assigns new
 * ids above the current maximum. Entries not covered by the osrsreboxed dump
 * (the legacy core shops) are kept as they are. Every tsps-specific difference
 * from the dump lives in the tables below, never in shops.json itself, so the
 * import can be re-run: `--check` must report shops.json as up to date.
 *
 * Usage:
 *   node scripts/import-osrs-shops.mjs [--docs <osrsreboxed/docs>] [--check]
 *
 * Default docs path: ../../osrsreboxed-db/docs relative to the repo root.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const shopsFile = path.join(repoRoot, "server", "data", "definitions", "shops.json");

// Shops whose wiki currency is a bare "Points" and so needs a concrete key.
const CURRENCY_OVERRIDES = {
  "Slayer Rewards": "SLAYER_POINTS",
  "Bounty Hunter Store": "BOUNTY HUNTER POINTS",
  "Justine's stuff for the Last Shopper Standing": "LAST MAN STANDING POINTS",
  "Mahogany Homes Reward Shop": "MAHOGANY HOMES POINTS",
  "PvP Arena Rewards": "PVP ARENA POINTS",
  "Vale Research Exchange": "VALE RESEARCH POINTS",
};

// Wiki page parse artefacts, not real shops.
const EXCLUDED = new Set([
  "Void Knights' Reward Options (! colspan)",
  "Void Knights' Reward Options (! rowspan)",
]);

// Wiki shops a tsps plugin serves instead, so shops.json must not carry them.
const REPLACED_BY_PLUGIN = {
  "Void Knights' Reward Options": "the Pest Control reward interface (243)",
  "Giants' Foundry Reward Shop": "Kovac's reward shop in the Giants' Foundry plugin",
  "Mixology Rewards": "the Mastering Mixology Omnishop",
  Sawmill: "the sawmill operators make planks, as captured",
  "Slayer Rewards": "the Slayer plugin, built from the cache's Slayer tables",
  // The three below are opened from a loc or NPC op the plugin owns and sell in
  // currencies held as raid/quest state, not in shops.json.
  "Alliance Supplies": "the Fractured Archive Quartermaster (omnishop row tfa_midraid_supplies_shop)",
  "Theatre of Blood Supplies": "the Theatre of Blood supply chests (interface 405, enums 1952/1953)",
  "Useful Supplies": "The Blood Moon Rises Castle Drakan chest (omnishop row 16873)",
};

// Karamja gloves variants share their default store's NPC and option; bound
// as well, the two shops cancel each other out, so only the default is bound.
const UNBOUND = new Set([
  "Davon's Amulet Store. (Karamja gloves)",
  "Fernahei's Fishing Hut. (Karamja gloves)",
  "Gabooty's Tai Bwo Wannai Cooperative. (Karamja gloves)",
  "Gabooty's Tai Bwo Wannai Drinky Store. (Karamja gloves)",
  "Jiminua's Jungle Store. (Karamja gloves 3+)",
  "Karamja General Store (Karamja gloves 3)",
  "Obli's General Store. (Karamja gloves)",
  "Tamayu's Spear Stall (Karamja gloves)",
  "TzHaar-Hur-Lek's Ore and Gem Store (Karamja gloves)",
  "TzHaar-Hur-Rin's Ore and Gem Store (Karamja gloves)",
  "TzHaar-Hur-Tel's Equipment Store (Karamja gloves)",
  "TzHaar-Hur-Zal's Equipment Store (Karamja gloves)",
  "TzHaar-Mej-Roh's Rune Store (Karamja gloves)",
]);

// NPC bindings that differ from the Wiki's shop owners: { optionSlot: [ids] }
// to add, [ids] to drop from every slot.
const NPC_OVERRIDES = {
  // Felix's Trade opens the Guardians of the Rift Omnishop; only the Temple of
  // the Eye quest copies of him keep this shop.
  "Temple Supplies": { remove: [11404] },
  // Fadli's Buy opens the Shop of Distaste; this shop opens from the rotten tomato
  // crates by the pillories and Emir's Arena (Wiki: Pelters' Veg Stall), which the
  // Pillory plugin serves.
  "Pelters' Veg Stall": { remove: [3340] },
};

// Shops whose rows tsps lists in another order than the Wiki: these IDs come
// first, in this order, then the remaining rows in the Wiki's order.
const STOCK_ORDER = {
  // Amulet of power first, holy symbol last (544fbe81a).
  "Davon's Amulet Store. (Default)": [1731, 1725, 1729, 1727, 1718],
};

// Stock tsps adds to a Wiki shop, placed before the Wiki's rows.
const EXTRA_STOCK = {
  // Ghosts Ahoy's Ectofuntus worship needs a bucket of slime (quest audit).
  "Port Phasmatys General Store": [{ id: 4286, amount: 10, restockTicks: 100 }],
};

// Per-item prices for currencies the shop's multipliers cannot price.
// ITEM_PRICES sets an item row's "price"; SHOP_PRICES writes a shop-level
// "prices" map, kept in the listed order.
const ITEM_PRICES = {
  // Theatre of Blood escape crystal (Night at the Theatre).
  "Mysterious Stranger (shop)": { 22517: 75000 },
};
const SHOP_PRICES = {
  // Stardust costs (Shooting Stars).
  "Dusuri's Star Shop": [
    [25539, 2000],
    [25547, 3000],
    [25537, 300],
    [25533, 150],
  ],
  // Ornate maul handle, 15 points.
  "Justine's stuff for the Last Shopper Standing": [[24229, 15]],
  // Perdu's fees (Wiki: Lost Property shop). Most of the stock is worth little or nothing,
  // and the diary rows are display items worth 0, so the multipliers can't price them.
  "Lost Property shop": [
    [4252, 4600], // Ectophial
    [2413, 23000], [2414, 23000], [2412, 23000], // God capes
    [3844, 12000], [12612, 14000], [12610, 14000], [12608, 14000], [3840, 12000], [3842, 12000], // God books
    [25818, 9500], // Book of the Dead
    [13660, 500], // Chronicle
    // Achievement diary rewards: Karamja, Ardougne, Falador, Fremennik, Kandarin, Desert,
    // Lumbridge & Draynor, Morytania, Varrock, Wilderness, Western Provinces, Kourend & Kebos.
    [1686, 200], [770, 200], [762, 200], [10510, 200], [6450, 200], [5573, 200],
    [5095, 200], [5093, 200], [5087, 200], [3981, 200], [3983, 200], [22803, 200],
    // Ghostly robes: hood, top, bottom, gloves, boots, cloak
    [6109, 15000], [6107, 45000], [6108, 43000], [6110, 13500], [6106, 13500], [6111, 15000],
    // Lunar equipment: staff, helm, torso, legs, gloves, boots, cape, amulet, ring
    [9084, 60000], [9096, 22000], [9097, 140000], [9098, 95000], [9099, 15000],
    [9100, 15000], [9101, 18000], [9102, 9000], [9104, 8000],
    [10887, 290000], // Barrelchest anchor
    [88, 9800], // Boots of lightness
    [1052, 1900], // Cape of Legends
    [10581, 25000], // Keris
    [4502, 10000], // Bearhead
    [11014, 6000], // Beacon ring
    [27021, 300000], // Colossal blade
    [11200, 115000], // Dwarven helmet
    [10828, 95000], // Helm of Neitiznot
    [22398, 30000], // Ivandis flail
    [10498, 7000], [10499, 7000], [22109, 7000], // Ava's attractor, accumulator, assembler
    [21793, 250000], [21795, 250000], [21791, 250000], // Imbued god capes
    [22400, 30000], // Drakan's medallion
    [27279, 350000], // Thread of Elidinis
    [30955, 350000], // Arkan blade
  ],
};

const INFINITE_STOCK = 2_000_000_000;

function parseArgs(argv) {
  let docs;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--docs") docs = argv[++i];
    else if (argv[i] === "--check") check = true;
  }
  return {
    docs: docs ? path.resolve(docs) : path.resolve(repoRoot, "..", "osrsreboxed-db", "docs"),
    check,
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** A stock amount, or null when the dump gives none. A listed 0 is a real entry: the shop shows
 * it out of stock and buys it from players (Gerrant's raw fish). */
function stockAmount(stock) {
  if (stock === "infinite") return INFINITE_STOCK;
  if (stock === null || stock === undefined || String(stock).trim() === "") return null;
  const value = Number(stock);
  return Number.isFinite(value) ? Math.floor(value) : null;
}

function currencyFor(name, info) {
  if (CURRENCY_OVERRIDES[name]) return CURRENCY_OVERRIDES[name];
  const raw = String(info?.currency ?? "coins").trim();
  return raw.toUpperCase();
}

function originalStock(name, items) {
  const stock = (EXTRA_STOCK[name] ?? []).map((entry) => ({ ...entry }));
  const prices = ITEM_PRICES[name] ?? {};
  for (const item of items ?? []) {
    const amount = stockAmount(item.stock);
    if (!Number.isInteger(item.id) || item.id <= 0 || amount === null || amount < 0) continue;
    const entry = { id: item.id, amount };
    const restock = Number(item.restock_time);
    if (Number.isFinite(restock) && restock > 0) entry.restockTicks = restock;
    if (prices[item.id] !== undefined) entry.price = prices[item.id];
    stock.push(entry);
  }
  const order = STOCK_ORDER[name];
  if (!order) return stock;
  const rank = (entry) => {
    const index = order.indexOf(entry.id);
    return index < 0 ? order.length : index;
  };
  return stock
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
    .map(({ entry }) => entry);
}

function npcInteractions(name, owners) {
  if (UNBOUND.has(name)) return [];
  const override = NPC_OVERRIDES[name] ?? {};
  const removed = new Set(override.remove ?? []);
  const bySlot = new Map();
  for (const owner of owners ?? []) {
    if (owner.option_source !== "click") continue;
    const slot = Number(owner.option_slot);
    if (!Number.isInteger(slot) || slot < 1) continue;
    const ids = bySlot.get(slot) ?? new Set();
    for (const id of owner.npc_ids ?? []) {
      if (Number.isInteger(id) && id >= 0 && !removed.has(id)) ids.add(id);
    }
    bySlot.set(slot, ids);
  }
  for (const [slot, ids] of Object.entries(override.add ?? {})) {
    const set = bySlot.get(Number(slot)) ?? new Set();
    for (const id of ids) set.add(id);
    bySlot.set(Number(slot), set);
  }
  return [...bySlot.entries()]
    .filter(([, ids]) => ids.size > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([optionSlot, ids]) => ({ npcIds: [...ids].sort((a, b) => a - b), optionSlot }));
}

// JSON.stringify, except that a Map is written as an object in insertion
// order (a plain object would sort its numeric item-ID keys).
function serialize(value) {
  if (value instanceof Map) {
    return `{${[...value]
      .map(([k, v]) => `${JSON.stringify(String(k))}:${serialize(v)}`)
      .join(",")}}`;
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function main() {
  const { docs, check } = parseArgs(process.argv.slice(2));
  const itemsByShopFile = path.join(docs, "shops-items-by-shop.json");
  if (!fs.existsSync(itemsByShopFile)) {
    console.error(`osrsreboxed shop dump not found: ${itemsByShopFile}`);
    process.exit(1);
  }

  const byShop = readJson(itemsByShopFile);
  const existing = readJson(shopsFile);

  const idByName = new Map();
  for (const shop of existing) {
    if (typeof shop?.name === "string" && Number.isInteger(shop?.id)) idByName.set(shop.name, shop.id);
  }
  let nextId = existing.reduce((max, shop) => Math.max(max, Number(shop?.id) ?? -1), -1) + 1;

  const rebuilt = [];
  const unmappedCurrencies = new Set();
  for (const [name, record] of Object.entries(byShop)) {
    // Shops gone from the game stay in the dump (shop_info.removed) but must not
    // be bound: they would take the Trade of the live shop on the same NPC.
    if (EXCLUDED.has(name) || REPLACED_BY_PLUGIN[name] || record.shop_info?.removed) continue;
    const currency = currencyFor(name, record.shop_info);
    if (!CURRENCY_OVERRIDES[name] && currency === "POINTS") unmappedCurrencies.add(name);
    const id = idByName.has(name) ? idByName.get(name) : nextId++;
    rebuilt.push({
      id,
      name,
      currency,
      originalStock: originalStock(name, record.items),
      ...(SHOP_PRICES[name] ? { prices: new Map(SHOP_PRICES[name]) } : {}),
      npcInteractions: npcInteractions(name, record.owners),
    });
  }

  // Keep core/legacy shops that the osrsreboxed dump does not describe. A dump
  // shop skipped above is described, so its old entry is dropped, not kept.
  for (const shop of existing) {
    if (!byShop[shop.name]) rebuilt.push(shop);
  }
  rebuilt.sort((a, b) => a.id - b.id);

  // Bulk data files keep one record per line so diffs stay readable.
  const output = `[\n${rebuilt.map((shop) => `  ${serialize(shop)}`).join(",\n")}\n]\n`;
  const current = fs.readFileSync(shopsFile, "utf8");

  if (check) {
    console.log(output === current ? "shops.json is up to date" : "shops.json would change");
  } else {
    fs.writeFileSync(shopsFile, output);
    console.log(`Wrote ${rebuilt.length} shops to ${path.relative(repoRoot, shopsFile)}`);
  }
  if (unmappedCurrencies.size) {
    console.warn(
      `Unmapped "Points" currencies (register a concrete key): ${[...unmappedCurrencies].join(", ")}`
    );
  }
}

main();
