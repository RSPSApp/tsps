// Run after `yarn build`: node --test tests/in-aid-of-the-myreque-burgh.test.cjs
//
// In Aid of the Myreque, stages 20-110 (the Burgh unit), against the live capture (revision 242):
// Florin's food pelting (varbit 1969, t270-290), the locked gate (t295) and the pass-through gate
// (t445), Florin's 30 (t309) and 60 (t431) lines, the food chest (t371-384), the inn's broken wall
// (t794), the collapsed wall (t799-803), the trapdoor (t807, t811-812), the plane-1 cellar and its
// 15 rubble locs (t812), the mine and scoop chains (t819-838), the finds (t856, t921, t975, t1013),
// the last scoop's plaque camera (t1105-1119), the plaque (t1133), the rubble pile (t1242-1255) and
// the refused bucket drop (t1187). Real plugins, a real Player; clicks go through PluginManager.
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

const STAGE = "quest.in_aid_of_the_myreque.stage";
const VARS = "in-aid-of-the-myreque:varbits";
const SAVE_VERSION = "in-aid-of-the-myreque:save-version";
const { impliedVarbits } = require("../plugins/quests/inaid/State.InAidOfTheMyreque");
const V = { PELT: 1969, WALL: 1970, TRAPDOOR: 1971, RUBBLE: 1972, PLAQUE: 1973, MESSAGE: 2006 };
const uid = (group, child) => (group << 16) | child;
const MESBOX = uid(229, 3), OBJBOX = uid(193, 2), DOUBLE = uid(11, 2), NPC_TEXT = uid(231, 6);
const CHEST = 12736, BROKEN_WALL = 12737, COLLAPSED = 12738, TRAPDOOR = 12743, PILE = 12749, PLAQUE = 12750, LADDER = 12779;
const GATE_L = 12816, GATE_R = 12817;
const RUBBLE = [12812, 12813, 12814, 12815];
const BUCKETS = [1925, 7622, 7624, 7626];
const GATE_SOUTH = { x: 3484, y: 3245, z: 0 };
let core, I, index = 9100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, stage, vars = {}, at = GATE_SOUTH) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(`iaotmburgh${index}`);
  p.setRegistered(true);
  p.setLocation(new core.Location(at.x, at.y, at.z));
  p.needsPlacement = false;
  p.setAttribute(SAVE_VERSION, 2);
  p.setAttribute(VARS, { ...impliedVarbits(stage), ...vars });
  p.setAttribute(STAGE, stage);
  p.getSkillManager().setLevel(core.Skill.MINING, 73);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  const seen = { strings: [], chatbox: [], sounds: [], anims: [], gfx: [], messages: [], items: [], cameras: [], resets: 0, removals: 0 };
  const sender = p.getPacketSender();
  const spy = (method, record) => {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  };
  spy("sendString", (text, id) => seen.strings.push([id, String(text)]));
  spy("sendChatboxInterface", (group) => seen.chatbox.push(group));
  spy("sendSound", (id, volume, delay) => seen.sounds.push([id, delay]));
  spy("sendItemOnInterfaces", (id, item) => seen.items.push(item));
  spy("sendCameraMoveTo", (x, y, h, rates) => seen.cameras.push(["move", x, y, h, rates?.rate]));
  spy("sendCameraReset", () => { seen.resets++; });
  spy("sendInterfaceRemoval", () => { seen.removals++; });
  const anim = p.performAnimation.bind(p);
  p.performAnimation = (animation) => { seen.anims.push(animation.getId()); return anim(animation); };
  const graphic = p.performGraphic.bind(p);
  p.performGraphic = (g) => { seen.gfx.push([g.getId(), g.getDelay?.()]); return graphic(g); };
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { seen.messages.push(String(text)); return send(text, ...rest); };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, seen };
}

const stageOf = (p) => p.getAttribute(STAGE);
const varbit = (p, id) => Number(p.getAttribute(VARS)?.[id]) || 0;
const texts = (seen, id) => seen.strings.filter(([at]) => at === id).map(([, text]) => text.replace(/<br>/g, " "));
const lastText = (seen, id) => texts(seen, id).at(-1);
const tick = (n = 1) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const menu = (p) => core.MultiChatboxPrompt.getPending(p);
const advance = (p) => p.getDialogueManager().advance();

function choose(p, text) {
  const pending = menu(p);
  assert.ok(pending, `a menu is open for "${text}"`);
  const at = pending.options.indexOf(text);
  assert.ok(at >= 0, `"${text}" in [${pending.options.join(" | ")}]`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: at + 1 });
}

/** Continues boxes until a menu opens, `until` sees its text, or the conversation ends. */
function proceed(p, seen, until = null, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (menu(p)) return;
    if (until && texts(seen, NPC_TEXT).some((text) => text.startsWith(until))) return;
    const manager = p.getDialogueManager();
    if (!manager.getCurrent()) { tick(); if (!manager.getCurrent() && !menu(p)) return; continue; }
    manager.advance();
  }
}

function fakeObject(id, at, privateArea = null) {
  return { getId: () => id, getLocation: () => new core.Location(at.x, at.y, at.z), getPrivateArea: () => privateArea, getType: () => 10, getFace: () => 0,
    getDefinition: () => ObjectDefinition.forId(id) };
}

function click(p, id, option, at, object = fakeObject(id, at)) {
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((op) => op === option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} (${id}) has ${option}`);
  return PM.emitObjectInteraction({ player: p, object, objectId: id, definition, clickType, option, location: { x: at.x, y: at.y, z: at.z },
    sourceLocation: { x: p.getLocation().getX(), y: p.getLocation().getY(), z: p.getLocation().getZ() }, handled: false });
}

function useOn(p, itemId, id, at, object = fakeObject(id, at)) {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  const item = p.getInventory().getItems()[slot];
  return PM.emitItemOnObject({ player: p, object, definition: ObjectDefinition.forPlayer(id, p) ?? undefined, objectId: id, item, itemId,
    itemSlot: slot, interfaceType: 0, location: { x: at.x, y: at.y, z: at.z }, handled: false });
}

function talk(p, npcId, option = "Talk-to", at = { x: 3484, y: 3243 }) {
  const npc = core.NPC.create(npcId, new core.Location(at.x, at.y, 0));
  const definition = npc.getCurrentDefinition?.(p) ?? npc.getDefinition();
  const clickType = definition.getActions().findIndex((op) => op === option) + 1;
  const event = { player: p, npc, npcId: npc.getId(), definition, clickType, action: option, handled: false };
  PM.emitNpcInteraction(event);
  return event;
}

function spawnFlorin(t, at = { x: 3483, y: 3243 }) {
  const npc = core.NPC.create(core.NpcIdentifiers.FLORIN, new core.Location(at.x, at.y, 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  return npc;
}

const fill = (p, count) => { for (let i = 0; i < count; i++) p.getInventory().add(new core.Item(I.BRONZE_DAGGER, 1)); };
const sceneLocs = (p) => (p.getPrivateArea?.()?.getObjects?.() ?? []).filter((object) => RUBBLE.includes(object.getId()));

// ---------------------------------------------------------------------------
// Florin, the gate and the chest (20-60)
// ---------------------------------------------------------------------------

test("approaching at 20, Florin throws every 10 ticks up to varbit 1969 = 3: throw, projectile, splash, sounds, a 0 hit", (t) => {
  const florin = spawnFlorin(t);
  const { p, seen } = player(t, 20, {}, { x: 3488, y: 3253, z: 0 });
  const florinAnims = [];
  const anim = florin.performAnimation.bind(florin);
  florin.performAnimation = (a) => { florinAnims.push(a.getId()); return anim(a); };
  let said = null;
  florin.forceChat = (text) => { said = text; };
  PM.emitPlayerMapSquareChange({ player: p, previous: null, location: p.getLocation() });
  tick();
  assert.equal(varbit(p, V.PELT), 1, "the first throw (t270)");
  assert.deepEqual(florinAnims, [385], "human_throw");
  assert.equal(said, "Get out of it! You're not having our food or our blood!");
  // 10 tiles away: the projectile lands at 46 + 5 * 10 = 96 (t270), the splash and splat delayed to it.
  assert.deepEqual(seen.gfx.at(-1), [31, 96]);
  assert.deepEqual(seen.sounds.slice(-2), [[2708, 0], [2285, 96]]);
  tick(9);
  assert.equal(varbit(p, V.PELT), 1, "one throw per 10 ticks");
  tick();
  assert.equal(varbit(p, V.PELT), 2);
  tick(10);
  assert.equal(varbit(p, V.PELT), 3);
  tick(30);
  assert.equal(varbit(p, V.PELT), 3, "no throws past 3");
  assert.equal(florinAnims.length, 3);
  // Out of Florin's sight, 1969 falls by one ~200 ticks after the last throw (t290 -> t491).
  p.setLocation(new core.Location(3490, 3290, 0));
  tick(168);
  assert.equal(varbit(p, V.PELT), 3);
  tick(2);
  assert.equal(varbit(p, V.PELT), 2, "1969 falls back once 200 ticks pass");
});

test("a throw closes an open chatbox (t280: Florin's own talk is cut short)", (t) => {
  spawnFlorin(t, { x: 3482, y: 3241 });
  const { p, seen } = player(t, 20, {}, { x: 3485, y: 3244, z: 0 });
  talk(p, core.NpcIdentifiers.FLORIN);
  assert.ok(p.getDialogueManager().getCurrent(), "Florin's talk is open");
  const removals = seen.removals;
  PM.emitPlayerMapSquareChange({ player: p, previous: null, location: p.getLocation() });
  tick();
  assert.equal(varbit(p, V.PELT), 1);
  assert.ok(seen.removals > removals, "the chatbox is closed by the throw");
  // 3 tiles: lands at 61 (t280), so the splash is delayed 61.
  assert.deepEqual(seen.gfx.at(-1), [31, 61]);
});

test("at 40 Florin no longer throws", (t) => {
  spawnFlorin(t);
  const { p } = player(t, 40, {}, { x: 3488, y: 3253, z: 0 });
  PM.emitPlayerMapSquareChange({ player: p, previous: null, location: p.getLocation() });
  tick(3);
  assert.equal(varbit(p, V.PELT), 0);
});

test("the gate before the food: only the locked mesbox (t295), no stage change", (t) => {
  const { p, seen } = player(t, 20, { [V.PELT]: 3 });
  click(p, GATE_L, "Open", { x: 3485, y: 3244, z: 0 });
  assert.equal(lastText(seen, MESBOX), "The gate has been locked. Clearly the townspeople don't want visitors.");
  assert.equal(stageOf(p), 20);
  assert.deepEqual(texts(seen, NPC_TEXT), [], "no Florin chat line");
});

test("from 40 the gate opens as a pass-through gate (t445) and shuts two ticks later (t447)", (t) => {
  const { p, seen } = player(t, 60, {}, { x: 3484, y: 3244, z: 0 });
  const registered = [], removed = [];
  const reg = core.ObjectManager.register, dereg = core.ObjectManager.deregister;
  core.ObjectManager.register = (object, ...rest) => { registered.push([object.getId(), object.getLocation().getX(), object.getLocation().getY(), object.getFace()]); return reg.call(core.ObjectManager, object, ...rest); };
  core.ObjectManager.deregister = (object, ...rest) => { removed.push([object.getId(), object.getLocation().getX(), object.getLocation().getY()]); return dereg.call(core.ObjectManager, object, ...rest); };
  t.after(() => { core.ObjectManager.register = reg; core.ObjectManager.deregister = dereg; });
  click(p, GATE_R, "Open", { x: 3484, y: 3244, z: 0 });
  const gateLocs = (list) => list.filter(([id]) => [GATE_L, GATE_R, 12818, 12819, 38848].includes(id));
  assert.deepEqual(gateLocs(registered).sort(), [[12818, 3485, 3243, 2], [12819, 3485, 3242, 2], [38848, 3484, 3244, 3], [38848, 3485, 3244, 3]].sort());
  assert.deepEqual(gateLocs(removed).map(([id]) => id).sort(), [GATE_L, GATE_R]);
  assert.deepEqual(seen.sounds.at(-1), [67, 0], "gate_open");
  assert.ok(p.hasFlag("movement:ignore-clipping"), "the opener steps over the inviswall");
  registered.length = 0;
  tick(2);
  assert.deepEqual(registered.map(([id]) => id).filter((id) => [GATE_L, GATE_R, 12818, 12819, 38848].includes(id)).sort(), [GATE_L, GATE_R],
    "the closed gates are back");
});

test("Florin at 20: 30 comes with \"Hey! Don't try to sweet talk me...\" (t309), not before", (t) => {
  const { p, seen } = player(t, 20, { [V.PELT]: 3 });
  talk(p, core.NpcIdentifiers.FLORIN);
  assert.equal(lastText(seen, NPC_TEXT), "Get out of it! You ain't comming in here to get our blood or our food!");
  advance(p);
  assert.equal(stageOf(p), 20, "still 20 on the player's line");
  advance(p);
  assert.equal(lastText(seen, NPC_TEXT), "Hey! Don't try to sweet talk me. I know you want something! But we got nothing! Nothing!");
  assert.equal(stageOf(p), 30);
});

test("food on the chest at 30: objectbox, then the camera, Florin's held line and 40; the camera resets 11 ticks later", (t) => {
  const { p, seen } = player(t, 30, { [V.PELT]: 3 });
  p.getInventory().add(new core.Item(I.SALMON, 1));
  assert.equal(useOn(p, I.SALMON, CHEST, { x: 3483, y: 3246, z: 0 }), true);
  assert.equal(p.getInventory().getAmount(I.SALMON), 0, "the salmon goes");
  assert.equal(stageOf(p), 40);
  assert.equal(lastText(seen, OBJBOX), "You gingerly place the food into the chest.");
  assert.deepEqual(seen.items.at(-1), I.SALMON);
  advance(p);
  assert.ok(seen.messages.includes("Nothing interesting happens."), "live's line after the box (t373)");
  assert.deepEqual(seen.cameras.at(-1), ["move", 3487, 3250, 500, 100]);
  assert.match(lastText(seen, NPC_TEXT), /^Blimey, did you see that\? (He|She) put some food in the chest for us!/);
  const resets = seen.resets;
  tick(10);
  assert.equal(seen.resets, resets, "still held");
  tick();
  assert.equal(seen.resets, resets + 1, "cam_reset at t384");
});

test("food before Florin's talk (20) is not taken", (t) => {
  const { p } = player(t, 20, { [V.PELT]: 3 });
  p.getInventory().add(new core.Item(I.SALMON, 1));
  useOn(p, I.SALMON, CHEST, { x: 3483, y: 3246, z: 0 });
  assert.equal(p.getInventory().getAmount(I.SALMON), 1);
  assert.equal(stageOf(p), 20);
});

test("at 40, the 'out of the way' answer sets 60 with \"Well, there's the inn...\" (t431)", (t) => {
  const { p, seen } = player(t, 40, {}, { x: 3484, y: 3242, z: 0 });
  talk(p, core.NpcIdentifiers.FLORIN);
  proceed(p, seen);
  choose(p, "Are there any 'out of the way' places here?");
  proceed(p, seen, "Ah, right, I know what you mean.");
  assert.equal(stageOf(p), 40, "not on the option");
  advance(p);
  assert.match(lastText(seen, NPC_TEXT), /^Well, there's the inn\./);
  assert.equal(stageOf(p), 60);
});

test("Florin at 40: his line, then the citizens' menu (t391), not the gate talk's", (t) => {
  const { p, seen } = player(t, 40, {}, { x: 3484, y: 3242, z: 0 });
  talk(p, core.NpcIdentifiers.FLORIN);
  proceed(p, seen);
  assert.deepEqual(menu(p).options.slice(0, 4), ["How come you have no food?", "What is this place?", "What do you do here?",
    "Are there any 'out of the way' places here?"]);
});

test("the citizens before 110: the town talk at 60 (t455), the inn-clearing talk from 70", (t) => {
  const { p, seen } = player(t, 60, {}, { x: 3491, y: 3243, z: 0 });
  talk(p, 4447, "Talk-to", { x: 3492, y: 3244 });
  assert.equal(lastText(seen, NPC_TEXT), "Hey there. How's it going?");
  p.getPacketSender().sendInterfaceRemoval();
  p.getDialogueManager().reset?.();
  p.setAttribute(STAGE, 70);
  talk(p, 4447, "Talk-to", { x: 3492, y: 3244 });
  assert.equal(lastText(seen, NPC_TEXT), "Hey there. So you're looking to clear out the cellar at the inn? How's it going?");
});

test("Aurel before the cellar is cleared: Trade is refused with his no-stock line", (t) => {
  const { p, seen } = player(t, 60, {}, { x: 3516, y: 3241, z: 0 });
  talk(p, core.NpcIdentifiers.AUREL, "Trade", { x: 3517, y: 3241 });
  assert.equal(lastText(seen, NPC_TEXT), "I'm sorry my friend, but I cannot open a store which has no stock.");
});

test("no owner-only Razvan copy is spawned (the world spawn is already there)", (t) => {
  const { p } = player(t, 60, {}, { x: 3492, y: 3236, z: 0 });
  tick();
  const owned = core.World.getNpcsOwnedBy(p) ?? [];
  assert.equal([...owned].filter((npc) => npc.getId() === core.NpcIdentifiers.RAZVAN).length, 0);
});

// ---------------------------------------------------------------------------
// The inn (60-100)
// ---------------------------------------------------------------------------

test("the broken wall's first Climb-over at 60: exactmove north, 840, climb_wall, 70 (t794)", (t) => {
  const { p, seen } = player(t, 60, {}, { x: 3491, y: 3230, z: 0 });
  click(p, BROKEN_WALL, "Climb-over", { x: 3491, y: 3230, z: 0 });
  assert.equal(stageOf(p), 70);
  assert.deepEqual(seen.sounds.at(-1), [2453, 0]);
  const movement = p.getForceMovement();
  assert.ok(movement, "an exactmove");
  assert.equal(movement.getAnimation?.() ?? movement.animation, 840);
  tick(2);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3491, 3231]);
  click(p, BROKEN_WALL, "Climb-over", { x: 3491, y: 3230, z: 0 });
  tick(2);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3491, 3230], "and back out");
  assert.equal(stageOf(p), 70);
});

test("a pickaxe on the collapsed wall at 70: four ticks, then 1970 = 1, 80 and the message (t799-803)", (t) => {
  const { p, seen } = player(t, 70, {}, { x: 3491, y: 3231, z: 0 });
  p.getInventory().add(new core.Item(I.RUNE_PICKAXE, 1));
  assert.equal(useOn(p, I.RUNE_PICKAXE, COLLAPSED, { x: 3489, y: 3231, z: 0 }), true);
  assert.equal(seen.messages.at(-1), "You swing your pickaxe at the rubble...");
  assert.equal(seen.anims.at(-1), 624, "the rune pickaxe's swing");
  tick(3);
  assert.equal(stageOf(p), 70);
  tick();
  assert.equal(varbit(p, V.WALL), 1);
  assert.equal(stageOf(p), 80);
  assert.equal(seen.messages.at(-1), "...and successfully break it down.");
  assert.deepEqual(seen.sounds.at(-1), [3600, 0]);
});

test("the trapdoor: Open at 80 sets 1971 and 90 (t807); Climb-down sets 100 and opens the plane-1 cellar with 15 rubble locs", (t) => {
  const { p, seen } = player(t, 80, {}, { x: 3491, y: 3232, z: 0 });
  click(p, TRAPDOOR, "Open", { x: 3490, y: 3232, z: 0 });
  assert.equal(varbit(p, V.TRAPDOOR), 1);
  assert.equal(stageOf(p), 90);
  assert.deepEqual(seen.sounds.at(-1), [91, 0]);
  assert.equal(ObjectDefinition.forPlayer(TRAPDOOR, p).getInteractions()[0], "Climb-down", "the multiloc is open for this player");
  click(p, TRAPDOOR, "Climb-down", { x: 3490, y: 3232, z: 0 });
  assert.equal(stageOf(p), 100);
  assert.equal(seen.anims.at(-1), 827);
  tick();
  assert.equal(p.getLocation().getZ(), 1, "the cellar copy is on plane 1");
  const locs = sceneLocs(p);
  assert.equal(locs.length, 15);
  assert.ok(locs.every((object) => object.getId() === 12812));
});

// ---------------------------------------------------------------------------
// The cellar (100-110)
// ---------------------------------------------------------------------------

function cellar(t, removed = 0, extra = {}) {
  const f = player(t, 100, { [V.RUBBLE]: removed, ...extra }, { x: 3491, y: 3232, z: 0 });
  click(f.p, TRAPDOOR, "Climb-down", { x: 3490, y: 3232, z: 0 });
  tick();
  return f;
}

function mineAndScoop(p, object) {
  const at = object.getLocation();
  const tile = { x: at.getX(), y: at.getY(), z: at.getZ() };
  click(p, object.getId(), "Mine", tile, object);
  tick(9);
  const mined = sceneLocs(p).find((other) => other.getLocation().equals(at));
  p.getDialogueManager().reset?.();
  click(p, mined.getId(), "Remove", tile, mined);
  tick(4);
}

test("a rubble: Mine steps 12812 -> 12815 three ticks apart; the first sets 2006 and shows the long mesbox (t819-828)", (t) => {
  const { p, seen } = cellar(t);
  p.getInventory().add(new core.Item(I.RUNE_PICKAXE, 1));
  const object = sceneLocs(p)[0];
  const at = object.getLocation();
  click(p, 12812, "Mine", { x: at.getX(), y: at.getY(), z: at.getZ() }, object);
  assert.equal(seen.messages.at(-1), "You swing your pick at the rock.");
  const mining = p.getSkillManager().getExperience(core.Skill.MINING);
  const idAt = () => sceneLocs(p).find((other) => other.getLocation().equals(at))?.getId();
  tick(3);
  assert.equal(idAt(), 12813);
  tick(3);
  assert.equal(idAt(), 12814);
  tick(3);
  assert.equal(idAt(), 12815);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MINING) - mining, 30, "10 Mining a step");
  assert.equal(varbit(p, V.MESSAGE), 1);
  assert.equal(lastText(seen, MESBOX), "You manage to mine the rubble to pieces. You should be able to move what's left out of the cellar now. Though you'll need something to carry it in.");
});

test("Remove with a spade: two digs, then 1972 + 1, the loc gone and the bucket 1925 -> 7622 (t834-838)", (t) => {
  const { p, seen } = cellar(t, 0, { [V.MESSAGE]: 1 });
  p.getInventory().add(new core.Item(I.RUNE_PICKAXE, 1));
  p.getInventory().add(new core.Item(I.SPADE, 1));
  p.getInventory().add(new core.Item(I.BUCKET, 1));
  const object = sceneLocs(p)[0];
  const at = object.getLocation();
  click(p, 12812, "Mine", { x: at.getX(), y: at.getY(), z: at.getZ() }, object);
  tick(9);
  assert.equal(seen.messages.at(-1), "You manage to mine the rubble to pieces.");
  const mined = sceneLocs(p).find((other) => other.getLocation().equals(at));
  click(p, 12815, "Remove", { x: at.getX(), y: at.getY(), z: at.getZ() }, mined);
  assert.equal(seen.messages.at(-1), "You use a spade to scoop the rubble into a bucket.");
  assert.equal(seen.anims.at(-1), 830);
  tick(2);
  assert.deepEqual(seen.sounds.filter(([id]) => id === 1470).length, 2);
  assert.equal(varbit(p, V.RUBBLE), 0);
  tick(2);
  assert.equal(varbit(p, V.RUBBLE), 1);
  assert.equal(sceneLocs(p).length, 14);
  assert.equal(p.getInventory().getAmount(7622), 1);
  assert.equal(p.getInventory().getAmount(I.BUCKET), 0);
});

test("the finds: rubbish at scoop 2 (doublebox, nails and glass), the plaster at 5 and the scroll at 10 (full bag: into the bucket)", (t) => {
  const { p, seen } = cellar(t, 1, { [V.MESSAGE]: 1 });
  p.getInventory().add(new core.Item(I.RUNE_PICKAXE, 1));
  p.getInventory().add(new core.Item(I.SPADE, 1));
  p.getInventory().add(new core.Item(7622, 1));
  mineAndScoop(p, sceneLocs(p)[0]);
  assert.equal(varbit(p, V.RUBBLE), 2);
  assert.equal(lastText(seen, DOUBLE), "Some rubbish falls out of the rubble as you pick it up. It's too big to fit in the bucket.");
  assert.equal(p.getInventory().getAmount(I.STEEL_NAILS), 3);
  assert.equal(p.getInventory().getAmount(1469), 1, "broken glass");
  const floor = core.World.getItems().filter((item) => item.getItem().getId() === I.BRONZE_NAILS && item.getOwner?.() !== undefined);
  assert.ok(floor.length >= 1, "bronze nails on the floor");
  assert.equal(p.getInventory().getAmount(7624), 1, "the bucket's second load");
});

test("the plaster at scoop 5 with a full bag goes into the bucket (t921)", (t) => {
  const { p, seen } = cellar(t, 4, { [V.MESSAGE]: 1 });
  p.getInventory().add(new core.Item(I.RUNE_PICKAXE, 1));
  p.getInventory().add(new core.Item(I.SPADE, 1));
  p.getInventory().add(new core.Item(I.BUCKET, 1));
  fill(p, 25);
  mineAndScoop(p, sceneLocs(p)[0]);
  assert.equal(varbit(p, V.RUBBLE), 5);
  assert.equal(lastText(seen, OBJBOX), "You find a piece of plaster with some interesting inscriptions on it, but you don't have enough space to keep it. You throw it into the bucket with the rest of the rubble.");
  assert.equal(seen.items.at(-1), I.PLASTER_FRAGMENT);
  assert.equal(p.getInventory().getAmount(I.PLASTER_FRAGMENT), 0);
});

test("re-entering a partly cleared cellar: the rubble left is what 1972 says", (t) => {
  const { p } = cellar(t, 9);
  assert.equal(sceneLocs(p).length, 6);
});

test("the last scoop: 110, the two mesboxes and the plaque camera, the second box held 7 ticks (t1105-1119)", (t) => {
  const { p, seen } = cellar(t, 14, { [V.MESSAGE]: 1 });
  p.getInventory().add(new core.Item(I.RUNE_PICKAXE, 1));
  p.getInventory().add(new core.Item(I.SPADE, 1));
  p.getInventory().add(new core.Item(7624, 1));
  mineAndScoop(p, sceneLocs(p)[0]);
  assert.equal(varbit(p, V.RUBBLE), 15);
  assert.equal(stageOf(p), 110);
  assert.equal(p.getInventory().getAmount(7626), 1);
  assert.equal(lastText(seen, MESBOX), "You clear out the last of the rubble.");
  advance(p);
  assert.equal(lastText(seen, MESBOX), "As you clear away the last of the rubble, you notice a dusty looking wall plaque which you hadn't spotted before.");
  assert.equal(seen.cameras.at(-1)[3], 400);
  tick(2);
  assert.equal(seen.cameras.at(-1)[3], 300);
  assert.equal(seen.cameras.at(-1)[4], 3, "the slow move");
  const resets = seen.resets;
  tick(5);
  advance(p);
  assert.equal(seen.resets, resets + 1, "cam_reset on its continue");
});

test("the plaque: live's text, 1973 set on the first read (t1133)", (t) => {
  const { p, seen } = cellar(t, 15);
  click(p, PLAQUE, "Search", { x: 3494, y: 9632, z: 1 });
  assert.equal(varbit(p, V.PLAQUE), 1);
  assert.match(lastText(seen, MESBOX), /^You read the wall plaque: '<col=000080>Blessings on Efaritay, our icyene queen/);
});

test("the cellar ladder: human_reachforladder, then back by the trapdoor (t1148-1149)", (t) => {
  const { p, seen } = cellar(t, 15);
  click(p, LADDER, "Climb-up", { x: 3490, y: 9632, z: 1 });
  assert.equal(seen.anims.at(-1), 828);
  tick();
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3491, 3232, 0]);
});

// ---------------------------------------------------------------------------
// Outside (110)
// ---------------------------------------------------------------------------

test("dropping a bucket of rubble in town is refused with the bucket's objectbox (t1187)", (t) => {
  const { p, seen } = player(t, 110, {}, { x: 3505, y: 3236, z: 0 });
  p.getInventory().add(new core.Item(7626, 1));
  const event = { player: p, interfaceId: 149 << 16, item: p.getInventory().getItems()[0], itemId: 7626, slot: 0, dropToGround: true, handled: false };
  assert.equal(PM.emitItemDropPolicy(event), true);
  assert.equal(event.dropToGround, false);
  assert.equal(lastText(seen, OBJBOX), "The people of Burgh de Rott would not be happy if you dumped the rubble here.");
  assert.equal(p.getInventory().getAmount(7626), 1);
});

test("the rubble pile's Search: the plaster and scroll come back (full bag: thrown back), then the empty menu; Yes empties every bucket (t1242-1255)", (t) => {
  const { p, seen } = player(t, 110, {}, { x: 3489, y: 3229, z: 0 });
  for (let i = 0; i < 5; i++) p.getInventory().add(new core.Item(7626, 1));
  fill(p, 23);
  click(p, PILE, "Search", { x: 3489, y: 3227, z: 0 });
  assert.equal(lastText(seen, OBJBOX), "You find a piece of plaster with some interesting inscriptions on it, but you don't have enough space to keep it. You throw it back onto the rubble pile.");
  advance(p);
  assert.equal(lastText(seen, OBJBOX), "You find a scroll with some interesting writing on it, but you don't have enough space to keep it. You throw it back onto the rubble pile.");
  advance(p);
  assert.equal(menu(p)?.title, "Empty your rubble onto the pile?");
  choose(p, "Yes.");
  assert.equal(p.getInventory().getAmount(7626), 0);
  assert.equal(p.getInventory().getAmount(I.BUCKET), 5);
  assert.equal(seen.anims.at(-1), 2283);
  assert.equal(seen.messages.at(-1), "You empty your rubble onto the pile.");
  // With room, the second search hands both over (t1266).
  for (let slot = 0; slot < 28; slot++) if (p.getInventory().getItems()[slot]?.getId() === I.BRONZE_DAGGER) p.getInventory().deleteAtSlot(slot, 1);
  click(p, PILE, "Search", { x: 3489, y: 3227, z: 0 });
  assert.equal(lastText(seen, OBJBOX), "You find a piece of plaster with some interesting inscriptions on it.");
  assert.equal(p.getInventory().getAmount(I.PLASTER_FRAGMENT), 1);
  advance(p);
  assert.equal(lastText(seen, OBJBOX), "You find a scroll with some interesting writing on it.");
  assert.equal(p.getInventory().getAmount(I.DUSTY_SCROLL), 1);
});

test("the gate's step over the inviswall gives collision back as soon as the opener is across, not on a timer", (t) => {
  const { p } = player(t, 60, {}, { x: 3484, y: 3244, z: 0 });
  click(p, GATE_R, "Open", { x: 3484, y: 3244, z: 0 });
  assert.ok(p.hasFlag("movement:ignore-clipping"));
  p.setLocation(new core.Location(3484, 3243, 0)); // across (live t445 -> t446)
  tick(1);
  assert.equal(p.hasFlag("movement:ignore-clipping"), false, "collision back on arrival");
});

// ---------------------------------------------------------------------------
// Issue 6415: the citizens' heads, the finds' inventory update, Read, the store ladder
// ---------------------------------------------------------------------------

const NPC_NAME = uid(231, 4), NPC_HEAD = uid(231, 2);

test("the citizens' shared lines show the clicked NPC's own name and head, not the transcript's 'Citizen' (t1166, t9227)", (t) => {
  const { p, seen } = player(t, 60, {}, { x: 3492, y: 3231, z: 0 });
  const heads = [];
  const sender = p.getPacketSender();
  const original = sender.sendNpcHeadOnInterface.bind(sender);
  sender.sendNpcHeadOnInterface = (npcId, uidAt) => { heads.push([npcId, uidAt]); return original(npcId, uidAt); };
  talk(p, core.NpcIdentifiers.RAZVAN, "Talk-to", { x: 3492, y: 3232 });
  proceed(p, seen);
  choose(p, "Are there any 'out of the way' places here?");
  proceed(p, seen, "How do you mean");
  const at = texts(seen, NPC_TEXT).indexOf("How do you mean, 'out of the way'?");
  assert.ok(at >= 0, "Razvan's shared line was shown");
  assert.ok(!texts(seen, NPC_NAME).includes("Citizen"), "no line is labelled Citizen");
  assert.equal(texts(seen, NPC_NAME).at(-1), "Razvan");
  assert.deepEqual(heads.at(-1), [core.NpcIdentifiers.RAZVAN, NPC_HEAD]);
});

test("ItemContainer.add with no refresh flag sends the inventory at once (the finds showed up seconds late)", (t) => {
  const { p } = player(t, 60);
  const sent = [];
  const sender = p.getPacketSender();
  const original = sender.sendItemContainer.bind(sender);
  sender.sendItemContainer = (container, ...rest) => { sent.push(container); return original(container, ...rest); };
  p.getInventory().add(new core.Item(I.PLASTER_FRAGMENT, 1));
  assert.equal(sent.length, 1, "refreshed by the add itself");
  p.getInventory().add(new core.Item(I.DUSTY_SCROLL, 1), false);
  assert.equal(sent.length, 1, "an explicit false still batches");
});

test("the plaster at scoop 5 with room: in the inventory and on the client on its objectbox's tick (t921)", (t) => {
  const { p, seen } = cellar(t, 4, { [V.MESSAGE]: 1 });
  p.getInventory().add(new core.Item(I.RUNE_PICKAXE, 1));
  p.getInventory().add(new core.Item(I.SPADE, 1));
  p.getInventory().add(new core.Item(I.BUCKET, 1));
  const sent = [];
  const sender = p.getPacketSender();
  const original = sender.sendItemContainer.bind(sender);
  sender.sendItemContainer = (container, ...rest) => {
    sent.push(container.getItems().some((item) => item?.getId() === I.PLASTER_FRAGMENT));
    return original(container, ...rest);
  };
  mineAndScoop(p, sceneLocs(p)[0]);
  assert.equal(lastText(seen, OBJBOX), "You find a piece of plaster with some interesting inscriptions on it.");
  assert.equal(p.getInventory().getAmount(I.PLASTER_FRAGMENT), 1);
  assert.equal(sent.at(-1), true, "the last inventory sent holds the plaster");
});

test("Read on the plaster fragment: its six objectboxes with the plaster's model (t2757-2775)", (t) => {
  const { p, seen } = player(t, 110);
  p.getInventory().add(new core.Item(I.PLASTER_FRAGMENT, 1));
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === I.PLASTER_FRAGMENT);
  const item = p.getInventory().getItems()[slot];
  const event = { player: p, item, itemId: I.PLASTER_FRAGMENT, slot, clickType: 1, option: "Read", handled: false };
  PM.emitItemAction(event);
  assert.equal(event.handled, true);
  const boxes = [];
  for (let i = 0; i < 6; i++) {
    boxes.push(lastText(seen, OBJBOX));
    assert.equal(seen.items.at(-1), I.PLASTER_FRAGMENT);
    advance(p);
  }
  assert.equal(boxes[0], "The plaster has a small map of Morytania carved into it. The map depicts seven figures near the Salve, where Paterdomus now stands.");
  assert.equal(boxes[5], "This is clearly an artist's impression of some moment in Morytania's history.");
  assert.equal(new Set(boxes).size, 6);
  assert.equal(p.getInventory().getAmount(I.PLASTER_FRAGMENT), 1, "reading keeps it");
});

test("Read on the dusty scroll: the long scroll (625) with Sialathin's letter (t2778)", (t) => {
  const { p } = player(t, 110);
  const opened = [], scripts = [];
  const sender = p.getPacketSender();
  const sendInterface = sender.sendInterface.bind(sender);
  sender.sendInterface = (id, ...rest) => { opened.push(id); return sendInterface(id, ...rest); };
  const sendClientScript = sender.sendClientScript.bind(sender);
  sender.sendClientScript = (id, ...args) => { scripts.push([id, ...args]); return sendClientScript(id, ...args); };
  p.getInventory().add(new core.Item(I.DUSTY_SCROLL, 1));
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === I.DUSTY_SCROLL);
  const event = { player: p, item: p.getInventory().getItems()[slot], itemId: I.DUSTY_SCROLL, slot, clickType: 1, option: "Read", handled: false };
  PM.emitItemAction(event);
  assert.equal(event.handled, true);
  assert.ok(opened.includes(625), "the long scroll");
  const setup = scripts.find(([id]) => id === 418);
  assert.ok(setup, "longscroll_setup");
  assert.equal(setup[1], "");
  assert.ok(setup[2].startsWith("My dearest Lantania,<br><br>I know not what these dark hours bring"));
  assert.ok(setup[2].endsWith("Yours, most faithfully,<br>Sialathin"));
});

test("the general store's ladder goes between the floor and the roof on plane 2, both ways (t1309-1316, t1327-1331)", (t) => {
  const { p, seen } = player(t, 140, {}, { x: 3513, y: 3237, z: 0 });
  click(p, 12780, "Climb-up", { x: 3513, y: 3238, z: 0 });
  tick(4);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3513, 3239, 2]);
  assert.ok(seen.anims.includes(828));
  click(p, 12781, "Climb-down", { x: 3513, y: 3238, z: 2 });
  tick(4);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3513, 3237, 0]);
  assert.ok(seen.anims.includes(827));
});
