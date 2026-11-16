// Run after `yarn build`: node --test tests/jungle-potion-capture.test.cjs
//
// Jungle Potion against the user's whole-quest rsprox capture (JunglePotion, revision 242.1;
// docs/quests/jungle-potion/README.md). Real Player, PlayerSession and ClientConnection, the real
// plugins, cache and map: talks and clicks are packets, each tick runs as World.process does. Tick
// numbers are the capture's.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const TRUFITUS = [2809, 3086, 0];
const BY_TRUFITUS = [2809, 3085, 0];
const CAVE_ENTRANCE = [2824, 3118];
const BY_ENTRANCE = [2824, 3119, 0];
const CAVE_INSIDE = [2830, 9520, 0];
const CAVE_OUTSIDE = [2823, 3120, 0];
const CAVE_EXIT = [2830, 9522];
const BY_EXIT = [2830, 9521, 0];
const WALL = [2831, 9500];
const BY_WALL = [2832, 9500, 0];
const SECOND_WALL = [2829, 9493];
const BY_SECOND_WALL = [2829, 9494, 0];
const KEY = "jungle_potion";
const MESSAGEBOX = 229;
const OBJECTBOX = 193;
const VILLAGERS_VISIBLE = 887;

let I;
let O;
before(async () => {
  await h.setup([[2809, 3086], [2824, 3118], [2830, 9520], [2831, 9500]]);
  I = h.core.ItemIdentifiers;
  O = h.core.ObjectIdentifiers;
});
after(() => h.teardown());

const quest = () => h.quest(KEY);
const stage = (f) => quest().getStage(f.player);
const at = (f) => [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()];
const group = (f) => f.player.getPacketSender().getChatboxGroupId();
const messages = (f) => f.messages.map((m) => String(m.text));
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);

function actor(t, { stage: value = 0, items = [], at: tile = BY_TRUFITUS, ritual = true } = {}) {
  const f = h.actor(t, { at: tile, done: ritual ? ["druidic_ritual"] : [] });
  quest().setStage(f.player, value);
  for (const [id, count] of items) f.player.getInventory().add(new h.core.Item(id, count), false);
  return f;
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

async function talkTo(f) {
  const npc = h.spawn(f, h.core.NpcIdentifiers.TRUFITUS, TRUFITUS);
  await h.talk(f, npc);
  return npc;
}

async function offer(f) {
  await talkTo(f);
  await until(f, "What does Bwana mean?");
  await h.choose(f, "What does Bwana mean?");
  await until(f, "Yes, of course I do.");
  await h.choose(f, "Yes, of course I do.");
  await until(f, "A proposition eh? Sounds interesting!");
  await h.choose(f, "A proposition eh? Sounds interesting!");
  await until(f, "Me? How can I help?");
  await h.choose(f, "Me? How can I help?");
}

test("the offer plays the captured lines; the quest starts as the player continues past their acceptance (ticks 145-160)", async (t) => {
  const f = actor(t);
  await offer(f);
  await until(f, "I can only guide you so far");
  assert.equal(h.shown(f).text, "I can only guide you so far as the herbs are not easy to find. With some luck, you will find each herb in turn and bring it to me. I will then give you details of where to find the next herb.");
  await until(f, "Yes.|No.");
  assert.equal(MultiTitle(f), "Start the Jungle Potion quest?");
  await h.choose(f, "Yes.");
  await until(f, "It sounds like just the challenge for me.");
  assert.equal(stage(f), 0, "not started while the acceptance shows (tick 158)");
  assert.ok(!messages(f).some((m) => m.startsWith("You've started a new quest")));
  await h.continueLine(f);
  assert.equal(stage(f), 1, "started as it is continued (tick 160)");
  assert.equal(messages(f).filter((m) => m.startsWith("You've started a new quest: ")).length, 1);
  assert.match(messages(f).at(-1), /^You've started a new quest: <col=[0-9a-f]{6}>Jungle Potion<\/col>$/);
  await until(f, "That is excellent Bwana!");
  await until(f, "It grows near vines in an area to the south west where");
});

function MultiTitle(f) {
  return h.MultiChatboxPrompt.getPending(f.player)?.title;
}

test("turning the offer down plays 'Hmm, sounds difficult' and starts nothing (ticks 111-132)", async (t) => {
  const f = actor(t);
  await offer(f);
  await until(f, "Yes.|No.");
  await h.choose(f, "No.");
  await until(f, "Hmm, sounds difficult, I don't know if I am ready for the challenge.");
  await finish(f);
  assert.equal(stage(f), 0);
});

test("without Druidic Ritual, 'Yes.' refuses and the quest does not start", async (t) => {
  const f = actor(t, { ritual: false });
  await offer(f);
  await until(f, "Yes.|No.");
  await h.choose(f, "Yes.");
  h.ticks(f, 3);
  assert.equal(stage(f), 0);
  assert.ok(messages(f).includes("You must complete Druidic Ritual to start this quest."));
});

test("a hand-in is an item box with the clean herb, the herb consumed and the stage on (tick 327)", async (t) => {
  const f = actor(t, { stage: 2, items: [[I.SNAKE_WEED, 3]] });
  await talkTo(f);
  await until(f, "Of course!");
  await h.choose(f, "Of course!");
  await until(f, "You give the Snake Weed to Trufitus.");
  assert.equal(group(f), OBJECTBOX);
  assert.ok(f.calls.some((c) => c.name === "sendItemOnInterfaces" && c.args.includes(I.SNAKE_WEED)), "the snake weed in the box");
  assert.equal(stage(f), 3);
  assert.equal(f.player.getInventory().getAmount(I.SNAKE_WEED), 2);
  await until(f, "Great, you have the Snake Weed!");
});

test("the last hand-in: Rogue's purse box, the Herblore lesson in a message box, then the completion as it is continued (ticks 1118-1122)", async (t) => {
  const f = actor(t, { stage: 10, items: [[I.ROGUES_PURSE, 3]] });
  await talkTo(f);
  await until(f, "Of course!");
  await h.choose(f, "Of course!");
  await until(f, "You give the Rogue's Pursee to Trufitus.");
  assert.equal(group(f), OBJECTBOX);
  assert.ok(f.calls.some((c) => c.name === "sendItemOnInterfaces" && c.args.includes(I.ROGUES_PURSE)));
  assert.equal(stage(f), 11);
  await until(f, "Trufitus shows you some techniques in Herblore.");
  assert.equal(group(f), MESSAGEBOX, "a message box, not a chat line");
  assert.equal(stage(f), 11, "not complete while the lesson shows (tick 1121)");
  assert.equal(varbit(f, VILLAGERS_VISIBLE), 0);
  await h.continueLine(f);
  h.ticks(f, 3);
  assert.equal(stage(f), 12, "complete as the lesson is continued (tick 1122)");
  assert.ok(messages(f).some((m) => /^Congratulations, you've completed a quest: <col=[0-9a-f]{6}>Jungle Potion<\/col>$/.test(m)));
  assert.equal(varbit(f, VILLAGERS_VISIBLE), 1, "villagers_visible 0 -> 1 (tick 1122)");
  assert.ok(f.calls.some((c) => c.name === "sendItemOnInterfaces" && c.args.includes(I.MARRENTILL)), "the scroll shows marrentill");
});

test("his post-quest talk ends at the chief's title and moves varp 175 12 -> 13 as it is continued (ticks 1127-1131)", async (t) => {
  const f = actor(t, { stage: 12 });
  await talkTo(f);
  await until(f, "My greatest respects Bwana");
  await until(f, "You should deliver the good news to Bwana Timfraku");
  assert.equal(h.shown(f).text, "You should deliver the good news to Bwana Timfraku, Chief of Tai Bwo Wannai.");
  assert.equal(stage(f), 12);
  await h.continueLine(f);
  h.ticks(f, 2);
  assert.equal(stage(f), 13);
  assert.equal(quest().isComplete(f.player), true);
  assert.equal(f.player.getPacketSender().getConfig?.(175) ?? 13, 13);
  // Talking again keeps 13.
  await h.talk(f, f.npcs[0]);
  await until(f, "You should deliver the good news to Bwana Timfraku");
  await finish(f);
  assert.equal(stage(f), 13);
});

test("villagers_visible is sent at login from the completion", async (t) => {
  const done = actor(t, { stage: 13 });
  h.PM.emitPlayerLogin({ player: done.player, username: done.player.getUsername() });
  assert.equal(varbit(done, VILLAGERS_VISIBLE), 1);
  const started = actor(t, { stage: 5 });
  h.PM.emitPlayerLogin({ player: started.player, username: started.player.getUsername() });
  assert.equal(varbit(started, VILLAGERS_VISIBLE), 0);
});

test("Pothole Cave rocks: the find and 'stay' are message boxes and nothing moves (ticks 942-947)", async (t) => {
  const f = actor(t, { stage: 9, at: BY_ENTRANCE });
  await h.clickObject(f, O.ROCKS_4, CAVE_ENTRANCE, 2);
  await until(f, "You search the rocks... You find an entrance into some caves.");
  assert.equal(group(f), MESSAGEBOX);
  await until(f, "No thanks, I'll give it a miss.");
  assert.equal(MultiTitle(f), "Would you like to enter the caves?");
  await h.choose(f, "No thanks, I'll give it a miss.");
  await until(f, "You decide to stay where you are!");
  assert.equal(group(f), MESSAGEBOX);
  await finish(f);
  assert.deepEqual(at(f), BY_ENTRANCE);
});

test("Pothole Cave rocks: entering is a message box, and the climb down comes as it is continued (ticks 948-951)", async (t) => {
  const f = actor(t, { stage: 9, at: BY_ENTRANCE });
  await h.clickObject(f, O.ROCKS_4, CAVE_ENTRANCE, 2);
  await until(f, "Yes, I'll enter the cave.");
  await h.choose(f, "Yes, I'll enter the cave.");
  await until(f, "You decide to enter the caves. You climb down several steep rock faces into the cavern below.");
  assert.equal(group(f), MESSAGEBOX);
  assert.deepEqual(at(f), BY_ENTRANCE, "still outside while the box shows");
  await h.continueLine(f);
  h.ticks(f, 2);
  assert.deepEqual(at(f), CAVE_INSIDE);
});

test("the hand holds out: a message box, then out of the cave as it is continued (ticks 1046-1050)", async (t) => {
  const f = actor(t, { stage: 10, at: BY_EXIT });
  await h.clickObject(f, O.HAND_HOLDS, CAVE_EXIT, 1);
  await until(f, "You attempt to climb the rocks back out.");
  assert.equal(group(f), MESSAGEBOX);
  assert.equal(at(f)[1] > 9000, true, "still inside while the box shows");
  assert.ok(!messages(f).includes("You climb the rocks back out of the cave."));
  await h.continueLine(f);
  assert.equal(at(f)[1] > 9000, true, "the tick it is continued, still inside (tick 1049)");
  h.tick(f);
  assert.deepEqual(at(f), CAVE_OUTSIDE, "out the tick after (tick 1050)");
});

// Only the Jungle Potion plugin's rolls are fixed: other tasks call Math.random while these tests tick.
function mockRolls(t, rolls) {
  const real = Math.random;
  t.mock.method(Math, "random", () => {
    if (!String(new Error().stack).includes("JunglePotion.Quest.js")) return real();
    return rolls.shift() ?? 0;
  });
}

test("fungus wall: a fresh search resets the animation with search_vine twice, a roll every 6 ticks; a miss plays middle + the sound, the find the end and no sound (ticks 989-1002)", async (t) => {
  const f = actor(t, { stage: 9, at: BY_WALL });
  mockRolls(t, [0.9, 0.1]);
  const sounds = () => f.calls.filter((c) => c.name === "sendSoundEffect").map((c) => [c.tick, c.args[0]]);
  await h.dispatch(f, { type: "object_option", id: O.FUNGUS_COVERED_CAVERN_WALL, x: WALL[0], y: WALL[1], clickType: 2 });
  for (let i = 0; i < 5 && !f.messages.some((m) => m.text === "You search the wall..."); i++) h.tick(f);
  const start = f.messages.find((m) => m.text === "You search the wall...").tick;
  assert.deepEqual(f.animations.map((a) => a.id), [-1]);
  assert.deepEqual(sounds().map(([, id]) => id), [1957, 1957]);
  for (let i = 0; i < 14 && !h.shown(f); i++) h.tick(f);
  const anims = f.animations.map((a) => [a.tick - start, a.id]);
  assert.deepEqual(anims, [[0, -1], [6, 2097], [12, 2098]]);
  assert.deepEqual(sounds().map(([tick, id]) => [tick - start, id]), [[0, 1957], [0, 1957], [6, 1957]]);
  assert.equal(h.shown(f).text, "You find a herb.");
  assert.equal(group(f), OBJECTBOX);
  assert.equal(f.player.getInventory().getAmount(I.GRIMY_ROGUES_PURSE), 1);
  assert.equal(stage(f), 10);
  const { MapObjects, Location } = h.core;
  assert.ok(MapObjects.get(O.FUNGUS_PATTERN, new Location(WALL[0], WALL[1], 0), null), "the wall empties");
});

test("fungus wall: a re-click mid-search restarts it with pick_wall start and one search_vine (ticks 973-982)", async (t) => {
  const f = actor(t, { stage: 9, at: BY_SECOND_WALL });
  mockRolls(t, [0.1]);
  const click = () => h.dispatch(f, { type: "object_option", id: O.FUNGUS_COVERED_CAVERN_WALL, x: SECOND_WALL[0], y: SECOND_WALL[1], clickType: 2 });
  await click();
  for (let i = 0; i < 5 && !f.messages.some((m) => m.text === "You search the wall..."); i++) h.tick(f);
  h.ticks(f, 2);
  const animations = f.animations.length;
  const soundCount = f.calls.filter((c) => c.name === "sendSoundEffect").length;
  await click();
  for (let i = 0; i < 5 && f.messages.filter((m) => m.text === "You search the wall...").length < 2; i++) h.tick(f);
  assert.deepEqual(f.animations.slice(animations).map((a) => a.id), [2096]);
  assert.equal(f.calls.filter((c) => c.name === "sendSoundEffect").length - soundCount, 1);
  for (let i = 0; i < 8 && !h.shown(f); i++) h.tick(f);
  assert.equal(h.shown(f)?.text, "You find a herb.");
  assert.equal(f.animations.at(-1).id, 2098);
});
