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
    messages: [],
    sendMessage(message) { this.messages.push(message); },
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
  // Wiki: "Sailing requires completing the Pandemonium quest" - started (2) or part-way is not enough.
  const sailing = { ...xp, SAILING: 0, HUNTER: 10, HERBLORE: 20, RUNECRAFTING: 20, CONSTRUCTION: 20 };
  for (const stage of [2, 30, 49]) assert.equal(lowestSkill(fakePlayer({ xp: sailing, quests: { pandemonium: stage } })).name, "HUNTER", `stage ${stage}`);
  assert.equal(lowestSkill(fakePlayer({ xp: sailing, quests: { pandemonium: 50 } })).name, "SAILING");
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

function captureApi(overrides = {}) {
  const hooks = {};
  const captured = new Proxy({ ...api, ...overrides }, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => { hooks[name] ??= []; hooks[name].push(args); };
    },
  });
  return { api: captured, hooks, event: (name) => hooks.onCustomEvent.find(([key]) => key === name)[1] };
}

test("Juna rechecks free hands and the weekly gate when the admission dialogue finishes", () => {
  const h = captureApi();
  Juna(h.api);
  const action = h.event("npc-dialogue:action");
  const equipment = {};
  const player = fakePlayer({ equipment });
  assert.equal(Juna._test.answerCondition({ npcId: core.NpcIdentifiers.JUNA, player, stepId: "xCJjUs" }), true);
  equipment[core.Equipment.SHIELD_SLOT] = 1187;
  action({ npcId: core.NpcIdentifiers.JUNA, player, stepId: "1SFGWK" });
  assert.equal(Cave.isPlaying(player), false);
  assert.match(player.messages.pop(), /both hands free/);
  delete equipment[core.Equipment.SHIELD_SLOT];
  player.setAttribute(Cave.LAST_VISIT_ATTRIBUTE, { day: Cave.today(), questPoints: 0, totalXp: 0 });
  action({ npcId: core.NpcIdentifiers.JUNA, player, stepId: "1SFGWK" });
  assert.equal(Cave.isPlaying(player), false);
  assert.match(player.messages.pop(), /not yet eligible/);
});

test("the journal shows both outstanding requirements and eligible reminders happen once per UTC day", () => {
  const h = captureApi();
  Juna(h.api);
  const player = fakePlayer({ attributes: {
    "tears-of-guthix:reminders": true,
    [Cave.LAST_VISIT_ATTRIBUTE]: { day: Cave.today() - 6, questPoints: 0, totalXp: 0 },
  } });
  const journal = { player, lines: [] };
  h.event("tears-of-guthix:journal")(journal);
  assert.match(journal.lines[0], /1 day/);
  assert.match(journal.lines[1], /1 Quest Point or 100,000 XP/);
  const login = h.hooks.onPlayerLogin[0][0];
  login({ player });
  assert.equal(player.messages.length, 0);
  player.setAttribute(Cave.LAST_VISIT_ATTRIBUTE, { day: Cave.today() - 7, questPoints: 0, totalXp: 0 });
  player.setAttribute("total-xp", 100000);
  login({ player });
  login({ player });
  assert.deepEqual(player.messages, ["You are eligible to drink from the Tears of Guthix."]);
  player.setAttribute("tears-of-guthix:last-reminder", Cave.today() - 1);
  login({ player });
  assert.equal(player.messages.length, 2);
});

test("light creatures require the lit sapphire lantern and leave the WGS creature alone", () => {
  const tasks = [];
  const h = captureApi({ core: { ...core, TaskManager: { submit: (task) => tasks.push(task) } } });
  require("../plugins/minigames/tearsofguthix/Chasm.TearsOfGuthix")(h.api);
  const attract = h.hooks.onNpcInteraction[0][1].Attract;
  const npc = (x, y) => ({ getId: () => core.NpcIdentifiers.LIGHT_CREATURE_4, getLocation: () => new core.Location(x, y, 2) });
  const player = fakePlayer();
  let lantern = 4701;
  player.getInventory = () => ({ contains: (id) => id === lantern });
  assert.equal(attract({ player, npc: npc(3226, 9518) }), true);
  assert.equal(tasks.length, 0);
  assert.match(player.messages.pop(), /lit sapphire lantern/);
  assert.equal(attract({ player, npc: npc(3228, 9525) }), false);
  lantern = 4702;
  player.getLocation = () => new core.Location(3233, 9525, 2);
  player.getCombat = () => ({ reset() {} });
  player.getMovementQueue = () => ({ reset() {} });
  player.setForceMovement = (move) => { player.force = move; };
  player.getForceMovement = () => player.force;
  player.moveTo = (at) => { player.at = at; };
  attract({ player, npc: npc(3226, 9518) });
  tasks.pop().execute();
  assert.deepEqual([player.at.x, player.at.y, player.at.z], [3229, 9505, 2]);
});

test("WGS leaves the crossing creatures to Tears and still handles its northern descent", () => {
  const h = captureApi(), plays = [];
  require("../plugins/quests/wgs/Chasm.WhileGuthixSleeps")({
    api: h.api, ATTRIBUTES: [], stage: () => 720, held: () => true, play: (...args) => plays.push(args),
  });
  const attract = h.hooks.onNpcInteraction.find(([name]) => name === "Light creature")[1].Attract;
  const player = { getLocation: () => new core.Location(3235, 9526, 2) };
  const npc = (y) => ({ getId: () => 5435, getLocation: () => new core.Location(3226, y, 2) });
  assert.equal(attract({ player, npcId: 5435, npc: npc(9518) }), false);
  const crossing = { player, itemId: 4702, target: npc(9518) };
  h.hooks.onItemOnNpc[0][0](crossing);
  assert.equal(crossing.handled, undefined);
  assert.equal(attract({ player, npcId: 5435, npc: npc(9525) }), true);
  assert.equal(plays[0][2], "into-the-chasm-attracting-a-light-creature");
});

test("simultaneous visits are private, share the world's stream colours and clean up on logout or reward", () => {
  const tasks = [];
  const h = captureApi({ core: {
    ...core,
    TaskManager: { submit: (task) => tasks.push(task) },
    MapObjects: { get: () => null },
    ObjectManager: { register(object) {
      const area = object.getPrivateArea();
      for (const old of area?.getObjects() ?? []) {
        if (old !== object && old.getType() === object.getType() && old.getLocation().equals(object.getLocation())) area.detach(old);
      }
    } },
  } });
  Cave(h.api);
  h.hooks.onServerStartup[0][0]();
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const makePlayer = (index) => {
    const player = new Player(null, new core.Location(3251, 9516, 2));
    player.setIndex(index);
    player.setAttribute("quest.points", 50);
    player.getPacketSender = () => new Proxy({}, { get: () => () => {} });
    player.getInventory().refreshItems = () => {};
    player.getEquipment().refreshItems = () => {};
    return player;
  };
  const first = makePlayer(1), second = makePlayer(2);
  Cave.enter(first);
  Cave.enter(second);
  const firstArea = first.getPrivateArea(), secondArea = second.getPrivateArea();
  assert.ok(firstArea instanceof core.PrivateArea);
  assert.notEqual(firstArea, secondArea);
  assert.deepEqual(firstArea.getPlayers(), [first]);
  assert.deepEqual(secondArea.getPlayers(), [second]);
  const colours = (area) => area.getObjects().map((obj) => [obj.getLocation().x, obj.getLocation().y, obj.getId()]).sort();
  for (let i = 0; i < 32; i++) tasks[0].execute();
  assert.equal(firstArea.getObjects().length, 9);
  assert.deepEqual(colours(firstArea), colours(secondArea));

  h.hooks.onPlayerLogout[0][0]({ player: first });
  assert.equal(firstArea.isDestroyed(), true);
  assert.equal(Cave.isPlaying(first), false);
  assert.equal(first.getAttribute(Cave.LAST_VISIT_ATTRIBUTE), undefined, "abandoning does not use the week");
  assert.equal(first.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), -1);
  assert.equal(secondArea.isDestroyed(), false);

  h.api.emitCustomEvent = (name, request) => { if (name === "diary:is-complete") request.complete = true; };
  Cave._test.games.get(second).tears = 10;
  Cave.finish(second);
  secondArea.process(second); // outside Juna: drink and release the instance
  assert.equal(secondArea.isDestroyed(), true);
  tasks.at(-1).execute();
  assert.equal(Cave.isPlaying(second), false);
  assert.equal(second.getAttribute(Cave.LAST_VISIT_ATTRIBUTE).day, Cave.today());
  assert.equal(second.getAttribute("tears-of-guthix:personal-best"), 10);
  assert.equal(second.getSkillManager().getExperience(core.Skill.ATTACK), 110, "the hard diary adds exactly 10%");
  tasks.at(-1).execute();
  assert.equal(second.getSkillManager().getExperience(core.Skill.ATTACK), 110, "a delayed callback cannot pay twice");

  const third = makePlayer(3);
  third.setAttribute("quest.points", 2);
  Cave.enter(third);
  const thirdArea = third.getPrivateArea();
  third.setLocation(new core.Location(3257, 9517, 2));
  thirdArea.process(third);
  assert.equal(Cave._test.games.get(third).leaving, false);
  thirdArea.process(third);
  assert.equal(Cave._test.games.get(third).leaving, true, "one tick per quest point");
  h.hooks.onPlayerBeforeDeath[0][0]({ player: third });
  assert.equal(thirdArea.isDestroyed(), true);
  assert.equal(third.getEquipment().getSlot(core.Equipment.WEAPON_SLOT), -1, "the bowl is removed before death item handling");
  assert.equal(third.getAttribute(Cave.LAST_VISIT_ATTRIBUTE), undefined, "death before drinking allows a retry");

  const fourth = makePlayer(4);
  Cave.enter(fourth);
  const fourthArea = fourth.getPrivateArea();
  h.hooks.onServerShutdown[0][0]();
  assert.equal(fourthArea.isDestroyed(), true);
  assert.equal(Cave._test.games.size, 0);

  const fifth = makePlayer(5);
  Cave.enter(fifth);
  const fifthArea = fifth.getPrivateArea();
  h.hooks.onPlayerDisconnect[0][0]({ player: fifth });
  assert.equal(fifthArea.isDestroyed(), true);
  assert.equal(fifth.getAttribute(Cave.LAST_VISIT_ATTRIBUTE), undefined);
});
