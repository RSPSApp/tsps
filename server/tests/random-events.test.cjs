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
const JekyllPlugin = require('../plugins/npcs/DrJekyll.plugin');
const Gift = require('../plugins/npcs/random-events/GiftRewards');
const PlantPlugin = require('../plugins/npcs/StrangePlant.plugin');
const { Animation } = require('../dist/game/model/Animation');
const { PlayerRights } = require('../dist/game/model/rights/PlayerRights');
const { ItemOnGround, State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');

function harness(t, members = true) {
  let now = 1_000, random = 0.5;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Math, 'random', () => random);
  t.mock.method(Item.prototype, 'getDefinition', function () { return { isStackable: () => this.getId() === I.COINS }; });
  const hooks = {}, npcs = [], prompts = [], drops = [];
  const custom = new Map();
  let enabled = true, blocked = () => false, movable = () => true;
  const api = {
    core: { Item, ItemIdentifiers: I, NpcIdentifiers: N, Skill, Location, Wilderness: { isPvpArea: () => false },
      WorldDefinition: { isMembersWorld: () => members }, Animation, PlayerRights },
    registerCommand(name, handler, rights, description) { hooks[name] = { handler, rights, description }; },
    onCustomEvent(name, cb) { custom.set(name, [...(custom.get(name) ?? []), cb]); },
    emitCustomEvent(name, event) { custom.get(name)?.forEach(cb => cb(event)); },
    getPluginConfig: () => enabled,
    getItemOnGroundManager: () => ({ DESPAWN_DELAY: 300, registerLocation(player, item, position) {
      const drop = new ItemOnGround(State.SEEN_BY_PLAYER, player.getUsername(), position, item, true, -1, null);
      drops.push(drop); return drop;
    } }),
    getRegionManager: () => ({ blocked: (...args) => blocked(...args), canMovestart: (...args) => movable(...args) }),
    spawnNpc(definition) {
      const npc = { definition, owner: definition.owner, location: new Location(definition.x, definition.y, definition.z),
        getOwner() { return this.owner; }, getLocation() { return this.location; },
        setFollowing(p) { this.following = p; }, setMobileInteraction(p) { this.interaction = p; },
        forceChat(text) { this.chat = text; }, performAnimation(animation) { this.animation = animation.getId(); } };
      npcs.push(npc); return npc;
    },
    removeNpc(npc) { npc.removed = true; },
    sendMultiChatboxPrompt(player, title, ...pairs) {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ label: pairs[i], cb: pairs[i + 1] });
      assert.ok(options.length <= 5);
      prompts.push({ player, title, options });
    },
    onNpcInteraction(name, actions) { hooks[name] = actions; },
    onItemAction(name, actions) { hooks[name] = actions; },
  };
  for (const name of ['ServerStartup', 'ServerShutdown', 'PlayerLogin', 'PlayerProcess', 'PlayerLogout',
    'PlayerDisconnect', 'PlayerDeath', 'InterfaceActionClick']) api[`on${name}`] = (cb) => (hooks[name] ??= []).push(cb);
  Plugin.register(api);
  const xpRewards = [];
  custom.set('xpreward:open', [request => xpRewards.push(request)]);
  if (members) { JekyllPlugin.register(api); PlantPlugin.register(api); }
  const emit = (name, event) => hooks[name].forEach(cb => cb(event));
  emit('ServerStartup');
  t.after(() => emit('ServerShutdown'));
  function player() {
    const slots = [], rewards = [], rewardItems = [], messages = [], xp = new Map(), levels = new Map();
    const p = { slots, rewards, rewardItems, messages, xp, levels, free: 28, online: true, hp: 10,
      location: new Location(3222, 3222, 0), interfaceId: -1,
      isRegistered: () => p.online, isPlayerBot: () => !!p.bot, getHitpoints: () => p.hp,
      getLocation: () => p.location, getUsername: () => 'Player', busy: () => !!p.isBusy,
      getCombat: () => ({ getTarget: () => p.target, getAttacker: () => p.attacker }),
      getPrivateArea: () => p.privateArea, getArea: () => p.area,
      getDueling: () => ({ inDuel: () => !!p.duel }), getForceMovement: () => p.movement,
      getInterfaceId: () => p.interfaceId, sendMessage: text => messages.push(text),
      getInventory: () => ({ get: slot => slots[slot], getItems: () => slots, getFreeSlots: () => p.free,
        containsNumber: id => slots.some(item => item?.getId() === id && item.getAmount() > 0),
        addItem(item) { rewards.push(item.getId()); rewardItems.push(item); },
        deleteAtSlot(slot) { slots[slot] = undefined; p.free++; } }),
      getSkillManager: () => ({ getMaxLevel: skill => levels.get(skill) ?? 1,
        getExperience: skill => xp.get(skill) ?? 0,
        addExperience(skill, amount, multipliers) {
          assert.equal(multipliers, false);
          if (!p.blockXp) xp.set(skill, Math.min(200_000_000, (xp.get(skill) ?? 0) + amount));
        } }),
      getPacketSender: () => ({ sendInterface(id) { p.interfaceId = id; },
        sendInterfaceRemoval() { p.interfaceId = -1; }, sendString(text, uid) {
          p.trayTitle = text; (p.strings ??= new Map()).set(uid, text);
        },
        sendItemOnInterfaces(uid, id) { (p.tray ??= []).push([uid, id]); },
        sendInterfaceFlagsRange(uid, from, to, flags) { (p.flags ??= []).push([uid, from, to, flags]); } }),
    };
    return p;
  }
  function spawn(p, kind = 0, food = 0) {
    enabled = true;
    random = 0.5; emit('PlayerLogin', { player: p }); now += 121 * 60_000;
    const values = [0.5, (kind + 0.1) / (members ? 8 : 6), (food + 0.1) / 7];
    t.mock.method(Math, 'random', () => values.shift() ?? random);
    emit('PlayerProcess', { player: p });
    t.mock.method(Math, 'random', () => random);
    return npcs.at(-1);
  }
  return { api, hooks, emit, npcs, prompts, drops, xpRewards, player, spawn,
    advance: ms => { now += ms; }, random: value => { random = value; },
    collision: (b, m) => { blocked = b; movable = m; }, disable: () => { enabled = false; } };
}

test('natural scheduling checks eligibility, traversable spawn squares, one follower and cooldown', t => {
  const h = harness(t), p = h.player();
  h.emit('PlayerLogin', { player: p }); h.emit('PlayerProcess', { player: p });
  assert.equal(h.npcs.length, 0);
  h.advance(121 * 60_000);
  for (const key of ['isBusy', 'target', 'attacker', 'privateArea', 'area', 'duel', 'movement']) {
    p[key] = true; h.emit('PlayerProcess', { player: p }); assert.equal(h.npcs.length, 0, key); p[key] = null;
  }
  p.location = new Location(3094, 3104, 0); h.emit('PlayerProcess', { player: p }); assert.equal(h.npcs.length, 0);
  p.location = new Location(3222, 3222, 0);
  h.collision(() => false, (_from, to) => to.getX() < p.location.getX());
  h.emit('PlayerProcess', { player: p }); const npc = h.npcs[0];
  assert.equal(npc.location.getX(), 3221, 'an unblocked tile across a wall is skipped');
  assert.equal(npc.following, p); assert.equal(npc.definition.ownerOnly, undefined);
  h.emit('PlayerProcess', { player: p }); assert.equal(h.npcs.length, 1);
  h.hooks['Sandwich lady'].Dismiss({ player: p, npc });
  h.emit('PlayerProcess', { player: p }); assert.equal(h.npcs.length, 1, 'dismissal re-arms cooldown');
});

test('bots and inaccessible squares cannot produce event NPCs', t => {
  const h = harness(t), p = h.player(); p.bot = true; h.spawn(p); assert.equal(h.npcs.length, 0);
  p.bot = false; h.collision(() => false, () => false); h.spawn(p); assert.equal(h.npcs.length, 0);
});

test('randevt is described and owner-only, selects each index immediately and replaces the owned event', t => {
  const h = harness(t), p = h.player(), command = h.hooks.randevt;
  assert.equal(command.rights, PlayerRights.OWNER);
  assert.match(command.description, /zero-based event index/);
  h.disable();
  const ids = [N.GENIE, N.SANDWICH_LADY, N.DRUNKEN_DWARF, N.RICK_TURPENTINE,
    N.MILES, N.MYSTERIOUS_OLD_MAN_2, N.DR_JEKYLL, N.STRANGE_PLANT];
  let previous;
  ids.forEach((id, index) => {
    const event = { player: p, parts: ['randevt', String(index)], handled: false };
    command.handler(event);
    assert.equal(event.handled, true);
    const npc = h.npcs.at(-1);
    assert.equal(npc.definition.id, id); assert.equal(npc.owner, p);
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
  for (const args of [['-1'], ['6'], ['7'], ['8'], ['1.5'], ['nope'], ['1x'], [''], ['1', '2']]) {
    command({ player: p, parts: ['randevt', ...args] });
    assert.match(p.messages.at(-1), /Usage:.*0-5/);
    assert.equal(h.npcs.length, 1); assert.equal(first.removed, undefined);
  }
  p.target = {}; command({ player: p, parts: ['randevt', '1'] });
  assert.equal(h.npcs.length, 1); assert.equal(first.removed, undefined);
  p.target = null; h.collision(() => true, () => false);
  command({ player: p, parts: ['randevt', '1'] });
  assert.equal(h.npcs.length, 1); assert.match(p.messages.at(-1), /No traversable square/);
  h.emit('PlayerProcess', { player: p }); assert.equal(h.npcs.length, 1, 'failed test retains the cooldown');
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
    [7, 'Strange plant', [[I.STRANGE_FRUIT, 1]]]]) {
    const p = h.player(), inventory = new Inventory(p), sender = p.getPacketSender();
    let refreshes = 0;
    sender.sendItemContainer = container => { assert.equal(container, inventory); refreshes++; };
    p.getPacketSender = () => sender;
    p.getInventory = () => inventory;
    const npc = h.spawn(p, index, 0);
    h.random(index === 1 ? 0.5 : 0);
    if (index === 7) h.advance(27_000);
    const interact = () => h.hooks[name][index === 7 ? 'Pick' : 'Talk-to']({ player: p, npc });
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
      if (reason === 'expiry') { h.advance(180_000); h.disable(); }
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
  h.advance(180_000); h.emit('PlayerProcess', { player: q }); certerChoice(h, q, 'Fish');
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
    if (reason === 'expired') h.advance(180_000);
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
  const h = harness(t), p = h.player(), npc = h.spawn(p, 7);
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
  const h = harness(t), p = h.player(), npc = h.spawn(p, 7);
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
    const p = h.player(), npc = h.spawn(p, 7);
    h.hooks['Strange plant'].Dismiss({ player: h.player(), npc }); assert.equal(npc.removed, undefined);
    if (reason === 'dismiss') h.hooks['Strange plant'].Dismiss({ player: p, npc });
    if (reason === 'logout') h.emit('PlayerLogout', { player: p });
    if (reason === 'expiry') { h.advance(180_000); h.emit('PlayerProcess', { player: p }); }
    if (reason === 'distance') { p.location = new Location(3300, 3300, 0); h.emit('PlayerProcess', { player: p }); }
    h.hooks['Strange plant'].Pick({ player: p, npc });
    assert.equal(npc.removed, true); assert.deepEqual(p.rewards, []);
  }
  assert.deepEqual(h.drops, []); assert.equal(PlantPlugin.members, true);
  const f2p = harness(t, false); assert.equal(f2p.hooks['Strange plant'], undefined);
  const p = f2p.player(), oldMan = f2p.spawn(p, 5);
  assert.equal(oldMan.definition.id, N.MYSTERIOUS_OLD_MAN_2, 'F2P includes the Old Man without members definitions');
});
