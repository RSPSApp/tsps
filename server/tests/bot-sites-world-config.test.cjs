// Run after `yarn build`: node --test tests/bot-sites-world-config.test.cjs
// world.json / world.local.json pluginConfig "PlayerBots:sites" overrides bot-sites.json sites and adds new ones
// (plugins/bots/brain/Sites.PlayerBots.js, server/docs/bot-combat-training.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { readBotSites, siteOverrides, applySiteOverrides } = require("../plugins/bots/brain/Sites.PlayerBots");

const SITES = path.resolve(__dirname, "..", "data", "definitions", "bot-sites.json");

function quietly(fn) {
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = warn;
  }
}

test("PlayerBots:sites switches the named sites; the rest keep their own enabled", () => {
  const file = { sites: [{ id: "lumbridge", enabled: false }, { id: "edge_low", enabled: true }, { id: "seers", enabled: false }] };
  applySiteOverrides(file, siteOverrides({ lumbridge: { enabled: true }, edge_low: { enabled: false } }));
  assert.deepEqual(file.sites.map((site) => [site.id, site.enabled]), [["lumbridge", true], ["edge_low", false], ["seers", false]]);
});

test("an object replaces just the properties it names, each whole, and never the id", () => {
  const file = { sites: [{ id: "lumbridge", enabled: false, x: 3222, y: 3218, bots: { woodcutting: 35, mining: 30 } }] };
  applySiteOverrides(file, siteOverrides({ lumbridge: { id: "elsewhere", enabled: true, bots: { woodcutting: 10 } } }));
  assert.deepEqual(file.sites[0], { id: "lumbridge", enabled: true, x: 3222, y: 3218, bots: { woodcutting: 10 } });
});

test("an id bot-sites.json doesn't have is a new site", () => {
  const file = { sites: [{ id: "lumbridge", enabled: false }] };
  applySiteOverrides(file, siteOverrides({ draynor: { enabled: true, x: 3093, y: 3244, bots: { fishing: 20 } } }));
  assert.deepEqual(file.sites[1], { id: "draynor", enabled: true, x: 3093, y: 3244, bots: { fishing: 20 } });
});

test("no PlayerBots:sites leaves bot-sites.json as it ships", () => {
  assert.equal(siteOverrides({}).size, 0);
});

test("a value that isn't an object, or a new site without x and y, is warned about and ignored", () => {
  const { result, warnings } = quietly(() => {
    const overrides = siteOverrides({ lumbridge: true, varrock: { enabled: true }, falador: [false], atlantis: { enabled: true } });
    return applySiteOverrides({ sites: [{ id: "lumbridge", enabled: false }, { id: "varrock", enabled: false }, { id: "falador", enabled: true }] }, overrides);
  });
  assert.deepEqual(result.sites.map((site) => [site.id, site.enabled]), [["lumbridge", false], ["varrock", true], ["falador", true]]);
  assert.ok(warnings.some((line) => line.includes("PlayerBots:sites.lumbridge")));
  assert.ok(warnings.some((line) => line.includes("PlayerBots:sites.falador")));
  assert.ok(warnings.some((line) => line.includes("PlayerBots:sites.atlantis") && line.includes("x and y")));
  assert.equal(quietly(() => siteOverrides(["lumbridge"]).size).result, 0);
});

test("the shipped bot-sites.json: skilling sites on and the PvP pens off, as a deployment would set it", () => {
  const ids = ["lumbridge", "edge_low", "edge_mid", "edge_mains", "varrock_ditch"];
  const on = (id) => !id.startsWith("edge") && id !== "varrock_ditch";
  const config = Object.fromEntries(ids.map((id) => [id, { enabled: on(id) }]));
  const { result, warnings } = quietly(() => readBotSites(SITES, config));
  assert.deepEqual(warnings, []);
  assert.equal(result.sites.length, ids.length, "every id is a real site, so none was added");
  const enabled = Object.fromEntries(result.sites.map((site) => [site.id, site.enabled]));
  assert.deepEqual(ids.map((id) => enabled[id]), ids.map(on));
  assert.ok(result.sites.filter((site) => site.pvp).every((site) => site.enabled === false));
});
