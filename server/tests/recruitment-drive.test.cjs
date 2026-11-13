// Run after `yarn build`: node --test tests/recruitment-drive.test.cjs
//
// Recruitment Drive against the user's whole-quest rsprox capture (revision 242.1,
// docs/quests/recruitment-drive/README.md). Real Player, PlayerSession and ClientConnection, the
// real plugins, cache and map: talks and clicks are packets, each tick runs as World.process does.
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
const RecruitmentDrive = require("../plugins/quests/quests/RecruitmentDrive.Quest");
const { pickRooms } = require("../plugins/quests/recruitmentdrive/Course.RecruitmentDrive");

const TIFFY_TILE = [2997, 3373, 0];
const TALK_TILE = [2997, 3374, 0];
const FALADOR_RETURN = [2996, 3375, 0];
const FADE_UID = (161 << 16) | 1;
const ROOM = { spishyus: 1, table: 2, kuam: 3, tinley: 4, ren: 5, cheevers: 6, hynn: 7 };

let core;
let next = 7100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(TIFFY_TILE[0], TIFFY_TILE[1]);
  for (const [x, y] of [[2440, 4956], [2470, 4956], [2460, 4979], [2455, 4964], [2467, 4940], [2490, 4972], [2451, 4935]]) {
    core.RegionManager.loadMapFiles(x, y);
  }
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "recruitment_drive");
const drive = () => RecruitmentDrive.instance;

function actor(t, { stage = 2, items = [], at = TALK_TILE } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("recruit" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { t, player, connection, tick: 0, calls: [], said: [], messages: [], npcs: [] };
  record(f);
  t.after(() => {
    for (const npc of f.npcs) core.World.getNpcs().remove(npc);
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, stage);
  for (const id of items) player.getInventory().add(new core.Item(id, 1), false);
  return f;
}

function spawn(f, id, tile) {
  const npc = core.NPC.create(id, new core.Location(...tile));
  core.World.getNpcs().add(npc);
  f.npcs.push(npc);
  return npc;
}

const RECORDED = /^(sendVarbit|sendSubInterface|closeSubInterface|sendInterface|sendInterfaceRemoval|sendString|sendSound|sendJingle|sendSong|sendObject|sendObjectRemoval|sendEnterAmountPrompt|sendEntityHint)$/;
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
  const send = f.player.sendMessage.bind(f.player);
  f.player.sendMessage = (text, ...rest) => {
    f.messages.push({ tick: f.tick, text });
    return send(text, ...rest);
  };
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  const area = f.player.getArea();
  for (const npc of core.World.getNpcs()) {
    if (npc && area && npc.getArea?.() === area) {
      npc.getMovementQueue().process();
      npc.getCombat?.()?.process?.();
    }
  }
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  f.player.getCombat?.()?.process?.();
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
  const line = shown(f);
  if (line && f.said.at(-1)?.text !== line.text) f.said.push({ tick: f.tick, ...line });
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", text: menu.options.join(" | "), title: menu.title };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: current.getText(), npcId: current.getNpcId?.() };
}

async function talk(f, npc) {
  await f.connection.dispatch([{ type: "npc_option", index: npc.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 20 && !shown(f); i++) tick(f);
}

async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : group === 229 ? 4 : 0), childIndex: -1 }]);
  tick(f);
}

async function choose(f, text) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

/** Continues until `text` shows (each continue is one tick), then returns its tick. */
async function until(f, text, limit = 80) {
  for (let i = 0; i < limit; i++) {
    const line = shown(f);
    if (line?.text === text || (line?.who === "menu" && line.text.includes(text))) return f.tick;
    if (line && line.who !== "menu") await continueLine(f);
    else tick(f);
  }
  assert.fail(`"${text}" never showed; said: ${JSON.stringify(f.said.slice(-6))}`);
}

/** Continues every line until the chatbox is clear. */
async function finishChat(f, limit = 40) {
  for (let i = 0; i < limit && shown(f); i++) {
    if (shown(f).who === "menu") return;
    await continueLine(f);
  }
}

async function button(f, group, child) {
  await f.connection.dispatch([{ type: "widget_action", widgetId: (group << 16) | child, groupId: group, childId: child, buttonNum: 1, opId: 1, slot: -1, itemId: -1 }]);
  tick(f);
}

/** The tick an NPC chat line's text was sent (held lines have no dialogue entry to read). */
const chatAt = (f, text) => f.calls.find((call) => call.name === "sendString" && call.args[1] === ((231 << 16) | 6)
  && String(call.args[0]).replace(/<br>/g, " ").replace(/\s+/g, " ").trim() === text)?.tick;
const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const at = (f) => [f.player.getLocation().getX(), f.player.getLocation().getY()];
const callsAt = (f, tickNo, name) => f.calls.filter((call) => call.tick === tickNo && call.name === name);
const fadeCalls = (f, out) => f.calls.filter((call) => call.name === "sendSubInterface" && call.args[0] === FADE_UID
  && JSON.stringify(call.args[3]?.postScripts?.[0]?.args) === JSON.stringify(out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50]));

/** Puts the player in the grounds as Sir Tiffy's trip would, with the given rooms. */
function intoGrounds(f, order) {
  drive().course.travel(f.player, order);
  ticks(f, 13);
  assert.deepEqual(at(f), drive().course.roomByNumber.get(order[0]).landing, "landed in the first room");
}

test("a run is five of the seven rooms, Sir Kuam's always among them", () => {
  for (let seed = 1; seed <= 200; seed++) {
    let x = seed;
    const random = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    const order = pickRooms(random);
    assert.equal(order.length, 5);
    assert.equal(new Set(order).size, 5);
    assert.ok(order.includes(ROOM.kuam), JSON.stringify(order));
    assert.ok(order.every((room) => room >= 1 && room <= 7));
  }
});

test("Sir Tiffy's trip: held lines 2, 5 and 8 ticks after the continue, the room at +11, its observer at +13 (ticks 335-350)", async (t) => {
  const f = actor(t, { stage: 1 });
  const tiffy = spawn(f, core.NpcIdentifiers.SIR_TIFFY_CASHIEN, TIFFY_TILE);
  ticks(f, 2);
  await talk(f, tiffy);
  const menu = await until(f, "Yes, let's go!");
  assert.ok(menu);
  // osrsreboxed-db#88: live's wording and the question before the menu (ticks 169-174).
  const greeting = f.said.map((line) => line.text);
  assert.ok(greeting.includes("Well, a top-notch adventurer like yourself is just the right sort we've been seeking for our organisation."), JSON.stringify(greeting));
  assert.equal(greeting.at(-2), "So, are you ready to begin testing?");
  await choose(f, "Yes, let's go!");
  await until(f, "Jolly good show! Now, the training grounds location is a secret so...");
  assert.equal(quest().getStage(f.player), 2);
  assert.equal(varbit(f, 692), 1, "rd_spoke_to_tiffy with the line");
  await continueLine(f);
  const start = f.tick;
  assert.equal(fadeCalls(f, true).at(-1)?.tick, start, "the fade out on the continue");
  ticks(f, 13);
  const byText = (text) => chatAt(f, text);
  assert.equal(byText("Here we go! Mind your head!"), start + 2);
  assert.equal(byText("Oops, ignore the smell! Nearly there!"), start + 5);
  assert.equal(byText("And... Here we are! Best of luck!"), start + 8);
  assert.equal(varbit(f, 6719), 2, "minimap_state off inside");
  const room = drive().course.currentRoom(f.player);
  assert.ok(room, "a run started");
  assert.deepEqual(at(f), room.landing);
  assert.equal(fadeCalls(f, false).at(-1)?.tick, start + 13, "the fade in with the observer");
});

test("Sir Tiffy turns away a player with items (the vAdG3I branch), and the trip does not start", async (t) => {
  const f = actor(t, { stage: 2, items: [core.ItemIdentifiers.COINS] });
  const tiffy = spawn(f, core.NpcIdentifiers.SIR_TIFFY_CASHIEN, TIFFY_TILE);
  ticks(f, 2);
  await talk(f, tiffy);
  assert.equal(shown(f).text, "Ah, what ho! Back for another go at the old testing, what?");
  await until(f, "Yes, let's go!");
  await choose(f, "Yes, let's go!");
  await finishChat(f);
  ticks(f, 15);
  assert.equal(drive().course.run(f.player), null);
  assert.deepEqual(at(f), TALK_TILE.slice(0, 2));
  assert.ok(f.said.some((line) => /completely empty inventory/.test(line.text)), JSON.stringify(f.said));
});

test("Sir Ren: the lock spells the clue's word; a wrong word fails, held 3 ticks, Falador 3 ticks after the fade (ticks 404-463)", async (t) => {
  const random = Math.random;
  t.after(() => { Math.random = random; });
  Math.random = () => 4 / 6 + 0.01; // LAST
  const f = actor(t);
  intoGrounds(f, [ROOM.ren, ROOM.kuam, ROOM.table, ROOM.hynn, ROOM.tinley]);
  Math.random = random;
  assert.equal(varbit(f, 666), 6, "rd_templock_1 for LAST, as captured");
  assert.match(shown(f).text, /^Greetings friend, and welcome here/);
  await continueLine(f);
  await choose(f, "Can I have a different clue?");
  assert.equal(varbit(f, 667), 1);
  assert.equal(await until(f, "Last time my puzzle did not help Apparently, so you've bidden. Study my speech carefully, whelp To find the answer, hidden."), f.tick);
  await finishChat(f);

  const ren = drive().rooms.ren;
  await f.connection.dispatch([{ type: "object_option", id: 7323, x: 2446, y: 4956, clickType: 1 }]);
  ticks(f, 12);
  assert.ok(f.calls.some((call) => call.name === "sendInterface" && call.args[0] === 285), "the combination lock");
  assert.deepEqual(ren.state(f.player).letters, [0, 0, 0, 0]);
  await button(f, 285, 47); // rda_left: A -> Z
  assert.equal(ren.state(f.player).letters[0], 25);
  assert.ok(f.calls.some((call) => call.name === "sendString" && call.args[0] === "Z" && call.args[1] === ((285 << 16) | 43)));
  await button(f, 285, 56); // rdenter: "ZAAA"
  assert.equal(f.messages.at(-1).text, "You have failed to solve the riddle.");
  const failed = f.tick;
  assert.equal(chatAt(f, "It's sad to say, this test beat you. I'll send you to Tiffy, what to do?"), failed);
  ticks(f, 3);
  assert.equal(fadeCalls(f, true).at(-1)?.tick, failed + 3, "the fade 3 ticks after the held line");
  ticks(f, 3);
  assert.deepEqual(at(f), FALADOR_RETURN.slice(0, 2));
  assert.equal(varbit(f, 666), 0);
  assert.equal(varbit(f, 667), 0);
  ticks(f, 5);
  assert.equal(shown(f).text, "Oh, jolly bad luck, what? Not quite the brainbox you thought you were, eh?");
  assert.equal(drive().course.run(f.player), null);
});

test("Sir Ren: LAST opens the door; the exit door's jingle, the next room 3 ticks later and its observer 2 after (ticks 3003-3013)", async (t) => {
  const random = Math.random;
  t.after(() => { Math.random = random; });
  Math.random = () => 4 / 6 + 0.01;
  const f = actor(t);
  intoGrounds(f, [ROOM.ren, ROOM.tinley, ROOM.kuam, ROOM.table, ROOM.hynn]);
  Math.random = random;
  await finishChat(f);
  if (shown(f)?.who === "menu") await choose(f, "Can I have the clue for the door?");
  await finishChat(f);
  await f.connection.dispatch([{ type: "object_option", id: 7323, x: 2446, y: 4956, clickType: 1 }]);
  ticks(f, 12);
  for (const [child, presses] of [[48, 11], [50, 0], [52, 18], [54, 19]]) {
    for (let i = 0; i < presses; i++) await button(f, 285, child);
  }
  assert.deepEqual(drive().rooms.ren.state(f.player).letters.map((n) => String.fromCharCode(65 + n)).join(""), "LAST");
  await button(f, 285, 56);
  assert.equal(varbit(f, 663), 1, "rd_room5_complete");
  assert.match(shown(f).text, /^Your wit is sharp, your brains quite clear;/);
  await finishChat(f);
  await f.connection.dispatch([{ type: "object_option", id: 7323, x: 2446, y: 4956, clickType: 1 }]);
  let opened = -1;
  for (let i = 0; i < 10 && opened < 0; i++) {
    tick(f);
    if (f.calls.some((call) => call.name === "sendJingle" && call.args[0] === 159)) opened = f.tick;
  }
  assert.ok(opened > 0, "recruit observation jingle");
  assert.ok(callsAt(f, opened, "sendObject").some((call) => call.args[0].getId() === 38848), "inviswall in the doorway");
  ticks(f, 3);
  assert.deepEqual(at(f), drive().course.roomByNumber.get(ROOM.tinley).landing, "Sir Tinley's room 3 ticks after the door");
  assert.equal(varbit(f, 666), 0, "the room's varbits are cleared");
  ticks(f, 2);
  assert.equal(shown(f).text, `Ah, ${f.player.getUsername()}, you have arrived. Speak to me to begin your task.`);
});

async function clickLoc(f, id, x, y, clickType = 1, wait = 12) {
  await f.connection.dispatch([{ type: "object_option", id, x, y, clickType }]);
  ticks(f, wait);
}

async function useOnLoc(f, itemId, objectId, x, y, wait = 12) {
  await f.connection.dispatch([{ type: "item_on_object", objectId, x, y, itemId,
    slot: f.player.getInventory().getSlotForItemId(itemId), widgetId: 149 << 16 }]);
  ticks(f, wait);
}

async function useOnItem(f, a, b) {
  const inv = f.player.getInventory();
  await f.connection.dispatch([{ type: "inventory_use_on", itemId: a, slot: inv.getSlotForItemId(a),
    target: { kind: "inventory", id: b, slot: inv.getSlotForItemId(b) } }]);
  tick(f);
}

const has = (f, id) => f.player.getInventory().getAmount(id) > 0;

test("Ms. Hynn: the husband riddle takes 10 at the count prompt (tick 947), 1,111 for the fingers riddle fails (tick 772)", async (t) => {
  const random = Math.random;
  t.after(() => { Math.random = random; });
  Math.random = () => 0.21; // the husband and daughter
  const pass = actor(t);
  intoGrounds(pass, [ROOM.hynn, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.tinley]);
  assert.equal(varbit(pass, 667), 1, "rd_templock_2 for the husband riddle, as captured");
  await until(pass, "How old is my daughter now?");
  await continueLine(pass);
  assert.ok(pass.calls.some((call) => call.name === "sendEnterAmountPrompt" && call.args[0] === "Enter amount:"));
  await pass.connection.dispatch([{ type: "dialogue_amount", amount: 10 }]);
  tick(pass);
  assert.equal(varbit(pass, 665), 1, "rd_room7_complete");
  assert.equal(shown(pass).text, `Excellent work, ${pass.player.getUsername()}. Please step through the portal to meet your next challenge.`);

  Math.random = () => 0.01; // the fingers riddle
  const fail = actor(t);
  intoGrounds(fail, [ROOM.hynn, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.tinley]);
  Math.random = random;
  assert.equal(varbit(fail, 667), 5);
  await until(fail, "What would be the number you would get if you multiply the number of fingers on everythings left hand, to the nearest million?");
  await continueLine(fail);
  await fail.connection.dispatch([{ type: "dialogue_amount", amount: 1111 }]);
  tick(fail);
  assert.match(shown(fail).text, /^No\.\.\. I am very sorry\./);
  await continueLine(fail);
  ticks(fail, 4);
  assert.deepEqual(at(fail), FALADOR_RETURN.slice(0, 2));
});

test("Lady Table: lines every 5 ticks, the dim at +38, every statue back at +43, the missing one passes (ticks 627-670, 1918)", async (t) => {
  const random = Math.random;
  t.after(() => { Math.random = random; });
  Math.random = () => 11 / 12 + 0.01; // layout 12, as captured at tick 627
  const f = actor(t);
  drive().course.travel(f.player, [ROOM.table, ROOM.kuam, ROOM.ren, ROOM.hynn, ROOM.tinley]);
  ticks(f, 13);
  Math.random = random;
  const first = f.tick;
  assert.equal(varbit(f, 658), 12);
  assert.equal(chatAt(f, `Welcome, ${f.player.getUsername()}. This room will test your observation skills.`), first);
  ticks(f, 46);
  assert.equal(chatAt(f, "Study the statues closely. There is one missing statue in this room."), first + 5);
  assert.equal(chatAt(f, "You have 10 seconds to memorise the statues... starting NOW!"), first + 15);
  assert.equal(chatAt(f, "We will now dim the lights and bring the missing statue back in."), first + 38);
  assert.equal(chatAt(f, "Please touch the statue you think has been added."), first + 43);
  assert.equal(varbit(f, 658), 0);
  const answer = drive().rooms.table.layoutAnswer(12);
  const statue = Array.from({ length: 12 }, (_, i) => 7290 + i).find((id) => core.ObjectDefinition.forPlayer(id, f.player)?.id === answer);
  const placed = core.MapObjects.mapObjects;
  let tile = null;
  for (const list of placed.values()) for (const object of list) if (object.getId() === statue) tile = object.getLocation();
  assert.ok(tile, "the answer's statue is on the map");
  await clickLoc(f, statue, tile.getX(), tile.getY());
  assert.equal(varbit(f, 660), 1, "rd_room2_complete");
});

test("Sir Tinley: the count runs from the continue and passes 14 ticks later (595-611); a walk click fails it (550-551)", async (t) => {
  const f = actor(t);
  intoGrounds(f, [ROOM.tinley, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn]);
  await finishChat(f);
  const tinley = spawn(f, core.NpcIdentifiers.SIR_TINLEY, [2476, 4958, 0]);
  await talk(f, tinley);
  assert.equal(varbit(f, 667), 1);
  await continueLine(f);
  const continued = f.tick;
  assert.equal(varbit(f, 667), 2, "the count's first step on the continue");
  ticks(f, 13);
  assert.equal(varbit(f, 667), 15);
  assert.equal(varbit(f, 662), 0);
  tick(f);
  assert.equal(f.tick, continued + 14);
  assert.equal(varbit(f, 662), 1, "rd_room4_complete");

  const g = actor(t);
  intoGrounds(g, [ROOM.tinley, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn]);
  await finishChat(g);
  await talk(g, tinley);
  await continueLine(g);
  ticks(g, 2);
  await g.connection.dispatch([{ type: "move", worldX: 2472, worldY: 4957, modifierFlags: 0, run: false }]);
  tick(g);
  tick(g);
  assert.match(shown(g).text, /^No\.\.\. I am very sorry\./);
  assert.equal(varbit(g, 662), 0);
});

test("Sir Kuam: Sir Leye appears as the second line closes; a blade's last hit fails, unarmed passes (ticks 864-905, 1068)", async (t) => {
  for (const [weapon, passes] of [[core.ItemIdentifiers.STEEL_SHORTSWORD, false], [null, true]]) {
    const f = actor(t);
    intoGrounds(f, [ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn, ROOM.tinley]);
    await finishChat(f);
    const fight = drive().rooms.kuam.fights.get(f.player);
    assert.ok(fight?.leye, "Sir Leye is spawned for the player");
    assert.ok(f.calls.some((call) => call.name === "sendEntityHint"), "the hint arrow");
    assert.equal(fight.weapons.size, 4, "the four steel weapons on the table");
    if (weapon) {
      f.player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
      f.player.getEquipment().refreshItems();
    }
    const leye = fight.leye;
    leye.setHitpoints(0);
    const event = { npc: leye, preventDeath: false };
    PM.emitNpcBeforeDeath?.(event);
    if (!passes) {
      assert.equal(event.preventDeath, true, "a blade cannot defeat him");
      assert.equal(f.messages.at(-1).text, "You have failed to complete this room's puzzle...");
      assert.match(shown(f).text, /^AH-HA HA HA!/);
      continue;
    }
    assert.equal(event.preventDeath, false);
    PM.emitNpcDeath({ npc: leye, npcId: leye.getId(), killer: f.player, location: { x: 0, y: 0, z: 0 } });
    assert.equal(varbit(f, 661), 1, "rd_room3_complete");
  }
});

test("Miss Cheevers: the captured solve, spade to key, and the key opens the exit door (ticks 2056-2280)", async (t) => {
  const f = actor(t);
  intoGrounds(f, [ROOM.cheevers, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn]);
  await finishChat(f);
  const I = drive().rooms.cheevers.ITEM;
  const give = (id, n = 1) => f.player.getInventory().add(new core.Item(id, n), true);
  // The searches and shelves are checked by their own handlers below; the solve uses the items.
  await clickLoc(f, 7329, 2468, 4937);
  assert.ok(has(f, I.KNIFE), "the knife in bookshelf 7329");
  assert.deepEqual(f.messages.slice(-2).map((m) => m.text), ["You search the bookshelves...", "Hidden amongst the books you find a knife."]);
  await clickLoc(f, 7334, 2472, 4944);
  assert.equal(shown(f).text, "There is a vial on this shelf.");
  await continueLine(f);
  await choose(f, "YES");
  assert.ok(has(f, I.CUPRIC_SULPHATE));
  assert.equal(varbit(f, 673), 1);
  give(I.WATER, 2); give(I.GYPSUM); give(I.TIN); give(I.COPPER_ORE_POWDER); give(I.TIN_ORE_POWDER);
  // The spade on the table is the player's own, there on entry (review: the shared spawn never came back).
  const spadeAt = new core.Location(2473, 4941, 0);
  const own = () => core.ItemOnGroundManager.getGroundItem(f.player.getUsername(), I.SPADE, spadeAt, f.player.getPrivateArea());
  assert.ok(own(), "a spade for the player on the table");
  await f.connection.dispatch([{ type: "ground_item_action", itemId: I.SPADE, x: 2473, y: 4941, option: "Take" }]);
  ticks(f, 8);
  assert.ok(has(f, I.SPADE), "picked up");
  assert.equal(own(), null);
  ticks(f, 7);
  assert.ok(own(), "back 7 ticks after the pickup (ticks 1308-1315)");
  await useOnLoc(f, I.SPADE, 7332, 2472, 4940);
  assert.ok(has(f, I.SPADE_NO_HANDLE) && has(f, I.ASHES));
  await useOnLoc(f, I.SPADE_NO_HANDLE, 7342, 2477, 4940);
  assert.equal(varbit(f, 686), 1);
  await useOnLoc(f, I.CUPRIC_SULPHATE, 7342, 2477, 4940);
  assert.equal(varbit(f, 687), 1);
  await useOnLoc(f, I.WATER, 7342, 2477, 4940);
  assert.equal(varbit(f, 686), 2);
  await clickLoc(f, 7342, 2477, 4940);
  assert.equal(varbit(f, 686), 3, "the stone door swung open");
  await useOnItem(f, I.WATER, I.TIN);
  await useOnItem(f, I.GYPSUM, I.TIN);
  assert.ok(has(f, I.TIN_FULL));
  await useOnLoc(f, I.TIN_FULL, 7346, 2468, 4938);
  assert.ok(has(f, I.KEY_MOULD));
  await useOnItem(f, I.COPPER_ORE_POWDER, I.KEY_MOULD);
  await useOnItem(f, I.TIN_ORE_POWDER, I.MOULD_COPPER);
  assert.ok(has(f, I.MOULD_UNHEATED));
  await useOnLoc(f, I.MOULD_UNHEATED, 7332, 2472, 4940);
  assert.ok(has(f, I.MOULD_COMPLETE));
  await useOnItem(f, I.KNIFE, I.MOULD_COMPLETE);
  assert.ok(has(f, I.KEY));
  assert.equal(varbit(f, 664), 1, "rd_room6_complete");
  assert.equal(f.messages.at(-1).text, "You prise the duplicate key out of the tin.");
  // The exit door wants the key carried (review): without it, the refusal; with it, the door.
  await clickLoc(f, 7342, 2477, 4940, 1, 6); // Walk-through to 2478,4940
  assert.deepEqual(at(f), [2478, 4940]);
  const key = f.player.getInventory().getSlotForItemId(I.KEY);
  f.player.getInventory().deleteAtSlot(key, 1, true);
  await clickLoc(f, 7326, 2478, 4940, 1, 2);
  assert.equal(f.messages.at(-1).text, "You have not completed this room's puzzle yet.");
  give(I.KEY);
  await clickLoc(f, 7326, 2478, 4940, 1, 4);
  assert.equal(f.messages.at(-1).text, "You use the duplicate key you made to unlock the door.");
  ticks(f, 3);
  assert.deepEqual(at(f), drive().course.roomByNumber.get(ROOM.kuam).landing);
});

test("Sir Spishyus: the chicken left with the grain eats it nine ticks after the crossing starts (2425-2435); all three across passes (3303)", async (t) => {
  const f = actor(t);
  intoGrounds(f, [ROOM.spishyus, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn]);
  await finishChat(f);
  const room = drive().rooms.spishyus.rooms.get(f.player);
  // The captured failure: chicken and grain on the right, the player crosses back.
  room.where.chicken = "right"; room.where.grain = "right";
  f.player.setLocation(new core.Location(2476, 4972, 0));
  await clickLoc(f, 7287, 2477, 4972, 1, 0);
  for (let i = 0; i < 6 && !f.messages.some((m) => m.text === "You carefully walk across the rickety bridge..."); i++) tick(f);
  const started = f.messages.find((m) => m.text === "You carefully walk across the rickety bridge...")?.tick;
  assert.ok(started, "the crossing starts");
  for (let i = 0; i < 12 && varbit(f, 683) !== 3; i++) tick(f);
  assert.equal(f.tick, started + 9, "the side left behind is checked nine ticks after the crossing message");
  assert.deepEqual(at(f), [2484, 4972], "across the eight bridge tiles");
  assert.equal(varbit(f, 683), 3);
  assert.equal(varbit(f, 685), 3);
  tick(f);
  assert.match(shown(f).text, /^No\.\.\. I am very sorry\./);

  const g = actor(t);
  intoGrounds(g, [ROOM.spishyus, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn]);
  await finishChat(g);
  const solved = drive().rooms.spishyus.rooms.get(g.player);
  solved.where.fox = "right"; solved.where.grain = "right"; solved.where.chicken = "worn";
  g.player.getEquipment().setItem(5, new core.Item(5609, 1));
  g.player.setLocation(new core.Location(2475, 4972, 0));
  PM.emitCanUnequip(g.player, 5, g.player.getEquipment().getItems()[5]);
  assert.equal(varbit(g, 659), 1, "rd_room1_complete");
  assert.equal(g.messages.at(-1).text, "Congratulations! You have solved this room's puzzle!");
});

test("the entrance portal quits: YES moves the player by Sir Tiffy the tick after, his failure lines 5 later (ticks 1779-1786)", async (t) => {
  const f = actor(t);
  intoGrounds(f, [ROOM.cheevers, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn]);
  await finishChat(f);
  f.player.getInventory().add(new core.Item(5605, 1), true);
  await clickLoc(f, 7324, 2467, 4940, 1, 4);
  assert.equal(shown(f).title, "Quit the Training Grounds?");
  await choose(f, "YES");
  const chose = f.tick;
  tick(f);
  assert.deepEqual(at(f), FALADOR_RETURN.slice(0, 2));
  assert.equal(f.player.getInventory().getAmount(5605), 0, "the room's items are taken");
  ticks(f, 5);
  assert.equal(shown(f).text, "Oh, jolly bad luck, what? Not quite the brainbox you thought you were, eh?");
  assert.ok(f.tick - chose <= 7);
});

test("the fifth room's line closes into the finish: Falador 3 ticks later, Sir Tiffy's welcome 4 after that (ticks 3586-3593)", async (t) => {
  const f = actor(t);
  intoGrounds(f, [ROOM.hynn, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.tinley]);
  const { course } = drive();
  const state = course.run(f.player);
  state.done = new Set([ROOM.kuam, ROOM.table, ROOM.ren, ROOM.tinley]);
  state.index = 4;
  state.order = [ROOM.kuam, ROOM.table, ROOM.ren, ROOM.tinley, ROOM.hynn];
  course.closeChat(f.player);
  course.sayPassed(f.player, core.NpcIdentifiers.MS_HYNN_TERPRETT, course.passRoom(f.player, ROOM.hynn));
  tick(f);
  assert.equal(shown(f).text, "Excellent work! You have passed all five of the required tests! Please accept my congratulations!");
  await continueLine(f);
  const closed = f.tick;
  ticks(f, 3);
  assert.deepEqual(at(f), FALADOR_RETURN.slice(0, 2));
  ticks(f, 3);
  assert.equal(shown(f), null, "nothing yet 6 ticks after the close");
  tick(f);
  assert.equal(f.tick, closed + 7, "tick 3593: 4 ticks after the move (3589)");
  assert.equal(shown(f)?.text, "I believe I've managed to pass the tests!", JSON.stringify({ said: f.said.slice(-4), tick: f.tick, closed, run: !!drive().course.run(f.player) }));
  await finishChat(f);
  assert.equal(quest().getStage(f.player), 4, "complete");
  assert.ok(f.messages.some((m) => m.text === "Your respawn point has been left alone, but you can now speak to Sir Tiffy to change it to Falador."));
});

test("a login on the grounds moves a recruit out with the room's items, and leaves anyone else alone (review)", async (t) => {
  const recruit = actor(t, { stage: 2, items: [5605], at: [2460, 4979, 0] });
  PM.emitPlayerLogin({ player: recruit.player, username: recruit.player.getUsername(), isNewAccount: false });
  assert.deepEqual(at(recruit), FALADOR_RETURN.slice(0, 2));
  assert.equal(recruit.player.getInventory().getAmount(5605), 0);
  const other = actor(t, { stage: 4, items: [core.ItemIdentifiers.COINS, 4151], at: [2460, 4979, 0] });
  PM.emitPlayerLogin({ player: other.player, username: other.player.getUsername(), isNewAccount: false });
  assert.deepEqual(at(other), [2460, 4979]);
  assert.equal(other.player.getInventory().getAmount(4151), 1, "a finished player keeps their whip");
});

test("dying in Sir Leye's room ends the run and keeps the steel weapons in the grounds (review)", async (t) => {
  const f = actor(t);
  intoGrounds(f, [ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn, ROOM.tinley]);
  await finishChat(f);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.STEEL_SHORTSWORD, 1), true);
  PM.emitPlayerDeath({ player: f.player, killer: null, handled: false });
  assert.equal(drive().course.run(f.player), null);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.STEEL_SHORTSWORD), 0);
});

test("leaving Sir Tiffy's welcome keeps the five passes: a talk finishes the quest (review)", async (t) => {
  const f = actor(t);
  intoGrounds(f, [ROOM.hynn, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.tinley]);
  const { course } = drive();
  const state = course.run(f.player);
  state.done = new Set([ROOM.kuam, ROOM.table, ROOM.ren, ROOM.tinley]);
  state.order = [ROOM.kuam, ROOM.table, ROOM.ren, ROOM.tinley, ROOM.hynn];
  state.index = 4;
  course.closeChat(f.player);
  course.sayPassed(f.player, core.NpcIdentifiers.MS_HYNN_TERPRETT, course.passRoom(f.player, ROOM.hynn));
  tick(f);
  await continueLine(f);
  assert.equal(quest().getStage(f.player), 3, "saved as the fifth line closes");
  ticks(f, 7);
  assert.equal(shown(f).text, "I believe I've managed to pass the tests!");
  course.closeChat(f.player); // walked away
  ticks(f, 2);
  const tiffy = spawn(f, core.NpcIdentifiers.SIR_TIFFY_CASHIEN, TIFFY_TILE);
  await talk(f, tiffy);
  assert.equal(shown(f).text, "I believe I've managed to pass the tests!");
  await finishChat(f);
  assert.equal(quest().getStage(f.player), 4);
});

test("the entrance portal does nothing once the room is failing (review)", async (t) => {
  const f = actor(t);
  intoGrounds(f, [ROOM.cheevers, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn]);
  await finishChat(f);
  const { course } = drive();
  course.fail(f.player, [{ npc: core.NpcIdentifiers.MISS_CHEEVERS, text: course.failLine() }]);
  tick(f);
  course.quit(f.player);
  await finishChat(f);
  ticks(f, 12);
  const text = "Oh, jolly bad luck, what? Not quite the brainbox you thought you were, eh?";
  const sends = f.calls.filter((call) => call.name === "sendString" && call.args[1] === ((231 << 16) | 6)
    && String(call.args[0]).replace(/<br>/g, " ").replace(/\s+/g, " ").trim() === text);
  assert.equal(sends.length, 1, "Sir Tiffy's failure lines play once");
});

test("items given during Sir Tiffy's trip stop it before the grounds (review)", async (t) => {
  const f = actor(t);
  drive().course.travel(f.player, [ROOM.cheevers, ROOM.kuam, ROOM.table, ROOM.ren, ROOM.hynn]);
  ticks(f, 3);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 1000), true);
  ticks(f, 12);
  assert.deepEqual(at(f), TALK_TILE.slice(0, 2));
  assert.equal(drive().course.run(f.player), null);
  assert.equal(varbit(f, 6719), 0);
});
