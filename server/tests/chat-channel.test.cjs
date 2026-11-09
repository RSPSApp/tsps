// Run after `yarn build`: node --test tests/chat-channel.test.cjs
// The chat-channel against live captures: 763 kick and ban, 754 and 753 setup and disable, 749
// enabling, 189 refused joins, 3266 joining twice, 2528 and 75 the side panel's tabs.
const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
// Accounts writes its file to this path; keep it off the real data/saves, before `dist` is required.
process.env.TSPS_ACCOUNTS_FILE = require('node:path').join(require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'accounts-')), 'accounts.json');
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
    getDisplayName: () => name,
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

test('refusing to ignore a friend leaves them in the owner’s channel', () => {
  const owner = player('Owner');
  const member = player('Member');
  Manager.setOwnChannelName(owner, 'Blur');
  Manager.handleAction(owner, { action: 'add_friend', name: 'Member' });
  Manager.join(owner, 'Owner', false);
  Manager.join(member, 'Owner', false);
  assert.equal(Manager.channelOf(member)?.name, 'Blur');

  Manager.handleAction(owner, { action: 'add_ignore', name: 'Member' });
  assert.match(owner.texts(), /remove Member from your friend list first/);
  assert.equal(owner.getRelations().hasIgnore(member.getLongUsername()), false);
  assert.equal(Manager.channelOf(member)?.name, 'Blur');

  Manager.handleAction(owner, { action: 'remove_friend', name: 'Member' });
  Manager.handleAction(owner, { action: 'add_ignore', name: 'Member' });
  assert.equal(owner.getRelations().hasIgnore(member.getLongUsername()), true);
  assert.equal(Manager.channelOf(member), null);
  assert.equal(Manager.join(member, 'Owner', true), false);
  Manager.handleAction(owner, { action: 'remove_ignore', name: 'Member' });
  assert.equal(owner.getRelations().hasIgnore(member.getLongUsername()), false);
  assert.equal(Manager.join(member, 'Owner', true), true);
});

test('a full ignore list does not remove the requested member from the channel', () => {
  const owner = player('Owner');
  const member = player('Member');
  Manager.setOwnChannelName(owner, 'Blur');
  Manager.join(owner, 'Owner', false);
  Manager.join(member, 'Owner', false);
  for (let i = 0; i < 100; i++) owner.getRelations().addIgnore(Misc.stringToLongBigInt(`user${i}`));
  assert.equal(owner.getRelations().getIgnoreList().length, 100);

  Manager.handleAction(owner, { action: 'add_ignore', name: 'Member' });
  assert.match(owner.texts(), /ignore list is full/i);
  assert.equal(owner.getRelations().hasIgnore(member.getLongUsername()), false);
  assert.equal(Manager.channelOf(member)?.name, 'Blur');
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
  assert.deepEqual(sent, [], 'no second mount');
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

// Display names (DisplayNames, ::displayname): lists, PMs and channels show them and take them typed.
const { DisplayNames } = require('../dist/game/entity/impl/player/DisplayNames');
const FRIENDS_CHAT_UPDATE = 121;

/** The latest friends/ignores/channel snapshot a player was sent, as text. */
function lastSnapshot(who, sent) {
  return sent.filter(([to, packet]) => to === who && packet[0] === FRIENDS_CHAT_UPDATE).map(([, packet]) => packet.toString('latin1')).pop() ?? '';
}

function withDisplayNames(run) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-display-names-'));
  process.env[DisplayNames.FILE_ENV] = path.join(dir, 'display-names.json');
  DisplayNames.reset();
  try {
    run();
  } finally {
    delete process.env[DisplayNames.FILE_ENV];
    DisplayNames.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A player whose display name follows DisplayNames, and whose packets are kept in `sent`. */
function named(name, sent) {
  const self = player(name);
  self.getDisplayName = () => DisplayNames.nameOf(name);
  const session = self.getSession();
  self.getSession = () => ({ sendClientPacket: (packet) => { sent.push([self, packet]); return session.sendClientPacket(packet); } });
  return self;
}

// Decode the friend row sent by the real snapshot encoder; no client is running here.
function friendRow(who, sent) {
  const packet = sent.filter(([to, p]) => to === who && p[0] === FRIENDS_CHAT_UPDATE).at(-1)?.[1];
  assert.ok(packet);
  let offset = 3; // variable-short frame
  assert.equal(packet[offset++], 0, 'no channel in this fixture');
  assert.equal(packet.readUInt16BE(offset), 1); offset += 2;
  function readString() { const end = packet.indexOf(0, offset); const value = packet.toString('latin1', offset, end); offset = end + 1; return value; }
  const name = readString(); const previousName = readString();
  const world = packet.readUInt16BE(offset); offset += 2;
  const rank = packet.readInt8(offset++); const isOnline = packet[offset++] !== 0;
  return { name, previousName, world, rank, isOnline };
}

test('ignored players see an online friend but cannot deliver private messages', () => withDisplayNames(() => {
  const sent = [];
  const alice = named('Alice', sent);
  const bob = named('Bob', sent);
  Manager.handleAction(alice, { action: 'add_friend', name: 'Bob' });
  assert.equal(friendRow(alice, sent).world, 1, 'On mode shows Bob before ignore');
  assert.ok(Manager.handlePrivateMessage(alice, 'Bob', 'before'));
  Manager.handleAction(bob, { action: 'add_ignore', name: 'Alice' });
  assert.equal(friendRow(alice, sent).world, 1, 'ignoring does not hide Bob in On mode');
  assert.equal(friendRow(alice, sent).isOnline, true);
  const received = bob.lines.length;
  assert.equal(Manager.handlePrivateMessage(alice, 'Bob', 'blocked'), undefined);
  assert.equal(bob.lines.length, received, 'ignored message was not delivered');
  Manager.setChatFilters(bob, 0, 1, 0);
  assert.equal(friendRow(alice, sent).world, 0, 'Friends hides Bob from a non-friend');
  Manager.setChatFilters(bob, 0, 2, 0);
  assert.equal(friendRow(alice, sent).world, 0, 'Off hides Bob');
  Manager.setChatFilters(bob, 0, 0, 0);
  Manager.handleAction(bob, { action: 'remove_ignore', name: 'Alice' });
  assert.equal(friendRow(alice, sent).world, 1);
  assert.ok(Manager.handlePrivateMessage(alice, 'Bob', 'after'));
  Manager.setChatFilters(bob, 0, 1, 0);
  assert.equal(friendRow(alice, sent).world, 0, 'Friends hides a non-friend after unignore');
  Manager.handleAction(bob, { action: 'add_friend', name: 'Alice' });
  assert.equal(friendRow(alice, sent).world, 1, 'Friends reveals Bob to a reciprocal friend');
  assert.ok(Manager.handlePrivateMessage(alice, 'Bob', 'friends'));
  DisplayNames.set('Bob', 'Zed', Date.now(), 35 * 86400000);
  Manager.onDisplayNameChanged(bob);
  assert.equal(friendRow(alice, sent).name, 'Zed');
  assert.ok(Manager.handlePrivateMessage(alice, 'Zed', 'renamed'));
}));

test('ignoring does not broadcast either online player offline to other friends', () => {
  const alice = player('Alice');
  const bob = player('Bob');
  const charlie = player('Charlie');
  const updates = [];
  for (const p of [alice, bob, charlie]) {
    p.getPacketSender = () => new Proxy({}, { get: (_, key, sender) => key === 'sendFriend' ? (name, world) => { updates.push([p.getUsername(), name, world]); return sender; } : () => sender });
  }
  const originalLookup = World.getPlayerByName;
  World.getPlayerByName = (name) => online.find(p => p.getUsername().toLowerCase() === name.toLowerCase());
  try {
    Manager.handleAction(alice, { action: 'add_friend', name: 'Bob' });
    Manager.handleAction(charlie, { action: 'add_friend', name: 'Alice' });
    updates.length = 0;
    Manager.handleAction(bob, { action: 'add_ignore', name: 'Alice' });
    const aliceViewsBob = updates.filter(([viewer, name]) => viewer === 'Alice' && name === bob.getLongUsername());
    const charlieViewsAlice = updates.filter(([viewer, name]) => viewer === 'Charlie' && name === alice.getLongUsername());
    assert.ok(aliceViewsBob.length > 0 && aliceViewsBob.every(([, , world]) => world === 1));
    assert.ok(charlieViewsAlice.length > 0 && charlieViewsAlice.every(([, , world]) => world === 1));
    Manager.setChatFilters(bob, 0, 2, 0);
    updates.length = 0;
    bob.getRelations().updateLists(true);
    assert.deepEqual(updates.filter(([viewer, name]) => viewer === 'Alice' && name === bob.getLongUsername()).at(-1), ['Alice', bob.getLongUsername(), 0]);
    bob.getRelations().setChatModes(0, 1, 0);
    updates.length = 0;
    bob.getRelations().updateLists(true);
    assert.deepEqual(updates.filter(([viewer, name]) => viewer === 'Alice' && name === bob.getLongUsername()).at(-1), ['Alice', bob.getLongUsername(), 0], 'Friends hides Bob from non-friend Alice');
    alice.getRelations().setChatModes(0, 1, 0);
    updates.length = 0;
    Manager.handleAction(bob, { action: 'remove_ignore', name: 'Alice' });
    Manager.handleAction(bob, { action: 'add_ignore', name: 'Alice' });
    const hiddenAlice = updates.filter(([viewer, name]) => viewer === 'Charlie' && name === alice.getLongUsername());
    assert.ok(hiddenAlice.length > 0 && hiddenAlice.every(([, , world]) => world === 0), 'third-party updates respect Alice’s Friends mode');
  } finally {
    World.getPlayerByName = originalLookup;
  }
});

test('friends and ignores show display names and the name given up, and refresh on a change', () => withDisplayNames(() => {
  const sent = [];
  const alice = named('Alice', sent);
  const bob = named('Bob', sent);
  Manager.handleAction(alice, { action: 'add_friend', name: 'Bob' });
  assert.match(lastSnapshot(alice, sent), /Bob/);
  DisplayNames.set('Bob', 'Zed', Date.now(), 35 * 86400000);
  Manager.onDisplayNameChanged(bob);
  const snapshot = lastSnapshot(alice, sent);
  assert.match(snapshot, /Zed/, 'the new name');
  assert.match(snapshot, /Bob/, 'the previous name, still held');
  // Offline friends and ignores read the registry too.
  online.splice(online.indexOf(bob), 1);
  Manager.handleAction(alice, { action: 'remove_friend', name: 'Zed' });
  Manager.handleAction(alice, { action: 'add_ignore', name: 'Zed' });
  assert.ok(alice.getRelations().hasIgnore(bob.getLongUsername()));
  assert.match(lastSnapshot(alice, sent), /Zed/);
}));

test('a renamed player is found by their display name or held names, not a login name no longer held', () => withDisplayNames(() => {
  const sent = [];
  const alice = named('Alice', sent);
  const bob = named('Bob', sent);
  const carol = named('Carol', sent);
  const day = 86400000;
  DisplayNames.set('Carol', 'Recent', Date.now(), 35 * day);
  Manager.handleAction(alice, { action: 'add_friend', name: 'carol' });
  assert.ok(alice.getRelations().hasFriend(carol.getLongUsername()), 'a login name is a held name for 35 days');
  DisplayNames.set('Bob', 'Zed', Date.now() - 80 * day, 35 * day);
  DisplayNames.set('Bob', 'Zed Two', Date.now() - 40 * day, 35 * day);
  Manager.handleAction(alice, { action: 'add_friend', name: 'bob' });
  assert.match(alice.texts(), /Unable to find a player with that name\./);
  assert.equal(alice.getRelations().getFriendList().length, 1);
  Manager.handleAction(alice, { action: 'add_friend', name: 'zed_two' });
  assert.ok(alice.getRelations().hasFriend(bob.getLongUsername()));
  Manager.handlePrivateMessage(alice, 'bob', 'hello');
  assert.match(alice.texts(), /Please add that player to your friends list first\./);
  Manager.handlePrivateMessage(alice, 'Zed Two', 'hi zed');
  assert.match(bob.texts(), /Alice/);
  assert.match(alice.texts(), /Zed Two/, 'the sender sees the name the recipient shows');
}));

test('a channel shows its owner and members by display name, and is joined and kicked by it', () => withDisplayNames(() => {
  const sent = [];
  const owner = named('Owner', sent);
  const member = named('Member', sent);
  DisplayNames.set('Owner', 'Big Boss', Date.now(), 35 * 86400000);
  DisplayNames.set('Member', 'Minion', Date.now(), 35 * 86400000);
  Manager.setOwnChannelName(owner, 'Blur');
  assert.match(owner.texts(), /typing: Big Boss/);
  Manager.handleAction(owner, { action: 'join', name: 'Big Boss' });
  Manager.handleAction(member, { action: 'join', name: 'big_boss' });
  runTicks(2);
  assert.equal(Manager.channelOf(member)?.name, 'Blur');
  const snapshot = lastSnapshot(member, sent);
  assert.match(snapshot, /Big Boss/);
  assert.match(snapshot, /Minion/);
  assert.doesNotMatch(snapshot, /Member/);
  Manager.handleChat(member, 'hi all');
  assert.match(owner.texts(), /Minion/);
  // The rejoin at login goes by the login name the channel saved, whatever the owner shows.
  assert.equal(member.getRelations().getFriendsChatLastOwner(), 'Owner');
  Manager.kick(owner, 'Minion');
  assert.match(member.texts(), /You have been kicked from the channel\./);
}));

test('players who only ignore the renamed player are told of every rename, each with the name just left', () => withDisplayNames(() => {
  const sent = [];
  const day = 86400000;
  const ignorer = named('Ignorer', sent);
  const watcher = named('Watcher', sent);
  const stranger = named('Stranger', sent);
  const bob = named('Bob', sent);
  Manager.handleAction(ignorer, { action: 'add_ignore', name: 'Bob' });
  Manager.handleAction(watcher, { action: 'add_friend', name: 'Bob' });
  const snapshots = (who) => sent.filter(([to, packet]) => to === who && packet[0] === FRIENDS_CHAT_UPDATE).length;
  const before = { ignorer: snapshots(ignorer), watcher: snapshots(watcher), stranger: snapshots(stranger) };
  // A cooldown of 0 days lets the renames follow each other.
  DisplayNames.set('Bob', 'Zed', Date.now(), 35 * day);
  Manager.onDisplayNameChanged(bob);
  assert.equal(snapshots(ignorer), before.ignorer + 1);
  assert.match(lastSnapshot(ignorer, sent), /Zed\0Bob\0/);
  DisplayNames.set('Bob', 'Yew', Date.now(), 35 * day);
  Manager.onDisplayNameChanged(bob);
  assert.equal(snapshots(ignorer), before.ignorer + 2);
  assert.match(lastSnapshot(ignorer, sent), /Yew\0Zed\0/);
  // Friends hear of each rename once; players with no relation to Bob hear nothing.
  assert.equal(snapshots(watcher), before.watcher + 2);
  assert.match(lastSnapshot(watcher, sent), /Yew\0Zed\0/);
  assert.equal(snapshots(stranger), before.stranger);
}));

// Cache241 friends_panel drives toplevel_redraw907; use the real sender so
// the shared chat_filter_assist bits, rather than just the packet shape, are checked.
test('social list toggles synchronize the cache icon state without changing other chat bits', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { PacketSender } = require('../dist/net/packet/PacketSender');
  await CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  const p = player('Panel');
  p.getFrameUpdater = () => ({ clearGroup() {} });
  const sender = new PacketSender(p);
  p.getPacketSender = () => sender;
  const unrelated = 0x80020100 | 0;
  const definition = CacheDefinitions.getVarbit(6516);
  assert.equal(definition.baseVar, 1055);
  assert.equal(definition.startBit, 30);
  assert.equal(definition.endBit, 30);
  sender.sendConfig(1055, unrelated);
  const mounts = [];
  const mount = sender.sendSubInterface.bind(sender);
  sender.sendSubInterface = (...args) => { mounts.push(args); return mount(...args); };
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal(Manager.handleWidgetAction(p, 429, 1, '', 1), true);
    assert.equal(sender.getVarbit(6516), 1);
    assert.equal(sender.getVarp(1055), unrelated | (1 << 30));
    assert.deepEqual(mounts.at(-1), [(161 << 16) | 85, 432, 1]);
    assert.equal(Manager.handleWidgetAction(p, 432, 1, '', 1), true);
    assert.equal(sender.getVarbit(6516), 0);
    assert.equal(sender.getVarp(1055), unrelated);
    assert.deepEqual(mounts.at(-1), [(161 << 16) | 85, 429, 1]);
  }
  const before = mounts.length;
  assert.equal(Manager.handleWidgetAction(p, 429, 2, '', 1), false);
  assert.equal(Manager.handleWidgetAction(p, 432, 1, 'Not a list toggle', 1), false);
  assert.equal(sender.getVarp(1055), unrelated);
  assert.equal(mounts.length, before);
  sender.sendVarbit(6516, 1);
  Manager.onLogin(p);
  assert.equal(sender.getVarbit(6516), 0, 'bootstrap always mounts Friends429 on login');
  assert.equal(sender.getVarp(1055), unrelated);
  assert.equal(mounts.length, before, 'login does not add a competing panel mount');
});
