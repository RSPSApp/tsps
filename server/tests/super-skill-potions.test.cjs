// Run after `yarn build`: node --test tests/super-skill-potions.test.cjs
//
// The super fishing and super hunter potions were never registered, so Drink did nothing.
// Wiki (Super fishing potion, Pillar coral; Super hunter potion, Crystal impling): a flat +6 a dose.
// rsprox.net rec 4100 (rev 237) tick 953, super fishing potion(3): human_eat, sound 2401,
// "You drink some of your super fishing potion." then the doses-left line (spam), a (2) left.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');
const { Skill } = require('../dist/game/model/Skill');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');

let Potions;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  Potions = require('../plugins/items/Potions.plugin');
});

function drinker(t, skill, level) {
  const p = new Player(null); const lines = []; const anims = [];
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(p, 'sendMessage', m => lines.push(m));
  t.mock.method(p, 'performAnimation', a => anims.push(a.getId?.() ?? a.id));
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (type, m) => { lines.push(m); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); TaskManager.cancelTasks(p); });
  const skills = p.getSkillManager();
  skills.setExperience(skill, SkillManager.getExperienceForLevel(level));
  skills.setMaxLevel(skill, level);
  skills.setCurrentLevel(skill, level, false);
  return { p, lines, anims, skills };
}

function drink(f, id) {
  f.p.getInventory().setItem(0, new Item(id, 1));
  const item = f.p.getInventory().getItems()[0];
  return PluginManager.emitItemAction({ player: f.p, item, itemId: id, slot: 0, clickType: 1, handled: false });
}

// Only the super fishing potion's line is recorded (data/potion-drink-lines.json); the super hunter
// potion has none on record, so like every unlisted potion it sends only the doses-left line.
const CASES = [
  ['super fishing potion', Skill.FISHING, [I.SUPER_FISHING_POTION_4_, I.SUPER_FISHING_POTION_3_, I.SUPER_FISHING_POTION_2_, I.SUPER_FISHING_POTION_1_, I.VIAL]],
  ['super hunter potion', Skill.HUNTER, [I.SUPER_HUNTER_POTION_4_, I.SUPER_HUNTER_POTION_3_, I.SUPER_HUNTER_POTION_2_, I.SUPER_HUNTER_POTION_1_, I.VIAL]],
];

for (const [name, skill, chain] of CASES) {
  test(`each dose of the ${name} boosts by a flat 6 and leaves the next dose, then a vial`, t => {
    for (const level of [1, 74, 99]) {
      for (let i = 0; i < 4; i++) {
        const f = drinker(t, skill, level);
        assert.equal(drink(f, chain[i]), true, `${chain[i]} at ${level}`);
        assert.equal(f.skills.getCurrentLevel(skill), level + 6, `${chain[i]} at ${level}`);
        assert.equal(f.p.getInventory().getItems()[0].getId(), chain[i + 1]);
      }
    }
  });

  test(`the ${name} sends the recorded drink line and the doses-left line`, t => {
    const f = drinker(t, skill, 70);
    drink(f, chain[1]);
    const recorded = name === 'super fishing potion' ? [`You drink some of your ${name}.`] : [];
    assert.deepEqual(f.lines, [...recorded, 'You have 2 doses of potion left.']);
    assert.equal(f.anims.length, 1);
  });

  test(`a second ${name} dose does not stack past +6`, t => {
    const f = drinker(t, skill, 80);
    const potion = (id) => Potions._test.findPotionEntry(id).potion;
    potion(chain[0]).effect(f.p);
    potion(chain[1]).effect(f.p);
    assert.equal(f.skills.getCurrentLevel(skill), 86);
  });
}
