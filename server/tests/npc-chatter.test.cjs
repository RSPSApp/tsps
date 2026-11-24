// NpcChatter: ambient overhead lines from data/definitions/npc-captured-chatter.json (rsprox
// captures), said by NPCs in active regions at the captured spacing, with their animation and
// area sound; busy NPCs wait, fight chatter waits for a fight, and the exclusions hold.
//
// Run after `yarn build`: node --test tests/npc-chatter.test.cjs
const assert = require("node:assert/strict");
const { before, beforeEach, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Chatter = require("../plugins/npcs/NpcChatter.plugin");
const SKIP = require("../plugins/npcs/data/npc-chatter.json");
const { load, entryFor, sampleGap, gestureFor, tick, chatterById, live, schedule, setRandom, reset, readDefinitions, setCore } = Chatter._test;

let core;
let definitions;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  setCore(core);
  definitions = readDefinitions();
  load(definitions);
});

/** A seeded generator (mulberry32), so every run draws the same gaps and lines. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  reset();
  setRandom(seeded(6754));
});

function entry(name) {
  return Object.values(definitions.npcs).find((npc) => npc.name === name);
}

/** A stub NPC with `id`, recording what it says, plays and who it is busy with. */
function npc(id, { at = [3237, 3237, 0] } = {}) {
  const location = new core.Location(...at);
  const stub = {
    said: [], played: [], registered: true, interacting: null, target: null, attacker: null,
    getId: () => id, getLocation: () => location, isRegistered: () => stub.registered,
    isDyingFunction: () => false, getInteractingMobile: () => stub.interacting,
    getCombat: () => ({ getTarget: () => stub.target, getAttacker: () => stub.attacker }),
    forceChat: (text) => stub.said.push(text),
    performAnimation: (animation) => stub.played.push(animation.getId()),
  };
  return stub;
}

/** Runs ticks `from`..`to` with `npcs` active, collecting the area sounds played. */
function run(t, npcs, from, to) {
  t.mock.method(core.World, "getActiveNpcsForUpdate", () => npcs);
  t.mock.method(core.World, "isLocationActive", () => true);
  const sounds = [];
  t.mock.method(core.Sounds, "playAreaSound", (options) => sounds.push(options));
  for (let now = from; now <= to; now++) tick(now);
  return sounds;
}

const PLAYER = { isPlayer: () => true, isNpc: () => false };
const AN_NPC = { isPlayer: () => false, isNpc: () => true };

test("every captured NPC name resolves in the cache, and every excluded name is a real NPC", () => {
  for (const [id, npcEntry] of Object.entries(definitions.npcs)) {
    assert.equal(String(core.CacheDefinitions.getNpcId(npcEntry.name)), id, npcEntry.name);
  }
  for (const name of Object.values(SKIP.skipNpcs).flat()) {
    assert.notEqual(core.CacheDefinitions.getNpcId(name), null, `skipNpcs ${name}`);
  }
});

test("excluded NPCs and theft answers are never scheduled; ducks, sheep, GE experts and goblins are", () => {
  for (const name of Object.values(SKIP.skipNpcs).flat()) {
    assert.equal(chatterById.has(core.CacheDefinitions.getNpcId(name)), false, name);
  }
  for (const chatter of chatterById.values()) {
    for (const line of chatter.lines) assert.doesNotMatch(line.text, /what do you think you're doing|get your hands off/i);
  }
  for (const name of ["duck", "sheepunsheered", "ge_expert_herbs", "pmod_town_crier_draynor", "goblin_red_soldier_6"]) {
    assert.equal(chatterById.has(core.CacheDefinitions.getNpcId(name)), true, name);
  }
});

test("NPCs other plugins make speak are left to them", () => {
  for (const name of ["warguild_shanomi", "warguild_kamfreena", "dwarf_city_train_conductor4", "ghast_invis",
    "fossil_crazy_archaeologist", "varlamore_wealthy_citizen_a", "varlamore_thieving_house_owner_1"]) {
    assert.equal(chatterById.has(core.CacheDefinitions.getNpcId(name)), false, name);
  }
  assert.equal(chatterById.has(core.CacheDefinitions.getNpcId("dwarf_city_train_conductor2")), true,
    "the Keldagrim announcer, which Chatter.KeldagrimMinecarts.js leaves out, is ours");
});

test("town criers announce only current news; no line is blank; a hit's sound is not a line's", () => {
  for (const crier of Object.values(definitions.npcs).filter((npc) => npc.name.startsWith("pmod_town_crier"))) {
    for (const line of crier.lines) assert.doesNotMatch(line.text, /Christmas|Halloween|Leagues V|Easter|Grid Master/, crier.name);
  }
  for (const npcEntry of Object.values(definitions.npcs)) {
    for (const line of npcEntry.lines) assert.notEqual(line.text.trim(), "", npcEntry.name);
  }
  for (const npcEntry of Object.values(definitions.npcs).filter((npc) => npc.name.startsWith("goblin_"))) {
    for (const line of npcEntry.lines) assert.equal(line.sound, undefined, `${npcEntry.name}: ${line.text}`);
  }
});

test("the Blast Furnace foreman keeps only his unconditional lines; pre-launch crier banners are left out", () => {
  const foreman = chatterById.get(core.CacheDefinitions.getNpcId("blast_furnace_instructor"));
  const said = foreman.lines.map((line) => line.text);
  assert.ok(said.includes("Work faster!") && said.includes("Keep the temperature controlled."));
  assert.ok(!said.some((text) => /^Somebody (fix|refuel)/.test(text)), "repair calls follow the machinery");
  for (const name of ["pmod_town_crier_draynor", "pmod_town_crier_varrock", "pmod_town_crier_east_ardoyne"]) {
    const texts = chatterById.get(core.CacheDefinitions.getNpcId(name)).lines.map((line) => line.text);
    assert.ok(texts.includes("Hardcore Worlds are now live!"), name);
    assert.ok(!texts.some((text) => /open November 4th|begins with two new quests/.test(text)), name);
  }
});

test("sheep and calves bleat and moo with their captured sounds", (t) => {
  assert.deepEqual(entry("sheepunsheered").lines[0].sound, { id: 2053, range: 5 }, "the Lumbridge flock");
  assert.deepEqual(entry("calf").lines[0].sound, { id: 3044, range: 10 });
  const sheep = npc(core.CacheDefinitions.getNpcId("sheepunsheered"), { at: [3200, 3266, 0] });
  const sounds = run(t, [sheep], 1, 300);
  assert.ok(sheep.said.length >= 5);
  assert.equal(sounds.length, sheep.said.length);
  assert.ok(sounds.every((sound) => sound.soundId === 2053));
});

test("a town crier alternates ringing his bell and scratching his head, as live does", (t) => {
  const line = entry("pmod_town_crier_draynor").lines.find((l) => l.text === "Hardcore Worlds are now live!");
  assert.ok(line.gestures?.length >= 2, "the line alternates gestures");
  const crier = npc(core.CacheDefinitions.getNpcId("pmod_town_crier_draynor"), { at: [3095, 3249, 0] });
  const sounds = run(t, [crier], 1, 4000);
  const seqs = new Set(crier.played);
  const gestureSeqs = new Set(line.gestures.map((g) => g.seq));
  assert.ok([...gestureSeqs].every((seq) => seqs.has(seq)), `played ${[...seqs]}`);
  assert.ok(sounds.length > 0 && sounds.length < crier.said.length, "only the head scratch has an area sound");
  assert.ok(sounds.every((sound) => sound.soundId === 3816));
  assert.deepEqual(gestureFor({ text: "x", seq: 5, weight: 1 }), { text: "x", seq: 5, weight: 1 }, "a line's own gesture");
});

test("the H.A.M. deacon preaches whole sentences, fragment after fragment", (t) => {
  const deacon = entry("favour_deacon");
  assert.ok(deacon.phrases.length >= 5);
  const sentence = deacon.phrases.find((phrase) => phrase[0] === "Let them not ");
  assert.deepEqual(sentence, ["Let them not ", "infest our ", "cities and towns..."]);
  const stub = npc(core.CacheDefinitions.getNpcId("favour_deacon"), { at: [3165, 9628, 0] });
  run(t, [stub], 1, 2000);
  const starts = new Map(deacon.phrases.map((phrase) => [phrase[0], phrase]));
  let i = 0;
  let sentences = 0;
  while (i < stub.said.length) {
    const phrase = starts.get(stub.said[i]);
    assert.ok(phrase, `"${stub.said[i]}" (line ${i}) does not start a sentence`);
    const rest = stub.said.slice(i, i + phrase.length);
    if (rest.length < phrase.length) break;
    assert.deepEqual(rest, phrase);
    i += phrase.length;
    sentences++;
  }
  assert.ok(sentences >= 10, `${sentences} sentences`);
});

test("every Goblin Village soldier and every barbarian shouts only in a fight", (t) => {
  const rivalries = require("../data/definitions/npc-rivalries.json").rivalries;
  const goblins = rivalries.find((r) => r.name.startsWith("Goblin Village")).sides.flatMap((side) => side.npcs);
  for (const id of goblins) assert.equal(chatterById.get(id)?.fighting, true, `goblin ${id}`);
  for (const name of ["fai_barbarian_female_2", "fai_barbarian_female_3", "fai_barbarian_6"]) {
    assert.equal(chatterById.get(core.CacheDefinitions.getNpcId(name))?.fighting, true, name);
  }
  const barbarian = npc(core.CacheDefinitions.getNpcId("fai_barbarian_female_3"), { at: [3075, 3420, 0] });
  run(t, [barbarian], 1, 120);
  assert.deepEqual(barbarian.said, [], "no war cry while nothing fights her");
});

test("idle loops are not gestures; a family takes its excluded member's exclusion", () => {
  for (const name of ["dorgesh_male_leather_seller", "dorgesh_market_female3"]) {
    for (const line of entry(name).lines) {
      assert.equal(line.seq, undefined, `${name}: ${line.text}`);
      assert.equal(line.gestures, undefined, `${name}: ${line.text}`);
    }
  }
  for (const name of ["poh_hangman_armour2", "poh_hangman_armour4"]) {
    assert.equal(entry(name)?.family != null, true, `${name} comes from its family`);
    assert.equal(chatterById.has(core.CacheDefinitions.getNpcId(name)), false, name);
  }
});

test("a gap stays between the 5th and 95th percentiles, centred on the median", () => {
  const gap = entry("duck").gap;
  // Evenly spread draws (i + 0.5) / n: the sample's median is the quantile curve's, with no luck in it.
  const n = 4000;
  let i = 0;
  setRandom(() => (i++ + 0.5) / n);
  const draws = Array.from({ length: n }, () => sampleGap(gap)).sort((a, b) => a - b);
  assert.ok(draws[0] >= gap[0] && draws[draws.length - 1] <= gap[4]);
  const median = draws[draws.length >> 1];
  assert.ok(Math.abs(median - gap[2]) <= 1, `median ${median} vs captured ${gap[2]}`);
  assert.equal(sampleGap([8, 8, 8, 8, 8]), 8, "a fixed spacing comes out exact");
});

test("a duck quacks with its captured area sound, then waits one gap", (t) => {
  const duckId = core.CacheDefinitions.getNpcId("duck");
  const duck = npc(duckId);
  setRandom(() => 0.5);
  const sounds = run(t, [duck], 1, 400);
  const gap = entry("duck").gap[2];
  assert.ok(duck.said.length >= 2, `quacked ${duck.said.length} times`);
  assert.ok(duck.said.every((text) => text === "Quack!"));
  assert.deepEqual(sounds.map((s) => [s.soundId, s.radius]).slice(0, 1), [[413, 5]]);
  assert.ok(Math.abs(duck.said.length - Math.floor(400 / gap)) <= 1);
});

test("an NPC talking to or fighting a player stays quiet, and speaks again once free", (t) => {
  const duck = npc(core.CacheDefinitions.getNpcId("duck"));
  duck.interacting = PLAYER;
  run(t, [duck], 1, 600);
  assert.deepEqual(duck.said, []);
  duck.interacting = null;
  duck.attacker = PLAYER;
  run(t, [duck], 601, 1200);
  assert.deepEqual(duck.said, []);
  duck.attacker = null;
  run(t, [duck], 1201, 1800);
  assert.ok(duck.said.length > 0);
});

test("Goblin Village soldiers shout only while fighting another NPC", (t) => {
  const goblin = npc(core.CacheDefinitions.getNpcId("goblin_red_soldier_6"), { at: [2955, 3500, 0] });
  run(t, [goblin], 1, 300);
  assert.deepEqual(goblin.said, [], "no fight, no shouting");
  goblin.target = AN_NPC;
  run(t, [goblin], 301, 600);
  assert.ok(goblin.said.length > 10);
  const lines = new Set(entry("goblin_red_soldier_6").lines.map((line) => line.text));
  assert.ok(goblin.said.every((text) => lines.has(text)));
});

test("an NPC with a fixed cycle says its lines in that order", (t) => {
  const expert = entry("ge_expert_herbs");
  assert.ok(expert.order, "the GE herb expert keeps a cycle in the captures");
  const stub = npc(core.CacheDefinitions.getNpcId("ge_expert_herbs"), { at: [3165, 3489, 0] });
  run(t, [stub], 1, 5000);
  assert.ok(stub.said.length >= expert.order.length + 2);
  const start = expert.order.indexOf(stub.said[0]);
  stub.said.forEach((text, i) => assert.equal(text, expert.order[(start + i) % expert.order.length]));
});

test("an NPC that leaves the active regions or the world is dropped", (t) => {
  const duck = npc(core.CacheDefinitions.getNpcId("duck"));
  run(t, [duck], 1, 10);
  assert.equal(live.has(duck), true);
  duck.registered = false;
  run(t, [], 11, 12);
  assert.equal(live.has(duck), false);
  assert.equal(schedule.has(duck), false);
});

test("a line pattern in skipLines removes it, and an order naming a removed line is dropped", () => {
  const chatter = entryFor({ lines: [{ text: "Stop! Thief!", weight: 5 }, { text: "Lovely day.", weight: 1 }], gap: [1, 2, 3, 4, 5],
    order: ["Stop! Thief!", "Lovely day."] });
  assert.deepEqual(chatter.lines.map((line) => line.text), ["Lovely day."]);
  assert.equal(chatter.order, null);
  assert.equal(entryFor({ lines: [{ text: "Guards! Guards!", weight: 1 }], gap: [1, 2, 3, 4, 5] }), null);
});
