const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Altars = require("../plugins/objects/Altars.plugin");
const Camulet = require("../plugins/items/Camulet.plugin");
const DesertFinish = require("../plugins/achievements/diaries/DesertFinish.AchievementDiaries.plugin");

let core = null;
let api = null;
let ready = null;
let Trophies = null;

async function setup() {
  if (ready) return ready;
  ready = (async () => {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    core = PluginManager.getCoreApi();
    core.ObjectDefinition.init();
    core.RegionManager.init();
    api = PluginManager.createApi("DesertDiaryFinishTest");
    require("../plugins/skills/construction/Core.Construction").init(api);
    Trophies = require("../plugins/skills/construction/Trophies.Construction");
    Diaries.register(api);
    Altars.register(api);
    Camulet.register(api);
    DesertFinish.register(api);
    Trophies.attachTrophies(api);
  })();
  return ready;
}

const DESERT = Data.BY_KEY.get("desert");
const done = (player, key) => Progress.doneTasks(player, DESERT).has(key);

function fakePlayer({ x = 3300, y = 3000, name = "desert-test" } = {}) {
  const attributes = new Map();
  const messages = [];
  const dialogues = [];
  const player = {
    messages,
    dialogues,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    getDisplayName: () => name,
    getLocation: () => new core.Location(x, y, 0),
    isPlayer: () => true,
    getPrivateArea: () => null,
    getPacketSender: () => ({
      sendVarbit() {},
      sendTabInterface() {},
      sendInterfaceRemoval() {},
      sendString() {},
      sendChatboxInterface() { return this; },
      sendNpcHeadOnInterface() { return this; },
      sendInterfaceAnimation() { return this; },
    }),
    getDialogueManager: () => ({
      isActive: () => false,
      getCurrent: () => null,
      startDialogues: (chain) => dialogues.push(chain),
    }),
  };
  return player;
}

function actor(x, y, z = 0) {
  const player = new Player(null, new core.Location(x, y, z));
  player.setIndex(1000 + Math.floor(Math.random() * 1000));
  player.setUsername("desert-finish-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  return player;
}

function interact(player, objectId, x, y, z = 0, clickType = 1) {
  const object = new core.GameObject(objectId, new core.Location(x, y, z), 10, 0, null);
  const event = { player, object, objectId, clickType, handled: false };
  PluginManager.emitObjectInteraction(event);
  return event;
}

test("Jaldraocht altar drains all Prayer and switches to Ancient Magicks, crediting the diary once", async () => {
  await setup();
  const player = actor(3232, 9310);
  player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 70);
  player.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 70);
  player.setSpellbook(core.MagicSpellbook.NORMAL);

  const event = interact(player, 6552, 3232, 9311);
  assert.equal(event.handled, true);
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 0, "the altar drains every Prayer point");
  assert.equal(player.getSpellbook(), core.MagicSpellbook.ANCIENT, "the altar activates Ancient Magicks");
  assert.equal(done(player, "activate-ancient-magicks-at-the-altar-in-the-jal"), true);

  interact(player, 6552, 3232, 9311);
  assert.equal(player.getSpellbook(), core.MagicSpellbook.NORMAL, "using it again swaps back to the standard book");
  assert.equal(done(player, "activate-ancient-magicks-at-the-altar-in-the-jal"), true);
});

test("a Camulet rub teleports inside Enakhra's Temple, spends one shared charge and credits the diary on arrival", async (t) => {
  await setup();
  const arrivals = [];
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (player, target, type, warn, onArrival) => {
    arrivals.push([target.getX(), target.getY(), target.getZ()]);
    onArrival?.();
  });

  const player = fakePlayer();
  const item = new core.Item(core.ItemIdentifiers.CAMULET, 1);
  const event = { player, item, itemId: item.getId(), interfaceId: 0, option: "Rub", clickType: 4, handled: false };
  Camulet._test.onItemAction(event);

  assert.equal(event.handled, true);
  assert.deepEqual(arrivals, [[3105, 9315, 0]], "the wiki's inside-temple landing");
  assert.equal(Camulet._test.charges(player), 3, "one shared charge is spent on arrival");
  assert.equal(done(player, "teleport-to-enakhra-s-temple-with-the-camulet"), true);

  Camulet._test.setCharges(player, 0);
  arrivals.length = 0;
  Camulet._test.onItemAction({ ...event, handled: false });
  assert.equal(arrivals.length, 0, "an empty Camulet cannot teleport");
  assert.equal(player.messages.at(-1), "Your Camulet has no charges left.");

  player.setAttribute("quest.enakhras_lament.camulet-unlimited", 1);
  Camulet._test.setCharges(player, 0);
  Camulet._test.onItemAction({ ...event, handled: false });
  assert.deepEqual(arrivals, [[3105, 9315, 0]], "the upgraded Camulet teleports without spending a charge");
  assert.equal(Camulet._test.charges(player), 0);
});

test("Humidify credits waterskins refilled in the desert, but not in a settlement or with another vessel", async () => {
  await setup();
  const inDesert = fakePlayer({ x: 3300, y: 3000 });
  inDesert.getInventory = () => ({ contains: (id) => id === core.ItemIdentifiers.WATERSKIN_3_ });
  const containers = new Map([[core.ItemIdentifiers.WATERSKIN_3_, core.ItemIdentifiers.WATERSKIN_4_]]);
  api.emitCustomEvent("magic:water-containers", { player: inDesert, containers });
  api.emitCustomEvent("magic:humidified", { player: inDesert });
  assert.equal(done(inDesert, "refill-your-waterskins-in-the-desert-using-lunar"), true);

  const inTown = fakePlayer({ x: 3350, y: 2980 });
  inTown.getInventory = () => ({ contains: (id) => id === core.ItemIdentifiers.WATERSKIN_3_ });
  api.emitCustomEvent("magic:water-containers", { player: inTown, containers });
  api.emitCustomEvent("magic:humidified", { player: inTown });
  assert.equal(done(inTown, "refill-your-waterskins-in-the-desert-using-lunar"), false, "a desert settlement does not count");

  const bucketsOnly = fakePlayer({ x: 3300, y: 3000 });
  bucketsOnly.getInventory = () => ({ contains: (id) => id === core.ItemIdentifiers.BUCKET });
  api.emitCustomEvent("magic:water-containers", {
    player: bucketsOnly,
    containers: new Map([[core.ItemIdentifiers.BUCKET, core.ItemIdentifiers.BUCKET_OF_WATER]]),
  });
  api.emitCustomEvent("magic:humidified", { player: bucketsOnly });
  assert.equal(done(bucketsOnly, "refill-your-waterskins-in-the-desert-using-lunar"), false, "no waterskin was refilled");
});

test("a successful Ice Barrage hit on a foe outside a desert settlement credits the diary", async () => {
  await setup();
  const attacker = fakePlayer({ x: 3300, y: 3000 });
  const target = fakePlayer({ x: 3301, y: 3000 });
  const hit = (accurate, spellId = core.CombatSpells.ICE_BARRAGE.spellId()) => ({
    getSpell: () => ({ spellId: () => spellId }),
    isAccurate: () => accurate,
  });

  PluginManager.emitCombatHitResolved({ attacker, target, hit: hit(true) });
  assert.equal(done(attacker, "cast-ice-barrage-against-a-foe-in-the-desert"), true);

  const splashed = fakePlayer({ x: 3300, y: 3000 });
  PluginManager.emitCombatHitResolved({ attacker: splashed, target, hit: hit(false) });
  assert.equal(done(splashed, "cast-ice-barrage-against-a-foe-in-the-desert"), false, "a splash is not a successful hit");

  const wrongSpell = fakePlayer({ x: 3300, y: 3000 });
  PluginManager.emitCombatHitResolved({ attacker: wrongSpell, target, hit: hit(true, core.CombatSpells.ICE_BLITZ.spellId()) });
  assert.equal(done(wrongSpell, "cast-ice-barrage-against-a-foe-in-the-desert"), false);

  const inTown = fakePlayer({ x: 3350, y: 2980 });
  inTown.getInventory = () => ({ contains: (id) => id === core.ItemIdentifiers.WATERSKIN_3_ });
  PluginManager.emitCombatHitResolved({ attacker: inTown, target: fakePlayer({ x: 3351, y: 2980 }), hit: hit(true) });
  assert.equal(done(inTown, "cast-ice-barrage-against-a-foe-in-the-desert"), false, "a desert settlement does not count");
});

test("talking to the mounted KQ head credits the owner through the real object interaction", async () => {
  await setup();
  const House = require("../plugins/skills/construction/House.Construction");
  const owner = fakePlayer({ name: "Owner" });
  const guest = fakePlayer({ name: "Guest" });
  const house = {
    owner,
    getFurnitureAt: () => ({ buildableKey: "HEAD_DISPLAY_GILDED", trophy: 6 }),
  };
  const original = House.houseFor;
  House.houseFor = (player) => (player === owner || player === guest ? house : null);
  try {
    for (const player of [owner, guest]) {
      const object = new core.GameObject(56127, new core.Location(1920, 5120, 0), 10, 0, null);
      const event = { player, object, objectId: 56127, clickType: 1, handled: false };
      PluginManager.emitObjectInteraction(event);
      assert.equal(event.handled, true, "the mounted KQ head handles Talk-to");
      assert.equal(player.dialogues.length, 1);
    }
  } finally {
    House.houseFor = original;
  }
  assert.equal(done(owner, "speak-to-the-kq-head-in-your-poh"), true);
  assert.equal(done(guest, "speak-to-the-kq-head-in-your-poh"), false, "a guest is not in their own house");

  const missingHead = { player: fakePlayer(), furniture: { trophy: 0 } };
  assert.equal(Trophies._test.talkTo({ ...missingHead, object: { getId: () => 56127 } }), false, "another trophy has no KQ talk");
});


test("real Humidify producer credits a refilled waterskin but not a bucket-only cast", async (t) => {
  await setup();
  const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
  const spell = LunarSpells.SELF.get("humidify");
  t.mock.method(spell, "pay", () => true);
  function castWith(itemId) {
    const player = fakePlayer({ x: 3300, y: 3000 });
    player.getIndex = () => 1;
    const item = new core.Item(itemId, 1);
    player.getInventory = () => ({
      getValidItems: () => [item],
      contains: (id) => item.getId() === id,
      refreshItems() {},
    });
    player.getSkillManager = () => ({ addExperiences() {} });
    assert.equal(LunarSpells.handleSelf(player, "Humidify"), true);
    return { player, item };
  }
  const bucket = castWith(core.ItemIdentifiers.BUCKET);
  assert.equal(bucket.item.getId(), core.ItemIdentifiers.BUCKET_OF_WATER);
  assert.equal(done(bucket.player, "refill-your-waterskins-in-the-desert-using-lunar"), false);
  const skin = castWith(core.ItemIdentifiers.WATERSKIN_3_);
  assert.equal(skin.item.getId(), core.ItemIdentifiers.WATERSKIN_4_);
  assert.equal(done(skin.player, "refill-your-waterskins-in-the-desert-using-lunar"), true);
});
