#!/usr/bin/env node
/**
 * Regenerate server/data/definitions/shops.json from the osrsreboxed shop dumps.
 *
 * Inputs (from the osrsreboxed-db checkout):
 *   docs/shops-items-by-shop.json  - shop stock, currency and resolved owners
 *   docs/shops-by-npc.json         - which NPC option opens each shop (optional)
 *
 * The script preserves the ids of shops already in shops.json (ids are
 * referenced by npc_interactions.json and plugin shop sources) and assigns new
 * ids above the current maximum. Entries not covered by the osrsreboxed dump
 * (the legacy core shops) are kept as they are.
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
  "Bounty Hunter Shop (historical)": "BOUNTY HUNTER POINTS",
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

function stockAmount(stock) {
  if (stock === "infinite") return INFINITE_STOCK;
  const value = Number(stock);
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

function currencyFor(name, info) {
  if (CURRENCY_OVERRIDES[name]) return CURRENCY_OVERRIDES[name];
  const raw = String(info?.currency ?? "coins").trim();
  return raw.toUpperCase();
}

function originalStock(items) {
  const stock = [];
  for (const item of items ?? []) {
    const amount = stockAmount(item.stock);
    if (!Number.isInteger(item.id) || item.id <= 0 || amount <= 0) continue;
    const entry = { id: item.id, amount };
    const restock = Number(item.restock_time);
    if (Number.isFinite(restock) && restock > 0) entry.restockTicks = restock;
    stock.push(entry);
  }
  return stock;
}

function npcInteractions(owners) {
  const bySlot = new Map();
  for (const owner of owners ?? []) {
    if (owner.option_source !== "click") continue;
    const slot = Number(owner.option_slot);
    if (!Number.isInteger(slot) || slot < 1) continue;
    const ids = bySlot.get(slot) ?? new Set();
    for (const id of owner.npc_ids ?? []) {
      if (Number.isInteger(id) && id >= 0) ids.add(id);
    }
    bySlot.set(slot, ids);
  }
  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([optionSlot, ids]) => ({ npcIds: [...ids].sort((a, b) => a - b), optionSlot }));
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
    if (EXCLUDED.has(name)) continue;
    const currency = currencyFor(name, record.shop_info);
    if (!CURRENCY_OVERRIDES[name] && currency === "POINTS") unmappedCurrencies.add(name);
    const id = idByName.has(name) ? idByName.get(name) : nextId++;
    rebuilt.push({
      id,
      name,
      currency,
      originalStock: originalStock(record.items),
      npcInteractions: npcInteractions(record.owners),
    });
  }

  // Keep core/legacy shops that the osrsreboxed dump does not describe.
  for (const shop of existing) {
    if (!byShop[shop.name]) rebuilt.push(shop);
  }
  rebuilt.sort((a, b) => a.id - b.id);

  const output = `${JSON.stringify(rebuilt, null, 2)}\n`;
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
