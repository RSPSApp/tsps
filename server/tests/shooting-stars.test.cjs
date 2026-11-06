// Run after `yarn build`: node --test tests/shooting-stars.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, beforeEach, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");

const Common = require("../plugins/skills/shootingstars/Common.ShootingStars");
const Star = require("../plugins/skills/shootingstars/Star.ShootingStars");
const Mining = require("../plugins/skills/shootingstars/Mining.ShootingStars");
const Landing = require("../plugins/skills/shootingstars/Landing.ShootingStars");
const Prospect = require("../plugins/skills/shootingstars/Prospect.ShootingStars");
const Rewards = require("../plugins/skills/shootingstars/Rewards.ShootingStars");
const Noticeboard = require("../plugins/skills/shootingstars/Noticeboard.ShootingStars");
const Dusuri = require("../plugins/skills/shootingstars/Dusuri.ShootingStars");
const Ring = require("../plugins/skills/shootingstars/CelestialRing.ShootingStars");
const ClueGeodes = require("../plugins/skills/mining/ClueGeodes.Mining");

const { DATA, world } = Common;
/** The Varrock east bank site, where a capture saw a size-9 star. */
const VARROCK = DATA.sites.findIndex((site) => site.name === "Varrock (East bank)");
const DARKMEYER = DATA.sites.findIndex((site) => site.name === "Daeyalt essence mine entrance");

let core;
const handlers = new Map();
const emitted = [];
const npcs = [];
let members = true;

function on(name, handler) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(handler);
}

const fakeApi = {
  get core() { return core; },
  emitCustomEvent(name, payload) {
    emitted.push({ name, payload });
    for (const handler of handlers.get(name) ?? []) handler(payload);
  },
  onCustomEvent: on,
  getPluginConfig: (key, fallback) => fallback,
  persistAttribute: () => {},
  spawnNpc(definition) {
    const bars = [];
    const npc = { definition, bars, showHeadbar: (id, options) => bars.push({ id, ...options }), removeHeadbar: (id) => bars.push({ id, remove: true }) };
    npcs.push(npc);
    return npc;
  },
  removeNpc(npc) { npc.removed = true; },
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3258, 3408);
  Common.bind(fakeApi);
  Object.assign(Star.miners, { isMined: Mining.isMined, playersOf: Mining.playersOf, stopAll: Mining.stopAll });
  on("mining:best-pickaxe", (request) => {
    request.pickaxe = { id: core.ItemIdentifiers.RUNE_PICKAXE, attemptIntervalTicks: 3, animation: new core.Animation(624) };
  });
  on("shooting-stars:landed", Noticeboard.landed);
  on("random-events:eligibility", Common.denyRandomEvents);
  on("mining:level-boost", Ring.addBoost);
  Noticeboard.resetForTests();
  Common.isMembersWorld = () => members;
});

beforeEach(() => {
  members = true;
  emitted.length = 0;
});

afterEach(() => {
  if (world.star) Star.remove(world.star);
  world.lastSiteIndex = -1;
  world.nextSiteIndex = -1;
});

/** A real player with a recording packet sender. */
function miner({ level = 99, x = 3257, y = 3408 } = {}) {
  const p = new Player(null);
  p.setUsername(`miner${Math.floor(Math.random() * 1e6)}`);
  p.setLocation(new core.Location(x, y, 0));
  const log = [];
  const varbits = new Map();
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === "sendVarbit") return (id, value) => (varbits.set(id, value), sender);
      if (key === "sendString") return (text) => (log.push(`text ${text}`), sender);
      if (key === "sendJingle") return (id) => (log.push(`jingle ${id}`), sender);
      if (key === "sendSound") return (id) => (log.push(`synth ${id}`), sender);
      if (key === "sendTypedMessage") return (type, text) => (log.push(text), sender);
      return () => sender;
    },
  });
  p.getPacketSender = () => sender;
  p.sendMessage = (text) => log.push(text);
  p.performAnimation = (animation) => log.push(`anim ${animation.getId()}`);
  p.isRegistered = () => true;
  p.getSkillManager().setLevel(core.Skill.MINING, level);
  return Object.assign(p, { log, varbits });
}

/** Lands a star at Varrock east bank and lets the landing loc stand its ticks. */
function landedStar(size = 9) {
  const star = Star.land(DATA.sites[VARROCK], size, VARROCK);
  for (let i = 0; i < DATA.landingTicks; i++) Star.tick(star);
  return star;
}

function click(player, star, option) {
  const event = { player, location: { x: star.x, y: star.y, z: star.z }, handled: false };
  return option === "Prospect" ? Prospect.prospect(event) : Mining.mine(event);
}

function runTicks(count, random) {
  for (let i = 0; i < count; i++) {
    world.tick += 1;
    if (world.star) Star.tick(world.star);
    Mining.tick(random);
  }
}

test("crashed stars exclude random events nearby until removal, on their own plane only", () => {
  const star = Star.land(DATA.sites[VARROCK], 9, VARROCK);
  const query = (x, y, z = star.z) => {
    const player = miner({ x, y });
    player.setLocation(new core.Location(x, y, z));
    const request = { player, kind: "genie", following: false, allowed: null };
    fakeApi.emitCustomEvent("random-events:eligibility", request);
    return request.allowed;
  };
  assert.equal(query(star.x - 1, star.y), null, "a falling star has not crashed yet");
  for (let i = 0; i < DATA.landingTicks; i++) Star.tick(star);
  assert.equal(query(star.x - 1, star.y), false, "the mining tiles are excluded");
  assert.equal(query(star.x + 15, star.y + 15), false, "the current vicinity includes its edge");
  assert.equal(query(star.x + 16, star.y), null, "unrelated players outside the vicinity are untouched");
  assert.equal(query(star.x - 1, star.y, 1), null, "a different floor stays eligible");
  const following = { player: miner({ x: star.x - 1, y: star.y }), kind: "mime", following: true, allowed: true };
  fakeApi.emitCustomEvent("random-events:eligibility", following);
  assert.equal(following.allowed, false, "the dynamic exclusion also ends existing invitations and overrides general permissions");
  Star.remove(star);
  assert.equal(query(star.x - 1, star.y), null, "removal releases the exclusion immediately");
});

test("the data: every size has its cache loc, and every site is a tile", () => {
  for (const entry of DATA.sizes) {
    assert.equal(core.CacheDefinitions.getObject(entry.loc).name, "Crashed Star", entry.gameval);
  }
  assert.ok(DATA.sites.length >= 82);
  for (const site of DATA.sites) assert.ok(Number.isInteger(site.x) && Number.isInteger(site.y), site.name);
  const crash = DATA.sizes.filter((entry) => entry.crashChance).map((entry) => entry.size).sort();
  assert.deepEqual(crash, [6, 7, 8, 9]);
});

test("landing: sizes 6-9 by the Wiki's chances, every 75-105 minutes", () => {
  assert.equal(Landing.rollSize(() => 0), 9);
  assert.equal(Landing.rollSize(() => 0.999), 6);
  assert.equal(Landing.rollSize(() => 0.5), 7);
  const ticks = [Landing.nextInterval(() => 0), Landing.nextInterval(() => 0.999)];
  assert.equal(ticks[0], 75 * 100);
  assert.ok(ticks[1] >= 104 * 100 && ticks[1] <= 105 * 100);
});

test("landing: regular rolls exclude Darkmeyer, repeated rolls redirect there", () => {
  assert.ok(DARKMEYER >= 0, "the existing Darkmeyer site must be present");
  const regularSites = DATA.sites.map((_, index) => index).filter((index) => index !== DARKMEYER);
  for (const previous of [-1, ...DATA.sites.map((_, index) => index)]) {
    world.lastSiteIndex = previous;
    for (let roll = 0; roll < regularSites.length; roll++) {
      const site = regularSites[roll];
      assert.equal(Landing.rollSite(() => (roll + 0.5) / regularSites.length), site === previous ? DARKMEYER : site);
    }
  }
  world.lastSiteIndex = -1;
  assert.equal(Landing.rollSite(() => 0), regularSites[0]);
  assert.equal(Landing.rollSite(() => 1 - Number.EPSILON), regularSites.at(-1));
});

test("landing: renaming the Darkmeyer site fails when the module loads", () => {
  const modulePath = require.resolve("../plugins/skills/shootingstars/Landing.ShootingStars");
  const cached = require.cache[modulePath];
  const site = DATA.sites[DARKMEYER];
  const name = site.name;
  try {
    site.name = "Renamed landing site";
    delete require.cache[modulePath];
    assert.throws(() => require(modulePath), { message: "Shooting Stars: Darkmeyer landing site is missing." });
  } finally {
    site.name = name;
    require.cache[modulePath] = cached;
  }
});

test("landing: a Darkmeyer forecast stays stable and replaces the old star when due", (t) => {
  let scheduled;
  Landing({ ...fakeApi, getTaskManager: () => ({ submit: (task) => { scheduled = task; } }), registerCommand() {} });
  assert.ok(world.ticksToLanding >= 20 * 100 && world.ticksToLanding <= 50 * 100);
  const previous = landedStar();
  const regularSites = DATA.sites.map((_, index) => index).filter((index) => index !== DARKMEYER);
  t.mock.method(Math, "random", () => (regularSites.indexOf(VARROCK) + 0.5) / regularSites.length);
  world.ticksToLanding = 1;
  for (let i = 0; i < 2; i++) {
    const request = {};
    fakeApi.emitCustomEvent("shooting-stars:forecast", request);
    assert.equal(request.region, "Morytania");
    assert.equal(request.minutes, 1 / Common.TICKS_PER_MINUTE);
    assert.equal(world.nextSiteIndex, DARKMEYER);
  }
  scheduled.execute();
  assert.equal(previous.gone, true);
  assert.equal(previous.object, null);
  assert.equal(previous.headbarNpc, null);
  assert.equal(world.star.siteIndex, DARKMEYER);
  assert.equal(world.star.site, DATA.sites[DARKMEYER]);
  assert.equal(world.lastSiteIndex, DARKMEYER);
  assert.equal(world.nextSiteIndex, VARROCK, "Darkmeyer cannot be rolled again directly");
  assert.ok(world.ticksToLanding >= 75 * 100 && world.ticksToLanding <= 105 * 100);
});

test("a star lands as the landing loc, then the crashed star with its headbar", () => {
  const star = Star.land(DATA.sites[VARROCK], 8, VARROCK);
  assert.equal(star.object.getId(), DATA.locs.landing);
  assert.equal(Star.isLanded(star), false);
  for (let i = 0; i < DATA.landingTicks; i++) Star.tick(star);
  assert.equal(star.object.getId(), 41021);
  assert.equal(star.headbarNpc.definition.id, DATA.npcs.headbar);
  assert.deepEqual(star.headbarNpc.bars.at(-1), { id: 1, fill: 50 });
});

test("the first Mine discovers the star: message box, jingle 287, a 300 dust bonus", () => {
  const star = landedStar(9);
  const p = miner();
  click(p, star, "Mine");
  assert.ok(p.log.includes("jingle 287"));
  assert.ok(p.log.some((line) => line.includes("Congratulations! You were the first person to find this star! Your star dust gain will be doubled for the next 300 dust you mine!")));
  assert.equal(p.varbits.get(DATA.varbits.bonusDust), 300);
  assert.equal(p.varbits.get(DATA.varbits.mined), 1);
  assert.equal(star.discoveredBy, p.getUsername());
  assert.equal(Mining.sessions.has(p), false, "the discovery click does not start mining");
});

test("mining: swing message, dust each success, 32 xp (16 on free-to-play), bonus doubled", () => {
  const star = landedStar(9);
  star.discoveredBy = "someone";
  const p = miner();
  Common.setBonusDust(p, 2);
  click(p, star, "Mine");
  assert.equal(p.log.includes(Mining.SWING_MESSAGE), false, "the swing is the tick after the click (captures)");
  assert.equal(p.varbits.get(DATA.varbits.lastMinedSize), 9);
  runTicks(1);
  assert.ok(p.log.includes(Mining.SWING_MESSAGE));
  const xpBefore = p.getSkillManager().getExperience(core.Skill.MINING);
  runTicks(3, () => 0.5); // misses the gem table and the 46% dust roll
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STARDUST), 0);
  runTicks(3, () => 0.1);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STARDUST), 2, "doubled by the bonus");
  assert.equal(p.getSkillManager().getExperience(core.Skill.MINING) - xpBefore, 32);
  assert.ok(p.log.includes("synth 3600"));
  runTicks(3, () => 0.1);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STARDUST), 4);
  assert.ok(p.log.includes(Mining.BONUS_USED_UP));
  runTicks(3, () => 0.1);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STARDUST), 5, "the bonus is spent");
  members = false;
  const before = p.getSkillManager().getExperience(core.Skill.MINING);
  runTicks(3, () => 0.1);
  assert.equal(p.getSkillManager().getExperience(core.Skill.MINING) - before, 16);
  const success = emitted.find((entry) => entry.name === "mining:success");
  assert.equal(success.payload.petBase, 521550);
});

test("the swing is the pickaxe's noreachforward sequence; Mine and Prospect send the size and time since landing", () => {
  const star = landedStar(9);
  star.discoveredBy = "someone";
  runTicks(5);
  const p = miner();
  const infernal = { key: "infernal", attemptIntervalTicks: 3, animation: new core.Animation(4482) };
  assert.equal(Mining.swingAnimation(infernal).getId(), core.CacheDefinitions.getSeqId("human_mining_infernal_pickaxe_noreachforward"));
  assert.equal(Mining.swingAnimation({ attemptIntervalTicks: 3, animation: new core.Animation(624) }).getId(), 624, "no key: the pickaxe's own swing");
  click(p, star, "Prospect");
  assert.equal(p.varbits.get(DATA.varbits.timeSinceLanded), 5);
  click(p, star, "Mine");
  assert.equal(p.varbits.get(DATA.varbits.lastMinedSize), 9);
  runTicks(1);
  assert.equal(p.varbits.get(DATA.varbits.timeSinceLanded), 6, "sent again with the swing");
});

test("bonus messages every 50 dust", () => {
  const p = miner();
  assert.equal(Mining.bonusLeftMessage(250), "Your star discovery bonus will grant you another 250 star dust before it runs out.");
  const star = landedStar(9);
  star.discoveredBy = "someone";
  Common.setBonusDust(p, 251);
  click(p, star, "Mine");
  runTicks(4, () => 0.1);
  assert.ok(p.log.includes(Mining.bonusLeftMessage(250)));
});

test("stardust chance runs 29% at level 1 to 46% at 99, the celestial ring adds 4 levels", () => {
  assert.equal(Mining.dustChance(1), 29);
  assert.equal(Mining.dustChance(99), 46);
  assert.ok(Math.abs(Mining.dustChance(50) - 37.5) < 0.01);
  const p = miner({ level: 80 });
  assert.equal(Common.rollMiningLevel(p), 80);
  p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(core.ItemIdentifiers.CELESTIAL_RING_UNCHARGED_, 1));
  assert.equal(Common.rollMiningLevel(p), 84);
});

test("a layer needs size x 10 Mining; too low still pokes the layer timer", () => {
  const star = landedStar(7);
  star.discoveredBy = "someone";
  const p = miner({ level: 60 });
  click(p, star, "Mine");
  assert.ok(p.log.includes("You need a Mining level of at least 70 to mine this layer."));
  assert.equal(star.pokedTick, world.tick);
});

test("layers: 1% per 7 ticks while mined, 700 ticks a layer, held while nobody mines", () => {
  const star = landedStar(2);
  star.discoveredBy = "someone";
  const p = miner();
  click(p, star, "Mine");
  runTicks(7 * 10, () => 0.99);
  assert.equal(star.percent, 10);
  assert.deepEqual(star.headbarNpc.bars.at(-1), { id: 1, fill: 45 });
  Mining.stop(p);
  runTicks(100, () => 0.99);
  assert.equal(star.percent, 10, "no one mining, no progress");
  click(p, star, "Mine");
  runTicks(7 * 90, () => 0.99);
  assert.equal(star.size, 1);
  assert.equal(star.object.getId(), 41229);
  assert.equal(Mining.sessions.has(p), false, "a new layer stops the miners");
  click(p, star, "Mine");
  runTicks(700, () => 0.99);
  assert.ok(p.log.includes("The star disintegrates into dust."));
  assert.equal(star.gone, true);
  runTicks(2);
  assert.equal(world.star, null);
});

test("Prospect: the captured message box, 'the core' on a size-1 star", () => {
  const star = landedStar(9);
  const p = miner();
  click(p, star, "Prospect");
  assert.ok(p.log.includes("synth 2661"));
  assert.ok(p.log.includes("text This is a size-9 star. A Mining level of at least 90 is required to mine this layer. It has been mined 0% of the way to the next layer."));
  star.size = 1;
  star.percent = 78;
  assert.equal(Prospect.prospectText(star), "This is a size-1 star. A Mining level of at least 10 is required to mine this layer. It has been mined 78% of the way to the core.");
});

test("the gem table: 1/256 (1/64.2 with a charged glory), a gem or nothing, no dust", () => {
  const p = miner();
  assert.equal(Rewards.rollGemTable(p, () => 0.5), false);
  let calls = 0;
  const rolls = [0.003, 0.999]; // hits 1/256, then picks the last row (a diamond)
  assert.equal(Rewards.rollGemTable(p, () => rolls[calls++]), true);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.UNCUT_DIAMOND), 1);
  p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(core.ItemIdentifiers.AMULET_OF_GLORY_4_, 1));
  assert.equal(Rewards.wearsChargedGlory(p), true);
  assert.equal(Rewards.rollGemTable(p, () => 0.01), true, "1/64.2 with the glory");
  p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(core.ItemIdentifiers.AMULET_OF_GLORY, 1));
  assert.equal(Rewards.wearsChargedGlory(p), false);
});

test("clue geodes: the Wiki's formula from the golem base gives its crashed star rates", () => {
  const base = DATA.mining.petBase;
  // Wiki (Crashed star): beginner 1/663 to 1/366; its other tiers are listed unfloored (1/5,642 easy).
  assert.equal(ClueGeodes.geodeChance(base, 10, 0.2), 663);
  assert.equal(ClueGeodes.geodeChance(base, 99, 0.2), 366);
  assert.equal(ClueGeodes.geodeChance(base, 10, 1.7), 5642);
  assert.equal(ClueGeodes.geodeChance(base, 10, 10), 33189);
});

test("the noticeboard keeps the last five stars, oldest first, with their finders", () => {
  for (let i = 0; i < 6; i++) Noticeboard.landed({ star: { landedAt: 1_000_000 + i * 3_600_000 } });
  const p = miner();
  Noticeboard.discovered(p, { landedAt: 1_000_000 + 5 * 3_600_000 });
  const now = 1_000_000 + 5 * 3_600_000 + 8 * 60_000;
  const { times, finders, personal } = Noticeboard.lines(p, now);
  assert.deepEqual(times, ["4 hour 8 minutes ago", "3 hour 8 minutes ago", "2 hour 8 minutes ago", "1 hour 8 minutes ago", "8 minutes ago"]);
  assert.equal(finders[4], p.getUsername());
  assert.equal(finders[0], "");
  assert.equal(personal, "Stars Personally Found: 1");
});

test("Dusuri: introduction until met, the Trade action sets star_trader_met, transcript conditions", () => {
  const p = miner();
  assert.equal(Dusuri.onDialogueVariant({ player: p, npcId: 10633 }), "introduction-dialogue");
  assert.equal(Dusuri.onDialogueVariant({ player: p, npcId: 3094 }), null);
  const request = { player: p, npcId: 10633, stepId: "TUeyGg", handled: false };
  Dusuri.onDialogueAction(request);
  assert.equal(p.varbits.get(DATA.varbits.traderMet), 1);
  assert.equal(Dusuri.onDialogueVariant({ player: p, npcId: 10631 }), "standard-dialogue");
  const ask = (text) => Dusuri.answerCondition({ player: p, npcId: 10633, text });
  assert.equal(ask("If the player has not interacted with a shooting star:"), true);
  Common.markMined(p);
  assert.equal(ask("If the player has interacted with a shooting star already:"), true);
  assert.equal(ask("If the player has stardust in their inventory:"), false);
  p.getInventory().adds(core.ItemIdentifiers.STARDUST, 5);
  assert.equal(ask("If the player has stardust in their inventory:"), true);
  assert.equal(ask("On members worlds:"), true);
  members = false;
  assert.equal(ask("On free-to-play worlds:"), true);
});

test("Dusuri: displayed refunds, value messages and actual sales pay 80% for all four rewards", (t) => {
  const data = require("../data/definitions/shops.json").find((shop) => shop.name === "Dusuri's Star Shop");
  ShopDefinition.replace([new ShopDefinition(data.id, data.name, data.currency,
    data.originalStock.map((stock) => ({ ...stock, price: data.prices[stock.id] })), 1, 1, 1, "test")]);
  ShopManager.initialize();
  ShopManager.registerItemCurrency(core.ItemIdentifiers.STARDUST);
  t.mock.method(PluginManager, "emitCustomEvent", (name, request) => {
    if (name === "shop:sell-price") Dusuri.sellPrice(request);
    if (name === "shop:can-sell") Dusuri.canSell(request);
  });
  const p = miner();
  const packets = [];
  p.getSession = () => ({ sendClientPacket: (packet) => packets.push(packet) });
  p.getInventory().adds(core.ItemIdentifiers.STARDUST, 10000);
  ShopManager.open(p, data.id);
  const stockPacket = packets.at(-1).subarray(-20 * data.originalStock.length);
  const refunds = [1600, 2400, 240, 120];
  for (let index = 0; index < data.originalStock.length; index++) {
    const { id } = data.originalStock[index];
    const price = data.prices[id];
    const refund = refunds[index];
    assert.equal(stockPacket.readInt32BE(index * 20 + 12), price);
    assert.equal(stockPacket.readInt32BE(index * 20 + 16), refund);
    const before = p.getInventory().getAmount(core.ItemIdentifiers.STARDUST);
    ShopManager.handleWidgetAction(p, {
      groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option: "Buy 1", slot: index + 1, itemId: id,
    });
    assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STARDUST), before - price);
    const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === id);
    assert.ok(slot >= 0);
    const sale = { groupId: ShopManager.SIDE_INTERFACE_ID, childId: 0, buttonNum: 0, slot, itemId: id };
    ShopManager.handleWidgetAction(p, { ...sale, option: "Value" });
    assert.ok(p.log.at(-1).includes(`shop will buy for ${refund.toLocaleString("en-US")} x Stardust.`), p.log.at(-1));
    ShopManager.handleWidgetAction(p, { ...sale, option: "Sell 1" });
    assert.equal(p.getInventory().getAmount(id), 0);
    assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STARDUST), before - price + refund);
  }
  p.getInventory().add(new core.Item(data.originalStock[0].id, 1, { [core.Item.UNTRADEABLE_META]: true }), false);
  const lockedSlot = p.getInventory().getItems().findIndex((item) => item?.isUntradeable());
  const before = p.getInventory().getAmount(core.ItemIdentifiers.STARDUST);
  ShopManager.handleWidgetAction(p, {
    groupId: ShopManager.SIDE_INTERFACE_ID, childId: 0, buttonNum: 0, option: "Sell 1", slot: lockedSlot,
  });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.STARDUST), before, "metadata-locked items remain unsellable");
  assert.equal(p.getInventory().getAmount(data.originalStock[0].id), 1);
  ShopManager.close(p);
  const otherShop = { shopName: "Another shop", buyPrice: 2000, price: 1700 };
  Dusuri.sellPrice(otherShop);
  assert.equal(otherShop.price, 1700);
  const otherSale = { shopName: "Another shop", sellable: false };
  Dusuri.canSell(otherSale);
  assert.equal(otherSale.sellable, false);
});

test("celestial ring: charge with stardust, extra ores up to adamantite spend charges, uncharge returns it", () => {
  const p = miner();
  const I = core.ItemIdentifiers;
  p.getInventory().adds(I.STARDUST, 20);
  p.getInventory().adds(I.CELESTIAL_RING_UNCHARGED_, 1);
  const ring = p.getInventory().getItems().find((item) => item?.getId() === I.CELESTIAL_RING_UNCHARGED_);
  Ring.addCharges(p, ring, 15);
  assert.equal(ring.getId(), I.CELESTIAL_RING);
  assert.equal(Ring.charges(ring), 15);
  assert.equal(p.getInventory().getAmount(I.STARDUST), 5);
  const worn = new core.Item(I.CELESTIAL_RING, 1);
  worn.setMetaValue(Ring.CHARGES_META_KEY, 15);
  const wearer = miner();
  wearer.getEquipment().setItem(core.Equipment.RING_SLOT, worn);
  const coal = { player: wearer, rockLevel: 30, bonuses: [] };
  Ring.extraOre(coal, () => 0.05);
  assert.equal(coal.bonuses.length, 1);
  assert.equal(Ring.charges(worn), 14);
  const runite = { player: wearer, rockLevel: 85, bonuses: [] };
  Ring.extraOre(runite, () => 0.05);
  assert.equal(runite.bonuses.length, 0);
  assert.equal(Ring.charges(worn), 14, "runite is past adamantite: no charge");
  Ring.uncharge({ player: p, item: ring });
  assert.equal(ring.getId(), I.CELESTIAL_RING_UNCHARGED_);
  assert.equal(p.getInventory().getAmount(I.STARDUST), 20);
});
