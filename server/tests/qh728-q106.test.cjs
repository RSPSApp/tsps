const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const { flatten } = require('../plugins/npcs/NpcDialogues.plugin');

const DIALOGUES = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8')
);
const SLUG_PAGE = 'The Slug Menace';
const V_TIFFY_LOST_ORB = 'starting-off-talking-to-sir-tiffy-cashien-after-losing-the-commorb';

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});

let nextIndex = 100;

function setup(options = {}) {
  const makeSink = () => ({
    custom: new Map(),
    variants: [],
    conditions: [],
    objects: [],
    itemOnObject: [],
    itemOnItem: [],
    itemAction: [],
    interfaceActions: [],
    groundPickups: [],
    namedNpcs: new Map(),
    login: [],
    logout: [],
    spawned: [],
    removed: [],
  });
  const hooks = makeSink();
  const dmHooks = makeSink();
  // The plugin that is being registered right now owns the sink, so the
  // Devious Minds hooks never shadow the Slug Menace ones.
  let sink = hooks;
  const tasks = [];
  // The real PluginManager api, so the pickup and prose-condition hooks are
  // registered where the server registers them and the real dispatch paths
  // (PluginManager.emitGroundItemPickup / emitNpcDialogueCondition) reach them.
  const realApi = PluginManager.createApi('qh728-q106');
  PluginManager.groundItemPickupHooks.length = 0;
  PluginManager.npcDialogueConditionHooks.length = 0;
  PluginManager.npcDialogueVariantHooks.length = 0;
  PluginManager.interfaceActionClickHooks.length = 0;
  const core = {
    ...PluginManager.getCoreApi(),
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    TaskManager: { submit(task) { tasks.push(task); } },
  };
  const ground = new Map();
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { sink.variants.push(fn); realApi.onNpcDialogueVariant(fn); },
    onNpcDialogueCondition(fn) { sink.conditions.push(fn); realApi.onNpcDialogueCondition(fn); },
    onNpcInteraction(target, actions) { if (typeof target === 'string') sink.namedNpcs.set(target, actions); },
    onObjectInteraction(target) { if (typeof target === 'function') sink.objects.push(target); },
    onItemOnObject(...args) { sink.itemOnObject.push(typeof args[0] === 'function' ? args[0] : args.at(-1)); },
    onItemOnItem(...args) { sink.itemOnItem.push(typeof args[0] === 'function' ? args[0] : args.at(-1)); },
    onItemAction(...args) { sink.itemAction.push(typeof args[0] === 'function' ? args[0] : args.at(-1)); },
    onInterfaceActionButton(buttonIds, fn) {
      sink.interfaceActions.push({ buttonIds: [].concat(buttonIds), fn });
      realApi.onInterfaceActionButton(buttonIds, fn);
    },
    onGroundItemPickup(fn) { sink.groundPickups.push(fn); realApi.onGroundItemPickup(fn); },
    onPlayerLogin(fn) { sink.login.push(fn); },
    onPlayerLogout(fn) { sink.logout.push(fn); },
    onCustomEvent(name, fn) { const list = sink.custom.get(name) ?? []; list.push(fn); sink.custom.set(name, list); },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && event?.key) {
        const entry = runtime.getRegisteredQuests().find((quest) => quest.key === event.key);
        if (entry && event.player) event.complete = entry.isComplete(event.player);
        else if (event.key === 'while_guthix_sleeps') event.complete = wgsComplete;
        else event.complete = event.key === 'wanted' || event.key === 'sea_slug';
      }
      if (name === 'quest:is-started' && event?.key) {
        const entry = runtime.getRegisteredQuests().find((quest) => quest.key === event.key);
        if (entry && event.player) event.started = entry.isStarted(event.player);
      }
      if (name === 'quest:get-stage' && event?.key) {
        const entry = runtime.getRegisteredQuests().find((quest) => quest.key === event.key);
        if (entry && event.player) event.stage = entry.getStage(event.player);
      }
      for (const fn of sink.custom.get(name) ?? []) fn(event);
    },
    getItemOnGroundManager() {
      return {
        getGroundItem(username, itemId) { return ground.get(`${username}:${itemId}`) ?? null; },
        registerLocation(player, item, location) {
          const key = `${player.getUsername()}:${item.getId()}`;
          ground.set(key, { item, location });
        },
      };
    },
    spawnNpc(def) {
      const npc = { def, getId: () => def.id, getOwner: () => def.owner, isNpc: () => true, isPlayer: () => false };
      hooks.spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { hooks.removed.push(npc); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  if (options.deviousMinds) {
    // Quests.plugin.js loads Devious Minds before The Slug Menace, so the
    // shared Sir Tiffy dispatch sees it first.
    sink = dmHooks;
    require('../plugins/quests/quests/DeviousMinds.Quest')(api);
    sink = hooks;
  }
  require('../plugins/quests/quests/SlugMenace.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const attrs = new Map();
  const inventory = new Map();
  const varbits = new Map();
  const configs = new Map();
  const messages = [];
  const xp = [];
  const jingles = [];
  let wgsComplete = false;
  let freeSlots = 20;
  let location = new core.Location(2996, 3373, 0);
  let currentDialogue = null;
  let interfaceId = -1;

  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    getVarp(id) { return configs.get(id) ?? 0; },
    sendInterface(id) { interfaceId = id; return sender; },
    sendSubInterface(target, id, type) { interfaces.push({ target, id, type }); return sender; },
    sendJingle(id, delay) { jingles.push(id); return sender; },
    sendInterfaceRemoval() { currentDialogue = null; interfaceId = -1; return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const interfaces = [];

  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    getInterfaceId: () => interfaceId,
    sendMessage(message) { messages.push(message); },
    getUsername: () => 'q106test',
    isRegistered: () => true,
    getPrivateArea: () => null,
    getLocation: () => location,
    moveTo(value) { location = value; },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      isFull: () => freeSlots <= 0,
      getFreeSlots: () => freeSlots,
      adds(id, count = 1) {
        inventory.set(id, (inventory.get(id) ?? 0) + count);
        // Items take up room, so a full bag behaves like one.
        freeSlots = Math.max(0, freeSlots - count);
        return true;
      },
      deleteNumber(id, count) {
        inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count));
        freeSlots += count;
      },
      forceAdd(owner, item) { inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()); },
    }),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCurrentLevel: () => 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getDialogueManager: () => ({
      startDialogues(chain) { currentDialogue = chain; },
      getCurrent: () => currentDialogue,
      reset() { currentDialogue = null; },
      isActive: () => Boolean(currentDialogue),
      advance() {},
    }),
    getCombat: () => null,
    getEquipment: () => ({ get: () => null }),
  };

  const emit = (name, event) => api.emitCustomEvent(name, { player, ...event });
  const action = (npcId, stepId) => { const event = { player, npcId, stepId }; api.emitCustomEvent('npc-dialogue:action', event); return event; };
  const line = (npcId, text) => { const event = { player, npcId, text }; api.emitCustomEvent('npc-dialogue:line', event); return event; };
  const variant = (npcId) => hooks.variants[0]({ player, npcId });
  const condition = (stepId) => hooks.conditions[0]({ player, stepId });

  return {
    api, core, hooks, quest, attrs, inventory, varbits, configs, messages, xp, jingles,
    player, tasks, emit, action, line, variant, condition, interfaces,
    click(buttonChild) {
      const event = { player, buttonId: (462 << 16) | buttonChild, action: 1, handled: false };
      PluginManager.emitInterfaceActionClick(event);
      return event;
    },
    setFreeSlots(value) { freeSlots = value; },
    setWgsComplete(value) { wgsComplete = value; },
    getLocation: () => location,
    getDialogue: () => currentDialogue,
  };
}

const I = PluginManager.getCoreApi().ItemIdentifiers;
const N = PluginManager.getCoreApi().NpcIdentifiers;
const STAGE_KEY = 'quest.the_slug_menace.stage';

/** The shape ItemOnGroundManager emits for a pickup (PluginGroundItemInteractionEvent). */
function groundPickup(player, groundItemId) {
  return {
    player,
    groundItem: { getItem: () => ({ getId: () => groundItemId }) },
    groundItemId,
    clickType: 1,
    location: { x: 2334, y: 5093, z: 0 },
    handled: false,
  };
}

/**
 * Runs the lost-Commorb variant through the real transcript flattening with the
 * plugin's own condition resolver, so the selected branch is the one the
 * dialogue engine picks, not a hand-picked step id.
 */
function selectLostOrbCondition(h) {
  let chosen = null;
  const steps = flatten(DIALOGUES[SLUG_PAGE].variants[V_TIFFY_LOST_ORB], {
    resolveCondition: (step) => h.condition(step.id),
    wrapBranch: (condition, branch) => { chosen = condition.id; return branch; },
  });
  const line = steps.find((step) => step.type === 'line');
  return { condition: chosen, line: line?.text };
}

/**
 * Plays a transcript variant the way NpcDialogues does: the engine's own
 * flatten() picks the branch through the real PluginManager condition dispatch
 * (the plugin's prose answers) and emits "npc-dialogue:condition" for the
 * chosen condition before the guarded line's "npc-dialogue:line".
 * Returns the events in the order the engine fires them.
 */
function playVariant(h, variant) {
  const definition = { getId: () => N.SIR_TIFFY_CASHIEN, getName: () => 'Sir Tiffy Cashien' };
  const events = [];
  const queue = flatten(DIALOGUES[SLUG_PAGE].variants[variant], {
    resolveCondition: (step) => PluginManager.emitNpcDialogueCondition({
      player: h.player, npcId: N.SIR_TIFFY_CASHIEN, definition, text: step.text, stepId: step.id,
    }),
    wrapBranch: (chosen, branch) => [
      { type: 'condition_chosen', id: chosen.id, text: chosen.text },
      ...branch,
    ],
  });
  for (const step of queue) {
    if (step.type === 'condition_chosen') {
      events.push({ type: 'condition', stepId: step.id });
      h.api.emitCustomEvent('npc-dialogue:condition', {
        player: h.player, npcId: N.SIR_TIFFY_CASHIEN, definition, text: step.text, stepId: step.id,
      });
    } else if (step.type === 'line' && typeof step.text === 'string') {
      events.push({ type: 'line', text: step.text });
      h.api.emitCustomEvent('npc-dialogue:line', {
        player: h.player, npcId: N.SIR_TIFFY_CASHIEN, definition, text: step.text, step, skip: false,
      });
    }
  }
  return events;
}

/** The real ground-item pickup dispatch (ItemOnGroundManager -> PluginManager -> hook). */
function pickup(h, itemId) {
  const firstTask = h.tasks.length;
  PluginManager.emitGroundItemPickup(groundPickup(h.player, itemId));
  // Production dispatch precedes capacity validation and the actual inventory add.
  if (h.player.getInventory().getFreeSlots() > 0) h.player.getInventory().adds(itemId, 1);
  h.tasks.slice(firstTask).forEach(task => task.run());
}

test('start from stage 0 converts the Commorb and advances to stage 1', () => {
  const h = setup();
  h.inventory.set(I.COMMORB, 1);
  assert.equal(h.variant(N.SIR_TIFFY_CASHIEN),
    'starting-off-talking-to-sir-tiffy-cashien-to-start-the-quest');
  h.emit('npc-dialogue:hook', { npcId: N.SIR_TIFFY_CASHIEN, hook: 'quest:the-slug-menace:start' });
  assert.equal(h.attrs.get(STAGE_KEY), 1);
  assert.equal(h.inventory.get(I.COMMORB) ?? 0, 0);
  assert.equal(h.inventory.get(I.COMMORB_V2), 1);
  h.emit('npc-dialogue:condition', { npcId: N.SIR_TIFFY_CASHIEN, stepId: 'Z3OYJz' });
  assert.equal(h.inventory.get(I.COMMORB_V2), 1);
});

test('a stage-0 lost Commorb is reclaimed from Sir Tiffy', () => {
  const h = setup();
  assert.equal(h.variant(N.SIR_TIFFY_CASHIEN),
    'starting-off-talking-to-sir-tiffy-cashien-after-losing-the-commorb');
  h.line(N.SIR_TIFFY_CASHIEN, 'Very careless of you, what? Here, take another, but be careful of this one!');
  assert.equal(h.inventory.get(I.COMMORB), 1);
  assert.equal(h.inventory.get(I.COMMORB_V2) ?? 0, 0);
});

test('the lost-Commorb condition grants the original Commorb before the mission', () => {
  const h = setup();
  // The real transcript selection: the sibling run qD7fRj (no space) / M3YJU2 (space)
  // is resolved through the real PluginManager condition dispatch.
  const chosen = selectLostOrbCondition(h);
  assert.equal(chosen.condition, 'M3YJU2');

  // The engine chooses the condition before its guarded line runs.
  const events = playVariant(h, V_TIFFY_LOST_ORB);
  assert.deepEqual(events, [
    { type: 'condition', stepId: 'M3YJU2' },
    { type: 'line', text: 'Very careless of you, what? Here, take another, but be careful of this one!' },
  ]);

  // The recovery branch hands back the original Commorb, not the Commorb v2.
  assert.equal(h.inventory.get(I.COMMORB), 1);
  assert.equal(h.inventory.get(I.COMMORB_V2) ?? 0, 0);
});

test('a full inventory selects the no-space branch and grants nothing', () => {
  const h = setup();
  h.setFreeSlots(0);
  const chosen = selectLostOrbCondition(h);
  assert.equal(chosen.condition, 'qD7fRj');
  const events = playVariant(h, V_TIFFY_LOST_ORB);
  assert.deepEqual(events, [
    { type: 'condition', stepId: 'qD7fRj' },
    { type: 'line', text: 'Free up some inventory space first, what?' },
  ]);
  assert.equal(h.inventory.get(I.COMMORB) ?? 0, 0);
  assert.equal(h.inventory.get(I.COMMORB_V2) ?? 0, 0);
});

test('an in-quest lost Commorb is replaced with the Commorb v2', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 4);
  const chosen = selectLostOrbCondition(h);
  assert.equal(chosen.condition, 'M3YJU2');
  h.emit('npc-dialogue:condition', { npcId: N.SIR_TIFFY_CASHIEN, stepId: chosen.condition });
  assert.equal(h.inventory.get(I.COMMORB_V2), 1);
  assert.equal(h.inventory.get(I.COMMORB) ?? 0, 0);
});

test('post-quest Sir Tiffy returns a lost Commorb v2 and skips the WGS line', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 14);
  assert.equal(h.condition('fOsyy-'), true);
  assert.equal(h.condition('upb-U5'), false);
  h.action(N.SIR_TIFFY_CASHIEN, 'usNZAT');
  assert.equal(h.inventory.get(I.COMMORB_V2), 1);

  const full = setup();
  full.attrs.set(STAGE_KEY, 14);
  full.setFreeSlots(0);
  full.action(N.SIR_TIFFY_CASHIEN, 'usNZAT');
  assert.equal(full.inventory.get(I.COMMORB_V2) ?? 0, 0);

  const wgs = setup();
  wgs.setWgsComplete(true);
  assert.equal(wgs.condition('upb-U5'), true);
});

test('the ruin climb lands in the hobgoblin dungeon and the false wall leads onward', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 4);
  h.inventory.set(I.COMMORB_V2, 1);
  const climbs = [];
  h.api.onCustomEvent('ladders:climbDown', (event) => climbs.push(event));
  h.api.onCustomEvent('ladders:climbUp', (event) => climbs.push(event));

  const ruin = { getLocation: () => new h.core.Location(2696, 3283, 0) };
  h.hooks.custom.get('ladders:climb')[0]({ player: h.player, objectId: 18270, object: ruin });
  assert.equal(climbs.at(-1).destination.getX(), 2696);
  assert.equal(climbs.at(-1).destination.getY(), 9684); // rsprox 236/03965.txt:6304

  const exit = { getLocation: () => new h.core.Location(2696, 9682, 0) };
  h.hooks.custom.get('ladders:climb')[0]({ player: h.player, objectId: 18354, object: exit });
  assert.equal(climbs.at(-1).destination.getX(), 2697);
  assert.equal(climbs.at(-1).destination.getY(), 3283);

  const push = { player: h.player, objectId: 19124, option: 'push', location: { x: 2701, y: 9688, z: 0 } };
  h.hooks.objects[0](push);
  assert.equal(push.handled, true);
  assert.equal(h.attrs.get('quest.the_slug_menace.wall-open'), 1);
  assert.equal(h.varbits.get(2618), 1);

  h.hooks.objects[0]({ player: h.player, objectId: 19124, option: 'enter', location: { x: 2701, y: 9688, z: 0 } });
  assert.equal(h.getLocation().getX(), 2324); // rsprox 236/03965.txt:6490
  assert.equal(h.getLocation().getY(), 5104);

  h.hooks.objects[0]({ player: h.player, objectId: 18412, option: 'enter', location: { x: 2322, y: 5104, z: 0 } });
  assert.equal(h.getLocation().getX(), 2701);
  assert.equal(h.getLocation().getY(), 9688);
});

test('scanning near the door grants the transcription and advances to stage 5', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 4);
  h.line(N.COL_ONIALL, 'I have added a transcript of the runes into your pack.');
  assert.equal(h.inventory.get(I.DOOR_TRANSCRIPTION), 1);
  assert.equal(h.attrs.get(STAGE_KEY), 5);
  assert.equal(h.varbits.get(2610), 4);
  assert.equal(h.varbits.get(2613), 1);
});

test('the dead sea slug pickup advances varbit 2631 from the registered dispatch', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 4);
  // The real pickup dispatch: the registered event carries the item id as
  // `groundItemId` (PluginGroundItemInteractionEvent), not `itemId`.
  pickup(h, I.DEAD_SEA_SLUG);
  assert.equal(h.varbits.get(2631), 1);
});

test('pickups of other items do not advance the slug varbit', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 4);
  pickup(h, I.DOOR_TRANSCRIPTION);
  assert.equal(h.varbits.get(2631), undefined);

  // A finished quest never re-opens the slug step.
  const done = setup();
  done.attrs.set(STAGE_KEY, 14);
  pickup(done, I.DEAD_SEA_SLUG);
  assert.equal(done.varbits.get(2631), undefined);
});

test('the cache page-reassembly widget controls solve and preserve the fragment puzzle', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 9);
  h.inventory.set(I.FRAGMENT_1, 1);
  h.inventory.set(I.FRAGMENT_2, 1);
  h.inventory.set(I.FRAGMENT_3, 1);
  h.inventory.set(I.SWAMP_PASTE, 1);
  const paste = { player: h.player, usedItemId: I.SWAMP_PASTE, usedWithItemId: I.FRAGMENT_1 };
  h.hooks.itemOnItem[0](paste);
  assert.equal(paste.handled, true);
  assert.equal(h.attrs.get(STAGE_KEY), 10);

  pickup(h, I.DEAD_SEA_SLUG);
  assert.equal(h.varbits.get(2631), 1);
  h.line(N.BAILEY, 'That should do the trick.');
  assert.equal(h.inventory.get(I.DEAD_SEA_SLUG) ?? 0, 0);
  assert.equal(h.inventory.get(I.SEA_SLUG_GLUE), 1);
  assert.equal(h.attrs.get(STAGE_KEY), 11);
  assert.equal(h.varbits.get(2631), 0);

  const glue = { player: h.player, usedItemId: I.SEA_SLUG_GLUE, usedWithItemId: I.FRAGMENT_2 };
  h.hooks.itemOnItem[0](glue);
  assert.equal(glue.handled, true);
  assert.equal(h.quest.getStage(h.player), 11, 'using glue opens the puzzle without completing it');
  assert.equal(h.player.getInterfaceId(), 460);
  assert.deepEqual(h.interfaces.at(-1), { target: (460 << 16) | 8, id: 462, type: 0 });
  assert.equal(h.inventory.get(I.FRAGMENT_1), 1);
  assert.equal(h.inventory.get(I.FRAGMENT_2), 1);
  assert.equal(h.inventory.get(I.FRAGMENT_3), 1);
  assert.equal(h.inventory.get(I.SEA_SLUG_GLUE), 1);
  assert.deepEqual([876, 877, 880, 881, 884, 885].map((varp) => h.configs.get(varp)), [40, 33, 40, 32, 40, 35]);

  h.click(8); // Flip piece 1.
  h.click(3); // Rotate piece 1.
  assert.equal(h.configs.get(878), 1);
  assert.equal(h.configs.get(879), 1);
  assert.equal(h.quest.getStage(h.player), 11);
  h.api.emitCustomEvent('interface:closed', { player: h.player, interfaceId: 460 });
  h.click(8);
  assert.equal(h.configs.get(878), 1, 'closing the display ignores stale button clicks');
  h.hooks.itemOnItem[0]({ player: h.player, usedItemId: I.SEA_SLUG_GLUE, usedWithItemId: I.FRAGMENT_1 });
  for (const fn of h.hooks.logout) fn({ player: h.player });
  for (let varp = 876; varp <= 887; varp++) h.configs.delete(varp);
  for (const fn of h.hooks.login) fn({ player: h.player });
  assert.deepEqual([878, 879].map((varp) => h.configs.get(varp)), [1, 1],
    'login reconstructs the saved puzzle state into the new client varps');
  h.click(8);
  assert.equal(h.configs.get(878), 1, 'a logged-out puzzle ignores stale button clicks');
  assert.equal(h.quest.getStage(h.player), 11, 'logout does not complete the puzzle');
  h.hooks.itemOnItem[0]({ player: h.player, usedItemId: I.SEA_SLUG_GLUE, usedWithItemId: I.FRAGMENT_1 });

  h.click(13); h.click(14); // Deselect piece 1, select piece 2 (QH route).
  for (let step = 0; step < 4; step++) h.click(5);
  h.click(8); h.click(3); // Piece 2, deliberately outside the helper's ±2 range.
  assert.equal(h.configs.get(880), 44);
  assert.equal(h.quest.getStage(h.player), 11, 'a correctly oriented but misplaced piece does not finish the puzzle');
  for (let step = 0; step < 4; step++) h.click(6);
  h.click(14); h.click(15); h.click(8); h.click(3); // Deselect piece 2, select piece 3.
  assert.equal(h.inventory.get(I.FRAGMENT_1) ?? 0, 0);
  assert.equal(h.inventory.get(I.FRAGMENT_2) ?? 0, 0);
  assert.equal(h.inventory.get(I.FRAGMENT_3) ?? 0, 0);
  assert.equal(h.inventory.get(I.SEA_SLUG_GLUE) ?? 0, 0);
  assert.equal(h.inventory.get(I.PAGE_3), 1);
  assert.equal(h.attrs.get(STAGE_KEY), 12);
  assert.equal(h.configs.get(875), 1, 'the solved widget sets native slug2_fragment_complete');
  assert.equal(h.varbits.get(2611), 1);
  assert.equal(h.varbits.get(2619), 0);
});

test('shaping a page uses essence and yields the matching blank rune', () => {
  const h = setup();
  const original = Math.random;
  try {
    Math.random = () => 0;
    h.attrs.set(STAGE_KEY, 12);
    h.inventory.set(I.PAGE_1, 1);
    h.inventory.set(I.CHISEL, 1);
    h.inventory.set(I.RUNE_ESSENCE, 1);
    const shape = { player: h.player, itemId: I.PAGE_1, option: 'Shape-Air', handled: false };
    h.hooks.itemAction[0](shape);
    assert.equal(shape.handled, true);
    h.action(N.SAVANT, '0thYWr');
    assert.equal(h.inventory.get(I.RUNE_ESSENCE) ?? 0, 0);
    assert.equal(h.inventory.get(I.BLANK_AIR_RUNE), 1);
  } finally {
    Math.random = original;
  }
});

test('using all five runes on the door opens it', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 12);
  h.inventory.set(I.COMMORB_V2, 1);
  const runes = [I.AIR_RUNE_6, I.WATER_RUNE_6, I.EARTH_RUNE_4, I.FIRE_RUNE_6, I.MIND_RUNE_4];
  for (const rune of runes) h.inventory.set(rune, 1);
  for (const rune of runes) {
    h.hooks.itemOnObject[0]({ player: h.player, itemId: rune, objectId: 18413 });
    assert.equal(h.inventory.get(rune) ?? 0, 0);
  }
  assert.equal(h.attrs.get('quest.the_slug_menace.used-runes'), 31);
  assert.equal(h.attrs.get('quest.the_slug_menace.door-revealed'), 1);
  assert.equal(h.varbits.get(2620), 1);
});

test('the final hand-in completes on varbit 2610 = 14 exactly once', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 13);
  h.action(N.SIR_TIFFY_CASHIEN, 'YMQ0V4');
  assert.equal(h.attrs.get(STAGE_KEY), 14);
  assert.equal(h.varbits.get(2610), 14);
  assert.equal(h.attrs.get('quest.points'), 1);
  assert.equal(h.xp.reduce((sum, entry) => sum + entry.amount, 0), 10500);
  assert.deepEqual(h.jingles, [238]);

  h.action(N.SIR_TIFFY_CASHIEN, 'YMQ0V4');
  assert.equal(h.attrs.get(STAGE_KEY), 14);
  assert.equal(h.attrs.get('quest.points'), 1);
  assert.equal(h.xp.reduce((sum, entry) => sum + entry.amount, 0), 10500);
});

test('login replays the durable stage and sub-varbits', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 12);
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(2610), 11);
  h.hooks.login[0]({ player: h.player });
  assert.equal(h.varbits.get(2611), 1);
  assert.equal(h.varbits.get(2612), 1);
  assert.equal(h.varbits.get(2613), 1);

  // The slug varbit replays from the held item.
  h.attrs.set(STAGE_KEY, 4);
  h.inventory.set(I.DEAD_SEA_SLUG, 1);
  h.hooks.login[0]({ player: h.player });
  assert.equal(h.varbits.get(2631), 1);
  h.inventory.delete(I.DEAD_SEA_SLUG, 1);
  h.hooks.login[0]({ player: h.player });
  assert.equal(h.varbits.get(2631), 0);

  h.attrs.set(STAGE_KEY, 14);
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(2610), 14);
});

test('the stage graph advances from the briefing to the page search', () => {
  const h = setup();
  h.inventory.set(I.COMMORB_V2, 1);
  h.attrs.set(STAGE_KEY, 1);
  assert.equal(h.variant(N.COL_ONIALL), 'witchaven-talking-to-col-o-niall');
  assert.equal(h.attrs.get(STAGE_KEY), 2);

  assert.equal(h.variant(N.MAYOR_HOBB), 'witchaven-talking-to-mayor-hobb-2');
  assert.equal(h.variant(N.BROTHER_MALEDICT), 'witchaven-talking-to-brother-maledict-2');
  h.hooks.namedNpcs.get('Holgart')['Talk-to']({ player: h.player, npcId: N.HOLGART });
  assert.equal(h.attrs.get(STAGE_KEY), 3);
  assert.equal(h.varbits.get(2614), 1);
  assert.equal(h.varbits.get(2615), 1);
  assert.equal(h.varbits.get(2616), 1);

  assert.equal(h.variant(N.COL_ONIALL), 'witchaven-talking-to-col-o-niall-after-talking-to-mayor-hobb');
  assert.equal(h.attrs.get(STAGE_KEY), 4);

  h.attrs.set(STAGE_KEY, 5);
  assert.equal(h.variant(N.JORRAL), 'the-pages-talking-to-jorral');
  assert.equal(h.attrs.get(STAGE_KEY), 6);

  h.player.getDialogueManager().reset();
  h.line(N.JORRAL, 'Uh, right. Goodbye.');
  h.tasks.at(-1).run();
  assert.equal(h.attrs.get(STAGE_KEY), 7);
  assert.equal(h.varbits.get(2612), 1);

  assert.equal(h.variant(N.COL_ONIALL), 'the-pages-talking-to-col-o-niall-after-learning-abotu-mother-mallum');
  assert.equal(h.attrs.get(STAGE_KEY), 8);
  assert.equal(h.variant(N.BROTHER_MALEDICT), 'the-pages-talking-to-maledict-after-learning-about-mother-mallum');
  assert.equal(h.attrs.get('quest.the_slug_menace.maledict-asked'), 1);
  // The request moves the wire on to the page leg (native 9).
  assert.equal(h.attrs.get(STAGE_KEY), 9);
  assert.equal(h.varbits.get(2610), 9);
});

test('the durable stage is written as the native SLUG2_MAIN value', () => {
  // Quest Helper keys its steps on the native value and the cache's NPC
  // transforms are indexed by it, so the plugin's own stage numbers are
  // translated on the wire (varbit 2610).
  const native = {
    0: 0, 1: 1, 2: 2, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6,
    8: 8, 9: 9, 10: 10, 11: 11, 12: 11, 13: 12, 14: 14,
  };
  for (const [stage, value] of Object.entries(native)) {
    const h = setup();
    h.attrs.set(STAGE_KEY, Number(stage));
    runtime.sendQuestVarps({ player: h.player });
    assert.equal(h.varbits.get(2610), value, `durable stage ${stage}`);
  }
});

test('Sir Tiffy is yielded to Devious Minds while its hand-in is due', () => {
  const h = setup({ deviousMinds: true });
  h.attrs.set(STAGE_KEY, 5);
  h.inventory.set(I.COMMORB_V2, 1);
  h.attrs.set('quest.devious_minds.stage', 9);

  // The real dispatch: Devious Minds is registered first (as Quests.plugin.js
  // loads it) and answers for Sir Tiffy while its hand-in is due.
  assert.equal(
    PluginManager.emitNpcDialogueVariant({ player: h.player, npcId: N.SIR_TIFFY_CASHIEN }),
    'wrapping-up-reporting-to-sir-tiffy',
  );
  // The Slug Menace yields him for that window.
  assert.equal(h.variant(N.SIR_TIFFY_CASHIEN), null);

  // Once Devious Minds is complete the Slug Menace takes Sir Tiffy back.
  h.attrs.set('quest.devious_minds.stage', 10);
  assert.equal(
    PluginManager.emitNpcDialogueVariant({ player: h.player, npcId: N.SIR_TIFFY_CASHIEN }),
    'starting-off-talking-to-sir-tiffy-cashien-after-starting-the-quest',
  );
  assert.equal(h.variant(N.SIR_TIFFY_CASHIEN), 'starting-off-talking-to-sir-tiffy-cashien-after-starting-the-quest');
});

test('a full bag refuses the O\'Niall Commorb hand-back instead of promising one', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 5);
  h.setFreeSlots(0);
  assert.equal(h.variant(N.COL_ONIALL), null);
  assert.equal(h.inventory.get(I.COMMORB_V2) ?? 0, 0);
  assert.ok(h.messages.includes('Free up some inventory space first, what?'));

  // With room the hand-back happens.
  const room = setup();
  room.attrs.set(STAGE_KEY, 5);
  room.variant(N.COL_ONIALL);
  room.line(N.COL_ONIALL, 'Very careless of you, what? Here, take another, but be careful with this one!');
  assert.equal(room.inventory.get(I.COMMORB_V2), 1);
});

test('the desk page is granted once and its space condition only refuses when nothing was granted', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 8);
  h.setFreeSlots(1);
  h.action(N.MAYOR_HOBB, '4vSdlY');
  assert.equal(h.inventory.get(I.PAGE_1), 1);
  // The page is held, so the transcript's no-space line must not play.
  assert.equal(h.condition('dEd0U2'), false);

  const full = setup();
  full.attrs.set(STAGE_KEY, 8);
  full.setFreeSlots(0);
  full.action(N.MAYOR_HOBB, '4vSdlY');
  assert.equal(full.inventory.get(I.PAGE_1) ?? 0, 0);
  assert.equal(full.condition('dEd0U2'), true);
});

test('the last page needs the two stolen pages first', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 9);
  h.inventory.set(I.COMMORB_V2, 1);
  // Without the stolen pages O'Niall has nothing to give.
  assert.equal(h.variant(N.COL_ONIALL), 'the-pages-talking-to-col-o-niall-again');
  h.line(N.COL_ONIALL, 'It has been torn into three pieces. You will need to stick them back together before you can use them.');
  assert.equal(h.inventory.get(I.FRAGMENT_1) ?? 0, 0);

  h.inventory.set(I.PAGE_1, 1);
  h.inventory.set(I.PAGE_2, 1);
  assert.equal(h.variant(N.COL_ONIALL), 'the-pages-talking-to-col-o-niall-while-looking-for-the-final-page');
  h.line(N.COL_ONIALL, 'It has been torn into three pieces. You will need to stick them back together before you can use them.');
  assert.equal(h.inventory.get(I.FRAGMENT_1), 1);
  assert.equal(h.inventory.get(I.FRAGMENT_2), 1);
  assert.equal(h.inventory.get(I.FRAGMENT_3), 1);
  assert.equal(h.varbits.get(2619), 1);
});


test('fragment selectors toggle independently and every selected piece follows controls', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 11);
  for (const id of [I.FRAGMENT_1, I.FRAGMENT_2, I.FRAGMENT_3, I.SEA_SLUG_GLUE]) h.inventory.set(id, 1);
  h.hooks.itemOnItem[0]({ player: h.player, usedItemId: I.SEA_SLUG_GLUE, usedWithItemId: I.FRAGMENT_1 });
  const selection = () => [12155, 12157, 12159].map(id => h.varbits.get(id));
  assert.deepEqual(selection(), [1, 0, 0]);
  h.click(14);
  assert.deepEqual(selection(), [1, 1, 0], 'selecting piece 2 preserves piece 1');
  h.click(5); h.click(4); h.click(3); h.click(8);
  assert.deepEqual([876, 877, 878, 879].map(id => h.configs.get(id)), [41, 32, 1, 1]);
  assert.deepEqual([880, 881, 882, 883].map(id => h.configs.get(id)), [41, 31, 1, 1]);
  assert.deepEqual([884, 885, 886, 887].map(id => h.configs.get(id)), [40, 35, 0, 0], 'unselected piece stays unchanged');
  h.click(13);
  assert.deepEqual(selection(), [0, 1, 0], 'clicking a selected piece deselects only it');
  h.click(6); h.click(7);
  assert.deepEqual([876, 877].map(id => h.configs.get(id)), [41, 32]);
  assert.deepEqual([880, 881].map(id => h.configs.get(id)), [40, 32]);
  h.click(14);
  assert.deepEqual(selection(), [0, 0, 0]);
  const before = structuredClone(h.attrs.get('the-slug-menace:fragment-puzzle'));
  for (const button of [3, 4, 5, 6, 7, 8]) h.click(button);
  assert.deepEqual(h.attrs.get('the-slug-menace:fragment-puzzle'), before, 'no selection means no movement or orientation change');
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.inventory.get(I.PAGE_3) ?? 0, 0);
});


test('the slug pickup varbit follows the actual inventory result after pre-pickup dispatch', () => {
  const accepted = setup();
  accepted.attrs.set(STAGE_KEY, 4);
  const firstTask = accepted.tasks.length;
  PluginManager.emitGroundItemPickup(groundPickup(accepted.player, I.DEAD_SEA_SLUG));
  assert.equal(accepted.varbits.get(2631), undefined, 'pre-pickup event cannot claim an item yet');
  accepted.player.getInventory().adds(I.DEAD_SEA_SLUG, 1);
  accepted.tasks.slice(firstTask).forEach(task => task.run());
  assert.equal(accepted.varbits.get(2631), 1);

  const full = setup();
  full.attrs.set(STAGE_KEY, 4);
  full.setFreeSlots(0);
  pickup(full, I.DEAD_SEA_SLUG);
  assert.equal(full.inventory.get(I.DEAD_SEA_SLUG) ?? 0, 0);
  assert.equal(full.varbits.get(2631), 0, 'failed full-bag pickup cannot set have-slug');
});
