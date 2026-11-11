// Run after `yarn build`: node --test tests/kalphite-cave.test.cjs
// The Kalphite Cave (docs/kalphite-cave.md): multi-combat, kalphites task-only behind Buggie.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const KalphiteCave = require("../plugins/areas/KalphiteCave.plugin");
const SPAWNS = require("../data/definitions/npc-spawns.json");
const DIALOGUES = require("../data/definitions/npc-dialogues.json");
const TELEPORTS = require("../plugins/world/data/loc-teleports.json");

const T = KalphiteCave._test;
let core;
let area;
const dialogues = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = {
    core,
    emitCustomEvent: (name, payload) => {
      if (name === "slayer:on-task") payload.onTask = payload.player.onTask === true;
      if (name === "npc-dialogue:start") dialogues.push(payload);
    },
    registerArea: (registered) => { area = registered; },
  };
  KalphiteCave.register(api);
});

function fakePlayer({ onTask = false, retaliating = false, target = null, amulet = -1 } = {}) {
  const player = {
    onTask,
    target,
    messages: [],
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    sendMessage: (text) => player.messages.push(text),
    getCombat: () => ({ isAutoRetaliating: () => retaliating, getTarget: () => player.target ?? null }),
    getEquipment: () => ({ get: (slot) => (slot === core.Equipment.AMULET_SLOT && amulet >= 0 ? new core.Item(amulet) : null) }),
  };
  return player;
}

function fakeNpc(id) {
  return { id, isPlayer: () => false, isNpc: () => true, getId: () => id };
}

const inside = (x, y, z = 0) => area.getBoundaries().some((b) => b.inside(new core.Location(x, y, z)));

test("the cave is a multi-combat Area holding every cave kalphite and nothing of its neighbours", () => {
  const spawns = SPAWNS.spawns ?? SPAWNS;
  const kalphites = spawns.filter((spawn) => [956, 958, 960].includes(spawn.id));
  assert.equal(kalphites.length, 43, "Wiki: 18 workers, 20 soldiers, 5 guardians");
  for (const spawn of kalphites) assert.ok(inside(spawn.x, spawn.y, spawn.level), `${spawn.name} at ${spawn.x},${spawn.y}`);
  assert.ok(inside(3305, 9497), "the entrance's landing (rsprox 2922)");
  assert.ok(inside(3307, 9506), "Buggie");
  for (const spawn of spawns.filter((s) => /slave|Guard$/.test(s.name ?? "") && s.x >= 3260 && s.x <= 3330 && s.y >= 9440 && s.y <= 9470)) {
    assert.equal(inside(spawn.x, spawn.y, spawn.level), false, `the Desert Mining Camp's ${spawn.name} at ${spawn.x},${spawn.y}`);
  }
  assert.equal(inside(3347, 9533), false, "the Elid cave exit");
  assert.equal(inside(3305, 9497, 2), false, "plane 0 only");
  assert.equal(area.isMulti(), true);
});

test("an attack without a task is refused with Buggie's message and line", () => {
  for (const id of [956, 958, 960]) {
    dialogues.length = 0;
    const npc = fakeNpc(id);
    const player = fakePlayer({ target: npc });
    assert.equal(area.canAttack(player, npc), false, `npc ${id}`);
    assert.deepEqual(player.messages, ["Buggie wants you to stick to your Slayer assignments."]);
    assert.equal(dialogues.length, 1);
    assert.equal(dialogues[0].npcId, core.NpcIdentifiers.ENTOMOLOGIST);
    assert.equal(dialogues[0].variant, T.BUGGIE_VARIANTS.ghostly);
    assert.equal(dialogues[0].exact, true);
  }
});

test("Buggie is understood with a ghostspeak amulet on (Transcript:Entomologist)", () => {
  for (const amulet of [core.ItemIdentifiers.GHOSTSPEAK_AMULET, core.ItemIdentifiers.GHOSTSPEAK_AMULET_2]) {
    dialogues.length = 0;
    const npc = fakeNpc(958);
    area.canAttack(fakePlayer({ target: npc, amulet }), npc);
    assert.equal(dialogues[0].variant, T.BUGGIE_VARIANTS.understood);
  }
});

test("both of Buggie's variants are in the generated transcript", () => {
  const page = DIALOGUES.Entomologist?.variants ?? {};
  assert.equal(page[T.BUGGIE_VARIANTS.understood]?.[0]?.text, "I didn't... create this cave for... you to do that... sorry, it's not for you.");
  assert.equal(page[T.BUGGIE_VARIANTS.ghostly]?.[0]?.text, "wooooo ooo woo-woo");
});

test("a player on a kalphite task is left alone", () => {
  const npc = fakeNpc(956);
  const player = fakePlayer({ onTask: true, target: npc });
  dialogues.length = 0;
  assert.equal(area.canAttack(player, npc), null);
  assert.deepEqual(player.messages, []);
  assert.equal(dialogues.length, 0);
});

test("auto-retaliation and permission probes are refused silently", () => {
  const npc = fakeNpc(958);
  dialogues.length = 0;
  for (const player of [fakePlayer({ retaliating: true, target: npc }), fakePlayer(), fakePlayer({ target: fakeNpc(956) })]) {
    assert.equal(area.canAttack(player, npc), false);
    assert.deepEqual(player.messages, []);
  }
  assert.equal(dialogues.length, 0);
});

test("NPCs attacking players are not this Area's business", () => {
  assert.equal(area.canAttack(fakeNpc(958), fakePlayer()), null);
});

test("the crevice by the landing leads out to the entrance", () => {
  const exit = TELEPORTS.locs.filter((entry) => entry.id === 26712);
  assert.equal(exit.length, 1);
  assert.deepEqual([exit[0].x, exit[0].y, exit[0].z, exit[0].option], [3306, 9497, 0, "Use"]);
  assert.deepEqual(exit[0].to, [3321, 3122, 0]);
});
