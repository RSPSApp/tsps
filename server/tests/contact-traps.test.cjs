// Run after `yarn build`: node --test tests/contact-traps.test.cjs
//
// Contact!'s dungeon traps under Sophanem: walking onto a trap did nothing, and Evade/Disable
// printed "disable" or "set off" at random, with no walk across and no hit.
// Recorded (rsprox rec 3015, rev 231): the set-off a tick after stepping on (Ouch!, the four locs'
// release animation and synth), the hit a tick later at 10% of current hitpoints + 10 (Wiki,
// Contact!/Quick guide; 19/16/18/15 at 97/69/80/55), and Evade/Disable's line, synth 2387 and the
// walk across. Real map, real Player, packets in.
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
const Traps = require("../plugins/quests/contact/Traps.Contact")._test;

const SPIKES = "contact_spiketrap_floor";
const SPEARS = "contact_speartrap";
const SET_OFF = "You accidentally set off a trap!";
const EVADED = "You successfully evade the trap.";
const DISABLED = "You successfully disable the trap.";

let core;
let next = 9800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const trap of Traps.TRAPS) core.RegionManager.loadMapFiles(trap.minX, trap.minY);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at, { hitpoints = 99 } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("contacttrapqa" + p.getIndex());
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
  p.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99).setCurrentLevel(core.Skill.HITPOINTS, hitpoints);
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

async function click(f, gameval, x, y) {
  const id = core.CacheDefinitions.getLocId(gameval);
  await f.c.dispatch([{ type: "object_option", id, x, y, clickType: 1 }]);
  f.c.processTurnPackets();
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()];
const hp = (f) => f.p.getHitpoints();
const blocked = (x, y) => core.RegionManager.blocked(new core.Location(x, y, 2), null);
const texts = (f) => f.messages.map(([text]) => text);

test("every trap's four locs are on the map, and its floor and both far sides are walkable", () => {
  for (const trap of Traps.TRAPS) {
    const id = core.CacheDefinitions.getLocId(trap.gameval);
    for (const [x, y] of trap.locs) assert.ok(core.MapObjects.get(id, new core.Location(x, y, 2), null), `${trap.name} loc ${x},${y}`);
    for (let x = trap.minX; x <= trap.maxX; x++) {
      for (let y = trap.minY; y <= trap.maxY; y++) assert.equal(blocked(x, y), false, `${trap.name} floor ${x},${y}`);
    }
    for (let i = 0; i <= 1; i++) {
      const [lo, hi] = trap.axis === "x"
        ? [[trap.minX - 1, trap.minY + i], [trap.maxX + 1, trap.minY + i]]
        : [[trap.minX + i, trap.minY - 1], [trap.minX + i, trap.maxY + 1]];
      assert.equal(blocked(...lo), false, `${trap.name} near side ${lo}`);
      assert.equal(blocked(...hi), false, `${trap.name} far side ${hi}`);
    }
  }
});

test("damage is 10% of current hitpoints, rounded down, plus 10: the four recorded hits", () => {
  assert.deepEqual([97, 69, 80, 55].map(Traps.trapDamage), [19, 16, 18, 15]);
  assert.equal(Traps.trapDamage(9), 10);
});

test("stepping onto a spike trap sets it off the next tick (Ouch!, spikes, synth 1383), the hit a tick later", async (t) => {
  const f = actor(t, [2157, 4403, 2], { hitpoints: 97 });
  f.p.getMovementQueue().requestWalk(new core.Location(2158, 4403, 2), false);
  tick(f);
  assert.deepEqual(at(f), [2158, 4403, 2]);
  const stepped = core.World.getProcessCycle();
  assert.ok(!texts(f).includes(SET_OFF), "not on the step's own tick");
  tick(f);
  const line = f.messages.find(([text]) => text === SET_OFF);
  assert.ok(line, JSON.stringify(f.messages));
  assert.equal(line[1] - stepped, 1);
  assert.deepEqual(f.said.map(([text]) => text), ["Ouch!"]);
  assert.ok(f.sounds.includes(1383));
  assert.deepEqual(f.anims.sort(), [[2158, 4403, 1111], [2158, 4404, 1111], [2159, 4403, 1111], [2159, 4404, 1111]]);
  assert.equal(hp(f), 97, "no hit yet");
  const before = f.sounds.length;
  tick(f);
  assert.equal(97 - hp(f), 19);
  assert.ok(f.sounds.slice(before).some((id) => id >= 518 && id <= 521), `hurt sound with the hit: ${f.sounds}`);
  tick(f);
  tick(f);
  assert.equal(f.messages.filter(([text]) => text === SET_OFF).length, 1, "once per step on");
});

test("stepping onto a spear trap plays the spears' release (459, synth 1394) on all four wall locs", async (t) => {
  const f = actor(t, [2169, 4391, 2], { hitpoints: 80 });
  f.p.getMovementQueue().requestWalk(new core.Location(2169, 4389, 2), false);
  for (let i = 0; i < 6 && !texts(f).includes(SET_OFF); i++) tick(f);
  assert.ok(texts(f).includes(SET_OFF), JSON.stringify(f.messages));
  assert.ok(f.sounds.includes(1394));
  assert.deepEqual(f.anims.sort(), [[2168, 4388, 459], [2168, 4389, 459], [2170, 4388, 459], [2170, 4389, 459]]);
  tick(f);
  assert.equal(80 - hp(f), 18);
});

test("Evade from beside a spike trap: line and synth 2387, then a walk across to the far side, unhurt", async (t) => {
  for (const [start, loc, end] of [
    [[2160, 4403, 2], [2159, 4403], [2157, 4403, 2]], // rec 3015 tick 2252
    [[2147, 4403, 2], [2148, 4403], [2150, 4403, 2]], // tick 3347
    [[2168, 4357, 2], [2169, 4357], [2171, 4357, 2]], // tick 5924
  ]) {
    const f = actor(t, start);
    await click(f, SPIKES, ...loc);
    const path = [];
    for (let i = 0; i < 6; i++) {
      tick(f);
      path.push(at(f).join());
    }
    assert.deepEqual(texts(f), [EVADED]);
    assert.ok(f.sounds.includes(2387));
    assert.deepEqual(at(f), end, `crossed: ${path}`);
    assert.equal(new Set(path.slice(0, 3)).size, 3, `walked, not ran: ${path}`);
    assert.ok(!texts(f).includes(SET_OFF), JSON.stringify(f.messages));
    assert.equal(hp(f), 99);
  }
});

test("Disable a spear trap: across along the corridor (tick 4993), or west across the 2155 trap (tick 5985)", async (t) => {
  for (const [start, loc, end] of [
    [[2169, 4390, 2], [2168, 4389], [2169, 4387, 2]],
    [[2157, 4378, 2], [2156, 4378], [2154, 4378, 2]],
  ]) {
    const f = actor(t, start);
    await click(f, SPEARS, ...loc);
    for (let i = 0; i < 6; i++) tick(f);
    assert.deepEqual(texts(f), [DISABLED]);
    assert.ok(f.sounds.includes(2387));
    assert.deepEqual(at(f), end);
    assert.ok(!texts(f).includes(SET_OFF), JSON.stringify(f.messages));
    assert.equal(hp(f), 99);
  }
});

test("from on the floor: towards the clicked loc (tick 2339), or level with it by the nearer edge (tick 4815)", () => {
  const spikes = Traps.trapAt(2158, 4403, 2);
  const spears = Traps.trapAt(2169, 4389, 2);
  const L = (x, y) => new core.Location(x, y, 2);
  assert.deepEqual(Traps.farSide(spikes, L(2158, 4403), [2159, 4403]).getX(), 2160);
  const off = Traps.farSide(spears, L(2169, 4389), [2168, 4389]);
  assert.deepEqual([off.getX(), off.getY()], [2169, 4390]);
});

test("walking back onto a crossed trap sets it off again", async (t) => {
  const f = actor(t, [2160, 4403, 2]);
  await click(f, SPIKES, 2159, 4403);
  for (let i = 0; i < 6; i++) tick(f);
  assert.deepEqual(at(f), [2157, 4403, 2]);
  f.p.getMovementQueue().requestWalk(new core.Location(2158, 4403, 2), false);
  tick(f);
  tick(f);
  assert.ok(texts(f).includes(SET_OFF), JSON.stringify(f.messages));
});

test("other Trap locs elsewhere are left to their own handlers", (t) => {
  const f = actor(t, [3000, 3000, 0]);
  const plugin = require("../plugins/quests/contact/Traps.Contact");
  assert.equal(Traps.trapOf("spike", 3000, 3001, 0), null);
  assert.equal(Traps.trapOf("spear", 2158, 4403, 2), null, "a spike loc is not a spear trap");
  assert.ok(typeof plugin === "function");
  assert.deepEqual(f.messages, []);
});

test("Evade the far spike loc from the west: the route steps on (it goes off, then the hit), the evade follows and crosses east", async (t) => {
  const f = actor(t, [2157, 4403, 2], { hitpoints: 55 });
  await click(f, SPIKES, 2159, 4403); // rec 3015 tick 2337
  for (let i = 0; i < 8; i++) tick(f);
  const order = texts(f);
  assert.deepEqual(order, [SET_OFF, EVADED], "set off first, then the evade (ticks 2338, 2339)");
  const [setOff, evaded] = f.messages.map(([, cycle]) => cycle);
  assert.equal(evaded - setOff, 1, "the evade a tick after the set-off");
  assert.deepEqual(at(f), [2160, 4403, 2]);
  assert.equal(55 - hp(f), 15);
});
