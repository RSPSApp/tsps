const assert = require("node:assert/strict");
const path = require("node:path");
const { before, beforeEach, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

// The Arceuus lectern in the Ouditor's house (Wiki: Lectern (Arceuus); rsprox 235/03899).
let core, I, C, Lectern;
const LECTERN_TILE = { x: 1679, y: 3765, z: 0 };
const made = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  C = core.CacheDefinitions;
  const api = PluginManager.createApi("ArceuusLecternTest");
  require("../plugins/skills/construction/Core.Construction").init(api);
  Lectern = require("../plugins/skills/construction/Lectern.Construction");
  Lectern.attachLecterns(api);
  api.onCustomEvent("construction:tablet-made", event => made.push(event.itemId));
});

beforeEach(() => { made.length = 0; });

function fixture({ arceuus = true, magic = 99 } = {}) {
  const player = new Player(null);
  const varbits = new Map(), varps = new Map(), sent = [], boxes = [];
  const sender = new Proxy({}, { get: (_target, key) => {
    if (key === "sendVarbit") return (id, value) => { varbits.set(id, value); return sender; };
    if (key === "sendConfig") return (id, value) => { varps.set(id, value); return sender; };
    if (key === "getVarbit") return id => varbits.get(id) ?? 0;
    if (key === "getVarp") return id => varps.get(id) ?? 0;
    return (...args) => { sent.push([key, ...args]); return sender; };
  } });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.isRegistered = () => true;
  player.sendMessage = message => sent.push(["message", message]);
  player.getDialogueManager = () => ({ startDialogues: chain => boxes.push(chain) });
  player.setLocation?.(new core.Location(1679, 3766, 0));
  player.setSpellbook(arceuus ? core.MagicSpellbook.ARCEUUS : core.MagicSpellbook.NORMAL);
  player.getSkillManager().setMaxLevels(core.Skill.MAGIC, magic, false);
  player.getSkillManager().setCurrentLevels(core.Skill.MAGIC, magic, false);
  const messages = () => sent.filter(([name]) => name === "message").map(([, text]) => text);
  return { player, varbits, varps, sent, boxes, messages };
}

function study(f, clickType = 1) {
  const object = new GameObject(C.getLocId("arceuus_lectern"), new core.Location(LECTERN_TILE.x, LECTERN_TILE.y, LECTERN_TILE.z), 10, 0, null);
  return PluginManager.emitObjectInteraction({ player: f.player, object, objectId: object.getId(), clickType, location: LECTERN_TILE, handled: false });
}

const iface = () => C.getInterfaceId("teletabs_craft_if");
function click(f, childId) {
  return PluginManager.emitInterfaceActionClick({ player: f.player, buttonId: (iface() << 16) | childId, groupId: iface(), childId, componentId: childId, action: 1 });
}

function run(ticks) {
  for (let tick = 0; tick < ticks; tick++) core.TaskManager.process();
}

function give(f, items) {
  for (const [id, amount] of items) f.player.getInventory().add(new core.Item(id, amount));
}

/** One Barrows tablet's runes (Wiki: 2 law, 2 soul, 1 blood). */
const BARROWS_RUNES = (sets = 1) => [[I.LAW_RUNE, 2 * sets], [I.SOUL_RUNE, 2 * sets], [I.BLOOD_RUNE, sets]];
const barrowsTab = () => [...C.getEnumValues(2628).values()].indexOf(I.BARROWS_TELEPORT);

test("Study opens the teletab interface with the Arceuus lectern's own list and border", () => {
  const f = fixture();
  give(f, [[I.DARK_ESSENCE_BLOCK, 1]]);
  assert.equal(study(f), true);
  assert.equal(f.varps.get(C.getVarpId("teletab_enum")), 2628);
  assert.equal(f.varbits.get(C.getVarbitId("tablet_spellbook")), 3);
  assert.ok(f.sent.some(([name, id]) => name === "sendInterface" && id === iface()));
  assert.deepEqual([...C.getEnumValues(2628).values()].map(id => C.getObjNames().get(id)),
    ["teletab_lumbridge", "teletab_draynor", "teletab_battlefront", "teletab_mind_altar", "teletab_salve", "teletab_fenk",
      "teletab_westardy", "teletab_harmony", "teletab_cemetery", "teletab_barrows", "teletab_ape"]);
});

test("off the Arceuus spellbook it says so twice, as live does, and opens nothing", () => {
  const f = fixture({ arceuus: false });
  give(f, [[I.DARK_ESSENCE_BLOCK, 1]]);
  assert.equal(study(f), true);
  assert.deepEqual(f.messages(), ["You must be using the Arceuus spellbook to use this lectern."]);
  assert.equal(f.boxes.length, 1);
  assert.ok(!f.sent.some(([name]) => name === "sendInterface"));
});

test("without dark essence it shows the block's box and opens nothing", () => {
  const f = fixture();
  assert.equal(study(f), true);
  assert.equal(f.boxes.length, 1);
  assert.ok(!f.sent.some(([name]) => name === "sendInterface"));
});

test("five Barrows tablets: one essence and the runes each, 90 XP each, every 4 ticks, and construction:tablet-made", () => {
  const f = fixture();
  give(f, [[I.DARK_ESSENCE_BLOCK, 5], ...BARROWS_RUNES(3)]);
  study(f);
  click(f, 19 + barrowsTab());
  click(f, 6);
  const xp = f.player.getSkillManager().getExperience(core.Skill.MAGIC);
  click(f, 14);
  run(1);
  assert.equal(f.player.getInventory().getAmount(I.BARROWS_TELEPORT), 1, "the tablet comes the tick after the animation");
  run(4);
  assert.equal(f.player.getInventory().getAmount(I.BARROWS_TELEPORT), 2);
  run(20);
  // 3 sets of runes for 5 tablets: the fourth stops with the captured rune message.
  assert.equal(f.player.getInventory().getAmount(I.BARROWS_TELEPORT), 3);
  assert.equal(f.player.getInventory().getAmount(I.DARK_ESSENCE_BLOCK), 2);
  assert.equal(f.player.getInventory().getAmount(I.LAW_RUNE), 0);
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.MAGIC) - xp, 270);
  assert.deepEqual(made, [I.BARROWS_TELEPORT, I.BARROWS_TELEPORT, I.BARROWS_TELEPORT]);
  assert.match(f.messages().at(-1), /^You do not have enough (Law|Soul|Blood) Runes to cast this spell\.$/);
});

test("the Magic level is the tablet's, and Create-last remembers the Arceuus lectern's own choice", () => {
  const low = fixture({ magic: 82 });
  give(low, [[I.DARK_ESSENCE_BLOCK, 1], ...BARROWS_RUNES()]);
  study(low);
  click(low, 19 + barrowsTab());
  click(low, 14);
  run(3);
  assert.equal(low.player.getInventory().getAmount(I.BARROWS_TELEPORT), 0);
  assert.deepEqual(low.messages(), ["You need a Magic level of 83 to make that tablet."]);

  const f = fixture();
  give(f, [[I.DARK_ESSENCE_BLOCK, 2], ...BARROWS_RUNES(2)]);
  study(f);
  click(f, 19 + barrowsTab());
  click(f, 5);
  click(f, 14);
  run(3);
  assert.equal(f.player.getAttribute("construction:arceuus-lectern-tablet"), barrowsTab() + 1);
  assert.equal(f.player.getAttribute("construction:lectern-tablet") ?? 0, 0, "the house lecterns keep theirs");
  study(f, 2);
  run(3);
  assert.equal(f.player.getInventory().getAmount(I.BARROWS_TELEPORT), 2);
});

test("the Arceuus lectern is found by its loc, and no house means no house lectern", () => {
  const { lecternAt, TABLETS } = Lectern._test;
  const arceuus = lecternAt({ player: new Player(null), objectId: C.getLocId("arceuus_lectern"), location: LECTERN_TILE });
  assert.equal(arceuus.material, I.DARK_ESSENCE_BLOCK);
  assert.equal(arceuus.tabletSpellbook, 3);
  assert.equal(TABLETS.get(I.BARROWS_TELEPORT).experience, 90);
  assert.equal(TABLETS.get(I.ARCEUUS_LIBRARY_TELEPORT).experience, 9.5);
  assert.equal(lecternAt({ player: new Player(null), objectId: C.getLocId("poh_lectern_1"), location: LECTERN_TILE }), null, "no house, no lectern");
});

// A house holding a lectern built as `buildableKey` (as bone-altars.test.cjs builds its house).
function inHouse(f, buildableKey) {
  const Instance = require("../plugins/skills/construction/Instance.Construction");
  const house = Object.create(Instance.PlayerHouseInstance.prototype);
  house.getFurnitureAt = () => ({ buildableKey });
  f.player.getPrivateArea = () => house;
  return house;
}

function studyHouse(f, clickType = 1) {
  const objectId = C.getLocId("poh_lectern_7");
  const object = new GameObject(objectId, new core.Location(100, 100, 0), 10, 0, null);
  return PluginManager.emitObjectInteraction({ player: f.player, object, objectId, clickType, location: { x: 100, y: 100, z: 0 }, handled: false });
}

test("a house lectern still takes soft clay, draws the normal border and says the house's rune message", () => {
  const f = fixture({ arceuus: false });
  inHouse(f, "MAHOGANY_DEMON_LECTERN");
  const enumId = require("../plugins/skills/construction/data/lectern.json").lecterns.MAHOGANY_DEMON_LECTERN;
  const tablets = [...C.getEnumValues(enumId).values()];
  const varrock = tablets.indexOf(I.VARROCK_TELEPORT);
  assert.ok(varrock >= 0);
  f.varbits.set(C.getVarbitId("tablet_spellbook"), 3);
  give(f, [[I.SOFT_CLAY, 2], [I.AIR_RUNE, 3], [I.FIRE_RUNE, 1], [I.LAW_RUNE, 1], [I.DARK_ESSENCE_BLOCK, 1]]);
  assert.equal(studyHouse(f), true);
  assert.equal(f.varbits.get(C.getVarbitId("tablet_spellbook")), 0, "an Arceuus visit's border is reset");
  assert.equal(f.varps.get(C.getVarpId("teletab_enum")), enumId);
  click(f, 19 + varrock);
  click(f, 6);
  click(f, 14);
  run(10);
  assert.equal(f.player.getInventory().getAmount(I.VARROCK_TELEPORT), 1);
  assert.equal(f.player.getInventory().getAmount(I.SOFT_CLAY), 1);
  assert.equal(f.player.getInventory().getAmount(I.DARK_ESSENCE_BLOCK), 1, "the house never takes dark essence");
  assert.equal(f.messages().at(-1), "You do not have enough runes to make that tablet.");
  assert.deepEqual(made, [I.VARROCK_TELEPORT]);
  assert.equal(f.player.getAttribute("construction:lectern-tablet"), varrock + 1);
  assert.equal(f.player.getAttribute("construction:arceuus-lectern-tablet") ?? 0, 0);
});
