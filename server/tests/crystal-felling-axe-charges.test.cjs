// Run after `yarn build`: node --test tests/crystal-felling-axe-charges.test.cjs
// Wiki (Crystal felling axe): it starts with 10,000 charges, "one charge being depleted for each item that is chopped
// using it", and empty it "will act like a dragon felling axe". Woodcutting spent a charge only for the crystal axe,
// and the charge code knew no felling axe, so the felling axe never ran down; its inactive form chopped nothing.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const CrystalAxe = require('../plugins/skills/woodcutting/CrystalAxe.Woodcutting');
let core, next = 9890;
const bots = process.env.DISABLE_PLAYER_BOTS;
const AT = [3222, 3218, 0];
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});
function chopper(t, axeId) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('crystalfell' + next); p.setRegistered(true); p.setLocation(new core.Location(...AT)); p.needsPlacement = false;
  const skills = p.getSkillManager();
  skills.setCurrentLevel(core.Skill.WOODCUTTING, 99, false).setMaxLevels(core.Skill.WOODCUTTING, 99, false);
  skills.setCurrentLevel(core.Skill.AGILITY, 99, false).setMaxLevels(core.Skill.AGILITY, 99, false);
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(axeId, 1));
  return p;
}
test('a log chopped with the crystal felling axe spends one of its 10,000 charges', (t) => {
  const p = chopper(t, core.ItemIdentifiers.CRYSTAL_FELLING_AXE);
  const axe = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  assert.equal(CrystalAxe.charges(axe), 10000);
  const request = { player: p, axe: undefined };
  PM.emitCustomEvent('woodcutting:axe', request);
  assert.equal(request.axe?.id, core.ItemIdentifiers.CRYSTAL_FELLING_AXE);
  // The chop's charge step, as Woodcutting calls it for the axe in use.
  assert.equal(CrystalAxe.tryUseCharge(p, () => 0.5, core.ItemIdentifiers.CRYSTAL_FELLING_AXE), true);
  assert.equal(CrystalAxe.charges(axe), 9999);
});
test('the last charge turns it into the inactive felling axe, which still chops as a felling axe', (t) => {
  const p = chopper(t, core.ItemIdentifiers.CRYSTAL_FELLING_AXE);
  const axe = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  axe.setMetaValue('crystal-axe', { charges: 1 });
  CrystalAxe.tryUseCharge(p, () => 0.5, core.ItemIdentifiers.CRYSTAL_FELLING_AXE);
  assert.equal(axe.getId(), core.ItemIdentifiers.CRYSTAL_FELLING_AXE_INACTIVE_);
  const request = { player: p, axe: undefined };
  PM.emitCustomEvent('woodcutting:axe', request);
  assert.equal(request.axe?.id, core.ItemIdentifiers.CRYSTAL_FELLING_AXE_INACTIVE_);
  assert.equal(request.axe?.felling, true);
});
test('a crystal axe carried beside the felling axe in use keeps its charges', (t) => {
  const p = chopper(t, core.ItemIdentifiers.CRYSTAL_FELLING_AXE);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.CRYSTAL_AXE, 1), true);
  const carried = p.getInventory().getItems().find((i) => i?.getId() === core.ItemIdentifiers.CRYSTAL_AXE);
  CrystalAxe.tryUseCharge(p, () => 0.5, core.ItemIdentifiers.CRYSTAL_FELLING_AXE);
  assert.equal(CrystalAxe.charges(carried), 10000);
});
test('a real chop of a tree with the felling axe spends the charge', (t) => {
  const p = chopper(t, core.ItemIdentifiers.CRYSTAL_FELLING_AXE);
  const axe = p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  t.mock.method(Math, 'random', () => 0.01); // every chop lands, past the 1/256 nest that would replace the log
  const tree = new core.GameObject(core.ObjectIdentifiers.TREE, new core.Location(AT[0] + 1, AT[1], 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => core.ObjectManager.deregister(tree, true));
  const definition = core.ObjectDefinition.forPlayer(tree.getId(), p);
  const clickType = definition.getInteractions().findIndex((o) => /chop/i.test(o ?? '')) + 1;
  PM.emitObjectInteraction({ player: p, object: tree, objectId: tree.getId(), definition, clickType, location: { x: AT[0] + 1, y: AT[1], z: 0 }, handled: false });
  for (let i = 0; i < 20 && p.getInventory().getAmount(core.ItemIdentifiers.LOGS) === 0; i++) { core.TaskManager.process(); p.getMovementQueue().process(); }
  assert.ok(p.getInventory().getAmount(core.ItemIdentifiers.LOGS) >= 1, 'a log was chopped');
  assert.ok(CrystalAxe.charges(axe) < 10000, `charges: ${CrystalAxe.charges(axe)}`);
});
