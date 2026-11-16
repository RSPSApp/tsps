// Run after `yarn build`: node --test tests/grand-tree-capture.test.cjs
//
// The Grand Tree against the whole-quest rsprox capture local 1002189 (revision 242.1; ticks 10173-12894,
// docs/quests/grand-tree/README.md). Real Player, PlayerSession and ClientConnection, the real plugins, cache and
// map: talks and clicks are packets, each tick runs as World.process does. Tick numbers are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "grand_tree";
const MESSAGEBOX = 229;
const OBJECTBOX = 193;
const DOUBLE_OBJECTBOX = 11;
const MESBOX = 115;
const PILOT_JOURNEY_VARP = 153;
const GLIDER_MAP = 138;

let I;
let N;
before(async () => {
  h.key = KEY;
  await h.setup([[2466, 3496], [2678, 3086], [2482, 3463], [2945, 3041], [3000, 3044], [2458, 3383], [2391, 3513],
    [2486, 3465], [2464, 9897], [2483, 9864], [2918, 3058], [2955, 3033], [2459, 3409], [2444, 9893]]);
  I = h.core.ItemIdentifiers;
  N = h.core.NpcIdentifiers;
});
after(() => h.teardown());

const stage = (f) => h.quest(KEY).getStage(f.player);
const at = (f) => { const l = f.player.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
const group = (f) => f.player.getPacketSender().getChatboxGroupId();
const has = (f, id) => f.player.getInventory().getAmount(id);
const messages = (f) => f.messages.map((m) => String(m.text));
const mesboxes = (f) => f.messages.filter((m) => m.type === MESBOX).map((m) => String(m.text));
const npcsNear = (f, id, radius = 12) => h.core.World.getNpcsNear(f.player.getLocation(), radius, f.player.getPrivateArea())
  .filter((npc) => npc.getId() === id);
const objectAt = (id, [x, y, z]) => h.core.MapObjects.get(id, new h.core.Location(x, y, z), null);

function actor(t, { stage: value = 0, items = [], tile = [2466, 3495, 0] } = {}) {
  const f = h.actor(t, { at: tile, done: [] });
  for (const skill of [h.core.Skill.AGILITY, h.core.Skill.ATTACK, h.core.Skill.DEFENCE, h.core.Skill.HITPOINTS]) {
    f.player.getSkillManager().setMaxLevels(skill, 99);
    f.player.getSkillManager().setCurrentLevel(skill, 99, false);
  }
  h.quest(KEY).setStage(f.player, value);
  for (const [id, count] of items) f.player.getInventory().add(new h.core.Item(id, count), false);
  return f;
}

/** Continues until `text` shows (a line, a box or a menu option), returning its tick. */
async function until(f, text, limit = 120) {
  for (let i = 0; i < limit; i++) {
    const line = h.shown(f);
    if (line?.text?.startsWith(text) || (line?.who === "menu" && line.text.includes(text))) return f.tick;
    if (line && line.who !== "menu") await h.continueLine(f);
    else h.tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

async function finish(f, limit = 60) {
  for (let i = 0; i < limit && h.shown(f); i++) {
    if (h.shown(f).who === "menu") return;
    await h.continueLine(f);
  }
}

/**
 * Continues the line showing and returns how many ticks pass until `text` shows, counted from the tick the
 * continue is handled in (the harness handles a packet on the tick after it is sent, live on the tick it came).
 */
async function gap(f, text, limit = 60) {
  const from = f.tick + 1;
  await h.continueLine(f);
  for (let i = 0; i < limit; i++) {
    if (h.shown(f)?.text?.startsWith(text)) return f.tick - from;
    h.tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-4))}`);
}

async function talk(f, id, tile) {
  const npc = h.spawn(f, id, tile);
  await h.talk(f, npc);
  return npc;
}

test("the start: the King's trapdoor, the offer below and the hand-over box that starts the quest (t10200-10356)", async (t) => {
  const f = actor(t, { tile: [2467, 3495, 0] });
  await talk(f, N.KING_NARNODE_SHAREEN, [2467, 3496, 0]);
  await until(f, "You seem worried, what's up?");
  await h.choose(f, "You seem worried, what's up?");
  await until(f, "Not here, follow me.");
  const from = f.tick + 1;
  await h.continueLine(f);
  h.ticks(f, 5);
  assert.ok(objectAt(2445, [2463, 3497, 0]), "the trapdoor opens with the King's 'Down here.' (t10209)");
  assert.ok(!messages(f).some((m) => m.includes("Down here.")), "said over his head, not to the chat");
  await until(f, "So what is this place?");
  assert.equal(f.tick - from, 18, "the talk below starts 18 ticks after the continue (t10204-10222)");
  assert.deepEqual(at(f), [2463, 9896, 0], "the player lands on 2463,9896 (t10216)");
  assert.ok(f.animations.some((a) => a.id === 827), "the reach into the trapdoor (t10215)");
  await until(f, "Yes.");
  await h.choose(f, "Yes.");
  assert.equal(stage(f), 0, "not started on Yes.");
  await until(f, "The king shows you a sample of bark.");
  assert.equal(group(f), OBJECTBOX);
  await until(f, "The king hands you the bark sample and the translation book.");
  assert.equal(group(f), DOUBLE_OBJECTBOX, "the hand-over is a double object box (t10338)");
  assert.equal(stage(f), 10, "varp 150 0 -> 10 with the hand-over box (t10338)");
  assert.equal(has(f, I.BARK_SAMPLE), 1);
  assert.equal(has(f, I.TRANSLATION_BOOK), 1);
  assert.ok(mesboxes(f).includes("The king hands you the bark sample and the translation book."));
  const started = messages(f).findIndex((m) => /^You've started a new quest: <col=[0-9a-f]{6}>The Grand Tree<\/col>$/.test(m));
  assert.ok(started >= 0 && started < messages(f).indexOf("The king hands you the bark sample and the translation book."),
    "the started-quest line comes just before the box's (t10338)");
  await until(f, "I'll show you the way back up.");
  const up = f.tick + 1;
  await h.continueLine(f);
  for (let i = 0; i < 12 && at(f)[1] > 4000; i++) h.tick(f);
  assert.deepEqual(at(f), [2464, 3497, 0], "back up beside the trapdoor (t10356)");
  assert.equal(f.tick - up, 10, "10 ticks after the continue (t10346-10356)");
  assert.ok(f.animations.some((a) => a.id === 828), "the climb up the ladder (t10355)");
});

test("Hazelmere: his message boxes, the sample taken as he examines it and the scroll with its box (t10562-10593)", async (t) => {
  const f = actor(t, { stage: 10, items: [[I.BARK_SAMPLE, 1], [I.TRANSLATION_BOOK, 1]], tile: [2677, 3086, 1] });
  await talk(f, 13610, [2678, 3086, 1]);
  await until(f, "The mage starts to speak but all you hear is:");
  assert.equal(group(f), MESSAGEBOX);
  await until(f, "You give the bark sample to Hazelmere.");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(stage(f), 10);
  await until(f, "The mage carefully examines the sample.");
  assert.equal(stage(f), 20, "varp 150 10 -> 20 with the examining box (t10574)");
  assert.equal(has(f, I.BARK_SAMPLE), 0);
  await until(f, "Hazelmere has given you the scroll.");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(has(f, I.HAZELMERES_SCROLL), 1);
});

test("the translation: five menus that only offer the right answers' options, stage 30 on the warning (t10767-10819)", async (t) => {
  const f = actor(t, { stage: 20, items: [[I.HAZELMERES_SCROLL, 1], [I.TRANSLATION_BOOK, 1]] });
  await talk(f, N.KING_NARNODE_SHAREEN, [2466, 3496, 0]);
  await until(f, "I think so!");
  await h.choose(f, "I think so!");
  const menus = [];
  for (const pick of ["None of the above.", "None of the above.", "A man came to me with the King's seal.",
    "I gave the man Daconia rocks.", "And Daconia rocks will kill the tree!"]) {
    await until(f, pick);
    menus.push(h.MultiChatboxPrompt.getPending(f.player).options);
    await h.choose(f, pick);
  }
  assert.deepEqual(menus.map((m) => m.length), [5, 5, 5, 5, 4]);
  assert.equal(menus[2].at(-1), "None of the above.", "no 'More...' page (t10773)");
  assert.ok(!menus[4].includes("The tree will die in five days!"), "the 'incorrectly' option is left out (t10787)");
  await until(f, "Can I help?");
  assert.equal(stage(f), 20);
  await until(f, "First I must warn the tree guardians.");
  assert.equal(stage(f), 30, "varp 150 20 -> 30 with this line (t10819)");
});

test("a wrong translation shows the incorrect options and the King doubts it; the stage stays", async (t) => {
  const f = actor(t, { stage: 20, items: [[I.HAZELMERES_SCROLL, 1]] });
  await talk(f, N.KING_NARNODE_SHAREEN, [2466, 3496, 0]);
  await until(f, "I think so!");
  await h.choose(f, "I think so!");
  await until(f, "Praise be to the great Zamorak!");
  await h.choose(f, "Praise be to the great Zamorak!");
  await until(f, "None of the above.");
  await h.choose(f, "None of the above.");
  await until(f, "Time passes us by.");
  assert.ok(!h.MultiChatboxPrompt.getPending(f.player).options.includes("A man came to me with the King's seal."));
  await h.choose(f, "Time passes us by.");
  await until(f, "Only Adamantite is any use.");
  await h.choose(f, "Only Adamantite is any use.");
  await until(f, "The tree will die in five days!");
  await h.choose(f, "The tree will die in five days!");
  await until(f, "Wait a minute! That doesn't sound like Hazelmere!");
  await finish(f);
  assert.equal(stage(f), 20);
});

test("Glough's message boxes and Charlie's stage line (t10875-10906, t11056)", async (t) => {
  const f = actor(t, { stage: 30, tile: [2481, 3463, 1] });
  await talk(f, 1424, [2482, 3463, 1]);
  await until(f, "The gnome is munching on a worm hole.");
  assert.equal(group(f), MESSAGEBOX);
  await until(f, "The gnome continues to eat.");
  assert.equal(group(f), MESSAGEBOX);
  await until(f, "Your type can't be trusted!");
  assert.equal(stage(f), 40);
  const c = actor(t, { stage: 50, tile: [2464, 3496, 3] });
  await talk(c, 122, [2464, 3495, 3]);
  await until(c, "Sounds like Glough is hiding something!");
  assert.equal(stage(c), 50);
  await until(c, "I don't know what he's up to.");
  assert.equal(stage(c), 60, "varp 150 50 -> 60 with this line (t11056)");
});

test("Glough's cupboard: Open swings it open a tick after the reach; Search finds the journal in its box (t11116-11119)", async (t) => {
  const f = actor(t, { stage: 60, tile: [2476, 3464, 1] });
  await h.clickObject(f, 2434, [2476, 3465], 1);
  assert.ok(f.animations.some((a) => a.id === 538), "the reach (t11116)");
  h.ticks(f, 2);
  assert.ok(objectAt(2435, [2476, 3465, 1]), "the open cupboard (t11117)");
  await h.clickObject(f, 2435, [2476, 3465], 2);
  assert.equal(group(f), OBJECTBOX);
  assert.equal(h.shown(f).text, "You've found Glough's Journal!");
  assert.equal(stage(f), 70);
  assert.equal(has(f, I.GLOUGHS_JOURNAL), 1);
  await h.clickObject(f, 2435, [2476, 3465], 3);
  h.ticks(f, 1);
  assert.ok(objectAt(2434, [2476, 3465, 1]), "Close shuts it again");
});

test("the arrest: the guard climbs up, the player is taken to the cell and the King comes and lets them out (t11147-11205)", async (t) => {
  const f = actor(t, { stage: 70, items: [[I.GLOUGHS_JOURNAL, 1]], tile: [2480, 3463, 1] });
  await talk(f, 1424, [2481, 3463, 1]);
  await until(f, "Guards! Guards!");
  assert.equal(await gap(f, "Come with me!"), 5, "the guard's line 5 ticks after the continue (t11147-11152)");
  assert.equal(npcsNear(f, 1433).length, 1, "the guard came up the ladder");
  assert.equal(await gap(f, "Traveller please accept my apologies!"), 20, "the King speaks 20 ticks later (t11154-11174)");
  assert.deepEqual(at(f), [2464, 3496, 3], "in the cell (t11167)");
  assert.ok(f.animations.some((a) => a.id === 828), "climbed the ladder with the guard (t11166)");
  assert.equal(npcsNear(f, N.KING_NARNODE_SHAREEN, 3).length >= 1, true, "the King at the cell door");
  assert.equal(await gap(f, "I don't think you can trust Glough"), 3, "the next line 3 ticks after the door opens (t11180-11183)");
  h.ticks(f, 4);
  assert.deepEqual(at(f), [2465, 3496, 3], "the player stepped out of the cell (t11182)");
  assert.equal(stage(f), 70);
  await until(f, "I'm afraid Glough has placed guards");
  assert.equal(stage(f), 80, "varp 150 70 -> 80 with this line (t11205)");
  await finish(f);
});

test("the glider out: the map draws the crash flight, the player lands at 2918,3058 and Errdo apologises (t11252-11256)", async (t) => {
  const f = actor(t, { stage: 80, tile: [2465, 3500, 3] });
  await talk(f, 6091, [2465, 3501, 3]);
  await until(f, "Take me to Karamja please!");
  await h.choose(f, "Take me to Karamja please!");
  await until(f, "Okay, you're the boss!");
  const m0 = f.messages.length;
  assert.equal(await gap(f, "Sorry about that."), 4, "Errdo speaks 4 ticks after the continue (t11252-11256)");
  assert.ok(f.calls.some((c) => c.name === "sendConfig" && c.args[0] === PILOT_JOURNEY_VARP && c.args[1] === 7), "pilot_journey 7");
  assert.deepEqual(at(f), [2918, 3058, 0]);
  assert.ok(!f.messages.slice(m0).some((m) => m.text === "You fly on the glider."), "no chat line for the flight");
});

test("the foreman takes the player to his office: the fade, 2955,3033 and his questions 21 ticks on; the lumber order box (t11400-11514)", async (t) => {
  const f = actor(t, { stage: 80, tile: [3001, 3044, 0] });
  await talk(f, N.FOREMAN, [3000, 3044, 0]);
  await until(f, "Hmm...in that case we'd better go to my office.");
  assert.equal(await gap(f, "Tell me again why you're here."), 21, "t11400-11421");
  assert.deepEqual(at(f), [2954, 3025, 0], "walked in from 2955,3033 (t11406-11417)");
  for (const pick of ["Sadly his wife is no longer with us!", "He loves worm holes.", "Anita."]) {
    await until(f, pick);
    await h.choose(f, pick);
  }
  await until(f, "The foreman has given you the lumber order.");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(stage(f), 90, "varp 150 80 -> 90 with the box (t11514)");
  assert.equal(has(f, I.LUMBER_ORDER), 1);
});

test("Femi sneaks the player in after the lumber order: her cart drops them at 2459,3409 (t11576-11614)", async (t) => {
  const f = actor(t, { stage: 90, items: [[I.LUMBER_ORDER, 1]], tile: [2458, 3382, 0] });
  await talk(f, N.FEMI, [2458, 3383, 0]);
  await until(f, "Jump in the back of the cart.");
  assert.equal(await gap(f, "Okay, traveller, you'd better get going."), 8, "t11606-11614");
  assert.deepEqual(at(f), [2459, 3409, 0]);
  assert.ok(f.animations.some((a) => a.id === 828), "the climb into the cart (t11613)");
  assert.equal(npcsNear(f, N.FEMI, 2).length >= 1, true, "Femi is beside the player inside");
});

test("Charlie's clue keeps the lumber order; Anita's key box; the chest keeps the key (t11723, t11870, t11988-11989)", async (t) => {
  const f = actor(t, { stage: 90, items: [[I.LUMBER_ORDER, 1]], tile: [2465, 3496, 3] });
  await talk(f, 122, [2464, 3495, 3]);
  await until(f, "Hmm... you could be in luck!");
  assert.equal(stage(f), 100, "varp 150 90 -> 100 with this line (t11723)");
  await finish(f);
  assert.equal(has(f, I.LUMBER_ORDER), 1);

  const a = actor(t, { stage: 100, tile: [2389, 3513, 1] });
  await talk(a, 7180, [2391, 3513, 1]);
  await until(a, "I suppose so.");
  await h.choose(a, "I suppose so.");
  await until(a, "Anita gives you a key.");
  assert.equal(group(a), OBJECTBOX);
  assert.equal(has(a, I.GLOUGHS_KEY), 1);

  const c = actor(t, { stage: 100, items: [[I.GLOUGHS_KEY, 1]], tile: [2482, 3463, 1] });
  await h.dispatch(c, { type: "item_on_object", objectId: 2436, x: 2482, y: 3462, itemId: I.GLOUGHS_KEY,
    slot: c.player.getInventory().getSlotForItemId(I.GLOUGHS_KEY), widgetId: 149 << 16 });
  for (let i = 0; i < 5 && stage(c) < 110; i++) h.tick(c);
  assert.ok(c.animations.some((x) => x.id === 536), "the reach into the chest (t11988)");
  assert.equal(stage(c), 110);
  assert.equal(group(c), OBJECTBOX);
  assert.equal(h.shown(c).text, "You have found a scroll!");
  assert.equal(has(c, I.INVASION_PLANS), 1);
  assert.equal(has(c, I.GLOUGHS_KEY), 1, "the key stays: the capture's player banks it after the quest");
  assert.ok(objectAt(2437, [2482, 3462, 1]), "the chest shows open (t11989)");
  h.ticks(c, 4);
  assert.ok(objectAt(2436, [2482, 3462, 1]), "and closes 4 ticks later (t11993)");
});

test("the King's twigs: the plans' box, then the twigs' box with the plans taken, slots O, Z, T, U (t12081-12117)", async (t) => {
  const f = actor(t, { stage: 110, items: [[I.INVASION_PLANS, 1]] });
  await talk(f, N.KING_NARNODE_SHAREEN, [2466, 3496, 0]);
  await until(f, "You give the King the invasion plans.");
  assert.equal(group(f), OBJECTBOX);
  await until(f, "The King has given you some twigs lashed together.");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(stage(f), 120);
  assert.equal(has(f, I.INVASION_PLANS), 0);
  const ids = f.player.getInventory().getItems().filter((item) => item && item.getId() > 0).map((item) => item.getId());
  assert.deepEqual(ids, [I.TWIGS_4, I.TWIGS_3, I.TWIGS, I.TWIGS_2]);
});

test("the pillars: each twig goes on with a reach and no chat line; the trapdoor snaps open a tick after the last (t12177-12203)", async (t) => {
  const f = actor(t, { stage: 120, items: [[I.TWIGS_4, 1], [I.TWIGS_3, 1], [I.TWIGS, 1], [I.TWIGS_2, 1]], tile: [2484, 3463, 1] });
  await h.clickObject(f, 2447, [2484, 3464], 1);
  h.ticks(f, 3);
  assert.deepEqual(at(f), [2486, 3465, 2], "the watchtower landing (t12169)");
  const m0 = f.messages.length;
  for (const [pillar, x, twig] of [[2440, 2485, I.TWIGS], [2441, 2486, I.TWIGS_2], [2442, 2487, I.TWIGS_3], [2443, 2488, I.TWIGS_4]]) {
    await h.dispatch(f, { type: "item_on_object", objectId: pillar, x, y: 3467, itemId: twig,
      slot: f.player.getInventory().getSlotForItemId(twig), widgetId: 149 << 16 });
    h.ticks(f, 3);
  }
  assert.equal(f.animations.filter((a) => a.id === 832).length, 4);
  assert.ok(!f.messages.slice(m0).some((m) => m.text === "You place the twig on the pillar."));
  assert.equal(stage(f), 130);
  assert.equal(h.shown(f)?.text, "With a grinding of machinery, a trapdoor snaps open!");
  // A logout right after the fourth twig keeps the stage: nothing is left for a cancelled task.
  const g = actor(t, { stage: 120, items: [[I.TWIGS_4, 1], [I.TWIGS_3, 1], [I.TWIGS, 1], [I.TWIGS_2, 1]], tile: [2486, 3466, 2] });
  const { TaskManager } = h.core;
  const submit = TaskManager.submit;
  try {
    for (const [pillar, x, twig] of [[2440, 2485, I.TWIGS], [2441, 2486, I.TWIGS_2], [2442, 2487, I.TWIGS_3], [2443, 2488, I.TWIGS_4]]) {
      // The fourth twig as the player logs out: every task keyed to them is dropped before it can run.
      if (pillar === 2443) TaskManager.submit = (task) => (task.key === g.player ? undefined : submit.call(TaskManager, task));
      await h.dispatch(g, { type: "item_on_object", objectId: pillar, x, y: 3467, itemId: twig,
        slot: g.player.getInventory().getSlotForItemId(twig), widgetId: 149 << 16 });
      h.ticks(g, 3);
    }
  } finally {
    TaskManager.submit = submit;
  }
  assert.equal(has(g, I.TWIGS_4), 0, "the fourth twig went on");
  assert.equal(stage(g), 130, "the stage is not lost to a logout on the next tick");
  assert.equal(group(f), MESSAGEBOX);
});

test("Glough's pet: the copy of the cave, his overheads, the demon and the real-cave fight (t12209-12400)", async (t) => {
  const f = actor(t, { stage: 130, tile: [2487, 3465, 2] });
  await h.clickObject(f, 2444, [2487, 3464], 1);
  h.ticks(f, 6);
  const area = f.player.getPrivateArea();
  assert.equal(typeof area?.toSource, "function", "a copy of the cave (t12213)");
  assert.deepEqual((({ x, y }) => [x, y])({ x: area.toSource(f.player.getLocation()).getX(), y: area.toSource(f.player.getLocation()).getY() }), [2491, 9864]);
  await until(f, "Glough?");
  assert.equal(npcsNear(f, N.GLOUGH, 20).length, 1, "Glough is in the passage");
  await until(f, "Fool... meet my little friend!");
  assert.equal(npcsNear(f, N.BLACK_DEMON_2, 20).length, 1, "the demon appears with his line (t12260)");
  await h.continueLine(f);
  h.ticks(f, 8);
  assert.equal(f.player.getPrivateArea()?.toSource, undefined, "the copy has ended (t12271)");
  assert.deepEqual(at(f), [2491, 9864, 0]);
  const [demon] = npcsNear(f, N.BLACK_DEMON_2, 20);
  assert.ok(demon, "the demon in the real cave (t12273)");
  assert.equal(stage(f), 130);
  demon.appendDeath();
  h.tick(f);
  assert.equal(stage(f), 140, "varp 150 130 -> 140 as the death animation starts (t12394), not at its removal");
  const [glough] = npcsNear(f, N.GLOUGH, 20);
  const sender = f.player.getPacketSender();
  const sent = [];
  for (const name of ["sendInterfaceRemoval", "mountSubInterface"]) {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { sent.push(name); return original(...args); };
  }
  h.tick(f);
  assert.equal(glough.getForcedChat(), "Mummy!", "a tick after the death animation (t12395)");
  h.ticks(f, 5);
  assert.deepEqual(sent, [], "no fade or closed interfaces when the scene ends after the fight");
  assert.equal(npcsNear(f, N.GLOUGH, 20).length, 0, "Glough is gone 5 ticks later (t12399)");
});

test("the King's guard: the chat closes between his lines for the captured ticks (t12499-12522)", async (t) => {
  const f = actor(t, { stage: 140, tile: [2465, 9898, 0] });
  await talk(f, N.KING_NARNODE_SHAREEN, [2464, 9898, 0]);
  await until(f, "Never! Not Glough!");
  assert.equal(await gap(f, "Guard!"), 1);
  assert.equal(await gap(f, "Sire!"), 9);
  await until(f, "Go and check out that passage!");
  assert.equal(await gap(f, "We found Glough hiding"), 5);
  await until(f, "A reward will have to wait though");
  assert.equal(stage(f), 150);
});

test("the Daconia rock is in one root drawn per player; its box shows first and the rock comes on the continue (t12586-12803)", async (t) => {
  const f = actor(t, { stage: 150, tile: [2467, 9873, 0] });
  await h.clickObject(f, 1986, [2467, 9872], 1);
  h.ticks(f, 2);
  const root = f.player.getAttribute("grand-tree:daconia-root");
  assert.match(String(root), /^\d+,\d+$/, "a root is drawn on the first search");
  assert.ok(f.animations.some((a) => a.id === 827));
  if (root !== "2467,9872") assert.ok(messages(f).includes("You search the root but don't find anything."));
  f.player.setAttribute("grand-tree:daconia-root", "2444,9893");
  f.player.moveTo(new h.core.Location(2445, 9893, 0));
  h.ticks(f, 2);
  await h.clickObject(f, 1986, [2444, 9893], 1);
  h.ticks(f, 2);
  assert.equal(h.shown(f)?.text, "You've found a Daconia rock!");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(has(f, I.DACONIA_ROCK), 0, "not in the inventory while the box shows (t12799)");
  await h.continueLine(f);
  h.ticks(f, 1);
  assert.equal(has(f, I.DACONIA_ROCK), 1, "in the inventory once it is continued (t12803)");
});

test("the end: the rock's box, completion on the last line and the scroll's captured lines (t12831-12894)", async (t) => {
  const f = actor(t, { stage: 150, items: [[I.DACONIA_ROCK, 1]], tile: [2465, 9898, 0] });
  await talk(f, N.KING_NARNODE_SHAREEN, [2464, 9898, 0]);
  await until(f, "You give the King the Daconia rock.");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(has(f, I.DACONIA_ROCK), 1, "kept until the quest completes (t12894)");
  await until(f, "You too, your highness!");
  await h.continueLine(f);
  h.ticks(f, 3);
  assert.equal(stage(f), 160);
  assert.equal(has(f, I.DACONIA_ROCK), 0);
  const strings = f.calls.filter((c) => c.name === "sendString").map((c) => c.args[0]);
  for (const line of ["5 Quest Points", "18,400 Attack XP", "7,900 Agility XP", "2,150 Magic XP", "Gnome Glider Access"]) {
    assert.ok(strings.includes(line), `the scroll writes "${line}"`);
  }
  assert.ok(!strings.includes("Access to the Grand Tree mine"));
});
