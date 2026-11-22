// From server/: node --test tests/cabin-fever-scenes.test.cjs (after yarn build).
// Cabin Fever against the user's RSProx capture `CabinFever` (rev 242.1, a whole run), on real
// Players, the real map, the real dialogue runtime and the real task scheduler (issue #6500):
// - the rope swing drops the player beside the mast and walks them round it (ticks 861-873);
// - the end cutscene in The Other Inn (ticks 2124-2312), and a logout inside it;
// - the Mos Le'Harmless pirates, traders and Mama speak their Book o' Piracy transcripts.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
process.env.BROWSER_HOST = '1';
process.env.DISABLE_PLAYER_BOTS = '1';
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

let core;
let quest;
let next = 1;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[1816, 4830], [3665, 2980], [3678, 2953]]) core.RegionManager.loadMapFiles(x, y);
  require('../plugins/npcs/NpcDialogues.plugin').register(PM.createApi('CabinFeverDialogues'));
  require('../plugins/quests/quests/CabinFever.Quest')(PM.createApi('CabinFeverScenes'));
  quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'cabin_fever');
});

/** A logged-in player (account loading isolated) whose ticks run tasks, then movement. */
function login(t, [x, y, z], stage) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  let connected = true;
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => connected,
    send: () => true, close() { connected = false; }, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const p = new Player(session);
  session.setPlayer(p);
  p.setUsername(`cabinscene${next++}`);
  p.setAttribute('bot-skip-persistence', true);
  p.setLocation(new core.Location(x, y, z));
  t.mock.method(p, 'onAdd', () => {});
  core.World.getPlayers().add(p);
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  quest.setStage(p, stage);
  const chat = [];
  const sender = p.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  // Chat text only: a held line's emptied "Click here to continue" is left out.
  t.mock.method(sender, 'sendString', (text, ...rest) => {
    if (typeof text === 'string' && text.length > 1 && text !== 'Click here to continue') chat.push(text);
    return sendString(text, ...rest);
  });
  t.after(() => {
    if (p.isRegistered()) logout(p);
    core.TaskManager.cancelTasks(p);
    core.World.unregisterPlayerPosition(p);
  });
  /** `click`: a walk click read this tick, after the tasks and before movement, as World.process reads packets. */
  const tick = (count = 1, click = null) => {
    for (let i = 0; i < count; i++) {
      core.World.processCycle++;
      core.TaskManager.process();
      if (click) p.getMovementQueue().requestWalk(new core.Location(...click));
      p.getMovementQueue().process();
      // The player update after movement places a teleported player (World.process order).
      p.setNeedsPlacement(false);
      p.resetUpdating?.();
    }
  };
  return { p, chat, tick };
}

function logout(p) {
  p.requestLogout();
  core.World.process();
  assert.equal(p.isRegistered(), false, 'ordinary logout completed');
}

const xyz = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
const sceneNpcs = (p) => [...core.World.getNpcs()].filter((npc) => npc?.__questSceneOwner === p);

test('the swing drops beside the mast and walks round it before the grab, as live does', (t) => {
  const { p, tick } = login(t, [1816, 4830, 2], 3);
  p.getInventory().adds(core.ItemIdentifiers.ROPE, 1);
  t.mock.method(Math, 'random', () => 0.99); // no fall
  assert.equal(PM.emitItemOnObject({ player: p, itemId: core.ItemIdentifiers.ROPE, objectId: 11292,
    object: new core.GameObject(11292, p.getLocation().clone(), 10, 0, null), handled: false }), true);
  // Capture ticks from the rope (854): the drop at 861, one tile a tick from 862 with a pause at
  // 867, the last step 869, the grab 871 and the swing 873.
  const tiles = [];
  for (let after = 1; after <= 19; after++) {
    tick();
    tiles.push(xyz(p));
  }
  assert.deepEqual(tiles[6], [1816, 4832, 1], '861: dropped beside the mast, not on the rope tile');
  assert.deepEqual(tiles.slice(7, 15), [
    [1815, 4832, 1], [1814, 4831, 1], [1814, 4830, 1], [1814, 4829, 1], [1815, 4829, 1],
    [1815, 4829, 1], [1816, 4829, 1], [1816, 4830, 1],
  ], '862-869: round the west side of the mast');
  assert.deepEqual(tiles[16], [1817, 4830, 1], '871: the grab');
  assert.deepEqual(tiles[18], [1822, 4830, 1], '873: across on the enemy deck');
  assert.equal(p.getMovementQueue().isMovementBlocked(), true, 'still held until the rope falls');
  tick(3);
  assert.equal(p.getMovementQueue().isMovementBlocked(), false, 'released with "The rope falls off the mast!"');
});

for (const at of [9, 12, 15]) test(`a walk click read on step tick ${at} round the mast changes nothing`, (t) => {
  // Live's own run has a move_gameclick mid-walk (tick 869) that changes nothing.
  const { p, tick } = login(t, [1816, 4830, 2], 3);
  p.getInventory().adds(core.ItemIdentifiers.ROPE, 1);
  t.mock.method(Math, 'random', () => 0.99);
  PM.emitItemOnObject({ player: p, itemId: core.ItemIdentifiers.ROPE, objectId: 11292,
    object: new core.GameObject(11292, p.getLocation().clone(), 10, 0, null), handled: false });
  const path = [[1815, 4832], [1814, 4831], [1814, 4830], [1814, 4829], [1815, 4829], [1815, 4829], [1816, 4829], [1816, 4830]];
  const tiles = [];
  for (let after = 1; after <= 15; after++) {
    tick(1, after === at ? [1812, 4833, 1] : null);
    if (after >= 8) tiles.push(xyz(p).slice(0, 2));
  }
  assert.deepEqual(tiles, path, "one tile a tick on live's path");
  tick(4);
  assert.deepEqual(xyz(p), [1822, 4830, 1], 'swung across as usual');
});

/** Starts the end cutscene the way the dialogue runtime's action does, from stage 8 and three holes. */
function sinkShip(t) {
  const f = login(t, [1817, 4834, 1], 8);
  f.p.getPacketSender().sendVarbit(1750, 3); // fever_holes_in_the_hull
  // Saved as the plugin saves its varbits: the whole base varp, in its attribute.
  const { baseVar } = core.CacheDefinitions.getVarbit(1750);
  f.p.setAttribute(`quest.cabin_fever.var${baseVar}`, f.p.getPacketSender().getVarp(baseVar));
  PM.emitCustomEvent('npc-dialogue:action', { player: f.p, stepId: '7Zv7QG', handled: false });
  f.tick(2); // whenIdle: the chatbox is clear
  return f;
}

test('the end cutscene plays in a copy of The Other Inn on the capture timeline, then completes the quest', (t) => {
  const { p, chat, tick } = sinkShip(t);
  assert.equal(chat.at(-1), "Ye've done it lad! They're sunk now!", '2124: held on the deck');
  assert.equal(p.getMovementQueue().isMovementBlocked(), true);
  tick(3);
  assert.equal(chat.at(-1), "Let's head to the island!", '2127');
  tick(6);
  const area = p.getArea();
  assert.ok(area instanceof core.TemplatedInstanceArea, '2133: the inn copy');
  assert.equal(p.getPacketSender().getVarbit(542), 1, 'cutscene_status');
  const source = area.toSource(p.getLocation());
  assert.deepEqual([source.getX(), source.getY(), source.getZ()], [3665, 2980, 0]);
  tick(3);
  const cast = sceneNpcs(p).map((npc) => npc.getId()).sort();
  assert.deepEqual(cast, [4012, 4021], '2136: the cutscene Bill and Mama');
  const bill = sceneNpcs(p).find((npc) => npc.getId() === 4012);
  const said = [];
  t.mock.method(bill, 'forceChat', (text) => { said.push(text); return bill; });
  tick(7);
  assert.equal(chat.at(-1), "Bill? You look like you've been to Davey Jones' locker and back.", '2143: Mama');
  tick(9);
  assert.equal(chat.at(-1), "Oh, Miss La'Fiette, if only I were that lucky.", '2152');
  tick(3);
  assert.deepEqual(said, ["Oh, Miss La'Fiette, if only", 'I were that lucky.'], 'overhead in the capture\'s two parts');
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BOOK_O_PIRACY), 0);
  tick(100 - 31);
  assert.equal(chat.at(-1), "Here, have this book. It'll learn ye how to be a pirate.", '2224');
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BOOK_O_PIRACY), 1, 'the book with that line');
  assert.equal(p.getPacketSender().getVarbit(1763), 1, 'fever_given_book');
  assert.equal(quest.isComplete(p), false);
  tick(178 - 100);
  assert.deepEqual(xyz(p), [3665, 2980, 0], '2302: the real inn');
  assert.equal(sceneNpcs(p).length, 0, 'the cast is gone');
  assert.equal(p.getMovementQueue().isMovementBlocked(), true, 'held behind the fade until 2307');
  tick(5);
  assert.equal(p.getMovementQueue().isMovementBlocked(), false);
  tick(3);
  assert.equal(quest.isComplete(p), true, '2310: complete');
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BOOK_O_PIRACY), 1, 'one book, not two');
  assert.equal(p.getPacketSender().getVarbit(1750), 0, 'the battle varbits are cleared');
});

test('with a full inventory the book waits for the real map, and only one is given', (t) => {
  const { p, tick } = sinkShip(t);
  const inventory = p.getInventory();
  while (inventory.getFreeSlots() > 0) inventory.adds(core.ItemIdentifiers.SHARK, 1);
  tick(100);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.BOOK_O_PIRACY), 0, 'no room in the inn: not handed over there');
  const groundBooks = () => core.World.getItems()
    .filter((item) => item.getItem().getId() === core.ItemIdentifiers.BOOK_O_PIRACY);
  assert.equal(groundBooks().length, 0, 'nothing dropped in the copy');
  tick(90);
  assert.equal(quest.isComplete(p), true);
  assert.equal(groundBooks().length + inventory.getAmount(core.ItemIdentifiers.BOOK_O_PIRACY), 1, 'one book in all');
  for (const item of groundBooks()) {
    const at = item.getPosition?.() ?? item.getLocation?.();
    assert.deepEqual([at.getX(), at.getY(), at.getZ()], [3665, 2980, 0], 'on the real inn floor');
  }
});

test('a logout inside the inn completes the quest and saves the player at the inn', (t) => {
  const { p, tick } = sinkShip(t);
  tick(40);
  assert.ok(p.getArea() instanceof core.TemplatedInstanceArea);
  logout(p);
  assert.equal(quest.isComplete(p), true);
  assert.deepEqual(xyz(p), [3665, 2980, 0], 'saved on the scene exit');
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BOOK_O_PIRACY), 1);
});

test('a logout on the deck before the inn opens finishes the quest at the next login', (t) => {
  const { p, tick } = sinkShip(t);
  tick(2);
  logout(p);
  const { p: back } = login(t, xyz(p), 8);
  back.setAttribute('quest.cabin_fever.var656', p.getAttribute('quest.cabin_fever.var656'));
  back.setAttribute('quest.cabin_fever.var657', p.getAttribute('quest.cabin_fever.var657'));
  back.setAttribute('quest.cabin_fever.var658', p.getAttribute('quest.cabin_fever.var658'));
  PM.emitCustomEvent('player:bootstrap-complete', { player: back });
  assert.equal(quest.isComplete(back), true);
  assert.deepEqual(xyz(back), [3665, 2980, 0], 'at The Other Inn');
});

/** Talk-to through the real dialogue runtime; the first line it sends. */
function talk(t, npcId, withBook) {
  const { p, chat } = login(t, [3678, 2953, 0], 9);
  if (withBook) p.getInventory().adds(core.ItemIdentifiers.BOOK_O_PIRACY, 1);
  const npc = core.NPC.create(npcId, new core.Location(3679, 2953, 0));
  PM.emitNpcInteraction({ player: p, npc, npcId, action: 'Talk-to', clickType: 1, handled: false });
  return chat;
}

test("Mos Le'Harmless speaks pirate to a player without the Book o' Piracy and plain words with it", (t) => {
  const N = core.NpcIdentifiers;
  // The capture's post-quest talks (book in the inventory): 4023 line 1, 4027 line 5, 4028 line 6, 4031 line 9.
  for (const [npcId, first] of [
    [N.PIRATE_6, "What's a landlubber like ye doin' here?"],
    [N.PIRATE_10, 'Good morning!'],
    [N.PIRATE_11, 'What ship did ye pull in on, stranger?'],
    [N.PIRATE_14, "Ain't ye the scurvy curr that killed my brother?"],
    [N.PIRATE_25, "What's yer business?"],
    [N.CHARLEY, 'I got fish, you got gold?'],
    [N.SMITH, "Yer standin' in me light stranger. Can I sell ye somethin' that'll make ye move?"],
    [N.JOE_2, 'Whadda ya want?'],
    [N.MIKE, 'Wanna buy some clothes? Good quality, none of yer rags.'],
    [N.MAMA, 'Hello stranger, you come for a drink?'],
  ]) {
    assert.ok(talk(t, npcId, true).includes(first), `${npcId} with the book: ${first}`);
    assert.ok(talk(t, npcId, false).includes('Hello!'), `${npcId} without the book: pirate-speak`);
  }
});
