// Run after `yarn build`: node --test tests/fairytale-i-capture.test.cjs
//
// Fairytale I - Growing Pains against the user's whole-quest rsprox captures (FairyTale1, revision
// 242.1; 1001455, revision 241.1; docs/quests/fairytale-i-growing-pains/README.md). Real Player,
// PlayerSession and ClientConnection, the real plugins, cache and map: talks and clicks are packets,
// each tick runs as World.process does. Tick numbers are FairyTale1's unless a recording is named.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./fairytale-i-harness.cjs");

const MARTIN = [3077, 3256, 0];
const BY_MARTIN = [3078, 3256, 0];
const GODFATHER = [2446, 4427, 0];
const BY_GODFATHER = [2446, 4429, 0];
const NUFF = [2388, 4470, 0];
const BY_NUFF = [2388, 4472, 0];
const ZANDAR = [2905, 3334, 2];
const BY_ZANDAR = [2905, 3333, 2];
const MALIGNIUS = [2991, 3269, 0];
const BY_MALIGNIUS = [2991, 3268, 0];
const SPIRIT = [3441, 9738, 0];
const BY_SPIRIT = [3442, 9738, 0];
const GROVE_WALL = [2399, 4379];
const OUTSIDE_GROVE = [2400, 4379, 0];
const GARDENERS = [
  ["FRIZZY_SKERNIP", [3058, 3258, 0]],
  ["ELSTAN", [3048, 3303, 0]],
  ["HESKEL", [3000, 3374, 0]],
  ["TREZNOR_2", [3226, 3456, 0]],
  ["DREVEN", [3182, 3356, 0]],
  ["VASQUEN", [3230, 3311, 0]],
];
const G = "quest.fairytale-i-growing-pains:gardeners";
const ITEMS = "quest.fairytale-i-growing-pains:nature-items";

let I;
let N;
before(async () => {
  await h.setup([[3078, 3258], [3058, 3258], [3048, 3303], [3000, 3374], [3226, 3456], [3182, 3356], [3230, 3311],
    [2446, 4427], [2388, 4470], [2905, 3334], [2991, 3269], [3442, 9739], [2401, 4378], [2375, 4385], [3217, 3176]]);
  I = h.core.ItemIdentifiers;
  N = h.core.NpcIdentifiers;
});
after(() => h.teardown());

const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const messages = (f) => f.messages.map((m) => m.text);
const journal = (f) => h.quest().buildJournal(f.player, h.quest());
const sounds = (f, from = 0) => f.calls.filter((c) => c.tick >= from && c.name === "sendSoundEffect").map((c) => c.args[0]);
const at = (f) => [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()];

/** Continues until `text` shows, returning its tick. */
async function until(f, text, limit = 80) {
  for (let i = 0; i < limit; i++) {
    const line = h.shown(f);
    if (line?.text?.startsWith(text) || (line?.who === "menu" && line.text.includes(text))) return f.tick;
    if (line && line.who !== "menu") await h.continueLine(f);
    else h.tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

async function finish(f, limit = 60) {
  for (let i = 0; i < limit && h.shown(f); i++) {
    if (h.shown(f).who === "menu") return;
    await h.continueLine(f);
  }
}

test("Martin's offer: the 'have you noticed' menu, then the stage and start message as his answer shows (ticks 126-171)", async (t) => {
  const f = h.actor(t, { at: BY_MARTIN });
  const martin = h.spawn(f, N.MARTIN_THE_MASTER_GARDENER, MARTIN);
  await h.talk(f, martin);
  await h.choose(f, "Ask about the quest.");
  await until(f, "Anything I can help with?");
  await h.choose(f, "Anything I can help with?");
  await until(f, "Now that I think about it, you're right!");
  assert.equal(h.shown(f).text, "Now that I think about it, you're right!|No, can't say that I have.");
  await h.choose(f, "Now that I think about it, you're right!");
  assert.equal(h.shown(f).text, "Now that I think about it, you're right!");
  await until(f, "I know I am. Depressing isn't it?");
  await until(f, "Yes.|No.");
  assert.equal(h.shown(f).title, "Start the Fairytale I - Growing Pains quest?");
  await h.choose(f, "Yes.");
  await until(f, "Do you have any ideas where I should start?");
  assert.equal(h.stage(f), 0, "not on the choice");
  await h.continueLine(f);
  assert.equal(h.shown(f).text, "If I were you I would start by speaking to some of the other gardeners.");
  assert.equal(h.stage(f), 10);
  assert.ok(messages(f).some((m) => /^You've started a new quest: .*Fairytale I - Growing Pains/.test(m)), JSON.stringify(messages(f)));
  // Not 20 before the gardeners, so the Zanaris NPCs keep their places (still 0 at stage 10, 171-1065).
  assert.equal(varbit(f, 1807), 0);
  assert.equal(varbit(f, 1808), 0);
});

test("the gardeners: five answers in order, the same menu again for one asked before, 'I don't think' after five; Martin's 20 (262-281, 778-805, 852-867, 1065)", async (t) => {
  const f = h.actor(t, { stage: 10, at: [3058, 3259, 0] });
  const answers = [
    "Ah, Martin sent you, why didn't you say so?",
    "Insects! That's what you can tell him!",
    "How can you ask such a thing? It's obvious!",
    "Well obviously it's the seasons.",
    "Well I can tell by the look on your face",
    "I don't think the crops ARE failing, now leave me alone, I have work to do.",
  ];
  const journals = [
    "I've spoken to one gardener who told me the problem is the",
    "I've spoken to a couple of gardeners who gave me different",
    "I've spoken to three gardeners who gave me conflicting",
    "I've spoken to four gardeners who all have different ideas",
    "I've spoken to several gardeners who all have different ideas",
    "I've spoken to several gardeners who all have different ideas",
  ];
  assert.equal(journal(f)[2], "I will need to speak to other gardeners to get details.", "1001455 tick 637");
  for (const [index, [name, tile]] of GARDENERS.entries()) {
    f.player.moveTo(new h.core.Location(tile[0], tile[1] + 1, 0));
    h.ticks(f, 2);
    const gardener = h.spawn(f, N[name], tile);
    for (const again of [false, true]) {
      await h.talk(f, gardener);
      await h.choose(f, "Are you a member of the Group of Advanced Gardeners?");
      await until(f, "Martin has asked me to investigate why all the crops are failing.");
      await h.continueLine(f);
      assert.ok(h.shown(f).text.startsWith(again ? "I've already told you everything I suspect." : answers[index]),
        `${name} ${again ? "again" : "first"}: ${h.shown(f).text}`);
      await finish(f);
      h.ticks(f, 2);
    }
    assert.equal(journal(f)[2], journals[index], `the journal after ${index + 1} (1001455 ticks 819-1117; 811)`);
  }
  // Dreven, the fifth: the two lines the Wiki lacks (785-794).
  assert.ok(f.said.some((s) => s.text === "I have no idea what to do about any of it. I'm an adventurer, not a weather controller!"));
  assert.ok(f.said.some((s) => s.text.startsWith("Surely if all of those things have been mentioned as catalysts")));
  f.player.moveTo(new h.core.Location(...BY_MARTIN));
  h.ticks(f, 2);
  const martin = h.spawn(f, N.MARTIN_THE_MASTER_GARDENER, MARTIN);
  await h.talk(f, martin);
  await h.choose(f, "Ask about the quest.");
  assert.match(h.shown(f).text, /^Hello again, fairy\d+\. How are you getting on/);
  assert.equal(h.stage(f), 20, "with Martin's first line");
  await finish(f);
  // He says the same at 20 (1084-1114).
  await h.talk(f, martin);
  await h.choose(f, "Ask about the quest.");
  assert.match(h.shown(f).text, /^Hello again/);
  assert.equal(varbit(f, 1807), 1, "the Queen moves to Nuff's room from 20 (1255)");
  assert.equal(varbit(f, 1808), 1, "and the Godfather shows");
});

test("the Godfather: his Nuff line, 30 and 'no longer paying attention' after the player's '?', then Slim Louie (1343-1377)", async (t) => {
  const f = h.actor(t, { stage: 20, at: BY_GODFATHER });
  const godfather = h.spawn(f, N.FAIRY_GODFATHER, GODFATHER);
  await h.talk(f, godfather);
  await until(f, "Where's the Fairy Queen?");
  await h.choose(f, "Where's the Fairy Queen?");
  await until(f, "She is-a being cared for by-a Fairy Nuff, who lives-a just north of-a da bank.");
  await until(f, "A word-a of advice. You be-a careful not to cause da trouble for da folk while you are in Zanaris. Ciao.");
  await until(f, "?");
  assert.equal(h.stage(f), 20);
  const from = f.messages.length;
  await h.continueLine(f);
  assert.equal(h.stage(f), 30);
  assert.deepEqual(f.messages.slice(from).map((m) => m.text), ["The Godfather is no longer paying attention to you."]);
  assert.equal(h.shown(f), null, "the chat closes");
  h.ticks(f, 2);
  await h.talk(f, godfather);
  assert.equal(h.shown(f).who, "Slim Louie");
  assert.equal(h.shown(f).text, "Da Boss is a busy fairy! He don' have time to talk to yous humans. Vamoose!");
});

test("Fairy Nuff: the list and 40 after 'Here, I've written down...'; her own page's first meeting, then her short greeting (1450-1534, 1555-1619, 3485)", async (t) => {
  const f = h.actor(t, { stage: 30, at: BY_NUFF });
  const nuff = h.spawn(f, N.FAIRY_NUFF, NUFF);
  await h.talk(f, nuff);
  await until(f, "What can I help you with then?");
  await until(f, "Actually it's more a case of what can I help you with?");
  await until(f, "Here, I've written down a list of her symptoms.");
  assert.equal(f.player.getInventory().getAmount(I.SYMPTOMS_LIST), 0);
  assert.equal(h.stage(f), 30);
  await h.continueLine(f);
  assert.equal(f.player.getInventory().getAmount(I.SYMPTOMS_LIST), 1, "with the next line (1525)");
  assert.equal(h.stage(f), 40);
  await until(f, "I have put her in a state of tempus fugit");
  await until(f, "I believe he now resides in the Dark Wizards' tower near Falador");
  await finish(f);
  h.ticks(f, 2);
  // With the list she is her own page: the first meeting's menu.
  await h.talk(f, nuff);
  assert.equal(h.shown(f).text, "Hello, can I help you at all?");
  await h.continueLine(f);
  assert.equal(h.shown(f).text, "What do you do around here?|Yes, please. I need healing.|No thanks. Just looking around.");
  await h.choose(f, "Yes, please. I need healing.");
  await until(f, "Sure, how many hitpoints would you like me to heal?");
  await until(f, "11 Hitpoints.");
  await h.choose(f, "11 Hitpoints.");
  await until(f, "That will cost you 1 diamond.", 5);
  await until(f, "All right.|On second thoughts, no thanks.");
  await h.choose(f, "All right.");
  await until(f, "You don't have a diamond to pay me!", 5);
  await until(f, "Whoops, sorry.", 5);
  await finish(f);
  h.ticks(f, 2);
  await h.talk(f, nuff);
  await h.continueLine(f);
  await h.choose(f, "What do you do around here?");
  await until(f, "Maybe to you, but you'd be surprised how many adventurer's are willing to pay those prices.");
  assert.equal(varbit(f, 1809), 0);
  await h.continueLine(f);
  assert.equal(varbit(f, 1809), 1, "fairy_nuff_check after her introduction (1602)");
  h.ticks(f, 2);
  await h.talk(f, nuff);
  assert.match(h.shown(f).text, /^Hello fairy\d+, do you need any assistance\?/);
  await h.continueLine(f);
  assert.equal(h.shown(f).text, "Yes, please. I need healing.|No thanks. Just looking around.");
});

test("Zandar: the list goes and 50 comes after 'So I guess I need to go and kill...'; 'the hard way' moves the player to 3217,3176 with synth 199 (1716-1751, 1770-1778)", async (t) => {
  const f = h.actor(t, { stage: 40, at: BY_ZANDAR, items: [I.SYMPTOMS_LIST] });
  const zandar = h.spawn(f, N.ZANDAR_HORFYRE, ZANDAR);
  await h.talk(f, zandar);
  await until(f, "How is she? I owe her a great deal");
  await until(f, "I don't suppose you could give me more details about the Fairy Queen's condition, could you?");
  await until(f, "Hmm...yes...slow discorporation of ethereal body, eh?");
  await until(f, "So I guess I need to go and kill this Tanglefoot");
  assert.equal(f.player.getInventory().getAmount(I.SYMPTOMS_LIST), 1);
  await h.continueLine(f);
  assert.equal(f.player.getInventory().getAmount(I.SYMPTOMS_LIST), 0);
  assert.equal(h.stage(f), 50);
  assert.equal(h.shown(f).text, "Yes, but if I were you I would seek Malignus Mortifer, the necromancer. He's been seen near Port Sarim with his followers recently. I believe he once fought a Tanglefoot.");
  await h.continueLine(f);
  assert.equal(h.shown(f).text, "Malignus Mortifer. Okay, thanks very much.");
  await finish(f);
  h.ticks(f, 2);
  // After the diagnosis he is his own page again.
  await h.talk(f, zandar);
  assert.equal(h.shown(f).text, "Who are you?");
  await until(f, "Ok, I was going anyway.");
  await h.choose(f, "No, I think I'll stay for a bit.");
  await until(f, "Actually, that wasn't an invitation.");
  const continued = f.tick;
  await h.continueLine(f);
  assert.deepEqual(at(f), [3217, 3176, 0], "on the continue (1771)");
  assert.ok(sounds(f, continued).includes(199), "tele_other_cast");
  assert.equal(f.animations.filter((a) => a.tick >= continued).length, 0, "no animation");
  for (let i = 0; i < 3 && !h.shown(f); i++) h.tick(f);
  assert.equal(h.shown(f).text, "Zamorak curse that mage!");
  await h.continueLine(f);
  assert.equal(h.shown(f).text, "Actually, I guess he already has!");
});

test("Malignius: the skull from his 'asked again' menu, 60 and the recipe as varbits 17-19 name it; the reminder; his menu drops the asked question (2010-2052, 2395-2466)", async (t) => {
  const f = h.actor(t, { stage: 50, at: BY_MALIGNIUS, attributes: { "quest.fairytale-i-growing-pains:malignius-asked": 1 }, items: [I.DRAYNOR_SKULL] });
  const malignius = h.spawn(f, N.MALIGNIUS_MORTIFER, MALIGNIUS);
  const random = h.core.Misc.randomInclusive;
  t.mock.method(h.core.Misc, "randomInclusive", (min, max) => (min === 1 && max === 29 ? 18 : random(min, max)));
  await h.talk(f, malignius);
  assert.equal(h.shown(f).title, "What would you like to say?");
  await h.choose(f, "I was asking you about fighting a Tanglefoot...");
  await until(f, "Yes, I have it right here.");
  await h.continueLine(f);
  assert.equal(h.stage(f), 60);
  assert.equal(f.player.getInventory().getAmount(I.DRAYNOR_SKULL), 0);
  assert.deepEqual([1804, 1805, 1806].map((id) => varbit(f, id)), [17, 18, 19], "the Wiki rows 18-20, from 0 (2404)");
  assert.ok(h.shown(f).text.startsWith("Right then, to business."));
  await until(f, "Obviously you will need a pair of secateurs");
  assert.equal(h.shown(f).text, "Obviously you will need a pair of secateurs, you will also need to gather a raw cave eel, some edible seaweed and an unopened oyster.");
  await finish(f);
  // The journal says the same, wrapping inside an item as live does (2480).
  assert.deepEqual(journal(f).slice(-4), [
    "<col=800000>Malignus Mortifer<col=000080> told me that I need to make a pair of",
    "<col=000080><col=800000>Enchanted Secateurs<col=000080> to fight the <col=800000>Tanglefoot<col=000080>. To do this I will",
    "need to take <col=800000>a pair of secateurs, a raw cave eel, some edible",
    "<col=800000>seaweed and an unopened oyster<col=000080> to the <col=800000>Nature Spirit<col=000080>.",
  ]);
  h.ticks(f, 2);
  await h.talk(f, malignius);
  await h.choose(f, "I was asking you about fighting a Tanglefoot...");
  await until(f, "Could you tell me how to kill a Tanglefoot again, please?");
  await h.choose(f, "Could you tell me how to kill a Tanglefoot again, please?");
  await until(f, "I guess so, forgot to take notes did you? Well, listen carefully this time.");
  await h.continueLine(f);
  assert.equal(h.shown(f).text, "You will need to enchant a pair of secateurs. Only these can harm a Tanglefoot.");
  await finish(f);
  h.ticks(f, 2);
  await h.talk(f, malignius);
  await h.choose(f, "Who are you and what are you doing here?");
  await until(f, "Grayzag and Invrigar...");
  await until(f, "Is this like Summoning?");
  await h.choose(f, "Is this like Summoning?");
  await until(f, "What happened to Melzar?");
  assert.equal(h.shown(f).text, "What happened to Melzar?|Why do you keep making fungi appear?|Thanks, I'll be off now.");
  await h.choose(f, "What happened to Melzar?");
  await until(f, "Is this like Summoning?");
  assert.equal(h.shown(f).text, "Is this like Summoning?|Why do you keep making fungi appear?|Thanks, I'll be off now.");
  assert.ok(!f.said.some((s) => s.text.startsWith("Grayzag, Invrigar, Sithik")), "only his no-Zogre line");
});

test("Malignius's mushroom: he casts on the continue, two ticks later the flame, the loc and the transform with a held 'MMMmmph!', twelve ticks after it all reverses (1949-1966)", async (t) => {
  const f = h.actor(t, { stage: 50, at: BY_MALIGNIUS });
  const malignius = h.spawn(f, N.MALIGNIUS_MORTIFER, MALIGNIUS);
  const cast = [];
  const animate = malignius.performAnimation.bind(malignius);
  malignius.performAnimation = (animation) => { cast.push({ tick: f.tick, id: animation.getId() }); return animate(animation); };
  await h.talk(f, malignius);
  await h.choose(f, "Where can I get clothes like those?");
  await until(f, "How about if I turn you into a mushroom");
  const continued = f.tick + 1;
  await h.continueLine(f);
  assert.deepEqual(cast.map((c) => [c.tick - continued, c.id]), [[0, h.core.CacheDefinitions.getSeqId("human_casting")]]);
  assert.ok(sounds(f, continued).includes(229), "zamorak_flame");
  assert.equal(h.shown(f), null, "the chat closes");
  h.ticks(f, 2);
  const tile = h.core.Location.create?.(BY_MALIGNIUS[0], BY_MALIGNIUS[1], 0) ?? new h.core.Location(...BY_MALIGNIUS);
  assert.equal(f.player.getNpcTransformationId(), h.core.CacheDefinitions.getNpcId("desert_treasure_invisible_npc"));
  assert.ok(h.core.MapObjects.get(h.core.CacheDefinitions.getLocId("mushroom_inactive"), tile, f.player.getPrivateArea?.() ?? null), "the mushroom on the player's tile");
  assert.ok(sounds(f, continued + 2).includes(907), "human_into_mushroom");
  assert.ok(f.calls.some((c) => c.name === "sendGraphic" && c.args[0].getId() === 78 && c.tick === continued + 2), "the flame");
  assert.ok(f.calls.some((c) => c.name === "sendString" && c.args[0] === "MMMmmph!"), "the held line");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true);
  h.ticks(f, 11);
  assert.equal(f.player.getNpcTransformationId(), h.core.CacheDefinitions.getNpcId("desert_treasure_invisible_npc"));
  h.tick(f);
  assert.equal(f.player.getNpcTransformationId(), -1, "twelve ticks on (1966)");
  assert.equal(h.core.MapObjects.get(h.core.CacheDefinitions.getLocId("mushroom_inactive"), tile, f.player.getPrivateArea?.() ?? null), null);
  assert.ok(sounds(f, continued + 14).includes(908), "mushroom_into_human");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(f.player.getPacketSender().getChatboxGroupId(), -1, "the chat closes");
});

test("the blessing: kneel, take, spotanim 568 at 100, the camera and synth 1097 on the continue; six ticks later 70, the pair in the secateurs' slot and 'It is done!' (3263-3273)", async (t) => {
  const f = h.actor(t, { stage: 60, at: BY_SPIRIT, amulet: true, items: [I.SECATEURS, I.RAW_CAVE_EEL, I.EDIBLE_SEAWEED, I.OYSTER], attributes: { [ITEMS]: "18,19,20" } });
  const spirit = h.spawn(f, N.NATURE_SPIRIT, SPIRIT);
  const graphics = [];
  const show = spirit.performGraphic.bind(spirit);
  spirit.performGraphic = (graphic) => { graphics.push([f.tick, graphic.getId(), Number(graphic.getHeight?.() ?? graphic.height)]); return show(graphic); };
  const spiritAnims = [];
  const animate = spirit.performAnimation.bind(spirit);
  spirit.performAnimation = (animation) => { spiritAnims.push([f.tick, animation.getId()]); return animate(animation); };
  const cameras = [];
  const sender = f.player.getPacketSender();
  for (const name of ["sendCameraMoveTo", "sendCameraLookAt", "sendCameraReset"]) {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { cameras.push([f.tick, name, ...args.slice(0, 3)]); return original(...args); };
  }
  const slot = f.player.getInventory().getSlotForItemId(I.SECATEURS);
  await h.talk(f, spirit);
  await until(f, "Then let us begin...");
  const continued = f.tick + 1;
  await h.continueLine(f);
  assert.deepEqual(f.animations.filter((a) => a.tick === continued).map((a) => a.id), [h.core.CacheDefinitions.getSeqId("human_fairy_kneel_and_offer")]);
  assert.deepEqual(spiritAnims, [[continued, h.core.CacheDefinitions.getSeqId("human_fairy_take_and_hold_up")]]);
  assert.deepEqual(graphics, [[continued, 568, 100]]);
  assert.deepEqual(cameras.filter((c) => c[0] === continued), [
    [continued, "sendCameraMoveTo", SPIRIT[0] + 6, SPIRIT[1] - 4, 375],
    [continued, "sendCameraLookAt", SPIRIT[0], SPIRIT[1], 375],
  ]);
  assert.ok(sounds(f, continued).includes(1097), "ft_enchant_flower");
  assert.equal(h.shown(f), null, "the chat closes");
  h.ticks(f, 5);
  assert.equal(h.stage(f), 60);
  assert.equal(f.player.getInventory().getAmount(I.SECATEURS), 1);
  h.tick(f);
  assert.equal(h.stage(f), 70, "six ticks on (3271)");
  assert.equal(f.player.getInventory().getItems()[slot]?.getId(), I.MAGIC_SECATEURS, "in the secateurs' slot");
  for (const id of [I.RAW_CAVE_EEL, I.EDIBLE_SEAWEED, I.OYSTER]) assert.equal(f.player.getInventory().getAmount(id), 0);
  assert.ok(cameras.some((c) => c[0] === continued + 6 && c[1] === "sendCameraReset"));
  assert.equal(h.shown(f).text, "It is done!");
  await h.continueLine(f);
  assert.match(h.shown(f).text, /^Farewell, fairy\d+ and good luck with your coming battle\.$/);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  // Back again: why, with a menu (1001455 ticks 2520-2525).
  await finish(f);
  h.ticks(f, 2);
  await h.talk(f, spirit);
  assert.match(h.shown(f).text, /^Hello, fairy\d+\. Why have you returned so soon after your last visit\?/);
  await h.continueLine(f);
  assert.equal(h.shown(f).text, "I'm afraid I've lost the secateurs you enchanted.|No reason, really.");
  await h.choose(f, "I'm afraid I've lost the secateurs you enchanted.");
  await until(f, "You should not lie to me, my friend. I can see that you have them with you.");
});

test("the grove at 70: the Gate Keeper, the box, the sidestep and synth 1107, then a private copy with the Tanglefoot; out through the gap; 80 as the Queen's secateurs are taken (3707-3716, 3997, 4039-4042)", async (t) => {
  const f = h.actor(t, { stage: 70, at: OUTSIDE_GROVE, items: [I.MAGIC_SECATEURS] });
  await h.clickObject(f, 11999, GROVE_WALL);
  assert.equal(h.shown(f).who, "Gate Keeper");
  assert.equal(h.shown(f).text, "I've received orders to let you through if you want. Good luck.");
  await h.continueLine(f);
  assert.equal(h.shown(f).text, "You squeeze past the thorny vines into a small tunnel.");
  assert.equal(messages(f).filter((m) => m === "You squeeze past the thorny vines into a small tunnel.").length, 1, "one mesbox line (3713)");
  const squeezed = f.tick + 1;
  await h.continueLine(f);
  assert.deepEqual(f.animations.filter((a) => a.tick === squeezed).map((a) => a.id), [h.core.CacheDefinitions.getSeqId("human_into_sidestep")]);
  assert.ok(sounds(f, squeezed).includes(1107), "ft_squeeze_past");
  assert.deepEqual(at(f), OUTSIDE_GROVE, "the copy comes a tick later (3716)");
  h.tick(f);
  const copyTile = f.player.getLocation();
  assert.ok(copyTile.getX() > 4000, `in a copy of the grove, not the real one: ${at(f)}`);
  const owned = [...h.core.World.getNpcs()].filter((npc) => npc?.getOwner?.() === f.player);
  const tanglefoot = owned.find((npc) => npc.getId() === N.TANGLEFOOT);
  assert.ok(tanglefoot, "its own Tanglefoot");
  assert.equal(owned.filter((npc) => [N.BABY_TANGLEFOOT, N.BABY_TANGLEFOOT_2].includes(npc.getId())).length, 7, "and the seven babies the copy shows");
  assert.equal(tanglefoot.getLocation().getX() - copyTile.getX(), 2375 - 2396, "where it first shows, relative to 2396,4379");
  // Only magic secateurs: anything else lands 0s, and a melee swing says so (1001455 ticks 3033, 3037).
  const hit = (weapon) => {
    f.player.getEquipment().setItem(h.core.Equipment.WEAPON_SLOT, weapon ? new h.core.Item(weapon, 1) : null);
    const hits = [{ damage: 7, setDamage(value) { this.damage = value; } }];
    const pending = { getAttacker: () => f.player, getHits: () => hits, updateTotalDamage() {}, getCombatType: () => h.core.CombatType.MELEE };
    h.PM.emitNpcHitModify(tanglefoot, pending);
    h.PM.emitCustomEvent("combat:hit-queued", { player: f.player, target: tanglefoot, hit: pending });
    return hits[0].damage;
  };
  const from = f.messages.length;
  assert.equal(hit(null), 0);
  assert.deepEqual(f.messages.slice(from).map((m) => m.text), ["I can't deal any damage..."]);
  assert.equal(hit(I.MAGIC_SECATEURS), 7);
  assert.equal(f.messages.length, from + 1, "no message with the secateurs");
  // The kill's drop is taken: 80 (3997).
  // Taken by hand or by Telekinetic Grab: both credit the item through ground-items:taken.
  h.PM.emitCustomEvent("ground-items:taken", { player: f.player, groundItem: null, source: "telegrab", itemId: I.QUEENS_SECATEURS, amount: 0, discarded: 0 });
  assert.equal(h.stage(f), 70, "nothing credited, no stage");
  h.PM.emitCustomEvent("ground-items:taken", { player: f.player, groundItem: null, source: "telegrab", itemId: I.QUEENS_SECATEURS, amount: 1, discarded: 0 });
  assert.equal(h.stage(f), 80);
  await h.dispatch(f, { type: "object_option", id: h.core.ObjectIdentifiers.A_GAP_THROUGH_THE_WALL, x: copyTile.getX() + 1, y: copyTile.getY(), clickType: 1 });
  for (let i = 0; i < 15 && !h.shown(f); i++) h.tick(f);
  assert.equal(h.shown(f).text, "You squeeze past the thorny vines into a small tunnel.");
  const left = f.tick + 1;
  await h.continueLine(f);
  assert.deepEqual(at(f), OUTSIDE_GROVE, "out with the continue (4042)");
  assert.ok(f.animations.some((a) => a.tick === left && a.id === h.core.CacheDefinitions.getSeqId("human_into_sidestep")));
  assert.ok(sounds(f, left).includes(1107));
  h.ticks(f, 2);
  assert.equal([...h.core.World.getNpcs()].filter((npc) => npc?.getOwner?.() === f.player).length, 0, "the copy's NPCs go with it");
  // After the kill the Gate Keeper's line moves the player into the real grove (424 ticks 18514-18518).
  f.player.getInventory().adds(I.QUEENS_SECATEURS, 1);
  await h.clickObject(f, 11999, GROVE_WALL);
  assert.equal(h.shown(f).text, "Be careful in there, there are still some of those baby Tanglefootii around.");
  await h.continueLine(f);
  assert.deepEqual(at(f), [2396, 4379, 0]);
});

test("completion after 'Grazie infinite!': the scroll's Queen's secateurs and 'Some Magic Secateurs', the recipe varbits cleared; then the Godfather ignores the player and Malignius offers a pair (4179-4201, 4454-4482)", async (t) => {
  const f = h.actor(t, { stage: 80, at: BY_GODFATHER, items: [I.QUEENS_SECATEURS], attributes: { [ITEMS]: "18,19,20" } });
  const godfather = h.spawn(f, N.FAIRY_GODFATHER, GODFATHER);
  assert.deepEqual([1804, 1805, 1806].map((id) => varbit(f, id)), [17, 18, 19]);
  await h.talk(f, godfather);
  await until(f, "Grazie infinite!");
  await h.continueLine(f);
  assert.equal(h.stage(f), 90);
  assert.equal(f.player.getInventory().getAmount(I.QUEENS_SECATEURS), 0);
  assert.deepEqual([1804, 1805, 1806].map((id) => varbit(f, id)), [0, 0, 0]);
  h.ticks(f, 2); // QuestRuntime opens every quest's scroll a tick after the completion
  assert.ok(f.calls.some((c) => c.name === "sendItemOnInterfaces" && c.args.includes(I.QUEENS_SECATEURS)), "the scroll's model (4181)");
  assert.ok(f.calls.some((c) => c.name === "sendString" && c.args[0] === "Some Magic Secateurs"), "its last reward line");
  assert.equal(journal(f).at(-1), "<col=ff0000>QUEST COMPLETE!", "1001455 tick 3249");
  f.player.closeInterruptibleInterfaces();
  h.ticks(f, 2);
  const from = f.messages.length;
  await h.talk(f, godfather);
  assert.deepEqual(f.messages.slice(from).map((m) => m.text), ["The Godfather is ignoring you."], "a message, not a box");
  assert.equal(h.shown(f), null);
  f.player.moveTo(new h.core.Location(...BY_MALIGNIUS));
  h.ticks(f, 2);
  const malignius = h.spawn(f, N.MALIGNIUS_MORTIFER, MALIGNIUS);
  await h.talk(f, malignius);
  assert.equal(h.shown(f).title, "What would you like to say?");
  assert.equal(h.shown(f).text, "Who are you and what are you doing here?|About those enchanted secateurs again...|Where can I get clothes like those?");
  await h.choose(f, "About those enchanted secateurs again...");
  await until(f, "Can I get another set of enchanted secateurs?");
  await h.choose(f, "Can I get another set of enchanted secateurs?");
  await until(f, "I could let you have them for a mere 40,000 gp.");
  await until(f, "Ok, great.");
  f.player.getInventory().add(new h.core.Item(I.COINS, 40000), false);
  await h.choose(f, "Ok, great.");
  await until(f, "A pleasure doing business with you");
  await h.continueLine(f);
  assert.equal(h.shown(f), null, "the sale ends there, with no refusal after it");
  assert.equal(f.player.getInventory().getAmount(I.MAGIC_SECATEURS), 1);
  assert.equal(f.player.getInventory().getAmount(I.COINS), 0);
  // Before the quest the option is not his to offer (the Wiki guard "If Fairytale Part I has been completed:").
  const g = h.actor(t, { stage: 0, at: BY_MALIGNIUS, items: [] });
  g.player.getInventory().add(new h.core.Item(I.COINS, 40000), false);
  const early = h.spawn(g, N.MALIGNIUS_MORTIFER, MALIGNIUS);
  await h.talk(g, early);
  await until(g, "... MORE ...");
  assert.ok(!h.shown(g).text.includes("About those enchanted secateurs again..."), h.shown(g).text);
});

test("the dig says 'I can't believe I'm about to do this!' as it starts (2216)", async (t) => {
  const f = h.actor(t, { stage: 50, at: [3105, 3383, 0], items: [I.SPADE] });
  h.core.RegionManager.loadMapFiles(3106, 3384);
  const said = [];
  const force = f.player.forceChat.bind(f.player);
  f.player.forceChat = (text) => { said.push([f.tick, text]); return force(text); };
  const slot = f.player.getInventory().getSlotForItemId(I.SPADE);
  await h.dispatch(f, { type: "inventory_action", widgetId: h.core.CacheDefinitions.getComponentId("inventory:items"), itemId: I.SPADE, slot, option: "Dig", optionIndex: 1 });
  assert.deepEqual(said.map(([, text]) => text), ["I can't believe I'm about to do this!"]);
  h.ticks(f, 4);
  assert.equal(f.player.getInventory().getAmount(I.DRAYNOR_SKULL), 1);
});

/** An inventory Examine: a click that resets the dialogue manager (the review's probe). */
async function examine(f, itemId) {
  const slot = f.player.getInventory().getSlotForItemId(itemId);
  await f.connection.dispatch([{ type: "inventory_action", widgetId: 3214, itemId, slot, option: "Examine", optionIndex: 10 }]);
  h.tick(f);
}

test("a click during the blessing or the mushroom cannot strand the player: each scene keeps its own time", async (t) => {
  const f = h.actor(t, { stage: 60, at: BY_SPIRIT, amulet: true, items: [I.SECATEURS, I.RAW_CAVE_EEL, I.EDIBLE_SEAWEED, I.OYSTER, I.SPADE], attributes: { [ITEMS]: "18,19,20" } });
  const spirit = h.spawn(f, N.NATURE_SPIRIT, SPIRIT);
  await h.talk(f, spirit);
  await until(f, "Then let us begin...");
  const continued = f.tick + 1;
  await h.continueLine(f);
  await examine(f, I.SPADE);
  h.ticks(f, continued + 6 - f.tick);
  assert.equal(h.stage(f), 70, "the blessing finishes");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(h.shown(f)?.text, "It is done!");
  await finish(f);

  const g = h.actor(t, { stage: 50, at: BY_MALIGNIUS, items: [I.SPADE] });
  const malignius = h.spawn(g, N.MALIGNIUS_MORTIFER, MALIGNIUS);
  await h.talk(g, malignius);
  await h.choose(g, "Where can I get clothes like those?");
  await until(g, "How about if I turn you into a mushroom");
  await h.continueLine(g);
  await examine(g, I.SPADE);
  h.ticks(g, 2);
  assert.equal(g.player.getNpcTransformationId(), h.core.CacheDefinitions.getNpcId("desert_treasure_invisible_npc"), "the mushroom still comes");
  h.ticks(g, 13);
  assert.equal(g.player.getNpcTransformationId(), -1);
  assert.equal(g.player.getMovementQueue().isMovementBlocked(), false, "and lets go");
});

test("after Fairytale I, Swan Song's Malignius steps are still Swan Song's (stage 110)", async (t) => {
  const f = h.actor(t, { stage: 90, at: BY_MALIGNIUS });
  h.quest("swan_song").setStage(f.player, 110);
  const malignius = h.spawn(f, N.MALIGNIUS_MORTIFER, MALIGNIUS);
  await h.talk(f, malignius);
  assert.notEqual(h.shown(f)?.text, "Who are you and what are you doing here?|About those enchanted secateurs again...|Where can I get clothes like those?");
  assert.ok(h.shown(f), "Swan Song's conversation plays");
});

test("the copy keeps the grove's south-east strip (x 2399-2400 below y 4367) inside the scene", async (t) => {
  const f = h.actor(t, { stage: 70, at: OUTSIDE_GROVE, items: [I.MAGIC_SECATEURS] });
  await h.clickObject(f, 11999, GROVE_WALL);
  await h.continueLine(f);
  await h.continueLine(f);
  h.ticks(f, 2);
  const inside = f.player.getLocation();
  const base = [inside.getX() - 2396, inside.getY() - 4379];
  f.player.moveTo(new h.core.Location(base[0] + 2398, base[1] + 4360, 0));
  h.ticks(f, 2);
  f.player.getMovementQueue().walkStep(1, 0);
  h.ticks(f, 3);
  assert.equal(f.player.getLocation().getX(), base[0] + 2399, "the step is taken in the copy");
  assert.equal(f.player.getArea()?.getName?.(), "tanglefoot scene");
  assert.ok([...h.core.World.getNpcs()].some((npc) => npc?.getOwner?.() === f.player && npc.getId() === N.TANGLEFOOT), "the Tanglefoot stays");
});
