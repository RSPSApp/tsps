// Run after `yarn build`: node --test tests/quest-plugins.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');

// A stand-in for the live PluginApi: real core, every hook a no-op. Quests must
// register cleanly through it and hand back their variant/condition resolvers.
function mockApi() {
  const handlers = {
    variant: [],
    condition: [],
    custom: new Map(),
    object: [],
    route: [],
    itemOnNpc: [],
    itemOnObject: [],
    itemAction: new Map(),
    npc: new Map(),
    area: [],
    ground: [],
  };
  const noop = () => {};
  const base = {
    core: PluginManager.getCoreApi(),
    onNpcDialogueVariant: (h) => handlers.variant.push(h),
    onNpcDialogueCondition: (h) => handlers.condition.push(h),
    onCustomEvent: (name, h) => {
      const list = handlers.custom.get(name) ?? [];
      list.push(h);
      handlers.custom.set(name, list);
    },
    persistAttribute: noop,
    onObjectInteraction: (handler) => { if (typeof handler === 'function') handlers.object.push(handler); },
    onObjectRoute: (handler) => handlers.route.push(handler),
    onItemOnNpc: (handler) => handlers.itemOnNpc.push(handler),
    onItemOnObject: (item, object, handler) => { if (typeof handler === 'function') handlers.itemOnObject.push(handler); },
    onItemAction: (name, actions) => handlers.itemAction.set(name, actions),
    onNpcInteraction: (name, actions) => handlers.npc.set(name, actions),
    registerArea: (area) => handlers.area.push(area),
    onGroundItemPickup: (handler) => handlers.ground.push(handler),
  };
  const api = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return noop;
    },
  });
  return { api, handlers };
}

test('Quests.plugin registers every quest through api.core without throwing', () => {
  const { api } = mockApi();
  const plugin = require('../plugins/quests/Quests.plugin');
  assert.equal(plugin.name, 'Quests');
  assert.doesNotThrow(() => plugin.register(api));
});

test('quest keys, names and varps are unique', () => {
  const { api } = mockApi();
  const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
  const before = getRegisteredQuests().length;
  require('../plugins/quests/Quests.plugin').register(api);
  const quests = getRegisteredQuests().slice(before);
  const seen = { key: new Map(), name: new Map(), varpId: new Map() };
  for (const quest of quests) {
    for (const field of ['key', 'name', 'varpId']) {
      const value = quest[field];
      if (seen[field].has(value)) {
        assert.fail(`duplicate quest ${field} "${value}" (${seen[field].get(value)}, ${quest.name})`);
      }
      seen[field].set(value, quest.name);
    }
  }
  assert.ok(quests.length > 0, 'no quests registered');
});

test('Quests.plugin lists every quest file on disk', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { QUESTS } = require('../plugins/quests/Quests.plugin');
  const dir = path.join(__dirname, '../plugins/quests/quests');
  const onDisk = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.Quest.js'))
    .map((f) => f.replace(/\.Quest\.js$/, ''))
    .sort();
  assert.deepEqual([...QUESTS].sort(), onDisk, 'Quests.plugin must register every quests/*.Quest.js');
});

test('each quest varp is sent again on login, so quest-gated locs show after a relog', () => {
  // The Grand Exchange spirit tree only has Travel once varp 111 (Tree Gnome Village) is 9.
  const { api } = mockApi();
  const { getRegisteredQuests, sendQuestVarps } = require('../plugins/quests/QuestRuntime');
  if (!getRegisteredQuests().some((quest) => quest.name === 'Tree Gnome Village')) require('../plugins/quests/Quests.plugin').register(api);
  const village = getRegisteredQuests().find((quest) => quest.name === 'Tree Gnome Village');
  const attributes = new Map();
  const varps = new Map();
  const varbits = new Map();
  const sender = new Proxy({}, {
    get: (t, key) => {
      if (key === 'sendConfig') return (id, value) => (varps.set(id, value), sender);
      if (key === 'sendVarbit') return (id, value) => (varbits.set(id, value), sender);
      return () => sender;
    },
  });
  const player = { getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value), getPacketSender: () => sender };
  village.setStage(player, village.completionValue);
  varps.clear();
  varbits.clear();
  sendQuestVarps({ player });
  if (village.varbitId !== undefined) {
    assert.equal(varbits.get(village.varbitId), village.completionValue);
  } else {
    assert.equal(varps.get(village.varpId), village.completionValue);
  }
  // Unstarted quests are sent as 0 too: the login bootstrap clobbers shared varps (QuestRuntime).
  // Quests with a bitfield stage write their varbit instead, so sibling bits survive.
  // Earlier tests register the list more than once, so skip every Tree Gnome
  // Village registration (same stage attribute) rather than just this instance.
  const others = getRegisteredQuests().filter((quest) => quest.key !== village.key);
  const sent = (quest) => (quest.varbitId !== undefined ? varbits.get(quest.varbitId) : varps.get(quest.varpId));
  const offenders = others.filter((quest) => sent(quest) !== 0).map((quest) => `${quest.name}:${quest.varpId}/${quest.varbitId}=${sent(quest)}`);
  assert.ok(offenders.length === 0, `unstarted quests are reset to 0 (${offenders.slice(0, 5).join(', ')})`);
});

test("Tree Gnome Village sends King Bolren's orbs (varbit 598): the village's spirit tree has Travel at 2", () => {
  const custom = new Map();
  const logins = [];
  const { api: base } = mockApi();
  const api = new Proxy(base, {
    get: (target, prop) => {
      if (prop === 'onPlayerLogin') return (h) => logins.push(h);
      if (prop === 'onCustomEvent') return (name, h) => custom.set(name, [...(custom.get(name) ?? []), h]);
      if (prop === 'emitCustomEvent') return (name, payload) => (custom.get(name) ?? []).forEach((h) => h(payload));
      return target[prop];
    },
  });
  delete require.cache[require.resolve('../plugins/quests/quests/TreeGnomeVillage.Quest')];
  require('../plugins/quests/quests/TreeGnomeVillage.Quest')(api);
  const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
  const village = getRegisteredQuests().filter((quest) => quest.name === 'Tree Gnome Village').at(-1);
  const attributes = new Map();
  const varbits = new Map();
  const sender = new Proxy({}, { get: (t, key) => (key === 'sendVarbit' ? (id, value) => (varbits.set(id, value), sender) : () => sender) });
  const player = { getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value), getPacketSender: () => sender };
  village.setStage(player, village.completionValue);
  assert.equal(varbits.get(598), 2, "on completing it");
  varbits.clear();
  for (const login of logins) {
    try { login({ player }); } catch (error) { /* other login hooks want a real player */ }
  }
  assert.equal(varbits.get(598), 2, "and on every login");
});

test('Current Affairs and Prying Times start gates require every registered prerequisite', () => {
  const conditions = [];
  const completeQuests = new Set();
  let hasPortTaskSlot = false;
  const { api: base } = mockApi();
  const api = new Proxy(base, {
    get: (target, prop) => {
      if (prop === 'onNpcDialogueCondition') return (handler) => conditions.push(handler);
      if (prop === 'emitCustomEvent') return (name, request) => {
        if (name === 'quest:is-complete') request.complete = completeQuests.has(request.key);
        if (name === 'sailing:has-port-task-slot') request.available = hasPortTaskSlot;
      };
      return target[prop];
    },
  });
  require('../plugins/quests/quests/CurrentAffairs.Quest')(api);
  require('../plugins/quests/quests/PryingTimes.Quest')(api);
  const [currentAffairs, pryingTimes] = conditions;
  const player = { getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99 }) };
  assert.equal(currentAffairs({ npcId: api.core.NpcIdentifiers.ARHEIN, player, stepId: 'mNhEI-' }), true,
    'missing Pandemonium blocks Current Affairs');
  assert.equal(pryingTimes({ npcId: api.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, player, stepId: 'aifq0J' }), true,
    'missing quests and an unavailable task slot block Prying Times');
  completeQuests.add('pandemonium');
  assert.equal(currentAffairs({ npcId: api.core.NpcIdentifiers.ARHEIN, player, stepId: 'mNhEI-' }), false);
  completeQuests.add('the_knights_sword');
  assert.equal(pryingTimes({ npcId: api.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, player, stepId: 'aifq0J' }), false,
    'high skills and both required quests satisfy the quest prerequisites');
  assert.equal(pryingTimes({ npcId: api.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, player, stepId: 'PSw89b' }), true,
    'a full task ledger blocks starting Prying Times');
  hasPortTaskSlot = true;
  assert.equal(pryingTimes({ npcId: api.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, player, stepId: 'PSw89b' }), false,
    'an available task slot clears the full-ledger condition');
});

test('Priest in Peril unlocks the mausoleum Holy barrier only after completion', () => {
  const { api: base } = mockApi();
  const objects = new Map();
  const api = new Proxy(base, {
    get: (target, prop) => prop === 'onObjectInteraction'
      ? (name, actions) => objects.set(name, actions)
      : target[prop],
  });
  require('../plugins/quests/quests/PriestInPeril.Quest')(api);
  const pass = objects.get('Holy barrier')?.['Pass-through'];
  assert.equal(typeof pass, 'function');
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().at(-1);
  const moves = [];
  const messages = [];
  let stage = 0;
  const player = {
    getAttribute: () => stage,
    moveTo: (location) => moves.push([location.getX(), location.getY(), location.getZ()]),
    sendMessage: (text) => messages.push(text),
  };
  for (stage of [0, 10, 50, quest.completionValue - 1]) {
    assert.equal(pass({ player, objectId: api.core.ObjectIdentifiers.HOLY_BARRIER }), true);
    assert.deepEqual(moves, [], 'unfinished quests cannot cross');
    assert.match(messages.at(-1), /complete Priest in Peril/);
  }
  for (stage of [quest.completionValue, quest.completionValue + 1]) {
    assert.equal(pass({ player, objectId: api.core.ObjectIdentifiers.HOLY_BARRIER }), true);
    assert.deepEqual(moves.at(-1), [3423, 3485, 0]);
    assert.equal(messages.at(-1), 'You pass through the holy barrier.');
  }
  const before = [moves.length, messages.length];
  assert.equal(pass({ player, objectId: api.core.ObjectIdentifiers.HOLY_BARRIER_2 }), false,
    'the Hallowed Sepulchre barrier is handled by its own content');
  assert.deepEqual([moves.length, messages.length], before);
});

function questScene(name) {
  const { api, handlers } = mockApi();
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().at(-1);
  const attributes = new Map();
  const items = new Map();
  const messages = [];
  let location;
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    isFull: () => false,
    adds: (id, amount) => items.set(id, inventory.getAmount(id) + amount),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, inventory.getAmount(id) - amount)),
  };
  const sender = new Proxy({}, { get: () => () => sender });
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getUsername: () => 'QuestTester',
    getPrivateArea: () => null,
    isPlayer: () => true,
    getAsPlayer: () => player,
    getLocation: () => location,
    moveTo: (tile) => { location = tile; },
    sendMessage: (text) => messages.push(text),
  };
  const tile = (x, y, z = 0) => new api.core.Location(x, y, z);
  return { api, handlers, quest, player, items, messages, tile };
}

test('manor front doors close after entry and the back door crosses both ways', () => {
  const { api, handlers, player, tile, messages } = questScene('ErnestTheChicken');
  const { ObjectIdentifiers: O, GameObject } = api.core;
  const open = (id, x, y, face, from) => {
    player.moveTo(from);
    const object = new GameObject(id, tile(x, y), 0, face);
    const route = { player, object, objectId: id, sourceLocation: { x: from.getX(), y: from.getY(), z: 0 } };
    handlers.route.forEach((h) => h(route));
    assert.ok(route.destination);
    player.moveTo(tile(route.destination.x, route.destination.y));
    const event = { player, object, objectId: id, location: { x, y, z: 0 }, clickType: 1,
      definition: { getInteractions: () => ['Open'] } };
    handlers.custom.get('door:toggle').forEach((h) => h(event));
    if (!event.handled) handlers.object.forEach((h) => h(event));
    assert.equal(event.handled, true);
    return [player.getLocation().getX(), player.getLocation().getY()];
  };
  for (const [id, x] of [[O.LARGE_DOOR_5, 3108], [O.LARGE_DOOR_6, 3109]]) {
    assert.deepEqual(open(id, x, 3353, 1, tile(x, 3353)), [x, 3354]);
    assert.match(messages.at(-1), /slam shut/);
    assert.deepEqual(open(id, x, 3353, 1, tile(x, 3354)), [x, 3354]);
    assert.match(messages.at(-1), /another way out/);
  }
  assert.deepEqual(open(O.DOOR_15, 3123, 3361, 3, tile(3123, 3360)), [3123, 3362]);
  assert.deepEqual(open(O.DOOR_15, 3123, 3361, 3, tile(3123, 3361)), [3123, 3360]);
});

test('fortress sturdy doors and secret walls can be crossed and recrossed from their own tile', () => {
  const { api, handlers, quest, player, tile } = questScene('BlackKnightsFortress');
  const { ObjectIdentifiers: O, GameObject } = api.core;
  for (const stage of [1, 2, 3]) {
    quest.setStage(player, stage);
    for (const [id, x, y, face, option] of [
      [O.STURDY_DOOR_2, 3025, 3511, 2, 'Open'],
      [O.WALL_8, 3016, 3517, 3, 'Push'],
      [O.WALL_8, 3030, 3510, 3, 'Push'],
    ]) {
      const object = new GameObject(id, tile(x, y, 1), 0, face);
      const axis = face === 2 ? 'x' : 'y';
      for (const side of [-1, 0, 1]) {
        const from = { x, y, z: 1, [axis]: (axis === 'x' ? x : y) + side };
        player.moveTo(tile(from.x, from.y, from.z));
        const route = { player, object, objectId: id, sourceLocation: from };
        handlers.route.forEach((h) => h(route));
        player.moveTo(tile(route.destination.x, route.destination.y, 1));
        const event = { player, object, objectId: id, location: { x, y, z: 1 }, clickType: 1,
          definition: { getInteractions: () => [option] } };
        handlers.object.forEach((h) => h(event));
        const direction = side || (face === 2 ? -1 : 1);
        assert.equal(player.getLocation()[axis === 'x' ? 'getX' : 'getY'](), (axis === 'x' ? x : y) - direction);
        assert.equal(event.handled, true);
      }
    }
  }
});

test('Prince Ali key print and bronze bar go to Osman, then Leela gives the key', () => {
  const { api, handlers, quest, player, items } = questScene('PrinceAliRescue');
  const { ItemIdentifiers: I, NpcIdentifiers: N } = api.core;
  quest.setStage(player, 20);
  items.set(I.KEY_PRINT, 1);
  const give = () => handlers.itemOnNpc.forEach((h) => h({ player, npcId: N.OSMAN_9, itemId: I.KEY_PRINT }));
  give();
  assert.equal(items.get(I.KEY_PRINT), 1, 'missing bronze must not consume the print');
  assert.equal(quest.getStage(player), 20);
  items.set(I.BRONZE_BAR, 1);
  give();
  assert.equal(quest.getStage(player), 21);
  assert.equal(items.get(I.KEY_PRINT), 0);
  assert.equal(items.get(I.BRONZE_BAR), 0);
  assert.match(quest.buildJournal(player, quest).join('\n'), /collect the bronze key from.*Leela/);
  const event = { player, npcId: N.LEELA, stepId: 'NVdPNU' };
  handlers.custom.get('npc-dialogue:action').forEach((h) => h(event));
  assert.equal(quest.getStage(player), 22);
  assert.equal(items.get(I.BRONZE_KEY), 1);
  handlers.custom.get('npc-dialogue:action').forEach((h) => h(event));
  assert.equal(items.get(I.BRONZE_KEY), 1, 'replaying the handoff must not duplicate the key');
});

test('Death Plateau keeps Eohric and Harold dialogue in order', () => {
  const { api, handlers, quest, player } = questScene('DeathPlateau');
  const { EOHRIC, HAROLD, DENULTH } = api.core.NpcIdentifiers;
  const select = handlers.variant.at(-1);
  const talk = npcId => select({ npcId, player });
  quest.setStage(player, 10);
  assert.equal(talk(DENULTH), 'getting-started-talking-to-denulth-again');
  assert.equal(talk(EOHRIC), 'finding-the-combination-talking-to-eohric');
  assert.equal(quest.getStage(player), 20);
  assert.equal(talk(EOHRIC), 'finding-the-combination-talking-to-eohric-talking-to-eohric-again');
  assert.equal(quest.getStage(player), 20, 'revisiting Eohric cannot pretend Harold was met');
  assert.equal(talk(HAROLD), 'finding-the-combination-talking-to-harold');
  assert.equal(quest.getStage(player), 30);
  assert.equal(talk(HAROLD), 'finding-the-combination-talking-to-harold-again');
  assert.equal(talk(EOHRIC), 'finding-the-combination-talking-to-eohric-after-talking-to-harold');
  assert.equal(quest.getStage(player), 40);
  assert.equal(talk(EOHRIC), 'finding-the-combination-talking-to-eohric-again-after-learning-harold-s-weakness');
  assert.equal(talk(HAROLD), 'finding-the-combination-talking-to-harold-after-learning-his-weakness');
  quest.setStage(player, 65);
  assert.equal(talk(EOHRIC), 'finding-the-combination-talking-to-eohric-after-opening-the-equipment-room');
});

test("Death Plateau doors require Eohric's hint and the solved puzzle", () => {
  const { api, handlers, quest, player, messages } = questScene('DeathPlateau');
  const door = api.core.ObjectIdentifiers.DOOR_115;
  const toggle = objectId => {
    const event = { player, objectId, handled: false };
    handlers.custom.get('door:toggle').forEach(handler => handler(event));
    return event.handled;
  };
  for (const stage of [0, 10]) {
    quest.setStage(player, stage);
    assert.equal(toggle(door), true);
    assert.match(messages.at(-1), /without a reason/);
  }
  for (const stage of [20, 30, 40, 60, 80]) {
    quest.setStage(player, stage);
    assert.equal(toggle(door), false, 'the shared door handler opens it');
  }
  for (const stage of [0, 55, 60, 65, 70, 80]) {
    quest.setStage(player, stage);
    assert.equal(toggle(api.core.ObjectIdentifiers.LARGE_DOOR_23), stage < 65);
  }
  quest.setStage(player, 0);
  assert.equal(toggle(api.core.ObjectIdentifiers.DOOR), false);
});

test('Tenzing sells climbing boots after Death Plateau, including during Troll Stronghold', () => {
  const { api, handlers, quest, player, items } = questScene('DeathPlateau');
  const { TENZING } = api.core.NpcIdentifiers;
  const { COINS, CLIMBING_BOOTS } = api.core.ItemIdentifiers;
  quest.setStage(player, quest.completionValue);
  assert.deepEqual(handlers.variant.at(-1)({ player, npcId: TENZING }), { page: 'Tenzing', variant: 'after-death-plateau' });
  const condition = text => handlers.condition.at(-1)({ player, npcId: TENZING, text });
  const action = event => handlers.custom.get('npc-dialogue:action').forEach(handler => handler(event));
  for (const stepId of ['FgkYXO', '7mwtJo']) {
    items.set(COINS, 24);
    items.set(CLIMBING_BOOTS, 0);
    assert.equal(condition('If the player has enough coins in their inventory:'), true);
    assert.equal(condition('If the player does not have enough coins in their inventory:'), false);
    assert.equal(condition('If the player has 12 gp:'), true);
    action({ player, npcId: TENZING, stepId });
    assert.equal(items.get(COINS), 24, 'generic action events do not charge');
    action({ player, npcId: TENZING, stepId, kind: 'message' });
    assert.equal(items.get(COINS), 12);
    assert.equal(items.get(CLIMBING_BOOTS), 1);
  }
  player.setAttribute('quest.troll_stronghold.stage', 10);
  assert.equal(handlers.variant.at(-1)({ player, npcId: TENZING }), null, 'active Troll Stronghold keeps its dialogue');
  assert.equal(condition('If the player has 12 gp:'), true, 'its purchase uses the same coin check');
});

test('Tenzing refuses unpaid/full-inventory purchases and accepts payment that frees a slot', () => {
  const { api, handlers, quest, player, items } = questScene('DeathPlateau');
  const { COINS, CLIMBING_BOOTS } = api.core.ItemIdentifiers;
  const inventory = player.getInventory();
  let fullMessage = false;
  inventory.full = () => { fullMessage = true; };
  const buy = () => {
    const event = { player, npcId: api.core.NpcIdentifiers.TENZING, stepId: 'FgkYXO', kind: 'message' };
    handlers.custom.get('npc-dialogue:action').forEach(handler => handler(event));
    return event;
  };
  items.set(COINS, 12);
  assert.equal(buy().end, true, 'cannot buy before completing Death Plateau');
  assert.equal(items.get(COINS), 12);
  quest.setStage(player, quest.completionValue);
  items.set(COINS, 11);
  assert.equal(buy().end, true);
  assert.equal(items.get(COINS), 11);
  items.set(COINS, 13);
  inventory.isFull = () => true;
  assert.equal(buy().end, true);
  assert.equal(fullMessage, true);
  assert.equal(items.get(COINS), 13);
  assert.equal(items.get(CLIMBING_BOOTS), undefined);
  items.set(COINS, 12);
  buy();
  assert.equal(items.get(COINS), 0);
  assert.equal(items.get(CLIMBING_BOOTS), 1, 'spending the last coins makes room for the boots');
});

test('Death Plateau final handover conditions require both the map and combination', () => {
  const { api, handlers, quest, player, items } = questScene('DeathPlateau');
  const { SECRET_WAY_MAP, COMBINATION } = api.core.ItemIdentifiers;
  quest.setStage(player, 78);
  const condition = text => handlers.condition.at(-1)({ player, npcId: api.core.NpcIdentifiers.DENULTH, text });
  for (const have of [[], [SECRET_WAY_MAP], [COMBINATION], [SECRET_WAY_MAP, COMBINATION]]) {
    items.clear();
    have.forEach(id => items.set(id, 1));
    assert.equal(condition('If the player has not turned in all the items:'), have.length < 2);
    assert.equal(condition('If the player has turned in all the items:'), have.length === 2);
  }
});

test('Harold keeps his ale/drunk state and accepts either Blurberry special', () => {
  for (const drink of ['BLURBERRY_SPECIAL', 'PREMADE_BLURB_SP']) {
    const { api, handlers, quest, player, items } = questScene('DeathPlateau');
    const { HAROLD } = api.core.NpcIdentifiers;
    const I = api.core.ItemIdentifiers;
    const select = () => handlers.variant.at(-1)({ player, npcId: HAROLD });
    const act = stepId => handlers.custom.get('npc-dialogue:action').forEach(h => h({ player, npcId: HAROLD, kind: 'message', stepId }));
    quest.setStage(player, 40); items.set(I.ASGARNIAN_ALE, 1); act('_ELP6x');
    assert.equal(quest.getStage(player), 50);
    assert.equal(items.get(I.ASGARNIAN_ALE), 0);
    assert.equal(select(), 'finding-the-combination-talking-to-harold-after-giving-him-an-asgarnian-ale');
    items.set(I[drink], 1);
    assert.equal(handlers.condition.at(-1)({ player, npcId: HAROLD, text: 'If the player does not have a Blurberry special:' }), false);
    act('VZS4Rq');
    assert.equal(items.get(I[drink]), 0);
    assert.equal(player.getAttribute('death-plateau:harold-drunk'), true);
    assert.equal(select(), 'finding-the-combination-talking-to-harold-after-giving-him-a-blurberry-special');
  }
});

test('Harold gives an IOU first and reading it replaces it with one combination', () => {
  const { api, handlers, quest, player, items } = questScene('DeathPlateau');
  const I = api.core.ItemIdentifiers, { HAROLD } = api.core.NpcIdentifiers;
  const act = stepId => handlers.custom.get('npc-dialogue:action').forEach(h => h({ player, npcId: HAROLD, kind: 'message', stepId }));
  quest.setStage(player, 50); act('4p9H2-'); act('MBm6Sz');
  assert.equal(quest.getStage(player), 55);
  assert.equal(items.get(I.IOU), 1); assert.equal(items.get(I.COMBINATION), undefined);
  act('abx6jE'); act('hYvfps');
  assert.equal(quest.getStage(player), 60);
  assert.equal(items.get(I.IOU), 0); assert.equal(items.get(I.COMBINATION), 1);
  items.delete(I.COMBINATION); act('23tpMt');
  assert.equal(items.get(I.COMBINATION), 1, 'lost combination comes back without gambling');
  assert.equal(items.get(I.IOU), 0);
  assert.equal(handlers.itemAction.get('Combination').Read({ player, itemId: I.COMBINATION }), true);
});

function puzzleScene() {
  const scene = questScene('DeathPlateau'), ground = new Map();
  const key = (id, tile) => `${id}:${tile.getX()},${tile.getY()}`;
  scene.api.getItemOnGroundManager = () => ({
    getGroundItem: (_owner, id, tile) => ground.get(key(id, tile)),
    registerNonGlobals: (player, item, tile) => ground.set(key(item.id, tile), { id: item.id, tile, getOwner: () => player.getUsername() }),
    deregister: item => ground.delete(key(item.id, item.tile)),
  });
  scene.place = (id, x, y) => scene.handlers.itemOnObject.forEach(h => h({ player: scene.player, itemId: id, objectId: scene.api.core.ObjectIdentifiers.STONE_MECHANISM, location: { x, y, z: 0 } }));
  scene.ground = ground;
  return scene;
}

test('five correct colours unlock only after reading; placements are private and reversible', () => {
  const { quest, player, items, place, handlers, ground } = puzzleScene();
  const solution = [[3109,2894,3563],[3110,2894,3562],[3111,2895,3562],[3112,2895,3563],[3113,2895,3564]];
  quest.setStage(player, 55);
  solution.forEach(([id,x,y]) => { items.set(id,1); place(id,x,y); });
  assert.equal(quest.getStage(player),55,'unread IOU does not unlock the room');
  quest.setStage(player,60); items.set(3113,1); place(3113,2895,3564);
  assert.equal(quest.getStage(player),65);
  const green = ground.get('3113:2895,3564');
  const pickup = { player, groundItem:green, groundItemId:3113, location:{x:2895,y:3564,z:0}, handled:false };
  handlers.ground.forEach(h => h(pickup));
  assert.equal(pickup.handled,true);
  assert.equal(items.get(3113),2,'the replacement and the placed ball each return once');
  assert.equal(player.getAttribute('death-plateau:stone-balls')['2895,3564'],undefined);
  assert.equal(ground.size,4);
  ground.clear(); handlers.area.find(a => a.constructor.name==='PuzzleArea').process(player);
  assert.equal(ground.size,4,'saved placements restore after floor-item expiry/relogin');
});

test('wrong colours and a sixth occupied mechanism tile keep the room locked', () => {
  const { quest, player, items, place } = puzzleScene();
  quest.setStage(player,60);
  for (const [id,x,y] of [[3110,2894,3563],[3109,2894,3562],[3111,2895,3562],[3112,2895,3563],[3113,2895,3564]]) {items.set(id,1);place(id,x,y);}
  assert.equal(quest.getStage(player),60);
  items.set(3109,1);place(3109,2894,3564);
  items.set(3109,1);place(3109,2894,3563);
  items.set(3110,1);place(3110,2894,3562);
  assert.equal(quest.getStage(player),60,'the spare top-left tile must be empty');
  assert.equal(Object.keys(player.getAttribute('death-plateau:stone-balls')).length,6);
});

test('Dunstan introduces his son first and remembers a delivered certificate', () => {
  const { api, handlers, quest, player, items } = questScene('DeathPlateau');
  const { DUNSTAN, DENULTH } = api.core.NpcIdentifiers, I = api.core.ItemIdentifiers;
  const talk = npcId => handlers.variant.at(-1)({ player, npcId });
  quest.setStage(player,72);items.set(I.CLIMBING_BOOTS,1);
  assert.equal(talk(DENULTH),'new-route-up-death-plateau-talking-to-denulth-after-opening-the-equipment-room');
  assert.equal(talk(DUNSTAN),'new-route-up-death-plateau-talking-to-dunstan');
  assert.equal(quest.getStage(player),73);
  assert.equal(talk(DUNSTAN),'new-route-up-death-plateau-talking-to-dunstan-again');
  assert.equal(talk(DENULTH),'new-route-up-death-plateau-talking-to-denulth-after-talking-to-dunstan');
  items.set(I.CERTIFICATE_2,1);
  handlers.custom.get('npc-dialogue:action').forEach(h => h({ player,npcId:DUNSTAN,stepId:'jmuuX8',kind:'message' }));
  assert.equal(talk(DUNSTAN),'new-route-up-death-plateau-talking-to-dunstan-before-getting-the-spiked-boots');
});

test('scouting is required and lost maps can be replaced without paying supplies again', () => {
  const runtime=require('../plugins/quests/QuestRuntime'), original=runtime.startTranscript;
  let scene;
  runtime.startTranscript=()=>true;
  try { scene=questScene('DeathPlateau'); } finally { runtime.startTranscript=original; }
  const { api, handlers, quest, player, items, tile }=scene;
  const I=api.core.ItemIdentifiers, { TENZING, DENULTH }=api.core.NpcIdentifiers;
  quest.setStage(player,77);items.set(I.SECRET_WAY_MAP,1);items.set(I.COMBINATION,1);
  const ready=()=>handlers.condition.at(-1)({ player,npcId:DENULTH,text:'If the player has turned in all the items:' });
  assert.equal(ready(),false);
  assert.equal(handlers.npc.get('Denulth')['Talk-to']({ player }),true);
  const scout=handlers.area.find(a=>a.constructor.name==='ScoutArea');
  player.moveTo(tile(2865,3609,1));scout.process(player);assert.equal(quest.getStage(player),77);
  items.delete(I.SECRET_WAY_MAP);
  assert.equal(handlers.variant.at(-1)({ player,npcId:TENZING }),'new-route-up-death-plateau-talking-to-tenzing-after-losing-the-map');
  player.moveTo(tile(2865,3609));scout.process(player);assert.equal(quest.getStage(player),77,'the scout needs the map');
  handlers.custom.get('npc-dialogue:action').forEach(h=>h({ player,npcId:TENZING,stepId:'TgL2Wy',kind:'message' }));
  assert.equal(items.get(I.SECRET_WAY_MAP),1);
  scout.process(player);assert.equal(quest.getStage(player),78);
  assert.equal(handlers.npc.get('Denulth')['Talk-to']({ player }),false);
  assert.equal(ready(),true);
});


test('Denulth remembers partial note hand-ins and completes after the missing note is recovered', () => {
  const { api, handlers, quest, player, items } = questScene('DeathPlateau');
  const I = api.core.ItemIdentifiers, { DENULTH } = api.core.NpcIdentifiers;
  const act = stepId => handlers.custom.get('npc-dialogue:action').forEach(h => h({ player, npcId: DENULTH, kind: 'message', stepId }));
  player.getSkillManager = () => ({ addExperiences: () => {} });
  player.isRegistered = () => false;
  quest.setStage(player,77);items.set(I.SECRET_WAY_MAP,1);
  act('sdE5c5');assert.equal(items.get(I.SECRET_WAY_MAP),1,'cannot submit before scouting');
  quest.setStage(player,78);act('sdE5c5');
  assert.equal(items.get(I.SECRET_WAY_MAP),0);
  assert.equal(handlers.condition.at(-1)({ player,npcId:DENULTH,text:"If the player has the map:" }),true);
  act('IRymYG');assert.equal(quest.getStage(player),78);
  items.set(I.COMBINATION,1);act('liaDgz');act('IRymYG');
  assert.equal(items.get(I.COMBINATION),0);assert.equal(quest.isComplete(player),true);
});


test('boot and map exchanges happen together and cannot strand a cancelled dialogue', () => {
  const { api, handlers, quest, player, items } = questScene('DeathPlateau');
  const I = api.core.ItemIdentifiers, { DUNSTAN, TENZING } = api.core.NpcIdentifiers;
  const act = (npcId, stepId) => handlers.custom.get('npc-dialogue:action').forEach(h => h({ player, npcId, kind: 'message', stepId }));
  quest.setStage(player,73);items.set(I.CLIMBING_BOOTS,1);items.set(I.IRON_BAR,1);
  act(DUNSTAN,'V1M373');assert.equal(items.get(I.CLIMBING_BOOTS),1,'cancelling before reward retains materials');
  act(DUNSTAN,'1TFYaK');act(DUNSTAN,'WryBLk');
  assert.equal(items.get(I.CLIMBING_BOOTS),0);assert.equal(items.get(I.IRON_BAR),0);assert.equal(items.get(I.SPIKED_BOOTS),1);
  items.set(I.BREAD,10);items.set(I.TROUT,10);
  act(TENZING,'_ZbFCb');act(TENZING,'JM8S8J');assert.equal(items.get(I.SPIKED_BOOTS),1);
  act(TENZING,'yDYvE0');act(TENZING,'MtULDz');
  assert.equal(items.get(I.SPIKED_BOOTS),0);assert.equal(items.get(I.BREAD),0);assert.equal(items.get(I.TROUT),0);
  assert.equal(items.get(I.SECRET_WAY_MAP),1);assert.equal(quest.getStage(player),77);
  items.delete(I.SECRET_WAY_MAP);act(TENZING,'TgL2Wy');assert.equal(items.get(I.SECRET_WAY_MAP),1);
});
