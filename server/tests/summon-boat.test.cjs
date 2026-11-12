// Run after `yarn build`: node --test tests/summon-boat.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { Animation } = require("../dist/game/model/Animation");
const { Graphic } = require("../dist/game/model/Graphic");
const { Task } = require("../dist/game/task/Task");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Item } = require("../dist/game/model/Item");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");

const areaSounds = [];
const prompts = [];
let actions;
let castSpell;
let plugin;

/** Spell.canCast as the player's `castable` says, recording each call. */
class FakeSpell {
  canCast(player, del) {
    player.log.push(`canCast ${del}`);
    return player.castable !== false;
  }
}

/** The dialogue chain, as the list of its entries. */
class Chain {
  constructor() { this.entries = []; }
  add(entry) { this.entries.push(entry); return this; }
}

before(async () => {
  await CachePipeline.initialize();
  plugin = require("../plugins/skills/sailing/SummonBoat.Sailing");
  plugin.register({
    core: {
      Animation, Graphic, Task, TaskManager, CacheDefinitions, Item, MagicSpellbook,
      Spell: FakeSpell,
      Skill: { MAGIC: "MAGIC" },
      ChatType: { MESBOX: "mesbox" },
      DialogueChainBuilder: Chain,
      StatementDialogue: class { constructor(index, text) { this.text = text; } },
      ActionDialogue: class { constructor(index, action) { this.action = action; } },
      Sounds: { playAreaSound: (sound) => areaSounds.push(sound) },
    },
    onItemAction: (name, handlers) => { if (name === "Summon boat") actions = handlers; },
    onSpellCast: (handler) => { castSpell = handler; },
    sendMultiChatboxPrompt: (player, question, ...options) => prompts.push({ player, question, options }),
    persistAttribute() {},
  });
});

const { facilityNamed, setFacility } = require("../plugins/skills/sailing/BoatFacilities.Sailing");

function clearTasks() {
  while (TaskManager.pendingTasks.shift() != null);
  TaskManager.activeTasks.length = 0;
}

function boat(slot, dock, { focus = "Teleport focus" } = {}) {
  const owned = { slot, type: "sloop", name: [], cargo: [], location: { kind: "docked", dock } };
  if (focus) setFacility(owned, 0, facilityNamed(focus));
  return owned;
}

/** A player at (x, y) with these boats and one tablet; records what the server sends. */
function createPlayer(x, y, boats) {
  const items = [ItemIdentifiers.SUMMON_BOAT];
  const log = [];
  const attributes = new Map([["quest.pandemonium.stage", 50]]);
  const xp = [];
  const dialogues = [];
  const sender = new Proxy({}, {
    get: (_target, key) => (...args) => {
      if (key === "sendVarbit" || key === "sendConfig") log.push(`${key} ${args[0]}=${args[1]}`);
      if (key === "sendSoundEffect") log.push(`sound ${args[0]}`);
      if (key === "sendTypedMessage") log.push(`${args[0]} ${args[1]}`);
      if (key === "sendSubInterface") log.push(`open ${args[1]}`);
      return sender;
    },
  });
  return {
    items,
    log,
    xp,
    dialogues,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill, amount]) }),
    getDialogueManager: () => ({ startDialogues: (chain) => dialogues.push(chain) }),
    getLocation: () => new Location(x, y, 0),
    getSailing: () => ({ boats, activeBoatSlot: null }),
    getArea: () => null,
    getPrivateArea: () => null,
    getIndex: () => 1,
    getPacketSender: () => sender,
    setInterfaceId: () => {},
    getInterfaceId: () => -1,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      contains: (id) => items.includes(id),
      deleteNumber: (id) => items.splice(items.indexOf(id), 1),
    }),
    performAnimation: (anim) => log.push(`seq ${anim.getId()}`),
    performGraphic: (graphic) => log.push(`spot ${graphic.id}`),
    sendMessage: (message) => log.push(`message ${message}`),
  };
}

const tablet = { itemId: ItemIdentifiers.SUMMON_BOAT };

test("Summon boat works near a dock or mooring point: as captured, 13 tiles from the Pandemonium's gangplank", () => {
  assert.equal(plugin._test.nearbyDock({ getLocation: () => new Location(3059, 2974, 0) })?.id, "the_pandemonium");
  assert.equal(plugin._test.nearbyDock({ getLocation: () => new Location(2657, 2673, 0) })?.id, "void_knights_outpost");
  assert.equal(plugin._test.nearbyDock({ getLocation: () => new Location(3222, 3218, 0) }), undefined, "Lumbridge");
  const far = createPlayer(3222, 3218, [boat(0, "port_sarim")]);
  actions.Break({ player: far, ...tablet });
  assert.deepEqual(far.log, ["message You need to be near a dock or mooring point to use this tablet."]);
  assert.equal(far.items.length, 1);
});

test("Break opens the boat selection in its Summon mode with the dock as the teleport dock (rsprox)", () => {
  const player = createPlayer(3059, 2974, [boat(0, "port_sarim")]);
  actions.Break({ player, ...tablet });
  const sent = player.log.filter((line) => /5006|18553|5005|12393|open/.test(line));
  assert.deepEqual(sent, ["sendConfig 5006=8588", "sendVarbit 18553=6", "sendConfig 5005=8588", "sendVarbit 12393=1", "open 934"]);
});

test("a summon moves the boat, breaks the tablet, then casts two ticks later and clears busy two after that", () => {
  clearTasks();
  const summoned = boat(2, "void_knights_outpost");
  const player = createPlayer(3059, 2974, [boat(0, "port_sarim", { focus: null }), summoned]);
  const pandemonium = plugin._test.nearbyDock(player);
  plugin._test.summon(player, plugin._test.tabletCast(ItemIdentifiers.SUMMON_BOAT), pandemonium, 2);
  assert.deepEqual(summoned.location, { kind: "docked", dock: "the_pandemonium" });
  assert.ok(player.log.includes("seq 4069") && player.log.includes("sound 965"), "the tablet broken at once");
  // Used up with the move: dropping it before the cast must not keep it (the captures show it leave at the cast).
  assert.equal(player.items.length, 0, "the tablet is used up with the move");
  player.log.length = 0;
  TaskManager.process();
  TaskManager.process();
  assert.deepEqual(player.log, ["message Your boat has been summoned to the Pandemonium.", "spot 343", "seq 1818"]);
  assert.equal(areaSounds.at(-1).soundId, 199);
  player.log.length = 0;
  TaskManager.process();
  TaskManager.process();
  assert.deepEqual(player.log, ["sendVarbit 12393=0"]);
  assert.equal(player.getAttribute(plugin._test.LAST_SUMMONED_ATTRIBUTE), 2);
  clearTasks();
});

test("only a boat with a teleport focus can be summoned; Last boat summons the last one", () => {
  clearTasks();
  const plain = boat(0, "port_sarim", { focus: null });
  const greater = boat(1, "port_sarim", { focus: "Greater teleport focus" });
  const player = createPlayer(3059, 2974, [plain, greater]);
  plugin._test.summon(player, plugin._test.tabletCast(ItemIdentifiers.SUMMON_BOAT), plugin._test.nearbyDock(player), 0);
  assert.equal(plain.location.dock, "port_sarim");
  assert.ok(player.log.includes("message Your boat needs to have a teleport focus on it for you to do that."));
  assert.equal(player.items.length, 1);

  player.log.length = 0;
  actions["Last boat"]({ player, ...tablet });
  assert.deepEqual(player.log, ["message You haven't summoned a boat yet."]);
  player.setAttribute(plugin._test.LAST_SUMMONED_ATTRIBUTE, 1);
  actions["Last boat"]({ player, ...tablet });
  assert.equal(greater.location.dock, "the_pandemonium", "a greater focus counts too");
  clearTasks();
});

const SALVAGE = 32851; // sailing_barracuda_shipwreck_salvage, lost on a summon

function cast(player, opId = 1) {
  castSpell({ player, spellName: "Summon Boat", opId, handled: false });
}

test("the Summon Boat spell is refused before The Pandemonium, away from a dock, or with no boat with a focus (rsprox)", () => {
  const early = createPlayer(3059, 2974, [boat(0, "port_sarim")]);
  early.setAttribute("quest.pandemonium.stage", 10);
  cast(early);
  assert.deepEqual(early.log, ["message You must have completed Pandemonium to use this spell."]);

  const far = createPlayer(3222, 3218, [boat(0, "port_sarim")]);
  cast(far);
  assert.deepEqual(far.log, ["message You need to be near a dock or mooring point to use this spell."]);

  const plain = createPlayer(3059, 2974, [boat(0, "port_sarim", { focus: null })]);
  cast(plain);
  assert.deepEqual(plain.log, ["message Your boat needs to have a teleport focus on it for you to do that."]);
});

test("the spell opens the Summon selection; the choice uses its runes, casts boat_retrieve_cast and gives 66 xp (rsprox)", () => {
  clearTasks();
  const summoned = boat(1, "port_sarim");
  const player = createPlayer(3059, 2974, [summoned]);
  cast(player);
  const opened = player.log.filter((line) => /5006|18553|5005|open/.test(line));
  assert.deepEqual(opened, ["sendConfig 5006=8588", "sendVarbit 18553=6", "sendConfig 5005=8588", "open 934"]);
  player.log.length = 0;
  plugin._test.summon(player, plugin._test.spellCast(), plugin._test.nearbyDock(player), 1);
  assert.deepEqual(summoned.location, { kind: "docked", dock: "the_pandemonium" });
  assert.deepEqual(player.log.filter((line) => !line.startsWith("send")), ["canCast true", "seq 725", "spot 3546", "sound 10900"]);
  assert.deepEqual(player.xp, [["MAGIC", 66]]);
  assert.equal(player.items.length, 1, "no tablet used");
  player.log.length = 0;
  TaskManager.process();
  TaskManager.process();
  assert.deepEqual(player.log, ["message Your boat has been summoned to the Pandemonium."]);
  clearTasks();
});

test("without the runes or the level the spell's choice summons nothing", () => {
  clearTasks();
  const summoned = boat(1, "port_sarim");
  const player = createPlayer(3059, 2974, [summoned]);
  player.castable = false;
  plugin._test.summon(player, plugin._test.spellCast(), plugin._test.nearbyDock(player), 1);
  assert.equal(summoned.location.dock, "port_sarim");
  assert.ok(player.log.includes("sendVarbit 12393=0"));
  assert.deepEqual(player.xp, []);
  clearTasks();
});

test("a hold with cargo a summon loses warns, then asks; only Yes summons it, without that cargo (rsprox)", () => {
  clearTasks();
  prompts.length = 0;
  const summoned = boat(1, "port_sarim");
  summoned.cargo = [{ id: SALVAGE, amount: 1 }, { id: 1511, amount: 5 }];
  const player = createPlayer(3059, 2974, [summoned]);
  plugin._test.summon(player, plugin._test.spellCast(), plugin._test.nearbyDock(player), 1);
  assert.equal(summoned.location.dock, "port_sarim", "nothing happens before the answer");
  assert.ok(player.log.includes(`mesbox ${plugin._test.CARGO_WARNING}`));
  assert.ok(player.log.includes("sendVarbit 12393=0"));
  const [chain] = player.dialogues;
  assert.equal(chain.entries[0].text, plugin._test.CARGO_WARNING_BOX);
  chain.entries[1].action.execute();
  const [{ question, options }] = prompts;
  assert.equal(question, "Summon your boat to the Pandemonium? Any cargo will be lost.");
  assert.deepEqual([options[0], options[2]], [plugin._test.CARGO_YES, plugin._test.CARGO_NO]);

  options[3]();
  assert.equal(summoned.location.dock, "port_sarim", "No keeps the boat and its cargo");
  assert.deepEqual(player.xp, []);
  options[1]();
  assert.equal(summoned.location.dock, "the_pandemonium");
  assert.deepEqual(summoned.cargo, [null, { id: 1511, amount: 5 }], "only the cargo a summon loses goes");
  assert.deepEqual(player.xp, [["MAGIC", 66]]);
  clearTasks();
});

test("the tablet warns about cargo the same way; an empty hold summons at once", () => {
  clearTasks();
  const loaded = boat(1, "port_sarim");
  loaded.cargo = [{ id: SALVAGE, amount: 1 }];
  const player = createPlayer(3059, 2974, [loaded]);
  plugin._test.summon(player, plugin._test.tabletCast(ItemIdentifiers.SUMMON_BOAT), plugin._test.nearbyDock(player), 1);
  assert.equal(player.dialogues.length, 1);
  assert.equal(player.items.length, 1, "the tablet is kept until Yes");

  const empty = createPlayer(3059, 2974, [boat(1, "port_sarim")]);
  plugin._test.summon(empty, plugin._test.tabletCast(ItemIdentifiers.SUMMON_BOAT), plugin._test.nearbyDock(empty), 1);
  assert.equal(empty.dialogues.length, 0);
  assert.equal(empty.items.length, 0);
  clearTasks();
});

test("the spell's Last Boat summons the boat last summoned", () => {
  clearTasks();
  const last = boat(1, "port_sarim");
  const player = createPlayer(3059, 2974, [boat(0, "port_sarim"), last]);
  cast(player, 2);
  assert.ok(player.log.includes("message You haven't summoned a boat yet."));
  player.setAttribute(plugin._test.LAST_SUMMONED_ATTRIBUTE, 1);
  cast(player, 2);
  assert.equal(last.location.dock, "the_pandemonium");
  assert.ok(!player.log.includes("open 934"), "without the selection");
  clearTasks();
});
