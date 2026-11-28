// Run after `yarn build`: node --test tests/creature-of-fenkenstrain-capture.test.cjs
//
// Creature of Fenkenstrain against the revision 243 capture of a whole run (docs/quests/creature-of-fenkenstrain):
// the interview and its start, the gardener and his walk to the head, the brain, the books and amulets, the memorial
// and the cave, the graves, the hand-ins, the shed, brush and chimney, the conductor, the creature, the pickpocket
// ending and the ring afterwards, and the variables live sends (varp 399, varbit 13715, varp 400). Real plugins, a
// real Player and world NPCs, the client's packets, the map's locs.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const QuestRuntime = require('../plugins/quests/QuestRuntime');

let core;
let quest;
const STATE = 'creature-of-fenkenstrain:state';
const VARP_QUEST = 399;
const VARP_STATE = 400;
const VARBIT_LIST = 13715;
const V = { DIRECTIONS: 185, ARMS: 186, LEGS: 187, TORSO: 188, HEAD: 189, NEEDLE: 190, THREADS: 191, COFFIN: 192, SPOKEN: 193,
  DIG: 197, TOWER: 198, CAVERN: 199, SHED: 200, BRIDGE_N: 4441, BRIDGE_S: 5023 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  quest = QuestRuntime.getRegisteredQuests().find((q) => q.key === 'creature_of_fenkenstrain');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init?.();
  for (const [x, y] of [[3549, 3550], [3504, 3576], [3510, 9957], [3578, 9927], [3608, 3490], [3492, 3474], [3575, 3527]]) {
    RegionManager.loadMapFiles(x, y, true);
  }
});
after(() => PM.emitServerShutdown({}));

const npcId = (name) => core.CacheDefinitions.getNpcId(name);
const locId = (name) => core.CacheDefinitions.getLocId(name);
const seq = (name) => core.CacheDefinitions.getSeqId(name);
const I = () => core.ItemIdentifiers;

let nextIndex = 3100;
function fixture(t, [x, y, z]) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(nextIndex++); p.setUsername(`fenk${nextIndex}`);
  p.setRegistered(true); p.setLocation(new core.Location(x, y, z)); p.needsPlacement = false;
  p.setAttribute('bot-skip-persistence', true);
  core.World.getPlayers?.().add?.(p);
  const c = new ClientConnection(channel); c.player = p;
  const log = [];
  const tick = () => log.tick ?? 0;
  const sender = p.getPacketSender();
  for (const name of ['sendMessage', 'sendVarbit', 'sendConfig', 'sendObject', 'sendObjectAnimation', 'sendSoundEffect', 'sendInterface']) {
    const original = sender[name]?.bind(sender);
    if (!original) continue;
    t.mock.method(sender, name, (...args) => { log.push([tick(), name, ...args]); return original(...args); });
  }
  const anim = p.performAnimation.bind(p);
  p.performAnimation = (a) => { log.push([tick(), 'player-anim', a?.getId?.()]); return anim(a); };
  const spawned = [];
  t.after(() => {
    for (const npc of spawned) core.World.getNpcs().remove(npc);
    PM.emitPlayerLogout?.({ player: p });
    p.setRegistered(false);
    core.World.getPlayers?.().remove?.(p);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  const watch = (npc) => {
    const say = npc.forceChat.bind(npc);
    npc.forceChat = (text) => { log.push([tick(), 'npc-say', npc.getId(), text]); return say(text); };
    return npc;
  };
  const npc = (id, [nx, ny, nz]) => {
    const n = watch(core.NPC.create(id, new core.Location(nx, ny, nz)));
    core.World.getNpcs().add(n);
    spawned.push(n);
    const local = p.getLocalNpcs?.();
    if (Array.isArray(local)) local.push(n);
    return n;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      log.tick = tick() + 1;
      for (const other of core.World.getNpcs?.() ?? []) if (other && !other.__watched && other.getId?.() === npcId('fenk_gardener_multi')) { other.__watched = true; watch(other); }
      core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process();
      c.processTurnPackets();
      const movement = p.getMovementQueue();
      movement.beginCycle?.();
      movement.processEntityPursuit?.();
      if (movement.hasPendingWork?.() ?? true) movement.process();
      core.TaskManager.processWalkTo?.(p.getIndex());
      core.World.getNpcs?.().forEach?.((other) => other?.getMovementQueue?.().process?.());
    }
  };
  const send = async (packet) => { await c.dispatch([packet]); c.processTurnPackets(); };
  const current = () => p.getDialogueManager().getCurrent();
  const cont = async () => send({ type: 'dialogue_continue', widgetId: p.getPacketSender().getChatboxGroupId() << 16, childIndex: -1 });
  const choose = async (index) => {
    const groupId = p.getPacketSender().getChatboxGroupId();
    const prompt = core.MultiChatboxPrompt.getPending(p);
    await send(prompt || groupId === (core.OptionDialogue.OPTIONS_WIDGET_ID >>> 16)
      ? { type: 'dialogue_continue', widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index }
      : { type: 'widget_action', widgetId: groupId << 16, groupId, childId: 0, buttonNum: index });
  };
  const read = () => {
    const entry = current();
    if (!entry) return null;
    if (entry instanceof core.NpcDialogue) return ['npc', entry.getNpcId(), entry.getText()];
    if (entry instanceof core.PlayerDialogue) return ['player', 'player', entry.getText()];
    if (entry instanceof core.OptionDialogue) return ['options', entry.getOptions()];
    if (entry instanceof core.ItemStatementDialogue) return ['item', entry.getItemId(), entry.getText()];
    if (entry instanceof core.StatementDialogue) return ['box', null, entry.getText()];
    return ['other'];
  };
  const pending = () => !!core.MultiChatboxPrompt.getPending(p);
  /** Talks through, answering menus with `choices` (1-based); returns the lines shown. */
  const talk = async (choices = [], { stop } = {}) => {
    const lines = [];
    let idle = 0;
    for (let i = 0; i < 120; i++) {
      step();
      const line = read();
      if (!line) {
        if (pending()) {
          lines.push(['options', core.MultiChatboxPrompt.getPending(p).options]);
          if (!choices.length) break;
          await choose(choices.shift());
          continue;
        }
        if (++idle > (lines.length ? 1 : 8)) break;
        continue;
      }
      idle = 0;
      if (line[0] === 'other') continue;
      lines.push(line);
      if (stop?.(line)) break;
      if (line[0] === 'options') { if (!choices.length) break; await choose(choices.shift()); continue; }
      await cont();
    }
    return lines;
  };
  const clickNpc = (target, clickType) => send({ type: 'npc_option', index: target.getIndex(), clickType });
  const clickLoc = (id, x, y, clickType = 1) => send({ type: 'object_option', id, x, y, clickType });
  const slot = (id) => p.getInventory().getItems().findIndex((item) => item?.getId() === id);
  const give = (id, n = 1) => p.getInventory().adds(id, n);
  const useOnItem = (a, b) => send({ type: 'inventory_use_on', slot: slot(a), itemId: a, target: { kind: 'inventory', slot: slot(b) } });
  const useOnLoc = (itemId, id, x, y) => send({ type: 'item_on_object', itemId, slot: slot(itemId), widgetId: 149 << 16, objectId: id, x, y });
  const itemOption = (itemId, option) => send({ type: 'inventory_action', slot: slot(itemId), itemId, widgetId: 3214, option });
  const since = (from) => log.filter((entry) => entry[0] >= from);
  /** Moves the player and lets the move settle a tick, as a client's next click would. */
  const place = (x, y, z = 0) => { p.moveTo(new core.Location(x, y, z)); step(); };
  const messages = (from = 0) => since(from).filter((e) => e[1] === 'sendMessage').map((e) => e[2]);
  const varbit = (id) => sender.getVarbit(id);
  const varp = (id) => sender.getVarp?.(id) ?? sender.getConfig?.(id);
  const amount = (id) => p.getInventory().getAmount(id);
  return { p, log, tick, step, send, npc, place, talk, read, cont, choose, clickNpc, clickLoc, give, slot, useOnItem, useOnLoc, itemOption,
    since, messages, varbit, varp, amount, current };
}

const worldNpcs = () => { const out = []; core.World.getNpcs().forEach((n) => { if (n) out.push(n); }); return out; };
const findGuide = (f) => worldNpcs().find((n) => n.getId?.() === npcId('fenk_gardener_multi') && (n.getOwner?.() === f.p || n.owner === f.p));
const texts = (lines) => lines.filter((l) => l[0] !== 'options').map((l) => l[2]);
const FENK = () => npcId('fenk_fenkenstrain');
const GARDENER = () => npcId('fenk_gardener_multi_2');
const CREATURE = () => npcId('fenk_creature');
const ROLOGARTH = () => npcId('fenk_creature_released');
const TOWER_FENK = () => npcId('fenk_fenkenstrain_in_tower');
const setStage = (f, stage) => quest.setStage(f.p, stage);
const wearAmulet = (f) => f.p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I().GHOSTSPEAK_AMULET, 1));

test('the interview: "What job?", menus without full stops, his own head, and the quest starts as Grave-digging is picked (ticks 319-394)', async (t) => {
  const f = fixture(t, [3554, 3553, 0]);
  const fenk = f.npc(FENK(), [3555, 3553, 0]);
  await f.clickNpc(fenk, 1);
  let lines = await f.talk([3, 2]);
  assert.deepEqual(lines[0], ['npc', FENK(), 'Have you come to apply for the job?'], 'the multinpc base 2014 as the head (if_setnpchead)');
  assert.deepEqual(lines[1], ['options', ['Yes.', 'No.', 'What job?']]);
  assert.deepEqual(texts(lines.slice(2)), ['What job do you mean, sir?', "Oh, doesn't anybody read signposts anymore???", 'What signpost?',
    'The signpost in the middle of the village nearby! Oh never mind.', 'I need a new butler. Would you like to apply?',
    "No thanks, I wouldn't work here if you paid me.", 'Charming.']);
  assert.equal(quest.getStage(f.p), 0);

  await f.clickNpc(fenk, 1);
  lines = await f.talk([1, 1]);
  assert.deepEqual(lines.find((l) => l[0] === 'options' && l[1].length === 4), ['options', ['Stunning', 'Awe-inspiring', 'Breathtaking', 'Braindead']]);
  assert.deepEqual(texts(lines).slice(-2), ['Mmmm, I see.', "I'm sorry, but I don't think you have the aptitude for this position."]);

  const from = f.tick();
  await f.clickNpc(fenk, 1);
  lines = await f.talk([1, 4], { stop: (l) => l[0] === 'options' && l[1][3] === 'Grave-digging' });
  assert.deepEqual(lines.at(-1), ['options', ['Combat', 'Magic', 'Cooking', 'Grave-digging']]);
  assert.equal(quest.getStage(f.p), 0, 'not yet: the answer starts it');
  await f.choose(4);
  f.step();
  assert.equal(quest.getStage(f.p), 1);
  assert.equal(f.varp(VARP_QUEST), 1, 'varp 399 0 -> 1');
  assert.equal(f.varbit(VARBIT_LIST), 2, 'varbit 13715 0 -> 2');
  assert.ok(f.since(from).some((e) => e[1] === 'sendConfig' && e[2] === VARP_QUEST && e[3] === 1));
  lines = await f.talk();
  assert.deepEqual(texts(lines).slice(0, 2), ['Mmmm, I see.', "Looks like you're just the man for the job! Welcome aboard!"]);
  assert.equal(texts(lines).at(-1), 'Right...okay...if you insist.');

  // Stage 1 with nothing to hand in: the five-option menu.
  await f.clickNpc(fenk, 1);
  lines = await f.talk([]);
  assert.deepEqual(lines[0], ['options', ['Do you know where I could find body parts?', 'Remind me what you want me to do.',
    'Why are you trying to make this creature?', 'Will this creature put me out of a job?', 'I must get back to work, sir.']]);
});

test('the gardener: the neck twitch without the amulet, the amulet\'s box once (varbit 193), then his walk to the head (ticks 549-610)', async (t) => {
  const f = fixture(t, [3547, 3560, 0]);
  const gardener = f.npc(GARDENER(), [3546, 3560, 0]);
  setStage(f, 1);
  await f.clickNpc(gardener, 1);
  let lines = await f.talk([3]);
  assert.deepEqual(lines.slice(0, 3), [
    ['options', ['Tell me about Fenkenstrain.', 'What happened to your head?', "What's your name?"]],
    ['player', 'player', "What's your name?"],
    ['box', null, "The Headless Gardener's neck twitches at you, but the lack of any head prevents him from speaking."],
  ]);

  wearAmulet(f);
  await f.clickNpc(gardener, 1);
  lines = await f.talk([1]);
  assert.deepEqual(lines.slice(1, 4), [
    ['player', 'player', 'Can you tell me anything about Fenkenstrain?'],
    ['item', I().GHOSTSPEAK_AMULET, 'You feel power emanate from the Amulet of Ghostspeak, and the air around you vibrates with the ghostly voice of the Headless Gardener...'],
    ['npc', GARDENER(), 'Oi could tell you a few things about old Fenky, yeah.'],
  ], 'no second "Can you tell me..." after the box; his head is the multinpc 2013');
  assert.equal(f.varbit(V.SPOKEN), 1);

  await f.clickNpc(gardener, 1);
  lines = await f.talk([2]);
  assert.deepEqual(lines.slice(1, 3).map((l) => l[2]), ['What happened to your head?',
    "Oi was in the old 'aunted Forest to the south, diggin' a pit for moi old maaster, old Fenkenstrain, when would you believe it, someone chops me head off. Awful bad luck, weren't it?"],
  'the amulet\'s box only the first time');
  assert.equal(texts(lines).at(-1), "Well, oi s'pose oi've got 10 minutes to spare.");
  f.step(2);
  assert.equal(f.varbit(V.DIRECTIONS), 1, 'varbit 185: his guide replaces him');
  const guide = findGuide(f);
  assert.ok(guide, 'the guide (2012) is spawned for the player');
  assert.equal(guide.getFollowing?.(), f.p);
});

test('the head: dug on the recorded tile, the guide\'s line as it comes up, gone as the box is continued (ticks 927-937)', async (t) => {
  const f = fixture(t, [3550, 3561, 0]);
  const gardener = f.npc(GARDENER(), [3551, 3561, 0]);
  setStage(f, 1);
  wearAmulet(f);
  f.p.setAttribute(STATE, 1 << 9);
  await f.clickNpc(gardener, 1);
  await f.talk([2]);
  f.step(2);
  const guide = findGuide(f);
  assert.ok(guide);
  f.p.moveTo(new core.Location(3608, 3490, 0));
  guide.moveTo(new core.Location(3607, 3490, 0));
  f.give(I().SPADE);
  const from = f.tick();
  await f.itemOption(I().SPADE, 'Dig');
  f.step();
  assert.equal(f.varbit(V.DIG), 1, 'varbit 197 -> 1 as the dig starts');
  assert.ok(f.messages(from).includes('You start digging...'));
  assert.ok(f.since(from).some((e) => e[1] === 'player-anim' && e[2] === seq('human_dig_long')));
  f.step(6);
  assert.deepEqual(f.read(), ['item', I().DECAPITATED_HEAD, '... and you unearth a decapitated head.']);
  assert.equal(f.amount(I().DECAPITATED_HEAD), 1);
  assert.ok(f.since(from).some((e) => e[1] === 'npc-say' && e[3] === "This is the place where I met me' maker."));
  assert.equal(f.varbit(V.DIRECTIONS), 1, 'still with the player until the box is continued');
  await f.cont();
  f.step();
  assert.ok(f.messages(from).includes('... and you unearth a decapitated head.'), 'the same words in the chat');
  assert.equal(f.varbit(V.DIRECTIONS), 0);
  assert.equal(guide.isRegistered(), false, 'the guide is gone');

  // Digging there again: the grave is empty.
  const again = f.tick();
  await f.itemOption(I().SPADE, 'Dig');
  f.step(8);
  assert.ok(f.messages(again).includes('... but the grave is empty.'));
  assert.equal(f.amount(I().DECAPITATED_HEAD), 1);
});

test('off the beaten track: his two lines 6 ticks apart and gone 5 later (ticks 720-731)', async (t) => {
  const f = fixture(t, [3550, 3561, 0]);
  const gardener = f.npc(GARDENER(), [3551, 3561, 0]);
  setStage(f, 1);
  wearAmulet(f);
  f.p.setAttribute(STATE, 1 << 9);
  await f.clickNpc(gardener, 1);
  await f.talk([2]);
  f.step(2);
  const guide = findGuide(f);
  f.p.moveTo(new core.Location(3500, 3500, 0));
  guide.moveTo(new core.Location(3501, 3500, 0));
  const from = f.tick();
  f.step(1);
  const said = () => f.since(from).filter((e) => e[1] === 'npc-say').map((e) => [e[0] - from, e[3]]);
  assert.deepEqual(said().map((s) => s[1]), ["Oi'm afraid you've gone well off the beaten track.."]);
  f.step(6);
  assert.equal(said()[1][1], "Fare thee well - oi must return to me' garden.");
  assert.equal(said()[1][0] - said()[0][0], 6);
  f.step(5);
  assert.equal(f.varbit(V.DIRECTIONS), 0);
  assert.equal(guide.isRegistered(), false);
});

// The jar's sale itself (Take on the bar's static spawn, Roavar's lines, the 50 coins) is driven through the real
// pickup by quest-reward-room-3's "Roavar's public brain sale" tests.
test('the brain into the head (tick 943)', async (t) => {
  const f = fixture(t, [3493, 3474, 0]);
  f.give(I().PICKLED_BRAIN);
  f.give(I().DECAPITATED_HEAD);
  await f.useOnItem(I().DECAPITATED_HEAD, I().PICKLED_BRAIN);
  f.step();
  assert.deepEqual(f.read(), ['item', I().DECAPITATED_HEAD_2, 'You squeeze the pickled brain into the decapitated head.']);
  assert.equal(f.amount(I().DECAPITATED_HEAD_2), 1);
});

test('the bookcases: three books\' boxes, the compartments and the star amulet (ticks 452-528)', async (t) => {
  const f = fixture(t, [3555, 3557, 1]);
  setStage(f, 1);
  const east = locId('fenk_bookcase');
  let from = f.tick();
  await f.clickLoc(east, 3555, 3558);
  let lines = await f.talk([2]);
  assert.deepEqual(lines[0], ['options', ['Chimney Sweeping on a Budget', 'Handy Maggot Avoidance Techniques', 'My Family and Other Zombies']]);
  assert.deepEqual(lines.slice(1), [
    ['item', I().JOURNAL_3, 'As you pull the book a hidden latch springs into place, and the bookcase swings open, revealing a secret compartment.'],
    ['item', I().OBSIDIAN_AMULET, 'You find an obsidian amulet in the secret compartment.'],
  ]);
  assert.ok(f.since(from).some((e) => e[1] === 'sendObjectAnimation' && e[3]?.getId?.() === seq('fenk_bookcase_open')));
  assert.ok(f.since(from).some((e) => e[1] === 'sendSoundEffect' && e[2] === 1468));
  assert.equal(f.amount(I().OBSIDIAN_AMULET), 1);
  await f.clickLoc(east, 3555, 3558);
  lines = await f.talk([3]);
  assert.deepEqual(lines[1], ['item', I().JOURNAL_3, 'The book is appallingly dull.']);
  await f.clickLoc(east, 3555, 3558);
  await f.talk([1], { stop: (l) => l[0] === 'options' });
  await f.choose(1);
  f.step();
  assert.equal(f.p.getInterfaceId(), 392, 'Chimney Sweeping on a Budget opens as a book');

  const g = fixture(t, [3542, 3557, 1]);
  setStage(g, 1);
  await g.clickLoc(east, 3542, 3558);
  lines = await g.talk([3]);
  assert.deepEqual(lines[0], ['options', ['1001 Ways To Eat Fried Gizzards', 'Practical Gardening For The Headless', 'Human Taxidermy for Nincompoops', 'The Joy of Gravedigging']]);
  assert.equal(lines[1][0], 'item');
  assert.match(lines[1][2], /^This book seems to have been read hundreds of times/);
  await g.clickLoc(east, 3542, 3558);
  lines = await g.talk([4]);
  assert.deepEqual(lines.slice(1), [
    ['box', null, 'As you pull the book a hidden latch springs into place, and the bookcase swings open, revealing a secret compartment.'],
    ['item', I().MARBLE_AMULET, 'You find a marble amulet in the secret compartment.'],
  ], 'the west one opens in a message box');
  g.give(I().OBSIDIAN_AMULET);
  await g.useOnItem(I().OBSIDIAN_AMULET, I().MARBLE_AMULET);
  g.step();
  assert.deepEqual(g.read(), ['item', I().STAR_AMULET, 'The marble and obsidian amulets snap together tightly to form a six-pointed amulet.']);
  assert.equal(g.amount(I().STAR_AMULET), 1);
  await g.cont();
  await g.clickLoc(east, 3542, 3558);
  lines = await g.talk([4]);
  assert.deepEqual(lines.at(-1), ['box', null, 'The secret compartment is empty.'], 'the star counts as the marble one (Wiki)');
});

test('the star memorial: "does not budge", the star in its lid (varbit 192), down to the cave 3 ticks after the push (ticks 950-988)', async (t) => {
  const f = fixture(t, [3578, 3526, 0]);
  setStage(f, 1);
  const memorial = locId('fenk_coffin');
  let from = f.tick();
  await f.clickLoc(memorial, 3578, 3527, 1);
  f.step(2);
  assert.ok(f.messages(from).includes('The coffin is incredibly heavy, and does not budge. '));
  f.give(I().STAR_AMULET);
  await f.useOnLoc(I().STAR_AMULET, memorial, 3578, 3527);
  f.step(2);
  assert.deepEqual(f.read(), ['item', I().STAR_AMULET, 'The star amulet fits exactly into the depression on the coffin lid.']);
  assert.equal(f.varbit(V.COFFIN), 1);
  assert.equal(f.amount(I().STAR_AMULET), 0);
  await f.cont();
  from = f.tick();
  await f.clickLoc(memorial, 3578, 3527, 1);
  f.step(1);
  assert.ok(f.since(from).some((e) => e[1] === 'sendObjectAnimation' && e[3]?.getId?.() === seq('fenk_capstone_moves')));
  f.step(3);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY(), f.p.getLocation().getZ()], [3577, 9927, 0]);
});

test('the cavern key: only the level 51 Experiment drops it, only during the quest (tick 1042)', async (t) => {
  const f = fixture(t, [3554, 9947, 0]);
  const ask = (npc) => {
    const request = { player: f.p, npc: null, npcId: npc, itemId: I().CAVERN_KEY, requirement: { key: 'quest_creatureoffenkenstrain', mode: 'RequiresDuring' }, allowed: undefined };
    PM.emitCustomEvent('npc-drops:quest-item', request);
    return request.allowed;
  };
  assert.equal(ask(core.NpcIdentifiers.EXPERIMENT), false, 'not before the quest');
  setStage(f, 1);
  assert.equal(ask(core.NpcIdentifiers.EXPERIMENT), true);
  assert.equal(ask(core.NpcIdentifiers.EXPERIMENT_2), false, 'not the level 25 ones');
  setStage(f, 7);
  assert.equal(ask(core.NpcIdentifiers.EXPERIMENT), false, 'not after it');
});

test('the mausoleum door takes the key each time, unlocks the cavern and the bridges, and lets the player through (ticks 1078-1083, 1244-1256)', async (t) => {
  const f = fixture(t, [3511, 9957, 0]);
  setStage(f, 1);
  const door = locId('fenk_mausoleum_door');
  let from = f.tick();
  await f.clickLoc(door, 3510, 9957, 1);
  f.step(2);
  assert.ok(f.messages(from).includes('The door is locked.'));
  assert.equal(f.p.getLocation().getX(), 3511);
  f.give(I().CAVERN_KEY);
  from = f.tick();
  await f.clickLoc(door, 3510, 9957, 1);
  f.step(1);
  assert.equal(f.amount(I().CAVERN_KEY), 0);
  assert.deepEqual([f.varbit(V.CAVERN), f.varbit(V.BRIDGE_N), f.varbit(V.BRIDGE_S)], [1, 1, 1]);
  assert.ok(f.since(from).some((e) => e[1] === 'sendSoundEffect' && e[2] === 2402), 'the lock\'s sound');
  f.step(3);
  assert.equal(f.p.getLocation().getX(), 3510, 'stepped through');

  // The chest by the island's ladder: a key, then empty while one is carried (tick 1117; Wiki).
  const chest = locId('fenk_chest_open');
  const c = fixture(t, [3501, 9967, 0]);
  setStage(c, 1);
  await c.clickLoc(chest, 3500, 9967, 1);
  c.step(4);
  assert.deepEqual(c.read(), ['item', I().CAVERN_KEY, 'You take a key out of the chest.']);
  await c.cont();
  from = c.tick();
  await c.clickLoc(chest, 3500, 9967, 1);
  c.step(4);
  assert.ok(c.messages(from).includes('The chest is empty.'));
  assert.equal(c.amount(I().CAVERN_KEY), 1);
});

test('the island graves: read as live words them, dug on the recorded tiles for the torso, arms and legs (ticks 1132-1173)', async (t) => {
  const f = fixture(t, [3503, 3575, 0]);
  setStage(f, 1);
  f.give(I().SPADE);
  let from = f.tick();
  await f.clickLoc(locId('fenk_grave'), 3502, 3576, 1);
  f.step(4);
  assert.deepEqual(f.messages(from).slice(-2), ['The grave says:', "   'Here lies  Rolomere, 14th Lord of the North Coast - REST IN PEACE'"]);
  for (const [tile, item, value, text] of [
    [[3503, 3576], I().TORSO, 2, '... and you unearth a torso.'],
    [[3504, 3576], I().ARMS, 3, '... and you unearth a pair of arms.'],
    [[3505, 3576], I().LEGS, 4, '... and you unearth a pair of legs.'],
  ]) {
    f.p.moveTo(new core.Location(...tile, 0));
    await f.itemOption(I().SPADE, 'Dig');
    f.step(1);
    assert.equal(f.varbit(V.DIG), value);
    f.step(6);
    assert.deepEqual(f.read(), ['item', item, text]);
    await f.cont();
    f.step();
  }
});

test('the hand-in: every part carried, arms first, then "Oh bother!" and stage 2 (ticks 1384-1400)', async (t) => {
  const f = fixture(t, [3552, 3551, 0]);
  const fenk = f.npc(FENK(), [3553, 3551, 0]);
  setStage(f, 1);
  for (const id of [I().DECAPITATED_HEAD_2, I().TORSO, I().ARMS, I().LEGS]) f.give(id);
  await f.clickNpc(fenk, 1);
  const from = f.tick();
  const lines = await f.talk([1]);
  assert.deepEqual(lines[0][1][0], 'I have some body parts for you.');
  assert.deepEqual(texts(lines), ['I have some body parts for you.', "Great, you've brought me some arms.", "Excellent, you've brought me some legs.",
    "Splendid, you've brought me a torso.", "Fantastic, you've brought me a head.",
    'Superb!! Those are all the parts I need. Now to sew them together ...', "Oh bother! I haven't got a needle or thread!",
    "Go and get me a needle, and I'll need 5 lots of thread."]);
  const order = f.since(from).filter((e) => e[1] === 'sendVarbit' && [V.ARMS, V.LEGS, V.TORSO, V.HEAD].includes(e[2])).map((e) => e[2]);
  assert.deepEqual(order, [V.ARMS, V.LEGS, V.TORSO, V.HEAD]);
  assert.equal(quest.getStage(f.p), 2);
  assert.deepEqual([f.varp(VARP_QUEST), f.varbit(VARBIT_LIST)], [2, 3]);
  for (const id of [I().DECAPITATED_HEAD_2, I().TORSO, I().ARMS, I().LEGS]) assert.equal(f.amount(id), 0);
});

test('the needle and thread in one talk, the sewing box and stage 3 (ticks 1412-1432)', async (t) => {
  const f = fixture(t, [3552, 3551, 0]);
  const fenk = f.npc(FENK(), [3553, 3551, 0]);
  setStage(f, 2);
  f.give(I().NEEDLE);
  f.give(I().THREAD, 7);
  await f.clickNpc(fenk, 1);
  const lines = await f.talk();
  assert.deepEqual(lines.slice(0, 4).map((l) => l[2]), ['Where are my needle and thread, ' + f.p.getUsername() + '?', 'Ah, a needle. Wonderful.',
    'Some thread, excellent.', 'Fenkenstrain uses the needle and thread to sew the body parts together. Soon, a hideous creature lies inanimate on the ritual table.']);
  assert.equal(lines[3][0], 'box');
  assert.equal(texts(lines).at(-1), 'Repair the conductor and BEGONE!!!');
  assert.deepEqual([f.varbit(V.NEEDLE), f.varbit(V.THREADS)], [1, 5]);
  assert.equal(f.amount(I().THREAD), 2, 'five lots taken');
  assert.deepEqual([quest.getStage(f.p), f.varp(VARP_QUEST), f.varbit(VARBIT_LIST)], [3, 3, 4]);
});

test('the shed: the gardener\'s key, the door takes it once, the cupboard\'s brush, the canes, the brush and the chimney\'s mould (ticks 1482-1607)', async (t) => {
  const f = fixture(t, [3548, 3561, 0]);
  const gardener = f.npc(GARDENER(), [3547, 3561, 0]);
  setStage(f, 3);
  wearAmulet(f);
  f.p.setAttribute(STATE, 1 << 9);
  await f.clickNpc(gardener, 1);
  let lines = await f.talk([2]);
  assert.deepEqual(lines[0], ['options', ['Tell me about Fenkenstrain.', 'Do you know where the key to the shed is?', 'Do you know where a conductor mould is?', 'What happened to your head?']]);
  assert.deepEqual(lines.at(-1), ['item', I().SHED_KEY, 'The headless gardener hands you a rusty key.']);
  assert.equal(f.amount(I().SHED_KEY), 1);

  const d = fixture(t, [3548, 3565, 0]);
  setStage(d, 3);
  d.give(I().SHED_KEY);
  const door = locId('fenk_shed_door');
  let from = d.tick();
  await d.clickLoc(door, 3548, 3565, 1);
  d.step(2);
  assert.equal(d.amount(I().SHED_KEY), 0);
  assert.equal(d.varbit(V.SHED), 1);
  d.step(3);
  assert.equal(d.p.getLocation().getX(), 3547, 'inside the shed');

  // The cupboard, the canes and the brush, from inside the shed (ticks 1517-1559).
  let e = fixture(t, [3547, 3564, 0]);
  setStage(e, 3);
  const cupboard = locId('fenk_broomcupboard');
  await e.clickLoc(cupboard, 3546, 3563, 1);
  e.step(4);
  from = e.tick();
  await e.clickLoc(locId('fenk_broomcupboard_open'), 3546, 3563, 2);
  e.step(4);
  assert.deepEqual(e.read(), ['item', I().GARDEN_BRUSH, 'You find a garden brush in the cupboard.']);
  await e.cont();
  e.step();
  await e.clickLoc(locId('fenk_broomcupboard_open'), 3546, 3563, 2);
  e.step(4);
  assert.ok(e.messages(from).includes('You search the cupboard but find nothing.'), 'once the brush is carried (Wiki)');
  // The pile is outside the shed (live leaves through the door first, tick 1524).
  assert.equal(e.amount(I().GARDEN_BRUSH), 1);
  e = fixture(t, [3551, 3563, 0]);
  setStage(e, 3);
  e.give(I().GARDEN_BRUSH);
  e.give(I().BRONZE_WIRE, 3);
  const canes = locId('fenk_canepile');
  for (let i = 0; i < 3; i++) {
    from = e.tick();
    await e.clickLoc(canes, 3551, 3564, 1);
    e.step(6);
    assert.ok(e.messages(from).includes('You take a garden cane from the pile.'));
  }
  assert.equal(e.amount(I().GARDEN_CANE), 3);
  from = e.tick();
  for (const [brush, next] of [[I().GARDEN_BRUSH, I().EXTENDED_BRUSH], [I().EXTENDED_BRUSH, I().EXTENDED_BRUSH_2], [I().EXTENDED_BRUSH_2, I().EXTENDED_BRUSH_3]]) {
    await e.useOnItem(I().GARDEN_CANE, brush);
    e.step();
    assert.equal(e.amount(next), 1);
  }
  assert.equal(e.messages(from).filter((m) => m === 'You attach the cane to the brush.').length, 3);
  assert.equal(e.amount(I().BRONZE_WIRE), 0);

  // The upstairs west chimney (ticks 1599-1605).
  const g = fixture(t, [3543, 3555, 1]);
  setStage(g, 3);
  g.give(I().EXTENDED_BRUSH_3);
  from = g.tick();
  await g.useOnLoc(I().EXTENDED_BRUSH_3, locId('fenk_fireplace'), 3544, 3555);
  g.step(1);
  assert.ok(g.since(from).some((x) => x[1] === 'player-anim' && x[2] === seq('fenk_human_poke')));
  g.step(5);
  assert.ok(g.messages(from).includes('You give the chimney a jolly good clean out.'));
  assert.deepEqual(g.read(), ['item', I().CONDUCTOR_MOULD, 'A lightning conductor mould falls down out of the chimney.']);
  assert.equal(g.amount(I().CONDUCTOR_MOULD), 1);
});

test('the conductor: repaired and struck, stage 4, melted as the box goes; then beyond repair (ticks 1819-1827)', async (t) => {
  const f = fixture(t, [3548, 3538, 2]);
  setStage(f, 3);
  f.give(I().CONDUCTOR);
  const stand = locId('fenk_conductor_broken');
  let from = f.tick();
  await f.clickLoc(stand, 3548, 3536, 1);
  f.step(2);
  assert.deepEqual([quest.getStage(f.p), f.varp(VARP_QUEST), f.varbit(VARBIT_LIST)], [4, 4, 5]);
  assert.equal(f.amount(I().CONDUCTOR), 0);
  assert.ok(f.since(from).some((e) => e[1] === 'sendObject' && e[2].getId() === locId('fenk_conductor_repaired')));
  assert.ok(f.since(from).some((e) => e[1] === 'sendObjectAnimation' && e[3]?.getId?.() === seq('fenk_lightning')));
  assert.ok(f.since(from).some((e) => e[1] === 'sendSoundEffect' && e[2] === 1471));
  assert.equal(f.read()[0], 'box');
  await f.cont();
  f.step(2);
  const back = f.since(from).filter((e) => e[1] === 'sendObject').at(-1);
  assert.equal(back[2].getId(), stand, 'broken again');
  from = f.tick();
  await f.clickLoc(stand, 3548, 3536, 1);
  f.step(2);
  assert.ok(f.messages(from).includes('The lightning conductor is now beyond repair.'));
});

test('after the repair: stage 5 on "Destroy it!!!", the tower key as it is continued, then "Not yet." (ticks 1858-1896)', async (t) => {
  const f = fixture(t, [3552, 3551, 0]);
  const fenk = f.npc(FENK(), [3553, 3551, 0]);
  setStage(f, 4);
  await f.clickNpc(fenk, 1);
  const lines = await f.talk([], { stop: (l) => /^Destroy it/.test(l[2] ?? '') });
  assert.equal(lines[1][2], `Yes, I'm afraid it did, ${f.p.getUsername()} - all too well.`);
  f.step();
  assert.equal(quest.getStage(f.p), 5, 'as the line shows');
  assert.equal(f.amount(I().TOWER_KEY), 0, 'not yet');
  await f.cont();
  f.step(2);
  assert.equal(f.amount(I().TOWER_KEY), 1);
  await f.clickNpc(fenk, 1);
  assert.deepEqual(texts(await f.talk()), ['So have you destroyed it?!!?', 'Not yet.', 'Please, hurry - save me!!!!']);
  // Pickpocketing him now is the pre-quest refusal (tick 1890).
  await f.clickNpc(fenk, 3);
  assert.deepEqual(texts(await f.talk()), ["What do you think you're doing???"]);
});

test('the tower door takes the key once; the creature\'s talk moves to stage 6 on its last line, with its own head (ticks 1916-2133)', async (t) => {
  const f = fixture(t, [3548, 3550, 1]);
  setStage(f, 5);
  f.give(I().TOWER_KEY);
  const door = locId('fenk_tower_door');
  await f.clickLoc(door, 3548, 3551, 1);
  f.step(3);
  assert.equal(f.amount(I().TOWER_KEY), 0);
  assert.equal(f.varbit(V.TOWER), 1);
  f.step(3);
  assert.equal(f.p.getLocation().getY(), 3552, 'through');

  const g = fixture(t, [3548, 3554, 2]);
  const creature = g.npc(CREATURE(), [3548, 3555, 2]);
  setStage(g, 5);
  await g.clickNpc(creature, 1);
  const lines = await g.talk();
  assert.deepEqual(lines[1], ['npc', CREATURE(), "Oh that's *hic* not very *hic* nice ..."]);
  assert.equal(lines.filter((l) => l[0] === 'box').length, 2);
  assert.equal(quest.getStage(g.p), 6);
  assert.deepEqual([g.varp(VARP_QUEST), g.varbit(VARBIT_LIST)], [6, 7]);
});

test('the pickpocket: the ring, the quest complete with varp 400 cleared, 1,000 Thieving once; the ring again from the tower (ticks 2214-2340)', async (t) => {
  const f = fixture(t, [3551, 3555, 0]);
  const fenk = f.npc(FENK(), [3552, 3555, 0]);
  setStage(f, 6);
  f.p.setAttribute(STATE, (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (5 << 5) | (1 << 8) | (1 << 9) | (4 << 17) | (7 << 20) | (1 << 24) | (1 << 27));
  f.p.getSkillManager().setMaxLevels(core.Skill.THIEVING, 30, false);
  f.p.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 30, false);
  const xp = f.p.getSkillManager().getExperience(core.Skill.THIEVING);
  await f.clickNpc(fenk, 1);
  assert.deepEqual(texts(await f.talk()).slice(0, 2), ['So have you destroyed it?!!?', 'Never, now that he has told me the truth!']);
  const from = f.tick();
  await f.clickNpc(fenk, 3);
  f.step(2);
  assert.equal(f.messages(from)[0], 'You steal the Ring of Charos from Fenkenstrain.');
  assert.ok(f.messages(from).some((m) => /^Congratulations, you've completed a quest/.test(m)));
  assert.equal(quest.isComplete(f.p), true);
  assert.deepEqual([f.varp(VARP_QUEST), f.varbit(VARBIT_LIST), f.varp(VARP_STATE)], [8, 9, 0]);
  assert.equal(f.amount(I().RING_OF_CHAROS), 1);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.THIEVING) - xp, 1000);
  await f.clickNpc(fenk, 3);
  f.step(2);
  assert.equal(f.amount(I().RING_OF_CHAROS), 1, 'not twice');
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.THIEVING) - xp, 1000);

  // Afterwards, in the tower: his words, the refusal while the ring is kept, the ring again once it is gone.
  const g = fixture(t, [3550, 3554, 2]);
  const tower = g.npc(TOWER_FENK(), [3551, 3554, 2]);
  quest.setStage(g.p, 7);
  g.p.getSkillManager().setMaxLevels(core.Skill.THIEVING, 25, false);
  g.p.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 25, false);
  await g.clickNpc(tower, 1);
  let lines = await g.talk();
  assert.deepEqual(lines[0], ['npc', TOWER_FENK(), 'theyrecomingtogetme theyrecomingtogetme...']);
  g.give(I().RING_OF_CHAROS);
  await g.clickNpc(tower, 3);
  assert.deepEqual(texts(await g.talk()), ["What do you think you're doing???"]);
  g.p.getInventory().deleteNumber(I().RING_OF_CHAROS, 1);
  const again = g.tick();
  await g.clickNpc(tower, 3);
  g.step(2);
  assert.ok(g.messages(again).includes('You steal the Ring of Charos from Fenkenstrain.'));
  assert.equal(g.amount(I().RING_OF_CHAROS), 1);

  // Rologarth and the gardener afterwards (ticks 2240-2266).
  const h = fixture(t, [3553, 3549, 0]);
  const lord = h.npc(ROLOGARTH(), [3553, 3548, 0]);
  quest.setStage(h.p, 7);
  await h.clickNpc(lord, 1);
  lines = await h.talk();
  assert.equal(lines[0][1], ROLOGARTH());
  assert.equal(lines[2][2], "I saw him climb up into the Tower to hide. It doesn't matter - soon the werewolves will come for him, and his experiments will be forever ceased.");
  const gardener = h.npc(GARDENER(), [3554, 3549, 0]);
  wearAmulet(h);
  await h.clickNpc(gardener, 1);
  assert.deepEqual(texts(await h.talk()), ['How are you?', "Same as ever, mate, just gettin' on with it regardless.", 'Good for you ... err ... mate.']);
});

test('login sends varp 399 and the whole of varp 400 from the save, and an old save\'s bits carry over', async (t) => {
  const f = fixture(t, [3552, 3551, 0]);
  setStage(f, 2);
  f.p.setAttribute('quest.creature_of_fenkenstrain.parts_given', 0xf);
  f.p.setAttribute('quest.creature_of_fenkenstrain.sewing', 1 | (3 << 1));
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.varp(VARP_QUEST), 2);
  assert.deepEqual([V.ARMS, V.LEGS, V.TORSO, V.HEAD].map((id) => f.varbit(id)), [1, 1, 1, 1]);
  assert.deepEqual([f.varbit(V.NEEDLE), f.varbit(V.THREADS)], [1, 3]);
  assert.equal(f.p.getAttribute('quest.creature_of_fenkenstrain.parts_given'), 0, 'folded in once');
  const saved = f.p.getAttribute(STATE);
  f.p.getPacketSender().sendConfig(VARP_STATE, 0);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.varp(VARP_STATE), saved);
  assert.equal(f.varbit(VARBIT_LIST), 3);
});

test('from the Wiki: the signpost, the clock and its letter, the zombie head, a needle alone, the Thieving level, the gardener before the quest', async (t) => {
  // The signpost's note starts the quest; afterwards it is only the note, and after the quest the scream.
  const s = fixture(t, [3488, 3484, 0]);
  await s.clickLoc(locId('fenk_signpost'), 3488, 3485, 1);
  let lines = await s.talk([1]);
  assert.equal(lines[0][0], 'options');
  assert.equal(lines.find((l) => l[0] === 'box')[2].startsWith('The signpost has a note pinned onto it.'), true);
  assert.equal(quest.getStage(s.p), 1);
  quest.setStage(s.p, 7);
  await s.clickLoc(locId('fenk_signpost'), 3488, 3485, 1);
  s.step(2);
  assert.deepEqual(s.read(), ['box', null, 'AAARRGGGHHHHH!!!!!']);

  // The clock: the letter once, then just a wind; the letter reads in the long scroll.
  const c = fixture(t, [3541, 3545, 1]);
  setStage(c, 1);
  await c.clickLoc(locId('fenk_clock'), 3540, 3545, 1);
  lines = await c.talk();
  assert.deepEqual(lines[0], ['item', I().LETTER, 'As you wind the old clock a letter falls out. Judging by the thick covering of dust it must have been here for some time.']);
  assert.equal(c.amount(I().LETTER), 1);
  const from = c.tick();
  await c.clickLoc(locId('fenk_clock'), 3540, 3545, 1);
  await c.talk();
  assert.ok(c.messages(from).includes('You wind the old clock.'));
  assert.equal(c.amount(I().LETTER), 1);
  await c.itemOption(I().LETTER, 'Read');
  c.step();
  assert.equal(c.p.getInterfaceId(), 625, 'the long scroll');

  // A zombie head on him, a needle alone, and no Thieving.
  const f = fixture(t, [3552, 3551, 0]);
  const fenk = f.npc(FENK(), [3553, 3551, 0]);
  setStage(f, 2);
  f.give(I().ZOMBIE_HEAD);
  await f.send({ type: 'item_on_npc', targetIndex: fenk.getIndex(), itemId: I().ZOMBIE_HEAD, slot: f.slot(I().ZOMBIE_HEAD), widgetId: 149 << 16 });
  lines = await f.talk();
  assert.equal(texts(lines)[2], "I can't use that head!");
  f.give(I().NEEDLE);
  await f.clickNpc(fenk, 1);
  assert.deepEqual(texts(await f.talk()).slice(1), ['Ah, a needle. Wonderful.'], 'no "Where\'s my thread" in the same talk');
  await f.clickNpc(fenk, 1);
  assert.deepEqual(texts(await f.talk()).slice(1), [`Where's my thread, ${f.p.getUsername()}?`]);
  assert.equal(quest.getStage(f.p), 2);
  setStage(f, 6);
  const before = f.tick();
  await f.clickNpc(fenk, 3);
  f.step(2);
  assert.ok(f.messages(before).includes("You need level 25 thieving to pick Dr Fenkenstrain's pocket."));
  assert.equal(quest.isComplete(f.p), false);

  // The gardener before the quest.
  const g = fixture(t, [3547, 3560, 0]);
  const gardener = g.npc(GARDENER(), [3546, 3560, 0]);
  wearAmulet(g);
  await g.clickNpc(gardener, 1);
  assert.deepEqual(texts(await g.talk()), ['Who are you?', "Oi'm the 'eadless gardener, mate."]);
});

test('a headless Quest Helper snapshot carries varp 399 and varp 400, which the guide keys on', (t) => {
  const f = fixture(t, [3552, 3551, 0]);
  setStage(f, 3);
  f.p.setAttribute(STATE, (1 << 4) | (5 << 5));
  const { QuestHelperRuntime } = require('../plugins/quests/questhelper/Runtime.QuestHelper');
  const runtime = require('../plugins/quests/QuestHelper.plugin.js').getRuntime();
  assert.ok(runtime instanceof QuestHelperRuntime);
  const snapshot = runtime.authoritative(f.p, { varps: {}, varbits: {}, localPlayer: {} }, 'creature_of_fenkenstrain');
  assert.equal(snapshot.varps[VARP_QUEST], 3);
  assert.equal(snapshot.varps[VARP_STATE], (1 << 4) | (5 << 5));
  assert.equal(snapshot.varbits[VARBIT_LIST], 4);
});

test('review: a save with the guide out does not hide the gardener after login; the mausoleum door is free after the quest', async (t) => {
  const f = fixture(t, [3552, 3551, 0]);
  setStage(f, 1);
  // An autosave or shutdown while the guide was out kept bit 31 (fenk_gardener_directions).
  f.p.setAttribute(STATE, (1 << 9) | (1 << 31));
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.varbit(V.DIRECTIONS), 0);
  assert.equal(f.varbit(V.SPOKEN), 1, 'the rest of varp 400 is kept');

  const d = fixture(t, [3511, 9957, 0]);
  quest.setStage(d.p, 7);
  await d.clickLoc(locId('fenk_mausoleum_door'), 3510, 9957, 1);
  d.step(4);
  assert.equal(d.p.getLocation().getX(), 3510, 'through without a key (Wiki, Cavern key)');
});

test('review: the key Experiment is spared while a key is carried or after the quest, and drops no second key', (t) => {
  const f = fixture(t, [3554, 9947, 0]);
  setStage(f, 1);
  f.give(I().CAVERN_KEY);
  const experiment = f.npc(core.NpcIdentifiers.EXPERIMENT, [3554, 9948, 0]);
  const attack = () => {
    const event = { player: f.p, npc: experiment, npcId: core.NpcIdentifiers.EXPERIMENT, clickType: 2, handled: false };
    PM.emitNpcAttackOption(event);
    return event.handled;
  };
  const drop = () => {
    const request = { player: f.p, npc: null, npcId: core.NpcIdentifiers.EXPERIMENT, itemId: I().CAVERN_KEY, requirement: null, allowed: undefined };
    PM.emitCustomEvent('npc-drops:quest-item', request);
    return request.allowed;
  };
  assert.equal(attack(), true);
  assert.ok(f.messages().includes("You don't have the heart to kill the poor creature again."));
  assert.equal(drop(), false);
  f.p.getInventory().deleteNumber(I().CAVERN_KEY, 1);
  assert.equal(attack(), false, 'without a key, during the quest, it can be fought');
  assert.equal(drop(), true);
  f.p.setAttribute(STATE, 1 << 21); // fenk_unlocked_cavern: the key has been used on the gate
  assert.equal(attack(), true, 'once the key has been used on the gate (Wiki, Experiment)');
  assert.equal(drop(), false);
  f.p.setAttribute(STATE, 0);
  quest.setStage(f.p, 7);
  assert.equal(attack(), true, 'after the quest');
});

test('review: a full pack is refused before any box: the chest, the cupboard, the ring again', async (t) => {
  const fill = (f) => { while (f.p.getInventory().getFreeSlots() > 0) f.give(I().LOBSTER); };
  const c = fixture(t, [3501, 9967, 0]);
  setStage(c, 1);
  fill(c);
  await c.clickLoc(locId('fenk_chest_open'), 3500, 9967, 1);
  c.step(4);
  assert.equal(c.read(), null);
  assert.ok(c.messages().includes("You don't have enough inventory space."));
  assert.equal(c.amount(I().CAVERN_KEY), 0);

  const g = fixture(t, [3550, 3554, 2]);
  const tower = g.npc(TOWER_FENK(), [3551, 3554, 2]);
  quest.setStage(g.p, 7);
  g.p.getSkillManager().setCurrentLevels(core.Skill.THIEVING, 25, false);
  fill(g);
  const from = g.tick();
  await g.clickNpc(tower, 3);
  g.step(2);
  assert.ok(!g.messages(from).includes('You steal the Ring of Charos from Fenkenstrain.'));
  assert.ok(g.messages(from).includes("You don't have enough inventory space."));
});
