import { buildGuidePrices, buildPriceData, writeGuidePriceFile, writePriceFiles } from "./price-data.mjs";

const pricesDestination = new URL("../data/definitions/item-prices.json", import.meta.url);
const pricesTemporary = new URL("../data/definitions/item-prices.json.tmp", import.meta.url);
const guideDestination = new URL("../data/definitions/item-guide-prices.json", import.meta.url);
const guideTemporary = new URL("../data/definitions/item-guide-prices.json.tmp", import.meta.url);
const marketDestination = new URL("../plugins/interface/data/grand-exchange.json", import.meta.url);
const marketTemporary = new URL("../plugins/interface/data/grand-exchange.json.tmp", import.meta.url);
const headers = { "User-Agent": "elvarg-typescript item-price fetcher" };
const signal = AbortSignal.timeout(30_000);

const ENDPOINTS = {
  latest: "https://prices.runescape.wiki/api/v2/osrs/latest",
  day: "https://prices.runescape.wiki/api/v2/osrs/24h",
  mapping: "https://prices.runescape.wiki/api/v2/osrs/mapping",
  // The official guide prices (examine and trade values), by name, and the Wiki's name-to-id table.
  guide: "https://oldschool.runescape.wiki/?title=Module:GEPrices/data.json&action=raw",
  guideIds: "https://oldschool.runescape.wiki/?title=Module:GEIDs/data.json&action=raw",
};

async function fetchJson(label, url) {
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw new Error(`${label} fetch failed: HTTP ${response.status}`);
  return response.json();
}

function requireData(label, payload) {
  if (!payload?.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
    throw new Error(`${label} API returned no data object`);
  }
  return payload.data;
}

const [latestPayload, dayPayload, mapping, guidePayload, guideIds] = await Promise.all([
  fetchJson("latest", ENDPOINTS.latest),
  fetchJson("24h", ENDPOINTS.day),
  fetchJson("mapping", ENDPOINTS.mapping),
  fetchJson("guide prices", ENDPOINTS.guide),
  fetchJson("guide ids", ENDPOINTS.guideIds),
]);

const latest = requireData("latest", latestPayload);
const day = requireData("24h", dayPayload);
if (!Object.keys(latest).length) throw new Error("Latest price API returned no item prices");
if (!Array.isArray(mapping) || !mapping.length) throw new Error("Mapping API returned no items");

if (!mapping.some((item) => item && Number.isSafeInteger(item.id))) {
  throw new Error("Mapping API returned no item ids");
}
const { prices, market, mappingCount } = buildPriceData(latest, day, mapping);
const { guide, updated } = buildGuidePrices(guidePayload, guideIds);
if (!Object.keys(guide).length) throw new Error("Guide price modules returned no item guide prices");

await writePriceFiles(prices, market, {
  prices: pricesDestination,
  pricesTemporary,
  market: marketDestination,
  marketTemporary,
});
await writeGuidePriceFile(guide, updated, guideDestination, guideTemporary);
console.info(
  `Saved ${Object.keys(prices).length} prices to ${pricesDestination.pathname}, ` +
    `${Object.keys(market).length} GE quotes to ${marketDestination.pathname} and ` +
    `${Object.keys(guide).length} guide prices to ${guideDestination.pathname} ` +
    `(latest=${Object.keys(latest).length}, 24h=${Object.keys(day).length}, mapping=${mappingCount})`
);
