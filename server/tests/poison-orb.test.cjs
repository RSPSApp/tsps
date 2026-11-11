// Run after `yarn build`: node --test tests/poison-orb.test.cjs
// The hitpoints orb reads varp 102 (`poison`), encoded as rsprox captures show it.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CombatPoisonEffect } = require("../dist/game/task/impl/CombatPoisonEffect");
const { Player } = require('../dist/game/entity/impl/player/Player');
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { curePoisonAndVenom } = require('../plugins/items/ConsumableEffects');
const SerpentineHelm = require('../plugins/items/SerpentineHelm.plugin');
SerpentineHelm.register({
  core: { ItemIdentifiers, Equipment }, persistAttribute() {}, onItemAction() {},
  onItemOnItem() {}, onCombatHitResolved() {}, onPlayerProcess() {},
});

function afflictedPlayer(t, venom) {
  const player = new Player(null);
  player.setRegistered(true);
  player.setPoisonDamage(venom ? 10 : 27);
  player.setVenomed(venom);
  const hits = [];
  t.mock.method(player.getCombat().getHitQueue(), 'addPendingDamage', values => hits.push(...values));
  const effect = new CombatPoisonEffect(player);
  effect.setRunning(true);
  t.after(() => { effect.stop(); player.setRegistered(false); });
  return { player, effect, hits };
}

for (const venom of [false, true]) {
  test(`charged helmet protects without curing existing ${venom ? 'venom' : 'poison'}`, t => {
    const { player, effect, hits } = afflictedPlayer(t, venom);
    const helm = { getId: () => ItemIdentifiers.SERPENTINE_HELM, getMetaValue: () => 100 };
    t.mock.method(player.getEquipment(), 'get', slot => slot === Equipment.HEAD_SLOT ? helm : null);
    SerpentineHelm._test.processUpkeep(player);
    assert.ok(player.getCombat().getPoisonImmunityTimer().secondsRemaining() > 0);
    for (let tick = 0; tick < 29; tick++) effect.tick();
    assert.equal(effect.isRunning(), true);
    assert.equal(hits.length, 0);
    effect.tick();
    effect.tick();
    assert.deepEqual(hits.map(hit => hit.getDamage()), [venom ? 10 : 6]);
    assert.equal(player.getPoisonDamage(), venom ? 12 : 26);
    assert.equal(player.isVenomed(), venom);
  });

  test(`bare protection preserves the existing ${venom ? 'venom' : 'poison'} clock`, t => {
    const { player, effect, hits } = afflictedPlayer(t, venom);
    for (let tick = 0; tick < 15; tick++) effect.tick();
    player.getCombat().getPoisonImmunityTimer().start(60);
    for (let tick = 0; tick < 14; tick++) effect.tick();
    assert.equal(hits.length, 0);
    effect.tick();
    effect.tick();
    assert.deepEqual(hits.map(hit => hit.getDamage()), [venom ? 10 : 6]);
    assert.equal(effect.isRunning(), true);
  });

  test(`an explicit cure stops damage but retains the protection clock for ${venom ? 'venom' : 'poison'}`, t => {
    const { player, effect, hits } = afflictedPlayer(t, venom);
    player.getCombat().getPoisonImmunityTimer().start(60);
    curePoisonAndVenom(player);
    for (let tick = 0; tick < 35; tick++) effect.tick();
    assert.equal(effect.isRunning(), true);
    assert.equal(player.getPoisonDamage(), 0);
    assert.equal(player.isVenomed(), false);
    assert.equal(hits.length, 0);
  });

  test(`protection rejects new ${venom ? 'venom' : 'poison'} while an unprotected player is afflicted`, t => {
    const player = new Player(null);
    player.setRegistered(true);
    t.after(() => player.setRegistered(false));
    player.setPoisonDamage(0);
    player.setVenomed(false);
    const submitted = [];
    t.mock.method(TaskManager, 'submit', task => submitted.push(task));
    t.mock.method(player, 'sendMessage', () => {});
    player.getCombat().getPoisonImmunityTimer().start(venom ? 900 : 90);
    CombatFactory.poisonEntity(player, venom ? 6 : 27, venom ? 2 : 1);
    assert.equal(player.getPoisonDamage(), 0);
    assert.equal(player.isVenomed(), false);
    assert.equal(submitted.length, 1, 'the protection-only clock already owns one task');
    player.getCombat().getPoisonImmunityTimer().stop();
    CombatFactory.poisonEntity(player, venom ? 6 : 27, venom ? 2 : 1);
    assert.equal(player.getPoisonDamage(), venom ? 6 : 27);
    assert.equal(player.isVenomed(), venom);
    assert.equal(submitted.length, 2);
    assert.ok(submitted[1] instanceof CombatPoisonEffect);
  });
}

function mobile({ venomed = false, damage = 0, immunitySeconds = 0 } = {}) {
  return {
    isPlayer: () => false,
    isVenomed: () => venomed && damage > 0,
    isPoisoned: () => damage > 0,
    getPoisonDamage: () => damage,
    getCombat: () => ({ getPoisonImmunityTimer: () => ({ secondsRemaining: () => immunitySeconds }) }),
  };
}

test("poison shows its severity, venom 1,000,000 plus its hits, immunity its 18-second steps", () => {
  assert.equal(CombatPoisonEffect.ORB_VARP, 102);
  assert.equal(CombatPoisonEffect.orbValue(mobile()), 0);
  assert.equal(CombatPoisonEffect.orbValue(mobile({ damage: 10 })), 10, "captured: 10, then 9 after a hit");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ venomed: true, damage: 6 })), 1000000, "captured: venom starts at 1,000,000");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ venomed: true, damage: 10 })), 1000002, "two hits in");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ immunitySeconds: 360 })), -20, "captured: a superantipoison dose is -20");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ immunitySeconds: 90 })), -5, "captured: antipoison is -5");
  assert.equal(CombatPoisonEffect.orbValue(mobile({ immunitySeconds: 2 })), 0, "a serpentine helm's refresh is left out");
});

test("the orb's Cure says so when nothing in the pack can cure, and does nothing unpoisoned", async () => {
  const Potions = require("../plugins/items/Potions.plugin");
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(process.cwd());
  const { PluginManager } = require("../dist/plugins/PluginManager");
  Potions.register(PluginManager.createApi("PoisonOrbTest"));
  const messages = [];
  const player = (poisoned) => ({
    isPoisoned: () => poisoned,
    isVenomed: () => false,
    getInventory: () => ({ getItems: () => [{ getId: () => 995 }, null] }),
    sendMessage: (text) => messages.push(text),
  });
  Potions._test.cureFromHealthOrb({ player: player(false) });
  assert.deepEqual(messages, []);
  Potions._test.cureFromHealthOrb({ player: player(true) });
  assert.deepEqual(messages, ["You haven't got anything capable of curing your poison."], "captured");
});
