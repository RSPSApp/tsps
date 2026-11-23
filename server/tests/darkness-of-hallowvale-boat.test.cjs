// Run after `yarn build`: node --test tests/darkness-of-hallowvale-boat.test.cjs
//
// Darkness of Hallowvale, stages 0-50 and the later boat trips (the Boat unit), against the live
// capture (revision 242): Veliaf's opening talk (t256-313), the start on the continue of "Once
// you're in..." (t334), the post-start menus (t336-361), the boat and chute repairs (t408-466), the
// push cutscene (t468-496), the boat map ride (t498-526), the dock rocks (t530-535) and the return
// trip at stage 180 (t5405-5464). Real plugins, a real Player; ticks are TaskManager.process().
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
const { impliedVarbits, STAGE, VARBIT, VARS_ATTRIBUTE, SAVE_VERSION_ATTRIBUTE } = require("../plugins/quests/hallowvale/State.DarknessOfHallowvale");

const STAGE_KEY = "quest.darkness_of_hallowvale.stage";
const IN_AID_STAGE_KEY = "quest.in_aid_of_the_myreque.stage";
const IN_AID_COMPLETE = 430;
const uid = (group, child) => (group << 16) | child;
const MESBOX_TEXT = uid(229, 3), DOUBLE_TEXT = uid(11, 2);
const NPC_CHAT = 231, PLAYER_CHAT = 217;
const VELIAF = 9489, VELIAF_HIDEOUT = 8277;
const BOAT = 12944, CHUTE = 12947, SEA_BOAT = 12945, JUMP_ROCK = 17958, CLIMB_UP = 17959;
const BOATHOUSE = { x: 3523, y: 3180, z: 0 };
const DOCK = { x: 3605, y: 3161, z: 1 };
let core, I, index = 8600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, stage, at = BOATHOUSE, vars = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(`dohboat${index}`);
  p.setRegistered(true);
  p.setLocation(new core.Location(at.x, at.y, at.z));
  p.needsPlacement = false;
  p.setAttribute(IN_AID_STAGE_KEY, IN_AID_COMPLETE);
  p.setAttribute(SAVE_VERSION_ATTRIBUTE, 1);
  p.setAttribute(VARS_ATTRIBUTE, { ...impliedVarbits(stage), ...vars });
  p.setAttribute(STAGE_KEY, stage);
  const skills = p.getSkillManager();
  for (const [skill, level] of [["STRENGTH", 59], ["MAGIC", 70], ["CRAFTING", 73], ["AGILITY", 73], ["THIEVING", 54], ["MINING", 73], ["CONSTRUCTION", 64]]) {
    skills.setMaxLevel(core.Skill[skill], level).setCurrentLevel(core.Skill[skill], level);
  }
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  const seen = { strings: [], chatbox: [], sounds: [], anims: [], messages: [], items: [], varbits: [], said: [], heads: [], interfaces: [], ifAnims: [], cameras: [] };
  const sender = p.getPacketSender();
  const spy = (method, record) => {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  };
  spy("sendString", (text, id) => {
    seen.strings.push([id, String(text)]);
    const line = seen.said.at(-1);
    if (line && line.text === null && id === uid(line.group, 6)) line.text = String(text).replace(/<br>/g, " ");
  });
  spy("sendChatboxInterface", (group) => seen.chatbox.push(group));
  spy("sendSound", (id, volume, delay) => seen.sounds.push([id, delay]));
  spy("sendItemOnInterfaces", (id, item) => seen.items.push(item));
  spy("sendVarbit", (id, value) => seen.varbits.push([id, value]));
  spy("sendInterface", (id) => seen.interfaces.push(id));
  spy("sendNpcHeadOnInterface", (npcId) => seen.heads.push(npcId));
  spy("sendCameraMoveTo", (x, y, h) => seen.cameras.push([x, y, h]));
  spy("sendInterfaceAnimation", (component, anim) => {
    const group = component >> 16;
    if (group === NPC_CHAT || group === PLAYER_CHAT) seen.said.push({ group, who: group === NPC_CHAT ? "npc" : "player", anim, text: null });
    else seen.ifAnims.push([component, anim]);
  });
  const anim = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { seen.anims.push(animation.getId()); return anim(animation); };
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { seen.messages.push(String(text)); return send(text, ...rest); };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, seen };
}

const stageOf = (p) => p.getAttribute(STAGE_KEY);
const varbit = (p, id) => Number(p.getAttribute(VARS_ATTRIBUTE)?.[id]) || 0;
const texts = (seen, id) => seen.strings.filter(([at]) => at === id).map(([, text]) => text.replace(/<br>/g, " "));
const tick = (n = 1) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const menu = (p) => core.MultiChatboxPrompt.getPending(p);
const advance = (p) => p.getDialogueManager().advance();
const tile = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
const lastSaid = (seen) => seen.said.at(-1);

function choose(p, text) {
  const pending = menu(p);
  assert.ok(pending, `a menu is open for "${text}"`);
  const at = pending.options.indexOf(text);
  assert.ok(at >= 0, `"${text}" in [${pending.options.join(" | ")}]`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: at + 1 });
}

/** Continues lines until a menu opens or the chat ends. */
function proceed(p, limit = 40) {
  for (let i = 0; i < limit; i++) {
    if (menu(p)) return;
    const manager = p.getDialogueManager();
    if (!manager.getCurrent()) return;
    manager.advance();
  }
}

function fakeObject(id, at) {
  return { getId: () => id, getLocation: () => new core.Location(at[0], at[1], at[2]), getPrivateArea: () => null, getType: () => 10, getFace: () => 0,
    getDefinition: () => ObjectDefinition.forId(id) };
}

function click(p, id, at) {
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  return PM.emitObjectInteraction({ player: p, object: fakeObject(id, at), objectId: id, definition, clickType: 1,
    option: definition?.getInteractions?.()?.[0] ?? "", location: { x: at[0], y: at[1], z: at[2] },
    sourceLocation: { x: p.getLocation().getX(), y: p.getLocation().getY(), z: p.getLocation().getZ() }, handled: false });
}

function useOn(p, itemId, id, at) {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  return PM.emitItemOnObject({ player: p, object: fakeObject(id, at), definition: ObjectDefinition.forPlayer(id, p) ?? undefined, objectId: id,
    item: p.getInventory().getItems()[slot], itemId, itemSlot: slot, interfaceType: 0, location: { x: at[0], y: at[1], z: at[2] }, handled: false });
}

function talkVeliaf(p) {
  const npc = new NPC(VELIAF_HIDEOUT, new core.Location(3496, 9629, 0));
  assert.equal(npc.getContentId(p), VELIAF);
  return PM.emitNpcInteraction({ player: p, npc, definition: npc.getCurrentDefinition(p), npcId: VELIAF, npcIndex: 1,
    clickType: 1, location: { x: 3496, y: 9629, z: 0 }, handled: false });
}

function tools(p) {
  const inventory = p.getInventory();
  inventory.setItem(5, new core.Item(I.HAMMER, 1));
  inventory.setItem(6, new core.Item(I.PLANK, 1));
  inventory.setItem(7, new core.Item(I.PLANK, 1));
  inventory.setItem(10, new core.Item(I.STEEL_NAILS, 59));
}

const HIDEOUT = { x: 3491, y: 9627, z: 0 };

// ---------------------------------------------------------------------------
// Veliaf
// ---------------------------------------------------------------------------

test("Veliaf before the quest: 'Hello again', chathead 8277, chatneu by line count, and 'other options' drop the one asked", (t) => {
  const { p, seen } = player(t, STAGE.NOT_STARTED, HIDEOUT);
  assert.equal(talkVeliaf(p), true);
  assert.deepEqual(lastSaid(seen), { group: PLAYER_CHAT, who: "player", anim: 588, text: "Hello again. How's things?" });
  advance(p);
  assert.equal(seen.heads.at(-1), VELIAF_HIDEOUT, "if_setnpchead 8277 (t257)");
  assert.equal(lastSaid(seen).anim, 590, "a three-line line is chatneu3");
  assert.ok(lastSaid(seen).text.startsWith("Very good. I'd say our mission"));
  proceed(p);
  assert.deepEqual(menu(p).options, ["Is there something I can do to help out?", "What will you do here in Burgh de Rott?",
    "Why re-establish contact with the Sanguinesti region?", "Why ask Misthalin for some help?", "Okay, thanks."]);
  choose(p, "What will you do here in Burgh de Rott?");
  assert.deepEqual(lastSaid(seen), { group: PLAYER_CHAT, who: "player", anim: 554, text: "What will you do here in Burgh de Rott?" });
  advance(p);
  assert.equal(lastSaid(seen).anim, 591, "'Oh, the usual...' is four lines (t296)");
  proceed(p);
  assert.deepEqual(menu(p).options, ["Is there something I can do to help out?", "Why re-establish contact with the Sanguinesti region?",
    "Why ask Misthalin for some help?", "Okay, thanks."], "without the option just asked (t297)");
  choose(p, "Why re-establish contact with the Sanguinesti region?");
  proceed(p);
  assert.deepEqual(menu(p).options, ["Is there something I can do to help out?", "What will you do here in Burgh de Rott?",
    "Why ask Misthalin for some help?", "Okay, thanks."], "'What will you do' is back (t304)");
  choose(p, "Okay, thanks.");
  assert.deepEqual(lastSaid(seen), { group: PLAYER_CHAT, who: "player", anim: 588, text: "Okay, thanks." });
  proceed(p);
  assert.equal(stageOf(p), STAGE.NOT_STARTED);
});

test("the start: Yes changes nothing; 10 and the start message on the continue of 'Once you're in...' (t334)", (t) => {
  const { p, seen } = player(t, STAGE.NOT_STARTED, HIDEOUT);
  talkVeliaf(p);
  proceed(p);
  choose(p, "Is there something I can do to help out?");
  assert.equal(lastSaid(seen).anim, 554);
  proceed(p);
  assert.equal(menu(p).title, "Start the Darkness of Hallowvale quest?");
  choose(p, "Yes.");
  assert.equal(stageOf(p), STAGE.NOT_STARTED, "no change on Yes (t326)");
  for (let i = 0; i < 10 && !lastSaid(seen).text?.startsWith("Once you're in"); i++) advance(p);
  assert.ok(lastSaid(seen).text.startsWith("Once you're in"), JSON.stringify(lastSaid(seen)));
  assert.equal(lastSaid(seen).anim, 591);
  assert.equal(stageOf(p), STAGE.NOT_STARTED, "not while the line shows");
  advance(p);
  assert.equal(stageOf(p), STAGE.STARTED);
  assert.ok(seen.varbits.some(([id, value]) => id === VARBIT.QUEST && value === STAGE.STARTED));
  assert.ok(seen.messages.some((text) => text.startsWith("You've started a new quest: ") && text.includes("Darkness of Hallowvale")), seen.messages.join(" | "));
  assert.ok(lastSaid(seen).text.startsWith("One last thing to be aware of is the vyrewatch."));
  proceed(p);
  assert.deepEqual(menu(p).options, ["Can you tell me more about the Sanguinesti region?", "Can you tell me more about the Sanguinesti Myreque?", "Okay, thanks."]);
  choose(p, "Can you tell me more about the Sanguinesti Myreque?");
  proceed(p);
  choose(p, "How do I get into the Sanguinesti region?");
  const messages = seen.messages.length;
  proceed(p);
  assert.ok(seen.said.some((line) => line.text?.startsWith("One last thing")), "the four lines again (t356-359)");
  assert.equal(seen.messages.length, messages, "no second start");
  assert.deepEqual(menu(p)?.options, ["Can you tell me more about the Sanguinesti region?", "Can you tell me more about the Sanguinesti Myreque?", "Okay, thanks."],
    "back at the post-start menu (t359)");
});

test("a boost that wears off between Yes and 'Once you're in...' does not undo the start (requirements are Yes's)", (t) => {
  const { p } = player(t, STAGE.NOT_STARTED, HIDEOUT);
  p.getSkillManager().setMaxLevel(core.Skill.THIEVING, 21).setCurrentLevel(core.Skill.THIEVING, 22);
  talkVeliaf(p);
  proceed(p);
  choose(p, "Is there something I can do to help out?");
  proceed(p);
  choose(p, "Yes.");
  p.getSkillManager().setCurrentLevel(core.Skill.THIEVING, 21);
  for (let i = 0; i < 12 && stageOf(p) === STAGE.NOT_STARTED; i++) advance(p);
  assert.equal(stageOf(p), STAGE.STARTED);
});

test("short of a requirement, Yes gives the requirement lines and the chat ends; the stage stays 0", (t) => {
  const { p, seen } = player(t, STAGE.NOT_STARTED, HIDEOUT);
  p.getSkillManager().setMaxLevel(core.Skill.STRENGTH, 30).setCurrentLevel(core.Skill.STRENGTH, 30);
  talkVeliaf(p);
  proceed(p);
  choose(p, "Is there something I can do to help out?");
  proceed(p);
  choose(p, "Yes.");
  assert.ok(seen.messages.includes("You need 40 Strength to start this quest."), seen.messages.join(" | "));
  proceed(p);
  assert.equal(stageOf(p), STAGE.NOT_STARTED);
  assert.ok(!seen.said.some((line) => line.text?.startsWith("Once you're in")));
});

test("before In Aid of the Myreque is complete Veliaf is not this quest's", (t) => {
  const { p, seen } = player(t, STAGE.NOT_STARTED, HIDEOUT);
  p.setAttribute(IN_AID_STAGE_KEY, 380);
  talkVeliaf(p);
  assert.ok(!seen.said.some((line) => line.text === "Hello again. How's things?"));
  assert.equal(stageOf(p), STAGE.NOT_STARTED);
});

test("Veliaf at 10-40 and after the arrival plays the stage's variant", (t) => {
  const early = player(t, STAGE.CHUTE_FIXED, HIDEOUT);
  assert.equal(talkVeliaf(early.p), true);
  assert.equal(lastSaid(early.seen).text, "Well met, friend.");
  assert.equal(lastSaid(early.seen).anim, 588);
  proceed(early.p);
  choose(early.p, "Can you tell me more about the Sanguinesti region?");
  proceed(early.p);
  assert.deepEqual(menu(early.p).options, ["How do I get into the Sanguinesti region?", "Can you tell me more about the Sanguinesti Myreque?", "Okay, thanks."]);
  const later = player(t, STAGE.ROUTE_KNOWN, HIDEOUT);
  assert.equal(talkVeliaf(later.p), true);
  assert.equal(lastSaid(later.seen).text, "Hey again. I've made my way into the Sanguinesti region, I think!");
});

// ---------------------------------------------------------------------------
// The boat and the chute
// ---------------------------------------------------------------------------

test("the boat before the quest: its message box only", (t) => {
  const { p, seen } = player(t, STAGE.NOT_STARTED);
  assert.equal(click(p, BOAT, [3523, 3177, 0]), true);
  assert.deepEqual(texts(seen, MESBOX_TEXT), ["This boat looks pretty broken."]);
  advance(p);
  assert.ok(!menu(p), "no repair prompt before the start");
});

test("the boat repair: inspect box, 'Fix the boat?' No closes; Yes walks, hammers, and 4 ticks on 2585, 20, the plank, 4 nails, the double box", (t) => {
  const { p, seen } = player(t, STAGE.STARTED);
  tools(p);
  click(p, BOAT, [3523, 3177, 0]);
  assert.deepEqual(texts(seen, MESBOX_TEXT), ["This boat looks pretty broken and is in need of a serious overhaul."]);
  advance(p);
  assert.equal(menu(p)?.title, "Fix the boat?", "t418");
  choose(p, "No.");
  assert.ok(!menu(p));
  assert.equal(stageOf(p), STAGE.STARTED);

  click(p, BOAT, [3523, 3177, 0]);
  advance(p);
  choose(p, "Yes.");
  tick(1);
  assert.deepEqual(seen.anims, [], "walking first (t426-430)");
  p.moveTo(new core.Location(3525, 3178, 0)); // the walk's arrival
  tick(1);
  assert.deepEqual(seen.anims, [], "facing the boat (t431)");
  tick(1);
  assert.deepEqual(seen.anims, [4757], "sang_repair_boat (t432)");
  assert.deepEqual(seen.sounds.filter(([id]) => id === 2101), [[2101, 43], [2101, 65], [2101, 87]]);
  assert.ok(seen.varbits.some(([id, value]) => id === 12393 && value === 1), "busy");
  tick(3);
  assert.equal(varbit(p, VARBIT.BOAT_BROKEN), 0);
  tick(1);
  assert.equal(varbit(p, VARBIT.BOAT_BROKEN), 1, "t436");
  assert.equal(stageOf(p), STAGE.BOAT_FIXED);
  assert.equal(p.getInventory().getAmount(I.PLANK), 1);
  assert.equal(p.getInventory().getAmount(I.STEEL_NAILS), 55);
  assert.ok(seen.sounds.some(([id]) => id === 1710), "m2_build");
  assert.equal(seen.anims.at(-1), -1);
  assert.equal(seen.chatbox.at(-1), 11, "objectbox_double");
  assert.deepEqual(seen.items.slice(-2), [I.PLANK, I.STEEL_NAILS]);
  assert.equal(texts(seen, DOUBLE_TEXT).at(-1), "You use a plank and some nails to fix the boat.");
  advance(p);
  assert.deepEqual(seen.varbits.filter(([id]) => id === 12393).at(-1), [12393, 0]);
});

test("without the tools, Yes gives the missing-items box and nothing changes", (t) => {
  const { p, seen } = player(t, STAGE.STARTED);
  p.getInventory().setItem(6, new core.Item(I.PLANK, 1));
  click(p, BOAT, [3523, 3177, 0]);
  advance(p);
  choose(p, "Yes.");
  assert.equal(texts(seen, MESBOX_TEXT).at(-1), "You do not have the required items to do that. You need a hammer, a plank and 4 nails of any kind.");
  tick(8);
  assert.equal(stageOf(p), STAGE.STARTED);
  assert.equal(varbit(p, VARBIT.BOAT_BROKEN), 0);
});

test("the chute: poor before the boat is fixed; then its repair from the north tile, no walk, 30 four ticks after the anim", (t) => {
  const before = player(t, STAGE.STARTED, { x: 3523, y: 3176, z: 0 });
  click(before.p, CHUTE, [3523, 3175, 0]);
  assert.deepEqual(texts(before.seen, MESBOX_TEXT), ["This chute looks to be in pretty poor condition."]);

  const { p, seen } = player(t, STAGE.BOAT_FIXED, { x: 3523, y: 3176, z: 0 });
  tools(p);
  p.getInventory().delete(I.PLANK, 1);
  p.getInventory().delete(I.STEEL_NAILS, 4);
  click(p, CHUTE, [3523, 3175, 0]);
  assert.equal(texts(seen, MESBOX_TEXT).at(-1), "This chute looks to be in pretty poor condition. You don't think you'll get the boat down it in this state.");
  advance(p);
  choose(p, "Yes.");
  tick(1);
  assert.deepEqual(seen.anims, [4757], "t459");
  tick(4);
  assert.equal(varbit(p, VARBIT.CHUTE_BROKEN), 1);
  assert.equal(stageOf(p), STAGE.CHUTE_FIXED);
  assert.equal(p.getInventory().getAmount(I.PLANK), 0);
  assert.equal(p.getInventory().getAmount(I.STEEL_NAILS), 51);
  assert.equal(texts(seen, DOUBLE_TEXT).at(-1), "You use a plank and some nails to fix the chute.");
});

test("a plank on the broken boat asks as Inspect does", (t) => {
  const { p, seen } = player(t, STAGE.STARTED);
  tools(p);
  assert.equal(useOn(p, I.PLANK, BOAT, [3523, 3177, 0]), true);
  assert.equal(texts(seen, MESBOX_TEXT).at(-1), "This boat looks pretty broken and is in need of a serious overhaul.");
});

test("Push before the chute is fixed: the chute would break the boat", (t) => {
  const { p, seen } = player(t, STAGE.BOAT_FIXED);
  click(p, BOAT, [3523, 3177, 0]);
  assert.equal(texts(seen, MESBOX_TEXT).at(-1), "The chute down to the sea looks like it will break the boat if used.");
});

test("the push: a cutscene with the boat sliding south, then 2585 = 2 and 2587 = 1; the stage stays 30", (t) => {
  const { p, seen } = player(t, STAGE.CHUTE_FIXED);
  assert.equal(click(p, BOAT, [3523, 3177, 0]), true);
  tick(1);
  assert.ok(seen.chatbox.includes(229), "the empty held box (t473)");
  tick(3);
  assert.ok(seen.varbits.some(([id, value]) => id === 542 && value === 1), "cutscene_status (t475)");
  tick(1);
  const boat = [...core.World.getNpcs()].find((npc) => npc?.getId?.() === 3833 && npc.getOwner?.() === p);
  assert.ok(boat, "the sang_boat NPC in the copy (t476)");
  const startY = boat.getLocation().getY();
  tick(3);
  assert.deepEqual(seen.anims, [810], "human_push (t480)");
  assert.ok(seen.sounds.some(([id, delay]) => id === 3000 && delay === 30));
  assert.ok(seen.cameras.length >= 1);
  for (let i = 1; i <= 10; i++) {
    tick(1);
    assert.equal(startY - boat.getLocation().getY(), i, `a tile south on tick ${i} (t481-490)`);
    // Live's npc teleport with the jump flag clear: clients slide the boat down the ramp (#6639).
    assert.equal(boat.isTeleportingWithoutJump(), true, `tick ${i}'s move is sent without the jump flag`);
  }
  tick(1);
  assert.equal(varbit(p, VARBIT.BOAT_BROKEN), 2);
  assert.equal(boat.isRegistered(), false, "the boat NPC goes with the scene");
  assert.equal(varbit(p, VARBIT.SEA_BOAT_VISIBLE), 1);
  assert.equal(stageOf(p), STAGE.CHUTE_FIXED, "no stage change (t491)");
  assert.deepEqual(tile(p), [3524, 3180, 0]);
  tick(4);
  assert.ok(seen.varbits.some(([id, value]) => id === 542 && value === 0));
  assert.equal(click(p, BOAT, [3523, 3177, 0]), false, "the slipway is empty");
});

// ---------------------------------------------------------------------------
// Board, the ride, the rocks
// ---------------------------------------------------------------------------

test("the first ride: stage 40 as the boat map opens, the dock eleven ticks on with its box", (t) => {
  const { p, seen } = player(t, STAGE.CHUTE_FIXED, { x: 3525, y: 3170, z: 0 }, { [VARBIT.BOAT_BROKEN]: 2, [VARBIT.SEA_BOAT_VISIBLE]: 1 });
  assert.equal(click(p, SEA_BOAT, [3522, 3169, 0]), true);
  tick(1);
  assert.deepEqual(seen.anims, [832], "human_pickuptable (t512)");
  tick(2);
  assert.equal(stageOf(p), STAGE.BOAT_RIDE, "t514");
  assert.ok(seen.interfaces.includes(454));
  assert.deepEqual(seen.ifAnims.at(-1), [uid(454, 3), 4748]);
  tick(11);
  assert.deepEqual(tile(p), [3605, 3161, 1], "t525");
  tick(1);
  assert.equal(texts(seen, MESBOX_TEXT).at(-1), "You dock the boat at a portion of wall that looks climbable.");
  assert.equal(stageOf(p), STAGE.BOAT_RIDE);
});

test("Jump-onto the rock: on it at once with human_steppingstonejump and jump; stage 50 two ticks on", (t) => {
  const { p, seen } = player(t, STAGE.BOAT_RIDE, DOCK);
  assert.equal(click(p, JUMP_ROCK, [3605, 3163, 1]), true);
  assert.deepEqual(tile(p), [3605, 3163, 1]);
  assert.deepEqual(seen.anims, [769]);
  assert.ok(seen.sounds.some(([id, delay]) => id === 2461 && delay === 10));
  const glide = p.getForceMovement();
  assert.equal(glide.getSpeed(), 28);
  assert.equal(glide.getReverseSpeed(), 40);
  tick(1);
  assert.equal(stageOf(p), STAGE.BOAT_RIDE);
  tick(1);
  assert.equal(stageOf(p), STAGE.ARRIVED, "t533");
  assert.deepEqual(seen.messages, []);
});

test("Climb-up from the rock: to the wall top with myq3_outcrop_wall_climb and climb_wall twice", (t) => {
  const { p, seen } = player(t, STAGE.ARRIVED, { x: 3605, y: 3163, z: 1 });
  assert.equal(click(p, CLIMB_UP, [3604, 3163, 1]), true);
  assert.deepEqual(tile(p), [3601, 3163, 1]);
  assert.deepEqual(seen.anims, [4727]);
  assert.deepEqual(seen.sounds.filter(([id]) => id === 2453), [[2453, 0], [2453, 80]]);
  assert.equal(p.getForceMovement().getReverseSpeed(), 150);
});

test("at 180 the boat is the Morytania fade trip to the dock, and the rock jump keeps the stage", (t) => {
  const { p, seen } = player(t, STAGE.SENT_BACK, { x: 3525, y: 3170, z: 0 });
  assert.equal(click(p, SEA_BOAT, [3522, 3169, 0]), true);
  tick(12);
  assert.ok(seen.messages.includes("You board the boat and sail to Meiyerditch."), seen.messages.join(" | "));
  assert.deepEqual(tile(p), [3605, 3161, 1]);
  assert.ok(!seen.interfaces.includes(454), "no boat map");
  tick(3);
  const before = seen.messages.length;
  assert.equal(click(p, JUMP_ROCK, [3605, 3163, 1]), true);
  assert.deepEqual(tile(p), [3605, 3163, 1]);
  tick(3);
  assert.equal(stageOf(p), STAGE.SENT_BACK);
  assert.equal(seen.messages.length, before, "no message (t5460)");
});

test("after the quest the rock is the ferries' (their own jump and line)", (t) => {
  const { p, seen } = player(t, STAGE.COMPLETE, DOCK);
  assert.equal(click(p, JUMP_ROCK, [3605, 3163, 1]), true);
  tick(2);
  assert.ok(seen.messages.includes("You jump onto the rocky wall."), seen.messages.join(" | "));
  assert.equal(stageOf(p), STAGE.COMPLETE);
});

test("a logout on the first ride lands the player at the dock with the ride counted", (t) => {
  const { p } = player(t, STAGE.CHUTE_FIXED, { x: 3525, y: 3170, z: 0 }, { [VARBIT.BOAT_BROKEN]: 2, [VARBIT.SEA_BOAT_VISIBLE]: 1 });
  click(p, SEA_BOAT, [3522, 3169, 0]);
  tick(1);
  PM.emitPlayerLogout({ player: p, username: p.getUsername() });
  assert.deepEqual(tile(p), [3605, 3161, 1]);
  assert.equal(stageOf(p), STAGE.BOAT_RIDE);
});

test("Board does nothing before the boat is in the water", (t) => {
  const { p } = player(t, STAGE.CHUTE_FIXED, { x: 3525, y: 3170, z: 0 });
  assert.equal(click(p, SEA_BOAT, [3522, 3169, 0]), false);
});
