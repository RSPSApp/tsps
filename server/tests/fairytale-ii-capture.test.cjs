// Run after `yarn build`: node --test tests/fairytale-ii-capture.test.cjs
//
// Fairytale II - Cure a Queen against the user's whole-quest rsprox capture FairyTale2 (revision 242.1;
// docs/quests/fairytale-ii-cure-a-queen/README.md). Real Player, PlayerSession and ClientConnection,
// the real plugins, cache and map: talks and clicks are packets, each tick runs as World.process does.
// Tick numbers are FairyTale2's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./fairytale-i-harness.cjs");

h.key = "fairytale_ii_cure_a_queen";
const DONE = ["lost_city", "nature_spirit", "fairytale_i_growing_pains"];

const MARTIN = [3077, 3260, 0];
const BY_MARTIN = [3077, 3259, 0];
const GODFATHER = [2446, 4427, 0];
const BY_GODFATHER = [2446, 4428, 0];
const COORDINATOR = [2453, 4456, 0];
const BY_COORDINATOR = [2453, 4455, 0];
const NUFF = [2353, 4458, 0];
const BY_NUFF = [2352, 4458, 0];
const VERY_WISE = [2353, 4458, 0];
const QUEEN_BED = [2351, 4457];
const BY_BED = [2351, 4456, 0];
const ROOM_DOOR = [2388, 4469, 0];
const IN_ROOM = [2387, 4471, 0];
const CERT_FRAME = [2389, 4471];
const STAR_PLANE = [2075, 4848, 0];
const GORAK_PLANE = [3038, 5348, 0];

const STUDIED = "quest.fairytale-ii-cure-a-queen:certificate-studied";
const TAKEN = "quest.fairytale-ii-cure-a-queen:certificate-taken";
const SIGN = "quest.fairytale-ii-cure-a-queen:sign-read";
const PAN = "quest.fairytale-ii-cure-a-queen:nuff-room-pan";
const PLANES = "quest.fairytale-ii-cure-a-queen:planes";

let I;
let N;
before(async () => {
  await h.setup([[3077, 3260], [2446, 4427], [2453, 4456], [2353, 4458], [2388, 4470], [2075, 4848], [3038, 5348],
    [3186, 3211], [3139, 3260], [3139, 3228], [2336, 4452]]);
  I = h.core.ItemIdentifiers;
  N = h.core.NpcIdentifiers;
});
after(() => h.teardown());

const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const messages = (f) => f.messages.map((m) => m.text);
const journal = (f) => h.quest().buildJournal(f.player, h.quest());
const at = (f) => [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()];
const calls = (f, name, from = 0) => f.calls.filter((c) => c.tick >= from && c.name === name);
/** An actor whose quest varbits are synced as a login syncs them (the stage is set directly). */
function actor(t, options) {
  const f = h.actor(t, { done: DONE, ...options });
  h.PM.emitCustomEvent("player:bootstrap-complete", { player: f.player });
  return f;
}

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

test("Martin's ready offer: the refusal keeps 10, Yes starts at 20 with 1807, 2332 and 2327 (ticks 44-89)", async (t) => {
  const f = actor(t, { stage: 10, at: BY_MARTIN });
  const martin = h.spawn(f, N.MARTIN_THE_MASTER_GARDENER, MARTIN);
  const said = await h.converse(f, async () => { await h.talk(f, martin); }, ["Ask about the quest.", "No."]);
  assert.deepEqual(said.slice(1, 9), [
    "PLAYER: Hello Martin, you must be the slowest gardener in the world! I don't suppose those crops have grown yet?",
    "Martin the Master Gardener: Well, you've got a nerve showing up around here again!",
    "PLAYER: What? What are you talking about?",
    "Martin the Master Gardener: You told me that you'd solved the problems of the Gardening Group's members, well I've planted loads of seeds since then and there's no doubt that even more plants are dying!",
    "PLAYER: But I gave the Fairy Queen's secateurs back to the Godfather, things should be growing again.",
    "Martin the Master Gardener: Yeah, sure, whatever. You know, I didn't believe you when you told me that story about 'the fairies' in the first place. You'd just better solve this problem, when people get hungry, they get angry and you're the",
    "Martin the Master Gardener: person who said that everything would be all right, so you're the person who they'll get angry with!",
    "MENU[Start the Fairytale II - Cure a Queen quest?]: Yes.|No.",
  ]);
  assert.equal(said.at(-1), "PLAYER: I've done enough for you, sort it out yourself!");
  assert.equal(h.stage(f), 10);
  await h.converse(f, async () => { await h.talk(f, martin); }, ["Ask about the quest.", "Yes."]);
  assert.equal(h.stage(f), 20);
  assert.equal(varbit(f, 1807), 2);
  assert.equal(varbit(f, 2332), 1);
  assert.equal(varbit(f, 2327), 1);
  assert.ok(messages(f).some((m) => /^You've started a new quest: .*Fairytale II - Cure a Queen/.test(m)));
  assert.deepEqual(journal(f), [
    "<str>I have spoken to Martin. He told me that his crops are still not",
    "<str>growing.",
    "<col=000080>I should go to Zanaris and try to find out what the problem is.",
  ], "tick 215");
});

/** Records the camera packets (the harness records only its own list). */
function spyCamera(f) {
  const sender = f.player.getPacketSender();
  const seen = [];
  for (const name of ["sendCameraMoveTo", "sendCameraLookAt", "sendCameraReset"]) {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { seen.push({ tick: f.tick, name, args }); return original(...args); };
  }
  return seen;
}

test("the grotto: the step in locks the player, the camera sweeps and resets at 23 ticks with 30, 2339 and the player's line (283-313)", async (t) => {
  const f = actor(t, { stage: 20, at: ROOM_DOOR });
  const camera = spyCamera(f);
  // The capture runs in over 2388,4470 (283); the step in is the zone entry.
  f.player.moveTo(new h.core.Location(...IN_ROOM));
  let entered = -1;
  for (let i = 0; i < 6 && entered < 0; i++) {
    h.tick(f);
    if (f.player.getMovementQueue().isMovementBlocked()) entered = f.tick;
  }
  assert.ok(entered > 0, `locked on the step in; at ${at(f)}`);
  h.ticks(f, 30);
  const relative = camera.map(({ tick, name, args }) => [tick - entered, name, ...args.slice(0, 3)]);
  assert.deepEqual(relative, [
    [4, "sendCameraMoveTo", 2386, 4471, 300],
    [6, "sendCameraLookAt", 2387, 4474, 25],
    [8, "sendCameraLookAt", 2384, 4474, 75],
    [10, "sendCameraLookAt", 2384, 4472, 150],
    [12, "sendCameraLookAt", 2384, 4471, 200],
    [14, "sendCameraLookAt", 2384, 4470, 200],
    [16, "sendCameraLookAt", 2385, 4470, 200],
    [18, "sendCameraLookAt", 2388, 4470, 200],
    [20, "sendCameraLookAt", 2389, 4471, 75],
    [23, "sendCameraReset"],
  ], "287-306, four ticks after the step in at 283");
  assert.deepEqual(camera[0].args[3], { rate: 4, rate2: 10 });
  assert.equal(h.stage(f), 30);
  assert.equal(varbit(f, 2339), 1);
  assert.equal(h.shown(f)?.text, "Wow! Somebody has trashed this cave! And what's happened to Fairy Nuff and the Fairy Queen?");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.deepEqual(journal(f), [
    "<str>I have spoken to Martin. He told me that his crops are still not",
    "<str>growing.",
    "<str>I returned to Zanaris and found Fairy Nuff's grotto",
    "<str>ransacked and Fairy Nuff and the Fairy Queen missing!",
    "<col=000080>I should try to find out what happened.",
  ], "tick 313");
});

test("Take on the broken frame: the certificate and its box; every shelf then shows broken glass (317-346)", async (t) => {
  const f = actor(t, { stage: 30, at: [2388, 4471, 0] });
  await h.clickObject(f, 16315, CERT_FRAME);
  assert.equal(h.shown(f)?.text, "You pick up Fairy Nuff's certificate, being careful not to cut yourself on its broken frame.");
  assert.equal(f.player.getInventory().getAmount(I.NUFFS_CERTIFICATE), 1);
  assert.equal(varbit(f, 2327), 2);
  await h.continueLine(f);
  await h.clickObject(f, 16218, [2389, 4470]);
  assert.equal(h.shown(f)?.text, "You don't find anything useful, just some glass from a broken vial.");
  assert.equal(h.shown(f)?.who, "ItemStatementDialogue");
});

test("the Godfather at 30: the certificate is his menu's third option; the refusal sets 2329 to 1 (420-474)", async (t) => {
  const f = actor(t, { stage: 30, at: BY_GODFATHER, items: [9025], attributes: { [STUDIED]: 1, [TAKEN]: 1 } });
  const godfather = h.spawn(f, N.FAIRY_GODFATHER_2, GODFATHER);
  let said = await h.converse(f, async () => { await h.talk(f, godfather); }, ["Show the Godfather the Certificate!"]);
  assert.equal(said[0], "MENU[Select an option]: Where is the Fairy Queen?|Where have all the fairies gone?|Show the Godfather the Certificate!");
  assert.deepEqual(said.slice(1), [
    "ItemStatementDialogue: You show the certificate to the Godfather.",
    "PLAYER: Do you know what these strange marks mean?",
    "Fairy Godfather: For why you show-a me dat? Eez very nice to see yous learning to draw! Bravo!",
  ]);
  said = await h.converse(f, async () => { await h.talk(f, godfather); },
    ["Where is the Fairy Queen?", "Do you have any idea who could have done this?", "No, I'll rescue her myself."]);
  assert.ok(said.includes("Fairy Godfather: Essere nel panico! You-a say datta da Queen Bee, she izza meesing? Theez izza terreeble! Who could-a have done such a theeng? We musta find her! I weel organise a search-a party right-a-way!"), said.join("\n"));
  assert.ok(said.includes("PLAYER: Where could she have been taken to?"), "the other option after 'not very helpful' (457)");
  assert.equal(varbit(f, 2329), 1);
  assert.equal(h.stage(f), 30);
});

test("the Godfather after the refusal: the contract scroll holds the talk until closed, then 40 with his 'wrong scroll' line (476-524)", async (t) => {
  const f = actor(t, { stage: 30, at: BY_GODFATHER, items: [9025],
    attributes: { [STUDIED]: 1, [TAKEN]: 1, "quest.fairytale-ii-cure-a-queen:godfather-denied": 1 } });
  const godfather = h.spawn(f, N.FAIRY_GODFATHER_2, GODFATHER);
  await h.talk(f, godfather);
  await until(f, "Oh, okay then.");
  await h.choose(f, "Oh, okay then.");
  await until(f, "Good, I knew-a you would change-a your mind.");
  await h.continueLine(f);
  const continued = f.tick;
  h.ticks(f, 2);
  const opened = calls(f, "sendInterface", continued).length + f.calls.filter((c) => c.name === "sendSubInterface" && c.args.includes(427)).length;
  assert.equal(f.player.getPacketSender().getInterfaceId?.() ?? 427, 427, `scroll open; ${opened}`);
  assert.equal(h.shown(f), null, "the chat closes while the scroll is up");
  h.ticks(f, 10);
  assert.equal(h.shown(f), null, "still waiting on the scroll");
  f.player.getPacketSender().sendInterfaceRemoval();
  h.ticks(f, 2);
  assert.equal(h.shown(f)?.text, "I'm not signing this! It says I am indebted to you until you release me!");
  assert.equal(h.stage(f), 30);
  await h.continueLine(f);
  assert.ok(h.shown(f)?.text.startsWith("Eet does? Oh, sorry, must-a geeven yous da wrong-a scroll."));
  assert.equal(h.stage(f), 40);
  assert.equal(varbit(f, 2328), 1);
  assert.equal(varbit(f, 2329), 2);
});

const slotOf = (f, id) => f.player.getInventory().getItems().findIndex((item) => item?.getId?.() === id);
async function useOn(f, itemId, objectId, [x, y]) {
  await h.dispatch(f, { type: "item_on_object", objectId, x, y, itemId, slot: slotOf(f, itemId), widgetId: h.core.Inventory.INTERFACE_ID << 16 });
}
function combine(f, a, b) {
  const items = f.player.getInventory().getItems();
  const used = slotOf(f, a);
  const usedWith = slotOf(f, b);
  const event = { player: f.player, usedItem: items[used], usedWithItem: items[usedWith], usedItemId: a, usedWithItemId: b,
    usedItemSlot: used, usedWithItemSlot: usedWith, handled: false };
  h.PM.emitItemOnItem(event);
  h.tick(f);
  return event;
}

test("the co-ordinator: her menu's certificate option shows it, 'somebody else' (619-639)", async (t) => {
  const f = actor(t, { stage: 40, at: BY_COORDINATOR, items: [9025], attributes: { [STUDIED]: 1, [TAKEN]: 1 } });
  const coordinator = h.spawn(f, N.CO_ORDINATOR, COORDINATOR);
  const said = await h.converse(f, async () => { await h.talk(f, coordinator); }, ["Fairy Nuff's certificate."]);
  assert.deepEqual(said, [
    "MENU[What do you want to ask about?]: Fairy Nuff's certificate.|The fairy rings.",
    "ItemStatementDialogue: You show the certificate to the co-ordinator.",
    "PLAYER: Do you know what these strange marks mean?",
    "Co-ordinator: They look familiar, but I can't think where I've seen marks like that. Try asking around, maybe somebody else will recognise them.",
  ]);
});

test("the hideout fairies: the five lines before Fairy Very Wise's news, the Wiki's seven after (877-941, 1016-1020)", async (t) => {
  const before = ["How could everything have gone so wrong, so quickly?", "What is that evil fairy doing to our beautiful kingdom?",
    "The Queen is the true ruler of Zanaris, not that wicked Godfather!", "I hope that the Queen wakes up soon, I want to go back home.",
    "The Godfather's henchmen tried to pull off my wings!"];
  for (const [stage, expectBefore] of [[40, true], [50, false]]) {
    const f = actor(t, { stage, at: [2336, 4451, 0] });
    const fairy = h.spawn(f, 1848, [2336, 4452, 0]);
    fairy.getMovementQueue().setBlockMovement(true);
    for (let i = 0; i < 4; i++) {
      await h.talk(f, fairy);
      const line = h.shown(f);
      assert.equal(line?.who, "Fairy");
      assert.equal(before.includes(line.text), expectBefore, `stage ${stage}: ${line.text}`);
      await finish(f);
      h.ticks(f, 2);
    }
  }
});

test("Fairy Nuff's welcome: 45 with 'You see a fairy approaching ...', 50 and 1808 with the pickpocket promise (946-1004)", async (t) => {
  const f = actor(t, { stage: 40, at: BY_NUFF, items: [9025], attributes: { [STUDIED]: 1, [TAKEN]: 1, [SIGN]: 1 } });
  const nuff = h.spawn(f, N.FAIRY_NUFF, NUFF);
  await h.talk(f, nuff);
  assert.ok(h.shown(f).text.endsWith("You found us! I'm so glad, I was afraid you wouldn't get my message."), h.shown(f).text);
  await until(f, "I've got terrible news!");
  assert.equal(h.stage(f), 45);
  assert.ok(messages(f).includes("You see a fairy approaching ..."));
  assert.equal(h.shown(f).who, "Fairy Very Wise");
  await until(f, "That's easy I'll just pickpocket them off of him, I'm really good at that.");
  assert.equal(h.stage(f), 50);
  assert.equal(varbit(f, 1808), 2);
  await finish(f);
  assert.deepEqual(journal(f).slice(9), [
    "<col=000080>The Godfather still has the Fairy Queen's enchanted",
    "<col=000080>secateurs, I need to find a way to get them back from him and",
    "<col=000080>then take them to Fairy Nuff.",
    "<col=000080>Fairy Very Wise told me that the Godfather's henchmen have",
    "<col=000080>keen eyes and will be watching out for him.",
  ], "tick 1236");
});

test("Fairy Very Wise: worried until the Queen wakes, then thanks (1127, 2426)", async (t) => {
  for (const [stage, line] of [[50, "I'm so worried about the Queen, without her the fairy people may be chased out of Gielinor completely! You must wake her, for all our sakes!"],
    [80, "Thank you for your great service to the fairy people, we are indebted to you!"]]) {
    const f = actor(t, { stage, at: BY_NUFF, attributes: { "quest.fairytale-ii-cure-a-queen:queen-woke": 1 } });
    assert.equal(h.stage(f), stage);
    const wise = h.spawn(f, N.FAIRY_VERY_WISE, VERY_WISE);
    const said = await h.converse(f, async () => { await h.talk(f, wise); });
    assert.deepEqual(said, [`Fairy Very Wise: ${line}`]);
  }
});

/** Pick-pocket on the Godfather with the roll forced. */
async function pickpocket(f, godfather, succeed) {
  const misc = h.core.Misc;
  const roll = misc.randomInclusive;
  misc.randomInclusive = (low) => (succeed ? low : 100);
  try {
    await h.dispatch(f, { type: "npc_option", index: godfather.getIndex(), clickType: 3 });
  } finally {
    misc.randomInclusive = roll;
  }
}

test("a failed pickpocket: Rocco's lesson, the fade, a wake-up tile outside Zanaris (1216-1234)", async (t) => {
  const f = actor(t, { stage: 50, at: BY_GODFATHER });
  f.player.getSkillManager().setMaxLevels(h.core.Skill.THIEVING, 53);
  f.player.getSkillManager().setCurrentLevel(h.core.Skill.THIEVING, 53, false);
  const godfather = h.spawn(f, N.FAIRY_GODFATHER, GODFATHER);
  const rocco = h.spawn(f, N.FAT_ROCCO, [2445, 4430, 0]);
  void rocco;
  const said = [];
  godfather.forceChat = (text) => { said.push({ tick: f.tick, text }); return godfather; };
  await pickpocket(f, godfather, false);
  const start = f.messages.find((m) => m.text === "You attempt to pickpocket the Fairy Godfather.")?.tick;
  assert.ok(start !== undefined, JSON.stringify(messages(f)));
  assert.ok(f.animations.some((a) => a.id === 881));
  h.ticks(f, 20);
  assert.deepEqual(said.map((s) => [s.tick - start, s.text]), [[3, "Rocco, teach-a thees thief a lesson!"]]);
  const beaten = f.messages.find((m) => m.text === "You're beaten unconscious.");
  assert.equal(beaten.tick - start, 5);
  assert.ok(f.animations.some((a) => a.id === 415 && a.tick === beaten.tick));
  const fades = f.calls.filter((c) => c.name === "sendSubInterface" && c.args[1] === 174);
  assert.deepEqual(fades.map((c) => [c.tick - start, c.args[3]?.postScripts?.[0]?.args]), [[5, [0, 255, 0, 0, 50]], [16, [0, 0, 0, 255, 50]]]);
  assert.ok([[3186, 3211, 0], [3139, 3260, 0], [3139, 3228, 0]].some((tile) => tile.join() === at(f).join()), at(f).join());
  assert.equal(h.shown(f)?.text, "You slowly wake up in an unknown place.");
  assert.equal(h.stage(f), 50);
  assert.equal(f.player.getInventory().getAmount(I.QUEENS_SECATEURS_2), 0);
});

test("a successful pickpocket: 60, the secateurs and their box, 47 Thieving XP and the jingle (1603)", async (t) => {
  const f = actor(t, { stage: 50, at: BY_GODFATHER });
  f.player.getSkillManager().setMaxLevels(h.core.Skill.THIEVING, 53);
  f.player.getSkillManager().setCurrentLevel(h.core.Skill.THIEVING, 53, false);
  const xp = f.player.getSkillManager().getExperience(h.core.Skill.THIEVING);
  const godfather = h.spawn(f, N.FAIRY_GODFATHER, GODFATHER);
  const jingles = [];
  const sender = f.player.getPacketSender();
  const jingle = sender.sendJingle.bind(sender);
  sender.sendJingle = (id, ...rest) => { jingles.push(id); return jingle(id, ...rest); };
  await pickpocket(f, godfather, true);
  for (let i = 0; i < 5 && !h.shown(f); i++) h.tick(f);
  assert.equal(h.stage(f), 60);
  assert.equal(f.player.getInventory().getAmount(I.QUEENS_SECATEURS_2), 1);
  assert.equal(h.shown(f)?.text, "You pick-pocket the Fairy Godfather and get the Queen's enchanted secateurs!");
  assert.equal(h.shown(f)?.who, "ItemStatementDialogue");
  assert.equal(f.player.getSkillManager().getExperience(h.core.Skill.THIEVING) - xp, 47);
  assert.deepEqual(jingles, [204]);
  assert.equal(messages(f).filter((m) => m === "You attempt to pickpocket the Fairy Godfather.").length, 1);
  assert.deepEqual(journal(f).slice(9), [
    "<str>Fairy Nuff sent me back to Zanaris where I stole the Fairy",
    "<str>Queen's enchanted secateurs back from the Godfather.",
    "<col=000080>I need to take them back to Fairy Nuff.",
  ], "tick 1654");
});

test("the secateurs to Nuff: their box, then 65 and her spell; the recipe's last line gives 70 (1875-1915)", async (t) => {
  const f = actor(t, { stage: 60, at: BY_NUFF, items: [I.QUEENS_SECATEURS_2, 9025] });
  const nuff = h.spawn(f, N.FAIRY_NUFF, NUFF);
  const animations = [];
  const perform = nuff.performAnimation.bind(nuff);
  nuff.performAnimation = (animation) => { animations.push(animation.getId()); return perform(animation); };
  await h.talk(f, nuff);
  await until(f, "You hand fairy Nuff the Queen's enchanted secateurs.");
  assert.equal(h.shown(f).who, "ItemStatementDialogue");
  assert.equal(h.stage(f), 60);
  await h.continueLine(f);
  assert.equal(h.stage(f), 65);
  assert.equal(varbit(f, 1808), 1);
  assert.equal(f.player.getInventory().getAmount(I.QUEENS_SECATEURS_2), 0);
  assert.deepEqual(animations, [4328]);
  await until(f, "only way onto or off of their world is through the fairy rings.");
  assert.equal(h.stage(f), 65);
  await h.continueLine(f);
  assert.equal(h.stage(f), 70);
  assert.deepEqual(journal(f).slice(14), [
    "<col=000080>I need to mix up a potion of Magic Essence and give it to Fairy",
    "<col=000080>Nuff.",
    "<col=000080>The ingredients are:",
    "<col=800000>A Star Flower",
    "<col=000080>Star Flowers only grow on the higher planes, I might be able to",
    "<col=000080>find one by using the fairy rings.",
    "<col=800000>A ground Gorak's claw",
    "<col=000080>Goraks live on a different plane. The only way to get there is",
    "<col=000080>through the fairy rings.",
  ], "tick 1921");
});

test("Nuff's recap at 70 follows the planes: the Gorak-only answer (2364-2370), then the both-planes one", async (t) => {
  const f = actor(t, { stage: 70, at: BY_NUFF, items: [9025, I.STAR_FLOWER], attributes: { [PLANES]: 2 } });
  const nuff = h.spawn(f, N.FAIRY_NUFF, NUFF);
  let said = await h.converse(f, async () => { await h.talk(f, nuff); });
  assert.deepEqual(said.slice(3), [
    "PLAYER: Thanks for the lecture, I've seen a Gorak, but where do I get one of these Star Flowers from?",
    "Fairy Nuff: Star Flowers only grow on the higher planes and even there they are extremely rare. You should be able to access some of the higher planes by using the fairy rings.",
  ]);
  assert.deepEqual(journal(f).slice(17), [
    "<str>A Star Flower",
    "<col=800000>A ground Gorak's claw",
    "<col=000080>Goraks live on a different plane. The only way to get there is",
    "<col=000080>through the fairy rings.",
  ], "tick 2105");
  f.player.setAttribute(PLANES, 3);
  said = await h.converse(f, async () => { await h.talk(f, nuff); });
  assert.equal(said.at(-1), "PLAYER: Yes, I'm on my way.");
  said = await h.converse(f, async () => { await h.talk(f, nuff); });
  assert.deepEqual(said, [
    "Fairy Nuff: Hello fairy" + f.player.getUsername().replace("fairy", "") + ". How are you getting on with making that potion?",
    "PLAYER: I haven't found a Star Flower yet.",
    "Fairy Nuff: I don't have to tell you again how important it is that you hurry!",
  ].map((line) => line.replace("fairy" + f.player.getUsername().replace("fairy", ""), f.player.getDisplayName())));
});

test("brewing: the star flower, the ground claw and the mix, with their animations, sound, 72/73 and 130 XP (2390-2398)", async (t) => {
  const f = actor(t, { stage: 70, at: BY_BED, items: [I.STAR_FLOWER, I.VIAL_OF_WATER, I.PESTLE_AND_MORTAR, I.GORAK_CLAWS] });
  f.player.getSkillManager().setMaxLevels(h.core.Skill.HERBLORE, 57);
  f.player.getSkillManager().setCurrentLevel(h.core.Skill.HERBLORE, 57, false);
  const xp = f.player.getSkillManager().getExperience(h.core.Skill.HERBLORE);
  combine(f, I.STAR_FLOWER, I.VIAL_OF_WATER);
  assert.equal(h.stage(f), 72);
  combine(f, I.PESTLE_AND_MORTAR, I.GORAK_CLAWS);
  combine(f, I.GORAK_CLAW_POWDER, I.MAGIC_ESSENCE_UNF_);
  assert.equal(h.stage(f), 73);
  assert.deepEqual(f.messages.filter((m) => m.type !== undefined).map((m) => m.text), [
    "You put the star flower into the vial of water.",
    "You grind the Gorak's claw into dust.",
    "You mix the gorak claws into your potion.",
  ]);
  assert.deepEqual(f.animations.map((a) => a.id), [363, 364, 363]);
  assert.equal(f.player.getInventory().getAmount(I.MAGIC_ESSENCE_3_), 1);
  assert.equal(f.player.getSkillManager().getExperience(h.core.Skill.HERBLORE) - xp, 130);
});

test("the potion on the Queen: 75 with the pour and her waking, 80 four ticks later; Nuff's Talk-to plays the awakening and the reward (2415-2539)", async (t) => {
  const f = actor(t, { stage: 73, at: BY_BED, items: [I.MAGIC_ESSENCE_3_] });
  const jingles = [];
  const sender = f.player.getPacketSender();
  const jingle = sender.sendJingle.bind(sender);
  sender.sendJingle = (id, ...rest) => { jingles.push(id); return jingle(id, ...rest); };
  await useOn(f, I.MAGIC_ESSENCE_3_, 16316, QUEEN_BED);
  for (let i = 0; i < 5 && h.stage(f) !== 75; i++) h.tick(f);
  assert.equal(h.stage(f), 75);
  const poured = f.tick;
  assert.ok(f.animations.some((a) => a.id === 4316));
  assert.equal(f.player.getInventory().getAmount(I.MAGIC_ESSENCE_2_), 1);
  assert.deepEqual(jingles, [205]);
  for (let i = 0; i < 6 && h.stage(f) !== 80; i++) h.tick(f);
  assert.equal(h.stage(f) === 80 ? f.tick - poured : -1, 4);
  f.player.moveTo(new h.core.Location(...BY_NUFF));
  h.tick(f);
  const nuff = h.spawn(f, N.FAIRY_NUFF, NUFF);
  const herblore = f.player.getSkillManager().getExperience(h.core.Skill.HERBLORE);
  await h.talk(f, nuff);
  assert.deepEqual([h.shown(f).who, h.shown(f).text], ["Fairy Queen", "...Urgh! Wh... what happened? ...Why do I feel so awful?"]);
  // Each speaker's own chathead: the Queen 1161, Nuff 1841, Very Wise 1847 (2432-2530).
  const heads = new Map();
  for (let i = 0; i < 40; i++) {
    const line = h.shown(f);
    if (line?.npcId !== undefined && line.who !== "PLAYER") heads.set(line.who, line.npcId);
    if (line?.text?.startsWith("us in trying times")) break;
    await h.continueLine(f);
  }
  assert.deepEqual(Object.fromEntries(heads), { "Fairy Queen": 1161, "Fairy Nuff": 1841, "Fairy Very Wise": 1847 });
  await until(f, "us in trying times, but please accept this magic lamp as a sign of our thanks.");
  await h.continueLine(f);
  assert.equal(h.shown(f)?.text, "The Fairy Queen gives you an XP lamp.");
  assert.equal(f.player.getInventory().getAmount(I.ANTIQUE_LAMP_2), 1);
  await h.continueLine(f);
  h.ticks(f, 2);
  assert.equal(h.stage(f), 90);
  assert.equal(varbit(f, 2335), 1);
  assert.equal(f.player.getSkillManager().getExperience(h.core.Skill.HERBLORE) - herblore, 3500);
  assert.ok(messages(f).some((m) => /^Congratulations, you've completed a quest: .*Fairytale II - Cure a Queen/.test(m)));
  assert.equal(h.quest().scrollItemId ?? 9021, 9021);
});

test("the star flowers: a shoot 42 ticks after arriving, its bloom 58 later, Pick takes the flower as it withers (1966-2082)", async (t) => {
  const f = actor(t, { stage: 70, at: STAR_PLANE, items: [9025] });
  f.player.getSkillManager().setMaxLevels(h.core.Skill.FARMING, 49);
  f.player.getSkillManager().setCurrentLevel(h.core.Skill.FARMING, 49, false);
  const spawned = [];
  const spawn = h.PM.spawnNpc;
  h.PM.spawnNpc = (definition, ...rest) => {
    const npc = spawn.call(h.PM, definition, ...rest);
    if (npc && definition.id === 1856) spawned.push({ tick: f.tick, npc });
    return npc;
  };
  t.after(() => { h.PM.spawnNpc = spawn; });
  const arrived = f.tick;
  h.ticks(f, 43);
  const first = spawned[0];
  assert.ok(first, "a shoot sprouted");
  assert.equal(first.tick - arrived, 42);
  assert.equal(first.npc.getId(), 1856);
  h.ticks(f, 58);
  assert.equal(first.npc.getNpcTransformationId(), 1857, "bloomed");
  const tile = first.npc.getLocation();
  f.player.moveTo(new h.core.Location(tile.getX(), tile.getY() - 1, 0));
  h.tick(f);
  await h.dispatch(f, { type: "npc_option", index: first.npc.getIndex(), clickType: 1 });
  for (let i = 0; i < 6 && !f.player.getInventory().getAmount(I.STAR_FLOWER); i++) h.tick(f);
  assert.equal(f.player.getInventory().getAmount(I.STAR_FLOWER), 1);
  assert.ok(f.animations.some((a) => a.id === 832));
  h.ticks(f, 7);
  assert.equal(first.npc.isRegistered?.() ?? false, false, "gone six ticks after the pick");
  assert.equal(varbit(f, 2330), 0, "the plane and the pick leave 2330 (1962-2076)");
});

test("the Gorak plane: 2331 on arrival; a kill leaves the claws for the killer and sets 2382 (2094, 2206)", async (t) => {
  const f = actor(t, { stage: 70, at: [3020, 5330, 0] });
  f.player.moveTo(new h.core.Location(...GORAK_PLANE));
  h.tick(f);
  assert.equal(varbit(f, 2331), 1);
  const gorak = h.spawn(f, N.GORAK, [3045, 5333, 0]);
  h.PM.emitNpcDeath({ npc: gorak, npcId: gorak.getId(), killer: f.player, location: { x: 3045, y: 5333, z: 0 } });
  assert.equal(varbit(f, 2382), 1);
  const claws = h.core.ItemOnGroundManager.getGroundItem(f.player.getUsername(), I.GORAK_CLAWS, new h.core.Location(3045, 5333, 0), null);
  assert.ok(claws, "the killer's claws on the Gorak's tile");
});
