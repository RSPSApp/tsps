const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
let core, api, next = 7300;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  new (require("../dist/game/definition/loader/impl/NpcDefinitionLoader").NpcDefinitionLoader)().load();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2635, 2966);
  api = PM.createApi("ChompyLifecycleTest");
  require("../plugins/achievements/AchievementDiaries.plugin").register(api);
});
function setup(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("huntqa" + next);
  player.setRegistered(true);
  player.setLocation(new core.Location(2635, 2966, 0));
  player.needsPlacement = false;
  const attracted = [], expired = [];
  const hunt = require("../plugins/quests/quests/Hunt.BigChompyBirdHunting")(api, {
    onAttracted: event => attracted.push(event), onBaitExpired: event => expired.push(event),
  });
  t.after(() => { hunt.shutdown(); player.setRegistered(false); core.TaskManager.process(); });
  return { player, hunt, attracted, expired };
}
const tick = count => { for (let i = 0; i < count; i++) core.TaskManager.process(); };
const actors = (f, id) => [...core.World.getNpcs()].filter(n => n?.getOwner?.() === f.player && n.getId() === id);
const birds = f => actors(f, core.NpcIdentifiers.CHOMPY_BIRD);
const bait = f => actors(f, core.NpcIdentifiers.BLOATED_TOAD);

test("bait waits 25 ticks, makes four independent 1/5 attempts, then bursts", t => {
  const f = setup(t);
  let rolls = 0;
  t.mock.method(Math, "random", () => { rolls++; return 0.2; });
  assert.ok(f.hunt.place(f.player));
  f.player.setLocation(new core.Location(3200, 3200));
  assert.equal(bait(f).length, 1);
  tick(24);
  assert.equal(rolls, 0);
  assert.equal(birds(f).length, 0);
  for (let age = 25; age <= 100; age += 25) {
    tick(age === 25 ? 1 : 25);
    assert.equal(rolls, age / 25, "one roll at each 25-tick boundary; exactly .2 fails");
    assert.equal(birds(f).length, 0);
  }
  assert.equal(bait(f).length, 0);
  assert.equal(f.expired.length, 1);
  tick(100);
  assert.equal(rolls, 4, "expired bait has no fifth attempt");
});

test("success at the fourth boundary is processed before the bait bursts", t => {
  const f = setup(t);
  t.mock.method(Math, "random", () => 0.2);
  f.hunt.place(f.player);
  tick(99);
  t.mock.method(Math, "random", () => 0.199999);
  tick(1);
  assert.equal(birds(f).length, 1);
  assert.equal(bait(f).length, 0);
  const bird = birds(f)[0], origin = f.player.getLocation();
  const distance = Math.max(Math.abs(origin.getX() - bird.getLocation().getX()), Math.abs(origin.getY() - bird.getLocation().getY()));
  assert.ok(distance >= 3 && distance <= 10);
  assert.ok(core.RegionManager.canProjectileAttackBounds(origin, bird.getLocation(), 1, 1, 1, 1, null));
});

test("successful bait stops rolling and concurrent bait keeps its own birth tick and bird", t => {
  const f = setup(t);
  t.mock.method(Math, "random", () => 0);
  f.hunt.place(f.player);
  tick(10);
  f.player.setLocation(new core.Location(2636, 2966));
  f.hunt.place(f.player);
  tick(14);
  assert.equal(birds(f).length, 0);
  tick(1);
  const first = birds(f)[0];
  assert.ok(first);
  tick(9);
  assert.equal(birds(f).length, 1);
  tick(1);
  assert.equal(birds(f).length, 2);
  assert.ok(birds(f).includes(first), "a second bait must not replace the first bird");
  tick(65);
  assert.equal(f.attracted.length, 2, "neither successful bait rolls for a second bird");
  assert.equal(bait(f).length, 1, "the second bait has its own later expiry");
  assert.equal(birds(f).length, 2);
  tick(24);
  assert.equal(birds(f).length, 2);
  tick(1);
  assert.equal(f.hunt.ownsBird(f.player, first), false, "first bird expires 100 ticks after its own landing");
});

test("distance does not suppress a placed bait and duplicate tiles are rejected across owners", t => {
  const f = setup(t), g = setup(t);
  t.mock.method(Math, "random", () => 0);
  assert.ok(f.hunt.place(f.player));
  assert.equal(g.hunt.place(g.player), false);
  f.player.setLocation(new core.Location(3200, 3200));
  tick(25);
  assert.equal(birds(f).length, 1);
  assert.ok(birds(f)[0].getLocation().getX() < 2700, "spawn uses captured bait position, not owner's new position");
});

test("Western diary double-spawn rewards use real claimed tiers and RNG boundaries", t => {
  const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  const { BY_KEY, TIERS } = require("../plugins/achievements/diaries/Data.AchievementDiaries");
  const diary = BY_KEY.get("western");
  for (const [tier, roll, expected] of [[null, 0, 1], ["easy", 0.249999, 2], ["easy", 0.25, 1],
    ["medium", 0.499999, 2], ["medium", 0.5, 1], ["hard", 0.499999, 2], ["hard", 0.5, 1], ["elite", 0.99999, 2]]) {
    const f = setup(t);
    // Rewards are claimed in order, so a hard completer has claimed easy and medium too.
    if (tier) for (const claimed of TIERS.slice(0, TIERS.indexOf(tier) + 1)) Progress.claimTier(f.player, diary, claimed);
    f.hunt.place(f.player);
    let calls = 0;
    t.mock.method(Math, "random", () => ++calls === 1 ? 0 : roll);
    tick(25);
    assert.equal(birds(f).length, expected, String(tier) + ": " + roll);
    f.hunt.shutdown();
  }
});

test("logout removes transient actors and pending rolls without affecting another hunter", t => {
  const f = setup(t), g = setup(t);
  g.player.setLocation(new core.Location(2640, 2966));
  t.mock.method(Math, "random", () => 0);
  f.hunt.place(f.player);
  g.hunt.place(g.player);
  tick(24);
  f.hunt.cleanup(f.player);
  tick(1);
  assert.equal(bait(f).length, 0);
  assert.equal(birds(f).length, 0);
  assert.equal(birds(g).length, 1);
});

test("a dying bird retains ownership until the production death hook transfers it to a carcass", t => {
  const f = setup(t);
  t.mock.method(Math, "random", () => 0);
  f.hunt.place(f.player);
  tick(25);
  const bird = birds(f)[0];
  bird.setHitpoints(0);
  tick(1);
  assert.equal(f.hunt.ownsBird(f.player, bird), true, "do not lose kill ownership before the NPC death hook");
  f.hunt.removeBird(bird);
  api.removeNpc(bird);
  const corpse = api.spawnNpc({ id: core.NpcIdentifiers.CHOMPY_BIRD_2,
    x: 2635, y: 2966, owner: f.player, ownerOnly: true });
  f.hunt.trackCarcass(corpse, f.player);
  tick(199);
  assert.equal(corpse.isRegistered(), true, "old bird's former deadline cannot remove its separate carcass");
  tick(1);
  assert.equal(corpse.isRegistered(), false);
  assert.equal(f.hunt.hasCarcass(f.player), false);
});

test("landing uses captured private-area clipping and requires line of sight, not just an empty tile", t => {
  const f = setup(t), area = new core.PrivateArea();
  area.add(f.player);
  t.after(() => area.destroy());
  const origin = f.player.getLocation().clone();
  for (let dx = -10; dx <= 10; dx++) for (let dy = -10; dy <= 10; dy++) {
    if (dx || dy) area.setClip(new core.Location(origin.getX() + dx, origin.getY() + dy),
      core.RegionManager.BLOCKED_TILE | core.RegionManager.PROJECTILE_TILE_BLOCKED);
  }
  t.mock.method(Math, "random", () => 0);
  assert.ok(f.hunt.place(f.player));
  assert.equal(bait(f)[0].getPrivateArea(), area);
  area.remove(f.player); // actual area membership API; the original snapshot remains the bait's owner
  tick(25);
  assert.equal(birds(f).length, 0, "blocked landing consumes an attempt, not the bait");
  const landing = new core.Location(origin.getX() + 3, origin.getY());
  area.setClip(landing, 0);
  tick(25);
  assert.equal(birds(f).length, 0, "the one empty tile still has obstructed LoS");
  area.setClip(new core.Location(origin.getX() + 1, origin.getY()), 0);
  area.setClip(new core.Location(origin.getX() + 2, origin.getY()), 0);
  area.setClip(landing, 0x40000); // blocking floor decoration, despite clear projectile LoS
  tick(25);
  assert.equal(birds(f).length, 0, "a blocking floor decoration cannot be a landing tile");
  area.setClip(landing, 0);
  tick(25);
  assert.equal(birds(f).length, 1);
  assert.equal(birds(f)[0].getPrivateArea(), area);
  assert.ok(birds(f)[0].getLocation().equals(landing));
});

test("destroying a private area removes its bait before it can roll again", t => {
  const f = setup(t), area = new core.PrivateArea();
  area.add(f.player);
  t.mock.method(Math, "random", () => 0);
  f.hunt.place(f.player);
  tick(24);
  area.destroy();
  tick(1);
  assert.equal(bait(f).length, 0);
  assert.equal(birds(f).length, 0);
});

test("burst damage is restricted to the owning player on the same plane and area", t => {
  for (const [dx, plane, expected] of [[1, 0, 1], [2, 0, 0], [0, 1, 0]]) {
    const f = setup(t), origin = f.player.getLocation().clone();
    t.mock.method(Math, "random", () => 0.2);
    f.hunt.place(f.player);
    f.player.setLocation(new core.Location(origin.getX() + dx, origin.getY(), plane));
    tick(100);
    f.player.getCombat().getHitQueue().process(core.World.getProcessCycle());
    assert.equal(f.player.getHitpoints(), 10 - expected);
    f.hunt.shutdown();
  }
});

test("burst damage cannot kill the owner: skipped at 1 HP, clamped to leave 1 HP, full otherwise", t => {
  for (const [hp, expected] of [[1, 1], [2, 1], [10, 8]]) {
    const f = setup(t);
    t.mock.method(Math, "random", () => 0.99);
    f.hunt.place(f.player);
    f.player.setHitpoints(hp);
    tick(100);
    f.player.getCombat().getHitQueue().process(core.World.getProcessCycle());
    assert.equal(f.player.getHitpoints(), expected, `owner at ${hp} HP`);
    f.hunt.shutdown();
    t.mock.restoreAll();
  }
});
