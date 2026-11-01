// Run after `yarn build`: node --test tests/clans.test.cjs
// Clans against live captures: 3886 and 763 the login, 2528 the Chat and Leave button, 322 chat.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const protocol = require('../dist/net/protocol/ClientProtocol');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Task } = require('../dist/game/task/Task');
const { PlayerRights } = require('../dist/game/model/rights/PlayerRights');
const Clans = require('../plugins/interface/clans/Clans.plugin');

const CHAT_MESSAGE = 120;
const CLAN_SETTINGS_FULL = 124;
const CLAN_CHANNEL_FULL = 125;
const CLAN_CHANNEL_DELTA = 126;

let dir;
let hooks;
let online;
let nextIndex = 1;

function player(name) {
  const self = {
    packets: [],
    varbits: new Map(),
    notices: [],
    messages: [],
    getUsername: () => name,
    getLongUsername: () => BigInt(name.length),
    getIndex: () => (self.index ??= nextIndex++),
    getHostAddress: () => '127.0.0.1',
    getRelations: () => ({ hasIgnore: (long) => self.ignores?.has(long) === true }),
    sendMessage: (text) => self.messages.push(text),
    getSession: () => ({ sendClientPacket: (packet) => self.packets.push(packet) }),
    getPacketSender: () => ({
      sendVarbit(id, value) {
        self.varbits.set(id, value);
        return this;
      },
      sendTypedMessage(type, text) {
        self.notices.push([type, text]);
        return this;
      },
    }),
  };
  online.push(self);
  return self;
}

/** A frame starts with its opcode. */
function sent(self, opcode) {
  return self.packets.filter((packet) => packet[0] === opcode);
}

function runTicks(ticks) {
  for (let i = 0; i < ticks; i++) TaskManager.process();
}

function login(self) {
  hooks.custom.get('player:bootstrap-complete')({ player: self });
}

function click(self, childId) {
  const event = { player: self, groupId: 701, childId };
  hooks.click(event);
  return event;
}

function say(self, text, clanType = 0) {
  const event = { player: self, packet: { type: 'clan_chat', clanType, text }, handled: false };
  hooks.social(event);
  return event;
}

function chatText(self) {
  return sent(self, CHAT_MESSAGE).map((packet) => packet.toString('latin1'));
}

function createClan(self, name = 'Blur') {
  hooks.commands.get('clancreate').handler({ player: self, parts: ['clancreate', ...name.split(' ')] });
}

function addMember(owner, target) {
  hooks.commands.get('clanadd').handler({ player: owner, parts: ['clanadd', target.getUsername()] });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clans-'));
  process.env.TSPS_CLANS_FILE = path.join(dir, 'clans.json');
  online = [];
  hooks = { custom: new Map(), commands: new Map() };
  Clans._reset();
  Clans.register({
    core: {
      ...protocol,
      Task,
      TaskManager,
      PlayerRights,
      World: {
        getPlayers: () => ({ search: (match) => online.find(match) ?? null }),
      },
    },
    onCustomEvent: (name, handler) => hooks.custom.set(name, handler),
    onPlayerLogout: (handler) => (hooks.logout = handler),
    onSocialPacket: (handler) => (hooks.social = handler),
    onInterfaceActionClick: (handler) => (hooks.click = handler),
    registerCommand: (name, handler, rank) => hooks.commands.set(name, { handler, rank }),
  });
});

afterEach(() => {
  delete process.env.TSPS_CLANS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a player with no clan is told so, and the client drops any clan it held', () => {
  const self = player('Solo');
  login(self);
  assert.equal(self.varbits.get(933), 1, 'No current clan');
  assert.equal(self.varbits.get(12164), 1, 'no guest clan');
  assert.deepEqual(sent(self, CLAN_SETTINGS_FULL)[0], protocol.encodeClanSettingsFull(0, null));
  assert.deepEqual(sent(self, CLAN_CHANNEL_FULL)[0], protocol.encodeClanChannelFull(0, null));
});

test('creating a clan makes the player its owner, in its channel, with status 3 and home world', () => {
  const self = player('Founder');
  createClan(self, 'Blur Clan');
  assert.equal(self.varbits.get(933), 3);
  assert.equal(self.varbits.get(12167), 1);
  const settings = sent(self, CLAN_SETTINGS_FULL)[0].toString('latin1');
  assert.match(settings, /Blur Clan/);
  assert.match(settings, /Founder/);
  assert.match(sent(self, CLAN_CHANNEL_FULL)[0].toString('latin1'), /Founder/);
  assert.deepEqual(self.notices, [[43, "To talk in your clan's channel, start each line of chat with // or /c."]]);
});

test('commands are owner rank, and names are unique', () => {
  assert.equal(hooks.commands.get('clancreate').rank, PlayerRights.OWNER);
  assert.equal(hooks.commands.get('clanadd').rank, PlayerRights.OWNER);
  const first = player('First');
  const second = player('Second');
  createClan(first, 'Blur');
  createClan(second, 'blur');
  assert.deepEqual(second.messages, ['That name is taken.']);
  createClan(first, 'Other');
  assert.deepEqual(first.messages, ['You are already in a clan.']);
});

test('a clan survives a restart and the login rejoins its channel', () => {
  createClan(player('Founder'));
  Clans._reset();
  online = [];
  const again = player('Founder');
  login(again);
  assert.equal(again.varbits.get(933), 3);
  assert.match(sent(again, CLAN_SETTINGS_FULL)[0].toString('latin1'), /Blur/);
  assert.match(sent(again, CLAN_CHANNEL_FULL)[0].toString('latin1'), /Founder/);
  const saved = JSON.parse(fs.readFileSync(process.env.TSPS_CLANS_FILE, 'utf8'));
  assert.equal(saved.clans[0].members[0].rank, 126);
  assert.ok(saved.clans[0].members[0].joinRuneDay > 8000, 'live day count');
});

test('// reaches everyone in the channel as type 41 with the clan as prefix, except who ignores the speaker', () => {
  const owner = player('Owner');
  const member = player('Member');
  const ignorer = player('Ignorer');
  createClan(owner);
  addMember(owner, member);
  addMember(owner, ignorer);
  ignorer.ignores = new Set([owner.getLongUsername()]);
  const before = chatText(member).length;
  const event = say(owner, 'hello clan');
  assert.equal(event.handled, true);
  const line = chatText(member).slice(before);
  assert.equal(line.length, 1);
  assert.deepEqual(line[0], protocol
    .encodeChatMessage('clan', 'hello clan', 'Owner', 'Blur', owner.getIndex(), 41)
    .toString('latin1'));
  assert.equal(chatText(owner).length, 1, 'the speaker sees it too');
  assert.equal(chatText(ignorer).length, 0);
});

test('// outside a channel is refused, and a guest clan type is not ours yet', () => {
  const self = player('Solo');
  say(self, 'hello');
  assert.deepEqual(self.notices, [[43, 'You are not currently in a clan channel.']]);
  const owner = player('Owner');
  createClan(owner);
  const event = say(owner, 'hello', 255);
  assert.equal(event.handled, true);
  assert.equal(chatText(owner).length, 0);
});

test('channel users are told of joins and leaves as deltas with a rising update number', () => {
  const owner = player('Owner');
  const member = player('Member');
  createClan(owner);
  addMember(owner, member);
  assert.deepEqual(sent(owner, CLAN_CHANNEL_DELTA).at(-1), protocol.encodeClanChannelDelta(0, 1, 2, [
    { type: 'add', user: { name: 'Member', rank: 0, world: 1 } },
  ]));
  hooks.logout({ player: member });
  assert.deepEqual(sent(owner, CLAN_CHANNEL_DELTA).at(-1), protocol.encodeClanChannelDelta(0, 1, 3, [
    { type: 'delete', index: 1 },
  ]));
});

test('Leave answers at once and Chat three ticks later, with the button grey for five (2528)', () => {
  const owner = player('Owner');
  createClan(owner);
  assert.equal(click(owner, 8).handled, true);
  assert.equal(owner.varbits.get(13806), 1);
  assert.deepEqual(sent(owner, CLAN_CHANNEL_FULL).at(-1), protocol.encodeClanChannelFull(0, null));
  runTicks(5);
  assert.equal(owner.varbits.get(13806), 0);

  const fulls = sent(owner, CLAN_CHANNEL_FULL).length;
  click(owner, 8);
  runTicks(2);
  assert.equal(sent(owner, CLAN_CHANNEL_FULL).length, fulls, 'not yet');
  runTicks(1);
  assert.equal(sent(owner, CLAN_CHANNEL_FULL).length, fulls + 1);
  assert.match(sent(owner, CLAN_CHANNEL_FULL).at(-1).toString('latin1'), /Owner/);
  runTicks(5);
});

test('having left the channel is remembered across a login', () => {
  const first = player('Owner');
  createClan(first);
  click(first, 8);
  runTicks(5);
  hooks.logout({ player: first });
  Clans._reset();
  online = [];
  const again = player('Owner');
  login(again);
  assert.equal(again.varbits.get(933), 3, 'still in the clan');
  assert.deepEqual(sent(again, CLAN_CHANNEL_FULL)[0], protocol.encodeClanChannelFull(0, null));
  assert.deepEqual(again.notices, []);
});

test('Settings says it is unavailable, and other interfaces are left alone', () => {
  const owner = player('Owner');
  createClan(owner);
  assert.equal(click(owner, 9).handled, true);
  assert.deepEqual(owner.messages, ['Clan settings are not available yet.']);
  const other = { player: owner, groupId: 702, childId: 8 };
  hooks.click(other);
  assert.equal(other.handled, undefined);
});
