// Run after `yarn build`: node --test tests/armadyl-brew.test.cjs
// Wiki (Armadyl brew): each dose raises Hitpoints by 2 + 10% and Ranged by 4 + 10% of their base levels
// (both may go above base by that much), and lowers Attack, Strength, Defence and Magic by 2 + 10% of
// their current levels. rsprox rec 4100 tick 4703 confirms the 99-level values and the two lines.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const { Item } = require('../dist/game/model/Item');
const { Skill } = require('../dist/game/model/Skill');
let Potions;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(process.cwd());
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  Potions = require('../plugins/items/Potions.plugin');
});

const COMBAT = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS];
const CHAIN = [I.ARMADYL_BREW_4_, I.ARMADYL_BREW_3_, I.ARMADYL_BREW_2_, I.ARMADYL_BREW_1_, I.VIAL];

function drinker(t, level, hitpoints = level) {
  const p = new Player(null); const lines = [];
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(p, 'sendMessage', m => lines.push(m));
  t.mock.method(p, 'performAnimation', () => {});
  t.mock.method(p.getPacketSender(), 'sendTypedMessage', (type, m) => { lines.push(m); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); TaskManager.cancelTasks(p); });
  const skills = p.getSkillManager();
  for (const skill of COMBAT) {
    skills.setExperience(skill, SkillManager.getExperienceForLevel(level));
    skills.setMaxLevel(skill, level);
    skills.setCurrentLevel(skill, level, false);
  }
  skills.setCurrentLevel(Skill.HITPOINTS, hitpoints, false);
  return { p, lines, skills };
}

function drink(f, id) {
  f.p.getInventory().setItem(0, new Item(id, 1));
  const item = f.p.getInventory().getItems()[0];
  return PluginManager.emitItemAction({ player: f.p, item, itemId: id, slot: 0, clickType: 1, handled: false });
}

test('each dose drinks, leaves the next dose and then a vial', t => {
  for (let i = 0; i < 4; i++) {
    const f = drinker(t, 99, 50);
    assert.equal(drink(f, CHAIN[i]), true, String(CHAIN[i]));
    assert.equal(f.p.getInventory().getItems()[0].getId(), CHAIN[i + 1], String(CHAIN[i]));
  }
});

test('a dose at 99: Ranged +13 and Hitpoints +11 above base, the others -11 (Wiki tables)', t => {
  const f = drinker(t, 99);
  drink(f, I.ARMADYL_BREW_4_);
  assert.equal(f.skills.getCurrentLevel(Skill.RANGED), 112);
  assert.equal(f.skills.getCurrentLevel(Skill.HITPOINTS), 110);
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.MAGIC]) {
    assert.equal(f.skills.getCurrentLevel(skill), 88, String(skill));
  }
});

test('the drink sends the brew line and the doses-left line', t => {
  const f = drinker(t, 70);
  drink(f, I.ARMADYL_BREW_3_);
  assert.deepEqual(f.lines, ['You drink some of the foul liquid.', 'You have 2 doses of potion left.']);
});

test('the heal tops up low Hitpoints by 2 + 10% of base', t => {
  const f = drinker(t, 75, 30);
  drink(f, I.ARMADYL_BREW_4_);
  assert.equal(f.skills.getCurrentLevel(Skill.HITPOINTS), 39);
});

test('a second dose does not lift Ranged or Hitpoints past base + one dose, and drains from the current level', t => {
  const f = drinker(t, 99);
  const potion = Potions._test.findPotionEntry(I.ARMADYL_BREW_4_).potion;
  potion.effect(f.p);
  potion.effect(f.p);
  assert.equal(f.skills.getCurrentLevel(Skill.RANGED), 112);
  assert.equal(f.skills.getCurrentLevel(Skill.HITPOINTS), 110);
  // 88 - (2 + floor(8.8)) = 78
  assert.equal(f.skills.getCurrentLevel(Skill.ATTACK), 78);
});

test('drains stop at 0 (Wiki: level 1 loses 1)', t => {
  const f = drinker(t, 1);
  drink(f, I.ARMADYL_BREW_4_);
  assert.equal(f.skills.getCurrentLevel(Skill.MAGIC), 0);
  assert.equal(f.skills.getCurrentLevel(Skill.RANGED), 5);
});
