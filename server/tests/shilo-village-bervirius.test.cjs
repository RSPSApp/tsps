// Run after `yarn build`: node --test tests/shilo-village-bervirius.test.cjs
//
// Shilo Village's Cairn Isle and Bervirius' tomb (quests/shilovillage/Bervirius.ShiloVillage.js) against the
// user's rev 242 capture (RSProx capture ShiloVillage; docs/quests/shilo-village/README.md) and the Wiki: the
// bridge, the crawl-way, the dolmen, the climbing rocks, the crafting, the locating crystal, Bervirius' notes
// and the ending. Real plugins, cache and map (shilo-village-harness.cjs); objects are clicked with packets.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./shilo-village-harness.cjs");

const BRIDGE_Y = 2979;
const WELL_STACKED_ROCKS = [2234, 2762, 2990];
const DOLMEN = [2235, 2766, 9364];
const CLIMBING_ROCKS = [2236, 2765, 9376];
const STAGE = { LEFT_TEMPLE: 8, ENTERED_BERVIRIUS: 9, RETRIEVED_CORPSE: 14, COMPLETE: 15 };

before(() => h.setup([[2779, 2979], [2762, 2990], [2766, 9366], [2792, 2979]]));
after(() => h.teardown());

const I = () => h.core.ItemIdentifiers;
const inv = (f) => f.player.getInventory();
const slot = (f, id) => inv(f).getItems().findIndex((item) => item?.getId?.() === id);
const lines = (f) => h.lines(f);
const xp = (f, skill) => f.player.getSkillManager().getExperience(h.core.Skill[skill]);

function hits(f, t) {
  const list = [];
  t.mock.method(f.player.getCombat().getHitQueue(), "addPendingDamage", (damage) => { list.push(...damage.map((d) => d.getDamage())); });
  return list;
}

function itemOnItem(f, used, usedWith) {
  return h.PM.emitItemOnItem({
    player: f.player, usedItemId: used, usedItem: inv(f).getItems()[slot(f, used)], usedItemSlot: slot(f, used),
    usedWithItemId: usedWith, usedWithItem: inv(f).getItems()[slot(f, usedWith)], usedWithItemSlot: slot(f, usedWith), handled: false,
  });
}

function itemAction(f, id, option) {
  return h.PM.emitItemAction({
    player: f.player, item: inv(f).getItems()[slot(f, id)], itemId: id, slot: slot(f, id),
    interfaceId: h.core.CacheDefinitions.getComponentId("inventory:items"), option, clickType: 1, handled: false,
  });
}

/** Plays the open conversation through, picking `picks` at its menus, and returns what was shown. */
async function play(f, picks = []) {
  return h.converse(f, async () => {}, picks);
}

/** Steps the player across the bridge's middle with the area watching, as a run west from 2780 to 2778. */
function runOverTheMiddle(f) {
  f.player.setLocation(new h.core.Location(2781, BRIDGE_Y, 0));
  h.tick(f);
  f.player.setLocation(new h.core.Location(2780, BRIDGE_Y, 0));
  h.tick(f);
  f.player.setLocation(new h.core.Location(2778, BRIDGE_Y, 0));
  h.tick(f);
}

// ------------------------------------------------------------------ the bridge

test("bridge: a run across its middle rolls once, a tick on; a success is the line and 10 Agility XP (t3482-3483; Wiki)", async (t) => {
  const f = h.actor(t, { at: [2782, BRIDGE_Y], stage: STAGE.LEFT_TEMPLE });
  t.mock.method(Math, "random", () => 0);
  const before = xp(f, "AGILITY");
  runOverTheMiddle(f);
  const crossed = f.tick;
  h.ticks(f, 2);
  const balance = f.messages.filter((m) => m.text === "You manage to keep your balance on the bridge.");
  assert.equal(balance.length, 1, JSON.stringify(f.messages));
  assert.equal(balance[0].tick, crossed + 1, "the line a tick after the step");
  assert.equal(xp(f, "AGILITY") - before, 10);
  // Stepping off the middle, west and east again on the planks, without crossing x 2779, rolls nothing.
  f.player.setLocation(new h.core.Location(2777, BRIDGE_Y, 0));
  h.ticks(f, 3);
  assert.equal(lines(f).filter((line) => /keep your balance/.test(line)).length, 1);
});

test("bridge: a fall carries the player through the river to 2782,2971 and, 12 ticks on, the two lines and three hits of floor(HP/11) (t3398-3410; Wiki)", async (t) => {
  const f = h.actor(t, { at: [2782, BRIDGE_Y], stage: STAGE.LEFT_TEMPLE, levels: { HITPOINTS: 54 } });
  const damage = hits(f, t);
  t.mock.method(Math, "random", () => 0.999);
  runOverTheMiddle(f);
  h.tick(f);
  const fell = f.messages.find((m) => m.text === "You fall!");
  assert.ok(fell, JSON.stringify(f.messages));
  h.ticks(f, 14);
  assert.deepEqual(h.at(f), [2782, 2971]);
  const ashore = f.messages.find((m) => m.text === "You just manage to drag your pitiful frame onto the river bank.");
  assert.ok(ashore && lines(f).includes("Though you nearly drowned in the river!"));
  assert.equal(ashore.tick - fell.tick, 12);
  assert.deepEqual(damage, [4, 4, 4], "floor(54 / 11) each (the capture's floor(HP / 10) is the recorded difference)");
  assert.ok(f.graphics.some((g) => g.id === 68 && g.at.join() === "2778,2978"), "the splash");
});

// ------------------------------------------------------------------ the crawl-way

test("well stacked rocks: the crawl-way's boxes, 827 on the second, stage 9 and the tomb on the third (t3505-3519)", async (t) => {
  const f = h.actor(t, { at: [2762, 2989], stage: STAGE.LEFT_TEMPLE });
  await h.clickObject(f, WELL_STACKED_ROCKS[0], WELL_STACKED_ROCKS.slice(1), 2);
  const shown = [];
  for (let i = 0; i < 12; i++) {
    const line = h.shown(f);
    if (!line) { h.tick(f); continue; }
    shown.push(line);
    if (line.who === "menu") {
      assert.equal(line.title, "Crawl into hole?");
      await h.choose(f, "Yes please, I can think of nothing nicer!");
      continue;
    }
    if (/drop to your feet/.test(line.text)) break;
    assert.deepEqual(h.at(f), [2762, 2989], `still outside at "${line.text}"`);
    await h.continueLine(f);
  }
  assert.ok(shown.every((line) => line.who === "menu" || line.who === "StatementDialogue"), JSON.stringify(shown));
  assert.deepEqual(h.at(f), [2760, 9389]);
  assert.equal(h.stage(f), STAGE.ENTERED_BERVIRIUS);
  assert.ok(f.animations.some((a) => a.id === 827));
});

test("well stacked rocks: below the Wiki's 32 Agility the crawl is refused at Yes", async (t) => {
  const f = h.actor(t, { at: [2762, 2989], stage: STAGE.LEFT_TEMPLE, levels: { AGILITY: 20 } });
  await h.clickObject(f, WELL_STACKED_ROCKS[0], WELL_STACKED_ROCKS.slice(1), 2);
  await play(f, ["Yes please, I can think of nothing nicer!"]);
  assert.deepEqual(h.at(f), [2762, 2989]);
  assert.equal(h.stage(f), STAGE.LEFT_TEMPLE);
  assert.ok(lines(f).includes("You need an Agility level of at least 32 to squeeze in there."));
});

// ------------------------------------------------------------------ the dolmen

test("dolmen: Search's box, then pommel, crystal and notes, each added as its own object box shows (t3599-3604)", async (t) => {
  const f = h.actor(t, { at: [2766, 9366], stage: STAGE.ENTERED_BERVIRIUS });
  await h.clickObject(f, DOLMEN[0], DOLMEN.slice(1), 2);
  const order = [];
  for (let i = 0; i < 10 && h.shown(f); i++) {
    const current = f.player.getDialogueManager().getCurrent();
    const held = [I().SWORD_POMMEL, I().LOCATING_CRYSTAL, I().BERVIRIUS_NOTES].filter((id) => inv(f).getAmount(id) > 0);
    order.push({ kind: current.constructor.name, item: current.getItemId?.() ?? current.itemId ?? null, held });
    await h.continueLine(f);
  }
  assert.equal(order[0].kind, "StatementDialogue");
  assert.deepEqual(order.slice(1).map((step) => step.kind), ["ItemStatementDialogue", "ItemStatementDialogue", "ItemStatementDialogue"]);
  assert.deepEqual(order.map((step) => step.held.length), [0, 1, 2, 3], "one more item at each box");
});

// ------------------------------------------------------------------ the climbing rocks

test("climbing rocks: a success is the attempt, the way out two ticks on and Cairn Isle two ticks after that (t3546-3553)", async (t) => {
  const f = h.actor(t, { at: [2764, 9376], stage: STAGE.ENTERED_BERVIRIUS });
  t.mock.method(Math, "random", () => 0);
  await h.dispatch(f, { type: "object_option", id: CLIMBING_ROCKS[0], x: CLIMBING_ROCKS[1], y: CLIMBING_ROCKS[2], clickType: 1 });
  h.ticks(f, 8);
  const attempt = f.messages.find((m) => m.text === "You attempt to climb the granite rock.");
  const out = f.messages.find((m) => m.text === "You manage to climb back out again!");
  assert.ok(attempt && out);
  assert.equal(out.tick - attempt.tick, 2);
  assert.deepEqual(h.at(f), [2764, 2976]);
});

test("climbing rocks: a fall is 'You fall!', the yell, back on 2764,9376 and a 1-10 hit (t5270-5273; Wiki)", async (t) => {
  const f = h.actor(t, { at: [2764, 9376], stage: STAGE.COMPLETE });
  const damage = hits(f, t);
  t.mock.method(Math, "random", () => 0.999);
  await h.dispatch(f, { type: "object_option", id: CLIMBING_ROCKS[0], x: CLIMBING_ROCKS[1], y: CLIMBING_ROCKS[2], clickType: 1 });
  h.ticks(f, 8);
  assert.ok(lines(f).includes("You fall!"));
  assert.deepEqual(h.at(f), [2764, 9376]);
  assert.equal(damage.length, 1);
  assert.ok(damage[0] >= 1 && damage[0] <= 10);
});

// ------------------------------------------------------------------ crafting

test("chisel on the pommel: the pommel becomes the bone beads in its slot on the second box, 3 Crafting XP (t3614-3616; Wiki)", async (t) => {
  const f = h.actor(t, { at: [2766, 9366], stage: STAGE.ENTERED_BERVIRIUS, items: [I().CHISEL, I().SWORD_POMMEL] });
  const pommelSlot = slot(f, I().SWORD_POMMEL);
  const before = xp(f, "CRAFTING");
  itemOnItem(f, I().CHISEL, I().SWORD_POMMEL);
  h.tick(f);
  assert.equal(inv(f).getAmount(I().SWORD_POMMEL), 1, "kept through the first box");
  await h.continueLine(f);
  assert.equal(slot(f, I().BONE_BEADS), pommelSlot);
  assert.equal(xp(f, "CRAFTING") - before, 3);
});

test("bronze wire on the beads: the Beads of the Dead in the wire's slot, 4 Crafting XP (t3620; Wiki); 20 Crafting needed", async (t) => {
  const f = h.actor(t, { at: [2766, 9366], stage: STAGE.ENTERED_BERVIRIUS, items: [I().BONE_BEADS, I().BRONZE_WIRE] });
  const wireSlot = slot(f, I().BRONZE_WIRE);
  const before = xp(f, "CRAFTING");
  itemOnItem(f, I().BRONZE_WIRE, I().BONE_BEADS);
  assert.equal(slot(f, I().BEADS_OF_THE_DEAD), wireSlot);
  assert.equal(inv(f).getAmount(I().BONE_BEADS), 0);
  assert.equal(xp(f, "CRAFTING") - before, 4);

  const low = h.actor(t, { at: [2766, 9366], stage: STAGE.ENTERED_BERVIRIUS, items: [I().BONE_BEADS, I().BRONZE_WIRE], levels: { CRAFTING: 19 } });
  itemOnItem(low, I().BRONZE_WIRE, I().BONE_BEADS);
  assert.equal(inv(low).getAmount(I().BEADS_OF_THE_DEAD), 0);
});

test("chisel on the bone shard: not before the lock is seen; after it, the key in the shard's slot, 3 Crafting XP (t4011; Wiki)", async (t) => {
  const f = h.actor(t, { at: [2766, 9366], stage: STAGE.ENTERED_BERVIRIUS, items: [I().CHISEL, I().BONE_SHARD] });
  itemOnItem(f, I().CHISEL, I().BONE_SHARD);
  h.tick(f);
  assert.ok(lines(f).some((line) => /not quite sure what to make/.test(line)), JSON.stringify(lines(f)));
  assert.equal(inv(f).getAmount(I().BONE_KEY), 0);

  const sv = h.quest().state;
  sv.mechSet(f.player, sv.MECH.FOUND_BONE_DOOR, true);
  const shardSlot = slot(f, I().BONE_SHARD);
  const before = xp(f, "CRAFTING");
  itemOnItem(f, I().CHISEL, I().BONE_SHARD);
  h.tick(f);
  assert.equal(h.shown(f)?.who, "StatementDialogue");
  assert.equal(slot(f, I().BONE_KEY), shardSlot);
  assert.equal(xp(f, "CRAFTING") - before, 3);
});

// ------------------------------------------------------------------ the crystal

test("locating crystal: the box with the crystal, the menu, the blue crystal's box with blue text and a prayer point (t3660-3666)", async (t) => {
  const f = h.actor(t, { at: [2792, 2979], stage: STAGE.ENTERED_BERVIRIUS, items: [I().LOCATING_CRYSTAL], levels: { PRAYER: 36 } });
  itemAction(f, I().LOCATING_CRYSTAL, "Activate");
  h.tick(f);
  const first = f.player.getDialogueManager().getCurrent();
  assert.equal(first.constructor.name, "ItemStatementDialogue");
  await h.continueLine(f);
  await h.choose(f, "Yes, just this once.");
  h.tick(f);
  const result = f.player.getDialogueManager().getCurrent();
  assert.equal(result.constructor.name, "ItemStatementDialogue");
  assert.match(String(result.getText()), /^<col=0000ff>The crystal glows faintly\./);
  assert.equal(f.player.getSkillManager().getCurrentLevel(h.core.Skill.PRAYER), 35);
});

test("locating crystal: 'always' plays the result without the menu from then on", async (t) => {
  const f = h.actor(t, { at: [2792, 2979], stage: STAGE.ENTERED_BERVIRIUS, items: [I().LOCATING_CRYSTAL], levels: { PRAYER: 36 } });
  itemAction(f, I().LOCATING_CRYSTAL, "Activate");
  h.tick(f);
  await h.continueLine(f);
  await h.choose(f, "Yes, always let it draw from my spiritual energy.");
  h.tick(f);
  assert.match(String(f.player.getDialogueManager().getCurrent()?.getText?.()), /glows faintly/);
  await h.continueLine(f);
  h.ticks(f, 2);
  itemAction(f, I().LOCATING_CRYSTAL, "Activate");
  h.tick(f);
  assert.match(String(f.player.getDialogueManager().getCurrent()?.getText?.()), /glows faintly/, "straight to the result");
  assert.equal(f.player.getSkillManager().getCurrentLevel(h.core.Skill.PRAYER), 34);
});

// ------------------------------------------------------------------ the notes

test("Bervirius' notes: the yellow papyrus opens on the handwriting scroll (222) with the captured lines (t3687)", async (t) => {
  const f = h.actor(t, { at: [2766, 9366], stage: STAGE.ENTERED_BERVIRIUS, items: [I().BERVIRIUS_NOTES] });
  const opened = [];
  const sender = f.player.getPacketSender();
  const sendInterface = sender.sendInterface.bind(sender);
  t.mock.method(sender, "sendInterface", (id, ...rest) => { opened.push(id); return sendInterface(id, ...rest); });
  itemAction(f, I().BERVIRIUS_NOTES, "Read");
  h.tick(f);
  await h.continueLine(f);
  await h.choose(f, "Tattered Yellow papyrus.");
  h.ticks(f, 2);
  const { CacheDefinitions } = h.core;
  assert.deepEqual(opened, [CacheDefinitions.getInterfaceId("messagescroll_handwriting")]);
  const strings = new Map(f.calls.filter((c) => c.name === "sendString").map((c) => [c.args[1], c.args[0]]));
  assert.equal(strings.get(CacheDefinitions.getComponentId("messagescroll_handwriting:messagescroll7_hw")),
    "the underground to watch all of nature from the");
  assert.equal(strings.get(CacheDefinitions.getComponentId("messagescroll_handwriting:messagescroll1_hw")), "");
});

// ------------------------------------------------------------------ the ending

test("the remains on the dolmen: the object box, the mist, Rashiliyia for her lines, then gone, the mist again and the quest complete (t5245-5257)", async (t) => {
  const f = h.actor(t, { at: [2766, 9366], stage: STAGE.RETRIEVED_CORPSE, items: [I().RASHILIYIA_CORPSE] });
  const spawned = [];
  const removed = [];
  const spawn = h.PM.spawnNpc.bind(h.PM);
  t.mock.method(h.PM, "spawnNpc", (definition, ...rest) => { const npc = spawn(definition, ...rest); spawned.push([definition.id, definition.x, definition.y, npc]); return npc; });
  const remove = h.PM.removeNpc.bind(h.PM);
  t.mock.method(h.PM, "removeNpc", (npc) => { removed.push(npc); return remove(npc); });
  await h.dispatch(f, { type: "item_on_object", objectId: DOLMEN[0], x: DOLMEN[1], y: DOLMEN[2], itemId: I().RASHILIYIA_CORPSE,
    slot: slot(f, I().RASHILIYIA_CORPSE), widgetId: 149 << 16 });
  for (let i = 0; i < 10 && !h.shown(f); i++) h.tick(f);
  assert.equal(f.player.getDialogueManager().getCurrent().constructor.name, "ItemStatementDialogue");
  await h.continueLine(f);
  h.tick(f);
  const rashiliyia = spawned.filter(([id]) => id === 5352);
  assert.deepEqual(rashiliyia.map(([id, x, y]) => [id, x, y]), [[5352, 2767, 9367]], "Rashiliyia beside the dolmen");
  const mists = () => f.graphics.filter((g) => g.id === 184 && g.at.join() === "2767,9367").length;
  assert.equal(mists(), 1, "the mist on the box's continue");
  await play(f);
  assert.equal(h.stage(f), STAGE.COMPLETE);
  assert.equal(inv(f).getAmount(I().RASHILIYIA_CORPSE), 0);
  assert.ok(lines(f).includes("Without warning the spirit of Rashiliyia disappears."));
  assert.equal(mists(), 2, "and again as she goes");
  assert.ok(removed.includes(rashiliyia[0][3]), "and she is gone");
});
