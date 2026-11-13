const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const plugin = require("../plugins/treasuretrails/TreasureTrails.plugin");
const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
const Dialogue = require("../plugins/treasuretrails/trails/Dialogue.TreasureTrails");
const Puzzle = require("../plugins/treasuretrails/trails/Puzzle.TreasureTrails");
const Caskets = require("../plugins/treasuretrails/trails/Caskets.TreasureTrails");
const Stash = require("../plugins/treasuretrails/trails/Stash.TreasureTrails");
const { byName } = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails");
const TRANSCRIPTS = require("../data/definitions/npc-dialogues.json");
const HARD = byName.get("hard");
const I = core.ItemIdentifiers;
const C = core.CacheDefinitions;

const played = [];
const play = Dialogue.play;
Dialogue.play = (player, npcId, spoken, onEnd) => { played.push(...spoken); return play(player, npcId, spoken, onEnd); };

function fixture() {
  const actions = new Map(), events = new Map(), buttons = new Map(), attributes = new Map(), sent = [], ground = [], spawned = [];
  let position = new core.Location(3222, 3218, 0), chain, placed = 0;
  const items = Array(28).fill(null), worn = [];
  const inventory = {
    getItems: () => items, refreshItems() {}, setItem(slot, item) { items[slot] = item; return inventory; },
    getFreeSlots: () => items.filter(i => !i).length, isFull() { return this.getFreeSlots() === 0; },
    delete(id, amount) { while (amount > 0) { const slot = items.findIndex(i => i?.getId() === id); if (slot < 0) return; const take = Math.min(amount, items[slot].getAmount()); this.deleteAtSlot(slot, take); amount -= take; } },
    deleteAtSlot(slot, amount) { const item = items[slot]; if (!item) return; if (item.getAmount() <= amount) items[slot] = null; else item.setAmount(item.getAmount() - amount); },
    adds(id, amount) { this.forceAdd(null, new core.Item(id, amount)); },
    forceAdd(player, item) { const slot = items.findIndex(i => !i); if (slot < 0) ground.push(item); else items[slot] = item; },
  };
  const sender = new Proxy({}, { get: (_, name) => (...args) => (sent.push([name, ...args]), sender) });
  const skills = { level: 1, xp: 0, getCurrentLevel() { return this.level; }, addExperiences(skill, xp) { this.xp += xp; } };
  const player = { getUsername: () => "Tester", getInventory: () => inventory, getSkillManager: () => skills, getEquipment: () => ({ getItems: () => worn }),
    getPacketSender: () => sender, getLocation: () => position, getPrivateArea: () => null,
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: message => sent.push(["message", message]), performAnimation: value => sent.push(["animation", value]),
    setEnteredAmountAction() {}, getDialogueManager: () => ({ startDialogues: value => { chain = value; } }) };
  const api = { core, persistAttribute() {}, onItemAction: (name, handlers) => actions.set(name, { ...actions.get(name), ...handlers }),
    onBeforeNpcInteraction() {}, onItemOnNpc() {}, onBeforeObjectInteraction() {}, onCanUseItem() {},
    onInterfaceActionButton: (id, fn) => { if (!buttons.has(id)) buttons.set(id, []); buttons.get(id).push(fn); },
    onCustomEvent: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent: (name, request) => { for (const fn of events.get(name) ?? []) fn(request); },
    onPlayerLogout() {}, onPlayerDisconnect() {}, onPlayerLogin() {}, onPlayerDeath() {}, onNpcDeath() {},
    spawnNpc: def => {
      const npc = { def, removed: false, hitpoints: 10, attacked: null, getLocation: () => new core.Location(def.x, def.y, def.z),
        getHitpoints() { return this.hitpoints; }, isRegistered() { return !this.removed; }, getCombat() { return { attack: target => { npc.attacked = target; } }; } };
      spawned.push(npc);
      return npc;
    },
    removeNpc: npc => { npc.removed = true; }, getRegionManager: () => ({ blocked: () => false, canMovestart: () => true }) };
  plugin.register(api);
  api.onCustomEvent("treasure-trails:milestone-rewards", request => { request.handled = true; });
  api.onCustomEvent("npc-dialogue:start", request => {
    const steps = TRANSCRIPTS[C.getNpc(request.npcId)?.name]?.variants?.[request.variant];
    if (steps?.length && request.select) request.select(steps);
  });
  function place(step, { length = 5, completed = 1, slot = 0 } = {}) {
    items[slot] = new core.Item(step.itemId, 1).setMetaValue(Runtime.metaKey(HARD),
      { version: 1, token: `t${slot}-${++placed}`, revision: 0, completed, length, row: step.row });
    position = new core.Location(step.location.x, step.location.y, step.location.z);
  }
  const talk = (npcId, npc = { getLocation: () => position }) => {
    const event = { player, npcId, npc, clickType: 1, handled: false, definition: { getActions: () => ["Talk-to"] } };
    Runtime.talk(event);
    return event;
  };
  const digHere = () => { const event = { player, itemId: I.SPADE, option: "Dig", allow: true }; Runtime.dig(event); return event.allow; };
  /** A click on a piece of the sliding-puzzle interface, as every handler registered on it sees it. */
  const press = slot => { for (const fn of buttons.get(C.getComponentId("trail_slidepuzzle:pieces")) ?? []) fn({ player, slot }); };
  return { api, press, player, items, worn, skills, attributes, actions, sent, spawned, place, talk, digHere,
    event: (slot = 0) => ({ player, slot, item: items[slot], itemId: items[slot]?.getId() }),
    box: () => items.find(item => item && C.getItem(item.getId())?.name === "Puzzle box (hard)"),
    boxEvent: () => ({ player, slot: items.findIndex(item => item && C.getItem(item.getId())?.name === "Puzzle box (hard)") }),
    state: () => (items.find(item => item && C.getItem(item.getId())?.name === "Puzzle box (hard)") ?? items[0])?.getMetaValue(Runtime.metaKey(HARD)),
    finish: () => { const current = chain; chain = null; for (const d of current?.getDialogues().values() ?? []) if (d instanceof core.ActionDialogue) d.send(player); },
  };
}

const steps = () => Runtime.data(HARD).steps;
const GROUP_PARAM = require("../plugins/treasuretrails/trails/Catalogue.TreasureTrails").TRAIL_ITEM_GROUP_PARAM;
/** One worn item per requirement: the first listed item, or any item of the clue item group. */
const outfit = step => step.equipment.filter(requirement => requirement.emptySlot == null).map(requirement => new core.Item(requirement.anyOf?.[0] ??
  [...C.getObjNames().keys()].find(id => C.getItem(id)?.params?.get?.(GROUP_PARAM) === requirement.group), 1));
const ofKind = (family, target) => steps().filter(step => step.family === family && (!target || step.target === target));

test("every hard step is a distinct cache clue item with its fight, puzzle box or challenge", () => {
  fixture();
  const data = Runtime.data(HARD);
  assert.equal(data.steps.length, 186);
  for (const [family, target, count] of [["anagram", "npc", 17], ["anagram", "loc", 1], ["cipher", "npc", 11], ["coordinate", "coord", 54],
    ["cryptic", "npc", 23], ["cryptic", "loc", 17], ["cryptic", "coord", 18], ["emote", "coord", 17], ["fairyring", "coord", 11],
    ["map", "coord", 4], ["map", "loc", 3], ["music", "npc", 10]])
    assert.equal(ofKind(family, target).length, count, `${family}/${target}`);
  const fights = {};
  for (const step of data.steps.filter(entry => entry.encounter)) fights[`${step.family}:${step.encounter.npcIds[0]}`] = (fights[`${step.family}:${step.encounter.npcIds[0]}`] ?? 0) + 1;
  assert.deepEqual(fights, { "coordinate:2955": 32, "coordinate:2954": 21, "emote:1778": 14, "emote:1777": 3 });
  const boxes = data.steps.filter(step => step.puzzle);
  assert.equal(boxes.length, 10);
  for (const step of boxes) {
    assert.equal(core.ItemDefinition.forId(step.puzzle.itemId).getName(), "Puzzle box (hard)", step.key);
    assert.equal(data.byItem.get(step.puzzle.itemId), step);
  }
  assert.equal(data.steps.filter(step => step.challenge).length, 22);
  for (const step of data.steps.filter(entry => entry.family === "map")) assert.ok(step.interfaceId != null, `${step.key} has no map interface`);
});

test("each hard image has 24 distinct cache pieces, and a scramble is a real, solvable board", () => {
  for (const image of HARD.puzzleImages) {
    const ids = Puzzle.pieces(image);
    assert.equal(new Set(ids).size, 24);
    assert.ok(ids.every(id => /^trail_slidingpuzzle/.test(C.getObjNames().get(id))), `image ${image}`);
  }
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 50; i++) {
    const board = Puzzle.scramble(random);
    assert.deepEqual([...board].sort((a, b) => a - b), [Puzzle.BLANK, ...Array(24).keys()]);
    assert.equal(Puzzle.isSolved(board), false);
    // Solvable 5x5 boards have an even number of inversions.
    const tiles = board.filter(piece => piece !== Puzzle.BLANK);
    let inversions = 0;
    for (let a = 0; a < tiles.length; a++) for (let b = a + 1; b < tiles.length; b++) if (tiles[a] > tiles[b]) inversions++;
    assert.equal(inversions % 2, 0);
  }
  const board = Puzzle.solvedBoard();
  assert.equal(Puzzle.slide(board, 0), false, "a piece away from the blank does not move");
  assert.equal(Puzzle.slide(board, 23), true);
  assert.equal(Puzzle.isSolved(board), false);
  assert.equal(Puzzle.slide(board, 24), true);
  assert.equal(Puzzle.isSolved(board), true);
});

/** Opens the held box, puts its board one slide from solved, then solves it by a piece click. */
function solveBox(f) {
  f.actions.get("Puzzle box (hard)").Open(f.boxEvent());
  const board = Puzzle.boards().get(f.player).board;
  board.splice(0, 25, ...Puzzle.solvedBoard());
  Puzzle.slide(board, 23);
  Puzzle.click({ player: f.player, slot: 9 });
  assert.notEqual(f.state().solved, true, "a piece away from the blank does not solve it");
  Puzzle.click({ player: f.player, slot: 24 });
}

test("every puzzle-box NPC hands over the box, refuses it unsolved and gives the next clue once it's solved", () => {
  const f = fixture();
  for (const step of steps().filter(entry => entry.puzzle)) {
    f.items.fill(null); f.sent.length = 0;
    f.place(step);
    f.talk(step.npcIds[0]); f.finish();
    assert.equal(f.items[0].getId(), step.itemId, step.key);
    assert.equal(f.box().getId(), step.puzzle.itemId, step.key);
    assert.ok(HARD.puzzleImages.includes(f.state().image), step.key);
    f.actions.get("Puzzle box (hard)").Open(f.boxEvent());
    assert.ok(f.sent.some(([name, varp, value]) => name === "sendConfig" && varp === C.getVarpId("if1") && value === f.state().image), step.key);
    assert.ok(f.sent.some(([name, inv, size]) => name === "sendInventory" && inv === C.getInventoryId("trail_puzzleinv") && size === 25), step.key);
    assert.ok(f.sent.some(([name, group]) => name === "sendInterface" && group === C.getInterfaceId("trail_slidepuzzle")), step.key);
    f.talk(step.npcIds[0]); f.finish();
    assert.equal(f.box().getId(), step.puzzle.itemId, `${step.key} keeps the unsolved box`);
    solveBox(f);
    assert.equal(f.state().solved, true, step.key);
    f.talk(step.npcIds[0]); f.finish();
    assert.equal(f.state().completed, 2, step.key);
    assert.equal(f.state().solved, undefined, `${step.key} the next step starts unsolved`);
  }
});

test("Brambickle speaks his own puzzle-box transcript, with the player's name", () => {
  const f = fixture();
  const step = steps().find(entry => entry.key === "cluehelper_anagram_hard_brambickle");
  f.place(step);
  played.length = 0;
  f.talk(step.npcIds[0]); f.finish();
  assert.deepEqual(played, [{ npc: "I'm struggling with this, please help me solve it!" }]);
  played.length = 0;
  f.talk(step.npcIds[0]); f.finish();
  assert.deepEqual(played, [{ npc: "Sorry but you haven't solved the puzzle yet." }]);
  solveBox(f);
  played.length = 0;
  f.talk(step.npcIds[0]);
  assert.deepEqual(played, [{ npc: "Thanks [player name]!" }]);
  f.finish();
  assert.equal(f.state().completed, 2);
});

test("a coordinate dig summons the step's own wizard, who must die before the dig gives the clue", () => {
  const f = fixture();
  for (const step of ofKind("coordinate").filter(entry => entry.encounter).slice(0, 12)) {
    f.items.fill(null); f.spawned.length = 0;
    f.place(step);
    f.items[1] = new core.Item(I.SPADE, 1);
    assert.equal(f.digHere(), false);
    assert.equal(f.spawned.length, 1, step.key);
    const wizard = f.spawned[0];
    assert.equal(wizard.def.id, step.encounter.npcIds[0]);
    assert.equal(wizard.attacked, f.player, `${step.key} attacks straight away`);
    assert.equal(f.state().completed, 1, `${step.key} the first dig only summons`);
    f.digHere();
    assert.equal(f.spawned.length, 1, `${step.key} no second wizard while the first lives`);
    assert.equal(f.state().completed, 1);
    wizard.hitpoints = 0;
    Runtime.encounterDied({ npc: wizard });
    assert.equal(f.state().defeated, true, step.key);
    f.digHere();
    assert.equal(f.state().completed, 2, step.key);
    assert.equal(f.state().defeated, undefined, `${step.key} the next step needs its own fight`);
  }
});

test("a wizard who vanishes (logout, despawn) is summoned again by the next dig", () => {
  const f = fixture();
  const step = ofKind("coordinate").find(entry => entry.encounter);
  f.place(step);
  f.items[1] = new core.Item(I.SPADE, 1);
  f.digHere();
  f.spawned[0].removed = true;
  f.digHere();
  assert.equal(f.spawned.length, 2);
  assert.equal(f.state().completed, 1);
});

test("hard emotes send the double agent first, then Uri; a first-step emote brings Uri at once", () => {
  const f = fixture();
  for (const step of ofKind("emote")) {
    f.items.fill(null); f.worn.length = 0; f.spawned.length = 0;
    f.place(step);
    f.worn.push(...outfit(step));
    Runtime.emote({ player: f.player, slot: step.emotes[0] });
    assert.equal(f.spawned.length, 1, step.key);
    const agent = f.spawned[0];
    assert.equal(agent.def.id, step.encounter.npcIds[0], `${step.key} the agent comes first`);
    assert.equal(agent.attacked, f.player);
    agent.hitpoints = 0;
    Runtime.encounterDied({ npc: agent });
    assert.equal(f.spawned.length, 2, `${step.key} Uri appears when the agent dies`);
    const uri = f.spawned[1];
    assert.equal(uri.def.id, Runtime.data(HARD).uri);
    f.talk(uri.def.id, uri); f.finish();
    assert.equal(f.state().completed, 2, step.key);
  }
  const first = ofKind("emote")[0];
  f.items.fill(null); f.worn.length = 0; f.spawned.length = 0;
  f.place(first, { completed: 0 });
  f.worn.push(...outfit(first));
  Runtime.emote({ player: f.player, slot: first.emotes[0] });
  assert.equal(f.spawned[0].def.id, Runtime.data(HARD).uri, "no agent on a trail's first step");
});

test("fairy-ring steps read as a cryptic dig and dig on the exact tile", () => {
  const f = fixture();
  for (const step of ofKind("fairyring")) {
    f.items.fill(null);
    f.place(step);
    f.items[1] = new core.Item(I.SPADE, 1);
    assert.match(Runtime.clueText(step), /^The cryptic reveals where to dig:<br><br>[A-Z] [A-Z] [A-Z]( \d)+$/);
    assert.equal(f.digHere(), false, step.key);
    assert.equal(f.state().completed, 2, step.key);
  }
});

test("the hard casket rolls 4-6 and opens once; hard STASH units need Construction 55 and teak planks", () => {
  const f = fixture();
  assert.deepEqual(require("../data/definitions/clue-caskets.json").tables.hard.rolls, [4, 6]);
  f.items[0] = new core.Item(I.REWARD_CASKET_HARD_, 1);
  const event = f.event();
  assert.equal(Caskets.open(event), true);
  assert.equal(f.attributes.get(Runtime.completedAttribute(HARD)), 1);
  assert.equal(Caskets.open(event), false);
  const units = [...Stash.stashes().values()].filter(unit => unit.tier === HARD);
  assert.equal(units.length, 16);
  f.items.fill(null);
  [[I.HAMMER, 1], [I.SAW, 1], [I.TEAK_PLANK, 2], [I.STEEL_NAILS, 10]].forEach(([id, amount], slot) => { f.items[slot] = new core.Item(id, amount); });
  f.skills.level = 55;
  Stash.interact({ player: f.player, objectId: units[0].step.stash.locId, location: units[0].location, handled: false });
  assert.deepEqual(f.attributes.get(Stash.BUILT_ATTRIBUTE), [units[0].step.stash.locId]);
  assert.equal(f.skills.xp, 400);
});

function realFixture(t) {
  const f = fixture(), { Player } = require('../dist/game/entity/impl/player/Player');
  const player = new Player(null), inventory = player.getInventory();
  player.getPacketSender = f.player.getPacketSender;
  player.sendMessage = f.player.sendMessage; player.performAnimation = f.player.performAnimation;
  t.mock.method(Dialogue, 'play', (_player, _npc, _lines, end) => end?.());
  t.mock.method(Dialogue, 'itemBox', () => {});
  const key = Runtime.metaKey(HARD);
  function place(step, completed = 1) {
    inventory.resetItems();
    player.moveTo(new core.Location(step.location.x, step.location.y, step.location.z));
    inventory.setItem(0, new core.Item(step.itemId).setMetaValue(key,
      { version: 1, token: 'real-hard-trail', revision: 0, completed, length: 6, row: step.row }));
  }
  function talk(step, npcId = step.npcIds[0], npc = { getLocation: () => player.getLocation() }) {
    Runtime.talk({ player, npcId, npc, clickType: 1, definition: { getActions: () => ['Talk-to'] } });
  }
  return { player, inventory, key, place, talk, spawned: f.spawned,
    box: () => inventory.getItems().find(item => C.getItem(item.getId())?.name === 'Puzzle box (hard)'),
    open: () => Puzzle.open({ player, slot: Runtime.puzzleSlot(player, Runtime.trails(player)[0]) }) };
}

test('later puzzle steps get new boards while the held clue and real inventory remain valid', t => {
  const f = realFixture(t), all = Runtime.data(HARD).steps, boxes = all.filter(step => step.puzzle);
  const Capacity = require('../plugins/treasuretrails/Capacity.ClueCapacity');
  // Capacity is initialized by its own plugin; its count uses the same cache-backed item names.
  Capacity(new Proxy({ core }, { get: (target, key) => target[key] ?? (() => {}) }));
  f.place(boxes[0]); f.talk(boxes[0]);
  assert.equal(f.inventory.getAmount(boxes[0].itemId), 1);
  assert.equal(Capacity.count(f.player, 'hard'), 1);
  assert.equal(f.inventory.getFreeSlots(), 26);
  assert.equal(f.open(), true);
  const first = Puzzle.boards().get(f.player).board;
  f.open(); assert.equal(Puzzle.boards().get(f.player).board, first, 'reopening keeps this box');
  first.splice(0, 25, ...Puzzle.solvedBoard()); Puzzle.slide(first, 23);
  Puzzle.click({ player: f.player, slot: 24 });
  assert.equal(f.box().getMetaValue(f.key).solved, true);
  const index = all.indexOf(boxes[1]);
  t.mock.method(Math, 'random', () => (index + 0.5) / all.length);
  f.talk(boxes[0]);
  assert.equal(f.inventory.getAmount(boxes[0].puzzle.itemId), 0);
  assert.equal(f.inventory.forSlot(0).getMetaValue(f.key).completed, 2);
  f.player.moveTo(new core.Location(boxes[1].location.x, boxes[1].location.y, boxes[1].location.z));
  f.talk(boxes[1]); f.open();
  const second = Puzzle.boards().get(f.player).board;
  assert.notEqual(second, first);
  assert.equal(Puzzle.isSolved(second), false);
  assert.ok(f.inventory.getItems().every(item => item instanceof core.Item));
});

test('hard question and puzzle handouts require space and preserve clue capacity', t => {
  const f = realFixture(t), Capacity = require('../plugins/treasuretrails/Capacity.ClueCapacity');
  Capacity(new Proxy({ core }, { get: (target, key) => target[key] ?? (() => {}) }));
  for (const kind of ['challenge', 'puzzle']) {
    const step = Runtime.data(HARD).steps.find(entry => entry[kind]);
    f.place(step);
    f.inventory.add(new core.Item(I.SPADE, 27), false);
    f.talk(step);
    assert.equal(f.inventory.getAmount(step.itemId), 1);
    assert.equal(f.inventory.getAmount(step[kind].itemId), 0);
    f.inventory.deleteNumber(I.SPADE, 1);
    f.talk(step); f.talk(step);
    assert.equal(f.inventory.getAmount(step.itemId), 1);
    assert.equal(f.inventory.getAmount(step[kind].itemId), 1, 'handout cannot duplicate');
    assert.equal(Capacity.count(f.player, 'hard'), 1);
    assert.equal(Runtime.trails(f.player).length, 1, 'auxiliary item is not another trail');
  }
});

test('Uri waits for the outfit and repeat emote after a double agent dies in combat gear', t => {
  const f = realFixture(t), step = Runtime.data(HARD).steps.find(entry => entry.family === 'emote');
  f.place(step);
  const equipment = f.player.getEquipment();
  const equip = () => { for (const item of outfit(step)) equipment.set(core.ItemDefinition.forId(item.getId()).getEquipmentType().getSlot(), item); };
  equip(); Runtime.emote({ player: f.player, slot: step.emotes[0] });
  assert.equal(f.spawned.length, 1);
  equipment.resetItems(); f.spawned[0].hitpoints = 0;
  Runtime.encounterDied({ npc: f.spawned[0] });
  assert.equal(f.spawned.length, 1, 'no Uri in the wrong outfit');
  assert.equal(f.inventory.forSlot(0).getMetaValue(f.key).defeated, true);
  equip();
  assert.equal(f.spawned.length, 1, 're-equipping alone does not summon Uri');
  Runtime.emote({ player: f.player, slot: step.emotes[0] });
  assert.equal(f.spawned.length, 2);
  assert.equal(f.spawned[1].def.id, Runtime.data(HARD).uri);
  f.talk(step, f.spawned[1].def.id, f.spawned[1]);
  assert.equal(f.inventory.forSlot(0).getMetaValue(f.key).completed, 2);
  assert.equal(f.inventory.getFreeSlots(), 27);
});

test("the puzzle box and Monkey Madness I's reinitialisation panel share the interface: the one opened last answers", () => {
  const f = fixture();
  const step = steps().find(entry => entry.puzzle);
  f.place(step); f.talk(step.npcIds[0]); f.finish();
  let finished = 0;
  const panel = require("../plugins/quests/quests/Puzzle.MonkeyMadnessI")(f.api, { onSolved: () => finished++, isActive: () => true });
  const reinit = C.getInventoryId("reinitialisation_inv");
  const pieces = ids => ids.map(item => item ? C.getObjNames().get(item.id) : null);
  const panelBoard = () => pieces(f.sent.filter(([name, inv]) => name === "sendInventory" && inv === reinit).at(-1)[3]);
  const panelSends = () => f.sent.filter(([name, inv]) => name === "sendInventory" && inv === reinit).length;

  f.actions.get("Puzzle box (hard)").Open(f.boxEvent());
  const box = [...Puzzle.boards().get(f.player).board];
  panel.operate(f.player);
  const opened = panelBoard();
  assert.ok(f.sent.some(([name, varp, value]) => name === "sendConfig" && varp === C.getVarpId("if1") && value === 7), "if1 7 selects inventory 221");
  assert.ok(f.sent.some(([name, inv]) => name === "sendInventoryStopTransmit" && inv === C.getInventoryId("trail_puzzleinv")), "the box's inventory is dropped on the client");

  f.press(Puzzle.neighbours(opened.indexOf(null))[0]);
  const moved = panelBoard();
  assert.notDeepEqual(moved, opened, "the panel board answered");
  assert.deepEqual(Puzzle.boards().get(f.player).board, box, "the box board did not");

  panel.operate(f.player);
  assert.deepEqual(panelBoard(), moved, "reopening keeps the panel board");

  f.actions.get("Puzzle box (hard)").Open(f.boxEvent());
  const sends = panelSends();
  assert.ok(f.sent.some(([name, inv]) => name === "sendInventoryStopTransmit" && inv === reinit), "the panel's inventory is dropped on the client");
  const boxBoard = Puzzle.boards().get(f.player).board;
  const slot = Puzzle.neighbours(boxBoard.indexOf(Puzzle.BLANK))[0];
  const before = [...boxBoard];
  f.press(slot);
  assert.notDeepEqual(boxBoard, before, "the box board answered");
  assert.equal(panelSends(), sends, "the panel board did not");
  assert.equal(finished, 0);

  solveBox(f);
  assert.equal(f.state().solved, true);
  assert.equal(finished, 0, "solving the box never finishes the panel puzzle");
  panel.operate(f.player);
  assert.deepEqual(panelBoard(), moved, "the panel puzzle is where it was left");
});

test("a dig that gives the next hard clue plays human_dig with the dig sound and says \"You've found another clue!\"", t => {
  const boxes = [];
  t.mock.method(Dialogue, "itemBox", (player, itemId, text) => boxes.push(text));
  const f = fixture();
  const step = ofKind("coordinate").find(entry => !entry.encounter) ?? ofKind("map", "coord")[0];
  f.place(step);
  f.items[1] = new core.Item(I.SPADE, 1);
  assert.equal(f.digHere(), false);
  assert.ok(f.sent.some(([kind, value]) => kind === "animation" && value.getId() === (C.getSeqId("human_dig") ?? 830)));
  assert.ok(f.sent.some(([kind, id]) => kind === "sendSoundEffect" && id === 1470), "dig sound 1470");
  assert.equal(f.state().completed, 2);
  assert.deepEqual(boxes, ["You've found another clue!"]);
});
