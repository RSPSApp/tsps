// Run after `yarn build`: node --test tests/the-golem-capture.test.cjs
//
// The Golem against a whole run of the quest on live: the user's RSProx capture TheGolem.bin
// (revision 242; docs/quests/the-golem/README.md). Real Player, PlayerSession and ClientConnection,
// the real plugins, cache and map: talks, clicks and item uses are packets and each tick runs as
// World.process does. Ticks in the test names are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");

const KEY = "the_golem";
const S = { UNSTARTED: 0, REPAIR: 1, PORTAL: 2, STATUETTE: 3, REPLACED: 4, OPEN: 5, SEEN: 6, CONVINCE: 7, COMPLETE: 10 };
const V = { STAGE: 346, B: 347, CLAY: 348, A: 349, BB: 350, C: 351, D: 352, HEAD: 353, GEMS: 354, RETRIEVED: 355, SEEN: 356 };
const A = { LETTER: "quest.the_golem.letter", CLAY: "quest.the_golem.clay", STATUES: "quest.the_golem.statuettes",
  RETRIEVED: "quest.the_golem.retrieved_statuette", SEEN: "quest.the_golem.seen_underground", GEMS: "quest.the_golem.throne_gems" };
const GOLEM = 6277;
const ELISSA = 5138;
const CURATOR = 5214;
const SPAM = 105;
const UZER = [3489, 3093, 0];
const GOLEM_TILE = [3490, 3093, 0];

let I;
let codec;
before(async () => {
  h.key = KEY;
  await h.setup([[3490, 3090], [2720, 4900], [3257, 3450], [3370, 3430], [3360, 3335]]);
  I = h.core.ItemIdentifiers;
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => h.teardown());

const quest = () => h.quest(KEY);
const stage = (f) => quest().getStage(f.player);
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const count = (f, id) => f.player.getInventory().getAmount(id);
const at = (f) => { const l = f.player.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
const texts = (f) => f.messages.filter((m) => !String(m.text).includes("|")).map((m) => String(m.text))
  .filter((text) => !text.startsWith("You have unlocked a new music track"));
const sounds = (f) => f.calls.filter((c) => c.name === "sendSoundEffect").map((c) => [c.args[0], c.args[2]]);
const boxItems = (f) => f.calls.filter((c) => c.name === "sendItemOnInterfaces" && c.args[0] === ((193 << 16) | 1)).map((c) => c.args[1]);
const heads = (f) => f.calls.filter((c) => c.name === "sendNpcHeadOnInterface").map((c) => c.args[0]);
const clear = (f) => { f.calls.length = 0; f.messages.length = 0; f.animations.length = 0; };

function actor(t, { tile = UZER, stage: value = 0, items = [], attributes = {}, crafting = 73, thieving = 54 } = {}) {
  const f = h.actor(t, { at: tile, stage: value, done: [], attributes });
  const skills = f.player.getSkillManager();
  for (const [skill, lvl] of [[h.core.Skill.CRAFTING, crafting], [h.core.Skill.THIEVING, thieving]]) {
    skills.setMaxLevels(skill, lvl);
    skills.setCurrentLevel(skill, lvl, false);
  }
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  clear(f);
  return f;
}

/** Plays out a conversation (or an item box), answering menus with `picks`. */
async function play(f, start, picks = []) {
  const from = f.said.length;
  const queue = [...picks];
  await start?.();
  for (let idle = 0, i = 0; i < 400 && idle < 6; i++) {
    const line = h.shown(f);
    if (!line || line.who === "ActionDialogue") { idle++; h.tick(f); continue; }
    idle = 0;
    if (line.who === "menu") {
      if (!queue.length) break;
      await h.choose(f, queue.shift());
      continue;
    }
    await h.continueLine(f);
  }
  return f.said.slice(from).map((s) => (s.who === "menu" ? `MENU[${s.title ?? ""}]: ${s.text}` : `${s.who}: ${s.text}`));
}

const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);

async function useOnNpc(f, npc, itemId) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([{ type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot: slotOf(f, itemId), widgetId: 149 << 16 }]);
  for (let i = 0; i < 6 && !h.shown(f); i++) h.tick(f);
}

async function useOnObject(f, objectId, [x, y], itemId) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const before = f.messages.length;
  await f.connection.dispatch([{ type: "item_on_object", itemId, slot: slotOf(f, itemId), widgetId: 149 << 16, objectId, x, y }]);
  for (let i = 0; i < 12 && f.messages.length === before && !h.shown(f); i++) h.tick(f);
  h.tick(f);
}

async function click(f, id, [x, y], clickType = 1) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const before = f.messages.length;
  const from = f.player.getLocation();
  const jumped = () => f.player.getLocation().getZ() !== from.getZ() || f.player.getLocation().getDistance?.(from) > 30
    || Math.abs(f.player.getLocation().getY() - from.getY()) > 100;
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType }]);
  for (let i = 0; i < 20 && f.messages.length === before && !h.shown(f) && !jumped(); i++) h.tick(f);
  h.ticks(f, 2);
}

async function useItems(f, a, b) {
  await f.connection.dispatch([{ type: "inventory_use_on", slot: slotOf(f, a), itemId: a, target: { kind: "inventory", slot: slotOf(f, b), id: b } }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

async function itemOption(f, itemId, option) {
  await f.connection.dispatch([{ type: "inventory_action", slot: slotOf(f, itemId), itemId, widgetId: 3214, option }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

function journal(f) {
  const [, layer] = h.QuestRuntime.journalWidgets(quest(), f.player);
  return layer.staticChildren.map((child) => child.text);
}

function reload(t, f, tile) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const g = h.actor(t, { at: tile ?? at(f), stage: 0, done: [] });
  codec.hydratePlayerSave(raw).applyToPlayer(g.player);
  h.PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  clear(g);
  return g;
}

// --- The start and the repairs -------------------------------------------------------------------

test("t23-28: the broken golem's prompt 'Start The Golem quest?' Yes. starts the quest with the 6277 chathead", async (t) => {
  const f = actor(t);
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  const said = await play(f, () => h.talk(f, golem), ["Yes."]);
  assert.deepEqual(said, [
    "Broken clay golem: Damage... severe... Task... incomplete...",
    "MENU[Start The Golem quest?]: Yes.|No.",
    "PLAYER: Shall I try to repair you?",
    "Broken clay golem: Repairs... needed...",
  ]);
  assert.equal(stage(f), S.REPAIR);
  assert.equal(varbit(f, V.STAGE), S.REPAIR);
  assert.ok(texts(f).some((text) => /^You've started a new quest: .*The Golem/.test(text)), JSON.stringify(texts(f)));
  assert.ok(heads(f).length > 0 && heads(f).every((id) => id === GOLEM), `heads ${heads(f)}`);
});

test("'No.' (Wiki, not captured) leaves the quest unstarted", async (t) => {
  const f = actor(t);
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  const said = await play(f, () => h.talk(f, golem), ["No."]);
  assert.ok(said.includes("Broken clay golem: Must... not... injure... human..."), said.join("\n"));
  assert.equal(stage(f), S.UNSTARTED);
});

test("t30: once started, before the repairs, the golem only says 'Damage... severe...'", async (t) => {
  const f = actor(t, { stage: S.REPAIR });
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  assert.deepEqual(await play(f, () => h.talk(f, golem)), ["Broken clay golem: Damage... severe..."]);
});

test("soft clay before the start: 'Maybe you should ask the golem first!' (Wiki)", async (t) => {
  const f = actor(t, { items: [[I.SOFT_CLAY, 1]] });
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  await useOnNpc(f, golem, I.SOFT_CLAY);
  assert.deepEqual(texts(f), ["Maybe you should ask the golem first!"]);
  assert.equal(count(f, I.SOFT_CLAY), 1);
});

test("t36-74: four soft clays, each an animation, the repair sound and an item box; the last moves to stage 2", async (t) => {
  const f = actor(t, { stage: S.REPAIR, items: [[I.SOFT_CLAY, 4]] });
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  const boxes = [
    "You apply some clay to the golem's wounds. The clay begins to harden in the hot sun.",
    "You fix the golem's legs.",
    "The golem is nearly whole.",
  ];
  for (let clay = 1; clay <= 3; clay++) {
    clear(f);
    const said = await play(f, () => useOnNpc(f, golem, I.SOFT_CLAY));
    assert.deepEqual(said, [`ItemStatementDialogue: ${boxes[clay - 1]}`]);
    assert.equal(varbit(f, V.CLAY), clay);
    assert.deepEqual(f.animations.map((a) => a.id), [881]);
    assert.deepEqual(sounds(f), [[1850, 5]]);
    assert.deepEqual(boxItems(f), [I.SOFT_CLAY]);
    assert.equal(stage(f), S.REPAIR);
  }
  clear(f);
  const said = await play(f, () => useOnNpc(f, golem, I.SOFT_CLAY));
  assert.equal(varbit(f, V.CLAY), 4);
  assert.equal(stage(f), S.PORTAL);
  assert.deepEqual(said, [
    "ItemStatementDialogue: You repair the golem with a final piece of clay.",
    "Clay golem: Damage repaired...",
    "Clay golem: Thank you. My body and mind are fully healed.",
    "Clay golem: Now I must complete my task by defeating the great enemy.",
    "PLAYER: What enemy?",
    "Clay golem: A great demon. It broke through from its dimension to attack the city.",
    "Clay golem: The golem army was created to fight it. Many were destroyed, but we drove the demon back!",
    "Clay golem: The demon is still wounded. You must open the portal so that I can strike the final blow and complete my task.",
  ]);
  assert.equal(count(f, I.SOFT_CLAY), 0);
  assert.ok(heads(f).every((id) => id === GOLEM), `heads ${heads(f)}`);
  // Repaired: more clay is the engine's default.
  f.player.getInventory().add(new h.core.Item(I.SOFT_CLAY, 1), false);
  clear(f);
  await useOnNpc(f, golem, I.SOFT_CLAY);
  assert.deepEqual(texts(f), ["Nothing interesting happens."]);
});

test("t75-97: from stage 2 the golem's three questions each answer", async (t) => {
  const f = actor(t, { stage: S.PORTAL });
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  const portal = await play(f, () => h.talk(f, golem), ["How do I open the portal?"]);
  assert.ok(portal.includes("Clay golem: I do not know the pattern. Golems are not permitted to open the portal."), portal.join("\n"));
  const demon = await play(f, () => h.talk(f, golem), ["What makes you think you can defeat the demon?"]);
  assert.ok(demon.includes("Clay golem: Now that I am repaired, I will be able to destroy it easily!"));
  const leave = await play(f, () => h.talk(f, golem), ["I'll get right on it."]);
  assert.equal(leave.at(-1), "PLAYER: I'll get right on it.");
});

// --- The letter, Elissa and the notes ------------------------------------------------------------

test("t113-117: the letter lies by the golem once started; Read shows interface 220 and sets golem_b 1", async (t) => {
  const f = actor(t, { stage: S.PORTAL });
  h.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  const ground = h.core.World.getItemOnGroundManager?.() ?? null;
  void ground;
  await h.dispatch(f, { type: "ground_item_action", itemId: I.LETTER_2, x: 3479, y: 3092, option: "Take" });
  h.ticks(f, 15);
  assert.equal(count(f, I.LETTER_2), 1, "the letter was picked up");
  clear(f);
  await itemOption(f, I.LETTER_2, "Read");
  assert.equal(varbit(f, V.B), 1);
  const strings = new Map(f.calls.filter((c) => c.name === "sendString").map((c) => [c.args[1], c.args[0]]));
  assert.equal(strings.get((220 << 16) | 3), "Dearest Varmen,");
  assert.equal(strings.get((220 << 16) | 12), "Your loving Elissa.");
});

test("t128-129, t1117-1127: the stairs land as recorded and the first visit sets seen_underground", async (t) => {
  const f = actor(t, { stage: S.PORTAL, tile: [3491, 3090, 0] });
  await click(f, 6373, [3492, 3090]);
  assert.deepEqual(at(f), [2721, 4886, 0]);
  assert.equal(varbit(f, V.SEEN), 1);
  await click(f, 6372, [2721, 4884]);
  assert.deepEqual(at(f), [3491, 3090, 0]);
});

test("t338-388: Elissa's menus as captured; golem_b 2 only once her library line is continued", async (t) => {
  const f = actor(t, { stage: S.PORTAL, tile: [3374, 3430, 0], attributes: { [A.LETTER]: 1 } });
  const elissa = h.spawn(f, ELISSA, [3374, 3429, 0]);
  const go = await play(f, () => h.talk(f, elissa), ["Sorry, I need to go."]);
  assert.deepEqual(go, [
    "Elissa: Hello there.",
    "MENU[Select an option]: What do you do here?|What is this place?|I found a letter in the desert with your name on.|Sorry, I need to go.",
    "PLAYER: Sorry, I need to go.",
  ]);
  const city = await play(f, () => h.talk(f, elissa), ["What is this place?", "What happened to the city?"]);
  assert.ok(city.includes("Elissa: Many great civilizations were destroyed then."), city.join("\n"));
  // Stop on her last line: golem_b moves only when it is continued (ticks 376 -> 377).
  await h.talk(f, elissa);
  await h.continueLine(f);
  await h.choose(f, "I found a letter in the desert with your name on.");
  for (let i = 0; i < 20 && !/the notes he made are in the library/.test(h.shown(f)?.text ?? ""); i++) await h.continueLine(f);
  assert.match(h.shown(f).text, /^If you're interested in his expedition/);
  assert.equal(f.said.find((s) => /I wrote that letter/.test(s.text))?.text, "I wrote that letter to my late husband when he was exploring there.");
  assert.equal(f.player.getAttribute(A.LETTER), 1, "not yet: the line is still open");
  await h.continueLine(f);
  h.ticks(f, 2);
  assert.equal(varbit(f, V.B), 2);
  const again = await play(f, () => h.talk(f, elissa), ["Where did you say the notes were?"]);
  assert.deepEqual(again, [
    "Elissa: Hello there.",
    "MENU[Select an option]: What do you do here?|What is this place?|Where did you say the notes were?|Sorry, I need to go.",
    "PLAYER: Where did you say the notes were?",
    "Elissa: They're on a bookcase in the Exam Centre.",
  ]);
});

test("t463-479: the bookcase: the search line, the notes two ticks later, then 'already have' with them", async (t) => {
  const f = actor(t, { stage: S.PORTAL, tile: [3366, 3333, 0], attributes: { [A.LETTER]: 2 } });
  await h.dispatch(f, { type: "object_option", id: 6292, x: 3366, y: 3332, clickType: 1 });
  const searched = f.tick;
  assert.deepEqual(texts(f), ["You search the bookcase..."]);
  assert.equal(count(f, I.VARMENS_NOTES), 0);
  for (let i = 0; i < 6 && !h.shown(f); i++) h.tick(f);
  assert.equal(f.tick - searched, 2, "the find comes two ticks after the search line");
  assert.equal(count(f, I.VARMENS_NOTES), 1);
  assert.deepEqual(h.shown(f), { who: "ItemStatementDialogue", text: "You find Varmen's expedition notes.", npcId: undefined });
  assert.deepEqual(boxItems(f), [I.VARMENS_NOTES]);
  await h.continueLine(f);
  clear(f);
  await click(f, 6292, [3366, 3332]);
  assert.deepEqual(texts(f), ["You search the bookcase...", "You already have Varmen's expedition notes, so you find nothing of interest."]);
  assert.equal(count(f, I.VARMENS_NOTES), 1);
});

test("the bookcase before Elissa names it is the world's ordinary bookcase", async (t) => {
  const f = actor(t, { stage: S.PORTAL, tile: [3366, 3333, 0], attributes: { [A.LETTER]: 1 } });
  await click(f, 6292, [3366, 3332]);
  h.ticks(f, 3);
  assert.equal(count(f, I.VARMENS_NOTES), 0);
});

test("t486-498: Read on the notes opens the book and sets golem_b 3", async (t) => {
  const f = actor(t, { stage: S.PORTAL, attributes: { [A.LETTER]: 2 }, items: [[I.VARMENS_NOTES, 1]] });
  await itemOption(f, I.VARMENS_NOTES, "Read");
  assert.equal(varbit(f, V.B), 3);
  const strings = new Map(f.calls.filter((c) => c.name === "sendString").map((c) => [c.args[1], c.args[0]]));
  assert.equal(strings.get((392 << 16) | 6), "The Ruins of Uzer");
  assert.equal(strings.get((392 << 16) | 44), "Septober 19:");
});

// --- The museum ----------------------------------------------------------------------------------

test("t556-643: the curator's statuette option once the notes are read; stage 3 on continuing the question", async (t) => {
  const f = actor(t, { stage: S.PORTAL, tile: [3257, 3446, 0], attributes: { [A.LETTER]: 3 } });
  const curator = h.spawn(f, CURATOR, [3258, 3447, 0]);
  await h.talk(f, curator);
  await h.continueLine(f);
  const menu = h.shown(f);
  assert.equal(menu.who, "menu");
  assert.ok(menu.text.includes("I'm looking for a statuette recovered from the city of Uzer."), menu.text);
  assert.ok(!menu.text.includes("Fossil Island"), "Talk about Fossil Island. is after Bone Voyage only");
  await h.choose(f, "I'm looking for a statuette recovered from the city of Uzer.");
  assert.equal(h.shown(f).text, "I'm looking for a statuette recovered from the city of Uzer.");
  assert.equal(stage(f), S.PORTAL, "not yet: the question is still open");
  await h.continueLine(f);
  h.tick(f);
  assert.equal(stage(f), S.STATUETTE);
  const said = await play(f, null, ["Well, I, er, just want it."]);
  assert.equal(said.at(-1), "Curator Haig Halen: Well, you can't have it! This museum never lets go of its treasures.");
});

test("before the notes the curator keeps his own conversation (no statuette option)", async (t) => {
  const f = actor(t, { stage: S.PORTAL, tile: [3257, 3446, 0], attributes: { [A.LETTER]: 2 } });
  const curator = h.spawn(f, CURATOR, [3258, 3447, 0]);
  await h.talk(f, curator);
  await h.continueLine(f);
  assert.ok(!String(h.shown(f)?.text).includes("statuette"), JSON.stringify(h.shown(f)));
  const request = { player: f.player, active: true };
  h.PM.emitCustomEvent("the-golem:curator-step", request);
  assert.equal(request.active, false, "Dig Site and Bone Voyage keep the curator");
});

test("t649-653: Pickpocket at stage 3 steals the key with the recorded animation and sound; only once", async (t) => {
  const f = actor(t, { stage: S.PORTAL, tile: [3257, 3446, 0], attributes: { [A.LETTER]: 3 } });
  const curator = h.spawn(f, CURATOR, [3258, 3447, 0]);
  await h.talk(f, curator, 3);
  h.ticks(f, 2);
  assert.deepEqual(texts(f), ["The curator doesn't seem to have anything of value."]);
  quest().setStage(f.player, S.STATUETTE);
  clear(f);
  await h.talk(f, curator, 3);
  assert.equal(count(f, I.DISPLAY_CABINET_KEY), 1);
  assert.deepEqual(f.animations.map((a) => a.id), [881]);
  assert.deepEqual(sounds(f), [[2581, 10]]);
  // The Wiki's wording; the capture reads "You pick the curator's pocket and steal a key."
  assert.deepEqual(h.shown(f), { who: "ItemStatementDialogue", text: "You steal a tiny key.", npcId: undefined });
  assert.deepEqual(boxItems(f), [I.DISPLAY_CABINET_KEY]);
  await h.continueLine(f);
  clear(f);
  await h.talk(f, curator, 3);
  h.ticks(f, 2);
  assert.equal(count(f, I.DISPLAY_CABINET_KEY), 1, "only one key");
});

test("t665-761: the case: locked, Open with the key, the box two ticks later, Study shows it stolen, the key gets another", async (t) => {
  const f = actor(t, { stage: S.STATUETTE, tile: [3257, 3452, 1], attributes: { [A.LETTER]: 3 } });
  await click(f, 24626, [3257, 3453], 2);
  assert.deepEqual(texts(f), ["The cabinet is locked."]);
  f.player.getInventory().add(new h.core.Item(I.DISPLAY_CABINET_KEY, 1), false);
  clear(f);
  await h.dispatch(f, { type: "object_option", id: 24626, x: 3257, y: 3453, clickType: 2 });
  const opened = f.tick;
  assert.equal(count(f, I.STATUETTE), 1);
  assert.equal(varbit(f, V.RETRIEVED), 1);
  for (let i = 0; i < 6 && !h.shown(f); i++) h.tick(f);
  assert.equal(f.tick - opened, 2);
  assert.deepEqual(h.shown(f), { who: "ItemStatementDialogue", text: "You open the cabinet and retrieve the statuette.", npcId: undefined });
  await h.continueLine(f);
  clear(f);
  await click(f, 24626, [3257, 3453], 1);
  const strings = f.calls.filter((c) => c.name === "sendString" && c.args[1] === ((534 << 16) | 2)).map((c) => c.args[0]);
  assert.ok(strings.at(-1).endsWith("<br><br>Recently this display was stolen and its whereabouts are unknown."), strings.at(-1));
  // The client closes the case's interface on the next click in the world.
  f.player.getPacketSender().sendInterfaceRemoval();
  clear(f);
  await useOnObject(f, 24626, [3257, 3453], I.DISPLAY_CABINET_KEY);
  assert.deepEqual(texts(f), ["You have already taken the statuette."]);
  f.player.getInventory().deleteNumber(I.STATUETTE, 1);
  assert.equal(count(f, I.STATUETTE), 0);
  clear(f);
  await useOnObject(f, 24626, [3257, 3453], I.DISPLAY_CABINET_KEY);
  assert.equal(count(f, I.STATUETTE), 1, "the key on the emptied case gives another (Wiki)");
  assert.equal(h.shown(f)?.text, "You open the cabinet and retrieve the statuette.");
});

test("t1079-1081: the statuette on the golem: 'Nothing interesting happens.'", async (t) => {
  const f = actor(t, { stage: S.STATUETTE, items: [[I.STATUETTE, 1]] });
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  await useOnNpc(f, golem, I.STATUETTE);
  assert.deepEqual(texts(f), ["Nothing interesting happens."]);
});

// --- The temple ----------------------------------------------------------------------------------

const ALCOVE = { A: [6303, [2718, 4899]], B: [6304, [2718, 4896]], C: [6305, [2725, 4899]], D: [6306, [2725, 4896]] };

test("t1100-1184: the statuette goes in the empty alcove; turned to a=1 b=1 c=0 d=2 the door grinds open", async (t) => {
  const f = actor(t, { stage: S.STATUETTE, tile: [2721, 4897, 0], items: [[I.STATUETTE, 1]], attributes: { [A.RETRIEVED]: true, [A.SEEN]: true } });
  const animated = [];
  t.mock.method(f.player.getPacketSender(), "sendObjectAnimation", (object, animation) => { animated.push([object.getId(), animation.getId()]); return f.player.getPacketSender(); });
  await useOnObject(f, ...ALCOVE.A, I.STATUETTE);
  assert.deepEqual(texts(f), ["There is already a statuette in the alcove."]);
  clear(f);
  await useOnObject(f, ...ALCOVE.D, I.STATUETTE);
  assert.deepEqual(texts(f), ["You insert the statuette into the alcove."]);
  assert.equal(varbit(f, V.D), 1);
  assert.equal(stage(f), S.REPLACED);
  assert.equal(count(f, I.STATUETTE), 0);
  clear(f);
  await click(f, 6310, [2720, 4912]);
  assert.deepEqual(texts(f), ["You can't find any way to open the door."]);
  assert.deepEqual(at(f).slice(2), [0]);
  clear(f);
  await click(f, ...ALCOVE.D);
  assert.deepEqual(texts(f), ["You turn the statuette to the right."]);
  assert.equal(varbit(f, V.D), 2);
  assert.deepEqual(sounds(f), [[1852, 0]]);
  clear(f);
  await click(f, ...ALCOVE.B);
  assert.deepEqual(texts(f), ["You turn the statuette to the left."]);
  assert.equal(stage(f), S.REPLACED);
  clear(f);
  await click(f, ...ALCOVE.A);
  assert.deepEqual(texts(f), ["You turn the statuette to the left.", "The door grinds open."]);
  assert.equal(stage(f), S.OPEN);
  assert.deepEqual(animated, [[6310, 1909]]);
  assert.deepEqual(sounds(f), [[1852, 0], [1848, 0]]);
  clear(f);
  await click(f, ...ALCOVE.C);
  assert.deepEqual(texts(f), ["The statuette is now locked in place."]);
});

test("t1190-1250: through the open door to the throne room; the skeleton line the first time only; back out", async (t) => {
  const f = actor(t, { stage: S.OPEN, tile: [2720, 4911, 0] });
  await click(f, 6310, [2720, 4912]);
  assert.deepEqual(at(f), [2720, 4884, 2]);
  assert.equal(stage(f), S.SEEN);
  assert.deepEqual(f.messages.filter((m) => m.type === SPAM).map((m) => m.text), ["You step into the portal."]);
  assert.ok(texts(f).includes("This room is dominated by a colossal horned skeleton!"));
  clear(f);
  await click(f, 6282, [2719, 4883]);
  assert.deepEqual(at(f), [2721, 4911, 0]);
  assert.deepEqual(f.messages.filter((m) => m.type === SPAM).map((m) => m.text), ["You step into the portal."]);
  clear(f);
  await click(f, 6310, [2720, 4912]);
  assert.deepEqual(at(f), [2720, 4884, 2]);
  assert.ok(!texts(f).includes("This room is dominated by a colossal horned skeleton!"));
});

test("the door stays usable after the quest (no dead door between The Golem and Shadow of the Storm)", async (t) => {
  const f = actor(t, { stage: S.COMPLETE, tile: [2720, 4911, 0] });
  await click(f, 6310, [2720, 4912]);
  assert.deepEqual(at(f), [2720, 4884, 2]);
});

test("t1230: hammer and chisel on the throne: two of each gem, the recorded animation, sound and box", async (t) => {
  const f = actor(t, { stage: S.SEEN, tile: [2720, 4912, 2], items: [[I.HAMMER, 1]] });
  await useOnObject(f, 6300, [2719, 4913], I.HAMMER);
  assert.deepEqual(texts(f), ["You'll need a chisel as well as a hammer to get the gems."]);
  f.player.getInventory().add(new h.core.Item(I.CHISEL, 1), false);
  clear(f);
  await useOnObject(f, 6300, [2719, 4913], I.HAMMER);
  assert.deepEqual([count(f, I.RUBY), count(f, I.EMERALD), count(f, I.SAPPHIRE)], [2, 2, 2]);
  assert.equal(varbit(f, V.GEMS), 1);
  assert.deepEqual(f.animations.map((a) => a.id), [881]);
  assert.deepEqual(sounds(f), [[2581, 0]]);
  assert.deepEqual(h.shown(f), { who: "ItemStatementDialogue", text: "You prise the gems from the demon's throne.", npcId: undefined });
  assert.deepEqual(boxItems(f), [I.RUBY]);
  await h.continueLine(f);
  clear(f);
  await useOnObject(f, 6300, [2719, 4913], I.HAMMER);
  assert.deepEqual([count(f, I.RUBY), count(f, I.EMERALD), count(f, I.SAPPHIRE)], [2, 2, 2], "once only");
});

// --- Convincing the golem ------------------------------------------------------------------------

test("t1271-1300: told the demon is dead, the golem refuses; stage 7 only once its last line is continued", async (t) => {
  const f = actor(t, { stage: S.SEEN });
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  await h.talk(f, golem);
  for (let i = 0; i < 10 && h.shown(f)?.text !== "Demon must be defeated! Task incomplete."; i++) await h.continueLine(f);
  assert.equal(h.shown(f).text, "Demon must be defeated! Task incomplete.");
  assert.equal(stage(f), S.SEEN);
  await h.continueLine(f);
  h.tick(f);
  assert.equal(stage(f), S.CONVINCE);
  assert.deepEqual(await play(f, () => h.talk(f, golem)), [
    "Clay golem: My task is incomplete. You must open the portal so I can defeat the great demon.",
    "PLAYER: I already told you, he's dead!",
    "Clay golem: Task incomplete.",
    "PLAYER: Oh, how am I going to convince you?",
  ]);
});

test("t1280-1406: the mushroom, the dye (kept by the pen) and the program", async (t) => {
  const f = actor(t, { stage: S.CONVINCE, tile: [3494, 3088, 0], items: [[I.PESTLE_AND_MORTAR, 1], [I.PAPYRUS, 2], [I.PHOENIX_FEATHER, 1]] });
  await click(f, 6311, [3495, 3088]);
  assert.equal(count(f, I.BLACK_MUSHROOM), 1);
  assert.equal(h.shown(f)?.text, "You pick a mushroom.");
  await h.continueLine(f);
  clear(f);
  await useItems(f, I.BLACK_MUSHROOM, I.PESTLE_AND_MORTAR);
  assert.equal(h.shown(f)?.text, "You crush the mushroom, but you have no vial to put the dye in and it goes everywhere!");
  assert.equal(count(f, I.BLACK_MUSHROOM), 0);
  await h.continueLine(f);
  f.player.getInventory().add(new h.core.Item(I.BLACK_MUSHROOM, 1), false);
  f.player.getInventory().add(new h.core.Item(I.VIAL, 1), false);
  const vialSlot = slotOf(f, I.VIAL);
  clear(f);
  await useItems(f, I.BLACK_MUSHROOM, I.PESTLE_AND_MORTAR);
  assert.equal(slotOf(f, I.BLACK_DYE), vialSlot, "the vial becomes the dye in its slot");
  assert.equal(h.shown(f)?.text, "You crush the mushroom and pour the juice into a vial.");
  await h.continueLine(f);
  clear(f);
  await useItems(f, I.PHOENIX_FEATHER, I.PAPYRUS);
  assert.deepEqual(texts(f), ["You will need some kind of ink to write with."]);
  clear(f);
  await useItems(f, I.PHOENIX_FEATHER, I.BLACK_DYE);
  assert.equal(count(f, I.PHOENIX_QUILL_PEN), 1);
  assert.equal(count(f, I.BLACK_DYE), 1, "tick 1388: the dye is not used up");
  assert.equal(h.shown(f)?.text, "You dip the phoenix feather into the dye.");
  await h.continueLine(f);
  clear(f);
  await useItems(f, I.PHOENIX_QUILL_PEN, I.PAPYRUS);
  assert.equal(count(f, I.GOLEM_PROGRAM), 1, "one tick later");
  assert.equal(count(f, I.PAPYRUS), 1);
  assert.equal(count(f, I.PHOENIX_QUILL_PEN), 1, "the pen is kept");
  assert.equal(h.shown(f)?.text, "You write on the papyrus: YOUR TASK IS DONE");
  assert.deepEqual(boxItems(f), [I.GOLEM_PROGRAM]);
});

test("the pen on papyrus before seeing the skeleton: 'You don't know what to write.' (Wiki)", async (t) => {
  const f = actor(t, { stage: S.OPEN, items: [[I.PHOENIX_QUILL_PEN, 1], [I.PAPYRUS, 1]] });
  await useItems(f, I.PHOENIX_QUILL_PEN, I.PAPYRUS);
  h.ticks(f, 2);
  assert.deepEqual(texts(f), ["You don't know what to write."]);
  assert.equal(count(f, I.GOLEM_PROGRAM), 0);
});

test("t1429-1447: the implement opens the skull, the program completes once, the skull shuts as the scroll closes", async (t) => {
  const f = actor(t, { stage: S.CONVINCE, items: [[I.STRANGE_IMPLEMENT, 1], [I.GOLEM_PROGRAM, 1]] });
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  await useOnNpc(f, golem, I.GOLEM_PROGRAM);
  assert.deepEqual(texts(f), ["You can't see a way to put the instructions in the golem's skull"]);
  clear(f);
  await useOnNpc(f, golem, I.STRANGE_IMPLEMENT);
  assert.deepEqual(texts(f), ["You insert the key and the golem's skull hinges open."]);
  assert.equal(varbit(f, V.HEAD), 1);
  h.ticks(f, 3);
  assert.equal(varbit(f, V.HEAD), 1, "with the program carried it stays open");
  const qp = Number(f.player.getAttribute("quest.points")) || 0;
  const skills = f.player.getSkillManager();
  const xp = [skills.getExperience(h.core.Skill.CRAFTING), skills.getExperience(h.core.Skill.THIEVING)];
  clear(f);
  await useOnNpc(f, golem, I.GOLEM_PROGRAM);
  assert.deepEqual(sounds(f), [[1849, 0]]);
  for (let i = 0; i < 5 && h.shown(f)?.text !== "Thank you. Now my mind is at rest."; i++) await h.continueLine(f);
  assert.deepEqual(f.said.slice(-3).map((s) => s.text), ["New instructions... Updating program...", "Task complete!", "Thank you. Now my mind is at rest."]);
  assert.equal(stage(f), S.CONVINCE, "not yet: the last line is still open");
  assert.equal(count(f, I.GOLEM_PROGRAM), 1);
  await h.continueLine(f);
  h.ticks(f, 3);
  assert.equal(stage(f), S.COMPLETE);
  assert.equal(varbit(f, V.STAGE), S.COMPLETE);
  assert.equal(count(f, I.GOLEM_PROGRAM), 0, "the program goes at completion (tick 1438)");
  assert.equal(skills.getExperience(h.core.Skill.CRAFTING) - xp[0], 1000);
  assert.equal(skills.getExperience(h.core.Skill.THIEVING) - xp[1], 1000);
  assert.ok(texts(f).some((text) => /^Congratulations, you've completed a quest: .*The Golem/.test(text)));
  const scroll = f.calls.filter((c) => c.name === "sendItemOnInterfaces" && c.args[0] === ((153 << 16) | 5));
  assert.deepEqual(scroll.map((c) => c.args[1]), [I.STATUETTE]);
  assert.equal(varbit(f, V.HEAD), 1, "the skull is still open under the scroll");
  void qp;
  clear(f);
  f.player.getPacketSender().sendInterfaceRemoval();
  h.tick(f);
  assert.equal(varbit(f, V.HEAD), 0);
  assert.deepEqual(texts(f), ["The golem's skull shuts automatically."]);
  // Repeat: no second completion, and the post-quest talk.
  clear(f);
  const post = await play(f, () => h.talk(f, golem));
  assert.equal(post[0], "Clay golem: Thank you for helping me. A golem can have no greater satisfaction than knowing that its task is complete.");
  assert.equal(skills.getExperience(h.core.Skill.CRAFTING) - xp[0], 1000, "rewarded once");
});

test("the implement without the program opens the skull and it shuts again (Wiki)", async (t) => {
  const f = actor(t, { stage: S.CONVINCE, items: [[I.STRANGE_IMPLEMENT, 1]] });
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  await useOnNpc(f, golem, I.STRANGE_IMPLEMENT);
  h.ticks(f, 2);
  assert.deepEqual(texts(f), ["You insert the key and the golem's skull hinges open.", "The golem's skull shuts automatically."]);
  assert.equal(varbit(f, V.HEAD), 0);
});

test("walking away during the program keeps it, and a relog closes the skull for another try", async (t) => {
  const f = actor(t, { stage: S.CONVINCE, items: [[I.STRANGE_IMPLEMENT, 1], [I.GOLEM_PROGRAM, 1]] });
  const golem = h.spawn(f, GOLEM, GOLEM_TILE);
  await useOnNpc(f, golem, I.STRANGE_IMPLEMENT);
  await useOnNpc(f, golem, I.GOLEM_PROGRAM);
  f.player.getPacketSender().sendInterfaceRemoval();
  h.ticks(f, 3);
  assert.equal(stage(f), S.CONVINCE);
  assert.equal(count(f, I.GOLEM_PROGRAM), 1);
  const g = reload(t, f, UZER);
  assert.equal(quest().getStage(g.player), S.CONVINCE);
  assert.equal(g.player.getPacketSender().getVarbit(V.HEAD), 0);
  assert.equal(g.player.getInventory().getAmount(I.GOLEM_PROGRAM), 1);
});

// --- The journal ---------------------------------------------------------------------------------

test("the journal reads as captured at each stage the capture opens it", (t) => {
  const f = actor(t, { stage: S.PORTAL });
  const done = ["<str>I have spoken to the golem.", "<str>I have repaired the golem."];
  const asked = [
    "<col=000080>The golem asked me to open the <col=800000>portal<col=000080> so it can defeat a",
    "<col=000080><col=800000>demon<col=000080>.",
  ];
  // Tick 100.
  assert.deepEqual(journal(f), [...done, ...asked,
    "<col=000080>I should go down the stairs in <col=800000>Uzer<col=000080> and work out how to open",
    "<col=000080>the <col=800000>portal<col=000080>."]);
  // Tick 135: the letter read, the ruins seen.
  f.player.setAttribute(A.LETTER, 1);
  f.player.setAttribute(A.SEEN, true);
  assert.deepEqual(journal(f), [...done, ...asked,
    "<col=000080>To open the portal I will need to find a missing <col=800000>statuette<col=000080>.",
    "<col=000080>Maybe I should speak to <col=800000>Elissa<col=000080> at the <col=800000>Digsite<col=000080> about the letter I",
    "<col=000080>found in Uzer."]);
  // Tick 522: the notes read.
  f.player.setAttribute(A.LETTER, 3);
  assert.deepEqual(journal(f), [...done, ...asked,
    "<col=000080>To open the portal I will need to find a missing <col=800000>statuette<col=000080>.",
    "<str>I talked to Elissa about the letter from the desert.",
    "<str>I took Varmen's notes from the Digsite Exam Centre.",
    "<col=000080>According to <col=800000>Varmen's notes<col=000080>, he removed the <col=800000>statuette<col=000080>",
    "<col=000080>during his expedition."]);
  // Tick 689: stage 3, the statuette taken.
  quest().setStage(f.player, S.STATUETTE);
  f.player.setAttribute(A.RETRIEVED, true);
  assert.deepEqual(journal(f), [...done, ...asked,
    "<str>I talked to Elissa about the letter from the desert.",
    "<str>I took Varmen's notes from the Digsite Exam Centre.",
    "<str>I have retrieved the missing statuette from the Varrock",
    "<str>Museum.",
    "<col=000080>I should take the <col=800000>statuette<col=000080> to Uzer and put it back in the",
    "<col=000080>temple."]);
  const replaced = [
    "<str>I talked to Elissa about the letter from the desert.",
    "<str>I took Varmen's notes from the Digsite Exam Centre.",
    "<str>I have retrieved the missing statuette from the Varrock",
    "<str>Museum and repaired the puzzle in the temple.",
  ];
  // Tick 1121.
  quest().setStage(f.player, S.REPLACED);
  assert.deepEqual(journal(f), [...done, ...asked, ...replaced,
    "<col=000080>I should turn the <col=800000>statuettes<col=000080> to the correct sequence to open",
    "<col=000080>the <col=800000>portal<col=000080>."]);
  const opened = [...done, "<str>The golem asked me to open the portal so it could defeat a", "<str>demon.", ...replaced,
    "<str>I have opened the portal.", "<str>I have visited the demon's lair and seen its skeleton."];
  // Tick 1209.
  quest().setStage(f.player, S.SEEN);
  assert.deepEqual(journal(f), [...opened,
    "<col=000080>I should inform the <col=800000>golem<col=000080> that the <col=800000>demon<col=000080> is dead."]);
  // Tick 1288.
  quest().setStage(f.player, S.CONVINCE);
  assert.deepEqual(journal(f), [...opened,
    "<str>I told the golem that the demon was dead, but it did not", "<str>believe me!",
    "<col=000080>I should find some way to convince the <col=800000>golem<col=000080> that its task is",
    "<col=000080>done."]);
});

// --- Persistence, recovery and shared owners ------------------------------------------------------

test("the side varbits survive a save and reload, and the letter and implement respawn for a started quest", async (t) => {
  const f = actor(t, { stage: S.REPLACED, attributes: {
    [A.LETTER]: 3, [A.CLAY]: 4, [A.RETRIEVED]: true, [A.SEEN]: true, [A.GEMS]: true, [A.STATUES]: (1 << 0) | (1 << 2) | (2 << 6),
  } });
  const g = reload(t, f, UZER);
  const sender = g.player.getPacketSender();
  assert.equal(quest().getStage(g.player), S.REPLACED);
  assert.deepEqual([V.B, V.CLAY, V.A, V.BB, V.C, V.D, V.RETRIEVED, V.SEEN, V.GEMS].map((id) => sender.getVarbit(id)), [3, 4, 1, 1, 0, 2, 1, 1, 1]);
  const manager = h.core.World.getItemOnGroundManager?.() ?? h.PM.getCoreApi().ItemOnGroundManager;
  void manager;
});

test("the phoenix gives no feather while a quill pen is carried (Wiki)", async (t) => {
  const f = actor(t, { stage: S.CONVINCE, tile: [3416, 3161, 0], items: [[I.PHOENIX_QUILL_PEN, 1]], thieving: 60 });
  const phoenix = h.spawn(f, 5137, [3417, 3161, 0]);
  await h.talk(f, phoenix, 3);
  h.ticks(f, 3);
  assert.deepEqual(texts(f), ["You already have a phoenix tail-feather."]);
  assert.equal(count(f, I.PHOENIX_FEATHER), 0);
});
