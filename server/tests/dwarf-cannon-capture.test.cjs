// Run after `yarn build`: node --test tests/dwarf-cannon-capture.test.cjs
//
// Dwarf Cannon against the rsprox captures (local 1001565, rev 241, start to finish; 1001618, rev 241;
// 1002239, rev 242; docs/quests/dwarf-cannon/README.md). Real Player, PlayerSession and
// ClientConnection, the real plugins, cache and map: talks and clicks are packets, each tick runs as
// World.process does.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "dwarf_cannon";
const LAWGOF_TILE = [2567, 3460, 0];
const BY_LAWGOF = [2567, 3459, 0];
const RAILING_1 = { id: 15590, tile: [2555, 3479], stand: [2555, 3480, 0] };
const RAILING_6 = { id: 15595, tile: [2577, 3457], stand: [2577, 3458, 0] };
const TOWER_LADDER = { id: 11, tile: [2570, 3443], stand: [2571, 3443, 1] };
const REMAINS = { id: 0, tile: [2567, 3444], stand: [2568, 3444, 2] };
const CAVE = { id: 2, tile: [2622, 3392], stand: [2623, 3391, 0] };
const CRATE = { id: 1, tile: [2571, 9850], stand: [2570, 9850, 0] };
const MUDPILE = { id: 13, tile: [2621, 9796], stand: [2620, 9797, 0] };
const CANNON = { id: 15597, tile: [2562, 3461], stand: [2562, 3460, 0] };
const NULODION_TILE = [3012, 3454, 0];
const BY_NULODION = [3012, 3453, 0];
const MESSAGEBOX = 229;
const OBJECTBOX = 193;
const OBJECTBOX_DOUBLE = 11;
const RAILING_VARBITS = [2240, 2241, 2242, 2243, 2244, 2245];
const TAKEN_CORPSE = 2246;

let I;
let N;
before(async () => {
  h.key = KEY;
  await h.setup([[2567, 3460], [2555, 3479], [2577, 3457], [2570, 3443], [2622, 3392], [2571, 9850], [2621, 9796], [3012, 3454]]);
  I = h.core.ItemIdentifiers;
  N = h.core.NpcIdentifiers;
});
after(() => h.teardown());

const quest = () => h.quest(KEY);
const stage = (f) => quest().getStage(f.player);
const varp0 = (f) => f.player.getPacketSender().getConfig?.(0) ?? lastConfig(f, 0);
const lastConfig = (f, id) => f.calls.filter((c) => c.name === "sendConfig" && c.args[0] === id).at(-1)?.args[1];
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const group = (f) => f.player.getPacketSender().getChatboxGroupId();
const count = (f, id) => f.player.getInventory().getAmount(id);
const at = (f) => [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()];
const messagesFrom = (f, tick) => f.messages.filter((m) => m.tick >= tick).map((m) => String(m.text));

function actor(t, { stage: value = 0, items = [], at: tile = BY_LAWGOF, mask, crafting = 66 } = {}) {
  const f = h.actor(t, { at: tile, done: [] });
  f.player.setAttribute("dwarf-cannon:stage-schema", 1);
  if (mask !== undefined) f.player.setAttribute("dwarf-cannon:rails-fixed-mask", mask);
  quest().setStage(f.player, value);
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount), false);
  const skills = f.player.getSkillManager();
  skills.setMaxLevels(h.core.Skill.CRAFTING, crafting);
  skills.setCurrentLevel(h.core.Skill.CRAFTING, crafting, false);
  return f;
}

const { rolls } = require("../plugins/quests/quests/DwarfCannon.Quest.js")._test;
/** Runs `run` with the railing rolls (the success roll, then a failure's pick) fixed. */
function withRandom(value, run) {
  const next = rolls.next;
  rolls.next = typeof value === "function" ? value : () => value;
  try { return run(); } finally { rolls.next = next; }
}

/** Continues until `text` shows (a line, a box or a menu option), returning its tick. */
async function until(f, text, limit = 80) {
  for (let i = 0; i < limit; i++) {
    const line = h.shown(f);
    if (line?.text?.startsWith(text) || (line?.who === "menu" && line.text.includes(text))) return f.tick;
    if (line && line.who !== "menu") await h.continueLine(f);
    else h.tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

async function finish(f, limit = 40) {
  for (let i = 0; i < limit && h.shown(f); i++) {
    if (h.shown(f).who === "menu") return;
    await h.continueLine(f);
  }
}

async function talkToLawgof(f) {
  const npc = h.spawn(f, N.CAPTAIN_LAWGOF, LAWGOF_TILE);
  await h.talk(f, npc);
  return npc;
}

async function click(f, loc, clickType = 1) {
  await h.dispatch(f, { type: "object_option", id: loc.id, x: loc.tile[0], y: loc.tile[1], clickType });
}

const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId?.() === id);
async function useOn(f, itemId, loc) {
  await h.dispatch(f, { type: "item_on_object", objectId: loc.id, x: loc.tile[0], y: loc.tile[1], itemId,
    slot: slotOf(f, itemId), widgetId: h.core.Inventory.INTERFACE_ID << 16 });
}

async function button(f, child) {
  await f.connection.dispatch([{ type: "widget_action", widgetId: (409 << 16) | child, groupId: 409, childId: child, buttonNum: 0 }]);
  h.tick(f);
}

test("Lawgof starts the quest on \"That's the spirit!\" and hands the railings over in an item box", async (t) => {
  const f = actor(t, { items: [[I.HAMMER, 1]] });
  await talkToLawgof(f);
  await until(f, "Yes.");
  assert.equal(h.shown(f).title, "Start the Dwarf Cannon quest?");
  await h.choose(f, "Yes.");
  await until(f, "Sure, I'd be honoured to join.");
  assert.equal(stage(f), 0, "not yet started on the player's answer");
  await until(f, "That's the spirit!");
  assert.equal(stage(f), 1, "varp 0 is 1 with Lawgof's next line (1001565 tick 4717)");
  await until(f, "The Dwarf Captain gives you six railings.");
  assert.equal(group(f), OBJECTBOX, "an item box, as captured");
  assert.equal(count(f, I.RAILING), 6);
  await until(f, "Yes Sir, Captain!");
  await finish(f);
  assert.equal(count(f, I.HAMMER), 1, "no second hammer");
});

test("a railing repair: the box, \"replace\" on its continue, the hammering 2 ticks on and the outcome 2 after", async (t) => {
  const f = actor(t, { stage: 1, items: [[I.RAILING, 6], [I.HAMMER, 1]], at: RAILING_1.stand });
  await click(f, RAILING_1);
  for (let i = 0; i < 4 && group(f) !== MESSAGEBOX; i++) h.tick(f);
  assert.equal(group(f), MESSAGEBOX);
  assert.equal(h.shown(f).text, "This railing is broken and needs to be replaced.");
  const continued = f.tick;
  await withRandom(0, () => h.continueLine(f));
  assert.ok(messagesFrom(f, continued).includes("You attempt to repalce the broken railing..."));
  const attempted = f.messages.find((m) => m.text === "You attempt to repalce the broken railing...").tick;
  assert.equal(f.player.getDialogueManager().isActive(), false, "the box closes with the attempt, as live's if_closesub");
  withRandom(0, () => h.ticks(f, 1));
  assert.equal(f.animations.filter((a) => a.id === 4190).length, 0, "no swing yet");
  withRandom(0, () => h.ticks(f, 1));
  const swing = f.animations.find((a) => a.id === 4190);
  assert.equal(swing?.tick, attempted + 2, "mcannon_hammer_anim 2 ticks after the message");
  withRandom(0, () => h.ticks(f, 1));
  assert.equal(varbit(f, RAILING_VARBITS[0]), 0, "not fixed a tick after the swing");
  withRandom(0, () => h.ticks(f, 1));
  assert.equal(varbit(f, RAILING_VARBITS[0]), 1, "fixed 2 ticks after the swing");
  assert.equal(count(f, I.RAILING), 5);
  assert.ok(messagesFrom(f, continued).includes("This railing is now fixed."));
});

test("a stat-drain failure swings again 4 ticks later; a hit ends the attempt (all three captures)", async (t) => {
  const f = actor(t, { stage: 1, items: [[I.RAILING, 6], [I.HAMMER, 1]], at: RAILING_1.stand });
  const strength = f.player.getSkillManager().getCurrentLevel(h.core.Skill.STRENGTH);
  await click(f, RAILING_1);
  for (let i = 0; i < 4 && group(f) !== MESSAGEBOX; i++) h.tick(f);
  const continued = f.tick;
  await h.continueLine(f);
  // The failure roll, then the pick of the fourth failure (wrench: Strength).
  const rolls = [0.99, 0.8];
  withRandom(() => rolls.length ? rolls.shift() : 0.99, () => h.ticks(f, 4));
  assert.ok(messagesFrom(f, continued).includes("You wrench your back trying to handle the railings."));
  assert.equal(f.player.getSkillManager().getCurrentLevel(h.core.Skill.STRENGTH), strength - 1);
  assert.equal(varbit(f, RAILING_VARBITS[0]), 0);
  const failedAt = f.messages.find((m) => m.text.startsWith("You wrench")).tick;
  // The retry: the swing 4 ticks after the failure, then success.
  withRandom(0, () => h.ticks(f, 6));
  const swings = f.animations.filter((a) => a.id === 4190).map((a) => a.tick);
  assert.deepEqual(swings.slice(1, 2), [failedAt + 4]);
  assert.equal(varbit(f, RAILING_VARBITS[0]), 1, "the retry fixed it without another click");

  const g = actor(t, { stage: 1, items: [[I.RAILING, 6], [I.HAMMER, 1]], at: RAILING_1.stand });
  await click(g, RAILING_1);
  for (let i = 0; i < 4 && group(g) !== MESSAGEBOX; i++) h.tick(g);
  await h.continueLine(g);
  const crush = [0.99, 0.6];
  withRandom(() => crush.length ? crush.shift() : 0, () => h.ticks(g, 12));
  assert.ok(g.messages.some((m) => m.text === "You accidentally crush your hand in the railing."));
  assert.equal(g.animations.filter((a) => a.id === 4190).length, 1, "a hit ends the attempt");
  assert.equal(varbit(g, RAILING_VARBITS[0]), 0);
});

test("the success chance follows Crafting: 61/256 at level 1, 151/256 at 99 (Wiki: 24% and 59%)", async (t) => {
  for (const [level, chance] of [[1, 61 / 256], [99, 151 / 256]]) {
    for (const [roll, fixed] of [[chance - 0.001, 1], [chance + 0.001, 0]]) {
      const f = actor(t, { stage: 1, items: [[I.RAILING, 6], [I.HAMMER, 1]], at: RAILING_1.stand, crafting: level });
      await click(f, RAILING_1);
      for (let i = 0; i < 4 && group(f) !== MESSAGEBOX; i++) h.tick(f);
      await h.continueLine(f);
      // The roll, then (on a failure) the pick of a hit, which ends the attempt.
      const rolls = [roll, 0.3];
      withRandom(() => rolls.length ? rolls.shift() : 0.3, () => h.ticks(f, 4));
      assert.equal(varbit(f, RAILING_VARBITS[0]), fixed, `level ${level}, roll ${roll}`);
    }
  }
});

test("the sixth railing sets mcannon_taken_corpse with it; all six bring the player's line", async (t) => {
  const f = actor(t, { stage: 1, items: [[I.RAILING, 1], [I.HAMMER, 1]], at: RAILING_6.stand, mask: 0b011111 });
  await click(f, RAILING_6);
  for (let i = 0; i < 4 && group(f) !== MESSAGEBOX; i++) h.tick(f);
  await h.continueLine(f);
  withRandom(0, () => h.ticks(f, 4));
  assert.equal(varbit(f, RAILING_VARBITS[5]), 1);
  assert.equal(varbit(f, TAKEN_CORPSE), 1);
  assert.equal(h.shown(f)?.text, "I've fixed all these railings now.");
  assert.equal(stage(f), 1, "varp 0 stays 1 until the report");
});

test("the report moves varp 0 to 2 on \"Excellent!\", the tower's top ladder to 3", async (t) => {
  const f = actor(t, { stage: 1, mask: 0b111111 });
  await talkToLawgof(f);
  await until(f, "Okay, I'll see what I can find out.");
  assert.equal(stage(f), 1);
  await until(f, "Excellent! I have two men there");
  assert.equal(stage(f), 2);
  await finish(f);

  const g = actor(t, { stage: 2, at: TOWER_LADDER.stand });
  await click(g, TOWER_LADDER);
  h.ticks(g, 4);
  assert.deepEqual(at(g), [2569, 3443, 2]);
  assert.equal(stage(g), 3, "the remains show from here (multiloc on varp 0 = 3)");
});

test("the remains: the player's line first, taken as it closes, with no chat message", async (t) => {
  const f = actor(t, { stage: 3, at: REMAINS.stand });
  await click(f, REMAINS);
  for (let i = 0; i < 4 && !h.shown(f); i++) h.tick(f);
  assert.equal(h.shown(f)?.text, "I had better take these remains.");
  assert.equal(count(f, I.DWARF_REMAINS), 0, "not before the line closes (1001565 ticks 5093-5099)");
  await h.continueLine(f);
  assert.equal(count(f, I.DWARF_REMAINS), 1);
  assert.ok(!f.messages.some((m) => /take the dwarf remains/i.test(m.text)));

  f.player.moveTo(new h.core.Location(...BY_LAWGOF));
  h.tick(f);
  await talkToLawgof(f);
  await until(f, "You give the Dwarf Captain his subordinate's remains...");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(stage(f), 3, "varp 0 moves on the box's continue");
  assert.equal(count(f, I.DWARF_REMAINS), 1);
  await h.continueLine(f);
  assert.equal(stage(f), 4);
  assert.equal(count(f, I.DWARF_REMAINS), 0);
  await finish(f);
});

test("the cave entrance moves varp 0 to 5; the crate's search, child and untie are 3 and 2 ticks apart", async (t) => {
  const f = actor(t, { stage: 4, at: CAVE.stand });
  await click(f, CAVE);
  const landed = [];
  for (let i = 0; i < 8; i++) { h.tick(f); landed.push(at(f).join(",")); }
  assert.ok(landed.includes("2620,9797,0"), JSON.stringify(landed));
  assert.equal(stage(f), 5);

  const g = actor(t, { stage: 5, at: CRATE.stand });
  await click(g, CRATE);
  const searched = g.messages.find((m) => m.text === "You search the crate...")?.tick;
  assert.ok(searched !== undefined, JSON.stringify(g.messages));
  assert.ok(g.animations.some((a) => a.id === 827 && a.tick === searched));
  h.ticks(g, 6);
  const tickOf = (text) => g.messages.find((m) => m.text === text)?.tick;
  assert.equal(tickOf("Inside you see a dwarf child, tied up!"), searched + 3);
  assert.ok(g.animations.some((a) => a.id === 832 && a.tick === searched + 3));
  assert.equal(tickOf("You untie the child."), searched + 5);
  assert.equal(stage(g), 6, "varp 0 is 6 at the untie");
  const lollk = h.core.World.getNpcs().getAll?.().find?.((npc) => npc?.getId?.() === N.LOLLK)
    ?? [...h.core.World.getNpcs()].find((npc) => npc?.getId?.() === N.LOLLK);
  assert.ok(lollk, "Lollk stands by the crate");
  assert.deepEqual([lollk.getLocation().getX(), lollk.getLocation().getY()], [2571, 9851]);
  assert.equal(h.shown(g)?.text, "Thank the heavens, you saved me! I thought I'd be goblin lunch for sure!");
  await until(g, "Thanks again, brave adventurer.");
  await h.continueLine(g);
  const ran = g.messages.find((m) => m.text === "The dwarf child runs off into the caverns.")?.tick;
  assert.ok(ran !== undefined);
  h.ticks(g, 5);
  assert.equal(lollk.isRegistered?.() ?? false, false, "gone after four steps");
});

test("the crate's search holds the player; a move by other means ends it without the rescue (review on #6039)", async (t) => {
  // Walking during the search: live is busy for it, so the click waits and the rescue happens at the crate.
  const f = actor(t, { stage: 5, at: CRATE.stand });
  await click(f, CRATE);
  assert.ok(f.messages.some((m) => m.text === "You search the crate..."));
  await f.connection.dispatch([{ type: "move", worldX: 2568, worldY: 9848, modifierFlags: 0 }]);
  h.ticks(f, 6);
  assert.deepEqual(at(f), CRATE.stand, "no step during the search");
  assert.equal(stage(f), 6);
  assert.equal(h.shown(f)?.text, "Thank the heavens, you saved me! I thought I'd be goblin lunch for sure!");
  await finish(f);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false, "free again once the search is over");

  // Moved off the tile mid-search (a teleport): nothing more happens, and the crate can be searched again.
  const g = actor(t, { stage: 5, at: CRATE.stand });
  await click(g, CRATE);
  h.ticks(g, 1);
  g.player.moveTo(new h.core.Location(2568, 9848, 0));
  h.ticks(g, 6);
  assert.equal(stage(g), 5, "no rescue away from the crate");
  assert.ok(!g.messages.some((m) => m.text === "You untie the child."));
  assert.equal(h.shown(g), null, "no conversation opens");
  g.player.moveTo(new h.core.Location(...CRATE.stand));
  h.tick(g);
  await click(g, CRATE);
  h.ticks(g, 6);
  assert.equal(stage(g), 6, "a new search works");
});

test("a death during the crate's search ends it and leaves the death's movement hold alone (review on #6039)", async (t) => {
  const f = actor(t, { stage: 5, at: CRATE.stand });
  await click(f, CRATE);
  h.ticks(f, 2);
  f.player.setHitpoints(0);
  f.player.appendDeath();
  const queue = f.player.getMovementQueue();
  const release = queue.setBlockMovement.bind(queue);
  const searchReleases = [];
  queue.setBlockMovement = (value) => {
    if (value === false && new Error().stack.includes("endSearch")) searchReleases.push(f.tick);
    return release(value);
  };
  h.ticks(f, 3);
  assert.equal(stage(f), 5, "no rescue for a dying player");
  assert.ok(!f.messages.some((m) => m.text === "You untie the child."));
  assert.equal(h.shown(f), null, "no conversation opens");
  assert.deepEqual(searchReleases, [], "the search never releases a dying player's movement hold");
  assert.equal(queue.isMovementBlocked(), true, "the death task still holds the player");
});

test("the mud pile: the climb animation 2 ticks on, outside a tick later", async (t) => {
  const f = actor(t, { stage: 6, at: MUDPILE.stand });
  await click(f, MUDPILE);
  const clicked = f.tick;
  h.ticks(f, 4);
  assert.ok(f.animations.some((a) => a.id === 828), JSON.stringify(f.animations));
  assert.deepEqual(at(f), [2623, 3391, 0]);
  const climb = f.animations.find((a) => a.id === 828).tick;
  assert.ok(climb >= clicked && climb <= clicked + 2);
});

test("the repair puzzle keeps the chosen tool, plays the captured animations and closes 4 ticks after the gear", async (t) => {
  const f = actor(t, { stage: 7, items: [[I.TOOLKIT, 1]], at: CANNON.stand });
  await useOn(f, I.TOOLKIT, CANNON);
  for (let i = 0; i < 4 && f.player.getInterfaceId() !== 409; i++) h.tick(f);
  assert.equal(f.player.getInterfaceId(), 409);
  const animationsOf = [];
  const sender = f.player.getPacketSender();
  const original = sender.sendInterfaceAnimation.bind(sender);
  sender.sendInterfaceAnimation = (uid, seq) => { animationsOf.push(seq); return original(uid, seq); };
  await button(f, 3); // hooked tool
  await button(f, 8); // spring
  assert.equal(varbit(f, 2239), 1);
  assert.equal(varbit(f, 2237), 1, "the tool stays selected");
  await button(f, 2); // pliers
  await button(f, 7); // safety
  assert.equal(varbit(f, 2238), 1);
  await button(f, 1); // toothed tool
  const gear = f.tick;
  await button(f, 9);
  assert.equal(stage(f), 8);
  assert.ok(f.messages.some((m) => m.text === "Well done! You've fixed the cannon! Better go and tell Captain Lawgof."));
  assert.deepEqual(animationsOf, [3202, 3198, 3205], "attach_spring, safety_off_with_spring, work_with_spring");
  h.ticks(f, 2);
  assert.equal(f.player.getInterfaceId(), 409, "still open");
  h.ticks(f, 3);
  assert.notEqual(f.player.getInterfaceId(), 409, `closed 4 ticks after the gear (${gear})`);
});

test("after the repair: the toolkit goes back, and varp 0 is 9 only once the talk closes", async (t) => {
  const f = actor(t, { stage: 8, items: [[I.TOOLKIT, 1]] });
  await talkToLawgof(f);
  await until(f, "Not bad for an adventurer eh?");
  await until(f, "Sorry, I've really done enough.");
  assert.equal(count(f, I.TOOLKIT), 0, "the toolkit message came first");
  await h.choose(f, "Okay then, just for you!");
  await until(f, "Okay, I'll see what I can do.");
  assert.equal(stage(f), 8);
  await h.continueLine(f);
  assert.equal(stage(f), 9);
});

test("Nulodion's notes and mould come in a two-item box with varp 0 at 10; Lawgof takes both at completion", async (t) => {
  const f = actor(t, { stage: 9, at: BY_NULODION });
  const nulodion = h.spawn(f, N.NULODION, NULODION_TILE);
  await h.talk(f, nulodion);
  await until(f, "The Cannon Engineer gives you some notes and a mould.");
  assert.equal(group(f), OBJECTBOX_DOUBLE);
  assert.equal(stage(f), 10);
  assert.equal(count(f, I.NULODIONS_NOTES), 1);
  assert.equal(count(f, I.AMMO_MOULD), 1);
  await finish(f);

  const g = actor(t, { stage: 10, items: [[I.NULODIONS_NOTES, 1], [I.AMMO_MOULD, 1]], mask: 0b111111 });
  for (const id of [2235, 2238, 2239, ...RAILING_VARBITS, TAKEN_CORPSE]) g.player.getPacketSender().sendVarbit(id, 1);
  await talkToLawgof(g);
  await until(g, "Hmmm... sounds interesting, I might take you up on that.");
  await finish(g);
  h.ticks(g, 3);
  assert.equal(stage(g), 11);
  assert.equal(count(g, I.NULODIONS_NOTES), 0);
  assert.equal(count(g, I.AMMO_MOULD), 0, "the mould is handed in too (Wiki: Ammo mould)");
  for (const id of [2235, 2238, 2239, ...RAILING_VARBITS, TAKEN_CORPSE]) assert.equal(varbit(g, id), 0, `varbit ${id} cleared`);
  const strings = g.calls.filter((c) => c.name === "sendString").map((c) => c.args[0]);
  for (const line of ["1 Quest Point", "750 Crafting XP", "Ability to use a", "Dwarf Multicannon"]) assert.ok(strings.includes(line), line);
  const model = g.calls.find((c) => (c.name === "sendItemOnInterfaces" || c.name === "sendItemOnInterface") && c.args[1] === I.TOOLKIT);
  assert.ok(model, "the scroll shows the toolkit");
});

test("old saves move onto varp 0's values once", (t) => {
  const cases = [[2, [], 1], [3, [], 2], [3, [[0, 1]], 3], [4, [], 4], [5, [], 6], [6, [], 7], [7, [], 7], [11, [], 11]];
  for (const [legacy, items, expected] of cases) {
    const f = h.actor(t, { at: BY_LAWGOF, done: [] });
    quest().setStage(f.player, legacy);
    f.player.setAttribute("dwarf-cannon:stage-schema", 0);
    for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount), false);
    const login = () => h.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
    login();
    assert.equal(stage(f), expected, `legacy ${legacy}`);
    login();
    assert.equal(stage(f), expected, `legacy ${legacy}, second login`);
  }
});
