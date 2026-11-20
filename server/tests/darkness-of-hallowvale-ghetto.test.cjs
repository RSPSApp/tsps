// Run after `yarn build`: node --test tests/darkness-of-hallowvale-ghetto.test.cjs
//
// Darkness of Hallowvale, the Ghetto unit (stages 50-80 and the hideout entry), against the live capture
// (revision 242): the floorboards (t544-562), the rubble (t572-584), the citizens' 52/54/60 (t596-777),
// Old Man Ral's 65 (t1158), the rooftop route's jumps, push walls, table tunnel, pots, locked door and
// ladder top (t1213-2635), and the hideout's latch, wall, symbol, rug, trapdoor and ladder (t2712-2758,
// t7298-7315). Real plugins, a real Player; clicks go through PluginManager.
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
const { impliedVarbits } = require("../plugins/quests/hallowvale/State.DarknessOfHallowvale");

const STAGE = "quest.darkness_of_hallowvale.stage";
const VARS = "darkness-of-hallowvale:varbits";
const SAVE_VERSION = "darkness-of-hallowvale:save-version";
const uid = (group, child) => (group << 16) | child;
const MESBOX = uid(229, 3), OBJBOX = uid(193, 2), NPC_TEXT = uid(231, 6), PLAYER_TEXT = uid(217, 6);
let core, index = 9300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, stage, at, vars = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {}, flush() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(`dohghetto${index}`);
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], at[2]));
  p.needsPlacement = false;
  p.setAttribute(SAVE_VERSION, 1);
  p.setAttribute(VARS, { ...impliedVarbits(stage), ...vars });
  p.setAttribute(STAGE, stage);
  p.getSkillManager().setLevel(core.Skill.AGILITY, 73);
  p.getSkillManager().setLevel(core.Skill.THIEVING, 60);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  const seen = { strings: [], sounds: [], anims: [], messages: [], varbits: [], locAnims: [] };
  const sender = p.getPacketSender();
  const spy = (method, record) => {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  };
  spy("sendString", (text, id) => seen.strings.push([id, String(text)]));
  spy("sendSoundEffect", (id, loops, delay) => seen.sounds.push([id, delay]));
  spy("sendVarbit", (id, value) => seen.varbits.push([id, value]));
  spy("sendObjectAnimation", (object, animation) => seen.locAnims.push(animation?.getId?.()));
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

const stageOf = (p) => p.getAttribute(STAGE);
const varbit = (p, id) => Number(p.getAttribute(VARS)?.[id]) || 0;
const lastVarbit = (seen, id) => seen.varbits.filter(([at]) => at === id).map(([, value]) => value).at(-1);
const texts = (seen, id) => seen.strings.filter(([at]) => at === id).map(([, text]) => text.replace(/<br>/g, " "));
const tick = (n = 1) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const menu = (p) => core.MultiChatboxPrompt.getPending(p);
const where = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];
const xp = (p) => p.getSkillManager().getExperience(core.Skill.AGILITY);

function choose(p, text) {
  const pending = menu(p);
  assert.ok(pending, `a menu is open for "${text}"`);
  const at = pending.options.indexOf(text);
  assert.ok(at >= 0, `"${text}" in [${pending.options.join(" | ")}]`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: at + 1 });
}

/** Continues boxes until a menu opens, a line starting `until` shows, or the conversation ends. */
function proceed(p, seen, until = null, limit = 80) {
  for (let i = 0; i < limit; i++) {
    if (menu(p)) return;
    if (until && [...texts(seen, NPC_TEXT), ...texts(seen, PLAYER_TEXT)].some((text) => text.startsWith(until))) return;
    const manager = p.getDialogueManager();
    if (!manager.getCurrent()) { tick(); if (!manager.getCurrent() && !menu(p)) return; continue; }
    manager.advance();
  }
}

function fakeObject(id, at, face = 0, type = 10) {
  return { getId: () => id, getLocation: () => new core.Location(at[0], at[1], at[2]), getPrivateArea: () => null, getType: () => type,
    getFace: () => face, getDefinition: () => ObjectDefinition.forId(id) };
}

function click(p, id, option, at, face = 0, type = 10) {
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((op) => op === option) + 1;
  assert.ok(clickType > 0, `${definition.getName()} (${id}) has ${option}`);
  const event = { player: p, object: fakeObject(id, at, face, type), objectId: id, definition, clickType, option,
    location: { x: at[0], y: at[1], z: at[2] }, sourceLocation: { x: p.getLocation().getX(), y: p.getLocation().getY(), z: p.getLocation().getZ() }, handled: false };
  return PM.emitObjectInteraction(event);
}

function useOn(p, itemId, id, at, face = 0) {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  return PM.emitItemOnObject({ player: p, object: fakeObject(id, at, face, 0), definition: ObjectDefinition.forPlayer(id, p) ?? undefined, objectId: id,
    item: p.getInventory().getItems()[slot], itemId, itemSlot: slot, interfaceType: 0, location: { x: at[0], y: at[1], z: at[2] }, handled: false });
}

function talk(p, npcId, at) {
  const npc = core.NPC.create(npcId, new core.Location(at[0], at[1], at[2]));
  const definition = npc.getCurrentDefinition?.(p) ?? npc.getDefinition();
  const clickType = definition.getActions().findIndex((op) => op === "Talk-to") + 1;
  const event = { player: p, npc, npcId: npc.getId(), definition, clickType, action: "Talk-to", handled: false };
  PM.emitNpcInteraction(event);
  return event;
}

// ---------------------------------------------------------------------------
// Arrival (50)
// ---------------------------------------------------------------------------

test("floorboards: the box, Kick them?, the stamp, 2589 = 1 two ticks on with the message; stage stays 50; Climb-down", (t) => {
  const { p, seen } = player(t, 50, [3590, 3173, 1]);
  assert.ok(click(p, 18122, "Search", [3589, 3173, 1]));
  assert.equal(texts(seen, MESBOX).at(-1), "These floorboards look a little weak near to the wall.");
  p.getDialogueManager().advance();
  choose(p, "Yes.");
  assert.ok(seen.anims.includes(4750));
  assert.ok(seen.sounds.some(([id]) => id === 1716));
  tick();
  assert.equal(varbit(p, 2589), 0);
  tick();
  assert.equal(varbit(p, 2589), 1, "t559");
  assert.ok(seen.messages.includes("You kick the floorboards; they crack and eventually fall down."));
  assert.equal(stageOf(p), 50);
  assert.ok(click(p, 18122, "Climb-down", [3589, 3173, 1]));
  tick(3);
  assert.ok(seen.anims.includes(827));
  assert.deepEqual(where(p), [3588, 3173, 0], "t562");
});

test("the breached wall: 4723 onto plane 1, 4724 six ticks on, plane 0 six later (t572-584)", (t) => {
  const { p, seen } = player(t, 50, [3588, 3180, 0]);
  assert.ok(click(p, 18037, "Climb-over", [3589, 3180, 0]));
  tick();
  assert.ok(seen.anims.includes(4723));
  assert.deepEqual(where(p), [3590, 3180, 1]);
  tick(6);
  assert.ok(seen.anims.includes(4724));
  assert.deepEqual(where(p), [3592, 3180, 1]);
  tick(6);
  assert.deepEqual(where(p), [3592, 3180, 0]);
});

// ---------------------------------------------------------------------------
// The citizens (52, 54, 60) and Old Man Ral (65)
// ---------------------------------------------------------------------------

test("a citizen: 52 past the whisper's answer, 54 with Old Man Ral's name, 60 on asking for an introduction, menus in place", (t) => {
  const { p, seen } = player(t, 50, [3593, 3186, 0]);
  const event = talk(p, 3790, [3593, 3187, 0]);
  assert.equal(event.handled, true);
  proceed(p, seen);
  assert.deepEqual(menu(p).options, ["What do you do here?", "I'm lost... Can you help me?", "Do you know about the Myreque?",
    "(whisper) Do you know about the Myreque?", "- More questions -"]);
  choose(p, "(whisper) Do you know about the Myreque?");
  proceed(p, seen, "Yes... but I really can't talk about them.");
  assert.equal(stageOf(p), 50, "not before the continue");
  proceed(p, seen);
  assert.equal(stageOf(p), 52, "t603");
  assert.deepEqual(menu(p).options, ["I'm lost... Can you help me?", "What do you do here?", "Do you know of the Myreque?",
    "(whisper) I really need to meet the Myreque.", "- More questions -"]);
  choose(p, "(whisper) I really need to meet the Myreque.");
  proceed(p, seen, "I understand, but you may not like what you find.");
  assert.equal(stageOf(p), 54, "t736");
  proceed(p, seen);
  assert.deepEqual(menu(p).options, ["What do you do here?", "I'm lost... Can you help me?", "Can you introduce me to Old Man Ral?",
    "How can Old Man Ral help me?", "- More questions -"]);
  choose(p, "Can you introduce me to Old Man Ral?");
  assert.equal(stageOf(p), 60, "t773: on the choice");
  proceed(p, seen);
  assert.ok(texts(seen, PLAYER_TEXT).includes("Can you introduce me to Old Man Ral?"));
  assert.deepEqual(menu(p).options, ["What do you do here?", "I'm lost... Can you help me?", "Do you know about the Myreque?",
    "- More questions -"], "t777: the standard menu");
});

test("Old Man Ral: no 'Someone said' before 60; the sage chain sets 65 with his route line (t1158)", (t) => {
  const early = player(t, 54, [3607, 3208, 0]);
  talk(early.p, 3772, [3607, 3209, 0]);
  proceed(early.p, early.seen);
  assert.ok(!menu(early.p).options.includes("Someone said you could help me."));

  const { p, seen } = player(t, 60, [3607, 3208, 0]);
  talk(p, 3772, [3607, 3209, 0]);
  proceed(p, seen);
  choose(p, "Someone said you could help me.");
  proceed(p, seen);
  choose(p, "Old Man Ral, the sage of Sanguinesti.");
  proceed(p, seen, "Well, hopefully they hid themselves.");
  assert.equal(stageOf(p), 60);
  proceed(p, seen, "Hmph. Myreque, eh?");
  assert.equal(stageOf(p), 65);

  const later = player(t, 65, [3607, 3208, 0]);
  talk(later.p, 3772, [3607, 3209, 0]);
  proceed(later.p, later.seen);
  assert.ok(texts(later.seen, PLAYER_TEXT).includes("Hello again!"), "t1181");
});

// ---------------------------------------------------------------------------
// The rooftop route (65)
// ---------------------------------------------------------------------------

test("before Ral's directions an obstacle refuses with the Wiki's box", (t) => {
  const { p, seen } = player(t, 60, [3598, 3203, 1]);
  assert.ok(click(p, 18070, "Jump-to", [3598, 3201, 1], 0, 22));
  assert.ok(texts(seen, MESBOX).at(-1).startsWith("You're pretty sure you'll get lost"));
  assert.deepEqual(where(p), [3598, 3203, 1]);
});

test("a ghetto ladder lands on the far side of its rotation (t1217)", (t) => {
  const { p, seen } = player(t, 65, [3595, 3203, 0]);
  assert.ok(click(p, 17974, "Climb-up", [3595, 3204, 0], 0));
  tick(3);
  assert.ok(seen.anims.includes(828));
  assert.deepEqual(where(p), [3595, 3205, 1]);
});

test("jumps: from the take-off tile only (t1224), the exactmove and the xp two ticks on (t1229-1231)", (t) => {
  const { p, seen } = player(t, 65, [3598, 3203, 1]);
  assert.ok(click(p, 18071, "Jump-to", [3598, 3203, 1], 3, 22));
  assert.ok(seen.messages.includes("You can't jump from here; you need to get closer to jump there."));
  const before = xp(p);
  assert.ok(click(p, 18070, "Jump-to", [3598, 3201, 1], 0, 22));
  tick();
  assert.deepEqual(where(p), [3598, 3201, 1]);
  assert.ok(seen.anims.includes(769));
  tick(3);
  assert.equal(xp(p) - before, 5, "5 Agility xp");
});

test("the push wall's base id 18128: human_push, 2599 1 with the wall's fall, then 2 (t1250-1252)", (t) => {
  const { p, seen } = player(t, 65, [3605, 3203, 1]);
  assert.equal(varbit(p, 2599), 0);
  p.setAttribute(VARS, { ...p.getAttribute(VARS), 2599: 0 });
  delete p.getAttribute(VARS)[2599];
  assert.ok(click(p, 18128, "Push", [3605, 3204, 1], 1));
  assert.ok(seen.anims.includes(810));
  assert.equal(lastVarbit(seen, 2599), undefined, "nothing on the push's own tick");
  tick();
  assert.equal(lastVarbit(seen, 2599), 1, "a tick on");
  assert.ok(seen.locAnims.includes(4744));
  tick();
  assert.equal(varbit(p, 2599), 2, "a tick later");
  assert.equal(ObjectDefinition.forPlayer(18129, p)?.getName(), "Floor", "the floor across is shown");
});

test("the table: Search (2597 = 1), Open (2), and the tunnel's three legs with the xp (t1289-1314)", (t) => {
  const { p, seen } = player(t, 65, [3598, 3215, 0]);
  const vars = { ...p.getAttribute(VARS) }; delete vars[2597]; p.setAttribute(VARS, vars);
  assert.ok(click(p, 18083, "Search", [3598, 3216, 0]));
  tick(3);
  assert.equal(varbit(p, 2597), 1);
  assert.ok(seen.messages.includes("You search the table and find there is a trapdoor underneath."));
  assert.ok(click(p, 18083, "Open", [3598, 3216, 0]));
  tick(3);
  assert.equal(varbit(p, 2597), 2);
  assert.ok(seen.sounds.some(([id]) => id === 91));
  const before = xp(p);
  assert.ok(click(p, 18083, "Climb-into", [3598, 3216, 0]));
  tick(11);
  assert.deepEqual(where(p), [3598, 3220, 0]);
  assert.ok([2589, 2590, 2591].every((id) => seen.anims.includes(id)));
  assert.equal(xp(p) - before, 5);
});

test("the pots give the key; the locked door takes it in one click and swings open on the continue (t2429-2437)", (t) => {
  const { p, seen } = player(t, 65, [3607, 3222, 0]);
  const vars = { ...p.getAttribute(VARS) }; delete vars[2578]; p.setAttribute(VARS, vars);
  assert.ok(click(p, 18065, "Search", [3608, 3222, 0]));
  assert.ok(seen.messages.includes("You search the pots."));
  tick(2);
  assert.equal(p.getInventory().getAmount(9654), 1);
  assert.equal(texts(seen, OBJBOX).at(-1), "You find a key.");
  p.getDialogueManager().advance();
  p.moveTo(new core.Location(3608, 3221, 0));
  assert.ok(click(p, 18091, "Open", [3608, 3221, 0], 2, 0));
  assert.ok(seen.messages.includes("The door seems to be locked."));
  assert.equal(varbit(p, 2578), 1);
  assert.equal(p.getInventory().getAmount(9654), 0);
  assert.ok(seen.sounds.some(([id]) => id === 2402) && seen.sounds.some(([id]) => id === 2419));
  p.getDialogueManager().advance();
  assert.ok(seen.messages.includes("You swing the door open."));
  assert.ok(seen.sounds.some(([id]) => id === 62));
});

test("the ladder top: the wall (2598 = 1), the broken ladder (2), the mended ladder down (t2619-2635)", (t) => {
  const { p, seen } = player(t, 65, [3625, 3241, 2]);
  const vars = { ...p.getAttribute(VARS) }; delete vars[2598]; p.setAttribute(VARS, vars);
  assert.ok(click(p, 18115, "Search", [3625, 3240, 2], 2, 0));
  assert.equal(varbit(p, 2598), 1);
  assert.equal(p.getInventory().getAmount(9655), 1);
  assert.equal(texts(seen, OBJBOX).at(-1), "You find the topmost part of a ladder.");
  p.getDialogueManager().advance();
  p.moveTo(new core.Location(3629, 3241, 1));
  assert.ok(click(p, 18116, "Search", [3629, 3240, 1], 3));
  tick();
  assert.equal(varbit(p, 2598), 2);
  assert.equal(p.getInventory().getAmount(9655), 0);
  p.getDialogueManager().advance();
  assert.ok(click(p, 18116, "Climb-down", [3629, 3240, 1], 3));
  assert.ok(seen.messages.includes("You climb down the ladder."));
  tick(3);
  assert.deepEqual(where(p), [3630, 3240, 0]);
});

// ---------------------------------------------------------------------------
// The hideout (70, 80, every visit)
// ---------------------------------------------------------------------------

test("the hideout: latch box, knife (70), the wall, the symbol, the rug, the trapdoor (80) and 2590's reset", (t) => {
  const { p, seen } = player(t, 65, [3640, 3253, 0]);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.KNIFE, 1));
  assert.ok(click(p, 17980, "Push", [3640, 3253, 0], 3, 0));
  assert.ok(texts(seen, MESBOX).at(-1).startsWith("You push the wall and nothing happens."));
  p.getPacketSender().sendInterfaceRemoval();
  assert.ok(useOn(p, core.ItemIdentifiers.KNIFE, 17980, [3640, 3253, 0], 3));
  assert.equal(texts(seen, OBJBOX).at(-1), "You prepare to use your knife to unhook the latch.");
  p.getDialogueManager().advance();
  tick(2);
  assert.equal(stageOf(p), 65);
  assert.ok(seen.anims.includes(832));
  tick();
  assert.equal(stageOf(p), 70, "t2729");
  assert.equal(texts(seen, OBJBOX).at(-1), "You use your knife to unhook the latch.");
  p.getDialogueManager().advance();
  assert.ok(click(p, 17980, "Push", [3640, 3253, 0], 3, 0));
  assert.ok(seen.messages.includes("You push the door to one side."));
  p.moveTo(new core.Location(3639, 3251, 0));
  tick(3);
  assert.ok(click(p, 18146, "Press", [3638, 3251, 0], 1, 0));
  tick();
  assert.ok(seen.locAnims.includes(4743));
  tick();
  assert.equal(lastVarbit(seen, 2590), 1);
  assert.ok(seen.messages.includes("You push the symbol in... You hear a click."));
  p.moveTo(new core.Location(3639, 3250, 0));
  assert.ok(click(p, 18120, "Open", [3639, 3249, 0], 1, 22));
  tick();
  assert.equal(lastVarbit(seen, 2590), 2);
  assert.ok(seen.messages.includes("You open the secret trapdoor."));
  assert.ok(click(p, 18120, "Climb-down", [3639, 3249, 0], 1, 22));
  assert.ok(seen.messages.includes("You climb down through the trapdoor."));
  tick(4);
  assert.equal(stageOf(p), 80, "t2748");
  assert.deepEqual(where(p), [3626, 9618, 0]);
  assert.equal(lastVarbit(seen, 2590), 1);
  tick(10);
  assert.equal(lastVarbit(seen, 2590), 0, "t2758");
});

test("the hideout ladder: 2590 = 2, the room at 3638,3249,0 four ticks on, 2590 back to 0 (t7298-7315)", (t) => {
  const { p, seen } = player(t, 250, [3626, 9618, 0]);
  assert.ok(click(p, 17986, "Climb-up", [3626, 9617, 0], 3));
  assert.equal(lastVarbit(seen, 2590), 2);
  tick(5);
  assert.deepEqual(where(p), [3638, 3249, 0]);
  assert.ok(seen.messages.includes("You climb up the ladder."));
  tick(3);
  assert.equal(lastVarbit(seen, 2590), 1);
  tick(10);
  assert.equal(lastVarbit(seen, 2590), 0);
  assert.equal(stageOf(p), 250);
});
