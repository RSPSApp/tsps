// Ratcatchers (q093) source contracts. From server/: node --test tests/qh728-q093.test.cjs
//
// The route test starts at durable stage 0 and dispatches the plugin's registered
// hooks in Quest Helper order. Starting supplies and prerequisites are fixtures
// (completed Gertrude's Cat/Icthlarin's Little Helper, started The Giant Dwarf, an overgrown cat, four
// cheese plus rat poison, apothecary ingredients, weeds/pot/tinderbox and 101
// coins); quest stages and quest items are produced only by the handlers. The
// transcript replay is captured, not animated, so this proves handler contracts,
// not a live route.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const dialogueData = require('../data/definitions/npc-dialogues.json');
const core = PluginManager.getCoreApi();

const VARBIT = 1404;
const COMPLETION_THRESHOLD = 127;

const transcripts = [];
runtime.startTranscript = (_api, player, npcId, page, variant) => {
  transcripts.push({ player, npcId, page, variant });
  return true;
};

function setup(completed = ['gertrudes_cat', 'ictlharins_little_helper'], options = {}) {
  transcripts.length = 0;
  const completedQuests = new Set(completed);
  const startedQuests = new Set(options.started ?? ['giant_dwarf']);
  const externalStages = new Map(Object.entries(options.stages ?? {}));
  const custom = new Map();
  const hooks = {
    conditions: [],
    variants: [],
    npcInteractions: [],
    itemActions: new Map(),
    itemOnItem: [],
    itemOnObject: [],
    object: [],
    npcDeath: [],
    login: [],
  };
  const api = new Proxy({
    core: {
      ...core,
      CountdownTask: class {
        constructor(player, ticks, run) { Object.assign(this, { player, ticks, run }); }
      },
      TaskManager: { submit() {}, cancelTasks() {} },
      MultiChatboxPrompt: { getPending: () => null },
    },
    persistAttribute() {},
    onNpcDialogueVariant(handler) { hooks.variants.push(handler); },
    onNpcDialogueCondition(handler) { hooks.conditions.push(handler); },
    onNpcInteraction(handler) { hooks.npcInteractions.push(handler); },
    onItemAction(name, actions) { hooks.itemActions.set(name, actions); },
    onItemOnItem(handler) { hooks.itemOnItem.push(handler); },
    onItemOnObject(handler) { hooks.itemOnObject.push(handler); },
    onObjectInteraction(handler) { hooks.object.push(handler); },
    onNpcDeath(handler) { hooks.npcDeath.push(handler); },
    onPlayerLogin(handler) { hooks.login.push(handler); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && completedQuests.has(event.key)) event.complete = true;
      if (name === 'quest:is-started' && startedQuests.has(event.key)) event.started = true;
      if (name === 'quest:get-stage' && externalStages.has(event.key)) event.stage = externalStages.get(event.key);
      for (const handler of custom.get(name) ?? []) handler(event);
    },
    getWorld: () => ({ getNpcs: () => [] }),
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  require('../plugins/quests/quests/Ratcatchers.Quest')(api);
  // This is the shared-NPC production order: Ratcatchers is registered before
  // TailOfTwoCats, whose public stage query must still own its Gertrude step.
  require('../plugins/quests/quests/TailOfTwoCats.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'ratcatchers');

  const attributes = new Map();
  const inventory = new Map();
  const equipment = new Map();
  const messages = [];
  const xp = [];
  let freeSlots = options.freeSlots ?? 28;
  let packet;
  packet = new Proxy({
    varbits: new Map(),
    sendConfig() { return packet; },
    sendVarbit(id, value) { packet.varbits.set(id, value); return packet; },
    getVarbit(id) { return packet.varbits.get(id) ?? 0; },
  }, { get(target, key) { return key in target ? target[key] : () => packet; } });
  let location = new core.Location(3151, 3413, 0);
  const inventoryApi = {
    getAmount: (id) => inventory.get(id) ?? 0,
    adds: (id, amount = 1) => {
      if ((inventory.get(id) ?? 0) === 0 && freeSlots < 1) return false;
      if ((inventory.get(id) ?? 0) === 0) freeSlots--;
      inventory.set(id, (inventory.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      const next = Math.max(0, (inventory.get(id) ?? 0) - amount);
      if (next === 0 && (inventory.get(id) ?? 0) > 0) freeSlots++;
      inventory.set(id, next);
      return true;
    },
    isFull: () => freeSlots < 1,
    getFreeSlots: () => freeSlots,
  };
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => packet,
    getInventory: () => inventoryApi,
    getEquipment: () => ({ get: (slot) => equipment.get(slot) ?? null }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill, amount]) }),
    getLocation: () => location,
    moveTo(next) { location = next; },
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues() {}, reset() {} }),
    getIndex: () => 1,
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage: (text) => messages.push(text),
    getUsername: () => 'qh728-q093',
  };
  const fire = (name, event = {}) => {
    const payload = { player, handled: false, ...event };
    for (const handler of custom.get(name) ?? []) handler(payload);
    return payload;
  };
  const action = (stepId, npcId = core.NpcIdentifiers.JIMMY_DAZZLER) =>
    fire('npc-dialogue:action', { stepId, npcId });
  const line = (text, npcId) => fire('npc-dialogue:line', { text, npcId });
  const choose = (option, npcId) => fire('npc-dialogue:choice', { option, npcId });
  const condition = (stepId, npcId, text = '') =>
    hooks.conditions[0]({ player, npcId, stepId, text, definition: { getName: () => '' } });
  const variant = (npcId) => hooks.variants[0]({ player, npcId });
  const npcTalk = (npcId, name) => {
    const event = {
      player,
      npcId,
      clickType: 1,
      definition: { getName: () => name, getActions: () => ['Talk-to'] },
      handled: false,
    };
    hooks.npcInteractions[0](event);
    return event;
  };
  const killRat = (x, y, z = 0, npcId = 2854) => hooks.npcDeath[0]({
    player,
    killer: player,
    npcId,
    location: { x, y, z },
    npc: { getCurrentDefinition: () => ({ getName: () => 'Rat' }) },
  });
  const itemOnItem = (a, b) => {
    const event = { player, usedItemId: a, usedWithItemId: b, handled: false };
    hooks.itemOnItem[0](event);
    return event;
  };
  const itemOnObject = (itemId, objectId) => {
    const event = { player, itemId, objectId, handled: false };
    hooks.itemOnObject[0](event);
    return event;
  };
  const itemAction = (itemName, option, itemId) => {
    const event = { player, itemId, handled: false };
    hooks.itemActions.get(itemName)?.[option](event);
    return event;
  };
  const stage = () => quest.getStage(player);
  const varbit = () => packet.getVarbit(VARBIT);
  return {
    quest, player, attributes, inventory, messages, xp, stage, varbit, action, line, choose,
    condition, variant, npcTalk, killRat, itemOnItem, itemOnObject, itemAction, transcripts,
    fire, setLocation: (x, y, z = 0) => { location = new core.Location(x, y, z); },
    login: () => { for (const handler of hooks.login) handler({ player }); },
    bootstrapComplete: () => {
      for (const handler of custom.get('player:bootstrap-complete') ?? []) handler({ player });
    },
    clearVarbits: () => packet.varbits.clear(),
    auxVarbit: (id) => packet.getVarbit(id),
    setFreeSlots: (value) => { freeSlots = value; },
    bootstrapComplete: () => fire('player:bootstrap-complete'),
    setOtherStage: (key, value) => externalStages.set(key, value),
    dialogueData,
  };
}

function start(h) {
  const N = core.NpcIdentifiers;
  assert.equal(h.stage(), 0, 'fresh stage 0');
  const talk = h.npcTalk(N.GERTRUDE, 'Gertrude');
  assert.equal(talk.handled, true, 'Gertrude start transcript is offered');
  assert.equal(h.transcripts.at(-1).variant, 'talking-to-gertrude');
  h.fire('npc-dialogue:hook', { npcId: N.GERTRUDE, hook: 'quest:ratcatchers:start', quest: 'Ratcatchers' });
  assert.equal(h.stage(), 1);
  assert.equal(h.varbit(), 5, 'started maps to helper key 5');
}

test('stage 0 to completion dispatches the registered QH legs and sends varbit 1404 = 127', () => {
  const h = setup();
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  h.inventory.set(I.PET_CAT_7, 1); // overgrown cat prerequisite
  h.inventory.set(I.CHEESE, 4);
  h.inventory.set(I.RAT_POISON, 1);
  h.inventory.set(I.BUCKET_OF_MILK, 1);
  h.inventory.set(I.UNICORN_HORN_DUST, 1);
  h.inventory.set(I.MARRENTILL, 1);
  h.inventory.set(I.WEEDS, 1);
  h.inventory.set(I.POT, 1);
  h.inventory.set(I.TINDERBOX, 1);
  h.inventory.set(I.COINS, 101);

  h.player.setAttribute('quest.a_tail_of_two_cats.stage', 3);
  assert.equal(h.npcTalk(N.GERTRUDE, 'Gertrude').handled, false,
    'the registered public Tail stage query yields Gertrude while Bob is found');
  h.player.setAttribute('quest.a_tail_of_two_cats.stage', 0);
  start(h);
  // After starting, Ratcatchers releases Gertrude so A Tail of Two Cats can own her.
  assert.equal(h.npcTalk(N.GERTRUDE, 'Gertrude').handled, false);

  // Sisters Grime: sniff sets the task, then eight sewer rat kills and the pole hand-in.
  h.action('y8ZblR', N.GRIMESQUIT);
  assert.equal(h.stage(), 2);
  assert.equal(h.varbit(), 10);
  assert.deepEqual(h.variant(N.GRIMESQUIT), { page: 'Ratcatchers', variant: 'grimesquit-phingspet-before-catching-8-rats' });
  for (let i = 0; i < 8; i++) h.killRat(3250, 9850);
  assert.equal(h.attributes.get('quest.ratcatchers.rats'), 8);
  assert.equal(h.varbit(), 15, 'the distinct eight-rats step is sent before returning to the sisters');
  h.action('VYB0Uo', N.PHINGSPET);
  assert.equal(h.stage(), 3);
  assert.equal(h.varbit(), 20);
  assert.equal(h.inventory.get(I.RAT_POLE), 1);

  // Jimmy hands the directions; losing them is recoverable from his transcript line.
  h.action('9yRU1Y', N.JIMMY_DAZZLER);
  assert.equal(h.stage(), 4);
  assert.equal(h.varbit(), 25);
  assert.equal(h.inventory.get(I.DIRECTIONS), 1);
  h.inventory.delete(I.DIRECTIONS);
  h.line("Here you go, don't lose this one.", N.JIMMY_DAZZLER);
  assert.equal(h.inventory.get(I.DIRECTIONS), 1, 'lost directions are reissued');
  h.action('3XEhOl', N.JIMMY_DAZZLER); // read the directions in Ardougne
  assert.equal(h.stage(), 5);
  assert.equal(h.varbit(), 30);
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY(), h.player.getLocation().getZ()], [2848, 5108, 0]);

  // Mansion rats on both floors count, then Jimmy sends the player to Jack.
  for (const [id, flag] of [[6224, 1424], [6226, 1425], [6225, 1426]]) {
    h.killRat(2850, 5090, 1, id);
    assert.equal(h.auxVarbit(flag), 1, `the matching upstairs party rat sets QH bit ${flag}`);
  }
  for (let i = 0; i < 3; i++) h.killRat(2850, 5090, 0);
  assert.deepEqual([h.auxVarbit(1424), h.auxVarbit(1425), h.auxVarbit(1426)], [1, 1, 1]);
  assert.equal(h.stage(), 6);
  assert.equal(h.varbit(), 35);
  h.line('You can tell him to look out for you.', N.JIMMY_DAZZLER);
  assert.equal(h.stage(), 7);
  assert.equal(h.varbit(), 40);
  h.line("There'll be no slacking now.", N.HOOKNOSED_JACK);
  assert.equal(h.stage(), 8);
  assert.equal(h.varbit(), 50);

  // Four poisoned cheeses poison the four warehouse holes.
  for (let i = 0; i < 4; i++) h.itemOnItem(I.RAT_POISON, I.CHEESE);
  assert.equal(h.inventory.get(I.POISONED_CHEESE), 4);
  for (const objectId of [
    core.ObjectIdentifiers.RAT_HOLE_2,
    core.ObjectIdentifiers.RAT_HOLE_3,
    core.ObjectIdentifiers.RAT_HOLE_4,
    core.ObjectIdentifiers.RAT_HOLE_5,
  ]) h.itemOnObject(I.POISONED_CHEESE, objectId);
  assert.deepEqual([h.auxVarbit(1406), h.auxVarbit(1407), h.auxVarbit(1408), h.auxVarbit(1409)], [1, 1, 1, 1]);
  assert.equal(h.stage(), 9);
  assert.equal(h.varbit(), 55);
  assert.equal(h.inventory.get(I.POISONED_CHEESE), 0);

  h.line('Go quickly.', N.HOOKNOSED_JACK);
  assert.equal(h.stage(), 10);
  assert.equal(h.varbit(), 60);
  h.action('MJKZu1', N.APOTHECARY);
  assert.equal(h.stage(), 11);
  assert.equal(h.varbit(), 70);
  assert.equal(h.inventory.get(I.CAT_ANTIPOISON), 1);
  h.action('RCYv7q', N.HOOKNOSED_JACK);
  assert.equal(h.stage(), 12);
  assert.equal(h.varbit(), 80);
  assert.equal(h.inventory.get(I.CAT_ANTIPOISON) ?? 0, 0);

  // King Rat: cat on the hole, either fight-choice option advances.
  const king = h.itemOnObject(I.PET_CAT_7, core.ObjectIdentifiers.HOLE_IN_WALL_2);
  assert.equal(king.handled, true);
  assert.equal(h.transcripts.at(-1).variant, 'hooknosed-jack-fighting-the-king-rat-using-the-cat-on-the-hole-in-wall');
  h.choose('Be careful in there, cat!', N.KING_RAT);
  assert.equal(h.stage(), 13);
  assert.equal(h.varbit(), 85);
  h.line('You should seek out Smokin\' Joe.', N.HOOKNOSED_JACK);
  assert.equal(h.stage(), 14);
  assert.equal(h.varbit(), 90);
  h.line("Great. I'll get to it.", N.SMOKIN_JOE);
  assert.equal(h.stage(), 15);
  assert.equal(h.varbit(), 95);

  // Pot of weeds -> smouldering pot -> both uses on the Keldagrim hole.
  h.itemOnItem(I.WEEDS, I.POT);
  assert.equal(h.inventory.get(I.POT_OF_WEEDS), 1);
  h.itemOnItem(I.TINDERBOX, I.POT_OF_WEEDS);
  assert.equal(h.inventory.get(I.SMOULDERING_POT), 1);
  h.itemOnObject(I.SMOULDERING_POT, core.ObjectIdentifiers.RAT_HOLE_6);
  assert.equal(h.auxVarbit(1410), 1, 'the first hole attempt records the cat warning for QH');
  h.itemOnObject(I.SMOULDERING_POT, core.ObjectIdentifiers.RAT_HOLE_6);
  assert.equal(h.stage(), 16);
  assert.equal(h.varbit(), 100);
  h.line("Well, you've earned it.", N.SMOKIN_JOE);
  assert.equal(h.stage(), 17);
  assert.equal(h.varbit(), 105);
  h.line('It was worth a shot...', N.FELKRASH);
  assert.equal(h.stage(), 18);
  assert.equal(h.varbit(), 110);

  // The Face's story, the snake charmer's 101-coin deal (one coin on the pot).
  h.choose("I just don't think Felkrash was that impressive.", N.THE_FACE);
  assert.equal(h.stage(), 19);
  assert.equal(h.varbit(), 115);
  const pot = h.itemOnObject(I.COINS, core.ObjectIdentifiers.MONEY_POT);
  assert.equal(pot.handled, true);
  assert.equal(h.inventory.get(I.COINS), 100, 'the coin used on the pot is consumed');
  h.line('It\'s not that difficult. Here, take these.', N.ALI_THE_SNAKE_CHARMER);
  assert.equal(h.stage(), 20);
  assert.equal(h.varbit(), 120);
  assert.equal(h.inventory.get(I.SNAKE_CHARM), 1);
  assert.equal(h.inventory.get(I.MUSIC_SCROLL), 1);
  assert.equal(h.inventory.get(I.COINS), 0, 'the snake charmer is paid 100 coins');

  h.setLocation(3020, 3234, 0);
  h.itemAction('Snake charm', 'Play', I.SNAKE_CHARM);
  assert.equal(h.stage(), 21);
  assert.equal(h.varbit(), 125);

  // Final hand-in: the wily-cat line completes the quest at the cache threshold.
  h.action('3-zmem', N.FELKRASH);
  assert.equal(h.stage(), 22);
  assert.equal(h.varbit(), COMPLETION_THRESHOLD);
  h.clearVarbits();
  h.bootstrapComplete();
  assert.deepEqual([1406, 1407, 1408, 1409, 1410, 1424, 1425, 1426].map(h.auxVarbit),
    [1, 1, 1, 1, 1, 1, 1, 1], 'bootstrap restores persisted QH auxiliary progress');
  assert.ok(h.varbit() >= COMPLETION_THRESHOLD);
  assert.equal(h.xp.at(-1)[0], core.Skill.THIEVING, 'Thieving reward');
  assert.equal(h.xp.at(-1)[1], 4500, '4,500 Thieving XP');
  assert.ok(h.messages.some((text) => text.includes('completed a quest')));
  h.clearVarbits();
  h.bootstrapComplete();
  assert.equal(h.varbit(), COMPLETION_THRESHOLD, 'QuestRuntime bootstrap replays the canonical completion wire');
  const xpCount = h.xp.length;
  h.action('3-zmem', N.FELKRASH);
  assert.equal(h.xp.length, xpCount, 'repeating the completion action does not reward twice');
  assert.equal(h.varbit(), COMPLETION_THRESHOLD);
});

test('durable stage values map to their canonical helper wire values', () => {
  const h = setup();
  for (const [stage, wire] of [[1, 5], [2, 10], [3, 20], [8, 50], [11, 70], [12, 80], [21, 125], [22, 127]]) {
    h.quest.setStage(h.player, stage);
    assert.equal(h.varbit(), wire, `durable stage ${stage} maps to varbit ${wire}`);
  }
  h.attributes.set('quest.ratcatchers.stage', 22);
  h.clearVarbits();
  h.login();
  assert.equal(h.quest.getStage(h.player), 22, 'the durable stage is preserved');
  assert.equal(h.varbit(), 0, 'this scoped fixture does not claim to exercise QuestRuntime login replay');
});

test('Gertrude start requires The Giant Dwarf and yields to the active Tail of Two Cats conversation', () => {
  const N = core.NpcIdentifiers;
  const missingPrerequisite = setup(['gertrudes_cat', 'ictlharins_little_helper'], { started: [] });
  assert.equal(missingPrerequisite.npcTalk(N.GERTRUDE, 'Gertrude').handled, false);

  for (const stage of [3, 4]) {
    const tailOwnsGertrude = setup(undefined, { stages: { a_tail_of_two_cats: stage } });
    assert.equal(tailOwnsGertrude.npcTalk(N.GERTRUDE, 'Gertrude').handled, false);
  }
});

test('rat pole handoff waits for capacity and a completed player can reclaim a lost pole', () => {
  const N = core.NpcIdentifiers;
  const I = core.ItemIdentifiers;
  const h = setup(undefined, { freeSlots: 0 });
  h.quest.setStage(h.player, 2);
  h.attributes.set('quest.ratcatchers.rats', 8);
  h.action('VYB0Uo', N.PHINGSPET);
  assert.equal(h.stage(), 2, 'full inventory does not advance past the pole receipt');
  assert.equal(h.inventory.get(I.RAT_POLE) ?? 0, 0);
  h.setFreeSlots(1);
  h.action('VYB0Uo', N.PHINGSPET);
  assert.equal(h.stage(), 3);
  assert.equal(h.inventory.get(I.RAT_POLE), 1);

  h.quest.setStage(h.player, 22);
  h.inventory.delete(I.RAT_POLE);
  assert.equal(h.variant(N.PHINGSPET).variant, 'standard-dialogue-after-the-quest-without-a-rat-pole');
  h.setFreeSlots(0);
  h.line('Here you go.', N.PHINGSPET);
  assert.equal(h.inventory.get(I.RAT_POLE) ?? 0, 0);
  h.setFreeSlots(1);
  h.line('Here you go.', N.PHINGSPET);
  assert.equal(h.inventory.get(I.RAT_POLE), 1, 'the canonical no-pole dialogue can reissue it after capacity is available');
});
