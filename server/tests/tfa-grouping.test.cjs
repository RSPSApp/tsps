// Run after `yarn build`: node --test tests/tfa-grouping.test.cjs
// The Fractured Archive's Grouping Board with the Grouping plugin's player groups. The "grouping:"
// events are answered by a stand-in that follows the plugin's documented replies (docs/grouping.md).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, beforeEach, afterEach } = require('node:test');

require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');
const Shared = require('../plugins/minigames/tfa/Shared.FracturedArchive');
const Parties = require('../plugins/minigames/tfa/Parties.FracturedArchive');
const Board = require('../plugins/minigames/tfa/Grouping.FracturedArchive');

const { LIST_BUTTON, DETAILS_BUTTON } = Board;
const IN_LOBBY = () => new Location(4127, 5530, 0);
const IN_LUMBRIDGE = () => new Location(3222, 3218, 0);

/** Each group: { id, leader, members (every member, leader first), offline (names) }. */
const groups = [];
const hooks = { emitted: [], startup: [], grouping: true };

function groupOf(player) {
  return groups.find((group) => group.members.includes(player)) ?? null;
}

/** The Grouping plugin's replies (Activities.Grouping.js), over the groups above. */
function answer(name, request) {
  if (!hooks.grouping) return;
  if (name === 'grouping:members') {
    const group = groupOf(request.player);
    request.max = request.maxSize;
    if (!group) {
      Object.assign(request, { groupId: 0, leader: null, isLeader: false, members: [request.player], size: 1, fits: true });
      return;
    }
    const online = group.members.filter((member) => !group.offline.includes(member.name));
    Object.assign(request, {
      groupId: group.id,
      leader: online.includes(group.leader) ? group.leader : null,
      isLeader: group.leader === request.player,
      members: online,
      size: group.members.length,
      fits: group.members.length <= request.maxSize,
    });
    if (!request.fits) request.message = `Your group has ${group.members.length} players; ${request.activity} takes at most ${request.maxSize}.`;
  } else if (name === 'grouping:same-group') {
    const mine = groupOf(request.player);
    request.same = !!mine && mine === groupOf(request.other);
  }
}

function fakeApi() {
  const base = {
    core: PluginManager.getCoreApi(),
    emitCustomEvent: (name, payload) => {
      hooks.emitted.push({ name, payload });
      answer(name, payload);
    },
    onServerStartup: (handler) => hooks.startup.push(handler),
    persistAttribute() {},
    sendMultiChatboxPrompt() {},
  };
  return new Proxy(base, {
    get: (target, name) => (name in target ? target[name] : (typeof name === 'string' && name.startsWith('on') ? () => {} : undefined)),
  });
}

let nextIndex = 1;
function fakePlayer(name, location = IN_LOBBY()) {
  const attributes = new Map();
  const varbits = new Map();
  const index = nextIndex++;
  const p = {
    name, location, messages: [], scripts: [], interfaces: [], texts: {}, varbits,
    getUsername: () => name, getDisplayName: () => name, getIndex: () => index,
    isPlayer: () => true,
    getLocation: () => p.location,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => p.messages.push(message),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCombatLevel: () => 126 }),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        sendConfig: (id, value) => { varbits.set(`varp${id}`, value); return sender; },
        sendInterface: (id) => { p.interfaces.push(id); return sender; },
        sendInterfaceRemoval: () => sender,
        sendClientScript: (id, ...args) => { p.scripts.push([id, ...args]); return sender; },
        sendInterfaceFlagsRange: () => sender,
        sendString: (text, uid) => { p.texts[uid] = text; return sender; },
      };
      return sender;
    },
  };
  return p;
}

function group(leader, ...members) {
  const made = { id: groups.length + 1, leader, members: [leader, ...members], offline: [] };
  groups.push(made);
  return made;
}

function click(player, component, slot) {
  Board.resumeButton({ player, buttonId: Shared.id('component', component), action: slot, handled: false });
}

function makeParty(player) {
  Board.openList(player);
  click(player, 'LIST_CONTENTS', LIST_BUTTON.MY_PARTY);
  return Parties.partyOf(player);
}

/** Opens a party's details and clicks its main button (Apply for someone outside it). */
function applyTo(player, party) {
  Board.openDetails(player, party);
  click(player, 'DETAILS_BUTTONS', DETAILS_BUTTON.PRIMARY);
}

function footerRights(player) {
  return player.scripts.filter(([id]) => id === Shared.SCRIPT.PARTY_FOOTER).at(-1)?.[1];
}

function overlayNames(player) {
  return player.texts[Shared.id('component', 'LOBBY_NAMES')];
}

function partyStatus(player) {
  return player.varbits.get(Shared.id('varbit', 'PARTY_STATUS'));
}

const madeMessage = (leader) => `${leader.name} has made a Fractured Archive party for your group. Apply at the Grouping Board and you'll be let straight in.`;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Board(fakeApi());
});

beforeEach(() => {
  groups.length = 0;
  hooks.emitted.length = 0;
  hooks.grouping = true;
});

afterEach(() => {
  for (const party of [...Parties.parties.values()]) party.dispose();
});

test('the Archive tells the Grouping plugin at startup that it takes eight', () => {
  assert.equal(hooks.startup.length, 1, 'one startup hook');
  hooks.startup[0]({});
  const announced = hooks.emitted.filter(({ name }) => name === 'grouping:activity');
  assert.deepEqual(announced.map(({ payload }) => payload), [{ name: 'Fractured Archive', maxSize: 8 }]);
});

test("a group leader's new party takes in the members waiting in the lobby; the others are told", () => {
  const leader = fakePlayer('Lead');
  const ann = fakePlayer('Ann');
  const away = fakePlayer('Away', IN_LUMBRIDGE());
  const bob = fakePlayer('Bob');
  const offline = fakePlayer('Gone');
  const made = group(leader, ann, away, bob, offline);
  made.offline.push('Gone');

  const party = makeParty(leader);
  assert.deepEqual(party.members.map((member) => member.name), ['Lead', 'Ann', 'Bob'], 'in the group\'s order, the one away left out');
  assert.deepEqual(party.applicants, [], 'nobody is left applying');
  for (const member of [ann, bob]) {
    assert.equal(partyStatus(member), 1, `${member.name}'s party status is set`);
    assert.equal(member.varbits.get(`varp${Shared.id('varp', 'CONTROLLER')}`), party.controller, `${member.name} has the party's controller`);
    assert.equal(overlayNames(member), 'Lead<br>Ann<br>Bob<br>-<br>-<br>-<br>-<br>-', `${member.name}'s lobby overlay lists it`);
    assert.deepEqual(member.messages, [], `${member.name} isn't told to apply`);
  }
  assert.equal(footerRights(leader), Parties.RIGHTS.LEADER, 'the leader sees the party');
  const shown = leader.scripts.filter(([id]) => id === Shared.SCRIPT.PARTY_MEMBER).slice(-Shared.MAX_PARTY_SIZE);
  assert.deepEqual(shown.map(([, , line]) => line.split('|')[0]), ['Lead', 'Ann', 'Bob', '', '', '', '', ''], 'with all three members');
  assert.deepEqual(leader.messages, [], 'a group that fits gives the leader no message');
  assert.deepEqual(away.messages, [madeMessage(leader)]);
  assert.deepEqual(offline.messages, [], 'an offline member is not reached');
});

test('a group member already in another party stays there and is told', () => {
  const leader = fakePlayer('Lead');
  const cat = fakePlayer('Cat');
  const other = Parties.create(cat);
  group(leader, cat);

  const party = makeParty(leader);
  assert.deepEqual(party.members, [leader]);
  assert.deepEqual(other.members, [cat], 'not pulled out of the party they are in');
  assert.deepEqual(party.applicants, []);
  assert.deepEqual(leader.messages, [], 'the leader sees no "joined another party"');
  assert.deepEqual(cat.messages, [madeMessage(leader)]);
});

test("a group member's application elsewhere is withdrawn as they are taken in", () => {
  const leader = fakePlayer('Lead');
  const dan = fakePlayer('Dan');
  const elsewhere = Parties.create(fakePlayer('Eve'));
  elsewhere.apply(dan);
  group(leader, dan);

  const party = makeParty(leader);
  assert.deepEqual(party.members, [leader, dan]);
  assert.deepEqual(elsewhere.applicants, [], 'one party at a time');
});

test('a group bigger than the Archive: eight go in, the leader and the ninth are told', () => {
  const leader = fakePlayer('Lead');
  const members = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'].map((name) => fakePlayer(name));
  group(leader, ...members);

  const party = makeParty(leader);
  assert.equal(party.members.length, Shared.MAX_PARTY_SIZE);
  assert.deepEqual(party.members, [leader, ...members.slice(0, 7)]);
  assert.deepEqual(leader.messages, ['Your group has 9 players; Fractured Archive takes at most 8.']);
  assert.deepEqual(members[7].messages, [madeMessage(leader)]);

  // A full party takes no applications at all, as before.
  applyTo(members[7], party);
  assert.equal(footerRights(members[7]), Parties.RIGHTS.CANNOT_APPLY);
  assert.deepEqual(party.applicants, []);
  assert.equal(party.members.length, Shared.MAX_PARTY_SIZE);
});

test("a group member applying to their leader's party is accepted at once, as the leader's Accept does", () => {
  const leader = fakePlayer('Lead');
  const fay = fakePlayer('Fay', IN_LUMBRIDGE());
  group(leader, fay);
  const party = makeParty(leader);
  assert.deepEqual(party.members, [leader]);

  fay.location = IN_LOBBY();
  Board.openDetails(leader, party);
  applyTo(fay, party);
  assert.deepEqual(party.members, [leader, fay]);
  assert.deepEqual(party.applicants, []);
  assert.equal(footerRights(fay), Parties.RIGHTS.MEMBER, 'her details show her in the party');
  assert.equal(partyStatus(fay), 1, 'and her party status');
  assert.equal(overlayNames(leader), 'Lead<br>Fay<br>-<br>-<br>-<br>-<br>-<br>-', "the leader's overlay follows");
  assert.equal(footerRights(leader), Parties.RIGHTS.LEADER, "the leader's open details are redrawn");
});

test('a group member the party rejected before still cannot get in', () => {
  const leader = fakePlayer('Lead');
  const gil = fakePlayer('Gil');
  const party = makeParty(leader);
  applyTo(gil, party);
  Board.openDetails(leader, party);
  click(leader, 'DETAILS_BUTTONS', DETAILS_BUTTON.REJECT_FIRST);
  assert.equal(party.rightsOf(gil), Parties.RIGHTS.CANNOT_APPLY);

  group(leader, gil);
  applyTo(gil, party);
  assert.deepEqual(party.members, [leader]);
  assert.deepEqual(party.applicants, []);
});

test('without a group nothing changes: a party of one, applicants wait for the leader', () => {
  for (const grouping of [true, false]) {
    hooks.grouping = grouping;
    const leader = fakePlayer('Solo');
    const hal = fakePlayer('Hal');
    const party = makeParty(leader);
    assert.deepEqual(party.members, [leader]);
    assert.deepEqual(leader.messages, []);
    assert.deepEqual(hal.messages, []);

    applyTo(hal, party);
    assert.deepEqual(party.applicants, [hal], 'an ordinary application');
    assert.deepEqual(party.members, [leader]);
    assert.equal(footerRights(hal), Parties.RIGHTS.APPLICANT);
    party.disband();
  }
});

test("someone else's group member is an ordinary applicant", () => {
  const leader = fakePlayer('Lead');
  const ivy = fakePlayer('Ivy');
  group(fakePlayer('Other'), ivy);
  const party = makeParty(leader);
  applyTo(ivy, party);
  assert.deepEqual(party.applicants, [ivy]);
  assert.deepEqual(party.members, [leader]);
});

test("a group member's own party is not their leader's: they make an ordinary one", () => {
  const leader = fakePlayer('Lead');
  const jo = fakePlayer('Jo');
  group(leader, jo);
  const party = makeParty(jo);
  assert.deepEqual(party.members, [jo], 'only the leader brings the group');
  assert.deepEqual(leader.messages, []);
  assert.equal(Parties.partyOf(leader), null);
});
