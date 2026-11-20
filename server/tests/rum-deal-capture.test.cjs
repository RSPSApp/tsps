// Run after `yarn build`: node --test tests/rum-deal-capture.test.cjs
//
// Rum Deal against a whole run of the quest on live: the user's RSProx capture RumDeal.bin (revision
// 242.1; docs/quests/rum-deal/README.md). Real Player, PlayerSession and ClientConnection, the real
// plugins, cache and map: talks and clicks are packets and each tick runs as World.process does. Ticks
// in the test names are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "rum_deal";
const S = {
  STARTED: 1, AGREED: 2, MET: 3, SEEDS: 4, GROWN: 5, SHOWN: 6, BLINDWEED_ADDED: 7, FETCH_WATER: 8, WATER: 9,
  WATER_ADDED: 10, CATCH: 11, PRESSURISED: 12, BLESS: 13, BANISHED: 14, SPIDER: 15, SPIDER_ADDED: 16, SWILL: 17,
  DONNIE: 18, COMPLETE: 19,
};
const V = { BARREL: 1354, HOPPER: 1355, SLUG: 1357, THULHU: 1358, PIRATE_A: 1359, PATCH: 1366 };
const N = { PETE: 601, ISLAND_PETE: 602, BRAINDEATH: 603, LUKE: 604, DAVEY: 605, DONNIE: 606, SPIRIT: 625, SPIDER: 626, SQUID: 635 };
const DONE = ["zogre_flesh_eaters", "priest_in_peril", "sea_slug"];
const BRAINDEATH_TILE = [2144, 5109, 1];
const WAKE = [2144, 5108, 1];
const FIVE_MINUTES = 5 * 60 * 1000;

let I;
let Sk;
before(async () => {
  h.key = KEY;
  await h.setup([[3680, 3537], [2144, 5108], [2160, 5070], [2135, 5161], [2120, 5098]]);
  I = h.core.ItemIdentifiers;
  Sk = h.core.Skill;
});
after(() => h.teardown());

const stage = (f) => h.quest().getStage(f.player);
const varbits = (f, id) => f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === id).map((c) => c.args[1]);
const varbitAt = (f, id, value) => f.calls.find((c) => c.name === "sendVarbit" && c.args[0] === id && c.args[1] === value)?.tick;
const group = (f) => f.player.getPacketSender().getChatboxGroupId();
const messages = (f) => f.messages.map((m) => String(m.text)).filter((text) => !text.startsWith("You have unlocked a new music track"));
const messageAt = (f, text) => f.messages.find((m) => m.text === text)?.tick;
const count = (f, id) => f.player.getInventory().getAmount(id);
const at = (f) => { const l = f.player.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
const chat = (f, from = 0) => f.calls.filter((c) => c.tick >= from && c.name === "sendString"
  && [(231 << 16) | 6, (217 << 16) | 6, (229 << 16) | 3].includes(c.args[1])).map((c) => String(c.args[0]).replace(/<br>/g, " "));

function actor(t, { at: tile, stage: value = 0, items = [], attributes = {}, done = DONE, levels = 60 } = {}) {
  const f = h.actor(t, { at: tile, stage: value, done, attributes });
  for (const skill of ["FARMING", "FISHING", "PRAYER", "CRAFTING", "SLAYER"]) {
    f.player.getSkillManager().setMaxLevels(Sk[skill], levels);
    f.player.getSkillManager().setCurrentLevel(Sk[skill], levels, false);
  }
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  const overheads = [];
  const say = f.player.forceChat.bind(f.player);
  f.player.forceChat = (text) => { overheads.push({ tick: f.tick, text }); return say(text); };
  f.overheads = overheads;
  const graphics = [];
  const graphic = f.player.performGraphic.bind(f.player);
  f.player.performGraphic = (g) => { graphics.push({ tick: f.tick, id: g.getId() }); return graphic(g); };
  f.graphics = graphics;
  f.calls.length = 0;
  f.messages.length = 0;
  return f;
}

async function until(f, text, limit = 120) {
  for (let i = 0; i < limit; i++) {
    const line = h.shown(f);
    if (line?.text?.startsWith(text) || (line?.who === "menu" && line.text.includes(text))) return f.tick;
    if (line && line.who !== "menu" && line.who !== "ActionDialogue") await h.continueLine(f);
    else h.tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

/** Plays out the conversation, answering menus with `picks`, through held scene lines too. */
async function play(f, start, picks = []) {
  const from = f.said.length;
  const queue = [...picks];
  await start?.();
  for (let idle = 0, i = 0; i < 600 && idle < 40; i++) {
    const line = h.shown(f);
    if (!line || line.who === "ActionDialogue") { idle++; h.tick(f); continue; }
    idle = 0;
    if (line.who === "menu") {
      if (!queue.length) break;
      await h.choose(f, queue.shift());
      continue;
    }
    await h.continueLine(f);
  }
  return f.said.slice(from).map((s) => (s.who === "menu" ? `MENU[${s.title ?? ""}]: ${s.text}` : `${s.who}: ${s.text}`));
}

async function useOnNpc(f, npc, itemId) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  await f.connection.dispatch([{ type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot, widgetId: 149 << 16 }]);
  for (let i = 0; i < 20 && !h.shown(f); i++) h.tick(f);
}

/** Ticks until `done()` (the interaction has run), at most `limit`; returns that tick. */
function settle(f, done, limit = 10) {
  for (let i = 0; i < limit && !done(); i++) h.tick(f);
  assert.ok(done(), "the interaction ran");
  return f.tick;
}

/** Uses an item on a loc; returns the tick its handler ran on (the item gone or a new message). */
async function useOnObject(f, objectId, [x, y], itemId, done) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  const before = { count: count(f, itemId), messages: f.messages.length, animations: f.animations.length };
  await f.connection.dispatch([{ type: "item_on_object", itemId, slot, widgetId: 149 << 16, objectId, x, y }]);
  return settle(f, done ?? (() => count(f, itemId) !== before.count || f.messages.length > before.messages || f.animations.length > before.animations));
}

async function clickObject(f, id, [x, y], clickType = 1, done) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const before = { messages: f.messages.length, animations: f.animations.length, said: f.said.length };
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType }]);
  return settle(f, done ?? (() => f.messages.length > before.messages || f.animations.length > before.animations || !!h.shown(f)));
}

// ------------------------------------------------------------------ Setting out

test("the start: 'Start the Rum Deal quest?' and Pete's two lines before the demon menu; Yes. is stage 1 (ticks 153-187)", async (t) => {
  const f = actor(t, { at: [3679, 3537, 0] });
  const pete = h.spawn(f, N.PETE, [3680, 3537, 0]);
  const refused = await play(f, () => h.talk(f, pete), ["No."]);
  assert.deepEqual(refused.slice(-4), [
    "MENU[Start the Rum Deal quest?]: Yes.|No.",
    "PLAYER: No, I don't think I'll help you out this time.",
    "Pirate Pete: Look, I think I'll wait here for someone a little more... you know...",
    "Pirate Pete: ...heroic.",
  ]);
  assert.equal(stage(f), 0, "No. leaves it unstarted (tick 155)");
  const lines = await play(f, () => h.talk(f, pete), ["Yes.", "Not a chance, this sounds too dangerous."]);
  assert.equal(stage(f), S.STARTED, "Yes. starts it (tick 175)");
  const barrelor = lines.indexOf("Pirate Pete: Err...Barrelor!");
  assert.deepEqual(lines.slice(barrelor, barrelor + 7), [
    "Pirate Pete: Err...Barrelor!",
    "Pirate Pete: Yes, the mighty, fearsome, tall, deadly, oaken, round demon Barrelor the Destroyer.",
    "PLAYER: Barrelor?",
    "Pirate Pete: That's what I said!",
    "Pirate Pete: Barrelor is an awesome opponent, and to reclaim my family sword you will need to defeat him, for he guards it within the deadly Trapped Pit of Barrelor.",
    "Pirate Pete: Wanna give it a shot?",
    "MENU[Select an option]: Of course, I fear no demon!|Not a chance, this sounds too dangerous.",
  ]);
});

test("agreeing to fight Barrelor is stage 2; asking for the cash leaves Pete's 'Hello again!' talk (ticks 203-264)", async (t) => {
  const f = actor(t, { at: [3679, 3537, 0], stage: S.STARTED });
  const pete = h.spawn(f, N.PETE, [3680, 3537, 0]);
  const lines = await play(f, () => h.talk(f, pete), ["Because I came to offer to help.", "Great, I'll take the cash in used coins please."]);
  assert.equal(lines[0], "PLAYER: Had any luck finding someone to slay the demon?");
  assert.ok(lines.includes("Pirate Pete: That's the spirit!"));
  assert.equal(stage(f), S.AGREED, "the offer to help is stage 2 (tick 242)");
  assert.deepEqual(lines.slice(-3), [
    "Pirate Pete: Er...",
    "Pirate Pete: Look, I think I'll wait here for someone a little more... you know...",
    "Pirate Pete: ...heroic.",
  ]);
  await h.talk(f, pete);
  assert.equal(h.shown(f)?.text, "Hello again!", "tick 260");
});

test("the knock-out: Ow!, the blow, cutscene 1 in a copy of the brewery and the meeting on waking (ticks 264-366)", async (t) => {
  const f = actor(t, { at: [3679, 3537, 0], stage: S.AGREED });
  const pete = h.spawn(f, N.PETE, [3680, 3537, 0]);
  h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  await h.talk(f, pete);
  await until(f, "I've decided to help you for free.");
  await h.choose(f, "I've decided to help you for free.");
  const diversion = await until(f, "What diversion?");
  await h.continueLine(f);
  const blow = f.tick;
  assert.ok(f.overheads.some((o) => o.text === "Ow!" && o.tick === blow), "the player's Ow! (tick 268)");
  assert.ok(f.animations.some((a) => a.id === 401 && a.tick === blow), "human_blunt_pound 401");
  assert.ok(f.graphics.some((g) => g.id === 245 && g.tick === blow), "stunned_thieving 245");
  assert.equal(group(f), -1, "the chat closes with the blow");
  for (let i = 0; i < 8; i++) h.tick(f);
  assert.notDeepEqual(at(f).slice(0, 2), [3679, 3537], "in the brewery's copy six ticks on (tick 274)");
  assert.equal(stage(f), S.AGREED, "the knock-out leaves stage 2");
  const said = chat(f, blow);
  for (const words of ["Arrr... 'Tis lookin' bleak...", "Good news Cap'n!", "We may make it through this yet..."]) {
    for (let i = 0; i < 100 && !chat(f, blow).includes(words); i++) h.tick(f);
    assert.ok(chat(f, blow).includes(words), `cutscene line "${words}"`);
  }
  void said;
  await until(f, "Are ye alright, lad?", 40);
  assert.ok(f.tick - blow >= 96 && f.tick - blow <= 100, `the meeting 98 ticks after the blow (got ${f.tick - blow})`);
  assert.deepEqual(at(f), WAKE, "woken in front of Braindeath (tick 359)");
  assert.ok(f.graphics.some((g) => g.id === 245 && g.tick > blow + 80), "stunned again on waking (tick 363)");
  void diversion;
});

test("the meeting: the capture's three extra lines, the window scene, and stages 3 and 4 with the seed (ticks 366-458)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.AGREED, attributes: { "quest.rum_deal.intro": 1 } });
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  await h.talk(f, braindeath);
  await until(f, "Them!");
  await h.continueLine(f);
  const pointed = f.tick;
  assert.ok(chat(f, pointed).some((text) => text.startsWith("The captian points out of the window")), "the Wiki's box, held");
  h.ticks(f, 2);
  assert.deepEqual(at(f), [2152, 5098, 0], "watching from the ground floor (tick 403)");
  h.ticks(f, 6);
  assert.ok(f.calls.some((c) => c.name === "sendSubInterface" && c.args[1] === 295), "rum_deal_title (295) at +7 (tick 409)");
  const lines = await play(f, null);
  assert.deepEqual(at(f), WAKE, "back in front of Braindeath (tick 428)");
  assert.equal(lines[0], "PLAYER: Are they...");
  assert.ok(lines.includes("Captain Braindeath: Seems they lost their fightin' spirit after the first few days. Now most of them just protest all the time."));
  assert.equal(stage(f), S.SEEDS, "3 and 4 with the seed (tick 455)");
  assert.equal(count(f, I.BLINDWEED_SEED), 1);
  assert.equal(lines.at(-1), "Captain Braindeath: Try hecklin' 'em from a distance. Those Swabs may talk a good fight, but if ye can put a scare in 'em they'll keep out of yer way!");
});

test("with no room for the seed the meeting leaves stage 3, and the next talk hands it over", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.AGREED, attributes: { "quest.rum_deal.intro": 1 } });
  f.player.getInventory().add(new h.core.Item(I.COINS, 1), false);
  for (let i = 1; i < 28; i++) f.player.getInventory().add(new h.core.Item(I.BRONZE_DAGGER, 1), false);
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  await play(f, () => h.talk(f, braindeath));
  assert.equal(stage(f), S.MET);
  assert.equal(count(f, I.BLINDWEED_SEED), 0);
  f.player.getInventory().deleteNumber(I.BRONZE_DAGGER, 1);
  await play(f, () => h.talk(f, braindeath), ["What exactly do you want me to do?"]);
  assert.equal(count(f, I.BLINDWEED_SEED), 1);
  assert.equal(stage(f), S.SEEDS);
});

// ------------------------------------------------------------------ The brewers and Davey

test("each brewer is the Wiki's numbered brewer the capture heard, before and after the quest (ticks 510-574, 2883-2946)", async (t) => {
  const before = { 627: "Who are you?", 628: "Game over, man! Game over!", 629: "Very well, considering.", 630: "Don't sneak up on me like that!",
    631: "Don't talk to me! If I play this right, I can sell you lot out and make it to the mainland!", 632: "No school today mother, my brain hurts real baaaad...",
    633: "How do I know you're not one of them?", 634: "Very well." };
  const afterwards = { 627: "I don't know what your game is, but I know you're one of THEM!", 628: "Have they gone yet?", 629: "Hello yourself!",
    631: "Hello there, brave hero, in whom I had total confidence!", 632: "My brain is no longer capable of sleep.", 634: "You saved us! Huzzah!" };
  for (const [table, value] of [[before, S.SEEDS], [afterwards, S.COMPLETE]]) {
    const f = actor(t, { at: [2150, 5096, 1], stage: value });
    for (const [id, words] of Object.entries(table)) {
      const brewer = h.spawn(f, Number(id), [2151, 5096, 1]);
      const lines = await play(f, () => h.talk(f, brewer));
      assert.equal(lines[1], `Brewer: ${words}`, `brewer ${id} at stage ${value}`);
    }
  }
});

// ------------------------------------------------------------------ The blindweed patch

test("raking: a stage, a weed and 4 XP a swing, a swing every four ticks (ours: no misses), then the seed's line 3 ticks after it goes in (ticks 817-845)", async (t) => {
  const f = actor(t, { at: [2162, 5068, 0], stage: S.SEEDS, items: [[I.RAKE], [I.BLINDWEED_SEED]] });
  await clickObject(f, 10096, [2162, 5069], 2);
  assert.deepEqual(messages(f).slice(-1), ["This is a blindweed patch. The soil has not been treated. The patch needs weeding."], "tick 805");
  const xp = f.player.getSkillManager().getExperience(Sk.FARMING);
  await useOnObject(f, 10096, [2162, 5069], I.RAKE);
  const start = f.tick;
  h.ticks(f, 13);
  assert.equal(varbitAt(f, V.PATCH, 1) - start, 4);
  assert.equal(varbitAt(f, V.PATCH, 2) - start, 8);
  assert.equal(varbitAt(f, V.PATCH, 3) - start, 12);
  assert.equal(count(f, I.WEEDS), 3);
  assert.equal(f.player.getSkillManager().getExperience(Sk.FARMING) - xp, 12);
  assert.equal(f.animations.filter((a) => a.id === 2273).length, 3, "farming_raking each swing");
  await useOnObject(f, 10096, [2162, 5069], I.BLINDWEED_SEED);
  const planted = f.tick;
  assert.equal(count(f, I.BLINDWEED_SEED), 0, "the seed goes at once");
  h.ticks(f, 3);
  assert.equal(messageAt(f, "You plant a seed in the blindweed patch.") - planted, 3);
  assert.equal(f.messages.find((m) => m.text === "You plant a seed in the blindweed patch.").type, h.core.ChatType.SPAM);
  assert.equal(varbitAt(f, V.PATCH, 4) - planted, 3);
  assert.equal(f.player.getSkillManager().getExperience(Sk.FARMING) - xp, 32, "20 XP for planting");
  await clickObject(f, 10096, [2162, 5069], 2);
  assert.equal(messages(f).at(-1), "This is a blindweed patch. The soil has not been treated. The patch has something growing in it.");
});

test("grown on the next farming tick; Pick gives the blindweed, 45 XP and stage 5, 3 ticks on (ticks 1160-1174)", async (t) => {
  const planted = Math.floor(Date.now() / FIVE_MINUTES) * FIVE_MINUTES - 1000;
  const f = actor(t, { at: [2162, 5068, 0], stage: S.SEEDS, attributes: { "quest.rum_deal.weeded": 3, "quest.rum_deal.planted": planted } });
  await clickObject(f, 10096, [2162, 5069], 2);
  assert.equal(messages(f).at(-1), "This is a blindweed patch. The soil has not been treated. The patch is fully grown.");
  const xp = f.player.getSkillManager().getExperience(Sk.FARMING);
  await clickObject(f, 10096, [2162, 5069], 1);
  const picked = f.tick;
  h.ticks(f, 3);
  assert.equal(count(f, I.BLINDWEED), 1);
  assert.equal(f.player.getSkillManager().getExperience(Sk.FARMING) - xp, 45);
  assert.equal(stage(f), S.GROWN);
  assert.equal(varbitAt(f, V.PATCH, 3) - picked, 3, "back to weeded");
  assert.ok(f.animations.some((a) => a.id === 2292), "farming_pick_mushroom");
  await clickObject(f, 10096, [2162, 5069], 2);
  assert.equal(messages(f).at(-1), "This is a blindweed patch. The soil has not been treated. The patch is empty and weeded.");
});

test("a backpack filled during the pick keeps the crop: no blindweed lost, no XP, no stage (review)", async (t) => {
  const planted = Math.floor(Date.now() / FIVE_MINUTES) * FIVE_MINUTES - 1000;
  const f = actor(t, { at: [2162, 5068, 0], stage: S.SEEDS, attributes: { "quest.rum_deal.weeded": 3, "quest.rum_deal.planted": planted } });
  for (let i = f.player.getInventory().getItems().filter(Boolean).filter((item) => item.getId() >= 0).length; i < 27; i++) {
    f.player.getInventory().add(new h.core.Item(I.BRONZE_DAGGER, 1), false);
  }
  const xp = f.player.getSkillManager().getExperience(Sk.FARMING);
  await clickObject(f, 10096, [2162, 5069], 1);
  f.player.getInventory().add(new h.core.Item(I.BRONZE_DAGGER, 1), false);
  h.ticks(f, 4);
  assert.equal(count(f, I.BLINDWEED), 0);
  assert.equal(f.player.getSkillManager().getExperience(Sk.FARMING), xp);
  assert.equal(stage(f), S.SEEDS);
  assert.ok(messages(f).includes("You do not have any free space for the Blindweed."));
  f.player.getInventory().deleteNumber(I.BRONZE_DAGGER, 1);
  await clickObject(f, 10096, [2162, 5069], 1);
  h.ticks(f, 4);
  assert.equal(count(f, I.BLINDWEED), 1, "still there to pick");
  assert.equal(stage(f), S.GROWN);
});

test("an empty patch's weeds grow back a stage each farming tick (ticks 1659, 2168, 2653)", async (t) => {
  const tick = Math.floor(Date.now() / FIVE_MINUTES) * FIVE_MINUTES;
  const f = actor(t, { at: [2162, 5068, 0], stage: S.GROWN, attributes: { "quest.rum_deal.weeded": 3, "rum-deal:weeds-at": tick - 2 * FIVE_MINUTES + 1000 } });
  await clickObject(f, 10096, [2162, 5069], 2);
  assert.equal(varbits(f, V.PATCH).at(-1), 1, "two farming ticks later only one stage is left raked");
  assert.equal(messages(f).at(-1), "This is a blindweed patch. The soil has not been treated. The patch needs weeding.");
});

// ------------------------------------------------------------------ Brewing "rum"

test("the lost blindweed: Braindeath's spare and stage 6 as his line shows (ticks 1207-1211)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.GROWN });
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  const lines = await play(f, () => h.talk(f, braindeath));
  assert.deepEqual(lines, [
    "PLAYER: Captain... I grew some blindweed but then I lost it...",
    "Captain Braindeath: There there, lad. 'Tis all right.",
    "Captain Braindeath: Here, I've been savin' some fer an emergency.",
    "Captain Braindeath: Go shove that in the Intake Hopper, and try not ter lose this lot!",
  ]);
  assert.equal(stage(f), S.SHOWN);
  assert.equal(count(f, I.BLINDWEED), 1);
});

test("the hopper: the stage as the blindweed goes in, its line, seq 827 and sound a tick later (ticks 1267-1268)", async (t) => {
  const f = actor(t, { at: [2142, 5101, 2], stage: S.SHOWN, items: [[I.BLINDWEED]] });
  await useOnObject(f, 10170, [2142, 5102], I.BLINDWEED);
  const used = f.tick;
  assert.equal(stage(f), S.BLINDWEED_ADDED);
  h.ticks(f, 1);
  assert.equal(messageAt(f, "You stuff the Blindweed into the Hopper.") - used, 1);
  assert.ok(f.animations.some((a) => a.id === 827 && a.tick === used + 1));
});

test("the water talk ends at stage 8 and a player with a bucket gets no other (ticks 1301-1317)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.BLINDWEED_ADDED, items: [[I.BUCKET]] });
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  const lines = await play(f, () => h.talk(f, braindeath));
  assert.equal(lines.at(-1), "PLAYER: When is it ever...");
  assert.equal(stage(f), S.FETCH_WATER);
  assert.equal(count(f, I.BUCKET), 1);
});

// ------------------------------------------------------------------ 50% Luke and the gate

test("Talk-to 50% Luke is his own page's talk, not the gate's (ticks 1369-1453)", async (t) => {
  const f = actor(t, { at: [2121, 5096, 0], stage: S.FETCH_WATER });
  const luke = h.spawn(f, N.LUKE, [2120, 5096, 0]);
  const lines = await play(f, () => h.talk(f, luke), ["How flammable are you?"]);
  assert.deepEqual(lines.slice(0, 3), ["PLAYER: Are you all right?", "50% Luke: Who goes there?", "50% Luke: Arr! A landlubber!"]);
  assert.deepEqual(lines.slice(-2), ["PLAYER: A rather rude, personal one?", "50% Luke: Ye've got that right!"]);
});

test("the gate: Luke too early, then distracted going north and shouting coming back, the gate open as he finishes (ticks 1456-1581)", async (t) => {
  const early = actor(t, { at: [2120, 5098, 0], stage: S.SEEDS });
  h.spawn(early, N.LUKE, [2120, 5096, 0]);
  const tooEarly = await play(early, () => clickObject(early, 10172, [2120, 5098]));
  assert.equal(tooEarly[0], "50% Luke: Arr! Tryin' ter get away eh? Well ye'll never sneak past me, I'm the best lookout this crew has ever seen!");
  assert.ok(tooEarly.includes("50% Luke: Ye'll have te do better than that, landlubber!"));
  h.ticks(early, 3);
  assert.deepEqual(at(early), [2120, 5098, 0], "the gate stays shut");

  const f = actor(t, { at: [2120, 5098, 0], stage: S.FETCH_WATER });
  h.spawn(f, N.LUKE, [2120, 5096, 0]);
  const north = await play(f, () => clickObject(f, 10172, [2120, 5098]));
  assert.equal(north[0], "50% Luke: Arr! Tryin' ter get away eh? Well ye'll never sneak past me, I'm the best lookout this crew has ever seen!");
  assert.match(north[1], /^PLAYER: (Who's that making faces behind you\?|That is the most amazing thing I have ever seen!|Is that your distraction\?|Who is that behind you\?|Hey you! Look over there!|Oh my! Is that a genuine 3rd Age Diversion\?)$/);
  h.ticks(f, 3);
  assert.deepEqual(at(f), [2120, 5099, 0], "through the gate (tick 1467)");
  const south = await play(f, () => clickObject(f, 10172, [2120, 5098]));
  assert.deepEqual(south, [
    "50% Luke: Hey! What are you doing out there?",
    "PLAYER: Nothing.",
    "50% Luke: Well Cap'n Donnie said no livin' landlubbers were allowed out of the compound.",
    "50% Luke: So get yerself back in here, or yer for it!",
  ]);
  h.ticks(f, 3);
  assert.deepEqual(at(f), [2120, 5098, 0], "back through (tick 1579)");
});

test("the stagnant lake: stage 9, the bucket filled and seq 2812 (tick 1521)", async (t) => {
  const f = actor(t, { at: [2135, 5160, 0], stage: S.FETCH_WATER, items: [[I.BUCKET]] });
  await useOnObject(f, 10105, [2135, 5161], I.BUCKET);
  assert.equal(stage(f), S.WATER);
  assert.equal(count(f, I.BUCKET_OF_WATER_3), 1);
  assert.ok(messages(f).includes("You scoop up a bucket of stagnant water."));
  assert.ok(f.animations.some((a) => a.id === 2812));
});

test("the stagnant water used on Braindeath gets the capture's answer (ticks 1629-1633)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.WATER, items: [[I.BUCKET_OF_WATER_3]] });
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  const lines = await play(f, () => useOnNpc(f, braindeath, I.BUCKET_OF_WATER_3));
  assert.deepEqual(lines, [
    "PLAYER: What exactly do you want me to do with this?",
    "Captain Braindeath: I want ye to go pour that bucket into yonder hopper.",
    "Captain Braindeath: Take yer time, lad, we're only bein' besieged by zombies.",
  ]);
});

test("the water in the hopper: stage 10 and the bucket back, its line with seq 2283 a tick later (ticks 1665-1666)", async (t) => {
  const f = actor(t, { at: [2142, 5101, 2], stage: S.WATER, items: [[I.BUCKET_OF_WATER_3]] });
  await useOnObject(f, 10170, [2142, 5102], I.BUCKET_OF_WATER_3);
  const used = f.tick;
  assert.equal(stage(f), S.WATER_ADDED);
  assert.equal(count(f, I.BUCKET), 1);
  h.ticks(f, 1);
  assert.equal(messageAt(f, "You dump the water into the hopper.") - used, 1);
  assert.ok(f.animations.some((a) => a.id === 2283));
});

// ------------------------------------------------------------------ Sluglings

test("the sluglings talk: the line the Wiki joins shows as two, and the fishbowl comes with stage 11 (ticks 1703-1731)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.WATER_ADDED });
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  const lines = await play(f, () => h.talk(f, braindeath));
  const secret = lines.indexOf("Captain Braindeath: 'Cos, lad they're one of our super-secret ingredients!");
  assert.ok(secret > 0);
  assert.equal(lines[secret + 1], "Captain Braindeath: Yer not too susceptible to mind control are ye lad?");
  assert.ok(lines.includes("PLAYER: They aren't related to those Seaslugs are they?"), "Sea Slug done");
  assert.equal(stage(f), S.CATCH);
  assert.equal(count(f, I.FISHBOWL_AND_NET), 1);
});

test("the squid spot: one catch a click, the message and seq 2813 at once, the catch 4 ticks later (ticks 1800-1804)", async (t) => {
  const f = actor(t, { at: [2173, 5073, 0], stage: S.CATCH, items: [[I.FISHBOWL_AND_NET]] });
  const spot = h.spawn(f, N.SQUID, [2173, 5074, 0]);
  const fishingXp = f.player.getSkillManager().getExperience(Sk.FISHING);
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([{ type: "npc_option", index: spot.getIndex(), clickType: 1 }]);
  h.tick(f);
  const dunk = messageAt(f, "You dunk the bowl in the water...");
  assert.ok(dunk !== undefined);
  assert.ok(f.animations.some((a) => a.id === 2813 && a.tick === dunk));
  h.ticks(f, 6);
  const caught = f.messages.find((m) => /^\.\.\.and you catch (some Sluglings|a Karamthulhu)!$/.test(m.text));
  assert.equal(caught.tick - dunk, 4);
  assert.equal(count(f, I.SLUGLINGS) + count(f, I.KARAMTHULHU), 1, "one catch, no loop");
  assert.equal(f.player.getSkillManager().getExperience(Sk.FISHING), fishingXp, "no Fishing XP");
});

test("the barrel counts what goes in and the lever pressurises five, stage 12 two ticks on (ticks 1964-2010)", async (t) => {
  const f = actor(t, { at: [2140, 5102, 2], stage: S.CATCH, items: [[I.SLUGLINGS], [I.SLUGLINGS], [I.KARAMTHULHU], [I.SLUGLINGS], [I.SLUGLINGS]] });
  await clickObject(f, 10171, [2141, 5102], 2);
  assert.equal(messages(f).at(-1), "This barrel is empty and smells nasty.");
  await useOnObject(f, 10171, [2141, 5102], I.SLUGLINGS);
  assert.equal(messages(f).at(-1), "You stuff the squirming Sluglings into the barrel.");
  assert.ok(f.animations.some((a) => a.id === 832));
  await clickObject(f, 10171, [2141, 5102], 2);
  assert.equal(messages(f).at(-1), "There are some Sluglings in this barrel.");
  await useOnObject(f, 10171, [2141, 5102], I.SLUGLINGS);
  await clickObject(f, 10171, [2141, 5102], 2);
  assert.equal(messages(f).at(-1), "There are 2 loads of Sluglings and 0 Karamthulhu in this barrel.");
  await useOnObject(f, 10171, [2141, 5102], I.KARAMTHULHU);
  await useOnObject(f, 10171, [2141, 5102], I.SLUGLINGS);
  await useOnObject(f, 10171, [2141, 5102], I.SLUGLINGS);
  assert.deepEqual(varbits(f, V.BARREL), [1, 2, 3, 4, 5]);
  assert.deepEqual(varbits(f, V.THULHU), [0, 0, 1, 1, 1]);
  await clickObject(f, 10164, [2141, 5103], 1);
  const pulled = f.tick;
  assert.equal(varbits(f, V.BARREL).at(-1), 0);
  h.ticks(f, 2);
  assert.equal(stage(f), S.PRESSURISED);
  assert.equal(varbitAt(f, V.HOPPER, 1) - pulled, 2, "the controls possessed with the stage (tick 2010)");
});

// ------------------------------------------------------------------ The Evil Spirit

test("the wrench with stage 13, a lost one replaced, Davey's blessing and his second (ticks 2030-2300)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.PRESSURISED });
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  await play(f, () => h.talk(f, braindeath));
  assert.equal(stage(f), S.BLESS);
  assert.equal(count(f, I.WRENCH), 1);
  f.player.getInventory().deleteNumber(I.WRENCH, 1);
  const lost = await play(f, () => h.talk(f, braindeath), ["What exactly do you want me to do?"]);
  assert.ok(lost.includes("PLAYER: Mumblemumblewhatwrenchmumble..."));
  assert.equal(count(f, I.WRENCH), 1, "another wrench (tick 2088)");

  const d = actor(t, { at: [2133, 5100, 1], stage: S.BLESS, items: [[I.WRENCH]] });
  const davey = h.spawn(d, N.DAVEY, [2132, 5100, 1]);
  await h.talk(d, davey);
  await until(d, "All right. Brace yourself.");
  await h.continueLine(d);
  const cheer = d.tick;
  assert.equal(count(d, I.HOLY_WRENCH), 1, "blessed as the chat closes (tick 2141)");
  const rest = await play(d, null);
  assert.ok(d.animations.some((a) => a.id === 2811 && a.tick - cheer === 9), "the flourish nine ticks on (tick 2150)");
  assert.equal(rest.at(-1), "PLAYER: Well, no. I don't know what you mean, but I'm sure I'll find out!");
  const again = await play(d, () => h.talk(d, davey));
  assert.equal(again.at(-1), "Davey: You mean more help? I've already blessed one wrench for you, that should be enough.");
});

test("the controls: the plain wrench's two lines, then the holy wrench's smite and the spirit two ticks on (ticks 2238-2317)", async (t) => {
  const f = actor(t, { at: [2143, 5101, 1], stage: S.BLESS, items: [[I.WRENCH], [I.HOLY_WRENCH]] });
  await useOnObject(f, 10104, [2143, 5100], I.WRENCH);
  const plain = f.tick;
  h.ticks(f, 2);
  assert.equal(messageAt(f, "You try and force the Evil Spirit from the controls with the wrench!"), plain);
  assert.equal(messageAt(f, "Well, it seems that this wrench is just not holy enough to work. You should go and get it blessed.") - plain, 2);
  assert.ok(f.overheads.some((o) => o.text === "Come out and face me!"));
  await useOnObject(f, 10104, [2143, 5100], I.HOLY_WRENCH);
  const smite = f.tick;
  assert.ok(f.animations.some((a) => a.id === 2810 && a.tick === smite));
  assert.ok(f.overheads.some((o) => o.text === "The power of Guthix compels you!"));
  h.ticks(f, 2);
  assert.equal(messageAt(f, "The Evil Spirit is forced from the controls!") - smite, 2);
  const spirit = [...h.core.World.getNpcs()].find((n) => n && n.getId() === N.SPIRIT);
  assert.ok(spirit, "the Evil Spirit");
  assert.deepEqual([spirit.getLocation().getX(), spirit.getLocation().getY(), spirit.getLocation().getZ()], [2143, 5097, 1]);
  h.PM.emitNpcDeath?.({ npc: spirit, npcId: N.SPIRIT, killer: f.player });
  assert.equal(stage(f), S.BANISHED);
  assert.ok(messages(f).includes("You have banished the Evil Spirit!"));
  assert.equal(varbits(f, V.HOPPER).at(-1), 0);
  h.core.World.getNpcs().remove(spirit);
});

// ------------------------------------------------------------------ The fever spider and the brew

test("the Fever Spider talk ends at stage 15, and the body drops only during the quest (ticks 2390-2435)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.BANISHED });
  f.player.getEquipment().setItem(h.core.Equipment.HANDS_SLOT, new h.core.Item(I.SLAYER_GLOVES_2, 1));
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  const lines = await play(f, () => h.talk(f, braindeath));
  assert.equal(lines.at(-1), "Captain Braindeath: I see yer already wearin' some Slayer Gloves. That'll keep the Fever Spiders from gnawin' yer hands off!");
  assert.equal(stage(f), S.SPIDER);
  const verdict = (player) => {
    const request = { player, npcId: N.SPIDER, itemId: I.FEVER_SPIDER_BODY, allowed: undefined };
    h.PM.emitCustomEvent("npc-drops:quest-item", request);
    return request.allowed;
  };
  assert.equal(verdict(f.player), true);
  h.quest().setStage(f.player, S.COMPLETE);
  assert.equal(verdict(f.player), false);
});

test("the brew: the camera on the controls, 1355 = 2 three ticks on, the talk on at six, stage 17 at the end (ticks 2546-2564)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.SPIDER_ADDED });
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  await h.talk(f, braindeath);
  await until(f, "Now ye stand well back");
  await h.continueLine(f);
  const closed = f.tick;
  const lines = await play(f, null);
  assert.equal(varbitAt(f, V.HOPPER, 2) - closed, 3);
  assert.equal(lines[0], "PLAYER: Is that it?");
  assert.equal(stage(f), S.SWILL);
  assert.equal(count(f, I.BUCKET), 0, "no bucket handed over");
});

test("the tap fills the bucket; Braindeath reminds a player without the 'rum' (ticks 2576-2605)", async (t) => {
  const f = actor(t, { at: [2142, 5094, 1], stage: S.SWILL, items: [[I.BUCKET]] });
  await clickObject(f, 10148, [2142, 5093], 1);
  assert.ok(messages(f).includes("You carefully fill the bucket with the foul-smelling swill."));
  assert.equal(count(f, I.UNSANITARY_SWILL), 1);
  const g = actor(t, { at: WAKE, stage: S.SWILL });
  const braindeath = h.spawn(g, N.BRAINDEATH, BRAINDEATH_TILE);
  const lines = await play(g, () => h.talk(g, braindeath));
  assert.equal(lines.at(-1), "Captain Braindeath: And don't ferget the 'rum'!");
});

test("Donnie drinks: stage 18 and the pirates' varbits with 'Hand it over', the swill gone; again with more (ticks 2726-2765)", async (t) => {
  const f = actor(t, { at: [2151, 5082, 0], stage: S.SWILL, items: [[I.UNSANITARY_SWILL]] });
  const donnie = h.spawn(f, N.DONNIE, [2151, 5081, 0]);
  const lines = await play(f, () => h.talk(f, donnie));
  assert.equal(lines[0], "Captain Donnie: Be that the finest, most abrasive 'rum' I've ever smelled?");
  assert.equal(stage(f), S.DONNIE);
  assert.equal(count(f, I.UNSANITARY_SWILL), 0);
  assert.equal(varbits(f, V.PIRATE_A).at(-1), 1);
  const plain = await play(f, () => h.talk(f, donnie), ["Ask what you wanted."]);
  assert.deepEqual(plain.slice(0, 2), ["Captain Donnie: Arr! What be ye wantin?", "PLAYER: I, err, came to..."], "without 'rum' (tick 2769)");
  f.player.getInventory().add(new h.core.Item(I.UNSANITARY_SWILL, 1), false);
  const more = await play(f, () => h.talk(f, donnie));
  assert.equal(more[0], "Captain Donnie: Hey you! I can smell the 'rum' on ye!");
  assert.equal(count(f, I.UNSANITARY_SWILL), 0);
});

test("completion: Braindeath's last talk, the scroll's five lines and the rewards once (ticks 2784-2813)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.DONNIE, items: [[I.HOLY_WRENCH]] });
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  const prayer = f.player.getSkillManager().getExperience(Sk.PRAYER);
  const lines = await play(f, () => h.talk(f, braindeath));
  assert.equal(lines.at(-1), "Captain Braindeath: Thanks, lad. We'd never have managed without ye!");
  assert.equal(stage(f), S.COMPLETE);
  assert.equal(f.player.getSkillManager().getExperience(Sk.PRAYER) - prayer, 7000);
  assert.equal(count(f, I.HOLY_WRENCH), 1, "no second wrench");
  const scroll = f.calls.filter((c) => c.name === "sendString").map((c) => String(c.args[0]));
  for (const line of ["2 Quest Points", "7,000 Prayer XP", "7,000 Fishing XP", "7,000 Farming XP", "A Holy Wrench"]) assert.ok(scroll.includes(line), line);
});

// ------------------------------------------------------------------ After the quest

test("after the quest: Braindeath, Davey and Donnie's own pages (ticks 2874, 2964, 3162)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.COMPLETE, items: [[I.HOLY_WRENCH]] });
  const braindeath = h.spawn(f, N.BRAINDEATH, BRAINDEATH_TILE);
  assert.equal((await play(f, () => h.talk(f, braindeath)))[0], "Captain Braindeath: Fancy some 'rum', lad? It's still fresh. Well, fresh-ish...");
  const davey = h.spawn(f, N.DAVEY, [2145, 5108, 1]);
  assert.equal((await play(f, () => h.talk(f, davey)))[0], "Davey: Ello again guv. How's things?");
  const donnie = h.spawn(f, N.DONNIE, [2145, 5107, 1]);
  assert.equal((await play(f, () => h.talk(f, donnie)))[0], "Captain Donnie: Hey! You!");
});

test("Pete's lifts: the blow, the fade, the far dock and his excuse, each way (ticks 3077-3129)", async (t) => {
  const f = actor(t, { at: [2162, 5114, 1], stage: S.COMPLETE });
  const island = h.spawn(f, N.ISLAND_PETE, [2162, 5115, 1]);
  const lines = await play(f, () => h.talk(f, island), ["Okay!"]);
  assert.deepEqual(lines.slice(0, 3), ["PLAYER: Do I know you?", "Pirate Pete: Yes, you owe me some money.", "Pirate Pete: Want a lift to Port Phasmatys?"]);
  assert.deepEqual(at(f), [3680, 3536, 0]);
  assert.ok(lines.includes("PLAYER: Ooooh... my head..."));
  assert.equal(lines.at(-1), "PLAYER: Wow... I'm lucky I wasn't seriously hurt!");
  assert.ok(f.animations.some((a) => a.id === 401));
  const pete = h.spawn(f, N.PETE, [3680, 3537, 0]);
  const back = await play(f, () => h.talk(f, pete), ["Okay!"]);
  // The Wiki's dock branch (the capture goes straight to the menu, tick 3104: a recorded difference).
  assert.deepEqual(back.slice(2, 6), [
    "Pirate Pete: Want a lift to Braindeath Island?",
    "PLAYER: Well, possibly, but could I go to Mos Le'Harmless instead?",
    "Pirate Pete: Nope. It's Braindeath island or nothing. Interested?",
    "MENU[Select an option]: Okay!|Not now|Why do I get a headache every time I see you?|Are you any relation to Party Pete?",
  ]);
  assert.deepEqual(at(f), [2162, 5114, 1]);
});

// ------------------------------------------------------------------ The journal

test("the journal as the capture shows it at the seeds, planted, grown and swill pages (ticks 629, 852, 1177, 2643)", async (t) => {
  const f = actor(t, { at: WAKE, stage: S.SEEDS });
  const page = () => h.quest().buildJournal?.(f.player, h.quest()) ?? h.quest().journal?.(f.player);
  const seeds = page();
  assert.deepEqual(seeds.slice(0, 3), ["", "<str>I have spoken to Pirate Pete, and have agreed to help him", "<str>find his Family Sword."]);
  assert.equal(seeds.at(-1), "<col=000080><col=800000>Herb Patch<col=800000><col=000080> if I want them to stop attacking me.");
  f.player.setAttribute("quest.rum_deal.planted", Date.now());
  const planted = page();
  assert.equal(planted.at(-2), "<col=000080>I have planted my <col=800000>Blindweed Seeds<col=000080>, and should wait for them");
  f.player.setAttribute("quest.rum_deal.planted", 0);
  h.quest().setStage(f.player, S.SWILL);
  const swill = page();
  assert.equal(swill.length, 72, "72 lines, as qj1-qj72");
  assert.equal(swill.at(-1), "<col=000080>it to him.");
});
