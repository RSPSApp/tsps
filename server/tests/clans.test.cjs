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
const UNTRADEABLE = 13;

let dir;
let hooks;
let online;
let nextIndex = 1;

function carried(id, amount) {
  return { amount, getId: () => id, getAmount() { return this.amount; } };
}

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
    moveTo: (location) => (self.movedTo = location),
    bag: [],
    getInventory: () => ({
      getItems: () => self.bag,
      getAmount: (id) => self.bag.filter((item) => item.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
      containsNumber: (id) => self.bag.some((item) => item.getId() === id),
      getFreeSlots: () => 28,
      delete(id, amount) {
        const item = self.bag.find((entry) => entry.getId() === id);
        item.amount -= amount;
        if (item.amount <= 0) self.bag.splice(self.bag.indexOf(item), 1);
      },
      adds(id, amount) {
        const item = self.bag.find((entry) => entry.getId() === id);
        if (item) item.amount += amount;
        else self.bag.push(carried(id, amount));
      },
      forceAdd(owner, item) {
        this.adds(item.id, item.amount);
      },
      setItem(slot, item) {
        self.bag[slot] = carried(item.id, item.amount);
      },
      refreshItems: () => {},
    }),
    getEquipment: () => ({
      containsNumber: (id) => self.equipment.includes(id),
      getItems: () => self.equipment.map((id) => carried(id, 1)),
      setItem(slot, item) {
        self.equipment[slot] = item.id;
      },
      refreshItems: () => {},
    }),
    performAnimation: (animation) => (self.animation = animation.id),
    getDialogueManager: () => ({
      isActive: () => false,
      startDialogues(chain) {
        self.dialogue = chain;
      },
    }),
    setEnteredSyntaxAction: (action) => (self.syntaxAction = action),
    setEnteredAmountAction: (action) => (self.amountAction = action),
    getSkillManager: () => ({ getCombatLevel: () => self.combat ?? 3, getTotalLevel: () => self.total ?? 32, getMaxLevel: () => 1, getExperience: () => self.xp ?? 0 }),
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
      sendInterface(group) {
        self.mounted.push(group);
        return this;
      },
      isSubInterfaceOpen: (group) => self.mounted.includes(group),
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
      sendInventory(id, capacity, items) {
        (self.invs ??= {})[id] = items;
        return this;
      },
      sendSound(id) {
        (self.sounds ??= []).push(id);
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
  hooks = { custom: new Map(), commands: new Map(), clicks: [], emitted: [], npc: {}, spawned: [], removed: [], placed: [], ground: [] };
  Clans._reset();
  Clans.register({
    core: {
      ...protocol,
      Task,
      TaskManager,
      PlayerRights,
      ItemIdentifiers: { CLAN_CLOAK: 25712, CLAN_VEXILLUM: 25721, COINS: 995 },
      Skill: { values: () => [{ id: 0 }, { id: 1 }] },
      CacheDefinitions: {
        getEnumValues: (id) => new Map(id === 3799 ? [[0, 500]] : id === 3792 ? [[-1, 'x'], [0, 'F2P'], [5, 'PvP']] : [[-1, 'x'], [0, `A${id}`], [1, `B${id}`]]),
        getStructParams: () => new Map([[1236, (698 << 16) | 9], [1239, 2000]]),
      },
      Boundary: class {
        constructor(...bounds) {
          this.bounds = bounds;
        }
      },
      Location: class {
        constructor(x, y, z) {
          Object.assign(this, { x, y, z });
        }
      },
      Item: class {
        constructor(id, amount) {
          Object.assign(this, { id, amount });
        }
        getAmount() {
          return this.amount;
        }
      },
      PrivateArea: class {
        constructor() {
          this.entities = [];
        }
        enter(mobile) {
          this.add(mobile);
          mobile.area = this;
        }
        add(entity) {
          this.entities.push(entity);
        }
        detach(entity) {
          this.entities = this.entities.filter((other) => other !== entity);
        }
        getPlayers() {
          return this.entities.filter((entity) => entity.getUsername);
        }
        postLeave(mobile) {
          this.detach(mobile);
        }
      },
      GameObject: class {
        constructor(id, location, type, face, area) {
          Object.assign(this, { id, location, type, face, area });
        }
      },
      ObjectManager: {
        register: (object) => hooks.placed.push(object),
        deregister: (object) => (hooks.placed = hooks.placed.filter((other) => other !== object)),
        objectsAt: () => [],
      },
      RegionManager: { blocked: () => false },
      ItemOnGround: class {
        constructor(state, owner, location, item) {
          Object.assign(this, { location, item });
        }
      },
      GroundItemState: { SEEN_BY_EVERYONE: 1 },
      ItemOnGroundManager: { register: (item) => hooks.ground.push(item) },
      Animation: class {
        constructor(id) {
          this.id = id;
        }
      },
      ItemDefinition: { forId: (id) => ({ getName: () => `Item ${id}`, getValue: () => id, isTradeable: () => id !== UNTRADEABLE }) },
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
    onCustomEvent: (name, handler) => {
      const earlier = hooks.custom.get(name);
      hooks.custom.set(name, (event) => {
        earlier?.(event);
        handler(event);
      });
    },
    onPlayerLogout: (handler) => (hooks.logout = handler),
    onSocialPacket: (handler) => (hooks.social = hooks.social ?? []).push(handler),
    onInterfaceActionClick: (handler) => hooks.clicks.push(handler),
    onPlayerOption: (handler) => (hooks.playerOption = handler),
    onNpcInteraction: (name, actions) => (hooks.npc[name] = actions),
    onObjectInteraction: (name, actions) => ((hooks.objects ??= {})[name] = actions),
    onPlayerLevelUp: (handler) => (hooks.levelUp = handler),
    onExperienceGained: (handler) => (hooks.experience = handler),
    spawnNpc: (spot) => {
      const npc = { ...spot };
      hooks.spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => hooks.removed.push(npc),
    onPlayerDeathDrops: (handler) => (hooks.deathDrops = handler),
    persistAttribute: () => {},
    emitCustomEvent: (name, payload) => {
      hooks.emitted.push([name, payload]);
      if (name === 'ironman:mode') payload.mode = payload.player.ironman ?? 'none';
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
  hooks.playerOption({ player: founder, target: other, option: 5 });
  assert.match(other.dialogue.title, /form a clan/);
});

// ---------------------------------------------------------------- recruiting

test('Recruit needs a rank, a place, and a target accepting aid, then adds them as rank 0', () => {
  const owner = player('Owner');
  const recruit = player('Recruit');
  const later = player('Later');
  login(owner);
  assert.deepEqual(owner.option, [5, 'Recruit']);
  createClan(owner);
  recruit.setAttribute('accept-aid', false);
  hooks.playerOption({ player: owner, target: recruit, option: 5 });
  assert.equal(owner.messages.at(-1), 'Recruit is not accepting aid.');
  recruit.setAttribute('accept-aid', true);
  owner.location = { getX: () => 3200, getY: () => 3200, getZ: () => 0 };
  hooks.playerOption({ player: owner, target: recruit, option: 5 });
  assert.match(owner.messages.at(-1), /Clan Hub, or with a clan vexillum/);
  owner.equipment = [25721];
  hooks.playerOption({ player: owner, target: recruit, option: 5 });
  assert.equal(recruit.dialogue.title, 'Join Blur?');
  answer(recruit, 1);
  assert.equal(recruit.varbits.get(933), 3);
  hooks.playerOption({ player: recruit, target: later, option: 5 });
  assert.equal(recruit.messages.at(-1), 'You are not a high enough rank to recruit.');
});

test('Recruit leaves the duel\'s Forfeit alone: slot 6 is neither taken nor written', () => {
  const owner = player('Owner');
  const rival = player('Rival');
  login(owner);
  createClan(owner);
  const forfeit = { player: owner, target: rival, option: 6 };
  hooks.playerOption(forfeit);
  assert.equal(forfeit.handled, undefined);
  assert.deepEqual(owner.messages, []);
  assert.deepEqual(owner.option, [5, 'Recruit'], 'the only option clans ever sends');
});

test('Recruit leaves bots to the bots plugin', () => {
  const owner = player('Owner');
  const event = { player: owner, target: { isPlayerBot: () => true }, option: 5 };
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
  assert.equal(clickGroup(owner, 690, 12).handled, true);
  assert.match(owner.messages.at(-1), /one home world/);
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
  const kick = (who, name) => hooks.social[1]({ player: who, packet: { type: 'clan_channel_action', action: 'kick', name, value: 0 }, handled: false });
  kick(member, 'Owner');
  assert.match(member.messages.at(-1), /high enough rank/);
  kick(owner, 'member');
  assert.deepEqual(member.notices.at(-1), [43, 'You have been kicked from the channel.']);
  assert.deepEqual(sent(member, CLAN_CHANNEL_FULL).at(-1), protocol.encodeClanChannelFull(0, null));
  assert.equal(CoreClans().memberOf(clan, 'member').rank, 0);
  assert.equal(other.varbits.get(933), 3);
});

test('mute silences a member, and members can\'t be banned from the channel', () => {
  const { owner, member, clan } = clanOfThree();
  const act = (who, action, name, value = 0) => hooks.social[1]({ player: who, packet: { type: 'clan_channel_action', action, name, value }, handled: false });
  act(owner, 'mute', 'Member', 1);
  assert.equal(CoreClans().memberOf(clan, 'member').muted, true);
  say(member, 'hello');
  assert.deepEqual(member.notices.at(-1), [43, "You are muted in this clan's channel."]);
  act(owner, 'mute', 'Member', 0);
  assert.equal(CoreClans().memberOf(clan, 'member').muted, false);
  act(owner, 'ban', 'Member');
  assert.match(owner.messages.at(-1), /must be expelled/);
});

test('a channel op whose target has left does nothing to anyone else', () => {
  const { owner, member, other, clan } = clanOfThree();
  CoreClans().removeMember(clan, 'member');
  hooks.social[1]({ player: owner, packet: { type: 'clan_channel_action', action: 'kick', name: 'Member', value: 0 }, handled: false });
  assert.equal(CoreClans().channelOf(other).users.some((user) => user.player === other), true);
  hooks.social[1]({ player: owner, packet: { type: 'clan_channel_action', action: 'mute', name: 'Member', value: 1 }, handled: false });
  assert.equal(CoreClans().memberOf(clan, 'other').muted, false);
  assert.equal(member.varbits.get(933), 1);
});

test('channel action packets carry the name, and an unknown action is no kick', () => {
  const frame = (action) => Buffer.from([181, 6, action, 1, ...Buffer.from('Bob'), 0]);
  assert.deepEqual(protocol.decodeClientPacket(frame(2)), { type: 'clan_channel_action', action: 'mute', name: 'Bob', value: 1 });
  assert.equal(protocol.decodeClientPacket(frame(9)).type, 'raw');
});

test('a channel ban keeps to the cap and adds a name once', () => {
  const { owner, clan } = clanOfThree();
  const guest = () => {
    const self = player('Guest');
    seek(self, 'Blur');
    clickGroup(self, 702, 8);
    runTicks(3);
    return self;
  };
  const self = guest();
  const ban = () => hooks.social[1]({ player: owner, packet: { type: 'clan_channel_action', action: 'ban', name: 'Guest', value: 0 }, handled: false });
  ban();
  assert.deepEqual(clan.banned, ['Guest']);
  assert.equal(CoreClans().guestChannelOf(self), undefined);
  CoreClans().joinGuestChannel(self, clan);
  ban();
  assert.deepEqual(clan.banned, ['Guest'], 'not twice');
  assert.equal(CoreClans().guestChannelOf(self), undefined);
  clan.banned = Array.from({ length: 100 }, (_, i) => `Name${i}`);
  CoreClans().joinGuestChannel(self, clan);
  ban();
  assert.equal(clan.banned.length, 100);
  assert.match(owner.messages.at(-1), /can't hold more than 100/);
});

test('a ban from the screen removes a guest from the channel and the hall', () => {
  const { owner, clan } = clanOfThree();
  const self = player('Guest');
  seek(self, 'Blur');
  clickGroup(self, 702, 8);
  runTicks(3);
  hooks.objects['Clan hall portal']['Enter-guest']({ player: self });
  assert.ok(self.area);
  clickGroup(owner, 690, 25);
  clickGroup(owner, 689, 14);
  owner.syntaxAction.execute('Guest');
  assert.deepEqual(clan.banned, ['Guest']);
  assert.equal(CoreClans().guestChannelOf(self), undefined);
  assert.deepEqual([self.movedTo.x, self.movedTo.y], [3185, 3470]);
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
  hooks.playerOption({ player: owner, target: stranger, option: 5 });
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
  const act = (action) => hooks.social[1]({ player: owner, packet: { type: 'clan_channel_action', action, name: 'Guest', value: 0 }, handled: false });
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
  assert.match(row[2], /^Blur\|3\|\d\d-[A-Z][a-z]{2}-20\d\d\|\d+\|No interests listed\|90\|0$/);
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
  pause(self, 700, 1, 2);
  assert.equal(self.mounted.at(-1), 700, 'Refresh');
  pause(owner, 700, 1, 1);
  assert.equal(owner.mounted.at(-1), 699, 'Applicants');
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

test('quests, tasks, log items, drops and PKs are told', async () => {
  const { owner, member } = clanOfThree();
  hooks.custom.get('quest:completed')({ player: owner, quest: { name: 'Below Ice Mountain' } });
  assert.deepEqual(member.notices.at(-1), [43, 'Owner has completed a quest: Below Ice Mountain']);
  hooks.custom.get('combat-achievements:completed')({ player: owner, task: { id: 598, name: 'It takes too long', tier: 2 } });
  assert.deepEqual(member.notices.at(-1), [43, 'CA_ID:598|Owner has completed a medium combat task: It takes too long.']);
  hooks.custom.get('collection-log:new-item')({ player: owner, itemId: 7 });
  assert.deepEqual(member.notices.at(-1), [43, 'Owner received a new collection log item: Item 7']);
  const npc = { getDefinition: () => ({ getName: () => 'Artio' }) };
  hooks.custom.get('npc-drops:roll')({ player: owner, npc, drops: [{ itemId: 200000, amount: 2 }, { itemId: 5, amount: 1 }] });
  await null;
  assert.deepEqual(member.notices.at(-1), [43, 'Owner received a drop: 2 x Item 200000 (400,000 coins) from Artio.']);
  const lost = (id) => [{ getId: () => id, getAmount: () => 1 }];
  hooks.deathDrops({ killer: owner, player: player('Rival'), items: lost(200000), untradeables: [] });
  assert.deepEqual(member.notices.at(-1), [43, 'Owner has defeated Rival and received (200,000 coins) worth of loot!']);
});

test('drops a handler edits away are never told', async () => {
  const { owner, member } = clanOfThree();
  const heard = member.notices.length;
  const roll = { player: owner, drops: [{ itemId: 200000, amount: 1 }] };
  hooks.custom.get('npc-drops:roll')(roll);
  roll.drops.length = 0; // as modes/FreeToPlay and Soul Wars' Tutorial do, after this listener
  await null;
  assert.equal(member.notices.length, heard);
});

test('a task caught up at login is not told, and a PK under the value row is not either', () => {
  const { owner, member, clan } = clanOfThree();
  const heard = member.notices.length;
  hooks.custom.get('combat-achievements:completed')({ player: owner, silent: true, task: { id: 598, name: 'It takes too long', tier: 2 } });
  assert.equal(member.notices.length, heard);
  const lost = (id) => [{ getId: () => id, getAmount: () => 1 }];
  hooks.deathDrops({ killer: owner, player: player('Rival'), items: lost(99999), untradeables: [] });
  assert.equal(member.notices.length, heard, 'under the 100,000 default');
  CoreClans().setSettingValue(clan, 65, 50);
  hooks.deathDrops({ killer: owner, player: player('Rival2'), items: lost(50), untradeables: [] });
  assert.match(member.notices.at(-1)[1], /defeated Rival2/);
  const told = member.notices.length;
  hooks.deathDrops({ killer: { getId: () => 1 }, player: owner, items: lost(200000), untradeables: [] });
  assert.equal(member.notices.length, told, 'an npc kill is no PK');
});

test('joining and leaving are told to those in the channel', () => {
  const { owner, member, clan } = clanOfThree();
  const late = player('Late');
  CoreClans().addMember(clan, late);
  assert.deepEqual(owner.notices.at(-1), [43, 'Late has joined the clan.']);
  CoreClans().removeMember(clan, 'late');
  assert.deepEqual(member.notices.at(-1), [43, 'Late has left the clan.']);
});

// ---------------------------------------------------------------- Clan Hall and coffer

function pocket(self, coins) {
  const held = { coins };
  self.getInventory = () => ({
    getAmount: () => held.coins,
    getFreeSlots: () => 28,
    delete: (id, amount) => (held.coins -= amount),
    adds: (id, amount) => (held.coins += amount),
  });
  return held;
}

test('the hall portal takes members and guests to their clan\'s own hall, and the exit back', () => {
  const { owner, member, clan } = clanOfThree();
  const portal = hooks.objects['Clan hall portal'];
  portal.Enter({ player: owner });
  assert.deepEqual([owner.movedTo.x, owner.movedTo.y, owner.movedTo.z], [1759, 5486, 0]);
  portal['Enter-member']({ player: member });
  assert.equal(owner.area, member.area, 'the same private hall');
  const stranger = player('Stranger');
  portal.Enter({ player: stranger });
  assert.equal(stranger.messages.at(-1), 'You are not in a clan.');
  portal['Enter-guest']({ player: stranger });
  assert.match(stranger.messages.at(-1), /as a guest/);
  seek(stranger, 'Blur');
  portal['Enter-guest']({ player: stranger });
  assert.equal(stranger.area, owner.area);
  clan.permissions = { ...clan.permissions, 23: 0 };
  const other = player('Other2');
  seek(other, 'Blur');
  portal['Enter-guest']({ player: other });
  assert.match(other.messages.at(-1), /high enough rank/);
  assert.equal(hooks.objects.Portal.Leave({ player: owner, objectId: 1 }), false, 'another portal');
  assert.equal(hooks.objects.Portal.Leave({ player: owner, objectId: 41617 }), true);
  assert.deepEqual([owner.movedTo.x, owner.movedTo.y], [3185, 3470]);
  owner.area.postLeave(owner, true);
});

test('each clan has its own hall', () => {
  const a = player('Aye');
  const b = player('Bee');
  createClan(a, 'Aye Clan');
  createClan(b, 'Bee Clan');
  hooks.objects['Clan hall portal'].Enter({ player: a });
  hooks.objects['Clan hall portal'].Enter({ player: b });
  assert.notEqual(a.area, b.area);
});

test('the coffer moves coins by rank, and every member hears the new total through varclan 3', () => {
  const { owner, member, clan } = clanOfThree();
  const coffer = hooks.objects['Clan Coffer'].Use;
  const held = pocket(owner, 5000);
  inHall(owner, member);
  coffer({ player: owner });
  assert.deepEqual(owner.mounted.slice(-2), [696, 697]);
  clickGroup(owner, 697, 9);
  owner.amountAction.execute(2000);
  assert.equal(clan.coffer, 2000);
  assert.equal(held.coins, 3000);
  assert.deepEqual(sent(member, 128).at(-1), protocol.encodeClanVar(3, 2000));
  clickGroup(owner, 696, 8);
  assert.equal(clan.coffer, 1000);
  assert.equal(held.coins, 4000);
  assert.match(member.messages.at(-1), /Owner has withdrawn 1,000 coins/);
  clickGroup(owner, 696, 12);
  assert.equal(clan.coffer, 0);
  clickGroup(owner, 696, 7);
  assert.equal(owner.messages.at(-1), 'The coffer is empty.');
  pocket(member, 10);
  clan.coffer = 500;
  coffer({ player: member });
  clickGroup(member, 696, 7);
  assert.match(member.messages.at(-1), /high enough rank to withdraw/);
  assert.equal(JSON.parse(fs.readFileSync(process.env.TSPS_CLANS_FILE, 'utf8')).clans[0].coffer !== undefined, true);
  const outsider = player('Outsider');
  coffer({ player: outsider });
  assert.match(outsider.messages.at(-1), /Only members/);
});

test('coffer buttons do nothing away from the hall, or with the screen shut', () => {
  const { owner, clan } = clanOfThree();
  const held = pocket(owner, 5000);
  clan.coffer = 1000;
  clickGroup(owner, 697, 6);
  clickGroup(owner, 696, 8);
  assert.equal(held.coins, 5000, 'a crafted click, anywhere in the world');
  inHall(owner);
  clickGroup(owner, 696, 8);
  assert.equal(held.coins, 5000, 'in the hall, screen never opened');
  hooks.objects['Clan Coffer'].Use({ player: owner });
  clickGroup(owner, 696, 11);
  const prompt = owner.amountAction;
  owner.mounted = [];
  prompt.execute(10);
  assert.equal(held.coins, 5000, 'answering after it shut');
});

test('standing in another clan\'s hall gets no use of either clan\'s coffer', () => {
  const { owner, clan } = clanOfThree();
  const rival = player('Rival');
  createClan(rival, 'Rivals');
  const rivals = StoreClans().byName('Rivals');
  rivals.coffer = 500;
  clan.coffer = 500;
  const held = pocket(rival, 0);
  seek(rival, 'Blur');
  hooks.objects['Clan hall portal']['Enter-guest']({ player: rival });
  hooks.objects['Clan Coffer'].Use({ player: rival });
  assert.match(rival.messages.at(-1), /Only members/);
  rival.mounted.push(696);
  clickGroup(rival, 696, 12);
  assert.equal(held.coins, 0);
  assert.equal(clan.coffer, 500);
  assert.equal(rivals.coffer, 500);
  assert.ok(owner);
});

test('an Ironman can\'t withdraw either', () => {
  const { owner, clan } = clanOfThree();
  const held = pocket(owner, 0);
  clan.coffer = 1000;
  inHall(owner);
  hooks.objects['Clan Coffer'].Use({ player: owner });
  owner.ironman = 'ultimate';
  clickGroup(owner, 696, 12);
  assert.match(owner.messages.at(-1), /Ironmen can't withdraw/);
  assert.equal(clan.coffer, 1000);
  assert.equal(held.coins, 0);
});

test('a clans file that can\'t be read is kept, and throws rather than reads as empty', () => {
  const { clan } = clanOfThree();
  assert.ok(clan);
  const file = process.env.TSPS_CLANS_FILE;
  const store = StoreClans();
  fs.writeFileSync(file, '{"nextKey": 2, "clans": [{"key"');
  store.reset();
  assert.throws(() => store.all(), SyntaxError);
  assert.throws(() => store.all(), SyntaxError, 'not an empty map the second time');
  assert.throws(() => store.save(), SyntaxError);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"nextKey": 2, "clans": [{"key"');
  fs.writeFileSync(file, '{"nextKey": 2}');
  store.reset();
  assert.throws(() => store.all(), TypeError, 'nor when it parses without clans');
  fs.rmSync(file);
  store.reset();
});

test('removing someone not in the clan removes nobody', () => {
  const { owner, member, clan } = clanOfThree();
  const before = clan.members.length;
  const heard = owner.notices.length;
  CoreClans().removeMember(clan, 'nobody');
  assert.equal(clan.members.length, before);
  assert.equal(owner.notices.length, heard);
  clickGroup(member, 690, 26);
  const leaving = member.dialogue;
  CoreClans().removeMember(clan, 'member');
  member.dialogue = leaving;
  answer(member, 1);
  assert.equal(clan.members.length, before - 1, 'expelled under the Leave? prompt, and nobody else goes');
  assert.ok(CoreClans().ownerOf(clan));
  assert.equal(member.messages.some((text) => /You have left/.test(text)), false);
});

test('only the owner can start or cancel a resignation', () => {
  const { owner, member, clan } = clanOfThree();
  clickGroup(member, 690, 13);
  assert.match(member.messages.at(-1), /Only the clan's owner/);
  assert.equal(member.dialogue, undefined);
  clickGroup(owner, 690, 13);
  answer(owner, 1);
  assert.ok(clan.resignDueAt > 0);
  clickGroup(member, 690, 13);
  assert.ok(clan.resignDueAt > 0, 'nor stop it');
  clickGroup(owner, 690, 13);
  assert.equal(clan.resignDueAt, 0);
});

test('a rank popup\'s answer is checked: range, the row\'s minimum, and real ranks', () => {
  const { owner, clan } = clanOfThree();
  clickGroup(owner, 690, 15);
  owner.amountAction.execute(201); // rank 200
  assert.equal(clan.talkRank, -1, 'above their own rank would mute even the owner');
  clickGroup(owner, 690, 15);
  owner.amountAction.execute(8); // rank 7, which isn't one
  assert.equal(clan.talkRank, -1);
  clickGroup(owner, 690, 15);
  owner.amountAction.execute(11); // rank 10
  assert.equal(clan.talkRank, 10);
  const PERMISSIONS = require('../plugins/interface/clans/data/permissions.json');
  const row = PERMISSIONS.find((entry) => entry.minRank === 100 && entry.setting !== null && !entry.special);
  const permission = () => hooks.clicks.forEach((handler) => handler({ player: owner, groupId: 706, childId: 12, slot: PERMISSIONS.indexOf(row) }));
  permission();
  owner.amountAction.execute(51); // rank 50, under the row's minimum
  assert.equal(CoreClans().permissionRank(clan, row.setting), 100);
  permission();
  owner.amountAction.execute(102); // rank 101, the minimum or over
  assert.equal(CoreClans().permissionRank(clan, row.setting), 101);
});

test('an online applicant isn\'t accepted past the member cap, and stays an applicant', () => {
  const { owner, clan } = clanOfThree();
  const Guests = require('../plugins/interface/clans/Guests.Clans');
  const hopeful = player('Hopeful');
  clan.inviting = true;
  seek(hopeful, 'Blur');
  Guests.toggleApplication(hopeful, clan);
  clan.members.push(...Array.from({ length: 500 - clan.members.length }, (_, i) => ({ account: `m${i}`, name: `M${i}`, rank: 0 })));
  clickGroup(owner, 690, 21);
  for (const handler of hooks.clicks) handler({ player: owner, groupId: 699, childId: 11, action: 0 });
  for (const handler of hooks.clicks) handler({ player: owner, groupId: 699, childId: 1, action: 3 });
  assert.equal(owner.messages.at(-1), 'Your clan is full.');
  assert.equal(clan.members.length, 500);
  assert.equal(clan.applicants.length, 1);
});

test('a hall that refuses its visitor spawns nothing', () => {
  const { owner, clan } = clanOfThree();
  clan.hall = { locked: true, players: 10, theme: 0 };
  inHall(owner);
  assert.match(owner.messages.at(-1), /locked/);
  assert.equal(hooks.spawned.length, 0);
});

test('an event is edited and deleted as listed, whatever another organiser did since', () => {
  const { owner, member, clan } = clanOfThree();
  const event = (creator) => ({ world: 1, type: 0, activity: 0, subtype: 0, date: 9000, duration: 1, time: 720, rank: -1, creator });
  clan.events = [event('First'), event('Second'), event('Third')];
  clan.permissions = { ...clan.permissions, 21: 0 };
  const row = (self, slot) => hooks.clicks.forEach((handler) => handler({ player: self, groupId: 703, childId: 9, slot }));
  clickGroup(owner, 690, 19);
  clickGroup(member, 690, 19);
  row(member, 2); // Third, on member's list
  clickGroup(owner, 703, 9);
  row(owner, 0);
  clickGroup(owner, 704, 24); // owner deletes First: Third is at slot 1 now
  assert.deepEqual(clan.events.map((each) => each.creator), ['Second', 'Third']);
  clickGroup(member, 704, 24);
  assert.deepEqual(clan.events.map((each) => each.creator), ['Second'], 'Third, as they chose, not by its old slot');
  clan.events = [event('A'), event('B')];
  clickGroup(owner, 690, 19);
  clickGroup(member, 690, 19);
  row(owner, 1);
  clickGroup(owner, 704, 24);
  row(member, 1); // B has gone from under their list
  assert.match(member.messages.at(-1), /Another organiser/);
  assert.deepEqual(clan.events.map((each) => each.creator), ['A']);
});

// ---------------------------------------------------------------- the last screens

test('interests toggle on the server, save on submit (1), and cancel (0) drops them', () => {
  const { owner, member, clan } = clanOfThree();
  const interest = (who, slot) => { for (const handler of hooks.clicks) handler({ player: who, groupId: 691, childId: 7, slot }); };
  clickGroup(member, 690, 14);
  assert.match(member.messages.at(-1), /high enough rank/);
  clickGroup(owner, 690, 14);
  assert.equal(owner.mounted.at(-1), 691);
  assert.deepEqual(owner.scripts.at(-1), [4263, (690 << 16) | 27]);
  interest(owner, 5);
  assert.equal(owner.configs.get(3023), 32);
  owner.amountAction.execute(0);
  assert.equal(CoreClans().settingValue(clan, 7), 0, 'cancelled');
  clickGroup(owner, 690, 14);
  interest(owner, 5);
  interest(owner, 0);
  owner.amountAction.execute(1);
  assert.equal(CoreClans().settingValue(clan, 7), 33);
  assert.match(owner.scripts.filter((script) => script[0] === 4290).at(-3)[1], /F2P.*PvP/);
});

test('board filters mark wanted, then unwanted, then neither, and filter the rows', () => {
  const { owner, clan } = clanOfThree();
  clan.inviting = true;
  clan.values = { ...clan.values, 7: 1 };
  hooks.objects['Clan recruitment board'].View({ player: owner });
  const rows = () => owner.scripts.filter((script) => script[0] === 4357).slice(-45);
  assert.match(rows()[0][2], /^Blur/);
  pause(owner, 700, 5, 5);
  assert.equal(owner.configs.get(807), 32);
  assert.equal(rows()[0][2], '', 'wants PvP');
  pause(owner, 700, 5, 5);
  assert.equal(owner.configs.get(808), 32);
  assert.match(rows()[0][2], /^Blur/);
  pause(owner, 700, 5, 0);
  pause(owner, 700, 5, 0);
  assert.equal(rows()[0][2], '', 'doesn\'t want F2P');
  pause(owner, 700, 1, 3);
  assert.deepEqual([owner.configs.get(807), owner.configs.get(808)], [0, 0], 'Reset');
  assert.match(rows()[0][2], /^Blur/);
});

test('the outfit saves the value script 4432 answers with', () => {
  const { owner, member, clan } = clanOfThree();
  clickGroup(member, 690, 5);
  assert.match(member.messages.at(-1), /high enough rank/);
  clickGroup(owner, 690, 5);
  assert.equal(owner.mounted.at(-1), 694);
  assert.equal(owner.configs.get(3023), 1049601);
  owner.amountAction.execute(2100000);
  assert.equal(CoreClans().settingValue(clan, 11), 2100000);
});

function formField(self, childId, ...answers) {
  clickGroup(self, 704, childId);
  for (const answer of answers) {
    if (self.dialogue) { const open = self.dialogue; self.dialogue = null; open.handler.executeOption(answer); }
    else if (typeof answer === 'string') self.syntaxAction.execute(answer);
    else self.amountAction.execute(answer);
  }
}

test('an event is created through the form, listed, edited and deleted', () => {
  const { owner, member, clan } = clanOfThree();
  clickGroup(member, 690, 19);
  clickGroup(member, 703, 5);
  assert.match(member.messages.at(-1), /organise events/);
  clickGroup(owner, 690, 19);
  assert.equal(owner.mounted.at(-1), 703);
  clickGroup(owner, 703, 5);
  assert.equal(owner.mounted.at(-1), 704);
  assert.equal(owner.varbits.get(12224), 0);
  formField(owner, 9, 2);
  assert.equal(owner.varbits.get(12219), 1);
  formField(owner, 7, 45);
  assert.equal(owner.varbits.get(12221), CoreClans().runeDay() + 30, 'no further than 30 days');
  formField(owner, 19, 0);
  assert.equal(owner.varbits.get(12222), 1);
  formField(owner, 17, 330);
  assert.equal(owner.varbits.get(12216), 330);
  formField(owner, 12, 'nope');
  assert.match(owner.messages.at(-1), /HH:MM/);
  formField(owner, 12, '18:30');
  assert.equal(owner.varbits.get(12223), 1110);
  formField(owner, 21, 101);
  assert.equal(owner.varbits.get(10986), 101);
  clickGroup(owner, 704, 23);
  assert.equal(clan.events.length, 1);
  assert.equal(owner.mounted.at(-1), 703);
  const row = owner.scripts.filter((script) => script[0] === 4407).at(-10);
  assert.deepEqual(row.slice(1, 4), [0, 1, 100]);
  clan.events[0].rank = 100;
  clickGroup(member, 690, 19);
  assert.equal(member.scripts.filter((script) => script[0] === 4407).at(-10)[5], '', 'above their rank');
  assert.match(row[5], /\|18:30\|1\|330\|/);
  assert.match(row[5], /\|Owner$/);
  clickGroup(owner, 703, 6);
  assert.equal(owner.varbits.get(12200), 1, 'Edit mode');
  for (const handler of hooks.clicks) handler({ player: owner, groupId: 703, childId: 9, slot: 0 });
  assert.equal(owner.varbits.get(12224), 1);
  formField(owner, 17, 331);
  clickGroup(owner, 704, 23);
  assert.equal(clan.events[0].world, 331);
  for (const handler of hooks.clicks) handler({ player: owner, groupId: 703, childId: 9, slot: 0 });
  clickGroup(owner, 704, 24);
  assert.deepEqual(clan.events, []);
  assert.equal(JSON.parse(fs.readFileSync(process.env.TSPS_CLANS_FILE, 'utf8')).clans[0].events.length, 0);
});

test('hall settings take the client\'s edits, and lock and cap the hall', () => {
  const { owner, member, clan } = clanOfThree();
  clickGroup(member, 690, 22);
  assert.equal(member.varbits.get(12200), 0, 'read only');
  clickGroup(member, 692, 5);
  assert.equal(clan.hall, undefined);
  clickGroup(owner, 690, 22);
  assert.equal(owner.mounted.at(-1), 692);
  assert.equal(owner.varbits.get(12200), 1);
  assert.equal(owner.configs.get(3027), 2000 << 2);
  const edit = { player: owner, varpId: 3027, value: (1 << 1) | (2 << 2) | (3 << 13), handled: false };
  hooks.custom.get('player:varp-transmit')(edit);
  assert.equal(edit.handled, true);
  clickGroup(owner, 692, 5);
  assert.deepEqual(clan.hall, { locked: true, players: 2, theme: 3 });
  assert.equal(owner.mounted.at(-1), 690);
  const portal = hooks.objects['Clan hall portal'].Enter;
  portal({ player: member });
  assert.equal(member.messages.at(-1), "This clan's hall is locked.");
  clan.hall.locked = false;
  clan.hall.players = 1;
  portal({ player: owner });
  portal({ player: member });
  assert.equal(member.messages.at(-1), "This clan's hall is full.");
});

test('all eight title settings are sent, and ranks 96-124 save', () => {
  const { owner, clan } = clanOfThree();
  clickGroup(owner, 690, 24);
  const edit = { player: owner, varpId: 736, value: 77, handled: false };
  hooks.custom.get('player:varp-transmit')(edit);
  clickGroup(owner, 695, 13);
  assert.equal(CoreClans().titleSetting(clan, 103), 77);
});

// ---------------------------------------------------------------- the coffer's limits, guest rules

test('an Ironman can\'t deposit, and no transaction moves over 50m', () => {
  const { owner, clan } = clanOfThree();
  const held = pocket(owner, 60000000);
  inHall(owner);
  hooks.objects['Clan Coffer'].Use({ player: owner });
  owner.ironman = 'ironman';
  clickGroup(owner, 697, 10);
  assert.match(owner.messages.at(-1), /Ironmen can't deposit/);
  assert.equal(clan.coffer ?? 0, 0);
  owner.ironman = 'none';
  clickGroup(owner, 697, 10);
  assert.equal(clan.coffer, 50000000);
  assert.equal(held.coins, 10000000);
  clan.coffer = 70000000;
  clickGroup(owner, 696, 12);
  assert.equal(clan.coffer, 20000000);
});

test('guests need the clan\'s quest points and account type', () => {
  const { clan } = clanOfThree();
  const core = CoreClans();
  const guest = player('Guesting');
  core.setGuestRules(clan, { ...core.guestRules(clan), qp: 10 });
  const Guests = require('../plugins/interface/clans/Guests.Clans');
  assert.match(Guests.guestRefusal(guest, clan), /10 quest points/);
  guest.attributes.set('quest.points', 10);
  assert.equal(Guests.guestRefusal(guest, clan), null);
  core.setGuestRules(clan, { ...core.guestRules(clan), iron: 1 });
  assert.match(Guests.guestRefusal(guest, clan), /account type/);
  guest.ironman = 'hardcore';
  assert.equal(Guests.guestRefusal(guest, clan), null);
  core.setGuestRules(clan, { ...core.guestRules(clan), iron: 2 });
  assert.match(Guests.guestRefusal(guest, clan), /account type/);
  guest.ironman = 'ultimate';
  assert.equal(Guests.guestRefusal(guest, clan), null);
});

// ---------------------------------------------------------------- the remaining broadcasts

function noticesOf(self) {
  return self.notices.map(([, text]) => text);
}

test('personal bests, diaries, hardcore deaths and loot keys reach the channel by their own events', () => {
  const { owner, member, clan } = clanOfThree();
  hooks.custom.get('boss:personal-best')({ player: owner, boss: 'Zulrah', ticks: 100 });
  assert.equal(noticesOf(member).at(-1), 'Owner has achieved a new Zulrah personal best: 1:00');
  hooks.custom.get('diary:tier-complete')({ player: owner, diary: 'Varrock', tier: 'Hard' });
  assert.equal(noticesOf(member).at(-1), 'Owner has completed the Hard Varrock diary.');
  hooks.custom.get('ironman:hardcore-death')({ player: owner });
  assert.match(noticesOf(member).at(-1), /Owner has died as a Hardcore/);
  const told = member.notices.length;
  hooks.custom.get('loot-keys:opened')({ player: owner, value: 99999 });
  assert.equal(member.notices.length, told, 'under the minimum value');
  hooks.custom.get('loot-keys:opened')({ player: owner, value: 100000 });
  assert.match(noticesOf(member).at(-1), /Owner has opened a loot key worth 100,000 coins/);
  hooks.custom.get('boss:personal-best')({ player: player('Stranger'), boss: 'Zulrah', ticks: 100 });
  assert.equal(clan.members.length, 3);
});

test('post-99 XP tells each multiple of the interval, and only past 99', () => {
  const { owner, member, clan } = clanOfThree();
  const skill = { getName: () => 'Ranged' };
  const gain = (after, experience) => {
    owner.xp = after;
    hooks.experience({ player: owner, skill, experience });
  };
  const told = () => member.notices.length;
  const before = told();
  gain(5000000, 10000000);
  assert.equal(told(), before, 'below 99');
  gain(14000000, 100);
  assert.equal(told(), before, 'no multiple crossed');
  gain(15000100, 1000);
  assert.equal(noticesOf(member).at(-1), 'Owner has reached 15,000,000 XP in Ranged.');
  CoreClans().setSettingValue(clan, 69, 10);
  gain(19000000, 5000000);
  assert.equal(told(), before + 1, 'the interval is now 10m');
  gain(20000000, 1000000);
  assert.equal(noticesOf(member).at(-1), 'Owner has reached 20,000,000 XP in Ranged.');
});

test('total and combat levels are told when they cross a mark', () => {
  const { owner, member } = clanOfThree();
  owner.combat = 91;
  login(owner);
  const skill = { getName: () => 'Attack' };
  owner.combat = 92;
  owner.total = 1875;
  hooks.levelUp({ player: owner, skill, oldLevel: 50, newLevel: 51 });
  const said = noticesOf(member);
  assert.ok(said.includes('Owner has reached a total level of 1875.'));
  assert.ok(said.includes('Owner has reached combat level 92.'));
});

// ---------------------------------------------------------------- cloak and vexillum colours

/** Colour is the outfit setting's bits 20-29, one above its index. */
const motif = (colour) => colour << 20;

test('the Clerk hands out the clan\'s colour, and a new motif or a login changes what members hold', () => {
  const { owner, clan } = clanOfThree();
  CoreClans().setSettingValue(clan, 11, motif(4));
  hooks.npc.Clerk.Items({ player: owner, npcId: CLERK });
  assert.deepEqual(owner.bag.map((item) => item.getId()), [25716, 25725]);
  owner.equipment = [25712];
  CoreClans().setSettingValue(clan, 11, motif(8));
  login(owner);
  assert.deepEqual(owner.bag.map((item) => item.getId()), [25720, 25729]);
  assert.deepEqual(owner.equipment, [25720]);
});

test('any colour of vexillum recruits away from the hub', () => {
  const { owner } = clanOfThree();
  owner.location = { getX: () => 3000, getY: () => 3000, getZ: () => 0 };
  owner.equipment = [25725];
  const target = player('Target');
  hooks.playerOption({ player: owner, target, option: 5 });
  assert.equal(target.dialogue.title, 'Join Blur?');
});

// ---------------------------------------------------------------- Clan Hall contents

function inHall(...players) {
  for (const self of players) hooks.objects['Clan hall portal'].Enter({ player: self });
}

/** A real client's op arrives as `action`; only the agent MCP's packets fill in opId. */
function op(self, groupId, childId, slot, action) {
  const event = { player: self, groupId, childId, slot, action };
  for (const handler of hooks.clicks) handler(event);
  return event;
}

const CHEST = 46248;
const CHEST_INV = 916 + 32768; // read with invother_getobj
const openChest = (self) => hooks.objects.Chest.Open({ player: self, objectId: CHEST });

test('the party chest offers on 266 and 783, and only Confirm commits', () => {
  const { owner, member } = clanOfThree();
  inHall(owner, member);
  owner.bag.push(carried(4151, 1), carried(995, 100), carried(UNTRADEABLE, 1));
  assert.equal(openChest(owner), true);
  assert.deepEqual(owner.mounted.slice(-2), [783, 266]);
  op(owner, 266, 0, 0, 2);
  op(owner, 266, 0, 0, 5);
  assert.deepEqual(owner.invs[92].slice(0, 2), [{ id: 4151, amount: 1 }, { id: 995, amount: 100 }]);
  assert.equal(owner.bag.length, 1);
  op(owner, 266, 0, 0, 2);
  assert.match(owner.messages.at(-1), /can't go in the chest/);
  op(owner, 783, 16, 0, 2);
  assert.equal(owner.bag.at(-1).getId(), 4151, 'taken back');
  assert.deepEqual(owner.invs[92][0], { id: 995, amount: 100 });
  op(owner, 783, 17);
  assert.deepEqual(owner.invs[CHEST_INV][0], { id: 995, amount: 100 });
  assert.equal(owner.invs[92][0], null);
  op(owner, 266, 0, 1, 2);
  hooks.custom.get('interface:closed')({ player: owner, interfaceId: 783 });
  assert.equal(owner.area.chest.length, 1, 'unconfirmed stays out of the chest');
  assert.equal(owner.bag.some((item) => item.getId() === 4151), true, 'and back in the pack');
});

test('an offer always comes back: reopening, another screen over it, leaving, a full pack', () => {
  const { owner } = clanOfThree();
  inHall(owner);
  const has = () => owner.bag.some((item) => item.getId() === 4151);
  const offerWhip = () => {
    openChest(owner);
    op(owner, 266, 0, owner.bag.findIndex((item) => item.getId() === 4151), 2);
    assert.equal(has(), false);
  };
  owner.bag.push(carried(4151, 1));
  offerWhip();
  openChest(owner);
  assert.equal(has(), true, 'the chest clicked again');
  offerWhip();
  hooks.custom.get('interface:opened')({ player: owner, targetUid: (161 << 16) | 16, groupId: 12 });
  assert.equal(has(), true, 'another modal mounted over it');
  offerWhip();
  owner.area.postLeave(owner, false);
  assert.equal(has(), true, 'teleported out of the hall');
  inHall(owner);
  offerWhip();
  hooks.logout({ player: owner });
  assert.equal(has(), true, 'logged out');
});

test('offer and confirm packets do nothing once the screen has gone', () => {
  const { owner } = clanOfThree();
  inHall(owner);
  owner.bag.push(carried(995, 100), carried(4151, 1));
  openChest(owner);
  op(owner, 266, 0, 0, 2);
  owner.mounted = [];
  op(owner, 783, 17);
  assert.equal(owner.area.chest.length, 0, 'confirm');
  assert.equal(owner.bag.find((item) => item.getId() === 995).getAmount(), 100, 'and the offer went back');
  op(owner, 266, 0, 0, 2);
  assert.equal(owner.bag.find((item) => item.getId() === 995).getAmount(), 100, 'offer');
});

test('the chest holds a stack up to the most a stack can be, and refuses past it', () => {
  const { owner, member } = clanOfThree();
  inHall(owner, member);
  owner.area.chest.push({ id: 995, amount: 2147483000 });
  member.bag.push(carried(995, 1000));
  openChest(member);
  hooks.custom.get('player:varp-transmit')({ player: member, varpId: 675, value: 2 << 14 });
  op(member, 266, 0, 0, 1);
  op(member, 783, 17);
  assert.match(member.messages.at(-1), /can't hold any more/);
  assert.equal(owner.area.chest[0].amount, 2147483000);
});

test('the piano forgets a player who has gone', () => {
  const { owner, member } = clanOfThree();
  inHall(owner, member);
  hooks.objects.Piano.Entertain({ player: owner });
  op(owner, 698, 9);
  assert.equal(member.sounds.length, 1);
  hooks.logout({ player: owner });
  op(owner, 698, 9);
  assert.equal(member.sounds.length, 1, 'logout');
  hooks.objects.Piano.Entertain({ player: owner });
  hooks.custom.get('interface:closed')({ player: owner, interfaceId: 698 });
  op(owner, 698, 9);
  assert.equal(member.sounds.length, 1, 'closed by walking off');
});

test('the chest is refused below its rank, and elsewhere is not ours', () => {
  const { owner, member, clan } = clanOfThree();
  assert.equal(openChest(owner), false, 'not in a hall');
  inHall(member);
  clan.permissions = { ...clan.permissions, 94: 127 };
  assert.equal(openChest(member), true);
  assert.match(member.messages.at(-1), /high enough rank/);
  assert.equal(hooks.objects.Chest.Open({ player: member, objectId: 1 }), false, 'another chest');
});

test('the op on the offer uses the screen\'s chosen quantity, and X prompts', () => {
  const { owner } = clanOfThree();
  inHall(owner);
  owner.bag.push(carried(995, 100));
  openChest(owner);
  hooks.custom.get('player:varp-transmit')({ player: owner, varpId: 675, value: 1 << 14 });
  op(owner, 266, 0, 0, 1);
  assert.equal(owner.invs[92][0].amount, 5);
  hooks.custom.get('player:varp-transmit')({ player: owner, varpId: 675, value: 2 << 14 });
  op(owner, 266, 0, 0, 1);
  assert.equal(owner.invs[92][0].amount, 100);
  owner.bag.push(carried(995, 50));
  op(owner, 266, 0, 0, 4);
  owner.amountAction.execute(20);
  assert.equal(owner.invs[92][0].amount, 120);
});

test('the lever costs 1,000 and needs its rank; balloons drop a stack and leave after two minutes', () => {
  const { owner, member, clan } = clanOfThree();
  inHall(owner, member);
  const pull = hooks.objects.Lever.Pull;
  pull({ player: owner });
  assert.match(owner.messages.at(-1), /chest is empty/);
  owner.bag.push(carried(4151, 1));
  openChest(owner);
  op(owner, 266, 0, 0, 2);
  op(owner, 783, 17);
  pull({ player: owner });
  assert.match(owner.messages.at(-1), /need 1,000 coins/);
  clan.permissions = { ...clan.permissions, 95: 127 };
  pull({ player: member });
  assert.match(member.messages.at(-1), /high enough rank/);
  clan.permissions = { ...clan.permissions, 95: 0 };
  owner.bag.push(carried(995, 1500));
  pull({ player: owner });
  assert.equal(owner.bag.at(-1).getAmount(), 500);
  assert.match(member.messages.at(-1), /balloons/i);
  assert.ok(hooks.placed.length >= 16);
  assert.ok(hooks.placed.every((balloon) => balloon.id >= 115 && balloon.id <= 122 && balloon.area === owner.area));

  const random = Math.random;
  const burst = hooks.objects['Party Balloon'].Burst;
  const at = (balloon) => ({ x: balloon.location.x, y: balloon.location.y, z: 0 });
  try {
    Math.random = () => 0;
    const first = hooks.placed[0];
    member.ironman = 'ironman';
    burst({ player: member, location: at(first) });
    assert.equal(hooks.ground.length, 0, 'no drops for an Ironman');
    assert.equal(hooks.placed.includes(first), false);
    member.ironman = 'none';
    burst({ player: member, location: at(hooks.placed[0]) });
    assert.equal(hooks.ground[0].item.id, 4151);
    assert.equal(owner.area.chest.length, 0);
  } finally {
    Math.random = random;
  }
  runTicks(200);
  assert.equal(hooks.placed.length, 0, 'gone after two minutes');
});

test('the chest empties when the last non-guest leaves, and the staff go with the last visitor', () => {
  const { owner, clan } = clanOfThree();
  inHall(owner);
  assert.equal(hooks.spawned.length, 5);
  const hall = owner.area;
  hall.chest.push({ id: 4151, amount: 1 });
  const guest = player('Guesting');
  seek(guest, 'Blur');
  hooks.objects['Clan hall portal']['Enter-guest']({ player: guest });
  hall.postLeave(owner, false);
  assert.equal(hall.chest.length, 0);
  assert.equal(hooks.removed.length, 0, 'a guest is still there');
  hall.postLeave(guest, false);
  assert.equal(hooks.removed.length, 5);
  assert.equal(clan.members.length, 3);
});

test('Entertain lets the hall hear the piano, and Play-quietly doesn\'t', () => {
  const { owner, member } = clanOfThree();
  inHall(owner, member);
  const piano = hooks.objects.Piano;
  piano.Entertain({ player: owner });
  assert.equal(owner.mounted.at(-1), 698);
  assert.equal(owner.scripts.at(-1)[0], 4321);
  op(owner, 698, 9);
  assert.deepEqual(member.sounds, [2000]);
  assert.equal(owner.sounds, undefined, 'the client played its own');
  piano['Play-quietly']({ player: owner });
  op(owner, 698, 9);
  assert.deepEqual(member.sounds, [2000]);
  piano['Background-music']({ player: owner });
  assert.deepEqual(hooks.emitted.at(-1)[1].trackId, 692);
});

test('hall furniture answers only in a hall', () => {
  const { owner } = clanOfThree();
  const { Stool, Dummy, Bookcase } = hooks.objects;
  assert.equal(Stool['Sit-on']({ player: owner }), false);
  assert.equal(Dummy.Attack({ player: owner }), false);
  assert.equal(Bookcase.Search({ player: owner }), false);
  inHall(owner);
  assert.equal(Stool['Sit-on']({ player: owner }), true);
  assert.equal(owner.animation, 1137);
  assert.equal(Dummy.Attack({ player: owner }), true);
  assert.equal(Bookcase.Search({ player: owner }), true);
});
