// Dedicated Fallen From Grace lock contract: real cache ids, shipped dialogue pages and
// the actual object/custom-event dispatch used by the quest.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers, O = core.ObjectIdentifiers;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
});

function setup() {
  const hooks = { variants: [], conditions: [], npc: [], object: [], custom: new Map(), logins: [], logouts: [], deaths: [] };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    onObjectInteraction(fn) { hooks.object.push(fn); },
    onNpcInteraction() {}, onItemOnItem() {}, onItemOnNpc() {}, onItemAction() {},
    onGroundItemClick() {}, onGroundItemPickup() {}, onNpcDeath(fn) { hooks.deaths.push(fn); },
    onZoneEnter() {}, onPlayerLogin(fn) { hooks.logins.push(fn); }, onPlayerLogout(fn) { hooks.logouts.push(fn); },
    spawnNpc(def) { return { ...def, getId: () => def.id, isRegistered: () => true }; },
    removeNpc() {},
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/FallenFromGrace.Quest')(api);
  PluginManager.emitNpcDialogueCondition = (event) => {
    for (const fn of hooks.conditions) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  PluginManager.emitCustomEvent = (name, event) => {
    for (const fn of hooks.custom.get(name) ?? []) fn(event);
  };
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === 'fallen_from_grace').at(-1);
  const attrs = new Map(), items = new Map(), varbits = new Map(), messages = [];
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendSubInterface(uid, group, mode) { p.subInterface = { uid, group, mode }; return sender; },
    sendInterface(id) { p.interface = id; return sender; },
    sendInterfaceScript(id, args) { p.script = { id, args }; return sender; },
    sendInterfaceRemoval() { p.interfaceRemoved = (p.interfaceRemoved ?? 0) + 1; p.interface = -1; return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  const p = {
    attrs, items, varbits, messages, sender,
    getAttribute: (key) => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender, sendMessage: (text) => messages.push(text),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0, getFreeSlots: () => 28, isFull: () => false,
      adds: (id, amount = 1) => items.set(id, (items.get(id) ?? 0) + amount),
      deleteNumber: (id, amount = 1) => items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)),
    }),
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99, addExperiences() {} }),
    getLocation: () => new core.Location(2570, 8657, 0), moveTo() {},
    getDialogueManager: () => p.manager, getUsername: () => 'Parity', getIndex: () => 1,
    isPlayer: () => true, isRegistered: () => true, isPlayerBot: () => false,
    setInterfaceId(id) { p.interfaceId = id; }, getInterfaceId() { return p.interfaceId; },
    setEnteredAmountAction(action) { p.amountAction = action; }, getEnteredAmountAction() { return p.amountAction; },
    setPositionToFace() {}, performAnimation() {}, getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    getArea: () => null, setArea() {}, getPrivateArea: () => null,
  };
  p.manager = new DialogueManager(p);
  const emit = (name, event = {}) => { for (const fn of hooks.custom.get(name) ?? []) fn({ player: p, ...event }); };
  const object = (objectId) => {
    const event = { player: p, objectId, handled: false, object: null };
    for (const fn of hooks.object) fn(event);
    return event;
  };
  return { api, hooks, quest, p, emit, object };
}

test('real cache ids: the chest is 62376 and the cathedral door is 62368', () => {
  assert.equal(CacheDefinitions.getObject(62376)?.name, 'Chest');
  assert.equal(CacheDefinitions.getObject(62368)?.name, 'Cathedral door');
});

test('cathedral chest uses directional 810 [1,3,2,2] and only unlocks once', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 15);
  const first = h.object(62376);
  assert.equal(first.handled, true);
  assert.equal(p.interface, 810);
  const action = p.amountAction;
  action.execute(0);
  assert.equal(p.messages.at(-1), "That doesn't seem to work.");
  assert.equal(h.quest.getStage(p), 15);
  assert.equal((h.quest.getStage(p) >= 15 && (p.attrs.get('quest.fallen_from_grace.flags') ?? 0)), 0);

  h.object(62376);
  p.amountAction.execute(1734);
  assert.equal((p.attrs.get('quest.fallen_from_grace.flags') ?? 0) & (1 << 5), 1 << 5);
  assert.ok(p.messages.includes('You successfully pick the lock.'));
  assert.ok(p.interfaceRemoved >= 2, 'wrong and correct attempts both close the lock');

  // The shipped transcript selects its non-full message; the lock is not reopened.
  while (p.manager.getCurrent()) p.manager.advance();
  assert.ok(p.messages.some((text) => text.includes('You find a book and an old sunstone core in the chest.')));
  const interfaceBefore = p.interface;
  h.object(62376);
  assert.equal(p.interface, interfaceBefore, 'the unlocked chest does not reopen the lock');
});

test('the Mad Angel instance variant is answered from the FFG stage, not a boss-side quest check', () => {
  const h = setup(), p = h.p;
  const ask = (stage) => {
    h.quest.setStage(p, stage);
    const request = { player: p, variant: null };
    for (const fn of h.hooks.custom.get('madangel:instance-variant') ?? []) fn(request);
    return request.variant;
  };
  assert.equal(ask(16), 'quest');
  assert.equal(ask(17), 'quest');
  assert.equal(ask(18), null, 'after the kill the ordinary boss variant is used');
  assert.equal(ask(20), null, 'post-quest is not the FFG instance');
});

test('cathedral door uses the real 5-pin 811 after the angel and then releases to MadAngel', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 18);
  const request = { player: p, objectId: 62368, handled: false };
  for (const fn of h.hooks.custom.get('madangel:cathedral-door') ?? []) fn(request);
  assert.equal(request.handled, true);
  assert.equal(p.interface, 811);
  assert.equal(p.script?.id, 6994);
  assert.deepEqual(p.script?.args.slice(6), [5, 0, 0, 0]);
  p.amountAction.execute(7152);
  assert.equal((p.attrs.get('quest.fallen_from_grace.flags') ?? 0) & (1 << 7), 1 << 7);
  assert.ok(p.messages.includes('You successfully pick the lock, only to see it crumble away in your hands.'));
  const second = { player: p, objectId: 62368, handled: false };
  for (const fn of h.hooks.custom.get('madangel:cathedral-door') ?? []) fn(second);
  assert.equal(second.handled, false, 'after unlocking, the public MadAngel door handles it');
});

test('stale chest amount after interface close cannot unlock the chest', () => {
  const h = setup(), p = h.p;
  h.quest.setStage(p, 15);
  h.object(62376);
  const stale = p.amountAction;
  for (const fn of h.hooks.custom.get('interface:closed') ?? []) fn({ player: p, interfaceId: 810 });
  stale.execute(1734);
  assert.equal((p.attrs.get('quest.fallen_from_grace.flags') ?? 0) & (1 << 5), 0);
});
