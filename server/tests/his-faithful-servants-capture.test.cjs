// Run after `yarn build`: node --test tests/his-faithful-servants-capture.test.cjs
// His Faithful Servants against the user's rsprox capture of the whole miniquest
// (BarrowsMiniQuest.bin, revision 242.1): real Player, packets, plugins, cache and map
// (tests/quest-capture-harness.cjs). Ticks below are the capture's.
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "his_faithful_servants";
const OLD_MAN_TILE = [3574, 3295];
const DHAROK_MOUND = [3574, 3297];
const CHEST_ROOM = [3551, 9694, 0];
let I;
let Barrows;

before(async () => {
  await h.setup([[3565, 3288], [3551, 9694]]);
  I = h.core.ItemIdentifiers;
  Barrows = require("../plugins/minigames/Barrows.plugin");
});
after(() => h.teardown());

const hfs = () => h.quest(KEY);
function actor(t, { stage = 0, items = [], at = DHAROK_MOUND, attributes = {} } = {}) {
  const f = h.actor(t, { at: [...at, 0].slice(0, 3), done: ["priest_in_peril"], attributes });
  hfs().setStage(f.player, stage);
  for (const id of items) f.player.getInventory().add(new h.core.Item(id, 1), false);
  f.oldMan = h.spawn(f, h.core.NpcIdentifiers.STRANGE_OLD_MAN, OLD_MAN_TILE);
  return f;
}
const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);
const itemAction = (f, id, option) => h.dispatch(f, {
  type: "inventory_action", widgetId: h.core.CacheDefinitions.getComponentId("inventory:items"),
  itemId: id, slot: slotOf(f, id), option, optionIndex: 1,
});
const varbitsSent = (f, id) => f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === id).map((c) => c.args[1]);
const soundsSent = (f) => f.calls.filter((c) => c.name === "sendSoundEffect").map((c) => [c.args[0], c.args[2]]);
const startMessages = (f) => f.messages.filter((m) => /started a new|completed a quest|completed a miniquest/i.test(m.text));

test("HFS: a spade on a mound before the talk gets his line and no dig (tick 16)", async (t) => {
  const f = actor(t, { items: [I.SPADE] });
  await itemAction(f, I.SPADE, "Dig");
  h.ticks(f, 3);
  assert.deepEqual(f.said.map((s) => `${s.who}: ${s.text}`), ["Strange Old Man: You want to dig? Good, good! But we talk first. Talk then dig!"]);
  assert.deepEqual(f.animations.filter((a) => a.id === 830), [], "no dig sequence");
  assert.ok(!f.calls.some((c) => c.name === "sendSoundEffect" && c.args[0] === 1470), "no digspade sound");
  assert.ok(!f.messages.some((m) => m.text === "You've broken into a crypt!" || m.text === "Nothing interesting happens."));
  // Once it is started the mound digs as usual (the plane change is the Barrows plugin's process hook,
  // which this harness doesn't tick: barrows-run.test.cjs covers it).
  await h.continueLine(f);
  assert.equal(h.shown(f), null, "the line closes on continue");
  hfs().setStage(f.player, 2);
  await itemAction(f, I.SPADE, "Dig");
  h.ticks(f, 2);
  assert.ok(f.animations.some((a) => a.id === 830), "dig sequence");
  assert.ok(f.messages.some((m) => m.text === "You've broken into a crypt!"));
});

test("HFS: the talk starts it as 'Okay...' shows, with no chat line, and ends on the captured menu (ticks 66-84)", async (t) => {
  const f = actor(t, { at: [3573, 3296] });
  let stageAtOkay;
  const lines = await h.converse(f, () => h.talk(f, f.oldMan), ["I'll be back soon."]);
  const okay = f.said.find((s) => s.who === "PLAYER" && s.text === "Okay...");
  stageAtOkay = okay && f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === 14973 && c.tick <= okay.tick).map((c) => c.args[1]).at(-1);
  assert.equal(lines[0], "Strange Old Man: It's time.");
  assert.ok(lines.includes("PLAYER: Okay..."));
  assert.ok(lines.at(-1) === "PLAYER: I'll be back soon.", lines.at(-1));
  assert.equal(stageAtOkay, 2, "varbit 14973 is 2 by the time 'Okay...' shows");
  const beforeOkay = f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === 14973 && c.args[1] === 2);
  assert.ok(beforeOkay.every((c) => c.tick >= f.said.find((s) => s.text.startsWith("Yes! Do this!")).tick), "not before his last line");
  assert.equal(hfs().getStage(f.player), 2);
  assert.deepEqual(startMessages(f), [], "no start chat line in the capture");
});

test("HFS: the book (tick 93), the icon in the chest's loot (885), the hand-in, sounds, quiet completion and rewards (986-1083)", async (t) => {
  const f = actor(t, { stage: 2, at: [3573, 3296] });
  // Without the icon: the book, given into the inventory with its item box.
  let lines = await h.converse(f, () => h.talk(f, f.oldMan), ["Can you tell me more about the brothers?"]);
  assert.deepEqual(lines.slice(0, 3), ["Strange Old Man: Icon?", "PLAYER: I don't have it yet.", "Strange Old Man: Slow! No slow! Only fast! Fast dig! Dig, dig, dig!"]);
  assert.ok(lines.includes("ItemStatementDialogue: The Strange Old Man gives you a book."), JSON.stringify(lines));
  assert.equal(f.player.getInventory().getAmount(I.CRUMBLING_TOME), 1);
  lines = await h.converse(f, () => h.talk(f, f.oldMan), ["Can you tell me more about the brothers?"]);
  assert.ok(lines.includes("Strange Old Man: The brothers? His faithful servants! Book tell you more! Read it! Read it!"));
  assert.equal(f.player.getInventory().getAmount(I.CRUMBLING_TOME), 1, "no second book while one is carried");

  // The chest, all six brothers slain: the icon is the loot window's first item and the stage moves to 4.
  const home = f.player.getLocation().clone();
  f.player.setLocation(new h.core.Location(...CHEST_ROOM));
  const run = Barrows._test.getRun(f.player);
  run.killed = [0, 1, 2, 3, 4, 5];
  const sender = f.player.getPacketSender();
  const scripts = [];
  const script = sender.sendInterfaceScript.bind(sender);
  sender.sendInterfaceScript = (...args) => (scripts.push(args), script(...args));
  Barrows._test.searchChest(f.player, 1);
  Barrows._test.searchChest(f.player, 1);
  const window = scripts.find(([id]) => id === 1065)?.[4]?.[141];
  assert.equal(window?.slots?.[0]?.itemId, I.STRANGE_ICON, "slot 0 of trail_rewardinv");
  assert.equal(f.player.getInventory().getAmount(I.STRANGE_ICON), 1);
  assert.equal(hfs().getStage(f.player), 4);
  // A second chest gives no second icon.
  Barrows._test.getRun(f.player).looted = false;
  Barrows._test.searchChest(f.player, 1);
  assert.equal(f.player.getInventory().getAmount(I.STRANGE_ICON), 1);
  f.player.setLocation(home);

  f.calls.length = 0;
  const jingles = [];
  const jingle = sender.sendJingle.bind(sender);
  sender.sendJingle = (...args) => (jingles.push(args), jingle(...args));
  lines = await h.converse(f, () => h.talk(f, f.oldMan));
  assert.deepEqual(lines.slice(0, 4), ["Strange Old Man: Icon?", "PLAYER: Yes, I have it here.", "Strange Old Man: At last! Quick! Give it!",
    "ItemStatementDialogue: You give the icon to the Strange Old Man."]);
  assert.ok(lines.includes("ItemStatementDialogue: Before you can react, the Strange Old Man casts a spell. The icon disintegrates in his hands."));
  assert.ok(lines.includes("DoubleItemStatementDialogue: The Strange Old Man gives you a lamp and a map."));
  assert.equal(lines.at(-1), "PLAYER: Thanks... I guess.");
  assert.deepEqual(varbitsSent(f, 14973), [6, 8, 10]);
  assert.deepEqual(soundsSent(f).filter(([id]) => id === 3002 || id === 4759), [[3002, 0], [4759, 30]], "the spell's sounds (tick 997)");
  assert.equal(f.player.getInventory().getAmount(I.STRANGE_ICON), 0);
  assert.equal(f.player.getInventory().getAmount(I.DUSTY_LAMP), 1);
  assert.equal(f.player.getInventory().getAmount(I.CRYPT_MAP), 1);
  assert.equal(hfs().isComplete(f.player), true);
  assert.deepEqual(startMessages(f), [], "no completion chat line");
  // (The chest's Combat Achievement jingle, 76, can land now; the quest jingle is 238.)
  assert.deepEqual(jingles.filter(([id]) => id === 238), [], "no completion jingle");
  assert.ok(!f.calls.some((c) => c.name === "sendSubInterface" && [153, 625, 277].includes(c.args[1])), "no completion scroll");

  // Study the map (tick 1064): barrows_map 1. Rub the lamp (1074-1077): the prompt, then hfs_reward_lamp 1,
  // found_gem and the wish in a message box.
  f.calls.length = 0;
  await itemAction(f, I.CRYPT_MAP, "Study");
  assert.deepEqual(varbitsSent(f, 14975), [1]);
  assert.equal(f.player.getInventory().getAmount(I.CRYPT_MAP), 0);
  assert.equal(h.shown(f)?.text, "It's a map of the Barrows Crypt. You carefully study it and memorise all the details. You then discard it.");
  await h.continueLine(f);
  h.ticks(f, 2);
  const before = f.player.getSkillManager().getExperience(h.core.Skill.PRAYER);
  await itemAction(f, I.DUSTY_LAMP, "Rub");
  assert.equal(h.shown(f)?.title, "Use the lamp to receive 20,000 Prayer experience?");
  await h.choose(f, "Yes.");
  assert.deepEqual(varbitsSent(f, 14974), [1]);
  assert.ok(soundsSent(f).some(([id]) => id === 2655), "found_gem");
  assert.deepEqual(h.shown(f), { who: "StatementDialogue", text: "<col=0000ff>Your wish has been granted!</col> You have been awarded 20,000 Prayer experience!", npcId: undefined });
  assert.ok(f.player.getSkillManager().getExperience(h.core.Skill.PRAYER) > before);
  assert.equal(f.player.getInventory().getAmount(I.DUSTY_LAMP), 0);

  // Both bits come back at login.
  f.calls.length = 0;
  h.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.deepEqual([varbitsSent(f, 14974).at(-1), varbitsSent(f, 14975).at(-1)], [1, 1]);
});

test("HFS: the icon needs a free slot: a full inventory gets none and the stage stays (Wiki)", async (t) => {
  const f = actor(t, { stage: 2 });
  f.player.setLocation(new h.core.Location(...CHEST_ROOM));
  Barrows._test.getRun(f.player).killed = [0, 1, 2, 3, 4, 5];
  while (f.player.getInventory().getFreeSlots() > 0) f.player.getInventory().add(new h.core.Item(I.SHARK, 1), false);
  Barrows._test.searchChest(f.player, 1);
  Barrows._test.searchChest(f.player, 1);
  assert.equal(f.player.getInventory().getAmount(I.STRANGE_ICON), 0);
  assert.equal(hfs().getStage(f.player), 2);
});

test("HFS: asking about warnings plays the request, condenses them on his scream, and asks to undo once condensed (ticks 1028-1035)", async (t) => {
  const f = actor(t, { stage: 2, at: [3573, 3296] });
  let lines = await h.converse(f, () => h.talk(f, f.oldMan), ["I wanted to ask you about warnings."]);
  assert.deepEqual(lines.slice(4), [
    "PLAYER: I wanted to ask you about warnings.",
    "Strange Old Man: Yes?",
    "PLAYER: Currently when I'm trying to go plundering the catacombs here, my mind is plagued by several inconvenient warnings about the dangers below.",
    "PLAYER: I was wondering, do you know of a way to condense these warnings into a single one?",
    "Strange Old Man: AAAAAAAAARRRRRRGGGGGHHHHHHHH!",
    "PLAYER: I'm guessing that was a yes? In that case, thanks.",
  ]);
  assert.equal(f.player.getAttribute("barrows:warnings-condensed"), 1);
  const scream = f.said.find((s) => s.text === "AAAAAAAAARRRRRRGGGGGHHHHHHHH!");
  const toggled = f.calls.find((c) => c.name === "sendVarbit" && c.args[0] === 12434 && c.args[1] === 1);
  assert.ok(toggled && toggled.tick <= scream.tick, "barrows_warning_toggle 1 as the scream shows");
  lines = await h.converse(f, () => h.talk(f, f.oldMan), ["I wanted to ask you about warnings."]);
  assert.ok(lines.includes("PLAYER: Thanks for having those mental warnings I was having condensed into a single one, but I miss having them seperated."));
  assert.ok(!lines.some((line) => line.includes("Currently when I'm trying")));
  assert.equal(f.player.getAttribute("barrows:warnings-condensed"), 0);
  assert.deepEqual(varbitsSent(f, 12434).slice(-1), [0]);
});

test("HFS: after the miniquest his own chat's tunnel-warnings branch condenses them too (Wiki standard dialogue)", async (t) => {
  const f = actor(t, { stage: 10, at: [3573, 3296],
    attributes: { "his-faithful-servants:lamp-used": 1, "his-faithful-servants:crypt-map-studied": 1 } });
  const random = Math.random;
  Math.random = () => 0; // "Dialogue 1": the secret, then its menu
  t.after(() => { Math.random = random; });
  const lines = await h.converse(f, () => h.talk(f, f.oldMan), ["Ask about tunnel warnings."]);
  Math.random = random;
  assert.equal(lines[0], "Strange Old Man: Pst, wanna hear a secret?");
  assert.ok(lines.includes("Strange Old Man: AAAAAAAAARRRRRRGGGGGHHHHHHHH?"), JSON.stringify(lines));
  assert.ok(lines.includes("PLAYER: Strange Old Man, I was wondering if I could ask a favour of you."));
  assert.equal(f.player.getAttribute("barrows:warnings-condensed"), 1);
  assert.deepEqual(varbitsSent(f, 12434).slice(-1), [1]);
});

test("Barrows: the strange old lockpick used on a locked door across the room walks there, then through it (StrangeOldLockpickBarrows.bin tick 56)", async (t) => {
  // A walked-to door used to open and shut with the player left in front of it: walkToTile cleared the
  // crossing's step after the action (issue 4407's "a door now requires two clicks").
  const f = actor(t, { stage: 10, at: [3568, 9711] });
  const { getTunnelMap, getRun, doorSides } = Barrows._test;
  const door = getTunnelMap().doors.find((entry) => entry.x === 3568 && entry.y === 9718);
  const run = getRun(f.player);
  run.openDoors = run.openDoors.filter((id) => id !== door.varbit);
  run.pickedDoors = [];
  f.player.getInventory().add(new h.core.Item(I.STRANGE_OLD_LOCKPICK_FULL_, 1), false);
  Barrows._test.processPlayer({ player: f.player });
  await h.dispatch(f, { type: "item_on_object", widgetId: 3214, objectId: door.id, itemId: I.STRANGE_OLD_LOCKPICK_FULL_,
    slot: slotOf(f, I.STRANGE_OLD_LOCKPICK_FULL_), x: door.x, y: door.y });
  for (let i = 0; i < 14; i++) { h.tick(f); Barrows._test.processPlayer({ player: f.player }); }
  const [, far] = doorSides(door).sort((a, b) => a.getY() - b.getY());
  assert.ok(f.player.getLocation().equals(far), `through the doorway (${f.player.getLocation()})`);
  assert.equal(f.player.getInventory().getAmount(I.STRANGE_OLD_LOCKPICK), 1, "the full pick is now the used one");
  assert.ok(!f.messages.some((m) => m.text === "Nothing interesting happens." || m.text === "This door is locked."));
});

test("HFS: the icon needs a slot left once the loot is in; a stack already held takes none (Wiki: enough space)", async (t) => {
  const f = actor(t, { stage: 2 });
  const emit = (rewards) => { h.PM.emitCustomEvent?.("barrows:chest-rewards", { player: f.player, run: { killed: [0, 1, 2, 3, 4, 5] }, rewards });
    return rewards.map((item) => item.getId()); };
  const loot = () => [new h.core.Item(I.MIND_RUNE, 10), new h.core.Item(I.CHAOS_RUNE, 10)];
  const fillTo = (free) => { while (f.player.getInventory().getFreeSlots() > free) f.player.getInventory().add(new h.core.Item(I.SHARK, 1), false); };
  fillTo(2);
  assert.deepEqual(emit(loot()), [I.MIND_RUNE, I.CHAOS_RUNE], "two free slots, two new stacks: none left for the icon");
  assert.equal(hfs().getStage(f.player), 2);
  f.player.getInventory().add(new h.core.Item(I.MIND_RUNE, 1), false);
  fillTo(1);
  f.player.getInventory().deleteNumber(I.SHARK, 1);
  assert.equal(f.player.getInventory().getFreeSlots(), 2);
  assert.deepEqual(emit(loot()), [I.STRANGE_ICON, I.MIND_RUNE, I.CHAOS_RUNE], "the mind runes stack onto those held");
  assert.equal(hfs().getStage(f.player), 4);
});
