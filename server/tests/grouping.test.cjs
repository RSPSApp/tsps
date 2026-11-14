// Run after `yarn build`: node --test tests/grouping.test.cjs
// Grouping.plugin.js: forming a group, invitations (repeated, crossed, lapsed), leader-only
// actions, ignore lists and private chat, what survives a relog or a restart, logouts, the cap
// at the last accept, the invitation rate limit, group storage's door and the ::group panel.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, beforeEach, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Misc } = require("../dist/util/Misc");
const { SecondsTimer } = require("../dist/game/model/SecondsTimer");
const { Task } = require("../dist/game/task/Task");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { DisplayNames } = require("../dist/game/entity/impl/player/DisplayNames");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Grouping = require("../plugins/interface/Grouping.plugin");

const { Actions, Activities, Layout, Lifecycle, Members, Panel, Rows, Store } = Grouping._test;
const { MESSAGE } = Actions;
const GROUP = Actions.GROUP_ATTRIBUTE;
const ROLE = Actions.ROLE_ATTRIBUTE;

let dir;
let hooks;
let online;
let clock;
const realNow = performance.now;

const World = {
  getPlayers: () => ({
    search: (filter) => online.find(filter) ?? null,
    forEach: (action) => online.forEach(action),
  }),
};

function player(name, { profile = "main", x = 3200, y = 3200, z = 0, privacy = "on", bot = false, combat = 50 } = {}) {
  const self = {
    name, privacy, attributes: new Map(), messages: [], strings: new Map(), hidden: new Map(),
    friends: new Set(), ignores: new Set(), interfaceId: -1, location: { x, y, z },
    getUsername: () => name,
    getProfile: () => profile,
    isPlayerBot: () => bot,
    getLongUsername: () => Misc.stringToLongBigInt(name),
    getAttribute: (key) => self.attributes.get(key),
    setAttribute: (key, value) => self.attributes.set(key, value),
    getInterfaceId: () => self.interfaceId,
    setInterfaceId: (id) => (self.interfaceId = id),
    getSkillManager: () => ({ getCombatLevel: () => combat }),
    getLocation: () => ({
      getX: () => self.location.x, getY: () => self.location.y, getZ: () => self.location.z,
      getDistance: (other) => Math.max(Math.abs(other.getX() - self.location.x), Math.abs(other.getY() - self.location.y)),
    }),
    // PlayerRelations' rules: private chat on shows you to everyone, friends only to friends, off to nobody.
    getRelations: () => ({
      hasIgnore: (encoded) => self.ignores.has(encoded),
      isVisibleTo: (other) => self.privacy === "on" || (self.privacy === "friends" && self.friends.has(other.getLongUsername())),
    }),
    getPacketSender: () => ({
      sendMessage(text) {
        self.messages.push(text);
        return this;
      },
      sendString(text, uid) {
        self.strings.set(uid, text);
        return this;
      },
      sendInterfaceDisplayState(uid, hidden) {
        self.hidden.set(uid, hidden);
        return this;
      },
      sendSubInterface(target, group) {
        self.opened = group;
        return this;
      },
    }),
  };
  return self;
}

const encoded = (name) => Misc.stringToLongBigInt(name);
const said = (self) => self.messages.at(-1);
const groupOf = (self) => Store.groupOf(Members.profileOf(self), encoded(self.name));
const changes = (type) => hooks.emitted.filter(([name, event]) => name === Actions.CHANGED_EVENT && (!type || event.type === type));

function login(self) {
  if (!online.includes(self)) online.push(self);
  hooks.login({ player: self, username: self.name });
  return self;
}

function logout(self) {
  hooks.logout({ player: self, username: self.name });
  online = online.filter((other) => other !== self);
}

function group(self, ...words) {
  hooks.commands.get("group")({ player: self, parts: ["group", ...words.join(" ").split(" ").filter(Boolean)] });
  return said(self);
}

function emit(name, payload) {
  for (const handler of hooks.custom.get(name) ?? []) handler(payload);
  return payload;
}

/** Lets the invitation rate limit (2 s) pass. */
function wait(seconds = 3) {
  clock += seconds * 1000;
}

function runTicks(ticks) {
  for (let tick = 0; tick < ticks; tick++) TaskManager.process();
}

const GRACE = Lifecycle.LEADER_GRACE_TICKS;

function formed(leader, ...members) {
  for (const member of members) {
    wait();
    group(leader, "invite", member.name);
    group(member, "accept", leader.name);
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "grouping-"));
  process.env[Store.FILE_ENV] = path.join(dir, "groups.json");
  process.env[DisplayNames.FILE_ENV] = path.join(dir, "display-names.json");
  DisplayNames.reset();
  Store.reset();
  Activities.reset();
  online = [];
  clock = 1_000_000;
  performance.now = () => clock;
  hooks = { commands: new Map(), custom: new Map(), buttons: new Map(), objects: new Map(), interfaces: [], persisted: new Map(), emitted: [] };
  Grouping.register({
    core: { World, Misc, DisplayNames, SecondsTimer, Task, TaskManager },
    persistAttribute: (key, value) => hooks.persisted.set(key, value),
    registerCustomInterface: (definition) => hooks.interfaces.push(definition),
    registerCommand: (name, handler) => hooks.commands.set(name, handler),
    onServerStartup: (handler) => (hooks.startup = handler),
    onPlayerLogin: (handler) => (hooks.login = handler),
    onPlayerLogout: (handler) => (hooks.logout = handler),
    onObjectInteraction: (name, actions) => hooks.objects.set(name, actions),
    onCustomEvent: (name, handler) => hooks.custom.set(name, [...(hooks.custom.get(name) ?? []), handler]),
    emitCustomEvent: (name, payload) => {
      hooks.emitted.push([name, payload]);
      emit(name, payload);
    },
    onInterfaceActionButton: (ids, handler) => [].concat(ids).forEach((id) => hooks.buttons.set(id, handler)),
  });
});

afterEach(() => {
  // A hand-over still waiting must not reach the next test's store.
  runTicks(GRACE + 1);
  performance.now = realNow;
  DisplayNames.reset();
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- Transitions ---------------------------------------------------------------------------

test("a leader forms a group, invites a nearby player, and both see the same member list", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob", { x: 3202 }));
  assert.equal(group(alice, "create"), MESSAGE.CREATED);
  assert.equal(group(alice, "invite", "Bob"), "You invite Bob to join your group.");
  assert.equal(said(bob), "Alice has invited you to join their group. Type ::group to answer.");
  assert.equal(group(bob, "accept"), "You have joined Alice's group.");
  assert.equal(said(alice), "Bob has joined the group.");

  const views = [alice, bob].map((self) => emit("grouping:get", { player: self }));
  assert.deepEqual(views[0].group, views[1].group);
  assert.deepEqual(views[0].group.members.map(({ name, role, online }) => [name, role, online]),
    [["Alice", "leader", true], ["Bob", "member", true]]);
  assert.deepEqual([views[0].role, views[1].role], ["leader", "member"]);
  assert.deepEqual([alice.attributes.get(GROUP), alice.attributes.get(ROLE)], [views[0].group.id, "leader"]);
  assert.deepEqual([bob.attributes.get(GROUP), bob.attributes.get(ROLE)], [views[0].group.id, "member"]);
  assert.deepEqual(changes().map(([, event]) => event.type), ["created", "invited", "joined"]);
  assert.deepEqual(changes("joined")[0][1].players.sort((a, b) => a.name.localeCompare(b.name)), [alice, bob]);
});

test("inviting from no group forms one; repeated invitations stay one invitation", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  group(alice, "invite", "Bob");
  wait();
  assert.equal(group(alice, "invite", "bob"), "You have already invited Bob.");
  assert.equal(groupOf(alice).invites.size, 1);
  wait();
  const later = Date.now() + 60_000;
  Actions.invite(alice, encoded("Bob"), later);
  assert.equal(groupOf(alice).invites.get(encoded("Bob")), later + Actions.INVITE_EXPIRY_MS, "a repeat renews the invitation");
  assert.equal(changes("invited").length, 1);
  assert.equal([...Store.all()].length, 1);
  group(bob, "accept");
  assert.equal(groupOf(bob), groupOf(alice));
});

test("crossed invitations resolve to one membership", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  group(alice, "invite", "Bob");
  group(bob, "invite", "Alice");
  assert.equal(said(bob), "You have joined Alice's group.");
  assert.equal([...Store.all()].length, 1);
  assert.deepEqual([...groupOf(alice).members], [encoded("Alice"), encoded("Bob")]);
  assert.equal(groupOf(alice).invites.size, 0);

  // Both alone in groups of their own: the later inviter takes the earlier invitation.
  const cara = login(player("Cara"));
  const dan = login(player("Dan"));
  group(cara, "create");
  group(dan, "create");
  group(cara, "invite", "Dan");
  group(dan, "invite", "Cara");
  assert.equal(groupOf(dan), groupOf(cara));
  assert.equal(groupOf(cara).leader, encoded("Cara"));
  assert.equal([...Store.all()].length, 2);
});

test("accepting one invitation turns down the others; decline and withdraw end one", () => {
  const [alice, bob, cara] = ["Alice", "Bob", "Cara"].map((name) => login(player(name)));
  group(alice, "invite", "Cara");
  group(bob, "invite", "Cara");
  assert.equal(Store.invitationsFor("main", encoded("Cara"), Date.now()).length, 2);
  group(cara, "accept", "Bob");
  assert.equal(groupOf(cara), groupOf(bob));
  assert.equal(groupOf(alice).invites.size, 0);
  assert.equal(changes("invite-withdrawn").at(-1)[1].groupId, groupOf(alice).id);

  const dan = login(player("Dan"));
  wait();
  group(alice, "invite", "Dan");
  assert.equal(group(dan, "decline"), "You decline Alice's invitation.");
  assert.equal(said(alice), "Dan has declined your invitation.");
  assert.equal(group(dan, "accept"), MESSAGE.NO_INVITATION);
  wait();
  group(alice, "invite", "Dan");
  assert.equal(group(alice, "withdraw", "Dan"), "You withdraw your invitation to Dan.");
  assert.equal(group(dan, "accept", "Alice"), MESSAGE.NO_INVITATION);
});

test("promote, kick, leave and disband", () => {
  const [alice, bob, cara] = ["Alice", "Bob", "Cara"].map((name) => login(player(name)));
  formed(alice, bob, cara);
  const id = groupOf(alice).id;

  assert.equal(group(alice, "promote", "Bob"), "Bob is now the group leader.");
  assert.equal(said(cara), "Bob is now the group leader.");
  assert.deepEqual([alice.attributes.get(ROLE), bob.attributes.get(ROLE)], ["member", "leader"]);

  assert.equal(group(bob, "kick", "Alice"), "Alice has been removed from the group.");
  assert.equal(alice.messages.at(-1), MESSAGE.KICKED);
  assert.deepEqual([alice.attributes.get(GROUP), alice.attributes.get(ROLE)], [0, ""]);

  // The leader leaving hands the lead to the longest-serving member.
  const dan = login(player("Dan"));
  formed(bob, dan);
  assert.equal(group(bob, "leave"), "Cara is now the group leader.");
  assert.equal(bob.messages.at(-2), MESSAGE.LEFT);
  assert.equal(groupOf(cara).leader, encoded("Cara"));
  assert.equal(said(dan), "Bob has left the group.");

  assert.equal(group(cara, "disband"), MESSAGE.DISBANDED);
  assert.equal(said(dan), MESSAGE.DISBANDED);
  assert.equal(Store.byId(id), undefined);
  assert.equal(groupOf(dan), undefined);
  assert.equal(dan.attributes.get(GROUP), 0);
  assert.equal(changes("disbanded").at(-1)[1].group.id, id);

  // Leaving a group of one ends it.
  group(dan, "create");
  group(dan, "leave");
  assert.equal(groupOf(dan), undefined);
  assert.equal([...Store.all()].length, 0);
});

// --- Privacy and moderation --------------------------------------------------------------------

test("only the leader invites, kicks, promotes, withdraws or disbands", () => {
  const [alice, bob, cara, dan] = ["Alice", "Bob", "Cara", "Dan"].map((name) => login(player(name)));
  formed(alice, bob, cara);
  const before = JSON.stringify(Members.snapshot(groupOf(alice)));
  for (const words of [["kick", "Cara"], ["kick", "Alice"], ["promote", "Cara"], ["promote", "Bob"],
    ["invite", "Dan"], ["withdraw", "Dan"], ["disband"]]) {
    wait();
    assert.equal(group(bob, ...words), MESSAGE.LEADER_ONLY, words.join(" "));
  }
  assert.equal(JSON.stringify(Members.snapshot(groupOf(alice))), before);
  assert.equal(dan.messages.length, 0);
  assert.equal(group(dan, "kick", "Bob"), MESSAGE.NOT_IN_GROUP);
  assert.equal(group(alice, "kick", "Dan"), MESSAGE.NOT_A_MEMBER);
  assert.equal(group(alice, "kick", "Alice"), MESSAGE.KICK_SELF);
  assert.equal(group(alice, "promote", "Alice"), MESSAGE.PROMOTE_SELF);
});

test("ignored players can't be invited, and a refusal never says which rule hid a player", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  alice.ignores.add(encoded("Bob"));
  assert.equal(group(alice, "invite", "Bob"), MESSAGE.INVITE_IGNORED);
  alice.ignores.clear();

  bob.ignores.add(encoded("Alice"));
  wait();
  assert.equal(group(alice, "invite", "Bob"), MESSAGE.CANNOT_INVITE);
  bob.ignores.clear();

  // Private chat off, friends-only without the friend, offline, a stranger, a bot, another profile: all the same words.
  const hidden = login(player("Hidden", { privacy: "off" }));
  const picky = login(player("Picky", { privacy: "friends" }));
  login(player("Botty", { bot: true }));
  login(player("Leaguer", { profile: "league" }));
  for (const name of ["Hidden", "Picky", "Nobody", "Botty", "Leaguer"]) {
    wait();
    assert.equal(group(alice, "invite", name), MESSAGE.CANNOT_INVITE, name);
  }
  assert.equal(hidden.messages.length + picky.messages.length, 0);
  picky.friends.add(encoded("Alice"));
  wait();
  assert.equal(group(alice, "invite", "Picky"), "You invite Picky to join your group.");
  assert.equal(group(alice, "invite", "Alice"), MESSAGE.INVITE_SELF);
});

test("an ignore added after the invitation voids it at accept", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  group(alice, "invite", "Bob");
  alice.ignores.add(encoded("Bob"));
  assert.equal(group(bob, "accept"), MESSAGE.INVITATION_VOID);
  assert.equal(groupOf(bob), undefined);
  assert.equal(groupOf(alice).invites.size, 0);
});

test("the Find tab lists only players the viewer may invite and know of", () => {
  const alice = login(player("Alice"));
  login(player("Near", { x: 3201 }));
  login(player("Far", { x: 3300 }));
  login(player("Hidden", { privacy: "off" }));
  login(player("Picky", { privacy: "friends" }));
  const friendly = login(player("Friendly", { privacy: "friends", x: 3205 }));
  friendly.friends.add(encoded("Alice"));
  login(player("Ignorer")).ignores.add(encoded("Alice"));
  login(player("Ignored"));
  alice.ignores.add(encoded("Ignored"));
  login(player("Botty", { bot: true }));
  login(player("Leaguer", { profile: "league" }));
  const busy = login(player("Busy"));
  const pal = login(player("Pal"));
  formed(busy, pal);
  // Not logged in through the login hook (a stale entry in the world list): not listed either.
  online.push(player("Ghost"));

  const names = Rows.candidates(alice, Members.identify(alice)).map(({ player: other }) => other.name);
  assert.deepEqual(names, ["Near", "Friendly", "Far"]);

  // A member who doesn't lead has no one to invite.
  formed(alice, login(player("Mate")));
  wait();
  group(alice, "promote", "Mate");
  assert.deepEqual(Rows.candidates(alice, Members.identify(alice)), []);
});

test("group storage lets in only a member, as the store has it at the click", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  const open = hooks.objects.get("Group storage").Open;
  const opened = [];
  hooks.custom.set(Lifecycle.STORAGE_EVENT, [(request) => {
    opened.push(request.player.name);
    request.handled = true;
  }]);

  group(alice, "invite", "Bob");
  open({ player: bob });
  assert.equal(said(bob), Lifecycle.STORAGE_NOT_MEMBER, "an invitation isn't membership");
  bob.attributes.set(GROUP, groupOf(alice).id);
  open({ player: bob });
  assert.equal(said(bob), Lifecycle.STORAGE_NOT_MEMBER, "nor is a saved attribute the store doesn't back");
  open({ player: alice });
  assert.deepEqual(opened, ["Alice"]);

  hooks.custom.delete(Lifecycle.STORAGE_EVENT);
  open({ player: alice });
  assert.equal(said(alice), Lifecycle.STORAGE_UNAVAILABLE);
});

// --- Persistence ------------------------------------------------------------------------------

test("membership and role survive a relog and a server restart", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  formed(alice, bob);
  const id = groupOf(alice).id;
  assert.deepEqual([...hooks.persisted], [[GROUP, 0], [ROLE, ""]]);

  logout(bob);
  assert.deepEqual([bob.attributes.get(GROUP), bob.attributes.get(ROLE)], [id, "member"], "what the logout saves");
  const back = player("Bob");
  back.attributes = new Map(bob.attributes);
  login(back);
  assert.deepEqual([back.attributes.get(GROUP), back.attributes.get(ROLE)], [id, "member"]);
  assert.deepEqual(Members.snapshot(groupOf(back)).members.map(({ online: on }) => on), [true, true]);

  // The leader relogs while Bob is online: back within the grace, still the leader.
  logout(alice);
  runTicks(GRACE - 10);
  const aliceBack = player("Alice");
  aliceBack.attributes = new Map(alice.attributes);
  login(aliceBack);
  runTicks(20);
  assert.deepEqual([aliceBack.attributes.get(GROUP), aliceBack.attributes.get(ROLE)], [id, "leader"]);
  assert.equal(groupOf(back).leader, encoded("Alice"));

  // A restart logs everyone out, the leader first; the grace never runs out before it stops.
  logout(aliceBack);
  logout(back);

  const saved = JSON.parse(fs.readFileSync(process.env[Store.FILE_ENV], "utf8"));
  assert.deepEqual(saved.groups.map(({ id: savedId, leader, members }) => [savedId, leader, members.map(({ account }) => account)]),
    [[id, String(encoded("Alice")), [String(encoded("Alice")), String(encoded("Bob"))]]]);

  // A restart: nobody is logged in, and the store reads its file again.
  Store.reset();
  online = [];
  const alice2 = login(player("Alice"));
  const bob2 = login(player("Bob"));
  assert.deepEqual([alice2.attributes.get(GROUP), alice2.attributes.get(ROLE)], [id, "leader"]);
  assert.deepEqual([bob2.attributes.get(GROUP), bob2.attributes.get(ROLE)], [id, "member"]);
  assert.deepEqual(emit("grouping:get", { player: bob2 }).group.members.map(({ name, online: on }) => [name, on]),
    [["Alice", true], ["Bob", true]]);
  const cara = login(player("Cara"));
  group(alice2, "invite", "Cara");
  group(cara, "accept");
  assert.equal(groupOf(cara).id, id);
  assert.equal(group(cara, "create"), MESSAGE.ALREADY_IN_GROUP);
  const dan = login(player("Dan"));
  group(dan, "create");
  assert.equal(groupOf(dan).id, id + 1, "ids keep counting after a restart");
});

test("case, underscores and display names never make a second member", () => {
  const leader = login(player("Mike Dev"));
  const bob = login(player("Bob Two"));
  group(leader, "invite", "bob_two");
  group(bob, "accept", "MIKE_DEV");
  assert.equal(groupOf(bob)?.id, groupOf(leader).id);
  wait();
  assert.equal(group(leader, "invite", "BOB TWO"), "Bob Two is already in your group.");

  // Back with another spelling of the same login name: the same member.
  logout(bob);
  const again = login(player("bob_TWO"));
  assert.equal(groupOf(again), groupOf(leader));
  assert.equal(groupOf(leader).members.size, 2);
  assert.equal(again.attributes.get(ROLE), "member");

  // A new display name: the member list shows it and still keys the account.
  DisplayNames.set("bob two", "Robert", Date.now(), 0);
  assert.deepEqual(Members.snapshot(groupOf(leader)).members.map(({ name, account }) => [name, account]),
    [["Mike Dev", "mike dev"], ["Robert", "bob two"]]);
  wait();
  assert.equal(group(leader, "kick", "Robert"), "Robert has been removed from the group.");
  assert.equal(groupOf(leader).members.size, 1);
});

test("a login reads the store, not the save: removed while away means out", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  const cara = login(player("Cara"));
  formed(alice, bob, cara);
  logout(bob);
  group(alice, "kick", "Bob");
  const back = player("Bob");
  back.attributes = new Map(bob.attributes);
  login(back);
  assert.deepEqual([back.attributes.get(GROUP), back.attributes.get(ROLE)], [0, ""]);
  assert.equal(said(back), Lifecycle.NO_LONGER_IN_GROUP);
});

// --- Activities ---------------------------------------------------------------------------------

test("minigames say how many they take; a minigame gets the group's members online and whether it fits", () => {
  const [alice, bob, cara, dan] = ["Alice", "Bob", "Cara", "Dan"].map((name) => login(player(name)));
  formed(alice, bob, cara);
  emit("grouping:activity", { name: "Royal Titans", maxSize: 2 });
  emit("grouping:activity", { name: "Tombs of Amascut", maxSize: 8 });
  emit("grouping:activity", { name: "Nothing", maxSize: 0 });
  assert.deepEqual([...Activities.activities], [["Royal Titans", 2], ["Tombs of Amascut", 8]]);

  const toa = emit("grouping:members", { player: bob, activity: "Tombs of Amascut" });
  assert.deepEqual(toa.members.map((member) => member.name), ["Alice", "Bob", "Cara"]);
  assert.deepEqual([toa.leader, toa.isLeader, toa.size, toa.max, toa.fits, toa.message], [alice, false, 3, 8, true, undefined]);
  const titans = emit("grouping:members", { player: alice, activity: "Royal Titans" });
  assert.deepEqual([titans.isLeader, titans.fits, titans.message], [true, false, "Your group has 3 players; Royal Titans takes at most 2."]);
  assert.equal(emit("grouping:members", { player: alice, activity: "Unlisted", maxSize: 3 }).fits, true, "a size given in the request counts");

  logout(cara);
  const away = emit("grouping:members", { player: alice, activity: "Tombs of Amascut" });
  assert.deepEqual([away.members.map((member) => member.name), away.size], [["Alice", "Bob"], 3], "only members online, but every member counts");
  const alone = emit("grouping:members", { player: dan, activity: "Royal Titans" });
  assert.deepEqual([alone.groupId, alone.members, alone.fits, alone.leader], [0, [dan], true, null]);

  assert.equal(emit("grouping:same-group", { player: alice, other: bob }).same, true);
  assert.equal(emit("grouping:same-group", { player: alice, other: dan }).same, false);
  assert.equal(emit("grouping:same-group", { player: dan, other: dan }).same, false, "no group is no shared group");
  group(alice, "info");
  assert.equal(said(alice), "Too many players for: Royal Titans (2).");
});

// --- Logouts and the cap -----------------------------------------------------------------------

test("a member's logout keeps their place, shown offline, and ends invitations to them", () => {
  const [alice, bob, cara] = ["Alice", "Bob", "Cara"].map((name) => login(player(name)));
  formed(alice, bob);
  const dan = login(player("Dan"));
  wait();
  group(dan, "invite", "Bob");
  assert.equal(said(dan), "Bob is already in a group.");
  wait();
  group(alice, "invite", "Cara");
  logout(cara);
  assert.equal(groupOf(alice).invites.size, 0, "an invitation to someone who logged out lapses");
  logout(bob);
  const snapshot = Members.snapshot(groupOf(alice));
  assert.deepEqual(snapshot.members.map(({ name, online: on }) => [name, on]), [["Alice", true], ["Bob", false]]);
  assert.equal(changes("offline").at(-1)[1].target, "bob");
  assert.equal(group(alice, "info"), "Group (2/5): Alice (leader), Bob (offline).");
  assert.equal(group(alice, "promote", "Bob"), "Bob must be online to lead the group.");
});

test("a leader's logout hands the lead to a member still online, or keeps it, or ends a group of one", () => {
  const [alice, bob, cara, dan] = ["Alice", "Bob", "Cara", "Dan"].map((name) => login(player(name)));
  formed(alice, bob, cara);
  wait();
  group(alice, "invite", "Dan");
  logout(bob);
  logout(alice);
  // The invitations lapse at once; the lead waits out the grace.
  assert.equal(groupOf(cara).invites.size, 0, "the leader's invitations lapse");
  assert.equal(group(dan, "accept"), MESSAGE.NO_INVITATION);
  assert.equal(groupOf(cara).leader, encoded("Alice"));
  assert.deepEqual(Members.snapshot(groupOf(cara)).members.map(({ name, online: on }) => [name, on]),
    [["Alice", false], ["Bob", false], ["Cara", true]]);
  runTicks(GRACE);
  // Bob served longer but is offline: Cara, still here, leads.
  assert.equal(groupOf(cara).leader, encoded("Cara"));
  assert.equal(said(cara), "Cara is now the group leader.");
  assert.equal(changes("promoted").at(-1)[1].target, "cara");
  const aliceBack = player("Alice");
  aliceBack.attributes = new Map(alice.attributes);
  login(aliceBack);
  assert.equal(aliceBack.attributes.get(ROLE), "member", "the save is corrected at the next login");

  // Nobody else online when the grace runs out: the leader keeps it.
  logout(aliceBack);
  logout(cara);
  runTicks(GRACE);
  assert.equal(Store.groupOf("main", encoded("Cara")).leader, encoded("Cara"));

  // A relog and a second logout inside the first grace: only the last logout counts.
  const cara2 = login(player("Cara"));
  login(player("Bob"));
  logout(cara2);
  runTicks(GRACE - 30);
  const cara3 = login(player("Cara"));
  logout(cara3);
  runTicks(40);
  assert.equal(Store.groupOf("main", encoded("Cara")).leader, encoded("Cara"), "the first logout's grace was called off");
  runTicks(GRACE);
  assert.equal(Store.groupOf("main", encoded("Cara")).leader, encoded("Bob"));

  // A group of one ends when its leader doesn't come back.
  const eve = login(player("Eve"));
  group(eve, "create");
  logout(eve);
  assert.ok(Store.groupOf("main", encoded("Eve")));
  runTicks(GRACE);
  assert.equal(Store.groupOf("main", encoded("Eve")), undefined);
  assert.equal(changes("disbanded").at(-1)[1].actor, "eve");
  const eveBack = player("Eve");
  eveBack.attributes = new Map(eve.attributes);
  login(eveBack);
  assert.deepEqual([eveBack.attributes.get(GROUP), said(eveBack)], [0, Lifecycle.NO_LONGER_IN_GROUP]);
});

test("the cap is checked at the last accept", () => {
  const players = ["Alice", "Bob", "Cara", "Dan", "Eve", "Finn"].map((name) => login(player(name)));
  const [alice, bob, cara, dan, eve, finn] = players;
  formed(alice, bob, cara);
  for (const name of ["Dan", "Eve", "Finn"]) {
    wait();
    group(alice, "invite", name);
  }
  assert.equal(groupOf(alice).invites.size, 3, "invitations may outnumber the places left");
  group(dan, "accept");
  group(eve, "accept");
  assert.equal(groupOf(alice).members.size, Members.MEMBER_CAP);
  assert.equal(group(finn, "accept"), MESSAGE.TARGET_FULL);
  assert.equal(groupOf(finn), undefined);
  assert.equal(groupOf(alice).members.size, Members.MEMBER_CAP);
  assert.equal(groupOf(alice).invites.size, 0);
  const gus = login(player("Gus"));
  wait();
  assert.equal(group(alice, "invite", "Gus"), MESSAGE.GROUP_FULL);
  assert.equal(gus.messages.length, 0);
});

test("invitations wait two seconds between them, on Trading's SecondsTimer, and lapse after two minutes", () => {
  assert.equal(PluginManager.getCoreApi().SecondsTimer, SecondsTimer);
  const [alice, bob, cara] = ["Alice", "Bob", "Cara"].map((name) => login(player(name)));
  group(alice, "invite", "Bob");
  assert.equal(group(alice, "invite", "Cara"), "You must wait another 2 seconds before sending more invitations.");
  clock += 1000;
  assert.equal(group(alice, "invite", "Cara"), "You must wait another 1 second before sending more invitations.");
  clock += 1000;
  assert.equal(group(alice, "invite", "Cara"), "You invite Cara to join your group.");

  const later = Date.now() + Actions.INVITE_EXPIRY_MS + 1;
  assert.equal(Actions.accept(bob, groupOf(alice), later), false);
  assert.equal(said(bob), MESSAGE.NO_INVITATION);
  assert.equal(groupOf(alice).invites.has(encoded("Bob")), false);
  assert.equal(Actions.accept(cara, groupOf(alice)), true);
});

// --- The panel --------------------------------------------------------------------------------

const { COMPONENT, uid } = Layout;
const rowsOf = (self) => JSON.parse(self.strings.get(uid(COMPONENT.DATA)));
const layoutOf = (self) => JSON.parse(self.strings.get(uid(COMPONENT.LAYOUT)));
const rowNamed = (self, name) => rowsOf(self).find((row) => row.name === name);
const click = (self, uidValue, extra = {}) => hooks.buttons.get(uidValue)({ player: self, buttonId: uidValue, ...extra });
const select = (self, row) => click(self, uid(COMPONENT.ROW_LABEL_START), { slot: row.id, opId: 1 });
const primary = (self) => click(self, uid(COMPONENT.PRIMARY_BUTTON));
const secondary = (self) => click(self, uid(COMPONENT.SECONDARY_BUTTON));
const buttonsShown = (self) => [COMPONENT.PRIMARY_BUTTON, COMPONENT.SECONDARY_BUTTON].map((component) => self.hidden.get(uid(component)) === false);

test("the panel forms, invites, accepts and kicks, and every open panel shows the same members", () => {
  assert.equal(hooks.interfaces[0].groupId, Layout.GROUP_ID);
  const alice = login(player("Alice"));
  const bob = login(player("Bob", { x: 3203 }));
  group(alice);
  assert.equal(alice.opened, Layout.GROUP_ID);
  assert.equal(layoutOf(alice).active, Panel.TAB.GROUP);
  select(alice, rowNamed(alice, "Form a group"));
  assert.deepEqual(buttonsShown(alice), [true, false]);
  primary(alice);
  assert.equal(said(alice), MESSAGE.CREATED);
  assert.deepEqual(layoutOf(alice).tabs[0][0], { header: "Members (1/5)" });

  const bobRow = rowNamed(alice, "Bob");
  assert.equal(bobRow.detail, " (level-50)");
  assert.equal(bobRow.panel.primary, "Invite");
  select(alice, bobRow);
  primary(alice);
  assert.equal(said(bob), "Alice has invited you to join their group. Type ::group to answer.");

  group(bob);
  assert.equal(layoutOf(bob).active, Panel.TAB.INVITES);
  const invitation = rowNamed(bob, "Alice's group");
  assert.deepEqual([invitation.panel.primary, invitation.panel.secondary], ["Accept", "Decline"]);
  select(bob, invitation);
  assert.deepEqual(buttonsShown(bob), [true, true]);
  primary(bob);
  assert.equal(said(bob), "You have joined Alice's group.");

  // Both panels were open: both were sent the same member rows.
  const members = (self) => layoutOf(self).tabs[0].filter((id) => typeof id === "number")
    .map((id) => rowsOf(self).find((row) => row.id === id)).map(({ name, detail }) => `${name}${detail}`);
  assert.deepEqual(members(alice), ["Alice (leader, you)", "Bob"]);
  assert.deepEqual(members(bob), ["Alice (leader)", "Bob (you)"]);

  // Bob sees no actions on Alice; Alice can promote or kick Bob.
  select(bob, rowNamed(bob, "Alice"));
  assert.deepEqual(buttonsShown(bob), [false, false]);
  primary(bob);
  assert.equal(groupOf(alice).leader, encoded("Alice"));
  select(alice, rowNamed(alice, "Bob"));
  assert.deepEqual(buttonsShown(alice), [true, true]);
  secondary(alice);
  assert.equal(said(bob), MESSAGE.KICKED);
  assert.equal(groupOf(bob), undefined);
  assert.deepEqual(members(bob), ["Form a group"], "Bob's open panel lost the group");
  assert.equal(rowNamed(bob, "Form a group").panel.primary, "Create");
});

test("a row id still names the same row after the list is refreshed", () => {
  const alice = login(player("Alice"));
  const bob = login(player("Bob"));
  group(alice);
  const before = rowNamed(alice, "Bob").id;
  login(player("Aaron", { x: 3200 }));
  click(alice, uid(COMPONENT.TAB_START + Panel.TAB.FIND));
  assert.equal(rowNamed(alice, "Bob").id, before);
  select(alice, { id: before });
  primary(alice);
  assert.equal(said(bob), "Alice has invited you to join their group. Type ::group to answer.");
});
