// Run after `yarn build`: node --test tests/wanted-scenes.test.cjs
//
// Wanted! (#4198): every CommOrb scan that found Solus only ran Savant's transcript, with no
// Solus, no cutscene and no fight set-up. Live (RSProx capture "Wanted!", rev 242.1, 2026-11-12):
// - a scan plays seq 2721 + spotanim 454 + sound 1900; two ticks later the cutscene starts with
//   Solus (wanted_solusN, 4938 + mission) on his tile and every line held until the last one;
// - the QH mission varbits move and the clue item arrives on the ticks the scene's table names
//   (Canifis: varbits at "Argh!" +29, the grey toy horsey with the item box +83);
// - the fourth stop's Flames of Zamorak take 69 HP to 10 and Savant wakes the player outside
//   Falador Castle (2971,3338) at +55;
// - the sixth stop summons a Black Knight a tick after the last line is continued; its death hands
//   over 20 noted pure essence (7937) and sets wanted_black_knight_dead;
// - the finale comes with the teleport into the mine: an instance, fifteen White Rangers who die to
//   Ice Barrage and leave bones, Solus turning into 4962 to attack, his hat, and the way home.
//
// Real engine, as observatory-kitchen-gate.test.cjs: every plugin loaded, real Players and NPCs,
// the item action through PluginManager.emitItemAction and the tick tasks running.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { World } = require("../dist/game/World");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const ScenesModule = require("../plugins/quests/wanted/Scenes.Wanted");

const COMMORB = 6635;
const STAGE_HUNT = 11;
const STAGE_DEFEATED = 12;
const CUTSCENE_STATUS = 542;
const CHAT_TEXT = new Set([(231 << 16) | 6, (217 << 16) | 6, (193 << 16) | 2]);
const CONTINUE = new Set([(231 << 16) | 5, (217 << 16) | 5]);
const missionVarbit = (mission) => 1065 + (mission - 1) * 2;

let core;
let next = 6100;
let quest;
const players = [];
let now = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  PluginManager.emitServerStartup({});
  quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "wanted");
});

function actor(t, [x, y, z = 0], { position, destination, pending = 0 }) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("wantedscene" + player.getIndex());
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  core.RegionManager.loadMapFiles(x, y);
  player.setLocation(new core.Location(x, y, z));
  player.needsPlacement = false;
  players.push(player);
  const sender = player.getPacketSender();
  const log = { lines: [], continues: [], varbits: [], messages: [] };
  const sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, uid) => {
    if (CHAT_TEXT.has(uid)) log.lines.push({ tick: now, text });
    if (CONTINUE.has(uid)) log.continues.push({ tick: now, text });
    return sendString(text, uid);
  });
  const sendVarbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value) => {
    log.varbits.push({ tick: now, id, value });
    return sendVarbit(id, value);
  });
  t.mock.method(sender, "sendMessage", (message) => { log.messages.push({ tick: now, message }); return sender; });
  t.after(() => {
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player);
    players.splice(players.indexOf(player), 1);
  });
  quest.setStage(player, STAGE_HUNT);
  player.setAttribute("quest.wanted.mission", position);
  player.setAttribute("wanted:destination", destination);
  player.setAttribute("wanted:pending-destination", pending);
  player.getInventory().setItem(0, new core.Item(COMMORB, 1));
  return { player, log };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    now++;
    for (const player of players) player.getMovementQueue().process();
    core.TaskManager.process();
    World.getAddNPCQueue().splice(0).forEach((npc) => World.getNpcs().add(npc));
    for (const player of players) player.resetUpdating();
  }
}

function scan(player) {
  now = 0;
  const slot = player.getInventory().getSlotForItemId(COMMORB);
  const item = player.getInventory().forSlot(slot);
  PluginManager.emitItemAction({ player, item, itemId: COMMORB, slot, clickType: 1, handled: false });
}

function varbitAt(log, id) {
  return log.varbits.filter((entry) => entry.id === id);
}

const owned = (player, id) => [...World.getNpcs()].find((npc) => npc?.getId?.() === id && npc.isRegistered() && npc.getOwner?.() === player) ?? null;

test("Canifis: Solus appears, lines are held, the varbits move at Argh! and the grey horsey comes with its box", (t) => {
  const { player, log } = actor(t, [3489, 3482], { position: 1, destination: 1, pending: 6 });
  const table = ScenesModule.POSITION_SCENES[1];
  scan(player);
  tick(2);
  const solus = owned(player, 4939);
  assert.ok(solus, "wanted_solus1 (4939) appears for the owner");
  assert.deepEqual([solus.getLocation().getX(), solus.getLocation().getY()], [3489, 3478], "on his captured tile");
  assert.equal(varbitAt(log, CUTSCENE_STATUS).at(-1)?.value, 1, "the cutscene is on");
  assert.equal(log.lines.at(-1).text, "What the...?");
  assert.equal(log.lines.at(-1).tick, 2);
  assert.equal(log.continues.at(-1).text, "", "held: no click to continue");
  tick(26);
  assert.equal(varbitAt(log, missionVarbit(6)).length, 0, "nothing moves before Argh!");
  tick(1);
  assert.equal(log.lines.at(-1).text, "Argh!");
  assert.equal(varbitAt(log, missionVarbit(1) + 1).at(-1)?.value, 1, "Canifis complete at +29");
  assert.equal(varbitAt(log, missionVarbit(6)).at(-1)?.value, 1, "Draynor Market is next");
  assert.equal(solus.isRegistered(), false, "Solus is gone");
  tick(table.lines[12] - 29);
  assert.equal(log.lines.at(-1).text, "Savant transfers the item to you.");
  assert.equal(player.getInventory().getAmount(2526), 1, "the grey toy horsey (horsey_grey 2526)");
  tick(table.off - table.lines[12]);
  assert.equal(log.lines.at(-1).text, "Okay I'll head off immediately. Let's hope we're not too late.");
  assert.equal(log.continues.at(-1).text, "Click here to continue", "only the last line continues");
  assert.equal(varbitAt(log, CUTSCENE_STATUS).at(-1)?.value, 0, "the cutscene ends with it");
  const heldTicks = log.lines.map((line) => line.tick);
  assert.deepEqual(heldTicks, table.lines, "every line on its captured tick");
  assert.equal(player.getAttribute("quest.wanted.mission"), 2);
  assert.equal(player.getAttribute("wanted:destination"), 6);
});

test("the fourth stop: Flames of Zamorak take 69 HP to 10, never below 1, and Savant wakes the player outside Falador Castle", (t) => {
  const { player } = actor(t, [2797, 3163], { position: 4, destination: 13 });
  player.getSkillManager().setCurrentLevel?.(core.Skill.HITPOINTS, 69);
  player.setHitpoints?.(69);
  scan(player);
  tick(50);
  assert.equal(player.getHitpoints(), 10, "85% of 69, rounded up, is the capture's 59");
  tick(5);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2971, 3338]);
  tick(ScenesModule.POSITION_SCENES[4].lines[20] - 55);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BONE_SPEAR), 1, "the bone spear clue");
  assert.equal(player.getAttribute("wanted:destination"), 3, "Dorgesh-Kaan is next");

  const low = actor(t, [2797, 3163], { position: 4, destination: 13 }).player;
  low.setHitpoints?.(1);
  scan(low);
  tick(51);
  assert.equal(low.getHitpoints(), 1, "the flames never kill");
});

test("the sixth stop: the knight comes on the continue, and its death hands over 20 noted pure essence", (t) => {
  const { player, log } = actor(t, [2551, 3082], { position: 6, destination: 18 });
  scan(player);
  tick(ScenesModule.POSITION_SCENES[6].off);
  assert.equal(log.lines.at(-1).text, "Say hello to my little friend! And goodbye to me!");
  assert.equal(owned(player, 4959), null, "no knight before the continue");
  player.getDialogueManager().advance();
  tick(1);
  const knight = owned(player, 4959);
  assert.ok(knight, "wanted_summoned_black_knight (4959)");
  assert.deepEqual([knight.getLocation().getX(), knight.getLocation().getY()], [2553, 3081]);
  PluginManager.emitNpcDeath({ killer: player, npc: knight, npcId: 4959, location: { x: 2553, y: 3081, z: 0 } });
  assert.equal(player.getInventory().getAmount(7937), 20, "cert_blankrune_high x20");
  assert.equal(varbitAt(log, 1057).at(-1)?.value, 1, "wanted_black_knight_dead");
  assert.equal(varbitAt(log, missionVarbit(4)).at(-1)?.value, 1, "the mine is next");
  assert.equal(log.lines.at(-1).text, "Savant transfers the item to you.");
  tick(39);
  assert.equal(log.lines.at(-1).text, "Let's worry about that later; Go get Solus!");
  assert.equal(log.continues.at(-1).text, "Click here to continue");
});

test("a wrong place still plays the scan, then one of Savant's answers; before the hunt the orb only says so", (t) => {
  const { player, log } = actor(t, [3200, 3200], { position: 2, destination: 6 });
  scan(player);
  tick(2);
  assert.match(log.lines.at(-1)?.text ?? "", /Savant out|Checking incoming data|Background magical|background magical/);
  assert.equal(player.getAttribute("quest.wanted.mission"), 2);

  const early = actor(t, [3200, 3200], { position: 0, destination: 0 }).player;
  quest.setStage(early, 8);
  const messages = [];
  t.mock.method(early.getPacketSender(), "sendMessage", (message) => { messages.push(message); return early.getPacketSender(); });
  scan(early);
  assert.deepEqual(messages, ["There is nothing nearby to scan."]);
});

test("the finale: the mine teleport opens the instance, the rangers fall and leave bones, Solus attacks and his death sends the player home with the hat", (t) => {
  const { player, log } = actor(t, [3252, 3401], { position: 7, destination: 4 });
  const claim = { player, from: [3252, 3401, 0], steps: {}, land: null };
  PluginManager.emitCustomEvent("runecrafting:essence-teleport", claim);
  assert.equal(typeof claim.land, "function", "Wanted! takes the arrival over");
  assert.equal(typeof claim.steps[1], "function", "the fade out at T+1");
  claim.land();
  now = 4;
  const area = player.getPrivateArea?.() ?? player.getArea?.();
  assert.ok(area, "the player is in the mine's copy");
  const solus = owned(player, 4930);
  assert.ok(solus, "Solus (4930)");
  tick(4);
  assert.equal(log.lines.at(-1).text, "There he is!");
  tick(69 - 8);
  const rangers = [...World.getNpcs()].filter((npc) => npc?.getId?.() === 4961 && npc.isRegistered() && npc.getOwner?.() === player);
  assert.equal(rangers.length, 15, "fifteen White Rangers");
  tick(85 - 69);
  assert.equal(rangers.filter((ranger) => ranger.isRegistered()).length, 0, "Ice Barrage kills them all");
  const bones = [...World.getItems().values()].filter((item) => item?.getItem?.().getId?.() === 526 && item.getOwner?.() === player.getUsername());
  assert.equal(bones.length, 15, "each leaves the player's own bones");
  tick(87 - 85);
  assert.equal(varbitAt(log, CUTSCENE_STATUS).at(-1)?.value, 0, "the cutscene ends at T+87");
  tick(116 - 87);
  assert.equal(solus.getNpcTransformationId(), 4962, "Solus turns attackable");
  assert.ok(solus.getHitpoints() > 0);
  PluginManager.emitNpcDeath({ killer: player, npc: solus, npcId: 4962, location: { x: 0, y: 0, z: 0 } });
  tick(2);
  assert.equal(quest.getStage(player), STAGE_DEFEATED);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.SOLUSS_HAT), 1, "his hat");
  assert.equal(log.lines.at(-1).text, "Now that Solus is defeated you should take his hat to Sir Amik to prove that you were responsible.");
  tick(15);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3252, 3401], "home where the Curse was cast");
  tick(6);
  assert.match(log.lines.at(-1).text, /^VERY well done, /);
  assert.equal(log.continues.at(-1).text, "Click here to continue");
});
