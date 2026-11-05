import { buildPriceData, writePriceFiles } from "./price-data.mjs";

const pricesDestination = new URL("../data/definitions/item-prices.json", import.meta.url);
const pricesTemporary = new URL("../data/definitions/item-prices.json.tmp", import.meta.url);
const marketDestination = new URL("../plugins/interface/data/grand-exchange.json", import.meta.url);
const marketTemporary = new URL("../plugins/interface/data/grand-exchange.json.tmp", import.meta.url);
const headers = { "User-Agent": "elvarg-typescript item-price fetcher" };
const signal = AbortSignal.timeout(30_000);

const ENDPOINTS = {
  latest: "https://prices.runescape.wiki/api/v2/osrs/latest",
  day: "https://prices.runescape.wiki/api/v2/osrs/24h",
  mapping: "https://prices.runescape.wiki/api/v2/osrs/mapping",
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

const [latestPayload, dayPayload, mapping] = await Promise.all([
  fetchJson("latest", ENDPOINTS.latest),
  fetchJson("24h", ENDPOINTS.day),
  fetchJson("mapping", ENDPOINTS.mapping),
]);

const latest = requireData("latest", latestPayload);
const day = requireData("24h", dayPayload);
if (!Object.keys(latest).length) throw new Error("Latest price API returned no item prices");
if (!Array.isArray(mapping) || !mapping.length) throw new Error("Mapping API returned no items");

if (!mapping.some((item) => item && Number.isSafeInteger(item.id))) {
  throw new Error("Mapping API returned no item ids");
}
const { prices, market, mappingCount } = buildPriceData(latest, day, mapping);

await writePriceFiles(prices, market, {
  prices: pricesDestination,
  pricesTemporary,
  market: marketDestination,
  marketTemporary,
});
console.info(
  `Saved ${Object.keys(prices).length} prices to ${pricesDestination.pathname} and ` +
    `${Object.keys(market).length} GE quotes to ${marketDestination.pathname} ` +
    `(latest=${Object.keys(latest).length}, 24h=${Object.keys(day).length}, mapping=${mappingCount})`
);
