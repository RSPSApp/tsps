// Run after `yarn build`: node --test tests/qh728-q008.test.cjs
// Bone Voyage q008: the mandatory Quest Helper route through the real
// NpcDialogues runtime, the real canal barge deck, and the cached sailing
// instance/controls. Fixture starting state: fresh stage 0, Dig Site complete
// (answered by the shared quest:is-complete event), no items; individual tests
// that start later label the durable stage and any item/state fixture they set.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function setup({ complete = ['the_dig_site'], started = [] } = {}) {
  const completeKeys = new Set(complete), startedKeys = new Set(started);
  const variants = [], conditions = [], custom = new Map(), named = new Map(), objects = new Map();
  const buttons = [];
  const spawned = [], removed = [], logins = [];
  let anyTalk = null;
  const noop = () => {};
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onNpcDialogueVariant: (fn) => variants.push(fn),
    onNpcDialogueCondition: (fn) => conditions.push(fn),
    onNpcInteraction: (target, actions) => {
      if (typeof target === 'string') named.set(target, actions);
      else throw new Error('Bone Voyage should only register named NPC interactions');
    },
    onAnyNpcInteraction: (actions) => { anyTalk = actions['Talk-to']; },
    onObjectInteraction: (target, actions) => {
      if (typeof target === 'string') objects.set(target, actions);
      else throw new Error('Bone Voyage should only register named object interactions');
    },
    onInterfaceActionButton: (ids, handler) => {
      for (const id of Array.isArray(ids) ? ids : [ids]) buttons.push({ id, handler });
    },
    onCustomEvent: (name, fn) => {
      const list = custom.get(name) ?? [];
      list.push(fn);
      custom.set(name, list);
    },
    emitCustomEvent: (name, event) => {
      if (name === 'quest:is-complete') event.complete = completeKeys.has(event.key);
      if (name === 'quest:is-started') event.started = startedKeys.has(event.key);
      for (const fn of custom.get(name) ?? []) fn(event);
    },
    spawnNpc: (def) => {
      const npc = {
        def, __area: null, getId: () => def.id, getOwner: () => def.owner,
        getLocation: () => new core.Location(def.x, def.y, def.z), isRegistered: () => true,
        isNpc: () => true, isPlayer: () => false, getIndex: () => spawned.length + 100,
        getAsNpc: () => npc,
        setArea: (area) => { npc.__area = area; }, getArea: () => npc.__area,
        setPositionToFace() {}, forceChat() {},
        getMovementQueue: () => ({ setBlockMovement() {}, reset() {} }),
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => removed.push(npc),
    sendMultiChatboxPrompt: (player, title, ...pairs) =>
      MultiChatboxPrompt.showPrompt('qh728-q008', player, title, pairs),
    onPlayerLogin: (fn) => logins.push(fn),
  }, { get: (target, key) => key in target ? target[key] : noop });

  require('../plugins/world/Museum.plugin').register(api);
  require('../plugins/quests/quests/BoneVoyage.Quest')(api);
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'bone_voyage');

  const realVariant = PluginManager.emitNpcDialogueVariant;
  const realCondition = PluginManager.emitNpcDialogueCondition;
  PluginManager.emitNpcDialogueVariant = (event) => {
    for (const fn of variants) {
      const result = fn(event);
      if (result) return result;
    }
    return null;
  };
  PluginManager.emitNpcDialogueCondition = (event) => {
    for (const fn of conditions) {
      const result = fn(event);
      if (typeof result === 'boolean') return result;
    }
    return null;
  };
  return {
    api, quest, spawned, removed, named, objects, buttons, logins, variants, conditions, custom,
    restore() {
      PluginManager.emitNpcDialogueVariant = realVariant;
      PluginManager.emitNpcDialogueCondition = realCondition;
    },
    talk(player, npcId, x, y, choices = [], z = 0) {
      const event = this.npcAction(player, npcId, x, y, z, 'Talk-to');
      drive(player, choices);
      return event;
    },
    npcAction(player, npcId, x, y, z, action) {
      const definition = core.NpcDefinition.forId(npcId);
      const actions = definition.getActions() ?? [];
      const clickType = actions.indexOf(action) + 1;
      assert.ok(clickType > 0, `${definition.getName()} has no ${action} action`);
      const location = new core.Location(x, y, z);
      const npc = {
        getId: () => npcId, getCurrentDefinition: () => definition,
        getName: () => definition.getName(), getLocation: () => location, getIndex: () => 1,
      };
      const event = { player, npc, npcId, clickType, location: { x, y, z }, handled: false, definition };
      const handler = named.get(definition.getName())?.[action];
      if (handler) handler(event);
      if (!event.handled && action === 'Talk-to') anyTalk(event);
      return event;
    },
    operate(player) {
      const area = player.getPrivateArea();
      assert.ok(area, 'player is in the sailing scene');
      const controls = area.getTemplateObjects(area.tile(10, 16, 1)).find((object) => object.getId() === 30569);
      assert.ok(controls, 'Barge controls 30569 is copied into the instance');
      const definition = core.ObjectDefinition.forId(30569);
      const event = { player, npc: null, object: controls, objectId: 30569, option: 'Operate',
        location: controls.getLocation(), definition, handled: false };
      const handler = objects.get('Barge controls')?.Operate;
      assert.equal(typeof handler, 'function', 'Barge controls Operate is registered');
      handler(event);
      return event;
    },
    press(player, buttonId) {
      const entry = buttons.find((button) => button.id === buttonId);
      assert.ok(entry, `button ${buttonId} is registered`);
      const event = { player, buttonId, handled: false };
      entry.handler(event);
      return event;
    },
  };
}

function drive(player, choices) {
  const queue = [...choices];
  for (let step = 0; step < 500; step++) {
    const menu = MultiChatboxPrompt.getPending(player);
    if (menu) {
      const wanted = queue.shift();
      assert.ok(wanted !== undefined, `unexpected menu: ${JSON.stringify(menu.options)}`);
      const index = menu.options.indexOf(wanted);
      assert.ok(index >= 0, `menu ${JSON.stringify(menu.options)} has no ${JSON.stringify(wanted)}`);
      assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player, groupId: 219, slot: index + 1 }), true);
      continue;
    }
    const current = player.getDialogueManager().getCurrent();
    if (!current) break;
    player.getDialogueManager().advance();
  }
  assert.deepEqual(queue, [], 'all expected dialogue choices were offered');
}

function player(woodcutting = 99) {
  const attributes = new Map(), items = new Map(), varbits = new Map(), messages = [];
  const subInterfaces = [], closedSubInterfaces = [];
  let location = new core.Location(3257, 3447, 0), chatbox = null, area = null;
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendChatboxInterface(id) { chatbox = id; return sender; },
    sendInterfaceRemoval() { chatbox = null; return sender; },
    isChatboxInterface(id) { return chatbox === id; },
    sendSubInterface(uid, group, type) { subInterfaces.push([uid, group, type]); return sender; },
    closeSubInterface(uid) { closedSubInterfaces.push(uid); return sender; },
  }, { get: (target, key) => key in target ? target[key] : () => sender });
  const inventory = {
    items,
    getAmount: (id) => items.get(id) ?? 0,
    getFreeSlots: () => 28 - items.size,
    isFull: () => false,
    adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount = 1) {
      const left = (items.get(id) ?? 0) - amount;
      assert.ok(left >= 0, `tried to remove missing item ${id}`);
      if (left) items.set(id, left); else items.delete(id);
    },
    // The real signature: forceAdd(player, item).
    forceAdd: (player, item) => { const id = item.getId?.() ?? item.id, amount = item.getAmount?.() ?? item.amount ?? 1; items.set(id, (items.get(id) ?? 0) + amount); },
  };
  const p = {
    attributes, items, varbits, messages, inventory, subInterfaces, closedSubInterfaces,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getPacketSender: () => sender,
    getSkillManager: () => ({ getMaxLevel: () => woodcutting, getCurrentLevel: () => woodcutting, addExperiences() {} }),
    getLocation: () => location,
    moveTo: (value) => { location = value; },
    sendMessage: (text) => messages.push(text),
    getUsername: () => 'Qh728Bone', getDisplayName: () => 'Qh728Bone', getIndex: () => 1, isPlayerBot: () => false,
    isRegistered: () => true, isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p,
    getAppearance: () => ({ isMale: () => true }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    getFrameUpdater: () => ({ clear() {} }),
    setArea(next) { area = next; }, getArea: () => area,
    getPrivateArea: () => (area instanceof core.PrivateArea ? area : null),
    performAnimation() {}, setPositionToFace() {}, setUntargetable() {},
  };
  p.manager = new DialogueManager(p);
  p.getDialogueManager = () => p.manager;
  return p;
}

test('stage 5 keeps the barge closed until the foreman confirms it is ready', () => {
  const h = setup();
  try {
    const p = player();
    h.quest.setStage(p, 5);
    const before = h.spawned.length;
    h.talk(p, N.BARGE_GUARD_3, 3364, 3446, ['Can I go onto the barge?']);
    assert.equal(p.messages[0], undefined, 'the guard refusal is spoken, not a player message');
    assert.equal(h.spawned.length, before, 'the guard cannot summon the navigators before the foreman step');
    assert.equal(h.quest.getStage(p), 5);
    assert.equal(h.spawned.filter((npc) => npc.def.id === N.LEAD_NAVIGATOR).length, 0);
  } finally {
    h.restore();
  }
});

const SIDEMODAL = (161 << 16) | 74;
const OVERLAY_HUD = (161 << 16) | 8;
const at = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];

/** World ticks: the quest's fades and landings are CountdownTasks. */
function tick(count = 1) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

/** Ours: the wind is random; 0.5 gives no gust, no change of wind and a prevailing drift of +4. */
function steadyWind(fn) {
  const random = Math.random;
  Math.random = () => 0.5;
  try {
    return fn();
  } finally {
    Math.random = random;
  }
}

/** Sail to the island: full sails, the rudder against the +4 drift, the bearing on north. */
function sailToIsland(h, p) {
  const area = p.getPrivateArea();
  h.press(p, (604 << 16) | 11);
  h.press(p, (604 << 16) | 38);
  for (let i = 0; i < 400 && area.state.phase === 'sailing'; i++) area.process(p);
  return area;
}

test('fresh stage 0 to completion follows the mandatory Quest Helper route', () => steadyWind(() => {
  const h = setup();
  try {
    const p = player();
    h.quest.setStage(p, 0);
    p.setAttribute('museum:kudos', 100); // fixture: the real Museum handler answers the start gate

    h.talk(p, N.CURATOR_HAIG_HALEN, 3257, 3447, ['Have you any interesting news?', 'Yes.']);
    assert.equal(h.quest.getStage(p), 1, 'Curator start hook');

    h.talk(p, N.BARGE_FOREMAN, 3364, 3445);
    assert.equal(h.quest.getStage(p), 2, 'foreman briefing');

    h.talk(p, N.SAWMILL_OPERATOR, 3302, 3492, ["I'm here on behalf of the museum archaeological team."]);
    assert.equal(p.inventory.getAmount(I.SAWMILL_PROPOSAL), 1);
    assert.equal(h.quest.getStage(p), 3);

    h.talk(p, N.SAWMILL_OPERATOR, 1623, 3500, ["I'm here on behalf of the museum archaeological team."]);
    assert.equal(p.inventory.getAmount(I.SAWMILL_PROPOSAL), 0);
    assert.equal(p.inventory.getAmount(I.SAWMILL_AGREEMENT), 1);
    assert.equal(h.quest.getStage(p), 4, 'Hosidius sawmill signs the proposal');

    h.talk(p, N.SAWMILL_OPERATOR, 3302, 3492, ["I'm here on behalf of the museum archaeological team."]);
    assert.equal(p.inventory.getAmount(I.SAWMILL_AGREEMENT), 0);
    assert.equal(h.quest.getStage(p), 5, 'Varrock sawmill receives the agreement');

    h.talk(p, N.BARGE_FOREMAN, 3364, 3445);
    assert.equal(h.quest.getStage(p), 6, 'foreman confirms the barge is ready');

    // The crew are the cache's static multinpcs: the plugin spawns none of its own.
    h.talk(p, N.BARGE_GUARD_3, 3362, 3446, ['Can I go onto the barge?']);
    assert.deepEqual(at(p), [3362, 3452, 1], 'the guard helps the player onto the deck (capture tick 118)');
    assert.equal(h.spawned.length, 0, 'no per-player crew copies');

    h.talk(p, N.LEAD_NAVIGATOR, 3363, 3454, ['Yep, that would be me.', 'No, what happened?'], 1);
    assert.equal(h.quest.getStage(p), 7, 'Lead Navigator first meeting');
    assert.equal(p.varbits.get(5795), 22);

    h.npcAction(p, N.BARGE_GUARD, 3362, 3451, 1, 'Disembark');
    assert.deepEqual(at(p), [3362, 3445, 0], 'the deck guard helps the player off (capture tick 168)');
    h.talk(p, N.JACK_SEAGULL, 3047, 3256, ['Ever made any cursed voyages?']);
    assert.equal(h.quest.getStage(p), 8, 'Jack Seagull points to the lucky charm and potion');
    assert.equal(p.varbits.get(5795), 23);

    h.npcAction(p, N.BARGE_GUARD_3, 3362, 3446, 0, 'Embark');
    assert.deepEqual(at(p), [3362, 3452, 1], 'Embark boards straight away (capture tick 160)');
    h.talk(p, N.LEAD_NAVIGATOR, 3363, 3454, [], 1);
    assert.equal(h.quest.getStage(p), 9, 'the navigators agree to take both protections');
    assert.equal(p.varbits.get(5795), 25);

    p.inventory.adds(I.VODKA, 2);
    p.inventory.adds(I.MARRENTILL_POTION_UNF_, 1);
    h.talk(p, N.APOTHECARY, 3195, 3404, ['Talk about something else.', 'Talk about Bone Voyage.']);
    assert.equal(p.varbits.get(5797), 1, 'ingredient explanation mirrors FOSSILQUEST_POTION=1');
    h.talk(p, N.APOTHECARY, 3195, 3404, ['Talk about something else.', 'Talk about Bone Voyage.']);
    assert.equal(p.varbits.get(5797), 2, 'obtaining the potion mirrors FOSSILQUEST_POTION=2');
    assert.equal(p.inventory.getAmount(I.POTION_OF_SEALEGS), 1);

    h.talk(p, N.ODD_OLD_MAN, 3361, 3505, ['Talk about lucky charms.', "I'm making a cursed voyage."]);
    assert.equal(p.inventory.getAmount(I.BONE_CHARM), 1);
    assert.equal(p.varbits.get(5796), 1, 'obtaining the charm mirrors FOSSILQUEST_LUCKY_CHARM=1');

    h.talk(p, N.JUNIOR_NAVIGATOR, 3363, 3453, [], 1);
    assert.equal(p.inventory.getAmount(I.BONE_CHARM), 0);
    assert.equal(p.varbits.get(5796), 2, 'giving the charm mirrors FOSSILQUEST_LUCKY_CHARM=2');
    assert.equal(p.varbits.get(5795), 25, 'wire 30 waits for the potion too');

    h.talk(p, N.LEAD_NAVIGATOR, 3363, 3454, ["I'm ready, let's go."], 1);
    assert.equal(p.inventory.getAmount(I.POTION_OF_SEALEGS), 0);
    assert.equal(p.varbits.get(5797), 3, 'giving the potion mirrors FOSSILQUEST_POTION=3');
    assert.equal(h.quest.getStage(p), 10);
    assert.equal(p.varbits.get(5795), 35, 'the crew sets off: wire 35 (capture)');

    // The briefing ran to its end inside drive(): the barge at sea, the controls open a tick later.
    tick(1);
    const area = p.getPrivateArea();
    assert.ok(area, 'the player is in the sailing instance');
    assert.equal(area.state.phase, 'sailing');
    assert.ok(p.subInterfaces.some(([uid, group, type]) => uid === SIDEMODAL && group === 604 && type === 0), 'controls 604 in the side modal');
    assert.ok(p.subInterfaces.some(([uid, group, type]) => uid === OVERLAY_HUD && group === 603 && type === 1), 'overlay 603 on the HUD');
    assert.equal(p.varbits.get(6719), 2, 'minimap off at sea');
    tick(3); // the set-off's own boarding finds the player already at sea

    // The Junior Navigator at sea goes back over the briefing and closes the controls.
    h.talk(p, N.JUNIOR_NAVIGATOR, 1820, 4762, [], 1);
    assert.equal(h.quest.getStage(p), 10);
    assert.equal(area.state.controlsOpen, false);
    assert.equal(p.varbits.get(14192), 7, 'the hint arrow points at the controls');

    h.operate(p);
    assert.equal(area.state.controlsOpen, true);
    assert.equal(p.varbits.get(14192), 0);

    sailToIsland(h, p);
    assert.equal(area.state.phase, 'arriving', 'the bar fills');
    assert.equal(p.varbits.get(5798), 100);
    tick(7);
    assert.deepEqual(at(p), [3723, 3784, 1], 'the barge lands at the Fossil Island deck (capture tick 705)');
    assert.equal(p.varbits.get(6719), 0, 'minimap back on');
    assert.equal(h.quest.getStage(p), 10);
    tick(3);
    assert.equal(h.quest.getStage(p), 11, 'arrival completes the quest (capture tick 708)');
    assert.equal(p.varbits.get(5795), 50);
    assert.equal(Number(p.getAttribute('quest.points')), 1);
    assert.equal(p.inventory.getAmount(I.FOSSIL_ISLAND_NOTE_BOOK), 0, 'the journal comes with the closing lines');

    for (const handler of h.custom.get('interface:closed') ?? []) handler({ player: p, interfaceId: 153 });
    drive(p, []);
    assert.equal(p.inventory.getAmount(I.FOSSIL_ISLAND_NOTE_BOOK), 1, '"Here, take this journal..."');
    assert.equal(p.getAttribute('bone-voyage:journal-pending'), false);

    const legacy = player();
    h.quest.setStage(legacy, 10);
    legacy.setAttribute('quest.bone_voyage.charm', 2);
    legacy.setAttribute('quest.bone_voyage.potion', 2);
    runtime.sendQuestVarps({ player: legacy });
    for (const login of h.logins) login({ player: legacy });
    assert.equal(legacy.varbits.get(5796), 2, 'login restores the charm varbit from the saved attribute');
    assert.equal(legacy.varbits.get(5797), 3, 'login restores the potion varbit from the saved attribute');
    assert.equal(h.quest.getStage(legacy), 11, 'a stage-10 save from before the voyage (already ashore) completes');
    assert.deepEqual(at(legacy), [3723, 3784, 1]);
    assert.equal(legacy.getAttribute('bone-voyage:journal-pending'), true);
    for (const login of h.logins) login({ player: legacy });
    assert.equal(legacy.inventory.getAmount(I.FOSSIL_ISLAND_NOTE_BOOK), 1, 'a later login hands over a journal never given');

    const underway = player();
    h.quest.setStage(underway, 10);
    underway.setAttribute('quest.bone_voyage.voyage', { phase: 'sailing', progress: 40, bearing: 0, throttle: 1, steer: 0, ticks: 12 });
    runtime.sendQuestVarps({ player: underway });
    for (const login of h.logins) login({ player: underway });
    assert.equal(underway.varbits.get(5795), 35, 'a mid-voyage save resumes on wire stage 35');
    const resumed = underway.getPrivateArea();
    assert.ok(resumed, 'a mid-voyage save re-enters the sailing instance');
    assert.equal(resumed.state.progress, 40);
    assert.equal(underway.varbits.get(14192), 7, 'controls closed: hint arrow on them');
    assert.equal(underway.varbits.get(6719), 2, 'the minimap stays off for the whole voyage');
    h.talk(underway, N.JUNIOR_NAVIGATOR, 1820, 4762, [], 1);
    assert.equal(h.quest.getStage(underway), 10, 'the Junior Navigator at sea cannot complete it');
    resumed.leave(underway, false);
  } finally {
    h.restore();
  }
}));

test('Berry signs for players who cannot enter the Woodcutting Guild', () => {
  const h = setup();
  try {
    const p = player(50);
    h.quest.setStage(p, 3);
    p.inventory.adds(I.SAWMILL_PROPOSAL, 1);
    h.talk(p, N.BERRY_3, 1657, 3506);
    assert.equal(p.inventory.getAmount(I.SAWMILL_PROPOSAL), 0);
    assert.equal(p.inventory.getAmount(I.SAWMILL_AGREEMENT), 1);
    assert.equal(h.quest.getStage(p), 4);

    const eligible = player(99);
    h.quest.setStage(eligible, 3);
    eligible.inventory.adds(I.SAWMILL_PROPOSAL, 1);
    h.talk(eligible, N.BERRY_3, 1657, 3506);
    assert.equal(eligible.inventory.getAmount(I.SAWMILL_AGREEMENT), 0, 'Berry only welcomes an eligible player');
    assert.equal(h.quest.getStage(eligible), 3);
  } finally {
    h.restore();
  }
});

test('lost proposal, agreement, potion and charm are reclaimable through their handlers', () => {
  const h = setup();
  try {
    const proposal = player();
    h.quest.setStage(proposal, 3);
    h.talk(proposal, N.SAWMILL_OPERATOR, 3302, 3492, ["I'm here on behalf of the museum archaeological team."]);
    assert.equal(proposal.inventory.getAmount(I.SAWMILL_PROPOSAL), 1);

    const agreement = player();
    h.quest.setStage(agreement, 4);
    h.talk(agreement, N.BERRY_3, 1657, 3506);
    assert.equal(agreement.inventory.getAmount(I.SAWMILL_AGREEMENT), 1);

    const potion = player();
    h.quest.setStage(potion, 9);
    potion.setAttribute('quest.bone_voyage.potion', 1);
    potion.setAttribute('quest.bone_voyage.apothecary', 1);
    h.talk(potion, N.APOTHECARY, 3195, 3404, ['Talk about Bone Voyage.']);
    assert.equal(potion.inventory.getAmount(I.POTION_OF_SEALEGS), 1);

    const charm = player();
    h.quest.setStage(charm, 9);
    charm.setAttribute('quest.bone_voyage.charm', 1);
    h.talk(charm, N.ODD_OLD_MAN, 3361, 3505, ['Talk about lucky charms.']);
    assert.equal(charm.inventory.getAmount(I.BONE_CHARM), 1);
  } finally {
    h.restore();
  }
});

test('shared Curator ownership and the Pandemonium branch follow Quest Helper', () => {
  const curator = (h, p) =>
    h.variants.map((fn) => fn({ player: p, npcId: N.CURATOR_HAIG_HALEN })).find(Boolean) ?? null;

  const ready = setup({ complete: ['the_dig_site'] });
  try {
    const p = player();
    ready.quest.setStage(p, 0);
    assert.equal(curator(ready, p), 'starting-out-talking-to-curator-haig-halen');
  } finally {
    ready.restore();
  }

  const noDigSite = setup({ complete: [] });
  try {
    const p = player();
    noDigSite.quest.setStage(p, 0);
    assert.equal(curator(noDigSite, p), null, 'The Dig Site must be complete before Bone Voyage can start');
  } finally {
    noDigSite.restore();
  }

  const golemActive = setup({ complete: ['the_dig_site'], started: ['the_golem'] });
  try {
    const p = player();
    golemActive.quest.setStage(p, 0);
    assert.equal(curator(golemActive, p), null, 'an active Golem museum step keeps the Curator');
  } finally {
    golemActive.restore();
  }

  const golemDone = setup({ complete: ['the_dig_site', 'the_golem'] });
  try {
    const p = player();
    golemDone.quest.setStage(p, 0);
    assert.equal(curator(golemDone, p), 'starting-out-talking-to-curator-haig-halen');
    const condition = (stepId) =>
      golemDone.conditions.map((fn) => fn({ player: p, npcId: N.LEAD_NAVIGATOR, stepId }))
        .find((answer) => typeof answer === 'boolean');
    assert.equal(condition('5OiggG'), true, 'Pandemonium incomplete branch');
    assert.equal(condition('FkQAxU'), false);
  } finally {
    golemDone.restore();
  }

  const pandemoniumDone = setup({ complete: ['the_dig_site', 'pandemonium'] });
  try {
    const p = player();
    const condition = (stepId) =>
      pandemoniumDone.conditions.map((fn) => fn({ player: p, npcId: N.LEAD_NAVIGATOR, stepId }))
        .find((answer) => typeof answer === 'boolean');
    assert.equal(condition('5OiggG'), false, 'Pandemonium complete branch');
    assert.equal(condition('FkQAxU'), true);
  } finally {
    pandemoniumDone.restore();
  }
});

test('Bone Voyage owns the Curator in-quest and hands him back to the standard dialogue when complete', () => {
  const talkLines = (h) => {
    const lines = [];
    h.api.onCustomEvent('npc-dialogue:line', (event) => lines.push(String(event.text ?? '')));
    return (p, choices) => {
      lines.length = 0;
      h.talk(p, N.CURATOR_HAIG_HALEN, 3257, 3447, choices);
      return [...lines];
    };
  };

  const during = setup();
  try {
    const p = player();
    during.quest.setStage(p, 1);
    const lines = talkLines(during)(p, ['Have you any interesting news?']);
    assert.ok(lines.some((text) => text.includes('The expedition to the island North of Morytania')),
      'pre-completion still plays the in-quest Curator page');
    assert.ok(!lines.some((text) => text.includes("We've seen some incredible specimens")),
      'the standard post-quest news is not reachable before completion');
  } finally {
    during.restore();
  }

  const completed = setup();
  try {
    const p = player();
    completed.quest.setStage(p, 11);
    assert.equal(completed.quest.isComplete(p), true);
    const lines = talkLines(completed)(p, ['Talk about Fossil Island.', 'Have you any interesting news?']);
    assert.ok(lines.some((text) => text.includes("I've got some questions regarding Fossil Island.")),
      'the post-quest fossil-island option is offered');
    assert.ok(lines.some((text) => text.includes("We've seen some incredible specimens come back from Fossil Island!")),
      'completion selects the canonical standard Curator dialogue');
    assert.ok(!lines.some((text) => text.includes('The expedition to the island North of Morytania')),
      'the completed player no longer gets the in-quest Curator page');
  } finally {
    completed.restore();
  }
});

test('durable stages map to the Quest Helper wire stages on setStage and login', () => {
  const h = setup();
  try {
    const p = player();
    const wire = { 0: 0, 1: 5, 2: 10, 3: 11, 4: 15, 5: 20, 6: 21, 7: 22, 8: 23, 9: 25, 10: 35, 11: 50 };
    for (const [stage, expected] of Object.entries(wire)) {
      h.quest.setStage(p, Number(stage));
      assert.equal(p.varbits.get(5795), expected, `durable stage ${stage}`);
    }
    const ready = player();
    ready.setAttribute('quest.bone_voyage.charm', 2);
    ready.setAttribute('quest.bone_voyage.potion', 2);
    h.quest.setStage(ready, 9);
    assert.equal(ready.varbits.get(5795), 30, 'both protections given: wire 30');
    for (const [stage, expected] of Object.entries(wire)) {
      if (Number(stage) === 10) continue; // a bare stage-10 save completes on login (main route test)
      const oldSave = player();
      oldSave.setAttribute('quest.bone_voyage.stage', Number(stage));
      runtime.sendQuestVarps({ player: oldSave });
      for (const login of h.logins) login({ player: oldSave });
      assert.equal(oldSave.varbits.get(5795), expected, `legacy durable stage ${stage} on login`);
    }
  } finally {
    h.restore();
  }
});

function sailingPlayer(h, voyage) {
  const p = player();
  p.setAttribute('quest.bone_voyage.potion', 2);
  p.setAttribute('quest.bone_voyage.charm', 2);
  h.quest.setStage(p, 10);
  p.setAttribute('quest.bone_voyage.voyage', { phase: 'sailing', progress: 30, bearing: 0, throttle: 2, steer: 0, ticks: 0, ...voyage });
  runtime.sendQuestVarps({ player: p });
  for (const login of h.logins) login({ player: p });
  h.operate(p);
  return p;
}

test('a voyage too long off course goes back to the canal deck at wire 35', () => steadyWind(() => {
  const h = setup();
  try {
    const p = sailingPlayer(h, { bearing: 30, offCourse: 19 });
    const area = p.getPrivateArea();
    for (let i = 0; i < 4; i++) area.process(p);
    assert.equal(area.state.phase, 'returning');
    tick(3);
    assert.deepEqual(at(p), [3360, 3453, 1], 'back on the canal barge');
    assert.equal(h.quest.getStage(p), 10, 'the crew has still set off once');
    assert.equal(p.varbits.get(5795), 35);
    const variant = (npcId) => h.variants.map((fn) => fn({ player: p, npcId })).find(Boolean) ?? null;
    assert.equal(variant(N.LEAD_NAVIGATOR), 'the-cursed-voyage-aborting-the-voyage-talking-to-junior-navigator-after-failing-a-voyage-talking-to-the-lead-navigator-to-try-again');
    assert.equal(variant(N.JUNIOR_NAVIGATOR), 'the-cursed-voyage-aborting-the-voyage-talking-to-junior-navigator-after-failing-a-voyage');
  } finally {
    h.restore();
  }
}));

test('the sailing model: +10 on course, -5 off it, every 4 ticks with the sails of the update before', () => steadyWind(() => {
  const h = setup();
  try {
    const p = sailingPlayer(h, { progress: 30, bearing: 6, steer: 2, lastThrottle: 2 });
    const area = p.getPrivateArea();
    for (let i = 0; i < 3; i++) area.process(p);
    assert.equal(area.state.progress, 30, 'nothing between updates');
    area.process(p);
    assert.equal(area.state.progress, 40, '6 steps from north is on course');
    area.state.bearing = 7;
    for (let i = 0; i < 4; i++) area.process(p);
    assert.equal(area.state.progress, 35, '7 steps off loses 5');
    h.press(p, (604 << 16) | 12);
    h.press(p, (604 << 16) | 12);
    h.press(p, (604 << 16) | 39); // rudder back to straight: the lowered sails' drift is +1 an update
    assert.equal(area.state.throttle, 0);
    assert.equal(area.state.steer, 0);
    area.state.bearing = 0;
    for (let i = 0; i < 4; i++) area.process(p);
    assert.equal(area.state.progress, 45, 'the update after lowering still sails at full');
    for (let i = 0; i < 8; i++) area.process(p);
    assert.equal(area.state.progress, 45, 'lowered sails: one step per three updates');
    for (let i = 0; i < 4; i++) area.process(p);
    assert.equal(area.state.progress, 55);
    area.leave(p, false);
  } finally {
    h.restore();
  }
}));

test('a set-off walked away from on the first message box still fades in and sails', () => steadyWind(() => {
  const h = setup();
  try {
    const p = player();
    p.setAttribute('quest.bone_voyage.potion', 2);
    p.setAttribute('quest.bone_voyage.charm', 2);
    h.quest.setStage(p, 9);
    // The giving-potion page from "Looks like we've got everything..." up to the first message box.
    h.npcAction(p, N.LEAD_NAVIGATOR, 3363, 3454, 1, 'Talk-to');
    for (let i = 0; i < 20 && !MultiChatboxPrompt.getPending(p); i++) p.getDialogueManager().advance();
    assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: p, groupId: 219, slot: 1 }), true);
    assert.equal(h.quest.getStage(p), 10);
    p.getDialogueManager().reset(); // the player clicks away from "Each member of the crew..."
    tick(5);
    const area = p.getPrivateArea();
    assert.ok(area, 'the barge still sets off');
    assert.equal(area.state.phase, 'sailing', 'the briefing ends with the chatbox');
    assert.equal(p.varbits.get(14192), 7, 'the controls wait with the hint arrow');
    h.operate(p);
    assert.equal(area.state.controlsOpen, true, 'Operate opens them');
    area.leave(p, false);
  } finally {
    h.restore();
  }
}));

test('Operate during a briefing cut short takes over from it', () => steadyWind(() => {
  const h = setup();
  try {
    const p = player();
    h.quest.setStage(p, 10);
    p.setAttribute('quest.bone_voyage.voyage', { phase: 'returned' });
    h.npcAction(p, N.LEAD_NAVIGATOR, 3363, 3454, 1, 'Talk-to');
    for (let i = 0; i < 20 && !MultiChatboxPrompt.getPending(p); i++) p.getDialogueManager().advance();
    assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: p, groupId: 219, slot: 1 }), true);
    for (let i = 0; i < 3; i++) p.getDialogueManager().advance(); // both boxes and the Junior's first line
    const area = p.getPrivateArea();
    assert.equal(area.state.phase, 'briefing');
    h.operate(p);
    assert.equal(area.state.phase, 'sailing');
    assert.equal(area.state.controlsOpen, true);
    area.leave(p, false);
  } finally {
    h.restore();
  }
}));

test('abort closes the controls, lands on the canal deck and allows a retry', () => steadyWind(() => {
  const h = setup();
  try {
    const p = sailingPlayer(h, {});
    const area = p.getPrivateArea();
    assert.ok(area);
    h.press(p, (604 << 16) | 2);
    assert.equal(area.state.controlsOpen, false, 'the controls close first (capture tick 415)');
    assert.equal(p.varbits.get(14192), 7);
    assert.deepEqual(MultiChatboxPrompt.getPending(p), { title: 'Abort the voyage?', options: ['Yes.', 'Cancel.'] });
    assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: p, groupId: 219, slot: 1 }), true);
    assert.ok(p.closedSubInterfaces.includes(OVERLAY_HUD), 'the overlay goes with Yes');
    assert.equal(p.messages.length, 0, 'the message comes with the landing');
    tick(3);
    assert.ok(p.messages.includes('With the aid of the junior navigator, you sail back to the digsite...'));
    assert.deepEqual(at(p), [3360, 3453, 1], 'the canal barge deck (capture tick 428)');
    assert.equal(h.quest.getStage(p), 10);
    assert.equal(p.varbits.get(5795), 35, 'abort keeps wire 35');

    h.talk(p, N.LEAD_NAVIGATOR, 3363, 3454, ["I'm ready, let's go."], 1);
    tick(1);
    const retried = p.getPrivateArea();
    assert.ok(retried && retried !== area, 'the retry starts a new sailing instance');
    assert.equal(retried.state.progress, 0, 'a new voyage starts from nothing');
    assert.equal(retried.state.phase, 'sailing');
    retried.leave(p, false);
  } finally {
    h.restore();
  }
}));

test('post-quest navigators and guards use their pages by barge', () => {
  const h = setup();
  try {
    const p = player();
    h.quest.setStage(p, 11);
    const npcAt = (x, y, z) => ({ getLocation: () => new core.Location(x, y, z) });
    const variant = (npcId, npc) => h.variants.map((fn) => fn({ player: p, npcId, npc })).find(Boolean) ?? null;
    assert.equal(variant(N.LEAD_NAVIGATOR_2, npcAt(3363, 3454, 1)), 'standard-dialogue-digsite');
    assert.equal(variant(N.LEAD_NAVIGATOR_2, npcAt(3723, 3784, 1)), 'standard-dialogue-fossil-island');
    assert.equal(variant(N.JUNIOR_NAVIGATOR_2, npcAt(3723, 3785, 1)), 'standard-dialogue-fossil-island');
    assert.equal(variant(N.BARGE_GUARD, npcAt(3362, 3451, 1)), 'after-bone-voyage-on-the-barge');
    assert.equal(variant(N.BARGE_GUARD_2, npcAt(3362, 3446, 0)), 'after-bone-voyage-on-the-canal');
    const midQuest = player();
    h.quest.setStage(midQuest, 10);
    assert.equal(h.variants.map((fn) => fn({ player: midQuest, npcId: N.BARGE_GUARD })).find(Boolean), 'after-bone-voyage-on-the-barge',
      'the deck guard offers "Can I get off the barge?" mid-quest (capture tick 147)');
  } finally {
    h.restore();
  }
});

test('Bone Voyage starts only with The Dig Site and real Museum Kudos at 100', () => {
  const h = setup();
  try {
    const low = player();
    low.setAttribute('museum:kudos', 99);
    h.quest.setStage(low, 0);
    h.talk(low, N.CURATOR_HAIG_HALEN, 3257, 3447, ['Have you any interesting news?']);
    assert.equal(h.quest.getStage(low), 0, '99 Kudos cannot start the quest');
    assert.ok(low.messages.some((text) => /do not meet all of the requirements/.test(String(text))),
      'the canonical Curator refusal is shown at 99 Kudos');
    for (const handler of h.custom.get('npc-dialogue:hook') ?? []) {
      handler({ player: low, npcId: N.CURATOR_HAIG_HALEN, hook: 'quest:bone-voyage:start' });
    }
    assert.equal(h.quest.getStage(low), 0, 'the registered start hook also refuses 99 Kudos');

    const ready = player();
    ready.setAttribute('museum:kudos', 100);
    h.quest.setStage(ready, 0);
    h.talk(ready, N.CURATOR_HAIG_HALEN, 3257, 3447, ['Have you any interesting news?', 'Yes.']);
    assert.equal(h.quest.getStage(ready), 1, '100 Kudos starts the quest');
  } finally {
    h.restore();
  }

  const noDigSite = setup({ complete: [] });
  try {
    const p = player();
    p.setAttribute('museum:kudos', 100);
    noDigSite.quest.setStage(p, 0);
    const variant = noDigSite.variants.map((fn) => fn({ player: p, npcId: N.CURATOR_HAIG_HALEN })).find(Boolean) ?? null;
    assert.equal(variant, null, 'The Dig Site still gates the Bone Voyage Curator page');
    for (const handler of noDigSite.custom.get('npc-dialogue:hook') ?? []) {
      handler({ player: p, npcId: N.CURATOR_HAIG_HALEN, hook: 'quest:bone-voyage:start' });
    }
    assert.equal(noDigSite.quest.getStage(p), 0, 'the start hook requires The Dig Site too');
  } finally {
    noDigSite.restore();
  }
});
