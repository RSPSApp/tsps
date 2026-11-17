// Run after `yarn build`: node --test tests/death-plateau-capture-parity.test.cjs
//
// Death Plateau as the two whole-quest rsprox recordings show it (local 1001800, rev 242, and 1001683, rev 241):
// varp 314's values, the hand-over item boxes, Harold's drinks, the dice interface's timing, Tenzing's doors,
// the unlock sound, the scouting messages, the Death Plateau notice and the stile. Real plugins, real Players
// with a session, the real task manager.
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
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
});
after(() => PM.emitServerShutdown({}));

const PAGE = "Death Plateau";
const WEAKNESS = "finding-the-combination-talking-to-harold-after-learning-his-weakness";
const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "death_plateau");
const tick = (n = 1) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };

let nextIndex = 7800;
/** A registered player with a session; every packet of interest is logged with the tick it went out on. */
function actor(x, y, z, { stage = 0, items = [] } = {}) {
  const channel = { kind: "test", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session, new core.Location(x, y, z));
  session.setPlayer(player);
  player.setUsername(`dpparity${nextIndex}`);
  player.setIndex(nextIndex++);
  player.setRegistered(true);
  player.needsPlacement = false;
  quest().setStage(player, stage);
  for (const [id, amount] of items) player.getInventory().adds(id, amount ?? 1);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const log = [];
  let now = 0;
  const sender = player.getPacketSender();
  for (const name of ["sendConfig", "sendSound", "sendJingle", "sendString", "sendInterfaceAnimation", "sendInterfaceDisplayState",
    "sendInterface", "sendInterfaceScript", "sendMessage", "sendTypedMessage", "sendChatboxInterface", "sendItemOnInterfaces", "sendVarbit",
    "sendSoundEffect"]) {
    const original = sender[name].bind(sender);
    sender[name] = (...args) => { log.push({ tick: now, name, args }); return original(...args); };
  }
  const send = async (packet) => { await connection.dispatch([packet]); connection.processTurnPackets(); };
  const advance = (n = 1) => { for (let i = 0; i < n; i++) { now++; tick(); } };
  const continueChat = () => {
    const group = sender.getChatboxGroupId();
    return send({ type: "dialogue_continue", widgetId: (group << 16) | ({ 229: 4, 193: 0, 11: 4 }[group] ?? 5), childIndex: group === 193 ? 0 : -1 });
  };
  const since = (from, name) => log.filter((entry) => entry.tick >= from && (!name || entry.name === name));
  return { player, sender, send, advance, continueChat, log, since, now: () => now };
}

test("varp 314 takes only live's values: every saved stage from the balls placed to the scouting is 70", () => {
  const { player, log } = actor(2896, 3529, 0);
  const wire = (stage) => { quest().setStage(player, stage); return log.filter((e) => e.name === "sendConfig" && e.args[0] === 314).at(-1).args[1]; };
  assert.deepEqual([0, 10, 20, 30, 40, 50, 55, 60].map(wire), [0, 10, 20, 30, 40, 50, 55, 60]);
  assert.deepEqual([65, 70, 72, 73, 75, 77, 78].map(wire), [70, 70, 70, 70, 70, 70, 70]);
  assert.equal(wire(80), 80);
  assert.equal(quest().getStage(player), 80, "the saved stage stays the plugin's own");
});

test("an item-box hand-over sends its chat line once, with the box (the Asgarnian ale)", async () => {
  const a = actor(2904, 3539, 1, { stage: 40, items: [[core.ItemIdentifiers.ASGARNIAN_ALE]] });
  QuestRuntime.startTranscript(PM.createApi("DeathPlateauParityTest"), a.player, core.NpcIdentifiers.HAROLD, PAGE, WEAKNESS, (steps) => {
    const index = steps.findIndex((step) => step.id === "_ELP6x");
    return steps.slice(index);
  });
  const objectbox = a.log.filter((e) => e.name === "sendChatboxInterface" && e.args[0] === 193);
  assert.equal(objectbox.length, 1, "objectbox 193");
  assert.ok(a.log.some((e) => e.name === "sendItemOnInterfaces" && e.args[1] === core.ItemIdentifiers.ASGARNIAN_ALE));
  const chat = a.log.filter((e) => (e.name === "sendMessage" || e.name === "sendTypedMessage") && String(e.args.at(-1)).includes("You give Harold an Asgarnian Ale."));
  assert.equal(chat.length, 2, "one game message and the box's mesbox line, as live (tick 24262)");
  assert.equal(quest().getStage(a.player), 50);
  assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.ASGARNIAN_ALE), 0);
  await a.continueChat();
  const after = a.log.length;
  a.advance(8);
  const repeated = a.log.slice(after).filter((e) => e.name === "sendMessage" && String(e.args[0]).includes("Asgarnian Ale"));
  assert.equal(repeated.length, 0, "the {{mes}} twin is not sent again after the box");
});

test("Harold drinks the ale and the Blurberry special as recorded", async (t) => {
  core.RegionManager.loadMapFiles(2905, 3540);
  const harold = PM.spawnNpc({ id: core.NpcIdentifiers.HAROLD, x: 2905, y: 3540, z: 1, wanderRadius: 0 });
  t.after(() => harold.setDying?.(true));

  await t.test("ale: human_eat 2 ticks after the box's continue, his line at 5", async (t) => {
    const a = actor(2904, 3540, 1, { stage: 40, items: [[core.ItemIdentifiers.ASGARNIAN_ALE]] });
    const animations = [];
    t.mock.method(harold, "performAnimation", (animation) => { animations.push({ tick: a.now(), id: animation.getId?.() ?? animation.id }); });
    QuestRuntime.startTranscript(PM.createApi("DeathPlateauParityTest"), a.player, core.NpcIdentifiers.HAROLD, PAGE, WEAKNESS,
      (steps) => steps.slice(steps.findIndex((step) => step.id === "_ELP6x")), harold);
    await a.continueChat();
    assert.equal(a.sender.getChatboxGroupId(), -1, "the box closes on its continue while Harold drinks (tick 24267)");
    const from = a.now();
    for (let i = 0; i < 6; i++) a.advance();
    assert.deepEqual(animations, [{ tick: from + 2, id: 829 }]);
    const line = a.since(from, "sendString").find((e) => String(e.args[0]).includes("Arrh. That hit the spot!"));
    assert.equal(line?.tick, from + 5);
  });

  await t.test("Blurberry: human_eat at +1, overhead Wow! at +4, stunned (80) at height 124 at +7, his line at +10", async (t) => {
    const a = actor(2904, 3540, 1, { stage: 50, items: [[core.ItemIdentifiers.BLURBERRY_SPECIAL]] });
    const seen = [];
    t.mock.method(harold, "performAnimation", (animation) => { seen.push(["anim", a.now(), animation.getId?.() ?? animation.id]); });
    t.mock.method(harold, "forceChat", (text) => { seen.push(["say", a.now(), text]); return harold; });
    t.mock.method(harold, "performGraphic", (graphic) => { seen.push(["gfx", a.now(), graphic.id, graphic.height]); });
    QuestRuntime.startTranscript(PM.createApi("DeathPlateauParityTest"), a.player, core.NpcIdentifiers.HAROLD, PAGE, WEAKNESS, (steps) => {
      const drink = steps.find((step) => step.type === "choice").options.find((option) => option.text === "Can I buy you a drink?").steps;
      return drink.slice(drink.findIndex((step) => step.id === "VZS4Rq"));
    }, harold);
    assert.ok(a.log.some((e) => e.name === "sendItemOnInterfaces" && e.args[1] === core.ItemIdentifiers.BLURBERRY_SPECIAL));
    assert.equal(a.player.getAttribute("death-plateau:harold-drunk"), true);
    await a.continueChat();
    const from = a.now();
    for (let i = 0; i < 11; i++) a.advance();
    assert.deepEqual(seen, [["anim", from + 1, 829], ["say", from + 4, "Wow!"], ["gfx", from + 7, 80, 124]]);
    const line = a.since(from, "sendString").find((e) => String(e.args[0]).includes("Now THAT hit the spot!"));
    assert.equal(line?.tick, from + 10);
  });
});

test("the dice interface opens, rolls and reports as recorded (101 coins, Harold drunk)", async (t) => {
  const a = actor(2904, 3539, 1, { stage: 50, items: [[core.ItemIdentifiers.COINS, 1000]] });
  a.player.setAttribute("death-plateau:harold-drunk", true);
  // Harold 5 + 3, the player 1 + 6, as in local 1001800: "You lose!" although a drunk Harold pays out.
  const rolls = [4 / 6, 2 / 6, 0, 5 / 6];
  t.mock.method(Math, "random", () => rolls.shift() ?? 0);
  const cache = core.CacheDefinitions;
  const component = (name) => cache.getComponentId(`death_dice:death_gamble_${name}`);
  // The wager as the transcript's amount prompt leaves it, then its "(Gambling interface opens.)" action.
  PM.emitCustomEvent("npc-dialogue:action", { player: a.player, npcId: core.NpcIdentifiers.HAROLD, step: { type: "input" }, handled: false });
  a.player.getEnteredAmountAction().execute(101);
  a.player.getDialogueManager().reset?.();
  const opened = a.now();
  PM.emitCustomEvent("npc-dialogue:action", { player: a.player, npcId: core.NpcIdentifiers.HAROLD, action: "open_interface", target: "Gambling", handled: false });
  assert.equal(a.player.getInterfaceId(), 99);
  const at = (name, tickAt) => a.log.filter((e) => e.name === name && e.tick === tickAt);
  assert.deepEqual(at("sendConfig", opened).map((e) => e.args), [[261, 7], [262, 7]], "if1/if2: coin pile 7 for 101 coins");
  assert.ok(at("sendString", opened).some((e) => e.args[0] === "Harold rolls..." && e.args[1] === component("result")));
  assert.equal(at("sendInterfaceAnimation", opened).filter((e) => e.args[1] === cache.getSeqId("dice_idle")).length, 4);
  assert.ok(at("sendInterfaceDisplayState", opened).some((e) => e.args[0] === component("roll") && e.args[1] === true));
  assert.ok(at("sendInterfaceDisplayState", opened).some((e) => e.args[0] === component("continue") && e.args[1] === true));
  assert.ok(at("sendInterfaceScript", opened).some((e) => e.args[0] === 2524));
  assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 899, "the stake is taken as Harold rolls");

  const click = (name) => PM.emitInterfaceActionClick({ player: a.player, buttonId: component(name), action: 1, handled: false });
  a.advance(2);
  click("roll_button");
  assert.equal(a.since(opened, "sendInterfaceAnimation").filter((e) => e.args[0] === component("player_dice1")).length, 1, "Roll does nothing while Harold rolls");
  a.advance(1);
  assert.deepEqual(at("sendInterfaceAnimation", opened + 3).map((e) => e.args), [[component("harold_dice1"), cache.getSeqId("dice_roll_5")]]);
  assert.deepEqual(at("sendSound", opened + 3).map((e) => e.args[0]), [1475]);
  a.advance(3);
  assert.deepEqual(at("sendInterfaceAnimation", opened + 6).map((e) => e.args), [[component("harold_dice2"), cache.getSeqId("dice_roll_3")]]);
  a.advance(3);
  assert.ok(at("sendInterfaceDisplayState", opened + 9).some((e) => e.args[0] === component("roll") && e.args[1] === false));
  assert.ok(at("sendString", opened + 9).some((e) => e.args[0] === "Your roll..."));

  const rolled = a.now();
  click("roll_button");
  assert.deepEqual(at("sendInterfaceAnimation", rolled).filter((e) => e.args[0] === component("player_dice1")).map((e) => e.args[1]), [cache.getSeqId("dice_roll_1")]);
  click("continue_button");
  assert.equal(a.player.getInterfaceId(), 99, "Continue is hidden until the player's dice land");
  a.advance(3);
  assert.deepEqual(at("sendInterfaceAnimation", rolled + 3).map((e) => e.args), [[component("player_dice2"), cache.getSeqId("dice_roll_6")]]);
  a.advance(3);
  assert.ok(at("sendString", rolled + 6).some((e) => e.args[0] === "You lose!"), "the dice's own verdict");
  assert.deepEqual(at("sendJingle", rolled + 6).map((e) => e.args[0]), [93]);
  assert.ok(at("sendInterfaceDisplayState", rolled + 6).some((e) => e.args[0] === component("continue") && e.args[1] === false));
  assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 1100, "a drunk Harold still pays: stake back and his 100");
});

test("Tenzing's front door: the knock before he has met the player, a plain pass-through after", async (t) => {
  core.RegionManager.loadMapFiles(2822, 3555);
  const objects = [];
  t.mock.method(core.ObjectManager, "register", (object) => objects.push(["add", object.getId(), object.getLocation().getX(), object.getLocation().getY()]));
  t.mock.method(core.ObjectManager, "deregister", (object) => objects.push(["del", object.getId(), object.getLocation().getX(), object.getLocation().getY()]));
  const door = () => new GameObject(core.ObjectIdentifiers.DOOR_113, new core.Location(2822, 3555, 0), 0, 2, null);
  const toggle = (player) => {
    const event = { player, object: door(), objectId: core.ObjectIdentifiers.DOOR_113, handled: false };
    PM.emitCustomEvent("door:toggle", event);
    if (!event.handled) PM.emitCustomEvent("door:open", { player, object: event.object, handled: false });
    return event;
  };

  await t.test("before Saba: the knock and 'No milk today!', the door stays shut", async () => {
    const a = actor(2823, 3555, 0, { stage: 65 });
    objects.length = 0;
    assert.equal(toggle(a.player).handled, true);
    assert.deepEqual(a.log.filter((e) => e.name === "sendSound").map((e) => e.args[0]), [1735]);
    assert.ok(a.log.some((e) => e.name === "sendString" && e.args[0] === "You knock on the door."));
    await a.continueChat();
    assert.ok(a.log.some((e) => e.name === "sendString" && e.args[0] === "No milk today! Thank you!"));
    await a.continueChat();
    a.advance(3);
    assert.equal(objects.length, 0);
  });

  await t.test("after Saba: let in on the continue of 'You'd better come in then.'", async () => {
    const a = actor(2823, 3555, 0, { stage: 70 });
    objects.length = 0;
    toggle(a.player);
    for (let i = 0; i < 3; i++) await a.continueChat();
    assert.ok(a.log.some((e) => e.name === "sendString" && e.args[0].startsWith("Oh...OK. You'd better come in then.")));
    assert.equal(objects.length, 0, "shut until the last line is continued");
    await a.continueChat();
    assert.deepEqual(objects.slice(0, 3), [["del", 3745, 2822, 3555], ["add", 38848, 2822, 3555], ["add", 14975, 2823, 3555]]);
    assert.ok(a.log.some((e) => e.name === "sendSoundEffect" && e.args[0] === 62), "door_open");
    for (let i = 0; i < 6; i++) { a.player.getMovementQueue().process(); a.advance(); core.TaskManager.processWalkTo(a.player.getIndex()); }
    assert.equal(a.player.getLocation().getX(), 2822, "walked into the hut");
    assert.ok(objects.some(([kind, id]) => kind === "add" && id === 3745), "the door is back");
    core.TaskManager.cancelTasks(a.player.getIndex());
  });

  await t.test("once he has given his boots (and leaving), it opens without a knock", () => {
    for (const [x, stage] of [[2823, 72], [2822, 70]]) {
      const a = actor(x, 3555, 0, { stage });
      objects.length = 0;
      const event = toggle(a.player);
      assert.equal(a.log.some((e) => e.name === "sendSound" && e.args[0] === 1735), false);
      assert.deepEqual(objects.slice(0, 3), [["del", 3745, 2822, 3555], ["add", 38848, 2822, 3555], ["add", 14975, 2823, 3555]], `x ${x} stage ${stage}`);
      assert.equal(event.handled, false);
      a.advance(4);
    }
  });

  await t.test("the back door is the same pass-through, open the tile north", () => {
    const a = actor(2820, 3557, 0, { stage: 77 });
    objects.length = 0;
    const back = new GameObject(core.ObjectIdentifiers.DOOR_114, new core.Location(2820, 3557, 0), 0, 1, null);
    PM.emitCustomEvent("door:open", { player: a.player, object: back, handled: false });
    assert.deepEqual(objects.slice(0, 3), [["del", 3746, 2820, 3557], ["add", 38848, 2820, 3557], ["add", 14975, 2820, 3558]]);
    core.TaskManager.cancelTasks(a.player.getIndex());
  });
});

test("the fifth ball unlocks the room with unlock_and_move (1473) on the same tick", () => {
  const a = actor(2893, 3563, 0, { stage: 60 });
  const balls = { "2894,3563": 3109, "2894,3562": 3110, "2895,3563": 3112, "2895,3564": 3113 };
  a.player.setAttribute("death-plateau:stone-balls", balls);
  a.player.getInventory().adds(core.ItemIdentifiers.STONE_BALL_3, 1);
  const mechanism = new GameObject(core.ObjectIdentifiers.STONE_MECHANISM, new core.Location(2895, 3562, 0), 10, 0, null);
  PM.emitItemOnObject({ player: a.player, object: mechanism, definition: core.ObjectDefinition.forPlayer(mechanism.getId(), a.player),
    objectId: mechanism.getId(), item: a.player.getInventory().getItems()[0], itemId: core.ItemIdentifiers.STONE_BALL_3,
    itemSlot: 0, location: { x: 2895, y: 3562, z: 0 }, handled: false });
  assert.equal(quest().getStage(a.player), 65);
  assert.deepEqual(a.log.filter((e) => e.name === "sendSound").map((e) => e.args[0]), [1473]);
  assert.ok(a.log.some((e) => e.name === "sendMessage" && e.args[0] === "The equipment room door has unlocked."));
  assert.equal(a.log.filter((e) => e.name === "sendConfig" && e.args[0] === 314).at(-1).args[1], 70);
});

test("scouting the trail sends the two recorded game messages with the player's line", () => {
  const a = actor(2863, 3609, 0, { stage: 77, items: [[core.ItemIdentifiers.SECRET_WAY_MAP]] });
  a.player.setLocation(new core.Location(2864, 3609, 0));
  AreaManager.process(a.player);
  assert.equal(quest().getStage(a.player), 78);
  assert.deepEqual(a.log.filter((e) => e.name === "sendMessage").map((e) => e.args[0]),
    ["You can see that there are no trolls on the secret path.", "You should go and speak to Denulth."]);
  assert.ok(a.log.some((e) => e.name === "sendString" && String(e.args[0]).startsWith("I think this is far enough")));
});

test("the Death Plateau notice (warning 24) opens on the first step into the trail's zone", () => {
  const a = actor(2831, 3597, 0);
  AreaManager.process(a.player);
  assert.equal(a.log.some((e) => e.name === "sendInterface" && e.args[0] === 581), false);
  a.player.setLocation(new core.Location(2833, 3599, 0));
  AreaManager.process(a.player);
  assert.ok(a.log.some((e) => e.name === "sendVarbit" && e.args[0] === 3872 && e.args[1] === 1), "cws_warning_24 0->1");
  assert.ok(a.log.some((e) => e.name === "sendInterface" && e.args[0] === 581));
  const opened = a.log.filter((e) => e.name === "sendInterface" && e.args[0] === 581).length;
  a.player.setLocation(new core.Location(2835, 3597, 0));
  AreaManager.process(a.player);
  assert.equal(a.log.filter((e) => e.name === "sendInterface" && e.args[0] === 581).length, opened, "walking within the zone does not reopen it");
  a.player.setLocation(new core.Location(2839, 3591, 0));
  AreaManager.process(a.player);
  a.player.setLocation(new core.Location(2839, 3593, 0));
  AreaManager.process(a.player);
  assert.equal(a.log.filter((e) => e.name === "sendInterface" && e.args[0] === 581).length, opened + 1, "entering again from the south");
});

test("Tenzing's stile: a step onto it, then human_walk_style over it at cycles 30-94, no message", () => {
  const stile = require("../plugins/skills/data/agility-shortcuts.json").shortcuts.find((shortcut) => shortcut.object === 3730);
  assert.ok(stile, "Stile (Burthorpe)");
  // Behaviour both ways: tests/agility.test.cjs "Tenzing's stile".
  assert.deepEqual(stile.between.ends, [[2817, 3561, 0], [2817, 3564, 0]]);
  assert.deepEqual(stile.between.via, [[2817, 3562, 0], [2817, 3563, 0]]);
  assert.deepEqual(stile.between.cross[1], { move: "via1", anim: "CLIMB_OVER", delay: 30, speed: [30, 94], ticks: 3 });
  assert.equal(stile.end, undefined);
});

test("the five stone balls lie where live has them and come back 8 ticks after a pickup", () => {
  const spawns = require("../data/definitions/ground-items.json").filter((entry) => entry.id >= 3109 && entry.id <= 3113);
  const where = Object.fromEntries(spawns.map((entry) => [entry.id, [entry.location.x, entry.location.y, entry.location.z, entry.respawn]]));
  // red, blue, yellow, purple, green (death_cannonball_*), rsprox local 1001800 and 1001683.
  assert.deepEqual(where, {
    3109: [2893, 3565, 0, 8], 3110: [2893, 3564, 0, 8], 3111: [2893, 3561, 0, 8], 3112: [2893, 3563, 0, 8], 3113: [2893, 3562, 0, 8],
  });
});

test("a hand-out's item comes with its box, not a continue later (the lost map, Dunstan's spikes)", async (t) => {
  await t.test("Tenzing's replacement map", () => {
    const a = actor(2820, 3555, 0, { stage: 78 });
    a.player.setAttribute("death-plateau:map-received", true);
    QuestRuntime.startTranscript(PM.createApi("DeathPlateauParityTest"), a.player, core.NpcIdentifiers.TENZING, PAGE,
      "new-route-up-death-plateau-talking-to-tenzing-after-losing-the-map", (steps) => steps.slice(steps.findIndex((step) => step.id === "U16B4S")));
    assert.ok(a.log.some((e) => e.name === "sendChatboxInterface" && e.args[0] === 193), "the map's box is up");
    assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.SECRET_WAY_MAP), 1);
  });
  await t.test("Dunstan takes the bar and boots and gives the spiked boots with the double box", () => {
    const a = actor(2919, 3574, 0, { stage: 73, items: [[core.ItemIdentifiers.CLIMBING_BOOTS], [core.ItemIdentifiers.IRON_BAR]] });
    a.player.setAttribute("death-plateau:certificate-delivered", true);
    QuestRuntime.startTranscript(PM.createApi("DeathPlateauParityTest"), a.player, core.NpcIdentifiers.DUNSTAN, PAGE,
      "new-route-up-death-plateau-talking-to-dunstan-before-getting-the-spiked-boots", (steps) => {
        const find = (list) => { for (const step of list ?? []) { if (step.id === "kH8gZk" || step.id === "V1M373") return list.slice(list.indexOf(step)); const hit = find(step.steps) ?? (step.options ?? []).reduce((h, o) => h ?? find(o.steps), null); if (hit) return hit; } return null; };
        return find(steps) ?? [];
      });
    assert.ok(a.log.some((e) => e.name === "sendChatboxInterface" && e.args[0] === 11), "objectbox_double");
    assert.deepEqual(a.log.filter((e) => e.name === "sendMessage").map((e) => e.args[0]),
      ["You give Dunstan an iron bar and the climbing boots.", "Dunstan has given you the spiked boots."], "both chat lines with the first box (tick 25101)");
    assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.SPIKED_BOOTS), 1);
    assert.equal(a.player.getInventory().getAmount(core.ItemIdentifiers.IRON_BAR), 0);
  });
});
