// Run after `yarn build`: node --test tests/avarice-slayer-helm-no-stack.test.cjs
// Wiki (Amulet of avarice): "The effects of the amulet do not stack with the Slayer helmet (i)." Against a revenant in
// the caves, on a revenant task, the amulet's +20% stands in for the helmet's bonus, as a salve amulet does. Real
// engine: every plugin loaded (each one's registered modifiers applied), a real Player wearing both.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const Effects = require("../dist/game/content/combat/EquipmentEffects");

let core, Data;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  Data = require("../plugins/npcs/revenants/Data.Revenants");
});
after(() => PM.emitServerShutdown({}));

test("avarice and an imbued slayer helmet on a revenant task: the amulet's bonus alone", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9975); p.setUsername("avaricehelm"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 10100, 0)); p.needsPlacement = false;
  t.after(() => p.setRegistered(false));
  p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(Data.ITEMS.AMULET_OF_AVARICE, 1));
  p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(core.ItemIdentifiers.SLAYER_HELMET_I_, 1));
  const revenant = core.NPC.create(Data.REVENANTS.DRAGON, new core.Location(3201, 10100, 0));
  t.mock.method(p.getCombat(), "getTarget", () => revenant);
  PM.createApi("AvariceHelmTask").onCustomEvent("slayer:on-task", (request) => { if (request.player === p) request.onTask = true; });
  assert.equal(Effects.applyMeleeHitModifiers(p, 1200), 1440, "x1.2 from the amulet, not x1.2 then the helmet's x7/6");
  p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(-1, 0));
  assert.equal(Effects.applyMeleeHitModifiers(p, 1200), 1400, "without the amulet the helmet's x7/6 applies");
});
