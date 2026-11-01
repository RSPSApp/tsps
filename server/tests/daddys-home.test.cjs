// Run after `yarn build`: node --test tests/daddys-home.test.cjs
//
// Focused regression for the Daddy's Home miniquest. It dispatches the plugin's real
// hooks (object options, NPC Talk-to, crate search, item Open) and asserts the durable
// stage, furniture varbits, materials, XP and one-shot rewards.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Item } = require('../dist/game/model/Item');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const runtime = require('../plugins/quests/QuestRuntime');

const PLANK = ItemIdentifiers.PLANK;
const BOLT = ItemIdentifiers.BOLT_OF_CLOTH;
const STEEL_NAILS = ItemIdentifiers.STEEL_NAILS;
const HAMMER = ItemIdentifiers.HAMMER;
const SAW = ItemIdentifiers.SAW;
const WAXWOOD_LOG = 24938;
const WAXWOOD_PLANK = 24939;
const MARLOS_CRATE = 24940;
const PLANKS_NEEDED = 10;

const STOOL_1 = 40300;
const STOOL_2 = 40301;
const CHAIR = 40302;
const TABLE_1 = 40223;
const TABLE_2 = 40224;
const BED = 40303;
const CARPET = 40304;
const CRATE = 40214;
const HOUSE = { x: 3241, y: 3395, z: 0 };

let quest;
let handlers;
let customEvents;
let api;

function createPlayer() {
  const attributes = new Map();
  const messages = [];
  const varbits = new Map();
  const xp = [];
  const sender = new Proxy(
    {
      getVarbit: (id) => varbits.get(id) ?? 0,
      sendVarbit: (id, value) => {
        varbits.set(id, value);
        return sender;
      },
      sendConfig: () => sender,
      sendJingle: () => sender,
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        return () => sender;
      },
    },
  );
  const player = {
    attributes,
    messages,
    varbits,
    xp,
    lastDialogues: null,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => 'daddys-home-test',
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    getFrameUpdater: () => null,
    getInventory: () => player.inventory,
    getSkillManager: () => ({
      addExperiences: (skill, amount) => xp.push({ skill, amount }),
      getExperience: () => 0,
      getCurrentLevel: () => 99,
    }),
    getDialogueManager: () => ({
      startDialogues: (builder) => { player.lastDialogues = builder; },
      reset: () => {},
    }),
    performAnimation: () => {},
    getLocation: () => HOUSE,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  return player;
}

function runAction(player) {
  const entries = [...player.lastDialogues.getDialogues().values()];
  const action = entries.find((entry) => entry instanceof api.core.ActionDialogue);
  assert.ok(action, 'dialogue should end in an action');
  action.send(player);
}

function runOption(player, option) {
  const entries = [...player.lastDialogues.getDialogues().values()];
  const menu = entries.find((entry) => entry instanceof api.core.OptionDialogue);
  assert.ok(menu, 'dialogue should end in an option menu');
  menu.execute(option);
}

function talkTo(player, npcId, actions = ['Talk-to']) {
  const event = {
    player,
    npc: { getId: () => npcId },
    npcId,
    clickType: 1,
    definition: { getActions: () => actions, getName: () => 'npc' },
    location: { ...HOUSE },
    handled: false,
  };
  for (const handler of handlers.beforeNpc) {
    if (event.handled) break;
    handler(event);
  }
  return event;
}

function objectOption(player, objectId, option) {
  const event = { player, objectId, option, location: { ...HOUSE }, handled: false };
  for (const handler of handlers.objects) {
    if (event.handled) break;
    handler(event);
  }
  return event;
}

function give(player, itemId, amount = 1) {
  player.getInventory().adds(itemId, amount);
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  customEvents = new Map();
  api = {
    core: {
      ...PluginManager.getCoreApi(),
      CountdownTask: class { constructor() {} },
      TaskManager: { submit() {} },
    },
    persistAttribute() {},
    onBeforeNpcInteraction: (handler) => handlers.beforeNpc.push(handler),
    onObjectInteraction: (handler) => handlers.objects.push(handler),
    onItemAction: (name, actions) => {
      if (typeof name === 'function') handlers.objects.push(name);
      else handlers.namedItems.set(name, actions);
    },
    onPlayerLogin: (handler) => handlers.login.push(handler),
    onCustomEvent: (name, handler) => {
      const list = customEvents.get(name) ?? [];
      list.push(handler);
      customEvents.set(name, list);
    },
    emitCustomEvent: (name, event) => {
      for (const handler of customEvents.get(name) ?? []) handler(event);
    },
    // QuestRuntime widget wiring.
    onInterfaceActionButton() {},
    onPlayerLevelUp() {},
    onPlayerLogout() {},
  };
  handlers = { beforeNpc: [], objects: [], login: [], namedItems: new Map() };
  require('../plugins/quests/quests/DaddysHome.Quest')(api);
  quest = runtime.getRegisteredQuests().find((entry) => entry.name === "Daddy's Home");
  assert.ok(quest, "Daddy's Home registers");
  // The construction plugin answers this in production; the test grants it.
  customEvents.set('construction:grant-house', [(event) => { event.granted = true; }]);
});

test('Marlo starts the miniquest on the Wiki dialogue route', () => {
  const player = createPlayer();
  const event = talkTo(player, api.core.NpcIdentifiers.MARLO);
  assert.equal(event.handled, true);
  runAction(player);
  runOption(player, 1); // What kind of favour...
  runAction(player);
  runOption(player, 3); // Tell me more about the job.
  runAction(player);
  runOption(player, 3); // Tell me where he lives...
  runAction(player);
  assert.equal(quest.getStage(player), 1);
  assert.match(player.messages.at(-1), /started a new miniquest/);
});

test('removing all seven furnishings sets the stage and the transform bits', () => {
  const player = createPlayer();
  quest.setStage(player, 2);
  const pieces = [STOOL_1, STOOL_2, CHAIR, TABLE_1, TABLE_2, BED, CARPET];
  for (const [index, objectId] of pieces.entries()) {
    const option = index === 5 || index === 6 ? 'remove' : 'demolish';
    const event = objectOption(player, objectId, option);
    assert.equal(event.handled, true, `piece ${index} handles ${option}`);
    assert.equal(player.varbits.get(10563 + index), 2, `piece ${index} becomes a hotspot`);
  }
  assert.equal(quest.getStage(player), 3, 'all removed advances to the talk-to-Yarlo stage');
});

test('Yarlo briefing unlocks building, crate search and waxwood conversion', () => {
  const player = createPlayer();
  player.setAttribute('daddys-home:furniture', [2, 2, 2, 2, 2, 2, 2]);
  quest.setStage(player, 3);

  talkTo(player, api.core.NpcIdentifiers.OLD_MAN_YARLO);
  runAction(player); // after-removal lines
  runOption(player, 2); // skip the lecture
  runAction(player); // his reaction
  runAction(player); // furniture description
  assert.equal(quest.getStage(player), 5);

  const crate = objectOption(player, CRATE, 'search');
  assert.equal(crate.handled, true);
  assert.equal(player.getInventory().getAmount(WAXWOOD_LOG), 3);

  give(player, HAMMER);
  give(player, SAW);
  const sawmill = talkTo(player, api.core.NpcIdentifiers.SAWMILL_OPERATOR, ['Talk-to', null, 'Buy-plank', 'Trade']);
  assert.equal(sawmill.handled, true);
  runAction(player);
  runOption(player, 1); // I need some waxwood planks...
  runAction(player);
  assert.equal(player.getInventory().getAmount(WAXWOOD_LOG), 0);
  assert.equal(player.getInventory().getAmount(WAXWOOD_PLANK), 3);
});

test('building all seven pieces consumes the Wiki materials and pays 542 XP', () => {
  const player = createPlayer();
  player.setAttribute('daddys-home:furniture', [2, 2, 2, 2, 2, 2, 2]);
  quest.setStage(player, 5);
  give(player, PLANK, PLANKS_NEEDED);
  give(player, BOLT, 5);
  give(player, STEEL_NAILS, 16);
  give(player, WAXWOOD_PLANK, 3);
  give(player, HAMMER);
  give(player, SAW);

  const builds = [
    [STOOL_1, 1, 2],
    [STOOL_2, 1, 2],
    [CHAIR, 2, 2],
    [TABLE_1, 3, 4],
    [TABLE_2, 3, 4],
    [CARPET, 0, 0],
    [BED, 3, 0],
  ];
  const originalRandom = Math.random;
  Math.random = () => 0.99; // no bends for this material-count check
  try {
    for (const [objectId] of builds) {
      const event = objectOption(player, objectId, 'build');
      assert.equal(event.handled, true);
    }
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(player.getInventory().getAmount(PLANK), 0, 'all 10 planks used');
  assert.equal(player.getInventory().getAmount(BOLT), 0, 'all 5 bolts of cloth used');
  assert.equal(player.getInventory().getAmount(STEEL_NAILS), 2, '14 of 16 nails used');
  assert.equal(player.getInventory().getAmount(WAXWOOD_PLANK), 0, 'all 3 waxwood planks used');
  assert.deepEqual(player.xp.map((entry) => entry.amount), [29, 29, 58, 87, 87, 45, 207]);
  assert.equal(player.xp.reduce((sum, entry) => sum + entry.amount, 0), 542);
  assert.equal(quest.getStage(player), 9, 'all built advances to the talk-to-Yarlo stage');
});

test('bent nails are consumed and reported before the piece is built', () => {
  const player = createPlayer();
  player.getSkillManager = () => ({
    addExperiences: (skill, amount) => player.xp.push({ skill, amount }),
    getExperience: () => 0,
    getCurrentLevel: () => 1,
  });
  player.setAttribute('daddys-home:furniture', [2, 2, 2, 2, 2, 2, 2]);
  quest.setStage(player, 5);
  give(player, PLANK, 1);
  give(player, STEEL_NAILS, 4);
  give(player, HAMMER);
  give(player, SAW);

  const originalRandom = Math.random;
  Math.random = () => 0; // every nail bends
  try {
    objectOption(player, STOOL_1, 'build');
    assert.equal(quest.getStage(player), 5, 'the build did not complete');
    assert.equal(player.getInventory().getAmount(STEEL_NAILS), 0, 'bent nails are consumed');
    assert.equal(player.getInventory().getAmount(PLANK), 1, 'planks are not spent on a failed build');
    assert.ok(player.messages.includes('You accidentally bend a nail.'));
    assert.ok(player.messages.includes('You need more nails to finish that.'));
  } finally {
    Math.random = originalRandom;
  }

  give(player, STEEL_NAILS, 2);
  Math.random = () => 0.99;
  try {
    objectOption(player, STOOL_1, 'build');
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(player.varbits.get(10563), 3);
  assert.equal(player.getInventory().getAmount(PLANK), 0);
});

test('building is refused without tools or materials', () => {
  const player = createPlayer();
  player.setAttribute('daddys-home:furniture', [2, 2, 2, 2, 2, 2, 2]);
  quest.setStage(player, 5);
  objectOption(player, STOOL_1, 'build');
  assert.match(player.messages.at(-1), /hammer and a saw/);

  give(player, HAMMER);
  give(player, SAW);
  objectOption(player, STOOL_1, 'build');
  assert.match(player.messages.at(-1), /1 plank/);
});

test('completion pays 400 XP, grants one crate and only once', () => {
  const player = createPlayer();
  quest.setStage(player, 10);
  talkTo(player, api.core.NpcIdentifiers.MARLO);
  runAction(player);
  runOption(player, 1); // yeah, what have you got for me?
  runAction(player);

  assert.equal(quest.getStage(player), 13);
  assert.equal(player.getInventory().getAmount(MARLOS_CRATE), 1);
  assert.deepEqual(player.xp.filter((entry) => entry.amount === 400).length, 1);

  quest.complete(player);
  assert.equal(player.getInventory().getAmount(MARLOS_CRATE), 1, 'repeat completion is a no-op');
  assert.deepEqual(player.xp.filter((entry) => entry.amount === 400).length, 1);
});

test("Marlo's crate opens into the Wiki contents", () => {
  const player = createPlayer();
  const crate = new Item(MARLOS_CRATE, 1);
  player.getInventory().add(crate, false);
  const slot = player.getInventory().getItems().findIndex((item) => item?.getId?.() === MARLOS_CRATE);
  const held = player.getInventory().get(slot);
  const handled = handlers.namedItems.get("Marlo's crate").Open({ player, item: held, itemId: MARLOS_CRATE, slot });
  assert.equal(handled, true);
  assert.equal(player.getAttribute('daddys-home:crate-opened'), 1);
  assert.equal(player.getInventory().getAmount(MARLOS_CRATE), 0);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.PLANK_2), 25);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.MITHRIL_NAILS), 50);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.STEEL_BAR_2), 5);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.OAK_PLANK_2), 10);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.BOLT_OF_CLOTH_2), 8);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.TELEPORT_TO_HOUSE), 5);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.FALADOR_TELEPORT), 1);
});

test('a full-bag completion, replacement and two crates pay the reward only once', () => {
  const player = createPlayer();
  const dropped = [];
  const originalRegisters = ItemOnGroundManager.registers;
  ItemOnGroundManager.registers = (_player, item) => {
    dropped.push(item.clone());
    return null;
  };
  try {
    quest.setStage(player, 10);
    give(player, ItemIdentifiers.SHARK, 28); // full inventory
    quest.complete(player);
    const groundCrates = dropped.filter((item) => item.getId() === MARLOS_CRATE);
    assert.equal(groundCrates.length, 1, 'the completion crate is forced to the ground');

    // Free one slot and ask Marlo before picking up the original.
    player.getInventory().deleteNumber(ItemIdentifiers.SHARK, 1);
    const replacement = talkTo(player, api.core.NpcIdentifiers.MARLO);
    assert.equal(replacement.handled, true);
    runAction(player);
    assert.equal(player.getInventory().getAmount(MARLOS_CRATE), 1, 'Marlo hands out a replacement');

    // Collect the original too: two physical crates now exist.
    player.getInventory().deleteNumber(ItemIdentifiers.SHARK, 1);
    player.getInventory().add(groundCrates[0], false);
    assert.equal(player.getInventory().getAmount(MARLOS_CRATE), 2);

    // Two crates at once, both opened through the real item handler.
    player.getInventory().deleteNumber(ItemIdentifiers.SHARK, 6);
    for (let index = 0; index < 2; index++) {
      const slot = player.getInventory().getItems().findIndex((item) => item?.getId?.() === MARLOS_CRATE);
      assert.ok(slot >= 0, `crate ${index + 1} is still present`);
      const item = player.getInventory().get(slot);
      const handled = handlers.namedItems.get("Marlo's crate").Open({
        player, item, itemId: MARLOS_CRATE, slot,
      });
      assert.equal(handled, true);
    }

    assert.equal(player.getInventory().getAmount(MARLOS_CRATE), 0, 'both crates are consumed');
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.PLANK_2), 25);
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.MITHRIL_NAILS), 50);
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.STEEL_BAR_2), 5);
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.OAK_PLANK_2), 10);
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.BOLT_OF_CLOTH_2), 8);
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.TELEPORT_TO_HOUSE), 5);
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.FALADOR_TELEPORT), 1);
    assert.equal(player.getAttribute('daddys-home:crate-opened'), 1);
  } finally {
    ItemOnGroundManager.registers = originalRegisters;
  }
});

test('login resends every furniture bit from the saved state', () => {
  const player = createPlayer();
  player.setAttribute('daddys-home:furniture', [2, 3, 2, 3, 2, 2, 3]);
  quest.setStage(player, 6);
  for (const handler of handlers.login) handler({ player });
  assert.deepEqual(
    [10563, 10564, 10565, 10566, 10567, 10568, 10569].map((id) => player.varbits.get(id)),
    [2, 3, 2, 3, 2, 2, 3],
  );
});

test('a player who already owns a house is paid 1,000 coins', () => {
  const player = createPlayer();
  const previous = customEvents.get('construction:grant-house');
  customEvents.set('construction:grant-house', [(event) => { event.granted = false; }]);
  try {
    quest.setStage(player, 10);
    quest.complete(player);
  } finally {
    customEvents.set('construction:grant-house', previous);
  }
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 1000);
  assert.equal(player.getInventory().getAmount(MARLOS_CRATE), 1);
});

test('Marlo replaces a lost unopened crate, but not one already opened', () => {
  const lost = createPlayer();
  quest.setStage(lost, 13);
  const replaced = talkTo(lost, api.core.NpcIdentifiers.MARLO);
  assert.equal(replaced.handled, true);
  runAction(lost);
  assert.equal(lost.getInventory().getAmount(MARLOS_CRATE), 1);

  const opened = createPlayer();
  quest.setStage(opened, 13);
  opened.setAttribute('daddys-home:crate-opened', 1);
  const refused = talkTo(opened, api.core.NpcIdentifiers.MARLO);
  assert.equal(refused.handled, false);
});
