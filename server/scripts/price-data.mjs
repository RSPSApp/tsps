import { writeFile, rename } from "node:fs/promises";

const safeInt = (value) => (Number.isSafeInteger(value) ? value : null);
const positiveInt = (value) => {
  const number = safeInt(value);
  return number != null && number > 0 ? number : null;
};
const positiveAverage = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
};
const volume = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

const OUTLIER_RATIO = 5;
const MIN_SIDE_VOLUME = 10;

function isOutlier(price, average) {
  return price != null && average != null && (price > average * OUTLIER_RATIO || price * OUTLIER_RATIO < average);
}

function sideQuote(livePrice, liveTime, averagePrice, averageVolume) {
  const price = positiveInt(livePrice);
  const average = positiveAverage(averagePrice);
  return {
    price,
    time: price == null ? null : safeInt(liveTime),
    replacement: price != null && average != null && volume(averageVolume) >= MIN_SIDE_VOLUME && isOutlier(price, average)
      ? average
      : null,
  };
}

function isSafePair(high, low, nextHigh, nextLow) {
  if (high == null || low == null || nextHigh == null || nextLow == null) return true;
  if (high >= low && nextHigh < nextLow) return false;
  return Math.abs(nextHigh - nextLow) <= Math.abs(high - low);
}

function guardPair(high, low) {
  // Keep an inversion from the live feed as-is. This guard prevents new inversions; it does not repair existing ones.
  if (high.price != null && low.price != null && high.price < low.price) {
    return {
      high: { price: high.price, time: high.time },
      low: { price: low.price, time: low.time },
    };
  }

  const nextHigh = high.replacement ?? high.price;
  const nextLow = low.replacement ?? low.price;
  if (isSafePair(high.price, low.price, nextHigh, nextLow)) {
    return {
      high: { price: nextHigh, time: high.replacement == null ? high.time : null },
      low: { price: nextLow, time: low.replacement == null ? low.time : null },
    };
  }

  const options = [];
  if (high.replacement != null && isSafePair(high.price, low.price, high.replacement, low.price)) {
    options.push({ side: "high", price: high.replacement, spread: Math.abs(high.replacement - low.price) });
  }
  if (low.replacement != null && isSafePair(high.price, low.price, high.price, low.replacement)) {
    options.push({ side: "low", price: low.replacement, spread: Math.abs(high.price - low.replacement) });
  }
  options.sort((a, b) => a.spread - b.spread || (a.side === "high" ? -1 : 1));
  const choice = options[0];
  if (choice?.side === "high") high = { ...high, price: choice.price, time: null };
  if (choice?.side === "low") low = { ...low, price: choice.price, time: null };
  return {
    high: { price: high.price, time: high.time },
    low: { price: low.price, time: low.time },
  };
}

export function buildPriceData(latest, day, mapping) {
  const prices = {};
  const market = {};
  const mapped = new Map();
  for (const item of mapping) {
    if (item && Number.isSafeInteger(item.id)) mapped.set(item.id, item);
  }

  const ids = [...new Set([...Object.keys(latest).map(Number), ...mapped.keys()])]
    .filter((id) => Number.isSafeInteger(id) && id >= 0)
    .sort((a, b) => a - b);

  for (const id of ids) {
    const live = latest[id] ?? {};
    const recent = day[id] ?? {};
    const item = mapped.get(id);
    const guarded = guardPair(
      sideQuote(live.high, live.highTime, recent.avgHighPrice, recent.highPriceVolume),
      sideQuote(live.low, live.lowTime, recent.avgLowPrice, recent.lowPriceVolume)
    );
    if (guarded.high.price != null || guarded.low.price != null) {
      prices[id] = {
        high: guarded.high.price,
        highTime: guarded.high.time,
        low: guarded.low.price,
        lowTime: guarded.low.time,
      };
    }

    const traded = Math.min(
      Number.MAX_SAFE_INTEGER,
      volume(recent.highPriceVolume) + volume(recent.lowPriceVolume)
    );
    const limit = item && Number.isSafeInteger(item.limit) && item.limit > 0 ? item.limit : 0;
    if (traded > 0 || limit > 0) market[id] = { volume: traded, limit };
  }

  return { prices, market, mappingCount: mapped.size };
}

function validatePriceData(prices, market) {
  if (!prices || typeof prices !== "object" || Array.isArray(prices) || Object.keys(prices).length === 0) {
    throw new Error("Invalid generated price data: no item prices");
  }
  for (const [id, quote] of Object.entries(prices)) {
    const validSide = (price, time) =>
      (price == null || (Number.isSafeInteger(price) && price > 0)) &&
      (price != null || time == null) &&
      (time == null || Number.isSafeInteger(time));
    if (
      !/^(0|[1-9]\d*)$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      !quote ||
      typeof quote !== "object" ||
      Array.isArray(quote) ||
      (quote.high == null && quote.low == null) ||
      !validSide(quote.high, quote.highTime) ||
      !validSide(quote.low, quote.lowTime)
    ) {
      throw new Error(`Invalid generated price data: invalid quote for item ${id}`);
    }
  }

  if (!market || typeof market !== "object" || Array.isArray(market) || Object.keys(market).length === 0) {
    throw new Error("Invalid generated market data: no item market records");
  }
  for (const [id, record] of Object.entries(market)) {
    if (
      !/^(0|[1-9]\d*)$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      !Number.isSafeInteger(record.volume) ||
      record.volume < 0 ||
      !Number.isSafeInteger(record.limit) ||
      record.limit < 0
    ) {
      throw new Error(`Invalid generated market data: invalid record for item ${id}`);
    }
  }
}

async function writeJson(destination, temporary, payload) {
  await writeFile(temporary, JSON.stringify(payload));
  await rename(temporary, destination);
}

export async function writePriceFiles(prices, market, destinations) {
  validatePriceData(prices, market);
  await writeJson(destinations.prices, destinations.pricesTemporary, { data: prices });
  await writeJson(destinations.market, destinations.marketTemporary, { data: market });
}
