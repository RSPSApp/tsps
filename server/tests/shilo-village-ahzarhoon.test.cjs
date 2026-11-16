// Run after `yarn build`: node --test tests/shilo-village-ahzarhoon.test.cjs
//
// Shilo Village's mound, fissure and Ah Za Rhoon (quests/shilovillage/AhZaRhoon.ShiloVillage.js) against the
// user's rev 242 capture (RSProx capture ShiloVillage; docs/quests/shilo-village/README.md has the facts): the
// mound's boxes and stage 3, the spade's Dig with its five timed lines and the fissure that turns back into the
// mound, the torch and the rope, the climb down, the loose rocks, the gallows, the two scrolls, Zadimus' burial
// and the bone shard, and stage 8 on leaving. Real packets, plugins, cache and map (shilo-village-harness.cjs).
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./shilo-village-harness.cjs");
const { BOXES, key } = require("../plugins/quests/shilovillage/Boxes.ShiloVillage.js");

const MOUND = 2217;
const FISSURE = 2218;
const ROPE_FISSURE = 2219;
const MOUND_TILE = [2921, 2999];
const BY_THE_MOUND = [2920, 2999];
const SPADE = 952;
const TORCH = 594;
const ROPE = 954;
const TATTERED = 607;
const CRUMPLED = 608;
const CORPSE = 610;
const SHARD = 604;
const LOOSE_ROCKS = [2222, 2885, 9317];
const GALLOWS = [2224, 2934, 9325];
const IN_AH_ZA_RHOON = [2898, 9401];
const SACRED = [2795, 3089];

before(() => h.setup([MOUND_TILE, IN_AH_ZA_RHOON, [2885, 9317], [2934, 9325], SACRED]));
after(() => h.teardown());

const unit = () => h.unit("AhZaRhoon");
const fissure = (f) => unit().ownedFissure(f.player)?.getId() ?? null;
const slot = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId?.() === id);
const shownText = (f) => h.shown(f)?.text;

async function untilShown(f, limit = 20) {
  for (let i = 0; i < limit && !h.shown(f); i++) h.tick(f);
  return h.shown(f);
}

const dig = (f) => h.dispatch(f, { type: "inventory_action", slot: slot(f, SPADE), itemId: SPADE, widgetId: 3214, option: "Dig" });
const use = (f, itemId, [objectId, x, y]) => h.dispatch(f, {
  type: "item_on_object", itemId, slot: slot(f, itemId), widgetId: 149 << 16, objectId, x, y,
});

test("every box the capture shows for Ah Za Rhoon has the dump's text", () => {
  const variants = require("../data/definitions/npc-dialogues.json")["Shilo Village"].variants;
  const texts = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") { if (o.type === "message") texts.add(key(o.text)); Object.values(o).forEach(walk); }
  };
  for (const [name, steps] of Object.entries(variants)) if (name.includes("ah-za-rhoon") && !name.includes("trufitus")) walk(steps);
  // The boxes first seen at t2454-t3239 (Boxes.ShiloVillage.js lists them by tick).
  const first = [...BOXES.keys()].indexOf("It looks as if something is buried here.");
  const last = [...BOXES.keys()].indexOf("You look at the shard of bone. The words of Zadimus come back to you. 'I am the key, but only kin may approach her.'");
  const ours = [...BOXES.keys()].slice(first, last + 1)
    .filter((text) => !/^(You show Trufitus|Trufitus |You hand the)/.test(text));
  const missing = ours.filter((text) => !texts.has(text));
  assert.deepEqual(missing, [], "box texts not found in the Ah Za Rhoon transcript");
});

test("mound: Look-at is a box and leaves stage 2 (t2454); Search is a box and stage 3 (t2459)", async (t) => {
  const f = h.actor(t, { at: BY_THE_MOUND, stage: 2 });
  await h.clickObject(f, MOUND, MOUND_TILE, 1);
  assert.equal(shownText(f), "It looks as if something is buried here.");
  assert.equal(h.shown(f).who, "StatementDialogue");
  assert.equal(h.stage(f), 2);
  await h.continueLine(f);
  await h.clickObject(f, MOUND, MOUND_TILE, 2);
  assert.equal(shownText(f), "It looks as if something is buried here. You may need some tools to excavate further.");
  assert.equal(h.stage(f), 3);
});

test("Dig at stage 3: stage 4 on the click, 831 and 1470, five lines two ticks apart, the fissure with the fifth (t2464-2472)", async (t) => {
  const f = h.actor(t, { at: BY_THE_MOUND, stage: 3, items: [SPADE] });
  await dig(f);
  assert.equal(h.stage(f), 4);
  h.ticks(f, 12);
  const lines = f.messages.filter((m) => /digging|small hole|excavate the hole|small fissure|crawl through it/.test(m.text));
  assert.equal(lines.length, 5, JSON.stringify(f.messages));
  assert.deepEqual(lines.map((m) => m.tick - lines[0].tick), [0, 2, 4, 6, 8]);
  assert.ok(f.animations.some((a) => a.id === 831), JSON.stringify(f.animations));
  assert.ok(f.calls.some((c) => c.name === "sendSoundEffect" && c.args[0] === 1470));
  assert.equal(fissure(f), FISSURE);
});

test("the dug fissure turns back into the mound 49 ticks on (t2521), and a dig opens it again with 830, 846 and the box (t2539-2543)", async (t) => {
  const f = h.actor(t, { at: BY_THE_MOUND, stage: 3, items: [SPADE] });
  await dig(f);
  h.ticks(f, 8 + 47);
  assert.equal(fissure(f), FISSURE, "still open 47 ticks after the fifth line");
  h.ticks(f, 3);
  assert.equal(fissure(f), null, "back to the mound");
  f.animations.length = 0;
  await dig(f);
  assert.equal(fissure(f), FISSURE, "open again on the click");
  await untilShown(f);
  assert.equal(shownText(f), "You have already excavated this area. Your spade clangs against the granite.");
  const ids = f.animations.map((a) => a.id);
  assert.ok(ids.includes(830) && ids.includes(846), JSON.stringify(f.animations));
  const stumble = f.animations.find((a) => a.id === 846).tick - f.animations.find((a) => a.id === 830).tick;
  assert.equal(stumble, 2);
  assert.equal(h.stage(f), 4);
});

test("a dig before the mound is searched is not this quest's (the spade's own answer)", async (t) => {
  const f = h.actor(t, { at: BY_THE_MOUND, stage: 2, items: [SPADE] });
  await dig(f);
  h.ticks(f, 3);
  assert.equal(h.stage(f), 2);
  assert.ok(h.lines(f).includes("Nothing interesting happens."));
});

test("the torch: the menu, 827, the torch's box; its continue takes the torch, stage 5, then the two boxes (t2502-2513)", async (t) => {
  const f = h.actor(t, { at: BY_THE_MOUND, stage: 4, items: [TORCH] });
  unit().placeFissure(f.player, FISSURE);
  await use(f, TORCH, [FISSURE, ...MOUND_TILE]);
  await untilShown(f);
  assert.equal(h.shown(f).title, "Are you sure? You won't get that item back.");
  await h.choose(f, "Yes");
  await untilShown(f);
  assert.match(shownText(f), /^You drop the torch into the fissure/);
  assert.equal(h.shown(f).who, "ItemStatementDialogue");
  assert.equal(h.stage(f), 4, "not yet");
  h.ticks(f, 2);
  assert.ok(f.animations.some((a) => a.id === 827));
  await h.continueLine(f);
  assert.equal(h.stage(f), 5);
  assert.equal(slot(f, TORCH), -1, "the torch is gone");
  assert.equal(shownText(f), "The torch burns out.");
  await h.continueLine(f);
  assert.equal(shownText(f), "Some rope might help here.");
});

test("the rope: 827 two ticks on, then the roped fissure, stage 6 and the rope's box (t2544-2547)", async (t) => {
  const f = h.actor(t, { at: BY_THE_MOUND, stage: 5, items: [ROPE] });
  unit().placeFissure(f.player, FISSURE);
  await use(f, ROPE, [FISSURE, ...MOUND_TILE]);
  await untilShown(f);
  assert.equal(shownText(f), "You see where to attach the rope very clearly. You secure the rope well.");
  assert.equal(h.shown(f).who, "ItemStatementDialogue");
  assert.equal(h.stage(f), 6);
  assert.equal(fissure(f), ROPE_FISSURE);
  assert.equal(slot(f, ROPE), -1);
  const pickup = f.animations.find((a) => a.id === 827);
  assert.ok(pickup && h.shown(f) && pickup.tick < f.tick, "827 before the box");
});

test("down the rope: the three lines a tick apart, 827 with the second, stage 7 in Ah Za Rhoon with the third (t2563-2566)", async (t) => {
  const f = h.actor(t, { at: BY_THE_MOUND, stage: 6 });
  unit().placeFissure(f.player, ROPE_FISSURE);
  await h.clickObject(f, ROPE_FISSURE, MOUND_TILE, 2);
  assert.match(shownText(f), /would you like to climb down\?$/);
  await h.continueLine(f);
  assert.equal(h.shown(f).title, "Climb into the fissure?");
  await h.choose(f, "Yes, I'll give it a go!");
  h.ticks(f, 5);
  const lines = f.messages.filter((m) => /contort your body|small crack in the rock|lower yourself to the floor/.test(m.text));
  assert.deepEqual(lines.map((m) => m.tick - lines[0].tick), [0, 1, 2], JSON.stringify(f.messages));
  assert.equal(f.animations.find((a) => a.id === 827)?.tick, lines[1].tick);
  assert.deepEqual(h.at(f), IN_AH_ZA_RHOON);
  assert.equal(h.stage(f), 7);
});

test("loose rocks: the scroll on Yes's object box (t2644); searched again with it, the empty bookcase (t2648)", async (t) => {
  const f = h.actor(t, { at: [2886, 9318], stage: 7 });
  await h.clickObject(f, LOOSE_ROCKS[0], LOOSE_ROCKS.slice(1), 1);
  assert.match(shownText(f), /^You can see that there is something hidden behind some rocks/);
  assert.equal(slot(f, TATTERED), -1, "nothing before the Yes");
  await h.continueLine(f);
  await h.choose(f, "Yes, I'll carefully move the rocks to see what's behind them.");
  assert.equal(shownText(f), "You start to slowly move the rocks to one side.");
  await h.continueLine(f);
  assert.match(shownText(f), /^You carefully manage to remove enough rocks/);
  assert.equal(h.shown(f).who, "ItemStatementDialogue");
  assert.ok(slot(f, TATTERED) >= 0);
  await h.continueLine(f);
  await h.clickObject(f, LOOSE_ROCKS[0], LOOSE_ROCKS.slice(1), 1);
  assert.equal(shownText(f), "You see nothing here but an empty bookcase behind some rocks.");
});

test("gallows: 'You search the gallows...' in chat, the box three ticks later; the corpse on Yes's second object box (t2723-2751)", async (t) => {
  const f = h.actor(t, { at: [2934, 9324], stage: 7 });
  await h.dispatch(f, { type: "object_option", id: GALLOWS[0], x: GALLOWS[1], y: GALLOWS[2], clickType: 2 });
  await untilShown(f);
  const line = f.messages.find((m) => m.text === "You search the gallows...");
  assert.ok(line);
  assert.equal(f.said[0].tick - line.tick, 3, JSON.stringify(f.said));
  assert.match(shownText(f), /^You find a human corpse hanging in the noose/);
  await h.continueLine(f);
  await h.choose(f, "Yes, I may find something else on the corpse.");
  assert.match(shownText(f), /^You gently support the frame/);
  assert.equal(slot(f, CORPSE), -1);
  await h.continueLine(f);
  assert.match(shownText(f), /^You find an old sack/);
  assert.equal(h.shown(f).who, "ItemStatementDialogue");
  assert.ok(slot(f, CORPSE) >= 0);
  assert.ok(h.quest().state.mechTest(f.player, h.quest().state.MECH.FOUND_CORPSE));
  await h.continueLine(f);
  assert.equal(shownText(f), "You sense that there is a spirit that needs to be put to rest.");
  await h.continueLine(f);
  await h.dispatch(f, { type: "object_option", id: GALLOWS[0], x: GALLOWS[1], y: GALLOWS[2], clickType: 2 });
  await untilShown(f);
  assert.equal(shownText(f), "The gallows look pretty eerie. You search but find nothing.");
});

for (const [name, itemId, group, size, first, read] of [
  ["tattered scroll in the message scroll (220)", TATTERED, 220, 15, "Bervirius, son of King Danthalas, was killed in battle. His", "READ_TATTERED"],
  ["crumpled scroll in the handwritten scroll (222)", CRUMPLED, 222, 11, "Rashiliyia's rage went unchecked. She killed", "READ_CRUMPLED"],
]) {
  test(`the ${name}: blank lines 1-2, the captured lines from line 3 (t2659, t2713)`, async (t) => {
    const f = h.actor(t, { at: IN_AH_ZA_RHOON, stage: 8, items: [itemId] });
    await h.dispatch(f, { type: "inventory_action", slot: slot(f, itemId), itemId, widgetId: 3214, option: "Read" });
    await untilShown(f);
    await h.continueLine(f);
    await h.choose(f, "Yes please.");
    h.ticks(f, 2);
    const opened = f.calls.find((c) => c.name === "sendSubInterface" && c.args.includes(group))
      ?? f.calls.find((c) => /Interface/.test(c.name) && c.args[0] === group);
    const strings = f.calls.filter((c) => c.name === "sendString").map((c) => c.args[0]);
    const at = strings.indexOf(first);
    assert.ok(at >= 2, `the first line: ${JSON.stringify(strings)}`);
    assert.deepEqual(strings.slice(at - 2, at), ["", ""]);
    assert.equal(strings.length - (at - 2), size, `${size} lines`);
    assert.ok(opened || f.player.getInterfaceId?.() === group, "the scroll is open");
    assert.ok(h.quest().state.mechTest(f.player, h.quest().state.MECH[read]));
  });
}

test("Zadimus' corpse in the wrong place: Bury and Drop alike, the chat line and the box two ticks later; it stays (t2763-2783)", async (t) => {
  for (const option of ["Bury", "Drop"]) {
    const f = h.actor(t, { at: [2850, 3000], stage: 8, items: [CORPSE] });
    await h.dispatch(f, { type: "inventory_action", slot: slot(f, CORPSE), itemId: CORPSE, widgetId: 3214, option });
    await untilShown(f);
    const line = f.messages.find((m) => m.text === "You feel an unearthly compunction to bury this corpse!");
    assert.ok(line, option);
    assert.match(shownText(f), /^You hear a ghostly wailing sound/);
    assert.equal(f.said[0].tick - line.tick, 2, option);
    assert.ok(slot(f, CORPSE) >= 0, `${option} keeps the corpse`);
  }
});

test("Zadimus laid to rest: the three lines two ticks apart, 830 then 827, the box, the spirit at 2796,3088, the shard in the corpse's slot (t3199-3227)", async (t) => {
  const f = h.actor(t, { at: SACRED, stage: 8, items: [CORPSE] });
  const was = slot(f, CORPSE);
  await h.dispatch(f, { type: "inventory_action", slot: was, itemId: CORPSE, widgetId: 3214, option: "Bury" });
  await untilShown(f);
  const lines = f.messages.filter((m) => /unearthly compunction|dig a hole for the remains|lay the remains of Zadimus/.test(m.text));
  assert.deepEqual(lines.map((m) => m.tick - lines[0].tick), [0, 2, 4]);
  assert.equal(f.animations.find((a) => a.id === 830)?.tick, lines[1].tick);
  assert.equal(f.animations.find((a) => a.id === 827)?.tick, lines[2].tick);
  assert.equal(shownText(f), "You hear an unearthly moaning sound as you see an apparition materialise right in front of you.");
  assert.equal(slot(f, CORPSE), was, "still the corpse");
  await h.continueLine(f);
  const spirit = h.core.World.getNpcs().toArray?.().find?.((npc) => npc?.getId?.() === 5341)
    ?? [...h.core.World.getNpcs()].find((npc) => npc?.getId?.() === 5341);
  assert.ok(spirit, "the spirit stands there");
  assert.deepEqual([spirit.getLocation().getX(), spirit.getLocation().getY()], [2796, 3088]);
  assert.ok(f.graphics.some((g) => g.id === 86 && g.at.join() === "2796,3088"), "in a puff of smoke");
  assert.match(shownText(f), /^You have released me from my torture/);
  await h.continueLine(f);
  assert.equal(f.player.getInventory().getItems()[was]?.getId?.(), SHARD, "the shard in the corpse's slot");
  assert.equal(spirit.isRegistered?.() === true && h.core.World.getNpcs().contains?.(spirit), false);
  assert.match(shownText(f), /^The apparition disappears into the ground/);
  assert.equal(h.shown(f).who, "ItemStatementDialogue");
  await h.continueLine(f);
  assert.equal(shownText(f), "inventory.");
  assert.equal(h.stage(f), 8);
});

test("the bone shard's Inspect shows Zadimus' words in blue (t3239)", async (t) => {
  const f = h.actor(t, { at: SACRED, stage: 8, items: [SHARD] });
  await h.dispatch(f, { type: "inventory_action", slot: slot(f, SHARD), itemId: SHARD, widgetId: 3214, option: "Inspect" });
  await untilShown(f);
  const current = f.player.getDialogueManager().getCurrent();
  assert.match(String(current.getText()), /<col=0000ff>'I am the key, but only kin may approach her\.'<col=000080>/);
});

test("leaving Ah Za Rhoon at stage 7 any way out is stage 8 (the glory teleport at t2885)", async (t) => {
  const f = h.actor(t, { at: IN_AH_ZA_RHOON, stage: 7 });
  h.ticks(f, 2);
  f.player.moveTo(new h.core.Location(2918, 3176, 0));
  h.ticks(f, 3);
  assert.equal(h.stage(f), 8);
});

test("Zadimus laid to rest, the chat closed at his line, twice: one spirit at most, and he goes in the end (ours: 100 ticks)", async (t) => {
  const f = h.actor(t, { at: SACRED, stage: 8, items: [CORPSE] });
  const spirits = () => [...(h.core.World.getNpcs().toArray?.() ?? h.core.World.getNpcs())]
    .filter((npc) => npc?.getId?.() === 5341 && npc.isRegistered?.() !== false);
  for (let round = 0; round < 2; round++) {
    await h.dispatch(f, { type: "inventory_action", slot: slot(f, CORPSE), itemId: CORPSE, widgetId: 3214, option: "Bury" });
    await untilShown(f);
    await h.continueLine(f);
    assert.match(shownText(f), /^You have released me from my torture/);
    f.player.getDialogueManager().reset();
    h.ticks(f, 2);
    assert.equal(spirits().length, 1, `round ${round + 1}`);
  }
  h.ticks(f, 101);
  assert.equal(spirits().length, 0, "gone after the wait");
});

test("the rope before the light: 'It's too dark to clearly see where to fix that.', and the rope is kept", async (t) => {
  const f = h.actor(t, { at: BY_THE_MOUND, stage: 4, items: [ROPE] });
  unit().placeFissure(f.player, FISSURE);
  await use(f, ROPE, [FISSURE, ...MOUND_TILE]);
  h.ticks(f, 3);
  assert.ok(h.lines(f).includes("It's too dark to clearly see where to fix that."));
  assert.ok(slot(f, ROPE) >= 0, "the rope stays");
  assert.equal(h.stage(f), 4);
  assert.equal(fissure(f), FISSURE);
});

test("the light prompt: No keeps the torch and stage 4; shut unanswered, a later menu's Yes doesn't take it either", async (t) => {
  const f = h.actor(t, { at: BY_THE_MOUND, stage: 4, items: [TORCH] });
  unit().placeFissure(f.player, FISSURE);
  await use(f, TORCH, [FISSURE, ...MOUND_TILE]);
  await untilShown(f);
  await h.choose(f, "No");
  h.ticks(f, 4);
  assert.ok(slot(f, TORCH) >= 0, "No keeps the torch");
  assert.equal(h.stage(f), 4);

  await use(f, TORCH, [FISSURE, ...MOUND_TILE]);
  await untilShown(f);
  assert.equal(h.shown(f).title, "Are you sure? You won't get that item back.");
  f.player.getDialogueManager().reset();
  h.ticks(f, 2);
  // Another of the quest's menus, with a Yes of its own: the climb's prompt on the fissure.
  await h.clickObject(f, FISSURE, MOUND_TILE, 2);
  await h.continueLine(f);
  await h.choose(f, "No thanks, I'm having second thoughts.");
  h.ticks(f, 6);
  assert.ok(slot(f, TORCH) >= 0, "the shut prompt took nothing");
  assert.equal(h.stage(f), 4);
});

test("the fissure is this player's: logout removes it, and login brings back the roped one (only that one)", async (t) => {
  const roped = h.actor(t, { at: BY_THE_MOUND, stage: 6 });
  unit().placeFissure(roped.player, ROPE_FISSURE);
  h.PM.emitPlayerLogout({ player: roped.player, username: roped.player.getUsername() });
  assert.equal(fissure(roped), null, "gone with the logout");
  h.PM.emitPlayerLogin({ player: roped.player, username: roped.player.getUsername() });
  assert.equal(fissure(roped), ROPE_FISSURE, "the roped fissure is back");

  const dug = h.actor(t, { at: BY_THE_MOUND, stage: 5 });
  unit().placeFissure(dug.player, FISSURE);
  h.PM.emitPlayerLogout({ player: dug.player, username: dug.player.getUsername() });
  h.PM.emitPlayerLogin({ player: dug.player, username: dug.player.getUsername() });
  assert.equal(fissure(dug), null, "the dug one would have turned back by then");
});

for (const [name, itemId] of [["tattered scroll", TATTERED], ["crumpled scroll", CRUMPLED]]) {
  test(`the ${name}: 'No thanks.' opens nothing and isn't reading it`, async (t) => {
    const f = h.actor(t, { at: IN_AH_ZA_RHOON, stage: 8, items: [itemId] });
    await h.dispatch(f, { type: "inventory_action", slot: slot(f, itemId), itemId, widgetId: 3214, option: "Read" });
    await untilShown(f);
    await h.continueLine(f);
    await h.choose(f, "No thanks.");
    h.ticks(f, 3);
    const strings = f.calls.filter((c) => c.name === "sendString").map((c) => String(c.args[0]));
    assert.equal(strings.some((text) => /^(Bervirius, son of King Danthalas|Rashiliyia's rage went unchecked)/.test(text)), false, "no scroll text");
    assert.equal(f.calls.some((c) => /Interface/.test(c.name) && (c.args.includes(220) || c.args.includes(222))), false, "no scroll opened");
    const state = h.quest().state;
    assert.equal(state.mechTest(f.player, state.MECH.READ_TATTERED) || state.mechTest(f.player, state.MECH.READ_CRUMPLED), false);
  });
}
