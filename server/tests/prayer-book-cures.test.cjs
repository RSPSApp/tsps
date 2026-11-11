const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { CombatPoisonEffect } = require('../dist/game/task/impl/CombatPoisonEffect');
const Potions = require('../plugins/items/Potions.plugin');
let core, actions, codec;
const READ = 'quest.great_brain_robbery.book-read';
before(async () => {
  await CachePipeline.initialize(process.cwd());
  core = PluginManager.getCoreApi();
  const api = PluginManager.createApi('PrayerBookCuresTest');
  require('../plugins/quests/quests/GreatBrainRobbery.Quest')({ ...api,
    onItemAction(name, handlers) {
      if (name === 'Prayer book') actions = handlers;
      api.onItemAction(name, handlers);
    },
  });
  Potions.register(PluginManager.createApi('PrayerBookPotionTest'));
  require('../plugins/persistence/JsonPlayerPersistence.plugin').register({
    getSkillManager: () => require('../dist/game/content/skill/SkillManager').SkillManager,
    setPlayerPersistence: backend => { codec = backend; }, log() {},
  });
});
function fixture(t, { damage = 30, prayer = 99, symbol = 'HOLY_SYMBOL', read = true, book = true } = {}) {
  const p = new Player(null), messages = [];
  const sender = new Proxy({}, { get: (_, key) => key === 'hasInterruptibleInterface' ? () => false : () => sender });
  t.mock.method(p, 'getPacketSender', () => sender);
  t.mock.method(p, 'sendMessage', text => messages.push(text));
  p.setRegistered(true); p.setPoisonDamage(damage); p.setVenomed(false);
  p.getSkillManager().setCurrentLevel(core.Skill.PRAYER, prayer, false);
  p.getSkillManager().setMaxLevel(core.Skill.PRAYER, 99);
  p.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99);
  p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99, false);
  p.setAttribute(READ, read);
  if (book) p.getInventory().setItem(0, new core.Item(core.ItemIdentifiers.PRAYER_BOOK_2, 1));
  if (symbol) p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(core.ItemIdentifiers[symbol], 1));
  return { p, messages,
    action(stepId) { PluginManager.emitCustomEvent('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.BROTHER_TRANQUILITY, stepId, kind: 'action' }); },
    condition(stepId) { return PluginManager.emitNpcDialogueCondition({ player: p, npcId: core.NpcIdentifiers.BROTHER_TRANQUILITY, stepId }); },
    recite() { actions['Recite-prayer']({ player: p, itemId: core.ItemIdentifiers.PRAYER_BOOK_2, slot: 0 }); },
  };
}
test('the transcript checks the real poison state instead of always claiming unpoisoned', t => {
  for (const damage of [0, 1, 30]) {
    const f = fixture(t, { damage });
    assert.equal(f.condition('LWjR89'), damage === 0);
    assert.equal(f.condition('gyOFgt'), damage > 0);
  }
});
test('the cure action clears ordinary poison and charges the published prayer cost', t => {
  for (const [severity, cost] of [[1, 0], [10, 0], [11, 1], [30, 2], [35, 3], [100, 9]]) {
    const f = fixture(t, { damage: severity }); f.action('hnbBxH');
    assert.equal(f.p.getPoisonDamage(), 0, String(severity));
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 99 - cost);
    assert.equal(f.p.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0);
  }
});
test('insufficient prayer reduces poison, while zero prayer does nothing even for a free cure', t => {
  const partial = fixture(t, { damage: 35, prayer: 1 }); partial.action('hnbBxH');
  assert.equal(partial.p.getPoisonDamage(), 25);
  assert.equal(partial.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 0);
  for (const damage of [1, 10, 35]) {
    const none = fixture(t, { damage, prayer: 0 }); none.action('hnbBxH');
    assert.equal(none.p.getPoisonDamage(), damage);
  }
});
test('holy and hallowed symbols work; missing symbol, unread or absent book cannot cure', t => {
  for (const symbol of ['HOLY_SYMBOL', 'HALLOWED_SYMBOL']) {
    const f = fixture(t, { symbol }); f.action('hnbBxH'); assert.equal(f.p.getPoisonDamage(), 0);
  }
  for (const options of [{ symbol: null }, { read: false }, { book: false }]) {
    const f = fixture(t, options); f.action('hnbBxH');
    assert.equal(f.p.getPoisonDamage(), 30); assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 99);
  }
});
test('actual venom hits retain their last damage independently of the next hit and survive saving', t => {
  const f = fixture(t, { damage: 18 }); f.p.setVenomed(true);
  const queue = f.p.getCombat().getHitQueue();
  const effect = new CombatPoisonEffect(f.p); effect.setRunning(true); t.after(() => effect.stop());
  for (let i = 0; i < 35 && !queue.hasPendingWork(); i++) effect.tick();
  assert.equal(queue.hasPendingWork(), true);
  assert.equal(f.p.getLastVenomDamage(), undefined, 'pending damage has not been dealt');
  queue.process(1);
  assert.equal(f.p.getPoisonDamage(), 20); assert.equal(f.p.getLastVenomDamage(), 18);
  const saved = PlayerSave.fromPlayer(f.p); assert.equal(saved.lastVenomDamage, 18);
  const snapshot = JSON.parse(JSON.stringify(saved, codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const restored = new Player(null); codec.hydratePlayerSave(snapshot).applyToPlayer(restored);
  assert.equal(restored.getLastVenomDamage(), 18);
  for (let i = 0; i < 35 && !queue.hasPendingWork(); i++) effect.tick();
  assert.equal(f.p.getLastVenomDamage(), 18, 'next pending hit does not replace the last actual one');
  queue.process(2);
  assert.equal(f.p.getPoisonDamage(), 20); assert.equal(f.p.getLastVenomDamage(), 20);
});
test('cancelled or stale venom hits cannot overwrite another affliction incarnation', t => {
  for (const kind of ['clear', 'cure', 'reapply', 'depart']) {
    const f = fixture(t, { damage: 18 }); f.p.setVenomed(true); f.p.setLastVenomDamage(6);
    const queue = f.p.getCombat().getHitQueue(), effect = new CombatPoisonEffect(f.p);
    effect.setRunning(true); t.after(() => effect.stop());
    for (let i = 0; i < 35 && !queue.hasPendingWork(); i++) effect.tick();
    assert.equal(f.p.getLastVenomDamage(), 6);
    if (kind === 'clear') queue.clear();
    if (kind === 'cure' || kind === 'reapply') f.p.setPoisonDamage(0);
    if (kind === 'reapply') { f.p.setPoisonDamage(6); f.p.setVenomed(true); }
    if (kind === 'depart') f.p.setRegistered(false);
    queue.process(3);
    assert.equal(f.p.getLastVenomDamage(), kind === 'clear' || kind === 'depart' ? 6 : undefined, kind);
  }
});
test('the book downgrades venom using the last hit and charges at most fifty prayer', t => {
  for (const [prayer, last] of [[99, 6], [50, 18], [1, 20]]) {
    const f = fixture(t, { prayer, damage: 20 }); f.p.setVenomed(true); f.p.setLastVenomDamage(last);
    f.action('hnbBxH');
    assert.equal(f.p.isVenomed(), false); assert.equal(f.p.getPoisonDamage(), last * 5 - 4, 'the antipoison conversion');
    assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), Math.max(0, prayer - 50));
    assert.equal(f.p.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0);
  }
});
test('last-hit state is cleared with a cure and omitted from unaffected saves', t => {
  const f = fixture(t, { damage: 0 });
  assert.equal(JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.p))).lastVenomDamage, undefined);
  f.p.setVenomed(true); f.p.setLastVenomDamage(18); f.p.setPoisonDamage(0);
  assert.equal(f.p.getLastVenomDamage(), undefined);
  f.p.setPoisonDamage(6); f.p.setVenomed(true); f.p.setLastVenomDamage(6); f.p.setVenomed(false);
  assert.equal(f.p.getLastVenomDamage(), undefined);
});
test('a legacy venom save without historical hit data retains current damage as its fallback', t => {
  const f = fixture(t, { damage: 20 }); f.p.setVenomed(true);
  assert.equal(f.p.getLastVenomDamage(), undefined);
  f.action('hnbBxH');
  assert.equal(f.p.isVenomed(), false); assert.equal(f.p.getPoisonDamage(), 96);
});
test('manual recitation and health-orb fallback both apply the treatment without consuming the book', t => {
  for (const orb of [false, true]) {
    const f = fixture(t);
    if (orb) Potions._test.cureFromHealthOrb({ player: f.p }); else f.recite();
    assert.equal(f.p.getPoisonDamage(), 0);
    assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.PRAYER_BOOK_2), 1);
    assert.ok(!f.messages.some(text => text.includes("player's poison")), 'no placeholder text');
  }
});
test('potions still take precedence over the book, preserving prayer points', t => {
  const f = fixture(t); f.p.getInventory().setItem(1, new core.Item(core.ItemIdentifiers.ANTIPOISON_1_, 1));
  Potions._test.cureFromHealthOrb({ player: f.p });
  assert.equal(f.p.getInventory().getItems()[1].getId(), core.ItemIdentifiers.VIAL);
  assert.equal(f.p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 99);
});
