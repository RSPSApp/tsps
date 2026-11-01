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
    attributes: new Map(),
    scripts: [],
    mounted: [],
    equipment: [],
    location: { getX: () => 3181, getY: () => 3471, getZ: () => 0 },
    getAttribute: (key) => self.attributes.get(key),
    setAttribute: (key, value) => self.attributes.set(key, value),
    getLocation: () => self.location,
    getEquipment: () => ({ containsNumber: (id) => self.equipment.includes(id) }),
    getDialogueManager: () => ({
      isActive: () => false,
      startDialogues(chain) {
        self.dialogue = chain;
      },
    }),
    setEnteredSyntaxAction: (action) => (self.syntaxAction = action),
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
      sendPlayerOption(slot, text) {
        self.option = [slot, text];
        return this;
      },
      sendClientScript(id, ...args) {
        self.scripts.push([id, ...args]);
        return this;
      },
      sendSubInterface(target, group) {
        self.mounted.push(group);
        return this;
      },
      sendInterfaceFlagsRange(uid, start, end, flags) {
        self.flags = [uid, flags];
        return this;
      },
      sendInterfaceDisplayState(uid, hidden) {
        self.hidden = [uid, hidden];
        return this;
      },
      sendEnterInputPrompt(title) {
        self.prompt = title;
        return this;
      },
      sendInterfaceRemoval() {
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

function clickGroup(self, groupId, childId) {
  const event = { player: self, groupId, childId };
  for (const handler of hooks.clicks) handler(event);
  return event;
}

function answer(self, option) {
  const dialogue = self.dialogue;
  self.dialogue = null;
  dialogue.handler.executeOption(option);
}

function login(self) {
  hooks.custom.get('player:bootstrap-complete')({ player: self });
}

function click(self, childId) {
  return clickGroup(self, 701, childId);
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
  hooks = { custom: new Map(), commands: new Map(), clicks: [], emitted: [], npc: {} };
  Clans._reset();
  Clans.register({
    core: {
      ...protocol,
      Task,
      TaskManager,
      PlayerRights,
      ItemIdentifiers: { CLAN_CLOAK: 25712, CLAN_VEXILLUM: 25721 },
      DialogueChainBuilder: class {
        add(dialogue) {
          return dialogue;
        }
      },
      OptionDialogue: class {
        constructor(index, handler, ...options) {
          this.handler = handler;
          this.options = options;
        }
        setTitle(title) {
          this.title = title;
          return this;
        }
      },
      World: {
        getPlayers: () => ({ search: (match) => online.find(match) ?? null }),
      },
    },
    onCustomEvent: (name, handler) => hooks.custom.set(name, handler),
    onPlayerLogout: (handler) => (hooks.logout = handler),
    onSocialPacket: (handler) => (hooks.social = handler),
    onInterfaceActionClick: (handler) => hooks.clicks.push(handler),
    onPlayerOption: (handler) => (hooks.playerOption = handler),
    onPlayerMapSquareChange: (handler) => (hooks.mapSquare = handler),
    onCanEquip: (handler) => (hooks.canEquip = handler),
    onCanUnequip: (handler) => (hooks.canUnequip = handler),
    onNpcInteraction: (name, actions) => (hooks.npc[name] = actions),
    persistAttribute: () => {},
    emitCustomEvent: (name, payload) => {
      hooks.emitted.push([name, payload]);
      // SideChannels mounting the panel at once, as it does when the tab is up.
      if (name === 'side-channels:replace-your-clan') payload.onMount?.();
    },
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
  assert.deepEqual(sent(owner, CLAN_CHANNEL_DELTA).at(-1), protocol.encodeClanChannelDelta(0, 1, 3, [
    { type: 'add', user: { name: 'Member', rank: 0, world: 1 } },
  ]));
  hooks.logout({ player: member });
  assert.deepEqual(sent(owner, CLAN_CHANNEL_DELTA).at(-1), protocol.encodeClanChannelDelta(0, 1, 4, [
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

// ---------------------------------------------------------------- the Clan Hub

const CLERK = 10759;
const ELIGIBLE_MINUTES = 25 * 60;

function founders(count) {
  return Array.from({ length: count }, (_, i) => {
    const self = player(`Founder${i}`);
    self.setAttribute('clans:minutes-played', ELIGIBLE_MINUTES);
    login(self);
    return self;
  });
}

function startForming(founder) {
  hooks.npc.Clerk['Talk-to']({ player: founder, npc: {}, npcId: CLERK });
  assert.deepEqual(founder.dialogue.options, ["I'd like to form a clan.", 'I have some questions.']);
  answer(founder, 1);
}

function inviteAll(founder, others) {
  for (const other of others) {
    hooks.custom.get('magic:spell-on-player')({ player: founder, target: other, spellWidget: (705 << 16) | 9 });
    answer(other, 1);
  }
}

function nameClan(founder, name) {
  clickGroup(founder, 705, 8);
  assert.equal(founder.prompt, "Enter your clan's name:");
  founder.syntaxAction.execute(name);
}

test('another Clerk, and a Clerk for someone in a clan, keep their transcript', () => {
  const self = player('Solo');
  assert.equal(hooks.npc.Clerk['Talk-to']({ player: self, npc: {}, npcId: 4255 }), false);
  createClan(self);
  assert.equal(hooks.npc.Clerk['Talk-to']({ player: self, npc: {}, npcId: CLERK }), false);
});

test('I have some questions plays the Clerk transcript', () => {
  const self = player('Solo');
  hooks.npc.Clerk['Talk-to']({ player: self, npc: {}, npcId: CLERK });
  answer(self, 2);
  assert.equal(hooks.emitted.at(-1)[0], 'npc-dialogue:start');
});

test('the panel opens with the founder flag and target mode, and lists who has joined', () => {
  const [founder, other] = founders(2);
  startForming(founder);
  assert.equal(founder.varbits.get(12171), 1, 'clan_i_am_founder');
  assert.deepEqual(founder.flags, [(705 << 16) | 9, 1 << 14]);
  assert.deepEqual(founder.scripts.at(-1), [4448, (705 << 16) | 7, 'Founder0', '', '', '', '', 'Founder0']);
  inviteAll(founder, [other]);
  assert.equal(other.varbits.get(12172), 1, 'clan_i_am_founder_member');
  assert.deepEqual(founder.scripts.at(-1), [4448, (705 << 16) | 7, 'Founder0', 'Founder1', '', '', '', 'Founder0']);
  assert.deepEqual(other.scripts.at(-1), [4448, (705 << 16) | 7, 'Founder0', 'Founder1', '', '', '', 'Founder1']);
});

test('naming sets the button, and refuses a taken or bad name', () => {
  const [founder, owner] = founders(2);
  createClan(owner, 'Taken');
  startForming(founder);
  nameClan(founder, 'Taken');
  assert.deepEqual(founder.messages, ['That name is taken.']);
  nameClan(founder, 'bad<name>');
  assert.match(founder.messages.at(-1), /letters, numbers and spaces/);
  nameClan(founder, 'Fresh');
  assert.deepEqual(founder.scripts.find((script) => script[0] === 4447), [4447, 705 << 16, (705 << 16) | 8, 3824, 'Fresh']);
});

test('Confirm needs a name, five founders and 25 hours each', () => {
  const players = founders(5);
  const [founder, ...others] = players;
  startForming(founder);
  clickGroup(founder, 705, 11);
  assert.equal(founder.messages.at(-1), 'Your clan needs a name first.');
  nameClan(founder, 'Fresh');
  clickGroup(founder, 705, 11);
  assert.equal(founder.messages.at(-1), 'You need 5 founders to form a clan.');
  inviteAll(founder, others);
  others[2].setAttribute('clans:minutes-played', ELIGIBLE_MINUTES - 1);
  clickGroup(founder, 705, 11);
  assert.equal(founder.messages.at(-1), 'Founder3 has not spent 25 hours in-game yet.');
  others[2].setAttribute('clans:minutes-played', ELIGIBLE_MINUTES);
  clickGroup(founder, 705, 11);
  const saved = JSON.parse(fs.readFileSync(process.env.TSPS_CLANS_FILE, 'utf8')).clans[0];
  assert.equal(saved.name, 'Fresh');
  assert.deepEqual(saved.members.map((member) => [member.name, member.rank]),
    [['Founder0', 126], ['Founder1', 0], ['Founder2', 0], ['Founder3', 0], ['Founder4', 0]]);
  for (const self of players) {
    assert.equal(self.varbits.get(933), 3);
    assert.equal(self.varbits.get(12171), 0);
    assert.equal(self.varbits.get(12172), 0);
  }
  assert.ok(hooks.emitted.some(([name, payload]) => name === 'side-channels:replace-your-clan' && payload.player === founder && payload.group === null));
});

test('one clan per day for its creator', () => {
  const players = founders(5);
  const [founder, ...others] = players;
  startForming(founder);
  nameClan(founder, 'Fresh');
  inviteAll(founder, others);
  clickGroup(founder, 705, 11);
  // Everyone leaves but the owner, who deletes the clan and tries again the same day.
  const clan = require('../plugins/interface/clans/Store.Clans').byName('Fresh');
  require('../plugins/interface/clans/Core.Clans').deleteClan(clan);
  const again = founders(5).slice(1);
  startForming(founder);
  nameClan(founder, 'Again');
  inviteAll(founder, again);
  clickGroup(founder, 705, 11);
  assert.equal(founder.messages.at(-1), 'You can only create one clan per day.');
});

test('Cancel by the founder ends it for all; by anyone else only for them; so does logging out', () => {
  const [founder, a, b] = founders(3);
  startForming(founder);
  inviteAll(founder, [a, b]);
  clickGroup(a, 705, 10);
  assert.equal(a.varbits.get(12172), 0);
  assert.deepEqual(founder.scripts.at(-1).slice(2, 4), ['Founder0', 'Founder2']);
  hooks.logout({ player: founder });
  assert.equal(b.varbits.get(12172), 0);
  assert.match(b.messages.at(-1), /cancelled/);
});

test('a declined invite leaves the founder alone', () => {
  const [founder, other] = founders(2);
  startForming(founder);
  hooks.custom.get('magic:spell-on-player')({ player: founder, target: other, spellWidget: (705 << 16) | 9 });
  answer(other, 2);
  assert.equal(founder.messages.at(-1), 'Founder1 has declined your invitation.');
  assert.equal(other.varbits.get(12172), undefined);
});

test('the invite button ignores spells, and Recruit also invites while forming', () => {
  const [founder, other] = founders(2);
  startForming(founder);
  const spell = { player: founder, target: other, spellWidget: 218 << 16 };
  hooks.custom.get('magic:spell-on-player')(spell);
  assert.equal(spell.handled, undefined);
  assert.equal(other.dialogue, undefined);
  hooks.playerOption({ player: founder, target: other, option: 6 });
  assert.match(other.dialogue.title, /form a clan/);
});

// ---------------------------------------------------------------- recruiting

test('Recruit needs a rank, a place, and a target accepting aid, then adds them as rank 0', () => {
  const owner = player('Owner');
  const recruit = player('Recruit');
  const later = player('Later');
  login(owner);
  assert.deepEqual(owner.option, [6, 'Recruit']);
  createClan(owner);
  recruit.setAttribute('accept-aid', false);
  hooks.playerOption({ player: owner, target: recruit, option: 6 });
  assert.equal(owner.messages.at(-1), 'Recruit is not accepting aid.');
  recruit.setAttribute('accept-aid', true);
  owner.location = { getX: () => 3200, getY: () => 3200, getZ: () => 0 };
  hooks.playerOption({ player: owner, target: recruit, option: 6 });
  assert.match(owner.messages.at(-1), /Clan Hub, or with a clan vexillum/);
  owner.equipment = [25721];
  hooks.playerOption({ player: owner, target: recruit, option: 6 });
  assert.equal(recruit.dialogue.title, 'Join Blur?');
  answer(recruit, 1);
  assert.equal(recruit.varbits.get(933), 3);
  hooks.playerOption({ player: recruit, target: later, option: 6 });
  assert.equal(recruit.messages.at(-1), 'You are not a high enough rank to recruit.');
});

test('the Recruit option shows only around the hub or with a vexillum on', () => {
  const self = player('Solo');
  login(self);
  assert.deepEqual(self.option, [6, 'Recruit']);
  self.location = { getX: () => 3200, getY: () => 3200, getZ: () => 0 };
  hooks.mapSquare({ player: self });
  assert.deepEqual(self.option, [6, '']);
  self.equipment = [25721];
  hooks.canEquip({ player: self, item: { getId: () => 25721 } });
  runTicks(1);
  assert.deepEqual(self.option, [6, 'Recruit']);
  self.equipment = [];
  hooks.canUnequip({ player: self, item: { getId: () => 25721 } });
  runTicks(1);
  assert.deepEqual(self.option, [6, '']);
});

test('Recruit leaves bots to the bots plugin', () => {
  const owner = player('Owner');
  const event = { player: owner, target: { isPlayerBot: () => true }, option: 6 };
  hooks.playerOption(event);
  assert.equal(event.handled, undefined);
});

test('the Clerk gives a member a cloak and vexillum once', () => {
  const owner = player('Owner');
  const added = [];
  owner.getInventory = () => ({
    containsNumber: (id) => added.includes(id),
    getFreeSlots: () => 28,
    adds: (id) => added.push(id),
  });
  hooks.npc.Clerk.Items({ player: owner, npcId: CLERK });
  assert.deepEqual(owner.messages, ['You need to be in a clan for that.']);
  createClan(owner);
  hooks.npc.Clerk.Items({ player: owner, npcId: CLERK });
  hooks.npc.Clerk.Items({ player: owner, npcId: CLERK });
  assert.deepEqual(added, [25712, 25721]);
});

// ---------------------------------------------------------------- Settings, leaving, resigning

test('Settings opens 690 with the rows in rsprox 2778 order', () => {
  const owner = player('Owner');
  createClan(owner);
  assert.equal(click(owner, 9).handled, true);
  assert.deepEqual(owner.mounted.at(-1), 690);
  const rows = owner.scripts.filter((script) => script[0] === 4290);
  assert.deepEqual(rows.map((row) => row[2] & 0xffff), [11, 12, 13, 14, 15, 16]);
  assert.match(rows[0][1], /^Name:\|<col=ffb83f>Blur<\/col>\|Rename$/);
  assert.match(rows[2][1], /resign/);
  assert.deepEqual(rows[5].slice(3), [1, 0], 'the checkbox row');
  assert.match(owner.scripts.find((script) => script[0] === 4289)[2], /<col=ffb83f>1<\/col><br><col=ffb83f>Owner<\/col><br><col=ffb83f>\d\d-[A-Z][a-z]{2}-20\d\d<\/col>/);
  assert.equal(clickGroup(owner, 690, 21).handled, true);
  assert.match(owner.messages.at(-1), /not available yet/);
});

test('a member sees no resign row, and leaving takes them out', () => {
  const owner = player('Owner');
  const member = player('Member');
  createClan(owner);
  addMember(owner, member);
  click(member, 9);
  assert.deepEqual(member.hidden, [(690 << 16) | 13, true]);
  clickGroup(member, 690, 26);
  assert.equal(member.dialogue.title, 'Leave Blur?');
  answer(member, 1);
  assert.equal(member.varbits.get(933), 1);
  assert.deepEqual(sent(member, CLAN_CHANNEL_FULL).at(-1), protocol.encodeClanChannelFull(0, null));
  assert.deepEqual(sent(member, CLAN_SETTINGS_FULL).at(-1), protocol.encodeClanSettingsFull(0, null));
  const saved = JSON.parse(fs.readFileSync(process.env.TSPS_CLANS_FILE, 'utf8')).clans[0];
  assert.deepEqual(saved.members.map((entry) => entry.name), ['Owner']);
});

test('an owner has to resign before leaving', () => {
  const owner = player('Owner');
  createClan(owner);
  clickGroup(owner, 690, 26);
  assert.equal(owner.dialogue, undefined);
  assert.match(owner.messages.at(-1), /must resign/);
});

test('resigning hands over after 7 days to the next rank, longest in the clan first, and can be undone', () => {
  const Core = require('../plugins/interface/clans/Core.Clans');
  const Store = require('../plugins/interface/clans/Store.Clans');
  const owner = player('Owner');
  const first = player('First');
  const second = player('Second');
  createClan(owner);
  addMember(owner, second);
  addMember(owner, first);
  const clan = Store.byName('Blur');
  Core.memberOf(clan, 'first').joinRuneDay -= 10;
  clickGroup(owner, 690, 13);
  answer(owner, 1);
  assert.ok(clan.resignDueAt > Date.now());
  clickGroup(owner, 690, 13);
  assert.equal(clan.resignDueAt, 0, 'clicked again');
  clickGroup(owner, 690, 13);
  answer(owner, 1);
  Core.settleOwnership(clan, clan.resignDueAt - 1);
  assert.equal(Core.ownerOf(clan).name, 'Owner');
  Core.settleOwnership(clan, clan.resignDueAt);
  assert.equal(Core.ownerOf(clan).name, 'First');
  assert.equal(Core.memberOf(clan, 'owner').rank, 125);
  assert.equal(clan.resignDueAt, 0);
});

test('an owner away 90 days starts resigning, and a clan with nobody left is deleted', () => {
  const Core = require('../plugins/interface/clans/Core.Clans');
  const Store = require('../plugins/interface/clans/Store.Clans');
  const owner = player('Owner');
  createClan(owner);
  const clan = Store.byName('Blur');
  const day = 86400000;
  Core.settleOwnership(clan, clan.ownerLastSeen + 90 * day);
  assert.equal(clan.resignDueAt, clan.ownerLastSeen + 97 * day);
  Core.settleOwnership(clan, clan.resignDueAt);
  assert.equal(Store.byName('Blur'), undefined);
  assert.equal(owner.varbits.get(933), 1);
});

test('advance_time counts towards the hours', () => {
  const self = player('Solo');
  const event = { player: self, ms: 90 * 60000, handledBy: [] };
  hooks.custom.get('agent:advance-time')(event);
  assert.equal(self.getAttribute('clans:minutes-played'), 90);
  assert.deepEqual(event.handledBy, ['Clans']);
});
