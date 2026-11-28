// Run after `yarn build`: node --test tests/the-enchanted-key-capture.test.cjs
//
// The Enchanted Key against the user's whole-miniquest rsprox capture (local 1002311, revision 243)
// and rsprox.net 1702 (revision 226); docs/quests/the-enchanted-key/README.md. Real Player,
// PlayerSession and ClientConnection, the real plugins, cache and map: Feel, Dig, Destroy, the
// merchant and the quest list are packets, and each tick runs as World.process does.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const KEY = 6754, SPADE = 952, COINS = 995, MERCHANT = 8722;
const LOCSTATUS = 1391, STATUS = 13717, MINIQUESTS = 14162;
const ORDER = "enchanted-key:order", FOUND = "enchanted-key:treasures-found";
// The capture's route: the order its eleven locstatus bits were set in (ticks 769-2111).
const ROUTE = ["rellekka", "grand-exchange", "al-kharid", "gnome-stronghold", "south-falador", "south-ardougne",
  "lumbridge-swamp", "mudskipper-point", "west-ardougne", "body-altar", "south-east-varrock"];
// 1702's route (nine found when its journal was opened, tick 3112).
const ROUTE_1702 = ["rellekka", "grand-exchange", "al-kharid", "mudskipper-point", "lumbridge-swamp", "south-ardougne",
  "gnome-stronghold", "south-falador", "west-ardougne", "south-east-varrock", "body-altar"];
// [tick, action, x, y, Feel synth, the line live answered], every Feel and Dig of local 1002311 from
// the tile the click was sent from. Ticks 1942-1943: two double-clicks, which live answers one per
// tick, so the five answers are listed in order from the tiles they were taken on.
const RECORDED = [
  [370, "feel", 1419, 3353, 1199, "It's freezing"],
  [389, "feel", 3221, 3220, 1199, "It's freezing and warmer than last time"],
  [416, "feel", 2660, 3302, 1198, "It's cold and warmer than last time"],
  [435, "feel", 2652, 3321, 1198, "It's cold and warmer than last time"],
  [438, "feel", 2649, 3327, 1198, "It's cold and warmer than last time"],
  [441, "feel", 2643, 3332, 1198, "It's cold and warmer than last time"],
  [444, "feel", 2637, 3335, 1198, "It's cold and warmer than last time"],
  [448, "feel", 2629, 3335, 1198, "It's cold and the same temperature as last time"],
  [512, "feel", 2656, 3317, 1198, "It's cold but colder than last time"],
  [522, "feel", 2646, 3330, 1198, "It's cold and warmer than last time"],
  [526, "feel", 2638, 3334, 1198, "It's cold and warmer than last time"],
  [768, "dig", 2715, 3610, null, "You found some treasure."],
  [772, "dig", 2715, 3610, null, "Nothing interesting happens."],
  [777, "feel", 2718, 3611, 1198, "It's cold"],
  [798, "feel", 3215, 3422, 1202, "It's warm and warmer than last time"],
  [862, "dig", 3161, 3490, null, "You found some treasure."],
  [868, "feel", 3162, 3484, 1198, "It's cold"],
  [886, "feel", 2966, 3378, 1198, "It's cold but colder than last time"],
  [907, "feel", 3226, 3218, 1202, "It's warm and warmer than last time"],
  [939, "feel", 3286, 3218, 1197, "Ouch! It's burning hot and warmer than last time"],
  [944, "feel", 3295, 3222, 1201, "The key is steaming. It must be right below your feet."],
  [948, "feel", 3295, 3222, 1201, "The key is steaming. It must be right below your feet."],
  [951, "feel", 3295, 3221, 1201, "The key is steaming. It must be right below your feet."],
  [955, "dig", 3295, 3222, null, "You found some treasure."],
  [961, "feel", 3297, 3221, 1199, "It's freezing"],
  [985, "feel", 2663, 3300, 1198, "It's cold and warmer than last time"],
  [1011, "feel", 2638, 3338, 1198, "It's cold and warmer than last time"],
  [1018, "feel", 2624, 3344, 1198, "It's cold and warmer than last time"],
  [1021, "feel", 2620, 3342, 1198, "It's cold and warmer than last time"],
  [1024, "feel", 2616, 3344, 1198, "It's cold and warmer than last time"],
  [1029, "feel", 2615, 3354, 1198, "It's cold and warmer than last time"],
  [1036, "feel", 2607, 3365, 1198, "It's cold and warmer than last time"],
  [1041, "feel", 2597, 3365, 1198, "It's cold and warmer than last time"],
  [1045, "feel", 2589, 3365, 1198, "It's cold and warmer than last time"],
  [1048, "feel", 2583, 3368, 1198, "It's cold and warmer than last time"],
  [1051, "feel", 2582, 3363, 1198, "It's cold and warmer than last time"],
  [1054, "feel", 2582, 3357, 1198, "It's cold and the same temperature as last time"],
  [1062, "feel", 2573, 3350, 1198, "It's cold and warmer than last time"],
  [1070, "feel", 2557, 3347, 1202, "It's warm and warmer than last time"],
  [1179, "feel", 2455, 3427, 1197, "Ouch! It's burning hot and warmer than last time"],
  [1183, "feel", 2450, 3435, 1197, "Ouch! It's burning hot and warmer than last time"],
  [1188, "feel", 2446, 3445, 1201, "The key is steaming. It must be right below your feet."],
  [1190, "feel", 2444, 3447, 1201, "The key is steaming. It must be right below your feet."],
  [1191, "dig", 2444, 3447, null, "You found some treasure."],
  [1195, "feel", 2444, 3448, 1199, "It's freezing"],
  [1210, "feel", 2967, 3378, 1202, "It's warm and warmer than last time"],
  [1217, "feel", 2966, 3370, 1202, "It's warm and warmer than last time"],
  [1297, "feel", 2969, 3300, 1201, "The key is steaming. It must be right below your feet."],
  [1298, "dig", 2969, 3300, null, "You found some treasure."],
  [1303, "feel", 2970, 3299, 1198, "It's cold"],
  [1321, "feel", 2663, 3303, 1202, "It's warm and warmer than last time"],
  [1367, "feel", 2617, 3243, 1201, "The key is steaming. It must be right below your feet."],
  [1369, "dig", 2617, 3243, null, "You found some treasure."],
  [1373, "feel", 2617, 3243, 1199, "It's freezing"],
  [1389, "feel", 3221, 3220, 1202, "It's warm and warmer than last time"],
  [1393, "feel", 3223, 3218, 1202, "It's warm but colder than last time"],
  [1409, "feel", 3234, 3205, 1202, "It's warm but colder than last time"],
  [1413, "feel", 3240, 3197, 1202, "It's warm but colder than last time"],
  [1433, "feel", 3218, 3175, 1200, "It's very hot and warmer than last time"],
  [1469, "dig", 3158, 3178, null, "You found some treasure."],
  [1472, "feel", 3158, 3178, 1198, "It's cold"],
  [1481, "feel", 3151, 3187, 1198, "It's cold and warmer than last time"],
  [1486, "feel", 3142, 3196, 1198, "It's cold and warmer than last time"],
  [1492, "feel", 3133, 3204, 1202, "It's warm and warmer than last time"],
  [1555, "feel", 3034, 3246, 1202, "It's warm and warmer than last time"],
  [1607, "feel", 3015, 3165, 1201, "The key is steaming. It must be right below your feet."],
  [1609, "feel", 3018, 3162, 1201, "The key is steaming. It must be right below your feet."],
  [1610, "dig", 3018, 3162, null, "You found some treasure."],
  [1614, "feel", 3018, 3162, 1199, "It's freezing"],
  [1779, "feel", 2431, 3381, 1197, "Ouch! It's burning hot and warmer than last time"],
  [1784, "feel", 2421, 3379, 1201, "The key is steaming. It must be right below your feet."],
  [1785, "feel", 2419, 3378, 1201, "The key is steaming. It must be right below your feet."],
  [1786, "dig", 2419, 3378, null, "You found some treasure."],
  [1792, "feel", 2419, 3378, 1199, "It's freezing"],
  [1901, "feel", 3210, 3421, 1198, "It's cold and warmer than last time"],
  [1940, "feel", 3142, 3422, 1202, "It's warm and warmer than last time"],
  [1942, "feel", 3138, 3422, 1202, "It's warm and warmer than last time"],
  [1943, "feel", 3136, 3422, 1202, "It's warm and warmer than last time"],
  [1943, "feel", 3136, 3422, 1202, "It's warm and the same temperature as last time"],
  [1943, "feel", 3136, 3422, 1202, "It's warm and the same temperature as last time"],
  [1961, "feel", 3100, 3420, 1202, "It's warm and warmer than last time"],
  [1973, "feel", 3076, 3417, 1200, "It's very hot and warmer than last time"],
  [1996, "dig", 3034, 3437, null, "You found some treasure."],
  [2003, "feel", 3034, 3437, 1198, "It's cold"],
  [2109, "feel", 3303, 3345, 1201, "The key is steaming. It must be right below your feet."],
  [2111, "dig", 3303, 3345, null, "You found some treasure."],
];
const STORY = [
  "<str>While helping Jorral to save the Ardougne Outpost, I received",
  "<str>a strange key from Erin the silver merchant, which used to",
  "<str>belong to his great grandfather. By checking the temperature",
  "<str>of the key as I moved from place to place, I was able to find a",
  "<str>buried chest containing a journal.",
];
const PROMPT = "<col=000080>I should see what else I can find with the help of the key.";
// local 1002311 tick 2140: the journal once all eleven are found.
const JOURNAL_DONE = [...STORY,
  "<str>I found some treasure in the Fremennik Province.",
  "<str>I found some treasure south-east of Varrock.",
  "<str>I found some treasure south of Falador.",
  "<str>I found some treasure north of Al Kharid.",
  "<str>I found some treasure in Lumbridge Swamp.",
  "<str>I found some treasure in the Grand Exchange.",
  "<str>I found some treasure north of Falador.",
  "<str>I found some treasure near Jorral's Outpost.",
  "<str>I found some treasure south of Port Sarim.",
  "<str>I found some treasure near the Clock Tower Monastery.",
  "<str>I found some treasure in the Gnome Stronghold.",
  "<str>The key doesn't seem to do anything anymore.",
  "",
  "<col=ff0000>MINIQUEST COMPLETE!",
];
// 1702 tick 3112: nine found (not south-east of Varrock nor north of Falador), then the prompt.
const JOURNAL_NINE = [...STORY,
  "<str>I found some treasure in the Fremennik Province.",
  "<str>I found some treasure south of Falador.",
  "<str>I found some treasure north of Al Kharid.",
  "<str>I found some treasure in Lumbridge Swamp.",
  "<str>I found some treasure in the Grand Exchange.",
  "<str>I found some treasure near Jorral's Outpost.",
  "<str>I found some treasure south of Port Sarim.",
  "<str>I found some treasure near the Clock Tower Monastery.",
  "<str>I found some treasure in the Gnome Stronghold.",
  PROMPT,
];

before(async () => {
  h.key = "making_history";
  await h.setup([[3221, 3220], [2658, 3316], [2716, 3606], [3303, 3345]]);
  // The merchant's "Yes please." opens shops.json's Ardougne Silver Stall.
  const { ShopDefinitionLoader } = require("../dist/game/definition/loader/impl/ShopDefinitionLoader");
  assert.equal(new ShopDefinitionLoader().load(), true);
  h.core.ShopManager.initialize();
});
after(() => h.teardown());

const miniquest = () => h.quest("the_enchanted_key");
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const slot = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId() === id);

function actor(t, { at = [3221, 3220, 0], makingHistory = true, attributes = {}, items = [KEY, SPADE] } = {}) {
  const f = h.actor(t, { at, done: [], stage: makingHistory ? h.quest().completionValue : 0, attributes, items });
  f.sounds = [];
  f.heads = [];
  const sender = f.player.getPacketSender();
  const sound = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (id, ...rest) => { f.sounds.push({ tick: f.tick, id }); return sound(id, ...rest); };
  const anim = sender.sendInterfaceAnimation.bind(sender);
  sender.sendInterfaceAnimation = (uid, id) => { f.heads.push({ tick: f.tick, uid, id }); return anim(uid, id); };
  return f;
}

function moveTo(f, x, y, z = 0) {
  h.core.RegionManager.loadMapFiles(x, y);
  f.player.moveTo(new h.core.Location(x, y, z));
  h.tick(f);
  const at = f.player.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [x, y, z]);
}

async function itemOption(f, id, option) {
  const from = f.messages.length;
  await h.dispatch(f, { type: "inventory_action", slot: slot(f, id), itemId: id, widgetId: 3214, option });
  return f.messages.slice(from).map((m) => m.text);
}

/** The quest list's "Read journal" on The Enchanted Key's row (399:7 child 98, as the capture sends it). */
async function readJournal(f) {
  const from = f.calls.length;
  await h.dispatch(f, { type: "widget_action", widgetId: (399 << 16) | 7, groupId: 399, childId: 7, slot: 98, buttonNum: 2, option: "Read journal" });
  const calls = f.calls.slice(from);
  const opened = calls.some((c) => c.name === "sendSubInterface" && c.args.includes(119));
  const lines = [];
  for (let child = 11; ; child++) {
    const set = calls.filter((c) => c.name === "sendString" && c.args[1] === ((119 << 16) | child));
    if (!set.length) break;
    lines.push(set.at(-1).args[0]);
  }
  const config = (id) => calls.filter((c) => c.name === "sendConfig" && c.args[0] === id).map((c) => c.args[1]).at(-1);
  const title = calls.filter((c) => c.name === "sendString" && c.args[1] === ((119 << 16) | 5)).at(-1)?.args[0];
  return { opened, title, lines, latest: config(3679), count: config(4398) };
}

/** Destroy on the key, then Yes on the native prompt (local 1002311 ticks 471-474). */
async function destroyKey(f) {
  const scripts = [];
  const sender = f.player.getPacketSender();
  const script = sender.sendClientScript.bind(sender);
  sender.sendClientScript = (id, ...args) => { scripts.push([id, ...args]); return script(id, ...args); };
  await itemOption(f, KEY, "Destroy");
  sender.sendClientScript = script;
  const prompt = scripts.find(([id]) => id === 814);
  const from = f.sounds.length;
  await h.dispatch(f, { type: "dialogue_continue", widgetId: 584 << 16, childIndex: 1 });
  return { prompt, sounds: f.sounds.slice(from).map((s) => s.id) };
}

function reload(t, from) {
  const persistence = new (require("../plugins/persistence/JsonPlayerPersistence.plugin").JsonPlayerPersistence)();
  const raw = JSON.stringify(PlayerSave.fromPlayer(from.player), persistence.replacer.bind(persistence));
  const to = actor(t, { makingHistory: false, items: [] });
  persistence.hydratePlayerSave(JSON.parse(raw, persistence.reviver.bind(persistence))).applyToPlayer(to.player);
  h.PM.emitPlayerLogin({ player: to.player, username: to.player.getUsername() });
  h.PM.emitCustomEvent("player:bootstrap-complete", { player: to.player });
  return to;
}

test("the journal reads as live sends it with none, nine and all eleven treasures found", async (t) => {
  const f = actor(t);
  const none = await readJournal(f);
  // local 1002311 tick 343 (also tick 481, with the key destroyed): row 41, six lines.
  assert.equal(none.opened, true);
  assert.equal(none.title, "<col=7f0000>The Enchanted Key</col>");
  assert.deepEqual(none.lines, [...STORY, PROMPT]);
  assert.equal(none.latest, 41);
  assert.equal(none.count, 6);

  f.player.setAttribute(ORDER, ROUTE_1702);
  f.player.setAttribute(FOUND, 9);
  const nine = await readJournal(f);
  assert.deepEqual(nine.lines, JOURNAL_NINE);
  assert.equal(nine.count, 15);

  f.player.setAttribute(ORDER, ROUTE);
  f.player.setAttribute(FOUND, 11);
  const done = await readJournal(f);
  assert.deepEqual(done.lines, JOURNAL_DONE);
  assert.equal(done.count, 19);
});

test("before Making History is complete the row opens nothing and the miniquest is not started", async (t) => {
  const f = actor(t, { makingHistory: false });
  assert.equal(miniquest().getStage(f.player), 0);
  const journal = await readJournal(f);
  assert.equal(journal.opened, false);
  assert.deepEqual(journal.lines, []);
});

test("the recorded route: every Feel answers what live sent, with its synth, and the treasures come up", async (t) => {
  const f = actor(t, { attributes: { [ORDER]: ROUTE, [FOUND]: 0 } });
  f.player.getInventory().add(new h.core.Item(COINS, 18591), false);
  const merchant = h.spawn(f, MERCHANT, [2658, 3316, 0]);
  let replaced = false;
  for (const [tick, action, x, y, synth, line] of RECORDED) {
    if (!replaced && tick > 471) {
      // Ticks 471-510: the key is destroyed and bought back; the next Feel still compares (tick 512).
      const { prompt, sounds } = await destroyKey(f);
      assert.deepEqual(prompt, [814, KEY, 1, "Are you sure you want to destroy this item?", "Hopefully Erin has a copy!"]);
      assert.equal(f.player.getInventory().getAmount(KEY), 0);
      assert.deepEqual(sounds, [2381]);
      moveTo(f, 2656, 3317);
      const lines = await h.converse(f, () => h.talk(f, merchant), ["Ask about the outpost.", "Yes please."]);
      assert.deepEqual(lines, [
        "Silver merchant: Silver! Silver! Best prices for buying and selling in all Kandarin!",
        "MENU[Select an option]: Yes please.|Ask about the outpost.|No thank you.",
        "PLAYER: Hello again.",
        "Silver merchant: Hello, I hope Jorral was pleased with that Journal.",
        "PLAYER: I'm sure it's been a valuable find.",
        "PLAYER: What I came to ask was: I lost that key you gave me.",
        "Silver merchant: Oh dear, luckily I found it, but it'll cost you 500gp as I know it's valuable.",
        "MENU[Select an option]: Yes please.|No thanks.",
        "PLAYER: Yes please.",
        "Silver merchant: Thank you, enjoy!",
      ]);
      assert.equal(f.player.getInventory().getAmount(KEY), 1);
      assert.equal(f.player.getInventory().getAmount(COINS), 18091, "500 coins, as at tick 508");
      assert.deepEqual(f.player.getAttribute(ORDER), ROUTE, "the route survives the replacement");
      replaced = true;
    }
    moveTo(f, x, y);
    if (action === "feel") {
      const from = f.sounds.length;
      assert.deepEqual(await itemOption(f, KEY, "Feel"), [line], `tick ${tick} at ${x},${y}`);
      assert.deepEqual(f.sounds.slice(from).map((s) => s.id), [synth], `tick ${tick} synth`);
      continue;
    }
    const before = f.player.getAttribute(FOUND);
    const anims = f.animations.length, sounds = f.sounds.length;
    const said = await itemOption(f, SPADE, "Dig");
    assert.equal(said[0], line, `dig at tick ${tick}`);
    // Every dig plays human_dig with digspade 1470, found or not.
    assert.deepEqual(f.animations.slice(anims).map((a) => a.id), [830], `tick ${tick}`);
    assert.ok(f.sounds.slice(sounds).some((s) => s.id === 1470), `tick ${tick}`);
    if (line === "You found some treasure.") {
      assert.equal(f.player.getAttribute(FOUND), before + 1, `tick ${tick}`);
      const mask = ROUTE.slice(0, before + 1).reduce((bits, key) => bits | (1 << sitesByKey[key].wireBit), 0);
      assert.equal(varbit(f, LOCSTATUS), mask, `tick ${tick}`);
    } else {
      assert.equal(f.player.getAttribute(FOUND), before);
    }
    // The last treasure's box: continue it (tick 2115).
    if (f.player.getAttribute(FOUND) === 11 && h.shown(f)) await h.continueLine(f);
  }
  assert.equal(f.player.getAttribute(FOUND), 11);
  assert.equal(varbit(f, LOCSTATUS), 2047);
  assert.equal(f.player.getInventory().getAmount(KEY), 0, "the key dissolves");
});

const sitesByKey = Object.fromEntries(require("../plugins/quests/makinghistory/data/enchanted-key.json").sites.map((s) => [s.key, s]));

test("the last treasure completes the miniquest: enchantedkey at the dig, the count on the box's continue, kept on relog", async (t) => {
  const f = actor(t, { at: [3303, 3345, 0], attributes: { [ORDER]: ROUTE, [FOUND]: 10 } });
  moveTo(f, 3303, 3345);
  const before = varbit(f, MINIQUESTS);
  const jingles = f.calls.length;
  assert.equal(miniquest().isStarted(f.player), true);
  assert.equal(miniquest().isComplete(f.player), false);
  const from = f.messages.length;
  await itemOption(f, SPADE, "Dig");
  // local 1002311 tick 2111: the game message, then the box's text logged as a mesbox line.
  const said = f.messages.slice(from);
  assert.deepEqual(said.map((m) => m.text), ["You found some treasure.", "You find some items, but the key dissolves in your hand."]);
  assert.equal(said[0].type, undefined);
  assert.notEqual(said[1].type, undefined);
  assert.equal(varbit(f, LOCSTATUS), 2047);
  assert.equal(varbit(f, STATUS), 2);
  assert.deepEqual(h.shown(f), { who: "ItemStatementDialogue", text: "You find some items, but the key dissolves in your hand.", npcId: undefined });
  assert.equal(varbit(f, MINIQUESTS), before, "the count waits for the continue");
  assert.equal(varbit(f, 12393), 1, "busy with the box (tick 2111)");
  await h.continueLine(f);
  assert.equal(varbit(f, 12393), 0, "busy clears on the continue (tick 2115)");
  // Tick 2115: the box closes and the miniquest counts.
  assert.equal(h.shown(f), null);
  assert.equal(varbit(f, MINIQUESTS), before + 1);
  assert.equal(miniquest().isComplete(f.player), true);
  // No scroll, jingle or chat line: live completes it silently.
  assert.ok(!f.calls.slice(jingles).some((c) => c.name === "sendSubInterface" && c.args.includes(153)));
  assert.ok(!f.messages.some((m) => /Congratulations/.test(m.text)));
  assert.deepEqual((await readJournal(f)).lines, JOURNAL_DONE);

  const loaded = reload(t, f);
  assert.equal(miniquest().isComplete(loaded.player), true);
  assert.equal(varbit(loaded, STATUS), 2);
  assert.equal(varbit(loaded, LOCSTATUS), 2047);
  assert.deepEqual((await readJournal(loaded)).lines, JOURNAL_DONE);
});

test("a part-way route survives a save and reload, journal and Feel included", async (t) => {
  const f = actor(t, { attributes: { [ORDER]: ROUTE_1702, [FOUND]: 9 } });
  const loaded = reload(t, f);
  loaded.player.getInventory().add(new h.core.Item(KEY, 1), false);
  assert.equal(miniquest().getStage(loaded.player), 1);
  assert.deepEqual((await readJournal(loaded)).lines, JOURNAL_NINE);
  // The tenth site of 1702's route is south-east of Varrock: a steaming key on it.
  moveTo(loaded, 3299, 3349);
  assert.deepEqual(await itemOption(loaded, KEY, "Feel"), ["The key is steaming. It must be right below your feet."]);
});

test("after Making History the merchant's first menu still opens his silver stall, and No thank you ends", async (t) => {
  const f = actor(t, { at: [2656, 3317, 0] });
  const merchant = h.spawn(f, MERCHANT, [2658, 3316, 0]);
  h.ticks(f, 2);
  // Not captured past the menu (the capture took "Ask about the outpost."): the Wiki's answers.
  assert.deepEqual(await h.converse(f, () => h.talk(f, merchant), ["Yes please."]), [
    "Silver merchant: Silver! Silver! Best prices for buying and selling in all Kandarin!",
    "MENU[Select an option]: Yes please.|Ask about the outpost.|No thank you.",
    "PLAYER: Yes please.",
  ]);
  assert.equal(h.core.ShopManager.getOpenShop(f.player)?.name, "Ardougne Silver Stall.");
  f.player.getPacketSender().sendInterfaceRemoval();
  h.tick(f);
  assert.deepEqual(await h.converse(f, () => h.talk(f, merchant), ["No thank you."]), [
    "Silver merchant: Silver! Silver! Best prices for buying and selling in all Kandarin!",
    "MENU[Select an option]: Yes please.|Ask about the outpost.|No thank you.",
    "PLAYER: No thank you.",
  ]);
  assert.equal(f.player.getInventory().getAmount(KEY), 1, "the key holder is offered nothing");
});

test("logging out on the last treasure's box, before its continue, still saves the miniquest complete", async (t) => {
  const f = actor(t, { at: [3303, 3345, 0], attributes: { [ORDER]: ROUTE, [FOUND]: 10 } });
  moveTo(f, 3303, 3345);
  await itemOption(f, SPADE, "Dig");
  assert.equal(h.shown(f)?.who, "ItemStatementDialogue");
  const loaded = reload(t, f);
  assert.equal(miniquest().isComplete(loaded.player), true);
  assert.equal(varbit(loaded, STATUS), 2);
  assert.equal(loaded.player.getInventory().getAmount(KEY), 0);
  // A second dig on the spot finds nothing (the route is done).
  loaded.player.getInventory().add(new h.core.Item(SPADE, 1), false);
  moveTo(loaded, 3303, 3345);
  assert.deepEqual(await itemOption(loaded, SPADE, "Dig"), ["Nothing interesting happens."]);
});

test("before Making History is complete the key's Feel and a dig on a site do nothing of the miniquest's", async (t) => {
  const f = actor(t, { makingHistory: false, attributes: { [ORDER]: ROUTE, [FOUND]: 0 } });
  moveTo(f, 2716, 3606);
  const felt = await itemOption(f, KEY, "Feel");
  assert.ok(!felt.some((m) => /steaming|freezing|warm|cold|hot/.test(m)), JSON.stringify(felt));
  const dug = await itemOption(f, SPADE, "Dig");
  assert.ok(!dug.includes("You found some treasure."), JSON.stringify(dug));
  assert.equal(f.player.getAttribute(FOUND), 0);
  assert.equal(varbit(f, STATUS), 0);
});

test("finishing Making History starts the miniquest's row at once, without a relog", async (t) => {
  const f = actor(t, { makingHistory: false });
  assert.equal(varbit(f, STATUS), 0);
  h.quest().setStage(f.player, h.quest().completionValue);
  assert.equal(varbit(f, STATUS), 1);
  assert.deepEqual((await readJournal(f)).lines, [...STORY, PROMPT]);
  h.quest().setStage(f.player, 0);
  assert.equal(varbit(f, STATUS), 0);
});

test("closing the last treasure's box without its continue still counts the miniquest and clears busy", async (t) => {
  const f = actor(t, { at: [3303, 3345, 0], attributes: { [ORDER]: ROUTE, [FOUND]: 10 } });
  moveTo(f, 3303, 3345);
  const before = varbit(f, MINIQUESTS);
  await itemOption(f, SPADE, "Dig");
  assert.equal(varbit(f, 12393), 1);
  await h.dispatch(f, { type: "interface_close" });
  assert.equal(h.shown(f), null);
  assert.equal(varbit(f, 12393), 0);
  assert.equal(varbit(f, MINIQUESTS), before + 1);
});

test("only the miniquest hides an empty unstarted journal: Watchtower's row still opens its journal", async (t) => {
  const f = actor(t, { makingHistory: false });
  const watchtower = h.quest("watchtower");
  assert.ok(watchtower && !watchtower.isStarted(f.player));
  const from = f.calls.length;
  h.QuestRuntime.openJournal(f.player, watchtower);
  assert.ok(f.calls.slice(from).some((c) => c.name === "sendSubInterface" && c.args.includes(119)));
});

test("::quest: complete before Making History says so; reset-all clears the route with Making History", async (t) => {
  const QuestCommand = require("../plugins/quests/QuestCommand.plugin");
  const f = actor(t, { makingHistory: false });
  const run = (text) => QuestCommand._test.questCommand({ player: f.player, parts: text.split(" ") });
  const from = f.messages.length;
  run("quest the enchanted key complete");
  assert.ok(f.messages.slice(from).some((m) => m.text === "The Enchanted Key can't be completed yet."));
  assert.equal(miniquest().isStarted(f.player), false);

  h.quest().setStage(f.player, h.quest().completionValue);
  f.player.setAttribute(ORDER, ROUTE);
  f.player.setAttribute(FOUND, 11);
  assert.equal(miniquest().isComplete(f.player), true);
  QuestCommand._test.adminQuestRequest({ player: f.player, action: "reset-all" });
  assert.equal(f.player.getAttribute(FOUND), 0);
  assert.deepEqual(f.player.getAttribute(ORDER), []);
  h.quest().setStage(f.player, h.quest().completionValue);
  assert.equal(miniquest().isStarted(f.player), true);
  assert.equal(miniquest().isComplete(f.player), false, "played again, not complete at once");
  assert.equal(varbit(f, STATUS), 1);

  // ::quest <name> reset clears it directly too.
  f.player.setAttribute(ORDER, ROUTE);
  f.player.setAttribute(FOUND, 5);
  run("quest the enchanted key reset");
  assert.equal(f.player.getAttribute(FOUND), 0);
});
