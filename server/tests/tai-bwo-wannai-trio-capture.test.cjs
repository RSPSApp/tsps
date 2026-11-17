// Run after `yarn build`: node --test tests/tai-bwo-wannai-trio-capture.test.cjs
//
// Tai Bwo Wannai Trio against two whole runs of the quest on live: RSProx captures local 1001562 (revision 241)
// and 75 (revision 227), with JunglePotion (revision 242.1) for Timfraku before Jungle Potion
// (docs/quests/tai-bwo-wannai-trio/README.md). Real Player, PlayerSession and ClientConnection, the real
// plugins, cache and map: talks and item uses are packets and each tick runs as World.process does. Ticks in
// the test names are the captures'; the gaps asserted are live's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "tai_bwo_wannai_trio";
const TIMFRAKU = [2782, 3089, 1];
const BY_TIMFRAKU = [2782, 3088, 1];
const LUBUFU = [2773, 3170, 0];
const BY_LUBUFU = [2773, 3171, 0];
const TIADECHE = [2912, 3118, 0];
const BY_TIADECHE = [2911, 3117, 0];
const TAMAYU = [2841, 3044, 0];
const BY_TAMAYU = [2842, 3044, 0];
const TINSAY = [2766, 2971, 0];
const BY_TINSAY = [2767, 2971, 0];
const BONES_TILE = [2919, 3065, 0];
const OBJECTBOX = 193;
const MESBOX = 229;
const SCROLL = 153;
const STATE = {
  TIADECHE: "quest.tai_bwo_wannai_trio.tiadeche", TINSAY: "quest.tai_bwo_wannai_trio.tinsay",
  TAMAYU: "quest.tai_bwo_wannai_trio.tamayu", LUBUFU: "quest.tai_bwo_wannai_trio.lubufu",
  AGILITY: "quest.tai_bwo_wannai_trio.agility", SPEAR: "quest.tai_bwo_wannai_trio.spear",
};

let I;
let S;
before(async () => {
  h.key = KEY;
  await h.setup([[2782, 3089], [2773, 3170], [2912, 3118], [2841, 3044], [2766, 2971], [2520, 4568], [2919, 3065]]);
  I = h.core.ItemIdentifiers;
  S = h.core.Skill;
});
after(() => h.teardown());

const stage = (f) => h.quest().getStage(f.player);
const said = (f, from = 0) => f.said.slice(from).map((s) => (s.who === "menu" ? `MENU: ${s.text}` : s.text));
const tickOf = (f, text, from = 0) => f.said.slice(from).find((s) => s.text === text || s.text.startsWith(text))?.tick;
const messages = (f) => f.messages.map((m) => String(m.text));
const varps = (f, id) => f.calls.filter((c) => c.name === "sendConfig" && c.args[0] === id).map((c) => [c.tick, c.args[1]]);
const group = (f) => f.player.getPacketSender().getChatboxGroupId();
const xp = (f, skill) => f.player.getSkillManager().getExperience(skill);
const count = (f, id) => f.player.getInventory().getAmount(id);

function actor(t, { at = BY_TIMFRAKU, stage: value = 0, jungle = 13, items = [], attributes = {} } = {}) {
  const f = h.actor(t, { at, stage: value, done: [], attributes });
  h.quest("jungle_potion").setStage(f.player, jungle);
  const skills = f.player.getSkillManager();
  for (const skill of [S.COOKING, S.AGILITY, S.FISHING, S.FIREMAKING]) {
    skills.setMaxLevels(skill, 60);
    skills.setCurrentLevel(skill, 60, false);
  }
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount), false);
  f.calls.length = 0;
  f.messages.length = 0;
  return f;
}

/** Plays a conversation: every line continued, each menu answered with the next pick, pauses waited out. */
async function converse(f, start, picks = []) {
  const from = f.said.length;
  const queue = [...picks];
  await start();
  for (let idle = 0, i = 0; i < 400 && idle < 20; i++) {
    const line = h.shown(f);
    if (!line) { idle++; h.tick(f); continue; }
    idle = 0;
    if (line.who === "menu") {
      if (!queue.length) break;
      await h.choose(f, queue.shift());
      continue;
    }
    await h.continueLine(f);
  }
  return from;
}

async function use(f, npc, itemId) {
  f.player.getPacketSender().sendInterfaceRemoval();
  h.tick(f);
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  await f.connection.dispatch([{ type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot, widgetId: 149 << 16 }]);
  for (let i = 0; i < 20 && !h.shown(f); i++) h.tick(f);
}

/** One item used on another, through the plugins' item-on-item hook (as tai-trio-jogre-bones.test.cjs does). */
async function combine(f, usedId, withId) {
  const items = f.player.getInventory().getItems();
  const slot = (id) => items.findIndex((item) => item?.getId() === id);
  h.PM.emitItemOnItem({
    player: f.player, usedItem: items[slot(usedId)], usedItemId: usedId, usedItemSlot: slot(usedId),
    usedWithItem: items[slot(withId)], usedWithItemId: withId, usedWithItemSlot: slot(withId), handled: false,
  });
  h.tick(f);
}

/** Continues to `text` (a line or a menu), failing if it never shows. */
async function until(f, text, limit = 60) {
  for (let i = 0; i < limit; i++) {
    const line = h.shown(f);
    if (line?.text?.startsWith(text) || (line?.who === "menu" && line.text.includes(text))) return f.tick;
    if (line && line.who !== "menu") await h.continueLine(f);
    else h.tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

// ------------------------------------------------------------------ Timfraku

test("the start: varp 320 1 at the continue past 'Well then', 2 as the prompt opens, 3 on Yes (local 1001562 ticks 5483-5547)", async (t) => {
  const f = actor(t);
  const tim = h.spawn(f, h.core.NpcIdentifiers.TIMFRAKU, TIMFRAKU);
  await h.talk(f, tim);
  await until(f, "I am a roving adventurer.");
  await h.choose(f, "I am a roving adventurer.");
  await until(f, "Well then adventurer, you would do better to rove elsewhere.");
  assert.equal(stage(f), 0, "not yet as the line shows");
  await h.continueLine(f);
  assert.equal(stage(f), 1, "as it is continued, with the next menu (tick 5486)");
  assert.deepEqual(h.shown(f).text.split("|"), ["Why should I leave?", "Right, I'm going then.", "Trufitus sent me.", "Ask about Village."]);
  await h.choose(f, "Trufitus sent me.");
  await until(f, "Then it must be true.");
  await h.continueLine(f);
  const continued = f.tick;
  assert.ok(messages(f).includes("Timfraku appears to concentrate very deeply."), "as it is continued (tick 5511)");
  assert.equal(group(f), -1, "the chatbox closes for the pause");
  const next = await until(f, "I cannot thank you enough for what you have done so far.");
  assert.equal(next - continued, 4, "4 ticks later (5511-5515)");
  await until(f, "Your gratitude is all I deserve.");
  await h.choose(f, "Your gratitude is all I deserve.");
  await until(f, "Yes.|No.");
  assert.equal(stage(f), 2, "as the start prompt opens (tick 5544)");
  await h.choose(f, "Yes.");
  assert.equal(stage(f), 3);
  assert.ok(messages(f).some((m) => /^You've started a new quest: <col=[0-9a-f]{6}>Tai Bwo Wannai Trio<\/col>$/.test(m)));
  await until(f, "Ok, I'll do it.");
});

test("before Jungle Potion's news: no 'Trufitus sent me.', and the next talk is 'You again!' (JunglePotion ticks 534-575)", async (t) => {
  const f = actor(t, { jungle: 5 });
  const tim = h.spawn(f, h.core.NpcIdentifiers.TIMFRAKU, TIMFRAKU);
  const from = await converse(f, () => h.talk(f, tim), ["Who me? Oh I'm just a nobody."]);
  assert.deepEqual(said(f, from).at(-1), "MENU: Why should I leave?|Right, I'm going then.");
  assert.equal(stage(f), 1, "sent away: tbwt_main 0 -> 1 even before Jungle Potion (tick 544)");
  await h.choose(f, "Right, I'm going then.");
  h.ticks(f, 3);
  const again = await converse(f, () => h.talk(f, tim), ["What instructions??"]);
  assert.deepEqual(said(f, again), [
    "You again! Only a fool would ignore my instructions.",
    "MENU: Well there's a simple explanation for that...|Not so much ignore as disregard...|What instructions??",
    "What instructions??", "I said: begone!",
  ]);
});

test("met, with Jungle Potion's news: the player opens with 'Trufitus sent me.' (JunglePotion tick 1429)", async (t) => {
  const f = actor(t, { stage: 1 });
  const tim = h.spawn(f, h.core.NpcIdentifiers.TIMFRAKU, TIMFRAKU);
  await h.talk(f, tim);
  assert.equal(h.shown(f).who, "PLAYER");
  assert.equal(h.shown(f).text, "Trufitus sent me.");
  await until(f, "Trufitus Shakaya? What news does he send?");
});

test("a refused start replays the prompt behind 'Are you ready to help me?' (JunglePotion ticks 1462-1469)", async (t) => {
  const f = actor(t, { stage: 2 });
  const tim = h.spawn(f, h.core.NpcIdentifiers.TIMFRAKU, TIMFRAKU);
  const from = await converse(f, () => h.talk(f, tim), ["No."]);
  assert.deepEqual(said(f, from), [
    "Are you ready to help me?", "What do I have to do?",
    "I ask you to deliver the good news to my three sons Tamayu, Tinsay & Tiadeche, and then return them to the village.",
    "MENU: Yes.|No.", "No, I've had quite enough of the jungle already.", "Very well. Return when you are ready.",
  ]);
  assert.equal(stage(f), 2);
  await converse(f, () => h.talk(f, tim), ["Yes."]);
  assert.equal(stage(f), 3);
});

test("the reward: 4 -> 5 and 2,000 coins at Timfraku's coin box, 5 -> 6 as it is continued, then the scroll (local 1001562 ticks 8097-8105)", async (t) => {
  const f = actor(t, { stage: 4 });
  const fishing = xp(f, S.FISHING);
  const tim = h.spawn(f, h.core.NpcIdentifiers.TIMFRAKU, TIMFRAKU);
  await h.talk(f, tim);
  await until(f, "Oh it was nothing really.");
  await h.choose(f, "Oh it was nothing really.");
  await until(f, "Timfraku hands you a big stack of gold coins.");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(stage(f), 5);
  assert.equal(count(f, I.COINS), 2000);
  await h.continueLine(f);
  assert.equal(stage(f), 6, "complete as the box is continued");
  h.ticks(f, 2);
  assert.equal(f.player.getInterfaceId(), SCROLL);
  const lines = f.calls.filter((c) => c.name === "sendString" && ((c.args[1] >> 16) === SCROLL)).map((c) => c.args[0]);
  for (const reward of ["2 Quest Points", "5,000 Fishing XP", "5,000 Cooking XP", "2,500 Attack XP", "2,500 Strength XP"]) {
    assert.ok(lines.includes(reward), `${reward} on the scroll: ${JSON.stringify(lines)}`);
  }
  assert.ok(!lines.some((line) => /Coins/i.test(line)), "the coins aren't listed");
  assert.equal(xp(f, S.FISHING), fishing, "the brothers hand out the XP later");
  h.ticks(f, 3);
  assert.equal(h.shown(f), null, "the talk waits for the scroll");
  f.player.getPacketSender().sendInterfaceRemoval();
  const tail = await until(f, "You should go and see my sons in the village. I think they have something for you.");
  assert.ok(tail);
  await until(f, "What do you do here?|Is there anything interesting to do here?|I've been doing some work around the village.|Ok, thanks.");
});

// ------------------------------------------------------------------ Lubufu

test("Lubufu: the player's 'Who are you?', and his bait offer once he has said what he does with his Karambwan (local 1001562 ticks 5616-5713)", async (t) => {
  const f = actor(t, { at: BY_LUBUFU, stage: 3 });
  const lub = h.spawn(f, h.core.NpcIdentifiers.LUBUFU, LUBUFU);
  const first = await converse(f, () => h.talk(f, lub), ["Who are you?"]);
  assert.deepEqual(said(f, first).slice(2, 4), ["Who are you?", "I am Lubufu - the only fisherman who knows the secret of the Karambwan!"]);
  h.ticks(f, 3);
  const again = await converse(f, () => h.talk(f, lub), ["Talk about him...", "What do you do?", "What do you do with your Karambwan?", "Talk about him...", "What do you do?"]);
  const menus = said(f, again).filter((line) => line.startsWith("MENU: What do you do with"));
  assert.deepEqual(menus, [
    "MENU: What do you do with your Karambwan?|How old are you?|What do you use for bait?",
    "MENU: What do you do with your Karambwan?|How old are you?|What do you use for bait?|I could help collect the bait.",
  ]);
  assert.equal(said(f, again)[3], "MENU: Talk about him...|Talk about Karambwan...|Talk about something else...|Leave");
});

test("Lubufu: the apprentice offer on the third 'What do you use to catch Karambwan?', his think pause, and the vessel and 1,500 XP at its box (ticks 5801-5946)", async (t) => {
  const f = actor(t, { at: BY_LUBUFU, stage: 3, attributes: { [STATE.LUBUFU]: 25 } });
  const lub = h.spawn(f, h.core.NpcIdentifiers.LUBUFU, LUBUFU);
  for (let ask = 0; ask < 2; ask++) {
    const from = await converse(f, () => h.talk(f, lub), ["What do you use to catch Karambwan?"]);
    assert.equal(said(f, from).at(-1), "Well ... since you ask, a specially constructed octopus pot. But don't tell anybody - that's part of the secret!", `ask ${ask + 1} ends there`);
    h.ticks(f, 3);
  }
  const fishing = xp(f, S.FISHING);
  await h.talk(f, lub);
  await h.choose(f, "What do you use to catch Karambwan?");
  await until(f, "My, you're keen aren't you?");
  await h.continueLine(f);
  const continued = f.tick;
  assert.ok(messages(f).includes("Lubufu appears to think for a moment."));
  const offer = await until(f, "How would you feel about becoming my apprentice?");
  assert.equal(offer - continued, 3, "3 ticks later (5864-5867)");
  await until(f, "Yes!|No.");
  await h.choose(f, "Yes!");
  await until(f, "Lubufu teaches you a new fishing technique.");
  assert.equal(group(f), OBJECTBOX);
  await until(f, "Lubufu hands you a Karambwan vessel.");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(count(f, I.KARAMBWAN_VESSEL), 1, "with the box (tick 5939)");
  assert.equal(xp(f, S.FISHING) - fishing, 1500);
  await until(f, "Feel free to practise on my fishing spot.");
});

// ------------------------------------------------------------------ Tiadeche

test("Tiadeche: varp 321 1 on the talk, 2 as 'I will return only...' shows; the baited vessel 3, his attempt pause and his catch (local 1001562 ticks 6182-6257, 75 3688-3769)", async (t) => {
  const f = actor(t, { at: BY_TIADECHE, stage: 3, items: [[I.KARAMBWAN_VESSEL_3, 1]] });
  const tia = h.spawn(f, h.core.NpcIdentifiers.TIADECHE, TIADECHE);
  await converse(f, () => h.talk(f, tia), []);
  const [[talked, one], [shown, two]] = varps(f, 321);
  assert.deepEqual([one, two], [1, 2]);
  assert.equal(talked, tickOf(f, "Are you Tiadeche?"));
  assert.equal(shown, tickOf(f, "I will return only when I have caught a Karambwan."));
  await use(f, tia, I.KARAMBWAN_VESSEL_3);
  await until(f, "You hand over the Karambwan vessel to Tiadeche.");
  assert.equal(count(f, I.KARAMBWAN_VESSEL_3), 0);
  assert.deepEqual(varps(f, 321).at(-1)[1], 3);
  await until(f, "As you say, Bwana.");
  await h.continueLine(f);
  const continued = f.tick;
  assert.ok(messages(f).includes("Tiadeche attempts to use the Karambwan vessel."));
  const eyes = await until(f, "Bwana! I cannot believe my eyes!");
  assert.equal(eyes - continued, 12, "12 ticks (6234-6246)");
  await until(f, "Yes|No");
  await h.choose(f, "Yes");
  await until(f, "Tiadeche hands you his first catch!");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(count(f, I.RAW_KARAMBWAN), 1);
  await until(f, "Take a Karambwan vessel to my brother Tinsay.");
  assert.deepEqual(varps(f, 321).at(-1)[1], 4);
});

test("Tiadeche: left before his request, the next talk is 'Can we return to the village now?' (local 1001562 ticks 6699-6730)", async (t) => {
  const f = actor(t, { at: BY_TIADECHE, stage: 3, attributes: { [STATE.TIADECHE]: 3 } });
  const tia = h.spawn(f, h.core.NpcIdentifiers.TIADECHE, TIADECHE);
  const from = await converse(f, () => h.talk(f, tia), []);
  assert.equal(said(f, from)[0], "Can we return to the village now?");
  assert.equal(said(f, from).at(-1), "I ... never mind.");
  assert.equal(f.player.getAttribute(STATE.TIADECHE), 4);
});

test("Tiadeche: the manual is handed over, varp 321 5 -> 6, and the last son home is tbwt_main 4 (local 1001562 ticks 7903-7942)", async (t) => {
  const f = actor(t, { at: BY_TIADECHE, stage: 3, items: [[I.CRAFTING_MANUAL, 1]], attributes: { [STATE.TIADECHE]: 5, [STATE.TINSAY]: 7, [STATE.TAMAYU]: 4 } });
  const tia = h.spawn(f, h.core.NpcIdentifiers.TIADECHE, TIADECHE);
  await h.talk(f, tia);
  await until(f, "You hand over the crafting manual to Tiadeche.");
  assert.equal(count(f, I.CRAFTING_MANUAL), 0);
  assert.deepEqual(varps(f, 321).at(-1)[1], 6);
  await until(f, "I will meet you in the village once you have helped my brothers and spoken to my father.");
  assert.equal(stage(f), 3, "not yet as the line shows");
  await h.continueLine(f);
  assert.equal(stage(f), 4, "as it is continued");
});

// ------------------------------------------------------------------ Tinsay

test("Tinsay: his pause before the first request, the rum box's 4-tick pause and the bones' 9 (local 1001562 ticks 7467-7471, 7509-7513, 7681-7690)", async (t) => {
  const f = actor(t, { at: BY_TINSAY, stage: 3, items: [[I.KARAMJAN_RUM_2, 1], [I.MARINATED_J_BONES, 1]] });
  const tin = h.spawn(f, h.core.NpcIdentifiers.TINSAY, TINSAY);
  await h.talk(f, tin);
  await until(f, "Right ... what do you need?");
  await h.continueLine(f);
  let continued = f.tick;
  assert.ok(messages(f).includes("Tinsay pauses and then mutters to himself."));
  assert.equal(await until(f, "Hmm ... I think I need banana in Karamjan rum.") - continued, 4);
  await converse(f, async () => {}, []);
  await h.talk(f, tin);
  await until(f, "Yes.|No.");
  await h.choose(f, "Yes.");
  await until(f, "You hand Tinsay the sliced bananas in Karamjan rum.");
  assert.equal(count(f, I.KARAMJAN_RUM_2), 0);
  await h.continueLine(f);
  continued = f.tick;
  assert.equal(await until(f, "Yes ... that's it! Hits just the spot!") - continued, 4);
  await converse(f, async () => {}, []);
  f.player.setAttribute(STATE.TINSAY, 6);
  await h.talk(f, tin);
  await until(f, "Yes.|No.");
  await h.choose(f, "Yes.");
  await until(f, "You hand Tinsay the burnt Jogre bones marinated in Karambwanji.");
  await h.continueLine(f);
  continued = f.tick;
  assert.equal(await until(f, "Finally! A near lifetime of craving satisfied!") - continued, 9);
  assert.equal(f.player.getAttribute(STATE.TINSAY), 7);
});

test("Tinsay: the vessel for Tiadeche, then his manual's box 4 ticks later with varp 321 4 -> 5 (local 1001562 ticks 7740-7764)", async (t) => {
  const f = actor(t, { at: BY_TINSAY, stage: 3, items: [[I.KARAMBWAN_VESSEL_3, 1]], attributes: { [STATE.TINSAY]: 7, [STATE.TIADECHE]: 4 } });
  const tin = h.spawn(f, h.core.NpcIdentifiers.TINSAY, TINSAY);
  await use(f, tin, I.KARAMBWAN_VESSEL_3);
  assert.equal(h.shown(f).text, "Your brother Tiadeche has sent me. He asks you to study this vessel and produce crafting instructions.");
  await until(f, "You hand over the Karambwan vessel to Tinsay.");
  await h.continueLine(f);
  const continued = f.tick;
  assert.ok(messages(f).includes("Tinsay studies it for a moment then quickly sketches some crafting instructions."));
  assert.equal(count(f, I.CRAFTING_MANUAL), 0, "not yet");
  assert.equal(await until(f, "Tinsay hands you a Karambwan vessel crafting manual.") - continued, 4);
  assert.equal(count(f, I.CRAFTING_MANUAL), 1);
  assert.equal(f.player.getAttribute(STATE.TIADECHE), 5);
});

// ------------------------------------------------------------------ Tamayu

test("Tamayu: the watched hunt, back 25 ticks later with his lines (local 1001562 ticks 7097-7130)", async (t) => {
  const f = actor(t, { at: BY_TAMAYU, stage: 3, attributes: { [STATE.TAMAYU]: 2 } });
  const tam = h.spawn(f, h.core.NpcIdentifiers.TAMAYU, TAMAYU);
  await h.talk(f, tam);
  await h.choose(f, "When will you succeed?");
  await until(f, "Yes|No");
  await h.choose(f, "Yes");
  await until(f, "Lead the way.");
  await h.continueLine(f);
  const left = f.tick;
  h.tick(f);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [2520, 4568], "in the arena");
  const back = await until(f, "Shaikhan is at present far too agile for me!", 40);
  assert.equal(back - left, 25);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [BY_TAMAYU[0], BY_TAMAYU[1]]);
  assert.equal(f.player.getAttribute(STATE.TAMAYU), 3);
});

test("Tamayu: the potion's box and his drink pause, the spear's box, then his win with the Karambwan-poisoned spear (local 1001562 ticks 7155-7253)", async (t) => {
  const f = actor(t, { at: BY_TAMAYU, stage: 3, items: [[I.AGILITY_POTION_4_, 1], [I.IRON_SPEAR_KP_, 1]], attributes: { [STATE.TAMAYU]: 3 } });
  const tam = h.spawn(f, h.core.NpcIdentifiers.TAMAYU, TAMAYU);
  await use(f, tam, I.AGILITY_POTION_4_);
  assert.equal(h.shown(f).text, "I've noticed you commenting on the Shaikahan's agility. Try drinking this potion.");
  await until(f, "You hand over the agility potion to Tamayu.");
  assert.equal(count(f, I.AGILITY_POTION_4_), 0);
  await until(f, "Thank you Bwana. Now I must prepare for my next hunt.");
  await h.continueLine(f);
  const continued = f.tick;
  assert.equal(await until(f, "I feel agile enough to finally match the Shaikahan!") - continued, 4, "4 ticks (7168-7172)");
  await converse(f, async () => {}, []);
  await use(f, tam, I.IRON_SPEAR_KP_);
  await until(f, "You hand the spear to Tamayu.");
  assert.equal(count(f, I.IRON_SPEAR_KP_), 0);
  await converse(f, async () => {}, []);
  await h.talk(f, tam);
  await h.choose(f, "Take me on your next hunt for the Shaikahan.");
  await until(f, "Very well, but you must not interfere.");
  await h.continueLine(f);
  const left = f.tick;
  h.ticks(f, 14);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [2537, 4568], "watching the win (7237)");
  for (let i = 0; i < 20 && f.player.getAttribute(STATE.TAMAYU) < 4; i++) h.tick(f);
  assert.equal(f.player.getAttribute(STATE.TAMAYU), 4);
  assert.equal(f.tick - left, 30, "back 30 ticks after the continue (7223-7253)");
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [BY_TAMAYU[0], BY_TAMAYU[1]]);
  const from = await converse(f, () => h.talk(f, tam), []);
  assert.equal(said(f, from)[0], "I did it! I, Tamayu, first son of Timfraku, did slay the Shaikahan!");
});

test("Tamayu: the monkey corpse's box, the skin and bones 4 ticks after it (local 1001562 ticks 7316-7324)", async (t) => {
  const f = actor(t, { at: BY_TAMAYU, stage: 3, items: [[I.MONKEY_CORPSE, 1]], attributes: { [STATE.TAMAYU]: 4 } });
  const tam = h.spawn(f, h.core.NpcIdentifiers.TAMAYU, TAMAYU);
  await use(f, tam, I.MONKEY_CORPSE);
  await until(f, "You hand over the monkey corpse to Tamayu.");
  assert.equal(count(f, I.MONKEY_CORPSE), 0);
  await h.continueLine(f);
  const continued = f.tick;
  assert.equal(await until(f, "Tamayu hands you some monkey skin and bones.") - continued, 4);
  assert.equal(count(f, I.MONKEY_SKIN), 1);
  assert.equal(count(f, I.MONKEY_BONES), 1);
});

// ------------------------------------------------------------------ Crafting

test("a tinderbox on jogre bones: the bones on the ground, the fire 4 ticks later with 90 XP, burnt bones 35 ticks on (local 1001562 ticks 6820-6868)", async (t) => {
  const f = actor(t, { at: BONES_TILE, items: [[I.TINDERBOX, 1], [I.JOGRE_BONES, 1]] });
  const firemaking = xp(f, S.FIREMAKING);
  await combine(f, I.TINDERBOX, I.JOGRE_BONES);
  const lit = f.tick - 1;
  assert.equal(count(f, I.JOGRE_BONES), 0);
  assert.ok(messages(f).includes("You attempt to light the Jogre bones."));
  const tile = new h.core.Location(...BONES_TILE);
  const onTile = (id) => h.core.ItemOnGroundManager.getGroundItem(f.player.getUsername(), id, tile, f.player.getPrivateArea());
  assert.ok(onTile(I.JOGRE_BONES), "on the ground at once");
  for (let i = 0; i < 6 && !messages(f).includes("The fire catches and the bones begin to burn."); i++) h.tick(f);
  assert.equal(f.tick - lit, 4);
  assert.equal(xp(f, S.FIREMAKING) - firemaking, 90);
  assert.notDeepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [BONES_TILE[0], BONES_TILE[1]], "stepped aside");
  assert.ok(h.core.ObjectManager.objectsAt(tile).some((object) => object.getId() === 3862), "Burning bones");
  h.ticks(f, 35);
  assert.ok(!h.core.ObjectManager.objectsAt(tile).some((object) => object.getId() === 3862));
  assert.ok(onTile(I.BURNT_JOGRE_BONES), "burnt bones where the fire was");
});

test("raw Karambwanji loads each empty vessel 2 ticks apart, with no message (local 1001562 ticks 6004-6007)", async (t) => {
  const f = actor(t, { at: BONES_TILE, items: [[I.RAW_KARAMBWANJI, 5], [I.KARAMBWAN_VESSEL, 1], [I.KARAMBWAN_VESSEL, 1]] });
  await combine(f, I.RAW_KARAMBWANJI, I.KARAMBWAN_VESSEL);
  assert.equal(count(f, I.KARAMBWAN_VESSEL_3), 1, "the tick after the click (6005)");
  h.tick(f);
  assert.equal(count(f, I.KARAMBWAN_VESSEL_3), 1);
  h.tick(f);
  assert.equal(count(f, I.KARAMBWAN_VESSEL_3), 2);
  assert.equal(count(f, I.RAW_KARAMBWANJI), 3);
  assert.deepEqual(messages(f).filter((m) => !m.startsWith("You have unlocked a new music track")), []);
});

test("the pastes: poisonous Karambwan paste poisons a spear, raw paste doesn't; seaweed in the skin (ticks 7004, 7331; Wiki)", async (t) => {
  const f = actor(t, { at: BONES_TILE, items: [[I.KARAMBWAN_PASTE_2, 1], [I.KARAMBWAN_PASTE, 1], [I.IRON_SPEAR, 2], [I.SEAWEED, 1], [I.MONKEY_SKIN, 1]] });
  await combine(f, I.KARAMBWAN_PASTE_2, I.IRON_SPEAR);
  assert.equal(count(f, I.IRON_SPEAR_KP_), 1);
  assert.ok(messages(f).includes("You smear the poisonous Karambwan paste over the spear."));
  await combine(f, I.KARAMBWAN_PASTE, I.IRON_SPEAR);
  assert.equal(count(f, I.IRON_SPEAR_KP_), 1, "raw paste can't poison it");
  await combine(f, I.SEAWEED, I.MONKEY_SKIN);
  assert.equal(count(f, I.SEAWEED_SANDWICH), 1);
  assert.ok(messages(f).includes("You sandwich the seaweed in the monkey skin."));
});

const FIRE = 26185; // the capture's fire (local 1001562 tick 6980)
function onFire(f, itemId) {
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  return h.PM.emitItemOnObject({
    player: f.player, objectId: FIRE, itemId, slot, location: new h.core.Location(2790, 3048, 0), handled: false,
    object: { getDefinition: () => h.core.ObjectDefinition.forId(FIRE), getId: () => FIRE },
  });
}

test("on a fire: jogre bones only heat (Wiki); raw-paste burnt bones marinate for 100 Cooking XP (tick 6980); cooked-paste bones explode (Wiki)", async (t) => {
  const f = actor(t, { at: BONES_TILE, items: [[I.JOGRE_BONES, 1], [I.PASTY_JOGRE_BONES, 1], [I.PASTY_JOGRE_BONES_2, 1]] });
  onFire(f, I.JOGRE_BONES);
  assert.equal(count(f, I.JOGRE_BONES), 1);
  assert.ok(messages(f).includes("You heat the bones over the fire, but they don't look any different."));
  const cooking = xp(f, S.COOKING);
  onFire(f, I.PASTY_JOGRE_BONES);
  assert.equal(count(f, I.MARINATED_J_BONES), 1);
  assert.equal(xp(f, S.COOKING) - cooking, 100);
  assert.ok(f.messages.some((m) => m.text === "You marinate the burnt bones perfectly."));
  assert.ok(f.animations.some((a) => a.id === 897), "human_firecooking");
  const hitpoints = f.player.getHitpoints();
  onFire(f, I.PASTY_JOGRE_BONES_2);
  f.player.getCombat().getHitQueue().process(h.core.World.processCycle + 1);
  assert.equal(count(f, I.PASTY_JOGRE_BONES_2), 0);
  assert.equal(count(f, I.ASHES), 1);
  assert.ok(messages(f).includes("The cooked karambwanji paste catches fire and explodes."));
  assert.equal(hitpoints - f.player.getHitpoints(), 2);
});

// ------------------------------------------------------------------ After the quest

test("after the quest: each brother's XP once, Tamayu's spear once (75 ticks 5098-5137)", async (t) => {
  const f = actor(t, { at: BY_TAMAYU, stage: 6, attributes: { [STATE.TAMAYU]: 4, [STATE.TINSAY]: 7, [STATE.TIADECHE]: 6 } });
  const tam = h.spawn(f, h.core.NpcIdentifiers.TAMAYU, TAMAYU);
  const attack = xp(f, S.ATTACK);
  await h.talk(f, tam);
  await until(f, "Tamayu trains you in fighting technique.");
  assert.equal(group(f), MESBOX);
  await until(f, "Tamayu hands you some kind of spear.");
  assert.equal(count(f, I.RUNE_SPEAR_KP_), 1);
  assert.equal(xp(f, S.ATTACK) - attack, 2500);
  await converse(f, async () => {}, []);
  const again = await converse(f, () => h.talk(f, tam), ["No."]);
  assert.equal(said(f, again)[0], "Hello, Tamayu, first son of Timfraku.");
  assert.equal(count(f, I.RUNE_SPEAR_KP_), 1, "no second spear");
});
