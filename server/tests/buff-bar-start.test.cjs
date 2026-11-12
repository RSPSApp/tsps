// Run after `yarn build`: node --test tests/buff-bar-start.test.cjs
// The buff bar's freeze, Staff of the dead, poison and venom, and Abyssal Sire stun buffs: started with
// buff_bar_start (script 5931) on the cache's structs, against the tick count the client draws them from.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const plugin = require("../plugins/interface/BuffBarStart.plugin");

const SCRIPT = 5931;
const FREEZE = { struct: 3092, name: "Bound." };
const SOTD = { struct: 3093, name: "Staff of the dead special.", ticks: 100 };
const POISON = { struct: 3740, name: "Time till next poison hit.", ticks: 30 };
const VENOM = { struct: 3741, name: "Time till next venom hit.", ticks: 30 };
const SIRE = { struct: 3091, name: "Abyssal sire stun." };
const FREEZE_KEY = { name: "FREEZE" };

before(async () => {
  await CachePipeline.initialize();
});

/** A player on a world whose tick the test moves, recording every buff_bar_start. */
function fixture() {
  const world = { cycle: 5000 };
  const hooks = {};
  plugin.register({
    core: { World: { getProcessCycle: () => world.cycle }, TimerKey: { FREEZE: FREEZE_KEY } },
    onPlayerLogin: (fn) => { hooks.login = fn; },
    onPlayerProcess: (fn) => { hooks.process = fn; },
    onPlayerLogout: (fn) => { hooks.logout = fn; },
    onCustomEvent: (name, fn) => { hooks[name] = fn; },
  });
  const state = { freeze: 0, poison: 0, venom: false, pulse: 30 };
  const attributes = new Map();
  const calls = [];
  const player = {
    getAttribute: (key) => attributes.get(key),
    getTimers: () => ({ getTicks: (key) => (key === FREEZE_KEY ? state.freeze : 0) }),
    getPoisonDamage: () => state.poison,
    isVenomed: () => state.venom,
    getCombat: () => ({ getPoisonClock: () => ({ snapshot: () => ({ counter: 0, ticksUntilPulse: state.pulse }) }) }),
    getPacketSender: () => ({ sendClientScript: (id, ...args) => calls.push([id, ...args]) }),
  };
  const sent = () => calls.splice(0).map(([id, struct, value]) => (assert.equal(id, SCRIPT), [struct, value]));
  const tick = () => { world.cycle++; hooks.process({ player }); };
  return { world, hooks, state, attributes, player, sent, tick, login: () => { hooks.login({ player }); hooks.process({ player }); } };
}

test("the structs are the cache's buffs, with the durations the bar draws them for", () => {
  for (const { struct, name, ticks } of [FREEZE, SOTD, POISON, VENOM, SIRE]) {
    const params = CacheDefinitions.getStructParams(struct);
    assert.equal(params.get(1279), name, `struct ${struct}`);
    if (ticks) assert.equal(Number(params.get(1541)), ticks, `struct ${struct} is drawn for ${ticks} ticks`);
  }
});

test("the tick after a login clears the freeze and the special when not running, as the client's varcs outlive a logout", () => {
  const f = fixture();
  f.login();
  assert.deepEqual(f.sent(), [[FREEZE.struct, 0], [SOTD.struct, 0]], "poison is hidden by varp poison, so it gets no clear");
  f.tick();
  assert.deepEqual(f.sent(), [], "nothing changed");
});

test("a freeze sends the tick it ends on once, and 0 when it ends", () => {
  const f = fixture();
  f.login();
  f.sent();
  f.state.freeze = 33;
  f.tick();
  assert.deepEqual(f.sent(), [[FREEZE.struct, 5001 + 33]]);
  while (f.state.freeze > 1) { f.state.freeze--; f.tick(); }
  assert.deepEqual(f.sent(), [], "the end tick does not move while it counts down");
  f.state.freeze = 0;
  f.tick();
  assert.deepEqual(f.sent(), [[FREEZE.struct, 0]]);
});

test("the Staff of the dead special sends the tick it started on, and 0 once its minute is up", () => {
  const f = fixture();
  f.login();
  f.sent();
  f.attributes.set("power-of-death:until", 5001 + 100);
  f.tick();
  assert.deepEqual(f.sent(), [[SOTD.struct, 5001]]);
  while (f.world.cycle < 5100) f.tick();
  assert.deepEqual(f.sent(), []);
  f.tick();
  assert.deepEqual(f.sent(), [[SOTD.struct, 0]], "the minute is up");
});

test("taking damage without a staff clears the special's attribute, and the buff with it", () => {
  const f = fixture();
  f.login();
  f.sent();
  f.attributes.set("power-of-death:until", 5001 + 100);
  f.tick();
  f.sent();
  f.attributes.set("power-of-death:until", null);
  f.tick();
  assert.deepEqual(f.sent(), [[SOTD.struct, 0]]);
});

test("poison sends the tick of each hit, 30 ticks apart, and nothing at a cure, as recorded", () => {
  const f = fixture();
  f.login();
  f.sent();
  f.state.poison = 6;
  f.state.pulse = 30;
  f.tick();
  assert.deepEqual(f.sent(), [[POISON.struct, 5001]]);
  for (let i = 0; i < 29; i++) { f.state.pulse--; f.tick(); }
  assert.deepEqual(f.sent(), [], "the pulse's start does not move while it counts down");
  f.state.pulse = 30; // the hit lands and the next pulse starts
  f.tick();
  assert.deepEqual(f.sent(), [[POISON.struct, 5031]]);
  f.state.poison = 0;
  f.tick();
  assert.deepEqual(f.sent(), [], "a cure sends no clear");
});

test("a pulse held back by an open interface keeps its value; venom uses its own struct", () => {
  const f = fixture();
  f.login();
  f.sent();
  f.state.poison = 6;
  f.state.pulse = 1;
  f.tick();
  assert.deepEqual(f.sent(), [[POISON.struct, 5001 + 1 - 30]]);
  f.state.pulse = 0;
  f.tick();
  f.tick();
  assert.deepEqual(f.sent(), [], "an overdue pulse is not resent each tick");
  f.state.venom = true;
  f.state.pulse = 30;
  f.tick();
  assert.deepEqual(f.sent(), [[VENOM.struct, 5004]]);
});

test("an unwatched bot gets none", () => {
  const f = fixture();
  f.player.isUnwatchedBot = () => true;
  f.state.freeze = 10;
  f.login();
  f.tick();
  assert.deepEqual(f.sent(), []);
});

test("the Sire's stun event starts its buff for that player", () => {
  const f = fixture();
  f.hooks["abyssal-sire:stunned"]({ player: f.player });
  assert.deepEqual(f.sent(), [[SIRE.struct, 1]]);
});

test("logout forgets what was sent, so the next login sends it again", () => {
  const f = fixture();
  f.login();
  f.state.freeze = 10;
  f.tick();
  f.sent();
  f.hooks.logout({ player: f.player });
  f.hooks.login({ player: f.player });
  assert.deepEqual(f.sent(), [], "nothing at the login itself, before the bar is built");
  f.hooks.process({ player: f.player });
  assert.deepEqual(f.sent(), [[FREEZE.struct, 5001 + 10], [SOTD.struct, 0]]);
});
