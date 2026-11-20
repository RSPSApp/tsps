// Run after `yarn build`: node --test tests/zogre-flesh-eaters-capture.test.cjs
//
// Zogre Flesh Eaters against a whole run of the quest on live: the user's RSProx capture
// ZogreFleshEaters.bin (revision 242.1; docs/quests/zogre-flesh-eaters/README.md). Real Player,
// PlayerSession and ClientConnection, the real plugins, cache and map: talks and clicks are packets
// and each tick runs as World.process does. Ticks in the test names are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "zogre_flesh_eaters";
const S = { STARTED: 2, BARRICADE: 3, SITHIK: 4, POTION: 6, PERMANENT_SPELL: 8, GIVEN_KEY: 10, KILLED: 12, COMPLETE: 14 };
const V = { PRISM_SEARCH: 488, TRANSFORMED: 495, BARRICADE: 496, SKELETON: 503, PRISM_SOLD: 504, CUT_SCENE: 505, SOLD_BALM: 502 };
const SEARCH = "quest.zogre_flesh_eaters.search";
const SKELETON = "quest.zogre_flesh_eaters.skeleton";
const MESBOX = 229;
const OBJECTBOX = 193;
const OBJECTBOX_DOUBLE = 11;
const DONE = ["jungle_potion", "big_chompy_bird_hunting"];

let I;
let N;
let Sk;
before(async () => {
  h.key = KEY;
  await h.setup([[2456, 3048], [2442, 9458], [2441, 9430], [2478, 9445], [2587, 3087], [2593, 3103]]);
  I = h.core.ItemIdentifiers;
  N = h.core.NpcIdentifiers;
  Sk = h.core.Skill;
});
after(() => h.teardown());

const stage = (f) => h.quest().getStage(f.player);
const varbit = (f, id) => f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === id).map((c) => c.args[1]).at(-1);
const group = (f) => f.player.getPacketSender().getChatboxGroupId();
const messages = (f) => f.messages.map((m) => String(m.text));
const count = (f, id) => f.player.getInventory().getAmount(id);
const at = (f) => { const l = f.player.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
const npcAt = (id, [x, y, z]) => h.core.World.getNpcs().toArray?.().find((n) => n && n.getId() === id && n.getLocation().getX() === x && n.getLocation().getY() === y && n.getLocation().getZ() === z)
  ?? [...h.core.World.getNpcs()].find((n) => n && n.getId() === id && n.getLocation().getX() === x && n.getLocation().getY() === y && n.getLocation().getZ() === z);

function actor(t, { at: tile, stage: value = 0, items = [], attributes = {}, done = DONE } = {}) {
  const f = h.actor(t, { at: tile, stage: value, done, attributes });
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  f.calls.length = 0;
  f.messages.length = 0;
  return f;
}

async function until(f, text, limit = 80) {
  for (let i = 0; i < limit; i++) {
    const line = h.shown(f);
    if (line?.text?.startsWith(text) || (line?.who === "menu" && line.text.includes(text))) return f.tick;
    if (line && line.who !== "menu") await h.continueLine(f);
    else h.tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

async function useOnNpc(f, npc, itemId) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  await f.connection.dispatch([{ type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot, widgetId: 149 << 16 }]);
  for (let i = 0; i < 20 && !h.shown(f); i++) h.tick(f);
}

async function useOnObject(f, objectId, [x, y], itemId) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  await f.connection.dispatch([{ type: "item_on_object", itemId, slot, widgetId: 149 << 16, objectId, x, y }]);
  for (let i = 0; i < 20 && !h.shown(f); i++) h.tick(f);
}

// ------------------------------------------------------------------ Requirements (issue 4410)

test("the start needs the Wiki's levels only: no Fletching, a drained Herblore still counts, Ranged is its base level", async (t) => {
  const grishTile = [2442, 3054, 0];
  const route = ["What do you mean sickies?", "Can I help in any way?"];
  const set = (f, skill, base, current = base) => {
    f.player.getSkillManager().setMaxLevels(skill, base);
    f.player.getSkillManager().setCurrentLevel(skill, current, false);
  };
  const reachesHelp = async (f) => {
    const grish = h.spawn(f, N.GRISH, grishTile);
    const lines = await h.converse(f, () => h.talk(f, grish), route);
    return lines.some((line) => line.includes("Yes creatures...yous does good fings for Grish"));
  };

  const ok = actor(t, { at: [2442, 3053, 0] });
  set(ok, Sk.FLETCHING, 1);
  set(ok, Sk.RANGED, 30);
  set(ok, Sk.SMITHING, 4);
  set(ok, Sk.HERBLORE, 8, 3);
  assert.equal(await reachesHelp(ok), true, "1 Fletching and a drained Herblore 8 still start it");

  const low = actor(t, { at: [2442, 3053, 0] });
  set(low, Sk.RANGED, 29, 35);
  set(low, Sk.SMITHING, 4);
  set(low, Sk.HERBLORE, 8);
  assert.equal(await reachesHelp(low), false, "a boosted Ranged 29 does not (not boostable on the Wiki)");

  const noQuest = actor(t, { at: [2442, 3053, 0], done: ["jungle_potion"] });
  set(noQuest, Sk.RANGED, 30);
  assert.equal(await reachesHelp(noQuest), false, "Big Chompy Bird Hunting is needed");
});

test("the start hands out the food and potions in a two-item box as the stage moves to 2 (tick 260)", async (t) => {
  const f = actor(t, { at: [2442, 3053, 0] });
  for (const [skill, level] of [[Sk.RANGED, 30], [Sk.SMITHING, 4], [Sk.HERBLORE, 8]]) {
    f.player.getSkillManager().setMaxLevels(skill, level);
    f.player.getSkillManager().setCurrentLevel(skill, level, false);
  }
  const grish = h.spawn(f, N.GRISH, [2442, 3054, 0]);
  await h.talk(f, grish);
  await until(f, "I'm just looking around thanks.");
  await h.choose(f, "What are Zogres?");
  await until(f, "Da Zogres are da bigun nasties");
  await h.continueLine(f);
  assert.equal(h.shown(f)?.text, "Dem zogries commin from da under dirt and us is lost for da Jiggie jig place.", "Grish's second line (tick 122)");
  await until(f, "I'm just looking around thanks.");
  await h.choose(f, "What do you mean sickies?");
  await until(f, "Can I help in any way?");
  await h.choose(f, "Can I help in any way?");
  await until(f, "Hmm, sorry, it sounds a bit too dangerous.");
  await h.choose(f, "Ok, I'll check things out then and report back.");
  await until(f, "Yes, I'm really sure!");
  await h.choose(f, "Yes, I'm really sure!");
  await until(f, "Grish hands you some food and two potions.");
  assert.equal(stage(f), S.STARTED);
  assert.equal(group(f), OBJECTBOX_DOUBLE, "objectbox_double with the chompy and the potion");
  assert.equal(count(f, I.COOKED_CHOMPY), 3);
  assert.equal(count(f, I.SUPER_RESTORE_3_), 2);
});

// ------------------------------------------------------------------ The barricade

test("before the quest the barricade guard says only his warning (tick 101)", async (t) => {
  const f = actor(t, { at: [2453, 3047, 0] });
  const guard = h.spawn(f, N.OGRE_GUARD, [2454, 3047, 0]);
  const lines = await h.converse(f, () => h.talk(f, guard));
  assert.deepEqual(lines, ["Ogre guard: Yous needs ta stay away from dis place...yous get da sickies and mebe yous goes to dead if yous da unlucky fing."]);
});

test("the coffin guard (865) has his own menu, not the barricade guard's quest talk (ticks 59-79)", async (t) => {
  const f = actor(t, { at: [2442, 3036, 0], stage: S.STARTED });
  const guard = h.spawn(f, N.OGRE_GUARD_2, [2443, 3036, 0]);
  await h.talk(f, guard);
  assert.equal(h.shown(f)?.text, "Yeah, whats yous wants creatures?");
});

test("the guard kicks the barricade down 2 ticks after his line, 496 a tick later, his last line 2 after that (ticks 296-301)", async (t) => {
  const f = actor(t, { at: [2453, 3047, 0], stage: S.STARTED });
  const guard = h.spawn(f, N.OGRE_GUARD, [2454, 3047, 0]);
  const kicks = [];
  const animate = guard.performAnimation.bind(guard);
  guard.performAnimation = (animation) => { kicks.push({ tick: f.tick, id: animation.getId() }); return animate(animation); };
  await h.talk(f, guard);
  await until(f, "Ok, I opens da stoppa's for yous creature.");
  await h.continueLine(f);
  const closed = f.tick;
  assert.equal(group(f), -1, "the chat closes for the kick");
  const last = await until(f, "Ok der' yous goes!");
  const kick = kicks.find((k) => k.id === 2102);
  assert.ok(kick, "ogre_kick (2102)");
  assert.equal(kick.tick - closed, 2, "two ticks after the chat closes");
  const crushed = f.calls.find((c) => c.name === "sendVarbit" && c.args[0] === V.BARRICADE && c.args[1] === 1);
  assert.ok(crushed, "thzfe_blocking_barricade 496 = 1");
  assert.equal(crushed.tick - kick.tick, 1, "a tick after the kick");
  assert.equal(last - crushed.tick, 2, "his line two ticks later");
  assert.equal(stage(f), S.BARRICADE);
  assert.ok(h.core.MapObjects.get(6878, new h.core.Location(2456, 3048, 0), null), "the map's multiloc stays: the crush is the player's own view");
});

test("Climb-over hops the crushed barricade with seq 1236 and back (ticks 310-326)", async (t) => {
  const f = actor(t, { at: [2455, 3048, 0], stage: S.BARRICADE });
  h.tick(f);
  assert.equal(h.core.ObjectDefinition.forPlayer(6878, f.player)?.getName(), "Crushed barricade", "496 = 1 shows the crushed side");
  await h.dispatch(f, { type: "object_option", id: 6878, x: 2456, y: 3048, clickType: 1 });
  h.ticks(f, 4);
  assert.deepEqual(at(f), [2457, 3048, 0]);
  assert.ok(f.animations.some((a) => a.id === 1236), "regicide_stepover");
  await h.dispatch(f, { type: "object_option", id: 6878, x: 2456, y: 3048, clickType: 1 });
  h.ticks(f, 4);
  assert.deepEqual(at(f), [2455, 3048, 0]);
});

test("the stairs: the line, sound and fade on arrival, the move 3 ticks on, the fade back 4 after (ticks 376-385)", async (t) => {
  const f = actor(t, { at: [2485, 3045, 0], stage: S.BARRICADE });
  await h.dispatch(f, { type: "object_option", id: 6841, x: 2485, y: 3042, clickType: 1 });
  for (let i = 0; i < 10 && !messages(f).includes("You climb down the steps."); i++) h.tick(f);
  const line = f.messages.find((m) => m.text === "You climb down the steps.").tick;
  for (let i = 0; i < 10 && at(f)[2] !== 2; i++) h.tick(f);
  assert.deepEqual(at(f), [2477, 9437, 2], "the captured landing tile");
  assert.equal(f.tick - line, 3, "three ticks after the line");
  assert.ok(f.calls.some((c) => c.name === "sendSoundEffect" && c.args[0] === 1952), "down_stone_stairs");
});

test("the north-west room plays its scene once: the chat line, the box held 17 ticks with the camera, reset on Continue (ticks 417-436)", async (t) => {
  const f = actor(t, { at: [2449, 9462, 2], stage: S.BARRICADE });
  const camera = [];
  const sender = f.player.getPacketSender();
  const move = sender.sendCameraMoveTo.bind(sender);
  sender.sendCameraMoveTo = (x, y, ...rest) => { camera.push({ tick: f.tick, x, y }); return move(x, y, ...rest); };
  let reset = null;
  const resetCamera = sender.sendCameraReset.bind(sender);
  sender.sendCameraReset = () => { reset = f.tick; return resetCamera(); };
  f.player.moveTo(new h.core.Location(2447, 9462, 2));
  for (let i = 0; i < 5 && group(f) !== MESBOX; i++) h.tick(f);
  assert.equal(varbit(f, V.CUT_SCENE), 1, "thzfe_cut_scene 505");
  assert.ok(messages(f).includes("You enter this blackened, charred area - it looks there's been an explosion!"), "the chat line (Wiki wording)");
  assert.equal(group(f), MESBOX);
  const start = camera[0].tick;
  h.ticks(f, 18);
  assert.deepEqual(camera.map((c) => c.tick - start), [0, 3, 6, 8, 10, 12, 14, 16]);
  assert.deepEqual([camera[0].x, camera[0].y], [2445, 9460]);
  await h.continueLine(f);
  assert.ok(reset !== null, "the camera comes back on Continue");
  f.player.moveTo(new h.core.Location(2450, 9462, 2));
  h.tick(f);
  camera.length = 0;
  f.player.moveTo(new h.core.Location(2447, 9462, 2));
  h.ticks(f, 3);
  assert.equal(camera.length, 0, "only once");
});

test("an interrupted room scene still gives the camera back: Escape, or walking out (review of b965f638a)", async (t) => {
  for (const interrupt of ["escape", "leave"]) {
    const f = actor(t, { at: [2449, 9462, 2], stage: S.BARRICADE });
    const camera = [];
    let resets = 0;
    const sender = f.player.getPacketSender();
    const move = sender.sendCameraMoveTo.bind(sender);
    sender.sendCameraMoveTo = (x, y, ...rest) => { camera.push(f.tick); return move(x, y, ...rest); };
    const resetCamera = sender.sendCameraReset.bind(sender);
    sender.sendCameraReset = () => { resets++; return resetCamera(); };
    f.player.moveTo(new h.core.Location(2447, 9462, 2));
    for (let i = 0; i < 5 && group(f) !== MESBOX; i++) h.tick(f);
    h.ticks(f, 4);
    assert.ok(camera.length >= 2, `${interrupt}: the scene's camera started`);
    if (interrupt === "escape") await h.dispatch(f, { type: "interface_close" });
    else { f.player.moveTo(new h.core.Location(2450, 9462, 2)); h.tick(f); }
    const after = camera.length;
    h.ticks(f, 16);
    assert.ok(resets >= 1, `${interrupt}: the camera is reset`);
    assert.equal(camera.length, after, `${interrupt}: no camera moves after it`);
  }
});

test("another dialogue replacing the room scene gives the camera back and is left open (review of 4ecfe2890)", async (t) => {
  const f = actor(t, { at: [2449, 9462, 2], stage: S.SITHIK, items: [[I.BLACK_PRISM]] });
  const camera = [];
  let resets = 0;
  const sender = f.player.getPacketSender();
  const move = sender.sendCameraMoveTo.bind(sender);
  sender.sendCameraMoveTo = (x, y, ...rest) => { camera.push(f.tick); return move(x, y, ...rest); };
  const resetCamera = sender.sendCameraReset.bind(sender);
  sender.sendCameraReset = () => { resets++; return resetCamera(); };
  f.player.moveTo(new h.core.Location(2447, 9462, 2));
  for (let i = 0; i < 5 && group(f) !== MESBOX; i++) h.tick(f);
  h.ticks(f, 3);
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === I.BLACK_PRISM);
  await f.connection.dispatch([{ type: "inventory_action", slot, itemId: I.BLACK_PRISM, widgetId: 149 << 16, option: "Look-at" }]);
  h.tick(f);
  assert.equal(group(f), OBJECTBOX, "the prism's box replaced the scene");
  const after = camera.length;
  h.ticks(f, 16);
  assert.ok(resets >= 1, "the camera is reset");
  assert.equal(camera.length, after, "no camera moves behind the prism's box");
  assert.equal(group(f), OBJECTBOX, "the prism's box is left open");
  assert.ok(h.shown(f)?.text.startsWith("It looks like a smokey black gem"), "and not advanced");
});

// ------------------------------------------------------------------ The tomb

test("the skeleton: a smoke puff, the zombie a tick later with its line and 503 = 1; its death 503 = 2 (ticks 442-489)", async (t) => {
  const f = actor(t, { at: [2442, 9460, 2], stage: S.BARRICADE });
  await h.dispatch(f, { type: "object_option", id: 6893, x: 2442, y: 9459, clickType: 1 });
  for (let i = 0; i < 6 && !messages(f).includes("Something screams into life right in front of you."); i++) h.tick(f);
  const puff = f.calls.find((c) => c.name === "sendGraphic" && c.args[0]?.id === 188);
  assert.ok(puff, "smokepuff_large");
  const rises = f.messages.find((m) => m.text === "Something screams into life right in front of you.").tick;
  assert.equal(rises - puff.tick, 1);
  assert.equal(varbit(f, V.SKELETON), 1);
  const zombie = npcAt(N.ZOMBIE_44, [2442, 9458, 2]);
  assert.ok(zombie, "Brentle Vahn's zombie (880) on the tile south of the skeleton");
  t.after(() => h.core.World.getNpcs().remove(zombie));
  h.PM.emitNpcDeath({ npc: zombie, npcId: zombie.getId(), killer: f.player });
  assert.equal(varbit(f, V.SKELETON), 2);
  f.messages.length = 0;
  await h.dispatch(f, { type: "object_option", id: 6893, x: 2442, y: 9459, clickType: 1 });
  h.ticks(f, 3);
  f.player.getInventory().add(new h.core.Item(I.RUINED_BACKPACK, 1), false);
  f.messages.length = 0;
  await h.dispatch(f, { type: "object_option", id: 6893, x: 2442, y: 9459, clickType: 1 });
  h.ticks(f, 3);
  assert.ok(messages(f).includes("You find nothing on the corpse."), "tick 495");
});

test("the coffin lid: the box, two held grunts 3 ticks apart, then the failure (Strength drained) or 488 = 3 (ticks 591-664)", async (t) => {
  const random = Math.random;
  t.after(() => { Math.random = random; });
  const f = actor(t, { at: [2437, 9459, 2], stage: S.BARRICADE, attributes: { [SEARCH]: 2 } });
  f.player.getSkillManager().setMaxLevels(Sk.STRENGTH, 59);
  f.player.getSkillManager().setCurrentLevel(Sk.STRENGTH, 59, false);
  Math.random = () => 0.99;
  await h.dispatch(f, { type: "object_option", id: 6843, x: 2438, y: 9458, clickType: 1 });
  await until(f, "The lid looks heavy");
  assert.equal(group(f), MESBOX);
  const lineTick = (text) => f.calls.find((c) => c.name === "sendString" && c.args[0] === text)?.tick;
  await h.continueLine(f);
  for (let i = 0; i < 12 && !h.shown(f)?.text?.startsWith("You struggle"); i++) h.tick(f);
  const grunt = lineTick("Urrrgggg."), shout = lineTick("Aarrrgghhh!");
  assert.ok(grunt !== undefined && shout !== undefined, "both grunts as chathead lines");
  assert.equal(shout - grunt, 3, "three ticks apart, each with no continue");
  const failed = f.said.find((s) => s.text.startsWith("You struggle, but just get weakened")).tick;
  assert.equal(failed - shout, 3, "the failure box three ticks after the second");
  assert.ok(f.player.getSkillManager().getCurrentLevel(Sk.STRENGTH) < 59, "Strength drained");
  assert.equal(varbit(f, V.PRISM_SEARCH), 2);

  await h.continueLine(f);
  Math.random = () => 0;
  await h.dispatch(f, { type: "object_option", id: 6843, x: 2438, y: 9458, clickType: 1 });
  await until(f, "The lid looks heavy");
  await h.continueLine(f);
  for (let i = 0; i < 12 && varbit(f, V.PRISM_SEARCH) !== 3; i++) h.tick(f);
  const cheer = f.calls.filter((c) => c.name === "sendString" && c.args[0] === "Raarrrggggg! Yes!").at(-1)?.tick;
  assert.ok(cheer !== undefined, "the cheer");
  assert.equal(varbit(f, V.PRISM_SEARCH), 3, "the coffin shows open (6845)");
  for (let i = 0; i < 4 && !h.shown(f)?.text?.startsWith("You eventually"); i++) h.tick(f);
  assert.equal(h.shown(f)?.text, "You eventually manage to lift the lid.");
  assert.equal(f.said.at(-1).tick - cheer, 2, "two ticks after the cheer");
});

test("the coffin's search and knife show as boxes and count 488 at the second box (ticks 545-587)", async (t) => {
  const f = actor(t, { at: [2437, 9459, 2], stage: S.BARRICADE, items: [[I.KNIFE]] });
  await h.dispatch(f, { type: "object_option", id: 6843, x: 2438, y: 9458, clickType: 1 });
  await until(f, "You search the coffin and find a small geometrically shaped hole");
  assert.equal(group(f), MESBOX);
  assert.equal(varbit(f, V.PRISM_SEARCH) ?? 0, 0, "not yet");
  await h.continueLine(f);
  assert.ok(h.shown(f)?.text.startsWith("The lock looks quite crude"));
  assert.equal(varbit(f, V.PRISM_SEARCH), 1, "as the second box shows (tick 547)");
  await h.continueLine(f);
  await useOnObject(f, 6843, [2438, 9458], I.KNIFE);
  await until(f, "With some skill you manage to slide the blade");
  assert.equal(group(f), OBJECTBOX, "the knife's item box");
  assert.equal(varbit(f, V.PRISM_SEARCH), 2);
  assert.ok(f.calls.some((c) => c.name === "sendSoundEffect" && c.args[0] === 2419), "unlock");
});

test("the other coffins' Open shows the locked-lid box (tick 349)", async (t) => {
  const f = actor(t, { at: [2483, 3049, 0], stage: S.BARRICADE });
  await h.dispatch(f, { type: "object_option", id: 6848, x: 2484, y: 3050, clickType: 1 });
  for (let i = 0; i < 10 && !h.shown(f); i++) h.tick(f);
  assert.equal(group(f), MESBOX);
  assert.ok(h.shown(f)?.text.startsWith("The lid to the coffin feels very solid, it won't budge."));
});

test("the stone doors: the key line and the step through as the leaves swing open and shut (ticks 2390-2399)", async (t) => {
  const f = actor(t, { at: [2442, 9434, 2], stage: S.GIVEN_KEY, items: [[I.OGRE_GATE_KEY]] });
  const door = () => h.core.MapObjects.get(6872, new h.core.Location(2442, 9433, 2), null);
  assert.ok(door(), "the closed door");
  await h.dispatch(f, { type: "object_option", id: 6872, x: 2442, y: 9433, clickType: 1 });
  for (let i = 0; i < 6 && !messages(f).includes("You use the Ogre Tomb Key to unlock the door."); i++) h.tick(f);
  assert.ok(messages(f).includes("You use the Ogre Tomb Key to unlock the door."));
  assert.ok(h.core.MapObjects.get(6874, new h.core.Location(2442, 9432, 2), null), "the open leaf a tile south");
  h.ticks(f, 3);
  assert.equal(at(f)[1], 9432, "stepped through");
  assert.ok(door(), "shut again");
  assert.equal(h.core.MapObjects.get(6874, new h.core.Location(2442, 9432, 2), null), null);
  f.messages.length = 0;
  await h.dispatch(f, { type: "object_option", id: 6872, x: 2442, y: 9433, clickType: 1 });
  for (let i = 0; i < 6 && !messages(f).length; i++) h.tick(f);
  assert.ok(messages(f).includes("You push the gates open."), "leaving (tick 2721)");
});

test("without the key the doors stay shut", async (t) => {
  const f = actor(t, { at: [2442, 9434, 2], stage: S.GIVEN_KEY });
  await h.dispatch(f, { type: "object_option", id: 6872, x: 2442, y: 9433, clickType: 1 });
  h.ticks(f, 3);
  assert.ok(messages(f).includes("These gates are locked, you don't seem to be able to open them."));
  assert.equal(at(f)[1] >= 9433, true);
});

test("the stand: the plinth box, Slash Bash a tick after its Continue; his death moves the stage, no artefact handed over (ticks 2437-2650)", async (t) => {
  const f = actor(t, { at: [2482, 9445, 0], stage: S.GIVEN_KEY, items: [[I.OGRE_GATE_KEY]] });
  await h.dispatch(f, { type: "object_option", id: 6897, x: 2483, y: 9445, clickType: 1 });
  await until(f, "You search the plinth...");
  assert.equal(group(f), MESBOX);
  await h.continueLine(f);
  const continued = f.tick;
  for (let i = 0; i < 4 && !messages(f).includes("Something stirs behind you!"); i++) h.tick(f);
  const stirs = f.messages.find((m) => m.text === "Something stirs behind you!").tick;
  assert.equal(stirs - continued, 1, "a tick after the Continue");
  const bash = npcAt(N.SLASH_BASH, [2478, 9445, 0]);
  assert.ok(bash, "Slash Bash on the captured tile");
  t.after(() => h.core.World.getNpcs().remove(bash));
  h.PM.emitNpcDeath({ npc: bash, npcId: bash.getId(), killer: f.player });
  assert.equal(stage(f), S.KILLED);
  assert.equal(count(f, I.OGRE_ARTEFACT), 0, "his drop table leaves the artefact");
});

test("the stand gives no second artefact while Slash Bash's drop still lies there or one is banked", async (t) => {
  const f = actor(t, { at: [2482, 9445, 0], stage: S.KILLED });
  const dropped = h.core.ItemOnGroundManager.registerLocation(f.player, new h.core.Item(I.OGRE_ARTEFACT, 1), new h.core.Location(2480, 9445, 0));
  t.after(() => h.core.ItemOnGroundManager.deregister(dropped));
  await h.dispatch(f, { type: "object_option", id: 6897, x: 2483, y: 9445, clickType: 1 });
  await until(f, "You search the plinth...");
  await h.continueLine(f);
  h.ticks(f, 2);
  assert.equal(count(f, I.OGRE_ARTEFACT), 0, "the floor's artefact counts");
  assert.ok(messages(f).includes("You find nothing in particular."));
  h.core.ItemOnGroundManager.deregister(dropped);
  f.player.getBank(0).add(new h.core.Item(I.OGRE_ARTEFACT, 1), false);
  f.messages.length = 0;
  await h.dispatch(f, { type: "object_option", id: 6897, x: 2483, y: 9445, clickType: 1 });
  await until(f, "You search the plinth...");
  await h.continueLine(f);
  h.ticks(f, 2);
  assert.equal(count(f, I.OGRE_ARTEFACT), 0, "a banked one counts");
});

// ------------------------------------------------------------------ Yanille and Jiggig

test("Zavistic buys the black prism for 2000 once Sithik has had the potion (ticks 1750-1760)", async (t) => {
  const f = actor(t, { at: [2586, 3087, 0], stage: S.PERMANENT_SPELL, items: [[I.BLACK_PRISM]] });
  const zavistic = h.spawn(f, N.ZAVISTIC_RARVE, [2587, 3087, 0]);
  await useOnNpc(f, zavistic, I.BLACK_PRISM);
  assert.equal(h.shown(f)?.text, "You show the black prism to Zavistic.");
  assert.equal(group(f), OBJECTBOX);
  await until(f, "Sell it to Zavistic for 2000");
  await h.choose(f, "Sell it to Zavistic for 2000");
  await until(f, "You sell the black prism for 2000 coins.");
  assert.equal(group(f), OBJECTBOX_DOUBLE);
  assert.equal(count(f, I.BLACK_PRISM), 0);
  assert.equal(count(f, I.COINS), 2000);
  assert.equal(varbit(f, V.PRISM_SOLD), 1);
});

test("Uglug Nar turns a balm down before the cure is known and buys the used dose after (ticks 765-771, 3190-3196)", async (t) => {
  const early = actor(t, { at: [2442, 3049, 0], stage: S.BARRICADE, items: [[I.RELICYMS_BALM_2_]] });
  const uglug = h.spawn(early, N.UGLUG_NAR, [2442, 3048, 0]);
  const lines = await h.converse(early, () => useOnNpc(early, uglug, I.RELICYMS_BALM_2_));
  assert.ok(lines.some((line) => line.includes("Mee's not taking da risky wiv dis un")));
  assert.equal(count(early, I.RELICYMS_BALM_2_), 1, "kept");
  assert.equal(count(early, I.COINS), 0);

  const late = actor(t, { at: [2442, 3049, 0], stage: S.COMPLETE, items: [[I.RELICYMS_BALM_3_], [I.RELICYMS_BALM_2_]] });
  const uglug2 = h.spawn(late, N.UGLUG_NAR, [2442, 3048, 0]);
  await h.converse(late, () => useOnNpc(late, uglug2, I.RELICYMS_BALM_2_));
  assert.equal(count(late, I.RELICYMS_BALM_2_), 0, "the dose used");
  assert.equal(count(late, I.RELICYMS_BALM_3_), 1, "not another");
  assert.equal(count(late, I.COINS), 300, "the Wiki's price for a 2-dose");
  assert.equal(varbit(late, V.SOLD_BALM), 1);
});

test("the tea works once the player goes down Sithik's ladder (Wiki; capture tick 1558)", async (t) => {
  const f = actor(t, { at: [2596, 3107, 1], stage: S.POTION, attributes: { "quest.zogre_flesh_eaters.potion_used": true } });
  await h.dispatch(f, { type: "object_option", id: 16681, x: 2597, y: 3107, clickType: 1 });
  for (let i = 0; i < 12 && varbit(f, V.TRANSFORMED) !== 1; i++) h.tick(f);
  assert.equal(at(f)[2], 0, "down the ladder");
  assert.equal(varbit(f, V.TRANSFORMED), 1, "Sithik's bed shows him as an ogre");
});

test("Sithik speaks with his ogre chathead while the potion holds, the man's before and after (ticks 1567-1611, issue 6283)", async (t) => {
  const sithikHead = (f) => f.calls.filter((c) => c.name === "sendNpcHeadOnInterface").map((c) => c.args[0]).at(-1);
  const ogre = actor(t, { at: [2591, 3105, 1], stage: S.PERMANENT_SPELL, attributes: { "quest.zogre_flesh_eaters.transformed": true } });
  assert.equal(varbit(ogre, V.TRANSFORMED), undefined);
  await h.clickObject(ogre, 6887, [2591, 3103]);
  assert.equal(h.shown(ogre)?.who, "Sithik Ints");
  assert.equal(sithikHead(ogre), N.SITHIK_INTS_2, "zogre_sithik_ogre (884)");

  const man = actor(t, { at: [2591, 3105, 1], stage: S.GIVEN_KEY, attributes: { "quest.zogre_flesh_eaters.transformed": true } });
  await h.clickObject(man, 6887, [2591, 3103]);
  assert.equal(sithikHead(man), N.SITHIK_INTS, "a man again once Grish has the key (495 = 2)");
});

test("the quest teaches the balm and brutal arrows through Sithik and the comp bow through Grish (Wiki; issue 6283)", async (t) => {
  const ask = (f, event, payload, answer) => {
    const request = { player: f.player, ...payload, [answer]: null };
    h.PM.emitCustomEvent(event, request);
    return request[answer];
  };
  const early = actor(t, { at: [2442, 3049, 0], stage: S.PERMANENT_SPELL });
  assert.equal(ask(early, "herblore:unlocked", { unlock: "relicyms_balm" }, "allowed"), false);
  assert.equal(ask(early, "fletching:taught", { name: "brutal_arrows" }, "taught"), false);
  assert.equal(ask(early, "fletching:taught", { name: "comp_ogre_bow" }, "taught"), false);
  assert.equal(ask(early, "fletching:taught", { name: "broad_bolts" }, "taught"), null, "not the quest's to answer");

  const told = actor(t, { at: [2442, 3049, 0], stage: S.PERMANENT_SPELL, attributes: {
    "quest.zogre_flesh_eaters.make_cure": true,
    "quest.zogre_flesh_eaters.make_brutal": true,
    "zogre-flesh-eaters:make-composite-bow": true,
  } });
  assert.equal(ask(told, "herblore:unlocked", { unlock: "relicyms_balm" }, "allowed"), true);
  assert.equal(ask(told, "fletching:taught", { name: "brutal_arrows" }, "taught"), true);
  assert.equal(ask(told, "fletching:taught", { name: "comp_ogre_bow" }, "taught"), true);

  const done = actor(t, { at: [2442, 3049, 0], stage: S.COMPLETE });
  assert.equal(ask(done, "herblore:unlocked", { unlock: "relicyms_balm" }, "allowed"), true, "the scroll's reward");
  assert.equal(ask(done, "fletching:taught", { name: "comp_ogre_bow" }, "taught"), true);
});

// ------------------------------------------------------------------ Slash Bash's combat (issue 6283)

test("Slash Bash breathes at range and mixes in the crush only next to the player (ticks 2440-2642)", async (t) => {
  const { CombatFactory, CombatType } = h.core;
  const random = Math.random;
  t.after(() => { Math.random = random; });
  const f = actor(t, { at: [2484, 9445, 0], stage: S.GIVEN_KEY });
  const bash = h.spawn(f, N.SLASH_BASH, [2479, 9445, 0]);
  bash.getCombat().setTarget(f.player);
  for (const roll of [0, 0.99]) {
    Math.random = () => roll;
    assert.equal(CombatFactory.getMethod(bash).type(), CombatType.RANGED, "3 tiles off his east side: ranged only");
  }
  f.player.setLocation(new h.core.Location(2482, 9445, 0));
  Math.random = () => 0;
  assert.equal(CombatFactory.getMethod(bash).type(), CombatType.MELEE, "next to him: the crush");
  Math.random = () => 0.99;
  assert.equal(CombatFactory.getMethod(bash).type(), CombatType.RANGED, "next to him: the breath too");

  f.player.setLocation(new h.core.Location(2484, 9445, 0));
  const method = CombatFactory.getMethod(bash);
  const projectiles = [];
  const { Projectile } = h.core;
  const send = Projectile.prototype.sendProjectile;
  Projectile.prototype.sendProjectile = function () { projectiles.push(this); return this; };
  t.after(() => { Projectile.prototype.sendProjectile = send; });
  method.start(bash, f.player);
  assert.equal(bash.getAnimation?.()?.getId?.() ?? bash.animation?.getId?.(), 2101, "ogre_breath");
  assert.equal(projectiles.length, 1);
  const flob = projectiles[0];
  assert.equal(flob.getProjectileId?.() ?? flob.projectileId, 397, "flob");
  const hits = method.hits(bash, f.player);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].getDelay?.() ?? hits[0].delay, 2, "lands 2 ticks after the breath");
});

test("zogres take a quarter of a hit, half from Crumble Undead and all of a brutal arrow (Wiki: Zogre, Slash Bash)", async (t) => {
  const { CombatSpells, CombatType, Equipment, HitDamage, HitMask, Item } = h.core;
  const f = actor(t, { at: [2484, 9445, 0], stage: S.GIVEN_KEY });
  const bash = h.spawn(f, N.SLASH_BASH, [2479, 9445, 0]);
  const zogre = h.spawn(f, N.ZOGRE, [2479, 9450, 0]);
  const rolled = (target, combatType, hit = {}) => {
    const damage = new HitDamage(15, HitMask.RED);
    h.PM.emitCombatHitDamage({ attacker: f.player, target, combatType, hit, damage, accurate: true });
    return damage.getDamage();
  };
  assert.equal(rolled(bash, CombatType.MELEE), 3);
  assert.equal(rolled(zogre, CombatType.MELEE), 3);
  const crumble = { getSpellContext: () => ({ spell: CombatSpells.CRUMBLE_UNDEAD }) };
  assert.equal(rolled(bash, CombatType.MAGIC, crumble), 7);
  const boosted = (target) => {
    const damage = new HitDamage(20, HitMask.RED);
    h.PM.emitCombatHitDamage({ attacker: f.player, target, combatType: CombatType.MAGIC, hit: crumble, damage, accurate: true });
    return damage.getDamage();
  };
  assert.equal(boosted(zogre), 7, "a boosted Crumble Undead still tops out at the Zogre page's 7");
  assert.equal(boosted(bash), 10, "Slash Bash's page gives 50% with no cap");
  assert.equal(rolled(zogre, CombatType.MAGIC, { getSpellContext: () => ({ spell: CombatSpells.FIRE_BLAST }) }), 3);
  f.player.getEquipment().setItem(Equipment.WEAPON_SLOT, new Item(h.core.ItemIdentifiers.COMP_OGRE_BOW, 1));
  f.player.getEquipment().setItem(Equipment.AMMUNITION_SLOT, new Item(h.core.ItemIdentifiers.RUNE_BRUTAL, 100));
  assert.equal(rolled(bash, CombatType.RANGED), 15, "brutal arrows hit in full");
  f.player.getEquipment().setItem(Equipment.AMMUNITION_SLOT, new Item(h.core.ItemIdentifiers.OGRE_ARROW, 100));
  assert.equal(rolled(zogre, CombatType.RANGED), 3, "ogre arrows do not");
  const plain = h.spawn(f, N.OGRE, [2479, 9455, 0]);
  assert.equal(rolled(plain, CombatType.MELEE), 15, "other ogres are untouched");
});

// ------------------------------------------------------------------ The journal

test("the journal reproduces the capture's two pages (ticks 777 and 1158)", () => {
  const { tombPage } = require("../plugins/quests/zogreflesheaters/Journal.ZogreFleshEaters.js");
  const fixture = require("./fixtures/zogre-flesh-eaters-journal.json");
  assert.deepEqual(tombPage({ prismSearch: 3, zombieKilled: true, pageFound: true }), fixture.tick777);
  assert.deepEqual(tombPage({
    prismSearch: 5, zombieKilled: true, pageFound: true, innkeeper: true,
    portraitureFound: true, hamFound: true, necroFound: true,
  }), fixture.tick1158);
});
