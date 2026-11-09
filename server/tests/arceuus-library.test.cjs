const assert = require("node:assert/strict");
const path = require("node:path");
const { before, beforeEach, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Library = require("../plugins/world/ArceuusLibrary.plugin");
const dialogues = require("../data/definitions/npc-dialogues.json");
const LIBRARY = require("../plugins/world/data/arceuus-library.json");

// Issue 4040. Stair directions: rsprox 1702 (27853/27851 up, 27852/27856 down). The customers'
// Help option and Talk-to hand-in: Wiki "Arceuus Library", "Sam" transcript. Biblia's hint:
// Wiki "Biblia" ("floor level and the section of the floor"). Book: Wiki "Book of Arcane Knowledge".
let core;
let listeners;
let emitted;
let prompts;
let itemActions;
let npcActions;
const T = Library._test;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  listeners = new Map();
  itemActions = new Map();
  npcActions = new Map();
  const api = new Proxy({
    core,
    onCustomEvent(name, handler) { listeners.set(name, [...(listeners.get(name) ?? []), handler]); },
    emitCustomEvent(name, event) { emitted.push([name, event]); (listeners.get(name) ?? []).forEach((handler) => handler(event)); },
    onItemAction(name, actions) { itemActions.set(name, actions); },
    onNpcInteraction(name, actions) { npcActions.set(name, actions); },
    sendMultiChatboxPrompt(player, title, ...rest) { prompts.push({ player, title, rest }); return true; },
    persistAttribute() {},
    getTaskManager: () => ({ submit() {} }),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  Library.register(api);
  // Stands in for NpcDialogues, which plays the variant.
  api.onCustomEvent("npc-dialogue:start", (request) => { request.handled = true; });
});

beforeEach(() => {
  emitted = [];
  prompts = [];
  T.resetArrangement(() => 0);
});

function fixture(t) {
  const player = new Player(null, new core.Location(1626, 3795, 0));
  player.setIndex(3400 + Math.floor(Math.random() * 1000));
  player.setUsername("arceuus-library-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getPrivateArea = () => null;
  player.getSkillManager().setMaxLevels(core.Skill.MAGIC, 70, false);
  player.getSkillManager().setMaxLevels(core.Skill.RUNECRAFTING, 40, false);
  t.after(() => player.setRegistered(false));
  return player;
}

const customer = (npcId) => ({ getId: () => npcId });

test("each library staircase climbs the way it goes, with no prompt", () => {
  for (const [objectId, event] of [[27853, "ladders:climbUp"], [27851, "ladders:climbUp"], [27854, "ladders:climbUp"],
    [27852, "ladders:climbDown"], [27855, "ladders:climbDown"], [27856, "ladders:climbDown"]]) {
    emitted = [];
    const request = { player: {}, object: null, objectId, clickType: 1, handled: false };
    T.climbStairs(request);
    assert.equal(request.handled, true, `${objectId}`);
    assert.equal(emitted[0][0], event, `${objectId}`);
  }
  const other = { player: {}, objectId: 12345, handled: false };
  T.climbStairs(other);
  assert.equal(other.handled, false);
});

test("Help starts the request at the book line, without the intro and menu", (t) => {
  const player = fixture(t);
  const handled = T.helpCustomer({ player, npc: customer(T.SAM) });
  assert.equal(handled, true);
  assert.equal(T.requestOf(player)?.npcId, T.SAM);
  const start = emitted.find(([name]) => name === "npc-dialogue:start")[1];
  assert.equal(start.variant, "standard-dialogue");
  const steps = start.select(dialogues.Sam.variants["standard-dialogue"]);
  assert.equal(steps[0].player, T.REQUEST_OPTION);
  assert.ok(steps.some((step) => step.npc?.includes(T.BOOK_PLACEHOLDER)));
});

test("Help while a request is open replays the progress line for that customer", (t) => {
  const player = fixture(t);
  T.assignRequest(player, T.SAM);
  T.helpCustomer({ player, npc: customer(T.SAM) });
  assert.equal(emitted.find(([name]) => name === "npc-dialogue:start")[1].variant, T.VARIANT.findingThem);
  emitted = [];
  T.helpCustomer({ player, npc: customer(T.VILLIA) });
  assert.equal(emitted.find(([name]) => name === "npc-dialogue:start")[1].variant, T.VARIANT.findingElsewhere);
});

test("Talk-to with the requested book in the inventory hands it in", (t) => {
  const player = fixture(t);
  const book = T.assignRequest(player, T.SAM, () => 0);
  assert.equal(T.talkToCustomer({ player, npc: customer(T.SAM) }), false, "no book yet: normal conversation");
  player.getInventory().addItem(new core.Item(book, 1));
  assert.equal(T.talkToCustomer({ player, npc: customer(T.VILLIA) }), false, "another customer ignores it");
  assert.equal(T.talkToCustomer({ player, npc: customer(T.SAM) }), true);
  assert.equal(player.getInventory().contains(book), false);
  assert.equal(player.getInventory().contains(T.BOOK_OF_ARCANE_KNOWLEDGE), true);
  assert.equal(T.requestOf(player), null);
  assert.equal(emitted.find(([name]) => name === "npc-dialogue:start")[1].variant, T.VARIANT.turningIn);
});

test("the customers register Help and Talk-to", () => {
  for (const name of ["Sam", "Professor Gracklebone", "Villia"]) {
    assert.equal(typeof npcActions.get(name)?.Help, "function", name);
    assert.equal(typeof npcActions.get(name)?.["Talk-to"], "function", name);
  }
});

test("every book is located on the shelf that holds it, with a floor and bay", (t) => {
  for (const { itemId } of LIBRARY.books) {
    const spot = T.locateBook(itemId);
    assert.ok(spot, `${itemId}`);
    assert.equal(T.bookAt(spot), itemId);
    assert.match(spot.floor, /^(bottom|middle|top)$/);
    assert.match(spot.area, /^(central area|(north|south)-(eastern|western) bay)$/);
  }
  assert.equal(T.bayOf(1620, 3830), "north-western bay");
  assert.equal(T.bayOf(1650, 3790), "south-eastern bay");
  assert.equal(T.bayOf(1632, 3808), "central area");
});

test("Biblia names the requested book and where it is", (t) => {
  const player = fixture(t);
  const book = T.assignRequest(player, T.SAM, () => 0);
  const spot = T.locateBook(book);
  const hint = dialogues.Biblia.branches.Zyj0sH;
  const player_ = { player, npcId: T.BIBLIA, text: hint[0].player };
  T.onBibliaLine(player_);
  assert.ok(player_.text.includes(T.BOOKS.get(book)));
  assert.ok(!player_.text.includes("[book]"));
  const npc = { player, npcId: T.BIBLIA, text: hint[1].npc };
  T.onBibliaLine(npc);
  assert.equal(npc.text, `Try the ${spot.floor} floor, ${spot.area}.`);
  const untouched = { player, npcId: T.SAM, text: hint[1].npc };
  T.onBibliaLine(untouched);
  assert.equal(untouched.text, hint[1].npc);
});

test("Biblia's book option shows only while a request is open", (t) => {
  const player = fixture(t);
  const ask = { player, npcId: T.BIBLIA, text: "If the player is helping NPCs find books in the Arceuus Library:" };
  assert.equal(T.onBibliaCondition(ask), false);
  T.assignRequest(player, T.SAM);
  assert.equal(T.onBibliaCondition(ask), true);
  assert.equal(T.onBibliaCondition({ ...ask, text: "something else" }), null);
});

test("reading a Book of Arcane Knowledge offers Magic or Runecraft experience", (t) => {
  assert.equal(typeof itemActions.get("Book of Arcane Knowledge")?.Read, "function");
  for (const [choice, skill, expected] of [[0, "MAGIC", 15 * 70], [1, "RUNECRAFTING", 5 * 40]]) {
    const player = fixture(t);
    player.getInventory().addItem(new core.Item(T.BOOK_OF_ARCANE_KNOWLEDGE, 1));
    prompts = [];
    T.readBook({ player });
    const [prompt] = prompts;
    assert.deepEqual([prompt.rest[0], prompt.rest[2]], ["Magic", "Runecraft"]);
    prompt.rest[choice * 2 + 1]();
    assert.equal(player.getInventory().contains(T.BOOK_OF_ARCANE_KNOWLEDGE), false);
    assert.equal(player.getSkillManager().getExperience(core.Skill[skill]), expected);
    prompt.rest[choice * 2 + 1]();
    assert.equal(player.getSkillManager().getExperience(core.Skill[skill]), expected, "a second click gives nothing");
  }
});
