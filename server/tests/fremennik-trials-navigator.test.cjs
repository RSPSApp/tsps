// Run after `yarn build`: node --test tests/fremennik-trials-navigator.test.cjs
//
// The Fremennik Trials: Swensen the Navigator's maze, as rsprox 1002236 (rev 242, ticks
// 6630-6779), 1001646 (rev 241, ticks 2769-2866) and 1002250 show it: the offer, the entrance
// ladder, the correct and wrong portals, the escape rope and the exit ladder that passes the
// trial on Swensen's final line. Real Player, session and connection, the real plugins, cache and
// map: clicks are packets, each tick runs as World.process does.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const NAVIGATOR = 3;
const MERCHANT = 2;
const FLAG_NAVIGATOR = 7;
const SWENSEN_ID = 3925;
const SWENSEN_AT = [2647, 3660, 0];
const ENTRANCE = { id: 4158, x: 2644, y: 3657 };
const BY_ENTRANCE = [2644, 3658, 0];
const MAZE_START = [2631, 10004, 0];
const START_LADDER = { id: 4159, x: 2631, y: 10005 };
const EXIT = { id: 4160, x: 2665, y: 10037 };
const EXIT_LANDING = [2649, 3661, 0];
const ROPE_LANDING = [2647, 3658, 0];
const HOUSE_DOOR = { id: 4247, x: 2645, y: 3663 };
const SEQ_LADDER = 828;
/** Correct portals: placement, a tile in front, the captured landing (S-W-E-N-S-E-N). */
const CORRECT = [
  { id: 4150, at: [2631, 10002], from: [2631, 10003], to: [2642, 10018] },
  { id: 4151, at: [2639, 10015], from: [2640, 10015], to: [2650, 10004] },
  { id: 4152, at: [2656, 10004], from: [2655, 10004], to: [2668, 10015] },
  { id: 4153, at: [2665, 10018], from: [2665, 10017], to: [2630, 10029] },
  { id: 4154, at: [2630, 10023], from: [2630, 10024], to: [2653, 10034] },
  { id: 4155, at: [2656, 10037], from: [2655, 10037], to: [2669, 10026] },
  { id: 4156, at: [2666, 10029], from: [2666, 10028], to: [2665, 10038] },
];
const WRONG = 4157;
/** Dead-end rooms: B1 D1 A2 C2 B3 C3 A4 B4, x/y ranges. */
const DEAD_ENDS = [
  [2639, 2645, 10001, 10008], [2661, 2667, 10001, 10008], [2627, 2634, 10012, 10018], [2650, 2656, 10012, 10018],
  [2639, 2645, 10023, 10029], [2651, 2657, 10023, 10029], [2627, 2633, 10034, 10040], [2639, 2645, 10036, 10042],
];

let core;
let next = 8100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const [x, y] of [[2644, 3657], [2631, 10004], [2665, 10037], [2631, 10037], [2665, 10004]]) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fremennik_trials");
const trial = (f) => (Number(f.player.getAttribute("quest.fremennik_trials.trials")) >>> (NAVIGATOR * 3)) & 7;
const flagged = (f) => ((Number(f.player.getAttribute("quest.fremennik_trials.flags")) >>> FLAG_NAVIGATOR) & 1) === 1;

function actor(t, { at = BY_ENTRANCE, navigator = 0, merchantDone = true, flag = false, swensen = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("nav" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { player, connection, tick: 0, messages: [], anims: [] };
  const send = player.sendMessage.bind(player);
  player.sendMessage = (text, ...rest) => { f.messages.push(text); return send(text, ...rest); };
  const animate = player.performAnimation.bind(player);
  player.performAnimation = (animation, ...rest) => { f.anims.push({ tick: f.tick, id: animation.getId() }); return animate(animation, ...rest); };
  let npc = null;
  if (swensen) {
    npc = core.NPC.create(SWENSEN_ID, new core.Location(...SWENSEN_AT));
    core.World.getNpcs().add(npc);
    f.npc = npc;
  }
  t.after(() => {
    if (npc) core.World.getNpcs().remove(npc);
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, 1);
  player.setAttribute("quest.fremennik_trials.trials", (navigator << (NAVIGATOR * 3)) | ((merchantDone ? 2 : 0) << (MERCHANT * 3)));
  if (flag) player.setAttribute("quest.fremennik_trials.flags", 1 << FLAG_NAVIGATOR);
  tick(f);
  f.messages.length = 0;
  return f;
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  if (f.npc) f.npc.getMovementQueue?.().process?.();
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", options: menu.options };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: current.getText() };
}
const text = (f) => shown(f)?.text ?? null;

const here = (f) => {
  const at = f.player.getLocation();
  return [at.getX(), at.getY(), at.getZ()];
};
const place = (f, tile) => f.player.moveTo(new core.Location(tile[0], tile[1], tile[2] ?? 0));

/** Clicks a loc and runs ticks until something answers (a move, a line or a message). */
async function use(f, object, { max = 12 } = {}) {
  const start = here(f);
  const said = f.messages.length;
  await f.connection.dispatch([{ type: "object_option", id: object.id, x: object.x, y: object.y, clickType: 1 }]);
  const clicked = f.tick;
  // A walk up to the loc is a step or two; a teleport is further.
  const teleported = () => Math.abs(here(f)[0] - start[0]) + Math.abs(here(f)[1] - start[1]) > 3;
  for (let i = 0; i < max && !teleported() && !shown(f) && f.messages.length === said; i++) tick(f);
  return clicked;
}

async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  // Chat heads continue on component 5 (chat_left/chat_right), statements on 4 (messagebox).
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | (group === 229 ? 4 : 5), childIndex: -1 }]);
  tick(f);
}

async function choose(f, option) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(option);
  assert.ok(index >= 0, `"${option}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

async function talk(f) {
  await f.connection.dispatch([{ type: "npc_option", index: f.npc.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 12 && !shown(f); i++) tick(f);
}

/** Reads every line up to a menu or the end. */
async function readAll(f, max = 30) {
  const lines = [];
  for (let i = 0; i < max; i++) {
    const now = shown(f);
    if (!now || now.who === "menu") break;
    lines.push(now.text);
    await continueLine(f);
  }
  return lines;
}

test("the offer: Yes starts the trial; Ask about becoming a Fremennik does not say Hello! twice", async (t) => {
  const f = actor(t, { merchantDone: false, swensen: true });
  // The merchant chain's Swensen greeting ("Hello!" then its menu, 1002236 t6630) is the
  // Merchant unit's; here the player has said "Hello!" and picks the menu's second option.
  PM.emitCustomEvent("npc-dialogue:choice", { player: f.player, npcId: SWENSEN_ID, option: "Ask about becoming a Fremennik" });
  ticks(f, 2);
  const lines = await readAll(f);
  assert.equal(lines.includes("Hello!"), false, "the replay does not say Hello! again");
  assert.ok(lines[0].startsWith("I am trying to become a member of the Fremennik clan!"), lines[0]);
  assert.equal(lines.at(-1), "You wish to try my challenge?");
  await choose(f, "Yes");
  assert.equal(trial(f), 1);
  assert.deepEqual(await readAll(f), ["A maze? Is that all? Sure, it sounds simple enough.",
    "I will warn you outerlander, this maze was designed by myself, and is of the most fiendish complexity!",
    "Oh really? Watch and learn..."]);
});

test("talking to Swensen picks the offer, the again lines, and the done lines by trial state", async (t) => {
  const offer = actor(t, { swensen: true });
  await talk(offer);
  assert.equal(text(offer), "Hello!");
  const lines = await readAll(offer);
  assert.ok(lines.includes("You wish to try my challenge?"));
  await choose(offer, "No");
  assert.equal(trial(offer), 0, "No leaves the trial unstarted");
  await readAll(offer);
  await talk(offer);
  await readAll(offer);
  await choose(offer, "Yes");
  assert.equal(trial(offer), 1, "Yes on a plain Talk-to starts it");
  await readAll(offer);

  const again = actor(t, { navigator: 1, swensen: true });
  await talk(again);
  assert.deepEqual((await readAll(again)).slice(0, 2), ["Hello!", "Man, your maze is pretty tough!"]);

  const done = actor(t, { navigator: 2, swensen: true });
  await talk(done);
  assert.equal(text(done), "Greetings again outerlander! I must say, I am still impressed with the way you moved through my maze!");
});

test("the entrance ladder: seq 828 on arrival, the start room the next tick (1002236 t6717-6718)", async (t) => {
  const f = actor(t, { navigator: 1 });
  await use(f, ENTRANCE);
  assert.deepEqual(here(f), MAZE_START);
  const climb = f.anims.find((a) => a.id === SEQ_LADDER);
  assert.ok(climb, "climbs with human_reachforladder");
  assert.equal(f.tick - climb.tick, 1, "teleports one tick after the seq");
  assert.deepEqual(f.messages.filter((m) => !m.includes("music track")), []);
});

test("the entrance ladder before accepting and after finishing plays the data's lines, and stays up", async (t) => {
  const early = actor(t, { navigator: 0 });
  await use(early, ENTRANCE);
  assert.equal(text(early), "Have you no manners outerlander? This is my home, you will show me the due respect!");
  await continueLine(early);
  assert.equal(text(early), "Erm.... sorry I guess.");
  assert.equal(here(early)[1] < 5000, true);
  assert.deepEqual(early.messages, []);

  const done = actor(t, { navigator: 2 });
  await use(done, ENTRANCE);
  assert.equal(text(done), "No way am I doing that maze again!");
  assert.equal(here(done)[1] < 5000, true);
  assert.deepEqual(done.messages, []);
});

test("each correct portal lands on its captured tile, a tick after the player reaches it", async (t) => {
  const f = actor(t, { navigator: 1, at: MAZE_START });
  for (const portal of CORRECT) {
    place(f, portal.from);
    tick(f);
    const clicked = await use(f, { id: portal.id, x: portal.at[0], y: portal.at[1] });
    assert.deepEqual(here(f), [...portal.to, 0], `portal ${portal.id}`);
    assert.ok(f.tick - clicked >= 1, "not instant");
  }
  assert.deepEqual(f.anims, [], "no seq");
  assert.deepEqual(f.messages.filter((m) => !m.includes("music track")), [], "no message");
});

test("wrong portals send the player to random dead-end rooms, not one fixed room (issue point 8)", async (t) => {
  const f = actor(t, { navigator: 1, at: MAZE_START });
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    // Every non-correct portal is 4157: the start room's west one, then wherever we landed.
    place(f, [2629, 10005, 0]);
    tick(f);
    await use(f, { id: WRONG, x: 2628, y: 10005 });
    const [x, y] = here(f);
    const room = DEAD_ENDS.findIndex(([x1, x2, y1, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2);
    assert.ok(room >= 0, `${x},${y} is in a dead-end room`);
    seen.add(room);
  }
  assert.ok(seen.size >= 4, `40 wrong portals reached ${seen.size} different dead-end rooms`);
  assert.deepEqual(f.anims, []);
});

test("the escape rope: seq 828, up to 2647,3658 the next tick, then Swensen's lines (1001646 t2809-2811)", async (t) => {
  const f = actor(t, { navigator: 1, at: [2654, 10026, 0], swensen: true });
  await use(f, { id: 4161, x: 2655, y: 10027 });
  assert.deepEqual(here(f), ROPE_LANDING);
  assert.ok(f.anims.some((a) => a.id === SEQ_LADDER));
  for (let i = 0; i < 3 && !shown(f); i++) tick(f);
  assert.deepEqual(await readAll(f), [
    "Decided you could not solve my labyrinth after all, did you outerlander? Too tricky for you?",
    "Yeah, it is really confusing down there...",
    "Hahaha! Don't worry outerlander, you are not the first to fail its puzzle!",
  ]);
  assert.equal(trial(f), 1, "the trial is still running");
  // The player can go straight back down (1001646 t2816).
  place(f, BY_ENTRANCE);
  tick(f);
  await use(f, ENTRANCE);
  assert.deepEqual(here(f), MAZE_START);
});

test("the start room's up-ladder takes the player out like a rope (Ours: no capture)", async (t) => {
  const f = actor(t, { navigator: 1, at: MAZE_START });
  await use(f, START_LADDER);
  assert.deepEqual(here(f), ROPE_LANDING);
});

test("the exit ladder: up to 2649,3661, Swensen's finish starts on its own, the trial passes on Thanks! (1002236 t6761-6779)", async (t) => {
  const f = actor(t, { navigator: 1, at: [2665, 10038, 0], swensen: true });
  const stage = quest().getStage(f.player);
  await use(f, EXIT);
  assert.deepEqual(here(f), EXIT_LANDING);
  assert.ok(f.anims.some((a) => a.id === SEQ_LADDER));
  for (let i = 0; i < 3 && !shown(f); i++) tick(f);
  const lines = [];
  for (let i = 0; i < 6 && shown(f) && text(f) !== "Thanks!"; i++) {
    lines.push(text(f));
    assert.equal(trial(f), 1, "not before the last line");
    await continueLine(f);
  }
  assert.deepEqual(lines, [
    "Outerlander! You have finished my maze! I am genuinely impressed!",
    "So does that mean I can rely on your vote at the council of elders to allow me into your village?",
    "Of course outerlander! I am nothing if not a man of my word!",
  ]);
  assert.equal(trial(f), 1);
  await continueLine(f);
  assert.equal(trial(f), 2);
  assert.equal(quest().getStage(f.player), stage + 1, "viking goes up by one");
  assert.equal(flagged(f), false);
  assert.equal(shown(f), null);
  assert.deepEqual(f.messages.filter((m) => !m.includes("music track")), [], "no game message");
  await talk(f);
  assert.equal(text(f), "Greetings again outerlander! I must say, I am still impressed with the way you moved through my maze!");
});

test("a player who left the finish unheard (relog, or an old save's flag) completes on a talk", async (t) => {
  const f = actor(t, { navigator: 1, flag: true, swensen: true });
  await talk(f);
  assert.equal(text(f), "Outerlander! You have finished my maze! I am genuinely impressed!");
  for (let i = 0; i < 3; i++) await continueLine(f);
  assert.equal(text(f), "Thanks!");
  await continueLine(f);
  assert.equal(trial(f), 2);
  assert.deepEqual(f.messages, []);
});

test("the house's maze-exit trapdoors only open from below; Swensen's door opens", async (t) => {
  const f = actor(t, { navigator: 1, at: [2647, 3658, 0] });
  await use(f, { id: 100, x: 2647, y: 3657 });
  assert.deepEqual(f.messages, ["You try to open the trapdoor but it won't budge!", "It looks like the trapdoor can only be opened from the other side."]);
  place(f, [2646, 3663, 0]);
  tick(f);
  await f.connection.dispatch([{ type: "object_option", id: HOUSE_DOOR.id, x: HOUSE_DOOR.x, y: HOUSE_DOOR.y, clickType: 1 }]);
  ticks(f, 4);
  const near = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    near.push(...core.ObjectManager.objectsAt(new core.Location(HOUSE_DOOR.x + dx, HOUSE_DOOR.y + dy, 0)).map((o) => o.getId()));
  }
  assert.ok(near.includes(4248), `the open leaf is in place (${near})`);
});
