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

const hooks = { prompts: [], commands: {} };

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
    onObjectInteraction: (handler) => {
      if (typeof handler === 'function') (hooks.objects ??= []).push(handler);
    },
    onInterfaceActionButton: (uids, handler) => {
      hooks.buttons ??= {};
      for (const uid of [uids].flat()) hooks.buttons[uid] = handler;
    },
    onZoneEnter() {},
    onZoneExit: (area, handler) => (hooks.zoneExits ??= []).push(handler),
    onPlayerLogout: (handler) => (hooks.logout ??= []).push(handler),
    onPlayerLogin() {},
    onShouldDropItemsOnDeath() {},
    onPlayerDeath() {},
    onCanTeleport() {},
    onItemAction() {},
    registerCommand: (name, handler) => { hooks.commands[name] = handler; },
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
    getAddableAmount: (item) => (item.getDefinition().isStackable()
      ? (items.some((other) => other.getId() === item.getId()) || items.filter((other) => other.getId() <= 0).length > 0 ? item.getAmount() : 0)
      : Math.min(item.getAmount(), items.filter((other) => other.getId() <= 0).length)),
    delete(id, amount) {
      const slot = items.findIndex((item) => item.getId() === id);
      if (slot >= 0) items[slot] = items[slot].getAmount() > amount ? new Item(id, items[slot].getAmount() - amount) : new Item(-1, 0);
      return container;
    },
    deleteAtSlot(slot, amount = 1) {
      const item = items[slot];
      items[slot] = item.getAmount() > amount ? new Item(item.getId(), item.getAmount() - amount) : new Item(-1, 0);
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
    messages: [], scripts: [], interfaces: [], opened: [], flags: [], inventories: [], subs: new Map(), statements: [], texts: {}, sounds: [], songs: [],
    inventory: fakeContainer(28), equipment: fakeContainer(14),
    getUsername: () => name, getDisplayName: () => name,
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
    getBanks: () => [],
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCurrentLevel: (skill) => (skill.getIndex?.() === 3 ? p.hp : 99),
      setCurrentLevel(skill, level) { if (skill.getIndex?.() === 3) p.hp = level; },
      getCombatLevel: () => 126,
    }),
    getMovementQueue: () => ({ setBlockMovement(value) { p.blocked = value; return this; }, reset() { return this; }, isMovings: () => false }),
    getTimers: () => {
      const active = new Set();
      return { registers: (key) => active.add(key), cancel: (key) => active.delete(key), has: (key) => active.has(key) };
    },
    performGraphic() {},
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
    interfaceId: -1,
    getInterfaceId: () => p.interfaceId,
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        getVarbit: (id) => varbits.get(id) ?? 0,
        sendConfig: (id, value) => { varbits.set(`varp${id}`, value); return sender; },
        sendInterface: (id) => { p.interfaces.push(id); p.opened.push(['interface', id]); p.interfaceId = id; return sender; },
        sendInterfaceScript: (id, args = []) => { p.scripts.push([id, ...args]); p.opened.push(['script', id, args]); return sender; },
        sendSubInterface: (uid, id) => { p.subs.set(uid, id); return sender; },
        closeSubInterface: (uid) => { p.subs.delete(uid); return sender; },
        sendInterfaceRemoval: () => { p.interfaceId = -1; return sender; },
        getChatboxGroupId: () => -1,
        sendClientScript: (id, ...args) => { p.scripts.push([id, ...args]); return sender; },
        sendInterfaceFlagsRange: (...args) => { p.flags.push(args); return sender; },
        sendInterfaceFlags: () => sender,
        sendInventory: (inv, size, items) => { p.inventories.push({ inv, size, items }); return sender; },
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
  require('../plugins/minigames/tob/Bloat.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/Verzik.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/Books.TheatreOfBlood')(api);
  require('../plugins/minigames/tob/Commands.TheatreOfBlood')(api);
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
    assert.equal(RegionManager.getClipping(x, y, z) & RegionManager.BLOCKED_MASK, 0, `${room.key} ${x},${y},${z}`);
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

const NOTICE_BOARD_FLAG = 6573;
const MESSAGE_BOX = 229;
const MESSAGE_BOX_CONTINUE = (MESSAGE_BOX << 16) | 4;
const OPTIONS_WIDGET = (219 << 16) | 1;
const BOARD_INTRO = [
  'From this notice board, you can form or join a Theatre of Blood',
  'raiding party. The raid has three difficulty modes to select from. If',
  "you're forming your own party, you can pick what mode you want.",
  "If you have limited raiding experience, you'll likely want to start with",
  'Entry Mode. Otherwise, you might prefer Normal Mode.',
].join('<br>');
const EXPERIENCE_OPTIONS = [
  "Not very experienced. I'll start with Entry Mode.",
  "Quite experienced. I'll start with Normal Mode.",
];

test('the active cache names the notice board flag', () => {
  const { Gamevals, GamevalKind } = require('../dist/game/cache/Gamevals');
  assert.equal(new Gamevals().namesOf(GamevalKind.VARBIT).get(NOTICE_BOARD_FLAG), 'tobquest_used_notice_board');
});

function readBoard(player) {
  const event = {
    player, objectId: 32655, clickType: 1, handled: false,
    definition: { getInteractions: () => ['Read'] },
  };
  for (const hook of hooks.objects) hook(event);
  assert.equal(event.handled, true);
}

function continueBox(player) {
  assert.equal(player.getDialogueManager().handleResume(MESSAGE_BOX_CONTINUE, -1), true);
}

function assertExperience(player) {
  continueBox(player);
  const question = player.getDialogueManager().getCurrent();
  assert.equal(question.getTitle(), 'How experienced are you with raids?');
  assert.deepEqual(question.getOptions(), EXPERIENCE_OPTIONS);
  assert.equal(player.getPacketSender().isChatboxInterface(219), true);
}

test('first Read calls the Stranger first, then repeats the introduction after closing it', (t) => {
  const player = realReader(t, 'BoardNew');
  const sender = player.getPacketSender();
  const chatLines = t.mock.method(sender, 'sendTypedMessage');
  readBoard(player);
  assert.equal(player.getDialogueManager().getCurrent().getText(), 'Hey. Over here.');
  assert.equal(sender.getVarbit(NOTICE_BOARD_FLAG), 0);
  player.setAttribute(Lobby.ATTR.MET_STRANGER, true);

  readBoard(player);
  assert.equal(player.sent.texts.get((MESSAGE_BOX << 16) | 3), BOARD_INTRO);
  assert.deepEqual(chatLines.mock.calls.at(-1).arguments, [115, BOARD_INTRO.replaceAll('<br>', ' ').slice(0, 200)]);
  assert.equal(sender.isChatboxInterface(MESSAGE_BOX), true);
  assert.deepEqual(player.sent.interfaces, []);
  sender.closeInterruptibleInterfaces();
  assert.equal(player.getDialogueManager().isActive(), false);
  assert.equal(sender.getVarbit(NOTICE_BOARD_FLAG), 0);
  readBoard(player);
  assert.equal(player.getDialogueManager().getCurrent().getText(), BOARD_INTRO);
  assertExperience(player);
  assert.equal(sender.getVarbit(NOTICE_BOARD_FLAG), 0);
});

for (const [choice, mode, label] of [[1, 'entry', 'Entry'], [2, 'normal', 'Normal']]) {
  test(`the board remembers the ${label} choice and makes the first party in that mode`, (t) => {
    const player = realReader(t, 'BoardLeader');
    t.after(() => Parties.partyOf(player)?.dispose());
    player.setAttribute(Lobby.ATTR.MET_STRANGER, true);
    const sender = player.getPacketSender();
    const packets = [];
    for (const method of ['sendTypedMessage', 'sendVarbit']) {
      const send = sender[method];
      t.mock.method(sender, method, function (...args) {
        packets.push([method, ...args]);
        return send.apply(this, args);
      });
    }
    readBoard(player);
    assertExperience(player);
    const confirmation = `When you form a raiding party, it will be set to ${label} Mode. If you wish to pick a different difficulty mode, you can do so at any time from this notice board.`;
    assert.equal(player.getDialogueManager().handleResume(OPTIONS_WIDGET, choice), true);
    assert.equal(sender.getVarbit(NOTICE_BOARD_FLAG), 1);
    assert.equal(player.getDialogueManager().getCurrent().getText(),
      confirmation.replace('If you wish', 'If<br>you wish').replace('any time', 'any<br>time'));
    assert.deepEqual(packets.filter(([method, id]) => method === 'sendTypedMessage' || id === NOTICE_BOARD_FLAG).slice(-2), [['sendVarbit', NOTICE_BOARD_FLAG, 1], ['sendTypedMessage', 115, confirmation]]);
    assert.deepEqual(player.sent.interfaces, []);
    continueBox(player);
    assert.equal(sender.isChatboxInterface(MESSAGE_BOX), false);
    assert.deepEqual(player.sent.interfaces, [364]);

    Lobby.resumeButton({ player, buttonId: (364 << 16) | 3, action: 1 });
    assert.equal(Parties.partyOf(player).mode, mode);
    Parties.partyOf(player).dispose();
    sender.closeInterruptibleInterfaces();
    readBoard(player);
    assert.equal(player.getInterfaceId(), 364);
    assert.equal(sender.isChatboxInterface(MESSAGE_BOX), false);
  });
}

test('accepting an application tells its applicant and updates the party HUD on the next tick', (t) => {
  const leader = fakePlayer('Leader Display');
  const accepted = fakePlayer('Accepted');
  const declined = fakePlayer('Declined');
  const sendMessage = accepted.sendMessage;
  t.mock.method(accepted, 'sendMessage', (text) => {
    assert.equal(accepted.varbits.get(6440) ?? 0, 0, 'the game message comes before the HUD update');
    sendMessage(text);
  });
  const party = Parties.create(leader);
  t.after(() => party.dispose());
  for (const applicant of [accepted, declined]) party.apply(applicant);
  Lobby.openInformation(leader, party);
  Lobby.resumeButton({ player: leader, buttonId: 50 << 16, action: 12 });
  assert.deepEqual(accepted.messages, ['Your application to the party of Leader\u00a0Display has been accepted.']);
  assert.equal(party.has(accepted), true);
  assert.equal(accepted.varbits.get(6440) ?? 0, 0, 'the acceptance tick sends no party status update');
  ticks(1);
  assert.equal(accepted.varbits.get(6440), 1);
  Lobby.resumeButton({ player: leader, buttonId: 50 << 16, action: 22 });
  assert.deepEqual(declined.messages, ['Your application to the party of Leader Display has been declined.']);

  const singleNameLeader = fakePlayer('Captain');
  const otherParty = Parties.create(singleNameLeader);
  t.after(() => otherParty.dispose());
  const departing = fakePlayer('Departing');
  otherParty.apply(departing);
  Lobby.openInformation(singleNameLeader, otherParty);
  Lobby.resumeButton({ player: singleNameLeader, buttonId: 50 << 16, action: 12 });
  assert.deepEqual(departing.messages, ['Your application to the party of Captain has been accepted.']);
  hooks.zoneExits[0]({ player: departing });
  ticks(1);
  assert.equal(departing.varbits.get(6440), 0, 'departing cancels a pending positive status update');
  assert.equal(departing.subs.has(Shared.OVERLAY_HUD_UID), false, 'the HUD stays closed outside the lobby');
});

test('leaving the lobby tells members once and withdraws applicants quietly', (t) => {
  const leader = fakePlayer('Leader');
  const member = fakePlayer('Member');
  const applicant = fakePlayer('Applicant');
  const party = Parties.create(leader);
  t.after(() => party.dispose());
  party.apply(member);
  party.accept(member);
  party.apply(applicant);
  for (const player of [member, applicant, member]) hooks.zoneExits[0]({ player });
  assert.deepEqual(member.messages, ['You have left the lobby, so you have been removed from your party.']);
  assert.equal(party.has(member), false);
  assert.deepEqual(applicant.messages, []);
  assert.equal(Parties.applicationOf(applicant), null);

  const { raid, players: [raider] } = startRaid(['Entering']);
  t.after(() => raid.dispose());
  hooks.zoneExits[0]({ player: raider });
  assert.equal(raider.messages.includes('You have left the lobby, so you have been removed from your party.'), false);
});

for (const status of ['disbanded', 'inside the Theatre']) {
  test(`refreshing a party ${status} closes its details and offers the list after the message`, (t) => {
    const viewer = realReader(t, 'Viewer');
    const party = Parties.create(fakePlayer('Leader'));
    t.after(() => party.dispose());
    Lobby.openInformation(viewer, party);
    if (status === 'disbanded') party.dispose();
    else party.raid = {};
    Lobby.resumeButton({ player: viewer, buttonId: 50 << 16, action: 1 });
    assert.equal(viewer.getInterfaceId(), -1);
    assert.equal(viewer.sent.texts.get((MESSAGE_BOX << 16) | 3), 'That party is no longer recruiting.');
    assert.deepEqual(viewer.sent.interfaces, [50]);
    continueBox(viewer);
    assert.equal(viewer.getPacketSender().isChatboxInterface(MESSAGE_BOX), false);
    assert.deepEqual(viewer.sent.interfaces, [50, 364]);
  });
}

// ------------------------------------------------------------------ the raid

function startRaid(names = ['Solo'], mode = 'normal') {
  const players = names.map(fakePlayer);
  const party = Parties.create(players[0]);
  party.mode = mode;
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

test('a wipe fails the raid even when a party member never entered the fight', () => {
  const [ann, bob] = [fakePlayer('WipeAnn'), fakePlayer('WipeBob')];
  const party = Parties.create(ann);
  party.apply(bob);
  party.accept(bob);
  const raid = Raid.begin(ann);
  // Ann goes in; Bob stays outside and is never jailed.
  raid.enter(ann);
  ticks(2);
  ann.inventory.setItem(0, new Item(4151, 1));
  bob.inventory.setItem(0, new Item(4151, 1));
  raid.room.start();
  Object.assign(raid.member(ann), { roomKey: 'MAIDEN', inFight: true });
  ann.hp = 0;
  raid.onPlayerDied(ann);
  ticks(5);
  assert.equal(raid.failed, true, 'the member in the fight dying is the whole fight');
  assert.equal(Raid.raidOf(ann), null);
  assert.equal(bob.inventory.getAmount(4151), 1, 'someone who never fought keeps their items');
  assert.equal(Retrieval.storedOf(ann).length >= 1, true, 'the dead member still has a retrieval lot');
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

test('the supplies sell only while open at the chest: a click with them closed buys nothing', () => {
  const Supplies = require('../plugins/minigames/tob/Supplies.TheatreOfBlood');
  const { raid, players: [solo] } = startRaid(['Remote']);
  raid.member(solo).supplyPoints = 10;
  const prayer = Supplies.STOCK[1];
  const click = () => Supplies.clickSupply({ player: solo, slot: 1, opId: 2 });
  click();
  assert.equal(solo.inventory.getAmount(prayer.id), 0, 'no chest open: nothing bought');
  assert.equal(raid.member(solo).supplyPoints, 10);
  solo.interfaceId = Shared.INTERFACE.SUPPLIES;
  click();
  assert.equal(solo.inventory.getAmount(prayer.id), 1, 'open: bought');
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

test('Hard Mode\'s supply chest is a band lower than Normal\'s (Wiki, Hard Mode)', (t) => {
  t.mock.method(Math, 'random', () => 0);
  const normal = startRaid(['SupplyNormal']);
  normal.raid.member(normal.players[0]).roomStats('MAIDEN').damage = 100;
  normal.raid.grantSupplyPoints({ key: 'BLOAT' });
  assert.equal(normal.raid.member(normal.players[0]).supplyPoints, 8, 'average grade, normal band 8-11');

  const leader = fakePlayer('SupplyHard');
  const party = Parties.create(leader);
  party.mode = 'hard';
  const hard = Raid.begin(leader);
  hard.enter(leader);
  ticks(2);
  hard.member(leader).roomStats('MAIDEN').damage = 100;
  hard.grantSupplyPoints({ key: 'BLOAT' });
  assert.equal(hard.member(leader).supplyPoints, 6, 'the same grade, one band down: 6-9');
  hard.dispose();
  normal.raid.dispose();
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

/** A stand-in for her NPC when the fake API spawns nothing. */
function fakeVerzik() {
  const npc = {
    location: new Location(3165, 4310, 0),
    hp: 100,
    isPlayer: () => false,
    isNpc: () => true,
    getLocation: () => npc.location,
    getSize: () => 5,
    getHitpoints: () => npc.hp,
    getMaxHitpoints: () => 100,
    setHitpoints: (value) => { npc.hp = value; },
    isRegistered: () => true,
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {} }),
    performAnimation() {},
    setNpcTransformationId() {},
    moveTo(location) { npc.location = location; },
  };
  return npc;
}

test('Verzik: her phase 3 hazards stop once she dies, and her webs are cleared', (t) => {
  const Verzik = require('../plugins/minigames/tob/Verzik.TheatreOfBlood');
  const { raid, players: [solo] } = startRaid(['Hazard']);
  const room = raid.buildRoom('VERZIK');
  room.verzik = fakeVerzik();
  room.phase = 3;
  room.stage = 'started';
  room.transition = false;
  Object.assign(raid.member(solo), { roomKey: 'VERZIK', inFight: true });
  const hurts = [];
  room.hurt = (_player, _amount, attack) => hurts.push(attack);
  room.animate = () => {};
  room.despawn = () => {};
  t.mock.method(Shared, 'projectile', () => 2);
  t.mock.method(Shared, 'floorFree', () => true);

  // Real in-flight attacks, queued before the death.
  room.autoAttack(solo);
  room.bounceGreen(room.verzik, solo, { passes: 0, visited: new Set(), lethal: false });
  room.special_dots();

  // A web that would burst on the party this tick.
  const { GameObject, ObjectManager } = PluginManager.getCoreApi();
  const webObject = new GameObject(Shared.OBJECT.WEB, new Location(3160, 4310, 0), 10, 0, raid.area);
  ObjectManager.register(webObject, true);
  room.webs.set('3160,4310', {
    tile: { x: 3160, y: 4310, z: 0 }, object: webObject,
    npc: { isRegistered: () => true, getHitpoints: () => 10 }, age: 18, stuck: new Set([solo]),
  });

  room.die();
  assert.equal(room.transition, true);
  assert.equal(room.webs.size, 0, 'the webs go with her');
  ticks(40);
  assert.deepEqual(hurts, [], 'no in-flight hazard landed after the death');
  assert.equal(solo.hp, 99, 'nothing hurt the player');

  // Prove the same callbacks do land while she is alive, so the test isn't vacuous.
  const room2 = raid.buildRoom('VERZIK');
  room2.verzik = fakeVerzik();
  room2.phase = 3;
  room2.stage = 'started';
  room2.transition = false;
  Object.assign(raid.member(solo), { roomKey: 'VERZIK', inFight: true });
  const hurtAgain = [];
  room2.hurt = (_player, _amount, attack) => hurtAgain.push(attack);
  room2.animate = () => {};
  room2.bounceGreen(room2.verzik, solo, { passes: 0, visited: new Set(), lethal: false });
  ticks(3);
  assert.deepEqual(hurtAgain, ['green ball'], 'alive, the green ball does land');
  raid.dispose();
});

test('the Dawnbringer: dropped for a teammate, and dropped on death', (t) => {
  const Verzik = require('../plugins/minigames/tob/Verzik.TheatreOfBlood');
  const { raid, players: [ann, bob] } = startRaid(['Dawn1', 'Dawn2']);
  const { EquipPacketListener } = PluginManager.getCoreApi();
  t.mock.method(EquipPacketListener, 'resetWeapon', () => {});
  const room = raid.buildRoom('VERZIK');
  room.verzik = fakeVerzik();
  room.phase = 1;
  room.stage = 'started';
  for (const player of [ann, bob]) Object.assign(raid.member(player), { roomKey: 'VERZIK', inFight: true });
  ann.inventory.setItem(0, new Item(Shared.ITEM.DAWNBRINGER, 1));
  const drop = { player: ann, itemId: Shared.ITEM.DAWNBRINGER, item: ann.inventory.getItems()[0], slot: 0, handled: false };
  Verzik.dropDawnbringerItem(drop);
  assert.equal(drop.handled, true);
  assert.equal(ann.inventory.contains(Shared.ITEM.DAWNBRINGER), false, 'it leaves the dropper');
  const ground = [...room.looseDawnbringers][0];
  assert.ok(ground, 'it is on the floor');
  const { ItemOnGroundManager } = PluginManager.getCoreApi();
  assert.equal(ItemOnGroundManager.canSee(bob, ground), true, 'a teammate can see and take it');

  // Death: the equipped copy is left where the player fell, before the jail.
  const { Equipment } = PluginManager.getCoreApi();
  ann.equipment.setItem(Equipment.WEAPON_SLOT, new Item(Shared.ITEM.DAWNBRINGER, 1));
  ann.location = new Location(3170, 4310, 0);
  raid.onPlayerDied(ann);
  assert.equal(ann.equipment.getItems()[Equipment.WEAPON_SLOT].getId(), -1, 'no longer held');
  assert.equal(raid.member(ann).jailed, true);
  const dropped = [...room.looseDawnbringers].find((entry) => entry.getPosition().getX() === 3170 && entry.getPosition().getY() === 4310);
  assert.ok(dropped, 'left at the death tile');

  // Phase 1 ending takes every loose copy with it.
  room.clearLooseDawnbringers();
  assert.ok([...room.looseDawnbringers].every((entry) => entry.isPendingRemoval()));
  raid.dispose();
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

test('unclaimed vault loot is lost on starting another raid, and the vault roll replaces it', (t) => {
  const Rewards = require('../plugins/minigames/tob/Rewards.TheatreOfBlood');
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  t.mock.method(Math, 'random', () => 0);
  const solo = fakePlayer('LootLost');
  Rewards.setLoot(solo, [{ id: I.COINS, amount: 123 }]);
  Parties.create(solo);
  const raid = Raid.begin(solo);
  raid.enter(solo);
  assert.deepEqual(Rewards.lootOf(solo), [], 'entering a new raid loses the old loot');
  Rewards.setLoot(solo, [{ id: I.COINS, amount: 123 }]);
  raid.buildRoom('REWARDS');
  const after = Rewards.lootOf(solo);
  assert.ok(!after.some((entry) => entry.id === I.COINS), 'the vault roll replaces anything older');
  assert.ok(after.some((entry) => entry.id === I.AVERNIC_DEFENDER_HILT), 'the new roll is there');
  hooks.api.emitCustomEvent('tob:raid-entered', { raid, player: solo });
  assert.ok(Rewards.lootOf(solo).length > 0, 'stepping in again at the vault keeps its own roll');
  raid.dispose();
});

test("unclaimed vault loot is lost on logging out, but Lil' Zik is still delivered", () => {
  const Rewards = require('../plugins/minigames/tob/Rewards.TheatreOfBlood');
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const solo = fakePlayer('LogoutLoot');
  Rewards.setLoot(solo, [{ id: I.COINS, amount: 123 }, { id: I.LIL_ZIK, amount: 1 }]);
  hooks.custom = [];
  for (const handler of hooks.logout) handler({ player: solo });
  assert.deepEqual(Rewards.lootOf(solo), [], 'nothing is left to claim');
  assert.ok(hooks.custom.some((entry) => entry.name === 'npc-drops:roll' && entry.payload.drops.some((drop) => drop.itemId === I.LIL_ZIK)),
    'the pet goes to the pet delivery');
});

test('a seven-item Hard roll shows six; the bulk buttons act on those and the seventh moves into view', () => {
  const Rewards = require('../plugins/minigames/tob/Rewards.TheatreOfBlood');
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const TAKE_ALL = (23 << 16) | 8;
  const DISCARD_ALL = (23 << 16) | 10;
  const solo = fakePlayer('SevenSlots');
  // The reviewer's roll: three commons, the clue, the dust and both kits.
  const seven = () => [565, 445, 452, I.CLUE_SCROLL_ELITE_, I.SANGUINE_DUST, I.SANGUINE_ORNAMENT_KIT, I.HOLY_ORNAMENT_KIT]
    .map((id) => ({ id, amount: 1 }));
  const lastSent = () => solo.inventories.at(-1);
  Rewards.setLoot(solo, seven());
  Rewards.openLoot(solo);
  assert.equal(lastSent().size, 6, 'inventory 612 has six slots (cache)');
  assert.deepEqual(lastSent().items.map((item) => item.id), seven().slice(0, 6).map((entry) => entry.id), 'the first six are shown');
  assert.ok(solo.messages.some((text) => /More rewards are waiting/.test(text)), 'the player is told more are waiting');

  hooks.buttons[DISCARD_ALL]({ player: solo });
  choose('<col=ff0000>DESTROY!');
  assert.deepEqual(Rewards.lootOf(solo).map((entry) => entry.id), [I.HOLY_ORNAMENT_KIT], 'Discard-all destroys only what was shown');
  assert.deepEqual(lastSent().items.map((item) => item.id), [I.HOLY_ORNAMENT_KIT], 'the hidden kit comes into view');

  // Bank-all goes through the same takeAll; the fake player has no bank to drive it with.
  Rewards.setLoot(solo, seven());
  hooks.buttons[TAKE_ALL]({ player: solo });
  const left = Rewards.lootOf(solo).map((entry) => entry.id);
  assert.ok(left.includes(I.HOLY_ORNAMENT_KIT), 'Take-all leaves the unshown kit in the chest');
  assert.deepEqual(lastSent().items.map((item) => item.id), left.slice(0, 6), 'what is left is shown, the kit with it');
  assert.ok(left.length <= 6, 'the six shown were taken, so nothing is hidden any more');
});

test('the vault loot reaches the collection log once, and the category answers the ToB counts', () => {
  const Rewards = require('../plugins/minigames/tob/Rewards.TheatreOfBlood');
  const Stats = require('../plugins/minigames/tob/Stats.TheatreOfBlood');
  const I = PluginManager.getCoreApi().ItemIdentifiers;
  const { raid, players: [solo] } = startRaid(['ClogToB']);
  Rewards.setLoot(solo, [
    { id: I.SANGUINE_DUST, amount: 1 },
    { id: I.HOLY_ORNAMENT_KIT, amount: 1 },
    { id: I.LIL_ZIK, amount: 1 },
  ]);
  hooks.custom = [];
  Rewards.openLoot(solo);
  const obtained = hooks.custom.filter((entry) => entry.name === 'collection-log:obtain').map((entry) => entry.payload.itemId);
  assert.deepEqual(obtained.sort(), [I.HOLY_ORNAMENT_KIT, I.SANGUINE_DUST].sort(), 'the uniques/tertiaries log; Lil\' Zik goes through the pet delivery');
  hooks.custom = [];
  Rewards.openLoot(solo);
  assert.equal(hooks.custom.filter((entry) => entry.name === 'collection-log:obtain').length, 0, 'reopening adds nothing');
  Rewards.setLoot(solo, [{ id: I.VIAL_OF_BLOOD_2, amount: 8, loggedAmount: 5 }]);
  hooks.custom = [];
  Rewards.logLoot(solo);
  const vial = hooks.custom.find((entry) => entry.name === 'collection-log:obtain');
  assert.equal(vial?.payload.amount, 3, 'only the later copies are logged');
  solo.setAttribute('tob:completions', 2);
  solo.setAttribute('tob:hard-completions', 1);
  solo.setAttribute('tob:entry-completions', 3);
  const request = { player: solo, category: 'Theatre of Blood', struct: 506, count: null };
  hooks.api.emitCustomEvent('collection-log:category-count', request);
  assert.equal(request.count, 6, 'Entry + Normal + Hard');
  const other = { player: solo, category: 'Zulrah', count: 9 };
  Stats.collectionLogCount(other);
  assert.equal(other.count, 9, 'another category is left alone');
  raid.dispose();
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

const partyInfoId = 50;
const partyHudNames = (28 << 16) | 12;
const memberRows = (player) => player.scripts.filter(([script]) => script === 2317).slice(-5);
const footerRights = (player) => player.scripts.findLast(([script]) => script === 2323)[1];

function reorderFixture(t) {
  const leader = fakePlayer('Lead');
  const member = fakePlayer('Ann Lee');
  const applicant = fakePlayer('Bob Ray');
  const outsider = fakePlayer('Outsider');
  const party = Parties.create(leader);
  t.after(() => party.dispose());
  party.apply(member);
  assert.equal(party.accept(member), true);
  party.apply(applicant);
  for (const player of [leader, member, applicant, outsider]) Lobby.openInformation(player, party);
  return { leader, member, applicant, outsider, party };
}

function clickPartyArrow(player, component, opId = 1) {
  const buttonId = (partyInfoId << 16) | component;
  assert.equal(typeof hooks.buttons[buttonId], 'function', `registered action for 50:${component}`);
  hooks.buttons[buttonId]({ player, buttonId, action: opId, opId, slot: 0xffff, handled: false });
}

test('party ordering enables the ten arrows on each opening for every viewer', (t) => {
  const { leader, member, applicant, outsider, party } = reorderFixture(t);
  const flags = Array.from({ length: 10 }, (_, index) => [(partyInfoId << 16) | (63 + index), -1, -1, 1 << 1]);
  for (const player of [leader, member, applicant, outsider]) {
    Lobby.openInformation(player, party);
    assert.deepEqual(player.flags, [...flags, ...flags]);
    assert.deepEqual(player.scripts.filter(([script]) => script === 5239), [[5239], [5239]]);
    assert.ok(player.scripts.findIndex(([script]) => script === 5239) <
      player.scripts.findIndex(([script]) => script === 2317), 'arrows script precedes member rows');
  }
});

test('party ordering writes viewer rights and non-breaking spaces to the details screen', (t) => {
  const { leader, member, applicant, outsider } = reorderFixture(t);
  for (const [player, rights] of [[leader, 2], [member, 1], [applicant, 3], [outsider, 0]]) {
    assert.equal(footerRights(player), rights);
    const rows = memberRows(player);
    assert.equal(rows.length, 5);
    assert.ok(rows.every(([, value]) => value === rights));
    assert.equal(rows[1][2].split('|')[0], 'Ann\u00a0Lee');
  }
  assert.equal(member.scripts.findLast(([script]) => script === 2321)[1].split('|')[0], 'Bob\u00a0Ray');
});

test('party ordering writes five lobby HUD names with non-breaking spaces and no final break', (t) => {
  const { leader } = reorderFixture(t);
  Lobby.refreshHud(leader);
  assert.equal(leader.texts[partyHudNames], 'Lead<br>Ann\u00a0Lee<br>-<br>-<br>-');
});

test('party ordering shows the recorded leadership warning (A3)', {
  skip: 'The mechanics-only implementation opens the confirmation menu directly.',
}, () => {});

test('party ordering confirms a hand-over before swapping, then redraws the screen and HUD', (t) => {
  const { leader, member, applicant, party } = reorderFixture(t);
  const blocked = fakePlayer('Blocked');
  party.blocked.add(blocked.getUsername());
  party.mode = 'entry';
  party.preferredSize = 3;
  party.preferredCombat = 100;
  Lobby.refreshHud(leader);
  clickPartyArrow(leader, 65);
  assert.equal(leader.getInterfaceId(), -1);
  assert.deepEqual(party.members, [leader, member]);
  const prompt = hooks.prompts.at(-1);
  assert.equal(prompt.player, leader);
  assert.equal(prompt.title, 'Continue?');
  assert.deepEqual(prompt.args.filter((arg) => typeof arg === 'string'), ['Yes', 'No']);
  choose('Yes');
  assert.equal(party.leader, member);
  assert.deepEqual(party.members, [member, leader]);
  assert.deepEqual(party.applicants, [applicant]);
  assert.ok(party.blocked.has(blocked.getUsername()));
  assert.deepEqual([party.mode, party.preferredSize, party.preferredCombat, party.raid], ['entry', 3, 100, null]);
  assert.equal(Parties.byId(party.id), party);
  assert.equal(leader.getInterfaceId(), partyInfoId);
  assert.equal(footerRights(leader), 1);
  assert.deepEqual(memberRows(leader).map(([, rights, row]) => [rights, row.split('|')[0]]),
    [[1, 'Ann\u00a0Lee'], [1, 'Lead'], [1, ''], [1, ''], [1, '']]);
  assert.equal(leader.texts[partyHudNames], 'Lead<br>Ann\u00a0Lee<br>-<br>-<br>-', 'details precede HUD');
  ticks(1);
  assert.equal(leader.texts[partyHudNames], 'Ann\u00a0Lee<br>Lead<br>-<br>-<br>-');
  assert.equal(member.texts[partyHudNames], leader.texts[partyHudNames]);
  assert.deepEqual(leader.messages, []);
  Lobby.useEntrance({ player: leader });
  assert.match(leader.statements.at(-1).getDialogues().get(0).getText(), /leader, Ann Lee, must go first/);
});

test('party ordering can cancel a down-arrow hand-over with No or by closing the menu', (t) => {
  const { leader, member, party } = reorderFixture(t);
  clickPartyArrow(leader, 64);
  assert.equal(hooks.prompts.at(-1).title, 'Continue?');
  choose('No');
  assert.deepEqual(party.members, [leader, member]);
  assert.equal(leader.getInterfaceId(), partyInfoId);
  clickPartyArrow(leader, 64);
  assert.equal(leader.getInterfaceId(), -1);
  hooks.api.emitCustomEvent('interface:closed', { player: leader, interfaceId: 219 });
  ticks(1);
  assert.deepEqual(party.members, [leader, member]);
  assert.equal(leader.getInterfaceId(), partyInfoId);
});

test('party ordering swaps non-first rows immediately without opening a menu', (t) => {
  const { leader, member, applicant, outsider, party } = reorderFixture(t);
  t.mock.method(PluginManager.getCoreApi().World, 'getPlayers', () => [outsider]);
  assert.equal(party.accept(applicant), true);
  clickPartyArrow(leader, 67);
  assert.deepEqual(party.members, [leader, applicant, member]);
  assert.deepEqual(hooks.prompts, []);
  assert.deepEqual(leader.statements, []);
  for (const player of party.members) {
    assert.equal(player.texts[partyHudNames], 'Lead<br>Bob\u00a0Ray<br>Ann\u00a0Lee<br>-<br>-');
    assert.equal(memberRows(player)[1][2].split('|')[0], 'Bob\u00a0Ray');
  }
  assert.equal(memberRows(outsider)[1][2].split('|')[0], 'Bob\u00a0Ray');
  assert.equal(footerRights(outsider), 0);
});

test('party ordering redraws invalid or unauthorized arrow clicks without changing the party', (t) => {
  const { leader, member, applicant, party } = reorderFixture(t);
  for (const [player, component] of [[member, 65], [applicant, 65], [leader, 63], [leader, 66], [leader, 67]]) {
    const openings = player.interfaces.length;
    clickPartyArrow(player, component);
    assert.equal(player.interfaces.length, openings + 1);
  }
  party.raid = {};
  clickPartyArrow(leader, 65);
  assert.deepEqual(party.members, [leader, member]);
  assert.deepEqual(hooks.prompts, []);
  assert.equal(Parties.byId(party.id), party);
});

test('party ordering does not confirm a hand-over after the selected member leaves', (t) => {
  const { leader, member, applicant, party } = reorderFixture(t);
  clickPartyArrow(leader, 65);
  party.remove(member);
  assert.equal(party.accept(applicant), true);
  choose('Yes');
  assert.deepEqual(party.members, [leader, applicant]);
  assert.equal(leader.getInterfaceId(), partyInfoId);
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

// ------------------------------------------------------------------ books

function captureBookDrops(t) {
  const drops = [];
  const { ItemOnGroundManager } = PluginManager.getCoreApi();
  t.mock.method(ItemOnGroundManager, 'registerLocation', (player, item, position, area, options) => {
    drops.push({
      player, area, options,
      id: item.getId(),
      count: item.getAmount(),
      tile: [position.getX(), position.getY(), position.getZ()],
      tick: Shared.cycle(),
      messages: [...player.messages],
    });
  });
  return drops;
}

function assertBookDrop(drop, raid, player, id, tile) {
  assert.ok(drop, 'the book was registered');
  assert.equal(drop.player, player);
  assert.equal(drop.id, id);
  assert.equal(drop.count, 1);
  assert.deepEqual(drop.tile, tile);
  assert.equal(drop.area, raid.area);
  assert.deepEqual(drop.options, { goesGlobal: false, despawnDelay: 200 });
}

const fixedBookTiles = [
  ['MAIDEN', 22504, [3168, 4447, 0]],
  ['NYLOCAS', 22508, [3295, 4248, 0]],
  ['SOTETSEG', 22510, [3279, 4328, 0]],
  ['XARPUS', 22512, [3170, 4387, 1]],
];

for (const mode of ['entry', 'normal', 'hard']) {
  test(`Theatre books: fixed tiles, private lifetime and completion order in ${mode}`, (t) => {
    const { raid, players: [solo] } = startRaid(['BookHunter'], mode);
    t.after(() => raid.dispose());
    const drops = captureBookDrops(t);
    for (const [key, id, tile] of fixedBookTiles) {
      const room = raid.buildRoom(key);
      solo.location = Shared.loc(room.def.entrance);
      const tick = Shared.cycle();
      room.complete();
      assertBookDrop(drops.at(-1), raid, solo, id, tile);
      assert.equal(drops.at(-1).tick, tick);
      assert.ok(drops.at(-1).messages.at(-1).startsWith(
        `Wave '${room.def.name}' ${Shared.MODES[mode].tag} complete!`,
      ));
      room.complete(); // Replaying completion must not register another stack.
    }
    assert.equal(drops.length, fixedBookTiles.length);
  });
}

test('Theatre books: separate drops for eligible players, including a jailed player', (t) => {
  const { raid, players: [ann, bob, carrying, banked] } = startRaid(['BookAnn', 'BookBob', 'BookBag', 'BookBank']);
  t.after(() => raid.dispose());
  const drops = captureBookDrops(t);
  carrying.inventory.setItem(0, new Item(22504, 1));
  const bank = fakeContainer(10);
  bank.setItem(0, new Item(22504, 1));
  banked.getBanks = () => [bank];
  raid.room.start();
  raid.member(ann).inFight = true;
  raid.member(bob).inFight = true;
  bob.hp = 0;
  raid.onPlayerDied(bob);
  assert.equal(raid.member(bob).jailed, true);

  raid.room.complete();

  assert.equal(drops.length, 2);
  assertBookDrop(drops[0], raid, ann, 22504, [3168, 4447, 0]);
  assertBookDrop(drops[1], raid, bob, 22504, [3168, 4447, 0]);
});

for (const [x, y] of [[3299, 4448], [3288, 4441]]) {
  test(`Theatre books: Bloat's centre at ${x},${y} after its three-tick death`, (t) => {
    const { raid, players: [solo] } = startRaid();
    t.after(() => raid.dispose());
    const drops = captureBookDrops(t);
    const room = raid.buildRoom('BLOAT');
    const bloat = fakeVerzik();
    bloat.location = new Location(x, y, 0);
    bloat.hp = 0;
    room.bloat = bloat;
    room.state = {};
    room.npcs.add(bloat);
    room.start();

    room.tick();
    assert.equal(room.state.dying, true);
    ticks(2);
    assert.equal(drops.length, 0);
    ticks(1);

    assert.equal(room.isCompleted(), true);
    assert.equal(room.npcs.has(bloat), false);
    assert.equal(drops.length, 1);
    assertBookDrop(drops[0], raid, solo, 22506, [x + 2, y + 2, 0]);
    assert.match(drops[0].messages.at(-1), /^Wave 'The Pestilent Bloat'/);
  });
}

test('Theatre books: Verzik drops from her post-transition tile after the final lines', (t) => {
  const { raid, players: [solo] } = startRaid();
  t.after(() => raid.dispose());
  const drops = captureBookDrops(t);
  const room = raid.buildRoom('VERZIK');
  const verzik = fakeVerzik();
  verzik.location = new Location(3168, 4306, 0);
  room.verzik = verzik;
  room.npcs.add(verzik);
  room.phase = 3;
  room.stage = 'started';

  room.endPhase();
  ticks(2);
  assert.deepEqual(Shared.tileOf(verzik), { x: 3170, y: 4308, z: 0 });
  ticks(5);
  assert.equal(drops.length, 0);
  ticks(1);

  assert.equal(room.isCompleted(), true);
  assert.equal(room.npcs.has(verzik), false);
  assert.equal(drops.length, 1);
  assertBookDrop(drops[0], raid, solo, 22514, [3171, 4309, 0]);
  const lines = drops[0].messages.filter((line) => /Final Challenge|total completion|count is/.test(line));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Wave 'The Final Challenge'/);
  assert.match(lines[1], /^Theatre of Blood total completion time:/);
  assert.match(lines[2], /^Your completed Theatre of Blood count is:/);
});

for (const [key, id, tile] of [['BLOAT', 22506, [3301, 4447, 0]], ['VERZIK', 22514, [3166, 4312, 0]]]) {
  test(`Theatre books: tobcomplete uses the ${key} fallback without a boss death`, (t) => {
    const { raid, players: [solo] } = startRaid();
    t.after(() => raid.dispose());
    const drops = captureBookDrops(t);
    const room = raid.buildRoom(key);
    const npc = fakeVerzik();
    room.npcs.add(npc);
    if (key === 'VERZIK') room.verzik = npc;
    else room.bloat = npc;

    assert.equal(hooks.commands.tobcomplete({ player: solo }), true);

    assert.equal(room.isCompleted(), true);
    assert.equal(room.npcs.has(npc), false);
    assert.equal(drops.length, 1);
    assertBookDrop(drops[0], raid, solo, id, tile);
  });
}

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
  // Combat Achievements sends the failure line, as with its settings on.
  (hooks.customHandlers ??= {})['combat-achievements:failed'] = [({ player, task, reason }) => player.sendMessage(`You have failed <col=0cc919>${task}</col>: ${reason}`)];
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

/** Real relation sets and deferred action, with a synthetic raid/area and no World registration. */
function spectatorFixture(t) {
  const Spectate = require('../plugins/minigames/tob/Spectate.TheatreOfBlood');
  const { Misc } = require('../dist/util/Misc');
  const { World } = require('../dist/game/World');
  const { PrivateChatStatus } = require('../dist/game/model/PlayerRelations');
  const names = ['tob:may-spectate', 'tob:observe', 'tob:room-built', 'tob:raid-over'];
  const savedHandlers = new Map(names.map((name) => [name, hooks.customHandlers[name]]));
  const key = Symbol('spectator fixture');
  let viewer, raid;
  t.after(() => {
    if (viewer) {
      viewer.setEnteredSyntaxAction(null);
      viewer.setUntargetable(false);
      viewer.getMovementQueue().reset();
      raid?.spectators.delete(viewer);
    }
    Raid.raids.delete(key);
    for (const [name, handlers] of savedHandlers) {
      if (handlers) hooks.customHandlers[name] = handlers;
      else delete hooks.customHandlers[name];
    }
  });
  // Network and World list adapters; addFriend still populates the real relation set.
  t.mock.method(World, 'getPlayers', () => ({ forEach() {}, search() { return undefined; } }));
  t.mock.method(World, 'getPlayerByName', () => undefined);
  const actor = (name) => {
    const p = realReader(t, name);
    p.setLongUsername(Misc.stringToLongBigInt(name));
    return p;
  };
  let member, other, spectator;
  [viewer, member, other, spectator] = ['Viewer', 'Member', 'Other', 'Spectator'].map(actor);
  const ids = [viewer, member, other, spectator].map((p) => p.getLongUsername());
  assert.ok(ids.every((id) => id !== 0n));
  assert.equal(new Set(ids).size, ids.length);
  let entered = 0;
  raid = { id: Number.MAX_SAFE_INTEGER, over: false, players: [member, other],
    spectators: new Set([spectator]), area: { enter() { entered++; } }, room: null };
  Raid.raids.set(key, raid);
  hooks.customHandlers['tob:may-spectate'] = [];
  Spectate(hooks.api);
  const chooseName = (name) => {
    viewer.setEnteredSyntaxAction(null);
    hooks.api.emitCustomEvent('tob:observe', { player: viewer, recent: false });
    const action = viewer.getEnteredSyntaxAction();
    assert.ok(action && typeof action.execute === 'function', 'observe armed a fresh name action');
    action.execute(name);
  };
  const reset = () => { raid.spectators.delete(viewer); viewer.setUntargetable(false); };
  assert.equal(raid.spectators.has(viewer), false);
  assert.equal(viewer.isUntargetable(), false);
  assert.equal(entered, 0);
  return { viewer, member, other, spectator, raid, chooseName, reset,
    entered: () => entered, PrivateChatStatus };
}

test('named Theatre admission accepts ON and an actual listed friend', (t) => {
  const f = spectatorFixture(t);
  f.other.getRelations().setStatus(f.PrivateChatStatus.FRIENDS_ONLY, false);
  f.member.getRelations().setStatus(f.PrivateChatStatus.ON, false);
  f.chooseName('Member');
  assert.equal(f.entered(), 1, 'ON succeeds even though another member has a strict list');
  assert.equal(f.raid.spectators.has(f.viewer), true);
  f.reset();
  f.member.getRelations().setStatus(f.PrivateChatStatus.FRIENDS_ONLY, false);
  f.member.getRelations().addFriend(f.viewer.getLongUsername());
  assert.equal(f.member.getRelations().hasFriend(f.viewer.getLongUsername()), true);
  f.chooseName('Member');
  assert.equal(f.entered(), 2, 'the named member listed the viewer');
});

test('named Theatre member with Friends Only denies an unlisted viewer', (t) => {
  const f = spectatorFixture(t);
  f.member.getRelations().setStatus(f.PrivateChatStatus.FRIENDS_ONLY, false);
  f.viewer.getRelations().addFriend(f.member.getLongUsername());
  assert.equal(f.member.getRelations().hasFriend(f.viewer.getLongUsername()), false, 'reverse friendship is insufficient');
  f.chooseName('Member');
  assert.equal(f.entered(), 0, 'an unlisted viewer is refused before entering the area');
  assert.equal(f.raid.spectators.has(f.viewer), false);
  assert.equal(f.viewer.isUntargetable(), false);
  f.member.getRelations().addFriend(f.viewer.getLongUsername());
  f.chooseName('Member');
  assert.equal(f.entered(), 1, 'adding the viewer grants admission');
});

test('named Theatre spectator with Friends Only owns the admission list', (t) => {
  const f = spectatorFixture(t);
  f.spectator.getRelations().setStatus(f.PrivateChatStatus.FRIENDS_ONLY, false);
  f.chooseName('Spectator');
  assert.equal(f.entered(), 0, 'an unlisted viewer is refused before entering the area');
  assert.equal(f.raid.spectators.has(f.viewer), false);
  assert.equal(f.viewer.isUntargetable(), false);
  f.spectator.getRelations().addFriend(f.viewer.getLongUsername());
  f.chooseName('Spectator');
  assert.equal(f.entered(), 1, 'the spectator listing the viewer grants admission');
});

test('Theatre preserves Recent Party, OFF, ignore and existing event veto behavior', (t) => {
  const f = spectatorFixture(t);
  f.member.getRelations().setStatus(f.PrivateChatStatus.OFF, false);
  f.chooseName('Member');
  assert.equal(f.entered(), 1, 'OFF retains existing TSPS behavior');
  f.reset();
  f.member.getRelations().addIgnore(f.viewer.getLongUsername());
  f.member.getRelations().setStatus(f.PrivateChatStatus.ON, false);
  f.chooseName('Member');
  assert.equal(f.entered(), 2, 'ignore retains existing TSPS behavior');
  f.reset();
  f.other.getRelations().setStatus(f.PrivateChatStatus.FRIENDS_ONLY, false);
  hooks.api.emitCustomEvent('tob:observe', { player: f.viewer, recent: true });
  assert.equal(f.entered(), 3, 'Recent retains existing TSPS behavior');
  f.reset();
  hooks.customHandlers['tob:may-spectate'].unshift((request) => { request.allowed = false; });
  f.chooseName('Member');
  assert.equal(f.entered(), 3, 'an earlier veto remains effective');
  assert.equal(f.raid.spectators.has(f.viewer), false);
});

test('the party HUD Exit takes a spectator out of the Theatre; a party member click is left alone', (t) => {
  const f = spectatorFixture(t);
  const Shared = require('../plugins/minigames/tob/Shared.TheatreOfBlood');
  const uid = PluginManager.getCoreApi().CacheDefinitions.getComponentId('tob_hud:spectator_exit');
  assert.equal(uid, (28 << 16) | 15, 'PRE: the cache component');
  const exit = hooks.buttons[uid];
  assert.equal(typeof exit, 'function', 'tob_hud:spectator_exit (28:15) has a handler');
  const closed = [];
  f.raid.closeHud = (player) => closed.push(player);
  assert.equal(exit({ player: f.member }), false, 'not a spectator: nothing happens');
  assert.deepEqual(closed, []);
  f.member.getRelations().setStatus(f.PrivateChatStatus.ON, false);
  f.chooseName('Member');
  assert.equal(f.raid.spectators.has(f.viewer), true, 'PRE: watching');
  assert.equal(f.viewer.isUntargetable(), true);
  assert.equal(exit({ player: f.viewer }), true);
  assert.equal(f.raid.spectators.has(f.viewer), false, 'no longer a spectator');
  assert.equal(f.viewer.isUntargetable(), false);
  assert.deepEqual(closed, [f.viewer], 'the HUD is cleared');
  const at = f.viewer.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [Shared.OUTSIDE.x, Shared.OUTSIDE.y, Shared.OUTSIDE.z], 'put outside the Theatre');
  assert.equal(exit({ player: f.viewer }), false, 'a second click does nothing');
});

// A save made mid-raid (shutdown, saveall, a requested save) has no logout record. Back in the theatre with no raid,
// the player is put outside and leaves the Theatre's own items: the Dawnbringer and the bandages.
test('a login from a mid-raid save in the theatre leaves the Dawnbringer and bandages behind', () => {
  const player = fakePlayer('Crashed');
  player.location = new Location(3168, 4303, 0);
  assert.equal(Shared.inTheatre(player.location), true, 'standing in the theatre');
  player.inventory.setItem(0, new Item(Shared.ITEM.BANDAGES, 4));
  player.inventory.setItem(1, new Item(4151, 1));
  // A worn one goes through the real weapon reset: tests/tob-relog-items.test.cjs.
  player.inventory.setItem(2, new Item(Shared.ITEM.DAWNBRINGER, 1));
  RaidUnit.returnAfterLogout({ player });
  assert.equal(player.inventory.getAmount(Shared.ITEM.BANDAGES), 0, 'bandages gone');
  assert.equal(player.inventory.getAmount(Shared.ITEM.DAWNBRINGER), 0, 'Dawnbringer gone');
  assert.equal(player.inventory.getAmount(4151), 1, 'own items kept');
  assert.deepEqual([player.location.getX(), player.location.getY()], [Shared.OUTSIDE.x, Shared.OUTSIDE.y]);
});

test('a logout whose raid is gone leaves the Dawnbringer behind, and never in the retrieval chest', () => {
  const { raid, players: [ann, bob] } = startRaid(['Ann4', 'Bob4']);
  raid.room.start();
  raid.member(ann).inFight = true;
  raid.onLogout(ann);
  const saved = ann.getAttribute(Raid.ATTR_LOGOUT);
  raid.dispose();
  const returning = fakePlayer('Ann4');
  returning.setAttribute(Raid.ATTR_LOGOUT, saved);
  returning.inventory.setItem(0, new Item(Shared.ITEM.DAWNBRINGER, 1));
  returning.inventory.setItem(1, new Item(4151, 1));
  RaidUnit.returnAfterLogout({ player: returning });
  assert.equal(returning.inventory.getAmount(Shared.ITEM.DAWNBRINGER), 0);
  assert.equal((Retrieval.lotOf(returning)?.items ?? []).some((item) => item.id === Shared.ITEM.DAWNBRINGER), false);
  assert.equal((Retrieval.lotOf(returning)?.items ?? []).some((item) => item.id === 4151), true, 'the death still stores the rest');
  void bob;
});

test('the scoreboard resets the main modal before opening, as live does (rsprox_transcripts/231/00409.txt)', () => {
  const Stats = require('../plugins/minigames/tob/Stats.TheatreOfBlood');
  const reader = fakePlayer('Reader');
  assert.equal(Stats.openScoreboard({ player: reader }), true);
  assert.deepEqual(reader.opened, [['script', 2524, [-1, -1]], ['interface', 363]]);
  const outside = fakePlayer('Outside');
  outside.location = new Location(3186, 4446, 0);
  assert.equal(Stats.openScoreboard({ player: outside }), false);
  assert.deepEqual(outside.opened, []);
});
