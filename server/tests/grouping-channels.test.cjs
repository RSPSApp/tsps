// Run after `yarn build`: node --test tests/grouping-channels.test.cjs
// Grouping's chat-channels through the real friends chat (FriendsList + FriendsChatManager): a
// group's own channel (forming, joining, chat, kick, lead changes, disband, restart), the switch
// when a member is in another channel, and the Grouping tab's activity channels (live rev 242:
// owner "osrs star cc", channel "Stars", kick rank General), which a leader's join brings the group to.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, beforeEach, afterEach } = require("node:test");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "grouping-channels-"));
process.env.TSPS_ACCOUNTS_FILE = path.join(scratch, "accounts.json");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Misc } = require("../dist/util/Misc");
const { World } = require("../dist/game/World");
const { GameConstants } = require("../dist/game/GameConstants");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Task } = require("../dist/game/task/Task");
const { SecondsTimer } = require("../dist/game/model/SecondsTimer");
const { DisplayNames } = require("../dist/game/entity/impl/player/DisplayNames");
const { PlayerRelations } = require("../dist/game/model/PlayerRelations");
const { FriendsChatManager: Manager, FriendsChatRank } = require("../plugins/interface/FriendsChatManager");
const FriendsList = require("../plugins/interface/FriendsList.plugin");
const Grouping = require("../plugins/interface/Grouping.plugin");

const { Channels, Store } = Grouping._test;
const CHAT_MESSAGE = 120;
// As the cache writes them: no-break spaces (0xA0), which a typed name doesn't have.
const NBSP = " ";
const ACTIVITY_CHANNELS = new Map([[1, `osrs${NBSP}ba`], [3, `osrs${NBSP}bounty`], [22, `osrs${NBSP}star${NBSP}cc`]]);
let online;
let nextIndex = 1;
let hooks;
let clock;
const realNow = performance.now;

function player(name) {
  const index = nextIndex++;
  const attributes = new Map();
  const lines = [];
  const sender = new Proxy({}, {
    get: (_, key) => (key === "sendMessage" ? (text) => (lines.push(`game:${text}`), sender) : () => sender),
  });
  const self = {
    name, lines,
    texts: () => lines.join("\n"),
    getIndex: () => index,
    getUsername: () => name,
    getDisplayName: () => name,
    getLongUsername: () => Misc.stringToLongBigInt(name.toLowerCase()),
    getHostAddress: () => "127.0.0.1",
    getRights: () => ({ getId: () => 0 }),
    getProfile: () => "main",
    isPlayerBot: () => false,
    getInterfaceId: () => -1,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => lines.push(`plain:${text}`),
    getPacketSender: () => sender,
    getSession: () => ({
      sendClientPacket: (packet) => {
        if (packet[0] === CHAT_MESSAGE) lines.push(String(packet.toString("latin1")));
        return true;
      },
    }),
  };
  const relations = new PlayerRelations(self);
  self.getRelations = () => relations;
  return self;
}

function runTicks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

function login(self) {
  online.push(self);
  for (const handler of hooks.login) handler({ player: self, username: self.name });
  return self;
}

function logout(self) {
  for (const handler of hooks.logout) handler({ player: self, username: self.name });
  online = online.filter((other) => other !== self);
}

function group(self, ...words) {
  // Past the two-second wait between invitations.
  clock += 3000;
  hooks.commands.get("group")({ player: self, parts: ["group", ...words] });
}

/** What the client sends: the Join Chat / Grouping tab join, a leave, or a line starting with /. */
function social(self, packet) {
  const event = { player: self, packet, handled: false };
  hooks.social(event);
  return event;
}

/** The Grouping tab's Join (client script 437): a leave if in a channel, then the join, a tick later. */
function tabJoin(self, name) {
  if (channelOf(self)) social(self, { type: "friends_chat_action", action: { action: "leave" } });
  social(self, { type: "friends_chat_action", action: { action: "join", name } });
  runTicks(2);
}

const channelOf = (self) => Manager.channelOf(self);

beforeEach(() => {
  Manager.channels.clear();
  Manager.membershipByPlayer.clear();
  Manager.temporaryBans.clear();
  Manager.offlinePlayerIds.clear();
  Manager.pendingJoins.clear();
  Manager.pendingSetups.clear();
  Manager.systemProfiles.clear();
  const dir = fs.mkdtempSync(path.join(scratch, "case-"));
  process.env[Store.FILE_ENV] = path.join(dir, "groups.json");
  process.env[DisplayNames.FILE_ENV] = path.join(dir, "display-names.json");
  DisplayNames.reset();
  Store.reset();
  online = [];
  clock = 1_000_000;
  performance.now = () => clock;
  World.getPlayers = () => ({
    search: (match) => online.find(match) ?? null,
    forEach: (visit) => online.forEach(visit),
  });
  GameConstants.PLAYER_PERSISTENCE = { requestSave() {}, load: () => null, flush: async () => {} };
  const bus = new Map();
  hooks = { login: [], logout: [], commands: new Map(), social: null, startup: null };
  const api = {
    core: {
      World, Misc, DisplayNames, SecondsTimer, Task, TaskManager,
      CacheDefinitions: { getEnumValues: (id) => (id === Channels.ACTIVITY_CHANNEL_ENUM ? ACTIVITY_CHANNELS : new Map()) },
    },
    onCustomEvent: (name, handler) => bus.set(name, [...(bus.get(name) ?? []), handler]),
    emitCustomEvent: (name, payload) => { for (const handler of bus.get(name) ?? []) handler(payload); },
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onPlayerLogout: (handler) => hooks.logout.push(handler),
    onSocialPacket: (handler) => (hooks.social = handler),
    onServerStartup: (handler) => (hooks.startup = handler),
    registerCommand: (name, handler) => hooks.commands.set(name, handler),
    persistAttribute() {},
    registerCustomInterface() {},
    onInterfaceActionClick() {},
    onInterfaceActionButton() {},
    onObjectInteraction() {},
    onCanAttack() {},
  };
  FriendsList.register(api);
  Grouping.register(api);
  hooks.startup({ timestamp: Date.now() });
});

afterEach(() => {
  runTicks(Grouping._test.Lifecycle.LEADER_GRACE_TICKS + 1);
  performance.now = realNow;
  DisplayNames.reset();
});

test("a group has its own channel: forming and joining enter it, chat goes to its members, kick and disband take them out", () => {
  const [alice, bob, cara, dave] = ["Alice", "Bob", "Cara", "Dave"].map((name) => login(player(name)));
  group(alice, "create");
  const key = Channels.groupKey(Store.groupOf("main", alice.getLongUsername()));
  assert.equal(channelOf(alice)?.key, key);
  assert.equal(channelOf(alice).name, Channels.GROUP_CHANNEL_NAME);
  assert.match(alice.texts(), /Now talking in chat-channel Group/);

  group(alice, "invite", "Bob");
  group(bob, "accept");
  assert.equal(channelOf(bob)?.key, key);
  assert.equal(Manager.channelByKey(key).ownerName, "Alice", "the leader shows as the owner");
  // The ranks Chambers of Xeric reads to let a channel's member make a party (Recruit or above).
  assert.deepEqual([channelOf(alice).rankOf(alice), channelOf(bob).rankOf(bob)], [FriendsChatRank.Owner, FriendsChatRank.Recruit]);

  // A line starting with / reaches the group's channel: Bob's words reach Alice, not Dave.
  social(bob, { type: "chat", messageType: "friends_chat", text: "pull at the next wave" });
  assert.match(alice.texts(), /pull at the next wave/);
  assert.doesNotMatch(dave.texts(), /pull at the next wave/);
  assert.equal(Manager.join(dave, key, true), false, "only members get in");

  group(alice, "invite", "Cara");
  group(cara, "accept");
  group(alice, "promote", "Cara");
  assert.equal(Manager.channelByKey(key).ownerName, "Cara", "a new leader shows as the owner");

  group(cara, "kick", "Bob");
  assert.equal(channelOf(bob), null);
  assert.match(bob.texts(), /You have left the channel\./);

  group(cara, "disband");
  assert.equal(channelOf(alice), null);
  assert.equal(channelOf(cara), null);
  assert.match(alice.texts(), /You have been removed from this channel\./);
  assert.equal(Manager.systemProfiles.has(key), false);
});

test("joining a group from another channel leaves you there and says how to switch", () => {
  const owner = login(player("Owner"));
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  Manager.setOwnChannelName(owner, "Hangout");
  Manager.join(owner, "Owner", false);
  Manager.join(bob, "Owner", false);
  group(alice, "invite", "Bob");
  group(bob, "accept");
  assert.equal(channelOf(bob)?.name, "Hangout", "nobody is taken out of a channel they chose");
  assert.match(bob.texts(), new RegExp(Channels.MESSAGE.SWITCH.replace(/[.:]/g, "\\$&")));
  group(bob, "chat");
  assert.equal(channelOf(bob)?.name, Channels.GROUP_CHANNEL_NAME);
  group(bob, "chat");
  assert.match(bob.texts(), /You are already talking in your group's chat-channel\./);
});

test("the Grouping tab's Join puts you in the activity channel; a leader's brings the group from no channel or its own", () => {
  const owner = login(player("Owner"));
  const [alice, bob, cara, dave] = ["Alice", "Bob", "Cara", "Dave"].map((name) => login(player(name)));
  Manager.setOwnChannelName(owner, "Hangout");
  Manager.join(owner, "Owner", false);
  group(alice, "invite", "Bob");
  group(bob, "accept");
  group(alice, "invite", "Cara");
  Manager.join(cara, "Owner", false);
  group(cara, "accept");
  group(alice, "invite", "Dave");
  group(dave, "accept");
  social(dave, { type: "friends_chat_action", action: { action: "leave" } });
  assert.equal(channelOf(dave), null);

  // A member's own join brings nobody.
  const groupChannel = Channels.groupKey(Store.groupOf("main", alice.getLongUsername()));
  tabJoin(bob, "osrs ba");
  assert.equal(channelOf(bob)?.key, "osrs ba");
  assert.equal(channelOf(alice)?.key, groupChannel);
  group(bob, "chat");
  assert.equal(channelOf(bob)?.key, groupChannel);

  // Client script 437 sends the enum 849 name as it is, no-break spaces and all.
  tabJoin(alice, ACTIVITY_CHANNELS.get(22));
  assert.match(alice.texts(), /Attempting to join chat-channel\.\.\./);
  const stars = channelOf(alice);
  assert.deepEqual([stars?.key, stars?.name, stars?.ownerName, stars?.kickRank],
    ["osrs star cc", "Stars", ACTIVITY_CHANNELS.get(22), FriendsChatRank.General], "the owner is the cache's own string, for the tab's Join/Leave");
  assert.match(alice.texts(), /Now talking in chat-channel Stars/);
  assert.equal(stars.rankOf(alice), FriendsChatRank.Unranked);
  assert.equal(channelOf(bob)?.key, "osrs star cc", "from the group's channel");
  assert.match(bob.texts(), new RegExp(Channels.MESSAGE.BROUGHT));
  assert.equal(channelOf(dave)?.key, "osrs star cc", "from no channel");
  assert.equal(channelOf(cara)?.name, "Hangout", "not from a channel Cara chose");
  assert.match(cara.texts(), /Alice has taken the group to the Stars chat-channel\. You can join it from the Grouping tab\./);

  social(alice, { type: "friends_chat_action", action: { action: "leave" } });
  assert.equal(channelOf(alice), null);
  assert.match(alice.texts(), /You have left the channel\./);
  assert.equal(channelOf(bob)?.key, "osrs star cc", "leaving takes nobody else out");

  // The others show the Wiki's chat-channel name; one the Wiki gives no channel doesn't exist.
  tabJoin(alice, ACTIVITY_CHANNELS.get(1));
  assert.equal(channelOf(alice)?.name, "Osrs Ba");
  tabJoin(alice, ACTIVITY_CHANNELS.get(3));
  assert.equal(channelOf(alice), null);
  assert.match(alice.texts(), /The channel you tried to join does not exist\./);
});

test("a leader back in an activity channel at login brings nobody; only a join they make does", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  group(alice, "invite", "Bob");
  group(bob, "accept");
  const groupChannel = Channels.groupKey(Store.groupOf("main", alice.getLongUsername()));
  tabJoin(alice, ACTIVITY_CHANNELS.get(22));
  assert.equal(channelOf(bob)?.key, "osrs star cc");
  group(bob, "chat");
  assert.equal(channelOf(bob)?.key, groupChannel);

  // Alice relogs: the login rejoin puts her back in Stars, and Bob stays where he chose to be.
  const relations = alice.getRelations();
  logout(alice);
  const back = player("Alice");
  back.getRelations = () => relations;
  const heard = bob.lines.length;
  login(back);
  assert.equal(channelOf(back)?.key, "osrs star cc", "the leader is back in Stars");
  assert.equal(channelOf(bob)?.key, groupChannel, "Bob stays in the group's channel");
  assert.doesNotMatch(bob.lines.slice(heard).join("\n"), new RegExp(Channels.MESSAGE.BROUGHT));
});

test("a group's channel outlives a restart: registered at startup, rejoined at login", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  group(alice, "invite", "Bob");
  group(bob, "accept");
  const key = channelOf(bob)?.key;
  assert.ok(key?.startsWith(Channels.KEY_PREFIX));
  const relations = bob.getRelations();
  logout(bob);
  logout(alice);

  // A restart: the store reads its file again and the chat-channels start empty.
  Store.reset();
  Manager.channels.clear();
  Manager.membershipByPlayer.clear();
  Manager.offlinePlayerIds.clear();
  Manager.systemProfiles.clear();
  hooks.startup({ timestamp: Date.now() });
  const back = player("Bob");
  back.getRelations = () => relations;
  login(back);
  assert.equal(relations.getFriendsChatLastOwner(), key);
  assert.equal(channelOf(back)?.key, key);
  assert.match(back.texts(), /Now talking in chat-channel Group/);
});

test("a Group Ironman group runs no chat-channel: it talks in its own group chat", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  group(alice, "create");
  group(alice, "invite", "Bob");
  group(bob, "accept");
  const made = Store.groupOf("main", alice.getLongUsername());
  const key = Channels.groupKey(made);
  made.ironman = true;
  social(bob, { type: "friends_chat_action", action: { action: "leave" } });
  group(bob, "chat");
  assert.ok(bob.texts().includes(Channels.MESSAGE.IRONMAN), "told where the group talks");
  assert.equal(channelOf(bob), null, "::group chat puts nobody in a channel");

  Manager.systemProfiles.clear();
  hooks.startup({ timestamp: Date.now() });
  assert.equal(Manager.systemProfiles.has(key), false, "none registered at startup");
  group(alice, "promote", "Bob");
  assert.equal(Manager.systemProfiles.has(key), false, "nor on a change");
});
