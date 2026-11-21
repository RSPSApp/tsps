// Run after `yarn build`: node --test tests/construction-topiary.test.cjs
//
// The superior garden's topiary bush: Clip without secateurs says "You'll need some secateurs to
// clip the topiary bush." (rsprox.net recs 2581 tick 295, 2884 tick 10243). With them it opens
// menu 187 "Choose a shape" (script 217, None|Kraken|...|The Nightmare); a pick plays pruning_all
// and synth 2440, and three ticks later the bush becomes the shape's loc (rec 2884 ticks
// 12577-12725, rev 230). Wiki (Topiary bush): each shape needs that boss killed once, Vorkath
// the post-quest one (npc `vorkath`), not Dragon Slayer II's (npc `vorkath_quest`).
// Real engine: every plugin loaded, a real Player, a real seeded house with a superior garden.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const MENU = 187, MENU_SCRIPT = 217;
let core, C, House, Instance, Topiary;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  PM.emitServerStartup({});
  C = core.CacheDefinitions;
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  Topiary = require("../plugins/skills/construction/Topiary.Construction");
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 1;
function ownerInGarden(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.getSession().setPlayer?.(player);
  player.setUsername(`topiarist${nextIndex++}`);
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true);
  const sent = [];
  const sender = player.getPacketSender();
  const sendInterface = sender.sendInterface.bind(sender);
  t.mock.method(sender, "sendInterface", (id) => { sent.push({ modal: id }); return sendInterface(id); });
  t.mock.method(sender, "sendClientScript", (id, ...args) => { sent.push({ script: id, args }); return sender; });
  t.mock.method(sender, "sendSound", (id) => { sent.push({ sound: id }); return sender; });
  t.mock.method(player, "sendMessage", (text) => { sent.push({ message: text }); });
  t.mock.method(player, "performAnimation", (animation) => { sent.push({ anim: animation.getId() }); });
  t.after(() => {
    try { House.releaseHouse(player, true); } finally { core.TaskManager.cancelTasks(player); core.World.getPlayers().remove(player); }
  });
  const save = Instance.createDefaultHouseSave();
  save.rooms[0][4][6] = { roomKey: "SUPERIOR_GARDEN", rotation: 0, furniture: { TOPIARY_SPACE: "TOPIARY_BUSH" } };
  player.setAttribute("construction:house", save);
  player.moveTo(new core.Location(2954, 3224, 0));
  player.setNeedsPlacement(false);
  assert.equal(House.enterHouse(player, false), true);
  return { player, sent, house: House.houseFor(player) };
}

function bushOf(house) {
  const ids = new Set(Topiary.SHAPES.map((shape) => shape.loc));
  return house.furnitureObjects.find((drawn) => ids.has(drawn.getId()));
}

function clip(player, object) {
  const at = object.getLocation();
  const clickType = object.getDefinition().getInteractions().indexOf("Clip") + 1;
  assert.ok(clickType > 0, "the bush offers Clip");
  const event = { player, object, objectId: object.getId(), clickType, location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false };
  PM.emitObjectInteraction(event);
  return event;
}

/** A pick on menu:lj_layer1 (resume_pausebutton, sub = the option's index). */
function pick(player, slot) {
  const event = { player, groupId: MENU, childId: 3, slot, action: slot, buttonId: (MENU << 16) | 3, handled: false };
  PM.emitInterfaceActionClick(event);
  assert.equal(event.handled, true);
}

function setKills(player, monster, count) {
  const Kills = require("../plugins/achievements/combatachievements/Kills.CombatAchievements");
  const Data = require("../plugins/achievements/combatachievements/Data.CombatAchievements");
  Kills.setCount(player, Data.monsterNamed(monster), count);
}

function ticks(n) { for (let i = 0; i < n; i++) core.TaskManager.process(); }

test("the bush and every shape answer Clip; without secateurs it says so and opens nothing", (t) => {
  const { player, sent, house } = ownerInGarden(t);
  const bush = bushOf(house);
  assert.equal(bush?.getId(), C.getLocId("poh_topiary_null"));
  const event = clip(player, bush);
  assert.equal(event.option, "Clip");
  assert.equal(event.handled, true);
  assert.deepEqual(sent, [{ message: "You'll need some secateurs to clip the topiary bush." }]);
});

test("with secateurs Clip opens the captured shape menu", (t) => {
  const { player, sent, house } = ownerInGarden(t);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.SECATEURS, 1), false);
  clip(player, bushOf(house));
  assert.ok(sent.some((entry) => entry.modal === MENU));
  const menu = sent.find((entry) => entry.script === MENU_SCRIPT);
  assert.deepEqual(menu.args.slice(1), ["Choose a shape",
    "None|Kraken|Zulrah|Kalphite Queen|Cerberus|Abyssal Sire|Skotizo|Vorkath|Alchemical Hydra|The Nightmare"]);
});

test("a killed boss's shape prunes, then the bush becomes its loc three ticks later and stays saved", (t) => {
  const { player, sent, house } = ownerInGarden(t);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.MAGIC_SECATEURS, 1), false);
  setKills(player, "The Nightmare", 1);
  clip(player, bushOf(house));
  sent.length = 0;
  pick(player, 9);
  assert.ok(sent.some((entry) => entry.anim === Topiary.PRUNING), "pruning_all on the pick");
  assert.ok(sent.some((entry) => entry.sound === Topiary.CLIP_SOUND), "synth 2440 on the pick");
  assert.equal(bushOf(house).getId(), C.getLocId("poh_topiary_null"), "not yet reshaped");
  ticks(2);
  assert.equal(bushOf(house).getId(), C.getLocId("poh_topiary_null"), "still plain after two ticks");
  ticks(1);
  assert.ok(sent.some((entry) => entry.anim === -1), "the animation resets with the reshape");
  assert.equal(bushOf(house).getId(), C.getLocId("poh_topiary_nightmare"));
  const saved = player.getAttribute("construction:house").rooms[0][4][6];
  assert.equal(Object.values(saved.furnitureByLocation).find((f) => f.buildableKey === "TOPIARY_BUSH").displayObjectId, C.getLocId("poh_topiary_nightmare"));

  // Clip on the shaped bush, then None, gives the plain bush back.
  clip(player, bushOf(house));
  pick(player, 0);
  ticks(3);
  assert.equal(bushOf(house).getId(), C.getLocId("poh_topiary_null"));
});

test("a shape whose boss the player hasn't killed is refused and the bush stays", (t) => {
  const { player, sent, house } = ownerInGarden(t);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.SECATEURS, 1), false);
  setKills(player, "Phosani's Nightmare", 3); // Wiki: Phosani's kills don't unlock The Nightmare
  clip(player, bushOf(house));
  sent.length = 0;
  pick(player, 9);
  ticks(3);
  assert.deepEqual(sent.filter((entry) => entry.message), [{ message: "You need to have killed The Nightmare to clip that shape." }]);
  assert.equal(sent.some((entry) => entry.sound === Topiary.CLIP_SOUND || entry.anim === Topiary.PRUNING), false);
  assert.equal(bushOf(house).getId(), C.getLocId("poh_topiary_null"));
});

test("every shaped bush answers Clip with the same menu", (t) => {
  const { player, sent, house } = ownerInGarden(t);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.SECATEURS, 1), false);
  const furniture = Object.values(player.getAttribute("construction:house").rooms[0][4][6].furnitureByLocation)
    .find((f) => f.buildableKey === "TOPIARY_BUSH");
  for (const shape of Topiary.SHAPES.slice(1)) {
    furniture.displayObjectId = shape.loc;
    house.redrawFurniture();
    sent.length = 0;
    assert.equal(clip(player, bushOf(house)).handled, true, shape.label);
    assert.ok(sent.some((entry) => entry.script === MENU_SCRIPT), `${shape.label} opens the menu`);
    player.getPacketSender().sendInterfaceRemoval();
  }
});

function vorkathDies(player, gameval) {
  const npc = new core.NPC(C.getNpcId(gameval), new core.Location(2272, 4065, 0));
  PM.emitNpcDeath({ npc, npcId: npc.getId(), killer: player });
}

function clipShape(player, house, sent, index) {
  clip(player, bushOf(house));
  sent.length = 0;
  pick(player, index);
  ticks(3);
  return bushOf(house).getId();
}

test("Vorkath's shape needs the post-quest Vorkath: the quest kill alone is refused", (t) => {
  const { player, sent, house } = ownerInGarden(t);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.SECATEURS, 1), false);
  const VORKATH = Topiary.SHAPES.findIndex((shape) => shape.label === "Vorkath");
  vorkathDies(player, "vorkath_quest");
  const Kills = require("../plugins/achievements/combatachievements/Kills.CombatAchievements");
  assert.equal(Kills.counts(player).Vorkath, 1, "Combat Achievements counts the quest kill");
  assert.equal(clipShape(player, house, sent, VORKATH), C.getLocId("poh_topiary_null"));
  assert.deepEqual(sent.filter((entry) => entry.message), [{ message: "You need to have killed Vorkath to clip that shape." }]);

  vorkathDies(player, "vorkath");
  assert.equal(player.getAttribute(Topiary.VORKATH_KILLED), true);
  assert.equal(clipShape(player, house, sent, VORKATH), C.getLocId("poh_topiary_vorkath"));
});

test("a saved Vorkath count of two includes a post-quest kill and unlocks her shape", (t) => {
  const { player, sent, house } = ownerInGarden(t);
  player.getInventory().add(new core.Item(core.ItemIdentifiers.SECATEURS, 1), false);
  const VORKATH = Topiary.SHAPES.findIndex((shape) => shape.label === "Vorkath");
  setKills(player, "Vorkath", 2);
  assert.equal(clipShape(player, house, sent, VORKATH), C.getLocId("poh_topiary_vorkath"));
});
