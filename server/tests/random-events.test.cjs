// Run after yarn build: node --test tests/random-events.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Item } = require('../dist/game/model/Item');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { NpcIdentifiers: N } = require('../dist/util/NpcIdentifiers');
const { Skill } = require('../dist/game/model/Skill');
const { Location } = require('../dist/game/model/Location');
const Plugin = require('../plugins/npcs/RandomEvents.plugin');
const Events = require('../plugins/npcs/random-events/Common.RandomEvents');
const Teleports = require('../plugins/npcs/random-events/Teleports.RandomEvents');
const Pinball = require('../plugins/npcs/random-events/Pinball.RandomEvents');
const JekyllPlugin = require('../plugins/npcs/DrJekyll.plugin');
const Gift = require('../plugins/npcs/random-events/GiftRewards.RandomEvents');
const PlantPlugin = require('../plugins/npcs/StrangePlant.plugin');
const { Animation } = require('../dist/game/model/Animation');
const { Task } = require('../dist/game/task/Task');
const { PlayerRights } = require('../dist/game/model/rights/PlayerRights');
const { ItemOnGround, State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
const { DialogueChainBuilder } = require('../dist/game/model/dialogues/builders/DialogueChainBuilder');
const { NpcDialogue } = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
const { PlayerDialogue } = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
const { StatementDialogue } = require('../dist/game/model/dialogues/entries/impl/StatementDialogue');
const { ItemStatementDialogue } = require('../dist/game/model/dialogues/entries/impl/ItemStatementDialogue');
const { EndDialogue } = require('../dist/game/model/dialogues/entries/impl/EndDialogue');
const { ActionDialogue } = require('../dist/game/model/dialogues/entries/impl/ActionDialogue');

class FakeGameObject {
  constructor(id, location, type, face) { this.id = id; this.location = location; this.type = type;
    this.face = face; this.privateArea = null; }
  getId() { return this.id; }
  setId(id) { this.id = id; return this; }
  getLocation() { return this.location; }
  getType() { return this.type; }
  getFace() { return this.face; }
  getPrivateArea() { return this.privateArea; }
}

function harness(t, members = true) {
  let now = 1_000, random = 0.5;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Math, 'random', () => random);
  t.mock.method(Item.prototype, 'getDefinition', function () { return { isStackable: () => this.getId() === I.COINS }; });
  const hooks = {}, npcs = [], prompts = [], drops = [], objects = [], interfaces = [];
  const custom = new Map();
  let enabled = true, blocked = () => false, movable = () => true;
  const ObjectManager = {
    register(object) { objects.push(object); },
    deregister(object) { object.deregistered = true; },
    objectsAt(location) { return objects.filter(object => !object.deregistered &&
      object.getLocation().getX() === location.getX() && object.getLocation().getY() === location.getY()); },
    existsLocation(location) { return this.objectsAt(location).length > 0; },
  };
  const persistedAttributes = new Map();
  const tasks = [];
  const api = {
    core: { Item, ItemIdentifiers: I, NpcIdentifiers: N, Skill, Location, Wilderness: { isPvpArea: () => false },
      WorldDefinition: { isMembersWorld: () => members }, Animation, Task, PlayerRights,
      DialogueChainBuilder, NpcDialogue, PlayerDialogue, StatementDialogue,
      ItemStatementDialogue, EndDialogue, ActionDialogue, GameObject: FakeGameObject, ObjectManager,
      MapObjects: { get: () => null } },
    registerCommand(name, handler, rights, description) { hooks[name] = { handler, rights, description }; },
    onCustomEvent(name, cb) { custom.set(name, [...(custom.get(name) ?? []), cb]); },
    emitCustomEvent(name, event) { custom.get(name)?.forEach(cb => cb(event)); },
    getPluginConfig: () => enabled,
    persistAttribute(key, defaultValue) { persistedAttributes.set(key, defaultValue); },
    getItemOnGroundManager: () => ({ DESPAWN_DELAY: 300, registerLocation(player, item, position) {
      const drop = new ItemOnGround(State.SEEN_BY_PLAYER, player.getUsername(), position, item, true, -1, null);
      drops.push(drop); return drop;
    } }),
    getRegionManager: () => ({ blocked: (...args) => blocked(...args), canMovestart: (...args) => movable(...args) }),
    getWorld: () => ({ getNpcsNear: () => npcs }),
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
    registerCustomInterface(definition) { interfaces.push(definition); },
    spawnNpc(definition) {
      const npc = { definition, owner: definition.owner, location: new Location(definition.x, definition.y, definition.z),
        getOwner() { return this.owner; }, getId() { return definition.id; },
        getDefinition() { return { getId: () => definition.id }; }, getLocation() { return this.location; },
        setFollowing(p) { this.following = p; }, setMobileInteraction(p) { this.interaction = p; },
        forceChat(text) { this.chat = text; }, performAnimation(animation) { this.animation = animation.getId(); },
        setHitpoints(hp) { this.hitpoints = hp; }, setNpcTransformationId() {} };
      npcs.push(npc); return npc;
    },
    removeNpc(npc) { npc.removed = true; },
    sendMultiChatboxPrompt(player, title, ...pairs) {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ label: pairs[i], cb: pairs[i + 1] });
      assert.ok(options.length <= 5);
      prompts.push({ player, title, options });
    },
    onNpcInteraction(name, actions) {
      const merged = { ...(hooks[name] ?? {}) };
      for (const [action, handler] of Object.entries(actions)) {
        const before = merged[action];
        merged[action] = before
          ? event => { before(event); if (!event.handled) handler(event); }
          : handler;
      }
      hooks[name] = merged;
    },
    onNpcsInteraction(names, actions) { for (const name of names) this.onNpcInteraction(name, actions); },
    onNpcClick(npcIds, clickType, handler) { (hooks[`npcClick:${[].concat(npcIds).join(',')}`] ??= new Map()).set(clickType, handler); },
    onItemAction(name, actions) { hooks[name] = actions; },
    onItemOnObject(handler) { (hooks.itemOnObject ??= []).push(handler); },
    onItemOnNpc(handler) { (hooks.itemOnNpc ??= []).push(handler); },
    onObjectInteraction(a, b) {
      if (typeof a !== 'string') { (hooks.objectRaw ??= []).push(a); return; }
      const merged = { ...(hooks[`object:${a}`] ?? {}) };
      for (const [action, handler] of Object.entries(b)) {
        const before = merged[action];
        merged[action] = before
          ? event => { before(event); if (!event.handled) handler(event); }
          : handler;
      }
      hooks[`object:${a}`] = merged;
    },
  };
  for (const name of ['ServerStartup', 'ServerShutdown', 'PlayerLogin', 'PlayerProcess', 'PlayerLogout',
    'PlayerDisconnect', 'PlayerDeath', 'InterfaceActionClick']) api[`on${name}`] = (cb) => (hooks[name] ??= []).push(cb);
  if (members) JekyllPlugin.register(api);
  Plugin.register(api);
  const xpRewards = [];
  custom.set('xpreward:open', [request => xpRewards.push(request)]);
  if (members) PlantPlugin.register(api);
  const emit = (name, event) => hooks[name].forEach(cb => cb(event));
  emit('ServerStartup');
  t.after(() => emit('ServerShutdown'));
  function player() {
    const slots = [], rewards = [], rewardItems = [], messages = [], xp = new Map(), levels = new Map();
    const p = { slots, rewards, rewardItems, messages, xp, levels, free: 28, online: true, hp: 10,
      location: new Location(3222, 3222, 0), interfaceId: -1, chatboxGroupId: -1,
      attributes: new Map(),
      isRegistered: () => p.online, isPlayerBot: () => !!p.bot, getHitpoints: () => p.hp,
      getAttribute: key => p.attributes.get(key), setAttribute(key, value) {
        if (value == null) p.attributes.delete(key); else p.attributes.set(key, value);
      }, getNpcTransformationId: () => p.transformation ?? -1,
      getLocation: () => p.location, getUsername: () => 'Player', busy: () => !!p.isBusy,
      getCombat: () => ({ getTarget: () => p.target, getAttacker: () => p.attacker }),
      getCombatFollowing: () => p.combatFollowing,
      getPrivateArea: () => p.privateArea, getArea: () => p.area,
      getDueling: () => ({ inDuel: () => !!p.duel }), getForceMovement: () => p.movement,
      getInterfaceId: () => p.interfaceId, setInterfaceId(id) { p.interfaceId = id; },
      sendMessage: text => messages.push(text), forceChat(text) { p.chat = text; },
      setNpcTransformationId(id) { p.transformation = id; },
      performAnimation(animation) { p.animation = animation.getId(); },
      moveTo(location) { p.location = location; }, setLocation(location) { p.location = location; },
      getEquipment: () => ({ containsNumber: () => false }),
      getBank: () => ({ containsNumber: () => false }),
      getDialogueManager: () => ({
        startDialogues(builder) { p.dialogue = builder; },
        isActive: () => !!p.dialogue,
      }),
      getInventory: () => ({ get: slot => slots[slot], getItems: () => slots, getFreeSlots: () => p.free,
        containsNumber: id => slots.some(item => item?.getId() === id && item.getAmount() > 0),
        addItem(item) { rewards.push(item.getId()); rewardItems.push(item); },
        delete(id, amount = 1) { const index = slots.findIndex(item => item?.getId() === id);
          if (index < 0) return; const item = slots[index]; if (item.getAmount() > amount) item.amount -= amount;
          else { slots[index] = undefined; p.free++; } },
        deleteAtSlot(slot) { slots[slot] = undefined; p.free++; } }),
      getSkillManager: () => ({ getMaxLevel: skill => levels.get(skill) ?? 1,
        getExperience: skill => xp.get(skill) ?? 0, getTotalLevel: () => p.totalLevel ?? 1,
        addExperience(skill, amount, multipliers) {
          assert.equal(multipliers, false);
          if (!p.blockXp) xp.set(skill, Math.min(200_000_000, (xp.get(skill) ?? 0) + amount));
        } }),
      getPacketSender: () => ({ sendInterface(id) { p.interfaceId = id; },
        sendInterfaceRemoval() { p.interfaceId = -1; p.chatboxGroupId = -1; }, sendString(text, uid) {
          p.trayTitle = text; (p.strings ??= new Map()).set(uid, text);
        },
        sendItemOnInterfaces(uid, id) { (p.tray ??= []).push([uid, id]); },
        sendInterfaceRawModel(uid, model) { (p.models ??= new Map()).set(uid, model); },
        sendInterfaceDisplayState() {}, sendSubInterface() {}, sendConfig() {},
        sendInterfaceScript() {}, sendChatboxInterface(id) { p.chatboxGroupId = id; }, sendClientScript() {},
        isChatboxInterface(id) { return p.chatboxGroupId === id; },
        sendInterfaceAnimation() {},
        sendInterfaceFlagsRange(uid, from, to, flags) { (p.flags ??= []).push([uid, from, to, flags]); } }),
    };
    return p;
  }
  function spawn(p, kind = 0, food = 0) {
    enabled = true;
    random = 0.5; emit('PlayerLogin', { player: p }); now += 121 * 60_000;
    const values = [0.5, (kind + 0.1) / (members ? 24 : 22), (food + 0.1) / 7];
    t.mock.method(Math, 'random', () => values.shift() ?? random);
    emit('PlayerProcess', { player: p });
    t.mock.method(Math, 'random', () => random);
    return npcs.at(-1);
  }
  return { api, hooks, emit, npcs, prompts, drops, xpRewards, persistedAttributes, player, spawn,
    tasks, ticks(count) { for (let i = 0; i < count; i++) {
      for (const task of [...tasks]) if (task.isRunning()) task.tick();
    } },
    advance: ms => { now += ms; }, random: value => { random = value; },
    collision: (b, m) => { blocked = b; movable = m; }, disable: () => { enabled = false; } };
}

test('natural scheduling waits for the due time, checks on five-minute intervals, and keeps one follower', t => {
  const h = harness(t), p = h.player();
  h.emit('PlayerLogin', { player: p }); h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.length, 0);
  h.advance(121 * 60_000);
  p.isBusy = true; h.emit('PlayerProcess', { player: p }); assert.equal(h.npcs.length, 0, 'busy action stalls the due event');
  const pendingDue = p.getAttribute('random-events:next-at');
  h.advance(10_000);
  h.emit('PlayerProcess', { player: p });
  assert.equal(p.getAttribute('random-events:next-at'), pendingDue, 'pending checks do not reroll the timer');
  h.advance(10_000);
  p.isBusy = false; p.target = {}; h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.length, 1, 'the pending event appears as soon as the busy action ends');
  const dueAt = p.getAttribute('random-events:next-at');
  assert.ok(dueAt > Date.now());
  h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.length, 1);
  const npc = h.npcs[0];
  assert.equal(npc.following, p); assert.equal(npc.definition.ownerOnly, undefined);
  h.hooks['Sandwich lady'].Dismiss({ player: p, npc });
  h.emit('PlayerProcess', { player: p }); assert.equal(h.npcs.length, 1, 'dismissal keeps the timer set at spawn');
});

test('a teleport invitation can spawn during combat but does not move the player without acceptance', t => {
  const h = harness(t), p = h.player();
  p.target = {}; p.attacker = {}; p.combatFollowing = {};
  const origin = p.location.clone();
  const npc = h.spawn(p, 20);
  assert.equal(npc.definition.id, N.MYSTERIOUS_OLD_MAN_5);
  assert.equal(p.location.equals(origin), true);
  assert.equal(Teleports.hasSession(p), false);
  h.emit('PlayerProcess', { player: p });
  assert.equal(p.location.equals(origin), true, 'processing the invitation does not teleport either');
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 1);
  assert.equal(p.location.equals(origin), true, 'declining the invitation leaves the fight in place');
  assert.equal(Teleports.hasSession(p), false);
});

test('the due timestamp survives relogin and an offline-expired timer moves 10–70 minutes ahead', t => {
  const h = harness(t), p = h.player();
  h.emit('PlayerLogin', { player: p });
  const original = p.getAttribute('random-events:next-at');
  h.emit('PlayerLogout', { player: p }); h.emit('PlayerLogin', { player: p });
  assert.equal(p.getAttribute('random-events:next-at'), original);
  h.advance(original - Date.now() + 1);
  h.emit('PlayerLogout', { player: p }); h.emit('PlayerLogin', { player: p });
  const shifted = p.getAttribute('random-events:next-at');
  assert.ok(shifted - Date.now() >= 10 * 60_000 && shifted - Date.now() <= 70 * 60_000);
});

test('a corrupt far-future timestamp is replaced with a bounded cooldown', t => {
  const h = harness(t), p = h.player();
  p.setAttribute('random-events:next-at', Date.now() + 100 * 365 * 24 * 60 * 60_000);
  h.emit('PlayerLogin', { player: p });
  const dueAt = p.getAttribute('random-events:next-at');
  assert.ok(dueAt > Date.now() && dueAt <= Date.now() + 120 * 60_000);
});

test('bots and inaccessible squares cannot produce event NPCs', t => {
  const h = harness(t), p = h.player(); p.bot = true; h.spawn(p); assert.equal(h.npcs.length, 0);
  p.bot = false; h.collision(() => false, () => false); h.spawn(p); assert.equal(h.npcs.length, 0);
});

test('crash relogin returns from a random-event area to the exact saved tile', t => {
  const h = harness(t), p = h.player();
  assert.equal(h.persistedAttributes.get('random-events:return-location'), null);
  const origin = new Location(2750, 3510, 0);
  p.setAttribute('random-events:return-location', { x: origin.getX(), y: origin.getY(), z: origin.getZ() });
  p.location = new Location(1926, 5044, 0);
  h.emit('PlayerLogin', { player: p });
  assert.ok(p.location.equals(origin));
  assert.equal(p.getAttribute('random-events:return-location'), undefined);
});

test('crash recovery clears corrupt or stale return tiles and safely falls back from invalid coordinates', t => {
  const h = harness(t), p = h.player();
  p.location = new Location(1926, 5044, 0);
  p.setAttribute('random-events:return-location', { x: -1, y: 50_000, z: 9 });
  h.emit('PlayerLogin', { player: p });
  assert.ok(p.location.equals(new Location(3222, 3218, 0)));
  assert.equal(p.getAttribute('random-events:return-location'), undefined);

  const q = h.player(), outside = new Location(3300, 3300, 0);
  q.location = outside;
  q.setAttribute('random-events:return-location', { broken: true });
  h.emit('PlayerLogin', { player: q });
  assert.ok(q.location.equals(outside));
  assert.equal(q.getAttribute('random-events:return-location'), undefined);

  const r = h.player();
  r.location = new Location(2008, 4756, 0);
  r.setAttribute('random-events:return-location', { x: 1926, y: 5044, z: 0 });
  h.emit('PlayerLogin', { player: r });
  assert.ok(r.location.equals(new Location(3222, 3218, 0)), 'event-area return tiles are rejected');
});

test('transformed players stall and Wilderness selection excludes teleporting events', t => {
  const h = harness(t), p = h.player();
  h.api.core.Wilderness.isPvpArea = () => true;
  h.emit('PlayerLogin', { player: p });
  p.transformation = N.FROG_6;
  h.advance(121 * 60_000); h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.length, 0);
  p.transformation = -1;
  h.random(0); h.advance(5 * 60_000); h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.at(-1).definition.id, N.GENIE);
});

test('managed non-Wilderness areas defer the schedule instead of spawning in an unknown zone', t => {
  const h = harness(t), p = h.player();
  p.area = {};
  h.emit('PlayerLogin', { player: p }); h.advance(121 * 60_000); h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.length, 0);
  assert.ok(p.getAttribute('random-events:next-at') > Date.now());
});

test('randevt is described and owner-only, selects each index immediately and replaces the owned event', t => {
  const h = harness(t), p = h.player(), command = h.hooks.randevt;
  assert.equal(command.rights, PlayerRights.OWNER);
  assert.match(command.description, /zero-based event index/);
  h.disable();
  const ids = [N.GENIE, N.SANDWICH_LADY, N.DRUNKEN_DWARF, N.RICK_TURPENTINE,
    N.MILES, N.MYSTERIOUS_OLD_MAN_2, N.DR_JEKYLL, N.COUNT_CHECK_2, null, N.CAPT_ARNAV,
    N.BEE_KEEPER_2, N.QUIZ_MASTER_2, N.SERGEANT_DAMIEN_2, N.FREAKY_FORESTER_2, N.LEO_2,
    N.FLIPPA, N.EVIL_BOB, N.EVIL_BOB, N.POSTIE_PETE_2, N.MYSTERIOUS_OLD_MAN_4,
    N.MYSTERIOUS_OLD_MAN_5, N.PILLORY_GUARD, N.DUNCE_2, N.STRANGE_PLANT];
  let previous;
  ids.forEach((id, index) => {
    const event = { player: p, parts: ['randevt', String(index)], handled: false };
    command.handler(event);
    assert.equal(event.handled, true);
    let npc = h.npcs.at(-1);
    if (id === null) {
      npc = h.npcs.slice(-5).find(entry =>
        [N.FROG_PRIN, N.FROG_PRIN_2, N.FROG_PRINCE, N.FROG_PRINCESS].includes(entry.definition.id));
      assert.ok(npc);
    } else {
      assert.equal(npc.definition.id, id);
    }
    assert.equal(npc.owner, p);
    if (previous) assert.equal(previous.removed, true);
    if (index === 1) h.hooks['Sandwich lady']['Talk-to']({ player: p, npc });
    if (index === 2) assert.equal(p.interfaceId, -1, 'replacement closes the old tray');
    previous = npc;
  });
  h.random(0); command.handler({ player: p, parts: ['randevt'] });
  assert.equal(h.npcs.at(-1).definition.id, N.GENIE, 'omitting the index picks a random event');
  assert.equal(previous.removed, true);
  h.emit('PlayerLogout', { player: p }); assert.equal(h.npcs.at(-1).removed, true);
});

test('randevt rejects malformed/unavailable indices and ineligible players without replacing an event', t => {
  const h = harness(t, false), p = h.player(), command = h.hooks.randevt.handler;
  command({ player: p, parts: ['randevt', '0'] }); const first = h.npcs.at(-1);
  for (const args of [['-1'], ['22'], ['23'], ['24'], ['1.5'], ['nope'], ['1x'], [''], ['1', '2']]) {
    command({ player: p, parts: ['randevt', ...args] });
    assert.match(p.messages.at(-1), /Usage:.*0-21/);
    assert.equal(h.npcs.length, 1); assert.equal(first.removed, undefined);
  }
  p.target = {}; command({ player: p, parts: ['randevt', '1'] });
  assert.equal(h.npcs.length, 2); assert.equal(first.removed, true, 'combat does not block an in-place event');
  const replacement = h.npcs.at(-1);
  p.target = null; h.collision(() => true, () => false);
  command({ player: p, parts: ['randevt', '1'] });
  assert.equal(h.npcs.length, 2); assert.equal(replacement.removed, true);
  assert.match(p.messages.at(-1), /No traversable square/);
  h.emit('PlayerProcess', { player: p }); assert.equal(h.npcs.length, 2, 'failed test retains the cooldown');
});

test('Genie and dwarf deny other players, retain full-inventory events and grant only once', t => {
  const h = harness(t);
  for (const [kind, name, expected] of [[0, 'Genie', [I.LAMP]], [2, 'Drunken Dwarf', [I.KEBAB, I.BEER]]]) {
    const p = h.player(), other = h.player(), npc = h.spawn(p, kind);
    assert.equal(npc.definition.id, kind === 0 ? N.GENIE : N.DRUNKEN_DWARF);
    h.hooks[name]['Talk-to']({ player: other, npc }); h.hooks[name].Dismiss({ player: other, npc });
    assert.deepEqual(other.rewards, []); assert.equal(npc.removed, undefined);
    npc.owner = other; h.hooks[name]['Talk-to']({ player: p, npc }); assert.deepEqual(p.rewards, []); npc.owner = p;
    p.free = expected.length - 1; h.hooks[name]['Talk-to']({ player: p, npc }); assert.equal(npc.removed, undefined);
    p.free = 28; h.hooks[name]['Talk-to']({ player: p, npc });
    h.hooks[name]['Talk-to']({ player: p, npc }); assert.deepEqual(p.rewards, expected); assert.equal(npc.removed, true);
  }
});

test('every event delivers real inventory items and refreshes the container exactly once per reward', t => {
  const h = harness(t);
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
  t.mock.method(ItemDefinition, 'forId', id => ({ isStackable: () => id === I.COINS }));
  for (const [index, name, expected] of [[0, 'Genie', [[I.LAMP, 1]]],
    [1, 'Sandwich lady', [[I.BAGUETTE, 1]]], [2, 'Drunken Dwarf', [[I.KEBAB, 1], [I.BEER, 1]]],
    [3, 'Rick Turpentine', [[I.COINS, 80]]], [4, 'Niles', [[I.COINS, 80]]],
    [5, 'Mysterious Old Man', [[I.COINS, 80]]], [6, 'Dr Jekyll', [[I.STRENGTH_POTION_2_, 1]]],
    [23, 'Strange plant', [[I.STRANGE_FRUIT, 1]]]]) {
    const p = h.player(), inventory = new Inventory(p), sender = p.getPacketSender();
    let refreshes = 0;
    sender.sendItemContainer = container => { assert.equal(container, inventory); refreshes++; };
    p.getPacketSender = () => sender;
    p.getInventory = () => inventory;
    const npc = h.spawn(p, index, 0);
    h.random(index === 1 ? 0.5 : 0);
    if (index === 23) h.advance(27_000);
    const interact = () => h.hooks[name][index === 23 ? 'Pick' : 'Talk-to']({ player: p, npc });
    interact();
    if (index === 1) h.emit('InterfaceActionClick', { player: p, buttonId: (297 << 16) | 6, action: 1 });
    if (index === 4) certerChoice(h, p, 'Fish');
    interact();
    assert.deepEqual(inventory.getValidItems().map(item => [item.getId(), item.getAmount()]), expected, name);
    assert.equal(refreshes, expected.length, name);
    assert.equal(npc.removed, true, name);
  }
  // The real container must also accept a stacked reward with no free slot and
  // reuse the exact consumed herb slot for a full-inventory exchange.
  for (const index of [3, 6]) {
    const p = h.player(), inventory = new Inventory(p), sender = p.getPacketSender();
    sender.sendItemContainer = () => {};
    p.getPacketSender = () => sender; p.getInventory = () => inventory;
    for (let slot = 0; slot < 28; slot++) inventory.getItems()[slot] = new Item(I.SHARK, 1);
    inventory.getItems()[5] = new Item(index === 3 ? I.COINS : I.TORSTOL, index === 3 ? 10 : 1);
    const npc = h.spawn(p, index); h.random(0);
    assert.equal(inventory.getFreeSlots(), 0);
    h.hooks[index === 3 ? 'Rick Turpentine' : 'Dr Jekyll']['Talk-to']({ player: p, npc });
    if (index === 6) h.prompts.at(-1).options[0].cb();
    assert.equal(inventory.get(5).getId(), index === 3 ? I.COINS : I.STAMINA_POTION_4_);
    assert.equal(inventory.get(5).getAmount(), index === 3 ? 90 : 1);
    assert.equal(inventory.getFreeSlots(), 0); assert.equal(npc.removed, true);
  }
});

test('Sandwich tray validates owner, selection and open interface, with harmless retry and stale roll', t => {
  const h = harness(t), p = h.player(), other = h.player(), npc = h.spawn(p, 1, 0);
  const click = (player, index, action = 1) => h.emit('InterfaceActionClick', { player, buttonId: (297 << 16) | (6 + index), action });
  click(p, 0); assert.deepEqual(p.rewards, []);
  h.hooks['Sandwich lady']['Talk-to']({ player: p, npc });
  assert.equal(p.tray.length, 7); assert.match(p.trayTitle, /baguette/);
  assert.deepEqual(p.flags, Array.from({ length: 7 }, (_, index) => [(297 << 16) | (6 + index), -1, -1, 2]));
  click(p, 0, 2); assert.deepEqual(p.rewards, []);
  other.interfaceId = 297; click(other, 0); click(p, 1); assert.deepEqual(p.rewards, []); assert.equal(npc.removed, undefined);
  p.free = 0; click(p, 0); assert.equal(npc.removed, undefined);
  p.free = 1; h.random(0); click(p, 0); click(p, 0);
  assert.deepEqual(p.rewards, [I.STALE_BAGUETTE]); assert.equal(p.interfaceId, -1);
  const normal = h.player(), npc2 = h.spawn(normal, 1, 0);
  h.hooks['Sandwich lady']['Talk-to']({ player: normal, npc: npc2 }); h.random(1 / 64); click(normal, 0);
  assert.deepEqual(normal.rewards, [I.BAGUETTE]);
});

test('dismissal, expiry, distance, plane, instances, logout, death and shutdown clean owned NPCs', t => {
  const h = harness(t);
  for (const reason of ['dismiss', 'expiry', 'distance', 'plane', 'instance', 'PlayerLogout', 'PlayerDisconnect', 'PlayerDeath', 'ServerShutdown']) {
    const p = h.player(), npc = h.spawn(p);
    if (reason === 'dismiss') h.hooks.Genie.Dismiss({ player: p, npc });
    else if (reason.startsWith('Player')) h.emit(reason, { player: p });
    else if (reason === 'ServerShutdown') h.emit(reason);
    else {
      if (reason === 'expiry') { h.advance(60_000); h.disable(); }
      if (reason === 'distance') p.location = new Location(3300, 3300, 0);
      if (reason === 'plane') p.location = new Location(3222, 3222, 1);
      if (reason === 'instance') p.privateArea = {};
      h.emit('PlayerProcess', { player: p });
    }
    assert.equal(npc.removed, true, reason); assert.deepEqual(p.rewards, []);
  }
});

function rub(h, p, slot = 3) {
  const item = new Item(I.LAMP, 1); p.slots[slot] = item;
  assert.equal(h.hooks.Lamp.Rub({ player: p, item, itemId: I.LAMP, slot, clickType: 1, handled: false }), true);
  return item;
}
/** Confirming a skill on the xpreward interface the lamp opened (the reward's message box text). */
const confirm = (h, skill) => h.xpRewards.at(-1).onConfirm(skill, skill.getName());

test('real Rub event reaches every skill, uses base level XP, exact slot and one confirmation only', t => {
  const h = harness(t);
  for (const skill of Skill.values()) {
    const p = h.player(); p.levels.set(skill, 37); rub(h, p);
    assert.equal(h.xpRewards.at(-1).player, p, 'opens the xpreward interface');
    assert.equal(confirm(h, skill), `Your wish has been granted!<br>You have been awarded 370 ${skill.getName()} XP!`);
    assert.equal(confirm(h, skill), null, 'once');
    assert.equal(p.xp.get(skill), 370, skill.getName()); assert.equal(p.slots[3], undefined);
  }
});

test('lamp keeps blocked/maxed XP and rejects changed slot, replay, replacement prompts and logout', t => {
  const h = harness(t), skill = Skill.values()[0];
  for (const reason of ['blocked', 'moved', 'swapped', 'new-request', 'offline', 'PlayerLogout', 'PlayerDisconnect', 'PlayerDeath']) {
    const p = h.player(), item = rub(h, p); const request = h.xpRewards.at(-1);
    const yes = () => request.onConfirm(skill, skill.getName());
    if (reason === 'blocked') p.blockXp = true;
    if (reason === 'moved') { p.slots[4] = item; p.slots[3] = undefined; }
    if (reason === 'swapped') p.slots[3] = new Item(I.LAMP, 1);
    if (reason === 'new-request') rub(h, p);
    if (reason === 'offline') p.online = false;
    if (reason.startsWith('Player')) h.emit(reason, { player: p });
    yes(); yes(); assert.equal(p.xp.size, 0, reason);
    if (reason === 'blocked') assert.equal(p.slots[3], item, 'denied XP retains lamp');
  }
  const maxed = h.player(), lamp = rub(h, maxed); maxed.xp.set(skill, 200_000_000);
  assert.equal(confirm(h, skill), null);
  assert.equal(maxed.xp.get(skill), 200_000_000); assert.equal(maxed.slots[3], lamp);
});

test('Rick retains the first gift when full, denies strangers and cannot reward twice', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 3);
  assert.equal(npc.definition.id, N.RICK_TURPENTINE);
  h.hooks['Rick Turpentine']['Talk-to']({ player: h.player(), npc });
  p.free = 0; h.random(0.6); h.hooks['Rick Turpentine']['Talk-to']({ player: p, npc });
  assert.deepEqual(p.rewards, []); assert.equal(npc.removed, undefined);
  p.free = 1; h.random(0.99); h.hooks['Rick Turpentine']['Talk-to']({ player: p, npc });
  h.hooks['Rick Turpentine']['Talk-to']({ player: p, npc });
  assert.deepEqual(p.rewards, [I.UNCUT_SAPPHIRE]); assert.equal(npc.removed, true);
});

test('gift amounts and key halves follow the 150-entry table and F2P replacement', t => {
  const h = harness(t);
  const counts = new Map();
  for (let i = 0; i < 150; i++) {
    h.random((i + 0.1) / 150);
    const reward = Gift.roll(h.api);
    const key = `${reward.id}:${reward.amount}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  assert.equal(counts.size, 15);
  assert.equal(counts.get(`${I.COINS}:240`), 6);
  assert.equal(counts.get(`${I.UNCUT_SAPPHIRE}:1`), 32);
  assert.equal(counts.get(`${I.SPINACH_ROLL}:1`), 14);
  assert.equal(counts.get(`${I.TOOTH_HALF_OF_KEY}:1`), 1);
  assert.equal(counts.get(`${I.LOOP_HALF_OF_KEY}:1`), 1);
  for (const [position, expected] of [[0, 80], [10, 160], [20, 240], [26, 320], [36, 480], [46, 640]]) {
    h.random((position + 0.1) / 150); assert.deepEqual(Gift.roll(h.api), { id: I.COINS, amount: expected });
  }
  h.api.core.WorldDefinition.isMembersWorld = () => false;
  for (const position of [148, 149]) {
    h.random((position + 0.1) / 150); assert.deepEqual(Gift.roll(h.api), { id: I.COINS, amount: 640 });
  }
});

test('F2P has no Jekyll definition and coins can join an existing stack in a full inventory', t => {
  const h = harness(t, false), p = h.player(), npc = h.spawn(p, 3);
  assert.equal(JekyllPlugin.members, true); assert.equal(h.hooks['Dr Jekyll'], undefined);
  p.free = 0; p.slots[0] = new Item(I.COINS, 1); h.random(149.1 / 150);
  h.hooks['Rick Turpentine']['Talk-to']({ player: p, npc });
  assert.equal(p.rewardItems[0].getAmount(), 640); assert.equal(p.rewards[0], I.COINS);
  const last = h.spawn(h.player(), 4, 6); assert.equal(last.definition.id, N.GILES);
});

function certerChoice(h, p, name, action = 1) {
  const index = [1, 2, 3].findIndex(child => p.strings?.get((184 << 16) | child) === name);
  assert.notEqual(index, -1, `choice ${name}`);
  h.emit('InterfaceActionClick', { player: p, buttonId: (184 << 16) | (8 + index), action });
}

test('all Certer brothers use cache models, distinct answers, owner/op/interface guards and one reward', t => {
  const h = harness(t);
  for (const [variant, npcId, name] of [[0, N.NILES, 'Niles'], [3, N.MILES, 'Miles'], [6, N.GILES, 'Giles']]) {
    const p = h.player(), npc = h.spawn(p, 4, variant), other = h.player();
    assert.equal(npc.definition.id, npcId);
    h.random(0); h.hooks[name]['Talk-to']({ player: p, npc });
    assert.equal(p.tray[0][0], (184 << 16) | 7); assert.equal(p.tray[0][1], 6189);
    assert.equal(new Set(p.strings.values()).size, 3);
    assert.deepEqual(p.flags, [8, 9, 10].map(child => [(184 << 16) | child, -1, -1, 2]));
    other.interfaceId = 184; other.strings = p.strings; certerChoice(h, other, 'Fish');
    certerChoice(h, p, 'Fish', 2); p.interfaceId = -1; certerChoice(h, p, 'Fish');
    assert.deepEqual(p.rewards, []); assert.equal(npc.removed, undefined);
    h.hooks[name]['Talk-to']({ player: p, npc });
    p.free = 0; h.random(0.6); certerChoice(h, p, 'Fish');
    assert.deepEqual(p.rewards, []); assert.equal(npc.removed, undefined);
    p.free = 1; h.random(0.99); certerChoice(h, p, 'Fish'); certerChoice(h, p, 'Fish');
    assert.deepEqual(p.rewards, [I.UNCUT_SAPPHIRE]); assert.equal(npc.removed, true); assert.equal(p.interfaceId, -1);
  }
});

test('Certer wrong answers end without a reward; expiry closes its interface', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 4);
  h.random(0); h.hooks.Niles['Talk-to']({ player: p, npc }); certerChoice(h, p, 'Sword');
  assert.equal(npc.removed, true); assert.deepEqual(p.rewards, []); assert.equal(p.interfaceId, -1);
  const q = h.player(), expired = h.spawn(q, 4); h.random(0); h.hooks.Niles['Talk-to']({ player: q, npc: expired });
  h.advance(60_000); h.emit('PlayerProcess', { player: q }); certerChoice(h, q, 'Fish');
  assert.equal(expired.removed, true); assert.deepEqual(q.rewards, []); assert.equal(q.interfaceId, -1);
});

test('Jekyll selects the highest clean herb and all fourteen exchanges work with a full inventory', t => {
  const h = harness(t);
  for (const [herbId, potionId] of [[I.GUAM_LEAF, I.STRENGTH_POTION_4_], [I.MARRENTILL, I.ANTIPOISON_4_],
    [I.TARROMIN, I.ATTACK_POTION_4_], [I.HARRALANDER, I.RESTORE_POTION_4_], [I.RANARR_WEED, I.ENERGY_POTION_4_],
    [I.TOADFLAX, I.DEFENCE_POTION_4_], [I.IRIT_LEAF, I.AGILITY_POTION_4_], [I.AVANTOE, I.SUPER_ATTACK_4_],
    [I.KWUARM, I.SUPER_ENERGY_4_], [I.SNAPDRAGON, I.SUPER_STRENGTH_4_], [I.CADANTINE, I.SUPER_RESTORE_4_],
    [I.LANTADYME, I.SUPER_DEFENCE_4_], [I.DWARF_WEED, I.MAGIC_POTION_4_], [I.TORSTOL, I.STAMINA_POTION_4_]]) {
    assert.equal(typeof herbId, 'number'); assert.equal(typeof potionId, 'number');
    const p = h.player(), npc = h.spawn(p, 6);
    assert.equal(npc.definition.id, N.DR_JEKYLL);
    p.slots[0] = new Item(I.GUAM_LEAF, 1); p.slots[4] = new Item(herbId, 1); p.free = 0;
    h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc }); const yes = h.prompts.at(-1).options[0].cb;
    yes(); yes(); assert.deepEqual(p.rewards, [potionId]); assert.equal(npc.removed, true);
    assert.equal(p.slots[herbId === I.GUAM_LEAF ? 0 : 4], undefined);
  }
});

test('Jekyll ignores noted/grimy/huasca, offers a fallback and preserves refused herbs', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 6);
  p.slots[0] = new Item(I.GRIMY_TORSTOL, 1); p.slots[1] = new Item(I.TORSTOL_2, 1);
  p.slots[2] = new Item(I.HUASCA, 1); p.free = 0;
  h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc }); assert.deepEqual(p.rewards, []);
  p.free = 1; h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc });
  assert.deepEqual(p.rewards, [I.STRENGTH_POTION_2_]); assert.equal(p.slots.filter(Boolean).length, 3);
  const q = h.player(), refused = h.spawn(q, 6), herb = new Item(I.TORSTOL, 1); q.slots[2] = herb;
  h.hooks['Dr Jekyll']['Talk-to']({ player: q, npc: refused }); h.prompts.at(-1).options[1].cb();
  assert.equal(q.slots[2], herb); assert.deepEqual(q.rewards, [I.STRENGTH_POTION_2_]);
});

test('Jekyll rejects strangers, moved/replaced herbs, stale prompts and replies after cleanup', t => {
  const h = harness(t);
  for (const reason of ['moved', 'swapped', 'new-prompt', 'PlayerLogout', 'PlayerDeath', 'expired', 'dismiss']) {
    const p = h.player(), npc = h.spawn(p, 6), herb = new Item(I.IRIT_LEAF, 1); p.slots[2] = herb;
    const before = h.prompts.length; h.hooks['Dr Jekyll']['Talk-to']({ player: h.player(), npc });
    assert.equal(h.prompts.length, before);
    h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc }); const yes = h.prompts.at(-1).options[0].cb;
    if (reason === 'moved') { p.slots[3] = herb; p.slots[2] = undefined; }
    if (reason === 'swapped') p.slots[2] = new Item(I.IRIT_LEAF, 1);
    if (reason === 'new-prompt') h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc });
    if (reason.startsWith('Player')) h.emit(reason, { player: p });
    if (reason === 'expired') h.advance(60_000);
    if (reason === 'dismiss') h.hooks['Dr Jekyll'].Dismiss({ player: p, npc });
    yes(); yes(); assert.deepEqual(p.rewards, [], reason);
  }
  const p = h.player(), npc = h.spawn(p, 6); p.slots[2] = new Item(I.GUAM_LEAF, 1);
  h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc }); const oldYes = h.prompts.at(-1).options[0].cb;
  p.slots[2] = new Item(I.TORSTOL, 1); h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc });
  assert.match(h.prompts.at(-1).title, /torstol/); oldYes(); h.prompts.at(-1).options[0].cb();
  assert.deepEqual(p.rewards, [I.STAMINA_POTION_4_]);
});

test('Mysterious Old Man gives a single owned gift, retains it when full and can be dismissed', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 5);
  assert.equal(npc.definition.id, N.MYSTERIOUS_OLD_MAN_2);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: h.player(), npc });
  p.free = 0; h.random(0.6); h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc });
  assert.deepEqual(p.rewards, []); assert.equal(npc.removed, undefined);
  p.free = 1; h.random(0); h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc });
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc });
  assert.deepEqual(p.rewards, [I.UNCUT_SAPPHIRE]); assert.equal(npc.removed, true);
  const q = h.player(), dismissed = h.spawn(q, 5);
  h.hooks['Mysterious Old Man'].Dismiss({ player: q, npc: dismissed });
  assert.equal(dismissed.removed, true); assert.deepEqual(q.rewards, []);
});

test('Strange Plant stays planted, grows before picking, denies strangers and rewards only once', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 23);
  assert.equal(npc.definition.id, N.STRANGE_PLANT); assert.equal(npc.animation, 348);
  assert.equal(npc.following, undefined); assert.equal(npc.chat, undefined);
  h.hooks['Strange plant'].Pick({ player: p, npc }); assert.match(p.messages.at(-1), /isn't ready/);
  h.advance(26_999); h.hooks['Strange plant'].Pick({ player: p, npc }); assert.deepEqual(p.rewards, []);
  h.advance(1); h.hooks['Strange plant'].Pick({ player: h.player(), npc });
  h.emit('PlayerProcess', { player: p }); assert.equal(npc.chat, undefined, 'plants do not talk');
  h.hooks['Strange plant'].Pick({ player: p, npc }); h.hooks['Strange plant'].Pick({ player: p, npc });
  assert.deepEqual(p.rewards, [I.STRANGE_FRUIT]); assert.equal(npc.removed, true); assert.equal(h.drops.length, 0);
});

test('full-inventory fruit remains private on the ground for exactly three hours', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 23);
  p.free = 0; h.advance(27_000); h.hooks['Strange plant'].Pick({ player: p, npc });
  h.hooks['Strange plant'].Pick({ player: p, npc });
  assert.deepEqual(p.rewards, []); assert.equal(h.drops.length, 1); assert.equal(npc.removed, true);
  const drop = h.drops[0];
  assert.equal(drop.getItem().getId(), I.STRANGE_FRUIT); assert.equal(drop.getOwner(), p.getUsername());
  assert.equal(drop.getgoesGlobal(), false); assert.equal(drop.getState(), State.SEEN_BY_PLAYER);
  assert.ok(drop.getPosition().equals(p.location)); assert.notEqual(drop.getPosition(), p.location);
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  let removed = 0; t.mock.method(ItemOnGroundManager, 'deregister', item => { assert.equal(item, drop); removed++; });
  for (let tick = 1; tick < 18_000; tick++) drop.process();
  assert.equal(removed, 0); assert.equal(drop.getState(), State.SEEN_BY_PLAYER);
  drop.process(); assert.equal(removed, 1);
});

test('Strange Plant cleans up without fruit after dismissal, expiry, distance or logout and is members-only', t => {
  const h = harness(t);
  for (const reason of ['dismiss', 'expiry', 'distance', 'logout']) {
    const p = h.player(), npc = h.spawn(p, 23);
    h.hooks['Strange plant'].Dismiss({ player: h.player(), npc }); assert.equal(npc.removed, undefined);
    if (reason === 'dismiss') h.hooks['Strange plant'].Dismiss({ player: p, npc });
    if (reason === 'logout') h.emit('PlayerLogout', { player: p });
    if (reason === 'expiry') { h.advance(60_000); h.emit('PlayerProcess', { player: p }); }
    if (reason === 'distance') { p.location = new Location(3300, 3300, 0); h.emit('PlayerProcess', { player: p }); }
    h.hooks['Strange plant'].Pick({ player: p, npc });
    assert.equal(npc.removed, true); assert.deepEqual(p.rewards, []);
  }
  assert.deepEqual(h.drops, []); assert.equal(PlantPlugin.members, true);
  const f2p = harness(t, false); assert.equal(f2p.hooks['Strange plant'], undefined);
  const p = f2p.player(), oldMan = f2p.spawn(p, 5);
  assert.equal(oldMan.definition.id, N.MYSTERIOUS_OLD_MAN_2, 'F2P includes the Old Man without members definitions');
});

// --- The teleport random events ---------------------------------------------------------

// The flows show their choices on the multi-chatbox prompt: run any pending ActionDialogue
// (which fires the prompt when the player finishes the NPC lines), then answer it.
function openOptions(h, p) {
  for (const entry of [...(p.dialogue?.getDialogues?.().values() ?? [])]) {
    if (entry.constructor.name === 'ActionDialogue') entry.send(p);
  }
  return [...h.prompts].reverse().find(entry => entry.player === p) ?? null;
}

function choose(h, p, index) {
  const prompt = openOptions(h, p);
  assert.ok(prompt, 'an option prompt is open');
  prompt.options[index].cb();
}

function fireRaw(h, key, event) {
  for (const handler of h.hooks[key] ?? []) {
    event.handled = false;
    handler(event);
    if (event.handled) return true;
  }
  return false;
}

function fireNpcClick(h, npcId, clickType, event) {
  for (const [key, actions] of Object.entries(h.hooks)) {
    if (!key.startsWith('npcClick:')) continue;
    if (!key.slice('npcClick:'.length).split(',').includes(String(npcId))) continue;
    const handler = actions.get(clickType);
    if (handler) { event.handled = false; handler(event); return true; }
  }
  return false;
}

test('Count Check reports the check and gives its lamp', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 7);
  assert.equal(npc.definition.id, N.COUNT_CHECK_2);
  h.hooks['Count Check']['Talk-to']({ player: p, npc, handled: false });
  assert.deepEqual(p.rewards, [I.LAMP]);
  assert.equal(npc.removed, true);
});

const FROG_POSITIVE = ["Okay.", "Sure, I will.", "Very well, if a touch is all you need, I'll do it.",
  "Yes, I will touch you.", "How about if we kiss?", "May I kiss you instead?",
  "Would a kiss be acceptable?"];
const FROG_POLITE = ["I would prefer not to, sorry.", "I'm sorry, I'd prefer not to do that."];
const FROG_RUDE = ["No way, I'm not kissing you.", "Eww, no way!", "I'd rather become a frog too!"];

test('Kiss the frog pays a token, politely ends, or turns rude players into a frog', t => {
  for (const [pool, expected] of [[FROG_POSITIVE, 'token'], [FROG_POLITE, 'end'], [FROG_RUDE, 'transform']]) {
    const h = harness(t), p = h.player(), before = h.npcs.length;
    h.spawn(p, 8);
    const npc = h.npcs.slice(before).find(entry =>
      [N.FROG_PRIN, N.FROG_PRIN_2, N.FROG_PRINCE, N.FROG_PRINCESS].includes(entry.definition.id));
    assert.ok(npc, 'the royal frog');
    assert.equal(h.npcs.length - before, 5, 'the royal and a chorus of frogs');
    h.hooks.Frog['Talk-to']({ player: p, npc, handled: false });
    const prompt = openOptions(h, p);
    const index = prompt.options.findIndex(entry => pool.includes(entry.label));
    assert.notEqual(index, -1);
    choose(h, p, index);
    if (expected === 'token') {
      assert.deepEqual(p.rewards, [I.FROG_TOKEN]);
      assert.equal(npc.removed, true);
    } else if (expected === 'end') {
      assert.deepEqual(p.rewards, []);
      assert.equal(npc.removed, true);
      assert.ok(h.npcs.slice(before).every(entry => entry.removed), 'the frog chorus is cleaned up too');
    } else {
      assert.equal(p.transformation, N.FROG_6);
      assert.equal(p.location.getX(), 2464);
      assert.equal(p.location.getY(), 4780);
      const royal = [...h.npcs].reverse().find(entry => entry.definition.kind === undefined && entry.owner === p);
      h.hooks.Frog['Talk-to']({ player: p, npc: royal, handled: false });
      choose(h, p, 0);
      assert.equal(p.transformation, -1);
      assert.equal(Teleports.sessionOf(p), undefined);
    }
  }
});

test('Thessalia exchanges a frog token for costume pieces, keeping the rest', t => {
  const h = harness(t), p = h.player();
  p.slots[0] = new Item(I.FROG_TOKEN, 1); p.slots[1] = new Item(I.FROG_TOKEN, 1);
  h.hooks.Thessalia['Talk-to']({ player: p, npc: {}, handled: false });
  choose(h, p, 0);
  assert.equal(p.rewards.at(-1), I.FROG_MASK);
  assert.equal(p.slots[0], undefined);
  assert.ok(p.slots[1]);
  h.hooks.Thessalia['Talk-to']({ player: p, npc: {}, handled: false });
  choose(h, p, 3);
  assert.equal(p.rewards.at(-1), I.LAMP);
});

test("Capt' Arnav's combilock opens, rolls and pays only on a solved lock", t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 9);
  h.hooks["Capt' Arnav"]['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  assert.equal(p.interfaceId, 26);
  assert.ok(p.flags.some(flag => flag[0] === (26 << 16) | 5));
  const active = Events.activeFor(p);
  h.emit('InterfaceActionClick', { player: p, buttonId: (26 << 16) | 5, action: 1 });
  h.emit('InterfaceActionClick', { player: p, buttonId: (26 << 16) | 25, action: 1 });
  assert.deepEqual(p.rewards, []);
  assert.equal(p.messages.at(-1), 'The chest stays firmly locked.');
  active.lock.forEach(state => {
    const index = state.cylinder.findIndex(item => item[1] === state.word);
    state.offset = (index - 1 + state.cylinder.length) % state.cylinder.length;
  });
  h.emit('InterfaceActionClick', { player: p, buttonId: (26 << 16) | 25, action: 1 });
  assert.equal(p.rewards.length, 1);
  assert.equal(npc.removed, true);
  const doomed = h.spawn(h.player(), 9);
  h.hooks["Capt' Arnav"]['Talk-to']({ player: h.player(), npc: doomed });
});

test('throwing session cleanup callbacks do not strand players or stop shutdown cleanup', t => {
  const h = harness(t), players = [h.player(), h.player()], cleaned = [];
  t.mock.method(console, 'error', () => {});
  for (const [index, p] of players.entries()) {
    const origin = p.location.clone(), npc = h.spawn(p, 10);
    h.hooks['Bee keeper']['Talk-to']({ player: p, npc, handled: false }); choose(h, p, 0);
    const session = Teleports.sessionOf(p);
    session.cleanup.unshift(() => { throw new Error('cleanup failed'); }, () => cleaned.push(index));
    p.origin = origin;
  }
  h.emit('ServerShutdown');
  assert.deepEqual(cleaned.sort(), [0, 1]);
  for (const p of players) {
    assert.ok(p.location.equals(p.origin));
    assert.equal(p.getAttribute('random-events:return-location'), undefined);
    assert.equal(Teleports.sessionOf(p), undefined);
  }
});

test('Beekeeper assembles the hive and rewards a lamp plus an outfit piece', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 10);
  h.hooks['Bee keeper']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  assert.equal(p.location.getX(), 1926);
  const session = Teleports.sessionOf(p);
  assert.equal(session.kind, 'beekeeper');
  assert.ok(session.keeper.getLocation().equals(new Location(1927, 5044, 0)), 'keeper spawns beside arrival, not invitation');
  for (const part of ['Lid', 'Body', 'Entrance', 'Legs']) {
    choose(h, p, openOptions(h, p).options.findIndex(entry => entry.label === part));
  }
  h.emit('InterfaceActionClick', { player: p, buttonId: (420 << 16) | 22, action: 1 });
  assert.ok(p.rewards.includes(I.LAMP));
  assert.ok(p.rewards.includes(25129), "the beekeeper's hat");
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.equal(p.location.getX(), 3222);
});

test('Beekeeper loses after six wrong builds', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 10);
  h.hooks['Bee keeper']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  for (let attempt = 0; attempt < 6 && Teleports.sessionOf(p); attempt++) {
    for (const part of ['Lid', 'Body', 'Entrance', 'Legs']) {
      choose(h, p, openOptions(h, p).options.findIndex(entry => entry.label === part));
    }
    // Put the wrong part in the lid slot so every build fails.
    const last = session.data.placed[0];
    session.data.placed[0] = session.data.placed[1];
    session.data.placed[1] = last;
    h.emit('InterfaceActionClick', { player: p, buttonId: (420 << 16) | 22, action: 1 });
  }
  assert.deepEqual(p.rewards, []);
  assert.equal(Teleports.sessionOf(p), undefined);
});

const QUIZ_GROUP = 30012;
test('Quiz Master pays 1,000 coins after four correct odd-one-out answers', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 11);
  h.hooks['Quiz Master']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  for (let i = 0; i < 4; i++) {
    const index = session.data.items.indexOf(session.data.odd);
    h.emit('InterfaceActionClick', { player: p, buttonId: (QUIZ_GROUP << 16) | (3 + index), action: 1 });
  }
  assert.equal(session.data.streak, 4);
  choose(h, p, 0);
  assert.deepEqual(p.rewards, [I.COINS]);
  assert.equal(p.rewardItems.at(-1).getAmount(), 1000);
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Quiz Master wrong answers only reset the streak', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 11);
  h.hooks['Quiz Master']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  const wrong = session.data.items.findIndex(item => item !== session.data.odd);
  h.emit('InterfaceActionClick', { player: p, buttonId: (QUIZ_GROUP << 16) | (3 + wrong), action: 1 });
  assert.equal(session.data.streak, 0);
  assert.match(p.messages.at(-1), /WRONG|Wrong|No!|not the odd/);
});

test('Drill Demon accepts four matching exercises in a row for the camo top', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 12);
  h.hooks['Sergeant Damien']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  assert.equal(p.location.getX(), 3163, 'drill arrival x');
  assert.equal(p.location.getY(), 4819, 'drill arrival y');
  for (let i = 0; i < 4; i++) {
    const entry = [...session.data.matExercise.entries()].find(([, exercise]) => exercise === session.data.order);
    assert.ok(entry, 'a mat matches the order');
    h.hooks['object:Exercise mat'].Use({ player: p, handled: false,
      object: { getLocation: () => new Location(entry[0], 4820, 0), getId: () => 1 } });
  }
  assert.ok(p.rewards.includes(I.LAMP));
  assert.ok(p.rewards.includes(6654), 'camo top');
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Drill Demon breaks the streak on a wrong mat', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 12);
  h.hooks['Sergeant Damien']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  const wrong = [...session.data.matExercise.entries()].find(([, exercise]) => exercise !== session.data.order);
  h.hooks['object:Exercise mat'].Use({ player: p, handled: false,
    object: { getLocation: () => new Location(wrong[0], 4820, 0), getId: () => 1 } });
  assert.equal(session.data.streak, 0);
  assert.ok(p.messages.some(message => /Wrong exercise/.test(message)));
});

test('Freaky Forester takes any carcass and the portal pays the outfit piece', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 13);
  h.hooks['Freaky Forester']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  const bird = { getId: () => 5497, getLocation: () => p.location.clone(), forceChat() {}, setHitpoints() {} };
  assert.equal(fireNpcClick(h, 5497, 2, { player: p, npc: bird, npcId: 5497 }), true);
  assert.equal(h.drops.at(-1).getItem().getId(), I.RAW_PHEASANT_3);
  p.slots[0] = new Item(I.RAW_PHEASANT_3, 1);
  assert.equal(session.data.done, false);
  h.hooks['Freaky Forester']['Talk-to']({ player: p, npc: { getId: () => 372 }, handled: false });
  assert.equal(session.data.done, true);
  p.slots[0] = undefined;
  h.hooks['object:Exit portal'].Use({ player: p, handled: false,
    object: { getId: () => 20843, getLocation: () => p.location.clone() } });
  assert.deepEqual(p.rewards, [6182]);
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Gravedigger buries the five right coffins for zombie pieces', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 14);
  h.hooks.Leo['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  const professions = ['cook', 'farmer', 'lumberjack', 'miner', 'potter'];
  const graves = [[1924, 4996], [1926, 4999], [1928, 4996], [1930, 4999], [1932, 4996]];
  for (let i = 0; i < 5; i++) {
    const grave = { getId: () => 9364 + i, getType: () => 10, getFace: () => 0,
      getPrivateArea: () => null, getLocation: () => new Location(graves[i][0], graves[i][1], 0) };
    h.hooks['object:Grave']['Take-Coffin']({ player: p, object: grave, handled: false });
    const item = 7587 + professions.indexOf(session.data.professions[i]);
    p.slots[0] = new Item(item, 1);
    const target = { getId: () => 10050 + i, getLocation: () => new Location(graves[i][0], graves[i][1], 0) };
    assert.equal(fireRaw(h, 'itemOnObject', { player: p, itemId: item, object: target }), true);
  }
  assert.equal(session.data.buried.size, 5);
  h.hooks.Leo['Talk-to']({ player: p, npc: session.leo, handled: false });
  choose(h, p, 0);
  assert.ok(p.rewards.includes(13283) && p.rewards.includes(13284));
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Pinball scores the glowing post, resets on others and pays at the cave exit', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 15);
  h.hooks.Flippa['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  const [tile] = Pinball._test.POSTS[0];
  const fake = { getId: () => Pinball._test.POSTS[0][2], getLocation: () => new Location(tile[0], tile[1], 0) };
  Pinball._test.room.glow = 0;
  session.data.score = 9;
  h.hooks['object:Pinball Post'].Tag({ player: p, object: fake, handled: false });
  assert.equal(session.data.done, true);
  h.hooks['object:Cave Exit'].Use({ player: p, handled: false,
    object: { getId: () => 9293, getLocation: () => new Location(1971, 5036, 0) } });
  assert.equal(p.rewardItems.length, 1);
  assert.ok([1608, 1606, 1604, 1602].includes(p.rewards[0]));
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Evil Bob island fishing, uncooking and feeding pays 650 Fishing XP', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 16);
  h.hooks['Evil Bob']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  session.data.spot = 'west';
  p.slots[0] = new Item(6209, 1);
  h.hooks.Servant['Talk-to']({ player: p, npc: {}, npcId: N.SERVANT_2, handled: false });
  assert.ok(p.dialogue, 'the servant speaks');
  assert.match(JSON.stringify([...p.dialogue.getDialogues().values()].map(entry => entry.getText?.() ?? '')), /west/);
  const spot = { getId: () => 23114, getLocation: () => new Location(2510, 4775, 0) };
  assert.equal(fireRaw(h, 'objectRaw', { player: p, object: spot }), true);
  assert.equal(p.rewards.at(-1), 6202, 'a cooked fishlike thing');
  p.slots[1] = new Item(6202, 1);
  assert.equal(fireRaw(h, 'itemOnObject', { player: p, itemId: 6202,
    object: { getId: () => 23113, getLocation: () => new Location(2524, 4779, 0) } }), true);
  assert.equal(p.rewards.at(-1), 6200, 'raw now');
  p.slots[1] = new Item(6200, 1);
  assert.equal(fireRaw(h, 'itemOnNpc', { player: p, itemId: 6200, npcId: N.EVIL_BOB_2 }), true);
  assert.equal(session.data.asleep, true);
  p.levels.set(apiSkillMagic(h), 1);
  assert.equal(fireRaw(h, 'objectRaw', { player: p, object: { getId: () => 23115,
    getLocation: () => new Location(2523, 4777, 0) } }), true);
  assert.equal(p.xp.get(apiSkillFishing(h)), 650);
  assert.equal(Teleports.sessionOf(p), undefined);
});

function apiSkillMagic(h) { return h.api.core.Skill.MAGIC; }
function apiSkillFishing(h) { return h.api.core.Skill.FISHING; }

test('Prison Pete pays out after three correct balloon keys', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 17);
  h.hooks['Evil Bob']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  for (let round = 0; round < 3; round++) {
    assert.equal(fireRaw(h, 'objectRaw', { player: p,
      object: { getId: () => 24296, getLocation: () => new Location(2094, 4464, 0) } }), true);
    h.ticks(6);
    assert.equal(p.interfaceId, 273, 'lever preview remains visible for six ticks');
    h.ticks(1);
    assert.equal(p.interfaceId, -1, 'session timer still closes the lever preview at seven ticks');
    const needed = session.data.required;
    const balloon = session.data.balloons.find(entry => entry.shape === needed.shape);
    assert.equal(fireNpcClick(h, balloon.id, 1, { player: p, npc: balloon.npc, npcId: balloon.id }), true);
    assert.equal(session.data.keyCorrect, true);
    p.slots[0] = new Item(6966, 1);
    assert.equal(fireRaw(h, 'itemOnNpc', { player: p, itemId: 6966, npcId: N.PRISON_PETE }), true);
  }
  assert.equal(session.data.correct, 3);
  h.hooks['Prison Pete']['Talk-to']({ player: p, npc: { getId: () => N.PRISON_PETE }, handled: false });
  assert.notEqual(p.rewards.at(-1), 6966, 'the key was handed over, not kept');
  assert.ok(p.rewards.length >= 1);
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('rewards that no longer fit drop at the return tile, not inside the event', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 10);
  h.hooks['Bee keeper']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  for (let slot = 0; slot < 27; slot++) p.slots[slot] = new Item(I.SHARK, 1);
  p.free = 1;
  Teleports.finish(session, { reward: [{ id: I.LAMP, amount: 1 }, { id: 25129, amount: 1 }] });
  assert.equal(p.location.getX(), 3222, 'home again');
  assert.equal(h.drops.length, 2);
  for (const drop of h.drops) {
    assert.ok(drop.getPosition().equals(p.location), 'dropped beside the return tile');
  }
  assert.deepEqual(p.rewards, [], 'nothing squeezed into the inventory');
});

test('Evil twin catches the matching suspect within two grabs and pays gems', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 18);
  h.hooks['Postie Pete']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  h.hooks['object:Control panel'].Operate({ player: p, handled: false,
    object: { getId: () => 20813, getLocation: () => new Location(1870, 5135, 0) } });
  const twinIndex = session.data.suspects.findIndex(entry => entry.npc === session.data.twin.npc);
  session.data.claw = (twinIndex + 1) % 4;
  h.emit('InterfaceActionClick', { player: p, buttonId: (277 << 16) | 3, action: 1 });
  assert.match(p.messages.at(-1), /innocent/);
  session.data.claw = twinIndex;
  h.emit('InterfaceActionClick', { player: p, buttonId: (277 << 16) | 3, action: 1 });
  assert.equal(session.data.caught, true);
  h.hooks.Molly['Talk-to']({ player: p, npc: session.molly, handled: false });
  assert.equal(p.rewards.length, 1);
  assert.ok([1624, 1622, 1620, 1618].includes(p.rewards[0]), 'noted uncut gems');
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Maze chests cost potential, the shrine pays and timeouts leave empty-handed', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 19);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  assert.equal(session.data.potential, 100);
  h.hooks['object:Chest'].Open({ player: p, handled: false,
    object: { getId: () => 14986, getType: () => 10, getFace: () => 0, getPrivateArea: () => null,
      getLocation: () => new Location(2890, 4599, 0) } });
  assert.equal(session.data.potential, 99);
  assert.equal(p.rewards.length, 1);
  p.totalLevel = 1000;
  h.hooks['object:Strange shrine'].Touch({ player: p, handled: false,
    object: { getId: () => 14985, getLocation: () => new Location(2911, 4575, 0) } });
  assert.equal(p.rewards.length, 4, 'three shrine rolls after the chest');
  assert.equal(Teleports.sessionOf(p), undefined);
  const q = h.player(), expired = h.spawn(q, 19);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: q, npc: expired, handled: false });
  choose(h, q, 0);
  h.advance(500 * 3000);
  h.emit('PlayerProcess', { player: q });
  assert.deepEqual(q.rewards, []);
  assert.equal(Teleports.sessionOf(q), undefined);
});

const MIME_EMOTES = ['Think', 'Laugh', 'Climb rope', 'Glass box', 'Cry', 'Dance', 'Lean', 'Glass wall'];
test('Mime copies four performances, crying on the wrong emote', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 20);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  assert.notEqual(p.chatboxGroupId, 188, 'watch the performance before choosing');
  const early = MIME_EMOTES.indexOf(session.data.emote.name);
  h.emit('InterfaceActionClick', { player: p, buttonId: (188 << 16) | (2 + early), action: 1 });
  assert.equal(session.data.correct, 0, 'early packets cannot answer');
  h.ticks(3); // Cry: cache sequence 860 is 88 client cycles, rounded to 3 game ticks.
  assert.equal(p.chatboxGroupId, 188);
  assert.notEqual(p.interfaceId, 188, 'emote choices belong in the chatbox');
  const wrong = MIME_EMOTES.findIndex(name => name !== session.data.emote.name);
  h.emit('InterfaceActionClick', { player: p, buttonId: (188 << 16) | (2 + wrong), action: 1 });
  assert.equal(session.data.correct, 0);
  assert.equal(p.animation, 860);
  assert.notEqual(p.chatboxGroupId, 188, 'hide choices during the reaction');
  h.ticks(3);
  for (let i = 0; i < 4; i++) {
    const index = MIME_EMOTES.indexOf(session.data.emote.name);
    h.emit('InterfaceActionClick', { player: p, buttonId: (188 << 16) | (2 + index), action: 1 });
    h.emit('InterfaceActionClick', { player: p, buttonId: (188 << 16) | (2 + index), action: 1 });
    assert.equal(session.data.correct, i + 1, 'one accepted answer per performance');
    assert.equal(p.animation, 862);
    assert.notEqual(p.chatboxGroupId, 188);
    h.ticks(4); // Client advances after cycle > frame length, including at the final frame.
    assert.equal(p.rewards.length, 0, 'finish waits until Cheer has ended');
    assert.notEqual(p.chatboxGroupId, 188);
    h.ticks(1);
    if (i < 3) { assert.notEqual(p.chatboxGroupId, 188); h.ticks(3); }
  }
  assert.ok(p.rewards.includes(3057) || p.rewards.includes(I.LAMP));
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.equal(p.rewards.length, 1);
  h.ticks(100);
  assert.equal(p.rewards.length, 1);
});

test('Mime finds the stage NPC after arrival and waits for each cache animation', t => {
  const h = harness(t), p = h.player();
  const mime = h.api.spawnNpc({ id: N.MIME, x: 2011, y: 4762, z: 0 });
  h.api.getWorld = () => ({ getNpcsNear(location, radius) {
    return location.getDistance(mime.getLocation()) <= radius ? [mime] : [];
  } });
  // Cache 241 lengths in component order, rounded up from 30 client cycles per game tick.
  for (const [index, animation, ticks] of [[0,857,4], [1,861,3], [2,1130,6], [3,1131,3],
    [4,860,3], [5,866,7], [6,1129,6], [7,1128,7]]) {
    const npc = h.spawn(p, 20);
    h.random((index + 0.1) / 8);
    h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
    choose(h, p, 0);
    assert.equal(mime.animation, animation, 'real stage NPC performs the chosen emote');
    assert.ok(!p.messages.some(message => /The mime performs:/.test(message)));
    h.ticks(ticks - 1);
    assert.notEqual(p.chatboxGroupId, 188, 'prompt stays hidden until the final tick');
    h.ticks(1);
    assert.equal(p.chatboxGroupId, 188);
    Teleports.finish(Teleports.sessionOf(p));
  }
});

for (const exit of ['depart', 'logout', 'replacement', 'shutdown']) {
  test(`Mime cancels a pending demonstration on ${exit}`, t => {
    const h = harness(t), p = h.player(), npc = h.spawn(p, 20);
    h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
    choose(h, p, 0);
    const session = Teleports.sessionOf(p);
    assert.equal(h.tasks.filter(task => task.isRunning()).length, 1, 'demonstration owns a pending completion');
    if (exit === 'depart') Teleports.departed(p, false);
    if (exit === 'logout') h.emit('PlayerLogout', { player: p });
    if (exit === 'shutdown') h.emit('ServerShutdown');
    if (exit === 'replacement') {
      Teleports.begin({ player: p, npc, definition: {} }, { kind: 'quiz', arrive: { x: 1953, y: 4768 } });
    }
    h.ticks(100);
    assert.notEqual(p.chatboxGroupId, 188, 'stale task never reopens the prompt');
    assert.ok(h.tasks.every(task => task.isStopped()), 'session stops its scheduled tasks');
    assert.equal(session.data.correct, 0);
    assert.deepEqual(p.rewards, []);
  });
}

test('Mime closes an open answer on departure and cancels the final reward on logout', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 20);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  h.ticks(3);
  assert.equal(p.chatboxGroupId, 188);
  Teleports.departed(p, false);
  assert.equal(p.chatboxGroupId, -1);

  const q = h.player(), invitation = h.spawn(q, 20);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: q, npc: invitation, handled: false });
  choose(h, q, 0);
  const session = Teleports.sessionOf(q);
  for (let round = 0; round < 4; round++) {
    h.ticks(3);
    const index = MIME_EMOTES.indexOf(session.data.emote.name);
    h.emit('InterfaceActionClick', { player: q, buttonId: (188 << 16) | (2 + index), action: 1 });
    if (round < 3) h.ticks(5);
  }
  assert.equal(session.data.correct, 4);
  h.emit('PlayerLogout', { player: q });
  h.ticks(100);
  assert.equal(Teleports.sessionOf(q), undefined);
  assert.deepEqual(q.rewards, [], 'logging out during the final reaction does not grant a stale reward');
  assert.equal(q.chatboxGroupId, -1);
});

test('Pillory picks the matching key three times, wrong picks add locks', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 21);
  h.hooks['Pillory Guard']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  assert.equal(session.data.locks, 3);
  const wrong = session.data.keys.findIndex(key => key !== session.data.target);
  h.emit('InterfaceActionClick', { player: p, buttonId: (27 << 16) | (7 + wrong), action: 1 });
  assert.equal(session.data.locks, 4);
  assert.equal(session.data.opened, 0);
  for (let pick = 0; pick < 4; pick++) {
    const right = session.data.keys.findIndex(key => key === session.data.target);
    h.emit('InterfaceActionClick', { player: p, buttonId: (27 << 16) | (7 + right), action: 1 });
  }
  assert.equal(p.rewards.length, 1);
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Surprise Exam passes three pattern questions and the door pays the book', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 22);
  h.hooks.Dunce['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  for (let question = 0; question < 3; question++) {
    const index = session.data.pattern.choices.indexOf(session.data.pattern.answer);
    h.emit('InterfaceActionClick', { player: p, buttonId: (103 << 16) | (15 + index * 2), action: 1 });
  }
  assert.equal(session.data.passed, true);
  h.hooks['object:Door'].Open({ player: p, handled: false,
    object: { getId: () => 9316, getLocation: () => new Location(1881, 5022, 0) } });
  assert.ok(p.rewards.includes(I.BOOK_OF_KNOWLEDGE));
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Surprise Exam fails after three wrong answers and pays nothing at the door', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 22);
  h.hooks.Dunce['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  const session = Teleports.sessionOf(p);
  for (let wrong = 0; wrong < 3; wrong++) {
    const index = session.data.pattern.choices.findIndex(item => item !== session.data.pattern.answer);
    h.emit('InterfaceActionClick', { player: p, buttonId: (103 << 16) | (15 + index * 2), action: 1 });
  }
  assert.equal(session.data.passed, false);
  assert.equal(session.data.wrong, 3);
  h.hooks['object:Door'].Open({ player: p, handled: false,
    object: { getId: () => 9316, getLocation: () => new Location(1881, 5022, 0) } });
  assert.deepEqual(p.rewards, []);
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Mystery boxes roll the stale baguette first and the world-appropriate table', t => {
  const MysteryBox = require('../plugins/npcs/random-events/MysteryBox.RandomEvents');
  const h = harness(t, false);
  h.random(1 / 512);
  assert.equal(MysteryBox.roll(h.api)[0].id, I.STALE_BAGUETTE);
  h.random(0.5);
  assert.ok(![I.BOOK_OF_KNOWLEDGE].includes(MysteryBox.roll(h.api)[0].id));
  const members = harness(t, true);
  members.random(0.5);
  assert.ok(MysteryBox.roll(members.api)[0].id > 0);
});

test('Book of Knowledge grants 15 times the level and keeps itself when XP is blocked', t => {
  const h = harness(t), p = h.player(), slot = 4;
  p.levels.set(Skill.values()[0], 10);
  p.slots[slot] = new Item(I.BOOK_OF_KNOWLEDGE, 1);
  const event = { player: p, item: p.slots[slot], itemId: I.BOOK_OF_KNOWLEDGE, slot, handled: false };
  assert.equal(h.hooks['Book of Knowledge'].Read(event), true);
  const request = h.xpRewards.at(-1);
  assert.equal(request.onConfirm(Skill.values()[0]), 'You have been awarded 150 Attack XP!');
  assert.equal(p.xp.get(Skill.values()[0]), 150);
  assert.equal(p.slots[slot], undefined);
});
