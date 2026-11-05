const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { World } = require('../dist/game/World');
const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
const { NPCOptionPacketListener } = require('../dist/net/packet/impl/NPCOptionPacketListener');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { Skill } = require('../dist/game/model/Skill');
const { MagicSpellbook } = require('../dist/game/model/MagicSpellbook');

test('Telekinetic Grab is a scripted effect spell: no combat line of sight, 43 XP, one rune set', () => {
  const previous = {
    npcs: World.getNpcs,
    los: RegionManager.canProjectileAttackTarget,
    hookCount: PluginManager.spellOnNpcHooks.length,
  };
  let xp = 0;
  let consumed = 0;
  const point = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z, isWithinDistance(other, range) { return Math.max(Math.abs(x - other.getX()), Math.abs(y - other.getY())) <= range && z === other.getZ(); } });
  const player = {
    getHitpoints: () => 10, busy: () => false,
    getLocation: () => point(100, 100), getPrivateArea: () => null, getArea: () => null,
    getMovementQueue: () => ({ reset() {} }), setPositionToFace() {},
    getSpellbook: () => MagicSpellbook.NORMAL,
    getCombat: () => ({ reset() {}, setCastSpell() {} }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences(skill, amount) { assert.equal(skill, Skill.MAGIC); xp += amount; } }),
    getInventory: () => ({
      getAmount: () => 1,
      deletes() { consumed += 1; },
    }),
    getEquipment: () => ({ containsAllItem: () => true }),
    sendMessage() {},
  };
  const npc = {
    getId: () => 6777, getContentId: () => 6777, getLocation: () => point(101, 100),
    getHitpoints: () => 1, getPrivateArea: () => null,
    getArea: () => null, getOwner: () => null,
    getCurrentDefinition: () => ({ isAttackable: () => false }),
  };
  World.getNpcs = () => ({ capacityReturn: () => 1, get: () => npc });
  RegionManager.canProjectileAttackTarget = () => false;
  PluginManager.spellOnNpcHooks.push({ pluginName: 'telekinetic-grab-test', handler(event) {
    assert.equal(event.spellId, 1168);
    assert.equal(event.handled, false);
    if (event.consumeRunes()) event.handled = true;
  } });
  try {
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 1168), true);
    assert.equal(xp, 43);
    assert.equal(consumed, 2, 'law and air runes are taken once');
  } finally {
    World.getNpcs = previous.npcs;
    RegionManager.canProjectileAttackTarget = previous.los;
    PluginManager.spellOnNpcHooks.length = previous.hookCount;
  }
});

test('a utility spell never enters combat, even on an attackable NPC', () => {
  const previous = {
    npcs: World.getNpcs,
    los: RegionManager.canProjectileAttackTarget,
    hookCount: PluginManager.spellOnNpcHooks.length,
  };
  let xp = 0, consumed = 0, combatCasts = 0, handleSpell = true;
  const point = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z, isWithinDistance(other, range) { return Math.max(Math.abs(x - other.getX()), Math.abs(y - other.getY())) <= range && z === other.getZ(); } });
  const player = {
    getHitpoints: () => 10, busy: () => false,
    getLocation: () => point(100, 100), getPrivateArea: () => null, getArea: () => null,
    getMovementQueue: () => ({ reset() {} }), setPositionToFace() {},
    getSpellbook: () => MagicSpellbook.NORMAL,
    // An effect spell in the combat slot would throw in MagicCombatMethod.hits.
    getCombat: () => ({ reset() {}, setCastSpell() {}, castSpellOn() { combatCasts += 1; } }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences(skill, amount) { assert.equal(skill, Skill.MAGIC); xp += amount; } }),
    getInventory: () => ({ getAmount: () => 1, deletes() { consumed += 1; } }),
    getEquipment: () => ({ containsAllItem: () => true }),
    sendMessage() {},
  };
  const npc = {
    getId: () => 3029, getContentId: () => 3029, getLocation: () => point(101, 100),
    getHitpoints: () => 10, getPrivateArea: () => null,
    getArea: () => null, getOwner: () => null,
    getCurrentDefinition: () => ({ isAttackable: () => true }),
  };
  World.getNpcs = () => ({ capacityReturn: () => 1, get: () => npc });
  RegionManager.canProjectileAttackTarget = () => false;
  PluginManager.spellOnNpcHooks.push({ pluginName: 'telekinetic-grab-attackable-test', handler(event) {
    if (handleSpell && event.consumeRunes()) event.handled = true;
  } });
  try {
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 1168), true);
    assert.equal(xp, 43);
    assert.equal(consumed, 2, 'the scripted route still takes the spell\'s runes once');
    assert.equal(combatCasts, 0, 'the effect spell never reaches Combat.castSpellOn');

    handleSpell = false;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 1168), false, 'no scripted hook means the cast is refused');
    assert.equal(combatCasts, 0, 'and is not handed to combat instead');
  } finally {
    World.getNpcs = previous.npcs;
    RegionManager.canProjectileAttackTarget = previous.los;
    PluginManager.spellOnNpcHooks.length = previous.hookCount;
  }
});

test('spell-on-NPC validates target and spell, consumes once, and preserves combat casts', () => {
  const previous = {
    npcs: World.getNpcs,
    getSpell: CombatSpells.getCombatSpell,
    los: RegionManager.canProjectileAttackTarget,
    hookCount: PluginManager.spellOnNpcHooks.length,
  };
  let levelAndRunes = true, cooldownAndConsume = true, visible = true, attackable = false;
  let npcPrivateArea = null, areaVeto = false, handleSpell = true;
  const messages = [];
  let canCastChecks = [], casts = 0, xp = 0, combatCasts = 0, hookCalls = 0, runeConsume = 0;
  const point = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z, isWithinDistance(other, range) { return Math.max(Math.abs(x - other.getX()), Math.abs(y - other.getY())) <= range && z === other.getZ(); } });
  const loc = point(100, 100);
  let targetLoc = point(101, 100);
  const player = {
    sendMessage: message => messages.push(message),
    getHitpoints: () => 10, busy: () => false,
    getLocation: () => loc, getPrivateArea: () => null, getArea: () => null,
    getMovementQueue: () => ({ reset() {} }), setPositionToFace() {},
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({ addExperiences(skill, amount) { assert.equal(skill, Skill.MAGIC); xp += amount; } }),
    getCombat: () => ({ castSpellOn() { combatCasts++; } }),
  };
  const npc = {
    getId: () => 999, getContentId: () => 999, getLocation: () => targetLoc,
    getHitpoints: () => 10, getPrivateArea: () => npcPrivateArea,
    getArea: () => areaVeto ? { canCastOnNpc: () => false } : null,
    getOwner: () => null, getCurrentDefinition: () => ({ isAttackable: () => attackable }),
  };
  const spell = {
    spellId: () => 12345,
    canCastOnTarget: () => true,
    canCast(_player, consume) {
      canCastChecks.push(consume);
      if (!consume) return levelAndRunes;
      if (!cooldownAndConsume) return false;
      runeConsume++;
      return true;
    },
    startCast() { casts++; },
    baseExperience: () => 42,
    castSound: () => null,
  };
  World.getNpcs = () => ({ capacityReturn: () => 1, get: () => npc });
  CombatSpells.getCombatSpell = () => spell;
  RegionManager.canProjectileAttackTarget = () => visible;
  PluginManager.spellOnNpcHooks.push({ pluginName: 'spell-on-npc-test', handler(event) {
    hookCalls++;
    assert.equal(event.player, player);
    assert.equal(event.npc, npc);
    assert.equal(event.npcId, 999);
    assert.equal(event.npcIndex, 0);
    assert.equal(event.spell, spell);
    assert.equal(event.spellId, 12345);
    assert.deepEqual(event.location, { x: 101, y: 100, z: 0 });
    if (!handleSpell) return;
    const consumed = event.consumeRunes();
    if (consumed) {
      assert.equal(event.consumeRunes(), false, 'the accepted cast can consume only once');
      event.handled = true;
    }
  } });
  try {
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), true);
    assert.deepEqual(canCastChecks, [false, true]);
    assert.equal(runeConsume, 1);
    assert.equal(casts, 1);
    assert.equal(xp, 42);
    assert.equal(hookCalls, 1);

    handleSpell = false;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'unhandled target casts are not accepted');
    assert.equal(runeConsume, 1, 'unhandled targeted casts consume no runes');
    assert.equal(casts, 1, 'unhandled targeted casts do not animate');
    assert.deepEqual(messages, ["You can't attack this npc."]);
    handleSpell = true;

    const before = { hooks: hookCalls, casts, runeConsume };
    const previousMessages = messages.length;
    areaVeto = true;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'an area veto blocks scripted casting');
    areaVeto = false;
    assert.equal(hookCalls, before.hooks, 'area veto is checked before hook dispatch');
    visible = false;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'blocked line of sight rejects');
    visible = true;
    targetLoc = point(111, 100);
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'out of scripted range rejects');
    targetLoc = point(101, 100, 1);
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'different plane rejects');
    targetLoc = point(101, 100);
    npc.getOwner = () => ({ other: true });
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'another player’s owned NPC rejects');
    npc.getOwner = () => null;
    npcPrivateArea = {};
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'another private area rejects');
    npcPrivateArea = null;
    levelAndRunes = false;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'missing runes or level rejects');
    levelAndRunes = true;
    cooldownAndConsume = false;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'cooldown rejection does not dispatch as a cast');
    assert.equal(hookCalls, before.hooks + 1, 'cooldown is checked inside the consuming callback');
    assert.deepEqual({ casts, runeConsume }, { casts: before.casts, runeConsume: before.runeConsume }, 'rejected casts have no side effects');

    assert.equal(messages.length, previousMessages, 'specific/spatial refusals and a scripted consumption failure do not add generic feedback');
    attackable = true;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), true);
    assert.equal(combatCasts, 1, 'ordinary attackable NPC spell casts retain the combat path');
  } finally {
    World.getNpcs = previous.npcs;
    CombatSpells.getCombatSpell = previous.getSpell;
    RegionManager.canProjectileAttackTarget = previous.los;
    PluginManager.spellOnNpcHooks.length = previous.hookCount;
  }
});

test('native Standard Monster Inspect pays once, displays its stats and closes to the normal book', async t => {
  const path = require('node:path');
  const fs = require('node:fs');
  const temporary = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'monster-inspect-'));
  const previousBots = process.env.DISABLE_PLAYER_BOTS, previousDatabase = process.env.PLAYER_SAVE_DATABASE_PATH;
  process.env.DISABLE_PLAYER_BOTS = '1';
  process.env.PLAYER_SAVE_DATABASE_PATH = path.join(temporary, 'players.sqlite');
  t.after(() => {
    PluginManager.emitServerShutdown({});
    fs.rmSync(temporary, { recursive: true, force: true });
    if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = previousBots;
    if (previousDatabase === undefined) delete process.env.PLAYER_SAVE_DATABASE_PATH; else process.env.PLAYER_SAVE_DATABASE_PATH = previousDatabase;
  });
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init(); RegionManager.loadMapFiles(3222, 3218);
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  PluginManager.emitServerStartup({});
  const core = PluginManager.getCoreApi();
  const cached = core.CacheDefinitions.getSpellByName('Monster Inspect');
  const requirements = core.CacheDefinitions.getSpellRequirements('Monster Inspect');
  assert.equal(requirements.level, 42);
  assert.deepEqual(requirements.runes, [{ id: 559, amount: 2 }, { id: 558, amount: 2 }]);
  const cases = [
    { label: 'desktop sentinel selection', raw: '4b00e7c600da00ffff7fff80' },
    { label: 'world-click selection', raw: '4b00e7c600da0000c67fff80' },
    { label: 'drained target reports current Defence', raw: '4b00e7c600da00ffff7fff80', defence: 0 },
    { label: 'level refusal', level: 41, message: 'You need a Magic level of 42 to cast this spell.' },
    { label: 'rune refusal', runes: false, message: 'You do not have the required items to cast this spell.' },
    { label: 'wrong book', book: MagicSpellbook.LUNAR },
  ];
  for (const entry of cases) await t.test(entry.label, async t => {
    const frames = [], messages = [], mounts = [], scripts = [], restored = [], sounds = [];
    const channel = { kind: 'test', binaryTransport: true, isOpen: () => true,
      send(bytes) { frames.push(Buffer.from(bytes)); return true; }, close() {}, onData() {}, onClose() {}, onError() {} };
    const session = new PlayerSession(channel), player = new Player(session);
    session.setPlayer(player); player.setIndex(2318); player.setUsername('inspect2318'); player.setRegistered(true);
    player.setAttribute('bot-skip-persistence', true);
    player.setLocation(new core.Location(3222, 3218, 0)); player.needsPlacement = false;
    player.setSpellbook(entry.book ?? MagicSpellbook.NORMAL);
    const skills = player.getSkillManager(), level = entry.level ?? 42;
    skills.setMaxLevels(Skill.MAGIC, level).setCurrentLevels(Skill.MAGIC, level);
    skills.setExperience(Skill.MAGIC, core.SkillManager.getExperienceForLevel(level));
    if (entry.runes !== false) for (const rune of requirements.runes) player.getInventory().add(new core.Item(rune.id, rune.amount), false);
    const npc = new core.NPC(core.NpcIdentifiers.GOBLIN, new core.Location(3223, 3218, 0));
    World.getNpcs().add(npc); npc.needsPlacement = false;
    if (entry.defence !== undefined) {
      assert.ok(npc.getCurrentLevel(Skill.DEFENCE) > entry.defence);
      npc.setDefenceLevel(entry.defence);
    }
    t.after(() => {
      player.closeInterruptibleInterfaces();
      PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
      core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex());
      World.getNpcs().remove(npc); player.setRegistered(false); session.flushPackets();
    });
    t.mock.method(player, 'sendMessage', message => messages.push(message));
    const sender = player.getPacketSender();
    for (const [method, records] of [['sendMagicTabInterface', mounts], ['sendClientScript', scripts], ['sendTabInterface', restored], ['sendSoundEffect', sounds]]) {
      const original = sender[method];
      t.mock.method(sender, method, function (...args) { records.push(args); return original.apply(this, args); });
    }
    // These are the current cache's actual OPNPCT desktop/world-click vectors; only the live NPC slot changes.
    const bytes = Buffer.from(entry.raw ?? cases[0].raw, 'hex'); bytes.writeUInt16BE(npc.getIndex(), 1);
    const [packet] = decodeClientPackets(bytes);
    assert.equal(packet.spellWidget, cached.widgetId); assert.equal(packet.spellItemId, 65535);
    const connection = new ClientConnection(channel); connection.player = player;
    const xp = skills.getSkills().experience[Skill.MAGIC.getIndex()], inventory = JSON.stringify(player.getInventory().getItems());
    session.flushPackets(); frames.length = 0;
    await connection.dispatch([packet]); connection.processTurnPackets(); session.flushPackets();
    const accepted = entry.raw !== undefined;
    assert.equal(skills.getSkills().experience[Skill.MAGIC.getIndex()] - xp, accepted ? 30.5 : 0);
    assert.equal(player.getCombat().getTarget(), null, 'inspection never enters combat');
    if (!accepted) {
      assert.equal(JSON.stringify(player.getInventory().getItems()), inventory);
      assert.deepEqual(mounts, []); assert.deepEqual(scripts, []);
      assert.deepEqual(messages, entry.message ? [entry.message] : []);
      return;
    }
    for (const rune of requirements.runes) assert.equal(player.getInventory().getAmount(rune.id), 0);
    assert.deepEqual(mounts, [[522]]); assert.equal(scripts.length, 1); assert.equal(scripts[0][0], 1179);
    const sections = scripts[0][1].split('|');
    assert.equal(sections.length, 5); assert.equal(sections[4], npc.getCurrentDefinition(player).getName());
    assert.ok(sections[0].includes('Combat level:'));
    assert.ok(sections[0].includes(`Defence: ${npc.getCurrentLevel(Skill.DEFENCE)}<br>`),
      'the native stats panel must report the instance level after combat drains');
    assert.ok(!sections[0].includes('Max standard hit:')); assert.ok(!sections[0].includes('Main attack style:'));
    assert.equal(player.getAnimation().getId(), core.LunarSpells.CASTS['monster examine'].animation);
    assert.equal(sounds.length, 1); assert.ok(frames.length > 0, 'the real session emitted its native UI packets');
    await connection.dispatch([{ type: 'widget_action', widgetId: (522 << 16) | 17, groupId: 522, childId: 17, buttonNum: 1, slot: -1, itemId: -1 }]);
    connection.processTurnPackets();
    assert.deepEqual(restored, [[6, MagicSpellbook.NORMAL.getInterfaceId()]]);
    assert.equal(skills.getSkills().experience[Skill.MAGIC.getIndex()] - xp, 30.5, 'closing does not cast or pay again');
  });
});
