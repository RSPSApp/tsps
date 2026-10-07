// Run after `yarn build`: node --test tests/tears-of-guthix.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");

const Streams = require("../plugins/minigames/tearsofguthix/Streams.TearsOfGuthix");
const Cave = require("../plugins/minigames/tearsofguthix/Cave.TearsOfGuthix");
const Juna = require("../plugins/minigames/tearsofguthix/Juna.TearsOfGuthix");

const core = PluginManager.getCoreApi();
const events = [];
const api = {
  core,
  emitCustomEvent(name, payload) {
    events.push(name);
    if (name === "construction:owns-house") payload.owns = false;
    if (name === "diary:is-complete") payload.complete = false;
  },
};
Cave._test.setCore(core);
Cave._test.setApi(api);
Juna._test.setApi(api);

function seeded(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

test("three blue and three green streams flow at all times, each for 16 ticks", () => {
  const moves = [];
  const streams = Streams.createStreams({ random: seeded(7), onChange: (wall, colour) => moves.push({ wall, colour }) });
  const arrived = new Map();
  for (let tick = 1; tick <= 160; tick++) {
    moves.length = 0;
    streams.tick();
    const colours = Streams.WALLS.map((_, index) => streams.colourAt(index));
    assert.equal(colours.filter((colour) => colour === Streams.BLUE).length, 3);
    assert.equal(colours.filter((colour) => colour === Streams.GREEN).length, 3);
    assert.ok(moves.length <= 2, "streams move one after another");
    if (!moves.length) continue;
    const [left, landed] = moves;
    assert.equal(left.colour, Streams.NONE);
    assert.notEqual(landed.wall, left.wall, "a stream never lands back where it left");
    if (arrived.has(left.wall)) assert.equal(tick - arrived.get(left.wall), Streams.STREAM_TICKS);
    arrived.delete(left.wall);
    arrived.set(landed.wall, tick);
  }
});

test("the world's order of streams is fixed", () => {
  const streams = Streams.createStreams({ random: seeded(3) });
  const before = streams.sequence().join();
  for (let tick = 0; tick < 64; tick++) streams.tick();
  assert.equal(streams.sequence().join(), before);
});

test("each tear is worth min(60, 10 + floor(xp / 27) / 10)", () => {
  const { xpPerTear } = Cave._test;
  assert.equal(xpPerTear(0), 10);
  assert.equal(xpPerTear(100), 10.3);
  assert.equal(xpPerTear(13363), 59.4);
  assert.equal(xpPerTear(14000), 60);
});

function fakePlayer({ xp = {}, quests = {}, attributes = {}, equipment = {} } = {}) {
  const attrs = new Map(Object.entries(attributes));
  for (const [key, stage] of Object.entries(quests)) attrs.set(`quest.${key}.stage`, stage);
  const varbits = new Map([[451, 2]]);
  return {
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getSkillManager: () => ({
      getExperience: (skill) => xp[Object.keys(core.Skill).find((name) => core.Skill[name] === skill)] ?? 1000,
      getTotalExp: () => attrs.get("total-xp") ?? 0,
    }),
    getEquipment: () => ({ getSlot: (slot) => equipment[slot] ?? -1 }),
    getPacketSender: () => ({ getVarbit: (id) => varbits.get(id) ?? 0, sendVarbit: (id, value) => varbits.set(id, value) }),
  };
}

test("the tears go to the least-trained skill, Attack first on a tie", () => {
  const { lowestSkill } = Cave._test;
  assert.equal(lowestSkill(fakePlayer()).name, "ATTACK");
  assert.equal(lowestSkill(fakePlayer({ xp: { FISHING: 5 } })).name, "FISHING");
});

test("skills the player can't train yet are skipped", () => {
  const { lowestSkill } = Cave._test;
  const xp = { HERBLORE: 0, RUNECRAFTING: 0, CONSTRUCTION: 0, SAILING: 0, HUNTER: 10 };
  assert.equal(lowestSkill(fakePlayer({ xp })).name, "HUNTER");
  assert.equal(lowestSkill(fakePlayer({ xp, quests: { druidic_ritual: 4 } })).name, "HERBLORE");
});

test("Juna lets a player in once a week, after new adventures", () => {
  const { answerCondition } = Juna._test;
  const juna = core.NpcIdentifiers.JUNA;
  const ask = (player, stepId) => answerCondition({ npcId: juna, player, stepId, text: "" });
  const today = Cave.today();

  const first = fakePlayer();
  assert.equal(ask(first, "xCJjUs"), true, "the first visit is free");

  const recent = fakePlayer({ attributes: { "quest.points": 50, "total-xp": 0, [Cave.LAST_VISIT_ATTRIBUTE]: { day: today - 3, questPoints: 49, totalXp: 0 } } });
  assert.equal(ask(recent, "xCJjUs"), false);
  assert.equal(ask(recent, "ZcrLIs"), true, "come back in 4 days");

  const stale = fakePlayer({ attributes: { "quest.points": 50, "total-xp": 99999, [Cave.LAST_VISIT_ATTRIBUTE]: { day: today - 7, questPoints: 50, totalXp: 0 } } });
  assert.equal(ask(stale, "xCJjUs"), false, "no new quest point or 100,000 XP");
  assert.equal(ask(stale, "PlgV_M"), true);

  const ready = fakePlayer({ attributes: { "quest.points": 50, "total-xp": 100000, [Cave.LAST_VISIT_ATTRIBUTE]: { day: today - 7, questPoints: 50, totalXp: 0 } } });
  assert.equal(ask(ready, "xCJjUs"), true);

  const armed = fakePlayer({ equipment: { [core.Equipment.WEAPON_SLOT]: 4151 } });
  assert.equal(ask(armed, "xVIAF8"), true, "the bowl needs empty hands");
});

test("right-click Story plays only Juna's verdict", () => {
  const { verdictSteps } = Juna._test;
  const fs = require("node:fs");
  const path = require("node:path");
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/definitions/npc-dialogues.json"), "utf8"));
  const steps = verdictSteps(data.Juna.variants["standard-dialogue"]);
  assert.deepEqual(steps.map((step) => step.id), ["xVIAF8", "PlgV_M", "ZcrLIs", "gbeW2g", "OHiPEk", "xCJjUs"]);
});
