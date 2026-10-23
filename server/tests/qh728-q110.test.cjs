// From server/: node --test tests/qh728-q110.test.cjs
// Focused A Tail of Two Cats contracts. Cases fixture-set the durable stage and
// inventory/equipment that the transcript route would have produced, then dispatch
// the real registered handlers and assert their observable effects. This proves
// those handler and wire contracts only; it is not a natural playthrough, and the
// Quest Helper overlay was not checked.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const noop = () => {};

const STAGE_ATTR = 'quest.a_tail_of_two_cats.stage';
const FLAGS_ATTR = 'quest.a_tail_of_two_cats.flags';
const HAT_ATTR = 'quest.a_tail_of_two_cats.hat';
const PATCH_ATTR = 'quest.a_tail_of_two_cats.patch';
const WIRE = 1028;
const START_HOOK = 'quest:a-tail-of-two-cats:start';
const BED = 9438;
const TABLE = 9435;
const FIREPLACE = 9442;
const PATCH = 9399;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const equipment = new Map();
  const varbits = new Map();
  const configs = new Map();
  const messages = [];
  const moves = [];
  const xp = [];
  let location = new core.Location(2918, 3558, 0);
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0,
    getVarp: (id) => configs.get(id) ?? 0,
    sendInterfaceRemoval() { return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    forceAdd: (_player, item) => { items.set(item.getId(), (items.get(item.getId()) ?? 0) + item.getAmount()); return true; },
    deleteNumber: (id, amount = 1) => { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
    deleteAtSlot: (slot, amount = 1) => { if (inventory.get(slot)) items.set(inventory.get(slot).getId(), Math.max(0, inventory.get(slot).getAmount() - amount)); return true; },
    getFreeSlots: () => 28 - [...items.values()].filter((amount) => amount > 0).length,
    isFull: () => inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
    get: (slot) => {
      const id = [...items.keys()].filter((itemId) => (items.get(itemId) ?? 0) > 0)[slot];
      return id === undefined ? undefined : { getId: () => id, getAmount: () => items.get(id) };
    },
    getItems: () => [...items.entries()].filter(([, amount]) => amount > 0).map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  const player = {
    attrs, items, equipment, varbits, configs, messages, moves, xp,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({
      get: (slot) => equipment.has(slot) ? { getId: () => equipment.get(slot) } : null,
      deleteNumber: (id, amount = 1) => {
        for (const [slot, value] of equipment) if (value === id) { if (amount <= 0) equipment.delete(slot); else equipment.set(slot, -1); return true; }
        return false;
      },
    }),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getExperience: (skill) => xp.filter((entry) => entry[0] === skill.getIndex()).reduce((sum, entry) => sum + entry[1], 0),
      addExperience: (skill, amount) => xp.push([skill.getIndex(), amount]),
    }),
    getPacketSender: () => sender,
    getWorld: () => ({ getNpcs: () => [] }),
    getLocation: () => location,
    setLocation: (x, y, z = 0) => { location = new core.Location(x, y, z); },
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, reset: noop, startDialogues: noop }),
    getUsername: () => 'qh728-q110',
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
  };
  return player;
}

function harness() {
  const events = new Map();
  const conditions = [];
  const variants = [];
  const npcInteractions = new Map();
  const objectInteractions = [];
  const itemOnObject = [];
  const itemOnNpc = [];
  const itemActions = new Map();
  const logins = [];
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcInteraction: (name, actions) => npcInteractions.set(name, actions),
    onObjectInteraction: (handler) => objectInteractions.push(handler),
    onItemOnObject: (first, second) => { if (typeof first === 'function') itemOnObject.push({ handler: first, filter: second }); },
    onItemOnNpc: (handler, filter) => itemOnNpc.push({ handler, filter }),
    onItemAction: (item, actions) => itemActions.set(item, actions),
    onCustomEvent: (name, handler) => { const list = events.get(name) ?? []; list.push(handler); events.set(name, list); },
    emitCustomEvent: (name, event) => (events.get(name) ?? []).forEach((handler) => handler(event)),
    onPlayerLogin: (handler) => logins.push(handler),
    getWorld: () => ({ getNpcs: () => [] }),
    sendMultiChatboxPrompt: () => true,
  }, { get: (target, key) => key in target ? target[key] : noop });
  require('../plugins/quests/quests/TailOfTwoCats.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);
  const fire = (name, event) => (events.get(name) ?? []).forEach((handler) => handler(event));
  const select = (player, npcId) => {
    for (const handler of variants) {
      const choice = handler({ player, npcId });
      if (choice) return choice;
    }
    return null;
  };
  const condition = (player, stepId, npcId = N.UNFERTH, text = '') => {
    for (const handler of conditions) {
      const answer = handler({ player, stepId, npcId, text });
      if (typeof answer === 'boolean') return answer;
    }
    return null;
  };
  const talk = (player, name, npcId) => npcInteractions.get(name)?.['Talk-to']?.({ player, npcId, option: 'Talk-to', handled: false });
  return {
    quest, events, select, condition, talk,
    hook(player, hook = START_HOOK, npcId = N.UNFERTH) {
      fire('npc-dialogue:hook', { player, hook, npcId });
    },
    choice(player, npcId, option) {
      fire('npc-dialogue:choice', { player, npcId, option, stepId: undefined });
    },
    action(player, stepId, extra = {}) {
      const event = { player, stepId, kind: 'action', handled: false, ...extra };
      fire('npc-dialogue:action', event);
      return event;
    },
    message(player, stepId, text = '') {
      const event = { player, stepId, kind: 'message', text, handled: false };
      fire('npc-dialogue:action', event);
      return event;
    },
    object(player, objectId) {
      const event = { player, objectId, handled: false };
      objectInteractions.forEach((handler) => handler(event));
      return event;
    },
    itemOnObject(player, itemId, objectId) {
      const event = { player, itemId, objectId, object: {}, handled: false };
      itemOnObject.forEach(({ handler }) => handler(event));
      return event;
    },
    itemOnNpc(player, itemId, npcId) {
      const event = { player, itemId, npcId, target: {}, item: {}, handled: false };
      itemOnNpc.forEach(({ handler }) => handler(event));
      return event;
    },
    itemAction(player, itemName, option, itemId) {
      const event = { player, itemId, item: { getId: () => itemId }, slot: 0, option, clickType: 1, handled: false };
      itemActions.get(itemName)?.[option]?.(event);
      return event;
    },
    login(player) { logins.forEach((handler) => handler({ player })); },
  };
}

const setStage = (player, stage) => player.attrs.set(STAGE_ATTR, stage);
const stageOf = (player) => Number(player.attrs.get(STAGE_ATTR)) || 0;

test('registered handler graph reaches the cache completion wire 1028=70, rewards once, and replays on bootstrap', () => {
  const h = harness();
  const p = makePlayer();

  assert.equal(h.select(p, N.UNFERTH), 'starting-out', 'fresh stage 0 offers the start page');
  h.hook(p, 'quest:not-this-quest');
  assert.equal(stageOf(p), 0);
  h.hook(p);
  assert.equal(stageOf(p), 1);
  assert.equal(p.varbits.get(WIRE), 5, 'started maps to helper stage 5');

  p.items.set(I.DEATH_RUNE, 5);
  p.items.set(I.CATSPEAK_AMULET, 1);
  h.message(p, '4OiD70');
  h.message(p, 'XfUKZ6');
  assert.equal(p.items.get(I.DEATH_RUNE) ?? 0, 0, 'five death runes consumed');
  assert.equal(p.items.get(I.CATSPEAK_AMULET) ?? 0, 0, 'plain amulet consumed');
  assert.equal(p.items.get(I.CATSPEAK_AMULET_E_) ?? 0, 1, 'enchanted amulet created');
  assert.equal(stageOf(p), 2);
  assert.equal(p.varbits.get(WIRE), 15, 'enchanted maps to helper stage 15');

  assert.equal(h.select(p, N.BOB), 'finding-bob');
  assert.equal(stageOf(p), 3);
  assert.equal(p.varbits.get(WIRE), 20, 'found Bob maps to helper stage 20');

  assert.equal(h.select(p, N.GERTRUDE), null, 'Gertrude is owned by her Talk-to handler');
  h.choice(p, N.GERTRUDE, "Ask about Bob's parents.");
  assert.equal(stageOf(p), 4);
  assert.equal(p.varbits.get(WIRE), 25, 'asked Gertrude maps to helper stage 25');

  h.choice(p, N.RELDO, 'I have a cat related question.');
  assert.equal(stageOf(p), 5);
  assert.equal(p.varbits.get(WIRE), 30, 'asked Reldo maps to helper stage 30');

  assert.equal(h.select(p, N.BOB), 'returning-to-bob');
  assert.equal(stageOf(p), 6);
  assert.equal(p.varbits.get(WIRE), 35, 'told Bob maps to helper stage 35');

  // The Sphinx cutscene's two final options carry different message ids; both
  // start the chore list (the teleport itself is optional).
  h.message(p, '_Fpj9r');
  assert.equal(stageOf(p), 10);
  assert.equal(p.varbits.get(WIRE), 40, 'chores map to helper stage 40');
  assert.equal(p.items.get(I.CHORES) ?? 0, 1, 'chore list granted');

  p.items.set(I.LOGS, 1);
  p.items.set(I.TINDERBOX, 1);
  p.items.set(I.CHOCOLATE_CAKE, 1);
  p.items.set(I.BUCKET_OF_MILK, 1);
  p.items.set(I.SHEARS, 1);
  p.items.set(I.RAKE, 1);
  p.items.set(I.SEED_DIBBER, 1);
  p.items.set(I.POTATO_SEED, 4);

  h.object(p, BED);
  assert.equal(p.varbits.get(1029), 1);
  h.itemOnObject(p, I.LOGS, FIREPLACE);
  assert.equal(p.items.get(I.LOGS) ?? 0, 0);
  assert.equal(p.varbits.get(1030), 1);
  h.itemOnObject(p, I.TINDERBOX, FIREPLACE);
  assert.equal(p.varbits.get(1030), 2);
  h.itemOnObject(p, I.CHOCOLATE_CAKE, TABLE);
  assert.equal(p.items.get(I.CHOCOLATE_CAKE) ?? 0, 0);
  h.itemOnObject(p, I.BUCKET_OF_MILK, TABLE);
  assert.equal(p.items.get(I.BUCKET_OF_MILK) ?? 0, 0);
  assert.equal(p.varbits.get(1031), 4);
  h.itemOnNpc(p, I.SHEARS, N.UNFERTH);
  assert.equal(p.varbits.get(1032), 8);
  h.itemOnObject(p, I.RAKE, PATCH);
  assert.equal(p.varbits.get(1033), 3);
  h.itemOnObject(p, I.POTATO_SEED, PATCH);
  assert.equal(p.items.get(I.POTATO_SEED) ?? 0, 0, 'four potato seeds consumed');
  assert.equal(p.varbits.get(1033), 4);
  assert.ok(Number(p.attrs.get(PATCH_ATTR)) > Date.now(), 'potato growth timer set');

  p.attrs.set(PATCH_ATTR, Date.now() - 1);
  h.events.get('agent:advance-time').forEach((handler) => handler({ player: p, ms: 10, handledBy: [] }));
  assert.equal(p.varbits.get(1033), 8);
  assert.equal(stageOf(p), 20);
  assert.equal(p.varbits.get(WIRE), 45, 'chores done maps to helper stage 45');

  assert.equal(h.select(p, N.UNFERTH), 'medical-emergency');
  assert.equal(stageOf(p), 30);
  assert.equal(p.varbits.get(WIRE), 50, 'medical emergency maps to helper stage 50');

  h.message(p, 'nlTu2_');
  assert.equal(stageOf(p), 40);
  assert.equal(p.varbits.get(WIRE), 55, 'disguise hat maps to helper stage 55');
  assert.equal(p.items.get(I.DOCTORS_HAT) ?? 0, 1);

  p.equipment.set(core.Equipment.HEAD_SLOT, I.DOCTORS_HAT);
  p.equipment.set(core.Equipment.BODY_SLOT, I.DESERT_SHIRT);
  p.equipment.set(core.Equipment.LEG_SLOT, I.DESERT_ROBE);
  p.items.set(I.VIAL_OF_WATER, 1);
  h.message(p, 'Ijadj5');
  assert.equal(p.items.get(I.VIAL_OF_WATER) ?? 0, 0, 'vial of water consumed');
  assert.equal(stageOf(p), 50);
  assert.equal(p.varbits.get(WIRE), 60, 'cured maps to helper stage 60');
  assert.equal(p.varbits.get(6144), 0, 'Bob is visible again');
  assert.equal(p.varbits.get(6145), 1, 'Neite is visible');

  assert.equal(h.select(p, N.BOB), 'back-to-bob');
  h.action(p, 'EmFpdJ');
  assert.deepEqual(p.moves.at(-1), [2923, 3563, 0]);
  assert.equal(stageOf(p), 60);
  assert.equal(p.varbits.get(WIRE), 65, 'Bob back maps to helper stage 65');

  assert.equal(h.select(p, N.UNFERTH), 'back-to-bob-returning-to-unferth');
  const done = h.action(p, '-5euge');
  assert.equal(done.end, true);
  assert.equal(stageOf(p), 70);
  assert.equal(p.varbits.get(WIRE), 70, 'completion is the canonical cache threshold');
  assert.equal(p.attrs.get('quest.points'), 2);
  assert.equal(p.items.get(I.PRESENT) ?? 0, 1, 'present awarded once');

  h.action(p, '-5euge');
  assert.equal(p.items.get(I.PRESENT) ?? 0, 1, 'repeat hand-in does not duplicate the reward');
  assert.equal(p.attrs.get('quest.points'), 2);

  p.varbits.delete(WIRE);
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(WIRE), 70, 'bootstrap replays completion');

  setStage(p, 60);
  p.varbits.set(WIRE, 60);
  runtime.sendQuestVarps({ player: p });
  assert.equal(stageOf(p), 60, 'existing durable save is preserved');
  assert.equal(p.varbits.get(WIRE), 65, 'existing stage 60 saves replay helper wire 65');
  assert.equal(h.quest.isComplete(p), false);
});

test('Hild only enchants with five runes and a catspeak amulet; the lost-run branch is guarded', () => {
  const h = harness();
  const p = makePlayer();
  setStage(p, 1);
  assert.equal(h.condition(p, 'jJvdhF', N.HILD_2), true);
  assert.equal(h.condition(p, 'dGGdBa', N.HILD_2), false);
  p.items.set(I.DEATH_RUNE, 5);
  assert.equal(h.condition(p, 'jJvdhF', N.HILD_2), false);
  assert.equal(h.condition(p, 'dGGdBa', N.HILD_2), false, 'no plain amulet yet');
  p.items.set(I.CATSPEAK_AMULET, 1);
  assert.equal(h.condition(p, 'dGGdBa', N.HILD_2), true);
  assert.equal(h.condition(p, 'z6MmKU', N.HILD_2), false, 'unresolved wiki jump stays closed');
});

test('both Sphinx cutscene exits start the chore list; OxgFrB teleports to Burthorpe', () => {
  for (const stepId of ['5-sEgA', '_Fpj9r']) {
    const h = harness();
    const p = makePlayer();
    setStage(p, 6);
    h.message(p, stepId);
    assert.equal(stageOf(p), 10);
    assert.equal(p.varbits.get(WIRE), 40);
    assert.equal(p.items.get(I.CHORES) ?? 0, 1);
  }
  const h = harness();
  const p = makePlayer();
  setStage(p, 6);
  h.action(p, 'OxgFrB', { action: 'teleport' });
  assert.deepEqual(p.moves.at(-1), [2923, 3563, 0]);
});

test('the Apothecary alternates a lost doctor/nurse hat and the cure requires the declared equipment', () => {
  const h = harness();
  const p = makePlayer();
  setStage(p, 40);
  p.attrs.set(HAT_ATTR, 0); // doctor last
  assert.equal(h.condition(p, 'Tdu3b3', N.APOTHECARY), true);
  assert.equal(h.condition(p, 'FgxNOb', N.APOTHECARY), false);
  assert.equal(h.condition(p, 'qTxDW1', N.APOTHECARY), true);
  h.message(p, 'UUtW8M');
  assert.equal(p.items.get(I.NURSE_HAT) ?? 0, 1);
  assert.equal(p.attrs.get(HAT_ATTR), 1);
  p.items.delete(I.NURSE_HAT);
  assert.equal(h.condition(p, 'FgxNOb', N.APOTHECARY), true);
  h.message(p, 'Va-d-n');
  assert.equal(p.items.get(I.DOCTORS_HAT) ?? 0, 1);

  p.equipment.set(core.Equipment.HEAD_SLOT, I.NURSE_HAT);
  p.equipment.set(core.Equipment.BODY_SLOT, I.DESERT_SHIRT);
  p.equipment.set(core.Equipment.LEG_SLOT, I.DESERT_ROBE);
  p.equipment.set(core.Equipment.WEAPON_SLOT, 1);
  p.items.set(I.VIAL_OF_WATER, 1);
  assert.equal(h.condition(p, 'y21iOQ', N.UNFERTH), true, 'weapon blocks the cure');
  p.equipment.delete(core.Equipment.WEAPON_SLOT);
  assert.equal(h.condition(p, 'De2r23', N.UNFERTH), true);
});

test('a full-bag completion still delivers the present through the runtime force-add path', () => {
  const h = harness();
  const p = makePlayer();
  setStage(p, 60);
  for (let slot = 0; slot < 28; slot++) p.items.set(9000 + slot, 1);
  h.action(p, '-5euge');
  assert.equal(stageOf(p), 70);
  assert.equal(p.items.get(I.PRESENT) ?? 0, 1);
});

test('opening the present needs two free slots and creates two lamps plus a mouse toy', () => {
  const h = harness();
  const p = makePlayer();
  p.items.set(I.PRESENT, 1);
  for (let slot = 0; slot < 26; slot++) p.items.set(9100 + slot, 1);
  h.itemAction(p, 'Present', 'Open', I.PRESENT);
  assert.equal(p.items.get(I.PRESENT) ?? 0, 1, 'present kept when space is short');

  p.items.delete(9100);
  h.itemAction(p, 'Present', 'Open', I.PRESENT);
  assert.equal(p.items.get(I.PRESENT) ?? 0, 0, 'present consumed');
  assert.equal(p.items.get(I.ANTIQUE_LAMP_2) ?? 0, 2);
  assert.equal(p.items.get(I.MOUSE_TOY) ?? 0, 1);
});

test('the start page gates on Icthlarin, cat ownership and the follower split', () => {
  const h = harness();
  const p = makePlayer();
  assert.equal(h.condition(p, 'pZkgC1'), true, 'Icthlarin not complete');
  p.attrs.set('quest.ictlharins_little_helper.stage', 26);
  assert.equal(h.condition(p, 'pZkgC1'), false);
  assert.equal(h.condition(p, '1FzJGG'), true, 'no cat owned');
  p.items.set(I.PET_CAT, 1);
  assert.equal(h.condition(p, '1FzJGG'), false);
  assert.equal(h.condition(p, 'iSyLD_'), true, 'cat item is not a follower');
  assert.equal(h.condition(p, 'rTGaaG'), false);
});
