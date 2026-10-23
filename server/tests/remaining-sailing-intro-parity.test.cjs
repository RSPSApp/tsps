const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const sailingContent = require('../plugins/skills/sailing/SailingContent.Sailing');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  sailingContent.content();
  require('../plugins/skills/sailing/porttasks/Common.PortTasks').init(PluginManager.getCoreApi());
});

function setup() {
  const hooks = { variants: [], conditions: [], npcs: [], named: new Map(), objects: [], routes: [], items: [], itemOnNpc: [], itemActions: [], interfaceClicks: [], groundClick: [], groundPickup: [], deaths: [], zones: [], ladders: [], login: [], logout: [], custom: new Map() };
  const tasks = [];
  let lastPrompt = null;
  let tick = 0;
  const executed = new Set();
  const persistentKeys = new Map();
  const core = {
    ...PluginManager.getCoreApi(),
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    TaskManager: { submit(task) { task.due = tick + (task.ticks ?? 1); tasks.push(task); }, cancelTasks() {} },
    TeleportHandler: { teleport(player, location, _type, _delay, onArrival) { player.moveTo(location); onArrival?.(); } },
    ObjectManager: { register() {}, deregister() {} },
    ShopManager: { open() { return true; } },
  };
  const api = new Proxy({
    core,
    persistAttribute(key, defaultValue) { persistentKeys.set(key, defaultValue); },
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(target, actions) { if (typeof target === 'string') hooks.named.set(target, actions); else hooks.npcs.push(target); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onObjectRoute(fn) { hooks.routes.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') {
        const quest = runtime.getRegisteredQuests().find((entry) => entry.key === event.key);
        if (quest && event.player) event.complete = quest.isComplete(event.player);
      }
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    onItemOnItem(fn) { hooks.items.push(fn); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onItemAction(fn) { hooks.itemActions.push(fn); },
    onInterfaceActionClick(fn) { hooks.interfaceClicks.push(fn); },
    onGroundItemClick(ids, option, fn) { hooks.groundClick.push({ ids, option, fn }); },
    onGroundItemPickup(fn) { hooks.groundPickup.push(fn); },
    onNpcDeath(fn) { hooks.deaths.push(fn); },
    onZoneEnter(zone, fn) { hooks.zones.push({ zone, fn }); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    spawnNpc(definition) {
      const npc = { definition, getId: () => definition.id, getLocation: () => new core.Location(definition.x ?? 0, definition.y ?? 0, definition.z ?? 0), isRegistered: () => true, isNpc: () => true, isPlayer: () => false, getAsNpc() { return npc; }, getArea: () => npc.__area, setArea: (area) => { npc.__area = area; }, isOwnerOnly: () => definition.ownerOnly, getOwner: () => definition.owner };
      return npc;
    },
    removeNpc() {},
    getItemOnGroundManager() { return { getGroundItem: () => undefined, registerLocation: () => {} }; },
    sendMultiChatboxPrompt(player, prompt, ...pairs) { lastPrompt = { prompt, pairs }; return true; },
    getWorld() { return { getNpcs: () => [] }; },
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  const attrs = new Map(), inventory = new Map(), varbits = new Map(), messages = [], xp = [], interfaces = [], scripts = [], cameras = [], hints = [], closedInterfaces = 0;
  const levels = new Map();
  let location = new core.Location(3025, 3208, 0);
  const sailing = { boats: [], activeBoatSlot: null };
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendInterface(id) { interfaces.push(id); return sender; },
    sendInterfaceScript(id, args) { scripts.push({ id, args }); return sender; },
    sendInterfaceRemoval() { closedInterfaces++; return sender; },
    sendCameraMoveTo(...args) { cameras.push(['move', ...args.slice(0, 3)]); return sender; },
    sendCameraLookAt(...args) { cameras.push(['look', ...args.slice(0, 3)]); return sender; },
    sendCameraMoveArc(...args) { cameras.push(['arc', ...args.slice(0, 6)]); return sender; },
    sendCameraReset() { cameras.push(['reset']); return sender; },
    sendPositionalHint(...args) { hints.push(args.slice(0, 4)); return sender; },
    clearHintArrow() { hints.push(['clear']); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    sendInterfaceRemoval() { return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    getFrameUpdater: () => null,
    sendMessage(message) { messages.push(message); },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
      addItem(item) { this.adds(item.getId(), item.getAmount()); },
      forceAdd(_player, item) { this.adds(item.getId(), item.getAmount()); },
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      delete(id, count) { this.deleteNumber(id, count); },
      getFreeSlots() { return 28 - [...inventory.values()].filter((count) => count > 0).length; },
      isFull() { return this.getFreeSlots() === 0; },
    }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => levels.get(skill) ?? 99,
      getCurrentLevel: (skill) => levels.get(skill) ?? 99,
      addExperiences(skill, amount) { xp.push({ skill, amount }); },
    }),
    getLocation: () => location,
    moveTo(value) { location = value; },
    getSailing: () => sailing,
    isRegistered: () => true,
    isPlayerBot: () => false,
    getIndex: () => 1,
    isPlayer: () => true,
    getAsPlayer() { return player; },
    isNpc: () => false,
    getEquipment: () => ({ getItems: () => [] }),
    getDialogueManager: () => ({ isActive: () => false, startDialogues() {}, getCurrent() { return null; } }),
    getPrivateArea: () => null,
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    setUntargetable() {},
    performAnimation() {},
    getArea: () => player.__area,
    setArea: (area) => { player.__area = area; },
    getUsername: () => 'parity',
    setEnteredAmountAction(action) { player.amountAction = action; },
    getEnteredAmountAction() { return player.amountAction; },
  };
  let lastLineSpeakerId = null;
  const saveState = () => {
    const saved = {};
    for (const [key, defaultValue] of persistentKeys) {
      saved[key] = attrs.has(key) ? attrs.get(key) : defaultValue;
    }
    return saved;
  };
  const restoreState = (saved) => {
    attrs.clear();
    for (const [key, defaultValue] of persistentKeys) {
      attrs.set(key, saved[key] === undefined ? defaultValue : saved[key]);
    }
  };
  const relog = (saved = saveState()) => {
    restoreState(saved);
    for (const fn of hooks.login) fn({ player });
  };
  const emit = (name, event) => { const full = { player, ...event }; api.emitCustomEvent(name, full); if (name === 'npc-dialogue:line') lastLineSpeakerId = full.speakerId ?? null; return full; };
  const action = (npcId, stepId) => emit('npc-dialogue:action', { npcId, stepId });
  const line = (npcId, text, step) => emit('npc-dialogue:line', { npcId, text, step });
  const variant = (npcId) => {
    for (const fn of [...hooks.variants].reverse()) {
      const result = fn({ player, npcId });
      if (result) return result;
    }
    return null;
  };
  const tickOnce = () => {
    tick++;
    for (const task of [...tasks]) if (!executed.has(task) && task.due <= tick) { executed.add(task); task.run(); }
  };
  const answerPrompt = (label) => {
    const index = lastPrompt.pairs.indexOf(label);
    assert.ok(index >= 0, `prompt option ${label}`);
    lastPrompt.pairs[index + 1]();
  };
  const clickObject = (objectId) => { for (const fn of hooks.objects) fn({ player, objectId, clickType: 1 }); };
  const clickInterface = (groupId, childId) => { const event = { player, groupId, childId, handled: false }; for (const fn of hooks.interfaceClicks) fn(event); return event; };
  return { api, core, hooks, player, attrs, persistentKeys, saveState, restoreState, relog, inventory, varbits, messages, xp, levels, sailing, location, emit, action, line, variant, tickOnce, answerPrompt, clickObject, clickInterface, interfaces, scripts, cameras, hints, get lastLineSpeakerId() { return lastLineSpeakerId; }, get closedInterfaces() { return closedInterfaces; }, prompt: () => lastPrompt, setLocation(value) { location = value; } };
}

function clickAction(h, objectId, name, actions, optionIndex) {
  const event = { player: h.player, objectId, clickType: optionIndex + 1,
    definition: { getName: () => name, getInteractions: () => actions }, handled: false };
  for (const fn of h.hooks.objects) fn(event);
  return event;
}

function load(harness, file) {
  require(path.join(__dirname, '..', 'plugins', 'quests', 'quests', file))(harness.api);
  return runtime.getRegisteredQuests().find((quest) => file.startsWith(quest.name.replace(/\s/g, '')) || file.toLowerCase().startsWith(quest.key.split('_').map((w) => w[0]).join(''))) ?? runtime.getRegisteredQuests().at(-1);
}

test('Pandemonium uses the captured varbit stages and the real raft cargo route', () => {
  const h = setup();
  require('../plugins/skills/sailing/porttasks/Common.PortTasks').init(h.api);
  const quest = load(h, 'Pandemonium.Quest.js');
  assert.equal(quest.startedValue, 2);
  assert.equal(quest.completionValue, 50);
  h.emit('npc-dialogue:hook', { npcId: h.core.NpcIdentifiers.WILL, hook: 'quest:pandemonium:start' });
  assert.equal(quest.getStage(h.player), 2);
  h.line(h.core.NpcIdentifiers.WILL, "Just let us know when you're ready, and we'll hop aboard!");
  assert.equal(quest.getStage(h.player), 4);
  h.action(h.core.NpcIdentifiers.WILL, 'BDfVg8');
  assert.equal(quest.getStage(h.player), 6);
  h.tickOnce(); h.tickOnce();
  assert.ok(h.cameras.some((camera) => camera[0] === 'move' && camera[3] === 550), 'tutorial ship camera');
  h.hooks.named.get('Will')['Talk-to']({ player: h.player, npcId: h.core.NpcIdentifiers.WILL, definition: { getName: () => 'Will' } });
  assert.equal(quest.getStage(h.player), 8);
  h.line(h.core.NpcIdentifiers.WILL, 'A line', { speaker: 'Will' });
  assert.equal(h.lastLineSpeakerId, 14958, 'boat Will chathead');
  h.emit('npc-dialogue:choice', { npcId: h.core.NpcIdentifiers.WILL, option: "Okay, I'll get to it." });
  assert.equal(quest.getStage(h.player), 10);
  const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
  const boat = BoatManager.all().find((entry) => entry.ownerPlayerId === 1);
  const helm = BoatManager.getSpec(boat).locs.find((loc) => loc.part === 'helm');
  assert.equal(clickAction(h, helm.id, 'Helm', ['Navigate', 'Escape'], 0).handled, true);
  assert.equal(quest.getStage(h.player), 10, 'helm alone waits for sails');
  const sailActions = h.core.CacheDefinitions.getObject(29506).actions;
  assert.equal(sailActions[1], 'Set', 'cache Sails Set is option 2');
  assert.equal(clickAction(h, 29506, 'Sails', sailActions, 1).handled, true);
  assert.equal(quest.getStage(h.player), 10, 'sails start the voyage');
  boat.fineX = 3032 * 128 + 64;
  boat.fineY = 3050 * 128;
  BoatManager.tick();
  assert.equal(quest.getStage(h.player), 12, 'the ship arrives at the captured wreck point');
  h.hooks.named.get('Will')['Talk-to']({ player: h.player, npcId: h.core.NpcIdentifiers.WILL, definition: { getName: () => 'Will' } });
  assert.equal(quest.getStage(h.player), 14);
  h.action(h.core.NpcIdentifiers.WILL, 'p40qKY');
  assert.equal(quest.getStage(h.player), 16);
  h.action(h.core.NpcIdentifiers.WILL, 'hQBGdU');
  assert.equal(BoatManager.all().some((entry) => entry.ownerPlayerId === 1), false, 'the tutorial ship and crew are cleaned up');
  h.line(h.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, 'You should speak to Ribs.');
  assert.equal(quest.getStage(h.player), 18);
  h.emit('npc-dialogue:choice', { npcId: h.core.NpcIdentifiers.RIBS, option: 'No, tell me about him.' });
  assert.equal(quest.getStage(h.player), 20);
  h.line(h.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, 'You should speak with Junior Jim.');
  assert.equal(quest.getStage(h.player), 22);
  h.emit('npc-dialogue:choice', { npcId: h.core.NpcIdentifiers.JUNIOR_JIM_2, option: 'I think I might have lost a cup here.' });
  h.inventory.set(h.core.ItemIdentifiers.OLD_CUP, 1);
  h.action(h.core.NpcIdentifiers.JUNIOR_JIM_2, 'jkS3Ej');
  assert.equal(quest.getStage(h.player), 28);
  assert.equal(h.sailing.boats.length, 1, 'Jim grants the raft');
  assert.equal(h.sailing.boats[0].type, 'raft');
  assert.deepEqual(h.sailing.boats[0].facilities, [0], 'the quest raft starts without the default cargo hold');
  h.action(h.core.NpcIdentifiers.JUNIOR_JIM_2, '7jgwOg');
  assert.equal(quest.getStage(h.player), 32);
  h.action(h.core.NpcIdentifiers.JUNIOR_JIM_2, 'g4CUrq');
  assert.equal(quest.getStage(h.player), 34);
  assert.equal(require('../plugins/skills/sailing/porttasks/Common.PortTasks').slots(h.player)[0].id, 599);
  h.line(h.core.NpcIdentifiers.JUNIOR_JIM_2, 'Now, unless you fancy a cheeky dip, the gangplank down the docks will be your best bet for getting on board.').after?.();
  assert.equal(h.attrs.get('pandemonium:tutorials') & 1, 1, 'docking-point tutorial shown');
  h.emit('sailing:boarded', {});
  assert.equal(quest.getStage(h.player), 36);
  h.emit('sailing:left', { reason: 'disembark' });
  assert.equal(quest.getStage(h.player), 38);
  h.emit('sailing:boarded', {});
  assert.equal(quest.getStage(h.player), 40);
  h.emit('sailing:left', { reason: 'disembark' });
  assert.equal(quest.getStage(h.player), 42);
  const PortTasks = require('../plugins/skills/sailing/porttasks/Common.PortTasks');
  PortTasks.setSlots(h.player, [null, null, null, null, null]);
  h.hooks.objects[0]({ player: h.player, objectId: h.core.ObjectIdentifiers.LEDGER_TABLE_3, clickType: 1 });
  h.tickOnce();
  assert.equal(quest.getStage(h.player), 44);
  h.line(h.core.NpcIdentifiers.JUNIOR_JIM_2, "Don't mention it, mate.").after?.();
  assert.equal(quest.getStage(h.player), 46);
  assert.equal(h.attrs.get('pandemonium:tutorials') & 6, 6, 'port-task and log tutorials shown');
  h.action(h.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, 'C5l2Ww');
  assert.equal(quest.getStage(h.player), 48);
  h.line(h.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, 'Old Grog speaks.', { speaker: 'Old Grog' });
  assert.equal(h.lastLineSpeakerId, 14976, 'Old Grog chathead');
  h.action(h.core.NpcIdentifiers.SQUAWKING_STEVE_BEANIE, 'SJ3WVd');
  assert.equal(quest.getStage(h.player), 50);
  assert.equal(quest.isComplete(h.player), true);
});

test('Crab Quest uses 5/25/30/45/47/50/55/60/63 and hands in all seven shells', () => {
  const h = setup();
  const quest = load(h, 'CrabQuest.Quest.js');
  assert.equal(quest.startedValue, 5);
  assert.equal(quest.completionValue, 63);
  h.emit('npc-dialogue:hook', { npcId: h.core.NpcIdentifiers.CRAB_9, hook: 'quest:crab-quest:start' });
  assert.equal(quest.getStage(h.player), 5);
  h.line(h.core.NpcIdentifiers.CRAB_9, 'Are you learning, though? Because I am learning nothing from this.');
  assert.equal(quest.getStage(h.player), 10);
  h.line(h.core.NpcIdentifiers.CRAB_9, "Let's say I've not had a good experience in the past.");
  assert.equal(quest.getStage(h.player), 15);
  h.action(h.core.NpcIdentifiers.CRAB_9, 'Rp9LU6');
  assert.equal(quest.getStage(h.player), 20);
  h.line(h.core.NpcIdentifiers.CRAB_9, 'See ya!');
  assert.equal(quest.getStage(h.player), 25);

  for (const id of [34575, 34576, 34577, 34578, 34579, 34580, 34581]) h.inventory.set(id, 1);
  const definition = { getActions: () => ['Talk-to'], getName: () => 'Crab' };
  h.hooks.npcs[0]({ player: h.player, npcId: h.core.NpcIdentifiers.CRAB_9, clickType: 1, definition });
  assert.equal(quest.getStage(h.player), 30);
  for (const id of [34575, 34576, 34577, 34578, 34579, 34580, 34581]) assert.equal(h.inventory.get(id), 0);

  h.inventory.set(34575, 1);
  h.hooks.npcs[0]({ player: h.player, npcId: h.core.NpcIdentifiers.CRAB_9, clickType: 1, definition });
  assert.equal(h.inventory.get(34575), 1, 'shells after the seven do not count or vanish');
  h.inventory.set(34575, 0);
  h.hooks.npcs[0]({ player: h.player, npcId: h.core.NpcIdentifiers.CRAB_9, clickType: 1, definition });
  assert.equal(quest.getStage(h.player), 30, 'a lost instrument can be recovered through the hand-in conversation');
  h.inventory.set(34587, 1);
  h.hooks.npcs[0]({ player: h.player, npcId: h.core.NpcIdentifiers.CRAB_9, clickType: 1, definition });
  assert.equal(quest.getStage(h.player), 30);
  h.action(h.core.NpcIdentifiers.CRAB_9, 'YAKnYw');
  assert.equal(quest.getStage(h.player), 45);
  h.action(h.core.NpcIdentifiers.CRAB_9, 'zUZGcG');
  assert.equal(quest.getStage(h.player), 47);
  h.hooks.objects[0]({
    player: h.player,
    objectId: 62472,
    clickType: 1,
    location: new h.core.Location(3044, 2653, 0),
    definition: { getActions: () => ['Investigate'] },
  });
  assert.equal(h.attrs.get('crab-quest:shy-progress'), 1, 'canonical palm investigation reveals the shy crab');
  assert.equal(h.varbits.get(15865), 0, 'finding the shy crab alone is not native 15865 progress');
  h.hooks.npcs[0]({ player: h.player, npcId: 16483, clickType: 1, definition: { getActions: () => ['Talk-to'], getName: () => 'Crab' } });
  assert.equal(h.attrs.get('crab-quest:shy-progress'), 1, 'talking alone does not complete the shy branch');

  const joins = ['5WiO-g', 'OrHsAs', 'uxsvrh', 'XBEBvy', 'XffNTB', 'MVf-5E', 'yUuVKM', 'nJXHcW', 'ByoUzK', 'UtfH3c', 'beb_BL'];
  for (const stepId of joins) h.action(h.core.NpcIdentifiers.CRAB_9, stepId);
  assert.equal(quest.getStage(h.player), 50);
  h.action(h.core.NpcIdentifiers.CRAB_9, 'uZozUI');
  assert.equal(quest.getStage(h.player), 55);
  h.tickOnce(); h.tickOnce();
  assert.ok(h.cameras.some((camera) => camera[0] === 'move' && camera[1] === 3071 && camera[2] === 2637), 'dance camera');
  h.action(h.core.NpcIdentifiers.CRAB_9, 'UOa-Sd');
  assert.equal(quest.getStage(h.player), 60);
  h.action(h.core.NpcIdentifiers.CRAB_9, 'twF4TG');
  assert.ok(h.cameras.some((camera) => camera[0] === 'arc' && camera[1] === 3051 && camera[6] === 360), 'final dance arc');
  h.action(h.core.NpcIdentifiers.CRAB_9, 'Wk9imR');
  assert.equal(quest.getStage(h.player), 63);
  assert.equal(quest.isComplete(h.player), true);
});

test('Crab logout ends an active dance scene and resets the camera', () => {
  const h = setup();
  const quest = load(h, 'CrabQuest.Quest.js');
  quest.setStage(h.player, 60);
  h.hooks.npcs[0]({ player: h.player, npcId: h.core.NpcIdentifiers.CRAB_9, clickType: 1,
    definition: { getActions: () => ['Talk-to'], getName: () => 'Crab' } });
  h.tickOnce(); h.tickOnce();
  assert.ok(h.cameras.some((camera) => camera[0] === 'arc'), 'ceremony camera is running');
  const before = h.cameras.filter((camera) => camera[0] === 'reset').length;
  for (const fn of h.hooks.logout) fn({ player: h.player });
  assert.ok(h.cameras.filter((camera) => camera[0] === 'reset').length > before,
    'logout resets the cutscene camera');
});

test('Fallen From Grace enforces requirements and follows its live stage ladder', () => {
  const h = setup();
  const pandemonium = load(h, 'Pandemonium.Quest.js');
  pandemonium.setStage(h.player, 50);
  h.levels.set(h.core.Skill.SAILING, 61);
  const quest = load(h, 'FallenFromGrace.Quest.js');
  for (const fn of h.hooks.login) fn({ player: h.player }); // establish the migration marker
  h.emit('npc-dialogue:hook', { npcId: h.core.NpcIdentifiers.CORMAC, hook: 'quest:fallen-from-grace:start' });
  assert.equal(quest.getStage(h.player), 0, 'below the Sailing requirement the quest refuses');
  assert.match(h.messages.at(-1), /62 Sailing/);
  for (const [skill, level] of [[h.core.Skill.SAILING, 62], [h.core.Skill.CRAFTING, 60], [h.core.Skill.RUNECRAFTING, 47], [h.core.Skill.MINING, 53]]) h.levels.set(skill, level);
  h.emit('npc-dialogue:hook', { npcId: h.core.NpcIdentifiers.CORMAC, hook: 'quest:fallen-from-grace:start' });
  assert.equal(quest.getStage(h.player), 2);
  assert.equal(h.variant(h.core.NpcIdentifiers.MURIEL), 'following-the-trail-talking-to-muriel');
  assert.equal(quest.getStage(h.player), 3);
  h.action(h.core.NpcIdentifiers.CORMAC, '3Vr-5r');
  assert.equal(quest.getStage(h.player), 5);
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.SCRAWLED_NOTEBOOK), 1);
  const hat = h.hooks.groundClick.find((entry) => entry.ids.includes(h.core.ItemIdentifiers.LARGE_HAT));
  hat.fn({ player: h.player, groundItemId: h.core.ItemIdentifiers.LARGE_HAT, handled: false });
  assert.equal(quest.getStage(h.player), 6);
  assert.equal(h.variant(h.core.NpcIdentifiers.CORMAC), 'the-way-under-ardeaglais-talking-to-cormac');
  assert.equal(quest.getStage(h.player), 8);
  h.clickObject(62217);
  assert.equal(quest.getStage(h.player), 8, 'no boat cannot sail into the cavern');
  assert.match(h.messages.at(-1), /raft or skiff/);
  const { Sailing } = require('../dist/game/content/sailing/Sailing');
  Sailing.giveBoat(h.player, 'skiff', 'wyrmscraig');
  assert.equal(Sailing.board(h.player, 'wyrmscraig'), null);
  h.clickObject(62217);
  assert.equal(quest.getStage(h.player), 9);
  h.setLocation(new h.core.Location(2580, 8600, 0));
  const troll = { getId: () => h.core.NpcIdentifiers.MOUNTAIN_TROLL, getContentId: () => h.core.NpcIdentifiers.MOUNTAIN_TROLL, getLocation: () => new h.core.Location(2580, 8600, 0) };
  for (let i = 0; i < 3; i++) h.hooks.deaths[0]({ npc: troll, killer: h.player });
  assert.equal(quest.getStage(h.player), 11);
  h.action(h.core.NpcIdentifiers.MORTIMER, 'cTymol');
  assert.equal(quest.getStage(h.player), 13);
  h.emit('npc-dialogue:condition', { npcId: h.core.NpcIdentifiers.CORMAC, stepId: 'Y9SeJ2' });
  assert.equal(quest.getStage(h.player), 14);
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.DULL_SUNSTONE_CORE), 1);
  h.inventory.set(h.core.ItemIdentifiers.SUNSTONE_CORE, 1);
  h.hooks.itemOnNpc[0]({ player: h.player, itemId: h.core.ItemIdentifiers.SUNSTONE_CORE, npcId: h.core.NpcIdentifiers.BROKEN_GOLEM });
  assert.equal(quest.getStage(h.player), 15);
  h.clickObject(h.core.ObjectIdentifiers.CHEST_317);
  assert.equal(h.interfaces.at(-1), 810, 'the captured directional chest lock opens');
  assert.ok(h.player.amountAction, 'directional confirm countdialog is armed');
  // A stale success after leaving the golem-powered phase must not set the flag.
  quest.setStage(h.player, 14);
  h.player.amountAction.execute(1734);
  quest.setStage(h.player, 15);
  assert.equal(h.attrs.get('quest.fallen_from_grace.flags') & (1 << 5) ?? 0, 0, 'stale phase success is inert');
  h.clickObject(h.core.ObjectIdentifiers.CHEST_317);
  assert.equal(h.player.amountAction !== null, true, 'chest reopens after stale success');
  h.player.amountAction.execute(0);
  assert.ok(h.messages.includes("That doesn't seem to work."));
  h.clickObject(h.core.ObjectIdentifiers.CHEST_317);
  h.player.amountAction.execute(1734);
  assert.equal(h.attrs.get('quest.fallen_from_grace.flags') & (1 << 5), 1 << 5, 'captured directional code unlocks once');
  assert.ok(h.messages.includes('You successfully pick the lock.'));
  h.inventory.set(h.core.ItemIdentifiers.STAIRCASE_KEY, 1);
  h.emit('ladders:climb', { objectId: h.core.ObjectIdentifiers.STAIRCASE_273 });
  assert.equal(quest.getStage(h.player), 16);
  h.hooks.deaths[0]({ npc: { __madAngel: { player: h.player } }, killer: h.player });
  assert.equal(quest.getStage(h.player), 18);
  h.clickObject(62368);
  assert.equal(h.interfaces.at(-1), 811, 'the post-angel door opens the captured 5-pin lock');
  assert.equal(h.scripts.at(-1).id, 6994);
  assert.equal(h.scripts.at(-1).args.slice(6).join(','), '5,0,0,0');
  h.player.amountAction.execute(7152);
  assert.match(h.messages.at(-1), /successfully pick the lock/);
  assert.equal(h.attrs.get('quest.fallen_from_grace.flags') & (1 << 7), 1 << 7);
  h.relog(h.saveState());
  assert.equal(quest.getStage(h.player), 18, 'the post-angel door state survives relog');
  assert.equal(h.attrs.get('quest.fallen_from_grace.flags') & ((1 << 5) | (1 << 7)), (1 << 5) | (1 << 7));
  h.action(h.core.NpcIdentifiers.CORMAC, 'r_JYqP');
  assert.equal(quest.getStage(h.player), 19);
  h.action(h.core.NpcIdentifiers.CORMAC, 'gYcOjH');
  assert.equal(quest.getStage(h.player), 20);
  assert.equal(quest.isComplete(h.player), true);
});

test('legacy stage saves migrate once without re-granting completion', () => {
  const h = setup();
  const pandemonium = load(h, 'Pandemonium.Quest.js');
  const crab = load(h, 'CrabQuest.Quest.js');
  const ffg = load(h, 'FallenFromGrace.Quest.js');
  pandemonium.setStage(h.player, 13);
  crab.setStage(h.player, 8);
  ffg.setStage(h.player, 17);
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(pandemonium.getStage(h.player), 32, 'old log-received stage maps to the live log stage');
  assert.equal(crab.getStage(h.player), 63, 'an old completed Crab save stays complete');
  assert.equal(ffg.getStage(h.player), 18, 'old angel-dead stage maps to the live angel-dead stage');
  assert.equal(crab.isComplete(h.player), true);
  // A second login must not remap live values that happen to be in the old range.
  pandemonium.setStage(h.player, 2);
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(pandemonium.getStage(h.player), 2);
});

test('sailing-intro native stages survive a real save/load retaining only persistent keys', () => {
  const h = setup();
  const pandemonium = load(h, 'Pandemonium.Quest.js');
  const crab = load(h, 'CrabQuest.Quest.js');
  const ffg = load(h, 'FallenFromGrace.Quest.js');
  for (const fn of h.hooks.login) fn({ player: h.player }); // establish the one-time migration markers

  const stages = [
    [pandemonium, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50]],
    [crab, [0, 5, 10, 15, 20, 25, 30, 35, 37, 40, 45, 47, 50, 55, 60, 63]],
    [ffg, [0, 2, 3, 4, 5, 6, 8, 9, 11, 13, 14, 15, 16, 18, 19, 20]],
  ];
  for (const [quest, values] of stages) {
    for (const stage of values) {
      quest.setStage(h.player, stage);
      const saved = h.saveState(); // only api.persistAttribute keys survive a real save
      h.relog(saved);
      assert.equal(quest.getStage(h.player), stage,
        `${quest.key} native stage ${stage} must survive save/load`);
      for (const fn of h.hooks.logout) fn({ player: h.player });
    }
  }

  h.attrs.set('pandemonium:tutorials', 7);
  h.attrs.set('quest.fallen_from_grace.troll-kills', 2);
  h.relog(h.saveState());
  assert.equal(h.attrs.get('pandemonium:tutorials'), 7, 'tutorial flags persist across save/load');
  assert.equal(h.attrs.get('quest.fallen_from_grace.troll-kills'), 2, 'troll kills persist across save/load');
});

test('sailing-intro legacy stages migrate once and never re-grant rewards', () => {
  const h = setup();
  const pandemonium = load(h, 'Pandemonium.Quest.js');
  const crab = load(h, 'CrabQuest.Quest.js');
  const ffg = load(h, 'FallenFromGrace.Quest.js');
  pandemonium.setStage(h.player, 13);
  crab.setStage(h.player, 8);
  ffg.setStage(h.player, 17);
  for (const fn of h.hooks.login) fn({ player: h.player });
  assert.equal(pandemonium.getStage(h.player), 32);
  assert.equal(crab.getStage(h.player), 63);
  assert.equal(ffg.getStage(h.player), 18);
  assert.equal(h.xp.length, 0, 'migration never grants quest XP');

  const saved = h.saveState();
  h.relog(saved);
  assert.equal(pandemonium.getStage(h.player), 32);
  assert.equal(crab.getStage(h.player), 63);
  assert.equal(ffg.getStage(h.player), 18);
  assert.equal(h.xp.length, 0, 'the migrated complete save is not rewarded again');
  assert.equal(crab.complete(h.player), false, 'a completed legacy save is not completed twice');
});

test('Pandemonium uses the actual static-ship blueprint and its lifecycle hooks', () => {
  const h = setup();
  const StaticShips = require('../plugins/skills/sailing/StaticShips.Sailing');
  const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
  for (const stale of StaticShips.all()) StaticShips.dispose(stale);
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init();
  for (const [x, y] of [[3054, 3193], [3054, 3120], [3051, 3110], [3048, 3070], [3032, 3050]]) {
    RegionManager.loadMapFiles(x, y, true);
  }
  const definition = StaticShips.definitions.get('pandemonium_tutorial_ship');
  assert.ok(definition, 'shared data supplies the tutorial ship');
  assert.deepEqual(definition.walkableTiles, [[3, 2], [3, 3], [3, 4]]);
  assert.equal(definition.deckLocs.find((loc) => loc.part === 'helm').id, 59554);
  const quest = load(h, 'Pandemonium.Quest.js');
  h.action(h.core.NpcIdentifiers.WILL, 'BDfVg8');
  assert.equal(StaticShips.all().length, 1, 'one owner-only static ship');
  const ship = StaticShips.all()[0];
  assert.equal(ship.boat.ownerOnly, true);
  assert.equal(ship.boat.ownerPlayerId, 1);
  assert.equal(`${ship.boat.tileX},${ship.boat.tileY}`, '3054,3193', 'captured start root');
  assert.equal(BoatManager.getBoatAboard(h.player), ship.boat, 'the player boards the real deck');
  assert.ok(BoatManager.getSpec(ship.boat).locs.some((loc) => loc.id === 59554), 'real helm loc on deck');
  assert.ok(StaticShips.get(ship.boat.entityIndex), 'the shared registry owns it');
  quest.setStage(h.player, 10);
  const sail = BoatManager.getSpec(ship.boat).locs.find((loc) => loc.part === 'sails');
  const sailActions = h.core.CacheDefinitions.getObject(29506).actions;
  assert.equal(clickAction(h, 29506, 'Sails', sailActions, 0).handled, false, 'the Trim option is not the tutorial raise-sails action');
  assert.equal(ship.boat.moveMode, 0);
  clickAction(h, 29506, 'Sails', sailActions, 1);
  assert.equal(quest.getStage(h.player), 10, 'sails alone do not reach the wreck');
  assert.equal(ship.boat.moveMode, 0, 'the ship does not move before the helm');
  clickAction(h, 59554, 'Helm', ['Navigate', 'Escape'], 0);
  assert.equal(quest.getStage(h.player), 10, 'helm alone does not reach the wreck');
  clickAction(h, 29506, 'Sails', sailActions, 1);
  assert.equal(quest.getStage(h.player), 10, 'raising sails starts the voyage, not arrival');
  assert.equal(ship.boat.moveMode, 1, 'the captured voyage runs at half sail');
  const startY = ship.boat.fineY;
  for (let tick = 0; tick < 300 && quest.getStage(h.player) < 12; tick++) BoatManager.tick();
  assert.notEqual(ship.boat.fineY, startY, 'the static ship actually moves on the real map');
  assert.equal(quest.getStage(h.player), 12, `the real collision route reaches the captured wreck (boat ${ship.boat.tileX},${ship.boat.tileY})`);
  assert.ok(Math.abs(ship.boat.tileX - 3032) <= 2 && Math.abs(ship.boat.tileY - 3050) <= 2,
    'the boat stops at the captured wreck root');
  assert.equal(h.varbits.get(18315), 1, 'reached-wreck varbit set on arrival');
  assert.ok(BoatManager.getSpec(ship.boat).locs.some((loc) => loc.id === 60482), 'real placed salvaging hook on the deck');
  assert.ok(BoatManager.getSpec(ship.boat).locs.some((loc) => loc.id === 60464), 'wreck loc present');
  const firstIndex = ship.boat.entityIndex;
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(StaticShips.all().length, 1, 'relog replaces the tutorial ship');
  assert.notEqual(StaticShips.all()[0], ship, 'a new ship object replaces the old one');
  h.action(h.core.NpcIdentifiers.WILL, 'hQBGdU');
  assert.equal(StaticShips.all().length, 0, 'push-overboard disposes the quest ship');
  h.action(h.core.NpcIdentifiers.WILL, 'BDfVg8');
  assert.equal(StaticShips.all().length, 1, 'boarding again after cleanup');
  assert.equal(StaticShips.all()[0].boat.ownerOnly, true);
  h.action(h.core.NpcIdentifiers.WILL, 'hQBGdU');
  assert.equal(StaticShips.all().length, 0);
  assert.equal(quest.getStage(h.player) >= 2, true);
});

test('Pandemonium spawns the captured crew on the static deck at interactable coordinates', () => {
  const h = setup();
  const StaticShips = require('../plugins/skills/sailing/StaticShips.Sailing');
  const calls = [];
  const original = StaticShips.addDeckNpc;
  StaticShips.addDeckNpc = (ship, npcId, x, y, owner) => {
    calls.push({ npcId, x, y });
    return original(ship, npcId, x, y, owner);
  };
  try {
    load(h, 'Pandemonium.Quest.js');
    h.action(h.core.NpcIdentifiers.WILL, 'BDfVg8');
    const ship = StaticShips.all()[0];
    assert.ok(ship, 'static tutorial ship spawned');
    const will = calls.find((call) => call.npcId === 14958);
    const anne = calls.find((call) => call.npcId === 14963);
    assert.ok(will && anne, 'the deck crew spawns the canonical boat parents 14958/14963');
    assert.equal(calls.some((call) => call.npcId === 14959 || call.npcId === 14964), false,
      'the deck does not spawn the dialogue children directly');
    assert.deepEqual([will.x, will.y], [3, 2], 'Will uses the captured placeholder deck tile');
    assert.deepEqual([anne.x, anne.y], [4, 3], 'Anne uses the captured deck tile beside the helm');
    const boarding = ship.spec.boardingTile;
    for (const call of [will, anne]) {
      const distance = Math.max(Math.abs(call.x - boarding.x), Math.abs(call.y - boarding.y));
      assert.ok(distance <= 8, `${call.npcId} is within the live NPC interaction range`);
      const root = StaticShips.deckLocation(ship, call.x, call.y);
      assert.ok(root.getX() >= ship.boat.deckBaseX && root.getX() < ship.boat.deckBaseX + 104, 'crew root x in deck scene');
      assert.ok(root.getY() >= ship.boat.deckBaseY && root.getY() < ship.boat.deckBaseY + 104, 'crew root y in deck scene');
    }
  } finally {
    StaticShips.addDeckNpc = original;
    for (const ship of StaticShips.all()) StaticShips.dispose(ship);
  }
});

test('Pandemonium owner spawns canonical parents and keeps the cache dialogue children', () => {
  const h = setup();
  const spawned = [];
  const originalSpawn = h.api.spawnNpc;
  h.api.spawnNpc = (definition) => { spawned.push(definition); return originalSpawn(definition); };
  try {
    load(h, 'Pandemonium.Quest.js');
    for (const login of h.hooks.login) login({ player: h.player });
    h.tickOnce();
    assert.ok(spawned.some((entry) => entry.id === 14970), 'Ribs spawns the canonical parent 14970');
    assert.ok(spawned.some((entry) => entry.id === 14967), 'Steve spawns the canonical parent 14967');
    assert.equal(spawned.some((entry) => entry.id === 14971 || entry.id === 14968 || entry.id === 14969), false,
      'Ribs/Steve children are not spawned directly');
    const vars = { getVarbit: () => 0, getVarp: () => 0 };
    const resolve = (id) => h.core.CacheDefinitions.resolveNpc(id, vars)?.id;
    assert.equal(resolve(14957), 14959, 'dock Will base resolves to the Will dialogue child');
    assert.equal(resolve(14958), 14959, 'boat Will base resolves to the Will dialogue child');
    assert.equal(resolve(14962), 14964, 'dock Anne base resolves to the Anne dialogue child');
    assert.equal(resolve(14963), 14964, 'boat Anne base resolves to the Anne dialogue child');
    assert.equal(resolve(14967), 14968, 'Steve base resolves to the one-op dialogue child');
    assert.equal(resolve(14970), 14971, 'Ribs base resolves to the Ribs dialogue child');
    assert.equal(resolve(14972), 14974, 'Jim base resolves to the Junior Jim dialogue child');
  } finally {
    h.api.spawnNpc = originalSpawn;
  }
});

test('Pandemonium salvage uses the real placed hook 60482, grants once and persists', () => {
  const h = setup();
  const quest = load(h, 'Pandemonium.Quest.js');
  h.attrs.set('pandemonium:stage-version', 2);
  quest.setStage(h.player, 14);
  const click = (objectId) => {
    const event = { player: h.player, objectId, clickType: 1, definition: { getName: () => 'Salvaging hook', getInteractions: () => ['Deploy'], }, handled: false };
    for (const fn of h.hooks.objects) fn(event);
    return event;
  };
  assert.equal(click(60480).handled, false, 'the unnamed 60480 twin is not the placed hook');
  assert.equal(click(60482).handled, true, 'the real placed Salvaging hook is claimed');
  h.action(h.core.NpcIdentifiers.WILL, 'p40qKY');
  assert.equal(quest.getStage(h.player), 16);
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.OLD_CUP), 1);
  h.action(h.core.NpcIdentifiers.WILL, 'p40qKY');
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.OLD_CUP), 1, 'the cup is granted once');
  const saved = h.saveState();
  h.relog(saved);
  assert.equal(quest.getStage(h.player), 16, 'the salvaged stage survives relog');
});

test('Pandemonium relog restores stages 12/14 at the earned wreck, docked and armed once', () => {
  const h = setup();
  const StaticShips = require('../plugins/skills/sailing/StaticShips.Sailing');
  const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
  for (const stale of StaticShips.all()) StaticShips.dispose(stale);
  const quest = load(h, 'Pandemonium.Quest.js');
  h.attrs.set('pandemonium:stage-version', 2);
  quest.setStage(h.player, 12);
  for (const login of h.hooks.login) login({ player: h.player });
  let ship = StaticShips.all()[0];
  assert.ok(ship, 'stage 12 login restores the actual static ship');
  assert.equal(ship.boat.tileX, 3032);
  assert.equal(ship.boat.tileY, 3050);
  assert.equal(BoatManager.getBoatAboard(h.player), ship.boat, 'the player is restored on the deck');
  assert.equal(ship.boat.moveMode, 0, 'the voyage is stopped at the wreck');
  const spec = BoatManager.getSpec(ship.boat);
  assert.equal(spec.locs.filter((loc) => loc.id === 60482).length, 1, 'the placed hook is not duplicated');
  assert.equal(spec.locs.filter((loc) => loc.id === 60464).length, 1, 'the wreck is not duplicated');
  // Stage 12 still has to talk to Will before the hook becomes a salvage action.
  h.hooks.named.get('Will')['Talk-to']({ player: h.player, npcId: h.core.NpcIdentifiers.WILL, definition: { getName: () => 'Will' } });
  assert.equal(quest.getStage(h.player), 14);
  h.clickObject(60482);
  h.action(h.core.NpcIdentifiers.WILL, 'p40qKY');
  assert.equal(quest.getStage(h.player), 16);
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.OLD_CUP), 1);
  h.action(h.core.NpcIdentifiers.WILL, 'p40qKY');
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.OLD_CUP), 1, 'retry cannot duplicate the cup');

  // Logout at stage 14 and relog: restore at the earned wreck, still one hook, cup still once.
  quest.setStage(h.player, 14);
  h.attrs.set('pandemonium:tutorial-helm', true);
  h.attrs.set('pandemonium:tutorial-sails', true);
  for (const logout of h.hooks.logout) logout({ player: h.player });
  assert.equal(StaticShips.all().length, 0, 'logout disposes the temporary ship');
  for (const login of h.hooks.login) login({ player: h.player });
  ship = StaticShips.all()[0];
  assert.ok(ship, 'stage 14 relog rebuilds the actual static ship');
  assert.equal(ship.boat.tileX, 3032);
  assert.equal(ship.boat.tileY, 3050);
  assert.equal(BoatManager.getBoatAboard(h.player), ship.boat);
  assert.equal(BoatManager.getSpec(ship.boat).locs.filter((loc) => loc.id === 60482).length, 1);
  h.clickObject(60482);
  h.action(h.core.NpcIdentifiers.WILL, 'p40qKY');
  assert.equal(quest.getStage(h.player), 16);
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.OLD_CUP), 1);
  h.action(h.core.NpcIdentifiers.WILL, 'p40qKY');
  assert.equal(h.inventory.get(h.core.ItemIdentifiers.OLD_CUP), 1);
  for (const stale of StaticShips.all()) StaticShips.dispose(stale);
});

test('Pandemonium deck hook routes Deploy from the player pose instead of the all-edge mask', () => {
  const h = setup();
  const StaticShips = require('../plugins/skills/sailing/StaticShips.Sailing');
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  const { Location } = require('../dist/game/model/Location');
  const quest = load(h, 'Pandemonium.Quest.js');
  h.action(h.core.NpcIdentifiers.WILL, 'BDfVg8');
  const ship = StaticShips.all()[0];
  h.player.moveTo(new Location(ship.boat.deckBaseX + 3, ship.boat.deckBaseY + 3, 0));
  const object = { getLocation: () => new Location(ship.boat.deckBaseX + 2, ship.boat.deckBaseY + 3, 0) };
  const event = { player: h.player, objectId: 60482, object, blockAccessFlags: 15 };
  for (const fn of h.hooks.routes) fn(event);
  assert.deepEqual(event.destination, {
    x: ship.boat.deckBaseX + 3, y: ship.boat.deckBaseY + 3, z: 0,
  }, 'the normal route targets the deck tile the player stands on');
  const other = { player: h.player, objectId: 60464, object, blockAccessFlags: 15 };
  for (const fn of h.hooks.routes) fn(other);
  assert.equal(other.destination, undefined, 'other deck locs keep their normal route');

  // The engine's destination contract executes the normal object action from that tile;
  // no cache mask/definition is mutated.
  const player = {
    isPlayer: () => true, isNpc: () => false, getAsPlayer() { return this; },
    getLocation: () => new Location(event.destination.x, event.destination.y, 0),
    getPrivateArea: () => ship.deck, getSize: () => 1,
  };
  const queue = new MovementQueue(player);
  let dispatched = 0;
  queue.walkToTile(new Location(event.destination.x, event.destination.y, 0), () => { dispatched++; });
  assert.equal(dispatched, 1, 'MovementQueue dispatches the action from the override destination');
  for (const stale of StaticShips.all()) StaticShips.dispose(stale);
});

test('stage 28 shipyard UI build consumes materials and advances once through the shipped handler', () => {
  const h = setup();
  const { Sailing } = require('../dist/game/content/sailing/Sailing');
  const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
  const BoatFacilities = require('../plugins/skills/sailing/BoatFacilities.Sailing');
  const Shipyard = require('../plugins/skills/sailing/Shipyard.plugin.js');
  const raft = Sailing.giveBoat(h.player, 'raft', 'the_pandemonium');
  raft.facilities = [0];
  const hold = BoatFacilities.hotspotsOf('raft')[0].allowed.find((row) =>
    /cargo hold$/i.test(BoatFacilities.facilityRequirements(row).name));
  const materials = BoatFacilities.facilityRequirements(hold).materials;
  for (const [item, count] of materials) h.inventory.set(item, count + 3);
  const quest = load(h, 'Pandemonium.Quest.js');
  h.attrs.set('quest.pandemonium.stage-version', 2);
  quest.setStage(h.player, 28);
  assert.equal(quest.getStage(h.player), 28, 'opening/modifying without a build stays 28');

  const saved = {
    aboardVisit: Shipyard.aboardVisit, ownedBoat: Shipyard.ownedBoat,
    openCustomisation: Shipyard.openCustomisation, closeCustomisation: Shipyard.closeCustomisation,
    isBuildTrigger: Shipyard.isBuildTrigger, readOptionRow: Shipyard.readOptionRow,
    refusal: Shipyard.refusal, setDeckLoc: BoatManager.setDeckLoc,
  };
  const visit = { hotspot: 0, slot: raft.slot, shown: {} };
  Shipyard.aboardVisit = () => visit;
  Shipyard.ownedBoat = () => raft;
  Shipyard.openCustomisation = () => {};
  Shipyard.closeCustomisation = () => {};
  Shipyard.isBuildTrigger = () => true;
  Shipyard.readOptionRow = () => hold;
  Shipyard.refusal = () => null;
  BoatManager.setDeckLoc = () => {};
  const modulePath = require.resolve('../plugins/skills/sailing/ShipyardFacilities.plugin.js');
  delete require.cache[modulePath];
  const Facilities = require(modulePath);
  Facilities.register(h.api);
  const event = { player: h.player, groupId: 939, childId: 17, scriptTrigger: true, argsData: Buffer.from([0]), handled: false };
  try {
    for (const handler of h.hooks.interfaceClicks) handler(event);
    assert.equal(event.handled, true, 'the shipped shipyard build handler accepted the trigger');
    for (const [item, count] of materials) assert.equal(h.inventory.get(item), 3, `${item} materials consumed`);
    assert.equal(quest.getStage(h.player), 30, 'the real built cargo hold advances stage 28 to 30');
    for (const handler of h.hooks.interfaceClicks) handler(event);
    assert.equal(quest.getStage(h.player), 30, 'duplicate UI events keep stage 30');
  } finally {
    Shipyard.aboardVisit = saved.aboardVisit;
    Shipyard.ownedBoat = saved.ownedBoat;
    Shipyard.openCustomisation = saved.openCustomisation;
    Shipyard.closeCustomisation = saved.closeCustomisation;
    Shipyard.isBuildTrigger = saved.isBuildTrigger;
    Shipyard.readOptionRow = saved.readOptionRow;
    Shipyard.refusal = saved.refusal;
    BoatManager.setDeckLoc = saved.setDeckLoc;
    delete require.cache[modulePath];
  }
});

test('Pandemonium completion extras survive stack, full and one-slot inventories once', () => {
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { Item } = require('../dist/game/model/Item');
  const { World } = require('../dist/game/World');
  const owner = 'pandereward';
  const clearGround = () => {
    const items = World.getItems();
    for (let i = items.length - 1; i >= 0; i--) if (items[i].getOwner() === owner) items.splice(i, 1);
  };
  const ground = () => World.getItems()
    .filter((item) => item.getOwner() === owner)
    .map((item) => [item.getItem().getId(), item.getItem().getAmount()]);
  const make = (freeSlots, existingCoupons = 0) => {
    clearGround();
    const h = setup();
    h.player.getUsername = () => owner;
    const inventory = new Inventory(h.player);
    h.player.getInventory = () => inventory;
    let slot = 0;
    if (existingCoupons > 0) inventory.setItem(slot++, new Item(32083, existingCoupons));
    for (; slot < 28 - freeSlots; slot++) inventory.setItem(slot, new Item(995, 1));
    const quest = load(h, 'Pandemonium.Quest.js');
    quest.setStage(h.player, 48);
    return { h, inventory, quest };
  };
  const countGround = (id) => ground().filter(([itemId]) => itemId === id);
  const couponGround = () => countGround(32083).reduce((total, [, amount]) => total + amount, 0);

  let { h, inventory, quest } = make(0, 1);
  assert.equal(quest.complete(h.player), true);
  assert.equal(inventory.getAmount(32083), 26, 'existing stack gains all 25 coupons with no free slot');
  assert.equal(countGround(31964).length, 2, 'both repair kits drop rather than being lost');
  assert.equal(countGround(31803).length, 1, 'spyglass drops rather than being lost');
  assert.equal(quest.complete(h.player), false, 'completion reward is once');
  h.relog();
  assert.equal(quest.complete(h.player), false, 'relog completion is not rewarded again');
  assert.equal(inventory.getAmount(32083), 26);
  assert.equal(ground().length, 3);

  ({ h, inventory, quest } = make(1));
  assert.equal(quest.complete(h.player), true);
  assert.equal(inventory.getAmount(32083), 25, 'one free slot holds the coupon stack');
  assert.equal(countGround(31964).length, 2);
  assert.equal(countGround(31803).length, 1);

  ({ h, inventory, quest } = make(4));
  assert.equal(quest.complete(h.player), true);
  assert.equal(inventory.getAmount(32083), 25);
  assert.equal(inventory.getAmount(31964), 2, 'repair kits are granted one at a time');
  assert.equal(inventory.getAmount(31803), 1);
  assert.equal(ground().length, 0);

  ({ h, inventory, quest } = make(0));
  assert.equal(quest.complete(h.player), true);
  assert.ok(couponGround() >= 24, 'the quest-specific 24 coupons are not silently lost');
  assert.equal(countGround(31964).length, 2);
  assert.equal(countGround(31803).length, 1);
  clearGround();
});

test('Crab bottle recovery reports only after the collection is actually granted', () => {
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { Item } = require('../dist/game/model/Item');
  const h = setup();
  const quest = load(h, 'CrabQuest.Quest.js');
  quest.setStage(h.player, 63);
  const inventory = new Inventory(h.player);
  h.player.getInventory = () => inventory;
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new Item(995, 1));
  const before = h.messages.length;
  const event = {
    player: h.player,
    objectId: 62440,
    clickType: 1,
    location: new h.core.Location(3055, 2639, 0),
    definition: { getActions: () => ['Reminisce'], getName: () => 'Bottle' },
  };
  for (const handler of h.hooks.objects) handler(event);
  const said = h.messages.slice(before);
  assert.ok(said.some((message) => message.includes("couldn't hold")), 'engine reports the full inventory');
  assert.ok(!said.some((message) => message.includes('familiar shells')), 'recovery is not announced before it is given');
});
