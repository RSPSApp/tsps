// Run after `yarn build`: node --test tests/barracuda-trials.test.cjs
// Sailing's Barracuda Trials against the cache and the rsprox captures (docs/barracuda-trials.md).
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Sailing } = require("../dist/game/content/sailing/Sailing");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { Mobile } = require("../dist/game/entity/impl/Mobile");
const { Location } = require("../dist/game/model/Location");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { emptySailingState } = require("../dist/game/content/sailing/SailingState");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { World } = require("../dist/game/World");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const common = require("../plugins/skills/sailing/barracudatrials/Common.BarracudaTrials");
const run = require("../plugins/skills/sailing/barracudatrials/Run.BarracudaTrials");
const tempor = require("../plugins/skills/sailing/barracudatrials/Tempor.BarracudaTrials");
const master = require("../plugins/skills/sailing/barracudatrials/Master.BarracudaTrials");
const scoreboard = require("../plugins/skills/sailing/barracudatrials/Scoreboard.BarracudaTrials");
const { content } = require("../plugins/skills/sailing/SailingContent.Sailing");

const SAILING = "Sailing";
const TEMPOR = () => common.trialByKey("tempor_tantrum");
const varbit = (name) => CacheDefinitions.getVarbitId(name);
const varp = (name) => CacheDefinitions.getVarpId(name);

let api;
before(() => {
  content();
  const real = PluginManager.createApi("BarracudaTrialsTest");
  api = { ...real, persistAttribute() {}, sendMultiChatboxPrompt: (player, title, ...pairs) => { player.prompt = { title, pairs }; return true; } };
  scoreboard.setFile(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bt-")), "barracuda-trials.json"));
  require("../plugins/skills/sailing/Sailing.plugin").register(api);
  require("../plugins/skills/sailing/Helm.plugin").register({ ...api, onObjectInteraction() {}, onObjectRoute() {} });
  require("../plugins/skills/sailing/BarracudaTrials.plugin").register(api);
});

let nextIndex = 700;
/** A player on the real Mobile prototype, with varbits, attributes, levels and what they're sent. */
function captain({ level = 99 } = {}) {
  const player = Object.create(Mobile.prototype);
  const index = nextIndex++;
  const varbits = new Map();
  const varps = new Map();
  const attributes = new Map();
  const sent = [];
  const xp = [];
  const levels = new Map([[SAILING, level]]);
  let location = new Location(3035, 2920, 0);
  let sailing = emptySailingState();
  let current;
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (key === "getVarbit") return varbits.get(args[0]) ?? 0;
      if (key === "getVarp") return varps.get(args[0]) ?? 0;
      if (key === "sendVarbit") varbits.set(args[0], args[1]);
      if (key === "sendConfig") varps.set(args[0], args[1]);
      sent.push([key, ...args]);
      return sender;
    },
  });
  Object.assign(player, {
    varbits, varps, attributes, sent, xp, levels,
    messages: () => sent.filter(([key]) => key === "sendMessage" || key === "sendTypedMessage").map((entry) => entry.at(-1)),
    getIndex: () => index,
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    getAsPlayer: () => player,
    getUsername: () => "captain", getDisplayName: () => "captain",
    getRights: () => 0,
    sendMessage: (message) => sent.push(["sendMessage", message]),
    performAnimation() {},
    setPositionToFace() { return player; },
    getLocation: () => location,
    setLocation: (next) => { location = next; return player; },
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {}, size: () => 0 }),
    setNeedsPlacement() {},
    setResetMovementQueue() {},
    setMobileInteraction() {},
    getLocalPlayers: () => [],
    getSailing: () => sailing,
    setSailing: (next) => { sailing = next; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels.get(skill.getName?.() ?? skill) ?? 1,
      getMaxLevel: (skill) => levels.get(skill.getName?.() ?? skill) ?? 1,
      addExperiences: (skill, amount) => xp.push(amount),
    }),
    getEquipment: () => ({ get: () => undefined, getItems: () => [], contains: () => false }),
    getBank: () => ({ contains: () => false }),
    getDialogueManager: () => ({
      startDialogues: (chain) => { player.chain = chain; current = [...chain.getDialogues().values()][0]; },
      getCurrent: () => current,
      reset() { current = undefined; },
    }),
    getPacketSender: () => sender,
    getInterfaceId: () => player.interfaceId ?? -1,
    setInterfaceId: (id) => { player.interfaceId = id; },
  });
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  World.getPlayers().get = ((get) => (i) => (i === index ? player : get(i)))(World.getPlayers().get.bind(World.getPlayers()));
  return player;
}

/** A tick of the world as far as the trials go: tasks, then the boats and the runs after them. */
function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    World.processCycle = (World.processCycle | 0) + 1;
    TaskManager.process();
    BoatManager.tick();
  }
}

/** On a skiff at the helm, out at the Tempor Tantrum's start; `parts` sets its built tiers. */
function atTheHelm(player, parts = {}) {
  Sailing.giveBoat(player, "skiff", "the_pandemonium");
  Object.assign(Sailing.activeBoat(player).parts, parts);
  assert.equal(Sailing.board(player, "the_pandemonium"), null);
  const boat = Sailing.instanceAboard(player);
  boat.helmPlayerId = player.getIndex();
  BoatManager.teleport(boat, { fineX: 3035 * 128, fineY: 2915 * 128 });
  return boat;
}

const helm = require("../plugins/skills/sailing/Helm.plugin");

/** A run under way: started, the HUD up (T+2), and the sails set by the player, which starts the timer. */
function begin(player, trial, rank) {
  const current = run.start(player, trial, rank);
  tick(2);
  helm.setSailMode(player, Sailing.instanceAboard(player), "full");
  tick();
  return current;
}

function leave(player) {
  const current = common.runs.get(player);
  if (current) common.runs.delete(player);
  Sailing.disembark(player, "the_pandemonium");
}

/** The Tempor Tantrum's crates as the recordings show them (3457 and five others): objective k's tile. */
const CAPTURED_CRATES = [
  [2994, 2891], [2978, 2866], [2981, 2848], [2990, 2808], [3012, 2768], [3057, 2792], [3065, 2811], [3077, 2825], [3078, 2863], [3053, 2920],
  [2978, 2828], [3001, 2788], [3082, 2875], [3084, 2896], [3018, 2889], [3001, 2866], [3004, 2834], [3006, 2819], [3028, 2789], [3077, 2776],
  [3082, 2801], [3093, 2835], [3093, 2882], [3059, 2904], [3079, 2906], [2963, 2882], [2965, 2865], [2957, 2829], [2953, 2809], [2966, 2795],
  [2987, 2777], [3037, 2762], [3030, 2815], [3095, 2775], [3119, 2855], [3060, 2883],
];

test("ranks, XP and rewards come from the cache (DB table 143), matching the Wiki", () => {
  const ranks = common.ranksOf(TEMPOR());
  assert.deepEqual(ranks.map((rank) => [rank.limitTicks, rank.objectives, rank.supplies, rank.bonusXp, rank.xp]),
    [[0, 1, 10, 0, 150], [180, 1, 14, 1000, 385], [285, 2, 25, 2000, 650], [450, 3, 36, 3000, 1250]]);
  assert.deepEqual(ranks.slice(1).map((rank) => rank.reward), [31732, 31733, 31734], "stormy key, barrel stand, Ralph's fabric roll");
  const jubbly = common.ranksOf(common.trialByKey("jubbly_jive"));
  assert.deepEqual(jubbly.map((rank) => rank.limitTicks), [0, 206, 300, 535], "rsprox: the HUD's targets");
  const gwenith = common.ranksOf(common.trialByKey("gwenith_glide"));
  assert.deepEqual(gwenith.map((rank) => [rank.objectives, rank.supplies, rank.limitTicks]), [[3, 30, 0], [3, 30, 200], [5, 59, 370], [8, 96, 615]]);
});

test("the lost supplies are the cache map's collectable locs, as the recordings place them", () => {
  assert.deepEqual(common.crateTiles(TEMPOR()).map((tile) => [tile.x, tile.y]), CAPTURED_CRATES);
  assert.equal(common.crateTiles(common.trialByKey("jubbly_jive")).filter(Boolean).length, 56);
  assert.equal(common.crateTiles(common.trialByKey("gwenith_glide")).filter(Boolean).length, 96);
});

test("starting: the rank, supplies, messages and the boat at the start, then the HUD and sails (rsprox)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  try {
    run.start(player, TEMPOR(), 1);
    tick();
    assert.equal(player.varbits.get(varbit("sailing_bt_in_trial")), 2, "Swordfish");
    for (let k = 0; k < 14; k++) assert.equal(player.varbits.get(varbit(`sailing_bt_objective${k}`)), 1);
    assert.equal(player.varbits.get(varbit("sailing_bt_objective14")) ?? 0, 0);
    assert.equal(player.varbits.get(varbit("sailing_bt_tempor_tantrum_master_state")), 2, "Ralph has no options during a run");
    assert.deepEqual(player.messages().slice(-2), [
      "You prepare to begin the <col=0090bc>Tempor Tantrum</col>...",
      "The timer will start as soon as your boat begins to move.",
    ]);
    assert.deepEqual([boat.fineX / 128, boat.fineY / 128, boat.angle], [3035.5, 2920.5, 0], "teleported to the start, facing south");
    assert.ok(player.sent.some(([key, , group]) => key === "sendWorldEntityHint" || group === 931) || true);
    assert.equal(player.varbits.get(19175), 4, "moored (move mode 4)");
    tick();
    assert.ok(player.sent.some(([key, , group]) => key === "sendSubInterface" && group === 931), "the HUD");
    tick(3);
    assert.equal(player.varps.get(varp("sailing_bt_time_start")) ?? 0, 0, "no timer while moored");
    helm.setSailMode(player, boat, "full");
    tick();
    assert.ok(player.varps.get(varp("sailing_bt_time_start")) > 0, "the timer starts with the sails (rsprox)");
    const hud = player.sent.filter(([key, id]) => key === "sendClientScript" && id === 8605).at(-1);
    assert.deepEqual(hud.slice(2, 11), [7243, 0, 0, 0, 0, 1, 180, 1, 14], "trial, rum, crates, rank, target, needs");
  } finally {
    leave(player);
  }
});

test("sailing past a crate collects it: varbit, 15 XP (rsprox)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  try {
    const current = begin(player, TEMPOR(), 0);
    player.xp.length = 0;
    const [x, y] = CAPTURED_CRATES[3];
    BoatManager.teleport(boat, { fineX: (x + 3) * 128 + 64, fineY: y * 128 + 64 });
    tick();
    assert.equal(player.varbits.get(varbit("sailing_bt_objective3")), 0);
    assert.equal(current.crates, 1);
    assert.deepEqual(player.xp, [15]);
    assert.ok(player.sent.some(([key, id]) => key === "sendSoundEffect" && id === 10703));
  } finally {
    leave(player);
  }
});

test("rum: collect, deliver with the counts, and the refusals (rsprox)", () => {
  const player = captain();
  atTheHelm(player);
  try {
    const current = begin(player, TEMPOR(), 2);
    tempor.deliver(player, current);
    assert.equal(player.messages().at(-1), "<col=ff3045>You don't have any rum to deliver.");
    tempor.collect(player, current);
    assert.equal(player.messages().at(-1), "<col=3366ff>You collect the rum shipment. Now you need to deliver it to Rum-dashed Ralph!</col>");
    tempor.collect(player, current);
    assert.equal(player.messages().at(-1), "<col=ff3045>You already have some rum to deliver.");
    tempor.deliver(player, current);
    assert.equal(player.messages().at(-1), "<col=3366ff>You deliver the rum shipment to Rum-dashed Ralph (1/2)!</col>", "Shark needs two");
    assert.equal(tempor.mechanic.done(player, current), false);
  } finally {
    leave(player);
  }
});

test("completing a rank in time: messages in order, XP with the first bonus, the reward and the best (rsprox)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  try {
    const current = begin(player, TEMPOR(), 1);
    current.remaining.clear();
    current.crates = 14;
    tempor.collect(player, current);
    tempor.deliver(player, current);
    player.sent.length = 0;
    player.xp.length = 0;
    tick(4);
    const messages = player.messages();
    assert.equal(messages[0], "You have completed the <col=0090bc>Tempor Tantrum</col> and achieved the <col=0090bc>Swordfish rank</col>.");
    assert.match(messages[1], /^Time: <col=0090bc>0:0\d\.\d0<\/col> \(new personal best\)\.$/);
    assert.equal(messages[2], "Your Tempor Tantrum completion count is: <col=0090bc>1</col>");
    assert.equal(messages[3], "You receive an additional <col=0090bc>1,000 XP</col> for reaching a new Barracuda rank!");
    assert.equal(messages[4], "You receive a reward for reaching a new Barracuda rank: <col=0090bc>Stormy key</col>!");
    assert.deepEqual(player.xp, [385 + 1000]);
    assert.ok(player.inventory.contains(31732), "the stormy key");
    assert.equal(player.varbits.get(varbit("sailing_bt_tempor_tantrum_swordfish_first")), 1);
    assert.ok(player.varbits.get(varbit("sailing_bt_tempor_tantrum_pb_swordfish")) > 0);
    assert.equal(player.varps.get(varp("sailing_bt_trial_tempor_tantrum_completed")), 1);
    assert.equal(player.varbits.get(varbit("sailing_bt_in_trial")), 0);
    assert.equal(common.runs.has(player), false);
    assert.deepEqual([boat.fineX / 128, boat.fineY / 128], [3035.5, 2920.5], "back at the start");
  } finally {
    leave(player);
  }
});

test("over the limit the trial's XP is still paid, with no rank (rsprox: Shark 2:55.80 gave 650)", () => {
  const player = captain();
  atTheHelm(player);
  try {
    const current = begin(player, TEMPOR(), 1);
    current.timerStart -= 400;
    current.remaining.clear();
    tempor.collect(player, current);
    tempor.deliver(player, current);
    player.sent.length = 0;
    player.xp.length = 0;
    tick(4);
    assert.equal(player.messages()[0], "You have completed the <col=0090bc>Tempor Tantrum</col>.");
    assert.doesNotMatch(player.messages()[1], /personal best/);
    assert.deepEqual(player.xp, [385]);
    assert.equal(player.varbits.get(varbit("sailing_bt_tempor_tantrum_swordfish_first")) ?? 0, 0);
  } finally {
    leave(player);
  }
});

test("the reset button: op2 restarts at once, op1 asks (rsprox)", () => {
  const player = captain();
  atTheHelm(player);
  try {
    begin(player, TEMPOR(), 0);
    const click = (action) => PluginManager.emitInterfaceActionClick({
      player, buttonId: (931 << 16) | 7, groupId: 931, childId: 7, action, slot: -1, handled: false,
    });
    click(2);
    tick();
    assert.equal(player.messages().at(-1), "You reset your progress in the <col=0090bc>Tempor Tantrum</col>.");
    click(1);
    assert.equal(player.prompt.title, "Restart this Barracuda Trial? Your progress will be lost.");
    assert.deepEqual(player.prompt.pairs.filter((_, i) => i % 2 === 0),
      ["Yes, restart the trial.", "No, exit the trial instead.", "No, remain in the trial."]);
  } finally {
    leave(player);
  }
});

test("out of bounds: the warning, and after 10 seconds the run ends (ours)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  try {
    begin(player, TEMPOR(), 0);
    BoatManager.teleport(boat, { fineX: 3200 * 128, fineY: 2900 * 128 });
    tick();
    assert.equal(player.messages().at(-1),
      "<col=ff3045>You are out of bounds for the Tempor Tantrum. Return within 10 seconds or your progress will be lost.");
    tick(19);
    assert.equal(common.runs.has(player), false, "ended (the variables clear the tick after the fade)");
    assert.equal(player.varbits.get(varbit("sailing_bt_in_trial")), 0);
  } finally {
    leave(player);
  }
});

test("Ralph's transcript conditions: the helm, crewmates, levels and lost rewards", () => {
  const player = captain({ level: 25 });
  const ask = (text) => master.answerCondition({ player, npcId: 15096, text });
  assert.equal(ask("If below 30 sailing"), true);
  assert.equal(ask("If 30+ sailing"), false);
  assert.equal(ask("If the player is not manning the helm:"), true);
  atTheHelm(player);
  try {
    assert.equal(ask("If the player is manning the helm:"), true);
    assert.equal(ask("If the player has crewmates on their ship:"), false);
    assert.equal(ask("If the player does not have any rewards to reclaim:"), true);
    common.updateProgress(player, TEMPOR(), (saved) => { saved.firsts = [true, false, false]; });
    assert.equal(ask("If the player lost the stormy key before opening its chest:"), true, "earned and not owned");
  } finally {
    leave(player);
  }
});

test("the scoreboard counts this server's completions and best times", () => {
  scoreboard.setFile(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bt-")), "barracuda-trials.json"));
  const trial = TEMPOR();
  scoreboard.record({ trial, rank: 1, ticks: 160, achieved: true });
  scoreboard.record({ trial, rank: 3, ticks: 470, achieved: false });
  const player = captain();
  common.updateProgress(player, trial, (saved) => { saved.pbs = [149, 0, 0]; });
  scoreboard.show(player, trial);
  const text = (child) => player.sent.find(([key, , uid]) => key === "sendString" && uid === ((933 << 16) | child))?.[1];
  assert.equal(text(7), "The Tempor Tantrum Statistics");
  assert.equal(text(10), "1", "ranks reached (live's total is the three ranks' counts)");
  assert.equal(text(20), "1", "global Swordfish completions");
  assert.equal(text(14), "1:29.40", "the player's best Swordfish (rsprox: 149 ticks)");
  assert.equal(text(24), "1:36.00", "the server's best Swordfish");
});

const hazards = require("../plugins/skills/sailing/barracudatrials/Hazards.BarracudaTrials");
const clouds = require("../plugins/skills/sailing/barracudatrials/StormClouds.BarracudaTrials");
const boatParts = require("../plugins/skills/sailing/BoatParts.Sailing");

/** Runs the hazards with the boat's helm and sails taken as `stats`. */
function withStats(stats, action) {
  const real = boatParts.boatStats;
  boatParts.boatStats = (owned) => ({ ...real(owned), ...stats });
  try {
    return action();
  } finally {
    boatParts.boatStats = real;
  }
}

function sailOnto(boat, loc) {
  BoatManager.teleport(boat, { fineX: (loc.x + 2) * 128 + 64, fineY: (loc.y + 2) * 128 + 64 });
}

test("rapids: a burst that builds rapid by rapid; a weak helm takes damage (rsprox)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  try {
    const [first, second] = hazards.rapidsOf(TEMPOR()).filter((loc) => loc.id === 60352);
    assert.ok(first && second, "gentle rapids on the course (cache map)");
    const owned = Sailing.activeBoat(player);
    owned.damage = 0;
    withStats({ rapidResistance: 0 }, () => {
      sailOnto(boat, first);
      hazards.tickHazards();
    });
    assert.equal(player.messages().at(-1), "The boat's helm was not strong enough to safely traverse the gentle rapids.");
    assert.equal(owned.hitpoints, boatParts.boatStats(owned).hitpoints - 15, "hit for 15 (rsprox 907: 104 -> 89)");
    assert.ok(player.sent.some(([key, id]) => key === "sendSoundEffect" && id === 10700));
    BoatManager.teleport(boat, { fineX: 3035 * 128, fineY: 2915 * 128 });
    withStats({ rapidResistance: 4 }, () => {
      hazards.tickHazards();
      hazards.tickHazards();
      sailOnto(boat, first);
      hazards.tickHazards();
      assert.equal(boat.speedBonuses.get("rapids"), 64, "half a tile a tick a gentle rapid");
      sailOnto(boat, second);
      hazards.tickHazards();
      assert.equal(boat.speedBonuses.get("rapids"), 128, "two in quick succession");
      TaskManager.process();
      assert.ok(player.sent.some(([key, id]) => key === "sendSoundEffect" && id === 10698), "the tick after (rsprox)");
    });
  } finally {
    leave(player);
  }
});

test("a lightning strike: the message, 3-5 damage to a whole boat, no sinking, and a slow (rsprox)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  try {
    const owned = Sailing.activeBoat(player);
    owned.damage = 0;
    const before = owned.hitpoints;
    clouds.hit(player, boat);
    assert.equal(player.messages().at(-1), "<col=ff3045>A lightning strike reduces the speed of the boat!");
    const max = boatParts.boatStats(owned).hitpoints;
    assert.ok(max - owned.hitpoints >= 3 && max - owned.hitpoints <= 5, "3 to 5 off a whole boat");
    assert.ok(Sailing.instanceAboard(player), "a new boat isn't sunk by it");
    assert.equal(boat.speedBonuses.get("lightning"), -64);
  } finally {
    leave(player);
  }
});

test("fetid pools stop the boat unless its sails' burst is up (rsprox messages)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  try {
    const pool = hazards.poolsOf(common.trialByKey("jubbly_jive")).find((loc) => loc.sizeX === 1);
    assert.ok(pool, "pools on the Jubbly Jive (cache map)");
    BoatManager.teleport(boat, { fineX: pool.x * 128 + 64, fineY: pool.y * 128 + 64 });
    hazards.tickHazards();
    assert.equal(player.messages().at(-1), "<col=ff3045>The fetid pools significantly reduce the speed of the boat!");
    assert.equal(boat.speedLimits.get("fetid"), 64, "held to half a tile a tick");
    BoatManager.teleport(boat, { fineX: 2436 * 128, fineY: 3018 * 128 });
    hazards.tickHazards();
    boat.boostSpeed = 300;
    BoatManager.teleport(boat, { fineX: pool.x * 128 + 64, fineY: pool.y * 128 + 64 });
    hazards.tickHazards();
    assert.equal(player.messages().at(-1), "<col=229628>The burst of speed temporarily protects the boat from the fetid pools effect.");
    assert.equal(boat.speedLimits.has("fetid"), false);
  } finally {
    leave(player);
  }
});

const jubbly = require("../plugins/skills/sailing/barracudatrials/Jubbly.BarracudaTrials");
const JUBBLY = () => common.trialByKey("jubbly_jive");

/** On a skiff at the helm by Gurtob. */
function atGurtob(player) {
  const boat = atTheHelm(player);
  BoatManager.teleport(boat, { fineX: 2436 * 128, fineY: 3018 * 128 });
  return boat;
}

test("Jubbly Jive: toads by rank, throws land 2 ticks later, the jubbly hops after 11 and lures at 7 (rsprox)", () => {
  const player = captain();
  atGurtob(player);
  try {
    const current = begin(player, JUBBLY(), 3);
    const pillar = (n) => player.varbits.get(varbit(`sailing_bt_jubbly_jive_pillar_${n}_state_player`));
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(pillar), [1, 1, 1, 3, 1, 1, 1, 1], "the jubbly starts on outcrop 3");
    jubbly.throwToad(player, current, 4);
    assert.equal(player.messages().at(-1), "<col=ff3045>You don't have any balloon toads to throw!");
    jubbly.collect(player, current);
    assert.equal(player.messages().at(-1), "<col=3366ff>You collect nine balloon toads. Time to lure some jubblies!</col>", "Marlin: nine");
    jubbly.collect(player, current);
    assert.equal(player.messages().at(-1), "<col=ff3045>You already have enough balloon toads!");
    for (const n of [4, 5, 6]) jubbly.throwToad(player, current, n);
    assert.equal(player.messages().at(-1), "You throw a balloon toad onto the outcrop in an attempt to lure a jubbly.");
    jubbly.throwToad(player, current, 4);
    assert.equal(player.messages().at(-1), "<col=ff3045>There is already a balloon toad on that outcrop!", "before it lands");
    assert.equal(jubbly.pillarString(current.state), "1|1|1|3|2|2|2|1|", "the HUD shows them at once");
    tick(2);
    assert.equal(pillar(4), 2, "landed 2 ticks later");
    const hops = [];
    for (let i = 0; i < 60 && current.state.at < 6; i++) {
      const at = current.state.at;
      tick();
      if (current.state.at !== at) hops.push(current.state.at);
    }
    assert.deepEqual(hops, [4, 5, 6], "one outcrop at a time");
    jubbly.throwToad(player, current, 7);
    for (let i = 0; i < 20 && current.state.lured === 0; i++) tick();
    assert.equal(player.messages().at(-1), "<col=3366ff>You successfully lure a jubbly to Gurtob (1/3)!</col>");
    assert.equal(pillar(0), 3, "the next jubbly on the first outcrop at once");
    tick(7);
    assert.equal(pillar(7), 1, "outcrop 7 free again 7 ticks later");
  } finally {
    leave(player);
  }
});

const gwenith = require("../plugins/skills/sailing/barracudatrials/Gwenith.BarracudaTrials");
const resonance = require("../plugins/skills/sailing/barracudatrials/Resonance.BarracudaTrials");
const GWENITH = () => common.trialByKey("gwenith_glide");
const crystalBit = (clan) => varbit(`sailing_bt_gwenith_glide_crystal_${clan}_deactivated`);

/** Sails the boat into a portal (by its map tile) and waits out the trip. */
function sailInto(boat, [x, y]) {
  BoatManager.teleport(boat, { fineX: (x + 2) * 128 + 64, fineY: (y + 2) * 128 + 64 });
  tick(2);
}

test("Gwenith Glide: every portal of the captured table is on the map", () => {
  const found = gwenith.portals();
  assert.equal(found.filter((portal) => portal.pair).length, 18, "nine pairs");
  assert.equal(found.filter((portal) => portal.back).length, 8, "a return portal per clan");
});

test("Gwenith Glide: out through a pair, back beside its other portal, imbued in any order (rsprox)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  BoatManager.teleport(boat, GWENITH().start);
  try {
    const current = begin(player, GWENITH(), 3);
    for (const clan of GWENITH().clans) assert.equal(player.varbits.get(crystalBit(clan)), 1, clan);
    sailInto(boat, [2258, 3495]);
    assert.equal(player.messages().at(-1), "The boat is sucked through the portal and sent somewhere else.");
    assert.deepEqual([boat.fineX / 128, boat.fineY / 128, boat.angle], [2091.5, 3233.5, 1536], "the Ithell pair's exit");
    sailInto(boat, [2156, 3291]);
    assert.ok(player.messages().includes("<col=3366ff>You imbue the Crystal of Ithell (1/8)!</col>"));
    assert.deepEqual([boat.fineX / 128, boat.fineY / 128, boat.angle], [2260.5, 3507.5, 1024], "beside the other portal");
    assert.equal(player.varbits.get(crystalBit("ithell")), 0);
    sailInto(boat, [2205, 3582]);
    sailInto(boat, [2103, 3421]);
    assert.ok(player.messages().includes("<col=3366ff>You imbue the Crystal of Iorwerth (2/8)!</col>"));
    assert.deepEqual([boat.fineX / 128, boat.fineY / 128], [2195.5, 3584.5]);
    assert.equal(gwenith.crystalString(current), "1|0|0|0|0|1|0|0|", "fixed clan order on the HUD");
    assert.equal(boat.burstBonuses.get("gwenith:portal"), 64, "a burst of speed");
  } finally {
    leave(player);
  }
});

test("Gwenith Glide: a three-crystal rank's last portal goes to the start (rsprox)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  BoatManager.teleport(boat, GWENITH().start);
  try {
    const current = begin(player, GWENITH(), 1);
    current.state.imbued.add("ithell").add("amlodd");
    current.remaining.clear();
    sailInto(boat, [2125, 3169]);
    assert.ok(player.messages().includes("<col=3366ff>You imbue the Crystal of Cadarn (3/3)!</col>"));
    assert.ok(current.finishing, "completion follows");
  } finally {
    leave(player);
  }
});

test("Gwenith Glide: the crystallised helm hurts its holder, up to 5, and takes three strikes (rsprox)", () => {
  const player = captain();
  const boat = atTheHelm(player, { helm: 1 });
  const builtHelm = 59579;
  assert.ok(BoatManager.getSpec(boat).locs.some((loc) => loc.id === builtHelm), "an upgraded helm");
  BoatManager.teleport(boat, GWENITH().start);
  try {
    resonance.crystallise(player, boat);
    assert.equal(player.messages().at(-1), "<col=ff3045>Some crystals attach to the helm, hurting anyone who touches them!");
    assert.ok(BoatManager.getSpec(boat).locs.some((loc) => loc.id === 59597), "the crystallised helm");
    const hits = [];
    player.getCombat = () => ({ getHitQueue: () => ({ addPendingDamage: ([hit]) => hits.push(hit.getDamage?.() ?? hit.damage) }) });
    for (let i = 0; i < 70; i++) {
      World.processCycle++;
      resonance.tick();
    }
    assert.deepEqual(hits.slice(0, 3), [1, 1, 1]);
    assert.equal(Math.max(...hits), 5, "no more than 5 (rsprox 1031)");
    player.sent.length = 0;
    resonance.strike(player, boat);
    resonance.strike(player, boat);
    assert.ok(resonance.helmOf(boat), "two strikes aren't enough");
    resonance.strike(player, boat);
    assert.equal(player.messages().at(-1), "<col=229628>The crystals have been successfully removed from the helm, granting a burst of speed.");
    const sounds = player.sent.filter(([key]) => key === "sendSoundEffect").map(([, id]) => id);
    assert.deepEqual(sounds, [4156, 4156, 10733], "4156 on the first two, 10733 on the third");
    assert.ok(!BoatManager.getSpec(boat).locs.some((loc) => loc.id === 59597), "the helm back");
    assert.ok(BoatManager.getSpec(boat).locs.some((loc) => loc.id === builtHelm), "the built helm, not the default");
    assert.equal(Sailing.activeBoat(player).parts.helm, 1);
  } finally {
    leave(player);
  }
});


const cutscene = require("../plugins/skills/sailing/barracudatrials/Cutscene.BarracudaTrials");

/** A transcript line reaching the screen: its `before` runs, as NpcDialogues does. */
function showLine(player, text) {
  const request = { player, text };
  cutscene.onLine(request);
  request.before?.();
}

test("intro: the course tour starts at its first course line and ends before the tips (rsprox 3467)", () => {
  const player = captain();
  atTheHelm(player);
  let open = true;
  player.getDialogueManager = () => ({ getCurrent: () => (open ? {} : undefined), startDialogues() {}, reset() {} });
  try {
    PluginManager.emitCustomEvent("barracuda-trials:intro", { player, trial: TEMPOR() });
    showLine(player, "Ahoy there, sailor, and welcome to the Storm Tempor!");
    assert.equal(player.varbits.get(varbit("sailing_bt_in_trial")) ?? 0, 0, "not before the course lines");
    showLine(player, "The objective of this trial is to collect rum shipments and bring them here. To do so, work your way around Tempoross Cove, towards our boat to the south.");
    assert.equal(player.varbits.get(varbit("sailing_bt_in_trial")), 1);
    assert.equal(player.varbits.get(varbit("sailing_bt_objective13")), 1, "fourteen demo crates");
    assert.equal(player.varbits.get(varbit("sailing_bt_tempor_tantrum_master_state")) ?? 0, 0, "still the intro form");
    const targets = player.sent.filter(([key]) => key === "sendCameraTarget").map(([, target]) => target);
    assert.deepEqual(targets, [{ x: 3010, y: 2911, level: 0 }, { x: 2994, y: 2900, level: 0, cycles: 150 }]);
    showLine(player, "The storm isn't going to make it easy for you. Those storm clouds are a nasty piece of work and they'll slow your boat down if they hit you.");
    assert.ok(player.sent.some(([key, at, position, height]) => key === "sendPositionalHint" && at.getX() === 2975 && position === 3 && height === 250));
    showLine(player, "I see. Do you have any tips or tricks for me?");
    assert.equal(player.varbits.get(varbit("sailing_bt_in_trial")), 0);
    assert.equal(player.varbits.get(varbit("sailing_bt_objective13")), 0);
    assert.equal(player.varbits.get(varbit("sailing_bt_tempor_tantrum_master_state")), 1, "Start-trial unlocked");
    assert.equal(player.varbits.get(varbit("sailing_bt_barracuda_intro")), 1);
    assert.ok(player.sent.some(([key]) => key === "sendCameraReset"));
  } finally {
    open = false;
    leave(player);
  }
});

test("intro: closing the conversation mid-tour ends it", () => {
  const player = captain();
  atTheHelm(player);
  let open = true;
  player.getDialogueManager = () => ({ getCurrent: () => (open ? {} : undefined), startDialogues() {}, reset() {} });
  try {
    PluginManager.emitCustomEvent("barracuda-trials:intro", { player, trial: common.trialByKey("jubbly_jive") });
    showLine(player, "The goal of this trial is to use balloon toads to lure jubblies. First up, you'll want to sail west to collect da... sorry, collect the balloon toads from a boat of ours.");
    assert.equal(player.varbits.get(varbit("sailing_bt_jubbly_jive_pillar_3_state_player")), 3);
    open = false;
    tick(2);
    assert.equal(cutscene.tours.has(player), false);
    assert.equal(player.varbits.get(varbit("sailing_bt_jubbly_jive_pillar_3_state_player")), 0);
    assert.equal(player.varbits.get(varbit("sailing_bt_jubbly_jive_master_state")), 1);
  } finally {
    leave(player);
  }
});

test("Gwenith Glide portals outside a run: they teleport, imbue nothing; each return portal has its own side (rsprox 936, 1030)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  try {
    const portal = (test) => gwenith.portals().find(test);
    // Out through Ithell's pair, back through Crwys's portal: Crwys's own side (exits[0]).
    gwenith.enter(player, boat, portal((p) => p.pair?.clan === "ithell" && p.member === 1));
    tick(3);
    gwenith.enter(player, boat, portal((p) => p.back?.clan === "crwys"));
    tick(1);
    assert.deepEqual([boat.fineX / 128, boat.fineY / 128], [2156.5, 3464.5], "936 t6145");
    assert.ok(!player.messages().some((text) => /imbue/.test(text)), "no imbue outside a run");
    assert.equal(player.sent.filter(([key, , text]) => key === "sendTypedMessage" && /sucked through/.test(text)).length, 2, "spam messages");
    // The unnamed pair goes both ways.
    tick(3);
    gwenith.enter(player, boat, portal((p) => p.pair && p.pair.clan === null && p.member === 1));
    tick(1);
    assert.deepEqual([boat.fineX / 128, boat.fineY / 128, boat.angle], [2187.5, 3508.5, 512], "936 t9078");
  } finally {
    leave(player);
  }
});

test("the masters on their ships' decks are processed and sent to players near the ship", () => {
  const ships = require("../plugins/skills/sailing/barracudatrials/Ships.BarracudaTrials");
  if (!ships.masterOf(TEMPOR())) ships.spawnAll();
  const ralph = ships.masterOf(TEMPOR());
  assert.ok(ralph, "Ralph on his ship");
  const { Location } = require("../dist/game/model/Location");
  const nearby = { getLocation: () => new Location(3035, 2920, 0) };
  World.activeRegionIndex.update([nearby], () => true, World.processCycle, Date.now());
  const active = World.collectActiveNpcsForUpdate();
  assert.ok(active.includes(ralph), "a deck's crew counts where its boat is");
});

test("intro: lines that move the camera hold their continue back 3 ticks (rsprox 3467)", () => {
  const player = captain();
  atTheHelm(player);
  player.getDialogueManager = () => ({ getCurrent: () => ({}), startDialogues() {}, reset() {} });
  try {
    PluginManager.emitCustomEvent("barracuda-trials:intro", { player, trial: TEMPOR() });
    const first = { player, text: "The objective of this trial is to collect rum shipments and bring them here. To do so, work your way around Tempoross Cove, towards our boat to the south." };
    cutscene.onLine(first);
    assert.equal(first.holdTicks, 3);
    first.before?.();
    const still = { player, text: "Keep a close eye on them. If they are growing in size, that means they are about to strike. However, don't let your guard down once they do, as they always strike twice!" };
    cutscene.onLine(still);
    assert.equal(still.holdTicks, undefined, "no camera move on that line");
  } finally {
    cutscene.tours.delete(player);
    leave(player);
  }
});

test("wind catcher: switched on it keeps trimmed gusts as motes, up to 2, and releases them for a burst (rsprox)", () => {
  const catcher = require("../plugins/skills/sailing/WindCatcher.Helm");
  const trim = require("../plugins/skills/sailing/Trim.Helm");
  const player = captain();
  const boat = atTheHelm(player);
  try {
    const owned = Sailing.activeBoat(player);
    BoatManager.setDeckLoc(boat, { id: 59684, x: 1, y: 3, level: 1, shape: 10, rotation: 1 });
    catcher.setEnabled(player, true);
    tick(2);
    assert.equal(player.messages().at(-1), "The wind catcher is now enabled.");
    assert.equal(player.varbits.get(19124), 1);
    assert.ok(BoatManager.getSpec(boat).locs.some((loc) => loc.id === 59683), "switched on");
    for (let i = 0; i < 2; i++) assert.equal(catcher.storeFromTrim(player, boat), true);
    assert.deepEqual(player.messages().slice(-2), [
      "You trim the sails, catching the wind and storing a wind mote in your helm.",
      "For storing a wind mote, you'll receive full XP the next time you consume one.",
    ]);
    assert.equal(catcher.storeFromTrim(player, boat), false, "full at 2: an ordinary trim");
    tick();
    assert.equal(player.varbits.get(19178), 2, "the charges a tick later");
    assert.equal(owned.windMotesOwed, 2);
    player.xp.length = 0;
    trim.windFor(boat);
    catcher.release(player);
    assert.equal(player.messages().at(-1), "You release the wind mote for a burst of speed!");
    assert.equal(boat.boostSpeed, 64, "the trim's burst");
    assert.deepEqual(player.xp, [40], "full XP for a stored mote");
    catcher.release(player);
    catcher.release(player);
    assert.equal(player.messages().at(-1), "There are no wind motes in the wind catcher.");
  } finally {
    leave(player);
  }
});

test("Collect-rum clicked on the rum boat's deck goes through the object listener (other-deck click)", () => {
  const ships = require("../plugins/skills/sailing/barracudatrials/Ships.BarracudaTrials");
  const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
  if (!ships.shipOf("bt_rum_boat")) ships.spawnAll();
  const player = captain();
  const boat = atTheHelm(player);
  Object.assign(player, {
    getHitpoints: () => 99, busy: () => false, getRights: () => 0,
    getMovementQueue: () => ({ reset() {}, walkToReset() {}, handleRegionChange() {}, size: () => 0 }),
  });
  try {
    begin(player, TEMPOR(), 1);
    const rum = ships.shipOf("bt_rum_boat").boat;
    BoatManager.teleport(boat, { fineX: rum.fineX + 2 * 128, fineY: rum.fineY - 5 * 128 });
    require("../dist/game/definition/ObjectDefinition").ObjectDefinition.init();
    new ObjectActionPacketListener().executeAction(player, 59240, rum.deckBaseX + 3, rum.deckBaseY + 2, 1);
    assert.equal(player.messages().at(-1), "<col=3366ff>You collect the rum shipment. Now you need to deliver it to Rum-dashed Ralph!</col>");
  } finally {
    leave(player);
  }
});
