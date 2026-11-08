// Run after `yarn build`: node --test tests/sleeping-giants-cutscene-walk.test.cjs
// Sleeping Giants' intro walks the player one tile a tick (rsprox recording 96: 3367,11484 on tick 3 to 3367,11489
// on tick 8). A real client sends interaction_stop before every walk click, which clears the movement queue; clicks,
// keyboard movement and NPC/object clicks must not change the walk. Real engine: every plugin loaded, a real Player
// in the World, native packets through ClientConnection, one World.process per tick.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let next = 9120;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** Starts the intro cutscene for a fresh player and returns their y after each of `ticks` ticks. */
async function introWalk(t, inputs, ticks = 14, woahInputs = null) {
  const channel = { kind: "test", binaryTransport: true, remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session);
  session.setPlayer(p);
  p.setUsername("sgwalk" + next++); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3368, 3152, 0)); p.setNeedsPlacement(false); p.setRunning(false);
  // Native registration, mechanics and sync; account-file I/O is outside the fixture.
  t.mock.method(p, "onAdd", () => {}); t.mock.method(p, "onRemove", () => {});
  const c = new ClientConnection(channel); c.player = p;
  session.setTurnPacketProcessor(() => c.processTurnPackets()); // as the login path wires it: packets act inside the player's turn
  assert.equal(core.World.getPlayers().add(p), true);
  core.World.refreshActiveRegions();
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.TaskManager.cancelTasks(p);
    core.World.getPlayers().remove(p); core.World.refreshActiveRegions();
  });
  PM.emitCustomEvent("npc-dialogue:hook", { player: p, hook: "quest:sleeping-giants:start" });
  PM.emitCustomEvent("npc-dialogue:action", { player: p, npcId: core.NpcIdentifiers.KOVAC, stepId: "Y4oYGg", kind: "dialogue" });
  const ys = [];
  for (let tick = 0; tick < ticks; tick++) {
    if (inputs[tick]) await c.dispatch(inputs[tick]);
    core.World.process();
    session.flushPackets();
    ys.push(p.getLocation().getY());
  }
  if (woahInputs) {
    // "Woah... What is this place?" sends the player four tiles back (recording 96 ticks 10113-10116).
    const line = { player: p, npcId: core.NpcIdentifiers.KOVAC, text: "Woah... What is this place?", after: null };
    PM.emitCustomEvent("npc-dialogue:line", line);
    line.after();
    for (let tick = 0; tick < 6; tick++) {
      if (woahInputs[tick]) await c.dispatch(woahInputs[tick]);
      core.World.process();
      session.flushPackets();
      ys.push(p.getLocation().getY());
    }
  }
  return { ys, x: p.getLocation().getX() };
}

const STOP_AND_WALK = [{ type: "interaction_stop" }, { type: "move", worldX: 3372, worldY: 11486, modifierFlags: 0 }];

test("the intro walk reaches 3367,11489 on tick 8 with no input", async (t) => {
  const { ys, x } = await introWalk(t, {});
  assert.equal(x, 3367);
  assert.equal(ys[1], 11483, "still on the landing tile until tick 3");
  assert.equal(ys[2], 11484, "the first step, a diagonal, on tick 3");
  assert.equal(ys[7], 11489, "one tile a tick");
});

test("walk clicks, interaction_stop, keyboard and NPC/object clicks do not change the walk", async (t) => {
  const baseline = await introWalk(t, {});
  const everyTick = {};
  for (let tick = 3; tick <= 9; tick++) everyTick[tick] = STOP_AND_WALK;
  assert.deepEqual((await introWalk(t, everyTick)).ys, baseline.ys, "a click every tick");
  const stopOnly = {};
  for (let tick = 3; tick <= 9; tick++) stopOnly[tick] = [{ type: "interaction_stop" }];
  assert.deepEqual((await introWalk(t, stopOnly)).ys, baseline.ys, "interaction_stop alone");
  const keyboard = { 5: [{ type: "movement_input", seq: 1, dx: 5, dy: 0, rotation: 512, duration: 10, active: true, running: false }] };
  assert.deepEqual((await introWalk(t, keyboard)).ys, baseline.ys, "keyboard movement");
  const interactions = { 5: [{ type: "npc_option", index: 1, clickType: 1 }, { type: "object_option", id: 44775, x: 3362, y: 11484, clickType: 1 }] };
  assert.deepEqual((await introWalk(t, interactions)).ys, baseline.ys, "NPC and object clicks");
});

test("the walk back after \"Woah...\" ends on 3367,11485 whatever the player clicks", async (t) => {
  const baseline = await introWalk(t, {}, 14, {});
  assert.deepEqual(baseline.ys.slice(14), [11488, 11487, 11486, 11485, 11485, 11485], "one tile a tick");
  const clicks = {};
  for (let tick = 0; tick < 4; tick++) clicks[tick] = STOP_AND_WALK;
  assert.deepEqual((await introWalk(t, {}, 14, clicks)).ys, baseline.ys);
});
