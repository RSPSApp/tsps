// Run after `yarn build`: node --test tests/in-aid-of-the-myreque-rod.test.cjs
//
// In Aid of the Myreque, stages 360-430 (the Rod unit), against the live capture (revision 242,
// ticks 4323-4963): the library book and its stages, the tomb boards and entrance, the clay mould,
// the silvthrill rod from Crafting, Lvl-1 Enchant on it, the Salve well, and Veliaf's hand-in with
// the completion on the continue after "Well [player name]...", then Darkness of Hallowvale's start
// once the scroll closes. Real plugins, a real Player; ticks are TaskManager.process().
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
const { impliedVarbits, STAGE, VARBIT, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/inaid/State.InAidOfTheMyreque");

const STAGE_KEY = "quest.in_aid_of_the_myreque.stage";
const OBJECTBOX = 193;
const BOX_TEXT = (OBJECTBOX << 16) | 2;
const VELIAF = 9489;
let core;
let index = 7900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function ticks(count) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

function player(t, name, stage, at = { x: 3483, y: 9832, z: 0 }) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(at.x, at.y, at.z));
  p.needsPlacement = false;
  p.setAttribute(STAGE_KEY, stage);
  p.setAttribute(VARS_ATTRIBUTE, impliedVarbits(stage));
  p.setAttribute(SAVE_VERSION_ATTRIBUTE, 2);
  const seen = { messages: [], texts: [], boxText: null, chatbox: [], items: [], varbits: [], anims: [], gfx: [], sounds: [], interfaces: [] };
  const sender = p.getPacketSender();
  for (const [varbit, value] of Object.entries(impliedVarbits(stage))) sender.sendVarbit(Number(varbit), value);
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { seen.messages.push(String(text)); return send(text, ...rest); };
  const anim = p.performAnimation.bind(p);
  p.performAnimation = (a) => { seen.anims.push(a.getId()); return anim(a); };
  const gfx = p.performGraphic.bind(p);
  p.performGraphic = (g) => { seen.gfx.push([g.getId(), g.getHeight?.()]); return gfx(g); };
  for (const [method, record] of [
    ["sendString", (text, id) => { seen.texts.push(String(text)); if (id === BOX_TEXT) seen.boxText = String(text); }],
    ["sendChatboxInterface", (group) => seen.chatbox.push(group)],
    ["sendItemOnInterfaces", (id, item) => seen.items.push(item)],
    ["sendVarbit", (id, value) => seen.varbits.push([id, value])],
    ["sendSoundEffect", (id) => seen.sounds.push(id)],
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

const stageOf = (p) => p.getAttribute(STAGE_KEY);
const quests = (p) => p.getAttribute(VARS_ATTRIBUTE) ?? {};
const slotOf = (p, id) => p.getInventory().getItems().findIndex((item) => item?.getId() === id);

function object(p, id, at, option) {
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((entry) => entry === option) + 1;
  assert.ok(clickType > 0, `the cache's ${option} option on ${id}`);
  return PM.emitObjectInteraction({ player: p, object: { getId: () => id, getLocation: () => new core.Location(at[0], at[1], at[2]) },
    objectId: id, definition, clickType, location: { x: at[0], y: at[1], z: at[2] }, sourceLocation: p.getLocation(), handled: false });
}

function itemOnObject(p, itemId, id, at) {
  const slot = slotOf(p, itemId);
  return PM.emitItemOnObject({ player: p, object: { getId: () => id, getLocation: () => new core.Location(at[0], at[1], at[2]) },
    definition: ObjectDefinition.forPlayer(id, p), objectId: id, item: p.getInventory().getItems()[slot], itemId, itemSlot: slot,
    interfaceType: 0, location: { x: at[0], y: at[1], z: at[2] }, handled: false });
}

function read(p, itemId) {
  const slot = slotOf(p, itemId);
  const action = [2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op))
    .find((candidate) => candidate?.option === "Read");
  return PM.emitItemAction({ player: p, item: p.getInventory().getItems()[slot], itemId, slot, interfaceId: (149 << 16),
    clickType: action.optionIndex, option: action.option, handled: false });
}

/** The hideout's myq5_veliaf_burgh_hideout 8277, seen as 9489 (varbit 10352 = 0). */
function talkVeliaf(p) {
  const npc = new NPC(8277, new core.Location(3494, 9628, 0));
  assert.equal(npc.getContentId(p), VELIAF);
  return PM.emitNpcInteraction({ player: p, npc, definition: npc.getCurrentDefinition(p), npcId: VELIAF, npcIndex: 1,
    clickType: 1, location: { x: 3494, y: 9628, z: 0 }, handled: false });
}

const I = () => core.ItemIdentifiers;

test("Ivandis' bookcase gives The Sleeping Seven with its objectbox and moves 360 -> 370", (t) => {
  const { p, seen } = player(t, "rodbookcase", STAGE.LIBRARY_OPEN, { x: 3354, y: 9900, z: 0 });
  assert.equal(object(p, core.ObjectIdentifiers.BOOKCASE_52, [3354, 9899, 0], "Search"), true);
  assert.deepEqual(seen.messages, ["You search the bookcase..."]);
  assert.equal(stageOf(p), STAGE.BOOK_FOUND);
  assert.equal(p.getInventory().getAmount(I().THE_SLEEPING_SEVEN), 1);
  assert.deepEqual(seen.chatbox, [OBJECTBOX], "the box on the search tick (t4323)");
  assert.equal(seen.boxText, "You find a book called The Sleeping Seven.");
  assert.deepEqual(seen.items, [I().THE_SLEEPING_SEVEN]);
});

test("reading The Sleeping Seven moves 370 -> 375 as it opens; at 375 it stays", (t) => {
  const { p, seen } = player(t, "rodread", STAGE.BOOK_FOUND, { x: 3354, y: 9900, z: 0 });
  p.getInventory().setItem(0, new core.Item(I().THE_SLEEPING_SEVEN, 1));
  assert.equal(read(p, I().THE_SLEEPING_SEVEN), true);
  assert.equal(stageOf(p), STAGE.BOOK_READ);
  assert.ok(seen.texts.includes("The Sleeping Seven"), "book 392 opens");
  const other = player(t, "rodread2", STAGE.TOMB_ENTERED, { x: 3354, y: 9900, z: 0 });
  other.p.getInventory().setItem(0, new core.Item(I().THE_SLEEPING_SEVEN, 1));
  read(other.p, I().THE_SLEEPING_SEVEN);
  assert.equal(stageOf(other.p), STAGE.TOMB_ENTERED);
});

test("a hammer on the tomb boards: three ticks of building, then varbit 1983 and the hammer's box; the stage stays", (t) => {
  const { p, seen } = player(t, "rodboards", STAGE.BOOK_READ);
  p.getInventory().setItem(5, new core.Item(I().HAMMER, 1));
  assert.equal(ObjectDefinition.forPlayer(12772, p).getName(), "Wooden boards");
  assert.equal(itemOnObject(p, I().HAMMER, 12772, [3483, 9832, 0]), true);
  assert.deepEqual(seen.anims, [3676]);
  assert.deepEqual(seen.sounds, [938]);
  ticks(2);
  assert.deepEqual(seen.anims, [3676, 3676, 3676], "human_poh_build each tick (t4480-4482)");
  assert.equal(quests(p)[VARBIT.TOMB_BOARDS], undefined);
  ticks(1);
  assert.equal(quests(p)[VARBIT.TOMB_BOARDS], 1);
  assert.ok(seen.varbits.some(([id, value]) => id === 1983 && value === 1));
  assert.equal(seen.anims.at(-1), -1);
  assert.deepEqual(seen.chatbox, [OBJECTBOX]);
  assert.deepEqual(seen.items, [I().HAMMER]);
  assert.equal(seen.boxText, "You manage to break up the boards using a hammer.");
  assert.equal(stageOf(p), STAGE.BOOK_READ, "varbit 1990 does not change");
  assert.equal(ObjectDefinition.forPlayer(12772, p), null, "the boards are gone for this player");
});

test("the boards stay before the book is read", (t) => {
  const { p } = player(t, "rodboards2", STAGE.BOOK_FOUND);
  p.getInventory().setItem(5, new core.Item(I().HAMMER, 1));
  itemOnObject(p, I().HAMMER, 12772, [3483, 9832, 0]);
  ticks(3);
  assert.equal(quests(p)[VARBIT.TOMB_BOARDS], undefined);
});

test("the tomb entrance: blocked by the boards; then the crawl, 380, and (3491, 9876) two ticks on, no message", (t) => {
  const { p, seen } = player(t, "rodtomb", STAGE.BOOK_READ);
  assert.equal(object(p, 12770, [3484, 9832, 0], "Enter"), true);
  assert.deepEqual(seen.messages, ["There's some boards blocking the cave entrance."]);
  assert.equal(stageOf(p), STAGE.BOOK_READ);

  p.setAttribute(VARS_ATTRIBUTE, { ...quests(p), [VARBIT.TOMB_BOARDS]: 1 });
  seen.messages.length = 0;
  assert.equal(object(p, 12770, [3484, 9832, 0], "Enter"), true);
  assert.equal(stageOf(p), STAGE.TOMB_ENTERED);
  assert.deepEqual(seen.anims, [2796]);
  assert.deepEqual(seen.sounds, [2454]);
  ticks(1);
  assert.equal(p.getLocation().getY(), 9832);
  ticks(1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3491, 9876, 0]);
  ticks(3);
  assert.deepEqual(seen.messages, [], "no chat line");
});

test("soft clay on the coffin: the mould in the clay's slot, its objectbox, 380 -> 390", (t) => {
  const { p, seen } = player(t, "rodclay", STAGE.TOMB_ENTERED, { x: 3510, y: 9863, z: 0 });
  p.getInventory().setItem(8, new core.Item(I().SOFT_CLAY, 1));
  assert.equal(itemOnObject(p, I().SOFT_CLAY, 12802, [3511, 9863, 0]), true);
  assert.equal(stageOf(p), STAGE.MOULD);
  assert.equal(p.getInventory().getItems()[8]?.getId(), I().ROD_MOULD);
  assert.equal(p.getInventory().getAmount(I().SOFT_CLAY), 0);
  assert.deepEqual(seen.chatbox, [OBJECTBOX]);
  assert.deepEqual(seen.items, [I().ROD_MOULD]);
  assert.equal(seen.boxText, "You use some clay to create a mould of the rod.");
  assert.deepEqual(seen.messages, []);
});

test("the clay does nothing before the tomb is entered", (t) => {
  const { p } = player(t, "rodclay2", STAGE.BOOK_READ, { x: 3510, y: 9863, z: 0 });
  p.getInventory().setItem(8, new core.Item(I().SOFT_CLAY, 1));
  itemOnObject(p, I().SOFT_CLAY, 12802, [3511, 9863, 0]);
  assert.equal(stageOf(p), STAGE.BOOK_READ);
  assert.equal(p.getInventory().getAmount(I().SOFT_CLAY), 1);
});

test("Crafting's silvthrill rod moves 390 -> 400", (t) => {
  const { p } = player(t, "rodcraft", STAGE.MOULD);
  PM.emitCustomEvent("crafting:made", { player: p, itemId: I().SILVTHRILL_ROD_2, furnace: true, bar: "Silver bar" });
  assert.equal(stageOf(p), STAGE.ROD_MADE);
  const early = player(t, "rodcraft2", STAGE.TOMB_ENTERED);
  PM.emitCustomEvent("crafting:made", { player: early.p, itemId: I().SILVTHRILL_ROD_2, furnace: true });
  assert.equal(stageOf(early.p), STAGE.TOMB_ENTERED);
});

test("Lvl-1 Enchant on the rod: 410 at the cast, the enchant nine ticks later in the rod's slot with its box", (t) => {
  const { p, seen } = player(t, "rodenchant", STAGE.ROD_MADE, { x: 2974, y: 3372, z: 0 });
  p.getSkillManager().setMaxLevel(core.Skill.MAGIC, 70).setCurrentLevel(core.Skill.MAGIC, 70);
  p.getInventory().setItem(1, new core.Item(I().WATER_RUNE, 10));
  p.getInventory().setItem(6, new core.Item(I().SILVTHRILL_ROD_2, 1));
  p.getInventory().setItem(27, new core.Item(I().COSMIC_RUNE, 1));
  const xp = p.getSkillManager().getExperience(core.Skill.MAGIC);
  const cast = () => PM.emitSpellOnItem({ player: p, spellName: "Lvl-1 Enchant", spellWidget: 0, spellItemId: -1,
    itemId: I().SILVTHRILL_ROD_2, slot: 6, handled: false });
  assert.equal(cast(), true);
  assert.equal(stageOf(p), STAGE.ROD_ENCHANTED);
  assert.equal(p.getInventory().getItems()[6]?.getId(), I().SILVTHRILL_ROD_2);
  ticks(7);
  cast(); // live ignores a second cast meanwhile (t4569)
  ticks(1);
  assert.equal(p.getInventory().getItems()[6]?.getId(), I().SILVTHRILL_ROD_2, "not yet");
  ticks(1);
  assert.equal(p.getInventory().getItems()[6]?.getId(), I().SILVTHRILL_ROD_3);
  assert.equal(p.getInventory().getAmount(I().WATER_RUNE), 9);
  assert.equal(p.getInventory().getAmount(I().COSMIC_RUNE), 0);
  const gained = p.getSkillManager().getExperience(core.Skill.MAGIC) - xp;
  assert.ok(gained >= 17 && gained <= 18, `the spell's 17.5 Magic XP (${gained})`);
  assert.deepEqual(seen.anims, [3566]);
  assert.deepEqual(seen.gfx.map(([id]) => id), [609]);
  assert.ok(seen.sounds.includes(136));
  assert.deepEqual(seen.items, [I().SILVTHRILL_ROD_3]);
  assert.equal(seen.boxText, "As you cast the enchantment on the rod, it seems to vibrate and glow.");
  ticks(10);
  assert.equal(p.getInventory().getAmount(I().COSMIC_RUNE), 0, "one enchant only");
});

test("the enchanted rod in the Salve well with a rope: four ticks on, the Rod of Ivandis in its slot and 420", (t) => {
  const { p, seen } = player(t, "rodwell", STAGE.ROD_ENCHANTED, { x: 3423, y: 9891, z: 0 });
  p.getInventory().setItem(6, new core.Item(I().SILVTHRILL_ROD_3, 1));
  p.getInventory().setItem(11, new core.Item(I().ROPE, 1));
  assert.equal(itemOnObject(p, I().SILVTHRILL_ROD_3, 3485, [3423, 9890, 0]), true);
  assert.deepEqual(seen.anims, [832]);
  assert.deepEqual(seen.sounds, [1658]);
  ticks(3);
  assert.equal(stageOf(p), STAGE.ROD_ENCHANTED);
  ticks(1);
  assert.equal(stageOf(p), STAGE.ROD_BLESSED);
  assert.equal(p.getInventory().getItems()[6]?.getId(), I().ROD_OF_IVANDIS_10_);
  assert.equal(p.getInventory().getAmount(I().ROPE), 1, "the rope is kept");
  assert.deepEqual(seen.items, [I().ROD_OF_IVANDIS_10_]);
  assert.equal(seen.boxText, "You lower the rod into the Salve and withdraw it shortly after. It seems to glow in a rather strange way.");
});

test("without a rope the rod is not lowered", (t) => {
  const { p, seen } = player(t, "rodwell2", STAGE.ROD_ENCHANTED, { x: 3423, y: 9891, z: 0 });
  p.getInventory().setItem(6, new core.Item(I().SILVTHRILL_ROD_3, 1));
  itemOnObject(p, I().SILVTHRILL_ROD_3, 3485, [3423, 9890, 0]);
  ticks(5);
  assert.deepEqual(seen.messages, ["You'd lose the rod if you just dropped it down there."]);
  assert.equal(stageOf(p), STAGE.ROD_ENCHANTED);
  assert.equal(p.getInventory().getAmount(I().SILVTHRILL_ROD_3), 1);
});

test("Veliaf at 400 sees an unenchanted rod", (t) => {
  const { p, seen } = player(t, "rodveliaf400", STAGE.ROD_MADE, { x: 3494, y: 9630, z: 0 });
  p.getInventory().setItem(6, new core.Item(I().SILVTHRILL_ROD_2, 1));
  assert.equal(talkVeliaf(p), true);
  for (let i = 0; i < 3; i++) p.getDialogueManager().advance();
  assert.ok(seen.texts.some((text) => text.startsWith("Hmm, well it certainly looks very authentic. But there doesn't")), seen.texts.join(" | "));
});

test("the hand-in: the rod and 430 at its box, the rewards on the continue after 'Well...', then Darkness of Hallowvale", (t) => {
  const { p, seen } = player(t, "rodhandin", STAGE.ROD_BLESSED, { x: 3494, y: 9630, z: 0 });
  p.getInventory().setItem(7, new core.Item(I().ROD_OF_IVANDIS_10_, 1));
  const points = Number(p.getAttribute("quest.points")) || 0;
  const attack = p.getSkillManager().getExperience(core.Skill.ATTACK);
  assert.equal(talkVeliaf(p), true);
  assert.ok(seen.texts.includes("Well met. How's it going?"));
  p.getDialogueManager().advance(); // -> "I have brought you the Rod of Ivandis!"
  p.getDialogueManager().advance(); // -> "Very impressive. Good work."
  assert.ok(seen.texts.includes("Very impressive. Good work."));
  assert.equal(p.getInventory().getAmount(I().ROD_OF_IVANDIS_10_), 1);
  p.getDialogueManager().advance(); // -> the box (t4942)
  assert.equal(seen.boxText, "You give the Rod of Ivandis to Veliaf.");
  assert.deepEqual(seen.items, [I().ROD_OF_IVANDIS_10_]);
  assert.equal(p.getInventory().getAmount(I().ROD_OF_IVANDIS_10_), 0);
  assert.ok(seen.varbits.some(([id, value]) => id === 1990 && value === 430), "430 on the box");
  assert.equal(quests(p)[VARBIT.TEMPLE_TREK_NPCS], 1);
  assert.equal(Number(p.getAttribute("quest.points")) || 0, points, "no points yet");
  assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK), attack, "no XP yet");
  p.getDialogueManager().advance(); // -> "I... I don't believe it!"
  p.getDialogueManager().advance(); // -> "Well <name>, ..."
  assert.ok(seen.texts.some((text) => text.startsWith("Well rodhandin, you have certainly excelled yourself")), seen.texts.join(" | "));
  assert.equal(Number(p.getAttribute("quest.points")) || 0, points);
  assert.ok(!seen.messages.some((text) => text.startsWith("Congratulations")));
  p.getDialogueManager().advance(); // the continue (t4953)
  assert.equal(stageOf(p), STAGE.COMPLETE);
  assert.equal(Number(p.getAttribute("quest.points")), points + 2);
  assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK) - attack, 2000);
  assert.ok(seen.messages.some((text) => text.startsWith("Congratulations, you've completed a quest")));
  ticks(2);
  assert.ok(seen.interfaces.includes(153), "the scroll");
  const before = seen.texts.length;
  PM.emitInterfaceActionClick({ player: p, buttonId: (153 << 16) | 16, action: 1, handled: false });
  assert.ok(seen.texts.slice(before).includes("So what now?"), seen.texts.slice(before).join(" | "));
});

test("a wielded rod is not taken", (t) => {
  const { p, seen } = player(t, "rodwield", STAGE.ROD_BLESSED, { x: 3494, y: 9630, z: 0 });
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I().ROD_OF_IVANDIS_10_, 1));
  talkVeliaf(p);
  for (let i = 0; i < 3; i++) p.getDialogueManager().advance();
  assert.ok(seen.texts.some((text) => text.startsWith("Hmmm, I can't take it off your hands")), seen.texts.join(" | "));
  assert.equal(stageOf(p), STAGE.ROD_BLESSED);
  assert.equal(quests(p)[VARBIT.TEMPLE_TREK_NPCS], undefined);
});
