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
const CLAN_SETTINGS_DELTA = 127;

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
    setEnteredAmountAction: (action) => (self.amountAction = action),
    getSkillManager: () => ({ getCombatLevel: () => self.combat ?? 3, getTotalLevel: () => self.total ?? 32, getMaxLevel: () => 1 }),
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
      sendString() {
        return this;
      },
      sendTab(id) {
        self.tab = id;
        return this;
      },
      sendEnterAmountPrompt(title) {
        self.prompt = title;
        return this;
      },
      closeSubInterface(uid) {
        self.closedSub = uid;
        return this;
      },
      sendConfig(id, value) {
        (self.configs ??= new Map()).set(id, value);
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
  hooks.social[0](event);
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
      Skill: { values: () => [{ id: 0 }, { id: 1 }] },
      ItemDefinition: { forId: (id) => ({ getName: () => `Item ${id}`, getValue: () => id }) },
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
    onSocialPacket: (handler) => (hooks.social = hooks.social ?? []).push(handler),
    onInterfaceActionClick: (handler) => hooks.clicks.push(handler),
    onPlayerOption: (handler) => (hooks.playerOption = handler),
    onPlayerMapSquareChange: (handler) => (hooks.mapSquare = handler),
    onCanEquip: (handler) => (hooks.canEquip = handler),
    onCanUnequip: (handler) => (hooks.canUnequip = handler),
    onNpcInteraction: (name, actions) => (hooks.npc[name] = actions),
    onObjectInteraction: (name, actions) => ((hooks.objects ??= {})[name] = actions),
    onPlayerLevelUp: (handler) => (hooks.levelUp = handler),
    onPlayerDefeated: (handler) => (hooks.defeated = handler),
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
  assert.deepEqual(sent(self, CLAN_CHANNEL_FULL).at(-1), protocol.encodeClanChannelFull(0, null));
  assert.deepEqual(sent(self, CLAN_SETTINGS_FULL).at(-1), protocol.encodeClanSettingsFull(-1, null), 'nor a guest clan');
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
  assert.match(sent(again, CLAN_CHANNEL_FULL).at(-1).toString('latin1'), /Founder/);
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
  assert.deepEqual(sent(again, CLAN_CHANNEL_FULL).at(-1), protocol.encodeClanChannelFull(0, null));
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
  assert.equal(clickGroup(owner, 690, 19).handled, true);
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

test('an owner away 90 days is replaced at once with the captured message; alone, they stay', () => {
  const Core = require('../plugins/interface/clans/Core.Clans');
  const Store = require('../plugins/interface/clans/Store.Clans');
  const owner = player('Owner');
  const member = player('Member');
  createClan(owner);
  const clan = Store.byName('Blur');
  const day = 86400000;
  Core.settleOwnership(clan, clan.ownerLastSeen + 90 * day);
  assert.equal(Core.ownerOf(clan).name, 'Owner', 'nobody to take over');
  addMember(owner, member);
  Core.settleOwnership(clan, clan.ownerLastSeen + 90 * day);
  assert.equal(Core.ownerOf(clan).name, 'Member');
  assert.equal(member.messages.at(-1), 'Owner has been inactive for over 90 days. The new Clan Owner is <col=ef1020>Member</col>.');
});

test('a sole owner who resigns deletes the clan when the 7 days are up', () => {
  const Core = require('../plugins/interface/clans/Core.Clans');
  const Store = require('../plugins/interface/clans/Store.Clans');
  const owner = player('Owner');
  createClan(owner);
  const clan = Store.byName('Blur');
  clickGroup(owner, 690, 13);
  answer(owner, 1);
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

// ---------------------------------------------------------------- phase 3

const CoreClans = () => require('../plugins/interface/clans/Core.Clans');
const StoreClans = () => require('../plugins/interface/clans/Store.Clans');

function clanOfThree() {
  const owner = player('Owner');
  const member = player('Member');
  const other = player('Other');
  createClan(owner);
  addMember(owner, member);
  addMember(owner, other);
  return { owner, member, other, clan: StoreClans().byName('Blur') };
}

function row(self, sub) {
  return { player: self, groupId: 693, childId: 11, slot: sub };
}

function clickRow(self, sub) {
  for (const handler of hooks.clicks) handler(row(self, sub));
}

function popup(self) {
  return self.scripts.filter((script) => script[0] === 4316).at(-1);
}

test('Members opens with its op flags and combat and total columns by slot (2896)', () => {
  const { owner, clan } = clanOfThree();
  owner.combat = 105;
  owner.total = 1724;
  clickGroup(owner, 690, 20);
  assert.equal(owner.mounted.at(-1), 693);
  assert.equal(owner.configs.get(3021), 16646144);
  assert.deepEqual(owner.scripts.find((script) => script[0] === 4257), [4257, '105|3|3']);
  assert.deepEqual(owner.scripts.find((script) => script[0] === 4258), [4258, '1724|32|32']);
  assert.equal(clan.members.length, 3);
});

test('a rank is set through the popup, answered with rank + 1, as a delta (3086)', () => {
  const { owner, member, clan } = clanOfThree();
  clickRow(owner, 1);
  assert.deepEqual(popup(owner), [4316, 'Set rank for Member:', 0, 0, 125, 1, (693 << 16) | 27]);
  assert.equal(owner.mounted.at(-1), 289, 'popupoverlay');
  const before = sent(member, CLAN_SETTINGS_DELTA).length;
  owner.amountAction.execute(116);
  assert.equal(owner.closedSub, (693 << 16) | 27);
  assert.equal(clan.members[1].rank, 115);
  assert.equal(sent(member, CLAN_SETTINGS_DELTA).length, before + 1);
  assert.deepEqual(sent(member, CLAN_SETTINGS_DELTA).at(-1),
    protocol.encodeClanSettingsDelta(0, clan.updateNum, [{ type: 'member_rank', index: 1, rank: 115 }]));
  assert.match(sent(member, CLAN_CHANNEL_FULL).at(-1).toString('latin1'), /Member/);
});

test('a rank above or equal to yours is refused with the captured line (3084)', () => {
  const { owner, member } = clanOfThree();
  clickRow(member, 0);
  assert.equal(member.messages.at(-1), 'You can only edit the ranks of players whose ranks are lower than yours.');
  clickRow(owner, 0);
  assert.equal(owner.messages.at(-1), 'You can only edit the ranks of players whose ranks are lower than yours.');
});

test('a deputy assigns up to the rank below theirs (2895), and can\'t forge one above it', () => {
  const { owner, member, other, clan } = clanOfThree();
  CoreClans().setMemberRank(clan, clan.members[1], 125);
  clickRow(member, 2);
  assert.equal(popup(member)[4], 124);
  member.amountAction.execute(126);
  assert.equal(clan.members[2].rank, 0, 'rank 125 refused');
  member.amountAction.execute(125);
  assert.equal(clan.members[2].rank, 124);
  assert.equal(other.varbits.get(933), 3);
  assert.equal(owner.varbits.get(933), 3);
});

test('canceling the popup (0) changes nothing; the empty rank 128 expels when allowed', () => {
  const { owner, member, clan } = clanOfThree();
  clickRow(owner, 1);
  owner.amountAction.execute(0);
  assert.equal(clan.members[1].rank, 0);
  owner.amountAction.execute(129);
  assert.equal(clan.members.length, 2);
  assert.equal(member.varbits.get(933), 1);
  assert.match(member.messages.at(-1), /expelled/);
});

test('without the Expel permission the popup hides it, and a forged answer does nothing', () => {
  const { owner, member, clan } = clanOfThree();
  CoreClans().setMemberRank(clan, clan.members[1], 90);
  clan.permissions = { ...clan.permissions, 14: 90 };
  clickRow(member, 2);
  assert.equal(popup(member)[5], 0, 'no expel entry');
  member.amountAction.execute(129);
  assert.equal(clan.members.length, 3);
  assert.equal(owner.varbits.get(933), 3);
});

test('the rank filters set their varbits', () => {
  const { owner } = clanOfThree();
  clickGroup(owner, 693, 23);
  owner.amountAction.execute(101);
  assert.equal(owner.varbits.get(12179), 100);
  clickGroup(owner, 693, 24);
  owner.amountAction.execute(101);
  assert.equal(owner.varbits.get(12180), 101);
});

test('Members Back reopens Settings (2896)', () => {
  const { owner } = clanOfThree();
  clickGroup(owner, 690, 20);
  clickGroup(owner, 693, 25);
  assert.equal(owner.mounted.at(-1), 690);
});

test('a permission is set through its popup and saved, sent as rank + 2', () => {
  const { owner, clan } = clanOfThree();
  clickGroup(owner, 690, 23);
  assert.equal(owner.mounted.at(-1), 706);
  assert.deepEqual(owner.flags, [(706 << 16) | 12, 2]);
  const assign = { player: owner, groupId: 706, childId: 12, slot: 2 };
  for (const handler of hooks.clicks) handler(assign);
  assert.equal(popup(owner)[1], 'Assign member ranks:');
  assert.deepEqual(popup(owner).slice(2, 5), [100, 100, 126]);
  owner.amountAction.execute(116);
  assert.equal(clan.permissions[14], 115);
  assert.deepEqual(sent(owner, CLAN_SETTINGS_DELTA).at(-1),
    protocol.encodeClanSettingsDelta(0, clan.updateNum, [{ type: 'int_setting', setting: 14, value: 117 }]));
  const saved = JSON.parse(fs.readFileSync(process.env.TSPS_CLANS_FILE, 'utf8')).clans[0];
  assert.equal(saved.permissions[14], 115);
});

test('only Permission access may change permissions; value rows take a number or toggle', () => {
  const { owner, member, clan } = clanOfThree();
  const row = (who, slot) => { for (const handler of hooks.clicks) handler({ player: who, groupId: 706, childId: 12, slot }); };
  row(member, 2);
  assert.match(member.messages.at(-1), /high enough rank/);
  row(owner, 10);
  assert.equal(clan.allowGuests, false);
  row(owner, 11);
  owner.amountAction.execute(70);
  assert.equal(CoreClans().guestRules(clan).combat, 70);
  row(owner, 40);
  owner.amountAction.execute(5000);
  assert.equal(CoreClans().settingValue(clan, 31), 5000);
});

test('talk and kick permissions change what the channel carries, and talk is enforced', () => {
  const { owner, member, clan } = clanOfThree();
  for (const handler of hooks.clicks) handler({ player: owner, groupId: 706, childId: 12, slot: 7 });
  owner.amountAction.execute(11);
  assert.equal(clan.talkRank, 10);
  const lines = chatText(owner).length;
  say(member, 'hello');
  assert.deepEqual(member.notices.at(-1), [43, "You are not a high enough rank to talk in this clan's channel."]);
  assert.equal(chatText(owner).length, lines);
  for (const handler of hooks.clicks) handler({ player: owner, groupId: 706, childId: 12, slot: 8 });
  owner.amountAction.execute(116);
  assert.equal(clan.kickRank, 115);
});

test('kick needs the rank; a kicked member is out of the channel but still in the clan', () => {
  const { owner, member, other, clan } = clanOfThree();
  const kick = (who, slot) => hooks.social[1]({ player: who, packet: { type: 'clan_channel_action', action: 'kick', slot, value: 0 }, handled: false });
  kick(member, 0);
  assert.match(member.messages.at(-1), /high enough rank/);
  kick(owner, 1);
  assert.deepEqual(member.notices.at(-1), [43, 'You have been kicked from the channel.']);
  assert.deepEqual(sent(member, CLAN_CHANNEL_FULL).at(-1), protocol.encodeClanChannelFull(0, null));
  assert.equal(CoreClans().memberOf(clan, 'member').rank, 0);
  assert.equal(other.varbits.get(933), 3);
});

test('mute silences a member, and members can\'t be banned from the channel', () => {
  const { owner, member, clan } = clanOfThree();
  const act = (who, action, slot, value = 0) => hooks.social[1]({ player: who, packet: { type: 'clan_channel_action', action, slot, value }, handled: false });
  act(owner, 'mute', 1, 1);
  assert.equal(CoreClans().memberOf(clan, 'member').muted, true);
  say(member, 'hello');
  assert.deepEqual(member.notices.at(-1), [43, "You are muted in this clan's channel."]);
  act(owner, 'mute', 1, 0);
  assert.equal(CoreClans().memberOf(clan, 'member').muted, false);
  act(owner, 'ban', 1);
  assert.match(owner.messages.at(-1), /must be expelled/);
});

test('the ban list adds and removes names, holds only outsiders, and blocks Recruit', () => {
  const { owner, clan } = clanOfThree();
  clickGroup(owner, 690, 25);
  assert.equal(owner.mounted.at(-1), 689);
  clickGroup(owner, 689, 14);
  owner.syntaxAction.execute('Member');
  assert.match(owner.messages.at(-1), /must be expelled/);
  clickGroup(owner, 689, 14);
  owner.syntaxAction.execute('Stranger');
  assert.deepEqual(clan.banned, ['Stranger']);
  const stranger = player('Stranger');
  hooks.playerOption({ player: owner, target: stranger, option: 6 });
  assert.equal(owner.messages.at(-1), 'Stranger is banned from your clan.');
  owner.syntaxAction.execute('stranger');
  assert.deepEqual(clan.banned, [], 'unban through resume_stringdialog');
});

test('a low rank can\'t use the ban list', () => {
  const { member, clan } = clanOfThree();
  clickGroup(member, 690, 25);
  clickGroup(member, 689, 14);
  assert.match(member.messages.at(-1), /high enough rank/);
  member.syntaxAction.execute('Stranger');
  assert.equal((clan.banned ?? []).length, 0);
});

test('titles open from the settings, take the client\'s edits, and save', () => {
  const { owner, clan } = clanOfThree();
  clickGroup(owner, 690, 24);
  assert.equal(owner.mounted.at(-1), 695);
  assert.equal(owner.configs.get(3023), 24, 'Recruit as rank 0');
  const edit = { player: owner, varpId: 3023, value: 25, handled: false };
  hooks.custom.get('player:varp-transmit')(edit);
  assert.equal(edit.handled, true);
  clickGroup(owner, 695, 13);
  assert.equal(CoreClans().titleSetting(clan, 1), 25);
  assert.equal(owner.mounted.at(-1), 690);
  const other = { player: owner, varpId: 3023, value: 30, handled: false };
  hooks.custom.get('player:varp-transmit')(other);
  assert.equal(other.handled, false, 'no longer editing');
});

test('Rename, Talk and Guests rows work for those allowed', () => {
  const { owner, member, clan } = clanOfThree();
  clickGroup(member, 690, 11);
  assert.match(member.messages.at(-1), /Only the clan's owner/);
  clickGroup(owner, 690, 11);
  owner.syntaxAction.execute('Renamed');
  assert.equal(clan.name, 'Renamed');
  clickGroup(owner, 690, 11);
  assert.match(owner.messages.at(-1), /every 7 days/);
  clickGroup(owner, 690, 16);
  assert.equal(clan.allowGuests, false);
  clickGroup(member, 690, 16);
  assert.equal(clan.allowGuests, false);
  clickGroup(owner, 690, 15);
  owner.amountAction.execute(1);
  assert.equal(clan.talkRank, 0);
});

test('logging in sends last seen and today, as 3886 tick 664', () => {
  const { member, clan } = clanOfThree();
  hooks.logout({ player: member });
  login(member);
  const day = CoreClans().runeDay();
  assert.deepEqual(sent(member, CLAN_SETTINGS_DELTA).at(-1), protocol.encodeClanSettingsDelta(0, clan.updateNum, [
    { type: 'member_extra_info', index: 1, value: day - 6880, startBit: 0, endBit: 12 },
    { type: 'int_setting', setting: 8, value: day },
  ]));
});

// ---------------------------------------------------------------- phase 4: guests

function seek(self, name) {
  clickGroup(self, 702, 10);
  self.syntaxAction.execute(name);
  runTicks(1);
}

const GuestStatus = (self) => self.varbits.get(12164);

test('Find asks as rsprox 76 does, and says when nothing is found', () => {
  const self = player('Guest');
  clickGroup(self, 702, 10);
  assert.deepEqual(self.scripts.at(-1), [110, 'Type the name of a clan to seek:', 7]);
  self.syntaxAction.execute('nothing');
  assert.equal(self.messages.at(-1), 'No clan could be found with that name.');
});

test('finding a clan fetches, brings the tab up, then loads it as the listened clan', () => {
  const { clan } = clanOfThree();
  const self = player('Guest');
  clickGroup(self, 702, 10);
  self.syntaxAction.execute('blur');
  assert.equal(GuestStatus(self), 2);
  assert.equal(self.tab, 7);
  runTicks(1);
  assert.equal(GuestStatus(self), 3);
  assert.equal(self.varbits.get(12168), 1);
  assert.equal(sent(self, CLAN_SETTINGS_FULL).at(-1)[3], 255, 'clan type -1');
  assert.equal(CoreClans().guestClanOf(self), clan);
});

test('a guest chats with /// as type 44 to everyone there, and members see their own type', () => {
  const { owner, member } = clanOfThree();
  const self = player('Guest');
  seek(self, 'Blur');
  clickGroup(self, 702, 8);
  runTicks(3);
  assert.equal(sent(self, CLAN_CHANNEL_FULL).at(-1)[3], 255, 'clan type -1');
  assert.match(sent(self, CLAN_CHANNEL_FULL).at(-1).toString('latin1'), /Owner/);
  assert.deepEqual(sent(owner, CLAN_CHANNEL_DELTA).at(-1), protocol.encodeClanChannelDelta(0, 1, 4, [
    { type: 'add', user: { name: 'Guest', rank: -1, world: 1 } },
  ]));
  const before = chatText(owner).length;
  say(self, 'hello', -1);
  assert.equal(chatText(owner).length, before + 1);
  assert.match(chatText(owner).at(-1), /hello/);
  assert.equal(sent(member, CHAT_MESSAGE).at(-1).toString('latin1').includes('hello'), true);
  assert.equal(sent(self, CHAT_MESSAGE).at(-1).toString('latin1'), protocol.encodeChatMessage('clan', 'hello', 'Guest', 'Blur', self.getIndex(), 44).toString('latin1'), 'a guest hears the guest type');
});

test('guest rules: no guests, banned, levels', () => {
  const { clan } = clanOfThree();
  const self = player('Guest');
  seek(self, 'Blur');
  clan.allowGuests = false;
  clickGroup(self, 702, 8);
  assert.match(self.messages.at(-1), /does not allow guests/);
  clan.allowGuests = true;
  clan.banned = ['guest'];
  clickGroup(self, 702, 8);
  assert.match(self.messages.at(-1), /banned/);
  clan.banned = [];
  CoreClans().setGuestRules(clan, { combat: 50, total: 0, qp: 0, iron: 0 });
  clickGroup(self, 702, 8);
  assert.match(self.messages.at(-1), /combat level of 50/);
});

test('leaving, Discard and logout take the guest out of the channel and view', () => {
  const { owner, clan } = clanOfThree();
  const self = player('Guest');
  seek(self, 'Blur');
  clickGroup(self, 702, 8);
  runTicks(3);
  clickGroup(self, 702, 8);
  assert.deepEqual(sent(self, CLAN_CHANNEL_FULL).at(-1), protocol.encodeClanChannelFull(-1, null));
  runTicks(5);
  clickGroup(self, 702, 10);
  assert.equal(GuestStatus(self), 1);
  assert.deepEqual(sent(self, CLAN_SETTINGS_FULL).at(-1), protocol.encodeClanSettingsFull(-1, null));
  assert.equal(CoreClans().guestClanOf(self), undefined);
  seek(self, 'Blur');
  hooks.logout({ player: self });
  assert.equal(CoreClans().guestClanOf(self), undefined);
  assert.equal(owner.varbits.get(933), 3);
  assert.equal(clan.members.length, 3);
});

test('a clan change reaches who views it, and kick and ban work on guests', () => {
  const { owner, clan } = clanOfThree();
  const self = player('Guest');
  seek(self, 'Blur');
  clickGroup(self, 702, 8);
  runTicks(3);
  CoreClans().setMemberRank(clan, clan.members[1], 10);
  assert.equal(sent(self, CLAN_SETTINGS_DELTA).at(-1)[3], 255);
  const act = (action) => hooks.social[1]({ player: owner, packet: { type: 'clan_channel_action', action, slot: 3, value: 0 }, handled: false });
  act('kick');
  assert.deepEqual(self.notices.at(-1), [46, 'You have been kicked from the channel.']);
  clickGroup(self, 702, 8);
  runTicks(3);
  act('ban');
  assert.deepEqual(clan.banned, ['Guest']);
  assert.deepEqual(sent(self, CLAN_CHANNEL_FULL).at(-1), protocol.encodeClanChannelFull(-1, null));
});

test('a deleted clan leaves its viewers with nothing', () => {
  const { clan } = clanOfThree();
  const self = player('Guest');
  seek(self, 'Blur');
  CoreClans().deleteClan(clan);
  assert.equal(GuestStatus(self), 1);
});

// ---------------------------------------------------------------- applicants and the board

function openGuestInfo(self) {
  clickGroup(self, 702, 9);
}

const pause = (self, groupId, childId, action) => {
  const event = { player: self, groupId, childId, action };
  for (const handler of hooks.clicks) handler(event);
  return event;
};

test('Applicants open with pause flags and empty rows (2778)', () => {
  const { owner } = clanOfThree();
  clickGroup(owner, 690, 21);
  assert.equal(owner.mounted.at(-1), 699);
  assert.deepEqual(owner.scripts.filter((script) => script[0] === 4375).at(-1), [4375, '']);
  assert.equal(owner.scripts.filter((script) => script[0] === 4376).length, 20);
});

test('inviting flips clan_i_am_recruiter for the clan with the captured line (2778)', () => {
  const { owner, member, clan } = clanOfThree();
  pause(owner, 699, 1, 4);
  assert.equal(clan.inviting, true);
  assert.equal(owner.varbits.get(12170), 1);
  assert.equal(member.varbits.get(12170), 1);
  assert.deepEqual(owner.notices.at(-1), [115, "You are now inviting applications to this clan. Remember to turn this option off when you've finished!"]);
  const low = pause(member, 699, 1, 4);
  assert.equal(low.handled, true);
  assert.equal(clan.inviting, true, 'rank 0 cannot');
});

test('a guest applies from Info; the recruiters hear; accept adds them with the captured lines', () => {
  const { owner, clan } = clanOfThree();
  const self = player('Guest');
  self.combat = 87;
  self.total = 1275;
  seek(self, 'Blur');
  openGuestInfo(self);
  assert.equal(self.varbits.get(12165), 1, 'clan_transmit_loadasguest');
  clickGroup(self, 690, 21);
  assert.match(self.messages.at(-1), /not inviting/);
  clan.inviting = true;
  clickGroup(self, 690, 21);
  assert.equal(self.varbits.get(12166), 1);
  assert.equal(owner.messages.at(-1), 'Guest has applied to join your clan.');
  clickGroup(owner, 690, 21);
  assert.deepEqual(owner.scripts.filter((script) => script[0] === 4376).at(-20), [4376, 0, 'Guest']);
  pause(owner, 699, 11, 0);
  assert.deepEqual(owner.scripts.at(-1), [4375, 'Guest|87|1275|1|1']);
  pause(owner, 699, 1, 3);
  assert.equal(owner.messages.at(-1), 'You have accepted Guest into Blur.');
  assert.equal(self.varbits.get(933), 3);
  assert.equal(clan.members.length, 4);
  assert.equal(GuestStatus(self), 1, 'no longer viewing as a guest');
});

test('withdrawing and declining an application', () => {
  const { owner, clan } = clanOfThree();
  const self = player('Guest');
  clan.inviting = true;
  seek(self, 'Blur');
  openGuestInfo(self);
  clickGroup(self, 690, 21);
  clickGroup(self, 690, 21);
  assert.equal(self.varbits.get(12166), 0);
  assert.deepEqual(clan.applicants, []);
  clickGroup(self, 690, 21);
  clickGroup(owner, 690, 21);
  pause(owner, 699, 11, 0);
  pause(owner, 699, 1, 2);
  assert.deepEqual(clan.applicants, []);
  assert.match(self.messages.at(-1), /declined/);
});

test('an application accepted while away adds the member when they are offline', () => {
  const { owner, clan } = clanOfThree();
  clan.inviting = true;
  clan.applicants = [{ account: 'away', name: 'Away', stats: 'Away|3|32' }];
  clickGroup(owner, 690, 21);
  pause(owner, 699, 11, 0);
  pause(owner, 699, 1, 3);
  assert.equal(CoreClans().memberOf(clan, 'away').rank, 0);
});

test('minimums block applying, and the board lists clans that are inviting (2778)', () => {
  const { owner, clan } = clanOfThree();
  clan.inviting = true;
  pause(owner, 699, 1, 5);
  owner.amountAction.execute(90);
  const self = player('Guest');
  seek(self, 'Blur');
  openGuestInfo(self);
  clickGroup(self, 690, 21);
  assert.match(self.messages.at(-1), /combat level of 90/);
  hooks.objects['Clan recruitment board'].View({ player: self });
  assert.equal(self.mounted.at(-1), 700);
  const row = self.scripts.find((script) => script[0] === 4357);
  assert.equal(row[1], 0);
  assert.match(row[2], /^Blur\|3\|0$/);
  clan.inviting = false;
  self.scripts.length = 0;
  hooks.objects['Clan recruitment board'].View({ player: self });
  assert.equal(self.scripts.find((script) => script[0] === 4357)[2], '');
});

test('the board\'s My clan opens Applicants with the captured nudge (2778)', () => {
  const { owner } = clanOfThree();
  pause(owner, 700, 1, 0);
  assert.deepEqual(owner.notices.at(-1), [115, "You should start inviting applications first. Remember to turn this option off when you've finished!"]);
  assert.equal(owner.mounted.at(-1), 699);
  const self = player('Guest');
  pause(self, 700, 1, 0);
  assert.equal(self.messages.at(-1), 'You are not in a clan.');
});

// ---------------------------------------------------------------- broadcasts

test('level-ups are told in live\'s words at the thresholds, to those at the rank', () => {
  const { owner, member, clan } = clanOfThree();
  const skill = { getName: () => 'Cooking' };
  hooks.levelUp({ player: owner, skill, newLevel: 25 });
  assert.equal(member.notices.filter(([, text]) => /Cooking/.test(text)).length, 0, 'below every threshold');
  hooks.levelUp({ player: owner, skill, newLevel: 30 });
  hooks.levelUp({ player: owner, skill, newLevel: 75 });
  assert.deepEqual(member.notices.at(-1), [43, 'Owner has reached Cooking level 75.']);
  clan.permissions = { ...clan.permissions, 30: 100 };
  const before = member.notices.length;
  hooks.levelUp({ player: owner, skill, newLevel: 80 });
  assert.equal(member.notices.length, before, 'not high enough to hear');
  assert.deepEqual(owner.notices.at(-1), [43, 'Owner has reached Cooking level 80.']);
});

test('quests, tasks, log items, drops and PKs are told', () => {
  const { owner, member } = clanOfThree();
  hooks.custom.get('quest:completed')({ player: owner, quest: { name: 'Below Ice Mountain' } });
  assert.deepEqual(member.notices.at(-1), [43, 'Owner has completed a quest: Below Ice Mountain']);
  hooks.custom.get('combat-achievements:completed')({ player: owner, task: { id: 598, name: 'It takes too long', tier: 2 } });
  assert.deepEqual(member.notices.at(-1), [43, 'CA_ID:598|Owner has completed a medium combat task: It takes too long.']);
  hooks.custom.get('collection-log:obtain')({ player: owner, itemId: 7, added: true });
  assert.deepEqual(member.notices.at(-1), [43, 'Owner received a new collection log item: Item 7']);
  const notices = member.notices.length;
  hooks.custom.get('collection-log:obtain')({ player: owner, itemId: 7, added: false });
  assert.equal(member.notices.length, notices);
  const npc = { getDefinition: () => ({ getName: () => 'Artio' }) };
  hooks.custom.get('npc-drops:roll')({ player: owner, npc, drops: [{ itemId: 200000, amount: 2 }, { itemId: 5, amount: 1 }] });
  assert.deepEqual(member.notices.at(-1), [43, 'Owner received a drop: 2 x Item 200000 (400,000 coins) from Artio.']);
  hooks.defeated({ killer: owner, victim: player('Rival') });
  assert.deepEqual(member.notices.at(-1), [43, 'Owner has defeated Rival.']);
});

test('joining and leaving are told to those in the channel', () => {
  const { owner, member, clan } = clanOfThree();
  const late = player('Late');
  CoreClans().addMember(clan, late);
  assert.deepEqual(owner.notices.at(-1), [43, 'Late has joined the clan.']);
  CoreClans().removeMember(clan, 'late');
  assert.deepEqual(member.notices.at(-1), [43, 'Late has left the clan.']);
});
