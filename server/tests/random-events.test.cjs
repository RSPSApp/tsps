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
const Locations = require('../plugins/npcs/random-events/Locations.RandomEvents');
const Pinball = require('../plugins/npcs/random-events/Pinball.RandomEvents');
const JekyllPlugin = require('../plugins/npcs/DrJekyll.plugin');
const Gift = require('../plugins/npcs/random-events/GiftRewards.RandomEvents');
const PlantPlugin = require('../plugins/npcs/StrangePlant.plugin');
const { Animation } = require('../dist/game/model/Animation');
const { Graphic } = require('../dist/game/model/Graphic');
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

const NPC_NAMES = { [N.NILES]: 'Niles', [N.RICK_TURPENTINE]: 'Rick Turpentine', [N.GENIE]: 'Genie', [N.SANDWICH_LADY]: 'Sandwich lady' };
const ITEM_NAMES = { [I.LAMP]: 'Lamp', [I.BEER]: 'Beer', [I.KEBAB]: 'Kebab', [I.COINS]: 'Coins',
  [I.MEAT_PIE]: 'Meat pie', [I.STRANGE_FRUIT]: 'Strange fruit', [I.CAMO_TOP]: 'Camo top',
  [I.SAPPHIRE_2]: 'Sapphire', [I.EMERALD_2]: 'Emerald', [I.RUBY_2]: 'Ruby', [I.DIAMOND_2]: 'Diamond' };
const UNTRADEABLE = new Set([I.CAMO_TOP]);
// Coins plus the runes, feathers and arrows the Maze pays: rewards that stack live.
const STACKABLE = new Set([I.COINS, I.FEATHER, I.IRON_ARROW, I.STEEL_ARROW, I.DEATH_RUNE,
  I.CHAOS_RUNE, I.NATURE_RUNE, I.AIR_RUNE, I.WATER_RUNE, I.EARTH_RUNE, I.FIRE_RUNE, I.BRONZE_DART_TIP, I.BRONZE_BOLTS]);

const REWARD = (amount, name) => `Your reward is: <col=ff0000>${amount}</col> x <col=ff0000>${name}</col>.`;
const PLACED = (amount, name) =>
  `Your reward is: <col=ff0000>${amount}</col> x <col=ff0000>${name}</col> - it has been placed <col=ff0000>on the ground</col>.`;
const npcLines = p => [...(p.dialogue?.getDialogues?.().values() ?? [])].map(entry => entry.getText?.()).filter(Boolean);

/** A served event's NPC lingers on its 10-tick beat; this runs past the longest such wait. */
const leaves = (h, p) => { h.advance(13_000); h.emit('PlayerProcess', { player: p }); };

function trayClick(h, p, model, action = 1) {
  const index = [6, 7, 8, 9, 10, 11, 12].findIndex(child => p.models?.get((297 << 16) | child) === model);
  assert.notEqual(index, -1, `tray model ${model}`);
  h.emit('InterfaceActionClick', { player: p, buttonId: (297 << 16) | (6 + index), action });
}

function harness(t, members = true) {
  let now = 1_000, random = 0.5;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Math, 'random', () => random);
  t.mock.method(Item.prototype, 'getDefinition', function () {
    return { isStackable: () => STACKABLE.has(this.getId()), getName: () => ITEM_NAMES[this.getId()] ?? `Item ${this.getId()}`,
      isTradeable: () => !UNTRADEABLE.has(this.getId()) };
  });
  const hooks = {}, npcs = [], prompts = [], drops = [], objects = [], interfaces = [];
  const custom = new Map();
  let enabled = true, blocked = () => false, movable = () => true, roof = () => false;
  const mapObjects = new Map();
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
      WorldDefinition: { isMembersWorld: () => members }, World: { getProcessCycle: () => Math.floor(now / 600), forEachNetworkPlayer() {} },
      NpcDefinition: { forId: id => ({ getName: () => NPC_NAMES[id] }) },
      Animation, Graphic, Task, PlayerRights,
      DialogueChainBuilder, NpcDialogue, PlayerDialogue, StatementDialogue,
      ItemStatementDialogue, EndDialogue, ActionDialogue, GameObject: FakeGameObject, ObjectManager,
      MapObjects: { get: () => null, mapObjects, getHash: (x, y, z) => `${x},${y},${z}` } },
    registerCommand(name, handler, rights, description) { hooks[name] = { handler, rights, description }; },
    onCustomEvent(name, cb) { custom.set(name, [...(custom.get(name) ?? []), cb]); },
    emitCustomEvent(name, event) { custom.get(name)?.forEach(cb => cb(event)); },
    getPluginConfig: () => enabled,
    persistAttribute(key, defaultValue) { persistedAttributes.set(key, defaultValue); },
    getItemOnGroundManager: () => ({ DESPAWN_DELAY: 300, registerLocation(player, item, position, privateArea, options = {}) {
      const drop = new ItemOnGround(State.SEEN_BY_PLAYER, player.getUsername(), position, item, options.goesGlobal ?? true, -1, null);
      if (options.despawnDelay != null) drop.setDespawnDelay(options.despawnDelay);
      drops.push(drop); return drop;
    } }),
    getRegionManager: () => ({ blocked: (...args) => blocked(...args), canMovestart: (...args) => movable(...args),
      getRegion: () => ({ isUnderRoof: (...args) => roof(...args) }) }),
    getWorld: () => ({ getNpcsNear: () => npcs }),
    getTaskManager: () => ({ submit(task) { task.setRunning(true); tasks.push(task); } }),
    registerCustomInterface(definition) { interfaces.push(definition); },
    spawnNpc(definition) {
      const npc = { definition, owner: definition.owner, ownerOnly: definition.ownerOnly,
        location: new Location(definition.x, definition.y, definition.z),
        getOwner() { return this.owner; }, getId() { return definition.id; }, isOwnerOnly() { return !!this.ownerOnly; },
        getDefinition() { return { getId: () => definition.id }; }, getLocation() { return this.location; },
        setFollowing(p) { this.following = p; }, setMobileInteraction(p) { this.interaction = p; },
        setFace(face) { this.face = face; }, getFace() { return this.face; },
        forceChat(text) { this.chat = text; }, performAnimation(animation) { this.animation = animation.getId(); },
        setHitpoints(hp) { this.hitpoints = hp; }, setNpcTransformationId(id) { this.transformation = id; },
        setPositionToFace(location) { this.faced = location; }, performGraphic(graphic) { this.graphic = graphic.id; } };
      if (Number.isFinite(definition.face)) npc.setFace(definition.face);
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
    onObjectRoute(handler) { (hooks.objectRoute ??= []).push(handler); },
    onGroundItemPickup(handler) { (hooks.groundPickup ??= []).push(handler); },
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
      getAppearance: () => ({ isMale: () => !p.female }),
      getInterfaceId: () => p.interfaceId, setInterfaceId(id) { p.interfaceId = id; },
      sendMessage: text => messages.push(text), forceChat(text) { p.chat = text; },
      setNpcTransformationId(id) { p.transformation = id; },
      performAnimation(animation) { p.animation = animation.getId(); },
      setPositionToFace(location) { p.face = location; },
      moveTo(location) { p.location = location; }, setLocation(location) { p.location = location; },
      getEquipment: () => ({ containsNumber: () => false }),
      getBank: () => ({ containsNumber: () => false }),
      getDialogueManager: () => ({
        startDialogues(builder) { p.dialogue = builder; },
        isActive: () => !!p.dialogue,
      }),
      getInventory: () => ({ get: slot => slots[slot], getItems: () => slots, getFreeSlots: () => p.free,
        containsNumber: id => slots.some(item => item?.getId() === id && item.getAmount() > 0),
        getAddableAmount(item) {
          if (!item.getDefinition().isStackable()) return Math.min(item.getAmount(), p.free);
          const stack = slots.find(slot => slot?.getId() === item.getId());
          if (stack) return Math.min(item.getAmount(), Math.max(0, 2_147_483_647 - stack.getAmount()));
          return p.free > 0 ? item.getAmount() : 0;
        },
        addItem(item) {
          rewards.push(item.getId()); rewardItems.push(item);
          if (!item.getDefinition().isStackable() || !slots.some(slot => slot?.getId() === item.getId())) p.free--;
        },
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
      getSpellbook: () => ({ getInterfaceId: () => 218 }),
      getPacketSender: () => ({ closeSubInterface() {}, sendTabInterface() {}, sendInterface(id) { p.interfaceId = id; },
        sendInterfaceRemoval() { p.interfaceId = -1; p.chatboxGroupId = -1; }, sendString(text, uid) {
          p.trayTitle = text; (p.strings ??= new Map()).set(uid, text);
        },
        sendItemOnInterfaces(uid, id) { (p.tray ??= []).push([uid, id]); },
        sendInterfaceRawModel(uid, model) { (p.models ??= new Map()).set(uid, model); },
        sendInterfaceDisplayState() {}, sendSubInterface() {}, sendConfig(id, value) { (p.configs ??= new Map()).set(id, value); },
        sendVarbit(id, value) { (p.varbits ??= new Map()).set(id, value); },
        sendInterfaceScript() {}, sendChatboxInterface(id) { p.chatboxGroupId = id; }, sendClientScript() {},
        isChatboxInterface(id) { return p.chatboxGroupId === id; },
        sendInterfaceAnimation() {}, sendSound() {}, sendGraphic() {}, sendAreaSound() {},
        sendGlobalGraphic(graphic, tile) { (p.smokes ??= []).push([graphic.id, tile]); },
        sendTypedMessage(type, text, from) { (p.typed ??= []).push([type, text, from]); },
        sendObjectAnimation(object, animation) { (p.objectAnimations ??= []).push([object, animation.getId()]); },
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
    roof: value => { roof = value; }, mapObjects,
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
  p.area = { getName: () => 'UnknownArea' };
  h.emit('PlayerLogin', { player: p }); h.advance(121 * 60_000); h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.length, 0);
  assert.ok(p.getAttribute('random-events:next-at') > Date.now());
});

test('bank roof footprints block natural spawns, leave the street eligible, and respect plane and roof gaps', t => {
  const h = harness(t);
  h.roof(() => true);
  for (const [x, y, z, blocked] of [[3093, 3244, 0, true], [3085, 3244, 0, false],
    [3209, 3219, 2, true], [3209, 3219, 0, false]]) {
    const p = h.player(); p.location = new Location(x, y, z);
    h.emit('PlayerLogin', { player: p }); h.advance(121 * 60_000);
    const before = h.npcs.length;
    h.emit('PlayerProcess', { player: p });
    assert.equal(h.npcs.length > before, !blocked, `${x},${y},${z}`);
    assert.ok(p.getAttribute('random-events:next-at') > Date.now(), 'a blocked due opportunity rearms the clock');
  }
  h.roof(() => false);
  const p = h.player(); p.location = new Location(3093, 3244, 0);
  assert.equal(Locations.bank(h.api, p), false, 'a bounding box does not classify unroofed gaps as indoors');
});

test('Grand Exchange paving blocks invitations, with grass corners and other floors left eligible', t => {
  const h = harness(t), p = h.player();
  for (const [x, y, z, allowed] of [[3164, 3487, 0, false], [3145, 3489, 0, false],
    [3144, 3489, 0, true], [3145, 3506, 0, true], [3164, 3487, 1, true]]) {
    p.location = new Location(x, y, z);
    assert.equal(Locations.available(h.api, { kind: 'genie' }, p), allowed, `${x},${y},${z}`);
  }
  p.location = new Location(3164, 3487, 0);
  h.emit('PlayerLogin', { player: p }); h.advance(121 * 60_000);
  h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.length, 0);
  assert.ok(p.getAttribute('random-events:next-at') > Date.now());
});

test('bank chest standing tiles block spawns while named bank exceptions remain eligible', t => {
  const h = harness(t), p = h.player();
  const chest = { getDefinition: () => ({ getName: () => 'Bank chest' }) };
  for (const [x, y, z, expected] of [[3308, 3120, 0, true], [3374, 11493, 0, false],
    [2465, 2848, 1, false], [3043, 4970, 1, false]]) {
    p.location = new Location(x, y, z);
    h.mapObjects.set(`${x + 1},${y},${z}`, [chest]);
    assert.equal(Locations.bank(h.api, p), expected, `${x},${y},${z}`);
  }
  p.location = new Location(3306, 3120, 0);
  assert.equal(Locations.bank(h.api, p), false, 'the chest does not suppress the surrounding settlement');
});

test('only Genie, Count Check and Jekyll follow into an ordinary bank, and invalidated invitations cannot reward', t => {
  const h = harness(t);
  h.roof(() => true);
  for (const [index, name, survives] of [[0, 'Genie', true], [7, 'Count Check', true],
    [6, 'Dr Jekyll', true], [2, 'Drunken Dwarf', false], [20, 'Mysterious Old Man', false]]) {
    const p = h.player(); p.location = new Location(3085, 3244, 0);
    const npc = h.spawn(p, index);
    p.location = new Location(3087, 3244, 0);
    assert.equal(Events.valid(Events.activeFor(p), p), survives, name);
    if (!survives) {
      h.hooks[name]['Talk-to']({ player: p, npc });
      assert.deepEqual(p.rewards, []);
    }
    h.emit('PlayerProcess', { player: p });
    assert.equal(!!npc.removed, !survives, name);
    const before = h.npcs.length;
    h.hooks.randevt.handler({ player: p, parts: ['randevt', String(index)] });
    assert.equal(h.npcs.length, before, 'the testing command also refuses a new bank invitation');
  }
});

test('the four original Hunter biomes exclude teleport events without suppressing harmless events or later hunting grounds', t => {
  const h = harness(t), p = h.player();
  for (const [x, y] of [[2556, 2914], [2315, 3545], [2714, 3765], [3402, 3095]]) {
    p.location = new Location(x, y, 0);
    assert.equal(Locations.available(h.api, { kind: 'mime' }, p), false);
    assert.equal(Locations.available(h.api, { kind: 'genie' }, p), true);
    h.hooks.randevt.handler({ player: p, parts: ['randevt', '20'] });
    assert.equal(h.npcs.length, 0, 'a forbidden invitation cannot be forced by the command');
  }
  for (const [x, y] of [[1565, 3030], [2269, 3413], [3287, 2739]]) {
    p.location = new Location(x, y, 0);
    assert.equal(Locations.available(h.api, { kind: 'mime' }, p), true, 'later Hunter areas retain teleport events');
  }
  p.location = new Location(2556, 2914, 1);
  assert.equal(Locations.available(h.api, { kind: 'mime' }, p), true, 'Hunter ground restrictions are per plane');
});

test('safe managed areas allow events; underwater and Kalphite Lair use their reduced pools', t => {
  const h = harness(t), p = h.player();
  for (const name of ['GiantsFoundry', 'DarkArea', 'DogQuestArea']) {
    p.area = { getName: () => name };
    assert.equal(Locations.available(h.api, { kind: 'mime' }, p), true, name);
  }
  p.area = { pluginName: 'Quests', getName: () => 'DogQuestArea' };
  p.location = new Location(3185, 3440, 0);
  h.roof(() => true);
  assert.equal(Locations.available(h.api, { kind: 'genie' }, p), false, 'a passive quest Area does not bypass its bank exclusion');
  p.area = { pluginName: 'Quests', getName: () => 'VanstromArena' };
  p.location = new Location(3222, 3218, 0);
  assert.equal(Locations.available(h.api, { kind: 'genie' }, p), false, 'the shared Quests owner does not permit an unrelated arena');
  p.area = undefined;
  for (const [x, y, z, kinds] of [[3732, 10281, 1, ['genie', 'countcheck', 'jekyll', 'certer', 'gift']],
    [3480, 9500, 0, ['genie', 'countcheck', 'jekyll', 'certer', 'gift', 'dwarf', 'drill', 'plant']]]) {
    p.location = new Location(x, y, z);
    for (const kind of ['genie', 'countcheck', 'jekyll', 'certer', 'gift', 'dwarf', 'drill', 'plant', 'sandwich', 'mime', 'maze']) {
      assert.equal(Locations.available(h.api, { kind }, p), kinds.includes(kind), `${x},${y},${z}: ${kind}`);
    }
  }
});

test('real Slayer Tower and Creature Creation Areas permit natural invitations, commands and followers', t => {
  const h = harness(t);
  const { Area } = require('../dist/game/model/areas/Area');
  const { Boundary } = require('../dist/game/model/Boundary');
  const areas = [], startup = [];
  const areaApi = new Proxy({
    core: { Area, Boundary },
    registerArea(area) { areas.push(area); },
    onServerStartup(handler) { startup.push(handler); },
  }, { get(target, name) { return target[name] ?? (() => {}); } });
  require('../plugins/areas/SlayerTower.plugin').register(areaApi);
  require('../plugins/minigames/CreatureCreation.plugin').register(areaApi);
  startup.forEach(handler => handler());
  assert.equal(areas.length, 2);
  for (const area of areas) {
    const p = h.player(), bounds = area.getBoundaries()[0];
    p.location = new Location(Math.floor((bounds.getX() + bounds.getX2()) / 2),
      Math.floor((bounds.getY() + bounds.getY2()) / 2), bounds.height);
    const follower = h.spawn(p, 0);
    p.area = area;
    h.emit('PlayerProcess', { player: p });
    assert.equal(follower.removed, undefined, `${area.getName()} retains its owned invitation`);
    h.hooks.Genie.Dismiss({ player: p, npc: follower });
    const before = h.npcs.length;
    const natural = h.spawn(p, 0);
    assert.equal(h.npcs.length, before + 1, `${area.getName()} creates a fresh invitation`);
    assert.equal(natural?.getId(), N.GENIE, `${area.getName()} permits natural scheduling`);
    h.hooks.randevt.handler({ player: p, parts: ['randevt', '20'] });
    assert.match(p.messages.at(-1), /Spawned random event 20/, `${area.getName()} permits the test command`);
  }
});

test('advance_time reaches the real scheduler and expires its invitation', t => {
  const h = harness(t), p = h.player();
  h.emit('PlayerLogin', { player: p });
  const request = { player: p, ms: 121 * 60_000, handledBy: [] };
  h.api.emitCustomEvent('agent:advance-time', request);
  assert.deepEqual(request.handledBy, ['RandomEvents']);
  h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.length, 1);
  h.api.emitCustomEvent('agent:advance-time', { player: p, ms: 60_000, handledBy: [] });
  h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs[0].chat, 'Maybe later.');
  h.api.emitCustomEvent('agent:advance-time', { player: p, ms: 1_800, handledBy: [] });
  h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs[0].removed, true);
});

test('bank footprint classification matches the active cache, including the street and Lumbridge floor', async () => {
  const path = require('node:path');
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  if (!CachePipeline.isInitialized()) await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
  const api = { core: { MapObjects }, getRegionManager: () => RegionManager };
  for (const [x, y, z, expected] of [[3093, 3244, 0, true], [3085, 3244, 0, false],
    [3185, 3440, 0, true], [3192, 3440, 0, false], [3209, 3219, 2, true],
    [3209, 3219, 0, false], [3308, 3120, 0, true], [2465, 2848, 1, false]]) {
    RegionManager.loadMapFiles(x, y);
    assert.equal(Locations.bank(api, { getLocation: () => new Location(x, y, z) }), expected, `${x},${y},${z}`);
  }
});

test('Grand Exchange footprint samples use the active cache plaza and paving, excluding grass', async () => {
  const path = require('node:path');
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { CacheMaps } = require('../dist/game/cache/CacheMaps');
  if (!CachePipeline.isInitialized()) await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const terrain = require('../plugins/agent/mcp/EditTerrain.AgentMcp')({
    core: { CachePipeline, CacheMaps, MapRegionReplacementManager: { getReplacementMapData: () => null } },
    z: require('zod').z, tool() {},
  });
  assert.equal(terrain.tileAt(3164, 3487, 0).underlay, 55);
  assert.equal(terrain.tileAt(3145, 3489, 0).overlay.id, 173);
  for (const [x, y] of [[3144, 3489], [3145, 3506]]) {
    const tile = terrain.tileAt(x, y, 0);
    assert.equal(tile.overlay, null);
    assert.notEqual(tile.underlay, 55, 'the grass corners are outside the plaza');
  }
});

test('randevt is described and owner-only, selects each index immediately and replaces the owned event', t => {
  const h = harness(t), p = h.player(), command = h.hooks.randevt;
  assert.equal(command.rights, PlayerRights.OWNER);
  assert.match(command.description, /zero-based event index/);
  h.disable();
  const ids = [N.GENIE, N.SANDWICH_LADY, N.DRUNKEN_DWARF, N.RICK_TURPENTINE,
    N.MILES, N.MYSTERIOUS_OLD_MAN_2, N.DR_JEKYLL, N.COUNT_CHECK_2, null, N.CAPT_ARNAV,
    N.BEE_KEEPER_2, N.QUIZ_MASTER_2, N.SERGEANT_DAMIEN_2, N.FREAKY_FORESTER_2, N.LEO_2,
    N.FLIPPA_2, N.EVIL_BOB, N.EVIL_BOB_3, N.POSTIE_PETE_2, N.MYSTERIOUS_OLD_MAN_4,
    N.MYSTERIOUS_OLD_MAN_5, N.PILLORY_GUARD, N.DUNCE_2, N.STRANGE_PLANT];
  let previous;
  ids.forEach((id, index) => {
    const event = { player: p, parts: ['randevt', String(index)], handled: false };
    command.handler(event);
    assert.equal(event.handled, true);
    let npc = h.npcs.at(-1);
    if (id === null) {
      npc = h.npcs.slice(-6).find(entry => entry.definition.id === N.FROG_7);
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

test('Genie and dwarf deny other players, put what does not fit on the ground and grant only once', t => {
  const h = harness(t);
  // Live, the dwarf with one free slot: the beer goes in, the kebab is placed on the ground.
  for (const [kind, name, expected, line] of [
    [0, 'Genie', [I.LAMP], "Ah, so you are there, Master Player. I'm so glad you summoned me. Please take this lamp and make your wish."],
    [2, 'Drunken Dwarf', [I.BEER, I.KEBAB], "I 'new it were you matey! 'Ere, have some ob the good<br>stuff!"]]) {
    const p = h.player(), other = h.player(), npc = h.spawn(p, kind);
    assert.equal(npc.definition.id, kind === 0 ? N.GENIE : N.DRUNKEN_DWARF);
    h.hooks[name]['Talk-to']({ player: other, npc }); h.hooks[name].Dismiss({ player: other, npc });
    assert.deepEqual(other.rewards, []); assert.equal(npc.removed, undefined);
    npc.owner = other; h.hooks[name]['Talk-to']({ player: p, npc }); assert.deepEqual(p.rewards, []); npc.owner = p;
    const dropsBefore = h.drops.length; p.messages.length = 0;
    p.free = expected.length - 1; h.hooks[name]['Talk-to']({ player: p, npc });
    assert.deepEqual(npcLines(p), [line]);
    h.hooks[name]['Talk-to']({ player: p, npc });
    assert.equal(npc.removed, undefined, 'stays until its 10-tick beat');
    assert.equal(npc.following, null, 'stops following'); leaves(h, p);
    assert.equal(npc.removed, true);
    assert.deepEqual(p.rewards, expected.slice(0, -1));
    assert.equal(h.drops.length, dropsBefore + 1, 'only the item that did not fit is dropped');
    const drop = h.drops.at(-1), last = ITEM_NAMES[expected.at(-1)];
    assert.equal(drop.getItem().getId(), expected.at(-1)); assert.equal(drop.getOwner(), p.getUsername());
    assert.equal(drop.getDespawnDelay(), 18_000); assert.equal(drop.getgoesGlobal(), true);
    assert.ok(drop.getPosition().equals(p.location));
    assert.deepEqual(p.messages, [...expected.slice(0, -1).map(id => REWARD(1, ITEM_NAMES[id])), PLACED(1, last)]);
    assert.deepEqual(npcLines(p).length, 1, 'talking again while leaving is his leaving line');
  }
});

test('every event delivers real inventory items and refreshes the container exactly once per reward', t => {
  const h = harness(t);
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
  t.mock.method(ItemDefinition, 'forId', id => ({ isStackable: () => id === I.COINS }));
  for (const [index, name, expected] of [[0, 'Genie', [[I.LAMP, 1]]],
    [1, 'Sandwich lady', [[I.BAGUETTE, 1]]], [2, 'Drunken Dwarf', [[I.BEER, 1], [I.KEBAB, 1]]],
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
    if (index === 1) openOptions(h, p);
    if (index === 1) trayClick(h, p, 10726);
    if (index === 4) certerChoice(h, p, 'An axe.');
    if (index === 6) openOptions(h, p);
    interact(); leaves(h, p);
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
    if (index === 6) { openOptions(h, p); h.prompts.at(-1).options[0].cb(); openOptions(h, p); }
    assert.equal(inventory.get(5).getId(), index === 3 ? I.COINS : I.STAMINA_POTION_4_);
    assert.equal(inventory.get(5).getAmount(), index === 3 ? 90 : 1);
    leaves(h, p); assert.equal(inventory.getFreeSlots(), 0); assert.equal(npc.removed, true);
  }
});

test('Sandwich tray validates owner, selection and open interface, with a wrong pick ending it and stale roll', t => {
  const h = harness(t), p = h.player(), other = h.player(), npc = h.spawn(p, 1, 0);
  const click = (player, index, action = 1) => h.emit('InterfaceActionClick', { player, buttonId: (297 << 16) | (6 + index), action });
  click(p, 0); assert.deepEqual(p.rewards, []);
  h.hooks['Sandwich lady']['Talk-to']({ player: p, npc });
  // Live offers the food in a dialogue first; the tray opens when it is continued.
  assert.equal(p.tray, undefined);
  assert.deepEqual(npcLines(p), ['You look hungry to me. I tell you what -<br>have a baguette on me.']);
  openOptions(h, p);
  // Raw tray models, all seven foods, as captured; no invented item or flags packets.
  assert.deepEqual([...p.models.values()].sort(), [10726, 10727, 10728, 10729, 10730, 10731, 10732]);
  assert.equal(p.trayTitle, 'Have a baguette for free!');
  assert.equal(p.tray, undefined); assert.equal(p.flags, undefined);
  trayClick(h, p, 10726, 2); assert.deepEqual(p.rewards, []);
  other.interfaceId = 297; click(other, 0); assert.deepEqual(p.rewards, []); assert.equal(npc.removed, undefined);
  h.random(0); trayClick(h, p, 10726); trayClick(h, p, 10726);
  assert.deepEqual(p.rewards, [I.STALE_BAGUETTE]); assert.equal(p.interfaceId, -1);
  assert.deepEqual(npcLines(p), ['Hope that fills you up!']);
  const normal = h.player(), npc2 = h.spawn(normal, 1, 0);
  h.hooks['Sandwich lady']['Talk-to']({ player: normal, npc: npc2 }); openOptions(h, normal);
  h.random(1 / 64); trayClick(h, normal, 10726);
  assert.deepEqual(normal.rewards, [I.BAGUETTE]);
  // The Wiki transcript's line for the wrong food; no reward and she leaves.
  const greedy = h.player(), npc4 = h.spawn(greedy, 1, 0);
  h.hooks['Sandwich lady']['Talk-to']({ player: greedy, npc: npc4 }); openOptions(h, greedy);
  trayClick(h, greedy, 10730); assert.deepEqual(greedy.rewards, []); assert.equal(greedy.interfaceId, -1);
  assert.deepEqual(npcLines(greedy), ["Hey, I didn't say you could have that!"]);
  leaves(h, greedy); assert.equal(npc4.removed, true);
  // Live: a pie that doesn't fit is placed on the ground for three hours.
  const full = h.player(), npc3 = h.spawn(full, 1, 4); full.free = 0;
  h.hooks['Sandwich lady']['Talk-to']({ player: full, npc: npc3 }); openOptions(h, full); trayClick(h, full, 10730);
  leaves(h, full); assert.deepEqual(full.rewards, []); assert.equal(npc3.removed, true);
  assert.equal(h.drops.at(-1).getItem().getId(), I.MEAT_PIE); assert.equal(h.drops.at(-1).getDespawnDelay(), 18_000);
  assert.deepEqual(full.messages, [PLACED(1, 'Meat pie')]);
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
      if (reason === 'expiry') { assert.equal(npc.chat, 'Maybe later.'); assert.equal(npc.removed, undefined); h.advance(1_800); h.emit('PlayerProcess', { player: p }); }
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

test('Rick places a gift that does not fit on the ground, denies strangers and cannot reward twice', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 3);
  assert.equal(npc.definition.id, N.RICK_TURPENTINE);
  h.hooks['Rick Turpentine']['Talk-to']({ player: h.player(), npc });
  p.free = 0; h.random(0.6); h.hooks['Rick Turpentine']['Talk-to']({ player: p, npc });
  h.random(0.99); h.hooks['Rick Turpentine']['Talk-to']({ player: p, npc });
  leaves(h, p); assert.deepEqual(p.rewards, []); assert.equal(npc.removed, true);
  assert.deepEqual(h.drops.map(drop => drop.getItem().getId()), [I.UNCUT_SAPPHIRE]);
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

const CERTER_ANSWERS = { 8828: 'An axe.', 8829: 'A fish.', 8830: 'A fish.', 8831: 'A necklace.', 8832: 'A shield.',
  8833: 'A helmet.', 8834: 'A ring.', 8835: 'A pair of shears.', 8836: 'A sword.', 8837: 'A spade.' };
const answerLabel = p => CERTER_ANSWERS[p.models.get((184 << 16) | 7)];

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
    // 552: the raw model, the answer texts with their article and full stop.
    assert.equal(p.models.get((184 << 16) | 7), 8828); assert.equal(p.tray, undefined); assert.equal(p.flags, undefined);
    assert.equal(new Set(p.strings.values()).size, 3);
    assert.ok([...p.strings.values()].includes('An axe.'));
    other.interfaceId = 184; other.strings = p.strings; certerChoice(h, other, 'An axe.');
    certerChoice(h, p, 'An axe.', 2); p.interfaceId = -1; certerChoice(h, p, 'An axe.');
    assert.deepEqual(p.rewards, []); assert.equal(npc.removed, undefined);
    h.hooks[name]['Talk-to']({ player: p, npc });
    p.free = 0; h.random(0.6); certerChoice(h, p, p.strings.get((184 << 16) | 1) && answerLabel(p));
    assert.deepEqual(npcLines(p), ['Thank you, I hope you like your present. I must be<br>leaving now though.']);
    assert.equal(p.interfaceId, -1); assert.equal(npc.animation, 863, 'waves as he leaves');
    h.random(0.99); leaves(h, p);
    assert.deepEqual(p.rewards, []); assert.equal(npc.removed, true);
    assert.equal(h.drops.at(-1).getItem().getId(), I.UNCUT_SAPPHIRE);
  }
});

test('Certer wrong answers end without a reward; expiry closes its interface', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 4);
  h.random(0); h.hooks.Niles['Talk-to']({ player: p, npc });
  certerChoice(h, p, [...p.strings.values()].find(label => label !== 'An axe.'));
  assert.deepEqual(npcLines(p), ["Sorry, that's just not the right answer!"]);
  assert.deepEqual(p.rewards, []); assert.equal(p.interfaceId, -1); assert.deepEqual(p.messages, []);
  leaves(h, p); assert.equal(npc.removed, true);
  const q = h.player(), expired = h.spawn(q, 4); h.random(0); h.hooks.Niles['Talk-to']({ player: q, npc: expired });
  h.advance(60_000); h.emit('PlayerProcess', { player: q }); certerChoice(h, q, 'An axe.');
  assert.deepEqual(q.rewards, []); assert.equal(q.interfaceId, -1);
  h.advance(1_800); h.emit('PlayerProcess', { player: q }); assert.equal(expired.removed, true);
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
    h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc }); openOptions(h, p);
    assert.equal(h.prompts.at(-1).title, 'Select an option');
    assert.deepEqual(h.prompts.at(-1).options.map(option => option.label), ['Here you are.', 'No, I need it myself.']);
    const yes = h.prompts.at(-1).options[0].cb;
    yes(); assert.deepEqual(npcLines(p), ['Here you are.']); assert.deepEqual(p.rewards, []);
    openOptions(h, p);
    assert.deepEqual(p.rewards, [potionId]);
    assert.deepEqual(npcLines(p), ['Thank you so much! Here, take this potion in return.']);
    yes(); openOptions(h, p); assert.deepEqual(p.rewards, [potionId], 'only once');
    leaves(h, p); assert.equal(npc.removed, true);
    assert.equal(p.slots[herbId === I.GUAM_LEAF ? 0 : 4], undefined);
  }
});

test('Jekyll ignores noted/grimy/huasca, offers a fallback and preserves refused herbs', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 6);
  p.slots[0] = new Item(I.GRIMY_TORSTOL, 1); p.slots[1] = new Item(I.TORSTOL_2, 1);
  p.slots[2] = new Item(I.HUASCA, 1); p.free = 0;
  h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc });
  // 4056: no herb to give, he asks for guam, the player has none, the spare potion.
  assert.deepEqual(npcLines(p), ["Have you got any guam leaf? I've fixed my Hyde problem, so it's not urgent, but I could do with a guam leaf.", "I don't have any."]);
  openOptions(h, p); h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc });
  leaves(h, p); assert.deepEqual(p.rewards, []); assert.equal(npc.removed, true);
  assert.deepEqual(h.drops.map(drop => drop.getItem().getId()), [I.STRENGTH_POTION_2_]);
  assert.equal(p.slots.filter(Boolean).length, 3);
  const q = h.player(), refused = h.spawn(q, 6), herb = new Item(I.TORSTOL, 1); q.slots[2] = herb;
  h.hooks['Dr Jekyll']['Talk-to']({ player: q, npc: refused }); openOptions(h, q); h.prompts.at(-1).options[1].cb(); openOptions(h, q);
  assert.equal(q.slots[2], herb); assert.deepEqual(q.rewards, [I.STRENGTH_POTION_2_]);
  assert.deepEqual(npcLines(q), ['Fair enough. Here, have a spare potion, and thanks for<br>your time.']);
});

test('Jekyll rejects strangers, moved/replaced herbs, stale prompts and replies after cleanup', t => {
  const h = harness(t);
  for (const reason of ['moved', 'swapped', 'new-prompt', 'PlayerLogout', 'PlayerDeath', 'expired', 'dismiss']) {
    const p = h.player(), npc = h.spawn(p, 6), herb = new Item(I.IRIT_LEAF, 1); p.slots[2] = herb;
    const before = h.prompts.length; h.hooks['Dr Jekyll']['Talk-to']({ player: h.player(), npc });
    assert.equal(h.prompts.length, before);
    h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc }); openOptions(h, p); const yes = h.prompts.at(-1).options[0].cb;
    if (reason === 'moved') { p.slots[3] = herb; p.slots[2] = undefined; }
    if (reason === 'swapped') p.slots[2] = new Item(I.IRIT_LEAF, 1);
    if (reason === 'new-prompt') h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc });
    if (reason.startsWith('Player')) h.emit(reason, { player: p });
    if (reason === 'expired') h.advance(60_000);
    if (reason === 'dismiss') h.hooks['Dr Jekyll'].Dismiss({ player: p, npc });
    yes(); openOptions(h, p);
    // A herb that moved during the talk can't be traded: he hands over the spare potion instead.
    const expected = reason === 'moved' || reason === 'swapped' ? [I.STRENGTH_POTION_2_] : [];
    assert.deepEqual(p.rewards, expected, reason);
    assert.equal(p.messages.some(text => /Your herb/.test(text)), false, reason);
  }
  const p = h.player(), npc = h.spawn(p, 6); p.slots[2] = new Item(I.GUAM_LEAF, 1);
  h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc }); openOptions(h, p); const oldYes = h.prompts.at(-1).options[0].cb;
  p.slots[2] = new Item(I.TORSTOL, 1); h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc });
  assert.match(npcLines(p)[0], /any torstol\?/); oldYes(); assert.deepEqual(p.rewards, []);
  h.hooks['Dr Jekyll']['Talk-to']({ player: p, npc }); openOptions(h, p); h.prompts.at(-1).options[0].cb(); openOptions(h, p);
  assert.deepEqual(p.rewards, [I.STAMINA_POTION_4_]);
});

test('Mysterious Old Man gives a single owned gift, places it on the ground when full and can be dismissed', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 5);
  assert.equal(npc.definition.id, N.MYSTERIOUS_OLD_MAN_2);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: h.player(), npc });
  p.free = 0; h.random(0.6); h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc });
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc });
  leaves(h, p); assert.deepEqual(p.rewards, []); assert.equal(npc.removed, true);
  assert.deepEqual(h.drops.map(drop => drop.getItem().getId()), [I.UNCUT_SAPPHIRE]);
  const coins = h.player(), giver = h.spawn(coins, 5); h.random(0);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: coins, npc: giver });
  assert.deepEqual(coins.rewards, [I.COINS]);
  assert.deepEqual(coins.messages, [REWARD(80, 'Coins')]);
  assert.deepEqual(npcLines(coins),
    ['Ah, so you are there. I hoped you would talk to me, I get so lonely. Here, have a present! I must be going now though.']);
  const q = h.player(), dismissed = h.spawn(q, 5);
  h.hooks['Mysterious Old Man'].Dismiss({ player: q, npc: dismissed });
  assert.equal(dismissed.removed, true); assert.deepEqual(q.rewards, []);
});

test('a reward too big for a nearly full stack goes to the ground whole instead of being clamped', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 5);
  p.free = 0; p.slots[0] = new Item(I.COINS, 2_147_483_646); h.random(0);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc });
  assert.deepEqual(p.rewards, []);
  assert.deepEqual(h.drops.map(drop => [drop.getItem().getId(), drop.getItem().getAmount()]), [[I.COINS, 80]]);
  assert.deepEqual(p.messages, [PLACED(80, 'Coins')]);
  const q = h.player(), giver = h.spawn(q, 5);
  q.free = 0; q.slots[0] = new Item(I.COINS, 2_147_483_647 - 80); h.random(0);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: q, npc: giver });
  assert.deepEqual(q.rewards, [I.COINS]); assert.deepEqual(q.messages, [REWARD(80, 'Coins')]);
});

test('Strange Plant stays planted, grows before picking, denies strangers and rewards only once', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 23);
  assert.equal(npc.definition.id, N.STRANGE_PLANT); assert.equal(npc.animation, 348);
  assert.equal(npc.following, undefined); assert.equal(npc.chat, undefined);
  h.hooks['Strange plant'].Pick({ player: p, npc }); assert.match(p.messages.at(-1), /isn't ready/);
  h.advance(26_999); h.hooks['Strange plant'].Pick({ player: p, npc }); assert.deepEqual(p.rewards, []);
  const stranger = h.player();
  h.advance(1); h.hooks['Strange plant'].Pick({ player: stranger, npc });
  assert.deepEqual(stranger.messages, ["It's not here for you."]);
  h.emit('PlayerProcess', { player: p }); assert.equal(npc.chat, undefined, 'plants do not talk');
  h.hooks['Strange plant'].Pick({ player: p, npc }); h.hooks['Strange plant'].Pick({ player: p, npc });
  assert.deepEqual(p.rewards, [I.STRANGE_FRUIT]); assert.equal(h.drops.length, 0);
  // 1625: wilts on picking, gone 21 ticks later; the pick message is game spam.
  assert.equal(npc.animation, 350); assert.equal(npc.removed, undefined);
  assert.deepEqual(p.typed, [[105, 'You pick the fruit from the plant.', undefined]]);
  h.advance(21 * 600 - 1); h.emit('PlayerProcess', { player: p }); assert.equal(npc.removed, undefined);
  h.advance(1); h.emit('PlayerProcess', { player: p }); assert.equal(npc.removed, true);
});

test('full-inventory fruit remains private on the ground for exactly three hours', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 23);
  p.free = 0; h.advance(27_000); h.hooks['Strange plant'].Pick({ player: p, npc });
  h.hooks['Strange plant'].Pick({ player: p, npc });
  assert.deepEqual(p.rewards, []); assert.equal(h.drops.length, 1);
  const drop = h.drops[0];
  assert.equal(drop.getItem().getId(), I.STRANGE_FRUIT); assert.equal(drop.getOwner(), p.getUsername());
  assert.equal(drop.getgoesGlobal(), false); assert.equal(drop.getState(), State.SEEN_BY_PLAYER);
  assert.ok(drop.getPosition().equals(p.location)); assert.notEqual(drop.getPosition(), p.location);
  assert.equal(drop.getDespawnDelay(), 18_000);
  assert.deepEqual(p.messages.slice(-1), [PLACED(1, 'Strange fruit')]);
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
    if (reason === 'expiry') {
      // 127: ignored, it wilts at +110 ticks and is gone 21 ticks later.
      h.advance(109 * 600); h.emit('PlayerProcess', { player: p }); assert.equal(npc.animation, 348);
      h.advance(600); h.emit('PlayerProcess', { player: p }); assert.equal(npc.animation, 350);
    }
    if (reason === 'distance') { p.location = new Location(3300, 3300, 0); h.emit('PlayerProcess', { player: p }); }
    h.hooks['Strange plant'].Pick({ player: p, npc });
    if (reason === 'dismiss' || reason === 'expiry') {
      assert.equal(npc.animation, 350); assert.equal(npc.removed, undefined);
      h.advance(21 * 600); h.emit('PlayerProcess', { player: p });
    }
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

// The accepting option echoes the player's line; continuing it runs the teleport.
function accept(h, p) {
  choose(h, p, 0);
  openOptions(h, p);
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

test('Count Check gives his lamp to a player with a Bank PIN and fails one without', t => {
  const h = harness(t);
  let pin = true;
  h.api.onCustomEvent('bank-pin:status', query => { query.set = pin; });
  const p = h.player(), npc = h.spawn(p, 7);
  assert.equal(npc.definition.id, N.COUNT_CHECK_2);
  h.hooks['Count Check']['Talk-to']({ player: p, npc, handled: false });
  assert.deepEqual(p.rewards, [I.LAMP]); assert.deepEqual(p.messages, [REWARD(1, 'Lamp')]);
  assert.match(npcLines(p)[0], /so you pass my checks! Enjoy your prize\.$/);
  assert.equal(npc.animation, 858, 'he bows as he leaves');
  h.hooks['Count Check']['Talk-to']({ player: p, npc, handled: false });
  assert.deepEqual(npcLines(p), ['I must be leaving now.']); assert.deepEqual(p.rewards, [I.LAMP]);
  leaves(h, p); assert.equal(npc.removed, true);
  pin = false;
  const q = h.player(), failed = h.spawn(q, 7);
  h.hooks['Count Check']['Talk-to']({ player: q, npc: failed, handled: false });
  assert.deepEqual(q.rewards, []); assert.match(npcLines(q)[0], /You do not have a Bank PIN, so you fail my checks!/);
  leaves(h, q); assert.equal(failed.removed, true);
});

test('gift events follow the captured overhead timeline, smoke and refusal lines', t => {
  const h = harness(t), tick = (p, n = 1) => { for (let i = 0; i < n; i++) { h.advance(600); h.emit('PlayerProcess', { player: p }); } };
  const p = h.player(), npc = h.spawn(p, 4), other = h.player();
  assert.equal(p.smokes.length, 2, 'two arrival smokes for a Certer'); assert.equal(p.smokes[0][0], 86);
  assert.equal(npc.chat, undefined, 'nothing said on the tick it appears');
  tick(p); assert.equal(npc.chat, 'Greetings Player, I need your help.'); assert.equal(npc.animation, 863);
  npc.chat = undefined; tick(p, 8); assert.equal(npc.chat, undefined);
  tick(p); assert.match(npc.chat, /Player/);
  for (let beat = 2; beat <= 9; beat++) { npc.chat = undefined; tick(p, 10); assert.ok(npc.chat, `beat ${beat}`); }
  tick(p, 10); assert.equal(npc.chat, 'Maybe later.'); assert.equal(npc.removed, undefined);
  h.hooks.Niles['Talk-to']({ player: p, npc }); assert.deepEqual(npcLines(p), ['I must be leaving now.']);
  tick(p, 2); assert.equal(npc.removed, undefined); tick(p); assert.equal(npc.removed, true);
  assert.equal(p.smokes.length, 3, 'one smoke on leaving');
  h.hooks.Niles['Talk-to']({ player: other, npc });
  const r = h.player(); r.female = true; const rick = h.spawn(r, 3);
  tick(r); assert.equal(rick.chat, 'Good day to you, milady.'); assert.equal(rick.animation, 858);
  h.hooks['Rick Turpentine']['Talk-to']({ player: other, npc: rick });
  assert.deepEqual(npcLines(other), ['It is someone else with whom I desire to speak, but he seems to be preoccupied.']);
  assert.deepEqual(other.messages, [], 'no invented refusal message');
  // The spoken line is copied to the chatbox as a type 114 message when the page opens.
  h.hooks['Rick Turpentine']['Talk-to']({ player: r, npc: rick });
  assert.deepEqual(npcLines(r), ['Today is your lucky day, madam!<br>I am donating to the victims of crime to atone for my<br>past actions!']);
  const [line] = r.dialogue.getDialogues().values();
  try { line.send(r); } catch { /* the fake sender has no chathead packets */ }
  assert.deepEqual(r.typed.at(-1), [114, 'Today is your lucky day, madam! I am donating to the victims of crime to atone for my past actions!', 'Rick Turpentine']);
});

const FROG_TOUCH = ["Very well, if a touch is all you need, I'll do it.", "Yes, I will touch you.",
  "Sure, I'll touch you.", "A touch? Yes, I'll do that."];
const FROG_KISS = ["How about if we kiss?", "May I kiss you instead?", "Would a kiss be acceptable?"];
const FROG_POLITE = ["I would prefer not to, sorry.", "I'm sorry, I'd prefer not to do that."];
const FROG_BECOME = ["I'd rather become a frog too!", "What if I want to be a frog like you?"];

function frogEvent(t) {
  const h = harness(t), p = eventPlayer(h), before = h.npcs.length;
  h.spawn(p, 8);
  const frogs = h.npcs.slice(before), npc = frogs.find(entry => entry.definition.id === N.FROG_7);
  assert.ok(npc, 'the crowned frog');
  assert.equal(frogs.length, 6, 'six frogs, as 1702 has');
  h.hooks.Frog['Talk-to']({ player: p, npc, handled: false });
  return { h, p, npc, frogs, prompt: openOptions(h, p) };
}

test('Kiss the frog: the kiss turns the frog back, pays the token and the royal leaves', t => {
  const { h, p, npc, frogs, prompt } = frogEvent(t);
  assert.equal(prompt.title, 'Select an option');
  assert.equal(prompt.options.length, 4, 'one of each kind, as 1702 offers');
  choose(h, p, prompt.options.findIndex(entry => FROG_KISS.includes(entry.label)));
  endChat(p);
  assert.deepEqual(pageTexts(p), ['Yes!']);
  endChat(p);
  assert.equal(p.animation, 2376);
  assert.equal(npc.animation, 2374);
  h.ticks(2);
  assert.equal(npc.animation, 2375);
  assert.deepEqual(p.rewards, []);
  h.ticks(2);
  assert.ok([N.FROG_PRINCE, N.FROG_PRINCESS].includes(npc.transformation));
  assert.equal(npc.graphic, 85);
  assert.deepEqual(p.rewards, [I.FROG_TOKEN]);
  assert.match(pageTexts(p)[0], /^Thank you so much, Player\. I must return to my fairytale kingdom\./);
  endChat(p);
  assert.equal(npc.animation, 1374);
  assert.notEqual(npc.removed, true);
  h.ticks(3);
  assert.ok(frogs.every(entry => entry.removed), 'the whole group leaves together');
});

test('Kiss the frog: a touch turns the frog back without the kiss animation', t => {
  const { h, p, npc, prompt } = frogEvent(t);
  choose(h, p, prompt.options.findIndex(entry => FROG_TOUCH.includes(entry.label)));
  endChat(p);
  assert.notEqual(p.animation, 2376);
  assert.equal(npc.animation, 2374);
  h.ticks(4);
  assert.deepEqual(p.rewards, [I.FROG_TOKEN]);
});

test('Kiss the frog: a polite refusal only ends the chat', t => {
  const { h, p, npc, prompt } = frogEvent(t);
  const index = prompt.options.findIndex(entry => FROG_POLITE.includes(entry.label));
  const label = prompt.options[index].label;
  choose(h, p, index);
  assert.deepEqual(pageTexts(p), [label]);
  assert.deepEqual(p.rewards, []);
  assert.notEqual(npc.removed, true);
  assert.equal(p.location.getX(), 3222);
});

test('Kiss the frog: asking to be a frog goes to Frogland and its crowned frog lets you leave', t => {
  const { h, p, frogs, prompt } = frogEvent(t);
  choose(h, p, prompt.options.findIndex(entry => FROG_BECOME.includes(entry.label)));
  endChat(p);
  assert.equal(p.transformation, N.FROG_6);
  assert.equal(p.location.getX(), 2464);
  assert.equal(p.location.getY(), 4780);
  assert.ok(frogs.every(entry => entry.removed));
  const count = h.npcs.length;
  const crowned = { getId: () => N.FROG_7 };
  h.hooks.Frog['Talk-to']({ player: p, npc: crowned, handled: false });
  assert.equal(h.npcs.length, count, 'the world spawn answers, no royal is spawned');
  assert.deepEqual(pageTexts(p), ['Are you ready to leave now?']);
  choose(h, p, 0);
  endChat(p);
  assert.equal(p.transformation, -1);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.equal(p.location.getX(), 3222);
});

test('Kiss the frog: the other frogs give the live lines, by owner', t => {
  const { h, p, frogs } = frogEvent(t);
  const speaker = frogs.find(entry => entry.definition.id === N.FROG_5);
  const other = frogs.find(entry => entry.definition.id === N.FROG_6);
  h.hooks.Frog['Talk-to']({ player: p, npc: speaker, handled: false });
  assert.match(pageTexts(p)[0], /^Don't talk to me! Speak to the frog (prince|princess)!$/);
  h.hooks.Frog['Talk-to']({ player: p, npc: other, handled: false });
  assert.match(pageTexts(p)[0], /^Hurrah for the frog (prince|princess)!$/);
  const q = h.player();
  h.hooks.Frog['Talk-to']({ player: q, npc: other, handled: false });
  assert.deepEqual(pageTexts(q), ['The frogs do not need your help right now.']);
});

test('Thessalia exchanges a frog token for costume pieces, keeping the rest', t => {
  const h = harness(t), p = h.player();
  p.slots[0] = new Item(I.FROG_TOKEN, 1); p.slots[1] = new Item(I.FROG_TOKEN, 1);
  h.hooks.Thessalia['Talk-to']({ player: p, npc: {}, handled: false });
  assert.equal(openOptions(h, p).options.length, 5);
  choose(h, p, 0);
  assert.deepEqual(pageTexts(p), ['A frog mask, please!']);
  endChat(p);
  assert.equal(p.rewards.at(-1), I.FROG_MASK);
  assert.equal(p.slots[0], undefined);
  assert.ok(p.slots[1]);
  h.hooks.Thessalia['Talk-to']({ player: p, npc: {}, handled: false });
  choose(h, p, 3);
  assert.deepEqual(pageTexts(p), ["I'll take the reward lamp, thanks."]);
  endChat(p);
  assert.equal(p.rewards.at(-1), I.LAMP);
});

// A player whose packet sender records everything and chains like the real one, for the events
// that draw through packets the base harness doesn't fake (Capt' Arnav, Pillory, Quiz Master).
function eventPlayer(h) {
  const { Misc } = require('../dist/util/Misc');
  const { Graphic } = require('../dist/game/model/Graphic');
  Object.assign(h.api.core, { Misc, Graphic });
  const p = h.player(), base = p.getPacketSender;
  p.sent = [];
  p.getSpellbook = () => ({ getInterfaceId: () => 218 });
  p.getPacketSender = () => {
    const sender = base();
    const proxy = new Proxy(sender, { get: (target, name) => {
      if (name === 'isChatboxInterface') return target[name];
      return (...args) => { p.sent.push([name, ...args]); target[name]?.(...args); return proxy; };
    } });
    return proxy;
  };
  return p;
}

// Runs the action at the end of the player's current chain of pages.
function endChat(p) {
  for (const entry of [...p.dialogue.getDialogues().values()]) {
    if (entry.constructor.name === 'ActionDialogue') entry.send(p);
  }
}

function pageTexts(p) {
  return [...p.dialogue.getDialogues().values()].map(entry => entry.getText?.()).filter(Boolean);
}

function sentWith(p, name, ...args) {
  return p.sent.some(entry => entry[0] === name && args.every((arg, index) => entry[index + 1] === arg));
}

function openArnavLock(h, p, npc) {
  h.hooks["Capt' Arnav"]['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  assert.deepEqual(pageTexts(p), ["Yes, I'll help you unlock your chest.", 'There are three columns. What you need to do for me is to match up each picture with the word underneath the column, and then unlock the chest.']);
  endChat(p);
  assert.equal(p.interfaceId, 26);
  return Events.activeFor(p);
}

test("Capt' Arnav's combilock runs on varp 531, explains once and pays only on a solved lock", t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 9);
  const active = openArnavLock(h, p, npc);
  assert.ok(active.lock.every(column => ['BOWL', 'BAR', 'RING'].includes(p.strings.get((26 << 16) | (22 + active.lock.indexOf(column))))));
  active.lock.forEach(column => { column.value = 0; });
  // The up arrow adds one and the down arrow three, two bits per column (rsprox 1108, 91).
  h.emit('InterfaceActionClick', { player: p, buttonId: (26 << 16) | 11, action: 1 });
  assert.ok(sentWith(p, 'sendConfig', 531, 1 << 4));
  h.emit('InterfaceActionClick', { player: p, buttonId: (26 << 16) | 6, action: 1 });
  assert.ok(sentWith(p, 'sendConfig', 531, (1 << 4) | 3));
  h.emit('InterfaceActionClick', { player: p, buttonId: (26 << 16) | 25, action: 1 });
  assert.deepEqual(p.rewards, []);
  assert.equal(p.interfaceId, -1);
  assert.equal(pageTexts(p)[0], 'Arrr! That be nowhere near close! Did ye not listen the first time around?');
  assert.equal(pageTexts(p).at(-1), 'Certainly. Let me try again.');
  endChat(p);
  assert.equal(p.interfaceId, 26);
  active.lock.forEach(column => { column.value = column.target; });
  h.emit('InterfaceActionClick', { player: p, buttonId: (26 << 16) | 25, action: 1 });
  assert.equal(p.rewards.length, 1);
  leaves(h, p); assert.equal(npc.removed, true);
  assert.ok(sentWith(p, 'sendSound', 2303));
  assert.match(pageTexts(p)[0], /^Ah, well done matey/);
  assert.deepEqual(p.messages.filter(text => !text.startsWith('Your reward is')), []);
  const doomed = h.spawn(h.player(), 9);
  h.hooks["Capt' Arnav"]['Talk-to']({ player: h.player(), npc: doomed });
});

test("Capt' Arnav gives up after a second wrong try, without a reward", t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 9);
  const active = openArnavLock(h, p, npc);
  active.lock.forEach(column => { column.value = 0; });
  h.emit('InterfaceActionClick', { player: p, buttonId: (26 << 16) | 25, action: 1 });
  endChat(p);
  h.emit('InterfaceActionClick', { player: p, buttonId: (26 << 16) | 25, action: 1 });
  assert.deepEqual(p.rewards, []);
  assert.equal(npc.removed, true);
  assert.deepEqual(pageTexts(p), ["Arrr! I'd better find someone else."]);
  assert.deepEqual(p.messages, []);
});

test('throwing session cleanup callbacks do not strand players or stop shutdown cleanup', t => {
  const h = harness(t), players = [eventPlayer(h), eventPlayer(h)], cleaned = [];
  t.mock.method(console, 'error', () => {});
  for (const [index, p] of players.entries()) {
    const origin = p.location.clone(), npc = h.spawn(p, 10);
    h.hooks['Bee keeper']['Talk-to']({ player: p, npc, handled: false }); choose(h, p, 0); endChat(p);
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

const HIVE_COMPONENTS = [10, 11, 12, 13, 15, 17, 19, 21];

function dragPart(h, p, fromIndex, toIndex) {
  h.api.emitCustomEvent('player:widget-action', { player: p, handled: false, packet: { type: 'widget_drag',
    sourceWidgetId: (420 << 16) | HIVE_COMPONENTS[fromIndex], targetWidgetId: (420 << 16) | HIVE_COMPONENTS[toIndex] } });
}

/** Drags each part from the loose row into the slot for 'order' (part per slot). */
function buildHive(h, p, session, order) {
  order.forEach((part, slot) => dragPart(h, p, session.data.slots.indexOf(part), 4 + slot));
}

test('Beekeeper: the parts are dragged into the slots and a correct hive pays the piece, then the lamp', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 10);
  h.hooks['Bee keeper']['Talk-to']({ player: p, npc, handled: false });
  assert.equal(openOptions(h, p).title, 'What would you like to say?');
  choose(h, p, 0);
  assert.deepEqual(pageTexts(p), ["Ooh, a bee hive. I'll help you."]);
  endChat(p);
  const session = Teleports.sessionOf(p);
  assert.equal(session.kind, 'beekeeper');
  assert.ok(session.keeper.getLocation().equals(new Location(1928, 5044, 0)), 'keeper two tiles from the landing');
  assert.ok(p.location.equals(new Location(1927, 5044, 0)), 'the player steps up to him');
  assert.equal(pageTexts(p).length, 4);
  endChat(p);
  assert.equal(p.interfaceId, 420);
  assert.deepEqual(session.data.slots.slice(4), [0, 0, 0, 0]);
  assert.deepEqual([...session.data.slots.slice(0, 4)].sort(), [1, 2, 3, 4]);
  buildHive(h, p, session, [1, 2, 3, 4]);
  assert.deepEqual(session.data.slots, [0, 0, 0, 0, 1, 2, 3, 4]);
  assert.ok(sentWith(p, 'sendVarbit', 10605, 1), 'the lid slot is sent to the client');
  h.emit('InterfaceActionClick', { player: p, buttonId: (420 << 16) | 22, action: 1 });
  assert.ok(sentWith(p, 'sendSound', 938));
  assert.equal(p.interfaceId, -1);
  assert.equal(pageTexts(p)[0], "That's perfect! I'll get some bees moved in immediately.");
  endChat(p);
  assert.equal(p.location.getX(), 1927, 'not home until three ticks later');
  h.ticks(3);
  assert.equal(p.rewards.length, 2);
  assert.ok([25129, 25131, 25133, 25135, 25137].includes(p.rewards[0]), 'an outfit piece first');
  assert.equal(p.rewards[1], I.LAMP);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.equal(p.location.getX(), 3222);
});

test('Beekeeper: six wrong builds set the bees on the player and pay nothing', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 10);
  h.hooks['Bee keeper']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  endChat(p);
  endChat(p);
  const session = Teleports.sessionOf(p);
  for (let attempt = 1; attempt <= 5; attempt++) {
    buildHive(h, p, session, [2, 1, 3, 4]);
    h.emit('InterfaceActionClick', { player: p, buttonId: (420 << 16) | 22, action: 1 });
    const left = 6 - attempt;
    assert.equal(pageTexts(p)[1], left === 1 ? "I'll let you have one more try." : "I'll let you have " + left + " more tries.");
    endChat(p);
    assert.equal(p.interfaceId, 420);
  }
  buildHive(h, p, session, [2, 1, 3, 4]);
  h.emit('InterfaceActionClick', { player: p, buttonId: (420 << 16) | 22, action: 1 });
  assert.equal(pageTexts(p)[0], 'Uh-oh, the bees are fed up with waiting for you to build them a home!');
  endChat(p);
  assert.equal(p.chat, 'Aaaaargh - BEES!');
  h.ticks(12);
  assert.deepEqual(p.rewards, []);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.equal(p.location.getX(), 3222);
});

test('Beekeeper: an incomplete hive does nothing and talking to him reopens it or leaves', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 10);
  h.hooks['Bee keeper']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  endChat(p);
  endChat(p);
  const session = Teleports.sessionOf(p);
  h.emit('InterfaceActionClick', { player: p, buttonId: (420 << 16) | 22, action: 1 });
  assert.equal(session.data.attempts, 6);
  p.interfaceId = -1;
  h.hooks['Bee keeper']['Talk-to']({ player: p, npc: session.keeper, handled: false });
  assert.deepEqual(pageTexts(p), ['Ready to try again?']);
  choose(h, p, 1);
  endChat(p);
  assert.equal(p.interfaceId, 420);
  h.hooks['Bee keeper']['Talk-to']({ player: p, npc: session.keeper, handled: false });
  choose(h, p, 2);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.deepEqual(p.rewards, []);
});

const QUIZ_OPTIONS = (191 << 16) | 1;
const QUIZ_FIRST_QUESTION_TICKS = 16;
const QUIZ_REPLY_TICKS = 3;
function startQuiz(h, p, npc) {
  h.hooks['Quiz Master']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  assert.deepEqual(pageTexts(p), ["Yes please, I'm so excited!"]);
  endChat(p);
  const session = Teleports.sessionOf(p);
  h.ticks(QUIZ_FIRST_QUESTION_TICKS);
  return session;
}

function answerQuiz(h, p, slot) {
  h.emit('InterfaceActionClick', { player: p, buttonId: QUIZ_OPTIONS, action: 1, slot });
}

test('Quiz Master opens 191 with script 3799 and pays 1,000 coins after four correct answers', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 11);
  const session = startQuiz(h, p, npc);
  assert.ok(p.messages.includes('Answer four questions correctly in a row to be teleported back where you came from.'));
  assert.equal(p.chatboxGroupId, 191);
  assert.ok(sentWith(p, 'sendClientScript', 3799, QUIZ_OPTIONS, ...session.data.models.flat()));
  assert.ok(sentWith(p, 'sendInterfaceFlagsRange', QUIZ_OPTIONS, 0, 2, 2));
  for (let i = 0; i < 4; i++) {
    answerQuiz(h, p, session.data.models.indexOf(session.data.odd));
    // Waits for the host's line: a second click on the same question does nothing.
    answerQuiz(h, p, session.data.models.indexOf(session.data.odd));
    h.ticks(QUIZ_REPLY_TICKS);
  }
  assert.equal(session.data.streak, 4);
  assert.ok(sentWith(p, 'sendJingle', 110));
  const prompt = h.prompts.at(-1);
  assert.equal(prompt.title, 'Select Your Prize');
  assert.deepEqual(prompt.options.map(option => option.label), ['1,000 Coins', 'Mystery Box']);
  prompt.options[0].cb();
  assert.deepEqual(p.rewards, [I.COINS]);
  assert.equal(p.rewardItems.at(-1).getAmount(), 1000);
  assert.equal(p.messages.at(-1), REWARD(1000, 'Coins'));
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.ok(sentWith(p, 'sendTabInterface', 0, 593), 'the tabs come back');
  assert.deepEqual([p.location.getX(), p.location.getY()], [3222, 3222]);
});

test('Quiz Master wrong answers only reset the streak and ask again', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 11);
  const session = startQuiz(h, p, npc);
  answerQuiz(h, p, session.data.models.indexOf(session.data.odd));
  h.ticks(QUIZ_REPLY_TICKS);
  assert.equal(session.data.streak, 1);
  answerQuiz(h, p, session.data.models.findIndex(model => model !== session.data.odd));
  assert.equal(session.data.streak, 0);
  assert.match(p.strings.get((231 << 16) | 6), /<br>Okay, next question!$/);
  assert.equal(session.data.phase, 'reply');
  h.ticks(QUIZ_REPLY_TICKS);
  assert.equal(session.data.phase, 'question');
});

test('Quiz Master holds the player: tabs closed, seated, and a closed chatbox comes back', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 11);
  const session = startQuiz(h, p, npc);
  assert.ok(sentWith(p, 'closeSubInterface', (161 << 16) | 79), 'the inventory tab is closed');
  assert.equal(p.animation, 2378);
  p.chatboxGroupId = -1;
  h.emit('PlayerProcess', { player: p });
  assert.equal(p.chatboxGroupId, 191);
  assert.ok(session.data.models);
});

test('Quiz Master seats the player in the walled tile facing him on plane 1', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 11);
  startQuiz(h, p, npc);
  assert.deepEqual([p.location.getX(), p.location.getY(), p.location.getZ()], [1952, 4764, 1]);
  assert.ok(Teleports.sessionOf(p), 'arriving upstairs keeps the session');
  // The core area that holds the session must cover the seat on its plane, or arriving would end it.
  const { Area } = require('../dist/game/model/areas/Area');
  const { Boundary } = require('../dist/game/model/Boundary');
  Teleports.initialize(new Proxy({ core: { Area, Boundary } }, { get: (target, name) => target[name] ?? (() => {}) }), {});
  const seat = new Location(1952, 4764, 1);
  assert.ok(Teleports.createAreas().some(area => area.getBoundaries()[0].inside(seat)), 'the quiz area is on plane 1');
});

test('Quiz Master questions have both models of one pair and one odd one out', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 11);
  let value = 0;
  h.random(0);
  const session = startQuiz(h, p, npc);
  // The pairs every recorded answer implies, with live's zooms.
  const PAIR = { 8828: 'a', 8836: 'a', 8829: 'b', 8830: 'b', 8831: 'c', 8834: 'c', 8832: 'd', 8833: 'd', 8835: 'e', 8837: 'e' };
  const ZOOM = { 8828: 700, 8829: 800, 8830: 800, 8831: 400, 8832: 800, 8833: 400, 8834: 400, 8835: 500, 8836: 600, 8837: 1000 };
  for (let i = 0; i < 200; i++) {
    const { models, odd } = session.data;
    const others = models.filter(model => model !== odd);
    assert.equal(models.length, 3);
    assert.equal(others.length, 2, `the odd model appears once: ${models}`);
    assert.equal(PAIR[others[0][0]], PAIR[others[1][0]], `the other two are a pair: ${models}`);
    assert.notEqual(PAIR[odd[0]], PAIR[others[0][0]], `the odd one is from another pair: ${models}`);
    assert.ok(models.every(([model, zoom]) => ZOOM[model] === zoom));
    // A wrong answer asks a fresh question without ending the event.
    answerQuiz(h, p, models.indexOf(others[0]));
    value = (value + 0.137) % 1;
    h.random(value);
    h.ticks(QUIZ_REPLY_TICKS);
  }
});

test('Drill Demon wants five matching exercises in a row for the camo top', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 12);
  h.hooks['Sergeant Damien']['Talk-to']({ player: p, npc, handled: false });
  assert.deepEqual(npcLines(p).slice(0, 1), ["Private Player, atten-SHUN! You've been recommended for my corps. Do you think you can be the best?"]);
  openOptions(h, p);
  assert.equal(h.prompts.at(-1).title, 'What would you like to say?');
  accept(h, p);
  const session = Teleports.sessionOf(p);
  assert.equal(p.location.getX(), 3163, 'drill arrival x');
  assert.equal(p.location.getY(), 4820, 'drill arrival y');
  assert.match(npcLines(p)[0], /^Move yourself, Private!/);
  assert.deepEqual([...p.varbits.keys()].sort(), [1335, 1336, 1337, 1338], 'the signs are multiloc varbits');
  openOptions(h, p);
  for (let i = 0; i < 5; i++) {
    assert.equal(Teleports.sessionOf(p), session, `still drilling before exercise ${i + 1}`);
    assert.deepEqual(npcLines(p), [session.data.order.line]);
    const exerciseDone = session.data.order;
    const entry = [...session.data.matExercise.entries()].find(([, exercise]) => exercise === exerciseDone);
    assert.ok(entry, 'a mat matches the order');
    p.location = new Location(entry[0], 4820, 0);
    h.hooks['object:Exercise mat'].Use({ player: p, handled: false,
      object: { getLocation: () => new Location(entry[0], 4820, 0), getId: () => 1 } });
    h.ticks(3);
    assert.ok(p.face.equals(new Location(entry[0], 4821, 0)), 'the exercise faces the sign');
    assert.equal(p.animation, exerciseDone.animation);
    h.ticks(exerciseDone.ticks);
    assert.equal(p.animation, 65535);
  }
  assert.deepEqual(npcLines(p), ["Well I'll be, you actually did it, Private. Now take this and get out of my sight."]);
  openOptions(h, p);
  assert.deepEqual(p.rewards, [6654], 'the camo top and no lamp');
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Drill Demon walks onto the mat tile under the sign from either half of a mat', t => {
  const h = harness(t);
  assert.equal(h.hooks.objectRoute?.length, 1, 'the drill plugin registers the mat route');
  for (const [x, y, id] of [[3160, 4819, 20810], [3160, 4820, 20810], [3162, 4819, 16508],
    [3164, 4819, 9313], [3166, 4819, 20801]]) {
    const route = { clickType: 1, objectId: id, object: { getLocation: () => new Location(x, y, 0) } };
    for (const handler of h.hooks.objectRoute) handler(route);
    assert.deepEqual(route.destination, { x, y: 4820, z: 0 }, `${x},${y}: walks onto the north tile`);
  }
  const other = { clickType: 1, objectId: 9315, object: { getLocation: () => new Location(3165, 4820, 0) } };
  for (const handler of h.hooks.objectRoute) handler(other);
  assert.equal(other.destination, undefined, 'sign posts keep the core route');
  const look = { clickType: 2, objectId: 20810, object: { getLocation: () => new Location(3160, 4820, 0) } };
  for (const handler of h.hooks.objectRoute) handler(look);
  assert.equal(look.destination, undefined, 'only Use walks to the mat');
});

test('Drill Demon breaks the streak on a wrong mat and lets the player leave', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 12);
  h.hooks['Sergeant Damien']['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const session = Teleports.sessionOf(p);
  h.hooks['object:Exercise mat'].Use({ player: p, handled: false,
    object: { getLocation: () => new Location(3160, 4820, 0), getId: () => 1 } });
  assert.deepEqual(npcLines(p), ["I haven't given you the order yet, worm!"]);
  openOptions(h, p);
  session.data.streak = 3;
  const wrong = [...session.data.matExercise.entries()].find(([, exercise]) => exercise !== session.data.order);
  p.location = new Location(wrong[0], 4820, 0);
  h.hooks['object:Exercise mat'].Use({ player: p, handled: false,
    object: { getLocation: () => new Location(wrong[0], 4820, 0), getId: () => 1 } });
  h.ticks(20);
  assert.equal(session.data.streak, 0);
  assert.equal(npcLines(p)[0], `Wrong exercise, worm! ${session.data.order.line}`);
  assert.deepEqual(p.messages, []);
  const talk = { player: p, npc: { getId: () => N.SERGEANT_DAMIEN }, handled: false };
  h.hooks['Sergeant Damien']['Talk-to'](talk);
  assert.equal(talk.handled, true);
  assert.equal(npcLines(p)[0], session.data.order.line);
  openOptions(h, p);
  assert.deepEqual(npcLines(p), [session.data.order.box], 'the objbox follows the line');
  assert.deepEqual(p.typed.at(-1), [115, session.data.order.box, undefined]);
  openOptions(h, p);
  assert.equal(h.prompts.at(-1).title, 'Select an option');
  h.prompts.at(-1).options[1].cb();
  assert.deepEqual(npcLines(p), ['I want to leave.']);
  openOptions(h, p);
  assert.deepEqual(npcLines(p), ['Pathetic. Get out of here then.']);
  openOptions(h, p);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.deepEqual(p.rewards, []);
});

test('Freaky Forester takes any carcass and the portal pays the outfit piece', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 13);
  h.hooks['Freaky Forester']['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const session = Teleports.sessionOf(p);
  assert.ok([[2599, 4774], [2598, 4775]].some(([x, y]) => p.location.getX() === x && p.location.getY() === y),
    'arrives beside the forester, not on him');
  assert.ok(p.configs.get(531) >= 1 && p.configs.get(531) <= 24, 'varp 531 makes the pheasants visible');
  assert.match(npcLines(p)[0], /^Hey there, Player\. .* Bring me the raw pheasant when you're done\.$/);
  assert.deepEqual(p.messages, []);
  const request = npcLines(p)[0];
  h.hooks['Freaky Forester']['Talk-to']({ player: p, npc: { getId: () => 372 }, handled: false });
  assert.deepEqual(npcLines(p), [request], 'he repeats the same request');
  const bird = { getId: () => 5497, getLocation: () => p.location.clone(), performAnimation(animation) { this.animation = animation.getId(); },
    setHitpoints(hp) { this.hp = hp; } };
  assert.equal(fireNpcClick(h, 5497, 2, { player: p, npc: bird, npcId: 5497 }), true);
  h.ticks(3);
  assert.equal(bird.hp, 0);
  assert.equal(bird.animation, 2373);
  h.ticks(2);
  assert.equal(h.drops.at(-1).getItem().getId(), I.RAW_PHEASANT_3);
  assert.deepEqual(npcLines(p), ['Now bring me the raw pheasant.']);
  p.slots[0] = new Item(I.RAW_PHEASANT_3, 1);
  fireNpcClick(h, 5497, 2, { player: p, npc: bird, npcId: 5497 });
  assert.equal(p.messages.at(-1), "You already have a pheasant carcass. You don't need to kill another.");
  const second = { player: p, groundItemId: I.RAW_PHEASANT_3, handled: false };
  h.hooks.groundPickup[0](second);
  assert.equal(second.handled, true);
  assert.equal(p.messages.at(-1), "You already have a pheasant carcass in your inventory, you don't need to kill another.");
  assert.equal(session.data.done, false);
  h.hooks['Freaky Forester']['Talk-to']({ player: p, npc: { getId: () => 372 }, handled: false });
  assert.equal(session.data.done, true);
  assert.deepEqual(npcLines(p), ['Thanks, Player, you may use the portal to leave the area now.']);
  p.slots[0] = undefined;
  h.hooks['Freaky Forester']['Talk-to']({ player: p, npc: { getId: () => 372 }, handled: false });
  assert.deepEqual(npcLines(p), ['Okay, Player, you can leave the area now.']);
  fireNpcClick(h, 5497, 2, { player: p, npc: bird, npcId: 5497 });
  assert.equal(p.messages.at(-1), "You don't need to attack any more pheasants. You're allowed to leave.");
  h.hooks['object:Exit portal'].Use({ player: p, handled: false,
    object: { getId: () => 20843, getLocation: () => p.location.clone() } });
  assert.deepEqual(p.rewards, [6182]);
  assert.deepEqual(npcLines(p), ['You get a lederhosen hat for your help, many thanks!']);
  assert.equal(p.configs.get(531), 0);
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Freaky Forester portal leaves without a reward before the hand-in', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 13);
  h.hooks['Freaky Forester']['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  h.hooks['object:Exit portal'].Use({ player: p, handled: false,
    object: { getId: () => 20843, getLocation: () => p.location.clone() } });
  assert.deepEqual(p.rewards, []);
  assert.deepEqual(p.messages, []);
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Gravedigger: any coffin fits, Leo judges them, and the right five pay zombie pieces', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 14);
  h.hooks.Leo['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const session = Teleports.sessionOf(p);
  assert.deepEqual([p.location.getX(), p.location.getY()], [1928, 5002]);
  assert.deepEqual([session.leo.location.getX(), session.leo.location.getY()], [1928, 5003]);
  assert.deepEqual(npcLines(p), ["You have to help me, Player! I've put the wrong coffins into these graves.",
    "I need you to pick up the coffin from each grave, see who's inside it, and bury it in the grave with the correct gravestone."]);
  openOptions(h, p);
  assert.equal(p.interfaceId, 220, 'the instruction scroll');
  const graves = [[1924, 4996], [1926, 4999], [1928, 4996], [1930, 4999], [1932, 4996]];
  const filled = [9364, 9365, 9366, 9367, 10049];
  for (let i = 0; i < 5; i++) {
    const grave = { getId: () => filled[i], getType: () => 10, getFace: () => 0,
      getPrivateArea: () => null, getLocation: () => new Location(graves[i][0], graves[i][1], 0) };
    h.hooks['object:Grave']['Take-Coffin']({ player: p, object: grave, handled: false });
    h.ticks(1);
    assert.equal(session.data.contents[i], null);
    assert.equal(p.typed.at(-1)[1], 'You take the coffin from the grave.');
  }
  const put = (grave, coffin) => {
    p.slots[0] = new Item(coffin, 1);
    const target = { getId: () => 10050 + grave, getType: () => 10, getFace: () => 0, getPrivateArea: () => null,
      getLocation: () => new Location(graves[grave][0], graves[grave][1], 0) };
    assert.equal(fireRaw(h, 'itemOnObject', { player: p, itemId: coffin, object: target }), true);
    h.ticks(1);
    assert.equal(p.typed.at(-1)[1], 'You put the coffin into the grave.');
  };
  const { owners } = session.data;
  put(0, owners[1]);
  h.hooks.Leo['Talk-to']({ player: p, npc: session.leo, handled: false });
  assert.equal(h.prompts.at(-1).title, 'Select an option');
  h.prompts.at(-1).options[0].cb();
  assert.deepEqual(npcLines(p), ["I think I've finished!"]);
  openOptions(h, p);
  assert.match(npcLines(p)[0], /^That's a good attempt, but it's just not right\./);
  assert.equal(npcLines(p)[1], "All right, I'll give it another shot.");
  session.data.contents[0] = null;
  for (let i = 0; i < 5; i++) put(i, owners[i]);
  h.hooks.Leo['Talk-to']({ player: p, npc: session.leo, handled: false });
  h.prompts.at(-1).options[0].cb();
  openOptions(h, p);
  assert.deepEqual(npcLines(p), ["Wonderful! That's taken care of them. I'll take you back, and give you your reward."]);
  assert.equal(Teleports.sessionOf(p), session, 'live waits a few ticks');
  h.ticks(9);
  assert.ok(p.rewards.includes(13283) && p.rewards.includes(13284));
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Gravedigger stones and coffins show pictures, and bones cannot be buried', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 14);
  h.hooks.Leo['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const session = Teleports.sessionOf(p);
  h.hooks['object:Gravestone'].Read({ player: p, handled: false,
    object: { getLocation: () => new Location(1924, 4998, 0) } });
  assert.deepEqual(p.typed.at(-1).slice(0, 2), [105, 'You examine the gravestone. It shows...']);
  assert.equal(p.interfaceId, 175);
  assert.ok([13399, 13402, 13403, 13404, 16035].includes(p.models.get((175 << 16) | 1)));
  h.hooks.Coffin.Check({ player: p, itemId: 7591 });
  assert.equal(p.interfaceId, 141);
  assert.deepEqual(p.tray.slice(0, 2), [[(141 << 16) | 3, 7598], [(141 << 16) | 4, 7611]]);
  ITEM_NAMES[I.BONES] = 'Bones';
  assert.equal(fireRaw(h, 'itemOnObject', { player: p, itemId: I.BONES, object: { getId: () => 9364,
    getLocation: () => new Location(1924, 4996, 0) } }), true);
  assert.equal(p.messages.at(-1), 'Burying that here would be very silly.');
  Teleports.finish(session);
});

test('Pinball inviter supports the cache Talk-to and Dismiss actions through real dispatch', async t => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  const h = harness(t), p = h.player(), npc = h.spawn(p, 15);
  t.mock.method(PluginManager, 'getCoreApi', () => h.api.core);
  const previousHooks = PluginManager.npcInteractionHooks;
  PluginManager.npcInteractionHooks = [];
  t.after(() => { PluginManager.npcInteractionHooks = previousHooks; });
  PluginManager.createApi('RandomEvents').onNpcInteraction('Flippa', h.hooks.Flippa);
  const definition = NpcDefinition.forId(npc.getId());
  const operate = clickType => PluginManager.emitNpcInteraction({
    player: p, npc, definition, npcId: npc.getId(), clickType, handled: false,
  });
  assert.equal(operate(1), true, 'the spawned cache variant dispatches Talk-to');
  assert.ok(p.dialogue);
  choose(h, p, 1);
  assert.deepEqual(npcLines(p), ['No thanks.']);
  assert.equal(Teleports.hasSession(p), false, 'declining does not move the player');
  assert.equal(npc.removed, undefined, 'he goes on the next beat (1637 t7516)');
  assert.equal(operate(1), true, 'talking again after declining is handled');
  assert.match(npcLines(p).join('\n'), /Going away now\./);
  assert.equal(definition.getActions()[4], 'Dismiss', 'the client exposes Dismiss');
  assert.equal(operate(5), true);
  assert.equal(npc.removed, true);
  assert.equal(Events.activeFor(p), null);
  assert.equal(Teleports.hasSession(p), false);
});

test('Pinball awards noted gems with the Wiki 3/3/3/1 weights at roll boundaries', t => {
  const h = harness(t);
  const cases = [[0, 1608, 5, 'Sapphire', 'five sapphires'], [0.299999, 1608, 5, 'Sapphire', 'five sapphires'],
    [0.3, 1606, 5, 'Emerald', 'five emeralds'], [0.599999, 1606, 5, 'Emerald', 'five emeralds'],
    [0.6, 1604, 5, 'Ruby', 'five rubies'], [0.899999, 1604, 5, 'Ruby', 'five rubies'],
    [0.9, 1602, 2, 'Diamond', 'two diamonds'], [0.999999, 1602, 2, 'Diamond', 'two diamonds']];
  for (const [roll, id, amount, name, awarded] of cases) {
    const p = h.player(), origin = p.location.clone(), npc = h.spawn(p, 15);
    h.hooks.Flippa['Talk-to']({ player: p, npc, handled: false });
    accept(h, p);
    const session = Teleports.sessionOf(p);
    session.data.done = true;
    h.random(roll);
    h.hooks['object:Cave Exit'].Exit({ player: p, handled: false,
      object: { getId: () => 9293, getLocation: () => new Location(1971, 5036, 0) } });
    assert.deepEqual(p.rewardItems.map(item => [item.getId(), item.getAmount()]), [[id, amount]], `roll ${roll}`);
    assert.deepEqual(p.messages, [`You were awarded ${awarded}!`, REWARD(amount, name)], `roll ${roll}`);
    assert.ok(p.location.equals(origin));
    assert.equal(Teleports.hasSession(p), false);
  }
});

test('Pinball spawns the room Flippa and Tilt and Tilt explains the game', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 15);
  h.hooks.Flippa['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const session = Teleports.sessionOf(p);
  assert.equal(session.flippa.getId(), N.FLIPPA);
  assert.deepEqual([session.flippa.location.getX(), session.flippa.location.getY()], [1973, 5041]);
  assert.equal(session.flippa.getFace(), 3, 'Flippa faces west');
  assert.equal(session.flippa.isOwnerOnly(), true, 'each player has their own room NPCs');
  assert.equal(session.tilt.getId(), N.TILT);
  assert.deepEqual([session.tilt.location.getX(), session.tilt.location.getY()], [1971, 5041]);
  assert.equal(session.tilt.getFace(), 4, 'Tilt faces east');
  assert.match(npcLines(p).join('\n'), /You poke 10 flashing pillars/);
  Teleports.finish(session);
});

test('Pinball Flippa and Tilt repeat the live instructions and farewell', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 15);
  h.hooks.Flippa['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const session = Teleports.sessionOf(p);
  h.hooks.Tilt['Talk-To']({ player: p, npc: session.tilt, handled: false });
  assert.deepEqual(npcLines(p), ['Err...what am I supposed to do here again?', 'You gotta poke dem pillars.',
    'What? All of them?', "No, no. If you poke dem ones dat don't have a dem flashin' rings, den dats bad.",
    'So I have to poke the pillars that are flashing?', 'Yer. You do dat ten times, you get prize.']);
  session.data.done = true;
  h.hooks.Flippa['Talk-To']({ player: p, npc: session.flippa, handled: false });
  assert.deepEqual(npcLines(p), ["So...I'm free to go now, right?", 'Yer, get going. We get break now.',
    'Ok. Err...have a nice break.']);
  const invitation = { player: p, npc: { getId: () => N.FLIPPA_2 }, handled: false };
  h.hooks.Flippa['Talk-to'](invitation);
  assert.equal(invitation.handled, false, 'the invitation NPC keeps its own handler in the room');
  Teleports.finish(session);
});

test('Pinball glows the post with its animation and never swaps object ids', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 15);
  const posts = Pinball._test.POSTS.map(([tile, inactive]) => {
    const object = new FakeGameObject(inactive, new Location(tile[0], tile[1], 0), 10, 0);
    h.api.core.ObjectManager.register(object);
    return object;
  });
  h.hooks.Flippa['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const session = Teleports.sessionOf(p);
  assert.deepEqual(p.objectAnimations, [[posts[session.data.glow], Pinball._test.GLOW_ON]], 'one post starts glowing');
  p.objectAnimations.length = 0;
  session.data.glow = 0;
  h.hooks['object:Pinball Post'].Tag({ player: p, object: posts[0], handled: false });
  assert.ok(p.face.equals(posts[0].getLocation()));
  h.ticks(1);
  assert.equal(p.animation, 832);
  assert.deepEqual(p.objectAnimations, [], 'the tag lands after the animation');
  h.ticks(2);
  assert.equal(posts[0].getId(), 8982, 'the map object is not replaced');
  assert.equal(session.data.score, 1);
  assert.equal(p.objectAnimations.length, 2, 'only the two changed posts are sent');
  assert.deepEqual(p.objectAnimations[0], [posts[0], Pinball._test.GLOW_OFF], 'the tagged post stops glowing');
  assert.ok(p.objectAnimations[1][0] !== posts[0] && p.objectAnimations[1][1] === Pinball._test.GLOW_ON,
    'another post starts glowing');
  Teleports.finish(session);
});

test('Pinball keeps a glowing post per player, as live instances the room', t => {
  const h = harness(t), p = h.player(), q = h.player();
  const posts = Pinball._test.POSTS.map(([tile, inactive]) => {
    const object = new FakeGameObject(inactive, new Location(tile[0], tile[1], 0), 10, 0);
    h.api.core.ObjectManager.register(object);
    return object;
  });
  for (const player of [p, q]) {
    const npc = h.spawn(player, 15);
    h.hooks.Flippa['Talk-to']({ player, npc, handled: false });
    accept(h, player);
  }
  const pSession = Teleports.sessionOf(p), qSession = Teleports.sessionOf(q);
  pSession.data.glow = 1;
  qSession.data.glow = 3;
  q.objectAnimations = [];
  h.hooks['object:Pinball Post'].Tag({ player: p, object: posts[1], handled: false });
  h.ticks(3);
  assert.equal(pSession.data.score, 1);
  assert.notEqual(pSession.data.glow, 1);
  assert.equal(qSession.data.glow, 3, 'the other player keeps their post');
  assert.deepEqual(q.objectAnimations, [], 'and sees no change');
  Teleports.finish(pSession);
  Teleports.finish(qSession);
});

test('Pinball scores the glowing post, resets on others and pays at the cave exit', t => {
  const h = harness(t), p = h.player(), npc = h.spawn(p, 15);
  h.hooks.Flippa['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const session = Teleports.sessionOf(p);
  const postAt = index => {
    const [tile] = Pinball._test.POSTS[index];
    return { getId: () => Pinball._test.POSTS[index][1], getLocation: () => new Location(tile[0], tile[1], 0) };
  };
  session.data.glow = 0;
  session.data.score = 5;
  h.hooks['object:Pinball Post'].Tag({ player: p, object: postAt(1), handled: false });
  h.ticks(3);
  assert.equal(session.data.score, 0, 'a post without rings resets the score');
  assert.equal(session.data.glow, 0);
  session.data.score = 9;
  h.hooks['object:Pinball Post'].Tag({ player: p, object: postAt(0), handled: false });
  h.ticks(3);
  assert.equal(session.data.done, true);
  assert.deepEqual(p.messages, ['Congratulations, you have won!', 'You may now leave the game area.']);
  h.hooks['object:Cave Exit'].Exit({ player: p, handled: false,
    object: { getId: () => 9293, getLocation: () => new Location(1971, 5036, 0) } });
  assert.equal(p.rewardItems.length, 1);
  assert.ok([1608, 1606, 1604, 1602].includes(p.rewards[0]));
  assert.equal(Teleports.sessionOf(p), undefined);
});

// Evil Bob, Prison Pete, Evil twin and Maze players: a spied sender plus the teleport graphic.
function audited(h) {
  const p = eventPlayer(h);
  p.performGraphic = graphic => { p.graphic = graphic.id; };
  return p;
}

test('Evil Bob island: nets on the ground, servant cutscene, fish, uncook, feed, portal, 650 XP', t => {
  const h = harness(t), p = audited(h), npc = h.spawn(p, 16);
  h.hooks['Evil Bob']['Talk-to']({ player: p, npc, handled: false });
  assert.deepEqual(pageTexts(p), ['Hey, Player, come with me if you like fishing! Or has this amulet of humanspeak broken again?']);
  choose(h, p, 0);
  assert.equal(h.prompts.at(-1).title, 'Follow the scary cat?');
  assert.equal(p.animation, 714); assert.equal(p.graphic, 111); assert.ok(sentWith(p, 'sendSound', 200));
  assert.equal(Teleports.sessionOf(p), undefined, 'the teleport plays first');
  h.ticks(3);
  const session = Teleports.sessionOf(p);
  assert.ok(session, 'on the island three ticks later');
  assert.equal(p.messages.at(-1), ' <br>Welcome to ScapeRune.');
  assert.deepEqual(pageTexts(p).slice(0, 3), ['Huh?', 'Where am I?', 'On my island.']);
  assert.equal(h.drops.filter(drop => drop.getItem().getId() === 6209).length, 7, 'seven nets lie on the island');
  session.data.spot = 'west';
  const spot = { getId: () => 23114, getLocation: () => new Location(2510, 4775, 0) };
  assert.equal(fireRaw(h, 'objectRaw', { player: p, object: spot }), true);
  assert.match(pageTexts(p).join(), /You need a fishing net to fish here/);
  h.hooks.Servant['Talk-to']({ player: p, npc: {}, npcId: N.SERVANT_2, handled: false });
  assert.equal(pageTexts(p).at(-1), 'Look... over t-t-there! That fishing spot c-c-contains the f-f-f-fish he likes.');
  endChat(p);
  assert.ok(sentWith(p, 'sendCameraMoveTo', 2518, 4776, 500), 'the cutscene flies to the west spot');
  h.ticks(8);
  assert.ok(sentWith(p, 'sendCameraReset'));
  const net = h.drops.find(drop => drop.getItem().getId() === 6209);
  h.hooks.groundPickup.forEach(hook => hook({ player: p, groundItem: net, groundItemId: 6209, handled: false }));
  const before = h.drops.length;
  h.ticks(25);
  assert.equal(h.drops.length, before + 1, 'a taken net comes back');
  p.slots[0] = new Item(6209, 1);
  assert.equal(fireRaw(h, 'objectRaw', { player: p, object: spot }), true);
  assert.equal(p.messages.at(-1), 'You cast out your net...');
  assert.equal(p.animation, 620);
  h.ticks(8);
  assert.notEqual(p.rewards.at(-1), 6202);
  h.ticks(1);
  assert.equal(p.rewards.at(-1), 6202, 'a cooked fishlike thing nine ticks later');
  p.slots[1] = new Item(6202, 1);
  assert.equal(fireRaw(h, 'itemOnObject', { player: p, itemId: 6202,
    object: { getId: () => 23113, getLocation: () => new Location(2524, 4779, 0) } }), true);
  assert.equal(p.animation, 897);
  h.ticks(3);
  assert.equal(p.rewards.at(-1), 6200, 'raw now');
  p.slots[1] = new Item(6200, 1);
  const bob = { forceChat(text) { this.chat = text; } };
  assert.equal(fireRaw(h, 'itemOnNpc', { player: p, itemId: 6200, npcId: N.EVIL_BOB_2, target: bob }), true);
  assert.equal(session.data.asleep, true);
  assert.deepEqual(pageTexts(p), ["Mmm, mmm... that's... mmm... delicious...", 'Now, let me take... a little... catnap...']);
  h.ticks(2);
  assert.equal(bob.chat, 'ZZZzzz');
  p.levels.set(apiSkillMagic(h), 1);
  assert.equal(fireRaw(h, 'objectRaw', { player: p, object: { getId: () => 23115,
    getLocation: () => new Location(2523, 4777, 0) } }), true);
  assert.equal(p.animation, 2110, 'a raspberry at the servant');
  h.ticks(3);
  assert.equal(p.chat, 'Be seeing you!');
  h.ticks(5);
  assert.equal(p.xp.get(apiSkillFishing(h)), 650);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.equal(p.getInventory().containsNumber(6209), false, 'the net stays behind');
  assert.deepEqual(pageTexts(p), ['Now what was that all about? Did any of that really happen?',
    "You feel somehow that you've become better at Fishing."]);
});

test('Evil Bob eats the wrong fish and wants one more, and leaving early pays nothing', t => {
  const h = harness(t), p = audited(h), npc = h.spawn(p, 16);
  h.hooks['Evil Bob']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  h.ticks(3);
  const session = Teleports.sessionOf(p);
  p.slots[0] = new Item(6204, 1);
  assert.equal(fireRaw(h, 'itemOnNpc', { player: p, itemId: 6204, npcId: N.EVIL_BOB_2 }), true);
  assert.equal(session.data.required, 2);
  assert.equal(pageTexts(p)[0], 'What was this? That was absolutely disgusting!');
  assert.equal(fireRaw(h, 'objectRaw', { player: p, object: { getId: () => 23115,
    getLocation: () => new Location(2523, 4777, 0) } }), true);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.equal(p.xp.size, 0);
});

function apiSkillMagic(h) { return h.api.core.Skill.MAGIC; }
function apiSkillFishing(h) { return h.api.core.Skill.FISHING; }

const PETE_TALK = { getId: () => N.PRISON_PETE };
function pullPrisonLever(h, p) {
  assert.equal(fireRaw(h, 'objectRaw', { player: p,
    object: { getId: () => 24296, getLocation: () => new Location(2094, 4464, 0) } }), true);
}

test('Prison Pete: balloon shapes by varbit, lever model, keys, barriers, exit, weighted reward', t => {
  const h = harness(t), p = audited(h), npc = h.spawn(p, 17);
  h.hooks['Evil Bob']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  assert.ok(sentWith(p, 'sendSound', 201));
  assert.equal(Teleports.sessionOf(p), undefined);
  h.ticks(6);
  const session = Teleports.sessionOf(p);
  assert.ok(session);
  assert.equal(p.messages.at(-1), ' <br>Welcome to ScapeRune.');
  assert.ok(p.varbits.get(1549) >= 1 && p.varbits.get(1549) <= 24, 'the balloons take an arrangement');
  assert.equal(pageTexts(p)[0], "So you've been captured too?");
  const balloonNpc = { getLocation: () => new Location(2080, 4460, 0) };
  assert.equal(fireNpcClick(h, 5488, 1, { player: p, npc: balloonNpc, npcId: 5488 }), true);
  assert.equal(pageTexts(p)[0], "You're meant to pull the lever to find out which sort of animal to pop!");
  for (let round = 0; round < 3; round++) {
    pullPrisonLever(h, p);
    if (round === 0) {
      assert.match(pageTexts(p)[0], /^That's right, pull it/);
      endChat(p);
    }
    assert.equal(p.animation, 798);
    h.ticks(2);
    const needed = session.data.required;
    assert.equal(p.models.get((273 << 16) | 4), needed.lever, 'the lever shows the required shape');
    h.ticks(20);
    assert.equal(p.interfaceId, 273, 'the panel stays until the player closes it');
    assert.equal(fireNpcClick(h, needed.npcs[0], 1, { player: p, npc: balloonNpc, npcId: needed.npcs[0] }), true);
    h.ticks(2);
    assert.equal(session.data.keyCorrect, true);
    assert.equal(p.rewards.at(-1), 6966);
    p.slots[0] = new Item(6966, 1);
    // Live: Talk-to Pete while carrying the key, no item-on-NPC action (rsprox 4067, 555).
    const promptsBefore = h.prompts.length;
    h.hooks['Prison Pete']['Talk-to']({ player: p, npc: PETE_TALK, handled: false });
    assert.equal(pageTexts(p)[0], "Ooh, thanks! I'll see if it's the right one...");
    endChat(p);
    assert.equal(p.getInventory().containsNumber(6966), false, 'Pete takes the key');
    assert.equal(session.data.required, null, 'the spent shape cannot be popped again before the lever');
    assert.equal(h.prompts.length, promptsBefore, 'carrying a key talks Pete into taking it, not the intro options');
    h.ticks(3);
    assert.equal(p.configs.get(638), (round + 1) << 5, 'one barrier clears');
  }
  assert.equal(session.data.correct, 3);
  assert.match(pageTexts(p)[0], /^You did it/);
  p.location = new Location(2097, 4466, 0);
  h.emit('PlayerProcess', { player: p });
  assert.equal(p.messages.at(-1), 'You quickly escape the prison with Pete.');
  assert.ok(sentWith(p, 'sendJingle', 150));
  h.ticks(7);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.ok(p.location.equals(new Location(3222, 3222, 0)), 'the pair escape to the return tile');
  const rewardsBefore = p.rewards.length;
  h.ticks(3);
  assert.equal(p.rewards.length, rewardsBefore + 1);
  assert.equal(pageTexts(p)[0], 'Thanks a lot for your help! Here, have a present:');
});

test('Prison Pete: a wrong key puts the barriers back', t => {
  const h = harness(t), p = audited(h), npc = h.spawn(p, 17);
  h.hooks['Evil Bob']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  h.ticks(6);
  const session = Teleports.sessionOf(p);
  session.data.correct = 1;
  session.data.pulled = true;
  pullPrisonLever(h, p);
  h.ticks(2);
  const wrong = [5488, 5489, 5491, 5493].find(id => !session.data.required.npcs.includes(id));
  fireNpcClick(h, wrong, 1, { player: p, npc: { getLocation: () => new Location(2080, 4460, 0) }, npcId: wrong });
  h.ticks(2);
  assert.equal(session.data.keyCorrect, false);
  p.slots[0] = new Item(6966, 1);
  h.hooks['Prison Pete']['Talk-to']({ player: p, npc: PETE_TALK, handled: false });
  endChat(p);
  h.ticks(3);
  assert.match(pageTexts(p)[0], /^Aww, that was the wrong key!/);
  assert.equal(session.data.correct, 0);
  assert.equal(p.configs.get(638), 0);
});

test('leaving the prison removes the event key', t => {
  const h = harness(t), p = audited(h), npc = h.spawn(p, 17);
  h.hooks['Evil Bob']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  h.ticks(6);
  const session = Teleports.sessionOf(p);
  p.slots[0] = new Item(6966, 1);
  assert.equal(p.getInventory().containsNumber(6966), true);
  Teleports.finish(session, { message: 'You leave the prison.' });
  assert.equal(p.getInventory().containsNumber(6966), false, 'the temporary key did not survive the event');
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('rewards go one at a time at the return tile: what fits is kept, the rest is placed there', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 10);
  h.hooks['Bee keeper']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  endChat(p);
  const session = Teleports.sessionOf(p);
  for (let slot = 0; slot < 27; slot++) p.slots[slot] = new Item(I.SHARK, 1);
  p.free = 1; p.messages.length = 0;
  Teleports.finish(session, { reward: [{ id: I.LAMP, amount: 1 }, { id: I.CAMO_TOP, amount: 1 }] });
  assert.equal(p.location.getX(), 3222, 'home again');
  assert.deepEqual(p.rewards, [I.LAMP]);
  assert.equal(h.drops.length, 1);
  const [drop] = h.drops;
  assert.ok(drop.getPosition().equals(p.location), 'dropped beside the return tile');
  assert.equal(drop.getItem().getId(), I.CAMO_TOP);
  // Live: an untradeable reward stays owner-only for its three hours.
  assert.equal(drop.getgoesGlobal(), false); assert.equal(drop.getDespawnDelay(), 18_000);
  assert.deepEqual(p.messages, [REWARD(1, 'Lamp'), PLACED(1, 'Camo top')]);
});

function enterEvilTwin(h, p, npc) {
  h.hooks['Postie Pete']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  endChat(p);
  assert.equal(p.animation, 1816);
  h.ticks(3);
  const session = Teleports.sessionOf(p);
  assert.ok(p.location.equals(new Location(1862, 5137, 0)));
  return session;
}

function openClaw(h, p) {
  h.hooks['object:Control panel'].Use({ player: p, handled: false,
    object: { getId: () => 20813, getLocation: () => new Location(1870, 5135, 0) } });
}

function clawOver(session, npc) {
  const [x, y] = session.data.claw;
  npc.location = new Location(x, y, 0);
}

test('Evil twin: claw locs and camera move per click, the twin is caged, Molly pays gems', t => {
  const h = harness(t), p = audited(h), npc = h.spawn(p, 18);
  const session = enterEvilTwin(h, p, npc);
  assert.equal(session.data.suspects.length, 5, 'the twin and four civilians');
  assert.equal(session.data.suspects.filter(entry => entry.id === session.data.twin.id).length, 1);
  h.hooks.Suspect.Grab({ player: p, handled: false });
  assert.deepEqual(pageTexts(p), ['You need to use the control panel to use the claw!']);
  openClaw(h, p);
  assert.ok(sentWith(p, 'sendCameraMoveTo', 1870, 5140, 675));
  assert.ok(sentWith(p, 'sendSubInterface', (161 << 16) | 74, 277, 0));
  h.emit('InterfaceActionClick', { player: p, buttonId: (277 << 16) | 7, action: 1 });
  assert.deepEqual(session.data.claw, [1869, 5132], 'component 7 moves the claw west');
  assert.ok(sentWith(p, 'sendObjectRemoval')); assert.ok(sentWith(p, 'sendObject')); assert.ok(sentWith(p, 'sendSound', 2273));
  const innocent = session.data.suspects[1], twin = session.data.twin;
  clawOver(session, innocent.npc);
  twin.npc.location = new Location(1800, 5000, 0);
  h.emit('InterfaceActionClick', { player: p, buttonId: (277 << 16) | 3, action: 1 });
  assert.equal(session.data.attempts, 1);
  innocent.npc.location = new Location(1800, 5001, 0);
  clawOver(session, twin.npc);
  h.emit('InterfaceActionClick', { player: p, buttonId: (277 << 16) | 3, action: 1 });
  assert.equal(session.data.caught, true);
  assert.equal(p.messages.at(-1), 'You caught the Evil twin!');
  assert.equal(twin.npc.animation, 4001);
  h.ticks(5);
  assert.equal(twin.npc.chat, "You're putting me in prison?!");
  h.ticks(11);
  assert.equal(innocent.npc, null, 'the civilians are sent home');
  h.ticks(4);
  assert.equal(p.messages.at(-1), 'Congratulations! You caught the evil twin.');
  assert.equal(pageTexts(p)[0], 'Well done! You managed to catch my sister!');
  h.hooks.Molly['Talk-to']({ player: p, npc: session.molly, handled: false });
  assert.equal(pageTexts(p)[0], "Well, I've managed to get her into the cage.");
  endChat(p);
  assert.equal(p.rewards.length, 1);
  assert.ok([1624, 1622, 1620, 1618].includes(p.rewards[0]), 'noted uncut gems');
  assert.ok(sentWith(p, 'sendJingle', 101));
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Evil twin: two wrong grabs earn a scolding and a fling; the door follows the transcript', t => {
  const h = harness(t), p = audited(h), npc = h.spawn(p, 18);
  const session = enterEvilTwin(h, p, npc);
  const door = { getId: () => 20817, getLocation: () => new Location(1864, 5137, 0) };
  h.hooks['object:Door'].Open({ player: p, handled: false, object: door });
  assert.deepEqual(pageTexts(p), ["Wait! Do you know what you're doing here?"]);
  session.data.briefed = true;
  h.hooks['object:Door'].Open({ player: p, handled: false, object: door });
  assert.ok(p.location.equals(new Location(1865, 5137, 0)), 'through the door');
  h.hooks['object:Door'].Open({ player: p, handled: false, object: door });
  assert.deepEqual(pageTexts(p), ['You need to finish grabbing my twin before you come back through!']);
  openClaw(h, p);
  const [first, second] = session.data.suspects.slice(1);
  for (const suspect of session.data.suspects) suspect.npc.location = new Location(1800, 5000, 0);
  clawOver(session, first.npc);
  h.emit('InterfaceActionClick', { player: p, buttonId: (277 << 16) | 3, action: 1 });
  first.npc.location = new Location(1800, 5000, 0);
  clawOver(session, second.npc);
  h.emit('InterfaceActionClick', { player: p, buttonId: (277 << 16) | 3, action: 1 });
  assert.equal(session.data.failed, true);
  assert.deepEqual(pageTexts(p), ['Well, you tried your best I suppose. Come next door and talk to me.']);
  h.hooks.Molly['Talk-to']({ player: p, npc: session.molly, handled: false });
  assert.match(pageTexts(p)[1], /^Such incompetence!/);
  endChat(p);
  assert.equal(p.rewards.length, 0);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.notEqual(p.location.getX(), 3222, 'flung to a wiki spot, not home');
});

function enterMaze(h, p, npc) {
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  endChat(p);
  return Teleports.sessionOf(p);
}

test('Maze chests cost potential, the shrine pays and timeouts leave empty-handed', t => {
  const h = harness(t), p = audited(h), npc = h.spawn(p, 19);
  const session = enterMaze(h, p, npc);
  assert.equal(session.data.potential, 100);
  assert.equal(p.messages.at(-1), 'Reach the maze centre as fast as possible.');
  assert.ok(sentWith(p, 'sendConfig', 531, 100));
  h.hooks['object:Chest'].Open({ player: p, handled: false,
    object: { getId: () => 14986, getType: () => 10, getFace: () => 0, getPrivateArea: () => null,
      getLocation: () => new Location(2890, 4599, 0) } });
  assert.equal(session.data.potential, 99);
  assert.equal(p.rewards.length, 1);
  h.advance(600 * 5);
  h.emit('PlayerProcess', { player: p });
  assert.equal(session.data.potential, 98, 'the chest cost survives the drain');
  p.totalLevel = 1000;
  h.hooks['object:Strange shrine'].Touch({ player: p, handled: false,
    object: { getId: () => 14985, getLocation: () => new Location(2911, 4575, 0) } });
  assert.equal(p.animation, 862);
  assert.ok(sentWith(p, 'sendJingle', 117));
  h.ticks(7);
  assert.equal(p.rewards.length, 4, 'three shrine rolls after the chest');
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.ok(sentWith(p, 'sendConfig', 531, 0));
  const q = audited(h), expired = h.spawn(q, 19);
  enterMaze(h, q, expired);
  h.advance(500 * 3000);
  h.emit('PlayerProcess', { player: q });
  assert.deepEqual(q.rewards, []);
  assert.equal(Teleports.sessionOf(q), undefined);
});

test('Maze gates put the player through, and 14981 refuses from the junction side', t => {
  const h = harness(t), p = audited(h), npc = h.spawn(p, 19);
  enterMaze(h, p, npc);
  const gate = (id, x, y, face) => ({ getId: () => id, getFace: () => face, getLocation: () => new Location(x, y, 0) });
  p.location = new Location(2888, 4587, 0);
  h.hooks['object:Gate'].Open({ player: p, handled: false, object: gate(14979, 2888, 4587, 2) });
  assert.ok(p.location.equals(new Location(2889, 4587, 0)));
  assert.ok(sentWith(p, 'sendSound', 62));
  h.hooks['object:Gate'].Open({ player: p, handled: false, object: gate(14979, 2888, 4587, 2) });
  assert.ok(p.location.equals(new Location(2888, 4587, 0)), 'and back again');
  p.location = new Location(2904, 4573, 0);
  h.hooks['object:Gate'].Open({ player: p, handled: false, object: gate(14981, 2904, 4573, 2) });
  assert.ok(p.location.equals(new Location(2904, 4573, 0)));
  assert.deepEqual(pageTexts(p), ["I don't think that's the right way."]);
});

const MIME_EMOTES = ['Think', 'Laugh', 'Climb rope', 'Glass box', 'Cry', 'Dance', 'Lean', 'Glass wall'];
const MIME_OUTFIT = [3057, 3058, 3059, 3060, 3061];
const MIME_ANIMATIONS = [857, 861, 1130, 1131, 860, 866, 1129, 1128];

function joinMime(h, p, random = 0.5) {
  const npc = h.spawn(p, 20);
  h.random(random);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
  assert.equal(openOptions(h, p).title, 'What would you like to say?');
  choose(h, p, 0);
  assert.deepEqual(pageTexts(p), ["Yeah, I'd love to do a mime show."]);
  endChat(p);
  assert.ok(p.location.equals(new Location(2008, 4764, 0)), 'every capture lands here first');
  assert.ok(p.messages.includes("You need to copy the mime's performance, then you'll return to where you were."));
  assert.deepEqual(pageTexts(p), ["You need to copy the mime's performance, then you'll be returned to where you were."]);
  endChat(p);
  assert.ok(p.location.equals(new Location(2008, 4762, 0)), 'continuing moves them onto the spotlight');
  return Teleports.sessionOf(p);
}

function clickEmote(h, p, index) {
  h.emit('InterfaceActionClick', { player: p, buttonId: (188 << 16) | (2 + index), action: 1 });
}

test('Mime copies four performances on the fixed loop, a wrong copy only cries', t => {
  const h = harness(t), p = eventPlayer(h);
  const session = joinMime(h, p);
  assert.notEqual(p.chatboxGroupId, 188, 'watch the performance before choosing');
  clickEmote(h, p, MIME_EMOTES.indexOf(session.data.emote.name));
  assert.equal(session.data.correct, 0, 'early packets cannot answer');
  h.ticks(9);
  assert.notEqual(p.chatboxGroupId, 188);
  h.ticks(1);
  assert.equal(p.chatboxGroupId, 188, 'ten ticks after the chat, as in 1855 and 1104');
  assert.notEqual(p.interfaceId, 188, 'emote choices belong in the chatbox');
  const wrong = MIME_EMOTES.findIndex(name => name !== session.data.emote.name);
  clickEmote(h, p, wrong);
  assert.equal(session.data.correct, 0);
  assert.equal(p.animation, MIME_ANIMATIONS[wrong], 'the player performs what they clicked');
  assert.notEqual(p.chatboxGroupId, 188, 'hide choices during the reaction');
  h.ticks(6);
  assert.equal(p.animation, MIME_ANIMATIONS[wrong]);
  h.ticks(1);
  assert.equal(p.animation, 860, 'cry seven ticks after the copy');
  h.ticks(22);
  assert.equal(p.chatboxGroupId, 188, '29 ticks per performance');
  for (let i = 0; i < 4; i++) {
    const index = MIME_EMOTES.indexOf(session.data.emote.name);
    clickEmote(h, p, index);
    clickEmote(h, p, index);
    assert.equal(session.data.correct, i + 1, 'one accepted answer per performance');
    assert.equal(p.animation, MIME_ANIMATIONS[index]);
    assert.notEqual(p.chatboxGroupId, 188);
    h.ticks(7);
    assert.equal(p.animation, 862);
    if (i < 3) h.ticks(22);
  }
  assert.deepEqual(p.rewards, [], 'home two ticks after the last cheer');
  h.ticks(2);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.equal(p.location.getX(), 3222);
  assert.equal(p.rewards.length, 2, 'one or two pieces');
  assert.ok(p.rewards.every(id => MIME_OUTFIT.includes(id)));
  h.ticks(100);
  assert.equal(p.rewards.length, 2);
});

function winMime(h, p, random) {
  const session = joinMime(h, p, random);
  h.ticks(10);
  for (let i = 0; i < 4; i++) {
    clickEmote(h, p, MIME_EMOTES.indexOf(session.data.emote.name));
    h.ticks(i < 3 ? 29 : 9);
  }
}

test('Mime emote rewards use the live message and message box', t => {
  const h = harness(t), p = eventPlayer(h);
  h.api.onCustomEvent('emotes:unlock', request => { request.unlocked = true; });
  winMime(h, p, 0.9);
  assert.deepEqual(p.rewards, []);
  assert.ok(sentWith(p, 'sendTypedMessage', 115));
  assert.match(pageTexts(p)[0], /^You can now use the (Glass Box|Climb Rope|Lean|Glass Wall) emote!$/);
});

test('Mime pays a lamp once the outfit and emotes are all owned', t => {
  const h = harness(t), p = eventPlayer(h);
  MIME_OUTFIT.forEach((id, slot) => { p.slots[slot] = new Item(id, 1); });
  winMime(h, p, 0.9);
  assert.deepEqual(p.rewards, [I.LAMP]);
});

test('Mime starts even if the intro chat is closed instead of continued', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 20);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 0);
  endChat(p);
  h.emit('PlayerProcess', { player: p });
  assert.ok(p.location.equals(new Location(2008, 4762, 0)));
  assert.equal(Teleports.sessionOf(p).data.phase, 'demonstrating');
});

test('Mime turns, performs and bows on the live ticks for each cache animation', t => {
  const h = harness(t), p = eventPlayer(h);
  const mime = h.api.spawnNpc({ id: N.MIME, x: 2011, y: 4762, z: 0 });
  h.api.getWorld = () => ({ getNpcsNear(location, radius) {
    return location.getDistance(mime.getLocation()) <= radius ? [mime] : [];
  } });
  MIME_ANIMATIONS.forEach((animation, index) => {
    joinMime(h, p, (index + 0.1) / 8);
    assert.ok(mime.faced.equals(new Location(2011, 4761, 0)), 'turns away first');
    h.ticks(2);
    assert.equal(mime.animation, animation, 'real stage NPC performs the chosen emote');
    h.ticks(6);
    assert.equal(mime.animation, 858, 'bows');
    assert.ok(mime.faced.equals(new Location(2008, 4762, 0)), 'at the player');
    h.ticks(1);
    assert.notEqual(p.chatboxGroupId, 188);
    h.ticks(1);
    assert.equal(p.chatboxGroupId, 188);
    Teleports.finish(Teleports.sessionOf(p));
  });
});

for (const exit of ['depart', 'logout', 'replacement', 'shutdown']) {
  test('Mime cancels a pending demonstration on ' + exit, t => {
    const h = harness(t), p = eventPlayer(h);
    const session = joinMime(h, p);
    const { npc } = session.active;
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
  const h = harness(t), p = eventPlayer(h);
  joinMime(h, p);
  h.ticks(10);
  assert.equal(p.chatboxGroupId, 188);
  Teleports.departed(p, false);
  assert.equal(p.chatboxGroupId, -1);

  const q = eventPlayer(h);
  const session = joinMime(h, q);
  h.ticks(10);
  for (let round = 0; round < 4; round++) {
    clickEmote(h, q, MIME_EMOTES.indexOf(session.data.emote.name));
    if (round < 3) h.ticks(29);
  }
  assert.equal(session.data.correct, 4);
  h.emit('PlayerLogout', { player: q });
  h.ticks(100);
  assert.equal(Teleports.sessionOf(q), undefined);
  assert.deepEqual(q.rewards, [], 'logging out during the final reaction does not grant a stale reward');
  assert.equal(q.chatboxGroupId, -1);
});

/** Talks to the Pillory Guard and goes quietly, returning the stay in the cage. */
function arrestPlayer(h, p, npc) {
  h.hooks['Pillory Guard']['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const session = Teleports.sessionOf(p);
  assert.ok(session, 'arrested');
  h.ticks(1); // The lock opens the tick after he arrives (1108 t16510).
  return session;
}

test('Pillory picks the matching key for each lock, wrong picks add a lock and reset', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 21);
  const session = arrestPlayer(h, p, npc);
  assert.equal(p.interfaceId, 27);
  assert.equal(session.data.locks, 3);
  assert.ok(sentWith(p, 'closeSubInterface', (161 << 16) | 79), 'the inventory tab is closed');
  assert.ok(sentWith(p, 'sendSubInterface', (162 << 16) | 567, 263, 1), 'the hint is on the chatbox overlay');
  assert.ok(sentWith(p, 'sendSound', 2275));
  // Every lock and its key in rsprox 1108, 1840 and 559.
  const FITS = { 13382: 13396, 13390: 4141, 13393: 11032, 13394: 13395 };
  assert.equal(p.models.get((27 << 16) | 3), session.data.shape);
  assert.equal(FITS[session.data.shape], session.data.target);
  assert.ok(session.data.keys.includes(session.data.target));
  const wrong = session.data.keys.findIndex(key => key !== session.data.target);
  h.emit('InterfaceActionClick', { player: p, buttonId: (27 << 16) | (7 + wrong), action: 1 });
  assert.equal(session.data.locks, 4);
  assert.equal(session.data.opened, 0);
  assert.equal(p.models.get((27 << 16) | 13), 9757, 'the fourth lock is drawn');
  assert.deepEqual(p.messages, []);
  for (let pick = 0; pick < 4; pick++) {
    const right = session.data.keys.findIndex(key => key === session.data.target);
    h.emit('InterfaceActionClick', { player: p, buttonId: (27 << 16) | (7 + right), action: 1 });
    if (pick === 0) assert.equal(p.models.get((27 << 16) | 10), 9758, 'an opened lock shows open');
  }
  assert.deepEqual(p.messages.slice(0, 3), ["You solved a lock! That's 1 down and 3 to go!",
    "You solved a lock! That's 2 down and 2 to go!", "You solved a lock! That's 3 down and 1 to go!"]);
  assert.ok(sentWith(p, 'sendSound', 2274));
  assert.equal(p.rewards.length, 0, 'the escape waits a tick');
  h.ticks(1);
  assert.equal(p.messages[3], "You've escaped!");
  assert.equal(p.rewards.length, 1);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.ok(sentWith(p, 'sendTabInterface', 0, 593), 'the tabs come back');
});

test('Pillory cage door reopens the locks inside the event and refuses outside it', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 21);
  const outsider = h.player();
  h.hooks['object:Cage'].Unlock({ player: outsider, handled: false });
  assert.equal(outsider.messages.at(-1), "You can't unlock the pillory, you'll let all the criminals out!");
  arrestPlayer(h, p, npc);
  p.interfaceId = -1;
  h.hooks['object:Cage'].Unlock({ player: p, handled: false });
  assert.equal(p.interfaceId, 27);
});

test('Pillory Tramp pelts the player with a tomato without hurting them', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 21);
  const tramp = { getId: () => 381, getLocation: () => new Location(3228, 3411, 0), forceChat(text) { this.said = text; },
    performAnimation(animation) { this.animation = animation.getId(); }, performGraphic(graphic) { this.graphic = graphic.id; } };
  h.npcs.push(tramp);
  arrestPlayer(h, p, npc);
  h.ticks(10);
  assert.equal(tramp.said, 'Take that you thief!');
  assert.equal(tramp.animation, 385);
  assert.equal(tramp.graphic, 30);
  assert.ok(p.sent.some(entry => entry[0] === 'sendProjectile' && entry[5] === 29));
  assert.equal(p.hp, 10);
});

test('Pillory Guard refuses with Hmmph and stays put', t => {
  const h = harness(t), p = eventPlayer(h), npc = h.spawn(p, 21);
  h.hooks['Pillory Guard']['Talk-to']({ player: p, npc, handled: false });
  choose(h, p, 1);
  assert.deepEqual(pageTexts(p), ["I'm not coming.", 'Hmmph!']);
  assert.equal(Teleports.sessionOf(p), undefined);
});

function joinExam(h, p, random) {
  const npc = h.spawn(p, 22);
  h.hooks.Dunce['Talk-to']({ player: p, npc, handled: false });
  assert.equal(openOptions(h, p).title, 'What would you like to say?');
  choose(h, p, 0);
  assert.deepEqual(pageTexts(p), ['Sure, I fancy an exam.']);
  h.random(random);
  endChat(p);
  assert.ok(p.location.equals(new Location(1886, 5025, 0)), 'every capture lands here');
  assert.ok(p.messages.includes('Answer three out of six questions correctly to succeed.'));
  assert.equal(pageTexts(p).length, 4);
  endChat(p);
  return Teleports.sessionOf(p);
}

function answerPattern(h, p, session, right) {
  const { choices, answer } = session.data.pattern;
  const index = right ? choices.indexOf(answer) : choices.findIndex(model => model !== answer);
  h.emit('InterfaceActionClick', { player: p, buttonId: (103 << 16) | (15 + index * 2), action: 1 });
}

const EXAM_DOOR = { getId: () => 9316, getLocation: () => new Location(1881, 5022, 0) };

test('Surprise Exam passes three pattern questions and the door pays the book', t => {
  const h = harness(t), p = eventPlayer(h);
  const session = joinExam(h, p, 0.9);
  assert.equal(p.interfaceId, 103);
  assert.ok(sentWith(p, 'sendClientScript', 51, (103 << 16) | 10), 'the sequence goes to components 10-12');
  assert.ok(p.messages.includes('Pick the object that should come next in the pattern.'));
  for (let question = 0; question < 2; question++) {
    answerPattern(h, p, session, true);
    assert.ok(sentWith(p, 'sendSound', 2274));
    assert.equal(pageTexts(p).at(-1), 'Pick the object that should come next in the pattern.');
    endChat(p);
  }
  answerPattern(h, p, session, true);
  assert.equal(session.data.passed, true);
  assert.ok(sentWith(p, 'sendJingle', 269));
  assert.equal(pageTexts(p).at(-1), 'To exit, use any of the doors in this room.');
  h.hooks['Mr. Mordaut']['Talk-to']({ player: p, npc: {}, handled: false });
  assert.deepEqual(pageTexts(p), ['To exit, use any of the doors in this room.']);
  h.hooks['object:Door'].Open({ player: p, handled: false, object: EXAM_DOOR });
  assert.deepEqual(p.rewards, [I.BOOK_OF_KNOWLEDGE]);
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Surprise Exam owned book: Mordaut says so and the door pays a wiki fallback', t => {
  const h = harness(t), p = eventPlayer(h);
  p.slots[0] = new Item(I.BOOK_OF_KNOWLEDGE, 1);
  const session = joinExam(h, p, 0.9);
  for (let question = 0; question < 3; question++) {
    answerPattern(h, p, session, true);
    if (question < 2) endChat(p);
  }
  assert.match(pageTexts(p)[1], /^Hmm, you already appear to have a Book of Knowledge\./);
  h.hooks['object:Door'].Open({ player: p, handled: false, object: EXAM_DOOR });
  assert.equal(p.rewards.length, 1);
  assert.notEqual(p.rewards[0], I.BOOK_OF_KNOWLEDGE);
  assert.notEqual(p.rewards[0], I.LAW_RUNE, 'the wiki list has a cosmic talisman, not a law rune');
});

test('Surprise Exam repeats a wrong question, fails on the third and pays nothing at the door', t => {
  const h = harness(t), p = eventPlayer(h);
  const session = joinExam(h, p, 0.9);
  const asked = session.data.question;
  answerPattern(h, p, session, false);
  assert.match(pageTexts(p)[1], /^Remember, the goal here is to find the pattern\./, 'the hint is only for the first');
  endChat(p);
  assert.equal(session.data.question, asked, 'the same question again');
  answerPattern(h, p, session, false);
  assert.equal(pageTexts(p).length, 2);
  endChat(p);
  answerPattern(h, p, session, false);
  assert.equal(session.data.passed, false);
  assert.equal(session.data.wrong, 3);
  assert.equal(pageTexts(p)[0], "How unfortunate, you FAILED. You'd better hit the books and study up for next time.");
  h.hooks['object:Door'].Open({ player: p, handled: false, object: EXAM_DOOR });
  assert.deepEqual(p.rewards, []);
  assert.equal(Teleports.sessionOf(p), undefined);
});

test('Surprise Exam cards use the live scripts and selection varp, and the door leaves early', t => {
  const h = harness(t), p = eventPlayer(h);
  const session = joinExam(h, p, 0.1);
  assert.equal(p.interfaceId, 559);
  assert.ok(sentWith(p, 'sendClientScript', 52, (559 << 16) | 21));
  assert.ok(p.messages.includes('Look at the hint on the right and find three objects related to it.'));
  const state = session.data.cards;
  const related = state.related.map(model => state.cards.indexOf(model));
  h.emit('InterfaceActionClick', { player: p, buttonId: (559 << 16) | 68, action: 1 });
  assert.equal(session.data.correct, 0, 'confirm needs three cards');
  let mask = 0;
  for (const card of related) {
    h.emit('InterfaceActionClick', { player: p, buttonId: (559 << 16) | (52 + card), action: 1 });
    mask |= 1 << card;
    assert.ok(sentWith(p, 'sendConfig', 1037, mask));
  }
  h.emit('InterfaceActionClick', { player: p, buttonId: (559 << 16) | 68, action: 1 });
  assert.equal(session.data.correct, 1);
  h.hooks['object:Door'].Open({ player: p, handled: false, object: EXAM_DOOR });
  assert.deepEqual(p.rewards, []);
  assert.equal(Teleports.sessionOf(p), undefined);
  assert.equal(p.location.getX(), 3222);
});

test('invitations share the timeline: Bob mews, refusals come from the transcripts, a decline leaves on the beat', t => {
  const h = harness(t), tick = (p, n = 1) => { for (let i = 0; i < n; i++) { h.advance(600); h.emit('PlayerProcess', { player: p }); } };
  const p = eventPlayer(h), other = eventPlayer(h), bob = h.spawn(p, 17);
  assert.equal(bob.definition.id, N.EVIL_BOB_3);
  tick(p); assert.match(bob.chat, /^(Mew!|Yowl!|Meeeow!|Meeeeow!)$/);
  tick(p, 99); assert.equal(bob.chat, 'Meeeeowby laaaater...');
  h.hooks['Evil Bob']['Talk-to']({ player: other, npc: bob, handled: false });
  assert.equal(other.dialogue.getDialogues().get(0).constructor.name, 'StatementDialogue');
  tick(p, 3); assert.equal(bob.removed, true);
  const cases = [[9, "Capt' Arnav", /Arrr, you're not the person I be needin'\./], [11, 'Quiz Master', /^Sorry, it's Player that's having the lucky day\.$/],
    [21, 'Pillory Guard', /^I'm here to arrest Player\.$/], [12, 'Sergeant Damien', null], [13, 'Freaky Forester', /^I'm looking for Player\.$/],
    [14, 'Leo', /^Sorry, I need help from Player\.$/], [15, 'Flippa', /^Nope, you wrong person\.$/], [18, 'Postie Pete', /^Sorry, I don't have any messages for you\.$/],
    [22, 'Dunce', /^Nope, you're not the one the teacher wanted me to find!$/], [10, 'Bee keeper', /^Sorry, you're not the person I need\.$/]];
  for (const [kind, name, line] of cases) {
    const q = eventPlayer(h), stranger = eventPlayer(h), npc = h.spawn(q, kind);
    assert.equal(npc.chat, undefined, name); tick(q); assert.ok(npc.chat, name);
    h.hooks[name]['Talk-to']({ player: stranger, npc, handled: false });
    if (line) assert.match(npcLines(stranger)[0], line, name); else assert.equal(stranger.dialogue, undefined, name);
    assert.deepEqual(stranger.messages, [], name);
    h.emit('PlayerLogout', { player: q });
  }
});

test('teleport refusal: silent without evidenced text, overhead when the event says so', t => {
  const h = harness(t), p = eventPlayer(h);
  h.api.core.Area ??= class {};
  h.api.core.Boundary ??= class {};
  const [area] = Teleports.createAreas();
  const npc = h.spawn(p, 20);
  h.hooks['Mysterious Old Man']['Talk-to']({ player: p, npc, handled: false });
  accept(h, p);
  const stay = Teleports.sessionOf(p);
  assert.equal(stay.teleportRefusalOverhead, true, 'the mime refuses overhead');
  p.chat = undefined; p.messages.length = 0;
  assert.equal(area.canTeleport(p), false);
  assert.equal(p.chat, 'I need to finish my performance!'); assert.deepEqual(p.messages, []);
  stay.teleportRefusal = null; p.chat = undefined;
  assert.equal(area.canTeleport(p), false); assert.equal(p.chat, undefined); assert.deepEqual(p.messages, []);
});

test('Mystery box members table has 15 slots: clue 2/15 by tier, nothing when that tier is held, rare drop 1/15', t => {
  const MysteryBox = require('../plugins/npcs/random-events/MysteryBox.RandomEvents');
  const h = harness(t), p = h.player();
  let allowed = true, rare = [];
  h.api.onCustomEvent('treasure-trails:can-receive', request => { request.seen = true; if (!allowed) request.allowed = false; });
  h.api.onCustomEvent('npc-drops:roll-table', request => { assert.equal(request.table.entries[0].shared_table, 'rareDrop'); request.drops.push(...rare); });
  const sequence = (...values) => t.mock.method(Math, 'random', () => values.shift() ?? 0);
  // First roll clears the baguette, second picks the slot, third the clue tier.
  sequence(0.5, 12.5 / 15, 9.5 / 20); assert.deepEqual(MysteryBox.roll(h.api, p), [{ id: I.CLUE_SCROLL_EASY_, amount: 1, clue: true }]);
  sequence(0.5, 13.5 / 15, 10.5 / 20); assert.deepEqual(MysteryBox.roll(h.api, p), [{ id: I.CLUE_SCROLL_MEDIUM_, amount: 1, clue: true }]);
  sequence(0.5, 13.5 / 15, 16.5 / 20); assert.deepEqual(MysteryBox.roll(h.api, p), [{ id: I.CLUE_SCROLL_HARD_, amount: 1, clue: true }]);
  allowed = false; sequence(0.5, 12.5 / 15, 0); assert.deepEqual(MysteryBox.roll(h.api, p), []);
  sequence(0.5, 14.5 / 15); assert.deepEqual(MysteryBox.roll(h.api, p), []);
  rare = [{ itemId: I.COINS, amount: 3000, noted: false }];
  sequence(0.5, 14.5 / 15); assert.deepEqual(MysteryBox.roll(h.api, p), [{ id: I.COINS, amount: 3000 }]);
  // Entrana swaps the scimitar and plate for noted bars.
  p.location = new Location(2830, 3350, 0);
  const seen = new Set();
  for (let slot = 0; slot < 12; slot++) { sequence(0.5, (slot + 0.5) / 15); seen.add(MysteryBox.roll(h.api, p)[0].id); }
  assert.ok(seen.has(2360) && seen.has(2354)); assert.ok(!seen.has(1329) && !seen.has(1119));
  const f2p = harness(t, false); const fp = f2p.player();
  const slots = new Set();
  for (let slot = 0; slot < 6; slot++) { sequence(0.5, (slot + 0.5) / 6); slots.add(MysteryBox.roll(f2p.api, fp)[0].id); }
  assert.equal(slots.size, 6);
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

test('Opening a mystery box says what is inside and hands it over through the reward path', t => {
  const h = harness(t), p = h.player();
  p.slots[0] = new Item(I.MYSTERY_BOX, 1);
  h.random(1 / 512);
  h.hooks['Mystery box'].Open({ player: p });
  assert.equal(p.slots[0], undefined);
  assert.deepEqual(p.rewards, [I.STALE_BAGUETTE]);
  assert.deepEqual(p.messages, ['Inside the box you find a baguette! Make of it what you will.',
    REWARD(1, `Item ${I.STALE_BAGUETTE}`)]);
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
