// Grim Tales (q053) route + cache-wire contract.
// From server/: node --test tests/qh728-q053.test.cjs
//
// Fixture start: durable stage 0, Witch's House complete and the five skills at 99.
// Items used along the route are granted by the test and declared in the comments;
// every transition is delivered through the plugin's registered handlers.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

const transcripts = [];
const originalStartTranscript = runtime.startTranscript;
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};

const PIANO_TILE = { x: 2907, y: 9870, z: 0 };
const MUSIC_STAND_TILE = { x: 2900, y: 9875, z: 0 };
const PENDANT_TILE = { x: 2262, y: 5516, z: 3 };
const MOUSE_HOLE_ENTRY = { x: 2275, y: 5530, z: 0 };

function setup() {
  const registeredObjects = [];
  const stubs = {
    ObjectManager: {
      register(object) { registeredObjects.push(object); },
      deregister(object) { const index = registeredObjects.indexOf(object); if (index !== -1) registeredObjects.splice(index, 1); },
    },
    GameObject: class {
      constructor(id, location, type, rotation) {
        this.id = id;
        this.location = location;
        this.type = type;
        this.rotation = rotation;
      }
      getId() { return this.id; }
      getLocation() { return this.location; }
    },
    ItemDefinition: { forId: (id) => ({
      getName: () => (id === core.ItemIdentifiers.RUNE_AXE ? 'Rune axe' : ''),
      isStackable: () => id === core.ItemIdentifiers.SHRUNK_OGLEROOT,
    }) },
  };
  const questCore = { ...core, ...stubs, CountdownTask: undefined, TaskManager: undefined };
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const objectHandlers = [];
  const npcDeathHandlers = [];
  const loginHandlers = [];
  const logoutHandlers = [];
  const itemOnItem = [];
  const itemOnNpc = [];
  const itemOnObject = [];
  const itemActions = new Map();
  const interfaceButtons = [];
  const npcInteractions = new Map();
  const prompts = [];
  const spawned = [];
  const groundItems = [];
  const completedQuests = new Set();
  const varbits = new Map();
  const configs = new Map();
  const messages = [];
  const itemAmounts = new Map();
  const stackableItems = new Set([core.ItemIdentifiers.SHRUNK_OGLEROOT]);
  const xp = new Map();
  let full = false;
  let location = new core.Location(0, 0, 0);
  let weapon = null;
  let nextSpawn = 0;

  const api = new Proxy({
    core: questCore,
    persistAttribute() {},
    onNpcDialogueVariant(handler) { variants.push(handler); },
    onNpcDialogueCondition(handler) { conditions.push(handler); },
    onItemOnItem(handler) { itemOnItem.push(handler); },
    onItemOnNpc(handler) { itemOnNpc.push(handler); },
    onItemOnObject(handler) { itemOnObject.push(handler); },
    onItemAction(name, actions) { itemActions.set(name, actions); },
    onObjectInteraction(handler) { objectHandlers.push(handler); },
    onNpcDeath(handler) { npcDeathHandlers.push(handler); },
    onNpcInteraction(name, actions) { npcInteractions.set(name, actions); },
    onPlayerLogin(handler) { loginHandlers.push(handler); },
    onPlayerLogout(handler) { logoutHandlers.push(handler); },
    onInterfaceActionButton(ids, handler) { interfaceButtons.push({ ids: [].concat(ids), handler }); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && completedQuests.has(event.key)) event.complete = true;
      for (const handler of custom.get(name) ?? []) handler(event);
    },
    spawnNpc(spec) {
      const npc = {
        id: spec.id,
        index: nextSpawn++,
        owner: spec.owner,
        getOwner() { return this.owner; },
        getLocation() { return new core.Location(spec.x, spec.y, spec.z); },
        getSpawnLocation() { return new core.Location(spec.x, spec.y, spec.z); },
        isRegistered() { return true; },
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      const index = spawned.indexOf(npc);
      if (index !== -1) spawned.splice(index, 1);
    },
    getItemOnGroundManager() {
      return { registerLocation(player, item) { groundItems.push({ player, item }); } };
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });

  require('../plugins/quests/quests/GrimTales.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'grim_tales');

  const skillLevels = new Map([
    [core.Skill.FARMING.getIndex(), 99],
    [core.Skill.HERBLORE.getIndex(), 99],
    [core.Skill.THIEVING.getIndex(), 99],
    [core.Skill.AGILITY.getIndex(), 99],
    [core.Skill.WOODCUTTING.getIndex(), 99],
    [core.Skill.HITPOINTS.getIndex(), 99],
  ]);

  const inventory = {
    getAmount: (id) => itemAmounts.get(id) ?? 0,
    adds(id, amount = 1) {
      if (full && !(stackableItems.has(id) && (itemAmounts.get(id) ?? 0) > 0)) return false;
      itemAmounts.set(id, (itemAmounts.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber(id, amount = 1) {
      itemAmounts.set(id, Math.max(0, (itemAmounts.get(id) ?? 0) - amount));
      return true;
    },
    forceAdd(_player, item) {
      itemAmounts.set(item.getId(), (itemAmounts.get(item.getId()) ?? 0) + item.getAmount());
      return true;
    },
    isFull: () => full,
    getFreeSlots: () => (full ? 0 : 28),
    get: () => null,
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendString(text, uid) { messages.push({ text, uid }); return sender; },
    sendInterface(id) { prompts.push({ interfaceId: id }); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  function otherPlayer() {
    const otherAttributes = new Map();
    const otherVarbits = new Map();
    const otherSender = new Proxy({
      sendVarbit(id, value) { otherVarbits.set(id, value); return otherSender; },
    }, { get(target, key) { return key in target ? target[key] : () => otherSender; } });
    const other = Object.create(player);
    other.getAttribute = (key) => otherAttributes.get(key);
    other.setAttribute = (key, value) => otherAttributes.set(key, value);
    other.getPacketSender = () => otherSender;
    return { player: other, attributes: otherAttributes, varbits: otherVarbits };
  }

  const attributes = new Map();
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => skillLevels.get(skill.getIndex()) ?? 1,
      addExperiences(skill, amount) {
        xp.set(skill.getIndex(), (xp.get(skill.getIndex()) ?? 0) + amount);
        return true;
      },
      setCurrentLevel() {},
    }),
    getEquipment: () => ({ get: () => weapon }),
    getLocation: () => location,
    moveTo(next) { location = next; },
    getUsername: () => 'qh728-q053',
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
  };

  const variant = (npcId) => {
    const result = variants.map((handler) => handler({ player, npcId })).find(Boolean);
    return typeof result === 'string' ? { variant: result } : result ?? null;
  };
  const condition = (npcId, stepId) => {
    for (const handler of conditions) {
      const answer = handler({ player, npcId, stepId });
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  const line = (npcId, text) => {
    const event = { player, npcId, text };
    for (const handler of custom.get('npc-dialogue:line') ?? []) handler(event);
    return event;
  };
  const choice = (npcId, option) => {
    for (const handler of custom.get('npc-dialogue:choice') ?? []) handler({ player, npcId, option, stepId: 'test' });
  };
  const action = (npcId, stepId) => {
    const event = { player, npcId, stepId, handled: false };
    for (const handler of custom.get('npc-dialogue:action') ?? []) handler(event);
    return event;
  };
  const object = (objectId, { clickType = 1, location: tile = location, player: targetPlayer = player, definition } = {}) => {
    const event = {
      player: targetPlayer,
      objectId,
      definition,
      clickType,
      location: { x: tile.getX?.() ?? tile.x, y: tile.getY?.() ?? tile.y, z: tile.getZ?.() ?? tile.z },
      handled: false,
    };
    for (const handler of objectHandlers) {
      handler(event);
      if (event.handled) break;
    }
    return event;
  };
  const onObject = (itemId, objectId) => {
    const event = { player, itemId, objectId, handled: false };
    for (const handler of itemOnObject) handler(event);
    return event;
  };
  const onNpc = (itemId, npcId) => {
    const event = { player, itemId, npcId, handled: false };
    for (const handler of itemOnNpc) handler(event);
    return event;
  };
  const useItems = (usedItemId, usedWithItemId) => {
    const event = { player, usedItemId, usedWithItemId, handled: false };
    for (const handler of itemOnItem) handler(event);
    return event;
  };
  const playNote = (child, targetPlayer = player) => {
    const buttonId = (535 << 16) | child;
    for (const registration of interfaceButtons) {
      if (registration.ids.includes(buttonId)) registration.handler({ player: targetPlayer, buttonId, handled: false });
    }
  };

  return {
    quest, player, attributes, itemAmounts, varbits, configs, messages, prompts, spawned, registeredObjects,
    otherPlayer,
    groundItems, xp, variant, condition, line, choice, action, object, onObject, onNpc, useItems,
    playNote,
    drink: (itemId) => itemActions.get('Shrink-me-quick').Drink({ player, itemId }),
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getLocation: () => location,
    setFull(value) { full = value; },
    setWeapon(item) { weapon = item; },
    give(id, amount = 1) { itemAmounts.set(id, (itemAmounts.get(id) ?? 0) + amount); },
    completeQuest(key) { completedQuests.add(key); },
    login(targetPlayer = player) { for (const handler of loginHandlers) handler({ player: targetPlayer }); },
    logout() { for (const handler of logoutHandlers) handler({ player }); },
    killGlod() {
      const npc = spawned.find((entry) => entry.id === core.NpcIdentifiers.GLOD);
      assert.ok(npc, 'Glod was not spawned at the grown beanstalk');
      for (const handler of npcDeathHandlers) handler({ killer: player, npc, npcId: npc.id });
      return npc;
    },
  };
}

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;

function prerequisites(h) {
  h.completeQuest('witchs_house');
}

function routeToCompletion(h) {
  const { quest, player } = h;
  const stage = () => quest.getStage(player);

  // Fresh stage 0: Sylas start branch; the guard only blocks unmet requirements.
  assert.equal(stage(), 0);
  assert.equal(h.variant(N.SYLAS)?.variant, 'getting-started');
  assert.equal(h.condition(N.SYLAS, '7a_R6r'), false, 'skills and Witch\'s House are fixture-set');
  h.line(N.SYLAS, 'Ahhh, good day young adventurer. A good day indeed!');
  assert.equal(stage(), 1);
  assert.equal(h.varbits.get(2783), 10, 'active feather-and-helmet stage uses QH key 10');

  // Grimgnash story: the choice and the sleep action are separate handler edges.
  assert.equal(h.variant(N.GRIMGNASH)?.variant, 'obtaining-grimgnash-s-feather-initial-conversation-with-grimgnash');
  h.choice(N.GRIMGNASH, 'I heard you were a great and mighty Griffin!');
  h.action(N.GRIMGNASH, 'iJPYA9');
  h.give(I.GRIFFIN_FEATHER, 1); // fixture: the feather pile action below is exercised separately
  assert.equal(stage(), 1, 'taking the feather does not advance the quest stage');

  // Feather pile: handler refuses only before start/asleep; the action grants the feather.
  h.itemAmounts.set(I.GRIFFIN_FEATHER, 0);
  h.object(O.FEATHERS);
  assert.equal(transcripts.at(-1).variant, 'obtaining-grimgnash-s-feather-taking-the-griffin-feather');
  h.action(N.GRIMGNASH, 'CzhK4D');
  assert.equal(h.itemAmounts.get(I.GRIFFIN_FEATHER), 1);

  // Sylas takes the feather.
  assert.equal(h.variant(N.SYLAS)?.variant, 'obtaining-grimgnash-s-feather-giving-sylas-the-feather');
  h.line(N.SYLAS, 'Ah! Good work. Let me take that from you then.');
  assert.equal(stage(), 2);
  assert.equal(h.itemAmounts.get(I.GRIFFIN_FEATHER) ?? 0, 0);

  // Tower: wall, pipe, beard, Rupert.
  h.setLocation(2971, 3462, 0);
  h.object(O.CRUMBLING_WALL_4);
  assert.notDeepEqual([h.getLocation().getX(), h.getLocation().getY()], [2971, 3462]);
  h.object(O.DRAIN_PIPE, { clickType: 1 });
  h.object(O.DRAIN_PIPE, { clickType: 1 });
  h.action(5122, 'aLgFIp');
  assert.equal(h.varbits.get(3711), 1, 'cache Rupert transform is enabled after the beard dialogue');
  h.setLocation(2966, 3464, 0);
  h.object(O.BEARD);
  assert.equal(h.getLocation().getZ(), 2, 'the beard climbs to the tower top');
  assert.equal(h.variant(N.RUPERT_THE_BEARD)?.variant, 'entering-the-tower-speaking-to-rupert-in-the-tower');
  h.line(N.RUPERT_THE_BEARD, 'Ah! Straight to the point, eh, what?');
  assert.equal(stage(), 3);

  // Miazrqa asks for the pendant and hands over the door key.
  assert.equal(h.variant(N.MIAZRQA)?.variant, 'looking-for-miazrqa-s-pendant');
  h.choice(N.MIAZRQA, 'I see there is an embarrassed-looking dwarf with a most unusual problem.');
  assert.equal(stage(), 4);
  h.action(N.MIAZRQA, 'Q0UzpC');
  assert.equal(h.itemAmounts.get(I.DOOR_KEY), 1);

  // Witch's house door and basement.
  h.setLocation(2900, 3473, 0);
  h.object(O.DOOR_102);
  assert.equal(h.getLocation().getX() < 2900, true, 'the key opens the witch house door');
  h.setLocation(2907, 9876, 0);
  h.object(O.MUSIC_STAND, { location: MUSIC_STAND_TILE });
  assert.equal(h.itemAmounts.get(I.MUSIC_SHEET), 1);

  // Piano: EFEDC then AEGA opens the compartment; search gives the recipe set.
  h.object(O.PIANO_5, { location: PIANO_TILE });
  assert.equal(h.prompts.at(-1).interfaceId, 535, 'piano opens the cache/QH piano widget');
  for (const [index, child] of [77, 78, 77, 76, 75, 73, 70, 72, 73].entries()) {
    h.playNote(child);
    if (index === 0) assert.equal(h.varbits.get(3697), 1, 'piano track varbit mirrors accepted notes');
  }
  assert.equal(h.varbits.get(3698), 1, 'piano-used flag reaches the cache/QH varbit');
  h.object(O.PIANO_6, { clickType: 3, location: PIANO_TILE });
  h.action(N.MIAZRQA, '1fP9ED');
  assert.equal(h.varbits.get(3716), 1, 'searched-piano flag reaches the cache/QH varbit');
  assert.equal(h.itemAmounts.get(I.SHRINKING_RECIPE), 1);
  assert.equal(h.itemAmounts.get(I.TO_DO_LIST), 1);
  assert.equal(h.itemAmounts.get(I.SHRUNK_OGLEROOT), 2);

  // Fixture supplies the two tarromin (unf) the wiki/QH requirement lists.
  h.give(I.TARROMIN_POTION_UNF_, 2);
  h.useItems(I.TARROMIN_POTION_UNF_, I.SHRUNK_OGLEROOT);
  h.useItems(I.TARROMIN_POTION_UNF_, I.SHRUNK_OGLEROOT);
  assert.equal(h.itemAmounts.get(I.SHRINK_ME_QUICK), 2);
  assert.equal(h.itemAmounts.get(I.SHRUNK_OGLEROOT) ?? 0, 0);

  // Drink one potion in the house; the transcript action enters the mouse hole.
  h.setLocation(2903, 3466, 0);
  h.drink(I.SHRINK_ME_QUICK);
  assert.equal(h.itemAmounts.get(I.SHRINK_ME_QUICK), 1, 'the second potion is kept for the beanstalk');
  h.action(N.MIAZRQA, 'i7lDh5');
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY(), h.getLocation().getZ()],
    [MOUSE_HOLE_ENTRY.x, MOUSE_HOLE_ENTRY.y, MOUSE_HOLE_ENTRY.z]);

  // Nail climbs mirror the player one plane at a time.
  h.setLocation(2282, 5543, 0);
  h.object(O.NAILS);
  assert.equal(h.getLocation().getZ(), 1);
  h.object(O.NAILS_2);
  assert.equal(h.getLocation().getZ(), 0);

  // Pendant.
  h.setLocation(PENDANT_TILE.x, PENDANT_TILE.y, PENDANT_TILE.z);
  h.object(O.PENDANT);
  assert.equal(h.itemAmounts.get(I.MIAZRQAS_PENDANT), 1);
  assert.equal(stage(), 5);

  // Return the pendant; Rupert is freed and gives the helmet.
  assert.equal(h.variant(N.MIAZRQA)?.variant, 'looking-for-miazrqa-s-pendant-returning-miazrqa-s-pendant');
  h.action(N.MIAZRQA, '6CrztP');
  assert.equal(h.itemAmounts.get(I.MIAZRQAS_PENDANT) ?? 0, 0);
  assert.equal(stage(), 6);
  assert.equal(h.variant(N.RUPERT_THE_BEARD)?.variant, 'looking-for-miazrqa-s-pendant-speaking-with-rupert');
  h.action(N.RUPERT_THE_BEARD, 'kF0r9w');
  assert.equal(h.itemAmounts.get(I.RUPERTS_HELMET), 1);

  // Sylas takes the helmet and gives the magic beans.
  assert.equal(h.variant(N.SYLAS)?.variant, 'getting-sylas-magic-bean-returning-to-sylas');
  h.action(N.SYLAS, 'scnFAs');
  assert.equal(h.varbits.get(2783), 19, 'the hand-in action selects QH’s talk-to-Sylas transition key');
  h.action(N.SYLAS, '4ncaBB');
  assert.equal(h.itemAmounts.get(I.RUPERTS_HELMET) ?? 0, 0);
  assert.equal(h.itemAmounts.get(I.MAGIC_BEANS), 1);
  assert.equal(stage(), 7);

  // Plant and water the beans (fixture: seed dibber + full watering can).
  h.give(I.SEED_DIBBER, 1);
  h.give(I.WATERING_CAN_8_, 1);
  h.setLocation(2922, 3425, 0);
  h.onObject(I.MAGIC_BEANS, O.EARTH_MOUND);
  assert.equal(h.itemAmounts.get(I.MAGIC_BEANS) ?? 0, 0);
  assert.equal(stage(), 8);
  h.onObject(I.WATERING_CAN_8_, O.BEAN_MOUND);
  assert.equal(stage(), 9);
  assert.ok(h.spawned.some((npc) => npc.id === N.GLOD), 'watering spawns the owned Glod');

  // Glod drops the golden goblin; the fixture picks it up.
  h.killGlod();
  assert.equal(stage(), 10);
  const drops = h.groundItems.map((entry) => entry.item.getId());
  assert.ok(drops.includes(I.GOLDEN_GOBLIN));
  h.give(I.GOLDEN_GOBLIN, 1);

  // Golden goblin hand-in.
  assert.equal(h.variant(N.SYLAS)?.variant, 'the-final-battle-speaking-to-sylas-after-defeating-glod');
  h.line(N.SYLAS, 'First, let me take that goblin from you.');
  assert.equal(h.itemAmounts.get(I.GOLDEN_GOBLIN) ?? 0, 0);
  assert.equal(stage(), 11);

  // Shrink then chop the stalk (fixture: rune axe equipped).
  h.setWeapon({ getId: () => I.RUNE_AXE });
  h.onObject(I.SHRINK_ME_QUICK, O.BEANSTALK_2);
  assert.equal(h.itemAmounts.get(I.SHRINK_ME_QUICK) ?? 0, 0);
  assert.equal(stage(), 12);
  h.object(O.BEANSTALK_4);
  assert.equal(stage(), 13);
  assert.equal(h.varbits.get(2783), 50, 'chopped-stalk stage uses QH key 50');

  // Final hand-in: native completion floor is 60, not the helper key 50 or durable 14.
  assert.equal(h.variant(N.SYLAS)?.variant, 'finishing-the-quest-finishing-up');
  h.action(N.SYLAS, 'kDhVWf');
  assert.equal(stage(), 14);
  assert.equal(h.varbits.get(2783), 60, 'completion sends grim_quest >= 60');
  assert.equal(h.itemAmounts.get(I.DWARVEN_HELMET), 1);
  assert.equal(h.quest.isComplete(player), true);
}

test('Grim Tales runs the mandatory route through every registered transition', () => {
  const h = setup();
  prerequisites(h);
  routeToCompletion(h);
  const qp = h.attributes.get('quest.points');
  assert.equal(qp, 1);
  assert.equal(h.xp.get(core.Skill.WOODCUTTING.getIndex()), 60000);
  assert.equal(h.xp.get(core.Skill.HITPOINTS.getIndex()), 5000);
});

test('Grim Tales completion is idempotent and survives the real login resend', () => {
  const h = setup();
  prerequisites(h);
  routeToCompletion(h);

  const helmet = h.itemAmounts.get(I.DWARVEN_HELMET);
  const points = h.attributes.get('quest.points');
  const woodcutting = h.xp.get(core.Skill.WOODCUTTING.getIndex());
  h.action(N.SYLAS, 'kDhVWf');
  assert.equal(h.quest.getStage(h.player), 14);
  assert.equal(h.itemAmounts.get(I.DWARVEN_HELMET), helmet, 'a repeat completion grants no second helmet');
  assert.equal(h.attributes.get('quest.points'), points, 'a repeat completion grants no second point');
  assert.equal(h.xp.get(core.Skill.WOODCUTTING.getIndex()), woodcutting, 'a repeat completion grants no XP');

  h.varbits.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(2783), 60, 'login replay keeps grim_quest at the cache completion floor');
  h.login();
  assert.notEqual(h.varbits.get(2783), 0, 'the plugin login hook does not clear completion');
});

test('Grim Tales keeps durable stages and sends the Quest Helper phase value', () => {
  const h = setup();
  const qhValues = [0, 10, 10, 10, 10, 10, 10, 20, 20, 30, 30, 40, 40, 50, 60];
  for (let durable = 0; durable <= 14; durable++) {
    h.quest.setStage(h.player, durable);
    assert.equal(h.quest.getStage(h.player), durable, 'durable saves keep their existing stage numbers');
    assert.equal(h.varbits.get(2783), qhValues[durable],
      `durable stage ${durable} sends QH phase ${qhValues[durable]}`);
  }

  h.quest.setStage(h.player, 13);
  h.varbits.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(2783), 50, 'an old in-progress save restores the native final phase');

  h.quest.setStage(h.player, 14);
  h.varbits.clear();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(2783), 60, 'an old completed save restores the canonical wire value');
});

test('Grim Tales resends known Quest Helper auxiliary requirements on transitions and login', () => {
  const h = setup();
  h.quest.setStage(h.player, 1);
  h.action(N.GRIMGNASH, 'iJPYA9');
  assert.equal(h.varbits.get(3717), 1, 'sleeping-Grimgnash condition is sent after the canonical line');
  h.quest.setStage(h.player, 2);
  assert.equal(h.varbits.get(3719), 1, 'given-feather condition follows Sylas’s hand-in');
  h.quest.setStage(h.player, 3);
  assert.equal(h.varbits.get(3694), 15, 'talked-to-Rupert threshold selects the pendant leg');
  h.quest.setStage(h.player, 4);
  assert.equal(h.varbits.get(3694), 20, 'Miazrqa task threshold selects the pendant step');
  h.quest.setStage(h.player, 5);
  h.give(I.MIAZRQAS_PENDANT, 1);
  h.login();
  assert.equal(h.varbits.get(3721), 1, 'held pendant requirement is resent after login');
  h.quest.setStage(h.player, 6);
  assert.equal(h.varbits.get(3694), 25, 'given-pendant requirement advances at the hand-in stage');
  assert.equal(h.varbits.get(3701), 1, 'released-Rupert requirement follows the stage transition');
  h.quest.setStage(h.player, 8);
  assert.equal(h.varbits.get(3714), 1);
  h.quest.setStage(h.player, 9);
  assert.equal(h.varbits.get(3714), 2);
  h.quest.setStage(h.player, 10);
  assert.equal(h.varbits.get(3715), 1);
});

test('Grim Tales full-bag finishing branch is recoverable', () => {
  const h = setup();
  h.quest.setStage(h.player, 13);
  h.setFull(true);
  assert.equal(h.variant(N.SYLAS)?.variant, 'finishing-the-quest-talking-to-sylas-without-a-free-inventory-space');
  h.setFull(false);
  assert.equal(h.variant(N.SYLAS)?.variant, 'finishing-the-quest-finishing-up');
  h.action(N.SYLAS, 'kDhVWf');
  assert.equal(h.quest.getStage(h.player), 14);
  assert.equal(h.itemAmounts.get(I.DWARVEN_HELMET), 1);
});

test('Grim Tales piano progress uses the cache widget and resumes after relog', () => {
  const h = setup();
  h.quest.setStage(h.player, 4);
  h.setLocation(2907, 9876, 0);
  h.object(O.PIANO_5, { location: PIANO_TILE });
  h.playNote(77);
  assert.equal(h.varbits.get(3697), 1);
  h.logout();
  h.login();
  assert.equal(h.varbits.get(3697), 1, 'accepted piano notes survive logout/login');
  h.object(O.PIANO_5, { location: PIANO_TILE });
  h.playNote(70);
  assert.equal(h.varbits.get(3697), 0, 'a wrong next note resets the tune');
  for (const child of [77, 78, 77, 76, 75, 73, 70, 72, 73]) h.playNote(child);
  assert.equal(h.varbits.get(3698), 1, 'the cache sequence opens the piano compartment');
});

test('solving the piano does not replace the cache object for another player', () => {
  const h = setup();
  const other = h.otherPlayer();
  h.login();
  h.login(other.player);
  h.quest.setStage(h.player, 4);
  h.quest.setStage(other.player, 4);
  assert.equal(h.registeredObjects.some((object) => [O.PIANO_5, O.PIANO_6].includes(object.getId())), false,
    'the plugin leaves the piano multi-loc to the per-player cache transform');

  h.object(O.PIANO_5, { location: PIANO_TILE });
  for (const child of [77, 78, 77, 76, 75, 73, 70, 72, 73]) h.playNote(child);
  assert.equal(h.varbits.get(3698), 1, 'the first player has solved the tune');
  assert.equal(other.varbits.get(3698), 0, 'the second player keeps their own locked cache state');

  h.object(O.PIANO_5, { location: PIANO_TILE, player: other.player });
  h.playNote(77, other.player);
  assert.equal(other.varbits.get(3697), 1, 'the second player can still begin the tune');
  assert.equal(other.varbits.get(3698), 0);
});

test('Grim Tales piano rewards and pendant remain recoverable when inventory is full', () => {
  const h = setup();
  h.quest.setStage(h.player, 4);
  h.setLocation(2907, 9876, 0);
  h.object(O.PIANO_5, { location: PIANO_TILE });
  for (const child of [77, 78, 77, 76, 75, 73, 70, 72, 73]) {
    h.playNote(child);
  }

  h.setFull(true);
  h.object(O.PIANO_6, { clickType: 3, location: PIANO_TILE });
  h.action(N.MIAZRQA, '1fP9ED');
  assert.equal(h.itemAmounts.get(I.SHRINKING_RECIPE) ?? 0, 0);
  assert.equal(h.itemAmounts.get(I.TO_DO_LIST) ?? 0, 0);
  assert.equal(h.itemAmounts.get(I.SHRUNK_OGLEROOT) ?? 0, 0);

  h.setFull(false);
  h.object(O.PIANO_6, { clickType: 3, location: PIANO_TILE });
  assert.equal(transcripts.at(-1)?.variant, 'looking-for-miazrqa-s-pendant-searching-the-piano');
  h.action(N.MIAZRQA, '1fP9ED');
  assert.equal(h.itemAmounts.get(I.SHRINKING_RECIPE), 1);
  assert.equal(h.itemAmounts.get(I.TO_DO_LIST), 1);
  assert.equal(h.itemAmounts.get(I.SHRUNK_OGLEROOT), 2);
  h.object(O.PIANO_6, { clickType: 3, location: PIANO_TILE });
  assert.equal(transcripts.at(-1)?.variant, 'looking-for-miazrqa-s-pendant-searching-the-piano-again');

  h.quest.setStage(h.player, 4);
  h.setLocation(PENDANT_TILE.x, PENDANT_TILE.y, PENDANT_TILE.z);
  h.setFull(true);
  h.object(O.PENDANT);
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.itemAmounts.get(I.MIAZRQAS_PENDANT) ?? 0, 0);
  h.setFull(false);
  h.object(O.PENDANT);
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.itemAmounts.get(I.MIAZRQAS_PENDANT), 1);
});

test('Grim Tales piano reward can extend an existing stack when the bag is full', () => {
  const h = setup();
  h.give(I.SHRINKING_RECIPE, 1);
  h.give(I.TO_DO_LIST, 1);
  h.give(I.SHRUNK_OGLEROOT, 1);
  h.setFull(true);

  h.action(N.MIAZRQA, '1fP9ED');

  assert.equal(h.itemAmounts.get(I.SHRUNK_OGLEROOT), 2,
    'the reward appends to its existing stack and does not reserve a new slot');
});

test('Grim Tales destroyed-bean recovery selects the canonical receipt tail', () => {
  const h = setup();
  h.quest.setStage(h.player, 7);
  const choice = h.variant(N.SYLAS);
  assert.equal(choice?.variant, 'getting-sylas-magic-bean-returning-to-sylas');
  assert.equal(typeof choice?.select, 'function');
  const dialogue = require('../data/definitions/npc-dialogues.json')['Grim Tales'];
  const selected = choice.select(dialogue.variants[choice.variant]);
  assert.deepEqual(selected, [
    { type: 'line', speaker: 'Sylas', text: 'Here are the beans as promised.' },
    { type: 'action', action: 'receive', text: 'Magic beans', id: '4ncaBB' },
  ]);

  h.setFull(true);
  h.action(N.SYLAS, '4ncaBB');
  assert.equal(h.itemAmounts.get(I.MAGIC_BEANS) ?? 0, 0, 'a full bag leaves the reclaim retryable');
  assert.equal(h.quest.getStage(h.player), 7, 'the reclaim does not alter durable quest progress');

  h.setFull(false);
  assert.equal(h.variant(N.SYLAS)?.variant, 'getting-sylas-magic-bean-returning-to-sylas');
  h.action(N.SYLAS, '4ncaBB');
  assert.equal(h.itemAmounts.get(I.MAGIC_BEANS), 1);
  assert.equal(h.quest.getStage(h.player), 7);
});

test('Grim Tales bean receipt does not advance when inventory cannot accept beans', () => {
  const h = setup();
  h.quest.setStage(h.player, 6);
  h.setFull(true);
  h.action(N.SYLAS, '4ncaBB');
  assert.equal(h.itemAmounts.get(I.MAGIC_BEANS) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 6);

  h.setFull(false);
  h.action(N.SYLAS, '4ncaBB');
  assert.equal(h.itemAmounts.get(I.MAGIC_BEANS), 1);
  assert.equal(h.quest.getStage(h.player), 7);
});

test('Grim Tales resumes the helmet exchange after the hand-in action and a relog', () => {
  const h = setup();
  h.quest.setStage(h.player, 6);
  h.give(I.RUPERTS_HELMET, 1);
  h.action(N.SYLAS, 'scnFAs');
  assert.equal(h.quest.getStage(h.player), 6, 'the item hand-in alone is not bean receipt');
  assert.equal(h.varbits.get(2783), 19);
  h.login();
  assert.equal(h.varbits.get(2783), 19, 'the interrupted talk-to-Sylas phase survives login');
  assert.equal(h.variant(N.SYLAS)?.variant, 'getting-sylas-magic-bean-returning-to-sylas');
  h.action(N.SYLAS, '4ncaBB');
  assert.equal(h.quest.getStage(h.player), 7);
  assert.equal(h.varbits.get(2783), 20);
});

test('Grim Tales does not duplicate cache-spawned tower NPCs', () => {
  const h = setup();
  h.login();
  assert.equal(h.spawned.some((npc) => npc.id === N.GRIMGNASH), false,
    'cache spawn 6274 already transforms to the awake Grimgnash');
  assert.equal(h.spawned.some((npc) => npc.id === N.RUPERT_THE_BEARD), false,
    'cache spawn 6276 transforms from hidden to visible using varbit 3711');
  assert.equal(h.varbits.get(3711), 0, 'Rupert begins hidden in the tower');
});

test('the actual cache piano parent opens the widget and exposes the solved search', async () => {
  const path = require('node:path');
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
  RegionManager.loadMapFiles(PIANO_TILE.x, PIANO_TILE.y, false);
  const h = setup();
  h.quest.setStage(h.player, 4);
  const piano = MapObjects.get(24881, new core.Location(PIANO_TILE.x, PIANO_TILE.y, 0), null);
  assert.ok(piano, 'the placed piano is parent24881 at2907,9870');
  const cachePlayer = { getPacketSender: () => ({
    getVarbit: id => h.varbits.get(id) ?? 0,
    getVarp: id => h.configs.get(id) ?? 0,
  }) };
  let definition = core.ObjectDefinition.forPlayer(piano.getId(), cachePlayer);
  assert.equal(definition.id, O.PIANO_5);
  assert.equal(h.object(piano.getId(), { definition, location: piano.getLocation() }).handled, true);
  assert.equal(h.prompts.at(-1).interfaceId, 535);
  for (const child of [77, 78, 77, 76, 75, 73, 70, 72, 73]) h.playNote(child);
  definition = core.ObjectDefinition.forPlayer(piano.getId(), cachePlayer);
  assert.equal(definition.id, O.PIANO_6, 'only this player sees the searchable cache form');
  assert.equal(definition.getInteractions()[2], 'Search');
  assert.equal(h.object(piano.getId(), { definition, location: piano.getLocation(), clickType: 3 }).handled, true);
});

after(() => {
  runtime.startTranscript = originalStartTranscript;
});
