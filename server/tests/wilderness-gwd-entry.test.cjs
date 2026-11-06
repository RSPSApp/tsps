// Run after `yarn build`: node --test tests/wilderness-gwd-entry.test.cjs
//
// #2430: the crevice past the Jutting wall leads into the Wilderness God Wars Dungeon, as capture 1463 plays
// it, and that is what credits the Wilderness Diary's "Enter the Wilderness Godwars Dungeon". The Wiki's task
// needs 60 Agility or Strength, which the cave doesn't and this way in does; the point of credit is inferred.
// The Strength way in is in wilderness-gwd-boulder.test.cjs.
//
// The way back out through the crevices is inferred: no capture uses them. Capture 1463's player left by an
// amulet of glory, both times. Each is the reverse of a captured move, and they're tested here as that.
//
// Native fixture: real object_option through ClientConnection.dispatch, the real map and LocTeleports. Ticks
// are driven by hand. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const CAVE = { id: 26766, at: [3016, 3738], z: 0 };
const WALL = { id: 26768, at: [3066, 10148], z: 3 };
const CREVICE = { id: 26767, at: [3066, 10142], z: 3 };
const BESIDE_CREVICE = [3066, 10143, 3];
const INSIDE = [3062, 10130, 0];
const CAVERN = [3065, 10159, 3];
const SURFACE = [3017, 3740, 0];
const DUNGEON_EXIT = { id: 26769, at: [3062, 10131], z: 0 };
const CAVERN_EXIT = { id: 26767, at: [3065, 10160], z: 3 };
const CRAWL_ANIMATION = 2796;
const TASK = "enter-the-wilderness-godwars-dungeon";

let core;
let next = 8100;
const credits = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...CAVE.at);
  core.RegionManager.loadMapFiles(...CREVICE.at);
  PM.emitServerStartup({});
  PM.createApi("WildernessGwdEntryTest").onCustomEvent("diary:task", (event) => credits.push(event));
});
after(() => PM.emitServerShutdown({}));

function actor(t, [x, y, z]) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("gwdqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, z));
  p.needsPlacement = false;
  const animations = [];
  const performAnimation = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => {
    animations.push(animation.getId());
    return performAnimation(animation);
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, animations };
}

async function click(f, { id, at: [x, y] }) {
  await f.c.dispatch([{ type: "object_option", id, x, y, clickType: 1 }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 10; i++) {
    // Player sync clears this each tick; a moveTo leaves the player busy until it does.
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];
const credited = (f) => credits.filter((event) => event.player === f.p && event.task === TASK);

test("the crevice past the wall leads into the dungeon as captured, and credits the task once entered", async (t) => {
  const f = actor(t, BESIDE_CREVICE);
  assert.equal(credited(f).length, 0, "control: no credit before");
  await click(f, CREVICE);
  t.diagnostic(`at ${at(f)}; animations ${f.animations}; credits ${credited(f).length}`);
  assert.deepEqual(at(f), INSIDE, "lands inside, as capture 1463");
  assert.ok(f.animations.includes(CRAWL_ANIMATION), "with its animation");
  assert.equal(credited(f).length, 1, "credited");
  assert.equal(credited(f)[0].diary, "wilderness", "to the Wilderness Diary");
});

test("the cave and the jutting wall alone don't credit it", async (t) => {
  // Where capture 1463's player stood when the cave took them; its front faces this side.
  const cave = actor(t, SURFACE);
  await click(cave, CAVE);
  t.diagnostic(`cave: at ${at(cave)}`);
  assert.deepEqual(at(cave), CAVERN, "control: the cave leads to the cavern");
  assert.equal(credited(cave).length, 0, "the cave needs no level, so it isn't the task");

  const wall = actor(t, [WALL.at[0], WALL.at[1] + 1, WALL.z]);
  wall.p.getSkillManager().setCurrentLevel(core.Skill.AGILITY, 60, false);
  wall.p.getSkillManager().setMaxLevel(core.Skill.AGILITY, 60);
  await click(wall, WALL);
  t.diagnostic(`wall: at ${at(wall)}`);
  assert.equal(credited(wall).length, 0, "nor is crossing the wall");
});

test("the dungeon's crevice beside the landing goes back to the cavern, without credit", async (t) => {
  const f = actor(t, INSIDE);
  await click(f, DUNGEON_EXIT);
  t.diagnostic(`at ${at(f)}; animations ${f.animations}`);
  assert.deepEqual(at(f), BESIDE_CREVICE, "the reverse of the captured move");
  assert.equal(credited(f).length, 0, "leaving doesn't credit");
});

test("the cavern's crevice beside the landing goes back to the surface, without credit", async (t) => {
  const f = actor(t, CAVERN);
  await click(f, CAVERN_EXIT);
  t.diagnostic(`at ${at(f)}; animations ${f.animations}`);
  assert.deepEqual(at(f), SURFACE, "the reverse of the captured move");
  assert.equal(credited(f).length, 0, "leaving doesn't credit");
});
