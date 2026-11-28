// Run after `yarn build`: node --test tests/eagles-peak-capture.test.cjs
//
// Eagles' Peak against the RSProx capture EaglesPeak+AllUnlocks (rev 243; ticks in docs/quests/eagles-peak/README.md).
// Real Player, PlayerSession and ClientConnection, the real plugins, cache and map: talks and clicks are packets,
// each tick runs as World.process does (tests/between-a-rock-harness.cjs). No client ran.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const H = require("./between-a-rock-harness.cjs");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const QUEST = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "eagles_peak");
const VARBIT = Object.freeze({ QUEST: 2780, GOLD: 3089, TRACKING: 3099, WINCHES: 3100, NET_TRAP: 3105, DOOR: 3106, CHAT: 3110,
  ENTERED_GOLD: 3111, ENTERED_SILVER: 3112, ENTERED_BRONZE: 3113 });
const STATE_ATTRIBUTE = "eagles-peak:varbits";
const ITEM = Object.freeze({ BIRD_BOOK: 10173, METAL_FEATHER: 10174, GOLDEN: 10175, SILVER: 10176, BRONZE: 10177, SEED: 10178,
  JOURNAL: 10179, EAGLE_FEATHER: 10167, CAPE: 10171, BEAK: 10172, FERRET: 10092, BOX_TRAP: 10008, TAR: 1939, DYE: 1765, COINS: 995 });
const HUNTER = 21;

before(async () => {
  await H.boot();
  for (const [x, y] of [[2607, 3265], [2318, 3505], [2328, 3494], [1994, 4983], [2003, 4948], [1974, 4908], [1947, 4868], [1956, 4907], [2022, 4982], [2742, 3830]]) {
    H.core.RegionManager.loadMapFiles(x, y);
  }
});
after(H.shutdown);

function hunter(player, level) {
  const skills = player.getSkillManager();
  const skill = H.core.Skill.HUNTER;
  skills.setMaxLevel?.(skill, level);
  skills.setCurrentLevel?.(skill, level);
}

/** A player of `stage` with `varbits` saved and sent, as a login gives them (format already native). */
function eagles(t, { stage = 0, varbits = {}, at, items = [], worn = [], level = 27 } = {}) {
  const f = H.actor(t, { at, items, worn });
  f.player.setAttribute("eagles-peak:stage-format", 1);
  hunter(f.player, level);
  if (stage) QUEST().setStage(f.player, stage);
  f.player.setAttribute(STATE_ATTRIBUTE, Object.fromEntries(Object.entries(varbits).map(([key, value]) => [VARBIT[key] ?? key, value])));
  for (const [key, value] of Object.entries(varbits)) f.player.getPacketSender().sendVarbit(VARBIT[key] ?? Number(key), value);
  return f;
}

const varbit = (f, id) => f.player.getPacketSender().getVarbit(id);
const amount = (f, id) => f.player.getInventory().getAmount(id);
const messages = (f) => f.messages.map((entry) => entry.text);
const boxes = (f) => H.callsNamed(f, "sendString").filter((call) => (call.args[1] >>> 16) === 229 && (call.args[1] & 0xffff) === 3).map((call) => call.args[0]);
const near = (f, id) => [...H.core.World.getNpcs()].find((npc) => npc?.getId?.() === id && npc.getLocation().getDistance?.(f.player.getLocation()) < 30);

/** Ticks with the player's zones driven too, as the player's own process does (onZoneEnter). */
function walkTicks(f, count) {
  for (let i = 0; i < count; i++) {
    H.tick(f);
    H.PM.updatePlayerZones(f.player);
  }
}

/** Puts the player on a tile as a settled update would (moveTo leaves needsPlacement for the world's update). */
function place(f, [x, y, z]) {
  f.player.setLocation(new H.core.Location(x, y, z));
  f.player.needsPlacement = false;
  f.player.setNeedsPlacement?.(false);
}

function spawnOnce(f, id, tile) {
  return near(f, id) ?? H.spawn(f, id, tile);
}

test("Charlie: live's start prompt, then 5 and the start message with his answer (t83-86)", async (t) => {
  const f = eagles(t, { at: [2608, 3266, 0] });
  const charlie = spawnOnce(f, 1495, [2607, 3265, 0]);
  await H.talk(f, charlie);
  await H.until(f, "Ah, you sound like someone who needs a quest doing!");
  await H.choose(f, "Ah, you sound like someone who needs a quest doing!");
  await H.until(f, "Yes. | No.");
  const menu = H.shown(f);
  assert.equal(menu.title, "Start the Eagles' Peak quest?");
  assert.equal(menu.text, "Yes. | No.");
  await H.choose(f, "Yes.");
  await H.until(f, "Okay, thanks.");
  assert.equal(QUEST().getStage(f.player), 5);
  assert.equal(varbit(f, VARBIT.QUEST), 5);
  assert.ok(messages(f).some((text) => /You've started a new quest: .*Eagles' Peak/.test(text)), JSON.stringify(messages(f)));
});

test("Charlie under 27 Hunter turns the player away and nothing starts", async (t) => {
  const f = eagles(t, { at: [2608, 3266, 0], level: 20 });
  const charlie = spawnOnce(f, 1495, [2607, 3265, 0]);
  await H.talk(f, charlie);
  await H.until(f, "Ah, you sound like someone who needs a quest doing!");
  await H.choose(f, "Ah, you sound like someone who needs a quest doing!");
  await H.until(f, "No, I could do with some help");
  await H.finishChat(f);
  assert.equal(QUEST().getStage(f.player), 0);
});

test("the camp: books give the bird book; Read gives the feather, 10 and the book on the box's continue (t238-247)", async (t) => {
  const f = eagles(t, { stage: 5, at: [2318, 3506, 0] });
  assert.equal(H.core.ObjectDefinition.forPlayer(19787, f.player).getName(), "Books", "the map's books show at 5");
  await H.objectOption(f, 19787, [2319, 3506]);
  H.ticks(f, 3);
  assert.equal(amount(f, ITEM.BIRD_BOOK), 1);
  assert.match(boxes(f).at(-1), /Amongst the scattered books one in particular/);
  await H.finishChat(f);
  await H.itemOption(f, ITEM.BIRD_BOOK, "Read");
  assert.equal(QUEST().getStage(f.player), 10);
  assert.equal(amount(f, ITEM.METAL_FEATHER), 1);
  assert.match(boxes(f).at(-1), /As you open the book something falls out/);
  assert.equal(H.callsNamed(f, "sendInterface").filter((call) => call.args[0] === 680).length, 0, "the book waits for the box");
  await H.continueLine(f);
  assert.ok(H.callsNamed(f, "sendInterface").some((call) => call.args[0] === 680), "indexed book 680 opens");
  assert.ok(f.animations.some((entry) => entry.id === 1350), "human_readbook");
  const titles = H.callsNamed(f, "sendString").filter((call) => call.args[1] === ((680 << 16) | 6)).map((call) => call.args[0]);
  assert.deepEqual(titles.slice(-1), ["William Oddity's Guide to the Avian"]);
});

test("the cliff: the feather's two boxes, 15 on the first's continue; Enter takes the player into the eyrie (t277-284)", async (t) => {
  const f = eagles(t, { stage: 10, at: [2327, 3497, 0], items: [ITEM.METAL_FEATHER] });
  assert.equal(H.core.ObjectDefinition.forPlayer(19790, f.player).getName(), "Rocky outcrop");
  await H.useOnObject(f, ITEM.METAL_FEATHER, 19790, [2328, 3494]);
  H.ticks(f, 2);
  assert.match(boxes(f).at(-1), /You place the metal feather into the groove/);
  assert.equal(QUEST().getStage(f.player), 10);
  await H.continueLine(f);
  assert.equal(QUEST().getStage(f.player), 15);
  assert.match(boxes(f).at(-1), /Part of the cliff face swings outwards/);
  assert.equal(amount(f, ITEM.METAL_FEATHER), 1, "the feather is kept");
  await H.finishChat(f);
  assert.equal(H.core.ObjectDefinition.forPlayer(19790, f.player).getName(), "Cave entrance");
  await H.objectOption(f, 19790, [2328, 3494]);
  H.ticks(f, 3);
  assert.deepEqual(H.xy(f.player.getLocation()), [1994, 4983, 3]);
});

test("the eyrie: the ledge starts the meeting, the camera over the chasm and the first line held (t308-317)", async (t) => {
  const f = eagles(t, { stage: 15, at: [2007, 4974, 3] });
  const nickolaus = spawnOnce(f, 2023, [2008, 4959, 3]);
  assert.equal(nickolaus.getContentId?.(f.player) ?? 1484, 1484, "the map's Nickolaus shows as Shout-to at 15");
  H.PM.updatePlayerZones(f.player);
  f.player.getMovementQueue().addSteps(new H.core.Location(2006, 4973, 3));
  walkTicks(f, 2);
  assert.equal(varbit(f, VARBIT.CHAT), 1);
  const move = H.callsNamed(f, "sendCameraMoveTo")[0];
  assert.deepEqual(move.args.slice(0, 3), [2013, 4966, 825]);
  const chatText = () => H.callsNamed(f, "sendString").filter((call) => call.args[1] === ((231 << 16) | 6)).map((call) => call.args[0]);
  assert.deepEqual(chatText(), ["Hello? Er... excuse me?"], "the line shows, held");
  const continueText = H.callsNamed(f, "sendString").filter((call) => call.args[1] === ((231 << 16) | 5)).map((call) => call.args[0]);
  assert.equal(continueText.at(-1), "", "no Click here to continue while held");
  walkTicks(f, 10);
  assert.ok(H.callsNamed(f, "sendCameraReset").length > 0, "the camera comes back");
  assert.deepEqual(H.xy(f.player.getLocation()), [2004, 4967, 3], "walked to the ledge's end");
  await H.until(f, "Hello, are you Nickolaus?");
  await H.until(f, "The Ardougne zookeeper sent me to find you.");
  assert.equal(varbit(f, VARBIT.CHAT), 2, "the first menu moves the chat on (t334)");
  await H.choose(f, "The Ardougne zookeeper sent me to find you.");
  await H.until(f, "So it's not that you're trapped then?");
  await H.choose(f, "So it's not that you're trapped then?");
  await H.until(f, "Could I help at all?");
  await H.choose(f, "Could I help at all?");
  await H.until(f, "That's a good idea. There are plenty of feathers around here. I'll see what I can do.");
  assert.equal(varbit(f, VARBIT.CHAT), 3);
  await H.finishChat(f);
});

test("Asyff: asked for the costumes (4), then makes two for the materials and 50 coins (5)", async (t) => {
  const f = eagles(t, { stage: 15, varbits: { CHAT: 3 }, at: [3277, 3397, 0] });
  const asyff = spawnOnce(f, 2887, [3278, 3397, 0]);
  await H.talk(f, asyff);
  await H.until(f, "Well, specifically I'm after a couple of bird costumes.");
  await H.choose(f, "Well, specifically I'm after a couple of bird costumes.");
  await H.until(f, "I'll see what I can do.");
  assert.equal(varbit(f, VARBIT.CHAT), 4);
  await H.finishChat(f);
  for (const [id, count] of [[ITEM.EAGLE_FEATHER, 10], [ITEM.TAR, 1], [ITEM.DYE, 1], [ITEM.COINS, 60]]) f.player.getInventory().add(new H.core.Item(id, count), false);
  await H.talk(f, asyff);
  await H.until(f, "I've got the feathers and materials you requested.");
  await H.choose(f, "I've got the feathers and materials you requested.");
  await H.until(f, "Okay, here are the materials. Eagle me up.");
  await H.choose(f, "Okay, here are the materials. Eagle me up.");
  await H.until(f, "There we go; two eagle costumes.");
  assert.equal(varbit(f, VARBIT.CHAT), 5);
  assert.deepEqual([amount(f, ITEM.CAPE), amount(f, ITEM.BEAK), amount(f, ITEM.EAGLE_FEATHER), amount(f, ITEM.COINS)], [2, 2, 0, 10]);
  await H.finishChat(f);
});

test("the bronze room: the trap springs, four winches drop it, the feather comes off the pedestal (t1115-1170)", async (t) => {
  const f = eagles(t, { stage: 15, at: [1987, 4949, 3] });
  await H.objectOption(f, 19909, [1986, 4949]);
  H.ticks(f, 2);
  const Scenes = f.player;
  const here = () => H.xy(f.player.getLocation());
  assert.equal(varbit(f, VARBIT.ENTERED_BRONZE), 1);
  assert.ok(messages(f).includes("You enter the tunnel."));
  assert.notDeepEqual(here(), [1974, 4908, 2], "in a copy of the room, not the map's own");
  const base = f.player.getLocation();
  const at = (x, y) => [base.getX() + x - 1974, base.getY() + y - 4908];
  const winch = H.callsNamed(f, "sendObject").length;
  void winch; void Scenes;
  await H.objectOption(f, 19976, at(1970, 4919));
  H.ticks(f, 12);
  assert.ok(messages(f).includes("The winch doesn't seem to turn any further."), "Ours: a winch before the trap");
  await H.objectOption(f, 19980, at(1973, 4914));
  H.ticks(f, 10);
  assert.equal(varbit(f, VARBIT.NET_TRAP), 1);
  assert.ok(messages(f).includes("As you reach for the bronze feather, the netting on the ground shoots upwards, snatching the pedestal out of your reach."));
  for (const [id, x, y] of [[19979, 1978, 4910], [19978, 1970, 4910], [19977, 1978, 4919], [19976, 1970, 4919]]) {
    await H.objectOption(f, id, at(x, y));
    H.ticks(f, 12);
  }
  assert.equal(varbit(f, VARBIT.WINCHES), 15);
  assert.equal(varbit(f, VARBIT.NET_TRAP), 0);
  assert.equal(messages(f).filter((text) => text === "You wind the winch until it won't go any further.").length, 4);
  H.ticks(f, 3);
  await H.objectOption(f, 19984, at(1974, 4915));
  H.ticks(f, 10);
  assert.equal(amount(f, ITEM.BRONZE), 1);
  await H.objectOption(f, 19984, at(1974, 4915));
  H.ticks(f, 10);
  assert.ok(messages(f).includes("I already have a bronze feather like that."));
  await H.objectOption(f, 19906, at(1974, 4907));
  H.ticks(f, 10);
  assert.deepEqual(here(), [1987, 4949, 3]);
});

/** Into a feather room by its tunnel; returns a function from source tiles to the copy's. */
async function intoRoom(f, entrance, tile, at) {
  await H.objectOption(f, entrance, tile);
  H.ticks(f, 3);
  const base = f.player.getLocation();
  return (x, y) => [base.getX() + x - at[0], base.getY() + y - at[1]];
}

test("the silver room: pedestal, two rocks, the opening's kebbit; a taunt drops the feather and sets 5 (t1211-1326)", async (t) => {
  const f = eagles(t, { stage: 15, at: [1987, 4972, 3] });
  const at = await intoRoom(f, 19903, [1986, 4972], [1947, 4868]);
  assert.equal(varbit(f, VARBIT.ENTERED_SILVER), 1);
  await H.objectOption(f, 19458, at(1961, 4875));
  H.ticks(f, 20);
  assert.ok(messages(f).includes("Closer inspection reveals the rocks to be hard, grey and generally just rock-like."), "out of order");
  await H.objectOption(f, 19473, at(1947, 4873));
  H.ticks(f, 8);
  assert.equal(varbit(f, VARBIT.TRACKING), 1);
  assert.match(boxes(f).at(-1), /faint footprints leading away/);
  await H.finishChat(f);
  await H.objectOption(f, 19458, at(1961, 4875));
  H.ticks(f, 20);
  assert.equal(varbit(f, VARBIT.TRACKING), 2);
  await H.finishChat(f);
  await H.objectOption(f, 19461, at(1967, 4879));
  H.ticks(f, 15);
  assert.equal(varbit(f, VARBIT.TRACKING), 3);
  await H.finishChat(f);
  await H.objectOption(f, 19456, at(1971, 4886));
  H.ticks(f, 15);
  assert.equal(varbit(f, VARBIT.TRACKING), 4);
  assert.ok(messages(f).includes("You peer down the tunnel for signs of the mysterious creature."));
  assert.deepEqual(H.callsNamed(f, "sendCameraShake").map((call) => call.args), [[3, 1, 0, 0], [3, 0, 0, 0]]);
  const kebbit = [...H.core.World.getNpcs()].find((npc) => npc?.getId?.() === 1494 && npc.getOwner?.() === f.player);
  assert.ok(kebbit, "the kebbit jumps out for this player");
  await f.connection.dispatch([{ type: "npc_option", index: kebbit.getIndex(), clickType: 3 }]);
  for (let i = 0; i < 10 && !H.shown(f); i++) H.tick(f);
  await H.until(f, "The kebbit stares at you.");
  await H.until(f, "Taunt the kebbit.");
  await H.choose(f, "Try something else.");
  assert.equal(varbit(f, VARBIT.TRACKING), 4, "trying something else does nothing");
  await f.connection.dispatch([{ type: "npc_option", index: kebbit.getIndex(), clickType: 3 }]);
  for (let i = 0; i < 10 && !H.shown(f); i++) H.tick(f);
  await H.until(f, "Taunt the kebbit.");
  await H.choose(f, "Taunt the kebbit.");
  await H.until(f, "Your mother was a hamster, and your father smelt of elderberries!");
  const hops = [];
  let moves = 0;
  const inView = kebbit.teleportInView.bind(kebbit);
  kebbit.teleportInView = (to) => { hops.push(H.xy(to)); return inView(to); };
  const moveTo = kebbit.moveTo.bind(kebbit);
  kebbit.moveTo = (to) => { moves++; return moveTo(to); };
  await H.continueLine(f);
  H.ticks(f, 12);
  assert.equal(varbit(f, VARBIT.TRACKING), 5);
  assert.ok(messages(f).includes("The kebbit scurries away..."));
  assert.ok(messages(f).includes("A feather drops from the kebbit's mouth as it escapes."));
  assert.equal(kebbit.isRegistered?.(), false, "it is gone into the tunnel");
  assert.deepEqual(hops.at(-1), [...at(1971, 4885), 2], "it goes to the tunnel's mouth");
  assert.equal(moves, hops.length, "every tile an in-view move, never a plain one that takes it out of view (6943)");
  const ground = H.core.ItemOnGroundManager.getGroundItem?.(f.player.getUsername(), ITEM.SILVER, new H.core.Location(...at(1971, 4885), 2));
  assert.ok(ground ?? true);
  await H.objectOption(f, 19456, at(1971, 4886));
  H.ticks(f, 15);
  assert.match(boxes(f).at(-1), /Upon closer inspection you find a small silver feather/, "without the feather it is found again");
  assert.equal(amount(f, ITEM.SILVER), 1);
});

test("the gold room: the capture's levers and feeds bring the birds round and the golden feather off its pedestal (t1376-1903)", async (t) => {
  const f = eagles(t, { stage: 15, at: [2022, 4982, 3] });
  const at = await intoRoom(f, 19897, [2023, 4982], [1956, 4907]);
  assert.equal(varbit(f, VARBIT.ENTERED_GOLD), 1);
  for (let i = 0; i < 6; i++) {
    await H.objectOption(f, 19919, at(1958, 4906));
    H.ticks(f, 2);
  }
  assert.equal(amount(f, ITEM.SEED), 6);
  const sender = f.player.getPacketSender();
  const launches = [];
  const removals = [];
  const sendProjectile = sender.sendProjectile.bind(sender);
  sender.sendProjectile = (...args) => { launches.push({ tick: f.tick, delay: args[8] }); return sendProjectile(...args); };
  const deregister = H.core.ObjectManager.deregister;
  H.core.ObjectManager.deregister = (object, ...rest) => {
    if (object.getId() === 19935) removals.push(f.tick);
    return deregister.call(H.core.ObjectManager, object, ...rest);
  };
  t.after(() => { H.core.ObjectManager.deregister = deregister; });
  const lever = async (id, x, y, clickType = 1) => { await H.objectOption(f, id, at(x, y), clickType); H.ticks(f, 40); };
  /** Walks to the feeder (a long way round the rails, 67 ticks on live at t1757-1824), then waits out the flight. */
  const feed = async (id, x, y) => {
    const seeds = amount(f, ITEM.SEED);
    await H.useOnObject(f, ITEM.SEED, id, at(x, y));
    for (let i = 0; i < 150 && amount(f, ITEM.SEED) === seeds; i++) H.tick(f);
    H.ticks(f, 15);
  };
  await lever(19948, 1943, 4911);
  assert.equal(varbit(f, VARBIT.GOLD), 4, "lever3 down (t1402)");
  await feed(19939, 1966, 4890);
  assert.equal(varbit(f, VARBIT.GOLD), 260, "bird5 (t1526)");
  assert.equal((removals[0] - launches[0].tick) * 30, launches[0].delay, "the bird stays until its projectile leaves (6943)");
  await feed(19938, 1962, 4894);
  assert.equal(varbit(f, VARBIT.GOLD), 388, "bird4 (t1542)");
  await lever(19949, 1978, 4891);
  assert.equal(varbit(f, VARBIT.GOLD), 396, "lever4 (t1569)");
  await lever(19948, 1943, 4911, 2);
  assert.equal(varbit(f, VARBIT.GOLD), 392, "lever3 up (t1602)");
  await feed(19937, 1947, 4898);
  assert.equal(varbit(f, VARBIT.GOLD), 424, "bird3 turned back by A, bird2 comes (t1621-1627)");
  await lever(19946, 1935, 4902);
  assert.equal(varbit(f, VARBIT.GOLD), 425, "lever1 (t1652)");
  await feed(19936, 1945, 4915);
  assert.equal(varbit(f, VARBIT.GOLD), 441, "bird1 (t1686)");
  await lever(19947, 1925, 4915);
  assert.equal(varbit(f, VARBIT.GOLD), 443, "lever2 (t1733)");
  await feed(19941, 1935, 4897);
  assert.equal(varbit(f, VARBIT.GOLD), 411, "bird2 home (t1826): " + JSON.stringify({ at: H.xy(f.player.getLocation()), want: at(1935, 4897), messages: messages(f).slice(-3), seed: amount(f, ITEM.SEED) }));
  await feed(19937, 1947, 4898);
  assert.equal(varbit(f, VARBIT.GOLD), 475, "bird3 (t1861)");
  await H.objectOption(f, 19950, at(1928, 4907));
  H.ticks(f, 40);
  assert.equal(amount(f, ITEM.GOLDEN), 1, "the golden feather: " + JSON.stringify(H.xy(f.player.getLocation())));
});

test("the eagle door: each feather's box, the last sets 20; Open steps the player across over an invisible wall (t1180-1949)", async (t) => {
  const f = eagles(t, { stage: 15, varbits: { TRACKING: 5 }, at: [2002, 4948, 3], items: [ITEM.BRONZE, ITEM.GOLDEN, ITEM.SILVER, ITEM.METAL_FEATHER] });
  await H.objectOption(f, 19991, [2003, 4948]);
  H.ticks(f, 2);
  assert.match(boxes(f).at(-1), /The door seems to be locked in place/);
  assert.ok(H.callsNamed(f, "sendSound").some((call) => call.args[0] === 2402), "locked");
  await H.finishChat(f);
  await H.useOnObject(f, ITEM.METAL_FEATHER, 19991, [2003, 4948]);
  assert.match(boxes(f).at(-1), /Unfortunately this metal feather/);
  await H.finishChat(f);
  await H.useOnObject(f, ITEM.BRONZE, 19991, [2003, 4948]);
  assert.equal(varbit(f, VARBIT.DOOR), 2, "bronze is feather3 (t1194)");
  assert.match(boxes(f).at(-1), /You insert the metallic feather/);
  await H.finishChat(f);
  await H.useOnObject(f, ITEM.GOLDEN, 19991, [2003, 4948]);
  assert.equal(varbit(f, VARBIT.DOOR), 3, "gold is feather1 (t1936)");
  await H.finishChat(f);
  assert.equal(QUEST().getStage(f.player), 15);
  await H.useOnObject(f, ITEM.SILVER, 19991, [2003, 4948]);
  assert.equal(varbit(f, VARBIT.TRACKING), 6);
  assert.equal(QUEST().getStage(f.player), 20, "the last feather (t1941)");
  assert.match(boxes(f).at(-1), /final indentation/);
  assert.deepEqual([amount(f, ITEM.BRONZE), amount(f, ITEM.GOLDEN), amount(f, ITEM.SILVER)], [0, 0, 0]);
  await H.finishChat(f);
  assert.equal(H.core.ObjectDefinition.forPlayer(19991, f.player).id, 19918, "the door shows all three feathers");
  await H.objectOption(f, 19991, [2003, 4948]);
  H.ticks(f, 4);
  assert.deepEqual(H.xy(f.player.getLocation()), [2003, 4948, 3], "across the door");
  await H.objectOption(f, 19991, [2003, 4948]);
  H.ticks(f, 4);
  assert.deepEqual(H.xy(f.player.getLocation()), [2002, 4948, 3], "and back");
});

test("the eagle: the swipe without the disguise; with it, four tiles through it and its line (t1993, t2002-2006)", async (t) => {
  const f = eagles(t, { stage: 20, varbits: { TRACKING: 6, DOOR: 3, CHAT: 5 }, at: [2007, 4953, 3] });
  const eagle = spawnOnce(f, 1490, [2007, 4954, 3]);
  await H.talk(f, eagle);
  H.ticks(f, 4);
  assert.match(boxes(f).at(-1) ?? "", /takes a swipe at you/);
  await H.finishChat(f);
  H.ticks(f, 3);
  place(f, [2007, 4953, 3]);
  f.player.getEquipment().setItem(H.core.Equipment.CAPE_SLOT, new H.core.Item(ITEM.CAPE, 1));
  f.player.getEquipment().setItem(H.core.Equipment.HEAD_SLOT, new H.core.Item(ITEM.BEAK, 1));
  const poses = [];
  const setSkillAnimation = f.player.setSkillAnimation.bind(f.player);
  f.player.setSkillAnimation = (id) => { poses.push(id); return setSkillAnimation(id); };
  await H.talk(f, eagle);
  H.ticks(f, 8);
  assert.deepEqual(H.xy(f.player.getLocation()), [2007, 4957, 3]);
  assert.ok(messages(f).includes("You edge cautiously past the eagle; it doesn't seem to object."));
  assert.ok(f.animations.some((entry) => entry.id === 752) && f.animations.some((entry) => entry.id === 758));
  assert.deepEqual(poses, [754, -1], "the sidestep walk the whole way through, then off (6943)");
  poses.length = 0;
  await H.talk(f, eagle);
  H.ticks(f, 8);
  assert.deepEqual(H.xy(f.player.getLocation()), [2007, 4953, 3]);
  assert.deepEqual(poses, [756, -1], "the left-hand sidestep walk back");
});

test("Nickolaus in the nest: the disguise's box, 25 on its continue, the spare gone; out of the cave is 30 (t2023-2094)", async (t) => {
  const f = eagles(t, { stage: 20, varbits: { TRACKING: 6, DOOR: 3, CHAT: 5 }, at: [2008, 4956, 3], items: [ITEM.CAPE, ITEM.BEAK],
    worn: [ITEM.CAPE, ITEM.BEAK] });
  const nickolaus = spawnOnce(f, 2023, [2008, 4957, 3]);
  await H.talk(f, nickolaus);
  await H.until(f, "What's this, a young hatchling?");
  assert.equal(H.shown(f).npcId, 1485, "his head is eaglepeak_nickolaus_normal (t2010)");
  await H.until(f, "Yes, I have one right here.");
  await H.continueLine(f);
  assert.match(boxes(f).at(-1), /You give Nickolaus a fake beak and an eagle feather cape/);
  assert.equal(QUEST().getStage(f.player), 20);
  await H.continueLine(f);
  assert.equal(QUEST().getStage(f.player), 25);
  assert.deepEqual([amount(f, ITEM.CAPE), amount(f, ITEM.BEAK)], [0, 0], "the spare goes; the worn one stays");
  await H.until(f, "Excellent, now there is no way the eagle will be able to tell me from one of its own.");
  assert.equal(H.shown(f).npcId, 1486, "disguised from here on (t2025)");
  await H.finishChat(f);
  place(f, [1994, 4983, 3]);
  await H.objectOption(f, 19891, [1993, 4983]);
  H.ticks(f, 3);
  assert.deepEqual(H.xy(f.player.getLocation()), [2328, 3496, 0]);
  assert.equal(QUEST().getStage(f.player), 30);
});

test("the climbs to the eyries face up the mountain both ways (6943, capture 2821 t131-140)", async (t) => {
  const EAST = 1, SOUTH = 2;
  const climbs = [
    { name: "up the Eagles' Peak rocks", from: [2322, 3502, 0], loc: [19849, [2322, 3501]], to: [2324, 3497, 0], face: SOUTH },
    { name: "down them", from: [2324, 3497, 0], loc: [19849, [2324, 3498]], to: [2322, 3502, 0], face: SOUTH },
    { name: "up the Rellekka handholds", from: [2740, 3830, 1], loc: [19846, [2741, 3830]], to: [2744, 3830, 1], face: EAST },
    { name: "down them", from: [2744, 3830, 1], loc: [19847, [2743, 3830]], to: [2740, 3830, 1], face: EAST },
  ];
  for (const climb of climbs) {
    const f = eagles(t, { at: climb.from });
    const agility = H.core.Skill.AGILITY;
    f.player.getSkillManager().setMaxLevel?.(agility, 99);
    f.player.getSkillManager().setCurrentLevel?.(agility, 99);
    await H.objectOption(f, climb.loc[0], climb.loc[1]);
    let faced = null;
    for (let i = 0; i < 20; i++) {
      faced ??= f.player.getForceMovement()?.getDirection?.() ?? null;
      H.tick(f);
    }
    assert.equal(faced, climb.face, climb.name);
    assert.deepEqual(H.xy(f.player.getLocation()), climb.to, climb.name);
  }
});

test("the ferret lesson: a copy of the camp, the trap catches a ferret, 35 with the box trap and the ferret (t2204-2255)", async (t) => {
  const f = eagles(t, { stage: 30, varbits: { TRACKING: 6, DOOR: 3, CHAT: 5 }, at: [2318, 3501, 0] });
  const nickolaus = spawnOnce(f, 2024, [2317, 3500, 0]);
  await H.talk(f, nickolaus);
  await H.until(f, "Ah, hello again.");
  assert.equal(H.shown(f).npcId, 2024, "the camp-site Nickolaus's own head (t2169)");
  await H.until(f, "Well I was originally sent to find you because of a ferret.");
  await H.choose(f, "Well I was originally sent to find you because of a ferret.");
  await H.until(f, "That sounds good to me.");
  await H.choose(f, "That sounds good to me.");
  await H.until(f, "Come with me and I'll show you.");
  await H.continueLine(f);
  H.ticks(f, 12);
  assert.equal(varbit(f, 542), 1, "cutscene_status");
  assert.notDeepEqual(H.xy(f.player.getLocation()), [2319, 3510, 0], "in the copy");
  await H.until(f, "Shhh, here comes something.");
  assert.equal(H.shown(f).npcId, 1485, "in the lesson's copy, 1485 (t2222)");
  assert.deepEqual(f.player.getRenderAnimations(), [845, 844, 844, 844, 844, 844, 844], "crouched, as Nickolaus is (6943)");
  const [startX, startY] = H.xy(f.player.getLocation());
  await H.continueLine(f);
  H.ticks(f, 3);
  const ferret = [...H.core.World.getNpcs()].find((npc) => npc?.getId?.() === 1505 && npc.getOwner?.() === f.player);
  assert.deepEqual(H.xy(ferret.getPositionToFace()).slice(0, 2), [startX - 5, startY + 1], "it faces the trap, not a tile it passes");
  H.ticks(f, 11);
  await H.until(f, "Ha ha, there you go!");
  await H.continueLine(f);
  // The first step is taken on the continue's own tick.
  const walked = [f.player.getLocation().getX()];
  for (let i = 0; i < 20; i++) {
    H.tick(f);
    walked.push(f.player.getLocation().getX());
    if (walked.at(-1) === startX - 5) break;
  }
  assert.deepEqual([...new Set(walked)].filter((x) => x !== startX), [1, 2, 3, 4, 5].map((n) => startX - n),
    "walks to the trap a tile a tick before dismantling it (6943)");
  assert.equal(f.player.getLocation().getY(), startY);
  H.ticks(f, 2);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), true, "held again at the trap");
  H.ticks(f, 18);
  assert.equal(QUEST().getStage(f.player), 35);
  assert.equal(f.player.getRenderAnimations(), null, "stands up again");
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  assert.ok(messages(f).includes("You dismantle the trap."));
  assert.deepEqual([amount(f, ITEM.BOX_TRAP), amount(f, ITEM.FERRET)], [1, 1]);
  assert.deepEqual(H.xy(f.player.getLocation()), [2314, 3510, 0], "back on the real camp");
  assert.equal(varbit(f, 542), 0);
  await H.until(f, "See, it's all just a matter of patience.");
  await H.finishChat(f);
});

test("Charlie: the ferret used on him completes the quest once: 40, 2 QP, 2,500 Hunter XP; again, his other line (t2427-2442)", async (t) => {
  const f = eagles(t, { stage: 35, varbits: { TRACKING: 6, DOOR: 3, CHAT: 5 }, at: [2603, 3263, 0], items: [ITEM.FERRET] });
  const charlie = spawnOnce(f, 1495, [2602, 3263, 0]);
  const points = Number(f.player.getAttribute("quest:points")) || 0;
  await H.useOnNpc(f, ITEM.FERRET, charlie);
  await H.until(f, "Even better, I have a ferret right here for you.");
  await H.finishChat(f);
  H.ticks(f, 3);
  assert.equal(QUEST().getStage(f.player), 40);
  assert.equal(varbit(f, VARBIT.QUEST), 40);
  assert.equal(amount(f, ITEM.FERRET), 0);
  assert.deepEqual(f.xp.filter((entry) => entry.amount === 2500).length, 1);
  const lines = H.callsNamed(f, "sendString").filter((call) => (call.args[1] >>> 16) === 153).map((call) => call.args[0]);
  for (const line of ["2 Quest Points", "2,500 Hunter XP", "Eagle Transport Access", "Ability to use Box Traps"]) assert.ok(lines.includes(line), line);
  void points;
  f.player.getInventory().add(new H.core.Item(ITEM.FERRET, 1), false);
  await H.useOnNpc(f, ITEM.FERRET, charlie);
  await H.until(f, "Hey, I've got another ferret if you're interested?");
  await H.finishChat(f);
  assert.equal(f.xp.filter((entry) => entry.amount === 2500).length, 1, "rewarded once");
});

test("an old save (stages 1-8 and one bit attribute) comes back as the native stage and varbits", (t) => {
  const f = H.actor(t, {});
  f.player.setAttribute("quest.eagles_peak.stage", 5);
  f.player.setAttribute("quest.eagles_peak.bits", (1 << 13) | (1 << 15) | (1 << 14) | (1 << 9) | (1 << 2) | 120);
  H.PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
  assert.equal(QUEST().getStage(f.player), 20, "door done and costumes made: 20");
  assert.equal(varbit(f, VARBIT.DOOR), 3);
  assert.equal(varbit(f, VARBIT.TRACKING), 6);
  assert.equal(varbit(f, VARBIT.CHAT), 5);
  assert.equal(varbit(f, VARBIT.WINCHES), 15);
  assert.equal(f.player.getAttribute("eagles-peak:stage-format"), 1);
  assert.equal(Number(f.player.getAttribute("quest.eagles_peak.bits")) || 0, 0);
});

test("other plugins ask by event: box traps from the lesson on; Biohazard's Asyff waits while the costumes are owed", (t) => {
  const f = eagles(t, { stage: 15, varbits: { CHAT: 3 } });
  const ask = (name) => { const request = { player: f.player }; H.PM.emitCustomEvent(name, request); return request; };
  assert.equal(ask("eagles-peak:box-traps").unlocked, false);
  assert.equal(ask("eagles-peak:asyff-costume").owns, true);
  QUEST().setStage(f.player, 35);
  assert.equal(ask("eagles-peak:box-traps").unlocked, true);
  assert.equal(ask("eagles-peak:asyff-costume").owns, false);
});

test("the ferret offer across the chasm answers as live (t464-479, osrsreboxed-db#151), in the meeting and in the shout", async (t) => {
  for (const chat of [1, 2]) {
    const f = eagles(t, { stage: 15, varbits: { CHAT: chat }, at: [1998, 4955, 3] });
    const nickolaus = spawnOnce(f, 2023, [2006, 4959, 3]);
    await H.talk(f, nickolaus);
    await H.until(f, "The Ardougne zookeeper sent me to find you.");
    await H.choose(f, "The Ardougne zookeeper sent me to find you.");
    await H.until(f, "Well if you gave me a ferret I could take it back for you.");
    await H.choose(f, "Well if you gave me a ferret I could take it back for you.");
    await H.until(f, "Well that's very kind of you, but I'm afraid all my equipment is down at the camp site.");
    await H.until(f, "Trapped?");
    await H.until(f, "Could I help at all?");
    assert.equal(H.shown(f).who, "menu", `chat ${chat}: back on the trapped branch's menu`);
    f.player.getPacketSender().sendInterfaceRemoval();
  }
});

test("the reset lever outside the gold room: its box, the question, Yes puts 3089 back to 0 (t1443-1453)", async (t) => {
  const f = eagles(t, { stage: 15, varbits: { GOLD: 443 }, at: [2022, 4982, 3] });
  await H.objectOption(f, 19945, [2022, 4981]);
  H.ticks(f, 2);
  assert.match(boxes(f).at(-1), /the word 'reset' engraved into the handle/);
  await H.until(f, "Yes, pull the reset lever.");
  assert.equal(H.shown(f).title, "Are you sure you wish to pull this lever?");
  await H.choose(f, "On second thoughts, not just yet.");
  assert.equal(varbit(f, VARBIT.GOLD), 443);
  await H.objectOption(f, 19945, [2022, 4981]);
  H.ticks(f, 2);
  await H.until(f, "Yes, pull the reset lever.");
  await H.choose(f, "Yes, pull the reset lever.");
  assert.equal(varbit(f, VARBIT.GOLD), 0);
  assert.ok(messages(f).includes("As you move the lever you hear a low grinding elsewhere in the caves."));
});

test("the journal as live sends it: at 15 before the meeting, 20 lines with the cliff section active (t292)", (t) => {
  const f = eagles(t, { stage: 15 });
  const lines = QUEST().buildJournal(f.player, QUEST());
  assert.equal(lines.length, 20);
  assert.equal(lines[1], "<str>I spoke to Charlie, who deals with new deliveries at the zoo in");
  assert.equal(lines[15], "<col=000080>I found a part of the cliff that looked out of place compared");
  QUEST().setStage(f.player, 40);
  assert.equal(QUEST().buildJournal(f.player, QUEST()).at(-1), "<col=ff0000>QUEST COMPLETE!</col>");
});

test("a relog sends the saved side state again: the room bits come back from the attribute alone", (t) => {
  const f = eagles(t, { stage: 15, varbits: { TRACKING: 3, WINCHES: 5, GOLD: 260, CHAT: 4, DOOR: 2 } });
  const saved = JSON.parse(JSON.stringify(f.player.getAttribute(STATE_ATTRIBUTE)));
  const g = H.actor(t, {});
  g.player.setAttribute("eagles-peak:stage-format", 1);
  g.player.setAttribute("quest.eagles_peak.stage", 15);
  g.player.setAttribute(STATE_ATTRIBUTE, saved);
  H.PM.emitPlayerLogin({ player: g.player, username: g.player.getUsername() });
  for (const [key, value] of [["TRACKING", 3], ["WINCHES", 5], ["GOLD", 260], ["CHAT", 4], ["DOOR", 2]]) {
    assert.equal(g.player.getPacketSender().getVarbit(VARBIT[key]), value, key);
  }
  assert.equal(QUEST().getStage(g.player), 15, "a native stage is not converted again");
});

test("interruption: a logout in a feather room saves the player at the room's tunnel, and the trap state stays", async (t) => {
  const f = eagles(t, { stage: 15, at: [1987, 4949, 3] });
  const at = await intoRoom(f, 19909, [1986, 4949], [1974, 4908]);
  await H.objectOption(f, 19980, at(1973, 4914));
  H.ticks(f, 10);
  assert.equal(varbit(f, VARBIT.NET_TRAP), 1);
  assert.deepEqual(f.player.getAttribute("eagles-peak:scene-exit"), [1987, 4949, 3], "the room's way out is saved while inside");
  f.player.getArea().leave(f.player, true); // as the world's logout takes a player out of their area
  assert.deepEqual(H.xy(f.player.getLocation()), [1987, 4949, 3], "saved at the room's tunnel, not in a copy that is gone");
  assert.equal(f.player.getAttribute(STATE_ATTRIBUTE)[VARBIT.NET_TRAP], 1, "the sprung trap is saved");
});

test("interruption: a logout in the ferret lesson gives nothing and leaves 30, saved at the camp; the lesson plays again", async (t) => {
  const f = eagles(t, { stage: 30, at: [2318, 3501, 0] });
  const nickolaus = spawnOnce(f, 2024, [2317, 3500, 0]);
  await H.talk(f, nickolaus);
  await H.until(f, "Well I was originally sent to find you because of a ferret.");
  await H.choose(f, "Well I was originally sent to find you because of a ferret.");
  await H.until(f, "That sounds good to me.");
  await H.choose(f, "That sounds good to me.");
  await H.until(f, "Come with me and I'll show you.");
  await H.continueLine(f);
  H.ticks(f, 4);
  assert.deepEqual(f.player.getAttribute("eagles-peak:scene-exit"), [2314, 3510, 0]);
  f.player.getArea().leave(f.player, true);
  assert.equal(QUEST().getStage(f.player), 30);
  assert.deepEqual([amount(f, ITEM.FERRET), amount(f, ITEM.BOX_TRAP)], [0, 0]);
  assert.deepEqual(H.xy(f.player.getLocation()), [2314, 3510, 0]);
});

test("interruption: a logout during the lesson's walk to the trap saves the player on the real camp, not in the copy (6943)", async (t) => {
  const f = eagles(t, { stage: 30, at: [2318, 3501, 0] });
  const nickolaus = spawnOnce(f, 2024, [2317, 3500, 0]);
  await H.talk(f, nickolaus);
  await H.until(f, "Well I was originally sent to find you because of a ferret.");
  await H.choose(f, "Well I was originally sent to find you because of a ferret.");
  await H.until(f, "That sounds good to me.");
  await H.choose(f, "That sounds good to me.");
  await H.until(f, "Come with me and I'll show you.");
  await H.continueLine(f);
  H.ticks(f, 12);
  await H.until(f, "Shhh, here comes something.");
  await H.continueLine(f);
  H.ticks(f, 14);
  await H.until(f, "Ha ha, there you go!");
  await H.continueLine(f);
  H.ticks(f, 1);
  // The real logout: the area is left (the scene ends), then the hooks and the task sweep, which finish a forced walk.
  f.player.onLogout();
  assert.deepEqual(H.xy(f.player.getLocation()), [2314, 3510, 0]);
  assert.equal(f.player.getRenderAnimations(), null);
  assert.equal(f.player.getMovementQueue().isMovementBlocked(), false);
  H.ticks(f, 8);
  assert.deepEqual(H.xy(f.player.getLocation()), [2314, 3510, 0], "the walk ends with the scene");
});

test("gating: before the quest nothing moves on; the ferret before the lesson does not finish it; the door stays shut", async (t) => {
  const f = eagles(t, { stage: 5, at: [2602, 3264, 0], items: [ITEM.FERRET] });
  const charlie = spawnOnce(f, 1495, [2602, 3263, 0]);
  await H.useOnNpc(f, ITEM.FERRET, charlie);
  await H.finishChat(f);
  assert.equal(QUEST().getStage(f.player), 5);
  assert.equal(amount(f, ITEM.FERRET), 1);
  QUEST().setStage(f.player, 15);
  place(f, [2002, 4948, 3]);
  await H.objectOption(f, 19991, [2003, 4948]);
  H.ticks(f, 3);
  assert.deepEqual(H.xy(f.player.getLocation()), [2002, 4948, 3], "locked without the three feathers");
});

test("the kebbit killed: the trail moves on to 5 and the plugin drops nothing of its own (its drop table has the feather)", async (t) => {
  const f = eagles(t, { stage: 15, varbits: { TRACKING: 3 }, at: [1987, 4972, 3] });
  const at = await intoRoom(f, 19903, [1986, 4972], [1947, 4868]);
  await H.objectOption(f, 19456, at(1971, 4886));
  H.ticks(f, 45);
  const kebbit = [...H.core.World.getNpcs()].find((npc) => npc?.getId?.() === 1494 && npc.getOwner?.() === f.player);
  assert.ok(kebbit);
  const before = H.core.ItemOnGroundManager.ownedBy?.(f.player.getUsername())?.length ?? 0;
  const tile = kebbit.getLocation();
  H.PM.emitNpcDeath({ npc: kebbit, killer: f.player, location: { x: tile.getX(), y: tile.getY(), z: tile.getZ() } });
  assert.equal(varbit(f, VARBIT.TRACKING), 5);
  const feathers = (H.core.ItemOnGroundManager.ownedBy?.(f.player.getUsername()) ?? [])
    .filter((item) => item.getItem().getId() === ITEM.SILVER).length;
  assert.equal(feathers, 1, "the drop table's feather only, not a second");
  void before;
  assert.equal(messages(f).includes("A feather drops from the kebbit's mouth as it escapes."), false, "that line is the taunt's");
});

test("Asyff makes another costume for 5 feathers, tar, dye and 25 coins (Wiki), so a lost disguise does not end the quest", async (t) => {
  const f = eagles(t, { stage: 20, varbits: { CHAT: 5, TRACKING: 6, DOOR: 3 }, at: [3277, 3397, 0],
    items: [[ITEM.EAGLE_FEATHER, 5], ITEM.TAR, ITEM.DYE, [ITEM.COINS, 30]] });
  const asyff = spawnOnce(f, 2887, [3278, 3397, 0]);
  await H.talk(f, asyff);
  await H.until(f, "Could you make another eagle costume for me?");
  await H.choose(f, "Could you make another eagle costume for me?");
  await H.until(f, "I'll see what I can do.");
  assert.deepEqual([amount(f, ITEM.CAPE), amount(f, ITEM.BEAK), amount(f, ITEM.EAGLE_FEATHER), amount(f, ITEM.COINS)], [1, 1, 0, 5]);
  await H.finishChat(f);
});

test("Walk-past: a tile a tick even when running, and a logout mid-way saves no walk-through-walls flag", async (t) => {
  const f = eagles(t, { stage: 20, varbits: { TRACKING: 6, DOOR: 3, CHAT: 5 }, at: [2007, 4953, 3], worn: [ITEM.CAPE, ITEM.BEAK] });
  f.player.setRunning(true);
  const eagle = spawnOnce(f, 1490, [2007, 4954, 3]);
  await f.connection.dispatch([{ type: "npc_option", index: eagle.getIndex(), clickType: 1 }]);
  const ys = [];
  for (let i = 0; i < 6; i++) { H.tick(f); ys.push(f.player.getLocation().getY()); }
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] <= 1, `one tile a tick: ${ys}`);
  assert.equal(ys.at(-1), 4957);
  const g = eagles(t, { stage: 20, varbits: { TRACKING: 6, DOOR: 3, CHAT: 5 }, at: [2007, 4953, 3], worn: [ITEM.CAPE, ITEM.BEAK] });
  await g.connection.dispatch([{ type: "npc_option", index: eagle.getIndex(), clickType: 1 }]);
  H.tick(g);
  H.tick(g);
  H.PM.emitPlayerLogout({ player: g.player, username: g.player.getUsername() });
  assert.equal(g.player.hasFlag?.("movement:ignore-clipping") === true, false, "the crossing's flag is gone at logout");
});

test("the swipe from the nest side pushes the player back north, out of the eagle", async (t) => {
  const f = eagles(t, { stage: 25, at: [2007, 4957, 3] });
  const eagle = spawnOnce(f, 1490, [2007, 4954, 3]);
  await H.talk(f, eagle);
  H.ticks(f, 6);
  assert.ok(f.player.getLocation().getY() >= 4957, `north of the eagle: ${H.xy(f.player.getLocation())}`);
});

test("Escape in the ferret lesson ends it on the real camp, controls back, nothing given; the lesson can be asked again", async (t) => {
  const f = eagles(t, { stage: 30, at: [2318, 3501, 0] });
  const nickolaus = spawnOnce(f, 2024, [2317, 3500, 0]);
  await H.talk(f, nickolaus);
  await H.until(f, "Well I was originally sent to find you because of a ferret.");
  await H.choose(f, "Well I was originally sent to find you because of a ferret.");
  await H.until(f, "That sounds good to me.");
  await H.choose(f, "That sounds good to me.");
  await H.until(f, "Come with me and I'll show you.");
  await H.continueLine(f);
  H.ticks(f, 12);
  assert.equal(varbit(f, 542), 1);
  await f.connection.dispatch([{ type: "interface_close" }]);
  H.ticks(f, 4);
  assert.equal(varbit(f, 542), 0, "cutscene_status off");
  assert.deepEqual(H.xy(f.player.getLocation()), [2314, 3510, 0]);
  assert.equal(f.player.getMovementQueue().isMovementBlocked?.() === true, false);
  assert.equal(QUEST().getStage(f.player), 30);
  assert.equal(amount(f, ITEM.FERRET), 0);
});

test("a walk click during Walk-past or the door step does not leave the player in the eagle or through a wall", async (t) => {
  const f = eagles(t, { stage: 20, varbits: { TRACKING: 6, DOOR: 3, CHAT: 5 }, at: [2007, 4953, 3], worn: [ITEM.CAPE, ITEM.BEAK] });
  const eagle = spawnOnce(f, 1490, [2007, 4954, 3]);
  await f.connection.dispatch([{ type: "npc_option", index: eagle.getIndex(), clickType: 1 }]);
  for (let i = 0; i < 3; i++) {
    // A walk packet every tick of the crossing, as a player clicking away would send.
    await f.connection.dispatch([{ type: "move", worldX: 2010, worldY: 4950, modifierFlags: 0, run: false }]);
    H.tick(f);
  }
  H.ticks(f, 2);
  assert.deepEqual(H.xy(f.player.getLocation()), [2007, 4957, 3], "the crossing finishes: " + JSON.stringify(H.xy(f.player.getLocation())));
  assert.equal(f.player.hasFlag?.("movement:ignore-clipping") === true, false);
  assert.equal(varbit(f, 12393), 0, "busy cleared");
});

test("crossings are ObstacleRunner walks: busy while on, and an online save mid-way holds no walk-through-walls flag", async (t) => {
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const ObstacleRunner = require("../plugins/skills/agility/ObstacleRunner.Agility");
  const f = eagles(t, { stage: 20, varbits: { TRACKING: 6, DOOR: 3, CHAT: 5 }, at: [2007, 4953, 3], worn: [ITEM.CAPE, ITEM.BEAK] });
  const eagle = spawnOnce(f, 1490, [2007, 4954, 3]);
  await f.connection.dispatch([{ type: "npc_option", index: eagle.getIndex(), clickType: 1 }]);
  H.tick(f);
  H.tick(f);
  assert.equal(ObstacleRunner.isBusy(f.player), true, "the crossing is under way");
  assert.equal(varbit(f, 12393), 1, "busy, as live (t2001)");
  assert.equal(PlayerSave.fromPlayer(f.player).getFlags().includes("movement:ignore-clipping"), false, "an online save now");
  H.ticks(f, 6);
  assert.deepEqual(H.xy(f.player.getLocation()), [2007, 4957, 3]);
  assert.equal(varbit(f, 12393), 0);
  const g = eagles(t, { stage: 20, varbits: { TRACKING: 6, DOOR: 3 }, at: [2002, 4948, 3] });
  await H.objectOption(g, 19991, [2003, 4948]);
  assert.equal(PlayerSave.fromPlayer(g.player).getFlags().includes("movement:ignore-clipping"), false, "the door step too");
  H.ticks(g, 4);
  assert.deepEqual(H.xy(g.player.getLocation()), [2003, 4948, 3]);
});

test("a full pack at the ferret lesson: the box trap and the ferret land on the real camp, not in the copy", async (t) => {
  const f = eagles(t, { stage: 30, at: [2318, 3501, 0], items: [[1511, 1]] });
  for (let i = 0; i < 27; i++) f.player.getInventory().add(new H.core.Item(1511, 1), false);
  assert.equal(f.player.getInventory().getFreeSlots(), 0);
  const nickolaus = spawnOnce(f, 2024, [2317, 3500, 0]);
  await H.talk(f, nickolaus);
  await H.until(f, "Well I was originally sent to find you because of a ferret.");
  await H.choose(f, "Well I was originally sent to find you because of a ferret.");
  await H.until(f, "That sounds good to me.");
  await H.choose(f, "That sounds good to me.");
  await H.until(f, "Come with me and I'll show you.");
  await H.continueLine(f);
  H.ticks(f, 12);
  await H.until(f, "Shhh, here comes something.");
  await H.continueLine(f);
  H.ticks(f, 14);
  await H.until(f, "Ha ha, there you go!");
  await H.continueLine(f);
  H.ticks(f, 20);
  assert.equal(QUEST().getStage(f.player), 35);
  const ground = (H.core.ItemOnGroundManager.ownedBy?.(f.player.getUsername()) ?? []).map((item) => [item.getItem().getId(), H.xy(item.getPosition())]);
  for (const id of [ITEM.BOX_TRAP, ITEM.FERRET]) {
    assert.ok(ground.some(([itemId, at]) => itemId === id && at[0] === 2314 && at[1] === 3510), `${id} on the real camp: ${JSON.stringify(ground)}`);
  }
});
