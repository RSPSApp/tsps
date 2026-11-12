// Run after `yarn build`: node --test tests/goblin-diplomacy.test.cjs
//
// Goblin Diplomacy against the revision 242 capture 20261112T150929-5ab63b4 (docs/quests/goblin-diplomacy/README.md).
// Real Player, PlayerSession and ClientConnection, the real plugins, cache and map: talks are npc_option packets and the
// conversation is played with dialogue_continue packets. Each tick runs as World.process does: tasks, the scene's NPCs, the
// player's packets, area and movement, the session's flush. No client ran.
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

const TALK_TILE = [2960, 3510, 0];
const BENTNOZE_TILE = [2959, 3511, 0];
const STAGE = { started: 1, orangeRejected: 3, blueRejected: 4, complete: 6 };
const TABS = [76, 77, 78, 79, 80, 81, 82, 87, 88].map((slot) => (161 << 16) | slot);

let core;
let next = 4100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(TALK_TILE[0], TALK_TILE[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "goblin_diplomacy");
const gv = (kind, name) => kind === "npc" ? core.CacheDefinitions.getNpcId(name) : kind === "seq" ? core.CacheDefinitions.getSeqId(name)
  : kind === "varbit" ? core.CacheDefinitions.getVarbitId(name) : core.CacheDefinitions.getVarpId(name);

function actor(t, { stage, items = [] }) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("gobdip" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...TALK_TILE));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const bentnoze = core.NPC.create(core.NpcIdentifiers.GENERAL_BENTNOZE, new core.Location(...BENTNOZE_TILE));
  core.World.getNpcs().add(bentnoze);
  // The real login gameframe: its tab mounts are raw packets the sender does not track.
  connection.sendPlayerBootstrap();
  const f = { t, player, connection, bentnoze, tick: 0, calls: [], said: [] };
  record(f);
  t.after(() => {
    core.World.getNpcs().remove(bentnoze);
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, stage);
  for (const id of items) player.getInventory().add(new core.Item(id, 1), false);
  return f;
}

const RECORDED = /^(sendVarbit|sendConfig|sendObjectAnimation|closeSubInterface|sendTabInterface|sendCameraMoveTo|sendCameraLookAt|sendCameraReset|sendCameraUnlock|mountSubInterface|sendCameraShake)$/;
function record(f) {
  const sender = f.player.getPacketSender();
  const proto = Object.getPrototypeOf(sender);
  let depth = 0;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!RECORDED.test(name) || typeof proto[name] !== "function") continue;
    const original = proto[name];
    sender[name] = function (...args) {
      if (depth === 0) f.calls.push({ tick: f.tick, name, args });
      depth++;
      try { return original.apply(this, args); } finally { depth--; }
    };
  }
}

/** The scene's NPCs move between tasks and the player, as World.process runs them. */
function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  const area = f.player.getArea();
  for (const npc of core.World.getNpcs()) {
    if (npc && area && npc.getArea?.() === area) npc.getMovementQueue().process();
  }
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
  const line = shown(f);
  if (line && f.said.at(-1)?.text !== line.text) f.said.push({ tick: f.tick, ...line });
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

/** The open chat line: { who, text, npcId }, or the open menu's options. */
function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", text: menu.options.join(" | ") };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: current.getText(), npcId: current.getNpcId?.() };
}

async function talk(f) {
  await f.connection.dispatch([{ type: "npc_option", index: f.bentnoze.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 20 && !shown(f); i++) tick(f);
}

async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 }]);
  tick(f);
}

/** Continues lines until a menu is open; its options. */
async function untilMenu(f, limit = 40) {
  for (let i = 0; i < limit && !MultiChatboxPrompt.getPending(f.player); i++) await continueLine(f);
  return MultiChatboxPrompt.getPending(f.player)?.options;
}

async function choose(f, text) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

/** Continues until `text` shows (each continue is one tick), then returns its tick. */
async function until(f, text, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (shown(f)?.text === text) return f.tick;
    if (f.player.getDialogueManager().getCurrent?.()?.getText && shown(f)?.text) await continueLine(f);
    else tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

const sceneArea = (f) => (f.player.getArea()?.getName?.() === "Goblin armour fitting scene" ? f.player.getArea() : null);
const source = (f, location) => {
  const area = sceneArea(f);
  return area ? [location.getX() - area.getBaseX() + 2944, location.getY() - area.getBaseY() + 3504] : [location.getX(), location.getY()];
};
const actorsAt = (f) => Array.from(core.World.getNpcs()).filter((npc) => npc && sceneArea(f) && npc.getArea?.() === sceneArea(f))
  .map((npc) => [npc.getNpcTransformationId() >= 0 ? npc.getNpcTransformationId() : npc.getId(), ...source(f, npc.getLocation())]);
const varbit = (f, name) => f.player.getPacketSender().getVarbit(gv("varbit", name));
const callsAt = (f, tickNo, name) => f.calls.filter((call) => call.tick === tickNo && call.name === name);

test("under way, a talk opens with a start opening and then live's menu, the hand-in first only when the armour is carried", async (t) => {
  const carried = actor(t, { stage: STAGE.orangeRejected, items: [core.ItemIdentifiers.BLUE_GOBLIN_MAIL] });
  ticks(carried, 2);
  await talk(carried);
  const menu = await untilMenu(carried);
  assert.deepEqual(menu, ["I have some blue armour here.", "Why are you arguing about the colour of your armour?",
    "Wouldn't you prefer peace?", "I'll leave you to it."], JSON.stringify(carried.said));
  // Ours: an answer comes back to this menu; the pre-quest menus would offer to start the quest again.
  for (const question of ["Why are you arguing about the colour of your armour?", "Wouldn't you prefer peace?"]) {
    await choose(carried, question);
    assert.deepEqual(await untilMenu(carried), menu, question);
  }

  const without = actor(t, { stage: STAGE.blueRejected });
  ticks(without, 2);
  await talk(without);
  assert.deepEqual(await untilMenu(without), ["Why are you arguing about the colour of your armour?", "Wouldn't you prefer peace?", "I'll leave you to it."]);
});

test("before the quest, the answer to \"Wouldn't you prefer peace?\" returns to the menu without it (capture ticks 126, 138)", async (t) => {
  const f = actor(t, { stage: 0 });
  ticks(f, 2);
  await talk(f);
  for (let i = 0; i < 4; i++) {
    const options = await untilMenu(f);
    if (options.includes("Wouldn't you prefer peace?")) break;
    await choose(f, options.find((option) => option !== "I'll leave you to it.")); // the fat question, say
  }
  await choose(f, "Wouldn't you prefer peace?");
  assert.deepEqual(await untilMenu(f), ["Why are you arguing about the colour of your armour?", "Do you want me to pick an armour colour for you?",
    "I'll leave you to it."], JSON.stringify(f.said.map((line) => line.text)));
});

test("the orange fitting plays as captured: the copy, the actors, the client state, Grubfoot's change and the way out", async (t) => {
  const f = actor(t, { stage: STAGE.started, items: [core.ItemIdentifiers.ORANGE_GOBLIN_MAIL] });
  ticks(f, 2);
  await talk(f);
  await untilMenu(f);
  await choose(f, "I have some orange armour here.");
  assert.equal(shown(f).text, "I have some orange armour here.");
  const talkedFrom = [f.player.getLocation().getX(), f.player.getLocation().getY()];
  await continueLine(f);
  const t0 = f.tick;

  // t0: the chat is held and the screen fades out; nothing else yet.
  assert.deepEqual(callsAt(f, t0, "mountSubInterface").map((call) => call.args[3].postScripts[0].args), [[0, 255, 0, 0, 25]]);
  assert.equal(varbit(f, "cutscene_status"), 0);
  assert.equal(sceneArea(f), null);

  // t1: the copy, the player on 2957, 3513, the actors, the cutscene's client state and the tabs closed.
  tick(f);
  assert.ok(sceneArea(f), "in the fitting room copy");
  assert.deepEqual(source(f, f.player.getLocation()), [2957, 3513]);
  assert.deepEqual(actorsAt(f).sort(), [
    [gv("npc", "general_bentnoze_red_noop"), 2958, 3512],
    [gv("npc", "general_wartface_green_noop"), 2958, 3511],
    [gv("npc", "catwalk_goblin_brown_noop"), 2954, 3511],
  ].sort());
  assert.deepEqual([varbit(f, "cutscene_status"), varbit(f, "fov_clamp"), varbit(f, "draw_distance_max_override"), varbit(f, "minimap_state"),
    f.player.getPacketSender().getVarp(gv("varp", "option_areasounds_override")), f.player.getPacketSender().getVarp(gv("varp", "areasounds_override"))],
    [1, 3, 1, 2, 30, 1]);
  assert.deepEqual(callsAt(f, f.tick, "closeSubInterface").map((call) => call.args[0]).filter((uid) => TABS.includes(uid)).sort(), [...TABS].sort());

  // t2: the camera and the fade in; t3: Wartface calls Grubfoot.
  tick(f);
  const area = sceneArea(f);
  const move = area.sourceTile(2961, 3514), look = area.sourceTile(2957, 3512);
  assert.deepEqual(callsAt(f, f.tick, "sendCameraMoveTo")[0].args.slice(0, 3), [move.getX(), move.getY(), 450]);
  assert.deepEqual(callsAt(f, f.tick, "sendCameraLookAt")[0].args.slice(0, 3), [look.getX(), look.getY(), 150]);
  assert.deepEqual(callsAt(f, f.tick, "mountSubInterface").map((call) => call.args[3].postScripts[0].args), [[0, 0, 0, 255, 25]]);
  tick(f);
  assert.deepEqual(shown(f), { who: "NpcDialogue", text: "Grubfoot!", npcId: gv("npc", "general_wartface_green_noop") });

  // "Put on this armour!", then the change: from the tick Grubfoot is back at the curtain (A), A+2 it opens, A+3 he is in,
  // A+4 it closes, A+8 he is orange and it opens, A+9 and A+10 he comes out, A+10 it closes, A+11 he asks.
  await until(f, "Put on this armour!");
  await continueLine(f);
  const trail = [];
  for (let i = 0; i < 20 && shown(f)?.text !== "What do you think?"; i++) {
    tick(f);
    trail.push({ tick: f.tick, at: actorsAt(f).find(([id]) => /catwalk/.test(core.CacheDefinitions.getNpc(id)?.name ?? "") || [gv("npc", "catwalk_goblin_brown_noop"), gv("npc", "catwalk_goblin_orange_noop")].includes(id)) });
  }
  const arrived = trail.find((row) => row.at[1] === 2954).tick;
  const curtain = f.calls.filter((call) => call.name === "sendObjectAnimation").map((call) => [call.tick - arrived, call.args[1].getId?.() ?? call.args[1].id]);
  assert.deepEqual(curtain, [[2, gv("seq", "curtain_open")], [4, gv("seq", "curtain_closing")], [8, gv("seq", "curtain_open")], [10, gv("seq", "curtain_closing")]]);
  const where = (offset) => trail.find((row) => row.tick === arrived + offset).at;
  assert.deepEqual(where(3).slice(1), [2953, 3511]);
  assert.equal(where(7)[0], gv("npc", "catwalk_goblin_brown_noop"));
  assert.equal(where(8)[0], gv("npc", "catwalk_goblin_orange_noop"), "the same NPC transforms");
  assert.deepEqual(where(9).slice(1), [2954, 3511]);
  assert.deepEqual(where(10).slice(1), [2955, 3511]);
  assert.equal(f.tick - arrived, 11);
  assert.equal(shown(f).npcId, gv("npc", "catwalk_goblin_orange_noop"), "his chathead wears the new armour");

  // The verdict turns the generals to the player; the last line's continue ends it.
  await until(f, "Human! Get us blue armour!");
  assert.deepEqual(source(f, f.player.getPositionToFace()), [2958, 3511]);
  await continueLine(f);
  const end = f.tick;
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.ORANGE_GOBLIN_MAIL), 0);
  assert.equal(quest().getStage(f.player), STAGE.orangeRejected);
  assert.equal(varbit(f, "gobdip_grubfoot_vis"), 1);
  tick(f);
  assert.equal(sceneArea(f), null);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], talkedFrom, "back where they talked from");
  assert.deepEqual([varbit(f, "cutscene_status"), varbit(f, "fov_clamp"), varbit(f, "minimap_state")], [0, 0, 0]);
  assert.ok(callsAt(f, end + 1, "sendTabInterface").length >= 9, "the nine tabs come back");
  assert.deepEqual(TABS.filter((uid) => !f.player.getPacketSender().getSubInterfaceAt(uid)), [], "every tab is mounted again");
  assert.ok(callsAt(f, end + 1, "sendCameraUnlock").length && callsAt(f, end + 1, "sendCameraReset").length);
  tick(f);
  assert.deepEqual(callsAt(f, end + 2, "mountSubInterface").map((call) => call.args[3].postScripts[0].args), [[0, 0, 0, 255, 25]]);
  assert.equal(f.player.getDialogueManager().isActive(), false);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});

test("the brown fitting completes the quest a tick after the fade in, with the gold bar, the XP and the goblin armour scroll", async (t) => {
  const f = actor(t, { stage: STAGE.blueRejected, items: [core.ItemIdentifiers.GOBLIN_MAIL] });
  ticks(f, 2);
  await talk(f);
  await untilMenu(f);
  await choose(f, "I have some brown armour here.");
  await until(f, "Thanks... I think...");
  await continueLine(f);
  const end = f.tick;
  ticks(f, 2);
  assert.equal(quest().isComplete(f.player), false, "not yet at the fade in");
  tick(f);
  assert.equal(f.tick, end + 3);
  assert.equal(quest().isComplete(f.player), true);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.GOLD_BAR), 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.GOBLIN_MAIL), 0);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.CRAFTING), 200);
  assert.equal(varbit(f, "gobdip_main"), 6);
  assert.equal(quest().scrollItemId, core.ItemIdentifiers.GOBLIN_MAIL);
  assert.equal(quest().rewardItemLabel, "A Gold Bar");
});

test("a logout inside a fitting keeps the mail and saves the player on the tile they talked from", async (t) => {
  const f = actor(t, { stage: STAGE.started, items: [core.ItemIdentifiers.ORANGE_GOBLIN_MAIL] });
  ticks(f, 2);
  await talk(f);
  await untilMenu(f);
  await choose(f, "I have some orange armour here.");
  const talkedFrom = [f.player.getLocation().getX(), f.player.getLocation().getY()];
  await continueLine(f);
  ticks(f, 2);
  assert.ok(sceneArea(f));
  PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], talkedFrom);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.ORANGE_GOBLIN_MAIL), 1);
  assert.equal(quest().getStage(f.player), STAGE.started);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
});
