// Run after `yarn build`: node --test tests/wilderness-gwd-boulder.test.cjs
//
// #2430: "Enter the Wilderness Godwars Dungeon" by the 60 Strength route. Wiki: boulder NPC 6621 at 3053,10165,3,
// Move, 60 Strength, 5.5 XP going in; a crevice behind it leads near Armadyl's encampment. The cache map has crevice
// 26767 at 3049,10165,3 face 2 and 26769 at 3035,10158,0 face 0. No capture moves the boulder or uses these two.
// Fixture seams: the boulder is made here at the spawn tile, not the world's own spawn, and npc.process() doesn't
// run. The Agility way in is in wilderness-gwd-entry.test.cjs. No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const DIARY = Diaries.BY_KEY.get("wilderness");
const TASK = "enter-the-wilderness-godwars-dungeon";
const BOULDER = [3053, 10165, 3];
const CAVERN = [3056, 10165, 3];
const CAVERN_SIDE = [3055, 10165, 3];
const HALLWAY = [3052, 10165, 3];
const CREVICE_DOWN = { id: 26767, x: 3049, y: 10165 };
const CREVICE_UP = { id: 26769, x: 3035, y: 10158 };
const INSIDE = [3034, 10158, 0];
const TOP = [3050, 10165, 3];
const BEHIND_INNER_CREVICE = [3036, 10158, 0];

let core;
let next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(BOULDER[0], BOULDER[1]);
  core.RegionManager.loadMapFiles(INSIDE[0], INSIDE[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at, strength = 60) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("boulderqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], at[2]));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  const skills = p.getSkillManager();
  skills.setCurrentLevel(core.Skill.STRENGTH, strength);
  const xp = [];
  const addExperiences = skills.addExperiences.bind(skills);
  t.mock.method(skills, "addExperiences", (skill, amount) => { xp.push([skill, amount]); return addExperiences(skill, amount); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, messages, xp };
}

function tick(f, count) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    f.c.processTurnPackets();
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getSession().flushClient(core.World.processCycle);
    f.p.resetUpdating();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

async function moveBoulder(t, f) {
  const npc = core.NPC.create(6621, new core.Location(BOULDER[0], BOULDER[1], BOULDER[2]));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: 1 });
  tick(f, 6);
  core.World.getNpcs().remove(npc);
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];
const done = (f) => DiaryProgress.doneTasks(f.p, DIARY).has(TASK);

test("every inferred landing is open, and the inner crevice's other side isn't", () => {
  const blocked = (tile) => core.RegionManager.blocked(new core.Location(...tile), null);
  for (const tile of [HALLWAY, CAVERN_SIDE, TOP, INSIDE]) assert.equal(blocked(tile), false, `${tile} is open`);
  assert.equal(blocked(BEHIND_INNER_CREVICE), true, "the facing side is the only way out of it");
});

test("60 Strength moves the boulder into the hallway for 5.5 XP, and back for none", async (t) => {
  const f = actor(t, CAVERN);
  await moveBoulder(t, f);
  assert.deepEqual(at(f), HALLWAY, "past it");
  assert.deepEqual(f.xp, [[core.Skill.STRENGTH, 5.5]], "with the XP");
  f.xp.length = 0;
  await moveBoulder(t, f);
  assert.deepEqual(at(f), CAVERN_SIDE, "and back");
  assert.deepEqual(f.xp, [], "for none");
  assert.equal(done(f), false, "moving it isn't entering the dungeon");
});

test("59 Strength can't, and a boost can", async (t) => {
  const f = actor(t, CAVERN, 59);
  await moveBoulder(t, f);
  assert.equal(at(f)[0] >= CAVERN_SIDE[0], true, "stays on the cavern side");
  assert.ok(f.messages.some((text) => /Strength level of 60/.test(text)), JSON.stringify(f.messages));
  assert.deepEqual(f.xp, [], "no XP");

  const boosted = actor(t, CAVERN, 60);
  boosted.p.getSkillManager().setMaxLevel(core.Skill.STRENGTH, 55);
  await moveBoulder(t, boosted);
  assert.deepEqual(at(boosted), HALLWAY, "the boosted level is what counts");
});

test("the crevice behind it leads into the dungeon and credits the task; the one below leads back", async (t) => {
  const f = actor(t, HALLWAY);
  await send(f, { type: "object_option", id: CREVICE_DOWN.id, x: CREVICE_DOWN.x, y: CREVICE_DOWN.y, clickType: 1 });
  tick(f, 10);
  assert.deepEqual(at(f), INSIDE, "down");
  assert.equal(done(f), true, "credited");

  await send(f, { type: "object_option", id: CREVICE_UP.id, x: CREVICE_UP.x, y: CREVICE_UP.y, clickType: 1 });
  tick(f, 10);
  assert.deepEqual(at(f), TOP, "and back up");
});

test("the crevice back up doesn't credit a fresh player", async (t) => {
  const f = actor(t, INSIDE);
  await send(f, { type: "object_option", id: CREVICE_UP.id, x: CREVICE_UP.x, y: CREVICE_UP.y, clickType: 1 });
  tick(f, 10);
  assert.deepEqual(at(f), TOP, "control: it took them up");
  assert.equal(done(f), false);
});

test("the whole route from the cavern, by packets", async (t) => {
  const f = actor(t, CAVERN);
  await moveBoulder(t, f);
  await send(f, { type: "object_option", id: CREVICE_DOWN.id, x: CREVICE_DOWN.x, y: CREVICE_DOWN.y, clickType: 1 });
  tick(f, 12);
  assert.deepEqual(at(f), INSIDE);
  assert.equal(done(f), true);
});
