// Observatory Quest (q084) source-contract regression.
// From server/: node --test tests/qh728-q084.test.cjs
//
// Fixture-driven handler graph: starting stage/inventory is set and the registered
// handlers are dispatched directly. This is not a live playthrough.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const originalStartTranscript = runtime.startTranscript;

const core = PluginManager.getCoreApi();
before(async () => {
  await CachePipeline.initialize(process.cwd());
  RegionManager.init();
  new NpcDefinitionLoader().load();
  core.ObjectDefinition.init();
});
const transcripts = [];
runtime.startTranscript = (api, player, npcId, page, variant) => {
  transcripts.push({ npcId, page, variant });
  return true;
};
const register = require('../plugins/quests/quests/ObservatoryQuest.Quest');

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const O = core.ObjectIdentifiers;
const PAGE = 'Observatory Quest';
const VARP = 112;
const STACKABLE = new Set([I.WATER_RUNE, I.LAW_RUNE, I.TUNA]);
const CONSTELLATION = 'quest.observatory_quest.constellation';
const VIEWED = 'quest.observatory_quest.viewed';
const CHEST_CHOICE = 'observatory-quest:chest-choice';
const CUTSCENE_SEEN = 'observatory-quest:cutscene-seen';
const STAR_SIGN = 3828;
const HAND_OVER = 6291;
const GUARD_WAKES = 6827;
const SIGN_ORDER = ['Aquarius', 'Capricorn', 'Sagittarius', 'Scorpio', 'Libra', 'Virgo', 'Leo', 'Cancer', 'Gemini', 'Taurus', 'Aries', 'Pisces'];

/** Plays a dialogue chain the fixture captured: each entry sends, then the next on its continue. */
function runChain(h, chain) {
  for (const entry of chain.getDialogues().values()) entry.send(h.player);
}

function setup({ realWire = false, realTranscript = false } = {}) {
  transcripts.length = 0;
  const attributes = new Map();
  const bankItems = new Map();
  let wire;
  const items = new Map();
  const varbits = new Map();
  const messages = [];
  const ground = [];
  const xp = [];
  const transforms = [];
  const animations = [];
  const modals = [];
  const overheads = [];
  const dialogues = [];
  const spawned = [];
  const locs = [];
  let location = new core.Location(2442, 3186, 0);
  let freeSlots = 28;

  const slotsFor = (id, amount) =>
    items.has(id) && STACKABLE.has(id) ? 0 : STACKABLE.has(id) ? 1 : amount;

  function addItem(id, amount) {
    const needed = slotsFor(id, amount);
    if (needed > freeSlots) return false;
    freeSlots -= needed;
    items.set(id, (items.get(id) ?? 0) + amount);
    return true;
  }
  function deleteItem(id, amount) {
    const held = items.get(id) ?? 0;
    const removed = Math.min(held, amount);
    if (removed <= 0) return;
    const next = held - removed;
    if (next <= 0) {
      items.delete(id);
      freeSlots += STACKABLE.has(id) ? 1 : removed;
    } else {
      items.set(id, next);
      if (!STACKABLE.has(id)) freeSlots += removed;
    }
  }

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds: (id, amount) => addItem(id, amount),
    deleteNumber: deleteItem,
    isFull: () => freeSlots <= 0,
    getFreeSlots: () => freeSlots,
    forceAdd(player, item) {
      const id = item.getId?.() ?? item.id;
      const amount = item.getAmount?.() ?? item.amount;
      if (freeSlots <= 0 && !(items.has(id) && STACKABLE.has(id))) {
        ground.push({ id, amount });
        return;
      }
      addItem(id, amount);
    },
  };

  const sender = new Proxy({
    sendVarbit(id, value) { wire?.sendVarbit(id, value); varbits.set(id, value); return sender; },
    sendConfig(id, value) { wire?.sendConfig(id, value); varbits.set(id, value); return sender; },
    getVarbit(id) { return wire ? wire.getVarbit(id) : varbits.get(id) ?? 0; },
    getVarp(id) { return wire ? wire.getVarp(id) : varbits.get(id) ?? 0; },
    sendInterfaceRemoval() { player.manager?.reset();player.prompt = null;return sender; },
    // Recorded only: the fixture player lacks what the real sender's modal bookkeeping reads.
    sendInterfaceScript(id, args) { modals.push(['script', id, ...(args ?? [])]); return sender; },
    sendInterface(id) { modals.push(['open', id]); return sender; },
  }, { get(target, prop) { return prop in target ? target[prop] : () => sender; } });

  const player = {
    getUsername: () => 'qh728-q084', getDisplayName: () => 'qh728-q084',
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventory,
    getBanks: () => [null, { getAmount: id => bankItems.get(id) ?? 0 }, null],
    getSession: () => ({ sendClientPacket() {} }),
    getPacketSender: () => sender,
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      getCombatLevel: () => 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getLocation: () => location,
    moveTo(value) { location = new core.Location(value.getX(), value.getY(), value.getZ()); },
    getPrivateArea: () => null,
    isRegistered: () => true,
    isPlayer: () => true,
    sendMessage(message) { messages.push(message); },
    performAnimation(animation) { animations.push(animation.getId()); },
    forceChat(text) { overheads.push(text); },
    getMovementQueue: () => movement,
    getDialogueManager: () => player.manager ?? { startDialogues(chain) { dialogues.push(chain); } },
  };
  const movement = { reset() { return movement; }, setBlockMovement() { return movement; } };

  if (realWire) wire = new PacketSender(player);
  if (realTranscript) { player.manager = new DialogueManager(player);player.getDialogueManager = () => player.manager; }
  const custom = new Map();
  const variantHooks = [];
  const conditionHooks = [];
  const objectFns = [];
  const itemOnItemFns = [];
  const npcHooks = new Map();
  const loginHooks = [];
  const deathHooks = [];
  const npcDeathHooks = [];
  const buttonHooks = [];

  const coreForPlugin = {
    ...core,
    ObjectManager: {
      deregister(object) { locs.push({ removed: object.getId() }); },
      register(object) { locs.push({ added: object.getId() }); },
    },
    MapObjects: { get: () => null },
  };
  const api = new Proxy({
    core: coreForPlugin,
    persistAttribute() {},
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, pairs, options: pairs.filter((_,index) => index % 2 === 0) }; return true; },
    onCustomEvent(name, fn) {
      if (!custom.has(name)) custom.set(name, []);
      custom.get(name).push(fn);
    },
    emitCustomEvent(name, event) {
      for (const fn of custom.get(name) ?? []) fn(event);
    },
    onNpcDialogueVariant(fn) { variantHooks.push(fn); },
    onNpcDialogueCondition(fn) { conditionHooks.push(fn); },
    onObjectInteraction(first, second) {
      if (typeof first === 'function') objectFns.push(first);
      else if (typeof first === 'string' && second) {
        for (const [option, fn] of Object.entries(second)) objectFns.push((event) => {
          const text = event.definition?.getInteractions?.()?.[event.clickType - 1];
          if (text === option) return fn(event);
        });
      }
    },
    onItemOnItem(fn) { itemOnItemFns.push(fn); },
    onNpcInteraction(first, second) {
      if (typeof first === 'string') npcHooks.set(first, second);
    },
    onPlayerLogin(fn) { loginHooks.push(fn); },
    onPlayerDefeated(fn) { deathHooks.push(fn); },
    onNpcDeath(fn) { npcDeathHooks.push(fn); },
    onInterfaceActionClick(fn) { buttonHooks.push(fn); },
    spawnNpc(definition) {
      const at = new core.Location(definition.x, definition.y, definition.z ?? 0);
      const guard = {
        id: definition.id, registered: true, chats: [], attacked: [], at,
        getId: () => definition.id, getLocation: () => guard.at, isRegistered: () => guard.registered,
        getHitpoints: () => 43, isDyingFunction: () => false, setPositionToFace() {},
        forceChat(text) { guard.chats.push(text); },
        getCombat: () => ({ attack(target) { guard.attacked.push(target); }, getTarget: () => null, getAttacker: () => null }),
      };
      spawned.push(guard);
      return guard;
    },
    removeNpc(npc) { npc.registered = false; },
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => undefined;
    },
  });

  const saved = runtime.startTranscript;
  if (realTranscript) runtime.startTranscript = originalStartTranscript;
  try { register(api); } finally { runtime.startTranscript = saved; }
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'observatory_quest');

  const variant = (npcId) => {
    for (const fn of variantHooks) {
      const result = fn({ player, npcId, definition: { getId: () => npcId }, pages: [{ page: PAGE }] });
      if (result) return typeof result === 'string' ? result : result.variant;
    }
    return null;
  };
  const condition = (text, npcId = N.OBSERVATORY_PROFESSOR) => {
    for (const fn of conditionHooks) {
      const result = fn({ player, npcId, text, definition: { getId: () => npcId } });
      if (result !== null && result !== undefined) return result;
    }
    return null;
  };
  const action = (stepId, npcId = N.OBSERVATORY_PROFESSOR, kind = 'action') => {
    const event = { player, npcId, stepId, kind, definition: { getId: () => npcId }, text: '', handled: false };
    api.emitCustomEvent('npc-dialogue:action', event);
    return event;
  };
  const hook = (name, npcId = N.OBSERVATORY_PROFESSOR) => {
    const event = { player, npcId, hook: name, definition: { getId: () => npcId } };
    api.emitCustomEvent('npc-dialogue:hook', event);
    return event;
  };
  const object = (objectId, option) => {
    const loc = new core.Location(2364, 9355, 0);
    const event = {
      player, objectId, clickType: 1, handled: false,
      object: { getId: () => objectId, getLocation: () => loc, getType: () => 10, getFace: () => 2, getPrivateArea: () => null },
      definition: { getId: () => objectId, getInteractions: () => [option], getActions: () => [option] },
    };
    for (const fn of objectFns) fn(event);
    return event;
  };
  const npc = (name, npcId, option = 'Prod') => {
    const actions = npcHooks.get(name);
    const npcObject = sleeper;
    const event = {
      player, npcId, npc: npcObject, clickType: 1, handled: false,
      definition: { getId: () => npcId, getInteractions: () => [option], getActions: () => [option] },
    };
    if (actions?.[option]) {
      if (actions[option](event) !== false) event.handled = true;
    }
    return event;
  };
  const sleeper = {
    visible: true, animations: [],
    setId(value) { transforms.push(value); },
    setNpcTransformationId(value) { transforms.push(value); },
    getContentId: () => N.SLEEPING_GUARD,
    getId: () => N.SLEEPING_GUARD,
    getLocation: () => new core.Location(2327, 9394, 0),
    performAnimation(animation) { sleeper.animations.push(animation.getId()); },
    isVisible: () => sleeper.visible,
    setVisible(value) { sleeper.visible = value; },
  };
  const ticks = (count) => { for (let i = 0; i < count; i++) core.TaskManager.process(); };
  const gate = (objectId = O.KITCHEN_GATE, from = new core.Location(2327, 9394, 0)) => {
    location = from;
    const request = { player, objectId, handled: false };
    api.emitCustomEvent('door:toggle', request);
    return request;
  };
  const killGuard = () => {
    const guard = spawned.at(-1);
    for (const fn of npcDeathHooks) fn({ npc: guard, npcId: guard.getId() });
    guard.registered = false;
  };
  const button = (groupId, childId) => {
    const event = { player, buttonId: (groupId << 16) | childId, handled: false };
    for (const fn of buttonHooks) fn(event);
    return event;
  };
  const itemOnItem = (a, b) => {
    const event = { player, usedItemId: a, usedWithItemId: b, handled: false };
    for (const fn of itemOnItemFns) fn(event);
    return event;
  };
  const ladder = (objectId, x, y) => {
    const loc = new core.Location(x, y, 0);
    const request = {
      player, objectId, object: { getLocation: () => loc }, location: loc, handled: false,
    };
    api.emitCustomEvent('ladders:climb', request);
    return request;
  };
  const login = () => {
    for (const fn of loginHooks) fn({ player, username: player.getUsername() });
  };
  const give = (id, amount = 1) => {
    assert.equal(addItem(id, amount), true, `fixture item ${id} did not fit`);
  };

  return {
    api, custom, deathHooks, player, quest, items, bankItems, attributes, varbits, messages, ground, xp, transforms, transcripts,
    animations, modals, overheads, dialogues, spawned, locs, sleeper, ticks, gate, killGuard, button,
    reconnect() { wire = new PacketSender(player);login();runtime.sendQuestVarps({player});api.emitCustomEvent('player:bootstrap-complete', { player }); },
    talk(npcId) {
      const choice = variantHooks.map(fn => fn({ player,npcId })).find(Boolean);
      return originalStartTranscript(api,player,npcId,typeof choice==='string'?PAGE:choice.page,typeof choice==='string'?choice:choice.variant);
    },
    withConditions(callback) {
      const previous = PluginManager.emitNpcDialogueCondition;
      PluginManager.emitNpcDialogueCondition = event => { for (const fn of conditionHooks) { const result=fn(event);if(result!=null)return result; }return null; };
      try { callback(); } finally { PluginManager.emitNpcDialogueCondition=previous; }
    },
    variant, condition, action, hook, object, npc, itemOnItem, ladder, login, give,
    stage: () => quest.getStage(player),
    setStage: (value) => quest.setStage(player, value),
    setFreeSlots: (value) => { freeSlots = value; },
    location: () => location,
  };
}

test('registered route: stage 0 through the canonical completion wire and wine claim', () => {
  const h = setup();
  assert.equal(h.quest.varpId, VARP);
  assert.equal(h.quest.completionValue, 7);

  h.login();
  assert.equal(h.varbits.get(VARP), 0, 'fresh stage 0 is replayed on login');
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'starting-off');

  h.hook('quest:observatory-quest:start');
  assert.equal(h.stage(), 1);
  assert.equal(h.varbits.get(VARP), 1);
  const sign = h.attributes.get(CONSTELLATION);
  assert.ok(SIGN_ORDER.includes(sign), 'the start rolls the star sign');
  assert.equal(h.varbits.get(STAR_SIGN), SIGN_ORDER.indexOf(sign), 'observatory_starsign is sent with the stage (tick 131)');

  h.give(I.PLANK, 3);
  h.action('p1dp6a');
  assert.equal(h.stage(), 2);
  assert.equal(h.items.get(I.PLANK), undefined);
  assert.equal(h.varbits.get(VARP), 2);
  assert.deepEqual(h.animations, [HAND_OVER], 'the hand-in plays the captured hand-over animation');

  h.give(I.BRONZE_BAR, 1);
  h.action('7a36YD');
  assert.equal(h.stage(), 3);
  assert.equal(h.items.get(I.BRONZE_BAR), undefined);

  h.give(I.MOLTEN_GLASS, 1);
  h.action('Y5Z4-D');
  assert.equal(h.stage(), 4);
  assert.equal(h.items.get(I.MOLTEN_GLASS), undefined);
  const choice = h.attributes.get(CHEST_CHOICE);
  assert.ok([0, 1, 2].includes(choice), 'the glass hand-in picks the key chest');
  assert.equal(h.varbits.get(3827), choice);
  h.attributes.set(CHEST_CHOICE, 0);

  const opened = h.object(O.CHEST_79, 'Open');
  assert.equal(opened.handled, true, 'a marked chest opens');
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), undefined, 'opening alone finds nothing');
  assert.equal(h.messages.at(-1), 'You open the chest.');
  h.ticks(1);
  assert.deepEqual(h.locs.slice(-2), [{ removed: O.CHEST_79 }, { added: O.CHEST_80 }], 'the open chest replaces the closed one a tick later');

  h.object(O.CHEST_82, 'Search');
  h.ticks(2);
  assert.equal(h.messages.at(-1), 'The chest is empty.', 'the chests without the key are empty');
  h.object(O.CHEST_80, 'Search');
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), undefined);
  h.ticks(2);
  assert.equal(h.dialogues.length, 1, 'the key chest shows the key in an item box');
  assert.equal(h.dialogues.at(-1).getDialogues().get(0).constructor.name, 'ItemStatementDialogue');
  runChain(h, h.dialogues.at(-1));
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), 1, 'the key arrives as the box is continued');
  h.object(O.CHEST_80, 'Search');
  h.ticks(2);
  assert.deepEqual(h.messages.slice(-2), ['You already have a kitchen key.', 'Another one will be of no use.']);
  h.object(O.CHEST_80, 'Close');
  assert.equal(h.messages.at(-1), 'You close the chest.');

  assert.equal(h.gate().handled, true, 'the gate stays shut while the guard sleeps');
  assert.equal(h.messages.at(-1), 'If you open the gate, the guard will hear you. You need to get rid of him.');

  const guard = h.npc('Sleeping guard', N.SLEEPING_GUARD);
  assert.equal(guard.handled, true);
  assert.deepEqual(h.sleeper.animations, [GUARD_WAKES]);
  assert.equal(h.gate().handled, true, 'still shut while the guard is waking');
  h.ticks(2);
  assert.equal(h.sleeper.visible, false, 'the sleeping guard is gone');
  const awake = h.spawned.at(-1);
  assert.equal(awake.getId(), N.GOBLIN_GUARD, 'a goblin guard takes his place');
  assert.deepEqual(awake.chats, ['Oi, how dare you wake me up!']);
  assert.deepEqual(awake.attacked, [h.player], 'and attacks the player who woke him');

  assert.equal(h.gate().handled, true);
  assert.equal(h.messages.at(-1), 'You need to get rid of that goblin guard first.');
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), 1, 'a refused gate keeps the key');
  awake.at = new core.Location(2327, 9399, 0);
  const trapped = h.gate();
  assert.equal(trapped.handled, false, 'trapped north of the gate, he no longer stops it');
  assert.deepEqual(h.messages.slice(-2), ['The gate unlocks.', 'The key is useless now. You discard it.']);
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), undefined, 'the key is discarded');
  assert.equal(h.varbits.get(3826), 1);
  awake.at = new core.Location(2327, 9395, 0);
  h.killGuard();
  assert.equal(h.gate().handled, false, 'killed, he stops the gate no more (live opens it as he falls, tick 914)');
  assert.equal(h.sleeper.visible, false);
  h.ticks(25);
  assert.equal(h.sleeper.visible, true, 'the sleeping guard is back once the goblin guard would respawn');
  assert.equal(h.gate().handled, true, 'asleep again, he stops the unlocked gate too');
  assert.equal(h.messages.at(-1), 'You need to get rid of that goblin guard first.');
  assert.equal(h.gate(O.KITCHEN_GATE, new core.Location(2327, 9393, 0)).handled, false, 'leaving the kitchen is never stopped');

  h.dialogues.length = 0;
  const stove = h.object(O.GOBLIN_STOVE, 'Inspect');
  assert.equal(stove.handled, true);
  runChain(h, h.dialogues.at(-1));
  assert.equal(h.items.get(I.LENS_MOULD), undefined);
  runChain(h, h.dialogues.at(-1));
  assert.deepEqual(h.overheads, ['Euuuw, that smells awful!']);
  assert.equal(h.items.get(I.LENS_MOULD), undefined, 'the mould is not in hand yet');
  h.ticks(2);
  assert.equal(h.items.get(I.LENS_MOULD), 1, 'two ticks after the remark the mould is taken');
  assert.equal(h.varbits.get(3837), 1);

  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'returning-with-the-lens-mould');
  h.action('JH15Z2');
  assert.equal(h.stage(), 5);
  assert.equal(h.items.get(I.MOLTEN_GLASS), 1, 'the professor returns molten glass');

  const crafted = h.itemOnItem(I.LENS_MOULD, I.MOLTEN_GLASS);
  assert.equal(crafted.handled, true);
  runChain(h, h.dialogues.at(-1));
  assert.equal(h.items.get(I.OBSERVATORY_LENS), undefined, 'the lens takes two ticks');
  h.ticks(2);
  assert.equal(h.items.get(I.OBSERVATORY_LENS), 1);
  assert.equal(h.items.get(I.MOLTEN_GLASS), undefined);
  assert.equal(h.xp.length, 0, 'casting the lens gives no Crafting XP');
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'returning-with-the-observatory-lens');

  h.action('HgpGGr');
  assert.equal(h.stage(), 5, 'the lens is handed over at the closing message');
  assert.equal(h.items.get(I.OBSERVATORY_LENS), 1);
  h.action('vj7Nry', N.OBSERVATORY_PROFESSOR, 'message');
  assert.equal(h.stage(), 6);
  assert.equal(h.items.get(I.OBSERVATORY_LENS), undefined);
  assert.equal(h.items.get(I.LENS_MOULD), undefined);
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'entering-the-observatory-talking-to-the-professor');

  const telescope = h.object(25591, 'View');
  assert.equal(telescope.handled, true);
  assert.equal(h.messages.at(-1), 'You look through the telescope.');
  assert.equal(h.attributes.get(VIEWED), undefined, 'the view opens two ticks later');
  h.ticks(2);
  assert.equal(h.attributes.get(VIEWED), true);
  assert.equal(h.varbits.get(3836), 1);
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'after-viewing-the-telescope');

  h.attributes.set(CONSTELLATION, 'Aquarius');
  h.action('RZIxJd');
  assert.equal(h.stage(), 7, 'the completion action reaches 7');
  assert.equal(h.quest.isComplete(h.player), true);
  assert.equal(h.varbits.get(VARP), 7, 'completion writes the canonical varp 112 = 7');
  assert.equal(h.items.get(I.UNCUT_SAPPHIRE), 1);
  assert.equal(h.items.get(I.WATER_RUNE), 25);
  // The telescope left the main modal's backdrop black ([0, 0]); the scroll, a tick later, clears it first (tick 1644).
  h.ticks(1);
  const scroll = h.modals.findIndex(([kind, id]) => kind === 'open' && id === 153);
  assert.ok(scroll > 0, 'the quest scroll opens');
  assert.ok(h.modals.findIndex(([kind, id]) => kind === 'open' && id === 552) < scroll, 'after the telescope');
  assert.deepEqual(h.modals[scroll - 1], ['script', 2524, -1, -1], 'with toplevel_mainmodal_open [-1, -1] just before it');
  assert.equal(h.attributes.get('quest.points'), 2);
  assert.ok(h.xp.some((entry) => entry.amount === 2250));

  const rewards = { sapphire: h.items.get(I.UNCUT_SAPPHIRE), water: h.items.get(I.WATER_RUNE), xp: h.xp.length };
  h.action('RZIxJd');
  assert.deepEqual(
    { sapphire: h.items.get(I.UNCUT_SAPPHIRE), water: h.items.get(I.WATER_RUNE), xp: h.xp.length },
    rewards,
    'replaying completion does not duplicate rewards'
  );
  assert.equal(h.variant(N.OBSERVATORY_PROFESSOR), 'standard-dialogue-after-observatory-quest');

  const wine = h.action('3f2Vz2', N.OBSERVATORY_ASSISTANT, 'message');
  assert.equal(wine.handled, false);
  assert.equal(h.stage(), 8, 'the assistant wine claim is durable stage 8');
  assert.equal(h.items.get(I.JUG_OF_WINE), 1);
  assert.equal(h.varbits.get(VARP), 7, 'the post-quest wine stage does not raise the quest varp above completion');
  assert.equal(h.variant(N.OBSERVATORY_ASSISTANT), 'after-observatory-quest-subsequent-dialogue');

  h.login();
  assert.equal(h.stage(), 8, 'the durable wine claim survives login');
  assert.equal(h.varbits.get(VARP), 7, 'login replays the canonical post-quest varp 112 = 7');
});

test('login replays a durable partial stage and an already-complete save', () => {
  const h = setup();
  h.setStage(4);
  h.login();
  assert.equal(h.varbits.get(VARP), 4);
  h.setStage(6);
  h.login();
  assert.equal(h.varbits.get(VARP), 6);
  h.setStage(7);
  h.login();
  assert.equal(h.varbits.get(VARP), 7);
});

test('only the rolled chest holds the key, and a lost key is found there again before the lens', () => {
  const h = setup();
  h.setStage(5);
  h.attributes.set(CHEST_CHOICE, 2);
  h.object(O.CHEST_80, 'Search');
  h.ticks(2);
  assert.equal(h.messages.at(-1), 'The chest is empty.', 'chest 0 is empty when the roll was chest 2');
  assert.equal(h.dialogues.length, 0);
  h.object(O.CHEST_84, 'Search');
  h.ticks(2);
  runChain(h, h.dialogues.at(-1));
  assert.equal(h.items.get(I.GOBLIN_KITCHEN_KEY), 1, 'chest 2 (2351,9361) holds it');
  assert.equal(h.stage(), 5, 'recovering a lost key does not rewind the lens stage');

  h.setStage(6);
  h.items.delete(I.GOBLIN_KITCHEN_KEY);
  h.object(O.CHEST_84, 'Search');
  h.ticks(2);
  assert.equal(h.messages.at(-1), 'The chest is empty.', 'no key once the lens is handed over');
  assert.equal(h.object(O.CHEST_84, 'Open').handled, false, 'an open chest has no Open');
  h.setStage(2);
  assert.equal(h.object(O.CHEST_79, 'Open').handled, true, 'the chests open before the quest needs them too');
});

test('a plain stove once the mould is held or banked, and the lens needs no Crafting level', () => {
  const h = setup({ realWire: true });
  h.setStage(4);
  h.give(I.LENS_MOULD);
  h.object(O.GOBLIN_STOVE, 'Inspect');
  const box = h.dialogues.at(-1).getDialogues().get(0);
  assert.equal(box.getText(), 'Just a plain stove. Nothing there.', 'live says "there" (tick 883)');
  h.setStage(5);
  h.give(I.MOLTEN_GLASS);
  h.player.getSkillManager = () => ({ getCurrentLevel: () => 1, getMaxLevel: () => 1, addExperiences() {} });
  assert.equal(h.itemOnItem(I.LENS_MOULD, I.MOLTEN_GLASS).handled, true);
  runChain(h, h.dialogues.at(-1));
  h.ticks(2);
  assert.equal(h.items.get(I.OBSERVATORY_LENS), 1);
});

test('the surface stairs warn first; the north stairs return; the south stairs play the cutscene once', () => {
  transcripts.length = 0;
  const h = setup({ realWire: true });
  h.setStage(6);

  const surface = h.ladder(O.STAIRS_129, 2458, 3186);
  assert.equal(surface.handled, true);
  assert.deepEqual([h.location().getX(), h.location().getY()], [2442, 3186], 'the warning comes first');
  assert.equal(h.player.getPacketSender().getVarbit(3859), 1, 'cws_warning_9 counts the showing');
  assert.equal(h.button(560, 18).handled, true, 'Stay out');
  h.ticks(3);
  assert.deepEqual([h.location().getX(), h.location().getY()], [2442, 3186], 'staying out stays');
  h.ladder(O.STAIRS_129, 2458, 3186);
  assert.equal(h.player.getPacketSender().getVarbit(3859), 2);
  h.button(560, 17);
  h.ticks(1);
  assert.deepEqual([h.location().getX(), h.location().getY()], [2442, 3186], 'proceeding takes two ticks');
  h.ticks(1);
  assert.deepEqual([h.location().getX(), h.location().getY(), h.location().getZ()], [2355, 9394, 0]);
  assert.equal(RegionManager.blocked(h.location(), null), false, 'the landing tile is walkable in the cache');
  for (let i = 0; i < 10; i++) { h.ladder(O.STAIRS_129, 2458, 3186); h.button(560, 12); }
  assert.equal(h.player.getPacketSender().getVarbit(3859), 6, 'the count stops below the "don\'t ask" value 7');

  h.attributes.set(CUTSCENE_SEEN, true);
  const south = h.ladder(O.STAIRS_127, 2335, 9351);
  assert.equal(south.handled, true);
  assert.deepEqual([h.location().getX(), h.location().getY(), h.location().getZ()], [2443, 3158, 0], 'a seen cutscene climbs straight up');
  assert.equal(transcripts.length, 0, 'the old talk-through of the cutscene is gone');

  const north = h.ladder(O.STAIRS_127, 2355, 9395);
  assert.equal(north.handled, true);
  assert.deepEqual([h.location().getX(), h.location().getY(), h.location().getZ()], [2458, 3185, 0]);

  const unrelated = h.ladder(O.STAIRS_127, 2400, 9395);
  assert.equal(unrelated.handled, false);
});

test('a one-slot completion keeps both the sapphire and the constellation item', () => {
  const h = setup();
  h.setStage(6);
  h.attributes.set(VIEWED, true);
  h.attributes.set(CONSTELLATION, 'Aquarius');
  h.setFreeSlots(1);

  h.action('RZIxJd');
  assert.equal(h.stage(), 7);
  assert.equal(h.items.get(I.UNCUT_SAPPHIRE), 1);
  const water = h.items.get(I.WATER_RUNE) ?? h.ground.find((entry) => entry.id === I.WATER_RUNE)?.amount;
  assert.equal(water, 25, 'the constellation reward is not silently lost when the sapphire takes the last slot');
});

test('a full bag leaves the assistant wine claimable instead of advancing without the jug', () => {
  const h = setup();
  h.setStage(7);
  h.setFreeSlots(0);
  h.action('3f2Vz2', N.OBSERVATORY_ASSISTANT, 'message');
  assert.equal(h.stage(), 7);
  assert.equal(h.items.get(I.JUG_OF_WINE), undefined);

  h.setFreeSlots(1);
  h.action('3f2Vz2', N.OBSERVATORY_ASSISTANT, 'message');
  assert.equal(h.stage(), 8);
  assert.equal(h.items.get(I.JUG_OF_WINE), 1);
});

test('prose conditions select the observed constellation and inventory-space branches', () => {
  const h = setup();
  h.setStage(6);
  h.attributes.set(CONSTELLATION, 'Aquarius');
  assert.equal(h.condition('If the player did see Aquarius:'), true);
  assert.equal(h.condition('If the player did see Aries:'), false);
  assert.equal(h.condition('If the player has inventory space:'), true);
  h.setFreeSlots(0);
  assert.equal(h.condition('If the player has inventory space:'), false);
  assert.equal(h.condition('If the player has no free inventory space:'), true);
});


test('earned gate, mould and telescope helper bits survive reconnect and preserve shared siblings', () => {
  const h = setup({ realWire: true }), p = h.player, s = p.getPacketSender();
  s.sendConfig(113, (1 << 5) | (1 << 16)); s.sendVarbit(542, 1);
  h.setStage(4); h.give(I.GOBLIN_KITCHEN_KEY); h.npc('Sleeping guard', N.SLEEPING_GUARD); h.ticks(2); h.killGuard(); h.ticks(25);
  // Killed, the guard sleeps again; this gate check runs while a second wake is under way.
  h.npc('Sleeping guard', N.SLEEPING_GUARD); h.ticks(2); h.spawned.at(-1).at = new core.Location(2327, 9399, 0);
  h.gate();
  assert.equal(s.getVarbit(3826), 1);
  h.setFreeSlots(0); h.object(O.GOBLIN_STOVE, 'Inspect');
  assert.equal(h.items.has(I.LENS_MOULD), false); assert.equal(s.getVarbit(3837), 0);
  h.setFreeSlots(3); h.object(O.GOBLIN_STOVE, 'Inspect');
  runChain(h, h.dialogues.at(-1)); runChain(h, h.dialogues.at(-1)); h.ticks(2);
  assert.equal(s.getVarbit(3837), 1);
  assert.equal(core.ObjectDefinition.forPlayer(25442, p).id, O.GOBLIN_STOVE_2);
  assert.equal(s.getVarp(113) & ((1 << 5) | (1 << 16)), (1 << 5) | (1 << 16));
  assert.equal(s.getVarbit(542), 1, 'Observatory does not own global cutscene status');
  h.items.delete(I.LENS_MOULD); h.bankItems.set(I.LENS_MOULD, 1); h.reconnect();
  assert.equal(p.getPacketSender().getVarbit(3826), 1);
  assert.equal(p.getPacketSender().getVarbit(3837), 1, 'actual banked mould remains present');
  h.object(O.GOBLIN_STOVE, 'Inspect'); assert.equal(h.items.has(I.LENS_MOULD), false, 'banked mould cannot duplicate');
  assert.equal(h.gate().handled, false, 'saved unlock (guard trapped) does not require another key');
  h.bankItems.clear(); h.setFreeSlots(3); h.object(O.GOBLIN_STOVE, 'Inspect');
  runChain(h, h.dialogues.at(-1)); runChain(h, h.dialogues.at(-1)); h.ticks(2);
  assert.equal(h.items.get(I.LENS_MOULD), 1, 'lost mould can be recovered');
  h.setFreeSlots(1); h.give(I.OBSERVATORY_LENS); h.setStage(5); h.action('vj7Nry', N.OBSERVATORY_PROFESSOR, 'message');
  assert.equal(p.getPacketSender().getVarbit(3837), 0, 'actual hand-in consumes mould');
  h.object(O.TELESCOPE_8, 'View'); h.ticks(2);
  assert.equal(p.getPacketSender().getVarbit(3836), 1);
  h.reconnect();
  assert.equal(p.getPacketSender().getVarbit(3836), 1);
  assert.equal(p.getPacketSender().getVarbit(3826), 1);
  const fresh = setup({ realWire: true }); fresh.setStage(7); fresh.login(); fresh.api.emitCustomEvent('player:bootstrap-complete', { player: fresh.player });
  for (const id of [3826, 3837, 3836]) assert.equal(fresh.player.getPacketSender().getVarbit(id), 0, 'completion earns no missing helper facts');
});

test('professor name option is earned by actual assistant speech even if the wine cannot fit', () => {
  const h = setup({ realTranscript: true }), p = h.player;
  h.setStage(7);
  const text = 'If the player has asked the Observatory assistant about his real name:';
  assert.equal(h.condition(text), false);
  h.setFreeSlots(0);
  h.withConditions(() => {
    const professorMenu = () => {
      h.talk(N.OBSERVATORY_PROFESSOR);
      for (let i = 0;i < 50 && !p.prompt;i++)p.manager.advance();
      const menu = p.prompt, index = menu.options.indexOf('Talk about the Observatory quest.');
      p.prompt = null; menu.pairs[index * 2 + 1]();
      for (let i = 0;i < 50 && !p.prompt;i++)p.manager.advance();
      const options = [...p.prompt.options]; p.manager.reset(); p.prompt = null; return options;
    };
    assert.equal(professorMenu().includes('Is it true your name is Mambo-duna-roona?'), false);
    h.talk(N.OBSERVATORY_ASSISTANT);
    for (let i = 0;i < 50 && !p.prompt;i++)p.manager.advance();
    const prompt = p.prompt, index = prompt.options.indexOf("Wait a minute, what's your real name?");
    assert.ok(index >= 0); p.prompt = null; prompt.pairs[index * 2 + 1]();
    assert.equal(h.condition(text), false, 'queued but unheard name does not earn the option');
    p.manager.reset(); p.prompt = null;
    h.talk(N.OBSERVATORY_ASSISTANT);
    for (let i = 0;i < 50 && !p.prompt;i++)p.manager.advance();
    const repeat = p.prompt, choice = repeat.options.indexOf("Wait a minute, what's your real name?");
    p.prompt = null; repeat.pairs[choice * 2 + 1]();
    for (let i = 0;i < 80 && p.manager.isActive();i++)p.manager.advance();
    assert.ok(professorMenu().includes('Is it true your name is Mambo-duna-roona?'));
  });
  assert.equal(h.condition(text), true);
  assert.equal(h.items.has(I.JUG_OF_WINE), false, 'hearing the name does not fabricate a wine receipt');
  assert.equal(h.stage(), 7);
});


test('cache professor transforms still follow stage112 while helper bits remain independent', () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const h = setup({ realWire: true }), s = h.player.getPacketSender();
  h.setStage(4);
  assert.equal(CacheDefinitions.resolveNpc(6403, s).id, N.OBSERVATORY_PROFESSOR);
  assert.equal(CacheDefinitions.resolveNpc(6404, s), undefined);
  h.setStage(6);
  assert.equal(CacheDefinitions.resolveNpc(6403, s), undefined);
  assert.equal(CacheDefinitions.resolveNpc(6404, s).id, N.OBSERVATORY_PROFESSOR);
  assert.equal(s.getVarbit(3836), 0);
  h.object(O.TELESCOPE_8, 'View'); h.ticks(2);
  assert.equal(s.getVarbit(3836), 1);
  assert.equal(CacheDefinitions.resolveNpc(6404, s).id, N.OBSERVATORY_PROFESSOR);
});


test('real mould destruction refreshes presence after mutation and preserves an actual banked copy', () => {
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { DropItemPacketListener } = require('../dist/net/packet/impl/DropItemPacketListener');
  const h = setup({ realWire: true }), p = h.player;
  const { Bank } = require('../dist/game/model/container/impl/Bank');
  const bank = new Bank(p); p.getBanks = () => [bank];
  const inventory = new Inventory(p); p.getInventory = () => inventory;
  p.getHitpoints = () => 10; p.getRights = () => 0; p.busy = () => false;
  p.getAsPlayer = () => p; p.isPlayerBot = () => false;
  const skills = p.getSkillManager(); p.getSkillManager = () => ({ ...skills, stopSkillable() { } });
  const base = p.getPacketSender(); let group = -1;
  const sender = new Proxy(base, {
    get(target, key) {
      if (key === 'sendChatboxInterface') return value => { group = value; return sender; };
      if (key === 'isChatboxInterface') return value => group === value;
      if (key === 'sendInterfaceRemoval') return () => { group = -1; target.sendInterfaceRemoval(); return sender; };
      return target[key];
    }
  });
  p.getPacketSender = () => sender;
  const buttons = new Map(), dropStart = PluginManager.itemDropHooks.length;
  const previous = PluginManager.customEventHooks.get('item:discarded');
  const handlers = (h.custom.get('item:discarded') ?? []).map(handler => ({ pluginName: 'q084-discard-test', handler }));
  PluginManager.customEventHooks.set('item:discarded', [...(previous ?? []), ...handlers]);
  require('../plugins/interface/DestroyItem.plugin').register({
    core, registerCustomInterface() { },
    onItemDropPolicy: handler => PluginManager.createApi('q084-destroy-test').onItemDropPolicy(handler),
    onInterfaceActionButton: (id, handler) => buttons.set(id, handler),
    onCustomEvent: () => {},
    emitCustomEvent: (name, event) => PluginManager.emitCustomEvent(name, event),
  });
  try {
    for (const banked of [false, true]) {
      bank.resetItems(); if (banked) bank.setItem(0, new core.Item(I.LENS_MOULD, 1));
      inventory.setItem(0, new core.Item(I.LENS_MOULD, 1)); h.login();
      assert.equal(sender.getVarbit(3837), 1);
      DropItemPacketListener.drop(p, I.LENS_MOULD, Inventory.INTERFACE_ID, 0);
      assert.equal(group, 584, 'actual non-dropable mould opens registered destruction confirmation');
      assert.equal(inventory.getAmount(I.LENS_MOULD), 1, 'showing confirmation does not remove the mould');
      buttons.get(584 << 16)({ player: p, action: 0 });
      assert.equal(sender.getVarbit(3837), 1, 'cancelled destruction retains presence');
      DropItemPacketListener.drop(p, I.LENS_MOULD, Inventory.INTERFACE_ID, 0);
      buttons.get(584 << 16)({ player: p, action: 1 });
      assert.equal(inventory.getAmount(I.LENS_MOULD), 0, 'actual confirmation mutates the real inventory');
      assert.equal(sender.getVarbit(3837), banked ? 1 : 0, 'post-discard event reads remaining inventory plus bank');
    }
  } finally {
    PluginManager.itemDropHooks.splice(dropStart);
    if (previous) PluginManager.customEventHooks.set('item:discarded', previous); else PluginManager.customEventHooks.delete('item:discarded');
  }
});


test('registered post-death hook refreshes actual remaining containers without clearing kept or banked moulds', () => {
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { Bank } = require('../dist/game/model/container/impl/Bank');
  const h = setup({ realWire: true }), p = h.player, inventory = new Inventory(p), bank = new Bank(p);
  p.getInventory = () => inventory; p.getBanks = () => [bank];
  const start = PluginManager.playerDefeatedHooks.length;
  for (const handler of h.deathHooks) PluginManager.createApi('q084-death-test').onPlayerDefeated(handler);
  try {
    for (const kept of [false, true]) for (const banked of [false, true]) {
      bank.resetItems(); if (banked) bank.setItem(0, new core.Item(I.LENS_MOULD, 1));
      inventory.setItem(0, new core.Item(I.LENS_MOULD, 1)); h.login();
      assert.equal(p.getPacketSender().getVarbit(3837), 1);
      // PlayerDeathTask emits this public event after inventory loss and kept-item restoration.
      inventory.resetItems(); if (kept) inventory.setItem(0, new core.Item(I.LENS_MOULD, 1));
      PluginManager.emitPlayerDefeated(null, p);
      assert.equal(p.getPacketSender().getVarbit(3837), kept || banked ? 1 : 0);
    }
  } finally { PluginManager.playerDefeatedHooks.splice(start); }
});

test('the cutscene reads its lines from the transcript steps it was timed against', () => {
  const Cutscene = require('../plugins/quests/observatory/Cutscene.ObservatoryQuest');
  const fs = require('node:fs');
  const steps = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'))[Cutscene.PAGE].variants[Cutscene.VARIANT];
  const words = (index) => steps[index].player ?? steps[index].text;
  // The capture's lines, in order (ticks 1421-1568); a regenerated transcript that moves them breaks this.
  assert.deepEqual(Object.fromEntries(Object.entries(Cutscene.STEP).map(([key, index]) => [key, words(index)])), {
    title: '~ The Observatory ~ The great eye into the heavens.',
    hi: 'Hi, professor!', hiThere: 'Oh, hi there.', finishing: "I'm just adding the finishing touches.",
    interrupt: "Okay, don't let me interrupt.", thanks: 'Thank you.', getFinished: "Right, let's get this finished.",
    hmm: 'Hmmmm...', tap: 'Bit of a tap here...', upstairs: "[player name], I'm just going upstairs to finish off.",
    rightOh: 'Right-oh.', lens: 'In goes the lens.', lookingGood: 'Looking good.',
    adjustment: 'And one final adjustment.', paysOff: 'And all our work pays off.',
  });
  for (const key of ['hi', 'interrupt', 'rightOh']) assert.equal(typeof steps[Cutscene.STEP[key]].player, 'string', `${key} is the player's`);
});

test('every transcript step id the plugin binds is in the imported record', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../plugins/quests/quests/ObservatoryQuest.Quest.js'), 'utf8');
  const all = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
  // The quest page, and the assistant's own page for the post-quest wine.
  const record = JSON.stringify([all[PAGE], all['Observatory assistant']]);
  const ids = [...source.matchAll(/(?:_ACTION|_MESSAGE) = "([^"]+)"/g), ...source.matchAll(/action: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(ids.length >= 20, `found ${ids.length} bound ids`);
  for (const id of ids) assert.ok(record.includes(`"id":"${id}"`), `step ${id} is in the imported records`);
});
