// Run after `yarn build`: node --test tests/chat-channel.test.cjs
// The chat-channel against live captures: 763 kick and ban, 754 and 753 setup and disable, 749
// enabling, 189 refused joins, 3266 joining twice, 2528 and 75 the side panel's tabs.
const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { Misc } = require('../dist/util/Misc');
const { World } = require('../dist/game/World');
const { GameConstants } = require('../dist/game/GameConstants');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { encodeGameframeBootstrap, encodeGameframeTabSetup } = require('../dist/net/protocol/ClientProtocol');
const { FriendsChatManager: Manager, FriendsChatRank } = require('../plugins/interface/FriendsChatManager');
const { PlayerRelations } = require('../dist/game/model/PlayerRelations');

const CHAT_MESSAGE = 120;
let nextIndex = 1;
const online = [];

/** Reads the [type, text] of each CHAT_MESSAGE a player was sent. */
function chatLine(packet) {
  if (packet[0] !== CHAT_MESSAGE) return null;
  return String(packet.toString('latin1'));
}

function player(name) {
  const index = nextIndex++;
  const attributes = new Map();
  const lines = [];
  const self = {
    lines,
    texts: () => lines.join('\n'),
    getIndex: () => index,
    getUsername: () => name,
    getLongUsername: () => Misc.stringToLongBigInt(name.toLowerCase()),
    getHostAddress: () => '127.0.0.1',
    getRights: () => ({ getId: () => 0 }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => lines.push(`plain:${text}`),
    getPacketSender: () => new Proxy({}, { get: (_, __, sender) => () => sender }),
    getSession: () => ({ sendClientPacket: (packet) => { const line = chatLine(packet); if (line) lines.push(line); return true; } }),
  };
  const relations = new PlayerRelations(self);
  self.getRelations = () => relations;
  online.push(self);
  return self;
}

function runTicks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

beforeEach(() => {
  Manager.channels.clear();
  Manager.membershipByPlayer.clear();
  Manager.temporaryBans.clear();
  Manager.offlinePlayerIds.clear();
  Manager.pendingJoins.clear();
  Manager.pendingSetups.clear();
  online.length = 0;
  World.getPlayers = () => ({
    search: (match) => online.find(match),
    forEach: (visit) => online.forEach(visit),
  });
  GameConstants.PLAYER_PERSISTENCE = { requestSave() {}, load: () => null };
});

test('enabling a channel is immediate, tells the owner how to join, and does not join it', () => {
  const owner = player('Owner');
  Manager.setOwnChannelName(owner, 'Blur');
  assert.match(owner.texts(), /Your chat-channel has now been enabled!/);
  assert.match(owner.texts(), /Join your channel by clicking 'Join Chat' and typing: Owner/);
  assert.equal(Manager.channelOf(owner), null);
});

test('a join says Attempting, then is answered on the next tick', () => {
  const owner = player('Owner');
  const member = player('Member');
  Manager.setOwnChannelName(owner, 'Blur');
  Manager.handleAction(member, { action: 'join', name: 'Owner' });
  assert.match(member.texts(), /Attempting to join chat-channel\.\.\./);
  assert.equal(Manager.channelOf(member), null);
  runTicks(2);
  assert.equal(Manager.channelOf(member)?.name, 'Blur');
  assert.match(member.texts(), /Now talking in chat-channel Blur/);
  Manager.handleAction(member, { action: 'join', name: 'Owner' });
  assert.match(member.texts(), /Please wait until you are logged out of your previous chat-channel\./);
});

test('refusals use the live text, as chat-channel notifications', () => {
  const owner = player('Owner');
  const ignored = player('Ignored');
  const stranger = player('Stranger');
  Manager.join(stranger, 'Nobody', true);
  assert.match(stranger.texts(), /The channel you tried to join does not exist\./);
  Manager.setOwnChannelName(owner, 'Blur');
  owner.getRelations().addIgnore(ignored.getLongUsername());
  Manager.join(ignored, 'Owner', true);
  assert.match(ignored.texts(), /You are not allowed to join this user's chat-channel\./);
  assert.ok(!ignored.lines.some((line) => line.startsWith('plain:')), 'never a plain game message');
});

test('kick and leave use the live text, and the ban holds', () => {
  const owner = player('Owner');
  const member = player('Member');
  Manager.setOwnChannelName(owner, 'Blur');
  Manager.join(owner, 'Owner', false);
  Manager.join(member, 'Owner', false);
  Manager.kick(owner, 'Member');
  assert.match(member.texts(), /You have been kicked from the channel\./);
  Manager.join(member, 'Owner', true);
  assert.match(member.texts(), /You are temporarily banned from this chat-channel\./);
  Manager.leave(owner, true);
  assert.match(owner.texts(), /You have left the channel\./);
});

test('setup changes wait 100 ticks, with one notice for the window', () => {
  const owner = player('Owner');
  const member = player('Member');
  Manager.setOwnChannelName(owner, 'Blur');
  Manager.join(owner, 'Owner', false);
  Manager.setOwnChannelName(owner, 'Woot');
  Manager.setOwnChannelName(owner, 'Woot2');
  assert.equal(owner.lines.filter((line) => line.includes('Changes will take effect')).length, 1);
  assert.equal(owner.getRelations().getFriendsChatChannelName(), 'Woot2', 'saved at once');
  assert.equal(Manager.channelOf(owner).name, 'Blur', 'the channel keeps its name for now');
  Manager.refreshOwnedChannel(owner);
  assert.equal(Manager.channelOf(owner).name, 'Blur', 'a friends list refresh does not apply it early');
  runTicks(99);
  assert.equal(Manager.channelOf(owner).name, 'Blur');
  runTicks(2);
  assert.equal(Manager.channelOf(owner).name, 'Woot2');
  Manager.join(member, 'Owner', false);
  assert.equal(Manager.channelOf(member).name, 'Woot2');
});

test('disabling waits too, and joins meanwhile still work; then everyone is removed', () => {
  const owner = player('Owner');
  const member = player('Member');
  Manager.setOwnChannelName(owner, 'Blur');
  Manager.disableOwnChannel(owner);
  assert.match(owner.texts(), /Changes will take effect on your friends channel in the next 60 seconds\./);
  assert.equal(Manager.join(member, 'Owner', true), true, 'rsprox 753 joins during the wait');
  assert.equal(Manager.channelOf(member).name, 'Blur');
  runTicks(101);
  assert.match(owner.texts(), /Your chat-channel has now been disabled!/);
  assert.match(member.texts(), /You have been removed from this channel\./);
  assert.equal(Manager.channelOf(member), null);
  assert.equal(Manager.channels.size, 0);
  Manager.setOwnChannelName(owner, 'Back');
  assert.equal(owner.lines.filter((line) => line.includes('has now been enabled')).length, 2);
});

test('a channel emptied during the wait still takes the change', () => {
  const owner = player('Owner');
  Manager.setOwnChannelName(owner, 'Blur');
  Manager.join(owner, 'Owner', false);
  owner.getRelations().setFriendsChatRanks(FriendsChatRank.Recruit, -1, 2);
  Manager.setOwnChannelName(owner, 'Woot');
  Manager.leave(owner, false);
  assert.equal(Manager.channels.get('owner')?.profile.channelName, 'Blur');
  runTicks(101);
  assert.equal(Manager.channels.size, 0);
  assert.equal(owner.getRelations().getFriendsChatChannelName(), 'Woot');
});

test('the rejoin at login shows the join messages', () => {
  const owner = player('Owner');
  const member = player('Member');
  Manager.setOwnChannelName(owner, 'Blur');
  member.getRelations().setFriendsChatLastOwner('Owner');
  Manager.onLogin(member);
  assert.match(member.texts(), /Attempting to join chat-channel\.\.\./);
  assert.match(member.texts(), /Now talking in chat-channel Blur/);
});

test('the social tab mounts side_channels with the chat-channel inside it', () => {
  const opens = (packets) => packets.map((packet) => packet.toString('hex'));
  const bootstrap = opens(encodeGameframeBootstrap('Someone', 161));
  const [inner] = opens(encodeGameframeTabSetup(707, 161));
  assert.ok(inner, 'mounting 707 again brings its content');
  assert.ok(bootstrap.includes(inner), 'the login mounts the same content');
});

function panel() {
  const hooks = { custom: new Map() };
  const plugin = require('../plugins/interface/SideChannels.plugin.js');
  plugin.register({
    persistAttribute() {},
    onInterfaceActionClick: (hook) => { hooks.click = hook; },
    onCustomEvent: (name, hook) => hooks.custom.set(name, hook),
  });
  const sent = [];
  const attributes = new Map();
  const someone = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({
      sendVarbit(id, value) { sent.push(['varbit', id, value]); return this; },
      sendSubInterface: (uid, group) => sent.push(['mount', uid >>> 16, uid & 0xffff, group]),
      sendInterfaceFlagsRange: (uid, from, to, flags) => sent.push(['flags', uid >>> 16, uid & 0xffff, from, to, flags]),
    }),
  };
  return { hooks, sent, someone };
}

test('each tab button selects its tab, as live does', () => {
  const { hooks, sent, someone } = panel();
  for (const [button, tab, group] of [[3, 1, 701], [4, 2, 702], [5, 3, 76], [2, 0, 7]]) {
    sent.length = 0;
    const event = { player: someone, groupId: 707, childId: button };
    hooks.click(event);
    assert.equal(event.handled, true);
    assert.deepEqual(sent[0], ['varbit', 13071, tab]);
    assert.deepEqual(sent[1], ['mount', 707, 7, group]);
    if (group === 76) assert.deepEqual(sent[2], ['flags', 76, 30, 0, 27, 2]);
  }
  const other = { player: someone, groupId: 7, childId: 3 };
  hooks.click(other);
  assert.equal(other.handled, undefined);
});

test('the tab is kept across logins, and the default needs no second mount', () => {
  const { hooks, sent, someone } = panel();
  hooks.custom.get('player:bootstrap-complete')({ player: someone });
  assert.deepEqual(sent, [['varbit', 933, 1], ['varbit', 12164, 1]], 'no clan, and no second mount');
  someone.setAttribute('side-channels:tab', 1);
  hooks.custom.get('gameframe:tab-mounted')({ player: someone, group: 707 });
  assert.deepEqual(sent.at(-1), ['mount', 707, 7, 701]);
});

test('a raid party stands in for the chat-channel tab until it ends', () => {
  const { hooks, sent, someone } = panel();
  let mounted = 0;
  const replace = hooks.custom.get('side-channels:replace-chat-channel');
  someone.setAttribute('side-channels:tab', 1);
  replace({ player: someone, group: 500, onMount: () => mounted++ });
  assert.deepEqual(sent.at(-1), ['mount', 707, 7, 500]);
  assert.equal(mounted, 1);
  hooks.click({ player: someone, groupId: 707, childId: 3 });
  assert.deepEqual(sent.at(-1), ['mount', 707, 7, 701]);
  hooks.click({ player: someone, groupId: 707, childId: 2 });
  assert.deepEqual(sent.at(-1), ['mount', 707, 7, 500], 'the first tab still shows the party');
  assert.equal(mounted, 2);
  replace({ player: someone, group: null });
  assert.deepEqual(sent.at(-1), ['mount', 707, 7, 7]);
});
