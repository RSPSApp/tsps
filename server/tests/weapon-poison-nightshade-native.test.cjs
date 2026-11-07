// Real registered item-pair hooks with seeded ingredients; no farming or client-wire claim.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
let core, nextName = 0;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function quest(key) {
  const found = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === key);
  assert.ok(found, `registered quest ${key}`);
  return found;
}

function actor(t, level = 82) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const errors = [], warnings = [], messages = [];
  const originalError = console.error.bind(console), originalWarn = console.warn.bind(console);
  t.mock.method(console, 'error', (...args) => { errors.push(args); return originalError(...args); });
  t.mock.method(console, 'warn', (...args) => {
    if (String(args[0]).includes('[plugins]')) warnings.push(args);
    return originalWarn(...args);
  });
  t.after(() => {
    const index = player.getIndex();
    try { PM.emitPlayerLogout({ player, username: player.getUsername() }); }
    finally {
      player.closeInterruptibleInterfaces(); core.World.getPlayers().remove(player);
      core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(index);
      assert.equal(player.isRegistered(), false);
      assert.equal(core.TaskManager.hasActiveTask(player), false);
      assert.equal(core.TaskManager.hasActiveTask(index), false);
      assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
    }
  });
  player.setUsername(`nightmix${nextName++}`);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  assert.notEqual(player.getLongUsername(), 0n);
  player.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(player), true);
  assert.equal(core.WorldDefinition.isMembersWorld(), true);
  assert.ok(player.getHitpoints() > 0); assert.notEqual(player.isDyingReturn(), true);
  const skill = core.Skill.HERBLORE, skills = player.getSkillManager();
  skills.setMaxLevels(skill, level, false);
  skills.setExperiences(skill, core.SkillManager.getExperienceForLevel(level), false);
  skills.setCurrentLevel(skill, level, false);
  assert.equal(skills.getMaxLevel(skill), level); assert.equal(skills.getCurrentLevel(skill), level);
  assert.equal(skills.getExperience(skill), core.SkillManager.getExperienceForLevel(level));
  const druidic = quest('druidic_ritual');
  druidic.setStage(player, druidic.completionValue);
  const query = { player, key: 'druidic_ritual', complete: false };
  PM.emitCustomEvent('quest:is-complete', query);
  assert.equal(query.complete, true);
  const originalMessage = player.sendMessage.bind(player);
  t.mock.method(player, 'sendMessage', text => { messages.push(String(text)); return originalMessage(text); });
  return { player, messages };
}

function definitions() {
  const C = core.CacheDefinitions;
  const cave = C.getObjId('nightshade'), farmed = C.getObjId('stackable_nightshade');
  const milk = C.getObjId('vial_coconut_milk'), product = C.getObjId('unfinished_weapon_poison++');
  assert.equal(cave, 2398); assert.equal(farmed, 27790);
  for (const id of [cave, farmed, milk, product]) {
    const raw = C.getItem(id), def = core.ItemDefinition.forId(id);
    assert.equal(raw.noteTemplate, -1, `non-noted cached item ${id}`);
    assert.equal(raw.placeholderTemplate, -1, `non-placeholder cached item ${id}`);
    assert.equal(def.isNoted(), false);
  }
  assert.equal(core.ItemDefinition.forId(cave).isStackable(), false);
  assert.equal(core.ItemDefinition.forId(farmed).isStackable(), true);
  return { cave, farmed, milk, product };
}

function inventoryItem(player, id) {
  const slots = player.getInventory().getItems();
  const slot = slots.findIndex(item => item && item.getId() === id);
  assert.ok(slot >= 0, `item ${id} is in inventory`);
  return { slot, value: slots[slot] };
}

function attempt(f, ingredient, reverse) {
  const d = definitions(), inv = f.player.getInventory();
  const quantity = ingredient === d.farmed ? 2 : 1;
  inv.add(new core.Item(d.milk, 1)); inv.add(new core.Item(ingredient, quantity));
  assert.equal(inv.getAmount(d.milk), 1); assert.equal(inv.getAmount(ingredient), quantity);
  const first = inventoryItem(f.player, reverse ? ingredient : d.milk);
  const second = inventoryItem(f.player, reverse ? d.milk : ingredient);
  const xp = f.player.getSkillManager().getExperience(core.Skill.HERBLORE);
  const event = { player: f.player, usedItem: first.value, usedWithItem: second.value,
    usedItemId: first.value.getId(), usedWithItemId: second.value.getId(),
    usedItemSlot: first.slot, usedWithItemSlot: second.slot, handled: false };
  const dispatched = PM.emitItemOnItem(event);
  return { d, inv, quantity, xp, event, dispatched };
}

for (const reverse of [false, true]) {
  test(`cave nightshade mixes with coconut milk, reverse=${reverse}`, t => {
    const f = actor(t), d = definitions(), r = attempt(f, d.cave, reverse);
    assert.equal(r.dispatched, true); assert.equal(r.event.handled, true);
    assert.equal(r.inv.getAmount(d.milk), 0); assert.equal(r.inv.getAmount(d.cave), 0);
    assert.equal(r.inv.getAmount(d.product), 1);
    assert.equal(f.player.getSkillManager().getExperience(core.Skill.HERBLORE), r.xp);
  });
}
for (const reverse of [false, true]) {
  test(`farmed nightshade mixes with coconut milk, reverse=${reverse}`, t => {
    const f = actor(t), d = definitions(), r = attempt(f, d.farmed, reverse);
    assert.equal(r.dispatched, true); assert.equal(r.event.handled, true);
    assert.equal(r.inv.getAmount(d.milk), 0); assert.equal(r.inv.getAmount(d.farmed), 1);
    assert.equal(r.inv.getAmount(d.product), 1);
    assert.equal(f.player.getSkillManager().getExperience(core.Skill.HERBLORE), r.xp);
  });
}
test('cave recipe still refuses below Herblore 82', t => {
  const f = actor(t, 81), d = definitions(), r = attempt(f, d.cave, false);
  assert.equal(r.dispatched, true); assert.equal(r.event.handled, true);
  assert.equal(r.inv.getAmount(d.milk), 1); assert.equal(r.inv.getAmount(d.cave), 1);
  assert.equal(r.inv.getAmount(d.product), 0);
  assert.ok(f.messages.some(line => line.includes('Herblore level of 82')));
  assert.equal(f.player.getSkillManager().getExperience(core.Skill.HERBLORE), r.xp);
});
