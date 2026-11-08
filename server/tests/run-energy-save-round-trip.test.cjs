// Run after `yarn build`: node --test tests/run-energy-save-round-trip.test.cjs
// Run energy is held in units (0-10,000) and saved as a percent (units / 100). Loading the percent back must give the
// same units: floor(0.29 * 100) was 28, one unit lost (and compounding) on 573 of the 10,001 values, every relog.
// Real engine: real Players through PlayerSave.fromPlayer, a JSON round trip and applyToPlayer.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

let persistence;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  // The JSON persistence's own replacer, reviver and hydration, as a save to disk and a login take.
  const Json = require("../plugins/persistence/JsonPlayerPersistence.plugin");
  Json.register({ getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager, setPlayerPersistence() {}, log() {} });
  persistence = new Json.JsonPlayerPersistence();
});

function player(name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername(name);
  return p;
}

test("every run energy value survives a save and load unit for unit", () => {
  const lost = [];
  for (let units = 0; units <= 10000; units++) {
    const before = player("energysave");
    before.setRunEnergyUnits(units);
    const json = JSON.stringify(PlayerSave.fromPlayer(before), persistence.replacer.bind(persistence));
    const after = player("energysave");
    persistence.hydratePlayerSave(JSON.parse(json, persistence.reviver.bind(persistence))).applyToPlayer(after);
    if (after.getRunEnergyUnits() !== units) lost.push([units, after.getRunEnergyUnits()]);
  }
  assert.deepEqual(lost.slice(0, 5), [], `${lost.length} values changed`);
});

test("a fractional percent still floors to its unit", () => {
  const p = player("energyfloor");
  p.setRunEnergy(45.678);
  assert.equal(p.getRunEnergyUnits(), 4567);
  p.setRunEnergy(29);
  assert.equal(p.getRunEnergyUnits(), 2900);
});
