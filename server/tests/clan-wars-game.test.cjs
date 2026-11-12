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

function actor() {
  const transport = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(transport));
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
async function negotiate(a, b, cap = null, mode = 0) {
  await challenge(a, b); await challenge(b, a);
  assert.equal(a.getInterfaceId(), C.group('clanwars_setup'));
  if (cap !== null) { await click(a, 'clanwars_setup:dropdown_playercap', cap + 1); tick(9); }
  if (mode) {
    await click(a, 'clanwars_setup:wincondition', mode * 3);
    assert.equal(C.negotiations.get(a).rules.wincondition, mode, 'native mode selection must reach the server offer');
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
async function join(p) {
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
  await click(p, 'clanwars_confirm:button');
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
async function lethalMelee(killer, victim, game) {
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
  tick();
}
async function jailExit(player, game) {
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
  tick(15);
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
  for (const forged of [1, 2, 27, 48, 69, 65535]) {
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
