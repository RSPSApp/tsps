// Run after `yarn build`: node --test tests/curse-of-arrav-spear-traps.test.cjs
//
// The Uzer Mastaba's spear traps (The Curse of Arrav): "Odd markings" had a Search option and
// nothing handled it, and walking the trap corridors did nothing.
// Wiki (Odd markings (Uzer Mastaba)): 62 Thieving, no XP, up to 19 damage walking past.
// Recorded (rsprox rec 3168, ticks 6658-6984): the disable/fail lines and sounds, the walk
// across after a disable, and the set-off a tick after stepping on (Ouch!, speartrap_release on
// the four markings, synth 1394) with the hit a tick after that. Real map, real Player, packets in.
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
const SpearTraps = require("../plugins/quests/coa/SpearTraps.CurseOfArrav")._test;

const SOUTH_MARKING = [3891, 4553, 0]; // coa_mastaba_spear_trap_1
const NORTH_MARKING = [3892, 4597, 0]; // coa_mastaba_spear_trap_1
const WEST_OF_SOUTH = [3890, 4553, 0];
const EAST_OF_SOUTH = [3893, 4552, 0];
const RELEASE = 459;

let core;
let next = 9900;
let markingId;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3891, 4552);
  core.RegionManager.loadMapFiles(3891, 4598);
  PM.emitServerStartup({});
  markingId = core.CacheDefinitions.getLocId("coa_mastaba_spear_trap_1");
});
after(() => PM.emitServerShutdown({}));

function actor(t, at, { thieving = 99 } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("speartrapqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...at));
  p.needsPlacement = false;
  core.World.getPlayers().add(p);
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const said = [];
  const sounds = [];
  const anims = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push([String(text), core.World.getProcessCycle()]); return sendMessage(text); });
  const forceChat = p.forceChat.bind(p);
  t.mock.method(p, "forceChat", (text) => { said.push([String(text), core.World.getProcessCycle()]); return forceChat(text); });
  const sender = p.getPacketSender();
  const sendSound = sender.sendSound.bind(sender);
  t.mock.method(sender, "sendSound", (id, ...rest) => { sounds.push(id); return sendSound(id, ...rest); });
  const sendCoreSound = core.Sounds.sendSound.bind(core.Sounds);
  t.mock.method(core.Sounds, "sendSound", (listener, sound, ...rest) => {
    if (listener === p) sounds.push(sound.getId?.() ?? sound.id);
    return sendCoreSound(listener, sound, ...rest);
  });
  const sendAnim = sender.sendObjectAnimation.bind(sender);
  t.mock.method(sender, "sendObjectAnimation", (object, animation) => {
    const l = object.getLocation();
    anims.push([l.getX(), l.getY(), animation.getId()]);
    return sendAnim(object, animation);
  });
  p.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99).setCurrentLevel(core.Skill.HITPOINTS, 99);
  p.getSkillManager().setMaxLevel(core.Skill.THIEVING, thieving).setCurrentLevel(core.Skill.THIEVING, thieving);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.World.getPlayers().remove(p);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, messages, said, sounds, anims };
}

function tick(f) {
  core.World.processCycle++;
  core.TaskManager.process();
  f.c.processTurnPackets();
  f.p.getCombat().getHitQueue().process(core.World.getProcessCycle());
  f.p.getMovementQueue().process();
  core.TaskManager.processWalkTo(f.p.getIndex());
  PM.emitPlayerProcess({ player: f.p });
  f.p.getSession().flushClient(core.World.getProcessCycle());
  f.p.resetUpdating();
}

async function search(f, at = SOUTH_MARKING, gameval = "coa_mastaba_spear_trap_1") {
  const id = core.CacheDefinitions.getLocId(gameval);
  await f.c.dispatch([{ type: "object_option", id, x: at[0], y: at[1], clickType: 1 }]);
  f.c.processTurnPackets();
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];
const hp = (f) => f.p.getHitpoints();
const blocked = (x, y) => core.RegionManager.blocked(new core.Location(x, y, 0), null);
const texts = (f) => f.messages.map(([text]) => text);

test("both corridors and the tiles either side are walkable", () => {
  for (const y of [4552, 4553, 4598, 4599]) {
    for (const x of [3890, 3891, 3892, 3893]) assert.equal(blocked(x, y), false, `${x},${y}`);
  }
  assert.ok(markingId > 0);
  const marking = core.MapObjects.get(markingId, new core.Location(...SOUTH_MARKING), null);
  assert.ok(marking, "the south marking is on the map");
});

test("a working search disables the trap and walks the player across without setting it off", async (t) => {
  t.mock.method(Math, "random", () => 0);
  const f = actor(t, WEST_OF_SOUTH);
  await search(f);
  const path = [];
  for (let i = 0; i < 8; i++) {
    tick(f);
    path.push(at(f).join());
  }
  assert.ok(texts(f).includes("You find a trap, but you successfully manage to disable it."), JSON.stringify(f.messages));
  assert.ok(f.sounds.includes(2387));
  assert.deepEqual(at(f), [3893, 4553, 0], `crossed on its row: ${path}`);
  assert.ok(path.includes("3891,4553,0") && path.includes("3892,4553,0"), `walked, not ran: ${path}`);
  assert.ok(!texts(f).includes("You accidentally set off a trap!"), JSON.stringify(f.messages));
  assert.equal(hp(f), 99);
  assert.equal(f.p.getXp?.(core.Skill.THIEVING) ?? 0, 0);
});

test("a failed search leaves the player where they are, unhurt", async (t) => {
  t.mock.method(Math, "random", () => 0.999);
  const f = actor(t, EAST_OF_SOUTH, { thieving: 70 });
  await search(f, [3892, 4551, 0], "coa_mastaba_spear_trap_4");
  for (let i = 0; i < 4; i++) tick(f);
  assert.ok(texts(f).includes("You find a trap! You try to disable it, but fail to do so."), JSON.stringify(f.messages));
  assert.ok(f.sounds.includes(4978));
  assert.deepEqual(at(f), EAST_OF_SOUTH);
  assert.equal(hp(f), 99);
});

test("below 62 Thieving the search always fails", async (t) => {
  t.mock.method(Math, "random", () => 0);
  const f = actor(t, WEST_OF_SOUTH, { thieving: 61 });
  await search(f);
  for (let i = 0; i < 4; i++) tick(f);
  assert.ok(texts(f).includes("You find a trap! You try to disable it, but fail to do so."), JSON.stringify(f.messages));
  assert.deepEqual(at(f), WEST_OF_SOUTH);
});

test("walking onto an undisabled corridor sets it off the next tick and hits up to 19 a tick later", async (t) => {
  for (const [start, step, markings] of [
    [[3893, 4552, 0], [3892, 4552, 0], [[3891, 4553], [3892, 4553], [3891, 4551], [3892, 4551]]],
    [[3890, 4598, 0], [3891, 4598, 0], [[3892, 4597], [3891, 4597], [3891, 4599], [3892, 4599]]],
  ]) {
    t.mock.method(Math, "random", () => 0.999);
    const f = actor(t, start);
    f.p.getMovementQueue().requestWalk(new core.Location(...step), false);
    tick(f);
    assert.deepEqual(at(f), step);
    const stepped = core.World.getProcessCycle();
    assert.ok(!texts(f).includes("You accidentally set off a trap!"), "not on the step's own tick");
    tick(f);
    const line = f.messages.find(([text]) => text === "You accidentally set off a trap!");
    assert.ok(line, JSON.stringify(f.messages));
    assert.equal(line[1] - stepped, 1);
    assert.deepEqual(f.said.map(([text]) => text), ["Ouch!"]);
    assert.ok(f.sounds.includes(1394));
    assert.deepEqual(f.anims.map(([x, y, id]) => [x, y, id]).sort(), markings.map(([x, y]) => [x, y, RELEASE]).sort());
    assert.equal(hp(f), 99, "no hit yet");
    const soundsBeforeHit = f.sounds.length;
    tick(f);
    assert.equal(99 - hp(f), 19, "the most the Wiki gives, with the roll pinned high");
    assert.ok(f.sounds.slice(soundsBeforeHit).some((id) => id >= 518 && id <= 521), `hurt sound with the hit: ${f.sounds}`);
    tick(f);
    tick(f);
    assert.equal(f.messages.filter(([text]) => text === "You accidentally set off a trap!").length, 1, "once per step on");
    t.mock.restoreAll();
  }
});

test("a disabled crossing only covers that crossing: stepping back on sets it off", async (t) => {
  t.mock.method(Math, "random", () => 0);
  const f = actor(t, WEST_OF_SOUTH);
  await search(f);
  for (let i = 0; i < 6; i++) tick(f);
  assert.deepEqual(at(f), [3893, 4553, 0]);
  f.p.getMovementQueue().requestWalk(new core.Location(3892, 4553, 0), false);
  tick(f);
  tick(f);
  assert.ok(texts(f).includes("You accidentally set off a trap!"), JSON.stringify(f.messages));
});

test("other Odd markings (Underground Pass upass_speartrap) are left to their own handler", (t) => {
  const f = actor(t, [2419, 9600, 0]);
  const object = { getLocation: () => new core.Location(2420, 9600, 0) };
  assert.equal(SpearTraps.searchMarkings({ player: f.p, object }), false);
  assert.deepEqual(f.messages, []);
});

test("the disable chance follows the Wiki's success chart (10/300 from 62); hits roll 1-19", () => {
  assert.equal(SpearTraps.disableChance(61), 0, "Ours: no chart below 62");
  assert.equal(SpearTraps.disableChance(62), 192 / 256);
  assert.ok(SpearTraps.disableChance(83) < 1);
  assert.equal(SpearTraps.disableChance(84), 1);
  assert.equal(SpearTraps.disableChance(99), 1);
  assert.equal(SpearTraps.rollHit(() => 0), 1);
  assert.equal(SpearTraps.rollHit(() => 0.999), 19);
});

test("searching the far marking: the route steps on (it goes off), then the crossing continues away from the entry side", async (t) => {
  t.mock.method(Math, "random", () => 0);
  const f = actor(t, [3890, 4552, 0]);
  await search(f, [3892, 4551, 0], "coa_mastaba_spear_trap_4");
  for (let i = 0; i < 10; i++) tick(f);
  assert.ok(texts(f).includes("You accidentally set off a trap!"), JSON.stringify(f.messages));
  assert.ok(texts(f).includes("You find a trap, but you successfully manage to disable it."), JSON.stringify(f.messages));
  assert.deepEqual(at(f), [3893, 4552, 0], "entered from the west, crossed on to the east");
  assert.equal(f.messages.filter(([text]) => text === "You accidentally set off a trap!").length, 1);
});
