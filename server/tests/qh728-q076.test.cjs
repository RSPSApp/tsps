// From server/: node --test tests/qh728-q076.test.cjs (no build needed; plugins load from source).
// QH q076 Monkey Madness II: source-contract audit. The route test fixtures the
// prerequisites, starting stage 0 and the ordinary supplies, then dispatches the
// registered NPC/object/item handlers and plays the real transcripts. It does not
// prove a live playthrough, a natural travel route or the Java overlay.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const core = require(root + '/dist/plugins/PluginManager').PluginManager.getCoreApi();
const runtime = require(root + '/plugins/quests/QuestRuntime');
const { PluginManager } = require(root + '/dist/plugins/PluginManager');
const noop = () => {};

const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const N = core.NpcIdentifiers;
const RFD_RESCUES_ATTRIBUTE = 'recipe-for-disaster:rescues';
const RFD_AWOWOGEI_RESCUE = 128;

before(async () => {
  const { CachePipeline } = require(root + '/dist/game/cache/CachePipeline');
  const { NpcDefinitionLoader } = require(root + '/dist/game/definition/loader/impl/NpcDefinitionLoader');
  await CachePipeline.initialize(root);
  new NpcDefinitionLoader().load();
});

function makePlayer({ items = [], attrs = [], freeSlots = 28, levels = new Map(), bankItems = [] } = {}) {
  const attributes = new Map(attrs), inventory = new Map(items), bank = new Set(bankItems);
  let location = new core.Location(3210, 3220, 0);
  let equipped = null;
  let free = freeSlots;
  const packet = new Proxy({
    sendInterfaceRemoval() {
      p.manager?.reset();
      p.prompt = null;
      return packet;
    },
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const p = {
    xp: [], moves: [], messages: [], items: inventory, attrs: attributes,
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({
      getAmount: id => inventory.get(id) ?? 0,
      contains: id => (inventory.get(id) ?? 0) > 0,
      isFull: () => free <= 0,
      getFreeSlots: () => free,
      getItems: () => [],
      getValidItems: () => [],
      adds: (id, amount) => {
        if (!inventory.has(id)) {
          if (free <= 0) {
            p.messages.push("You couldn't hold all those items.");
            return;
          }
          free--;
        }
        inventory.set(id, (inventory.get(id) ?? 0) + amount);
      },
      forceAdd: item => inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()),
      deleteNumber: (id, amount) => {
        const before = inventory.get(id) ?? 0;
        const after = Math.max(0, before - amount);
        if (before > 0 && after === 0) free++;
        inventory.set(id, after);
      },
    }),
    getEquipment: () => ({
      get: () => equipped,
      getAmount: () => (equipped ? 1 : 0),
      getItems: () => (equipped ? [equipped] : []),
    }),
    getSkillManager: () => ({
      getCurrentLevel: skill => levels.get(skill.getIndex()) ?? 99,
      getMaxLevel: skill => levels.get(skill.getIndex()) ?? 99,
      getCombatLevel: () => 126,
      addExperiences: (skill, amount) => p.xp.push([skill.getIndex(), amount]),
    }),
    getPacketSender: () => packet,
    getLocation: () => location,
    moveTo: to => { location = to; p.moves.push([to.getX(), to.getY(), to.getZ()]); },
    getBanks: () => [{
      contains: id => bank.has(id),
      getAmount: id => (bank.has(id) ? 1 : 0),
    }],
    getUsername: () => 'QH q076',
    getUpdateFlag: () => ({ flag: noop }),
    sendMessage: message => p.messages.push(message),
    performAnimation: noop,
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    setPositionToFace: noop,
    setEquipment(item) { equipped = item; },
    setFreeSlots(value) { free = value; },
    setBankItem(id, present = true) {
      if (present) bank.add(id);
      else bank.delete(id);
    },
  };
  const { DialogueManager } = require(root + '/dist/game/model/dialogues/DialogueManager');
  p.manager = new DialogueManager(p);
  p.getDialogueManager = () => p.manager;
  return p;
}

function register() {
  const hooks = {}, spawned = [], removed = [], drops = [], objects = [];
  const objectManager = {
    objectsAt: location => objects.filter(object => object.getLocation().equals(location)),
    register(object) { objects.push(object); },
    deregister(object) {
      const index = objects.indexOf(object);
      if (index >= 0) objects.splice(index, 1);
    },
  };
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: noop, cancelTasks: noop },
      ObjectManager: objectManager,
    },
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (hooks[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => {
      if (key === 'quest:is-complete') {
        event.complete = true;
        return;
      }
      if (key === 'recipe-for-disaster:rescue-status') {
        const rescues = Number(event.player?.getAttribute(RFD_RESCUES_ATTRIBUTE)) || 0;
        event.complete = (rescues & RFD_AWOWOGEI_RESCUE) !== 0;
        return;
      }
      (hooks[key] ?? []).forEach(fn => fn(event));
    },
    sendMultiChatboxPrompt(p, title, ...pairs) {
      p.prompt = { title, options: pairs.filter((_, index) => index % 2 === 0), pairs };
      return true;
    },
    getWorld: () => ({ getNpcs: () => spawned }),
    spawnNpc(definition) {
      let registered = true;
      const npc = {
        ...definition,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z ?? 0),
        isRegistered: () => registered,
        getOwner: () => definition.owner ?? null,
        remove() { registered = false; },
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      npc?.remove?.();
      removed.push(npc);
    },
    getItemOnGroundManager: () => ({
      registerLocation: (player, item, location) => drops.push({ player, item, location }),
    }),
  }, { get: (target, key) => target[key] ?? ((...args) => {
    (hooks[key] ??= []).push(args.find(arg => typeof arg === 'function'));
  }) });
  require(root + '/plugins/quests/quests/MonkeyMadnessII.Quest')(api);
  return {
    api, hooks, spawned, removed, drops, objects,
    quest: runtime.getRegisteredQuests().findLast(quest => quest.key === 'monkey_madness_ii'),
  };
}

function withConditions(hooks, fn) {
  const original = PluginManager.emitNpcDialogueCondition;
  PluginManager.emitNpcDialogueCondition = event => {
    for (const handler of hooks.onNpcDialogueCondition ?? []) {
      const answer = handler(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  try {
    return fn();
  } finally {
    PluginManager.emitNpcDialogueCondition = original;
  }
}

function reset(p) {
  p.manager.reset();
  p.prompt = null;
}

function choose(p, text) {
  const prompt = p.prompt;
  assert.ok(prompt, 'no menu for ' + text);
  const index = prompt.options.indexOf(text);
  assert.ok(index >= 0, 'missing ' + text + ' in ' + JSON.stringify(prompt.options));
  p.prompt = null;
  prompt.pairs[index * 2 + 1]();
}

function drive(p, wanted = [], strict = true) {
  for (let guard = 0; guard < 300; guard++) {
    if (p.prompt) {
      const match = wanted.find(option => p.prompt.options.includes(option));
      if (match) {
        choose(p, match);
        continue;
      }
      if (strict) throw new Error('unexpected prompt: ' + JSON.stringify(p.prompt.options));
      return p.prompt.options;
    }
    if (!p.manager.getCurrent()) return null;
    p.manager.advance();
  }
  throw new Error('dialogue did not finish');
}

function talk(harness, p, npcId) {
  reset(p);
  const event = {
    player: p, npcId, handled: false, clickType: 1,
    definition: { getActions: () => ['Talk-to'] },
  };
  for (const fn of harness.hooks.onNpcInteraction ?? []) fn(event);
  return event;
}

function talkHandled(harness, p, npcId, wanted = []) {
  return withConditions(harness.hooks, () => {
    const event = talk(harness, p, npcId);
    assert.equal(event.handled, true, `Talk-to must be handled for ${npcId} at stage ${harness.quest.getStage(p)}`);
    return drive(p, wanted);
  });
}

function object(harness, p, objectId, option, coords = [0, 0, 0]) {
  const location = new core.Location(...coords);
  const event = {
    player: p, objectId, location, object: { getLocation: () => location },
    handled: false, clickType: 1, definition: { getActions: () => [option] },
  };
  for (const fn of harness.hooks.onObjectInteraction ?? []) fn(event);
  return event;
}

function npcAction(harness, p, npcId, option) {
  const event = { player: p, npcId, handled: false, clickType: 1, definition: { getActions: () => [option] } };
  for (const fn of harness.hooks.onNpcInteraction ?? []) fn(event);
  return event;
}

function itemOnItem(harness, p, usedItemId, usedWithItemId) {
  const event = { player: p, usedItemId, usedWithItemId, handled: false };
  for (const fn of harness.hooks.onItemOnItem ?? []) fn(event);
  return event;
}

function itemOnObject(harness, p, itemId, objectId) {
  const location = new core.Location(0, 0, 0);
  const event = { player: p, itemId, objectId, location, handled: false };
  for (const fn of harness.hooks.onItemOnObject ?? []) fn(event);
  return event;
}

function itemAction(harness, p, itemId, option) {
  const event = { player: p, itemId, option, handled: false };
  for (const fn of harness.hooks.onItemAction ?? []) fn(event);
  return event;
}

function login(harness, p) {
  for (const fn of harness.hooks.onPlayerLogin ?? []) fn({ player: p });
}

function npcDeath(harness, p, npcId) {
  const npc = harness.spawned.find(candidate => candidate.id === npcId) ?? {};
  const event = { player: p, npc, npcId, killer: p };
  for (const fn of harness.hooks.onNpcDeath ?? []) fn(event);
}

function stage(harness, p) {
  return harness.quest.getStage(p);
}

function startPlayer() {
  return makePlayer({
    items: [
      [I.LEMON, 1], [I.GRAPES, 1], [I.PESTLE_AND_MORTAR, 1], [I.TRANSLATION_BOOK, 1],
      [I.MONKEY_TALISMAN, 1],
    ],
    attrs: [[RFD_RESCUES_ATTRIBUTE, RFD_AWOWOGEI_RESCUE]],
  });
}

test('fresh stage 0 requires Freeing King Awowogei and 60 Firemaking before Narnode starts the quest', () => {
  const harness = register();

  const noRfd = makePlayer({ levels: new Map() });
  assert.equal(withConditions(harness.hooks, () => talk(harness, noRfd, N.KING_NARNODE_SHAREEN).handled), false);
  assert.equal(stage(harness, noRfd), 0);

  const lowFiremaking = makePlayer({
    attrs: [[RFD_RESCUES_ATTRIBUTE, RFD_AWOWOGEI_RESCUE]],
    levels: new Map([[core.Skill.FIREMAKING.getIndex(), 59]]),
  });
  assert.equal(withConditions(harness.hooks, () => talk(harness, lowFiremaking, N.KING_NARNODE_SHAREEN).handled), false);
  assert.equal(stage(harness, lowFiremaking), 0);

  const ready = makePlayer({ attrs: [[RFD_RESCUES_ATTRIBUTE, RFD_AWOWOGEI_RESCUE]] });
  talkHandled(harness, ready, N.KING_NARNODE_SHAREEN, ["I'll help you look for Glough."]);
  assert.equal(stage(harness, ready), 5);
});

test('Anita cannot translate before the decoded note has been shown to Narnode', () => {
  const harness = register();
  const early = makePlayer();
  harness.quest.setStage(early, 15); // Fixture: handkerchief returned, nothing searched upstairs.
  withConditions(harness.hooks, () => {
    const event = talk(harness, early, N.ANITA);
    assert.equal(event.handled, true);
    drive(early, ['Could you translate these notes?'], false);
  });
  assert.equal(stage(harness, early), 15);
  assert.equal(early.items.get(I.TRANSLATED_NOTE) ?? 0, 0);

  const ready = makePlayer({ items: [[I.SCRAWLED_NOTE_2, 1]] });
  harness.quest.setStage(ready, 32); // Fixture: book tried, phrases missing.
  talkHandled(harness, ready, N.ANITA, ['Could you translate these notes?']);
  assert.equal(stage(harness, ready), 35);
  assert.equal(ready.items.get(I.TRANSLATED_NOTE) ?? 0, 1);
});

test('a lost Kruk greegree can be obtained again from Zooknock during the quest', () => {
  const harness = register();
  const p = makePlayer();
  harness.quest.setStage(p, 70); // Fixture: greegree made, then lost.
  talkHandled(harness, p, N.ZOOKNOCK_3);
  assert.equal(p.items.get(I.KRUK_MONKEY_GREEGREE) ?? 0, 1);
  assert.equal(stage(harness, p), 70);
});

test('a full bag leaves Kruk\'s paw on the ground instead of losing it', () => {
  const harness = register();
  const p = makePlayer({ freeSlots: 0 });
  harness.quest.setStage(p, 65); // Fixture: Kruk has just been killed.
  npcDeath(harness, p, N.KRUK_3);
  assert.equal(stage(harness, p), 66);
  assert.equal(p.items.get(I.KRUKS_PAW) ?? 0, 0);
  const drop = harness.drops.find(entry => entry.item.getId() === I.KRUKS_PAW);
  assert.ok(drop, 'paw should be dropped when the inventory is full');
  assert.equal(drop.item.getAmount(), 1);
});

test('owner-only Awowogei is released at stage 195 and stays released after relog', () => {
  const harness = register();
  const p = makePlayer();
  harness.quest.setStage(p, 60); // Fixture: Garkor briefed, MM2 Awowogei window open.
  login(harness, p);
  const awowogei = () => harness.spawned.find(npc => npc.id === 6812 && npc.isRegistered());
  assert.ok(awowogei(), 'MM2 owns Awowogei during the quest');
  const firstAwowogei = awowogei();
  login(harness, p);
  assert.equal(awowogei(), firstAwowogei, 'relogin keeps the existing live owner reference');
  assert.equal(harness.removed.includes(firstAwowogei), false);

  harness.api.emitCustomEvent('npc-dialogue:action', {
    player: p, npcId: 6812, stepId: 'FRajWl',
  });
  assert.equal(stage(harness, p), 195);
  assert.equal(awowogei(), undefined, 'completion releases Awowogei immediately');

  login(harness, p);
  assert.equal(awowogei(), undefined, 'relog at 195 does not leave a stale owner spawn');
});

test('Kruk remains recover a destroyed paw and keep a full bag retryable', () => {
  const harness = register();
  const p = makePlayer({ freeSlots: 0 });
  harness.quest.setStage(p, 66); // Fixture: Kruk killed, paw lost.
  login(harness, p);
  const remains = () => harness.objects.find(object => object.getId() === 28675);
  assert.ok(remains(), 'Kruk remains are registered for recovery');

  object(harness, p, 28675, 'Take-remains');
  assert.equal(p.items.get(I.KRUKS_PAW) ?? 0, 0);
  assert.equal(stage(harness, p), 66);
  assert.ok(remains(), 'a failed take leaves the remains retryable');

  p.setFreeSlots(1);
  object(harness, p, 28675, 'Take-remains');
  assert.equal(p.items.get(I.KRUKS_PAW) ?? 0, 1);

  p.getInventory().deleteNumber(I.KRUKS_PAW, 1);
  object(harness, p, 28675, 'Take-remains');
  assert.equal(p.items.get(I.KRUKS_PAW) ?? 0, 1, 'destroying the paw can be recovered from the remains');
  assert.ok(remains(), 'the remains stay until the stage moves past Kruk');

  harness.quest.setStage(p, 70);
  login(harness, p);
  assert.equal(remains(), undefined, 'leaving stage 66 clears the remains');
});

test('lost greegree recovery ignores a banked greegree and refuses a full bag without success', () => {
  const harness = register();
  const banked = makePlayer({ bankItems: [I.KRUK_MONKEY_GREEGREE] });
  harness.quest.setStage(banked, 70); // Fixture: the greegree is banked, not lost.
  const bankedTalk = talk(harness, banked, N.ZOOKNOCK_3);
  assert.equal(bankedTalk.handled, false, 'a banked greegree is not replaced');
  assert.equal(banked.items.get(I.KRUK_MONKEY_GREEGREE) ?? 0, 0);

  const full = makePlayer({ freeSlots: 0 });
  harness.quest.setStage(full, 70); // Fixture: greegree genuinely lost, bag full.
  talkHandled(harness, full, N.ZOOKNOCK_3);
  assert.equal(full.items.get(I.KRUK_MONKEY_GREEGREE) ?? 0, 0);
  assert.equal(stage(harness, full), 70);
  assert.ok(full.messages.some(message => /free inventory slot/.test(message)));

  full.setFreeSlots(1);
  talkHandled(harness, full, N.ZOOKNOCK_3);
  assert.equal(full.items.get(I.KRUK_MONKEY_GREEGREE) ?? 0, 1);
  assert.equal(stage(harness, full), 70);
});

test('Anita does not advance or lose the translated note when the bag is full', () => {
  const harness = register();
  const p = makePlayer({ items: [[I.SCRAWLED_NOTE_2, 1]], freeSlots: 0 });
  harness.quest.setStage(p, 32); // Fixture: note decoded and translation book tried.
  withConditions(harness.hooks, () => {
    talk(harness, p, N.ANITA);
    drive(p, ['Could you translate these notes?']);
  });
  assert.equal(stage(harness, p), 32, 'a failed handout must not advance');
  assert.equal(p.items.get(I.TRANSLATED_NOTE) ?? 0, 0);
  assert.ok(p.messages.some(message => /free inventory slot/.test(message)));

  p.setFreeSlots(1);
  talkHandled(harness, p, N.ANITA, ['Could you translate these notes?']);
  assert.equal(stage(harness, p), 35);
  assert.equal(p.items.get(I.TRANSLATED_NOTE) ?? 0, 1);
});

test('the jungle-grass trapdoor cancellation stays on the surface and does not start Kruk', () => {
  const harness = register();
  const p = makePlayer();
  harness.quest.setStage(p, 65);
  object(harness, p, O.JUNGLE_GRASS_4, 'Investigate');
  choose(p, 'No.');
  assert.equal(stage(harness, p), 65);
  assert.equal(p.moves.length, 0);
  assert.equal(harness.spawned.some(npc => npc.id === N.KRUK_3), false);
});

test('only the canonical end-of-dungeon Cavern entrance starts the Kruk fight', () => {
  const harness = register();
  const p = makePlayer();
  harness.quest.setStage(p, 65);
  const unrelatedEntrance = object(harness, p, O.CAVERN_ENTRANCE, 'Enter', [2516, 9210, 1]);
  assert.equal(unrelatedEntrance.handled, false);
  assert.equal(harness.spawned.some(npc => npc.id === N.KRUK_3), false);
  assert.equal(stage(harness, p), 65);
});

test('ship sabotage satchels can be refilled after some have already been planted', () => {
  const harness = register();
  const p = makePlayer({ items: [[I.SATCHEL, 2], [I.SATCHEL_2, 4]] });
  harness.quest.setStage(p, 80);

  object(harness, p, O.BARREL_136, 'Search');
  assert.equal(p.items.get(I.SATCHEL) ?? 0, 0);
  assert.equal(p.items.get(I.SATCHEL_2) ?? 0, 6, 'only the remaining empty satchels are filled');

  p.getInventory().deleteNumber(I.SATCHEL_2, 3);
  object(harness, p, O.CRATE_237, 'Search');
  assert.equal(p.items.get(I.SATCHEL) ?? 0, 3, 'crate replaces used satchels');
  object(harness, p, O.BARREL_136, 'Search');
  assert.equal(p.items.get(I.SATCHEL) ?? 0, 0);
  assert.equal(p.items.get(I.SATCHEL_2) ?? 0, 6, 'the empty replacements can be filled and used');
});

test('stage 0 to completion through the registered handlers and transcripts', () => {
  const harness = register();
  const p = startPlayer();
  const q = harness.quest;
  const expected = (value) => assert.equal(stage(harness, p), value);

  withConditions(harness.hooks, () => {
    talk(harness, p, N.KING_NARNODE_SHAREEN);
    drive(p, ["I'll help you look for Glough."]);
    expected(5);

    object(harness, p, O.TREE_125, 'Investigate');
    assert.equal(p.items.get(I.HANDKERCHIEF) ?? 0, 1);
    expected(10);

    talk(harness, p, N.ANITA);
    drive(p, ["What's wrong?", 'He might be in trouble, I could help.']);
    assert.equal(p.items.get(I.HANDKERCHIEF) ?? 0, 0);
    expected(15);

    object(harness, p, O.GNOME_STATUE_7, 'Investigate');
    object(harness, p, O.CUPBOARD_68, 'Search');
    object(harness, p, O.GNOME_CRATES_2, 'Search');
    object(harness, p, O.FIRE_REMAINS_8, 'Investigate');
    drive(p);
    assert.equal(p.items.get(I.BOOK_OF_SPYOLOGY) ?? 0, 1);
    assert.equal(p.items.get(I.BRUSH) ?? 0, 1);
    assert.equal(p.items.get(I.MYSTERIOUS_NOTE) ?? 0, 1);
    expected(20);

    itemOnItem(harness, p, I.PESTLE_AND_MORTAR, I.LEMON);
    itemOnObject(harness, p, I.MYSTERIOUS_NOTE, O.CANDLES_17);
    itemOnItem(harness, p, I.PESTLE_AND_MORTAR, I.GRAPES);
    itemOnItem(harness, p, I.JUICE_COATED_BRUSH, I.MYSTERIOUS_NOTE_3);
    assert.equal(p.items.get(I.SCRAWLED_NOTE_2) ?? 0, 1);
    expected(25);

    itemAction(harness, p, I.SCRAWLED_NOTE_2, 'Read');
    drive(p);

    talk(harness, p, N.KING_NARNODE_SHAREEN);
    drive(p);
    expected(30);

    itemOnItem(harness, p, I.TRANSLATION_BOOK, I.SCRAWLED_NOTE_2);
    drive(p);
    expected(32);

    talk(harness, p, N.ANITA);
    drive(p, ['Could you translate these notes?']);
    assert.equal(p.items.get(I.TRANSLATED_NOTE) ?? 0, 1);
    expected(35);

    talk(harness, p, N.KING_NARNODE_SHAREEN);
    drive(p);
    expected(40);

    talk(harness, p, N.ASSISTANT_LORI);
    drive(p, ['Who are you?', 'No.']);
    expected(45);

    talk(harness, p, N.AUGUSTE);
    drive(p, ['Talk about Assistant Le Smith.', 'Thanks for the information.', 'No.']);
    expected(50);

    talk(harness, p, N.KING_NARNODE_SHAREEN);
    drive(p);
    expected(55);

    talk(harness, p, N.GARKOR_3);
    drive(p, ['King Narnode has sent me.', "It's worth a shot."]);
    expected(60);

    talk(harness, p, 6812);
    drive(p, ["I'm here to discuss military strategies.", 'Of course, my king.']);
    expected(61);

    talk(harness, p, N.GARKOR_3);
    drive(p);
    expected(62);

    talk(harness, p, N.MONKEY_ARCHER_5);
    drive(p);
    expected(65);

    object(harness, p, O.JUNGLE_GRASS_4, 'Investigate');
    choose(p, 'Yes.');
    assert.deepEqual(p.moves.at(-1), [2509, 9169, 1], 'the trapdoor reaches the dungeon start, not Kruk’s lair');
    expected(65);
    object(harness, p, O.CAVERN_ENTRANCE, 'Enter', [2531, 9227, 1]); // Fixture: completed the QH agility route.
    drive(p);
    assert.ok(harness.spawned.some(npc => npc.id === N.KRUK_3), 'Kruk is spawned in his lair');
    expected(65);

    npcDeath(harness, p, N.KRUK_3);
    assert.equal(p.items.get(I.KRUKS_PAW) ?? 0, 1);
    expected(66);

    talk(harness, p, N.ZOOKNOCK_3);
    assert.equal(p.items.get(I.KRUKS_PAW) ?? 0, 0);
    assert.equal(p.items.get(I.MONKEY_TALISMAN) ?? 0, 0);
    assert.equal(p.items.get(I.KRUK_MONKEY_GREEGREE) ?? 0, 1);
    expected(70);
    p.setEquipment({ getId: () => I.KRUK_MONKEY_GREEGREE });

    talk(harness, p, 6812);
    drive(p);
    expected(71);

    talk(harness, p, N.GARKOR_3);
    drive(p);
    expected(72);

    talk(harness, p, N.KOB);
    drive(p, ['I know about your deal with the monkeys.', "You won't be around to crush anyone when I'm done with you.", 'I accept your challenge.']);
    expected(73);
    npcDeath(harness, p, N.KOB_2);
    expected(74);

    talk(harness, p, N.KEEF);
    drive(p, ['I know about your deal with the monkeys.', 'I offer to spare your life.', 'I accept your challenge.']);
    expected(75);
    npcDeath(harness, p, N.KEEF_2);
    expected(76);

    talk(harness, p, N.GARKOR_3);
    drive(p);
    expected(77);

    talk(harness, p, 6806);
    drive(p, ['I was going to ask you the same question.', 'Why is that?', 'Awowogei has already informed me about the battleships.', 'Where is the fleet, currently?']);
    expected(78);

    talk(harness, p, N.GARKOR_3);
    drive(p);
    expected(80);

    talk(harness, p, N.MONKEY_GUARD_4);
    drive(p, ["What's going on here?", 'Construction platform?', 'Can I visit the platform?']);
    assert.deepEqual(p.moves.at(-1), [2078, 5397, 1]);

    object(harness, p, O.CRATE_237, 'Search');
    assert.equal(p.items.get(I.SATCHEL) ?? 0, 6);
    object(harness, p, O.BARREL_136, 'Search');
    assert.equal(p.items.get(I.SATCHEL) ?? 0, 0);
    assert.equal(p.items.get(I.SATCHEL_2) ?? 0, 6, 'the barrel converts the six satchels to explosive-filled satchels');
    for (const id of [
      O.COMPROMISED_SUPPORT, O.COMPROMISED_SUPPORT_2,
      O.COMPROMISED_FLOORBOARDS, O.COMPROMISED_FLOORBOARDS_2,
      O.GAS_CYLINDER, O.GAS_CYLINDER_2,
    ]) object(harness, p, id, 'Investigate');
    assert.equal(p.items.get(I.SATCHEL_2) ?? 0, 0, 'each sabotage point consumes one filled satchel');
    expected(82);

    talk(harness, p, N.GARKOR_3);
    drive(p);
    expected(83);

    object(harness, p, O.JUNGLE_GRASS_4, 'Investigate');
    choose(p, 'Yes.');
    object(harness, p, O.PASSAGE_7, 'Enter', [2510, 9213, 1]); // Fixture: followed the dungeon return route to the lab passage.
    assert.deepEqual(p.moves.at(-1), [2207, 5447, 0]);
    const ride = npcAction(harness, p, N.STUNTED_DEMONIC_GORILLA, 'Climb-on');
    assert.equal(ride.handled, true);
    drive(p);
    expected(85);
    for (let index = 0; index < 3; index++) npcDeath(harness, p, N.TORTURED_GORILLA);
    expected(90);

    const prematureTamper = object(harness, p, O.DEVICE, 'Tamper');
    assert.equal(prematureTamper.handled, true);
    assert.ok(p.messages.some(message => /dismount the gorilla/.test(message)));
    object(harness, p, O.HOLDING_AREA, 'Use', [2213, 5464, 0]);

    object(harness, p, O.DEVICE, 'Tamper');
    drive(p);
    assert.equal(p.items.get(I.CHARGED_ONYX) ?? 0, 0);
    assert.equal(p.items.get(I.DECONSTRUCTED_ONYX) ?? 0, 0);
    expected(95);

    object(harness, p, O.INCUBATION_CHAMBER, 'Investigate');
    drive(p);
    expected(100);

    talk(harness, p, N.GARKOR_3);
    drive(p);
    expected(105);

    talk(harness, p, 6812);
    drive(p);
    expected(110);

    talk(harness, p, N.GARKOR_3);
    drive(p);
    expected(115);

    talk(harness, p, N.KING_NARNODE_SHAREEN);
    drive(p);
    expected(120);

    talk(harness, p, N.NIEVE);
    drive(p, ['Talk about Monkey Madness II.', 'Yes.']);
    expected(140);
    for (let index = 0; index < 4; index++) npcDeath(harness, p, N.TORTURED_GORILLA_3);
    expected(145);

    talk(harness, p, N.GARKOR_2);
    drive(p);
    expected(150);

    object(harness, p, O.CAVERN_ENTRANCE_2, 'Enter');
    drive(p);
    expected(155);
    npcDeath(harness, p, N.TORTURED_GORILLA_4);
    npcDeath(harness, p, N.TORTURED_GORILLA_4);
    npcDeath(harness, p, N.DEMONIC_GORILLA);
    npcDeath(harness, p, N.DEMONIC_GORILLA);
    expected(160);

    npcDeath(harness, p, N.GLOUGH_4);
    drive(p, ['No.'], false);
    expected(170);

    talk(harness, p, N.ZOOKNOCK_2);
    drive(p, ['Yes.']);
    assert.deepEqual(p.moves.at(-1), [2465, 3496, 0]);
    expected(170);

    talk(harness, p, N.KING_NARNODE_SHAREEN);
    drive(p);
    expected(195);
    assert.equal(q.isComplete(p), true);
    assert.equal(p.attrs.get('quest.points'), 4);
    assert.deepEqual(p.xp, [
      [core.Skill.SLAYER.getIndex(), 80000],
      [core.Skill.AGILITY.getIndex(), 60000],
      [core.Skill.THIEVING.getIndex(), 50000],
      [core.Skill.HUNTER.getIndex(), 50000],
    ]);
    assert.equal(p.items.get(I.ROYAL_SEED_POD) ?? 0, 1);
    assert.equal(harness.spawned.some(npc => npc.id === 6812 && npc.isRegistered()), false,
      'completion releases the owner-only Awowogei');
    assert.equal(harness.objects.some(object => object.getId() === 28675), false,
      'leaving stage 66 clears Kruk remains');

    const xpAfter = p.xp.length;
    const seedAfter = p.items.get(I.ROYAL_SEED_POD) ?? 0;
    talk(harness, p, N.KING_NARNODE_SHAREEN);
    drive(p, [], false);
    assert.equal(p.xp.length, xpAfter, 'repeat post-quest talk must not grant XP twice');
    assert.equal(p.items.get(I.ROYAL_SEED_POD) ?? 0, seedAfter, 'repeat post-quest talk must not grant a second seed pod');
  });
});

test('production selector order yields King Narnode from MM1 to active MM2', () => {
  const hooksBefore = PluginManager.npcDialogueVariantHooks.length;
  const stageHooksBefore = PluginManager.customEventHooks.get('quest:get-stage') ?? [];
  const plugins = [
    ['GrandTree', 'plugins/quests/quests/GrandTree.Quest'],
    ['MonkeyMadnessI', 'plugins/quests/quests/MonkeyMadnessI.Quest'],
    ['RecipeForDisaster', 'plugins/quests/quests/RecipeForDisaster.Quest'],
    ['MonkeyMadnessII', 'plugins/quests/quests/MonkeyMadnessII.Quest'],
  ];
  for (const [name, modulePath] of plugins) {
    require(root + '/' + modulePath)(PluginManager.createApi(name));
  }
  try {
    const quests = runtime.getRegisteredQuests();
    const grandTree = quests.findLast(quest => quest.key === 'grand_tree');
    const mm1 = quests.findLast(quest => quest.key === 'monkey_madness_i');
    const mm2 = quests.findLast(quest => quest.key === 'monkey_madness_ii');
    assert.ok(PluginManager.customEventHooks.get('recipe-for-disaster:rescue-status')?.some(hook => hook.pluginName === 'RecipeForDisaster'));
    const p = makePlayer();
    const rescue = { player: p, rescue: 'king-awowogei', complete: false };
    PluginManager.emitCustomEvent('recipe-for-disaster:rescue-status', rescue);
    assert.equal(rescue.complete, false, 'RFD answers the public rescue query');
    p.setAttribute(RFD_RESCUES_ATTRIBUTE, RFD_AWOWOGEI_RESCUE);
    rescue.complete = false;
    PluginManager.emitCustomEvent('recipe-for-disaster:rescue-status', rescue);
    assert.equal(rescue.complete, true, 'the actual RFD rescue responder recognizes the accepted rescue');
    grandTree.setStage(p, 160);
    mm1.setStage(p, 9);
    mm2.setStage(p, 50);
    PluginManager.customEventHooks.set('quest:get-stage', [
      ...stageHooksBefore,
      { pluginName: 'QuestRuntimeTest', handler: request => {
        const quest = runtime.getRegisteredQuests().findLast(entry => entry.key === request.key);
        if (quest) request.stage = quest.getStage(request.player);
      } },
    ]);

    const selected = PluginManager.emitNpcDialogueVariant({
      player: p,
      npcId: N.KING_NARNODE_SHAREEN,
      npc: { getId: () => N.KING_NARNODE_SHAREEN },
    });
    assert.deepEqual(selected, {
      page: 'Monkey Madness II',
      variant: 'chapter-i-talking-to-king-narnode-5',
    });

    const line = {
      player: p,
      npcId: N.KING_NARNODE_SHAREEN,
      text: 'Glough is a threat to us all... I must hereby re-assign you to Ape Atoll, [player name]. Report to Sergeant Garkor on Ape Atoll for further orders.',
    };
    PluginManager.emitCustomEvent('npc-dialogue:line', line);
    assert.equal(mm2.getStage(p), 55, 'the terminal line advances chapter-I completion');
  } finally {
    PluginManager.npcDialogueVariantHooks.length = hooksBefore;
    PluginManager.customEventHooks.set('quest:get-stage', stageHooksBefore);
  }
});
