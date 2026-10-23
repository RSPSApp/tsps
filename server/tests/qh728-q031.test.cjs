// Elemental Workshop II (q031) source-contract checks.
// From server/: node --test tests/qh728-q031.test.cjs (after yarn build).
// Fixtures set the starting stage/flag state where a leg would otherwise need the
// whole earlier route; every assertion dispatches a handler the plugin registers.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, O = core.ObjectIdentifiers, N = core.NpcIdentifiers;
const FLAGS = 'quest.elemental_workshop_ii.flags';
const JIG = 'quest.elemental_workshop_ii.jig';
const WATER = 'quest.elemental_workshop_ii.water';
const AIR = 'quest.elemental_workshop_ii.air';
const PIPES = 'quest.elemental_workshop_ii.pipes';
const CRATES = 'quest.elemental_workshop_ii.crates';
const HATCH_OPEN = 1 << 1;
const SCHEMATIC_TAKEN = (1 << 5) | (1 << 6);
const noop = () => {};
let h;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  h = harness();
});

function harness() {
  const hooks = {}, events = {}, prompts = [];
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(player, prompt, ...pairs) {
      const options = [];
      for (let i = 0; i + 1 < pairs.length; i += 2) options.push({ label: pairs[i], choose: pairs[i + 1] });
      const entry = { prompt, options };
      player.prompt = entry;
      prompts.push(entry);
      return true;
    },
  }, {
    get: (target, key) => target[key] ?? ((...args) => {
      const fn = args.find(value => typeof value === 'function');
      if (fn) (hooks[key] ??= []).push(fn);
    }),
  });
  // Real registry order (Quests.plugin.js): EW1 registers before EW2.
  require('../plugins/quests/quests/ElementalWorkshopI.Quest')(api);
  require('../plugins/quests/quests/ElementalWorkshopII.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === 'elemental_workshop_ii');
  return {
    events,
    prompts,
    quest,
    login(player) { (hooks.onPlayerLogin ?? []).forEach(fn => fn({ player })); },
    object(player, objectId, option) {
      const event = { player, objectId, clickType: 1, handled: false,
        definition: { getInteractions: () => [option] } };
      (hooks.onObjectInteraction ?? []).forEach(fn => fn(event));
      return event;
    },
    itemOnObject(player, itemId, objectId) {
      const event = { player, itemId, objectId, handled: false };
      (hooks.onItemOnObject ?? []).forEach(fn => fn(event));
      return event;
    },
    itemOnNpc(player, itemId, npcId) {
      const event = { player, itemId, npcId, handled: false };
      (hooks.onItemOnNpc ?? []).forEach(fn => fn(event));
      return event;
    },
    npc(player, npcId, option) {
      const event = { player, npcId, clickType: 1, handled: false,
        definition: { getActions: () => [option] } };
      (hooks.onNpcInteraction ?? []).forEach(fn => fn(event));
      return event;
    },
    itemAction(player, itemId, option) {
      const event = { player, itemId, option, handled: false };
      (hooks.onItemAction ?? []).forEach(fn => fn(event));
      return event;
    },
    choice(player, option) {
      const event = { player, npcId: N.JIG_CART, option, text: option };
      (events['npc-dialogue:choice'] ?? []).forEach(fn => fn(event));
      return event;
    },
    hook(player, hook) {
      const event = { player, npcId: N.JIG_CART, hook };
      (events['npc-dialogue:hook'] ?? []).forEach(fn => fn(event));
    },
  };
}

function container(size) {
  let items = Array.from({ length: size }, () => new core.Item(-1, 0));
  return {
    getItems: () => items,
    getAmount: id => items.filter(item => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
    getFreeSlots: () => items.filter(item => item.getId() < 0).length,
    isFull() { return this.getFreeSlots() === 0; },
    adds(id, amount) {
      const index = items.findIndex(item => item.getId() < 0);
      assert.ok(index >= 0, 'inventory full');
      items[index] = new core.Item(id, amount);
    },
    deleteNumber(id, amount) {
      const index = items.findIndex(item => item.getId() === id);
      assert.ok(index >= 0, `missing item ${id}`);
      const left = items[index].getAmount() - amount;
      items[index] = left > 0 ? new core.Item(id, left) : new core.Item(-1, 0);
    },
    clear() { items = Array.from({ length: size }, () => new core.Item(-1, 0)); },
  };
}

function player() {
  const attrs = new Map(), varbits = new Map(), configs = new Map(), xp = [], messages = [];
  let location = new core.Location(1954, 5147, 2);
  const inventory = container(28);
  let manager;
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendString() { return packet; },
    sendInterfaceRemoval() { manager.reset(); return packet; },
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const p = {
    attrs, varbits, configs, xp, messages, inventory,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => packet,
    getDialogueManager: () => manager,
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      setCurrentLevel: noop,
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
    }),
    getLocation: () => location,
    moveTo: to => { location = to; },
    isRegistered: () => true,
    isPlayer: () => true,
    getAsPlayer: () => p,
    getUsername: () => 'qh728-q031',
    getIndex: () => 1,
    sendMessage: message => messages.push(message),
  };
  manager = new DialogueManager(p);
  return p;
}

test('fresh stage 0 start gate, book/scroll reading and the hatch key leg', () => {
  const p = player();
  assert.equal(h.quest.getStage(p), 0);

  h.object(p, O.BOOKCASE_66, 'Search');
  assert.equal(h.quest.getStage(p), 0, 'Elemental Workshop I is required first');

  h.events['quest:is-complete'] ??= [];
  h.events['quest:is-complete'].push(event => {
    if (event.key === 'elemental_workshop_i') event.complete = true;
  });
  h.object(p, O.BOOKCASE_66, 'Search');
  h.hook(p, 'quest:elemental-workshop-ii:start');
  assert.equal(h.quest.getStage(p), 1);
  assert.equal(p.inventory.getAmount(I.BEATEN_BOOK), 1);
  assert.equal(p.inventory.getAmount(I.SCROLL_3), 1);

  h.itemAction(p, I.BEATEN_BOOK, 'Read');
  assert.equal(h.quest.getStage(p), 2);
  h.itemAction(p, I.SCROLL_3, 'Read');
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(p.varbits.get(2640), 1, 'reading the scroll reveals the key');

  h.object(p, 18593, 'Search');
  assert.equal(p.inventory.getAmount(I.KEY_11), 1);
  assert.equal(h.quest.getStage(p), 4);
  h.itemOnObject(p, I.KEY_11, O.HATCH);
  assert.equal(h.quest.getStage(p), 5);
  assert.equal(p.varbits.get(2641), 1, 'the hatch opens');
});

test('the workshop hatch still lands on the machine floor', () => {
  const p = player();
  h.quest.setStage(p, 6);
  p.setAttribute(FLAGS, HATCH_OPEN);
  const event = h.object(p, O.HATCH, 'Climb-down');
  assert.equal(event.handled, true);
  assert.ok(p.getLocation().equals(new core.Location(1954, 5156, 2)));
});

test('the basement stairwell reaches the extractor room, not the hatch landing', () => {
  const p = player();
  h.quest.setStage(p, 6);
  p.setAttribute(FLAGS, HATCH_OPEN);
  const event = h.object(p, O.STAIRWELL, 'Climb-down');
  assert.equal(event.handled, true);
  assert.ok(p.getLocation().equals(new core.Location(1948, 5161, 0)));
});

test('searching a crate gives its item once both schematics are taken', () => {
  const p = player();
  h.quest.setStage(p, 6);
  p.setAttribute(FLAGS, SCHEMATIC_TAKEN);
  p.setAttribute(CRATES, 0 | (1 << 3) | (2 << 6) | (3 << 9));
  const event = h.object(p, O.CRATE_162, 'Search');
  assert.equal(event.handled, true);
  assert.equal(p.inventory.getAmount(I.SMALL_COG), 1);
});

test('taking a schematic choice advances only after both are held', () => {
  const p = player();
  h.quest.setStage(p, 5);
  h.choice(p, 'Crane schematic');
  assert.equal(p.inventory.getAmount(I.CRANE_SCHEMATIC), 1);
  assert.equal(h.quest.getStage(p), 5);
  h.choice(p, 'Lever schematic');
  assert.equal(p.inventory.getAmount(I.LEVER_SCHEMATIC), 1);
  assert.equal(h.quest.getStage(p), 6);
});

test('crane repair, junction pipes, pipe repair and cogs reach the repairs stage', () => {
  const p = player();
  h.quest.setStage(p, 6);
  p.setAttribute(JIG, 1 << 5); // crane lowered, waiting for a claw
  p.inventory.adds(I.CRANE_CLAW, 1);
  h.itemOnObject(p, I.CRANE_CLAW, O.OLD_CRANE_16);
  assert.equal(p.inventory.getAmount(I.CRANE_CLAW), 0);
  assert.equal(h.quest.getStage(p), 7);
  assert.equal(p.varbits.get(2644), 1, 'crane repaired');

  for (let i = 0; i < 3; i++) h.object(p, O.JUNCTION_BOX, 'Open');
  assert.equal(h.quest.getStage(p), 8);
  assert.equal(p.varbits.get(2646), 5);
  assert.equal(p.varbits.get(2647), 6);
  assert.equal(p.varbits.get(2648), 13);

  p.inventory.adds(I.PIPE, 1);
  h.itemOnObject(p, I.PIPE, 3414);
  assert.equal(p.inventory.getAmount(I.PIPE), 0);
  p.inventory.adds(I.SMALL_COG, 1);
  p.inventory.adds(I.MEDIUM_COG, 1);
  p.inventory.adds(I.LARGE_COG, 1);
  h.itemOnObject(p, I.SMALL_COG, O.PIN_2);
  h.itemOnObject(p, I.MEDIUM_COG, O.PIN);
  h.itemOnObject(p, I.LARGE_COG, O.PIN_3);
  assert.equal(p.varbits.get(2655), 1);
  assert.equal(p.varbits.get(2656), 2);
  assert.equal(p.varbits.get(2657), 3);
  assert.equal(h.quest.getStage(p), 9);
});

test('EW1 yields the workbench bar to EW2 only while EW2 needs the crane claw', () => {
  // Fixture stage 6 = both schematics taken, claw not made; test setup, not a natural run.
  const needing = player();
  h.quest.setStage(needing, 6);
  needing.setAttribute(FLAGS, SCHEMATIC_TAKEN);
  needing.inventory.adds(I.ELEMENTAL_METAL, 1);
  needing.inventory.adds(I.HAMMER, 1);
  const event = h.itemOnObject(needing, I.ELEMENTAL_METAL, O.WORKBENCH_5);
  assert.equal(needing.inventory.getAmount(I.ELEMENTAL_METAL), 1, 'bar survives the handoff');
  assert.equal(needing.inventory.getAmount(I.ELEMENTAL_SHIELD), 0, 'EW1 did not claim the bar');
  const prompt = needing.prompt;
  assert.ok(prompt, 'EW2 opened its claw transcript');
  assert.match(prompt.prompt, /Would you like to make/);
  const clawChoice = prompt.options.find(option => option.label.includes('An elemental claw.'));
  assert.ok(clawChoice, 'the canonical claw choice is offered');
  assert.equal(event.handled, true, 'EW2 owns the workbench interaction while it needs the claw');
  assert.equal(needing.inventory.getAmount(I.ELEMENTAL_METAL), 1, 'choice is still pending');
  clawChoice.choose();
  assert.equal(needing.inventory.getAmount(I.ELEMENTAL_METAL), 0);
  assert.equal(needing.inventory.getAmount(I.CRANE_CLAW), 1);

  // Fixture stage 7 = EW2 already past the claw leg; EW1 keeps its normal workbench.
  const shield = player();
  h.quest.setStage(shield, 7);
  shield.inventory.adds(I.ELEMENTAL_METAL, 1);
  shield.inventory.adds(I.BATTERED_BOOK, 1);
  shield.inventory.adds(I.HAMMER, 1);
  const owned = h.itemOnObject(shield, I.ELEMENTAL_METAL, O.WORKBENCH_5);
  assert.equal(owned.handled, true);
  assert.equal(shield.inventory.getAmount(I.ELEMENTAL_METAL), 0);
  assert.equal(shield.inventory.getAmount(I.ELEMENTAL_SHIELD), 1);
});

test('login replay keeps the mind-bar save below the cache threshold and completion at it', () => {
  const p = player();
  h.quest.setStage(p, 0);
  p.varbits.clear();
  h.login(p);
  assert.equal(p.varbits.get(2639), 0);

  h.quest.setStage(p, 11);
  p.varbits.clear();
  h.login(p);
  assert.equal(p.varbits.get(2639), 10, 'mind bar taken, helm not yet made');

  h.quest.setStage(p, 12);
  p.varbits.clear();
  h.login(p);
  assert.equal(p.varbits.get(2639), 11, 'cache DB column 19 completion threshold');
});

test('the priming machine, extractor and helm hand-in run through their handlers', () => {
  const p = player();
  const pull = objectId => h.object(p, objectId, 'Pull');
  const turn = objectId => h.object(p, objectId, 'Turn');
  h.quest.setStage(p, 9);
  p.setAttribute(JIG, 1 << 7); // crane repaired, raised, empty
  p.setAttribute(FLAGS, 1 << 2); // broken piping repaired
  p.setAttribute(PIPES, 5 | (6 << 4) | (13 << 8));
  p.setAttribute(AIR, 1 | (2 << 2) | (3 << 4));
  p.setAttribute(WATER, 0);
  p.inventory.adds(I.ELEMENTAL_METAL, 1);

  h.itemOnNpc(p, I.ELEMENTAL_METAL, N.JIG_CART);
  assert.equal(p.inventory.getAmount(I.ELEMENTAL_METAL), 0);
  pull(O.AN_OLD_LEVER_2);
  pull(O.AN_OLD_LEVER_2);
  pull(O.AN_OLD_LEVER);
  pull(O.AN_OLD_LEVER_2);
  pull(O.AN_OLD_LEVER_2);
  pull(O.AN_OLD_LEVER);
  pull(O.AN_OLD_LEVER_2);
  pull(O.AN_OLD_LEVER_2);
  pull(O.LEVER_47);
  pull(O.AN_OLD_LEVER_3);
  pull(O.LEVER_47);
  pull(O.AN_OLD_LEVER_4);
  turn(O.CORKSCREW_LEVER);
  turn(O.CORKSCREW_LEVER);
  pull(O.AN_OLD_LEVER_4);
  turn(O.WATER_VALVE_2);
  turn(O.WATER_VALVE_3);
  turn(O.WATER_VALVE_3);
  turn(O.WATER_VALVE_2);
  pull(O.AN_OLD_LEVER_4);
  turn(O.CORKSCREW_LEVER);
  turn(O.CORKSCREW_LEVER);
  pull(O.AN_OLD_LEVER_4);
  pull(O.LEVER_47);
  pull(O.AN_OLD_LEVER_5);
  pull(O.AN_OLD_LEVER_5);
  pull(O.LEVER_47);
  h.npc(p, N.JIG_CART_6, 'Take');
  assert.equal(p.inventory.getAmount(I.PRIMED_BAR), 1);
  assert.equal(h.quest.getStage(p), 10);

  h.itemOnObject(p, I.PRIMED_BAR, 18725);
  assert.equal(p.inventory.getAmount(I.PRIMED_BAR), 0);
  h.object(p, O.EXTRACTOR_HAT, 'Operate');
  h.object(p, 18725, 'Take-from');
  assert.equal(p.inventory.getAmount(I.PRIMED_MIND_BAR), 1);
  assert.equal(h.quest.getStage(p), 11);
  assert.equal(p.varbits.get(2639), 10, 'mind bar stage stays below the cache threshold');

  p.inventory.adds(I.HAMMER, 1);
  p.inventory.adds(I.BEATEN_BOOK, 1);
  h.itemOnObject(p, I.PRIMED_MIND_BAR, O.WORKBENCH_5);
  assert.equal(p.inventory.getAmount(I.MIND_HELMET), 1);
  assert.equal(h.quest.getStage(p), 12);
  assert.equal(p.varbits.get(2639), 11);
});

test('smithing the mind helm completes on varbit 2639=11 and rewards once', () => {
  const p = player();
  h.quest.setStage(p, 11);
  p.inventory.adds(I.HAMMER, 1);
  p.inventory.adds(I.BEATEN_BOOK, 1);
  p.inventory.adds(I.PRIMED_MIND_BAR, 1);
  const event = h.itemOnObject(p, I.PRIMED_MIND_BAR, O.WORKBENCH_5);
  assert.equal(event.handled, true);
  assert.equal(p.inventory.getAmount(I.PRIMED_MIND_BAR), 0);
  assert.equal(p.inventory.getAmount(I.MIND_HELMET), 1);
  assert.equal(h.quest.getStage(p), 12);
  assert.equal(p.varbits.get(2639), 11);
  assert.deepEqual(p.xp, [[core.Skill.CRAFTING.getIndex(), 7500], [core.Skill.SMITHING.getIndex(), 7500]]);
  assert.equal(p.attrs.get('quest.points'), 1);
});
