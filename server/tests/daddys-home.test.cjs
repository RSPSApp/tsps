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
let tasks = [];
let tick = 0;

function advance(ticks = 1) {
  for (let step = 0; step < ticks; step++) {
    tick++;
    for (const task of [...tasks]) if (task.isRunning()) task.tick();
  }
}

function finishBuild(player) {
  for (let step = 0; player.getSkill() && step < 100; step++) advance();
  assert.equal(player.getSkill(), null, "the build action finishes");
}

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
      sendSound: (id) => { player.sounds.push({ tick, id }); return sender; },
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
    animations: [],
    sounds: [],
    registered: true,
    hitpoints: 99,
    level: 99,
    skill: null,
    location: new api.core.Location(HOUSE.x, HOUSE.y, HOUSE.z),
    varbits,
    xp,
    lastDialogues: null,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => 'daddys-home-test',
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => player.registered,
    getHitpoints: () => player.hitpoints,
    getSkill: () => player.skill,
    setSkill: (skill) => { player.skill = skill; },
    getFrameUpdater: () => null,
    getInventory: () => player.inventory,
    getSkillManager: () => skillManager,
    getDialogueManager: () => ({
      startDialogues: (builder) => { player.lastDialogues = builder; },
      reset: () => {},
    }),
    performAnimation: (animation) => player.animations.push({ tick, id: animation.getId() }),
    getLocation: () => player.location,
  };
  const skillManager = {
    addExperiences: (skill, amount) => xp.push({ skill, amount, tick }),
    getExperience: () => 0,
    getCurrentLevel: () => player.level,
    startSkillable(action) {
      this.stopSkillable();
      if (action.hasRequirements(player)) { player.setSkill(action); action.start(player); }
    },
    stopSkillable() { player.getSkill()?.cancel(player); player.setSkill(null); },
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
  const nativeApi = PluginManager.createApi('DaddysHomeNativeDialogue');
  api = {
    core: {
      ...PluginManager.getCoreApi(),
      CountdownTask: class { constructor() {} },
      TaskManager: { submit(task) { if (task.setRunning) { task.setRunning(true); tasks.push(task); } } },
    },
    persistAttribute() {},
    onBeforeNpcInteraction: (handler) => {
      handlers.beforeNpc.push(handler);
      nativeApi.onBeforeNpcInteraction(handler);
    },
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
    onPlayerLogout: (handler) => handlers.logout.push(handler),
  };
  handlers = { beforeNpc: [], objects: [], login: [], logout: [], namedItems: new Map() };
  require('../plugins/quests/quests/DaddysHome.Quest')(api);
  quest = runtime.getRegisteredQuests().find((entry) => entry.name === "Daddy's Home");
  assert.ok(quest, "Daddy's Home registers");
  // The construction plugin answers this in production; the test grants it.
  customEvents.set('construction:grant-house', [(event) => { event.granted = true; }]);
});

function nativeYarlo(t, furniture, stage = 2) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const player = new Player(null, new api.core.Location(HOUSE.x, HOUSE.y, HOUSE.z));
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  player.setIndex(1);
  quest.setStage(player, stage);
  player.setAttribute('daddys-home:furniture', furniture.slice());
  const npc = api.core.NPC.create(api.core.NpcIdentifiers.OLD_MAN_YARLO, new api.core.Location(3240, 3395));
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const connection = new ClientConnection(channel);
  connection.player = player;
  const resume = async (group, childIndex = -1) => {
    const widgetId = childIndex > 0 ? api.core.OptionDialogue.OPTIONS_WIDGET_ID : (group << 16) | 5;
    await connection.dispatch([{ type: 'dialogue_continue', widgetId, childIndex }]);
    connection.processTurnPackets();
  };
  return {
    player,
    resume,
    talk() {
      assert.equal(PluginManager.emitNpcInteraction({ player, npc, npcId: npc.getId(), npcIndex: 2,
        clickType: 1, location: { x: 3240, y: 3395, z: 0 }, handled: false }), true);
    },
    async read() {
      const lines = [];
      for (let index = 0; index < 12; index++) {
        const current = player.getDialogueManager().getCurrent();
        if (!current || current instanceof api.core.OptionDialogue || current instanceof api.core.ActionDialogue) return lines;
        lines.push(current.getText());
        await resume(current instanceof api.core.PlayerDialogue ? 217 : 231);
      }
      assert.fail('Yarlo dialogue must end or reach its next choice');
    },
  };
}

test('native Yarlo partial-removal dialogue groups the remaining furniture with its room descriptions', async (t) => {
  const fixture = nativeYarlo(t, [1, 1, 1, 1, 1, 2, 1]);
  const expected = [
    "Ah, young man, how's the redecoration coming on?",
    "I've been removing the old furniture.",
    'You still need to remove: - A broken stool in the kitchen - A broken stool in the bedroom - A broken chair in the bedroom',
    '- A broken table in the kitchen - A broken table in the bedroom - The rotten carpet',
  ];
  for (let visit = 0; visit < 2; visit++) {
    fixture.talk();
    assert.deepEqual(await fixture.read(), expected);
    assert.equal(fixture.player.getDialogueManager().isActive(), false);
    assert.equal(quest.getStage(fixture.player), 2);
    assert.deepEqual(fixture.player.getAttribute('daddys-home:furniture'), [1, 1, 1, 1, 1, 2, 1]);
  }
});

test('native Yarlo lists just the final furniture and cancellation cannot advance the quest', async (t) => {
  const fixture = nativeYarlo(t, [2, 2, 2, 2, 2, 1, 1]);
  fixture.talk();
  await fixture.resume(231);
  fixture.player.getPacketSender().sendInterfaceRemoval();
  await fixture.resume(217);
  assert.equal(fixture.player.getDialogueManager().isActive(), false);
  assert.equal(quest.getStage(fixture.player), 2);
  fixture.talk();
  assert.deepEqual(await fixture.read(), [
    "Ah, young man, how's the redecoration coming on?",
    "I've been removing the old furniture.",
    'You still need to remove: - The old campbed - The rotten carpet',
  ]);
});

test('native Yarlo advances from all-removed furniture only after the briefing finishes', async (t) => {
  const fixture = nativeYarlo(t, [2, 2, 2, 2, 2, 2, 2], 3);
  fixture.talk();
  const lines = await fixture.read();
  assert.ok(lines.some((line) => line.includes("I've finished removing all the old furniture.")));
  assert.ok(fixture.player.getDialogueManager().getCurrent() instanceof api.core.OptionDialogue);
  assert.equal(quest.getStage(fixture.player), 3);
  const chooseSkip = async () => {
    await fixture.resume(api.core.OptionDialogue.OPTIONS_WIDGET_ID >>> 16, 2);
  };
  await chooseSkip();
  await fixture.resume(231); // Finish the skip response and begin the furniture briefing.
  fixture.player.getPacketSender().sendInterfaceRemoval();
  await fixture.resume(231);
  assert.equal(quest.getStage(fixture.player), 3, 'an abandoned briefing cannot unlock building');
  fixture.talk();
  await fixture.read();
  await chooseSkip();
  await fixture.read();
  assert.equal(quest.getStage(fixture.player), 5);
  assert.deepEqual(fixture.player.getAttribute('daddys-home:furniture'), [2, 2, 2, 2, 2, 2, 2]);
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
      finishBuild(player);
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
  player.level = 1;
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
    finishBuild(player);
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
    finishBuild(player);
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


test('table hammering is published before the captured four nail ticks and completion XP', () => {
  const player = createPlayer();
  player.setAttribute('daddys-home:furniture', [2, 2, 2, 2, 2, 2, 2]);
  quest.setStage(player, 5);
  for (const [id, amount] of [[HAMMER, 1], [SAW, 1], [PLANK, 3], [STEEL_NAILS, 4]]) give(player, id, amount);
  const start = tick;
  const random = Math.random;
  Math.random = () => 0.99;
  try {
    objectOption(player, TABLE_1, 'build');
    assert.equal(player.xp.length, 0, 'XP waits until the hammering has been synced');
    assert.equal(player.getAttribute('daddys-home:furniture')[3], 2);
    assert.deepEqual(player.animations.map(x => x.id), [3676]);
    advance(4);
    assert.equal(player.xp.length, 0);
    assert.equal(player.getInventory().getAmount(STEEL_NAILS), 0);
    assert.deepEqual(player.sounds.map(x => x.tick - start), [0, 2]);
    assert.deepEqual(player.animations.map(x => x.tick - start), [0, 1, 2, 3]);
    advance();
    assert.equal(player.varbits.get(10566), 3);
    assert.deepEqual(player.xp.map(x => ({ amount: x.amount, tick: x.tick - start })), [{ amount: 87, tick: 5 }]);
    assert.equal(player.getInventory().getAmount(PLANK), 0);
  } finally { Math.random = random; player.getSkillManager().stopSkillable(); }
});


function preparedBuilder(objectId = STOOL_1) {
  const player = createPlayer();
  player.setAttribute('daddys-home:furniture', [2, 2, 2, 2, 2, 2, 2]);
  quest.setStage(player, 5);
  for (const [id, amount] of [[HAMMER, 1], [SAW, 1], [PLANK, 10], [STEEL_NAILS, 100], [WAXWOOD_PLANK, 3], [BOLT, 5]]) give(player, id, amount);
  objectOption(player, objectId, 'build');
  return player;
}

test('nail bends extend the captured hammering sequence without spending the planks early', () => {
  const random = Math.random;
  let attempts = 0;
  Math.random = () => ++attempts <= 3 ? 0 : 0.99;
  const player = preparedBuilder(TABLE_1);
  player.level = 1;
  const start = tick;
  try {
    advance(7);
    assert.equal(player.xp.length, 0);
    assert.equal(player.getInventory().getAmount(STEEL_NAILS), 93);
    assert.equal(player.getInventory().getAmount(PLANK), 10);
    assert.deepEqual(player.sounds.map(x => x.tick - start), [0, 2, 4, 6]);
    advance();
    assert.equal(player.xp[0].amount, 87);
    assert.equal(player.getInventory().getAmount(PLANK), 7);
  } finally { Math.random = random; player.getSkillManager().stopSkillable(); }
});

test('bed and carpet present their captured animations and sound one tick before completion', () => {
  for (const [objectId, animation, xp] of [[BED, 3676, 207], [CARPET, 3683, 45]]) {
    const player = preparedBuilder(objectId);
    assert.equal(player.xp.length, 0);
    assert.equal(player.animations[0].id, animation);
    assert.equal(player.sounds[0].id, 938);
    advance();
    assert.equal(player.xp[0].amount, xp);
    assert.equal(player.getSkill(), null);
  }
});

test('duplicate and completed hotspot clicks cannot consume or award twice', () => {
  const random = Math.random; Math.random = () => 0.99;
  const player = preparedBuilder();
  try {
    const original = player.getSkill();
    objectOption(player, STOOL_1, 'build');
    assert.equal(player.getSkill(), original);
    finishBuild(player);
    objectOption(player, STOOL_1, 'build');
    advance(5);
    assert.deepEqual(player.xp.map(x => x.amount), [29]);
    assert.equal(player.getInventory().getAmount(PLANK), 9);
    assert.equal(player.getInventory().getAmount(STEEL_NAILS), 98);
  } finally { Math.random = random; }
});

test('walking, cancellation, lost tools/materials, death and logout abandon unfinished builds safely', () => {
  const random = Math.random; Math.random = () => 0.99;
  try {
    for (const mode of ['walk', 'cancel', 'tool', 'material', 'death', 'logout', 'unregistered', 'stale']) {
      const player = preparedBuilder();
      advance(); // one used nail; no whole-piece materials or XP have been committed
      if (mode === 'walk') player.location = player.location.transform(1, 0);
      if (mode === 'cancel') player.getSkillManager().stopSkillable();
      if (mode === 'tool') player.getInventory().deleteNumber(HAMMER, 1);
      if (mode === 'material') player.getInventory().deleteNumber(PLANK, 10);
      if (mode === 'death') player.hitpoints = 0;
      if (mode === 'logout') for (const handler of handlers.logout) handler({ player });
      if (mode === 'unregistered') player.registered = false;
      if (mode === 'stale') player.setAttribute('daddys-home:furniture', [3, 2, 2, 2, 2, 2, 2]);
      advance(5);
      assert.equal(player.getSkill(), null, mode);
      assert.equal(player.xp.length, 0, mode);
      assert.equal(player.getInventory().getAmount(STEEL_NAILS), 99, mode);
      assert.equal(player.getInventory().getAmount(PLANK), mode === 'material' ? 0 : 10, mode);
      if (mode !== 'stale') assert.equal(player.getAttribute('daddys-home:furniture')[0], 2, mode);
    }
  } finally { Math.random = random; }
});

test('native object arrival syncs hammering before later construction XP and level-up popup', async (t) => {
  const core = PluginManager.getCoreApi();
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  core.ObjectDefinition.init(); core.RegionManager.init(); core.RegionManager.loadMapFiles(HOUSE.x, HOUSE.y);
  require('../plugins/interface/SkillLevelUp.plugin').register(PluginManager.createApi('DaddyBuildLevelUp'));
  const nativeApi = PluginManager.createApi('DaddyBuildNative');
  require('../plugins/quests/quests/DaddysHome.Quest')(nativeApi);
  const views = [], sounds = [], frames = [];
  let player;
  nativeApi.onCustomEvent('player:sync-view', (event) => {
    if (event.player === player) views.push({ tick: core.World.getProcessCycle(), animation: event.view.animation?.id,
      xp: player.getSkillManager().getExperience(core.Skill.CONSTRUCTION) });
  });
  const channel = { kind: 'test', binaryTransport: true, remoteAddress: '127.0.0.1', isOpen: () => true,
    send: frame => { frames.push(Buffer.from(frame)); return true; }, close() {}, onData() {}, onClose() {}, onError() {} };
  const session = new PlayerSession(channel); player = new Player(session); session.setPlayer(player);
  player.setUsername('daddy-build-timing');
  assert.equal(core.World.getPlayers().add(player), true); player.setRegistered(true);
  t.after(() => { player.getSkillManager().stopSkillable(); player.setRegistered(false); core.World.getPlayers().remove(player); core.TaskManager.cancelTasks(player); });
  const random = Math.random; Math.random = () => 0.99; t.after(() => { Math.random = random; });
  player.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99).setCurrentLevels(core.Skill.HITPOINTS, 99);
  player.getSkillManager().setMaxLevels(core.Skill.CONSTRUCTION, 1).setCurrentLevels(core.Skill.CONSTRUCTION, 1);
  player.setAttribute('daddys-home:furniture', [2, 2, 2, 2, 2, 2, 2]); quest.setStage(player, 5);
  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  for (const [id, amount] of [[HAMMER, 1], [SAW, 1], [PLANK, 3], [STEEL_NAILS, 4]]) player.getInventory().adds(id, amount);
  const sender = player.getPacketSender(), sendSound = sender.sendSound;
  t.mock.method(sender, 'sendSound', function(id, ...args) { sounds.push({ tick: core.World.getProcessCycle(), id }); return sendSound.call(this, id, ...args); });
  const object = [...core.MapObjects.mapObjects.values()].flat().find(loc => loc.getId() === TABLE_1);
  assert.ok(object);
  player.setLocation(new core.Location(3236, 3392, 0)); player.setNeedsPlacement(false);
  session.flush(core.World.getProcessCycle()); session.flushPackets(); player.resetUpdating(); views.length = 0;
  const location = object.getLocation(), definition = core.ObjectDefinition.forPlayer(TABLE_1, player);
  assert.equal(definition.getInteractions()[0].toLowerCase(), 'build');
  const packet = Buffer.alloc(8); packet[0] = 96;
  packet[1] = (location.getX() & 255) + 128 & 255; packet[2] = location.getX() >>> 8;
  packet.writeUInt16LE(location.getY(), 3); packet[6] = definition.id >>> 8; packet[7] = (definition.id & 255) + 128 & 255;
  const connection = new ClientConnection(channel); connection.player = player;
  session.setTurnPacketProcessor(() => connection.processTurnPackets());
  connection.inject(decodeClientPackets(packet)); await connection.idle();
  for (let step = 0; step < 20; step++) { core.World.process(); session.flushPackets(); await Promise.resolve(); }
  const hammer = views.find(view => view.animation === 3676);
  assert.ok(hammer, 'real arrival/session sync publishes the build animation');
  assert.equal(hammer.xp, 0);
  const completion = views.find(view => view.xp === 87);
  assert.equal(completion.tick - hammer.tick, 5);
  assert.equal(completion.animation, 65535, 'the ordinary level-up popup still resets the finished animation');
  assert.equal(sender.isChatboxInterface(233), true);
  assert.deepEqual(sounds.filter(sound => sound.id === 938).map(sound => sound.tick - hammer.tick), [0, 2]);
  assert.equal(player.getInventory().getAmount(PLANK), 0);
  assert.equal(player.getInventory().getAmount(STEEL_NAILS), 0);
  assert.ok(frames.length > 0, 'the native binary channel was flushed');
});
