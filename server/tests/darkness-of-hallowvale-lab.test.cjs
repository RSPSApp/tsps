// Run after `yarn build`: node --test tests/darkness-of-hallowvale-lab.test.cjs
//
// Darkness of Hallowvale, stages 250-320 (the Lab unit), against the live capture (revision 242,
// ticks 7057-7796): the fireplace's message (250 -> 260), the portrait's key, Safalaan's sketches
// hand-in running on into the message (2575, 2576, 270), the tapestry (280), the statue (290), the
// laboratory door (300) and stairs, the rune case, the book and the sealed message (310), Veliaf's
// completion (320, the tome in the message's slot, ramble_npcs_visible) and the lost tome. Real
// plugins, a real Player; ticks are TaskManager.process() plus the player's own movement.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { impliedVarbits, STAGE, VARBIT, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/hallowvale/State.DarknessOfHallowvale");

const STAGE_KEY = "quest.darkness_of_hallowvale.stage";
const IN_AID_STAGE_KEY = "quest.in_aid_of_the_myreque.stage";
const OBJECTBOX = 193;
const DOUBLE_BOX = 11;
const MESSAGEBOX = 229;
const SAFALAAN = 3775;
const VELIAF = 9489;
const KNIFE = 946;
const SKETCHES = [9646, 9647, 9648];
const MESSAGE = 9649;
const KEY = 9651;
const BOOK = 9652;
const SEALED = 9653;
const TOME = 9656;
let core;
let index = 8600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, name, stage, at = [3627, 3250, 0], extra = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], at[2]));
  p.needsPlacement = false;
  p.setAttribute(IN_AID_STAGE_KEY, 430);
  p.setAttribute(STAGE_KEY, stage);
  const vars = { ...impliedVarbits(stage), ...extra };
  p.setAttribute(VARS_ATTRIBUTE, vars);
  p.setAttribute(SAVE_VERSION_ATTRIBUTE, 1);
  const seen = { messages: [], texts: [], chatbox: [], items: [], varbits: [], anims: [], sounds: [], jingles: [], objects: [], removed: [], interfaces: [] };
  const sender = p.getPacketSender();
  for (const [varbit, value] of Object.entries(vars)) sender.sendVarbit(Number(varbit), value);
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { seen.messages.push(String(text)); return send(text, ...rest); };
  const anim = p.performAnimation.bind(p);
  p.performAnimation = (a) => { seen.anims.push(a.getId()); return anim(a); };
  for (const [method, record] of [
    ["sendString", (text) => seen.texts.push(String(text))],
    ["sendChatboxInterface", (group) => seen.chatbox.push(group)],
    ["sendItemOnInterfaces", (id, item) => seen.items.push(item)],
    ["sendVarbit", (id, value) => seen.varbits.push([id, value])],
    ["sendSound", (id) => seen.sounds.push(id)],
    ["sendJingle", (id) => seen.jingles.push(id)],
    ["sendObject", (object) => seen.objects.push([object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace?.()])],
    ["sendObjectRemoval", (object) => seen.removed.push([object.getLocation().getX(), object.getLocation().getY()])],
    ["sendInterface", (id) => seen.interfaces.push(id)],
  ]) {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  }
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  return { p, seen };
}

/** One game tick: the scheduled tasks, then this player's walk. */
function ticks(p, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.process();
    p.getMovementQueue().process();
  }
}

const stageOf = (p) => p.getAttribute(STAGE_KEY);
const vars = (p) => p.getAttribute(VARS_ATTRIBUTE) ?? {};
const slotOf = (p, id) => p.getInventory().getItems().findIndex((item) => item?.getId() === id);
const tile = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
const sent = (seen, varbit, value) => seen.varbits.some(([id, v]) => id === varbit && v === value);
const NOT_WORDS = new Set(["Click here to continue", "Please wait...", ""]);
const lastText = (seen) => seen.texts.filter((text) => !NOT_WORDS.has(text)).at(-1);

function fakeObject(id, at) {
  return { getId: () => id, getLocation: () => new core.Location(at[0], at[1], at[2]), getDefinition: () => ObjectDefinition.forId(id) };
}

function object(p, id, at, option) {
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((entry) => entry === option) + 1;
  assert.ok(clickType > 0, `the cache's ${option} option on ${id}`);
  return PM.emitObjectInteraction({ player: p, object: fakeObject(id, at), objectId: id, definition, clickType,
    location: { x: at[0], y: at[1], z: at[2] }, sourceLocation: p.getLocation(), handled: false });
}

function itemOnObject(p, itemId, id, at) {
  const slot = slotOf(p, itemId);
  return PM.emitItemOnObject({ player: p, object: fakeObject(id, at), definition: ObjectDefinition.forPlayer(id, p), objectId: id,
    item: p.getInventory().getItems()[slot], itemId, itemSlot: slot, interfaceType: 0, location: { x: at[0], y: at[1], z: at[2] },
    handled: false });
}

function read(p, itemId) {
  const slot = slotOf(p, itemId);
  const action = [2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op))
    .find((candidate) => candidate?.option === "Read");
  return PM.emitItemAction({ player: p, item: p.getInventory().getItems()[slot], itemId, slot, interfaceId: (149 << 16),
    clickType: action.optionIndex, option: action.option, handled: false });
}

function talk(p, spawnId, npcId, at) {
  const npc = new NPC(spawnId, new core.Location(at[0], at[1], at[2]));
  return PM.emitNpcInteraction({ player: p, npc, definition: core.NpcDefinition.forId(npcId), npcId, npcIndex: 1,
    clickType: 1, location: { x: at[0], y: at[1], z: at[2] }, handled: false });
}

const talkSafalaan = (p) => talk(p, 6160, SAFALAAN, [3627, 9646, 0]);
const talkVeliaf = (p) => talk(p, 8277, VELIAF, [3493, 9628, 0]);

/** Continues until `done()` holds (or fails after `max` continues). */
function continueUntil(p, done, max = 30) {
  for (let i = 0; i < max; i++) {
    if (done()) return;
    p.getDialogueManager().advance();
  }
  assert.fail("the conversation never got there");
}

const give = (p, slot, id, amount = 1) => p.getInventory().setItem(slot, new core.Item(id, amount));

// ---------------------------------------------------------------------------

test("the knife on the fireplace's loose tile: the message, its objectbox and 250 -> 260 on that tick (t7070)", (t) => {
  const { p, seen } = player(t, "labfire", STAGE.SARIUS_TALKED);
  give(p, 3, KNIFE);
  assert.equal(itemOnObject(p, KNIFE, 18039, [3627, 3253, 0]), true);
  assert.equal(stageOf(p), STAGE.FIREPLACE_OPENED);
  assert.ok(sent(seen, 2573, 260));
  assert.deepEqual(seen.anims, [827]);
  assert.deepEqual(seen.sounds, [2581]);
  assert.equal(p.getInventory().getAmount(MESSAGE), 1);
  assert.deepEqual(seen.chatbox, [OBJECTBOX]);
  assert.deepEqual(seen.items, [MESSAGE]);
  assert.equal(lastText(seen), "You carefully use your knife on the loose tile and find a message hidden behind it.");

  p.getDialogueManager().reset();
  itemOnObject(p, KNIFE, 18039, [3627, 3253, 0]);
  assert.equal(p.getInventory().getAmount(MESSAGE), 1, "one message");
  assert.equal(lastText(seen), "You've already levered the loose tile away. There is nothing else to use a knife on here.");
});

test("before Sarius the fireplace is left alone", (t) => {
  const { p } = player(t, "labfire2", STAGE.SARIUS_SAVED);
  give(p, 3, KNIFE);
  itemOnObject(p, KNIFE, 18039, [3627, 3253, 0]);
  assert.equal(p.getInventory().getAmount(MESSAGE), 0);
  assert.equal(stageOf(p), STAGE.SARIUS_SAVED);
});

test("the knife on the portrait: the slash on the click, a tick later 2595 0 -> 1 -> 2, the key and its box (t7078-7079)", (t) => {
  const { p, seen } = player(t, "labportrait", STAGE.FIREPLACE_OPENED, [3627, 3249, 0], { [VARBIT.PORTRAIT]: 0 });
  give(p, 3, KNIFE);
  seen.varbits.length = 0;
  assert.equal(itemOnObject(p, KNIFE, 18126, [3627, 3248, 0]), true);
  assert.deepEqual(seen.anims, [3747]);
  assert.deepEqual(seen.sounds, [1721]);
  assert.equal(p.getInventory().getAmount(KEY), 0);
  ticks(p, 1);
  assert.deepEqual(seen.varbits.filter(([id]) => id === 2595), [[2595, 1], [2595, 2]]);
  assert.equal(p.getInventory().getAmount(KEY), 1);
  assert.deepEqual(seen.items, [KEY]);
  assert.equal(lastText(seen), "You slash the painting and find a large ornate key hidden inside.");
  assert.equal(stageOf(p), STAGE.FIREPLACE_OPENED, "the stage stays");

  // A lost key: the slashed portrait gives it back (transcript), until the statue holds it.
  p.getDialogueManager().reset();
  p.getInventory().deleteNumber(KEY, 1);
  object(p, 18126, [3627, 3248, 0], "Inspect");
  assert.equal(p.getInventory().getAmount(KEY), 1);
  assert.equal(lastText(seen), "There's a large ornate key hidden inside the painting. You take it.");
});

test("Safalaan at 260: the sketches' double box and 2575 (stage stays), then straight on into the message: 2576 and 270 (t7239-7258)", (t) => {
  const { p, seen } = player(t, "labsketches", STAGE.FIREPLACE_OPENED, [3627, 9645, 0]);
  SKETCHES.forEach((id, slot) => give(p, 15 + slot, id));
  give(p, 18, MESSAGE);
  assert.equal(new NPC(6160, new core.Location(3627, 9646, 0)).getContentId(p), SAFALAAN, "6160 shows as 3775");
  assert.equal(talkSafalaan(p), true);
  assert.equal(lastText(seen), "Hey, I've finished at the castle. It was a close one though. I was attacked by Vanstrom!");
  continueUntil(p, () => seen.chatbox.includes(DOUBLE_BOX));
  assert.ok(seen.texts.includes("You give the sketches to Safalaan."));
  assert.deepEqual(seen.items.slice(-2), [9646, 9647]);
  for (const id of SKETCHES) assert.equal(p.getInventory().getAmount(id), 0);
  assert.equal(vars(p)[VARBIT.SKETCHES_GIVEN], 1);
  assert.ok(sent(seen, 2575, 1));
  assert.equal(stageOf(p), STAGE.FIREPLACE_OPENED, "no stage change on the sketches");
  continueUntil(p, () => lastText(seen) === "Ah yes. I have it here.");
  assert.ok(!seen.texts.some((text) => text.startsWith("That's right. If I remember correctly")), "no riddle tail");
  p.getDialogueManager().advance();
  assert.equal(lastText(seen), "You show the message to Safalaan.");
  assert.equal(seen.items.at(-1), MESSAGE);
  assert.equal(stageOf(p), STAGE.MESSAGE_SHOWN);
  assert.equal(vars(p)[VARBIT.SARIUS_MESSAGE_GIVEN], 1);
  assert.equal(p.getInventory().getAmount(MESSAGE), 1, "the message is kept");
  continueUntil(p, () => lastText(seen)?.startsWith("We should keep an eye out for this place."));
});

test("Safalaan at 250 without the message: the sketches, then the riddle; at 270 'Hey, I've returned.'", (t) => {
  const { p, seen } = player(t, "labsketches2", STAGE.SARIUS_TALKED, [3627, 9645, 0]);
  SKETCHES.forEach((id, slot) => give(p, slot, id));
  talkSafalaan(p);
  continueUntil(p, () => seen.texts.some((text) => text.startsWith("That's right. If I remember correctly")));
  assert.equal(vars(p)[VARBIT.SKETCHES_GIVEN], 1);
  assert.equal(stageOf(p), STAGE.SARIUS_TALKED);

  const later = player(t, "labsafalaan270", STAGE.MESSAGE_SHOWN, [3627, 9645, 0]);
  talkSafalaan(later.p);
  continueUntil(later.p, () => later.seen.texts.includes("Where do you think this laboratory could be?"));
});

test("the tapestry: refused before the message is shown; at 270 the slash two ticks on, 280 and the knife's box a tick later (t7405-7408)", (t) => {
  const early = player(t, "labtapestry0", STAGE.FIREPLACE_OPENED, [3638, 3304, 0]);
  give(early.p, 0, KNIFE);
  assert.equal(itemOnObject(early.p, KNIFE, 18125, [3638, 3304, 0]), true);
  assert.equal(lastText(early.seen), "You see no good reason to destroy this lovely looking tapestry.");

  const { p, seen } = player(t, "labtapestry", STAGE.MESSAGE_SHOWN, [3638, 3304, 0]);
  give(p, 0, KNIFE);
  assert.equal(ObjectDefinition.forPlayer(18125, p).getName(), "Tapestry");
  assert.equal(itemOnObject(p, KNIFE, 18125, [3638, 3304, 0]), true);
  assert.ok(sent(seen, 12393, 1), "busy");
  assert.deepEqual(seen.anims, []);
  ticks(p, 1);
  assert.deepEqual(seen.anims, [3747]);
  assert.deepEqual(seen.sounds, [1721]);
  assert.equal(stageOf(p), STAGE.MESSAGE_SHOWN);
  ticks(p, 1);
  assert.equal(stageOf(p), STAGE.TAPESTRY_SLASHED);
  assert.equal(vars(p)[VARBIT.TAPESTRY], 1);
  assert.deepEqual(seen.items, [KNIFE]);
  assert.equal(lastText(seen), "You slash the tapestry down the middle.");

  // Walk-through: one step north, no teleport (t7412); back south from inside (t7485).
  p.getDialogueManager().reset();
  assert.equal(ObjectDefinition.forPlayer(18125, p).getName(), "Slashed tapestry");
  assert.equal(object(p, 18125, [3638, 3304, 0], "Walk-through"), true);
  ticks(p, 2);
  assert.deepEqual(tile(p), [3638, 3305, 0]);
  object(p, 18125, [3638, 3304, 0], "Walk-through");
  ticks(p, 2);
  assert.deepEqual(tile(p), [3638, 3304, 0]);
  assert.equal(p.hasFlag?.("movement:ignore-clipping") === true, false, "collision is back");
});

test("the key on the statue: the place on the click, two ticks on 290, 2596, the key gone and a messagebox (t7417-7419)", (t) => {
  const { p, seen } = player(t, "labstatue", STAGE.TAPESTRY_SLASHED, [3641, 3305, 0]);
  give(p, 19, KEY);
  assert.equal(itemOnObject(p, KEY, 18127, [3641, 3304, 0]), true);
  assert.deepEqual(seen.anims, [832]);
  assert.deepEqual(seen.sounds, [1717]);
  ticks(p, 1);
  assert.equal(stageOf(p), STAGE.TAPESTRY_SLASHED);
  ticks(p, 1);
  assert.equal(stageOf(p), STAGE.STATUE_KEYED);
  assert.equal(vars(p)[VARBIT.STATUE], 1);
  assert.equal(p.getInventory().getAmount(KEY), 0);
  assert.deepEqual(seen.chatbox, [MESSAGEBOX]);
  assert.ok(lastText(seen).startsWith("You carefully place the large ornate key into the statue's hands."), lastText(seen));
});

test("the laboratory door: locked before the statue; then 300 on the first opening, the walk in and the swap; after the book too (t7424-7481)", (t) => {
  const locked = player(t, "labdoor0", STAGE.TAPESTRY_SLASHED, [3641, 3306, 0]);
  assert.equal(object(locked.p, 18047, [3641, 3307, 0], "Open"), true);
  assert.equal(lastText(locked.seen), "The door is securely locked.");

  const { p, seen } = player(t, "labdoor", STAGE.STATUE_KEYED, [3641, 3306, 0]);
  assert.equal(object(p, 18047, [3641, 3307, 0], "Open"), true);
  assert.equal(stageOf(p), STAGE.STATUE_KEYED);
  ticks(p, 1);
  assert.equal(stageOf(p), STAGE.LAB_OPENED, "300 a tick on (t7426)");
  assert.deepEqual(tile(p), [3641, 3307, 0]);
  ticks(p, 1);
  assert.deepEqual(tile(p), [3642, 3307, 0]);
  assert.deepEqual(seen.objects, [[38848, 3641, 3307, 2], [18048, 3642, 3307, 3]]);
  assert.deepEqual(seen.sounds, [71]);
  ticks(p, 2);
  assert.deepEqual(seen.objects.at(-1), [18047, 3641, 3307, 2], "closed two ticks later");
  assert.deepEqual(seen.removed, [[3642, 3307]]);

  // After the book (310): out again from inside, one step west.
  const out = player(t, "labdoor2", STAGE.SEALED_MESSAGE, [3642, 3307, 0]);
  assert.equal(object(out.p, 18047, [3641, 3307, 0], "Open"), true);
  ticks(out.p, 2);
  assert.deepEqual(tile(out.p), [3641, 3307, 0]);
  assert.equal(stageOf(out.p), STAGE.SEALED_MESSAGE);
  assert.deepEqual(out.seen.sounds, [71]);
});

test("the laboratory stairs: a fade, the climb and live's landings (3637, 9695) and (3643, 3306) (t7430-7472)", (t) => {
  const { p, seen } = player(t, "labstairs", STAGE.LAB_OPENED, [3643, 3306, 0]);
  assert.equal(object(p, 18049, [3643, 3304, 0], "Climb-down"), true);
  ticks(p, 2);
  assert.deepEqual(seen.anims, [827]);
  assert.deepEqual(seen.sounds, [1952]);
  ticks(p, 2);
  assert.deepEqual(tile(p), [3637, 9695, 0]);
  ticks(p, 4);
  seen.anims.length = 0;
  seen.sounds.length = 0;
  assert.equal(object(p, 18050, [3637, 9696, 0], "Climb-up"), true);
  ticks(p, 4);
  assert.deepEqual(seen.anims, [828]);
  assert.deepEqual(seen.sounds, [1956, 1956]);
  assert.deepEqual(tile(p), [3643, 3306, 0]);
});

test("the broken rune case: the transcript's runes and 2584 once, then empty", (t) => {
  const { p, seen } = player(t, "labrunes", STAGE.LAB_OPENED, [3633, 9694, 0]);
  assert.equal(object(p, 18052, [3632, 9694, 0], "Search"), true);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.LAW_RUNE), 1);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE), 3);
  assert.equal(vars(p)[VARBIT.RUNECASE_SEARCHED], 1);
  assert.equal(lastText(seen), "You search the rune case and find some runes.");
  p.getDialogueManager().reset();
  object(p, 18052, [3632, 9694, 0], "Search");
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.LAW_RUNE), 1);
  assert.equal(lastText(seen), "You search the rune case, but it appears to be empty.");
});

test("Read on Haemalchemy shows the book's objectbox (t7600)", (t) => {
  const { p, seen } = player(t, "labreadbook", STAGE.LAB_OPENED);
  give(p, 6, BOOK);
  assert.equal(read(p, BOOK), true);
  assert.deepEqual(seen.chatbox, [OBJECTBOX]);
  assert.deepEqual(seen.items, [BOOK]);
  assert.equal(lastText(seen), "This book seems far too complex for you. Maybe Safalaan will know what to do with it.");
});

test("Safalaan with the book: shown and kept, then the sealed message in the book's slot and 310 (t7594-7644)", (t) => {
  const { p, seen } = player(t, "labbook", STAGE.LAB_OPENED, [3627, 9645, 0]);
  give(p, 6, BOOK);
  talkSafalaan(p);
  continueUntil(p, () => lastText(seen)?.startsWith("You show the book on haemalchemy to Safalaan."));
  assert.equal(seen.items.at(-1), BOOK);
  assert.equal(p.getInventory().getAmount(BOOK), 1, "the book is kept here");
  continueUntil(p, () => lastText(seen)?.startsWith("Safalaan teaches you how to unlock the doors"));
  assert.equal(stageOf(p), STAGE.SEALED_MESSAGE);
  assert.equal(p.getInventory().getItems()[6]?.getId(), SEALED, "in the book's slot");
  assert.equal(p.getInventory().getAmount(BOOK), 0);
  assert.equal(seen.items.at(-1), SEALED);
  continueUntil(p, () => lastText(seen) === "Farewell and good luck, my friend!");
});

test("a lost sealed message: Safalaan gives another", (t) => {
  const { p, seen } = player(t, "labsealedlost", STAGE.SEALED_MESSAGE, [3627, 9645, 0]);
  talkSafalaan(p);
  continueUntil(p, () => lastText(seen)?.startsWith("Safalaan gives you a sealed message."));
  assert.equal(p.getInventory().getAmount(SEALED), 1);
  assert.equal(seen.items.at(-1), SEALED);
});

test("Veliaf at 310: the message's box, then on the last continue 320, the tome in its slot, 3412, jingle 154 and the scroll (t7733-7755)", (t) => {
  const { p, seen } = player(t, "labveliaf", STAGE.SEALED_MESSAGE, [3493, 9629, 0]);
  give(p, 6, SEALED);
  const agility = p.getSkillManager().getExperience(core.Skill.AGILITY);
  const points = Number(p.getAttribute("quest.points")) || 0;
  assert.equal(talkVeliaf(p), true);
  assert.equal(lastText(seen), "Hello, Veliaf. I have some news for you.");
  continueUntil(p, () => lastText(seen) === "You show the message to Veliaf.");
  assert.equal(seen.items.at(-1), SEALED);
  assert.equal(p.getInventory().getAmount(SEALED), 1);
  continueUntil(p, () => lastText(seen)?.startsWith("You've done well. I'd say you've earnt a break."));
  assert.equal(stageOf(p), STAGE.SEALED_MESSAGE);
  p.getDialogueManager().advance();
  assert.equal(stageOf(p), STAGE.COMPLETE);
  assert.ok(sent(seen, 2573, 320));
  assert.equal(p.getInventory().getItems()[6]?.getId(), TOME, "the tome takes the message's slot");
  assert.equal(p.getInventory().getAmount(SEALED), 0);
  assert.ok(sent(seen, 3412, 1), "ramble_npcs_visible");
  assert.equal(Number(p.getAttribute("quest.points")), points + 2);
  assert.equal(p.getSkillManager().getExperience(core.Skill.AGILITY) - agility, 7000);
  const completionJingles = () => seen.jingles.filter((id) => id === 154);
  assert.deepEqual(completionJingles(), [154], "jingle 154, once");
  assert.ok(seen.messages.some((text) => text.startsWith("Congratulations, you've completed a quest")));
  for (let i = 0; i < 3; i++) ticks(p, 1);
  assert.ok(seen.interfaces.includes(153), "the scroll");
  assert.ok(seen.items.includes(9661), "myq3_quest_complete_icon");
  assert.ok(seen.texts.includes("A Tome of Experience"));
  assert.deepEqual(completionJingles(), [154]);
});

test("Veliaf at 310 without the message sends the player back", (t) => {
  const { p, seen } = player(t, "labveliaf2", STAGE.SEALED_MESSAGE, [3493, 9629, 0]);
  talkVeliaf(p);
  continueUntil(p, () => seen.texts.includes("I've spoken to Safalaan. He gave me a message to give to you but I've misplaced it!"));
  assert.equal(stageOf(p), STAGE.SEALED_MESSAGE);
});

test("after the quest: Veliaf replaces a lost tome at its charge, and no more once all three chapters are read", (t) => {
  const { p, seen } = player(t, "labtome", STAGE.COMPLETE, [3493, 9629, 0]);
  p.setAttribute("darkness-of-hallowvale:tome-chapters", 1);
  talkVeliaf(p);
  continueUntil(p, () => lastText(seen) === "Hmm, okay, let's see if I have another one for you... Ah, here we go!");
  p.getDialogueManager().advance();
  assert.equal(p.getInventory().getAmount(9657), 1, "the (2)");
  continueUntil(p, () => lastText(seen) === "Don't worry, we will. Myreque prevail.");

  const done = player(t, "labtome2", STAGE.COMPLETE, [3493, 9629, 0]);
  done.p.setAttribute("darkness-of-hallowvale:tome-chapters", 3);
  talkVeliaf(done.p);
  continueUntil(done.p, () => done.seen.texts.includes("So, what's going to happen now?"));
  assert.ok(!done.seen.texts.includes("I've lost my Tome of Experience."));
});

test("ramble_npcs_visible is sent again at login once the quest is complete", (t) => {
  const { p, seen } = player(t, "lablogin", STAGE.COMPLETE);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.ok(sent(seen, 3412, 1));
  const before = player(t, "lablogin2", STAGE.SEALED_MESSAGE);
  PM.emitPlayerLogin({ player: before.p, username: before.p.getUsername() });
  assert.ok(!sent(before.seen, 3412, 1));
});
