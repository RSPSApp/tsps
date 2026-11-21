// Run after `yarn build`: node --test tests/watchtower-capture.test.cjs
//
// Watchtower against a whole run of the quest on live: the user's RSProx capture Watchtower.bin
// (revision 242.1; docs/quests/watchtower/README.md). Real Player, PlayerSession and ClientConnection,
// the real plugins, cache and map: talks and clicks are packets and each tick runs as World.process
// does. Ticks in the test names are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "watchtower";
const S = { STARTED: 1, NAILS: 2, RELIC: 3, GUTANOTH: 4, RIDDLE: 5, MAP: 6, SKAVID: 7, NIGHTSHADE: 8, RECIPE: 9, MAGIC: 10, ALL: 11, COMPLETE: 13, READ: 14 };
const V = {
  GUARD: 3117, EAST: 3118, NORTH_WEST: 3119, BATTLEMENT: 3120, PUZZLE: 3121, ROCK: 3124, NIGHTSHADE: 3125, SCENE: 3137,
  TOOTH: 3138, PILLAR_CYAN: 3127, PILLAR_YELLOW: 3128, PILLAR_MAGENTA: 3129, PILLAR_GREY: 3130, SHAMANS: [3131, 3132, 3133, 3134, 3135, 3136],
};
const N = {
  WIZARD: 4397, TOWER_GUARD: 4405, OG: 4364, GREW: 4365, TOBAN: 4366, EAST_GUARD: 4369, NW_GUARD: 4370, BATTLEMENT_GUARD: 4371,
  CITY_GUARD: 4373, SCARED: 4374, MAD: 4375, SKAVID_IG: 4376, SKAVID_AR: 4377, SKAVID_CUR: 4378, ENCLAVE_GUARD: 4381,
};
const BITS = "quest.watchtower.bits";
const DONE = [];

let I;
let Sk;
before(async () => {
  h.key = KEY;
  await h.setup([[2549, 3112], [2930, 4713], [2507, 3114], [2512, 3085], [2576, 3029], [2520, 3040], [2550, 3030],
    [2505, 3062], [2500, 9430], [2590, 9440], [2527, 3011]]);
  I = h.core.ItemIdentifiers;
  Sk = h.core.Skill;
});
after(() => h.teardown());

const stage = (f) => h.quest().getStage(f.player);
const varbit = (f, id) => (f.player.getAttribute("watchtower:varbits") ?? {})[id] ?? 0;
const sentVarbit = (f, id) => f.calls.filter((c) => c.name === "sendVarbit" && c.args[0] === id).map((c) => c.args[1]);
const count = (f, id) => f.player.getInventory().getAmount(id);
const at = (f) => { const l = f.player.getLocation(); return [l.getX(), l.getY(), l.getZ()]; };
/** Game messages (not the chatbox lines' own chat copies, "Speaker|text"). */
const messages = (f) => f.messages.filter((m) => !String(m.text).includes("|"))
  .map((m) => String(m.text)).filter((text) => !text.startsWith("You have unlocked a new music track"));
const bits = (f) => Number(f.player.getAttribute(BITS)) || 0;
const setBit = (f, bit) => f.player.setAttribute(BITS, bits(f) | (1 << bit));

function actor(t, { at: tile, stage: value = 0, items = [], attributes = {}, levels = 60 } = {}) {
  const f = h.actor(t, { at: tile, stage: value, done: DONE, attributes });
  for (const skill of ["MAGIC", "HERBLORE", "THIEVING", "MINING", "AGILITY"]) {
    f.player.getSkillManager().setMaxLevels(Sk[skill], levels);
    f.player.getSkillManager().setCurrentLevel(Sk[skill], levels, false);
  }
  for (const [id, amount] of items) f.player.getInventory().add(new h.core.Item(id, amount ?? 1), false);
  f.calls.length = 0;
  f.messages.length = 0;
  return f;
}

/** Plays out the conversation, answering menus with `picks`. */
async function play(f, start, picks = []) {
  const from = f.said.length;
  const queue = [...picks];
  await start?.();
  for (let idle = 0, i = 0; i < 600 && idle < 12; i++) {
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

async function useOnObject(f, objectId, [x, y], itemId) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  await f.connection.dispatch([{ type: "item_on_object", itemId, slot, widgetId: 149 << 16, objectId, x, y }]);
  h.ticks(f, 4);
}

async function click(f, id, [x, y], clickType = 1) {
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType }]);
  h.tick(f);
}

async function useItems(f, a, b) {
  const items = f.player.getInventory().getItems();
  const slotA = items.findIndex((item) => item?.getId() === a);
  const slotB = items.findIndex((item) => item?.getId() === b);
  await f.connection.dispatch([{ type: "inventory_use_on", slot: slotA, itemId: a, target: { kind: "inventory", slot: slotB, id: b } }]);
  f.connection.processTurnPackets();
  h.tick(f);
}

const talk = (f, npc, picks) => play(f, () => h.talk(f, npc), picks);

test("the start: 'Start the Watchtower quest?' Yes. sets stage 1 as the wizard sends the player searching (t182-216)", async (t) => {
  const f = actor(t, { at: [2548, 3113, 2] });
  const wizard = h.spawn(f, N.WIZARD, [2549, 3116, 2]);
  const said = await talk(f, wizard, ["What's the matter?", "So how come the spell doesn't work?", "Yes."]);
  assert.ok(said.includes("MENU[Start the Watchtower quest?]: Yes.|No."), said.join("\n"));
  assert.ok(said.includes("PLAYER: Can I be of help?"));
  assert.equal(stage(f), S.STARTED);
  const at215 = said.findIndex((line) => line.startsWith("Watchtower Wizard: Try searching the surrounding area."));
  assert.ok(at215 > said.indexOf("PLAYER: I would be happy to."), "the stage moves after the player agrees");
  assert.ok(messages(f).some((text) => text.startsWith("You've started a new quest")), JSON.stringify(messages(f)));
});

test("'Yes.' starts the quest without the skills (Wiki: not required to start)", async (t) => {
  const f = actor(t, { at: [2548, 3113, 2], levels: 10 });
  const wizard = h.spawn(f, N.WIZARD, [2549, 3116, 2]);
  const said = await talk(f, wizard, ["What's the matter?", "So how come the spell doesn't work?", "Yes."]);
  assert.ok(said.includes("PLAYER: Can I be of help?"), said.join("\n"));
  assert.equal(stage(f), S.STARTED);
});

test("'No.' leaves the quest unstarted (t182-185)", async (t) => {
  const f = actor(t, { at: [2548, 3113, 2] });
  const wizard = h.spawn(f, N.WIZARD, [2549, 3116, 2]);
  const said = await talk(f, wizard, ["What's the matter?", "So how come the spell doesn't work?", "No."]);
  assert.ok(said.includes("PLAYER: I'm not interested."));
  assert.equal(stage(f), 0);
});

test("the tower ladder: refused before the quest, the guard waves the player up once after it (t255-259, t2012-2018)", async (t) => {
  const before = actor(t, { at: [2545, 3111, 0] });
  const said = await play(before, () => click(before, 2833, [2544, 3111]));
  assert.ok(said.includes("Tower guard: You can't go up there. That's private, that is."), said.join("\n"));
  assert.equal(at(before)[2], 0);

  const f = actor(t, { at: [2545, 3111, 0], stage: S.STARTED });
  const first = await play(f, () => click(f, 2833, [2544, 3111]));
  assert.ok(first.includes("Tower guard: It is the wizards' helping hand - let 'em up."), first.join("\n"));
  assert.equal(varbit(f, V.GUARD), 1);
  h.ticks(f, 4);
  assert.deepEqual(at(f), [2545, 3111, 1]);
  f.player.moveTo(new h.core.Location(2545, 3111, 0));
  h.ticks(f, 2);
  const again = await play(f, () => click(f, 2833, [2544, 3111]));
  assert.ok(!again.some((line) => line.includes("helping hand")), again.join("\n"));
  h.ticks(f, 4);
  assert.equal(at(f)[2], 1);
});

test("a bush: the search animation, the Wiki's line and the item at once (t309, t393, t285)", async (t) => {
  const f = actor(t, { at: [2544, 3133, 0], stage: S.STARTED });
  const said = await play(f, () => click(f, 2799, [2544, 3134]));
  assert.ok(f.animations.some((a) => a.id === 5216));
  assert.equal(count(f, I.FINGERNAILS), 1);
  assert.ok(said.includes("PLAYER: What's this? Disgusting! Some fingernails. They may be a clue though... I'd better take them."), said.join("\n"));
  const empty = await play(f, () => click(f, 2798, [2546, 3135]));
  assert.ok(empty.includes("PLAYER: Hmmm, nothing here."), empty.join("\n"));
});

test("the trellis: the two messages and the climb, the first floor two ticks later (t325-332)", async (t) => {
  const f = actor(t, { at: [2548, 3120, 0], stage: S.STARTED });
  await click(f, 20056, [2548, 3119]);
  for (let i = 0; i < 6 && at(f)[2] === 0; i++) h.tick(f);
  assert.deepEqual(messages(f).slice(0, 2), ["You climb up the wall...", "...and squeeze in through the window."]);
  assert.ok(f.animations.some((a) => a.id === 828));
  assert.deepEqual(at(f), [2548, 3117, 1]);
});

test("the decoys: 'I have this robe...' and the wizard's answer, also when used on him (t634-666)", async (t) => {
  const f = actor(t, { at: [2548, 3116, 2], stage: S.STARTED, items: [[I.OLD_ROBE], [I.TATTERED_EYE_PATCH]] });
  const wizard = h.spawn(f, N.WIZARD, [2549, 3116, 2]);
  const said = await talk(f, wizard);
  assert.ok(said.includes("PLAYER: I have this robe..."), said.join("\n"));
  assert.ok(said.includes("Watchtower Wizard: No, sorry, this is not evidence. You need to keep searching, I'm afraid."));
  const used = await play(f, () => useOnNpc(f, wizard, I.TATTERED_EYE_PATCH));
  assert.deepEqual(used.slice(0, 2), ["Watchtower Wizard: Let me see...", "Watchtower Wizard: No, sorry, this is not evidence. You need to keep searching, I'm afraid."]);
});

test("the fingernails: stage 2 and the nails go only with 'So what do I do?' (t736-791)", async (t) => {
  const f = actor(t, { at: [2548, 3116, 2], stage: S.STARTED, items: [[I.FINGERNAILS]] });
  const wizard = h.spawn(f, N.WIZARD, [2549, 3116, 2]);
  await talk(f, wizard, ["Shall I search the caves?", "I won't bother then."]);
  assert.equal(stage(f), S.STARTED);
  assert.equal(count(f, I.FINGERNAILS), 1);
  const said = await talk(f, wizard, ["What do you suggest I do?", "So what do I do?"]);
  assert.ok(said.at(-1).startsWith("Watchtower Wizard: You could start by checking out the ogre settlements"), said.join("\n"));
  assert.equal(stage(f), S.NAILS);
  assert.equal(count(f, I.FINGERNAILS), 0);
});

test("Og: the key with his line; the gold for relic part 1 with his line and its box (t1161-1162, t1800-1803)", async (t) => {
  const f = actor(t, { at: [2506, 3113, 0], stage: S.NAILS });
  const og = h.spawn(f, N.OG, [2507, 3114, 0]);
  await talk(f, og, ["I seek entrance to the city of ogres."]);
  assert.equal(count(f, I.TOBANS_KEY), 1);
  assert.ok(!messages(f).some((text) => text.includes("key")), JSON.stringify(messages(f)));
  f.player.getInventory().add(new h.core.Item(I.TOBANS_GOLD, 1), false);
  const said = await talk(f, og, ["I have your gold."]);
  assert.ok(said.includes("ItemStatementDialogue: The ogre gives you part of a horrible statue."), said.join("\n"));
  assert.equal(count(f, I.RELIC_PART_1), 1);
  assert.equal(count(f, I.TOBANS_GOLD), 0);
});

test("the relic: each part with the wizard's line, the assembly and the relic three ticks on (t2026-2040)", async (t) => {
  const f = actor(t, { at: [2548, 3116, 2], stage: S.NAILS, items: [[I.RELIC_PART_1], [I.RELIC_PART_2], [I.RELIC_PART_3]] });
  const wizard = h.spawn(f, N.WIZARD, [2549, 3116, 2]);
  const animations = [];
  const perform = wizard.performAnimation.bind(wizard);
  wizard.performAnimation = (a) => { animations.push(a.getId()); return perform(a); };
  const said = await talk(f, wizard);
  assert.deepEqual(said.slice(0, 8), [
    "PLAYER: An ogre called Og gave me this...",
    "Watchtower Wizard: Ah, it's part of an old ogre statue. I'll take that off you - it might come in handy if I can fix it up.",
    "PLAYER: An ogre called Grew gave me this...",
    "Watchtower Wizard: Ah, it's more of that old ogre statue. I'll take this bit too.",
    "PLAYER: An ogre called Toban gave me this...",
    "Watchtower Wizard: Ah, it's more of that old ogre statue. I'll take this bit too.",
    "Watchtower Wizard: It looks like you've brought me all the pieces of the relic. It is as I thought - a statue symbolising an ogre warrior of old.",
    "Watchtower Wizard: Well, if you ever want to make friends with an ogre, this is the item to have! Now I'll try to assemble it...",
  ]);
  assert.ok(said.includes("ItemStatementDialogue: The wizard gives you a complete statue."), said.join("\n"));
  assert.ok(animations.includes(5352));
  assert.equal(stage(f), S.RELIC);
  assert.equal(count(f, I.OGRE_RELIC), 1);
  for (const part of [I.RELIC_PART_1, I.RELIC_PART_2, I.RELIC_PART_3]) assert.equal(count(f, part), 0);
});

test("the north-west guard: stopped first even with the relic, then 'proof of friendship', stage 4 (t2308-2314)", async (t) => {
  const f = actor(t, { at: [2510, 3060, 0], stage: S.RELIC, items: [[I.OGRE_RELIC]] });
  f.player.getPacketSender().sendVarbit(V.NORTH_WEST, 0);
  f.player.setAttribute("watchtower:varbits", { [V.TOOTH]: 1, [V.GUARD]: 1 });
  const guard = h.spawn(f, N.NW_GUARD, [2509, 3061, 0]);
  const said = await talk(f, guard);
  assert.deepEqual(said.slice(0, 6).map((line) => line.replace(/^[^:]+: /, "")), [
    "Stop, creature! Only ogres and their friends allowed in this city. Show me a sign of companionship, like a lost relic or somefing, and you may pass.",
    "Until then, back to whence you came!",
    "I've got a proof of friendship right here!",
    "Well, what proof of friendship did you bring?",
    "I have a relic!",
    "It's got the statue of Dalgroth. Welcome to Gu'Tanoth, friend of the ogres.",
  ], said.join("\n"));
  assert.equal(stage(f), S.GUTANOTH);
  assert.equal(count(f, I.OGRE_RELIC), 0);
  assert.equal(varbit(f, V.NORTH_WEST), 1);
});

test("the east guards: the gold asked for once, taken next time; the gate opens for the player (t2214-2230, t3271)", async (t) => {
  const f = actor(t, { at: [2551, 3033, 0], stage: S.RELIC, items: [[I.GOLD_BAR]] });
  const guard = h.spawn(f, N.EAST_GUARD, [2551, 3032, 0]);
  const first = await talk(f, guard);
  assert.deepEqual(first.map((line) => line.replace(/^[^:]+: /, "")), [
    "Halt! You cannot pass here.", "I am a friend to ogres.",
    "You will be my friend only with gold. Bring me a bar of pure gold and I will let you pass.",
  ], first.join("\n"));
  assert.equal(varbit(f, V.EAST), 1);
  const second = await talk(f, guard);
  assert.ok(second.includes("PLAYER: Here it is!") && second.some((line) => line.endsWith("It's brought it! On your way.")), second.join("\n"));
  assert.equal(count(f, I.GOLD_BAR), 0);
  h.ticks(f, 8);
  const third = await talk(f, guard);
  assert.ok(third.some((line) => line.endsWith("I know you, creature; you may pass.")), third.join("\n"));
});

test("the battlement guards: the gift asked for (3120), the rock cake taken with the next line (t2444-2458)", async (t) => {
  const f = actor(t, { at: [2500, 3013, 0], stage: S.GUTANOTH, items: [[I.ROCK_CAKE]] });
  const guard = h.spawn(f, N.BATTLEMENT_GUARD, [2502, 3014, 0]);
  await talk(f, guard, ["But I am a friend to ogres..."]);
  assert.equal(varbit(f, V.BATTLEMENT), 1);
  const said = await talk(f, guard);
  assert.ok(said.includes("ItemStatementDialogue: You offer the guard a rock cake."), said.join("\n"));
  assert.equal(count(f, I.ROCK_CAKE), 0);
  assert.ok(bits(f) & (1 << 11), "the guards have their cake");
});

test("the city guard: stage 5 with the riddle, the death rune for the map on Talk-to (t2636-2665)", async (t) => {
  const f = actor(t, { at: [2541, 3033, 0], stage: S.GUTANOTH, items: [[I.DEATH_RUNE, 20]] });
  const guard = h.spawn(f, N.CITY_GUARD, [2541, 3034, 0]);
  await talk(f, guard, ["I seek passage into the skavid caves"]);
  assert.equal(stage(f), S.RIDDLE);
  assert.equal(varbit(f, V.PUZZLE), 1);
  const said = await talk(f, guard);
  assert.equal(said[0], "PLAYER: I worked it out!", said.join("\n"));
  assert.ok(said.includes("ItemStatementDialogue: The guard takes your death rune and gives you a map."));
  assert.equal(stage(f), S.MAP);
  assert.equal(count(f, I.SKAVID_MAP), 1);
  assert.equal(count(f, I.DEATH_RUNE), 19);
});

test("the skavids: no words yet, then the right word, a wrong one and 'already talked' (t2912-3096)", async (t) => {
  const f = actor(t, { at: [2499, 9451, 0], stage: S.MAP });
  const cur = h.spawn(f, N.SKAVID_CUR, [2500, 9450, 0]);
  const unknown = await talk(f, cur);
  assert.deepEqual(unknown, ["Skavid: Bidith tanath...", "PLAYER: ???"], unknown.join("\n"));
  assert.deepEqual(messages(f).slice(-2), ["The skavid is trying to communicate...", "You don't know any skavid words yet!"]);
  setBit(f, 12);
  f.messages.length = 0;
  const right = await talk(f, cur, ["Cur."]);
  assert.deepEqual(right, ["Skavid: Bidith tanath...", "MENU[Select an option]: Cur.|Ar.|Ig.|Nod.|Gor.", "PLAYER: Cur.", "Skavid: Cur, cur tanath!"], right.join("\n"));
  assert.deepEqual(messages(f), ["The skavid is trying to communicate...", "It seems the skavid understood you."]);
  assert.ok(bits(f) & (1 << 15));
  f.messages.length = 0;
  const again = await talk(f, cur);
  assert.deepEqual(again, ["Skavid: Cur tanath!"], again.join("\n"));
  assert.ok(messages(f).includes("You have already talked to this skavid."));

  const ar = h.spawn(f, N.SKAVID_AR, [2500, 9452, 0]);
  f.messages.length = 0;
  const wrong = await talk(f, ar, ["Ig.", "Ar."]);
  assert.ok(wrong.includes("Skavid: ???") && wrong.includes("Skavid: Ar, ar cur!"), wrong.join("\n"));
  assert.ok(messages(f).includes("It seems that was the wrong reply."));
  assert.ok(bits(f) & (1 << 13));
});

test("the mad skavid: the crystal and stage 7 with his line, then its box (t3310-3320)", async (t) => {
  const f = actor(t, { at: [2522, 9412, 0], stage: S.MAP });
  for (const bit of [12, 13, 14, 15, 16]) setBit(f, bit);
  const mad = h.spawn(f, N.MAD, [2523, 9411, 0]);
  const said = await talk(f, mad, ["Tanath."]);
  assert.ok(said.includes("ItemStatementDialogue: The skavid gives you a large crystal."), said.join("\n"));
  assert.equal(stage(f), S.SKAVID);
  assert.equal(count(f, I.CRYSTAL_2), 1);
});

test("nightshade on an enclave guard: stage 8, the warning screen, in, and the scene once (t3451, t3632-3670)", async (t) => {
  const f = actor(t, { at: [2507, 3041, 0], stage: S.SKAVID, items: [[I.CAVE_NIGHTSHADE]] });
  const guard = h.spawn(f, N.ENCLAVE_GUARD, [2507, 3040, 0]);
  await useOnNpc(f, guard, I.CAVE_NIGHTSHADE);
  assert.equal(stage(f), S.NIGHTSHADE);
  assert.equal(count(f, I.CAVE_NIGHTSHADE), 0);
  await h.continueLine(f);
  h.ticks(f, 2);
  assert.deepEqual(sentVarbit(f, 3862), [1], "the cws_warning_12 screen, counted");
  assert.equal(f.player.getPacketSender().getMainInterfaceId?.() ?? 573, 573);
  const yes = (573 << 16) | 17;
  h.PM.emitInterfaceActionClick({ player: f.player, buttonId: yes, action: 0, opId: 1, groupId: 573, childId: 17, handled: false });
  h.tick(f);
  assert.ok(messages(f).includes("You run past the guard while he's busy."), JSON.stringify(messages(f)));
  assert.equal(varbit(f, V.NIGHTSHADE), 1);
  for (let i = 0; i < 45 && varbit(f, V.SCENE) === 0; i++) {
    if (h.shown(f)) await h.continueLine(f); else h.tick(f);
  }
  assert.equal(varbit(f, V.SCENE), 1);
  h.ticks(f, 3);
  assert.deepEqual(at(f), [2588, 9410, 0]);
});

test("the potion: the recipe at stage 9, mixed right with 10 XP a step, the wrong order explodes (t5065, t5084-5087, t5272-5280)", async (t) => {
  const f = actor(t, { at: [2548, 3116, 2], stage: S.NIGHTSHADE });
  const wizard = h.spawn(f, N.WIZARD, [2549, 3116, 2]);
  await talk(f, wizard);
  assert.equal(stage(f), S.RECIPE);
  for (const id of [I.GUAM_POTION_UNF_, I.JANGERBERRIES, I.BAT_BONES, I.PESTLE_AND_MORTAR]) f.player.getInventory().add(new h.core.Item(id, 1), false);
  await useItems(f, I.PESTLE_AND_MORTAR, I.BAT_BONES);
  assert.equal(count(f, I.GROUND_BAT_BONES), 1);
  assert.ok(messages(f).includes("You grind the bones to a powder."));
  const xp = f.player.getSkillManager().getExperience(Sk.HERBLORE);
  await useItems(f, I.JANGERBERRIES, I.GUAM_POTION_UNF_);
  await useItems(f, I.GROUND_BAT_BONES, I.VIAL_4);
  assert.equal(count(f, I.POTION_3), 1);
  assert.equal(f.player.getSkillManager().getExperience(Sk.HERBLORE) - xp, 20);
  assert.ok(messages(f).includes("You produce a strong potion."));

  const g = actor(t, { at: [2548, 3116, 2], stage: S.RECIPE, items: [[I.GUAM_POTION_UNF_], [I.GROUND_BAT_BONES]] });
  await useItems(g, I.GROUND_BAT_BONES, I.GUAM_POTION_UNF_);
  assert.ok(messages(g).includes("You mixed the ingredients incorrectly and the mixture exploded."), JSON.stringify(messages(g)));
  assert.equal(count(g, I.VIAL), 1);
});

test("the infusion: the wizard mutters as the chat closes, the magic potion and stage 10 four ticks on (t5443-5450)", async (t) => {
  const f = actor(t, { at: [2548, 3116, 2], stage: S.RECIPE, items: [[I.POTION_3]] });
  const wizard = h.spawn(f, N.WIZARD, [2549, 3116, 2]);
  await h.talk(f, wizard);
  let mutter;
  for (let i = 0; i < 40 && stage(f) < S.MAGIC; i++) {
    if (!mutter && messages(f).includes("The wizard mutters strange words over the liquid...")) mutter = f.tick;
    if (h.shown(f)) await h.continueLine(f); else h.tick(f);
  }
  assert.ok(mutter, JSON.stringify(messages(f)));
  assert.equal(stage(f), S.MAGIC);
  assert.ok(f.tick - mutter >= 3, `the potion ${f.tick - mutter} ticks after the mutter`);
  assert.equal(count(f, I.MAGIC_OGRE_POTION), 1);
});

test("the shamans: the potion poured, the shaman gone eight ticks later; the sixth leaves the crystal (t5709-5852)", async (t) => {
  const f = actor(t, { at: [2596, 9433, 0], stage: S.MAGIC, items: [[I.MAGIC_OGRE_POTION]] });
  const vars = {};
  for (const id of V.SHAMANS.slice(0, 5)) vars[id] = 1;
  f.player.setAttribute("watchtower:varbits", vars);
  const shaman = h.spawn(f, 6213, [2597, 9433, 0]);
  await useOnNpc(f, shaman, I.MAGIC_OGRE_POTION);
  assert.ok(f.animations.some((a) => a.id === 5361));
  for (let i = 0; i < 12 && varbit(f, V.SHAMANS[5]) === 0; i++) h.tick(f);
  assert.equal(varbit(f, V.SHAMANS[5]), 1);
  assert.ok(messages(f).includes("There is a bright flash!") && messages(f).includes("You hear a scream...<br>The shaman dissolves before your eyes."));
  for (let i = 0; i < 5 && count(f, I.CRYSTAL_3) === 0; i++) h.tick(f);
  assert.equal(count(f, I.CRYSTAL_3), 1);
  assert.equal(count(f, I.MAGIC_OGRE_POTION), 0);
  assert.equal(count(f, I.VIAL), 1);
  assert.ok(shaman.isRegistered(), "the shaman is gone for this player only (its multinpc)");
});

test("the pillars and the lever: wrong crystal refused, stage 13, the completed tower and the rewards (t6004-6062)", async (t) => {
  const f = actor(t, { at: [2546, 3114, 2], stage: S.MAGIC, items: [[I.CRYSTAL], [I.CRYSTAL_2], [I.CRYSTAL_3], [I.CRYSTAL_4]] });
  for (const id of V.SHAMANS) f.player.setAttribute("watchtower:varbits", { ...(f.player.getAttribute("watchtower:varbits") ?? {}), [id]: 1 });
  const wizard = h.spawn(f, N.WIZARD, [2549, 3116, 2]);
  await talk(f, wizard);
  assert.equal(stage(f), S.ALL);
  await useOnObject(f, 20033, [2548, 3116], I.CRYSTAL_3);
  assert.ok(messages(f).includes("That is not the right crystal for this pillar; try another."), JSON.stringify(messages(f)));
  for (const [loc, x, y, crystal, id] of [[20029, 2545, 3113, I.CRYSTAL, V.PILLAR_YELLOW], [20033, 2548, 3116, I.CRYSTAL_2, V.PILLAR_MAGENTA],
    [20025, 2545, 3116, I.CRYSTAL_3, V.PILLAR_CYAN], [20037, 2548, 3113, I.CRYSTAL_4, V.PILLAR_GREY]]) {
    await useOnObject(f, loc, [x, y], crystal);
    for (let i = 0; i < 6 && varbit(f, id) === 0; i++) h.tick(f);
    assert.equal(varbit(f, id), 1, `pillar ${loc}`);
  }
  const coins = count(f, I.COINS);
  await click(f, 2794, [2543, 3115]);
  for (let i = 0; i < 10 && stage(f) < S.COMPLETE; i++) h.tick(f);
  assert.equal(stage(f), S.COMPLETE);
  assert.ok(messages(f).includes("The magic force field activates."));
  assert.equal(varbit(f, V.PILLAR_CYAN), 2);
  assert.deepEqual(at(f), [2928, 4715, 2]);
  const said = await play(f, () => h.ticks(f, 5));
  assert.ok(said.some((line) => line.startsWith("Watchtower Wizard: Marvellous! It works!")), said.join("\n"));
  assert.equal(count(f, I.COINS) - coins, 5000);
  assert.equal(count(f, I.SPELL_SCROLL), 1);
  h.ticks(f, 4);
  assert.ok(messages(f).some((text) => text.startsWith("Congratulations, you've completed a quest")), JSON.stringify(messages(f)));
});

test("the scroll: stage 14, the two boxes and the dust (t6093-6096)", async (t) => {
  const f = actor(t, { at: [2933, 4713, 2], stage: S.COMPLETE, items: [[I.SPELL_SCROLL]] });
  const slot = f.player.getInventory().getItems().findIndex((item) => item?.getId() === I.SPELL_SCROLL);
  await f.connection.dispatch([{ type: "inventory_action", slot, itemId: I.SPELL_SCROLL, widgetId: 3214, option: "Read" }]);
  h.ticks(f, 4);
  assert.equal(stage(f), S.READ);
  assert.ok(f.animations.some((a) => a.id === 5354));
  assert.equal(count(f, I.SPELL_SCROLL), 0);
  assert.deepEqual(messages(f), ["You memorise what is written on the scroll.",
    "You can now cast the Watchtower teleport spell... ...Provided you have the required runes and magic level.", "The scroll crumbles to dust."]);
});

test("an old save: completion 12 becomes 13 with live's varbits, once (login migration)", async (t) => {
  const f = actor(t, { at: [2549, 3112, 0] });
  f.player.setAttribute("quest.watchtower.stage", 12);
  f.player.setAttribute("watchtower:save-version", 0);
  f.player.setAttribute(BITS, (1 << 17) | (6 << 18));
  h.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.equal(stage(f), S.COMPLETE);
  assert.equal(varbit(f, V.TOOTH), 1);
  assert.equal(varbit(f, V.PILLAR_YELLOW), 2);
  for (const id of V.SHAMANS) assert.equal(varbit(f, id), 1);
});

test("the completed tower: its top floor is the copy, by ladder and by the spell (t6113, t6337)", async (t) => {
  const f = actor(t, { at: [2549, 3112, 1], stage: S.READ });
  await click(f, 2796, [2549, 3111]);
  h.ticks(f, 4);
  assert.deepEqual(at(f), [2933, 4712, 2]);
});

test("the enclave scene: a logout inside its copy is saved at the enclave entrance and the scene plays again (t3638-3670)", async (t) => {
  const f = actor(t, { at: [2507, 3041, 0], stage: S.NIGHTSHADE, items: [[I.CAVE_NIGHTSHADE]] });
  const guard = h.spawn(f, N.ENCLAVE_GUARD, [2507, 3040, 0]);
  await useOnNpc(f, guard, I.CAVE_NIGHTSHADE);
  await h.continueLine(f);
  h.ticks(f, 2);
  h.PM.emitInterfaceActionClick({ player: f.player, buttonId: (573 << 16) | 17, action: 0, opId: 1, groupId: 573, childId: 17, handled: false });
  for (let i = 0; i < 10 && !(f.player.getArea() instanceof h.core.TemplatedInstanceArea); i++) h.tick(f);
  assert.ok(f.player.getArea() instanceof h.core.TemplatedInstanceArea, "the scene plays in a copy of the enclave");
  h.PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.deepEqual(at(f), [2588, 9410, 0]);
  assert.equal(varbit(f, V.SCENE), 0, "an unfinished scene is not marked seen");
});

test("the lever: a logout in the ticks after it still has the rewards with the completion", async (t) => {
  const f = actor(t, { at: [2543, 3116, 2], stage: S.ALL });
  const vars = {};
  for (const id of [V.PILLAR_CYAN, V.PILLAR_YELLOW, V.PILLAR_MAGENTA, V.PILLAR_GREY]) vars[id] = 1;
  f.player.setAttribute("watchtower:varbits", vars);
  const xp = f.player.getSkillManager().getExperience(Sk.MAGIC);
  await click(f, 2794, [2543, 3115]);
  for (let i = 0; i < 6 && stage(f) < S.COMPLETE; i++) h.tick(f);
  assert.equal(stage(f), S.COMPLETE);
  h.PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  h.ticks(f, 8);
  assert.equal(f.player.getSkillManager().getExperience(Sk.MAGIC) - xp, 15250);
  assert.equal(count(f, I.COINS), 5000);
  assert.equal(count(f, I.SPELL_SCROLL), 1);
});

test("the scared skavid's ogre: in and out in a puff of smoke, and gone on a logout mid-scene (t2995-3001)", async (t) => {
  const f = actor(t, { at: [2502, 9431, 0], stage: S.MAP });
  const skavid = h.spawn(f, N.SCARED, [2502, 9430, 0]);
  await play(f, () => h.talk(f, skavid), ["Okay, okay, I'm not going to hurt you."]);
  assert.ok(f.calls.some((c) => c.name === "sendGraphic"), "the smoke");
  const g = actor(t, { at: [2502, 9431, 0], stage: S.MAP });
  const skavid2 = h.spawn(g, N.SCARED, [2502, 9430, 0]);
  await h.talk(g, skavid2);
  for (let i = 0; i < 30; i++) {
    const line = h.shown(g);
    if (line?.who === "menu") { await h.choose(g, "Okay, okay, I'm not going to hurt you."); continue; }
    if (line?.text?.startsWith("You will have to learn skavid")) { await h.continueLine(g); break; }
    if (line) await h.continueLine(g); else h.tick(g);
  }
  h.ticks(g, 1);
  const before = [...h.core.World.getNpcs()].filter((npc) => npc?.getId?.() === 4363 && npc.isRegistered?.()).length;
  assert.ok(before >= 1, "the ogre is out");
  h.PM.emitPlayerLogout({ player: g.player, username: g.player.getUsername() });
  h.ticks(g, 2);
  assert.equal([...h.core.World.getNpcs()].filter((npc) => npc?.getId?.() === 4363 && npc.isRegistered?.()).length, before - 1);
});

test("the tower ladder: walking off during the guard's line does not climb", async (t) => {
  const f = actor(t, { at: [2545, 3111, 0], stage: S.STARTED });
  await click(f, 2833, [2544, 3111]);
  for (let i = 0; i < 5 && !h.shown(f); i++) h.tick(f);
  assert.ok(h.shown(f)?.text?.includes("helping hand"));
  await f.connection.dispatch([{ type: "move", worldX: 2548, worldY: 3108, modifierFlags: 0, run: false }]);
  h.ticks(f, 8);
  assert.equal(at(f)[2], 0, JSON.stringify(at(f)));
});
