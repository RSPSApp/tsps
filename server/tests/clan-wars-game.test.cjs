'use strict';
// Real channel membership, native packets, players, containers, map and instance owners.
// Only the transport is inert; the game clock advances deterministically.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, afterEach, test } = require('node:test');
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
const errors = [];
const originalError = console.error;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3128, 3629);
  require('../plugins/interface/FriendsList.plugin').register(PM.createApi('ClanWarsSocialTest'));
  require('../plugins/minigames/DuelArena.plugin').register(PM.createApi('ClanWarsDuelTest'));
  require('../plugins/combat/PvpStatistics.plugin').register(PM.createApi('ClanWarsPvpStatsTest'));
  require('../plugins/combat/KillStreaks.plugin').register(PM.createApi('ClanWarsKillStreaksTest'));
  require('../plugins/minigames/ClanWars.plugin').register(PM.createApi('ClanWarsTest'));
  Presets.register(PM.createApi('ClanWarsPresetsTest'));
  require('../plugins/items/Food.plugin').register(PM.createApi('ClanWarsFoodTest'));
  require('../plugins/items/Potions.plugin').register(PM.createApi('ClanWarsPotionsTest'));
  require('../plugins/items/PhoenixNecklace.plugin').register(PM.createApi('ClanWarsPhoenixTest'));
  for (const name of ['DragonDagger','DragonBattleaxe']) {
    require(`../plugins/combat/specials/${name}.SpecialAttack`)(PM.createApi('ClanWarsSpecialTest'));
  }
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
});
afterEach(() => {
  Negotiation.shutdown();
  Match.shutdown();
  for (const p of actors.splice(0)) {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    if (p.getArea()) p.getArea().leave(p, true);
    core.World.getPlayers().remove(p);
  }
  assert.deepEqual(errors.splice(0), [], 'production hooks must not swallow errors');
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
      core.World.processCycle++; core.TaskManager.process();
      for (const p of actors) {
        p.connection.processTurnPackets(); AreaManager.process(p);
        core.TaskManager.processWalkTo(p.getIndex()); p.getMovementQueue().process();
      }
      core.World.rebuildUpdateBuckets();
      for (const p of actors) core.World.updateLocalPlayers(p);
      for (const p of actors) p.getSession().flush(core.World.processCycle);
      for (const p of actors) p.resetUpdating();
      continue;
    }
    core.World.processCycle++;
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
async function click(p, name, slot = 0xffff) {
  const frame = Buffer.alloc(9); frame[0] = 23;
  frame.writeInt32BE(C.uid(name), 1);
  frame.writeUInt16BE(slot, 5); frame.writeUInt16BE(0xffff, 7);
  await wire(p, frame);
}
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
async function negotiate(a, b, cap = null, mode = 0, restrictions = null) {
  await challenge(a, b); await challenge(b, a);
  assert.equal(a.getInterfaceId(), C.group('clanwars_setup'));
  if (cap !== null) { await click(a, 'clanwars_setup:dropdown_playercap', cap + 1); tick(9); }
  if (mode) {
    await click(a, 'clanwars_setup:wincondition', mode * 3);
    assert.equal(C.negotiations.get(a).rules.wincondition, mode, 'native mode selection must reach the server offer');
    tick(9);
  }
  for (const [key,value] of Object.entries(restrictions ?? {})) {
    await click(a, `clanwars_setup:dropdown_${key}`, value + 1);
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
async function join(p, confirm = true) {
  // The actual cache portal goes through production object dispatch; no synthetic loc.
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const id = core.CacheDefinitions.getLocId('clanwars_portal');
  const objects = [...MapObjects.mapObjects.values()].flat();
  const portal = objects.find(o => o.getDefinition()?.getName() === 'Challenge portal'
    && o.getLocation().getX() >= C.LOBBY.minX && o.getLocation().getX() <= C.LOBBY.maxX
    && o.getLocation().getY() >= C.LOBBY.minY && o.getLocation().getY() <= C.LOBBY.maxY);
  assert.ok(portal, `actual challenge portal exists (gameval lookup ${id})`);
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
async function lethalMelee(killer, victim, game, runDeathTick = true) {
  const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
  const { HitQueue } = require('../dist/game/content/combat/hit/HitQueue');
  killer.moveTo(game.area.at([3293, 4955, 0]));
  victim.moveTo(game.area.at([3294, 4955, 0]));
  for (const p of [killer, victim]) { p.setNeedsPlacement(false); p.resetUpdating(); AreaManager.process(p); }
  assert.equal(CombatFactory.canAttackByPolicy(killer, victim, CombatFactory.MELEE_COMBAT), CanAttackResponse.CAN_ATTACK);
  const frame = Buffer.alloc(4); frame[0] = 44; frame[1] = 128; frame.writeUInt16BE(victim.getIndex(), 2);
  const decoded = decodeClientPackets(frame);
  assert.equal(decoded[0].index, victim.getIndex());
  assert.equal(decoded[0].option, 1);
  await wire(killer, frame);
  assert.equal(killer.getCombat().getTarget(), victim, 'native Attack owns the opposing target');
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
  for (const forged of [1, 2, 27, 45, 63, 69, 65535]) {
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
  for (const departure of ['channel leave', 'disconnect hook', 'logout hook', 'forfeit handler']) {
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
      if (mode && ['channel leave', 'logout hook'].includes(departure)) expected[1 - side] = 1;
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
    await click(a,'clanwars_setup:dropdown_specialattacks',2);
    assert.equal(session.rules.specialattacks,key==='specialattacks'||membership?2:0,'deferred Staff-only choice cannot change terms');
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
  await endRuleGame(game,a,b); await nativeItem(a,I.APPLE_PIE,'Eat');
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
function channelFrame(action, name='') {
  // ClientBinaryEncoder.encodeFriendsChatAction: production extended social packet,
  // not an OSRS-native social opcode. Ordinary native widgets/locs remain separate.
  const { ClientPacketId }=require('../dist/net/protocol/ClientPackets');
  const text=Buffer.from(name+'\0','latin1'), frame=Buffer.alloc(text.length+4);
  frame[0]=ClientPacketId.FRIENDS_CHAT_ACTION; frame[1]=text.length+2;
  frame[2]=action==='leave'?1:0; text.copy(frame,3); frame[frame.length-1]=0;
  return frame;
}
function jailPortalFrame(portal, op) {
  const { ClientPacketId }=require('../dist/net/protocol/NativeClientPackets');
  assert.equal(op,1,'the active mapped jail portal exposes Exit as its first native option');
  const at=portal.getLocation(),id=portal.getId(),frame=Buffer.alloc(8);
  frame[0]=ClientPacketId.OPLOC1;
  frame[1]=at.getX()>>8; frame[2]=(at.getX()+128)&255;
  frame.writeUInt16LE(at.getY(),3); frame[5]=0;
  frame[6]=(id+128)&255; frame[7]=id>>8;
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
    const frame=jailPortalFrame(portal,op),remaining=completed+98-C.now();
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
