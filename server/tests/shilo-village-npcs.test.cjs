// Run after `yarn build`: node --test tests/shilo-village-npcs.test.cjs
//
// Shilo Village's people (quests/shilovillage/Npcs.ShiloVillage.js) against the user's rev 242 capture
// (RSProx capture ShiloVillage; docs/quests/shilo-village/README.md): Trufitus's greeting with the belt and
// without it, the start on his "adventuring." continue, stage 2 on "Erm, I don't know where to look?", his
// talks after the quest (16, 17); Mosol Rei's belt greeting; Yanni Salika's menu, quote and sales. Real
// packets, plugins, cache and map (shilo-village-harness.cjs).
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./shilo-village-harness.cjs");

const TRUFITUS = 4625;
const MOSOL = 8695;
const YANNI = 5361;
const BELT = 625;
const COINS = 995;
const BONE_KEY = 605;
const BEADS = 616;
const COMPLETE = 15;
const TRUFITUS_TILE = [2809, 3084];
const YANNI_TILE = [2835, 2985];

before(() => h.setup([TRUFITUS_TILE, [2880, 2952], YANNI_TILE]));
after(() => h.teardown());

const START_PICKS = [
  "Mosol gave me something to show you.",
  "Mosol Rei said something about a legend?",
  "Do you know anything more about the temple?",
  "Tell me more.",
  "I am going to search for Ah Za Rhoon!",
  "Yes.",
];

function trufitus(f) {
  return h.spawn(f, TRUFITUS, TRUFITUS_TILE);
}

test("Trufitus with the belt before the quest: 'Greetings.' and the Mosol Rei menu (t1643-1654)", async (t) => {
  const f = h.actor(t, { at: [2809, 3085], items: [BELT] });
  const said = await h.converse(f, () => h.talk(f, trufitus(f)), []);
  assert.deepEqual(said.slice(0, 5), [
    "PLAYER: Greetings.",
    "Trufitus: Greetings Bwana! You look like you have some serious news.",
    "PLAYER: Well, I think I may have. I have just spoken to Mosol Rei and he says that Rashiliyia has returned...",
    "Trufitus: Oh dear, it is more serious than I have imagined.",
    "MENU[Select an option]: What do you know about Rashiliyia?|What do you know about Mosol Rei?|Mosol gave me something to show you.",
  ]);
});

test("the start lands on the continue of 'adventuring.': varp 116 0 -> 1, the belt taken, the start line (t1926)", async (t) => {
  const f = h.actor(t, { at: [2809, 3085], items: [BELT] });
  const npc = trufitus(f);
  const said = await h.converse(f, () => h.talk(f, npc), START_PICKS);
  const adventuring = said.indexOf("Trufitus: adventuring.");
  assert.ok(adventuring > 0, said.join("\n"));
  assert.equal(said[adventuring + 1], "Trufitus: I'll hold on to this Wampum belt for you for the time being. I'll give it back to you when we have completed this quest.");
  assert.equal(h.stage(f), 1);
  assert.equal(f.player.getInventory().getAmount(BELT), 0, "Trufitus keeps the belt");
  assert.ok(h.lines(f).some((line) => /You've started a new quest: .*Shilo Village/.test(line)));
});

test("the start is not before the 'adventuring.' continue: at the Yes the stage is still 0", async (t) => {
  const g = h.actor(t, { at: [2809, 3085], items: [BELT] });
  const other = trufitus(g);
  await h.talk(g, other);
  const picks = [...START_PICKS];
  for (let i = 0; i < 200; i++) {
    const line = h.shown(g);
    if (!line) { h.tick(g); continue; }
    if (line.text === "adventuring.") break;
    if (line.who === "menu") await h.choose(g, picks.shift());
    else await h.continueLine(g);
  }
  assert.equal(h.shown(g)?.text, "adventuring.");
  assert.equal(h.stage(g), 0, "not started while the line is still up");
  assert.equal(g.player.getInventory().getAmount(BELT), 1);
});

test("Trufitus without the belt once greeted: 'Greetings once again Bwana,' (t1771); never greeted, not his Shilo talk", async (t) => {
  const f = h.actor(t, { at: [2809, 3085], items: [BELT] });
  const npc = trufitus(f);
  await h.converse(f, () => h.talk(f, npc), []);
  // Walk away from the menu (closes it), and drop the belt.
  f.player.getDialogueManager().reset();
  f.player.getPacketSender().sendInterfaceRemoval();
  h.tick(f);
  f.player.getInventory().deleteNumber(BELT, 1);
  const again = await h.converse(f, () => h.talk(f, npc), []);
  assert.deepEqual(again, ["Trufitus: Greetings once again Bwana,", "Trufitus: I have no more news since we last spoke."]);

  const stranger = h.actor(t, { at: [2809, 3085] });
  const other = await h.converse(stranger, () => h.talk(stranger, trufitus(stranger)), []);
  assert.equal(other.some((line) => /Greetings once again|serious news/.test(line)), false, other.join("\n"));
});

test("stage 2 comes from Trufitus's answer to 'Erm, I don't know where to look?' (t1935)", async (t) => {
  const f = h.actor(t, { at: [2809, 3085], stage: 1 });
  const said = await h.converse(f, () => h.talk(f, trufitus(f)), ["Erm, I don't know where to look?"]);
  assert.ok(said.some((line) => line.includes("'Magnificence Floating on Water'")), said.join("\n"));
  assert.equal(h.stage(f), 2);
});

test("Trufitus after the quest: the first talk sets 16, the second 17, then his subsequent line (t5788, t5794)", async (t) => {
  const f = h.actor(t, { at: [2809, 3085], stage: COMPLETE });
  const npc = trufitus(f);
  const first = await h.converse(f, () => h.talk(f, npc), []);
  assert.equal(first[0], "PLAYER: Greetings.");
  assert.match(first[1], /I conclude that you have been successful/);
  assert.equal(h.stage(f), 16);
  const second = await h.converse(f, () => h.talk(f, npc), []);
  assert.equal(second[0], "PLAYER: Hello!");
  assert.equal(h.stage(f), 17);
  const third = await h.converse(f, () => h.talk(f, npc), []);
  assert.equal(third[0], "PLAYER: Hello Bwana!");
  assert.equal(h.quest().isComplete(f.player), true, "16 and 17 are still complete");
});

test("Mosol Rei with the belt, and once started: 'Hey there Bwana, have you delivered that Wampum Belt...' (t1460, t2104)", async (t) => {
  for (const options of [{ items: [BELT] }, { stage: 2 }]) {
    const f = h.actor(t, { at: [2880, 2955], ...options });
    const mosol = h.spawn(f, MOSOL, [2880, 2954]);
    const talk = mosol.getCurrentDefinition(f.player).getActions().indexOf("Talk-to");
    const said = await h.converse(f, () => h.talk(f, mosol, talk + 1), []);
    assert.equal(said[0], "Mosol Rei: Hey there Bwana, have you delivered that Wampum Belt to Trufitus yet?", said.join("\n"));
    assert.equal(said[1], "MENU[Select an option]: Yes, of course!|Not yet, I've been busy.");
  }
  const fresh = h.actor(t, { at: [2880, 2955] });
  const mosol = h.spawn(fresh, MOSOL, [2880, 2954]);
  const talk = mosol.getCurrentDefinition(fresh.player).getActions().indexOf("Talk-to");
  const said = await h.converse(fresh, () => h.talk(fresh, mosol, talk + 1), []);
  assert.equal(said[0], "StatementDialogue: Mosol seems to be looking around very cautiously. He jumps a little when you approach and talk to him.");
});

function yanni(f) {
  return h.spawn(f, YANNI, [YANNI_TILE[0] + 1, YANNI_TILE[1]]);
}

test("Yanni Salika: Talk-to's antiques option plays his own branch; the quote counts the worn beads (t5497-5515, t5627)", async (t) => {
  const f = h.actor(t, { at: YANNI_TILE, stage: COMPLETE, beads: true });
  const said = await h.converse(f, () => h.talk(f, yanni(f)), ["Tell me about this antiques business.", "Yes please!"]);
  assert.match(said[0], /^MENU\[Select an option\]: Tell me about this antiques business\./);
  assert.ok(said.includes("StatementDialogue: Yanni looks through your items..."), said.join("\n"));
  assert.ok(said.includes("Yanni Salika: I'll give you 1000 coins for your 'Beads of the Dead'..."), said.join("\n"));
  assert.ok(said.includes("Yanni Salika: And that's the only item I am interested in. If you want to sell me that item, simply show it to me."));
});

test("Yanni Salika: 'Do you have any interesting items for sale?' with the beads: the game line, then 'Sorry, sir, ...' (t5534-5535)", async (t) => {
  const f = h.actor(t, { at: YANNI_TILE, stage: COMPLETE, beads: true });
  const said = await h.converse(f, () => h.talk(f, yanni(f)), ["Do you have any interesting items for sale?"]);
  assert.ok(h.lines(f).includes("Yanni won't sell you items that you've already got stored elsewhere."));
  assert.ok(said.includes("Yanni Salika: Sorry, sir, I have nothing that you need."), said.join("\n"));
});

test("Yanni Salika: shown the bone key he says his line, and on its continue pays 100 and says so (t5618-5619)", async (t) => {
  const f = h.actor(t, { at: YANNI_TILE, stage: COMPLETE, items: [BONE_KEY] });
  const npc = yanni(f);
  const slot = f.player.getInventory().getSlotForItemId(BONE_KEY);
  await h.dispatch(f, { type: "item_on_npc", targetIndex: npc.getIndex(), itemId: BONE_KEY, slot, widgetId: 3214 });
  for (let i = 0; i < 10 && !h.shown(f); i++) h.tick(f);
  assert.equal(h.shown(f)?.text, "That's a great bone key. Here's 100 coins for it.");
  assert.equal(f.player.getInventory().getAmount(BONE_KEY), 1, "still held while he speaks");
  assert.equal(f.player.getInventory().getAmount(COINS), 0);
  await h.continueLine(f);
  h.ticks(f, 2);
  assert.equal(f.player.getInventory().getAmount(BONE_KEY), 0);
  assert.equal(f.player.getInventory().getAmount(COINS), 100);
  assert.ok(h.lines(f).includes("You sell the bone key for 100 gold."));
});

test("Yanni Salika buys nothing before Shilo Village is complete", async (t) => {
  const f = h.actor(t, { at: YANNI_TILE, stage: 14, items: [BONE_KEY] });
  const npc = yanni(f);
  const slot = f.player.getInventory().getSlotForItemId(BONE_KEY);
  await h.dispatch(f, { type: "item_on_npc", targetIndex: npc.getIndex(), itemId: BONE_KEY, slot, widgetId: 3214 });
  h.ticks(f, 6);
  assert.notEqual(h.shown(f)?.text, "That's a great bone key. Here's 100 coins for it.");
  assert.equal(f.player.getInventory().getAmount(BONE_KEY), 1);
});

const BELT_PATH = ["Why do I need to run?", "Rashiliyia? Who is she?", "What can we do?", "Why are the undead here?",
  "Legend you say?", "Oh come on, you must know something.", "Maybe you know someone who does know something?",
  "I'll go to see the Shaman.", "Yes, I'm sure and I'll take the Wampum belt to Trufitus."];

test("Mosol Rei gives the Wampum belt with its box, played through his talk (t1440-1444); with no room it drops under the player", async (t) => {
  const f = h.actor(t, { at: [2880, 2952] });
  const mosol = h.spawn(f, 8695, [2880, 2953]);
  const said = await h.converse(f, () => h.talk(f, mosol, 1), BELT_PATH);
  const box = f.said.find((s) => s.text === "Mosol gives you a Wampum belt.");
  assert.ok(box, said.join("\n"));
  assert.equal(box.who, "ItemStatementDialogue");
  assert.equal(f.player.getInventory().getAmount(625), 1, "the belt in the inventory");

  const full = h.actor(t, { at: [2880, 2952] });
  while (full.player.getInventory().getFreeSlots() > 0) full.player.getInventory().add(new h.core.Item(1205, 1), false);
  const other = h.spawn(full, 8695, [2880, 2953]);
  await h.converse(full, () => h.talk(full, other, 1), BELT_PATH);
  assert.equal(full.player.getInventory().getAmount(625), 0);
  const here = full.player.getLocation();
  const dropped = h.core.ItemOnGroundManager.getGroundItem(full.player.getUsername(), 625, here, null);
  assert.ok(dropped, "on the floor under the player");
});

test("Trufitus before the start: until Jungle Potion's news is told, the belt doesn't take his Talk-to, nor mark him greeted", async (t) => {
  for (const junglePotion of [0, 3, 12]) {
    const f = h.actor(t, { at: [2809, 3085], done: [], items: [625] });
    h.quest("jungle_potion").setStage(f.player, junglePotion);
    const said = await h.converse(f, () => h.talk(f, trufitus(f)), []);
    assert.ok(!said.some((line) => line.includes("You look like you have some serious news")), `JP ${junglePotion}: ${said.join(" | ")}`);
    assert.equal(Number(f.player.getAttribute("shilo-village:trufitus-greeted")) || 0, 0, `JP ${junglePotion}: not greeted`);
  }
  const greeted = h.actor(t, { at: [2809, 3085], done: [], attributes: { "shilo-village:trufitus-greeted": 1 } });
  h.quest("jungle_potion").setStage(greeted.player, 3);
  const said = await h.converse(greeted, () => h.talk(greeted, trufitus(greeted)), []);
  assert.ok(!said.some((line) => line.includes("I have no more news since we last spoke")), said.join(" | "));
});
