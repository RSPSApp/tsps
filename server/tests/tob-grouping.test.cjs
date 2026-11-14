// Run after `yarn build`: node --test tests/tob-grouping.test.cjs
// The Theatre of Blood's party board with the Grouping plugin's player groups. The "grouping:"
// events are answered by a stand-in that follows the plugin's documented replies (docs/grouping.md).
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');

require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');
const Shared = require('../plugins/minigames/tob/Shared.TheatreOfBlood');
const Parties = require('../plugins/minigames/tob/Parties.TheatreOfBlood');
const Lobby = require('../plugins/minigames/tob/Lobby.TheatreOfBlood');

const LIST_BUTTONS = (Shared.INTERFACE.PARTIES_OVERVIEW << 16) | 3;
const INFO = Shared.INTERFACE.PARTY_INFORMATION << 16;
const MY_PARTY = 1;
const PRIMARY = 5;
const DECLINE_FIRST = 22;
const IN_VER_SINHAZA = () => new Location(3667, 3219, 0);
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
/** Everyone here has spoken to the Mysterious Stranger, as the board needs, unless told otherwise. */
function fakePlayer(name, location = IN_VER_SINHAZA(), { metStranger = true } = {}) {
  const attributes = new Map([[Lobby.ATTR.MET_STRANGER, metStranger]]);
  const varbits = new Map();
  const index = nextIndex++;
  const p = {
    name, location, messages: [], scripts: [], interfaces: [], statements: [], texts: {}, subs: new Map(), varbits,
    getUsername: () => name, getDisplayName: () => name, getIndex: () => index,
    isPlayer: () => true,
    getLocation: () => p.location,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => p.messages.push(message),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCombatLevel: () => 126 }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.statements.push(chain) }),
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
        sendInterfaceFlags: () => sender,
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

function makeParty(player) {
  Lobby.openOverview(player);
  Lobby.resumeButton({ player, buttonId: LIST_BUTTONS, action: MY_PARTY, handled: false });
  return Parties.partyOf(player);
}

/** Opens a party's information and clicks its main button (Apply for someone outside it). */
function applyTo(player, party) {
  Lobby.openInformation(player, party);
  Lobby.resumeButton({ player, buttonId: INFO, action: PRIMARY, handled: false });
}

function footerRights(player) {
  return player.scripts.filter(([id]) => id === Shared.SCRIPT.PARTY_FOOTER).at(-1)?.[1];
}

const HUD_NAMES = (Shared.INTERFACE.PARTY_HUD << 16) | 12;
const madeMessage = (leader) => `${leader.name} has made a Theatre of Blood party for your group. Apply at the notice board and you'll be let straight in.`;

Lobby(fakeApi());

beforeEach(() => {
  groups.length = 0;
  hooks.emitted.length = 0;
  hooks.grouping = true;
});

afterEach(() => {
  for (const party of [...Parties.parties.values()]) party.dispose();
});

test('the theatre tells the Grouping plugin at startup that it takes five', () => {
  assert.equal(hooks.startup.length, 1, 'one startup hook');
  hooks.startup[0]({});
  const announced = hooks.emitted.filter(({ name }) => name === 'grouping:activity');
  assert.deepEqual(announced.map(({ payload }) => payload), [{ name: 'Theatre of Blood', maxSize: 5 }]);
});

test("a group leader's new party takes in the members waiting in Ver Sinhaza; the others are told", () => {
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
    assert.equal(member.varbits.get(Shared.VARBIT.PARTY_STATE), 1, `${member.name}'s HUD shows the party`);
    assert.equal(member.texts[HUD_NAMES], 'Lead<br>Ann<br>Bob<br>-<br>-<br>', `${member.name}'s HUD lists it`);
    assert.deepEqual(member.messages, [], `${member.name} isn't told to apply`);
  }
  assert.equal(footerRights(leader), Parties.RIGHTS.LEADER, 'the leader sees the party');
  const shown = leader.scripts.filter(([id]) => id === Shared.SCRIPT.PARTY_MEMBER).slice(-Shared.MAX_PARTY_SIZE);
  assert.deepEqual(shown.map(([, , line]) => line.split('|')[0]), ['Lead', 'Ann', 'Bob', '', ''], 'with all three members');
  assert.deepEqual(leader.messages, [], 'a group that fits gives the leader no message');
  assert.deepEqual(away.messages, [madeMessage(leader)]);
  assert.deepEqual(offline.messages, [], 'an offline member is not reached');
});

test("a group member who hasn't met the Mysterious Stranger is told, as they couldn't apply yet", () => {
  const leader = fakePlayer('Lead');
  const newcomer = fakePlayer('New', IN_VER_SINHAZA(), { metStranger: false });
  group(leader, newcomer);

  const party = makeParty(leader);
  assert.deepEqual(party.members, [leader], 'not taken in past the board');
  assert.deepEqual(newcomer.messages, [madeMessage(leader)]);
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
  assert.deepEqual(leader.statements, [], 'the leader sees no "joined another party"');
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

test('a group bigger than the theatre: five go in, the leader and the sixth are told', () => {
  const leader = fakePlayer('Lead');
  const members = ['M1', 'M2', 'M3', 'M4', 'M5'].map((name) => fakePlayer(name));
  group(leader, ...members);

  const party = makeParty(leader);
  assert.equal(party.members.length, Shared.MAX_PARTY_SIZE);
  assert.deepEqual(party.members, [leader, ...members.slice(0, 4)]);
  assert.deepEqual(leader.messages, ['Your group has 6 players; Theatre of Blood takes at most 5.']);
  assert.deepEqual(members[4].messages, [madeMessage(leader)]);

  // Applying to the full party is an ordinary application.
  applyTo(members[4], party);
  assert.deepEqual(party.applicants, [members[4]]);
  assert.equal(party.members.length, Shared.MAX_PARTY_SIZE);
});

test('a group member applying to their leader\'s party is accepted at once, as the leader\'s Accept does', () => {
  const leader = fakePlayer('Lead');
  const fay = fakePlayer('Fay', IN_LUMBRIDGE());
  group(leader, fay);
  const party = makeParty(leader);
  assert.deepEqual(party.members, [leader]);

  fay.location = IN_VER_SINHAZA();
  Lobby.openInformation(leader, party);
  applyTo(fay, party);
  assert.deepEqual(party.members, [leader, fay]);
  assert.deepEqual(party.applicants, []);
  assert.equal(footerRights(fay), Parties.RIGHTS.MEMBER, 'her screen shows her in the party');
  assert.equal(fay.varbits.get(Shared.VARBIT.PARTY_STATE), 1, 'and the HUD');
  assert.equal(leader.texts[HUD_NAMES], 'Lead<br>Fay<br>-<br>-<br>-<br>', "the leader's HUD follows");
  assert.equal(footerRights(leader), Parties.RIGHTS.LEADER, "the leader's open screen is redrawn");
});

test('a group member the party declined before still cannot get in', () => {
  const leader = fakePlayer('Lead');
  const gil = fakePlayer('Gil');
  const party = makeParty(leader);
  applyTo(gil, party);
  Lobby.openInformation(leader, party);
  Lobby.resumeButton({ player: leader, buttonId: INFO, action: DECLINE_FIRST, handled: false });
  assert.equal(party.rightsOf(gil), Parties.RIGHTS.BLOCKED);

  group(leader, gil);
  applyTo(gil, party);
  assert.deepEqual(party.members, [leader]);
  assert.deepEqual(party.applicants, []);
  assert.equal(gil.statements.length, 1, '"You have been declined by this party."');
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
    party.dispose();
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
