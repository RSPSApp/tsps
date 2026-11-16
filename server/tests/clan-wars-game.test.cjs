'use strict';
// Real channel membership, native packets, players, containers, map and instance owners.
// Only the transport is inert; the game clock advances deterministically.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, afterEach, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { AreaManager } = require('../dist/game/model/areas/AreaManager');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
const { CombatFactory, CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { FriendsChatManager: FC } = require('../plugins/interface/FriendsChatManager');
const Presets = require('../plugins/modes/pvp/Presets.PvpMode');
const C = require('../plugins/minigames/clanwars/Common.ClanWars');
const Match = require('../plugins/minigames/clanwars/Match.ClanWars');
const Negotiation = require('../plugins/minigames/clanwars/Negotiation.ClanWars');
const core = PM.getCoreApi();
const actors = [];
let serial = 0;
// Only Q's explicitly selected engine tests take real NPC/player combat turns.
// Existing controls keep their original ordering and helper behavior.
let ghastTurns = false, ghastObserve = null, ghastRollControl = null;
// M's explicitly selected turns exercise the canonical player combat and rune producers.
let magicTurns = false, magicObserve = null, magicRollControl = null, magicDamageControl = null, magicCase = null;
let bowTurns = false, bowRollControl = null;
const fixtureNpcs = new Set(), npcQueueFailures = [];
function npcQueues() {
  const add=core.World.getAddNPCQueue(), remove=core.World.getRemoveNPCQueue();
  while(add.length){const npc=add.shift();if(!core.World.getNpcs().add(npc))npcQueueFailures.push(npc);}
  while(remove.length){const npc=remove.shift();if(npc.isRegistered())core.World.getNpcs().remove(npc);}
}
function bowPlayerTurn(p) {
  const combat=p.getCombat(),movement=p.getMovementQueue();
  combat.getHitQueue().process(C.now());
  if(p.getHitpoints()<=0||p.isDyingReturn())return;
  p.getTimers().process();movement.beginCycle();
  if(combat.hasPendingWork())combat.preMovementProcess();
  if(movement.hasPendingWork())movement.process();
  if(combat.hasPendingWork())combat.postMovementProcess();
}
function ghastPlayerTurn(p) {
  const combat=p.getCombat(),movement=p.getMovementQueue();
  combat.getHitQueue().process(core.World.getProcessCycle());if(p.getHitpoints()<=0||p.isDyingReturn())return;p.getTimers().process();
  movement.beginCycle();if(combat.hasPendingWork())combat.preMovementProcess();
  if(movement.hasPendingWork())movement.process();if(combat.hasPendingWork())combat.postMovementProcess();
  require('../dist/game/entity/impl/npc/NpcAggression').NpcAggression.process(p);
}
const errors = [];
const originalError = console.error;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3128, 3629);
  require('../plugins/interface/FriendsList.plugin').register(PM.createApi('ClanWarsSocialTest'));
  require('../plugins/minigames/DuelArena.plugin').register(PM.createApi('ClanWarsDuelTest'));
  require('../plugins/combat/PvpStatistics.plugin').register(PM.createApi('ClanWarsPvpStatsTest'));
  require('../plugins/combat/KillStreaks.plugin').register(PM.createApi('ClanWarsKillStreaksTest'));
  require('../plugins/minigames/ClanWars.plugin').register(PM.createApi('ClanWarsTest'));
  require('../plugins/areas/FeroxEnclave.plugin').register(PM.createApi('ClanWarsFeroxTest'));
  Presets.register(PM.createApi('ClanWarsPresetsTest'));
  require('../plugins/items/Food.plugin').register(PM.createApi('ClanWarsFoodTest'));
  require('../plugins/items/Potions.plugin').register(PM.createApi('ClanWarsPotionsTest'));
  require('../plugins/items/PhoenixNecklace.plugin').register(PM.createApi('ClanWarsPhoenixTest'));
  for (const name of ['DragonDagger','DragonBattleaxe']) {
    require(`../plugins/combat/specials/${name}.SpecialAttack`)(PM.createApi('ClanWarsSpecialTest'));
  }
  for (const [file,name] of [['objects/Doors.plugin','Doors'],['world/WaterSources.plugin','Water'],
    ['skills/Cooking.plugin','Cooking'],['skills/Woodcutting.plugin','Woodcutting'],
    ['objects/Ladders.plugin','Ladders'],['skills/Smithing.plugin','Smithing']]) {
    require(`../plugins/${file}`).register(PM.createApi(`ClanWars${name}Test`));
  }
  for(const file of ['npcs/NpcDrops.plugin','skills/Prayer.plugin','items/Bonecrusher.plugin']) {
    require(`../plugins/${file}`).register(PM.createApi(`ClanWarsGhast${file}Test`));
  }
  require('../plugins/quests/quests/NatureSpirit.Quest')(PM.createApi('ClanWarsGhastQuestTest'));
  const proofApi=PM.createApi('ClanWarsGhastObserver');
  proofApi.onCombatHitPrepare(event=>{if(ghastObserve)ghastObserve('prepare',event);});
  proofApi.onCombatHitRoll(event=>{if(ghastRollControl)ghastRollControl(event);if(bowRollControl)bowRollControl(event);});
  proofApi.onCombatHitResolved(event=>{if(ghastObserve)ghastObserve('resolved',event);});
  proofApi.onCombatHitPrepare(event=>{if(magicObserve)magicObserve('prepare',event);});
  proofApi.onCombatHitRoll(event=>{if(magicRollControl)magicRollControl(event);});
  proofApi.onCombatHitDamage(event=>{if(magicDamageControl)magicDamageControl(event);});
  proofApi.onCombatHitResolved(event=>{if(magicObserve)magicObserve('resolved',event);});
  proofApi.onCustomEvent('magic:cast-committed',event=>{if(magicObserve)magicObserve('committed',event);});
  proofApi.onCustomEvent('npc-drops:claim',event=>{if(ghastObserve)ghastObserve('claim',event);});
  proofApi.onCustomEvent('npc-drops:generated',event=>{if(ghastObserve)ghastObserve('generated',event);});
  proofApi.onNpcDeath(event=>{if(ghastObserve)ghastObserve('death',event);});
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
});
afterEach(context => {
  if(magicCase)console.log('MAGIC_FIXTURE '+JSON.stringify({phase:'teardown-start',name:magicCase,clock:C.now(),actors:actors.length,...process.memoryUsage()}));
  if(context.name.startsWith('standard-bow'))bowDiagnostic(context,'teardown-start');
  Negotiation.shutdown();
  Match.shutdown();
  ghastTurns=false;ghastObserve=null;ghastRollControl=null;bowTurns=false;bowRollControl=null;
  magicTurns=false;magicObserve=null;magicRollControl=null;magicDamageControl=null;
  for(const npc of fixtureNpcs){C.api.removeNpc(npc);if(npc.getArea())npc.getArea().leave(npc,false);}fixtureNpcs.clear();npcQueues();
  for (const p of actors.splice(0)) {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    if (p.getArea()) p.getArea().leave(p, true);
    core.World.getPlayers().remove(p);
  }
  assert.equal(npcQueueFailures.splice(0).length,0,'only the explicit refused-add fixture may consume a failed queue registration');
  assert.deepEqual(errors.splice(0), [], 'production hooks must not swallow errors');
  if(magicCase)console.log('MAGIC_FIXTURE '+JSON.stringify({phase:'teardown-complete',name:magicCase,clock:C.now(),actors:actors.length,...process.memoryUsage()}));
  magicCase=null;
  if(context.name.startsWith('standard-bow'))bowDiagnostic(context,'teardown-complete');
});

function actor(nativeProof = false) {
  const transport = { kind: nativeProof ? 'tcp' : 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(transport));
  if (nativeProof) {
    const session = p.getSession(); session.setPlayer(p);
    p.nativeProof = true; p.nativePackets = [];
    p.setAttribute('bot-skip-persistence', true);
    const send = session.sendClientPacket.bind(session);
    session.sendClientPacket = frame => { p.nativePackets.push(Buffer.from(frame)); return send(frame); };
  }
  const name = `clanqa${++serial}`;
  p.setUsername(name).setLongUsername(core.Misc.stringToLongBigInt(name));
  p.setHostAddress(`192.0.2.${serial}`);
  p.setPasswordHashWithSalt('test-only');
  assert.equal(core.World.getPlayers().add(p), true);
  p.setRegistered(true);
  FC.onLogin(p);
  p.setLocation(new core.Location(3128 + serial % 2, 3627, 0));
  p.setNeedsPlacement(false);
  AreaManager.process(p);
  p.connection = new ClientConnection(transport);
  p.connection.player = p;
  actors.push(p);
  return p;
}
function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    if (actors.some(p => p.nativeProof)) {
      // The existing quest-scene-return-state fixture uses this production ordering.
      // Bind real sessions, update real visibility buckets and flush real native frames.
      core.World.processCycle++; core.TaskManager.process();npcQueues();
      if(ghastTurns)for(const npc of [...core.World.getNpcs()])if(npc?.isRegistered())npc.process();
      for (const p of actors) {
        p.connection.processTurnPackets(); AreaManager.process(p);
        core.TaskManager.processWalkTo(p.getIndex());
        if(ghastTurns||magicTurns)ghastPlayerTurn(p);else if(bowTurns)bowPlayerTurn(p);else p.getMovementQueue().process();
        if(magicTurns)PM.emitPlayerProcess({player:p});
      }
      core.World.rebuildUpdateBuckets();
      for (const p of actors) {
        core.World.updateLocalPlayers(p);
        if(ghastTurns)core.World.updateLocalNpcs(p,core.World.getNpcsNear(p.getLocation(),p.getNpcViewDistance(),p.getPrivateArea()));
      }
      for (const p of actors) p.getSession().flush(core.World.processCycle);
      for (const p of actors) p.resetUpdating();
      if(ghastTurns)for(const npc of core.World.getNpcs())if(npc)npc.resetUpdating();
      continue;
    }
    core.World.processCycle++;npcQueues();
    for (const p of actors) {
      p.getMovementQueue().process();
      core.TaskManager.processWalkTo(p.getIndex());
      AreaManager.process(p);
      p.resetUpdating();
    }
    core.TaskManager.process();
  }
}
async function wire(p, frame) {
  const packets = decodeClientPackets(frame);
  assert.equal(packets.length, 1);
  await p.connection.dispatch(packets);
  p.connection.processTurnPackets();
  tick(3);
}
async function challenge(p, target) {
  const frame = Buffer.alloc(4); frame[0] = 73;
  frame.writeUInt16BE(target.getIndex(), 1);
  await wire(p, frame);
}
function clickFrame(name, slot = 0xffff) {
  const frame = Buffer.alloc(9); frame[0] = 23;
  frame.writeInt32BE(C.uid(name), 1);
  frame.writeUInt16BE(slot, 5); frame.writeUInt16BE(0xffff, 7);
  return frame;
}
async function click(p, name, slot = 0xffff) { await wire(p, clickFrame(name,slot)); }
function channel(owner, members = []) {
  owner.getRelations().setFriendsChatChannelName(`Team${serial}`);
  owner.getRelations().setFriendsChatRanks(-1, -1, 2);
  for (const member of members) {
    owner.getRelations().addFriend(member.getLongUsername());
    owner.getRelations().setFriendRank(member.getLongUsername(), 5);
  }
  assert.equal(FC.join(owner, owner.getUsername(), false), true);
  for (const member of members) assert.equal(FC.join(member, owner.getUsername(), false), true);
  assert.equal(C.captain(owner).rankOf(owner), 7);
}
async function negotiate(a, b, cap = null, mode = 0, restrictions = null, arena = 1) {
  await challenge(a, b); await challenge(b, a);
  assert.equal(a.getInterfaceId(), C.group('clanwars_setup'));
  if (arena !== 1) {
    await click(a, 'clanwars_setup:arena', arena * 3);
    assert.equal(C.negotiations.get(a).rules.arena, arena, 'native arena selection must reach the server offer');
    tick(9);
  }
  if (cap !== null) { await click(a, 'clanwars_setup:dropdown_playercap', cap + 1); tick(9); }
  if (mode) {
    await click(a, 'clanwars_setup:wincondition', mode * 3);
    assert.equal(C.negotiations.get(a).rules.wincondition, mode, 'native mode selection must reach the server offer');
    tick(9);
  }
  for (const [key,value] of Object.entries(restrictions ?? {})) {
    if(key==='freezing') {
      if(C.negotiations.get(a).rules.freezing!==value)await click(a,'clanwars_setup:other',0);
    } else await click(a, key==='stragglers'?'clanwars_setup:stragglers':`clanwars_setup:dropdown_${key}`,
      key==='stragglers'?value*3:value+1);
    assert.equal(C.negotiations.get(a).rules[key],value,'native restriction selection must reach the server offer');
    tick(9);
  }
  await click(a, 'clanwars_setup:accept'); await click(b, 'clanwars_setup:accept');
  assert.equal(a.getInterfaceId(), C.group('clanwars_confirm'));
  tick(5);
  await click(a, 'clanwars_confirm:button'); await click(b, 'clanwars_confirm:button');
  const game = C.channelGames.get(C.channel(a).key);
  assert.ok(game, 'native reciprocal challenge and confirmations create the match');
  return game;
}
function challengePortal() {
  // The actual cache portal goes through production object dispatch; no synthetic loc.
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const id = core.CacheDefinitions.getLocId('clanwars_portal');
  const objects = [...MapObjects.mapObjects.values()].flat();
  const portal = objects.find(o => o.getDefinition()?.getName() === 'Challenge portal'
    && o.getLocation().getX() >= C.LOBBY.minX && o.getLocation().getX() <= C.LOBBY.maxX
    && o.getLocation().getY() >= C.LOBBY.minY && o.getLocation().getY() <= C.LOBBY.maxY);
  assert.ok(portal, `actual challenge portal exists (gameval lookup ${id})`);
  return portal;
}
async function join(p, confirm = true) {
  const portal=challengePortal();
  const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
  new ObjectActionPacketListener().executeAction(p, portal.getId(), portal.getLocation().getX(), portal.getLocation().getY(), 1);
  tick(15);
  assert.equal(p.getInterfaceId(), C.group('clanwars_confirm'));
  if (confirm) await click(p, 'clanwars_confirm:button');
}

test('native challenge revalidates captain rank and modal close cancels both offers', async () => {
  const owner = actor(), a = actor(), b = actor(); channel(owner, [a]); channel(b);
  await challenge(a, b); await challenge(b, a);
  assert.equal(C.negotiations.has(a), true);
  owner.getRelations().setFriendRank(a.getLongUsername(), 1);
  // Refresh is the actual channel profile owner, not a replacement fake channel.
  FC.refreshOwnedChannel(owner);
  tick(2);
  assert.equal(C.negotiations.has(a), false);
  assert.equal(C.negotiations.has(b), false);
  await challenge(owner, b); await challenge(b, owner);
  assert.equal(C.negotiations.has(owner), true);
  owner.getPacketSender().sendInterfaceRemoval();
  assert.equal(C.negotiations.has(owner), false);
  assert.equal(C.negotiations.has(b), false);
});

test('native reciprocal Challenge opens setup when both captains occupy the same tile', async () => {
  const a = actor(), b = actor(); channel(a); channel(b);
  for (const p of [a, b]) {
    p.moveTo(new core.Location(3128, 3622, 0));
    p.setNeedsPlacement(false);
    p.resetUpdating();
    AreaManager.process(p);
  }
  await challenge(a, b); await challenge(b, a);
  assert.equal(a.getInterfaceId(), C.group('clanwars_setup'), 'same-tile OPPLAYER4 reaches setup for first captain');
  assert.equal(b.getInterfaceId(), C.group('clanwars_setup'), 'same-tile reciprocal OPPLAYER4 reaches setup for second captain');
  assert.equal(C.negotiations.get(a), C.negotiations.get(b));
});

test('native cap choice limits real channel members, closes late entry and enforces enemy melee only', async () => {
  const a = actor(), extra = actor(), b = actor(); channel(a, [extra]); channel(b);
  const game = await negotiate(a, b, 1);
  await join(a); await join(b); await join(extra);
  for (const p of [a, b]) {
    const mount = p.getPacketSender().subInterfaceTargets.get(C.group('clanwars_hud'));
    assert.equal(mount?.targetUid, C.uid('toplevel_osrs_stretch:overlay_hud'),
      'fighter counters use the native HUD container that keeps them clear of the minimap');
  }
  assert.equal(C.matches.get(a), game); assert.equal(C.matches.get(b), game);
  assert.equal(C.matches.has(extra), false, '1v1 cap rejects an additional real teammate');
  assert.equal(game.area.canAttack(a, b, { type: () => core.CombatType.MELEE }), false);
  core.World.processCycle = game.starts - 1; game.tick();
  assert.equal(game.phase, 'staging');
  tick(); assert.equal(game.phase, 'combat');
  assert.equal(game.area.canAttack(a, b, { type: () => core.CombatType.MELEE }), true);
  assert.equal(game.area.canAttack(a, b, { type: () => core.CombatType.RANGED }), false);
  assert.equal(game.area.canAttack(a, b, { type: () => core.CombatType.MAGIC }), false);
  assert.equal(game.area.canAttack(a, extra, { type: () => core.CombatType.MELEE }), false);
  await join(extra);
  assert.equal(C.matches.has(extra), false, 'LTS entry is closed after preparation');
  const preset = { player: a, allow: true }; PM.emitCustomEvent('presets:can-use', preset);
  assert.equal(preset.allow, false);
});

test('match tick resends only the HUD varbits whose values changed', async () => {
  const a = actor(), b = actor(); channel(a); channel(b);
  const game = await negotiate(a, b, 1);
  await join(a); await join(b);
  const hudIds = new Map(['clanwars_points_1','clanwars_points_2','clanwars_countdown','clanwars_kills_1',
    'clanwars_kills_2','clanwars_timeremaining','clanwars_players_1','clanwars_players_2']
    .map(name => [core.CacheDefinitions.getVarbitId(name), name]));
  const writes = varbitCalls(a);
  const hud = () => writes.splice(0).filter(([id]) => hudIds.has(id)).map(([id, value]) => [hudIds.get(id), value]);
  tick(); hud();
  tick();
  assert.equal(game.phase, 'staging');
  assert.deepEqual(hud(), [['clanwars_countdown', game.starts - C.now()]], 'only the countdown changes in staging');
  game.kills[0] = 1;
  tick();
  assert.deepEqual(hud().map(([name]) => name).sort(), ['clanwars_countdown', 'clanwars_kills_1']);
  assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_kills_1')), 1);
});

test('native opponent cap revision invalidates prior acceptance and unsupported controls cannot change fixed terms', async () => {
  const a = actor(), b = actor(); channel(a); channel(b);
  await challenge(a, b); await challenge(b, a);
  await click(a, 'clanwars_setup:accept');
  const session = C.negotiations.get(a);
  assert.equal(session.accepted.has(a), true);
  await click(b, 'clanwars_setup:dropdown_playercap', 2);
  assert.equal(session.accepted.size, 0, 'previous acceptance does not survive changed terms');
  await click(a, 'clanwars_setup:accept');
  assert.equal(session.accepted.has(a), false, 'opponent must wait through change notice');
  tick(9);
  await click(a, 'clanwars_setup:magic', 0);
  assert.equal(session.rules.magic, 4, 'forged hidden magic selection cannot enable spells');
  await click(a, 'clanwars_setup:accept'); await click(b, 'clanwars_setup:accept');
  assert.equal(session.stage, 'confirm');
  // The client already changed to the confirmation; an old setup click cannot mutate it.
  await click(a, 'clanwars_setup:dropdown_playercap', 1);
  assert.equal(session.rules.playercap, 1);
  assert.equal(session.stage, 'confirm');
});

test('real combat policy rejects teammates and other instances while admitting an opposing melee fighter', async () => {
  const a = actor(), teammate = actor(), b = actor(); channel(a, [teammate]); channel(b);
  const game = await negotiate(a, b); await join(a); await join(teammate); await join(b);
  core.World.processCycle = game.starts; game.tick();
  const melee = { type: () => core.CombatType.MELEE };
  assert.equal(CombatFactory.canAttackByPolicy(a, teammate, melee), CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.equal(CombatFactory.canAttackByPolicy(a, b, melee), CanAttackResponse.CAN_ATTACK);
  const c = actor(), d = actor(); channel(c); channel(d);
  const other = await negotiate(c, d); await join(c); await join(d);
  core.World.processCycle = other.starts; other.tick();
  assert.notEqual(game.area, other.area);
  assert.equal(CombatFactory.canAttackByPolicy(a, d, melee), CanAttackResponse.CANT_ATTACK_IN_AREA);
});

test('pending death remains safe when the last fighter ends a match; live metadata survives', async () => {
  const a = actor(), b = actor(); channel(a); channel(b);
  const game = await negotiate(a, b); await join(a); await join(b);
  const item = Presets._test.spawnPresetItem(new core.Item(995, 17, { qa: 'retain' }), Presets.getGlobalPresetPool()[0], a);
  a.getInventory().add(item, false);
  const held = a.getInventory().getValidItems().find(x => x.getId() === 995);
  assert.equal(held.isPresetItem(), true);
  core.World.processCycle = game.starts; game.tick();
  const death = new PlayerDeathTask(a, false); death.execute();
  game.tick(); assert.equal(game.phase, 'over');
  for (let i = 0; i < 4; i++) death.execute();
  assert.equal(a.getInventory().getAmount(995), 17);
  assert.deepEqual(a.getInventory().getValidItems().find(x => x.getId() === 995).getMeta(), held.getMeta());
  assert.equal(a.getPrivateArea(), null); assert.equal(a.getLocation().getX(), C.RETURN[0]);
  assert.equal(Match.dying.has(a), false);
});

test('real chat leave cancels negotiation and disconnect removes instance ownership before saving', async () => {
  const a = actor(), b = actor(); channel(a); channel(b);
  await challenge(a, b); await challenge(b, a);
  FC.leave(a, false);
  assert.equal(C.negotiations.has(a), false); assert.equal(C.negotiations.has(b), false);
  assert.equal(FC.join(a, a.getUsername(), false), true);
  const game = await negotiate(a, b); await join(a); await join(b);
  PM.emitPlayerDisconnect({ player: a, username: a.getUsername(), source: 'native-test' });
  assert.equal(C.matches.has(a), false); assert.equal(game.members.has(a), false);
  assert.equal(a.getPacketSender().subInterfaceTargets.has(C.group('clanwars_hud')), false,
    'disconnect removes the real HUD mount owned by this match');
  assert.equal(a.getPrivateArea(), null);
  assert.deepEqual([a.getLocation().getX(), a.getLocation().getY(), a.getLocation().getZ()], C.RETURN);
  const save = PlayerSave.fromPlayer(a);
  assert.deepEqual([save.position.getX(), save.position.getY(), save.position.getZ()], C.RETURN);
});

test('JSON save/load recovers an interrupted instance login without changing items or ordinary logout positions', async () => {
  const a = actor(), b = actor(); channel(a); channel(b);
  const game = await negotiate(a, b); await join(a); await join(b);
  a.getInventory().add(Presets._test.spawnPresetItem(new core.Item(995, 19, { qa: 'saved' }),
    Presets.getGlobalPresetPool()[0], a), false);
  let codec;
  require('../plugins/persistence/JsonPlayerPersistence.plugin').register({
    getSkillManager: () => require('../dist/game/content/skill/SkillManager').SkillManager,
    setPlayerPersistence: backend => { codec = backend; }, log() {},
  });
  const snapshot = p => JSON.parse(JSON.stringify(PlayerSave.fromPlayer(p),
    codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const raw = snapshot(a);
  assert.equal(raw.attributes[C.IN_MATCH_ATTRIBUTE], true, 'active-instance ownership is persisted');
  assert.ok(a.getLocation().getX() >= 8192, 'snapshot captures an allocated instance tile');
  const loaded = actor();
  codec.hydratePlayerSave(raw).applyToPlayer(loaded);
  assert.equal(loaded.getAttribute(C.IN_MATCH_ATTRIBUTE), true);
  assert.equal(loaded.getLocation().getX(), a.getLocation().getX());
  PM.emitPlayerLogin({ player: loaded, username: loaded.getUsername(), isNewAccount: false });
  assert.deepEqual([loaded.getLocation().getX(), loaded.getLocation().getY(), loaded.getLocation().getZ()], C.RETURN);
  assert.equal(loaded.getAttribute(C.IN_MATCH_ATTRIBUTE), false);
  assert.equal(C.matches.has(loaded), false, 'a recovered login does not recreate stale match membership');
  assert.equal(loaded.getInventory().getAmount(995), 19);
  const item = loaded.getInventory().getValidItems().find(x => x.getId() === 995);
  assert.equal(item.isPresetItem(), true); assert.equal(item.isUnbankable(), true);
  assert.equal(item.getMeta().qa, 'saved');

  PM.emitPlayerLogout({ player: a, username: a.getUsername() });
  assert.equal(game.members.has(a), false);
  assert.equal(a.getAttribute(C.IN_MATCH_ATTRIBUTE), false);
  a.setLocation(new core.Location(3126, 3624, 0));
  const normal = snapshot(a);
  assert.equal(normal.attributes[C.IN_MATCH_ATTRIBUTE], undefined, 'false ownership uses the saved default');
  const ordinary = actor(); codec.hydratePlayerSave(normal).applyToPlayer(ordinary);
  PM.emitPlayerLogin({ player: ordinary, username: ordinary.getUsername(), isNewAccount: false });
  assert.deepEqual([ordinary.getLocation().getX(), ordinary.getLocation().getY(), ordinary.getLocation().getZ()], [3126, 3624, 0]);
});

test('real PvP statistics and killstreak consumers ignore arena deaths, including a result before death completion', async t => {
  // A supported globally PvP-tagged world makes blood-money eligibility material even
  // for allocated arena coordinates; use the real boundary policy rather than stub it.
  const { WORLD_ZONE_BOUNDARIES } = require('../dist/game/definition/WorldDefinition');
  const { Wilderness } = require('../dist/game/content/wilderness/Wilderness');
  const pvp = new core.Boundary(0, 0x3fff, 0, 0x3fff, 0);
  WORLD_ZONE_BOUNDARIES.pvp.push(pvp);
  t.after(() => WORLD_ZONE_BOUNDARIES.pvp.splice(WORLD_ZONE_BOUNDARIES.pvp.indexOf(pvp), 1));
  const money = core.ItemIdentifiers.BLOOD_MONEY;
  const stats = p => { const q = { player: p }; PM.emitCustomEvent('pvp:stats', q); return q.stats; };
  const seed = p => {
    p.setAttribute('pvp:killstreak', 4); p.setAttribute('pvp:player-killstreak', 3);
    p.setAttribute('pvp:bot-killstreak', 2); p.setAttribute('killstreaks:total-kills', 7);
    p.setAttribute('killstreaks:deaths', 5); p.setAttribute('killstreaks:highest-streak', 8);
  };
  const legacy = p => ['pvp:killstreak', 'killstreaks:total-kills', 'killstreaks:deaths',
    'killstreaks:highest-streak', 'killstreaks:recent-kills'].map(key => p.getAttribute(key));
  for (const finishPending of [false, true]) {
    const victim = actor(), killer = actor();
    const survivor = finishPending ? null : actor();
    channel(victim, survivor ? [survivor] : []); channel(killer);
    const game = await negotiate(victim, killer); await join(victim); await join(killer);
    if (survivor) await join(survivor);
    core.World.processCycle = game.starts; game.tick();
    assert.equal(Wilderness.isIn(victim), true); assert.equal(Wilderness.isIn(killer), true);
    for (const p of [victim, killer]) seed(p);
    const before = [victim, killer].map(p => ({ stats: stats(p), legacy: legacy(p), money: p.getInventory().getAmount(money) }));
    victim.getCombat().addDamage(killer, 10);
    assert.equal(victim.getCombat().getKiller(false), killer, 'real damage owner supplies the death killer');
    const death = new PlayerDeathTask(victim, false); death.execute();
    if (finishPending) { game.tick(); assert.equal(game.phase, 'over'); }
    for (let i = 0; i < 4; i++) death.execute();
    for (const [index, p] of [victim, killer].entries()) {
      assert.deepEqual(stats(p), before[index].stats, 'arena combat cannot change Elo, kills, deaths or split streaks');
      assert.deepEqual(legacy(p), before[index].legacy, 'arena defeat cannot reset the victim streak or reward the killer');
      assert.equal(p.getInventory().getAmount(money), before[index].money);
    }
    if (!finishPending) game.finish(null);
  }
  // Positive control proves both real consumers ran and their normal reward path works.
  const victim = actor(), killer = actor();
  victim.setLocation(new core.Location(3200, 3600, 0)); killer.setLocation(new core.Location(3201, 3600, 0));
  victim.setAttribute('pvp:killstreak', 4);
  assert.equal(Wilderness.isIn(victim), true); assert.equal(Wilderness.isIn(killer), true);
  victim.getCombat().addDamage(killer, 10);
  const death = new PlayerDeathTask(victim, false);
  for (let i = 0; i < 5; i++) death.execute();
  assert.equal(stats(killer).playerKills, 1); assert.equal(stats(victim).pvpDeaths, 1);
  assert.equal(stats(killer).elo, 1016); assert.equal(stats(victim).elo, 984);
  assert.equal(victim.getAttribute('pvp:killstreak'), 0);
  assert.equal(killer.getAttribute('pvp:killstreak'), 1);
  assert.equal(killer.getInventory().getAmount(money), 150);
});

test('independent: actual Plateau clipping separates staging and jail', async () => {
  const a=actor(), ally=actor(), b=actor(); channel(a,[ally]); channel(b);
  const game=await negotiate(a,b); await join(a); await join(ally); await join(b);
  function reachable(from,to) {
    const queue=[[from[0],from[1]]], seen=new Set([from.slice(0,2).join(',')]);
    for(let i=0;i<queue.length;i++) {
      const [x,y]=queue[i]; if(x===to[0] && y===to[1]) return true;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;
        if(nx<3264||nx>=3328||ny<4928||ny>=4992||seen.has(k)) continue;
        const s=game.area.at([x,y,0]),t=game.area.at([nx,ny,0]);
        if(core.RegionManager.canMovestart(s,t,1,1,game.area)) {seen.add(k);queue.push([nx,ny]);}
      }
    } return false;
  }
  assert.equal(reachable([3293,4933],[3293,4986]),false,'prep barrier prevents reaching opposing landing');
  core.World.processCycle=game.starts; game.tick();
  assert.equal(reachable([3293,4933],[3293,4986]),true,'barrier removed makes arena connected');
  assert.equal(reachable([3323,4943],[3293,4933]),false,'south jail cannot walk back to combat');
  assert.equal(reachable([3323,4976],[3293,4986]),false,'north jail cannot walk back to combat');
});test('independent: closed join confirmation cannot intercept a later challenge', async () => {
 const a=actor(),b=actor();channel(a);channel(b);
 const first=await negotiate(a,b);
 Match.enter({player:a});
 assert.equal(a.getInterfaceId(),C.group('clanwars_confirm'));
 a.getPacketSender().sendInterfaceRemoval();
 first.finish(null);
 const second=await negotiate(a,b);
 assert.ok(second,'later native challenge confirmations must still start a battle');
});


// These tests seed scene placement and pre-rolled melee damage. Negotiation, attack
// input, hit/death tasks, portal dispatch, inventories and instance cleanup are real.
async function lethalMelee(killer, victim, game, runDeathTick = true, combatTiles = [[3293,4955,0],[3294,4955,0]], beforeHit = null, preserveVictim = false) {
  const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
  const { HitQueue } = require('../dist/game/content/combat/hit/HitQueue');
  killer.moveTo(game.area.at(combatTiles[0]));
  if (preserveVictim) assert.deepEqual(position(victim),positionAt(game,combatTiles[1]));
  else victim.moveTo(game.area.at(combatTiles[1]));
  for (const p of [killer, victim]) { p.setNeedsPlacement(false); p.resetUpdating(); AreaManager.process(p); }
  assert.equal(CombatFactory.canAttackByPolicy(killer, victim, CombatFactory.MELEE_COMBAT), CanAttackResponse.CAN_ATTACK);
  const frame = Buffer.alloc(4); frame[0] = 44; frame[1] = 128; frame.writeUInt16BE(victim.getIndex(), 2);
  const decoded = decodeClientPackets(frame);
  assert.equal(decoded[0].index, victim.getIndex());
  assert.equal(decoded[0].option, 1);
  await wire(killer, frame);
  assert.equal(killer.getCombat().getTarget(), victim, 'native Attack owns the opposing target');
  if (beforeHit) beforeHit(); // Optional fixture observer; does not replace native Attack, hit or death.
  const hit = new PendingHit(killer, victim, CombatFactory.MELEE_COMBAT,
    { damage: victim.getHitpoints(), rollAccuracy: false, handleAfterHitEffects: false, experience: false });
  CombatFactory.addPendingHit(hit);
  core.World.processCycle++;
  HitQueue.processAll(core.World.processCycle);
  assert.equal(victim.getHitpoints(), 0, 'real incoming melee hit starts the production death task');
  if (runDeathTick) tick();
}
async function jailExit(player, game, waitTicks = 15) {
  // The death task moves after this fixture's player updates; complete that
  // ordinary placement update before sending the next object's input.
  tick();
  assert.equal(player.isNeedsPlacement(), false, 'death placement completed before the jail portal click');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
  const side = game.members.get(player);
  const jail = game.area.at(side === 0 ? [3323, 4943, 0] : [3323, 4976, 0]);
  // Template scene locs are not in the main-world or spawned-object lists.
  const objects = [];
  for (let x=0; x<game.area.widthChunks; x++) for (let y=0; y<game.area.heightChunks; y++) {
    objects.push(...game.area.getChunkObjects(0,x,y));
  }
  const distance = object => Math.max(Math.abs(object.getLocation().getX()-jail.getX()),
    Math.abs(object.getLocation().getY()-jail.getY()));
  const portals = objects.filter(object => object.getDefinition()?.getName() === 'Portal'
    && object.getDefinition().getInteractions().some(op => op?.toLowerCase() === 'exit'));
  assert.ok(portals.length, 'the active Plateau instance supplies a real jail exit portal');
  const portal = portals.sort((a,b) => distance(a)-distance(b))[0];
  const at = portal.getLocation();
  assert.equal(MapObjects.getPrivateArea(player,portal.getId(),at),portal,
    'the native dispatcher resolves this exact mapped instance portal');
  const op = portal.getDefinition().getInteractions().findIndex(option => option?.toLowerCase() === 'exit') + 1;
  new ObjectActionPacketListener().executeAction(player, portal.getId(), at.getX(), at.getY(), op);
  tick(waitTicks);
  return {portal,op};
}

test('native kill-target negotiation preserves cap, invalidates acceptance and rejects unsupported mode rows', async () => {
  const a = actor(), b = actor(); channel(a); channel(b);
  await challenge(a,b); await challenge(b,a);
  await click(a, 'clanwars_setup:dropdown_playercap', 3); tick(9);
  await click(a, 'clanwars_setup:accept');
  const session = C.negotiations.get(a);
  assert.equal(session.accepted.has(a), true);
  await click(b, 'clanwars_setup:wincondition', 3);
  assert.equal(session.rules.wincondition, 1, 'first-to-25 is a reachable native selection');
  assert.equal(session.rules.playercap, 2, 'mode changes retain the agreed cap');
  assert.equal(session.accepted.size, 0);
  await click(a, 'clanwars_setup:accept'); assert.equal(session.accepted.has(a), false);
  tick(9);
  for (const forged of [1, 2, 27, 45, 42, 72, 65535]) {
    await click(a, 'clanwars_setup:wincondition', forged);
    assert.equal(session.rules.wincondition, 1, 'non-row and deferred mode selections cannot alter the offer');
  }
  await click(a, 'clanwars_setup:accept'); await click(b, 'clanwars_setup:accept');
  assert.equal(session.stage, 'confirm');
  assert.equal(session.rules.wincondition, 1);
});

test('first-to-25 plays through real melee deaths, jail portals, exact target and a second native match', async () => {
  const a = actor(), b = actor(); channel(a); channel(b);
  const game = await negotiate(a,b,1,1); await join(a); await join(b);
  const held = new core.Item(995, 37, { qa: 'kill-target-retain' });
  b.getInventory().add(held, false);
  const meta = structuredClone(b.getInventory().getValidItems().find(i => i.getId() === 995).getMeta());
  const scoringSide = game.channelKeys.indexOf(C.channel(a).key);
  assert.equal(game.members.get(a), scoringSide);
  assert.equal(game.members.get(b), 1 - scoringSide);
  core.World.processCycle = game.starts; game.tick();
  for (let kill = 1; kill <= 25; kill++) {
    await lethalMelee(a,b,game);
    const expected = [0,0]; expected[scoringSide] = kill;
    assert.deepEqual(game.kills, expected, 'one real death awards exactly one opposing-team kill');
    if (kill < 25) {
      assert.equal(game.phase, 'combat', 'one living side is not an early LTS victory');
      tick(4);
      assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(`clanwars_kills_${scoringSide + 1}`)), kill, 'native HUD receives the score');
      assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_wincondition')), 1);
      assert.equal(game.jailed.has(b), true);
      assert.equal(game.fighters.has(b), false);
      assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT), false, 'jail is outside combat');
      assert.equal(b.getInventory().getAmount(995), 37);
      assert.deepEqual(b.getInventory().getValidItems().find(i => i.getId() === 995).getMeta(), meta);
      await jailExit(b,game);
      assert.equal(game.fighters.has(b), true, 'native jail Exit returns the defeated fighter to combat');
      assert.equal(game.jailed.has(b), false);
    }
  }
  assert.equal(game.phase, 'over', 'the sourced 25th kill ends the battle');
  assert.equal(Match.dying.has(b), true, 'last kill retains independent safe-death ownership');
  tick(4);
  for (const p of [a,b]) {
    assert.equal(C.matches.has(p), false); assert.equal(p.getPrivateArea(), null);
    assert.deepEqual([p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()],C.RETURN);
    p.getPacketSender().sendInterfaceRemoval();
  }
  assert.equal(b.getInventory().getAmount(995),37);
  assert.equal(Match.dying.has(b),false);
  assert.equal(C.channelGames.size,0);
  // The final death callback also places the loser in the lobby after updates.
  tick();
  for (const p of [a,b]) assert.equal(p.isNeedsPlacement(),false,'lobby placement completed before the second challenge');
  const second = await negotiate(a,b,1,1); await join(a); await join(b);
  assert.notEqual(second,game); assert.deepEqual(second.kills,[0,0]);
  assert.equal(second.phase,'staging'); assert.equal(second.fighters.size,2);
});

test('kill-target late entry and reserved jail roster obey the native team cap', async () => {
  const a=actor(), extra=actor(), b=actor(); channel(a,[extra]); channel(b);
  const game=await negotiate(a,b,1,1); await join(a); await join(b);
  core.World.processCycle=game.starts; game.tick();
  await lethalMelee(b,a,game); tick(4);
  assert.equal(game.jailed.has(a),true);
  await join(extra);
  assert.equal(C.matches.has(extra),false,'a jailed fighter retains their reserved 1v1 slot');
  await jailExit(a,game); assert.equal(game.fighters.has(a),true);
});

test('kill-target late join and channel-leave death credit use real channel events once', async () => {
  const a=actor(), extra=actor(), b=actor(); channel(a,[extra]); channel(b);
  const game=await negotiate(a,b,2,1); await join(a); await join(b);
  core.World.processCycle=game.starts; game.tick();
  await join(extra);
  assert.equal(C.matches.get(extra),game,'mode allows the ordinary purple portal after preparation');
  const otherSide = 1 - game.channelKeys.indexOf(C.channel(extra).key);
  const expected = [0,0]; expected[otherSide] = 1;
  FC.leave(extra,false);
  assert.deepEqual(game.kills,expected,'fixed counts-as-death rule credits the other team');
  tick(2); assert.deepEqual(game.kills,expected,'channel event and polling cannot double count');
  assert.equal(C.matches.has(extra),false); assert.equal(game.phase,'combat');
});


for (const departure of ['disconnect hook', 'world removal']) {
  test(`kill-target: a live fighter's ${departure} counts as a death for the other side, once (PR #5416 review)`, async () => {
    const a=actor(), extra=actor(), b=actor(); channel(a,[extra]); channel(b);
    const game=await negotiate(a,b,2,1); await join(a); await join(b);
    core.World.processCycle=game.starts; game.tick();
    await join(extra);
    assert.equal(game.fighters.has(extra),true);
    assert.equal(game.rules.leavingcc,0,'the default terms count leaving as a death');
    const otherSide = 1 - game.channelKeys.indexOf(C.channel(extra).key);
    const expected = [0,0]; expected[otherSide] = 1;
    PM.emitPlayerDisconnect({ player: extra, username: extra.getUsername(), source: 'native-test' });
    if (departure === 'world removal') PM.emitPlayerLogout({ player: extra, username: extra.getUsername() });
    assert.deepEqual(game.kills,expected,'the departure credits the other team');
    tick(2); assert.deepEqual(game.kills,expected,'later hooks and polling cannot double count');
    assert.equal(C.matches.has(extra),false); assert.equal(game.phase,'combat');
  });
}

test('kill-target finish protects two queued production death tasks before the second dying event', async () => {
  const a=actor(), b=actor(); channel(a); channel(b);
  const game=await negotiate(a,b,1,1); await join(a); await join(b);
  core.World.processCycle=game.starts; game.tick();
  // Seed the immediately-before-target state for the concurrent death boundary.
  // The separate full-match case reaches the actual 25-kill target without seeding scores.
  game.kills[game.channelKeys.indexOf(C.channel(b).key)]=24;
  for (const [i,p] of [a,b].entries()) {
    p.getInventory().add(new core.Item(995,41+i,{qa:`pending-${i}`}),false);
    p.getCombat().addDamage(i===0?b:a,10);
  }
  a.setHitpoints(0); b.setHitpoints(0);
  assert.equal(a.isDyingReturn(),true); assert.equal(b.isDyingReturn(),true);
  assert.equal(Match.dying.size,0,'both tasks are queued before either emits dying');
  tick();
  assert.equal(game.phase,'over','the first queued death reaches the target');
  for (const p of [a,b]) {
    assert.equal(Match.dying.has(p),true,'cleanup retains both current and not-yet-started safe deaths');
    const reward={victim:p,allow:true}; PM.emitCustomEvent('pvp:count-stats',reward);
    assert.equal(reward.allow,false);
    assert.equal(PM.emitShouldDropItemsOnDeath(p,null),false);
  }
  tick(4);
  for (const [i,p] of [a,b].entries()) {
    assert.equal(Match.dying.has(p),false);
    assert.equal(p.getInventory().getAmount(995),41+i);
    assert.deepEqual(p.getInventory().getValidItems().find(x=>x.getId()===995).getMeta(),{qa:`pending-${i}`});
    assert.equal(p.getPrivateArea(),null);
    assert.deepEqual([p.getLocation().getX(),p.getLocation().getY(),p.getLocation().getZ()],C.RETURN);
  }
});

// A supplied lethal HP update queues the real death task, but no task runs until tick().
// Each departure leaves two other fighters in combat, isolating remove from finish.
for (const mode of [0, 1]) {
  for (const departure of ['channel leave', 'disconnect hook', 'logout hook', 'world removal', 'forfeit handler']) {
    test(`queued safe death survives ${departure} before its first callback in mode ${mode}`, async () => {
      const a = actor(), extra = actor(), b = actor(); channel(a, [extra]); channel(b);
      const game = await negotiate(a, b, 2, mode);
      await join(a); await join(extra); await join(b);
      core.World.processCycle = game.starts; game.tick();
      assert.equal(game.phase, 'combat');
      assert.equal(game.members.size, 3);
      const side = game.members.get(extra);
      assert.equal(C.matches.get(extra), game);
      assert.equal(game.fighters.get(extra), side);
      assert.equal(game.members.get(b), 1 - side);
      for (const id of [4151, 1127, 1079, 1163, 1201, 995]) {
        extra.getInventory().add(new core.Item(id, id === 995 ? 77 : 1, { qa: `queued-${id}` }), false);
      }
      const inventory = () => extra.getInventory().getValidItems().map(item =>
        ({ id: item.getId(), amount: item.getAmount(), meta: structuredClone(item.getMeta()) }));
      const before = inventory();
      assert.equal(before.length, 6, 'more than three protected items expose unsafe death drops');
      extra.getCombat().addDamage(b, 10);
      assert.equal(extra.getCombat().getKiller(false), b, 'real damage owner supplies the queued task killer');
      extra.setHitpoints(0);
      assert.equal(extra.isDyingReturn(), true, 'production death task is queued');
      assert.equal(Match.dying.has(extra), false, 'first dying callback has not run');
      if (departure === 'channel leave') FC.leave(extra, false);
      else if (departure === 'disconnect hook') PM.emitPlayerDisconnect({ player: extra, username: extra.getUsername(), source: 'native-test' });
      else if (departure === 'logout hook') PM.emitPlayerLogout({ player: extra, username: extra.getUsername() });
      // World's queue_remove_players order: the disconnect hook, then players.remove's logout hook.
      else if (departure === 'world removal') {
        PM.emitPlayerDisconnect({ player: extra, username: extra.getUsername(), source: 'native-test' });
        PM.emitPlayerLogout({ player: extra, username: extra.getUsername() });
      }
      else assert.equal(Match.leave({ player: extra }), true, 'registered Forfeit handler removes the fighter');
      assert.equal(C.matches.has(extra), false);
      assert.equal(game.members.has(extra), false);
      assert.equal(game.phase, 'combat', 'this is removal without match completion');
      const guards = { shouldDrop: PM.emitShouldDropItemsOnDeath(extra, b), bones: { player: extra, killer: b, allow: true }, pvp: { victim: extra, allow: true } };
      PM.emitCustomEvent('player:death-bones', guards.bones);
      PM.emitCustomEvent('pvp:count-stats', guards.pvp);
      tick(6);
      console.log(JSON.stringify({ queuedDeparture: departure, mode, itemIds: inventory().map(item => item.id),
        location: [extra.getLocation().getX(), extra.getLocation().getY(), extra.getLocation().getZ()],
        shouldDrop: guards.shouldDrop, bones: guards.bones.allow, pvp: guards.pvp.allow }));
      assert.deepEqual(inventory(), before, 'safe queued death preserves every item, amount and metadata');
      assert.deepEqual([extra.getLocation().getX(), extra.getLocation().getY(), extra.getLocation().getZ()], C.RETURN,
        'final death callback returns to the Clan Wars lobby');
      assert.equal(extra.getPrivateArea(), null);
      assert.equal(guards.shouldDrop, false, 'queued owner vetoes item drops immediately after departure');
      assert.equal(guards.bones.allow, false, 'queued owner vetoes bones immediately after departure');
      assert.equal(guards.pvp.allow, false, 'queued owner vetoes PvP rewards immediately after departure');
      assert.equal(Match.dying.has(extra), false, 'final callback releases independent ownership');
      const expected = [0, 0];
      // The lethal hit landed before the departure, so its kill counts once (the Forfeit portal refuses a dying player).
      if (mode && departure !== 'forfeit handler') expected[1 - side] = 1;
      assert.deepEqual(game.kills, expected, 'departure is not credited again by the delayed death task');
      assert.equal(game.phase, 'combat');
    });
  }
}

// Observe the actual sender arguments while still emitting the production packet.
// This establishes server-sent native script data, not rendered-client output.
function scriptCalls(player) {
  const sender = player.getPacketSender(), original = sender.sendClientScript;
  const calls = [];
  sender.sendClientScript = function (id, ...args) {
    calls.push([id, ...args]);
    return original.call(this, id, ...args);
  };
  return calls;
}
function timer(player) {
  return player.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_timeremaining'));
}
function lobby(player) {
  assert.equal(C.matches.has(player), false);
  assert.equal(player.getPrivateArea(), null);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], C.RETURN);
  assert.equal(timer(player), 0, 'cleanup clears the native battle timer');
}

for (const [mode, duration] of [[16,500], [17,1000], [18,2000], [19,6000], [20,12000]]) {
  test(`native timed mode ${mode} negotiates its sourced duration and pauses during preparation`, async () => {
    const a = actor(), b = actor(); channel(a); channel(b);
    const scripts = scriptCalls(a);
    const game = await negotiate(a, b, 1, mode);
    assert.equal(game.rules.wincondition, mode);
    assert.equal(game.rules.playercap, 1, 'mode selection preserves the negotiated 1v1 cap');
    assert.ok(scripts.some(([id, stage, text]) => id === 554 && stage === 0
      && text.includes(`Most kills in ${duration / 100} minutes on Plateau`)),
      'native captain confirmation receives the chosen time limit');
    await join(a); await join(b);
    assert.equal(timer(a), duration); assert.equal(timer(b), duration);
    tick(3);
    assert.equal(game.phase, 'staging');
    assert.equal(game.ends, null, 'no battle deadline runs behind the preparation wall');
    assert.equal(timer(a), duration, 'preparation does not consume the selected battle time');
    core.World.processCycle = game.starts - 1; tick();
    assert.equal(game.phase, 'combat');
    assert.equal(game.ends, game.starts + duration);
    assert.equal(timer(a), duration);
    tick(); assert.equal(timer(a), duration - 1);
  });
}

test('five-minute Most kills plays real respawns through the deadline, late entry and a second untimed match', async () => {
  const a = actor(), extra = actor(), b = actor(); channel(a, [extra]); channel(b);
  const aScripts = scriptCalls(a), bScripts = scriptCalls(b);
  const game = await negotiate(a, b, 2, 16); await join(a); await join(b);
  const side = game.members.get(a);
  b.getInventory().add(new core.Item(995, 37, { qa: 'timed-retain' }), false);
  core.World.processCycle = game.starts - 1; tick();
  const started = C.now(); assert.equal(game.ends - started, 500);
  await lethalMelee(a, b, game); tick(4);
  assert.equal(game.phase, 'combat'); assert.equal(game.jailed.has(b), true);
  assert.equal(b.getInventory().getAmount(995), 37);
  assert.deepEqual(b.getInventory().getValidItems().find(item => item.getId() === 995).getMeta(), { qa: 'timed-retain' });
  await jailExit(b, game);
  await lethalMelee(b, a, game); tick(4); await jailExit(a, game);
  await lethalMelee(a, b, game); tick(4); await jailExit(b, game);
  const expected = [0, 0]; expected[side] = 2; expected[1 - side] = 1;
  assert.deepEqual(game.kills, expected);
  await join(extra);
  assert.equal(C.matches.get(extra), game, 'ordinary purple-portal late entry is supported');
  assert.equal(timer(extra), game.ends - C.now(), 'late entrant sees the remaining time');
  assert.equal(extra.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(`clanwars_kills_${side + 1}`)), 2);
  assert.equal(game.area.canAttack(a, b, CombatFactory.MELEE_COMBAT), true);
  assert.equal(game.area.canAttack(a, b, { type: () => core.CombatType.MAGIC }), false);
  assert.equal(game.area.canAttack(a, extra, CombatFactory.MELEE_COMBAT), false);
  assert.ok(game.ends - C.now() > 1);
  tick(game.ends - C.now() - 1);
  assert.equal(game.phase, 'combat'); assert.equal(timer(a), 1);
  tick();
  assert.equal(C.now() - started, 500, 'all 500 combat ticks elapse before the time-limit result');
  assert.equal(game.phase, 'over'); assert.deepEqual(game.kills, expected);
  assert.deepEqual(aScripts.filter(([id]) => id === 592).at(-1), [592, 1, 'Your team won the battle.']);
  assert.deepEqual(bScripts.filter(([id]) => id === 592).at(-1), [592, 0, 'Your team lost the battle.']);
  for (const p of [a, b, extra]) { lobby(p); p.getPacketSender().sendInterfaceRemoval(); }
  assert.equal(C.channelGames.size, 0); assert.equal(Match.dying.size, 0);
  tick();
  for (const p of [a, b]) assert.equal(p.isNeedsPlacement(), false);
  const second = await negotiate(a, b, 1, 0); await join(a); await join(b);
  assert.notEqual(second, game); assert.equal(second.ends, null);
  assert.deepEqual(second.kills, [0, 0]); assert.equal(timer(a), 0); assert.equal(timer(b), 0);
  core.World.processCycle = second.starts - 1; tick();
  assert.equal(second.phase, 'combat'); assert.equal(timer(a), 0);
});

test('timed equal-score battle ends without a winner on the native result interface', async () => {
  const a = actor(), b = actor(), late = actor(); channel(a); channel(b, [late]);
  const aScripts = scriptCalls(a), bScripts = scriptCalls(b);
  const game = await negotiate(a, b, 1, 16); await join(a); await join(b);
  core.World.processCycle = game.starts - 1; tick();
  await lethalMelee(a, b, game); tick(4); await jailExit(b, game);
  await lethalMelee(b, a, game); tick(4); await jailExit(a, game);
  assert.deepEqual(game.kills, [1, 1]);
  await join(late, false);
  assert.equal(late.getInterfaceId(), C.group('clanwars_confirm'));
  tick(game.ends - C.now());
  assert.equal(game.phase, 'over');
  for (const scripts of [aScripts, bScripts]) {
    assert.deepEqual(scripts.filter(([id]) => id === 592).at(-1), [592, 0, 'The battle ended without a winner.']);
  }
  lobby(a); lobby(b);
  assert.equal(C.matches.has(late), false);
  assert.notEqual(late.getInterfaceId(), C.group('clanwars_confirm'), 'expiry closes pending outsider confirmations');
});

test('exact-deadline channel leave cannot change the result and queued real deaths remain safe', async () => {
  const a = actor(), extra = actor(), b = actor(); channel(a, [extra]); channel(b);
  const scripts = scriptCalls(a);
  const game = await negotiate(a, b, 2, 16); await join(a); await join(extra); await join(b);
  core.World.processCycle = game.starts - 1; tick();
  const side = game.members.get(a);
  // A checkpoint isolates ordering at the exact deadline; the full match above earns its scores.
  game.kills[side] = 2; game.kills[1 - side] = 1;
  core.World.processCycle = game.ends - 1;
  for (const p of [extra, b]) {
    for (const id of [4151, 1127, 1079, 1163, 1201, 995]) {
      p.getInventory().add(new core.Item(id, id === 995 ? 77 : 1, { qa: `deadline-${id}` }), false);
    }
    p.getCombat().addDamage(p === b ? a : b, 10);
    p.setHitpoints(0);
    assert.equal(p.isDyingReturn(), true);
    assert.equal(Match.dying.has(p), false);
  }
  const scores = game.kills.slice();
  core.World.processCycle = game.ends;
  FC.leave(a, false);
  assert.equal(game.phase, 'over', 'ordinary channel event resolves the expired battle before its penalty');
  assert.deepEqual(game.kills, scores, 'a deadline penalty cannot turn the earned win into a tie');
  assert.deepEqual(scripts.filter(([id]) => id === 592).at(-1), [592, 1, 'Your team won the battle.']);
  for (const p of [extra, b]) {
    assert.equal(Match.dying.has(p), true);
    assert.equal(PM.emitShouldDropItemsOnDeath(p, a), false);
  }
  tick(6);
  for (const p of [extra, b]) {
    assert.deepEqual(p.getInventory().getValidItems().map(item => item.getId()), [4151,1127,1079,1163,1201,995]);
    assert.equal(p.getInventory().getAmount(995), 77);
    assert.deepEqual(p.getInventory().getValidItems().find(item => item.getId() === 995).getMeta(), { qa: 'deadline-995' });
    assert.equal(Match.dying.has(p), false); lobby(p);
  }
});

test('timed deadline refuses combat, jail return and an already-open native join confirmation', async () => {
  const a = actor(), b = actor(), teammate = actor(), late = actor(); channel(a); channel(b, [teammate, late]);
  const game = await negotiate(a, b, 2, 16); await join(a); await join(b); await join(teammate);
  core.World.processCycle = game.starts - 1; tick();
  await lethalMelee(a, b, game); tick(4);
  assert.equal(game.jailed.has(b), true);
  await join(late, false);
  assert.equal(late.getInterfaceId(), C.group('clanwars_confirm'));
  core.World.processCycle = game.ends - 1;
  assert.equal(game.canJoin(), true);
  assert.equal(game.area.canAttack(a, teammate, CombatFactory.MELEE_COMBAT), true);
  const scores = game.kills.slice();
  core.World.processCycle = game.ends;
  assert.equal(game.canJoin(), false);
  assert.equal(game.rejoin(b), false, 'jail return is closed at the same deadline');
  assert.equal(game.jailed.has(b), true);
  assert.equal(game.area.canAttack(a, teammate, CombatFactory.MELEE_COMBAT), false);
  await click(late, 'clanwars_confirm:button');
  assert.equal(C.matches.has(late), false, 'stale native confirmation cannot enter the expired battle');
  assert.notEqual(late.getInterfaceId(), C.group('clanwars_confirm'), 'deadline refusal closes the stale join modal');
  assert.equal(game.phase, 'over'); assert.deepEqual(game.kills, scores);
  for (const p of [a, b, teammate]) lobby(p);
});

test('timed HUD saturates at native Lots while full server scores and the scoring deadline decide the winner', async () => {
  const a = actor(), extra = actor(), b = actor(); channel(a, [extra]); channel(b);
  const scripts = scriptCalls(a);
  const game = await negotiate(a, b, 2, 16); await join(a); await join(b);
  core.World.processCycle = game.starts - 1; tick();
  const side = game.members.get(a);
  // Boundary checkpoints, not a claim that the fixture earned 65,536 natural kills.
  game.kills[side] = 65536; game.kills[1 - side] = 65535;
  tick();
  for (const name of ['clanwars_kills_1', 'clanwars_kills_2']) {
    assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(name)), 65535);
  }
  await join(extra);
  for (const name of ['clanwars_kills_1', 'clanwars_kills_2']) {
    assert.equal(extra.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(name)), 65535);
  }
  const scores = game.kills.slice();
  core.World.processCycle = game.ends;
  game.score(1 - side);
  assert.equal(game.phase, 'over'); assert.deepEqual(game.kills, scores, 'deadline callback cannot add a tying kill');
  assert.deepEqual(scripts.filter(([id]) => id === 592).at(-1), [592, 1, 'Your team won the battle.']);
  lobby(a); lobby(b); lobby(extra);
});

// Viewer cases add the proven scene-return fixture's real session flush/visibility
// producers to the existing Clan Wars packet/instance harness. Transport remains inert.
const VIEW_CLOSE_PACKET = 55; // NativeClientPackets.IF_CLOSE, no payload.
function viewingUnit() { return require('../plugins/minigames/clanwars/Viewing.ClanWars'); }
async function viewerGame(mode = 0) {
  const a = actor(true), viewer = actor(true), b = actor(true); channel(a, [viewer]); channel(b);
  const game = await negotiate(a, b, 2, mode); await join(a); await join(viewer); await join(b);
  core.World.processCycle = game.starts - 1; tick();
  viewer.getCombat().addDamage(b, 10); viewer.setHitpoints(0); tick(6);
  assert.equal(game.jailed.has(viewer), true, 'real queued death has completed into the existing jail');
  assert.equal(viewer.getHitpoints() > 0, true); assert.equal(Match.dying.has(viewer), false);
  return { a, viewer, b, game };
}
function mappedOrb(viewer, game) {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const side = game.members.get(viewer), jail = game.area.at(side === 0 ? [3323,4943,0] : [3323,4976,0]);
  const id = core.CacheDefinitions.getLocId('clanwars_viewing_start_darkrock');
  const orbs = [];
  for (let x=0;x<game.area.widthChunks;x++) for (let y=0;y<game.area.heightChunks;y++) {
    orbs.push(...game.area.getChunkObjects(0,x,y).filter(object => object.getId() === id));
  }
  assert.ok(orbs.length, 'the pinned active orbs exist in this actual Plateau instance');
  const distance = object => Math.max(Math.abs(object.getLocation().getX()-jail.getX()), Math.abs(object.getLocation().getY()-jail.getY()));
  const object = orbs.sort((a,b) => distance(a)-distance(b))[0];
  assert.equal(MapObjects.getPrivateArea(viewer,id,object.getLocation()),object,'native resolver owns this exact mapped orb');
  assert.equal(object.getDefinition().getName(), 'Viewing orb');
  assert.equal(object.getDefinition().getInteractions()[0], 'Use');
  return object;
}
async function openView(viewer, game, expectOpen = true) {
  const object = mappedOrb(viewer, game);
  // Supplied settled adjacency, not a claim of naturally walking the entire jail.
  const side = game.members.get(viewer);
  viewer.moveTo(object.getLocation().transform(0, side === 0 ? -1 : 1)); tick(2);
  const origin = viewer.getLocation().clone();
  assert.equal(viewer.isNeedsPlacement(), false);
  const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
  const at = object.getLocation();
  new ObjectActionPacketListener().executeAction(viewer, object.getId(), at.getX(), at.getY(), 1);
  tick(4);
  if (expectOpen) assert.equal(viewer.getInterfaceId(), C.group('clanwars_view'), 'native mapped Viewing orb Use opens the real viewing controls');
  return origin;
}
function position(player) { const at = player.getLocation(); return [at.getX(),at.getY(),at.getZ()]; }
function hiddenByte(observer, target, force = false) {
  const payload = observer.getSession().createPlayerView(target, force).appearance;
  const name = Buffer.from(target.getDisplayName(), 'latin1'), start = payload.indexOf(name);
  assert.ok(start > 0, 'actual observer appearance carries this actor identity');
  return { payload, hidden: payload[start + name.length + 4] }; // name NUL, combat byte, total short, hidden byte.
}
function restoredViewer(viewer, game, origin) {
  assert.equal(viewingUnit().active.has(viewer), false);
  assert.equal(viewer.isAppearanceHidden(), false);
  assert.equal(viewer.isUntargetable(), false);
  assert.equal(viewer.getMovementQueue().isMovementBlocked(), false);
  assert.equal(viewer.getFixedViewDistance(), null);
  assert.deepEqual(viewer.getPacketSender().getCameraState(), { mode: 'follow' });
  assert.equal(game.jailed.has(viewer), true);
  assert.deepEqual(position(viewer), [origin.getX(),origin.getY(),origin.getZ()]);
}

test('native jail orb opens five actual views, emits camera targets and restores through IF_CLOSE', async () => {
  const { a, viewer, b, game } = await viewerGame();
  const calls = scriptCalls(viewer), origin = await openView(viewer, game);
  assert.equal(viewer.isAppearanceHidden(), true); assert.equal(viewer.isUntargetable(), true);
  assert.equal(viewer.getMovementQueue().isMovementBlocked(), true); assert.equal(viewer.getFixedViewDistance(), 64);
  const { encodeCameraTarget, encodeCameraReset } = require('../dist/net/protocol/ClientProtocol');
  for (const [index, name] of ['central','sw','se','nw','ne'].entries()) {
    await click(viewer, `clanwars_view:${name}`, index % 2);
    const fraction = [[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]][index];
    const at = game.area.tile(game.area.widthChunks * 8 * fraction[0], game.area.heightChunks * 8 * fraction[1], 0);
    assert.deepEqual(position(viewer), [at.getX(),at.getY(),at.getZ()]);
    assert.deepEqual(calls.filter(([id]) => id === 562).at(-1), [562,index,9752], 'native selection/model matches the pinned orb contract');
    const expected = encodeCameraTarget({ x:at.getX(), y:at.getY(), level:at.getZ() });
    assert.ok(viewer.nativePackets.some(frame => frame.equals(expected)), 'real sender emitted this native target packet');
    assert.equal(viewer.getSession().isTileInScene(at.getX(),at.getY(),at.getZ()), true, 'actual instance scene was rebuilt before viewing');
  }
  assert.equal(game.area.canAttack(a,viewer,CombatFactory.MELEE_COMBAT), false);
  assert.equal(game.area.canAttack(viewer,b,CombatFactory.MELEE_COMBAT), false);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT), true);
  await wire(viewer, Buffer.from([VIEW_CLOSE_PACKET]));
  restoredViewer(viewer, game, origin);
  assert.ok(viewer.nativePackets.some(frame => frame.equals(encodeCameraReset())));
  const at = position(viewer); await click(viewer,'clanwars_view:ne');
  assert.deepEqual(position(viewer), at, 'stale view input after Close cannot move the player');
});

test('native viewing sends hidden appearance to two observers and visibility changes invalidate cached payloads', async () => {
  const { a, viewer, b, game } = await viewerGame();
  const origin = await openView(viewer, game);
  for (const p of [a,b]) p.moveTo(game.area.tile(31,31,0));
  tick(3);
  for (const observer of [a,b]) {
    assert.equal(observer.getLocalPlayers().includes(viewer), true, 'real private-area update includes the viewer actor');
    assert.equal(hiddenByte(observer,viewer).hidden, 1, 'the native appearance byte hides the viewer model/minimap');
    assert.ok(observer.nativePackets.length, 'the real observer session flushed native packets');
  }
  assert.equal(viewer.connection.getPlayerAppearance(viewer).hidden, true, 'initial appearance producer shares the generic visibility state');
  await wire(viewer, Buffer.from([VIEW_CLOSE_PACKET])); restoredViewer(viewer,game,origin);
  // Stay in range: this checks the appearance dirty/cache path, not a re-entry cache miss.
  viewer.moveTo(game.area.tile(32,32,0)); tick(3);
  const before = hiddenByte(a,viewer); assert.equal(before.hidden,0);
  viewer.setAppearanceHidden(true);
  const changed = hiddenByte(a,viewer); assert.equal(changed.hidden,1); assert.notEqual(changed.payload,before.payload);
  viewer.setAppearanceHidden(false); assert.equal(hiddenByte(a,viewer).hidden,0);
  tick();
});

test('viewer restores nondefault prior target, fixed radius, hidden and untargetable state', async () => {
  const { a,viewer,game } = await viewerGame();
  await openView(viewer,game); await wire(viewer,Buffer.from([VIEW_CLOSE_PACKET]));
  viewer.setAppearanceHidden(true); viewer.setUntargetable(true); viewer.setFixedViewDistance(23);
  const previous = { player:a.getIndex() }; viewer.getPacketSender().sendCameraTarget(previous);
  const origin = await openView(viewer,game);
  previous.player = 2047; // the generic state snapshot must not alias the caller's object.
  await wire(viewer,Buffer.from([VIEW_CLOSE_PACKET]));
  assert.equal(viewer.isAppearanceHidden(),true); assert.equal(viewer.isUntargetable(),true);
  assert.equal(viewer.getFixedViewDistance(),23); assert.equal(viewer.getMovementQueue().isMovementBlocked(),false);
  assert.deepEqual(viewer.getPacketSender().getCameraState(),{mode:'target',target:{player:a.getIndex()}});
  assert.deepEqual(position(viewer),[origin.getX(),origin.getY(),origin.getZ()]);
});

for (const departure of ['replacement','rejoin','channel leave','disconnect','finish']) {
  test(`viewing cleanup restores state before ${departure}`, async () => {
    const { viewer,game } = await viewerGame(); const origin = await openView(viewer,game);
    const coins = new core.Item(995,77,{qa:'viewer-preserve'}); viewer.getInventory().add(coins,false);
    if (departure === 'replacement') {
      viewer.getPacketSender().sendInterface(C.group('clanwars_setup')); tick(3);
      restoredViewer(viewer,game,origin);
      assert.equal(viewer.getInterfaceId(),C.group('clanwars_setup'),'view cleanup cannot close a replacement owner');
    } else if (departure === 'rejoin') {
      // The production jail return consumer must also safely handle forced entry while viewing.
      assert.equal(game.rejoin(viewer),false,'LTS still refuses a jail return'); tick(2);
      restoredViewer(viewer,game,origin);
    } else {
      if (departure === 'channel leave') FC.leave(viewer,false);
      else if (departure === 'disconnect') PM.emitPlayerDisconnect({player:viewer,username:viewer.getUsername(),source:'viewer-test'});
      else game.finish(null);
      tick(2); lobby(viewer);
      assert.equal(viewingUnit().active.has(viewer),false);
      assert.equal(viewer.isAppearanceHidden(),false); assert.equal(viewer.isUntargetable(),false);
      assert.equal(viewer.getMovementQueue().isMovementBlocked(),false); assert.equal(viewer.getFixedViewDistance(),null);
      assert.deepEqual(viewer.getPacketSender().getCameraState(),{mode:'follow'});
    }
    assert.equal(viewer.getInventory().getAmount(995),77);
    assert.deepEqual(viewer.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'viewer-preserve'});
  });
}

test('respawning viewer can close and use the actual jail Portal Exit to fight again', async () => {
  const { a,viewer,b,game } = await viewerGame(1); const scores = game.kills.slice();
  await openView(viewer,game); await wire(viewer,Buffer.from([VIEW_CLOSE_PACKET]));
  await jailExit(viewer,game,40);
  assert.equal(game.fighters.has(viewer),true); assert.equal(game.jailed.has(viewer),false);
  assert.equal(viewer.isAppearanceHidden(),false); assert.equal(viewer.isUntargetable(),false);
  assert.equal(viewer.getMovementQueue().isMovementBlocked(),false);
  assert.equal(game.area.canAttack(viewer,b,CombatFactory.MELEE_COMBAT),true);
  assert.deepEqual(game.kills,scores,'view/return is not another death or kill');
  assert.equal(game.members.has(a),true);
});

test('viewer queued death retains safe ownership and death-task movement/targetability locks', async () => {
  const { viewer,b,game } = await viewerGame(1); await openView(viewer,game);
  for (const id of [4151,1127,1079,1163,1201,995]) viewer.getInventory().add(new core.Item(id,id===995?77:1,{qa:`view-death-${id}`}),false);
  const before = viewer.getInventory().getValidItems().map(i=>({id:i.getId(),n:i.getAmount(),meta:structuredClone(i.getMeta())}));
  const scores = game.kills.slice(); viewer.getCombat().addDamage(b,10); viewer.setHitpoints(0);
  tick();
  assert.equal(viewingUnit().active.has(viewer),false);
  assert.equal(Match.dying.has(viewer),true,'real jailed/viewing death receives independent safe ownership');
  assert.equal(viewer.getMovementQueue().isMovementBlocked(),true,'core death task owns its movement lock');
  assert.equal(viewer.isUntargetable(),true,'core death task owns targetability until respawn');
  tick(5);
  assert.deepEqual(viewer.getInventory().getValidItems().map(i=>({id:i.getId(),n:i.getAmount(),meta:structuredClone(i.getMeta())})),before);
  assert.deepEqual(game.kills,scores,'a nonfighter death cannot earn an invented kill');
  assert.equal(game.jailed.has(viewer),true); assert.equal(viewer.isAppearanceHidden(),false);
  assert.equal(Match.dying.has(viewer),false); assert.equal(viewer.isUntargetable(),false);
  assert.equal(viewer.getMovementQueue().isMovementBlocked(),false);
});

test('native orb refuses an active camera scene and invalid viewing controls cannot move an admitted viewer', async () => {
  const { viewer,game } = await viewerGame();
  await openView(viewer,game); await wire(viewer,Buffer.from([VIEW_CLOSE_PACKET]));
  viewer.getPacketSender().sendCameraMoveTo(viewer.getLocation().getX(),viewer.getLocation().getY(),300,false);
  const messages = [], original = viewer.sendMessage;
  viewer.sendMessage = function(message) { messages.push(message); return original.call(this,message); };
  await openView(viewer,game,false);
  assert.notEqual(viewer.getInterfaceId(),C.group('clanwars_view'));
  assert.equal(viewingUnit().active.has(viewer),false);
  assert.deepEqual(viewer.getPacketSender().getCameraState(),{mode:'controlled'},'refusal preserves the existing cinematic');
  assert.ok(messages.some(message=>message.includes('Finish your current camera scene')));
  viewer.getPacketSender().sendCameraReset();
  viewer.getPacketSender().sendCameraTarget({ x:viewer.getLocation().getX(), y:viewer.getLocation().getY(), level:viewer.getLocation().getZ(), cycles:50 });
  messages.length = 0;
  const beforeGlide = position(viewer);
  await openView(viewer,game,false);
  assert.notEqual(viewer.getInterfaceId(),C.group('clanwars_view'));
  assert.equal(viewingUnit().active.has(viewer),false);
  assert.deepEqual(position(viewer),beforeGlide,'refusal does not relocate an interpolating camera target');
  assert.deepEqual(viewer.getPacketSender().getCameraState(),{mode:'controlled'});
  assert.ok(messages.some(message=>message.includes('Finish your current camera scene')));
  viewer.getPacketSender().sendCameraReset();
  await openView(viewer,game);
  const before = position(viewer), camera = viewer.getPacketSender().getCameraState();
  await click(viewer,'clanwars_view:sw',2);
  await click(viewer,'clanwars_view:com_1');
  assert.deepEqual(position(viewer),before); assert.deepEqual(viewer.getPacketSender().getCameraState(),camera);
});

test('viewing admission and native visibility remain isolated to jailed members of the owning match', async () => {
  const { a,viewer,game } = await viewerGame(); await openView(viewer,game);
  const object = mappedOrb(a,game), at = object.getLocation();
  a.moveTo(at.transform(0,game.members.get(a)===0?-1:1)); tick(2);
  const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
  new ObjectActionPacketListener().executeAction(a,object.getId(),at.getX(),at.getY(),1); tick(4);
  assert.notEqual(a.getInterfaceId(),C.group('clanwars_view'),'a living fighter cannot become a viewer');
  assert.equal(game.fighters.has(a),true); assert.equal(viewingUnit().active.has(a),false);
  const other = await viewerGame(); await openView(other.viewer,other.game);
  assert.notEqual(other.game.area,game.area);
  assert.equal(viewingUnit().active.get(viewer).game,game);
  assert.equal(viewingUnit().active.get(other.viewer).game,other.game);
  // Explicit overlapping-coordinate checkpoint isolates the real private-area filter.
  // This does not claim that independent instances naturally occupy the same tile.
  const previous = other.a.getLocation().clone();
  other.a.setLocation(viewer.getLocation().clone()); other.a.setNeedsPlacement(false);
  core.World.rebuildUpdateBuckets(); core.World.updateLocalPlayers(viewer);
  assert.equal(viewer.getLocalPlayers().includes(other.a),false,'viewer cannot receive a different match at an overlapping coordinate');
  other.a.setLocation(previous); tick(2);
  const before = position(a); await click(a,'clanwars_view:ne');
  assert.deepEqual(position(a),before,'another actor cannot reuse the viewer interface authority');
});

test('a native Attack request while viewing cannot turn the jailed viewer into a fighter', async () => {
  const { viewer,b,game } = await viewerGame(); const origin = await openView(viewer,game);
  b.moveTo(game.area.tile(33,32,0)); tick(2);
  const frame = Buffer.alloc(4); frame[0]=44; frame[1]=128; frame.writeUInt16BE(b.getIndex(),2);
  await wire(viewer,frame);
  assert.equal(viewer.getCombat().getTarget(),null,'the real player-option listener cannot begin spectator combat');
  assert.equal(game.fighters.has(viewer),false); assert.equal(game.jailed.has(viewer),true);
  if (viewingUnit().active.has(viewer)) await wire(viewer,Buffer.from([VIEW_CLOSE_PACKET]));
  restoredViewer(viewer,game,origin);
});


test('native orb remains usable after real all-axis stop-shakes and restores its prior target', async () => {
  const { a,viewer,game } = await viewerGame();
  const CameraShake = require('../plugins/interface/CameraShake.plugin');
  viewer.getPacketSender().sendCameraTarget({player:a.getIndex()});
  // The actual quest cleanup producer stops all five additive shake axes.
  for (let axis=0;axis<5;axis++) {
    CameraShake.send(viewer.getPacketSender(),'atmospheric',axis,5,3,8);
    CameraShake.send(viewer.getPacketSender(),'atmospheric',axis,0);
  }
  const origin = await openView(viewer,game);
  await wire(viewer,Buffer.from([VIEW_CLOSE_PACKET]));
  assert.deepEqual(position(viewer),[origin.getX(),origin.getY(),origin.getZ()]);
  assert.deepEqual(viewer.getPacketSender().getCameraState(),{mode:'target',target:{player:a.getIndex()}});
  assert.equal(viewer.isAppearanceHidden(),false);
});

test('native orb remains usable after scripted pitch unlock is released', async () => {
  const { viewer,game } = await viewerGame();
  viewer.getPacketSender().sendCameraUnlock(true).sendCameraUnlock(false);
  const origin = await openView(viewer,game);
  await wire(viewer,Buffer.from([VIEW_CLOSE_PACKET]));
  restoredViewer(viewer,game,origin);
});

test('additive shakes do not block viewing or erase an actual controlled camera scene', async () => {
  const { viewer,game } = await viewerGame();
  const CameraShake = require('../plugins/interface/CameraShake.plugin');
  CameraShake.send(viewer.getPacketSender(),'barrows',0,5,2,8);
  const origin = await openView(viewer,game);
  await wire(viewer,Buffer.from([VIEW_CLOSE_PACKET]));
  restoredViewer(viewer,game,origin);
  const at = viewer.getLocation();
  viewer.getPacketSender().sendCameraMoveTo(at.getX(),at.getY(),300,false);
  CameraShake.send(viewer.getPacketSender(),'atmospheric',0,0);
  viewer.getPacketSender().sendCameraUnlock(false);
  await openView(viewer,game,false);
  assert.notEqual(viewer.getInterfaceId(),C.group('clanwars_view'));
  assert.equal(viewingUnit().active.has(viewer),false);
  assert.deepEqual(viewer.getPacketSender().getCameraState(),{mode:'controlled'},'ending modifiers cannot relinquish a real scripted shot');
});

// Restriction cases use the real consumable, prayer/quick-prayer and special
// producers. Scene placement, levels and a nonlethal passive-item hit are supplied.
const NEGOTIATED_RULE_CHOICES = { food:[1], drinks:[1], prayer:[1,2], specialattacks:[2], leavingcc:[1], rejoiningdelay:[1] };
const STANDARD_PRAYER_ENUM = 4956; // Rev242 script7823, standard prayer book.
const PRAYER_COMPONENT_PARAM = 1751; // Rev242 quickprayer_init reads the prayer's component.
function ruleStats(player, hitpoints = 50) {
  for (const name of ['ATTACK','STRENGTH','DEFENCE','RANGED','MAGIC','PRAYER','HITPOINTS']) {
    player.getSkillManager().setMaxLevels(core.Skill[name],99,false);
    player.getSkillManager().setCurrentLevel(core.Skill[name],99,false);
  }
  player.setHitpoints(hitpoints); player.setSpecialPercentage(100);
}
function contents(container) {
  return container.getItems().map(item=>item ? {id:item.getId(),n:item.getAmount(),meta:structuredClone(item.getMeta())} : null);
}
function resources(player) {
  const { TimerKey } = require('../dist/util/timers/TimerKey');
  return { inventory:contents(player.getInventory()), equipment:contents(player.getEquipment()),
    levels:['ATTACK','STRENGTH','DEFENCE','RANGED','MAGIC','PRAYER','HITPOINTS'].map(name=>player.getSkillManager().getCurrentLevel(core.Skill[name])),
    special:player.getSpecialPercentage(),
    timers:[TimerKey.FOOD,TimerKey.POTION,TimerKey.KARAMBWAN].map(key=>player.getTimers().getTicks(key)) };
}
function messagesOf(player) {
  const lines=[],send=player.sendMessage;
  player.sendMessage=function(message) { lines.push(message); return send.call(this,message); };
  return lines;
}
async function nativeButton(player, component, op = 1, slot = 65535, itemId = 65535) {
  const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
  const uid=typeof component==='number' ? component : C.uid(component);
  const frame=Buffer.alloc(9); frame[0]=ClientPacketId[`IF_BUTTON${op}`];
  assert.ok(frame[0] > 0,'the native operation exists');
  frame.writeInt32BE(uid,1); frame.writeUInt16BE(slot,5); frame.writeUInt16BE(itemId,7);
  await wire(player,frame);
}
async function nativeItem(player, itemId, option) {
  const { MAIN_INVENTORY_WIDGET_UID } = require('../dist/net/protocol/ClientProtocol');
  const slot=player.getInventory().getItems().findIndex(item=>item?.getId()===itemId);
  assert.ok(slot>=0,'the real carried item occupies its clicked slot');
  const index=core.CacheDefinitions.getItem(itemId).inventoryActions.indexOf(option);
  assert.ok(index>=0,`the active cache item offers ${option}`);
  // Cache7779/enum4303: inventory actions1..5 transmit widgetops2,3,4,6,7.
  await nativeButton(player,MAIN_INVENTORY_WIDGET_UID,[2,3,4,6,7][index],slot,itemId);
}
function give(player,itemId,tag) {
  const before=player.getInventory().getAmount(itemId);
  player.getInventory().add(new core.Item(itemId,1,{qa:tag}),false);
  assert.equal(player.getInventory().getAmount(itemId),before+1,'supplied real inventory setup succeeded');
}
async function ruleGame(restrictions,beforeEntry=null) {
  const a=actor(true),b=actor(true); ruleStats(a); ruleStats(b); channel(a); channel(b);
  const game=await negotiate(a,b,2,1,restrictions);
  if (beforeEntry) await beforeEntry(a,b,game);
  await join(a); await join(b); core.World.processCycle=game.starts-1; tick();
  assert.equal(game.phase,'combat');
  return {a,b,game};
}
async function endRuleGame(game,a,b) {
  game.finish(null); tick(2); lobby(a); lobby(b);
  await wire(a,Buffer.from([VIEW_CLOSE_PACKET])); await wire(b,Buffer.from([VIEW_CLOSE_PACKET]));
}
function prayerWidget(prayerId) {
  const found=[];
  for (let index=1;index<=core.PrayerData.prayerData.size;index++) {
    const uid=core.CacheDefinitions.getComponentId(`prayerbook:prayer${index}`);
    if (uid!=null && core.PrayerHandler.prayerIdForChild(uid&65535)===prayerId) found.push(uid);
  }
  assert.equal(found.length,1,'one actual cache prayer widget maps to this production prayer');
  return found[0];
}
async function selectQuick(player,prayerIds) {
  await nativeButton(player,'orbs:prayerbutton',2);
  for (const prayerId of prayerIds) {
    const uid=prayerWidget(prayerId);
    const entries=[...core.CacheDefinitions.getEnumValues(STANDARD_PRAYER_ENUM)]
      .filter(([,obj])=>Number(core.CacheDefinitions.getItem(Number(obj)).params?.get(PRAYER_COMPONENT_PARAM))===uid);
    assert.equal(entries.length,1,'active quick-prayer enum/obj param identifies the actual clickable slot');
    await nativeButton(player,'quickprayer:buttons',1,Number(entries[0][0]));
    assert.ok(player.getQuickPrayers().getPrayers()[prayerId],'real setup selected the intended prayer');
  }
  await nativeButton(player,'quickprayer:close');
}
async function wield(player,itemId,tag) {
  give(player,itemId,tag); await nativeItem(player,itemId,'Wield');
  assert.equal(player.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(),itemId);
  assert.ok(player.getCombatSpecial(),'ordinary equip bound the registered weapon special');
}

for (const [key,values] of Object.entries(NEGOTIATED_RULE_CHOICES)) {
  test(`native ${key} negotiation preserves every other term and revalidates both confirmations`,async()=>{
    const a=actor(true),b=actor(true); channel(a); channel(b); const calls=scriptCalls(a);
    await challenge(a,b); await challenge(b,a);
    await click(a,'clanwars_setup:wincondition',3); tick(9);
    await click(a,'clanwars_setup:dropdown_playercap',3); tick(9);
    const session=C.negotiations.get(a);
    const membership=['leavingcc','rejoiningdelay'].includes(key);
    if (membership) {
      for (const [other,value] of Object.entries({food:1,drinks:1,prayer:2,specialattacks:2,
        [key==='leavingcc'?'rejoiningdelay':'leavingcc']:1})) {
        await click(a,`clanwars_setup:dropdown_${other}`,value+1); tick(9);
      }
    }
    const preserved={...session.rules};
    for (const value of [...values,0,values.at(-1)]) {
      await click(b,'clanwars_setup:accept'); assert.equal(session.accepted.has(b),true);
      await click(a,`clanwars_setup:dropdown_${key}`,value+1);
      assert.equal(session.rules[key],value,'native selected restriction reaches the authoritative offer');
      assert.equal(session.rules.playercap,2); assert.equal(session.rules.wincondition,1);
      for (const [other,value] of Object.entries(preserved)) if (other!==key) assert.equal(session.rules[other],value,other);
      assert.equal(session.accepted.size,0,'changed restriction invalidates both prior acceptances');
      await click(b,'clanwars_setup:accept'); assert.equal(session.accepted.has(b),false,'opponent change delay is enforced');
      tick(9);
    }
    await click(a,'clanwars_setup:wincondition',16*3); tick(9);
    await click(a,'clanwars_setup:dropdown_playercap',4); tick(9);
    assert.equal(session.rules[key],values.at(-1),'mode/cap changes preserve negotiated restrictions');
    const revision=session.revision;
    await click(b,'clanwars_setup:accept'); await click(a,`clanwars_setup:dropdown_${key}`,values.at(-1)+1);
    assert.equal(session.revision,revision); assert.equal(session.accepted.has(b),true,'same selection is a no-op');
    await click(a,'clanwars_setup:dropdown_specialattacks',4);
    assert.equal(session.rules.specialattacks,key==='specialattacks'||membership?2:0,'unsupported special-attack choice cannot change terms');
    assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_specialattacks')),session.rules.specialattacks);
    await click(a,'clanwars_setup:accept'); assert.equal(session.stage,'confirm');
    const agreed={...session.rules}; await click(a,`clanwars_setup:dropdown_${key}`,1);
    assert.deepEqual(session.rules,agreed,'stale setup packets cannot mutate a confirmation');
    tick(5); await click(a,'clanwars_confirm:button'); await click(b,'clanwars_confirm:button');
    const game=C.channelGames.get(C.channel(a).key); assert.ok(game); assert.deepEqual(game.rules,agreed);
    assert.equal(Object.isFrozen(game.rules),true);
    await join(a); await join(b);
    const summary=calls.filter(([id])=>id===554).at(-1)[2];
    assert.match(summary,key==='prayer'? /Prayers .*disabled/ : key==='specialattacks'? /Melee special attacks: disabled/
      : key==='leavingcc'? /Leaving the chat-channel incurs no death penalty/
        : key==='rejoiningdelay'? /60-second wait/ : new RegExp(`${key==='food'?'Food':'Drinks'}: disabled`));
    assert.match(summary,/Most kills in 5 minutes/); assert.match(summary,/10 v 10/);
    if (membership) assert.doesNotMatch(summary,/rejoining is unrestricted/,'delayed confirmation cannot promise an unrestricted return');
  });
}

test('native No Food refuses before inventory, healing and timers change and ends on departure',async()=>{
  const {a,b,game}=await ruleGame({food:1}); const I=core.ItemIdentifiers,lines=messagesOf(a);
  give(a,I.APPLE_PIE,'no-food-pie'); const before=resources(a);
  await nativeItem(a,I.APPLE_PIE,'Eat'); assert.deepEqual(resources(a),before); assert.ok(lines.some(line=>line.includes('cannot eat')));
  const outside=actor(true); ruleStats(outside); give(outside,I.APPLE_PIE,'outside-pie');
  await nativeItem(outside,I.APPLE_PIE,'Eat'); assert.equal(outside.getInventory().contains(I.HALF_AN_APPLE_PIE),true,'unrelated player still eats normally');
  await endRuleGame(game,a,b); assert.equal(a.getHitpoints(),99,'leaving restores Hitpoints at Ferox');
  a.setHitpoints(50); await nativeItem(a,I.APPLE_PIE,'Eat');
  assert.equal(a.getHitpoints(),57); const half=a.getInventory().getValidItems().find(item=>item.getId()===I.HALF_AN_APPLE_PIE);
  assert.ok(half); assert.deepEqual(half.getMeta(),{qa:'no-food-pie'});
});

test('native No Drinks preserves dose metadata, stats and cooldown and ends on departure',async()=>{
  const {a,b,game}=await ruleGame({drinks:1}); const I=core.ItemIdentifiers,lines=messagesOf(a);
  a.getSkillManager().setCurrentLevel(core.Skill.ATTACK,30,false); give(a,I.ATTACK_POTION_4_,'no-drinks-dose');
  const before=resources(a); await nativeItem(a,I.ATTACK_POTION_4_,'Drink');
  assert.deepEqual(resources(a),before); assert.ok(lines.some(line=>line.includes('cannot use potions')));
  await endRuleGame(game,a,b); await nativeItem(a,I.ATTACK_POTION_4_,'Drink');
  const dose=a.getInventory().getValidItems().find(item=>item.getId()===I.ATTACK_POTION_3_);
  assert.ok(dose); assert.deepEqual(dose.getMeta(),{qa:'no-drinks-dose'});
  assert.ok(a.getSkillManager().getCurrentLevel(core.Skill.ATTACK)>30);
});

for (const restrictions of [{food:1},{drinks:1},{food:1,drinks:1}]) {
  test(`canonical Food-owned Drink honors ${JSON.stringify(restrictions)} without reclassifying its producer`,async()=>{
    const {a,b,game}=await ruleGame(restrictions); const I=core.ItemIdentifiers;
    give(a,I.CUP_OF_TEA,'food-owned-drink');
    assert.equal(require('../plugins/items/Food.plugin').foodBite(I.CUP_OF_TEA).food.option,'Drink');
    const before=resources(a); await nativeItem(a,I.CUP_OF_TEA,'Drink'); assert.deepEqual(resources(a),before);
    if (!restrictions.food) {
      give(b,I.APPLE_PIE,'food-allowed'); await nativeItem(b,I.APPLE_PIE,'Eat');
      assert.equal(b.getInventory().contains(I.HALF_AN_APPLE_PIE),true,'No Drinks alone still permits ordinary food');
    }
    await endRuleGame(game,a,b); await nativeItem(a,I.CUP_OF_TEA,'Drink');
    assert.equal(a.getInventory().contains(I.CUP_OF_TEA),false); assert.equal(a.getInventory().contains(I.EMPTY_CUP),true);
    assert.deepEqual(a.getInventory().getValidItems().find(item=>item.getId()===I.EMPTY_CUP).getMeta(),{qa:'food-owned-drink'});
  });
}

test('No Food retains existing healing-drink permission while ordinary potions remain allowed',async()=>{
  const {a,b,game}=await ruleGame({food:1}); const I=core.ItemIdentifiers;
  for (const p of [a,b]) give(p,I.SARADOMIN_BREW_4_,'healing-drink');
  const before=resources(a); await nativeItem(a,I.SARADOMIN_BREW_4_,'Drink'); assert.deepEqual(resources(a),before);
  give(a,I.ATTACK_POTION_4_,'ordinary-potion'); await nativeItem(a,I.ATTACK_POTION_4_,'Drink');
  assert.equal(a.getInventory().contains(I.ATTACK_POTION_3_),true,'Food permission is not a blanket potion veto');
  await endRuleGame(game,a,b); const hp=b.getHitpoints(); await nativeItem(b,I.SARADOMIN_BREW_4_,'Drink');
  assert.ok(b.getHitpoints()>hp,'same real healing drink is valid after activity cleanup');
});

test('negotiated consumption rules preserve the existing passive phoenix-necklace producer',async()=>{
  const {a,game}=await ruleGame({food:1,drinks:1}); const I=core.ItemIdentifiers;
  a.getEquipment().setItem(core.Equipment.AMULET_SLOT,new core.Item(I.PHOENIX_NECKLACE,1,{qa:'passive'}));
  a.setHitpoints(20); assert.equal(a.getEquipment().get(core.Equipment.AMULET_SLOT).getDefinition().getName(),'Phoenix necklace');
  // Supplied nonlethal damage through the actual core health/event producer, no synthetic event.
  a.decrementHealth(new core.HitDamage(1,core.HitMask.RED));
  assert.equal(a.getEquipment().contains(I.PHOENIX_NECKLACE),false,'the existing one-use passive effect still consumes its own item');
  assert.equal(a.getHitpoints(),48); assert.equal(game.fighters.has(a),true); assert.deepEqual(game.kills,[0,0]);
});

test('No Overheads clears pre-active icons and refuses native normal and quick prayers while allowing boosts',async()=>{
  const P=core.PrayerHandler;
  const {a,b,game}=await ruleGame({prayer:1},async player=>{
    await selectQuick(player,[P.THICK_SKIN,P.PROTECT_FROM_MELEE]);
    await nativeButton(player,prayerWidget(P.THICK_SKIN)); await nativeButton(player,prayerWidget(P.PROTECT_FROM_MELEE));
    assert.equal(player.getPrayerActive()[P.THICK_SKIN],true); assert.equal(player.getPrayerActive()[P.PROTECT_FROM_MELEE],true);
  });
  assert.equal(a.getPrayerActive()[P.THICK_SKIN],true,'allowed pre-active boost survives entry');
  assert.equal(a.getPrayerActive()[P.PROTECT_FROM_MELEE],false,'forbidden pre-active overhead is cleared on real portal entry');
  const lines=messagesOf(a); await nativeButton(a,prayerWidget(P.PROTECT_FROM_MELEE));
  await nativeButton(a,'orbs:prayerbutton');
  assert.equal(a.getPrayerActive()[P.PROTECT_FROM_MELEE],false); assert.equal(a.getPrayerActive()[P.THICK_SKIN],true);
  assert.ok(lines.some(line=>line.includes('Overhead prayers are disabled')));
  await nativeButton(a,prayerWidget(P.THICK_SKIN)); assert.equal(a.getPrayerActive()[P.THICK_SKIN],false);
  await nativeButton(a,prayerWidget(P.THICK_SKIN)); assert.equal(a.getPrayerActive()[P.THICK_SKIN],true);
  await endRuleGame(game,a,b); await nativeButton(a,prayerWidget(P.PROTECT_FROM_MELEE));
  assert.equal(a.getPrayerActive()[P.PROTECT_FROM_MELEE],true,'prayer permission is released outside the activity');
});

test('No Prayer clears all pre-active prayers and refuses native activation and a saved quick preset',async()=>{
  const P=core.PrayerHandler;
  const {a}=await ruleGame({prayer:2},async player=>{
    await selectQuick(player,[P.THICK_SKIN]);
    await nativeButton(player,prayerWidget(P.THICK_SKIN)); await nativeButton(player,prayerWidget(P.PROTECT_FROM_MELEE));
    assert.equal(player.getPrayerActive()[P.THICK_SKIN],true); assert.equal(player.getPrayerActive()[P.PROTECT_FROM_MELEE],true);
  });
  assert.equal(a.getPrayerActive().some(Boolean),false);
  const before=resources(a),lines=messagesOf(a);
  await nativeButton(a,prayerWidget(P.THICK_SKIN)); await nativeButton(a,prayerWidget(P.PROTECT_FROM_MELEE));
  await nativeButton(a,'orbs:prayerbutton');
  assert.equal(a.getPrayerActive().some(Boolean),false); assert.deepEqual(resources(a),before);
  assert.ok(lines.some(line=>line.includes('Prayers are disabled')));
});

test('No Specials clears a pre-armed weapon and refuses native queued and utility specials without spending resources',async()=>{
  const I=core.ItemIdentifiers;
  const {a,b,game}=await ruleGame({specialattacks:2},async player=>{
    await wield(player,I.DRAGON_DAGGER,'queued-special');
    assert.equal(player.getCombatSpecial().getId(),'dragon_dagger');
    await nativeButton(player,'orbs:specbutton'); assert.equal(player.isSpecialActivated(),true);
  });
  assert.equal(a.isSpecialActivated(),false,'portal entry disarms a pre-armed special');
  let before=resources(a); const lines=messagesOf(a);
  await nativeButton(a,'orbs:specbutton'); assert.equal(a.isSpecialActivated(),false); assert.deepEqual(resources(a),before);
  a.setSpecialActivated(true);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),false,'production attack backstop refuses an injected armed special');
  a.setSpecialActivated(false); assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true,'ordinary melee remains allowed');
  await wield(a,I.DRAGON_BATTLEAXE,'utility-special'); assert.equal(a.getCombatSpecial().getId(),'dragon_battleaxe'); before=resources(a);
  await nativeButton(a,'orbs:specbutton'); assert.deepEqual(resources(a),before,'instant utility special cannot drain or boost through the rule');
  assert.ok(lines.some(line=>line.includes('Special attacks are disabled')));
  await endRuleGame(game,a,b); await nativeButton(a,'orbs:specbutton');
  assert.equal(a.getSpecialPercentage(),0); assert.ok(a.getSkillManager().getCurrentLevel(core.Skill.STRENGTH)>99);
  assert.ok(a.getSkillManager().getCurrentLevel(core.Skill.ATTACK)<99);
  assert.deepEqual(a.getEquipment().get(core.Equipment.WEAPON_SLOT).getMeta(),{qa:'utility-special'});
});

// Dispatch the real frame in this turn without wire()'s three following ticks.
// This isolates queued-death ordering and the precise return-eligibility tick.
async function dispatchFrameNow(player, frame) {
  const packets=decodeClientPackets(frame); assert.equal(packets.length,1);
  await player.connection.dispatch(packets); player.connection.processTurnPackets();
}
// ClientPackets.ts and the ordinary client encoder use this high-level opcode.
// ClientPacketId is a const enum, so compiled CommonJS cannot import its object.
const FRIENDS_CHAT_ACTION_PACKET=196;
function channelFrame(action, name='') {
  // ClientBinaryEncoder.encodeFriendsChatAction: production extended social packet,
  // not an OSRS-native social opcode. Ordinary native widgets/locs remain separate.
  const { CLIENT_PACKET_LENGTHS }=require('../dist/net/protocol/ClientPackets');
  assert.equal(CLIENT_PACKET_LENGTHS[FRIENDS_CHAT_ACTION_PACKET],-1,'actual compiled packet length table owns this variable-length opcode');
  const text=Buffer.from(name+'\0','latin1'), frame=Buffer.alloc(text.length+4);
  frame[0]=FRIENDS_CHAT_ACTION_PACKET; frame[1]=text.length+2;
  frame[2]=action==='leave'?1:0; text.copy(frame,3); frame[frame.length-1]=0;
  const decoded=decodeClientPackets(frame)[0];
  assert.equal(decoded.type,'friends_chat_action');
  assert.deepEqual(decoded.action,action==='leave'?{action}:{action,name});
  return frame;
}
function firstObjectFrame(portal, op) {
  const { ClientPacketId }=require('../dist/net/protocol/NativeClientPackets');
  assert.equal(op,1,'the mapped object is being used through its actual first native option');
  const at=portal.getLocation(),id=portal.getId(),frame=Buffer.alloc(8);
  frame[0]=ClientPacketId.OPLOC1;
  // MenuAction OPLOC1 -> PacketBuffer.writeShortAdd(x), writeShortAddLE(id).
  // Their actual byte order is [low+128,high] and [high,low+128] respectively.
  frame[1]=(at.getX()+128)&255; frame[2]=at.getX()>>8;
  frame.writeUInt16LE(at.getY(),3); frame[5]=0;
  frame[6]=id>>8; frame[7]=(id+128)&255;
  const decoded=decodeClientPackets(frame)[0];
  assert.deepEqual([decoded.type,decoded.id,decoded.x,decoded.y,decoded.clickType],
    ['object_option',id,at.getX(),at.getY(),1]);
  return frame;
}
async function membershipGame(mode, terms) {
  const a=actor(true),extra=actor(true),b=actor(true);
  for (const p of [a,extra,b]) ruleStats(p);
  channel(a,[extra]); channel(b);
  const game=await negotiate(a,b,2,mode,terms);
  await join(a); await join(extra); await join(b);
  core.World.processCycle=game.starts-1; tick();
  assert.equal(game.phase,'combat'); assert.equal(game.members.size,3);
  return {a,extra,b,game};
}
function carriedItems(player) {
  return player.getInventory().getValidItems().map(item=>
    ({id:item.getId(),amount:item.getAmount(),meta:structuredClone(item.getMeta())}));
}
function observeReturnChecks(game, player) {
  const checks=[],original=game.returnReady;
  game.returnReady=function(p) {
    const now=C.now(),result=original.call(this,p);
    if (p===player) checks.push({now,result});
    return result;
  };
  return checks;
}

for (const mode of [1,16]) {
  test(`native departure terms control living channel-leave credit without delaying initial entry in mode ${mode}`,async()=>{
    for (const leavingcc of [0,1]) {
      const {a,extra,b,game}=await membershipGame(mode,{leavingcc,rejoiningdelay:1});
      const side=game.members.get(extra); give(extra,core.ItemIdentifiers.SHARK,'departure-supplies');
      const before=carriedItems(extra);
      await wire(extra,channelFrame('leave'));
      assert.equal(C.channel(extra),null); assert.equal(C.matches.has(extra),false);
      const expected=[0,0]; expected[1-side]=leavingcc===0?1:0;
      assert.deepEqual(game.kills,expected);
      assert.equal(game.phase,'combat','another fighter keeps this roster alive');
      assert.equal(game.returnAt.has(extra.getLongUsername()),false,'living departure does not invent a death cooldown');
      assert.deepEqual(carriedItems(extra),before);
      await wire(extra,channelFrame('join',a.getUsername())); tick(2);
      assert.equal(C.channel(extra)?.key,C.channel(a).key);
      await join(extra); assert.equal(game.fighters.has(extra),true,'no initial or nondeath re-entry delay');
      assert.deepEqual(carriedItems(extra),before);
      game.finish(null); tick(2);
      await wire(a,Buffer.from([VIEW_CLOSE_PACKET])); await wire(b,Buffer.from([VIEW_CLOSE_PACKET]));
    }
  });
}

for (const leavingcc of [0,1]) {
  test(`real queued death and channel departure score exactly once with leavingcc ${leavingcc}`,async()=>{
    const {a,extra,b,game}=await membershipGame(1,{leavingcc,rejoiningdelay:1});
    const side=game.members.get(extra),key=extra.getLongUsername();
    for (const id of [4151,1127,1079,1163,1201,995]) {
      extra.getInventory().add(new core.Item(id,id===995?77:1,{qa:`membership-${id}`}),false);
    }
    const before=carriedItems(extra); assert.equal(before.length,6);
    await lethalMelee(b,extra,game,false);
    assert.equal(extra.isDyingReturn(),true); assert.equal(Match.dying.has(extra),false);
    await dispatchFrameNow(extra,channelFrame('leave'));
    assert.equal(C.matches.has(extra),false); assert.equal(game.members.has(extra),false);
    assert.equal(game.phase,'combat'); assert.equal(Match.dying.has(extra),true);
    assert.equal(game.kills[1-side],leavingcc===0?1:0,'only the selected departure policy has run');
    assert.equal(PM.emitShouldDropItemsOnDeath(extra,b),false);
    tick(); assert.equal(game.kills[1-side],1,'the actual captured-killer callback resolves a genuine kill once');
    assert.equal(Match.dying.get(extra).scoreResolved,true);
    tick(3); assert.equal(game.returnAt.has(key),false,'death animation has not reached the completed callback');
    tick(); const completed=C.now();
    assert.equal(Match.dying.has(extra),false);
    assert.equal(game.returnAt.get(key),completed+100,'completed death callback anchors the sourced minute');
    assert.equal(game.kills[1-side],1); assert.deepEqual(carriedItems(extra),before);
    assert.equal(extra.getPrivateArea(),null); assert.deepEqual(position(extra),C.RETURN);

    // A supplied replacement-player checkpoint proves canonical account identity,
    // not a full socket logout/login traversal.
    let entrant=extra;
    if (leavingcc===1) {
      PM.emitPlayerLogout({player:extra,username:extra.getUsername()});
      core.World.getPlayers().remove(extra); extra.setRegistered(false);
      actors.splice(actors.indexOf(extra),1); // retire this supplied actor from future fixture turns
      entrant=actor(true); entrant.setUsername(extra.getUsername()).setLongUsername(key);
    }
    await wire(entrant,channelFrame('join',a.getUsername())); tick(2);
    assert.equal(C.channel(entrant)?.key,C.channel(a).key);
    await join(entrant,false);
    const checks=observeReturnChecks(game,entrant);
    await click(entrant,'clanwars_confirm:button');
    assert.equal(C.matches.has(entrant),false,'lobby confirmation cannot bypass the same death cooldown');
    assert.ok(checks.some(check=>!check.result&&check.now<completed+100));
    assert.equal(game.returnAt.get(key),completed+100,'failed joins do not shorten or restart the deadline');
    const remaining=completed+100-C.now(); assert.ok(remaining>0); tick(remaining);
    await join(entrant); assert.equal(game.fighters.has(entrant),true);
    assert.equal(game.returnAt.has(key),false); assert.equal(game.kills[1-side],1);
    if (entrant===extra) assert.deepEqual(carriedItems(entrant),before);
    else assert.deepEqual(carriedItems(extra),before,'replacement checkpoint does not copy or reconstruct carried items');
  });
}

test('No penalty still removes the final channel member and completes empty-roster cleanup without a score',async()=>{
  const a=actor(true),b=actor(true); channel(a); channel(b);
  const game=await negotiate(a,b,1,1,{leavingcc:1,rejoiningdelay:1});
  await join(a); await join(b); core.World.processCycle=game.starts-1; tick();
  await wire(a,channelFrame('leave'));
  assert.deepEqual(game.kills,[0,0]); assert.equal(game.phase,'over');
  assert.equal(game.members.size,0); assert.equal(game.returnAt.size,0);
  assert.equal(C.matches.has(a),false); assert.equal(C.matches.has(b),false);
  assert.equal(C.channelGames.has(game.channelKeys[0]),false); assert.equal(C.channelGames.has(game.channelKeys[1]),false);
  lobby(a); lobby(b);
});

for (const mode of [1,16]) {
  test(`native jail Exit checks the real 99/100 tick boundary and ended callbacks cannot leak into a second match in mode ${mode}`,async()=>{
    const {a,extra,b,game}=await membershipGame(mode,{rejoiningdelay:1});
    const key=extra.getLongUsername(); give(extra,core.ItemIdentifiers.SHARK,'return-boundary');
    const before=carriedItems(extra);
    await lethalMelee(b,extra,game); tick(4);
    const completed=C.now(); assert.equal(game.returnAt.get(key),completed+100);
    assert.equal(game.jailed.has(extra),true); assert.equal(game.fighters.has(extra),false);
    const checks=observeReturnChecks(game,extra);
    const {portal,op}=await jailExit(extra,game);
    assert.ok(checks.some(check=>!check.result));
    assert.equal(game.jailed.has(extra),true); assert.equal(game.members.size,3,'jailed participant retains a cap slot');
    const frame=firstObjectFrame(portal,op),remaining=completed+98-C.now();
    assert.ok(remaining>0); tick(remaining);
    await dispatchFrameNow(extra,frame); tick();
    assert.deepEqual(checks.at(-1),{now:completed+99,result:false},'native object callback sees the real refusal tick');
    assert.equal(game.fighters.has(extra),false); assert.equal(game.returnAt.get(key),completed+100);
    await dispatchFrameNow(extra,frame); tick();
    assert.deepEqual(checks.at(-1),{now:completed+100,result:true},'native object callback admits exactly at expiry');
    assert.equal(game.fighters.has(extra),true); assert.equal(game.jailed.has(extra),false);
    assert.deepEqual(carriedItems(extra),before); assert.equal(game.returnAt.has(key),false);
    // Queue another genuine death, then end the match before its first callback.
    await lethalMelee(b,extra,game,false); game.finish(null);
    assert.equal(game.returnAt.size,0); assert.equal(Match.dying.has(extra),true);
    tick(6); assert.equal(Match.dying.has(extra),false);
    assert.equal(game.returnAt.size,0,'late completed callback cannot repopulate a closed game');
    assert.deepEqual(carriedItems(extra),before);
    for (const p of [a,extra,b]) await wire(p,Buffer.from([VIEW_CLOSE_PACKET]));
    const second=await negotiate(a,b,2,0,{rejoiningdelay:1});
    assert.notEqual(second,game); assert.equal(second.returnAt.size,0);
    await join(extra); assert.equal(second.fighters.has(extra),true,'fresh match has no old account deadline');
    await join(a); await join(b); core.World.processCycle=second.starts-1; tick();
    assert.equal(second.canJoin(),false,'delay option cannot reopen Last Team Standing entry');
  });
}

function varbitCalls(player) {
  const calls=[],sender=player.getPacketSender(),send=sender.sendVarbit;
  sender.sendVarbit=function(id,value) { calls.push([id,value]); return send.call(this,id,value); };
  return calls;
}
async function batchJoin(players,game) {
  const portal=challengePortal();
  assert.ok(['enter','join'].includes(portal.getDefinition().getInteractions()[0]?.toLowerCase()));
  // Twelve sequential 18-tick join helpers would overrun the real 200-tick prep.
  // Ordinary players instead open and confirm their real portals concurrently.
  for (const p of players) await dispatchFrameNow(p,firstObjectFrame(portal,1));
  tick(15);
  for (const p of players) assert.equal(p.getInterfaceId(),C.group('clanwars_confirm'));
  for (const p of players) await dispatchFrameNow(p,clickFrame('clanwars_confirm:button'));
  tick(3);
  for (const p of players) {
    assert.equal(C.matches.get(p),game); assert.equal(p.getPrivateArea(),game.area);
    assert.equal(game.fighters.has(p),true);
  }
  assert.equal(game.phase,'staging'); assert.ok(C.now()<game.starts,'all entries completed within unchanged preparation');
}
async function stragglerGame(perSide,stragglers,cap=3,terms={},arena=1) {
  const teams=[Array.from({length:perSide},()=>actor(true)),Array.from({length:perSide},()=>actor(true))];
  for (const p of teams.flat()) ruleStats(p);
  const a=teams[0][0],b=teams[1][0];channel(a,teams[0].slice(1));channel(b,teams[1].slice(1));
  const game=await negotiate(a,b,cap,0,{...terms,stragglers},arena);
  await batchJoin(teams.flat(),game);
  for (let side=0;side<2;side++) {
    assert.equal([...game.members.values()].filter(value=>value===side).length,perSide);
    assert.equal([...game.fighters.values()].filter(value=>value===side).length,perSide);
  }
  return {a,b,teams,players:teams.flat(),game};
}
function completePreparation(game) {
  const remaining=game.starts-C.now();assert.ok(remaining>0);tick(remaining-1);
  assert.equal(game.phase,'staging','small teams never end during preparation');assert.ok(game.walls.length>0);
  tick();assert.equal(game.walls.length,0,'the ordinary combat-start wall removal ran');
}
function finishedMatch(game,players) {
  assert.equal(game.phase,'over');assert.equal(Match.active.has(game),false);
  assert.equal(game.task.isRunning(),false);assert.equal(game.area.isDestroyed(),true);
  assert.equal(game.members.size,0);assert.equal(game.fighters.size,0);assert.equal(game.jailed.size,0);
  assert.equal(game.viewers.size,0);assert.equal(game.returnAt.size,0);
  for (const key of game.channelKeys) assert.equal(C.channelGames.has(key),false);
  for (const p of players) {
    lobby(p);assert.equal(viewingUnit().active.has(p),false);assert.equal(p.getAttribute(C.IN_MATCH_ATTRIBUTE),false);
    for (const name of ['clanwars_myteam','clanwars_countdown','clanwars_timeremaining','clanwars_players_1','clanwars_players_2','clanwars_kills_1','clanwars_kills_2']) {
      assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(name)),0,name);
    }
  }
}

test('native stragglers rows preserve terms, refuse incompatible modes in both directions and explain the LTS delay cutoff',async()=>{
  const a=actor(true),b=actor(true),member=actor(true);channel(a,[member]);channel(b);
  const scripts=scriptCalls(a),memberScripts=scriptCalls(member),writes=varbitCalls(a);
  await challenge(a,b);await challenge(b,a);
  await click(a,'clanwars_setup:dropdown_playercap',4);tick(9);
  for (const [name,value] of Object.entries({food:1,drinks:1,prayer:2,specialattacks:2,leavingcc:1,rejoiningdelay:1})) {
    await click(a,`clanwars_setup:dropdown_${name}`,value+1);tick(9);
  }
  const session=C.negotiations.get(a),preserved={...session.rules};
  for (const value of [1,0,1]) {
    await click(b,'clanwars_setup:accept');assert.equal(session.accepted.has(b),true);
    await click(a,'clanwars_setup:stragglers',value*3);
    assert.equal(session.rules.stragglers,value,'native stragglers selection reaches the authoritative offer');
    for (const [name,term] of Object.entries(preserved)) if (name!=='stragglers') assert.equal(session.rules[name],term,name);
    assert.equal(session.accepted.size,0);await click(b,'clanwars_setup:accept');
    assert.equal(session.accepted.has(b),false,'ordinary opponent-change delay still applies');tick(9);
  }
  await click(b,'clanwars_setup:accept');const revision=session.revision;
  await click(a,'clanwars_setup:stragglers',3);
  assert.equal(session.revision,revision);assert.equal(session.accepted.has(b),true,'duplicate choice is a no-op');
  const winBit=core.CacheDefinitions.getVarbitId('clanwars_wincondition');
  const stragglerBit=core.CacheDefinitions.getVarbitId('clanwars_stragglers');
  writes.length=0;await click(a,'clanwars_setup:wincondition',3);
  assert.equal(session.rules.wincondition,0);assert.equal(session.rules.stragglers,1);
  assert.equal(session.revision,revision);assert.equal(session.accepted.has(b),true);
  assert.ok(writes.some(([id,value])=>id===winBit&&value===0),'actual sender resyncs the refused optimistic mode');
  assert.ok(writes.some(([id,value])=>id===stragglerBit&&value===1));
  await click(a,'clanwars_setup:stragglers',0);tick(9);
  await click(a,'clanwars_setup:wincondition',16*3);tick(9);
  await click(b,'clanwars_setup:accept');const timedRevision=session.revision;
  writes.length=0;await click(a,'clanwars_setup:stragglers',3);
  assert.equal(session.rules.wincondition,16);assert.equal(session.rules.stragglers,0);
  assert.equal(session.revision,timedRevision);assert.equal(session.accepted.has(b),true);
  assert.ok(writes.some(([id,value])=>id===stragglerBit&&value===0),'actual sender resets an incompatible stragglers choice');
  await click(a,'clanwars_setup:wincondition',0);tick(9);
  await click(a,'clanwars_setup:stragglers',3);tick(9);
  await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');
  assert.equal(session.stage,'confirm');const agreed={...session.rules};
  await click(a,'clanwars_setup:stragglers',0);assert.deepEqual(session.rules,agreed,'stale setup input cannot rewrite confirmation');
  const summary=scripts.filter(([id])=>id===554).at(-1)[2];
  assert.match(summary,/Ignore 5.*five or fewer/);assert.match(summary,/60-second rejoining delay cannot reopen entry/);
  assert.doesNotMatch(summary,/returning to this battle requires a 60-second wait/);
  tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');
  const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.deepEqual(game.rules,agreed);
  await join(member,false);
  assert.equal(memberScripts.filter(([id])=>id===554).at(-1)[2],summary,'member sees the same frozen mode-aware terms');
  await click(member,'clanwars_confirm:button');assert.equal(C.matches.get(member),game);
  assert.equal(game.phase,'staging');
});

for (const stragglers of [0,1]) {
  test(`native six-versus-six real death leaves five fighters under stragglers ${stragglers}`,async()=>{
    const {a,b,teams,players,game}=await stragglerGame(6,stragglers);
    const results=scriptCalls(a),victim=teams[1][1];
    for (const id of [4151,1127,1079,1163,1201,995]) victim.getInventory().add(new core.Item(id,id===995?77:1,{qa:`stragglers-${id}`}),false);
    const before=carriedItems(victim);assert.equal(before.length,6);
    completePreparation(game);assert.equal(game.phase,'combat');
    await lethalMelee(a,victim,game);tick();
    assert.deepEqual(game.kills,[0,0],'the LTS condition does not invent kill-target credit');
    if (!stragglers) {
      assert.equal(game.phase,'combat','Kill all continues with five fighters on the defeated side');
      assert.equal([...game.fighters.values()].filter(side=>side===game.members.get(b)).length,5);
      tick(4);assert.equal(game.jailed.has(victim),true);assert.deepEqual(carriedItems(victim),before);
      game.finish(null);finishedMatch(game,players);
      return;
    }
    assert.equal(game.phase,'over','Ignore 5 ends at the actual five-versus-six boundary');
    assert.deepEqual(results.filter(([id])=>id===592).at(-1),[592,1,'Your team won the battle.']);
    assert.equal(Match.dying.has(victim),true,'finish retains the queued death owner');
    assert.equal(PM.emitShouldDropItemsOnDeath(victim,a),false);
    finishedMatch(game,players);tick(4);
    assert.equal(Match.dying.has(victim),false);assert.deepEqual(carriedItems(victim),before);
    for (const p of players) await wire(p,Buffer.from([VIEW_CLOSE_PACKET]));
    const second=await negotiate(a,b,3,1,{stragglers:0});
    await batchJoin(players,second);assert.notEqual(second,game);assert.notEqual(second.area,game.area);
    assert.deepEqual(carriedItems(victim),before,'second match does not reconstruct carried items');
  });
}

for (const [perSide,cap] of [[1,1],[5,2]]) {
  test(`Ignore 5 permits native ${perSide}v${perSide} caps and resolves both-small rosters only at combat start`,async()=>{
    const {a,players,game}=await stragglerGame(perSide,1,cap);const results=scriptCalls(a);
    completePreparation(game);
    assert.deepEqual(results.filter(([id])=>id===592).at(-1),[592,0,'The battle ended without a winner.']);
    finishedMatch(game,players);
  });
}

test('paired real lethal hits reaching five on both sides use a neutral snapshot and keep both queued deaths safe',async()=>{
  const {a,b,teams,players,game}=await stragglerGame(6,1);const results=scriptCalls(a);
  completePreparation(game);
  const victims=[teams[0][1],teams[1][1]],killers=[b,a];
  for (const [index,p] of victims.entries()) give(p,core.ItemIdentifiers.SHARK,`paired-stragglers-${index}`);
  const inventories=victims.map(carriedItems);
  // Supply adjacent combat placement, then bind both ordinary native Attack targets
  // before either pre-rolled real hit is enqueued. No death event is synthesized.
  for (const [index,victim] of victims.entries()) {
    const killer=killers[index];killer.moveTo(game.area.at([3293,4955+index*2,0]));victim.moveTo(game.area.at([3294,4955+index*2,0]));
    for (const p of [killer,victim]) {p.setNeedsPlacement(false);p.resetUpdating();AreaManager.process(p);}
    const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(victim.getIndex(),2);await wire(killer,frame);
    assert.equal(killer.getCombat().getTarget(),victim);
  }
  const { PendingHit }=require('../dist/game/content/combat/hit/PendingHit');
  const { HitQueue }=require('../dist/game/content/combat/hit/HitQueue');
  for (const [index,victim] of victims.entries()) CombatFactory.addPendingHit(new PendingHit(killers[index],victim,CombatFactory.MELEE_COMBAT,
    {damage:victim.getHitpoints(),rollAccuracy:false,handleAfterHitEffects:false,experience:false}));
  core.World.processCycle++;HitQueue.processAll(core.World.processCycle);
  for (const p of victims) assert.equal(p.getHitpoints(),0,'actual same-cycle hit queue starts a real death');
  tick();assert.equal(game.phase,'combat');tick();
  assert.deepEqual(results.filter(([id])=>id===592).at(-1),[592,0,'The battle ended without a winner.']);
  for (const p of victims) assert.equal(PM.emitShouldDropItemsOnDeath(p,null),false);
  finishedMatch(game,players);tick(4);
  for (const [index,p] of victims.entries()) {assert.equal(Match.dying.has(p),false);assert.deepEqual(carriedItems(p),inventories[index]);}
});

test('Ignore 5 finishes a No penalty departure without crediting a death',async()=>{
  const {a,teams,players,game}=await stragglerGame(6,1,3,{leavingcc:1});const results=scriptCalls(a);
  completePreparation(game);await wire(teams[1][1],channelFrame('leave'));
  assert.deepEqual(game.kills,[0,0]);assert.deepEqual(results.filter(([id])=>id===592).at(-1),[592,1,'Your team won the battle.']);
  finishedMatch(game,players);
});

test('Ignore 5 threshold finish restores an actual jailed viewing owner and releases the whole instance',async()=>{
  const {b,teams,players,game}=await stragglerGame(7,1);completePreparation(game);
  const viewer=teams[0][1];await lethalMelee(b,viewer,game);tick(4);
  assert.equal(game.phase,'combat');assert.equal(game.jailed.has(viewer),true);
  await openView(viewer,game);assert.equal(viewingUnit().active.get(viewer).game,game);
  viewer.nativePackets.length=0;
  await lethalMelee(b,teams[0][2],game);tick();
  finishedMatch(game,players);
  assert.equal(viewer.isAppearanceHidden(),false);assert.equal(viewer.getPacketSender().getCameraState().mode,'follow');
  const { encodeCameraReset }=require('../dist/net/protocol/ClientProtocol');
  assert.ok(viewer.nativePackets.some(frame=>frame.equals(encodeCameraReset())),'real threshold cleanup emitted a camera reset');
  tick(4);assert.equal(Match.dying.size,0);
});

// G: setup through ordinary packets; coordinates below are explicit TSPS choices.
const SYLVAN_LANDINGS = [[3424,5000,0],[3424,5048,0]];
const SYLVAN_JAILS = [[3423,5020,0],[3424,5027,0]];
function mappedLayoutObjects(game, gameval) {
  const id = core.CacheDefinitions.getLocId(gameval), objects = [];
  assert.ok(Number.isInteger(id), `active cache defines ${gameval}`);
  for (let x=0;x<game.area.widthChunks;x++) for (let y=0;y<game.area.heightChunks;y++) {
    objects.push(...game.area.getChunkObjects(0,x,y).filter(o => o.getId() === id));
  }
  return objects;
}
function layoutReachable(game, from, to, origin = [3392,4992]) {
  const queue=[from.slice(0,2)], seen=new Set([from.slice(0,2).join(',')]);
  for(let i=0;i<queue.length;i++) {
    const [x,y]=queue[i]; if(x===to[0] && y===to[1]) return true;
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) {
      if(!dx&&!dy) continue;
      const nx=x+dx,ny=y+dy,key=`${nx},${ny}`;
      if(nx<origin[0]||nx>=origin[0]+game.area.widthChunks*8||ny<origin[1]||ny>=origin[1]+game.area.heightChunks*8||seen.has(key)) continue;
      if(core.RegionManager.canMovestart(game.area.at([x,y,0]),game.area.at([nx,ny,0]),1,1,game.area)) {
        seen.add(key);queue.push([nx,ny]);
      }
    }
  } return false;
}
async function layoutObjectInput(player, game, gameval, sourceXY, action) {
  const object=mappedLayoutObjects(game,gameval).find(o => {
    const at=o.getLocation();
    return at.getX()===game.area.at([sourceXY[0],sourceXY[1],0]).getX()
      && at.getY()===game.area.at([sourceXY[0],sourceXY[1],0]).getY();
  });
  assert.ok(object, 'actual mapped owned object exists at observed source coordinate');
  assert.equal(object.getPrivateArea(),game.area);
  const {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
  assert.equal(MapObjects.getPrivateArea(player,object.getId(),object.getLocation()),object);
  const op=object.getDefinition().getInteractions().findIndex(x => x?.toLowerCase()===action.toLowerCase())+1;
  assert.ok(op>0);
  const {ObjectActionPacketListener}=require('../dist/net/packet/impl/ObjectActionPacketListener');
  const at=object.getLocation();
  new ObjectActionPacketListener().executeAction(player,object.getId(),at.getX(),at.getY(),op);
  tick(20);
  return object;
}

test('native Sylvan selection and Plateau reselection reset agreement and refuse other arena rows', async () => {
  const a=actor(),b=actor();channel(a);channel(b);
  await challenge(a,b);await challenge(b,a);
  await click(a,'clanwars_setup:accept');
  const s=C.negotiations.get(a);assert.equal(s.accepted.has(a),true);
  await click(b,'clanwars_setup:arena',6);
  assert.equal(s.rules.arena,2,'native Sylvan arena option is offered');
  assert.equal(s.accepted.size,0);assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(s.rules),/Sylvan Glade/);
  tick(9);await click(a,'clanwars_setup:accept');assert.equal(s.accepted.has(a),true);
  await click(b,'clanwars_setup:arena',3);assert.equal(s.rules.arena,1);assert.equal(s.accepted.size,0);
  for(const slot of [45,1,2,48,42,65535]) {
    await click(a,'clanwars_setup:arena',slot);assert.equal(s.rules.arena,1);
    assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_arena')),1);
  }
});

test('native Sylvan bridge mapping, both-end diagonal staging isolation and exact tree clip restoration', async () => {
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,0,null,2);
  await join(a);await join(b);
  for(const p of [a,b]) assert.deepEqual(position(p),positionAt(game,SYLVAN_LANDINGS[game.members.get(p)]));
  const reference=new core.TemplatedInstanceArea(8,8);
  try {
    for(let plane=0;plane<2;plane++) for(let x=0;x<8;x++) for(let y=0;y<8;y++) {
      reference.setChunk(plane,x,y,{sourceChunkX:424+x,sourceChunkY:624+y,sourcePlane:plane,rotation:0});
      assert.deepEqual(game.area.getChunk(plane,x,y),reference.getChunk(plane,x,y));
    }
    const baseline=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) baseline.push(reference.getClip(reference.tile(x,y,0)));
    const definition=core.CacheDefinitions.getObject(core.CacheDefinitions.getLocId('clanwars_barrier_elfwood'));
    assert.deepEqual([definition.sizeX,definition.sizeY],[1,1]);
    assert.ok(game.walls.length>0);assert.ok(game.walls.every(o=>o.getPrivateArea()===game.area&&o.getType()===10&&o.getFace()===0));
    assert.ok(game.walls.every(o=>(game.area.getClip(o.getLocation())&0x100)!==0),'native registration adds solid barrier clipping after the lazy grid exists');
    const stagedWalls=game.walls.slice(), {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
    for(const wall of stagedWalls) {
      assert.equal(MapObjects.getPrivateArea(a,wall.getId(),wall.getLocation()),wall,'native resolver sees the exact registered barrier');
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getPrivateArea()===game.area&&o.getId()===wall.getId()).length,1,'one runtime registration per barrier');
    }
    assert.equal(layoutReachable(game,SYLVAN_LANDINGS[0],SYLVAN_LANDINGS[1]),false,'all eight directions including both barrier ends refuse crossing');
    for(const side of [0,1]) assert.equal(layoutReachable(game,SYLVAN_JAILS[side],SYLVAN_LANDINGS[side]),false);
    for(const x of [3444,3445,3446,3450,3451]) assert.equal(game.walls.some(o=>o.getLocation().getX()===game.area.at([x,5023,0]).getX()),false,'mapped solid trees receive no overlay barrier');
    assert.equal(core.RegionManager.canMovestart(game.area.at([3392,5000,0]),game.area.at([3391,5000,0]),1,1,game.area),false,'unmapped footprint refuses exit');
    const walker=[a,b].find(p=>game.members.get(p)===0);
    const open=game.area.at([3425,5000,0]), across=game.area.at(SYLVAN_LANDINGS[1]);
    await wire(walker,walkClickFrame(open));
    assert.deepEqual(position(walker),[open.getX(),open.getY(),0],'ordinary decoded walk queues and reaches open tile');
    await wire(walker,walkClickFrame(across));tick(60);
    assert.equal(game.phase,'staging','walk checks fit within unchanged preparation');
    assert.ok(walker.getLocation().getY()<game.area.at([3424,5023,0]).getY(),'ordinary queued movement cannot cross staging wall');
    const before={position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()};
    core.World.processCycle=game.starts-1;tick();assert.equal(game.phase,'combat');assert.equal(game.walls.length,0);
    for(const wall of stagedWalls) {
      assert.equal(MapObjects.getPrivateArea(a,wall.getId(),wall.getLocation()),null,'removed barriers leave no native resolver entry');
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false,'removed runtime barrier identity is gone');
      assert.equal(game.area.getObjects().includes(wall),false,'area detaches the exact removed barrier');
    }
    const after=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) after.push(game.area.getClip(game.area.tile(x,y,0)));
    assert.deepEqual(after,baseline,'all4096 masks including directional/projectile/tree bits restored exactly');
    assert.equal(after[(5023-4992)*64+3414-3392],0x4020,'known directional/projectile fence bits survive');
    assert.equal(layoutReachable(game,SYLVAN_LANDINGS[0],SYLVAN_LANDINGS[1]),true);
    await wire(walker,walkClickFrame(across));tick(80);
    assert.deepEqual(position(walker),[across.getX(),across.getY(),0],'same native crossing reaches destination after barriers disappear');
    console.log('SYLVAN_MOVEMENT_QUALIFICATION '+JSON.stringify({staging:before,combat:{position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}}));
    const tree=game.area.at([3408,5020,0]);assert.equal(game.area.getClip(tree)&0x20100,0x20100,'mapped tree keeps walking and projectile obstruction');
    assert.equal(core.RegionManager.canMovestart(game.area.at([3407,5020,0]),tree,1,1,game.area),false);
    assert.equal(core.RegionManager.canProjectileAttackReturn(game.area.at([3407,5020,0]),game.area.at([3409,5020,0]),1,game.area),false,'actual native ray is occluded by copied tree');
    assert.equal(core.RegionManager.canProjectileAttackReturn(game.area.at([3424,5000,0]),game.area.at([3425,5000,0]),1,game.area),true,'open ray control remains visible');
  } finally {reference.destroy();assert.equal(reference.isDestroyed(),true);}
});
function walkClickFrame(at) {
  // Existing click-teleport fixture's literal MOVE_GAMECLICK encoding, plain click.
  const add=value=>[(value>>8)&255,((value&255)+128)&255];
  return Buffer.from([16,...add(at.getY()),0,...add(at.getX()),128,0]);
}
function positionAt(game, source) {const at=game.area.at(source);return [at.getX(),at.getY(),at.getZ()];}

for(const mode of [0,1,16]) test(`native Sylvan mode ${mode} retains combat restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},2);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);
  core.World.processCycle=game.starts-1;tick();assert.equal(game.phase,'combat');
  a.moveTo(game.area.at([3400,5020,0]));b.moveTo(game.area.at([3401,5020,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,SYLVAN_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of [0,1]) test(`native Sylvan side ${victimIndex} safe defeat, owned orb model and jail return`,async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);
  const game=await negotiate(a,b,null,1,null,2);await join(a);await join(b);
  core.World.processCycle=game.starts-1;tick();
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);
  victim.getInventory().add(new core.Item(995,77).setMeta({qa:'sylvan'}));
  await lethalMelee(killer,victim,game,true,[[3400,5020,0],[3401,5020,0]]);tick(6);
  assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,SYLVAN_JAILS[side]));
  assert.equal(victim.getInventory().getAmount(995),77);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'sylvan'});
  const scripts=scriptCalls(victim);
  const orbXY=side===0?[3423,5022]:[3424,5025];
  // Start at the actual completed death jail landing; native object routing owns approach.
  await layoutObjectInput(victim,game,'clanwars_viewing_start_elfwood',orbXY,'Use');
  assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));
  assert.equal(viewingUnit().active.has(victim),true);
  const approached=viewingUnit().active.get(victim).location, orbAt=game.area.at([...orbXY,0]);
  assert.ok(Math.max(Math.abs(approached.getX()-orbAt.getX()),Math.abs(approached.getY()-orbAt.getY()))<=1,'actual jail landing routes to orb before opening camera');
  assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9754),'viewing uses actual elfwood orb model');
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);
  const portalXY=side===0?[3424,5017]:[3423,5029];
  // Continue from restored orb approach position; no adjacency seed hides portal routing.
  await layoutObjectInput(victim,game,'clanwars_prisonportal_elfwood',portalXY,'Exit');
  assert.equal(game.fighters.has(victim),true);assert.equal(game.jailed.has(victim),false);
  assert.deepEqual(position(victim),positionAt(game,SYLVAN_LANDINGS[side]));
});

test('native Sylvan and Plateau coexist and refuse foreign exit or viewing objects',async()=>{
  const a=actor(),b=actor(),c=actor(),d=actor();channel(a);channel(b);channel(c);channel(d);
  const glade=await negotiate(a,b,null,1,null,2);await join(a);await join(b);
  const plateau=await negotiate(c,d);await join(c);await join(d);
  assert.notEqual(glade.area,plateau.area);assert.equal(plateau.walls.length,52,'Plateau keeps original registrations');
  const foreign=mappedLayoutObjects(plateau,'clanwars_exitportal_darkrock_s')[0];assert.ok(foreign);
  assert.equal(Match.forfeit({player:a,object:foreign}),false);assert.equal(C.matches.get(a),glade);
  const wrong=mappedLayoutObjects(glade,'clanwars_viewing_elfwood')[0];assert.ok(wrong);
  assert.equal(viewingUnit().use({player:a,object:wrong}),false);
  assert.equal(Match.exit({player:a,object:wrong}),false);assert.equal(C.matches.get(a),glade);
  for(const p of [a,b]) {
    const side=glade.members.get(p),xy=side===0?[3422,4996]:[3421,5051];
    p.moveTo(glade.area.at([xy[0]+1,xy[1]+(side===0?2:-1),0]));tick(2);
    await layoutObjectInput(p,glade,side===0?'clanwars_exitportal_elfwood_s':'clanwars_exitportal_elfwood_n',xy,'Forfeit');
    assert.equal(C.matches.has(p),false);lobby(p);
  }
  assert.equal(glade.members.size,0);assert.equal(glade.phase,'staging','empty staging retains its existing preparation lifetime');
  const remaining=glade.starts-C.now();assert.ok(remaining>0);tick(remaining);
  assert.equal(glade.area.isDestroyed(),true);assert.equal(plateau.phase,'staging');assert.equal(C.matches.get(c),plateau);
});


test('native Sylvan Ignore5 preserves six-fighter starts and real five-fighter defeat',async()=>{
  const a=actor(true),b=actor(true),allies=Array.from({length:5},()=>actor(true)),enemies=Array.from({length:5},()=>actor(true));
  for(const p of [a,...allies,b,...enemies]) ruleStats(p);
  channel(a,allies);channel(b,enemies);
  const game=await negotiate(a,b,3,0,{stragglers:1},2);
  await batchJoin([a,...allies,b,...enemies],game);
  assert.equal(game.fighters.size,12);core.World.processCycle=game.starts-1;tick();assert.equal(game.phase,'combat');
  await lethalMelee(b,allies[0],game,true,[[3400,5020,0],[3401,5020,0]]);tick(6);
  assert.equal(game.phase,'over');for(const p of [a,...allies,b,...enemies]) lobby(p);
  assert.equal(game.area.isDestroyed(),true);
});

// H: observed cache geometry; exact player placements/barrier row are TSPS choices.
const QUARRY_ORIGIN=[3392,5056];
const QUARRY_LANDINGS=[[3424,5066,0],[3424,5109,0]];
const QUARRY_JAILS=[[3428,5085,0],[3419,5090,0]];
const quarryReachable=(game,from,to)=>layoutReachable(game,from,to,QUARRY_ORIGIN);

test('native Quarry selection, delivered arena reselection and unsupported rows retain agreement guards',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  await click(a,'clanwars_setup:accept');const s=C.negotiations.get(a);assert.equal(s.accepted.has(a),true);
  await click(b,'clanwars_setup:arena',9);assert.equal(s.rules.arena,3,'native Quarry option reaches authoritative offer');
  assert.equal(s.accepted.size,0);assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(s.rules),/Forsaken Quarry/);
  for(const [slot,arena] of [[6,2],[3,1],[9,3]]) {
    tick(9);await click(a,'clanwars_setup:accept');assert.equal(s.accepted.has(a),true);
    await click(b,'clanwars_setup:arena',slot);assert.equal(s.rules.arena,arena);assert.equal(s.accepted.size,0);
  }
  for(const slot of [45,1,2,48,42,65535]) {
    await click(a,'clanwars_setup:arena',slot);assert.equal(s.rules.arena,3);
    assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_arena')),3);
  }
});

test('native Quarry queued movement, full clip restoration and rock walk-versus-LOS',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,0,null,3);
  await join(a);await join(b);for(const p of [a,b]) assert.deepEqual(position(p),positionAt(game,QUARRY_LANDINGS[game.members.get(p)]));
  const reference=new core.TemplatedInstanceArea(8,8);
  try {
    for(let plane=0;plane<2;plane++) for(let x=0;x<8;x++) for(let y=0;y<8;y++) {
      reference.setChunk(plane,x,y,{sourceChunkX:424+x,sourceChunkY:632+y,sourcePlane:plane,rotation:0});
      assert.deepEqual(game.area.getChunk(plane,x,y),reference.getChunk(plane,x,y));
    }
    const baseline=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) baseline.push(reference.getClip(reference.tile(x,y,0)));
    const wallId=core.CacheDefinitions.getLocId('clanwars_barrier_greyrock'),def=core.CacheDefinitions.getObject(wallId);
    assert.deepEqual([def.sizeX,def.sizeY],[1,1]);assert.equal(game.walls.length,24);
    const walls=game.walls.slice(),{MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
    for(const wall of walls) {
      assert.equal(wall.getId(),wallId);assert.equal(wall.getPrivateArea(),game.area);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),0);
      assert.notEqual(game.area.getClip(wall.getLocation())&0x100,0);
      assert.equal(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),wall);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getPrivateArea()===game.area&&o.getId()===wallId).length,1);
    }
    for(const [lo,hi] of [[3396,3415],[3432,3451]]) for(let x=lo;x<=hi;x++) {
      const old=reference.getClip(reference.tile(x-3392,5087-5056,0));
      const count=walls.filter(o=>o.getLocation().equals(game.area.at([x,5087,0]))).length;
      assert.equal(count,old&core.RegionManager.BLOCKED_MASK?0:1,'solid mapped rocks need no overlay');
    }
    assert.equal(quarryReachable(game,QUARRY_LANDINGS[0],QUARRY_LANDINGS[1]),false,'cardinal+diagonal routes including corrected prison edges stay separated');
    for(const side of [0,1]) assert.equal(quarryReachable(game,QUARRY_JAILS[side],QUARRY_LANDINGS[side]),false);
    assert.equal(core.RegionManager.canMovestart(game.area.at([3392,5066,0]),game.area.at([3391,5066,0]),1,1,game.area),false);
    const walker=[a,b].find(p=>game.members.get(p)===0),open=game.area.at([3425,5066,0]),across=game.area.at(QUARRY_LANDINGS[1]);
    await wire(walker,walkClickFrame(open));assert.deepEqual(position(walker),[open.getX(),open.getY(),0]);
    await wire(walker,walkClickFrame(across));tick(60);assert.equal(game.phase,'staging');
    assert.ok(walker.getLocation().getY()<game.area.at([3424,5087,0]).getY(),'ordinary movement cannot reach north during preparation');
    const staging={position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()};
    completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.walls.length,0);
    for(const wall of walls) {
      assert.equal(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),null);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);
    }
    const after=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) after.push(game.area.getClip(game.area.tile(x,y,0)));
    assert.deepEqual(after,baseline,'all4096 masks preserve static rocks and prison directional/projectile edges');
    assert.equal(after[(5087-5056)*64+3415-3392],0x1008);assert.equal(after[(5087-5056)*64+3432-3392],0x10080);
    assert.equal(quarryReachable(game,QUARRY_LANDINGS[0],QUARRY_LANDINGS[1]),true);
    await wire(walker,walkClickFrame(across));tick(80);assert.deepEqual(position(walker),[across.getX(),across.getY(),0]);
    console.log('QUARRY_MOVEMENT_QUALIFICATION '+JSON.stringify({staging,combat:{position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}}));
    const rock=game.area.at([3402,5073,0]),left=game.area.at([3401,5073,0]),right=game.area.at([3404,5073,0]);
    const rockObject=mappedLayoutObjects(game,'rockslide_grey2').find(o=>o.getLocation().equals(rock));assert.ok(rockObject);
    const rockDef=core.CacheDefinitions.getObject(rockObject.getId());assert.deepEqual([rockDef.sizeX,rockDef.sizeY,rockDef.blocksProjectile],[2,2,false]);
    assert.equal(game.area.getClip(rock)&0x20100,0x100);assert.equal(core.RegionManager.canMovestart(left,rock,1,1,game.area),false);
    assert.equal(quarryReachable(game,QUARRY_LANDINGS[1],[3401,5073,0]),true,'open rock approach is in the battle component');
    await wire(walker,walkClickFrame(left));tick(140);assert.deepEqual(position(walker),[left.getX(),left.getY(),0],'ordinary walk reaches open rock approach');
    await wire(walker,walkClickFrame(rock));tick(10);assert.notDeepEqual(position(walker),[rock.getX(),rock.getY(),0],'ordinary click cannot enter the blocked rock tile');
    assert.equal(core.RegionManager.blocked(walker.getLocation(),game.area),false);
    assert.ok(Math.max(Math.abs(walker.getLocation().getX()-rock.getX()),Math.abs(walker.getLocation().getY()-rock.getY()))<=2,'blocked click stays at a legal near endpoint');
    console.log('QUARRY_ROCK_MOVEMENT_QUALIFICATION '+JSON.stringify({requested:[rock.getX(),rock.getY(),0],position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}));
    assert.equal(core.RegionManager.canProjectileAttackReturn(left,right,1,game.area),true,'actual ray crosses walk-blocking small rock');
    const o1=game.area.at([3424,5066,0]),o2=game.area.at([3425,5066,0]);
    assert.equal(core.RegionManager.canMovestart(o1,o2,1,1,game.area),true);assert.equal(core.RegionManager.canProjectileAttackReturn(o1,o2,1,game.area),true);
  } finally {reference.destroy();assert.equal(reference.isDestroyed(),true);}
});

for(const mode of [0,1,16]) test(`native Quarry mode ${mode} retains restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},3);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3424,5066,0]));b.moveTo(game.area.at([3425,5066,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,QUARRY_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of [0,1]) test(`native Quarry side ${victimIndex} death metadata, jail approach and viewing model`,async()=>{
  const a=actor(true),b=actor(true),delay=victimIndex===1?1:0;channel(a);channel(b);const game=await negotiate(a,b,null,1,{rejoiningdelay:delay},3);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);
  victim.getInventory().add(new core.Item(995,79,{qa:'quarry'}));
  await lethalMelee(killer,victim,game,true,[[3424,5066,0],[3425,5066,0]]);tick(6);
  assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,QUARRY_JAILS[side]));
  assert.equal(victim.getInventory().getAmount(995),79);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'quarry'});
  const scripts=scriptCalls(victim),orbXY=side===0?[3429,5086]:[3418,5089];
  await layoutObjectInput(victim,game,'clanwars_viewing_start_greyrock',orbXY,'Use');
  assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));const state=viewingUnit().active.get(victim);assert.ok(state);
  const at=game.area.at([...orbXY,0]);assert.ok(Math.max(Math.abs(state.location.getX()-at.getX()),Math.abs(state.location.getY()-at.getY()))<=1);
  assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9755));
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);
  assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);
  assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const accountKey=victim.getLongUsername(),deadline=game.returnAt.get(accountKey);
  if(delay) {assert.ok(Number.isInteger(deadline),'canonical account deadline exists');assert.ok(deadline>C.now(),'early Exit precondition is before the real deadline');}
  await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',side===0?[3424,5087]:[3423,5088],'Exit');
  if(delay) {
    assert.equal(game.jailed.has(victim),true,'early ordinary Exit cannot bypass the negotiated delay');
    assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(accountKey),deadline);assert.ok(deadline>C.now());
    tick(deadline-C.now());
    await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',side===0?[3424,5087]:[3423,5088],'Exit');
  }
  assert.equal(game.fighters.has(victim),true);assert.equal(game.jailed.has(victim),false);assert.deepEqual(position(victim),positionAt(game,QUARRY_LANDINGS[side]));
});

test('native three-layout coexistence, shared-ID foreign portal and unregistered lookalike refusals',async()=>{
  const a=actor(),b=actor(),c=actor(),d=actor(),e=actor(),f=actor();for(const p of [a,b,c,d,e,f]) channel(p);
  const plateau=await negotiate(a,b,null,1);await join(a);await join(b);assert.equal(plateau.walls.length,52);
  const sylvan=await negotiate(c,d,null,1,null,2);await join(c);await join(d);
  const quarry=await negotiate(e,f,null,1,null,3);await join(e);await join(f);
  assert.equal(new Set([plateau.area,sylvan.area,quarry.area]).size,3);
  const foreign=mappedLayoutObjects(plateau,'clanwars_prisonportal_darkrock')[0],owned=mappedLayoutObjects(quarry,'clanwars_prisonportal_darkrock')[0];
  assert.ok(foreign&&owned);assert.equal(foreign.getId(),owned.getId(),'sameID cannot substitute instance ownership');
  assert.equal(Match.exit({player:e,object:foreign}),false);assert.equal(C.matches.get(e),quarry);
  const {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');assert.equal(MapObjects.getPrivateArea(e,foreign.getId(),foreign.getLocation()),null);
  const fake=new core.GameObject(owned.getId(),owned.getLocation().clone(),owned.getType(),owned.getFace(),quarry.area);
  try {assert.equal(Match.exit({player:e,object:fake}),false);assert.equal(C.matches.get(e),quarry);} finally {quarry.area.detach(fake);}
  const wrong=mappedLayoutObjects(quarry,'clanwars_viewing_greyrock')[0];assert.ok(wrong);assert.equal(viewingUnit().use({player:e,object:wrong}),false);
  const foreignExit=mappedLayoutObjects(sylvan,'clanwars_exitportal_elfwood_s')[0];assert.ok(foreignExit);assert.equal(Match.forfeit({player:e,object:foreignExit}),false);
  for(const p of [e,f]) {
    const side=quarry.members.get(p),xy=side===0?[3422,5062]:[3422,5112];p.moveTo(quarry.area.at([xy[0]+1,xy[1]+(side===0?2:-1),0]));tick(2);
    await layoutObjectInput(p,quarry,side===0?'clanwars_exitportal_greyrock_s':'clanwars_exitportal_greyrock_n',xy,'Forfeit');assert.equal(C.matches.has(p),false);lobby(p);
  }
  assert.equal(quarry.members.size,0);assert.equal(quarry.phase,'staging');const remaining=quarry.starts-C.now();assert.ok(remaining>0);tick(remaining);
  assert.equal(quarry.area.isDestroyed(),true);
  for(const [game,players] of [[plateau,[a,b]],[sylvan,[c,d]]]) {assert.notEqual(game.phase,'over');assert.equal(game.area.isDestroyed(),false);for(const p of players) assert.equal(C.matches.get(p),game);}
});

test('native Quarry Ignore5 uses concurrent six-fighter starts and actual defeat threshold',async()=>{
  const {a,b,teams,players,game}=await stragglerGame(6,1,3,{},3);completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.fighters.size,12);
  await lethalMelee(b,teams[0][1],game,true,[[3424,5066,0],[3425,5066,0]]);tick(6);
  assert.equal(game.phase,'over');for(const p of players) lobby(p);assert.equal(game.area.isDestroyed(),true);
});

// I: observed cache geometry; exact player placements/barrier row are TSPS choices.
const SWAMP_ORIGIN=[3392,4928];
const SWAMP_LANDINGS=[[3409,4934,0],[3439,4985,0]];
const SWAMP_JAILS=[[3396,4932,0],[3451,4987,0]];
const swampReachable=(game,from,to)=>layoutReachable(game,from,to,SWAMP_ORIGIN);

test('native Soggy Swamp selection resets agreement across delivered arenas and rejects unsupported rows',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  await click(a,'clanwars_setup:accept');const s=C.negotiations.get(a);assert.equal(s.accepted.has(a),true);
  await click(b,'clanwars_setup:arena',18);assert.equal(s.rules.arena,6,'native Soggy Swamp option reaches authoritative offer');
  assert.equal(s.accepted.size,0);assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(s.rules),/Soggy Swamp/);
  for(const [slot,arena] of [[6,2],[3,1],[9,3],[18,6]]) {
    tick(9);await click(a,'clanwars_setup:accept');assert.equal(s.accepted.has(a),true);
    await click(b,'clanwars_setup:arena',slot);assert.equal(s.rules.arena,arena);assert.equal(s.accepted.size,0);
  }
  for(const slot of [45,1,2,48,22,42,65535]) {
    await click(a,'clanwars_setup:arena',slot);assert.equal(s.rules.arena,6);
    assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_arena')),6);
  }
});

test('native Soggy Swamp queued movement, full clip restoration and tree-root walk/LOS obstruction',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,0,null,6);
  await join(a);await join(b);for(const p of [a,b]) assert.deepEqual(position(p),positionAt(game,SWAMP_LANDINGS[game.members.get(p)]));
  const reference=new core.TemplatedInstanceArea(8,8);
  try {
    for(let plane=0;plane<2;plane++) for(let x=0;x<8;x++) for(let y=0;y<8;y++) {
      reference.setChunk(plane,x,y,{sourceChunkX:424+x,sourceChunkY:616+y,sourcePlane:plane,rotation:0});
      assert.deepEqual(game.area.getChunk(plane,x,y),reference.getChunk(plane,x,y));
    }
    const baseline=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) baseline.push(reference.getClip(reference.tile(x,y,0)));
    const wallId=core.CacheDefinitions.getLocId('clanwars_barrier_swamp'),def=core.CacheDefinitions.getObject(wallId);
    assert.deepEqual([def.sizeX,def.sizeY],[1,1]);assert.equal(game.walls.length,57);
    const walls=game.walls.slice(),{MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
    for(const wall of walls) {
      assert.equal(wall.getId(),wallId);assert.equal(wall.getPrivateArea(),game.area);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),0);
      assert.notEqual(game.area.getClip(wall.getLocation())&0x100,0);
      assert.equal(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),wall);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getPrivateArea()===game.area&&o.getId()===wallId).length,1);
    }
    for(const [lo,hi] of [[3395,3452]]) for(let x=lo;x<=hi;x++) {
      const old=reference.getClip(reference.tile(x-3392,4959-4928,0));
      const count=walls.filter(o=>o.getLocation().equals(game.area.at([x,4959,0]))).length;
      assert.equal(count,old&core.RegionManager.BLOCKED_MASK?0:1,'solid mapped tree needs no overlay');
    }
    assert.equal(swampReachable(game,SWAMP_LANDINGS[0],SWAMP_LANDINGS[1]),false,'cardinal+diagonal routes including both wall ends stay separated');
    for(const side of [0,1]) assert.equal(swampReachable(game,SWAMP_JAILS[side],SWAMP_LANDINGS[side]),false);
    assert.equal(core.RegionManager.canMovestart(game.area.at([3392,4934,0]),game.area.at([3391,4934,0]),1,1,game.area),false);
    const walker=[a,b].find(p=>game.members.get(p)===0),open=game.area.at([3410,4934,0]),across=game.area.at(SWAMP_LANDINGS[1]);
    await wire(walker,walkClickFrame(open));assert.deepEqual(position(walker),[open.getX(),open.getY(),0]);
    await wire(walker,walkClickFrame(across));tick(60);assert.equal(game.phase,'staging');
    assert.ok(walker.getLocation().getY()<game.area.at([3424,4959,0]).getY(),'ordinary movement cannot reach north during preparation');
    const staging={position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()};
    completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.walls.length,0);
    for(const wall of walls) {
      assert.equal(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),null);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);
    }
    const after=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) after.push(game.area.getClip(game.area.tile(x,y,0)));
    assert.deepEqual(after,baseline,'all4096 masks preserve static trees, roots and directional/projectile edges');
    assert.equal(after[(4959-4928)*64+3397-3392],0x20100,'the skipped solid tree keeps both walking and projectile bits');
    assert.equal(swampReachable(game,SWAMP_LANDINGS[0],SWAMP_LANDINGS[1]),true);
    await wire(walker,walkClickFrame(across));tick(200);assert.deepEqual(position(walker),[across.getX(),across.getY(),0]);
    console.log('SWAMP_MOVEMENT_QUALIFICATION '+JSON.stringify({staging,combat:{position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}}));
    for(const specimen of [
      {gameval:'deadtree4swamp',xy:[3398,4946],left:[3397,4946],right:[3399,4946],size:1,face:1},
      {gameval:'swamp_root',xy:[3398,4977],left:[3397,4978],right:[3401,4978],size:3,face:2},
    ]) {
      const obstacle=game.area.at([...specimen.xy,0]),left=game.area.at([...specimen.left,0]),right=game.area.at([...specimen.right,0]);
      const object=mappedLayoutObjects(game,specimen.gameval).find(o=>o.getLocation().equals(obstacle));assert.ok(object);
      const definition=core.CacheDefinitions.getObject(object.getId());
      assert.deepEqual([definition.sizeX,definition.sizeY,definition.blocksProjectile],[specimen.size,specimen.size,true]);
      assert.equal(object.getType(),10);assert.equal(object.getFace(),specimen.face);assert.equal(object.getPrivateArea(),game.area);
      assert.equal(game.area.getClip(obstacle)&0x20100,0x20100);assert.equal(game.area.getClip(left),0);assert.equal(game.area.getClip(right),0);
      assert.equal(swampReachable(game,SWAMP_LANDINGS[1],specimen.left),true);
      await wire(walker,walkClickFrame(left));tick(240);assert.deepEqual(position(walker),[left.getX(),left.getY(),0],'ordinary queued walk reaches open obstacle approach');
      await wire(walker,walkClickFrame(obstacle));
      for(let cycle=0;cycle<10;cycle++) {
        tick();assert.equal(core.RegionManager.blocked(walker.getLocation(),game.area),false,'processed ordinary movement never enters a solid obstacle');
      }
      const at=walker.getLocation();assert.ok(!(at.getX()>=obstacle.getX()&&at.getX()<obstacle.getX()+specimen.size&&at.getY()>=obstacle.getY()&&at.getY()<obstacle.getY()+specimen.size),'blocked click remains outside the full object footprint');
      console.log('SWAMP_OBSTACLE_MOVEMENT_QUALIFICATION '+JSON.stringify({gameval:specimen.gameval,requested:[obstacle.getX(),obstacle.getY(),0],position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}));
      const edge=game.area.at([specimen.xy[0],specimen.left[1],0]);
      assert.equal(core.RegionManager.canMovestart(left,edge,1,1,game.area),false,'selected obstacle blocks the adjacent native step');
      assert.equal(core.RegionManager.canProjectileAttackReturn(left,right,1,game.area),false,'native ray across selected tree or roots is blocked');
    }
    const o1=game.area.at([3409,4934,0]),o2=game.area.at([3410,4934,0]);
    assert.equal(core.RegionManager.canMovestart(o1,o2,1,1,game.area),true);assert.equal(core.RegionManager.canProjectileAttackReturn(o1,o2,1,game.area),true,'open ray positive control');
  } finally {reference.destroy();assert.equal(reference.isDestroyed(),true);}
});

for(const mode of [0,1,16]) test(`native Soggy Swamp mode ${mode} retains restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},6);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3409,4934,0]));b.moveTo(game.area.at([3410,4934,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,SWAMP_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of [0,1]) test(`native Soggy Swamp side ${victimIndex} death metadata, jail approach and viewing model`,async()=>{
  const a=actor(true),b=actor(true),delay=victimIndex===1?1:0;channel(a);channel(b);const game=await negotiate(a,b,null,1,{rejoiningdelay:delay},6);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);
  victim.getInventory().add(new core.Item(995,79,{qa:'swamp'}));
  await lethalMelee(killer,victim,game,true,[[3409,4934,0],[3410,4934,0]]);tick(6);
  assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,SWAMP_JAILS[side]));
  assert.equal(victim.getInventory().getAmount(995),79);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'swamp'});
  const scripts=scriptCalls(victim),orbXY=side===0?[3397,4929]:[3450,4990];
  await layoutObjectInput(victim,game,'clanwars_viewing_start_swamp',orbXY,'Use');
  assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));const state=viewingUnit().active.get(victim);assert.ok(state);
  const at=game.area.at([...orbXY,0]);assert.ok(Math.max(Math.abs(state.location.getX()-at.getX()),Math.abs(state.location.getY()-at.getY()))<=1);
  assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9753));
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);
  assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);
  assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const accountKey=victim.getLongUsername(),deadline=game.returnAt.get(accountKey);
  if(delay) {assert.ok(Number.isInteger(deadline),'canonical account deadline exists');assert.ok(deadline>C.now(),'early Exit precondition is before the real deadline');}
  await layoutObjectInput(victim,game,'clanwars_prisonportal_swamp',side===0?[3393,4933]:[3454,4986],'Exit');
  if(delay) {
    assert.equal(game.jailed.has(victim),true,'early ordinary Exit cannot bypass the negotiated delay');
    assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(accountKey),deadline);assert.ok(deadline>C.now());
    tick(deadline-C.now());
    await layoutObjectInput(victim,game,'clanwars_prisonportal_swamp',side===0?[3393,4933]:[3454,4986],'Exit');
  }
  assert.equal(game.fighters.has(victim),true);assert.equal(game.jailed.has(victim),false);assert.deepEqual(position(victim),positionAt(game,SWAMP_LANDINGS[side]));
});

test('native four-layout coexistence refuses same-ID foreign swamp objects and unregistered lookalikes',async()=>{
  const players=Array.from({length:10},()=>actor());for(const p of players) channel(p);
  const [a,b,c,d,e,f,g,h,i,j]=players;
  const plateau=await negotiate(a,b,null,1);await join(a);await join(b);assert.equal(plateau.walls.length,52);
  const sylvan=await negotiate(c,d,null,1,null,2);await join(c);await join(d);
  const quarry=await negotiate(e,f,null,1,null,3);await join(e);await join(f);
  const other=await negotiate(i,j,null,1,null,6);await join(i);await join(j);
  const swamp=await negotiate(g,h,null,1,null,6);await join(g);await join(h);
  assert.equal(new Set([plateau.area,sylvan.area,quarry.area,swamp.area]).size,4);
  const foreign=mappedLayoutObjects(other,'clanwars_prisonportal_swamp')[0],owned=mappedLayoutObjects(swamp,'clanwars_prisonportal_swamp')[0];
  assert.ok(foreign&&owned);assert.equal(foreign.getId(),owned.getId());
  assert.equal(Match.exit({player:g,object:foreign}),false);assert.equal(C.matches.get(g),swamp);
  const {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');assert.equal(MapObjects.getPrivateArea(g,foreign.getId(),foreign.getLocation()),null);
  const fake=new core.GameObject(owned.getId(),owned.getLocation().clone(),owned.getType(),owned.getFace(),swamp.area);
  try {assert.equal(Match.exit({player:g,object:fake}),false);assert.equal(C.matches.get(g),swamp);} finally {swamp.area.detach(fake);}
  const wrong=mappedLayoutObjects(swamp,'clanwars_viewing_swamp')[0];assert.ok(wrong);assert.equal(viewingUnit().use({player:g,object:wrong}),false);
  const foreignOrb=mappedLayoutObjects(other,'clanwars_viewing_start_swamp')[0];assert.ok(foreignOrb);assert.equal(viewingUnit().use({player:g,object:foreignOrb}),false);
  const foreignExit=mappedLayoutObjects(quarry,'clanwars_exitportal_greyrock_s')[0];assert.ok(foreignExit);assert.equal(Match.forfeit({player:g,object:foreignExit}),false);
  for(const p of [g,h]) {
    const side=swamp.members.get(p),xy=side===0?[3407,4931]:[3437,4987];
    // Supplied combat/Forfeit checkpoints remain explicit; jail routes start at actual death landings.
    p.moveTo(swamp.area.at([xy[0]+1,xy[1]+(side===0?2:-1),0]));tick(2);
    await layoutObjectInput(p,swamp,side===0?'clanwars_exitportal_swamp_s':'clanwars_exitportal_swamp_n',xy,'Forfeit');assert.equal(C.matches.has(p),false);lobby(p);
  }
  assert.equal(swamp.members.size,0);assert.equal(swamp.phase,'staging');const remaining=swamp.starts-C.now();assert.ok(remaining>0);tick(remaining);
  assert.equal(swamp.area.isDestroyed(),true);
  for(const [game,team] of [[plateau,[a,b]],[sylvan,[c,d]],[quarry,[e,f]],[other,[i,j]]]) {
    assert.notEqual(game.phase,'over');assert.equal(game.area.isDestroyed(),false);for(const p of team) assert.equal(C.matches.get(p),game);
  }
});

test('native Soggy Swamp Ignore5 uses concurrent six-fighter starts and actual defeat threshold',async()=>{
  const {a,b,teams,players,game}=await stragglerGame(6,1,3,{},6);completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.fighters.size,12);
  await lethalMelee(b,teams[0][1],game,true,[[3409,4934,0],[3410,4934,0]]);tick(6);
  assert.equal(game.phase,'over');for(const p of players) lobby(p);assert.equal(game.area.isDestroyed(),true);
});

// J: observed cache geometry; exact player placements/barrier row are TSPS choices.
const CUP_ORIGIN=[3136,4928];
const CUP_LANDINGS=[[3150,4960,0],[3185,4960,0]];
const CUP_JAILS=[[3141,4957,0],[3194,4957,0]];
const cupReachable=(game,from,to)=>layoutReachable(game,from,to,CUP_ORIGIN);

const CUP_ORBS=[[[3140,4961],[3157,4932],[3157,4987]],[[3195,4961],[3178,4932],[3178,4987]]];

test('native Clan Cup selection resets agreement across all five arenas and rejects unsupported rows',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  await click(a,'clanwars_setup:accept');const session=C.negotiations.get(a);assert.equal(session.accepted.has(a),true);
  await click(b,'clanwars_setup:arena',15);assert.equal(session.rules.arena,5,'native Clan Cup option reaches authoritative offer');
  assert.equal(session.accepted.size,0);assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(session.rules),/Clan Cup Arena/);
  for(const [slot,arena] of [[3,1],[6,2],[9,3],[18,6],[15,5]]) {
    tick(9);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);
    await click(b,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,arena);assert.equal(session.accepted.size,0);
  }
  for(const slot of [45,1,2,48,22,42,65535]) {
    await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,5);
    assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_arena')),5);
  }
});

test('native Clan Cup queued movement, full clip restoration and selected axis and terrain walk-versus-ray',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,0,null,5);
  await join(a);await join(b);for(const p of [a,b]) assert.deepEqual(position(p),positionAt(game,CUP_LANDINGS[game.members.get(p)]));
  const reference=new core.TemplatedInstanceArea(8,8);
  try {
    for(let plane=0;plane<2;plane++) for(let x=0;x<8;x++) for(let y=0;y<8;y++) {
      reference.setChunk(plane,x,y,{sourceChunkX:392+x,sourceChunkY:616+y,sourcePlane:plane,rotation:0});
      assert.deepEqual(game.area.getChunk(plane,x,y),reference.getChunk(plane,x,y));
    }
    const baseline=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) baseline.push(reference.getClip(reference.tile(x,y,0)));
    const wallId=core.CacheDefinitions.getLocId('clanwars_barrier_greyrock'),def=core.CacheDefinitions.getObject(wallId);
    assert.deepEqual([def.sizeX,def.sizeY],[1,1]);assert.equal(game.walls.length,43);
    const walls=game.walls.slice(),{MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
    for(const wall of walls) {
      assert.equal(wall.getId(),wallId);assert.equal(wall.getPrivateArea(),game.area);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),1);
      assert.notEqual(game.area.getClip(wall.getLocation())&0x100,0);
      assert.equal(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),wall);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getPrivateArea()===game.area&&o.getId()===wallId).length,1);
    }
    for(let y=4936;y<=4983;y++) {
      const old=reference.getClip(reference.tile(3167-3136,y-4928,0));
      const count=walls.filter(o=>o.getLocation().equals(game.area.at([3167,y,0]))).length;
      assert.equal(count,old&core.RegionManager.BLOCKED_MASK?0:1,'solid mapped cells need no overlay');
      if(count) assert.equal(old&0x20100,0,'registration cannot clear pre-existing solid/projectile tile bits');
    }
    assert.equal(cupReachable(game,CUP_LANDINGS[0],CUP_LANDINGS[1]),false,'cardinal+diagonal routes including both wall ends stay separated');
    for(const side of [0,1]) assert.equal(cupReachable(game,CUP_JAILS[side],CUP_LANDINGS[side]),false);
    assert.equal(core.RegionManager.canMovestart(game.area.at([3136,4960,0]),game.area.at([3135,4960,0]),1,1,game.area),false);
    const walker=[a,b].find(p=>game.members.get(p)===0),open=game.area.at([3151,4960,0]),across=game.area.at(CUP_LANDINGS[1]);
    await wire(walker,walkClickFrame(open));assert.deepEqual(position(walker),[open.getX(),open.getY(),0]);
    await wire(walker,walkClickFrame(across));tick(60);assert.equal(game.phase,'staging');
    assert.ok(walker.getLocation().getX()<game.area.at([3167,4960,0]).getX(),'ordinary movement cannot reach east during preparation');
    const staging={position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()};
    completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.walls.length,0);
    for(const wall of walls) {
      assert.equal(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),null);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);
    }
    const after=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) after.push(game.area.getClip(game.area.tile(x,y,0)));
    assert.deepEqual(after,baseline,'all4096 masks preserve all source terrain and directional/projectile edges');
    for(const [y,mask] of [[4936,0x4020],[4961,0x1008],[4983,0x402]]) assert.equal(after[(y-4928)*64+3167-3136],mask,'directional/projectile edge flags survive vertical barrier removal');
    for(const y of [4938,4939,4942,4944,4945]) assert.equal(after[(y-4928)*64+3167-3136],0x100,'skipped cells keep their original walking obstruction');
    assert.equal(cupReachable(game,CUP_LANDINGS[0],CUP_LANDINGS[1]),true);
    await wire(walker,walkClickFrame(across));tick(200);assert.deepEqual(position(walker),[across.getX(),across.getY(),0]);
    console.log('CLANCUP_MOVEMENT_QUALIFICATION '+JSON.stringify({staging,combat:{position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}}));
    for(const specimen of [
      {gameval:'stalagmite_twin_grey',xy:[3146,4973],left:[3145,4973],right:[3147,4973],projectile:true},
      {gameval:'wild1_bones_small_03',xy:[3146,4944],left:[3145,4944],right:[3147,4944],projectile:false},
    ]) {
      const obstacle=game.area.at([...specimen.xy,0]),left=game.area.at([...specimen.left,0]),right=game.area.at([...specimen.right,0]);
      const object=mappedLayoutObjects(game,specimen.gameval).find(o=>o.getLocation().equals(obstacle));assert.ok(object);
      const definition=core.CacheDefinitions.getObject(object.getId());
      assert.deepEqual([definition.sizeX,definition.sizeY,definition.blocksProjectile],[1,1,specimen.projectile]);
      assert.equal(object.getType(),10);assert.equal(object.getFace(),0);assert.equal(object.getPrivateArea(),game.area);
      assert.equal(game.area.getClip(obstacle)&0x20100,specimen.projectile?0x20100:0x100);
      assert.equal(game.area.getClip(left),0);assert.equal(game.area.getClip(right),0);
      assert.equal(cupReachable(game,CUP_LANDINGS[1],specimen.left),true);
      await wire(walker,walkClickFrame(left));tick(240);assert.deepEqual(position(walker),[left.getX(),left.getY(),0],'ordinary walk reaches the actual open obstacle approach');
      await wire(walker,walkClickFrame(obstacle));
      for(let cycle=0;cycle<10;cycle++) {tick();assert.equal(core.RegionManager.blocked(walker.getLocation(),game.area),false);}
      assert.notDeepEqual(position(walker),[obstacle.getX(),obstacle.getY(),0]);
      console.log('CLANCUP_OBSTACLE_MOVEMENT_QUALIFICATION '+JSON.stringify({gameval:specimen.gameval,requested:[obstacle.getX(),obstacle.getY(),0],position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}));
      assert.equal(core.RegionManager.canMovestart(left,obstacle,1,1,game.area),false);
      assert.equal(core.RegionManager.canProjectileAttackReturn(left,right,1,game.area),!specimen.projectile,'selected source terrain distinguishes walking from the native ray');
    }
    const o1=game.area.at([3150,4960,0]),o2=game.area.at([3151,4960,0]);
    assert.equal(core.RegionManager.canMovestart(o1,o2,1,1,game.area),true);assert.equal(core.RegionManager.canProjectileAttackReturn(o1,o2,1,game.area),true,'open ray positive control');
  } finally {reference.destroy();assert.equal(reference.isDestroyed(),true);}
});

for(const mode of [0,1,16]) test(`native Clan Cup mode ${mode} retains restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},5);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3150,4960,0]));b.moveTo(game.area.at([3151,4960,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,CUP_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of [0,1]) test(`native Clan Cup side ${victimIndex} death metadata, jail approach and viewing model`,async()=>{
  const outsiders=[actor(),actor()];for(const p of outsiders) channel(p);
  const foreignGame=await negotiate(outsiders[0],outsiders[1],null,1,null,3);for(const p of outsiders) await join(p);
  const a=actor(true),b=actor(true),delay=victimIndex===1?1:0;channel(a);channel(b);const game=await negotiate(a,b,null,1,{rejoiningdelay:delay},5);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);
  victim.getInventory().add(new core.Item(995,79,{qa:'clancup'}));
  await lethalMelee(killer,victim,game,true,[[3150,4960,0],[3151,4960,0]]);tick(6);
  assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,CUP_JAILS[side]));
  assert.equal(victim.getInventory().getAmount(995),79);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'clancup'});
  const foreignPortal=mappedLayoutObjects(foreignGame,'clanwars_prisonportal_darkrock')[0],foreignOrb=mappedLayoutObjects(foreignGame,'clanwars_viewing_start_greyrock')[0];assert.ok(foreignPortal&&foreignOrb);
  assert.equal(Match.exit({player:victim,object:foreignPortal}),false,'valid jailed member cannot use the real same-ID portal of another match');
  assert.equal(viewingUnit().use({player:victim,object:foreignOrb}),false,'valid jailed member cannot use a real same-ID foreign orb');
  assert.equal(C.matches.get(victim),game);assert.equal(game.jailed.has(victim),true);
  const scripts=scriptCalls(victim),orbXY=side===0?[3140,4961]:[3195,4961];
  await layoutObjectInput(victim,game,'clanwars_viewing_start_greyrock',orbXY,'Use');
  assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));const state=viewingUnit().active.get(victim);assert.ok(state);
  const at=game.area.at([...orbXY,0]);assert.ok(Math.max(Math.abs(state.location.getX()-at.getX()),Math.abs(state.location.getY()-at.getY()))<=1);
  assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9755));
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);
  assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);
  assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const ownedPortal=mappedLayoutObjects(game,'clanwars_prisonportal_darkrock').find(o=>o.getLocation().equals(game.area.at([...(side===0?[3140,4952]:[3195,4952]),0])));assert.ok(ownedPortal);
  const fake=new core.GameObject(ownedPortal.getId(),ownedPortal.getLocation().clone(),ownedPortal.getType(),ownedPortal.getFace(),game.area);
  try {assert.equal(Match.exit({player:victim,object:fake}),false);assert.equal(game.jailed.has(victim),true);} finally {game.area.detach(fake);}
  const accountKey=victim.getLongUsername(),deadline=game.returnAt.get(accountKey);
  if(delay) {assert.ok(Number.isInteger(deadline),'canonical account deadline exists');assert.ok(deadline>C.now(),'early Exit precondition is before the real deadline');}
  await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',side===0?[3140,4952]:[3195,4952],'Exit');
  if(delay) {
    assert.equal(game.jailed.has(victim),true,'early ordinary Exit cannot bypass the negotiated delay');
    assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(accountKey),deadline);assert.ok(deadline>C.now());
    tick(deadline-C.now());
    await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',side===0?[3140,4952]:[3195,4952],'Exit');
  }
  assert.equal(game.fighters.has(victim),true);assert.equal(game.jailed.has(victim),false);assert.deepEqual(position(victim),positionAt(game,CUP_LANDINGS[side]));
});

test('native five-layout coexistence preserves old Y/face0 walls and isolates owned Forfeit cleanup',async()=>{
  const players=Array.from({length:10},()=>actor());for(const p of players) channel(p);
  const [a,b,c,d,e,f,g,h,i,j]=players;
  const old=[];
  for(const [team,arena,y,count] of [[[a,b],1,4959,52],[[c,d],2,5023,null],[[e,f],3,5087,24],[[g,h],6,4959,57]]) {
    const game=await negotiate(team[0],team[1],null,1,null,arena);for(const p of team) await join(p);
    assert.equal(game.phase,'staging');assert.ok(game.walls.length>0);if(count!==null) assert.equal(game.walls.length,count);
    for(const wall of game.walls) {
      assert.equal(wall.getFace(),0);assert.equal(wall.getLocation().getY()-game.area.getBaseY()+game.layout.origin[1],y,'existing selected layout keeps its old Y line');
    }
    old.push(game);
  }
  const [plateau,sylvan,quarry,swamp]=old;
  const cup=await negotiate(i,j,null,1,null,5);await join(i);await join(j);
  assert.equal(new Set([...old.map(game=>game.area),cup.area]).size,5);
  const foreignExit=mappedLayoutObjects(quarry,'clanwars_exitportal_greyrock_s')[0];assert.ok(foreignExit);assert.equal(Match.forfeit({player:i,object:foreignExit}),false);
  for(const p of [i,j]) {
    const side=cup.members.get(p),xy=side===0?[3144,4936]:[3191,4936],approach=side===0?[3145,4936,0]:[3190,4936,0];
    // Supplied Forfeit checkpoint; jail/orb and staging/battle movement use actual processed routes.
    p.moveTo(cup.area.at(approach));tick(2);
    await layoutObjectInput(p,cup,'clanwars_exitportal_small_purple',xy,'Forfeit');assert.equal(C.matches.has(p),false);lobby(p);
  }
  assert.equal(cup.members.size,0);assert.equal(cup.phase,'staging');const remaining=cup.starts-C.now();assert.ok(remaining>0);tick(remaining);
  assert.equal(cup.area.isDestroyed(),true);
  for(const [game,team] of [[plateau,[a,b]],[sylvan,[c,d]],[quarry,[e,f]],[swamp,[g,h]]]) {
    assert.notEqual(game.phase,'over');assert.equal(game.area.isDestroyed(),false);for(const p of team) assert.equal(C.matches.get(p),game);
  }
});

test('native Clan Cup Ignore5 uses concurrent six-fighter starts and actual defeat threshold',async()=>{
  const {a,b,teams,players,game}=await stragglerGame(6,1,3,{},5);completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.fighters.size,12);
  await lethalMelee(b,teams[0][1],game,true,[[3150,4960,0],[3151,4960,0]]);tick(6);
  assert.equal(game.phase,'over');for(const p of players) lobby(p);assert.equal(game.area.isDestroyed(),true);
});

for(const victimIndex of [0,1]) test(`native Clan Cup jail ${victimIndex} approaches all three active orbs`,async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,5);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);
  await lethalMelee(killer,victim,game,true,[[3150,4960,0],[3151,4960,0]]);tick(6);
  assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,CUP_JAILS[side]));
  const inactive=mappedLayoutObjects(game,'clanwars_viewing_darkrock')[0];assert.ok(inactive);
  assert.equal(viewingUnit().use({player:victim,object:inactive}),false,'an actual owned inactive orb is not an active Use target');
  for(const xy of CUP_ORBS[side]) {
    const scripts=scriptCalls(victim),object=await layoutObjectInput(victim,game,'clanwars_viewing_start_greyrock',xy,'Use');
    for(let cycle=0;cycle<160&&!viewingUnit().active.has(victim);cycle++) tick();
    const state=viewingUnit().active.get(victim);assert.ok(state,'ordinary route from the jail/restored approach reaches each actual active orb');
    assert.ok(Math.max(Math.abs(state.location.getX()-object.getLocation().getX()),Math.abs(state.location.getY()-object.getLocation().getY()))<=1);
    assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9755));
    console.log('CLANCUP_ORB_APPROACH_QUALIFICATION '+JSON.stringify({side,source:xy,approach:[state.location.getX(),state.location.getY(),state.location.getZ()]}));
    await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);
    assert.deepEqual(position(victim),[state.location.getX(),state.location.getY(),state.location.getZ()]);assert.equal(game.jailed.has(victim),true);
    assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);
    assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  }
  await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',side===0?[3140,4952]:[3195,4952],'Exit');
  for(let cycle=0;cycle<160&&game.jailed.has(victim);cycle++) tick();
  assert.equal(game.jailed.has(victim),false);assert.equal(game.fighters.has(victim),true);assert.deepEqual(position(victim),positionAt(game,CUP_LANDINGS[side]));
});

// K: observed cache geometry; exact player placements/barrier row are TSPS choices.
const CLASSIC_ORIGIN=[3392,4672];
const CLASSIC_LANDINGS=[[3423,4690,0],[3423,4787,0]];
const CLASSIC_JAILS=[[3448,4727,0],[3448,4744,0]];
const classicReachable=(game,from,to)=>layoutReachable(game,from,to,CLASSIC_ORIGIN);

test('native Classic selection resets agreement across all six arenas and rejects unsupported rows',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  await click(a,'clanwars_setup:accept');const session=C.negotiations.get(a);assert.equal(session.accepted.has(a),true);
  await click(b,'clanwars_setup:arena',33);assert.equal(session.rules.arena,11,'native Classic option reaches authoritative offer');
  assert.equal(session.accepted.size,0);assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(session.rules),/Classic/);
  for(const [slot,arena] of [[3,1],[6,2],[9,3],[15,5],[18,6],[33,11]]) {
    tick(9);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);
    await click(b,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,arena);assert.equal(session.accepted.size,0);
  }
  for(const slot of [45,1,2,48,22,30,42,65535]) {
    await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,11);
    assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_arena')),11);
  }
});

test('native Classic queued movement, full clip restoration and rectangular footprint and terrain walk-versus-ray',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,0,null,11);
  await join(a);await join(b);for(const p of [a,b]) assert.deepEqual(position(p),positionAt(game,CLASSIC_LANDINGS[game.members.get(p)]));
  assert.deepEqual([game.area.widthChunks,game.area.heightChunks],[8,16]);
  const reference=new core.TemplatedInstanceArea(8,16);
  try {
    for(let plane=0;plane<2;plane++) for(let x=0;x<8;x++) for(let y=0;y<16;y++) {
      reference.setChunk(plane,x,y,{sourceChunkX:424+x,sourceChunkY:584+y,sourcePlane:plane,rotation:0});
      assert.deepEqual(game.area.getChunk(plane,x,y),reference.getChunk(plane,x,y));
    }
    const baseline=[];for(let y=0;y<128;y++) for(let x=0;x<64;x++) baseline.push(reference.getClip(reference.tile(x,y,0)));
    const wallId=core.CacheDefinitions.getLocId('clanwars_barrier_darkrock'),def=core.CacheDefinitions.getObject(wallId);
    assert.deepEqual([def.sizeX,def.sizeY],[1,1]);assert.equal(game.walls.length,51);
    const walls=game.walls.slice(),{MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
    for(const wall of walls) {
      assert.equal(wall.getId(),wallId);assert.equal(wall.getPrivateArea(),game.area);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),0);
      assert.notEqual(game.area.getClip(wall.getLocation())&0x100,0);
      assert.equal(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),wall);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getPrivateArea()===game.area&&o.getId()===wallId).length,1);
    }
    for(let x=3393;x<=3445;x++) {
      const old=reference.getClip(reference.tile(x-3392,4735-4672,0));
      const count=walls.filter(o=>o.getLocation().equals(game.area.at([x,4735,0]))).length;
      assert.equal(count,old&core.RegionManager.BLOCKED_MASK?0:1,'solid source cells need no overlay');
      if(count) assert.equal(old&0x20100,0,'registration cannot clear pre-existing solid/projectile tile bits');
    }
    for(const tile of [...CLASSIC_LANDINGS,...CLASSIC_JAILS]) assert.equal(game.area.getClip(game.area.at(tile)),0,'selected landing and jail seeds are actually open');
    assert.equal(classicReachable(game,CLASSIC_LANDINGS[0],CLASSIC_LANDINGS[1]),false,'cardinal+diagonal routes including both wall ends stay separated');
    for(const side of [0,1]) assert.equal(classicReachable(game,CLASSIC_JAILS[side],CLASSIC_LANDINGS[side]),false);
    assert.equal(classicReachable(game,CLASSIC_JAILS[0],CLASSIC_JAILS[1]),false);
    for(const plane of [2,3]) assert.equal(game.area.getChunk(plane,0,0),null);
    for(const [inside,outside] of [[[3392,4690,0],[3391,4690,0]],[[3455,4690,0],[3456,4690,0]],[[3423,4672,0],[3423,4671,0]],[[3423,4799,0],[3423,4800,0]]]) {
      assert.equal(game.area.contains(game.area.at(outside)),false);
      assert.equal(core.RegionManager.canMovestart(game.area.at(inside),game.area.at(outside),1,1,game.area),false);
    }
    const walker=[a,b].find(p=>game.members.get(p)===0),open=game.area.at([3424,4690,0]),across=game.area.at([3423,4740,0]),northLanding=game.area.at(CLASSIC_LANDINGS[1]);
    await wire(walker,walkClickFrame(open));assert.deepEqual(position(walker),[open.getX(),open.getY(),0]);
    // RSMOD searches an actor-centered 128-square: this target is only 50 tiles north.
    assert.equal(reference.getClip(reference.tile(3423-3392,4740-4672,0)),0);
    assert.ok(Math.abs(across.getX()-walker.getLocation().getX())<64&&Math.abs(across.getY()-walker.getLocation().getY())<64,'staging refusal uses an in-range ordinary request');
    await wire(walker,walkClickFrame(across));tick(60);assert.equal(game.phase,'staging');
    assert.ok(walker.getLocation().getY()<game.area.at([3423,4735,0]).getY(),'decoded queued movement cannot reach north during preparation');
    const staging={requested:[across.getX(),across.getY(),0],position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()};
    completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.walls.length,0);
    for(const wall of walls) {
      assert.equal(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),null);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);
    }
    const after=[];for(let y=0;y<128;y++) for(let x=0;x<64;x++) after.push(game.area.getClip(game.area.tile(x,y,0)));
    assert.deepEqual(after,baseline,'all8192 masks preserve all source terrain and directional/projectile edges');
    assert.equal(after[(4735-4672)*64+3445-3392],0x140a,'directional/projectile edge bits survive barrier removal');
    for(const x of [3393,3394]) assert.equal(after[(4735-4672)*64+x-3392],0x200000,'skipped terrain-blocked cells remain unchanged');
    assert.equal(classicReachable(game,CLASSIC_LANDINGS[0],CLASSIC_LANDINGS[1]),true);
    await wire(walker,walkClickFrame(across));tick(320);assert.deepEqual(position(walker),[across.getX(),across.getY(),0]);
    const combat={requested:[across.getX(),across.getY(),0],position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()};
    await wire(walker,walkClickFrame(northLanding));tick(320);assert.deepEqual(position(walker),[northLanding.getX(),northLanding.getY(),0]);
    console.log('CLASSIC_MOVEMENT_QUALIFICATION '+JSON.stringify({staging,combat,landing:{position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}}));
    // A separate ordinary click returns 57 tiles south, keeping the later tree approach in range.
    const returnApproach=game.area.at([3424,4730,0]);assert.equal(game.area.getClip(returnApproach),0);
    await wire(walker,walkClickFrame(returnApproach));tick(320);assert.deepEqual(position(walker),[returnApproach.getX(),returnApproach.getY(),0]);
    for(const specimen of [
      {gameval:'wild6_tree_a',xy:[3410,4686],left:[3409,4686],right:[3412,4686],size:2,face:3,projectile:true},
      {gameval:'wild6_wall_stone_pile1',xy:[3425,4730],left:[3424,4730],right:[3426,4730],size:1,face:2,projectile:false},
    ]) {
      const obstacle=game.area.at([...specimen.xy,0]),left=game.area.at([...specimen.left,0]),right=game.area.at([...specimen.right,0]);
      const object=mappedLayoutObjects(game,specimen.gameval).find(o=>o.getLocation().equals(obstacle));assert.ok(object);
      const definition=core.CacheDefinitions.getObject(object.getId());
      assert.deepEqual([definition.sizeX,definition.sizeY,definition.clipType,definition.blocksProjectile],[specimen.size,specimen.size,2,specimen.projectile]);
      assert.equal(object.getType(),10);assert.equal(object.getFace(),specimen.face);assert.equal(object.getPrivateArea(),game.area);
      for(let y=0;y<specimen.size;y++) for(let x=0;x<specimen.size;x++) {
        assert.equal(game.area.getClip(game.area.at([specimen.xy[0]+x,specimen.xy[1]+y,0]))&0x20100,specimen.projectile?0x20100:0x100);
      }
      assert.equal(game.area.getClip(left),0);assert.equal(game.area.getClip(right),0);
      assert.equal(classicReachable(game,CLASSIC_LANDINGS[1],specimen.left),true);
      await wire(walker,walkClickFrame(left));tick(320);assert.deepEqual(position(walker),[left.getX(),left.getY(),0],'decoded queued walk reaches the actual open obstacle approach');
      await wire(walker,walkClickFrame(obstacle));
      for(let cycle=0;cycle<10;cycle++) {
        tick();const here=walker.getLocation();assert.equal(core.RegionManager.blocked(here,game.area),false);
        assert.equal(here.getX()>=obstacle.getX()&&here.getX()<obstacle.getX()+specimen.size&&here.getY()>=obstacle.getY()&&here.getY()<obstacle.getY()+specimen.size,false,'every processed step stays outside the full footprint');
      }
      console.log('CLASSIC_OBSTACLE_MOVEMENT_QUALIFICATION '+JSON.stringify({gameval:specimen.gameval,requested:[obstacle.getX(),obstacle.getY(),0],position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}));
      assert.equal(core.RegionManager.canMovestart(left,obstacle,1,1,game.area),false);
      assert.equal(core.RegionManager.canProjectileAttackReturn(left,right,1,game.area),!specimen.projectile,'selected source terrain distinguishes walking from the native ray');
    }
    const o1=game.area.at([3423,4690,0]),o2=game.area.at([3424,4690,0]);
    assert.equal(core.RegionManager.canMovestart(o1,o2,1,1,game.area),true);assert.equal(core.RegionManager.canProjectileAttackReturn(o1,o2,1,game.area),true,'open ray positive control');
  } finally {reference.destroy();assert.equal(reference.isDestroyed(),true);}
});

for(const mode of [0,1,16]) test(`native Classic mode ${mode} retains restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},11);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3423,4690,0]));b.moveTo(game.area.at([3424,4690,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,CLASSIC_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of [0,1]) test(`native Classic side ${victimIndex} death metadata, jail approach and viewing model`,async()=>{
  const outsiders=[actor(),actor()];for(const p of outsiders) channel(p);
  const foreignGame=await negotiate(outsiders[0],outsiders[1],null,1,null,1);for(const p of outsiders) await join(p);
  const a=actor(true),b=actor(true),delay=victimIndex===1?1:0;channel(a);channel(b);const game=await negotiate(a,b,null,1,{rejoiningdelay:delay},11);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);
  victim.getInventory().add(new core.Item(995,79,{qa:'classic'}));
  await lethalMelee(killer,victim,game,true,[[3423,4690,0],[3424,4690,0]]);tick(6);
  assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,CLASSIC_JAILS[side]));
  assert.equal(victim.getInventory().getAmount(995),79);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'classic'});
  const foreignPortal=mappedLayoutObjects(foreignGame,'clanwars_prisonportal_darkrock')[0],foreignOrb=mappedLayoutObjects(foreignGame,'clanwars_viewing_start_darkrock')[0];assert.ok(foreignPortal&&foreignOrb);
  assert.equal(Match.exit({player:victim,object:foreignPortal}),false,'valid jailed member cannot use the real same-ID portal of another match');
  assert.equal(viewingUnit().use({player:victim,object:foreignOrb}),false,'valid jailed member cannot use a real same-ID foreign orb');
  assert.equal(C.matches.get(victim),game);assert.equal(game.jailed.has(victim),true);
  const inactive=mappedLayoutObjects(game,'clanwars_viewing_darkrock')[0];assert.ok(inactive);
  assert.equal(viewingUnit().use({player:victim,object:inactive}),false,'actual owned inactive orb is not an active Use target');
  const scripts=scriptCalls(victim),orbXY=side===0?[3450,4720]:[3450,4751];
  await layoutObjectInput(victim,game,'clanwars_viewing_start_darkrock',orbXY,'Use');
  assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));const state=viewingUnit().active.get(victim);assert.ok(state);
  const at=game.area.at([...orbXY,0]);assert.ok(Math.max(Math.abs(state.location.getX()-at.getX()),Math.abs(state.location.getY()-at.getY()))<=1);
  assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9752));
  console.log('CLASSIC_ORB_APPROACH_QUALIFICATION '+JSON.stringify({side,source:orbXY,approach:[state.location.getX(),state.location.getY(),state.location.getZ()]}));
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);
  assert.deepEqual(position(victim),[state.location.getX(),state.location.getY(),state.location.getZ()]);
  assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);
  assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const ownedPortal=mappedLayoutObjects(game,'clanwars_prisonportal_darkrock').find(o=>o.getLocation().equals(game.area.at([...(side===0?[3450,4734]:[3450,4737]),0])));assert.ok(ownedPortal);
  const fake=new core.GameObject(ownedPortal.getId(),ownedPortal.getLocation().clone(),ownedPortal.getType(),ownedPortal.getFace(),game.area);
  try {assert.equal(Match.exit({player:victim,object:fake}),false);assert.equal(game.jailed.has(victim),true);} finally {game.area.detach(fake);}
  const accountKey=victim.getLongUsername(),deadline=game.returnAt.get(accountKey);
  if(delay) {assert.ok(Number.isInteger(deadline),'canonical account deadline exists');assert.ok(deadline>C.now(),'early Exit precondition is before the real deadline');}
  await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',side===0?[3450,4734]:[3450,4737],'Exit');
  if(delay) {
    assert.equal(game.jailed.has(victim),true,'early ordinary Exit cannot bypass the negotiated delay');
    assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(accountKey),deadline);assert.ok(deadline>C.now());
    tick(deadline-C.now());
    await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',side===0?[3450,4734]:[3450,4737],'Exit');
  }
  assert.equal(game.fighters.has(victim),true);assert.equal(game.jailed.has(victim),false);assert.deepEqual(position(victim),positionAt(game,CLASSIC_LANDINGS[side]));
});

test('native six-layout coexistence preserves five square layouts and isolates footprint-aware owned Forfeit cleanup',async()=>{
  const players=Array.from({length:12},()=>actor());for(const p of players) channel(p);
  const old=[];
  for(const [offset,arena,axis,coordinate,face,count] of [[0,1,'y',4959,0,52],[2,2,'y',5023,0,null],[4,3,'y',5087,0,24],[6,6,'y',4959,0,57],[8,5,'x',3167,1,43]]) {
    const team=players.slice(offset,offset+2),game=await negotiate(team[0],team[1],null,1,null,arena);for(const p of team) await join(p);
    assert.deepEqual([game.area.widthChunks,game.area.heightChunks],[8,8]);assert.equal(game.phase,'staging');assert.ok(game.walls.length>0);if(count!==null) assert.equal(game.walls.length,count);
    for(const wall of game.walls) {
      assert.equal(wall.getFace(),face);
      const actual=axis==='x'?wall.getLocation().getX()-game.area.getBaseX()+game.layout.origin[0]:wall.getLocation().getY()-game.area.getBaseY()+game.layout.origin[1];
      assert.equal(actual,coordinate,'old layout native placement and selected axis/face remain exact');
    }
    old.push({game,team});
  }
  const [a,b]=players.slice(10),game=await negotiate(a,b,null,1,null,11);await join(a);await join(b);
  assert.equal(new Set([...old.map(x=>x.game.area),game.area]).size,6);
  const foreign=mappedLayoutObjects(old[0].game,'clanwars_exitportal_darkrock_s')[0];assert.ok(foreign);assert.equal(Match.forfeit({player:a,object:foreign}),false);
  const {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
  for(const player of [a,b]) {
    const side=game.members.get(player),xy=side===0?[3421,4681]:[3423,4789],approach=side===0?[3423,4683,0]:[3423,4788,0];
    const object=mappedLayoutObjects(game,'clanwars_exitportal_darkrock_s').find(o=>o.getLocation().equals(game.area.at([...xy,0])));assert.ok(object);
    assert.deepEqual([object.getDefinition().sizeX,object.getDefinition().sizeY],[4,2]);assert.equal(object.getFace(),side===0?0:2);
    const fake=new core.GameObject(object.getId(),object.getLocation().clone(),object.getType(),object.getFace(),game.area);
    try {assert.equal(Match.forfeit({player,object:fake}),false);} finally {game.area.detach(fake);}
    // Supplied footprint-perimeter checkpoint. It is not a natural traversal claim.
    player.moveTo(game.area.at(approach));tick(2);assert.equal(game.area.getClip(player.getLocation()),0);
    assert.equal(MapObjects.getPrivateArea(player,object.getId(),object.getLocation()),object);
    await layoutObjectInput(player,game,'clanwars_exitportal_darkrock_s',xy,'Forfeit');assert.equal(C.matches.has(player),false);lobby(player);
  }
  assert.equal(game.members.size,0);assert.equal(game.phase,'staging');const remaining=game.starts-C.now();assert.ok(remaining>0);tick(remaining);
  assert.equal(game.area.isDestroyed(),true);
  for(const {game:other,team} of old) {
    assert.notEqual(other.phase,'over');assert.equal(other.area.isDestroyed(),false);for(const p of team) assert.equal(C.matches.get(p),other);
  }
});

test('native Classic Ignore5 uses concurrent six-fighter starts and actual defeat threshold',async()=>{
  const {a,b,teams,players,game}=await stragglerGame(6,1,3,{},11);completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.fighters.size,12);
  await lethalMelee(b,teams[0][1],game,true,[[3423,4690,0],[3424,4690,0]]);tick(6);
  assert.equal(game.phase,'over');for(const p of players) lobby(p);assert.equal(game.area.isDestroyed(),true);
});


// L: source-qualified Lumbridge choices; canonical producers, actual native listener routes.
const LUMBRIDGE_ORIGIN=[3392,4800];
const LUMBRIDGE_LANDINGS=[[3417,4810,0],[3417,4843,0]];
const LUMBRIDGE_JAILS=[[3436,4822,0],[3436,4831,0]];
const lumbridgeReachable=(game,from,to)=>layoutReachable(game,from,to,LUMBRIDGE_ORIGIN);
function lumbridgeObject(game,gameval,xy,plane=0) {
  const id=core.CacheDefinitions.getLocId(gameval),at=game.area.at([...xy,plane]);
  const found=[];
  for(let x=0;x<game.area.widthChunks;x++)for(let y=0;y<game.area.heightChunks;y++)
    found.push(...game.area.getChunkObjects(plane,x,y).filter(o=>o.getId()===id&&o.getLocation().equals(at)));
  assert.equal(found.length,1,'actual uniquely owned observed template loc');assert.equal(found[0].getPrivateArea(),game.area);return found[0];
}
async function lumbridgeWalk(p,game,xy) {
  const at=game.area.at([...xy,0]);assert.ok(Math.abs(p.getLocation().getX()-at.getX())<64&&Math.abs(p.getLocation().getY()-at.getY())<64,'ordinary click in RSMOD search window');
  await wire(p,walkClickFrame(at));tick(80);assert.deepEqual(position(p),[at.getX(),at.getY(),0],'processed ordinary walk reaches exact endpoint');
}
function lumbridgeObjectClick(p,o,action) {
  const actions=o.getDefinition().getInteractions(),op=actions.findIndex(a=>a?.toLowerCase()===action.toLowerCase())+1;assert.ok(op>0);
  const {ObjectActionPacketListener}=require('../dist/net/packet/impl/ObjectActionPacketListener');
  new ObjectActionPacketListener().executeAction(p,o.getId(),o.getLocation().getX(),o.getLocation().getY(),op);
}
function treeTask(tree) {return [...core.TaskManager.pendingTasks.toArray(),...core.TaskManager.activeTasks].find(t=>t.originalTreeObject===tree&&t.isRunning());}
function resourceRandom(t) {t.mock.method(Math,'random',()=>new Error().stack.includes('rollLog')?0.001:0.99);}
async function chopTree(p,tree) {
  const I=core.ItemIdentifiers;const skills=p.getSkillManager();skills.setCurrentLevel(core.Skill.WOODCUTTING,99);skills.setMaxLevel(core.Skill.WOODCUTTING,99);
  if(!p.getInventory().contains(I.BRONZE_AXE))p.getInventory().add(new core.Item(I.BRONZE_AXE));
  const before=p.getInventory().getAmount(I.LOGS);lumbridgeObjectClick(p,tree,'Chop down');
  for(let i=0;i<40&&!treeTask(tree);i++)tick();
  const task=treeTask(tree);assert.ok(task,'ordinary chop actually depleted and scheduled canonical respawn');
  assert.equal(p.getInventory().getAmount(I.LOGS),before+1,'ordinary chopping awards actual log');
  assert.equal(task.stumpObject.getPrivateArea(),tree.getPrivateArea());
  assert.equal(core.MapObjects.get(task.stumpObject.getId(),task.stumpObject.getLocation(),tree.getPrivateArea()),task.stumpObject);
  return task;
}

// Independent canonical guard regression: does not require missing Layout12 admission.
test('native canonical tree respawn respects destroyed private area while live private and world respawn',async t=>{
  resourceRandom(t);
  const make=()=>{const area=new core.TemplatedInstanceArea(8,8);for(let z=0;z<2;z++)for(let x=0;x<8;x++)for(let y=0;y<8;y++)area.setChunk(z,x,y,{sourceChunkX:424+x,sourceChunkY:600+y,sourcePlane:z,rotation:0});area.at=tile=>area.tile(tile[0]-3392,tile[1]-4800,tile[2]);return {area,layout:{origin:LUMBRIDGE_ORIGIN}};};
  const dead=make(),live=make(),replacement=[];const players=[actor(true),actor(true),actor(true)];const trees=[];const tasks=[];
  try {
    for(const [index,game]of [[0,dead],[1,live]]){const p=players[index];p.moveTo(game.area.at([3419,4840,0]));game.area.add(p);tick();const tree=lumbridgeObject(game,'tree2',[3420,4840]);trees.push(tree);}
    const world=players[2];world.moveTo(new core.Location(3222,3218,0));core.RegionManager.loadMapFiles(3222,3218);
    const tree=new core.GameObject(trees[0].getId(),new core.Location(3223,3218,0),10,2,null);core.ObjectManager.register(tree,true);trees.push(tree);tick();
    // Independent ordinary native starts, simultaneous pending delays, no timer rewinds.
    for(let i=0;i<3;i++)tasks.push(await chopTree(players[i],trees[i]));
    assert.ok(tasks.every(task=>task.isRunning()&&task.getRemainingTicks()>0),'all three real delayed respawns pending');
    const deadBase=[dead.area.getBaseX(),dead.area.getBaseY()];players[0].moveTo(new core.Location(3128,3627,0));dead.area.detach(players[0]);players[0].setArea(null);dead.area.destroy();assert.equal(dead.area.isDestroyed(),true);
    const reused=make();replacement.push(reused);assert.deepEqual([reused.area.getBaseX(),reused.area.getBaseY()],deadBase,'actual template slot is reused');
    const replacementTree=lumbridgeObject(reused,'tree2',[3420,4840]);const oldClip=reused.area.getClip(replacementTree.getLocation());
    const remaining=Math.max(...tasks.map(task=>task.getRemainingTicks()));tick(remaining+2);
    assert.equal(tasks.every(task=>task.isStopped()),true);
    for(const object of [trees[0],tasks[0].stumpObject]){
      assert.equal(core.World.getObjects().includes(object),false,'no delayed old-area tree/stump world resurrection');
      assert.equal(core.World.getRemovedObjects().includes(object),false);
      assert.equal(core.ObjectManager.objectsAt(object.getLocation()).includes(object),false);
      assert.equal(dead.area.getObjects().includes(object),false);
    }
    assert.equal(core.MapObjects.get(trees[0].getId(),trees[0].getLocation(),dead.area),null,'destroyed resolver remains empty');
    assert.equal(reused.area.resolveObject(replacementTree.getId(),replacementTree.getLocation()),replacementTree);
    assert.equal(reused.area.getClip(replacementTree.getLocation()),oldClip,'reused live slot preserves its own native masks');
    for(let i=1;i<3;i++){
      assert.equal(core.World.getObjects().includes(trees[i]),true,'canonical live/world respawn really registered original');
      assert.equal(i===1?live.area.resolveObject(trees[i].getId(),trees[i].getLocation()):core.MapObjects.get(trees[i].getId(),trees[i].getLocation(),null),trees[i]);
    }
  } finally {
    for(const task of tasks){task.stop();if(core.World.getObjects().includes(task.stumpObject))core.ObjectManager.deregister(task.stumpObject,true);}
    for(const tree of trees)if(core.World.getObjects().includes(tree))core.ObjectManager.deregister(tree,true);
    for(const p of players){p.getPrivateArea()?.detach(p);p.setArea(null);p.moveTo(new core.Location(3128,3627,0));}
    for(const g of [dead,live,...replacement])g.area.destroy();
    const owned=new Set([dead.area,live.area,...replacement.map(g=>g.area)]);const removed=core.World.getRemovedObjects();
    for(let i=removed.length-1;i>=0;i--)if(owned.has(removed[i].getPrivateArea()))removed.splice(i,1);
  }
});
test('native Lumbridge Castle selection resets agreement across all seven arenas and rejects unsupported rows',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  await click(a,'clanwars_setup:accept');const session=C.negotiations.get(a);assert.equal(session.accepted.has(a),true);
  await click(b,'clanwars_setup:arena',36);assert.equal(session.rules.arena,12,'native Lumbridge Castle option reaches authoritative offer');
  assert.equal(session.accepted.size,0);assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(session.rules),/Lumbridge Castle/);
  for(const [slot,arena] of [[3,1],[6,2],[9,3],[15,5],[18,6],[33,11],[36,12]]) {
    tick(9);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);
    await click(b,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,arena);assert.equal(session.accepted.size,0);
  }
  for(const slot of [45,1,2,48,22,30,42,65535]) {
    await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,12);
    assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_arena')),12);
  }
});


for(const mode of [0,1,16]) test(`native Lumbridge Castle mode ${mode} retains restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},12);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3417,4810,0]));b.moveTo(game.area.at([3418,4810,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,LUMBRIDGE_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of [0,1]) test(`native Lumbridge Castle side ${victimIndex} death metadata, jail approach and viewing model`,async()=>{
  const outsiders=[actor(),actor()];for(const p of outsiders) channel(p);
  const foreignGame=await negotiate(outsiders[0],outsiders[1],null,1,null,6);for(const p of outsiders) await join(p);
  const orbOutsiders=[actor(),actor()];for(const p of orbOutsiders)channel(p);const orbForeign=await negotiate(orbOutsiders[0],orbOutsiders[1],null,1,null,3);
  const a=actor(true),b=actor(true),delay=victimIndex===1?1:0;channel(a);channel(b);const game=await negotiate(a,b,null,1,{rejoiningdelay:delay},12);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);
  victim.getInventory().add(new core.Item(995,79,{qa:'lumbridge'}));
  await lethalMelee(killer,victim,game,true,[[3417,4810,0],[3418,4810,0]]);tick(6);
  assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,LUMBRIDGE_JAILS[side]));
  assert.equal(victim.getInventory().getAmount(995),79);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'lumbridge'});
  const foreignPortal=mappedLayoutObjects(foreignGame,'clanwars_prisonportal_swamp')[0],foreignOrb=mappedLayoutObjects(orbForeign,'clanwars_viewing_start_greyrock')[0];assert.ok(foreignPortal&&foreignOrb);
  assert.equal(Match.exit({player:victim,object:foreignPortal}),false,'valid jailed member cannot use the real same-ID portal of another match');
  assert.equal(viewingUnit().use({player:victim,object:foreignOrb}),false,'valid jailed member cannot use a real same-ID foreign orb');
  assert.equal(C.matches.get(victim),game);assert.equal(game.jailed.has(victim),true);
  const inactive=mappedLayoutObjects(game,'clanwars_viewing_greyrock')[0];assert.ok(inactive);
  assert.equal(viewingUnit().use({player:victim,object:inactive}),false,'actual owned inactive orb is not an active Use target');
  const scripts=scriptCalls(victim),orbXY=side===0?[3436,4823]:[3436,4830];
  await layoutObjectInput(victim,game,'clanwars_viewing_start_greyrock',orbXY,'Use');
  assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));const state=viewingUnit().active.get(victim);assert.ok(state);
  const at=game.area.at([...orbXY,0]);assert.ok(Math.max(Math.abs(state.location.getX()-at.getX()),Math.abs(state.location.getY()-at.getY()))<=1);
  assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9755));
  console.log('LUMBRIDGE_ORB_APPROACH_QUALIFICATION '+JSON.stringify({side,source:orbXY,approach:[state.location.getX(),state.location.getY(),state.location.getZ()]}));
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);
  assert.deepEqual(position(victim),[state.location.getX(),state.location.getY(),state.location.getZ()]);
  assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);
  assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const ownedPortal=mappedLayoutObjects(game,'clanwars_prisonportal_swamp').find(o=>o.getLocation().equals(game.area.at([...(side===0?[3437,4820]:[3437,4833]),0])));assert.ok(ownedPortal);
  const fake=new core.GameObject(ownedPortal.getId(),ownedPortal.getLocation().clone(),ownedPortal.getType(),ownedPortal.getFace(),game.area);
  try {assert.equal(Match.exit({player:victim,object:fake}),false);assert.equal(game.jailed.has(victim),true);} finally {game.area.detach(fake);}
  const accountKey=victim.getLongUsername(),deadline=game.returnAt.get(accountKey);
  if(delay) {assert.ok(Number.isInteger(deadline),'canonical account deadline exists');assert.ok(deadline>C.now(),'early Exit precondition is before the real deadline');}
  await layoutObjectInput(victim,game,'clanwars_prisonportal_swamp',side===0?[3437,4820]:[3437,4833],'Exit');
  if(delay) {
    assert.equal(game.jailed.has(victim),true,'early ordinary Exit cannot bypass the negotiated delay');
    assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(accountKey),deadline);assert.ok(deadline>C.now());
    tick(deadline-C.now());
    await layoutObjectInput(victim,game,'clanwars_prisonportal_swamp',side===0?[3437,4820]:[3437,4833],'Exit');
  }
  assert.equal(game.fighters.has(victim),true);assert.equal(game.jailed.has(victim),false);assert.deepEqual(position(victim),positionAt(game,LUMBRIDGE_LANDINGS[side]));
});

test('native seven-layout coexistence preserves old square and rectangular layouts and isolates footprint-aware owned Forfeit cleanup',async()=>{
  const players=Array.from({length:14},()=>actor());for(const p of players) channel(p);
  const old=[];
  for(const [offset,arena,axis,coordinate,face,count] of [[0,1,'y',4959,0,52],[2,2,'y',5023,0,null],[4,3,'y',5087,0,24],[6,6,'y',4959,0,57],[8,5,'x',3167,1,43],[10,11,'y',4735,0,51]]) {
    const team=players.slice(offset,offset+2),game=await negotiate(team[0],team[1],null,1,null,arena);for(const p of team) await join(p);
    assert.deepEqual([game.area.widthChunks,game.area.heightChunks],[8,arena===11?16:8]);assert.equal(game.phase,'staging');assert.ok(game.walls.length>0);if(count!==null) assert.equal(game.walls.length,count);
    for(const wall of game.walls) {
      assert.equal(wall.getFace(),face);
      const actual=axis==='x'?wall.getLocation().getX()-game.area.getBaseX()+game.layout.origin[0]:wall.getLocation().getY()-game.area.getBaseY()+game.layout.origin[1];
      assert.equal(actual,coordinate,'old layout native placement and selected axis/face remain exact');
    }
    old.push({game,team});
  }
  const [a,b]=players.slice(12),game=await negotiate(a,b,null,1,null,12);await join(a);await join(b);
  assert.equal(new Set([...old.map(x=>x.game.area),game.area]).size,7);
  const foreign=mappedLayoutObjects(old[0].game,'clanwars_exitportal_darkrock_s')[0];assert.ok(foreign);assert.equal(Match.forfeit({player:a,object:foreign}),false);
  const {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
  for(const player of [a,b]) {
    const side=game.members.get(player),xy=side===0?[3417,4809]:[3417,4844],approach=side===0?[3417,4810,0]:[3417,4843,0];
    const object=mappedLayoutObjects(game,side===0?'clanwars_exitportal_smallwood_s':'clanwars_exitportal_smallwood_n').find(o=>o.getLocation().equals(game.area.at([...xy,0])));assert.ok(object);
    assert.deepEqual([object.getDefinition().sizeX,object.getDefinition().sizeY],[2,1]);assert.equal(object.getFace(),side===0?0:2);
    const fake=new core.GameObject(object.getId(),object.getLocation().clone(),object.getType(),object.getFace(),game.area);
    try {assert.equal(Match.forfeit({player,object:fake}),false);} finally {game.area.detach(fake);}
    // Supplied footprint-perimeter checkpoint. It is not a natural traversal claim.
    player.moveTo(game.area.at(approach));tick(2);assert.equal(game.area.getClip(player.getLocation()),0);
    assert.equal(MapObjects.getPrivateArea(player,object.getId(),object.getLocation()),object);
    await layoutObjectInput(player,game,side===0?'clanwars_exitportal_smallwood_s':'clanwars_exitportal_smallwood_n',xy,'Forfeit');assert.equal(C.matches.has(player),false);lobby(player);
  }
  assert.equal(game.members.size,0);assert.equal(game.phase,'staging');const remaining=game.starts-C.now();assert.ok(remaining>0);tick(remaining);
  assert.equal(game.area.isDestroyed(),true);
  for(const {game:other,team} of old) {
    assert.notEqual(other.phase,'over');assert.equal(other.area.isDestroyed(),false);for(const p of team) assert.equal(C.matches.get(p),other);
  }
});

test('native Lumbridge Castle Ignore5 uses concurrent six-fighter starts and actual defeat threshold',async()=>{
  const {a,b,teams,players,game}=await stragglerGame(6,1,3,{},12);completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.fighters.size,12);
  await lethalMelee(b,teams[0][1],game,true,[[3417,4810,0],[3418,4810,0]]);tick(6);
  assert.equal(game.phase,'over');for(const p of players) lobby(p);assert.equal(game.area.isDestroyed(),true);
});

test('native Lumbridge full masks and owned walls preserve source geometry with ordinary causal crossing',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,0,null,12);await join(a);await join(b);
  assert.deepEqual([game.area.widthChunks,game.area.heightChunks],[8,8]);
  for(const p of [a,b])assert.deepEqual(position(p),positionAt(game,LUMBRIDGE_LANDINGS[game.members.get(p)]));
  const reference=new core.TemplatedInstanceArea(8,8);
  try {
    for(let z=0;z<2;z++)for(let x=0;x<8;x++)for(let y=0;y<8;y++){
      reference.setChunk(z,x,y,{sourceChunkX:424+x,sourceChunkY:600+y,sourcePlane:z,rotation:0});assert.deepEqual(game.area.getChunk(z,x,y),reference.getChunk(z,x,y));
    }
    const baseline=[];for(let y=0;y<64;y++)for(let x=0;x<64;x++)baseline.push(reference.getClip(reference.tile(x,y,0)));
    const id=core.CacheDefinitions.getLocId('clanwars_barrier_greyrock'),definition=core.CacheDefinitions.getObject(id),walls=game.walls.slice();
    assert.deepEqual([definition.sizeX,definition.sizeY,definition.clipType,definition.blocksProjectile],[1,1,1,true]);assert.equal(walls.length,29);
    for(const wall of walls){
      assert.equal(wall.getId(),id);assert.equal(wall.getPrivateArea(),game.area);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),0);
      assert.equal(core.RegionManager.blocked(wall.getLocation(),game.area),true);assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),wall);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getId()===id&&o.getPrivateArea()===game.area).length,1);
    }
    for(let x=3407;x<=3437;x++){
      const old=baseline[(4826-4800)*64+x-3392],at=game.area.at([x,4826,0]);const found=walls.filter(w=>w.getLocation().equals(at));
      assert.equal(found.length,old&core.RegionManager.BLOCKED_MASK?0:1);if(found.length)assert.equal(old&0x20100,0);
    }
    for(const xy of [...LUMBRIDGE_LANDINGS,...LUMBRIDGE_JAILS])assert.equal(game.area.getClip(game.area.at(xy)),0);
    assert.equal(lumbridgeReachable(game,LUMBRIDGE_LANDINGS[0],LUMBRIDGE_LANDINGS[1]),false);
    for(const j of LUMBRIDGE_JAILS)for(const landing of LUMBRIDGE_LANDINGS)assert.equal(lumbridgeReachable(game,j,landing),false);
    assert.equal(lumbridgeReachable(game,LUMBRIDGE_JAILS[0],LUMBRIDGE_JAILS[1]),false);
    for(const outside of [[3405,4826,0],[3439,4826,0],[3417,4807,0],[3417,4848,0]])assert.equal(lumbridgeReachable(game,LUMBRIDGE_LANDINGS[0],outside),false,'source seals separate interior from exterior');
    for(const z of [2,3]){assert.equal(game.area.getChunk(z,0,0),null);assert.notEqual(game.area.getClip(game.area.at([3417,4810,z]))&0x200100,0);}
    for(const [inside,outside]of [[[3392,4826,0],[3391,4826,0]],[[3455,4826,0],[3456,4826,0]],[[3417,4800,0],[3417,4799,0]],[[3417,4863,0],[3417,4864,0]]])assert.equal(core.RegionManager.canMovestart(game.area.at(inside),game.area.at(outside),1,1,game.area),false);
    const walker=[a,b].find(p=>game.members.get(p)===0);await lumbridgeWalk(walker,game,[3422,4824]);const target=game.area.at([3422,4828,0]);
    await wire(walker,walkClickFrame(target));tick(30);assert.equal(game.phase,'staging');assert.ok(walker.getLocation().getY()<game.area.at([3422,4826,0]).getY());
    const state=()=>({position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()});const staging=state();
    completePreparation(game);assert.equal(game.walls.length,0);
    for(const wall of walls){assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),null);assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);}
    const after=[];for(let y=0;y<64;y++)for(let x=0;x<64;x++)after.push(game.area.getClip(game.area.tile(x,y,0)));
    assert.deepEqual(after,baseline,'full4096native masks before intentional door/resource mutations');
    for(const [x,mask]of [[3407,0x82c1],[3412,0x1008],[3414,0x4020],[3421,0x10080],[3437,0x8],[3413,0x3c1e0],[3420,0x355aa]])assert.equal(after[26*64+x-3392],mask);
    assert.equal(lumbridgeReachable(game,LUMBRIDGE_LANDINGS[0],LUMBRIDGE_LANDINGS[1]),true);
    await lumbridgeWalk(walker,game,[3422,4828]);console.log('LUMBRIDGE_MOVEMENT_QUALIFICATION '+JSON.stringify({requested:[target.getX(),target.getY(),0],staging,combat:state()}));
    await lumbridgeWalk(walker,game,LUMBRIDGE_LANDINGS[1].slice(0,2));
  } finally {reference.destroy();}
});

test('native Lumbridge canonical internal doors preserve preparation, seals, jails and ground-floor access',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,12);await join(a);await join(b);
  const p=[a,b].find(p=>game.members.get(p)===0),wallIds=game.walls.slice();
  const door=lumbridgeObject(game,'elfdoor',[3415,4825]);
  // Supplied ground checkpoint selects the actual reachable door side; native route opens it.
  p.moveTo(game.area.at([3415,4824,0]));tick();lumbridgeObjectClick(p,door,'Open');tick(12);
  assert.ok(core.World.getRemovedObjects().some(object=>object.equals(door)),'native ordinary Open records the actual owned internal door removal');
  const openDoor=game.area.getObjects().find(o=>o.getId()!==door.getId()&&o.getDefinition()?.getName()==='Door'&&o.getDefinition().getInteractions()?.includes('Close'));assert.ok(openDoor,'canonical owned open leaf exists');
  lumbridgeObjectClick(p,openDoor,'Close');tick(12);
  const restored=game.area.getObjects().find(o=>o.getId()===door.getId()&&o.getLocation().equals(door.getLocation()));assert.ok(restored);assert.equal(restored.getFace(),door.getFace());
  assert.equal(core.World.getRemovedObjects().some(object=>object.equals(door)),false,'canonical close clears original removal marker');
  const north=[a,b].find(actor=>game.members.get(actor)===1);north.moveTo(game.area.at([3422,4829,0]));tick();
  const double=lumbridgeObject(game,'castledoubledoorl',[3421,4829]);lumbridgeObjectClick(north,double,'Open');tick(12);
  assert.ok(core.World.getRemovedObjects().some(object=>object.equals(double)));
  assert.equal(lumbridgeReachable(game,LUMBRIDGE_LANDINGS[0],LUMBRIDGE_LANDINGS[1]),false,'canonical double-door opening during preparation cannot bypass wall');
  const opened=game.area.getObjects().find(o=>o.getDefinition()?.getName()==='Large door'&&o.getDefinition().getInteractions()?.includes('Close'));assert.ok(opened);
  lumbridgeObjectClick(north,opened,'Close');tick(12);
  assert.ok(game.area.getObjects().some(o=>o.getId()===double.getId()&&o.getLocation().equals(double.getLocation())),'double door closes to its original location');
  assert.equal(lumbridgeReachable(game,LUMBRIDGE_LANDINGS[0],LUMBRIDGE_LANDINGS[1]),false,'opened internal door cannot bypass native staging walls');
  for(const wall of wallIds)assert.equal(core.RegionManager.blocked(wall.getLocation(),game.area),true);
  completePreparation(game);await lumbridgeWalk(p,game,[3422,4829]);
  const large=lumbridgeObject(game,'castledoubledoorl',[3421,4829]);lumbridgeObjectClick(p,large,'Open');tick(12);
  assert.ok(core.World.getRemovedObjects().some(object=>object.equals(large)),'canonical double door records its actual private closed-leaf removal');
  assert.ok(game.area.getObjects().some(o=>o.getPrivateArea()===game.area&&o.getDefinition()?.getName()==='Large door'&&o.getDefinition().getInteractions()?.includes('Close')),'actual owned double-door opened leaf');
  await lumbridgeWalk(p,game,[3419,4829]);
  // Room access is an ordinary door route, not a seeded membership or clipping override.
  for(const xy of [[3405,4826],[3439,4826]]){
    const beforeZ=p.getLocation().getZ();await wire(p,walkClickFrame(game.area.at([...xy,0])));tick(30);
    const sourceX=p.getLocation().getX()-game.area.getBaseX()+3392;assert.ok(sourceX>=3407&&sourceX<=3437);assert.equal(p.getLocation().getZ(),beforeZ);
  }
  for(const xy of [[3406,4826],[3409,4826],[3438,4826],[3438,4827]]){
    const candidates=game.area.getTemplateObjects(game.area.at([...xy,0]));const boundary=candidates.find(o=>[1548,1554,1555].includes(o.getId()));assert.ok(boundary);
    assert.equal((boundary.getDefinition().getInteractions()??[]).some(a=>a?.toLowerCase()==='open'),false);
  }
  for(const xy of [[3412,4815],[3412,4837]]){
    const stair=lumbridgeObject(game,'spiralstairs',xy,1);assert.equal(stair.getLocation().getZ(),1);
    const before=position(p);lumbridgeObjectClick(p,stair,'Climb-up');tick(20);
    assert.equal(p.getLocation().getZ(),0,'ground actor cannot resolve upper-floor staircase as a ground loc');assert.deepEqual(position(p),before);
  }
  for(const jail of LUMBRIDGE_JAILS)assert.equal(lumbridgeReachable(game,LUMBRIDGE_LANDINGS[0],jail),false,'internal door changes leave both gatehouse jails isolated');
  for(const xy of [[3436,4822],[3436,4831]]){await wire(p,walkClickFrame(game.area.at([...xy,0])));tick(30);assert.notDeepEqual(position(p),positionAt(game,[...xy,0]));assert.equal(p.getLocation().getZ(),0);}
});

function lumbridgeItemOnObject(p,object,itemId) {
  const slot=p.getInventory().getSlotForItemId(itemId);assert.ok(slot>=0);
  assert.equal(core.MapObjects.getPrivateArea(p,object.getId(),object.getLocation()),object);
  const {UseItemPacketListener}=require('../dist/net/packet/impl/UseItemPacketListener');
  UseItemPacketListener.itemOnObject(p,C.uid('inventory:items'),object.getId(),itemId,slot,object.getLocation().getX(),object.getLocation().getY());
}

test('native Lumbridge actionless sink and both fountains fill real metadata containers and cancel on ordinary movement',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,12);await join(a);await join(b);completePreparation(game);
  const p=a,I=core.ItemIdentifiers;
  for(const [gameval,xy,approach]of [['qip_cook_sink',[3413,4823],[3413,4822]],['fountain',[3429,4818],[3428,4818]],['fountain',[3429,4834],[3428,4834]]]){
    await lumbridgeWalk(p,game,approach);const object=lumbridgeObject(game,gameval,xy);
    assert.equal((object.getDefinition().getInteractions()??[]).some(Boolean),false,'water item-use remains available without a direct option');
    const before=p.getInventory().getAmount(I.VIAL_OF_WATER);give(p,I.VIAL,`lumbridge-water-${xy}`);
    lumbridgeItemOnObject(p,object,I.VIAL);for(let i=0;i<40&&p.getInventory().getAmount(I.VIAL)>0;i++)tick();
    assert.equal(p.getInventory().getAmount(I.VIAL),0);assert.equal(p.getInventory().getAmount(I.VIAL_OF_WATER),before+1);
    assert.ok(p.getInventory().getValidItems().some(i=>i.getId()===I.VIAL_OF_WATER&&i.getMeta()?.qa===`lumbridge-water-${xy}`));
    console.log('LUMBRIDGE_WATER_QUALIFICATION '+JSON.stringify({source:xy,id:object.getId(),owned:object.getPrivateArea()===game.area,position:position(p)}));
  }
  const sink=lumbridgeObject(game,'qip_cook_sink',[3413,4823]);await lumbridgeWalk(p,game,[3413,4822]);
  for(let i=0;i<8;i++)give(p,I.VIAL,'water-cancel');
  const before=p.getInventory().getAmount(I.VIAL_OF_WATER);lumbridgeItemOnObject(p,sink,I.VIAL);
  for(let i=0;i<20&&p.getInventory().getAmount(I.VIAL_OF_WATER)===before;i++)tick();
  assert.ok(p.getInventory().getAmount(I.VIAL_OF_WATER)>before);assert.ok(p.getInventory().getAmount(I.VIAL)>0);
  await wire(p,walkClickFrame(game.area.at([3415,4822,0])));tick(3);const remaining=p.getInventory().getAmount(I.VIAL);assert.ok(remaining>0,'ordinary movement interrupted a genuinely active water batch');
  tick(8);assert.equal(p.getInventory().getAmount(I.VIAL),remaining);assert.equal(C.matches.get(p),game);assert.equal(C.matches.get(b),game);
});

test('native Lumbridge canonical range cooks through item-use and Cook choice while supply rules survive death',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,{food:1,drinks:1},12);await join(a);await join(b);completePreparation(game);
  const p=a,I=core.ItemIdentifiers;ruleStats(p);p.getSkillManager().setMaxLevel(core.Skill.COOKING,99);p.getSkillManager().setCurrentLevel(core.Skill.COOKING,99);
  const range=lumbridgeObject(game,'range',[3420,4823]);await lumbridgeWalk(p,game,[3419,4823]);
  const cooked=p.getInventory().getAmount(I.SHRIMPS),xp=p.getSkillManager().getExperience(core.Skill.COOKING);
  give(p,I.RAW_SHRIMPS,'lumbridge-cook');lumbridgeItemOnObject(p,range,I.RAW_SHRIMPS);tick(12);
  assert.equal(p.getInventory().getAmount(I.RAW_SHRIMPS),0);assert.equal(p.getInventory().getAmount(I.SHRIMPS),cooked+1);assert.ok(p.getSkillManager().getExperience(core.Skill.COOKING)>xp);
  give(p,I.RAW_SHRIMPS,'lumbridge-menu-1');give(p,I.RAW_SHRIMPS,'lumbridge-menu-2');lumbridgeObjectClick(p,range,'Cook');tick(8);
  const menu=p.getCreationMenu();assert.ok(menu,'actual owned Range Cook produces canonical quantity menu');
  // Existing skill menu callback; native Range listener and processed approach above, no decoded quantity-packet claim.
  menu.execute(I.RAW_SHRIMPS,1);tick(12);assert.equal(p.getInventory().getAmount(I.SHRIMPS),cooked+2);assert.equal(p.getInventory().getAmount(I.RAW_SHRIMPS),1,'selecting one from the actual two-item menu leaves one raw supply');
  const food=p.getInventory().getAmount(I.SHRIMPS);await nativeItem(p,I.SHRIMPS,'Eat');assert.equal(p.getInventory().getAmount(I.SHRIMPS),food,'cooked supplies do not bypass NoFood');
  give(p,I.ATTACK_POTION_4_,'lumbridge-no-drink');await nativeItem(p,I.ATTACK_POTION_4_,'Drink');assert.equal(p.getInventory().getAmount(I.ATTACK_POTION_4_),1,'ordinary Drink preserves disabled dose');
  const supplied=contents(p.getInventory());await lethalMelee(b,p,game,true,[[3417,4810,0],[3418,4810,0]]);tick(6);
  assert.equal(game.jailed.has(p),true);assert.deepEqual(contents(p.getInventory()),supplied,'actual cooking/remaining supplies and metadata survive real safe death');
});

test('native Lumbridge exact Oak rectangle denial has ordinary Tree positive controls and match teardown respawn isolation',async t=>{
  resourceRandom(t);
  const a=actor(true),b=actor(true),c=actor(true),d=actor(true);channel(a);channel(b);channel(c);channel(d);
  const game=await negotiate(a,b,null,1,null,12);await join(a);await join(b);completePreparation(game);
  const other=await negotiate(c,d,null,1,null,12);await join(c);await join(d);completePreparation(other);
  const p=a,I=core.ItemIdentifiers;ruleStats(p);p.getSkillManager().setMaxLevel(core.Skill.WOODCUTTING,99);p.getSkillManager().setCurrentLevel(core.Skill.WOODCUTTING,99);give(p,I.BRONZE_AXE,'lumbridge-axe');
  const oak=lumbridgeObject(game,'oaktree',[3426,4813]);assert.deepEqual([oak.getDefinition().sizeX,oak.getDefinition().sizeY],[3,3]);
  await lumbridgeWalk(p,game,[3429,4816]);const logs=p.getInventory().getAmount(I.OAK_LOGS),xp=p.getSkillManager().getExperience(core.Skill.WOODCUTTING);
  const {PathFinder}=require('../dist/game/model/movement/path/PathFinder');
  for(const [x,y,flag]of [[3425,4813,0x8],[3425,4814,0x8],[3425,4815,0x8],[3429,4813,0x80],[3429,4814,0x80],[3429,4815,0x80],[3426,4812,0x2],[3427,4812,0x2],[3428,4812,0x2],[3426,4816,0x20],[3427,4816,0x20],[3428,4816,0x20]])assert.notEqual(game.area.getClip(game.area.at([x,y,0]))&flag,0);
  lumbridgeObjectClick(p,oak,'Chop down');for(let i=0;i<40;i++){tick();assert.equal(core.RegionManager.blocked(p.getLocation(),game.area),false);}
  assert.equal(p.getInventory().getAmount(I.OAK_LOGS),logs);assert.equal(p.getSkillManager().getExperience(core.Skill.WOODCUTTING),xp);assert.equal(treeTask(oak),undefined);
  assert.equal(PathFinder.reachedObject(p,oak.getLocation().getX(),oak.getLocation().getY(),3,3,0,10,oak.getDefinition().getBlockingMask()),false,'actual ordinary endpoint fails exact native object reach');
  const first=lumbridgeObject(game,'tree2',[3420,4840]);await lumbridgeWalk(p,game,[3419,4840]);const firstTask=await chopTree(p,first);
  const stoppedLogs=p.getInventory().getAmount(I.LOGS);lumbridgeObjectClick(p,first,'Chop down');tick(8);
  assert.equal(p.getInventory().getAmount(I.LOGS),stoppedLogs,'clicking lazy original behind actual stump cannot restart depleted tree');assert.equal(treeTask(first),firstTask);
  assert.equal(core.MapObjects.get(firstTask.stumpObject.getId(),firstTask.stumpObject.getLocation(),game.area),firstTask.stumpObject);
  tick(firstTask.getRemainingTicks()+2);
  assert.equal(core.World.getObjects().includes(first),true,'live match tree actually registered on respawn');assert.equal(game.area.resolveObject(first.getId(),first.getLocation()),first);
  const second=lumbridgeObject(game,'tree2',[3425,4839]);await lumbridgeWalk(p,game,[3424,4839]);const pending=await chopTree(p,second);
  const otherTree=lumbridgeObject(other,'tree2',[3420,4840]);await lumbridgeWalk(c,other,[3419,4840]);const otherTask=await chopTree(c,otherTree);assert.ok(pending.getRemainingTicks()>0);
  const base=[game.area.getBaseX(),game.area.getBaseY()];game.finish(null);assert.equal(game.area.isDestroyed(),true);lobby(a);lobby(b);
  const replacement=new core.TemplatedInstanceArea(8,8);
  try {
    assert.deepEqual([replacement.getBaseX(),replacement.getBaseY()],base,'actual ended match slot reused before pending task fires');
    for(let z=0;z<2;z++)for(let x=0;x<8;x++)for(let y=0;y<8;y++)replacement.setChunk(z,x,y,{sourceChunkX:424+x,sourceChunkY:600+y,sourcePlane:z,rotation:0});
    const masks=[];for(let y=0;y<64;y++)for(let x=0;x<64;x++)masks.push(replacement.getClip(replacement.tile(x,y,0)));
    tick(Math.max(pending.getRemainingTicks(),otherTask.getRemainingTicks())+2);
    for(const object of [second,pending.stumpObject]){assert.equal(core.World.getObjects().includes(object),false);assert.equal(core.World.getRemovedObjects().includes(object),false);assert.equal(core.ObjectManager.objectsAt(object.getLocation()).includes(object),false);assert.equal(game.area.getObjects().includes(object),false);}
    const after=[];for(let y=0;y<64;y++)for(let x=0;x<64;x++)after.push(replacement.getClip(replacement.tile(x,y,0)));assert.deepEqual(after,masks,'full reused template mask isolation');
    assert.equal(core.World.getObjects().includes(otherTree),true,'concurrent other match ordinary respawn registered original');assert.equal(other.area.resolveObject(otherTree.getId(),otherTree.getLocation()),otherTree);assert.equal(C.matches.get(c),other);assert.equal(C.matches.get(d),other);
  } finally {replacement.destroy();}
});

test('native canonical lazy-template range cooks and removal cancels while world range remains usable',async()=>{
  const area=new core.TemplatedInstanceArea(8,8);for(let z=0;z<2;z++)for(let x=0;x<8;x++)for(let y=0;y<8;y++)area.setChunk(z,x,y,{sourceChunkX:424+x,sourceChunkY:600+y,sourcePlane:z,rotation:0});
  const game={area,layout:{origin:LUMBRIDGE_ORIGIN}};area.at=tile=>area.tile(tile[0]-3392,tile[1]-4800,tile[2]);
  const p=actor(true),world=actor(true),I=core.ItemIdentifiers;let worldRange;
  try {
    p.moveTo(area.at([3419,4823,0]));area.add(p);tick();const range=lumbridgeObject(game,'range',[3420,4823]);assert.equal(area.getObjects().includes(range),false,'untouched template cooker is lazily owned, never manually registered');
    for(const player of [p,world]){player.getSkillManager().setMaxLevel(core.Skill.COOKING,99);player.getSkillManager().setCurrentLevel(core.Skill.COOKING,99);}
    give(p,I.RAW_SHRIMPS,'independent-lazy-range');lumbridgeItemOnObject(p,range,I.RAW_SHRIMPS);tick(12);
    assert.equal(p.getInventory().getAmount(I.SHRIMPS),1,'independent ordinary template range reaches first actual cooked output');
    assert.equal(p.getInventory().getAmount(I.RAW_SHRIMPS),0);
    // A disclosed runtime world cooker control uses the same actual cache definition.
    world.moveTo(new core.Location(3222,3218,0));worldRange=new core.GameObject(range.getId(),new core.Location(3223,3218,0),range.getType(),range.getFace(),null);core.ObjectManager.register(worldRange,true);tick();
    give(world,I.RAW_SHRIMPS,'world-range-control');lumbridgeItemOnObject(world,worldRange,I.RAW_SHRIMPS);tick(12);
    assert.equal(world.getInventory().getAmount(I.SHRIMPS),1,'ordinary world cooker existing path remains usable');
    give(p,I.RAW_SHRIMPS,'range-remove');give(p,I.RAW_SHRIMPS,'range-remove');lumbridgeItemOnObject(p,range,I.RAW_SHRIMPS);
    for(let i=0;i<10&&!p.getCreationMenu();i++)tick();const menu=p.getCreationMenu();assert.ok(menu);menu.execute(I.RAW_SHRIMPS,2);
    assert.equal(require('../plugins/skills/Cooking.plugin').isCookingActive(p),true);core.ObjectManager.deregister(range,true);assert.ok(core.World.getRemovedObjects().includes(range));
    tick(12);assert.equal(p.getInventory().getAmount(I.RAW_SHRIMPS),2);assert.equal(p.getInventory().getAmount(I.SHRIMPS),1,'removed lazy original cannot continue via raw template fallback');
    assert.equal(require('../plugins/skills/Cooking.plugin').isCookingActive(p),false);
  } finally {
    p.getPrivateArea()?.detach(p);p.setArea(null);p.moveTo(new core.Location(3128,3627,0));area.destroy();
    if(worldRange)core.ObjectManager.deregister(worldRange,true);
  }
});

// M: Falador Park source-qualified TSPS choices; no gameplay evidence borrowed from acquisition.
const FALADOR_ORIGIN=[3456,4736];
const FALADOR_LANDINGS=[[3472,4759,0],[3512,4759,0]];
const FALADOR_JAILS=[[3461,4760,0],[3469,4745,0]];
const faladorReachable=(game,from,to)=>layoutReachable(game,from,to,FALADOR_ORIGIN);
// Existing native helpers are already area-relative and identity-aware.
const faladorObject=lumbridgeObject;
async function faladorWalk(p,game,xy) {
  const at=game.area.at([...xy,0]);assert.ok(Math.abs(p.getLocation().getX()-at.getX())<64&&Math.abs(p.getLocation().getY()-at.getY())<64,'ordinary click in RSMOD search window');
  await wire(p,walkClickFrame(at));
  for(let ticks=0;ticks<80&&!p.getLocation().equals(at);ticks++)tick();
  assert.deepEqual(position(p),[at.getX(),at.getY(),0],'processed ordinary walk reaches exact endpoint within bounded ticks');
}
function faladorMasks(area) {const masks=[];for(let y=0;y<64;y++)for(let x=0;x<128;x++)masks.push(area.getClip(area.tile(x,y,0)));return masks;}
function faladorTemplate() {
  const area=new core.TemplatedInstanceArea(16,8);
  for(let z=0;z<2;z++)for(let x=0;x<16;x++)for(let y=0;y<8;y++)area.setChunk(z,x,y,{sourceChunkX:432+x,sourceChunkY:592+y,sourcePlane:z,rotation:0});
  area.at=tile=>area.tile(tile[0]-3456,tile[1]-4736,tile[2]);return area;
}
test('native Falador Park selection resets agreement across all eight arenas and rejects unsupported rows',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  await click(a,'clanwars_setup:accept');const session=C.negotiations.get(a);assert.equal(session.accepted.has(a),true);
  await click(b,'clanwars_setup:arena',39);assert.equal(session.rules.arena,13,'native Falador Park option reaches authoritative offer');
  assert.equal(session.accepted.size,0);assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(session.rules),/Falador Park/);
  for(const [slot,arena] of [[3,1],[6,2],[9,3],[15,5],[18,6],[33,11],[36,12],[39,13]]) {
    tick(9);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);
    await click(b,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,arena);assert.equal(session.accepted.size,0);
  }
  for(const slot of [45,1,2,48,22,30,42,65535]) {
    await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,13);
    assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_arena')),13);
  }
});


for(const mode of [0,1,16]) test(`native Falador Park mode ${mode} retains restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},13);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3472,4759,0]));b.moveTo(game.area.at([3473,4759,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,FALADOR_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of [0,1]) test(`native Falador Park side ${victimIndex} death metadata, jail approach and viewing model`,async()=>{
  const outsiders=[actor(),actor()];for(const p of outsiders) channel(p);
  const foreignGame=await negotiate(outsiders[0],outsiders[1],null,1,null,2);for(const p of outsiders) await join(p);
  const orbOutsiders=[actor(),actor()];for(const p of orbOutsiders)channel(p);const orbForeign=await negotiate(orbOutsiders[0],orbOutsiders[1],null,1,null,2);
  const a=actor(true),b=actor(true),delay=victimIndex===1?1:0;channel(a);channel(b);const game=await negotiate(a,b,null,1,{rejoiningdelay:delay},13);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);
  victim.getInventory().add(new core.Item(995,79,{qa:'falador'}));
  await lethalMelee(killer,victim,game,true,[[3472,4759,0],[3473,4759,0]]);tick(6);
  assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,FALADOR_JAILS[side]));
  assert.equal(victim.getInventory().getAmount(995),79);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'falador'});
  const foreignPortal=mappedLayoutObjects(foreignGame,'clanwars_prisonportal_elfwood')[0],foreignOrb=mappedLayoutObjects(orbForeign,'clanwars_viewing_start_elfwood')[0];assert.ok(foreignPortal&&foreignOrb);
  assert.equal(Match.exit({player:victim,object:foreignPortal}),false,'valid jailed member cannot use the real same-ID portal of another match');
  assert.equal(viewingUnit().use({player:victim,object:foreignOrb}),false,'valid jailed member cannot use a real same-ID foreign orb');
  assert.equal(C.matches.get(victim),game);assert.equal(game.jailed.has(victim),true);
  const inactive=mappedLayoutObjects(game,'clanwars_viewing_elfwood')[0];assert.ok(inactive);
  assert.equal(viewingUnit().use({player:victim,object:inactive}),false,'actual owned inactive orb is not an active Use target');
  const scripts=scriptCalls(victim),orbXY=side===0?[3461,4761]:[3469,4744];
  await layoutObjectInput(victim,game,'clanwars_viewing_start_elfwood',orbXY,'Use');
  assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));const state=viewingUnit().active.get(victim);assert.ok(state);
  const at=game.area.at([...orbXY,0]);assert.ok(Math.max(Math.abs(state.location.getX()-at.getX()),Math.abs(state.location.getY()-at.getY()))<=1);
  assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9754));
  console.log('FALADOR_ORB_APPROACH_QUALIFICATION '+JSON.stringify({side,source:orbXY,approach:[state.location.getX(),state.location.getY(),state.location.getZ()]}));
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);
  assert.deepEqual(position(victim),[state.location.getX(),state.location.getY(),state.location.getZ()]);
  assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);
  assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const ownedPortal=mappedLayoutObjects(game,'clanwars_prisonportal_elfwood').find(o=>o.getLocation().equals(game.area.at([...(side===0?[3462,4758]:[3472,4744]),0])));assert.ok(ownedPortal);
  const fake=new core.GameObject(ownedPortal.getId(),ownedPortal.getLocation().clone(),ownedPortal.getType(),ownedPortal.getFace(),game.area);
  try {assert.equal(Match.exit({player:victim,object:fake}),false);assert.equal(game.jailed.has(victim),true);} finally {game.area.detach(fake);}
  const accountKey=victim.getLongUsername(),deadline=game.returnAt.get(accountKey);
  if(delay) {assert.ok(Number.isInteger(deadline),'canonical account deadline exists');assert.ok(deadline>C.now(),'early Exit precondition is before the real deadline');}
  await layoutObjectInput(victim,game,'clanwars_prisonportal_elfwood',side===0?[3462,4758]:[3472,4744],'Exit');
  if(delay) {
    assert.equal(game.jailed.has(victim),true,'early ordinary Exit cannot bypass the negotiated delay');
    assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(accountKey),deadline);assert.ok(deadline>C.now());
    tick(deadline-C.now());
    await layoutObjectInput(victim,game,'clanwars_prisonportal_elfwood',side===0?[3462,4758]:[3472,4744],'Exit');
  }
  assert.equal(game.fighters.has(victim),true);assert.equal(game.jailed.has(victim),false);assert.deepEqual(position(victim),positionAt(game,FALADOR_LANDINGS[side]));
});

test('native Falador full8192 masks,23 owned walls and identical queued crossing preserve source geometry',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,0,null,13);await join(a);await join(b);
  assert.deepEqual([game.area.widthChunks,game.area.heightChunks],[16,8]);for(const p of [a,b])assert.deepEqual(position(p),positionAt(game,FALADOR_LANDINGS[game.members.get(p)]));
  const reference=faladorTemplate();
  try {
    for(let z=0;z<2;z++)for(let x=0;x<16;x++)for(let y=0;y<8;y++)assert.deepEqual(game.area.getChunk(z,x,y),reference.getChunk(z,x,y));
    const baseline=faladorMasks(reference),id=core.CacheDefinitions.getLocId('clanwars_barrier_elfwood'),definition=core.CacheDefinitions.getObject(id),walls=game.walls.slice();
    assert.deepEqual([definition.sizeX,definition.sizeY],[1,1]);assert.notEqual(definition.clipType,0);assert.equal(walls.length,23);
    console.log('FALADOR_BARRIER_DEFINITION '+JSON.stringify({id,size:[definition.sizeX,definition.sizeY],clipType:definition.clipType,blocksProjectile:definition.blocksProjectile}));
    for(const wall of walls){
      assert.equal(wall.getId(),id);assert.equal(wall.getPrivateArea(),game.area);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),1);assert.equal(wall.getDefinition().isSolid(),true);
      assert.equal(core.RegionManager.blocked(wall.getLocation(),game.area),true);assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),wall);
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getId()===id&&o.getPrivateArea()===game.area).length,1);
    }
    for(let y=4743;y<=4767;y++){
      const old=baseline[(y-4736)*128+3496-3456],at=game.area.at([3496,y,0]),found=walls.filter(w=>w.getLocation().equals(at));
      assert.equal(found.length,old&core.RegionManager.BLOCKED_MASK?0:1);if(found.length)assert.equal(old&0x20100,0);
    }
    // Full native rotated footprint nonoverlap, including bridge-lowered source copies.
    for(let x=0;x<16;x++)for(let y=0;y<8;y++)for(const object of reference.getChunkObjects(0,x,y)){
      if(![10,11].includes(object.getType()))continue;
      let {sizeX:w,sizeY:h}=object.getDefinition();if(object.getFace()%2)[w,h]=[h,w];const at=object.getLocation();
      for(const wall of walls){const wx=wall.getLocation().getX()-game.area.getBaseX()+reference.getBaseX(),wy=wall.getLocation().getY()-game.area.getBaseY()+reference.getBaseY();assert.equal(wx>=at.getX()&&wx<at.getX()+w&&wy>=at.getY()&&wy<at.getY()+h,false,'no overlay on full source prop footprint');}
    }
    assert.deepEqual(FALADOR_JAILS.map(xy=>game.area.getClip(game.area.at(xy))),[0,0x10080]);
    assert.equal(faladorReachable(game,FALADOR_LANDINGS[0],FALADOR_LANDINGS[1]),false);
    for(const j of FALADOR_JAILS)for(const landing of FALADOR_LANDINGS)assert.equal(faladorReachable(game,j,landing),false);
    for(const outside of [[3521,4758,0],[3477,4742,0],[3462,4750,0],[3480,4785,0]])assert.equal(faladorReachable(game,FALADOR_LANDINGS[0],outside),false);
    for(const z of [2,3]){assert.equal(game.area.getChunk(z,0,0),null);assert.notEqual(game.area.getClip(game.area.at([3472,4759,z]))&0x200100,0);}
    for(const [inside,outside]of [[[3456,4759,0],[3455,4759,0]],[[3583,4759,0],[3584,4759,0]],[[3496,4736,0],[3496,4735,0]],[[3496,4799,0],[3496,4800,0]]])assert.equal(core.RegionManager.canMovestart(game.area.at(inside),game.area.at(outside),1,1,game.area),false);
    const walker=[a,b].find(p=>game.members.get(p)===0);await faladorWalk(walker,game,[3495,4753]);const target=game.area.at([3497,4753,0]);
    await wire(walker,walkClickFrame(target));tick(30);assert.equal(game.phase,'staging');assert.ok(walker.getLocation().getX()<game.area.at([3496,4753,0]).getX());
    const state=()=>({position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}),staging=state();
    completePreparation(game);assert.equal(game.walls.length,0);
    for(const wall of walls){assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),null);assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(core.World.getObjects().includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);}
    const after=faladorMasks(game.area);assert.deepEqual(after,baseline,'full8192 native masks restored BEFORE deliberate door/resource mutation');
    for(const [x,y,mask]of [[3496,4743,0x200000],[3496,4744,0x200002],[3496,4745,0x20],[3496,4766,0x804],[3496,4767,0x2],[3519,4758,0x1008],[3520,4758,0x210080]])assert.equal(after[(y-4736)*128+x-3456],mask);
    assert.equal(faladorReachable(game,FALADOR_LANDINGS[0],FALADOR_LANDINGS[1]),true);
    await faladorWalk(walker,game,[3497,4753]);console.log('FALADOR_MOVEMENT_QUALIFICATION '+JSON.stringify({requested:[target.getX(),target.getY(),0],staging,combat:state()}));
    await faladorWalk(walker,game,FALADOR_LANDINGS[1].slice(0,2));
  }finally{reference.destroy();}
});

test('native eight-layout coexistence retains old dimensions and exact axes while both sameID Falador Forfeit footprints remain owned',async()=>{
  const players=Array.from({length:16},()=>actor());for(const p of players)channel(p);const old=[];
  for(const [offset,arena,axis,coordinate,face,count]of [[0,1,'y',4959,0,52],[2,2,'y',5023,0,null],[4,3,'y',5087,0,24],[6,6,'y',4959,0,57],[8,5,'x',3167,1,43],[10,11,'y',4735,0,51],[12,12,'y',4826,0,29]]){
    const team=players.slice(offset,offset+2),game=await negotiate(team[0],team[1],null,1,null,arena);for(const p of team)await join(p);
    assert.deepEqual([game.area.widthChunks,game.area.heightChunks],[8,arena===11?16:8]);assert.equal(game.phase,'staging');if(count!==null)assert.equal(game.walls.length,count);
    for(const wall of game.walls){assert.equal(wall.getFace(),face);const actual=axis==='x'?wall.getLocation().getX()-game.area.getBaseX()+game.layout.origin[0]:wall.getLocation().getY()-game.area.getBaseY()+game.layout.origin[1];assert.equal(actual,coordinate);}
    old.push({game,team});
  }
  const [a,b]=players.slice(14),game=await negotiate(a,b,null,1,null,13);await join(a);await join(b);assert.equal(new Set([...old.map(x=>x.game.area),game.area]).size,8);
  const foreign=mappedLayoutObjects(old.find(x=>x.game.rules.arena===12).game,'clanwars_exitportal_smallwood_s')[0];assert.equal(Match.forfeit({player:a,object:foreign}),false);
  for(const [player,xy,face,approach,rotated]of [[a,[3469,4763],1,[3470,4763,0],[1,2]],[b,[3482,4749],0,[3482,4750,0],[2,1]]]){
    const object=faladorObject(game,'clanwars_exitportal_smallwood_s',xy);assert.equal(object.getId(),7819);assert.equal(object.getFace(),face);let {sizeX:w,sizeY:h}=object.getDefinition();if(face%2)[w,h]=[h,w];assert.deepEqual([w,h],rotated);
    const fake=new core.GameObject(object.getId(),object.getLocation().clone(),object.getType(),object.getFace(),game.area);try{assert.equal(Match.forfeit({player,object:fake}),false);}finally{game.area.detach(fake);}
    // Both actual Forfeit copies are WEST in preparation. Supplied perimeter checkpoint, no natural east-side route claim.
    player.moveTo(game.area.at(approach));tick(2);assert.equal(game.area.getClip(player.getLocation()),0);
    await layoutObjectInput(player,game,'clanwars_exitportal_smallwood_s',xy,'Forfeit');assert.equal(C.matches.has(player),false);lobby(player);
  }
  assert.equal(game.phase,'staging');assert.equal(game.members.size,0);tick(game.starts-C.now());assert.equal(game.area.isDestroyed(),true);
  for(const {game:other,team}of old){assert.notEqual(other.phase,'over');assert.equal(other.area.isDestroyed(),false);for(const p of team)assert.equal(C.matches.get(p),other);}
});

test('native Falador Ignore5 uses actual six versus six and real defeat threshold',async()=>{
  const {b,teams,players,game}=await stragglerGame(6,1,3,{},13);completePreparation(game);assert.equal(game.fighters.size,12);
  await lethalMelee(b,teams[0][1],game,true,[[3472,4759,0],[3473,4759,0]]);tick(6);
  assert.equal(game.phase,'over');for(const p of players)lobby(p);assert.equal(game.area.isDestroyed(),true);
});

test('native Falador canonical Close Open preserves clips, preparation walls and park room upper seals',async t=>{
  resourceRandom(t);
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,13);await join(a);await join(b);
  const p=[a,b].find(actor=>game.members.get(actor)===1),original=faladorObject(game,'fai_falador_poor_door_open',[3515,4755]),walls=game.walls.slice();
  const edge=()=>core.RegionManager.canMovestart(game.area.at([3514,4755,0]),game.area.at([3515,4755,0]),1,1,game.area);
  const originalClips=[[3514,4755],[3515,4755],[3515,4754],[3516,4755]].map(xy=>game.area.getClip(game.area.at([...xy,0])));
  assert.equal(original.getId(),24051);assert.equal(original.getType(),0);assert.equal(original.getFace(),3);assert.equal(edge(),true);
  async function cycle(open){
    await faladorWalk(p,game,[3514,4755]);lumbridgeObjectClick(p,open,'Close');tick(12);
    const closed=game.area.getObjects().find(o=>o.getPrivateArea()===game.area&&o.getDefinition()?.getName()==='Door'&&o.getDefinition().getInteractions()?.includes('Open'));
    assert.ok(closed,'canonical Close actually creates owned closed leaf');assert.equal(edge(),false,'real current closed-door edge blocks crossing');
    assert.ok(core.World.getRemovedObjects().some(o=>o.equals(open)),'semantic native marker for original open leaf, not raw reference');
    lumbridgeObjectClick(p,closed,'Open');tick(12);
    const reopened=game.area.getObjects().find(o=>o.equals(original));assert.ok(reopened,'canonical Open restores exact owned original ID XYZ type face');
    assert.equal(edge(),true);assert.deepEqual([[3514,4755],[3515,4755],[3515,4754],[3516,4755]].map(xy=>game.area.getClip(game.area.at([...xy,0]))),originalClips,'source Door edge flags restore');
    await faladorWalk(p,game,[3516,4755]);return reopened;
  }
  let current=await cycle(original);assert.equal(game.phase,'staging');
  assert.equal(faladorReachable(game,FALADOR_LANDINGS[0],FALADOR_LANDINGS[1]),false,'actual Close/Open cannot bypass staging');for(const wall of walls)assert.equal(core.RegionManager.blocked(wall.getLocation(),game.area),true);
  completePreparation(game);current=await cycle(current);assert.equal(current.getPrivateArea(),game.area);
  for(const outside of [[3521,4758],[3480,4785],[3477,4742],...FALADOR_JAILS.map(j=>j.slice(0,2))]){
    assert.equal(faladorReachable(game,FALADOR_LANDINGS[0],[...outside,0]),false,'door mutation leaves source component isolated');
    await wire(p,walkClickFrame(game.area.at([...outside,0])));tick(30);assert.notDeepEqual(position(p),positionAt(game,[...outside,0]));assert.equal(p.getLocation().getZ(),0);
  }
  for(const xy of [[3470,4747],[3477,4744],[3520,4758]]){
    const seal=game.area.getTemplateObjects(game.area.at([...xy,0])).find(o=>[1539,23995].includes(o.getId()));assert.ok(seal);assert.equal((seal.getDefinition().getInteractions()??[]).some(Boolean),false,'actual boundary seal offers no invented Open');
  }
  const I=core.ItemIdentifiers;ruleStats(p);for(const skill of [core.Skill.COOKING,core.Skill.SMITHING,core.Skill.WOODCUTTING]){p.getSkillManager().setCurrentLevel(skill,99);p.getSkillManager().setMaxLevel(skill,99);}
  give(p,I.RAW_SHRIMPS,'isolated-range');give(p,I.COPPER_ORE,'isolated-furnace');give(p,I.TIN_ORE,'isolated-furnace');give(p,I.BRONZE_AXE,'isolated-oak');
  const items=contents(p.getInventory()),xp=[core.Skill.COOKING,core.Skill.SMITHING,core.Skill.WOODCUTTING].map(s=>p.getSkillManager().getExperience(s));
  for(const [gameval,xy,z,action]of [['fai_falador_stairs',[3459,4746],0,'Climb-up'],['fai_falador_stairstop',[3459,4747],1,'Climb-down'],['fai_falador_furnace',[3464,4744],0,'Smelt'],['range',[3476,4741],0,'Cook'],['oaktree',[3516,4746],0,'Chop down'],['tree',[3477,4749],0,'Chop down']]){
    await faladorWalk(p,game,[3514,4755]);const object=faladorObject(game,gameval,xy,z);assert.equal(object.getLocation().getZ(),z);const menuBefore=p.getCreationMenu(),positionBefore=position(p);
    lumbridgeObjectClick(p,object,action);tick(40);assert.equal(p.getLocation().getZ(),0,'actual isolated ground climb and upper request cannot change floor');
    const {PathFinder}=require('../dist/game/model/movement/path/PathFinder');let {sizeX:w,sizeY:h}=object.getDefinition();if(object.getFace()%2)[w,h]=[h,w];
    assert.equal(PathFinder.reachedObject(p,object.getLocation().getX(),object.getLocation().getY(),w,h,object.getFace(),object.getType(),object.getDefinition().getBlockingMask()),false,'ordinary endpoint cannot reach isolated source footprint');
    assert.deepEqual(contents(p.getInventory()),items);assert.deepEqual([core.Skill.COOKING,core.Skill.SMITHING,core.Skill.WOODCUTTING].map(s=>p.getSkillManager().getExperience(s)),xp);
    assert.equal(p.getCreationMenu(),menuBefore,'isolated object request opens no menu');if(z===1)assert.deepEqual(position(p),positionBefore,'upper object rejected before ground movement');assert.equal(treeTask(object),undefined);assert.equal(require('../plugins/skills/Cooking.plugin').isCookingActive(p),false);assert.equal(require('../plugins/skills/Smithing.plugin').isSmeltingActive(p),false);
  }
  // Ordinary reachable positive after all valid-skills/tool/input negative cases; no handler disabling.
  await faladorWalk(p,game,[3474,4765]);const tree=faladorObject(game,'tree2',[3474,4766]);assert.equal(core.MapObjects.getPrivateArea(p,tree.getId(),tree.getLocation()),tree);await chopTree(p,tree);
});

for(const [gameval,xy,face,approach]of [['tree2',[3474,4766],1,[3474,4765]],['tree',[3478,4766],0,[3478,4765]],['tree2',[3482,4766],3,[3482,4765]],['tree',[3486,4766],3,[3486,4765]]])test(`native Falador ordinary Tree ${xy} gives real logs XP stump and live respawn`,async t=>{
  resourceRandom(t);const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,13);await join(a);await join(b);completePreparation(game);
  const tree=faladorObject(game,gameval,xy);assert.equal(tree.getFace(),face);assert.deepEqual([tree.getDefinition().sizeX,tree.getDefinition().sizeY],[2,2]);assert.equal(game.area.getObjects().includes(tree),false,'actual untouched lazy tree, never manually registered');
  await faladorWalk(a,game,approach);const xp=a.getSkillManager().getExperience(core.Skill.WOODCUTTING),task=await chopTree(a,tree);assert.ok(a.getSkillManager().getExperience(core.Skill.WOODCUTTING)>xp);
  const logs=a.getInventory().getAmount(core.ItemIdentifiers.LOGS);lumbridgeObjectClick(a,tree,'Chop down');tick(8);assert.equal(a.getInventory().getAmount(core.ItemIdentifiers.LOGS),logs);assert.equal(treeTask(tree),task,'lazy original cannot bypass real stump');
  tick(task.getRemainingTicks()+2);assert.equal(task.isStopped(),true);assert.equal(core.World.getObjects().includes(tree),true);assert.equal(game.area.resolveObject(tree.getId(),tree.getLocation()),tree);assert.equal(core.World.getObjects().includes(task.stumpObject),false);assert.equal(C.matches.get(b),game);
  console.log('FALADOR_TREE_QUALIFICATION '+JSON.stringify({source:xy,id:tree.getId(),owned:tree.getPrivateArea()===game.area,logs,respawned:task.isStopped()}));
});

test('native Falador ordinary tree movement cancellation and actual supplies retain NoFood NoDrinks and safe death metadata',async t=>{
  let allowLogs=false;t.mock.method(Math,'random',()=>new Error().stack.includes('rollLog')?(allowLogs?0.001:0.99):0.99);
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,{food:1,drinks:1},13);await join(a);await join(b);completePreparation(game);
  const I=core.ItemIdentifiers,wood=require('../plugins/skills/Woodcutting.plugin');ruleStats(a);a.getSkillManager().setCurrentLevel(core.Skill.WOODCUTTING,99);a.getSkillManager().setMaxLevel(core.Skill.WOODCUTTING,99);
  give(a,I.BRONZE_AXE,'falador-axe');give(a,I.SHRIMPS,'falador-food');give(a,I.ATTACK_POTION_4_,'falador-drink');
  const tree=faladorObject(game,'tree2',[3474,4766]);await faladorWalk(a,game,[3474,4765]);const before=a.getInventory().getAmount(I.LOGS);
  lumbridgeObjectClick(a,tree,'Chop down');tick(3);assert.equal(wood.isWoodcuttingActive(a),true,'actual ordinary session active before cancel');assert.equal(a.getInventory().getAmount(I.LOGS),before);
  await wire(a,walkClickFrame(game.area.at([3472,4764,0])));tick(8);assert.equal(wood.isWoodcuttingActive(a),false,'ordinary movement cancels actual chopping');assert.equal(a.getInventory().getAmount(I.LOGS),before);assert.equal(treeTask(tree),undefined);
  allowLogs=true;await faladorWalk(a,game,[3474,4765]);const task=await chopTree(a,tree);assert.ok(task.isRunning());
  const supplies=contents(a.getInventory());await nativeItem(a,I.SHRIMPS,'Eat');await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.deepEqual(contents(a.getInventory()),supplies,'actual supplies cannot bypass food/drink restrictions');
  await lethalMelee(b,a,game,true,[[3472,4759,0],[3473,4759,0]]);tick(6);assert.equal(game.jailed.has(a),true);assert.deepEqual(contents(a.getInventory()),supplies,'actual supplies and metadata survive native safe death');
});

test('native Falador depleted tree teardown before delay preserves reused slot, concurrent match and world respawns',async t=>{
  resourceRandom(t);const a=actor(true),b=actor(true),c=actor(true),d=actor(true),world=actor(true);for(const p of [a,b,c,d])channel(p);
  const game=await negotiate(a,b,null,1,null,13);await join(a);await join(b);completePreparation(game);
  const other=await negotiate(c,d,null,1,null,13);await join(c);await join(d);completePreparation(other);
  const tree=faladorObject(game,'tree2',[3474,4766]),liveTree=faladorObject(other,'tree2',[3474,4766]);
  await faladorWalk(a,game,[3474,4765]);await faladorWalk(c,other,[3474,4765]);
  world.moveTo(new core.Location(3222,3218,0));core.RegionManager.loadMapFiles(3222,3218);
  // Disclosed runtime WORLD control, actual cache definition; never seed an owned lazy Tree.
  const worldTree=new core.GameObject(tree.getId(),new core.Location(3223,3218,0),tree.getType(),tree.getFace(),null);core.ObjectManager.register(worldTree,true);tick();
  let pending,liveTask,worldTask,replacement;
  try {
    pending=await chopTree(a,tree);liveTask=await chopTree(c,liveTree);worldTask=await chopTree(world,worldTree);
    assert.ok([pending,liveTask,worldTask].every(task=>task.isRunning()&&task.getRemainingTicks()>0),'all actual ordinary respawns pending at destruction');
    const base=[game.area.getBaseX(),game.area.getBaseY()];game.finish(null);assert.equal(game.area.isDestroyed(),true);lobby(a);lobby(b);
    replacement=faladorTemplate();assert.deepEqual([replacement.getBaseX(),replacement.getBaseY()],base,'actual16x8 slot reused before old delay');
    const replacementGame={area:replacement,layout:{origin:FALADOR_ORIGIN}},replacementTree=faladorObject(replacementGame,'tree2',[3474,4766]),masks=faladorMasks(replacement);
    tick(Math.max(pending.getRemainingTicks(),liveTask.getRemainingTicks(),worldTask.getRemainingTicks())+2);
    for(const object of [tree,pending.stumpObject]){assert.equal(core.World.getObjects().includes(object),false);assert.equal(core.World.getRemovedObjects().includes(object),false);assert.equal(core.ObjectManager.objectsAt(object.getLocation()).includes(object),false);assert.equal(game.area.getObjects().includes(object),false);}
    assert.equal(core.MapObjects.get(tree.getId(),tree.getLocation(),game.area),null);assert.equal(pending.isStopped(),true);
    assert.deepEqual(faladorMasks(replacement),masks,'full8192 reused-slot masks unchanged');assert.equal(replacement.resolveObject(replacementTree.getId(),replacementTree.getLocation()),replacementTree);assert.equal(replacementTree.getPrivateArea(),replacement);
    assert.equal(core.World.getObjects().includes(liveTree),true);assert.equal(other.area.resolveObject(liveTree.getId(),liveTree.getLocation()),liveTree);assert.equal(C.matches.get(c),other);assert.equal(C.matches.get(d),other);
    assert.equal(core.World.getObjects().includes(worldTree),true);assert.equal(core.MapObjects.get(worldTree.getId(),worldTree.getLocation(),null),worldTree);assert.ok(liveTask.isStopped()&&worldTask.isStopped());
  }finally{
    for(const task of [pending,liveTask,worldTask].filter(Boolean)){task.stop();if(core.World.getObjects().includes(task.stumpObject))core.ObjectManager.deregister(task.stumpObject,true);}
    if(core.World.getObjects().includes(worldTree))core.ObjectManager.deregister(worldTree,true);replacement?.destroy();
  }
});

test('Magic Disabled refuses Lunar spells on oneself and teammates in staging and battle; outside a match they work', async () => {
  const { EffectSpells } = require('../dist/game/content/combat/magic/EffectSpells');
  const { LunarSpells } = require('../dist/game/content/combat/magic/LunarSpells');
  const I = core.ItemIdentifiers;
  const lunar = (p) => {
    ruleStats(p); p.setSpellbook(core.MagicSpellbook.LUNAR);
    for (const id of [I.ASTRAL_RUNE, I.DEATH_RUNE, I.EARTH_RUNE, I.BLOOD_RUNE, I.LAW_RUNE]) p.getInventory().add(new core.Item(id, 100), false);
  };
  const a = actor(), teammate = actor(), b = actor(); channel(a, [teammate]); channel(b);
  const game = await negotiate(a, b);
  assert.equal(game.rules.magic, 4, 'the offered terms are Magic: Disabled (enum_917)');
  await join(a); await join(teammate); await join(b);
  for (const p of [a, teammate]) lunar(p);
  const lines = messagesOf(a);
  const astral = () => a.getInventory().getAmount(I.ASTRAL_RUNE);
  assert.equal(game.phase, 'staging');
  assert.equal(EffectSpells.handleSpell(a, EffectSpells.VENGEANCE.spellId()), true);
  assert.equal(a.hasVengeanceReturn(), false, 'no Vengeance cast in staging');
  assert.equal(astral(), 100, 'no runes paid');
  assert.equal(lines.at(-1), 'Magic is disabled in this Clan Wars battle.');
  core.World.processCycle = game.starts; game.tick();
  assert.equal(game.phase, 'combat');
  teammate.setHitpoints(40);
  assert.equal(LunarSpells.handlePlayerTarget(a, teammate, 'Vengeance Other'), true);
  assert.equal(teammate.hasVengeanceReturn(), false, 'no Vengeance Other on a teammate');
  assert.equal(LunarSpells.handlePlayerTarget(a, teammate, 'Heal Other'), true);
  assert.equal(teammate.getHitpoints(), 40, 'no Heal Other on a teammate');
  assert.equal(astral(), 100, 'still no runes paid');
  // A Lunar caster outside any match is unaffected.
  const outsider = actor(); lunar(outsider);
  assert.equal(EffectSpells.handleSpell(outsider, EffectSpells.VENGEANCE.spellId()), true);
  assert.equal(outsider.hasVengeanceReturn(), true, 'Vengeance works outside Clan Wars');
});

// N: Wasteland finite source-qualified TSPS choices; acquisition220 is not gameplay proof.
const WASTELAND_ORIGIN=[3264,4992];
const WASTELAND_LANDINGS=[[3296,5010,0],[3296,5100,0]];
const WASTELAND_JAILS=[[3317,5053,0],[3317,5058,0]];
const wastelandReachable=(game,from,to)=>layoutReachable(game,from,to,WASTELAND_ORIGIN);
const wastelandObject=lumbridgeObject;
async function wastelandWalk(p,game,xy) {
  const at=game.area.at([...xy,0]);assert.ok(Math.abs(p.getLocation().getX()-at.getX())<64&&Math.abs(p.getLocation().getY()-at.getY())<64,'ordinary destination inside Rsmod search window');
  await wire(p,walkClickFrame(at));for(let n=0;n<100&&!p.getLocation().equals(at);n++)tick();
  assert.deepEqual(position(p),[at.getX(),at.getY(),0],'bounded ordinary queued walk reaches exact endpoint');
}
function wastelandMasks(area,plane=0){const masks=[];for(let y=0;y<128;y++)for(let x=0;x<64;x++)masks.push(area.getClip(area.tile(x,y,plane)));return masks;}
function wastelandTemplate(){const area=new core.TemplatedInstanceArea(8,16);for(let z=0;z<2;z++)for(let x=0;x<8;x++)for(let y=0;y<16;y++)area.setChunk(z,x,y,{sourceChunkX:408+x,sourceChunkY:624+y,sourcePlane:z,rotation:0});area.at=tile=>area.tile(tile[0]-3264,tile[1]-4992,tile[2]);return area;}

test('native Wasteland zero is deliberate while fresh negotiations keep Plateau and reset all accepts',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  const session=C.negotiations.get(a),bit=core.CacheDefinitions.getVarbitId('clanwars_arena');assert.equal(session.rules.arena,1,'fresh default remains Plateau');
  await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);
  await click(b,'clanwars_setup:arena',0);assert.equal(session.rules.arena,0,'actual numeric slot0 reaches authoritative offer');assert.equal(session.accepted.size,0);
  for(const p of [a,b])assert.equal(p.getPacketSender().getVarbit(bit),0);assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(session.rules),/Wasteland/);
  for(const [slot,arena]of [[3,1],[6,2],[9,3],[15,5],[18,6],[33,11],[36,12],[39,13],[0,0]]){
    tick(9);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);await click(b,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,arena);assert.equal(session.accepted.size,0);for(const p of [a,b])assert.equal(p.getPacketSender().getVarbit(bit),arena);
  }
  for(const slot of [1,2,48,22,30,45,42,65535]){await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,0);for(const p of [a,b])assert.equal(p.getPacketSender().getVarbit(bit),0);}
  tick(9);await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');assert.equal(session.rules.arena,0);tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(game.rules.arena,0);assert.equal(game.layout.name,'Wasteland');
});
for(const mode of [0,1,16]) test(`native Wasteland mode ${mode} retains restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},0);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3296,5010,0]));b.moveTo(game.area.at([3297,5010,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,WASTELAND_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of [0,1]) test(`native Wasteland side ${victimIndex} death metadata, jail approach and viewing model`,async()=>{
  const outsiders=[actor(),actor()];for(const p of outsiders) channel(p);
  const foreignGame=await negotiate(outsiders[0],outsiders[1],null,1,null,1);for(const p of outsiders) await join(p);
  const orbOutsiders=[actor(),actor()];for(const p of orbOutsiders)channel(p);const orbForeign=await negotiate(orbOutsiders[0],orbOutsiders[1],null,1,null,1);
  const a=actor(true),b=actor(true),delay=victimIndex===1?1:0;channel(a);channel(b);const game=await negotiate(a,b,null,1,{rejoiningdelay:delay},0);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);
  victim.getInventory().add(new core.Item(995,79,{qa:'wasteland'}));
  await lethalMelee(killer,victim,game,true,[[3296,5010,0],[3297,5010,0]]);tick(6);
  assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,WASTELAND_JAILS[side]));
  const otherJail=game.area.at(WASTELAND_JAILS[1-side]);await wire(victim,walkClickFrame(otherJail));tick(6);const sourceJailY=victim.getLocation().getY()-game.area.getBaseY()+4992;assert.ok(side===0?sourceJailY>=5048&&sourceJailY<=5055:sourceJailY>=5056&&sourceJailY<=5063,'ordinary walk remains inside its own jail');assert.equal(wastelandReachable(game,WASTELAND_JAILS[side],WASTELAND_JAILS[1-side]),false);
  assert.equal(victim.getInventory().getAmount(995),79);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'wasteland'});
  const foreignPortal=mappedLayoutObjects(foreignGame,'clanwars_prisonportal_darkrock')[0],foreignOrb=mappedLayoutObjects(orbForeign,'clanwars_viewing_start_darkrock')[0];assert.ok(foreignPortal&&foreignOrb);
  assert.equal(Match.exit({player:victim,object:foreignPortal}),false,'valid jailed member cannot use the real same-ID portal of another match');
  assert.equal(viewingUnit().use({player:victim,object:foreignOrb}),false,'valid jailed member cannot use a real same-ID foreign orb');
  assert.equal(C.matches.get(victim),game);assert.equal(game.jailed.has(victim),true);
  const inactive=mappedLayoutObjects(game,'clanwars_viewing_darkrock')[0];assert.ok(inactive);
  assert.equal(viewingUnit().use({player:victim,object:inactive}),false,'actual owned inactive orb is not an active Use target');
  const scripts=scriptCalls(victim),orbXY=side===0?[3318,5053]:[3318,5058];
  await layoutObjectInput(victim,game,'clanwars_viewing_start_darkrock',orbXY,'Use');
  assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));const state=viewingUnit().active.get(victim);assert.ok(state);
  const at=game.area.at([...orbXY,0]);assert.ok(Math.max(Math.abs(state.location.getX()-at.getX()),Math.abs(state.location.getY()-at.getY()))<=1);
  assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9752));
  console.log('WASTELAND_ORB_APPROACH_QUALIFICATION '+JSON.stringify({side,source:orbXY,approach:[state.location.getX(),state.location.getY(),state.location.getZ()]}));
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);
  assert.deepEqual(position(victim),[state.location.getX(),state.location.getY(),state.location.getZ()]);
  assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);
  assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const ownedPortal=mappedLayoutObjects(game,'clanwars_prisonportal_darkrock').find(o=>o.getLocation().equals(game.area.at([...(side===0?[3322,5051]:[3322,5060]),0])));assert.ok(ownedPortal);
  const fake=new core.GameObject(ownedPortal.getId(),ownedPortal.getLocation().clone(),ownedPortal.getType(),ownedPortal.getFace(),game.area);
  try {assert.equal(Match.exit({player:victim,object:fake}),false);assert.equal(game.jailed.has(victim),true);} finally {game.area.detach(fake);}
  const accountKey=victim.getLongUsername(),deadline=game.returnAt.get(accountKey);
  if(delay) {assert.ok(Number.isInteger(deadline),'canonical account deadline exists');assert.ok(deadline>C.now(),'early Exit precondition is before the real deadline');}
  await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',side===0?[3322,5051]:[3322,5060],'Exit');
  if(delay) {
    assert.equal(game.jailed.has(victim),true,'early ordinary Exit cannot bypass the negotiated delay');
    assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(accountKey),deadline);assert.ok(deadline>C.now());
    tick(deadline-C.now());
    await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',side===0?[3322,5051]:[3322,5060],'Exit');
  }
  assert.equal(game.fighters.has(victim),true);assert.equal(game.jailed.has(victim),false);assert.deepEqual(position(victim),positionAt(game,WASTELAND_LANDINGS[side]));
});

test('native Wasteland47 current owned walls restore full8192 masks before mutations and identical queued crossing',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,0,null,0);await join(a);await join(b);
  assert.deepEqual([game.area.widthChunks,game.area.heightChunks],[8,16]);for(const p of [a,b])assert.deepEqual(position(p),positionAt(game,WASTELAND_LANDINGS[game.members.get(p)]));
  const reference=wastelandTemplate();
  try{
    for(let z=0;z<2;z++)for(let x=0;x<8;x++)for(let y=0;y<16;y++)assert.deepEqual(game.area.getChunk(z,x,y),reference.getChunk(z,x,y));
    const baseline=wastelandMasks(reference),upper=wastelandMasks(reference,1),id=core.CacheDefinitions.getLocId('clanwars_barrier_darkrock'),def=core.CacheDefinitions.getObject(id),walls=game.walls.slice();
    assert.deepEqual([def.sizeX,def.sizeY],[1,1]);assert.notEqual(def.clipType,0);assert.equal(def.blocksProjectile,true);assert.equal(walls.length,47);
    console.log('WASTELAND_BARRIER_DEFINITION '+JSON.stringify({id,size:[def.sizeX,def.sizeY],clipType:def.clipType,blocksProjectile:def.blocksProjectile}));
    for(const wall of walls){assert.equal(wall.getId(),id);assert.equal(wall.getPrivateArea(),game.area);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),0);assert.equal(wall.getDefinition().isSolid(),true);assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),wall);assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getId()===id&&o.getPrivateArea()===game.area).length,1);assert.equal(core.RegionManager.blocked(wall.getLocation(),game.area),true);}
    for(let x=3268;x<=3315;x++){const old=baseline[(5055-4992)*64+x-3264],at=game.area.at([x,5055,0]),found=walls.filter(w=>w.getLocation().equals(at));assert.equal(found.length,old&core.RegionManager.BLOCKED_MASK?0:1);if(found.length)assert.equal(old&0x20100,0);}
    for(let x=0;x<8;x++)for(let y=0;y<16;y++)for(const object of reference.getChunkObjects(0,x,y)){
      if(![10,11].includes(object.getType())||!object.getDefinition().isSolid())continue;let{sizeX:w,sizeY:h}=object.getDefinition();if(object.getFace()%2)[w,h]=[h,w];const at=object.getLocation();
      for(const wall of walls){const wx=wall.getLocation().getX()-game.area.getBaseX()+reference.getBaseX(),wy=wall.getLocation().getY()-game.area.getBaseY()+reference.getBaseY();assert.equal(wx>=at.getX()&&wx<at.getX()+w&&wy>=at.getY()&&wy<at.getY()+h,false,'full rotated effective0 source-solid footprint nonoverlap');}
    }
    assert.deepEqual(WASTELAND_JAILS.map(xy=>game.area.getClip(game.area.at(xy))),[0,0]);
    assert.equal(wastelandReachable(game,WASTELAND_LANDINGS[0],WASTELAND_LANDINGS[1]),false,'native movement graph includes both ends and diagonals');
    for(const jail of WASTELAND_JAILS)for(const landing of WASTELAND_LANDINGS)assert.equal(wastelandReachable(game,jail,landing),false);
    assert.equal(wastelandReachable(game,WASTELAND_JAILS[0],WASTELAND_JAILS[1]),false);
    for(const z of [2,3]){assert.equal(game.area.getChunk(z,0,0),null);assert.notEqual(game.area.getClip(game.area.at([3296,5010,z]))&0x200100,0);}
    for(const [inside,outside]of [[[3264,5055,0],[3263,5055,0]],[[3327,5055,0],[3328,5055,0]],[[3296,4992,0],[3296,4991,0]],[[3296,5119,0],[3296,5120,0]]])assert.equal(core.RegionManager.canMovestart(game.area.at(inside),game.area.at(outside),1,1,game.area),false);
    const walker=[a,b].find(p=>game.members.get(p)===0);await wastelandWalk(walker,game,[3296,5054]);const target=game.area.at([3296,5056,0]);await wire(walker,walkClickFrame(target));tick(12);assert.equal(game.phase,'staging');assert.ok(walker.getLocation().getY()<game.area.at([3296,5055,0]).getY());
    const state=()=>({position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}),staging=state();
    // Disclosed independent seam-start checkpoint; the input and crossing themselves are ordinary decoded movement.
    const seamWalker=[a,b].find(p=>p!==walker),seamStart=game.area.at([3314,5054,0]),seamTarget=game.area.at([3314,5056,0]);seamWalker.moveTo(seamStart);tick(2);assert.deepEqual(position(seamWalker),[seamStart.getX(),seamStart.getY(),0]);assert.equal(game.area.getClip(seamStart),0);
    await wire(seamWalker,walkClickFrame(seamTarget));tick(12);assert.equal(game.phase,'staging');assert.ok(C.now()<game.starts,'both local negative attempts precede actual200tick preparation');assert.ok(seamWalker.getLocation().getY()<game.area.at([3315,5055,0]).getY(),'cannot bypass necessary x3315 endpoint during staging');
    const seamState=()=>({position:position(seamWalker),pathX:seamWalker.getMovementQueue().pathX,pathY:seamWalker.getMovementQueue().pathY,hasRoute:seamWalker.getMovementQueue().hasRoute()}),seamStaging=seamState();
    completePreparation(game);assert.equal(game.walls.length,0);
    for(const wall of walls){assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),null);assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(core.World.getObjects().includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);}
    assert.deepEqual(wastelandMasks(game.area),baseline,'full8192 restored BEFORE any intentional source mutation');assert.deepEqual(wastelandMasks(game.area,1),upper,'mapped upper masks unchanged');
    assert.equal(game.area.getClip(game.area.at([3268,5055,0])),0x200100);assert.equal(game.area.getClip(game.area.at([3315,5055,0])),0x1008,'native prison-wall direction and ray bits survive');assert.equal(wastelandReachable(game,WASTELAND_LANDINGS[0],WASTELAND_LANDINGS[1]),true);
    await wire(walker,walkClickFrame(target));tick(12);assert.deepEqual(position(walker),[target.getX(),target.getY(),0]);console.log('WASTELAND_MOVEMENT_QUALIFICATION '+JSON.stringify({requested:[target.getX(),target.getY(),0],staging,combat:state()}));
    await wire(seamWalker,walkClickFrame(seamTarget));tick(12);assert.deepEqual(position(seamWalker),[seamTarget.getX(),seamTarget.getY(),0]);console.log('WASTELAND_ENDSEAM_QUALIFICATION '+JSON.stringify({requested:[seamTarget.getX(),seamTarget.getY(),0],staging:seamStaging,combat:seamState(),setup:'supplied south-side seam approach'}));
    await wastelandWalk(walker,game,[3296,5100]);await wastelandWalk(walker,game,[3296,5057]);await wastelandWalk(walker,game,[3314,5054]);await wastelandWalk(walker,game,[3314,5056]);
  }finally{reference.destroy();}
});

test('native Wasteland ninth layout preserves eight configurations and both distinct Forfeit footprints',async()=>{
  const players=Array.from({length:18},()=>actor());for(const p of players)channel(p);const old=[];
  for(const[offset,arena,axis,coordinate,face,count]of [[0,1,'y',4959,0,52],[2,2,'y',5023,0,null],[4,3,'y',5087,0,24],[6,6,'y',4959,0,57],[8,5,'x',3167,1,43],[10,11,'y',4735,0,51],[12,12,'y',4826,0,29],[14,13,'x',3496,1,23]]){
    const team=players.slice(offset,offset+2),other=await negotiate(team[0],team[1],null,1,null,arena);for(const p of team)await join(p);assert.deepEqual([other.area.widthChunks,other.area.heightChunks],[arena===13?16:8,arena===11?16:8]);assert.equal(other.phase,'staging');if(count!==null)assert.equal(other.walls.length,count);
    for(const wall of other.walls){assert.equal(wall.getFace(),face);assert.equal(axis==='x'?wall.getLocation().getX()-other.area.getBaseX()+other.layout.origin[0]:wall.getLocation().getY()-other.area.getBaseY()+other.layout.origin[1],coordinate);}old.push({other,team});
  }
  const[a,b]=players.slice(16),game=await negotiate(a,b,null,1,null,0);await join(a);await join(b);assert.equal(new Set([...old.map(x=>x.other.area),game.area]).size,9);
  const foreign=mappedLayoutObjects(old[0].other,'clanwars_exitportal_darkrock_s')[0];assert.ok(foreign);assert.equal(Match.forfeit({player:a,object:foreign}),false);
  for(const player of [a,b]){const side=game.members.get(player),gameval=side===0?'clanwars_exitportal_darkrock_s':'clanwars_exitportal_darkrock_n',xy=side===0?[3294,5002]:[3295,5108],approach=side===0?[3296,5004]:[3296,5107],object=wastelandObject(game,gameval,xy);assert.equal(object.getId(),side===0?26727:26728);assert.equal(object.getFace(),side===0?0:2);assert.deepEqual([object.getDefinition().sizeX,object.getDefinition().sizeY],[4,2]);
    const fake=new core.GameObject(object.getId(),object.getLocation().clone(),object.getType(),object.getFace(),game.area);try{assert.equal(Match.forfeit({player,object:fake}),false);}finally{game.area.detach(fake);}
    assert.equal(wastelandReachable(game,WASTELAND_LANDINGS[side],[...approach,0]),true);assert.equal(wastelandReachable(game,WASTELAND_LANDINGS[1-side],[...approach,0]),false);await wastelandWalk(player,game,approach);await layoutObjectInput(player,game,gameval,xy,'Forfeit');assert.equal(C.matches.has(player),false);lobby(player);
  }
  assert.equal(game.phase,'staging');assert.equal(game.members.size,0);tick(game.starts-C.now());assert.equal(game.area.isDestroyed(),true);for(const{other,team}of old){assert.notEqual(other.phase,'over');assert.equal(other.area.isDestroyed(),false);for(const p of team)assert.equal(C.matches.get(p),other);}
});

test('native Wasteland Ignore5 actual six versus six retains real defeat threshold',async()=>{
  const{b,teams,players,game}=await stragglerGame(6,1,3,{},0);completePreparation(game);assert.equal(game.fighters.size,12);await lethalMelee(b,teams[0][1],game,true,[[3296,5010,0],[3297,5010,0]]);tick(6);assert.equal(game.phase,'over');for(const p of players)lobby(p);assert.equal(game.area.isDestroyed(),true);
});

for(const y of [5006,5057,5106])test(`native Wasteland concurrent melee starts at source north-center-south sample ${y}`,async()=>{
  const a=actor(true),mate=actor(true),b=actor(true);channel(a,[mate]);channel(b);const game=await negotiate(a,b,null,1,null,0);for(const p of [a,mate,b])await join(p);completePreparation(game);
  // Disclosed local combat checkpoints, not natural north/south traversal or retail spawns.
  for(const[p,xy]of [[a,[3296,y]],[mate,[3295,y]],[b,[3296,y+1]]]){ruleStats(p,99);p.moveTo(game.area.at([...xy,0]));p.setNeedsPlacement(false);p.resetUpdating();AreaManager.process(p);assert.equal(game.area.getClip(p.getLocation()),0);}
  assert.equal(game.area.isMulti(),true);assert.equal(game.fighters.get(a),game.fighters.get(mate));assert.notEqual(game.fighters.get(a),game.fighters.get(b));
  for(const p of [a,mate]){assert.equal(CombatFactory.canAttackByPolicy(p,b,CombatFactory.MELEE_COMBAT),CanAttackResponse.CAN_ATTACK);const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(b.getIndex(),2);await wire(p,frame);assert.equal(p.getCombat().getTarget(),b);}
  assert.equal(a.getCombat().getTarget(),b,'first melee start survives another valid attacker');assert.equal(mate.getCombat().getTarget(),b,'second native attacker shares the opposing target');assert.equal(game.phase,'combat');
  console.log('WASTELAND_MULTI_QUALIFICATION '+JSON.stringify({sourceY:y,attackers:[a.getIndex(),mate.getIndex()],target:b.getIndex(),bothNativeTargets:true}));
});

test('native Wasteland source Tree and Mushroom distinguish ordinary walking from native projectile rays',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,0);await join(a);await join(b);completePreparation(game);
  // Disclosed south-landing start checkpoint avoids assuming captain a is assigned south; subsequent local paths are decoded ordinary clicks.
  a.moveTo(game.area.at(WASTELAND_LANDINGS[0]));tick(2);assert.deepEqual(position(a),positionAt(game,WASTELAND_LANDINGS[0]));
  for(const specimen of [
    {gameval:'wild6_tree_a',xy:[3278,5020],from:[3278,5019],to:[3278,5022],size:2,face:1,type:11,projectile:true},
    {gameval:'wild6_mushrooms_a',xy:[3292,5026],from:[3292,5025],to:[3292,5027],size:1,face:0,type:11,projectile:false},
  ]){
    const object=wastelandObject(game,specimen.gameval,specimen.xy),def=object.getDefinition(),at=object.getLocation(),from=game.area.at([...specimen.from,0]),to=game.area.at([...specimen.to,0]);assert.equal(object.getType(),specimen.type);assert.equal(object.getFace(),specimen.face);assert.deepEqual([def.sizeX,def.sizeY],[specimen.size,specimen.size]);assert.equal(def.isSolid(),true);assert.equal(core.CacheDefinitions.getObject(object.getId()).blocksProjectile,specimen.projectile);
    for(let x=0;x<specimen.size;x++)for(let y=0;y<specimen.size;y++)assert.equal(game.area.getClip(game.area.at([specimen.xy[0]+x,specimen.xy[1]+y,0]))&0x20100,specimen.projectile?0x20100:0x100);
    assert.equal(game.area.getClip(from),0);assert.equal(game.area.getClip(to),0);assert.equal(wastelandReachable(game,WASTELAND_LANDINGS[0],[...specimen.from,0]),true);
    await wastelandWalk(a,game,specimen.from);await wire(a,walkClickFrame(at));for(let n=0;n<12;n++){tick();const here=a.getLocation();assert.equal(core.RegionManager.blocked(here,game.area),false);assert.equal(here.getX()>=at.getX()&&here.getX()<at.getX()+specimen.size&&here.getY()>=at.getY()&&here.getY()<at.getY()+specimen.size,false,'ordinary input never enters full solid footprint');}
    assert.equal(core.RegionManager.canMovestart(from,at,1,1,game.area),false);assert.equal(core.RegionManager.canProjectileAttackReturn(from,to,1,game.area),!specimen.projectile);await wastelandWalk(a,game,specimen.to);
    console.log('WASTELAND_OBSTACLE_QUALIFICATION '+JSON.stringify({id:object.getId(),source:specimen.xy,ray:!specimen.projectile,position:position(a)}));
  }
  const open=game.area.at([3296,5010,0]),adjacent=game.area.at([3297,5010,0]);assert.equal(core.RegionManager.canMovestart(open,adjacent,1,1,game.area),true);assert.equal(core.RegionManager.canProjectileAttackReturn(open,adjacent,1,game.area),true);
});

test('native Wasteland actionless owned Trees cannot dispatch chopping while canonical world Tree still produces logs and respawns',async t=>{
  resourceRandom(t);const a=actor(true),b=actor(true),world=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,0);await join(a);await join(b);completePreparation(game);
  // Disclosed south-landing start checkpoint avoids assuming captain a is assigned south; subsequent local paths are decoded ordinary clicks.
  a.moveTo(game.area.at(WASTELAND_LANDINGS[0]));tick(2);assert.deepEqual(position(a),positionAt(game,WASTELAND_LANDINGS[0]));
  const WC=require('../plugins/skills/Woodcutting.plugin'),I=core.ItemIdentifiers;const skills=a.getSkillManager();skills.setMaxLevel(core.Skill.WOODCUTTING,99);skills.setCurrentLevel(core.Skill.WOODCUTTING,99);give(a,I.BRONZE_AXE,'wasteland-valid-axe');
  const trees=['wild6_tree_a','wild6_tree_b','wild6_tree_c','wild6_fallen_tree'].flatMap(name=>mappedLayoutObjects(game,name));assert.equal(trees.length,134);const before=wastelandMasks(game.area),counts=new Map();
  for(const tree of trees){assert.equal(tree.getPrivateArea(),game.area);assert.equal(core.MapObjects.getPrivateArea(a,tree.getId(),tree.getLocation()),tree);assert.equal((tree.getDefinition().getInteractions()??[]).some(Boolean),false);counts.set(tree.getId(),(counts.get(tree.getId())??0)+1);assert.equal(tree.getDefinition().isSolid(),true);}
  assert.deepEqual([...counts].sort((x,y)=>x[0]-y[0]),[[14693,50],[14694,38],[14696,44],[14701,2]]);
  const{ObjectActionPacketListener}=require('../dist/net/packet/impl/ObjectActionPacketListener');const listener=new ObjectActionPacketListener();
  for(const[gameval,xy,approach]of [['wild6_tree_a',[3278,5020],[3278,5019]],['wild6_tree_b',[3277,5019],[3276,5019]],['wild6_tree_c',[3285,5011],[3284,5011]],['wild6_fallen_tree',[3293,5025],[3292,5025]]]){
    const tree=wastelandObject(game,gameval,xy);await wastelandWalk(a,game,approach);const xp=skills.getExperience(core.Skill.WOODCUTTING),logs=a.getInventory().getAmount(I.LOGS),menu=a.getCreationMenu();assert.equal(WC.isWoodcuttingActive(a),false);
    // Actual native object listener; unavailable named lookup and numeric first option both use the real all-null cache actions.
    listener.executeAction(a,tree.getId(),tree.getLocation().getX(),tree.getLocation().getY(),0,'Chop down');listener.executeAction(a,tree.getId(),tree.getLocation().getX(),tree.getLocation().getY(),1);tick(20);
    assert.equal(WC.isWoodcuttingActive(a),false);assert.equal(treeTask(tree),undefined);assert.equal(a.getCreationMenu(),menu);assert.equal(a.getInventory().getAmount(I.LOGS),logs);assert.equal(skills.getExperience(core.Skill.WOODCUTTING),xp);assert.equal(core.MapObjects.getPrivateArea(a,tree.getId(),tree.getLocation()),tree);
  }
  assert.deepEqual(wastelandMasks(game.area),before,'no unavailable chop can remove N geometry or create a stump');
  // Disclosed seeded ordinary world control, not an N resource, native login or natural RNG proof.
  world.moveTo(new core.Location(3222,3218,0));core.RegionManager.loadMapFiles(3222,3218);const tree=new core.GameObject(core.CacheDefinitions.getLocId('tree2'),new core.Location(3223,3218,0),10,2,null);core.ObjectManager.register(tree,true);tick();
  try{const xp=world.getSkillManager().getExperience(core.Skill.WOODCUTTING),task=await chopTree(world,tree);assert.equal(world.getInventory().getAmount(I.LOGS),1);assert.ok(world.getSkillManager().getExperience(core.Skill.WOODCUTTING)>xp);const remaining=task.getRemainingTicks();assert.ok(remaining>0);tick(remaining+1);assert.equal(task.isStopped(),true);assert.equal(core.MapObjects.get(tree.getId(),tree.getLocation(),null),tree);assert.deepEqual(wastelandMasks(game.area),before,'world lifecycle never mutates N source');}
  finally{core.ObjectManager.deregister(tree,true);}
});

test('native Wasteland cancellation reuses actual8x16 slot without changing another private match or world',async()=>{
  const players=Array.from({length:4},()=>actor(true));for(const p of players)channel(p);const[a,b,c,d]=players,dead=await negotiate(a,b,null,1,null,0);await join(a);await join(b);completePreparation(dead);const live=await negotiate(c,d,null,1,null,0);await join(c);await join(d);completePreparation(live);
  const baseline=wastelandMasks(dead.area),liveBefore=wastelandMasks(live.area),oldBase=[dead.area.getBaseX(),dead.area.getBaseY()],old=wastelandObject(dead,'wild6_tree_a',[3278,5020]),other=wastelandObject(live,'wild6_tree_a',[3278,5020]);const worldAt=new core.Location(3222,3218,0),worldClip=core.RegionManager.getClipping(worldAt.getX(),worldAt.getY(),0,null);dead.finish(null);assert.equal(dead.area.isDestroyed(),true);for(const p of [a,b])lobby(p);
  const replacement=wastelandTemplate(),replacementGame={area:replacement,layout:{origin:WASTELAND_ORIGIN}};
  try{assert.deepEqual([replacement.getBaseX(),replacement.getBaseY()],oldBase,'actual freed8x16 slot reused');const fresh=wastelandObject(replacementGame,'wild6_tree_a',[3278,5020]);assert.notEqual(fresh,old);assert.equal(fresh.getPrivateArea(),replacement);assert.deepEqual(wastelandMasks(replacement),baseline);assert.equal(replacement.resolveObject(fresh.getId(),fresh.getLocation()),fresh);tick(105);assert.deepEqual(wastelandMasks(replacement),baseline);assert.equal((fresh.getDefinition().getInteractions()??[]).some(Boolean),false);assert.deepEqual(wastelandMasks(live.area),liveBefore);assert.equal(core.MapObjects.getPrivateArea(c,other.getId(),other.getLocation()),other);assert.equal(live.area.isDestroyed(),false);assert.equal(C.matches.get(c),live);assert.equal(core.RegionManager.getClipping(worldAt.getX(),worldAt.getY(),0,null),worldClip);}
  finally{replacement.destroy();}
});

test('native Wasteland food drink prayer special vetoes preserve actual supplies and safe-death metadata',async()=>{
  const a=actor(true),b=actor(true);ruleStats(a);ruleStats(b);channel(a);channel(b);const game=await negotiate(a,b,null,1,{food:1,drinks:1,prayer:2,specialattacks:2},0);await join(a);await join(b);completePreparation(game);
  const I=core.ItemIdentifiers;give(a,I.SHRIMPS,'wasteland-food');give(a,I.ATTACK_POTION_4_,'wasteland-potion');let before=resources(a);await nativeItem(a,I.SHRIMPS,'Eat');assert.deepEqual(resources(a),before);await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.deepEqual(resources(a),before);
  await nativeButton(a,prayerWidget(core.PrayerHandler.THICK_SKIN));assert.equal(a.getPrayerActive().some(Boolean),false);assert.deepEqual(resources(a),before);await wield(a,I.DRAGON_DAGGER,'wasteland-special');before=resources(a);await nativeButton(a,'orbs:specbutton');assert.equal(a.isSpecialActivated(),false);assert.deepEqual(resources(a),before);
  const carried=carriedItems(a);await lethalMelee(b,a,game,true,[[3296,5010,0],[3297,5010,0]]);tick(6);assert.equal(game.jailed.has(a),true);assert.deepEqual(carriedItems(a),carried);assert.deepEqual(a.getEquipment().get(core.Equipment.WEAPON_SLOT).getMeta(),{qa:'wasteland-special'});
  game.finish(null);tick(2);a.setHitpoints(50);await nativeItem(a,I.SHRIMPS,'Eat');assert.equal(a.getInventory().contains(I.SHRIMPS),false,'same actual food is usable after match cleanup');await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.equal(a.getInventory().contains(I.ATTACK_POTION_3_),true);assert.deepEqual(a.getInventory().getValidItems().find(item=>item.getId()===I.ATTACK_POTION_3_).getMeta(),{qa:'wasteland-potion'});
});


// O: Turrets source-qualified TSPS choices. Source238/N254 are separate history.
const TURRETS_ORIGIN=[3136,4992],TURRETS_LANDINGS=[[3160,5010,0],[3160,5100,0]],TURRETS_JAILS=[[3167,5004,0],[3168,5105,0]];
const turretsReachable=(game,from,to)=>layoutReachable(game,from,to,TURRETS_ORIGIN);
const turretsMasks=wastelandMasks;
function turretsTemplate(){const area=new core.TemplatedInstanceArea(8,16);for(let z=0;z<2;z++)for(let x=0;x<8;x++)for(let y=0;y<16;y++)area.setChunk(z,x,y,{sourceChunkX:392+x,sourceChunkY:624+y,sourcePlane:z,rotation:0});area.at=tile=>area.tile(tile[0]-3136,tile[1]-4992,tile[2]);return area;}
async function turretsWalk(p,game,xy){
  const at=game.area.at([...xy,0]);assert.ok(Math.abs(p.getLocation().getX()-at.getX())<64&&Math.abs(p.getLocation().getY()-at.getY())<64,'decoded ordinary click is inside native search window');
  await wire(p,walkClickFrame(at));for(let n=0;n<120&&!p.getLocation().equals(at);n++)tick();assert.deepEqual(position(p),[at.getX(),at.getY(),0],'bounded decoded ordinary walk reaches exact endpoint');
}

test('native Turrets slot12 is deliberate and all ten offers retain numeric0 and default1',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  const session=C.negotiations.get(a),bit=core.CacheDefinitions.getVarbitId('clanwars_arena');assert.equal(session.rules.arena,1);
  await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);await click(b,'clanwars_setup:arena',12);assert.equal(session.rules.arena,4,'ordinary native12 reaches authoritative Turrets offer');assert.equal(session.accepted.size,0);
  for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(bit),4);assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(session.rules),/Turrets/);
  for(const[slot,arena]of[[0,0],[3,1],[6,2],[9,3],[15,5],[18,6],[33,11],[36,12],[39,13],[12,4]]){tick(9);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);await click(b,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,arena);assert.equal(session.accepted.size,0);for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(bit),arena);}
  for(const slot of[1,2,22,28,30,42,45,48,65535]){await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,4);for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(bit),4);}
  tick(9);await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(game.rules.arena,4);assert.equal(game.layout.name,'Turrets');
});
for(const mode of [0,1,16]) test(`native Turrets mode ${mode} retains restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},4);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3160,5010,0]));b.moveTo(game.area.at([3161,5010,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,TURRETS_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of[0,1])test(`native Turrets side ${victimIndex} real death, bounded holding and owned9751 viewing Exit`,async()=>{
  const foreign=[actor(),actor()];for(const p of foreign)channel(p);const other=await negotiate(foreign[0],foreign[1],null,1,null,4);for(const p of foreign)await join(p);
  const a=actor(true),b=actor(true),delay=victimIndex===1?1:0;channel(a);channel(b);const game=await negotiate(a,b,null,1,{rejoiningdelay:delay},4);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);victim.getInventory().add(new core.Item(995,79,{qa:'turrets'}));
  await lethalMelee(killer,victim,game,true,[[3160,5010,0],[3161,5010,0]]);tick(6);assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,TURRETS_JAILS[side]));
  const main=game.area.at(TURRETS_LANDINGS[side]);await wire(victim,walkClickFrame(main));tick(20);const source=()=>[victim.getLocation().getX()-game.area.getBaseX()+3136,victim.getLocation().getY()-game.area.getBaseY()+4992,0];assert.equal(turretsReachable(game,TURRETS_JAILS[side],source()),true);assert.equal(turretsReachable(game,source(),TURRETS_LANDINGS[side]),false,'native queued main attempt stays in holding');
  assert.equal(turretsReachable(game,TURRETS_JAILS[0],TURRETS_JAILS[1]),false);for(const landing of TURRETS_LANDINGS)assert.equal(turretsReachable(game,TURRETS_JAILS[side],landing),false);
  // The copy, not a claimed source wall, supplies the X boundary. Walk there normally and attempt one tile beyond.
  if(!delay){await turretsWalk(victim,game,[3136,side?5105:5004]);const outside=game.area.at([3135,side?5105:5004,0]);assert.equal(core.RegionManager.canMovestart(victim.getLocation(),outside,1,1,game.area),false);await wire(victim,walkClickFrame(outside));tick(12);assert.ok(victim.getLocation().getX()>=game.area.getBaseX());assert.equal(victim.getPrivateArea(),game.area);assert.equal(game.jailed.has(victim),true);}
  await turretsWalk(victim,game,side?[3158,5105]:[3157,5004]);assert.equal(victim.getInventory().getAmount(995),79);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'turrets'});
  const foreignPortal=mappedLayoutObjects(other,'clanwars_prisonportal_darkrock')[0],foreignOrb=mappedLayoutObjects(other,'clanwars_viewing_start_brownstone')[0];assert.ok(foreignPortal&&foreignOrb);assert.equal(Match.exit({player:victim,object:foreignPortal}),false);assert.equal(viewingUnit().use({player:victim,object:foreignOrb}),false);
  const inactive=mappedLayoutObjects(game,'clanwars_viewing_brownstone')[0];assert.ok(inactive);assert.equal(viewingUnit().use({player:victim,object:inactive}),false);
  const scripts=scriptCalls(victim),xy=side?[3158,5106]:[3157,5005];await layoutObjectInput(victim,game,'clanwars_viewing_start_brownstone',xy,'Use');assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));const state=viewingUnit().active.get(victim);assert.ok(state);assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9751));
  console.log('TURRETS_ORB_QUALIFICATION '+JSON.stringify({side,source:xy,approach:[state.location.getX(),state.location.getY(),0],model:9751}));
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);assert.deepEqual(position(victim),[state.location.getX(),state.location.getY(),0]);assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const exitXY=side?[3168,5106]:[3167,5005],owned=lumbridgeObject(game,'clanwars_prisonportal_darkrock',exitXY),fake=new core.GameObject(owned.getId(),owned.getLocation().clone(),owned.getType(),owned.getFace(),game.area);try{assert.equal(Match.exit({player:victim,object:fake}),false);}finally{game.area.detach(fake);}
  const deadline=game.returnAt.get(victim.getLongUsername());if(delay){assert.ok(Number.isInteger(deadline));assert.ok(deadline>C.now());}
  await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',exitXY,'Exit');if(delay){assert.equal(game.jailed.has(victim),true);assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(victim.getLongUsername()),deadline);assert.ok(deadline>C.now());tick(deadline-C.now());await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',exitXY,'Exit');}
  assert.equal(game.jailed.has(victim),false);assert.equal(game.fighters.has(victim),true);assert.deepEqual(position(victim),positionAt(game,TURRETS_LANDINGS[side]));
});

const TURRETS_RAISED=[{"entry":[3145,5028],"from":[3144,5028],"target":[3153,5027],"opponent":[3152,5027],"size":38,"deepSteps":8},{"entry":[3145,5082],"from":[3144,5082],"target":[3153,5081],"opponent":[3152,5081],"size":38,"deepSteps":8},{"entry":[3149,5041],"from":[3148,5041],"target":[3157,5040],"opponent":[3156,5040],"size":38,"deepSteps":8},{"entry":[3149,5069],"from":[3148,5069],"target":[3157,5068],"opponent":[3156,5068],"size":38,"deepSteps":8},{"entry":[3150,5010],"from":[3150,5009],"target":[3149,5018],"opponent":[3149,5017],"size":38,"deepSteps":8},{"entry":[3150,5101],"from":[3150,5102],"target":[3149,5093],"opponent":[3149,5094],"size":38,"deepSteps":8},{"entry":[3167,5021],"from":[3167,5020],"target":[3166,5047],"opponent":[3166,5046],"size":94,"deepSteps":26},{"entry":[3167,5090],"from":[3167,5091],"target":[3166,5064],"opponent":[3166,5065],"size":94,"deepSteps":26},{"entry":[3184,5010],"from":[3184,5009],"target":[3183,5018],"opponent":[3183,5017],"size":38,"deepSteps":8},{"entry":[3184,5101],"from":[3184,5102],"target":[3183,5093],"opponent":[3183,5094],"size":38,"deepSteps":8},{"entry":[3186,5041],"from":[3187,5041],"target":[3178,5040],"opponent":[3179,5040],"size":38,"deepSteps":8},{"entry":[3186,5069],"from":[3187,5069],"target":[3178,5068],"opponent":[3179,5068],"size":38,"deepSteps":8},{"entry":[3190,5028],"from":[3191,5028],"target":[3182,5027],"opponent":[3183,5027],"size":38,"deepSteps":8},{"entry":[3190,5082],"from":[3191,5082],"target":[3182,5081],"opponent":[3183,5081],"size":38,"deepSteps":8}];

for(const route of TURRETS_RAISED)test(`native Turrets ordinary raised walk and return via ${route.entry.join(',')}`,async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,4);await join(a);await join(b);const side=route.entry[1]<5056?0:1,walker=[a,b].find(p=>game.members.get(p)===side);
  assert.equal(turretsReachable(game,TURRETS_LANDINGS[side],[...route.target,0]),true,'staging includes the real raised route on its own side');assert.equal(turretsReachable(game,TURRETS_LANDINGS[1-side],[...route.target,0]),false,'raised route cannot bypass the preparation row');completePreparation(game);
  const arrival=[];for(const xy of[route.from,route.entry,route.target,route.entry,route.from]){await turretsWalk(walker,game,xy);arrival.push(position(walker));}
  assert.equal(walker.getPrivateArea(),game.area);assert.equal(game.fighters.has(walker),true);console.log('TURRETS_RAISED_ORDINARY_ROUTE '+JSON.stringify({sourceEntry:route.entry,sourceTarget:route.target,sourceComponentSize:route.size,arrival,plane:0,setup:'native assigned landing; all route movement decoded ordinary clicks, no raised checkpoint'}));
});

test('native Turrets48 owned walls restore full8192 and identical center west east queued crossings',async()=>{
  const a=actor(true),mate=actor(true),b=actor(true);channel(a,[mate]);channel(b);const game=await negotiate(a,b,null,0,null,4);for(const p of[a,mate,b])await join(p);
  assert.deepEqual([game.area.widthChunks,game.area.heightChunks],[8,16]);for(const p of[a,mate,b])assert.deepEqual(position(p),positionAt(game,TURRETS_LANDINGS[game.members.get(p)]));
  const reference=turretsTemplate();try{
    for(let z=0;z<2;z++)for(let x=0;x<8;x++)for(let y=0;y<16;y++)assert.deepEqual(game.area.getChunk(z,x,y),reference.getChunk(z,x,y));
    const baseline=turretsMasks(reference),upper=turretsMasks(reference,1),id=core.CacheDefinitions.getLocId('clanwars_barrier_brownstone'),def=core.CacheDefinitions.getObject(id),walls=game.walls.slice();
    assert.equal(id,26790);assert.deepEqual([def.sizeX,def.sizeY],[1,1]);assert.notEqual(def.clipType,0);assert.equal(def.blocksProjectile,true);assert.equal(walls.length,48);
    console.log('TURRETS_BARRIER_DEFINITION '+JSON.stringify({id,size:[def.sizeX,def.sizeY],clipType:def.clipType,blocksProjectile:def.blocksProjectile}));
    for(const wall of walls){assert.equal(wall.getId(),id);assert.equal(wall.getPrivateArea(),game.area);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),0);assert.equal(wall.getDefinition().isSolid(),true);assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),wall);assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getId()===id&&o.getPrivateArea()===game.area).length,1);assert.equal(core.RegionManager.blocked(wall.getLocation(),game.area),true);}
    const native=turretsMasks(game.area);for(let y=0;y<128;y++)for(let x=0;x<64;x++){const index=y*64+x,isWall=y===5055-4992&&x>=3144-3136&&x<=3191-3136;assert.equal(native[index],isWall?baseline[index]|0x20100:baseline[index],'full graph has only expected temporary native clips');}
    for(let x=0;x<8;x++)for(let y=0;y<16;y++)for(const object of reference.getChunkObjects(0,x,y)){
      if(![10,11].includes(object.getType())||!object.getDefinition().isSolid())continue;let{sizeX:w,sizeY:h}=object.getDefinition();if(object.getFace()%2)[w,h]=[h,w];const at=object.getLocation();
      for(const wall of walls){const wx=wall.getLocation().getX()-game.area.getBaseX()+reference.getBaseX(),wy=wall.getLocation().getY()-game.area.getBaseY()+reference.getBaseY();assert.equal(wx>=at.getX()&&wx<at.getX()+w&&wy>=at.getY()&&wy<at.getY()+h,false);}
    }
    for(const jail of TURRETS_JAILS){assert.equal(game.area.getClip(game.area.at(jail)),0);for(const landing of TURRETS_LANDINGS)assert.equal(turretsReachable(game,jail,landing),false);}
    assert.equal(turretsReachable(game,TURRETS_JAILS[0],TURRETS_JAILS[1]),false);assert.equal(turretsReachable(game,TURRETS_LANDINGS[0],TURRETS_LANDINGS[1]),false,'full native graph cannot bypass either end or any raised route');
    for(const z of[2,3]){assert.equal(game.area.getChunk(z,0,0),null);assert.notEqual(game.area.getClip(game.area.at([3160,5010,z]))&0x200100,0);}
    for(const[inside,outside]of[[[3136,5004,0],[3135,5004,0]],[[3199,5004,0],[3200,5004,0]],[[3136,5105,0],[3135,5105,0]],[[3199,5105,0],[3200,5105,0]],[[3160,4992,0],[3160,4991,0]],[[3160,5119,0],[3160,5120,0]]])assert.equal(core.RegionManager.canMovestart(game.area.at(inside),game.area.at(outside),1,1,game.area),false,'bounded template edge, not claimed closed source wall');
    const samples=[];for(const[p,x]of[[a,3160],[mate,3144],[b,3191]]){
      // Disclosed short south-side checkpoint for each independent center/endpoint attempt, not natural approach proof.
      const start=game.area.at([x,5054,0]),target=game.area.at([x,5056,0]);p.moveTo(start);tick(2);assert.deepEqual(position(p),[start.getX(),start.getY(),0]);assert.equal(core.RegionManager.blocked(start,game.area),false);
      await wire(p,walkClickFrame(target));tick(12);assert.equal(game.phase,'staging');assert.ok(C.now()<game.starts,'three attempts fit actual200tick preparation');assert.ok(p.getLocation().getY()<game.area.at([x,5055,0]).getY(),'actual ordinary crossing stays south');
      samples.push({p,x,target,staging:{position:position(p),pathX:p.getMovementQueue().pathX,pathY:p.getMovementQueue().pathY,hasRoute:p.getMovementQueue().hasRoute()}});
    }
    completePreparation(game);assert.equal(game.walls.length,0);for(const wall of walls){assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),null);assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(core.World.getObjects().includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);}
    assert.deepEqual(turretsMasks(game.area),baseline,'full8192 restored BEFORE mutations');assert.deepEqual(turretsMasks(game.area,1),upper);assert.equal(turretsReachable(game,TURRETS_LANDINGS[0],TURRETS_LANDINGS[1]),true);
    for(const[x,flag]of[[3144,0x10080],[3191,0x1008],[3166,0x804],[3167,0x402],[3168,0x201]])assert.equal(game.area.getClip(game.area.at([x,5055,0])),flag);
    for(const{p,x,target,staging}of samples){await wire(p,walkClickFrame(target));tick(12);assert.deepEqual(position(p),[target.getX(),target.getY(),0]);console.log('TURRETS_QUEUED_CROSSING '+JSON.stringify({sourceX:x,requested:[target.getX(),target.getY(),0],staging,combat:{position:position(p),pathX:p.getMovementQueue().pathX,pathY:p.getMovementQueue().pathY,hasRoute:p.getMovementQueue().hasRoute()}}));}
  }finally{reference.destroy();}
});

test('native Turrets tenth layout retains all nine configurations and both rotated4x2 Forfeit portals',async()=>{
  const players=Array.from({length:20},()=>actor());for(const p of players)channel(p);const old=[];
  for(const[offset,arena,axis,coordinate,face,count]of[[0,1,'y',4959,0,52],[2,2,'y',5023,0,null],[4,3,'y',5087,0,24],[6,6,'y',4959,0,57],[8,5,'x',3167,1,43],[10,11,'y',4735,0,51],[12,12,'y',4826,0,29],[14,13,'x',3496,1,23],[16,0,'y',5055,0,47]]){
    const team=players.slice(offset,offset+2),other=await negotiate(team[0],team[1],null,1,null,arena);for(const p of team)await join(p);assert.deepEqual([other.area.widthChunks,other.area.heightChunks],[arena===13?16:8,[0,11].includes(arena)?16:8]);assert.equal(other.phase,'staging');if(count!==null)assert.equal(other.walls.length,count);for(const wall of other.walls){assert.equal(wall.getFace(),face);assert.equal(axis==='x'?wall.getLocation().getX()-other.area.getBaseX()+other.layout.origin[0]:wall.getLocation().getY()-other.area.getBaseY()+other.layout.origin[1],coordinate);}old.push({other,team});
  }
  const[a,b]=players.slice(18),game=await negotiate(a,b,null,1,null,4);await join(a);await join(b);assert.equal(new Set([...old.map(x=>x.other.area),game.area]).size,10);
  const foreign=mappedLayoutObjects(old.find(x=>x.other.rules.arena===3).other,'clanwars_exitportal_greyrock_s')[0];assert.ok(foreign);assert.equal(Match.forfeit({player:a,object:foreign}),false);
  for(const player of[a,b]){const side=game.members.get(player),name=side?'clanwars_exitportal_greyrock_s':'clanwars_exitportal_greyrock_n',xy=side?[3166,5094]:[3166,5016],object=lumbridgeObject(game,name,xy);assert.equal(object.getId(),side?26731:26732);assert.equal(object.getFace(),side?0:2);assert.deepEqual([object.getDefinition().sizeX,object.getDefinition().sizeY],[4,2]);assert.equal(object.getDefinition().getBlockingMask(),30);
    const fake=new core.GameObject(object.getId(),object.getLocation().clone(),object.getType(),object.getFace(),game.area);try{assert.equal(Match.forfeit({player,object:fake}),false);}finally{game.area.detach(fake);}
    // Cache access mask rotates with face; native object routing chooses the allowed side of the full footprint.
    assert.equal(turretsReachable(game,TURRETS_LANDINGS[side],[3165,xy[1],0]),true);await layoutObjectInput(player,game,name,xy,'Forfeit');assert.equal(C.matches.has(player),false);lobby(player);
  }
  assert.equal(game.phase,'staging');assert.equal(game.members.size,0);tick(game.starts-C.now());assert.equal(game.area.isDestroyed(),true);for(const{other,team}of old){assert.notEqual(other.phase,'over');assert.equal(other.area.isDestroyed(),false);for(const p of team)assert.equal(C.matches.get(p),other);}
});

test('native Turrets Ignore5 uses actual six versus six and a real safe defeat',async()=>{
  const{b,teams,players,game}=await stragglerGame(6,1,3,{},4);completePreparation(game);assert.equal(game.fighters.size,12);await lethalMelee(b,teams[0][1],game,true,[[3160,5010,0],[3161,5010,0]]);tick(6);assert.equal(game.phase,'over');for(const p of players)lobby(p);assert.equal(game.area.isDestroyed(),true);
});

for(const routeIndex of[0,6,7])test(`native Turrets raised melee access on side and both central structures ${routeIndex}`,async()=>{
  const route=TURRETS_RAISED[routeIndex],a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,4);await join(a);await join(b);completePreparation(game);for(const p of[a,b])ruleStats(p,99);
  // Preserve each assigned landing. Cross the arena with explicit intermediate decoded clicks when the destination exceeds search range.
  for(const[p,target]of[[a,route.target],[b,route.opponent]]){const side=game.members.get(p);if(Math.abs(TURRETS_LANDINGS[side][1]-route.from[1])>=64)await turretsWalk(p,game,[3160,5056]);await turretsWalk(p,game,route.from);await turretsWalk(p,game,route.entry);await turretsWalk(p,game,target);}
  assert.equal(game.area.isMulti(),true);assert.equal(CombatFactory.canAttackByPolicy(a,b,CombatFactory.MELEE_COMBAT),CanAttackResponse.CAN_ATTACK);const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(b.getIndex(),2);await wire(a,frame);assert.equal(a.getCombat().getTarget(),b);assert.equal(game.phase,'combat');
  console.log('TURRETS_RAISED_MELEE '+JSON.stringify({sourceEntry:route.entry,sourceTarget:route.target,sourceOpponent:route.opponent,positions:[position(a),position(b)],nativeTarget:true,setup:'ordinary decoded traversal from actual assigned landings, no raised checkpoints'}));
});

test('native Turrets actual source walls distinguish walking detours from blocked and passing projectile rays',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,4);await join(a);await join(b);completePreparation(game);
  // Disclosed south-landing checkpoint only; wall approaches and detours are decoded ordinary movement.
  a.moveTo(game.area.at(TURRETS_LANDINGS[0]));tick(2);
  for(const specimen of[{name:'oldcastlewall',id:1620,y:5011,projectile:true,masks:[0x1008,0x10080]},{name:'oldcastlecrumbly_r_nonblock',id:26637,y:5010,projectile:false,masks:[0x8,0x80]}]){
    const object=lumbridgeObject(game,specimen.name,[3149,specimen.y]),from=game.area.at([3149,specimen.y,0]),to=game.area.at([3150,specimen.y,0]);assert.equal(object.getId(),specimen.id);assert.equal(object.getType(),0);assert.equal(object.getFace(),2);assert.equal(object.getPrivateArea(),game.area);assert.equal(core.CacheDefinitions.getObject(object.getId()).blocksProjectile,specimen.projectile);assert.deepEqual([game.area.getClip(from),game.area.getClip(to)],specimen.masks);assert.equal(core.RegionManager.blocked(from,game.area),false);assert.equal(core.RegionManager.blocked(to,game.area),false);
    assert.equal(core.RegionManager.canMovestart(from,to,1,1,game.area),false,'ordinary adjacent movement edge is closed');assert.equal(core.RegionManager.canProjectileAttackReturn(from,to,1,game.area),!specimen.projectile);
    await turretsWalk(a,game,[3149,specimen.y]);await wire(a,walkClickFrame(to));let steps=0;for(;steps<120&&!a.getLocation().equals(to);steps++){const prior=a.getLocation().clone();tick();const here=a.getLocation();assert.equal(prior.equals(from)&&here.equals(to),false,'native walker cannot take the blocked direct edge');}assert.deepEqual(position(a),[to.getX(),to.getY(),0],'ordinary route actually detours and arrives');
    console.log('TURRETS_WALL_WALK_RAY '+JSON.stringify({id:specimen.id,source:[3149,specimen.y],directWalk:false,ray:!specimen.projectile,detourArrival:position(a),ticks:steps}));
  }
  const from=game.area.at([3160,5010,0]),to=game.area.at([3161,5010,0]);assert.equal(core.RegionManager.canMovestart(from,to,1,1,game.area),true);assert.equal(core.RegionManager.canProjectileAttackReturn(from,to,1,game.area),true);
});

test('native Turrets source resources and climb actions remain absent while canonical world chopping still works',async t=>{
  resourceRandom(t);const a=actor(true),b=actor(true),world=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,4);await join(a);await join(b);completePreparation(game);
  const ordinaryNames=new Set(['tree','dead tree','evergreen tree','dying tree','oak tree','fountain','sink','gold sink','well','tap','water barrel','water pump','waterpump','pump and drain','pump and tub','cooking range','range','stove','oven','clay oven','small oven','large oven','steel range','fancy range','fire',"forester's campfire",'firepit','firepit with hook','firepit with pot']);
  const objects=[];for(let z=0;z<2;z++)for(let x=0;x<8;x++)for(let y=0;y<16;y++)objects.push(...game.area.getChunkObjects(z,x,y));const actions=[];
  for(const object of objects){assert.equal(object.getPrivateArea(),game.area);const def=object.getDefinition(),options=(def.getInteractions()??[]).filter(Boolean);assert.equal(ordinaryNames.has(String(def.getName()).toLowerCase()),false,'no actionful resource manufactured from scenery');assert.equal(options.some(option=>/climb|walk-up|walk-down|ascend|descend/i.test(option)),false);if(options.length)actions.push([object.getId(),options]);}
  assert.equal(actions.length,12);assert.deepEqual([...new Set(actions.map(x=>x[0]))].sort((x,y)=>x-y),[26731,26732,26738,26747]);assert.equal(mappedLayoutObjects(game,'clanwars_viewing_start_brownstone').length,8);assert.equal(mappedLayoutObjects(game,'clanwars_viewing_brownstone').length,5);
  const before=turretsMasks(game.area);world.moveTo(new core.Location(3222,3218,0));core.RegionManager.loadMapFiles(3222,3218);const tree=new core.GameObject(core.CacheDefinitions.getLocId('tree2'),new core.Location(3223,3218,0),10,2,null);core.ObjectManager.register(tree,true);tick();
  try{const xp=world.getSkillManager().getExperience(core.Skill.WOODCUTTING),task=await chopTree(world,tree);assert.equal(world.getInventory().getAmount(core.ItemIdentifiers.LOGS),1);assert.ok(world.getSkillManager().getExperience(core.Skill.WOODCUTTING)>xp);const remaining=task.getRemainingTicks();assert.ok(remaining>0);tick(remaining+1);assert.equal(task.isStopped(),true);assert.equal(core.MapObjects.get(tree.getId(),tree.getLocation(),null),tree);assert.deepEqual(turretsMasks(game.area),before,'disclosed seeded world positive never mutates Turrets scenery');}finally{core.ObjectManager.deregister(tree,true);}
});

test('native Turrets teardown reuses actual8x16 slot with full masks and current ownership while another match and world survive',async()=>{
  const players=Array.from({length:4},()=>actor(true));for(const p of players)channel(p);const[a,b,c,d]=players,dead=await negotiate(a,b,null,1,null,4);await join(a);await join(b);completePreparation(dead);const live=await negotiate(c,d,null,1,null,4);await join(c);await join(d);completePreparation(live);
  const baseline=turretsMasks(dead.area),liveBefore=turretsMasks(live.area),oldBase=[dead.area.getBaseX(),dead.area.getBaseY()],old=lumbridgeObject(dead,'clanwars_viewing_start_brownstone',[3157,5005]),other=lumbridgeObject(live,'clanwars_viewing_start_brownstone',[3157,5005]),worldAt=new core.Location(3222,3218,0),worldClip=core.RegionManager.getClipping(worldAt.getX(),worldAt.getY(),0,null);dead.finish(null);assert.equal(dead.area.isDestroyed(),true);for(const p of[a,b])lobby(p);
  const replacement=turretsTemplate(),replacementGame={area:replacement,layout:{origin:TURRETS_ORIGIN}};try{
    assert.deepEqual([replacement.getBaseX(),replacement.getBaseY()],oldBase);const fresh=lumbridgeObject(replacementGame,'clanwars_viewing_start_brownstone',[3157,5005]);assert.notEqual(fresh,old);assert.equal(fresh.getPrivateArea(),replacement);assert.equal(replacement.resolveObject(fresh.getId(),fresh.getLocation()),fresh);assert.deepEqual(turretsMasks(replacement),baseline);tick(105);assert.deepEqual(turretsMasks(replacement),baseline);assert.deepEqual(turretsMasks(live.area),liveBefore);assert.equal(core.MapObjects.getPrivateArea(c,other.getId(),other.getLocation()),other);assert.equal(live.area.isDestroyed(),false);assert.equal(C.matches.get(c),live);assert.equal(core.RegionManager.getClipping(worldAt.getX(),worldAt.getY(),0,null),worldClip);assert.equal(Match.exit({player:c,object:old}),false,'stale destroyed-slot object cannot act in a live match');
  }finally{replacement.destroy();}
});


test('native Turrets food drink prayer special vetoes preserve actual supplies and safe-death metadata',async()=>{
  const a=actor(true),b=actor(true);ruleStats(a);ruleStats(b);channel(a);channel(b);const game=await negotiate(a,b,null,1,{food:1,drinks:1,prayer:2,specialattacks:2},4);await join(a);await join(b);completePreparation(game);
  const I=core.ItemIdentifiers;give(a,I.SHRIMPS,'turrets-food');give(a,I.ATTACK_POTION_4_,'turrets-potion');let before=resources(a);await nativeItem(a,I.SHRIMPS,'Eat');assert.deepEqual(resources(a),before);await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.deepEqual(resources(a),before);
  await nativeButton(a,prayerWidget(core.PrayerHandler.THICK_SKIN));assert.equal(a.getPrayerActive().some(Boolean),false);assert.deepEqual(resources(a),before);await wield(a,I.DRAGON_DAGGER,'turrets-special');before=resources(a);await nativeButton(a,'orbs:specbutton');assert.equal(a.isSpecialActivated(),false);assert.deepEqual(resources(a),before);
  const carried=carriedItems(a);await lethalMelee(b,a,game,true,[[3160,5010,0],[3161,5010,0]]);tick(6);assert.equal(game.jailed.has(a),true);assert.deepEqual(carriedItems(a),carried);assert.deepEqual(a.getEquipment().get(core.Equipment.WEAPON_SLOT).getMeta(),{qa:'turrets-special'});
  game.finish(null);tick(2);a.setHitpoints(50);await nativeItem(a,I.SHRIMPS,'Eat');assert.equal(a.getInventory().contains(I.SHRIMPS),false,'same actual food is usable after match cleanup');await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.equal(a.getInventory().contains(I.ATTACK_POTION_3_),true);assert.deepEqual(a.getInventory().getValidItems().find(item=>item.getId()===I.ATTACK_POTION_3_).getMeta(),{qa:'turrets-potion'});
});

// P: Northleach Quell. Bounded source facts and explicit TSPS choices; native outcomes belong to raw results.
const NORTHLEACH_ORIGIN=[3392,4864],NORTHLEACH_LANDINGS=[[3406,4880,0],[3445,4915,0]],NORTHLEACH_JAILS=[[3420,4899,0],[3427,4899,0]];
const northleachReachable=(game,from,to)=>layoutReachable(game,from,to,NORTHLEACH_ORIGIN);
const northleachObject=lumbridgeObject;
function northleachMasks(area){const a=[];for(let y=0;y<64;y++)for(let x=0;x<64;x++)a.push(area.getClip(area.tile(x,y,0)));return a;}
function northleachTemplate(){const area=new core.TemplatedInstanceArea(8,8);for(let x=0;x<8;x++)for(let y=0;y<8;y++)area.setChunk(0,x,y,{sourceChunkX:424+x,sourceChunkY:608+y,sourcePlane:0,rotation:0});area.at=tile=>area.tile(tile[0]-3392,tile[1]-4864,tile[2]);return area;}
async function northleachWalk(p,game,xy){const at=game.area.at([...xy,0]);assert.ok(Math.abs(at.getX()-p.getLocation().getX())<64&&Math.abs(at.getY()-p.getLocation().getY())<64,'ordinary first destination inside native search window');await wire(p,walkClickFrame(at));for(let n=0;n<150&&!p.getLocation().equals(at);n++)tick();assert.deepEqual(position(p),[at.getX(),at.getY(),0],'bounded ordinary decoded walk reaches source endpoint');}
const northleachSourcePosition=(p,game)=>[p.getLocation().getX()-game.area.getBaseX()+3392,p.getLocation().getY()-game.area.getBaseY()+4864,0];
const northleachSettings=()=>Array.from(require('../dist/game/collision/TemplateRegionData').getTemplateRegion(13644).settings);
function northleachMappedSettings(area){const settings=new Uint8Array(4*4096);for(let x=0;x<8;x++)for(let y=0;y<8;y++)area.copyChunkSettings(settings,0,x,y);return Array.from(settings.subarray(0,4096));}
function northleachNativeObject(p,id,at,op=1){const {ObjectActionPacketListener}=require('../dist/net/packet/impl/ObjectActionPacketListener');new ObjectActionPacketListener().executeAction(p,id,at.getX(),at.getY(),op);}

test('native Northleach slot24 resets acceptance and all eleven offers retain explicit0 default1',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);const session=C.negotiations.get(a),bit=core.CacheDefinitions.getVarbitId('clanwars_arena');assert.equal(session.rules.arena,1);
  await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);await click(b,'clanwars_setup:arena',24);assert.equal(session.rules.arena,8,'ordinary native24 reaches authoritative Northleach offer');assert.equal(session.accepted.size,0);
  assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(session.rules),/Northleach Quell/);
  for(const[slot,arena]of[[0,0],[3,1],[6,2],[9,3],[12,4],[15,5],[18,6],[33,11],[36,12],[39,13],[24,8]]){tick(9);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);await click(b,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,arena);assert.equal(session.accepted.size,0);for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(bit),arena);}
  for(const slot of[1,2,22,28,30,42,45,48,65535]){await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,8);for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(bit),8);}
  tick(9);await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(game.rules.arena,8);assert.equal(game.layout.name,'Northleach Quell');
});

for(const mode of[0,1,16])test(`native Northleach mode ${mode} preserves supply terms and late-entry family`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);const game=await negotiate(a,b,null,mode,{food:1,prayer:2},8);await join(a);await join(b);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3406,4880,0]));b.moveTo(game.area.at([3407,4880,0]));tick(2);assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode){await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,NORTHLEACH_LANDINGS[game.members.get(late)]));}else{Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16){core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});

for(const victimIndex of[0,1])test(`native Northleach side ${victimIndex} real death18-cell holding9755 camera Exit deadline`,async()=>{
  const f=[actor(),actor()];for(const p of f)channel(p);const other=await negotiate(f[0],f[1],null,1,null,8);for(const p of f)await join(p);
  const a=actor(true),b=actor(true),delay=victimIndex;channel(a);channel(b);const game=await negotiate(a,b,null,1,{rejoiningdelay:delay},8);await join(a);await join(b);completePreparation(game);
  const victim=[a,b][victimIndex],killer=[b,a][victimIndex],side=game.members.get(victim);victim.getInventory().add(new core.Item(995,79,{qa:'northleach'}));await lethalMelee(killer,victim,game,true,[[3406,4880,0],[3407,4880,0]]);tick(6);assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,NORTHLEACH_JAILS[side]));
  assert.equal(northleachReachable(game,NORTHLEACH_JAILS[0],NORTHLEACH_JAILS[1]),false);for(const jail of NORTHLEACH_JAILS)for(const landing of NORTHLEACH_LANDINGS)assert.equal(northleachReachable(game,jail,landing),false);
  await wire(victim,walkClickFrame(game.area.at(NORTHLEACH_LANDINGS[side])));tick(12);assert.equal(northleachReachable(game,NORTHLEACH_JAILS[side],northleachSourcePosition(victim,game)),true);
  await wire(victim,walkClickFrame(game.area.at(NORTHLEACH_JAILS[1-side])));tick(12);assert.equal(northleachReachable(game,NORTHLEACH_JAILS[side],northleachSourcePosition(victim,game)),true);
  const x0=side?3425:3419,x1=side?3428:3422;
  for(const[inside,outside]of[[[x0,4899],[x0-1,4899]],[[x1,4899],[x1+1,4899]],[[side?3426:3421,4897],[side?3426:3421,4896]],[[side?3427:3420,4901],[side?3427:3420,4902]]])assert.equal(core.RegionManager.canMovestart(game.area.at([...inside,0]),game.area.at([...outside,0]),1,1,game.area),false,'native holding boundary remains closed');
  assert.equal(victim.getInventory().getAmount(995),79);assert.deepEqual(victim.getInventory().getValidItems().find(i=>i.getId()===995).getMeta(),{qa:'northleach'});
  const foreignPortal=mappedLayoutObjects(other,'clanwars_prisonportal_elfwood')[0],foreignOrb=mappedLayoutObjects(other,'clanwars_viewing_start_greyrock')[0];assert.ok(foreignPortal&&foreignOrb);assert.equal(Match.exit({player:victim,object:foreignPortal}),false);assert.equal(viewingUnit().use({player:victim,object:foreignOrb}),false);
  const inactive=mappedLayoutObjects(game,'clanwars_viewing_greyrock')[0];assert.ok(inactive);assert.equal(viewingUnit().use({player:victim,object:inactive}),false);
  const orbXY=side?[3426,4901]:[3421,4901];await northleachWalk(victim,game,side?[3426,4900]:[3421,4900]);const scripts=scriptCalls(victim);await layoutObjectInput(victim,game,'clanwars_viewing_start_greyrock',orbXY,'Use');const state=viewingUnit().active.get(victim);assert.ok(state);assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9755));
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);assert.deepEqual(position(victim),[state.location.getX(),state.location.getY(),0]);assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const xy=side?[3427,4897]:[3420,4897],owned=northleachObject(game,'clanwars_prisonportal_elfwood',xy),fake=new core.GameObject(owned.getId(),owned.getLocation().clone(),10,0,game.area);try{assert.equal(Match.exit({player:victim,object:fake}),false);}finally{game.area.detach(fake);}
  const deadline=game.returnAt.get(victim.getLongUsername());if(delay){assert.ok(Number.isInteger(deadline));assert.ok(deadline>C.now());}
  await northleachWalk(victim,game,side?[3427,4898]:[3420,4898]);await layoutObjectInput(victim,game,'clanwars_prisonportal_elfwood',xy,'Exit');if(delay){assert.equal(game.jailed.has(victim),true);assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(victim.getLongUsername()),deadline);assert.ok(deadline>C.now());tick(deadline-C.now());await layoutObjectInput(victim,game,'clanwars_prisonportal_elfwood',xy,'Exit');}
  assert.equal(game.jailed.has(victim),false);assert.equal(game.fighters.has(victim),true);assert.deepEqual(position(victim),positionAt(game,NORTHLEACH_LANDINGS[side]));console.log('NORTHLEACH_HOLDING '+JSON.stringify({side,orb:orbXY,model:9755,exit:xy,ordinary:true}));
});

test('native Northleach four owned barriers preserve full4096 and coincident type22 before resource mutation',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,8);await join(a);await join(b);const reference=northleachTemplate();
  try{
    const baseline=northleachMasks(reference),settings=northleachSettings(),mapped=northleachMappedSettings(reference),id=core.CacheDefinitions.getLocId('clanwars_barrier_greyrock'),def=core.CacheDefinitions.getObject(id),walls=game.walls.slice();assert.deepEqual([def.sizeX,def.sizeY,def.clipType,def.blocksProjectile],[1,1,1,true]);assert.equal(id,26786);assert.equal(walls.length,4);assert.equal(mapped.length,4096);assert.deepEqual(mapped,settings.slice(0,4096));assert.deepEqual(northleachMappedSettings(game.area),mapped);
    for(let x=0;x<8;x++)for(let y=0;y<8;y++)assert.deepEqual(game.area.getChunk(0,x,y),reference.getChunk(0,x,y));for(const p of[a,b])assert.deepEqual(position(p),positionAt(game,NORTHLEACH_LANDINGS[game.members.get(p)]));
    const floor=northleachObject(game,'hunting_polar_climbing_rocks_falloff',[3406,4895]);assert.equal(floor.getId(),19848);assert.equal(floor.getType(),22);assert.equal(floor.getDefinition().isClippedDecoration(),false);assert.equal(floor.getDefinition().isSolid(),true);assert.equal(baseline[31*64+14],0);
    const row=new Set([3406,3438,3439,3440]);for(const wall of walls){assert.equal(wall.getId(),id);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),0);assert.equal(wall.getPrivateArea(),game.area);assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),wall);assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getId()===id&&o.getPrivateArea()===game.area&&o.getType()===10).length,1);}
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){const sourceX=x+3392,sourceY=y+4864,old=baseline[y*64+x];assert.equal(game.area.getClip(game.area.tile(x,y,0)),old|((sourceY===4895&&row.has(sourceX))?0x20100:0));if(sourceY===4895)assert.equal(walls.filter(w=>w.getLocation().equals(game.area.tile(x,y,0))).length,old&core.RegionManager.BLOCKED_MASK?0:1);}
    for(let x=0;x<8;x++)for(let y=0;y<8;y++)for(const object of reference.getChunkObjects(0,x,y)){if(object.getType()<9||object.getType()>11||!object.getDefinition().isSolid())continue;const d=object.getDefinition(),rot=object.getFace()%2,w=rot?d.sizeY:d.sizeX,h=rot?d.sizeX:d.sizeY,sx=object.getLocation().getX()-reference.getBaseX()+3392,sy=object.getLocation().getY()-reference.getBaseY()+4864;for(const wallX of row)assert.equal(wallX>=sx&&wallX<sx+w&&4895>=sy&&4895<sy+h,false,'no full rotated nonzero solid rectangle overlap');}
    assert.equal(northleachReachable(game,NORTHLEACH_LANDINGS[0],NORTHLEACH_LANDINGS[1]),false);
    const walker=[a,b].find(p=>game.members.get(p)===0),crossings=[{from:[3406,4893],to:[3406,4897]},{from:[3438,4894],to:[3439,4896]},{from:[3439,4894],to:[3440,4896]}],markers=[];
    for(const route of crossings){assert.equal(northleachReachable(game,NORTHLEACH_LANDINGS[0],[...route.from,0]),true);assert.equal(northleachReachable(game,NORTHLEACH_LANDINGS[1],[...route.to,0]),true);await northleachWalk(walker,game,route.from);assert.ok(C.now()+12<game.starts,'bounded staging processing before200-tick boundary');const target=game.area.at([...route.to,0]);await wire(walker,walkClickFrame(target));tick(6);assert.equal(game.phase,'staging');assert.ok(northleachSourcePosition(walker,game)[1]<4895);markers.push({route,staging:position(walker),requested:[target.getX(),target.getY(),0]});}
    completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.walls.length,0);assert.deepEqual(northleachMasks(game.area),baseline,'full4096 native restoration BEFORE any resource mutation');assert.deepEqual(northleachSettings(),settings);assert.deepEqual(northleachMappedSettings(game.area),mapped);assert.equal(northleachObject(game,'hunting_polar_climbing_rocks_falloff',[3406,4895]),floor);assert.equal(core.MapObjects.getPrivateArea(a,floor.getId(),floor.getLocation()),floor);
    for(const wall of walls){assert.equal(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),null);assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);}
    for(const m of markers){await northleachWalk(walker,game,m.route.from);await northleachWalk(walker,game,m.route.to);m.combat=position(walker);m.pathX=walker.getMovementQueue().pathX;m.pathY=walker.getMovementQueue().pathY;m.hasRoute=walker.getMovementQueue().hasRoute();assert.equal(m.hasRoute,true);console.log('NORTHLEACH_CROSSING '+JSON.stringify(m));}
    for(const jail of NORTHLEACH_JAILS)for(const landing of NORTHLEACH_LANDINGS)assert.equal(northleachReachable(game,jail,landing),false);assert.equal(northleachReachable(game,NORTHLEACH_LANDINGS[0],NORTHLEACH_LANDINGS[1]),true);
  }finally{reference.destroy();}
});

test('native Northleach eleventh layout preserves ten concurrent configurations and both same26728 Forfeits',async()=>{
  const players=Array.from({length:22},()=>actor());for(const p of players)channel(p);const old=[];
  for(const[offset,arena,axis,coordinate,face,count]of[[0,1,'y',4959,0,52],[2,2,'y',5023,0,null],[4,3,'y',5087,0,24],[6,6,'y',4959,0,57],[8,5,'x',3167,1,43],[10,11,'y',4735,0,51],[12,12,'y',4826,0,29],[14,13,'x',3496,1,23],[16,0,'y',5055,0,47],[18,4,'y',5055,0,48]]){const team=players.slice(offset,offset+2),other=await negotiate(team[0],team[1],null,1,null,arena);for(const p of team)await join(p);assert.deepEqual([other.area.widthChunks,other.area.heightChunks],[arena===13?16:8,[0,4,11].includes(arena)?16:8]);if(count!==null)assert.equal(other.walls.length,count);for(const wall of other.walls){assert.equal(wall.getFace(),face);assert.equal(axis==='x'?wall.getLocation().getX()-other.area.getBaseX()+other.layout.origin[0]:wall.getLocation().getY()-other.area.getBaseY()+other.layout.origin[1],coordinate);}old.push({other,team});}
  const[a,b]=players.slice(20),game=await negotiate(a,b,null,1,null,8);await join(a);await join(b);assert.equal(new Set([...old.map(x=>x.other.area),game.area]).size,11);
  const foreign=mappedLayoutObjects(old.find(x=>x.other.rules.arena===0).other,'clanwars_exitportal_darkrock_n')[0];assert.ok(foreign);assert.equal(Match.forfeit({player:a,object:foreign}),false);
  for(const player of[a,b]){const side=game.members.get(player),xy=side?[3449,4921]:[3397,4869],approach=side?[3449,4920]:[3399,4871],object=northleachObject(game,'clanwars_exitportal_darkrock_n',xy);assert.equal(object.getId(),26728);assert.equal(object.getType(),10);assert.equal(object.getFace(),side?2:0);assert.deepEqual([object.getDefinition().sizeX,object.getDefinition().sizeY,object.getDefinition().getBlockingMask()],[4,2,30]);const fake=new core.GameObject(object.getId(),object.getLocation().clone(),10,object.getFace(),game.area);try{assert.equal(Match.forfeit({player,object:fake}),false);}finally{game.area.detach(fake);}await northleachWalk(player,game,approach);await layoutObjectInput(player,game,'clanwars_exitportal_darkrock_n',xy,'Forfeit');assert.equal(C.matches.has(player),false);lobby(player);}
  assert.equal(game.members.size,0);tick(game.starts-C.now());assert.equal(game.area.isDestroyed(),true);for(const{other,team}of old){assert.notEqual(other.phase,'over');assert.equal(other.area.isDestroyed(),false);for(const p of team)assert.equal(C.matches.get(p),other);}
});

test('native Northleach Ignore5 uses actual six versus six safe defeat',async()=>{const{b,teams,players,game}=await stragglerGame(6,1,3,{},8);completePreparation(game);assert.equal(game.fighters.size,12);await lethalMelee(b,teams[0][1],game,true,[[3406,4880,0],[3407,4880,0]]);tick(6);assert.equal(game.phase,'over');for(const p of players)lobby(p);assert.equal(game.area.isDestroyed(),true);});

for(const pair of[[[3406,4880],[3407,4880]],[[3445,4915],[3446,4915]]])test(`native Northleach ordinary traversal from both assigned landings starts melee at ${pair[0]}`,async()=>{const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,8);await join(a);await join(b);completePreparation(game);for(const p of[a,b])ruleStats(p,99);await northleachWalk(a,game,pair[0]);await northleachWalk(b,game,pair[1]);assert.equal(CombatFactory.canAttackByPolicy(a,b,CombatFactory.MELEE_COMBAT),CanAttackResponse.CAN_ATTACK);const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(b.getIndex(),2);await wire(a,frame);assert.equal(a.getCombat().getTarget(),b);console.log('NORTHLEACH_ORDINARY_MELEE '+JSON.stringify({source:pair,positions:[position(a),position(b)],nativeTarget:true}));});

test('native Northleach boat debris and torch preserve full rotated walking versus projectile distinctions',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,8);await join(a);await join(b);completePreparation(game);
  for(const s of[{name:'slug2_rowboat_broken_onland',xy:[3443,4921],type:10,face:0,size:[2,3],from:[3443,4920],to:[3443,4924],projectile:true},{name:'godwars_debris_ladder',xy:[3405,4886],type:10,face:3,size:[1,2],from:[3405,4885],to:[3405,4888],projectile:true},{name:'zogre_standing_torch',xy:[3404,4914],type:10,face:0,size:[1,1],from:[3404,4913],to:[3404,4915],projectile:false}]){const object=northleachObject(game,s.name,s.xy),d=object.getDefinition(),at=object.getLocation(),from=game.area.at([...s.from,0]),to=game.area.at([...s.to,0]);assert.equal(object.getType(),s.type);assert.equal(object.getFace(),s.face);assert.equal(d.isSolid(),true);assert.equal(core.CacheDefinitions.getObject(object.getId()).blocksProjectile,s.projectile);assert.equal((d.getInteractions()??[]).some(Boolean),false);for(let x=0;x<s.size[0];x++)for(let y=0;y<s.size[1];y++)assert.equal(game.area.getClip(game.area.at([s.xy[0]+x,s.xy[1]+y,0]))&0x20100,s.projectile?0x20100:0x100);await northleachWalk(a,game,s.from);await wire(a,walkClickFrame(at));for(let n=0;n<8;n++){tick();assert.equal(core.RegionManager.blocked(a.getLocation(),game.area),false);const p=northleachSourcePosition(a,game);assert.equal(p[0]>=s.xy[0]&&p[0]<s.xy[0]+s.size[0]&&p[1]>=s.xy[1]&&p[1]<s.xy[1]+s.size[1],false);}assert.equal(core.RegionManager.canMovestart(from,at,1,1,game.area),false);assert.equal(core.RegionManager.canProjectileAttackReturn(from,to,1,game.area),!s.projectile);await northleachWalk(a,game,s.to);console.log('NORTHLEACH_OBSTACLE '+JSON.stringify({id:object.getId(),source:s.xy,ray:!s.projectile,arrival:position(a),limit:'post-wire checks; wire already processes3ticks, no literal per-step trace'}));}
  const open=game.area.at([3406,4880,0]),next=game.area.at([3407,4880,0]);assert.equal(core.RegionManager.canMovestart(open,next,1,1,game.area),true);assert.equal(core.RegionManager.canProjectileAttackReturn(open,next,1,game.area),true);
});

const NORTHLEACH_TREES=[{xy:[3411,4890],type:11,face:0,approach:[3410,4890]},{xy:[3412,4889],type:11,face:2,approach:[3411,4889]},{xy:[3448,4886],type:10,face:0,approach:[3447,4886]},{xy:[3449,4885],type:10,face:3,approach:[3448,4885]}];
for(const spec of NORTHLEACH_TREES)test(`native Northleach snow tree ${spec.xy} ordinary route yields logs25baseXP snowy23054 and live respawn`,async t=>{
  resourceRandom(t);const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,8);await join(a);await join(b);completePreparation(game);const p=[a,b].find(p=>game.members.get(p)===(spec.type===11?0:1)),tree=northleachObject(game,'deadtree2_snowy',spec.xy);assert.equal(tree.getId(),1291);assert.equal(tree.getType(),spec.type);assert.equal(tree.getFace(),spec.face);assert.equal(tree.getPrivateArea(),game.area);assert.equal(game.area.getObjects().includes(tree),false);assert.deepEqual([tree.getDefinition().sizeX,tree.getDefinition().sizeY],[1,1]);assert.ok(tree.getDefinition().getInteractions().includes('Chop down'));
  await northleachWalk(p,game,spec.approach);const gate=PM.emitCanGainExperience(p,core.Skill.WOODCUTTING,25);assert.notEqual(gate.allow,false);assert.equal(gate.multiplier,1);assert.notEqual(p.getAttribute(core.SkillManager.XP_LOCKED_ATTRIBUTE),true);assert.ok(p.getSkillManager().getExperience(core.Skill.WOODCUTTING)<core.SkillManager.MAX_EXPERIENCE-25*core.GameConstants.EXPERIENCE_MULTIPLIER);assert.ok(core.GameConstants.EXPERIENCE_MULTIPLIER>0);const masks=northleachMasks(game.area),settings=northleachSettings(),xp=p.getSkillManager().getExperience(core.Skill.WOODCUTTING),task=await chopTree(p,tree);assert.equal(p.getSkillManager().getExperience(core.Skill.WOODCUTTING)-xp,25*core.GameConstants.EXPERIENCE_MULTIPLIER);assert.equal(task.stumpObject.getId(),23054);assert.equal(task.stumpObject.getType(),spec.type);assert.equal(task.stumpObject.getFace(),spec.face);assert.equal(task.stumpObject.getPrivateArea(),game.area);assert.ok(task.getRemainingTicks()>0&&task.getRemainingTicks()<=98);
  const logs=p.getInventory().getAmount(core.ItemIdentifiers.LOGS);northleachNativeObject(p,tree.getId(),tree.getLocation());tick(8);assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.LOGS),logs);assert.equal(treeTask(tree),task);assert.equal(core.MapObjects.get(task.stumpObject.getId(),tree.getLocation(),game.area),task.stumpObject);tick(task.getRemainingTicks()+2);assert.equal(task.isStopped(),true);assert.equal(game.area.resolveObject(tree.getId(),tree.getLocation()),tree);assert.equal(core.MapObjects.getPrivateArea(p,tree.getId(),tree.getLocation()),tree);assert.equal(core.World.getObjects().includes(task.stumpObject),false);assert.deepEqual(northleachMasks(game.area),masks);assert.deepEqual(northleachSettings(),settings);assert.equal(C.matches.get(b),game);console.log('NORTHLEACH_SNOW_TREE '+JSON.stringify({source:spec.xy,type:spec.type,face:spec.face,stump:23054,baseXP:25,logs,respawned:true,ordinaryAssignedLanding:true}));
});

for(const exit of['walk','forfeit','death'])test(`native Northleach active canonical chopping ${exit==='forfeit'?'walk cancellation then Forfeit':'cancellation on '+exit} without late yield`,async t=>{
  t.mock.method(Math,'random',()=>new Error().stack.includes('rollLog')?0.99:0.99);const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,8);await join(a);await join(b);completePreparation(game);const p=[a,b].find(p=>game.members.get(p)===0),killer=p===a?b:a,I=core.ItemIdentifiers,wood=require('../plugins/skills/Woodcutting.plugin');ruleStats(p);p.getSkillManager().setCurrentLevel(core.Skill.WOODCUTTING,99);p.getSkillManager().setMaxLevel(core.Skill.WOODCUTTING,99);give(p,I.BRONZE_AXE,'northleach-cancel');const tree=northleachObject(game,'deadtree2_snowy',[3411,4890]);await northleachWalk(p,game,[3410,4890]);const before=p.getInventory().getAmount(I.LOGS),xp=p.getSkillManager().getExperience(core.Skill.WOODCUTTING);lumbridgeObjectClick(p,tree,'Chop down');tick(3);assert.equal(wood.isWoodcuttingActive(p),true);assert.equal(treeTask(tree),undefined);
  if(exit==='walk')await northleachWalk(p,game,[3410,4889]);else if(exit==='forfeit')await layoutObjectInput(p,game,'clanwars_exitportal_darkrock_n',[3397,4869],'Forfeit');else{await lethalMelee(killer,p,game,true,[[3410,4889,0],[3410,4890,0]],()=>{assert.deepEqual(position(p),positionAt(game,[3410,4890,0]));assert.ok(p.getHitpoints()>0);assert.equal(wood.isWoodcuttingActive(p),true,'canonical chopping remains active beside tree immediately before lethal hit');},true);tick(6);assert.equal(game.jailed.has(p),true);}
  tick(105);assert.equal(wood.isWoodcuttingActive(p),false);assert.equal(p.getInventory().getAmount(I.LOGS),before);assert.equal(p.getSkillManager().getExperience(core.Skill.WOODCUTTING),xp);assert.equal(treeTask(tree),undefined);if(exit==='forfeit'){assert.equal(C.matches.has(p),false);lobby(p);}
});

test('native Northleach actionless Tree ladders and fake foreign tree targets refuse without mutating owned resources',async t=>{
  resourceRandom(t);const a=actor(true),b=actor(true),c=actor(true),d=actor(true);for(const p of[a,b,c,d])channel(p);const game=await negotiate(a,b,null,1,null,8);await join(a);await join(b);completePreparation(game);const other=await negotiate(c,d,null,1,null,8);await join(c);await join(d);completePreparation(other);const I=core.ItemIdentifiers,wood=require('../plugins/skills/Woodcutting.plugin');a.getSkillManager().setCurrentLevel(core.Skill.WOODCUTTING,99);a.getSkillManager().setMaxLevel(core.Skill.WOODCUTTING,99);give(a,I.BRONZE_AXE,'northleach-valid-negatives');const baseline=northleachMasks(game.area),xp=a.getSkillManager().getExperience(core.Skill.WOODCUTTING),logs=a.getInventory().getAmount(I.LOGS);
  for(const[name,xy,approach]of[['wild6_tree_b_snow',[3437,4920],[3437,4919]],['godwars_debris_ladder',[3405,4886],[3405,4885]],['godwars_debris_ladder',[3443,4888],[3443,4887]]]){const object=northleachObject(game,name,xy);assert.equal((object.getDefinition().getInteractions()??[]).some(Boolean),false);await northleachWalk(a,game,approach);northleachNativeObject(a,object.getId(),object.getLocation());tick(6);assert.equal(wood.isWoodcuttingActive(a),false);assert.equal(treeTask(object),undefined);}
  const foreign=northleachObject(other,'deadtree2_snowy',[3411,4890]);northleachNativeObject(a,foreign.getId(),foreign.getLocation());tick(6);const blank=game.area.at([3406,4880,0]);assert.equal(core.MapObjects.getPrivateArea(a,1291,blank),null);northleachNativeObject(a,1291,blank);tick(6);assert.equal(wood.isWoodcuttingActive(a),false);assert.equal(treeTask(foreign),undefined);assert.equal(a.getInventory().getAmount(I.LOGS),logs);assert.equal(a.getSkillManager().getExperience(core.Skill.WOODCUTTING),xp);assert.deepEqual(northleachMasks(game.area),baseline);assert.equal(core.MapObjects.getPrivateArea(c,foreign.getId(),foreign.getLocation()),foreign);
  await northleachWalk(a,game,[3410,4890]);await chopTree(a,northleachObject(game,'deadtree2_snowy',[3411,4890]));
});

test('native Northleach destroyed depleted snow tree cannot resurrect into actual8x8 reused slot with live other world controls',async t=>{
  resourceRandom(t);const a=actor(true),b=actor(true),c=actor(true),d=actor(true),world=actor(true);for(const p of[a,b,c,d])channel(p);const game=await negotiate(a,b,null,1,null,8);await join(a);await join(b);completePreparation(game);const other=await negotiate(c,d,null,1,null,8);await join(c);await join(d);completePreparation(other);const tree=northleachObject(game,'deadtree2_snowy',[3411,4890]),liveTree=northleachObject(other,'deadtree2_snowy',[3411,4890]);await northleachWalk(a,game,[3410,4890]);await northleachWalk(c,other,[3410,4890]);const reference=northleachTemplate(),baseline=northleachMasks(reference),settings=northleachSettings();reference.destroy();assert.deepEqual(northleachMasks(game.area),baseline);assert.deepEqual(northleachMasks(other.area),baseline);
  world.moveTo(new core.Location(3222,3218,0));core.RegionManager.loadMapFiles(3222,3218);const worldAt=new core.Location(3223,3218,0),worldBefore=core.RegionManager.getClipping(worldAt.getX(),worldAt.getY(),0,null),worldTree=new core.GameObject(tree.getId(),worldAt,tree.getType(),tree.getFace(),null);core.ObjectManager.register(worldTree,true);tick();let pending,liveTask,worldTask,replacement;
  try{pending=await chopTree(a,tree);liveTask=await chopTree(c,liveTree);worldTask=await chopTree(world,worldTree);assert.ok([pending,liveTask,worldTask].every(t=>t.isRunning()&&t.getRemainingTicks()>0));assert.ok([pending,liveTask,worldTask].every(t=>t.stumpObject.getId()===23054));const base=[game.area.getBaseX(),game.area.getBaseY()],oldLogs=a.getInventory().getAmount(core.ItemIdentifiers.LOGS);game.finish(null);assert.equal(game.area.isDestroyed(),true);lobby(a);lobby(b);replacement=northleachTemplate();assert.deepEqual([replacement.getBaseX(),replacement.getBaseY()],base,'actual freed8x8 match slot reused');const fresh=northleachObject({area:replacement},'deadtree2_snowy',[3411,4890]);assert.notEqual(fresh,tree);tick(105);assert.equal(pending.isStopped(),true);for(const object of[tree,pending.stumpObject]){assert.equal(core.World.getObjects().includes(object),false);assert.equal(core.World.getRemovedObjects().includes(object),false);assert.equal(core.ObjectManager.objectsAt(object.getLocation()).includes(object),false);assert.equal(game.area.getObjects().includes(object),false);}assert.equal(core.MapObjects.get(tree.getId(),tree.getLocation(),game.area),null);assert.equal(a.getInventory().getAmount(core.ItemIdentifiers.LOGS),oldLogs);assert.deepEqual(northleachMasks(replacement),baseline);assert.equal(replacement.resolveObject(fresh.getId(),fresh.getLocation()),fresh);assert.equal(fresh.getPrivateArea(),replacement);assert.equal(other.area.resolveObject(liveTree.getId(),liveTree.getLocation()),liveTree);assert.ok(liveTask.isStopped()&&worldTask.isStopped());assert.equal(core.MapObjects.get(worldTree.getId(),worldAt,null),worldTree);assert.deepEqual(northleachMasks(other.area),baseline);assert.deepEqual(northleachSettings(),settings);assert.equal(C.matches.get(c),other);assert.equal(C.matches.get(d),other);}
  finally{for(const task of[pending,liveTask,worldTask].filter(Boolean)){task.stop();if(core.World.getObjects().includes(task.stumpObject))core.ObjectManager.deregister(task.stumpObject,true);}if(core.World.getObjects().includes(worldTree))core.ObjectManager.deregister(worldTree,true);replacement?.destroy();assert.equal(core.RegionManager.getClipping(worldAt.getX(),worldAt.getY(),0,null),worldBefore);}
});

test('native Northleach food drink prayer special vetoes preserve actual supplies and safe-death metadata',async()=>{
  const a=actor(true),b=actor(true);ruleStats(a);ruleStats(b);channel(a);channel(b);const game=await negotiate(a,b,null,1,{food:1,drinks:1,prayer:2,specialattacks:2},8);await join(a);await join(b);completePreparation(game);
  const I=core.ItemIdentifiers;give(a,I.SHRIMPS,'northleach-food');give(a,I.ATTACK_POTION_4_,'northleach-potion');let before=resources(a);await nativeItem(a,I.SHRIMPS,'Eat');assert.deepEqual(resources(a),before);await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.deepEqual(resources(a),before);
  await nativeButton(a,prayerWidget(core.PrayerHandler.THICK_SKIN));assert.equal(a.getPrayerActive().some(Boolean),false);assert.deepEqual(resources(a),before);await wield(a,I.DRAGON_DAGGER,'northleach-special');before=resources(a);await nativeButton(a,'orbs:specbutton');assert.equal(a.isSpecialActivated(),false);assert.deepEqual(resources(a),before);
  const carried=carriedItems(a);await lethalMelee(b,a,game,true,[[3406,4880,0],[3407,4880,0]]);tick(6);assert.equal(game.jailed.has(a),true);assert.deepEqual(carriedItems(a),carried);assert.deepEqual(a.getEquipment().get(core.Equipment.WEAPON_SLOT).getMeta(),{qa:'northleach-special'});
  game.finish(null);tick(2);a.setHitpoints(50);await nativeItem(a,I.SHRIMPS,'Eat');assert.equal(a.getInventory().contains(I.SHRIMPS),false,'same actual food is usable after match cleanup');await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.equal(a.getInventory().contains(I.ATTACK_POTION_3_),true);assert.deepEqual(a.getInventory().getValidItems().find(item=>item.getId()===I.ATTACK_POTION_3_).getMeta(),{qa:'northleach-potion'});
});

// Q: Ghastly Swamp reuses the bounded swamp source, with distinct shared hazards.

// Retain exact reference assertions without handing cyclic world/cache graphs to Node's failure inspector.
function ghastScalar(entity){if(entity==null)return String(entity);const at=entity.getLocation?.(),area=entity.getArea?.();return{kind:entity.isNpc?.()?'npc':entity.isPlayer?.()?'player':typeof entity,id:entity.getId?.()??null,index:entity.getIndex?.()??null,position:at?[at.getX(),at.getY(),at.getZ()]:null,areaBase:area?.getBaseX?[area.getBaseX(),area.getBaseY()]:null};}
function ghastIdentity(actual,expected,label){assert.ok(actual===expected,`${label}; actual=${JSON.stringify(ghastScalar(actual))}; expected=${JSON.stringify(ghastScalar(expected))}`);}
function ghastSameRefs(actual,expected,label){assert.equal(actual.length,expected.length,`${label} length`);for(let n=0;n<expected.length;n++)ghastIdentity(actual[n],expected[n],`${label}[${n}]`);}
function ghastAbsent(npc,area,label){assert.equal(Boolean(npc.isRegistered()),false,`${label} unregistered`);assert.equal(core.World.getNpcs().get(npc.getIndex())===npc,false,`${label} World slot`);assert.equal(core.World.getAddNPCQueue().includes(npc),false,`${label} add queue`);assert.equal(core.World.getRemoveNPCQueue().includes(npc),false,`${label} remove queue`);ghastIdentity(npc.getArea(),null,`${label} area`);assert.equal(area.getNpcs().includes(npc),false,`${label} area index`);assert.equal(area.entities.includes(npc),false,`${label} attached entities`);}
function ghastNativeCheckpoint(side,step,p,npc){console.log('GHASTLY_NATIVE_CHECKPOINT '+JSON.stringify({side,step,cycle:C.now(),player:ghastScalar(p),npc:ghastScalar(npc),playerTarget:ghastScalar(p.getCombat().getTarget()),npcTarget:ghastScalar(npc.getCombat().getTarget()),hp:[p.getHitpoints(),npc.getHitpoints()]}));}

test('native Ghastly Swamp queued movement, full clip restoration and tree-root walk/LOS obstruction',async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,0,null,7);
  await join(a);await join(b);for(const p of [a,b]) assert.deepEqual(position(p),positionAt(game,SWAMP_LANDINGS[game.members.get(p)]));
  const reference=new core.TemplatedInstanceArea(8,8);
  try {
    for(let plane=0;plane<2;plane++) for(let x=0;x<8;x++) for(let y=0;y<8;y++) {
      reference.setChunk(plane,x,y,{sourceChunkX:424+x,sourceChunkY:616+y,sourcePlane:plane,rotation:0});
      assert.deepEqual(game.area.getChunk(plane,x,y),reference.getChunk(plane,x,y));
    }
    const baseline=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) baseline.push(reference.getClip(reference.tile(x,y,0)));
    const wallId=core.CacheDefinitions.getLocId('clanwars_barrier_swamp'),def=core.CacheDefinitions.getObject(wallId);
    assert.deepEqual([def.sizeX,def.sizeY],[1,1]);assert.equal(game.walls.length,57);
    const walls=game.walls.slice(),{MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
    for(const wall of walls) {
      assert.equal(wall.getId(),wallId);ghastIdentity(wall.getPrivateArea(),game.area,'wall.getPrivateArea() identity');assert.equal(wall.getType(),10);assert.equal(wall.getFace(),0);
      assert.notEqual(game.area.getClip(wall.getLocation())&0x100,0);
      ghastIdentity(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),wall,'MapObjects.getPrivateArea(a,wallId,wall.getLocation()) identity');
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getPrivateArea()===game.area&&o.getId()===wallId).length,1);
    }
    for(const [lo,hi] of [[3395,3452]]) for(let x=lo;x<=hi;x++) {
      const old=reference.getClip(reference.tile(x-3392,4959-4928,0));
      const count=walls.filter(o=>o.getLocation().equals(game.area.at([x,4959,0]))).length;
      assert.equal(count,old&core.RegionManager.BLOCKED_MASK?0:1,'solid mapped tree needs no overlay');
    }
    assert.equal(swampReachable(game,SWAMP_LANDINGS[0],SWAMP_LANDINGS[1]),false,'cardinal+diagonal routes including both wall ends stay separated');
    for(const side of [0,1]) assert.equal(swampReachable(game,SWAMP_JAILS[side],SWAMP_LANDINGS[side]),false);
    assert.equal(core.RegionManager.canMovestart(game.area.at([3392,4934,0]),game.area.at([3391,4934,0]),1,1,game.area),false);
    const walker=[a,b].find(p=>game.members.get(p)===0),open=game.area.at([3410,4934,0]),across=game.area.at(SWAMP_LANDINGS[1]);
    await wire(walker,walkClickFrame(open));assert.deepEqual(position(walker),[open.getX(),open.getY(),0]);
    await wire(walker,walkClickFrame(across));tick(60);assert.equal(game.phase,'staging');
    assert.ok(walker.getLocation().getY()<game.area.at([3424,4959,0]).getY(),'ordinary movement cannot reach north during preparation');
    const staging={position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()};
    completePreparation(game);assert.equal(game.phase,'combat');assert.equal(game.walls.length,0);
    for(const wall of walls) {
      ghastIdentity(MapObjects.getPrivateArea(a,wallId,wall.getLocation()),null,'MapObjects.getPrivateArea(a,wallId,wall.getLocation()) identity');
      assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);
    }
    const after=[];for(let y=0;y<64;y++) for(let x=0;x<64;x++) after.push(game.area.getClip(game.area.tile(x,y,0)));
    assert.deepEqual(after,baseline,'all4096 masks preserve static trees, roots and directional/projectile edges');
    assert.equal(after[(4959-4928)*64+3397-3392],0x20100,'the skipped solid tree keeps both walking and projectile bits');
    assert.equal(swampReachable(game,SWAMP_LANDINGS[0],SWAMP_LANDINGS[1]),true);
    await wire(walker,walkClickFrame(across));tick(200);assert.deepEqual(position(walker),[across.getX(),across.getY(),0]);
    console.log('GHASTLY_MOVEMENT_QUALIFICATION '+JSON.stringify({staging,combat:{position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}}));
    for(const specimen of [
      {gameval:'deadtree4swamp',xy:[3398,4946],left:[3397,4946],right:[3399,4946],size:1,face:1},
      {gameval:'swamp_root',xy:[3398,4977],left:[3397,4978],right:[3401,4978],size:3,face:2},
    ]) {
      const obstacle=game.area.at([...specimen.xy,0]),left=game.area.at([...specimen.left,0]),right=game.area.at([...specimen.right,0]);
      const object=mappedLayoutObjects(game,specimen.gameval).find(o=>o.getLocation().equals(obstacle));assert.ok(object);
      const definition=core.CacheDefinitions.getObject(object.getId());
      assert.deepEqual([definition.sizeX,definition.sizeY,definition.blocksProjectile],[specimen.size,specimen.size,true]);
      assert.equal(object.getType(),10);assert.equal(object.getFace(),specimen.face);ghastIdentity(object.getPrivateArea(),game.area,'object.getPrivateArea() identity');
      assert.equal(game.area.getClip(obstacle)&0x20100,0x20100);assert.equal(game.area.getClip(left),0);assert.equal(game.area.getClip(right),0);
      assert.equal(swampReachable(game,SWAMP_LANDINGS[1],specimen.left),true);
      await wire(walker,walkClickFrame(left));tick(240);assert.deepEqual(position(walker),[left.getX(),left.getY(),0],'ordinary queued walk reaches open obstacle approach');
      await wire(walker,walkClickFrame(obstacle));
      for(let cycle=0;cycle<10;cycle++) {
        tick();assert.equal(core.RegionManager.blocked(walker.getLocation(),game.area),false,'processed ordinary movement never enters a solid obstacle');
      }
      const at=walker.getLocation();assert.ok(!(at.getX()>=obstacle.getX()&&at.getX()<obstacle.getX()+specimen.size&&at.getY()>=obstacle.getY()&&at.getY()<obstacle.getY()+specimen.size),'blocked click remains outside the full object footprint');
      console.log('GHASTLY_OBSTACLE_MOVEMENT_QUALIFICATION '+JSON.stringify({gameval:specimen.gameval,requested:[obstacle.getX(),obstacle.getY(),0],position:position(walker),pathX:walker.getMovementQueue().pathX,pathY:walker.getMovementQueue().pathY,hasRoute:walker.getMovementQueue().hasRoute()}));
      const edge=game.area.at([specimen.xy[0],specimen.left[1],0]);
      assert.equal(core.RegionManager.canMovestart(left,edge,1,1,game.area),false,'selected obstacle blocks the adjacent native step');
      assert.equal(core.RegionManager.canProjectileAttackReturn(left,right,1,game.area),false,'native ray across selected tree or roots is blocked');
    }
    const o1=game.area.at([3409,4934,0]),o2=game.area.at([3410,4934,0]);
    assert.equal(core.RegionManager.canMovestart(o1,o2,1,1,game.area),true);assert.equal(core.RegionManager.canProjectileAttackReturn(o1,o2,1,game.area),true,'open ray positive control');
  } finally {reference.destroy();assert.equal(reference.isDestroyed(),true);}
});

for(const mode of [0,1,16]) test(`native Ghastly Swamp mode ${mode} retains restrictions and lifetime`,async()=>{
  const a=actor(),b=actor(),late=actor();channel(a,[late]);channel(b);
  const game=await negotiate(a,b,null,mode,{food:1,prayer:2},7);await join(a);await join(b);
  assert.equal(game.rules.wincondition,mode);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);
  a.moveTo(game.area.at([3409,4934,0]));b.moveTo(game.area.at([3410,4934,0]));tick(2);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode) {await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,SWAMP_LANDINGS[game.members.get(late)]));}
  else {Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16) {core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');lobby(a);lobby(b);}
});


test('native Ghastly slot21 resets acceptance and all twelve offers retain explicit0 default1',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);const session=C.negotiations.get(a),bit=core.CacheDefinitions.getVarbitId('clanwars_arena');assert.equal(session.rules.arena,1);
  await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);await click(b,'clanwars_setup:arena',21);assert.equal(session.rules.arena,7,'ordinary native21 reaches authoritative Ghastly offer');assert.equal(session.accepted.size,0);
  assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(session.rules),/Ghastly Swamp/);
  for(const[slot,arena]of[[0,0],[3,1],[6,2],[9,3],[12,4],[15,5],[18,6],[33,11],[36,12],[39,13],[24,8],[21,7]]){tick(9);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);await click(b,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,arena);assert.equal(session.accepted.size,0);for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(bit),arena);}
  for(const slot of[1,2,22,28,30,42,45,48,65535]){await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,7);for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(bit),7);}
  tick(9);await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(game.rules.arena,7);assert.equal(game.layout.name,'Ghastly Swamp');
});


test('native Ghastly food drink prayer special vetoes preserve actual supplies and safe-death metadata',async()=>{
  const a=actor(true),b=actor(true);ruleStats(a);ruleStats(b);channel(a);channel(b);const game=await negotiate(a,b,null,1,{food:1,drinks:1,prayer:2,specialattacks:2},7);await join(a);await join(b);completePreparation(game);
  const I=core.ItemIdentifiers;give(a,I.SHRIMPS,'ghastly-food');give(a,I.ATTACK_POTION_4_,'ghastly-potion');let before=resources(a);await nativeItem(a,I.SHRIMPS,'Eat');assert.deepEqual(resources(a),before);await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.deepEqual(resources(a),before);
  await nativeButton(a,prayerWidget(core.PrayerHandler.THICK_SKIN));assert.equal(a.getPrayerActive().some(Boolean),false);assert.deepEqual(resources(a),before);await wield(a,I.DRAGON_DAGGER,'ghastly-special');before=resources(a);await nativeButton(a,'orbs:specbutton');assert.equal(a.isSpecialActivated(),false);assert.deepEqual(resources(a),before);
  const carried=carriedItems(a);await lethalMelee(b,a,game,true,[[3409,4934,0],[3410,4934,0]]);tick(6);assert.equal(game.jailed.has(a),true);assert.deepEqual(carriedItems(a),carried);assert.deepEqual(a.getEquipment().get(core.Equipment.WEAPON_SLOT).getMeta(),{qa:'ghastly-special'});
  game.finish(null);tick(2);a.setHitpoints(50);await nativeItem(a,I.SHRIMPS,'Eat');assert.equal(a.getInventory().contains(I.SHRIMPS),false,'same actual food is usable after match cleanup');await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.equal(a.getInventory().contains(I.ATTACK_POTION_3_),true);assert.deepEqual(a.getInventory().getValidItems().find(item=>item.getId()===I.ATTACK_POTION_3_).getMeta(),{qa:'ghastly-potion'});
});

function ghastTemplate(){const area=new core.TemplatedInstanceArea(8,8);for(let p=0;p<2;p++)for(let x=0;x<8;x++)for(let y=0;y<8;y++)area.setChunk(p,x,y,{sourceChunkX:424+x,sourceChunkY:616+y,sourcePlane:p,rotation:0});area.at=tile=>area.tile(tile[0]-3392,tile[1]-4928,tile[2]);return area;}
function ghastPlane(area,p,settings=false){if(!settings){const out=[];for(let y=0;y<64;y++)for(let x=0;x<64;x++)out.push(area.getClip(area.tile(x,y,p)));return out;}const out=new Uint8Array(4*4096);for(let x=0;x<8;x++)for(let y=0;y<8;y++)area.copyChunkSettings(out,p,x,y);return Array.from(out.subarray(p*4096,(p+1)*4096));}
async function ghastWalk(p,game,xy){const at=game.area.at([...xy,0]);assert.ok(Math.abs(at.getX()-p.getLocation().getX())<64&&Math.abs(at.getY()-p.getLocation().getY())<64);await wire(p,walkClickFrame(at));for(let n=0;n<150&&!p.getLocation().equals(at);n++)tick();assert.deepEqual(position(p),[at.getX(),at.getY(),0],'bounded ordinary decoded walk');}
const ghastSource=(p,game)=>[p.getLocation().getX()-game.area.getBaseX()+3392,p.getLocation().getY()-game.area.getBaseY()+4928,0];
async function ghastGame(rules=null,mode=1){const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,mode,rules,7);await join(a);await join(b);return{a,b,game};}
function ghastReady(game){assert.equal(game.phase,'combat');assert.equal(game.ghasts.ready,true);assert.equal(game.ghasts.npcs.length,2);assert.equal(new Set(game.ghasts.npcs).size,2);for(const[n,npc]of game.ghasts.npcs.entries()){assert.equal(npc.isRegistered(),true);ghastIdentity(npc.getArea(),game.area,'npc.getArea() identity');ghastIdentity(npc.getPrivateArea(),game.area,'npc.getPrivateArea() identity');assert.equal(npc.getId(),5626);assert.equal(npc.isOwnerOnly(),false);assert.equal(npc.__skipDefaultRespawn,true);assert.equal(game.area.getNpcs().includes(npc),true);const d=npc.getCurrentDefinition();assert.deepEqual([d.getSize(),d.getCombatLevel(),d.getHitpoints(),d.getAttackSpeed(),d.getMaxHit(),d.isAggressive(),d.getAttackStyle(),d.getAttackAnim(),d.getDefenceAnim(),d.getDeathAnim()],[2,109,135,8,8,true,'crush',1087,1088,1089]);assert.deepEqual(d.getStats().slice(0,5),[110,70,70,30,30]);assert.ok(d.getActions().includes('Attack'));assert.deepEqual([npc.getSpawnPosition().getX(),npc.getSpawnPosition().getY(),0],positionAt(game,n?[3438,4983,0]:[3410,4936,0]));}}

test('native Ghastly full57 barrier fence preserves thirteen type22 identities and both mapped planes before resources',async()=>{
  const{a,b,game}=await ghastGame(),reference=ghastTemplate();
  try{
    const base=[ghastPlane(reference,0),ghastPlane(reference,1)],settings=[ghastPlane(reference,0,true),ghastPlane(reference,1,true)],walls=game.walls.slice(),row=new Set(Array.from({length:58},(_,i)=>3395+i).filter(x=>x!==3397)),id=core.CacheDefinitions.getLocId('clanwars_barrier_swamp'),d=core.CacheDefinitions.getObject(id);
    assert.equal(game.ghasts,undefined);assert.equal(walls.length,57);assert.equal(id,26792);assert.deepEqual([d.sizeX,d.sizeY,d.clipType,d.blocksProjectile],[1,1,1,true]);
    for(let p=0;p<2;p++){assert.deepEqual(ghastPlane(game.area,p,true),settings[p]);for(let x=0;x<8;x++)for(let y=0;y<8;y++)assert.deepEqual(game.area.getChunk(p,x,y),reference.getChunk(p,x,y));}assert.ok(base[1].every(v=>v===0x200000));assert.ok(settings[1].every(v=>v===1));for(const p of[2,3])assert.equal(game.area.getChunk(p,0,0),null);
    const soils=[];for(let x=0;x<8;x++)for(let y=0;y<8;y++)for(const obj of game.area.getChunkObjects(0,x,y)){const xy=ghastSource({getLocation:()=>obj.getLocation()},game);if(obj.getType()===22&&xy[1]===4959&&row.has(xy[0]))soils.push(obj);if(obj.getType()<9||obj.getType()>11||!obj.getDefinition().isSolid())continue;const def=obj.getDefinition(),rot=obj.getFace()%2,w=rot?def.sizeY:def.sizeX,h=rot?def.sizeX:def.sizeY;for(const x0 of row)assert.equal(x0>=xy[0]&&x0<xy[0]+w&&4959>=xy[1]&&4959<xy[1]+h,false,'full rotated nonzero solid footprint fence');}
    assert.equal(soils.length,13);assert.deepEqual(soils.map(o=>[o.getId(),ghastSource({getLocation:()=>o.getLocation()},game)[0],o.getFace()]).sort((a,b)=>a[1]-b[1]),[[2382,3395,0],[2382,3407,0],[2381,3409,2],[2381,3413,3],[2381,3421,2],[2381,3426,2],[2382,3428,2],[2381,3430,3],[2381,3435,0],[2381,3438,1],[2382,3441,1],[2382,3445,1],[2382,3451,3]]);for(const o of soils){assert.equal(o.getDefinition().isClippedDecoration(),false);ghastIdentity(core.MapObjects.getPrivateArea(a,o.getId(),o.getLocation()),o,'core.MapObjects.getPrivateArea(a,o.getId(),o.getLocation()) identity');}
    for(const wall of walls){assert.equal(wall.getType(),10);assert.equal(wall.getFace(),0);assert.equal(wall.getId(),id);ghastIdentity(wall.getPrivateArea(),game.area,'wall.getPrivateArea() identity');ghastIdentity(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),wall,'core.MapObjects.getPrivateArea(a,id,wall.getLocation()) identity');assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getId()===id&&o.getType()===10&&o.getPrivateArea()===game.area).length,1);}
    for(let y=0;y<64;y++)for(let x=0;x<64;x++)assert.equal(game.area.getClip(game.area.tile(x,y,0)),base[0][y*64+x]|(y===31&&row.has(x+3392)?0x20100:0));assert.deepEqual(ghastPlane(game.area,1),base[1]);
    const walker=[a,b].find(p=>game.members.get(p)===0),markers=[];for(const x of[3395,3424,3452]){await ghastWalk(walker,game,[x,4958]);const target=game.area.at([x,4960,0]);assert.ok(C.now()+7<game.starts);await wire(walker,walkClickFrame(target));tick(3);assert.equal(game.phase,'staging');assert.ok(ghastSource(walker,game)[1]<4959);markers.push({x,requested:[target.getX(),target.getY(),0],staging:position(walker)});}
    completePreparation(game);ghastReady(game);assert.deepEqual(ghastPlane(game.area,0),base[0],'all4096 ground masks restored BEFORE any resource changes');for(let p=0;p<2;p++){assert.deepEqual(ghastPlane(game.area,p),base[p]);assert.deepEqual(ghastPlane(game.area,p,true),settings[p]);}
    for(const o of soils){ghastIdentity(core.MapObjects.getPrivateArea(a,o.getId(),o.getLocation()),o,'core.MapObjects.getPrivateArea(a,o.getId(),o.getLocation()) identity');assert.equal(game.area.getChunkObjects(0,(o.getLocation().getX()-game.area.getBaseX())>>3,(o.getLocation().getY()-game.area.getBaseY())>>3).includes(o),true);}
    for(const wall of walls){ghastIdentity(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),null,'core.MapObjects.getPrivateArea(a,id,wall.getLocation()) identity');assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(game.area.getObjects().includes(wall),false);}
    for(const m of markers){await ghastWalk(walker,game,[m.x,4958]);await ghastWalk(walker,game,[m.x,4960]);m.combat=position(walker);assert.deepEqual(m.combat,m.requested);console.log('GHASTLY_CROSSING '+JSON.stringify(m));}
  }finally{reference.destroy();}
});

async function ghastAttack(p,npc){
  // Pinned Reader.shortAddLE reads HIGH, then LOW-128 despite its method name.
  const frame=Buffer.alloc(4);frame[0]=12;frame[1]=(npc.getIndex()>>8)&255;frame[2]=(npc.getIndex()+128)&255;frame[3]=0;
  const decoded=decodeClientPackets(frame);assert.equal(decoded.length,1);assert.equal(decoded[0].type,'npc_option');assert.equal(decoded[0].index,npc.getIndex(),'literal NPC Attack encodes the intended registered slot');assert.equal(decoded[0].clickType,2);
  await wire(p,frame);
}
function ghastFighter(p){ruleStats(p,99);p.getSkillManager().setMaxLevels(core.Skill.DEFENCE,1,false);p.getSkillManager().setCurrentLevel(core.Skill.DEFENCE,1,false);p.setAutoRetaliate(false);}
function ghastFood(p,count=28){p.getInventory().resetItems();for(let slot=0;slot<count;slot++)p.getInventory().setItem(slot,new core.Item(core.ItemIdentifiers.SHRIMPS,1,{qa:'ghast-native',slot}));}
function ghastDirect(npc,p,damage=8,kind=null){const hit=new core.HitDamage(damage,kind==='poison'?core.HitMask.GREEN:core.HitMask.RED).setSource(npc);if(kind==='reflected')hit.markReflected();if(kind==='origin')hit.setOrigin('recoil');p.getCombat().getHitQueue().addPendingDamage([hit]);tick();p.getCombat().getHitQueue().process(C.now());return hit;}
// Explicit supplied provenance/guard controls. These do not establish engine attack timing.
function ghastControlled(npc,p,{zero=false,prepare=null}={}){
  assert.equal(ghastTurns,false);const method=CombatFactory.getMethod(npc);
  ghastRollControl=e=>{if(e.attacker===npc&&e.target===p){e.forceAccurate=true;e.forceMaxHit=true;}};
  let hit;try{[hit]=method.hits(npc,p);}finally{ghastRollControl=null;}
  if(zero)for(const damage of hit.getHits())damage.setDamage(0);
  if(prepare)prepare(hit);
  CombatFactory.addPendingHit(hit);
  for(let n=0;n<4;n++){tick();p.getCombat().getHitQueue().process(C.now());}
  return hit;
}

test('native Ghastly actual200 readiness registers exactly two shared hazards before ordinary engine turns',async()=>{
  const{a,b,game}=await ghastGame();assert.equal(game.ghasts,undefined);assert.equal(core.World.getAddNPCQueue().filter(n=>n.getArea()===game.area).length,0);assert.equal(game.area.getNpcs().length,0);assert.ok(game.walls.length>0);
  for(const p of[a,b])ghastFighter(p);completePreparation(game);ghastReady(game);const pair=game.ghasts.npcs.slice();game.tick();game.tick();ghastSameRefs(game.ghasts.npcs,pair,'ordinary repeated game tick never adds replacement hazards');
  ghastTurns=true;tick();for(const p of[a,b]){const visible=p.getLocalNpcs().filter(n=>pair.includes(n));assert.ok(visible.length>=1,'native local NPC list contains shared nearby hazard');assert.ok(visible.every(n=>!n.isOwnerOnly()));}
  for(const p of[a,b]){const npc=pair[game.members.get(p)];assert.equal(game.area.canAttack(npc,p,CombatFactory.MELEE_COMBAT),true);assert.equal(game.area.canAttack(p,npc,CombatFactory.MELEE_COMBAT),true);assert.equal(game.area.canAttack(p,npc,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(npc,p,{type:()=>core.CombatType.MAGIC}),false);}
  console.log('GHASTLY_READY '+JSON.stringify({cycle:C.now(),ids:pair.map(n=>n.getId()),indices:pair.map(n=>n.getIndex()),shared:pair.map(n=>!n.isOwnerOnly()),registered:pair.map(n=>n.isRegistered())}));
});

for(const side of[0,1])test(`native Ghastly side${side} ordinary size2 approach from assigned landing and real eight-tick food then health attacks`,async()=>{
  const{a,b,game}=await ghastGame();for(const p of[a,b]){ghastFighter(p);ghastFood(p);}completePreparation(game);ghastReady(game);
  const p=[a,b].find(p=>game.members.get(p)===side),npc=game.ghasts.npcs[side],attempts=[],playerAttempts=[],resolved=[],other=game.ghasts.npcs[1-side];
  // Start at the genuine assigned landing. Native walk and the size2 engine own all approach steps.
  assert.deepEqual(position(p),positionAt(game,SWAMP_LANDINGS[side]));
  ghastObserve=(kind,e)=>{if(kind==='prepare'&&e.attacker===p&&e.target===npc)playerAttempts.push(C.now());if(e.attacker!==npc||e.target!==p)return;if(kind==='prepare')attempts.push(C.now());if(kind==='resolved'){const raw=e.hit.getHits().map(h=>h.getDamage()),record={cycle:C.now(),raw,accurate:e.hit.isAccurate(),food:p.getInventory().getAmount(core.ItemIdentifiers.SHRIMPS),hp:p.getHitpoints()};resolved.push(record);for(const hit of e.hit.getHits())hit.onApplied(taken=>{record.taken=taken;record.rotten=p.getInventory().getAmount(core.ItemIdentifiers.ROTTEN_FOOD);});}};
  ghastNativeCheckpoint(side,'before-Attack',p,npc);await ghastAttack(p,npc);ghastNativeCheckpoint(side,'after-Attack-wire',p,npc);ghastIdentity(p.getCombat().getTarget(),npc,'p.getCombat().getTarget() identity');ghastTurns=true;for(let n=0;n<20&&!playerAttempts.length;n++)tick();ghastNativeCheckpoint(side,'after-player-engine-window',p,npc);ghastIdentity(p.getCombat().getTarget(),npc,'p.getCombat().getTarget() identity');assert.ok(playerAttempts.length>0,'real player engine melee reaches actual size2 target from assigned landing');const at=p.getLocation(),loc=npc.getLocation();assert.equal(at.getX()>=loc.getX()&&at.getX()<loc.getX()+2&&at.getY()>=loc.getY()&&at.getY()<loc.getY()+2,false,'ordinary actor remains outside size2 footprint');p.getCombat().reset();
  for(let n=0;n<180&&resolved.filter(r=>r.raw.some(x=>x>0)).length<3;n++)tick();ghastNativeCheckpoint(side,'after-food-engine-window',p,npc);
  ghastIdentity(npc.getCombat().getTarget(),p,'npc.getCombat().getTarget() identity');assert.ok(attempts.length>=3);for(let n=1;n<attempts.length;n++)assert.equal(attempts[n]-attempts[n-1],8,'actual stationary native attack attempts use canonical eight ticks');assert.ok(resolved.some(r=>r.raw.some(x=>x>0)&&r.taken===0&&r.rotten>0),'actual positive native damage consumes food instead of HP');assert.ok(resolved.every(r=>r.raw.every(x=>x>=0&&x<=8)));const foodBefore=contents(p.getInventory());assert.ok(foodBefore.some(i=>i?.id===core.ItemIdentifiers.ROTTEN_FOOD));
  // No-food branch uses the same ordinary NPC turns without forcing accuracy/damage.
  p.getInventory().resetItems();const hp=p.getHitpoints(),start=resolved.length;for(let n=0;n<120&&!resolved.slice(start).some(r=>r.taken>0);n++)tick();assert.ok(p.getHitpoints()<hp);assert.ok(resolved.slice(start).some(r=>r.raw.some(x=>x>0)&&r.taken>0&&r.taken<=8));assert.equal(p.getInventory().getValidItems().length,0);
  // Real decoded player Attack also targets the shared size2 NPC, without supplying a hit.
  await ghastAttack(p,npc);ghastIdentity(p.getCombat().getTarget(),npc,'p.getCombat().getTarget() identity');assert.equal(game.fighters.has(p),true);assert.deepEqual(game.kills,[0,0]);assert.equal(other.isRegistered(),true);
  console.log('GHASTLY_NATIVE_CADENCE '+JSON.stringify({side,attempts,playerAttempts,resolved,position:position(p),npc:position(npc),nativePlayerTarget:true,naturalRolls:true}));
});

test('native Ghastly protection makes ordinary impacts zero without food loss; controlled zero and developer immunity preserve inventory',async()=>{
  const{a,b,game}=await ghastGame();for(const p of[a,b]){ghastFighter(p);ghastFood(p);}completePreparation(game);ghastReady(game);const p=[a,b].find(p=>game.members.get(p)===0),npc=game.ghasts.npcs[0];
  await nativeButton(p,prayerWidget(core.PrayerHandler.PROTECT_FROM_MELEE));assert.equal(p.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MELEE],true);const before=contents(p.getInventory()),hp=p.getHitpoints(),observed=[];
  ghastObserve=(kind,e)=>{if(kind==='resolved'&&e.attacker===npc&&e.target===p)observed.push(e.hit.getHits().map(h=>h.getDamage()));};ghastTurns=true;tick(80);assert.ok(observed.length>=3);assert.ok(observed.every(row=>row.every(n=>n===0)));assert.deepEqual(contents(p.getInventory()),before);assert.equal(p.getHitpoints(),hp);
  ghastTurns=false;ghastObserve=null;for(const n of game.ghasts.npcs)n.getCombat().reset();for(const q of[a,b])q.getCombat().getHitQueue().clear();await nativeButton(p,prayerWidget(core.PrayerHandler.PROTECT_FROM_MELEE));assert.equal(p.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MELEE],false);
  ghastControlled(npc,p,{zero:true});assert.deepEqual(contents(p.getInventory()),before);assert.equal(p.getHitpoints(),hp);
  const rights=p.getRights();try{p.setRights(core.PlayerRights.DEVELOPER);assert.notEqual(p.getAttribute('dev:mortal'),true);ghastControlled(npc,p);assert.deepEqual(contents(p.getInventory()),before);assert.equal(p.getHitpoints(),hp);p.setAttribute('dev:mortal',true);ghastControlled(npc,p);assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.ROTTEN_FOOD),1);assert.equal(p.getHitpoints(),hp);}finally{p.setRights(rights);p.setAttribute('dev:mortal',false);}
});

test('native Ghastly supplied native-provenance inventory matrix conserves exact slots units metadata and NoFood versus carry policy',async()=>{
  const{a,b,game}=await ghastGame({food:1,drinks:1});for(const p of[a,b])ghastFighter(p);completePreparation(game);ghastReady(game);const npc=game.ghasts.npcs[0],I=core.ItemIdentifiers,inv=a.getInventory(),rotten=I.ROTTEN_FOOD;
  const ordinary=I.SHRIMPS,noted=I.SHRIMPS_2,placeholder=core.CacheDefinitions.getItem(ordinary).placeholder;
  assert.ok(core.CacheDefinitions.getItem(noted).noteTemplate>=0);assert.ok(placeholder>0);assert.ok(core.CacheDefinitions.getItem(placeholder).placeholderTemplate>=0);
  const meta={qa:'ghast-inventory',owner:'original',preset:{source:'supplies',nested:[1,{unit:true}]}};
  function put(slot,id,n=1,tag=meta){const item=new core.Item(id,n,tag);inv.setItem(slot,item);return item;}
  function fill(){inv.resetItems();for(let slot=0;slot<28;slot++)put(slot,I.COINS,slot+1,{slot});}
  function impact(){a.setHitpoints(99);const hit=ghastControlled(npc,a);assert.ok(hit.isAccurate());return hit;}
  for(const id of[ordinary,I.HALF_AN_APPLE_PIE,I.BANANA]){
    inv.resetItems();const original=put(3,id),snapshot=structuredClone(original.getMeta()),hit=impact();assert.equal(hit.getHits()[0].getDamage(),0);assert.equal(a.getHitpoints(),99);assert.equal(inv.get(3).getId(),rotten);assert.equal(inv.get(3).getAmount(),1);assert.deepEqual(inv.get(3).getMeta(),snapshot);assert.notEqual(inv.get(3).getMeta(),original.getMeta());assert.notEqual(inv.get(3).getMeta().preset,original.getMeta().preset);assert.equal(inv.getValidItems().length,1,'one current physical food item, no pie leftovers or extra food');
  }
  inv.resetItems();put(0,ordinary,1,{slot:0});put(7,ordinary,1,{slot:7});let before=contents(inv);impact();assert.equal(inv.get(0).getId(),rotten);assert.deepEqual(contents(inv).slice(1),before.slice(1),'ascending first eligible slot only');
  // Unsupported notes/placeholders/raw fish/drinks/container/inedible produce stay carried; later ordinary food supplies the conversion.
  const excluded=[noted,placeholder,I.RAW_SHRIMPS,I.ATTACK_POTION_4_,I.COCONUT,I.BANANAS_1_,rotten];
  for(const id of excluded){const d=core.CacheDefinitions.getItem(id);assert.ok(d.noteTemplate>=0||d.placeholderTemplate>=0||id===rotten||!(d.inventoryActions??[]).some(a=>a?.toLowerCase()==='eat')||(d.inventoryActions??[]).some(a=>a?.toLowerCase()==='drink'));}
  inv.resetItems();excluded.forEach((id,s)=>put(s,id,1,{unsupported:s}));put(20,ordinary);before=contents(inv);impact();assert.deepEqual(contents(inv).slice(0,20),before.slice(0,20));assert.equal(inv.get(20).getId(),rotten);
  inv.resetItems();excluded.forEach((id,s)=>put(s,id,1,{unsupported:s}));before=contents(inv);impact();assert.deepEqual(contents(inv),before);assert.equal(a.getHitpoints(),91,'no eligible food preserves canonical eight damage rather than invented1to3');
  // Exact same-id metadata-distinct stack and lowest free slot, one physical unit only.
  inv.resetItems();put(0,I.COINS);const stack=put(2,ordinary,3,{stack:'first',nested:{n:1}});put(4,ordinary,5,{stack:'second'});before=contents(inv);impact();ghastIdentity(inv.get(2),stack,'inv.get(2) identity');assert.equal(stack.getAmount(),2);assert.equal(inv.get(1).getId(),rotten);assert.deepEqual(inv.get(1).getMeta(),before[2].meta);assert.notEqual(inv.get(1).getMeta(),stack.getMeta());assert.deepEqual(contents(inv)[4],before[4]);assert.deepEqual(contents(inv)[0],before[0]);
  fill();put(0,ordinary,2);inv.setItem(11,new core.Item(-1,0));before=contents(inv);impact();assert.equal(inv.get(0).getAmount(),1);assert.equal(inv.get(11).getId(),rotten);for(let s=1;s<28;s++)if(s!==11)assert.deepEqual(contents(inv)[s],before[s]);
  fill();put(4,ordinary);before=contents(inv);impact();assert.equal(inv.get(4).getId(),rotten);assert.equal(inv.getValidItems().length,28);for(let s=0;s<28;s++)if(s!==4)assert.deepEqual(contents(inv)[s],before[s]);
  fill();put(0,ordinary,3,{stack:'full'});put(5,I.HALF_AN_APPLE_PIE,1,{later:true});before=contents(inv);impact();assert.deepEqual(contents(inv)[0],before[0]);assert.equal(inv.get(5).getId(),rotten);assert.equal(inv.getValidItems().length,28);
  fill();put(0,ordinary,3,{stack:'no-space'});before=contents(inv);impact();assert.deepEqual(contents(inv),before);assert.equal(a.getHitpoints(),91,'full stack consumes zero and cannot protect without conversion');
  // The actual consumption veto and hazard eligibility ask different questions.
  inv.resetItems();put(0,ordinary);put(1,I.ATTACK_POTION_4_,1,{dose:true});before=contents(inv);await nativeItem(a,ordinary,'Eat');await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.deepEqual(contents(inv),before);impact();assert.equal(inv.get(0).getId(),rotten);assert.deepEqual(contents(inv)[1],before[1]);const carried=contents(inv);game.finish(null);tick(2);assert.deepEqual(contents(inv),carried,'safe exit does not restore rotted food');
  console.log('GHASTLY_INVENTORY '+JSON.stringify({ordinary,noted,placeholder,partial:I.HALF_AN_APPLE_PIE,produce:I.BANANA,excluded,rotten,controlledNativeProvenance:true,naturalCadence:false}));
});

test('native Ghastly current source provenance exclusions keep food and canonical damage; world and foreign5626 remain untouched',async()=>{
  const{a,b,game}=await ghastGame();for(const p of[a,b])ghastFighter(p);completePreparation(game);ghastReady(game);const npc=game.ghasts.npcs[0];
  for(const kind of[null,'reflected','origin','poison']){ghastFood(a,1);a.setHitpoints(99);const before=contents(a.getInventory());const hit=ghastDirect(npc,a,8,kind);assert.equal(hit.getDamage(),8);assert.equal(a.getHitpoints(),91);assert.deepEqual(contents(a.getInventory()),before);}
  // A hand-built replacement PendingHit has the same owned NPC/method but no native-returned identity.
  ghastFood(a,1);a.setHitpoints(99);const before=contents(a.getInventory());const fake=new core.PendingHit(npc,a,CombatFactory.getMethod(npc),{damage:8,rollAccuracy:false,handleAfterHitEffects:false});CombatFactory.addPendingHit(fake);for(let n=0;n<4;n++){tick();a.getCombat().getHitQueue().process(C.now());}assert.equal(a.getHitpoints(),91);assert.deepEqual(contents(a.getInventory()),before);
  for(const kind of['reflected','origin','poison']){ghastFood(a,1);a.setHitpoints(99);const before=contents(a.getInventory());ghastControlled(npc,a,{prepare:hit=>{for(const h of hit.getHits()){if(kind==='reflected')h.markReflected();if(kind==='origin')h.setOrigin('recoil');if(kind==='poison')h.setHitmask(core.HitMask.GREEN);}}});assert.equal(a.getHitpoints(),91);assert.deepEqual(contents(a.getInventory()),before);}
  const worldAt=new core.Location(3222,3218,0);core.RegionManager.loadMapFiles(worldAt.getX(),worldAt.getY());const world=C.api.spawnNpc({id:5626,x:worldAt.getX(),y:worldAt.getY(),z:0,wanderRadius:0});fixtureNpcs.add(world);assert.ok(world.isRegistered());assert.equal(world.__skipDefaultRespawn===true,false);ghastIdentity(world.getArea(),null,'world.getArea() identity');assert.equal(CombatFactory.getMethod(world).attackSpeed(world),8);
  ghastFood(a,1);a.setHitpoints(99);const inventory=contents(a.getInventory());ghastDirect(world,a);assert.equal(a.getHitpoints(),91);assert.deepEqual(contents(a.getInventory()),inventory,'unowned world outgoing impact not globally converted or suppressed');
  const other=await ghastGame();completePreparation(other.game);ghastReady(other.game);const foreign=other.game.ghasts.npcs[0];assert.equal(game.area.canAttack(foreign,a,CombatFactory.MELEE_COMBAT),false);ghastFood(a,1);a.setHitpoints(99);const held=contents(a.getInventory());ghastDirect(foreign,a);assert.equal(a.getHitpoints(),99);assert.deepEqual(contents(a.getInventory()),held,'known-owned foreign target is stale to its original game');assert.equal(other.game.area.canAttack(foreign,other.a,CombatFactory.MELEE_COMBAT),true);
});

function ghastFlood(game,from){const queue=[from.slice(0,2)],seen=new Set([from.slice(0,2).join(',')]);for(let i=0;i<queue.length;i++){const[x,y]=queue[i];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy,key=`${nx},${ny}`;if(nx<3392||nx>3455||ny<4928||ny>4991||seen.has(key))continue;if(core.RegionManager.canMovestart(game.area.at([x,y,0]),game.area.at([nx,ny,0]),1,1,game.area)){seen.add(key);queue.push([nx,ny]);}}}return seen;}
for(const side of[0,1])test(`native Ghastly side${side} real ghast kill owns safe death nineteen-cell holding model9753 and delayed Exit without opponent score`,async()=>{
  const other=await ghastGame();const{a,b,game}=await ghastGame({rejoiningdelay:side});for(const p of[a,b]){ghastFighter(p);ghastFood(p);}completePreparation(game);ghastReady(game);const victim=[a,b].find(p=>game.members.get(p)===side),npc=game.ghasts.npcs[side];victim.getInventory().resetItems();give(victim,core.ItemIdentifiers.COINS,'ghast-safe-death');const inventory=contents(victim.getInventory());victim.setHitpoints(1);
  ghastTurns=true;for(let n=0;n<160&&!game.jailed.has(victim);n++)tick();assert.equal(game.jailed.has(victim),true,'ordinary native ghast impacts cause genuine player death');ghastIdentity(victim.getCombat().getHitQueue().getLastAppliedHit().getSource(),npc,'victim.getCombat().getHitQueue().getLastAppliedHit().getSource() identity');ghastTurns=false;assert.deepEqual(game.kills,[0,0],'NPC kill gives no invented opposing-team credit');assert.equal(game.fighters.has(victim),false);assert.deepEqual(contents(victim.getInventory()),inventory);assert.deepEqual(position(victim),positionAt(game,SWAMP_JAILS[side]));assert.ok(npc.getCombat().getTarget()!==victim,'npc.getCombat().getTarget() identity');
  const holding=ghastFlood(game,SWAMP_JAILS[side]);assert.equal(holding.size,19);for(const landing of SWAMP_LANDINGS)assert.equal(holding.has(landing.slice(0,2).join(',')),false);assert.equal(holding.has(SWAMP_JAILS[1-side].slice(0,2).join(',')),false);
  for(const destination of[SWAMP_LANDINGS[side],SWAMP_JAILS[1-side]]){await wire(victim,walkClickFrame(game.area.at(destination)));tick(10);assert.equal(holding.has(ghastSource(victim,game).slice(0,2).join(',')),true);}
  for(const key of holding){const[x,y]=key.split(',').map(Number);for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])if(!holding.has(`${x+dx},${y+dy}`))assert.equal(core.RegionManager.canMovestart(game.area.at([x,y,0]),game.area.at([x+dx,y+dy,0]),1,1,game.area),false);}
  const foreign=mappedLayoutObjects(other.game,'clanwars_prisonportal_swamp')[0],foreignOrb=mappedLayoutObjects(other.game,'clanwars_viewing_start_swamp')[0];assert.equal(Match.exit({player:victim,object:foreign}),false);assert.equal(viewingUnit().use({player:victim,object:foreignOrb}),false);const inactive=mappedLayoutObjects(game,'clanwars_viewing_swamp')[0];assert.ok(inactive);assert.equal(viewingUnit().use({player:victim,object:inactive}),false);
  const orbXY=side?[3450,4990]:[3397,4929],scripts=scriptCalls(victim);await layoutObjectInput(victim,game,'clanwars_viewing_start_swamp',orbXY,'Use');const view=viewingUnit().active.get(victim);assert.ok(view);assert.ok(scripts.some(([id,...args])=>id===562&&args[1]===9753));assert.equal(game.area.canAttack(npc,victim,CombatFactory.MELEE_COMBAT),false);const before=contents(victim.getInventory()),hp=victim.getHitpoints();ghastDirect(npc,victim);assert.equal(victim.getHitpoints(),hp);assert.deepEqual(contents(victim.getInventory()),before);
  await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(victim),false);assert.equal(victim.isAppearanceHidden(),false);assert.equal(victim.isUntargetable(),false);assert.equal(victim.getMovementQueue().isMovementBlocked(),false);assert.deepEqual(victim.getPacketSender().getCameraState(),{mode:'follow'});
  const xy=side?[3454,4986]:[3393,4933],owned=lumbridgeObject(game,'clanwars_prisonportal_swamp',xy),fake=new core.GameObject(owned.getId(),owned.getLocation().clone(),owned.getType(),owned.getFace(),game.area);assert.equal(owned.getId(),26740);assert.equal(owned.getFace(),side?2:0);try{assert.equal(Match.exit({player:victim,object:fake}),false);}finally{game.area.detach(fake);}
  const deadline=game.returnAt.get(victim.getLongUsername());if(side){assert.ok(deadline>C.now());await layoutObjectInput(victim,game,'clanwars_prisonportal_swamp',xy,'Exit');assert.equal(game.jailed.has(victim),true);assert.equal(game.returnAt.get(victim.getLongUsername()),deadline);assert.ok(deadline>C.now());tick(deadline-C.now());}await layoutObjectInput(victim,game,'clanwars_prisonportal_swamp',xy,'Exit');assert.equal(game.fighters.has(victim),true);assert.equal(game.jailed.has(victim),false);assert.deepEqual(position(victim),positionAt(game,SWAMP_LANDINGS[side]));assert.deepEqual(contents(victim.getInventory()),inventory);
  console.log('GHASTLY_HOLDING '+JSON.stringify({side,killer:npc.getId(),cells:holding.size,orb:orbXY,model:9753,exit:xy,opponentKills:game.kills}));
});

test('native Ghastly twelfth arena preserves all eleven concurrent layouts and owned full-footprint Forfeits',async()=>{
  const players=Array.from({length:24},()=>actor(true));for(const p of players)channel(p);const old=[];
  for(const[offset,arena,axis,coordinate,face,count]of[[0,1,'y',4959,0,52],[2,2,'y',5023,0,null],[4,3,'y',5087,0,24],[6,6,'y',4959,0,57],[8,5,'x',3167,1,43],[10,11,'y',4735,0,51],[12,12,'y',4826,0,29],[14,13,'x',3496,1,23],[16,0,'y',5055,0,47],[18,4,'y',5055,0,48],[20,8,'y',4895,0,4]]){const team=players.slice(offset,offset+2),other=await negotiate(team[0],team[1],null,1,null,arena);for(const p of team)await join(p);if(count!==null)assert.equal(other.walls.length,count);for(const wall of other.walls){assert.equal(wall.getFace(),face);assert.equal(axis==='x'?wall.getLocation().getX()-other.area.getBaseX()+other.layout.origin[0]:wall.getLocation().getY()-other.area.getBaseY()+other.layout.origin[1],coordinate);}old.push({other,team});}
  const[a,b]=players.slice(22),game=await negotiate(a,b,null,1,null,7);await join(a);await join(b);assert.equal(new Set([...old.map(x=>x.other.area),game.area]).size,12);const foreign=mappedLayoutObjects(old.find(x=>x.other.rules.arena===6).other,'clanwars_exitportal_swamp_s')[0];assert.equal(Match.forfeit({player:a,object:foreign}),false);
  for(const p of[a,b]){const side=game.members.get(p),xy=side?[3437,4987]:[3407,4931],name=side?'clanwars_exitportal_swamp_n':'clanwars_exitportal_swamp_s',object=lumbridgeObject(game,name,xy);assert.equal(object.getId(),side?26736:26735);assert.equal(object.getFace(),side?2:0);assert.deepEqual([object.getDefinition().sizeX,object.getDefinition().sizeY,object.getDefinition().getBlockingMask()],[4,2,30]);const fake=new core.GameObject(object.getId(),object.getLocation().clone(),object.getType(),object.getFace(),game.area);try{assert.equal(Match.forfeit({player:p,object:fake}),false);}finally{game.area.detach(fake);}await ghastWalk(p,game,side?[3439,4986]:[3409,4933]);await layoutObjectInput(p,game,name,xy,'Forfeit');assert.equal(C.matches.has(p),false);lobby(p);}
  assert.equal(game.members.size,0);assert.equal(game.phase,'staging');const remaining=game.starts-C.now();assert.ok(remaining>0);assert.equal(game.ghasts===undefined,true,'no hazards before the canonical start');
  tick(remaining-1);assert.equal(C.now(),game.starts-1);assert.equal(game.phase,'staging');assert.equal(game.ghasts===undefined,true,'last actual staging tick has no hazard history');assert.equal(game.area.getNpcs().length,0);assert.equal(core.World.getAddNPCQueue().some(n=>n.getArea()===game.area),false);
  tick();assert.equal(C.now(),game.starts);assert.equal(game.phase,'over');assert.equal(game.area.isDestroyed(),true);assert.equal(game.ghasts.ready,false);assert.equal(game.ghasts.npcs.length,2);for(const npc of game.ghasts.npcs){assert.equal(npc.getId(),5626);ghastAbsent(npc,game.area,'empty start cleanup');}
  // Match.tick prepares at the actual200 boundary before the empty-roster finish.
  // Retained stopped state/tombstones are valid history; live or queued hazards are not.
  tick(120);for(const npc of game.ghasts.npcs)ghastAbsent(npc,game.area,'empty start delayed cleanup');for(const{other,team}of old){assert.notEqual(other.phase,'over');assert.equal(other.area.isDestroyed(),false);for(const p of team)assert.equal(C.matches.get(p)===other,true,'old-layout membership survives Q cancellation');}
  console.log('GHASTLY_EMPTY_START_CLEANUP '+JSON.stringify({starts:game.starts,settled:C.now(),initial:game.ghasts.npcs.length,ready:game.ghasts.ready,registered:game.ghasts.npcs.map(n=>Boolean(n.isRegistered()))}));
});

test('native Ghastly Ignore5 six versus six actual ghast defeat removes a fighter without scoring a team kill',async()=>{
  const{teams,players,game}=await stragglerGame(6,1,3,{},7);completePreparation(game);ghastReady(game);assert.equal(game.fighters.size,12);const victim=teams[0][1],npc=game.ghasts.npcs[game.members.get(victim)];
  // Disclosed lethal guard hit; actual native size2 timing is tested separately.
  victim.getInventory().resetItems();victim.setHitpoints(1);victim.setNeedsPlacement(false);const hit=new core.PendingHit(npc,victim,CombatFactory.getMethod(npc),{damage:8,rollAccuracy:false,handleAfterHitEffects:false});CombatFactory.addPendingHit(hit);core.World.processCycle++;require('../dist/game/content/combat/hit/HitQueue').HitQueue.processAll(C.now());assert.equal(victim.getHitpoints(),0);tick(8);assert.equal(game.phase,'over');assert.deepEqual(game.kills,[0,0]);for(const p of players)lobby(p);assert.equal(game.area.isDestroyed(),true);for(const n of game.ghasts.npcs)assert.equal(n.isRegistered(),false);
});

async function ghastKill(killer,npc){
  // A real decoded Attack establishes the NPC target; fixed damage only accelerates the death fixture.
  const game=npc.getPrivateArea()?.game;if(game){const at=npc.getLocation();await ghastWalk(killer,game,[at.getX()-game.area.getBaseX()+3392,at.getY()-game.area.getBaseY()+4928-1]);}
  await ghastAttack(killer,npc);ghastIdentity(killer.getCombat().getTarget(),npc,'killer.getCombat().getTarget() identity');
  const hit=new core.PendingHit(killer,npc,CombatFactory.MELEE_COMBAT,{damage:npc.getHitpoints(),rollAccuracy:false,handleAfterHitEffects:false,experience:false});CombatFactory.addPendingHit(hit);
  for(let n=0;n<4&&npc.getHitpoints()>0;n++){tick();npc.getCombat().getHitQueue().process(C.now());}
  assert.equal(npc.getHitpoints(),0);const settle=npc.getCurrentDefinition().getDeathTicks()+5;assert.ok(settle>0&&settle<100);tick(settle);assert.equal(npc.isRegistered(),false,'genuine NPC death/removal queue completes');
}

test('native Ghastly genuine NPC death claims drops before Prayer consumers and never respawns; world5626 loot and quest-visible identity still work',async()=>{
  const{a,b,game}=await ghastGame();for(const p of[a,b])ghastFighter(p);completePreparation(game);ghastReady(game);const npc=game.ghasts.npcs[0],survivor=game.ghasts.npcs[1],I=core.ItemIdentifiers,prayer=a.getSkillManager();
  prayer.setExperience(core.Skill.PRAYER,0);a.setAttribute(core.SkillManager.XP_LOCKED_ATTRIBUTE,false);const gate=PM.emitCanGainExperience(a,core.Skill.PRAYER,4.5);assert.notEqual(gate.allow,false);assert.equal(gate.multiplier,1);assert.ok(core.GameConstants.EXPERIENCE_MULTIPLIER>0);assert.ok(prayer.getExperience(core.Skill.PRAYER)<core.SkillManager.MAX_EXPERIENCE-1000);give(a,I.BONECRUSHER,'ghast-bonecrusher');a.setAttribute('bonecrusher:charges',100);a.setAttribute('quest.nature_spirit.stage',90);
  const before=contents(a.getInventory()),xp=prayer.getExperience(core.Skill.PRAYER),ground=core.World.getItems().slice(),events=[];ghastObserve=(kind,e)=>{if(e.npc===npc)events.push({kind,handled:e.handled,killer:e.killer});};
  await ghastKill(a,npc);assert.ok(events.some(e=>e.kind==='death'&&e.killer===a));assert.ok(events.some(e=>e.kind==='claim'&&e.handled===true));assert.equal(events.some(e=>e.kind==='generated'),false);assert.equal(prayer.getExperience(core.Skill.PRAYER),xp);assert.equal(a.getAttribute('bonecrusher:charges'),100);assert.equal(a.getAttribute('quest.nature_spirit.stage'),90);assert.deepEqual(contents(a.getInventory()),before);ghastSameRefs(core.World.getItems(),ground,'core.World.getItems() identity');assert.equal(game.fighters.has(a),true);assert.equal(game.fighters.has(b),true);assert.deepEqual(game.kills,[0,0]);assert.equal(survivor.isRegistered(),true);assert.equal(game.ghasts.npcs.length,2);
  const respawn=npc.getDefinition().getRespawn(),death=npc.getDefinition().getDeathTicks(),settle=Math.max(105,respawn+death+10);assert.ok(settle<=1000);tick(settle);assert.equal(npc.isRegistered(),false);assert.equal(core.World.getAddNPCQueue().some(n=>n.getArea()===game.area),false);assert.equal(game.area.getNpcs().length,1);assert.equal(game.area.getNpcs()[0],survivor);
  // Real world5626 death gets its canonical always-bones drop; the charged bonecrusher proves Prayer is capable.
  const worldPlayer=actor(true);ghastFighter(worldPlayer);worldPlayer.setAttribute(core.SkillManager.XP_LOCKED_ATTRIBUTE,false);worldPlayer.getSkillManager().setExperience(core.Skill.PRAYER,0);give(worldPlayer,I.BONECRUSHER,'world-bonecrusher');worldPlayer.setAttribute('bonecrusher:charges',100);core.RegionManager.loadMapFiles(3222,3218);worldPlayer.moveTo(new core.Location(3222,3218,0));tick(2);
  const world=C.api.spawnNpc({id:5626,x:3223,y:3218,z:0,wanderRadius:0});fixtureNpcs.add(world);const worldEvents=[];ghastObserve=(kind,e)=>{if(e.npc===world)worldEvents.push({kind,handled:e.handled});};await ghastKill(worldPlayer,world);assert.ok(worldEvents.some(e=>e.kind==='claim'&&e.handled===false));assert.ok(worldEvents.some(e=>e.kind==='generated'));assert.equal(worldPlayer.getAttribute('bonecrusher:charges'),99);assert.ok(worldPlayer.getSkillManager().getExperience(core.Skill.PRAYER)>0,'actual world bones reach actual Prayer consumer');
  // Remove the later ordinary world respawn after observing it, without changing the shared definition.
  tick(settle);const worldClones=[...core.World.getNpcs()].filter(n=>n?.getId()===5626&&n!==survivor&&n.getPrivateArea()==null&&n.getSpawnPosition().equals(world.getSpawnPosition()));assert.equal(worldClones.length,1,'world5626 default respawn remains canonical');for(const n of worldClones){fixtureNpcs.add(n);C.api.removeNpc(n);}
  // Supplied quest checkpoint and canonical pouch producer, no fake visibleGhasts map.
  worldPlayer.setAttribute('quest.nature_spirit.stage',90);const source=C.api.spawnNpc({id:945,x:3223,y:3218,z:0,wanderRadius:0});fixtureNpcs.add(source);const pouch=new core.Item(I.DRUID_POUCH_2,1);worldPlayer.getInventory().setItem(5,pouch);const existing=new Set([...core.World.getNpcs()]);const request={player:worldPlayer,target:source,npcId:945,targetIndex:source.getIndex(),item:pouch,itemId:I.DRUID_POUCH_2,slot:5,handled:false};assert.equal(PM.emitItemOnNpc(request),true);tick(3); // rsprox NatureSpirit 1310-1312: the form two ticks on
  const revealed=[...core.World.getNpcs()].find(n=>n&&!existing.has(n)&&n.getId()===946&&n.getOwner()===worldPlayer);assert.ok(revealed,'actual quest reveal owns visible identity');fixtureNpcs.add(revealed);assert.equal(revealed.isOwnerOnly(),true);await ghastKill(worldPlayer,revealed);assert.equal(worldPlayer.getAttribute('quest.nature_spirit.stage'),95,'canonical quest death advances its own visible identity');
  for(const drop of core.World.getItems().slice())if(!ground.includes(drop))core.ItemOnGroundManager.deregister(drop);
  console.log('GHASTLY_NPC_DEATH '+JSON.stringify({ownedClaim:true,noOwnedPrayer:true,noReplacement:true,settle,worldBonecrusher:true,worldRespawn:true,questVisiblePositive:true}));
});

for(const kind of['source-death','source-live-leave','target-leave','target-logout','expiry','cancel'])test(`native Ghastly queued owned impact after ${kind} cannot rot or damage`,async()=>{
  const{a,b,game}=await ghastGame(null,kind==='expiry'?16:1);for(const p of[a,b]){ghastFighter(p);ghastFood(p,1);}completePreparation(game);ghastReady(game);const npc=game.ghasts.npcs[0],before=contents(a.getInventory()),hp=a.getHitpoints();
  // Already resolved outgoing damage is a distinct supplied guard path, deliberately past PendingHit source checks.
  const stale=new core.HitDamage(8,core.HitMask.RED).setSource(npc);a.getCombat().getHitQueue().addPendingDamage([stale]);
  if(kind==='source-death')npc.setHitpoints(0);
  if(kind==='source-live-leave')game.area.leave(npc,false);
  if(kind==='target-leave')Match.leave({player:a});
  if(kind==='target-logout')PM.emitPlayerLogout({player:a,username:a.getUsername()});
  if(kind==='expiry'){core.World.processCycle=game.ends;game.tick();}
  if(kind==='cancel')game.finish(null);
  tick();a.getCombat().getHitQueue().process(C.now());assert.equal(a.getHitpoints(),hp);assert.deepEqual(contents(a.getInventory()),before);assert.equal(stale.getDamage(),0,'known-owned stale damage zeroes HP as well as skipping conversion');
  for(const tag of[null,'reflected','origin','poison']){const hit=ghastDirect(npc,a,8,tag);assert.equal(hit.getDamage(),0);assert.equal(a.getHitpoints(),hp);assert.deepEqual(contents(a.getInventory()),before);}
});

test('native Ghastly admitted queued additions become actual indexed members exactly once after registration',async t=>{
  const{a,b,game}=await ghastGame();for(const p of[a,b]){ghastFighter(p);ghastFood(p);}const list=core.World.getNpcs(),add=list.add.bind(list);let declined=0;
  const inject=t.mock.method(list,'add',function(npc,...args){if(npc.getId()===5626&&declined<2){declined++;return false;}return add(npc,...args);});
  tick(game.starts-C.now()-1);assert.equal(game.phase,'staging');core.World.processCycle++;game.tick();assert.equal(game.phase,'combat');assert.equal(declined,2);assert.equal(game.ghasts.ready,true);const npcs=game.ghasts.npcs.slice();assert.ok(npcs.every(n=>!n.isRegistered()&&core.World.getAddNPCQueue().includes(n)));assert.equal(game.area.getNpcs().length,0,'unregistered actors are not indexed in area membership');for(const npc of npcs){assert.equal(game.area.canAttack(npc,a,CombatFactory.MELEE_COMBAT),false);ghastIdentity(npc.getCombat().getTarget(),null,'npc.getCombat().getTarget() identity');}inject.mock.restore();ghastTurns=true;tick();ghastReady(game);ghastSameRefs(game.area.getNpcs().slice().sort((a,b)=>a.getIndex()-b.getIndex()),npcs.slice().sort((a,b)=>a.getIndex()-b.getIndex()),'game.area.getNpcs().slice().sort((a,b)=>a.getIndex()-b.getIndex()) identity');tick(5);assert.equal(game.ghasts.npcs.length,2);assert.ok(npcs.every(n=>!core.World.getAddNPCQueue().includes(n)));assert.notEqual(npcs[0].getIndex(),npcs[1].getIndex());
});

test('native Ghastly second-spawn failure after first queued admission cancels once without a hazard-free phase or late spawn',async t=>{
  const{a,b,game}=await ghastGame(),list=core.World.getNpcs(),add=list.add.bind(list),spawn=C.api.spawnNpc;let spawned=0,first=null;
  const reject=t.mock.method(list,'add',function(npc,...args){if(npc.getId()===5626)return false;return add(npc,...args);});
  const fail=t.mock.method(C.api,'spawnNpc',function(def){if(def.id===5626&&++spawned===2)return null;const npc=spawn(def);if(def.id===5626)first=npc;return npc;});
  tick(game.starts-C.now());assert.equal(spawned,2);assert.ok(first);assert.equal(game.phase,'over');assert.equal(game.area.isDestroyed(),true);assert.equal(Boolean(first.isRegistered()),false);assert.equal(core.World.getAddNPCQueue().includes(first),false);assert.equal(core.World.getRemoveNPCQueue().includes(first),false);assert.equal(game.ghasts.ready,false);assert.match(game.ghasts.failure,/spawn refused/);ghastAbsent(first,game.area,'partial spawn immediate cleanup');for(const p of[a,b]){assert.equal(C.matches.has(p),false);lobby(p);}reject.mock.restore();fail.mock.restore();tick(120);assert.equal(spawned,2);assert.equal(Boolean(first.isRegistered()),false);assert.equal(core.World.getAddNPCQueue().includes(first),false);assert.equal(Match.active.has(game),false);ghastAbsent(first,game.area,'partial spawn delayed cleanup');
});

test('native Ghastly pre-registration cancellation removes both queued owned hazards before ordinary queue drain',async t=>{
  const{game}=await ghastGame(),list=core.World.getNpcs(),add=list.add.bind(list);let blocked=0;
  const inject=t.mock.method(list,'add',function(npc,...args){if(npc.getId()===5626&&blocked++<2)return false;return add(npc,...args);});
  tick(game.starts-C.now()-1);core.World.processCycle++;game.tick();const old=game.ghasts.npcs.slice();assert.equal(old.length,2);assert.ok(old.every(n=>!n.isRegistered()&&core.World.getAddNPCQueue().includes(n)));game.finish(null);inject.mock.restore();tick(120);assert.ok(old.every(n=>!n.isRegistered()&&!core.World.getAddNPCQueue().includes(n)&&!core.World.getRemoveNPCQueue().includes(n)));assert.equal(game.area.isDestroyed(),true);
});

test('native Ghastly queued hit and NPC death cannot cross destroyed actual8x8 slot reuse while live other hazards and world control continue',async()=>{
  const dead=await ghastGame(),live=await ghastGame();for(const p of[dead.a,dead.b,live.a,live.b]){ghastFighter(p);ghastFood(p);}completePreparation(live.game); // The older dead game reaches start through the same ordinary tasks.
  ghastReady(dead.game);ghastReady(live.game);const old=dead.game.ghasts.npcs.slice(),other=live.game.ghasts.npcs.slice(),base=[dead.game.area.getBaseX(),dead.game.area.getBaseY()],oldOrb=lumbridgeObject(dead.game,'clanwars_viewing_start_swamp',[3397,4929]),oldMasks=[ghastPlane(dead.game.area,0),ghastPlane(dead.game.area,1)],oldSettings=[ghastPlane(dead.game.area,0,true),ghastPlane(dead.game.area,1,true)],liveMasks=[ghastPlane(live.game.area,0),ghastPlane(live.game.area,1)],snap=contents(dead.a.getInventory()),hp=dead.a.getHitpoints();
  const worldAt=new core.Location(3222,3218,0),worldClip=core.RegionManager.getClipping(worldAt.getX(),worldAt.getY(),0,null),world=C.api.spawnNpc({id:5626,x:3223,y:3218,z:0,wanderRadius:0});fixtureNpcs.add(world);const worldDef=world.getCurrentDefinition();
  const pending=CombatFactory.getMethod(old[0]).hits(old[0],dead.a)[0];CombatFactory.addPendingHit(pending);assert.equal(dead.a.getCombat().getHitQueue().hasPendingWork(),true);const raw=new core.HitDamage(8,core.HitMask.RED).setSource(old[1]);dead.a.getCombat().getHitQueue().addPendingDamage([raw]);
  // Queue a genuine lethal NPC death but destroy before its delayed drop/leave/removal task completes.
  old[0].getCombat().addDamage(dead.a,135);old[0].setHitpoints(0);assert.equal(old[0].isDyingFunction(),true);dead.game.finish(null);assert.equal(dead.game.area.isDestroyed(),true);for(const p of[dead.a,dead.b])lobby(p);const replacement=ghastTemplate();
  try{
    assert.deepEqual([replacement.getBaseX(),replacement.getBaseY()],base,'actual allocator reuses the freed8x8 slot');for(let p=0;p<2;p++){assert.deepEqual(ghastPlane(replacement,p),oldMasks[p]);assert.deepEqual(ghastPlane(replacement,p,true),oldSettings[p]);}
    let nativeOther=0;ghastObserve=(kind,e)=>{if(kind==='prepare'&&other.includes(e.attacker))nativeOther++;};ghastTurns=true;const settle=Math.max(120,...old.map(n=>n.getDefinition().getRespawn()+n.getDefinition().getDeathTicks()+10));assert.ok(settle<=1000);tick(settle);ghastTurns=false;
    assert.ok(nativeOther>=2,'other private hazards still run real engine attacks');assert.ok(other.every(n=>n.isRegistered()&&n.getArea()===live.game.area));assert.ok(old.every(n=>!n.isRegistered()&&!core.World.getAddNPCQueue().includes(n)&&!core.World.getRemoveNPCQueue().includes(n)));assert.equal(core.World.getAddNPCQueue().some(n=>n.getArea()===dead.game.area),false);assert.equal([...core.World.getNpcs()].some(n=>n?.getArea()===dead.game.area),false);assert.equal(dead.a.getHitpoints(),hp);assert.deepEqual(contents(dead.a.getInventory()),snap);assert.equal(raw.getDamage(),0);assert.equal(world.isRegistered(),true);ghastIdentity(world.getCurrentDefinition(),worldDef,'world.getCurrentDefinition() identity');ghastIdentity(world.getArea(),null,'world.getArea() identity');assert.equal(core.RegionManager.getClipping(worldAt.getX(),worldAt.getY(),0,null),worldClip);
    for(let p=0;p<2;p++){assert.deepEqual(ghastPlane(replacement,p),oldMasks[p]);assert.deepEqual(ghastPlane(replacement,p,true),oldSettings[p]);assert.deepEqual(ghastPlane(live.game.area,p),liveMasks[p]);}const fresh=lumbridgeObject({area:replacement},'clanwars_viewing_start_swamp',[3397,4929]);ghastIdentity(fresh.getPrivateArea(),replacement,'fresh.getPrivateArea() identity');assert.ok(fresh!==oldOrb,'fresh identity');
    console.log('GHASTLY_REUSE '+JSON.stringify({base,settle,oldRegistered:old.map(n=>n.isRegistered()),otherNativeAttacks:nativeOther,worldUnchanged:true}));
  }finally{replacement.destroy();}
});

test('native Ghastly nullable-action Tree and Roots refuse invented resource actions while ordinary world Tree still yields and respawns',async t=>{
  resourceRandom(t);const{a,b,game}=await ghastGame();completePreparation(game);ghastReady(game);const WC=require('../plugins/skills/Woodcutting.plugin'),I=core.ItemIdentifiers,skills=a.getSkillManager();skills.setCurrentLevel(core.Skill.WOODCUTTING,99);skills.setMaxLevel(core.Skill.WOODCUTTING,99);give(a,I.BRONZE_AXE,'ghast-axe');
  const baseline=[ghastPlane(game.area,0),ghastPlane(game.area,1)],settings=[ghastPlane(game.area,0,true),ghastPlane(game.area,1,true)],all=[];for(let p=0;p<2;p++)for(let x=0;x<8;x++)for(let y=0;y<8;y++){const objects=game.area.getChunkObjects(p,x,y);if(p===1)assert.equal(objects.length,0);all.push(...objects);}assert.equal(all.length,844);const resources=all.filter(o=>[4051,1364].includes(o.getId()));assert.ok(resources.some(o=>o.getId()===4051));assert.ok(resources.some(o=>o.getId()===1364));for(const o of resources)assert.equal((o.getDefinition().getInteractions()??[]).some(Boolean),false,'whole bounded source nullable actions, not name-based harvestability');
  const listener=new (require('../dist/net/packet/impl/ObjectActionPacketListener').ObjectActionPacketListener)();for(const[name,xy,approach]of[['deadtree4swamp',[3398,4946],[3397,4946]],['swamp_root',[3398,4977],[3397,4978]]]){const object=lumbridgeObject(game,name,xy);await ghastWalk(a,game,approach);const inventory=contents(a.getInventory()),xp=skills.getExperience(core.Skill.WOODCUTTING),menu=a.getCreationMenu();assert.equal(WC.isWoodcuttingActive(a),false);for(const action of['Chop down','Climb-up'])listener.executeAction(a,object.getId(),object.getLocation().getX(),object.getLocation().getY(),0,action);listener.executeAction(a,object.getId(),object.getLocation().getX(),object.getLocation().getY(),1);tick(20);assert.equal(WC.isWoodcuttingActive(a),false);assert.equal(treeTask(object),undefined);assert.deepEqual(contents(a.getInventory()),inventory);assert.equal(skills.getExperience(core.Skill.WOODCUTTING),xp);ghastIdentity(a.getCreationMenu(),menu,'a.getCreationMenu() identity');ghastIdentity(core.MapObjects.getPrivateArea(a,object.getId(),object.getLocation()),object,'core.MapObjects.getPrivateArea(a,object.getId(),object.getLocation()) identity');}
  for(let p=0;p<2;p++){assert.deepEqual(ghastPlane(game.area,p),baseline[p]);assert.deepEqual(ghastPlane(game.area,p,true),settings[p]);}
  const world=actor(true);world.moveTo(new core.Location(3222,3218,0));core.RegionManager.loadMapFiles(3222,3218);const tree=new core.GameObject(core.CacheDefinitions.getLocId('tree2'),new core.Location(3223,3218,0),10,2,null);core.ObjectManager.register(tree,true);tick();try{const xp=world.getSkillManager().getExperience(core.Skill.WOODCUTTING),task=await chopTree(world,tree);assert.equal(world.getInventory().getAmount(I.LOGS),1);assert.ok(world.getSkillManager().getExperience(core.Skill.WOODCUTTING)>xp);const remaining=task.getRemainingTicks();assert.ok(remaining>0&&remaining<=98);tick(remaining+1);assert.equal(task.isStopped(),true);ghastIdentity(core.MapObjects.get(tree.getId(),tree.getLocation(),null),tree,'core.MapObjects.get(tree.getId(),tree.getLocation(),null) identity');for(let p=0;p<2;p++)assert.deepEqual(ghastPlane(game.area,p),baseline[p]);}finally{core.ObjectManager.deregister(tree,true);}
});

test('native Ghastly owned NPC targets enforce fighter area and NoSpecials without altering teammates or foreign layouts',async()=>{
  const{a,b,game}=await ghastGame({specialattacks:2}),outsider=actor(true);completePreparation(game);ghastReady(game);const npc=game.ghasts.npcs[0],methods=[CombatFactory.MELEE_COMBAT,{type:()=>core.CombatType.RANGED},{type:()=>core.CombatType.MAGIC}];
  for(const p of[a,b]){assert.equal(game.area.canAttack(p,npc,methods[0]),true);assert.equal(game.area.canAttack(npc,p,methods[0]),true);for(const method of methods.slice(1)){assert.equal(game.area.canAttack(p,npc,method),false);assert.equal(game.area.canAttack(npc,p,method),false);}}
  a.setSpecialActivated(true);assert.equal(game.area.canAttack(a,npc,methods[0]),false);a.setSpecialActivated(false);assert.equal(game.area.canAttack(a,npc,methods[0]),true);assert.equal(game.area.canAttack(outsider,npc,methods[0]),false);assert.equal(game.area.canAttack(npc,outsider,methods[0]),false);
  const foreign=C.api.spawnNpc({id:5626,x:npc.getLocation().getX(),y:npc.getLocation().getY(),z:0,wanderRadius:0});fixtureNpcs.add(foreign);game.area.add(foreign);assert.equal(game.area.canAttack(a,foreign,methods[0]),false);assert.equal(game.area.canAttack(foreign,a,methods[0]),false);assert.equal(game.area.npcAggression(a,foreign),false);ghastIdentity(npc.getDefinition(),foreign.getDefinition(),'shared definition object never replaced by owned hazard policy');
});

test('native Ghastly World consumed queued-add refusal cancels the match without retry or a late hazard',async t=>{
  const{a,b,game}=await ghastGame(),list=core.World.getNpcs(),add=list.add.bind(list);let refused=0;
  const inject=t.mock.method(list,'add',function(npc,...args){if(npc.getId()===5626&&refused<3){refused++;return false;}return add(npc,...args);});
  tick(game.starts-C.now());assert.equal(refused,3);const old=game.ghasts.npcs.slice();assert.equal(old.length,2);ghastSameRefs(npcQueueFailures.splice(0),[old[0]],'World shifts a refused addition without requeue; the other registers');assert.equal(core.World.getAddNPCQueue().includes(old[0]),false);assert.equal(Boolean(old[0].isRegistered()),false);assert.equal(core.World.getNpcs().get(old[0].getIndex())===old[0],false,'refused actor never occupies a World slot');assert.equal(old[1].isRegistered(),true);inject.mock.restore();tick();assert.equal(game.phase,'over');assert.match(game.ghasts.failure,/queued registration failed/);assert.equal(game.ghasts.ready,false);assert.equal(game.area.isDestroyed(),true);for(const npc of old)ghastAbsent(npc,game.area,'consumed registration refusal immediate cleanup');assert.ok(old.every(n=>!n.isRegistered()&&!core.World.getAddNPCQueue().includes(n)));for(const p of[a,b]){assert.equal(C.matches.has(p),false);lobby(p);}tick(120);assert.ok(old.every(n=>!n.isRegistered()&&!core.World.getAddNPCQueue().includes(n)));assert.equal(refused,3,'no automatic registration retry');for(const npc of old)ghastAbsent(npc,game.area,'consumed registration refusal delayed cleanup');
});

// R: Gridlock. Source qualification is distinct from these native gameplay outcomes.
const GRIDLOCK_ORIGIN=[3456,4800],GRIDLOCK_LANDINGS=[[3465,4829,0],[3575,4899,0]],GRIDLOCK_JAILS=[[3519,4861,0],[3519,4865,0]];
const GRIDLOCK_ROWS=[...Array.from({length:53},(_,n)=>4806+n),...Array.from({length:53},(_,n)=>4868+n)];
const GRIDLOCK_FLOORS=[[14487,4809],[14485,4810],[14485,4811],[14487,4813],[14487,4820],[14485,4822],[14493,4826],[14487,4829],[14485,4831],[14485,4838],[14493,4844],[14487,4853],[14485,4868],[14496,4871],[14496,4880],[14485,4883],[14485,4884],[14498,4889],[14484,4908],[14484,4909],[14484,4914],[14484,4915]];
const GRIDLOCK_ROUTES={4806:[[3500,4842],[3518,4840],[3518,4806]],4832:[[3500,4842],[3518,4840],[3518,4832]],4858:[[3500,4842],[3518,4858]],4868:[[3500,4852],[3518,4868]],4894:[[3500,4852],[3518,4880],[3518,4894]],4920:[[3500,4852],[3518,4880],[3518,4915],[3518,4920]]};
const gridSource=(p,game)=>[p.getLocation().getX()-game.area.getBaseX()+3456,p.getLocation().getY()-game.area.getBaseY()+4800,0];
const gridWalk=northleachWalk;
function gridObject(game,name,xy,plane=0){const id=core.CacheDefinitions.getLocId(name),at=game.area.at([...xy,plane]),found=[];for(let x=0;x<16;x++)for(let y=0;y<16;y++)found.push(...game.area.getChunkObjects(plane,x,y).filter(o=>o.getId()===id&&o.getLocation().equals(at)));assert.equal(found.length,1,'unique observed Gridlock object');ghastIdentity(found[0].getPrivateArea(),game.area,'Gridlock template owner');return found[0];}
const gridReachable=(game,from,to)=>layoutReachable(game,from,to,GRIDLOCK_ORIGIN);
function gridPlane(area,plane=0,settings=false){if(!settings){const a=[];for(let y=0;y<128;y++)for(let x=0;x<128;x++)a.push(area.getClip(area.tile(x,y,plane)));return a;}const a=new Uint8Array(4*16384);for(let x=0;x<16;x++)for(let y=0;y<16;y++)area.copyChunkSettings(a,plane,x,y);return Array.from(a.subarray(plane*16384,(plane+1)*16384));}
function gridTemplate(){const area=new core.TemplatedInstanceArea(16,16);for(let x=0;x<16;x++)for(let y=0;y<16;y++)area.setChunk(0,x,y,{sourceChunkX:432+x,sourceChunkY:600+y,sourcePlane:0,rotation:0});area.at=tile=>area.tile(tile[0]-3456,tile[1]-4800,tile[2]);return area;}
async function gridGame(terms=null,mode=1){const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,mode,terms,9);await join(a);await join(b);return{a,b,game};}
function gridSide(game,players,side){const p=players.find(p=>game.members.get(p)===side);assert.ok(p);return p;}
async function gridRoute(p,game,points){for(const xy of points)await gridWalk(p,game,xy);}
function gridFlood(game,from){const queue=[from.slice(0,2)],seen=new Set([from.slice(0,2).join(',')]);for(let i=0;i<queue.length;i++){const[x,y]=queue[i];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy,key=`${nx},${ny}`;if(nx<3456||nx>3583||ny<4800||ny>4927||seen.has(key))continue;if(core.RegionManager.canMovestart(game.area.at([x,y,0]),game.area.at([nx,ny,0]),1,1,game.area)){seen.add(key);queue.push([nx,ny]);}}}return seen;}
function gridWallAbsent(wall,area,retainedRemoval=false){assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).includes(wall),false);assert.equal(core.World.getObjects().includes(wall),false);assert.equal(core.World.getRemovedObjects().includes(wall),retainedRemoval,'canonical live-scene removal marker versus destroyed-area purge');assert.equal(area.getObjects().includes(wall),false);}

test('native Gridlock slot27 invalidates agreement and all thirteen offers preserve default1 and numeric0',async()=>{
  const a=actor(),b=actor();channel(a);channel(b);await challenge(a,b);await challenge(b,a);const session=C.negotiations.get(a),bit=core.CacheDefinitions.getVarbitId('clanwars_arena');assert.equal(session.rules.arena,1);
  await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);await click(b,'clanwars_setup:arena',27);assert.equal(session.rules.arena,9,'ordinary native27 offers Gridlock');assert.equal(session.accepted.size,0);
  assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(session.rules),/Gridlock/);
  for(const arena of[0,1,2,3,4,5,6,7,8,11,12,13,9]){tick(9);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);await click(b,'clanwars_setup:arena',arena*3);assert.equal(session.rules.arena,arena);assert.equal(session.accepted.size,0);for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(bit),arena);}
  for(const slot of[1,2,22,28,30,42,45,48,65535]){await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,9);for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(bit),9);}
  tick(9);await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(game.rules.arena,9);assert.equal(game.layout.name,'Gridlock');
});

for(const mode of[0,1,8,16,20])test(`native Gridlock mode ${mode} preserves restrictions late-entry and timed lifetime`,async()=>{
  const a=actor(true),b=actor(true),late=actor(true);channel(a,[late]);channel(b);const game=await negotiate(a,b,null,mode,{food:1,prayer:2},9);await join(a);await join(b);assert.equal(game.rules.food,1);assert.equal(game.rules.prayer,2);completePreparation(game);assert.equal(game.ghasts,undefined);
  assert.equal(game.area.canAttack(a,b,CombatFactory.MELEE_COMBAT),true);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.RANGED}),false);assert.equal(game.area.canAttack(a,b,{type:()=>core.CombatType.MAGIC}),false);
  if(mode){await join(late);assert.equal(game.fighters.has(late),true);assert.deepEqual(position(late),positionAt(game,GRIDLOCK_LANDINGS[game.members.get(late)]));}else{Match.enter({player:late});assert.equal(game.members.has(late),false);}
  if(mode===16||mode===20){core.World.processCycle=game.ends-1;tick();assert.equal(game.phase,'over');for(const p of[a,b,late])lobby(p);}
});

test('native Gridlock full16384 flags and106 owned walls preserve22 floor identities and all directional footprints',async()=>{
  const{a,b,game}=await gridGame(),reference=gridTemplate();
  try{
    const base=gridPlane(reference),settings=gridPlane(reference,0,true),walls=game.walls.slice(),id=core.CacheDefinitions.getLocId('clanwars_barrier_darkrock'),d=core.CacheDefinitions.getObject(id),row=new Set(GRIDLOCK_ROWS);
    assert.deepEqual([game.area.widthChunks,game.area.heightChunks],[16,16]);assert.deepEqual([d.sizeX,d.sizeY,d.clipType,d.blocksProjectile],[1,1,1,true]);assert.equal(walls.length,106);assert.equal(base.length,16384);assert.equal(game.ghasts,undefined);assert.deepEqual(gridPlane(game.area,0,true),settings);
    const regions=new Map([13899,13900,14155,14156].map(id=>[id,require('../dist/game/collision/TemplateRegionData').getTemplateRegion(id)]));
    for(let x=0;x<128;x++)for(let y=0;y<128;y++)assert.equal(settings[x*128+y],regions.get((((3456+x)>>6)<<8)|((4800+y)>>6)).settings[((x&63)<<6)|(y&63)]);
    for(let x=0;x<16;x++)for(let y=0;y<16;y++){assert.deepEqual(game.area.getChunk(0,x,y),reference.getChunk(0,x,y));for(const z of[1,2,3])assert.equal(game.area.getChunk(z,x,y),null);}
    for(const z of[1,2,3]){assert.ok(gridPlane(game.area,z).every(mask=>mask===0x200100));assert.ok(gridPlane(game.area,z,true).every(value=>value===0));}
    const copies=[],floors=[];for(let x=0;x<16;x++)for(let y=0;y<16;y++)for(const object of game.area.getChunkObjects(0,x,y)){copies.push(object);const xy=gridSource({getLocation:()=>object.getLocation()},game);if(object.getType()===22&&xy[0]===3519&&row.has(xy[1]))floors.push(object);if(object.getType()<9||object.getType()>11||!object.getDefinition().isSolid())continue;const def=object.getDefinition(),odd=object.getFace()%2,w=odd?def.sizeY:def.sizeX,h=odd?def.sizeX:def.sizeY;for(const wy of row)assert.equal(3519>=xy[0]&&3519<xy[0]+w&&wy>=xy[1]&&wy<xy[1]+h,false,'full rotated nonzero solid footprint never overlaps barrier');}
    assert.equal(copies.length,1911);assert.equal(floors.length,22);assert.deepEqual(floors.map(o=>[o.getId(),gridSource({getLocation:()=>o.getLocation()},game)[1]]).sort((a,b)=>a[1]-b[1]),GRIDLOCK_FLOORS);
    for(const floor of floors){assert.equal(floor.getFace(),0);assert.equal(floor.getDefinition().isClippedDecoration(),false);assert.equal((floor.getDefinition().getInteractions()??[]).some(Boolean),false);ghastIdentity(core.MapObjects.getPrivateArea(a,floor.getId(),floor.getLocation()),floor,'exact coexistent floor identity');}
    for(const wall of walls){assert.equal(wall.getId(),id);assert.equal(wall.getType(),10);assert.equal(wall.getFace(),1);ghastIdentity(wall.getPrivateArea(),game.area,'owned Gridlock wall');ghastIdentity(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),wall,'native exact wall lookup');assert.equal(core.ObjectManager.objectsAt(wall.getLocation()).filter(o=>o.getId()===id&&o.getPrivateArea()===game.area&&o.getType()===10).length,1);const xy=gridSource({getLocation:()=>wall.getLocation()},game);assert.equal(xy[0],3519);assert.equal(row.has(xy[1]),true);assert.equal(base[(xy[1]-4800)*128+63]&0x20100,0);}
    for(let y=0;y<128;y++)for(let x=0;x<128;x++)assert.equal(game.area.getClip(game.area.tile(x,y,0)),base[y*128+x]|(x===63&&row.has(y+4800)?0x20100:0));
    const west=gridFlood(game,GRIDLOCK_LANDINGS[0]),east=gridFlood(game,GRIDLOCK_LANDINGS[1]);assert.equal(west.size,6549);assert.equal(east.size,6662);assert.equal([...west].some(key=>east.has(key)),false);assert.equal(gridFlood(game,GRIDLOCK_JAILS[0]).size,31);assert.equal(gridFlood(game,GRIDLOCK_JAILS[1]).size,24);
    completePreparation(game);assert.deepEqual(gridPlane(game.area),base);assert.deepEqual(gridPlane(game.area,0,true),settings);assert.equal(gridFlood(game,GRIDLOCK_LANDINGS[0]).size,13317);for(const wall of walls){gridWallAbsent(wall,game.area,true);ghastIdentity(core.MapObjects.getPrivateArea(a,id,wall.getLocation()),null,'removed wall no longer resolves as live object');}for(const floor of floors)ghastIdentity(core.MapObjects.getPrivateArea(a,floor.getId(),floor.getLocation()),floor,'floor survives wall removal');
    console.log('GRIDLOCK_GEOMETRY '+JSON.stringify({main:13317,holdings:[31,24],walls:106,staging:[6549,6662],floors:22,masks:16384,planes:[0]}));
  }finally{reference.destroy();}
});

for(const y of[4806,4832,4858,4868,4894,4920])test(`native Gridlock identical crossing atY${y} refuses staging then walks after actual200 start`,async()=>{
  const{a,b,game}=await gridGame(),p=gridSide(game,[a,b],0);assert.deepEqual(position(p),positionAt(game,GRIDLOCK_LANDINGS[0]));await gridRoute(p,game,GRIDLOCK_ROUTES[y]);assert.ok(C.now()+8<game.starts,'ordinary staging arrival precedes canonical boundary');const target=game.area.at([3520,y,0]);await wire(p,walkClickFrame(target));tick(3);assert.equal(game.phase,'staging');assert.equal(gridSource(p,game)[0]<3519,true);const staging=position(p);completePreparation(game);await gridWalk(p,game,[3518,y]);await gridWalk(p,game,[3520,y]);assert.deepEqual(position(p),[target.getX(),target.getY(),0]);console.log('GRIDLOCK_CROSSING '+JSON.stringify({y,requested:[target.getX(),target.getY(),0],staging,combat:position(p),ordinaryAssignedLanding:true}));
});

for(const side of[0,1])test(`native Gridlock side${side} assigned-landing routes reach real ordinary player melee and health loss`,async()=>{
  const{a,b,game}=await gridGame();completePreparation(game);const west=gridSide(game,[a,b],0),east=gridSide(game,[a,b],1),y=side?4868:4858;
  for(const p of[a,b]){ghastFighter(p);assert.deepEqual(position(p),positionAt(game,GRIDLOCK_LANDINGS[game.members.get(p)]));}
  await gridRoute(west,game,GRIDLOCK_ROUTES[y]);await gridWalk(east,game,[3520,y]);const attacker=side?east:west,victim=side?west:east,attempts=[],resolved=[];
  ghastObserve=(kind,e)=>{if(e.attacker!==attacker||e.target!==victim)return;if(kind==='prepare')attempts.push(C.now());if(kind==='resolved'){const row={cycle:C.now(),raw:e.hit.getHits().map(h=>h.getDamage()),accurate:e.hit.isAccurate()};resolved.push(row);for(const hit of e.hit.getHits())hit.onApplied(taken=>{row.taken=(row.taken??0)+taken;});}};
  const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(victim.getIndex(),2);const decoded=decodeClientPackets(frame);assert.equal(decoded[0].index,victim.getIndex());assert.equal(decoded[0].option,1);await wire(attacker,frame);ghastIdentity(attacker.getCombat().getTarget(),victim,'ordinary decoded opposing player target');const hp=victim.getHitpoints();ghastTurns=true;for(let n=0;n<160&&victim.getHitpoints()===hp;n++)tick();
  assert.ok(attempts.length>0);assert.ok(resolved.some(row=>row.raw.some(x=>x>0)&&row.taken>0));assert.ok(victim.getHitpoints()<hp);assert.equal(game.phase,'combat');assert.equal(game.ghasts,undefined);console.log('GRIDLOCK_ORDINARY_MELEE '+JSON.stringify({side,y,attempts,resolved,positions:[position(west),position(east)],naturalRolls:true,suppliedDamage:false}));
});

for(const side of[0,1])test(`native Gridlock side${side} real safe death owns ${side?24:31}cell holding both view and Exit deadline`,async()=>{
  const{a,b,game}=await gridGame({rejoiningdelay:side}),victim=gridSide(game,[a,b],side),killer=victim===a?b:a;completePreparation(game);victim.getInventory().add(new core.Item(995,79,{qa:'gridlock-holding',side}));const inventory=carriedItems(victim),kills=game.kills.slice(),killerSide=game.members.get(killer);
  // Supplied settled combat tiles and pre-rolled lethal hit; native death/holding/UI routes are real.
  await lethalMelee(killer,victim,game,true,[[3518,4858,0],[3519,4858,0]]);tick(6);assert.equal(game.jailed.has(victim),true);assert.deepEqual(position(victim),positionAt(game,GRIDLOCK_JAILS[side]));assert.deepEqual(carriedItems(victim),inventory);assert.equal(game.kills[killerSide],kills[killerSide]+1);assert.equal(game.kills[1-killerSide],kills[1-killerSide]);
  const holding=gridFlood(game,GRIDLOCK_JAILS[side]);assert.equal(holding.size,side?24:31);assert.equal(gridReachable(game,GRIDLOCK_JAILS[0],GRIDLOCK_JAILS[1]),false);for(const start of GRIDLOCK_JAILS)for(const end of GRIDLOCK_LANDINGS)assert.equal(gridReachable(game,start,end),false);
  let boundary=0;for(const key of holding){const[x,y]=key.split(',').map(Number);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;if(holding.has(`${x+dx},${y+dy}`))continue;boundary++;assert.equal(core.RegionManager.canMovestart(game.area.at([x,y,0]),game.area.at([x+dx,y+dy,0]),1,1,game.area),false,'every actual holding boundary step refuses');}}assert.ok(boundary>0);
  for(const target of[GRIDLOCK_LANDINGS[side],GRIDLOCK_JAILS[1-side]]){await wire(victim,walkClickFrame(game.area.at(target)));tick(6);assert.equal(holding.has(gridSource(victim,game).slice(0,2).join(',')),true);}
  const orbXY=[3519,side?4867:4859],orb=gridObject(game,'clanwars_viewing_start_darkrock',orbXY),inactive=mappedLayoutObjects(game,'clanwars_viewing_darkrock')[0],fakeOrb=new core.GameObject(orb.getId(),orb.getLocation().clone(),orb.getType(),orb.getFace(),game.area);assert.equal(orb.getId(),26741);assert.ok(inactive);assert.equal(viewingUnit().use({player:victim,object:inactive}),false);try{assert.equal(viewingUnit().use({player:victim,object:fakeOrb}),false);}finally{game.area.detach(fakeOrb);}
  await gridWalk(victim,game,[3519,side?4866:4860]);const calls=scriptCalls(victim);await layoutObjectInput(victim,game,'clanwars_viewing_start_darkrock',orbXY,'Use');const view=viewingUnit().active.get(victim);assert.ok(view);assert.equal(victim.getInterfaceId(),C.group('clanwars_view'));assert.equal(victim.isAppearanceHidden(),true);assert.equal(victim.isUntargetable(),true);assert.equal(victim.getMovementQueue().isMovementBlocked(),true);
  const{encodeCameraTarget}=require('../dist/net/protocol/ClientProtocol');for(const[index,name]of['central','sw','se','nw','ne'].entries()){await click(victim,`clanwars_view:${name}`,index%2);const fx=[.5,.25,.75,.25,.75][index],fy=[.5,.25,.25,.75,.75][index],at=game.area.tile(128*fx,128*fy,0);assert.deepEqual(position(victim),[at.getX(),at.getY(),0]);assert.deepEqual(calls.filter(([id])=>id===562).at(-1),[562,index,9752]);assert.ok(victim.nativePackets.some(frame=>frame.equals(encodeCameraTarget({x:at.getX(),y:at.getY(),level:0}))));assert.equal(victim.getSession().isTileInScene(at.getX(),at.getY(),0),true);}
  assert.equal(game.area.canAttack(killer,victim,CombatFactory.MELEE_COMBAT),false);await wire(victim,Buffer.from([VIEW_CLOSE_PACKET]));restoredViewer(victim,game,view.location);
  const exitXY=[3519,side?4864:4863],owned=gridObject(game,'clanwars_prisonportal_darkrock',exitXY),otherExit=gridObject(game,'clanwars_prisonportal_darkrock',[3519,side?4863:4864]),fake=new core.GameObject(owned.getId(),owned.getLocation().clone(),owned.getType(),owned.getFace(),game.area);assert.equal(owned.getId(),26738);assert.equal(otherExit.getId(),26738);assert.equal(owned===otherExit,false);assert.equal(gridReachable(game,GRIDLOCK_JAILS[side],[3519,side?4862:4865,0]),false,'other same-gameval Exit remains in the other holding');try{assert.equal(Match.exit({player:victim,object:fake}),false);}finally{game.area.detach(fake);}
  const deadline=game.returnAt.get(victim.getLongUsername());await gridWalk(victim,game,[3519,side?4865:4862]);if(side)assert.ok(deadline-C.now()>22,'real refused Exit is exercised before deadline');await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',exitXY,'Exit');if(side){assert.equal(game.jailed.has(victim),true);assert.equal(game.fighters.has(victim),false);assert.equal(game.returnAt.get(victim.getLongUsername()),deadline);assert.ok(deadline>C.now());tick(deadline-C.now());await layoutObjectInput(victim,game,'clanwars_prisonportal_darkrock',exitXY,'Exit');}
  assert.equal(game.jailed.has(victim),false);assert.equal(game.fighters.has(victim),true);assert.deepEqual(position(victim),positionAt(game,GRIDLOCK_LANDINGS[side]));assert.deepEqual(carriedItems(victim),inventory);console.log('GRIDLOCK_HOLDING '+JSON.stringify({side,cells:holding.size,boundary,orb:orbXY,model:9752,exit:exitXY,delay:side,allFiveViews:true}));
});

test('native Gridlock thirteenth layout preserves twelve live configurations and both side-correct rotated Forfeits',async()=>{
  const old=[];for(const arena of[0,1,2,3,4,5,6,7,8,11,12,13]){const a=actor(true),b=actor(true);channel(a);channel(b);const game=await negotiate(a,b,null,1,null,arena);await join(a);await join(b);old.push({game,players:[a,b],rules:{...game.rules},layout:game.layout});}
  const{a,b,game}=await gridGame(),Q=old.find(row=>row.game.rules.arena===7);assert.equal(new Set([...old.map(row=>row.game.area),game.area]).size,13);const foreign=gridObject(Q.game,'clanwars_prisonportal_swamp',[3393,4933]);assert.equal(Match.exit({player:a,object:foreign}),false);
  for(const p of[a,b]){const side=game.members.get(p),xy=side?[3579,4897]:[3459,4827],name=side?'clanwars_exitportal_greyrock_s':'clanwars_exitportal_greyrock_n',object=gridObject(game,name,xy),approach=side?[3578,4899]:[3461,4829];assert.equal(object.getId(),side?26731:26732);assert.equal(object.getType(),10);assert.equal(object.getFace(),side?3:1);assert.deepEqual([object.getDefinition().sizeX,object.getDefinition().sizeY,object.getDefinition().getBlockingMask()],[4,2,30]);const fake=new core.GameObject(object.getId(),object.getLocation().clone(),10,object.getFace(),game.area);try{assert.equal(Match.forfeit({player:p,object:fake}),false);}finally{game.area.detach(fake);}assert.equal(gridReachable(game,GRIDLOCK_LANDINGS[side],[...approach,0]),true);assert.equal(gridReachable(game,GRIDLOCK_LANDINGS[1-side],[...approach,0]),false);for(let x=0;x<2;x++)for(let y=0;y<4;y++)assert.equal(game.area.getClip(game.area.at([xy[0]+x,xy[1]+y,0]))&0x20100,0x20100,'entire actual rotated2x4 footprint blocks');await gridWalk(p,game,side?[3581,4899]:[3458,4829]);assert.equal(require('../dist/game/model/movement/path/PathFinder').PathFinder.reachedObject(p,object.getLocation().getX(),object.getLocation().getY(),4,2,object.getFace(),10,30),false,'opposite rotated access edge does not reach');await gridWalk(p,game,approach);assert.equal(require('../dist/game/model/movement/path/PathFinder').PathFinder.reachedObject(p,object.getLocation().getX(),object.getLocation().getY(),4,2,object.getFace(),10,30),true,'actual rotated native access side');await layoutObjectInput(p,game,name,xy,'Forfeit');assert.equal(C.matches.has(p),false);lobby(p);}
  tick(Math.max(1,game.starts-C.now()+1));assert.equal(game.phase,'over');assert.equal(game.area.isDestroyed(),true);assert.equal(game.ghasts,undefined);for(const row of old){assert.notEqual(row.game.phase,'over');assert.equal(row.game.area.isDestroyed(),false);assert.deepEqual(row.game.rules,row.rules);ghastIdentity(row.game.layout,row.layout,'old layout identity');for(const p of row.players)ghastIdentity(C.matches.get(p),row.game,'prior membership preserved');}ghastReady(Q.game);
});

test('native Gridlock Ignore5 six versus six uses actual safe defeat and keeps supplies',async()=>{
  const{b,teams,players,game}=await stragglerGame(6,1,3,{},9);completePreparation(game);assert.equal(game.fighters.size,12);const victim=teams[0][1];give(victim,core.ItemIdentifiers.SHRIMPS,'gridlock-ignore5');const inventory=carriedItems(victim);await lethalMelee(b,victim,game,true,[[3518,4858,0],[3519,4858,0]]);tick(8);assert.equal(game.phase,'over');assert.equal(game.area.isDestroyed(),true);assert.deepEqual(carriedItems(victim),inventory);for(const p of players)lobby(p);
});

test('native Gridlock full rotated skeleton torch and directional wall routes trace every ordinary step',async t=>{
  const{a,b,game}=await gridGame();completePreparation(game);const p=gridSide(game,[a,b],0);p.setRunning(false);const movement=p.getMovementQueue(),process=movement.process.bind(movement),trace=[];const watch=t.mock.method(movement,'process',function(...args){const from=p.getLocation().clone(),value=process(...args),to=p.getLocation().clone();if(!from.equals(to)){assert.ok(Math.max(Math.abs(from.getX()-to.getX()),Math.abs(from.getY()-to.getY()))<=1,'walking setup records every native step including wire ticks');assert.equal(core.RegionManager.canMovestart(from,to,1,1,game.area),true);trace.push([from.getX(),from.getY(),to.getX(),to.getY()]);}return value;});
  try{
    await gridRoute(p,game,[[3500,4842],[3512,4861]]);
    for(const spec of[{name:'standing_torch',xy:[3513,4861],face:0,size:[1,1],from:[3512,4861],to:[3514,4861],projectile:true},{name:'wild1_skeleton_3',xy:[3525,4872],face:1,size:[1,2],from:[3525,4871],to:[3525,4874],projectile:false},{name:'wild5_skeleton_3',xy:[3524,4827],face:0,size:[2,1],from:[3524,4826],to:[3524,4828],projectile:false}]){const object=gridObject(game,spec.name,spec.xy),at=object.getLocation(),from=game.area.at([...spec.from,0]),to=game.area.at([...spec.to,0]);assert.equal(object.getFace(),spec.face);assert.equal(object.getType(),10);assert.equal((object.getDefinition().getInteractions()??[]).some(Boolean),false);assert.equal(core.CacheDefinitions.getObject(object.getId()).blocksProjectile,spec.projectile);for(let x=0;x<spec.size[0];x++)for(let y=0;y<spec.size[1];y++)assert.equal(game.area.getClip(game.area.at([spec.xy[0]+x,spec.xy[1]+y,0]))&0x20100,spec.projectile?0x20100:0x100);await gridWalk(p,game,spec.from);trace.length=0;await wire(p,walkClickFrame(at));tick(8);for(const step of trace){const xy=[step[2]-game.area.getBaseX()+3456,step[3]-game.area.getBaseY()+4800];assert.equal(xy[0]>=spec.xy[0]&&xy[0]<spec.xy[0]+spec.size[0]&&xy[1]>=spec.xy[1]&&xy[1]<spec.xy[1]+spec.size[1],false);}assert.equal(core.RegionManager.canMovestart(from,at,1,1,game.area),false);assert.equal(core.RegionManager.canProjectileAttackReturn(from,to,1,game.area),!spec.projectile);await gridWalk(p,game,spec.to);assert.ok(trace.length>0);console.log('GRIDLOCK_OBSTACLE '+JSON.stringify({id:object.getId(),source:spec.xy,shape:spec.size,ray:!spec.projectile,stepsIncludingWire:trace.length,arrival:position(p)}));}
    const wall=gridObject(game,'wild1_wall_top',[3480,4841]);assert.equal(wall.getType(),0);assert.equal(wall.getFace(),1);await gridWalk(p,game,[3480,4841]);const from=game.area.at([3480,4841,0]),to=game.area.at([3480,4842,0]);assert.equal(core.RegionManager.blocked(from,game.area),false);assert.equal(core.RegionManager.blocked(to,game.area),false);assert.equal(core.RegionManager.canMovestart(from,to,1,1,game.area),false);assert.equal(core.RegionManager.canProjectileAttackReturn(from,to,1,game.area),false);trace.length=0;await gridWalk(p,game,[3480,4842]);assert.ok(trace.length>1);console.log('GRIDLOCK_DIRECTIONAL_WALL '+JSON.stringify({source:[3480,4841],face:1,stepsIncludingWire:trace.length,arrival:position(p)}));
    const open=game.area.at([3465,4829,0]),next=game.area.at([3466,4829,0]);assert.equal(core.RegionManager.canMovestart(open,next,1,1,game.area),true);assert.equal(core.RegionManager.canProjectileAttackReturn(open,next,1,game.area),true);
  }finally{watch.mock.restore();}
});

test('native Gridlock complete nullable action inventory refuses invented resources while seeded world Tree still produces',async t=>{
  resourceRandom(t);const{a,b,game}=await gridGame();completePreparation(game);const p=gridSide(game,[a,b],0),I=core.ItemIdentifiers,wood=require('../plugins/skills/Woodcutting.plugin');p.getSkillManager().setCurrentLevel(core.Skill.WOODCUTTING,99);p.getSkillManager().setMaxLevel(core.Skill.WOODCUTTING,99);give(p,I.BRONZE_AXE,'gridlock-negative-resource');const objects=[];for(let x=0;x<16;x++)for(let y=0;y<16;y++)objects.push(...game.area.getChunkObjects(0,x,y));assert.equal(objects.length,1911);const actionable=objects.filter(o=>o.getDefinition().getInteractions()?.some(Boolean));assert.equal(actionable.length,6);assert.deepEqual(actionable.map(o=>[o.getId(),o.getDefinition().getInteractions().filter(Boolean)]).sort((a,b)=>a[0]-b[0]),[[26731,['Forfeit']],[26732,['Forfeit']],[26738,['Exit']],[26738,['Exit']],[26741,['Use']],[26741,['Use']]]);
  const baseline=gridPlane(game.area),settings=gridPlane(game.area,0,true),inventory=carriedItems(p),xp=p.getSkillManager().getExperience(core.Skill.WOODCUTTING),listener=new(require('../dist/net/packet/impl/ObjectActionPacketListener').ObjectActionPacketListener)();
  await gridRoute(p,game,[[3500,4842],[3512,4861]]);for(const[name,xy,approach]of[['standing_torch',[3513,4861],[3512,4861]],['wild1_wall_top',[3480,4841],[3480,4841]],['wild2_dugupsoil_1',[3519,4810],[3519,4810]]]){const object=gridObject(game,name,xy);assert.equal((object.getDefinition().getInteractions()??[]).some(Boolean),false);await gridWalk(p,game,approach);for(const action of['Chop down','Climb-up'])listener.executeAction(p,object.getId(),object.getLocation().getX(),object.getLocation().getY(),0,action);listener.executeAction(p,object.getId(),object.getLocation().getX(),object.getLocation().getY(),1);tick(8);assert.equal(wood.isWoodcuttingActive(p),false);assert.equal(treeTask(object),undefined);assert.deepEqual(carriedItems(p),inventory);assert.equal(p.getSkillManager().getExperience(core.Skill.WOODCUTTING),xp);ghastIdentity(core.MapObjects.getPrivateArea(p,object.getId(),object.getLocation()),object,'null-action source object unchanged');}
  const world=actor(true);world.moveTo(new core.Location(3222,3218,0));core.RegionManager.loadMapFiles(3222,3218);const tree=new core.GameObject(core.CacheDefinitions.getLocId('tree2'),new core.Location(3223,3218,0),10,2,null);core.ObjectManager.register(tree,true);tick();try{const before=world.getSkillManager().getExperience(core.Skill.WOODCUTTING),task=await chopTree(world,tree);assert.equal(world.getInventory().getAmount(I.LOGS),1);assert.ok(world.getSkillManager().getExperience(core.Skill.WOODCUTTING)>before);assert.ok(task.getRemainingTicks()>0);tick(task.getRemainingTicks()+1);assert.equal(task.isStopped(),true);ghastIdentity(core.MapObjects.get(tree.getId(),tree.getLocation(),null),tree,'disclosed seeded world producer respawns normally');assert.deepEqual(gridPlane(game.area),baseline);assert.deepEqual(gridPlane(game.area,0,true),settings);}finally{core.ObjectManager.deregister(tree,true);}
});

test('native Gridlock food drink prayer special vetoes retain safe-death metadata and unlock after exit',async()=>{
  const{a,b,game}=await gridGame({food:1,drinks:1,prayer:2,specialattacks:2});for(const p of[a,b])ruleStats(p);completePreparation(game);const I=core.ItemIdentifiers;give(a,I.SHRIMPS,'gridlock-food');give(a,I.ATTACK_POTION_4_,'gridlock-potion');let before=resources(a);await nativeItem(a,I.SHRIMPS,'Eat');assert.deepEqual(resources(a),before);await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.deepEqual(resources(a),before);await nativeButton(a,prayerWidget(core.PrayerHandler.THICK_SKIN));assert.equal(a.getPrayerActive().some(Boolean),false);assert.deepEqual(resources(a),before);await wield(a,I.DRAGON_DAGGER,'gridlock-special');before=resources(a);await nativeButton(a,'orbs:specbutton');assert.equal(a.isSpecialActivated(),false);assert.deepEqual(resources(a),before);const inventory=carriedItems(a);await lethalMelee(b,a,game,true,[[3518,4858,0],[3519,4858,0]]);tick(6);assert.equal(game.jailed.has(a),true);assert.deepEqual(carriedItems(a),inventory);assert.deepEqual(a.getEquipment().get(core.Equipment.WEAPON_SLOT).getMeta(),{qa:'gridlock-special'});game.finish(null);tick(2);a.setHitpoints(50);await nativeItem(a,I.SHRIMPS,'Eat');assert.equal(a.getInventory().contains(I.SHRIMPS),false);await nativeItem(a,I.ATTACK_POTION_4_,'Drink');assert.equal(a.getInventory().contains(I.ATTACK_POTION_3_),true);assert.deepEqual(a.getInventory().getValidItems().find(item=>item.getId()===I.ATTACK_POTION_3_).getMeta(),{qa:'gridlock-potion'});
});

for(const kind of['staging-cancel','combat-cancel','logout','live-leave','expiry','dying-cancel'])test(`native Gridlock ${kind} cleans finite walls membership viewers and delayed callbacks`,async()=>{
  const{a,b,game}=await gridGame(kind==='expiry'?{rejoiningdelay:1}:null,kind==='expiry'?16:1),walls=game.walls.slice();give(a,core.ItemIdentifiers.SHRIMPS,'gridlock-lifecycle');const inventory=carriedItems(a),reference=gridTemplate(),baseline=gridPlane(reference),settings=gridPlane(reference,0,true);reference.destroy();
  if(kind!=='staging-cancel')completePreparation(game);
  if(kind==='logout')PM.emitPlayerLogout({player:a,username:a.getUsername()});else if(kind==='live-leave')await Match.leave({player:a});else if(kind==='expiry'){await lethalMelee(b,a,game,true,[[3518,4858,0],[3519,4858,0]]);tick(6);const side=game.members.get(a);await gridWalk(a,game,[3519,side?4866:4860]);await layoutObjectInput(a,game,'clanwars_viewing_start_darkrock',[3519,side?4867:4859],'Use');assert.equal(viewingUnit().active.has(a),true);assert.ok(game.returnAt.has(a.getLongUsername()));core.World.processCycle=game.ends-1;}else if(kind==='dying-cancel'){await lethalMelee(b,a,game,false,[[3518,4858,0],[3519,4858,0]]);assert.equal(a.getHitpoints(),0);game.finish(null);}else game.finish(null);
  tick(8);finishedMatch(game,[a,b]);assert.deepEqual(carriedItems(a),inventory);for(const wall of walls)gridWallAbsent(wall,game.area);const base=[game.area.getBaseX(),game.area.getBaseY()],replacement=gridTemplate();try{assert.deepEqual([replacement.getBaseX(),replacement.getBaseY()],base,'actual16x16 slot reused after lifecycle route');assert.deepEqual(gridPlane(replacement),baseline);assert.deepEqual(gridPlane(replacement,0,true),settings);tick(120);finishedMatch(game,[a,b]);assert.deepEqual(gridPlane(replacement),baseline);assert.deepEqual(gridPlane(replacement,0,true),settings);assert.deepEqual(carriedItems(a),inventory);for(const wall of walls)gridWallAbsent(wall,game.area);assert.equal(game.ghasts,undefined);}finally{replacement.destroy();}
});

test('native Gridlock actual16x16 reuse preserves live Gridlock and natural Ghastly engine with world identity',async()=>{
  const{a,b,game}=await gridGame(),other=await gridGame(),Q=await ghastGame();completePreparation(Q.game);assert.equal(game.phase,'combat');assert.equal(other.game.phase,'combat');ghastReady(Q.game);for(const p of[Q.a,Q.b]){ghastFighter(p);ghastFood(p);}const qPlayer=gridSide(Q.game,[Q.a,Q.b],0),qNpc=Q.game.ghasts.npcs[0];await ghastAttack(qPlayer,qNpc);qPlayer.getCombat().reset();const attempts=[];ghastObserve=(kind,e)=>{if(kind==='prepare'&&Q.game.ghasts.npcs.includes(e.attacker))attempts.push(C.now());};
  const old=gridObject(game,'clanwars_viewing_start_darkrock',[3519,4859]),live=gridObject(other.game,'clanwars_viewing_start_darkrock',[3519,4859]),baseline=gridPlane(game.area),settings=gridPlane(game.area,0,true),liveBefore=gridPlane(other.game.area),qBefore=ghastPlane(Q.game.area,0),base=[game.area.getBaseX(),game.area.getBaseY()];core.RegionManager.loadMapFiles(3222,3218);const world=C.api.spawnNpc({id:5626,x:3222,y:3218,z:0,wanderRadius:0});assert.ok(world);fixtureNpcs.add(world);const worldDefinition=world.getDefinition(),worldAt=world.getSpawnPosition().clone(),worldClip=core.RegionManager.getClipping(3222,3218,0,null);assert.equal(world.isRegistered(),true);assert.equal(Boolean(world.__skipDefaultRespawn),false);game.finish(null);finishedMatch(game,[a,b]);const replacement=gridTemplate();try{assert.deepEqual([replacement.getBaseX(),replacement.getBaseY()],base);const fresh=gridObject({area:replacement},'clanwars_viewing_start_darkrock',[3519,4859]);assert.equal(fresh===old,false);ghastIdentity(fresh.getPrivateArea(),replacement,'replacement exact owner');ghastIdentity(replacement.resolveObject(fresh.getId(),fresh.getLocation()),fresh,'replacement native lookup');assert.deepEqual(gridPlane(replacement),baseline);assert.deepEqual(gridPlane(replacement,0,true),settings);ghastTurns=true;tick(120);assert.ok(attempts.length>=10,'other match really continued native ghast turns');assert.deepEqual(gridPlane(replacement),baseline);assert.deepEqual(gridPlane(other.game.area),liveBefore);assert.deepEqual(ghastPlane(Q.game.area,0),qBefore);ghastIdentity(core.MapObjects.getPrivateArea(other.a,live.getId(),live.getLocation()),live,'live Gridlock object preserved');assert.equal(Match.exit({player:other.a,object:old}),false);assert.equal(viewingUnit().use({player:other.a,object:old}),false);for(const p of[other.a,other.b])ghastIdentity(C.matches.get(p),other.game,'live Gridlock membership');ghastReady(Q.game);assert.equal(world.isRegistered(),true);ghastIdentity(world.getDefinition(),worldDefinition,'world shared definition unchanged');assert.equal(world.getSpawnPosition().equals(worldAt),true);assert.equal(core.RegionManager.getClipping(3222,3218,0,null),worldClip);assert.equal(Boolean(world.__skipDefaultRespawn),false);console.log('GRIDLOCK_REUSE '+JSON.stringify({base,settle:120,otherGhastNativeAttempts:attempts.length,worldIdentityPreserved:true}));}finally{replacement.destroy();}
});

// T: actual native utility producers. Loaded lazily so the inherited 288 cases
// retain their original registration set. Checkpoint locations and fixed damage
// below are supplied controls; they do not claim natural timing/RNG/render parity.
const T_POWER_ATTRIBUTE='power-of-death:until';
const T_STAVES=[
  ['StaffOfTheDead',11791,'staff_of_the_dead',7083,1228],
  ['ToxicStaffOfTheDead',12904,'toxic_staff_of_the_dead',1720,1228],
  ['StaffOfLight',22296,'staff_of_light',7967,1516],
  ['StaffOfBalance',24144,'staff_of_balance',3652,1733],
];
const T_WEAPON_BUTTONS=[(593<<16)|41,(593<<16)|57,'orbs:specbutton','orbs_nomap:specbutton','orbs_osm:specbutton','orbs_osm_nomap:specbutton'];
let tInstalled=false;
const tRegenerations=new WeakMap(),tEnergyMarks=new WeakMap();
function tRecordRegeneration(event){
  const rows=tRegenerations.get(event.player)??[];
  rows.push({cycle:C.now(),amount:Math.max(0,event.amount|0)});tRegenerations.set(event.player,rows);
}
function tExpectedEnergy(player){
  const mark=tEnergyMarks.get(player);assert.ok(mark,'native world cast bound energy checkpoint');
  return Math.min(100,mark.energy+(tRegenerations.get(player)??[]).slice(mark.index).reduce((n,row)=>n+row.amount,0));
}
function tInstall(){
  if(tInstalled)return;
  const api=PM.createApi('ClanWarsTActualSpecialProducers');
  api.onCustomEvent('combat-special:regenerate',tRecordRegeneration);
  for(const[name]of T_STAVES)require(`../plugins/combat/specials/${name}.SpecialAttack`)(api);
  require('../plugins/combat/effects/Rondache.EquipmentEffects')(api);
  require('../plugins/combat/specials/Rondache.SpecialAttack')(api);
  require('../plugins/objects/RejuvenationPool.plugin').register(api);
  require('../plugins/minigames/lms/Common.LastManStanding').init(api);
  require('../plugins/minigames/lms/Items.LastManStanding').registerAliases();
  require('../plugins/minigames/championschallenge/Common.ChampionsChallenge').init(api);
  require('../plugins/minigames/championschallenge/Rules.ChampionsChallenge').attachRules(api);
  tInstalled=true;
}
async function tEquip(player,itemId,slot=core.Equipment.WEAPON_SLOT){
  give(player,itemId,`T-${itemId}`);
  const actions=core.CacheDefinitions.getItem(itemId).inventoryActions;
  const action=actions.includes('Wield')?'Wield':'Wear';
  assert.ok(actions.includes(action),'cache declares a real native equip action');
  await nativeItem(player,itemId,action);
  assert.equal(player.getEquipment().get(slot).getId(),itemId,'native equip reached intended slot');
}
function tEffectTrace(t,p){
  const animations=[],graphics=[],events=[];
  const animation=p.performAnimation.bind(p),graphic=p.performGraphic.bind(p),emit=PM.emitSpecialAttackDisabled.bind(PM);
  t.mock.method(p,'performAnimation',value=>{animations.push([C.now(),value.getId()]);return animation(value);});
  t.mock.method(p,'performGraphic',value=>{graphics.push([C.now(),value.getId()]);return graphic(value);});
  t.mock.method(PM,'emitSpecialAttackDisabled',(player,id)=>{const result=emit(player,id);events.push({player,id,result});return result;});
  return{animations,graphics,events};
}
function tCheckpoint(game,a,b){
  for(const[p,xy]of[[a,[3293,4955,0]],[b,[3294,4955,0]]]){
    p.moveTo(game.area.at(xy));p.setNeedsPlacement(false);p.resetUpdating();AreaManager.process(p);
  }
  assert.equal(CombatFactory.canAttackByPolicy(a,b,CombatFactory.MELEE_COMBAT),CanAttackResponse.CAN_ATTACK);
}
async function tTarget(a,b){
  const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(b.getIndex(),2);
  await wire(a,frame);assert.equal(a.getCombat().getTarget(),b,'actual native opposing Attack selected');
}
function tIncoming(a,b,raw,type=core.CombatType.MELEE){
  const hit=new core.HitDamage(raw,core.HitMask.RED).setSource(a);
  CombatFactory.applyIncomingHitDamage(a,b,type,hit);
  return hit.getDamage();
}
function tQueue(a,b,raw,delay=1){
  const hit=new core.PendingHit(a,b,CombatFactory.MELEE_COMBAT,{damage:raw,rollAccuracy:false,handleAfterHitEffects:false,experience:false,delay});
  CombatFactory.addPendingHit(hit);return hit;
}
function tImpacts(n=1){for(let i=0;i<n;i++){tick();require('../dist/game/content/combat/hit/HitQueue').HitQueue.processAll(C.now());}}
async function tWorldPower(p,staff=T_STAVES[0]){
  assert.equal(C.matches.has(p),false,'world-earned means outside actual membership');
  ruleStats(p,99);await tEquip(p,staff[1]);
  const before=C.now();await nativeButton(p,'orbs:specbutton');
  const until=p.getAttribute(T_POWER_ATTRIBUTE);
  assert.equal(p.getSpecialPercentage(),0,'actual world utility drains full energy');
  assert.equal(p.isSpecialActivated(),false,'instant utility is not naturally prearmed');
  assert.equal(until,before+100,'actual dispatch starts canonical 100tick deadline');
  tEnergyMarks.set(p,{energy:p.getSpecialPercentage(),index:(tRegenerations.get(p)??[]).length});
  return until;
}

for(const mode of[0,1,16])test(`native T option1 offer invalidation resync confirmation mode${mode}`,async()=>{
  tInstall();const a=actor(true),b=actor(true);channel(a);channel(b);const calls=scriptCalls(a);
  await challenge(a,b);await challenge(b,a);
  if(mode){await click(a,'clanwars_setup:wincondition',mode*3);tick(9);}
  const session=C.negotiations.get(a),original={...session.rules};
  await click(b,'clanwars_setup:accept');assert.equal(session.accepted.has(b),true);
  await click(a,'clanwars_setup:dropdown_specialattacks',2);
  assert.equal(session.rules.specialattacks,1,'new authoritative No Staff offer');
  assert.equal(session.accepted.size,0,'real opponent acceptance invalidated');
  for(const[key,value]of Object.entries(original))if(key!=='specialattacks')assert.equal(session.rules[key],value);
  for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_specialattacks')),1);
  await click(b,'clanwars_setup:accept');assert.equal(session.accepted.has(b),false);tick(9);
  const revision=session.revision;
  for(const slot of[0,4,65534]){
    await click(a,'clanwars_setup:dropdown_specialattacks',slot);
    assert.equal(session.revision,revision);assert.equal(session.rules.specialattacks,1);
  }
  // 0xffff is the native no-slot sentinel, not an unsupported dropdown row.
  // The preserved legacy event.action=op1 fallback selects Allowed (slot1).
  const sentinel=clickFrame('clanwars_setup:dropdown_specialattacks',65535),decoded=decodeClientPackets(sentinel);
  assert.equal(decoded.length,1);assert.equal(decoded[0].slot,undefined);assert.equal(decoded[0].buttonNum,1);
  await wire(a,sentinel);assert.equal(session.rules.specialattacks,0);assert.equal(session.revision,revision+1);
  await click(a,'clanwars_setup:dropdown_specialattacks',2);assert.equal(session.rules.specialattacks,1);tick(9);
  await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');
  assert.equal(session.stage,'confirm');tick(5);
  await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');
  const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(game.rules.specialattacks,1);assert.equal(game.rules.magic,4);
  await join(a);await join(b);
  const text=calls.filter(([id])=>id===554).at(-1)[2];
  assert.match(text,/No Staff of the Dead; other permitted specials are allowed/);
  assert.match(text,/Power of Death is already unavailable while Magic is disabled/);
});

for(const staff of T_STAVES)for(const term of[0,1,2])test(`native T ${staff[0]} MagicDisabled veto special${term} all weapon inputs`,async t=>{
  tInstall();const{a,b,game}=await ruleGame({specialattacks:term});
  await tEquip(a,staff[1]);assert.equal(a.getCombatSpecial().getId(),staff[2]);
  const trace=tEffectTrace(t,a),messages=messagesOf(a);
  for(const button of T_WEAPON_BUTTONS){
    const before=resources(a),target=a.getCombat().getTarget(),effect=a.getAttribute(T_POWER_ATTRIBUTE),an=trace.animations.length,gfx=trace.graphics.length;
    await nativeButton(a,button);
    assert.equal(a.getSpecialPercentage(),100,'forbidden actual producer must not drain');
    assert.equal(a.getAttribute(T_POWER_ATTRIBUTE),effect,'no protection starts');
    assert.deepEqual(resources(a),before);assert.equal(a.getCombat().getTarget(),target);
    assert.equal(trace.animations.length,an);assert.equal(trace.graphics.length,gfx);assert.equal(a.isSpecialActivated(),false);
    assert.equal(trace.events.at(-1).player,a);assert.equal(trace.events.at(-1).id,staff[2],'canonical native selection carried through generic event');
    assert.match(messages.at(-1),term===2?/Special attacks are disabled/:/Power of Death is unavailable while Magic is disabled/);
  }
  assert.equal(messages.some(s=>s.includes('Spirits of deceased')),false);
  tCheckpoint(game,a,b);assert.equal(CombatFactory.canAttackByPolicy(a,b,CombatFactory.MELEE_COMBAT),CanAttackResponse.CAN_ATTACK,'ordinary staff melee remains legal');
  assert.notEqual(CombatFactory.canAttackByPolicy(a,b,CombatFactory.MAGIC_COMBAT),CanAttackResponse.CAN_ATTACK,'ordinary magical combat stays refused');
});

for(const staff of T_STAVES)test(`native T world ${staff[0]} effect duration refresh and unstacked damage`,async t=>{
  tInstall();const p=actor(true),attacker=actor(true);const trace=tEffectTrace(t,p),until=await tWorldPower(p,staff);
  assert.deepEqual(trace.animations.at(-1),[until-100,staff[3]]);assert.deepEqual(trace.graphics.at(-1),[until-100,staff[4]]);
  assert.equal(tIncoming(attacker,p,21),10);assert.equal(tIncoming(attacker,p,20,core.CombatType.RANGED),20);assert.equal(tIncoming(attacker,p,20,core.CombatType.MAGIC),20);
  tick(10);p.setSpecialPercentage(100);const cast=C.now();await nativeButton(p,'orbs:specbutton');
  const refreshed=p.getAttribute(T_POWER_ATTRIBUTE);assert.equal(refreshed,cast+100);assert.ok(refreshed>until);assert.equal(tIncoming(attacker,p,40),20);
  tick(refreshed-C.now()-1);assert.equal(tIncoming(attacker,p,21),10);tick();assert.equal(tIncoming(attacker,p,21),21,'exact original producer expiry');
  assert.equal(p.getAttribute(T_POWER_ATTRIBUTE),refreshed,'expiry does not invent a restoration');
});

for(const term of[0,1,2])test(`native T same staff player selects actual Rondache offhand special${term}`,async t=>{
  tInstall();const{a,b,game}=await ruleGame({specialattacks:term});await tEquip(a,11791);await tEquip(a,core.ItemIdentifiers.RONDACHE,core.Equipment.SHIELD_SLOT);
  tCheckpoint(game,a,b);await tTarget(a,b);const Effects=require('../plugins/combat/effects/Rondache.EquipmentEffects'),trace=tEffectTrace(t,a);
  const inputs=[[(593<<16)|67,1],['orbs:specbutton',2],['orbs_nomap:specbutton',2],['orbs_osm:specbutton',2],['orbs_osm_nomap:specbutton',2]];
  for(const[button,op]of inputs){
    Effects.setCharges(a,20);a.setSpecialPercentage(100);b.setHitpoints(99);const before=trace.animations.length;
    await nativeButton(a,button,op);
    assert.equal(Effects.charges(a),term===2?20:0,'real shield producer spends charges only when allowed');
    assert.equal(a.getSpecialPercentage(),100,'shield spends no weapon special energy');
    assert.equal(trace.events.at(-1).id,'rondache');
    assert.equal(trace.animations.length>before,term!==2);
    assert.equal(a.getAttribute(T_POWER_ATTRIBUTE)==null,true,'offhand never starts weapon protection');
    tImpacts(2);
  }
  Effects.setCharges(a,20);await nativeButton(a,'orbs:specbutton',1);
  assert.equal(a.getSpecialPercentage(),100);assert.equal(Effects.charges(a),20);assert.equal(trace.events.at(-1).id,'staff_of_the_dead');
});

for(const term of[0,1,2])test(`native T DragonBattleaxe and actual DDS toggle retain special${term} semantics`,async()=>{
  tInstall();const{a,b,game}=await ruleGame({specialattacks:term});await tEquip(a,core.ItemIdentifiers.DRAGON_BATTLEAXE);
  await nativeButton(a,'orbs:specbutton');assert.equal(a.getSpecialPercentage(),term===2?100:0);
  assert.equal(a.getSkillManager().getCurrentLevel(core.Skill.ATTACK),term===2?99:90);
  assert.equal(a.getSkillManager().getCurrentLevel(core.Skill.STRENGTH),term===2?99:118);
  ruleStats(a);await tEquip(a,core.ItemIdentifiers.DRAGON_DAGGER);tCheckpoint(game,a,b);await tTarget(a,b);
  await nativeButton(a,'orbs:specbutton');assert.equal(a.isSpecialActivated(),term!==2);
  assert.equal(a.getSpecialPercentage(),100,'arming ordinary DDS is not a paid attack');
  if(term!==2){
    // The existing engine-turn switch runs the actual registered DDS method.
    // Accuracy is unforced; drain/animation/target prove the ordinary swing.
    const prepared=[];ghastObserve=(kind,e)=>{if(kind==='prepare'&&e.attacker===a&&e.target===b)prepared.push(e);};
    ghastTurns=true;try{for(let n=0;n<20&&a.getSpecialPercentage()===100;n++)tick();}finally{ghastTurns=false;ghastObserve=null;}
    assert.equal(a.getSpecialPercentage(),75,'native armed DDS actually swung and paid once');
    assert.ok(prepared.length>0,'actual combat preparation reached');assert.equal(a.isSpecialActivated(),false);
  }
});

for(const term of[0,1,2])test(`native T registered LMS alias and nonproducer selections special${term}`,async t=>{
  tInstall();const{a}=await ruleGame({specialattacks:term}),alias=core.CacheDefinitions.getObjId('br_sotd');
  assert.equal(alias,23613);assert.equal(core.ItemAliases.baseOf(alias),11791,'actual LMS signature registration, not a supplied alias');
  assert.equal(core.CombatSpecial.getForWeaponId(alias).getId(),'staff_of_the_dead');
  await tEquip(a,alias);const trace=tEffectTrace(t,a);await nativeButton(a,'orbs:specbutton');
  assert.equal(a.getSpecialPercentage(),100);assert.equal(a.getAttribute(T_POWER_ATTRIBUTE)==null,true);assert.equal(trace.events.at(-1).id,'staff_of_the_dead');
  // Actual uncharged items may be worn; they must not be promoted to POD.
  for(const name of['toxic_sotd','toxic_sotd_deadman']){
    const id=core.CacheDefinitions.getObjId(name);assert.ok(id>0);assert.equal(core.CombatSpecial.getForWeaponId(id)==null,true);
    await tEquip(a,id);assert.equal(a.getCombatSpecial()==null,true);const n=trace.events.length;
    await nativeButton(a,'orbs:specbutton');assert.equal(trace.events.length,n);assert.equal(a.getSpecialPercentage(),100);
  }
  for(const name of['cert_sotd','placeholder_sotd']){const id=core.CacheDefinitions.getObjId(name);assert.ok(id>0);assert.equal(core.CombatSpecial.getForWeaponId(id)==null,true,`${name} has no invented producer`);}
});

test('native T legacy optional context default messages first answer Champions and toggle off',async t=>{
  tInstall();const{a,b,game}=await ruleGame({specialattacks:0});await tEquip(a,11791);
  assert.equal(PM.emitSpecialAttackDisabled(a),null,'contextless legacy query invents no selected identity');
  const other=await ruleGame({specialattacks:2});
  assert.match(PM.emitSpecialAttackDisabled(other.a),/Special attacks are disabled/,'legacy all-special veto still answers');
  const p=actor(true),Gallery=require('../plugins/minigames/championschallenge/Gallery.ChampionsChallenge');
  ruleStats(p);await tEquip(p,11791);
  const sessionOf=Gallery.sessionOf.bind(Gallery),session={challenge:{rule:{special:true}},inArena:()=>true};
  // Supplied Champions session tests its actual unchanged hook consumer only;
  // it does not claim native admission to a Champions basement.
  const observer=t.mock.method(Gallery,'sessionOf',player=>player===p?session:sessionOf(player));
  assert.match(PM.emitSpecialAttackDisabled(p,'staff_of_the_dead'),/not allowed to use Special Attacks/);
  assert.match(PM.emitSpecialAttackDisabled(p),/not allowed to use Special Attacks/);
  p.getPacketSender().sendInterfaceRemoval();await nativeButton(p,'orbs:specbutton');assert.equal(p.getSpecialPercentage(),100,'actual activation obeys unchanged Champions hook with supplied session');assert.equal(p.getAttribute(T_POWER_ATTRIBUTE)==null,true);
  p.getPacketSender().sendInterfaceRemoval();observer.mock.restore();
  const api=PM.createApi('ClanWarsTLegacyOrdering');let enabled=true,later=0;
  api.onSpecialAttackDisabled(event=>{if(enabled&&event.player===p)event.disabled=true;});
  api.onSpecialAttackDisabled(event=>{if(enabled&&event.player===p){later++;event.message='must not replace first answer';event.disabled=true;}});
  try{assert.equal(PM.emitSpecialAttackDisabled(p),"You can't use special attacks here.");assert.equal(later,0);}finally{enabled=false;}
  // Arm a real DDS outside, then enter rule2: existing preparation disarms it.
  await tEquip(a,core.ItemIdentifiers.DRAGON_DAGGER);await nativeButton(a,'orbs:specbutton');assert.equal(a.isSpecialActivated(),true);
  // Preserve the existing toggle-off exception, using the actual rule2 hook:
  // this supplied rules view is a hook control, not a naturally armed rule2 route.
  const old=game.rules;try{game.rules={...old,specialattacks:2};await nativeButton(a,'orbs:specbutton');assert.equal(a.isSpecialActivated(),false);}finally{game.rules=old;}
  assert.equal(a.getSpecialPercentage(),100);assert.equal(C.matches.get(b),game);
});

async function tLateGame(term){
  tInstall();const a=actor(true),b=actor(true),late=actor(true);for(const p of[a,b,late])ruleStats(p,99);
  channel(a,[late]);channel(b);const game=await negotiate(a,b,2,1,{specialattacks:term});await join(a);await join(b);completePreparation(game);
  const until=await tWorldPower(late);await join(late);
  assert.equal(C.matches.get(late),game);assert.equal(late.getAttribute(T_POWER_ATTRIBUTE),until);assert.ok(until>C.now(),'genuine late entry has positive remaining world-earned duration');
  assert.equal(late.getSpecialPercentage(),0,'entry did not refund utility energy');
  return{a,b,late,game,until};
}

for(const term of[0,1,2])test(`native T first entry 200tick preparation expires world protection special${term}`,async()=>{
  tInstall();const a=actor(true),b=actor(true);channel(a);channel(b);ruleStats(b,99);
  // Earn before negotiation, then preserve exactly that timestamp through entry.
  const until=await tWorldPower(a),game=await negotiate(a,b,2,1,{specialattacks:term});await join(a);await join(b);
  assert.equal(a.getAttribute(T_POWER_ATTRIBUTE),until);assert.equal(game.phase,'staging');
  const lines=messagesOf(a);await nativeButton(a,'orbs:specbutton');assert.equal(a.getSpecialPercentage(),tExpectedEnergy(a),'staging veto allows only actual natural regeneration');assert.match(lines.at(-1),term===2?/Special attacks are disabled/:/Power of Death is unavailable/);assert.equal(a.getAttribute(T_POWER_ATTRIBUTE),until);
  completePreparation(game);assert.ok(C.now()>=until);assert.equal(tIncoming(b,a,20),20,'normal preparation outlasts world buff');
  assert.equal(a.getAttribute(T_POWER_ATTRIBUTE),until);assert.equal(a.getSpecialPercentage(),tExpectedEnergy(a),'preparation allows only canonical regeneration');game.finish(null);tick(2);assert.equal(a.getAttribute(T_POWER_ATTRIBUTE),until);assert.equal(a.getSpecialPercentage(),tExpectedEnergy(a),'finish did not reset energy');
});

for(const term of[0,1,2])test(`native T positive late carry safe death jail viewing return and finish special${term}`,async()=>{
  const{a,b,late,game,until}=await tLateGame(term);tCheckpoint(game,b,late);
  const originalInventory=contents(late.getInventory()),originalEquipment=contents(late.getEquipment());
  const hp=late.getHitpoints();tQueue(b,late,20);tImpacts(1);assert.equal(late.getHitpoints(),hp-10,'actual pending incoming melee applies carried mitigation');
  assert.equal(late.getAttribute(T_POWER_ATTRIBUTE),until);
  late.setHitpoints(99);
  // Three simultaneously prepared capped99 hits each reduce to49. A single
  // capped lethal hit cannot kill through 50% protection. Damage is controlled.
  for(let n=0;n<3;n++)tQueue(b,late,99);tImpacts(1);assert.equal(late.getHitpoints(),0);
  tick(8);assert.equal(game.jailed.has(late),true);assert.equal(late.isSpecialActivated(),false);
  assert.equal(late.getAttribute(T_POWER_ATTRIBUTE),until);assert.deepEqual(contents(late.getInventory()),originalInventory);assert.deepEqual(contents(late.getEquipment()),originalEquipment);
  assert.equal(late.getSpecialPercentage(),tExpectedEnergy(late),'safe death changed no energy beyond actual regeneration');
  const lines=messagesOf(late);await nativeButton(late,'orbs:specbutton');assert.equal(late.getSpecialPercentage(),tExpectedEnergy(late));assert.match(lines.at(-1),term===2?/Special attacks are disabled/:/Power of Death is unavailable/);assert.equal(late.getAttribute(T_POWER_ATTRIBUTE),until);
  await openView(late,game);assert.equal(viewingUnit().active.has(late),true);assert.equal(late.getAttribute(T_POWER_ATTRIBUTE),until);
  await click(late,'clanwars_view:ne');await wire(late,Buffer.from([VIEW_CLOSE_PACKET]));assert.equal(viewingUnit().active.has(late),false);
  await jailExit(late,game);assert.equal(game.fighters.has(late),true);assert.equal(late.getAttribute(T_POWER_ATTRIBUTE),until);assert.equal(late.getSpecialPercentage(),tExpectedEnergy(late));
  game.finish(null);tick(2);for(const p of[a,b,late])lobby(p);
  assert.equal(late.getAttribute(T_POWER_ATTRIBUTE),until);assert.equal(late.getSpecialPercentage(),tExpectedEnergy(late),'finish/exit allows only actual natural regeneration, no refund/restore');
  console.log('T_CARRY '+JSON.stringify({term,deadline:until,after:C.now(),remaining:until-C.now(),safeDeath:true,originalEquipment:true}));
});

for(const term of[0,1,2])test(`native T real DDS prearm entry late entry swap and safe return special${term}`,async()=>{
  tInstall();const a=actor(true),b=actor(true),late=actor(true);for(const p of[a,b,late])ruleStats(p,99);channel(a,[late]);channel(b);
  const game=await negotiate(a,b,2,1,{specialattacks:term});
  for(const p of[a,late]){await tEquip(p,core.ItemIdentifiers.DRAGON_DAGGER);await nativeButton(p,'orbs:specbutton');assert.equal(p.isSpecialActivated(),true,'genuine world DDS prearm');}
  await join(a);await join(b);assert.equal(a.isSpecialActivated(),term!==2);assert.equal(a.getSpecialPercentage(),100);
  completePreparation(game);await join(late);assert.equal(late.isSpecialActivated(),term!==2);assert.equal(late.getSpecialPercentage(),100);
  await tEquip(late,11791);assert.equal(late.isSpecialActivated(),false,'native weapon swap clears real prearm');
  await tEquip(late,core.ItemIdentifiers.DRAGON_DAGGER);await nativeButton(late,'orbs:specbutton');assert.equal(late.isSpecialActivated(),term!==2);
  await lethalMelee(b,late,game);tick(8);assert.equal(game.jailed.has(late),true);assert.equal(late.isSpecialActivated(),false);
  await jailExit(late,game);assert.equal(game.fighters.has(late),true);assert.equal(late.isSpecialActivated(),false);
});

test('native T carried deadline follows actual variant swaps zero damage no staff hit and native pool',async()=>{
  tInstall();const p=actor(true),other=actor(true);const until=await tWorldPower(p);
  for(const staff of T_STAVES){await tEquip(p,staff[1]);assert.equal(p.getAttribute(T_POWER_ATTRIBUTE),until);assert.equal(tIncoming(other,p,21),10);}
  await tEquip(p,core.ItemIdentifiers.DRAGON_DAGGER);assert.equal(p.getAttribute(T_POWER_ATTRIBUTE),until,'unequip alone does not clear');
  assert.equal(tIncoming(other,p,0),0);assert.equal(p.getAttribute(T_POWER_ATTRIBUTE),until,'zero damage does not clear');
  assert.equal(tIncoming(other,p,8),8);assert.equal(p.getAttribute(T_POWER_ATTRIBUTE)==null,true,'positive hit without staff clears');
  await tEquip(p,11791);assert.equal(tIncoming(other,p,20),20,'re-equipping cannot resurrect');
  p.setSpecialPercentage(100);await nativeButton(p,'orbs:specbutton');assert.ok(p.getAttribute(T_POWER_ATTRIBUTE)>C.now());
  // Disclosed seeded world pool; actual cache action and native object dispatcher.
  const id=core.CacheDefinitions.getLocId('poh_pool_regeneration');assert.equal(id,29241);
  core.RegionManager.loadMapFiles(3222,3218);p.moveTo(new core.Location(3222,3218,0));p.getCombat().reset();other.getCombat().reset();tick(2);
  const pool=new core.GameObject(id,new core.Location(3223,3218,0),10,0,null);core.ObjectManager.register(pool,true);tick();
  try{
    assert.equal(pool.getDefinition().getName(),'Ornate pool of Rejuvenation');const op=pool.getDefinition().getInteractions().indexOf('Drink')+1;assert.ok(op>0);
    const at=pool.getLocation();new(require('../dist/net/packet/impl/ObjectActionPacketListener').ObjectActionPacketListener)().executeAction(p,id,at.getX(),at.getY(),op);tick(8);
    assert.equal(p.getAttribute(T_POWER_ATTRIBUTE)==null,true,'real pool producer clears protection');assert.equal(p.getSpecialPercentage(),100);
  }finally{core.ObjectManager.deregister(pool,true);}
});

for(const boundary of['expiry','swap','finish','leave'])test(`native T queued final impact uses canonical current ${boundary} state`,async()=>{
  const{b,late,game,until}=await tLateGame(0);tCheckpoint(game,b,late);late.setHitpoints(99);
  if(boundary==='expiry')tick(until-C.now()-1);
  const queued=tQueue(b,late,20,1);assert.equal(queued.getHits()[0].getDamage(),20,'unmitigated controlled roll queued before defensive reaction');
  if(boundary==='swap')await tEquip(late,core.ItemIdentifiers.DRAGON_DAGGER);
  else if(boundary==='finish')game.finish(null);
  else if(boundary==='leave')Match.leave({player:late});
  // Explicit pre-placement checkpoint: process a due hit while exit's actual
  // moveTo placement flag is still set. This proves that finite ordering only;
  // it does not assert global cancellation of every post-exit queued impact.
  if(boundary==='finish'||boundary==='leave'){assert.equal(late.isNeedsPlacement(),true);core.World.processCycle++;require('../dist/game/content/combat/hit/HitQueue').HitQueue.processAll(C.now());}
  else tImpacts(1);
  if(boundary==='expiry'||boundary==='swap')assert.equal(late.getHitpoints(),79,'impact sees expiry/current nonstaff rather than queue-time protection');
  else assert.equal(late.getHitpoints(),99,'actual pending-placement guard drops this due impact');
  assert.equal(late.getAttribute(T_POWER_ATTRIBUTE),boundary==='swap'?null:until);
  assert.equal(late.getSpecialPercentage(),tExpectedEnergy(late),'only actual natural regeneration, no match lifecycle refund');
});

for(const term of[0,1,2])test(`native T weapon fallback shield and invalid nonutility offhand special${term}`,async t=>{
  tInstall();const{a,b,game}=await ruleGame({specialattacks:term});
  await tEquip(a,core.ItemIdentifiers.RONDACHE,core.Equipment.SHIELD_SLOT);await tEquip(a,12902);
  assert.equal(core.CombatSpecial.getForWeaponId(12902),null);assert.equal(a.getCombatSpecial().getId(),'rondache','real assign falls back to worn shield');
  tCheckpoint(game,a,b);await tTarget(a,b);const trace=tEffectTrace(t,a),Effects=require('../plugins/combat/effects/Rondache.EquipmentEffects');
  Effects.setCharges(a,20);await nativeButton(a,(593<<16)|57);
  assert.equal(Effects.charges(a),term===2?20:0);assert.equal(a.getSpecialPercentage(),100);assert.equal(trace.events.at(-1).id,'rondache');tImpacts(2);
  await tEquip(a,11791);await tEquip(a,core.ItemIdentifiers.BRONZE_KITESHIELD,core.Equipment.SHIELD_SLOT);
  const n=trace.events.length;await nativeButton(a,'orbs:specbutton',2);
  assert.equal(trace.events.length,n,'real shield with no utility is rejected before hook');assert.equal(a.getSpecialPercentage(),100);assert.equal(a.getAttribute(T_POWER_ATTRIBUTE)==null,true);
  const Listener=require('../dist/net/packet/impl/EquipPacketListener').EquipPacketListener;
  const children=Array.from({length:14},(_,n)=>15+n).filter(child=>Listener.resolveEquipmentSlot(387,child)===core.Equipment.WEAPON_SLOT);
  assert.equal(children.length,1);const before=resources(a),events=trace.events.length;
  await nativeButton(a,(387<<16)|children[0],2);
  assert.deepEqual(resources(a),before);assert.equal(trace.events.length,events,'worn item operation has no invented staff activation');
});

test('native T world affordability is unchanged and context IDs distinguish real weapon from shield',async t=>{
  tInstall();const p=actor(true);ruleStats(p);await tEquip(p,11791);const trace=tEffectTrace(t,p),lines=messagesOf(p);p.setSpecialPercentage(99);
  const before=resources(p);await nativeButton(p,'orbs:specbutton');assert.deepEqual(resources(p),before);assert.equal(p.getAttribute(T_POWER_ATTRIBUTE)==null,true);assert.equal(trace.animations.length,0);assert.equal(trace.graphics.length,0);assert.match(lines.at(-1),/not enough power|enough power left/);
  assert.equal(trace.events.at(-1).id,'staff_of_the_dead');assert.equal(trace.events.at(-1).result,null);
  p.setSpecialPercentage(100);await nativeButton(p,'orbs:specbutton');assert.equal(p.getSpecialPercentage(),0);assert.ok(p.getAttribute(T_POWER_ATTRIBUTE)>C.now());
});

// U: native Oddskull objective. Scene checkpoints, controlled damage and save-copy
// inspection are named separately from the ordinary decoded walk/Take/equip inputs.
const U_HOME=[3293,4959,0],U_TOKEN='clan-wars:oddskull-token';
const uSkull=p=>p.getEquipment().get(core.Equipment.WEAPON_SLOT);
const uIssued=p=>[...p.getInventory().getItems(),...p.getEquipment().getItems()].filter(i=>typeof i?.getMetaValue(U_TOKEN)==='string');
function uNpc(game){
  assert.equal(game.phase,'combat','objective start must survive exact middle geometry/definitions');
  const state=game.oddskull;assert.ok(state,'real match owns an objective');assert.equal(state.kind,'ground');
  const npc=state.npc;assert.ok(npc);assert.equal(npc.isRegistered(),true);assert.equal(core.World.getNpcs().get(npc.getIndex()),npc);
  assert.equal(npc.getArea(),game.area);assert.equal(npc.getPrivateArea(),game.area);assert.equal(npc.__skipDefaultRespawn,true);
  assert.equal(npc.getId(),4187);assert.equal(npc.getCurrentDefinition().getName(),'<col=ff9040>Oddskull</col>');
  assert.equal(npc.getCurrentDefinition().getActions()[0],'Take');assert.equal(game.area.getNpcs().filter(n=>n.getId()===4187).length,1);
  return npc;
}
async function uGame(mode=21,terms=null,late=false){
  const a=actor(true),b=actor(true),ally=late?actor(true):null;for(const p of[a,b,ally].filter(Boolean))ruleStats(p,99);
  channel(a,ally?[ally]:[]);channel(b);const game=await negotiate(a,b,null,mode,terms);await join(a);await join(b);
  assert.equal(game.oddskull,undefined,'objective absent throughout preparation');completePreparation(game);uNpc(game);
  return{a,b,ally,game};
}
function uCheckpoint(p,game,source){p.moveTo(game.area.at(source));p.setNeedsPlacement(false);p.resetUpdating();AreaManager.process(p);}
function uTakeFrame(npc){
  // Client NPC_OPTION_1=76: modifier byte, then Reader.shortAddLE HIGH/LOW-128.
  const frame=Buffer.from([76,0,(npc.getIndex()>>8)&255,(npc.getIndex()+128)&255]);
  const decoded=decodeClientPackets(frame);assert.equal(decoded.length,1);assert.equal(decoded[0].type,'npc_option');
  assert.equal(decoded[0].index,npc.getIndex());assert.equal(decoded[0].clickType,1);return frame;
}
async function uTake(p,npc){
  const at=C.now();await dispatchFrameNow(p,uTakeFrame(npc));core.TaskManager.processWalkTo(p.getIndex());
  assert.equal(C.now(),at,'native dispatch/reach callback does not advance the cadence clock');
}
async function uRemove(p){
  const Listener=require('../dist/net/packet/impl/EquipPacketListener').EquipPacketListener;
  const children=Array.from({length:14},(_,n)=>15+n).filter(n=>Listener.resolveEquipmentSlot(387,n)===core.Equipment.WEAPON_SLOT);
  assert.equal(children.length,1);await nativeButton(p,(387<<16)|children[0]);
}
function uHeld(p,game){
  assert.equal(game.oddskull.kind,'held');assert.equal(game.oddskull.holder,p);assert.equal(uSkull(p).getId(),13195);
  assert.equal(uSkull(p).getAmount(),1);assert.equal(uSkull(p).getDefinition().isDoubleHanded(),true);
  assert.equal(uSkull(p).getMetaValue(U_TOKEN),game.oddskull.token);assert.equal(uSkull(p).isUnbankable(),true);
  assert.equal(uSkull(p).isUntradeable(),true);assert.equal(uIssued(p).length,1);assert.equal(game.oddskull.npc,null);
  assert.equal(p.getEquipment().get(core.Equipment.SHIELD_SLOT).getId(),-1);
}
function uNoExport(game,players){
  finishedMatch(game,players);assert.equal(game.oddskull.kind,'retired');assert.equal(game.oddskull.npc,null);
  assert.equal(core.World.getAddNPCQueue().some(n=>n.getArea()===game.area),false);
  assert.equal([...core.World.getNpcs()].some(n=>n?.getArea()===game.area),false);
  for(const p of players){assert.equal(uIssued(p).length,0);for(const name of['clanwars_points_1','clanwars_points_2'])assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(name)),0);}
}
for(const mode of[21,22,23])test(`native U mode${mode} offer resync crossproduct confirmation and valid0-4 controls`,async()=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const calls=scriptCalls(a);await challenge(a,b);await challenge(b,a);
  const session=C.negotiations.get(a);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);
  await click(b,'clanwars_setup:wincondition',mode*3);assert.equal(session.rules.wincondition,mode,'native Oddskull selection reaches authoritative offer');
  assert.equal(session.accepted.size,0);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),false);tick(9);
  const rev=session.revision;for(const slot of[0,6,9,12,15,18,21,24,27,33,36,39]){await click(a,'clanwars_setup:arena',slot);assert.equal(session.rules.arena,1);assert.equal(session.revision,rev);}
  for(const slot of[1,2,27,42,45,72,65534]){await click(a,'clanwars_setup:wincondition',slot);assert.equal(session.rules.wincondition,mode);assert.equal(session.revision,rev);}
  await click(a,'clanwars_setup:stragglers',3);assert.equal(session.rules.stragglers,0);assert.equal(session.revision,rev);
  for(const m of[0,4]){await click(a,'clanwars_setup:wincondition',m*3);assert.equal(session.rules.wincondition,m,'existing mode is not an invalid special-choice slot');}
  await click(a,'clanwars_setup:arena',6);assert.equal(session.rules.arena,2);const r=session.revision;
  await click(a,'clanwars_setup:wincondition',mode*3);assert.equal(session.rules.wincondition,4);assert.equal(session.revision,r);
  await click(a,'clanwars_setup:arena',3);await click(a,'clanwars_setup:wincondition',mode*3);tick(9);
  for(const p of[a,b]){assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_wincondition')),mode);assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_arena')),1);}
  await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');
  assert.ok(calls.some(([id,...args])=>id===554&&args.some(v=>typeof v==='string'&&v.includes('Skull points')&&v.includes('60 seconds'))));
  tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');const game=C.channelGames.get(C.channel(a).key);assert.ok(game);await join(a);await join(b);assert.equal(game.rules.wincondition,mode);
});
for(const [mode,target]of[[21,100],[22,300],[23,500]])test(`native U mode${mode} exact firstaward cadence independent kills and complete target${target}`,async()=>{
  const{a,b,game}=await uGame(mode);const npc=uNpc(game);assert.deepEqual(position(npc),positionAt(game,U_HOME));
  assert.deepEqual(game.points,[0,0]);assert.deepEqual(game.kills,[0,0]);
  // Actual walk from genuine assigned landing; Take's ordinary route reaches the native NPC.
  await ghastWalk(a,game,[3293,4958]);const took=C.now();await uTake(a,npc);uHeld(a,game);
  assert.equal(game.oddskull.nextAward,took+4);assert.equal(npc.isRegistered(),false);tick(3);assert.deepEqual(game.points,[0,0]);tick();
  const side=game.members.get(a);assert.equal(game.points[side],3);assert.deepEqual(game.kills,[0,0]);
  for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId(`clanwars_points_${side+1}`)),3);
  game.score(1-side);assert.equal(game.kills[1-side],1);assert.equal(game.points[1-side],0,'real death statistic never becomes Skull points');
  const awards=Math.ceil(target/3);for(let n=1;n<awards;n++){assert.equal(game.phase,'combat');tick(4);}
  assert.equal(game.points[side],Math.ceil(target/3)*3);uNoExport(game,[a,b]);
  console.log('U_TARGET '+JSON.stringify({mode,target,actual:game.points[side],first:took+4,awards,ordinaryWalkTake:true}));
});
for(const side of[0,1])test(`native U side${side} Take approach both-hands refusal full inventory and incoming combat`,async()=>{
  const{a,b,game}=await uGame();const p=[a,b].find(p=>game.members.get(p)===side),other=p===a?b:a,npc=uNpc(game),lines=messagesOf(p);
  assert.deepEqual(position(p),positionAt(game,game.layout.landings[side]));await ghastWalk(p,game,side?[3293,4960]:[3293,4958]);
  await tEquip(p,core.ItemIdentifiers.BRONZE_SCIMITAR);const before=resources(p);await uTake(p,npc);assert.deepEqual(resources(p),before);assert.equal(game.oddskull.npc,npc);assert.match(lines.at(-1),/both hands free/);
  await uRemove(p);assert.equal(p.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(),-1);
  await tEquip(p,core.ItemIdentifiers.BRONZE_KITESHIELD,core.Equipment.SHIELD_SLOT);await uTake(p,npc);assert.equal(game.oddskull.npc,npc);
  const Listener=require('../dist/net/packet/impl/EquipPacketListener').EquipPacketListener;
  const child=Array.from({length:14},(_,n)=>15+n).find(n=>Listener.resolveEquipmentSlot(387,n)===core.Equipment.SHIELD_SLOT);assert.ok(child);await nativeButton(p,(387<<16)|child);
  p.getInventory().resetItems();for(let slot=0;slot<28;slot++)p.getInventory().setItem(slot,new core.Item(core.ItemIdentifiers.COINS,slot+1,{slot}));
  const inventory=contents(p.getInventory());p.setSpecialActivated(true);p.setFollowing(other);await uTake(p,npc);uHeld(p,game);assert.equal(p.isSpecialActivated(),false);assert.equal(p.getFollowing(),null);assert.deepEqual(contents(p.getInventory()),inventory);
  uCheckpoint(other,game,side?[3294,4960,0]:[3294,4958,0]);assert.equal(game.area.canAttack(other,p,CombatFactory.MELEE_COMBAT),true);assert.equal(game.area.canAttack(p,other,CombatFactory.MELEE_COMBAT),false);assert.match(lines.at(-1),/hands full of skull/);
  assert.equal(game.area.canAttack(other,p,{type:()=>core.CombatType.MAGIC}),false);assert.equal(game.area.canAttack(other,p,{type:()=>core.CombatType.RANGED}),false);
  const hit=tQueue(other,p,10);tImpacts(2);assert.equal(hit.getHits()[0].getDamage(),10);assert.equal(p.getHitpoints(),89,'controlled real incoming queued melee settles while carrying');uHeld(p,game);
  await uRemove(p);uNpc(game);assert.equal(uIssued(p).length,0);assert.deepEqual(contents(p.getInventory()),inventory,'manual release requires no free inventory slot');
});

test('native U manual release reset ground deadline home return and stale Take identity',async t=>{
  const{a,b,game}=await uGame();uCheckpoint(a,game,[3293,4958,0]);let npc=uNpc(game);await uTake(a,npc);uHeld(a,game);tick(3);
  const firstRelease=C.now();await uRemove(a);npc=uNpc(game);const first=game.oddskull.returnAt;assert.equal(first,firstRelease+100,'return anchors to release dispatch, before wire advances three ticks');const points=game.points.slice();
  await ghastWalk(a,game,[3294,4958]);assert.equal(Math.abs(a.getLocation().getX()-npc.getLocation().getX())+Math.abs(a.getLocation().getY()-npc.getLocation().getY()),1,'ordinary walk reaches a cardinal edge after overlapping release');
  await uTake(a,npc);uHeld(a,game);assert.equal(game.oddskull.returnAt,null);const start=C.now();assert.equal(game.oddskull.nextAward,start+4);tick(3);assert.deepEqual(game.points,points);tick();assert.equal(game.points[game.members.get(a)],points[game.members.get(a)]+3);
  const released=C.now();await uRemove(a);npc=uNpc(game);const deadline=game.oddskull.returnAt;assert.equal(deadline,released+100);assert.ok(deadline>first);await ghastWalk(a,game,[3293,4958]);await tEquip(a,core.ItemIdentifiers.BRONZE_SCIMITAR);const lines=messagesOf(a);await uTake(a,npc);assert.match(lines.at(-1),/both hands free/);assert.equal(game.oddskull.returnAt,deadline,'failed occupied-hand Take cannot reset ground timer');
  await uRemove(a);assert.equal(a.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(),-1,'due Take has free hands and would otherwise acquire the dropped actor');assert.equal(game.oddskull.returnAt,deadline);
  while(C.now()<released+99)tick();assert.equal(C.now(),released+99);assert.equal(game.oddskull.npc,npc,'no return at release+99');
  const movement=a.getMovementQueue(),walk=movement.walkToEntity;let oldCallback;
  const capture=t.mock.method(movement,'walkToEntity',function(target,runnable,...args){if(target===npc)oldCallback=runnable;return walk.call(this,target,runnable,...args);});
  // Advance only the clock: the real decoded Take runs before the ordinary due-tick service.
  core.World.processCycle++;assert.equal(C.now(),released+100);assert.equal(game.oddskull.npc,npc);await uTake(a,npc);
  capture.mock.restore();assert.equal(typeof oldCallback,'function','capture forwards the real due Take route without replacing its callback');
  const home=uNpc(game);assert.notEqual(home,npc);assert.equal(npc.isRegistered(),false);assert.deepEqual(position(home),positionAt(game,U_HOME));assert.equal(game.oddskull.returnAt,null);assert.equal(uIssued(a).length,0,'due return wins before Take on the old dropped actor');
  // Explicit delayed invocation of the captured old-actor closure, not a NEW wire click
  // that legitimately identifies the current actor if World reuses the numeric index.
  oldCallback();assert.equal(game.oddskull.npc,home,'captured retired actor callback cannot issue a skull');assert.equal(uIssued(a).length,0);
  tick(105);assert.equal(game.oddskull.npc,home,'home has no return deadline');assert.ok(start<deadline);
});

test('native U both contenders resolve one actor; enemy retake earns no partial interval',async()=>{
  const{a,b,game}=await uGame();uCheckpoint(a,game,[3293,4958,0]);uCheckpoint(b,game,[3294,4959,0]);const npc=uNpc(game);
  await dispatchFrameNow(a,uTakeFrame(npc));await dispatchFrameNow(b,uTakeFrame(npc));core.TaskManager.processWalkTo(a.getIndex());core.TaskManager.processWalkTo(b.getIndex());
  assert.equal(uIssued(a).length+uIssued(b).length,1);const holder=game.oddskull.holder,other=holder===a?b:a;uHeld(holder,game);tick(3);assert.deepEqual(game.points,[0,0]);
  await uRemove(holder);const dropped=uNpc(game);await ghastWalk(other,game,[3294,4958]);assert.equal(Math.abs(other.getLocation().getX()-dropped.getLocation().getX())+Math.abs(other.getLocation().getY()-dropped.getLocation().getY()),1,'enemy reaches a cardinal edge before retake');await uTake(other,dropped);uHeld(other,game);assert.equal(game.oddskull.nextAward,C.now()+4);const score=game.points.slice();tick(3);assert.deepEqual(game.points,score);tick();assert.equal(game.points[game.members.get(other)],score[game.members.get(other)]+3);
});

for(const slot of[core.Equipment.WEAPON_SLOT,core.Equipment.SHIELD_SLOT])test(`native U hand swap slot${slot} releases one NPC and preserves actual incoming gear`,async()=>{
  const{a,b,game}=await uGame();uCheckpoint(a,game,[3293,4958,0]);await uTake(a,uNpc(game));uHeld(a,game);
  const id=slot===core.Equipment.WEAPON_SLOT?core.ItemIdentifiers.BRONZE_SCIMITAR:core.ItemIdentifiers.BRONZE_KITESHIELD;
  await tEquip(a,id,slot);assert.equal(a.getEquipment().get(slot).getId(),id);assert.deepEqual(a.getEquipment().get(slot).getMeta(),{qa:`T-${id}`});uNpc(game);assert.equal(uIssued(a).length,0);
});

test('native U unexpected inventory token Drop traverses actual widget canUse and canonical drop policy',async t=>{
  const{a,b,game}=await uGame();uCheckpoint(a,game,[3293,4958,0]);await uTake(a,uNpc(game));uHeld(a,game);
  const item=uSkull(a).clone();a.getEquipment().setItem(core.Equipment.WEAPON_SLOT,new core.Item(-1,0));a.getInventory().setItem(7,item);
  give(a,core.ItemIdentifiers.COINS,'U-drop-preserves-property');const inventory=contents(a.getInventory());
  const ground=core.World.getItems().slice(),calls=[],emit=PM.emitItemDropPolicy.bind(PM);t.mock.method(PM,'emitItemDropPolicy',e=>{calls.push(e);return emit(e);});
  const {MAIN_INVENTORY_WIDGET_UID}=require('../dist/net/protocol/ClientProtocol');const actions=core.CacheDefinitions.getItem(13195).inventoryActions,index=actions.indexOf('Drop');assert.ok(index>=0);
  const {ClientPacketId}=require('../dist/net/protocol/NativeClientPackets');const op=[2,3,4,6,7][index],frame=Buffer.alloc(9);frame[0]=ClientPacketId[`IF_BUTTON${op}`];frame.writeInt32BE(MAIN_INVENTORY_WIDGET_UID,1);frame.writeUInt16BE(7,5);frame.writeUInt16BE(13195,7);
  // Matches outgoing/widgets.ts writeInt/writeShort/writeShort and ClientProtocol's IF_BUTTON reader.
  const decoded=decodeClientPackets(frame);assert.equal(decoded.length,1);assert.equal(decoded[0].type,'widget_action');assert.equal(decoded[0].widgetId,MAIN_INVENTORY_WIDGET_UID);assert.equal(decoded[0].slot,7);assert.equal(decoded[0].itemId,13195);assert.equal(decoded[0].buttonNum,op);
  const {ItemActionPacketListener}=require('../dist/net/packet/impl/ItemActionPacketListener');
  assert.deepEqual(ItemActionPacketListener.resolveInventoryWidgetAction(13195,op),{optionIndex:index+1,option:'Drop'});
  await wire(a,frame);assert.equal(calls.length,1,'native Drop reached canonical policy instead of early canUse consumption');assert.equal(calls[0].handled,true);assert.equal(calls[0].slot,7);assert.equal(calls[0].itemId,13195);assert.equal(uIssued(a).length,0);const npc=uNpc(game);assert.deepEqual(core.World.getItems(),ground,'no ordinary floor item accompanies owned NPC');
  inventory[7]={id:-1,n:0,meta:null};assert.deepEqual(contents(a.getInventory()),inventory,'only issued property is consumed');
  await wire(a,frame);assert.equal(calls.length,1,'stale click has no carried item to drop');assert.equal(uNpc(game),npc);assert.deepEqual(core.World.getItems(),ground);
});

for(const term of[0,1,2])test(`native U safe death jail delayed return late join and no export special${term}`,async()=>{
  const{a,b,ally,game}=await uGame(21,{specialattacks:term,rejoiningdelay:1},true);uCheckpoint(a,game,[3293,4958,0]);await uTake(a,uNpc(game));uHeld(a,game);
  give(a,core.ItemIdentifiers.COINS,'U-user-property');const inventory=contents(a.getInventory()),eq=contents(a.getEquipment()).map((i,n)=>n===core.Equipment.WEAPON_SLOT?{id:-1,n:0,meta:null}:i);
  await lethalMelee(b,a,game,false,[[3294,4958,0],[3293,4958,0]],null,true);const before=game.points.slice();game.tick();assert.deepEqual(game.points,before,'pre-dying zero HP invalidates scoring');uNpc(game);tick(6);
  assert.equal(game.jailed.has(a),true);assert.equal(uIssued(a).length,0);assert.deepEqual(contents(a.getInventory()),inventory);assert.deepEqual(contents(a.getEquipment()),eq);assert.equal(game.kills[game.members.get(b)],1);
  const until=game.returnAt.get(a.getLongUsername());assert.equal(until>C.now(),true);assert.equal(game.rejoin(a),false);await join(ally);assert.equal(game.fighters.has(ally),true,'normal late admission shares existing roster');
  while(C.now()<until)tick();await jailExit(a,game);assert.equal(game.fighters.has(a),true);assert.equal(game.jailed.has(a),false);assert.equal(uIssued(a).length,0);
  game.finish(null);uNoExport(game,[a,b,ally]);assert.deepEqual(contents(a.getInventory()),inventory);
});

for(const route of['leave','logout','channel','finish'])test(`native U held objective ${route} retires or drops before ownership removal`,async()=>{
  const{a,b,ally,game}=await uGame(21,null,true);await join(ally);uCheckpoint(a,game,[3293,4958,0]);await uTake(a,uNpc(game));uHeld(a,game);const at=position(a);
  if(route==='leave')Match.leave({player:a});
  else if(route==='logout')PM.emitPlayerLogout({player:a,username:a.getUsername()});
  else if(route==='channel'){FC.leave(a,false);assert.equal(C.channel(a),null);game.tick();}
  else game.finish(null);
  assert.equal(uIssued(a).length,0);assert.equal(C.matches.has(a),false);
  if(route==='finish'){uNoExport(game,[a,b,ally]);return;}
  const npc=uNpc(game);assert.deepEqual(position(npc),at);assert.equal(game.oddskull.holder,null);assert.deepEqual(game.points,[0,0]);
  game.finish(null);uNoExport(game,[b,ally]);
});

test('native U copied save omits issued token without live mutation and login removes only stale issued property',async()=>{
  const{a,b,game}=await uGame();uCheckpoint(a,game,[3293,4958,0]);await uTake(a,uNpc(game));uHeld(a,game);
  give(a,core.ItemIdentifiers.COINS,'U-keep-property');const before=resources(a),save=PlayerSave.fromPlayer(a);
  assert.equal(save.getEquipment()[core.Equipment.WEAPON_SLOT].getId(),-1);assert.equal(save.getInventory().some(i=>i?.getMetaValue(U_TOKEN)),false);assert.deepEqual(resources(a),before,'snapshot mutates save only');
  const stale=uSkull(a).clone();game.finish(null);a.getInventory().setItem(4,stale);const inventory=contents(a.getInventory());PM.emitPlayerLogin({player:a,username:a.getUsername()});assert.equal(uIssued(a).length,0);
  inventory[4]={id:-1,n:0,meta:null};assert.deepEqual(contents(a.getInventory()),inventory);assert.equal(C.matches.has(a),false);
});

test('native U duplicate owned token cancels without point award and leaves unrelated gear exact',async()=>{
  const{a,b,game}=await uGame();uCheckpoint(a,game,[3293,4958,0]);await uTake(a,uNpc(game));uHeld(a,game);give(b,core.ItemIdentifiers.COINS,'U-unrelated');const inventory=contents(b.getInventory());
  a.getInventory().setItem(0,uSkull(a).clone());tick(4);assert.deepEqual(game.points,[0,0]);uNoExport(game,[a,b]);assert.deepEqual(contents(b.getInventory()),inventory);
});

test('native U foreign actor cannot issue match skull and finish leaves world actor untouched',async()=>{
  const{a,b,game}=await uGame();uCheckpoint(a,game,[3293,4958,0]);const owned=uNpc(game),world=C.api.spawnNpc({id:4187,x:3129,y:3627,z:0,wanderRadius:0});assert.ok(world);fixtureNpcs.add(world);
  assert.equal(world.isRegistered(),true);await uTake(a,world);assert.equal(game.oddskull.npc,owned);assert.equal(uIssued(a).length,0);const loc=position(world);game.finish(null);uNoExport(game,[a,b]);assert.equal(world.isRegistered(),true);assert.deepEqual(position(world),loc);
});

async function uStaging(){
  const a=actor(true),b=actor(true);ruleStats(a);ruleStats(b);channel(a);channel(b);const game=await negotiate(a,b,null,21);await join(a);await join(b);return{a,b,game};
}
test('native U exact middle admission cancels on blocked candidate without nearest-tile fallback',async t=>{
  const{a,b,game}=await uStaging(),blocked=core.RegionManager.blocked.bind(core.RegionManager),home=game.area.at(U_HOME);
  const messages=[messagesOf(a),messagesOf(b)];
  t.mock.method(core.RegionManager,'blocked',(at,area)=>area===game.area&&at.equals(home)?true:blocked(at,area));
  completePreparation(game);assert.equal(game.oddskull,undefined,'failed geometry never creates objective state');for(const lines of messages)assert.ok(lines.includes('This Oddskull battle could not continue. Please try a new challenge.'),'actual preparation refusal reaches both players');assert.equal(game.phase,'over');finishedMatch(game,[a,b]);
  assert.equal([...core.World.getNpcs()].some(n=>n?.getArea()===game.area),false);assert.equal(core.World.getAddNPCQueue().some(n=>n.getArea()===game.area),false);
});
test('native U queued actor registers as one indexed member and never duplicates on repeated tick',async t=>{
  const{a,b,game}=await uStaging(),list=core.World.getNpcs(),add=list.add.bind(list);let refusals=0;
  const inject=t.mock.method(list,'add',function(n,...args){if(n.getId()===4187&&refusals++===0)return false;return add(n,...args);});
  tick(game.starts-C.now()-1);core.World.processCycle++;game.tick();assert.equal(game.phase,'combat');const npc=game.oddskull.npc;assert.ok(npc);assert.notEqual(npc.isRegistered(),true);assert.notEqual(core.World.getNpcs().get(npc.getIndex()),npc);assert.equal(core.World.getAddNPCQueue().includes(npc),true);assert.equal(npc.getArea(),game.area);assert.equal(game.area.getNpcs().includes(npc),false);
  inject.mock.restore();npcQueues();game.tick();assert.equal(uNpc(game),npc);game.tick();game.tick();assert.equal(uNpc(game),npc);assert.equal(core.World.getAddNPCQueue().includes(npc),false);
});
for(const route of['finish','shutdown'])test(`native U queued actor ${route} retires before registration without late recreation`,async t=>{
  const{a,b,game}=await uStaging(),list=core.World.getNpcs(),add=list.add.bind(list);const inject=t.mock.method(list,'add',function(n,...args){return n.getId()===4187?false:add(n,...args);});
  tick(game.starts-C.now()-1);core.World.processCycle++;game.tick();const npc=game.oddskull.npc;assert.ok(npc);assert.equal(core.World.getAddNPCQueue().includes(npc),true);
  if(route==='finish')game.finish(null);else Match.shutdown();inject.mock.restore();tick(120);uNoExport(game,[a,b]);assert.notEqual(npc.isRegistered(),true);assert.notEqual(core.World.getNpcs().get(npc.getIndex()),npc);assert.equal(game.area.getNpcs().includes(npc),false);assert.equal(core.World.getAddNPCQueue().includes(npc),false);assert.equal(npc.__skipDefaultRespawn,true);
});
test('native U consumed queued-registration refusal cancels without blind retry',async t=>{
  const{a,b,game}=await uStaging(),list=core.World.getNpcs(),add=list.add.bind(list);let refusals=0;
  const inject=t.mock.method(list,'add',function(n,...args){if(n.getId()===4187){refusals++;return false;}return add(n,...args);});
  tick(game.starts-C.now());const npc=game.oddskull.npc;assert.ok(npc);assert.notEqual(npc.isRegistered(),true);assert.notEqual(core.World.getNpcs().get(npc.getIndex()),npc);assert.equal(npc.getArea(),game.area);assert.equal(game.area.getNpcs().includes(npc),false);assert.deepEqual(npcQueueFailures.splice(0),[npc]);assert.equal(refusals,2);
  inject.mock.restore();tick();assert.match(game.oddskull.failure,/registration refused/);uNoExport(game,[a,b]);tick(120);assert.equal(refusals,2);assert.notEqual(npc.isRegistered(),true);assert.notEqual(core.World.getNpcs().get(npc.getIndex()),npc);assert.equal(core.World.getAddNPCQueue().includes(npc),false);
});
test('native U spawn refusal terminates safely without score or issued property',async t=>{
  const{a,b,game}=await uStaging(),spawn=C.api.spawnNpc;let attempts=0;t.mock.method(C.api,'spawnNpc',function(d){if(d.id===4187){attempts++;return null;}return spawn(d);});
  completePreparation(game);assert.equal(attempts,1);assert.deepEqual(game.points,[0,0]);assert.match(game.oddskull.failure,/spawn refused/);uNoExport(game,[a,b]);tick(120);assert.equal(attempts,1);
});
test('native U unexpected actor loss cancels; same-ID world actor and live second game survive',async()=>{
  const first=await uGame(),second=await uGame(22),old=uNpc(first.game),live=uNpc(second.game),at=position(live);C.api.removeNpc(old);tick();uNoExport(first.game,[first.a,first.b]);assert.equal(uNpc(second.game),live);assert.deepEqual(position(live),at);
});
test('native U finish stale Take cannot cross real instance-slot reuse or stale issued-token recovery',async()=>{
  const{a,b,game}=await uGame(),npc=uNpc(game),base=[game.area.getBaseX(),game.area.getBaseY()];uCheckpoint(a,game,[3293,4958,0]);const frame=uTakeFrame(npc);game.finish(null);uNoExport(game,[a,b]);
  for(const p of[a,b]){await wire(p,Buffer.from([VIEW_CLOSE_PACKET]));lobby(p);assert.equal(p.isNeedsPlacement(),false);assert.equal(p.getInterfaceId(),-1);assert.equal(p.busy(),false,'genuine gameover close and lobby placement precede the next challenge');}
  const next=await negotiate(a,b,null,22);await join(a);await join(b);completePreparation(next);const current=uNpc(next);assert.deepEqual([next.area.getBaseX(),next.area.getBaseY()],base,'native allocator reuses destroyed template slot');
  uCheckpoint(a,next,[3293,4958,0]);await dispatchFrameNow(a,frame);core.TaskManager.processWalkTo(a.getIndex());
  // If World reuses the NPC index, a NEW input names the new actor; that is not an old callback.
  if(current.getIndex()===npc.getIndex()){uHeld(a,next);assert.notEqual(next.oddskull.token,game.oddskull.token);}else{assert.equal(uIssued(a).length,0);assert.equal(next.oddskull.npc,current);}
  next.finish(null);uNoExport(next,[a,b]);
});
test('native U delayed servicing awards once without catch-up and at zero HP gives no deadline bonus',async()=>{
  const{a,b,game}=await uGame();uCheckpoint(a,game,[3293,4958,0]);await uTake(a,uNpc(game));uHeld(a,game);const side=game.members.get(a);
  core.World.processCycle+=20;game.tick();assert.equal(game.points[side],3);assert.equal(game.oddskull.nextAward,C.now()+4);game.tick();assert.equal(game.points[side],3);
  a.setHitpoints(0);core.World.processCycle+=4;game.tick();assert.equal(game.points[side],3);uNpc(game);assert.equal(uIssued(a).length,0);
  // Supplied zero HP is an eligibility probe, not a completed death; restore for ordinary teardown.
  a.setHitpoints(99);
});

// Native Melee Allowed/Disabled. All scene/stat/clock/roll controls are supplied;
// transport is inert. No queued hit or damage cancellation is added or simulated.
let nmInstalled=false,nmObserve=null,nmRoll=null;
function nmPrepared(e){if(nmObserve)nmObserve('prepare',e);}
function nmResolved(e){if(nmObserve)nmObserve('resolved',e);}
function nmStarted(e){if(nmObserve)nmObserve('started',e);}
function nmRolled(e){if(nmRoll)nmRoll(e);}
function nmInstall(){
  if(nmInstalled)return;
  assert.equal(actors.length,0,'canonical definitions load only after inherited actor teardown');
  const api=PM.createApi('ClanWarsNativeMeleeTest');
  // Production loader supplies canonical weapon interfaces; do not inject metadata.
  require('../plugins/items/ItemDefinitionLoader.plugin').register(api);
  require('../plugins/combat/specials/DragonClaw.SpecialAttack')(api);
  api.onCombatHitPrepare(nmPrepared);api.onCombatHitResolved(nmResolved);
  api.onCustomEvent('combat:attack-started',nmStarted);api.onCombatHitRoll(nmRolled);
  nmInstalled=true;
}
function nmTest(name,body){test('native Melee '+name,async t=>{
  nmInstall();try{await body(t);}finally{nmObserve=null;nmRoll=null;ghastTurns=false;}
});}
function nmPlace(game,a,b){
  a.moveTo(game.area.at([3293,4955,0]));b.moveTo(game.area.at([3294,4955,0]));
  for(const p of[a,b]){p.setNeedsPlacement(false);p.resetUpdating();AreaManager.process(p);p.setAutoRetaliate(false);}
  assert.equal(core.RegionManager.canMovestart(a.getLocation(),b.getLocation(),1,1,game.area),true,'supplied adjacent scene has a real traversable edge');
}
async function nmGame(melee=0,{mode=1,terms={},arena=1,prepare=true}={}){
  const a=actor(true),b=actor(true);for(const p of[a,b]){ruleStats(p,99);p.setAutoRetaliate(false);}channel(a);channel(b);
  const game=await negotiate(a,b,2,mode,{...terms,melee},arena);await join(a);await join(b);
  if(prepare)completePreparation(game);assert.equal(game.phase,prepare?'combat':'staging');assert.equal(game.rules.melee,melee);
  if(arena===1)nmPlace(game,a,b);return{a,b,game};
}
function nmTrace(t,a,b,{force=true}={}){
  const trace={prepared:[],started:[],resolved:[],queued:[],methods:[],permissions:[],applied:[],attacks:[]};
  nmObserve=(kind,e)=>{if(e.attacker!==a||e.target!==b)return;
    if(kind==='prepare')trace.prepared.push(e);
    if(kind==='started')trace.started.push(e);
    if(kind==='resolved')trace.resolved.push(e.hit);
  };
  nmRoll=e=>{if(force&&e.attacker===a&&e.target===b){e.forceAccurate=true;e.forceMaxHit=true;}};
  const add=CombatFactory.addPendingHit.bind(CombatFactory),get=CombatFactory.getMethod.bind(CombatFactory);
  t.mock.method(CombatFactory,'addPendingHit',hit=>{
    if(hit.getAttacker()===a&&hit.getTarget()===b){trace.queued.push(hit);for(const h of hit.getHits())h.onApplied(n=>trace.applied.push(n));}
    return add(hit);
  });
  t.mock.method(CombatFactory,'getMethod',p=>{const method=get(p);if(p===a)trace.methods.push(method);return method;});
  const attack=a.getCombat().attack.bind(a.getCombat()),area=a.getArea(),permission=area.canAttack.bind(area);
  t.mock.method(a.getCombat(),'attack',(...args)=>{trace.attacks.push(args[0]);return attack(...args);});
  t.mock.method(area,'canAttack',(...args)=>{const result=permission(...args);if(args[0]===a&&args[1]===b)trace.permissions.push({method:args[2],result});return result;});
  return trace;
}
async function nmAttack(a,b){
  const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(b.getIndex(),2);
  const [decoded]=decodeClientPackets(frame);assert.equal(decoded.type,'player_option');assert.equal(decoded.option,1);assert.equal(decoded.index,b.getIndex());
  await wire(a,frame);
}
function nmEngineUntil(predicate,bound=24){ghastTurns=true;for(let n=0;n<bound&&!predicate();n++)tick();}
function nmSender(t,p){
  const sender=p.getPacketSender(),calls={strings:[],display:[],flags:[]};
  for(const[method,key]of[['sendString','strings'],['sendInterfaceDisplayState','display'],['sendInterfaceFlagsRange','flags']]){
    const original=sender[method].bind(sender);t.mock.method(sender,method,(...args)=>{calls[key].push(args);return original(...args);});
  }return calls;
}

nmTest('both offers, setup warning, confirmations and joined frozen rules retain the actual decoded choice',async t=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const sent=[nmSender(t,a),nmSender(t,b)],scripts=[scriptCalls(a),scriptCalls(b)];
  const events=[],emit=PM.emitInterfaceActionClick.bind(PM);
  t.mock.method(PM,'emitInterfaceActionClick',event=>{events.push({...event});return emit(event);});
  await challenge(a,b);await challenge(b,a);const session=C.negotiations.get(a),original={...session.rules};
  assert.ok(sent.every(x=>x.display.some(([uid,hidden])=>uid===C.uid('clanwars_setup:melee')&&hidden===false)));
  assert.ok(sent.every(x=>x.flags.some(([uid,first,last,flags])=>uid===C.uid('clanwars_setup:dropdown_melee')&&first===1&&last===2&&flags===2)));
  await click(b,'clanwars_setup:accept');assert.equal(session.accepted.has(b),true);
  const frame=clickFrame('clanwars_setup:dropdown_melee',2),[decoded]=decodeClientPackets(frame);
  assert.equal(decoded.type,'widget_action');assert.equal(decoded.buttonNum,1);assert.equal(decoded.slot,2);
  await wire(a,frame);assert.equal(session.rules.melee,1);assert.equal(session.accepted.size,0);
  assert.ok(events.some(e=>e.player===a&&e.buttonId===C.uid('clanwars_setup:dropdown_melee')&&e.slot===2&&(e.opId??e.action)===1),'actual native caller supplied the operation and choice separately');
  for(const[key,value]of Object.entries(original))if(key!=='melee')assert.equal(session.rules[key],value,key);
  for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_melee')),1);
  assert.ok(sent.every(x=>x.strings.some(([text,uid])=>uid===C.uid('clanwars_setup:title')&&/attacks underway may still land/.test(text))));
  await click(b,'clanwars_setup:accept');assert.equal(session.accepted.has(b),false);tick(9);
  await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');
  for(const list of scripts)assert.ok(list.some(([id,...args])=>id===554&&args.some(x=>typeof x==='string'&&/No new player combat/.test(x)&&/Attacks already underway may still land/.test(x))));
  tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');
  const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(Object.isFrozen(game.rules),true);assert.equal(game.rules.melee,1);
  await join(a,false);assert.ok(scripts[0].some(([id,...args])=>id===554&&args[0]===1&&args.some(x=>typeof x==='string'&&/Attacks already underway may still land/.test(x))));
  await click(a,'clanwars_confirm:button');assert.equal(C.matches.get(a),game);
});

nmTest('wrong decoded operations and invalid slots resync without changing acceptance or current offer',async t=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  const session=C.negotiations.get(a);await click(a,'clanwars_setup:dropdown_melee',2);tick(9);await click(b,'clanwars_setup:accept');
  const revision=session.revision;
  for(const op of[2,3,10]){await nativeButton(a,'clanwars_setup:dropdown_melee',op,1);assert.equal(session.rules.melee,1);assert.equal(session.revision,revision);assert.equal(session.accepted.has(b),true);}
  for(const slot of[0,3,65535]){await click(a,'clanwars_setup:dropdown_melee',slot);assert.equal(session.rules.melee,1);assert.equal(session.revision,revision);assert.equal(session.accepted.has(b),true);}
  assert.equal(a.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_melee')),1);
  await click(a,'clanwars_setup:dropdown_melee',1);assert.equal(session.rules.melee,0);assert.equal(session.revision,revision+1);assert.equal(session.accepted.size,0);
});

for(const melee of[0,1])for(const weapon of['unarmed','dagger'])nmTest(`${weapon} actual native Attack resolves MELEE and obeys rule${melee} before launch`,async t=>{
  const f=await nmGame(melee);if(weapon==='dagger')await wield(f.a,core.ItemIdentifiers.DRAGON_DAGGER,'melee-native');
  nmPlace(f.game,f.a,f.b);const trace=nmTrace(t,f.a,f.b),before=resources(f.a),hp=f.b.getHitpoints();
  ghastTurns=true;await nmAttack(f.a,f.b);nmEngineUntil(()=>melee?trace.permissions.length>0:trace.resolved.length>0);
  f.a.getCombat().reset();assert.ok(trace.attacks.includes(f.b),'actual Attack caller reached the decoded target');assert.ok(trace.methods.some(m=>m.type()===core.CombatType.MELEE));assert.ok(trace.permissions.some(x=>x.method?.type()===core.CombatType.MELEE&&x.result===(melee===0)));
  if(melee===0){assert.ok(trace.prepared.length>0);assert.ok(trace.started.length>0);assert.ok(trace.queued.length>0);assert.ok(trace.resolved.length>0);assert.ok(f.b.getHitpoints()<hp);}
  else{assert.equal(trace.prepared.length,0);assert.equal(trace.started.length,0);assert.equal(trace.queued.length,0);assert.equal(trace.resolved.length,0);assert.equal(f.b.getHitpoints(),hp);assert.deepEqual(resources(f.a),before);}
});

for(const melee of[0,1])nmTest(`DDS actual damaging special keeps canonical payment at rule${melee}`,async t=>{
  const f=await nmGame(melee);await wield(f.a,core.ItemIdentifiers.DRAGON_DAGGER,'melee-dds');nmPlace(f.game,f.a,f.b);
  await nativeButton(f.a,'orbs:specbutton');assert.equal(f.a.isSpecialActivated(),true);assert.equal(f.a.getCombatSpecial().getId(),'dragon_dagger');
  const selected=f.a.getCombatSpecial().getCombatMethod();assert.equal(selected.type(),core.CombatType.MELEE);assert.equal(CombatFactory.getMethod(f.a),selected);
  const trace=nmTrace(t,f.a,f.b),before=resources(f.a);ghastTurns=true;await nmAttack(f.a,f.b);nmEngineUntil(()=>trace.queued.length>0);f.a.getCombat().reset();
  assert.ok(trace.attacks.includes(f.b));assert.ok(trace.methods.includes(selected));
  if(melee===0){assert.ok(trace.started.some(x=>x.method===selected));assert.ok(trace.queued.length>0);assert.equal(f.a.getSpecialPercentage(),75);assert.ok(trace.queued.every(x=>x.getCombatMethod()===selected));}
  else{assert.equal(trace.started.length,0);assert.equal(trace.queued.length,0);assert.deepEqual(resources(f.a),before);}
});

for(const term of[0,2])nmTest(`Disabled does not classify actual DragonBattleaxe utility by weapon name, special${term}`,async()=>{
  const f=await nmGame(1,{terms:{specialattacks:term}});await wield(f.a,core.ItemIdentifiers.DRAGON_BATTLEAXE,'melee-utility');
  const before=resources(f.a);await nativeButton(f.a,'orbs:specbutton');
  if(term===0){assert.equal(f.a.getSpecialPercentage(),0);assert.ok(f.a.getSkillManager().getCurrentLevel(core.Skill.STRENGTH)>before.levels[1]);}
  else assert.deepEqual(resources(f.a),before);
});

nmTest('Disabled and NoSpecials preserve team, jail, secondary protocol and foreign-instance guards',async()=>{
  const f=await nmGame(1,{terms:{specialattacks:2}}),other=await nmGame(0);
  assert.equal(f.game.area.canAttack(f.a,f.b,CombatFactory.MELEE_COMBAT),false);
  assert.equal(other.game.area.canAttack(other.a,other.b,CombatFactory.MELEE_COMBAT),true);
  assert.equal(f.game.area.canAttack(f.a,f.b),true,'existing methodless secondary protocol is preserved; not an actual start');
  assert.equal(f.game.area.canAttack(f.a,other.b,CombatFactory.MELEE_COMBAT),false);
  const team=f.game.fighters.get(f.b);f.game.fighters.set(f.b,f.game.fighters.get(f.a));assert.equal(f.game.area.canAttack(f.a,f.b),false);f.game.fighters.set(f.b,team);
  f.game.eliminate(f.b);assert.equal(f.game.area.canAttack(f.a,f.b),false);
  for(const method of[CombatFactory.RANGED_COMBAT,CombatFactory.MAGIC_COMBAT])assert.equal(other.game.area.canAttack(other.a,other.b,method),false);
});

for(const melee of[0,1])nmTest(`actual preparation stays closed before combat at rule${melee}`,async()=>{
  const f=await nmGame(melee,{prepare:false});assert.equal(f.game.phase,'staging');
  assert.equal(f.game.area.canAttack(f.a,f.b,CombatFactory.MELEE_COMBAT),false);
  completePreparation(f.game);assert.equal(f.game.area.canAttack(f.a,f.b,CombatFactory.MELEE_COMBAT),melee===0);
});

for(const melee of[0,1])nmTest(`owned Ghast player direction rule${melee} retains actual independent NPC hazard`,async t=>{
  const f=await nmGame(melee,{arena:7});for(const p of[f.a,f.b]){ghastFighter(p);ghastFood(p);}ghastReady(f.game);
  const npc=f.game.ghasts.npcs[f.game.members.get(f.a)],playerPrepared=[],npcResolved=[],trace=nmTrace(t,f.a,npc,{force:false});
  ghastObserve=(kind,e)=>{if(kind==='prepare'&&e.attacker===f.a&&e.target===npc)playerPrepared.push(e);if(kind==='resolved'&&e.attacker===npc&&e.target===f.a)npcResolved.push(e.hit);};
  assert.equal(f.game.area.canAttack(f.a,npc,CombatFactory.MELEE_COMBAT),melee===0);assert.equal(f.game.area.canAttack(npc,f.a,CombatFactory.MELEE_COMBAT),true);
  ghastTurns=true;await ghastAttack(f.a,npc);for(let n=0;n<32&&(melee===1||playerPrepared.length===0);n++)tick();f.a.getCombat().reset();
  assert.ok(trace.attacks.includes(npc));assert.ok(trace.permissions.some(x=>x.method?.type()===core.CombatType.MELEE&&x.result===(melee===0)));
  if(melee===0)assert.ok(playerPrepared.length>0);else assert.equal(playerPrepared.length,0);
  for(let n=0;n<180&&!f.a.getInventory().getAmount(core.ItemIdentifiers.ROTTEN_FOOD);n++)tick();
  assert.ok(npcResolved.length>0);assert.ok(f.a.getInventory().getAmount(core.ItemIdentifiers.ROTTEN_FOOD)>0,'actual ordinary NPC impacts still spoil food');
  assert.equal(f.game.area.npcAggression(f.a,npc),true);assert.equal(npc.isRegistered(),true);
});

nmTest('allstylesoff timed battle retains existing clock and ordinary tie outcome',async()=>{
  const f=await nmGame(1,{mode:16});assert.equal(f.game.rules.ranged,1);assert.equal(f.game.rules.magic,4);
  const calls=scriptCalls(f.a);core.World.processCycle=f.game.ends-1;tick();
  assert.equal(f.game.phase,'over');assert.equal(C.matches.has(f.a),false);assert.equal(C.matches.has(f.b),false);
  assert.ok(calls.some(([id,...args])=>args.some(x=>typeof x==='string'&&/without a winner/.test(x))),'actual gameover script reports tie after supplied final clock checkpoint');
});

async function nmForfeit(p,game){
  const name=game.layout.exits[game.members.get(p)],object=mappedLayoutObjects(game,name)[0];assert.ok(object);
  assert.equal(object.getPrivateArea(),game.area);assert.equal(p.getPrivateArea(),game.area);
  const at=object.getLocation(),definition=object.getDefinition(),turned=(object.getFace()&1)===1;
  const width=turned?definition.getSizeY():definition.getSizeX(),height=turned?definition.getSizeX():definition.getSizeY();
  const origin=game.layout.origin,toSource=loc=>[loc.getX()-game.area.getBaseX()+origin[0],loc.getY()-game.area.getBaseY()+origin[1]];
  const from=toSource(p.getLocation());let approach=null;
  // Explicit checkpoint on the actual rotated footprint perimeter, not just its anchor.
  // A clear tile alone can be an isolated component; require a real clipped route too.
  for(let dx=-1;dx<=width&&!approach;dx++)for(let dy=-1;dy<=height&&!approach;dy++){
    if(!((dx===-1||dx===width)&&dy>=0&&dy<height||(dy===-1||dy===height)&&dx>=0&&dx<width))continue;
    const loc=new core.Location(at.getX()+dx,at.getY()+dy,at.getZ());
    if(!core.RegionManager.blocked(loc,game.area)&&layoutReachable(game,from,toSource(loc),origin))approach=loc;
  }
  assert.ok(approach,'supplied Forfeit checkpoint is clear and connected to the fighter on the actual footprint perimeter');
  assert.equal(object.footprintDistance(approach),1);p.moveTo(approach);p.setNeedsPlacement(false);p.resetUpdating();
  const op=object.getDefinition().getInteractions().findIndex(x=>x?.toLowerCase()==='forfeit')+1;assert.ok(op>0);
  new(require('../dist/net/packet/impl/ObjectActionPacketListener').ObjectActionPacketListener)().executeAction(p,object.getId(),at.getX(),at.getY(),op);
  tick(20);assert.equal(C.matches.has(p),false,'actual mapped object dispatcher owns Forfeit; not wire traversal');
}

nmTest('allstylesoff Last Team Standing retains actual mapped Forfeit and existing winner',async()=>{
  const f=await nmGame(1,{mode:0}),calls=scriptCalls(f.a);
  await nmForfeit(f.b,f.game);assert.equal(f.game.phase,'over');
  assert.ok(calls.some(([id,...args])=>id===592&&args.some(x=>typeof x==='string'&&/Your team won/.test(x))));
  lobby(f.a);lobby(f.b);
});

async function nmQueued(t,{claws=false}={}){
  const f=await nmGame(0);if(claws)await wield(f.a,core.ItemIdentifiers.DRAGON_CLAWS,'melee-split');
  nmPlace(f.game,f.a,f.b);if(claws){await nativeButton(f.a,'orbs:specbutton');assert.equal(f.a.getCombatSpecial().getId(),'dragon_claws');assert.equal(f.a.isSpecialActivated(),true);}
  const trace=nmTrace(t,f.a,f.b),queue=f.b.getCombat().getHitQueue(),process=queue.process.bind(queue);let holding=true;
  t.mock.method(queue,'process',(...args)=>{if(!holding)return process(...args);});
  ghastTurns=true;await nmAttack(f.a,f.b);nmEngineUntil(()=>trace.queued.length>0);f.a.getCombat().reset();
  assert.ok(trace.queued.length>0,'real native paid launch occurred before held impact processing');assert.ok(trace.queued[0].getTotalDamage()>0);assert.equal(queue.hasPendingHit(trace.queued[0]),true);
  return{...f,trace,queue,release(){holding=false;queue.process(C.now());},process(){process(C.now());}};
}

for(const transition of['eliminate','rejoin','departure','finish','fresh-entry'])nmTest(`already-produced actual melee hit is preserved across ${transition} with supplied impact-processing hold`,async t=>{
  const f=await nmQueued(t),before=f.b.getHitpoints(),hit=f.trace.queued[0];
  if(transition==='eliminate'||transition==='rejoin'){
    // Supplied post-elimination jail checkpoint, not a naturally completed death.
    f.game.eliminate(f.b);f.game.jailed.add(f.b);const side=f.game.members.get(f.b);f.b.moveTo(f.game.area.at(f.game.layout.jails[side]));f.b.setNeedsPlacement(false);
    assert.equal(f.game.fighters.has(f.b),false);
    if(transition==='rejoin'){await jailExit(f.b,f.game);assert.equal(f.game.jailed.has(f.b),false);assert.equal(f.game.fighters.has(f.b),true);}
  }else if(transition==='departure')await nmForfeit(f.b,f.game);
  else f.game.finish(null);
  if(transition==='fresh-entry'){
    for(const p of[f.a,f.b]){lobby(p);await wire(p,Buffer.from([VIEW_CLOSE_PACKET]));}
    const next=await negotiate(f.a,f.b,2,1,{melee:1});await join(f.a);await join(f.b);completePreparation(next);
    assert.equal(next.rules.melee,1);assert.notEqual(next,f.game);assert.equal(next.area.canAttack(f.a,f.b,CombatFactory.MELEE_COMBAT),false);
  }
  assert.equal(f.queue.hasPendingHit(hit),true,'transition itself did not cancel already-produced hit');f.b.setNeedsPlacement(false);f.release();
  assert.ok(f.trace.resolved.includes(hit));assert.ok(f.b.getHitpoints()<before);assert.equal(f.trace.queued.length,1,'no new posttransition melee launch was supplied');
  console.log('MELEE_PREVENTION_LIMIT '+JSON.stringify({transition,suppliedImpactProcessingHold:true,damage:before-f.b.getHitpoints(),oldRule:0,newRule:transition==='fresh-entry'?1:null}));
});

for(const transition of['departure','finish'])nmTest(`already-split canonical claw splats survive ${transition} without cancellation or refund`,async t=>{
  const f=await nmQueued(t,{claws:true}),hit=f.trace.queued[0];assert.deepEqual(hit.getHitDelays(),[0,0,1,1]);assert.equal(f.a.getSpecialPercentage(),50);
  f.process();assert.ok(f.trace.resolved.includes(hit));assert.equal(f.trace.applied.length,2,'first two canonical splats applied before supplied transition');
  assert.ok(hit.getHits().slice(2).some(x=>x.getDamage()>0));
  if(transition==='departure')await nmForfeit(f.b,f.game);else{f.game.finish(null);tick(3);}
  // Leaving restores Hitpoints at Ferox; the remaining splats then land on the restored total.
  const before=f.b.getHitpoints();assert.equal(before,f.b.getSkillManager().getMaxLevel(core.Skill.HITPOINTS));
  f.b.setNeedsPlacement(false);f.release();assert.equal(f.trace.applied.length,4);assert.ok(f.b.getHitpoints()<before);assert.equal(f.a.getSpecialPercentage(),50,'already paid energy is not refunded');
  console.log('MELEE_SPLIT_LIMIT '+JSON.stringify({transition,suppliedImpactProcessingHold:true,hitDelays:hit.getHitDelays(),splats:f.trace.applied,paid:50}));
});

nmTest('Oddskull remains playable with all new player combat disabled while an opposing native melee start refuses',async t=>{
  const f=await nmGame(1,{mode:21});uCheckpoint(f.a,f.game,[3293,4958,0]);await uTake(f.a,uNpc(f.game));uHeld(f.a,f.game);
  const side=f.game.members.get(f.a);assert.deepEqual(f.game.points,[0,0]);tick(4);assert.equal(f.game.points[side],3);
  nmPlace(f.game,f.a,f.b);const trace=nmTrace(t,f.b,f.a),hp=f.a.getHitpoints();
  await nmAttack(f.b,f.a);nmEngineUntil(()=>trace.permissions.length>0);
  assert.ok(trace.attacks.includes(f.a),'ordinary decoded Attack reaches the current opposing holder');
  assert.ok(trace.permissions.some(x=>x.method===CombatFactory.MELEE_COMBAT&&x.result===false));
  assert.equal(trace.queued.length,0);assert.equal(f.a.getHitpoints(),hp);uHeld(f.a,f.game);
});

// Standard-bow contract: supplied scene/engine turns and controlled rolls, real native
// negotiation, equipment, Attack, combat/fire, private floor items, Take and safe death.
// No transcript replay, rendered-client, retail probability or full persistence claim.
function bowDiagnostic(context,phase){
  // Bounded scalar snapshots identify reached case/teardown, never a PASS or peak/census claim.
  console.log('STANDARD_BOW_DIAGNOSTIC '+JSON.stringify({name:context.name,phase,clock:C.now(),actors:actors.length,memory:process.memoryUsage()}));
}
beforeEach(context=>{if(context.name.startsWith('standard-bow'))bowDiagnostic(context,'start');});
const BOW_PROFILES = [
  ['SHORTBOW','SHORTBOW'],['LONGBOW','LONGBOW'],['OAK_SHORTBOW','OAK_SHORTBOW'],['OAK_LONGBOW','OAK_LONGBOW'],
  ['WILLOW_SHORTBOW','WILLOW_SHORTBOW'],['WILLOW_LONGBOW','WILLOW_LONGBOW'],
  ['MAPLE_SHORTBOW','MAPLE_SHORTBOW'],['MAPLE_LONGBOW','MAPLE_LONGBOW'],
  ['YEW_SHORTBOW','YEW_SHORTBOW'],['YEW_LONGBOW','YEW_LONGBOW'],['MAGIC_SHORTBOW','MAGIC_SHORTBOW'],['MAGIC_LONGBOW','MAGIC_LONGBOW'],
];
function bowItem(name){const id=core.ItemIdentifiers[name];assert.ok(Number.isInteger(id)&&id>0,`canonical item ${name}`);return id;}
async function bowGame(extra={},mode=1){
  const a=actor(true),b=actor(true);for(const p of[a,b]){ruleStats(p,99);p.setAutoRetaliate(false);channel(p);}
  // Old production must fail here at the real decoded Allowed request, not at an absent new helper import.
  const game=await negotiate(a,b,null,mode,{ranged:0,...extra});
  bowInstall();
  await join(a);await join(b);completePreparation(game);bowPlace(a,b,game);
  return{a,b,game};
}
function bowPlace(a,b,game,offset=2){
  for(const[p,xy]of[[a,[3293,4955,0]],[b,[3293+offset,4955,0]]]){
    p.moveTo(game.area.at(xy));p.setNeedsPlacement(false);p.resetUpdating();AreaManager.process(p);
  }
  tick(2); // actual session visibility and scene placement before native target input
}
async function bowEquip(p,weapon='SHORTBOW',ammo='IRON_ARROW',amount=4){
  await tEquip(p,bowItem(weapon));
  if(ammo!==null){const id=bowItem(ammo);p.getInventory().add(new core.Item(id,amount,{qa:'bow-ammunition'}),false);
    const actions=core.CacheDefinitions.getItem(id).inventoryActions;
    await nativeItem(p,id,actions.includes('Wield')?'Wield':'Wear');
    assert.equal(p.getEquipment().get(core.Equipment.AMMUNITION_SLOT).getAmount(),amount);
  }
}
function bowAmount(p){const item=p.getEquipment().get(core.Equipment.AMMUNITION_SLOT);return item.getId()<0?0:item.getAmount();}
function bowFloor(game,id){return core.World.getItems().filter(i=>i.getPrivateArea()===game.area&&i.getItem().getId()===id&&!i.isPendingRemoval());}
async function bowAttackInput(a,b){
  const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(b.getIndex(),2);
  const packets=decodeClientPackets(frame);assert.equal(packets.length,1);assert.equal(packets[0].option,1);assert.equal(packets[0].index,b.getIndex());
  await a.connection.dispatch(packets);a.connection.processTurnPackets();
}
async function bowFire(t,a,b,roll=0.5){
  const paid=[],original=CombatFactory.decrementAmmo.bind(CombatFactory);
  const random=t.mock.method(Math,'random',()=>roll);
  const observer=t.mock.method(CombatFactory,'decrementAmmo',function(p,pos,amount,delay){
    const before=bowAmount(p);const result=original(p,pos,amount,delay);
    if(p===a)paid.push({tick:C.now(),before,after:bowAmount(p),pos:pos.clone(),amount,delay});return result;
  });
  bowRollControl=e=>{if(e.attacker===a&&e.target===b)e.forceAccurate=true;};
  try{
    bowTurns=true;await bowAttackInput(a,b);
    for(let n=0;n<24&&!paid.length;n++)tick();
    assert.equal(paid.length,1,'one actual native attack reached canonical ammunition payment');
    assert.equal(CombatFactory.getMethod(a),CombatFactory.RANGED_COMBAT,'ordinary actual method');
    a.getCombat().reset();return paid[0];
  }finally{bowTurns=false;bowRollControl=null;observer.mock.restore();random.mock.restore();}
}
function bowImpacts(n=1){bowTurns=true;try{tick(n);}finally{bowTurns=false;}}
async function bowTake(p,item){
  const id=item.getItem().getId(),at=item.getPosition(),frame=Buffer.from([103,id&255,id>>>8,(at.getX()+128)&255,at.getX()>>>8,at.getY()>>>8,(at.getY()+128)&255,128]);
  const decoded=decodeClientPackets(frame);assert.equal(decoded.length,1);assert.equal(decoded[0].type,'ground_item_action');assert.equal(decoded[0].itemId,id);assert.equal(decoded[0].x,at.getX());assert.equal(decoded[0].y,at.getY());
  await wire(p,frame);tick(12);
}

test('standard-bow native Allowed change invalidates accepts and binds resynced confirmation and join warnings',async t=>{
  const a=actor(true),b=actor(true);channel(a);channel(b);const messages=[messagesOf(a),messagesOf(b)],calls=[scriptCalls(a),scriptCalls(b)];
  const display=[],flags=[];const sender=a.getPacketSender(),show=sender.sendInterfaceDisplayState.bind(sender),events=sender.sendInterfaceFlagsRange.bind(sender);
  t.mock.method(sender,'sendInterfaceDisplayState',function(...args){display.push(args);return show(...args);});
  t.mock.method(sender,'sendInterfaceFlagsRange',function(...args){flags.push(args);return events(...args);});
  await challenge(a,b);await challenge(b,a);const session=C.negotiations.get(a);
  assert.ok(display.some(([id,hidden])=>id===C.uid('clanwars_setup:ranged')&&hidden===false),'actual native ranged row is exposed');
  assert.ok(flags.some(([id,first,last,bits])=>id===C.uid('clanwars_setup:dropdown_ranged')&&first===1&&last===2&&bits===2),'both native selectable children receive op1');
  assert.equal(session.rules.ranged,1);await click(b,'clanwars_setup:accept');assert.equal(session.accepted.has(b),true);
  await click(a,'clanwars_setup:dropdown_ranged',1);assert.equal(session.rules.ranged,0,'real native Allowed reaches authoritative offer');
  assert.equal(session.accepted.size,0);assert.equal(session.revision,1);
  for(const p of[a,b])assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_ranged')),0);
  await click(b,'clanwars_setup:accept');assert.equal(session.accepted.has(b),false);tick(9);
  const revision=session.revision;
  for(const slot of[0,3,65535]){await click(a,'clanwars_setup:dropdown_ranged',slot);assert.equal(session.rules.ranged,0);assert.equal(session.revision,revision);}
  await nativeButton(a,'clanwars_setup:dropdown_ranged',2,2);assert.equal(session.rules.ranged,0);assert.equal(session.revision,revision,'wrong widget operation cannot change offer');
  await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');
  for(const list of calls){const summary=list.filter(row=>row[0]===554).at(-1).at(-1);assert.match(summary,/equipped arrows/);assert.match(summary,/floor arrows disappear/);}
  tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');
  const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(game.rules.ranged,0);
  await join(a);assert.match(calls[0].filter(row=>row[0]===554).at(-1).at(-1),/Safe death does not restore spent arrows/);
  for(const list of messages){assert.ok(list.some(m=>m.includes('normal, oak, willow, maple, yew and magic')));assert.ok(list.some(m=>m.includes('floor arrows disappear')));}
});

for(const[profile,weapon]of BOW_PROFILES)test(`standard-bow native ordinary shot uses canonical ${profile} profile`,async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a,weapon);bowPlace(a,b,game);
  assert.equal(core.RangedWeapon.getFor(a),core.RangedWeapon[profile]);
  const shot=await bowFire(t,a,b);assert.equal(shot.before,4);assert.equal(shot.after,3);assert.equal(shot.amount,1);assert.ok(shot.delay>0);
  assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,0,'recoverable floor is delayed beyond firing');
  const hp=b.getHitpoints();bowImpacts(shot.delay+2);assert.ok(b.getHitpoints()<hp,'real accurate arrow hit landed');
  const floor=bowFloor(game,bowItem('IRON_ARROW'));assert.equal(floor.length,1);assert.equal(floor[0].getItem().getAmount(),1);assert.equal(floor[0].getOwner(),a.getUsername());
  assert.equal(floor[0].getPrivateArea()===game.area,true,'floor retains exact firing-area identity');assert.equal(core.ItemOnGroundManager.canSee(b,floor[0]),false,'opponent cannot see initially private arrow');
});

for(const[weapon,ammo]of[['SHORTBOW','IRON_ARROW'],['LONGBOW','BRONZE_ARROW']])test(`standard-bow ${weapon} actual native Take conserves paid and recovered arrow`,async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a,weapon,ammo,3);bowPlace(a,b,game);
  const id=bowItem(ammo),before=a.getInventory().getAmount(id),shot=await bowFire(t,a,b);bowImpacts(shot.delay+1);
  const floor=bowFloor(game,id)[0];assert.ok(floor);assert.equal(floor.getItem().getMeta().qa,'bow-ammunition');
  await bowTake(a,floor);assert.equal(a.getInventory().getAmount(id),before+1);assert.equal(bowAmount(a),2);assert.equal(bowFloor(game,id).length,0);
  assert.equal(bowAmount(a)+a.getInventory().getAmount(id)-before,3,'one paid shot recovered once, no reconstruction');
  await bowTake(a,floor);assert.equal(a.getInventory().getAmount(id),before+1,'same retired floor reference cannot duplicate through a new packet');
});

let bowInstalled=false;
function bowInstall(){
  if(bowInstalled)return;
  const api=PM.createApi('ClanWarsStandardBowActualProducers');
  require('../plugins/items/AvasAccumulator.plugin').register(api);
  require('../plugins/items/DizanasQuiver.plugin').register(api);
  require('../plugins/combat/specials/MagicShortbow.SpecialAttack')(api);
  require('../plugins/combat/specials/MagicLongbow.SpecialAttack')(api);
  bowInstalled=true;
}
async function bowRefused(a,b){
  const before={inventory:contents(a.getInventory()),equipment:contents(a.getEquipment()),energy:a.getSpecialPercentage(),hp:b.getHitpoints()};
  bowTurns=true;try{await bowAttackInput(a,b);tick(8);}finally{bowTurns=false;a.getCombat().reset();}
  assert.deepEqual(contents(a.getInventory()),before.inventory);assert.deepEqual(contents(a.getEquipment()),before.equipment);
  assert.equal(a.getSpecialPercentage(),before.energy);assert.equal(b.getHitpoints(),before.hp,'refused attack does not land damage');
}

for(const[branch,roll,cape]of[['broken',0.01,null],['recovered',0.95,'AVAS_ACCUMULATOR']])test(`standard-bow actual ${branch} outcome conserves carried floor and spent units`,async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a);if(cape)await tEquip(a,bowItem(cape),core.Equipment.CAPE_SLOT);bowPlace(a,b,game);
  const shot=await bowFire(t,a,b,roll);assert.equal(shot.before-shot.after,branch==='broken'?1:0);bowImpacts(shot.delay+2);
  assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,0);assert.equal(bowAmount(a),branch==='broken'?3:4);
  const carried=contents(a.getEquipment());game.finish(null);tick(4);assert.deepEqual(contents(a.getEquipment()),carried,'finish does not recreate broken or recovered arrows');
});

test('standard-bow registry aliases retain ordinary support through actual native equipment',async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a,'MAGIC_SHORTBOW_I_');bowPlace(a,b,game);
  assert.equal(core.RangedWeapon.getFor(a),core.RangedWeapon.MAGIC_SHORTBOW);
  const shot=await bowFire(t,a,b);assert.equal(shot.after,3);bowImpacts(shot.delay+1);assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,1);
});

for(const[weapon,ammo]of[['CRYSTAL_BOW_FULL',null],['BRONZE_KNIFE',null],['DARK_BOW','IRON_ARROW'],['RUNE_CROSSBOW','BRONZE_BOLTS'],['TOXIC_BLOWPIPE',null],['CRAWS_BOW',null]])test(`standard-bow unsupported ${weapon} native Attack refuses before spending`,async()=>{
  const{a,b,game}=await bowGame();
  if(weapon==='CRYSTAL_BOW_FULL'){
    // Supplied eligibility checkpoint, not forced equipment: the shared canonical
    // loader also installs this historical bow's noncombat Agility requirement.
    const {EquipmentRequirements}=require('../dist/game/model/equipment/EquipmentRequirements');
    const definition=core.ItemDefinition.forId(bowItem(weapon)),skills=a.getSkillManager();
    const unmet=EquipmentRequirements.getUnmet(a,definition);
    assert.deepEqual(unmet,{label:'Agility',level:50},'real equip prerequisite before the native Wield request');
    assert.equal(definition.getRequirements()[core.Skill.AGILITY.getIndex()],50);
    assert.equal(skills.getMaxLevel(core.Skill.AGILITY),1);
    skills.setMaxLevels(core.Skill.AGILITY,50,false);skills.setCurrentLevel(core.Skill.AGILITY,50,false);
    assert.equal(EquipmentRequirements.getUnmet(a,definition),null,'eligible supplied actor still uses native equip');
    console.log('STANDARD_BOW_EQUIP_PREREQUISITE '+JSON.stringify({weapon,unmet,baseAgility:skills.getMaxLevel(core.Skill.AGILITY)}));
  }
  await bowEquip(a,weapon,ammo);bowPlace(a,b,game);const messages=messagesOf(a);
  await bowRefused(a,b);assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,0);
  assert.ok(messages.some(m=>m.includes('TSPS Ranging supports')),'actionable supported-family refusal');
});

test('standard-bow loaded quiver resolver cannot bypass actual equipped-ammunition boundary',async()=>{
  const{a,b,game}=await bowGame();await bowEquip(a,'SHORTBOW',null);await tEquip(a,bowItem('DIZANAS_QUIVER'),core.Equipment.CAPE_SLOT);
  // Supplied player-owned loaded state, resolved and spent only by the real quiver plugin.
  a.setAttribute('dizanas-quiver',{id:bowItem('IRON_ARROW'),amount:7});bowPlace(a,b,game);
  assert.equal(core.Ammunition.firesFromAmmoSlot(a),false);const before=structuredClone(a.getAttribute('dizanas-quiver'));
  await bowRefused(a,b);assert.deepEqual(a.getAttribute('dizanas-quiver'),before);assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,0);
});

for(const ammo of[null,'RUNE_ARROW'])test(`standard-bow missing or incompatible ${ammo} ammunition refuses without expenditure`,async()=>{
  const{a,b,game}=await bowGame();await bowEquip(a,'SHORTBOW',ammo);bowPlace(a,b,game);const messages=messagesOf(a);
  await bowRefused(a,b);assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,0);
  assert.ok(messages.some(m=>/no ammo|can't use that ammo/i.test(m)),'canonical quiver compatibility refusal');
});

test('standard-bow ranged special button and injected prearmed swing both refuse without energy or arrows',async()=>{
  const{a,b,game}=await bowGame({specialattacks:0});await bowEquip(a,'MAGIC_SHORTBOW');bowPlace(a,b,game);
  const messages=messagesOf(a),before=resources(a);await nativeButton(a,'orbs:specbutton');
  assert.equal(a.isSpecialActivated(),false);assert.equal(a.getSpecialPercentage(),100);assert.deepEqual(contents(a.getEquipment()),before.equipment);
  assert.ok(messages.some(m=>m.includes('Ranged special attacks are unavailable')));
  a.setSpecialActivated(true);await bowRefused(a,b);assert.equal(a.getSpecialPercentage(),100);assert.equal(bowAmount(a),4);
  a.setSpecialActivated(false);assert.equal(CombatFactory.canAttackByPolicy(a,b,CombatFactory.RANGED_COMBAT),CanAttackResponse.CAN_ATTACK);
});

test('standard-bow inherited Disabled option melee and magic controls retain negotiated policy',async()=>{
  const{a,b,game}=await bowGame({ranged:1});await bowEquip(a);bowPlace(a,b,game);await bowRefused(a,b);
  assert.equal(CombatFactory.canAttackByPolicy(a,b,CombatFactory.MELEE_COMBAT),CanAttackResponse.CAN_ATTACK);
  assert.equal(CombatFactory.canAttackByPolicy(a,b,CombatFactory.MAGIC_COMBAT),CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.equal(bowAmount(a),4);assert.equal(game.rules.ranged,1);
});

test('standard-bow last arrow is paid once and next actual Attack reports empty quiver',async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a,'SHORTBOW','IRON_ARROW',1);bowPlace(a,b,game);
  const shot=await bowFire(t,a,b);assert.equal(shot.after,0);bowImpacts(shot.delay+2);assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,1);
  const messages=messagesOf(a);await bowRefused(a,b);assert.ok(messages.some(m=>m.includes('There is no ammo left in your quiver')));
  assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,1,'next failed attempt cannot create another floor arrow');
});

test('standard-bow actual approach from outside range precedes first payment',async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a);bowPlace(a,b,game,16);
  const before=position(a);const shot=await bowFire(t,a,b);assert.notDeepEqual(position(a),before,'ordinary target pursuit moved the archer before firing');
  assert.equal(shot.after,3);assert.ok(Math.abs(a.getLocation().getX()-b.getLocation().getX())<=core.WeaponProfiles.attackDistance(a,7));
});

test('standard-bow projectile obstruction prevents payment while movement is blocked',async()=>{
  const{a,b,game}=await bowGame();await bowEquip(a);bowPlace(a,b,game);
  // Supplied short-lived scene obstruction: actual collision/ray checks, no CombatRange stub.
  const at=game.area.at([3294,4955,0]),old=game.area.getClip(at);game.area.setClip(at,old|0x20100);
  a.getMovementQueue().setBlockMovement(true);
  try{assert.equal(core.RegionManager.canProjectileAttackReturn(a.getLocation(),b.getLocation(),1,game.area),false);await bowRefused(a,b);assert.equal(bowAmount(a),4);}
  finally{a.getMovementQueue().setBlockMovement(false);game.area.setClip(at,old);}
});

for(const phase of['before-landing','after-landing'])test(`standard-bow finish ${phase} preserves payment and cleans instance floor exactly once`,async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a);bowPlace(a,b,game);const shot=await bowFire(t,a,b),id=bowItem('IRON_ARROW');
  if(phase==='after-landing'){bowImpacts(shot.delay+1);assert.equal(bowFloor(game,id).length,1);}
  else assert.equal(bowFloor(game,id).length,0);
  const paid=contents(a.getEquipment());game.finish(null);assert.equal(game.area.isDestroyed(),true);bowImpacts(shot.delay+4);
  assert.equal(bowFloor(game,id).length,0);assert.deepEqual(contents(a.getEquipment()),paid);assert.equal(bowAmount(a),3);
  assert.equal(core.World.getItems().some(i=>i.getPrivateArea()===null&&i.getOwner()===a.getUsername()&&i.getItem().getId()===id&&!i.isPendingRemoval()),false,'no late lobby arrow');
});

test('standard-bow gear change during flight cannot refund or retarget already-paid arrow',async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a);bowPlace(a,b,game);const shot=await bowFire(t,a,b),id=bowItem('IRON_ARROW');
  assert.equal(bowAmount(a),3);const paid=a.getEquipment().get(core.Equipment.AMMUNITION_SLOT);
  // Supplied same-player container relocation after actual firing; native Take remains separately covered.
  a.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT,new core.Item(-1,0));a.getInventory().add(paid,false);
  const targetAt=shot.pos.clone();b.moveTo(game.area.at([3298,4955,0]));b.setNeedsPlacement(false);AreaManager.process(b);
  bowImpacts(shot.delay+2);const floor=bowFloor(game,id);assert.equal(floor.length,1);assert.ok(floor[0].getPosition().equals(targetAt));
  assert.equal(a.getInventory().getAmount(id),3);assert.equal(bowAmount(a),0);assert.equal(floor[0].getItem().getAmount(),1);
});

test('standard-bow native wrong-scene Take isolates actual instances and same-coordinate area guard',async t=>{
  const first=await bowGame();await bowEquip(first.a);bowPlace(first.a,first.b,first.game);const shot=await bowFire(t,first.a,first.b);bowImpacts(shot.delay+1);
  const second=await bowGame(),id=bowItem('IRON_ARROW'),floor=bowFloor(first.game,id)[0];assert.ok(floor);
  const at=floor.getPosition(),source=[at.getX()-first.game.area.getBaseX()+first.game.layout.origin[0],at.getY()-first.game.area.getBaseY()+first.game.layout.origin[1],at.getZ()];
  const ownTile=second.game.area.at(source);
  assert.equal(ownTile.equals(at),false,'template instances allocate distinct absolute coordinates');
  second.a.moveTo(ownTile);second.a.setNeedsPlacement(false);AreaManager.process(second.a);tick(2);
  assert.equal(second.a.getPrivateArea()===second.game.area,true,'actual participant remains in its own mapped scene');
  assert.equal(core.ItemOnGroundManager.canSee(second.a,floor),false);
  // Supplied read-only guard probe: same absolute position and owner name, varying ONLY area identity.
  // This is not a real player placed outside its instance or a naturally overlapping-scene claim.
  const sameCoordinateOwner={getLocation:()=>at.clone(),getUsername:()=>first.a.getUsername(),getPrivateArea:()=>second.game.area};
  assert.equal(core.ItemOnGroundManager.canSee(sameCoordinateOwner,floor),false,'foreign private identity alone refuses visibility');
  sameCoordinateOwner.getPrivateArea=()=>first.game.area;
  assert.equal(core.ItemOnGroundManager.canSee(sameCoordinateOwner,floor),true,'same-position same-owner positive control sees owned floor');
  const before=second.a.getInventory().getAmount(id);await bowTake(second.a,floor);
  assert.equal(second.a.getInventory().getAmount(id),before);assert.equal(bowFloor(first.game,id).length,1);
  assert.equal(second.a.getPrivateArea()===second.game.area,true,'wrong-scene packet cannot move instance ownership');
  const ownerBefore=first.a.getInventory().getAmount(id);await bowTake(first.a,floor);
  assert.equal(first.a.getInventory().getAmount(id),ownerBefore+1,'real owner native Take remains a connected positive control');
  assert.equal(bowFloor(first.game,id).length,0);
});

test('standard-bow actual lethal ranged impact preserves victim supplies through safe jail return and exit',async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a);await bowEquip(b,'LONGBOW','BRONZE_ARROW',5);bowPlace(a,b,game);
  give(b,bowItem('SHARK'),'safe-ranged-victim');const kept=carriedItems(b);b.setHitpoints(1);
  const shot=await bowFire(t,a,b);assert.equal(shot.after,3);bowImpacts(shot.delay+10);
  assert.equal(game.jailed.has(b),true,'actual native fired arrow caused real player death and safe jail callback');
  assert.deepEqual(carriedItems(b),kept);assert.equal(bowAmount(a),3);assert.equal(bowAmount(b),5);
  assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,1);
  await bowRefused(a,b);assert.equal(bowAmount(a),3,'jailed opponent cannot be shot again');
  await jailExit(b,game);assert.equal(game.fighters.has(b),true);assert.equal(game.jailed.has(b),false);assert.deepEqual(carriedItems(b),kept);
  game.finish(null);tick(3);assert.deepEqual(carriedItems(b),kept);assert.equal(bowAmount(a),3);assert.equal(bowFloor(game,bowItem('IRON_ARROW')).length,0);
});

async function bowAlly(a,game){
  const ally=actor(true);ruleStats(ally,99);ally.setAutoRetaliate(false);
  a.getRelations().addFriend(ally.getLongUsername());a.getRelations().setFriendRank(ally.getLongUsername(),5);
  assert.equal(FC.join(ally,a.getUsername(),false),true);await join(ally);assert.equal(game.fighters.has(ally),true);return ally;
}
for(const departure of['leave','logout'])test(`standard-bow owner ${departure} during flight leaves paid arrow in firing instance`,async t=>{
  const{a,b,game}=await bowGame();const ally=await bowAlly(a,game);await bowEquip(a);bowPlace(a,b,game);
  const shot=await bowFire(t,a,b),id=bowItem('IRON_ARROW'),before=contents(a.getEquipment());
  assert.equal(bowFloor(game,id).length,0);
  if(departure==='logout')PM.emitPlayerLogout({player:a,username:a.getUsername()});
  else assert.equal(Match.leave({player:a}),true); // registered leave producer, explicit lifecycle probe
  assert.equal(C.matches.has(a),false);bowImpacts(shot.delay+2);
  assert.equal(game.phase,'combat');assert.equal(game.fighters.has(ally),true);const floor=bowFloor(game,id);assert.equal(floor.length,1);
  assert.equal(floor[0].getOwner(),a.getUsername());assert.equal(floor[0].getPrivateArea()===game.area,true,'floor retains exact firing-area identity');assert.deepEqual(contents(a.getEquipment()),before);assert.equal(bowAmount(a),3);
  assert.equal(core.ItemOnGroundManager.canSee(a,floor[0]),false,'owner in lobby cannot reach its former private scene');
  await bowTake(a,floor[0]);assert.equal(bowFloor(game,id).length,1);assert.equal(a.getInventory().getAmount(id),0);
  game.finish(null);assert.equal(bowFloor(game,id).length,0);assert.equal(bowAmount(a),3);
});

test('standard-bow owner death during flight retains paid stack and suppresses reconstructed refund on jail return',async t=>{
  const{a,b,game}=await bowGame();await bowEquip(a);await bowEquip(b,'LONGBOW','BRONZE_ARROW');bowPlace(a,b,game);
  const shot=await bowFire(t,a,b),id=bowItem('IRON_ARROW'),remaining=carriedItems(a);
  // Explicit supplied lethal incoming hit, separate from the naturally fired arrow's latency.
  const hit=new core.PendingHit(b,a,CombatFactory.RANGED_COMBAT,{damage:a.getHitpoints(),rollAccuracy:false,handleAfterHitEffects:false,experience:false,delay:0});
  CombatFactory.addPendingHit(hit);core.World.processCycle++;require('../dist/game/content/combat/hit/HitQueue').HitQueue.processAll(C.now());
  assert.equal(a.getHitpoints(),0);bowImpacts(shot.delay+10);assert.equal(game.jailed.has(a),true);assert.deepEqual(carriedItems(a),remaining);
  assert.equal(bowAmount(a),3);assert.equal(bowFloor(game,id).length,1);await jailExit(a,game);assert.equal(game.fighters.has(a),true);
  assert.deepEqual(carriedItems(a),remaining);assert.equal(bowAmount(a),3);
});

test('standard-bow native owned Forfeit keeps actual remaining equipment without ammo reconstruction',async t=>{
  const{a,b,game}=await bowGame();await bowAlly(a,game);await bowEquip(a);bowPlace(a,b,game);
  const shot=await bowFire(t,a,b);bowImpacts(shot.delay+1);const remaining=carriedItems(a),id=bowItem('IRON_ARROW');
  const name=game.layout.exits[game.members.get(a)],portal=mappedLayoutObjects(game,name)[0];assert.ok(portal);
  // Supplied footprint-perimeter placement, followed by the real owned object's native action.
  const def=portal.getDefinition(),rot=portal.getFace()%2,w=rot?def.sizeY:def.sizeX,h=rot?def.sizeX:def.sizeY;
  const candidates=[];for(let x=-1;x<=w;x++)for(let y=-1;y<=h;y++){
    if(x>=0&&x<w&&y>=0&&y<h)continue;const at=new core.Location(portal.getLocation().getX()+x,portal.getLocation().getY()+y,0);
    if(game.area.getClip(at)===0)candidates.push(at);
  }
  assert.ok(candidates.length);a.moveTo(candidates[0]);a.setNeedsPlacement(false);AreaManager.process(a);tick(2);
  const sourceXY=[portal.getLocation().getX()-game.area.getBaseX()+game.layout.origin[0],portal.getLocation().getY()-game.area.getBaseY()+game.layout.origin[1]];
  await layoutObjectInput(a,game,name,sourceXY,'Forfeit');assert.equal(C.matches.has(a),false);lobby(a);
  assert.deepEqual(carriedItems(a),remaining);assert.equal(bowAmount(a),3);assert.equal(bowFloor(game,id).length,1);
  game.finish(null);assert.equal(bowFloor(game,id).length,0);assert.deepEqual(carriedItems(a),remaining);
});


test('standard-bow native staging and same-team targets refuse arrows while ordinary opposing combat still works',async t=>{
  const a=actor(true),ally=actor(true),b=actor(true);for(const p of[a,ally,b]){ruleStats(p,99);p.setAutoRetaliate(false);}
  channel(a,[ally]);channel(b);const game=await negotiate(a,b,null,1,{ranged:0});bowInstall();
  for(const p of[a,ally,b])await join(p);await bowEquip(a);bowPlace(a,b,game);
  assert.equal(game.phase,'staging');await bowRefused(a,b);assert.equal(bowAmount(a),4);
  completePreparation(game);bowPlace(a,b,game);
  ally.moveTo(game.area.at([3294,4955,0]));ally.setNeedsPlacement(false);AreaManager.process(ally);tick(2);
  await bowRefused(a,ally);assert.equal(bowAmount(a),4);
  const shot=await bowFire(t,a,b);assert.equal(shot.after,3);bowImpacts(shot.delay+2);
});

test('standard-bow Oddskull integration preserves holder attack refusal and permits incoming ordinary arrows',async t=>{
  const{a,b,game}=await uGame(21,{ranged:0});
  uCheckpoint(b,game,[3293,4958,0]);await uTake(b,uNpc(game));uHeld(b,game);
  await bowEquip(a);bowPlace(a,b,game);
  await bowRefused(b,a);uHeld(b,game);
  const hp=b.getHitpoints(),shot=await bowFire(t,a,b);bowImpacts(shot.delay+2);
  assert.ok(b.getHitpoints()<hp,'actual canonical arrow damages the current skull holder');
  assert.equal(shot.before-shot.after,1);uHeld(b,game);
});

// New connected-main composition: independent style permissions, canonical arrow
// payment/impact, and an actual subsequent native melee start refused before launch.
test('standard-bow merged MeleeDisabled permits paid arrow impact but refuses actual dagger start',async t=>{
  nmInstall();const{a,b,game}=await bowGame({melee:1});
  assert.equal(game.rules.melee,1);assert.equal(game.rules.ranged,0);assert.equal(game.rules.magic,4);
  await bowEquip(a);bowPlace(a,b,game);const hp=b.getHitpoints(),shot=await bowFire(t,a,b);
  assert.equal(shot.before-shot.after,1);bowImpacts(shot.delay+2);
  assert.ok(b.getHitpoints()<hp,'permitted canonical ranged hit lands despite new melee starts being disabled');
  await tEquip(a,core.ItemIdentifiers.DRAGON_DAGGER);nmPlace(game,a,b);
  const before=resources(a),afterArrowHP=b.getHitpoints(),trace=nmTrace(t,a,b);
  try{
    ghastTurns=true;await nmAttack(a,b);nmEngineUntil(()=>trace.permissions.length>0);
    a.getCombat().reset();assert.ok(trace.attacks.includes(b),'decoded native Attack reached actual target');
    assert.ok(trace.methods.some(m=>m.type()===core.CombatType.MELEE));
    assert.ok(trace.permissions.some(x=>x.method?.type()===core.CombatType.MELEE&&x.result===false));
    assert.equal(trace.prepared.length,0);assert.equal(trace.started.length,0);assert.equal(trace.queued.length,0);assert.equal(trace.resolved.length,0);
    assert.equal(b.getHitpoints(),afterArrowHP);assert.deepEqual(resources(a),before,'refused new melee attempt pays nothing');
  }finally{nmObserve=null;nmRoll=null;ghastTurns=false;}
});

// M: actual-main optional elemental Magic. Supplied placement, engine clock,
// accuracy/damage branches and item metadata are explicit; transport stays inert.
// These helpers observe/forward canonical payment and hit production, never pay a
// spell by calling canCast(true) as a substitute for the native combat route.
let mInstalled=false;
const M_ELEMENTS=['WIND','WATER','EARTH','FIRE'],M_FAMILIES=['STRIKE','BOLT','BLAST','WAVE','SURGE'];
function mStaffNames(){
  const names=['STAFF','MAGIC_STAFF','BATTLESTAFF'];
  for(const e of['AIR','WATER','EARTH','FIRE'])names.push('STAFF_OF_'+e,e+'_BATTLESTAFF','MYSTIC_'+e+'_STAFF');
  for(const e of['LAVA','MUD','STEAM','SMOKE','MIST','DUST'])names.push(e+'_BATTLESTAFF','MYSTIC_'+e+'_STAFF');
  for(const e of['LAVA','STEAM'])names.push(e+'_BATTLESTAFF_3','MYSTIC_'+e+'_STAFF_3');
  return names;
}
function mTest(name,body){test('native M '+name,async t=>{
  magicCase=name;console.log('MAGIC_FIXTURE '+JSON.stringify({phase:'start',name,clock:C.now(),actors:actors.length,...process.memoryUsage()}));
  await body(t);
});}
function mInstall(){
  if(mInstalled)return;
  // The canonical loader clears ItemDefinition.definitions and hydrates real
  // weapon interfaces. Run it once after inherited teardown, before M actors or
  // their native equipment exist; do not replay global server startup.
  assert.equal(actors.length,0,'canonical item definitions load before M actors');
  const api=PM.createApi('ClanWarsMCanonicalSpellResources');
  require('../plugins/items/ItemDefinitionLoader.plugin').register(api);
  tInstall();
  for(const name of['combat/ElementalSpells.plugin','items/ElementalStaves.plugin','items/ElementalTomes.plugin',
    'items/RunePouch.plugin','items/SlayersStaff.plugin','items/StorageItems.plugin','items/SpellRuneSaving.plugin','items/ToxicStaffOfTheDead.plugin','items/Trident.plugin']){
    require('../plugins/'+name).register(api);
  }
  // Capture and invoke only Iban's actual registered startup lifecycle; unrelated
  // server startup hooks must not be replayed by this isolated fixture.
  const startup=[];
  const ibanApi={...api,onServerStartup(handler){api.onServerStartup(handler);startup.push(handler);}};
  require('../plugins/items/IbansStaff.plugin').register(ibanApi);
  assert.equal(startup.length,1);startup[0]({timestamp:Date.now()});
  mInstalled=true;
}
function mPosition(game,a,b,distance=2){
  for(const[p,tile]of[[a,[3293,4955,0]],[b,[3293+distance,4955,0]]]){
    p.moveTo(game.area.at(tile));p.setNeedsPlacement(false);p.resetUpdating();AreaManager.process(p);
    assert.equal(p.getArea()===game.area,true,'supplied local placement stays in its real instance');
    p.setAutoRetaliate(false);
  }
}
function mFund(p,amount=200){
  for(const name of['AIR_RUNE','WATER_RUNE','EARTH_RUNE','FIRE_RUNE','MIND_RUNE','CHAOS_RUNE','DEATH_RUNE','BLOOD_RUNE','WRATH_RUNE','NATURE_RUNE','BODY_RUNE','SOUL_RUNE']){
    p.getInventory().add(new core.Item(core.ItemIdentifiers[name],amount),false);
  }
}
function mInventory(p){return contents(p.getInventory());}
function mCost(p,spell){return spell.itemsToConsume(p).map(i=>[i.getId(),i.getAmount()]);}
function mAmounts(p,cost){return cost.map(([id])=>p.getInventory().getAmount(id));}
function mPaid(p,cost,before){for(let n=0;n<cost.length;n++)assert.equal(p.getInventory().getAmount(cost[n][0]),before[n]-cost[n][1],'canonical inventory cost paid exactly once');}
function mTrace(t,a,b){
  const trace={commits:[],hits:[],resolved:[]};
  const add=CombatFactory.addPendingHit.bind(CombatFactory);
  t.mock.method(CombatFactory,'addPendingHit',hit=>{
    if(hit.getAttacker()===a&&hit.getTarget()===b)trace.hits.push(hit);
    return add(hit);
  });
  magicObserve=(kind,e)=>{
    if(kind==='committed'&&e.player===a)trace.commits.push(e);
    if(kind==='resolved'&&e.attacker===a&&e.target===b)trace.resolved.push(e.hit);
  };
  magicRollControl=e=>{if(e.attacker===a&&e.target===b){e.forceAccurate=true;e.forceMaxHit=true;}};
  return trace;
}
async function mGame(t,{rules={},beforeEntry=null,mode=1,prepare=true}={}){
  mInstall();const a=actor(true),b=actor(true);ruleStats(a,99);ruleStats(b,99);channel(a);channel(b);
  const game=await negotiate(a,b,2,mode,{magic:1,...rules});
  if(beforeEntry)await beforeEntry(a,b,game);
  await join(a);await join(b);if(prepare)completePreparation(game);mPosition(game,a,b);
  for(const p of[a,b]){p.setSpellbook(core.MagicSpellbook.NORMAL);mFund(p);}
  t.mock.method(Date,'now',()=>C.now()*600);
  magicTurns=true;return{a,b,game,trace:mTrace(t,a,b)};
}
async function mSpell(a,b,name,label=null){
  const pretty=label??name.toLowerCase().split('_').map(s=>s[0].toUpperCase()+s.slice(1)).join(' ');
  const meta=core.CacheDefinitions.getSpellByName(pretty);assert.ok(meta,'actual active-cache spell widget/item exists: '+pretty);
  const{ClientPacketId}=require('../dist/net/protocol/NativeClientPackets');
  const frame=Buffer.alloc(12);frame[0]=ClientPacketId.OPPLAYER_T;
  frame[1]=0;frame.writeUInt16LE(meta.itemId,2);frame.writeUInt16LE(65535,4);
  const uid=meta.widgetId;frame[6]=(uid>>>16)&255;frame[7]=(uid>>>24)&255;frame[8]=uid&255;frame[9]=(uid>>>8)&255;
  frame.writeUInt16LE(b.getIndex(),10);
  const decoded=decodeClientPackets(frame);assert.equal(decoded.length,1);assert.equal(decoded[0].type,'spell_on_player');
  assert.equal(decoded[0].targetIndex,b.getIndex());assert.equal(decoded[0].spellWidget,uid);assert.equal(decoded[0].spellItemId,meta.itemId);
  await a.connection.dispatch(decoded);a.connection.processTurnPackets();
  // No implicit tick here: the next controlled turn witnesses the actual paid cast
  // before advancing its delayed hit. This is not a natural queue-latency claim.
}
async function mFire(f,name='WIND_STRIKE'){
  const{a,b,trace}=f;const n=trace.commits.length,h=trace.hits.length;
  await mSpell(a,b,name);
  assert.equal(a.getCombat().getCastSpell()===core.CombatSpells[name],true,'native spell metadata resolves the canonical object');
  assert.equal(a.getCombat().getTarget()===b,true,'real spell-on-player owns the opposing target');
  for(let turn=0;turn<30&&trace.commits.length===n;turn++)tick();
  assert.equal(trace.commits.length,n+1,'actual engine reaches exactly one canonical paid cast');
  assert.equal(trace.hits.length,h+1,'canonical method produces one actual pending hit');
  const hit=trace.hits[h];assert.equal(hit.getCombatMethod()===CombatFactory.MAGIC_COMBAT,true);
  assert.equal(hit.getSpell()===core.CombatSpells[name],true);assert.equal(hit.getSpellContext()===trace.commits[n].context,true);
  return hit;
}
function mLand(f,hit){
  for(let turn=0;turn<12&&!f.trace.resolved.includes(hit);turn++)tick();
  assert.equal(f.trace.resolved.includes(hit),true,'actual delayed hit reaches the canonical resolver');
}
async function mEquip(p,id,slot=core.Equipment.WEAPON_SLOT){await tEquip(p,id,slot);}
function mTome(p,element,charges=2,special=false){
  const Common=require('../plugins/items/elementaltomes/Common.ElementalTomes');
  const item=p.getEquipment().get(core.Equipment.SHIELD_SLOT),definition=Common.getDefinition(item.getId());
  assert.equal(definition.element,element);Common.set(item,definition,charges,special?definition.specialPageId:definition.pageId);
  return{item,definition,Common};
}

mTest('five-choice native writer, Standard/Disabled reader, operation, offer revision and confirmation terms',async t=>{
  mInstall();const a=actor(true),b=actor(true);channel(a);channel(b);const lines=messagesOf(a),scripts=scriptCalls(a),sender=a.getPacketSender();
  const display=[],flags=[],sendDisplay=sender.sendInterfaceDisplayState.bind(sender),sendFlags=sender.sendInterfaceFlagsRange.bind(sender);
  t.mock.method(sender,'sendInterfaceDisplayState',(uid,hide)=>{display.push([uid,hide]);return sendDisplay(uid,hide);});
  t.mock.method(sender,'sendInterfaceFlagsRange',(uid,first,last,mask)=>{flags.push([uid,first,last,mask]);return sendFlags(uid,first,last,mask);});
  await challenge(a,b);await challenge(b,a);const session=C.negotiations.get(a);
  assert.ok(display.some(x=>x[0]===C.uid('clanwars_setup:magic')&&x[1]===false),'actual native Magic row is visible before selecting');
  assert.ok(flags.some(x=>x[0]===C.uid('clanwars_setup:dropdown_magic')&&x[1]===1&&x[2]===5&&x[3]===2));
  assert.equal(session.rules.magic,4);await click(a,'clanwars_setup:accept');assert.equal(session.accepted.has(a),true);
  const revision=session.revision;await nativeButton(a,'clanwars_setup:dropdown_magic',1,2);
  assert.equal(session.rules.magic,1);assert.equal(session.revision,revision+1);assert.equal(session.accepted.size,0);
  assert.equal(sender.getVarbit(core.CacheDefinitions.getVarbitId('clanwars_magic')),1);
  for(const slot of[1,0,6,65535]){
    await nativeButton(a,'clanwars_setup:dropdown_magic',1,slot);assert.equal(session.rules.magic,1);assert.equal(session.revision,revision+1);
    assert.equal(sender.getVarbit(core.CacheDefinitions.getVarbitId('clanwars_magic')),1);
  }
  await nativeButton(a,'clanwars_setup:dropdown_magic',2,5);assert.equal(session.rules.magic,1,'native OP2 cannot change Standard to Disabled');
  assert.equal(PM.emitInterfaceActionClick({player:a,buttonId:C.uid('clanwars_setup:dropdown_magic'),groupId:C.group('clanwars_setup'),childId:C.uid('clanwars_setup:dropdown_magic')&65535,slot:5,handled:false}),false,'actual dispatcher refuses a missing action before the feature reader');
  assert.equal(session.rules.magic,1,'missing actual operation is failclosed');
  await nativeButton(a,'clanwars_setup:dropdown_magic',1,5);assert.equal(session.rules.magic,4);
  await nativeButton(a,'clanwars_setup:dropdown_magic',1,2);assert.equal(session.rules.magic,1);tick(9);
  await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');assert.equal(session.confirmRevision,session.revision);
  const terms=scripts.findLast(row=>row[0]===554)?.[2];assert.match(terms,/20 strike/);assert.match(terms,/empty offhand or an elemental tome/);assert.match(terms,/not restored/);assert.match(terms,/queued battle hits without refund/);
  tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');const game=C.channelGames.get(C.channel(a).key);assert.ok(game);await join(a);await join(b);
  assert.ok(scripts.some(row=>row[0]===554&&row[1]===1&&/20 strike/.test(row[2])),'actual native joining repeats the same bounded terms');
  assert.ok(lines.some(s=>s.includes('Other combat spells')));assert.ok(lines.some(s=>s.includes('not restored')));
});

for(const element of M_ELEMENTS)for(const family of M_FAMILIES)mTest('ordinary '+element+' '+family+' native cast pays once, queues canonical context and lands',async t=>{
  const f=await mGame(t),spell=core.CombatSpells[element+'_'+family],cost=mCost(f.a,spell),amounts=mAmounts(f.a,cost),hp=f.b.getHitpoints(),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC);
  const hit=await mFire(f,element+'_'+family);mPaid(f.a,cost,amounts);assert.ok(f.b.getCombat().getHitQueue().hasPendingHit(hit),'paid cast is genuinely delayed');
  mLand(f,hit);assert.ok(f.b.getHitpoints()<hp);assert.ok(f.a.getSkillManager().getExperience(core.Skill.MAGIC)>xp);assert.equal(f.trace.commits.length,1);
});

for(const name of mStaffNames())mTest('basic/elemental staff family '+name+' equips natively and casts ordinary Wind Strike',async t=>{
  const f=await mGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I[name]);
  const air=f.a.getInventory().getAmount(I.AIR_RUNE),mind=f.a.getInventory().getAmount(I.MIND_RUNE);
  const hit=await mFire(f);const suppliesAir=name==='STAFF_OF_AIR'||name==='AIR_BATTLESTAFF'||name==='MYSTIC_AIR_STAFF'||/^(MYSTIC_)?(SMOKE|MIST|DUST)_/.test(name);
  assert.equal(f.a.getInventory().getAmount(I.AIR_RUNE),air-(suppliesAir?0:1));assert.equal(f.a.getInventory().getAmount(I.MIND_RUNE),mind-1);mLand(f,hit);
});

mTest('actual registered staff aliases retain their unsupported canonical-family refusal',async t=>{
  const f=await mGame(t),bases=new Set(mStaffNames().map(n=>core.ItemIdentifiers[n]));
  // Read the already-registered canonical LMS mapping. Do not register a supplied alias.
  const canonicalRow=id=>{
    const type=core.CacheDefinitions.getItem(id);
    return{id,name:type?.name,model:type?.model,wearPos:type?.wearPos,category:type?.category,inventoryActions:type?.inventoryActions};
  };
  const registered=[...core.CacheDefinitions.getObjNames()].map(([id,gameval])=>({id,gameval,base:core.ItemAliases.baseOf(id)})).filter(row=>row.base!=null);
  const candidates=registered.filter(row=>bases.has(row.base));
  const staffLike=registered.filter(row=>/staff|wand/i.test(core.CacheDefinitions.getItem(row.base)?.name??''));
  console.log('MAGIC_ALIAS_DISCOVERY '+JSON.stringify({registeredCount:registered.length,
    supportedCanonicalStaves:[...bases].map(canonicalRow),
    supportedBaseCandidates:candidates.map(row=>({...row,item:canonicalRow(row.id),canonicalBase:canonicalRow(row.base)})),
    registeredStaffLike:staffLike.map(row=>({...row,item:canonicalRow(row.id),canonicalBase:canonicalRow(row.base)}))}));
  // Diagnostic job6af830ec returned no supported-base alias before action
  // filtering. The real ten staff/wand copies have no admitted generic base. The
  // Standard exact-id additions do not admit their LMS aliases. Test those real
  // native refusals; never manufacture a supported alias witness.
  assert.equal(candidates.length,0,'this active cache has no registered alias of the admitted staff family');
  const expected=[['br_ancient_staff','ANCIENT_STAFF'],['br_beginner_wand','BEGINNER_WAND'],
    ['br_apprentice_wand','APPRENTICE_WAND'],['br_master_wand','MASTER_WAND'],['br_sotd','STAFF_OF_THE_DEAD'],
    ['br_zuriels_staff','ZURIELS_STAFF'],['br_kodai_wand','KODAI_WAND'],['br_barrows_ahrim_weapon','AHRIMS_STAFF'],
    ['br_nightmare_staff_volatile','VOLATILE_NIGHTMARE_STAFF'],['br_purging_staff','PURGING_STAFF']];
  assert.deepEqual(staffLike.map(row=>[row.gameval,row.base]),expected.map(([name,base])=>[name,core.ItemIdentifiers[base]]),
    'actual canonical registration matches the observed current-cache unsupported staff copies');
  for(const row of staffLike){
    assert.equal(row.id,core.CacheDefinitions.getObjId(row.gameval));assert.equal(bases.has(row.base),false);
    assert.ok(core.CacheDefinitions.getItem(row.id).inventoryActions.includes('Wield'));
    await mEquip(f.a,row.id);const before=resources(f.a),hp=f.b.getHitpoints();
    await mSpell(f.a,f.b,'WIND_STRIKE');tick(10);
    assert.deepEqual(resources(f.a),before,'unsupported alias cannot spend runes, charges or equipment');
    assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
  }
});

mTest('native autocast selector and Attack genuinely repeat ordinary paid spells without direct canCast',async t=>{
  const f=await mGame(t),messages=messagesOf(f.a),combat=f.a.getCombat();
  const observations={attackCalls:[],methods:[],areaPermission:[],spellDisabled:[],turns:[]};
  const originalAttack=combat.attack.bind(combat),originalMethod=CombatFactory.getMethod.bind(CombatFactory);
  const originalPermission=f.game.area.canAttack.bind(f.game.area),originalDisabled=PM.emitSpellDisabled.bind(PM);
  const spellId=spell=>spell?.spellId?.()??null;
  const state=()=>({cycle:C.now(),target:combat.getTarget()?.getIndex()??null,expectedTarget:f.b.getIndex(),
    activeAutocast:core.Autocasting.isActive(f.a),autocast:spellId(combat.getAutocastSpell()),cast:spellId(combat.getCastSpell()),
    hasStaff:f.a.getEquipment().hasStaffEquipped(),busy:f.a.busy(),interfaceId:f.a.getInterfaceId(),placement:f.a.isNeedsPlacement(),
    phase:f.game.phase,own:f.game.fighters.get(f.a),opponent:f.game.fighters.get(f.b),
    attackerInArea:f.a.getArea()===f.game.area,targetInArea:f.b.getArea()===f.game.area,
    hp:[f.a.getHitpoints(),f.b.getHitpoints()],commits:f.trace.commits.length,hits:f.trace.hits.length,
    mindRunes:f.a.getInventory().getAmount(core.ItemIdentifiers.MIND_RUNE),delay:combat.getAttackDelay()});
  // Each observer forwards the exact real call/arguments/result; no permission, method,
  // resource producer or native route is substituted and no extra canCast is invoked.
  t.mock.method(combat,'attack',(...args)=>{observations.attackCalls.push({target:args[0]?.getIndex()??null,before:state()});return originalAttack(...args);});
  t.mock.method(CombatFactory,'getMethod',(...args)=>{
    const result=originalMethod(...args);
    if(args[0]===f.a)observations.methods.push({cycle:C.now(),ordinaryMagic:result===CombatFactory.MAGIC_COMBAT,type:result?.type?.()});
    return result;
  });
  t.mock.method(f.game.area,'canAttack',(...args)=>{
    const result=originalPermission(...args);
    if(args[0]===f.a)observations.areaPermission.push({cycle:C.now(),target:args[1]?.getIndex()??null,ordinaryMagic:args[2]===CombatFactory.MAGIC_COMBAT,result});
    return result;
  });
  t.mock.method(PM,'emitSpellDisabled',(...args)=>{
    const result=originalDisabled(...args);
    if(args[0]===f.a)observations.spellDisabled.push({cycle:C.now(),spellbook:args[1],spellId:args[2],canonicalWindStrike:args[3]===core.CombatSpells.WIND_STRIKE,result});
    return result;
  });
  await mEquip(f.a,core.ItemIdentifiers.STAFF_OF_AIR);
  assert.equal(f.a.getEquipment().hasStaffEquipped(),true,'real canonical item metadata identifies the natively equipped staff');
  await nativeButton(f.a,(593<<16)|23);await nativeButton(f.a,(201<<16)|1,1,1);
  assert.equal(combat.getAutocastSpell()===core.CombatSpells.WIND_STRIKE,true);
  assert.equal(core.Autocasting.isActive(f.a),true,'native selection is active autocast, not only a remembered spell');
  const before=f.a.getInventory().getAmount(core.ItemIdentifiers.MIND_RUNE);
  const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(f.b.getIndex(),2);
  const packets=decodeClientPackets(frame);
  console.log('MAGIC_AUTOCAST_ROUTE '+JSON.stringify({phase:'before-attack',decoded:packets,state:state()}));
  assert.equal(packets.length,1);assert.equal(packets[0].type,'player_option');assert.equal(packets[0].option,1);assert.equal(packets[0].index,f.b.getIndex());
  // Same dispatch/process/three turns as wire(), retaining an observation before
  // those turns so a refused/absent target is not hidden by later combat changes.
  await f.a.connection.dispatch(packets);f.a.connection.processTurnPackets();
  observations.afterDispatch=state();tick(3);observations.afterWireTurns=state();
  for(let n=0;n<20&&f.trace.commits.length<2;n++){tick();observations.turns.push(state());}
  observations.beforeReset=state();combat.reset();
  console.log('MAGIC_AUTOCAST_ROUTE '+JSON.stringify({phase:'after-controlled-turns',observations,messages,afterReset:state()}));
  assert.ok(f.trace.commits.length>=2);assert.equal(f.a.getInventory().getAmount(core.ItemIdentifiers.MIND_RUNE),before-f.trace.commits.length);
  assert.ok(f.trace.hits.every(hit=>hit.getCombatMethod()===CombatFactory.MAGIC_COMBAT&&hit.getSpell()===core.CombatSpells.WIND_STRIKE));
});

for(const element of['fire','water','earth'])mTest('canonical '+element+' tome final charge supplies runes and retains its paid context',async t=>{
  const f=await mGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I['TOME_OF_'+element.toUpperCase()+'_EMPTY_'],core.Equipment.SHIELD_SLOT);const book=mTome(f.a,element,1);
  const rune=I[element.toUpperCase()+'_RUNE'];f.a.getInventory().deleteNumber(rune,f.a.getInventory().getAmount(rune));
  const hit=await mFire(f,element.toUpperCase()+'_WAVE');assert.equal(book.Common.read(book.item).charges,0);assert.equal(f.a.getInventory().getAmount(rune),0);
  const state=hit.getSpellContext().data.get(require('../plugins/items/elementaltomes/Combat.ElementalTomes').CAST_DATA_KEY);assert.equal(state.element,element);
  // Explicit supplied post-shot gear relocation, not a native packet or natural ordering claim.
  f.a.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=new core.Item(-1);
  mLand(f,hit);assert.equal(book.Common.read(book.item).charges,0);assert.equal(f.trace.commits.length,1);
});

mTest('pouch and inventory split the canonical rune cost with no activity resource override',async t=>{
  const f=await mGame(t),Pouch=require('../plugins/items/runepouch/Common.RunePouch'),I=core.ItemIdentifiers;
  give(f.a,I.RUNE_POUCH,'M-pouch');Pouch.setSlots(f.a,[{id:I.AIR_RUNE,amount:5},{id:I.MIND_RUNE,amount:5},null,null]);
  f.a.getInventory().deleteNumber(I.AIR_RUNE,f.a.getInventory().getAmount(I.AIR_RUNE));const mind=f.a.getInventory().getAmount(I.MIND_RUNE);
  const hit=await mFire(f);assert.equal(Pouch.amountOf(f.a,I.AIR_RUNE),4);assert.equal(Pouch.amountOf(f.a,I.MIND_RUNE),5);assert.equal(f.a.getInventory().getAmount(I.MIND_RUNE),mind-1);mLand(f,hit);
});

mTest('successful controlled splash still spends its cast and awards base Magic XP without target damage',async t=>{
  const f=await mGame(t),cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),before=mAmounts(f.a,cost),hp=f.b.getHitpoints(),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC);
  magicDamageControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.accurate=false;e.damage.setDamage(0);}};
  const hit=await mFire(f);mPaid(f.a,cost,before);mLand(f,hit);assert.equal(hit.isAccurate(),false);assert.equal(f.b.getHitpoints(),hp);assert.ok(f.a.getSkillManager().getExperience(core.Skill.MAGIC)>xp);
});

for(const refusal of['missing-runes','pouch-shortfall','low-level','wrong-book','self-target','dead-target'])mTest('actual '+refusal+' refuses before any rune or tome payment',async t=>{
  const f=await mGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I.TOME_OF_FIRE_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'fire',3);
  if(refusal==='missing-runes')f.a.getInventory().resetItems();
  if(refusal==='pouch-shortfall'){
    const Pouch=require('../plugins/items/runepouch/Common.RunePouch');give(f.a,I.RUNE_POUCH,'M-short-pouch');Pouch.setSlots(f.a,[{id:I.AIR_RUNE,amount:1},null,null,null]);
    f.a.getInventory().deleteNumber(I.AIR_RUNE,f.a.getInventory().getAmount(I.AIR_RUNE));
  }
  if(refusal==='low-level')f.a.getSkillManager().setCurrentLevel(core.Skill.MAGIC,1,false);
  if(refusal==='wrong-book')f.a.setSpellbook(core.MagicSpellbook.ANCIENT);
  if(refusal==='dead-target')f.b.setHitpoints(0);
  const Pouch=require('../plugins/items/runepouch/Common.RunePouch'),pouch=structuredClone(Pouch.slots(f.a));
  const before=mInventory(f.a),charges=book.Common.read(book.item).charges;
  await mSpell(f.a,refusal==='self-target'?f.a:f.b,'FIRE_WAVE');tick(12);
  assert.deepEqual(mInventory(f.a),before);assert.equal(book.Common.read(book.item).charges,charges);assert.deepEqual(Pouch.slots(f.a),pouch);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});

for(const name of['BIND','SNARE','ENTANGLE','CONFUSE','IBAN_BLAST','MAGIC_DART','TELE_BLOCK','ICE_BARRAGE','UNDEAD_GRASP'])mTest('canonical combat spell '+name+' preserves its current Standard support boundary',async t=>{
  const added=['BIND','SNARE','ENTANGLE','CONFUSE'].includes(name);if(added)cInstall();const f=await mGame(t),before=resources(f.a);
  if(!added){await mSpell(f.a,f.b,name);tick(10);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);return;}
  const stats=cStats(f.b),trace=fTrace(t,f.b),cost=mCost(f.a,core.CombatSpells[name]),amounts=mAmounts(f.a,cost),hit=await mFire(f,name);bStop(f);mPaid(f.a,cost,amounts);mLand(f,hit);
  cAssertStats(f.b,stats,C_CURSES[name],5);if(name==='CONFUSE')fNoNewEffects(trace);else bTimerOracle(trace,B_ROWS.find(row=>row[0]===name)[6]);
});

for(const name of['DRAGON_DAGGER','ANCIENT_STAFF','SLAYERS_STAFF_E_','STAFF_OF_THE_DEAD','TOXIC_STAFF_OF_THE_DEAD','KODAI_WAND','TWINFLAME_STAFF'])mTest('unsupported casting weapon '+name+' cannot pay an ordinary spell',async t=>{
  const f=await mGame(t);if(name==='SLAYERS_STAFF_E_')sLevels(f.a);await mEquip(f.a,core.ItemIdentifiers[name]);const before=resources(f.a);
  await mSpell(f.a,f.b,'WIND_STRIKE');tick(10);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});

mTest('ordinary unsupported shield refuses casting but its melee equipment remains intact',async t=>{
  const f=await mGame(t);await mEquip(f.a,core.ItemIdentifiers.BRONZE_KITESHIELD,core.Equipment.SHIELD_SLOT);const before=resources(f.a);
  await mSpell(f.a,f.b,'WIND_STRIKE');tick(10);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);
  assert.equal(f.game.area.canAttack(f.a,f.b,CombatFactory.MELEE_COMBAT),true);
});

mTest('powered trident native Attack refuses the actual resolver before spending a charge',async t=>{
  const f=await mGame(t);await mEquip(f.a,core.ItemIdentifiers.TRIDENT_OF_THE_SEAS);
  const item=f.a.getEquipment().get(core.Equipment.WEAPON_SLOT);item.setMetaValue('trident-charges',20);
  assert.equal(CombatFactory.getMethod(f.a)===CombatFactory.MAGIC_COMBAT,false,'real charged staff resolves its own method');
  const before=resources(f.a),frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(f.b.getIndex(),2);
  await wire(f.a,frame);tick(10);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});

for(const term of[0,1,2])mTest('actual four Power of Death activation producers remain deferred at special term '+term,async t=>{
  const f=await mGame(t,{rules:{specialattacks:term}}),power='power-of-death:until';
  for(const name of['STAFF_OF_THE_DEAD','TOXIC_STAFF_OF_THE_DEAD','STAFF_OF_LIGHT','STAFF_OF_BALANCE']){
    await mEquip(f.a,core.ItemIdentifiers[name]);const before=resources(f.a);await nativeButton(f.a,'orbs:specbutton');
    assert.deepEqual(resources(f.a),before);assert.equal(f.a.isSpecialActivated(),false);assert.equal(f.a.getAttribute(power)==null,true);assert.equal(f.trace.commits.length,0);
  }
});

mTest('magical damaging-special activation and prearmed entry refuse without consuming energy',async t=>{
  const api=PM.createApi('ClanWarsMMagicalSpecialProducer');require('../plugins/combat/specials/VolatileNightmareStaff.SpecialAttack')(api);
  const f=await mGame(t,{beforeEntry:async a=>{await mEquip(a,core.ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF);a.setSpecialActivated(true);}});
  assert.equal(f.a.isSpecialActivated(),false,'actual entry disarms the supplied prearmed magical toggle');
  const before=resources(f.a),events=tEffectTrace(t,f.a);await nativeButton(f.a,'orbs:specbutton');
  assert.deepEqual(resources(f.a),before);assert.equal(f.a.isSpecialActivated(),false);assert.ok(events.events.some(e=>e.result&&/magical specials/i.test(e.result)));
  assert.equal(events.animations.length,0);assert.equal(events.graphics.length,0);
});

mTest('Standard preserves the actual native melee special path',async t=>{
  const f=await mGame(t);await mEquip(f.a,core.ItemIdentifiers.DRAGON_DAGGER);await nativeButton(f.a,'orbs:specbutton');
  assert.equal(f.a.isSpecialActivated(),true);const before=f.a.getSpecialPercentage(),frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(f.b.getIndex(),2);
  await wire(f.a,frame);for(let n=0;n<12&&f.a.getSpecialPercentage()===before;n++)tick();
  assert.ok(f.a.getSpecialPercentage()<before);assert.equal(f.trace.commits.length,0);assert.ok(f.trace.hits.some(h=>h.getCombatType()===core.CombatType.MELEE));
});

mTest('a remembered autocast without a staff is not permission to replace a melee Attack',async t=>{
  const f=await mGame(t);await nativeButton(f.a,(201<<16)|1,1,1);
  assert.equal(f.a.getCombat().getAutocastSpell()===core.CombatSpells.WIND_STRIKE,true);
  assert.equal(core.Autocasting.isActive(f.a),false);assert.equal(CombatFactory.getMethod(f.a)===CombatFactory.MELEE_COMBAT,true);
  const before=mInventory(f.a),frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(f.b.getIndex(),2);await wire(f.a,frame);tick(8);
  assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);assert.ok(f.trace.hits.every(h=>h.getCombatType()===core.CombatType.MELEE));
});

mTest('last rune pays one manual cast and a second native spell has no payment or hit',async t=>{
  const f=await mGame(t),I=core.ItemIdentifiers;f.a.getInventory().resetItems();f.a.getInventory().add(new core.Item(I.AIR_RUNE,1));f.a.getInventory().add(new core.Item(I.MIND_RUNE,1));
  const hit=await mFire(f);mLand(f,hit);assert.equal(f.a.getInventory().getAmount(I.AIR_RUNE),0);assert.equal(f.a.getInventory().getAmount(I.MIND_RUNE),0);
  const hp=f.b.getHitpoints();await mSpell(f.a,f.b,'WIND_STRIKE');tick(15);assert.equal(f.trace.commits.length,1);assert.equal(f.trace.hits.length,1);assert.equal(f.b.getHitpoints(),hp);
});

for(const element of['fire','water','earth'])mTest('empty '+element+' tome and matching missing elemental runes cannot create free casts',async t=>{
  const f=await mGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I['TOME_OF_'+element.toUpperCase()+'_EMPTY_'],core.Equipment.SHIELD_SLOT);const book=mTome(f.a,element,0),rune=I[element.toUpperCase()+'_RUNE'];
  f.a.getInventory().deleteNumber(rune,f.a.getInventory().getAmount(rune));const before=resources(f.a);await mSpell(f.a,f.b,element.toUpperCase()+'_WAVE');tick(12);
  assert.deepEqual(resources(f.a),before);assert.equal(book.Common.read(book.item).charges,0);assert.equal(f.trace.commits.length,0);
});

mTest('nonmatching tome keeps its charge while ordinary inventory runes pay the cast',async t=>{
  const f=await mGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I.TOME_OF_FIRE_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'fire',2),cost=mCost(f.a,core.CombatSpells.WATER_WAVE),before=mAmounts(f.a,cost);
  const hit=await mFire(f,'WATER_WAVE');mPaid(f.a,cost,before);assert.equal(book.Common.read(book.item).charges,2);mLand(f,hit);
});

mTest('searing last-charge context survives the paid cast without a second charge decision',async t=>{
  const f=await mGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I.TOME_OF_FIRE_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'fire',1,true);
  const hit=await mFire(f,'FIRE_SURGE'),snapshot=hit.getSpellContext().data.get(require('../plugins/items/elementaltomes/Combat.ElementalTomes').CAST_DATA_KEY);
  assert.equal(snapshot.element,'fire');assert.equal(snapshot.searing,true);assert.equal(book.Common.read(book.item).charges,0);mLand(f,hit);assert.equal(book.Common.read(book.item).charges,0);
});

for(const boundary of['victim-leave','caster-leave','victim-logout','caster-logout','channel','finish','caster-death'])mTest('paid pending spell is discarded at Standard '+boundary+' with no refund',async t=>{
  const f=await mGame(t),cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),before=mAmounts(f.a,cost);const hit=await mFire(f);mPaid(f.a,cost,before);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);const paid=mInventory(f.a),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC),hp=f.b.getHitpoints();
  if(boundary==='victim-leave')f.game.area.leave(f.b,false);
  else if(boundary==='caster-leave')f.game.area.leave(f.a,false);
  else if(boundary==='victim-logout')PM.emitPlayerLogout({player:f.b,username:f.b.getUsername()});
  else if(boundary==='caster-logout')PM.emitPlayerLogout({player:f.a,username:f.a.getUsername()});
  else if(boundary==='channel')FC.leave(f.a,true);
  else if(boundary==='finish')f.game.finish(null);
  else{f.a.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(f.a.getHitpoints(),core.HitMask.RED).setSource(f.b)]);tick();}
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);
  for(const p of[f.a,f.b])p.setNeedsPlacement(false);tick(35);
  assert.deepEqual(mInventory(f.a),paid);assert.equal(f.a.getSkillManager().getExperience(core.Skill.MAGIC),xp);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.trace.resolved.includes(hit),false);
});

mTest('actual fired lethal spell protects remaining carried items and returns the victim to jail then rejoin',async t=>{
  const f=await mGame(t),I=core.ItemIdentifiers;give(f.b,I.RUNE_POUCH,'M-safe-pouch');
  const Pouch=require('../plugins/items/runepouch/Common.RunePouch');Pouch.setSlots(f.b,[{id:I.MIND_RUNE,amount:12},null,null,null]);
  const inventory=mInventory(f.b);f.b.setHitpoints(1);const hit=await mFire(f);mLand(f,hit);
  for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();assert.equal(f.game.jailed.has(f.b),true,'real cast and death task reach jail');
  assert.deepEqual(mInventory(f.b),inventory);assert.equal(Pouch.amountOf(f.b,I.MIND_RUNE),12);assert.equal(f.game.fighters.has(f.b),false);const score=[0,0];score[f.game.members.get(f.a)]=1;assert.deepEqual(f.game.kills,score);
  await jailExit(f.b,f.game);
  assert.equal(f.game.fighters.has(f.b),true);assert.deepEqual(mInventory(f.b),inventory);assert.equal(Pouch.amountOf(f.b,I.MIND_RUNE),12);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);
});

mTest('entry and rejoin clear foreign incoming generation while preserving owner self pending damage',async t=>{
  mInstall();const a=actor(true),b=actor(true);ruleStats(a,99);ruleStats(b,99);channel(a);channel(b);const game=await negotiate(a,b,2,1,{magic:1});
  const queue=a.getCombat().getHitQueue(),generation=queue.getIncomingGeneration();
  const foreign=new core.PendingHit(b,a,CombatFactory.MELEE_COMBAT,{damage:3,rollAccuracy:false,experience:false,delay:500});CombatFactory.addPendingHit(foreign);
  queue.addPendingDamage([new core.HitDamage(1,core.HitMask.RED).setSource(a)]);await join(a);await join(b);
  assert.ok(queue.getIncomingGeneration()>generation);assert.equal(queue.hasPendingHit(foreign),false);assert.equal(queue.getQueuedDamage(),1,'owner self pending damage survives the entry cancellation');magicTurns=true;tick();assert.equal(a.getHitpoints(),98,'the retained self damage is then processed rather than refunded');
  completePreparation(game);mPosition(game,a,b);game.eliminate(a);game.jailed.add(a);const before=queue.getIncomingGeneration();
  const next=new core.PendingHit(b,a,CombatFactory.MELEE_COMBAT,{damage:3,rollAccuracy:false,experience:false,delay:500});CombatFactory.addPendingHit(next);
  assert.equal(game.rejoin(a),true,'explicit existing jail-state setup exercises the actual rejoin owner');assert.ok(queue.getIncomingGeneration()>before);assert.equal(queue.hasPendingHit(next),false);
});

mTest('native MagicDisabled control refuses ordinary casts and preserves default entry queue behavior',async t=>{
  mInstall();const a=actor(true),b=actor(true);ruleStats(a,99);ruleStats(b,99);channel(a);channel(b);const game=await negotiate(a,b,2,1,{magic:4});
  const queue=a.getCombat().getHitQueue(),generation=queue.getIncomingGeneration();const hit=new core.PendingHit(b,a,CombatFactory.MELEE_COMBAT,{damage:1,rollAccuracy:false,experience:false,delay:500});CombatFactory.addPendingHit(hit);
  await join(a);await join(b);assert.equal(queue.getIncomingGeneration(),generation);assert.equal(queue.hasPendingHit(hit),true,'defaultDisabled does not adopt Standard boundary cancellation');
  queue.clear();completePreparation(game);mPosition(game,a,b);mFund(a);magicTurns=true;const trace=mTrace(t,a,b),before=mInventory(a);await mSpell(a,b,'WIND_STRIKE');tick(12);
  assert.deepEqual(mInventory(a),before);assert.equal(trace.commits.length,0);assert.equal(trace.hits.length,0);
});

mTest('close supplied staging positions still refuse spells until the real preparation boundary',async t=>{
  const f=await mGame(t,{prepare:false}),before=mInventory(f.a);assert.equal(f.game.phase,'staging');await mSpell(f.a,f.b,'WIND_STRIKE');tick(5);
  assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
  completePreparation(f.game);mPosition(f.game,f.a,f.b);const hit=await mFire(f);mLand(f,hit);
});

mTest('same-team and real separate-instance targets cannot spend ordinary spell resources',async t=>{
  const f=await mGame(t),ally=actor(true);ruleStats(ally,99);assert.equal(FC.join(ally,f.a.getUsername(),false),true);await join(ally);ally.setAutoRetaliate(false);
  ally.moveTo(f.game.area.at([3294,4955,0]));ally.setNeedsPlacement(false);AreaManager.process(ally);
  assert.equal(f.game.members.get(ally),f.game.members.get(f.a));let before=mInventory(f.a);await mSpell(f.a,ally,'WIND_STRIKE');tick(6);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
  const other=await mGame(t);assert.equal(other.game.area===f.game.area,false);assert.equal(other.b.getArea()===other.game.area,true);
  assert.notEqual(other.b.getLocation().getX(),f.b.getLocation().getX(),'actual allocated instances have distinct absolute slots');before=mInventory(f.a);await mSpell(f.a,other.b,'WIND_STRIKE');tick(6);assert.deepEqual(mInventory(f.a),before);assert.equal(f.a.getCombat().getTarget()==null,true);
  // Both actual participants remained at their own mapped local tile, never at
  // another instance's absolute coordinate. The positive controls use their own scenes.
  const hit=await mFire(other);mLand(other,hit);
});

mTest('ordinary out-of-range spell pursues through the engine and pays only on a reachable cast',async t=>{
  const f=await mGame(t),Range=require('../dist/game/content/combat/CombatRange').CombatRange;mPosition(f.game,f.a,f.b,12);
  const start=f.a.getLocation().clone(),cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),before=mAmounts(f.a,cost);
  await mSpell(f.a,f.b,'WIND_STRIKE');assert.equal(Range.canReach(f.a,CombatFactory.MAGIC_COMBAT,f.b),false);assert.deepEqual(mAmounts(f.a,cost),before);
  const observe=magicObserve;magicObserve=(kind,e)=>{if(kind==='committed'&&e.player===f.a)assert.equal(Range.canReach(f.a,CombatFactory.MAGIC_COMBAT,f.b),true,'payment occurs at actual reach');observe(kind,e);};
  for(let n=0;n<40&&!f.trace.commits.length;n++)tick();assert.equal(f.trace.commits.length,1);assert.equal(f.a.getLocation().equals(start),false,'actual pursuit moved the caster');mPaid(f.a,cost,before);mLand(f,f.trace.hits[0]);
});

mTest('explicit supplied ray obstruction prevents payment and restoring the real ray permits the positive cast',async t=>{
  const f=await mGame(t),before=mInventory(f.a),ray=t.mock.method(core.RegionManager,'canProjectileAttackBounds',()=>false);
  await mSpell(f.a,f.b,'WIND_STRIKE');tick(6);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
  ray.mock.restore();mPosition(f.game,f.a,f.b);const hit=await mFire(f);mLand(f,hit);
});

mTest('current supplied gear and later native selection are rechecked before a queued cast pays',async t=>{
  const f=await mGame(t);f.a.getCombat().setAttackDelay(8);await mSpell(f.a,f.b,'WIND_STRIKE');tick();assert.equal(f.trace.commits.length,0);
  const before=mInventory(f.a);f.a.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]=new core.Item(core.ItemIdentifiers.ANCIENT_STAFF);
  tick(12);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
  f.a.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]=new core.Item(-1);f.a.getCombat().setAttackDelay(8);
  await mSpell(f.a,f.b,'WIND_STRIKE');await mSpell(f.a,f.b,'TELEBLOCK','Tele Block');tick(12);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
  const hit=await mFire(f);mLand(f,hit);
});

mTest('paid context retains its original target and spell after explicit same-scene target/currentspell changes',async t=>{
  const f=await mGame(t),hit=await mFire(f),context=hit.getSpellContext(),hp=f.b.getHitpoints();
  f.b.moveTo(f.game.area.at([3297,4955,0]));f.b.setNeedsPlacement(false);AreaManager.process(f.b);
  f.a.getCombat().setCastSpell(core.CombatSpells.FIRE_WAVE);mLand(f,hit);
  assert.equal(hit.getTarget()===f.b,true);assert.equal(hit.getSpell()===core.CombatSpells.WIND_STRIKE,true);assert.equal(hit.getSpellContext()===context,true);assert.ok(f.b.getHitpoints()<hp);assert.equal(f.trace.commits.length,1);
});

mTest('mapped Forfeit owner discards a paid queued hit during an explicit impact-processing hold',async t=>{
  const f=await mGame(t),hit=await mFire(f),paid=mInventory(f.a),hp=f.b.getHitpoints();
  // This finite dispatcher composition deliberately holds player impact turns
  // while the actual movement/object route completes. It proves queue ownership,
  // not that natural flight stays airborne for this entire walking interval.
  magicTurns=false;const portal=mappedLayoutObjects(f.game,f.game.layout.exits[f.game.members.get(f.a)])[0];assert.ok(portal);
  const at=portal.getLocation(),ops=portal.getDefinition().getInteractions(),op=ops.findIndex(x=>x?.toLowerCase()==='forfeit')+1;assert.ok(op>0);
  const{ObjectActionPacketListener}=require('../dist/net/packet/impl/ObjectActionPacketListener');new ObjectActionPacketListener().executeAction(f.a,portal.getId(),at.getX(),at.getY(),op);
  for(let n=0;n<120&&C.matches.has(f.a);n++)tick();assert.equal(C.matches.has(f.a),false,'actual mapped object dispatch reaches the registered Forfeit owner');
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);magicTurns=true;f.a.setNeedsPlacement(false);f.b.setNeedsPlacement(false);tick(15);
  assert.deepEqual(mInventory(f.a),paid);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.trace.resolved.includes(hit),false);
});

mTest('a new battle with the same real Players cannot resurrect an old paid spell',async t=>{
  const f=await mGame(t),hit=await mFire(f),paid=mInventory(f.a),old=f.game.area;f.game.finish(null);tick(2);lobby(f.a);lobby(f.b);
  await wire(f.a,Buffer.from([VIEW_CLOSE_PACKET]));await wire(f.b,Buffer.from([VIEW_CLOSE_PACKET]));
  const game=await negotiate(f.a,f.b,2,1,{magic:1});await join(f.a);await join(f.b);completePreparation(game);mPosition(game,f.a,f.b);
  const hp=f.b.getHitpoints();tick(12);assert.equal(game.area===old,false);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(mInventory(f.a),paid);assert.equal(f.b.getHitpoints(),hp);
});

for(const boundary of['leave','finish','safe-caster-death'])mTest('paid pouch runes and tome charges stay spent through '+boundary,async t=>{
  const f=await mGame(t),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');await mEquip(f.a,I.TOME_OF_FIRE_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'fire',2);
  give(f.a,I.RUNE_POUCH,'M-paid-pouch');Pouch.setSlots(f.a,[{id:I.AIR_RUNE,amount:10},null,null,null]);f.a.getInventory().deleteNumber(I.AIR_RUNE,f.a.getInventory().getAmount(I.AIR_RUNE));
  const hit=await mFire(f,'FIRE_WAVE');assert.equal(Pouch.amountOf(f.a,I.AIR_RUNE),5);assert.equal(book.Common.read(book.item).charges,1);const paid=mInventory(f.a),hp=f.b.getHitpoints();
  if(boundary==='leave')f.game.area.leave(f.a,false);else if(boundary==='finish')f.game.finish(null);else{f.a.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(f.a.getHitpoints(),core.HitMask.RED).setSource(f.b)]);tick();}
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);tick(35);assert.deepEqual(mInventory(f.a),paid);assert.equal(Pouch.amountOf(f.a,I.AIR_RUNE),5);assert.equal(book.Common.read(f.a.getEquipment().get(core.Equipment.SHIELD_SLOT)).charges,1);assert.equal(f.b.getHitpoints(),hp);
});

for(const magic of[1,4])mTest('existing NORMAL utility remains native and nonNORMAL self magic refused at Magic'+magic,async t=>{
  const f=await mGame(t,{rules:{magic}}),I=core.ItemIdentifiers;give(f.a,I.BONES,'M-utility');const meta=core.CacheDefinitions.getSpellByName('Bones to Bananas');assert.ok(meta);
  const{EffectSpells}=require('../dist/game/content/combat/magic/EffectSpells'),utility=EffectSpells.BONES_TO_BANANAS;
  const cost=mCost(f.a,utility),amounts=mAmounts(f.a,cost),before=f.a.getInventory().getAmount(I.BANANA);
  await nativeButton(f.a,meta.widgetId,1,65535,meta.itemId);assert.ok(f.a.getInventory().getAmount(I.BANANA)>before);mPaid(f.a,cost,amounts);
  assert.equal(f.trace.commits.length,1,'successful ordinary utility legitimately commits its paid cast');
  assert.equal(f.trace.commits[0].spell===utility,true);assert.equal(f.trace.commits[0].context.spell===utility,true);assert.equal(f.trace.commits[0].context.data instanceof Map,true);
  assert.equal(f.trace.hits.length,0,'the paid utility creates no ordinary combat pending hit');assert.equal(f.trace.resolved.length,0);
  f.a.setSpellbook(core.MagicSpellbook.LUNAR);f.a.getInventory().add(new core.Item(I.ASTRAL_RUNE,20));const inventory=mInventory(f.a);
  assert.equal(EffectSpells.handleSpell(f.a,EffectSpells.VENGEANCE.spellId()),true);
  assert.deepEqual(mInventory(f.a),inventory);assert.equal(f.a.hasVengeanceReturn(),false);
});

mTest('Oddskull integration keeps holder cast refusal and permits an incoming paid elemental hit',async t=>{
  const f=await mGame(t,{mode:21});uCheckpoint(f.b,f.game,[3293,4958,0]);await uTake(f.b,uNpc(f.game));uHeld(f.b,f.game);
  mPosition(f.game,f.a,f.b);const heldInventory=mInventory(f.b),attackerHp=f.a.getHitpoints();
  await mSpell(f.b,f.a,'WIND_STRIKE');tick(8);f.b.getCombat().reset();
  assert.deepEqual(mInventory(f.b),heldInventory);assert.equal(f.a.getHitpoints(),attackerHp);uHeld(f.b,f.game);
  const cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),before=mAmounts(f.a,cost),hp=f.b.getHitpoints();
  const hit=await mFire(f);mPaid(f.a,cost,before);mLand(f,hit);
  assert.ok(f.b.getHitpoints()<hp);uHeld(f.b,f.game);
});

mTest('Oddskull elimination releases its token before Standard queued-hit disposal without rune refund',async t=>{
  const f=await mGame(t,{mode:21});uCheckpoint(f.b,f.game,[3293,4958,0]);await uTake(f.b,uNpc(f.game));uHeld(f.b,f.game);
  mPosition(f.game,f.a,f.b);const cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),before=mAmounts(f.a,cost);
  const hit=await mFire(f);mPaid(f.a,cost,before);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);
  const paid=mInventory(f.a),hp=f.b.getHitpoints();f.game.eliminate(f.b);
  assert.equal(uIssued(f.b).length,0);assert.equal(f.game.oddskull.kind,'ground');
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);tick(12);uNpc(f.game);
  assert.deepEqual(mInventory(f.a),paid);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.trace.resolved.includes(hit),false);
});

mTest('merged styles pay for elemental spell and ordinary bow while MeleeDisabled refuses native dagger start',async t=>{
  const f=await mGame(t,{rules:{melee:1,ranged:0}}),{a,b,game}=f;
  assert.deepEqual([game.rules.melee,game.rules.ranged,game.rules.magic],[1,0,1]);
  const spell=core.CombatSpells.WIND_STRIKE,cost=mCost(a,spell),before=mAmounts(a,cost),hp=b.getHitpoints();
  const hit=await mFire(f);mPaid(a,cost,before);a.getCombat().reset();mLand(f,hit);
  assert.ok(b.getHitpoints()<hp,'actual canonical paid elemental hit lands with Melee disabled');
  magicTurns=false;magicObserve=null;magicRollControl=null;
  await bowEquip(a);bowPlace(a,b,game);const spellPaid=mAmounts(a,cost),afterSpellHP=b.getHitpoints();
  const shot=await bowFire(t,a,b);assert.equal(shot.before-shot.after,1);bowImpacts(shot.delay+2);
  assert.ok(b.getHitpoints()<afterSpellHP,'independently allowed ordinary arrow actually lands');
  assert.deepEqual(mAmounts(a,cost),spellPaid,'the bow creates no further spell cost or refund');
  await tEquip(a,core.ItemIdentifiers.DRAGON_DAGGER);nmPlace(game,a,b);
  assert.equal(CombatFactory.getMethod(a).type(),core.CombatType.MELEE,'real equipment change selects melee');
  const refused=nmTrace(t,a,b),paid=resources(a),afterRangedHP=b.getHitpoints();
  try{
    ghastTurns=true;await nmAttack(a,b);nmEngineUntil(()=>refused.permissions.length>0);a.getCombat().reset();
    assert.ok(refused.attacks.includes(b));assert.ok(refused.methods.some(m=>m.type()===core.CombatType.MELEE));
    assert.ok(refused.permissions.some(x=>x.method?.type()===core.CombatType.MELEE&&x.result===false));
    assert.equal(refused.prepared.length,0);assert.equal(refused.started.length,0);assert.equal(refused.queued.length,0);assert.equal(refused.resolved.length,0);
    assert.deepEqual(resources(a),paid);assert.equal(b.getHitpoints(),afterRangedHP);
  }finally{nmObserve=null;nmRoll=null;ghastTurns=false;}
});

mTest('Standard boundary cancels actual paid incoming bow hit on mapped Forfeit without refund or removing owned floor',async t=>{
  let ally;
  const f=await mGame(t,{rules:{melee:1,ranged:0},beforeEntry:async(a,b,game)=>{
    ally=actor(true);ruleStats(ally,99);assert.equal(FC.join(ally,b.getUsername(),false),true);
    await join(ally);assert.equal(game.members.get(ally),game.channelKeys.indexOf(C.channel(b).key));
  }}),{a,b,game}=f;
  assert.equal(game.rules.magic,1);assert.equal(game.members.size,3);
  magicTurns=false;magicRollControl=null;await bowEquip(a);bowPlace(a,b,game);
  const queue=b.getCombat().getHitQueue(),realProcess=queue.process.bind(queue),hp=b.getHitpoints(),runes=mInventory(a);
  // Explicit impact-processing hold, as in existing queue lifecycle fixtures. This
  // reaches the real native paid producer and mapped departure before resolution;
  // it is not a claim about natural arrow flight or traversal duration.
  const hold=t.mock.method(queue,'process',()=>{});
  const shot=await bowFire(t,a,b);assert.equal(shot.before-shot.after,1);
  const pending=f.trace.hits.find(h=>h.getCombatMethod()===CombatFactory.RANGED_COMBAT);
  assert.ok(pending,'actual canonical native arrow produced a PendingHit');assert.equal(queue.hasPendingHit(pending),true);
  const generation=queue.getIncomingGeneration();
  await nmForfeit(b,game);assert.equal(game.phase,'combat','real opposite teammate keeps firing instance alive');
  assert.equal(C.matches.has(b),false);assert.equal(game.members.has(ally),true);
  assert.ok(queue.getIncomingGeneration()>generation);assert.equal(queue.hasPendingHit(pending),false,'Standard participation owner removes actual foreign queued arrow');
  hold.mock.restore();b.setNeedsPlacement(false);realProcess(C.now());bowImpacts(shot.delay+3);
  assert.equal(f.trace.resolved.includes(pending),false);assert.equal(b.getHitpoints(),hp);
  assert.equal(bowAmount(a),shot.after,'paid ammunition is never refunded');assert.deepEqual(mInventory(a),runes,'no rune accounting change without a spell');
  const floor=bowFloor(game,bowItem('IRON_ARROW'));assert.equal(floor.length,1);
  assert.equal(floor[0].getItem().getAmount(),1);assert.equal(floor[0].getOwner(),a.getUsername());assert.equal(floor[0].getPrivateArea(),game.area);
});

// F: native Ignore freezing checkbox and actual canonical weapon producers.
// Actor positions, accuracy and poison draws below are explicit supplied controls.
// Inert transport and deterministic ticks do not establish rendered/retail parity.
let fInstalled=false;
function fInstall(){
  if(fInstalled)return;
  const api=PM.createApi('ClanWarsFActualProducers');
  require('../plugins/items/ItemDefinitionLoader.plugin').register(api);
  require('../plugins/combat/specials/AbyssalTentacle.SpecialAttack')(api);
  require('../plugins/combat/specials/ZamorakGodsword.SpecialAttack')(api);
  require('../plugins/combat/Freezes.plugin').register(api);
  const startup=[],itemApi=PM.createApi('ClanWarsFTentacleCharges');
  // Capture only this module's genuine attach callback; never replay global startup.
  require('../plugins/items/AbyssalTentacle.plugin').register({...itemApi,onServerStartup:fn=>startup.push(fn)});
  assert.equal(startup.length,1);startup[0]();fInstalled=true;
}
async function fGame(freezing=1,prepare=true,withAlly=false,rules={}){
  fInstall();const a=actor(true),b=actor(true),ally=withAlly?actor(true):null;
  for(const p of[a,b,...(ally?[ally]:[])])ruleStats(p,99);channel(a);channel(b,ally?[ally]:[]);
  const game=await negotiate(a,b,null,1,{...rules,freezing});await join(a);await join(b);if(ally)await join(ally);
  if(prepare)completePreparation(game);
  return{a,b,game,ally};
}
function fTrace(t,target){
  const rows={attempts:[],timers:[],resets:0,effectTimers:[],messages:[],events:[],watches:[],poison:[]};
  const forward=(object,key,record)=>{const real=object[key].bind(object);t.mock.method(object,key,function(...args){record(...args);return real(...args);});};
  forward(CombatFactory,'freezeTicks',(...args)=>{if(args[0]===target)rows.attempts.push(args);});
  forward(target.getTimers(),'registers',(key,ticks)=>{if(key===core.TimerKey.FREEZE||key===core.TimerKey.FREEZE_IMMUNITY)rows.timers.push([key,ticks]);});
  forward(target.getMovementQueue(),'reset',()=>rows.resets++);
  forward(target.getPacketSender(),'sendEffectTimer',(...args)=>rows.effectTimers.push(args));
  forward(target,'sendMessage',m=>rows.messages.push(m));
  forward(PM,'emitCustomEvent',(name,e)=>{if(e?.target===target&&['combat:freeze-duration','combat:frozen'].includes(name))rows.events.push(name);});
  forward(core.TaskManager,'submit',task=>{if(task.constructor.name==='FreezeWatch')rows.watches.push(task);});
  forward(CombatFactory,'poisonEntity',(p,...args)=>{if(p===target)rows.poison.push(args);});
  return rows;
}
function fNoNewEffects(trace){
  assert.deepEqual(trace.timers,[]);assert.deepEqual(trace.events,[]);
  assert.deepEqual(trace.effectTimers,[]);assert.deepEqual(trace.watches,[]);
  assert.equal(trace.messages.some(m=>/You have been frozen/.test(m)),false);
}

for(const offerer of[0,1])test(`native F checkbox captain${offerer} decoded bit17, refusal resync and frozen confirm/join`,async()=>{
  const a=actor(true),b=actor(true),players=[a,b];channel(a);channel(b);
  const scripts=players.map(scriptCalls);await challenge(a,b);await challenge(b,a);
  const session=C.negotiations.get(a),chosen=players[offerer],other=players[1-offerer];
  const bitId=core.CacheDefinitions.getVarbitId('clanwars_freezing'),def=core.CacheDefinitions.getVarbit(bitId);
  assert.equal(bitId,4279);assert.equal(def.startBit,17);assert.equal(def.endBit,17);
  // Bit29 belongs to playercap (bits28..30). Establish its nonzero state through
  // the real cap dropdown, rather than injecting a contradictory packed value.
  const capId=core.CacheDefinitions.getVarbitId('clanwars_playercap'),capDef=core.CacheDefinitions.getVarbit(capId);
  assert.equal(capId,8379);assert.equal(capDef.baseVar,def.baseVar);assert.equal(capDef.startBit,28);assert.equal(capDef.endBit,30);
  await click(chosen,'clanwars_setup:dropdown_playercap',3);assert.equal(session.rules.playercap,2);
  for(const p of players)assert.equal(p.getPacketSender().getVarbit(capId),2,'native 5v5 offer reaches both authoritative cap fields');
  tick(9); // Complete this cap change's ordinary opponent acceptance delay.
  const before={...session.rules};
  await click(other,'clanwars_setup:accept');assert.equal(session.accepted.has(other),true);
  const packed=players.map(p=>p.getPacketSender().getVarp(def.baseVar));
  for(const value of packed)assert.notEqual(value&(1<<29),0,'snapshot contains the legitimately negotiated cap bit');
  const frame=clickFrame('clanwars_setup:other',0),decoded=decodeClientPackets(frame);
  assert.equal(decoded.length,1);assert.equal(decoded[0].slot,0);assert.equal(decoded[0].buttonNum,1);
  await wire(chosen,frame);assert.equal(session.rules.freezing,1);assert.equal(session.accepted.size,0);
  for(const[key,value]of Object.entries(before))if(key!=='freezing')assert.equal(session.rules[key],value,key);
  players.forEach((p,i)=>{assert.equal(p.getPacketSender().getVarbit(bitId),1);assert.equal(p.getPacketSender().getVarp(def.baseVar),packed[i]|(1<<17));});
  await click(other,'clanwars_setup:accept');assert.equal(session.accepted.has(other),false,'nine-tick opponent delay remains');
  tick(9);await click(other,'clanwars_setup:accept');assert.equal(session.accepted.has(other),true);
  const revision=session.revision;
  for(const[op,slot]of [[2,0],[1,65535],[1,1],[1,2],[1,3],[1,6],[1,9],[1,12],[1,14]]){
    // Model the client optimistic packed-bit change; authoritative resend must undo it.
    C.bit(chosen,'clanwars_freezing',0);
    await nativeButton(chosen,'clanwars_setup:other',op,slot);
    assert.equal(session.rules.freezing,1);assert.equal(session.revision,revision);
    assert.equal(session.accepted.has(other),true);assert.equal(chosen.getPacketSender().getVarbit(bitId),1);
    assert.equal(other.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_accept')),1);
  }
  // Explicitly toggle off and back on through the same native row, rather than setting rules.
  await click(chosen,'clanwars_setup:other',0);assert.equal(session.rules.freezing,0);
  await click(chosen,'clanwars_setup:other',0);assert.equal(session.rules.freezing,1);
  tick(9);await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');
  for(const calls of scripts)assert.match(calls.filter(([id])=>id===554).at(-1)[2],/TSPS policy.*active fighters ignore new freezes/);
  tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');
  const game=C.channelGames.get(C.channel(a).key);assert.equal(game.rules.freezing,1);assert.equal(Object.isFrozen(game.rules),true);
  for(const p of players)await join(p);
  for(const calls of scripts)assert.match(calls.filter(([id])=>id===554).at(-1)[2],/Existing freezes.*not removed.*Damage, poison and special-attack costs still apply/);
  assert.equal(game.rules.freezing,1);
});

for(const weapon of['tentacle','zgs'])for(const accurate of[true,false])for(const freezing of[0,1])test(`native F ${weapon} accurate${accurate} Ignore${freezing} actual paid producer`,async t=>{
  const{a,b,game}=await fGame(freezing);
  const id=weapon==='tentacle'?core.ItemIdentifiers.ABYSSAL_TENTACLE:core.ItemIdentifiers.ZAMORAK_GODSWORD;
  await tEquip(a,id);assert.equal(a.getCombatSpecial().getId(),weapon==='tentacle'?'abyssal_tentacle':'zamorak_godsword');
  tCheckpoint(game,a,b);await tTarget(a,b);await nativeButton(a,'orbs:specbutton');assert.equal(a.isSpecialActivated(),true);
  const trace=fTrace(t,b),resolved=[];
  ghastObserve=(kind,e)=>{if(kind==='resolved'&&e.attacker===a&&e.target===b)resolved.push(e.hit);};
  ghastRollControl=e=>{if(e.attacker===a&&e.target===b){e.forceAccurate=accurate;e.forceMaxHit=true;}};
  const accuracy=require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc').AccuracyFormulasDpsCalc;
  // A supplied zero successful accuracy roll tests the producer's genuine miss branch.
  if(!accurate)t.mock.method(accuracy,'rollAccuracyCount',()=>0);
  const random=t.mock.method(Math,'random',()=>0.01); // selects canonical special poison branch, not a probability measurement
  const hp=b.getHitpoints(),charges=weapon==='tentacle'?require('../plugins/items/AbyssalTentacle.plugin')._test.charges(a.getEquipment().get(core.Equipment.WEAPON_SLOT)):null;
  ghastTurns=true;
  try{
    for(let i=0;i<20&&a.getSpecialPercentage()===100;i++)tick();
    assert.equal(a.getSpecialPercentage(),50,'actual canonical special paid exactly once');a.getCombat().reset();
    for(let i=0;i<8&&resolved.length===0;i++)tick();
  }finally{ghastTurns=false;ghastObserve=null;ghastRollControl=null;random.mock.restore();}
  assert.equal(resolved.length,1);assert.equal(resolved[0].isAccurate(),accurate);
  if(accurate){assert.ok(resolved[0].getTotalDamage()>0);assert.ok(b.getHitpoints()<hp,'actual damage lands independently of Ignore');}
  else assert.equal(resolved[0].getTotalDamage(),0);
  const attempted=weapon==='tentacle'||accurate,applied=attempted&&!freezing,duration=weapon==='tentacle'?8:32;
  assert.equal(trace.attempts.length,attempted?1:0,'actual producer preserves activation versus accurate-impact condition');
  if(attempted){assert.equal(trace.attempts[0][1],duration);assert.equal(trace.attempts[0][3],a);}
  if(applied){
    assert.deepEqual(trace.timers,[[core.TimerKey.FREEZE,duration],[core.TimerKey.FREEZE_IMMUNITY,duration+5]]);
    assert.deepEqual(trace.events,['combat:freeze-duration','combat:frozen']);assert.equal(trace.effectTimers.length,1);assert.equal(trace.watches.length,1);
    assert.equal(b.getTimers().has(core.TimerKey.FREEZE),true);
  }else{fNoNewEffects(trace);assert.equal(b.getTimers().has(core.TimerKey.FREEZE),false);assert.equal(b.getTimers().has(core.TimerKey.FREEZE_IMMUNITY),false);}
  if(weapon==='tentacle'){
    assert.equal(require('../plugins/items/AbyssalTentacle.plugin')._test.charges(a.getEquipment().get(core.Equipment.WEAPON_SLOT)),charges-1);
    assert.ok(trace.poison.some(([severity,orb])=>severity===20&&orb===1),'independent canonical activation poison still runs');
  }
  assert.equal(a.getSpecialPercentage(),50,'Ignore creates no refund');
  // Actual decoded walking while the applied bind is still live; no timer clearing/repair.
  const from=position(b),to=game.area.at([3295,4955,0]);
  assert.equal(core.RegionManager.canMovestart(b.getLocation(),to,1,1,game.area),true);
  await dispatchFrameNow(b,walkClickFrame(to));b.getMovementQueue().beginCycle();b.getMovementQueue().process();
  assert.equal(JSON.stringify(position(b))!==JSON.stringify(from),!applied,'new freeze alone governs ordinary movement');
  console.log('FREEZING_ACTUAL_PRODUCER '+JSON.stringify({weapon,accurate,freezing,attempted,applied,durationTicks:duration,energy:a.getSpecialPercentage(),rawDamage:resolved[0].getTotalDamage(),poisonAttempts:trace.poison.length}));
});

// These supplied factory inputs prove source metadata cannot change target protection;
// they do not claim native attack permission or native attacks from every source category.
for(const origin of['opponent','teammate','self','null','npc','foreign','departed'])test(`F supplied ${origin} source actual factory protects current target before side effects`,async t=>{
  const{a,b,game,ally}=await fGame(1,true,origin==='teammate');let source=a;
  if(origin==='teammate'){source=ally;assert.equal(game.fighters.get(ally),game.fighters.get(b));}
  if(origin==='self')source=b;
  if(origin==='null')source=null;
  if(origin==='npc')source={isPlayer:()=>false,isNpc:()=>true};
  if(origin==='foreign')source=actor(true);
  if(origin==='departed'){game.remove(a,false);source=a;}
  assert.equal(game.area.canFreeze(b),false);const trace=fTrace(t,b);
  CombatFactory.freezeTicks(b,8,undefined,source);assert.equal(trace.attempts.length,1);fNoNewEffects(trace);assert.equal(trace.resets,0);
  assert.equal(b.getTimers().has(core.TimerKey.FREEZE),false);assert.equal(b.getTimers().has(core.TimerKey.FREEZE_IMMUNITY),false);
});

test('F actual staging freeze and immunity carry unchanged into active Ignore; no retroactive thaw',async t=>{
  const{a,b,game}=await fGame(1,false);assert.equal(game.area.canFreeze(b),null);
  b.moveTo(a.getLocation().clone().add(1,0));b.setNeedsPlacement(false);AreaManager.process(b);
  CombatFactory.freezeTicks(b,32,undefined,a);
  const timers=b.getTimers(),freeze=timers.timers().get(core.TimerKey.FREEZE),immune=timers.timers().get(core.TimerKey.FREEZE_IMMUNITY);
  assert.ok(freeze);assert.ok(immune);const before=[freeze.ticks(),immune.ticks()];
  completePreparation(game);assert.equal(game.area.canFreeze(b),false);
  assert.equal(timers.timers().get(core.TimerKey.FREEZE),freeze);assert.equal(timers.timers().get(core.TimerKey.FREEZE_IMMUNITY),immune);
  assert.deepEqual([freeze.ticks(),immune.ticks()],before);
  const trace=fTrace(t,b);CombatFactory.freezeTicks(b,8,undefined,a);fNoNewEffects(trace);assert.equal(trace.resets,0);
  assert.deepEqual([freeze.ticks(),immune.ticks()],before,'existing state returns before the new policy');
});

for(const boundary of['member-side','fighter-side','match-identity','viewer','jailed','private-area','current-area','world-identity','expired','over'])test(`F supplied target ${boundary} boundary is neutral`,async t=>{
  const{a,b,game}=await fGame();assert.equal(game.area.canFreeze(b),false);
  const side=game.members.get(b),ends=game.ends;
  try{
    // Change one actual ownership/state predicate at a time; no freeze application is
    // manufactured here. Production lifecycle controls above cover real join/start/remove.
    if(boundary==='member-side')game.members.set(b,2);
    if(boundary==='fighter-side')game.fighters.set(b,1-game.members.get(b));
    if(boundary==='match-identity')C.matches.delete(b);
    if(boundary==='viewer')game.viewers.add(b);
    if(boundary==='jailed')game.jailed.add(b);
    if(boundary==='private-area')t.mock.method(b,'getPrivateArea',()=>null);
    if(boundary==='current-area')t.mock.method(b,'getArea',()=>null);
    if(boundary==='world-identity'){const list=core.World.getPlayers(),real=list.search.bind(list);t.mock.method(list,'search',predicate=>real(p=>p!==b&&predicate(p)));}
    if(boundary==='expired')game.ends=C.now();
    if(boundary==='over')game.phase='over';
    assert.equal(game.area.canFreeze(b),null);
  }finally{
    t.mock.restoreAll();game.members.set(b,side);game.fighters.set(b,side);C.matches.set(b,game);game.viewers.delete(b);game.jailed.delete(b);game.ends=ends;game.phase='combat';
  }
});


test('native F Ignore freezing retains paid permitted bow and independently refused melee start',async t=>{
  const{a,b,game}=await fGame(1,true,false,{melee:1,ranged:0});
  assert.deepEqual([game.rules.melee,game.rules.ranged,game.rules.freezing],[1,0,1]);
  assert.equal(game.area.canFreeze(b),false,'active target owns Ignore, independently of attack style');
  await bowEquip(a);bowPlace(a,b,game);const hp=b.getHitpoints(),freeze=fTrace(t,b);
  const shot=await bowFire(t,a,b);assert.equal(shot.before-shot.after,1);bowImpacts(shot.delay+2);
  assert.ok(b.getHitpoints()<hp,'Ignore grants no damage immunity to the real paid arrow');
  assert.equal(bowAmount(a),shot.after);fNoNewEffects(freeze);
  await tEquip(a,core.ItemIdentifiers.DRAGON_DAGGER);nmPlace(game,a,b);
  assert.equal(CombatFactory.getMethod(a).type(),core.CombatType.MELEE);
  const refused=nmTrace(t,a,b),paid=resources(a),afterArrow=b.getHitpoints();
  try{
    ghastTurns=true;await nmAttack(a,b);nmEngineUntil(()=>refused.permissions.length>0);a.getCombat().reset();
    assert.ok(refused.attacks.includes(b));assert.ok(refused.methods.some(m=>m.type()===core.CombatType.MELEE));
    assert.ok(refused.permissions.some(x=>x.method?.type()===core.CombatType.MELEE&&x.result===false));
    assert.equal(refused.prepared.length,0);assert.equal(refused.started.length,0);assert.equal(refused.queued.length,0);assert.equal(refused.resolved.length,0);
    assert.deepEqual(resources(a),paid);assert.equal(b.getHitpoints(),afterArrow);assert.equal(game.area.canFreeze(b),false);
  }finally{nmObserve=null;nmRoll=null;ghastTurns=false;}
});

mTest('Ignore freezing retains finite Standard payment and vetoes a newly permitted binding hold',async t=>{
  cInstall();const f=await mGame(t,{rules:{freezing:1,melee:1,ranged:0}}),{a,b,game}=f;
  assert.deepEqual([game.rules.freezing,game.rules.melee,game.rules.ranged,game.rules.magic],[1,1,0,1]);assert.equal(game.area.canFreeze(b),false);
  const trace=fTrace(t,b),hp=b.getHitpoints(),cost=mCost(a,core.CombatSpells.BIND),before=mAmounts(a,cost),bound=await mFire(f,'BIND');bStop(f);mPaid(a,cost,before);mLand(f,bound);
  assert.equal(b.getHitpoints(),hp);assert.equal(trace.attempts.length,1);fNoNewEffects(trace);tick(10);
  const elemental=mCost(a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(a,elemental),hit=await mFire(f);bStop(f);mPaid(a,elemental,amounts);mLand(f,hit);
  assert.ok(b.getHitpoints()<hp);assert.equal(f.trace.commits.length,2);assert.equal(trace.attempts.length,1);fNoNewEffects(trace);assert.equal(game.area.canFreeze(b),false);
  assert.match(require('../plugins/minigames/clanwars/Rules.ClanWars').summary(game.rules),/discard queued battle hits without refund/);
});

// B: finite Binding-only native casts. Cache declarations come from immutable
// rev242 dump.obj + magic_spellbook.if3, commit853150e3; no effect-ID substitution.
const B_ROWS=[['BIND','Bind',3283,23,20,0,8],['SNARE','Snare',3300,42,50,2,16],['ENTANGLE','Entangle',3322,69,79,5,24]];
let bInstalled=false;
function bInstall(){
  if(bInstalled)return;
  assert.equal(actors.length,0,'canonical loaders run before binding actors exist');
  mInstall();fInstall(); // Their one-time guards prevent replay over live actors.
  const api=PM.createApi('ClanWarsBCanonicalBindings');
  require('../plugins/combat/StandardBindings.plugin').register(api);
  require('../plugins/items/BlightedSpellSacks.plugin').register(api);
  require('../plugins/combat/LunarCures.plugin').register(api);
  require('../plugins/combat/SpellTeleports.plugin').register(api);
  bInstalled=true;
}
function bMetadata(row){
  const[name,label,itemId,child,level]=row,meta=core.CacheDefinitions.getSpellByName(label);
  assert.deepEqual(meta,{itemId,widgetId:(218<<16)|child},'actual cache equals pinned native declaration');
  assert.equal(core.CacheDefinitions.getSpellName(meta.widgetId,meta.itemId),label);
  const requirements=core.CacheDefinitions.getSpellRequirements(label),spell=core.CombatSpells[name];
  assert.equal(requirements.level,level);assert.equal(spell.levelRequired(),level);assert.equal(spell.getSpellbook(),core.MagicSpellbook.NORMAL);
  const nativeCosts={BIND:[2,3,3],SNARE:[3,4,4],ENTANGLE:[4,5,5]}[name];
  assert.deepEqual(requirements.runes,[{id:core.ItemIdentifiers.NATURE_RUNE,amount:nativeCosts[0]},{id:core.ItemIdentifiers.WATER_RUNE,amount:nativeCosts[1]},{id:core.ItemIdentifiers.EARTH_RUNE,amount:nativeCosts[2]}],"actual cache preserves source param rune order");
  assert.deepEqual(requirements.runes.map(x=>[x.id,x.amount]).sort((a,b)=>a[0]-b[0]),spell.itemsRequired(null).map(x=>[x.getId(),x.getAmount()]).sort((a,b)=>a[0]-b[0]));
  return meta;
}
// These declarations share group218; their canonical spellbook is checked at the actual hook, not inferred from the group.
const B_UTILITY={
  'Bones to Bananas':[3280,20,15], 'High Level Alchemy':[3303,47,55],
  'Cure Other':[9110,114,68], 'Cure Me':[9113,118,71], 'Varrock Teleport':[3286,26,25],
};
function bUtilityMetadata(name){
  const[id,child,level]=B_UTILITY[name],meta=core.CacheDefinitions.getSpellByName(name);
  assert.deepEqual(meta,{itemId:id,widgetId:(218<<16)|child});assert.equal(core.CacheDefinitions.getSpellName(meta.widgetId,meta.itemId),name);
  assert.equal(core.CacheDefinitions.getSpellRequirements(name).level,level);return meta;
}
async function bGame(t,options={}){
  bInstall();return mGame(t,{...options,rules:{magic:3,...options.rules}});
}
function bArmour(p,count){
  for(const[index,[slot,name]]of [[core.Equipment.HEAD_SLOT,'SWAMPBARK_HELM'],[core.Equipment.BODY_SLOT,'SWAMPBARK_BODY'],[core.Equipment.LEG_SLOT,'SWAMPBARK_LEGS']].entries())
    p.getEquipment().getItems()[slot]=new core.Item(index<count?core.ItemIdentifiers[name]:-1);
  core.BonusManager.update(p);
}
function bStop(f){f.a.getCombat().reset();}
function bTimerOracle(trace,ticks){
  assert.deepEqual(trace.timers,[[core.TimerKey.FREEZE,ticks],[core.TimerKey.FREEZE_IMMUNITY,ticks+5]]);
  assert.equal(trace.events.filter(x=>x==='combat:frozen').length,1);
}
for(const offerer of[0,1])mTest('B native3 captain'+offerer+' full offer acceptance confirmation and join',async t=>{
  bInstall();const a=actor(true),b=actor(true);channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  const session=C.negotiations.get(a),players=[a,b],p=players[offerer],scripts=scriptCalls(p),lines=messagesOf(p);
  await click(a,'clanwars_setup:accept');const revision=session.revision;
  await nativeButton(p,'clanwars_setup:dropdown_magic',1,4);
  assert.equal(session.rules.magic,3);assert.equal(session.revision,revision+1);assert.equal(session.accepted.size,0);
  assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_magic')),3);
  for(const slot of[1,0,6,65535]){await nativeButton(p,'clanwars_setup:dropdown_magic',1,slot);assert.equal(session.rules.magic,3);assert.equal(session.revision,revision+1);}
  await nativeButton(p,'clanwars_setup:dropdown_magic',2,5);assert.equal(session.rules.magic,3);
  tick(9);await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');
  assert.equal(session.confirmRevision,session.revision);const terms=scripts.findLast(x=>x[0]===554)[2];
  assert.match(terms,/Bind, Snare and Entangle/);assert.match(terms,/utility spells/);assert.match(terms,/queued incoming and still-queued outgoing/);assert.match(terms,/pre-entry hits/);
  tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(game.rules.magic,3);
  await join(a);await join(b);assert.ok(scripts.some(x=>x[0]===554&&x[1]===1&&x[2]===terms));assert.ok(lines.some(x=>/including utility spells/.test(x)));
});
for(const melee of[0,1])for(const ranged of[0,1])for(const magic of[1,3,4])mTest(`B native style copy ${melee}/${ranged}/${magic}`,async t=>{
  bInstall();const a=actor(true),b=actor(true);channel(a);channel(b);const scripts=scriptCalls(a),lines=messagesOf(a),titles=[];
  const sender=a.getPacketSender(),real=sender.sendString.bind(sender);t.mock.method(sender,'sendString',(text,uid)=>{if(uid===C.uid('clanwars_setup:title'))titles.push(text);return real(text,uid);});
  const game=await negotiate(a,b,2,1,{magic,melee,ranged});await join(a);await join(b);
  const terms=scripts.filter(x=>x[0]===554).map(x=>x[2]);assert.ok(terms.length>=2);for(const text of terms){
    if(melee===1&&ranged===1&&magic===4)assert.match(text,/No new player combat/);else assert.doesNotMatch(text,/No new player combat/);
    if(magic===3){assert.match(text,/Binding.only/);assert.match(text,/utility spells/);assert.match(text,/still-queued outgoing/);}
  }
  if(melee===1&&magic===3){assert.ok(titles.some(x=>/binding spells/.test(x)));assert.equal(lines.some(x=>/No new player combat is enabled/.test(x)),false);}
  assert.equal(game.rules.magic,magic);
});
for(const row of B_ROWS)for(const accurate of[true,false])for(const freezing of[0,1])mTest(`B ${row[0]} native accurate${accurate} Ignore${freezing}`,async t=>{
  const f=await bGame(t,{rules:{freezing}});bMetadata(row);magicRollControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.forceAccurate=accurate;e.forceMaxHit=true;}};
  // Supplied hit-damage branch, not a measurement of natural splash probability.
  const controlledSplashes=[];
  if(!accurate)magicDamageControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.accurate=false;e.damage.setDamage(0);controlledSplashes.push(e);}};
  const trace=fTrace(t,f.b),cost=mCost(f.a,core.CombatSpells[row[0]]),before=mAmounts(f.a,cost),hp=f.b.getHitpoints();
  const hit=await mFire(f,row[0]);bStop(f);mPaid(f.a,cost,before);
  if(!accurate){assert.equal(controlledSplashes.length,1);const event=controlledSplashes[0];assert.equal(event.hit,hit);assert.equal(event.combatType,core.CombatType.MAGIC);assert.equal(event.damage,hit.getHits()[0]);assert.equal(event.accurate,false);assert.equal(event.damage.getDamage(),0);}
  assert.equal(hit.isAccurate(),accurate);assert.equal(hit.getTotalDamage(),accurate?row[5]:0);mLand(f,hit);
  assert.equal(f.b.getHitpoints(),hp-(accurate?row[5]:0));
  if(accurate&&!freezing)bTimerOracle(trace,row[6]);else fNoNewEffects(trace);
  assert.equal(trace.attempts.length,accurate?1:0,'splash does not call the binding effect');
});
for(const row of B_ROWS)for(const pieces of[0,1,2,3])mTest(`B ${row[0]} Swampbark commit${pieces} survives impact gear swap`,async t=>{
  const f=await bGame(t);bMetadata(row);bArmour(f.a,pieces);const trace=fTrace(t,f.b),hit=await mFire(f,row[0]);bStop(f);
  const context=hit.getSpellContext();assert.equal(context.data.get('standard-bindings:hold-ticks'),row[6]+pieces*2);
  bArmour(f.a,3-pieces);mLand(f,hit);assert.equal(hit.getSpellContext(),context);bTimerOracle(trace,row[6]+pieces*2);
});
for(const row of B_ROWS)for(const tome of[false,true])mTest(`B ${row[0]} Clan Wars one entangle sack${tome?' plus Water tome':''}`,async t=>{
  const f=await bGame(t),I=core.ItemIdentifiers;bMetadata(row);
  assert.equal(f.a.getArea().getName(),'Clan Wars');
  let book;if(tome){await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);book=mTome(f.a,'water',2);}
  f.a.getInventory().resetItems();f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));
  const hit=await mFire(f,row[0]);bStop(f);assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),1);
  for(const rune of[I.WATER_RUNE,I.EARTH_RUNE,I.NATURE_RUNE])assert.equal(f.a.getInventory().getAmount(rune),0);
  if(book)assert.equal(book.Common.read(book.item).charges,1);mLand(f,hit);assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),1);
});
for(const row of B_ROWS)for(const element of['water','earth'])mTest(`B ${row[0]} actual ${element} tome final-charge context and real roll`,async t=>{
  const f=await bGame(t),I=core.ItemIdentifiers;bMetadata(row);await mEquip(f.a,I['TOME_OF_'+element.toUpperCase()+'_EMPTY_'],core.Equipment.SHIELD_SLOT);const book=mTome(f.a,element,1);
  const rune=I[element.toUpperCase()+'_RUNE'];f.a.getInventory().deleteNumber(rune,f.a.getInventory().getAmount(rune));
  const rolls=[],emit=PM.emitCustomEvent.bind(PM);magicRollControl=null;
  t.mock.method(PM,'emitCustomEvent',(name,event)=>{
    const own=name==='combat:magic-attack-roll-modify'&&event.attacker===f.a&&event.target===f.b,before=own?event.attackRoll:null;
    const result=emit(name,event);if(own)rolls.push({before,after:event.attackRoll,context:event.context});return result;
  });
  const hit=await mFire(f,row[0]);bStop(f);assert.ok(rolls.length>0,'native hit actually computes the canonical attack roll without forceAccuracy');
  for(const roll of rolls){assert.equal(roll.after,element==='water'?Math.floor(roll.before*1.2):roll.before);assert.equal(roll.context,hit.getSpellContext());}
  assert.equal(book.Common.read(book.item).charges,element==='water'?0:1);
  assert.equal(hit.getSpellContext().data.get(require('../plugins/items/elementaltomes/Combat.ElementalTomes').CAST_DATA_KEY).element,element);
  f.a.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=new core.Item(-1);mLand(f,hit);assert.equal(book.Common.read(book.item).charges,element==='water'?0:1);
});
for(const row of B_ROWS)mTest(`B ${row[0]} inventory pouch and staff canonical payment`,async t=>{
  const f=await bGame(t),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');bMetadata(row);
  await mEquip(f.a,I.STAFF_OF_WATER);give(f.a,I.RUNE_POUCH,'B-pouch');Pouch.setSlots(f.a,[{id:I.NATURE_RUNE,amount:10},null,null,null]);
  f.a.getInventory().deleteNumber(I.NATURE_RUNE,f.a.getInventory().getAmount(I.NATURE_RUNE));const water=f.a.getInventory().getAmount(I.WATER_RUNE),earth=f.a.getInventory().getAmount(I.EARTH_RUNE);
  const costs=core.CombatSpells[row[0]].itemsRequired(f.a),natureCost=costs.find(x=>x.getId()===I.NATURE_RUNE).getAmount(),earthCost=costs.find(x=>x.getId()===I.EARTH_RUNE).getAmount();
  const hit=await mFire(f,row[0]);bStop(f);assert.equal(Pouch.amountOf(f.a,I.NATURE_RUNE),10-natureCost);assert.equal(f.a.getInventory().getAmount(I.WATER_RUNE),water);assert.equal(f.a.getInventory().getAmount(I.EARTH_RUNE),earth-earthCost);mLand(f,hit);
});
for(const row of B_ROWS)for(const key of[core.TimerKey.FREEZE,core.TimerKey.FREEZE_IMMUNITY])mTest(`B ${row[0]} preexisting ${key} refuses sacks and Water tome before spend`,async t=>{
  const f=await bGame(t,{rules:{freezing:1}}),I=core.ItemIdentifiers;bMetadata(row);await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'water',2);
  f.a.getInventory().resetItems();f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));f.b.getTimers().registers(key,40);
  const before=mInventory(f.a);await mSpell(f.a,f.b,row[0]);tick(8);assert.deepEqual(mInventory(f.a),before);assert.equal(book.Common.read(book.item).charges,2);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});
for(const refusal of['low-level','wrong-book','missing-resources','unsupported-spell','unsupported-loadout','staging','same-team'])mTest('B actual '+refusal+' refuses before payment',async t=>{
  const f=await bGame(t,{prepare:refusal!=='staging'}),I=core.ItemIdentifiers;
  if(refusal==='low-level')f.a.getSkillManager().setCurrentLevel(core.Skill.MAGIC,19,false);
  if(refusal==='wrong-book')f.a.setSpellbook(core.MagicSpellbook.ANCIENT);
  if(refusal==='missing-resources')f.a.getInventory().resetItems();
  if(refusal==='unsupported-loadout')await mEquip(f.a,I.IBANS_STAFF);
  if(refusal==='same-team')f.game.fighters.set(f.b,f.game.fighters.get(f.a));
  const before=mInventory(f.a),hp=f.b.getHitpoints();await mSpell(f.a,f.b,refusal==='unsupported-spell'?'WIND_STRIKE':'BIND');tick(8);
  assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getTimers().has(core.TimerKey.FREEZE),false);
});
for(const boundary of['victim-leave','caster-leave','victim-logout','caster-logout','channel','finish','caster-death'])mTest('B paid native binding discarded at '+boundary+' without refund or new hold',async t=>{
  const f=await bGame(t),cost=mCost(f.a,core.CombatSpells.ENTANGLE),before=mAmounts(f.a,cost),hit=await mFire(f,'ENTANGLE');bStop(f);mPaid(f.a,cost,before);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);const paid=mInventory(f.a),hp=f.b.getHitpoints();
  if(boundary==='victim-leave')f.game.area.leave(f.b,false);else if(boundary==='caster-leave')f.game.area.leave(f.a,false);
  else if(boundary==='victim-logout')PM.emitPlayerLogout({player:f.b,username:f.b.getUsername()});else if(boundary==='caster-logout')PM.emitPlayerLogout({player:f.a,username:f.a.getUsername()});
  else if(boundary==='channel')FC.leave(f.a,true);else if(boundary==='finish')f.game.finish(null);
  else{f.a.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(f.a.getHitpoints(),core.HitMask.RED).setSource(f.b)]);tick();}
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);for(const p of[f.a,f.b])p.setNeedsPlacement(false);tick(35);
  assert.deepEqual(mInventory(f.a),paid);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getTimers().has(core.TimerKey.FREEZE),false);assert.equal(f.trace.resolved.includes(hit),false);
});
mTest('B actual paid mapped Forfeit cancels the exact native pending hit',async t=>{
  const f=await bGame(t),hit=await mFire(f,'SNARE');bStop(f);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);const paid=mInventory(f.a),hp=f.b.getHitpoints();
  magicTurns=false;await nmForfeit(f.a,f.game);magicTurns=true;for(const p of[f.a,f.b])p.setNeedsPlacement(false);tick(12);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);assert.equal(f.trace.resolved.includes(hit),false);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getTimers().has(core.TimerKey.FREEZE),false);assert.deepEqual(mInventory(f.a),paid);
});
mTest('B actual lethal paid Snare reaches safe jail rejoin and a fresh valid cast',async t=>{
  const f=await bGame(t);f.b.setHitpoints(1);const hit=await mFire(f,'SNARE');bStop(f);mLand(f,hit);
  for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();assert.equal(f.game.jailed.has(f.b),true);await jailExit(f.b,f.game);assert.equal(f.game.fighters.has(f.b),true);
  tick(40);mPosition(f.game,f.a,f.b);const trace=fTrace(t,f.b),fresh=await mFire(f,'BIND');bStop(f);assert.notEqual(fresh,hit);mLand(f,fresh);bTimerOracle(trace,8);
});
mTest('B NORMAL utility refuses real bones and alchemy dispatch while Default/Standard controls remain separate',async t=>{
  const f=await bGame(t),I=core.ItemIdentifiers;give(f.a,I.BONES,'B-bones');give(f.a,I.BRONZE_DAGGER,'B-alch');
  const before=mInventory(f.a),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC),bones=bUtilityMetadata('Bones to Bananas');assert.equal(core.EffectSpells.BONES_TO_BANANAS.getSpellbook(),core.MagicSpellbook.NORMAL);
  const calls=[],messages=messagesOf(f.a),disable=PM.emitSpellDisabled.bind(PM);let phase='bones';
  // Observe and forward the actual canonical permission call; neither dispatch nor refusal is substituted.
  t.mock.method(PM,'emitSpellDisabled',(...args)=>{const result=disable(...args);calls.push({phase,args,result});return result;});
  const refused='Binding only supports Bind, Snare and Entangle; other casts, including utility spells, are unavailable in this battle.';
  function assertRefusal(which,spell,messageStart){
    const reached=calls.filter(call=>call.phase===which);assert.ok(reached.length>0,which+' dispatch reaches canonical permission before payment');
    for(const call of reached){assert.equal(call.args[0],f.a);assert.equal(call.args[1],core.MagicSpellbook.NORMAL);assert.equal(call.args[2],spell.spellId());assert.equal(call.args[3],spell);assert.equal(call.result,true,which+' real permission refuses this exact cast');}
    assert.ok(messages.slice(messageStart).includes(refused),which+' reports the specific Binding-only refusal');
  }
  const bonesMessageStart=messages.length;await nativeButton(f.a,bones.widgetId,1,65535,bones.itemId);
  assertRefusal('bones',core.EffectSpells.BONES_TO_BANANAS,bonesMessageStart);assert.deepEqual(mInventory(f.a),before);
  const alch=bUtilityMetadata('High Level Alchemy');const slot=f.a.getInventory().getSlotForItemId(I.BRONZE_DAGGER);phase='alchemy';const alchemyMessageStart=messages.length;
  await f.a.connection.dispatch([{type:'widget_target',sourceWidgetId:alch.widgetId,sourceItemId:alch.itemId,sourceSlot:-1,targetWidgetId:core.CacheDefinitions.getComponentId('inventory:items'),targetSlot:slot,targetItemId:I.BRONZE_DAGGER}]);f.a.connection.processTurnPackets();tick(8);
  assertRefusal('alchemy',core.EffectSpells.HIGH_ALCHEMY,alchemyMessageStart);
  assert.deepEqual(mInventory(f.a),before);assert.equal(f.a.getSkillManager().getExperience(core.Skill.MAGIC),xp);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});
for(const name of['Cure Me','Cure Other'])mTest('B actual Lunar '+name+' dispatch refuses before cure or payment',async t=>{
  const f=await bGame(t),I=core.ItemIdentifiers;f.a.setSpellbook(core.MagicSpellbook.LUNAR);f.a.getInventory().add(new core.Item(I.ASTRAL_RUNE,20));f.a.getInventory().add(new core.Item(I.COSMIC_RUNE,20));f.a.getInventory().add(new core.Item(I.LAW_RUNE,20));f.a.setPoisonDamage(8);f.b.setPoisonDamage(8);f.b.setAttribute('accept-aid',true);
  const meta=bUtilityMetadata(name),seenBooks=[],disable=PM.emitSpellDisabled.bind(PM);t.mock.method(PM,'emitSpellDisabled',(...args)=>{if(args[0]===f.a)seenBooks.push(args[1]);return disable(...args);});const before=mInventory(f.a),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC);
  const packet=name==='Cure Other'?{type:'spell_on_player',targetIndex:f.b.getIndex(),spellWidget:meta.widgetId,spellChild:meta.widgetId&65535,spellItemId:meta.itemId}:{type:'widget_action',widgetId:meta.widgetId,groupId:meta.widgetId>>>16,childId:meta.widgetId&65535,buttonNum:1,itemId:meta.itemId};
  await f.a.connection.dispatch([packet]);f.a.connection.processTurnPackets();assert.deepEqual(mInventory(f.a),before);assert.equal(f.a.getSkillManager().getExperience(core.Skill.MAGIC),xp);assert.equal(f.a.getPoisonDamage(),8);assert.equal(f.b.getPoisonDamage(),8);assert.equal(f.trace.commits.length,0);assert.ok(seenBooks.length>0);assert.ok(seenBooks.every(book=>book===core.MagicSpellbook.LUNAR),'shared218 metadata does not change canonical Lunar book');
});

for(const style of['bow','melee'])for(const direction of['incoming','outgoing'])mTest(`B ${style} ${direction} native queued hit is disposed at mapped Forfeit`,async t=>{
  let ally;const f=await bGame(t,{rules:{ranged:0},beforeEntry:async(a,b)=>{
    ally=actor(true);ruleStats(ally,99);assert.equal(FC.join(ally,(direction==='incoming'?b:a).getUsername(),false),true);await join(ally);
  }}),{a,b,game}=f,queue=b.getCombat().getHitQueue();
  magicTurns=false;magicRollControl=null;const process=queue.process.bind(queue),hold=t.mock.method(queue,'process',()=>{}),hp=b.getHitpoints();
  let hit,paid;
  if(style==='bow'){
    await bowEquip(a);bowPlace(a,b,game);const shot=await bowFire(t,a,b);assert.equal(shot.before-shot.after,1);paid=bowAmount(a);
    hit=f.trace.hits.find(h=>h.getCombatMethod()===CombatFactory.RANGED_COMBAT);assert.ok(hit);
  }else{
    await tEquip(a,core.ItemIdentifiers.DRAGON_DAGGER);nmPlace(game,a,b);const trace=nmTrace(t,a,b);
    ghastTurns=true;await nmAttack(a,b);nmEngineUntil(()=>trace.queued.length>0);a.getCombat().reset();ghastTurns=false;
    hit=trace.queued[0];assert.ok(hit);assert.equal(hit.getCombatMethod().type(),core.CombatType.MELEE);assert.ok(hit.getTotalDamage()>0);
  }
  assert.equal(queue.hasPendingHit(hit),true,'actual native producer created this exact queued hit before departure');
  const leaving=direction==='incoming'?b:a,generation=queue.getIncomingGeneration();await nmForfeit(leaving,game);
  assert.equal(C.matches.has(leaving),false);assert.equal(game.phase,'combat','same-side actual ally retains the instance');assert.equal(queue.hasPendingHit(hit),false);
  if(direction==='incoming')assert.ok(queue.getIncomingGeneration()>generation);
  hold.mock.restore();for(const p of[a,b])p.setNeedsPlacement(false);process(C.now());tick(15);
  assert.equal(b.getHitpoints(),hp);assert.equal(f.trace.resolved.includes(hit),false);if(style==='bow')assert.equal(bowAmount(a),paid);
});
mTest('B native entry and supplied rejoin preserve self and null-source damage while clearing pre-entry incoming work',async t=>{
  bInstall();const a=actor(true),b=actor(true);ruleStats(a,99);ruleStats(b,99);channel(a);channel(b);const game=await negotiate(a,b,2,1,{magic:3});
  const queue=a.getCombat().getHitQueue(),generation=queue.getIncomingGeneration(),foreign=new core.PendingHit(b,a,CombatFactory.MELEE_COMBAT,{damage:7,rollAccuracy:false,experience:false,delay:500});
  CombatFactory.addPendingHit(foreign);queue.addPendingDamage([new core.HitDamage(1,core.HitMask.RED).setSource(a),new core.HitDamage(2,core.HitMask.RED)]);
  assert.equal(queue.hasPendingHit(foreign),true);await join(a);await join(b);assert.equal(queue.hasPendingHit(foreign),false);assert.ok(queue.getIncomingGeneration()>generation);assert.equal(queue.getQueuedDamage(),3);
  magicTurns=true;tick();assert.equal(a.getHitpoints(),96);completePreparation(game);mPosition(game,a,b);game.eliminate(a);game.jailed.add(a);
  const next=new core.PendingHit(b,a,CombatFactory.MELEE_COMBAT,{damage:7,rollAccuracy:false,experience:false,delay:500});CombatFactory.addPendingHit(next);
  const at=game.area.at(game.layout.jails[game.members.get(a)]);a.moveTo(at);a.setNeedsPlacement(false);const again=queue.getIncomingGeneration();
  assert.equal(game.rejoin(a),true,'explicit jail checkpoint exercises existing real rejoin owner, not natural death');assert.equal(queue.hasPendingHit(next),false);assert.ok(queue.getIncomingGeneration()>again);
});
mTest('B read-only preview and shared cooldown keep real binding payment single',async t=>{
  const f=await bGame(t),spell=core.CombatSpells.BIND,before=mInventory(f.a);await mSpell(f.a,f.b,'BIND');
  assert.equal(spell.canCast(f.a,false),true);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
  const hit=await mFire(f,'BIND');bStop(f);const paid=mInventory(f.a),commits=f.trace.commits.length;
  assert.equal(core.CombatSpells.SNARE.canCast(f.a,true),false,'same-tick shared delay refuses before a second cost');assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,commits);mLand(f,hit);
});
mTest('B joined staging utility is refused and actual departure restores ordinary NORMAL utility scope',async t=>{
  const f=await bGame(t,{prepare:false}),I=core.ItemIdentifiers;give(f.a,I.BONES,'B-staging-bones');const meta=core.CacheDefinitions.getSpellByName('Bones to Bananas');assert.ok(meta);
  const before=mInventory(f.a),bananas=f.a.getInventory().getAmount(I.BANANA);await nativeButton(f.a,meta.widgetId,1,65535,meta.itemId);assert.deepEqual(mInventory(f.a),before);
  f.game.area.leave(f.a,false);assert.equal(C.matches.has(f.a),false);await nativeButton(f.a,meta.widgetId,1,65535,meta.itemId);
  assert.ok(f.a.getInventory().getAmount(I.BANANA)>bananas);assert.equal(f.trace.commits.length,1,'ordinary utility outside the restriction owner remains a real paid cast');
});
mTest('B canonical non-cast Configure is not classified as a spell by the mode3 refusal',async t=>{
  const f=await bGame(t),meta=bUtilityMetadata('Varrock Teleport');
  const before=mInventory(f.a),messages=messagesOf(f.a),disabled=[],real=PM.emitSpellDisabled.bind(PM);
  t.mock.method(PM,'emitSpellDisabled',(...args)=>{disabled.push(args);return real(...args);});
  await nativeButton(f.a,meta.widgetId,10,65535,meta.itemId);
  assert.equal(disabled.length,0,'Configure reaches canonical non-cast branch, not the permission hook');
  assert.ok(messages.some(m=>/diary/i.test(m)),'canonical diary prerequisite retains its own refusal rather than a mode3 cast refusal');
  assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});

// C: finite manual Classic F2P; declarations are literal static cache242 source, not effect IDs.
const C_CLASSIC_ROWS=[{"key":"WIND_STRIKE","label":"Wind Strike","itemId":3273,"widgetId":14286859,"level":1,"runes":[{"id":558,"amount":1},{"id":556,"amount":1}],"baseXP":5.5,"splashXP":5.5},{"key":"WATER_STRIKE","label":"Water Strike","itemId":3275,"widgetId":14286862,"level":5,"runes":[{"id":558,"amount":1},{"id":555,"amount":1},{"id":556,"amount":1}],"baseXP":7.5,"splashXP":7.5},{"key":"EARTH_STRIKE","label":"Earth Strike","itemId":3277,"widgetId":14286865,"level":9,"runes":[{"id":558,"amount":1},{"id":557,"amount":2},{"id":556,"amount":1}],"baseXP":9.5,"splashXP":9.5},{"key":"FIRE_STRIKE","label":"Fire Strike","itemId":3279,"widgetId":14286867,"level":13,"runes":[{"id":558,"amount":1},{"id":554,"amount":3},{"id":556,"amount":2}],"baseXP":11.5,"splashXP":11.5},{"key":"WIND_BOLT","label":"Wind Bolt","itemId":3281,"widgetId":14286869,"level":17,"runes":[{"id":562,"amount":1},{"id":556,"amount":2}],"baseXP":13.5,"splashXP":13.5},{"key":"WATER_BOLT","label":"Water Bolt","itemId":3285,"widgetId":14286873,"level":23,"runes":[{"id":562,"amount":1},{"id":555,"amount":2},{"id":556,"amount":2}],"baseXP":16.5,"splashXP":16.5},{"key":"EARTH_BOLT","label":"Earth Bolt","itemId":3288,"widgetId":14286876,"level":29,"runes":[{"id":562,"amount":1},{"id":557,"amount":3},{"id":556,"amount":2}],"baseXP":19.5,"splashXP":19.5},{"key":"FIRE_BOLT","label":"Fire Bolt","itemId":3291,"widgetId":14286879,"level":35,"runes":[{"id":562,"amount":1},{"id":554,"amount":4},{"id":556,"amount":3}],"baseXP":22.5,"splashXP":22.5},{"key":"WIND_BLAST","label":"Wind Blast","itemId":3294,"widgetId":14286883,"level":41,"runes":[{"id":560,"amount":1},{"id":556,"amount":3}],"baseXP":25.5,"splashXP":25.5},{"key":"WATER_BLAST","label":"Water Blast","itemId":3297,"widgetId":14286886,"level":47,"runes":[{"id":560,"amount":1},{"id":555,"amount":3},{"id":556,"amount":3}],"baseXP":28.5,"splashXP":28.5},{"key":"EARTH_BLAST","label":"Earth Blast","itemId":3302,"widgetId":14286893,"level":53,"runes":[{"id":560,"amount":1},{"id":557,"amount":4},{"id":556,"amount":3}],"baseXP":31.5,"splashXP":31.5},{"key":"FIRE_BLAST","label":"Fire Blast","itemId":3307,"widgetId":14286899,"level":59,"runes":[{"id":560,"amount":1},{"id":554,"amount":5},{"id":556,"amount":4}],"baseXP":34.5,"splashXP":34.5},{"key":"CONFUSE","label":"Confuse","itemId":3274,"widgetId":14286860,"level":3,"runes":[{"id":559,"amount":1},{"id":555,"amount":3},{"id":557,"amount":2}],"baseXP":13,"splashXP":13},{"key":"WEAKEN","label":"Weaken","itemId":3278,"widgetId":14286866,"level":11,"runes":[{"id":559,"amount":1},{"id":555,"amount":3},{"id":557,"amount":2}],"baseXP":21,"splashXP":21},{"key":"CURSE","label":"Curse","itemId":3282,"widgetId":14286870,"level":19,"runes":[{"id":559,"amount":1},{"id":555,"amount":2},{"id":557,"amount":3}],"baseXP":29,"splashXP":29},{"key":"BIND","label":"Bind","itemId":3283,"widgetId":14286871,"level":20,"runes":[{"id":561,"amount":2},{"id":555,"amount":3},{"id":557,"amount":3}],"baseXP":31,"splashXP":30}];

const C_CURSES={CONFUSE:'ATTACK',WEAKEN:'STRENGTH',CURSE:'DEFENCE'};
let cInstalled=false;
function cInstall(){
  if(cInstalled)return;
  bInstall();assert.equal(actors.length,0,'stat-curse composition runs once before actors');
  require('../plugins/combat/StandardCurses.plugin').register(PM.createApi('ClanWarsCCanonicalCurses'));
  cInstalled=true;
}
async function cGame(t,options={}){cInstall();return mGame(t,{...options,rules:{magic:2,...options.rules}});}
function cMetadata(row){
  const spell=core.CombatSpells[row.key],meta=core.CacheDefinitions.getSpellByName(row.label),requirements=core.CacheDefinitions.getSpellRequirements(row.label);
  assert.deepEqual(meta,{itemId:row.itemId,widgetId:row.widgetId});assert.equal(core.CacheDefinitions.getSpellName(meta.widgetId,meta.itemId),row.label);
  assert.equal(requirements.level,row.level);assert.equal(spell.levelRequired(),row.level);assert.deepEqual(requirements.runes,row.runes);
  assert.equal(spell.getSpellbook(),core.MagicSpellbook.NORMAL,'book is canonical spell identity, not group218');
  assert.deepEqual(spell.itemsRequired(null).map(x=>[x.getId(),x.getAmount()]).sort((a,b)=>a[0]-b[0]),row.runes.map(x=>[x.id,x.amount]).sort((a,b)=>a[0]-b[0]));
  assert.equal(spell.baseExperience(),row.baseXP);assert.equal(spell.splashExperience(),row.splashXP);return meta;
}
function cStats(p){return Object.fromEntries(['ATTACK','STRENGTH','DEFENCE'].map(k=>[k,p.getSkillManager().getCurrentLevel(core.Skill[k])]));}
function cAssertStats(p,before,key,percent){
  const expected={...before};if(key)expected[key]-=Math.floor(before[key]*percent/100);assert.deepEqual(cStats(p),expected);
}
async function cNativeAttack(a,b){
  const frame=Buffer.alloc(4);frame[0]=44;frame[1]=128;frame.writeUInt16BE(b.getIndex(),2);
  const decoded=decodeClientPackets(frame);assert.equal(decoded.length,1);assert.equal(decoded[0].type,'player_option');assert.equal(decoded[0].option,1);assert.equal(decoded[0].index,b.getIndex());
  await a.connection.dispatch(decoded);a.connection.processTurnPackets();
}
async function cAutocast(a){
  await mEquip(a,core.ItemIdentifiers.STAFF_OF_AIR);assert.equal(a.getEquipment().hasStaffEquipped(),true);
  await nativeButton(a,(593<<16)|23);await nativeButton(a,(201<<16)|1,1,1);
  assert.equal(a.getCombat().getAutocastSpell(),core.CombatSpells.WIND_STRIKE);assert.equal(core.Autocasting.isActive(a),true);
}
mTest('C initial reciprocal challenge discloses Classic support and accounting before any selection',async t=>{
  cInstall();const a=actor(true),b=actor(true);channel(a);channel(b);
  const lines=[messagesOf(a),messagesOf(b)],Magic=require('../plugins/minigames/clanwars/Magic.ClanWars');
  await challenge(a,b);await challenge(b,a);
  const session=C.negotiations.get(a);assert.equal(session,C.negotiations.get(b));assert.equal(session.stage,'setup');assert.equal(session.rules.magic,4);assert.equal(session.revision,0);assert.equal(session.accepted.size,0);
  for(const messages of lines){
    assert.ok(messages.some(line=>line.includes('Standard combat spells, manual Classic F2P combat and Binding-only casts remain independent of the melee choice.')),'initial supported-choice introduction includes manual Classic');
    for(const disclosure of[Magic.SUPPORT,Magic.ACCOUNTING,Magic.CLASSIC_SUPPORT,Magic.CLASSIC_ACCOUNTING,Magic.BINDING_SUPPORT,Magic.BINDING_ACCOUNTING])assert.ok(messages.includes(disclosure),'initial mode support/accounting is sent before any selection');
  }
});
for(const offerer of[0,1])mTest('C native2 captain'+offerer+' full offer acceptance confirmation and join',async t=>{
  cInstall();const a=actor(true),b=actor(true);channel(a);channel(b);await challenge(a,b);await challenge(b,a);
  const session=C.negotiations.get(a),p=[a,b][offerer],scripts=scriptCalls(p),lines=messagesOf(p);await click(a,'clanwars_setup:accept');const revision=session.revision;
  await nativeButton(p,'clanwars_setup:dropdown_magic',1,3);
  assert.equal(session.rules.magic,2);assert.equal(session.revision,revision+1);assert.equal(session.accepted.size,0);
  assert.equal(p.getPacketSender().getVarbit(core.CacheDefinitions.getVarbitId('clanwars_magic')),2);
  for(const slot of[1,0,6,65535]){await nativeButton(p,'clanwars_setup:dropdown_magic',1,slot);assert.equal(session.rules.magic,2);assert.equal(session.revision,revision+1);}
  await nativeButton(p,'clanwars_setup:dropdown_magic',2,5);assert.equal(session.rules.magic,2);
  tick(9);await click(a,'clanwars_setup:accept');await click(b,'clanwars_setup:accept');assert.equal(session.stage,'confirm');assert.equal(session.confirmRevision,session.revision);
  const terms=scripts.findLast(x=>x[0]===554)[2];assert.match(terms,/Classic F2P/);assert.match(terms,/12 elemental strike, bolt and blast/);assert.match(terms,/Confuse, Weaken, Curse and Bind/);assert.match(terms,/partial support/);assert.match(terms,/utilities, autocasts/);assert.match(terms,/queued incoming and still-queued outgoing/);
  tick(5);await click(a,'clanwars_confirm:button');await click(b,'clanwars_confirm:button');const game=C.channelGames.get(C.channel(a).key);assert.ok(game);assert.equal(game.rules.magic,2);await join(a);await join(b);
  assert.ok(scripts.some(x=>x[0]===554&&x[1]===1&&x[2]===terms));assert.ok(lines.some(x=>/cast manually/.test(x)));
});
for(const row of C_CLASSIC_ROWS)for(const accurate of[true,false])for(const freezing of[0,1])mTest(`C ${row.key} native accurate${accurate} Ignore${freezing}`,async t=>{
  const f=await cGame(t,{rules:{freezing}});cMetadata(row);const stats=cStats(f.b),hp=f.b.getHitpoints(),calls=[],splashes=[];
  magicRollControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.forceAccurate=accurate;e.forceMaxHit=true;}};
  // Supplied branch at the real PendingHit's damage event, never a natural probability claim.
  if(!accurate)magicDamageControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.accurate=false;e.damage.setDamage(0);splashes.push(e);}};
  const sm=f.a.getSkillManager(),add=sm.addExperience.bind(sm);t.mock.method(sm,'addExperience',(...args)=>{calls.push(args);return add(...args);});
  const trace=fTrace(t,f.b),cost=mCost(f.a,core.CombatSpells[row.key]),before=mAmounts(f.a,cost),hit=await mFire(f,row.key);bStop(f);mPaid(f.a,cost,before);
  if(!accurate){assert.equal(splashes.length,1);assert.equal(splashes[0].hit,hit);assert.equal(splashes[0].damage,hit.getHits()[0]);assert.equal(splashes[0].combatType,core.CombatType.MAGIC);assert.equal(splashes[0].accurate,false);assert.equal(splashes[0].damage.getDamage(),0);}
  assert.equal(hit.isAccurate(),accurate);const damage=hit.getTotalDamage();if(C_CURSES[row.key]||row.key==='BIND'||!accurate)assert.equal(damage,0);else assert.ok(damage>0);
  assert.deepEqual(cStats(f.b),stats,'queued effects are not applied early');mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-damage);
  cAssertStats(f.b,stats,accurate?C_CURSES[row.key]:null,5);
  assert.ok(calls.some(x=>x[0]===core.Skill.MAGIC&&x[1]===(accurate?row.baseXP:row.splashXP)),'canonical base XP producer is forwarded with independent pinned amount');
  if(row.key==='BIND'&&accurate&&!freezing)bTimerOracle(trace,8);else fNoNewEffects(trace);
  assert.equal(trace.attempts.length,row.key==='BIND'&&accurate?1:0);
});
mTest('C valid native autocast selector plus Attack refuses before promotion payment or PendingHit',async t=>{
  const f=await cGame(t),combat=f.a.getCombat(),lines=messagesOf(f.a),observed=[],permission=f.game.area.canAttack.bind(f.game.area);await cAutocast(f.a);
  const row=C_CLASSIC_ROWS.find(x=>x.key==='WIND_STRIKE');cMetadata(row);assert.equal(combat.getCastSpell(),null);assert.ok(mCost(f.a,core.CombatSpells.WIND_STRIKE).every(([id,amount])=>f.a.getInventory().getAmount(id)>=amount));
  t.mock.method(f.game.area,'canAttack',(...args)=>{const before=combat.getCastSpell(),result=permission(...args);if(args[0]===f.a)observed.push({before,method:args[2],result,target:args[1]});return result;});
  const inventory=mInventory(f.a),hp=f.b.getHitpoints();await cNativeAttack(f.a,f.b);tick(25);combat.reset();
  assert.ok(observed.some(x=>x.method===CombatFactory.MAGIC_COMBAT&&x.target===f.b&&x.before==null&&x.result===false),'actual area refusal precedes canonical autocast promotion');
  assert.ok(lines.includes('Classic F2P combat supports manual casts only; select a spell and cast it at an opposing fighter.'));
  assert.deepEqual(mInventory(f.a),inventory);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
});
mTest('C real manual OPPLAYER_T overrides configured autocast once and prevents automatic paid repeats',async t=>{
  const f=await cGame(t);await cAutocast(f.a);const spell=core.CombatSpells.WIND_STRIKE,cost=mCost(f.a,spell),before=mAmounts(f.a,cost),hit=await mFire(f,'WIND_STRIKE');
  assert.equal(core.Autocasting.isActive(f.a),true);mPaid(f.a,cost,before);mLand(f,hit);tick(25);f.a.getCombat().reset();
  assert.equal(f.trace.commits.length,1);assert.equal(f.trace.hits.length,1);mPaid(f.a,cost,before);assert.equal(f.trace.resolved.includes(hit),true);
});
mTest('C inactive remembered autocast with a native dagger Attack remains melee',async t=>{
  const f=await cGame(t);await cAutocast(f.a);await tEquip(f.a,core.ItemIdentifiers.DRAGON_DAGGER);assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells.WIND_STRIKE);assert.equal(core.Autocasting.isActive(f.a),false);
  const before=mInventory(f.a),trace=nmTrace(t,f.a,f.b);nmPlace(f.game,f.a,f.b);ghastTurns=true;await cNativeAttack(f.a,f.b);nmEngineUntil(()=>trace.queued.length>0);f.a.getCombat().reset();ghastTurns=false;
  assert.ok(trace.queued.some(h=>h.getCombatMethod().type()===core.CombatType.MELEE));assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
});
for(const key of Object.keys(C_CURSES))mTest('C '+key+' native lowered partial full recovery and impact race remain canonical',async t=>{
  const f=await cGame(t),skill=core.Skill[C_CURSES[key]],sm=f.b.getSkillManager(),first=await mFire(f,key);bStop(f);mLand(f,first);assert.equal(sm.getCurrentLevel(skill),95);
  tick(10);const paid=mInventory(f.a),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC),n=f.trace.commits.length,lines=messagesOf(f.a);
  await mSpell(f.a,f.b,key);tick(8);bStop(f);assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,n);assert.equal(f.a.getSkillManager().getExperience(core.Skill.MAGIC),xp);assert.ok(lines.some(x=>/weakened/.test(x)));
  sm.setCurrentLevel(skill,98,false);await mSpell(f.a,f.b,key);tick(8);bStop(f);assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,n);
  sm.setCurrentLevel(skill,99,false);tick(10);const second=await mFire(f,key);bStop(f);assert.notEqual(second,first);sm.setCurrentLevel(skill,98,false);mLand(f,second);assert.equal(sm.getCurrentLevel(skill),98,'intervening drain prevents stacking at impact');
  const other=key==='CONFUSE'?'WEAKEN':'CONFUSE',otherSkill=core.Skill[C_CURSES[other]];sm.setCurrentLevel(otherSkill,99,false);tick(10);const independent=await mFire(f,other);bStop(f);mLand(f,independent);assert.equal(sm.getCurrentLevel(otherSkill),95);
});
for(const key of Object.keys(C_CURSES))for(const tome of[false,true])mTest(`C ${key} committed effect floor99 ${tome?'water final-charge swap':'base'} and independent resources`,async t=>{
  const f=await cGame(t),I=core.ItemIdentifiers;let book;
  if(tome){await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);book=mTome(f.a,'water',1);f.a.getInventory().deleteNumber(I.WATER_RUNE,f.a.getInventory().getAmount(I.WATER_RUNE));}
  const cost=mCost(f.a,core.CombatSpells[key]),amounts=mAmounts(f.a,cost),stats=cStats(f.b),hp=f.b.getHitpoints(),hit=await mFire(f,key);bStop(f);mPaid(f.a,cost,amounts);assert.equal(hit.isAccurate(),true);assert.equal(hit.getTotalDamage(),0);assert.deepEqual(cStats(f.b),stats);
  const context=hit.getSpellContext();if(tome){assert.equal(book.Common.read(book.item).charges,0);assert.equal(context.data.get(require('../plugins/items/elementaltomes/Combat.ElementalTomes').CAST_DATA_KEY).element,'water');f.a.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=new core.Item(-1);}
  mLand(f,hit);assert.equal(hit.getSpellContext(),context);cAssertStats(f.b,stats,C_CURSES[key],tome?7:5);assert.equal(f.b.getHitpoints(),hp);if(tome)assert.equal(book.Common.read(book.item).charges,0);
});
for(const key of Object.keys(C_CURSES))mTest('C '+key+' unforced real forwarded Water tome attack roll uses committed final charge',async t=>{
  const f=await cGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'water',1),rolls=[],emit=PM.emitCustomEvent.bind(PM);magicRollControl=null;
  t.mock.method(PM,'emitCustomEvent',(name,event)=>{const own=name==='combat:magic-attack-roll-modify'&&event.attacker===f.a&&event.target===f.b,before=own?event.attackRoll:null;const result=emit(name,event);if(own)rolls.push({before,after:event.attackRoll,context:event.context});return result;});
  const hit=await mFire(f,key);bStop(f);assert.ok(rolls.length>0);for(const roll of rolls){assert.equal(roll.after,Math.floor(roll.before*1.2));assert.equal(roll.context,hit.getSpellContext());}assert.equal(book.Common.read(book.item).charges,0);mLand(f,hit);
  // This separate real-roll observation does not assert a random effect outcome.
});
for(const key of['CONFUSE','WEAKEN','CURSE','BIND'])mTest('C '+key+' pouch staff and sack funding stay canonical and independent',async t=>{
  const f=await cGame(t),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');await mEquip(f.a,I.STAFF_OF_WATER);give(f.a,I.RUNE_POUCH,'C-pouch');
  const rune=key==='BIND'?I.NATURE_RUNE:I.BODY_RUNE;Pouch.setSlots(f.a,[{id:rune,amount:10},null,null,null]);f.a.getInventory().deleteNumber(rune,f.a.getInventory().getAmount(rune));f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));
  const water=f.a.getInventory().getAmount(I.WATER_RUNE),earth=f.a.getInventory().getAmount(I.EARTH_RUNE),cost=core.CombatSpells[key].itemsRequired(f.a),runeCost=cost.find(x=>x.getId()===rune).getAmount(),earthCost=cost.find(x=>x.getId()===I.EARTH_RUNE).getAmount(),hit=await mFire(f,key);bStop(f);
  if(key==='BIND'){assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),1);assert.equal(Pouch.amountOf(f.a,rune),10);assert.equal(f.a.getInventory().getAmount(I.EARTH_RUNE),earth);}
  else{assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),2);assert.equal(Pouch.amountOf(f.a,rune),10-runeCost);assert.equal(f.a.getInventory().getAmount(I.EARTH_RUNE),earth-earthCost);}
  assert.equal(f.a.getInventory().getAmount(I.WATER_RUNE),water);mLand(f,hit);
});
for(const key of['SNARE','ENTANGLE','WIND_WAVE','FIRE_SURGE','VULNERABILITY','ENFEEBLE','STUN','TELEBLOCK','CRUMBLE_UNDEAD'])mTest('C actual '+key+' remains outside the finite spell set before payment',async t=>{
  const f=await cGame(t);const before=mInventory(f.a),stats=cStats(f.b),hp=f.b.getHitpoints(),lines=messagesOf(f.a);await mSpell(f.a,f.b,key,key==='TELEBLOCK'?'Tele Block':null);tick(10);bStop(f);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.deepEqual(cStats(f.b),stats);assert.equal(f.b.getHitpoints(),hp);assert.ok(lines.length>0);
});
for(const spell of['CURSE','BIND'])for(const boundary of['victim-leave','caster-leave','victim-logout','caster-logout','channel','finish','caster-death'])mTest('C paid native '+spell+' discarded at '+boundary+' without refund or new hold',async t=>{
  const f=await cGame(t),cost=mCost(f.a,core.CombatSpells[spell]),before=mAmounts(f.a,cost),hit=await mFire(f,spell);bStop(f);mPaid(f.a,cost,before);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);const paid=mInventory(f.a),hp=f.b.getHitpoints(),stats=cStats(f.b);
  if(boundary==='victim-leave')f.game.area.leave(f.b,false);else if(boundary==='caster-leave')f.game.area.leave(f.a,false);
  else if(boundary==='victim-logout')PM.emitPlayerLogout({player:f.b,username:f.b.getUsername()});else if(boundary==='caster-logout')PM.emitPlayerLogout({player:f.a,username:f.a.getUsername()});
  else if(boundary==='channel')FC.leave(f.a,true);else if(boundary==='finish')f.game.finish(null);
  else{f.a.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(f.a.getHitpoints(),core.HitMask.RED).setSource(f.b)]);tick();}
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);for(const p of[f.a,f.b])p.setNeedsPlacement(false);tick(35);
  assert.deepEqual(mInventory(f.a),paid);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getTimers().has(core.TimerKey.FREEZE),false);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(cStats(f.b),stats);
});
mTest('C actual paid mapped Forfeit cancels the exact native pending hit',async t=>{
  const f=await cGame(t),hit=await mFire(f,'BIND');bStop(f);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);const paid=mInventory(f.a),hp=f.b.getHitpoints(),stats=cStats(f.b);
  magicTurns=false;await nmForfeit(f.a,f.game);magicTurns=true;for(const p of[f.a,f.b])p.setNeedsPlacement(false);tick(12);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(cStats(f.b),stats);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getTimers().has(core.TimerKey.FREEZE),false);assert.deepEqual(mInventory(f.a),paid);
});
mTest('C NORMAL utility refuses real bones and alchemy dispatch while Default/Standard controls remain separate',async t=>{
  const f=await cGame(t),I=core.ItemIdentifiers;give(f.a,I.BONES,'B-bones');give(f.a,I.BRONZE_DAGGER,'B-alch');
  const before=mInventory(f.a),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC),bones=bUtilityMetadata('Bones to Bananas');assert.equal(core.EffectSpells.BONES_TO_BANANAS.getSpellbook(),core.MagicSpellbook.NORMAL);
  const calls=[],messages=messagesOf(f.a),disable=PM.emitSpellDisabled.bind(PM),allResources=resources(f.a),targetState=resources(f.b),timerWrites=cObserveTimerWrites(t,f.a);let phase='bones';
  // Observe and forward the actual canonical permission call; neither dispatch nor refusal is substituted.
  t.mock.method(PM,'emitSpellDisabled',(...args)=>{const result=disable(...args);calls.push({phase,args,result});return result;});
  const refused='Classic F2P combat supports the 12 elemental strike, bolt and blast spells, Confuse, Weaken, Curse and Bind; other casts, including utilities, are unavailable in this battle.';
  function assertRefusal(which,spell,messageStart){
    const reached=calls.filter(call=>call.phase===which);assert.ok(reached.length>0,which+' dispatch reaches canonical permission before payment');
    for(const call of reached){assert.equal(call.args[0],f.a);assert.equal(call.args[1],core.MagicSpellbook.NORMAL);assert.equal(call.args[2],spell.spellId());assert.equal(call.args[3],spell);assert.equal(call.result,true,which+' real permission refuses this exact cast');}
    assert.ok(messages.slice(messageStart).includes(refused),which+' reports the specific Classic F2P refusal');
  }
  const bonesMessageStart=messages.length;await nativeButton(f.a,bones.widgetId,1,65535,bones.itemId);
  assertRefusal('bones',core.EffectSpells.BONES_TO_BANANAS,bonesMessageStart);assert.deepEqual(mInventory(f.a),before);
  const alch=bUtilityMetadata('High Level Alchemy');const slot=f.a.getInventory().getSlotForItemId(I.BRONZE_DAGGER);phase='alchemy';const alchemyMessageStart=messages.length;
  await f.a.connection.dispatch([{type:'widget_target',sourceWidgetId:alch.widgetId,sourceItemId:alch.itemId,sourceSlot:-1,targetWidgetId:core.CacheDefinitions.getComponentId('inventory:items'),targetSlot:slot,targetItemId:I.BRONZE_DAGGER}]);f.a.connection.processTurnPackets();tick(8);
  assertRefusal('alchemy',core.EffectSpells.HIGH_ALCHEMY,alchemyMessageStart);assert.deepEqual(resources(f.a),allResources);assert.deepEqual(resources(f.b),targetState);assert.equal(timerWrites.length,0);
  assert.deepEqual(mInventory(f.a),before);assert.equal(f.a.getSkillManager().getExperience(core.Skill.MAGIC),xp);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});
for(const name of['Cure Me','Cure Other'])mTest('C actual Lunar '+name+' dispatch refuses before cure or payment',async t=>{
  const f=await cGame(t),I=core.ItemIdentifiers;f.a.setSpellbook(core.MagicSpellbook.LUNAR);f.a.getInventory().add(new core.Item(I.ASTRAL_RUNE,20));f.a.getInventory().add(new core.Item(I.COSMIC_RUNE,20));f.a.getInventory().add(new core.Item(I.LAW_RUNE,20));f.a.setPoisonDamage(8);f.b.setPoisonDamage(8);f.b.setAttribute('accept-aid',true);
  const meta=bUtilityMetadata(name),seen=[],disable=PM.emitSpellDisabled.bind(PM),lines=messagesOf(f.a),timerWrites=cObserveTimerWrites(t,f.a);t.mock.method(PM,'emitSpellDisabled',(...args)=>{const result=disable(...args);if(args[0]===f.a)seen.push({args,result});return result;});const before=mInventory(f.a),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC);
  const packet=name==='Cure Other'?{type:'spell_on_player',targetIndex:f.b.getIndex(),spellWidget:meta.widgetId,spellChild:meta.widgetId&65535,spellItemId:meta.itemId}:{type:'widget_action',widgetId:meta.widgetId,groupId:meta.widgetId>>>16,childId:meta.widgetId&65535,buttonNum:1,itemId:meta.itemId};
  await f.a.connection.dispatch([packet]);f.a.connection.processTurnPackets();assert.deepEqual(mInventory(f.a),before);assert.equal(f.a.getSkillManager().getExperience(core.Skill.MAGIC),xp);assert.equal(f.a.getPoisonDamage(),8);assert.equal(f.b.getPoisonDamage(),8);assert.equal(f.trace.commits.length,0);assert.ok(seen.length>0);for(const call of seen){assert.equal(call.args[0],f.a);assert.equal(call.args[1],core.MagicSpellbook.LUNAR);assert.equal(call.args[2],meta.widgetId);assert.ok(call.args[3] instanceof core.Spell);assert.equal(call.args[3].spellId(),meta.widgetId);assert.equal(call.args[3].getSpellbook(),core.MagicSpellbook.LUNAR);assert.equal(call.result,true);}assert.ok(lines.includes(C_CLASSIC_UTILITY_REFUSAL));assert.equal(timerWrites.length,0);assert.equal(f.trace.hits.length,0);
});

for(const style of['bow','melee'])for(const direction of['incoming','outgoing'])mTest(`C ${style} ${direction} native queued hit is disposed at mapped Forfeit`,async t=>{
  let ally;const f=await cGame(t,{rules:{ranged:0},beforeEntry:async(a,b)=>{
    ally=actor(true);ruleStats(ally,99);assert.equal(FC.join(ally,(direction==='incoming'?b:a).getUsername(),false),true);await join(ally);
  }}),{a,b,game}=f,queue=b.getCombat().getHitQueue();
  magicTurns=false;magicRollControl=null;const process=queue.process.bind(queue),hold=t.mock.method(queue,'process',()=>{}),hp=b.getHitpoints();
  let hit,paid;
  if(style==='bow'){
    await bowEquip(a);bowPlace(a,b,game);const shot=await bowFire(t,a,b);assert.equal(shot.before-shot.after,1);paid=bowAmount(a);
    hit=f.trace.hits.find(h=>h.getCombatMethod()===CombatFactory.RANGED_COMBAT);assert.ok(hit);
  }else{
    await tEquip(a,core.ItemIdentifiers.DRAGON_DAGGER);nmPlace(game,a,b);const trace=nmTrace(t,a,b);
    ghastTurns=true;await nmAttack(a,b);nmEngineUntil(()=>trace.queued.length>0);a.getCombat().reset();ghastTurns=false;
    hit=trace.queued[0];assert.ok(hit);assert.equal(hit.getCombatMethod().type(),core.CombatType.MELEE);assert.ok(hit.getTotalDamage()>0);
  }
  assert.equal(queue.hasPendingHit(hit),true,'actual native producer created this exact queued hit before departure');
  const leaving=direction==='incoming'?b:a,generation=queue.getIncomingGeneration();await nmForfeit(leaving,game);
  assert.equal(C.matches.has(leaving),false);assert.equal(game.phase,'combat','same-side actual ally retains the instance');assert.equal(queue.hasPendingHit(hit),false);
  if(direction==='incoming')assert.ok(queue.getIncomingGeneration()>generation);
  hold.mock.restore();for(const p of[a,b])p.setNeedsPlacement(false);process(C.now());tick(15);
  assert.equal(b.getHitpoints(),hp);assert.equal(f.trace.resolved.includes(hit),false);if(style==='bow')assert.equal(bowAmount(a),paid);
});
mTest('C native entry and supplied rejoin preserve self and null-source damage while clearing pre-entry incoming work',async t=>{
  cInstall();const a=actor(true),b=actor(true);ruleStats(a,99);ruleStats(b,99);channel(a);channel(b);const game=await negotiate(a,b,2,1,{magic:2});
  const queue=a.getCombat().getHitQueue(),generation=queue.getIncomingGeneration(),foreign=new core.PendingHit(b,a,CombatFactory.MELEE_COMBAT,{damage:7,rollAccuracy:false,experience:false,delay:500});
  CombatFactory.addPendingHit(foreign);queue.addPendingDamage([new core.HitDamage(1,core.HitMask.RED).setSource(a),new core.HitDamage(2,core.HitMask.RED)]);
  assert.equal(queue.hasPendingHit(foreign),true);await join(a);await join(b);assert.equal(queue.hasPendingHit(foreign),false);assert.ok(queue.getIncomingGeneration()>generation);assert.equal(queue.getQueuedDamage(),3);
  magicTurns=true;tick();assert.equal(a.getHitpoints(),96);completePreparation(game);mPosition(game,a,b);game.eliminate(a);game.jailed.add(a);
  const next=new core.PendingHit(b,a,CombatFactory.MELEE_COMBAT,{damage:7,rollAccuracy:false,experience:false,delay:500});CombatFactory.addPendingHit(next);
  const at=game.area.at(game.layout.jails[game.members.get(a)]);a.moveTo(at);a.setNeedsPlacement(false);const again=queue.getIncomingGeneration();
  assert.equal(game.rejoin(a),true,'explicit jail checkpoint exercises existing real rejoin owner, not natural death');assert.equal(queue.hasPendingHit(next),false);assert.ok(queue.getIncomingGeneration()>again);
});
mTest('C joined staging utility is refused and actual departure restores ordinary NORMAL utility scope',async t=>{
  const f=await cGame(t,{prepare:false}),I=core.ItemIdentifiers;give(f.a,I.BONES,'B-staging-bones');const meta=core.CacheDefinitions.getSpellByName('Bones to Bananas');assert.ok(meta);
  const before=mInventory(f.a),bananas=f.a.getInventory().getAmount(I.BANANA);await nativeButton(f.a,meta.widgetId,1,65535,meta.itemId);assert.deepEqual(mInventory(f.a),before);
  f.game.area.leave(f.a,false);assert.equal(C.matches.has(f.a),false);await nativeButton(f.a,meta.widgetId,1,65535,meta.itemId);
  assert.ok(f.a.getInventory().getAmount(I.BANANA)>bananas);assert.equal(f.trace.commits.length,1,'ordinary utility outside the restriction owner remains a real paid cast');
});
mTest('C canonical non-cast Configure is not classified as a spell by the mode2 refusal',async t=>{
  const f=await cGame(t),meta=bUtilityMetadata('Varrock Teleport');
  const before=mInventory(f.a),messages=messagesOf(f.a),disabled=[],real=PM.emitSpellDisabled.bind(PM);
  t.mock.method(PM,'emitSpellDisabled',(...args)=>{disabled.push(args);return real(...args);});
  await nativeButton(f.a,meta.widgetId,10,65535,meta.itemId);
  assert.equal(disabled.length,0,'Configure reaches canonical non-cast branch, not the permission hook');
  assert.ok(messages.some(m=>/diary/i.test(m)),'canonical diary prerequisite retains its own refusal rather than a mode2 cast refusal');
  assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});
for(const melee of[0,1])for(const ranged of[0,1])for(const magic of[1,2,3,4])mTest(`C native style copy ${melee}/${ranged}/${magic}`,async t=>{
  cInstall();const a=actor(true),b=actor(true);channel(a);channel(b);const scripts=scriptCalls(a),lines=messagesOf(a),titles=[];
  const sender=a.getPacketSender(),real=sender.sendString.bind(sender);t.mock.method(sender,'sendString',(text,uid)=>{if(uid===C.uid('clanwars_setup:title'))titles.push(text);return real(text,uid);});
  const game=await negotiate(a,b,2,1,{magic,melee,ranged});await join(a);await join(b);
  const terms=scripts.filter(x=>x[0]===554).map(x=>x[2]);assert.ok(terms.length>=2);for(const text of terms){
    if(melee===1&&ranged===1&&magic===4)assert.match(text,/No new player combat/);else assert.doesNotMatch(text,/No new player combat/);
    if(magic===1){assert.match(text,/34 finite combat spells/);assert.match(text,/manual Confuse, Weaken, Curse, Bind, Snare, Entangle, Vulnerability, Enfeeble and Stun/);}
    if(magic===2){assert.match(text,/Classic F2P/);assert.match(text,/cast manually/);assert.match(text,/utilities, autocasts/);assert.match(text,/still-queued outgoing/);}
    if(magic===3){assert.match(text,/Binding.only/);assert.match(text,/utility spells/);assert.match(text,/still-queued outgoing/);}
  }
  if(melee===1&&magic===2){assert.ok(titles.some(x=>/manual Classic F2P/.test(x)));assert.equal(lines.some(x=>/No new player combat is enabled/.test(x)),false);}
  if(melee===1&&magic===3){assert.ok(titles.some(x=>/binding spells/.test(x)));assert.equal(lines.some(x=>/No new player combat is enabled/.test(x)),false);}
  assert.equal(game.rules.magic,magic);
});

const C_CLASSIC_UTILITY_REFUSAL='Classic F2P combat supports the 12 elemental strike, bolt and blast spells, Confuse, Weaken, Curse and Bind; other casts, including utilities, are unavailable in this battle.';
function cObserveTimerWrites(t,p){
  const calls=[],timers=p.getTimers();
  for(const method of['register','registerTimerKey','registers','extendOrRegister','addOrSet','cancel']){
    const real=timers[method].bind(timers);t.mock.method(timers,method,(...args)=>{calls.push({method,args});return real(...args);});
  }
  return calls;
}
for(const key of Object.keys(C_CURSES))mTest('C '+key+' new healthy opposing target is independent of a drained first target',async t=>{
  let other;const f=await cGame(t,{beforeEntry:async(a,b)=>{other=actor(true);ruleStats(other,99);assert.equal(FC.join(other,b.getUsername(),false),true);await join(other);}});
  const first=await mFire(f,key);bStop(f);mLand(f,first);const before=cStats(f.b);assert.equal(before[C_CURSES[key]],95);
  mPosition(f.game,f.a,other);tick(10);const next={...f,b:other,trace:mTrace(t,f.a,other)},hit=await mFire(next,key);bStop(next);mLand(next,hit);
  assert.equal(other.getSkillManager().getCurrentLevel(core.Skill[C_CURSES[key]]),95);assert.deepEqual(cStats(f.b),before);
});
for(const key of Object.keys(C_CURSES))mTest('C '+key+' applied stat drain is not reversed by departure queue disposal',async t=>{
  const f=await cGame(t),hit=await mFire(f,key);bStop(f);mLand(f,hit);const stats=cStats(f.b);assert.equal(stats[C_CURSES[key]],95);
  f.game.area.leave(f.a,false);assert.deepEqual(cStats(f.b),stats,'queue helper does not roll back an already-applied stat effect');
});
for(const key of[core.TimerKey.FREEZE,core.TimerKey.FREEZE_IMMUNITY])mTest('C Bind preexisting '+key+' refuses sack and tome before payment',async t=>{
  const f=await cGame(t,{rules:{freezing:1}}),I=core.ItemIdentifiers;await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'water',2);
  f.a.getInventory().resetItems();f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));f.b.getTimers().registers(key,40);
  const before=mInventory(f.a);await mSpell(f.a,f.b,'BIND');tick(8);assert.deepEqual(mInventory(f.a),before);assert.equal(book.Common.read(book.item).charges,2);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});
for(const refusal of['low-level','wrong-book','missing-resources','unsupported-loadout','staging','same-team'])mTest('C actual '+refusal+' refuses canonical curse before spend',async t=>{
  const f=await cGame(t,{prepare:refusal!=='staging'}),I=core.ItemIdentifiers;
  if(refusal==='low-level')f.a.getSkillManager().setCurrentLevel(core.Skill.MAGIC,2,false);
  if(refusal==='wrong-book')f.a.setSpellbook(core.MagicSpellbook.ANCIENT);
  if(refusal==='missing-resources')f.a.getInventory().resetItems();
  if(refusal==='unsupported-loadout')await mEquip(f.a,I.IBANS_STAFF);
  if(refusal==='same-team')f.game.fighters.set(f.b,f.game.fighters.get(f.a));
  const before=resources(f.a),stats=cStats(f.b),hp=f.b.getHitpoints();await mSpell(f.a,f.b,'CONFUSE');tick(8);assert.deepEqual(resources(f.a),before);assert.deepEqual(cStats(f.b),stats);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
});
mTest('C real lethal paid Fire Blast reaches canonical safe jail rejoin and a fresh Bind',async t=>{
  const f=await cGame(t);f.b.setHitpoints(1);const hit=await mFire(f,'FIRE_BLAST');bStop(f);mLand(f,hit);
  for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();assert.equal(f.game.jailed.has(f.b),true);await jailExit(f.b,f.game);assert.equal(f.game.fighters.has(f.b),true);
  tick(40);mPosition(f.game,f.a,f.b);const trace=fTrace(t,f.b),fresh=await mFire(f,'BIND');bStop(f);assert.notEqual(fresh,hit);mLand(f,fresh);bTimerOracle(trace,8);
});

for(const row of B_ROWS.filter(row=>row[0]==='BIND'))for(const pieces of[0,1,2,3])mTest(`C ${row[0]} Swampbark commit${pieces} survives impact gear swap`,async t=>{
  const f=await cGame(t);bMetadata(row);bArmour(f.a,pieces);const trace=fTrace(t,f.b),hit=await mFire(f,row[0]);bStop(f);
  const context=hit.getSpellContext();assert.equal(context.data.get('standard-bindings:hold-ticks'),row[6]+pieces*2);
  bArmour(f.a,3-pieces);mLand(f,hit);assert.equal(hit.getSpellContext(),context);bTimerOracle(trace,row[6]+pieces*2);
});
for(const row of B_ROWS.filter(row=>row[0]==='BIND'))for(const element of['water','earth'])mTest(`C ${row[0]} actual ${element} tome final-charge context and real roll`,async t=>{
  const f=await cGame(t),I=core.ItemIdentifiers;bMetadata(row);await mEquip(f.a,I['TOME_OF_'+element.toUpperCase()+'_EMPTY_'],core.Equipment.SHIELD_SLOT);const book=mTome(f.a,element,1);
  const rune=I[element.toUpperCase()+'_RUNE'];f.a.getInventory().deleteNumber(rune,f.a.getInventory().getAmount(rune));
  const rolls=[],emit=PM.emitCustomEvent.bind(PM);magicRollControl=null;
  t.mock.method(PM,'emitCustomEvent',(name,event)=>{
    const own=name==='combat:magic-attack-roll-modify'&&event.attacker===f.a&&event.target===f.b,before=own?event.attackRoll:null;
    const result=emit(name,event);if(own)rolls.push({before,after:event.attackRoll,context:event.context});return result;
  });
  const hit=await mFire(f,row[0]);bStop(f);assert.ok(rolls.length>0,'native hit actually computes the canonical attack roll without forceAccuracy');
  for(const roll of rolls){assert.equal(roll.after,element==='water'?Math.floor(roll.before*1.2):roll.before);assert.equal(roll.context,hit.getSpellContext());}
  assert.equal(book.Common.read(book.item).charges,element==='water'?0:1);
  assert.equal(hit.getSpellContext().data.get(require('../plugins/items/elementaltomes/Combat.ElementalTomes').CAST_DATA_KEY).element,element);
  f.a.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=new core.Item(-1);mLand(f,hit);assert.equal(book.Common.read(book.item).charges,element==='water'?0:1);
});

mTest('C preview and shared cooldown preserve one actual paid native curse',async t=>{
  const f=await cGame(t),spell=core.CombatSpells.CONFUSE,before=mInventory(f.a);await mSpell(f.a,f.b,'CONFUSE');
  assert.equal(spell.canCast(f.a,false),true);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
  const hit=await mFire(f,'CONFUSE');bStop(f);const paid=mInventory(f.a);await mSpell(f.a,f.b,'WEAKEN');
  assert.equal(f.a.getCombat().getCastSpell(),core.CombatSpells.WEAKEN,'real manual selection precedes negative payment check');
  assert.equal(core.CombatSpells.WEAKEN.canCast(f.a,true),false,'shared same-tick delay refuses a second cost');assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,1);bStop(f);mLand(f,hit);assert.equal(f.trace.commits.length,1);
});
for(const name of['WIND_STRIKE','FIRE_BLAST'])mTest('C elemental '+name+' spends ordinary runes and cannot use an entangle sack',async t=>{
  const f=await cGame(t),I=core.ItemIdentifiers;f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));const cost=mCost(f.a,core.CombatSpells[name]),before=mAmounts(f.a,cost),hit=await mFire(f,name);bStop(f);mPaid(f.a,cost,before);assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),2);mLand(f,hit);
});

// E: native Standard six-effect extension. Same guarded cInstall; no loader/listener replay.
const E_ROWS=[{"key":"CONFUSE","label":"Confuse","itemId":3274,"widgetId":14286860,"level":3,"runes":[{"id":559,"amount":1},{"id":555,"amount":3},{"id":557,"amount":2}],"baseXP":13,"splashXP":13},{"key":"WEAKEN","label":"Weaken","itemId":3278,"widgetId":14286866,"level":11,"runes":[{"id":559,"amount":1},{"id":555,"amount":3},{"id":557,"amount":2}],"baseXP":21,"splashXP":21},{"key":"CURSE","label":"Curse","itemId":3282,"widgetId":14286870,"level":19,"runes":[{"id":559,"amount":1},{"id":555,"amount":2},{"id":557,"amount":3}],"baseXP":29,"splashXP":29},{"key":"BIND","label":"Bind","itemId":3283,"widgetId":14286871,"level":20,"runes":[{"id":561,"amount":2},{"id":555,"amount":3},{"id":557,"amount":3}],"baseXP":31,"splashXP":30},{"key":"SNARE","label":"Snare","itemId":3300,"widgetId":14286890,"level":50,"runes":[{"id":561,"amount":3},{"id":555,"amount":4},{"id":557,"amount":4}],"baseXP":61,"splashXP":60},{"key":"ENTANGLE","label":"Entangle","itemId":3322,"widgetId":14286917,"level":79,"runes":[{"id":561,"amount":4},{"id":555,"amount":5},{"id":557,"amount":5}],"baseXP":89,"splashXP":70}];
const E_BINDINGS={BIND:8,SNARE:16,ENTANGLE:24};
async function eGame(t,options={}){cInstall();return mGame(t,{...options,rules:{magic:1,...options.rules}});}
mTest('E Standard native Confuse commits pays queues and applies the canonical effect',async t=>{
  const f=await eGame(t),row=E_ROWS.find(x=>x.key==='CONFUSE');cMetadata(row);assert.equal(f.game.rules.magic,1);assert.equal(f.game.phase,'combat');assert.equal(f.game.fighters.get(f.a)===f.game.fighters.get(f.b),false);
  const stats=cStats(f.b),hp=f.b.getHitpoints(),cost=mCost(f.a,core.CombatSpells.CONFUSE),amounts=mAmounts(f.a,cost);assert.equal(stats.ATTACK,99);assert.ok(cost.every(([id,n])=>f.a.getInventory().getAmount(id)>=n));
  const hit=await mFire(f,'CONFUSE');bStop(f);mPaid(f.a,cost,amounts);assert.equal(hit.getTotalDamage(),0);assert.deepEqual(cStats(f.b),stats);mLand(f,hit);cAssertStats(f.b,stats,'ATTACK',5);assert.equal(f.b.getHitpoints(),hp);
});
for(const row of E_ROWS)for(const accurate of[true,false])for(const freezing of[0,1])mTest(`E ${row.key} native accurate${accurate} Ignore${freezing}`,async t=>{
  const f=await eGame(t,{rules:{freezing}});cMetadata(row);const stats=cStats(f.b),hp=f.b.getHitpoints(),calls=[],splashes=[];
  magicRollControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.forceAccurate=accurate;e.forceMaxHit=true;}};
  // Supplied branch at the real PendingHit's damage event, never a natural probability claim.
  if(!accurate)magicDamageControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.accurate=false;e.damage.setDamage(0);splashes.push(e);}};
  const sm=f.a.getSkillManager(),add=sm.addExperience.bind(sm);t.mock.method(sm,'addExperience',(...args)=>{calls.push(args);return add(...args);});
  const trace=fTrace(t,f.b),cost=mCost(f.a,core.CombatSpells[row.key]),before=mAmounts(f.a,cost),hit=await mFire(f,row.key);bStop(f);mPaid(f.a,cost,before);
  if(!accurate){assert.equal(splashes.length,1);assert.equal(splashes[0].hit,hit);assert.equal(splashes[0].damage,hit.getHits()[0]);assert.equal(splashes[0].combatType,core.CombatType.MAGIC);assert.equal(splashes[0].accurate,false);assert.equal(splashes[0].damage.getDamage(),0);}
  assert.equal(hit.isAccurate(),accurate);const damage=hit.getTotalDamage();if(C_CURSES[row.key]||row.key==='BIND'||!accurate)assert.equal(damage,0);else assert.ok(damage>0);
  assert.deepEqual(cStats(f.b),stats,'queued effects are not applied early');mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-damage);
  cAssertStats(f.b,stats,accurate?C_CURSES[row.key]:null,5);
  assert.ok(calls.some(x=>x[0]===core.Skill.MAGIC&&x[1]===(accurate?row.baseXP:row.splashXP)),'canonical base XP producer is forwarded with independent pinned amount');
  if(E_BINDINGS[row.key]&&accurate&&!freezing)bTimerOracle(trace,E_BINDINGS[row.key]);else fNoNewEffects(trace);
  assert.equal(trace.attempts.length,E_BINDINGS[row.key]&&accurate?1:0);
});
for(const key of Object.keys(C_CURSES))mTest('E '+key+' native lowered partial full recovery and impact race remain canonical',async t=>{
  const f=await eGame(t),skill=core.Skill[C_CURSES[key]],sm=f.b.getSkillManager(),first=await mFire(f,key);bStop(f);mLand(f,first);assert.equal(sm.getCurrentLevel(skill),95);
  tick(10);const paid=mInventory(f.a),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC),n=f.trace.commits.length,lines=messagesOf(f.a);
  await mSpell(f.a,f.b,key);tick(8);bStop(f);assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,n);assert.equal(f.a.getSkillManager().getExperience(core.Skill.MAGIC),xp);assert.ok(lines.some(x=>/weakened/.test(x)));
  sm.setCurrentLevel(skill,98,false);await mSpell(f.a,f.b,key);tick(8);bStop(f);assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,n);
  sm.setCurrentLevel(skill,99,false);tick(10);const second=await mFire(f,key);bStop(f);assert.notEqual(second,first);sm.setCurrentLevel(skill,98,false);mLand(f,second);assert.equal(sm.getCurrentLevel(skill),98,'intervening drain prevents stacking at impact');
  const other=key==='CONFUSE'?'WEAKEN':'CONFUSE',otherSkill=core.Skill[C_CURSES[other]];sm.setCurrentLevel(otherSkill,99,false);tick(10);const independent=await mFire(f,other);bStop(f);mLand(f,independent);assert.equal(sm.getCurrentLevel(otherSkill),95);
});
for(const key of Object.keys(C_CURSES))for(const tome of[false,true])mTest(`E ${key} committed effect floor99 ${tome?'water final-charge swap':'base'} and independent resources`,async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers;let book;
  if(tome){await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);book=mTome(f.a,'water',1);f.a.getInventory().deleteNumber(I.WATER_RUNE,f.a.getInventory().getAmount(I.WATER_RUNE));}
  const cost=mCost(f.a,core.CombatSpells[key]),amounts=mAmounts(f.a,cost),stats=cStats(f.b),hp=f.b.getHitpoints(),hit=await mFire(f,key);bStop(f);mPaid(f.a,cost,amounts);assert.equal(hit.isAccurate(),true);assert.equal(hit.getTotalDamage(),0);assert.deepEqual(cStats(f.b),stats);
  const context=hit.getSpellContext();if(tome){assert.equal(book.Common.read(book.item).charges,0);assert.equal(context.data.get(require('../plugins/items/elementaltomes/Combat.ElementalTomes').CAST_DATA_KEY).element,'water');f.a.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=new core.Item(-1);}
  mLand(f,hit);assert.equal(hit.getSpellContext(),context);cAssertStats(f.b,stats,C_CURSES[key],tome?7:5);assert.equal(f.b.getHitpoints(),hp);if(tome)assert.equal(book.Common.read(book.item).charges,0);
});
for(const key of Object.keys(C_CURSES))mTest('E '+key+' unforced real forwarded Water tome attack roll uses committed final charge',async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'water',1),rolls=[],emit=PM.emitCustomEvent.bind(PM);magicRollControl=null;
  t.mock.method(PM,'emitCustomEvent',(name,event)=>{const own=name==='combat:magic-attack-roll-modify'&&event.attacker===f.a&&event.target===f.b,before=own?event.attackRoll:null;const result=emit(name,event);if(own)rolls.push({before,after:event.attackRoll,context:event.context});return result;});
  const hit=await mFire(f,key);bStop(f);assert.ok(rolls.length>0);for(const roll of rolls){assert.equal(roll.after,Math.floor(roll.before*1.2));assert.equal(roll.context,hit.getSpellContext());}assert.equal(book.Common.read(book.item).charges,0);mLand(f,hit);
  // This separate real-roll observation does not assert a random effect outcome.
});
for(const key of['CONFUSE','WEAKEN','CURSE','BIND','SNARE','ENTANGLE'])mTest('E '+key+' pouch staff and sack funding stay canonical and independent',async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');await mEquip(f.a,I.STAFF_OF_WATER);give(f.a,I.RUNE_POUCH,'C-pouch');
  const rune=E_BINDINGS[key]!=null?I.NATURE_RUNE:I.BODY_RUNE;Pouch.setSlots(f.a,[{id:rune,amount:10},null,null,null]);f.a.getInventory().deleteNumber(rune,f.a.getInventory().getAmount(rune));f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));
  const water=f.a.getInventory().getAmount(I.WATER_RUNE),earth=f.a.getInventory().getAmount(I.EARTH_RUNE),cost=core.CombatSpells[key].itemsRequired(f.a),runeCost=cost.find(x=>x.getId()===rune).getAmount(),earthCost=cost.find(x=>x.getId()===I.EARTH_RUNE).getAmount(),hit=await mFire(f,key);bStop(f);
  if(E_BINDINGS[key]!=null){assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),1);assert.equal(Pouch.amountOf(f.a,rune),10);assert.equal(f.a.getInventory().getAmount(I.EARTH_RUNE),earth);}
  else{assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),2);assert.equal(Pouch.amountOf(f.a,rune),10-runeCost);assert.equal(f.a.getInventory().getAmount(I.EARTH_RUNE),earth-earthCost);}
  assert.equal(f.a.getInventory().getAmount(I.WATER_RUNE),water);mLand(f,hit);
});
for(const row of B_ROWS)for(const pieces of[0,1,2,3])mTest(`E ${row[0]} Swampbark commit${pieces} survives impact gear swap`,async t=>{
  const f=await eGame(t);bMetadata(row);bArmour(f.a,pieces);const trace=fTrace(t,f.b),hit=await mFire(f,row[0]);bStop(f);
  const context=hit.getSpellContext();assert.equal(context.data.get('standard-bindings:hold-ticks'),row[6]+pieces*2);
  bArmour(f.a,3-pieces);mLand(f,hit);assert.equal(hit.getSpellContext(),context);bTimerOracle(trace,row[6]+pieces*2);
});
for(const row of B_ROWS)for(const tome of[false,true])mTest(`E ${row[0]} Clan Wars one entangle sack${tome?' plus Water tome':''}`,async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers;bMetadata(row);
  assert.equal(f.a.getArea().getName(),'Clan Wars');
  let book;if(tome){await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);book=mTome(f.a,'water',2);}
  f.a.getInventory().resetItems();f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));
  const hit=await mFire(f,row[0]);bStop(f);assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),1);
  for(const rune of[I.WATER_RUNE,I.EARTH_RUNE,I.NATURE_RUNE])assert.equal(f.a.getInventory().getAmount(rune),0);
  if(book)assert.equal(book.Common.read(book.item).charges,1);mLand(f,hit);assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),1);
});
for(const row of B_ROWS)for(const element of['water','earth'])mTest(`E ${row[0]} actual ${element} tome final-charge context and real roll`,async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers;bMetadata(row);await mEquip(f.a,I['TOME_OF_'+element.toUpperCase()+'_EMPTY_'],core.Equipment.SHIELD_SLOT);const book=mTome(f.a,element,1);
  const rune=I[element.toUpperCase()+'_RUNE'];f.a.getInventory().deleteNumber(rune,f.a.getInventory().getAmount(rune));
  const rolls=[],emit=PM.emitCustomEvent.bind(PM);magicRollControl=null;
  t.mock.method(PM,'emitCustomEvent',(name,event)=>{
    const own=name==='combat:magic-attack-roll-modify'&&event.attacker===f.a&&event.target===f.b,before=own?event.attackRoll:null;
    const result=emit(name,event);if(own)rolls.push({before,after:event.attackRoll,context:event.context});return result;
  });
  const hit=await mFire(f,row[0]);bStop(f);assert.ok(rolls.length>0,'native hit actually computes the canonical attack roll without forceAccuracy');
  for(const roll of rolls){assert.equal(roll.after,element==='water'?Math.floor(roll.before*1.2):roll.before);assert.equal(roll.context,hit.getSpellContext());}
  assert.equal(book.Common.read(book.item).charges,element==='water'?0:1);
  assert.equal(hit.getSpellContext().data.get(require('../plugins/items/elementaltomes/Combat.ElementalTomes').CAST_DATA_KEY).element,element);
  f.a.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=new core.Item(-1);mLand(f,hit);assert.equal(book.Common.read(book.item).charges,element==='water'?0:1);
});
for(const row of B_ROWS)mTest(`E ${row[0]} inventory pouch and staff canonical payment`,async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');bMetadata(row);
  await mEquip(f.a,I.STAFF_OF_WATER);give(f.a,I.RUNE_POUCH,'B-pouch');Pouch.setSlots(f.a,[{id:I.NATURE_RUNE,amount:10},null,null,null]);
  f.a.getInventory().deleteNumber(I.NATURE_RUNE,f.a.getInventory().getAmount(I.NATURE_RUNE));const water=f.a.getInventory().getAmount(I.WATER_RUNE),earth=f.a.getInventory().getAmount(I.EARTH_RUNE);
  const costs=core.CombatSpells[row[0]].itemsRequired(f.a),natureCost=costs.find(x=>x.getId()===I.NATURE_RUNE).getAmount(),earthCost=costs.find(x=>x.getId()===I.EARTH_RUNE).getAmount();
  const hit=await mFire(f,row[0]);bStop(f);assert.equal(Pouch.amountOf(f.a,I.NATURE_RUNE),10-natureCost);assert.equal(f.a.getInventory().getAmount(I.WATER_RUNE),water);assert.equal(f.a.getInventory().getAmount(I.EARTH_RUNE),earth-earthCost);mLand(f,hit);
});
for(const row of B_ROWS)for(const key of[core.TimerKey.FREEZE,core.TimerKey.FREEZE_IMMUNITY])mTest(`E ${row[0]} preexisting ${key} refuses sacks and Water tome before spend`,async t=>{
  const f=await eGame(t,{rules:{freezing:1}}),I=core.ItemIdentifiers;bMetadata(row);await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'water',2);
  f.a.getInventory().resetItems();f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));f.b.getTimers().registers(key,40);
  const before=mInventory(f.a);await mSpell(f.a,f.b,row[0]);tick(8);assert.deepEqual(mInventory(f.a),before);assert.equal(book.Common.read(book.item).charges,2);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});
for(const spell of['CURSE','BIND'])for(const boundary of['victim-leave','caster-leave','victim-logout','caster-logout','channel','finish','caster-death'])mTest('E paid native '+spell+' discarded at '+boundary+' without refund or new hold',async t=>{
  const f=await eGame(t),cost=mCost(f.a,core.CombatSpells[spell]),before=mAmounts(f.a,cost),hit=await mFire(f,spell);bStop(f);mPaid(f.a,cost,before);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);const paid=mInventory(f.a),hp=f.b.getHitpoints(),stats=cStats(f.b);
  if(boundary==='victim-leave')f.game.area.leave(f.b,false);else if(boundary==='caster-leave')f.game.area.leave(f.a,false);
  else if(boundary==='victim-logout')PM.emitPlayerLogout({player:f.b,username:f.b.getUsername()});else if(boundary==='caster-logout')PM.emitPlayerLogout({player:f.a,username:f.a.getUsername()});
  else if(boundary==='channel')FC.leave(f.a,true);else if(boundary==='finish')f.game.finish(null);
  else{f.a.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(f.a.getHitpoints(),core.HitMask.RED).setSource(f.b)]);tick();}
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);for(const p of[f.a,f.b])p.setNeedsPlacement(false);tick(35);
  assert.deepEqual(mInventory(f.a),paid);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getTimers().has(core.TimerKey.FREEZE),false);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(cStats(f.b),stats);
});
mTest('E actual paid mapped Forfeit cancels the exact native pending hit',async t=>{
  const f=await eGame(t),hit=await mFire(f,'BIND');bStop(f);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);const paid=mInventory(f.a),hp=f.b.getHitpoints(),stats=cStats(f.b);
  magicTurns=false;await nmForfeit(f.a,f.game);magicTurns=true;for(const p of[f.a,f.b])p.setNeedsPlacement(false);tick(12);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(cStats(f.b),stats);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getTimers().has(core.TimerKey.FREEZE),false);assert.deepEqual(mInventory(f.a),paid);
});
for(const style of['bow','melee'])for(const direction of['incoming','outgoing'])mTest(`E ${style} ${direction} native queued hit is disposed at mapped Forfeit`,async t=>{
  let ally;const f=await eGame(t,{rules:{ranged:0},beforeEntry:async(a,b)=>{
    ally=actor(true);ruleStats(ally,99);assert.equal(FC.join(ally,(direction==='incoming'?b:a).getUsername(),false),true);await join(ally);
  }}),{a,b,game}=f,queue=b.getCombat().getHitQueue();
  magicTurns=false;magicRollControl=null;const process=queue.process.bind(queue),hold=t.mock.method(queue,'process',()=>{}),hp=b.getHitpoints();
  let hit,paid;
  if(style==='bow'){
    await bowEquip(a);bowPlace(a,b,game);const shot=await bowFire(t,a,b);assert.equal(shot.before-shot.after,1);paid=bowAmount(a);
    hit=f.trace.hits.find(h=>h.getCombatMethod()===CombatFactory.RANGED_COMBAT);assert.ok(hit);
  }else{
    await tEquip(a,core.ItemIdentifiers.DRAGON_DAGGER);nmPlace(game,a,b);const trace=nmTrace(t,a,b);
    ghastTurns=true;await nmAttack(a,b);nmEngineUntil(()=>trace.queued.length>0);a.getCombat().reset();ghastTurns=false;
    hit=trace.queued[0];assert.ok(hit);assert.equal(hit.getCombatMethod().type(),core.CombatType.MELEE);assert.ok(hit.getTotalDamage()>0);
  }
  assert.equal(queue.hasPendingHit(hit),true,'actual native producer created this exact queued hit before departure');
  const leaving=direction==='incoming'?b:a,generation=queue.getIncomingGeneration();await nmForfeit(leaving,game);
  assert.equal(C.matches.has(leaving),false);assert.equal(game.phase,'combat','same-side actual ally retains the instance');assert.equal(queue.hasPendingHit(hit),false);
  if(direction==='incoming')assert.ok(queue.getIncomingGeneration()>generation);
  hold.mock.restore();for(const p of[a,b])p.setNeedsPlacement(false);process(C.now());tick(15);
  assert.equal(b.getHitpoints(),hp);assert.equal(f.trace.resolved.includes(hit),false);if(style==='bow')assert.equal(bowAmount(a),paid);
});
mTest('E native entry and supplied rejoin preserve self and null-source damage while clearing pre-entry incoming work',async t=>{
  cInstall();const a=actor(true),b=actor(true);ruleStats(a,99);ruleStats(b,99);channel(a);channel(b);const game=await negotiate(a,b,2,1,{magic:1});
  const queue=a.getCombat().getHitQueue(),generation=queue.getIncomingGeneration(),foreign=new core.PendingHit(b,a,CombatFactory.MELEE_COMBAT,{damage:7,rollAccuracy:false,experience:false,delay:500});
  CombatFactory.addPendingHit(foreign);queue.addPendingDamage([new core.HitDamage(1,core.HitMask.RED).setSource(a),new core.HitDamage(2,core.HitMask.RED)]);
  assert.equal(queue.hasPendingHit(foreign),true);await join(a);await join(b);assert.equal(queue.hasPendingHit(foreign),false);assert.ok(queue.getIncomingGeneration()>generation);assert.equal(queue.getQueuedDamage(),3);
  magicTurns=true;tick();assert.equal(a.getHitpoints(),96);completePreparation(game);mPosition(game,a,b);game.eliminate(a);game.jailed.add(a);
  const next=new core.PendingHit(b,a,CombatFactory.MELEE_COMBAT,{damage:7,rollAccuracy:false,experience:false,delay:500});CombatFactory.addPendingHit(next);
  const at=game.area.at(game.layout.jails[game.members.get(a)]);a.moveTo(at);a.setNeedsPlacement(false);const again=queue.getIncomingGeneration();
  assert.equal(game.rejoin(a),true,'explicit jail checkpoint exercises existing real rejoin owner, not natural death');assert.equal(queue.hasPendingHit(next),false);assert.ok(queue.getIncomingGeneration()>again);
});
for(const key of Object.keys(C_CURSES))mTest('E '+key+' new healthy opposing target is independent of a drained first target',async t=>{
  let other;const f=await eGame(t,{beforeEntry:async(a,b)=>{other=actor(true);ruleStats(other,99);assert.equal(FC.join(other,b.getUsername(),false),true);await join(other);}});
  const first=await mFire(f,key);bStop(f);mLand(f,first);const before=cStats(f.b);assert.equal(before[C_CURSES[key]],95);
  mPosition(f.game,f.a,other);tick(10);const next={...f,b:other,trace:mTrace(t,f.a,other)},hit=await mFire(next,key);bStop(next);mLand(next,hit);
  assert.equal(other.getSkillManager().getCurrentLevel(core.Skill[C_CURSES[key]]),95);assert.deepEqual(cStats(f.b),before);
});
for(const key of Object.keys(C_CURSES))mTest('E '+key+' applied stat drain is not reversed by departure queue disposal',async t=>{
  const f=await eGame(t),hit=await mFire(f,key);bStop(f);mLand(f,hit);const stats=cStats(f.b);assert.equal(stats[C_CURSES[key]],95);
  f.game.area.leave(f.a,false);assert.deepEqual(cStats(f.b),stats,'queue helper does not roll back an already-applied stat effect');
});
for(const refusal of['low-level','wrong-book','missing-resources','unsupported-loadout','staging','same-team'])mTest('E actual '+refusal+' refuses canonical curse before spend',async t=>{
  const f=await eGame(t,{prepare:refusal!=='staging'}),I=core.ItemIdentifiers;
  if(refusal==='low-level')f.a.getSkillManager().setCurrentLevel(core.Skill.MAGIC,2,false);
  if(refusal==='wrong-book')f.a.setSpellbook(core.MagicSpellbook.ANCIENT);
  if(refusal==='missing-resources')f.a.getInventory().resetItems();
  if(refusal==='unsupported-loadout')await mEquip(f.a,I.ANCIENT_STAFF);
  if(refusal==='same-team')f.game.fighters.set(f.b,f.game.fighters.get(f.a));
  const before=resources(f.a),stats=cStats(f.b),hp=f.b.getHitpoints();await mSpell(f.a,f.b,'CONFUSE');tick(8);assert.deepEqual(resources(f.a),before);assert.deepEqual(cStats(f.b),stats);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
});
mTest('E real lethal paid Fire Blast reaches canonical safe jail rejoin and a fresh Bind',async t=>{
  const f=await eGame(t);f.b.setHitpoints(1);const hit=await mFire(f,'FIRE_BLAST');bStop(f);mLand(f,hit);
  for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();assert.equal(f.game.jailed.has(f.b),true);await jailExit(f.b,f.game);assert.equal(f.game.fighters.has(f.b),true);
  tick(40);mPosition(f.game,f.a,f.b);const trace=fTrace(t,f.b),fresh=await mFire(f,'BIND');bStop(f);assert.notEqual(fresh,hit);mLand(f,fresh);bTimerOracle(trace,8);
});

mTest('E preview and shared cooldown preserve one actual paid native curse',async t=>{
  const f=await eGame(t),spell=core.CombatSpells.CONFUSE,before=mInventory(f.a);await mSpell(f.a,f.b,'CONFUSE');
  assert.equal(spell.canCast(f.a,false),true);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
  const hit=await mFire(f,'CONFUSE');bStop(f);const paid=mInventory(f.a);await mSpell(f.a,f.b,'WEAKEN');
  assert.equal(f.a.getCombat().getCastSpell(),core.CombatSpells.WEAKEN,'real manual selection precedes negative payment check');
  assert.equal(core.CombatSpells.WEAKEN.canCast(f.a,true),false,'shared same-tick delay refuses a second cost');assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,1);bStop(f);mLand(f,hit);assert.equal(f.trace.commits.length,1);
});
mTest('E inactive remembered autocast with a native dagger Attack remains melee',async t=>{
  const f=await eGame(t);await cAutocast(f.a);await tEquip(f.a,core.ItemIdentifiers.DRAGON_DAGGER);assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells.WIND_STRIKE);assert.equal(core.Autocasting.isActive(f.a),false);
  const before=mInventory(f.a),trace=nmTrace(t,f.a,f.b);nmPlace(f.game,f.a,f.b);ghastTurns=true;await cNativeAttack(f.a,f.b);nmEngineUntil(()=>trace.queued.length>0);f.a.getCombat().reset();ghastTurns=false;
  assert.ok(trace.queued.some(h=>h.getCombatMethod().type()===core.CombatType.MELEE));assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
});
for(const row of E_ROWS)mTest('E '+row.key+' native hand effect overrides elemental autocast then real paid elemental resumes',async t=>{
  const f=await eGame(t);cMetadata(row);await cAutocast(f.a);const spell=core.CombatSpells[row.key],cost=mCost(f.a,spell),before=mAmounts(f.a,cost),mind=f.a.getInventory().getAmount(core.ItemIdentifiers.MIND_RUNE),hit=await mFire(f,row.key);mPaid(f.a,cost,before);
  assert.equal(core.Autocasting.isActive(f.a),true);mLand(f,hit);for(let i=0;i<30&&!f.trace.commits.some(x=>x.spell===core.CombatSpells.WIND_STRIKE);i++)tick();bStop(f);
  const resumed=f.trace.commits.find(x=>x.spell===core.CombatSpells.WIND_STRIKE);assert.ok(resumed,'actual engine resumes permitted elemental autocast after hand effect');assert.ok(f.trace.hits.some(h=>h.getSpell()===core.CombatSpells.WIND_STRIKE&&h.getSpellContext()===resumed.context));
  assert.equal(f.trace.commits.filter(x=>x.spell===spell).length,1,'effect is a manual override, not a new autocast family');assert.equal(f.a.getInventory().getAmount(core.ItemIdentifiers.MIND_RUNE),mind-f.trace.commits.filter(x=>x.spell===core.CombatSpells.WIND_STRIKE).length);
});
for(const key of['TELEBLOCK','CRUMBLE_UNDEAD'])mTest('E omitted '+key+' stays deferred before payment',async t=>{
  const f=await eGame(t),before=resources(f.a),stats=cStats(f.b);await mSpell(f.a,f.b,key,key==='TELEBLOCK'?'Tele Block':null);tick(10);bStop(f);assert.deepEqual(resources(f.a),before);assert.deepEqual(cStats(f.b),stats);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
});
mTest('E initial Standard disclosures reach both captains before selection',async t=>{
  cInstall();const a=actor(true),b=actor(true);channel(a);channel(b);const lines=[messagesOf(a),messagesOf(b)],Magic=require('../plugins/minigames/clanwars/Magic.ClanWars');await challenge(a,b);await challenge(b,a);
  const session=C.negotiations.get(a);assert.equal(session.rules.magic,4);assert.equal(session.revision,0);assert.equal(session.accepted.size,0);
  for(const messages of lines){assert.ok(messages.some(x=>/Standard combat spells, manual Classic F2P/.test(x)));assert.ok(messages.includes(Magic.SUPPORT));assert.ok(messages.includes(Magic.ACCOUNTING));assert.match(Magic.SUPPORT,/34 finite combat spells/);for(const x of[Magic.CLASSIC_SUPPORT,Magic.CLASSIC_ACCOUNTING,Magic.BINDING_SUPPORT,Magic.BINDING_ACCOUNTING])assert.ok(messages.includes(x));}
});
for(const staging of[false,true])mTest('E Standard NORMAL native utility remains paid with six effects enabled staging'+staging,async t=>{
  const f=await eGame(t,{prepare:!staging}),I=core.ItemIdentifiers;give(f.a,I.BONES,'E-bones');const meta=bUtilityMetadata('Bones to Bananas'),spell=core.EffectSpells.BONES_TO_BANANAS,seen=[],real=PM.emitSpellDisabled.bind(PM),cost=mCost(f.a,spell),before=mAmounts(f.a,cost),bananas=f.a.getInventory().getAmount(I.BANANA);
  t.mock.method(PM,'emitSpellDisabled',(...args)=>{const result=real(...args);if(args[0]===f.a)seen.push({args,result});return result;});await nativeButton(f.a,meta.widgetId,1,65535,meta.itemId);
  assert.ok(seen.some(x=>x.args[1]===core.MagicSpellbook.NORMAL&&x.args[3]===spell&&x.result===null));mPaid(f.a,cost,before);assert.ok(f.a.getInventory().getAmount(I.BANANA)>bananas);assert.equal(f.trace.commits.length,1);assert.equal(f.trace.commits[0].spell,spell);assert.equal(f.trace.hits.length,0);
});

for(const staging of[false,true])mTest('E Standard separate canonical alchemy hook remains paid staging'+staging,async t=>{
  const f=await eGame(t,{prepare:!staging}),I=core.ItemIdentifiers;give(f.a,I.BRONZE_DAGGER,'E-alchemy');const inventory=f.a.getInventory(),slot=inventory.getSlotForItemId(I.BRONZE_DAGGER),item=inventory.getItems()[slot],value=item.getDefinition().getHighAlchValue(),meta=bUtilityMetadata('High Level Alchemy'),seen=[],events=[],xp=[],real=PM.emitSpellDisabled.bind(PM),emit=PM.emitCustomEvent.bind(PM),sm=f.a.getSkillManager(),add=sm.addExperiences.bind(sm);assert.ok(value>0);
  t.mock.method(PM,'emitSpellDisabled',(...args)=>{const result=real(...args);if(args[0]===f.a)seen.push({args,result});return result;});t.mock.method(PM,'emitCustomEvent',(name,event)=>{if(event.player===f.a)events.push({name,event});return emit(name,event);});t.mock.method(sm,'addExperiences',(...args)=>{xp.push(args);return add(...args);});
  const nature=inventory.getAmount(I.NATURE_RUNE),fire=inventory.getAmount(I.FIRE_RUNE),coins=inventory.getAmount(I.COINS),count=inventory.getAmount(I.BRONZE_DAGGER);await f.a.connection.dispatch([{type:'widget_target',sourceWidgetId:meta.widgetId,sourceItemId:meta.itemId,sourceSlot:-1,targetWidgetId:core.CacheDefinitions.getComponentId('inventory:items'),targetSlot:slot,targetItemId:I.BRONZE_DAGGER}]);f.a.connection.processTurnPackets();tick(8);
  assert.ok(seen.some(x=>x.args[1]===core.MagicSpellbook.NORMAL&&x.args[3]===core.EffectSpells.HIGH_ALCHEMY&&x.result===null));assert.equal(inventory.getAmount(I.NATURE_RUNE),nature-1);assert.equal(inventory.getAmount(I.FIRE_RUNE),fire-5);assert.equal(inventory.getAmount(I.COINS),coins+value);assert.equal(inventory.getAmount(I.BRONZE_DAGGER),count-1);assert.ok(events.some(x=>x.name==='magic:item-spell-cast'&&x.event.spell===core.EffectSpells.HIGH_ALCHEMY));assert.ok(xp.some(x=>x[0]===core.Skill.MAGIC&&x[1]===65));assert.equal(f.trace.hits.length,0);
});

test('leaving a battle alive restores the player at Ferox like the free-for-all portal; the winner too', async () => {
  const a=actor(),b=actor();channel(a);channel(b);
  const glade=await negotiate(a,b,null,1,null,2);await join(a);await join(b);
  const skills=p=>p.getSkillManager();
  for(const p of [a,b]) {
    skills(p).setCurrentLevels(core.Skill.HITPOINTS,3).setCurrentLevels(core.Skill.PRAYER,0).setCurrentLevels(core.Skill.ATTACK,1);
    p.setPoisonDamage(6);p.setRunEnergy(10);
  }
  const restored=p=>{
    for(const skill of [core.Skill.HITPOINTS,core.Skill.PRAYER,core.Skill.ATTACK])
      assert.equal(skills(p).getCurrentLevel(skill),skills(p).getMaxLevel(skill),'the level is back to its base level');
    assert.equal(p.getPoisonDamage(),0);assert.equal(p.getRunEnergy(),100);
  };
  const side=glade.members.get(a),xy=side===0?[3422,4996]:[3421,5051];
  a.moveTo(glade.area.at([xy[0]+1,xy[1]+(side===0?2:-1),0]));tick(2);
  assert.equal(skills(a).getCurrentLevel(core.Skill.HITPOINTS),3,'nothing restores inside the battle');
  await layoutObjectInput(a,glade,side===0?'clanwars_exitportal_elfwood_s':'clanwars_exitportal_elfwood_n',xy,'Forfeit');
  lobby(a);restored(a);
  assert.equal(skills(b).getCurrentLevel(core.Skill.HITPOINTS),3,'the remaining fighter is not restored yet');
  core.World.processCycle=glade.starts;tick();
  assert.equal(glade.phase,'over','an empty side ends the battle');
  lobby(b);restored(b);
});

// H: three higher stat curses. Same canonical cInstall/mGame/native producers; no new loader.
const H_ROWS=[{"key":"VULNERABILITY","label":"Vulnerability","itemId":3317,"widgetId":14286911,"level":66,"runes":[{"id":566,"amount":1},{"id":555,"amount":5},{"id":557,"amount":5}],"baseXP":76,"splashXP":76},{"key":"ENFEEBLE","label":"Enfeeble","itemId":3320,"widgetId":14286914,"level":73,"runes":[{"id":566,"amount":1},{"id":555,"amount":8},{"id":557,"amount":8}],"baseXP":83,"splashXP":83},{"key":"STUN","label":"Stun","itemId":3324,"widgetId":14286918,"level":80,"runes":[{"id":566,"amount":1},{"id":555,"amount":12},{"id":557,"amount":12}],"baseXP":90,"splashXP":90}];
const H_CURSES={VULNERABILITY:"DEFENCE",ENFEEBLE:"STRENGTH",STUN:"ATTACK"};
for(const key of['WIND_STRIKE','CONFUSE'])mTest('H baseline paid Standard '+key+' positive control',async t=>{
  const f=await eGame(t);assert.equal(f.game.rules.magic,1);assert.equal(f.game.phase,'combat');assert.notEqual(f.game.fighters.get(f.a),f.game.fighters.get(f.b));
  const spell=core.CombatSpells[key],cost=mCost(f.a,spell),amounts=mAmounts(f.a,cost);assert.ok(cost.every(([id,n])=>f.a.getInventory().getAmount(id)>=n));
  const stats=cStats(f.b),hp=f.b.getHitpoints(),hit=await mFire(f,key);bStop(f);mPaid(f.a,cost,amounts);assert.equal(f.trace.commits.length,1);mLand(f,hit);
  if(key==='CONFUSE'){cAssertStats(f.b,stats,'ATTACK',5);assert.equal(f.b.getHitpoints(),hp);}else assert.ok(f.b.getHitpoints()<hp);
});
mTest('H native Standard Vulnerability commits pays queues and applies canonical higher drain',async t=>{
  const f=await eGame(t),row=H_ROWS[0];cMetadata(row);assert.equal(f.game.rules.magic,1);assert.equal(f.game.phase,'combat');assert.notEqual(f.game.fighters.get(f.a),f.game.fighters.get(f.b));
  const stats=cStats(f.b),hp=f.b.getHitpoints(),spell=core.CombatSpells.VULNERABILITY,cost=mCost(f.a,spell),amounts=mAmounts(f.a,cost);assert.equal(stats.DEFENCE,99);assert.ok(cost.every(([id,n])=>f.a.getInventory().getAmount(id)>=n));
  const hit=await mFire(f,'VULNERABILITY');bStop(f);mPaid(f.a,cost,amounts);assert.equal(hit.getTotalDamage(),0);assert.deepEqual(cStats(f.b),stats);mLand(f,hit);cAssertStats(f.b,stats,'DEFENCE',10);assert.equal(f.b.getHitpoints(),hp);
});
for(const row of H_ROWS)for(const accurate of[true,false])for(const freezing of[0,1])mTest(`H ${row.key} native accurate${accurate} Ignore${freezing}`,async t=>{
  const f=await eGame(t,{rules:{freezing}});cMetadata(row);const stats=cStats(f.b),hp=f.b.getHitpoints(),calls=[],splashes=[];
  magicRollControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.forceAccurate=accurate;e.forceMaxHit=true;}};
  // Supplied branch at the real PendingHit's damage event, never a natural probability claim.
  if(!accurate)magicDamageControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.accurate=false;e.damage.setDamage(0);splashes.push(e);}};
  const sm=f.a.getSkillManager(),add=sm.addExperience.bind(sm);t.mock.method(sm,'addExperience',(...args)=>{calls.push(args);return add(...args);});
  const trace=fTrace(t,f.b),cost=mCost(f.a,core.CombatSpells[row.key]),before=mAmounts(f.a,cost),hit=await mFire(f,row.key);bStop(f);mPaid(f.a,cost,before);
  if(!accurate){assert.equal(splashes.length,1);assert.equal(splashes[0].hit,hit);assert.equal(splashes[0].damage,hit.getHits()[0]);assert.equal(splashes[0].combatType,core.CombatType.MAGIC);assert.equal(splashes[0].accurate,false);assert.equal(splashes[0].damage.getDamage(),0);}
  assert.equal(hit.isAccurate(),accurate);const damage=hit.getTotalDamage();assert.equal(damage,0);
  assert.deepEqual(cStats(f.b),stats,'queued effects are not applied early');mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-damage);
  cAssertStats(f.b,stats,accurate?H_CURSES[row.key]:null,10);
  assert.ok(calls.some(x=>x[0]===core.Skill.MAGIC&&x[1]===(accurate?row.baseXP:row.splashXP)),'canonical base XP producer is forwarded with independent pinned amount');
  fNoNewEffects(trace);
  assert.equal(trace.attempts.length,0);
});
for(const key of Object.keys(H_CURSES))mTest('H '+key+' native lowered partial full recovery and impact race remain canonical',async t=>{
  const f=await eGame(t),skill=core.Skill[H_CURSES[key]],sm=f.b.getSkillManager(),first=await mFire(f,key);bStop(f);mLand(f,first);assert.equal(sm.getCurrentLevel(skill),90);
  tick(10);const paid=mInventory(f.a),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC),n=f.trace.commits.length,lines=messagesOf(f.a);
  await mSpell(f.a,f.b,key);tick(8);bStop(f);assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,n);assert.equal(f.a.getSkillManager().getExperience(core.Skill.MAGIC),xp);assert.ok(lines.some(x=>/weakened/.test(x)));
  sm.setCurrentLevel(skill,98,false);await mSpell(f.a,f.b,key);tick(8);bStop(f);assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,n);
  sm.setCurrentLevel(skill,99,false);tick(10);const second=await mFire(f,key);bStop(f);assert.notEqual(second,first);sm.setCurrentLevel(skill,98,false);mLand(f,second);assert.equal(sm.getCurrentLevel(skill),98,'intervening drain prevents stacking at impact');
  const other=key==='STUN'?'ENFEEBLE':'STUN',otherSkill=core.Skill[H_CURSES[other]];sm.setCurrentLevel(otherSkill,99,false);tick(10);const independent=await mFire(f,other);bStop(f);mLand(f,independent);assert.equal(sm.getCurrentLevel(otherSkill),90);
});
for(const key of Object.keys(H_CURSES))for(const tome of[false,true])mTest(`H ${key} committed effect floor99 ${tome?'water final-charge swap':'base'} and independent resources`,async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers;let book;
  if(tome){await mEquip(f.a,I.TOME_OF_WATER_EMPTY_,core.Equipment.SHIELD_SLOT);book=mTome(f.a,'water',1);f.a.getInventory().deleteNumber(I.WATER_RUNE,f.a.getInventory().getAmount(I.WATER_RUNE));}
  const cost=mCost(f.a,core.CombatSpells[key]),amounts=mAmounts(f.a,cost),stats=cStats(f.b),hp=f.b.getHitpoints(),hit=await mFire(f,key);bStop(f);mPaid(f.a,cost,amounts);assert.equal(hit.isAccurate(),true);assert.equal(hit.getTotalDamage(),0);assert.deepEqual(cStats(f.b),stats);
  const context=hit.getSpellContext();if(tome){assert.equal(book.Common.read(book.item).charges,0);assert.equal(context.data.get(require('../plugins/items/elementaltomes/Combat.ElementalTomes').CAST_DATA_KEY).element,'water');f.a.getEquipment().getItems()[core.Equipment.SHIELD_SLOT]=new core.Item(-1);}
  mLand(f,hit);assert.equal(hit.getSpellContext(),context);cAssertStats(f.b,stats,H_CURSES[key],tome?15:10);assert.equal(f.b.getHitpoints(),hp);if(tome)assert.equal(book.Common.read(book.item).charges,0);
});
for(const key of Object.keys(H_CURSES))for(const element of['water','earth'])mTest('H '+key+' unforced real forwarded '+element+' tome attack roll uses committed final charge',async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I['TOME_OF_'+element.toUpperCase()+'_EMPTY_'],core.Equipment.SHIELD_SLOT);const book=mTome(f.a,element,1),rolls=[],emit=PM.emitCustomEvent.bind(PM);magicRollControl=null;
  t.mock.method(PM,'emitCustomEvent',(name,event)=>{const own=name==='combat:magic-attack-roll-modify'&&event.attacker===f.a&&event.target===f.b,before=own?event.attackRoll:null;const result=emit(name,event);if(own)rolls.push({before,after:event.attackRoll,context:event.context});return result;});
  const hit=await mFire(f,key);bStop(f);assert.ok(rolls.length>0);for(const roll of rolls){assert.equal(roll.after,element==='water'?Math.floor(roll.before*1.2):roll.before);assert.equal(roll.context,hit.getSpellContext());}assert.equal(book.Common.read(book.item).charges,element==='water'?0:1);mLand(f,hit);
  // This separate real-roll observation does not assert a random effect outcome.
});
for(const key of Object.keys(H_CURSES))mTest('H '+key+' new healthy opposing target is independent of a drained first target',async t=>{
  let other;const f=await eGame(t,{beforeEntry:async(a,b)=>{other=actor(true);ruleStats(other,99);assert.equal(FC.join(other,b.getUsername(),false),true);await join(other);}});
  const first=await mFire(f,key);bStop(f);mLand(f,first);const before=cStats(f.b);assert.equal(before[H_CURSES[key]],90);
  mPosition(f.game,f.a,other);tick(10);const next={...f,b:other,trace:mTrace(t,f.a,other)},hit=await mFire(next,key);bStop(next);mLand(next,hit);
  assert.equal(other.getSkillManager().getCurrentLevel(core.Skill[H_CURSES[key]]),90);assert.deepEqual(cStats(f.b),before);
});
for(const key of Object.keys(H_CURSES))mTest('H '+key+' applied stat drain is not reversed by departure queue disposal',async t=>{
  const f=await eGame(t),hit=await mFire(f,key);bStop(f);mLand(f,hit);const stats=cStats(f.b);assert.equal(stats[H_CURSES[key]],90);
  f.game.area.leave(f.a,false);assert.deepEqual(cStats(f.b),stats,'queue helper does not roll back an already-applied stat effect');
});
for(const row of H_ROWS)mTest('H '+row.key+' native hand effect overrides elemental autocast then real paid elemental resumes',async t=>{
  const f=await eGame(t);cMetadata(row);await cAutocast(f.a);const spell=core.CombatSpells[row.key],cost=mCost(f.a,spell),before=mAmounts(f.a,cost),mind=f.a.getInventory().getAmount(core.ItemIdentifiers.MIND_RUNE),hit=await mFire(f,row.key);mPaid(f.a,cost,before);
  assert.equal(core.Autocasting.isActive(f.a),true);mLand(f,hit);for(let i=0;i<30&&!f.trace.commits.some(x=>x.spell===core.CombatSpells.WIND_STRIKE);i++)tick();bStop(f);
  const resumed=f.trace.commits.find(x=>x.spell===core.CombatSpells.WIND_STRIKE);assert.ok(resumed,'actual engine resumes permitted elemental autocast after hand effect');assert.ok(f.trace.hits.some(h=>h.getSpell()===core.CombatSpells.WIND_STRIKE&&h.getSpellContext()===resumed.context));
  assert.equal(f.trace.commits.filter(x=>x.spell===spell).length,1,'effect is a manual override, not a new autocast family');assert.equal(f.a.getInventory().getAmount(core.ItemIdentifiers.MIND_RUNE),mind-f.trace.commits.filter(x=>x.spell===core.CombatSpells.WIND_STRIKE).length);
});
for(const spell of['VULNERABILITY'])for(const boundary of['victim-leave','caster-leave','victim-logout','caster-logout','channel','finish','caster-death'])mTest('H paid native '+spell+' discarded at '+boundary+' without refund or new hold',async t=>{
  const f=await eGame(t),cost=mCost(f.a,core.CombatSpells[spell]),before=mAmounts(f.a,cost),hit=await mFire(f,spell);bStop(f);mPaid(f.a,cost,before);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);const paid=mInventory(f.a),hp=f.b.getHitpoints(),stats=cStats(f.b);
  if(boundary==='victim-leave')f.game.area.leave(f.b,false);else if(boundary==='caster-leave')f.game.area.leave(f.a,false);
  else if(boundary==='victim-logout')PM.emitPlayerLogout({player:f.b,username:f.b.getUsername()});else if(boundary==='caster-logout')PM.emitPlayerLogout({player:f.a,username:f.a.getUsername()});
  else if(boundary==='channel')FC.leave(f.a,true);else if(boundary==='finish')f.game.finish(null);
  else{f.a.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(f.a.getHitpoints(),core.HitMask.RED).setSource(f.b)]);tick();}
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);for(const p of[f.a,f.b])p.setNeedsPlacement(false);tick(35);
  assert.deepEqual(mInventory(f.a),paid);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getTimers().has(core.TimerKey.FREEZE),false);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(cStats(f.b),stats);
});
mTest('H actual paid mapped Forfeit cancels the exact native pending hit',async t=>{
  const f=await eGame(t),hit=await mFire(f,'VULNERABILITY');bStop(f);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);const paid=mInventory(f.a),hp=f.b.getHitpoints(),stats=cStats(f.b);
  magicTurns=false;await nmForfeit(f.a,f.game);magicTurns=true;for(const p of[f.a,f.b])p.setNeedsPlacement(false);tick(12);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(cStats(f.b),stats);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getTimers().has(core.TimerKey.FREEZE),false);assert.deepEqual(mInventory(f.a),paid);
});
for(const row of H_ROWS)for(const refusal of['low-level','wrong-book','no-soul','sack-only','unsupported-loadout','staging','same-team','outsider','classic','binding','disabled'])mTest(`H ${row.key} ${refusal} refuses before payment`,async t=>{
  const magic={classic:2,binding:3,disabled:4}[refusal]??1,f=await eGame(t,{rules:{magic},prepare:refusal!=='staging'}),I=core.ItemIdentifiers;cMetadata(row);
  if(refusal==='low-level')f.a.getSkillManager().setCurrentLevel(core.Skill.MAGIC,row.level-1,false);
  if(refusal==='wrong-book')f.a.setSpellbook(core.MagicSpellbook.ANCIENT);
  if(refusal==='no-soul')f.a.getInventory().deleteNumber(I.SOUL_RUNE,f.a.getInventory().getAmount(I.SOUL_RUNE));
  if(refusal==='sack-only'){f.a.getInventory().resetItems();f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));}
  if(refusal==='unsupported-loadout')await mEquip(f.a,I.ANCIENT_STAFF);
  if(refusal==='same-team')f.game.fighters.set(f.b,f.game.fighters.get(f.a));
  if(refusal==='outsider'){f.game.area.leave(f.b,false);assert.equal(f.game.phase,'combat');assert.equal(C.matches.get(f.a),f.game);assert.equal(f.game.fighters.has(f.a),true);assert.equal(f.a.getArea(),f.game.area);assert.equal(C.matches.has(f.b),false);assert.equal(f.game.fighters.has(f.b),false);assert.notEqual(f.b.getArea(),f.game.area);assert.equal(f.game.area.canAttack(f.a,f.b,CombatFactory.MAGIC_COMBAT),false,'the actual battle area refuses the departed outsider');}
  const before=resources(f.a),stats=cStats(f.b),hp=f.b.getHitpoints();await mSpell(f.a,f.b,row.key);tick(8);bStop(f);assert.deepEqual(resources(f.a),before);assert.deepEqual(cStats(f.b),stats);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
});
for(const row of H_ROWS)mTest('H '+row.key+' pouch staff and sacks remain independent',async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');cMetadata(row);await mEquip(f.a,I.STAFF_OF_WATER);give(f.a,I.RUNE_POUCH,'H-pouch');
  Pouch.setSlots(f.a,[{id:I.SOUL_RUNE,amount:10},null,null,null]);f.a.getInventory().deleteNumber(I.SOUL_RUNE,f.a.getInventory().getAmount(I.SOUL_RUNE));f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));
  const water=f.a.getInventory().getAmount(I.WATER_RUNE),earth=f.a.getInventory().getAmount(I.EARTH_RUNE),earthCost=core.CombatSpells[row.key].itemsRequired(f.a).find(x=>x.getId()===I.EARTH_RUNE).getAmount(),hit=await mFire(f,row.key);bStop(f);
  assert.equal(Pouch.amountOf(f.a,I.SOUL_RUNE),9);assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),2);assert.equal(f.a.getInventory().getAmount(I.WATER_RUNE),water);assert.equal(f.a.getInventory().getAmount(I.EARTH_RUNE),earth-earthCost);mLand(f,hit);
});
for(const row of H_ROWS)for(const element of['water','earth'])mTest(`H ${row.key} ${element} empty tome preserves ordinary ten percent`,async t=>{
  const f=await eGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I['TOME_OF_'+element.toUpperCase()+'_EMPTY_'],core.Equipment.SHIELD_SLOT);const book=mTome(f.a,element,0),stats=cStats(f.b),cost=mCost(f.a,core.CombatSpells[row.key]),amounts=mAmounts(f.a,cost),hit=await mFire(f,row.key);bStop(f);mPaid(f.a,cost,amounts);mLand(f,hit);cAssertStats(f.b,stats,H_CURSES[row.key],10);assert.equal(book.Common.read(book.item).charges,0);
});
mTest('H preview shared cooldown and full paid native preservation',async t=>{
  const f=await eGame(t),spell=core.CombatSpells.VULNERABILITY,before=mInventory(f.a);await mSpell(f.a,f.b,'VULNERABILITY');assert.equal(spell.canCast(f.a,false),true);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);
  const hit=await mFire(f,'VULNERABILITY');bStop(f);const paid=mInventory(f.a);await mSpell(f.a,f.b,'ENFEEBLE');assert.equal(f.a.getCombat().getCastSpell(),core.CombatSpells.ENFEEBLE);assert.equal(core.CombatSpells.ENFEEBLE.canCast(f.a,true),false);assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,1);bStop(f);mLand(f,hit);
});
mTest('H safe jail rejoin restores canonical stats before a fresh higher curse',async t=>{
  const f=await eGame(t);f.b.setHitpoints(1);const hit=await mFire(f,'FIRE_BLAST');bStop(f);mLand(f,hit);for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();assert.equal(f.game.jailed.has(f.b),true);await jailExit(f.b,f.game);assert.equal(f.game.fighters.has(f.b),true);tick(40);mPosition(f.game,f.a,f.b);const stats=cStats(f.b),fresh=await mFire(f,'ENFEEBLE');bStop(f);mLand(f,fresh);cAssertStats(f.b,stats,'STRENGTH',10);
});
// Capture only the actual F2P spell gate; other F2P world hooks are not installed in this members fixture.
for(const row of H_ROWS)mTest('H '+row.key+' canonical captured F2P member gate refuses native payment',async t=>{
  const f=await eGame(t),spell=core.CombatSpells[row.key];assert.equal(spell.isMembers(),true);cMetadata(row);
  const gates=[],names=['onCanUseItem','onCanEquip','onCanGainExperience','onCanSpawnNpc','onCanStockItem','onCustomEvent','onPrayerDisabled','onCanTeleport','onObjectInteraction','onPlayerProcess'];
  const api={core,onSpellDisabled:handler=>gates.push(handler)};for(const name of names)api[name]=()=>{};
  const mode=t.mock.method(core.WorldDefinition,'isMembersWorld',()=>false);try{require('../plugins/modes/FreeToPlay.plugin').register(api);}finally{mode.mock.restore();}assert.equal(gates.length,1);
  const real=PM.emitSpellDisabled.bind(PM),seen=[];t.mock.method(PM,'emitSpellDisabled',(player,book,id,cast)=>{
    if(player===f.a){const event={player,spellbook:book,spellId:id,spell:cast,disabled:false};gates[0](event);seen.push(event);if(event.disabled)return true;}
    return real(player,book,id,cast);
  });
  const control=await mFire(f,'CONFUSE');bStop(f);mLand(f,control);assert.equal(f.trace.commits.length,1,'actual lower free spell remains paid under same captured gate');
  f.b.getSkillManager().setCurrentLevel(core.Skill.ATTACK,99,false);assert.deepEqual(cStats(f.b),{ATTACK:99,STRENGTH:99,DEFENCE:99},'controlled full recovery prevents lower Confuse masking Stun membership refusal');
  const before=resources(f.a),stats=cStats(f.b),n=f.trace.commits.length,lines=messagesOf(f.a);await mSpell(f.a,f.b,row.key);tick(8);bStop(f);
  assert.ok(seen.some(e=>e.spell===spell&&e.disabled),'actual captured canonical gate refuses higher member object');assert.ok(lines.includes("You need to be on a members' world to cast this spell."));assert.deepEqual(resources(f.a),before);assert.deepEqual(cStats(f.b),stats);assert.equal(f.trace.commits.length,n);
});

// G: finite manual god family. Literal cache242 identities; canonical producers remain unchanged.
const G_ROWS=[
  {key:'SARADOMIN_STRIKE',label:'Saradomin Strike',itemId:3311,widgetId:14286902,staff:2415,cape:2412,skill:'PRAYER',counter:'mage-arena:charge:saradomin',runes:[[556,4],[565,2],[554,2]],hint:2415},
  {key:'CLAWS_OF_GUTHIX',label:'Claws of Guthix',itemId:3309,widgetId:14286903,staff:2416,cape:2413,skill:'DEFENCE',counter:'mage-arena:charge:guthix',runes:[[556,4],[565,2],[554,1]],hint:8843},
  {key:'FLAMES_OF_ZAMORAK',label:'Flames of Zamorak',itemId:3310,widgetId:14286904,staff:2417,cape:2414,skill:'MAGIC',counter:'mage-arena:charge:zamorak',runes:[[556,1],[565,2],[554,4]],hint:2417},
];
let gInstalled=false;
function gInstall(){
  if(gInstalled)return;
  cInstall();assert.equal(actors.length,0,'actual god hooks register once before G actors');
  const api=PM.createApi('ClanWarsGCanonicalGods');
  require('../plugins/minigames/magearena/Spells.MageArena')(api);
  require('../plugins/minigames/magearena/Statues.MageArena')(api);
  require('../plugins/combat/ChargeFade.plugin').register(api);
  gInstalled=true;
}
function gUnlock(p){
  for(const row of G_ROWS)p.setAttribute(row.counter,100);
  p.setAttribute('mage-arena:cape-received',true);
}
function gStats(p){return Object.fromEntries(['ATTACK','STRENGTH','DEFENCE','MAGIC','PRAYER'].map(k=>[k,p.getSkillManager().getCurrentLevel(core.Skill[k])]));}
function gEffect(before,row,damaging=true){
  const next={...before};
  if(damaging)next[row.skill]=Math.max(0,before[row.skill]-(row.skill==='PRAYER'?1:1+Math.floor(before[row.skill]*0.05)));
  return next;
}
function gMetadata(row){
  const spell=core.CombatSpells[row.key],meta=core.CacheDefinitions.getSpellByName(row.label),params=core.CacheDefinitions.getItem(row.itemId).params;
  assert.deepEqual(meta,{itemId:row.itemId,widgetId:row.widgetId});
  assert.equal(core.CacheDefinitions.getSpellName(meta.widgetId,meta.itemId),row.label);
  assert.equal(spell.getSpellbook(),core.MagicSpellbook.NORMAL);
  assert.equal(spell.isMembers(),true);assert.equal(spell.levelRequired(),60);
  assert.equal(spell.baseExperience(),35);assert.equal(spell.splashExperience(),35);assert.equal(spell.maximumHit(),20);
  // The legacy hint helper includes the equipment UI slot and omits extra Fire606.
  // Assert those actual hints separately, never call the staff icon a consumed rune.
  const hints=core.CacheDefinitions.getSpellRequirements(row.label),fire=row.runes.find(x=>x[0]===554)[1],air=row.runes.find(x=>x[0]===556)[1];
  assert.equal(hints.level,60);assert.deepEqual(hints.runes,[{id:row.hint,amount:1},{id:565,amount:2},{id:556,amount:air}]);
  assert.equal(params.get(365),row.hint);assert.equal(params.get(606),554);assert.equal(params.get(607),fire);
  assert.deepEqual(spell.itemsRequired(null).map(x=>[x.getId(),x.getAmount()]).sort((a,b)=>a[0]-b[0]),row.runes.slice().sort((a,b)=>a[0]-b[0]));
  return meta;
}
async function gGame(t,row,options={}){
  gInstall();const f=await eGame(t,options);gUnlock(f.a);await mEquip(f.a,row.staff);
  f.b.setHitpoints(99);assert.equal(f.b.getHitpoints(),99);return f;
}
async function gFire(f,row,inventoryAudit=true){
  const cost=mCost(f.a,core.CombatSpells[row.key]),before=mAmounts(f.a,cost),hit=await mFire(f,row.key);
  bStop(f);if(inventoryAudit)mPaid(f.a,cost,before);return hit;
}
async function gChargeButton(a,meta){
  const {ClientPacketId}=require('../dist/net/protocol/NativeClientPackets'),frame=Buffer.alloc(9);
  frame[0]=ClientPacketId.IF_BUTTON1;frame.writeInt32BE(meta.widgetId,1);frame.writeUInt16BE(65535,5);frame.writeUInt16BE(meta.itemId,7);
  await dispatchFrameNow(a,frame);
}
async function gCharge(t,f){
  const a=f.a,meta=core.CacheDefinitions.getSpellByName('Charge'),I=core.ItemIdentifiers;
  assert.deepEqual(meta,{itemId:3323,widgetId:14286919});
  const runes=[I.AIR_RUNE,I.FIRE_RUNE,I.BLOOD_RUNE],before=runes.map(id=>a.getInventory().getAmount(id)),lines=messagesOf(a),events=[],xp=[];
  const emit=PM.emitCustomEvent.bind(PM),add=a.getSkillManager().addExperience.bind(a.getSkillManager());
  t.mock.method(PM,'emitCustomEvent',(name,e)=>{if(name==='magic:charge-cast'&&e.player===a)events.push({at:C.now(),until:e.until});return emit(name,e);});
  t.mock.method(a.getSkillManager(),'addExperience',(...args)=>{xp.push(args);return add(...args);});
  await gChargeButton(a,meta);
  assert.equal(events.length,1,'native self-cast reaches the actual Charge producer');
  assert.equal(events[0].until,events[0].at+700);
  assert.equal(a.getAttribute(core.CombatSpells.CHARGE_UNTIL),events[0].until);
  assert.ok(lines.includes('<col=ef1020>You feel charged with magic power.</col>'));
  for(let n=0;n<runes.length;n++)assert.equal(a.getInventory().getAmount(runes[n]),before[n]-3);
  assert.ok(xp.some(x=>x[0]===core.Skill.MAGIC&&x[1]===180),'actual canonical base XP forwarding');
  return events[0];
}
async function gNpcSpell(a,npc,row){
  const meta=gMetadata(row),{ClientPacketId}=require('../dist/net/protocol/NativeClientPackets'),frame=Buffer.alloc(12);
  frame[0]=ClientPacketId.OPNPC_T;frame.writeUInt16BE(npc.getIndex(),1);frame.writeUInt32LE(meta.widgetId,3);
  frame.writeUInt16BE(65535,7);frame[9]=(meta.itemId+128)&255;frame[10]=meta.itemId>>>8;frame[11]=128;
  const decoded=decodeClientPackets(frame);assert.equal(decoded.length,1);assert.equal(decoded[0].type,'spell_on_npc');
  assert.equal(decoded[0].targetIndex,npc.getIndex());assert.equal(decoded[0].spellWidget,meta.widgetId);assert.equal(decoded[0].spellItemId,meta.itemId);
  await a.connection.dispatch(decoded);a.connection.processTurnPackets();
}
for(const row of G_ROWS)mTest('G baseline outside canonical '+row.key+' native paid positive',async t=>{
  gInstall();const a=actor(true);ruleStats(a,99);a.setSpellbook(core.MagicSpellbook.NORMAL);mFund(a);gUnlock(a);await mEquip(a,row.staff);
  const at=new core.Location(3222,3218,0);core.RegionManager.loadMapFiles(at.getX(),at.getY());a.moveTo(at);a.setNeedsPlacement(false);AreaManager.process(a);
  const b=C.api.spawnNpc({id:core.NpcIdentifiers.GUARD,x:3223,y:3218,z:0,wanderRadius:0});fixtureNpcs.add(b);npcQueues();
  assert.equal(b.isRegistered(),true);assert.equal(b.getId(),core.NpcIdentifiers.GUARD);assert.ok(b.getHitpoints()>0);
  assert.equal(C.matches.has(a),false);assert.equal(a.getPrivateArea(),null);assert.equal(b.getPrivateArea(),null);
  magicTurns=true;ghastTurns=true;const f={a,b,trace:mTrace(t,a,b)},cost=mCost(a,core.CombatSpells[row.key]),before=mAmounts(a,cost),hp=b.getHitpoints();
  tick();await gNpcSpell(a,b,row);assert.equal(a.getCombat().getCastSpell(),core.CombatSpells[row.key]);assert.equal(a.getCombat().getTarget(),b);
  for(let n=0;n<30&&!f.trace.commits.length;n++)tick();
  assert.equal(f.trace.commits.length,1,'actual canonical god paid commit outside Clan Wars');
  assert.equal(f.trace.hits.length,1);const hit=f.trace.hits[0];bStop(f);mPaid(a,cost,before);
  assert.equal(hit.getSpell(),core.CombatSpells[row.key]);assert.equal(hit.getSpellContext(),f.trace.commits[0].context);
  mLand(f,hit);assert.ok(hit.getTotalDamage()>0);assert.equal(b.getHitpoints(),Math.max(0,hp-hit.getTotalDamage()));
});
for(const key of ['WIND_STRIKE','CONFUSE'])mTest('G baseline paid Standard '+key+' positive control',async t=>{
  gInstall();const f=await eGame(t),cost=mCost(f.a,core.CombatSpells[key]),before=mAmounts(f.a,cost),stats=cStats(f.b),hp=f.b.getHitpoints(),hit=await mFire(f,key);
  bStop(f);mPaid(f.a,cost,before);mLand(f,hit);
  if(key==='CONFUSE'){assert.equal(f.b.getHitpoints(),hp);cAssertStats(f.b,stats,'ATTACK',5);}else assert.ok(f.b.getHitpoints()<hp);
});
mTest('G native Standard Saradomin commits pays queues and applies canonical Prayer drain',async t=>{
  const row=G_ROWS[0],f=await gGame(t,row);gMetadata(row);
  assert.equal(f.game.rules.magic,1);assert.equal(f.game.phase,'combat');assert.notEqual(f.game.fighters.get(f.a),f.game.fighters.get(f.b));
  assert.equal(f.a.getAttribute(row.counter),100);assert.equal(f.a.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(),row.staff);
  const stats=gStats(f.b),hp=f.b.getHitpoints(),cost=mCost(f.a,core.CombatSpells[row.key]);
  assert.ok(cost.every(([id,n])=>f.a.getInventory().getAmount(id)>=n));assert.equal(stats.PRAYER,99);
  const before=mAmounts(f.a,cost),hit=await mFire(f,row.key);bStop(f);mPaid(f.a,cost,before);
  assert.deepEqual(gStats(f.b),stats,'no early queued drain');mLand(f,hit);
  assert.ok(hit.getTotalDamage()>0);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());assert.deepEqual(gStats(f.b),gEffect(stats,row));
});
for(const row of G_ROWS)for(const branch of ['hit','splash','zero'])for(const freezing of [0,1])mTest('G '+row.key+' '+branch+' Ignore'+freezing+' native impact and XP',async t=>{
  const f=await gGame(t,row,{rules:{freezing}});gMetadata(row);
  const controlledDamage=[];
  magicRollControl=e=>{if(e.attacker===f.a&&e.target===f.b){e.forceAccurate=true;e.forceMaxHit=true;}};
  if(branch!=='hit')magicDamageControl=e=>{if(e.attacker===f.a&&e.target===f.b){
    if(branch==='splash')e.accurate=false;
    e.damage.setDamage(0);controlledDamage.push(e);
  }};
  const stats=gStats(f.b),hp=f.b.getHitpoints(),calls=[],sm=f.a.getSkillManager(),add=sm.addExperience.bind(sm),trace=fTrace(t,f.b);
  t.mock.method(sm,'addExperience',(...args)=>{calls.push(args);return add(...args);});
  const hit=await gFire(f,row);assert.equal(hit.isAccurate(),branch!=='splash');assert.equal(hit.getTotalDamage(),branch==='hit'?20:0);
  if(branch!=='hit'){
    assert.equal(controlledDamage.length,1);assert.equal(controlledDamage[0].hit,hit);
    assert.equal(controlledDamage[0].damage,hit.getHits()[0]);assert.equal(controlledDamage[0].combatType,core.CombatType.MAGIC);
    assert.equal(controlledDamage[0].accurate,branch!=='splash');assert.equal(controlledDamage[0].damage.getDamage(),0);
  }
  assert.deepEqual(gStats(f.b),stats);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());
  assert.deepEqual(gStats(f.b),gEffect(stats,row,branch==='hit'));assert.ok(calls.some(x=>x[0]===core.Skill.MAGIC&&x[1]===35));
  fNoNewEffects(trace);assert.equal(trace.attempts.length,0);
});
for(const row of G_ROWS)mTest('G '+row.key+' paid repeat damage and nonstacking recovery stay distinct',async t=>{
  const f=await gGame(t,row),skill=core.Skill[row.skill],sm=f.b.getSkillManager(),start=gStats(f.b),first=await gFire(f,row);mLand(f,first);
  assert.deepEqual(gStats(f.b),gEffect(start,row));tick(10);
  const paid=mInventory(f.a),hp=f.b.getHitpoints(),second=await gFire(f,row);assert.notDeepEqual(mInventory(f.a),paid);mLand(f,second);
  assert.equal(f.b.getHitpoints(),hp-second.getTotalDamage());
  if(row.skill==='PRAYER')assert.equal(sm.getCurrentLevel(skill),97);else assert.equal(sm.getCurrentLevel(skill),94,'damage repeats without another lowered-stat drain');
  if(row.skill!=='PRAYER'){sm.setCurrentLevel(skill,98,false);tick(10);const third=await gFire(f,row);mLand(f,third);assert.equal(sm.getCurrentLevel(skill),98,'partial recovery still does not restack');}
  sm.setCurrentLevel(skill,99,false);tick(10);const fresh=await gFire(f,row);mLand(f,fresh);assert.equal(sm.getCurrentLevel(skill),row.skill==='PRAYER'?98:94);
});
for(const row of G_ROWS)mTest('G '+row.key+' impact race and independent new target remain canonical',async t=>{
  const f=await gGame(t,row),sm=f.b.getSkillManager(),skill=core.Skill[row.skill],hit=await gFire(f,row);
  sm.setCurrentLevel(skill,row.skill==='PRAYER'?2:94,false);mLand(f,hit);assert.equal(sm.getCurrentLevel(skill),row.skill==='PRAYER'?1:94);
  const next=await bowAlly(f.b,f.game);next.setHitpoints(99);mPosition(f.game,f.a,next);tick(10);const old=f.b;f.b=next;f.trace=mTrace(t,f.a,next);
  const stats=gStats(next),fresh=await gFire(f,row);mLand(f,fresh);assert.deepEqual(gStats(next),gEffect(stats,row));
  assert.equal(old.getSkillManager().getCurrentLevel(skill),row.skill==='PRAYER'?1:94);
});
for(const row of G_ROWS)mTest('G '+row.key+' native Charge matching cape twenty thirty and committed hit',async t=>{
  const f=await gGame(t,row),base=await gFire(f,row);mLand(f,base);assert.equal(base.getTotalDamage(),20);tick(10);
  await mEquip(f.a,row.cape,core.Equipment.CAPE_SLOT);const charge=await gCharge(t,f);assert.ok(charge.until>C.now());
  const boosted=await gFire(f,row);assert.equal(boosted.getTotalDamage(),30);
  // Controlled post-commit removal preserves an already rolled pending hit, not a retail swap-latency claim.
  f.a.getEquipment().getItems()[core.Equipment.CAPE_SLOT]=new core.Item(-1);
  mLand(f,boosted);assert.equal(boosted.getTotalDamage(),30);tick(10);
  const ordinary=await gFire(f,row);mLand(f,ordinary);assert.equal(ordinary.getTotalDamage(),20,'active Charge without matching cape is ordinary');
});
for(const row of G_ROWS)mTest('G '+row.key+' native Charge wrong cape expiry and cooldown retain paid boundaries',async t=>{
  const f=await gGame(t,row),wrong=G_ROWS.find(x=>x.cape!==row.cape);await mEquip(f.a,wrong.cape,core.Equipment.CAPE_SLOT);
  const charge=await gCharge(t,f),before=mInventory(f.a),meta=core.CacheDefinitions.getSpellByName('Charge'),lines=messagesOf(f.a);
  await gChargeButton(f.a,meta);assert.deepEqual(mInventory(f.a),before);assert.equal(f.a.getAttribute(core.CombatSpells.CHARGE_UNTIL),charge.until);
  const unboosted=await gFire(f,row);mLand(f,unboosted);assert.equal(unboosted.getTotalDamage(),20);
  await mEquip(f.a,row.cape,core.Equipment.CAPE_SLOT);
  // ChargeFade is a real countdown task: advance every intervening native turn.
  assert.ok(C.now()<charge.until);tick(charge.until-C.now());assert.equal(C.now(),charge.until);
  assert.ok(lines.includes('<col=ef1020>Your magical charge fades away.</col>'));
  const expired=await gFire(f,row);mLand(f,expired);assert.equal(expired.getTotalDamage(),20);
});
for(const row of G_ROWS)for(const tome of ['fire','water','earth'])mTest('G '+row.key+' '+tome+' tome supplies without god boost or charge',async t=>{
  const f=await gGame(t,row),I=core.ItemIdentifiers;await mEquip(f.a,I['TOME_OF_'+tome.toUpperCase()+'_EMPTY_'],core.Equipment.SHIELD_SLOT);const book=mTome(f.a,tome,1);
  if(tome==='fire')f.a.getInventory().deleteNumber(I.FIRE_RUNE,f.a.getInventory().getAmount(I.FIRE_RUNE));
  const before=mInventory(f.a),stats=gStats(f.b),hit=await gFire(f,row);assert.equal(hit.getTotalDamage(),20);assert.equal(book.Common.read(book.item).charges,1);
  if(tome==='fire')assert.equal(f.a.getInventory().getAmount(I.FIRE_RUNE),0);
  assert.notDeepEqual(mInventory(f.a),before);mLand(f,hit);assert.deepEqual(gStats(f.b),gEffect(stats,row));assert.equal(book.Common.read(book.item).charges,1);
});
for(const row of G_ROWS)mTest('G '+row.key+' actual pouch Blood and entangle sacks are independent',async t=>{
  const f=await gGame(t,row),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');give(f.a,I.RUNE_POUCH,'G-pouch');
  Pouch.setSlots(f.a,[{id:I.BLOOD_RUNE,amount:10},null,null,null]);f.a.getInventory().deleteNumber(I.BLOOD_RUNE,f.a.getInventory().getAmount(I.BLOOD_RUNE));f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));
  const air=f.a.getInventory().getAmount(I.AIR_RUNE),fire=f.a.getInventory().getAmount(I.FIRE_RUNE),hit=await gFire(f,row,false);assert.equal(Pouch.amountOf(f.a,I.BLOOD_RUNE),8);assert.equal(f.a.getInventory().getAmount(I.BLOOD_RUNE),0);assert.equal(f.a.getInventory().getAmount(I.AIR_RUNE),air-row.runes.find(x=>x[0]===556)[1]);assert.equal(f.a.getInventory().getAmount(I.FIRE_RUNE),fire-row.runes.find(x=>x[0]===554)[1]);assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),2);mLand(f,hit);
});
for(const row of G_ROWS)for(const refusal of ['locked','low-level','wrong-book','no-blood','sack-only','wrong-god-staff','unarmed','upgraded-staff','shield','staging','same-team','outsider','classic','binding','disabled'])mTest('G '+row.key+' '+refusal+' refuses before native payment',async t=>{
  const magic={classic:2,binding:3,disabled:4}[refusal]??1,f=await gGame(t,row,{rules:{magic},prepare:refusal!=='staging'}),I=core.ItemIdentifiers;
  if(refusal==='locked')f.a.setAttribute(row.counter,99);
  if(refusal==='low-level')f.a.getSkillManager().setCurrentLevel(core.Skill.MAGIC,59,false);
  if(refusal==='wrong-book')f.a.setSpellbook(core.MagicSpellbook.ANCIENT);
  if(refusal==='no-blood')f.a.getInventory().deleteNumber(I.BLOOD_RUNE,f.a.getInventory().getAmount(I.BLOOD_RUNE));
  if(refusal==='sack-only'){f.a.getInventory().resetItems();f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));}
  if(refusal==='wrong-god-staff')await mEquip(f.a,G_ROWS.find(x=>x.staff!==row.staff).staff);
  if(refusal==='unarmed')f.a.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]=new core.Item(-1);
  if(refusal==='upgraded-staff')await mEquip(f.a,I.STAFF_OF_THE_DEAD);
  if(refusal==='shield')await mEquip(f.a,I.BRONZE_KITESHIELD,core.Equipment.SHIELD_SLOT);
  if(refusal==='same-team')f.game.fighters.set(f.b,f.game.fighters.get(f.a));
  if(refusal==='outsider'){f.game.area.leave(f.b,false);assert.equal(C.matches.has(f.b),false);assert.equal(f.game.fighters.has(f.a),true);assert.equal(f.a.getArea(),f.game.area);assert.notEqual(f.b.getArea(),f.game.area);assert.equal(f.game.area.canAttack(f.a,f.b,CombatFactory.MAGIC_COMBAT),false);}
  const before=resources(f.a),stats=gStats(f.b),hp=f.b.getHitpoints(),lines=messagesOf(f.a);await mSpell(f.a,f.b,row.key);tick(10);bStop(f);
  assert.deepEqual(resources(f.a),before);assert.deepEqual(gStats(f.b),stats);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);
  if(refusal==='locked')assert.ok(lines.some(x=>x.includes('100 times inside the Mage Arena')));
});
for(const row of G_ROWS)for(const magic of [1,2,3])mTest('G basic staff '+row.staff+' mode'+magic+' ordinary spell policy stays independent',async t=>{
  const f=await gGame(t,row,{rules:{magic}}),key=magic===3?'BIND':'WIND_STRIKE',before=mInventory(f.a);
  if(magic===1){const hit=await mFire(f,key);bStop(f);assert.notDeepEqual(mInventory(f.a),before);mLand(f,hit);}
  else{await mSpell(f.a,f.b,key);tick(10);assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);}
});
for(const row of G_ROWS)mTest('G '+row.key+' native remembered upgraded god autocast cannot pay or repeat',async t=>{
  const f=await gGame(t,row),I=core.ItemIdentifiers,staff={SARADOMIN_STRIKE:I.STAFF_OF_LIGHT,CLAWS_OF_GUTHIX:I.STAFF_OF_BALANCE,FLAMES_OF_ZAMORAK:I.STAFF_OF_THE_DEAD}[row.key],slot={SARADOMIN_STRIKE:52,CLAWS_OF_GUTHIX:19,FLAMES_OF_ZAMORAK:20}[row.key];
  await mEquip(f.a,staff);await nativeButton(f.a,(593<<16)|23);await nativeButton(f.a,(201<<16)|1,1,slot);
  assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells[row.key],'ordinary native upgraded selector produced the remembered god spell');
  await mEquip(f.a,row.staff);assert.equal(f.a.getEquipment().get(core.Equipment.WEAPON_SLOT).getId(),row.staff);
  assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells[row.key],'ordinary basic-staff swap retains the exact selected god');
  assert.equal(core.Autocasting.isActive(f.a),true,'retained god autocast is active with the actual basic staff');
  assert.equal(f.a.getCombat().getCastSpell(),null,'ordinary Attack has no explicit manual cast to bypass the prepromotion guard');
  const before=mInventory(f.a),hp=f.b.getHitpoints();await cNativeAttack(f.a,f.b);tick(30);bStop(f);
  assert.deepEqual(mInventory(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
  const cost=mCost(f.a,core.CombatSpells[row.key]),amounts=mAmounts(f.a,cost),manual=await mFire(f,row.key);mPaid(f.a,cost,amounts);const paid=mInventory(f.a),n=f.trace.commits.length;mLand(f,manual);tick(30);
  assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.commits.length,n,'the completed manual cast does not turn remembered state into automatic payments');bStop(f);
  await cAutocast(f.a);const mind=f.a.getInventory().getAmount(I.MIND_RUNE),old=f.trace.commits.length;await cNativeAttack(f.a,f.b);
  for(let k=0;k<25&&f.trace.commits.length<old+2;k++)tick();bStop(f);
  assert.ok(f.trace.commits.length>=old+2,'eligible elemental staff still supports actual paid autocast');
  assert.ok(f.a.getInventory().getAmount(I.MIND_RUNE)<mind);
});
for(const row of G_ROWS)for(const specialattacks of [1,2])mTest('G '+row.key+' NoStaff or NoSpecial'+specialattacks+' does not ban ordinary god casts',async t=>{
  const f=await gGame(t,row,{rules:{specialattacks,melee:1,ranged:1}}),hit=await gFire(f,row);mLand(f,hit);assert.equal(hit.getTotalDamage(),20);assert.equal(f.trace.commits.length,1);
});
for(const row of G_ROWS)for(const boundary of ['victim-leave','caster-leave','finish'])mTest('G '+row.key+' paid native queued hit discarded at '+boundary+' without refund',async t=>{
  const f=await gGame(t,row),hit=await gFire(f,row),paid=mInventory(f.a),hp=f.b.getHitpoints(),stats=gStats(f.b);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);
  if(boundary==='victim-leave')f.game.area.leave(f.b,false);else if(boundary==='caster-leave')f.game.area.leave(f.a,false);else f.game.finish(null);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);for(const p of [f.a,f.b])p.setNeedsPlacement(false);tick(25);
  assert.deepEqual(mInventory(f.a),paid);assert.equal(f.trace.resolved.includes(hit),false);
  if(boundary==='caster-leave'){assert.equal(f.b.getHitpoints(),hp);assert.deepEqual(gStats(f.b),stats);}
});
mTest('G canonical paid mapped Forfeit discards pending god hit without refund',async t=>{
  const f=await gGame(t,G_ROWS[0]),pending=await gFire(f,G_ROWS[0]),paid=mInventory(f.a);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(pending),true);
  magicTurns=false;await nmForfeit(f.a,f.game);magicTurns=true;
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(pending),false);tick(15);
  assert.equal(f.trace.resolved.includes(pending),false);assert.deepEqual(mInventory(f.a),paid);
});
mTest('G applied drain stays on the participating victim when only its caster leaves',async t=>{
  const row=G_ROWS[1],f=await gGame(t,row),hit=await gFire(f,row);mLand(f,hit);
  const paid=mInventory(f.a);assert.equal(f.b.getSkillManager().getCurrentLevel(core.Skill.DEFENCE),94);
  f.game.area.leave(f.a,false);
  assert.equal(f.game.phase,'combat');assert.equal(f.game.fighters.has(f.b),true);
  assert.equal(f.b.getSkillManager().getCurrentLevel(core.Skill.DEFENCE),94,'before any later match-end/Ferox restoration tick');
  assert.deepEqual(mInventory(f.a),paid);
});
mTest('G native Charge actual cape prerequisite refuses before self-cast payment',async t=>{
  const f=await gGame(t,G_ROWS[0]),meta=core.CacheDefinitions.getSpellByName('Charge');f.a.setAttribute('mage-arena:cape-received',false);
  const before=resources(f.a),lines=messagesOf(f.a);await gChargeButton(f.a,meta);assert.deepEqual(resources(f.a),before);
  assert.ok(lines.includes('You need to complete the Mage Arena to cast this spell.'));assert.equal(Number(f.a.getAttribute(core.CombatSpells.CHARGE_UNTIL)??0),0);
});
for(const row of G_ROWS)mTest('G '+row.key+' actual captured F2P gate keeps paid free-spell positive and member refusal',async t=>{
  const f=await gGame(t,row),gates=[],names=['onCanUseItem','onCanEquip','onCanGainExperience','onCanSpawnNpc','onCanStockItem','onCustomEvent','onPrayerDisabled','onCanTeleport','onObjectInteraction','onPlayerProcess'];
  const api={core,onSpellDisabled:h=>gates.push(h)};for(const name of names)api[name]=()=>{};
  const mode=t.mock.method(core.WorldDefinition,'isMembersWorld',()=>false);try{require('../plugins/modes/FreeToPlay.plugin').register(api);}finally{mode.mock.restore();}assert.equal(gates.length,1);
  const real=PM.emitSpellDisabled.bind(PM),seen=[];t.mock.method(PM,'emitSpellDisabled',(player,book,id,cast)=>{
    if(player===f.a){const event={player,spellbook:book,spellId:id,spell:cast,disabled:false};gates[0](event);seen.push(event);if(event.disabled)return true;}
    return real(player,book,id,cast);
  });
  const lower=await mFire(f,'WIND_STRIKE');bStop(f);mLand(f,lower);assert.equal(f.trace.commits.length,1);
  const before=resources(f.a),stats=gStats(f.b),hp=f.b.getHitpoints(),lines=messagesOf(f.a);await mSpell(f.a,f.b,row.key);tick(10);bStop(f);
  assert.ok(seen.some(x=>x.spell===core.CombatSpells[row.key]&&x.disabled));assert.ok(lines.includes("You need to be on a members' world to cast this spell."));
  assert.deepEqual(resources(f.a),before);assert.deepEqual(gStats(f.b),stats);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.trace.commits.length,1);
});

// Explicit skill checkpoints cover the canonical floor/boost rules; rolls remain controlled.
mTest('G native paid Saradomin repeats damage at the Prayer zero floor',async t=>{
  const row=G_ROWS[0],f=await gGame(t,row),sm=f.b.getSkillManager();sm.setCurrentLevel(core.Skill.PRAYER,1,false);
  for(const expected of [0,0]){
    const hp=f.b.getHitpoints(),hit=await gFire(f,row);mLand(f,hit);
    assert.ok(hit.getTotalDamage()>0);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());
    assert.equal(sm.getCurrentLevel(core.Skill.PRAYER),expected);tick(10);
  }
});
for(const row of G_ROWS.slice(1))mTest('G '+row.key+' native boosted stat118 drains to112',async t=>{
  const f=await gGame(t,row),sm=f.b.getSkillManager(),skill=core.Skill[row.skill];
  assert.equal(sm.getMaxLevel(skill),99);sm.setCurrentLevel(skill,118,false);
  const stats=gStats(f.b),hit=await gFire(f,row);assert.equal(sm.getCurrentLevel(skill),118);mLand(f,hit);
  assert.equal(sm.getCurrentLevel(skill),112);assert.deepEqual(gStats(f.b),gEffect(stats,row));
});
mTest('G native Charge recast is unpaid at99 ticks and paid at100',async t=>{
  const f=await gGame(t,G_ROWS[0]),charge=await gCharge(t,f),meta=core.CacheDefinitions.getSpellByName('Charge');
  assert.equal(Number(f.a.getAttribute(core.CombatSpells.CHARGE_NEXT_CAST)),charge.at+100);
  tick(charge.at+99-C.now());const before=mInventory(f.a);
  await gChargeButton(f.a,meta);
  assert.deepEqual(mInventory(f.a),before);assert.equal(Number(f.a.getAttribute(core.CombatSpells.CHARGE_UNTIL)),charge.until);
  tick(charge.at+100-C.now());assert.equal(C.now(),charge.at+100);
  const recast=await gCharge(t,f);assert.equal(recast.at,charge.at+100);assert.equal(recast.until,charge.until+100);
});
mTest('G real lethal paid Saradomin reaches safe jail rejoin and a fresh god cast',async t=>{
  const row=G_ROWS[0],f=await gGame(t,row),kept=carriedItems(f.b);f.b.setHitpoints(1);
  const lethal=await gFire(f,row),paid=mInventory(f.a);mLand(f,lethal);
  for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();
  assert.equal(f.game.jailed.has(f.b),true);assert.equal(f.game.fighters.has(f.b),false);
  assert.deepEqual(carriedItems(f.b),kept);assert.deepEqual(mInventory(f.a),paid);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(lethal),false);
  await jailExit(f.b,f.game);assert.equal(f.game.fighters.has(f.b),true);
  assert.deepEqual(carriedItems(f.b),kept);tick(40);mPosition(f.game,f.a,f.b);
  const stats=gStats(f.b),hp=f.b.getHitpoints(),fresh=await gFire(f,row);mLand(f,fresh);
  assert.ok(fresh.getTotalDamage()>0);assert.equal(f.b.getHitpoints(),hp-fresh.getTotalDamage());
  assert.deepEqual(gStats(f.b),gEffect(stats,row));
});

// S: two staff-specific Standard spells. Current-cache/native routes and actual
// registered Iban/Slayer producers; charge/accuracy setup is explicitly supplied.
const S_ROWS=[
  {key:'IBAN_BLAST',label:'Iban Blast',itemId:3299,widgetId:14286889,staff:1409,slot:47,runes:[[560,1],[554,5]],max:25},
  {key:'MAGIC_DART',label:'Magic Dart',itemId:4176,widgetId:14286891,staff:4170,slot:18,runes:[[558,4],[560,1]],max:19},
];
const S_IBAN_STAVES=[[1409,120],[12658,2500],[33330,120],[33332,2500]];
function sLevels(p){p.getSkillManager().setMaxLevel(core.Skill.SLAYER,55);p.getSkillManager().setCurrentLevel(core.Skill.SLAYER,55,false);}
function sItem(p){return p.getEquipment().get(core.Equipment.WEAPON_SLOT);}
function sCharges(p){return require('../plugins/items/IbansStaff.plugin')._test.chargesOf(sItem(p));}
function sSetCharges(p,n){require('../plugins/items/IbansStaff.plugin')._test.setCharges(sItem(p),n);assert.equal(sCharges(p),n);}
function sMetadata(row){
  const spell=core.CombatSpells[row.key],meta=core.CacheDefinitions.getSpellByName(row.label),params=core.CacheDefinitions.getItem(row.itemId).params;
  assert.deepEqual(meta,{itemId:row.itemId,widgetId:row.widgetId});assert.equal(core.CacheDefinitions.getSpellName(meta.widgetId,meta.itemId),row.label);
  assert.equal(spell.getSpellbook(),core.MagicSpellbook.NORMAL);assert.equal(spell.isMembers(),true);assert.equal(spell.levelRequired(),50);assert.equal(spell.baseExperience(),30);
  assert.equal(core.CacheDefinitions.getEnumValues(1986).get(row.slot),row.itemId,'actual runtime selector enum agrees with reviewed literal');
  assert.equal(params.get(365),row.key==='IBAN_BLAST'?1409:4170,'equipment hint is not a consumed rune');
  assert.deepEqual(spell.itemsRequired(null).map(x=>[x.getId(),x.getAmount()]).sort((a,b)=>a[0]-b[0]),row.runes.slice().sort((a,b)=>a[0]-b[0]));
  const hint=core.CacheDefinitions.getSpellRequirements(row.label);assert.equal(hint.level,50);assert.deepEqual(hint.runes,[{id:row.key==='IBAN_BLAST'?1409:4170,amount:1},{id:560,amount:1},{id:row.key==='IBAN_BLAST'?554:558,amount:row.key==='IBAN_BLAST'?5:4}]);
  return meta;
}
async function sGame(t,row,options={}){
  const f=await eGame(t,options);sLevels(f.a);await mEquip(f.a,row.staff);sMetadata(row);f.b.setHitpoints(99);return f;
}
async function sFire(f,row,audit=true){
  const cost=mCost(f.a,core.CombatSpells[row.key]),before=mAmounts(f.a,cost),charges=row.key==='IBAN_BLAST'?sCharges(f.a):null;
  const hit=await mFire(f,row.key);bStop(f);if(audit)mPaid(f.a,cost,before);
  if(charges!=null)assert.equal(sCharges(f.a),Math.max(0,charges-2),'actual player paid commit debits canonical Iban charges');
  return hit;
}
async function sSelect(f,row){
  assert.equal(sItem(f.a).getId(),row.staff);sMetadata(row);
  await nativeButton(f.a,(593<<16)|23);await nativeButton(f.a,(201<<16)|1,1,row.slot);
  assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells[row.key]);assert.equal(core.Autocasting.isActive(f.a),true);assert.equal(f.a.getCombat().getCastSpell(),null);
}
async function sNpcSpell(a,b,row){
  const meta=sMetadata(row),{ClientPacketId}=require('../dist/net/protocol/NativeClientPackets'),frame=Buffer.alloc(12);
  frame[0]=ClientPacketId.OPNPC_T;frame.writeUInt16BE(b.getIndex(),1);frame.writeUInt32LE(meta.widgetId,3);frame.writeUInt16BE(65535,7);
  frame[9]=(meta.itemId+128)&255;frame[10]=meta.itemId>>>8;frame[11]=128;
  const decoded=decodeClientPackets(frame);assert.equal(decoded.length,1);assert.equal(decoded[0].type,'spell_on_npc');assert.equal(decoded[0].targetIndex,b.getIndex());assert.equal(decoded[0].spellWidget,meta.widgetId);assert.equal(decoded[0].spellItemId,meta.itemId);
  await a.connection.dispatch(decoded);a.connection.processTurnPackets();
}
for(const row of S_ROWS)mTest('S baseline outside canonical '+row.key+' native paid positive',async t=>{
  cInstall();const a=actor(true);ruleStats(a,99);sLevels(a);a.setSpellbook(core.MagicSpellbook.NORMAL);mFund(a);await mEquip(a,row.staff);
  const at=new core.Location(3222,3218,0);core.RegionManager.loadMapFiles(at.getX(),at.getY());a.moveTo(at);a.setNeedsPlacement(false);AreaManager.process(a);
  const b=C.api.spawnNpc({id:core.NpcIdentifiers.GUARD,x:3223,y:3218,z:0,wanderRadius:0});fixtureNpcs.add(b);npcQueues();
  assert.equal(b.isRegistered(),true);assert.equal(b.getId(),core.NpcIdentifiers.GUARD);assert.ok(b.getHitpoints()>0);assert.equal(C.matches.has(a),false);assert.equal(a.getPrivateArea(),null);assert.equal(b.getPrivateArea(),null);
  magicTurns=true;ghastTurns=true;const f={a,b,trace:mTrace(t,a,b)},cost=mCost(a,core.CombatSpells[row.key]),before=mAmounts(a,cost),hp=b.getHitpoints(),charges=row.key==='IBAN_BLAST'?sCharges(a):null;
  tick();await sNpcSpell(a,b,row);assert.equal(a.getCombat().getCastSpell(),core.CombatSpells[row.key]);assert.equal(a.getCombat().getTarget(),b);
  for(let n=0;n<30&&!f.trace.commits.length;n++)tick();assert.equal(f.trace.commits.length,1,'native canonical staff spell pays outside Clan Wars');assert.equal(f.trace.hits.length,1);
  const hit=f.trace.hits[0];bStop(f);mPaid(a,cost,before);if(charges!=null)assert.equal(sCharges(a),charges-1,'actual NPC target costs one charge');
  assert.equal(hit.getSpell(),core.CombatSpells[row.key]);assert.equal(hit.getSpellContext(),f.trace.commits[0].context);assert.equal(hit.getTotalDamage(),Math.min(hp,row.max),'canonical maximum capped to the real NPC hitpoints');
  mLand(f,hit);assert.equal(b.getHitpoints(),Math.max(0,hp-hit.getTotalDamage()));
});
for(const key of ['WIND_STRIKE','CONFUSE'])mTest('S baseline paid Standard '+key+' positive control',async t=>{
  const f=await eGame(t),cost=mCost(f.a,core.CombatSpells[key]),before=mAmounts(f.a,cost),hp=f.b.getHitpoints(),stats=cStats(f.b),hit=await mFire(f,key);bStop(f);mPaid(f.a,cost,before);mLand(f,hit);
  if(key==='CONFUSE'){assert.equal(f.b.getHitpoints(),hp);cAssertStats(f.b,stats,'ATTACK',5);}else assert.ok(f.b.getHitpoints()<hp);
});
mTest('S native Standard Iban commits pays charges queues and resolves damage',async t=>{
  const row=S_ROWS[0],f=await sGame(t,row);assert.equal(f.game.rules.magic,1);assert.equal(f.game.phase,'combat');assert.notEqual(f.game.fighters.get(f.a),f.game.fighters.get(f.b));assert.equal(sItem(f.a).getId(),1409);assert.equal(sCharges(f.a),120);
  const hp=f.b.getHitpoints(),hit=await sFire(f,row);assert.equal(hit.getTotalDamage(),25);assert.equal(f.b.getHitpoints(),hp,'paid queue has not resolved early');mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-25);
});
for(const row of S_ROWS)for(const branch of ['hit','splash','zero'])for(const freezing of [0,1])mTest('S '+row.key+' '+branch+' Ignore'+freezing+' native damage XP and paid resources',async t=>{
  const f=await sGame(t,row,{rules:{freezing}}),events=[],xp=[],sm=f.a.getSkillManager(),add=sm.addExperience.bind(sm),hp=f.b.getHitpoints(),stats=gStats(f.b);
  t.mock.method(sm,'addExperience',(...args)=>{xp.push(args);return add(...args);});
  if(branch!=='hit')magicDamageControl=e=>{if(e.attacker===f.a&&e.target===f.b){if(branch==='splash')e.accurate=false;e.damage.setDamage(0);events.push(e);}};
  const hit=await sFire(f,row);assert.equal(hit.isAccurate(),branch!=='splash');assert.equal(hit.getTotalDamage(),branch==='hit'?row.max:0);
  if(branch!=='hit'){assert.equal(events.length,1);assert.equal(events[0].hit,hit);assert.equal(events[0].damage,hit.getHits()[0]);assert.equal(events[0].combatType,core.CombatType.MAGIC);assert.equal(events[0].accurate,branch!=='splash');assert.equal(events[0].damage.getDamage(),0);}
  mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());assert.deepEqual(gStats(f.b),{...stats});assert.ok(xp.some(x=>x[0]===core.Skill.MAGIC&&x[1]===30),'canonical base XP forwarded');
});
for(const [staff,capacity]of S_IBAN_STAVES)for(const style of ['manual','autocast'])mTest('S Iban staff'+staff+' '+style+' actual paid route capacity'+capacity,async t=>{
  const row={...S_ROWS[0],staff},f=await sGame(t,row);assert.equal(sCharges(f.a),capacity);
  if(style==='manual'){const hp=f.b.getHitpoints(),hit=await sFire(f,row);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-25);}
  else{
    await sSelect(f,row);const cost=mCost(f.a,core.CombatSpells.IBAN_BLAST),before=mAmounts(f.a,cost);await cNativeAttack(f.a,f.b);
    for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2,'unstopped eligible native Attack repeats paid Iban');
    assert.equal(sCharges(f.a),capacity-2*paid);for(let n=0;n<cost.length;n++)assert.equal(f.a.getInventory().getAmount(cost[n][0]),before[n]-cost[n][1]*paid);
    for(const hit of f.trace.hits){assert.equal(hit.getSpell(),core.CombatSpells.IBAN_BLAST);assert.ok(f.trace.commits.some(e=>e.context===hit.getSpellContext()));mLand(f,hit);}assert.equal(f.b.getHitpoints(),99-25*paid);
  }
});
mTest('S Magic Dart existing native selector and ordinary Attack repeat actual paid max producer',async t=>{
  const row=S_ROWS[1],f=await sGame(t,row);await sSelect(f,row);const cost=mCost(f.a,core.CombatSpells.MAGIC_DART),before=mAmounts(f.a,cost);await cNativeAttack(f.a,f.b);
  for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);for(let n=0;n<cost.length;n++)assert.equal(f.a.getInventory().getAmount(cost[n][0]),before[n]-cost[n][1]*paid);
  for(const hit of f.trace.hits){assert.equal(hit.getSpell(),core.CombatSpells.MAGIC_DART);assert.equal(hit.getTotalDamage(),19);assert.ok(f.trace.commits.some(e=>e.context===hit.getSpellContext()));mLand(f,hit);}assert.equal(f.b.getHitpoints(),99-19*paid);assert.equal(sItem(f.a).getMetaValue('slayers-staff:charges'),undefined);
});
for(const [staff,capacity]of S_IBAN_STAVES)for(const left of [2,1,0])mTest('S Iban staff'+staff+' remaining'+left+' source preservation and empty refusal',async t=>{
  const row={...S_ROWS[0],staff},f=await sGame(t,row);sSetCharges(f.a,left);
  if(left>0){const hit=await sFire(f,row);mLand(f,hit);assert.equal(sCharges(f.a),0);assert.equal(hit.getTotalDamage(),25);tick(10);}
  const before=resources(f.a),hp=f.b.getHitpoints(),n=f.trace.commits.length,lines=messagesOf(f.a);await mSpell(f.a,f.b,row.key);tick(12);bStop(f);
  assert.equal(sCharges(f.a),0);assert.deepEqual(resources(f.a),before);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.trace.commits.length,n);assert.ok(lines.includes('Your staff has no charges left.'));
  // left1 records CURRENT SOURCE, not independent retail final-one-charge PvP parity.
});
for(const [level,max]of [[50,15],[59,15],[60,16],[99,19],[109,20]])mTest('S Magic Dart current Magic'+level+' actual maximum'+max,async t=>{
  const row=S_ROWS[1],f=await sGame(t,row);f.a.getSkillManager().setCurrentLevel(core.Skill.MAGIC,level,false);const hp=f.b.getHitpoints(),hit=await sFire(f,row);assert.equal(hit.getTotalDamage(),max);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-max);
});
for(const row of S_ROWS)for(const refusal of ['low-magic','wrong-book','no-death','no-other-rune','wrong-staff','shield','staging','same-team','outsider','classic','binding','disabled'])mTest('S '+row.key+' '+refusal+' refuses before native payment',async t=>{
  const magic={classic:2,binding:3,disabled:4}[refusal]??1,f=await sGame(t,row,{rules:{magic},prepare:refusal!=='staging'}),I=core.ItemIdentifiers;
  if(refusal==='low-magic')f.a.getSkillManager().setCurrentLevel(core.Skill.MAGIC,49,false);
  if(refusal==='wrong-book')f.a.setSpellbook(core.MagicSpellbook.ANCIENT);
  if(refusal==='no-death')f.a.getInventory().deleteNumber(560,f.a.getInventory().getAmount(560));
  if(refusal==='no-other-rune'){const id=row.key==='IBAN_BLAST'?554:558;f.a.getInventory().deleteNumber(id,f.a.getInventory().getAmount(id));}
  if(refusal==='wrong-staff')await mEquip(f.a,row.key==='IBAN_BLAST'?4170:1409);
  if(refusal==='shield')await mEquip(f.a,I.BRONZE_KITESHIELD,core.Equipment.SHIELD_SLOT);
  if(refusal==='same-team')f.game.fighters.set(f.b,f.game.fighters.get(f.a));
  if(refusal==='outsider'){f.game.area.leave(f.b,false);assert.equal(f.game.phase,'combat');assert.equal(C.matches.get(f.a),f.game);assert.equal(f.game.fighters.has(f.a),true);assert.equal(C.matches.has(f.b),false);assert.equal(f.game.fighters.has(f.b),false);assert.notEqual(f.b.getArea(),f.game.area);assert.equal(f.game.area.canAttack(f.a,f.b,CombatFactory.MAGIC_COMBAT),false);}
  const before=resources(f.a),hp=f.b.getHitpoints();await mSpell(f.a,f.b,row.key);tick(12);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
});
mTest('S Magic Dart actual current Slayer55 gate refuses54 after legitimate equip and recovers at55',async t=>{
  const row=S_ROWS[1],f=await sGame(t,row),sm=f.a.getSkillManager();assert.equal(sm.getMaxLevel(core.Skill.SLAYER),55);assert.equal(sItem(f.a).getId(),4170);
  sm.setCurrentLevel(core.Skill.SLAYER,54,false);const before=resources(f.a),hp=f.b.getHitpoints(),lines=messagesOf(f.a);await mSpell(f.a,f.b,row.key);tick(12);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.b.getHitpoints(),hp);assert.ok(lines.includes('You need a Slayer level of 55 to cast this spell.'));
  sm.setCurrentLevel(core.Skill.SLAYER,55,false);const hit=await sFire(f,row);mLand(f,hit);assert.equal(hit.getTotalDamage(),19);
});
for(const [staff]of [...S_IBAN_STAVES,[4170,0]])for(const gate of (staff===4170?['MAGIC','SLAYER']:['ATTACK','MAGIC']))mTest('S native equipment staff'+staff+' actual base '+gate+' gate',async t=>{
  const f=await eGame(t);sLevels(f.a);const sm=f.a.getSkillManager(),skill=core.Skill[gate],need=gate==='SLAYER'?55:50;
  sm.setMaxLevel(skill,need-1);sm.setCurrentLevel(skill,99,false);give(f.a,staff,'S-equip-refusal');const before=resources(f.a);await nativeItem(f.a,staff,'Wield');assert.deepEqual(resources(f.a),before);assert.notEqual(sItem(f.a).getId(),staff,'boosted current does not bypass actual base equip requirement');
  sm.setMaxLevel(skill,need);await nativeItem(f.a,staff,'Wield');assert.equal(sItem(f.a).getId(),staff,'actual gate admits exact base requirement');
});
for(const [staff]of [...S_IBAN_STAVES,[4170,0]])for(const magic of [1,2,3])mTest('S staff'+staff+' mode'+magic+' ordinary spell and charge policy',async t=>{
  const row={...S_ROWS[staff===4170?1:0],staff},f=await sGame(t,row,{rules:{magic}}),key=magic===3?'BIND':'WIND_STRIKE',charges=staff===4170?null:sCharges(f.a),before=resources(f.a);
  if(magic===1){const hit=await mFire(f,key);bStop(f);mLand(f,hit);assert.ok(hit.getTotalDamage()>0);if(charges!=null)assert.equal(sCharges(f.a),charges,'ordinary spell does not spend Iban charges');}
  else{await mSpell(f.a,f.b,key);tick(12);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);}
});
for(const row of S_ROWS)for(const element of ['fire','water','earth'])mTest('S '+row.key+' '+element+' tome supplies without damage boost or charge',async t=>{
  const f=await sGame(t,row),I=core.ItemIdentifiers;await mEquip(f.a,I['TOME_OF_'+element.toUpperCase()+'_EMPTY_'],core.Equipment.SHIELD_SLOT);const book=mTome(f.a,element,1),rune=I[element.toUpperCase()+'_RUNE'];
  if(row.key==='IBAN_BLAST'&&element==='fire')f.a.getInventory().deleteNumber(rune,f.a.getInventory().getAmount(rune));
  const hp=f.b.getHitpoints(),hit=await sFire(f,row);assert.equal(hit.getTotalDamage(),row.max);assert.equal(book.Common.read(book.item).charges,1);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-row.max);
});
for(const row of S_ROWS)mTest('S '+row.key+' actual Death pouch pays once and sacks do not fund it',async t=>{
  const f=await sGame(t,row),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');give(f.a,I.RUNE_POUCH,'S-pouch');Pouch.setSlots(f.a,[{id:560,amount:2},null,null,null]);f.a.getInventory().deleteNumber(560,f.a.getInventory().getAmount(560));f.a.getInventory().add(new core.Item(I.BLIGHTED_ENTANGLE_SACK,2));
  const other=row.key==='IBAN_BLAST'?554:558,otherCost=row.key==='IBAN_BLAST'?5:4,otherBefore=f.a.getInventory().getAmount(other);
  const hit=await sFire(f,row,false);assert.equal(Pouch.slots(f.a)[0].amount,1);assert.equal(f.a.getInventory().getAmount(560),0);assert.equal(f.a.getInventory().getAmount(other),otherBefore-otherCost);assert.equal(f.a.getInventory().getAmount(I.BLIGHTED_ENTANGLE_SACK),2);mLand(f,hit);tick(10);
  Pouch.setSlots(f.a,[null,null,null,null]);const before=resources(f.a),hp=f.b.getHitpoints(),n=f.trace.commits.length;await mSpell(f.a,f.b,row.key);tick(12);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,n);assert.equal(f.b.getHitpoints(),hp);
});
for(const row of S_ROWS)mTest('S '+row.key+' native remembered spell refuses incompatible admitted staff then compatible resumption',async t=>{
  const f=await sGame(t,row);await sSelect(f,row);const wrong=row.key==='IBAN_BLAST'?4170:1409;await mEquip(f.a,wrong);
  assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells[row.key]);assert.equal(core.Autocasting.isActive(f.a),true);assert.equal(f.a.getCombat().getCastSpell(),null);
  const before=resources(f.a),hp=f.b.getHitpoints();await cNativeAttack(f.a,f.b);tick(25);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.b.getHitpoints(),hp);
  await mEquip(f.a,row.staff);await sSelect(f,row);await cNativeAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);assert.ok(f.trace.commits.length>=2,'genuine compatible selector/Attack resumes paid repeats');
});
for(const row of S_ROWS)for(const boundary of ['victim-leave','caster-leave','finish'])mTest('S '+row.key+' native paid queue discarded at '+boundary+' without refund',async t=>{
  const f=await sGame(t,row),hit=await sFire(f,row),paid=resources(f.a),hp=f.b.getHitpoints();
  if(boundary==='finish'){f.game.finish(null);assert.equal(f.game.phase,'over');}else f.game.area.leave(boundary==='victim-leave'?f.b:f.a,false);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);tick(12);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(mInventory(f.a),paid.inventory);assert.deepEqual(contents(f.a.getEquipment()),paid.equipment);if(boundary==='caster-leave')assert.equal(f.b.getHitpoints(),hp);
});
for(const row of S_ROWS)mTest('S '+row.key+' real lethal cast safe jail rejoin and fresh paid native cast',async t=>{
  const f=await sGame(t,row),kept=carriedItems(f.b);f.b.setHitpoints(1);const hit=await sFire(f,row),paid=resources(f.a);mLand(f,hit);
  for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();assert.equal(f.game.jailed.has(f.b),true);assert.equal(f.game.fighters.has(f.b),false);assert.deepEqual(carriedItems(f.b),kept);assert.deepEqual(mInventory(f.a),paid.inventory);assert.deepEqual(contents(f.a.getEquipment()),paid.equipment);
  await jailExit(f.b,f.game);assert.equal(f.game.fighters.has(f.b),true);tick(40);mPosition(f.game,f.a,f.b);const hp=f.b.getHitpoints(),fresh=await sFire(f,row);mLand(f,fresh);assert.equal(f.b.getHitpoints(),hp-fresh.getTotalDamage());
});
for(const row of S_ROWS)mTest('S '+row.key+' manual override and actual compatible elemental autocast resume',async t=>{
  const f=await sGame(t,row),slot=row.key==='IBAN_BLAST'?1:13,key=row.key==='IBAN_BLAST'?'WIND_STRIKE':'WIND_WAVE';
  await nativeButton(f.a,(593<<16)|23);await nativeButton(f.a,(201<<16)|1,1,slot);assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells[key]);assert.equal(core.Autocasting.isActive(f.a),true);
  const charges=row.key==='IBAN_BLAST'?sCharges(f.a):null,hit=await mFire(f,row.key);mLand(f,hit);
  for(let n=0;n<30&&!f.trace.commits.some(e=>e.spell===core.CombatSpells[key]);n++)tick();bStop(f);
  assert.equal(f.trace.commits.filter(e=>e.spell===core.CombatSpells[row.key]).length,1);const resumed=f.trace.commits.find(e=>e.spell===core.CombatSpells[key]);assert.ok(resumed);assert.ok(f.trace.hits.some(h=>h.getSpell()===resumed.spell&&h.getSpellContext()===resumed.context));if(charges!=null)assert.equal(sCharges(f.a),charges-2,'resumed elemental spell spends no Iban charge');
});
for(const row of S_ROWS)mTest('S '+row.key+' actual captured membership gate keeps paid free spell control',async t=>{
  const f=await sGame(t,row),gates=[],names=['onCanUseItem','onCanEquip','onCanGainExperience','onCanSpawnNpc','onCanStockItem','onCustomEvent','onPrayerDisabled','onCanTeleport','onObjectInteraction','onPlayerProcess'];
  const api={core,onSpellDisabled:h=>gates.push(h)};for(const name of names)api[name]=()=>{};
  const mode=t.mock.method(core.WorldDefinition,'isMembersWorld',()=>false);try{require('../plugins/modes/FreeToPlay.plugin').register(api);}finally{mode.mock.restore();}assert.equal(gates.length,1);
  const real=PM.emitSpellDisabled.bind(PM),seen=[];t.mock.method(PM,'emitSpellDisabled',(player,book,id,cast)=>{
    if(player===f.a){const event={player,spellbook:book,spellId:id,spell:cast,disabled:false};gates[0](event);seen.push(event);if(event.disabled)return true;}return real(player,book,id,cast);
  });
  const lower=await mFire(f,'WIND_STRIKE');bStop(f);mLand(f,lower);assert.equal(f.trace.commits.length,1);
  const before=resources(f.a),hp=f.b.getHitpoints(),lines=messagesOf(f.a);await mSpell(f.a,f.b,row.key);tick(12);bStop(f);assert.ok(seen.some(e=>e.spell===core.CombatSpells[row.key]&&e.disabled));assert.ok(lines.includes("You need to be on a members' world to cast this spell."));assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,1);assert.equal(f.b.getHitpoints(),hp);
});
for(const row of S_ROWS)mTest('S '+row.key+' canonical paid mapped Forfeit discards queued hit without refund',async t=>{
  const f=await sGame(t,row),hit=await sFire(f,row),paid=resources(f.a),hp=f.b.getHitpoints();assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);
  // Existing G/M precedent: hold impact turns while the actual mapped movement
  // and object dispatcher reach Forfeit; this is not a natural flight-time claim.
  magicTurns=false;try{await nmForfeit(f.a,f.game);}finally{magicTurns=true;}
  assert.equal(C.matches.has(f.a),false);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);tick(15);assert.equal(f.trace.resolved.includes(hit),false);assert.equal(f.b.getHitpoints(),hp);assert.deepEqual(mInventory(f.a),paid.inventory);assert.deepEqual(contents(f.a.getEquipment()),paid.equipment);
});
for(const row of S_ROWS)for(const specialattacks of [1,2])mTest('S '+row.key+' NoStaff or NoSpecial'+specialattacks+' permits ordinary canonical spell',async t=>{
  const f=await sGame(t,row,{rules:{specialattacks,melee:1,ranged:1}}),hit=await sFire(f,row);mLand(f,hit);assert.equal(hit.getTotalDamage(),row.max);assert.equal(f.trace.commits.length,1);
});

// W: EXACT master wand 6914, Standard1 only. Existing canonical cache stats,
// equip gate, selectors, payment and delayed hit producers remain authoritative.
const W_MASTER=6914;
const W_ELEMENTS=M_ELEMENTS.flatMap((element,e)=>M_FAMILIES.map((family,f)=>({key:element+'_'+family,slot:f===4?48+e:f*4+e+1})));
function wMetadata(p){
  assert.equal(core.ItemIdentifiers.MASTER_WAND,W_MASTER);
  const type=core.CacheDefinitions.getItem(W_MASTER),def=core.ItemDefinition.forId(W_MASTER);
  assert.equal(type.isMembers,true);assert.equal(type.wearPos,core.Equipment.WEAPON_SLOT);
  assert.equal(type.params.get(299),100);assert.equal(type.params.get(436),55,'retained metadata is not the current equipment requirement array');
  assert.equal(def.hasCacheBonuses(),true);assert.equal(def.getBonuses()[3],20);assert.equal(def.getBonuses()[8],20);assert.equal(def.getBonuses()[12],10);
  assert.equal(def.getRequirements()[core.Skill.MAGIC.getIndex()],60);
  assert.equal(def.getWeaponInterface(),core.WeaponInterfaces.STAFF);
  if(p){
    assert.equal(sItem(p).getId(),W_MASTER);assert.equal(p.getEquipment().hasStaffEquipped(),true);
    const offhand=p.getEquipment().get(core.Equipment.SHIELD_SLOT),bonus=offhand?.getId()>0?offhand.getDefinition().getBonuses():[];
    assert.equal(p.getBonusManager().getAttackBonus()[3],20+(bonus[3]??0));assert.equal(p.getBonusManager().getDefenceBonus()[3],20+(bonus[8]??0));assert.equal(p.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH],10+(bonus[12]??0));
  }
}
function wSpellMetadata(key){
  const label=key.toLowerCase().split('_').map(s=>s[0].toUpperCase()+s.slice(1)).join(' '),meta=core.CacheDefinitions.getSpellByName(label),spell=core.CombatSpells[key];
  assert.ok(meta);assert.equal(core.CacheDefinitions.getSpellName(meta.widgetId,meta.itemId),label);assert.equal(spell.getSpellbook(),core.MagicSpellbook.NORMAL);
  const literal={WIND_STRIKE:[3273,14286859],FIRE_WAVE:[3321,14286916],CONFUSE:[3274,14286860],BIND:[3283,14286871]}[key];
  if(literal)assert.deepEqual(meta,{itemId:literal[0],widgetId:literal[1]});
  const row=W_ELEMENTS.find(x=>x.key===key);if(row)assert.equal(core.CacheDefinitions.getEnumValues(1986).get(row.slot),meta.itemId);
  if(key==='FIRE_WAVE'){assert.equal(spell.levelRequired(),75);assert.deepEqual(spell.itemsRequired(null).map(x=>[x.getId(),x.getAmount()]).sort((a,b)=>a[0]-b[0]),[[554,7],[556,5],[565,1]]);}
  return meta;
}
async function wGame(t,options={}){const f=await eGame(t,options);await mEquip(f.a,W_MASTER);wMetadata(f.a);f.b.setHitpoints(99);return f;}
async function wFire(f,key='FIRE_WAVE',audit=true){
  wMetadata(f.a);wSpellMetadata(key);const cost=mCost(f.a,core.CombatSpells[key]),amounts=mAmounts(f.a,cost),hit=await mFire(f,key);bStop(f);if(audit)mPaid(f.a,cost,amounts);return hit;
}
async function wSelect(f,key='WIND_STRIKE'){
  wMetadata(f.a);wSpellMetadata(key);const row=W_ELEMENTS.find(x=>x.key===key);assert.ok(row);
  await nativeButton(f.a,(593<<16)|23);assert.equal(f.a.getPacketSender().getVarp(664),-1,'actual native selector uses the existing Normal list');await nativeButton(f.a,(201<<16)|1,1,row.slot);
  assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells[key]);assert.equal(core.Autocasting.isActive(f.a),true);assert.equal(f.a.getCombat().getCastSpell(),null);
  assert.equal(f.a.getPacketSender().getVarbit(276),row.slot);assert.equal(f.a.getPacketSender().getVarp(core.CacheDefinitions.getVarpId('autocast_spell_obj')),wSpellMetadata(key).itemId);
}
async function wNoPaid(f,key='FIRE_WAVE'){
  const before=resources(f.a),hp=f.b.getHitpoints(),commits=f.trace.commits.length,hits=f.trace.hits.length;
  await mSpell(f.a,f.b,key);tick(15);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,commits);assert.equal(f.trace.hits.length,hits);assert.equal(f.b.getHitpoints(),hp);
}
async function wNpcSpell(a,b,key){
  const meta=wSpellMetadata(key),{ClientPacketId}=require('../dist/net/protocol/NativeClientPackets'),frame=Buffer.alloc(12);
  frame[0]=ClientPacketId.OPNPC_T;frame.writeUInt16BE(b.getIndex(),1);frame.writeUInt32LE(meta.widgetId,3);frame.writeUInt16BE(65535,7);
  frame[9]=(meta.itemId+128)&255;frame[10]=meta.itemId>>>8;frame[11]=128;
  const decoded=decodeClientPackets(frame);assert.equal(decoded.length,1);assert.equal(decoded[0].type,'spell_on_npc');assert.equal(decoded[0].targetIndex,b.getIndex());assert.equal(decoded[0].spellWidget,meta.widgetId);assert.equal(decoded[0].spellItemId,meta.itemId);
  await a.connection.dispatch(decoded);a.connection.processTurnPackets();
}
async function wOutside(t){
  cInstall();const a=actor(true);ruleStats(a,99);a.setSpellbook(core.MagicSpellbook.NORMAL);mFund(a);await mEquip(a,W_MASTER);wMetadata(a);
  const at=new core.Location(3222,3218,0);core.RegionManager.loadMapFiles(at.getX(),at.getY());a.moveTo(at);a.setNeedsPlacement(false);AreaManager.process(a);
  const b=C.api.spawnNpc({id:core.NpcIdentifiers.GUARD,x:3223,y:3218,z:0,wanderRadius:0});fixtureNpcs.add(b);npcQueues();
  assert.equal(b.isRegistered(),true);assert.equal(b.getId(),core.NpcIdentifiers.GUARD);assert.ok(b.getHitpoints()>0);assert.equal(C.matches.has(a),false);assert.equal(a.getPrivateArea(),null);assert.equal(b.getPrivateArea(),null);
  magicTurns=true;ghastTurns=true;return{a,b,trace:mTrace(t,a,b)};
}
mTest('W baseline outside exact6914 native manual paid positive',async t=>{
  const f=await wOutside(t),cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(f.a,cost),hp=f.b.getHitpoints();tick();
  await wNpcSpell(f.a,f.b,'WIND_STRIKE');assert.equal(f.a.getCombat().getCastSpell(),core.CombatSpells.WIND_STRIKE);assert.equal(f.a.getCombat().getTarget(),f.b);
  for(let n=0;n<30&&!f.trace.commits.length;n++)tick();bStop(f);assert.equal(f.trace.commits.length,1);assert.equal(f.trace.hits.length,1);mPaid(f.a,cost,amounts);
  const hit=f.trace.hits[0];assert.equal(hit.getCombatMethod(),CombatFactory.MAGIC_COMBAT);assert.equal(hit.getSpell(),core.CombatSpells.WIND_STRIKE);assert.equal(hit.getSpellContext(),f.trace.commits[0].context);assert.ok(hit.getTotalDamage()>0);
  mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());
});
mTest('W baseline outside exact6914 native selector Attack repeats paid casts',async t=>{
  const f=await wOutside(t),hp=f.b.getHitpoints();await wSelect(f);const cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(f.a,cost);
  await ghastAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);
  for(let i=0;i<cost.length;i++)assert.equal(f.a.getInventory().getAmount(cost[i][0]),amounts[i]-paid*cost[i][1]);
  for(const hit of f.trace.hits){assert.equal(hit.getSpell(),core.CombatSpells.WIND_STRIKE);assert.ok(f.trace.commits.some(x=>x.context===hit.getSpellContext()));mLand(f,hit);}
  assert.ok(f.b.getHitpoints()<hp);assert.equal(f.trace.hits.length,paid);
});
mTest('W baseline plain staff Fire Wave paid player maximum20 positive',async t=>{
  const f=await eGame(t);await mEquip(f.a,core.ItemIdentifiers.STAFF);wSpellMetadata('FIRE_WAVE');assert.equal(f.a.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH],0);
  const cost=mCost(f.a,core.CombatSpells.FIRE_WAVE),amounts=mAmounts(f.a,cost),hp=f.b.getHitpoints(),hit=await mFire(f,'FIRE_WAVE');bStop(f);mPaid(f.a,cost,amounts);assert.equal(hit.getTotalDamage(),20);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-20);
});
mTest('W native Standard exact6914 Fire Wave commits real bonus maximum22',async t=>{
  const f=await wGame(t);assert.equal(f.game.rules.magic,1);assert.equal(f.game.phase,'combat');assert.notEqual(f.game.fighters.get(f.a),f.game.fighters.get(f.b));
  const hp=f.b.getHitpoints(),hit=await wFire(f);assert.equal(hit.getTotalDamage(),22);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-22);
});
for(const row of W_ELEMENTS)mTest('W exact6914 manual '+row.key+' actual payment queue HP and XP',async t=>{
  const f=await wGame(t),hp=f.b.getHitpoints(),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC),hit=await wFire(f,row.key);assert.ok(hit.getTotalDamage()>0);assert.equal(f.b.getHitpoints(),hp);
  mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());assert.ok(f.a.getSkillManager().getExperience(core.Skill.MAGIC)>xp);assert.equal(f.trace.commits.length,1);
});
for(const row of W_ELEMENTS)mTest('W exact6914 native selector '+row.slot+' '+row.key+' unstopped paid repeats',async t=>{
  const f=await wGame(t),hp=f.b.getHitpoints();await wSelect(f,row.key);const cost=mCost(f.a,core.CombatSpells[row.key]),amounts=mAmounts(f.a,cost);
  await cNativeAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);
  for(let i=0;i<cost.length;i++)assert.equal(f.a.getInventory().getAmount(cost[i][0]),amounts[i]-paid*cost[i][1]);
  for(const hit of f.trace.hits){assert.equal(hit.getCombatMethod(),CombatFactory.MAGIC_COMBAT);assert.equal(hit.getSpell(),core.CombatSpells[row.key]);assert.ok(f.trace.commits.some(x=>x.context===hit.getSpellContext()));mLand(f,hit);}
  assert.equal(f.trace.hits.length,paid);assert.equal(f.b.getHitpoints(),hp-f.trace.hits.reduce((n,h)=>n+h.getTotalDamage(),0));
});
for(const freezing of [0,1])for(const key of ['CONFUSE','BIND'])mTest('W manual '+key+' with Ignore'+freezing+' pays and preserves real effect policy',async t=>{
  const f=await wGame(t,{rules:{freezing}}),hp=f.b.getHitpoints(),stats=cStats(f.b),freeze=fTrace(t,f.b),hit=await wFire(f,key);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp);
  if(key==='CONFUSE')cAssertStats(f.b,stats,'ATTACK',5);
  else if(freezing)fNoNewEffects(freeze);else assert.ok(freeze.timers.some(x=>x[0]===core.TimerKey.FREEZE));
});
for(const key of ['SARADOMIN_STRIKE','CLAWS_OF_GUTHIX','FLAMES_OF_ZAMORAK','IBAN_BLAST','MAGIC_DART'])mTest('W exact6914 preserves canonical matching-staff refusal '+key,async t=>{
  gInstall();const f=await wGame(t);gUnlock(f.a);sLevels(f.a);await wNoPaid(f,key);
});
mTest('W native equipment maxMagic59 refuses current99 then admits actual max60',async t=>{
  const f=await eGame(t),sm=f.a.getSkillManager();sm.setMaxLevel(core.Skill.MAGIC,59);sm.setCurrentLevel(core.Skill.MAGIC,99,false);give(f.a,W_MASTER,'W-max-gate');const before=resources(f.a);
  await nativeItem(f.a,W_MASTER,'Wield');assert.deepEqual(resources(f.a),before);assert.notEqual(sItem(f.a).getId(),W_MASTER);
  sm.setMaxLevel(core.Skill.MAGIC,60);await nativeItem(f.a,W_MASTER,'Wield');wMetadata(f.a);
});
mTest('W equipped max99 currentMagic74 refuses Fire Wave then current75 recovers',async t=>{
  const f=await wGame(t),sm=f.a.getSkillManager();sm.setCurrentLevel(core.Skill.MAGIC,74,false);await wNoPaid(f);sm.setCurrentLevel(core.Skill.MAGIC,75,false);const hit=await wFire(f);assert.equal(hit.getTotalDamage(),22);mLand(f,hit);
});
for(const mode of [2,3,4])mTest('W exact6914 mode'+mode+' retains unsupported casting without payment',async t=>{
  const f=await wGame(t,{rules:{magic:mode}});await wNoPaid(f,mode===3?'BIND':'WIND_STRIKE');
});
for(const book of ['ANCIENT','ARCEUUS'])mTest('W other spellbook '+book+' does not admit a Normal hand cast',async t=>{
  const f=await wGame(t);f.a.setSpellbook(core.MagicSpellbook[book]);await wNoPaid(f);
});
mTest('W real LMS20560 remains excluded despite actual master-wand alias and native eligibility',async t=>{
  const f=await wGame(t);assert.equal(core.CacheDefinitions.getObjId('br_master_wand'),20560);assert.equal(core.ItemAliases.baseOf(20560),W_MASTER);await mEquip(f.a,20560);assert.equal(f.a.getEquipment().hasStaffEquipped(),true);await wNoPaid(f,'WIND_STRIKE');
});
for(const id of [6915,18598])mTest('W unwearable note or placeholder '+id+' rejects native wield-slot input',async t=>{
  const f=await wGame(t);give(f.a,id,'W-unwearable');const before=resources(f.a),slot=f.a.getInventory().getItems().findIndex(item=>item?.getId()===id);
  assert.equal(core.CacheDefinitions.getItem(id).inventoryActions.includes('Wield'),false);
  const {MAIN_INVENTORY_WIDGET_UID}=require('../dist/net/protocol/ClientProtocol');
  // The real inventory operation used by a wand's Wield is unavailable on these
  // unwearable objects. Send that invalid native widget operation, not tEquip.
  await nativeButton(f.a,MAIN_INVENTORY_WIDGET_UID,3,slot,id);assert.deepEqual(resources(f.a),before);wMetadata(f.a);
});
for(const id of [565,554,556])mTest('W Fire Wave cannot substitute missing ordinary rune '+id,async t=>{
  const f=await wGame(t);f.a.getInventory().deleteNumber(id,f.a.getInventory().getAmount(id));await wNoPaid(f);
});
mTest('W actual Blood pouch source pays once with no negative inventory audit',async t=>{
  const f=await wGame(t),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');give(f.a,I.RUNE_POUCH,'W-pouch');Pouch.setSlots(f.a,[{id:565,amount:2},null,null,null]);f.a.getInventory().deleteNumber(565,f.a.getInventory().getAmount(565));
  const fire=f.a.getInventory().getAmount(554),air=f.a.getInventory().getAmount(556),hit=await wFire(f,'FIRE_WAVE',false);assert.equal(Pouch.slots(f.a)[0].amount,1);assert.equal(f.a.getInventory().getAmount(565),0);assert.equal(f.a.getInventory().getAmount(554),fire-7);assert.equal(f.a.getInventory().getAmount(556),air-5);mLand(f,hit);tick(10);
  Pouch.setSlots(f.a,[null,null,null,null]);await wNoPaid(f);
});
mTest('W actual fire tome supplies and spends its final page charge alongside wand bonus',async t=>{
  const f=await wGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I.TOME_OF_FIRE_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'fire',1);f.a.getInventory().deleteNumber(554,f.a.getInventory().getAmount(554));
  const blood=f.a.getInventory().getAmount(565),air=f.a.getInventory().getAmount(556),hit=await wFire(f,'FIRE_WAVE',false);assert.equal(book.Common.read(book.item).charges,0);assert.equal(f.a.getInventory().getAmount(554),0);assert.equal(f.a.getInventory().getAmount(565),blood-1);assert.equal(f.a.getInventory().getAmount(556),air-5);mLand(f,hit);tick(10);await wNoPaid(f);
});
mTest('W native gear switch removes and restores actual ten-percent bonus with paid resumption',async t=>{
  const f=await wGame(t);const first=await wFire(f);assert.equal(first.getTotalDamage(),22);mLand(f,first);tick(10);
  await mEquip(f.a,core.ItemIdentifiers.STAFF);assert.equal(f.a.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH],0);const cost=mCost(f.a,core.CombatSpells.FIRE_WAVE),amounts=mAmounts(f.a,cost),plain=await mFire(f,'FIRE_WAVE');bStop(f);mPaid(f.a,cost,amounts);assert.equal(plain.getTotalDamage(),20);mLand(f,plain);tick(10);
  await mEquip(f.a,W_MASTER);wMetadata(f.a);const fresh=await wFire(f);assert.equal(fresh.getTotalDamage(),22);mLand(f,fresh);
});
mTest('W remembered elemental autocast refuses excluded LMS then real master selection resumes paid repeats',async t=>{
  const f=await wGame(t);await wSelect(f,'FIRE_WAVE');await mEquip(f.a,20560);assert.equal(core.Autocasting.isActive(f.a),true);assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells.FIRE_WAVE);
  const before=resources(f.a),hp=f.b.getHitpoints();await cNativeAttack(f.a,f.b);tick(25);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
  await mEquip(f.a,W_MASTER);await wSelect(f,'FIRE_WAVE');const cost=mCost(f.a,core.CombatSpells.FIRE_WAVE),amounts=mAmounts(f.a,cost);await cNativeAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);
  for(let i=0;i<cost.length;i++)assert.equal(f.a.getInventory().getAmount(cost[i][0]),amounts[i]-paid*cost[i][1]);for(const hit of f.trace.hits){assert.equal(hit.getTotalDamage(),22);mLand(f,hit);}assert.equal(f.b.getHitpoints(),hp-22*paid);
});
for(const boundary of ['victim-leave','caster-leave','finish','Forfeit'])mTest('W paid player queue '+boundary+' is discarded without resolution or refund',async t=>{
  const f=await wGame(t),hit=await wFire(f),paid=resources(f.a),hp=f.b.getHitpoints();assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);
  if(boundary==='Forfeit'){
    // Hold impact while the existing mapped checkpoint/ObjectAction dispatcher
    // reaches Forfeit; this is not encoded object-click or natural flight proof.
    const priorTurns=magicTurns;magicTurns=false;try{await nmForfeit(f.a,f.game);}finally{magicTurns=priorTurns;}
    assert.equal(C.matches.has(f.a),false);
  }else if(boundary==='finish'){f.game.finish(null);assert.equal(f.game.phase,'over');}
  else f.game.area.leave(boundary==='victim-leave'?f.b:f.a,false);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);tick(15);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(mInventory(f.a),paid.inventory);assert.deepEqual(contents(f.a.getEquipment()),paid.equipment);
  if(boundary==='caster-leave'||boundary==='Forfeit')assert.equal(f.b.getHitpoints(),hp);
});
mTest('W lethal native cast retains safe inventory and rejoin permits fresh paid cast',async t=>{
  const f=await wGame(t),kept=carriedItems(f.b);f.b.setHitpoints(1);const hit=await wFire(f),paid=resources(f.a);mLand(f,hit);
  for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();assert.equal(f.game.jailed.has(f.b),true);assert.deepEqual(carriedItems(f.b),kept);assert.deepEqual(mInventory(f.a),paid.inventory);assert.deepEqual(contents(f.a.getEquipment()),paid.equipment);
  await jailExit(f.b,f.game);assert.equal(f.game.fighters.has(f.b),true);tick(40);mPosition(f.game,f.a,f.b);const fresh=await wFire(f);assert.equal(fresh.getTotalDamage(),22);mLand(f,fresh);
});
mTest('W captured actual F2P equip gate refuses member wand and preserves basic-staff paid control',async t=>{
  const f=await eGame(t),gates=[],names=['onCanUseItem','onCanGainExperience','onCanSpawnNpc','onCanStockItem','onCustomEvent','onSpellDisabled','onPrayerDisabled','onCanTeleport','onObjectInteraction','onPlayerProcess'];
  const api={core,onCanEquip:h=>gates.push(h)};for(const name of names)api[name]=()=>{};
  const mode=t.mock.method(core.WorldDefinition,'isMembersWorld',()=>false);try{require('../plugins/modes/FreeToPlay.plugin').register(api);}finally{mode.mock.restore();}assert.equal(gates.length,1);
  const real=PM.emitCanEquip.bind(PM),seen=[];t.mock.method(PM,'emitCanEquip',(player,slot,item)=>{
    if(player===f.a){const event={player,slot,item,allow:null};gates[0](event);seen.push(event);if(event.allow===false)return false;}return real(player,slot,item);
  });
  await mEquip(f.a,core.ItemIdentifiers.STAFF);const cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(f.a,cost),hit=await mFire(f);bStop(f);mPaid(f.a,cost,amounts);mLand(f,hit);
  give(f.a,W_MASTER,'W-members-equip');const before=resources(f.a);await nativeItem(f.a,W_MASTER,'Wield');assert.deepEqual(resources(f.a),before);assert.equal(sItem(f.a).getId(),core.ItemIdentifiers.STAFF);assert.ok(seen.some(e=>e.item.getId()===W_MASTER&&e.allow===false));
});
mTest('W staging refusal precedes ordinary paid recovery in actual combat phase',async t=>{
  const f=await wGame(t,{prepare:false});assert.equal(f.game.phase,'staging');await wNoPaid(f);completePreparation(f.game);mPosition(f.game,f.a,f.b);assert.equal(f.game.phase,'combat');const hit=await wFire(f);assert.equal(hit.getTotalDamage(),22);mLand(f,hit);
});
mTest('W departed outsider refusal has no new payment or impact',async t=>{
  const f=await wGame(t);f.game.area.leave(f.b,false);assert.equal(C.matches.has(f.b),false);await wNoPaid(f);
});
mTest('W unsupported real shield refuses while the explicit tome boundary stays separate',async t=>{
  const f=await wGame(t);await mEquip(f.a,core.ItemIdentifiers.RUNE_KITESHIELD,core.Equipment.SHIELD_SLOT);await wNoPaid(f);
});
for(const specialattacks of [1,2])mTest('W NoStaff or NoSpecial'+specialattacks+' retains ordinary native spell',async t=>{
  const f=await wGame(t,{rules:{specialattacks,melee:1,ranged:1}}),hit=await wFire(f);assert.equal(hit.getTotalDamage(),22);mLand(f,hit);
});

// A: EXACT apprentice wand 6910, Standard1 only. Existing canonical cache stats,
// equip gate, selectors, payment and delayed hit producers remain authoritative.
const A_APPRENTICE=6910;
function aMetadata(p){
  assert.equal(core.ItemIdentifiers.APPRENTICE_WAND,A_APPRENTICE);
  const type=core.CacheDefinitions.getItem(A_APPRENTICE),def=core.ItemDefinition.forId(A_APPRENTICE);
  assert.equal(type.name,'Apprentice wand');assert.equal(type.isMembers,true);assert.equal(type.wearPos,core.Equipment.WEAPON_SLOT);
  assert.equal(type.params.get(3),10);assert.equal(type.params.get(8),10);assert.equal(type.params.has(299),false);
  assert.equal(def.hasCacheBonuses(),true);assert.equal(def.getBonuses()[3],10);assert.equal(def.getBonuses()[8],10);assert.equal(def.getBonuses()[12],0);
  assert.equal(def.getRequirements()[core.Skill.MAGIC.getIndex()],50);assert.equal(def.getWeaponInterface(),core.WeaponInterfaces.STAFF);
  if(p){
    assert.equal(sItem(p).getId(),A_APPRENTICE);assert.equal(p.getEquipment().hasStaffEquipped(),true);
    const offhand=p.getEquipment().get(core.Equipment.SHIELD_SLOT),bonus=offhand?.getId()>0?offhand.getDefinition().getBonuses():[];
    assert.equal(p.getBonusManager().getAttackBonus()[3],10+(bonus[3]??0));assert.equal(p.getBonusManager().getDefenceBonus()[3],10+(bonus[8]??0));assert.equal(p.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH],bonus[12]??0);
  }
}
async function aGame(t,options={}){const f=await eGame(t,options);await mEquip(f.a,A_APPRENTICE);aMetadata(f.a);f.b.setHitpoints(99);return f;}
async function aFire(f,key='FIRE_WAVE',audit=true){
  aMetadata(f.a);wSpellMetadata(key);const cost=mCost(f.a,core.CombatSpells[key]),amounts=mAmounts(f.a,cost),hit=await mFire(f,key);bStop(f);if(audit)mPaid(f.a,cost,amounts);return hit;
}
async function aSelect(f,key='WIND_STRIKE'){
  aMetadata(f.a);wSpellMetadata(key);const row=W_ELEMENTS.find(x=>x.key===key);assert.ok(row);
  await nativeButton(f.a,(593<<16)|23);assert.equal(f.a.getPacketSender().getVarp(664),-1,'actual native selector uses the existing Normal list');await nativeButton(f.a,(201<<16)|1,1,row.slot);
  assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells[key]);assert.equal(core.Autocasting.isActive(f.a),true);assert.equal(f.a.getCombat().getCastSpell(),null);
  assert.equal(f.a.getPacketSender().getVarbit(276),row.slot);assert.equal(f.a.getPacketSender().getVarp(core.CacheDefinitions.getVarpId('autocast_spell_obj')),wSpellMetadata(key).itemId);
}
async function aNoPaid(f,key='FIRE_WAVE'){
  const before=resources(f.a),hp=f.b.getHitpoints(),commits=f.trace.commits.length,hits=f.trace.hits.length;
  await mSpell(f.a,f.b,key);tick(15);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,commits);assert.equal(f.trace.hits.length,hits);assert.equal(f.b.getHitpoints(),hp);
}
async function aOutside(t){
  cInstall();const a=actor(true);ruleStats(a,99);a.setSpellbook(core.MagicSpellbook.NORMAL);mFund(a);await mEquip(a,A_APPRENTICE);aMetadata(a);
  const at=new core.Location(3222,3218,0);core.RegionManager.loadMapFiles(at.getX(),at.getY());a.moveTo(at);a.setNeedsPlacement(false);AreaManager.process(a);
  const b=C.api.spawnNpc({id:core.NpcIdentifiers.GUARD,x:3223,y:3218,z:0,wanderRadius:0});fixtureNpcs.add(b);npcQueues();
  assert.equal(b.isRegistered(),true);assert.equal(b.getId(),core.NpcIdentifiers.GUARD);assert.ok(b.getHitpoints()>0);assert.equal(C.matches.has(a),false);assert.equal(a.getPrivateArea(),null);assert.equal(b.getPrivateArea(),null);
  magicTurns=true;ghastTurns=true;return{a,b,trace:mTrace(t,a,b)};
}
mTest('A baseline outside exact6910 native manual paid positive',async t=>{
  const f=await aOutside(t),cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(f.a,cost),hp=f.b.getHitpoints();tick();
  await wNpcSpell(f.a,f.b,'WIND_STRIKE');assert.equal(f.a.getCombat().getCastSpell(),core.CombatSpells.WIND_STRIKE);assert.equal(f.a.getCombat().getTarget(),f.b);
  for(let n=0;n<30&&!f.trace.commits.length;n++)tick();bStop(f);assert.equal(f.trace.commits.length,1);assert.equal(f.trace.hits.length,1);mPaid(f.a,cost,amounts);
  const hit=f.trace.hits[0];assert.equal(hit.getCombatMethod(),CombatFactory.MAGIC_COMBAT);assert.equal(hit.getSpell(),core.CombatSpells.WIND_STRIKE);assert.equal(hit.getSpellContext(),f.trace.commits[0].context);assert.ok(hit.getTotalDamage()>0);
  mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());
});
mTest('A baseline outside exact6910 native selector Attack repeats paid casts',async t=>{
  const f=await aOutside(t),hp=f.b.getHitpoints();await aSelect(f);const cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(f.a,cost);
  await ghastAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);
  for(let i=0;i<cost.length;i++)assert.equal(f.a.getInventory().getAmount(cost[i][0]),amounts[i]-paid*cost[i][1]);
  for(const hit of f.trace.hits){assert.equal(hit.getSpell(),core.CombatSpells.WIND_STRIKE);assert.ok(f.trace.commits.some(x=>x.context===hit.getSpellContext()));mLand(f,hit);}
  assert.ok(f.b.getHitpoints()<hp);assert.equal(f.trace.hits.length,paid);
});
mTest('A baseline plain staff Fire Wave paid player maximum20 positive',async t=>{
  const f=await eGame(t);await mEquip(f.a,core.ItemIdentifiers.STAFF);wSpellMetadata('FIRE_WAVE');assert.equal(f.a.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH],0);
  const cost=mCost(f.a,core.CombatSpells.FIRE_WAVE),amounts=mAmounts(f.a,cost),hp=f.b.getHitpoints(),hit=await mFire(f,'FIRE_WAVE');bStop(f);mPaid(f.a,cost,amounts);assert.equal(hit.getTotalDamage(),20);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-20);
});
mTest('A native Standard exact6910 Fire Wave commits real zero-percent maximum20',async t=>{
  const f=await aGame(t);assert.equal(f.game.rules.magic,1);assert.equal(f.game.phase,'combat');assert.notEqual(f.game.fighters.get(f.a),f.game.fighters.get(f.b));
  const hp=f.b.getHitpoints(),hit=await aFire(f);assert.equal(hit.getTotalDamage(),20);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-20);
});
for(const row of W_ELEMENTS)mTest('A exact6910 manual '+row.key+' actual payment queue HP and XP',async t=>{
  const f=await aGame(t),hp=f.b.getHitpoints(),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC),hit=await aFire(f,row.key);assert.ok(hit.getTotalDamage()>0);assert.equal(f.b.getHitpoints(),hp);
  mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());assert.ok(f.a.getSkillManager().getExperience(core.Skill.MAGIC)>xp);assert.equal(f.trace.commits.length,1);
});
for(const row of W_ELEMENTS)mTest('A exact6910 native selector '+row.slot+' '+row.key+' unstopped paid repeats',async t=>{
  const f=await aGame(t),hp=f.b.getHitpoints();await aSelect(f,row.key);const cost=mCost(f.a,core.CombatSpells[row.key]),amounts=mAmounts(f.a,cost);
  await cNativeAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);
  for(let i=0;i<cost.length;i++)assert.equal(f.a.getInventory().getAmount(cost[i][0]),amounts[i]-paid*cost[i][1]);
  for(const hit of f.trace.hits){assert.equal(hit.getCombatMethod(),CombatFactory.MAGIC_COMBAT);assert.equal(hit.getSpell(),core.CombatSpells[row.key]);assert.ok(f.trace.commits.some(x=>x.context===hit.getSpellContext()));mLand(f,hit);}
  assert.equal(f.trace.hits.length,paid);assert.equal(f.b.getHitpoints(),hp-f.trace.hits.reduce((n,h)=>n+h.getTotalDamage(),0));
});
for(const freezing of [0,1])for(const key of ['CONFUSE','BIND'])mTest('A manual '+key+' with Ignore'+freezing+' pays and preserves real effect policy',async t=>{
  const f=await aGame(t,{rules:{freezing}}),hp=f.b.getHitpoints(),stats=cStats(f.b),freeze=fTrace(t,f.b),hit=await aFire(f,key);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp);
  if(key==='CONFUSE')cAssertStats(f.b,stats,'ATTACK',5);
  else if(freezing)fNoNewEffects(freeze);else assert.ok(freeze.timers.some(x=>x[0]===core.TimerKey.FREEZE));
});
for(const key of ['SARADOMIN_STRIKE','CLAWS_OF_GUTHIX','FLAMES_OF_ZAMORAK','IBAN_BLAST','MAGIC_DART'])mTest('A exact6910 preserves canonical matching-staff refusal '+key,async t=>{
  gInstall();const f=await aGame(t);gUnlock(f.a);sLevels(f.a);await aNoPaid(f,key);
});
mTest('A native equipment maxMagic49 refuses current99 then admits actual max50',async t=>{
  const f=await eGame(t),sm=f.a.getSkillManager();sm.setMaxLevel(core.Skill.MAGIC,49);sm.setCurrentLevel(core.Skill.MAGIC,99,false);give(f.a,A_APPRENTICE,'A-max-gate');const before=resources(f.a);
  await nativeItem(f.a,A_APPRENTICE,'Wield');assert.deepEqual(resources(f.a),before);assert.notEqual(sItem(f.a).getId(),A_APPRENTICE);
  sm.setMaxLevel(core.Skill.MAGIC,50);await nativeItem(f.a,A_APPRENTICE,'Wield');aMetadata(f.a);
});
mTest('A equipped max99 currentMagic74 refuses Fire Wave then current75 recovers',async t=>{
  const f=await aGame(t),sm=f.a.getSkillManager();sm.setCurrentLevel(core.Skill.MAGIC,74,false);await aNoPaid(f);sm.setCurrentLevel(core.Skill.MAGIC,75,false);const hit=await aFire(f);assert.equal(hit.getTotalDamage(),20);mLand(f,hit);
});
for(const mode of [2,3,4])mTest('A exact6910 mode'+mode+' retains unsupported casting without payment',async t=>{
  const f=await aGame(t,{rules:{magic:mode}});await aNoPaid(f,mode===3?'BIND':'WIND_STRIKE');
});
for(const book of ['ANCIENT','ARCEUUS'])mTest('A other spellbook '+book+' does not admit a Normal hand cast',async t=>{
  const f=await aGame(t);f.a.setSpellbook(core.MagicSpellbook[book]);await aNoPaid(f);
});
mTest('A real LMS20556 remains excluded despite actual apprentice-wand alias and native eligibility',async t=>{
  const f=await aGame(t);assert.equal(core.CacheDefinitions.getObjId('br_apprentice_wand'),20556);assert.equal(core.ItemAliases.baseOf(20556),A_APPRENTICE);await mEquip(f.a,20556);assert.equal(f.a.getEquipment().hasStaffEquipped(),true);await aNoPaid(f,'WIND_STRIKE');
});
for(const id of [6911,18596])mTest('A unwearable note or placeholder '+id+' rejects native wield-slot input',async t=>{
  const f=await aGame(t);give(f.a,id,'A-unwearable');const before=resources(f.a),slot=f.a.getInventory().getItems().findIndex(item=>item?.getId()===id);
  assert.equal(core.CacheDefinitions.getItem(id).inventoryActions.includes('Wield'),false);
  const {MAIN_INVENTORY_WIDGET_UID}=require('../dist/net/protocol/ClientProtocol');
  // The real inventory operation used by a wand's Wield is unavailable on these
  // unwearable objects. Send that invalid native widget operation, not tEquip.
  await nativeButton(f.a,MAIN_INVENTORY_WIDGET_UID,3,slot,id);assert.deepEqual(resources(f.a),before);aMetadata(f.a);
});
for(const id of [565,554,556])mTest('A Fire Wave cannot substitute missing ordinary rune '+id,async t=>{
  const f=await aGame(t);f.a.getInventory().deleteNumber(id,f.a.getInventory().getAmount(id));await aNoPaid(f);
});
mTest('A actual Blood pouch source pays once with no negative inventory audit',async t=>{
  const f=await aGame(t),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');give(f.a,I.RUNE_POUCH,'A-pouch');Pouch.setSlots(f.a,[{id:565,amount:2},null,null,null]);f.a.getInventory().deleteNumber(565,f.a.getInventory().getAmount(565));
  const fire=f.a.getInventory().getAmount(554),air=f.a.getInventory().getAmount(556),hit=await aFire(f,'FIRE_WAVE',false);assert.equal(Pouch.slots(f.a)[0].amount,1);assert.equal(f.a.getInventory().getAmount(565),0);assert.equal(f.a.getInventory().getAmount(554),fire-7);assert.equal(f.a.getInventory().getAmount(556),air-5);mLand(f,hit);tick(10);
  Pouch.setSlots(f.a,[null,null,null,null]);await aNoPaid(f);
});
mTest('A actual fire tome supplies and spends its final page charge with real offhand accounting',async t=>{
  const f=await aGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I.TOME_OF_FIRE_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'fire',1);f.a.getInventory().deleteNumber(554,f.a.getInventory().getAmount(554));
  const blood=f.a.getInventory().getAmount(565),air=f.a.getInventory().getAmount(556),hit=await aFire(f,'FIRE_WAVE',false);assert.equal(book.Common.read(book.item).charges,0);assert.equal(f.a.getInventory().getAmount(554),0);assert.equal(f.a.getInventory().getAmount(565),blood-1);assert.equal(f.a.getInventory().getAmount(556),air-5);mLand(f,hit);tick(10);await aNoPaid(f);
});
mTest('A native gear switch observes actual attack-defence bonuses and zero damage percent with paid resumption',async t=>{
  const f=await aGame(t);const first=await aFire(f);assert.equal(first.getTotalDamage(),20);mLand(f,first);tick(10);
  await mEquip(f.a,core.ItemIdentifiers.STAFF);const staff=core.ItemDefinition.forId(core.ItemIdentifiers.STAFF).getBonuses();assert.equal(f.a.getBonusManager().getAttackBonus()[3],staff[3]);assert.equal(f.a.getBonusManager().getDefenceBonus()[3],staff[8]);assert.notDeepEqual([staff[3],staff[8]],[10,10]);assert.equal(f.a.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH],0);const cost=mCost(f.a,core.CombatSpells.FIRE_WAVE),amounts=mAmounts(f.a,cost),plain=await mFire(f,'FIRE_WAVE');bStop(f);mPaid(f.a,cost,amounts);assert.equal(plain.getTotalDamage(),20);mLand(f,plain);tick(10);
  await mEquip(f.a,A_APPRENTICE);aMetadata(f.a);const fresh=await aFire(f);assert.equal(fresh.getTotalDamage(),20);mLand(f,fresh);
});
mTest('A remembered elemental autocast refuses excluded LMS then real apprentice selection resumes paid repeats',async t=>{
  const f=await aGame(t);await aSelect(f,'FIRE_WAVE');await mEquip(f.a,20556);assert.equal(core.Autocasting.isActive(f.a),true);assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells.FIRE_WAVE);
  const before=resources(f.a),hp=f.b.getHitpoints();await cNativeAttack(f.a,f.b);tick(25);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
  await mEquip(f.a,A_APPRENTICE);await aSelect(f,'FIRE_WAVE');const cost=mCost(f.a,core.CombatSpells.FIRE_WAVE),amounts=mAmounts(f.a,cost);await cNativeAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);
  for(let i=0;i<cost.length;i++)assert.equal(f.a.getInventory().getAmount(cost[i][0]),amounts[i]-paid*cost[i][1]);for(const hit of f.trace.hits){assert.equal(hit.getTotalDamage(),20);mLand(f,hit);}assert.equal(f.b.getHitpoints(),hp-20*paid);
});
for(const boundary of ['victim-leave','caster-leave','finish','Forfeit'])mTest('A paid player queue '+boundary+' is discarded without resolution or refund',async t=>{
  const f=await aGame(t),hit=await aFire(f),paid=resources(f.a),hp=f.b.getHitpoints();assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);
  if(boundary==='Forfeit'){
    // Hold impact while the existing mapped checkpoint/ObjectAction dispatcher
    // reaches Forfeit; this is not encoded object-click or natural flight proof.
    const priorTurns=magicTurns;magicTurns=false;try{await nmForfeit(f.a,f.game);}finally{magicTurns=priorTurns;}
    assert.equal(C.matches.has(f.a),false);
  }else if(boundary==='finish'){f.game.finish(null);assert.equal(f.game.phase,'over');}
  else f.game.area.leave(boundary==='victim-leave'?f.b:f.a,false);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);tick(15);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(mInventory(f.a),paid.inventory);assert.deepEqual(contents(f.a.getEquipment()),paid.equipment);
  if(boundary==='caster-leave'||boundary==='Forfeit')assert.equal(f.b.getHitpoints(),hp);
});
mTest('A lethal native cast retains safe inventory and rejoin permits fresh paid cast',async t=>{
  const f=await aGame(t),kept=carriedItems(f.b);f.b.setHitpoints(1);const hit=await aFire(f),paid=resources(f.a);mLand(f,hit);
  for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();assert.equal(f.game.jailed.has(f.b),true);assert.deepEqual(carriedItems(f.b),kept);assert.deepEqual(mInventory(f.a),paid.inventory);assert.deepEqual(contents(f.a.getEquipment()),paid.equipment);
  await jailExit(f.b,f.game);assert.equal(f.game.fighters.has(f.b),true);tick(40);mPosition(f.game,f.a,f.b);const fresh=await aFire(f);assert.equal(fresh.getTotalDamage(),20);mLand(f,fresh);
});
mTest('A captured actual F2P equip gate refuses member wand and preserves basic-staff paid control',async t=>{
  const f=await eGame(t),gates=[],names=['onCanUseItem','onCanGainExperience','onCanSpawnNpc','onCanStockItem','onCustomEvent','onSpellDisabled','onPrayerDisabled','onCanTeleport','onObjectInteraction','onPlayerProcess'];
  const api={core,onCanEquip:h=>gates.push(h)};for(const name of names)api[name]=()=>{};
  const mode=t.mock.method(core.WorldDefinition,'isMembersWorld',()=>false);try{require('../plugins/modes/FreeToPlay.plugin').register(api);}finally{mode.mock.restore();}assert.equal(gates.length,1);
  const real=PM.emitCanEquip.bind(PM),seen=[];t.mock.method(PM,'emitCanEquip',(player,slot,item)=>{
    if(player===f.a){const event={player,slot,item,allow:null};gates[0](event);seen.push(event);if(event.allow===false)return false;}return real(player,slot,item);
  });
  await mEquip(f.a,core.ItemIdentifiers.STAFF);const cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(f.a,cost),hit=await mFire(f);bStop(f);mPaid(f.a,cost,amounts);mLand(f,hit);
  give(f.a,A_APPRENTICE,'A-members-equip');const before=resources(f.a);await nativeItem(f.a,A_APPRENTICE,'Wield');assert.deepEqual(resources(f.a),before);assert.equal(sItem(f.a).getId(),core.ItemIdentifiers.STAFF);assert.ok(seen.some(e=>e.item.getId()===A_APPRENTICE&&e.allow===false));
});
mTest('A staging refusal precedes ordinary paid recovery in actual combat phase',async t=>{
  const f=await aGame(t,{prepare:false});assert.equal(f.game.phase,'staging');await aNoPaid(f);completePreparation(f.game);mPosition(f.game,f.a,f.b);assert.equal(f.game.phase,'combat');const hit=await aFire(f);assert.equal(hit.getTotalDamage(),20);mLand(f,hit);
});
mTest('A departed outsider refusal has no new payment or impact',async t=>{
  const f=await aGame(t);f.game.area.leave(f.b,false);assert.equal(C.matches.has(f.b),false);await aNoPaid(f);
});
mTest('A unsupported real shield refuses while the explicit tome boundary stays separate',async t=>{
  const f=await aGame(t);await mEquip(f.a,core.ItemIdentifiers.RUNE_KITESHIELD,core.Equipment.SHIELD_SLOT);await aNoPaid(f);
});
for(const specialattacks of [1,2])mTest('A NoStaff or NoSpecial'+specialattacks+' retains ordinary native spell',async t=>{
  const f=await aGame(t,{rules:{specialattacks,melee:1,ranged:1}}),hit=await aFire(f);assert.equal(hit.getTotalDamage(),20);mLand(f,hit);
});

// BW: EXACT beginner wand 6908, Standard1 only. Existing canonical cache stats,
// equip gate, selectors, payment and delayed hit producers remain authoritative.
const BW_BEGINNER=6908;
function bwMetadata(p){
  assert.equal(core.ItemIdentifiers.BEGINNER_WAND,BW_BEGINNER);
  const type=core.CacheDefinitions.getItem(BW_BEGINNER),def=core.ItemDefinition.forId(BW_BEGINNER);
  assert.equal(type.name,'Beginner wand');assert.equal(type.isMembers,true);assert.equal(type.wearPos,core.Equipment.WEAPON_SLOT);
  assert.equal(type.params.get(3),5);assert.equal(type.params.get(8),5);assert.equal(type.params.has(299),false);
  assert.equal(def.hasCacheBonuses(),true);assert.equal(def.getBonuses()[3],5);assert.equal(def.getBonuses()[8],5);assert.equal(def.getBonuses()[12],0);
  assert.equal(def.getRequirements()[core.Skill.MAGIC.getIndex()],45);assert.equal(def.getWeaponInterface(),core.WeaponInterfaces.STAFF);
  if(p){
    assert.equal(sItem(p).getId(),BW_BEGINNER);assert.equal(p.getEquipment().hasStaffEquipped(),true);
    const offhand=p.getEquipment().get(core.Equipment.SHIELD_SLOT),bonus=offhand?.getId()>0?offhand.getDefinition().getBonuses():[];
    assert.equal(p.getBonusManager().getAttackBonus()[3],5+(bonus[3]??0));assert.equal(p.getBonusManager().getDefenceBonus()[3],5+(bonus[8]??0));assert.equal(p.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH],bonus[12]??0);
  }
}
async function bwGame(t,options={}){const f=await eGame(t,options);await mEquip(f.a,BW_BEGINNER);bwMetadata(f.a);f.b.setHitpoints(99);return f;}
async function bwFire(f,key='FIRE_WAVE',audit=true){
  bwMetadata(f.a);wSpellMetadata(key);const cost=mCost(f.a,core.CombatSpells[key]),amounts=mAmounts(f.a,cost),hit=await mFire(f,key);bStop(f);if(audit)mPaid(f.a,cost,amounts);return hit;
}
async function bwSelect(f,key='WIND_STRIKE'){
  bwMetadata(f.a);wSpellMetadata(key);const row=W_ELEMENTS.find(x=>x.key===key);assert.ok(row);
  await nativeButton(f.a,(593<<16)|23);assert.equal(f.a.getPacketSender().getVarp(664),-1,'actual native selector uses the existing Normal list');await nativeButton(f.a,(201<<16)|1,1,row.slot);
  assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells[key]);assert.equal(core.Autocasting.isActive(f.a),true);assert.equal(f.a.getCombat().getCastSpell(),null);
  assert.equal(f.a.getPacketSender().getVarbit(276),row.slot);assert.equal(f.a.getPacketSender().getVarp(core.CacheDefinitions.getVarpId('autocast_spell_obj')),wSpellMetadata(key).itemId);
}
async function bwNoPaid(f,key='FIRE_WAVE'){
  const before=resources(f.a),hp=f.b.getHitpoints(),commits=f.trace.commits.length,hits=f.trace.hits.length;
  await mSpell(f.a,f.b,key);tick(15);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,commits);assert.equal(f.trace.hits.length,hits);assert.equal(f.b.getHitpoints(),hp);
}
async function bwOutside(t){
  cInstall();const a=actor(true);ruleStats(a,99);a.setSpellbook(core.MagicSpellbook.NORMAL);mFund(a);await mEquip(a,BW_BEGINNER);bwMetadata(a);
  const at=new core.Location(3222,3218,0);core.RegionManager.loadMapFiles(at.getX(),at.getY());a.moveTo(at);a.setNeedsPlacement(false);AreaManager.process(a);
  const b=C.api.spawnNpc({id:core.NpcIdentifiers.GUARD,x:3223,y:3218,z:0,wanderRadius:0});fixtureNpcs.add(b);npcQueues();
  assert.equal(b.isRegistered(),true);assert.equal(b.getId(),core.NpcIdentifiers.GUARD);assert.ok(b.getHitpoints()>0);assert.equal(C.matches.has(a),false);assert.equal(a.getPrivateArea(),null);assert.equal(b.getPrivateArea(),null);
  magicTurns=true;ghastTurns=true;return{a,b,trace:mTrace(t,a,b)};
}
mTest('BW baseline outside exact6908 native manual paid positive',async t=>{
  const f=await bwOutside(t),cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(f.a,cost),hp=f.b.getHitpoints();tick();
  await wNpcSpell(f.a,f.b,'WIND_STRIKE');assert.equal(f.a.getCombat().getCastSpell(),core.CombatSpells.WIND_STRIKE);assert.equal(f.a.getCombat().getTarget(),f.b);
  for(let n=0;n<30&&!f.trace.commits.length;n++)tick();bStop(f);assert.equal(f.trace.commits.length,1);assert.equal(f.trace.hits.length,1);mPaid(f.a,cost,amounts);
  const hit=f.trace.hits[0];assert.equal(hit.getCombatMethod(),CombatFactory.MAGIC_COMBAT);assert.equal(hit.getSpell(),core.CombatSpells.WIND_STRIKE);assert.equal(hit.getSpellContext(),f.trace.commits[0].context);assert.ok(hit.getTotalDamage()>0);
  mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());
});
mTest('BW baseline outside exact6908 native selector Attack repeats paid casts',async t=>{
  const f=await bwOutside(t),hp=f.b.getHitpoints();await bwSelect(f);const cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(f.a,cost);
  await ghastAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);
  for(let i=0;i<cost.length;i++)assert.equal(f.a.getInventory().getAmount(cost[i][0]),amounts[i]-paid*cost[i][1]);
  for(const hit of f.trace.hits){assert.equal(hit.getSpell(),core.CombatSpells.WIND_STRIKE);assert.ok(f.trace.commits.some(x=>x.context===hit.getSpellContext()));mLand(f,hit);}
  assert.ok(f.b.getHitpoints()<hp);assert.equal(f.trace.hits.length,paid);
});
mTest('BW baseline plain staff Fire Wave paid player maximum20 positive',async t=>{
  const f=await eGame(t);await mEquip(f.a,core.ItemIdentifiers.STAFF);wSpellMetadata('FIRE_WAVE');assert.equal(f.a.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH],0);
  const cost=mCost(f.a,core.CombatSpells.FIRE_WAVE),amounts=mAmounts(f.a,cost),hp=f.b.getHitpoints(),hit=await mFire(f,'FIRE_WAVE');bStop(f);mPaid(f.a,cost,amounts);assert.equal(hit.getTotalDamage(),20);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-20);
});
mTest('BW native Standard exact6908 Fire Wave commits real zero-percent maximum20',async t=>{
  const f=await bwGame(t);assert.equal(f.game.rules.magic,1);assert.equal(f.game.phase,'combat');assert.notEqual(f.game.fighters.get(f.a),f.game.fighters.get(f.b));
  const hp=f.b.getHitpoints(),hit=await bwFire(f);assert.equal(hit.getTotalDamage(),20);assert.equal(f.b.getHitpoints(),hp);assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-20);
});
for(const row of W_ELEMENTS)mTest('BW exact6908 manual '+row.key+' actual payment queue HP and XP',async t=>{
  const f=await bwGame(t),hp=f.b.getHitpoints(),xp=f.a.getSkillManager().getExperience(core.Skill.MAGIC),hit=await bwFire(f,row.key);assert.ok(hit.getTotalDamage()>0);assert.equal(f.b.getHitpoints(),hp);
  mLand(f,hit);assert.equal(f.b.getHitpoints(),hp-hit.getTotalDamage());assert.ok(f.a.getSkillManager().getExperience(core.Skill.MAGIC)>xp);assert.equal(f.trace.commits.length,1);
});
for(const row of W_ELEMENTS)mTest('BW exact6908 native selector '+row.slot+' '+row.key+' unstopped paid repeats',async t=>{
  const f=await bwGame(t),hp=f.b.getHitpoints();await bwSelect(f,row.key);const cost=mCost(f.a,core.CombatSpells[row.key]),amounts=mAmounts(f.a,cost);
  await cNativeAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);
  for(let i=0;i<cost.length;i++)assert.equal(f.a.getInventory().getAmount(cost[i][0]),amounts[i]-paid*cost[i][1]);
  for(const hit of f.trace.hits){assert.equal(hit.getCombatMethod(),CombatFactory.MAGIC_COMBAT);assert.equal(hit.getSpell(),core.CombatSpells[row.key]);assert.ok(f.trace.commits.some(x=>x.context===hit.getSpellContext()));mLand(f,hit);}
  assert.equal(f.trace.hits.length,paid);assert.equal(f.b.getHitpoints(),hp-f.trace.hits.reduce((n,h)=>n+h.getTotalDamage(),0));
});
for(const freezing of [0,1])for(const key of ['CONFUSE','BIND'])mTest('BW manual '+key+' with Ignore'+freezing+' pays and preserves real effect policy',async t=>{
  const f=await bwGame(t,{rules:{freezing}}),hp=f.b.getHitpoints(),stats=cStats(f.b),freeze=fTrace(t,f.b),hit=await bwFire(f,key);mLand(f,hit);assert.equal(f.b.getHitpoints(),hp);
  if(key==='CONFUSE')cAssertStats(f.b,stats,'ATTACK',5);
  else if(freezing)fNoNewEffects(freeze);else assert.ok(freeze.timers.some(x=>x[0]===core.TimerKey.FREEZE));
});
for(const key of ['SARADOMIN_STRIKE','CLAWS_OF_GUTHIX','FLAMES_OF_ZAMORAK','IBAN_BLAST','MAGIC_DART'])mTest('BW exact6908 preserves canonical matching-staff refusal '+key,async t=>{
  gInstall();const f=await bwGame(t);gUnlock(f.a);sLevels(f.a);await bwNoPaid(f,key);
});
mTest('BW native equipment maxMagic44 refuses current99 then admits actual max45',async t=>{
  const f=await eGame(t),sm=f.a.getSkillManager();sm.setMaxLevel(core.Skill.MAGIC,44);sm.setCurrentLevel(core.Skill.MAGIC,99,false);give(f.a,BW_BEGINNER,'BW-max-gate');const before=resources(f.a);
  await nativeItem(f.a,BW_BEGINNER,'Wield');assert.deepEqual(resources(f.a),before);assert.notEqual(sItem(f.a).getId(),BW_BEGINNER);
  sm.setMaxLevel(core.Skill.MAGIC,45);await nativeItem(f.a,BW_BEGINNER,'Wield');bwMetadata(f.a);
});
mTest('BW equipped max99 currentMagic74 refuses Fire Wave then current75 recovers',async t=>{
  const f=await bwGame(t),sm=f.a.getSkillManager();sm.setCurrentLevel(core.Skill.MAGIC,74,false);await bwNoPaid(f);sm.setCurrentLevel(core.Skill.MAGIC,75,false);const hit=await bwFire(f);assert.equal(hit.getTotalDamage(),20);mLand(f,hit);
});
for(const mode of [2,3,4])mTest('BW exact6908 mode'+mode+' retains unsupported casting without payment',async t=>{
  const f=await bwGame(t,{rules:{magic:mode}});await bwNoPaid(f,mode===3?'BIND':'WIND_STRIKE');
});
for(const book of ['ANCIENT','ARCEUUS'])mTest('BW other spellbook '+book+' does not admit a Normal hand cast',async t=>{
  const f=await bwGame(t);f.a.setSpellbook(core.MagicSpellbook[book]);await bwNoPaid(f);
});
mTest('BW real LMS20553 remains excluded despite actual beginner-wand alias and native eligibility',async t=>{
  const f=await bwGame(t);assert.equal(core.CacheDefinitions.getObjId('br_beginner_wand'),20553);assert.equal(core.ItemAliases.baseOf(20553),BW_BEGINNER);await mEquip(f.a,20553);assert.equal(f.a.getEquipment().hasStaffEquipped(),true);await bwNoPaid(f,'WIND_STRIKE');
});
for(const id of [6909,18595])mTest('BW unwearable note or placeholder '+id+' rejects native wield-slot input',async t=>{
  const f=await bwGame(t);give(f.a,id,'BW-unwearable');const before=resources(f.a),slot=f.a.getInventory().getItems().findIndex(item=>item?.getId()===id);
  assert.equal(core.CacheDefinitions.getItem(id).inventoryActions.includes('Wield'),false);
  const {MAIN_INVENTORY_WIDGET_UID}=require('../dist/net/protocol/ClientProtocol');
  // The real inventory operation used by a wand's Wield is unavailable on these
  // unwearable objects. Send that invalid native widget operation, not tEquip.
  await nativeButton(f.a,MAIN_INVENTORY_WIDGET_UID,3,slot,id);assert.deepEqual(resources(f.a),before);bwMetadata(f.a);
});
for(const id of [565,554,556])mTest('BW Fire Wave cannot substitute missing ordinary rune '+id,async t=>{
  const f=await bwGame(t);f.a.getInventory().deleteNumber(id,f.a.getInventory().getAmount(id));await bwNoPaid(f);
});
mTest('BW actual Blood pouch source pays once with no negative inventory audit',async t=>{
  const f=await bwGame(t),I=core.ItemIdentifiers,Pouch=require('../plugins/items/runepouch/Common.RunePouch');give(f.a,I.RUNE_POUCH,'BW-pouch');Pouch.setSlots(f.a,[{id:565,amount:2},null,null,null]);f.a.getInventory().deleteNumber(565,f.a.getInventory().getAmount(565));
  const fire=f.a.getInventory().getAmount(554),air=f.a.getInventory().getAmount(556),hit=await bwFire(f,'FIRE_WAVE',false);assert.equal(Pouch.slots(f.a)[0].amount,1);assert.equal(f.a.getInventory().getAmount(565),0);assert.equal(f.a.getInventory().getAmount(554),fire-7);assert.equal(f.a.getInventory().getAmount(556),air-5);mLand(f,hit);tick(10);
  Pouch.setSlots(f.a,[null,null,null,null]);await bwNoPaid(f);
});
mTest('BW actual fire tome supplies and spends its final page charge with real offhand accounting',async t=>{
  const f=await bwGame(t),I=core.ItemIdentifiers;await mEquip(f.a,I.TOME_OF_FIRE_EMPTY_,core.Equipment.SHIELD_SLOT);const book=mTome(f.a,'fire',1);f.a.getInventory().deleteNumber(554,f.a.getInventory().getAmount(554));
  const blood=f.a.getInventory().getAmount(565),air=f.a.getInventory().getAmount(556),hit=await bwFire(f,'FIRE_WAVE',false);assert.equal(book.Common.read(book.item).charges,0);assert.equal(f.a.getInventory().getAmount(554),0);assert.equal(f.a.getInventory().getAmount(565),blood-1);assert.equal(f.a.getInventory().getAmount(556),air-5);mLand(f,hit);tick(10);await bwNoPaid(f);
});
mTest('BW native gear switch observes actual attack-defence bonuses and zero damage percent with paid resumption',async t=>{
  const f=await bwGame(t);const first=await bwFire(f);assert.equal(first.getTotalDamage(),20);mLand(f,first);tick(10);
  await mEquip(f.a,core.ItemIdentifiers.STAFF);const staff=core.ItemDefinition.forId(core.ItemIdentifiers.STAFF).getBonuses();assert.equal(f.a.getBonusManager().getAttackBonus()[3],staff[3]);assert.equal(f.a.getBonusManager().getDefenceBonus()[3],staff[8]);assert.notDeepEqual([staff[3],staff[8]],[5,5]);assert.equal(f.a.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH],0);const cost=mCost(f.a,core.CombatSpells.FIRE_WAVE),amounts=mAmounts(f.a,cost),plain=await mFire(f,'FIRE_WAVE');bStop(f);mPaid(f.a,cost,amounts);assert.equal(plain.getTotalDamage(),20);mLand(f,plain);tick(10);
  await mEquip(f.a,BW_BEGINNER);bwMetadata(f.a);const fresh=await bwFire(f);assert.equal(fresh.getTotalDamage(),20);mLand(f,fresh);
});
mTest('BW remembered elemental autocast refuses excluded LMS then real beginner selection resumes paid repeats',async t=>{
  const f=await bwGame(t);await bwSelect(f,'FIRE_WAVE');await mEquip(f.a,20553);assert.equal(core.Autocasting.isActive(f.a),true);assert.equal(f.a.getCombat().getAutocastSpell(),core.CombatSpells.FIRE_WAVE);
  const before=resources(f.a),hp=f.b.getHitpoints();await cNativeAttack(f.a,f.b);tick(25);bStop(f);assert.deepEqual(resources(f.a),before);assert.equal(f.trace.commits.length,0);assert.equal(f.trace.hits.length,0);assert.equal(f.b.getHitpoints(),hp);
  await mEquip(f.a,BW_BEGINNER);await bwSelect(f,'FIRE_WAVE');const cost=mCost(f.a,core.CombatSpells.FIRE_WAVE),amounts=mAmounts(f.a,cost);await cNativeAttack(f.a,f.b);for(let n=0;n<30&&f.trace.commits.length<2;n++)tick();bStop(f);const paid=f.trace.commits.length;assert.ok(paid>=2);
  for(let i=0;i<cost.length;i++)assert.equal(f.a.getInventory().getAmount(cost[i][0]),amounts[i]-paid*cost[i][1]);for(const hit of f.trace.hits){assert.equal(hit.getTotalDamage(),20);mLand(f,hit);}assert.equal(f.b.getHitpoints(),hp-20*paid);
});
for(const boundary of ['victim-leave','caster-leave','finish','Forfeit'])mTest('BW paid player queue '+boundary+' is discarded without resolution or refund',async t=>{
  const f=await bwGame(t),hit=await bwFire(f),paid=resources(f.a),hp=f.b.getHitpoints();assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),true);
  if(boundary==='Forfeit'){
    // Hold impact while the existing mapped checkpoint/ObjectAction dispatcher
    // reaches Forfeit; this is not encoded object-click or natural flight proof.
    const priorTurns=magicTurns;magicTurns=false;try{await nmForfeit(f.a,f.game);}finally{magicTurns=priorTurns;}
    assert.equal(C.matches.has(f.a),false);
  }else if(boundary==='finish'){f.game.finish(null);assert.equal(f.game.phase,'over');}
  else f.game.area.leave(boundary==='victim-leave'?f.b:f.a,false);
  assert.equal(f.b.getCombat().getHitQueue().hasPendingHit(hit),false);tick(15);assert.equal(f.trace.resolved.includes(hit),false);assert.deepEqual(mInventory(f.a),paid.inventory);assert.deepEqual(contents(f.a.getEquipment()),paid.equipment);
  if(boundary==='caster-leave'||boundary==='Forfeit')assert.equal(f.b.getHitpoints(),hp);
});
mTest('BW lethal native cast retains safe inventory and rejoin permits fresh paid cast',async t=>{
  const f=await bwGame(t),kept=carriedItems(f.b);f.b.setHitpoints(1);const hit=await bwFire(f),paid=resources(f.a);mLand(f,hit);
  for(let n=0;n<60&&!f.game.jailed.has(f.b);n++)tick();assert.equal(f.game.jailed.has(f.b),true);assert.deepEqual(carriedItems(f.b),kept);assert.deepEqual(mInventory(f.a),paid.inventory);assert.deepEqual(contents(f.a.getEquipment()),paid.equipment);
  await jailExit(f.b,f.game);assert.equal(f.game.fighters.has(f.b),true);tick(40);mPosition(f.game,f.a,f.b);const fresh=await bwFire(f);assert.equal(fresh.getTotalDamage(),20);mLand(f,fresh);
});
mTest('BW captured actual F2P equip gate refuses member wand and preserves basic-staff paid control',async t=>{
  const f=await eGame(t),gates=[],names=['onCanUseItem','onCanGainExperience','onCanSpawnNpc','onCanStockItem','onCustomEvent','onSpellDisabled','onPrayerDisabled','onCanTeleport','onObjectInteraction','onPlayerProcess'];
  const api={core,onCanEquip:h=>gates.push(h)};for(const name of names)api[name]=()=>{};
  const mode=t.mock.method(core.WorldDefinition,'isMembersWorld',()=>false);try{require('../plugins/modes/FreeToPlay.plugin').register(api);}finally{mode.mock.restore();}assert.equal(gates.length,1);
  const real=PM.emitCanEquip.bind(PM),seen=[];t.mock.method(PM,'emitCanEquip',(player,slot,item)=>{
    if(player===f.a){const event={player,slot,item,allow:null};gates[0](event);seen.push(event);if(event.allow===false)return false;}return real(player,slot,item);
  });
  await mEquip(f.a,core.ItemIdentifiers.STAFF);const cost=mCost(f.a,core.CombatSpells.WIND_STRIKE),amounts=mAmounts(f.a,cost),hit=await mFire(f);bStop(f);mPaid(f.a,cost,amounts);mLand(f,hit);
  give(f.a,BW_BEGINNER,'BW-members-equip');const before=resources(f.a);await nativeItem(f.a,BW_BEGINNER,'Wield');assert.deepEqual(resources(f.a),before);assert.equal(sItem(f.a).getId(),core.ItemIdentifiers.STAFF);assert.ok(seen.some(e=>e.item.getId()===BW_BEGINNER&&e.allow===false));
});
mTest('BW staging refusal precedes ordinary paid recovery in actual combat phase',async t=>{
  const f=await bwGame(t,{prepare:false});assert.equal(f.game.phase,'staging');await bwNoPaid(f);completePreparation(f.game);mPosition(f.game,f.a,f.b);assert.equal(f.game.phase,'combat');const hit=await bwFire(f);assert.equal(hit.getTotalDamage(),20);mLand(f,hit);
});
mTest('BW departed outsider refusal has no new payment or impact',async t=>{
  const f=await bwGame(t);f.game.area.leave(f.b,false);assert.equal(C.matches.has(f.b),false);await bwNoPaid(f);
});
mTest('BW unsupported real shield refuses while the explicit tome boundary stays separate',async t=>{
  const f=await bwGame(t);await mEquip(f.a,core.ItemIdentifiers.RUNE_KITESHIELD,core.Equipment.SHIELD_SLOT);await bwNoPaid(f);
});
for(const specialattacks of [1,2])mTest('BW NoStaff or NoSpecial'+specialattacks+' retains ordinary native spell',async t=>{
  const f=await bwGame(t,{rules:{specialattacks,melee:1,ranged:1}}),hit=await bwFire(f);assert.equal(hit.getTotalDamage(),20);mLand(f,hit);
});
