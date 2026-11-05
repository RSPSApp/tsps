const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
let buildPriceData;
let writePriceFiles;

before(async () => {
  ({ buildPriceData, writePriceFiles } = await import("../scripts/price-data.mjs"));
});

test("a traded average cannot invert the 3,769 and 1,341 latest quotes", () => {
  const result = buildPriceData(
    { 1293: { high: 3_769, highTime: 100, low: 1_341, lowTime: 101 } },
    { 1293: { avgHighPrice: 197, avgLowPrice: 1_341, highPriceVolume: 12, lowPriceVolume: 11 } },
    [{ id: 1293, limit: 125 }]
  );

  assert.deepEqual(result.prices[1293], { high: 3_769, highTime: 100, low: 1_341, lowTime: 101 });
  assert.deepEqual(result.market[1293], { volume: 23, limit: 125 });
});

test("a well-traded 1,341 quote can use its 197 average", () => {
  const result = buildPriceData(
    { 1293: { high: 1_341, highTime: 100, low: 180, lowTime: 101 } },
    { 1293: { avgHighPrice: 197, avgLowPrice: 175, highPriceVolume: 10, lowPriceVolume: 10 } },
    []
  );

  assert.deepEqual(result.prices[1293], { high: 197, highTime: null, low: 180, lowTime: 101 });
});

test("fractional 24-hour averages are rounded to a usable integer price", () => {
  const result = buildPriceData(
    { 1293: { high: 1_000, highTime: 100, low: 100, lowTime: 101 } },
    { 1293: { avgHighPrice: 134.6, avgLowPrice: 99.5, highPriceVolume: 10, lowPriceVolume: 10 } },
    []
  );

  assert.deepEqual(result.prices[1293], { high: 135, highTime: null, low: 100, lowTime: 101 });
});

test("low volume does not replace a latest quote", () => {
  const result = buildPriceData(
    { 1293: { high: 1_000, highTime: 100, low: 100, lowTime: 101 } },
    { 1293: { avgHighPrice: 100, avgLowPrice: 99, highPriceVolume: 9, lowPriceVolume: 100 } },
    []
  );

  assert.deepEqual(result.prices[1293], { high: 1_000, highTime: 100, low: 100, lowTime: 101 });
});

test("the paired averages cannot introduce an inversion or widen the spread", () => {
  const result = buildPriceData(
    { 1293: { high: 100, highTime: 100, low: 90, lowTime: 101 } },
    { 1293: { avgHighPrice: 500, avgLowPrice: 600, highPriceVolume: 20, lowPriceVolume: 20 } },
    []
  );

  assert.ok(result.prices[1293].high >= result.prices[1293].low);
  assert.ok(result.prices[1293].high - result.prices[1293].low <= 10);
  assert.deepEqual(result.prices[1293], { high: 100, highTime: 100, low: 90, lowTime: 101 });
});

test("an inverted live pair stays unchanged", () => {
  const result = buildPriceData(
    { 1293: { high: 100, highTime: 100, low: 1_000, lowTime: 101 } },
    { 1293: { avgHighPrice: 2_000, avgLowPrice: 80, highPriceVolume: 20, lowPriceVolume: 20 } },
    []
  );

  assert.deepEqual(result.prices[1293], { high: 100, highTime: 100, low: 1_000, lowTime: 101 });
});

test("both well-traded outlier sides use their averages together", () => {
  const result = buildPriceData(
    { 1293: { high: 10_000, highTime: 100, low: 10, lowTime: 101 } },
    { 1293: { avgHighPrice: 1_000, avgLowPrice: 100, highPriceVolume: 10, lowPriceVolume: 10 } },
    []
  );

  assert.deepEqual(result.prices[1293], { high: 1_000, highTime: null, low: 100, lowTime: null });
});

test("a decimal low-side average is rounded when volume meets the threshold", () => {
  const result = buildPriceData(
    { 1293: { high: 10_000, highTime: 100, low: 100, lowTime: 101 } },
    { 1293: { avgHighPrice: 10_000, avgLowPrice: 1_000.6, highPriceVolume: 0, lowPriceVolume: 10 } },
    []
  );

  assert.deepEqual(result.prices[1293], { high: 10_000, highTime: 100, low: 1_001, lowTime: null });
});

test("an exact fivefold difference stays below the outlier threshold", () => {
  const result = buildPriceData(
    { 1293: { high: 500, highTime: 100, low: 90, lowTime: 101 } },
    { 1293: { avgHighPrice: 100, avgLowPrice: 90, highPriceVolume: 10, lowPriceVolume: 10 } },
    []
  );

  assert.deepEqual(result.prices[1293], { high: 500, highTime: 100, low: 90, lowTime: 101 });
});

test("an average that rounds to zero is not a quote", () => {
  const result = buildPriceData(
    { 1293: { high: 1_000, highTime: 100, low: 100, lowTime: 101 } },
    { 1293: { avgHighPrice: 0.499, avgLowPrice: 100, highPriceVolume: 100, lowPriceVolume: 100 } },
    []
  );

  assert.deepEqual(result.prices[1293], { high: 1_000, highTime: 100, low: 100, lowTime: 101 });
});

test("missing and negative prices do not become quotes", () => {
  const result = buildPriceData(
    { 1293: { high: -5, highTime: 100 } },
    { 1293: { avgHighPrice: 200, avgLowPrice: -10, highPriceVolume: 100, lowPriceVolume: 100 } },
    []
  );

  assert.equal(result.prices[1293], undefined);
});

test("ordinary latest prices and their timestamps remain unchanged", () => {
  const result = buildPriceData(
    { 1293: { high: 78, highTime: 100, low: 72, lowTime: 101 } },
    { 1293: { avgHighPrice: 80, avgLowPrice: 70, highPriceVolume: 12, lowPriceVolume: 8 } },
    [{ id: 1293, limit: 125 }]
  );

  assert.deepEqual(result.prices[1293], { high: 78, highTime: 100, low: 72, lowTime: 101 });
});

test("empty or invalid generated tables leave existing output files untouched", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "price-data-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const destinations = {
    prices: path.join(directory, "prices.json"),
    pricesTemporary: path.join(directory, "prices.json.tmp"),
    market: path.join(directory, "market.json"),
    marketTemporary: path.join(directory, "market.json.tmp"),
  };
  await writeFile(destinations.prices, "existing prices");
  await writeFile(destinations.market, "existing market");

  const validPrices = { 1: { high: 10, highTime: 1, low: null, lowTime: null } };
  const validMarket = { 1: { volume: 10, limit: 5 } };
  const invalidTables = [
    [{}, validMarket],
    [{ 1: { high: 0, highTime: null, low: null, lowTime: null } }, validMarket],
    [validPrices, {}],
    [validPrices, { 1: { volume: -1, limit: 5 } }],
  ];

  for (const [prices, market] of invalidTables) {
    await assert.rejects(writePriceFiles(prices, market, destinations), /Invalid generated/);
    assert.equal(await readFile(destinations.prices, "utf8"), "existing prices");
    assert.equal(await readFile(destinations.market, "utf8"), "existing market");
  }
});
