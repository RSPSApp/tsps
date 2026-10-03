import { writeFile, rename } from "node:fs/promises";

const destination = new URL("../data/definitions/item-prices.json", import.meta.url);
const temporary = new URL("../data/definitions/item-prices.json.tmp", import.meta.url);
const response = await fetch("https://prices.runescape.wiki/api/v2/osrs/latest", {
  headers: { "User-Agent": "elvarg-typescript item-price fetcher" },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Price fetch failed: HTTP ${response.status}`);
const prices = await response.json();
if (!prices?.data || typeof prices.data !== "object" || Array.isArray(prices.data) || !Object.keys(prices.data).length) {
  throw new Error("Price API returned no item prices");
}
await writeFile(temporary, JSON.stringify(prices));
await rename(temporary, destination);
console.info(`Saved ${Object.keys(prices.data).length} item prices to ${destination.pathname}`);
