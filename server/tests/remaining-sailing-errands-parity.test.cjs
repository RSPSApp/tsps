const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { BoatDeckArea } = require('../dist/game/content/sailing/BoatDeckArea');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const runtime = require('../plugins/quests/QuestRuntime');
const npcDialogues = require('../plugins/npcs/NpcDialogues.plugin.js');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  require('../dist/game/collision/RegionManager').RegionManager.init();
});

const ORIGINAL_START_TRANSCRIPT = runtime.startTranscript;
const ORIGINAL_START_DIALOGUE = runtime.startDialogue;
const ORIGINAL_NPC_DIALOGUE = npcDialogues.startDialogue;

function makeHarness(pluginFile, levels = {}, extraPlugins = []) {
  const hooks = {
    custom: new Map(), variants: [], conditions: [], namedNpcs: new Map(), namedObjects: new Map(),
    genericObjects: [], itemActions: new Map(), itemOnItem: [], itemOnNpc: [], itemDrop: [],
    itemOnObject: [], zones: [], deaths: [], logins: [], logouts: [],
  };
  const tasks = [], spawned = [], removed = [], xp = [], transcripts = [], playedDialogues = [], groundSpawns = [], persisted = [];
  let tick = 0;
  const executed = new Set();
  const core = {
    ...PluginManager.getCoreApi(),
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    TaskManager: { submit(task) { task.due = tick + task.ticks; tasks.push(task); } },
    ObjectManager: { register() {}, deregister() {} },
    BoatManager: {
      getBoatAboard: (actor) => actor?.boat,
      getDeck: (boat) => boat?.deck,
    },
  };
  const api = new Proxy({
    core,
    persistAttribute(key, value) { persisted.push([key, value]); },
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(target, actions) {
      if (typeof target === 'string') hooks.namedNpcs.set(target, actions);
    },
    onObjectInteraction(target, actions) {
      if (typeof target === 'string') hooks.namedObjects.set(target, actions);
      else hooks.genericObjects.push(target);
    },
    onItemAction(name, actions) { hooks.itemActions.set(name, actions); },
    onItemOnItem(first, second, fn) { hooks.itemOnItem.push({ first, second, fn }); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onItemDropPolicy(fn) { hooks.itemDrop.push(fn); },
    onItemOnObject(item, object, fn) { hooks.itemOnObject.push({ item, object, fn }); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') {
        const quest = runtime.getRegisteredQuests().find((entry) => entry.key === event.key);
        if (quest && event.player) event.complete = quest.isComplete(event.player);
      }
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    spawnNpc(def) {
      let tile = new core.Location(def.x, def.y, def.z), hitpoints = 100, area = null;
      const npc = {
        def, getId: () => def.id, getOwner: () => def.owner, isRegistered: () => true,
        isPlayer: () => false, isNpc: () => true, getAsNpc: () => npc,
        getArea: () => area, setArea(value) { area = value; },
        getHitpoints: () => hitpoints, setHitpoints(value) { hitpoints = value; },
        getLocation: () => tile, moveTo(value) { tile = value; },
        setNpcTransformationId(id) { npc.transformedId = id; },
        performAnimation(animation) { npc.animation = animation; },
        getMovementQueue: () => ({ reset() { return this; }, addSteps() {}, setBlockMovement() { return this; } }),
        getIndex: () => 10000 + spawned.length,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { removed.push(npc); },
    getItemOnGroundManager: () => ({ registerLocation(player, item, location) {
      groundSpawns.push({ itemId: item.getId?.() ?? item.id, x: location.getX(), y: location.getY() });
    }, getGroundItem: () => null }),
    onPlayerLogin(fn) { hooks.logins.push(fn); },
    onPlayerLogout(fn) { hooks.logouts.push(fn); },
    onZoneEnter(zone, fn) { hooks.zones.push({ zone, fn }); },
    onNpcDeath(fn) { hooks.deaths.push(fn); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  runtime.startTranscript = (apiArg, player, npcId, page, variant) => {
    transcripts.push({ npcId, page, variant });
    return true;
  };
  // Drives QuestRuntime's simple steps synchronously; option picks come from `pick`.
  let pick = () => 0;
  runtime.startDialogue = (apiArg, player, context, steps) => {
    for (const step of steps) {
      if (step.exec) step.exec(player, context);
      else if (step.options) {
        const option = step.options[pick()];
        if (option) for (const next of option.next ?? []) next.exec?.(player, context);
      }
    }
  };
  npcDialogues.startDialogue = (apiArg, event, steps) => { playedDialogues.push(steps); };
  try {
    require(pluginFile)(api);
    for (const extra of extraPlugins) require(extra)(api);
  } finally {
    runtime.startTranscript = ORIGINAL_START_TRANSCRIPT;
    runtime.startDialogue = ORIGINAL_START_DIALOGUE;
  }
  const quest = runtime.getRegisteredQuests().at(-1);

  const attrs = new Map(), inventory = new Map(), varbits = new Map(), messages = [];
  const skillLevels = { getMaxLevel: (skill) => levels[skill.name] ?? 99, getCurrentLevel: (skill) => levels[skill.name] ?? 99 };
  let location = new core.Location(2803, 3430, 0);
  const movement = { blocked: false, reset() { return this; }, setBlockMovement(value) { this.blocked = value; return this; } };
  const sailing = { boats: [], activeBoatSlot: undefined };
  const hits = [], packets = [];
  const equipped = new Map();
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    sendCameraMoveTo(...args) { packets.push(['moveTo', ...args]); return sender; },
    sendCameraLookAt(...args) { packets.push(['lookAt', ...args]); return sender; },
    sendCameraMoveArc(...args) { packets.push(['moveArc', ...args]); return sender; },
    sendCameraRotateBy(...args) { packets.push(['rotateBy', ...args]); return sender; },
    sendCameraShake(...args) { packets.push(['shake', ...args]); return sender; },
    sendCameraReset() { packets.push(['reset']); return sender; },
    sendCameraUnlock(value) { packets.push(['unlock', value]); return sender; },
    sendSubInterface(uid, ...args) { packets.push(['subInterface', uid, ...args]); return sender; },
    closeSubInterface(uid) { packets.push(['closeSubInterface', uid]); return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const inventoryApi = {
    getAmount: (id) => inventory.get(id) ?? 0,
    contains: (id) => (inventory.get(id) ?? 0) > 0,
    deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
    adds(id, count = 1) { inventory.set(id, (inventory.get(id) ?? 0) + count); return true; },
    addItem(item) { inventory.set(item.id, (inventory.get(item.id) ?? 0) + item.amount); },
    forceAdd(_player, item) { inventory.set(item.id, (inventory.get(item.id) ?? 0) + item.amount); },
    getFreeSlots: () => 28 - [...inventory.values()].filter((amount) => amount > 0).length,
    isFull: () => 28 - [...inventory.values()].filter((amount) => amount > 0).length <= 0,
  };
  const player = {
    getAttribute: (key) => attrs.get(key), setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender, getFrameUpdater: () => null, sendMessage(message) { messages.push(message); },
    getInventory: () => inventoryApi,
    getEquipment: () => ({ get: (slot) => ({ getId: () => equipped.get(slot) ?? -1 }), getItems: () => [], hasItem: () => equipped.size > 0 }),
    getSailing: () => sailing,
    getMovementQueue: () => movement,
    setUntargetable() {},
    performAnimation(animation) { player.animation = animation; },
    getCombat: () => ({ reset() {}, getHitQueue: () => ({ addPendingDamage(list) { hits.push(...list); } }) }),
    getSkillManager: () => ({ ...skillLevels, getCombatLevel: () => 100,
      addExperiences(skill, amount) { xp.push({ skill, amount }); } }),
    getLocation: () => location, moveTo(value) { location = value; },
    getPrivateArea: () => null, getUsername: () => 'parity', getIndex: () => 1,
    isRegistered: () => true, isPlayer: () => true, getAsPlayer() { return player; },
    getDialogueManager: () => ({ startDialogues() {}, reset() {}, isActive: () => false }),
  };
  const emit = (name, event = {}) => api.emitCustomEvent(name, { player, ...event });
  const action = (npcId, stepId, extra = {}) => { const event = { player, npcId, stepId, ...extra }; emit('npc-dialogue:action', event); return event; };
  const line = (npcId, text) => { const event = { player, npcId, text }; emit('npc-dialogue:line', event); return event; };
  const option = (npcId, text) => emit('npc-dialogue:choice', { npcId, option: text });
  return {
    api, hooks, core, quest, attrs, inventory, varbits, messages, xp, player, tasks, spawned, removed,
    transcripts, playedDialogues, groundSpawns, persisted, emit, action, line, option, sailing, hits, packets,
    setShield(id, slot = core.Equipment.SHIELD_SLOT) { equipped.set(slot, id); },
    tick(count = 1) {
      while (count-- > 0) {
        tick++;
        for (const task of [...tasks]) if (!executed.has(task) && task.due <= tick) { executed.add(task); task.run(); }
      }
    },
    setPick(fn) { pick = fn; },
  };
}

// ---------------------------------------------------------------------------
// Current Affairs
// ---------------------------------------------------------------------------

test('Current Affairs follows the Quest Helper stage ladder and gates its start', () => {
  const h = makeHarness('../plugins/quests/quests/CurrentAffairs.Quest', { Sailing: 22, Fishing: 10 });
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  const isComplete = h.hooks.custom.get('quest:is-complete') ?? [];
  isComplete.push((event) => { if (event.key === 'pandemonium') event.complete = true; });
  h.hooks.custom.set('quest:is-complete', isComplete);
  h.emit('quest:is-complete', {});
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.ARHEIN }), 'starting-off-talking-to-arhein');
  assert.equal(h.quest.getStage(h.player), 0);

  // Quest Helper requires two free inventory slots at the hand-in stage.
  for (let slot = 0; slot < 27; slot++) h.inventory.set(1000 + slot, 1);
  assert.equal(h.hooks.conditions[0]({ player: h.player, npcId: N.ARHEIN, stepId: 'mNhEI-' }), true);
  h.inventory.clear();
  assert.equal(h.hooks.conditions[0]({ player: h.player, npcId: N.ARHEIN, stepId: 'mNhEI-' }), false);

  h.emit('npc-dialogue:hook', { npcId: N.ARHEIN, hook: 'quest:current-affairs:start' });
  assert.equal(h.quest.getStage(h.player), 5);

  h.action(N.COUNCILLOR_CATHERINE, 'Xu9bQv');
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.inventory.get(I.FORM_CR_4P), 1);
  assert.equal(h.varbits.get(18285), 1);

  h.action(N.COUNCILLOR_CATHERINE, '-1ABR0');
  assert.equal(h.quest.getStage(h.player), 15);
  assert.equal(h.inventory.get(I.FORM_CR_4P), 0);

  h.line(N.ARHEIN, "I'll help you replace the fish.");
  assert.equal(h.quest.getStage(h.player), 20);

  h.inventory.set(I.COINS, 50);
  h.action(N.HARRY, 'z2S7Yd');
  assert.equal(h.inventory.get(I.COINS), 0);
  assert.equal(h.inventory.get(I.MAYORAL_FISHBOWL), 1);
  assert.equal(h.inventory.get(I.TINY_NET), 1);
  assert.equal(h.varbits.get(18287), 1);

  h.inventory.set(I.MAYOR_OF_CATHERBY, 1);
  h.action(N.ARHEIN, 'N4WcCZ');
  assert.equal(h.quest.getStage(h.player), 25);
  assert.equal(h.attrs.get('current-affairs:mayor-chained'), true);

  h.action(N.COUNCILLOR_CATHERINE, 'gAbCv_');
  assert.equal(h.quest.getStage(h.player), 30);
  assert.equal(h.inventory.get(I.FORM_7R4_5H), 1);
  assert.equal(h.varbits.get(18289), 1);

  h.inventory.set(I.FORM_7R4_5H_2, 1);
  h.action(N.COUNCILLOR_CATHERINE, 'Z8S0Nw');
  assert.equal(h.quest.getStage(h.player), 35);

  h.action(N.ARHEIN, 'P6m_pN');
  assert.equal(h.quest.getStage(h.player), 40);
  assert.equal(h.inventory.get(I.CURRENT_DUCK), 1);

  h.action(N.ARHEIN, 'Qgq1vn');
  assert.equal(h.quest.getStage(h.player), 40, 'completion waits for the charted currents');

  h.attrs.set('current-affairs:currents-charted', true);
  h.action(N.ARHEIN, 'Qgq1vn');
  assert.equal(h.quest.getStage(h.player), 45);
  assert.ok(h.xp.some((entry) => entry.amount === 1400));
  assert.ok(h.xp.some((entry) => entry.amount === 1000));
  assert.equal(h.inventory.get(I.SAWMILL_COUPON_OAK_PLANK_), 25);
});

test('Current Affairs audit passes matching answers and re-asks only misses', () => {
  const h = makeHarness('../plugins/quests/quests/CurrentAffairs.Quest', { Sailing: 22, Fishing: 10 });
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 25);
  h.attrs.set('current-affairs:mayor-chained', true);
  h.inventory.set(I.MAYOR_OF_CATHERBY, 1);
  h.attrs.set('current-affairs:form-answers', '11111111');

  h.setPick(() => 0);
  h.hooks.namedNpcs.get('Councillor Catherine')['Talk-to']({ player: h.player, npcId: N.COUNCILLOR_CATHERINE });
  assert.equal(h.quest.getStage(h.player), 25, 'wrong answers cannot finish the audit');
  const retry = h.playedDialogues.at(-1).find((step) => step.action === 'current-affairs:audit-retry');
  assert.ok(retry, 'the failed audit offers a retry');

  h.emit('npc-dialogue:action', { npcId: N.COUNCILLOR_CATHERINE, action: retry.action });
  assert.equal(h.tasks.at(-1)?.ticks, 1, 'retry reopens after the transcript closes');

  h.attrs.set('current-affairs:form-answers', '00000000');
  h.quest.setStage(h.player, 25);
  h.hooks.namedNpcs.get('Councillor Catherine')['Talk-to']({ player: h.player, npcId: N.COUNCILLOR_CATHERINE });
  assert.equal(h.quest.getStage(h.player), 30);
  assert.equal(h.varbits.get(18288), 1, 'audit-start varbit mirrors the quiz');
});

// ---------------------------------------------------------------------------
// Prying Times
// ---------------------------------------------------------------------------

test('Prying Times writes the real port task and only advances when the crate is delivered', () => {
  const h = makeHarness('../plugins/quests/quests/PryingTimes.Quest', { Sailing: 12, Smithing: 30 });
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  h.hooks.custom.set('quest:is-complete', [(event) => {
    if (event.key === 'pandemonium' || event.key === 'the_knights_sword') event.complete = true;
  }]);
  h.inventory.set(I.CAPTAINS_LOG, 1);
  for (const login of h.hooks.logins) login({ player: h.player });
  const steve = h.spawned.find((npc) => npc.getId() === 14967);
  assert.ok(steve, 'Steve spawns as the cache base 14967');
  assert.equal(h.spawned.some((npc) => npc.getId() === 14968), false, 'no resolved duplicate spawn');
  assert.equal(CacheDefinitions.getNpc(14967).transformVarbit, 18314);
  assert.equal(CacheDefinitions.resolveNpc(14967, { getVarbit: () => 0, getVarp: () => 0 }).id, 14968);
  assert.equal(CacheDefinitions.resolveNpc(14967, { getVarbit: () => 19, getVarp: () => 0 }).id, 14969);
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.SQUAWKING_STEVE_BEANIE }), 'starting-off');

  h.action(N.SQUAWKING_STEVE_BEANIE, 'nbTB-L');
  assert.equal(h.quest.getStage(h.player), 5);
  const slots = h.attrs.get('port-tasks:slots');
  assert.ok(Array.isArray(slots) && slots.some((slot) => slot?.id === 600), 'task 600 is on the board');

  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.SQUAWKING_STEVE_BEANIE }),
    'starting-off-subsequent-dialogue-with-squawking-steve-beanie');

  // The ledger clears the row only after a real take/deposit cycle, which also
  // increments the completed-task counter.
  h.attrs.set('port-tasks:slots', [null, null, null, null, null]);
  h.attrs.set('port-tasks:completed', { total: 1 });
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.SQUAWKING_STEVE_BEANIE }),
    'retrieving-and-depositing-the-pirate-looty-talking-to-squawking-steve-beanie');
  assert.equal(h.quest.getStage(h.player), 10);

  h.option(N.SQUAWKING_STEVE_BEANIE, 'I delivered that cargo for you.');
  assert.equal(h.quest.getStage(h.player), 15);
});

test('Prying Times crowbar, key and crate need the real materials and stages', () => {
  const h = makeHarness('../plugins/quests/quests/PryingTimes.Quest', { Sailing: 12, Smithing: 30 });
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 15);

  h.action(N.THURGO, 'e2Ow6O');
  assert.equal((h.inventory.get(I.CROWBAR) ?? 0), 0, 'no bar, pie or hammer means no crowbar');
  assert.equal(h.quest.getStage(h.player), 15);

  h.inventory.set(I.HAMMER, 1); h.inventory.set(I.STEEL_BAR, 1); h.inventory.set(I.REDBERRY_PIE, 1);
  h.action(N.THURGO, 'e2Ow6O');
  assert.equal(h.inventory.get(I.CROWBAR), 1);
  assert.equal(h.inventory.get(I.STEEL_BAR), 0);
  assert.equal(h.inventory.get(I.REDBERRY_PIE), 0);
  assert.equal(h.quest.getStage(h.player), 20);

  h.option(N.SQUAWKING_STEVE_BEANIE, "I made that 'special key' you needed.");
  assert.equal(h.quest.getStage(h.player), 25);

  const openCrate = (event) => h.hooks.genericObjects[0]({ player: h.player, ...event });
  openCrate({ objectId: 59283 });
  assert.equal(h.quest.getStage(h.player), 25, 'the final crate is not ready before the drink test');

  h.action(N.DRINK_TROLL, 'Gyue8X');
  assert.equal(h.inventory.get(I.BOTTLE_OF_FISH_BLADDER_STOUT), 1);
  h.action(N.DRINK_TROLL, 'jR3WLF');
  assert.equal(h.inventory.get(I.BOTTLE_OF_FISH_BLADDER_STOUT), 0);
  assert.equal(h.attrs.get('prying-times:drank-stout'), true);

  h.option(N.SQUAWKING_STEVE_BEANIE, 'About that crate...');
  assert.equal(h.attrs.get('prying-times:told-steve'), true);
  assert.equal(h.quest.getStage(h.player), 30);

  openCrate({ objectId: 59283 });
  h.action(N.SQUAWKING_STEVE_BEANIE, 'rP9tMj');
  assert.equal(h.quest.getStage(h.player), 35);
  assert.ok(h.xp.some((entry) => entry.amount === 1000));
  assert.ok(h.xp.some((entry) => entry.amount === 800));
});

test('Prying Times drink troll uses the real boat deck, retries spawn failure and detaches', () => {
  const h = makeHarness('../plugins/quests/quests/PryingTimes.Quest', { Sailing: 12, Smithing: 30 });
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  for (const [key, value] of [
    ['prying-times:delivery-assigned', false],
    ['prying-times:delivery-baseline', 0],
    ['prying-times:stage-v2', false],
  ]) {
    assert.ok(h.persisted.some(([stored, fallback]) => stored === key && fallback === value),
      `${key} persists its ${JSON.stringify(value)} default`);
  }
  h.quest.setStage(h.player, 25);
  h.attrs.set('prying-times:drank-stout', true);

  const boat = {
    entityIndex: 7, sceneBaseX: 9000, sceneBaseY: 9000, deckBaseX: 9100, deckBaseY: 9100,
    containsDeckTile: () => true,
  };
  const deck = new BoatDeckArea(boat, { walkableDeck: [], locs: [] });
  boat.deck = deck;
  h.player.boat = boat;

  const spawn = h.api.spawnNpc;
  let failOnce = true;
  h.api.spawnNpc = (definition) => {
    if (failOnce) { failOnce = false; return null; }
    return spawn(definition);
  };
  h.action(N.DRINK_TROLL, '0OeEX0');
  assert.equal(h.spawned.filter((npc) => npc.getId() === N.DRINK_TROLL).length, 0,
    'a failed spawn does not create an outside-deck troll');
  h.tick(1);
  const troll = h.spawned.find((npc) => npc.getId() === N.DRINK_TROLL);
  assert.ok(troll, 'the stout leg retries the troll spawn');
  assert.equal(troll.getOwner(), h.player);
  assert.equal(troll.getArea(), deck, 'the troll is a real BoatDeckArea member');
  assert.ok(deck.entities.includes(troll));

  h.hooks.deaths[0]({ npc: troll, npcId: N.DRINK_TROLL });
  assert.ok(!deck.entities.includes(troll), 'death detaches the troll from the deck');
  assert.equal(troll.getArea(), null);

  h.action(N.DRINK_TROLL, '0OeEX0');
  const second = h.spawned.filter((npc) => npc.getId() === N.DRINK_TROLL).at(-1);
  assert.ok(second && second !== troll, 'the leg can spawn a fresh troll after death');
  assert.equal(second.getArea(), deck);
  h.hooks.logouts[0]({ player: h.player });
  assert.ok(!deck.entities.includes(second), 'logout detaches the troll');
  assert.ok(h.removed.includes(second), 'logout removes the NPC');

  h.hooks.logins[0]({ player: h.player });
  const resumed = h.spawned.filter((npc) => npc.getId() === N.DRINK_TROLL).at(-1);
  assert.ok(resumed && resumed !== second, 'login resumes the troll on the deck');
  assert.equal(resumed.getArea(), deck);
});

test('Prying Times login resends the completion reward mirror without repeating rewards', () => {
  const complete = makeHarness('../plugins/quests/quests/PryingTimes.Quest', { Sailing: 12, Smithing: 30 });
  const I = complete.core.ItemIdentifiers;
  complete.quest.setStage(complete.player, 35);
  complete.varbits.set(18320, 0);
  complete.inventory.set(I.SAWMILL_COUPON_OAK_PLANK_, 25);
  const xpBefore = complete.xp.length;
  complete.hooks.logins[0]({ player: complete.player });
  assert.equal(complete.varbits.get(18320), 1, 'completed save restores the reward mirror');
  assert.equal(complete.xp.length, xpBefore, 'login does not repeat XP');
  assert.equal(complete.inventory.get(I.SAWMILL_COUPON_OAK_PLANK_), 25, 'login does not repeat coupons');

  const incomplete = makeHarness('../plugins/quests/quests/PryingTimes.Quest', { Sailing: 12, Smithing: 30 });
  incomplete.quest.setStage(incomplete.player, 25);
  incomplete.varbits.set(18320, 1);
  incomplete.hooks.logins[0]({ player: incomplete.player });
  assert.equal(incomplete.varbits.get(18320), 0, 'incomplete save clears a stale reward mirror');
});

function pathExists(RegionManager, start, goal, radius = 48) {
  const seen = new Set([`${start[0]},${start[1]}`]);
  const queue = [start];
  for (let i = 0; i < queue.length && queue.length < 20000; i++) {
    const [x, y] = queue[i];
    if (x === goal[0] && y === goal[1]) return true;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (seen.has(key) || Math.abs(nx - start[0]) > radius || Math.abs(ny - start[1]) > radius) continue;
      if (!RegionManager.canMove(x, y, nx, ny, 0, 1, 1, null)) continue;
      seen.add(key); queue.push([nx, ny]);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Troubled Tortugans
// ---------------------------------------------------------------------------

test('Troubled Tortugans follows the Quest Helper stages through repairs, tracking and the cave', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  const injured = N.INJURED_TORTUGAN;
  h.emit('npc-dialogue:hook', { npcId: injured, hook: 'quest:troubled-tortugans:start' });
  assert.equal(h.quest.getStage(h.player), 2);

  const makeBandages = h.hooks.itemOnItem.find((entry) => entry.first === 'Seaweed').fn;
  h.inventory.set(I.SEAWEED, 1); h.inventory.set(I.PALM_LEAF, 1);
  assert.equal(makeBandages({ player: h.player }), true);
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.inventory.get(I.MAKESHIFT_BANDAGES), 1);

  for (const fn of h.hooks.itemOnNpc) fn({ player: h.player, npcId: injured, itemId: I.MAKESHIFT_BANDAGES });
  assert.equal(h.quest.getStage(h.player), 6);
  h.line(injured, "Don't mention it. I'm pleased to meet you, Floopa.");
  assert.equal(h.quest.getStage(h.player), 7);
  h.line(N.FLOOPA, 'The Great Conch, to the south east. I guess I\'ll join you on your boat.');
  assert.equal(h.quest.getStage(h.player), 8);

  h.emit('sailing:boarded', {});
  assert.equal(h.quest.getStage(h.player), 10);
  const boatFloopa = h.spawned.find((npc) => npc.getId() === 14987);
  assert.ok(boatFloopa, 'Floopa appears on the deck when boarding');

  h.player.moveTo(new h.core.Location(3185, 2371, 0));
  h.emit('sailing:left', { reason: 'disembark' });
  assert.equal(h.quest.getStage(h.player), 12);
  const dockFloopa = h.spawned.find((npc) => npc.getId() === 14988);
  assert.ok(dockFloopa, 'Floopa waits at the Great Conch docks');
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: 14988 }).variant, 'part-1-arrival-at-the-great-conch');
  h.action(14988, 'bRB9K_');
  assert.equal(h.quest.getStage(h.player), 13);
  h.line(14988, 'Very well. I will see that it is done.');
  assert.equal(h.quest.getStage(h.player), 14);

  h.line(N.ELDER_RALEY, 'So you brought Floopa home.');
  assert.equal(h.quest.getStage(h.player), 16);
  h.action(N.ELDER_RALEY, '8dFZ4e');
  assert.equal(h.quest.getStage(h.player), 18);
  assert.equal(h.inventory.get(I.LIST_OF_REPAIRS), 1);

  const repairs = [
    ['Broken fish stall', 58420], ['Damaged wall', 58424], ['Damaged wall', 58425],
    ['Broken crate', 58422], ['Broken crafting stall', 58421], ['Broken coconut crate', 58423],
  ];
  for (const [name, objectId] of repairs) {
    h.hooks.namedObjects.get(name).Repair({ player: h.player, objectId });
  }
  assert.equal(h.quest.getStage(h.player), 18, 'repairs without tools or materials do not count');

  h.inventory.set(I.HAMMER, 1); h.inventory.set(I.SAW, 1);
  h.inventory.set(I.JATOBA_LOGS, 20); h.inventory.set(I.TORTUGAN_SCUTE, 20); h.inventory.set(I.SEA_SHELL, 20);
  for (const [name, objectId] of repairs) {
    h.hooks.namedObjects.get(name).Repair({ player: h.player, objectId });
  }
  assert.equal(h.quest.getStage(h.player), 20);
  assert.equal(h.varbits.get(18327), 2);
  assert.equal(h.varbits.get(18332), 2);

  h.option(N.ELDER_RALEY, "I'd better get to it.");
  assert.equal(h.quest.getStage(h.player), 22);

  h.hooks.namedObjects.get('Monument').Inspect({ player: h.player, objectId: 58445 });
  assert.equal(h.quest.getStage(h.player), 24, 'the captured monument step jumps 22 to 24');
  assert.equal(h.varbits.get(18322), 1, 'the monument publishes hunting trail 1');
  for (const varbit of [18323, 18324, 18325, 18326]) {
    assert.equal(h.varbits.get(varbit), 0, `trail ${varbit} stays zero until its find`);
  }

  const trailFinds = [
    [58449, 'Plant', 18323],
    [58467, 'Rockslide', 18324],
    [58452, 'Plant', 18325],
    [58455, 'Plant', 18326],
  ];
  for (let index = 0; index < trailFinds.length; index++) {
    const [objectId, name, varbit] = trailFinds[index];
    assert.equal(h.varbits.get(varbit), 0, `trail find ${index + 1} is unpublished before inspection`);
    h.hooks.namedObjects.get(name).Inspect({ player: h.player, objectId });
    assert.equal(h.varbits.get(varbit), 1, `trail find ${index + 1} publishes its varbit`);
    assert.equal(h.quest.getStage(h.player), index === trailFinds.length - 1 ? 26 : 24,
      'only the final find advances the recorded stage');
    if (index === 1) {
      for (const logout of h.hooks.logouts) logout({ player: h.player });
      for (const login of h.hooks.logins) login({ player: h.player });
      assert.equal(h.quest.getStage(h.player), 24, 'login restoration does not advance the quest');
      for (const [, , previousVarbit] of trailFinds.slice(0, index + 1)) {
        assert.equal(h.varbits.get(previousVarbit), 1, `login restores trail varbit ${previousVarbit}`);
      }
      assert.equal(h.varbits.get(18325), 0, 'login keeps unfinished trail steps at zero');
      assert.equal(h.varbits.get(18326), 0, 'login keeps unfinished trail steps at zero');
    }
  }
  assert.equal(h.quest.getStage(h.player), 26);

  h.inventory.set(I.BRONZE_AXE, 1);
  h.hooks.namedObjects.get('Cave entrance').Unblock({ player: h.player, objectId: 58439 });
  h.action(N.ELDER_KOREL, '_IAdC-');
  assert.equal(h.quest.getStage(h.player), 28);
  h.option(N.ELDER_KOREL, 'Yes.');
  assert.equal(h.quest.getStage(h.player), 30);

  const gryphon = h.spawned.find((npc) => npc.getId() === N.GRYPHON_3);
  h.hooks.deaths[0]({ killer: h.player, npc: gryphon, npcId: N.GRYPHON_3 });
  assert.equal(h.quest.getStage(h.player), 32);
  h.line(N.ELDER_RALEY, 'I will meet you there, human.');
  assert.equal(h.quest.getStage(h.player), 34);
});

test('Troubled Tortugans Shieldbane fight and final hand-in complete once', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  const N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 34);
  h.varbits.set(19136, 1);
  h.sailing.activeBoatSlot = 0;
  h.sailing.boats = [{ slot: 0, location: { kind: 'at_sea', fineX: 3354 * 128, fineY: 2216 * 128 } }];
  h.emit('sailing:boarded', {});
  h.tick(8);
  assert.equal(h.quest.getStage(h.player), 36);
  assert.equal(h.player.getMovementQueue().blocked, true, 'the captured cutscene blocks controls');
  assert.ok(h.spawned.some((npc) => npc.getId() === 15001), 'the cutscene sailor appears');
  h.tick(36);
  const shellbane = h.spawned.find((npc) => npc.getId() === N.SHELLBANE_GRYPHON_2);
  assert.ok(shellbane, 'the Pearl spawns its gryphon');
  assert.equal(h.player.getMovementQueue().blocked, false, 'controls recover after the cutscene');
  assert.ok(h.spawned.some((npc) => npc.getId() === 14999), 'Elder Korel fights alongside');
  assert.ok(h.spawned.some((npc) => npc.getId() === 15004));
  assert.ok(h.spawned.some((npc) => npc.getId() === 15007));

  h.hooks.deaths[0]({ killer: h.player, npc: shellbane, npcId: N.SHELLBANE_GRYPHON_2 });
  assert.equal(h.quest.getStage(h.player), 38);
  const korel = h.spawned.find((npc) => npc.getId() === 14999);
  assert.equal(korel.transformedId, 15000, 'captured combat_done Korel transform');
  assert.ok(!h.core.NpcDefinition.forId(14999).getActions().includes('Talk-to'));
  assert.ok(h.core.NpcDefinition.forId(15000).getActions().includes('Talk-to'));
  const shippedKorel = runtime.loadTranscripts(h.api)['Troubled Tortugans'].variants['part-3-talking-to-elder-korel'];
  h.line(15000, shippedKorel[0].text);
  assert.equal(h.quest.getStage(h.player), 40);
  h.line(15000, shippedKorel.at(-1).player);
  assert.equal(h.quest.getStage(h.player), 42);

  h.attrs.set('troubled-tortugans:trail', 5);
  const shippedFinal = runtime.loadTranscripts(h.api)['Troubled Tortugans'].variants['part-3-talking-to-floopa-or-elder-raley'];
  h.line(N.ELDER_RALEY, shippedFinal.find(step => step.text?.startsWith('No, no, no!')).text);
  assert.equal(h.quest.getStage(h.player), 44);
  for (const varbit of [18322, 18323, 18324, 18325, 18326]) {
    assert.equal(h.varbits.get(varbit), 0, `completion clears trail varbit ${varbit}`);
  }
  assert.equal(h.xp.filter((entry) => entry.amount === 10000).length, 1);
  assert.equal(h.xp.filter((entry) => entry.amount === 8000).length, 1);
  const xpBeforeRelog = h.xp.length;
  for (const logout of h.hooks.logouts) logout({ player: h.player });
  for (const login of h.hooks.logins) login({ player: h.player });
  assert.equal(h.quest.getStage(h.player), 44);
  assert.equal(h.xp.length, xpBeforeRelog, 'completion reward is not re-awarded on relog');
  assert.equal(h.quest.complete(h.player), false, 'completion is awarded once');
});

// ---------------------------------------------------------------------------
// Regression: captured sailing/deck route, eligibility and recovery
// ---------------------------------------------------------------------------

test('Current Affairs releases a moving duck, stops it on the captured tile and collects from the boat', () => {
  const h = makeHarness('../plugins/quests/quests/CurrentAffairs.Quest');
  const I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 40);
  h.inventory.set(I.CURRENT_DUCK, 1);
  const release = h.hooks.itemActions.get('Current duck')['Track-current'];

  release({ player: h.player });
  assert.match(h.messages.at(-1), /on your boat/);
  assert.equal(h.spawned.some((npc) => npc.getId() === 15152), false);

  h.varbits.set(19136, 1);
  h.sailing.activeBoatSlot = 0;
  h.sailing.boats = [{ slot: 0, location: { kind: 'at_sea', fineX: 3000 * 128, fineY: 3000 * 128 } }];
  release({ player: h.player });
  assert.match(h.messages.at(-1), /island east of Catherby/);

  h.sailing.boats[0].location = { kind: 'at_sea', fineX: 2837 * 128, fineY: 3414 * 128 };
  release({ player: h.player });
  const duck = h.spawned.find((npc) => npc.getId() === 15152);
  assert.ok(duck, 'the released moving duck exists');

  h.hooks.namedNpcs.get('Current duck').Collect({ player: h.player, npc: duck });
  assert.match(h.messages.at(-1), /still tracking/);
  assert.equal(h.inventory.get(I.CURRENT_DUCK), 1);

  h.tick(220);
  assert.equal(duck.transformedId, 15153);
  assert.ok(h.messages.includes('The current duck comes to a stop.'));

  h.sailing.boats[0].location = { kind: 'at_sea', fineX: 2802 * 128, fineY: 3322 * 128 };
  h.hooks.namedNpcs.get('Current duck').Collect({ player: h.player, npc: duck });
  assert.equal(h.varbits.get(18602), 1);
  assert.equal(h.attrs.get('current-affairs:currents-charted'), true);
  assert.ok(h.removed.includes(duck));
});

test('Current Affairs recovers a lost duck and a revoked form through the real variants', () => {
  const h = makeHarness('../plugins/quests/quests/CurrentAffairs.Quest');
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 40);
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.ARHEIN }),
    'going-with-the-flow-talking-to-arhein-without-the-duck');
  h.action(N.ARHEIN, 'VTzqPC');
  assert.equal(h.inventory.get(I.CURRENT_DUCK), 1, 'Arhein returns the wandering duck');

  h.quest.setStage(h.player, 10);
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.COUNCILLOR_CATHERINE }),
    'red-tape-talking-to-councillor-catherine');
  h.action(N.COUNCILLOR_CATHERINE, 'Xu9bQv');
  assert.equal(h.inventory.get(I.FORM_CR_4P), 1);
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.COUNCILLOR_CATHERINE }),
    'red-tape-talking-to-councillor-catherine-again');
});

test('Prying Times needs the boat deck at the crate and blocks when task slots are full', () => {
  const h = makeHarness('../plugins/quests/quests/PryingTimes.Quest');
  const use = h.hooks.genericObjects[0];
  h.quest.setStage(h.player, 25);
  use({ player: h.player, objectId: 58405 });
  assert.match(h.messages.at(-1), /on your boat at the crate/);

  h.varbits.set(19136, 1);
  h.sailing.activeBoatSlot = 0;
  h.sailing.boats = [{ slot: 0, location: { kind: 'at_sea', fineX: 3013 * 128, fineY: 2998 * 128 } }];
  use({ player: h.player, objectId: 58405 });
  assert.equal(h.transcripts.at(-1).variant, 'the-grog-reaching-the-sealed-crate');

  h.quest.setStage(h.player, 5);
  h.attrs.set('port-tasks:slots', [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
  h.action(h.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, 'nbTB-L');
  assert.equal(h.quest.getStage(h.player), 5, 'a full board cannot accept task 600');
  assert.match(h.messages.at(-1), /more port tasks/);
});

test('Prying Times start gate requires both quests, both skills and an open task slot', () => {
  const h = makeHarness('../plugins/quests/quests/PryingTimes.Quest', { Sailing: 12, Smithing: 30 });
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  let questsComplete = true, openSlot = true;
  h.hooks.custom.set('quest:is-complete', [(event) => {
    if (event.key === 'pandemonium' || event.key === 'the_knights_sword') event.complete = questsComplete;
  }]);
  h.hooks.custom.set('sailing:has-port-task-slot', [(event) => { event.available = openSlot; }]);
  h.inventory.set(I.CAPTAINS_LOG, 1);
  const condition = (stepId) => h.hooks.conditions[0]({ player: h.player, npcId: N.SQUAWKING_STEVE_BEANIE, stepId });
  assert.equal(condition('aifq0J'), false);
  assert.equal(condition('KQdAeL'), false);
  assert.equal(condition('PSw89b'), false);

  questsComplete = false; assert.equal(condition('aifq0J'), true); questsComplete = true;
  openSlot = false; assert.equal(condition('PSw89b'), true); openSlot = true;
  h.inventory.delete(I.CAPTAINS_LOG);
  assert.equal(condition('KQdAeL'), true);
});

test('Troubled Tortugans Floopa follows boarding, at-sea distance and disembark recovery', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  h.quest.setStage(h.player, 8);
  h.emit('sailing:boarded', {});
  assert.equal(h.quest.getStage(h.player), 10);
  const floopa = h.spawned.find((npc) => npc.getId() === 14987);
  assert.ok(floopa);

  h.sailing.activeBoatSlot = 0;
  h.sailing.boats = [{ slot: 0, location: { kind: 'at_sea', fineX: 2600 * 128, fineY: 2600 * 128 } }];
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: 14987 }).variant,
    'part-1-talking-to-injured-tortugan-with-the-makeshift-bandages-talking-to-floopa-whilst-at-sea');
  h.sailing.boats[0].location = { kind: 'at_sea', fineX: 3185 * 128, fineY: 2371 * 128 };
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: 14987 }).variant,
    'part-1-talking-to-injured-tortugan-with-the-makeshift-bandages-talking-to-floopa-near-the-gangplank');

  h.player.moveTo(new h.core.Location(3185, 2371, 0));
  h.emit('sailing:left', { reason: 'disembark' });
  assert.equal(h.quest.getStage(h.player), 12);
  assert.ok(h.spawned.some((npc) => npc.getId() === 14988));
  h.action(14988, 'bRB9K_');
  assert.equal(h.quest.getStage(h.player), 13);
});

test('Troubled Tortugans start requires Pandemonium and unboosted skills', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest', {}, ['../plugins/quests/quests/Pandemonium.Quest']);
  const N = h.core.NpcIdentifiers;
  const pandemonium = runtime.getRegisteredQuests().filter((quest) => quest.key === 'pandemonium').at(-1);
  const condition = () => h.hooks.conditions[0]({ player: h.player, npcId: N.INJURED_TORTUGAN, stepId: 'I3ziiG',
    text: 'If the player does not meet the requirements to begin the quest:' });

  assert.equal(condition(), true, 'Pandemonium not complete refuses the start');
  pandemonium.setStage(h.player, pandemonium.completionValue);
  assert.equal(condition(), false, 'completed Pandemonium plus max skills is eligible');

  const skills = h.player.getSkillManager();
  h.player.getSkillManager = () => ({
    ...skills,
    getMaxLevel: (skill) => (skill === h.core.Skill.SLAYER ? 50 : skills.getMaxLevel(skill)),
    getCurrentLevel: (skill) => (skill === h.core.Skill.SLAYER ? 99 : skills.getCurrentLevel(skill)),
  });
  assert.equal(condition(), true, 'a boosted current Slayer level cannot satisfy the unboosted requirement');
});

test('Troubled Tortugans Shellbane specials use captured attacks and the tortugan shield', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  const I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 34);
  h.player.moveTo(new h.core.Location(3355, 2205, 0));
  h.varbits.set(19136, 1);
  h.sailing.activeBoatSlot = 0;
  h.sailing.boats = [{ slot: 0, location: { kind: 'at_sea', fineX: 3354 * 128, fineY: 2216 * 128 } }];
  const random = Math.random;
  Math.random = () => 0; // whirlwind
  try {
    h.emit('sailing:boarded', {});
    h.tick(8);
    assert.equal(h.quest.getStage(h.player), 36);
    h.tick(8);
    assert.equal(h.hits.at(-1).getDamage(), 6, 'unshielded whirlwind hits for the captured 6');

    h.setShield(I.TORTUGAN_SHIELD, h.core.Equipment.CAPE_SLOT);
    h.tick(12);
    assert.equal(h.hits.at(-1).getDamage(), 2, 'the shield reduces the captured hit');
  } finally {
    Math.random = random;
  }
});

test('changed stage ladders migrate legacy saves once without re-awarding rewards', () => {
  const ca = makeHarness('../plugins/quests/quests/CurrentAffairs.Quest');
  ca.quest.setStage(ca.player, 11);
  ca.hooks.logins.forEach((fn) => fn({ player: ca.player }));
  assert.equal(ca.quest.getStage(ca.player), 45);
  assert.equal(ca.xp.length, 0, 'legacy completion does not award XP twice');

  const tt = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  tt.quest.setStage(tt.player, 33);
  tt.hooks.logins.forEach((fn) => fn({ player: tt.player }));
  assert.equal(tt.quest.getStage(tt.player), 44);
  assert.equal(tt.xp.length, 0);

  const pt = makeHarness('../plugins/quests/quests/PryingTimes.Quest');
  pt.quest.setStage(pt.player, 30);
  pt.hooks.logins.forEach((fn) => fn({ player: pt.player }));
  assert.equal(pt.quest.getStage(pt.player), 35);
  assert.equal(pt.xp.length, 0);
});

test('Troubled Tortugans Pearl cutscene keeps the captured 30-tick camera flight and resets', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  h.quest.setStage(h.player, 34);
  h.varbits.set(19136, 1);
  h.sailing.activeBoatSlot = 0;
  h.sailing.boats = [{ slot: 0, location: { kind: 'at_sea', fineX: 3354 * 128, fineY: 2216 * 128 } }];
  h.emit('sailing:boarded', {});
  h.tick(8); // approach watcher -> cutscene -> transcript + fallback begin
  assert.ok(h.packets.some((packet) => packet[0] === 'moveTo' && packet[1] === 3336 && packet[2] === 2207 && packet[3] === 1024));
  assert.ok(h.packets.some((packet) => packet[0] === 'lookAt' && packet[1] === 3336 && packet[2] === 2192));
  assert.equal(h.packets.filter((packet) => packet[0] === 'shake').length, 5);

  h.tick(6); // captured tick 2427 arc leg
  assert.ok(h.packets.some((packet) => packet[0] === 'moveArc' && packet[5] === 1024 && packet[6] === 300));
  assert.ok(h.packets.some((packet) => packet[0] === 'rotateBy' && packet[3] === 300));

  h.tick(10); // captured tick 2437 second shot
  assert.ok(h.packets.some((packet) => packet[0] === 'moveTo' && packet[1] === 3372 && packet[2] === 2223 && packet[3] === 1536));

  h.tick(5); // captured tick 2442 second arc
  assert.ok(h.packets.some((packet) => packet[0] === 'moveArc' && packet[5] === 1536 && packet[6] === 150));

  assert.equal(h.player.getMovementQueue().blocked, true, 'camera runs with controls held');
  h.tick(10); // captured tick 2451 reset
  assert.ok(h.packets.some((packet) => packet[0] === 'reset'));
  assert.ok(h.packets.some((packet) => packet[0] === 'unlock' && packet[1] === false));
  assert.equal(h.player.getMovementQueue().blocked, false, 'controls return with the camera reset');
});

test('Troubled Tortugans Pearl arrival is boat-driven, not a land-zone trigger', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  h.quest.setStage(h.player, 34);
  h.player.moveTo(new h.core.Location(3355, 2205, 0));
  h.hooks.zones[0].fn({ player: h.player });
  assert.equal(h.quest.getStage(h.player), 34, 'walking into the zone cannot start the assault');
  assert.equal(h.spawned.some((npc) => npc.getId() === 15001), false);

  h.varbits.set(19136, 1);
  h.sailing.activeBoatSlot = 0;
  h.sailing.boats = [{ slot: 0, location: { kind: 'at_sea', fineX: 3354 * 128, fineY: 2216 * 128 } }];
  h.emit('sailing:boarded', {});
  h.tick(6);
  assert.equal(h.quest.getStage(h.player), 36);
  const boss = h.spawned.find((npc) => npc.getId() === h.core.NpcIdentifiers.SHELLBANE_GRYPHON_2);
  assert.ok(boss, 'the boss is spawned for the owner on the moored boat deck');
  assert.equal(boss.def.owner, h.player);
  assert.equal(boss.def.ownerOnly, true);
});

test('Troubled Tortugans keeps the Pearl fight going when leaving the deck mid-fight', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  const N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 34);
  h.varbits.set(19136, 1);
  h.sailing.activeBoatSlot = 0;
  h.sailing.boats = [{ slot: 0, location: { kind: 'at_sea', fineX: 3354 * 128, fineY: 2216 * 128 } }];
  h.emit('sailing:boarded', {});
  h.tick(8);
  const deckBoss = h.spawned.find((npc) => npc.getId() === N.SHELLBANE_GRYPHON_2);
  assert.ok(deckBoss);
  deckBoss.setHitpoints(40);

  h.varbits.set(19136, 0);
  h.sailing.boats[0].location = { kind: 'docked', dock: 'the_little_pearl' };
  h.player.moveTo(new h.core.Location(3354, 2215, 0));
  h.emit('sailing:left', { reason: 'disembark' });
  assert.ok(h.removed.includes(deckBoss), 'the deck copy is removed');
  const landBoss = h.spawned.filter((npc) => npc.getId() === N.SHELLBANE_GRYPHON_2).at(-1);
  assert.notEqual(landBoss, deckBoss);
  assert.deepEqual([landBoss.getLocation().getX(), landBoss.getLocation().getY()], [3356, 2208],
    'the island fallback uses the captured Shellbane tile');
  assert.equal(landBoss.getHitpoints(), 40, 'earned damage is preserved across the deck change');
});

test('Prying Times owns Steve only after Pandemonium, so the captured start menu is reachable', () => {
  const h = makeHarness('../plugins/quests/quests/PryingTimes.Quest', {}, ['../plugins/quests/quests/Pandemonium.Quest']);
  const N = h.core.NpcIdentifiers;
  const prying = runtime.getRegisteredQuests().filter((quest) => quest.key === 'prying_times').at(-1);
  const pandemonium = runtime.getRegisteredQuests().filter((quest) => quest.key === 'pandemonium').at(-1);
  const variant = () => {
    for (const select of h.hooks.variants) {
      const result = select({ player: h.player, npcId: N.SQUAWKING_STEVE_BEANIE });
      if (result) return result;
    }
    return null;
  };
  pandemonium.setStage(h.player, 0);
  prying.setStage(h.player, 0);
  assert.equal(variant(), null, 'Prying yields to Pandemonium before its prerequisite is done');

  pandemonium.setStage(h.player, pandemonium.completionValue);
  prying.setStage(h.player, 0);
  assert.equal(variant(), 'starting-off');

  prying.setStage(h.player, prying.completionValue);
  const after = variant();
  assert.notEqual(after, 'starting-off', 'completed Prying hands Steve back to Pandemonium');
  assert.ok(after);
});

test('Current Affairs answers mNhEI- itself and its real duck branch shows the start menu when it wins', () => {
  const h = makeHarness('../plugins/quests/quests/CurrentAffairs.Quest', {}, ['../plugins/quests/quests/RecipeForDisaster.Quest']);
  const N = h.core.NpcIdentifiers;
  h.attrs.set('quest.pandemonium.stage', 50);
  const isComplete = h.hooks.custom.get('quest:is-complete') ?? [];
  h.hooks.custom.set('quest:is-complete', [...isComplete, (event) => {
    if (event.key === 'pandemonium') event.complete = true;
  }]);
  const condition = (stepId, npcId = N.ARHEIN) =>
    h.hooks.conditions[0]({ player: h.player, npcId, stepId, text: 'If the player does not meet the requirements to begin the quest:' });
  assert.equal(condition('mNhEI-'), false);
  assert.equal(condition('mNhEI-', N.ELDER_KOREL), null, 'conditions are scoped to Arhein/Harry/Catherine');

  const data = require('../data/definitions/npc-dialogues.json');
  const variant = data['Current Affairs'].variants['starting-off-talking-to-arhein'];
  const duck = variant.find((step) => step.type === 'choice').options
    .find((option) => option.text === "What's with the duck?");
  const resolveCondition = (step) => {
    for (const handler of h.hooks.conditions) {
      const answer = handler({ player: h.player, npcId: N.ARHEIN, stepId: step.id, text: step.text,
        pages: [{ page: 'Current Affairs' }] });
      if (typeof answer === 'boolean') return answer;
    }
    return null;
  };
  const flattened = npcDialogues.flatten(duck.steps, { resolveCondition });
  assert.ok(flattened.some((step) => step.type === 'choice' &&
    step.options?.some((option) => option.text === 'Yes.')), 'the real start choice is reachable');
  assert.equal(flattened.some((step) => step.type === 'message' && step.id === 'YodS62'), false);
});

test('Troubled Tortugans mandatory spawns match capture coordinates and are path-reachable', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers, R = h.core.RegionManager;
  assert.ok(h.persisted.some(([key, value]) => key === 'troubled-tortugans:stage-v2' && value === false));

  for (const login of h.hooks.logins) login({ player: h.player });
  h.emit('npc-dialogue:hook', { npcId: 14986, hook: 'quest:troubled-tortugans:start' });
  assert.equal(h.quest.getStage(h.player), 2, 'the raw island base id starts the quest');
  assert.ok(h.spawned.some((npc) => npc.getId() === 14986), 'the island tortugan is the raw base 14986');
  assert.equal(h.spawned.some((npc) => npc.getId() === 14990), false, 'no resolved duplicate spawn');
  assert.equal(CacheDefinitions.getNpc(14986).transformVarbit, 18321);
  assert.equal(CacheDefinitions.resolveNpc(14986, { getVarbit: () => 2, getVarp: () => 0 }).id, 14990);
  assert.equal(CacheDefinitions.resolveNpc(14986, { getVarbit: () => 6, getVarp: () => 0 }).id, 14991);
  assert.equal(CacheDefinitions.resolveNpc(14986, { getVarbit: () => 8, getVarp: () => 0 }).id, 14992);
  assert.deepEqual(h.hooks.variants[0]({ player: h.player, npcId: 14986 }),
    h.hooks.variants[0]({ player: h.player, npcId: N.INJURED_TORTUGAN }),
    'raw and resolved island ids select the same dialogue');
  assert.equal(CacheDefinitions.getNpc(14995).transformVarbit, 18321);
  assert.equal(CacheDefinitions.resolveNpc(14995, { getVarbit: () => 12, getVarp: () => 0 }).id, 14998);
  assert.deepEqual(h.hooks.variants[0]({ player: h.player, npcId: 14995 }),
    h.hooks.variants[0]({ player: h.player, npcId: N.ELDER_KOREL }),
    'raw and resolved docks Korel ids select the same dialogue');
  const seaweed = h.groundSpawns.find((spawn) => spawn.itemId === I.SEAWEED);
  assert.deepEqual({ x: seaweed.x, y: seaweed.y }, { x: 2962, y: 2600 });
  assert.equal(pathExists(R, [2962, 2604], [2962, 2600]), true, 'capture seaweed tile is reachable');

  h.quest.setStage(h.player, 14);
  h.action(N.ELDER_RALEY, '8dFZ4e');
  assert.equal(h.quest.getStage(h.player), 18);
  const scutes = h.groundSpawns.filter((spawn) => spawn.itemId === I.TORTUGAN_SCUTE).map(({ x, y }) => [x, y]).sort();
  const shells = h.groundSpawns.filter((spawn) => spawn.itemId === I.SEA_SHELL).map(({ x, y }) => [x, y]).sort();
  assert.deepEqual(scutes, [[3102,2415],[3110,2430],[3115,2407],[3118,2419],[3119,2443],[3131,2398]]);
  assert.deepEqual(shells, [[3161,2389],[3168,2388],[3179,2384],[3190,2379],[3191,2383],[3197,2376]]);
  for (const tile of [...scutes, ...shells]) assert.equal(pathExists(R, [3167, 2411], tile, 200), true, `spawn ${tile} is reachable`);

  h.quest.setStage(h.player, 26);
  h.player.setAttribute('troubled-tortugans:trail', 5);
  h.inventory.set(I.BRONZE_AXE, 1);
  h.hooks.namedObjects.get('Cave entrance').Unblock({ player: h.player, objectId: 58439 });
  h.action(N.ELDER_KOREL, '_IAdC-');
  assert.equal(h.quest.getStage(h.player), 28);
  h.option(N.ELDER_KOREL, 'Yes.');
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY()], [3168, 8874]);
  const gryphon = h.spawned.find((npc) => npc.getId() === N.GRYPHON_3);
  assert.deepEqual([gryphon.getLocation().getX(), gryphon.getLocation().getY()], [3178, 8873]);
  h.hooks.namedObjects.get('Cave exit').Exit({ player: h.player, objectId: 58442 });
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY()], [3175, 2478]);

  h.quest.setStage(h.player, 10);
  h.player.moveTo(new h.core.Location(3185, 2371, 0));
  h.emit('sailing:left', { reason: 'disembark' });
  const dockFloopa = h.spawned.find((npc) => npc.getId() === 14988);
  assert.deepEqual([dockFloopa.getLocation().getX(), dockFloopa.getLocation().getY()], [3186, 2370]);
});

test('actual Sailing.disembark payload carries the boat root for Troubled Tortugans', () => {
  const { Sailing } = require('../dist/game/content/sailing/Sailing');
  const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
  const { emptySailingState } = require('../dist/game/content/sailing/SailingState');
  const { Mobile } = require('../dist/game/entity/impl/Mobile');
  const { Location } = require('../dist/game/model/Location');
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { PluginManager } = require('../dist/plugins/PluginManager');

  Sailing.initialize();
  Sailing.registerBoatType({
    type: 'tt-test-raft', configId: 1, templateChunkX: 480, templateChunkY: 807,
    sizeX: 8, sizeZ: 8, hull: { offsetX: 0, offsetY: 0, width: 128, length: 384 },
    deckCentreX: 448, deckCentreY: 448, deckLevel: 1,
    walkableDeck: [{ x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }],
    boardingTile: { x: 3, y: 4 }, locs: [],
  });
  const dock = {
    id: 'tt-native5-conch', mooringPoint: true,
    mooring: { fineX: 3175 * 128 + 64, fineY: 2367 * 128 + 64, level: 0, angle: 1024 },
    landing: { x: 3174, y: 2368, z: 0 },
  };
  Sailing.registerDock(dock);
  let sailing = emptySailingState();
  let location = new Location(3174, 2368, 0);
  const player = Object.create(Mobile.prototype);
  Object.assign(player, {
    getIndex: () => 90601, isPlayer: () => true, isNpc: () => false, getAsPlayer: () => player,
    getUsername: () => 'tt-native5', sendMessage() {}, getLocation: () => location,
    setLocation: next => { location = next; return player; },
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {} }),
    setNeedsPlacement() {}, setResetMovementQueue() {}, setMobileInteraction() {},
    getSailing: () => sailing, setSailing: next => { sailing = next; },
    getPacketSender: () => new Proxy({}, { get: (_t, _k, proxy) => () => proxy }),
  });
  player.inventory = new Inventory(player); player.inventory.resetItems();
  player.getInventory = () => player.inventory;

  const originalEmit = PluginManager.emitCustomEvent;
  const emitted = [];
  PluginManager.emitCustomEvent = (name, event) => { emitted.push({ name, event }); };
  try {
    Sailing.giveBoat(player, 'tt-test-raft', dock.id);
    assert.equal(Sailing.board(player, dock.id), null);
    assert.equal(Sailing.disembark(player, dock.id), null);
  } finally {
    PluginManager.emitCustomEvent = originalEmit;
  }
  const left = emitted.find(entry => entry.name === 'sailing:left')?.event;
  assert.ok(left?.boat, 'disembark still carries the boat instance');
  assert.deepEqual(left.boat.worldTile(), { x: 3175, y: 2367, level: 0 });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3174, 2368]);
  assert.equal(BoatManager.getBoatAboard(player), undefined);

  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  const N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 10);
  h.player.moveTo(new h.core.Location(10116, 9604, 0)); // deck coords differ from the boat root
  h.emit('sailing:left', { reason: 'disembark', boat: left.boat });
  assert.equal(h.quest.getStage(h.player), 12, 'the real core payload advances the Conch disembark');
  assert.ok(h.spawned.some(npc => npc.getId() === 14988));
});

test('Troubled Tortugans ignores wrong-port disembark and starts the Pearl arrival from the boat root', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  h.quest.setStage(h.player, 10);
  h.player.moveTo(new h.core.Location(10116, 9604, 0));
  h.emit('sailing:left', { reason: 'disembark', boat: { worldTile: () => ({ x: 2796, y: 3407, level: 0 }) } });
  assert.equal(h.quest.getStage(h.player), 10, 'wrong port does not advance the Conch leg');
  assert.ok(!h.spawned.some(npc => npc.getId() === 14988));

  h.quest.setStage(h.player, 34);
  h.player.moveTo(new h.core.Location(10116, 9604, 0));
  h.emit('sailing:left', { reason: 'disembark', boat: { worldTile: () => ({ x: 3354, y: 2216, level: 0 }) } });
  assert.equal(h.quest.getStage(h.player), 36, 'Pearl landing uses the boat root, not deck coords');
  const sailor = h.spawned.find(npc => npc.getId() === 15001);
  assert.ok(sailor, 'cutscene sailor spawned');
  for (const logout of h.hooks.logouts) logout({ player: h.player });
  assert.ok(h.removed.includes(sailor), 'Pearl actors are removed on logout');
});

test('Troubled Tortugans Shellbane joins the real boat deck on the shipped arrival fallback', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  const N = h.core.NpcIdentifiers;
  const { BoatDeckArea } = require('../dist/game/content/sailing/BoatDeckArea');
  const boat = { deckBaseX: 11000, deckBaseY: 9600, sceneBaseX: 11000, sceneBaseY: 9600, containsDeckTile: () => true };
  const area = new BoatDeckArea(boat, { walkableDeck: [{ x: 4, y: 3 }], locs: [] });
  h.player.getPrivateArea = () => area;
  h.player.moveTo(new h.core.Location(11004, 9603, 0));
  h.quest.setStage(h.player, 34);
  h.varbits.set(19136, 1);
  h.sailing.activeBoatSlot = 0;
  h.sailing.boats = [{ slot: 0, location: { kind: 'at_sea', fineX: 3354 * 128, fineY: 2216 * 128 } }];

  h.emit('sailing:left', { reason: 'disembark', boat: { worldTile: () => ({ x: 3354, y: 2216, level: 0 }) } });
  assert.equal(h.quest.getStage(h.player), 36);
  h.tick(5);
  const deckBoss = h.spawned.find(npc => npc.getId() === N.SHELLBANE_GRYPHON_2);
  assert.ok(deckBoss, 'the shipped arrival fallback spawns Shellbane');
  assert.equal(deckBoss.getArea(), area, 'the deck boss joins the real BoatDeckArea');
  assert.ok(area.entities.includes(deckBoss), 'the deck area queues the boss for sync');
  assert.equal(deckBoss.getOwner(), h.player);

  deckBoss.setHitpoints(40);
  h.player.moveTo(new h.core.Location(3354, 2215, 0));
  h.varbits.set(19136, 0);
  h.sailing.boats[0].location = { kind: 'docked', dock: 'the_little_pearl' };
  h.emit('sailing:left', { reason: 'disembark', boat: { worldTile: () => ({ x: 3354, y: 2216, level: 0 }) } });
  assert.ok(h.removed.includes(deckBoss), 'disembarking removes the deck boss');
  const landBoss = h.spawned.filter(npc => npc.getId() === N.SHELLBANE_GRYPHON_2).at(-1);
  assert.notEqual(landBoss, deckBoss);
  assert.deepEqual([landBoss.getLocation().getX(), landBoss.getLocation().getY()], [3356, 2208]);
  assert.equal(landBoss.getHitpoints(), 40, 'earned damage follows the boss ashore');

  for (const logout of h.hooks.logouts) logout({ player: h.player });
  assert.ok(h.removed.includes(landBoss), 'logout cleanup removes the boss/actors');
  h.quest.setStage(h.player, 36);
  h.player.moveTo(new h.core.Location(3354, 2215, 0));
  const pearlZone = h.hooks.zones.find(entry => entry.zone.minX === 3338);
  pearlZone.fn({ player: h.player });
  const retryBoss = h.spawned.filter(npc => npc.getId() === N.SHELLBANE_GRYPHON_2).at(-1);
  assert.ok(retryBoss && retryBoss !== landBoss, 'zone re-entry retries the Shellbane');
  assert.deepEqual([retryBoss.getLocation().getX(), retryBoss.getLocation().getY()], [3356, 2208]);
});

test('Troubled Tortugans restores the captured combat_done Korel at stage 38 login', () => {
  const h = makeHarness('../plugins/quests/quests/TroubledTortugans.Quest');
  h.quest.setStage(h.player, 38);
  h.player.moveTo(new h.core.Location(3354, 2215, 0));
  for (const login of h.hooks.logins) login({ player: h.player });
  const korel = h.spawned.find((npc) => npc.getId() === 14999);
  assert.ok(korel, 'Pearl Korel actor restored');
  assert.equal(korel.transformedId, 15000, 'login restores the Talk-to combat_done form');
  assert.ok(h.core.NpcDefinition.forId(15000).getActions().includes('Talk-to'));
  const variant = h.hooks.variants[0]({ player: h.player, npcId: 15000 });
  assert.equal(typeof variant === 'string' ? variant : variant.variant,
    'part-3-talking-to-elder-korel');
  assert.equal(h.quest.getStage(h.player), 38, 'restoration does not inject progress');
});


// Coupon rewards are stackable: the quest's extra 24 must use engine overflow,
// not be skipped when the inventory is full.
function couponCompletion(pluginFile, key, completionStage) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { Item } = require('../dist/game/model/Item');
  const player = new Player(null);
  player.getUsername = () => 'coupon-parity';
  const sender = new Proxy({ getVarbit: () => 0, getVarp: () => 0,
    sendVarbit: () => sender, sendConfig: () => sender, sendString: () => sender,
    sendJingle: () => sender, sendInterfaceRemoval: () => sender, sendInterface: () => sender,
    sendInterfaceFlagsRange: () => sender, sendInterfaceScript: () => sender,
    sendItemOnInterfaces: () => sender, sendSubInterface: () => sender,
    closeSubInterface: () => sender, sendQuestList: () => sender,
  }, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  const api = PluginManager.createApi('coupon-parity-test');
  require(pluginFile)(api);
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === key).at(-1);
  quest.setStage(player, completionStage);
  return { player, quest, Item };
}

test('Current Affairs and Prying Times keep all 25 stackable coupons under full inventory', () => {
  const { Item: ItemClass } = require('../dist/game/model/Item');
  const { World } = require('../dist/game/World');
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const cases = [
    ['../plugins/quests/quests/CurrentAffairs.Quest', 'current_affairs', 44],
    ['../plugins/quests/quests/PryingTimes.Quest', 'prying_times', 34],
  ];
  for (const [file, key, completionStage] of cases) {
    for (const mode of ['zeroFree', 'oneFree', 'existingStack']) {
      const { player, quest } = couponCompletion(file, key, completionStage);
      const inv = player.getInventory();
      const filler = I.MAYOR_OF_CATHERBY;
      const fill = mode === 'zeroFree' ? 28 : mode === 'oneFree' ? 27 : 27;
      for (let i = 0; i < fill; i++) inv.addItem(new ItemClass(filler, 1));
      if (mode === 'existingStack') inv.addItem(new ItemClass(I.SAWMILL_COUPON_OAK_PLANK_, 1));
      const before = inv.getAmount(I.SAWMILL_COUPON_OAK_PLANK_);
      quest.complete(player);
      const inBag = inv.getAmount(I.SAWMILL_COUPON_OAK_PLANK_) - before;
      const onGround = (World.getItems() ?? [])
        .filter((entry) => entry.getItem?.()?.getId?.() === I.SAWMILL_COUPON_OAK_PLANK_)
        .reduce((sum, entry) => sum + (entry.getItem?.()?.getAmount?.() ?? 0), 0);
      if (mode === 'zeroFree') {
        // QuestRuntime's default auto-1 overflow is owned by the common worker;
        // this quest's extra 24 must reach the reward tile instead of vanishing.
        assert.equal(onGround >= 24, true, `${key} zeroFree: extra 24 dropped at reward tile (ground ${onGround})`);
      } else {
        assert.equal(inBag, 25, `${key} ${mode}: all 25 stack in one slot`);
      }
    }
  }
});

test('completed Current Affairs Arhein still replaces a lost duck', () => {
  const h = makeHarness('../plugins/quests/quests/CurrentAffairs.Quest');
  const N = h.core.NpcIdentifiers, I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 45);
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.ARHEIN }),
    'going-with-the-flow-talking-to-arhein-without-the-duck');
  h.action(N.ARHEIN, 'VTzqPC');
  assert.equal(h.inventory.get(I.CURRENT_DUCK), 1);
  h.inventory.set(I.CURRENT_DUCK, 1);
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: N.ARHEIN }),
    'starting-off-talking-to-arhein-again');
});
