// Meat and Greet (q072) source-contract test. From server/:
//   node --test tests/qh728-q072.test.cjs
//
// The route test starts at fresh stage 0 and drives the plugin's registered
// dialogue/condition/action/hook/object handlers with the pinned Quest Helper
// route's own transcript ids. The recovery tests fixture-set a labelled durable
// stage and inventory, then dispatch the same registered handlers; they prove the
// handler contracts only, not a natural route. No live playthrough is claimed.
//
// Cache contract: quest 3712, varbit 11182, completion threshold 26 (script 4029
// reads DB table 0 column 19; script 4024 reads varbit 11182). This test asserts
// the plugin's completion dispatch sends 11182=26 and replays it on bootstrap.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const core = require(root + '/dist/plugins/PluginManager').PluginManager.getCoreApi();
const runtime = require(root + '/plugins/quests/QuestRuntime');
const noop = () => {};

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const QUEST_KEY = 'meat_and_greet';
const STAGE_VARBIT = 11182;
const TEST_KEBAB = I.TEST_KEBAB;
const LELIA_KEBAB = I.TEST_KEBAB_2;
const EMELIO = N.EMELIO;
const SPICE_MERCHANT = N.SPICE_MERCHANT;
const ALBA = N.ALBA;
const LELIA = N.LELIA;
const RENATA = N.RENATA;
const ALPHA = N.DIRE_WOLF_ALPHA;
const MINOTAUR = N.MINOTAUR_7;

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const xp = [];
  const jingles = [];
  const varbits = new Map();
  const configs = new Map();
  let full = false;
  let location = new core.Location(1753, 3074, 0);
  let area = null;

  const usedSlots = () => [...items.values()].filter((amount) => amount > 0).length;
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => inventory.getAmount(id) > 0,
    adds(id, amount = 1) {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        messages.push('Not enough space in your inventory.');
        return false;
      }
      items.set(id, inventory.getAmount(id) + amount);
      return true;
    },
    deleteNumber(id, amount = 1) {
      const left = inventory.getAmount(id) - amount;
      if (left > 0) items.set(id, left);
      else items.delete(id);
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - usedSlots()),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    getItems: () => [...items.entries()].filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendJingle(id) { jingles.push(id); return sender; },
  }, {
    get: (target, key) => (key in target ? target[key] : (...args) => { target[key]?.push?.(args); return sender; }),
  });

  const dialogue = { isActive: () => false, startDialogues: noop, handleResume: noop, reset: noop };
  const movement = { reset() { return movement; }, setBlockMovement: noop, addSteps: noop };

  const player = {
    attrs, items, messages, moves, xp, jingles, varbits, configs, inventory, area,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
      addExperience: (skill, amount) => xp.push([skill.getIndex(), amount]),
    }),
    getPacketSender: () => sender,
    getDialogueManager: () => dialogue,
    getLocation: () => location,
    moveTo: (next) => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    setPositionToFace: noop,
    performAnimation: noop,
    performGraphic: noop,
    getMovementQueue: () => movement,
    setUntargetable: noop,
    getArea: () => area,
    setArea: (next) => { area = next; },
    setFull(value) { full = value; },
    sendMessage: (message) => messages.push(message),
    setEnteredAmountAction(action) { this.enteredAmount = action; },
    getEnteredAmountAction() { return this.enteredAmount ?? null; },
    getIndex: () => 1,
    getUsername: () => 'qh728-q072',
    getAsPlayer() { return this; },
    isPlayer: () => true,
    isRegistered: () => true,
    isPlayerBot: () => false,
  };
  return player;
}

function harness(player) {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const interactions = new Map();
  const objects = new Map();
  const deaths = [];
  const logins = [];
  const logouts = [];
  const spawned = [];
  const transcripts = [];
  const spawnedByArea = new Map();

  const emit = (name, event) => {
    for (const handler of custom.get(name) ?? []) handler(event);
    return event;
  };

  class FakeBoundary { constructor(...args) { this.args = args; } }
  class FakePrivateArea {
    constructor(boundaries) { this.boundaries = boundaries; this.members = new Set(); this.destroyed = false; }
    enter(mobile) { this.members.add(mobile); mobile.setArea?.(this); }
    leave(mobile) { this.members.delete(mobile); mobile.setArea?.(null); if (!this.members.size) this.destroyed = true; }
    add() {}
    hasMember(mobile) { return this.members.has(mobile); }
    isDestroyed() { return this.destroyed; }
    getTemplateObjects() { return []; }
  }
  class FakeGameObject {
    constructor(id, location, type, rotation, area) {
      Object.assign(this, { id, location, type, rotation, area, opFlags: undefined });
    }
    getOpFlags() { return this.opFlags; }
  }
  class FakeCountdownTask { constructor(key, ticks, callback) { this.callback = callback; } }
  const TaskManager = { submit(task) { task.callback(); }, cancelTasks() {} };

  const coreApi = Object.create(core);
  Object.defineProperties(coreApi, {
    Boundary: { value: FakeBoundary },
    PrivateArea: { value: FakePrivateArea },
    GameObject: { value: FakeGameObject },
    CountdownTask: { value: FakeCountdownTask },
    TaskManager: { value: TaskManager },
  });

  const api = new Proxy({
    core: coreApi,
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onNpcInteraction: (name, actions) => interactions.set(name, actions),
    onObjectInteraction: (name, actions) => objects.set(name, actions),
    onNpcDeath: (handler) => deaths.push(handler),
    onCombatHitResolved: noop,
    onPlayerLogin: (handler) => logins.push(handler),
    onPlayerLogout: (handler) => logouts.push(handler),
    onInterfaceActionButton: noop,
    registerNpcCombatMethodProvider: noop,
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      // Prerequisite fixture: Children of the Sun is declared complete for the route.
      if (name === 'quest:is-complete' && event?.key === 'children_of_the_sun') event.complete = true;
      emit(name, event);
      return event;
    },
    spawnNpc(definition) {
      const npc = {
        definition,
        get area() { return spawnedByArea.get(npc); },
        set area(next) { spawnedByArea.set(npc, next); },
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x ?? 0, definition.y ?? 0, definition.z ?? 0),
        getArea: () => spawnedByArea.get(npc) ?? null,
        setArea: (next) => spawnedByArea.set(npc, next),
        getCombat: () => ({ attack: noop, reset: noop }),
        getMovementQueue: () => ({ addSteps: noop }),
        getHitpoints: () => 1,
        getMaxHitpoints: () => 1,
        forceChat: noop,
        setPositionToFace: noop,
        performAnimation: noop,
        performGraphic: noop,
        isNpc: () => true,
        isRegistered: () => true,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) {
      const index = spawned.indexOf(npc);
      if (index >= 0) spawned.splice(index, 1);
    },
  }, { get: (target, key) => (key in target ? target[key] : noop) });

  const originalStartTranscript = runtime.startTranscript;
  runtime.startTranscript = (_api, _player, npcId, page, variant) => {
    transcripts.push({ npcId, page, variant });
    return true;
  };
  require(root + '/plugins/quests/quests/MeatAndGreet.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === QUEST_KEY);
  assert.ok(quest, 'Meat and Greet registered');

  const h = {
    api, core: coreApi, quest, player, emitted: emit, variants, conditions, interactions, objects,
    deaths, logins, logouts, spawned, transcripts, custom,
    variant(npcId) {
      for (const handler of variants) {
        const result = handler({ player, npcId, npc: { getLocation: () => player.getLocation() } });
        if (result !== null && result !== undefined) return result;
      }
      return null;
    },
    condition(npcId, stepId) {
      for (const handler of conditions) {
        const answer = handler({ player, npcId, stepId });
        if (answer !== null && answer !== undefined) return answer;
      }
      return null;
    },
    line(npcId, text, step) {
      const event = { player, npcId, text, step };
      emit('npc-dialogue:line', event);
      event.before?.();
      event.after?.();
      return event;
    },
    action(npcId, stepId, extra = {}) {
      const event = { player, npcId, stepId, ...extra };
      emit('npc-dialogue:action', event);
      return event;
    },
    hook(npcId, hook) { return emit('npc-dialogue:hook', { player, npcId, hook }); },
    talk(name, npcId = null) {
      const actions = interactions.get(name);
      assert.ok(actions?.['Talk-to'], `no Talk-to handler for ${name}`);
      return actions['Talk-to']({ player, npcId: npcId ?? actions.npcId, npc: { getLocation: () => player.getLocation() } });
    },
    object(name, option, extra = {}) {
      const actions = objects.get(name);
      assert.ok(actions?.[option], `no ${option} handler for ${name}`);
      return actions[option]({ player, ...extra });
    },
    death(npc) { for (const handler of deaths) handler({ player, npc }); },
    restore() { runtime.startTranscript = originalStartTranscript; },
  };
  return h;
}

function route() {
  const player = makePlayer();
  const h = harness(player);
  return { h, player };
}

test('cache completion contract: varbit 11182, threshold 26', () => {
  const { h, player } = route();
  try {
    assert.equal(h.quest.varbitId, STAGE_VARBIT);
    assert.equal(h.quest.completionValue, 26);
    h.quest.setStage(player, 26);
    assert.equal(player.varbits.get(STAGE_VARBIT), 26);
  } finally {
    h.restore();
  }
});

test('an interrupted spice-box unlock resumes the canonical delivery line on retalk', () => {
  const { h, player } = route();
  try {
    h.hook(EMELIO, 'quest:meat-and-greet:start');
    h.line(EMELIO, "Okay, I guess I can go see where they've got to.");
    h.line(SPICE_MERCHANT, 'Sure thing!');
    h.action(SPICE_MERCHANT, 'gRONbi');
    player.enteredAmount.execute(2546);
    assert.equal(player.varbits.get(11183), 3, 'unlocked, before the merchant sends the spices');

    // Simulate leaving the scene before the merchant speaks, then use the real Talk-to handler.
    h.transcripts.length = 0;
    h.talk('Spice Merchant', SPICE_MERCHANT);
    const resumed = h.transcripts.at(-1);
    assert.equal(resumed.variant, 'searching-for-spices-unlocking-the-box');
    const steps = require('../data/definitions/npc-dialogues.json')['Meat and Greet'].variants[resumed.variant];
    const deliveryLine = steps.map(step => step.text ?? step.npc).find(text => text?.startsWith('Kuani!'));
    assert.ok(deliveryLine, 'the selected imported transcript actually contains the delivery receipt');
    h.line(SPICE_MERCHANT, deliveryLine);
    assert.equal(player.varbits.get(11183), 4);
    assert.equal(h.variant(SPICE_MERCHANT), 'searching-for-spices-talking-to-the-spice-merchant-after-unlocking-the-box');
  } finally {
    h.restore();
  }
});

test('full mandatory Quest Helper route dispatches stage 0 to 26', () => {
  const { h, player } = route();
  try {
    const stage = () => h.quest.getStage(player);
    assert.equal(stage(), 0);
    assert.equal(h.variant(EMELIO), 'starting-out-talking-to-emelio');

    // Starting is gated on Children of the Sun; the fixture marks that prerequisite.
    h.hook(EMELIO, 'quest:meat-and-greet:start');
    assert.equal(stage(), 2);
    assert.equal(player.varbits.get(STAGE_VARBIT), 2);

    // 2 -> 4: Emelio asks for both deliveries.
    h.line(EMELIO, 'Okay, I guess I can go see where they\'ve got to.');
    assert.equal(stage(), 4);
    assert.equal(h.variant(SPICE_MERCHANT), 'searching-for-spices');

    // 4: spice box (code 2546) then the merchant sends the spices.
    h.line(SPICE_MERCHANT, 'Sure thing!');
    h.action(SPICE_MERCHANT, 'gRONbi');
    assert.ok(player.enteredAmount, 'keypad amount action was installed');
    player.enteredAmount.execute(2546);
    assert.equal(h.transcripts.at(-1).variant, 'searching-for-spices-unlocking-the-box');
    h.line(SPICE_MERCHANT, 'Kuani! You did it! I\'ll have these sent over to Emelio right away. Thanks for the help.');
    assert.equal(stage(), 4, 'spice alone does not move the quest');

    // 4: Alba, the wolf den and the alpha.
    assert.equal(h.variant(ALBA), 'browsing-for-buffalo-meat-talking-to-alba');
    h.line(ALBA, 'Okay, I\'ll head over there and deal with this wolf.');
    assert.equal(h.variant(ALBA), 'browsing-for-buffalo-meat-talking-to-alba-talking-to-alba-again');
    assert.equal(h.object('Wolf Den', 'Enter'), true);
    const alpha = h.spawned.find((npc) => npc.getId() === ALPHA);
    assert.ok(alpha, 'alpha spawned in the private den');
    h.death(alpha);
    assert.equal(h.variant(ALBA), 'browsing-for-buffalo-meat-talking-to-alba-after-killing-the-dire-wolf-alpha');
    assert.equal(h.object('Cave', 'Exit'), true);
    h.line(ALBA, 'Kuani! Thank you so much for the help, iknami. While you were gone, I was able to get Emelio\'s order finished. It\'s on the way to him now.');
    assert.equal(stage(), 6, 'both deliveries set stage 6');

    // 6 -> 8: recipe task.
    assert.equal(h.variant(EMELIO), 'making-the-ultimate-kebab-talking-to-emelio');
    h.line(EMELIO, 'Head on out there and have a chat with them to see if you can work out the perfect ratio of meat, salad, spice and sauce.');
    assert.equal(stage(), 8);

    // 8: set 4/2/1/3, receive a test kebab, have a connoisseur taste it.
    assert.equal(h.variant(EMELIO), 'making-the-ultimate-kebab-talking-to-emelio-again');
    h.action(EMELIO, 'mag:first-recipe');
    h.action(EMELIO, 'mag:set:meat:4');
    h.action(EMELIO, 'mag:set:salad:2');
    h.action(EMELIO, 'mag:set:spice:1');
    h.action(EMELIO, 'mag:set:sauce:3');
    h.action(EMELIO, 'sw-3DW');
    h.action(EMELIO, '7WnuHP');
    assert.equal(player.inventory.getAmount(TEST_KEBAB), 1);
    assert.equal(h.variant(RENATA), 'making-the-ultimate-kebab-getting-the-connoisseurs-to-taste-test-the-current-test-kebab');
    h.action(RENATA, 'Zu920h');
    assert.equal(player.inventory.getAmount(TEST_KEBAB), 0);
    assert.equal(stage(), 10);

    // 10 -> 12 -> 14: marketing and the two Lelia kebabs.
    h.line(EMELIO, 'You must visit Lelia at the Colosseum at once. Take her a sample of our fine kebabs, and she will beg us to let her help sell them to the people of Varlamore!');
    assert.equal(stage(), 12);
    h.action(EMELIO, 'NUZMwQ');
    h.action(EMELIO, '_LMMpb');
    assert.equal(stage(), 14);
    assert.equal(player.inventory.getAmount(LELIA_KEBAB), 2);

    // 14 -> 16 -> 18: Lelia eats one, then the advert is ready.
    assert.equal(h.variant(LELIA), 'guerilla-marketing');
    h.action(LELIA, 'rFr1Qu');
    assert.equal(stage(), 16);
    assert.equal(player.inventory.getAmount(LELIA_KEBAB), 1);
    h.line(LELIA, 'Yup. Next contest starts soon and we don\'t have another slot for weeks.');
    assert.equal(stage(), 18);

    // 18 -> 20: start the advert/fight.
    h.action(LELIA, '8544ms');
    h.line(LELIA, 'Oh boy...');
    assert.equal(stage(), 20);
    assert.equal(player.inventory.getAmount(LELIA_KEBAB), 0);

    // 20 -> 22: the minotaur dies.
    const minotaur = h.spawned.find((npc) => npc.getId() === MINOTAUR);
    assert.ok(minotaur, 'fighting minotaur spawned');
    h.death(minotaur);
    assert.equal(stage(), 22);

    // 22 must still talk to Lelia; Emelio does not hand in at 22.
    h.line(EMELIO, 'Right...');
    assert.equal(stage(), 22, 'stage 22 hand-in is not accepted');
    assert.equal(h.quest.getStage(player), 22);
    assert.equal(h.variant(LELIA), 'guerilla-marketing-talking-to-lelia-after-killing-the-minotaur');
    h.line(LELIA, 'Now, I need to get things ready for the next slot. Why don\'t you go and tell Emelio about the good impression his kebabs made.');
    assert.equal(stage(), 24);

    // 24 -> 26: final hand-in, reward and completion wire value.
    assert.equal(h.variant(EMELIO), 'wrapping-up');
    h.line(EMELIO, 'Right...');
    assert.equal(stage(), 26);
    assert.equal(h.quest.isComplete(player), true);
    assert.equal(player.varbits.get(STAGE_VARBIT), 26);
    assert.deepEqual(player.xp, [[core.Skill.COOKING.getIndex(), 8000]]);
    assert.equal(player.attrs.get(runtime.QUEST_POINTS_ATTRIBUTE), 1);
    assert.ok(player.messages.some((message) => message.includes('Meat and Greet')));
  } finally {
    h.restore();
  }
});

test('login/bootstrap replay sends the durable stage and sibling varbits', () => {
  const { h, player } = route();
  try {
    assert.equal(h.quest.getStage(player), 0);
    runtime.sendQuestVarps({ player });
    assert.equal(player.varbits.get(STAGE_VARBIT), 0);

    h.quest.setStage(player, 26);
    player.varbits.clear();
    runtime.sendQuestVarps({ player });
    assert.equal(player.varbits.get(STAGE_VARBIT), 26);

    // syncVars mirrors the delivery/recipe varbits on bootstrap without clobbering stage.
    player.varbits.clear();
    h.emitted('player:bootstrap-complete', { player });
    for (const id of [11183, 11184, 11185, 11186, 11187, 11188, 11189]) {
      assert.ok(player.varbits.has(id), `bootstrap sent varbit ${id}`);
    }
    assert.equal(h.quest.getStage(player), 26);
  } finally {
    h.restore();
  }
});

test('recovery: lost kebabs restock, and returning to Lelia at 16 reaches the fight', () => {
  const { h, player } = route();
  try {
    // Fixture: durable stage 14 with no Lelia kebab (labelled, not a natural route).
    h.quest.setStage(player, 14);
    h.action(LELIA, 'rFr1Qu');
    assert.equal(h.quest.getStage(player), 14, 'no kebab is eaten when none is held');

    // Emelio's restock variant is selected and gives two kebabs before Lelia ate.
    assert.equal(h.variant(EMELIO), 'making-the-ultimate-kebab-talking-to-emelio-after-receiving-the-two-test-kebabs');
    h.action(EMELIO, 'O43OKz');
    assert.equal(player.inventory.getAmount(LELIA_KEBAB), 2);

    // Lelia eats one; losing the other then routes back to Emelio for one replacement.
    h.action(LELIA, 'rFr1Qu');
    assert.equal(h.quest.getStage(player), 16);
    player.items.delete(LELIA_KEBAB);
    assert.equal(h.variant(EMELIO), 'making-the-ultimate-kebab-talking-to-emelio-after-receiving-the-two-test-kebabs');
    h.action(EMELIO, 'O43OKz');
    assert.equal(player.inventory.getAmount(LELIA_KEBAB), 1);

    // Stage 16's short ready-check variant has no "Yup..." line; agreeing still
    // marks the advert ready and reaches the fight.
    assert.equal(h.variant(LELIA), 'guerilla-marketing-talking-to-leila-after-being-told-to-market-the-kebab');
    h.action(LELIA, '8544ms');
    assert.equal(h.quest.getStage(player), 18);
    h.line(LELIA, 'Oh boy...');
    assert.equal(h.quest.getStage(player), 20);
    assert.equal(player.inventory.getAmount(LELIA_KEBAB), 0);
  } finally {
    h.restore();
  }
});

test('transcript conditions answer from inventory and recipe state', () => {
  const { h, player } = route();
  try {
    assert.equal(h.condition(EMELIO, 'VVK8P_'), false);
    assert.equal(h.condition(EMELIO, 'PNqiJZ'), true);
    player.setFull(true);
    assert.equal(h.condition(EMELIO, 'VVK8P_'), true);
    assert.equal(h.condition(EMELIO, 'PNqiJZ'), false);
    assert.equal(h.condition(EMELIO, '3_tkee'), true);
    assert.equal(h.condition(EMELIO, 'r0O40y'), false);
    player.setFull(false);

    assert.equal(h.condition(EMELIO, 'xP8rLp'), true);
    assert.equal(h.condition(EMELIO, 'yUPGB0'), false);
    player.items.set(TEST_KEBAB, 1);
    assert.equal(h.condition(EMELIO, 'xP8rLp'), false);
    assert.equal(h.condition(EMELIO, 'yUPGB0'), true);
    player.items.delete(TEST_KEBAB);

    assert.equal(h.condition(EMELIO, 'V-2FC1'), false);
    assert.equal(h.condition(EMELIO, 'cL9ltx'), true);
    assert.equal(h.condition(EMELIO, 'iOngTK'), false);
    player.items.set(LELIA_KEBAB, 1);
    assert.equal(h.condition(EMELIO, 'V-2FC1'), true);
    player.items.set(LELIA_KEBAB, 2);
    assert.equal(h.condition(EMELIO, 'iOngTK'), true);

    // Recipe conditions are quest-local state, not the wire.
    assert.equal(h.condition(RENATA, 'qy1Uj2'), false);
    assert.equal(h.condition(RENATA, 'nfs5Ro'), true);
    for (const [name, count] of [['meat', 4], ['salad', 2], ['spice', 1], ['sauce', 3]]) {
      h.action(EMELIO, `mag:set:${name}:${count}`);
    }
    assert.equal(h.condition(RENATA, 'qy1Uj2'), true);
    assert.equal(h.condition(RENATA, 'nfs5Ro'), false);
  } finally {
    h.restore();
  }
});
