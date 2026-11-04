const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const CampDiary = require("../plugins/achievements/diaries/ArdougneCombatTrainingCampDiary.plugin");

const core = PluginManager.getCoreApi();
let biohazardComplete = true;
const credits = [];
const hooks = {};

CampDiary.register({
  core,
  registerArea(area) {
    area.pluginName = "ArdougneCombatTrainingCampDiaryTest";
    AreaManager.areas.push(area);
  },
  onPlayerDeath: (handler) => { hooks.death = handler; },
  onPlayerLogout: (handler) => { hooks.logout = handler; },
  onPlayerDisconnect: (handler) => { hooks.disconnect = handler; },
  emitCustomEvent: (name, request) => {
    if (name === "quest:is-complete" && request.key === "biohazard") request.complete = biohazardComplete;
    if (name === "diary:task") credits.push(request);
  },
});

let index = 2000;
function actor(x, y) {
  const player = new Player(null, new core.Location(x, y, 0));
  player.setIndex(index++);
  player.setUsername("ardougne-camp-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.setRunEnergy(100);
  player.setMultiIcon = () => {};
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  AreaManager.process(player);
  return player;
}

function move(player, x, y, run = false) {
  moveAlong(player, [[x, y]], run);
}

function moveAlong(player, steps, run = false) {
  const movement = player.getMovementQueue();
  movement.beginCycle();
  player.setRunning(run);
  movement.validatedStep = (_current, next) => next;
  for (const [x, y] of steps) movement.addSteps(new core.Location(x, y, 0));
  movement.process();
  AreaManager.process(player);
}

function credited(player) {
  return credits.some((event) => event.player === player);
}

test("Ardougne Easy camp task requires a live public step through the gate after Biohazard", async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  credits.length = 0;
  biohazardComplete = true;
  const walker = actor(2517, 3356);
  move(walker, 2517, 3357);
  assert.equal(credited(walker), true, "a northward walking step through the gate counts");

  credits.length = 0;
  const runner = actor(2518, 3355);
  move(runner, 2518, 3357, true);
  assert.deepEqual([runner.getLocation().getX(), runner.getLocation().getY()], [2518, 3357]);
  assert.equal(credited(runner), true, "a two-step run that crosses the gate counts");

  credits.length = 0;
  const approach = actor(2517, 3354);
  moveAlong(approach, [[2517, 3355], [2517, 3356]], true);
  assert.equal(credited(approach), false, "running through the south edge does not count before crossing");
  move(approach, 2517, 3357);
  assert.equal(credited(approach), true, "the area retains the approacher's position for the next gate step");

  credits.length = 0;
  const northThenDiagonal = actor(2517, 3356);
  moveAlong(northThenDiagonal, [[2517, 3357], [2518, 3358]], true);
  assert.deepEqual([northThenDiagonal.getLocation().getX(), northThenDiagonal.getLocation().getY()], [2518, 3358]);
  assert.deepEqual([
    [northThenDiagonal.getWalkingDirection().getX(), northThenDiagonal.getWalkingDirection().getY()],
    [northThenDiagonal.getRunningDirection().getX(), northThenDiagonal.getRunningDirection().getY()],
  ], [[0, 1], [1, 1]]);
  assert.equal(credited(northThenDiagonal), true, "a cardinal gate crossing followed by a diagonal running step counts");

  credits.length = 0;
  const diagonalThenNorth = actor(2517, 3355);
  moveAlong(diagonalThenNorth, [[2518, 3356], [2518, 3357]], true);
  assert.deepEqual([diagonalThenNorth.getLocation().getX(), diagonalThenNorth.getLocation().getY()], [2518, 3357]);
  assert.deepEqual([
    [diagonalThenNorth.getWalkingDirection().getX(), diagonalThenNorth.getWalkingDirection().getY()],
    [diagonalThenNorth.getRunningDirection().getX(), diagonalThenNorth.getRunningDirection().getY()],
  ], [[1, 1], [0, 1]]);
  assert.equal(credited(diagonalThenNorth), true, "a diagonal running step before the cardinal gate crossing counts");

  credits.length = 0;
  biohazardComplete = false;
  const unfinished = actor(2517, 3356);
  move(unfinished, 2517, 3357);
  assert.equal(credited(unfinished), false, "Biohazard must be complete");

  credits.length = 0;
  biohazardComplete = true;
  const lateral = actor(2516, 3356);
  move(lateral, 2517, 3357);
  assert.equal(credited(lateral), false, "a diagonal move from outside the gate lane does not count");

  credits.length = 0;
  const teleported = actor(2517, 3356);
  teleported.moveTo(new core.Location(2517, 3357, 0));
  AreaManager.process(teleported);
  assert.equal(credited(teleported), false, "teleporting across the gate does not count");

  credits.length = 0;
  const loggedInside = actor(2517, 3357);
  AreaManager.process(loggedInside);
  assert.equal(credited(loggedInside), false, "logging in inside the camp does not count");

  credits.length = 0;
  const leaving = actor(2517, 3357);
  move(leaving, 2517, 3356);
  assert.equal(credited(leaving), false, "leaving through the gate does not count");

  credits.length = 0;
  const dead = actor(2517, 3356);
  hooks.death({ player: dead });
  move(dead, 2517, 3357);
  assert.equal(credited(dead), false, "death clears the prior-position sample");

  credits.length = 0;
  const loggedOut = actor(2517, 3356);
  hooks.logout({ player: loggedOut });
  move(loggedOut, 2517, 3357);
  assert.equal(credited(loggedOut), false, "logout clears the prior-position sample");

  credits.length = 0;
  const privateArea = actor(2517, 3356);
  privateArea.getPrivateArea = () => ({});
  move(privateArea, 2517, 3357);
  assert.equal(credited(privateArea), false, "private instances do not count");
});
