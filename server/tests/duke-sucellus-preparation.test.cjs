"use strict";

const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const Harness = require("./helpers/duke-sucellus.cjs");

before(Harness.initialize);

function vatAction(harness, option) {
  return harness.Prep.object({
    player: harness.p,
    objectId: harness.C.data.objects.vat,
    location: harness.session.tile(harness.C.data.resources.vats[0]),
    option,
  });
}

test("a vat accepts partial ingredient fills and starts fermenting only when complete", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  const items = h.C.data.items;
  const tile = h.C.data.resources.vats[0];
  h.move([tile[0], tile[1] - 1]);
  h.add(items.muscaPowder, 8);
  h.add(items.arderPowder, 3);
  h.add(items.salt, 6);
  h.Prep.fill(session, tile);
  assert.equal(h.p.getInventory().getAmount(items.muscaPowder), 2, "only the missing six musca powder are added");
  assert.equal(h.p.getInventory().getAmount(items.arderPowder), 0, "the available three arder powder are accepted");
  assert.equal(h.p.getInventory().getAmount(items.salt), 0);
  h.step(8);
  assert.equal(session.vats.values().next().value.ready, false, "a partial recipe cannot finish fermenting");
  h.add(items.arderPowder, 3);
  h.Prep.fill(session, tile);
  h.step(5);
  assert.equal(session.vats.values().next().value.ready, false);
  h.step();
  assert.equal(session.vats.values().next().value.ready, true, "the six-tick fermentation starts at completion");
});

test("emptying a vat refunds exactly its partial ingredients and cannot duplicate them", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  const { items, resources } = h.C.data;
  const tile = resources.vats[0];
  h.move([tile[0], tile[1] - 1]);
  h.add(items.muscaPowder, 4);
  h.add(items.arderPowder, 2);
  h.Prep.fill(session, tile);
  assert.equal(h.p.getInventory().getAmount(items.muscaPowder), 0);
  assert.equal(session.vats.size, 1);
  vatAction(h, "Empty");
  assert.equal(h.p.getInventory().getAmount(items.muscaPowder), 4);
  assert.equal(h.p.getInventory().getAmount(items.arderPowder), 2);
  assert.equal(h.p.getInventory().getAmount(items.salt), 0);
  assert.equal(session.vats.size, 0);
  vatAction(h, "Empty");
  assert.equal(h.p.getInventory().getAmount(items.muscaPowder), 4, "a second empty action gives no extra materials");
});

test("a vat hand-crushes raw mushrooms one-for-one and refunds powder", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  const { items, resources } = h.C.data;
  const tile = resources.vats[0];
  h.move([tile[0], tile[1] - 1]);
  h.p.getSkillManager().setCurrentLevel(h.core.Skill.HERBLORE, 99);
  h.add(items.muscaPowder, 6);
  h.add(items.salt, 6);
  h.add(items.arder, 3);
  h.Prep.fill(session, tile);
  assert.equal(h.p.getInventory().getAmount(items.arder), 0, "all three raw mushrooms were hand-crushed");
  vatAction(h, "Check");
  assert.ok(h.packets.some((packet) => packet[0] === "sendString" && packet[1].includes("Arder powder:  3 / 6")));
  assert.ok(h.spam.includes("You crush some arder mushroom into to the vat with your hands."));
  vatAction(h, "Empty");
  assert.equal(h.p.getInventory().getAmount(items.arderPowder), 3, "hand-crushing does not use the pestle's Herblore yield");
  assert.equal(h.p.getInventory().getAmount(items.arder), 0);
});

test("a full-inventory refund retains the complete vat until every ingredient can fit", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  const { items, resources } = h.C.data;
  const tile = resources.vats[0];
  h.move([tile[0], tile[1] - 1]);
  for (const item of [items.muscaPowder, items.arderPowder, items.salt]) h.add(item, 6);
  h.Prep.fill(session, tile);
  for (let n = 0; n < 26; n++) h.add(526);
  vatAction(h, "Empty");
  assert.equal(session.vats.size, 1, "two free slots do not fit all three returned stacks");
  for (const item of [items.muscaPowder, items.arderPowder, items.salt]) {
    assert.equal(h.p.getInventory().getAmount(item), 0, "a failed refund returns no partial materials");
  }
  h.p.getInventory().deleteNumber(526, 1);
  vatAction(h, "Empty");
  assert.equal(session.vats.size, 0);
  for (const item of [items.muscaPowder, items.arderPowder, items.salt]) assert.equal(h.p.getInventory().getAmount(item), 6);
});

test("normal-world preparation feedback and mushroom repetition use the captured effects", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  const { items, resources } = h.C.data;
  const animations = [];
  t.mock.method(h.p, "performAnimation", (animation) => animations.push(animation.getId()));
  h.move([resources.arder[0] + 1, resources.arder[1]]);
  h.Prep.pick(session, "arder");
  assert.ok(h.spam.includes("You pick a mushroom."));
  assert.ok(animations.includes(h.core.CacheDefinitions.getSeqId("picking_low")));
  h.step(3);
  assert.equal(h.p.getInventory().getAmount(items.arder), 2, "picking continues after three ticks");
  h.move([resources.arder[0] + 2, resources.arder[1]]);
  h.step(3);
  assert.equal(h.p.getInventory().getAmount(items.arder), 2, "moving stops the repeated action");

  h.add(items.pestle);
  h.Prep.grind({ player: h.p, usedItemId: items.pestle, usedWithItemId: items.arder });
  assert.ok(h.spam.includes("You grind the mushroom into dust."));
  assert.ok(animations.includes(h.core.CacheDefinitions.getSeqId("human_herbing_grind")));
  const tile = resources.vats[0];
  h.move([tile[0], tile[1] - 1]);
  for (const item of [items.muscaPowder, items.arderPowder, items.salt]) h.add(item, 6);
  h.Prep.fill(session, tile);
  assert.ok(animations.includes(h.core.CacheDefinitions.getSeqId("qip_cook_hopper_grain")));
  assert.ok(h.messages.includes("The mixture in the vat begins to ferment."));
  h.step(6);
  assert.ok(h.messages.includes("<col=06600c>A fermentation vat is ready to be emptied.</col>"));
  const beforeXp = h.p.getSkillManager().getExperience(h.core.Skill.HERBLORE);
  h.Prep.collect(session, tile);
  assert.equal(h.p.getSkillManager().getExperience(h.core.Skill.HERBLORE) - beforeXp, 10, "current normal-mode recipe XP is retained");
  assert.ok(h.messages.includes("You collect some poison from the vat."));
  const sounds = h.packets.filter((packet) => packet[0] === "sendSoundEffect").map((packet) => packet[1]);
  for (const sound of [2581, 2608, 2447, 2655, 2434]) assert.ok(sounds.includes(sound), "captured synth " + sound);
});

test("vat Check and refusal messages use the messagebox rather than ordinary chat", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  const { items, resources } = h.C.data;
  const tile = resources.vats[0];
  h.move([tile[0], tile[1] - 1]);
  h.Prep.fill(session, tile);
  assert.ok(h.packets.some((packet) => packet[0] === "sendString" && packet[1] === "You don't appear to have any ingredients to add."));
  h.add(items.muscaPowder, 6);
  h.add(items.arderPowder, 3);
  h.add(items.salt, 6);
  h.Prep.fill(session, tile);
  vatAction(h, "Check");
  assert.ok(h.packets.some((packet) => packet[0] === "sendString" && packet[1] === "Musca powder: 6 / 6<br>Arder powder:  3 / 6<br>Salax salt:  6 / 6"));
  h.add(items.arderPowder, 3);
  h.Prep.fill(session, tile);
  h.Prep.fill(session, tile);
  assert.ok(h.packets.some((packet) => packet[0] === "sendString" && packet[1] === "The vat is currently fermenting."));
});

test("feeding preserves supported powder use and shows the captured animation, sound and hitsplat", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  const { items } = h.C.data;
  const animations = [];
  t.mock.method(h.p, "performAnimation", (animation) => animations.push(animation.getId()));
  h.move([3039, 6451]);
  h.Prep.feed({ player: h.p, npc: session.boss });
  assert.ok(h.messages.includes("You don't have anything to feed him."));
  h.add(items.arderPowder);
  h.Prep.feed({ player: h.p, npc: session.boss });
  assert.equal(session.meter, 5, "the documented normal-mode powder alternative remains supported");
  assert.equal(session.boss.getTickHits().at(-1).getDamage(), 5);
  assert.ok(animations.includes(h.core.CacheDefinitions.getSeqId("human_pickuptable_walkmerge")));
  assert.ok(h.packets.some((packet) => packet[0] === "sendSoundEffect" && packet[1] === 7249 && packet[3] === 30));
  h.add(items.poison, 2);
  h.Prep.feed({ player: h.p, npc: session.boss });
  h.Prep.feed({ player: h.p, npc: session.boss });
  h.step();
  assert.ok(h.messages.includes("<col=ef0083>Duke Sucellus awakens..."));
  assert.equal(session.boss.getHitpoints(), h.C.data.normal.hitpoints, "feeding never queues damage against the awakened boss");
});

test("forty left-click powder feeds wake the normal Duke and further clicks consume nothing", (t) => {
  const h = Harness.harness(t);
  const session = h.enter();
  const { items } = h.C.data;
  h.move([3039, 6451]);
  h.add(items.muscaPowder, 42);
  for (let n = 0; n < 42; n++) { h.Prep.feed({ player: h.p, npc: session.boss }); h.step(); }
  assert.equal(session.meter, 200);
  assert.equal(h.p.getInventory().getAmount(items.muscaPowder), 2);
  assert.equal(session.fight.active, true);
  assert.equal(session.boss.getTickHits().length, 40);
  assert.ok(session.boss.getTickHits().every((hit) => hit.getDamage() === 5));
  h.add(items.poison, 3);
  h.Prep.feed({ player: h.p, npc: session.boss });
  assert.equal(h.p.getInventory().getAmount(items.poison), 3, "awake feeding cannot spend poison either");
});
