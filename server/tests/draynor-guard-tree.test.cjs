// Run after `yarn build`: node --test tests/draynor-guard-tree.test.cjs
//
// The Draynor guard tree (wom_tree) with every plugin loaded, so Woodcutting's "Tree" handler is
// in play: Chop down never fells it, Talk to and the stew exchange play the guard's lines.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { NpcDialogue } = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
const { PlayerDialogue } = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');

const TREE = { x: 3085, y: 3243 };
let core, Plugin, next = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(TREE.x, TREE.y);
  PM.emitServerStartup({});
  Plugin = require('../plugins/areas/DraynorGuardTree.plugin');
});

after(() => PM.emitServerShutdown({}));

const ROBBERY_LINE = 'Someone smashed the wall when they were robbing the bank.';
const bankGuardSays = (p, npcId) => PM.emitCustomEvent('npc-dialogue:line', { player: p, npcId, step: { npc: ROBBERY_LINE }, text: ROBBERY_LINE, pages: [], skip: false });

function player(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setUsername(`guardtree${++next}`);
  p.setLocation(new Location(3086, 3245, 0));
  p.messages = [];
  p.anims = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, 'sendMessage', (text) => { p.messages.push(text); });
  t.mock.method(p, 'isRegistered', () => true);
  t.mock.method(p, 'performAnimation', (a) => { p.anims.push(a.getId()); });
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.after(() => { TaskManager.cancelTasks(p); });
  return p;
}

const id = (name) => core.CacheDefinitions.getObjId(name);
const tree = () => {
  const locId = core.CacheDefinitions.getLocId('wom_tree');
  const object = MapObjects.get(locId, new Location(TREE.x, TREE.y, 0), null);
  assert.ok(object, 'the guard tree stands at 3085,3243');
  return object;
};

function click(p, clickType) {
  const object = tree();
  const event = { player: p, object, objectId: object.getId(), clickType, location: { x: TREE.x, y: TREE.y, z: 0 }, handled: false };
  return PM.emitObjectInteraction(event);
}

function ticks(n) { for (let i = 0; i < n; i++) TaskManager.process(); }

/** What the open dialogue shows: a line's text, or the option menu. */
function current(p) {
  const d = p.getDialogueManager().getCurrent();
  if (d instanceof NpcDialogue) return `Guard: ${d.getText()}`;
  if (d instanceof PlayerDialogue) return `Player: ${d.getText()}`;
  if (d instanceof OptionDialogue) return `Options: ${d.getTitle()} ${d.getOptions().join(' | ')}`;
  return null;
}

/** Continues through the chain, collecting every shown entry until it ends or a menu opens. */
function play(p) {
  const shown = [];
  for (let i = 0; i < 20; i++) {
    const line = current(p);
    if (!line) break;
    shown.push(line);
    if (line.startsWith('Options:')) break;
    p.getDialogueManager().advance();
  }
  return shown;
}

function pick(p, option) {
  p.getDialogueManager().handleOption(option);
}

test('the tree is the guard tree in the cache: Chop down and Talk to', () => {
  const def = core.ObjectDefinition.forId(core.CacheDefinitions.getLocId('wom_tree'));
  assert.equal(def.getName(), 'Tree');
  assert.deepEqual(def.getInteractions().slice(0, 2), ['Chop down', 'Talk to']);
});

test('Chop down with an axe swings, then the guard complains; no logs, no stump, no woodcutting', (t) => {
  const p = player(t);
  p.getInventory().adds(core.ItemIdentifiers.BRONZE_AXE, 1);
  assert.equal(click(p, 1), true);
  assert.equal(p.anims.length, 1, 'axe animation');
  assert.ok(p.anims[0] > 0);
  assert.equal(current(p), null, 'nothing said while the axe swings');
  ticks(Plugin._test.CHOP_TICKS);
  assert.equal(p.anims.at(-1), -1, 'the swing stops');
  const line = current(p);
  assert.ok(Plugin._test.CHOP_LINES.some((l) => line === `Guard: ${l}`), line);
  ticks(30);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.LOGS), 0);
  assert.equal(p.getSkillManager().getExperience(core.Skill.WOODCUTTING), 0);
  assert.ok(tree(), 'the tree still stands');
});

test('a second click mid-swing queues no second complaint, and Talk to mid-swing wins', (t) => {
  const p = player(t);
  p.getInventory().adds(core.ItemIdentifiers.BRONZE_AXE, 1);
  click(p, 1);
  ticks(1);
  click(p, 1);
  assert.equal(p.anims.length, 1, 'one swing');
  ticks(1);
  assert.match(current(p), /^Guard: /);
  p.getDialogueManager().advance();
  ticks(3);
  assert.equal(current(p), null, 'no second complaint');

  click(p, 1);
  click(p, 2);
  ticks(Plugin._test.CHOP_TICKS + 1);
  assert.equal(current(p), 'Player: Hello?', 'the conversation is not replaced');
});

test('Chop down without an axe gives the no-axe message and no complaint', (t) => {
  const p = player(t);
  assert.equal(click(p, 1), true);
  assert.equal(p.messages.length, 1);
  assert.match(p.messages[0], /You need an axe/);
  ticks(3);
  assert.equal(current(p), null);
});

test('Talk to before hearing of the robbery sends the player to the bank guard', (t) => {
  const p = player(t);
  assert.equal(click(p, 2), true);
  assert.deepEqual(play(p), [
    'Player: Hello?',
    'Guard: Ssshhh! What do you want?',
    "Player: Well, it's not every day you see a man up a tree.",
    "Guard: I'm trying to observe a suspect. Leave me alone!",
    "Player: What's this all about?",
    "Guard: Hadn't you heard? You'd better go and talk to the other guard, the one by the bank door. He'll tell you all about it.",
    'Guard: Go on, ask him what\'s wrong with the bank wall. He loves when people ask him that.',
    'Player: Ok, if you say so..',
  ]);
});

test("the bank guard's robbery line unlocks the three questions", (t) => {
  const p = player(t);
  const bankGuard = core.CacheDefinitions.getNpcId('wom_bankguard');
  bankGuardSays(p, bankGuard);
  assert.equal(p.getAttribute(Plugin._test.HEARD_ROBBERY_ATTRIBUTE), true);
  click(p, 2);
  assert.deepEqual(play(p).slice(-1), [
    "Options: What would you like to say? This is about the bank robbery, right? | You're not being very subtle up there. | Can I do anything to help?",
  ]);
  pick(p, 3);
  assert.deepEqual(play(p), [
    'Player: Can I do anything to help?',
    "Guard: That's very kind of you. I'd rather like a nice bowl of stew, if you could fetch me one. I don't get many meal breaks.",
    'Player: You want a bowl of stew?',
    "Guard: If you wouldn't mind...",
    "Player: I'll think about it!",
  ]);
});

test('another NPC saying the same words unlocks nothing', (t) => {
  const p = player(t);
  bankGuardSays(p, core.CacheDefinitions.getNpcId('wom_bankguard') + 1);
  assert.notEqual(p.getAttribute(Plugin._test.HEARD_ROBBERY_ATTRIBUTE), true);
});

test('stew: kept, then given for 30 coins; the bowl drops 25 ticks later; Talk to meanwhile', (t) => {
  const p = player(t);
  p.getInventory().adds(id('stew'), 1);
  click(p, 2);
  assert.deepEqual(play(p), [
    'Player: Hello?',
    'Guard: Yes, what do you... I say, is that stew for me?',
    'Options: What would you like to say? Ok, take the stew! | No, I want to keep this stew!',
  ]);
  pick(p, 2);
  assert.deepEqual(play(p), [
    'Player: No, I want to keep this stew!',
    "Guard: Fair enough. But if you change your mind, I'll probably still be here.",
  ]);
  assert.equal(p.getInventory().getAmount(id('stew')), 1);

  click(p, 2);
  play(p);
  pick(p, 1);
  assert.deepEqual(play(p), [
    'Player: Ok, take the stew!',
    "Guard: Gosh, that's very kind of you! Here, have a few coins for your trouble...",
  ]);
  assert.equal(p.getInventory().getAmount(id('stew')), 0);
  assert.equal(p.getInventory().getAmount(id('coins')), Plugin._test.STEW_REWARD);

  click(p, 2);
  assert.deepEqual(play(p), ['Player: I think I should leave him in peace to finish his stew!']);
  ticks(Plugin._test.EATING_TICKS - 1);
  assert.deepEqual(p.messages, []);
  ticks(1);
  assert.deepEqual(p.messages, ['The guard drops the empty bowl out of the tree!']);
  const { x, y, z } = Plugin._test.BOWL_TILE;
  const bowl = core.ItemOnGroundManager.getGroundItem(p.getUsername(), id('bowl_empty'), new Location(x, y, z), p.getPrivateArea());
  assert.ok(bowl, 'empty bowl beside the tree');
  t.after(() => core.ItemOnGroundManager.deregister(bowl));
  click(p, 2);
  assert.equal(play(p)[0], 'Player: Hello?', 'after the bowl, he talks again');
});

test('stew used on the tree hands it over; other items are waved away', (t) => {
  const p = player(t);
  p.getInventory().adds(id('stew'), 1);
  const object = tree();
  const use = (itemId) => {
    const event = { player: p, object, objectId: object.getId(), item: new core.Item(itemId, 1), itemId, itemSlot: 0, interfaceType: 0, location: { x: TREE.x, y: TREE.y, z: 0 }, handled: false };
    PM.emitItemOnObject(event);
    return event;
  };
  assert.equal(use(id('stew')).handled, true);
  assert.deepEqual(play(p), [
    "Player: Here's some stew.",
    "Guard: Gosh, that's very kind of you! Here, have a few coins for your trouble...",
  ]);
  assert.equal(p.getInventory().getAmount(id('coins')), 30);
  ticks(Plugin._test.EATING_TICKS);

  p.getInventory().adds(core.ItemIdentifiers.BRONZE_AXE, 1);
  assert.equal(use(core.ItemIdentifiers.BRONZE_AXE).handled, true);
  assert.deepEqual(play(p), [
    'Guard: Why the demoninikin are you waving THAT at me?',
    "Player: Sorry, I thought you'd like it.",
    "Guard: Erm... No thanks! Now, if you don't mind, I'm trying to observe this suspect!",
    'Player: Sorry!',
  ]);
});
