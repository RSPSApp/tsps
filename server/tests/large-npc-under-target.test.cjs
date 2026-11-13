// Run after `yarn build`: node --test tests/large-npc-under-target.test.cjs
//
// #489's follow-up. A player under a large NPC is out of its reach (Wiki, Aggressiveness: "The tile
// underneath the NPC itself is not part of the attack range"; Mithril dragon/Strategies: they "cannot
// attack players standing underneath them"). An NPC fighting them steps off a tile a tick, the
// shortest way, and attacks once they're beside it (rsprox: a gargoyle, 237/01143.txt:85622; a moss
// giant, 227/00569.txt:3987; the Kalphite Queen, 227/00095.txt:242492). Real NPCs, Players, Combat
// and movement, ticked by hand in World's order; hits counted as the combat core queues them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

// Open ground in the Wilderness where a 4x4 can step every way (checked with RegionManager.canMovestart).
const FIELD = [3104, 3588];
const HILL_GIANT = 2098; // size 2
const GREEN_DRAGON = 260; // size 4
const MAN = 3106; // size 1

let core;
let next = 7900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...FIELD);
  core.RegionManager.loadMapFiles(3104, 3606);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function fight(t, npcId, { underAt = [0, 0], npcAt = FIELD } = {}) {
  let cycle = 5000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("underqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(npcAt[0] + underAt[0], npcAt[1] + underAt[1], 0));
  p.needsPlacement = false;
  p.setHitpoints(990);
  const npc = core.NPC.create(npcId, new core.Location(npcAt[0], npcAt[1], 0));
  npc.setRegistered(true);
  npc.setNeedsPlacement(false);
  const hits = [];
  const queue = core.CombatFactory.addPendingHit;
  t.mock.method(core.CombatFactory, "addPendingHit", (hit) => {
    if (hit?.getAttacker?.() === npc) hits.push(cycle);
    return queue.call(core.CombatFactory, hit);
  });
  t.after(() => {
    npc.getCombat().reset();
    npc.setRegistered(false);
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  npc.getCombat().attack(p);
  const tick = () => {
    cycle++;
    core.TaskManager.process();
    npc.process();
    p.getMovementQueue().process();
  };
  const at = () => [npc.getLocation().getX(), npc.getLocation().getY()];
  const under = () => {
    const [nx, ny] = at();
    const px = p.getLocation().getX(), py = p.getLocation().getY();
    const size = npc.getSize();
    return px >= nx && px < nx + size && py >= ny && py < ny + size;
  };
  return { p, npc, hits, tick, at, under, cycle: () => cycle };
}

// Each test on its own open tile: an NPC from an earlier test still occupies its tiles.
const SPOTS = { giant: [3104, 3606], dragon: [3104, 3588], boxed: [3104, 3585], blocked: [3110, 3606], man: [3116, 3606] };

for (const [name, id, size, underAt, clearIn, spot] of [
  ["a 2x2 hill giant", HILL_GIANT, 2, [1, 1], 1, SPOTS.giant],
  ["a 4x4 green dragon", GREEN_DRAGON, 4, [2, 1], 2, SPOTS.dragon],
]) {
  test(`${name}: no hit while the player is under it; it steps off the shortest way, then attacks`, (t) => {
    const f = fight(t, id, { underAt, npcAt: spot });
    assert.equal(f.npc.getSize(), size);
    assert.equal(f.under(), true, "PRE: the player stands under it");
    let hitsWhileUnder = 0;
    let clearedAt = -1;
    const trail = [];
    for (let i = 0; i < 20; i++) {
      const wasUnder = f.under();
      const before = f.hits.length;
      f.tick();
      if (wasUnder && f.hits.length > before) hitsWhileUnder++;
      if (clearedAt < 0 && !f.under()) clearedAt = i + 1;
      trail.push(f.at().join(","));
    }
    t.diagnostic(`clear after ${clearedAt} ticks; hits ${f.hits.length}; at ${f.at()}; trail ${trail.join(" ")}`);
    assert.equal(hitsWhileUnder, 0, "no attack from over the player");
    assert.ok(clearedAt > 0 && clearedAt <= clearIn + 1, `off the player within ${clearIn + 1} ticks: ${clearedAt}`);
    assert.ok(f.hits.length > 0, "it attacks once the player is beside it");
  });
}

test("boxed in, a large NPC waits over the player: no attack and no step", (t) => {
  const f = fight(t, GREEN_DRAGON, { underAt: [1, 1], npcAt: SPOTS.boxed });
  t.mock.method(f.npc.getMovementQueue(), "canWalkTo", () => false);
  const start = f.at();
  for (let i = 0; i < 20; i++) f.tick();
  assert.deepEqual(f.at(), start);
  assert.equal(f.under(), true);
  assert.equal(f.hits.length, 0, "Wiki: no attack from under the player");
});

test("one that can't move (setBlockMovement) never attacks a player under it", (t) => {
  const f = fight(t, HILL_GIANT, { underAt: [0, 0], npcAt: SPOTS.blocked });
  f.npc.getMovementQueue().setBlockMovement(true);
  const start = f.at();
  for (let i = 0; i < 20; i++) f.tick();
  assert.deepEqual(f.at(), start);
  assert.equal(f.hits.length, 0);
});

test("a 1x1 NPC on the player's tile still steps aside a tile, then attacks", (t) => {
  const f = fight(t, MAN, { underAt: [0, 0], npcAt: SPOTS.man });
  let hitsWhileUnder = 0;
  for (let i = 0; i < 15; i++) {
    const wasUnder = f.under();
    const before = f.hits.length;
    f.tick();
    if (wasUnder && f.hits.length > before) hitsWhileUnder++;
  }
  assert.equal(hitsWhileUnder, 0);
  assert.equal(f.under(), false, "it stepped aside");
  assert.ok(f.hits.length > 0);
});
