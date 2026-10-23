// Devious Minds (q022) source contracts.
// From server/: node --test tests/qh728-q022.test.cjs
//
// Most tests fixture-set a durable stage, inventory and quest completion flags,
// then dispatch a registered plugin handler and assert its observable effect.
// They prove handler/wire contracts, not a natural route. The stage-graph test
// walks every registered leg from fresh stage 0 to completion and asserts the
// varbit 1465 value each leg transmits.
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
const core = PluginManager.getCoreApi();

const STAGE_KEY = 'quest.devious_minds.stage';
const MAIN_VARBIT = 1465;
const ALTAR_VARBIT = 1466;
const MONK_VARBIT = 1467;
const MONK = core.NpcIdentifiers.MONK_14; // 4563, resolved from spawn 6222
const DEAD_MONK = core.NpcIdentifiers.COL_00FFFF_DEAD_MONK_COL; // 4564
const HIGH_PRIEST = core.NpcIdentifiers.HIGH_PRIEST; // 4062
const SIR_TIFFY = core.NpcIdentifiers.SIR_TIFFY_CASHIEN; // 4687

const transcripts = [];
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};

function setup(options = {}) {
  transcripts.length = 0;
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const itemOnItemHandlers = [];
  const itemOnObjectHandlers = [];
  const itemActions = [];
  const loginHandlers = [];
  const npcHandlers = [];
  const completed = new Set(options.completed ?? ['wanted', 'troll_stronghold', 'dorics_quest']);

  const api = new Proxy({
    core: { ...core, CountdownTask: undefined, TaskManager: undefined },
    persistAttribute() {},
    onNpcDialogueVariant(handler) { variants.push(handler); },
    onNpcDialogueCondition(handler) { conditions.push(handler); },
    onItemOnItem(handler) { itemOnItemHandlers.push(handler); },
    onItemOnObject(handler) { itemOnObjectHandlers.push(handler); },
    onItemAction(name, actions) { itemActions.push({ name, actions }); },
    onNpcInteraction(handler) { npcHandlers.push(handler); },
    onPlayerLogin(handler) { loginHandlers.push(handler); },
    onCustomEvent(name, handler) {
      const list = custom.get(name) ?? [];
      list.push(handler);
      custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      for (const handler of custom.get(name) ?? []) handler(event);
      if (name === 'quest:get-stage' && event?.stage === 0) {
        const registered = runtime.getRegisteredQuests().findLast((entry) => entry.key === event.key);
        if (registered) event.stage = registered.getStage(event.player);
      }
      if (name === 'quest:is-complete' && event && event.complete == null) {
        event.complete = completed.has(event.key);
      }
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });

  require('../plugins/quests/quests/DesertTreasureI.Quest')(api);
  const desertTreasure = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'desert_treasure_i');
  require('../plugins/quests/quests/DeviousMinds.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'devious_minds');

  const attributes = new Map();
  const items = new Map(options.items ?? []);
  const messages = [];
  const varbits = new Map();
  const varbitSends = [];
  let location = new core.Location(2853, 3349, 0);

  const sender = new Proxy({
    sendVarbit(id, value) {
      varbits.set(id, value);
      varbitSends.push([id, value]);
      return sender;
    },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds(id, amount = 1) {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) return false;
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber(id, amount = 1) {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    forceAdd(_player, item) { items.set(item.getId(), (items.get(item.getId()) ?? 0) + 1); },
    getFreeSlots: () => 28 - [...items.values()].filter((amount) => amount > 0).length,
    isFull: () => inventory.getFreeSlots() <= 0,
  };

  const skillLevels = options.skillLevels ?? {};
  const experience = [];
  const skillName = (skill) => Object.entries(core.Skill).find(([, value]) => value === skill)?.[0];
  const level = (skill) => skillLevels[skillName(skill)] ?? 99;
  const skills = {
    getMaxLevel: level,
    getCurrentLevel: level,
    addExperiences(skill, amount) { experience.push([skillName(skill), amount]); },
  };

  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ getAmount: () => 0, get: () => null }),
    getPacketSender: () => sender,
    getSkillManager: () => skills,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null }),
    getFrameUpdater: () => ({ clear() {} }),
    getLocation: () => location,
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getUsername: () => 'qh728-q022',
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
  };

  const at = (stage, inventoryItems = {}) => {
    attributes.set(STAGE_KEY, stage);
    for (const [id, amount] of Object.entries(inventoryItems)) items.set(Number(id), amount);
    varbits.clear();
    varbitSends.length = 0;
    messages.length = 0;
    experience.length = 0;
    return player;
  };
  const fire = (name, event) => {
    for (const handler of custom.get(name) ?? []) handler(event);
    return event;
  };
  const action = (stepId, extra = {}) => fire('npc-dialogue:action', { player, stepId, handled: false, ...extra });
  const hook = (hookName, npcId) =>
    fire('npc-dialogue:hook', { player, npcId, hook: hookName, handled: false });
  const variant = (npcId) => {
    for (const handler of variants) {
      const result = handler({ player, npcId });
      if (result) return result;
    }
    return null;
  };
  const condition = (npcId, stepId) => {
    for (const handler of conditions) {
      const result = handler({ player, npcId, stepId });
      if (typeof result === 'boolean') return result;
    }
    return null;
  };
  const itemOnItem = (usedItemId, usedWithItemId) => {
    const event = { player, usedItemId, usedWithItemId, handled: false };
    for (const handler of itemOnItemHandlers) handler(event);
    return event;
  };
  const itemOnObject = (objectId, itemId) => {
    const event = { player, objectId, itemId, handled: false };
    for (const handler of itemOnObjectHandlers) handler(event);
    return event;
  };
  const itemAction = (itemId, option) => {
    for (const { actions } of itemActions) {
      const handler = actions?.[option];
      if (typeof handler === 'function') {
        const event = { player, itemId, handled: false };
        const result = handler(event);
        if (result) return result;
      }
    }
    return false;
  };
  const searchDeadMonk = () => {
    const event = {
      player, npcId: DEAD_MONK, clickType: 2, handled: false,
      definition: { getActions: () => ['Talk-to', 'Search'] },
    };
    for (const handler of npcHandlers) handler(event);
    return event;
  };
  const login = () => {
    runtime.sendQuestVarps({ player });
    for (const handler of loginHandlers) handler({ player });
  };

  return {
    quest, desertTreasure, player, items, attributes, messages, varbits, varbitSends, experience, transcripts,
    at, action, hook, variant, condition, itemOnItem, itemOnObject, itemAction, searchDeadMonk,
    login, completed,
  };
}

function lastMainVarbit(h) {
  return [...h.varbitSends].reverse().find(([id]) => id === MAIN_VARBIT)?.[1];
}

test('fresh stage 0 start hook enters the quest wire at 10', () => {
  const h = setup();
  h.at(0, { [core.ItemIdentifiers.MITHRIL_2H_SWORD]: 1, [core.ItemIdentifiers.BOW_STRING]: 1 });
  h.hook('quest:devious-minds:start', MONK);
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(lastMainVarbit(h), 10);
});

test('start hook rejects a player without the quest prerequisites and sends no start', () => {
  const h = setup({ completed: [] });
  h.at(0);
  h.hook('quest:devious-minds:start', MONK);
  assert.equal(h.quest.getStage(h.player), 0);
  assert.equal(h.varbits.has(MAIN_VARBIT), false);
});

test('stage graph: every registered leg transmits the Quest Helper wire value and completes at 80', () => {
  const h = setup();
  const mithril = core.ItemIdentifiers.MITHRIL_2H_SWORD;
  const string = core.ItemIdentifiers.BOW_STRING;
  const slender = core.ItemIdentifiers.SLENDER_BLADE;
  const bowSword = core.ItemIdentifiers.BOW_SWORD;
  const orb = core.ItemIdentifiers.ORB;
  const largePouch = core.ItemIdentifiers.LARGE_POUCH;

  h.at(0, { [mithril]: 1, [string]: 1 });
  h.hook('quest:devious-minds:start', MONK);
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(lastMainVarbit(h), 10);

  h.action('wcQlqp'); // grind on Doric's whetstone
  assert.equal(h.quest.getStage(h.player), 2);
  assert.equal(h.items.get(mithril), 0);
  assert.equal(h.items.get(slender), 1);
  assert.equal(lastMainVarbit(h), 10);

  h.itemOnItem(slender, string); // string the slender blade
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.items.get(slender), 0);
  assert.equal(h.items.get(string), 0);
  assert.equal(h.items.get(bowSword), 1);
  assert.equal(lastMainVarbit(h), 10);

  h.action('5ln-VH'); // hand the bow-sword to the monk
  assert.equal(h.items.get(bowSword), 0);
  assert.equal(h.varbits.get(MAIN_VARBIT), 20);

  h.action('Iv_XNp'); // receive the delicate orb
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.items.get(orb), 1);
  assert.equal(lastMainVarbit(h), 30);

  h.items.set(largePouch, 1);
  h.itemOnItem(orb, largePouch); // hide the orb in a large pouch
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.items.get(orb), 0);
  assert.equal(h.items.get(largePouch), 0);
  assert.equal(h.items.get(core.ItemIdentifiers.LARGE_POUCH_3), 1);
  assert.equal(lastMainVarbit(h), 30);

  h.itemOnObject(10638, core.ItemIdentifiers.LARGE_POUCH_3); // place the pouch on Entrana's altar
  assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.items.get(core.ItemIdentifiers.LARGE_POUCH_3), 0);
  assert.equal(lastMainVarbit(h), 40);
  assert.equal(h.varbits.get(ALTAR_VARBIT), 1);
  assert.equal(h.varbits.get(MONK_VARBIT), 1);

  h.action('169WUP'); // last cutscene line
  assert.equal(h.varbits.get(ALTAR_VARBIT), 2);

  assert.equal(h.variant(HIGH_PRIEST), 'going-to-entrana-the-surprise');
  assert.equal(h.quest.getStage(h.player), 7);
  assert.equal(lastMainVarbit(h), 50);

  assert.equal(h.searchDeadMonk().handled, true);
  h.action('En9UIu'); // search the dead monk
  assert.equal(h.quest.getStage(h.player), 8);
  assert.equal(lastMainVarbit(h), 60);

  assert.equal(h.variant(HIGH_PRIEST), 'investigating-the-surprise-returning-to-the-high-priest-in-entrana');
  assert.equal(h.quest.getStage(h.player), 9);
  assert.equal(lastMainVarbit(h), 70);

  assert.equal(h.variant(SIR_TIFFY), 'wrapping-up-reporting-to-sir-tiffy');
  h.action('WqZYOq'); // completion action
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(lastMainVarbit(h), 80);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.deepEqual(h.experience, [['FLETCHING', 5000], ['RUNECRAFTING', 5000], ['SMITHING', 6500]]);
});

test('completion sends canonical wire 80, at or above the cache threshold', () => {
  const h = setup();
  h.at(9, {});
  h.action('WqZYOq');
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(lastMainVarbit(h), 80);
  assert.ok(lastMainVarbit(h) >= 80);
});

test('bow-sword hand-in resumes after logout before the orb receipt', () => {
  const h = setup();
  h.at(3, { [core.ItemIdentifiers.BOW_SWORD]: 1 });
  h.action('5ln-VH');
  assert.equal(h.items.get(core.ItemIdentifiers.BOW_SWORD), 0);
  assert.equal(lastMainVarbit(h), 20);

  h.login();
  assert.equal(lastMainVarbit(h), 20, 'the handed-in step survives login');
  assert.equal(h.variant(MONK), 'starting-off-bringing-the-monk-the-bow-sword');
  h.action('5ln-VH'); // the canonical replay action is safe after the item was consumed
  assert.equal(h.items.get(core.ItemIdentifiers.BOW_SWORD), 0);
  h.action('Iv_XNp');
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.items.get(core.ItemIdentifiers.ORB), 1);
});

test('emptying the orb pouch refuses at full inventory and succeeds on retry', () => {
  const h = setup();
  h.at(5, { [core.ItemIdentifiers.LARGE_POUCH_3]: 1 });
  for (let id = 500000; id < 500027; id++) h.items.set(id, 1);
  assert.equal(h.itemAction(core.ItemIdentifiers.LARGE_POUCH_3, 'Empty'), true);
  assert.equal(h.items.get(core.ItemIdentifiers.LARGE_POUCH_3), 1, 'full bag keeps the existing orb pouch');
  assert.equal(h.items.get(core.ItemIdentifiers.ORB) ?? 0, 0);
  assert.equal(h.items.get(core.ItemIdentifiers.LARGE_POUCH) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 5);

  h.items.delete(500000);
  h.itemAction(core.ItemIdentifiers.LARGE_POUCH_3, 'Empty');
  assert.equal(h.items.get(core.ItemIdentifiers.LARGE_POUCH_3) ?? 0, 0);
  assert.equal(h.items.get(core.ItemIdentifiers.ORB), 1);
  assert.equal(h.items.get(core.ItemIdentifiers.LARGE_POUCH), 1);
  assert.equal(h.quest.getStage(h.player), 4);
});

test('colossal orb pouch Check and Empty preserve the pouch form', () => {
  const h = setup();
  const orb = core.ItemIdentifiers.ORB;
  const basePouch = core.ItemIdentifiers.COLOSSAL_POUCH_3;
  const filledPouch = core.ItemIdentifiers.COLOSSAL_POUCH_5;
  h.at(4, { [orb]: 1, [basePouch]: 1 });
  h.itemOnItem(orb, basePouch);
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.items.get(filledPouch), 1);
  assert.equal(h.items.get(basePouch), 0);

  assert.equal(h.itemAction(filledPouch, 'Check'), true);
  assert.equal(transcripts.at(-1).variant,
    'starting-off-putting-the-orb-in-a-pouch-checking-the-orb-filled-large-pouch');
  assert.equal(h.itemAction(filledPouch, 'Empty'), true);
  assert.equal(h.items.get(filledPouch) ?? 0, 0);
  assert.equal(h.items.get(orb), 1);
  assert.equal(h.items.get(basePouch), 1, 'the original colossal pouch form is restored');
  assert.equal(h.quest.getStage(h.player), 4);
});

test('Entrana High Priest stage-window handoff preserves both quests in production order', () => {
  const h = setup();
  h.desertTreasure.setStage(h.player, 11);
  assert.equal(h.variant(HIGH_PRIEST), 'blood-diamond-talking-to-the-high-priest',
    'DT1 still owns the High Priest outside Devious Minds’ stage window');

  h.quest.setStage(h.player, 6);
  assert.equal(h.variant(HIGH_PRIEST), 'going-to-entrana-the-surprise');
  assert.equal(h.quest.getStage(h.player), 7, 'Devious Minds advances on its surprise conversation');

  h.quest.setStage(h.player, 8);
  assert.equal(h.variant(HIGH_PRIEST), 'investigating-the-surprise-returning-to-the-high-priest-in-entrana');
  assert.equal(h.quest.getStage(h.player), 9, 'Devious Minds advances on its report conversation');

  assert.equal(h.variant(HIGH_PRIEST), 'blood-diamond-talking-to-the-high-priest',
    'DT1 resumes ownership as soon as Devious Minds leaves its priest window');
});

test('login replay keeps durable stage 10 and re-sends wire 80', () => {
  const h = setup();
  h.at(10, {});
  h.login();
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.varbits.get(MAIN_VARBIT), 80);
  assert.equal(h.varbits.get(MONK_VARBIT), 1);
  assert.equal(h.varbits.get(ALTAR_VARBIT), 2);
});

test('login replay maps an older durable stage 5 save to wire 30 and altar 0', () => {
  const h = setup();
  h.at(5, {});
  h.login();
  assert.equal(h.varbits.get(MAIN_VARBIT), 30);
  assert.equal(h.varbits.get(MONK_VARBIT), 0);
  assert.equal(h.varbits.get(ALTAR_VARBIT), 0);
});

test('lost illuminated pouch: the monk gives a new orb and reopens the in-pouch leg', () => {
  const h = setup();
  const orb = core.ItemIdentifiers.ORB;
  const largePouch = core.ItemIdentifiers.LARGE_POUCH;
  h.at(5, {});
  assert.equal(h.variant(MONK), 'starting-off-talking-the-monk-after-receiving-the-orb');
  assert.equal(h.condition(MONK, 'rtLNjv'), true);
  h.action('Kb5na-');
  assert.equal(h.items.get(orb), 1);
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(lastMainVarbit(h), 30);
  h.items.set(largePouch, 1);
  h.itemOnItem(orb, largePouch);
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(lastMainVarbit(h), 30);
});

test('full inventory hand-in still receives the orb because the bow-sword frees a slot', () => {
  const h = setup();
  const bowSword = core.ItemIdentifiers.BOW_SWORD;
  h.at(3, {});
  const filler = 900000;
  for (let i = 0; i < 27; i++) h.items.set(filler + i, 1);
  h.items.set(bowSword, 1);
  assert.equal(h.player.getInventory().isFull(), true);
  h.action('5ln-VH');
  assert.equal(h.items.get(bowSword), 0);
  h.action('Iv_XNp');
  assert.equal(h.items.get(core.ItemIdentifiers.ORB), 1);
  assert.equal(h.quest.getStage(h.player), 4);
});

test('large-pouch Check/Empty remains on the quest item and restores the pouch leg', () => {
  const h = setup();
  const orbPouch = core.ItemIdentifiers.LARGE_POUCH_3;
  h.at(5, { [orbPouch]: 1 });
  assert.equal(h.itemAction(orbPouch, 'Check'), true);
  h.at(5, { [orbPouch]: 1 });
  assert.equal(h.itemAction(orbPouch, 'Empty'), true);
  assert.equal(h.items.get(core.ItemIdentifiers.ORB), 1);
  assert.equal(h.items.get(core.ItemIdentifiers.LARGE_POUCH), 1);
  assert.equal(h.quest.getStage(h.player), 4);
});

test('colossal pouch survives the altar cutscene and is not deleted', () => {
  const h = setup();
  const colossalOrbPouch = core.ItemIdentifiers.COLOSSAL_POUCH_5;
  h.at(5, { [colossalOrbPouch]: 1 });
  h.itemOnObject(10638, colossalOrbPouch);
  assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.items.get(colossalOrbPouch), 1);
  assert.equal(h.varbits.get(ALTAR_VARBIT), 1);
  assert.ok(h.messages.some((line) => line.includes('colossal pouch was so strong')));
});
