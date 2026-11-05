// Run after `yarn build`: node --test tests/brimhaven-dungeon.test.cjs
// Saniboch's fee and the Brimhaven Dungeon entrance, with every plugin loaded, the shipped map
// and a real Player (its own Inventory, MovementQueue, PacketSender and DialogueManager; only the
// network is stubbed).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const ROOT = path.resolve(__dirname, "..");

let PluginManager, core, Player, CacheDefinitions, ObjectDefinition, MapObjects, OptionDialogue, Entry;
const COINS = 995;
const ENTRANCE = [2743, 3153, 0];
const SANIBOCH_TILE = [2745, 3152, 0];

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(ROOT);
  ({ PluginManager } = require("../dist/plugins/PluginManager"));
  ({ CacheDefinitions } = require("../dist/game/cache/CacheDefinitions"));
  ({ ObjectDefinition } = require("../dist/game/definition/ObjectDefinition"));
  ({ MapObjects } = require("../dist/game/entity/impl/object/MapObjects"));
  ({ OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue"));
  PluginManager.loadPluginSwitches = () => ({ switches: new Map() });
  const quiet = [console.log, console.info, console.debug, console.warn];
  console.log = console.info = console.debug = console.warn = () => {};
  try {
    PluginManager.loadFromDirectory(path.join(ROOT, "plugins"));
    core = PluginManager.getCoreApi();
    core.RegionManager.init();
  } finally {
    [console.log, console.info, console.debug, console.warn] = quiet;
  }
  ({ Player } = require("../dist/game/entity/impl/player/Player"));
  Entry = require("../plugins/areas/BrimhavenDungeon.plugin")._test.Entry;
  core.RegionManager.loadMapFiles(ENTRANCE[0], ENTRANCE[1]);
});

/** A real player beside Saniboch, carrying `coins`; game messages are kept in `messages`. */
function visitor(t, coins = 0) {
  const p = new Player(null);
  p.setUsername(`brim${Math.floor(Math.random() * 1e6)}`);
  p.setLocation(new core.Location(SANIBOCH_TILE[0], SANIBOCH_TILE[1] - 1, 0));
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  p.isRegistered = () => true;
  p.getInventory().refreshItems = () => {};
  if (coins) p.getInventory().adds(COINS, coins);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (text) => { messages.push(text); return p.getPacketSender(); });
  return { p, messages };
}

/** What the player sees of the open dialogue: the line, or the options. */
function shown(p) {
  const prompt = core.MultiChatboxPrompt.getPending(p);
  if (prompt) return { options: prompt.options, prompt: true };
  const entry = p.getDialogueManager().getCurrent();
  if (!entry) return null;
  if (entry instanceof OptionDialogue) return { options: entry.getOptions() };
  return { text: entry.getText?.() };
}

/**
 * Plays the open dialogue to its end: continues every line and picks each option in `choices`
 * by its text. Returns the lines and menus shown on the way.
 */
function drive(p, choices = []) {
  const seen = [];
  const dialogues = p.getDialogueManager();
  for (let guard = 0; guard < 60; guard++) {
    for (let i = 0; i < 3; i++) core.TaskManager.process();
    const now = shown(p);
    if (!now) return seen;
    seen.push(now);
    if (now.options) {
      const wanted = choices.shift();
      const index = now.options.indexOf(wanted);
      assert.ok(index >= 0, `no option "${wanted}" in ${now.options.join(" | ")}`);
      if (now.prompt) {
        const { MultiChatboxPrompt } = core;
        MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: MultiChatboxPrompt.INTERFACE_ID, slot: index + 1 });
      } else {
        dialogues.handleResume(OptionDialogue.OPTIONS_WIDGET_ID, index + 1);
      }
    } else {
      dialogues.advance();
    }
  }
  assert.fail("the dialogue never ended");
}

const lines = (seen) => seen.filter((entry) => entry.text).map((entry) => entry.text.replace(/<br>/g, " ").replace(/\s+/g, " "));
const coinsOf = (p) => p.getInventory().getAmount(COINS);
const varbit = (p, name) => p.getPacketSender().getVarbit(CacheDefinitions.getVarbitId(name));
const at = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];

/** Saniboch as the NPC option packet hands him over: a real NPC, his definition, the clicked option. */
function clickSaniboch(p, clickType) {
  const id = CacheDefinitions.getNpcId("tribesman_doorman");
  const npc = new core.NPC(id, new core.Location(...SANIBOCH_TILE));
  const definition = core.NpcDefinition.forId(id);
  return PluginManager.emitNpcInteraction({
    player: p, npc, definition, npcId: id, npcIndex: -1, clickType,
    location: { x: SANIBOCH_TILE[0], y: SANIBOCH_TILE[1], z: 0 }, handled: false,
  });
}

const talkTo = (p) => assert.equal(clickSaniboch(p, 1), true);
const payNpc = (p) => assert.equal(clickSaniboch(p, 3), true);

/** A click on the entrance as the client sends it: the base multiloc and the variant this player sees. */
function clickEntrance(p) {
  const object = MapObjects.get(CacheDefinitions.getLocId("dungeon_tree_closed"), new core.Location(...ENTRANCE), null);
  assert.ok(object, "the entrance is on the map");
  const definition = ObjectDefinition.forPlayer(object.getId(), p);
  const event = { player: p, object, objectId: object.getId(), definition, clickType: 1, location: { x: ENTRANCE[0], y: ENTRANCE[1], z: 0 }, handled: false };
  PluginManager.emitObjectInteraction(event);
  return { event, option: definition.getInteractions()[0] };
}

test("Pay with 1,000,000 coins or more: the recorded three-way menu; permanent access opens the entrance", (t) => {
  const { p } = visitor(t, 1000000);
  payNpc(p);
  const seen = drive(p, ["Pay 1,000,000 coins for permanent access"]);
  assert.deepEqual(seen[0].options, ["Pay 875 coins to enter once", "Pay 1,000,000 coins for permanent access", "Cancel"]);
  assert.deepEqual(lines(seen), [
    "You give Saniboch 1,000,000 coins for permanent access to the dungeon.",
    "Many thanks. You may now pass the door as many times as you wish, and I will not charge you again. May your death be a glorious one!",
  ]);
  assert.equal(coinsOf(p), 0, "exactly enough coins is enough");
  assert.equal(varbit(p, "karam_dungeon_permanentaccess"), 1);
  assert.equal(varbit(p, "karam_dungeon_doordata"), 8, "as recorded (rsprox 234/3275)");

  // Permanent access: Enter twice, never charged again.
  for (let visit = 0; visit < 2; visit++) {
    p.setLocation(new core.Location(SANIBOCH_TILE[0], SANIBOCH_TILE[1], 0));
    const { event, option } = clickEntrance(p);
    assert.equal(option, "Enter");
    assert.equal(event.handled, true);
    core.TaskManager.process();
    core.TaskManager.process();
    assert.deepEqual(at(p), [2713, 9564, 0]);
  }
  assert.equal(varbit(p, "karam_dungeon_permanentaccess"), 1);
});

test("one visit for 875 coins: Talk-to takes the fee, the entrance opens once, and going in uses it up", (t) => {
  const { p } = visitor(t, 1000);
  assert.equal(clickEntrance(p).option, "Pay", "unpaid, the entrance offers Pay");
  talkTo(p);
  const seen = drive(p, ["Can I go through that door please?", "Okay, here's 875 coins."]);
  assert.deepEqual(lines(seen).slice(0, 2), ["Good day to you, Bwana.", "Can I go through that door please?"]);
  assert.ok(lines(seen).includes("Most certainly, but I must charge you the sum of 875 coins first."));
  assert.ok(lines(seen).includes("You give Saniboch 875 coins."));
  assert.equal(coinsOf(p), 125);
  assert.equal(varbit(p, "karam_dungeon_doordata") & 1, 1);

  // Asking again: already paid, nothing more taken.
  talkTo(p);
  const again = drive(p, ["Can I go through that door please?"]);
  assert.ok(lines(again).includes("Most certainly, you have already given me lots of nice coins."));
  assert.equal(coinsOf(p), 125);

  // A double click on Enter goes in once.
  const first = clickEntrance(p);
  assert.equal(first.option, "Enter");
  clickEntrance(p);
  core.TaskManager.process();
  core.TaskManager.process();
  assert.deepEqual(at(p), [2713, 9564, 0]);
  assert.equal(varbit(p, "karam_dungeon_doordata"), 0, "the visit is used up");

  p.setLocation(new core.Location(SANIBOCH_TILE[0], SANIBOCH_TILE[1], 0));
  assert.equal(clickEntrance(p).option, "Pay");
});

test("Pay below 875 coins sends the player off; between 875 and 1,000,000 it asks Pay 875 coins to enter?", (t) => {
  const poor = visitor(t, 874);
  payNpc(poor.p);
  assert.deepEqual(lines(drive(poor.p)), [
    "I'll want 875 coins to let you enter; this is a dungeon for the more wealthy discerning adventurer. Begone with you, riff raff.",
  ]);
  assert.equal(coinsOf(poor.p), 874);

  const middling = visitor(t, 875);
  // The entrance's Pay "automatically attempts to pay Saniboch for entry".
  assert.equal(clickEntrance(middling.p).event.handled, true);
  const seen = drive(middling.p, ["Yes"]);
  assert.deepEqual(seen[0].options, ["Yes", "No"]);
  assert.deepEqual(lines(seen), ["You give Saniboch 875 coins.", "Many thanks. You may now pass the door. May your death be a glorious one!"]);
  assert.equal(coinsOf(middling.p), 0);
  assert.equal(varbit(middling.p, "karam_dungeon_doordata") & 1, 1);

  const declined = visitor(t, 5000);
  payNpc(declined.p);
  drive(declined.p, ["No"]);
  assert.equal(coinsOf(declined.p), 5000);
});

test("coins dropped mid-conversation: the payment line takes nothing and opens nothing", (t) => {
  const { p } = visitor(t, 875);
  payNpc(p);
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  assert.deepEqual(shown(p).options, ["Yes", "No"]);
  p.getInventory().deleteNumber(COINS, 1);
  const seen = drive(p, ["Yes"]);
  assert.deepEqual(lines(seen), [
    "I'll want 875 coins to let you enter; this is a dungeon for the more wealthy discerning adventurer. Begone with you, riff raff.",
  ]);
  assert.equal(coinsOf(p), 874);
  assert.equal(varbit(p, "karam_dungeon_doordata"), 0);
});

test("paid once, Pay offers permanent access; with it, he lets the player straight in", (t) => {
  const { p } = visitor(t, 1000875);
  payNpc(p);
  drive(p, ["Pay 875 coins to enter once"]);
  assert.equal(coinsOf(p), 1000000);
  payNpc(p);
  const seen = drive(p, ["Can I pay you for permanent access?", "Okay, here's 1,000,000 coins."]);
  assert.equal(lines(seen)[0], "You have already given me lovely coins, so you may go in, and may your death be a glorious one!");
  assert.equal(coinsOf(p), 0);
  assert.equal(varbit(p, "karam_dungeon_doordata"), 8, "permanent access replaces the paid visit");
  payNpc(p);
  assert.deepEqual(lines(drive(p)), ["You have already given me lots of nice coins, you may go in."]);
});

test("payment is kept across logins: the varbits are sent again from the saved attributes", (t) => {
  const { p } = visitor(t);
  p.setAttribute(Entry.PERMANENT_ATTRIBUTE, true);
  PluginManager.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.equal(varbit(p, "karam_dungeon_permanentaccess"), 1);
});

test("Enter holds the player for the tick; moved or dead by then, they stay out and keep their visit", (t) => {
  const { p } = visitor(t, 875);
  p.setAttribute(Entry.ENTRY_PAID_ATTRIBUTE, true);
  Entry.syncVarbits(p);
  clickEntrance(p);
  assert.equal(p.getMovementQueue().isMovementBlocked(), true, "no walking off during the pick-up");
  p.moveTo(new core.Location(3222, 3218, 0));
  core.TaskManager.process();
  core.TaskManager.process();
  assert.deepEqual(at(p), [3222, 3218, 0]);
  assert.equal(p.getMovementQueue().isMovementBlocked(), false);
  assert.equal(varbit(p, "karam_dungeon_doordata") & 1, 1, "the paid visit is kept");

  p.setLocation(new core.Location(SANIBOCH_TILE[0], SANIBOCH_TILE[1], 0));
  clickEntrance(p);
  p.setHitpoints(0);
  core.TaskManager.process();
  core.TaskManager.process();
  assert.deepEqual(at(p), SANIBOCH_TILE);
  assert.equal(varbit(p, "karam_dungeon_doordata") & 1, 1);
});

test("paying and going in leave Banisoch's back-door bits alone", (t) => {
  const { p } = visitor(t, 875);
  p.getPacketSender().sendVarbit(CacheDefinitions.getVarbitId("karam_dungeon_backdoor"), 3);
  payNpc(p);
  drive(p, ["Yes"]);
  assert.equal(varbit(p, "karam_dungeon_doordata"), 7);
  p.setLocation(new core.Location(SANIBOCH_TILE[0], SANIBOCH_TILE[1], 0));
  clickEntrance(p);
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(varbit(p, "karam_dungeon_backdoor"), 3);
  assert.equal(varbit(p, "karam_dungeon_doordata"), 6);
});

test("Talk-to without 875 coins: he names the fee, and the player can't pay it", (t) => {
  const { p } = visitor(t, 100);
  talkTo(p);
  const seen = drive(p, ["Can I go through that door please?", "I haven't got that much money with me."]);
  assert.ok(lines(seen).includes("Most certainly, but I must charge you the sum of 875 coins first."));
  assert.ok(lines(seen).at(-1).startsWith("I'll want 875 coins to let you enter"));
  assert.equal(coinsOf(p), 100);
});

test("paid once, asking for permanent access without 1,000,000: the 875 offer takes nothing more", (t) => {
  const { p } = visitor(t, 2000);
  payNpc(p);
  drive(p, ["Yes"]);
  assert.equal(coinsOf(p), 1125);
  payNpc(p);
  const seen = drive(p, ["Can I pay you for permanent access?", "Okay, here's 875 coins."]);
  assert.ok(lines(seen).includes("Then perhaps you would rather pay 875 coins for one visit."));
  assert.equal(coinsOf(p), 1125, "not charged twice for one visit");
  assert.equal(varbit(p, "karam_dungeon_doordata") & 1, 1);
});

// The vines. Vine 1 at (2690,9564): the entrance side is east (2691), the deeper side west (2689).
const VINE = [2690, 9564, 0];
const OUTER = [2691, 9564, 0];
const INNER = [2689, 9564, 0];

function vineAt(tile = VINE) {
  core.RegionManager.loadMapFiles(tile[0], tile[1]);
  return MapObjects.get(CacheDefinitions.getLocId("karam_dungeon_vineblocking1"), new core.Location(...tile), null) ?? null;
}

/** A real player on `tile` with `woodcutting`, holding `items`. */
function cutter(t, tile, woodcutting, items = []) {
  const { p, messages } = visitor(t);
  p.setLocation(new core.Location(...tile));
  p.getSkillManager().setCurrentLevel(core.Skill.WOODCUTTING, woodcutting, false).setMaxLevels(core.Skill.WOODCUTTING, woodcutting, false);
  for (const name of items) p.getInventory().adds(CacheDefinitions.getObjId(name), 1);
  p.setNeedsPlacement(false);
  return { p, messages };
}

function chop(p) {
  const object = vineAt();
  assert.ok(object, "the vine stands");
  const definition = ObjectDefinition.forPlayer(object.getId(), p);
  const event = { player: p, object, objectId: object.getId(), definition, clickType: 1, location: { x: VINE[0], y: VINE[1], z: 0 }, handled: false };
  PluginManager.emitObjectInteraction(event);
  return event;
}

/** One game tick for this player: tasks, then their movement. */
function tick(p) {
  core.TaskManager.process();
  p.getMovementQueue().process();
}

test("going deeper: an axe and level 10; a roll every 2 ticks, then through, and the vine back a tick later", (t) => {
  const { p, messages } = cutter(t, OUTER, 10, ["bronze_axe"]);
  t.mock.method(Math, "random", () => 0);
  assert.equal(chop(p).handled, true);
  assert.deepEqual(messages, ["You try to chop through the vines."]);
  tick(p);
  assert.ok(vineAt(), "still standing after one tick");
  tick(p);
  assert.deepEqual(messages.slice(0, 2), ["You try to chop through the vines.", "You hack your way through the vines."]);
  // The entrance vine is the Karamja medium diary's "chop the vines" task (#2424).
  assert.match(messages[2], /Well done! You have completed a medium task in the Karamja area/);
  assert.equal(vineAt(), null, "cut, for everyone");
  tick(p);
  assert.ok(vineAt(), "back a tick later");
  for (let i = 0; i < 3; i++) tick(p);
  assert.deepEqual(at(p), INNER);
  assert.equal(p.hasFlag(require("../plugins/areas/brimhavendungeon/Vines.BrimhavenDungeon").IGNORE_CLIPPING_FLAG), false, "clipping is back");
});

test("going deeper needs the axe and the level; a blessed axe won't do", (t) => {
  const low = cutter(t, OUTER, 9, ["bronze_axe"]);
  chop(low.p);
  assert.deepEqual(low.messages, ["You need a Woodcutting level of 10 to chop through these vines."]);
  const bare = cutter(t, OUTER, 99);
  chop(bare.p);
  assert.deepEqual(bare.messages, ["You don't have an axe which you can use."]);
  const blessed = cutter(t, OUTER, 99, ["blessed_axe"]);
  chop(blessed.p);
  assert.deepEqual(blessed.messages, ["You don't have an axe which you can use."]);
  for (const { p } of [low, bare, blessed]) {
    for (let i = 0; i < 4; i++) tick(p);
    assert.deepEqual(at(p), OUTER);
  }
});

test("going back out needs no axe or level: cut by hand", (t) => {
  const { p, messages } = cutter(t, INNER, 1);
  chop(p);
  tick(p);
  tick(p);
  assert.deepEqual(messages, ["You try to chop through the vines.", "You hack your way through the vines."]);
  for (let i = 0; i < 4; i++) tick(p);
  assert.deepEqual(at(p), OUTER);
});

test("missed rolls keep chopping; walking off stops it; a second click doesn't cut twice", (t) => {
  const { p, messages } = cutter(t, OUTER, 10, ["bronze_axe"]);
  const random = t.mock.method(Math, "random", () => 0.999);
  chop(p);
  chop(p);
  for (let i = 0; i < 8; i++) tick(p);
  assert.ok(vineAt(), "no luck yet");
  assert.equal(messages.filter((text) => text.startsWith("You hack")).length, 0);
  random.mock.mockImplementation(() => 0);
  p.getMovementQueue().addSteps(new core.Location(2692, 9564, 0));
  for (let i = 0; i < 4; i++) tick(p);
  assert.deepEqual(at(p), [2692, 9564, 0]);
  assert.ok(vineAt(), "walking off stopped the chopping");
  assert.equal(messages.filter((text) => text.startsWith("You hack")).length, 0);
});

test("the cut chance is the Wiki's chart: bronze about 25% at 1 and 78% at 99, dragon all but certain from level 4", () => {
  const { cutChance } = require("../plugins/areas/brimhavendungeon/Vines.BrimhavenDungeon");
  assert.equal(cutChance(1, { tier: 0 }), 65 / 256);
  assert.equal(cutChance(99, { tier: 0 }), 201 / 256);
  assert.ok(cutChance(4, { tier: 7 }) >= 255 / 256, "the Wiki chart reads 100%");
  assert.ok(cutChance(1, { tier: 7 }) < 1 && cutChance(1, { tier: 7 }) > 0.9);
});

test("a vine cut and regrown since the click is still chopped: the standing one is used", (t) => {
  const { p, messages } = cutter(t, OUTER, 61, ["dragon_axe"]);
  t.mock.method(Math, "random", () => 0);
  const stale = vineAt();
  // Someone else cuts it and it regrows before this player's click arrives.
  core.ObjectManager.deregister(stale, true);
  core.ObjectManager.register(new core.GameObject(stale.getId(), stale.getLocation().clone(), stale.getType(), stale.getFace(), null), true);
  const event = { player: p, object: stale, objectId: stale.getId(), definition: ObjectDefinition.forPlayer(stale.getId(), p), clickType: 1, location: { x: VINE[0], y: VINE[1], z: 0 }, handled: false };
  PluginManager.emitObjectInteraction(event);
  for (let i = 0; i < 6; i++) tick(p);
  assert.ok(messages.includes("You hack your way through the vines."));
  assert.deepEqual(at(p), INNER);
});

test("a rake used on the Brimhaven vines does nothing: they are chopped down, not cleared", (t) => {
  const { p } = cutter(t, OUTER, 1, ["rake"]);
  const object = vineAt();
  const event = { player: p, object, objectId: object.getId(), itemId: CacheDefinitions.getObjId("rake"), slot: 0, location: { x: VINE[0], y: VINE[1], z: 0 }, handled: false };
  PluginManager.emitItemOnObject(event);
  for (let i = 0; i < 4; i++) tick(p);
  assert.ok(vineAt(), "the vine still stands");
  assert.deepEqual(at(p), OUTER);
});
