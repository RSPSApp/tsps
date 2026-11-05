// Run after `yarn build`: node --test tests/npc-spell-target.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { World } = require('../dist/game/World');
const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { NPCOptionPacketListener } = require('../dist/net/packet/impl/NPCOptionPacketListener');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const core = PluginManager.getCoreApi();
before(async () => {
  await CachePipeline.initialize(process.cwd());
  new NpcDefinitionLoader().load();
  RegionManager.init(); RegionManager.loadMapFiles(3222, 3218);
});

test('spell-on-NPC defaults to attackable definitions and honors an area-scoped opt-in', () => {
  const originalNpcs = World.getNpcs;
  const originalSpell = CombatSpells.getCombatSpell;
  const originalCustomEvent = PluginManager.emitCustomEvent;
  const originalProjectileCheck = RegionManager.canProjectileAttackTarget;
  const spell = { canCastOnTarget: () => true, canCast: () => true, spellId: () => 1,
    castSound: () => null, startCast() {}, baseExperience: () => 0 };
  let cast = null;
  const messages = [];
  let areaPermission = null;
  const npc = {
    getLocation: () => ({ getX: () => 1, getY: () => 1, getZ: () => 0 }),
    getPrivateArea: () => null,
    getOwner: () => null,
    getContentId: () => 1,
    isPlayer: () => false,
    getSize: () => 1,
    getCurrentDefinition: () => ({ isAttackable: () => false }),
    getHitpoints: () => 10,
    getArea: () => ({ canCastOnNpc: () => areaPermission }),
  };
  const player = {
    sendMessage: message => messages.push(message),
    getHitpoints: () => 99,
    busy: () => false,
    getArea: () => null,
    getPrivateArea: () => null,
    isPlayer: () => true,
    getSize: () => 1,
    getLocation: () => ({ getX: () => 1, getY: () => 1, getZ: () => 0, isWithinDistance: () => true }),
    getMovementQueue: () => ({ reset() {} }),
    getCombat: () => ({ castSpellOn: (target, selectedSpell) => { cast = [target, selectedSpell]; } }),
  };
  World.getNpcs = () => ({ capacityReturn: () => 1, get: () => npc });
  CombatSpells.getCombatSpell = () => spell;
  RegionManager.canProjectileAttackTarget = () => true;
  try {
    PluginManager.emitCustomEvent = () => {};
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 1), false, 'unattackable NPCs reject ordinary spell targeting');
    assert.equal(cast, null, 'a rejected target never reaches combat or rune consumption');
    assert.deepEqual(messages, ["You can't attack this npc."]);

    areaPermission = true;
    PluginManager.emitCustomEvent = () => {};
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 1), true, 'the NPC area can opt one target into spell casting');
    assert.deepEqual(cast, [npc, spell]);
  } finally {
    World.getNpcs = originalNpcs;
    CombatSpells.getCombatSpell = originalSpell;
    PluginManager.emitCustomEvent = originalCustomEvent;
    RegionManager.canProjectileAttackTarget = originalProjectileCheck;
  }
});


function nativeCast(t, { name = 'Wind Strike', npcId = core.NpcIdentifiers.HANS, level = 99, runes = true } = {}) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const channel = { kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onClose() {}, onError() {} };
  const session = new PlayerSession(channel), player = new Player(session);
  session.setPlayer(player); player.setIndex(100); player.setUsername('friendlycast'); player.setRegistered(true);
  player.setLocation(new core.Location(3222, 3218, 0)); player.needsPlacement = false;
  player.getSkillManager().setMaxLevel(core.Skill.MAGIC, level).setCurrentLevel(core.Skill.MAGIC, level, false);
  const spell = CombatSpells.getCombatSpellByName(name);
  const widget = core.CacheDefinitions.getSpellByName(name);
  assert.ok(spell && widget);
  if (runes) for (const rune of spell.itemsRequired(player)) player.getInventory().add(rune.clone(), false);
  const npc = new core.NPC(npcId, new core.Location(3223, 3218, 0));
  World.getNpcs().add(npc); npc.needsPlacement = false;
  const messages = []; t.mock.method(player, 'sendMessage', message => messages.push(message));
  const connection = new ClientConnection(channel); connection.player = player;
  t.after(() => { World.getNpcs().remove(npc); core.TaskManager.cancelTasks(player.getIndex()); player.setRegistered(false); session.flushPackets(); });
  const snapshot = () => JSON.stringify({ items: player.getInventory().getItems(), xp: player.getSkillManager().getSkills().experience });
  const cast = async () => {
    const before = snapshot();
    await connection.dispatch([{ type: 'spell_on_npc', targetIndex: npc.getIndex(), spellWidget: widget.widgetId, spellChild: -1, spellItemId: widget.itemId }]);
    connection.processTurnPackets();
    assert.equal(snapshot(), before, 'rejected targeting consumes no resources or XP');
    assert.equal(player.getCombat().getTarget(), null);
    assert.equal(player.getCombat().getCastSpell(), null);
  };
  return { player, npc, messages, cast, connection, spell, widget };
}

for (const symbol of ['HANS', 'BANKER']) {
  test(`native spell targeting on cache-backed ${symbol} reports the standard refusal`, async t => {
    const f = nativeCast(t, { npcId: core.NpcIdentifiers[symbol] });
    assert.equal(f.npc.getCurrentDefinition(f.player).isAttackable(), false);
    assert.equal(f.npc.getHitpoints(), 10, 'the real friendly definition has HP and reaches the scripted fallback');
    await f.cast();
    assert.deepEqual(f.messages, ["You can't attack this npc."]);
  });
}

for (const [options, message] of [
  [{ runes: false }, 'You do not have the required items to cast this spell.'],
  [{ name: 'Fire Strike', level: 1 }, 'You need a Magic level of 13 to cast this spell.'],
]) {
  test(`native rejected targeting preserves the specific spell requirement: ${message}`, async t => {
    const f = nativeCast(t, options); await f.cast();
    assert.deepEqual(f.messages, [message]);
  });
}

function nativeNpcTarget(targetIndex, widgetId, child = 65535, itemId = 65535) {
  const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
  const frame = Buffer.alloc(12);
  frame[0] = ClientPacketId.OPNPC_T; frame.writeUInt16BE(targetIndex, 1); frame.writeUInt32LE(widgetId, 3);
  frame.writeUInt16BE(child, 7); frame[9] = (itemId + 128) & 255; frame[10] = itemId >>> 8; frame[11] = 128;
  return frame;
}

for (const form of ['sentinel', 'component']) {
  test(`native cached utility resolution preserves the ${form} child and consumes a scripted cast once`, async t => {
    const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
    const f = nativeCast(t, { npcId: core.NpcIdentifiers.GOBLIN });
    const widget = core.CacheDefinitions.getSpellByName('Monster Inspect');
    const child = form === 'sentinel' ? 65535 : widget.widgetId & 65535;
    const resolutions = [], casts = [], experience = [];
    t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
      if (name !== 'magic:resolve-spell') return;
      resolutions.push({ name: event.spellName, widget: event.spellWidget, id: event.spellId });
      event.spell = f.spell; // A real base Spell exercises the generic extension, not Inspect's gameplay.
    });
    t.mock.method(PluginManager, 'emitSpellOnNpc', event => {
      casts.push(event);
      assert.equal(event.spell, f.spell); assert.equal(event.npc, f.npc);
      assert.equal(event.consumeRunes(), true); assert.equal(event.consumeRunes(), false);
      return true;
    });
    const addXp = f.player.getSkillManager().addExperiences.bind(f.player.getSkillManager());
    t.mock.method(f.player.getSkillManager(), 'addExperiences', (skill, amount) => { experience.push([skill, amount]); return addXp(skill, amount); });
    const input = decodeClientPackets(nativeNpcTarget(f.npc.getIndex(), widget.widgetId, child));
    assert.deepEqual(input, [{ type: 'spell_on_npc', targetIndex: f.npc.getIndex(), spellWidget: widget.widgetId,
      spellChild: child, spellItemId: 65535 }], 'the real desktop widget-only wire form');
    await f.connection.dispatch(input); f.connection.processTurnPackets();
    assert.deepEqual(resolutions, [{ name: 'Monster Inspect', widget: widget.widgetId, id: -1 }],
      'the name and canonical component come from server cache metadata');
    assert.equal(casts.length, 1); assert.deepEqual(experience, [[core.Skill.MAGIC, f.spell.baseExperience()]]);
    assert.equal(f.player.getCombat().getTarget(), null); assert.equal(f.player.getCombat().getCastSpell(), null);
    for (const item of f.spell.itemsRequired(f.player)) assert.equal(f.player.getInventory().getAmount(item.getId()), 0);
    for (const item of f.spell.itemsRequired(f.player)) f.player.getInventory().add(item.clone(), false);
    t.mock.method(RegionManager, 'canProjectileAttackTarget', () => false);
    await f.connection.dispatch(input); f.connection.processTurnPackets();
    assert.equal(casts.length, 1, 'a plugin-provided base Spell keeps the normal line-of-sight check');
    assert.equal(experience.length, 1);
    for (const item of f.spell.itemsRequired(f.player)) assert.equal(f.player.getInventory().getAmount(item.getId()), item.getAmount());
  });
}

test('legacy Combat and Effect spells outrank a generic utility resolver', t => {
  const { EffectSpells } = require('../dist/game/content/combat/magic/EffectSpells');
  const f = nativeCast(t, { npcId: core.NpcIdentifiers.GOBLIN });
  const selection = { name: 'Monster Inspect', widgetId: core.CacheDefinitions.getSpellByName('Monster Inspect').widgetId };
  t.mock.method(PluginManager, 'emitCustomEvent', name => {
    assert.notEqual(name, 'magic:resolve-spell', 'an extension cannot replace a known spell');
  });
  assert.equal(NPCOptionPacketListener.castSpell(f.player, f.npc.getIndex(), f.spell.spellId(), selection), true);
  assert.equal(f.player.getCombat().getCastSpell(), f.spell);
  f.player.getCombat().reset(); f.player.getInventory().resetItems();
  const grab = EffectSpells.TELEKINETIC_GRAB;
  for (const item of grab.itemsRequired(f.player)) f.player.getInventory().add(item.clone(), false);
  t.mock.method(RegionManager, 'canProjectileAttackTarget', () => false);
  let casts = 0;
  t.mock.method(PluginManager, 'emitSpellOnNpc', event => {
    casts++; assert.equal(event.spell, grab); assert.equal(event.consumeRunes(), true); return true;
  });
  assert.equal(NPCOptionPacketListener.castSpell(f.player, f.npc.getIndex(), grab.spellId(), selection), true);
  assert.equal(casts, 1, 'Telegrab keeps its existing scripted, clipping-independent path');
});

test('unknown NPC target packets cannot supply a utility name outside server cache metadata', async t => {
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const f = nativeCast(t, { npcId: core.NpcIdentifiers.GOBLIN });
  t.mock.method(PluginManager, 'emitCustomEvent', name => assert.notEqual(name, 'magic:resolve-spell'));
  assert.equal(NPCOptionPacketListener.castSpell(f.player, f.npc.getIndex(), -1), false);
  const before = JSON.stringify(f.player.getInventory().getItems());
  await f.connection.dispatch(decodeClientPackets(nativeNpcTarget(f.npc.getIndex(), 0))); f.connection.processTurnPackets();
  assert.equal(JSON.stringify(f.player.getInventory().getItems()), before);
  assert.equal(f.player.getCombat().getCastSpell(), null);
});
