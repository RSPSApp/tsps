// Run after `yarn build`: node --test tests/prayer-drain-reset.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Altars = require("../plugins/objects/Altars.plugin");
const Pool = require("../plugins/objects/RejuvenationPool.plugin");
const Prison = require("../plugins/bosses/nex/Prison.Nex");
const NexCommon = require("../plugins/bosses/nex/Common.Nex");

test("praying at an altar and drinking from a Rejuvenation pool clear the prayer drain counter (Wiki)", async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  const api = PluginManager.createApi("PrayerDrainResetTest");
  Altars.register(api);
  NexCommon.init(api);

  let index = 2000;
  function actor() {
    const player = new Player(null, new core.Location(2616, 3309, 0));
    player.setIndex(index++);
    player.setUsername("prayer-drain-reset-test");
    player.setRegistered(true);
    player.setNeedsPlacement(false);
    player.getSession = () => ({ sendClientPacket: () => true, write() {} });
    player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 10);
    return player;
  }

  const id = core.ObjectIdentifiers.ALTAR;
  const pray = (player) => {
    const object = new core.GameObject(id, new core.Location(2617, 3309, 0), 10, 0, null);
    const event = { player, object, objectId: id, clickType: 1, handled: false };
    assert.equal(PluginManager.emitObjectInteraction(event), true);
  };

  const p = actor();
  p.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 1);
  p.setPrayerPointDrain(40);
  pray(p);
  assert.equal(p.getPrayerPointDrain(), 0, "restoring altar");

  const full = actor();
  full.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 10);
  full.setPrayerPointDrain(40);
  pray(full);
  assert.equal(full.getPrayerPointDrain(), 40, "full Prayer leaves the counter");

  // The pools, through the registered handlers.
  const handlers = {};
  Pool.register({
    getTaskManager: () => ({}),
    emitCustomEvent() {},
    onObjectInteraction: (name, h) => { handlers[name] = h.Drink; },
    onNpcInteraction() {},
    onItemOnObject() {},
    onPlayerEvent() {},
    onLogin() {},
    onLogout() {},
  });
  const drink = (name, player) => handlers[name]({ player, handled: false });
  for (const [name, cleared] of [
    ["Pool of Restoration", false],
    ["Pool of Revitalisation", false],
    ["Pool of Rejuvenation", true],
    ["Fancy pool of Rejuvenation", true],
  ]) {
    const player = actor();
    player.setPrayerPointDrain(40);
    drink(name, player);
    assert.equal(player.getPrayerPointDrain(), cleared ? 0 : 40, name);
  }

  // The Ancient Prison altar restores Prayer by its own code.
  const nex = actor();
  nex.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 1);
  nex.setPrayerPointDrain(40);
  Prison.pray({ player: nex });
  assert.equal(nex.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 10, "Ancient Prison restores");
  assert.equal(nex.getPrayerPointDrain(), 0, "Ancient Prison altar");
});
