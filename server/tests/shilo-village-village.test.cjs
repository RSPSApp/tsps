// Run after `yarn build`: node --test tests/shilo-village-village.test.cjs
//
// Shilo Village's way in (quests/shilovillage/Village.ShiloVillage.js) against the user's rev 242 capture
// (RSProx capture ShiloVillage; docs/quests/shilo-village/README.md has the facts and ticks): the broken
// cart before and after the quest, the metal gate's cold-gate menu and its slow opening, the inner wooden
// gate, Mosol Rei's undead and his lead into the village, and the green mist. Real packets, plugins, cache
// and map (shilo-village-harness.cjs).
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./shilo-village-harness.cjs");

const CART = 2216;
const CART_TILE = [2877, 2951];
const ROAD = [2880, 2952];
const BY_THE_GATE = [2876, 2952];
const METAL_GATE = [2259, 2875, 2952];
const INNER_GATE = [2262, 2867, 2952];
const COMPLETE = 15;
const CART_IN = "You nimbly jump from one side of the cart to the other, and climb down again.";
const CART_OUT = ["You climb up onto the cart, and nimbly jump from one side...", "...to the other, and climb down again."];

before(() => h.setup([ROAD, [2867, 2952], [2766, 9366]]));
after(() => h.teardown());

const village = () => h.PM.getCoreApi();
const text = (f) => h.lines(f);
const box = (f) => h.shown(f)?.text;

test("cart before the quest: Look-at is the captured box (t672)", async (t) => {
  const f = h.actor(t, { at: ROAD });
  await h.clickObject(f, CART, CART_TILE, 1);
  assert.equal(box(f), "You see a broken cart has been placed here. You suspect it's intended to keep people out.");
  assert.equal(h.shown(f).who, "StatementDialogue");
});

test("cart before the quest: from the village side Search climbs out with the two lines, a tick apart (t741-742, t775-776)", async (t) => {
  const f = h.actor(t, { at: BY_THE_GATE });
  await h.dispatch(f, { type: "object_option", id: CART, x: CART_TILE[0], y: CART_TILE[1], clickType: 2 });
  h.ticks(f, 4);
  assert.deepEqual(h.at(f), ROAD);
  const lines = f.messages.filter((m) => CART_OUT.includes(m.text));
  assert.deepEqual(lines.map((m) => m.text), CART_OUT);
  assert.equal(lines[1].tick - lines[0].tick, 1, "the second line with the landing, a tick on");
  assert.ok(f.animations.some((a) => a.id === 828), "the reach animation 828");
});

test("cart after the quest: Climb over inbound is the one line and lands by the gate; outbound the two lines (t5405-5409)", async (t) => {
  const f = h.actor(t, { at: ROAD, stage: COMPLETE });
  await h.dispatch(f, { type: "object_option", id: CART, x: CART_TILE[0], y: CART_TILE[1], clickType: 2 });
  h.ticks(f, 4);
  assert.deepEqual(h.at(f), BY_THE_GATE);
  assert.ok(text(f).includes(CART_IN));
  assert.equal(text(f).includes(CART_OUT[0]), false);
  await h.dispatch(f, { type: "object_option", id: CART, x: CART_TILE[0], y: CART_TILE[1], clickType: 2 });
  h.ticks(f, 4);
  assert.deepEqual(h.at(f), ROAD);
  assert.ok(CART_OUT.every((line) => text(f).includes(line)));
});

test("metal gate before the quest, from inside: 'The gates open very slowly.', the open leaves for two ticks, out on 2875 (t731-736)", async (t) => {
  const f = h.actor(t, { at: [2874, 2952] });
  h.watchLocs(f);
  await h.dispatch(f, { type: "object_option", id: METAL_GATE[0], x: METAL_GATE[1], y: METAL_GATE[2], clickType: 1 });
  h.ticks(f, 6);
  assert.ok(text(f).includes("The gates open very slowly."));
  assert.deepEqual(h.at(f), [2875, 2952]);
  const added = f.locs.filter(([, kind]) => kind === "add").map(([tick, , id, x, y]) => [id, x, y]);
  for (const leaf of [[38848, 2875, 2953], [38848, 2875, 2952], [1574, 2874, 2953], [1573, 2874, 2952]]) {
    assert.ok(added.some((a) => a.join() === leaf.join()), `opened ${leaf}: ${JSON.stringify(added)}`);
  }
  const open = f.locs.find(([, kind, id]) => kind === "add" && id === 1573)[0];
  const shut = f.locs.find(([, kind, id]) => kind === "add" && id === 2259)[0];
  assert.equal(shut - open, 2, "shut again two ticks later");
});

test("metal gate after the quest: through with the in-line, out with the out-line (t5412-5415, t5401-5406)", async (t) => {
  const f = h.actor(t, { at: BY_THE_GATE, stage: COMPLETE });
  await h.dispatch(f, { type: "object_option", id: METAL_GATE[0], x: METAL_GATE[1], y: METAL_GATE[2], clickType: 1 });
  h.ticks(f, 6);
  assert.deepEqual(h.at(f), [2874, 2952]);
  assert.ok(text(f).includes("You open the gates and make your way through into the village."));
  await h.dispatch(f, { type: "object_option", id: METAL_GATE[0], x: METAL_GATE[1], y: METAL_GATE[2], clickType: 1 });
  h.ticks(f, 6);
  assert.deepEqual(h.at(f), [2875, 2952]);
  assert.ok(text(f).includes("You open the gates and make your way back out of the village."));
});

test("inner gate: shut before the quest (t719), a step through after it with a line each way (t5398-5421)", async (t) => {
  const before = h.actor(t, { at: [2868, 2952] });
  await h.dispatch(before, { type: "object_option", id: INNER_GATE[0], x: INNER_GATE[1], y: INNER_GATE[2], clickType: 1 });
  h.ticks(before, 3);
  assert.ok(text(before).includes("The gate won't open."));
  assert.deepEqual(h.at(before), [2868, 2952]);

  const f = h.actor(t, { at: [2868, 2952], stage: COMPLETE });
  h.watchLocs(f);
  await h.dispatch(f, { type: "object_option", id: INNER_GATE[0], x: INNER_GATE[1], y: INNER_GATE[2], clickType: 1 });
  h.ticks(f, 5);
  assert.deepEqual(h.at(f), [2867, 2952]);
  assert.ok(text(f).includes("You make your way into Shilo Village."));
  assert.ok(f.locs.some(([, kind, id]) => kind === "add" && id === 2263));
  await h.dispatch(f, { type: "object_option", id: INNER_GATE[0], x: INNER_GATE[1], y: INNER_GATE[2], clickType: 1 });
  h.ticks(f, 5);
  assert.deepEqual(h.at(f), [2868, 2952]);
  assert.ok(text(f).includes("You make your way out of Shilo Village."));
});

test("Mosol Rei after the quest: Follow is the box and a fade, and two ticks on the player is inside the inner gate (t5430-5433)", async (t) => {
  const f = h.actor(t, { at: [2880, 2954], stage: COMPLETE });
  const mosol = h.spawn(f, 8695, [2880, 2953]);
  const follow = mosol.getCurrentDefinition(f.player).getActions().indexOf("Follow");
  assert.ok(follow >= 0);
  await h.dispatch(f, { type: "npc_option", index: mosol.getIndex(), clickType: follow + 1 });
  h.ticks(f, 5);
  assert.deepEqual(h.at(f), [2866, 2952]);
  assert.equal(box(f), "Mosol leads you into the village and walks back out into the jungle.");
  const fades = f.calls.filter((c) => c.name === "sendSubInterface" && c.args[1] === 174);
  assert.equal(fades.length, 2, "faded out and back in");
});

test("the mist: four pulses at its tile, the line once, 2-3 damage to whoever stands within a square (t726-738; Wiki)", async (t) => {
  const f = h.actor(t, { at: [2870, 2953] });
  const pulses = [];
  t.mock.method(Math, "random", () => 0.99);
  const unit = h.quest().state.units.Village;
  const hits = [];
  const queue = f.player.getCombat().getHitQueue();
  t.mock.method(queue, "addPendingDamage", (list) => { hits.push(...list.map((d) => d.getDamage())); });
  unit.raiseMist(f.player, [2870, 2953]);
  h.ticks(f, 16);
  for (const g of f.graphics) if (g.id === 184) pulses.push(g.tick);
  assert.equal(pulses.length, 4, `four pulses: ${JSON.stringify(f.graphics)}`);
  assert.deepEqual(pulses.map((tick) => tick - pulses[0]), [0, 4, 8, 12]);
  assert.equal(text(f).filter((line) => line === "A green thick mist rises from the ground and starts choking you.").length, 1);
  assert.equal(hits.length, 4, `a hit each pulse while the player stays: ${hits}`);
  assert.ok(hits.every((d) => d >= 2 && d <= 3), `2-3 each: ${hits}`);
});

const CART_PACKET = { type: "object_option", id: CART, x: CART_TILE[0], y: CART_TILE[1], clickType: 2 };
const GATE_PACKET = { type: "object_option", id: METAL_GATE[0], x: METAL_GATE[1], y: METAL_GATE[2], clickType: 1 };

test("cart before the quest, from the road: the box, Mosol's warning and the menu; 'climbing over' climbs in on the line's continue (t678-689)", async (t) => {
  const f = h.actor(t, { at: ROAD });
  const said = await h.converse(f, () => h.dispatch(f, CART_PACKET), ["I'm climbing over the cart anyway!"]);
  assert.match(said[0], /^StatementDialogue: You think you could climb over the cart/);
  assert.ok(/^Mosol Rei: (Hey, move away from the cart please!|You must be a maniac)/.test(said[1]), said.join("\n"));
  assert.match(said[2], /^MENU\[.*\]: I'm climbing over the cart anyway!\|I'm climbing in anyway\. Don't warn me again\.\|Actually, I'll stay out here\.$/);
  assert.equal(said[3], "PLAYER: I'm climbing over the cart anyway!");
  h.ticks(f, 4);
  assert.deepEqual(h.at(f), BY_THE_GATE);
  assert.ok(text(f).includes(CART_IN));
});

test("cart before the quest: 'Don't warn me again.' climbs, and the next Search climbs without the warning (ours: kept)", async (t) => {
  const f = h.actor(t, { at: ROAD });
  await h.converse(f, () => h.dispatch(f, CART_PACKET), ["I'm climbing in anyway. Don't warn me again."]);
  h.ticks(f, 4);
  assert.deepEqual(h.at(f), BY_THE_GATE);
  await h.dispatch(f, CART_PACKET);
  h.ticks(f, 4);
  assert.deepEqual(h.at(f), ROAD, "out again, no warning on that side");
  await h.dispatch(f, CART_PACKET);
  assert.equal(h.shown(f), null, "no box");
  h.ticks(f, 4);
  assert.deepEqual(h.at(f), BY_THE_GATE);
});

test("cart before the quest: 'Actually, I'll stay out here.' stays (t763)", async (t) => {
  const f = h.actor(t, { at: ROAD });
  const said = await h.converse(f, () => h.dispatch(f, CART_PACKET), ["Actually, I'll stay out here."]);
  assert.equal(said.at(-1), "PLAYER: Actually, I'll stay out here. I'd probably have just scraped my knees up.");
  h.ticks(f, 4);
  assert.deepEqual(h.at(f), ROAD);
});

test("metal gate before the quest, from outside: the cold-gate box and menu; Yes drags the player in to 2870,2953 (t692-716)", async (t) => {
  const f = h.actor(t, { at: BY_THE_GATE });
  h.watchLocs(f);
  const said = await h.converse(f, () => h.dispatch(f, GATE_PACKET), ["Yes, I am fearless!"]);
  assert.equal(said[0], "StatementDialogue: The gate feels very cold to your touch! Are you sure you want to go through?");
  assert.match(said[1], /Yes, I am fearless!\|No, actually, I have a bad feeling about this!$/);
  h.ticks(f, 8);
  assert.deepEqual(h.at(f), [2870, 2953]);
  const opening = f.messages.find((m) => m.text === "The gates slowly begin to open...");
  const grabbed = f.messages.find((m) => m.text === "Suddenly some Zombies grab you and start dragging you inside!");
  assert.ok(opening && grabbed && grabbed.tick - opening.tick === 2, JSON.stringify(f.messages));
  assert.ok(f.locs.some(([tick, kind, id]) => kind === "add" && id === 1574 && tick === grabbed.tick), "the gate opens with the grab");
});

test("metal gate before the quest: No backs away, the look round two ticks later (t699-701)", async (t) => {
  const f = h.actor(t, { at: BY_THE_GATE });
  await h.converse(f, () => h.dispatch(f, GATE_PACKET), ["No, actually, I have a bad feeling about this!"]);
  h.ticks(f, 4);
  const away = f.messages.find((m) => m.text === "You drag your quivering body away from the gates.");
  const unseen = f.messages.find((m) => m.text === "You look around, but you don't think anyone saw you.");
  assert.ok(away && unseen && unseen.tick - away.tick === 2, JSON.stringify(f.messages));
  assert.ok(h.at(f)[0] >= 2875, "still outside");
});

test("Mosol Rei after the quest: Talk-to's Yes is the one box with the fade, landing inside the inner gate (t5382-5397)", async (t) => {
  const f = h.actor(t, { at: [2880, 2954], stage: COMPLETE });
  const mosol = h.spawn(f, 8695, [2880, 2953]);
  const talk = mosol.getCurrentDefinition(f.player).getActions().indexOf("Talk-to");
  await h.converse(f, () => h.talk(f, mosol, talk + 1), ["Yes, Ok, I'll go into the village!"]);
  h.ticks(f, 5);
  assert.deepEqual(h.at(f), [2866, 2952]);
  assert.ok(f.said.some((s) => s.who === "StatementDialogue" && s.text === "Mosol leads you into the village and walks back out into the jungle."), "the box");
});

test("Mosol Rei before the quest: 'What danger...' closes the chat, he shouts, and one to three undead ones rise in smoke (t826-832)", async (t) => {
  const f = h.actor(t, { at: [2880, 2952] });
  const mosol = h.spawn(f, 8695, [2880, 2953]);
  t.mock.method(Math, "random", () => 0.99);
  const said = await h.converse(f, () => h.talk(f, mosol, 1), ["Why do I need to run?", "What danger is there around here?"]);
  assert.equal(said.at(-1), "Mosol Rei: Can you not see Bwana? This whole area is infested with the living dead.");
  assert.ok(text(f).includes("Mosol Rei: Arrggghhh, here are some now!"));
  const risen = h.core.World.getNpcs().toArray?.() ?? [...h.core.World.getNpcs()];
  const undead = risen.filter((npc) => npc && [5342, 5344].includes(npc.getId()) && npc.getOwner?.() === f.player);
  for (const npc of undead) f.npcs.push(npc);
  assert.equal(undead.length, 3, "three at the top roll");
  assert.equal(f.graphics.filter((g) => g.id === 86).length, 3, "a puff of smoke each");
});

test("Mosol Rei after the quest: 'I think I'll see it some other time.' leaves the player where they stand, with no box or fade", async (t) => {
  const f = h.actor(t, { at: [2880, 2954], stage: COMPLETE });
  const mosol = h.spawn(f, 8695, [2880, 2953]);
  const talk = mosol.getCurrentDefinition(f.player).getActions().indexOf("Talk-to");
  const said = await h.converse(f, () => h.talk(f, mosol, talk + 1), ["I think I'll see it some other time."]);
  assert.ok(said.some((line) => line.includes("You can now enter Shilo Village.")), said.join("\n"));
  h.ticks(f, 5);
  assert.deepEqual(h.at(f), [2880, 2954]);
  assert.equal(f.said.some((s) => s.text === "Mosol leads you into the village and walks back out into the jungle."), false);
  assert.equal(f.calls.some((c) => c.name === "sendSubInterface" && c.args[1] === 174), false, "no fade");
});
