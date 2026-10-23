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
    forceAdd: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); },
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
    getUsername: () => 'Qh728Bone', getIndex: () => 1, isPlayerBot: () => false,
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

test('fresh stage 0 to completion follows the mandatory Quest Helper route', () => {
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

    // Without this foreman leg the guard's "Can I go onto the barge?" must not
    // spawn the navigators (covered by the previous test), so board only after it.
    h.talk(p, N.BARGE_FOREMAN, 3364, 3445);
    assert.equal(h.quest.getStage(p), 6, 'foreman confirms the barge is ready');

    h.talk(p, N.BARGE_GUARD_3, 3364, 3446, ['Can I go onto the barge?']);
    assert.equal(h.spawned.filter((npc) => npc.def.id === N.LEAD_NAVIGATOR).length, 1);
    assert.equal(h.spawned.filter((npc) => npc.def.id === N.JUNIOR_NAVIGATOR).length, 1);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3360, 3454, 1], 'boarding lands on the real barge deck');

    h.talk(p, N.LEAD_NAVIGATOR, 3363, 3453, ['Yep, that would be me.', 'No, what happened?'], 1);
    assert.equal(h.quest.getStage(p), 7, 'Lead Navigator first meeting');
    assert.equal(p.varbits.get(5795), 22);

    h.npcAction(p, N.BARGE_GUARD, 3362, 3451, 1, 'Disembark');
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3364, 3446, 0], 'deck guard disembarks to the bank');
    h.talk(p, N.JACK_SEAGULL, 3047, 3256, ['Ever made any cursed voyages?']);
    assert.equal(h.quest.getStage(p), 8, 'Jack Seagull points to the lucky charm and potion');
    assert.equal(p.varbits.get(5795), 23);

    h.npcAction(p, N.BARGE_GUARD_3, 3364, 3446, 0, 'Embark');
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3360, 3454, 1], 'bank guard re-embarks after Port Sarim');
    h.talk(p, N.LEAD_NAVIGATOR, 3363, 3453, [], 1);
    assert.equal(h.quest.getStage(p), 9, 'the navigators agree to take both protections');
    assert.equal(p.varbits.get(5795), 25);

    p.inventory.adds(I.VODKA, 2);
    p.inventory.adds(I.MARRENTILL_POTION_UNF_, 1);
    h.talk(p, N.APOTHECARY, 3195, 3404, ['Talk about something else.', 'Talk about Bone Voyage.']);
    assert.equal(p.varbits.get(5797), 1, 'ingredient explanation mirrors FOSSILQUEST_POTION=1');
    h.talk(p, N.APOTHECARY, 3195, 3404, ['Talk about something else.', 'Talk about Bone Voyage.']);
    assert.equal(p.varbits.get(5797), 2, 'obtaining the potion mirrors FOSSILQUEST_POTION=2');
    assert.equal(p.inventory.getAmount(I.VODKA), 0);
    assert.equal(p.inventory.getAmount(I.MARRENTILL_POTION_UNF_), 0);
    assert.equal(p.inventory.getAmount(I.POTION_OF_SEALEGS), 1);
    assert.equal(Number(p.getAttribute('quest.bone_voyage.potion')), 1);

    h.talk(p, N.ODD_OLD_MAN, 3361, 3505, ['Talk about lucky charms.', "I'm making a cursed voyage."]);
    assert.equal(p.inventory.getAmount(I.BONE_CHARM), 1);
    assert.equal(p.varbits.get(5796), 1, 'obtaining the charm mirrors FOSSILQUEST_LUCKY_CHARM=1');

    h.talk(p, N.JUNIOR_NAVIGATOR, 3361, 3452, [], 1);
    assert.equal(p.inventory.getAmount(I.BONE_CHARM), 0);
    assert.equal(Number(p.getAttribute('quest.bone_voyage.charm')), 2);
    assert.equal(p.varbits.get(5796), 2, 'giving the charm mirrors FOSSILQUEST_LUCKY_CHARM=2');

    h.talk(p, N.LEAD_NAVIGATOR, 3363, 3453, ["I'm ready, let's go."], 1);
    assert.equal(p.inventory.getAmount(I.POTION_OF_SEALEGS), 0);
    assert.equal(Number(p.getAttribute('quest.bone_voyage.potion')), 2);
    assert.equal(p.varbits.get(5797), 3, 'giving the potion mirrors FOSSILQUEST_POTION=3');
    assert.equal(h.quest.getStage(p), 10);
    assert.equal(p.varbits.get(5795), 30, 'sailing writes QH wire stage 30');
    assert.equal(h.removed.filter((npc) => npc.def.id === N.LEAD_NAVIGATOR).length, 1, 'canal crew leaves the deck for the voyage');

    const area = p.getPrivateArea();
    assert.ok(area, 'the player is in the sailing instance');
    assert.equal(area.state.progress, 0);
    assert.equal(area.state.phase, 'sailing');

    // Registered transcript runner while still at sea after the sailing checkpoint:
    // Junior must not offer the finishing-up/MUBvQ9 branch.
    h.talk(p, N.JUNIOR_NAVIGATOR, 1815, 4760, [], 1);
    assert.equal(h.quest.getStage(p), 10, 'Junior at sea keeps the quest at stage 10');
    assert.equal(p.varbits.get(5795), 30, 'Junior at sea keeps wire 30, not native 50');
    assert.equal(p.inventory.getAmount(I.FOSSIL_ISLAND_NOTE_BOOK), 0, 'no reward at sea');
    assert.equal(Number(p.getAttribute('quest.points')) || 0, 0, 'no quest point at sea');
    const seaAction = { player: p, npcId: N.JUNIOR_NAVIGATOR, stepId: 'MUBvQ9', handled: false };
    for (const handler of h.custom.get('npc-dialogue:action') ?? []) handler(seaAction);
    assert.equal(seaAction.handled, false, 'direct MUBvQ9 dispatch is refused at sea');
    assert.equal(h.quest.getStage(p), 10);

    h.operate(p);
    assert.ok(p.subInterfaces.some(([uid, group]) => uid === ((161 << 16) | 8) && group === 604), 'controls interface 604 opens');
    assert.ok(p.subInterfaces.some(([uid, group]) => uid === ((161 << 16) | 1) && group === 603), 'progress overlay 603 opens');
    assert.equal(p.varbits.get(5798), 0);

    h.press(p, (604 << 16) | 11);
    h.press(p, (604 << 16) | 11);
    assert.equal(area.state.throttle, 3, 'Increase throttle raises the sails');
    for (let tick = 0; tick < 80 && area.state.phase === 'sailing'; tick++) {
      const wind = area.state.wind ?? 0;
      while (area.state.heading < wind) h.press(p, (604 << 16) | 38);
      while (area.state.heading > wind) h.press(p, (604 << 16) | 39);
      area.process(p);
    }
    assert.equal(area.state.phase, 'arrived', 'the voyage reaches Fossil Island');
    assert.ok(p.varbits.get(5798) >= 100);
    assert.equal(h.quest.getStage(p), 10, 'arrival keeps the durable sailing stage');
    assert.equal(p.varbits.get(5795), 35, 'arrival writes QH wire stage 35');
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3720, 3782, 0]);
    assert.ok(p.closedSubInterfaces.includes((161 << 16) | 8));
    assert.ok(p.closedSubInterfaces.includes((161 << 16) | 1));
    assert.equal(h.spawned.filter((npc) => npc.def.id === N.JUNIOR_NAVIGATOR).length, 3, 'sailing junior is replaced by the island junior');

    h.talk(p, N.JUNIOR_NAVIGATOR, 3721, 3782);
    assert.equal(h.quest.getStage(p), 11);
    assert.equal(p.varbits.get(5795), 50, 'completion writes native quest DB value 50');
    assert.equal(p.inventory.getAmount(I.FOSSIL_ISLAND_NOTE_BOOK), 1);
    assert.equal(Number(p.getAttribute('quest.points')), 1);
    assert.equal(h.removed.filter((npc) => npc.def.id === N.JUNIOR_NAVIGATOR).length, 2, 'canal and island juniors removed; the sailing scene junior dies with its instance');
    assert.equal(p.varbits.get(5796), 2);
    assert.equal(p.varbits.get(5797), 3);

    const relog = player();
    h.quest.setStage(relog, 10);
    relog.setAttribute('quest.bone_voyage.charm', 2);
    relog.setAttribute('quest.bone_voyage.potion', 2);
    runtime.sendQuestVarps({ player: relog });
    for (const login of h.logins) login({ player: relog });
    assert.equal(relog.varbits.get(5796), 2, 'login restores the charm varbit from the saved attribute');
    assert.equal(relog.varbits.get(5797), 3, 'login restores the potion varbit from the saved attribute');
    assert.equal(relog.varbits.get(5795), 35, 'old stage-10 saves are treated as already ashore');
    assert.deepEqual([relog.getLocation().getX(), relog.getLocation().getY()], [3720, 3782]);

    const underway = player();
    h.quest.setStage(underway, 10);
    underway.setAttribute('quest.bone_voyage.voyage', { phase: 'sailing', progress: 40, heading: 0, throttle: 1, ticks: 12, wind: 0 });
    runtime.sendQuestVarps({ player: underway });
    for (const login of h.logins) login({ player: underway });
    assert.equal(underway.varbits.get(5795), 30, 'a live mid-voyage save resumes on wire stage 30');
    const resumed = underway.getPrivateArea();
    assert.ok(resumed, 'a live mid-voyage save re-enters the sailing instance');
    assert.equal(resumed.state.progress, 40);
    h.talk(underway, N.JUNIOR_NAVIGATOR, 1815, 4760, [], 1);
    assert.equal(h.quest.getStage(underway), 10, 'replay at sea still cannot complete');
    assert.equal(underway.varbits.get(5795), 30, 'replay at sea keeps wire 30');
    assert.equal(underway.inventory.getAmount(I.FOSSIL_ISLAND_NOTE_BOOK), 0);
    assert.equal(Number(underway.getAttribute('quest.points')) || 0, 0);
    resumed.leave(underway, false);
  } finally {
    h.restore();
  }
});

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
    const wire = { 0: 0, 1: 5, 2: 10, 3: 11, 4: 15, 5: 20, 6: 21, 7: 22, 8: 23, 9: 25, 10: 30, 11: 50 };
    for (const [stage, expected] of Object.entries(wire)) {
      h.quest.setStage(p, Number(stage));
      assert.equal(p.varbits.get(5795), expected, `durable stage ${stage}`);
    }
    for (const [stage, expected] of Object.entries(wire)) {
      const oldSave = player();
      oldSave.setAttribute('quest.bone_voyage.stage', Number(stage));
      runtime.sendQuestVarps({ player: oldSave });
      for (const login of h.logins) login({ player: oldSave });
      if (Number(stage) === 10) {
        assert.equal(oldSave.varbits.get(5795), 35, 'legacy stage-10 save is treated as arrived');
      } else {
        assert.equal(oldSave.varbits.get(5795), expected, `legacy durable stage ${stage} on login`);
      }
    }
  } finally {
    h.restore();
  }
});

test('abort closes the controls, returns to the canal and allows a retry', () => {
  const h = setup();
  try {
    const p = player();
    p.setAttribute('quest.bone_voyage.potion', 2);
    h.quest.setStage(p, 10);
    p.setAttribute('quest.bone_voyage.voyage', { phase: 'sailing', progress: 30, heading: 0, throttle: 2, ticks: 9, wind: 0 });
    runtime.sendQuestVarps({ player: p });
    for (const login of h.logins) login({ player: p });
    h.operate(p);
    const area = p.getPrivateArea();
    assert.ok(area);
    h.press(p, (604 << 16) | 2);
    assert.equal(h.quest.getStage(p), 9);
    assert.equal(p.varbits.get(5795), 25);
    assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3364, 3446, 0]);
    assert.ok(p.closedSubInterfaces.includes((161 << 16) | 8));
    assert.ok(p.closedSubInterfaces.includes((161 << 16) | 1));
    assert.equal(h.spawned.filter((npc) => npc.def.id === N.LEAD_NAVIGATOR).length, 1, 'retry lead is back on the deck');
    assert.equal(h.spawned.filter((npc) => npc.def.id === N.JUNIOR_NAVIGATOR).length >= 1, true, 'retry junior is available');

    h.npcAction(p, N.BARGE_GUARD_3, 3364, 3446, 0, 'Embark');
    h.talk(p, N.LEAD_NAVIGATOR, 3363, 3453, ["I'm ready, let's go."], 1);
    assert.equal(h.quest.getStage(p), 10);
    assert.equal(p.varbits.get(5795), 30);
    const retried = p.getPrivateArea();
    assert.ok(retried, 'the retry starts a new sailing instance');
    retried.leave(p, false);
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
