// Run after `yarn build`: node --test tests/frozen-door.test.cjs
//
// The Frozen Door (rev 242 miniquest, quest-table id 165, varbit frozen_door 13175, completion 10): the
// messenger's letter, the key pieces (dropped only during the miniquest), the key and the door, and Ashuelot
// Reis's two conversations. The whole plugin set is loaded, the clicks go through the real dispatchers, and
// the conversations are played through the real transcript player.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const { questRowById } = require('../plugins/quests/QuestList.QuestRuntime');
const { __internals: drops } = require('../plugins/npcs/NpcDrops.plugin');

const QUEST_VARBIT = 13175;
const PIECE_VARBITS = { armadyl: 13176, bandos: 13177, zamorak: 13178, saradomin: 13179 };
const DESTROYED_VARBIT = 13181;
const STORY_VARBIT = 13182;
const LETTER = 26366;
const KEY = 26356;
const PIECES = [26358, 26360, 26362, 26364];
const MESSENGER = 11287;
const ASHUELOT = 11288;
const ASHUELOT_BANK = 11289;
const COMPLETE = 10;

let api;
let quest;
let Prison;
let next = 9300;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  api = { core: PluginManager.getCoreApi() };
  api.core.RegionManager.init();
  drops.loadDrops();
  Prison = require('../plugins/bosses/nex/Prison.Nex');
  quest = runtime.getRegisteredQuests().find((entry) => entry.name === 'The Frozen Door');
  assert.ok(quest, 'The Frozen Door registers');
});

/** A real player; the quest is set to `stage`, Desert Treasure I done unless `desert` is false. */
function makePlayer(t, { stage = 0, desert = true, story = 0, unlocked = false } = {}) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const player = new Player(null, new api.core.Location(2856, 5227, 0));
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  player.setIndex(next++);
  player.setRegistered?.(true);
  const dt1 = runtime.questNamed('Desert Treasure I');
  if (desert) dt1.setStage(player, dt1.completionValue ?? 15);
  quest.setStage(player, stage);
  player.setAttribute('frozen-door:story', story);
  player.getPacketSender().sendVarbit(STORY_VARBIT, story);
  player.setAttribute('nex:frozen-door-unlocked', unlocked);
  return player;
}

const login = (player) => PluginManager.emitPlayerLogin({ player, username: player.getUsername() || 'frozen_door_tester', isNewAccount: false });
const varbit = (player, id) => player.getPacketSender().getVarbit(id);

/** Plays the open conversation. picks[i] answers the i-th menu (1-based); returns the lines and menus. */
function play(player, picks = []) {
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const manager = player.getDialogueManager();
  const lines = [];
  const menus = [];
  const queue = [...picks];
  for (let step = 0; step < 400; step++) {
    const pending = MultiChatboxPrompt.getPending(player);
    if (pending && !manager.isActive()) {
      menus.push(pending.options);
      const pick = queue.shift();
      if (pick === undefined) return { lines, menus, open: true };
      MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: pick });
      continue;
    }
    const current = manager.getCurrent();
    if (!current) break;
    if (typeof current.getText === 'function') lines.push(current.getText());
    manager.advance();
  }
  return { lines, menus, open: false };
}

/** Tasks the plugins queue (timers); the test runs them by hand. */
function captureTasks(t) {
  const queued = [];
  t.mock.method(api.core.TaskManager, 'submit', (task) => { queued.push(task); });
  return queued;
}

/** The messenger the plugin spawns: a stand-in NPC, recorded; the removals too. */
function captureNpcs(t) {
  const spawned = [];
  const removed = [];
  t.mock.method(PluginManager, 'spawnNpc', (definition) => {
    const npc = {
      definition, registered: true, getId: () => definition.id, isRegistered() { return this.registered; },
      getLocation: () => new api.core.Location(definition.x, definition.y, definition.z ?? 0),
      setPositionToFace() {}, getIndex: () => 1, forceChat() {}, performAnimation() {},
      getCurrentDefinition: () => api.core.NpcDefinition.forId(definition.id),
    };
    if (definition.id === MESSENGER) spawned.push(npc);
    return npc;
  });
  t.mock.method(PluginManager, 'removeNpc', (npc) => { npc.registered = false; if (npc.definition?.id === MESSENGER) removed.push(npc); });
  return { spawned, removed };
}

const readLetter = (player) => PluginManager.emitItemAction({ player, interfaceId: 3214, item: new api.core.Item(LETTER, 1), itemId: LETTER, slot: 0, clickType: 1, option: 'Read', handled: false });

/** Runs the tasks queued so far (not the ones those queue in turn). */
const runAll = (queued) => { for (const task of queued.splice(0)) task.execute(); };

function talk(player, npcId, option = 1) {
  const definition = api.core.NpcDefinition.forId(npcId);
  const npc = api.core.NPC.create(npcId, new api.core.Location(2857, 5227, 0));
  return PluginManager.emitNpcInteraction({ player, npc, npcId, npcIndex: 2, clickType: option, location: { x: 2857, y: 5227, z: 0 }, handled: false, definition });
}

test('keyed on the cache: quest table id 165, completion 10, the varbits, the NPC forms, the items', () => {
  const row = questRowById(165, CacheDefinitions);
  assert.equal(row.displayname[0], 'The Frozen Door');
  assert.equal(row.endstate[0], COMPLETE);
  assert.equal(row.questpoints_override[0], 0);
  assert.equal(quest.varbitId, QUEST_VARBIT);
  assert.equal(quest.completionValue, COMPLETE);
  assert.equal(quest.questPoints, 0);
  const names = CacheDefinitions.getVarbitNames();
  for (const [id, name] of [[13175, 'frozen_door'], [13176, 'frozen_door_armadyl_piece'], [13177, 'frozen_door_bandos_piece'],
    [13178, 'frozen_door_zamorak_piece'], [13179, 'frozen_door_saradomin_piece'], [13181, 'nex_message_destroyed'], [13182, 'nex_story_npc']]) {
    assert.equal(names.get(id), name);
    assert.equal(CacheDefinitions.getVarbitId(name), id);
  }
  assert.equal(CacheDefinitions.getNpcId('nex_messenger'), MESSENGER);
  assert.equal(CacheDefinitions.getNpcId('nex_story_npc_1op'), ASHUELOT);
  assert.equal(CacheDefinitions.getNpcId('nex_story_npc_3op'), ASHUELOT_BANK);
  assert.equal(CacheDefinitions.getObjId('nex_message'), LETTER);
  assert.equal(CacheDefinitions.getObjId('nex_frozen_key'), KEY);
  assert.deepEqual(['armadyl', 'bandos', 'zamorak', 'saradomin'].map((god) => CacheDefinitions.getObjId(`nex_frozen_key_${god}`)), PIECES);
});

test('Ashuelot is two multi-NPCs on varbit 13182: outer (11295) at 0, inner (11296) at 1 (talk only) and 2 (bank)', () => {
  const at = (id, value) => CacheDefinitions.resolveNpc(id, { getVarp: () => 0, getVarbit: (bit) => (bit === STORY_VARBIT ? value : 0) })?.id;
  assert.deepEqual([0, 1, 2, 3].map((value) => at(11295, value)), [ASHUELOT, undefined, undefined, undefined]);
  assert.deepEqual([0, 1, 2, 3].map((value) => at(11296, value)), [undefined, ASHUELOT, ASHUELOT_BANK, undefined]);
  const spawns = require('../data/definitions/npc-spawns.json');
  const all = JSON.stringify(spawns);
  assert.equal(/"id":\s*11289/.test(all), false, 'the old fixed bank form is replaced by the multi-NPC');
  const find = (id) => { const found = []; (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.id === id) found.push(o); Object.values(o).forEach(walk); } })(spawns); return found; };
  const inner = find(11296);
  assert.equal(inner.length, 1);
  assert.deepEqual([inner[0].x, inner[0].y, inner[0].level ?? 0], [2904, 5205, 0]);
  const outer = find(11295);
  assert.equal(outer.length, 1);
  assert.equal(api.core.RegionManager.blocked(new api.core.Location(outer[0].x, outer[0].y, outer[0].level ?? 0), null), false, 'the outer Ashuelot stands on a free tile');
});

test('key piece drops follow the miniquest: only while it is started and not complete, through the real drop roll', (t) => {
  const rolls = (player, tableId) => {
    const table = [...drops.tablesByNpc.values()].flat().find((candidate) => candidate.table_id === tableId);
    assert.ok(table, tableId);
    const random = Math.random;
    Math.random = () => 0;
    try {
      const definition = { getName: () => tableId };
      const npc = { getId: () => 0, getLocation: () => new api.core.Location(2870, 5280, 2), getDefinition: () => definition, getCurrentDefinition: () => definition };
      return drops.rollTable(table, player, npc).map((drop) => drop.itemId);
    } finally {
      Math.random = random;
    }
  };
  // a general's guaranteed piece and a bodyguard's 1/20 piece
  for (const [table, piece] of [['kreearra', 26358], ['general_graardor', 26360], ['commander_zilyana', 26364], ['kril_tsutsaroth', 26362], ['flight_kilisa', 26358], ['balfrug_kreeyath', 26362]]) {
    const label = `${table} (${piece})`;
    assert.equal(rolls(makePlayer(t, { stage: 0 }), table).includes(piece), false, `${label}: not started`);
    assert.equal(rolls(makePlayer(t, { stage: 1 }), table).includes(piece), true, `${label}: started`);
    assert.equal(rolls(makePlayer(t, { stage: 3 }), table).includes(piece), true, `${label}: door unsealed, not complete`);
    assert.equal(rolls(makePlayer(t, { stage: COMPLETE }), table).includes(piece), false, `${label}: complete`);
  }
});

test('the letter: reading it starts the miniquest; reading again changes nothing', (t) => {
  const player = makePlayer(t, { stage: 0 });
  player.getInventory().adds(LETTER, 1);
  assert.equal(readLetter(player), true, 'Read is handled');
  player.getPacketSender().sendInterfaceRemoval();
  assert.equal(quest.getStage(player), 1);
  assert.equal(varbit(player, QUEST_VARBIT), 1);
  quest.setStage(player, 3);
  readLetter(player);
  player.getPacketSender().sendInterfaceRemoval();
  assert.equal(quest.getStage(player), 3, 'a started quest is not set back');
});

test('the messenger: one delivery, the letter in the backpack, and he does not come back while it is held', (t) => {
  const tasks = captureTasks(t);
  const { spawned, removed } = captureNpcs(t);
  const player = makePlayer(t, { stage: 0 });
  login(player);
  assert.ok(tasks.length >= 1, 'the delivery is scheduled');
  runAll(tasks);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].definition.id, MESSENGER);
  assert.equal(spawned[0].definition.ownerOnly, true);
  const result = play(player);
  assert.equal(result.lines[0], "I have a letter for you. I'm told it's quite important. Please read it when you get a chance.");
  assert.equal(player.getInventory().getAmount(LETTER), 1);
  runAll(tasks);
  assert.equal(removed.length, 1, 'the messenger leaves after the delivery');
  // a relog with the letter in the backpack: no second messenger
  login(player);
  runAll(tasks);
  assert.equal(spawned.length, 1);
  // and nobody gets one before Desert Treasure I, or once the quest is started
  const early = makePlayer(t, { stage: 0, desert: false });
  login(early); runAll(tasks);
  const started = makePlayer(t, { stage: 1 });
  login(started); runAll(tasks);
  assert.equal(spawned.length, 1);
});

test('destroying the unread letter brings the messenger back with the next line each time (varbit 13181)', (t) => {
  const tasks = captureTasks(t);
  const { spawned } = captureNpcs(t);
  const player = makePlayer(t, { stage: 0 });
  const expected = [
    "Apparently you destroyed that last letter I gave you without reading it, or something like that. The sender doesn't appreciate that sort of thing, so I've got another one for you.",
    "Look, you can destroy that letter as many times as you want, but it won't change anything. The sender isn't the kind of individual who takes no for an answer, so for both of our sakes, please just read it.",
    "Please... don't keep doing this. You don't know who you're dealing with...",
    undefined, // the fourth: the messenger says nothing (a message only)
  ];
  login(player); runAll(tasks); play(player); runAll(tasks);
  for (const [index, line] of expected.entries()) {
    player.getInventory().delete(LETTER, 1);
    PluginManager.emitCustomEvent('destroy-item:destroyed', { player, itemId: LETTER, amount: 1 });
    assert.equal(varbit(player, DESTROYED_VARBIT), index + 1, `destroyed count ${index + 1}`);
    assert.ok(tasks.length >= 1, 'he is sent again');
    runAll(tasks);
    const result = play(player);
    if (line) assert.equal(result.lines[0], line); else assert.equal(result.lines.some((text) => /fear in his eyes/.test(text)), false, 'a message, not a spoken line');
    assert.equal(player.getInventory().getAmount(LETTER), 1, `letter ${index + 2}`);
    runAll(tasks);
  }
  assert.equal(spawned.length, 5);
  // after the letter is read, destroying it brings nobody
  quest.setStage(player, 1);
  player.getInventory().delete(LETTER, 1);
  PluginManager.emitCustomEvent('destroy-item:destroyed', { player, itemId: LETTER, amount: 1 });
  runAll(tasks);
  assert.equal(spawned.length, 5);
});

test('Assemble on a key piece reaches the key code through the real item-action dispatch (the hooks match the cache names)', (t) => {
  for (const id of PIECES) {
    const player = makePlayer(t, { stage: 1 });
    player.getInventory().adds(id, 1);
    const handled = PluginManager.emitItemAction({ player, interfaceId: 3214, item: new api.core.Item(id, 1), itemId: id, slot: 0, clickType: 1, option: 'Assemble', handled: false });
    assert.equal(handled, true, `Assemble on ${id}`);
    assert.equal(player.getDialogueManager().getCurrent().getText(), "You don't have enough pieces to assemble the key. It looks like you'll need four separate pieces in total.");
  }
});

test('the key: not enough pieces / all four, with the Wiki boxes; the door: stuck without it, unsealed with it', (t) => {
  const player = makePlayer(t, { stage: 1 });
  const inventory = player.getInventory();
  for (const id of PIECES.slice(0, 3)) inventory.adds(id, 1);
  Prison.assembleKey({ player });
  assert.equal(player.getDialogueManager().getCurrent().getText(), "You don't have enough pieces to assemble the key. It looks like you'll need four separate pieces in total.");
  inventory.adds(PIECES[3], 1);
  Prison.assembleKey({ player });
  assert.equal(player.getDialogueManager().getCurrent().getText(), 'You line up all four pieces of the key and they magically snap together.');
  assert.equal(inventory.getAmount(KEY), 1);
  for (const id of PIECES) assert.equal(inventory.getAmount(id), 0);
  assert.equal(quest.getStage(player), 2, 'the key is made');
  for (const bit of Object.values(PIECE_VARBITS)) assert.equal(varbit(player, bit), 1);
  // the door
  const keyless = makePlayer(t, { stage: 1 });
  const messages = [];
  t.mock.method(keyless, 'sendMessage', (text) => { messages.push(text); });
  Prison.openFrozenDoor({ player: keyless, objectId: 42840 });
  assert.equal(keyless.getDialogueManager().getCurrent().getText(), "You try to open the door, but it doesn't seem to budge.");
  assert.ok(messages.some((text) => text.startsWith('<col=7f007f>')), 'one of the laments as a game message');
  const unsealed = [];
  t.mock.method(player, 'sendMessage', (text) => { unsealed.push(text); });
  t.mock.method(api.core.TaskManager, 'submit', () => {});
  Prison.openFrozenDoor({ player, objectId: 42840 });
  assert.ok(unsealed.includes('You use the frozen key to unlock the door. It disintegrates as you do.'), JSON.stringify(unsealed));
  assert.equal(inventory.getAmount(KEY), 0);
  assert.equal(player.getAttribute('nex:frozen-door-unlocked'), true);
  assert.equal(quest.getStage(player), 3, 'the door is open: speak to Ashuelot');
  assert.equal(varbit(player, STORY_VARBIT), 0);
});

test("Ashuelot's first conversation: the Wiki's lines, then she leaves, the quest completes and she moves inside", (t) => {
  const tasks = captureTasks(t);
  const player = makePlayer(t, { stage: 3, unlocked: true });
  const messages = [];
  t.mock.method(player, 'sendMessage', (text) => { messages.push(text); });
  assert.equal(talk(player, ASHUELOT), true);
  const result = play(player);
  assert.equal(result.lines[0], 'Hello? Who are you? What is this place?');
  assert.equal(result.lines[1], "I'm... Ashuelot... Ashuelot Reis. But I don't understand... How are you here?");
  assert.equal(result.lines.at(-1), 'Good luck.');
  assert.equal(result.lines.length, 21);
  assert.ok(messages.includes('Ashuelot Reis departs for the inner section of the prison.'));
  runAll(tasks);
  assert.equal(quest.getStage(player), COMPLETE);
  assert.equal(varbit(player, QUEST_VARBIT), COMPLETE);
  assert.equal(varbit(player, STORY_VARBIT), 1, 'she is now the inner Ashuelot (Talk-to only)');
});

test("Ashuelot in the safe room: the intro once, then the menu; the bank form after the intro; each branch", (t) => {
  const player = makePlayer(t, { stage: COMPLETE, story: 1, unlocked: true });
  assert.equal(talk(player, ASHUELOT), true);
  let result = play(player, [4]); // I need to go.
  assert.equal(result.lines[0], 'You made it?');
  assert.equal(result.lines[3], "Still, they are nothing compared to the Angel of Death herself.");
  assert.deepEqual(result.menus[0], ['Tell me more about Nex.', 'Can I access my bank?', "I'd like to collect some items.", 'I need to go.']);
  assert.deepEqual(result.lines.slice(-2), ['I need to go.', 'Good luck out there.']);
  assert.equal(varbit(player, STORY_VARBIT), 2, 'after the intro she is the banking form');
  // later visits go straight to the menu
  assert.equal(talk(player, ASHUELOT_BANK), true);
  result = play(player, [1]); // Tell me more about Nex.
  assert.deepEqual(result.menus[0], ['Tell me more about Nex.', 'Can I access my bank?', "I'd like to collect some items.", 'I need to go.']);
  assert.equal(result.lines[0], 'Tell me more about Nex.');
  assert.equal(result.lines.length, 33);
  assert.equal(result.lines.at(-1), 'Of course.');
  talk(player, ASHUELOT_BANK);
  result = play(player, [2]); // Can I access my bank?
  assert.deepEqual(result.lines.slice(0, 2), ['Can I access my bank?', 'Of course.']);
});

test("the outer prison door (Prison.outerDoor) asks Ashuelot's leave: 'I can't let you go in there.' until she has been spoken to", (t) => {
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  const door = { getLocation: () => new api.core.Location(2858, 5227, 0), getFace: () => 0, getId: () => 42933, getType: () => 0 };
  const before = makePlayer(t, { stage: 3, unlocked: true, story: 0 });
  assert.equal(Prison.outerDoor({ player: before, object: door }), true);
  assert.equal(play(before).lines[0], "I can't let you go in there.");
  assert.equal(MultiChatboxPrompt.getPending(before), null, 'the door does not ask to go through');
  const after = makePlayer(t, { stage: COMPLETE, unlocked: true, story: 1 });
  assert.equal(Prison.outerDoor({ player: after, object: door }), true);
  assert.equal(MultiChatboxPrompt.getPending(after)?.title, 'Go through the door? It could be dangerous.');
  // and the event the door sends answers the same
  const request = { player: makePlayer(t, { stage: 3, unlocked: true, story: 0 }), blocked: false };
  PluginManager.emitCustomEvent('nex:prison-door', request);
  assert.equal(request.blocked, true);
});

test('a player who unsealed the door before the quest existed completes it at Ashuelot, the same way', (t) => {
  const tasks = captureTasks(t);
  const player = makePlayer(t, { stage: 0, unlocked: true, story: 0 });
  talk(player, ASHUELOT);
  play(player);
  runAll(tasks);
  assert.equal(quest.getStage(player), COMPLETE);
  assert.equal(varbit(player, STORY_VARBIT), 1);
});

test('relog at every stage keeps the stage, the destroyed count, the story form and the piece flags', (t) => {
  const tasks = captureTasks(t);
  captureNpcs(t);
  for (const stage of [0, 1, 2, 3, COMPLETE]) {
    const player = makePlayer(t, { stage, story: stage === COMPLETE ? 2 : stage === 3 ? 0 : 0, unlocked: stage >= 3 });
    player.setAttribute('frozen-door:destroyed', 2);
    if (stage === 2) player.getInventory().adds(KEY, 1);
    login(player);
    assert.equal(varbit(player, QUEST_VARBIT), stage, `stage ${stage}`);
    assert.equal(varbit(player, DESTROYED_VARBIT), 2, `destroyed at stage ${stage}`);
    assert.equal(varbit(player, STORY_VARBIT), stage === COMPLETE ? 2 : 0, `story at stage ${stage}`);
    runAll(tasks);
  }
  const holder = makePlayer(t, { stage: 1 });
  holder.getInventory().adds(PIECES[1], 1);
  login(holder);
  assert.equal(varbit(holder, PIECE_VARBITS.bandos), 1, 'a piece in the backpack sets its flag at login');
  assert.equal(varbit(holder, PIECE_VARBITS.armadyl), 0);
});

test('a full backpack: no messenger and no letter on the floor; the flag is held only for a letter that arrived; a lost letter is forgotten at login', (t) => {
  const tasks = captureTasks(t);
  const { spawned } = captureNpcs(t);
  const player = makePlayer(t, { stage: 0 });
  for (let slot = 0; slot < 28; slot++) player.getInventory().adds(1351, 1); // bronze axes, not stackable
  assert.equal(player.getInventory().getFreeSlots(), 0);
  login(player); runAll(tasks);
  assert.equal(spawned.length, 0, 'he waits for room');
  assert.ok(tasks.length >= 1, 'and tries again later');
  assert.notEqual(player.getAttribute('frozen-door:letter'), true, 'not held: nothing was delivered');
  player.getInventory().delete(1351, 1);
  runAll(tasks);
  assert.equal(spawned.length, 1, 'with a free slot he comes');
  play(player);
  assert.equal(player.getInventory().getAmount(LETTER), 1);
  assert.equal(player.getAttribute('frozen-door:letter'), true);
  // a letter lost some other way: not held after a relog, so a messenger is sent again
  const lost = makePlayer(t, { stage: 0 });
  lost.setAttribute('frozen-door:letter', true);
  login(lost);
  assert.equal(lost.getAttribute('frozen-door:letter'), false);
  runAll(tasks);
  assert.equal(spawned.length, 2);
  // a letter that is held (in the backpack) stays held
  const holder = makePlayer(t, { stage: 0 });
  holder.setAttribute('frozen-door:letter', true);
  holder.getInventory().adds(LETTER, 1);
  login(holder); runAll(tasks);
  assert.equal(holder.getAttribute('frozen-door:letter'), true);
  assert.equal(spawned.length, 2);
});

test('the messenger waits while the player is under water or busy, then comes', (t) => {
  const tasks = captureTasks(t);
  const { spawned } = captureNpcs(t);
  const { underwater } = require('../plugins/areas/data/fossil-island-underwater.json');
  const [minX, , minY] = underwater.box;
  const swimmer = makePlayer(t, { stage: 0 });
  let location = new api.core.Location(minX + 1, minY + 1, underwater.plane);
  t.mock.method(swimmer, 'getLocation', () => location);
  login(swimmer); runAll(tasks);
  assert.equal(spawned.length, 0, 'not underwater');
  assert.ok(tasks.length >= 1);
  location = new api.core.Location(2856, 5227, 0);
  runAll(tasks);
  assert.equal(spawned.length, 1, 'on dry land he comes');
  // busy: a conversation is open
  const busy = makePlayer(t, { stage: 0 });
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = api.core;
  busy.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, 'Something else is going on.'), new EndDialogue(1)));
  login(busy); runAll(tasks);
  assert.equal(spawned.length, 1, 'not in the middle of another conversation');
  busy.getDialogueManager().reset();
  busy.getPacketSender().sendInterfaceRemoval(); // the conversation is over and its chatbox closed
  runAll(tasks);
  assert.equal(spawned.length, 2);
  // an open interface or a fight counts too
  const fighting = makePlayer(t, { stage: 0 });
  t.mock.method(api.core.CombatFactory, 'inCombat', () => true);
  login(fighting); runAll(tasks);
  assert.equal(spawned.length, 2, 'not in a fight');
});

test("an old messenger's timer does not send a newer messenger away", (t) => {
  const tasks = captureTasks(t);
  const { spawned, removed } = captureNpcs(t);
  const player = makePlayer(t, { stage: 0 });
  login(player); runAll(tasks);           // messenger 1, its 150-tick timer is queued
  play(player);
  const [longTimer, shortRemoval] = tasks.splice(0); // deliver queued the 150-tick timer, the receive the short removal
  shortRemoval.execute();                  // messenger 1 leaves
  player.getInventory().delete(LETTER, 1);
  PluginManager.emitCustomEvent('destroy-item:destroyed', { player, itemId: LETTER, amount: 1 });
  runAll(tasks);                           // messenger 2 arrives
  assert.equal(spawned.length, 2);
  const before = removed.length;
  longTimer.execute();                     // messenger 1's old long timer
  assert.equal(removed.length, before, 'messenger 2 stays');
  assert.equal(spawned[1].registered, true);
});
