// Run after `yarn build`: node --test tests/darkness-of-hallowvale-hassle.test.cjs
//
// Darkness of Hallowvale, the Hassle unit, against the live capture (revision 242): a vyrewatch
// noticing the player in Meiyerditch at stage 180 (t5636-5676) and its mines answer, Talk-to's
// "Send me to the mines." at stage 250 (t6829-6846), the cart 2588 and its messageboxes, the
// guard's exit (2574, (3621,3322,0), 2588 back to 0), 2580's release ~500 ticks later, and the
// Wiki's other answers (tithe, distraction) and tolerances. Real plugins, a real Player; ticks are
// TaskManager.process(), the area tick is AreaManager.process(player).
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
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { impliedVarbits, STAGE, VARBIT, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/hallowvale/State.DarknessOfHallowvale");

const STAGE_KEY = "quest.darkness_of_hallowvale.stage";
const MESSAGEBOX_TEXT = (229 << 16) | 3;
const CHAT_LEFT_TEXT = (231 << 16) | 6;
const CHAT_RIGHT_TEXT = (217 << 16) | 6;
const MINE = [2391, 4620, 2];
const STREET = [3609, 3186, 0]; // where the capture's vyrewatch stopped the player (t5648)
let core;
let index = 8400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const tick = (n = 1) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const at = (p) => { const l = p.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
const varbit = (p, id) => p.getPacketSender().getVarbit(id);
const menu = (p) => core.MultiChatboxPrompt.getPending(p);

function player(t, name, stage, where = STREET) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(...where));
  p.needsPlacement = false;
  p.setAttribute(STAGE_KEY, stage);
  p.setAttribute(VARS_ATTRIBUTE, impliedVarbits(stage));
  p.setAttribute(SAVE_VERSION_ATTRIBUTE, 1);
  const seen = { messages: [], strings: [], anims: [], gfx: [], sounds: [], varbits: [], hits: [] };
  const queue = p.getCombat().getHitQueue();
  const addPending = queue.addPendingDamage.bind(queue);
  queue.addPendingDamage = (hits) => { seen.hits.push(...hits.map((hit) => hit.getDamage())); return addPending(hits); };
  const sender = p.getPacketSender();
  const spy = (method, record) => {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  };
  spy("sendString", (text, id) => seen.strings.push([id, String(text)]));
  spy("sendSound", (id, volume, delay) => seen.sounds.push([id, delay]));
  spy("sendVarbit", (id, value) => seen.varbits.push([id, value]));
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { seen.messages.push(String(text)); return send(text, ...rest); };
  const anim = p.performAnimation.bind(p);
  p.performAnimation = (a) => { seen.anims.push(a.getId()); return anim(a); };
  const gfx = p.performGraphic.bind(p);
  p.performGraphic = (g) => { seen.gfx.push(g.getId()); return gfx(g); };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, seen };
}

function vyrewatch(t, id, where) {
  const npc = core.NPC.create(id, new core.Location(...where));
  core.World.getNpcs().add(npc);
  const anims = [];
  const anim = npc.performAnimation.bind(npc);
  npc.performAnimation = (a) => { anims.push(a.getId()); return anim(a); };
  t.after(() => core.World.getNpcs().remove?.(npc));
  return { npc, anims };
}

const texts = (seen, id) => seen.strings.filter(([uid]) => uid === id).map(([, text]) => text.replace(/<br>/g, " "));
const lastText = (seen, id) => texts(seen, id).at(-1);

function choose(p, text) {
  const pending = menu(p);
  assert.ok(pending, `a menu is open for "${text}"`);
  const i = pending.options.indexOf(text);
  assert.ok(i >= 0, `"${text}" in [${pending.options.join(" | ")}]`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: i + 1 });
}

/** Runs the area tick with the notice roll forced, until the vyre is next to the player and lands. */
function notice(p, ticks = 1) {
  const random = Math.random;
  Math.random = () => 0;
  try {
    for (let i = 0; i < ticks; i++) AreaManager.process(p);
  } finally {
    Math.random = random;
  }
}

function talk(p, npc, option = "Talk-to") {
  const definition = npc.getCurrentDefinition?.(p) ?? npc.getDefinition();
  const clickType = definition.getActions().findIndex((op) => op === option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} has ${option}`);
  return PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), definition, clickType, location: { x: 0, y: 0, z: 0 }, handled: false });
}

function cart(p, withOre = true) {
  const id = 18119;
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  const object = { getId: () => id, getLocation: () => new core.Location(2392, 4630, 2), getDefinition: () => definition };
  const location = { x: 2392, y: 4630, z: 2 };
  if (!withOre) {
    const clickType = definition.getInteractions().findIndex((op) => op === "Inspect") + 1;
    return PM.emitObjectInteraction({ player: p, object, objectId: id, definition, clickType, location, sourceLocation: p.getLocation(), handled: false });
  }
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === core.ItemIdentifiers.DAEYALT_ORE);
  return PM.emitItemOnObject({ player: p, object, definition, objectId: id, item: p.getInventory().getItems()[slot],
    itemId: core.ItemIdentifiers.DAEYALT_ORE, itemSlot: slot, interfaceType: 0, location, handled: false });
}

function ores(p, count) {
  for (let i = 0; i < count; i++) p.getInventory().add(new core.Item(core.ItemIdentifiers.DAEYALT_ORE, 1));
}

/** Continues click-to-continue boxes until a menu opens or the conversation ends. */
function proceed(p, limit = 20) {
  for (let i = 0; i < limit; i++) {
    if (menu(p)) return;
    const manager = p.getDialogueManager();
    if (!manager.getCurrent()) return;
    manager.advance();
  }
}

test("the areas: Meiyerditch's streets and the mine are this unit's", (t) => {
  const { p } = player(t, "hassleareas", STAGE.SENT_BACK);
  assert.equal(AreaManager.get(new core.Location(...STREET))?.getName(), "Darkness of Hallowvale: Meiyerditch");
  assert.equal(AreaManager.get(new core.Location(3592, 3163, 1))?.getName(), "Darkness of Hallowvale: Meiyerditch", "the rooftops and walls too");
  assert.equal(AreaManager.get(new core.Location(...MINE))?.getName(), "Darkness of Hallowvale: Meiyerditch mine");
  assert.notEqual(AreaManager.get(new core.Location(3626, 9618, 0))?.getName(), "Darkness of Hallowvale: Meiyerditch", "not the hideout below");
  assert.ok(p);
});

test("stage 180: a vyrewatch lands, times its lines, and 'Send me to the mines!' sends the player to the mine (t5648-5676)", (t) => {
  const { p, seen } = player(t, "hassle180", STAGE.SENT_BACK);
  const { npc, anims } = vyrewatch(t, 3717, [3609, 3187, 0]); // adjacent N, as at t5648
  notice(p, 2);
  assert.deepEqual(seen.messages, ["A vyrewatch takes an interest in you."]);
  assert.equal(varbit(p, VARBIT.VAMP_HASSLE), 1);
  tick(1);
  assert.deepEqual(anims, [4695], "the landing (t5649)");
  tick(3);
  assert.equal(npc.getNpcTransformationId(), 3709, "the walking form (t5652)");
  tick(1);
  const opener = lastText(seen, CHAT_LEFT_TEXT);
  assert.ok(["I want a word with you!", "Stand where you are!", "Halt! Halt, I say!"].includes(opener), opener);
  assert.ok(seen.strings.some(([id, text]) => id === ((231 << 16) | 5) && text === ""), "no continue: the line is timed");
  assert.equal(p.getMovementQueue().isMovementBlocked(), true, "held while the vyre speaks");
  tick(4);
  assert.match(lastText(seen, CHAT_LEFT_TEXT), /mines/, "the offer names the mines after the hideout");
  tick(5);
  assert.equal(varbit(p, VARBIT.VAMP_CONV_STEP), 1, "2581 with the menu (t5662)");
  assert.equal(menu(p).title ?? menu(p).prompt ?? "The vyrewatch wants an answer!", "The vyrewatch wants an answer!");
  assert.deepEqual(menu(p).options, [
    "Okay, have a bite. (Offer a blood tithe).",
    "Send me to the mines! (Do a bit of menial work)",
    "Hey, look over there! (Distract and sneak away).",
  ]);
  choose(p, "Send me to the mines! (Do a bit of menial work)");
  tick(1);
  assert.equal(varbit(p, VARBIT.CHAT_VALUE), 2, "2582 is the answer (t5665)");
  assert.equal(lastText(seen, CHAT_RIGHT_TEXT), "Send me to the mines!");
  tick(3);
  assert.equal(lastText(seen, CHAT_LEFT_TEXT), "Very well...");
  tick(3);
  assert.ok(seen.anims.includes(4731) && seen.gfx.includes(342), "the teleport spell (t5671)");
  assert.ok(anims.includes(4729), "the vyre casts");
  assert.ok(seen.sounds.some(([id, delay]) => id === 201 && delay === 70));
  tick(5);
  assert.deepEqual(at(p), MINE, "the mine (t5676)");
  assert.equal(varbit(p, VARBIT.VAMP_HASSLE), 2);
  assert.equal(npc.getNpcTransformationId(), -1, "the vyre flies again");
});

test("before the hideout the offer is tithe, fight or distract; the tithe takes 6 hitpoints (Wiki)", (t) => {
  const { p, seen } = player(t, "hassle50", STAGE.ARRIVED);
  vyrewatch(t, 3729, [3610, 3186, 0]);
  notice(p, 2);
  tick(14);
  assert.deepEqual(menu(p).options, [
    "Okay, have a bite (Offer a blood tithe).",
    "Give me your best shot, you evil bloodsucker!",
    "Hey, look over there! (Distract and sneak away).",
  ]);
  assert.doesNotMatch(texts(seen, CHAT_LEFT_TEXT).join(" "), /mines/);
  choose(p, "Okay, have a bite (Offer a blood tithe).");
  tick(1);
  assert.equal(lastText(seen, CHAT_RIGHT_TEXT), "Okay, have a bite.");
  tick(6);
  assert.deepEqual(seen.hits, [6]);
  assert.notDeepEqual(at(p), MINE);
});

test("leaving Meiyerditch with the menu open ends the encounter: no tithe elsewhere when it would have timed out (Ours)", (t) => {
  const { p, seen } = player(t, "hassleleave", STAGE.SENT_BACK);
  vyrewatch(t, 3729, [3610, 3186, 0]);
  notice(p, 2);
  tick(14);
  assert.ok(menu(p), "the menu is open");
  p.moveTo(new core.Location(3213, 3424, 0));
  AreaManager.process(p);
  tick(40);
  assert.deepEqual(seen.hits, []);
  assert.equal(menu(p), null);
  assert.equal(p.getMovementQueue().isMovementBlocked?.() ?? false, false);
});

test("a logout while the vyre takes off still returns it to its flying form (the takeoff is the NPC's, not the player's)", (t) => {
  const { p } = player(t, "hassletakeoff", STAGE.SENT_BACK);
  const { npc } = vyrewatch(t, 3729, [3610, 3186, 0]);
  notice(p, 2);
  tick(14);
  choose(p, "Okay, have a bite. (Offer a blood tithe).");
  let ticks = 0;
  while (ticks < 40 && npc.getNpcTransformationId() !== 3725) { tick(1); ticks++; } // 3729's takeoff form
  assert.ok(ticks < 40, "the vyre reaches its takeoff form");
  PM.emitPlayerLogout({ player: p, username: p.getUsername() });
  p.setRegistered(false);
  tick(5);
  assert.equal(npc.getNpcTransformationId(), -1);
});

test("a failed distraction is a tithe; a vyre still busy with the player says so on Talk-to", (t) => {
  const { p, seen } = player(t, "hassledodge", STAGE.SKETCHING);
  p.getSkillManager().setCurrentLevel?.(core.Skill.THIEVING, 1);
  const { npc } = vyrewatch(t, 3717, [3609, 3187, 0]);
  notice(p, 2);
  tick(14);
  const random = Math.random;
  Math.random = () => 0.99;
  try {
    choose(p, "Hey, look over there! (Distract and sneak away).");
    tick(1);
  } finally {
    Math.random = random;
  }
  assert.equal(lastText(seen, CHAT_RIGHT_TEXT), "Hey, look over there!");
  tick(3);
  assert.equal(lastText(seen, CHAT_LEFT_TEXT), "Ha! I'm not falling for that! Prepare to be tithed...");
  tick(4);
  assert.deepEqual(seen.hits, [6]);
  assert.equal(talk(p, npc), true);
  assert.equal(seen.messages.at(-1), "This vyrewatch looks busy.");
});

test("walking off the menu brings 'what's the rush?' and the menu again; the fourth time is the tithe (2583)", (t) => {
  const { p, seen } = player(t, "hassleignore", STAGE.SENT_BACK);
  vyrewatch(t, 3717, [3609, 3187, 0]);
  notice(p, 2);
  tick(14);
  for (let i = 1; i <= 3; i++) {
    assert.ok(menu(p), `menu ${i}`);
    p.getPacketSender().sendInterfaceRemoval();
    tick(1);
    assert.equal(varbit(p, VARBIT.IGNORE_COUNT), i);
    assert.equal(lastText(seen, CHAT_LEFT_TEXT), "Hey, food sack, what's the rush? I was talking to you!");
    tick(3);
    assert.equal(lastText(seen, CHAT_RIGHT_TEXT), "Sorry, what were you saying?");
    tick(3);
  }
  p.getPacketSender().sendInterfaceRemoval();
  tick(1);
  assert.equal(lastText(seen, CHAT_RIGHT_TEXT), "Okay, have a bite.");
  tick(10);
  assert.deepEqual(seen.hits, [6]);
  assert.equal(varbit(p, VARBIT.IGNORE_COUNT), 0, "cleared once it is over");
});

test("nobody is stopped before the arrival, in vyre noble clothing, while 2580 is 2, or as a bot", (t) => {
  const early = player(t, "hassleearly", STAGE.CHUTE_FIXED);
  vyrewatch(t, 3717, [3609, 3187, 0]);
  notice(early.p, 3);
  assert.deepEqual(early.seen.messages, []);

  const noble = player(t, "hasslenoble", STAGE.COMPLETE, [3620, 3200, 0]);
  vyrewatch(t, 3718, [3620, 3201, 0]);
  const equipment = noble.p.getEquipment();
  const slots = [core.Equipment.BODY_SLOT ?? 4, core.Equipment.LEG_SLOT ?? 7, core.Equipment.FEET_SLOT ?? 10];
  [core.ItemIdentifiers.VYRE_NOBLE_TOP, core.ItemIdentifiers.VYRE_NOBLE_LEGS, core.ItemIdentifiers.VYRE_NOBLE_SHOES]
    .forEach((id, i) => equipment.setItem(slots[i], new core.Item(id, 1)));
  notice(noble.p, 3);
  assert.deepEqual(noble.seen.messages, []);

  const bot = player(t, "hasslebot", STAGE.SENT_BACK, [3630, 3210, 0]);
  bot.p.isPlayerBot = () => true;
  vyrewatch(t, 3719, [3630, 3211, 0]);
  notice(bot.p, 3);
  assert.deepEqual(bot.seen.messages, []);

  // Back from a mine trip (2580 = 2): left alone (ours) until live's flag drops to 1.
  const punished = player(t, "hasslepunished", STAGE.SARIUS_TALKED, [3594, 3300, 1]);
  const { npc } = vyrewatch(t, 3750, [3593, 3297, 1]);
  talk(punished.p, npc);
  proceed(punished.p);
  choose(punished.p, "Send me to the mines.");
  tick(9);
  assert.equal(varbit(punished.p, VARBIT.VAMP_HASSLE), 2);
  punished.p.moveTo(new core.Location(3640, 3240, 0));
  vyrewatch(t, 3731, [3640, 3241, 0]);
  notice(punished.p, 3);
  assert.equal(punished.seen.messages.includes("A vyrewatch takes an interest in you."), false);
});

test("after the quest a vyrewatch still stops the player (Wiki Transcript:Vyrewatch, after Darkness of Hallowvale)", (t) => {
  const { p, seen } = player(t, "hassleafter", STAGE.COMPLETE, [3640, 3220, 0]);
  vyrewatch(t, 3730, [3640, 3221, 0]);
  notice(p, 2);
  assert.deepEqual(seen.messages, ["A vyrewatch takes an interest in you."]);
});

test("stage 250 Talk-to: Hello?, an insult, Send me to the mines.|Sorry., and the mine 3 ticks after the spell (t6829-6846)", (t) => {
  const { p, seen } = player(t, "hassletalk", STAGE.SARIUS_TALKED, [3594, 3300, 1]);
  const { npc } = vyrewatch(t, 3750, [3593, 3297, 1]);
  assert.equal(talk(p, npc), true);
  assert.equal(lastText(seen, CHAT_RIGHT_TEXT), "Hello?");
  proceed(p);
  assert.ok(["Get lost, food sack!", "Get out of my face, meat sack, I don't 'play' with my food.",
    "Get about your business, meat sack, before I perforate you real good!"].includes(lastText(seen, CHAT_LEFT_TEXT)));
  assert.deepEqual(menu(p).options, ["Send me to the mines.", "Sorry."]);
  choose(p, "Send me to the mines.");
  assert.equal(lastText(seen, CHAT_RIGHT_TEXT), "Send me to the mines!");
  tick(3);
  assert.equal(lastText(seen, CHAT_LEFT_TEXT), "Very well...");
  tick(3);
  assert.ok(seen.anims.includes(4731) && seen.gfx.includes(342) && seen.sounds.some(([id, delay]) => id === 201 && delay === 0));
  tick(3);
  assert.deepEqual(at(p), MINE);
  assert.equal(varbit(p, VARBIT.VAMP_HASSLE), 2);
});

test("before the hideout, Talk-to is not this unit's", (t) => {
  const { p } = player(t, "hassletalkearly", STAGE.RAL_INTRODUCED, [3594, 3300, 1]);
  const { npc } = vyrewatch(t, 3750, [3593, 3297, 1]);
  talk(p, npc);
  assert.equal(menu(p), null, "no mines offer before the hideout");
});

test("the cart: 6, 6 and 3 ores, live's messageboxes and sound; Inspect with none says what it holds (t5753-5823)", (t) => {
  const { p, seen } = player(t, "hasslecart", STAGE.SENT_BACK, MINE);
  ores(p, 6);
  assert.equal(cart(p), true);
  assert.equal(varbit(p, VARBIT.MINE_CART), 6);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.DAEYALT_ORE), 0);
  assert.equal(lastText(seen, MESSAGEBOX_TEXT), "You deposit 6 ores into the cart. The cart can hold 9 more ores.");
  assert.ok(seen.sounds.some(([id]) => id === 2999));
  assert.equal(cart(p, false), true);
  assert.equal(lastText(seen, MESSAGEBOX_TEXT), "The cart can hold 9 more ores.");
  ores(p, 6);
  cart(p);
  assert.equal(lastText(seen, MESSAGEBOX_TEXT), "You deposit 6 ores into the cart. The cart can hold 3 more ores.");
  ores(p, 5);
  cart(p);
  assert.equal(varbit(p, VARBIT.MINE_CART), 15);
  assert.equal(lastText(seen, MESSAGEBOX_TEXT), "You deposit 3 ores into the cart. The cart is now full.");
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.DAEYALT_ORE), 2, "only what fits goes in");
  cart(p);
  assert.equal(lastText(seen, MESSAGEBOX_TEXT), "The cart is now full.");
});

test("the guard: not yet with the cart short; with it full, 2574 = 1 and north-east Meiyerditch, 2588 back to 0 (t5825-5840)", (t) => {
  const { p, seen } = player(t, "hasslesguard", STAGE.SENT_BACK, [2389, 4618, 2]);
  const guard = core.NPC.create(3690, new core.Location(2389, 4616, 2));
  assert.equal(talk(p, guard), true);
  proceed(p);
  assert.equal(lastText(seen, CHAT_LEFT_TEXT), "When you've filled the mine cart, we'll think about it.");
  assert.deepEqual(at(p), [2389, 4618, 2]);
  ores(p, 15);
  cart(p);
  p.getDialogueManager().reset();
  talk(p, guard);
  proceed(p);
  assert.ok(texts(seen, CHAT_RIGHT_TEXT).includes("But I've filled the mine cart."));
  assert.equal(lastText(seen, CHAT_LEFT_TEXT), "Okay, I guess you can go then, food sack!");
  tick(3);
  assert.deepEqual(at(p), [3621, 3322, 0]);
  assert.equal(varbit(p, VARBIT.MINE_PUNISHED), 1);
  assert.equal(varbit(p, VARBIT.MINE_CART), 15, "the cart empties 2 ticks after the teleport");
  tick(2);
  assert.equal(varbit(p, VARBIT.MINE_CART), 0);
  assert.equal(p.getMovementQueue().isMovementBlocked(), false);
});

for (const exitTick of [0, 2, 3, 4, 5]) {
  test(`mine exit logout at tick ${exitTick} saves only the cart progress still owed`, async (t) => {
    const fs = require("node:fs");
    const os = require("node:os");
    const { GameConstants } = require("../dist/game/GameConstants");
    const { JsonPlayerPersistence } = require("../plugins/persistence/JsonPlayerPersistence.plugin");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tsps-hallowvale-cart-"));
    const oldDirectory = JsonPlayerPersistence.SAVE_DIRECTORY;
    const oldPersistence = GameConstants.PLAYER_PERSISTENCE;
    JsonPlayerPersistence.SAVE_DIRECTORY = directory;
    const persistence = new JsonPlayerPersistence();
    GameConstants.setPlayerPersistence(persistence);
    t.after(async () => {
      await persistence.flush();
      GameConstants.setPlayerPersistence(oldPersistence);
      JsonPlayerPersistence.SAVE_DIRECTORY = oldDirectory;
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith("tsps-hallowvale-cart-"));
      fs.rmSync(directory, { recursive: true, force: true });
    });

    const { p } = player(t, `cartlogout${exitTick}`, STAGE.SENT_BACK, [2389, 4618, 2]);
    ores(p, 15);
    cart(p);
    p.getDialogueManager().reset();
    const guard = core.NPC.create(3690, new core.Location(2389, 4616, 2));
    talk(p, guard);
    proceed(p);
    tick(exitTick);
    const departed = exitTick >= 3;
    assert.deepEqual(at(p), departed ? [3621, 3322, 0] : [2389, 4618, 2]);
    if (exitTick < 5) assert.equal(varbit(p, VARBIT.MINE_CART), 15, "normal delayed display is retained before logout");
    assert.equal(p.logoutRefusal(), null);
    p.onLogout();
    p.setRegistered(false);
    tick(5);
    await persistence.flush();
    assert.ok(fs.existsSync(persistence.resolveFilePath(p.getUsername(), p.getProfile())), "logout reached the actual disk save");
    const saved = persistence.load(p.getUsername(), p.getProfile());
    assert.ok(saved);
    assert.equal(saved.attributes[VARS_ATTRIBUTE]?.[VARBIT.MINE_CART] ?? 0, departed ? 0 : 15);

    const { p: restored } = player(t, `cartrestore${exitTick}`, STAGE.SENT_BACK, MINE);
    saved.applyToPlayer(restored);
    PM.emitPlayerLogin({ player: restored, username: restored.getUsername() });
    if (departed) {
      const request = { player: restored, handled: false };
      PM.emitCustomEvent("darkness-of-hallowvale:send-to-mines", request);
      assert.equal(request.handled, true);
      tick(4);
      assert.deepEqual(at(restored), MINE);
    }
    assert.equal(restored.getAttribute(VARS_ATTRIBUTE)?.[VARBIT.MINE_CART] ?? 0, departed ? 0 : 15,
      "a new mine visit owes fresh ore; an interrupted exit still inside keeps its paid cart");
  });
}

test("2580 goes from 2 back to 1 after 500 ticks in Meiyerditch (t6995 -> t7497)", (t) => {
  const { p } = player(t, "hasslerelease", STAGE.SARIUS_TALKED, [3594, 3300, 1]);
  const { npc } = vyrewatch(t, 3750, [3593, 3297, 1]);
  talk(p, npc);
  proceed(p);
  choose(p, "Send me to the mines.");
  tick(9);
  assert.equal(varbit(p, VARBIT.VAMP_HASSLE), 2);
  p.moveTo(new core.Location(3630, 3290, 0));
  for (let i = 0; i < 499; i++) AreaManager.process(p);
  assert.equal(varbit(p, VARBIT.VAMP_HASSLE), 2);
  AreaManager.process(p);
  assert.equal(varbit(p, VARBIT.VAMP_HASSLE), 1);
});

test("the miners give a bronze pickaxe to a player without one (Wiki Transcript:Meiyerditch miner)", (t) => {
  const { p } = player(t, "hasslepick", STAGE.SENT_BACK, MINE);
  const miner = core.NPC.create(3819, new core.Location(2392, 4626, 2));
  talk(p, miner);
  proceed(p);
  assert.ok(menu(p)?.options.includes("Do you have a spare pick?"), JSON.stringify(menu(p)?.options));
  choose(p, "Do you have a spare pick?");
  proceed(p);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BRONZE_PICKAXE), 1);
});
