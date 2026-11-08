const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');

let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const api = PluginManager.createApi('RunecraftingDaeyaltAltarsTest');
  require('../plugins/skills/Runecrafting.plugin').register(api);
});

let index = 1200;
function crafter(level, items) {
  const player = new Player(null, new core.Location(2585, 4838, 0));
  player.setIndex(index++);
  player.setUsername('daeyalt-altar-test');
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.messages = [];
  player.sendMessage = text => player.messages.push(text);
  const skills = player.getSkillManager();
  skills.setCurrentLevels(core.Skill.RUNECRAFTING, level);
  player.xp = [];
  const addExperiences = skills.addExperiences.bind(skills);
  skills.addExperiences = (skill, xp) => {
    if (skill === core.Skill.RUNECRAFTING) player.xp.push(xp);
    return addExperiences(skill, xp);
  };
  for (const [id, amount] of items) player.getInventory().add(new Item(id, amount), false);
  return player;
}

function craft(player, objectId) {
  const object = new core.GameObject(objectId, player.getLocation(), 10, 0, null);
  const definition = core.ObjectDefinition.forPlayer(objectId, player);
  const event = { player, object, objectId, definition, clickType: 1, handled: false };
  return PluginManager.emitObjectInteraction(event);
}

test('the Fire Altar binds daeyalt essence first at 1.5 times the XP, then pure essence on a second click (Wiki: Daeyalt essence)', () => {
  const { ItemIdentifiers } = core;
  const player = crafter(14, [[ItemIdentifiers.DAEYALT_ESSENCE, 2], [ItemIdentifiers.PURE_ESSENCE, 3]]);
  const inventory = player.getInventory();

  assert.equal(craft(player, core.ObjectIdentifiers.ALTAR_37), true);
  assert.equal(inventory.getAmount(ItemIdentifiers.DAEYALT_ESSENCE), 0);
  assert.equal(inventory.getAmount(ItemIdentifiers.PURE_ESSENCE), 3, 'the pure essence waits for a second click');
  assert.equal(inventory.getAmount(ItemIdentifiers.FIRE_RUNE), 2);
  assert.deepEqual(player.xp, [21]);

  craft(player, core.ObjectIdentifiers.ALTAR_37);
  assert.equal(inventory.getAmount(ItemIdentifiers.PURE_ESSENCE), 0);
  assert.equal(inventory.getAmount(ItemIdentifiers.FIRE_RUNE), 5);
  assert.deepEqual(player.xp, [21, 21]);
});

test('a pure-essence-only altar binds daeyalt essence held alone (Wiki: Daeyalt essence)', () => {
  const { ItemIdentifiers } = core;
  const player = crafter(27, [[ItemIdentifiers.DAEYALT_ESSENCE, 4]]);
  craft(player, core.ObjectIdentifiers.ALTAR_39);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.DAEYALT_ESSENCE), 0);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COSMIC_RUNE), 4);
  assert.deepEqual(player.xp, [4 * 8 * 1.5]);
});
