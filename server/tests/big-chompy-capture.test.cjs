// Run after `yarn build`: node --test tests/big-chompy-capture.test.cjs
//
// Big Chompy Bird Hunting against the user's whole-quest rsprox capture (BigChompyBirdHunting.bin,
// revision 242.1; docs/quests/big-chompy-bird-hunting/README.md). Real Player, PlayerSession and
// ClientConnection, the real plugins, cache and map: talks and clicks are packets and each tick runs as
// World.process does. Tick numbers in the names are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");

h.key = "big_chompy_bird_hunting";
const RANTZ_AT = [2630, 2980, 0];
const BY_RANTZ = [2630, 2981, 0];
const CHEST = [2637, 9398];
const BY_CHEST = [2638, 9397, 0];
const SPIT = [2630, 2990];
const BY_SPIT = [2630, 2989, 0];
const CLEARING = [2636, 2967, 0];
const TOAD_AT = [2596, 2962, 0];
const BY_TOAD = [2597, 2962, 0];
const RANTZ_PARENT = 1470;
const OBJECTBOX = 193;
const VARBIT_HINT = 14192;
const VARBIT_ROASTER = 1770;

let I, N, core;
before(async () => {
  await h.setup([[2630, 2980], [2645, 9390], [2600, 2965], [2636, 2966]]);
  core = h.core;
  I = core.ItemIdentifiers;
  N = core.NpcIdentifiers;
});
after(() => h.teardown());

const stage = (f) => h.stage(f);
const messages = (f) => f.messages.map((m) => String(m.text));
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const amount = (f, id) => f.player.getInventory().getAmount(id);
const at = (f) => { const l = f.player.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };

function actor(t, { stage: value = 0, items = [], tile = BY_RANTZ, attributes = {} } = {}) {
  const f = h.actor(t, { at: tile, done: [], stage: value, attributes });
  for (const [id, count] of items) f.player.getInventory().add(new core.Item(id, count), false);
  return f;
}

/** Math.random fixed to `value` while `run` plays. */
async function withRandom(value, run) {
  const original = Math.random;
  Math.random = () => value;
  try { return await run(); } finally { Math.random = original; }
}

/** The inventory op the cache names `option` on `itemId` (inventory 149), as the client sends it. */
async function itemOp(f, itemId, option) {
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId?.() === itemId);
  const op = [2, 3, 4, 5, 6, 7].find((n) => ItemActionPacketListener.resolveInventoryWidgetAction(itemId, n)?.option === option);
  assert.ok(op, `${option} on ${itemId}`);
  await h.dispatch(f, { type: "widget_action", widgetId: 149 << 16, groupId: 149, childId: 0, buttonNum: op, slot, itemId });
}

async function itemOnNpc(f, itemId, npc) {
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId?.() === itemId);
  await h.dispatch(f, { type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot, widgetId: 149 << 16 });
}

async function talk(f, id, tile, picks = []) {
  const npc = h.spawn(f, id, tile);
  return h.converse(f, () => h.talk(f, npc), picks);
}

/** Ticks until `check` holds, returning how many were needed. */
function until(f, check, limit = 60) {
  for (let i = 1; i <= limit; i++) {
    h.tick(f);
    if (check()) return i;
  }
  assert.fail("condition never held");
}

test("the children ask about the fatsy toadies until the toad is shown (628, 638, 657), then send the player to Rantz (1150, 1154)", async (t) => {
  for (const value of [15, 20]) {
    const f = actor(t, { stage: value, tile: [2645, 9390, 0] });
    assert.equal((await talk(f, N.BUGS, [2642, 9389, 0]))[0], "PLAYER: Rantz said that you play with the 'fatsy toadies', what are they?");
  }
  const f = actor(t, { stage: 45, tile: [2645, 9390, 0] });
  assert.deepEqual(await talk(f, N.BUGS, [2642, 9389, 0]), ["Bugs: You's better talk to Dad, he might have something for you to do."]);
  assert.deepEqual(await talk(f, N.FYCIE, [2648, 9390, 0]), ["Fycie: You's better talk to Dad, him chasey sneaky chompy."]);
});

test("the quest moves to 15 as Rantz says the children make the fatsy toadies (580)", async (t) => {
  const f = actor(t, { stage: 10 });
  const lines = await talk(f, RANTZ_PARENT, RANTZ_AT, ["How do we make the chompys come?", "Ok, thanks."]);
  assert.ok(lines.some((line) => line.startsWith("Rantz: Dey's fussie eaters just like Rantz.")));
  assert.equal(stage(f), 15);
});

test("showing the toad: 25 on the player's line (779), the toad in an item box, then the clearing's arrow and camera (786-836)", async (t) => {
  const f = actor(t, { stage: 20, items: [[I.BLOATED_TOAD, 1]] });
  const npc = h.spawn(f, RANTZ_PARENT, RANTZ_AT);
  await h.talk(f, npc);
  for (let i = 0; i < 40 && !String(h.shown(f)?.text).startsWith("Yes, I have a 'fatsy toady'"); i++) await h.continueLine(f);
  assert.equal(stage(f), 25);
  await h.continueLine(f);
  assert.equal(f.player.getPacketSender().getChatboxGroupId(), OBJECTBOX);
  for (let i = 0; i < 10 && !String(h.shown(f)?.text).startsWith("Over 'dere creature"); i++) await h.continueLine(f);
  assert.equal(varbit(f, VARBIT_HINT), 7);
  assert.equal(f.player.getPacketSender().getCameraState?.()?.mode ?? "controlled", "controlled");
  await h.continueLine(f);
  h.ticks(f, 50);
  assert.equal(varbit(f, VARBIT_HINT), 0, "the arrow goes 50 ticks after it was drawn");
});

test("with the bait down, and while Rantz shoots, Rantz plays the placed-bait page (894, 1010)", async (t) => {
  for (const value of [30, 35]) {
    const f = actor(t, { stage: value });
    assert.equal((await talk(f, RANTZ_PARENT, RANTZ_AT))[0], "PLAYER: There you go, I've placed the bait.");
  }
});

test("the bait: refused before Rantz shows where (transcript), placed with its message and animation at 25 (843-844)", async (t) => {
  const early = actor(t, { stage: 20, items: [[I.BLOATED_TOAD, 1]], tile: CLEARING });
  await itemOp(early, I.BLOATED_TOAD, "Drop");
  assert.ok(messages(early).includes("You're not sure where Rantz told you to place the bloated toad. You decide to wait and ask him where to place it."));
  assert.equal(amount(early, I.BLOATED_TOAD), 1);

  const f = actor(t, { stage: 25, items: [[I.BLOATED_TOAD, 2]], tile: CLEARING });
  await withRandom(0.99, async () => {
    await itemOp(f, I.BLOATED_TOAD, "Drop");
    assert.ok(messages(f).includes("You carefully place the bloated toad bait."));
    assert.ok(f.animations.some((a) => a.id === 827));
    assert.equal(stage(f), 30);
    assert.equal(amount(f, I.BLOATED_TOAD), 1);
    // A bait that bursts unanswered leaves the quest at 30 (943: no varp change).
    h.ticks(f, 101);
  });
  assert.equal(stage(f), 30);
});

test("the demonstration: 35 eleven ticks after the bird lands, Rantz's call and shot, the miss, 40 as the bait is eaten (992-1018)", async (t) => {
  const f = actor(t, { stage: 25, items: [[I.BLOATED_TOAD, 1]], tile: CLEARING });
  h.spawn(f, RANTZ_PARENT, RANTZ_AT);
  await withRandom(0.99, () => itemOp(f, I.BLOATED_TOAD, "Drop"));
  // Step away so the bird can land and walk to the bait; the 25th tick's roll succeeds.
  f.player.moveTo(new core.Location(2630, 2976, 0));
  await withRandom(0.99, () => h.ticks(f, 23));
  const original = Math.random;
  let landed = null;
  Math.random = () => 0.01;
  try {
    for (let i = 0; i < 4 && !landed; i++) {
      h.tick(f);
      landed = core.World.getNpcs().search?.((npc) => npc?.getId?.() === N.CHOMPY_BIRD) ?? null;
    }
  } finally { Math.random = original; }
  assert.ok(landed, "a bird landed");
  const from = f.tick;
  const stageAt35 = until(f, () => stage(f) === 35);
  assert.equal(stageAt35, 11);
  until(f, () => messages(f).includes("Rantz: Hey, dere's da chompy, I's gonna shoot it."));
  assert.equal(f.tick - from, 17);
  until(f, () => messages(f).includes("Rantz keeps missing the chompy bird..."));
  assert.equal(f.tick - from, 22);
  assert.ok(messages(f).includes("Rantz: Grrr...de'ese arrows are rubbish."));
  assert.ok(!messages(f).includes("A chompy swoops down!"));
  until(f, () => stage(f) === 40, 20);
});

test("the chest: Humph!, the lift, the open chest and 20 (645-646); its Search asks how many bellows (649) and gives them (651)", async (t) => {
  const f = actor(t, { stage: 15, tile: BY_CHEST });
  const tile = new core.Location(CHEST[0], CHEST[1], 0);
  await withRandom(0, () => h.clickObject(f, core.ObjectIdentifiers.LOCKED_OGRE_CHEST, CHEST));
  h.ticks(f, 3);
  assert.ok(messages(f).includes("You manage to lift the huge rock off the chest."));
  assert.ok(f.animations.some((a) => a.id === 832));
  assert.equal(stage(f), 20);
  const chestIds = () => core.ObjectManager.objectsAt(tile).map((object) => object.getId());
  assert.ok(chestIds().includes(core.ObjectIdentifiers.UNLOCKED_OGRE_CHEST), "the chest is open");
  assert.ok(!chestIds().includes(core.ObjectIdentifiers.LOCKED_OGRE_CHEST));
  const menus = [];
  const sender = f.player.getPacketSender();
  const send = sender.sendCreationMenu.bind(sender);
  sender.sendCreationMenu = (menu) => { menus.push(menu); return send(menu); };
  const free = f.player.getInventory().getFreeSlots();
  await h.clickObject(f, core.ObjectIdentifiers.UNLOCKED_OGRE_CHEST, CHEST);
  h.ticks(f, 2);
  assert.equal(menus.length, 1, "one how-many menu");
  assert.ok(f.animations.some((a) => a.id === 536));
  (menus[0].getAction?.() ?? menus[0].action).execute(I.OGRE_BELLOWS, 8);
  assert.equal(amount(f, I.OGRE_BELLOWS), Math.min(8, free));
  assert.equal(h.shown(f)?.text, "You take 8 pairs of bellows.");
  h.ticks(f, 101);
  assert.deepEqual(chestIds(), [core.ObjectIdentifiers.LOCKED_OGRE_CHEST], "and locks again (ours)");
});

test("a failed lift: the strain, too heavy, Arrgghhhhh! and Strength down by 1 (1739-1742)", async (t) => {
  const g = actor(t, { stage: 65, tile: BY_CHEST });
  const before = g.player.getSkillManager().getCurrentLevel(core.Skill.STRENGTH);
  await withRandom(0.999, () => h.clickObject(g, core.ObjectIdentifiers.LOCKED_OGRE_CHEST, CHEST));
  h.ticks(g, 5);
  assert.ok(messages(g).includes("You strain to lift the huge rock off the chest..."));
  assert.ok(messages(g).includes("... but it's just too heavy for you.<br>The experience has left you feeling temporarily weakened."));
  assert.equal(g.player.getSkillManager().getCurrentLevel(core.Skill.STRENGTH), before - 1);
});

test("inflating a toad: overhead, animations and message on arrival, the toad in the pack four ticks later (721-725)", async (t) => {
  const f = actor(t, { stage: 20, items: [[I.OGRE_BELLOWS_3_, 1]], tile: BY_TOAD });
  const toad = h.spawn(f, N.SWAMP_TOAD, TOAD_AT);
  await h.dispatch(f, { type: "npc_option", index: toad.getIndex(), clickType: 1 });
  const start = f.tick;
  const tickOf = (text) => f.messages.find((m) => m.text === text)?.tick;
  until(f, () => tickOf("You manage to catch the toad and inflate it with the swamp gas.") !== undefined, 10);
  assert.ok(f.animations.some((a) => a.id === 1026));
  until(f, () => amount(f, I.BLOATED_TOAD) === 1, 10);
  assert.equal(tickOf("You add the bloated toad to your inventory.") - tickOf("You manage to catch the toad and inflate it with the swamp gas."), 4);
  assert.ok(messages(f).includes("You add the bloated toad to your inventory."));
  assert.equal(amount(f, I.OGRE_BELLOWS_2_), 1);
  assert.equal(toad.isRegistered(), false);
  assert.ok(f.tick - start < 12);
});

test("a fourth bloated toad lets one escape (1242)", async (t) => {
  const f = actor(t, { stage: 45, items: [[I.OGRE_BELLOWS_1_, 1], [I.BLOATED_TOAD, 1], [I.BLOATED_TOAD, 1], [I.BLOATED_TOAD, 1]], tile: BY_TOAD });
  const toad = h.spawn(f, N.SWAMP_TOAD, TOAD_AT);
  await h.dispatch(f, { type: "npc_option", index: toad.getIndex(), clickType: 1 });
  h.ticks(f, 8);
  assert.ok(messages(f).includes("One of your bloated toads manages to escape."));
  assert.equal(amount(f, I.BLOATED_TOAD), 3);
  assert.equal(amount(f, I.OGRE_BELLOWS), 1);
});

test("the hunted bird gets the hint arrow, dies into its carcass in place at 50, and plucks to the ground (1323-1352)", async (t) => {
  const f = actor(t, { stage: 45, items: [[I.BLOATED_TOAD, 1]], tile: CLEARING });
  await withRandom(0.99, () => itemOp(f, I.BLOATED_TOAD, "Drop"));
  f.player.moveTo(new core.Location(2633, 2969, 0));
  await withRandom(0.99, () => h.ticks(f, 23));
  let bird = null;
  await withRandom(0.01, () => {
    for (let i = 0; i < 4 && !bird; i++) {
      h.tick(f);
      bird = core.World.getNpcs().search?.((npc) => npc?.getId?.() === N.CHOMPY_BIRD) ?? null;
    }
  });
  assert.ok(bird);
  assert.equal(varbit(f, VARBIT_HINT), 7);
  bird.getCombat().addDamage(f.player, 10);
  bird.setHitpoints(0);
  // Its last hit: the engine's death task plays the death and hands the kill to the quest.
  h.ticks(f, 4);
  assert.equal(stage(f), 50);
  assert.equal(varbit(f, VARBIT_HINT), 0);
  assert.equal(bird.isRegistered(), true, "the bird stays as its carcass");
  assert.equal(bird.getNpcTransformationId(), N.CHOMPY_BIRD_2);
  assert.ok(!messages(f).includes("You killed the chompy bird."));

  f.player.moveTo(new core.Location(bird.getLocation().getX(), bird.getLocation().getY() + 1, 0));
  const feathers = amount(f, I.FEATHER);
  const hunter = f.player.getSkillManager().getExperience(core.Skill.HUNTER);
  await h.dispatch(f, { type: "npc_option", index: bird.getIndex(), clickType: 4 });
  assert.ok(messages(f).includes("You start plucking the chompy bird."));
  h.ticks(f, 3);
  assert.equal(bird.isRegistered(), false);
  const gained = amount(f, I.FEATHER) - feathers;
  assert.ok(gained >= 10 && gained <= 30, `feathers ${gained}`);
  assert.equal(amount(f, I.RAW_CHOMPY), 0, "the raw chompy is on the ground");
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.HUNTER) - hunter, 30);
});

test("the spit-roast: three steps two ticks apart with the roaster varbit, the seasonings named in the item box (1472-1476)", async (t) => {
  const f = actor(t, { stage: 55, tile: BY_SPIT, items: [[I.RAW_CHOMPY, 1], [I.ONION, 1], [I.TOMATO, 1], [I.EQUA_LEAVES, 1]],
    attributes: {
      "big-chompy-bird-hunting:rantz-ingredient": I.ONION,
      "big-chompy-bird-hunting:fycie-ingredient": I.TOMATO,
      "big-chompy-bird-hunting:bugs-ingredient": I.EQUA_LEAVES,
    } });
  await h.dispatch(f, { type: "item_on_object", objectId: 6895, x: SPIT[0], y: SPIT[1], itemId: I.RAW_CHOMPY, slot: 0, widgetId: 149 << 16 });
  for (let i = 0; i < 6 && !messages(f).includes("You carefully place the chompy bird on the spit-roast."); i++) h.tick(f);
  const placed = f.tick;
  assert.equal(varbit(f, VARBIT_ROASTER), 1);
  assert.equal(amount(f, I.RAW_CHOMPY), 0);
  until(f, () => messages(f).includes("You add the other ingredients and cook the food."), 4);
  assert.equal(f.tick - placed, 2);
  assert.equal(varbit(f, VARBIT_ROASTER), 2);
  until(f, () => messages(f).includes("Eventually the chompy is cooked."), 4);
  assert.equal(f.tick - placed, 4);
  assert.equal(varbit(f, VARBIT_ROASTER), 0);
  assert.equal(stage(f), 60);
  assert.equal(amount(f, I.SEASONED_CHOMPY), 1);
  for (const id of [I.ONION, I.TOMATO, I.EQUA_LEAVES]) assert.equal(amount(f, id), 0);
  assert.equal(h.shown(f)?.text, "You use the onion, tomato and the equa leaves with the chompy bird to make a seasoned chompy.");
});

test("each ogre names the same seasoning every time: Rantz's first request follows his pick", async (t) => {
  const f = actor(t, { stage: 50, items: [[I.RAW_CHOMPY, 1]], attributes: { "big-chompy-bird-hunting:rantz-ingredient": I.POTATO } });
  const lines = await talk(f, RANTZ_PARENT, RANTZ_AT);
  assert.ok(lines.some((line) => line.includes("Me's wants Potato wiv mine!")), JSON.stringify(lines));
  assert.equal(stage(f), 55);
  const again = await talk(f, RANTZ_PARENT, RANTZ_AT);
  assert.ok(again.some((line) => line.includes("Me's wants Potato wiv mine!")));
});

test("Bugs names his seasoning the same each time (1415, 1431)", async (t) => {
  const g = actor(t, { stage: 55, tile: [2645, 9390, 0], attributes: { "big-chompy-bird-hunting:bugs-ingredient": I.CABBAGE } });
  const bugs = h.spawn(g, N.BUGS, [2642, 9389, 0]);
  // The harness folds a repeated line into one, so the chat's copies are counted.
  for (let i = 0; i < 3; i++) await h.converse(g, () => h.talk(g, bugs));
  const asked = messages(g).filter((text) => text.startsWith("Bugs|Dad say's you's making da chompy for us!"));
  assert.equal(asked.length, 3);
  assert.ok(asked.every((text) => text.includes("Me's has to have cabbage wiv mine!")));
});

test("Rantz's post-quest menus are the capture's two (1528, 1532, 1537)", async (t) => {
  const f = actor(t, { stage: 65 });
  const npc = h.spawn(f, RANTZ_PARENT, RANTZ_AT);
  const first = "What are the hats like?|Can you show me the hats please?|How many chompies do I have to stick?|Can I have a hat please?|Ok, thanks.";
  await h.talk(f, npc);
  for (let i = 0; i < 6 && h.shown(f)?.who !== "menu"; i++) await h.continueLine(f);
  assert.equal(h.shown(f).text, first);
  await h.choose(f, "What are the hats like?");
  for (let i = 0; i < 6 && h.shown(f)?.who !== "menu"; i++) await h.continueLine(f);
  assert.equal(h.shown(f).text, "How many chompies do I have to stick?|How do I get a hat?|Can I have a hat please?|Can you show me the hats please?|Ok, thanks.");
  await h.choose(f, "How many chompies do I have to stick?");
  for (let i = 0; i < 6 && h.shown(f)?.who !== "menu"; i++) await h.continueLine(f);
  assert.equal(h.shown(f).text, first);
});

test("the completion scroll is the capture's (1513)", (t) => {
  const quest = h.quest();
  const lines = h.QuestRuntime.rewardLines(quest);
  assert.deepEqual(lines.slice(1), ["2 Quest Points", "1,470 Cooking XP", "735 Ranged XP", "262 Fletching XP", "An Ogre Bow", "Ability to make Ogre Arrows"]);
});

test("the ogre bow's Check kills before the quest is done (1089)", async (t) => {
  const f = actor(t, { stage: 45, items: [[I.OGRE_BOW, 1]] });
  await itemOp(f, I.OGRE_BOW, "Check kills");
  assert.ok(messages(f).includes("You've scratched up no kills yet!<br>You've got to complete the quest first!"));
});

test("items on Rantz: the bloated toad at 25 (826) and the ogre bow at 45 (1081)", async (t) => {
  const f = actor(t, { stage: 25, items: [[I.BLOATED_TOAD, 1]] });
  const npc = h.spawn(f, RANTZ_PARENT, RANTZ_AT);
  const lines = await h.converse(f, () => itemOnNpc(f, I.BLOATED_TOAD, npc));
  assert.deepEqual(lines, ["ItemStatementDialogue: You show the bloated toad to Rantz.", "Rantz: Hey creature got da fatsy toady Is you's gonna stick da chompy?"]);
  const g = actor(t, { stage: 45, items: [[I.OGRE_BOW, 1]] });
  const rantz = h.spawn(g, RANTZ_PARENT, RANTZ_AT);
  const said = await h.converse(g, () => itemOnNpc(g, I.OGRE_BOW, rantz));
  assert.deepEqual(said, ["Rantz: Yeah, it's a goodly stabbie chucker, but you's is too weedy to use it like Rantz."]);
});

test("stage 0 to 65 with real clicks: start, arrows, chest, toads, demonstration, bow, kill, pluck, cook, hand-in", async (t) => {
  const f = actor(t, { stage: 0, items: [[I.OGRE_ARROW, 6], [I.OGRE_BELLOWS_3_, 1], [I.ONION, 1], [I.POTATO, 1],
    [I.TOMATO, 1], [I.DOOGLE_LEAVES, 1], [I.EQUA_LEAVES, 1], [I.CABBAGE, 1]] });
  const rantz = h.spawn(f, RANTZ_PARENT, RANTZ_AT);
  await h.converse(f, () => h.talk(f, rantz), ["Yes."]);
  assert.equal(stage(f), 5);
  // The hand-in ends on Rantz's questions; the key one moves the quest on (ticks 541, 580).
  await h.converse(f, () => itemOnNpc(f, I.OGRE_ARROW, rantz), ["How do we make the chompys come?", "Ok, thanks."]);
  assert.equal(amount(f, I.OGRE_ARROW), 0);
  assert.equal(stage(f), 15);

  f.player.moveTo(new core.Location(...BY_CHEST));
  await withRandom(0, () => h.clickObject(f, core.ObjectIdentifiers.LOCKED_OGRE_CHEST, CHEST));
  h.ticks(f, 3);
  assert.equal(stage(f), 20);

  f.player.moveTo(new core.Location(...BY_TOAD));
  for (let i = 0; i < 2; i++) {
    const toad = h.spawn(f, N.SWAMP_TOAD, TOAD_AT);
    await h.dispatch(f, { type: "npc_option", index: toad.getIndex(), clickType: 1 });
    h.ticks(f, 6);
  }
  assert.equal(amount(f, I.BLOATED_TOAD), 2);
  assert.equal(amount(f, I.OGRE_BELLOWS_1_), 1);

  f.player.moveTo(new core.Location(...BY_RANTZ));
  await h.converse(f, () => h.talk(f, rantz));
  assert.equal(stage(f), 25);

  f.player.moveTo(new core.Location(...CLEARING));
  await withRandom(0.99, () => itemOp(f, I.BLOATED_TOAD, "Drop"));
  assert.equal(stage(f), 30);
  f.player.moveTo(new core.Location(2630, 2976, 0));
  await withRandom(0.99, () => h.ticks(f, 23));
  await withRandom(0.01, () => h.ticks(f, 3));
  until(f, () => stage(f) === 40, 60);

  f.player.moveTo(new core.Location(...BY_RANTZ));
  await h.converse(f, () => h.talk(f, rantz), ["Come on, let me have a go...", "I'm actually quite strong... please let me try."]);
  assert.equal(stage(f), 45);
  assert.equal(amount(f, I.OGRE_BOW), 1);

  // The demonstration's bird is gone or leaving; a fresh bait brings the hunted one.
  f.player.moveTo(new core.Location(2634, 2966, 0));
  await withRandom(0.99, () => itemOp(f, I.BLOATED_TOAD, "Drop"));
  f.player.moveTo(new core.Location(2633, 2969, 0));
  const before = new Set([...core.World.getNpcs()].filter((npc) => npc?.getId?.() === N.CHOMPY_BIRD));
  await withRandom(0.99, () => h.ticks(f, 23));
  let bird = null;
  await withRandom(0.01, () => {
    for (let i = 0; i < 4 && !bird; i++) {
      h.tick(f);
      bird = [...core.World.getNpcs()].find((npc) => npc?.getId?.() === N.CHOMPY_BIRD && !before.has(npc)) ?? null;
    }
  });
  assert.ok(bird, "the hunted bird");
  bird.getCombat().addDamage(f.player, 10);
  bird.setHitpoints(0);
  h.ticks(f, 4);
  assert.equal(stage(f), 50);

  f.player.moveTo(new core.Location(bird.getLocation().getX(), bird.getLocation().getY() + 1, 0));
  const carcassAt = bird.getLocation().clone();
  await h.dispatch(f, { type: "npc_option", index: bird.getIndex(), clickType: 4 });
  h.ticks(f, 3);
  await h.dispatch(f, { type: "ground_item_action", itemId: I.RAW_CHOMPY, x: carcassAt.getX(), y: carcassAt.getY(), optionIndex: 3 });
  h.ticks(f, 3);
  assert.equal(amount(f, I.RAW_CHOMPY), 1, "the raw chompy is picked up off the carcass's tile");

  f.player.moveTo(new core.Location(...BY_RANTZ));
  await h.converse(f, () => h.talk(f, rantz));
  assert.equal(stage(f), 55);

  f.player.moveTo(new core.Location(...BY_SPIT));
  await h.dispatch(f, { type: "item_on_object", objectId: 6895, x: SPIT[0], y: SPIT[1], itemId: I.RAW_CHOMPY,
    slot: f.player.getInventory().getItems().findIndex((item) => item?.getId?.() === I.RAW_CHOMPY), widgetId: 149 << 16 });
  h.ticks(f, 6);
  assert.equal(stage(f), 60);
  assert.equal(amount(f, I.SEASONED_CHOMPY), 1);
  await h.continueLine(f);

  const xp = (skill) => f.player.getSkillManager().getExperience(skill);
  const cooking = xp(core.Skill.COOKING), ranged = xp(core.Skill.RANGED), fletching = xp(core.Skill.FLETCHING);
  f.player.moveTo(new core.Location(...BY_RANTZ));
  await h.converse(f, () => h.talk(f, rantz));
  assert.equal(stage(f), 65);
  assert.equal(amount(f, I.SEASONED_CHOMPY), 0);
  assert.equal(amount(f, I.OGRE_BOW), 1, "the bow is not given twice");
  assert.equal(xp(core.Skill.COOKING) - cooking, 1470);
  assert.equal(xp(core.Skill.RANGED) - ranged, 735);
  assert.equal(xp(core.Skill.FLETCHING) - fletching, 262);
});

test("the roast gives nothing if the seasonings leave the pack while it cooks (review)", async (t) => {
  const f = actor(t, { stage: 55, tile: BY_SPIT, items: [[I.RAW_CHOMPY, 1], [I.ONION, 1], [I.TOMATO, 1], [I.EQUA_LEAVES, 1]],
    attributes: {
      "big-chompy-bird-hunting:rantz-ingredient": I.ONION,
      "big-chompy-bird-hunting:fycie-ingredient": I.TOMATO,
      "big-chompy-bird-hunting:bugs-ingredient": I.EQUA_LEAVES,
    } });
  await h.dispatch(f, { type: "item_on_object", objectId: 6895, x: SPIT[0], y: SPIT[1], itemId: I.RAW_CHOMPY, slot: 0, widgetId: 149 << 16 });
  for (let i = 0; i < 6 && !messages(f).includes("You carefully place the chompy bird on the spit-roast."); i++) h.tick(f);
  f.player.getInventory().deleteNumber(I.ONION, 1);
  h.ticks(f, 6);
  assert.equal(amount(f, I.SEASONED_CHOMPY), 0);
  assert.equal(amount(f, I.RAW_CHOMPY), 1, "the raw chompy comes back");
  assert.equal(stage(f), 55);
  assert.equal(varbit(f, VARBIT_ROASTER), 0);
});

test("one inflate at a time: two toads clicked a tick apart can't pass the three-toad cap (review)", async (t) => {
  const f = actor(t, { stage: 45, items: [[I.OGRE_BELLOWS_3_, 1], [I.BLOATED_TOAD, 1], [I.BLOATED_TOAD, 1]], tile: BY_TOAD });
  const first = h.spawn(f, N.SWAMP_TOAD, TOAD_AT);
  const second = h.spawn(f, N.SWAMP_TOAD, [2597, 2963, 0]);
  await h.dispatch(f, { type: "npc_option", index: first.getIndex(), clickType: 1 });
  await h.dispatch(f, { type: "npc_option", index: second.getIndex(), clickType: 1 });
  h.ticks(f, 8);
  assert.ok(amount(f, I.BLOATED_TOAD) <= 3, `toads ${amount(f, I.BLOATED_TOAD)}`);
});

test("one lift at a time: a second Unlock while the first plays rolls nothing more (review)", async (t) => {
  const f = actor(t, { stage: 65, tile: BY_CHEST });
  const before = f.player.getSkillManager().getCurrentLevel(core.Skill.STRENGTH);
  await withRandom(0.999, async () => {
    const click = { type: "object_option", id: core.ObjectIdentifiers.LOCKED_OGRE_CHEST, x: CHEST[0], y: CHEST[1], clickType: 1 };
    await h.dispatch(f, click);
    await h.dispatch(f, click);
    h.ticks(f, 6);
  });
  assert.equal(messages(f).filter((m) => m === "You strain to lift the huge rock off the chest...").length, 1);
  assert.equal(f.player.getSkillManager().getCurrentLevel(core.Skill.STRENGTH), before - 1);
});
