// Run after `yarn build`: node --test tests/between-a-rock.test.cjs
//
// Between a Rock... against the user's whole-quest rsprox capture BetweenARock.bin (rev 242.1;
// docs/quests/between-a-rock/README.md). Real Player, PlayerSession and ClientConnection, the real
// plugins, cache and map (tests/between-a-rock-harness.cjs). Ticks in the comments are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const H = require("./between-a-rock-harness.cjs");
const Schematics = require("../plugins/quests/betweenarock/Schematics.BetweenARock");
const Mine = require("../plugins/quests/betweenarock/Mine.BetweenARock");

const ITEMS = {
  book: 4568, page1: 4569, page2: 4570, page3: 4571, pages: 4573, base: 4574, schematic1: 4575, schematic2: 4576,
  schematic3: 4577, assembled: 4578, cannonball: 4579, helmet: 4567, goldBar: 2357, goldOre: 444, hammer: 2347, mould: 4,
};
const DONDAKAN = 6262;
const KHORVAK = 4895;
const ROCK_CANNONBALLS = 5963;
const GOLD_CANNONBALL = 5965;

before(H.boot);
after(H.shutdown);

const amount = (f, id) => f.player.getInventory().getAmount(id);
const since = (f, t0, name) => H.callsNamed(f, name, t0).map((call) => ({ at: call.tick - t0, args: call.args }));
const lastMessage = (f) => f.messages.filter((m) => !m.text.startsWith("You have unlocked a new music track")).at(-1)?.text;
const objectIdOf = (arg) => (typeof arg?.getId === "function" ? arg.getId() : arg);

test("Khorvak talks: Forgettable Tale's Talk-to hook no longer swallows his conversation (issue point 7)", async (t) => {
  for (const [stage, first] of [[0, "Hello there."], [80, "I'm looking for schematics to modify the dwarven multicannon to fire a human. Can you help?"]]) {
    const f = H.actor(t, { stage, at: [2863, 9876, 0] });
    const npc = H.spawn(f, KHORVAK, [2862, 9876, 0]);
    await H.talk(f, npc);
    assert.equal(H.shown(f)?.text, first, `stage ${stage}`);
  }
});

test("stage 60 as Dondakan's \"not very much closer\" is continued (ticks 1541-1542), before any question", async (t) => {
  const f = H.actor(t, { stage: 50 });
  const npc = H.spawn(f, DONDAKAN, H.DONDAKAN_TILE);
  await H.talk(f, npc);
  await H.until(f, "Well, we're not very much closer to a solution then, are we?");
  assert.equal(H.quest().getStage(f.player), 50, "not yet while the line shows");
  await H.continueLine(f);
  assert.equal(H.quest().getStage(f.player), 60);
  assert.equal(H.shown(f)?.who, "menu");
  await H.choose(f, "I'll be back later.");
  assert.equal(H.quest().getStage(f.player), 60, "leaving without asking keeps the quest moving");
});

test("the kick: the passage's loc goes, the camera watches Dondakan kick and walk back, then the talk and his menu again (ticks 1567-1586, 1659)", async (t) => {
  const f = H.actor(t, { stage: 60 });
  const npc = H.spawn(f, DONDAKAN, H.DONDAKAN_TILE);
  f.player.setAttribute("quest.between_a_rock.gold-shown", false);
  H.quest().setStage(f.player, 50);
  await H.talk(f, npc);
  await H.until(f, "Well, we're not very much closer to a solution then, are we?");
  await H.continueLine(f);
  await H.choose(f, "What have you tried so far?");
  await H.until(f, "What else did you try?");
  await H.choose(f, "What else did you try?");
  await H.until(f, "They're made out of granite!");
  await H.continueLine(f);
  const t0 = f.tick; // the continue's tick
  const positions = [];
  for (let i = 0; i < 25 && H.shown(f)?.text !== "Did you see? Did you?"; i++) {
    H.tick(f);
    positions.push(H.xy(npc.getLocation()).slice(0, 2).join(","));
  }
  assert.equal(H.shown(f)?.text, "Did you see? Did you?");
  assert.equal(f.tick - t0, 19, "the talk carries on 19 ticks later");
  assert.deepEqual(since(f, t0, "sendObjectRemoval").map(({ at, args }) => [at, objectIdOf(args[0])]), [[0, ROCK_CANNONBALLS]]);
  assert.deepEqual(since(f, t0, "sendObject").map(({ at, args }) => [at, objectIdOf(args[0])]), [[19, ROCK_CANNONBALLS]]);
  assert.deepEqual(since(f, t0, "sendCameraMoveTo").map(({ at, args }) => [at, ...args.slice(0, 3)]), [[6, 2817, 10170, 500]]);
  assert.deepEqual(since(f, t0, "sendCameraReset").map(({ at }) => at), [18]);
  assert.deepEqual(since(f, t0, "sendSound").map(({ at, args }) => [at, args[0]]), [[10, 1406]], "dwarf_kickrock");
  assert.ok(positions.includes("2823,10172"), "he walks up the passage");
  assert.equal(positions.at(-1), "2824,10168", "and back");
  await H.until(f, "Don't be silly, I'm sure there must be some known material that will affect it.");
  await H.continueLine(f);
  assert.match(H.shown(f)?.text ?? "", /^What have you tried so far\? \| Maybe we need to set up another cannon\?/, "his first menu again");
});

test("the golden cannonball: used on Dondakan and fired, the golden flight plays and the stage moves to 70 (ticks 2022-2064)", async (t) => {
  const f = H.actor(t, { stage: 60, items: [ITEMS.cannonball] });
  const npc = H.spawn(f, DONDAKAN, H.DONDAKAN_TILE);
  await H.useOnNpc(f, ITEMS.cannonball, npc);
  await H.until(f, "Yes, I'm sure this will crack open the rock.");
  await H.choose(f, "Yes, I'm sure this will crack open the rock.");
  await H.until(f, "It breaks my heart");
  await H.continueLine(f);
  const t0 = f.tick;
  assert.equal(amount(f, ITEMS.cannonball), 0);
  assert.equal(H.quest().getStage(f.player), 70);
  for (let i = 0; i < 12 && !(H.shown(f)?.text ?? "").startsWith("Did... did..."); i++) H.tick(f);
  assert.equal(f.tick - t0, 9);
  assert.deepEqual(since(f, t0, "sendObject").map(({ at, args }) => [at, objectIdOf(args[0])]), [[4, GOLD_CANNONBALL], [8, ROCK_CANNONBALLS]]);
  assert.deepEqual(since(f, t0, "sendCameraMoveTo").map(({ at, args }) => [at, ...args.slice(0, 3)]), [[0, 2822, 10162, 600], [3, 2822, 10170, 550]]);
  assert.deepEqual(since(f, t0, "sendSound").map(({ at, args }) => [at, args[0]]), [[4, 1408]], "gold_cannonball");
});

test("the furnace: the messages come over eight ticks and the first gold bar becomes the cannonball, 37.5 XP (ticks 1767-1775)", async (t) => {
  const I = H.core.ItemIdentifiers;
  const f = H.actor(t, { stage: 60, items: [ITEMS.mould, ITEMS.goldBar], at: [2975, 3369, 0] });
  const slot = f.player.getInventory().getSlotForItemId(ITEMS.goldBar);
  await H.useOnObject(f, ITEMS.goldBar, 24009, [2976, 3368]);
  assert.equal(H.shown(f)?.title, "Do you wish to make a golden cannonball?");
  await H.choose(f, "Yes.");
  const t0 = f.tick;
  H.ticks(f, 10);
  const lines = f.messages.filter((m) => m.tick >= t0 && !m.text.startsWith("You have unlocked")).map((m) => m.tick - t0);
  assert.deepEqual(lines, [0, 0, 1, 2, 8]);
  assert.equal(f.player.getInventory().get(slot)?.getId(), ITEMS.cannonball, "in the bar's slot");
  assert.equal(amount(f, I.GOLD_BAR), 0);
  assert.deepEqual(f.xp.map((gain) => gain.amount), [37.5]);
  assert.ok(f.animations.some((a) => a.id === 899), "human_furnace");
});

test("the golden helmet: Smith on an anvil with gold bars asks first, then human_smithing and the helmet four ticks on (ticks 5114-5123)", async (t) => {
  const f = H.actor(t, { stage: 80, items: [ITEMS.hammer, ITEMS.goldBar, ITEMS.goldBar, ITEMS.goldBar], at: [2869, 10201, 0] });
  const slot = f.player.getInventory().getSlotForItemId(ITEMS.goldBar);
  f.player.getSkillManager().setMaxLevels(H.core.Skill.SMITHING, 60, false).setCurrentLevels(H.core.Skill.SMITHING, 60, false);
  await H.objectOption(f, 6150, [2869, 10202], 1);
  H.ticks(f, 2);
  assert.equal(H.shown(f)?.title, "Would you like to make a golden helmet?");
  assert.equal(amount(f, ITEMS.helmet), 0);
  await H.choose(f, "Yes.");
  const t0 = f.tick;
  assert.ok(f.animations.some((a) => a.tick === t0 && a.id === 898), "human_smithing");
  H.ticks(f, 5);
  const said = f.messages.filter((m) => m.tick >= t0 && !m.text.startsWith("You have unlocked"));
  assert.deepEqual(said.map((m) => [m.tick - t0, m.text]), [
    [4, "You forge a beautiful and very heavy golden helmet out of solid gold."],
    [4, "Who knows, this might become a new fashion rage?"],
  ]);
  assert.equal(amount(f, ITEMS.helmet), 1);
  assert.equal(f.player.getInventory().get(slot)?.getId(), ITEMS.helmet, "in the first bar's slot");
  assert.equal(amount(f, ITEMS.goldBar), 0);
  assert.deepEqual(f.xp.map((gain) => gain.amount), [30]);
});

test("the Dwarven lore book: Read opens its three spreads; at stage 40 opening reads it, and closing says so with the book (ticks 1247-1257)", async (t) => {
  const f = H.actor(t, { stage: 40, items: [ITEMS.book], at: [3022, 3450, 0] });
  await H.itemOption(f, ITEMS.book, "Read");
  assert.equal(H.quest().getStage(f.player), 50, "read as it opens");
  const strings = H.callsNamed(f, "sendString").map((call) => call.args[0]);
  assert.ok(strings.includes("The Arzinian Being of Bordanzan"));
  assert.ok(strings.includes("... in such a way that the"));
  await H.button(f, 392, 77);
  await H.button(f, 392, 77);
  assert.ok(H.callsNamed(f, "sendItemOnInterface").some((call) => call.args[1] === 25128), "the diagram on the last spread");
  await H.button(f, 392, 7);
  H.tick(f);
  assert.equal(H.shown(f)?.who, "ItemStatementDialogue");
  assert.equal(H.shown(f)?.text, "That certainly was an interesting read! You now have enough info for Dondakan. You should go back to him.");
});

test("tearing out the schematic: from stage 80 closing the book shows the picture, asks, and the base schematic takes the book's slot (ticks 2151-2170)", async (t) => {
  const f = H.actor(t, { stage: 80, items: [ITEMS.book], at: [3022, 3450, 0] });
  const slot = f.player.getInventory().getSlotForItemId(ITEMS.book);
  await H.itemOption(f, ITEMS.book, "Read");
  await H.button(f, 392, 7);
  H.tick(f);
  assert.equal(H.shown(f)?.who, "StatementDialogue", "a message box");
  await H.continueLine(f);
  assert.equal(H.shown(f)?.title, "Tear out the page?");
  await H.choose(f, "Yes.");
  assert.equal(H.shown(f)?.who, "ItemStatementDialogue");
  assert.equal(f.player.getInventory().get(slot)?.getId(), ITEMS.base);
  assert.equal(amount(f, ITEMS.book), 0);
});

test("the pages: the third joins them into one item with its own box; a second cart has nothing more (ticks 1077-1159)", async (t) => {
  const f = H.actor(t, { stage: 30, items: [ITEMS.page1, ITEMS.page2], at: [3017, 9844, 0] });
  await H.objectOption(f, 6045, [3017, 9845], 1);
  assert.deepEqual(lastMessage(f), "You've had enough of searching carts, there's nothing more inside them.");
  const Quest = H.PM;
  // The third page, as the Dwarven Mine rock gives it.
  H.PM.emitCustomEvent("mining:success", { player: f.player, itemId: 434 });
  // (not pending: no rock was clicked) - the page comes through the scorpion instead.
  f.player.getInventory().deleteNumber(ITEMS.page1, 1);
  const scorpion = H.spawn(f, 3024, [3018, 9844, 0]);
  H.PM.emitNpcDeath({ npc: scorpion, npcId: 3024, killer: f.player });
  assert.equal(amount(f, ITEMS.pages), 0, "two pages stay apart");
  f.player.getInventory().add(new H.core.Item(ITEMS.page3, 1), false);
  f.player.getInventory().deleteNumber(ITEMS.page1, 1);
  H.PM.emitNpcDeath({ npc: scorpion, npcId: 3024, killer: f.player });
  assert.equal(H.shown(f)?.text, "You turn over the corpse of the scorpion and find a missing page of Rolad's book!");
  await H.continueLine(f);
  assert.equal(H.shown(f)?.text, "You've found all three of Rolad's missing pages. Return them to him so he can put them back in his book.");
  assert.equal(amount(f, ITEMS.pages), 1);
  assert.deepEqual([amount(f, ITEMS.page1), amount(f, ITEMS.page2), amount(f, ITEMS.page3)], [0, 0, 0]);
  void Quest;
});

test("the schematics puzzle: the captured start, 5-pixel moves, quarter turns, and a snap onto the drawing (ticks 2697-2795)", async (t) => {
  const f = H.actor(t, { stage: 80, items: [ITEMS.base, ITEMS.schematic1, ITEMS.schematic2, ITEMS.schematic3], at: [2862, 9877, 0] });
  const slot = f.player.getInventory().getSlotForItemId(ITEMS.schematic1);
  await H.itemOption(f, ITEMS.schematic1, "Assemble");
  assert.equal(Schematics.isOpen(f.player), true);
  assert.deepEqual(Schematics.state(f.player).pieces, [{ x: 371, y: 137, rotation: 4 }, { x: 24, y: 202, rotation: 2 }, { x: 182, y: 199, rotation: 2 }]);
  const { buttons } = Schematics.resolveIds();
  const press = async (uid, times = 1) => {
    for (let i = 0; i < times; i++) {
      await f.connection.dispatch([{ type: "widget_action", widgetId: uid, groupId: uid >>> 16, childId: uid & 0xffff, buttonNum: 1, opId: 1, slot: -1, itemId: -1 }]);
      H.tick(f);
    }
  };
  await press(buttons.left);
  assert.deepEqual(Schematics.state(f.player).pieces[0], { x: 366, y: 137, rotation: 4 }, "piece 1 is selected to start");
  assert.ok(H.callsNamed(f, "sendSound").some((call) => call.args[0] === 1412), "paper_move");
  await press(buttons.right);
  await press(buttons.rotate);
  await press(buttons.left, 26);
  await press(buttons.down, 7);
  await press(buttons.select[0]);
  await press(buttons.select[1]);
  await press(buttons.rotate, 3);
  await press(buttons.right, 42);
  await press(buttons.up, 6);
  await press(buttons.select[1]);
  await press(buttons.select[2]);
  await press(buttons.rotate, 3);
  await press(buttons.right, 11);
  await press(buttons.up, 3);
  assert.equal(Schematics.state(f.player).solved, false, "piece 3 still 10 pixels off");
  await press(buttons.up);
  const state = Schematics.state(f.player);
  assert.equal(state.solved, true);
  assert.deepEqual(state.pieces.map(({ x, y }) => [x, y]), [[239, 171], [236, 173], [239, 174]], "snapped together");
  assert.equal(f.player.getInventory().get(slot)?.getId(), ITEMS.assembled, "in Dondakan's part's slot");
  assert.deepEqual([ITEMS.base, ITEMS.schematic2, ITEMS.schematic3].map((id) => amount(f, id)), [0, 0, 0]);
  assert.ok(H.callsNamed(f, "sendVarbit").some((call) => call.args[0] === 305 && call.args[1] === 1));
});

test("the cannon: Dondakan's cutscene, the landing, stage 90 and the first thoughts, then the helmet's time (ticks 3209-3350)", async (t) => {
  const f = H.actor(t, { stage: 80, items: [ITEMS.assembled], worn: [ITEMS.helmet] });
  const npc = H.spawn(f, DONDAKAN, H.DONDAKAN_TILE);
  await H.talk(f, npc);
  await H.until(f, "Ready as I'll ever be");
  await H.choose(f, "Ready as I'll ever be.");
  await H.until(f, "Okay, here we go, let me have a look at those schematics and we'll get started.");
  await H.continueLine(f);
  const t0 = f.tick;
  H.ticks(f, 3);
  assert.deepEqual(H.xy(f.player.getLocation()), [2057, 4978, 3], "in the cannon at 3");
  H.ticks(f, 5);
  assert.ok(f.animations.some((a) => a.tick - t0 === 8 && a.id === 1850), "dwarfrock_cannon_incannon at 8");
  const opened = () => H.callsNamed(f, "sendInterface", t0).map((call) => call.args[0]);
  H.ticks(f, 37);
  assert.ok(opened().includes(112), "the zoomed heads (dwarf_rock_cannon) at 44");
  H.ticks(f, 29);
  const at = H.xy(f.player.getLocation());
  assert.ok([[2426, 4965, 0], [2323, 4939, 0]].some((spot) => spot.join() === at.join()), `landed on a recorded spot (${at})`);
  H.ticks(f, 10);
  assert.equal(H.quest().getStage(f.player), 90);
  assert.equal(amount(f, ITEMS.assembled), 0, "the schematic used up");
  const dondakanLines = f.messages.filter((m) => m.tick >= t0 && m.text.startsWith("Dondakan the Dwarf: ")).map((m) => [m.tick - t0, m.text]);
  assert.deepEqual(dondakanLines, [
    [14, "Dondakan the Dwarf: Right, sitting comfortably?"],
    [23, "Dondakan the Dwarf: Excellent, excellent, I'll get the cannon ready to fire then!"],
    [37, "Dondakan the Dwarf: Just think of all that gold!"],
    [51, "Dondakan the Dwarf: Don't worry, it'll all be over in a moment!"],
  ]);
  await H.until(f, "Your helmet starts to feel heavier and heavier!");
  assert.equal(Mine.timing(f.player), false, "no time before the box is continued");
  await H.continueLine(f);
  assert.equal(Mine.timing(f.player), true);
  assert.ok(H.callsNamed(f, "sendVarbit").some((call) => call.args[0] === Mine.TIMER_VARBIT && call.args[1] === 800));
});

test("inside: the time drops by 25 every 25 ticks with its messages; the helmet off takes the player out and the gold with it (ticks 3350-3454, 3679, 5751-5757)", async (t) => {
  const f = H.actor(t, { stage: 90, worn: [ITEMS.helmet], items: [ITEMS.goldOre, ITEMS.goldOre], at: [2420, 4965, 0] });
  Mine.startTimer(f.player);
  H.ticks(f, 100);
  assert.equal(Mine.timeLeft(f.player), 700);
  assert.equal(lastMessage(f), "The helmet seems to become even heavier...");
  f.player.getEquipment().setItem(H.core.Equipment.HEAD_SLOT, new H.core.Item(-1, 0));
  f.player.getInventory().add(new H.core.Item(ITEMS.helmet, 1), false);
  const t0 = f.tick;
  H.ticks(f, 2);
  assert.deepEqual(H.xy(f.player.getLocation()), [2825, 10171, 0]);
  assert.ok(f.messages.some((m) => m.text === "The world turns black and you feel as if you're being sucked out of the rock."));
  assert.equal(amount(f, ITEMS.goldOre), 0);
  assert.equal(Mine.timing(f.player), false);
  H.ticks(f, 7);
  assert.ok(H.callsNamed(f, "sendString", t0).some((call) => String(call.args[0]).startsWith("You suddenly notice all the gold")), "the gold's box");
});

test("the walls of flame: a leap with its message and 5 damage after 23 ticks; the centre is too hot (ticks 3517-3561)", async (t) => {
  const f = H.actor(t, { stage: 90, worn: [ITEMS.helmet], at: [2389, 4967, 0] });
  f.player.getSkillManager().setMaxLevels(H.core.Skill.HITPOINTS, 50, false).setCurrentLevels(H.core.Skill.HITPOINTS, 50, false);
  await H.objectOption(f, 5977, [2388, 4967], 1);
  assert.equal(lastMessage(f), "You close your eyes and leap through the flames! Ouch!");
  H.ticks(f, 3);
  assert.deepEqual(H.xy(f.player.getLocation()), [2387, 4967, 0]);
  H.ticks(f, 22);
  const pans = H.callsNamed(f, "sendCameraMoveTo").map((call) => call.args.slice(0, 2).join(","));
  assert.deepEqual(pans, ["2392,4967", "2378,4967", "2373,4942"], "the recorded jump's camera");
  H.ticks(f, 2);
  assert.equal(f.player.getHitpoints(), 45, "5 damage as the camera comes back");
  f.player.setLocation(new H.core.Location(2374, 4956, 0));
  await H.objectOption(f, 5979, [2373, 4956], 1);
  assert.equal(lastMessage(f), "The flames are too hot in the centre!");
});

test("the Avatar: after the Being's speech it appears at 2375,4951; killing it takes the player out at once (ticks 3563-3574, 5750-5751)", async (t) => {
  const f = H.actor(t, { stage: 90, worn: [ITEMS.helmet], items: Array(6).fill(ITEMS.goldOre), at: [2374, 4956, 0] });
  Mine.startTimer(f.player);
  await H.objectOption(f, 5979, [2373, 4956], 2);
  H.ticks(f, 2);
  assert.equal(H.shown(f)?.text, "You did not heed my messages to stay away! You have brought doom down on to yourself!");
  assert.ok(H.callsNamed(f, "sendCameraShake").length > 0, "the room shakes");
  await H.until(f, "You are no match for me!");
  await H.continueLine(f);
  const avatar = [...H.core.World.getNpcs()].find((npc) => npc && npc.getOwner?.() === f.player && npc.getId() >= 1227 && npc.getId() <= 1235);
  assert.ok(avatar, "the Avatar");
  assert.deepEqual(H.xy(avatar.getLocation()), [2375, 4951, 0]);
  H.PM.emitNpcDeath({ npc: avatar, npcId: avatar.getId(), killer: f.player });
  assert.deepEqual(H.xy(f.player.getLocation()), [2824, 10171, 0]);
  assert.equal(f.player.getEquipment().get(H.core.Equipment.HEAD_SLOT)?.getId?.() ?? -1, -1, "the helmet comes off");
  assert.equal(amount(f, ITEMS.helmet), 1);
  assert.equal(amount(f, ITEMS.goldOre), 0);
  assert.ok(H.callsNamed(f, "sendVarbit").some((call) => call.args[0] === 299 && call.args[1] === 100), "the quest's next step");
});

test("again: 'hold on to your helmet!' fires the player straight in, the warning box then the time (ticks 3718-3742)", async (t) => {
  const f = H.actor(t, { stage: 90, worn: [ITEMS.helmet] });
  const npc = H.spawn(f, DONDAKAN, H.DONDAKAN_TILE);
  await H.talk(f, npc);
  await H.until(f, "Ready as I'll ever be");
  await H.choose(f, "Ready as I'll ever be.");
  await H.until(f, "Okay, here we go, hold on to your helmet!");
  await H.continueLine(f);
  H.ticks(f, 4);
  const at = H.xy(f.player.getLocation());
  assert.ok([[2426, 4965, 0], [2323, 4939, 0]].some((spot) => spot.join() === at.join()), `on a landing spot at 4 (${at})`);
  await H.until(f, "Your helmet starts to feel heavier and heavier!");
  await H.continueLine(f);
  assert.equal(Mine.timing(f.player), true);
});

test("Fire on Dondakan's cannon before the quest is done: 'This definitely isn't your cannon.' (tick 268)", async (t) => {
  const f = H.actor(t, { stage: 10, at: [2821, 10164, 0] });
  await H.objectOption(f, 5975, [2821, 10165], 1);
  H.ticks(f, 2);
  assert.equal(lastMessage(f), "This definitely isn't your cannon.");
});

test("stage 70: Talk-to asks his question again; stage 80 comes with his schematic (ticks 2079-2138)", async (t) => {
  const f = H.actor(t, { stage: 70 });
  const npc = H.spawn(f, DONDAKAN, H.DONDAKAN_TILE);
  await H.talk(f, npc);
  assert.equal(H.shown(f)?.text, "So you want to... fire me into the rock?");
  await H.until(f, "I can't argue with that, shoot me in!");
  await H.choose(f, "I can't argue with that, shoot me in!");
  assert.equal(H.quest().getStage(f.player), 70);
  await H.until(f, "That's what I thought you'd say.");
  await H.finishChat(f);
  assert.equal(H.quest().getStage(f.player), 80);
  assert.equal(amount(f, ITEMS.schematic1), 1);
  await H.talk(f, npc);
  assert.equal(H.shown(f)?.text, "What did you want me to find again?", "still looking (tick 2140)");
});

test("after the quest Khorvak and the Dwarven Engineer say their own things (tick 6113)", async (t) => {
  const f = H.actor(t, { stage: 100, at: [2863, 9876, 0] });
  const khorvak = H.spawn(f, KHORVAK, [2862, 9876, 0]);
  await H.talk(f, khorvak);
  assert.equal(H.shown(f)?.text, "Hello there.");
  const g = H.actor(t, { stage: 100, at: [2871, 10197, 0] });
  const engineer = H.spawn(g, 4893, [2871, 10198, 0]);
  await H.talk(g, engineer);
  assert.equal(H.shown(g)?.text, "I wish you'd just leave me alone.");
});

test("the helmet's warning holds the player; closed some other way, the time starts anyway; the helmet off takes them out even before it", async (t) => {
  const f = H.actor(t, { stage: 90, worn: [ITEMS.helmet] });
  const npc = H.spawn(f, DONDAKAN, H.DONDAKAN_TILE);
  await H.talk(f, npc);
  await H.until(f, "Ready as I'll ever be");
  await H.choose(f, "Ready as I'll ever be.");
  await H.until(f, "Okay, here we go, hold on to your helmet!");
  await H.continueLine(f);
  await H.until(f, "Your helmet starts to feel heavier and heavier!");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true, "held at the box");
  f.player.getDialogueManager().reset();
  f.player.getPacketSender().sendInterfaceRemoval();
  H.ticks(f, 2);
  assert.equal(Mine.timing(f.player), true, "the time runs once the box is gone");
  const g = H.actor(t, { stage: 90, worn: [ITEMS.helmet], at: [2420, 4965, 0] });
  assert.equal(Mine.timing(g.player), false, "no time yet");
  g.player.getEquipment().setItem(H.core.Equipment.HEAD_SLOT, new H.core.Item(-1, 0));
  H.ticks(g, 2);
  assert.deepEqual(H.xy(g.player.getLocation()), [2825, 10171, 0], "out without the helmet");
});

test("the helmet off mid-leap: the player stays out and takes no fire damage", async (t) => {
  const f = H.actor(t, { stage: 90, worn: [ITEMS.helmet], at: [2389, 4967, 0] });
  f.player.getSkillManager().setMaxLevels(H.core.Skill.HITPOINTS, 50, false).setCurrentLevels(H.core.Skill.HITPOINTS, 50, false);
  Mine.startTimer(f.player);
  await H.objectOption(f, 5977, [2388, 4967], 1);
  f.player.getEquipment().setItem(H.core.Equipment.HEAD_SLOT, new H.core.Item(-1, 0));
  H.ticks(f, 30);
  assert.deepEqual(H.xy(f.player.getLocation()), [2825, 10171, 0]);
  assert.equal(f.player.getHitpoints(), 50);
  assert.equal(H.callsNamed(f, "sendVarbit").filter((call) => call.args[0] === 12393).at(-1)?.args[1], 0, "not left busy");
});

test("after the quest the helmet off leaves the mine; a login inside it, or in the cannon's cutscene area, is outside", async (t) => {
  const f = H.actor(t, { stage: 100, worn: [ITEMS.helmet], at: [2420, 4965, 0] });
  H.tick(f);
  f.player.getEquipment().setItem(H.core.Equipment.HEAD_SLOT, new H.core.Item(-1, 0));
  H.ticks(f, 2);
  assert.deepEqual(H.xy(f.player.getLocation()), [2825, 10171, 0]);
  for (const [at, out] of [[[2420, 4965, 0], [2825, 10171, 0]], [[2057, 4978, 3], [2825, 10168, 0]]]) {
    const g = H.actor(t, { stage: 80, at });
    H.PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername() });
    assert.deepEqual(H.xy(g.player.getLocation()), out);
  }
});

test("a visit ended without the helmet coming off (a teleport) takes its time with it; the helmet off at the warning closes it, and no time starts outside", async (t) => {
  const f = H.actor(t, { stage: 90, worn: [ITEMS.helmet], at: [2420, 4965, 0] });
  Mine.startTimer(f.player);
  H.tick(f);
  f.player.moveTo(new H.core.Location(3222, 3218, 0));
  H.ticks(f, 2);
  assert.equal(Mine.timing(f.player), false, "the time ends with the visit");
  const g = H.actor(t, { stage: 90, worn: [ITEMS.helmet] });
  const npc = H.spawn(g, DONDAKAN, H.DONDAKAN_TILE);
  await H.talk(g, npc);
  await H.until(g, "Ready as I'll ever be");
  await H.choose(g, "Ready as I'll ever be.");
  await H.until(g, "Okay, here we go, hold on to your helmet!");
  await H.continueLine(g);
  await H.until(g, "Your helmet starts to feel heavier and heavier!");
  g.player.getEquipment().setItem(H.core.Equipment.HEAD_SLOT, new H.core.Item(-1, 0));
  H.ticks(g, 2);
  assert.deepEqual(H.xy(g.player.getLocation()), [2825, 10171, 0]);
  assert.equal(H.shown(g), null, "the warning is gone");
  H.ticks(g, 5);
  assert.equal(Mine.timing(g.player), false);
});
