// node --test tests/god-wars-altars.test.cjs
//
// The God Wars altars (the four generals' and the Ancient Prison's), as recorded at all five (rsprox.net locals
// 1000343, 1000349, 1000361, 1000367, 1000381 and 1000402, rev 227): "You recharge your Prayer." and "You cannot
// pray at the altar while in combat." on the spam channel, one cooldown (varbit godwars_altar_delay) for every altar,
// and Teleport as a cast: busy at 1, the screen black at 3, the landing at 5, the overlay back with "You are
// teleported to a place of relative safety." at 6. The real Chambers and Prison handlers, with a fake engine.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const GodWars = require("../plugins/bosses/godwars/Common.GodWars");
const Nex = require("../plugins/bosses/nex/Common.Nex");

const BUSY = 12393;
const MINIMAP_STATE = 6719;
const OVERLAY_ATMOSPHERE = (161 << 16) | 1;

class Location {
  constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
  getX() { return this.x; }
  getY() { return this.y; }
  getZ() { return this.z; }
}

function harness({ inCombat = false, prayerMax = 70, worn = [] } = {}) {
  const tasks = [];
  const log = [];
  const events = [];
  const clicks = { first: new Map(), second: new Map() };
  class Task {
    constructor(delay) { this.delay = delay; }
    stop() {}
  }
  const core = {
    Location,
    Task,
    TaskManager: { submit: (task) => tasks.push(task) },
    CombatFactory: { inCombat: () => state.inCombat },
    Skill: { PRAYER: 5, HITPOINTS: 3 },
    Sound: { PRAYER_RECHARGE: { id: 2674 }, TELEPORT: { id: 200 } },
    Sounds: {
      sendSound: (player, sound) => log.push(["sound", sound.id]),
      playAreaSoundAt: (player, sound, radius) => log.push(["area-sound", sound.id, radius]),
    },
    Animation: Object.assign(class { constructor(id) { this.id = id; } }, { DEFAULT_RESET_ANIMATION: { id: 65535 } }),
    Graphic: class { constructor(id) { this.id = id; } },
    ChatType: { SPAM: "spam" },
    ItemDefinition: { forId: (id) => ({ getName: () => ({ 1: "Bandos chestplate", 2: "Torva platebody" })[id] ?? "" }) },
  };
  const api = new Proxy({
    core,
    onObjectFirstClick: (ids, handler) => [].concat(ids).forEach((id) => clicks.first.set(id, handler)),
    onObjectSecondClick: (ids, handler) => [].concat(ids).forEach((id) => clicks.second.set(id, handler)),
    emitCustomEvent: (name, payload) => events.push([name, payload]),
    registerArea() {},
  }, { get: (target, key) => target[key] ?? (() => {}) });
  GodWars.init(api);
  Nex.init(api);
  const state = { inCombat, hitpoints: 99, registered: true, location: new Location(2864, 5360, 2), prayer: 10 };
  const attributes = new Map();
  const movement = { reset() { return movement; }, setBlockMovement: (blocked) => { log.push(["block", blocked]); return movement; } };
  const sender = {
    sendVarbit: (id, value) => { if (id === BUSY || id === MINIMAP_STATE) log.push(["varbit", id, value]); return sender; },
    sendString: (text, uid) => { log.push(["text", uid, text]); return sender; },
    sendSubInterface: (uid, id, type, options) => { log.push(["open", uid, id, options?.postScripts ?? null]); return sender; },
    closeSubInterface: (uid) => { log.push(["close", uid]); return sender; },
    sendTypedMessage: (type, text) => log.push(["spam", type, text]),
    sendRunEnergy() {},
    updateSpecialAttackOrb() {},
  };
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => state.location,
    getHitpoints: () => state.hitpoints,
    isRegistered: () => state.registered,
    setTeleporting: (teleporting) => { state.teleporting = teleporting; },
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === core.Skill.PRAYER ? prayerMax : 99),
      setCurrentLevels: (skill, level) => { state.prayer = level; },
      updateSkill() {},
    }),
    getEquipment: () => ({ getItems: () => worn.map((id) => ({ getId: () => id })) }),
    setPrayerPointDrain: (value) => log.push(["drain", value]),
    getPacketSender: () => sender,
    getMovementQueue: () => movement,
    getCombat: () => ({ reset: () => log.push(["combat-reset"]) }),
    sendMessage: (text) => log.push(["message", text]),
    performAnimation: (anim) => log.push(["anim", anim.id]),
    performGraphic: (gfx) => log.push(["gfx", gfx.id, gfx.height]),
    moveTo: (to) => { state.location = to; log.push(["move", to.getX(), to.getY(), to.getZ()]); },
    heal: () => log.push(["heal"]),
    setRunEnergy() {},
    setSpecialPercentage() {},
  };
  /** Runs the queued tasks in tick order; returns what each tick sent. */
  const run = () => {
    const byTick = {};
    for (const task of tasks.splice(0).sort((a, b) => a.delay - b.delay)) {
      const before = log.length;
      task.execute();
      (byTick[task.delay] ??= []).push(...log.slice(before));
    }
    return byTick;
  };
  return { api, core, clicks, log, events, run, player, state, attributes };
}

function attachChambers(h) {
  require("../plugins/bosses/godwars/Chambers.GodWars").attachChambers(h.api);
  return h;
}

function attachPrison(h) {
  h.core.Area = class {};
  h.core.Boundary = class {};
  require("../plugins/bosses/nex/Prison.Nex").attachPrison(h.api);
  return h;
}

const BANDOS_ALTAR = 26366;
const NEX_ALTAR = 42965;

test("a general's altar recharges Prayer (+1 per god item) with the recorded spam line", () => {
  const h = attachChambers(harness({ worn: [1] }));
  assert.equal(h.clicks.first.get(BANDOS_ALTAR)({ player: h.player, objectId: BANDOS_ALTAR }), true);
  assert.equal(h.state.prayer, 71, "70 + the Bandos chestplate");
  assert.deepEqual(h.log.filter(([kind]) => kind === "spam" || kind === "message"), [["spam", "spam", "You recharge your Prayer."]]);
  assert.ok(h.log.some((entry) => entry[0] === "anim" && entry[1] === 645));
  assert.ok(h.log.some((entry) => entry[0] === "sound" && entry[1] === 2674));
  assert.ok(Number(h.attributes.get(GodWars.ALTAR_ATTRIBUTE)) > 0, "the cooldown BuffTimers sends as godwars_altar_delay");
});

test("in combat the altar refuses on the spam channel, with no recharge", () => {
  const h = attachChambers(harness({ inCombat: true }));
  h.clicks.first.get(BANDOS_ALTAR)({ player: h.player, objectId: BANDOS_ALTAR });
  assert.equal(h.state.prayer, 10);
  assert.deepEqual(h.log, [["spam", "spam", "You cannot pray at the altar while in combat."]]);
  assert.equal(h.attributes.get(GodWars.ALTAR_ATTRIBUTE), undefined);
});

test("the cooldown is one for every altar: the Ancient Prison's refuses after a general's", () => {
  const h = attachPrison(attachChambers(harness()));
  h.clicks.first.get(BANDOS_ALTAR)({ player: h.player, objectId: BANDOS_ALTAR });
  h.log.length = 0;
  h.state.prayer = 10;
  assert.equal(h.clicks.first.get(NEX_ALTAR)({ player: h.player, objectId: NEX_ALTAR }), true);
  assert.equal(h.state.prayer, 10);
  assert.deepEqual(h.log, [["message", "The gods blessed you recently. They will ignore your prayers for another 10 minutes."]]);
  h.attributes.set(GodWars.ALTAR_ATTRIBUTE, Date.now() - 9.5 * 60 * 1000);
  h.log.length = 0;
  h.clicks.first.get(BANDOS_ALTAR)({ player: h.player, objectId: BANDOS_ALTAR });
  assert.deepEqual(h.log, [["message", "The gods blessed you recently. They will ignore your prayers for another minute."]]);
});

test("the Ancient Prison's altar: the same recharge line, and the Zarosian affinity line as spam", () => {
  const h = attachPrison(harness({ worn: [2] }));
  h.clicks.first.get(NEX_ALTAR)({ player: h.player, objectId: NEX_ALTAR });
  assert.equal(h.state.prayer, 70);
  assert.deepEqual(h.log.filter(([kind]) => kind === "spam" || kind === "message"), [
    ["spam", "spam", "You recharge your Prayer."],
    ["spam", "spam", "Your affinity to the Empty Lord energizes you further."],
  ]);
  assert.ok(h.log.some(([kind]) => kind === "heal"));
});

test("Teleport casts, goes black at 3, lands a tile past the door's outer tile at 5 and says so at 6 (local 1000402 t26530)", () => {
  const h = attachChambers(harness({ inCombat: true }));
  assert.equal(h.clicks.second.get(BANDOS_ALTAR)({ player: h.player, objectId: BANDOS_ALTAR }), true);
  assert.deepEqual(h.log, [["block", true], ["combat-reset"], ["anim", 714], ["gfx", 111, 92], ["area-sound", 200, 5]],
    "the cast on the click, in combat too");
  assert.equal(h.state.teleporting, true, "busy for the cast, so Player.busy() turns away a Pray mid-cast");
  const ticks = h.run();
  assert.equal(h.state.teleporting, false, "free again at 6");
  assert.deepEqual(Object.keys(ticks).map(Number), [1, 3, 5, 6]);
  assert.deepEqual(ticks[1], [["varbit", BUSY, 1]]);
  assert.deepEqual(ticks[3], [
    ["varbit", MINIMAP_STATE, 2],
    ["text", (174 << 16) | 4, ""],
    ["open", OVERLAY_ATMOSPHERE, 174, [{ scriptId: 948, args: [0, 0, 0, 0, 0] }]],
  ]);
  assert.deepEqual(h.events.map(([name]) => name), ["boss-hud:hide"]);
  assert.deepEqual(ticks[5], [["move", 2861, 5354, 2], ["anim", 65535]], "recorded landing, one tile past the outer tile");
  assert.deepEqual(ticks[6], [
    ["block", false],
    ["varbit", MINIMAP_STATE, 0],
    ["varbit", BUSY, 0],
    ["open", OVERLAY_ATMOSPHERE, GodWars.data.overlay.group, null],
    ["message", "You are teleported to a place of relative safety."],
  ]);
});

test("a player killed before the landing stays where they respawned, and the screen comes back", () => {
  const h = attachChambers(harness());
  h.clicks.second.get(BANDOS_ALTAR)({ player: h.player, objectId: BANDOS_ALTAR });
  h.state.hitpoints = 0;
  const ticks = h.run();
  assert.equal(h.state.teleporting, false, "the teleport flag is cleared even after a death");
  assert.deepEqual(ticks[5], [], "no landing");
  assert.deepEqual(ticks[6], [["varbit", MINIMAP_STATE, 0], ["varbit", BUSY, 0], ["close", OVERLAY_ATMOSPHERE]],
    "the death keeps movement blocked until the respawn");
});

test("the Ancient Prison's Teleport lands at the safe room's door on the same ticks (local 1000343 t26715)", () => {
  const h = attachPrison(harness());
  h.clicks.second.get(NEX_ALTAR)({ player: h.player, objectId: NEX_ALTAR });
  assert.equal(h.state.teleporting, true, "busy for the cast, so Player.busy() turns away a Pray mid-cast");
  const ticks = h.run();
  assert.equal(h.state.teleporting, false, "free again at 6");
  assert.deepEqual(Object.keys(ticks).map(Number), [1, 3, 5, 6]);
  assert.deepEqual(ticks[5], [["move", 2897, 5203, 0], ["anim", 65535]]);
  assert.equal(ticks[6].at(-1)[1], "You are teleported to a place of relative safety.");
});

test("a second Teleport click mid-cast does not queue another teleport", () => {
  const h = attachChambers(harness());
  h.clicks.second.get(BANDOS_ALTAR)({ player: h.player, objectId: BANDOS_ALTAR });
  const cast = h.log.length;
  h.clicks.second.get(BANDOS_ALTAR)({ player: h.player, objectId: BANDOS_ALTAR });
  assert.equal(h.log.length, cast);
  const ticks = h.run();
  assert.equal(ticks[5].filter(([kind]) => kind === "move").length, 1);
  h.clicks.second.get(BANDOS_ALTAR)({ player: h.player, objectId: BANDOS_ALTAR });
  assert.ok(h.log.length > cast, "free again once it ends");
});

test("praying at the Ancient Prison's altar starts the buff bar's godwars_altar_delay (4099) at 10, as recorded", () => {
  const h = attachPrison(harness());
  h.clicks.first.get(NEX_ALTAR)({ player: h.player, objectId: NEX_ALTAR });
  const BuffTimers = require("../plugins/interface/BuffTimers.plugin");
  const state = BuffTimers._test.getEffectState(h.player, Date.now(), 0);
  assert.deepEqual(state.find(([kind, id]) => kind === "varbit" && id === 4099), ["varbit", 4099, 10]);
});
