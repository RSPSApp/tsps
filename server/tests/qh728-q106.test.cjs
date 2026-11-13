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
    sendInterfaceSet(id, side) { interfaceId = id; interfaces.push({ id, side }); return sender; },
    sendSound(id) { sounds.push(id); return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const interfaces = [];
  const sounds = [];
  const animations = [];
  const graphics = [];
  const hits = [];
  const levels = new Map();

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
      getCurrentLevel: (skill) => levels.get(skill) ?? 99,
      setCurrentLevel(skill, value) { levels.set(skill, value); },
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    performAnimation(animation) { animations.push(animation.getId?.() ?? animation.id); },
    performGraphic(graphic) { graphics.push(graphic.id); },
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() {} }),
    setUntargetable() {},
    isPlayer: () => true,
    getDialogueManager: () => ({
      startDialogues(chain) { currentDialogue = chain; },
      getCurrent: () => currentDialogue,
      reset() { currentDialogue = null; },
      isActive: () => Boolean(currentDialogue),
      advance() {},
    }),
    getCombat: () => ({ getTarget: () => null, getHitQueue: () => ({ addPendingDamage(list) { hits.push(...list.map((hit) => hit.getDamage())); } }) }),
    getEquipment: () => ({ get: () => null }),
  };

  const emit = (name, event) => api.emitCustomEvent(name, { player, ...event });
  const action = (npcId, stepId) => { const event = { player, npcId, stepId }; api.emitCustomEvent('npc-dialogue:action', event); return event; };
  /** A line as NpcDialogues plays it: `before` as it shows, `after` once continued. */
  const line = (npcId, text, step = {}) => {
    const event = { player, npcId, text, step };
    api.emitCustomEvent('npc-dialogue:line', event);
    event.before?.();
    event.after?.();
    return event;
  };
  const variant = (npcId) => hooks.variants[0]({ player, npcId });
  const condition = (stepId) => hooks.conditions[0]({ player, stepId });

  return {
    api, core, hooks, quest, attrs, inventory, varbits, configs, messages, xp, jingles,
    player, tasks, emit, action, line, variant, condition, interfaces, sounds, animations, graphics, hits, levels,
    /** Runs every queued task (and those they queue) up to `rounds` deep. */
    runTasks(rounds = 30) {
      for (let round = 0; round < rounds && tasks.length; round++) {
        const due = tasks.splice(0);
        for (const task of due) task.run();
      }
    },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    click(buttonChild, slot) {
      const event = { player, buttonId: (462 << 16) | buttonChild, action: 1, slot, handled: false };
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

const FORMAT_KEY = 'the-slug-menace:stage-format';
const FLAGS_KEY = 'the-slug-menace:flags';

/** A player on the native stage numbers (as every save after the conversion). */
function at(stage, options) {
  const h = setup(options);
  h.attrs.set(STAGE_KEY, stage);
  h.attrs.set(FORMAT_KEY, 1);
  return h;
}

test('Sir Tiffy starts the quest as his last line shows, with the Commorb v2 (capture tick 238)', () => {
  const h = setup();
  h.inventory.set(I.COMMORB, 1);
  assert.equal(h.variant(N.SIR_TIFFY_CASHIEN), 'starting-off-talking-to-sir-tiffy-cashien-to-start-the-quest');
  // "Yes." alone starts nothing: closing before the last line leaves the quest unstarted.
  h.emit('npc-dialogue:hook', { npcId: N.SIR_TIFFY_CASHIEN, hook: 'quest:the-slug-menace:start' });
  assert.equal(h.attrs.get(STAGE_KEY) ?? 0, 0);
  h.line(N.SIR_TIFFY_CASHIEN, 'Now, is there anything else I can do for you?');
  assert.equal(h.attrs.get(STAGE_KEY), 1);
  assert.equal(h.varbits.get(2610), 1);
  assert.equal(h.inventory.get(I.COMMORB) ?? 0, 0);
  assert.equal(h.inventory.get(I.COMMORB_V2), 1);
  assert.equal(h.variant(N.SIR_TIFFY_CASHIEN), 'starting-off-talking-to-sir-tiffy-cashien-after-starting-the-quest');
});

test('the start menu goes on to Sir Tiffy\'s own options, not the start prompt again (issue #4211 point 1)', () => {
  const steps = DIALOGUES[SLUG_PAGE].variants['starting-off-talking-to-sir-tiffy-cashien-to-start-the-quest'];
  const yes = steps.find((step) => step.type === 'choice').options[0].steps.find((step) => step.type === 'choice')
    .options.find((option) => option.text === 'Yes.');
  const menu = yes.steps.find((step) => step.type === 'choice');
  assert.deepEqual(menu.options.map((option) => option.text),
    ['Can you explain the Gaze of Saradomin to me?', 'Can I buy some armour?', 'Can I switch respawns, please?', 'Goodbye.']);
});

test('a stage-0 lost Commorb is reclaimed from Sir Tiffy', () => {
  const h = setup();
  assert.equal(h.variant(N.SIR_TIFFY_CASHIEN), V_TIFFY_LOST_ORB);
  const events = playVariant(h, V_TIFFY_LOST_ORB);
  assert.equal(events[0].stepId, 'M3YJU2');
  assert.equal(h.inventory.get(I.COMMORB), 1);
  assert.equal(h.inventory.get(I.COMMORB_V2) ?? 0, 0);
});

test('a full inventory selects the no-space branch and grants nothing', () => {
  const h = setup();
  h.setFreeSlots(0);
  assert.equal(selectLostOrbCondition(h).condition, 'qD7fRj');
  playVariant(h, V_TIFFY_LOST_ORB);
  assert.equal(h.inventory.get(I.COMMORB) ?? 0, 0);
  assert.equal(h.inventory.get(I.COMMORB_V2) ?? 0, 0);
});

test('an in-quest lost Commorb is replaced with the Commorb v2', () => {
  const h = at(4);
  const chosen = selectLostOrbCondition(h);
  assert.equal(chosen.condition, 'M3YJU2');
  h.emit('npc-dialogue:condition', { npcId: N.SIR_TIFFY_CASHIEN, stepId: chosen.condition });
  assert.equal(h.inventory.get(I.COMMORB_V2), 1);
  assert.equal(h.inventory.get(I.COMMORB) ?? 0, 0);
});

test('post-quest Sir Tiffy returns a lost Commorb v2 and skips the WGS line', () => {
  const h = at(14);
  assert.equal(h.condition('fOsyy-'), true);
  assert.equal(h.condition('upb-U5'), false);
  h.action(N.SIR_TIFFY_CASHIEN, 'usNZAT');
  assert.equal(h.inventory.get(I.COMMORB_V2), 1);
  const wgs = setup();
  wgs.setWgsComplete(true);
  assert.equal(wgs.condition('upb-U5'), true);
});

test('O\'Niall: control varbit with his menu, stage 2 after the three names, stage 3 at the report', () => {
  const h = at(1);
  h.inventory.set(I.COMMORB_V2, 1);
  assert.equal(h.variant(N.COL_ONIALL), 'witchaven-talking-to-col-o-niall');
  h.line(N.COL_ONIALL, 'Now what do you want to know.');
  assert.equal(h.varbits.get(2630), 1);
  h.line(N.COL_ONIALL, "Will do Col. O'Niall. Thanks for the advice.");
  assert.equal(h.attrs.get(STAGE_KEY), 2);
  assert.equal(h.variant(N.COL_ONIALL), 'witchaven-talking-to-col-o-niall-before-getting-all-the-information');

  // The three talks set their tracks and alltrack 4, 6, 7 (ticks 1089, 1231, 1433).
  assert.equal(h.variant(N.BROTHER_MALEDICT), 'witchaven-talking-to-brother-maledict-2');
  h.line(N.BROTHER_MALEDICT, 'Well, that would make sense. Hmm, one more thing.');
  assert.deepEqual([h.varbits.get(2616), h.varbits.get(2617)], [1, 4]);
  assert.equal(h.variant(N.MAYOR_HOBB), 'witchaven-talking-to-mayor-hobb-2');
  h.line(N.MAYOR_HOBB, 'Is there anything else you need to know?');
  assert.deepEqual([h.varbits.get(2615), h.varbits.get(2617)], [1, 6]);
  const holgart = h.hooks.namedNpcs.get('Holgart')['Talk-to']({ player: h.player, npcId: N.HOLGART });
  assert.notEqual(holgart, false, 'the quest claims Holgart for his talk');
  h.line(N.HOLGART, 'Aye. Fare thee well.');
  assert.deepEqual([h.varbits.get(2614), h.varbits.get(2617)], [1, 7]);

  assert.equal(h.variant(N.COL_ONIALL), 'witchaven-talking-to-col-o-niall-after-talking-to-mayor-hobb');
  h.line(N.COL_ONIALL, 'Anything else I can do for you?');
  assert.equal(h.attrs.get(STAGE_KEY), 3);
  assert.equal(h.varbits.get(2610), 3);
});

test('Savant breaks in on the Mayor and the scan near him reads two life forms (ticks 1318-1345)', () => {
  const h = at(2);
  h.inventory.set(I.COMMORB_V2, 1);
  h.attrs.set('quest.the_slug_menace.tracks', 2);
  const talk = h.hooks.namedNpcs.get('Mayor Hobb')['Talk-to']({ player: h.player, npcId: N.MAYOR_HOBB });
  assert.notEqual(talk, false);
  h.line(N.SAVANT, 'Sure thing, one moment.');
  assert.equal(h.varbits.get(2621), 1);
  h.setLocation(2711, 3293);
  h.hooks.itemAction[0]({ player: h.player, itemId: I.COMMORB_V2, option: 'Scan' });
  assert.equal(h.animations.at(-1), 4839);
  h.runTasks();
  assert.equal(h.varbits.get(2621), 2);
  // Done: Talk-to is the Mayor's own again.
  assert.equal(h.hooks.namedNpcs.get('Mayor Hobb')['Talk-to']({ player: h.player, npcId: N.MAYOR_HOBB }), false);
});

test('a scan with nothing to read says so two ticks later (tick 1369)', () => {
  const h = at(6);
  h.inventory.set(I.COMMORB_V2, 1);
  h.hooks.itemAction[0]({ player: h.player, itemId: I.COMMORB_V2, option: 'Scan' });
  assert.equal(h.animations.at(-1), 2721);
  assert.deepEqual(h.messages, []);
  h.runTasks();
  assert.deepEqual(h.messages, ['You have nothing to scan for...']);
});

test('the false wall opens with the box and the passage back lands west of it (issue #4211 point 4)', () => {
  const h = at(3);
  h.inventory.set(I.COMMORB_V2, 1);
  const climbs = [];
  h.api.onCustomEvent('ladders:climbDown', (event) => climbs.push(event));
  const ruin = { getLocation: () => new h.core.Location(2696, 3283, 0) };
  h.hooks.custom.get('ladders:climb')[0]({ player: h.player, objectId: 18270, object: ruin });
  assert.deepEqual([climbs.at(-1).destination.getX(), climbs.at(-1).destination.getY()], [2696, 9684]);

  const push = { player: h.player, objectId: 19124, option: 'push', location: { x: 2701, y: 9688, z: 0 } };
  h.hooks.objects[0](push);
  assert.equal(push.handled, true);
  assert.equal(h.animations.at(-1), 4834);
  h.runTasks();
  assert.equal(h.varbits.get(2618), 1);
  assert.equal(h.attrs.get(FLAGS_KEY) & 2, 2, 'slug2_doorbit is saved');

  h.hooks.objects[0]({ player: h.player, objectId: 19124, option: 'enter', location: { x: 2701, y: 9688, z: 0 } });
  assert.equal(h.animations.at(-1), 752);
  h.runTasks();
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY()], [2324, 5104]);

  h.hooks.objects[0]({ player: h.player, objectId: 18412, option: 'enter', location: { x: 2322, y: 5104, z: 0 } });
  h.runTasks();
  assert.deepEqual([h.getLocation().getX(), h.getLocation().getY()], [2700, 9689], 'not the wall\'s own tile 2701,9688');
});

test('the door burns for 5 the tick after its flash (ticks 1862-1864)', () => {
  const h = at(3);
  h.hooks.objects[0]({ player: h.player, objectId: 18413, option: 'open', location: { x: 2348, y: 5093, z: 0 } });
  assert.deepEqual(h.messages, ['A flash of light springs from the door, burning your hand.']);
  assert.deepEqual(h.hits, []);
  h.runTasks();
  assert.deepEqual(h.hits, [5]);
});

test('the door scan: doorscan at once, the transcript with Savant\'s line, stage 4 at the end', () => {
  const h = at(3);
  h.inventory.set(I.COMMORB_V2, 1);
  h.setLocation(2351, 5095);
  h.hooks.itemAction[0]({ player: h.player, itemId: I.COMMORB_V2, option: 'Scan' });
  assert.equal(h.varbits.get(2620), 1);
  h.line(N.SAVANT, 'I have added a transcript of the runes into your pack.');
  assert.equal(h.inventory.get(I.DOOR_TRANSCRIPTION), 1);
  h.line(N.SAVANT, "Fantastic - I'll get right on it.");
  assert.equal(h.attrs.get(STAGE_KEY), 4);
});

test('the dead sea slug lies at 2352,5096 and its pickup sets slug2_haveslug once', () => {
  const h = at(2);
  h.quest.setStage(h.player, 3);
  h.emit('quest:stage-changed', { key: 'the_slug_menace' });
  pickup(h, I.DEAD_SEA_SLUG);
  assert.equal(h.varbits.get(2631), 1);
  const other = at(3);
  pickup(other, I.DOOR_TRANSCRIPTION);
  assert.equal(other.varbits.get(2631), undefined);
  const done = at(14);
  pickup(done, I.DEAD_SEA_SLUG);
  assert.equal(done.varbits.get(2631), undefined);
});

test('Jorral takes the transcript, stage 5, and Savant calls with stage 6 (ticks 2137-2157)', () => {
  const h = at(4);
  h.inventory.set(I.DOOR_TRANSCRIPTION, 1);
  assert.equal(h.variant(N.JORRAL), 'the-pages-talking-to-jorral');
  h.line(N.JORRAL, 'Hmm. Interesting, very interesting.');
  assert.equal(h.inventory.get(I.DOOR_TRANSCRIPTION), 0);
  h.line(N.JORRAL, 'Uh, right. Goodbye.');
  assert.equal(h.attrs.get(STAGE_KEY), 5);
  assert.equal(h.variant(N.JORRAL), null, 'Jorral\'s own lines after');
  h.runTasks();
  assert.equal(h.attrs.get(STAGE_KEY), 6);
  assert.equal(h.varbits.get(2612), 1);
});

test('O\'Niall\'s warning, Maledict\'s pages, the fragments and the paste (stages 7, 9, 10)', () => {
  const h = at(6);
  h.inventory.set(I.COMMORB_V2, 1);
  assert.equal(h.variant(N.COL_ONIALL), 'the-pages-talking-to-col-o-niall-after-learning-abotu-mother-mallum');
  h.line(N.COL_ONIALL, "Of course! The temple of Saradomin has had a shrine here for centuries. I'll get right on it.");
  assert.equal(h.attrs.get(STAGE_KEY), 7);
  h.quest.setStage(h.player, 8);
  assert.equal(h.variant(N.BROTHER_MALEDICT), 'the-pages-talking-to-maledict-after-learning-about-mother-mallum');
  h.line(N.BROTHER_MALEDICT, 'It is imperative that you find them.');
  assert.equal(h.attrs.get(STAGE_KEY), 9);
  assert.equal(h.variant(N.COL_ONIALL), 'the-pages-talking-to-col-o-niall-again', 'the last page waits for the two stolen ones');
  h.inventory.set(I.PAGE_1, 1);
  h.inventory.set(I.PAGE_2, 1);
  assert.equal(h.variant(N.COL_ONIALL), 'the-pages-talking-to-col-o-niall-while-looking-for-the-final-page');
  h.line(N.COL_ONIALL, "Don't mention it.");
  assert.deepEqual([I.FRAGMENT_1, I.FRAGMENT_2, I.FRAGMENT_3].map((id) => h.inventory.get(id)), [1, 1, 1]);
  assert.equal(h.varbits.get(2619), 1);
  h.inventory.set(I.SWAMP_PASTE, 1);
  const paste = { player: h.player, usedItemId: I.SWAMP_PASTE, usedWithItemId: I.FRAGMENT_3 };
  h.hooks.itemOnItem[0](paste);
  assert.equal(paste.handled, true);
  h.line(N.SAVANT, "No problem Savant. I'll snap to it right away.");
  assert.equal(h.attrs.get(STAGE_KEY), 10);
});

test('the desk: locked before the pages, the page with a 3-tick delay, empty after', () => {
  const locked = at(2);
  locked.hooks.objects[0]({ player: locked.player, objectId: 18224, location: { x: 2708, y: 3294, z: 0 } });
  assert.deepEqual(locked.messages, ['The desk appears to be locked.']);
  const h = at(9);
  h.hooks.objects[0]({ player: h.player, objectId: 18224, location: { x: 2708, y: 3294, z: 0 } });
  assert.equal(h.animations.at(-1), 4834);
  assert.equal(h.inventory.get(I.PAGE_1) ?? 0, 0);
  h.runTasks();
  assert.equal(h.inventory.get(I.PAGE_1), 1);
  h.hooks.objects[0]({ player: h.player, objectId: 18224, location: { x: 2708, y: 3294, z: 0 } });
  assert.equal(h.messages.at(-1), 'The desk is empty.');
  assert.equal(h.inventory.get(I.PAGE_1), 1);
});

test('Bailey cooks the glue as "Right, I\'ll get cooking." shows: stage 11', () => {
  const h = at(10);
  h.inventory.set(I.DEAD_SEA_SLUG, 1);
  h.line(N.BAILEY, "Right, I'll get cooking.");
  assert.equal(h.inventory.get(I.DEAD_SEA_SLUG), 0);
  assert.equal(h.inventory.get(I.SEA_SLUG_GLUE), 1);
  assert.equal(h.attrs.get(STAGE_KEY), 11);
});

test('the torn page starts where live starts it and mends within one step of its place (ticks 3188-3293)', () => {
  const h = at(11);
  for (const id of [I.FRAGMENT_1, I.FRAGMENT_2, I.FRAGMENT_3, I.SEA_SLUG_GLUE]) h.inventory.set(id, 1);
  const glue = { player: h.player, usedItemId: I.SEA_SLUG_GLUE, usedWithItemId: I.FRAGMENT_2 };
  h.hooks.itemOnItem[0](glue);
  assert.equal(glue.handled, true);
  assert.equal(h.player.getInterfaceId(), 460);
  assert.deepEqual(h.interfaces.at(-1), { target: (161 << 16) | 74, id: 462, type: 3 });
  assert.deepEqual([876, 877, 879, 878, 880, 881, 883, 882, 884, 885, 887, 886].map((varp) => h.configs.get(varp)),
    [20, 36, 3, 1, -130, -108, 1, 2, -5, 39, 4, 2]);
  assert.deepEqual([12155, 12156, 12157, 12158, 12159, 12160].map((id) => h.varbits.get(id)), [1, 1, 0, 1, 0, 1]);

  h.click(3); h.click(3); // piece 1: 3 -> 4 -> 1
  assert.equal(h.configs.get(879), 1);
  h.click(13, 2); h.click(14, 2); // piece 1 off, piece 2 on (sub 2 selects)
  h.click(8); // piece 2 flips 2 -> 1
  for (let step = 0; step < 30; step++) h.click(5); // x -130 -> 20
  for (let step = 0; step < 29; step++) h.click(7); // y -108 -> 37
  assert.deepEqual([h.configs.get(880), h.configs.get(881)], [20, 37]);
  assert.equal(h.inventory.get(I.PAGE_3) ?? 0, 0, 'piece 3 is still out of place');
  h.click(14, 2); h.click(15, 2);
  h.click(8); h.click(3); // piece 3: flip 2 -> 1, rotation 4 -> 1
  h.click(5); h.click(5);
  assert.equal(h.configs.get(884), 5);
  assert.equal(h.inventory.get(I.PAGE_3) ?? 0, 0, 'ten to the left does not count');
  h.click(5);
  assert.equal(h.configs.get(884), 10, 'ten to the left of its place, the capture\'s last miss');
  h.click(5);
  assert.equal(h.inventory.get(I.PAGE_3), 1, 'five to the left counts, as at tick 3293');
  assert.deepEqual([I.FRAGMENT_1, I.FRAGMENT_2, I.FRAGMENT_3, I.SEA_SLUG_GLUE].map((id) => h.inventory.get(id)), [0, 0, 0, 0]);
  assert.equal(h.configs.get(875), 1);
  assert.equal(h.varbits.get(2611), 1);
  assert.deepEqual(h.jingles, [87]);
  h.click(5);
  assert.equal(h.configs.get(884), 15, 'the solved page ignores further clicks');
});

test('a select button\'s sub 0 shows or hides its piece', () => {
  const h = at(11);
  for (const id of [I.FRAGMENT_1, I.FRAGMENT_2, I.FRAGMENT_3, I.SEA_SLUG_GLUE]) h.inventory.set(id, 1);
  h.hooks.itemOnItem[0]({ player: h.player, usedItemId: I.SEA_SLUG_GLUE, usedWithItemId: I.FRAGMENT_1 });
  h.click(13, 0);
  assert.equal(h.varbits.get(12156), 0);
  assert.equal(h.varbits.get(12155), 1, 'showing does not select');
  h.click(13, 0);
  assert.equal(h.varbits.get(12156), 1);
});

test('shaping and empowering: the blank in the essence\'s place with 2 Crafting, the rune with 2 Runecraft', () => {
  const h = at(11);
  h.attrs.set(FLAGS_KEY, 1 << 6); // the mended page
  const original = Math.random;
  try {
    Math.random = () => 0;
    h.inventory.set(I.PAGE_1, 1);
    h.inventory.set(I.CHISEL, 1);
    h.inventory.set(I.RUNE_ESSENCE, 1);
    const shape = { player: h.player, itemId: I.PAGE_1, option: 'Shape-Air', handled: false };
    h.hooks.itemAction[0](shape);
    assert.equal(shape.handled, true);
    assert.equal(h.inventory.get(I.RUNE_ESSENCE), 0);
    assert.equal(h.inventory.get(I.BLANK_AIR_RUNE), 1);
    assert.deepEqual(h.messages, ['You manage to shape the rune essence into the desired shape.']);
    assert.deepEqual(h.xp, [{ skill: h.core.Skill.CRAFTING, amount: 2 }]);

    h.hooks.itemOnObject[0]({ player: h.player, itemId: I.BLANK_AIR_RUNE, objectId: h.core.ObjectIdentifiers.ALTAR_33 });
    assert.equal(h.animations.at(-1), 791);
    assert.equal(h.inventory.get(I.BLANK_AIR_RUNE), 0);
    assert.equal(h.inventory.get(I.AIR_RUNE_6) ?? 0, 0, 'the rune lands the next tick');
    h.runTasks();
    assert.equal(h.inventory.get(I.AIR_RUNE_6), 1);
    assert.deepEqual(h.xp.at(-1), { skill: h.core.Skill.RUNECRAFTING, amount: 2 });
  } finally {
    Math.random = original;
  }
});

test('the five runes go in with slug2_used_runes 2, 3, 19, 27, 31 (ticks 4566-4589)', () => {
  const h = at(11);
  h.attrs.set(FLAGS_KEY, 1 << 6);
  h.inventory.set(I.COMMORB_V2, 1);
  const order = [I.AIR_RUNE_6, I.EARTH_RUNE_4, I.MIND_RUNE_4, I.WATER_RUNE_6, I.FIRE_RUNE_6];
  const seen = [];
  for (const rune of order) {
    h.inventory.set(rune, 1);
    h.hooks.itemOnObject[0]({ player: h.player, itemId: rune, objectId: 18413 });
    assert.equal(h.inventory.get(rune), 0);
    seen.push(h.varbits.get(2627));
  }
  assert.deepEqual(seen, [2, 3, 19, 27, 31]);
  assert.deepEqual([2622, 2623, 2624, 2625, 2626].map((id) => h.varbits.get(id)), [1, 1, 1, 1, 1]);
});

test('the Prince drains Prayer by the damage it deals', () => {
  const h = at(11);
  const prince = { getId: () => h.core.NpcIdentifiers.SLUG_PRINCE };
  h.levels.set(h.core.Skill.PRAYER, 44);
  h.api.emitCustomEvent('combat:damage-apply', { target: h.player, hit: { getSource: () => prince, getDamage: () => 4 } });
  assert.equal(h.levels.get(h.core.Skill.PRAYER), 40);
});

test('the hand-in completes at 14 once, clears varp 875 and plays jingle 154', () => {
  const h = at(12);
  h.action(N.SIR_TIFFY_CASHIEN, 'YMQ0V4');
  assert.equal(h.attrs.get(STAGE_KEY), 14);
  assert.equal(h.varbits.get(2610), 14);
  assert.equal(h.configs.get(875), 0);
  assert.equal(h.attrs.get('quest.points'), 1);
  assert.equal(h.xp.reduce((sum, entry) => sum + entry.amount, 0), 10500);
  assert.deepEqual(h.jingles, [154]);
  h.action(N.SIR_TIFFY_CASHIEN, 'YMQ0V4');
  assert.equal(h.xp.reduce((sum, entry) => sum + entry.amount, 0), 10500);
});

test('the stage on the wire is the native slug2_main value', () => {
  const h = at(0);
  for (const stage of [1, 2, 3, 7, 8, 9, 11, 12, 14]) {
    h.quest.setStage(h.player, stage);
    assert.equal(h.varbits.get(2610), stage);
  }
});

test('an older save is converted to the native stages once at login', () => {
  const h = setup();
  h.attrs.set(STAGE_KEY, 13); // old "the Slug Prince is dead"
  h.attrs.set('quest.the_slug_menace.used-runes', 31);
  for (const fn of h.hooks.login) fn({ player: h.player });
  assert.equal(h.attrs.get(STAGE_KEY), 12);
  assert.equal(h.attrs.get(FORMAT_KEY), 1);
  for (const fn of h.hooks.login) fn({ player: h.player });
  assert.equal(h.attrs.get(STAGE_KEY), 12, 'only once');

  const old = setup();
  old.attrs.set(STAGE_KEY, 12); // old "the page is reassembled"
  old.attrs.set('quest.the_slug_menace.used-runes', 1 | 8); // old air and fire bits
  for (const fn of old.hooks.login) fn({ player: old.player });
  assert.equal(old.attrs.get(STAGE_KEY), 11);
  assert.equal(old.varbits.get(2611), 1, 'the mended page survives');
  assert.equal(old.attrs.get('quest.the_slug_menace.used-runes'), 2 | 4, 'air 2 and fire 4 on the native bits');
});

test('Holgart keeps his boat until he says he lost it, then Sea Slug\'s Travel yields', () => {
  const h = at(1);
  const ask = () => { const request = { player: h.player, lost: false }; h.api.emitCustomEvent('sea-slug:holgart-boat', request); return request.lost; };
  assert.equal(ask(), false);
  assert.equal(h.hooks.namedNpcs.get('Holgart').Travel({ player: h.player, npcId: N.HOLGART }), false);
  h.quest.setStage(h.player, 2);
  h.attrs.set('quest.the_slug_menace.tracks', 1);
  assert.equal(ask(), true);
  assert.notEqual(h.hooks.namedNpcs.get('Holgart').Travel({ player: h.player, npcId: N.HOLGART }), false);
  h.quest.setStage(h.player, 14);
  assert.equal(ask(), true, 'after the quest too (tick 5164)');
});

test('villagers: possessed forms stare, the others chat', () => {
  const h = at(1);
  assert.equal(h.variant(4791), 'post-quest-dialogue');
  assert.equal(h.variant(4792), 'pre-quest-dialogue');
});

test('the journal matches live at tick 1177 (Maledict struck, the others not)', () => {
  const h = at(2);
  h.attrs.set('quest.the_slug_menace.tracks', 4);
  const lines = h.quest.buildJournal(h.player, h.quest);
  const expected = [
    '<str>Sir Tiffy Cashien has given me a new task for the Temple',
    '<str>Knights.',
    "<str>I am to report to Col. O'Niall in Witchaven, East of Ardougne.",
    "<col=000080>Col. O'Niall has explained that some of the people in",
    '<col=000080>Witchaven are acting very strangely. The mayor has been',
    "<col=000080>buying large quantities of items that Witchaven shouldn't",
    '<col=000080>need. He recommends I speak to the following people:',
    '<col=800000>Holgart.',
    '<col=800000>Mayor Eustace Hobb.',
    '<str>Brother Maledict.',
  ];
  assert.deepEqual(lines, expected);
});

test('Sir Tiffy is yielded to Devious Minds while its hand-in is due', () => {
  const h = at(5, { deviousMinds: true });
  h.inventory.set(I.COMMORB_V2, 1);
  h.attrs.set('quest.devious_minds.stage', 9);
  assert.equal(PluginManager.emitNpcDialogueVariant({ player: h.player, npcId: N.SIR_TIFFY_CASHIEN }), 'wrapping-up-reporting-to-sir-tiffy');
  assert.equal(h.variant(N.SIR_TIFFY_CASHIEN), null);
  h.attrs.set('quest.devious_minds.stage', 10);
  assert.equal(h.variant(N.SIR_TIFFY_CASHIEN), 'starting-off-talking-to-sir-tiffy-cashien-after-starting-the-quest');
});

test('the Prince\'s death plays in the capture\'s six parts, each line once (ticks 4761-4891)', () => {
  const h = at(11);
  const scenes = require('../plugins/quests/slugmenace/Scenes.SlugMenace')(h.api, {});
  const parts = scenes.deathParts().map((part) => part.map((step) => step.text ?? step.player));
  assert.deepEqual(parts.map((part) => [part[0], part.at(-1)]), [
    ['No! Do you realise what you have done?', 'By your command, my queen.'],
    ['So then, [player name], it is just us. What shall we do with you?', "By the gods! I'll get you out of there immediately! Initiating emergency teleport."],
    ['Come with us, [player name]. Come and be with us for all eternity.', 'Come with us, [player name]. Come and be with us for all eternity.'],
    ['Savant!', "She's blocking my magic! One second, I'll try something else."],
    ['Ahh, [player name], it is useless to resist. Now we shall become as one.', "Right, I think I've got it this time. Just one more second."],
    ['[player name], are you there?', "Indeed. I'll just get my breath back first."],
  ]);
  assert.equal(parts.flat().length, 31, 'every line of the variant, none twice');
});

test('the villagers\' stare and the wall line show in the message box, not in chat (ticks 534, 1725)', () => {
  const h = at(1);
  for (const stepId of ['qu7kOj', 'BlbTdL']) {
    const event = { player: h.player, npcId: 4791, stepId, kind: 'message' };
    h.api.emitCustomEvent('npc-dialogue:action', event);
    assert.deepEqual(event.box, { statement: true });
  }
  const other = { player: h.player, npcId: 4791, stepId: 'IE1248', kind: 'message' };
  h.api.emitCustomEvent('npc-dialogue:action', other);
  assert.equal(other.box, undefined);
});
