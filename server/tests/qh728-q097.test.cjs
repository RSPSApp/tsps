// From server/: node --test tests/qh728-q097.test.cjs
// QH q097 The Ribbiting Tale of a Lily Pad Labour Dispute.
// These are registered-handler contract tests, not a live playthrough: each leg
// fixtures the durable stage the previous leg leaves, then dispatches the hook
// the plugin registered for that dialogue/object edge and asserts the effect.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require(root + '/dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const runtime = require(root + '/plugins/quests/QuestRuntime');
const noop = () => {};

const HISTORY = 'the_ribbiting_tale_of_a_lily_pad_labour_dispute';
const STAGE = 'quest.' + HISTORY + '.stage';
const VARBIT = 9844;
const PATCH_VARBIT = 9845;
const PATCH_ATTR = 'ribbiting-tale:patch-unlocked';
const LOVE_LETTER = 28986;
const PLUSHY = 28987;
const BRONZE_AXE = 1351;
const CUTHBERT_COMBAT = 12957;
const MARCELLUS = 13401;
const GARY = 13402;
const DAVE = 13403;
const SUE = 13404;
const JANE = 13405;
const CHEST = 50895;
const ORANGE_TREE = 52977;
const LILY_PAD = 50891;

const transcriptCalls = [];
const originalStartTranscript = runtime.startTranscript;
before(() => {
  runtime.startTranscript = (api, player, npcId, page, variant, select) => {
    transcriptCalls.push({ player, npcId, page, variant });
    return true;
  };
});

function harness() {
  const hooks = new Map();
  const h = { hooks, objects: [], variants: [], conditions: [], items: [], deaths: [], logins: [], logouts: [],
    spawned: [], removed: [], tasks: [] };
  const taskManager = {
    submit(task) { task.setRunning?.(true); h.tasks.push(task); return task; },
    cancelTasks(key) { for (const task of h.tasks) if (task.key === key) task.stop(); },
  };
  const base = {
    core: { ...core, TaskManager: taskManager },
    persistAttribute: noop,
    onObjectClick(ids, clickType, handler) { h.objects.push({ ids: Array.isArray(ids) ? ids : [ids], clickType, handler }); },
    onNpcDialogueVariant(handler) { h.variants.push(handler); },
    onNpcDialogueCondition(handler) { h.conditions.push(handler); },
    onItemAction(handler) { h.items.push(handler); },
    onNpcDeath(handler) { h.deaths.push(handler); },
    onPlayerLogin(handler) { h.logins.push(handler); },
    onPlayerLogout(handler) { h.logouts.push(handler); },
    onCustomEvent(name, handler) {
      if (!hooks.has(name)) hooks.set(name, []);
      hooks.get(name).push(handler);
    },
    emitCustomEvent(name, event) { for (const handler of hooks.get(name) ?? []) handler(event); },
    spawnNpc(definition) {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getIndex: () => 9000 + h.spawned.length,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z ?? 0),
        getOwner: () => definition.owner,
        getArea: () => definition.area ?? null,
        setArea: () => {},
        isPlayer: () => false,
        isNpc: () => true,
        getAsNpc: () => npc,
        isRegistered: () => true,
        setPositionToFace: noop,
        performAnimation: noop,
        exactMove: noop,
        forceChat: noop,
        getCombat: () => ({ attack: noop }),
      };
      h.spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { h.removed.push(npc); },
  };
  const api = new Proxy(base, { get: (target, key) => target[key] ?? noop });
  require(root + '/plugins/quests/quests/RibbitingTale.Quest')(api);
  const quest = runtime.getRegisteredQuests().filter((row) => row.key === HISTORY).at(-1);
  // A faithful Children of the Sun completion answer for meetsRequirements().
  if (!hooks.has('quest:is-complete')) hooks.set('quest:is-complete', []);
  hooks.get('quest:is-complete').push((request) => {
    if (request?.key === 'children_of_the_sun') request.complete = request.player.attrs.get('test:cot-sun') === true;
  });
  return { ...h, api, quest };
}

function makePlayer({ stage = 0, items = [], woodcutting = 15, cotSun = true, version = 1 } = {}) {
  const attrs = new Map([
    [STAGE, stage],
    ['ribbiting-tale:stage-version', version],
    ['test:cot-sun', cotSun],
  ]);
  const inventory = new Map(items);
  const sent = [];
  const messages = [];
  const p = {
    attrs, inventory, messages, sent,
    inventoryFull: false,
    xp: [],
    enteredCode: null,
    location: new core.Location(1685, 2975, 0),
    area: null,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      adds: (id, amount) => { inventory.set(id, (inventory.get(id) ?? 0) + amount); return true; },
      deleteNumber: (id, amount) => inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount)),
      isFull: () => p.inventoryFull,
      getFreeSlots: () => p.inventoryFull ? 0 : 28,
    }),
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => skill === core.Skill.WOODCUTTING ? woodcutting : 99,
      addExperiences: (skill, amount) => p.xp.push([skill.getIndex(), amount]),
    }),
    getLocation: () => p.location,
    moveTo: (to) => { p.location = to; },
    getArea: () => p.area,
    setArea: (area) => { p.area = area; },
    getIndex: () => 1,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => p,
    setUntargetable: noop,
    setEnteredAmountAction(action) { p.enteredCode = action; },
    performAnimation: noop,
    getPrivateArea: () => null,
    getMovementQueue: () => {
      const queue = { reset: () => queue, setBlockMovement: () => queue };
      return queue;
    },
    getDialogueManager: () => ({
      startDialogues: noop, reset: noop, advance: noop, getCurrent: () => null,
    }),
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
  };
  const sender = new Proxy({}, {
    get: (_target, key) => (...args) => { sent.push([String(key), ...args]); return sender; },
  });
  return p;
}

function fire(h, name, event) {
  for (const handler of h.hooks.get(name) ?? []) handler(event);
}
function line(h, player, npcId, text) {
  const event = { player, npcId, text, step: {} };
  fire(h, 'npc-dialogue:line', event);
  event.before?.();
  event.after?.();
  return event;
}
function action(h, player, npcId, stepId, extra = {}) {
  const event = { player, npcId, stepId, step: {}, kind: 'action', handled: false, ...extra };
  fire(h, 'npc-dialogue:action', event);
  return event;
}
function message(h, player, npcId, stepId) {
  const event = { player, npcId, stepId, step: {}, kind: 'message', handled: false };
  fire(h, 'npc-dialogue:action', event);
  return event;
}
function objectClick(h, player, objectId, location = player.location) {
  const event = { player, objectId, clickType: 1, location, handled: false };
  for (const entry of h.objects) {
    if (entry.clickType !== 1 || !entry.ids.includes(objectId)) continue;
    entry.handler(event);
    if (event.handled) break;
  }
  return event;
}
function tick(h, count) {
  for (let i = 0; i < count; i++) {
    for (const task of [...h.tasks]) if (task.isRunning()) task.tick();
  }
}

test('cache contract: quest DB 3515 reads varbit 9844 and completes at 32', () => {
  const h = harness();
  assert.equal(h.quest.varbitId, VARBIT);
  assert.equal(h.quest.varpId, 4152);
  assert.equal(h.quest.startedValue, 2);
  assert.equal(h.quest.completionValue, 32);
  const player = makePlayer({ stage: 32 });
  h.quest.setStage(player, 32);
  assert.ok(player.sent.some(([name, id, value]) => name === 'sendVarbit' && id === VARBIT && value === 32));
});

test('fresh stage 0 requires Woodcutting 15 and Children of the Sun before the start line advances', () => {
  const h = harness();
  const select = h.variants[0];
  const weak = makePlayer({ woodcutting: 14 });
  assert.equal(select({ player: weak, npcId: MARCELLUS }),
    'crazy-frogs-talking-to-marcellus-without-the-requirements-to-start');

  const unfinished = makePlayer({ cotSun: false });
  fire(h, 'npc-dialogue:hook', { player: unfinished, npcId: MARCELLUS, hook: 'quest:the-ribbiting-tale-of-a-lily-pad-labour-dispute:start' });
  line(h, unfinished, MARCELLUS, "Okay then... Well provided that doesn't happen, I'll be back shortly to let you know what I've found.");
  assert.equal(unfinished.attrs.get(STAGE), 0, 'unmet quest prerequisite must not start the quest');

  const ready = makePlayer();
  assert.equal(select({ player: ready, npcId: MARCELLUS }), 'crazy-frogs-talking-to-marcellus');
  fire(h, 'npc-dialogue:hook', { player: ready, npcId: MARCELLUS, hook: 'quest:the-ribbiting-tale-of-a-lily-pad-labour-dispute:start' });
  line(h, ready, MARCELLUS, "Okay then... Well provided that doesn't happen, I'll be back shortly to let you know what I've found.");
  assert.equal(ready.attrs.get(STAGE), 2);
  assert.ok(ready.sent.some(([name, id, value]) => name === 'sendVarbit' && id === VARBIT && value === 2));
});

test('mandatory handler stage graph: stage 0 to the cache completion value 32', () => {
  const h = harness();
  const player = makePlayer({ items: [[BRONZE_AXE, 1]] });
  const hook = 'quest:the-ribbiting-tale-of-a-lily-pad-labour-dispute:start';

  // Start.
  assert.equal(h.variants[0]({ player, npcId: MARCELLUS }), 'crazy-frogs-talking-to-marcellus');
  fire(h, 'npc-dialogue:hook', { player, npcId: MARCELLUS, hook });
  line(h, player, MARCELLUS, "Okay then... Well provided that doesn't happen, I'll be back shortly to let you know what I've found.");
  assert.equal(player.attrs.get(STAGE), 2);

  // 2 -> 4: blue frogs agree to ask Marcellus for terms.
  line(h, player, SUE, "Okay, I'll be back shortly.");
  assert.equal(player.attrs.get(STAGE), 4);

  // 4 -> 6: Marcellus will only talk to the frogs' leader.
  line(h, player, MARCELLUS, "Every day I find myself further questioning my life choices. Fine. I'll go and ask them about their leader.");
  assert.equal(player.attrs.get(STAGE), 6);

  // 6 -> 8: frogs explain the election and the lily pad plan.
  line(h, player, GARY, "Okay... I guess I'm off to sabotage a lily pad.");
  assert.equal(player.attrs.get(STAGE), 8);

  // 8 -> 10: Dave/Jane mention the orange tree.
  line(h, player, JANE, 'Hmm...');
  assert.equal(player.attrs.get(STAGE), 10);

  // 10 -> 12: chop the orange tree (real object hook, then its 4-tick action).
  objectClick(h, player, ORANGE_TREE, new core.Location(1695, 2980, 0));
  tick(h, 4);
  assert.equal(player.attrs.get(STAGE), 12);

  // 12 -> 14: sabotage the lily pad (real object hook, then its 4-tick action).
  objectClick(h, player, LILY_PAD, new core.Location(1692, 2983, 0));
  tick(h, 4);
  assert.equal(player.attrs.get(STAGE), 14);

  // 14 -> 16: start the hop-off, then the cutscene-end action advances the stage.
  line(h, player, SUE, "Let's!");
  tick(h, 6);
  assert.equal(player.attrs.get(STAGE), 14, 'the hop cutscene does not advance until it ends');
  action(h, player, MARCELLUS, 'OnL648');
  assert.equal(player.attrs.get(STAGE), 16);
  tick(h, 6);

  // 16 -> 18: Sue gives the peace terms.
  line(h, player, GARY, "Actually, never mind. Let's not complicate things further. I'll take these terms to him and see what he says.");
  assert.equal(player.attrs.get(STAGE), 18);

  // 18 -> 20: Marcellus demands proof.
  line(h, player, MARCELLUS, "Maybe my whole life is just one big nightmare. Fine, I'll find this proof.");
  assert.equal(player.attrs.get(STAGE), 20);

  // 20 -> 22: Sue suggests framing the flies.
  line(h, player, SUE, 'Fine.');
  assert.equal(player.attrs.get(STAGE), 22);

  // 22 -> 24: unlock the chest with the captured NALIA combination.
  objectClick(h, player, CHEST, new core.Location(1676, 2974, 0));
  assert.ok(player.enteredCode, 'the chest hook opens the combination input');
  player.enteredCode.execute(334490);
  assert.equal(player.attrs.get(STAGE), 24);
  tick(h, 3);

  // The unlock transcript hands out the plushy.
  message(h, player, MARCELLUS, '5F55jc');
  assert.equal(player.inventory.get(PLUSHY), 1);

  // 24 -> 26: plant the plushy in the dung; Cuthbert attacks.
  message(h, player, CUTHBERT_COMBAT, '6_EtxY');
  assert.equal(player.attrs.get(STAGE), 26);
  assert.equal(player.inventory.get(PLUSHY), 0);
  const cuthbert = h.spawned.find((npc) => npc.id === CUTHBERT_COMBAT);
  assert.ok(cuthbert, 'Cuthbert is spawned by the planting message');

  // 26 -> 28: defeat Cuthbert through the registered onNpcDeath handler.
  for (const handler of h.deaths) handler({ npcId: CUTHBERT_COMBAT, npc: cuthbert, killer: player });
  assert.equal(player.attrs.get(STAGE), 28);

  // 28 -> 30: Marcellus accepts the terms.
  line(h, player, MARCELLUS, 'Return to the frogs. Tell them we have a deal.');
  assert.equal(player.attrs.get(STAGE), 30);

  // 30 -> 32: the canonical cache completion floor, with reward.
  line(h, player, SUE, "Oh don't be so negative. You've done a good thing, [player name]! Now go. Go with the blessing of the frogs, and know that you really are a true hero!");
  assert.equal(player.attrs.get(STAGE), 32);
  assert.ok(player.sent.some(([name, id, value]) => name === 'sendVarbit' && id === VARBIT && value === 32));
  assert.deepEqual(player.xp, [[core.Skill.WOODCUTTING.getIndex(), 2000]]);
  assert.equal(player.attrs.get('quest.points'), 1);
});

test('completion unlocks the hardwood patch once, and a completed save repairs the flag on login', () => {
  const h = harness();
  const player = makePlayer({ stage: 30, items: [[BRONZE_AXE, 1]] });
  line(h, player, SUE, 'know that you really are a true hero!');
  assert.equal(player.attrs.get(STAGE), 32);
  assert.equal(player.attrs.get(PATCH_ATTR), true);
  assert.ok(player.sent.some(([name, id, value]) => name === 'sendVarbit' && id === PATCH_VARBIT && value === 1));
  assert.equal(player.xp.length, 1);

  // A repeat hand-in cannot pay twice (stage already at completion).
  line(h, player, SUE, 'know that you really are a true hero!');
  assert.equal(player.xp.length, 1);

  // Older completed saves have stage 32 but never wrote the patch attribute.
  const old = makePlayer({ stage: 32, version: 1 });
  for (const handler of h.logins) handler({ player: old, key: HISTORY });
  assert.equal(old.attrs.get(PATCH_ATTR), true);
  assert.ok(old.sent.some(([name, id, value]) => name === 'sendVarbit' && id === PATCH_VARBIT && value === 1));

  runtime.sendQuestVarps({ player: old });
  assert.ok(old.sent.some(([name, id, value]) => name === 'sendVarbit' && id === VARBIT && value === 32),
    'login/bootstrap resends the durable stage as varbit 9844=32');
});

test('bed and chest prose conditions use inventory state, not a duplicated item', () => {
  const h = harness();
  const condition = h.conditions[0];
  const player = makePlayer({ stage: 22, items: [[LOVE_LETTER, 1]] });
  assert.equal(condition({ player, npcId: MARCELLUS, stepId: 'GN3nQt' }), true);
  player.inventory.delete(LOVE_LETTER);
  assert.equal(condition({ player, npcId: MARCELLUS, stepId: 'GN3nQt' }), false);
  player.inventoryFull = true;
  assert.equal(condition({ player, npcId: MARCELLUS, stepId: 'WUQXah' }), true);
  assert.equal(condition({ player, npcId: MARCELLUS, stepId: '_ZWnSn' }), true);
  assert.equal(condition({ player, npcId: MARCELLUS, stepId: 'H_pAp7' }), true);
  player.inventory.set(PLUSHY, 1);
  assert.equal(condition({ player, npcId: MARCELLUS, stepId: '17ktkp' }), true);
});

test('a full bag at the chest code keeps the steal stage and gives no plushy', () => {
  const h = harness();
  const player = makePlayer({ stage: 22 });
  player.inventoryFull = true;
  objectClick(h, player, CHEST, new core.Location(1676, 2974, 0));
  player.enteredCode.execute(334490);
  assert.equal(player.attrs.get(STAGE), 22);
  assert.equal(player.inventory.get(PLUSHY) ?? 0, 0);
  assert.ok(player.messages.some((text) => text.includes('inventory space')));
});

test('yellow frog variant uses the transform parent id for Jane', () => {
  const h = harness();
  const select = h.variants[0];
  const player = makePlayer({ stage: 12 });
  assert.equal(select({ player, npcId: JANE }), 'democracy-at-work-after-chopping-down-the-orange-tree');
  assert.equal(select({ player, npcId: DAVE }),
    'democracy-at-work-after-chopping-down-the-orange-tree-talking-to-dave-or-jane-after-chopping-down-the-orange-tree');
});
