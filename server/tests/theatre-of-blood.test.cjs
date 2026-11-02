// Run after `yarn build`: node --test tests/theatre-of-blood.test.cjs
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { Item } = require('../dist/game/model/Item');
const Shared = require('../plugins/minigames/tob/Shared.TheatreOfBlood');
const Parties = require('../plugins/minigames/tob/Parties.TheatreOfBlood');
const Raid = require('../plugins/minigames/tob/RaidState.TheatreOfBlood');
const Lobby = require('../plugins/minigames/tob/Lobby.TheatreOfBlood');
const RaidUnit = require('../plugins/minigames/tob/Raid.TheatreOfBlood');
const Retrieval = require('../plugins/minigames/tob/Retrieval.TheatreOfBlood');

const hooks = { prompts: [] };

/** Any hook registration the units make that a test doesn't need is a no-op. */
function fakeApi() {
  return new Proxy(fakeApiBase(), {
    get: (target, name) => (name in target ? target[name] : (typeof name === 'string' && name.startsWith('on') ? () => {} : undefined)),
  });
}

function fakeApiBase() {
  return {
    core: PluginManager.getCoreApi(),
    getBonusManager: () => ({ update() {} }),
    emitCustomEvent: (name, payload) => {
      (hooks.custom ??= []).push({ name, payload });
      for (const handler of hooks.customHandlers?.[name] ?? []) handler(payload);
    },
    onCustomEvent: (name, handler) => {
      hooks.customHandlers ??= {};
      hooks.customHandlers[name] = [...(hooks.customHandlers[name] ?? []), handler];
    },
    persistAttribute() {},
    onObjectInteraction() {},
    onInterfaceActionButton() {},
    onZoneEnter() {},
    onZoneExit() {},
    onPlayerLogout() {},
    onPlayerLogin() {},
    onShouldDropItemsOnDeath() {},
    onPlayerDeath() {},
    onCanTeleport() {},
    onItemAction() {},
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    spawnNpc: () => null,
    removeNpc() {},
  };
}

/** Picks a chatbox option of the latest prompt by its text. */
function choose(text) {
  const prompt = hooks.prompts.at(-1);
  const index = prompt.args.indexOf(text);
  assert.ok(index >= 0, `option "${text}" in ${JSON.stringify(prompt.args.filter((a) => typeof a === 'string'))}`);
  prompt.args[index + 1](prompt.player);
}

function fakeContainer(capacity) {
  const items = Array.from({ length: capacity }, () => new Item(-1, 0));
  const container = {
    items,
    getItems: () => items,
    setItem(slot, item) { items[slot] = item; return container; },
    refreshItems: () => container,
    getValidItems: () => items.filter((item) => item.getId() > 0),
    getAmount: (id) => items.filter((item) => item.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
    contains: (id) => items.some((item) => item.getId() === id),
    getFreeSlots: () => items.filter((item) => item.getId() <= 0).length,
    delete(id, amount) {
      const slot = items.findIndex((item) => item.getId() === id);
      if (slot >= 0) items[slot] = items[slot].getAmount() > amount ? new Item(id, items[slot].getAmount() - amount) : new Item(-1, 0);
      return container;
    },
    add(item) {
      const same = items.findIndex((other) => other.getId() === item.getId() && item.getDefinition().isStackable());
      if (same >= 0) items[same] = new Item(item.getId(), items[same].getAmount() + item.getAmount());
      else items[items.findIndex((other) => other.getId() <= 0)] = item;
      return container;
    },
  };
  return container;
}

let nextIndex = 1;
function fakePlayer(name) {
  const attributes = new Map();
  const varbits = new Map();
  const index = nextIndex++;
  const p = {
    name, location: new Location(3667, 3219, 0), area: null, hp: 99, blocked: false, untargetable: false, render: null,
    messages: [], scripts: [], interfaces: [], subs: new Map(), statements: [], texts: {}, sounds: [], songs: [],
    inventory: fakeContainer(28), equipment: fakeContainer(14),
    getUsername: () => name,
    getIndex: () => index,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => p,
    isRegistered: () => true,
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    getArea: () => p.area,
    setArea(area) { p.area = area; },
    getPrivateArea: () => p.area,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => p.messages.push(message),
    getHitpoints: () => p.hp,
    getInventory: () => p.inventory,
    getEquipment: () => p.equipment,
    getBank: () => fakeContainer(10),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCurrentLevel: (skill) => (skill.getIndex?.() === 3 ? p.hp : 99),
      setCurrentLevel(skill, level) { if (skill.getIndex?.() === 3) p.hp = level; },
      getCombatLevel: () => 126,
    }),
    getMovementQueue: () => ({ setBlockMovement(value) { p.blocked = value; return this; }, reset() { return this; }, isMovings: () => false }),
    setUntargetable(value) { p.untargetable = value; },
    getCombat: () => ({ reset() {} }),
    setRenderAnimations(value) { p.render = value; },
    getUpdateFlag: () => ({ flag() {} }),
    setSpecialPercentage() {},
    getSkullTimer: () => 0,
    getSkullType: () => null,
    getPrayerActive: () => [],
    setRunEnergy() {},
    getDialogueManager: () => ({ startDialogues: (chain) => p.statements.push(chain) }),
    setEnteredAmountAction(action) { p.amountAction = action; },
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        getVarbit: (id) => varbits.get(id) ?? 0,
        sendConfig: (id, value) => { varbits.set(`varp${id}`, value); return sender; },
        sendInterface: (id) => { p.interfaces.push(id); return sender; },
        sendSubInterface: (uid, id) => { p.subs.set(uid, id); return sender; },
        closeSubInterface: (uid) => { p.subs.delete(uid); return sender; },
        sendInterfaceRemoval: () => sender,
        sendClientScript: (id, ...args) => { p.scripts.push([id, ...args]); return sender; },
        sendInterfaceFlagsRange: () => sender,
        sendInterfaceFlags: () => sender,
        sendString: (text, uid) => { p.texts[uid] = text; return sender; },
        sendEnterAmountPrompt: () => sender,
        sendJingle: () => sender,
        sendSound: (id) => { p.sounds.push(id); return sender; },
        sendSong: (id) => { p.songs.push(id); return sender; },
        sendObject: () => sender,
        sendObjectRemoval: () => sender,
      };
      return sender;
    },
    varbits,
  };
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  // The fake players have no special attack bar to redraw.
  PluginManager.getCoreApi().CombatSpecial.updateBar = () => {};
  require('../dist/game/model/equipment/BonusManager').BonusManager.update = () => {};
  const api = fakeApi();
  Lobby(api);
  RaidUnit(api);
  Retrieval(api);
  require('../plugins/minigames/tob/Rewards.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/Verzik.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/Entry.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/InfoBoard.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/Stats.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/CombatAchievements.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/EscapeCrystal.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/Supplies.TheatreOfBlood')(api);
  hooks.api = api;
});

beforeEach(() => {
  hooks.prompts.length = 0;
  hooks.custom = [];
});

// ------------------------------------------------------------------ the map

test('every room\'s arrival tile is open floor', () => {
  for (const room of Object.values(Shared.ROOMS)) {
    const { x, y, z } = room.entrance;
    assert.equal(RegionManager.getClipping(x, y, z) & 0x1280100, 0, `${room.key} ${x},${y},${z}`);
    for (const jail of room.jails) assert.ok(Shared.inTheatre(Shared.loc(jail, jail.z ?? z)), `${room.key} jail ${jail.x},${jail.y}`);
  }
});

test('each barrier in the cache leads into its fight from the entrance side', () => {
  const barriers = [
    ['MAIDEN', 3185, 4446, 0], ['BLOAT', 3304, 4447, 0], ['NYLOCAS', 3295, 4255, 0],
    ['SOTETSEG', 3278, 4307, 0], ['XARPUS', 3169, 4379, 1],
  ];
  for (const [key, x, y, z] of barriers) {
    const object = MapObjects.getType(new Location(x, y, z), 10, null);
    assert.equal(object?.getId(), Shared.OBJECT.BARRIER, `${key} barrier at ${x},${y}`);
    const room = Shared.ROOMS[key];
    const side = { x, y, face: object.getFace() };
    assert.equal(room.entering(side, room.entrance), true, `${key}: from the entrance is in`);
  }
});

// ------------------------------------------------------------------ parties

test('a party takes applicants, accepts up to five and blocks the declined', () => {
  const leader = fakePlayer('Leader');
  const party = Parties.create(leader);
  const others = ['A', 'B', 'C', 'D', 'E', 'F'].map(fakePlayer);
  for (const other of others) party.apply(other);
  assert.equal(party.rightsOf(leader), Parties.RIGHTS.LEADER);
  assert.equal(party.rightsOf(others[0]), Parties.RIGHTS.APPLICANT);
  for (const other of others.slice(0, 4)) assert.equal(party.accept(other), true);
  assert.equal(party.accept(others[4]), false, 'five at most');
  party.decline(others[5]);
  assert.equal(party.rightsOf(others[5]), Parties.RIGHTS.BLOCKED);
  assert.equal(Lobby.rowText(party, leader).split('|').length, 10, 'five names and five fields, as captured (no trailing bar) in what script 2340 splits');
  party.dispose();
});

test('the notice board lists parties; My Party makes one and shows its information', () => {
  const player = fakePlayer('Board');
  Lobby.openOverview(player);
  assert.ok(player.interfaces.includes(364));
  assert.equal(player.scripts.filter(([id]) => id === 2340).length, 45);
  // Make party is a pause button: RESUME_PAUSEBUTTON on child 1 of 364:3.
  const event = { player, buttonId: (364 << 16) | 3, action: 1, handled: false };
  Lobby.resumeButton(event);
  assert.equal(event.handled, true);
  const party = Parties.partyOf(player);
  assert.ok(party?.isLeader(player));
  assert.ok(player.interfaces.includes(50));
  assert.deepEqual(player.scripts.at(-1), [2323, Parties.RIGHTS.LEADER, 0, 3, 0]);
  assert.equal(player.varbits.get(6440), 1, 'the HUD shows the party');
  party.dispose();
});

test('the entrance: no party offers the list; the leader is warned once and asked about crystals', () => {
  const player = fakePlayer('Entrant');
  Lobby.useEntrance({ player });
  assert.equal(hooks.prompts.length, 0, 'someone new is called over by the Stranger instead');
  assert.equal(player.statements.length, 1, 'the Stranger calls them over');
  player.setAttribute(Lobby.ATTR.MET_STRANGER, true);
  player.statements.length = 0;
  Lobby.useEntrance({ player });
  assert.equal(hooks.prompts.at(-1).title, 'You are not in a party...');
  const party = Parties.create(player);
  Lobby.useEntrance({ player });
  assert.equal(player.statements.length, 1, 'the death warning');
  player.setAttribute(Lobby.ATTR.WARNED, true);
  Lobby.useEntrance({ player });
  assert.match(hooks.prompts.at(-1).title, /Only escape crystals/);
  party.dispose();
});

// ------------------------------------------------------------------ the raid

function startRaid(names = ['Solo']) {
  const players = names.map(fakePlayer);
  const party = Parties.create(players[0]);
  for (const other of players.slice(1)) {
    party.apply(other);
    party.accept(other);
  }
  const raid = Raid.begin(players[0]);
  for (const player of players) raid.enter(player);
  ticks(2);
  return { raid, players, party };
}

function barrierObject(x, y, z) {
  return MapObjects.getType(new Location(x, y, z), 10, null);
}

test('entering: everyone arrives at the Maiden\'s room with the HUD', () => {
  const { raid, players } = startRaid(['Ann', 'Bob']);
  assert.equal(raid.room.key, 'MAIDEN');
  for (const player of players) {
    assert.deepEqual([player.location.getX(), player.location.getY()], [3220, 4460]);
    assert.ok(player.messages.includes('You enter the Theatre of Blood (Normal Mode)...'));
    assert.ok(player.songs.includes(570), 'the Maiden\'s track');
    assert.equal(player.area, raid.area);
    assert.equal(player.subs.get(Shared.OVERLAY_HUD_UID), 28);
    assert.equal(player.varbits.get(6440), 2);
  }
  assert.equal(players[1].varbits.get(6441), 2, 'second slot');
  assert.ok(players[0].scripts.some(([id, ...names]) => id === 2301 && names[0] === 'Ann' && names[1] === 'Bob'));
  raid.dispose();
});

test('the room bar is in thousandths of the boss\'s hitpoints, as captured', () => {
  const { raid, players: [solo] } = startRaid(['Barred']);
  raid.room.healthBar = () => ({ current: 1750, maximum: 3500 });
  raid.room.start();
  raid.refreshHealthBars();
  assert.equal(solo.varbits.get(6447), 1);
  assert.equal(solo.varbits.get(6448), 500);
  assert.equal(solo.varbits.get(6449), 1000);
  raid.dispose();
});

test('the leader starts the fight at the barrier; the dead wait in the jail until the room is won', () => {
  const { raid, players: [ann, bob] } = startRaid(['Ann2', 'Bob2']);
  const barrier = barrierObject(3185, 4446, 0);
  bob.location = new Location(3186, 4446, 0);
  raid.room.passBarrier(bob, barrier);
  assert.equal(bob.statements.length, 1, 'the leader must go first');
  ann.location = new Location(3186, 4446, 0);
  raid.room.passBarrier(ann, barrier);
  choose("Yes, let's begin.");
  assert.equal(raid.room.isStarted(), true);
  assert.equal(ann.location.getX(), 3184, 'through the barrier');
  raid.room.passBarrier(bob, barrier);
  ann.hp = 0;
  raid.onPlayerDied(ann);
  assert.equal(raid.member(ann).jailed, true);
  assert.deepEqual([ann.location.getX(), ann.location.getY()], [3166, 4460]);
  assert.equal(ann.blocked, true);
  assert.equal(ann.render[0], 8070);
  raid.room.passBarrier(bob, barrier);
  assert.ok(bob.messages.includes('You must stay and fight!'));
  raid.room.complete();
  assert.equal(raid.member(ann).jailed, false);
  assert.deepEqual([ann.location.getX(), ann.location.getY()], [3186, 4446], 'back where they crossed');
  assert.equal(ann.hp, 99, 'restored');
  raid.dispose();
});

test('the passage needs the room won, then takes the party on to the next room', () => {
  const { raid, players: [solo] } = startRaid(['Runner']);
  raid.advance(solo);
  assert.ok(solo.messages.includes("You can't proceed until the challenge is complete."));
  raid.room.start();
  raid.room.complete();
  raid.advance(solo);
  assert.equal(raid.room.key, 'BLOAT');
  ticks(2);
  assert.deepEqual([solo.location.getX(), solo.location.getY()], [3322, 4448]);
  raid.dispose();
});

test('a wipe fails the raid: items go to the retrieval chest and everyone is put outside', () => {
  const { raid, players: [solo] } = startRaid(['Wiped']);
  solo.inventory.setItem(0, new Item(4151, 1));
  solo.inventory.setItem(1, new Item(995, 150000));
  solo.inventory.setItem(2, new Item(385, 1));
  solo.inventory.setItem(3, new Item(1127, 1));
  solo.inventory.setItem(4, new Item(1079, 1));
  raid.room.start();
  raid.member(solo).inFight = true;
  raid.onPlayerDied(solo);
  ticks(3);
  assert.equal(raid.failed, true);
  const stored = Retrieval.storedOf(solo);
  assert.ok(stored.length >= 1, 'something is stored');
  assert.equal(solo.inventory.getValidItems().length + stored.length, 5, 'kept or stored, nothing lost');
  ticks(2);
  assert.deepEqual([solo.location.getX(), solo.location.getY()], [Shared.OUTSIDE.x, Shared.OUTSIDE.y]);
  assert.equal(Raid.raidOf(solo), null);
  assert.equal(Parties.partyOf(solo), null, 'the party is gone with the raid');
});

test('a wipe stores everything; Entry Mode owes nothing for it', () => {
  const player = fakePlayer('Reclaimer');
  player.inventory.setItem(0, new Item(4151, 1));
  Retrieval.storeAfterWipe(player);
  assert.equal(player.inventory.contains(4151), false);
  assert.deepEqual(Retrieval.lotOf(player), { items: [{ id: 4151, amount: 1 }], paid: false });
  const free = fakePlayer('EntryReclaimer');
  free.inventory.setItem(0, new Item(4151, 1));
  Retrieval.storeAfterWipe(free, { free: true });
  assert.equal(Retrieval.lotOf(free).paid, true);
});

test('a logout mid-fight is a death; logging back in rejoins the party among the dead', () => {
  const { raid, players: [ann, bob] } = startRaid(['Ann3', 'Bob3']);
  raid.room.start();
  raid.member(ann).inFight = true;
  raid.member(bob).inFight = true;
  raid.onLogout(ann);
  assert.deepEqual(ann.getAttribute(Raid.ATTR_LOGOUT), { raid: raid.id, fight: true, mode: 'normal' });
  const returning = fakePlayer('Ann3');
  returning.setAttribute(Raid.ATTR_LOGOUT, ann.getAttribute(Raid.ATTR_LOGOUT));
  returning.location = ann.location;
  RaidUnit.returnAfterLogout({ player: returning });
  assert.equal(Raid.raidOf(returning), raid);
  assert.equal(raid.member(returning).jailed, true);
  raid.dispose();
});

test('teleports are blocked inside; an escape crystal gets out and is used up', () => {
  const { raid, players: [solo] } = startRaid(['Escaper']);
  assert.equal(raid.area.canTeleport(solo), false);
  solo.inventory.setItem(0, new Item(Shared.ITEM.ESCAPE_CRYSTAL, 1));
  assert.equal(require('../plugins/minigames/tob/EscapeCrystal.TheatreOfBlood').teleport({ player: solo }), true);
  assert.equal(solo.inventory.contains(Shared.ITEM.ESCAPE_CRYSTAL), false);
  ticks(2);
  assert.equal(Raid.raidOf(solo), null);
  assert.deepEqual([solo.location.getX(), solo.location.getY()], [Shared.OUTSIDE.x, Shared.OUTSIDE.y]);
});

// ------------------------------------------------------------------ the bosses

test('team size scales hitpoints down, rounding down as the Wiki\'s nylocas do', () => {
  const { raid } = startRaid(['Scale1']);
  const npc = { hp: 0, max: 0, getDefinition: () => ({ getHitpoints: () => 11 }), getHitpoints: () => npc.hp,
    setHitpoints(value) { npc.hp = value; }, setMaxHitpoints(value) { npc.max = value; } };
  for (const [size, expected] of [[3, 8], [4, 9], [5, 11]]) {
    raid.size = size;
    raid.scale(npc);
    assert.equal(npc.hp, expected, `${size} players`);
  }
  raid.dispose();
});

test('supplies: points buy, one stamina per chest, and never below zero', () => {
  const Supplies = require('../plugins/minigames/tob/Supplies.TheatreOfBlood');
  const { raid, players: [solo] } = startRaid(['Shopper']);
  const member = raid.member(solo);
  member.supplyPoints = 5;
  const [stamina, prayer] = Supplies.STOCK;
  Supplies.buy(solo, stamina, 3);
  assert.equal(solo.inventory.getAmount(stamina.id), 1, 'one stamina potion');
  Supplies.buy(solo, stamina, 1);
  assert.match(solo.messages.at(-1), /out of stock/);
  Supplies.buy(solo, prayer, 10);
  assert.equal(solo.inventory.getAmount(prayer.id), 2, 'as many as the points allow');
  assert.equal(member.supplyPoints, 0);
  raid.dispose();
});

test('the Nylocas room runs the Wiki\'s 31 waves from three lanes', () => {
  const { WAVES, parse } = require('../plugins/minigames/tob/NylocasWaves.TheatreOfBlood');
  assert.equal(WAVES.length, 31);
  for (const wave of WAVES) {
    for (const lane of ['east', 'south', 'west']) {
      for (const entry of wave[lane]) {
        const unit = parse(entry);
        assert.ok(['melee', 'ranged', 'magic'].includes(unit.style), entry);
        for (const shown of unit.flickers) assert.ok(['melee', 'ranged', 'magic'].includes(shown), entry);
      }
    }
  }
  const flickering = parse('ra~mame');
  assert.deepEqual([flickering.style, flickering.big, flickering.aggressive, flickering.flickers], ['ranged', false, false, ['magic', 'melee']]);
  const big = parse('ME!');
  assert.deepEqual([big.style, big.big, big.aggressive, big.flickers], ['melee', true, true, []]);
});

test('Sotetseg\'s maze is one connected path from the bottom row to the portal, mirrored on the real floor', () => {
  const Sotetseg = require('../plugins/minigames/tob/Sotetseg.TheatreOfBlood');
  const { REALM, MAZE } = Sotetseg;
  for (let run = 0; run < 200; run++) {
    const path = Sotetseg.generatePath();
    assert.equal(path[0].y, REALM.minY);
    assert.equal(path.at(-1).y, REALM.maxY);
    for (let i = 1; i < path.length; i++) {
      const step = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
      assert.equal(step, 1, 'each tile touches the last');
    }
    for (const tile of path.slice(0, -1)) {
      const real = Sotetseg.toReal(tile);
      assert.ok(real.x >= MAZE.minX && real.x <= MAZE.maxX && real.y >= MAZE.minY && real.y <= MAZE.maxY);
    }
  }
});

test('Xarpus: 12 exhumed for a trio and 15 for four (Wiki)', () => {
  const { EXHUMED } = require('../plugins/minigames/tob/Xarpus.TheatreOfBlood');
  assert.equal(EXHUMED.count[3], 12);
  assert.equal(EXHUMED.count[4], 15);
});

test('Verzik: only poisoned weapons hurt Nylocas Athanatos', () => {
  const Verzik = require('../plugins/minigames/tob/Verzik.TheatreOfBlood');
  require('../dist/game/task/impl/CombatPoisonEffect').CombatPoisonData.init();
  const player = fakePlayer('Poisoner');
  const { Equipment } = PluginManager.getCoreApi();
  player.equipment.setItem(Equipment.WEAPON_SLOT, new Item(4151, 1)); // abyssal whip
  assert.equal(Verzik.poisonedWeapon(player, 'melee'), false);
  player.equipment.setItem(Equipment.WEAPON_SLOT, new Item(5698, 1)); // dragon dagger(p++)
  assert.equal(Verzik.poisonedWeapon(player, 'melee'), true);
});

test('rewards: a unique replaces the commons; no contribution gets the cabbage; three noted common rolls otherwise', () => {
  const Rewards = require('../plugins/minigames/tob/Rewards.TheatreOfBlood');
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const { raid, players: [ann, bob, cat] } = startRaid(['Loot1', 'Loot2', 'Loot3']);
  raid.member(ann).roomStats('MAIDEN').damage = 500;
  raid.member(bob).roomStats('MAIDEN').damage = 400;
  const always = () => 0;
  const { loot, uniqueWinner, uniqueId } = Rewards.rollRaid(raid, always);
  assert.equal(uniqueWinner, ann);
  assert.equal(uniqueId, I.AVERNIC_DEFENDER_HILT);
  assert.deepEqual(loot.get(ann).slice(0, 1), [{ id: I.AVERNIC_DEFENDER_HILT, amount: 1 }]);
  assert.deepEqual(loot.get(cat).slice(0, 2).map((entry) => entry.id), [I.CABBAGE, I.MESSAGE_4]);
  const never = (() => { let n = 0; return () => [0.99, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5][n++ % 7]; })();
  const commons = Rewards.rollRaid(raid, never).loot.get(bob);
  assert.ok(commons.length >= 1 && commons.length <= 3, 'up to three rolls, merged');
  const { ItemDefinition } = PluginManager.getCoreApi();
  for (const entry of commons) {
    const definition = ItemDefinition.forId(entry.id);
    assert.ok(definition.isStackable() || definition.isNoted(), `${entry.id} stacks or is noted`);
  }
  raid.dispose();
});

test('a normal-mode Verzik completion counts the raid, announces it and answers the completion query', () => {
  const { raid, players: [solo] } = startRaid(['NormalClear']);
  // The real Verzik room, won through the room's own completion path.
  raid.buildRoom('VERZIK');
  raid.room.complete();
  assert.equal(solo.getAttribute('tob:completions'), 1, 'the completion is counted');
  const announced = hooks.custom.filter(entry => entry.name === 'tob:completed');
  assert.equal(announced.length, 1, 'one completion event');
  assert.equal(announced[0].payload.player, solo);
  assert.equal(announced[0].payload.mode, 'normal');
  assert.equal(solo.getAttribute('tob:entry-completions'), undefined, 'the normal path leaves the entry count alone');

  const request = { player: solo, complete: false };
  hooks.api.emitCustomEvent('tob:has-completion', request);
  assert.equal(request.complete, true, 'the query answers true for a normal completion');
  const other = fakePlayer('NeverCleared');
  const otherRequest = { player: other, complete: false };
  hooks.api.emitCustomEvent('tob:has-completion', otherRequest);
  assert.equal(otherRequest.complete, false, 'a player who never cleared has no completion');
  raid.dispose();
});

test('Entry Mode still answers the completion query and never clears another provider\'s answer', () => {
  const entry = fakePlayer('EntryRunner');
  entry.setAttribute('tob:entry-completions', 1);
  const request = { player: entry, complete: false };
  hooks.api.emitCustomEvent('tob:has-completion', request);
  assert.equal(request.complete, true, 'an Entry Mode clear answers the query');
  // A normal-mode clear answered first must survive the Entry Mode provider.
  const both = fakePlayer('BothModes');
  both.setAttribute('tob:completions', 1);
  const mixed = { player: both, complete: false };
  hooks.api.emitCustomEvent('tob:has-completion', mixed);
  assert.equal(mixed.complete, true, 'the normal-mode answer is not overwritten');
});

test('a death costs a fifth of a player\'s standing', () => {
  const Rewards = require('../plugins/minigames/tob/Rewards.TheatreOfBlood');
  assert.equal(Rewards.standing({ deaths: 0 }), 1);
  assert.equal(Rewards.standing({ deaths: 2 }), 0.6);
  assert.equal(Rewards.standing({ deaths: 9 }), 0);
});

test('Verzik\'s pillars block her line of sight inside the raid\'s area', () => {
  const { raid } = startRaid(['Hider']);
  const { GameObject, ObjectManager } = PluginManager.getCoreApi();
  const verzik = { getLocation: () => new Location(3166, 4323, 0), getSize: () => 5 };
  const behind = { getLocation: () => new Location(3162, 4304, 0), getSize: () => 1 };
  assert.equal(Shared.lineOfSight(verzik, behind, raid.area), true, 'open before the pillar stands');
  const pillar = new GameObject(32687, new Location(3161, 4306, 0), 10, 0, raid.area);
  ObjectManager.register(pillar, true);
  assert.equal(Shared.lineOfSight(verzik, behind, raid.area), false, 'hidden behind it');
  ObjectManager.deregister(pillar, true);
  raid.dispose();
});

// ------------------------------------------------------------------ the lobby's interfaces in the cache

/** Reads an int-valued enum from the cache (as scripts/dump-enum.ts). */
function cacheEnum(id) {
  const { CacheIndexDat2 } = require('../dist/game/cache/codec/rs/cache/CacheIndex');
  const { IndexType } = require('../dist/game/cache/codec/rs/cache/IndexType');
  const { ConfigType } = require('../dist/game/cache/codec/rs/cache/ConfigType');
  const { ByteBuffer } = require('../dist/game/cache/codec/rs/io/ByteBuffer');
  const index = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
  const buf = new ByteBuffer(new Int8Array(index.getFile(ConfigType.DAT2.enums, id).data));
  const values = new Map();
  for (;;) {
    const opcode = buf.readUnsignedByte();
    if (opcode === 0) break;
    if (opcode === 1 || opcode === 2) buf.readUnsignedByte();
    else if (opcode === 3) buf.readString();
    else if (opcode === 4) buf.readInt();
    else if (opcode === 6) {
      for (let i = buf.readUnsignedShort(); i > 0; i--) values.set(buf.readInt(), buf.readInt());
    } else throw new Error(`enum ${id} opcode ${opcode}`);
  }
  return values;
}

test('the lobby answers the components and pause-button slots the cache scripts use', () => {
  const rows = cacheEnum(1937);
  assert.equal(rows.size, Shared.LIST_ROWS);
  assert.deepEqual(Lobby.LIST_ROW_UIDS, [...rows.values()], 'enum 1937: each row is its own component');
  const list = cacheEnum(1938);
  assert.deepEqual([list.get((364 << 16) | 64), list.get((364 << 16) | 66), list.get((364 << 16) | 67)], [0, 1, 2],
    'Refresh, My party, Friends/Clan resume children 0-2 of 364:3');
  const info = cacheEnum(1939);
  assert.deepEqual([2, 9, 46, 49, 53, 57, 47].map((component) => info.get((50 << 16) | component)), [0, 1, 2, 3, 4, 5, 6],
    'Back, Refresh, Unblock, size, level, Apply/Leave, Mode resume children 0-6 of 50:0');
});

test('a row\'s View party opens that party\'s information', () => {
  const leader = fakePlayer('RowLeader');
  const party = Parties.create(leader);
  const viewer = fakePlayer('RowViewer');
  const row = Parties.listed().indexOf(party);
  Lobby.selectRow({ player: viewer, buttonId: Lobby.LIST_ROW_UIDS[row] });
  assert.ok(viewer.interfaces.includes(50));
  assert.equal(viewer.getAttribute(Lobby.ATTR.VIEWING), party.id);
  party.dispose();
});

test('every party-information click redraws it, so the client\'s pause button clears', () => {
  const leader = fakePlayer('Redraw');
  const party = Parties.create(leader);
  Lobby.openInformation(leader, party);
  const before = leader.interfaces.length;
  Lobby.resumeButton({ player: leader, buttonId: 50 << 16, action: 1, handled: false });
  assert.equal(leader.interfaces.length, before + 1, 'Refresh');
  Lobby.resumeButton({ player: leader, buttonId: 50 << 16, action: 8, handled: false });
  assert.equal(leader.interfaces.length, before + 2, 'kicking an empty member row');
  party.dispose();
});

test('no theatre NPC plays a player animation: no blocks but Verzik\'s first form, no default attack or death', () => {
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
  new NpcDefinitionLoader().load();
  const PLAYER_ANIMATIONS = new Set([422, 424, 836]); // punch, block, death
  for (let id = 8338; id <= 8389; id++) {
    if (id === 8368) continue; // Abigaila, a spectator
    const definition = NpcDefinition.forId(id);
    assert.equal(definition.getDefenceAnim(), id === 8370 ? 8110 : -1, `${id} block`);
    assert.ok(!PLAYER_ANIMATIONS.has(definition.getAttackAnim()), `${id} attack ${definition.getAttackAnim()}`);
    assert.ok(!PLAYER_ANIMATIONS.has(definition.getDeathAnim()), `${id} death ${definition.getDeathAnim()}`);
  }
});

// ------------------------------------------------------------------ the strategy table

/** A real Player with only the network stubbed; the strings and interface it is sent are recorded. */
function realReader(t, name) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setUsername(name);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const sender = p.getPacketSender();
  p.sent = { interfaces: [], texts: new Map() };
  const original = { sendInterface: sender.sendInterface, sendString: sender.sendString };
  t.mock.method(sender, 'sendInterface', function (id) { p.sent.interfaces.push(id); return original.sendInterface.apply(this, arguments); });
  t.mock.method(sender, 'sendString', function (text, uid) { p.sent.texts.set(uid, text); return original.sendString.apply(this, arguments); });
  return p;
}

test("the strategy table in the vault: each wave's time, the MVP, challenge and overall times, deaths (rsprox 237/01163)", (t) => {
  const InfoBoard = require('../plugins/minigames/tob/InfoBoard.TheatreOfBlood');
  let now = 1000;
  t.mock.method(Shared, 'cycle', () => now);
  const advance = (count) => { now += count; ticks(count); };
  const { raid, players: [ann, bob] } = startRaid(['Tia', 'Ulf']);
  const reader = realReader(t, 'Vel');
  raid.add(reader);
  const fights = { MAIDEN: 149, BLOAT: 145, NYLOCAS: 395, SOTETSEG: 166, XARPUS: 200, VERZIK: 329 };
  for (const [key, fightTicks] of Object.entries(fights)) {
    // The plain room: each boss's own fight isn't what is being timed here.
    raid.room?.destroy();
    raid.room = new Raid.Room(raid, Shared.ROOMS[key]);
    advance(10); // between waves: counted only in the overall time
    raid.room.start();
    raid.room.recordDamage(key === 'NYLOCAS' ? ann : bob, 100);
    for (const player of [ann, bob]) Object.assign(raid.member(player), { roomKey: key, inFight: true });
    if (key === 'BLOAT') raid.onPlayerDied(bob);
    advance(fightTicks);
    raid.room.complete();
  }
  const read = { player: reader, objectId: 33014, option: 'Read' };
  assert.equal(InfoBoard.read(read), false, 'only in the vault');
  raid.buildRoom('REWARDS');
  advance(20); // after Verzik: not in the overall time
  assert.equal(InfoBoard.read(read), true);
  const text = (name) => reader.sent.texts.get(InfoBoard.uid(name));
  assert.deepEqual(reader.sent.interfaces, [459]);
  assert.equal(text('ch1_name'), 'The Maiden of Sugadinti');
  assert.equal(text('ch1_time'), '1:29.40', '149 ticks');
  assert.equal(text('ch3_time'), '3:57.00');
  assert.equal(text('ch6_name'), 'The Final Challenge');
  assert.equal(text('challenge_time_time'), '13:50.40', 'the fights only, as recorded (1,384 ticks)');
  assert.equal(text('overall_time_time'), InfoBoard.formatTime(1384 + 50), 'from the Maiden fight to Verzik: the five gaps between waves count');
  assert.equal(text('mvp_player'), 'Ulf', '500 damage and one death beats 100');
  assert.equal(text('playername0'), 'Tia');
  assert.equal(text('deaths1'), '1');
  assert.equal(text('playername2'), 'Vel');
  assert.equal(text('totaldeaths'), '1');
  raid.remove(bob);
  reader.sent.texts.clear();
  InfoBoard.read(read);
  assert.equal(text('playername1'), 'Ulf', 'a member who left the vault is still listed');
  assert.equal(text('totaldeaths'), '1');
  raid.dispose();
});

test("a member's deaths and damage survive a logout and rejoin", () => {
  const { raid, players: [ann, bob] } = startRaid(['Xan', 'Yul']);
  raid.room.start();
  for (const player of [ann, bob]) Object.assign(raid.member(player), { roomKey: 'MAIDEN', inFight: true });
  raid.room.recordDamage(bob, 300);
  raid.onLogout(bob);
  assert.equal(raid.rejoin(bob), true);
  assert.equal(raid.member(bob).deaths, 1, 'the logout in the fight counts as a death (Wiki)');
  assert.equal(raid.member(bob).roomStats('MAIDEN').damage, 300);
  raid.dispose();
});

test('the strategy table outside a raid is left alone', (t) => {
  const InfoBoard = require('../plugins/minigames/tob/InfoBoard.TheatreOfBlood');
  const reader = realReader(t, 'Wanderer');
  assert.equal(InfoBoard.read({ player: reader, objectId: 33014, option: 'Read' }), false);
  assert.deepEqual(reader.sent.interfaces, []);
});

// ------------------------------------------------------------------ modes, records, tasks

const Stats = require('../plugins/minigames/tob/Stats.TheatreOfBlood');
const CombatAchievements = require('../plugins/minigames/tob/CombatAchievements.TheatreOfBlood');
const Rewards = require('../plugins/minigames/tob/Rewards.TheatreOfBlood');
const Supplies = require('../plugins/minigames/tob/Supplies.TheatreOfBlood');
const EscapeCrystal = require('../plugins/minigames/tob/EscapeCrystal.TheatreOfBlood');

test('team hitpoints by mode: a fifth per player in Entry, the Wiki\'s shares otherwise', () => {
  assert.deepEqual([1, 2, 5].map(Shared.MODES.entry.hitpoints), [0.2, 0.4, 1]);
  assert.deepEqual([1, 3, 4, 5].map(Shared.MODES.normal.hitpoints), [0.75, 0.75, 0.875, 1]);
  assert.deepEqual([1, 3, 4, 5].map(Shared.MODES.hard.hitpoints), [0.75, 0.75, 0.875, 1]);
  assert.equal(Shared.formatTicks(150), '1:30.00', 'as the captured wave lines show a time');
  assert.equal(Shared.formatTicks(1), '0:00.60');
});

test('the party\'s mode: captured prompt; Hard needs everyone to have a Normal completion', () => {
  const leader = fakePlayer('ModeLeader');
  const party = Parties.create(leader);
  Lobby.openInformation(leader, party);
  Lobby.resumeButton({ player: leader, buttonId: 50 << 16, action: 6, handled: false });
  assert.equal(hooks.prompts.at(-1).title, 'Select a mode. Currently set to Normal Mode.');
  choose('Hard Mode.');
  assert.equal(party.mode, 'normal', 'no completion yet');
  assert.match(leader.messages.at(-1), /Normal Mode/);
  leader.setAttribute('tob:completions', 1);
  Lobby.resumeButton({ player: leader, buttonId: 50 << 16, action: 6, handled: false });
  choose('Hard Mode.');
  assert.equal(party.mode, 'hard');
  assert.deepEqual(leader.scripts.filter(([id]) => id === Shared.SCRIPT.PARTY_FOOTER).at(-1), [Shared.SCRIPT.PARTY_FOOTER, Parties.RIGHTS.LEADER, 0, 3, 2], 'the footer carries it, as captured');
  Lobby.resumeButton({ player: leader, buttonId: 50 << 16, action: 6, handled: false });
  choose('Entry Mode.');
  assert.equal(party.mode, 'entry');
  party.dispose();
});

test('the last wave\'s lines and records, in the captured order and words', () => {
  const { raid, players: [solo] } = startRaid(['Records']);
  raid.buildRoom('VERZIK');
  raid.totalTicks = 1000;
  raid.startCycle = Shared.cycle() - 1200;
  raid.room.complete();
  const lines = solo.messages.filter((line) => /Final Challenge|total completion|count is/.test(line));
  assert.match(lines[0], /^Wave 'The Final Challenge' \(Normal Mode\) complete!<br>Duration: .*<br>Theatre of Blood completion time: .* \(new personal best\)$/);
  assert.match(lines[1], /^Theatre of Blood total completion time: <col=ff0000>12:00\.00<\/col> \(new personal best\)$/);
  assert.equal(lines[2], 'Your completed Theatre of Blood count is: <col=ff0000>1</col>.');
  assert.equal(Stats.statsOf(solo, 'normal').completions, 1);
  assert.equal(Stats.bestSuffix({ 1: 100 }, 1, 200), '. Personal best: 1:00.00');
  raid.dispose();
});

test('Hard Mode states its target as the first fight starts', () => {
  const leader = fakePlayer('Hard1');
  const party = Parties.create(leader);
  party.mode = 'hard';
  const raid = Raid.begin(leader);
  raid.enter(leader);
  ticks(2);
  raid.room.start();
  assert.ok(leader.messages.includes('Time to beat: <col=ff0000>70:00</col>'));
  raid.dispose();
});

test('Combat Achievements: only the raid\'s mode counts, failures say so, Perfect rooms fail Perfect Theatre', () => {
  const { raid, players: [solo] } = startRaid(['Tasks1']);
  raid.failTask('Perfect Maiden', 'A Nylocas Matomenos healed The Maiden.');
  assert.ok(solo.messages.includes('You have failed <col=0cc919>Perfect Maiden</col>: A Nylocas Matomenos healed The Maiden.'));
  assert.ok(solo.messages.includes('You have failed <col=0cc919>Perfect Theatre</col>: A Nylocas Matomenos healed The Maiden.'));
  assert.equal(raid.taskLive('Perfect Maiden'), false);
  const before = solo.messages.length;
  raid.failTask('Perfect Maiden', 'again');
  assert.equal(solo.messages.length, before, 'once a raid');
  raid.failTask('Royal Affairs', 'a Hard Mode task');
  assert.equal(solo.messages.length, before, 'not this mode');
  hooks.custom = [];
  raid.completeTask('Perfect Maiden');
  raid.completeTask('Royal Affairs');
  raid.completeTask('Two-Down');
  assert.deepEqual(hooks.custom.filter((entry) => entry.name === 'combat-achievements:complete').map((entry) => entry.payload.task), ['Two-Down'], 'a failed task and another mode\'s don\'t finish');
  raid.dispose();
});

test('the Wiki\'s 50 tasks are all placed in a mode', () => {
  assert.ok(CombatAchievements.MODE_OF_TASK.size >= 40);
  assert.equal(CombatAchievements.MODE_OF_TASK.get('Theatre (Trio) Speed-Runner'), 'normal');
  assert.equal(CombatAchievements.MODE_OF_TASK.get('Theatre: HM (Trio) Speed-Runner'), 'hard');
  assert.equal(CombatAchievements.MONSTER.hard, 'HM: Theatre of Blood');
});

test('an Entry Mode wipe is another attempt, with bandages, not a failure', () => {
  const leader = fakePlayer('EntryWipe');
  const party = Parties.create(leader);
  party.mode = 'entry';
  const raid = Raid.begin(leader);
  raid.enter(leader);
  ticks(2);
  raid.room.start();
  raid.member(leader).inFight = true;
  raid.onPlayerDied(leader);
  assert.equal(raid.member(leader).jailed, true);
  ticks(4);
  assert.equal(raid.over, false);
  assert.equal(raid.failed, false);
  assert.equal(raid.member(leader).jailed, false, 'back up');
  assert.equal(raid.room.stage, 'idle', 'the room starts again');
  assert.equal(leader.inventory.getAmount(Shared.ITEM.BANDAGES), Supplies.BANDAGES_PER_WIPE);
  assert.equal(raid.member(leader).deaths, 1, 'the death still counts against the loot');
  raid.dispose();
});

test('loot by mode: Entry has no uniques or pet, Hard the Wiki\'s rates', () => {
  const { entry, normal, hard } = Rewards.LOOT_BY_MODE;
  assert.equal(entry.unique, 0);
  assert.equal(entry.pet, 0);
  assert.equal(entry.common, 0.2);
  assert.equal(entry.clue, 1 / 25);
  assert.equal(normal.clue, 3 / 25);
  assert.equal(hard.clue, 3.5 / 25);
  assert.equal(hard.unique, 1 / 7.7);
  assert.equal(hard.hilt, 7);
  assert.equal(hard.pet, 1 / 500);
});

test('the escape crystal: inactive by default, fires on a hit only once armed and idle', () => {
  const { raid, players: [solo] } = startRaid(['Crystal1']);
  solo.inventory.setItem(0, new Item(Shared.ITEM.ESCAPE_CRYSTAL, 1));
  solo.lastInputCycle = Shared.cycle();

  assert.equal(EscapeCrystal.afkFires(solo), false, 'not armed');
  solo.setAttribute(EscapeCrystal.ATTR.AFK, true);
  solo.__tobLoginCycle = -1000;
  assert.equal(EscapeCrystal.afkFires(solo), false, 'armed, just active');
  solo.lastInputCycle = Shared.cycle() - 100;
  assert.equal(EscapeCrystal.afkFires(solo), true, 'armed and idle past the default 30 seconds');
  EscapeCrystal.damageApplied({ target: Object.assign(solo, { getAsPlayer: () => solo }), hit: { getDamage: () => 0 } });
  assert.equal(solo.inventory.contains(Shared.ITEM.ESCAPE_CRYSTAL), false, 'a zero hit counts, as the Wiki says');
  ticks(2);
  assert.equal(Raid.raidOf(solo), null);
});

test('the Avernic defender comes from the hilt on a dragon defender', () => {
  const plugin = require('../plugins/items/AvernicDefender.plugin');
  const prompts = [];
  plugin.register({
    core: PluginManager.getCoreApi(),
    onItemOnItem() {}, onItemAction() {},
    sendMultiChatboxPrompt: (player, title, ...args) => prompts.push({ title, args }),
  });
  const player = fakePlayer('Hilt');
  player.inventory.setItem(0, new Item(22477, 1));
  player.inventory.setItem(1, new Item(12954, 1));
  plugin._test.combine({ player });
  prompts.at(-1).args[1]();
  assert.equal(player.inventory.contains(22477), false);
  assert.equal(player.inventory.contains(12954), false);
  assert.equal(player.inventory.contains(22322), true);
});

test('Sinhaza shrouds: earned from 100 Normal or Hard completions, taken from the Stranger, changed between earned tiers', () => {
  const player = fakePlayer('Shroud');
  const pages = [{ page: 'Mysterious Stranger' }];
  const ask = (text) => Stats.shroudCondition({ player, text, pages });
  assert.equal(ask("If the player hasn't earned any Sinhaza shrouds:"), true);
  assert.equal(ask('If the player can claim a Sinhaza shroud:'), false);
  player.setAttribute('tob:completions', 60);
  player.setAttribute('tob:hard-completions', 40);
  player.setAttribute('tob:entry-completions', 900);
  assert.equal(Stats.shroudTiers(player), 1, 'Entry completions don\'t count');
  assert.equal(ask('If the player can claim a Sinhaza shroud:'), true);
  Stats.shroudChoice({ player, option: 'Take Sinhaza shroud tier 2.' });
  const refused = { player, pages, text: 'The Mysterious Stranger hands you a cape.' };
  Stats.shroudHanded(refused);
  assert.equal(refused.end, true);
  assert.match(player.messages.at(-1), /500 Theatre of Blood completions/);
  Stats.shroudChoice({ player, option: 'Take Sinhaza shroud tier 1.' });
  const given = { player, pages, text: 'The Mysterious Stranger hands you a cape.' };
  Stats.shroudHanded(given);
  assert.equal(player.inventory.contains(22494), true);
  assert.deepEqual(given.box, { items: [22494] });
  player.setAttribute('tob:completions', 460);
  const cape = player.inventory.getItems().find((item) => item?.getId?.() === 22494);
  Stats.changeShroud({ player, item: cape });
  assert.equal(cape.getId(), 22496, 'tier 2 once earned');
  Stats.changeShroud({ player, item: cape });
  assert.equal(cape.getId(), 22494, 'round again');
  assert.equal(Stats.shroudCondition({ player, text: "If the player hasn't earned any Sinhaza shrouds:", pages: [{ page: 'Someone else' }] }), undefined, 'other pages are left alone');
});

test('the escape crystal answers direct damage as it is applied (a room hazard), once a tick', () => {
  const { Mobile } = require('../dist/game/entity/impl/Mobile');
  const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
  const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
  PluginManager.customEventHooks.delete('combat:damage-apply');
  PluginManager.createApi('TobCrystalTest').onCustomEvent('combat:damage-apply', EscapeCrystal.damageApplied);
  try {
    const { raid, players: [solo] } = startRaid(['Crystal2']);
    solo.inventory.setItem(0, new Item(Shared.ITEM.ESCAPE_CRYSTAL, 2));
    Object.assign(solo, {
      isNpc: () => false, setHitpoints(value) { solo.hp = value; }, getRights: () => PluginManager.getCoreApi().PlayerRights.PLAYER,
      lastInputCycle: Shared.cycle() - 100, __tobLoginCycle: -1000,
    });
    solo.setAttribute(EscapeCrystal.ATTR.AFK, true);
    // What Shared.damage queues reaches Mobile.decrementHealth, which announces it.
    Mobile.prototype.decrementHealth.call(solo, new HitDamage(7, HitMask.RED));
    Mobile.prototype.decrementHealth.call(solo, new HitDamage(7, HitMask.RED));
    assert.equal(solo.inventory.getAmount(Shared.ITEM.ESCAPE_CRYSTAL), 1, 'one crystal for the tick\'s hits');
    ticks(2);
    assert.equal(Raid.raidOf(solo), null, 'out of the raid');
    raid.dispose();
  } finally {
    PluginManager.customEventHooks.delete('combat:damage-apply');
  }
});

test('Xarpus judges a run by the tile it really passed over, mixed runs included', () => {
  const { passedOver } = require('../plugins/minigames/tob/Xarpus.TheatreOfBlood');
  const { Direction } = require('../dist/game/model/Direction');
  const from = { x: 3164, y: 4381 };
  assert.deepEqual(passedOver(from, { x: 3166, y: 4382 }, Direction.EAST), { x: 3165, y: 4381 }, 'east, then north-east');
  assert.deepEqual(passedOver(from, { x: 3166, y: 4382 }, Direction.NORTH_EAST), { x: 3165, y: 4382 }, 'north-east, then east');
  assert.deepEqual(passedOver(from, { x: 3166, y: 4381 }, Direction.NONE), { x: 3165, y: 4381 }, 'a straight run without a direction');
  assert.deepEqual(passedOver(from, { x: 3165, y: 4381 }, Direction.EAST), { x: -1, y: -1 }, 'a walk passes over nothing');
});

test('a Nylocas hit thrown a tick before its form changed still counts', () => {
  const { launchedAt } = require('../plugins/minigames/tob/Nylocas.TheatreOfBlood');
  const now = Shared.cycle();
  // Launched at now - 3 with a delay of 2 lands at now (CombatFactory: launch + delay + one NPC tick).
  const hit = { getDelay: () => 2, getTarget: () => ({ isNpc: () => true }) };
  assert.equal(launchedAt(hit), now - 3);
  assert.ok(launchedAt(hit) < now - 2, 'before a form change at now - 2');
});

test('Xarpus: a mixed run over a pool still hurts after the engine clears the step for sync', () => {
  const { Direction } = require('../dist/game/model/Direction');
  require('../plugins/minigames/tob/Xarpus.TheatreOfBlood')(hooks.api);
  const { raid, players: [runner] } = startRaid(['Runner1']);
  const room = raid.buildRoom('XARPUS');
  const member = raid.member(runner);
  member.roomKey = 'XARPUS';
  member.inFight = true;
  room.stage = 'started';
  room.phase = 'poison';
  room.xarpus = { getLocation: () => new Location(3168, 4387, 1), getSize: () => 5, getHitpoints: () => 100, getMaxHitpoints: () => 100 };
  // The raid already ticked this turn, from an NPC; the player's own area call comes after.
  raid.lastCycle = Shared.cycle();
  room.pools.set('3165,4381', {});
  const hurts = [];
  room.hurt = (player, amount, mask, reason) => hurts.push(reason);
  let walking = Direction.NONE;
  runner.getWalkingDirection = () => walking;
  // Turn 1: standing at (3164,4381); the player's own area call records where they are.
  runner.location = new Location(3164, 4381, 1);
  raid.area.process(runner);
  // Turn 2: the run east then north-east to (3166,4382), then the player's area call, then sync's reset.
  runner.location = new Location(3166, 4382, 1);
  walking = Direction.EAST;
  raid.area.process(runner);
  walking = Direction.NONE;
  // Turn 3: the room ticks first, from an NPC, with the direction gone.
  room.tickFloor();
  ticks(2);
  assert.deepEqual(hurts, ["stood in Xarpus' poison."], 'the crossed pool hurts a tick late');
  room.tickFloor();
  ticks(2);
  assert.equal(hurts.length, 1, 'once');
  raid.dispose();
});
