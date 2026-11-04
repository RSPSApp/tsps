// Run after `yarn build`: node --test tests/combat-status-death-edges.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { CombatType } = require('../dist/game/content/combat/CombatType');
const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
const { AccuracyFormulasDpsCalc } = require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
const { DamageFormulas } = require('../dist/game/content/combat/formula/DamageFormulas');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});

const method = { type: () => CombatType.MELEE, accuracyDefenceType: () => undefined };

let nextImpactIndex = 2000;
function impactFixture(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { NPC } = require('../dist/game/entity/impl/npc/NPC');
  const { NpcIdentifiers } = require('../dist/util/NpcIdentifiers');
  const { Location } = require('../dist/game/model/Location');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(3222, 3218));
  p.setIndex(nextImpactIndex++); p.setUsername('impactdialogue'); p.setRegistered(true);
  p.setHitpoints(10); p.setNeedsPlacement(false); p.setAutoRetaliate(false);
  const attacker = NPC.create(NpcIdentifiers.MAN, new Location(3223, 3218));
  attacker.setIndex(nextImpactIndex++); attacker.setRegistered(true);
  const connection = new ClientConnection(channel); connection.player = p;
  t.after(() => {
    p.getPacketSender().sendInterfaceRemoval(); p.setRegistered(false); attacker.setRegistered(false);
    p.getCombat().getHitQueue().clear(); TaskManager.cancelTasks(p.getIndex());
  });
  return {
    p,
    hit(damage = 1, applied) {
      const hit = new PendingHit(attacker, p, method, {
        damage, rollAccuracy: false, experience: false, handleAfterHitEffects: false,
      });
      if (applied) hit.getHits()[0].onApplied(applied);
      assert.equal(hit.getTotalDamage(), damage);
      CombatFactory.executeHit(hit);
      p.getCombat().getHitQueue().process(1);
    },
    async resume(widgetId, childIndex = -1) {
      await connection.dispatch([{ type: 'dialogue_continue', widgetId, childIndex }]);
      connection.processTurnPackets();
    },
  };
}

function impactConversation(p, kind, reward) {
  const { DialogueChainBuilder } = require('../dist/game/model/dialogues/builders/DialogueChainBuilder');
  const { NpcDialogue } = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
  const { PlayerDialogue } = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
  const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
  const { ActionDialogue } = require('../dist/game/model/dialogues/entries/impl/ActionDialogue');
  const { NpcIdentifiers } = require('../dist/util/NpcIdentifiers');
  const entry = kind === 'choice' ? new OptionDialogue(0, { executeOption: reward }, 'Accept')
    : kind === 'player' ? new PlayerDialogue(0, 'Let me finish speaking.')
    : new NpcDialogue(0, NpcIdentifiers.MAN, 'Let me finish speaking.');
  p.getDialogueManager().startDialogues(new DialogueChainBuilder().add(entry, new ActionDialogue(1, { execute: reward })), {});
  return kind === 'choice' ? OptionDialogue.OPTIONS_WIDGET_ID : (p.getPacketSender().getChatboxGroupId() << 16) | 5;
}

for (const [kind, damage] of [['npc', 1], ['player', 1], ['choice', 1], ['npc', 0]]) {
  test(`a real ${damage}-damage melee hit closes ${kind} chatbox dialogue and rejects its stale native continuation`, async t => {
    const f = impactFixture(t);
    let rewards = 0;
    const widget = impactConversation(f.p, kind, () => rewards++);
    assert.equal(f.p.busy(), false, 'ordinary chatbox dialogue does not block ordinary actions');
    assert.equal(f.p.getPacketSender().hasInterruptibleInterface(), true);
    f.hit(damage);
    assert.equal(f.p.getHitpoints(), 10 - damage, 'the real hit queue applies damage');
    assert.equal(f.p.getDialogueManager().getCurrent(), undefined);
    assert.equal(f.p.getPacketSender().getChatboxGroupId(), -1);
    await f.resume(widget, kind === 'choice' ? 1 : -1);
    assert.equal(rewards, 0, 'the cancelled conversation cannot award anything');
  });
}

test('a hit leaves the developer dialogue exception intact', t => {
  const { PlayerRights } = require('../dist/game/model/rights/PlayerRights');
  const { MORTAL_DEVELOPER_ATTRIBUTE } = require('../dist/game/entity/impl/Mobile');
  const f = impactFixture(t);
  f.p.setRights(PlayerRights.DEVELOPER);
  f.p.setAttribute(MORTAL_DEVELOPER_ATTRIBUTE, true);
  impactConversation(f.p, 'npc', () => {});
  const original = f.p.getDialogueManager().getCurrent();
  f.hit();
  assert.equal(f.p.getHitpoints(), 9);
  assert.equal(f.p.getDialogueManager().getCurrent(), original);
});

for (const status of ['TRADING', 'DUELING']) {
  test(`a hit still removes interfaces while ${status.toLowerCase()}`, t => {
    const { PlayerStatus } = require('../dist/game/model/PlayerStatus');
    const f = impactFixture(t);
    impactConversation(f.p, 'npc', () => {});
    f.p.setStatus(PlayerStatus[status]);
    assert.equal(f.p.busy(), true);
    f.hit();
    assert.equal(f.p.getHitpoints(), 9);
    assert.equal(f.p.getStatus(), PlayerStatus.NONE);
    assert.equal(f.p.getDialogueManager().isActive(), false);
  });
}

test('a later dialogue opened by the applied-hit callback survives the older dialogue interruption', async t => {
  const f = impactFixture(t);
  let oldRewards = 0;
  const oldWidget = impactConversation(f.p, 'npc', () => oldRewards++);
  let later, appliedDamage, oldActive;
  f.hit(1, lost => {
    appliedDamage = lost;
    oldActive = f.p.getDialogueManager().isActive();
    impactConversation(f.p, 'player', () => {});
    later = f.p.getDialogueManager().getCurrent();
  });
  assert.equal(appliedDamage, 1);
  assert.equal(oldActive, false, 'the old interface closes before damage callbacks');
  assert.ok(later, 'the real applied-hit callback opens its own dialogue');
  assert.equal(f.p.getHitpoints(), 9);
  assert.equal(f.p.getDialogueManager().getCurrent(), later);
  await f.resume(oldWidget);
  assert.equal(f.p.getDialogueManager().getCurrent(), later, 'the old widget cannot resume a different chatbox');
  assert.equal(oldRewards, 0);
});

test('an untargetable cutscene keeps its dialogue and takes no queued attack damage', t => {
  const f = impactFixture(t);
  impactConversation(f.p, 'npc', () => {});
  const original = f.p.getDialogueManager().getCurrent();
  f.p.setUntargetable(true);
  f.hit();
  assert.equal(f.p.getHitpoints(), 10);
  assert.equal(f.p.getDialogueManager().getCurrent(), original);
});

for (const type of [0, 1, 3]) test(`combat respects the interruption policy for a tracked type-${type} sub-interface`, t => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
  const f = impactFixture(t), sender = f.p.getPacketSender();
  const target = CacheDefinitions.getComponentId('toplevel:mainmodal');
  assert.ok(Number.isInteger(target), 'the modal target exists in the active cache');
  sender.sendSubInterface(target, OptionDialogue.OPTIONS_WIDGET_ID >>> 16, type);
  assert.equal(f.p.busy(), false, 'a tracked sub-interface need not set the legacy main interface ID');
  const close = t.mock.method(sender, 'sendInterfaceRemoval');
  f.hit();
  assert.equal(f.p.getHitpoints(), 9);
  assert.equal(close.mock.callCount(), type === 1 ? 0 : 1, 'passive overlays stay open; modal types close');
  assert.equal(sender.hasInterruptibleInterface(), false);
});

function npc(hitpoints = 100) {
  const entity = {
    hitpoints,
    isPlayer: () => false,
    isNpc: () => true,
    getHitpoints: () => entity.hitpoints,
  };
  return entity;
}

function withMaxHit(maxHit, action) {
  const original = DamageFormulas.sourceMaxHit;
  DamageFormulas.sourceMaxHit = () => maxHit;
  try {
    return action();
  } finally {
    DamageFormulas.sourceMaxHit = original;
  }
}

function player({ hitpoints = 99, shield = -1 } = {}) {
  const prayers = [];
  const entity = {
    hitpoints,
    prayers,
    isPlayer: () => true,
    isNpc: () => false,
    getHitpoints: () => entity.hitpoints,
    getAsPlayer: () => entity,
    getPrayerActive: () => prayers,
    getEquipment: () => ({
      getItems: () => Array.from({ length: 14 }, () => ({ getId: () => shield })),
    }),
    performGraphic() {},
  };
  return entity;
}

test('a heal after the roll but before impact keeps an already-rolled hit non-lethal', () => {
  const attacker = npc();
  const target = npc(10);
  const original = CombatFactory.getHitDamage;
  CombatFactory.getHitDamage = () => new HitDamage(20, HitMask.RED);
  try {
    const hit = new PendingHit(attacker, target, method, {
      rollAccuracy: false,
      experience: false,
      handleAfterHitEffects: false,
    });
    assert.equal(hit.getTotalDamage(), 10, 'the roll is capped to the 10 HP held when it was made');
    target.hitpoints = 20; // tick-eat before the hit lands
    assert.equal(hit.getTotalDamage(), 10, 'healing does not reroll the hit');
    assert.ok(target.hitpoints - hit.getTotalDamage() > 0, 'the capped roll cannot kill the healed target');
  } finally {
    CombatFactory.getHitDamage = original;
  }
});

test('protection prayer is read when the hit lands, not when its damage was rolled', withMaxHit(20, () => {
  const target = player();
  const hit = new PendingHit(npc(), target, method, { damage: 20, rollAccuracy: false, experience: false });
  assert.equal(hit.getTotalDamage(), 20, 'the roll itself is not reduced');

  target.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE] = true;
  CombatFactory.applyHitTimeDefences(hit);
  assert.equal(hit.getTotalDamage(), 0, 'a prayer flicked on before impact blocks the hit');

  const prayingTarget = player();
  prayingTarget.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE] = true;
  const flickedOff = new PendingHit(npc(), prayingTarget, method, { damage: 20, rollAccuracy: false, experience: false });
  assert.equal(flickedOff.getTotalDamage(), 20, 'a prayer active at roll time is not banked into the hit');
  prayingTarget.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE] = false;
  CombatFactory.applyHitTimeDefences(flickedOff);
  assert.equal(flickedOff.getTotalDamage(), 20, 'turning the prayer off before impact leaves the hit unprotected');
}));

test('Elysian is evaluated at impact and still cuts the landing hit', withMaxHit(20, () => {
  const target = player({ shield: ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD });
  const hit = new PendingHit(npc(), target, method, { damage: 20, rollAccuracy: false, experience: false });
  assert.equal(hit.getTotalDamage(), 20, 'the shield waits for impact');

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    CombatFactory.applyHitTimeDefences(hit);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(hit.getTotalDamage(), 15, 'the 70% Elysian proc cuts 25% when the hit lands');
}));

test('dying clears the actor cache; a later roll starts from fresh effective levels', () => {
  const cache = AccuracyFormulasDpsCalc.rollCache;
  const entity = {};
  cache.set(entity, { cycle: 1, defenceLevel: 99, defenseMeleeRolls: new Map() });
  assert.equal(cache.has(entity), true);

  CombatFactory.clearHitRollCache(entity);
  assert.equal(cache.has(entity), false, 'the dead actor no longer reuses its cached levels');
});

test('the dying event fires during the death animation, before respawning', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const victim = new Player(null), killer = new Player(null);
  const order = [];
  t.mock.method(victim.getCombat(), 'getKiller', () => killer);
  t.mock.method(victim, 'getPacketSender', () => ({ sendConfig() {}, sendInterfaceRemoval() {}, sendDestination() {} }));
  t.mock.method(victim, 'sendMessage', () => {});
  t.mock.method(victim, 'performAnimation', animation => {
    assert.equal(animation.getId(), 836);
    order.push('animation');
  });
  t.mock.method(victim, 'moveTo', () => order.push('respawn'));
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    assert.equal(name, 'player:dying');
    assert.equal(event.player, victim);
    assert.equal(event.killer, killer);
    order.push('dying');
  });
  new PlayerDeathTask(victim).execute();
  assert.deepEqual(order, ['animation', 'dying']);
});

test('attack-started observers run only after permission succeeds, for every combat style', t => {
  const { Combat } = require('../dist/game/content/combat/Combat');
  const { CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const attacker = { isPlayer: () => false, isNpc: () => false, isSpecialActivated: () => false };
  const target = { getCombat: () => ({ getAttacker: () => attacker }) };
  const combat = new Combat(attacker);
  const order = [];
  let allowed = false;
  t.mock.method(CombatFactory, 'canAttack', () => allowed ? CanAttackResponse.CAN_ATTACK : CanAttackResponse.CANT_ATTACK);
  t.mock.method(combat, 'handleAttackDenied', () => {});
  t.mock.method(combat, 'expectAttackAnimation', () => {});
  t.mock.method(combat, 'attackTiming', () => ({}));
  let method = null;
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    assert.deepEqual(event, { attacker, target, method }, 'names the method making the swing');
    if (name === 'combat:attack-finished') return order.push('finished');
    assert.equal(name, 'combat:attack-started');
    order.push('event');
  });
  for (const type of [CombatType.MELEE, CombatType.RANGED, CombatType.MAGIC]) {
    method = {
      type: () => type, onCombatBegan() {}, finished() {}, hits: () => [],
      start: () => order.push('attack'),
    };
    allowed = false;
    assert.equal(combat.executeAttack(method, target, true, 0, false), false);
    allowed = true;
    assert.equal(combat.executeAttack(method, target, true, 0, false), true);
  }
  assert.deepEqual(order, ['event', 'attack', 'finished', 'event', 'attack', 'finished', 'event', 'attack', 'finished']);
});

test('both player and NPC death clear their roll cache before the death task runs', () => {
  const { NPC } = require('../dist/game/entity/impl/npc/NPC');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { TaskManager } = require('../dist/game/task/TaskManager');

  const cleared = [];
  const originalClear = CombatFactory.clearHitRollCache;
  const originalSubmit = TaskManager.submit;
  CombatFactory.clearHitRollCache = (entity) => cleared.push(entity);
  TaskManager.submit = () => {};
  try {
    const npcActor = { isDying: false };
    NPC.prototype.appendDeath.call(npcActor);
    assert.deepEqual(cleared, [npcActor], 'NPC death forgets its rolls');

    const playerActor = {
      isDying: false,
      getCombat: () => ({ getRecentDamagerEntries: () => [], getKiller: () => null }),
    };
    Player.prototype.appendDeath.call(playerActor);
    assert.deepEqual(cleared, [npcActor, playerActor], 'player death forgets its rolls');
  } finally {
    CombatFactory.clearHitRollCache = originalClear;
    TaskManager.submit = originalSubmit;
  }
});
