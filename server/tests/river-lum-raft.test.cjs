// Run after `yarn build`: node --test tests/river-lum-raft.test.cjs
// The Broken Raft across the River Lum (issue #6840), on the real engine: every plugin loaded, the cache map, real
// Players clicking through ObjectActionPacketListener and World.process ticks. The timeline is rsprox capture 347
// (rev 230): west to east from tick 1945, east to west from tick 4061, counted from the first shot.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

const RAFT = [3252, 3179];
const ROPE = 17034;
const WEST_TREE = [3244, 3179];
const EAST_TREE = [3260, 3178];

let core, Progress, diary;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
  core.RegionManager.loadMapFiles(...RAFT);
  Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
  diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("lumbridge");
});
after(() => PM.emitServerShutdown({}));

const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
  close() {}, onData() {}, onError() {}, onClose() {} });

let next = 1;
/** A real player on `tile` with 99s, the crossbow and grapple worn when `geared`, recording what it is sent. */
function actor(t, tile, { geared = true, agility = 99 } = {}) {
  const p = new Player(new PlayerSession(channel()));
  const name = `lumraft${next++}`;
  p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name));
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(tile[0], tile[1], 0));
  assert.equal(core.World.getPlayers().add(p), true);
  p.needsPlacement = false;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.getSkillManager().setMaxLevels(core.Skill.AGILITY, agility, false).setCurrentLevels(core.Skill.AGILITY, agility, false);
  if (geared) {
    p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.BRONZE_CROSSBOW, 1));
    p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(9419, 1));
  }
  const log = [];
  let tick = 0;
  const at = (entry) => log.push([tick, ...entry]);
  const sender = p.getPacketSender();
  const wrap = (object, name, record) => {
    const original = object[name].bind(object);
    object[name] = (...args) => { record(...args); return original(...args); };
  };
  wrap(p, "performAnimation", (animation) => at(["anim", animation.getId()]));
  wrap(p, "setForceMovement", (move) => { if (move) at(["move", move.getStart().getX(), move.getStart().getY(), move.getEnd().getX(), move.getEnd().getY(), move.getSpeed?.() ?? null]); });
  wrap(sender, "sendTypedMessage", (type, message) => at(["msg", message]));
  wrap(sender, "sendMessage", (message) => at(["msg", message]));
  wrap(sender, "sendSoundEffect", (id, loops, delay) => at(["sound", id, delay ?? 0]));
  wrap(sender, "sendGlobalGraphic", (graphic, tile) => at(["splash", graphic.id, tile.getX(), tile.getY()]));
  wrap(sender, "closeSubInterface", (uid) => at(["close", uid & 0xffff]));
  wrap(sender, "sendClientScript", (id, ...args) => { if (id === 915) at(["tab", args[0]]); });
  t.after(() => {
    p.getAttribute("agility.obstacle")?.stop?.();
    if (p.isRegistered()) core.World.getPlayers().removes(p);
  });
  return {
    p, log,
    tile: () => [p.getLocation().getX(), p.getLocation().getY()],
    process() { core.World.process(); tick++; },
    get tick() { return tick; },
    set tick(value) { tick = value; },
  };
}

/** Clicks `option` on the loc at `tile` and plays ticks until the crossing has started; the first shot is tick 0. */
function click(a, objectId, tile, option = 1) {
  new ObjectActionPacketListener().executeAction(a.p, objectId, tile[0], tile[1], option);
  for (let i = 0; i < 20 && !a.log.some(([, kind]) => kind === "anim" || kind === "move"); i++) a.process();
  const first = a.log.find(([, kind]) => kind === "anim" || kind === "move");
  assert.ok(first, `the crossing started (${JSON.stringify(a.log)})`);
  const shift = first[0];
  for (const entry of a.log) entry[0] -= shift;
  a.tick -= shift;
}

/** Plays ticks to `until`, noting the player's tile at the end of each. */
function playTo(a, until) {
  const tiles = {};
  while (a.tick < until) { const now = a.tick; a.process(); tiles[now] = a.tile(); }
  return tiles;
}

function locAt(tile, type) {
  return core.MapObjects.getType(new core.Location(tile[0], tile[1], 0), type, null);
}
const ropes = (fromX, toX) => Array.from({ length: toX - fromX + 1 }, (_, i) => locAt([fromX + i, 3179], 22)?.getId() ?? null);
const done = (p) => Progress.doneTasks(p, diary).has("grapple-across-the-river-lum");
const of = (log, kind) => log.filter(([, k, value]) => k === kind && !(kind === "msg" && /Achievement Diary/.test(value)))
  .map(([tick, , ...rest]) => [tick, ...rest]);

test("grappling west to east plays the captured crossing and lands on the Al Kharid bank (rsprox 347 tick 1945)", (t) => {
  const a = actor(t, [3243, 3183]);
  click(a, 17068, RAFT);
  assert.deepEqual(a.tile(), [3246, 3179], "fires from the west bank tile");
  assert.deepEqual(of(a.log, "anim")[0], [0, 4230]);
  assert.ok(of(a.log, "close").length >= 9 && of(a.log, "tab")[0][0] === 0, "the side tabs close with the first shot");
  const tiles = playTo(a, 30);
  assert.deepEqual(of(a.log, "msg"), [
    [3, "You successfully grapple the raft and tie the rope to a tree."],
    [13, "You successfully grapple the tree on the opposite bank."],
  ]);
  assert.deepEqual(of(a.log, "anim"), [[0, 4230], [4, 4466], [10, 4230], [14, 4467]]);
  assert.deepEqual(of(a.log, "sound"), [[0, 2928, 0], [4, 2929, 3], [10, 2928, 0], [14, 2929, 3]]);
  assert.deepEqual(of(a.log, "splash"), [[4, 68, 3249, 3179], [14, 68, 3254, 3179]]);
  assert.deepEqual(of(a.log, "move").map(([tick, sx, sy, dx, dy]) => [tick, sx, sy, sx + dx, sy + dy]),
    [[4, 3247, 3179, 3252, 3180], [14, 3253, 3179, 3258, 3179]], "each swim is drawn from the bank or raft tile it starts on");
  assert.deepEqual([tiles[3], tiles[4], tiles[5], tiles[6], tiles[14], tiles[15]],
    [[3247, 3179], [3252, 3180], [3253, 3180], [3253, 3179], [3258, 3179], [3259, 3179]]);
  assert.deepEqual(of(a.log, "tab").map(([tick, tab]) => [tick, tab]), [[0, 9], [18, 1]], "tabs back at tick 18");
  assert.deepEqual(a.tile(), [3259, 3179]);
  assert.equal(done(a.p), true, "the medium diary's grapple task");
});

test("the ropes and trees show each leg, 14 ticks a bank (rsprox 347 ticks 1948-1972)", (t) => {
  const a = actor(t, [3243, 3183]);
  click(a, 17068, RAFT);
  const seen = {};
  while (a.tick < 30) {
    const now = a.tick;
    a.process();
    seen[now] = { west: ropes(3246, 3251), east: ropes(3254, 3259), yew: locAt(WEST_TREE, 10)?.getId(), tree: locAt(EAST_TREE, 10)?.getId() };
  }
  // The banks' own ground decorations (cache 17030 and 319), which the rope replaces while it is out.
  const west = [17030, null, 319, null, null, null], east = [null, null, null, null, null, 17030], rope = Array(6).fill(ROPE);
  assert.deepEqual(seen[2], { west, east, yew: 17039, tree: 17036 });
  assert.deepEqual(seen[3], { west: rope, east, yew: 17040, tree: 17036 }, "the rope tied to the yew");
  assert.deepEqual(seen[13], { west: rope, east: rope, yew: 17040, tree: 17038 }, "the far tree grappled");
  assert.deepEqual(seen[16], { west: rope, east: rope, yew: 17040, tree: 17038 });
  assert.deepEqual(seen[17], { west, east: rope, yew: 17039, tree: 17038 });
  assert.deepEqual(seen[26], { west, east: rope, yew: 17039, tree: 17038 });
  assert.deepEqual(seen[27], { west, east, yew: 17039, tree: 17036 });
});

test("grappling east to west plays the captured crossing and lands on the Lumbridge bank (rsprox 347 tick 4061)", (t) => {
  const a = actor(t, [3259, 3177]);
  click(a, 17068, RAFT);
  assert.deepEqual(a.tile(), [3259, 3179], "fires from the east bank tile: Al Kharid can grapple too");
  const tiles = playTo(a, 18);
  assert.deepEqual(of(a.log, "msg"), [
    [3, "You successfully grapple the raft and tie the rope to a tree."],
    [12, "You successfully grapple the tree."],
  ]);
  assert.deepEqual(of(a.log, "anim"), [[0, 4230], [5, 4467], [9, 4230], [12, 4466]]);
  assert.deepEqual(of(a.log, "move").map(([tick, sx, sy, dx, dy]) => [tick, sx, sy, sx + dx, sy + dy]),
    [[5, 3258, 3179, 3253, 3179], [12, 3252, 3180, 3248, 3179]]);
  assert.deepEqual(of(a.log, "splash"), [[5, 68, 3257, 3179], [12, 68, 3251, 3179]]);
  assert.deepEqual([tiles[3], tiles[5], tiles[6], tiles[7], tiles[12], tiles[13], tiles[14]],
    [[3258, 3179], [3253, 3179], [3253, 3180], [3252, 3180], [3248, 3179], [3247, 3179], [3246, 3179]]);
  assert.deepEqual(of(a.log, "tab").map(([tick, tab]) => [tick, tab]), [[0, 9], [16, 1]]);
  assert.equal(locAt(EAST_TREE, 10)?.getId(), 17036, "the east tree is back at tick 17");
  assert.equal(locAt(WEST_TREE, 10)?.getId(), 17041, "the yew still holds the grapple");
  assert.equal(done(a.p), true);
  playTo(a, 40);
  assert.deepEqual([ropes(3246, 3251), locAt(WEST_TREE, 10)?.getId()], [[17030, null, 319, null, null, null], 17039]);
});

test("Grapple without the crossbow and grapple refuses, even at 48 Agility", (t) => {
  const a = actor(t, [3246, 3179], { geared: false, agility: 60 });
  new ObjectActionPacketListener().executeAction(a.p, 17068, RAFT[0], RAFT[1], 1);
  for (let i = 0; i < 5; i++) a.process();
  assert.deepEqual(of(a.log, "msg"), [[of(a.log, "msg")[0]?.[0], "You need a crossbow equipped to do that."]]);
  assert.deepEqual(a.tile(), [3246, 3179]);
});

test("Jump-to crosses barehanded at 48 Agility either way, with no grapple fired and no diary credit (Wiki: Broken Raft)", (t) => {
  for (const [start, loc, landing] of [[[3245, 3180], [17069, 3252, 3180], [3259, 3179]], [[3260, 3180], [17070, 3253, 3180], [3246, 3179]]]) {
    const a = actor(t, start, { geared: false, agility: 48 });
    click(a, loc[0], [loc[1], loc[2]]);
    playTo(a, 15);
    assert.deepEqual(a.tile(), landing);
    assert.equal(of(a.log, "anim").some(([, id]) => id === 4230), false, "no shot");
    assert.deepEqual(of(a.log, "msg"), []);
    assert.equal(done(a.p), false, "only the grapple counts for the diary (Wiki)");
  }
  const low = actor(t, [3245, 3180], { geared: false, agility: 47 });
  new ObjectActionPacketListener().executeAction(low.p, 17069, 3252, 3180, 1);
  for (let i = 0; i < 8; i++) low.process();
  assert.deepEqual(of(low.log, "msg").map(([, m]) => m), ["You need an Agility level of at least 48 to attempt this."]);
});

test("a crossing cut short by a logout lands the player on the far bank and the ropes still go", (t) => {
  const a = actor(t, [3246, 3179]);
  click(a, 17068, RAFT);
  playTo(a, 5);
  a.p.getAttribute("agility.obstacle").fastForward();
  assert.deepEqual(a.tile(), [3259, 3179]);
  playTo(a, 40);
  assert.deepEqual([ropes(3246, 3251), locAt(WEST_TREE, 10)?.getId()], [[17030, null, 319, null, null, null], 17039]);
});

test("a death on the way gives the side tabs back", (t) => {
  const a = actor(t, [3243, 3183]);
  click(a, 17068, RAFT);
  playTo(a, 6);
  a.p.setHitpoints(0);
  playTo(a, 8);
  assert.equal(a.p.getAttribute("agility.obstacle") == null, true, "the crossing ended");
  assert.deepEqual(of(a.log, "tab").map(([, tab]) => tab), [9, 1]);
});

test("a second crossing keeps the bank rigged until 14 ticks after its own leg", (t) => {
  const first = actor(t, [3243, 3183]);
  click(first, 17068, RAFT);
  playTo(first, 8);
  const second = actor(t, [3246, 3180]);
  new ObjectActionPacketListener().executeAction(second.p, 17068, RAFT[0], RAFT[1], 1);
  // Both are played by World.process; count on the first player's ticks.
  const westAt = {};
  while (first.tick < 30) { const now = first.tick; first.process(); westAt[now] = ropes(3246, 3251).every((id) => id === ROPE); }
  const rigged = Object.keys(westAt).filter((tick) => westAt[tick]).map(Number);
  assert.equal(rigged.at(0), 8, "still rigged from the first crossing");
  assert.ok(rigged.at(-1) > 17, `kept past the first crossing's 14 ticks (to ${rigged.at(-1)})`);
  assert.deepEqual(second.tile(), [3259, 3179], "the second player crossed too");
  playTo(first, 50);
  assert.deepEqual([ropes(3246, 3251), locAt(WEST_TREE, 10)?.getId()], [[17030, null, 319, null, null, null], 17039]);
});
