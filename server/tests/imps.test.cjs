// Run after `yarn build`: node --test tests/imps.test.cjs
//
// Imps teleport away (plugins/npcs/Imps.plugin.js, docs/imps.md). Wiki Imp: "Every 30–120 seconds
// there is a 25% chance for an imp to disappear into a puff of smoke and teleport a short distance
// away." rsprox captures (rev 241, local 1001018, 1001418, 1001419): smokepuff 86 (height 124) on
// the tile it leaves and the tile it lands on, sound 1931 (one loop, range 10) at the first, 17-20
// tiles apart; 5 of 7 teleports on the tick a player's hit landed.
//
// Real objects: plugins loaded from the directory, a real Player with a session, a real imp (5007)
// in Lumbridge's loaded map, and real PendingHits through CombatFactory.executeHit, so the hook is
// the core's onCombatHitResolved. Fixture seams: Math.random, and the packet sender's graphic and
// area-sound calls are recorded.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");

const IMP = 5007;
const NOT_IMP = 3106; // man
/** Lumbridge, east of the castle: where local 1001418's imp teleported from (tick 2580). */
const SPOT = [3197, 3234];
const SMOKEPUFF = 86;
const SOUND = 1931;

let core;
let next = 9700;
const method = { type: () => core.CombatType.MELEE, accuracyDefenceType: () => undefined };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(SPOT[0], SPOT[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function scene(t, id = IMP) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel), new core.Location(SPOT[0], SPOT[1] - 1, 0));
  p.setIndex(next++);
  p.setUsername("impqa" + p.getIndex());
  p.setRegistered(true);
  p.setNeedsPlacement(false);
  p.setAttribute("bot-skip-persistence", true);
  const graphics = [];
  const sounds = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendGraphic", (graphic, tile) => { graphics.push({ id: graphic.id, height: graphic.height, tile }); return sender; });
  t.mock.method(sender, "sendAreaSound", (...args) => { sounds.push(args); return sender; });
  const npc = core.NPC.create(id, new core.Location(SPOT[0], SPOT[1], 0));
  npc.setIndex(next++);
  npc.setRegistered(true);
  npc.setNeedsPlacement(false);
  t.mock.method(core.World, "forEachNetworkPlayer", (fn) => fn(p));
  t.mock.method(core.World, "getPlayers", () => [p]);
  t.after(() => { p.setRegistered(false); npc.setRegistered(false); });
  return { p, npc, graphics, sounds };
}

/** A real hit through CombatFactory, then the target's hit queue lands it. */
function hit(attacker, target, damage) {
  const pending = new PendingHit(attacker, target, method, {
    damage, rollAccuracy: false, experience: false, handleAfterHitEffects: false,
  });
  core.CombatFactory.executeHit(pending);
  target.getCombat().getHitQueue().process(1);
}

const realRandom = Math.random;
/**
 * The plugin's own chance rolls (called from damageLanded or scan) return `values` in turn; every
 * other Math.random() (the core's combat, the landing tile) stays random.
 */
function rolls(t, ...values) {
  const queue = [...values];
  t.mock.method(Math, "random", () => {
    const caller = new Error().stack.split("\n").slice(1)
      .find((line) => !line.includes("imps.test.cjs") && !line.includes("node:")) ?? "";
    const ours = caller.includes("Imps.plugin.js") && /damageLanded|scan|idleDelay/.test(caller);
    if (!ours) return realRandom();
    if (!queue.length) throw new Error("unexpected chance roll: " + caller.trim());
    return queue.shift();
  });
}

const chebyshev = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));

test("a damaging hit can send the imp 17-20 tiles off with a smokepuff at both tiles and sound 1931", (t) => {
  const { p, npc, graphics, sounds } = scene(t);
  rolls(t, 0);
  const from = npc.getLocation().clone();
  hit(p, npc, 1);
  const to = npc.getLocation();
  const distance = chebyshev(from, to);
  assert.ok(distance >= 17 && distance <= 20, `landed ${distance} tiles away`);
  assert.equal(to.getZ(), 0);
  assert.equal(core.RegionManager.blocked(to, null), false, "landing tile is walkable");
  assert.deepEqual(graphics.map((g) => [g.id, g.height, g.tile.getX(), g.tile.getY()]),
    [[SMOKEPUFF, 124, from.getX(), from.getY()], [SMOKEPUFF, 124, to.getX(), to.getY()]]);
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0][0], SOUND);
  assert.equal(npc.getCombat().getTarget(), null, "the imp drops its fight");
});

test("a hit that does no damage, a roll above the chance, or a killing blow leaves the imp where it is", (t) => {
  const { p, npc, graphics } = scene(t);
  const from = npc.getLocation().clone();
  rolls(t);
  hit(p, npc, 0);
  assert.ok(npc.getLocation().equals(from), "no damage, no roll");
  rolls(t, 0.17);
  hit(p, npc, 1);
  assert.ok(npc.getLocation().equals(from), "1 in 6 roll failed");
  rolls(t);
  hit(p, npc, npc.getHitpoints());
  assert.ok(npc.getLocation().equals(from), "a killing blow doesn't roll");
  assert.equal(graphics.length, 0);
});

test("other NPCs don't teleport when hit", (t) => {
  const { p, npc, graphics } = scene(t, NOT_IMP);
  rolls(t);
  const from = npc.getLocation().clone();
  hit(p, npc, 1);
  assert.ok(npc.getLocation().equals(from));
  assert.equal(graphics.length, 0);
});

test("idle: a seen imp rolls once its 50-200 tick wait is up, at 25%", (t) => {
  const Imps = require("../plugins/npcs/Imps.plugin");
  const { npc, graphics } = scene(t);
  t.mock.method(core.World, "getNpcsNear", () => [npc]);
  const from = npc.getLocation().clone();
  // First sight draws the wait (0.99: 200 ticks) and doesn't roll.
  rolls(t, 0.99);
  Imps._test.scan();
  assert.ok(Imps._test.nextRoll.has(npc));
  // 190 ticks on: not due yet, nothing drawn.
  rolls(t);
  for (let i = 0; i < 19; i++) Imps._test.scan();
  // Due: the next wait is drawn (0), then the 25% roll fails at 0.25.
  rolls(t, 0, 0.25);
  Imps._test.scan();
  assert.ok(npc.getLocation().equals(from));
  assert.equal(graphics.length, 0);
  // 50 ticks later it is due again; 0.24 passes.
  rolls(t);
  for (let i = 0; i < 4; i++) Imps._test.scan();
  rolls(t, 0, 0.24);
  Imps._test.scan();
  const distance = chebyshev(from, npc.getLocation());
  assert.ok(distance >= 17 && distance <= 20, `landed ${distance} tiles away`);
  assert.equal(graphics.length, 2);
});

test("a player fighting the imp goes after it again once it has landed", (t) => {
  const { p, npc } = scene(t);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { tasks.push(task); return task; });
  p.getCombat().attack(npc);
  assert.equal(p.getCombat().getTarget(), npc);
  rolls(t, 0);
  const from = npc.getLocation().clone();
  hit(p, npc, 1);
  assert.ok(!npc.getLocation().equals(from), "teleported");
  // The core's next combat cycle drops a target that moved this tick (needsPlacement).
  p.getCombat().reset();
  npc.setNeedsPlacement(false);
  const chase = tasks.find((task) => task instanceof core.CountdownTask);
  assert.ok(chase, "a chase is queued");
  chase.execute();
  assert.equal(p.getCombat().getTarget(), npc);
});
