// Run after `yarn build`: node --test tests/granite-maul-first-strike-warning.test.cjs
//
// The granite maul's special pressed with no target, as recorded on a normal world
// (rsprox_transcripts/232/03142.txt:83476 and :84215): one game message, "Warning: Since the maul's special is an
// instant attack, it will be wasted when used on a first strike.". Real plugins, a real Player and its equipment.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../dist/net/BotPlayerSession");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});

test("pressed with no target: the recorded warning, once", (t) => {
  const p = new Player(new BotPlayerSession());
  p.setUsername("maulwarning");
  const messages = [];
  t.mock.method(p, "sendMessage", (m) => messages.push(m));
  p.getEquipment().setItem(Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.GRANITE_MAUL, 1));
  WeaponInterfaceManager.assign(p);
  p.setSpecialPercentage(100);
  assert.equal(p.getCombatSpecial()?.getTraits?.()?.queuedAttack, true, "the maul's queued special is equipped");
  CombatSpecial.activate(p);
  assert.deepEqual(messages, ["Warning: Since the maul's special is an instant attack, it will be wasted when used on a first strike."]);
});
