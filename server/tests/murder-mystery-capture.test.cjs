// Run after `yarn build`: node --test tests/murder-mystery-capture.test.cjs
//
// Murder Mystery against four whole runs of the quest on live: the user's RSProx capture
// MurderMystery.bin (revision 242, Frank the murderer) and local recordings 1001551, 1001958 (David)
// and 1001930 (Carol); docs/quests/murder-mystery/README.md. Real Player, PlayerSession and
// ClientConnection, the real plugins, cache and map: talks, clicks and item uses are packets and each
// tick runs as World.process does. Ticks in the test names are MurderMystery.bin's unless a
// recording is named.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "murder_mystery";
const S = { NOT_STARTED: 0, STARTED: 1, COMPLETE: 2 };
const A = {
  MURDERER: "quest.murder_mystery.murderer",
  EVIDENCE: "quest.murder_mystery.evidence",
  POISON: "quest.murder_mystery.poison",
  STORIES: "murder-mystery:poison-stories",
};
const SUSPECT = { ANNA: 1, BOB: 2, CAROL: 3, DAVID: 4, ELIZABETH: 5, FRANK: 6 };
const THREAD = 1 << 1;
const PRINTS = 1 << 2;
const N = {
  GUARD: 4218, HOUSE_GUARD: 6194, GOSSIP: 4219, SALESMAN: 4227, PIERRE: 4213, HOBBES: 4214, LOUISA: 4215, MARY: 4216,
  STANFORD: 4217, DONOVAN: 4212, ANNA: 6195, BOB: 6196, CAROL: 6197, DAVID: 6198, ELIZABETH: 6199, FRANK: 6200,
};
const LOC = {
  WINDOW: [26123, 2748, 3577], SACKS: [2663, 2731, 3582], FLOUR: [26122, 2733, 3582], GATE: [2664, 2750, 3578],
  CREST: [2655, 2746, 3573], DRAIN: [2652, 2736, 3573], COMPOST: [26120, 2730, 3572],
  BARREL_A: [2656, 2733, 3575], BARREL_B: [2657, 2735, 3579], BARREL_F: [2661, 2747, 3577, 1],
};
const BOX = (229 << 16) | 3;

let I;
let Sk;
before(async () => {
  h.key = KEY;
  await h.setup([[2740, 3570], [2697, 3496]]);
  I = h.core.ItemIdentifiers;
  Sk = h.core.Skill;
});
after(() => h.teardown());

const stage = (f) => h.quest().getStage(f.player);
const count = (f, id) => f.player.getInventory().getAmount(id);
const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);
const messages = (f, from = 0) => f.messages.filter((m) => m.tick >= from).map((m) => String(m.text))
  .filter((text) => !text.startsWith("You have unlocked a new music track"));
const boxes = (f, from = 0) => f.calls.filter((c) => c.tick >= from && c.name === "sendString" && c.args[1] === BOX)
  .map((c) => String(c.args[0]).replace(/<br>/g, " "));
const configs = (f, id) => f.calls.filter((c) => c.name === "sendConfig" && c.args[0] === id).map((c) => c.args[1]);

function actor(t, { at, stage: value = S.NOT_STARTED, murderer = SUSPECT.FRANK, evidence = 0, poison = 0, stories = 0, items = [] } = {}) {
  const attributes = value === S.STARTED ? { [A.MURDERER]: murderer, [A.EVIDENCE]: evidence, [A.POISON]: poison, [A.STORIES]: stories } : {};
  const f = h.actor(t, { at, stage: value, done: [], attributes });
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  f.player.getSkillManager().setMaxLevels(Sk.CRAFTING, 30);
  f.player.getSkillManager().setCurrentLevel(Sk.CRAFTING, 30, false);
  f.calls.length = 0;
  f.messages.length = 0;
  return f;
}

/** Plays out the conversation, answering menus with `picks`; returns the lines and boxes shown. */
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

async function clickObject(f, [id, x, y], clickType = 2) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const before = { messages: f.messages.length, said: f.said.length };
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType }]);
  for (let i = 0; i < 15 && f.messages.length === before.messages && !h.shown(f); i++) h.tick(f);
  return f.tick;
}

async function use(f, usedId, withId) {
  const usedSlot = slotOf(f, usedId);
  const withSlot = slotOf(f, withId);
  await f.connection.dispatch([{ type: "inventory_use_on", slot: usedSlot, itemId: usedId, target: { kind: "inventory", slot: withSlot, id: withId } }]);
  h.tick(f);
}

// ------------------------------------------------------------------ The start and the guard

test("the start: the guard's two lines, 'Start the Murder Mystery quest?'; No. refuses, Yes. starts it (ticks 56-74)", async (t) => {
  const f = actor(t, { at: [2741, 3560, 0] });
  const guard = h.spawn(f, N.GUARD, [2741, 3561, 0]);
  const refused = await play(f, () => h.talk(f, guard), ["No."]);
  assert.deepEqual(refused, [
    "PLAYER: What's going on here?",
    "Guard: Oh, it's terrible! Lord Sinclair has been murdered and we don't have any clues as to who or why. We're totally baffled!",
    "Guard: If you can help us we will be very grateful.",
    "MENU[Start the Murder Mystery quest?]: Yes.|No.",
    "PLAYER: You should do your own dirty work.",
    "Guard: Get lost then, this is private property! ...Unless you'd like to be taken in for questioning yourself?",
  ]);
  assert.equal(stage(f), S.NOT_STARTED);
  const lines = await play(f, () => h.talk(f, guard), ["Yes."]);
  assert.deepEqual(lines.slice(4), [
    "PLAYER: Sure, I'll help!",
    "Guard: Thanks a lot!",
    "PLAYER: What should I be doing to help?",
    "Guard: Look around and investigate who might be responsible. The Sarge said every murder leaves clues to who done it, but frankly we're out of our depth here.",
  ]);
  assert.equal(stage(f), S.STARTED, "varp 192 0 -> 1 (tick 72)");
  const murderer = f.player.getAttribute(A.MURDERER);
  assert.ok(murderer >= 1 && murderer <= 6, "a murderer is chosen");
  assert.equal(configs(f, 195).at(-1), murderer, "varp 195 carries the murderer (tick 72: 6)");
  assert.equal(configs(f, 192).at(-1), S.STARTED);
});

test("accusing a servant: the guard asks 'Which one?' twice, then the box before 'Great work.' (ticks 233-246)", async (t) => {
  const f = actor(t, { at: [2741, 3560, 0], stage: S.STARTED });
  const guard = h.spawn(f, N.GUARD, [2741, 3561, 0]);
  const lines = await play(f, () => h.talk(f, guard), ["I know who did it!", "It was one of the servants!", "It was one of the women...", "It was SO obviously Louisa the cook."]);
  assert.deepEqual(lines, [
    "MENU[Select an option]: What should I be doing to help again?|How did Lord Sinclair die?|I know who did it!",
    "PLAYER: I know who did it!",
    "Guard: Really? That was quick work! Who?",
    "MENU[Select an option]: It was an intruder!|The butler did it!|It was one of the servants!|It was one of his family!",
    "PLAYER: It was one of the servants!",
    "Guard: Oh really? Which one?",
    "MENU[Select an option]: It was one of the women...|It was one of the men...",
    "PLAYER: It was one of the women",
    "Guard: Oh really? Which one?",
    "MENU[Select an option]: It was SO obviously Louisa the cook.|It MUST have been Mary the maid.",
    "StatementDialogue: You tell the guard who you suspect of the crime.",
    "Guard: Great work. Show me the evidence, and we'll take them to the dungeons.",
    "Guard: You DO have evidence of their crime, right?",
    "PLAYER: Uh....",
    "Guard: Tch. You wouldn't last a day in the guards with sloppy thinking like that. Come see me when you have some proof of your accusations.",
  ]);
  assert.ok(boxes(f).includes("You tell the guard who you suspect of the crime."), "a messagebox (tick 242: mesbox)");
});

test("accusing one of the family: Anna, Carol or Elizabeth; Bob, David or Frank, each with the box (ticks 394-560)", async (t) => {
  const f = actor(t, { at: [2741, 3560, 0], stage: S.STARTED });
  const guard = h.spawn(f, N.GUARD, [2741, 3561, 0]);
  const lines = await play(f, () => h.talk(f, guard), ["I know who did it!", "It was one of his family!", "It was one of the men...", "If it wasn't Frank I'll eat my shoes!"]);
  assert.deepEqual(lines.slice(4, 11), [
    "PLAYER: It was one of his family!",
    "Guard: Oh really? Which one?",
    "MENU[Select an option]: It was one of the women...|It was one of the men...",
    "PLAYER: It was one of the men...",
    "Guard: Oh really? Which one?",
    "MENU[Select an option]: I'm certain it was Bob.|It was David. No doubt about it.|If it wasn't Frank I'll eat my shoes!",
    "StatementDialogue: You tell the guard who you suspect of the crime.",
  ]);
  assert.equal(lines.at(-1), "Guard: Tch. You wouldn't last a day in the guards with sloppy thinking like that. Come see me when you have some proof of your accusations.");
});

// ------------------------------------------------------------------ Questioning

test("Bob without the thread has two questions; with it the thread question too (ticks 575, 1015)", async (t) => {
  const f = actor(t, { at: [2748, 3558, 0], stage: S.STARTED });
  const bob = h.spawn(f, N.BOB, [2748, 3559, 0]);
  const without = await play(f, () => h.talk(f, bob), ["Where were you when the murder happened?"]);
  assert.deepEqual(without, [
    "PLAYER: I'm here to help the guards with their investigation.",
    "Bob: I suppose I had better talk to you then.",
    "MENU[Select an option]: Who do you think was responsible?|Where were you when the murder happened?",
    "PLAYER: Where were you when the murder happened?",
    "Bob: I was walking by myself in the garden.",
    "PLAYER: And can anyone vouch for that?",
    "Bob: No. But I was.",
  ]);
  f.player.getInventory().add(new h.core.Item(I.CRIMINALS_THREAD_3, 1), false);
  const held = await play(f, () => h.talk(f, bob), ["Do you recognise this thread?"]);
  assert.equal(held[2], "MENU[Select an option]: Who do you think was responsible?|Where were you when the murder happened?|Do you recognise this thread?");
  assert.deepEqual(held.slice(3), [
    "PLAYER: Do you recognise this thread?",
    "StatementDialogue: You show him the thread you discovered.",
    "Bob: It's some thread. great clue. No, really.",
  ], "the thread isn't red: Frank's is blue");
});

test("the blue thread: Frank's trousers, Elizabeth's 'Looks like Blue thread to me.' (ticks 1033-1036, 1328-1333)", async (t) => {
  const f = actor(t, { at: [2742, 3576, 0], stage: S.STARTED, items: [[I.CRIMINALS_THREAD_3]] });
  const frank = h.spawn(f, N.FRANK, [2742, 3577, 0]);
  const lines = await play(f, () => h.talk(f, frank), ["Do you recognise this thread?"]);
  assert.deepEqual(lines.slice(4), [
    "PLAYER: Do you recognise this thread?",
    "StatementDialogue: Frank examines the thread from the crime scene.",
    "Frank: It kind of looks like the same material as my trousers are made of... same colour anyway. Think it's worth anything? Can I have it? Or just some money?",
  ]);
  f.player.setLocation(new h.core.Location(2746, 3580, 1));
  const elizabeth = h.spawn(f, N.ELIZABETH, [2746, 3581, 1]);
  const hers = await play(f, () => h.talk(f, elizabeth), ["Do you recognise this thread?"]);
  assert.deepEqual(hers.slice(3), [
    "PLAYER: Do you recognise this thread?",
    "StatementDialogue: You show her the thread from the study window.",
    "Elizabeth: Looks like Blue thread to me. If you can't work that out for yourself I don't hold much hope of you solving this crime.",
    "PLAYER: It looks a lot like the material your trousers are made of doesn't it?",
    "Elizabeth: I suppose it does. So what?",
  ]);
});

test("Carol's red thread answer belongs to the red thread: Frank's blue one gets the Wiki's other line (tick 1185)", async (t) => {
  const f = actor(t, { at: [2734, 3580, 1], stage: S.STARTED, items: [[I.CRIMINALS_THREAD_3]] });
  const carol = h.spawn(f, N.CAROL, [2734, 3581, 1]);
  const lines = await play(f, () => h.talk(f, carol), ["Do you recognise this thread?"]);
  assert.deepEqual(lines.slice(-2), [
    "StatementDialogue: You show Carol the thread found at the crime scene.",
    "Carol: It's some thread. Sorry, do you have a point here? Or do you just enjoy wasting peoples time?",
  ]);
  const red = actor(t, { at: [2734, 3580, 1], stage: S.STARTED, murderer: SUSPECT.BOB, items: [[I.CRIMINALS_THREAD]] });
  const carol2 = h.spawn(red, N.CAROL, [2734, 3581, 1]);
  const reds = await play(red, () => h.talk(red, carol2), ["Do you recognise this thread?"]);
  assert.equal(reds.at(-1), "Carol: It's some red thread... it kind of looks like the Same material as my trousers. But obviously it's not.");
});

test("Mary's crying is a box (tick 1208); servants before the quest snub the player", async (t) => {
  const f = actor(t, { at: [2734, 3575, 1], stage: S.STARTED });
  const mary = h.spawn(f, N.MARY, [2734, 3576, 1]);
  const lines = await play(f, () => h.talk(f, mary), ["Where were you at the time of the murder?"]);
  assert.equal(lines.at(-1), "StatementDialogue: She seems to be on the verge of crying. You decide not to push her anymore for details.");
  const fresh = actor(t, { at: [2734, 3574, 0] });
  const hobbes = h.spawn(fresh, N.HOBBES, [2734, 3575, 0]);
  assert.deepEqual(await play(fresh, () => h.talk(fresh, hobbes)), ["Hobbes: This is private property! Please leave!"]);
});

test("Gossip's hints are one of three (ticks 818-828; the Wiki's poison salesman hint)", async (t) => {
  const f = actor(t, { at: [2742, 3558, 0], stage: S.STARTED });
  const gossip = h.spawn(f, N.GOSSIP, [2742, 3559, 0]);
  const seen = new Set();
  const random = Math.random;
  t.after(() => { Math.random = random; });
  for (const roll of [0.1, 0.5, 0.9]) {
    Math.random = () => roll;
    const lines = await play(f, () => h.talk(f, gossip), ["I am so confused about who did it."]);
    seen.add(lines[5]);
  }
  Math.random = random;
  assert.deepEqual([...seen].sort(), [
    "Gossip: My father used to be in the guard. He always wrote himself notes on a piece of paper so he could keep track of information easily.",
    "Gossip: Well, I don't know if it's related, but I heard from that Poison Salesman in town that he sold some poison to one of the Sinclair family",
    "Gossip: Well, this might be of some help to you. My father was in the guards when he was younger,",
  ]);
});

// ------------------------------------------------------------------ The crime scene

test("the window: the box, then 'You take the thread.' and Frank's blue thread once it is continued (ticks 926-929)", async (t) => {
  const f = actor(t, { at: [2748, 3576, 0], stage: S.STARTED });
  await clickObject(f, LOC.WINDOW, 2);
  assert.equal(h.shown(f)?.text, "Some thread seems to have been caught on a loose nail on the window.");
  assert.equal(count(f, I.CRIMINALS_THREAD_3), 0, "nothing yet while the box shows (tick 928)");
  const shownAt = f.tick;
  await h.continueLine(f);
  assert.equal(count(f, I.CRIMINALS_THREAD_3), 1, "the thread (murderthreadb 1810, tick 929)");
  assert.equal(f.messages.find((m) => m.text === "You take the thread.")?.tick, shownAt + 1);
  assert.equal(f.player.getAttribute(A.EVIDENCE) & THREAD, THREAD);
  const from = f.tick + 1;
  await play(f, () => clickObject(f, LOC.WINDOW, 2));
  assert.deepEqual(boxes(f, from), [
    "Some thread seems to have been caught on a loose nail on the window.",
    "You have already taken the thread.",
  ]);
  f.player.getInventory().deleteNumber(I.CRIMINALS_THREAD_3, 1);
  const lost = await play(f, () => clickObject(f, LOC.WINDOW, 2));
  assert.equal(lost[1], "StatementDialogue: Lucky for you there's some thread left. You should be less careless in future.");
  assert.equal(count(f, I.CRIMINALS_THREAD_3), 1);
  f.messages.length = 0;
  await clickObject(f, LOC.WINDOW, 3);
  assert.deepEqual(messages(f), ["You don't want to damage evidence!"], "Break (tick 951)");
});

test("the window before the quest asks for the guards' permission; David's thread is green (1001958)", async (t) => {
  const f = actor(t, { at: [2748, 3576, 0] });
  await clickObject(f, LOC.WINDOW, 2);
  assert.deepEqual(messages(f), ["You need the guards' permission to do that."]);
  const david = actor(t, { at: [2748, 3576, 0], stage: S.STARTED, murderer: SUSPECT.DAVID });
  await play(david, () => clickObject(david, LOC.WINDOW, 2));
  assert.equal(count(david, I.CRIMINALS_THREAD_2), 1);
});

test("a full inventory: the thread drops, and picking it up from the ground only names its colour", async (t) => {
  const f = actor(t, { at: [2748, 3576, 0], stage: S.STARTED, items: [[I.COINS, 1], ...Array.from({ length: 27 }, () => [I.POT])] });
  await play(f, () => clickObject(f, LOC.WINDOW, 2));
  assert.equal(count(f, I.CRIMINALS_THREAD_3), 0);
  const ground = h.core.World.getItems().find((item) => item.getItem().getId() === I.CRIMINALS_THREAD_3);
  assert.ok(ground, "the thread is on the floor");
  t.after(() => h.core.World.getItems().splice(h.core.World.getItems().indexOf(ground), 1));
  f.player.getInventory().deleteNumber(I.POT, 1);
  const at = ground.getPosition();
  const lines = await play(f, () => f.connection.dispatch([{ type: "ground_item_action", itemId: I.CRIMINALS_THREAD_3, x: at.getX(), y: at.getY(), option: "Take" }]));
  assert.deepEqual(lines, ["StatementDialogue: Some blue thread. Not enough to be worth taking."]);
  assert.equal(count(f, I.CRIMINALS_THREAD_3), 0);
  assert.ok(h.core.World.getItems().includes(ground), "it stays where it is");
});

const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");

const { ItemOnGround, State: GroundState } = require("../dist/game/entity/impl/grounditem/ItemOnGround");

/** A fixed ground spawn, as GroundItemSpawnDefinitionLoader makes them (ground-items.json). */
function placeSpawn(t, itemId, [x, y, z = 0]) {
  const ground = new ItemOnGround(GroundState.SEEN_BY_EVERYONE, undefined, new h.core.Location(x, y, z), new h.core.Item(itemId, 1), false, 100, null, true);
  ItemOnGroundManager.register(ground);
  t.after(() => { const items = h.core.World.getItems(); if (items.includes(ground)) items.splice(items.indexOf(ground), 1); });
  return ground;
}

function placeOnGround(f, t, itemId, [x, y, z = 0]) {
  const ground = ItemOnGroundManager.registerLocation(f.player, new h.core.Item(itemId, 1), new h.core.Location(x, y, z), undefined, { goesGlobal: false });
  t.after(() => { const items = h.core.World.getItems(); if (items.includes(ground)) items.splice(items.indexOf(ground), 1); });
  return ground;
}

async function take(f, itemId, [x, y]) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  // The core spaces pickups 300 ms of wall time apart; the test's ticks take less.
  f.player.getLastItemPickup().elapsedTime = () => true;
  const before = messages(f).length;
  await f.connection.dispatch([{ type: "ground_item_action", itemId, x, y, option: "Take" }]);
  for (let i = 0; i < 15 && !h.shown(f) && messages(f).length === before; i++) h.tick(f);
}

test("the dagger and the pot: taken with their box, the ground item staying; then 'I already have the murder weapon.' (ticks 1046-1053)", async (t) => {
  const f = actor(t, { at: [2746, 3579, 0], stage: S.STARTED });
  const pot = placeSpawn(t, I.PUNGENT_POT, [2747, 3579]);
  const dagger = placeSpawn(t, I.CRIMINALS_DAGGER, [2746, 3578]);
  await take(f, I.PUNGENT_POT, [2747, 3579]);
  assert.equal(h.shown(f)?.text, "It seems like Lord Sinclair was drinking from this before he died.");
  assert.equal(count(f, I.PUNGENT_POT), 1, "with the box (tick 1048)");
  await h.continueLine(f);
  await take(f, I.CRIMINALS_DAGGER, [2746, 3578]);
  assert.equal(h.shown(f)?.text, "This knife doesn't seem sturdy enough to have killed Lord Sinclair.");
  assert.equal(count(f, I.CRIMINALS_DAGGER), 1, "with the box (tick 1050)");
  assert.equal(f.animations.length, 0, "no reach");
  await h.continueLine(f);
  assert.ok(h.core.World.getItems().includes(pot) && h.core.World.getItems().includes(dagger), "both stay on the table (no obj_del)");
  f.messages.length = 0;
  await take(f, I.CRIMINALS_DAGGER, [2746, 3578]);
  assert.deepEqual(messages(f), ["I already have the murder weapon."], "a chat line (tick 1053)");
  assert.equal(count(f, I.CRIMINALS_DAGGER), 1);
});

test("a barrel: its box, then the silver belonging once continued; a second search 'I already have' (ticks 1467-1469)", async (t) => {
  const f = actor(t, { at: [2747, 3578, 1], stage: S.STARTED });
  await clickObject(f, LOC.BARREL_F, 2);
  assert.equal(h.shown(f)?.text, "There's something shiny hidden at the bottom. You take Frank's silver pot.");
  assert.equal(count(f, I.SILVER_POT), 0, "not with the box (tick 1468)");
  await h.continueLine(f);
  assert.equal(count(f, I.SILVER_POT), 1, "on its continue (tick 1469)");
  f.messages.length = 0;
  await clickObject(f, LOC.BARREL_F, 2);
  for (let i = 0; i < 3; i++) h.tick(f);
  assert.deepEqual(messages(f), ["I already have Frank's pot."]);
  const fresh = actor(t, { at: [2733, 3576, 0] });
  await clickObject(fresh, LOC.BARREL_A, 2);
  assert.deepEqual(messages(fresh), ["I need the guards' permission to do that."]);
});

test("the sacks: 'Should I take it?', Yes gives the flypaper with its box, No leaves it (ticks 1415-1436)", async (t) => {
  const f = actor(t, { at: [2731, 3581, 0], stage: S.STARTED });
  const no = await play(f, () => clickObject(f, LOC.SACKS, 2), ["No, I don't see any need for it."]);
  assert.deepEqual(no, [
    "StatementDialogue: There's some flypaper in there. Should I take it?",
    "MENU[Select an option]: Yes, it might be useful.|No, I don't see any need for it.",
  ]);
  assert.ok(messages(f).includes("You leave the paper in the sack."), "a chat line (tick 1420)");
  await clickObject(f, LOC.SACKS, 2);
  await h.continueLine(f);
  await h.choose(f, "Yes, it might be useful.");
  assert.equal(h.shown(f)?.text, "You take a piece of fly paper. There is still plenty of fly paper left.");
  assert.equal(count(f, I.FLYPAPER), 1, "with the box (tick 1646)");
});

test("flour, flypaper and prints in the captured slots; a clear print goes on its box, the match keeps the suspect's (ticks 1556-1715)", async (t) => {
  const f = actor(t, { at: [2733, 3581, 0], stage: S.STARTED });
  const bag = f.player.getInventory();
  const set = (slot, id) => bag.setItem(slot, new h.core.Item(id, 1));
  set(0, I.COINS); set(7, I.POT); set(12, I.CRIMINALS_DAGGER); set(13, I.FLYPAPER); set(14, I.FLYPAPER);
  set(15, I.SILVER_CUP); set(16, I.SILVER_POT);
  for (let slot = 1; slot < 7; slot++) set(slot, I.BUCKET);
  for (let slot = 8; slot < 12; slot++) set(slot, I.BUCKET);
  bag.refreshItems();
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([{ type: "item_on_object", itemId: I.POT, slot: 7, widgetId: 149 << 16, objectId: LOC.FLOUR[0], x: LOC.FLOUR[1], y: LOC.FLOUR[2] }]);
  for (let i = 0; i < 5 && bag.getSlot(7) !== I.POT_OF_FLOUR; i++) h.tick(f);
  assert.equal(bag.getSlot(7), I.POT_OF_FLOUR, "the pot's own slot (tick 1557)");
  f.messages.length = 0;
  await use(f, I.POT_OF_FLOUR, I.CRIMINALS_DAGGER);
  assert.equal(bag.getSlot(7), I.CRIMINALS_DAGGER_2, "the dusted dagger takes the flour's slot (tick 1562)");
  assert.equal(bag.getSlot(12), I.POT, "the empty pot the dagger's");
  assert.deepEqual(messages(f), ["You sprinkle a small amount of flour on the murder weapon.", "The murder weapon is now coated with a thin layer of flour."]);
  f.messages.length = 0;
  await use(f, I.CRIMINALS_DAGGER_2, I.FLYPAPER);
  assert.equal(bag.getSlot(7), I.CRIMINALS_DAGGER, "the clean dagger first into a freed slot (tick 1566)");
  assert.equal(bag.getSlot(13), I.UNKNOWN_PRINT, "then the print into the first flypaper's");
  assert.equal(bag.getSlot(14), I.FLYPAPER);
  assert.deepEqual(messages(f), ["You use the flypaper on the floury dagger.", "You have a clean impression of the murderer's finger prints."]);
  // Bob's cup: flour from the pot in slot 12, the cup dusted into it.
  bag.setItem(12, new h.core.Item(I.POT_OF_FLOUR, 1)); bag.refreshItems();
  await use(f, I.SILVER_CUP, I.POT_OF_FLOUR);
  assert.equal(bag.getSlot(12), I.SILVER_CUP_2, "the flour's slot (tick 1580, used the other way round)");
  assert.equal(bag.getSlot(15), I.POT);
  await use(f, I.FLYPAPER, I.SILVER_CUP_2);
  assert.equal(count(f, I.BOBS_PRINT), 1);
  f.messages.length = 0;
  await use(f, I.BOBS_PRINT, I.UNKNOWN_PRINT);
  assert.equal(h.shown(f)?.text, "They don't seem to be the same. I guess that clears Bob of the crime. You destroy the useless fingerprint.");
  assert.equal(count(f, I.BOBS_PRINT), 1, "still there while the box shows (tick 1666)");
  await h.continueLine(f);
  assert.equal(count(f, I.BOBS_PRINT), 0, "destroyed on its continue (tick 1668)");
  // Frank's pot: dusted, lifted, matched.
  bag.setItem(15, new h.core.Item(I.POT_OF_FLOUR, 1)); bag.setItem(20, new h.core.Item(I.FLYPAPER, 1)); bag.refreshItems();
  await use(f, I.POT_OF_FLOUR, I.SILVER_POT);
  await use(f, I.FLYPAPER, I.SILVER_POT_2);
  const unknown = slotOf(f, I.UNKNOWN_PRINT);
  f.messages.length = 0;
  await use(f, I.FRANKS_PRINT, I.UNKNOWN_PRINT);
  assert.deepEqual(messages(f), ["The finger prints are an exact match to Frank's."], "a chat line (tick 1715)");
  assert.equal(bag.getSlot(unknown), I.KILLERS_PRINT, "the unknown print becomes the killer's in its slot");
  assert.equal(count(f, I.FRANKS_PRINT), 1, "Frank's print stays");
  assert.equal(f.player.getAttribute(A.EVIDENCE) & PRINTS, PRINTS);
});

test("flour on the pungent pot: the Wiki's two lines; on the barrel, the evidence line (Wiki)", async (t) => {
  const f = actor(t, { at: [2733, 3581, 0], stage: S.STARTED, items: [[I.POT_OF_FLOUR], [I.PUNGENT_POT]] });
  await use(f, I.POT_OF_FLOUR, I.PUNGENT_POT);
  assert.deepEqual(messages(f), ["You sprinkle a small amount of flour on the strange smelling pot.", "The surface isn't shiny enough to take a fingerprint from."]);
  assert.equal(count(f, I.POT_OF_FLOUR), 1);
  const slot = slotOf(f, I.PUNGENT_POT);
  await f.connection.dispatch([{ type: "item_on_object", itemId: I.PUNGENT_POT, slot, widgetId: 149 << 16, objectId: LOC.FLOUR[0], x: LOC.FLOUR[1], y: LOC.FLOUR[2] }]);
  for (let i = 0; i < 5 && !h.shown(f); i++) h.tick(f);
  assert.equal(h.shown(f)?.text, "You probably shouldn't use evidence from a crime scene to keep flour in...");
});

test("the guard dog's gate: its box during the quest and after it, the permission line before (ticks 912-913, 2355)", async (t) => {
  const f = actor(t, { at: [2749, 3578, 0], stage: S.STARTED });
  await clickObject(f, LOC.GATE, 1);
  assert.equal(h.shown(f)?.text, "As you approach the gate the guard dog starts barking loudly at you. There is no way an intruder could have committed the murder. It must have been someone the dog knew to get past it quietly.");
  const done = actor(t, { at: [2749, 3578, 0], stage: S.COMPLETE });
  await clickObject(done, LOC.GATE, 1);
  assert.ok(h.shown(done)?.text.startsWith("As you approach the gate"));
  const fresh = actor(t, { at: [2749, 3578, 0] });
  await clickObject(fresh, LOC.GATE, 1);
  assert.deepEqual(messages(fresh), ["I need the guards' permission to do that."]);
});

// ------------------------------------------------------------------ The poison

const SALESMAN_TILE = [2697, 3496, 0];

test("the salesman: his intro and menu, then straight to the menu once he has named the buyers (ticks 1867-1906)", async (t) => {
  const f = actor(t, { at: [2697, 3495, 0], stage: S.STARTED });
  const salesman = h.spawn(f, N.SALESMAN, SALESMAN_TILE);
  const first = await play(f, () => h.talk(f, salesman), ["Who did you sell Poison to at the house?"]);
  assert.deepEqual(first.slice(0, 3), [
    "PLAYER: I'm investigating the murder at the Sinclair house.",
    "Poison Salesman: There was a murder at the Sinclair House??? That's terrible! And I was only there the other day too! They bought the last of my Patented Multi Purpose Poison!",
    "MENU[Select an option]: Patented Multi Purpose Poison?|Who did you sell Poison to at the house?|Can I buy some Poison?|I have this pot I found at the murder scene...",
  ]);
  assert.equal(f.player.getAttribute(A.POISON), 1, "the buyers named");
  const again = await play(f, () => h.talk(f, salesman), ["Can I buy some Poison?"]);
  assert.deepEqual(again.slice(0, 3), [
    "MENU[Select an option]: Patented Multi Purpose Poison?|Who did you sell Poison to at the house?|Can I buy some Poison?|I have this pot I found at the murder scene...",
    "PLAYER: Can I buy some Poison?",
    "Poison Salesman: I'm afraid I am totally out of stock at the moment after my successful trip to the Sinclairs' House the other day.",
  ], "no intro (tick 1897)");
});

test("with The Fremennik Trials under way he asks which quest; the Trials option is that quest's own talk (ticks 1834-1857)", async (t) => {
  const f = actor(t, { at: [2697, 3495, 0], stage: S.STARTED, poison: 1 });
  h.quest("fremennik_trials").setStage(f.player, 2);
  const salesman = h.spawn(f, N.SALESMAN, SALESMAN_TILE);
  const mine = await play(f, () => h.talk(f, salesman), ["Talk about the Murder Mystery Quest"]);
  assert.deepEqual(mine, [
    "MENU[Select an option]: Talk about the Murder Mystery Quest|Talk about the Fremennik Trials",
    "MENU[Select an option]: Patented Multi Purpose Poison?|Who did you sell Poison to at the house?|Can I buy some Poison?|I have this pot I found at the murder scene...",
  ], "straight to his menu (tick 1895)");
  h.core.MultiChatboxPrompt.clear?.(f.player);
  f.player.getPacketSender().sendInterfaceRemoval();
  const theirs = await play(f, () => h.talk(f, salesman), ["Talk about the Fremennik Trials"]);
  assert.equal(theirs[0], "MENU[Select an option]: Talk about the Murder Mystery Quest|Talk about the Fremennik Trials");
  assert.deepEqual(theirs.slice(1, 3), [
    "PLAYER: Hello.",
    "Poison Salesman: Howdy! You seem like someone with discerning taste! Howsabout you try my brand new range of alcohol?",
  ], "The Fremennik Trials' own talk, its menu not asked again");
});

test("Frank's story, then the crest: dirty, the poison proof (ticks 2010-2012, 2209-2219); an innocent's place smells of poison", async (t) => {
  const f = actor(t, { at: [2742, 3576, 0], stage: S.STARTED, poison: 1 });
  f.messages.length = 0;
  const frank = h.spawn(f, N.FRANK, [2742, 3577, 0]);
  f.player.setLocation(new h.core.Location(LOC.CREST[1], LOC.CREST[2] - 1, 0));
  await clickObject(f, LOC.CREST, 2);
  assert.deepEqual(messages(f), ["The Sinclair Family Crest is hung up here."], "before his story (tick 958)");
  f.player.setLocation(new h.core.Location(2742, 3576, 0));
  const lines = await play(f, () => h.talk(f, frank), ["Why'd you buy poison the other day?"]);
  assert.equal(lines[3], "MENU[Select an option]: Who do you think was responsible?|Where were you when the murder happened?|Do you recognise this thread?|Why'd you buy poison the other day?");
  assert.equal(f.player.getAttribute(A.STORIES) & (1 << SUSPECT.FRANK), 1 << SUSPECT.FRANK);
  f.player.setLocation(new h.core.Location(LOC.CREST[1], LOC.CREST[2] - 1, 0));
  await clickObject(f, LOC.CREST, 2);
  assert.equal(h.shown(f)?.text, "It looks like the Sinclair family crest but it is very dirty. You can barely make it out under all of the grime. It's certainly clear nobody's cleaned it recently.");
  assert.equal(f.player.getAttribute(A.POISON), 3, "the poison proof");
  await h.continueLine(f);
  // The drain is a ground loc outside the kitchen, stood on from the path (t965-966).
  const carol = actor(t, { at: [2738, 3572, 0], stage: S.STARTED, poison: 1, stories: 1 << SUSPECT.CAROL });
  await clickObject(carol, LOC.DRAIN, 2);
  assert.equal(h.shown(carol)?.text, "The drain seems to have been recently cleaned. You can still smell the faint aroma of poison.");
  assert.equal(carol.player.getAttribute(A.POISON), 1, "no proof from an innocent's place");
  const guilty = actor(t, { at: [2738, 3572, 0], stage: S.STARTED, murderer: SUSPECT.CAROL, poison: 1, stories: 1 << SUSPECT.CAROL });
  await clickObject(guilty, LOC.DRAIN, 2);
  assert.equal(h.shown(guilty)?.text, "The drain is totally blocked. It really stinks. No, it REALLY smells bad. It's certainly clear nobody's cleaned it recently.", "1001930 t2233");
});

// ------------------------------------------------------------------ The guard and the hand-in

test("the thread alone: 'I know who did it!' goes straight to the servants' proof, with the thread box (ticks 1074-1078)", async (t) => {
  const f = actor(t, { at: [2739, 3576, 0], stage: S.STARTED, evidence: THREAD, items: [[I.CRIMINALS_THREAD_3]] });
  const guard = h.spawn(f, N.HOUSE_GUARD, [2739, 3577, 0]);
  const lines = await play(f, () => h.talk(f, guard), ["I know who did it!"]);
  assert.deepEqual(lines, [
    "MENU[Select an option]: What should I be doing to help again?|How did Lord Sinclair die?|I know who did it!",
    "PLAYER: I know who did it!",
    "PLAYER: I have proof that it wasn't any of the servants!",
    "StatementDialogue: You show the guard the thread you found on the window.",
    "PLAYER: All the servants dress in black so it couldn't have been one of them.",
    "Guard: That's some good work there. I guess it wasn't a servant. You still haven't proved who did do it though.",
  ]);
});

function evidenced(t, murderer, thread, print) {
  return actor(t, {
    at: [2739, 3576, 0], stage: S.STARTED, murderer, evidence: THREAD | PRINTS, poison: 3, stories: 1 << murderer,
    items: [[I.COINS, 8729], [I.CRIMINALS_DAGGER], [thread], [I.PUNGENT_POT], [I.KILLERS_PRINT], [print], [I.BUCKET]],
  });
}

test("all the evidence, Frank: the guard's case, the evidence taken with the rewards (ticks 2232-2248)", async (t) => {
  const f = evidenced(t, SUSPECT.FRANK, I.CRIMINALS_THREAD_3, I.FRANKS_PRINT);
  f.player.getInventory().add(new h.core.Item(I.SILVER_POT, 1), false);
  const guard = h.spawn(f, N.HOUSE_GUARD, [2739, 3577, 0]);
  const positions = [];
  const sender = f.player.getPacketSender();
  const place = sender.sendInterfacePosition.bind(sender);
  sender.sendInterfacePosition = (uid, x, y) => { positions.push([uid, x, y]); return place(uid, x, y); };
  f.player.getBank(0).add(new h.core.Item(I.SILVER_NECKLACE, 1), false);
  const xp = f.player.getSkillManager().getExperience(Sk.CRAFTING);
  const lines = await play(f, () => h.talk(f, guard), ["I know who did it!"]);
  assert.deepEqual(lines.slice(1, 18), [
    "PLAYER: I know who did it!",
    "PLAYER: I have conclusive proof who the killer was.",
    "Guard: You do? That's excellent work. Let's hear it then.",
    "PLAYER: I don't think it was an intruder, and I don't think Lord Sinclair was killed by being stabbed.",
    "Guard: Hmmm? Really? Why not?",
    "PLAYER: Nobody heard the guard dog barking, which it would have if it had been an intruder who was responsible.",
    "PLAYER: Nobody heard any signs of a struggle either. I think the knife was there to throw suspicion away from the real culprit.",
    "Guard: Yes, that makes sense. But who did do it then?",
    "StatementDialogue: You prove to the guard the thread matches Frank's clothes.",
    "Guard: Yes, I'd have to agree with that... but we need more evidence!",
    "StatementDialogue: You prove to the guard Frank did not use poison on the Sinclair Crest.",
    "Guard: Excellent work - have you considered a career as a detective? But I'm afraid it's still not quite enough...",
    "StatementDialogue: You match Frank's finger prints with those on the dagger found in the body of Lord Sinclair.",
    "Guard: Yes. There's no doubt about it. It must have been Frank who killed his father. All of the guards must congratulate you on your excellent work in helping us to solve this case.",
    "Guard: We don't have many murders here in Gielinor and I'm afraid we wouldn't have been able to solve it by ourselves. We will hold her here under house arrest until such time as we bring her to trial.",  // the Wiki's line; the capture says "him" (t2245), a recorded difference
    "Guard: You have our gratitude, and I'm sure the rest of the family's as well, in helping to apprehend the murderer. I'll just take the evidence from you now.",
    "StatementDialogue: You hand over all the evidence.",
  ]);
  assert.equal(stage(f), S.COMPLETE, "varp 192 1 -> 2 (tick 2248)");
  assert.equal(configs(f, 195).at(-1), 0, "varp 195 6 -> 0");
  for (const id of [I.CRIMINALS_DAGGER, I.CRIMINALS_THREAD_3, I.PUNGENT_POT, I.SILVER_POT, I.KILLERS_PRINT, I.FRANKS_PRINT]) {
    assert.equal(count(f, id), 0, `the guard took ${id} (live a line earlier, tick 2247)`);
  }
  assert.equal(count(f, I.BUCKET), 1, "the rest stays");
  assert.equal(f.player.getBank(0).getAmount(I.SILVER_NECKLACE), 0, "the Wiki: a banked necklace disappears too");
  assert.equal(count(f, I.COINS), 10729, "2,000 coins (8,729 -> 10,729)");
  assert.equal(f.player.getSkillManager().getExperience(Sk.CRAFTING) - xp, 1406);
  for (let i = 0; i < 6; i++) h.tick(f);
  const texts = f.calls.filter((c) => c.name === "sendString").map((c) => String(c.args[0]));
  assert.ok(texts.includes("You have solved the Murder Mystery!"), "the scroll's title (153:4)");
  const model = f.calls.find((c) => c.name === "sendItemOnInterfaces" && c.args[0] === ((153 << 16) | 5));
  assert.equal(model?.args[1], I.CRIMINALS_DAGGER, "murderweapon on the scroll");
  assert.deepEqual(positions.at(-1), [(153 << 16) | 5, 78, 128], "placed at (78, 128)");
});

test("Carol: 'It must have been Carol who killed her father.' (1001930 t2364); a dropped thread keeps the guard to the partial menu", async (t) => {
  const f = evidenced(t, SUSPECT.CAROL, I.CRIMINALS_THREAD, I.CAROLS_PRINT);
  const guard = h.spawn(f, N.HOUSE_GUARD, [2739, 3577, 0]);
  const lines = await play(f, () => h.talk(f, guard), ["I know who did it!"]);
  assert.ok(lines.includes("Guard: We don't have many murders here in Gielinor and I'm afraid we wouldn't have been able to solve it by ourselves. We will hold her here under house arrest until such time as we bring her to trial."));
  assert.ok(lines.includes("Guard: Yes. There's no doubt about it. It must have been Carol who killed her father. All of the guards must congratulate you on your excellent work in helping us to solve this case."));
  assert.equal(stage(f), S.COMPLETE);
  const dropped = evidenced(t, SUSPECT.CAROL, I.CRIMINALS_THREAD, I.CAROLS_PRINT);
  dropped.player.getInventory().deleteNumber(I.CRIMINALS_THREAD, 1);
  const guard2 = h.spawn(dropped, N.HOUSE_GUARD, [2739, 3577, 0]);
  const partial = await play(dropped, () => h.talk(dropped, guard2), ["I know who did it!"]);
  assert.equal(partial[2], "MENU[Select an option]: I have proof that it wasn't any of the servants.|I have proof one of the family lied about the poison.|I have the finger prints of the culprit.");
  assert.equal(stage(dropped), S.STARTED);
});

test("after the quest: the house guard, the courtyard guard's own reply, the family and the servants (ticks 2257-2398)", async (t) => {
  const f = actor(t, { at: [2739, 3576, 0], stage: S.COMPLETE });
  const inside = await play(f, () => h.talk(f, h.spawn(f, N.HOUSE_GUARD, [2739, 3577, 0])));
  assert.deepEqual(inside, [
    "Guard: Excellent work on solving the murder! All of the guards I know are very impressed, and don't worry, we have the murderer under guard until they can be taken to trial.",
    "PLAYER: Is there anything else I can do?",
    "Guard: No, your work here is done.",
  ]);
  f.player.setLocation(new h.core.Location(2741, 3562, 0));
  const outside = await play(f, () => h.talk(f, h.spawn(f, N.GUARD, [2741, 3563, 0])));
  assert.deepEqual(outside.slice(1), [
    "PLAYER: Is there anything else I can do? Seems awfully quiet up at the house, considering their sibling has just been arrested.",
    "Guard: Nothing right now, we have it all under control.",
  ]);
  f.player.setLocation(new h.core.Location(2741, 3576, 0));
  assert.deepEqual(await play(f, () => h.talk(f, h.spawn(f, N.FRANK, [2742, 3577, 0]))), ["Frank: Apparently you aren't as stupid as you look."]);
  f.player.setLocation(new h.core.Location(2753, 3574, 0));
  assert.deepEqual(await play(f, () => h.talk(f, h.spawn(f, N.PIERRE, [2753, 3575, 0]))), ["Pierre: Thank you for all your help in solving the murder."], "tick 2351");
  f.player.setLocation(new h.core.Location(2697, 3495, 0));
  const salesman = await play(f, () => h.talk(f, h.spawn(f, N.SALESMAN, SALESMAN_TILE)));
  assert.deepEqual(salesman, ["Poison Salesman: I hear you're pretty smart to have solved the Sinclair Murder!"], "tick 2512");
});

test("the journal: the struck story, the request, and the thread, weapon and pot lines in fixed places (ticks 946, 1732)", (t) => {
  const f = actor(t, { at: [2739, 3576, 0], stage: S.STARTED, items: [[I.CRIMINALS_THREAD_3]] });
  const lines = h.quest().buildJournal(f.player, h.quest(), {});
  assert.deepEqual(lines, [
    "<str>Lord Sinclair, a prominent nobleman, had been horribly",
    "<str><str>murdered at his mansion. The guards had been sent to",
    "<str><str>investigate his murder, but have been completely stuck.",
    "<col=000080>One of the <col=800000>guards<col=000080> has asked me for my help in solving the",
    "<col=000080><col=000080>murder. I should <col=800000>examine the crime scene<col=000080> very closely for",
    "<col=000080><col=000080>evidence, and <col=800000>interrogate everybody<col=000080> in the area carefully",
    "",
    "<col=000080>I have found some <col=800000>coloured thread<col=000080>. It might be useful.",
    "",
    "",
  ]);
  f.player.getInventory().add(new h.core.Item(I.CRIMINALS_DAGGER, 1), false);
  f.player.getInventory().add(new h.core.Item(I.PUNGENT_POT, 1), false);
  const all = h.quest().buildJournal(f.player, h.quest(), {});
  assert.equal(all[8], "<col=000080>I have taken the <col=800000>murder weapon<col=000080>. I think it might help me.");
  assert.equal(all[9], "<col=000080>I have a <col=800000>strange smelling pot<col=000080>. It seems like a clue.");
});

// ------------------------------------------------------------------ Contracts the captures imply

test("the thread and the killer's print are enough: the dropped belongings, dagger and pot don't block the hand-in (1001958)", async (t) => {
  const f = actor(t, { at: [2739, 3576, 0], stage: S.STARTED, murderer: SUSPECT.DAVID, evidence: THREAD | PRINTS, poison: 3, stories: 1 << SUSPECT.DAVID,
    items: [[I.CRIMINALS_THREAD_2], [I.KILLERS_PRINT]] });
  const guard = h.spawn(f, N.HOUSE_GUARD, [2739, 3577, 0]);
  const lines = await play(f, () => h.talk(f, guard), ["I know who did it!"]);
  assert.ok(lines.includes("Guard: We don't have many murders here in Gielinor and I'm afraid we wouldn't have been able to solve it by ourselves. We will hold her here under house arrest until such time as we bring her to trial."), "the Wiki's line (1001958 t2138 says him: a recorded difference)");
  assert.equal(stage(f), S.COMPLETE);
});

test("the proof is checked again at 'You hand over all the evidence.': lost on the way, the guard takes nothing", async (t) => {
  const f = evidenced(t, SUSPECT.FRANK, I.CRIMINALS_THREAD_3, I.FRANKS_PRINT);
  const guard = h.spawn(f, N.HOUSE_GUARD, [2739, 3577, 0]);
  await h.talk(f, guard);
  await h.choose(f, "I know who did it!");
  for (let i = 0; i < 40 && !String(h.shown(f)?.text ?? "").startsWith("You have our gratitude"); i++) await h.continueLine(f);
  f.player.getInventory().deleteNumber(I.KILLERS_PRINT, 1);
  await play(f, null);
  assert.equal(stage(f), S.STARTED, "not completed");
  assert.equal(count(f, I.CRIMINALS_THREAD_3), 1, "nothing taken");
  assert.ok(!boxes(f).includes("You hand over all the evidence."));
});

test("a chat closed on 'Please accept this reward from the family!' keeps the evidence and the quest open", async (t) => {
  const f = evidenced(t, SUSPECT.FRANK, I.CRIMINALS_THREAD_3, I.FRANKS_PRINT);
  const guard = h.spawn(f, N.HOUSE_GUARD, [2739, 3577, 0]);
  await h.talk(f, guard);
  await h.choose(f, "I know who did it!");
  for (let i = 0; i < 40 && h.shown(f)?.text !== "Please accept this reward from the family!"; i++) await h.continueLine(f);
  assert.equal(h.shown(f)?.text, "Please accept this reward from the family!");
  f.player.getPacketSender().sendInterfaceRemoval();
  h.ticks(f, 3);
  assert.equal(stage(f), S.STARTED);
  assert.equal(count(f, I.KILLERS_PRINT), 1, "the evidence is still there for the next talk");
  const again = await play(f, () => h.talk(f, guard), ["I know who did it!"]);
  assert.ok(again.includes("StatementDialogue: You hand over all the evidence."));
  assert.equal(stage(f), S.COMPLETE);
});

test("an old save's poison progress 2 (the murderer told their story) still reads the murderer's place as told", async (t) => {
  const f = actor(t, { at: [LOC.CREST[1], LOC.CREST[2] - 1, 0], stage: S.STARTED, poison: 2 });
  await clickObject(f, LOC.CREST, 2);
  assert.ok(String(h.shown(f)?.text).startsWith("It looks like the Sinclair family crest but it is very dirty."));
  assert.equal(f.player.getAttribute(A.POISON), 3);
});

test("the barrel of flour before and after the quest; Take-from without a pot, and with a full bag's only pot (1001551, 1001930)", async (t) => {
  for (const value of [S.NOT_STARTED, S.COMPLETE]) {
    const f = actor(t, { at: [2733, 3581, 0], stage: value, items: [[I.POT]] });
    await clickObject(f, LOC.FLOUR, 2);
    assert.deepEqual(messages(f), ["A barrel full of finely sifted flour.", "You take some flour from the barrel.", "There's still plenty of flour left."]);
    assert.equal(count(f, I.POT_OF_FLOUR), 1);
  }
  const none = actor(t, { at: [2733, 3581, 0], stage: S.STARTED });
  await clickObject(none, LOC.FLOUR, 2);
  assert.deepEqual(messages(none), ["A barrel full of finely sifted flour.", "You need something to put the flour in."]);
  const full = actor(t, { at: [2733, 3581, 0], stage: S.STARTED, items: Array.from({ length: 27 }, () => [I.BUCKET]) });
  full.player.getInventory().add(new h.core.Item(I.POT, 1), false);
  const potSlot = slotOf(full, I.POT);
  await clickObject(full, LOC.FLOUR, 2);
  assert.equal(full.player.getInventory().getSlot(potSlot), I.POT_OF_FLOUR, "the pot's own slot");
});

test("flour in the higher slot: the dusted item still takes the lower slot, the pot the higher (1001958 t1660)", async (t) => {
  const f = actor(t, { at: [2733, 3581, 0], stage: S.STARTED });
  const bag = f.player.getInventory();
  for (let slot = 0; slot < 7; slot++) bag.setItem(slot, new h.core.Item(I.BUCKET, 1));
  bag.setItem(7, new h.core.Item(I.CRIMINALS_DAGGER, 1));
  for (let slot = 8; slot < 11; slot++) bag.setItem(slot, new h.core.Item(I.BUCKET, 1));
  bag.setItem(11, new h.core.Item(I.POT_OF_FLOUR, 1));
  bag.refreshItems();
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await use(f, I.POT_OF_FLOUR, I.CRIMINALS_DAGGER);
  assert.equal(bag.getSlot(7), I.CRIMINALS_DAGGER_2);
  assert.equal(bag.getSlot(11), I.POT);
});

test("after the quest the barrels, sacks and the crest ask for the guards' permission (the Wiki)", async (t) => {
  const f = actor(t, { at: [2733, 3576, 0], stage: S.COMPLETE });
  await clickObject(f, LOC.BARREL_A, 2);
  assert.deepEqual(messages(f), ["I need the guards' permission to do that."]);
  assert.equal(count(f, I.SILVER_NECKLACE), 0, "it cannot be obtained again");
  f.messages.length = 0;
  f.player.setLocation(new h.core.Location(LOC.CREST[1], LOC.CREST[2] - 1, 0));
  await clickObject(f, LOC.CREST, 2);
  assert.deepEqual(messages(f), ["I need the guards' permission to do that."]);
});

test("a close in the same turn as 'Talk about the Fremennik Trials' leaves the chat closed", async (t) => {
  const f = actor(t, { at: [2697, 3495, 0], stage: S.STARTED, poison: 1 });
  h.quest("fremennik_trials").setStage(f.player, 2);
  const salesman = h.spawn(f, N.SALESMAN, SALESMAN_TILE);
  await h.talk(f, salesman);
  const pending = h.MultiChatboxPrompt.getPending(f.player);
  const index = pending.options.indexOf("Talk about the Fremennik Trials");
  await f.connection.dispatch([
    { type: "dialogue_continue", widgetId: h.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 },
    { type: "interface_close" },
  ]);
  h.ticks(f, 4);
  assert.equal(h.shown(f), null, "nothing reopens");
});

test("a dropped dagger elsewhere, and a thread after the quest, are taken as any item (only the fixed spawns and the quest's thread are special)", async (t) => {
  const f = actor(t, { at: [2740, 3570, 0], stage: S.STARTED });
  const dropped = placeOnGround(f, t, I.CRIMINALS_DAGGER, [2740, 3570]);
  await take(f, I.CRIMINALS_DAGGER, [2740, 3570]);
  h.ticks(f, 2);
  assert.equal(count(f, I.CRIMINALS_DAGGER), 1);
  assert.ok(!h.core.World.getItems().includes(dropped) || dropped.isPendingRemoval(), "the drop is taken, no copy left");
  const done = actor(t, { at: [2740, 3570, 0], stage: S.COMPLETE });
  const thread = placeOnGround(done, t, I.CRIMINALS_THREAD_2, [2740, 3570]);
  await take(done, I.CRIMINALS_THREAD_2, [2740, 3570]);
  h.ticks(done, 2);
  assert.equal(count(done, I.CRIMINALS_THREAD_2), 1, "King's Ransom's thread");
  assert.ok(!h.core.World.getItems().includes(thread) || thread.isPendingRemoval());
});

test("a dagger the player dropped on the study's own spawn tile is taken as any item", async (t) => {
  const f = actor(t, { at: [2746, 3579, 0], stage: S.STARTED });
  const dropped = placeOnGround(f, t, I.CRIMINALS_DAGGER, [2746, 3578]);
  await take(f, I.CRIMINALS_DAGGER, [2746, 3578]);
  h.ticks(f, 2);
  assert.equal(count(f, I.CRIMINALS_DAGGER), 1);
  assert.ok(!h.core.World.getItems().includes(dropped) || dropped.isPendingRemoval(), "no copy left behind");
});

test("an old save at poison progress 3 (the proof found) still reads the murderer's place as told", async (t) => {
  const f = actor(t, { at: [LOC.CREST[1], LOC.CREST[2] - 1, 0], stage: S.STARTED, poison: 3 });
  await clickObject(f, LOC.CREST, 2);
  assert.ok(String(h.shown(f)?.text).startsWith("It looks like the Sinclair family crest but it is very dirty."));
});
