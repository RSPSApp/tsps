// Run after `yarn build`: node --test tests/corsair-curse-capture.test.cjs
//
// The Corsair Curse against one whole run of the quest on live (rsprox capture local 1001340,
// rev 240.1; docs/quests/the-corsair-curse/README.md):
// - the journal is the capture's, line for line, at each of the 13 times it was opened;
// - Colin's and Gnocci's flashbacks, the telescope view and the fire play at the capture's ticks: the
//   held lines, the line after each click, the cutscene state, the actors and where the player ends;
// - the dug-up doll runs its path and is gone eleven ticks after the dig;
// - climbing Ithoi's stairs at the kill order enters the fight's copy; his death ends it two ticks later.
// Real engine: every plugin loaded, real Players and NPCs, the tick tasks running. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { World } = require("../dist/game/World");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { buildLines } = require("../plugins/quests/corsaircurse/Journal.CorsairCurse");
const JOURNAL = require("./fixtures/corsair-curse-journal.json");

const PAGE = "The Corsair Curse";
const STAGE_INVESTIGATING = 3;
const STAGE_CONFESSED = 6;
const STAGE_PROVED = 7;
const STAGE_KILL_ORDER = 8;
const STAGE_KILLED = 9;
const VARBIT_PROGRESS = 6071;
const VARBIT_CABINBOY = 6072;
const VARBIT_COOK = 6073;
const CUTSCENE_STATUS = 542;
const CHAT_TEXT = new Set([(231 << 16) | 6, (217 << 16) | 6, (229 << 16) | 3]);
const CONTINUE = new Set([(231 << 16) | 5, (217 << 16) | 5]);
const TELESCOPE_OVERLAY = 386;
const DOLL_SCRIPT = 2085;

let core, api, quest;
let index = 7300;
let now = 0;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[2528, 2840], [2504, 2840], [2556, 2858], [2528, 2816], [2918, 3231], [3030, 3272]]) {
    core.RegionManager.loadMapFiles(x, y);
  }
  PluginManager.emitServerStartup({});
  api = PluginManager.createApi("CorsairCurseCaptureTest");
  quest = QuestRuntime.getRegisteredQuests().find(({ key }) => key === "the_corsair_curse");
  assert.ok(quest);
});

function actor(t, stage, [x, y, z = 0], attributes = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++);
  player.setUsername("corsaircap" + player.getIndex());
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(x, y, z));
  player.setNeedsPlacement(false);
  const sender = player.getPacketSender();
  const log = { lines: [], continues: [], varbits: [], scripts: [], subs: [], anims: [] };
  const sendString = sender.sendString.bind(sender);
  sender.sendString = (text, uid, ...rest) => {
    if (CHAT_TEXT.has(uid) && text) log.lines.push({ tick: now, text: String(text).replace(/<br>/g, " ") });
    if (CONTINUE.has(uid)) log.continues.push({ tick: now, text });
    return sendString(text, uid, ...rest);
  };
  const sendVarbit = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (id, value) => { log.varbits.push({ tick: now, id, value }); return sendVarbit(id, value); };
  const sendClientScript = sender.sendClientScript.bind(sender);
  sender.sendClientScript = (id, ...args) => { log.scripts.push({ tick: now, id }); return sendClientScript(id, ...args); };
  const sendSubInterface = sender.mountSubInterface.bind(sender);
  sender.mountSubInterface = (uid, id, ...args) => { log.subs.push({ tick: now, uid, id }); return sendSubInterface(uid, id, ...args); };
  const animate = player.performAnimation.bind(player);
  player.performAnimation = (animation) => { log.anims.push({ tick: now, id: animation.getId() }); return animate(animation); };
  quest.setStage(player, stage);
  for (const [key, value] of Object.entries(attributes)) player.setAttribute(key, value);
  players.push(player);
  t.after(() => {
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player);
    players.splice(players.indexOf(player), 1);
  });
  player.log = log;
  return player;
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    now++;
    for (const player of players) player.getMovementQueue().process();
    core.TaskManager.process();
    World.getAddNPCQueue().splice(0).forEach((npc) => World.getNpcs().add(npc));
    for (const npc of World.getNpcs()) npc?.getMovementQueue?.().process?.();
    for (const player of players) player.resetUpdating();
  }
}

const current = (player) => player.getDialogueManager().getCurrent();
/** A line the player can continue: a chat entry, not a held action. */
const continuable = (player) => {
  const entry = current(player);
  return !!entry && typeof entry.getText === "function" && entry.isSelfAdvancing?.() !== true;
};
const text = (player) => current(player)?.getText?.() ?? null;
/** The chat line last sent, held or not. */
const sent = (player) => player.log.lines.at(-1)?.text ?? null;
const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const varbitAt = (player, id) => player.log.varbits.filter((entry) => entry.id === id);
const owned = (player, id) => [...World.getNpcs()].find((npc) => npc?.isRegistered?.() && npc.getOwner?.() === player
  && (npc.getId() === id || npc.getNpcTransformationId?.() === id)) ?? null;

/** The steps from the line starting `prefix` on, wherever the variant has it. */
function from(prefix) {
  return (steps) => {
    const search = (list) => {
      for (let i = 0; i < list.length; i++) {
        const step = list[i];
        const words = typeof step.player === "string" ? step.player : step.text;
        if (typeof words === "string" && words.startsWith(prefix)) return list.slice(i);
        for (const nested of [step.steps, ...(step.options ?? []).map((option) => option.steps)]) {
          const found = Array.isArray(nested) ? search(nested) : null;
          if (found) return found;
        }
      }
      return null;
    };
    return search(steps);
  };
}

/**
 * Continues every line as soon as it can be continued; returns [text, ticks after the previous click]
 * for each chat line sent (held or not), the first counted from `since`.
 */
function playThrough(player, since = 0, limit = 400) {
  let clicked = since, seen = player.log.lines.length;
  const shows = [];
  const record = () => {
    for (const line of player.log.lines.slice(seen)) shows.push([line.text, line.tick - clicked]);
    seen = player.log.lines.length;
  };
  for (let i = 0; i < limit; i++) {
    tick();
    record();
    if (!current(player)) break;
    if (continuable(player)) {
      clicked = now;
      player.getDialogueManager().advance();
      record();
    }
  }
  return shows;
}

function journalText(line) {
  const blue = "<col=000080>";
  const text = String(line ?? "");
  if (!text || text.startsWith("<str>") || text.includes("<col=ff0000>")) return text;
  return (text.startsWith(blue) ? "" : blue) + text.replace(/<\/col>/g, blue);
}

const normal = (line) => line.replace(/^<col=000080>(?=<col=)/, "");

test("the journal is the capture's, line for line, at all 13 times it was opened", () => {
  for (const { tick: at, state, lines } of JOURNAL.snapshots) {
    const built = buildLines(state).map(journalText).map(normal);
    assert.deepEqual(built, lines.map(normal), `journal at capture tick ${at}`);
  }
  assert.match(buildLines({ progress: 0 })[0], /^I can start this quest by talking to <col=800000>Captain Tock<\/col> north of/);
});

test("the transcript carries the four lines live sends that the Wiki lacks", () => {
  const record = QuestRuntime.loadTranscripts(api)[PAGE];
  const all = JSON.stringify(record);
  assert.equal(record.variants["the-cursed-crew-talking-to-captain-tock"][0].text, "Ahoy, young [lad/lass].");
  assert.ok(all.includes('"player":"Arsen says he\'s very sorry for stealing from you. Here it is..."'));
  assert.ok(all.includes("He skinny man who climb down vine the other day, yah?"));
  assert.ok(all.includes('"text":"What?"'));
  assert.ok(all.includes("Besides, if ye be sayin' I poisoned my crew"));
});

test("Colin's mermaid: held lead-in, cutscene at +2, Colin at the telescope, each line on the capture's tick", (t) => {
  const player = actor(t, STAGE_INVESTIGATING, [2557, 2858, 1]);
  now = 0;
  QuestRuntime.startTranscript(api, player, 7968, PAGE, "colin-s-curse-talking-to-colin", from("I was using Ithoi's telescope"));
  assert.equal(sent(player), "I was using Ithoi's telescope...");
  assert.equal(continuable(player), false, "the lead-in line is held");
  tick(2);
  assert.deepEqual(varbitAt(player, CUTSCENE_STATUS).at(-1), { tick: 2, id: CUTSCENE_STATUS, value: 1 });
  const colin = owned(player, 7965);
  assert.ok(colin, "Colin (7965) stands at the telescope for the owner");
  assert.ok(player.getLocation().getX() > 6400, "the player is in a copy of the cove");
  const shows = playThrough(player);
  const expect = [
    ["Such a beautiful night!", 5], ["What lands lie beyond the dim horizon, I wonder...", 2], ["Eh?", 3],
    ["What was that? I'd better have another look.", 1], ["Is that what I think it is?", 3],
    ["It's so dark out there, but I think... ... yes, I'm quite sure...", 1], ["... yes, it's a mermaid! She's beautiful!", 2],
    ["Hello?", 2], ["Can you hear me?", 2], ["You're the most lovely person I've ever seen!", 2],
    ["I can see you moving your arms, but it's very dark. Are you waving to me?", 5], ["<col=0000ff>*kiss*</col>", 6],
    ["Hello?", 4], ["Oh, no, I think she's gone away. Did I put her off?", 6],
    ["Maybe she doesn't like strangers shouting about her appearance and blowing kisses at her. That might have been rude of me.", 0],
    ["I hope she's not angry. Ithoi says mermaids can be dangerous.", 0],
    ["Perhaps you can find the mermaid and tell her I'm very sorry I was rude to her. Then maybe she'll lift the curse.", 3],
  ];
  assert.deepEqual(shows.slice(0, expect.length), expect);
  assert.deepEqual(at(player), [2557, 2858, 1], "back where the conversation started");
  assert.equal(varbitAt(player, VARBIT_CABINBOY).at(-1).value, 1);
  assert.equal(varbitAt(player, CUTSCENE_STATUS).at(-1).value, 0);
  assert.equal(owned(player, 7965), null, "Colin's copy is gone");
});

test("Colin flashback: native interface close restores the cove and cancels pending credit", async (t) => {
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const player = actor(t, STAGE_INVESTIGATING, [2557, 2858, 1]);
  QuestRuntime.startTranscript(api, player, 7968, PAGE, "colin-s-curse-talking-to-colin", from("I was using Ithoi's telescope"));
  tick(5);
  assert.equal(text(player), "Such a beautiful night!");
  assert.equal(player.getMovementQueue().isMovementBlocked(), true);
  const connection = new ClientConnection(player.getSession().getChannel());
  connection.player = player;
  await connection.dispatch([{ type: "interface_close" }]);
  connection.processTurnPackets();
  tick(30);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.deepEqual(at(player), [2557, 2858, 1]);
  assert.equal((player.getAttribute("quest.the_corsair_curse.cabinboy") ?? 0), 0);
  assert.equal(player.getAttribute("corsair-curse:scene-exit"), null);
  assert.equal(owned(player, 7965), null);
  assert.equal(varbitAt(player, CUTSCENE_STATUS).at(-1).value, 0);
  assert.equal(current(player), undefined);
});

test("Colin flashback: same-group replacement during a delayed line survives stale scene callbacks", (t) => {
  const player = actor(t, STAGE_INVESTIGATING, [2557, 2858, 1]);
  QuestRuntime.startTranscript(api, player, 7968, PAGE, "colin-s-curse-talking-to-colin", from("I was using Ithoi's telescope"));
  tick(5);
  player.getDialogueManager().advance();
  // Replace the empty statement group with the same group: no interface:closed event.
  const replacement = new core.DialogueChainBuilder().add(new core.StatementDialogue(0, "Replacement conversation"));
  const owner = {};
  player.getDialogueManager().startDialogues(replacement, owner);
  const mount = player.getPacketSender().getSubInterfaceAt((162 << 16) | 568);
  tick(35);
  assert.equal(text(player), "Replacement conversation");
  assert.equal(player.getDialogueManager().getOwner(), owner);
  assert.equal(player.getPacketSender().getSubInterfaceAt((162 << 16) | 568), mount);
  assert.deepEqual(at(player), [2557, 2858, 1]);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(player.getAttribute("quest.the_corsair_curse.cabinboy") ?? 0, 0);
  assert.equal(owned(player, 7965), null);
});

test("Colin flashback: closing the held lead-in cancels opening, then a fresh replay completes", (t) => {
  const player = actor(t, STAGE_INVESTIGATING, [2557, 2858, 1]);
  const start = () => QuestRuntime.startTranscript(api, player, 7968, PAGE, "colin-s-curse-talking-to-colin", from("I was using Ithoi's telescope"));
  start();
  player.getPacketSender().sendInterfaceRemoval();
  tick(8);
  assert.deepEqual(at(player), [2557, 2858, 1]);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(owned(player, 7965), null);
  start();
  tick(2);
  assert.ok(owned(player, 7965));
  playThrough(player, now);
  assert.equal(player.getAttribute("quest.the_corsair_curse.cabinboy"), 1);
  assert.deepEqual(at(player), [2557, 2858, 1]);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
});

test("Colin flashback: a replacement on the exact timer turn is never overwritten", (t) => {
  const player = actor(t, STAGE_INVESTIGATING, [2557, 2858, 1]);
  QuestRuntime.startTranscript(api, player, 7968, PAGE, "colin-s-curse-talking-to-colin", from("I was using Ithoi's telescope"));
  tick(5);
  player.getDialogueManager().advance();
  tick(1);
  const replacement = new core.DialogueChainBuilder().add(new core.NpcDialogue(0, 7968, "New NPC conversation", "Colin"));
  player.getDialogueManager().startDialogues(replacement);
  const mount = player.getPacketSender().getSubInterfaceAt((162 << 16) | 568);
  tick(1);
  assert.equal(text(player), "New NPC conversation");
  assert.equal(player.getPacketSender().getSubInterfaceAt((162 << 16) | 568), mount);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  tick(30);
  assert.equal(text(player), "New NPC conversation");
  assert.equal(player.getAttribute("quest.the_corsair_curse.cabinboy") ?? 0, 0);
});

test("Colin flashback: a real scene-area leave cancels credit and never returns an external move", (t) => {
  const player = actor(t, STAGE_INVESTIGATING, [2557, 2858, 1]);
  QuestRuntime.startTranscript(api, player, 7968, PAGE, "colin-s-curse-talking-to-colin", from("I was using Ithoi's telescope"));
  tick(5);
  const instance = player.getArea();
  player.moveTo(new core.Location(3222, 3218, 0));
  instance.leave(player, false);
  tick(35);
  assert.deepEqual(at(player), [3222, 3218, 0]);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false);
  assert.equal(owned(player, 7965), null);
  assert.equal(player.getAttribute("quest.the_corsair_curse.cabinboy") ?? 0, 0);
});

test("Gnocci's doll: the cache's doll script after the scream, Gnocci buries it and runs east, cook 1 at the last line", (t) => {
  const player = actor(t, STAGE_INVESTIGATING, [2546, 2862, 1]);
  now = 0;
  QuestRuntime.startTranscript(api, player, 7973, PAGE, "gnocci-s-curse-talking-to-gnocci", from("I was fishing..."));
  tick(2);
  assert.ok(owned(player, 7971), "Gnocci fishing (7971) for the owner");
  const shows = playThrough(player);
  const expect = [
    ["Let's see what I can find for the boys tonight.", 5], ["C'mon little lobsters, come to Gnocci!", 5],
    ["Obby-lobby obby-lobby oi oi oi!", 0], ["'obby-lobby' - what?", 2],
    ["It's a traditional lobster-fishing chant handed down by my ancestors. Don't interrupt.", 0],
    ["C'mon little lobsters. We don't want to keep the Captain waiting! He'll get angry with me again.", 1],
    ["Ooh, what's this? This isn't a lobster.", 2], ["Looks more like a child's toy. But - no, it can't be...", 2],
    ["Is it moving?", 0], ["She's moving! SHE'S POSSESSED! HELP!", 0],
    ["I buried Her in the sand, by that tree, to the west. But I still feel Her eyes staring into my soul. Please find Her, and kill the demon inside!", 13],
  ];
  assert.deepEqual(shows.slice(0, expect.length), expect);
  const scream = player.log.lines.find((line) => line.text.startsWith("She's moving!")).tick;
  assert.deepEqual(player.log.scripts.filter((entry) => entry.id === DOLL_SCRIPT).map((entry) => entry.tick), [scream + 2]);
  assert.equal(varbitAt(player, VARBIT_COOK).at(-1).value, 1);
  assert.equal(player.log.lines.at(-1).tick - scream, 18, "the line again, continued, five ticks after the burial line");
  assert.ok(!player.log.anims.some((entry) => entry.id === 830), "the player never digs in Gnocci's flashback");
  assert.deepEqual(at(player), [2546, 2862, 1]);
});

test("the telescope: the lens five ticks after the click, Bugs in the sea, cabinboy 2 with the line at +23", (t) => {
  const player = actor(t, STAGE_INVESTIGATING, [2528, 2836, 1], { "quest.the_corsair_curse.cabinboy": 1 });
  now = 0;
  QuestRuntime.startTranscript(api, player, 7961, PAGE, "colin-s-curse-using-ithoi-s-telescope");
  assert.equal(text(player), "Let's see if I can find that mermaid he saw...");
  player.getDialogueManager().advance();
  tick(2);
  assert.ok(owned(player, 7969), "Bugs (7969) in the view");
  tick(3);
  assert.deepEqual(player.log.subs.filter((entry) => entry.id === TELESCOPE_OVERLAY).map((entry) => entry.tick), [5]);
  tick(8);
  assert.equal(sent(player), "That doesn't look anything like a mermaid. That's an ogre!");
  assert.equal(player.log.lines.at(-1).tick, 13);
  assert.equal(continuable(player), false, "held in the view");
  tick(10);
  assert.equal(varbitAt(player, VARBIT_CABINBOY).at(-1).value, 2);
  assert.equal(continuable(player), true, "continued back in the hut");
  assert.deepEqual(at(player), [2528, 2836, 1]);
});

test("the fire: progress 49 at +2 and 50 at +23, Ithoi out and back, the line continued at +28", (t) => {
  const player = actor(t, STAGE_CONFESSED, [2532, 2837, 0], { "corsair-curse:proof-plan": true });
  player.getInventory().adds(590, 1);
  now = 0;
  const object = core.MapObjects.get(31724, new core.Location(2530, 2837, 0));
  assert.ok(object, "the cache's driftwood multiloc under the hut");
  const event = { player, itemId: 590, objectId: 31724, object, handled: false };
  PluginManager.emitItemOnObject(event);
  assert.equal(event.handled, true);
  assert.equal(sent(player), "You light the driftwood...");
  tick(13);
  assert.ok(owned(player, 7963), "Ithoi running (7963) out of his hut");
  tick(15);
  const progress = varbitAt(player, VARBIT_PROGRESS).map((entry) => [entry.tick, entry.value]);
  assert.ok(progress.some(([at, value]) => at === 2 && value === 49));
  assert.ok(progress.some(([at, value]) => at === 23 && value === 50));
  assert.equal(quest.getStage(player), STAGE_PROVED);
  assert.equal(text(player), "Well, I guess that proves he's well enough to get up! And apparently he knows some magic too.");
  assert.equal(continuable(player), true);
  assert.deepEqual(at(player), [2529, 2838, 0]);
});

test("the dig: a tick later cook 2 and the doll, a tile a tick, gone with the line eleven ticks after", (t) => {
  const player = actor(t, STAGE_INVESTIGATING, [2503, 2839, 0], { "quest.the_corsair_curse.cook": 1 });
  now = 0;
  QuestRuntime.startTranscript(api, player, 7970, PAGE, "gnocci-s-curse-digging-for-her", (steps) => steps.slice(1));
  const choice = { player, npcId: 7970, option: "Search for the possessed doll and face the consequences.", end: false };
  PluginManager.emitCustomEvent("npc-dialogue:choice", choice);
  assert.equal(choice.end, true);
  tick(1);
  assert.equal(varbitAt(player, VARBIT_COOK).at(-1).value, 2);
  const doll = owned(player, 7993);
  assert.ok(doll, "corscurs_doll_multi (7993) for the owner");
  tick(3);
  assert.equal(sent(player), "That's not possessed. That sounds more like clockwork.");
  assert.equal(continuable(player), false);
  tick(7);
  assert.equal(owned(player, 7993), null);
  assert.equal(continuable(player), true);
});

test("the kill order: Ithoi's stairs enter the fight's copy; his death ends it two ticks after 'Awww!'", (t) => {
  const player = actor(t, STAGE_KILL_ORDER, [2532, 2833, 0]);
  const object = { getLocation: () => new core.Location(2531, 2833, 0) };
  const climb = { player, objectId: 31735, object, handled: false };
  PluginManager.emitCustomEvent("ladders:climb", climb);
  assert.equal(climb.handled, true);
  assert.ok(player.getLocation().getX() > 6400, "in the copy of the hut");
  tick(1);
  const ithoi = owned(player, 7964);
  assert.ok(ithoi, "Ithoi (7964), level 35, for the owner");
  ithoi.appendDeath();
  tick(1);
  assert.equal(quest.getStage(player), STAGE_KILL_ORDER);
  tick(1);
  assert.equal(quest.getStage(player), STAGE_KILLED);
  assert.ok(player.getLocation().getX() < 6400, "back on the real map");
  assert.equal(player.getLocation().getZ(), 1);
});

test("Tock's ship: the line held while the camera shows the ship west of Rimmington, back and continued at +23", (t) => {
  const player = actor(t, 1, [3030, 3272, 0]);
  now = 0;
  QuestRuntime.startTranscript(api, player, 7956, PAGE, "the-cursed-crew-talking-to-captain-tock", from("Now, I've a ship moored west of Rimmington."));
  tick(1);
  assert.equal(continuable(player), false, "the line is held");
  assert.deepEqual(at(player), [2918, 3231, 0], "at the ship (capture tick 4383)");
  assert.equal(varbitAt(player, CUTSCENE_STATUS).at(-1).value, 1);
  tick(21);
  assert.deepEqual(at(player), [3030, 3272, 0], "back at the crossroads (tick 4404)");
  tick(1);
  assert.equal(continuable(player), true, "the line's continue comes back at +23 (tick 4405)");
  assert.equal(varbitAt(player, CUTSCENE_STATUS).at(-1).value, 0);
});

test("the fire's spell is Water Strike's, as the Wiki transcript names it: cast 93, projectile 94", (t) => {
  const player = actor(t, STAGE_CONFESSED, [2532, 2837, 0], { "corsair-curse:proof-plan": true });
  player.getInventory().adds(590, 1);
  const shots = [];
  const sendProjectile = player.getPacketSender().sendProjectile.bind(player.getPacketSender());
  player.getPacketSender().sendProjectile = (...args) => { shots.push({ tick: now, id: args[4] }); return sendProjectile(...args); };
  now = 0;
  const object = core.MapObjects.get(31724, new core.Location(2530, 2837, 0));
  PluginManager.emitItemOnObject({ player, itemId: 590, objectId: 31724, object, handled: false });
  tick(20);
  const ithoi = owned(player, 7963);
  const graphics = [];
  const perform = ithoi.performGraphic.bind(ithoi);
  ithoi.performGraphic = (graphic) => { graphics.push(graphic.id); return perform(graphic); };
  tick(1);
  assert.deepEqual(graphics, [93]);
  assert.deepEqual(shots, [{ tick: 21, id: 94 }]);
});

test("only the owner's fight counts: another Ithoi's death leaves the stage alone", (t) => {
  const player = actor(t, STAGE_KILL_ORDER, [2532, 2833, 0]);
  const stray = api.spawnNpc({ id: 7964, x: 2529, y: 2839, z: 1, wanderRadius: 0 });
  t.after(() => api.removeNpc(stray));
  tick(1);
  stray.appendDeath();
  tick(3);
  assert.equal(quest.getStage(player), STAGE_KILL_ORDER);
});

test("a logout mid-dig takes the doll away; a logout mid-flashback leaves the cove and nothing advanced", (t) => {
  const digger = actor(t, STAGE_INVESTIGATING, [2503, 2839, 0], { "quest.the_corsair_curse.cook": 1 });
  PluginManager.emitCustomEvent("npc-dialogue:choice", { player: digger, npcId: 7970, option: "Search for the possessed doll and face the consequences.", end: false });
  tick(2);
  assert.ok(owned(digger, 7993));
  PluginManager.emitPlayerLogout({ player: digger, username: digger.getUsername() });
  assert.equal(owned(digger, 7993), null);

  const listener = actor(t, STAGE_INVESTIGATING, [2557, 2858, 1]);
  QuestRuntime.startTranscript(api, listener, 7968, PAGE, "colin-s-curse-talking-to-colin", from("I was using Ithoi's telescope"));
  tick(3);
  assert.ok(owned(listener, 7965));
  PluginManager.emitPlayerLogout({ player: listener, username: listener.getUsername() });
  assert.deepEqual(at(listener), [2557, 2858, 1], "saved at the scene's exit, where it started");
  assert.equal(owned(listener, 7965), null);
  assert.equal(Number(listener.getAttribute("quest.the_corsair_curse.cabinboy")) || 0, 0, "the flashback plays again next time");
});

test("down Ithoi's stairs in the two ticks after his death: the kill still counts", (t) => {
  const player = actor(t, STAGE_KILL_ORDER, [2532, 2833, 0]);
  PluginManager.emitCustomEvent("ladders:climb", { player, objectId: 31735, object: { getLocation: () => new core.Location(2531, 2833, 0) }, handled: false });
  tick(1);
  owned(player, 7964).appendDeath();
  tick(1);
  const down = { player, objectId: 31735, object: { getLocation: () => new core.Location(2529, 2834, 1) }, handled: false };
  PluginManager.emitCustomEvent("ladders:climb", down);
  assert.equal(down.handled, true);
  assert.deepEqual(at(player), [2532, 2833, 0]);
  assert.equal(quest.getStage(player), STAGE_KILLED);
  tick(3);
  assert.equal(quest.getStage(player), STAGE_KILLED);
});

test("Tess's tooth-pick line takes the artefact, and without it the relic step stays where it was", (t) => {
  const run = (player) => { const event = { player, npcId: core.NpcIdentifiers.CHIEF_TESS, text: "Dis is tooth-pick. Tess got plenty more.", step: {} };
    PluginManager.emitCustomEvent("npc-dialogue:line", event); event.before?.(); };
  const carrying = actor(t, STAGE_INVESTIGATING, [2012, 9006, 1], { "quest.the_corsair_curse.thief": 2 });
  carrying.getInventory().adds(21837, 1);
  run(carrying);
  assert.equal(carrying.getInventory().getAmount(21837), 0);
  assert.equal(Number(carrying.getAttribute("quest.the_corsair_curse.thief")), 3);
  const empty = actor(t, STAGE_INVESTIGATING, [2012, 9006, 1], { "quest.the_corsair_curse.thief": 2 });
  run(empty);
  assert.equal(Number(empty.getAttribute("quest.the_corsair_curse.thief")), 2);
});
