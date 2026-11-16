// Run after `yarn build`: node --test tests/tree-gnome-village-capture.test.cjs
//
// Tree Gnome Village against the user's whole-quest rsprox captures (local 1001802, with 1001800 and 1002235;
// revision 242; docs/quests/tree-gnome-village/README.md). Real Player, PlayerSession and ClientConnection, the
// real plugins, cache and map: talks and clicks are packets, each tick runs as World.process does.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const h = require("./quest-capture-harness.cjs");

const KEY = "tree_gnome_village";
const BOLREN = [2542, 3169, 0];
const BY_BOLREN = [2541, 3169, 0];
const MONTAI = [2523, 3211, 0];
const BY_MONTAI = [2522, 3211, 0];
const TRACKER_3 = [2496, 3235, 0];
const BY_TRACKER_3 = [2497, 3235, 0];
const BALLISTA = [2508, 3210];
const BY_BALLISTA = [2510, 3212, 0];
const ELKOY_OUTSIDE = [2504, 3191, 0];
const BY_ELKOY = [2504, 3192, 0];
const CHANTERS = [[2541, 3168], [2541, 3171], [2542, 3167], [2542, 3172]];
const MESSAGEBOX = 229;
const OBJECTBOX = 193;
const ORBS_VARBIT = 598;
const TRACKER_X_VARBIT = 601;

let I;
let N;
before(async () => {
  h.key = KEY;
  await h.setup([[2542, 3169], [2523, 3211], [2496, 3235], [2508, 3210], [2504, 3191], [2509, 3253]]);
  I = h.core.ItemIdentifiers;
  N = h.core.NpcIdentifiers;
});
after(() => h.teardown());

const quest = () => h.quest(KEY);
const stage = (f) => quest().getStage(f.player);
const at = (f) => [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()];
const group = (f) => f.player.getPacketSender().getChatboxGroupId();
const messages = (f) => f.messages.map((m) => String(m.text));
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);

function actor(t, { stage: value = 0, items = [], tile = BY_BOLREN, attributes = {} } = {}) {
  const f = h.actor(t, { at: tile, done: [], attributes });
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

/** Ticks until `text` shows, without continuing anything. */
function waitFor(f, text, limit = 20) {
  for (let i = 0; i < limit; i++) {
    if (h.shown(f)?.text?.startsWith(text)) return f.tick;
    h.tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

test("the quest starts as 'I would be glad to help.' is continued, and Elkoy guides the player out (t914-942)", async (t) => {
  const f = actor(t);
  const bolren = h.spawn(f, N.KING_BOLREN, BOLREN);
  await h.talk(f, bolren);
  await until(f, "Can I help at all?");
  await h.choose(f, "Can I help at all?");
  await until(f, "Yes.");
  await h.choose(f, "Yes.");
  assert.equal(h.shown(f).text, "I would be glad to help.");
  assert.equal(stage(f), 0, "picking Yes. does not start it");
  await h.continueLine(f);
  assert.equal(stage(f), 1);
  assert.ok(messages(f).some((text) => text.startsWith("You've started a new quest")));
  await until(f, "My assistant shall guide you out.");
  await h.continueLine(f);
  const box = f.tick;
  assert.equal(group(f), MESSAGEBOX, "the guide box, held without a continue, over the fade");
  assert.ok(f.calls.some((c) => c.tick === box && c.name === "sendString" && String(c.args[0]).startsWith("Elkoy guides you out of the maze.")));
  h.ticks(f, 2);
  assert.notDeepEqual(at(f), [2504, 3191, 0], "still in the village while the screen is dark");
  h.tick(f);
  assert.deepEqual(at(f), [2504, 3191, 0], "moved 3 ticks after the box (t938 -> t941)");
  assert.equal(waitFor(f, "We're out of the maze now.") - box, 4, "Elkoy's line as the screen comes back (t942)");
});

test("Montai takes the logs as the player's line shows, with no game message, and the quest moves on as lines are continued", async (t) => {
  const f = actor(t, { stage: 1, tile: BY_MONTAI, items: [[1511, 6]] });
  const montai = h.spawn(f, N.COMMANDER_MONTAI, MONTAI);
  quest().setStage(f.player, 2);
  await h.talk(f, montai);
  await until(f, "I have some here.");
  assert.equal(f.player.getInventory().getAmount(1511), 0, "the logs go as the line shows (t1081)");
  assert.equal(stage(f), 3);
  assert.ok(!messages(f).some((text) => text.startsWith("You give six loads")));
  await until(f, "That's excellent");
  await h.continueLine(f);
  for (let i = 0; i < 4 && h.shown(f); i++) h.tick(f);
  await h.talk(f, montai);
  await until(f, "I'll try my best.");
  await h.choose(f, "I'll try my best.");
  await until(f, "Thank you, you're braver than most.");
  assert.equal(stage(f), 3, "not yet");
  await h.continueLine(f);
  assert.equal(stage(f), 4, "as 'Thank you, you're braver than most.' is continued (t1186)");
});

test("tracker gnome 3's flag is set as his talk opens, and his boxes are message boxes (t1364-1415)", async (t) => {
  const f = actor(t, { stage: 4, tile: BY_TRACKER_3, attributes: { "tree-gnome-village:ballista-coordinate": 1 } });
  const tracker = h.spawn(f, N.TRACKER_GNOME_3, TRACKER_3);
  await h.talk(f, tracker);
  assert.equal(h.shown(f).text, "Are you OK?");
  assert.equal(varbit(f, TRACKER_X_VARBIT), 1);
  await until(f, "He's clearly lost the plot.");
  assert.equal(group(f), MESSAGEBOX);
  assert.ok(!f.messages.some((m) => m.type === undefined && String(m.text).startsWith("He's clearly")), "a box, not a game message");
});

test("the ballista fires as the coordinate box is continued; the hit box opens 2 ticks later, the breach on its continue (t1458-1478)", async (t) => {
  const f = actor(t, { stage: 4, tile: BY_BALLISTA, attributes: { "tree-gnome-village:trackers": 7, "tree-gnome-village:ballista-coordinate": 1 } });
  await h.clickObject(f, 2181, BALLISTA, 2);
  await until(f, "0002");
  await h.choose(f, "0002");
  assert.ok(h.shown(f).text.startsWith("You enter the height and y coordinates"));
  assert.equal(group(f), MESSAGEBOX);
  const sounds = () => f.calls.filter((c) => c.name === "sendSoundEffect").map((c) => c.args[0]);
  assert.deepEqual(sounds(), []);
  await h.continueLine(f);
  const launched = f.tick;
  assert.deepEqual(sounds(), [3488], "treevillage_catabow_launch with the launch");
  const hit = waitFor(f, "The huge spear flies through the air");
  assert.equal(hit - launched, 2);
  assert.deepEqual(sounds(), [3488, 3487], "treevillage_catabow_hit as the hit box opens");
  assert.equal(group(f), MESSAGEBOX);
  assert.equal(stage(f), 4);
  await h.continueLine(f);
  assert.equal(stage(f), 5);
});

test("Follow on Elkoy plays the guide box, the walk and his line for the stage (t1639-1644)", async (t) => {
  const f = actor(t, { stage: 6, tile: BY_ELKOY, items: [[I.ORB_OF_PROTECTION, 1]] });
  const elkoy = h.spawn(f, 6265, ELKOY_OUTSIDE);
  for (let i = 0; i < 10 && f.player.busy(); i++) h.tick(f);
  await f.connection.dispatch([{ type: "npc_option", index: elkoy.getIndex(), clickType: 3 }]);
  for (let i = 0; i < 10 && group(f) !== MESSAGEBOX; i++) h.tick(f);
  const box = f.tick;
  assert.equal(group(f), MESSAGEBOX);
  assert.ok(f.calls.some((c) => c.name === "sendString" && String(c.args[0]).startsWith("Elkoy guides you through the maze.")));
  h.ticks(f, 3);
  assert.deepEqual(at(f), [2515, 3159, 0]);
  assert.equal(waitFor(f, "Here we are. Take the orb to King Bolren") - box, 4);
});

test("Bolren takes the first orb as 'You are brave...' is continued; bolren_got_orbs stays 0 (t1736-1750)", async (t) => {
  const f = actor(t, { stage: 6, items: [[I.ORB_OF_PROTECTION, 1]] });
  const bolren = h.spawn(f, N.KING_BOLREN, BOLREN);
  await h.talk(f, bolren);
  await until(f, "I will find the warlord and bring back the orbs.");
  await h.choose(f, "I will find the warlord and bring back the orbs.");
  await until(f, "You are brave, but this task");
  assert.equal(f.player.getInventory().getAmount(I.ORB_OF_PROTECTION), 1);
  await h.continueLine(f);
  assert.equal(f.player.getInventory().getAmount(I.ORB_OF_PROTECTION), 0);
  assert.equal(stage(f), 7);
  assert.equal(varbit(f, ORBS_VARBIT), 0);
});

test("the ceremony: Bolren takes the orbs at the chant box, the gnomes chant, the tree takes them, the scroll's lines (t2257-2320)", async (t) => {
  const f = actor(t, { stage: 8, items: [[I.ORBS_OF_PROTECTION, 1]] });
  const bolren = h.spawn(f, N.KING_BOLREN, BOLREN);
  const chanters = CHANTERS.map(([x, y]) => h.spawn(f, N.LOCAL_GNOME_2, [x, y, 0]));
  const said = [];
  for (const npc of chanters) {
    const say = npc.forceChat.bind(npc);
    npc.forceChat = (text) => { said.push({ tick: f.tick, y: npc.getLocation().getY(), text }); return say(text); };
  }
  // The harness runs no NPC updating; these are the NPCs the player's client has (Bolren and his chanters).
  f.player.getLocalNpcs = () => [bolren, ...chanters];
  await h.talk(f, bolren);
  const chant = await until(f, "The gnomes begin to chant.");
  assert.equal(group(f), MESSAGEBOX);
  assert.equal(f.player.getInventory().getAmount(I.ORBS_OF_PROTECTION), 0, "he takes them as the box opens");
  assert.equal(varbit(f, ORBS_VARBIT), 1);
  await h.continueLine(f);
  const rest = waitFor(f, "The orbs of protection come to rest", 30);
  assert.deepEqual(said.map((s) => s.text), ["Su tana.", "Su tana.", "En tania.", "En tania.", "Su tana.", "Su tana.", "En tania.", "En tania."]);
  for (const s of said) assert.equal(s.text === "Su tana.", s.y > 3169, "the northern pair says Su tana.");
  const first = said[0].tick;
  assert.deepEqual([...new Set(said.map((s) => s.tick - first))], [0, 2, 4, 6], "every 2 ticks");
  assert.equal(rest - first, 15, "the box 15 ticks after the first chant (t2263 -> t2278)");
  assert.equal(varbit(f, ORBS_VARBIT), 2);
  assert.equal(group(f), MESSAGEBOX);
  assert.ok(chant < first);
  await until(f, "The tree has many other powers");
  await h.continueLine(f);
  assert.equal(stage(f), 9);
  assert.equal(f.player.getInventory().getAmount(I.GNOME_AMULET), 1);
  assert.deepEqual(h.QuestRuntime.rewardLines(quest()).slice(1), ["2 Quest Points", "11,450 Attack XP", "Spirit Tree Access", "A Gnome Amulet"]);
});

test("the warlord's death shows the orbs in an object box (t2068)", async (t) => {
  const f = actor(t, { stage: 7 });
  h.QuestRuntime.startTranscript({ ...h.PM.createApi("tgv-capture"), core: h.core }, f.player, 7622, "Tree Gnome Village", "the-khazard-warlord-when-defeated");
  for (let i = 0; i < 5 && !h.shown(f); i++) h.tick(f);
  assert.ok(h.shown(f).text.startsWith("As the warlord falls to the ground"));
  assert.equal(group(f), OBJECTBOX);
});

test("over the crumbled wall, the commander shouts 2 ticks after the climb and comes for the player once they land (t1524-1526)", async (t) => {
  const f = actor(t, { stage: 5, tile: [2509, 3252, 0] });
  const commander = h.spawn(f, N.KHAZARD_COMMANDER, [2508, 3255, 0]);
  const shouts = [];
  const say = commander.forceChat.bind(commander);
  commander.forceChat = (text) => { shouts.push({ tick: f.tick, text }); return say(text); };
  f.player.getLocalNpcs = () => [commander];
  await h.clickObject(f, 2185, [2509, 3253]);
  assert.ok(h.shown(f).text.startsWith("The wall has been reduced to rubble."));
  await h.continueLine(f);
  const climbed = f.tick;
  assert.equal(commander.getCombat().getTarget(), null);
  h.ticks(f, 2);
  assert.deepEqual(at(f), [2509, 3254, 0]);
  assert.equal(commander.getCombat().getTarget(), null);
  h.tick(f);
  assert.equal(commander.getCombat().getTarget(), f.player, "he comes for the player the tick after they land (live: 2 ticks earlier)");
  assert.deepEqual(shouts, [{ tick: climbed + 2, text: "Don't even think of taking the orb!" }]);
});

test("the chest's \"Oi! You!\" is not said with no commander left, and the orb's box shows (t1567)", async (t) => {
  const f = actor(t, { stage: 5, tile: [2506, 3258, 1] });
  f.player.getLocalNpcs = () => [];
  h.QuestRuntime.startTranscript({ ...h.PM.createApi("tgv-capture"), core: h.core }, f.player, N.KHAZARD_COMMANDER, "Tree Gnome Village",
    "into-the-stronghold-upon-opening-the-chest-containing-the-orb-of-protection");
  for (let i = 0; i < 5 && !h.shown(f); i++) h.tick(f);
  assert.equal(h.shown(f).text, "You search the chest. Inside you find the gnomes' stolen orb of protection.");
  assert.equal(group(f), MESSAGEBOX);
  assert.ok(!messages(f).some((text) => text.includes("Oi! You!")));
  assert.equal(stage(f), 6);
  assert.equal(f.player.getInventory().getAmount(I.ORB_OF_PROTECTION), 1);
});
