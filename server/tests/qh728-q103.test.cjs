// Sheep Herder (q103) source-contract audit.
// From server/: node --test tests/qh728-q103.test.cjs
//
// The route test fixture-sets only prerequisites/supplies and drives the
// registered handlers with the generated transcript's real variant names,
// condition texts/ids and action/message ids. It proves each handler contract,
// not a live dialogue walkthrough or the Java Quest Helper overlay.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const dialogues = require('../data/definitions/npc-dialogues.json');
const core = PluginManager.getCoreApi();
const noop = () => {};

const PAGE = 'Sheep Herder';
const VARP = 60;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const log = [];
  const drops = [];
  const equipment = new Map();
  let location = new core.Location(0, 0, 0);
  const isFull = () => inventory.getFreeSlots() <= 0;
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd: (_player, item) => {
      const id = item.getId();
      const amount = item.getAmount();
      if (isFull() && !(id === core.ItemIdentifiers.COINS && items.has(id))) {
        drops.push([id, amount]);
        return;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => 28 - [...items.values()].filter((amount) => amount > 0).length,
    isFull: () => isFull(),
    full: () => messages.push('Not enough space in your inventory.'),
    getItems: () => [],
  };
  const sender = new Proxy({}, {
    get: (_target, prop) => (...args) => {
      log.push([String(prop), ...args]);
      return sender;
    },
  });
  return {
    attrs, items, messages, moves, log, drops,
    setFull(value) {
      const fillers = [...Array(28).keys()].map((index) => 900000 + index);
      if (value) {
        for (const id of fillers) {
          if (inventory.getFreeSlots() <= 0) break;
          if (!items.has(id)) items.set(id, 1);
        }
      } else {
        for (const id of fillers) items.delete(id);
      }
    },
    setEquipment(slot, itemId) { equipment.set(slot, itemId ? { getId: () => itemId } : null); },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: (slot) => equipment.get(slot) ?? null }),
    getUsername: () => 'qh728-q103',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
    isPlayerBot: () => false,
  };
}

function harness() {
  const events = {};
  const variants = [];
  const conditions = [];
  const itemOnNpc = [];
  const npcInteraction = [];
  const itemOnObject = [];
  const objectInteraction = [];
  const zoneHandlers = [];
  const logins = [];
  const logouts = [];
  const spawned = [];
  const otherQuests = new Map();
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onNpcInteraction: (handler) => npcInteraction.push(handler),
    onItemOnNpc: (handler) => itemOnNpc.push(handler),
    onItemOnObject: (handler) => itemOnObject.push(handler),
    onObjectInteraction: (handler) => objectInteraction.push(handler),
    onZoneEnter: (_zone, handler) => zoneHandlers.push(handler),
    onPlayerLogin: (handler) => logins.push(handler),
    onPlayerLogout: (handler) => logouts.push(handler),
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach((handler) => handler(event)),
    spawnNpc: (definition) => {
      const npc = {
        id: definition.id,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z ?? 0),
        isRegistered: () => !npc.removed,
      };
      npc.remove = () => { npc.removed = true; };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { if (npc) npc.remove(); },
    getItemOnGroundManager: () => ({ getGroundItem: () => null, deregister: noop, registerLocation: noop }),
  }, { get: (target, key) => target[key] ?? noop });

  api.onCustomEvent('quest:is-started', (request) => {
    if (otherQuests.get(request.key)?.started) request.started = true;
  });
  api.onCustomEvent('quest:is-complete', (request) => {
    if (otherQuests.get(request.key)?.complete) request.complete = true;
  });

  require('../plugins/quests/quests/SheepHerder.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'sheep_herder');
  const player = makePlayer();

  const emit = (key, event) => (events[key] ?? []).forEach((handler) => handler(event));
  return {
    quest, player, variants, conditions, itemOnNpc, npcInteraction, itemOnObject, objectInteraction,
    zoneHandlers, logins, logouts, spawned, otherQuests, events, drops: player.drops,
    variant(npcId) { return variants.at(-1)({ player, npcId }); },
    condition(text, stepId, npcId) { emit('npc-dialogue:condition', { player, text, stepId, npcId }); },
    action(stepId, kind = 'action', npcId) {
      const event = { player, stepId, kind, npcId, handled: false };
      if (kind !== 'message') event.step = { type: 'action' };
      emit('npc-dialogue:action', event);
      return event;
    },
    hook(hook, npcId) { emit('npc-dialogue:hook', { player, hook, npcId, handled: false }); },
    prod(npc, npcId) {
      const event = {
        player, npc, npcId, clickType: 1, handled: false,
        definition: { getActions: () => ['Prod', null, null, null, null] },
      };
      npcInteraction.forEach((handler) => handler(event));
      return event;
    },
    feed(npc, npcId) {
      const event = { player, itemId: core.ItemIdentifiers.SHEEP_FEED, npcId, target: npc, handled: false };
      itemOnNpc.forEach((handler) => handler(event));
      return event;
    },
    burn(itemId) {
      const event = { player, itemId, objectId: core.ObjectIdentifiers.INCINERATOR, handled: false };
      itemOnObject.forEach((handler) => handler(event));
      return event;
    },
    object(objectId, location) {
      const event = { player, objectId, location, handled: false };
      objectInteraction.forEach((handler) => handler(event));
      return event;
    },
    enterZone() { zoneHandlers.forEach((handler) => handler({ player })); },
    liveSpawn(id) { return spawned.filter((npc) => !npc.removed && npc.id === id).at(-1); },
    login() { logins.forEach((handler) => handler({ player })); },
    logout() { logouts.forEach((handler) => handler({ player })); },
    item(itemId, amount = 1) { player.items.set(itemId, (player.items.get(itemId) ?? 0) + amount); },
  };
}

function variantSteps(name) {
  return dialogues[PAGE].variants[name];
}

function stepWithId(steps, predicate) {
  for (const step of steps ?? []) {
    if (predicate(step)) return step;
    for (const option of step.options ?? []) {
      const found = stepWithId(option.steps, predicate);
      if (found) return found;
    }
    const found = stepWithId(step.steps, predicate);
    if (found) return found;
  }
  return undefined;
}

test('fresh stage 0 completes the mandatory route and replays varp 60 = 3', () => {
  const h = harness();
  const p = h.player;
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  const O = core.ObjectIdentifiers;

  h.item(I.COINS, 100);
  assert.equal(h.quest.getStage(p), 0, 'fresh stage 0');

  // Starting out: the selected Sheep Herder page variant, not the Councillor
  // Halgrive page, carries the real start hand-out id.
  const startVariant = h.variant(N.COUNCILLOR_HALGRIVE);
  assert.equal(startVariant, 'starting-out-talking-to-councillor-halgrive');
  const feedStep = stepWithId(variantSteps(startVariant), (step) =>
    step.type === 'message' && /poisoned sheep feed/i.test(step.text ?? ''));
  assert.ok(feedStep?.id, 'the generated start variant has the sheep-feed hand-out id');

  h.hook('quest:sheep-herder:start', N.COUNCILLOR_HALGRIVE);
  assert.equal(h.quest.getStage(p), 1, 'the start hook starts the quest');
  h.action(feedStep.id, 'message', N.COUNCILLOR_HALGRIVE);
  assert.equal(p.items.get(I.SHEEP_FEED), 1, 'the start hand-out grants sheep feed');

  // Doctor Orbon sells the two-piece suit for 100 coins.
  const orbonVariant = h.variant(N.DOCTOR_ORBON);
  assert.equal(orbonVariant, 'starting-out-talking-to-doctor-orbon');
  const buyCondition = stepWithId(variantSteps(orbonVariant), (step) =>
    step.type === 'condition' && /100 coins and 2 free inventory spaces/i.test(step.text ?? ''));
  assert.ok(buyCondition?.id, 'the generated Orbon variant has the purchase condition id');
  h.condition(buyCondition.text, buyCondition.id, N.DOCTOR_ORBON);
  assert.equal(p.items.get(I.COINS) ?? 0, 0, 'the suit costs 100 coins');
  assert.equal(p.items.get(I.PLAGUE_JACKET), 1);
  assert.equal(p.items.get(I.PLAGUE_TROUSERS), 1);
  assert.equal(h.quest.getStage(p), 2, 'buying the suit advances to disposal');

  // Gate crossing needs the suit; the gate ids are the cache left/right gates.
  p.setEquipment(core.Equipment.BODY_SLOT, I.PLAGUE_JACKET);
  p.setEquipment(core.Equipment.LEG_SLOT, I.PLAGUE_TROUSERS);
  p.setLocation(2593, 3362, 0);
  const gate = h.object(O.GATE_14, { x: 2594, y: 3362, z: 0 });
  assert.equal(gate.handled, true, 'the left enclosure gate is owned');
  assert.deepEqual(p.moves.at(-1), [2595, 3362, 0]);
  p.setEquipment(core.Equipment.WEAPON_SLOT, I.CATTLEPROD);

  // Entering the farm zone spawns one owner-only sheep of each colour.
  h.enterZone();
  const sheep = [
    [N.RED_SHEEP, I.SHEEP_BONES_1_],
    [N.GREEN_SHEEP, I.SHEEP_BONES_2_],
    [N.BLUE_SHEEP, I.SHEEP_BONES_3_],
    [N.YELLOW_SHEEP, I.SHEEP_BONES_4_],
  ];
  for (const [npcId, bonesId] of sheep) {
    const loose = h.liveSpawn(npcId);
    assert.ok(loose, `the ${npcId} sheep spawned`);
    const prod = h.prod(loose, npcId);
    assert.equal(prod.handled, true, `prodding ${npcId} is owned`);
    const penned = h.liveSpawn(npcId);
    assert.notEqual(penned, loose, 'the loose sheep is replaced by the penned one');
    const feed = h.feed(penned, npcId);
    assert.equal(feed.handled, true, `feeding ${npcId} is owned`);
    assert.equal(p.items.get(bonesId), 1, `feeding ${npcId} yields its bones`);
    assert.equal(p.items.get(I.SHEEP_FEED), 1, 'the single sheep feed is reused');
    const burn = h.burn(bonesId);
    assert.equal(burn.handled, true, `burning bones ${bonesId} is owned`);
    assert.equal(p.items.get(bonesId) ?? 0, 0, `bones ${bonesId} are consumed`);
  }

  // Hand-in: completion action id from the generated finishing variant.
  const finishVariant = h.variant(N.COUNCILLOR_HALGRIVE);
  assert.equal(finishVariant, 'finishing-up-talking-to-councillor-halgrive-after-burning-all-bones');
  const completeStep = stepWithId(variantSteps(finishVariant), (step) =>
    step.type === 'action' && /quest complete/i.test(step.text ?? ''));
  assert.ok(completeStep?.id, 'the generated finishing variant has the completion action id');
  const wire = () => p.log.filter((row) => row[0] === 'sendConfig' && row[1] === VARP).at(-1)?.[2];
  h.action(completeStep.id);
  assert.equal(h.quest.getStage(p), 3);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(wire(), 3, 'completion sends canonical varp 60 = 3');
  assert.equal(p.attrs.get('quest.points'), 4);
  assert.equal(p.items.get(I.COINS), 3100, 'the 100-coin refund plus 3,000 reward');
  assert.ok(p.messages.some((text) => text.includes('Sheep Herder')));

  // Repeating the terminal action must not pay twice.
  h.action(completeStep.id);
  assert.equal(p.items.get(I.COINS), 3100);

  // Login replays the durable stage to varp 60 and does not respawn finished sheep.
  const spawnedBefore = h.spawned.length;
  runtime.sendQuestVarps({ player: p });
  assert.equal(wire(), 3, 'login replay sends varp 60 = 3');
  h.login();
  assert.equal(h.spawned.length, spawnedBefore, 'no sheep are spawned after completion');
  h.logout();
});

test('losing the sheep feed after buying the suit restocks from Halgrive', () => {
  const h = harness();
  const p = h.player;
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;

  h.quest.setStage(p, 2);
  assert.equal(h.variant(N.COUNCILLOR_HALGRIVE),
    'starting-out-talking-to-councillor-halgrive-talking-to-councillor-halgrive-again',
    'the again branch is selected while the feed is missing');
  const again = variantSteps('starting-out-talking-to-councillor-halgrive-talking-to-councillor-halgrive-again');
  const lostFeed = stepWithId(again, (step) => step.type === 'message' && /poisoned sheep feed/i.test(step.text ?? ''));
  assert.ok(lostFeed?.id);
  h.action(lostFeed.id, 'message', N.COUNCILLOR_HALGRIVE);
  assert.equal(p.items.get(I.SHEEP_FEED), 1, 'the lost-feed branch restocks the feed');
  assert.equal(h.variant(N.COUNCILLOR_HALGRIVE),
    'starting-out-talking-to-councillor-halgrive-after-getting-the-gear',
    'the normal disposal prompt returns once the feed is held');
});

test('a full bag with no coin stack still pays the full 3,100 coins', () => {
  const h = harness();
  const p = h.player;
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;

  h.quest.setStage(p, 2);
  p.attrs.set('quest.sheep_herder.disposal', (6 << 0) | (6 << 3) | (6 << 6) | (6 << 9));
  p.setFull(true);
  assert.equal(p.getInventory().isFull(), true);
  const finishVariant = h.variant(N.COUNCILLOR_HALGRIVE);
  const completeStep = stepWithId(variantSteps(finishVariant), (step) =>
    step.type === 'action' && /quest complete/i.test(step.text ?? ''));
  h.action(completeStep.id);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(h.drops.reduce((sum, [, amount]) => sum + amount, 0), 3100,
    'the 3,099 onReward coin stack and generic 1 coin are both dropped');
  assert.equal(p.items.get(I.COINS) ?? 0, 0);
});

test('shared Halgrive and Orbon conversations yield to Song of the Elves', () => {
  const h = harness();
  const p = h.player;
  const N = core.NpcIdentifiers;

  h.quest.setStage(p, 3);
  h.otherQuests.set('song_of_the_elves', { started: true, complete: false });
  assert.equal(h.variant(N.COUNCILLOR_HALGRIVE), null, 'Halgrive is left to Song of the Elves');
  assert.equal(h.variant(N.DOCTOR_ORBON), null, 'Orbon retraining is left to Song of the Elves');

  h.otherQuests.set('song_of_the_elves', { started: false, complete: false });
  assert.equal(h.variant(N.COUNCILLOR_HALGRIVE), 'standard-dialogue-after-sheep-herder');
  assert.equal(h.variant(N.DOCTOR_ORBON), 'standard-dialogue-before-song-of-the-elves',
    'post-quest Orbon stays in the pre-Song-of-the-Elves transcript');

  h.otherQuests.set('song_of_the_elves', { started: true, complete: true });
  assert.equal(h.variant(N.DOCTOR_ORBON), 'standard-dialogue-after-song-of-the-elves');
});

test('durable stages map straight to canonical varp 60 and stage 3 is the cache threshold', () => {
  const h = harness();
  const p = h.player;
  const wire = () => p.log.filter((row) => row[0] === 'sendConfig' && row[1] === VARP).at(-1)?.[2];

  assert.equal(h.quest.varpId, VARP);
  assert.equal(h.quest.completionValue, 3, 'cache DB row 130 column 19 threshold');
  for (const stage of [0, 1, 2, 3]) {
    h.quest.setStage(p, stage);
    assert.equal(wire(), stage, `durable stage ${stage} is sent unchanged`);
  }
  h.quest.setStage(p, 2);
  assert.equal(h.quest.isComplete(p), false, 'disposal stage is below the cache threshold');
  h.quest.setStage(p, 3);
  assert.equal(h.quest.isComplete(p), true);
});

test('losing the plague suit after the disposal stage can be rebought through the again branch', () => {
  const h = harness();
  const p = h.player;
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;

  h.quest.setStage(p, 2);
  h.item(I.COINS, 100);
  assert.equal(h.variant(N.DOCTOR_ORBON), 'starting-out-talking-to-doctor-orbon-talking-to-doctor-orbon-again');
  const branches = Object.values(dialogues[PAGE].branches).flat();
  const buy = stepWithId(branches, (step) =>
    step.type === 'condition' && /100 coins and 2 free inventory spaces/i.test(step.text ?? ''));
  assert.ok(buy?.id, 'the again branch reaches the same generated purchase condition');
  h.condition(buy.text, buy.id, N.DOCTOR_ORBON);
  assert.equal(p.items.get(I.COINS) ?? 0, 0);
  assert.equal(p.items.get(I.PLAGUE_JACKET), 1);
  assert.equal(p.items.get(I.PLAGUE_TROUSERS), 1);
  assert.equal(h.quest.getStage(p), 2, 'a rebuy does not restart the quest');
});

test('out-of-order prod, feed and burn actions are refused without changing items', () => {
  const h = harness();
  const p = h.player;
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;

  h.quest.setStage(p, 2);
  h.enterZone();
  const red = h.liveSpawn(N.RED_SHEEP);
  assert.ok(red);

  const bare = h.prod(red, N.RED_SHEEP);
  assert.equal(bare.handled, true);
  assert.ok(p.messages.includes('You need to wear the full protective plague suit.'));
  assert.equal(p.attrs.get('quest.sheep_herder.disposal') ?? 0, 0);

  p.setEquipment(core.Equipment.BODY_SLOT, I.PLAGUE_JACKET);
  p.setEquipment(core.Equipment.LEG_SLOT, I.PLAGUE_TROUSERS);
  const noProd = h.prod(red, N.RED_SHEEP);
  assert.equal(noProd.handled, true);
  assert.ok(p.messages.includes('You need to equip the cattleprod first.'));
  assert.equal(p.attrs.get('quest.sheep_herder.disposal') ?? 0, 0);

  // Feeding a loose sheep is refused: it must be penned first.
  p.items.set(I.SHEEP_FEED, 1);
  const looseFeed = h.feed(red, N.RED_SHEEP);
  assert.equal(looseFeed.handled, true);
  assert.ok(p.messages.includes('The sheep must be safely inside the enclosure first.'));
  assert.equal(p.items.get(I.SHEEP_BONES_1_) ?? 0, 0);

  // Bones from a still-loose sheep cannot be burned.
  p.items.set(I.SHEEP_BONES_1_, 1);
  const wrongBurn = h.burn(I.SHEEP_BONES_1_);
  assert.equal(wrongBurn.handled, true);
  assert.equal(p.items.get(I.SHEEP_BONES_1_), 1, 'a non-penned sheep leaves the bones untouched');
});
