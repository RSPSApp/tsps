// Run after `yarn build`: node --test tests/mcp-set-npc-hitpoints.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Location } = require('../dist/game/model/Location');
const { World } = require('../dist/game/World');
const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
const { PluginManager } = require('../dist/plugins/PluginManager');
const z = require('zod');

const core = PluginManager.getCoreApi();
const players = new Map();
const tools = {};

require('../plugins/agent/mcp/Testing.AgentMcp')({
  core,
  z,
  tool: (name, _description, _schema, handler) => { tools[name] = handler; },
  player: z.string(),
  find: (username) => {
    const player = players.get(username);
    if (!player) throw new Error(`${username} is not online`);
    return player;
  },
  send: () => ({}),
  status: (player) => ({ x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ() }),
  sleepTicks: async () => {},
  takeMessages: () => [],
  MAX_WAIT_TICKS: 50,
});

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

test('set_npc_hitpoints rejects invalid targets/HP and lowers a real NPC for the final player hit', () => {
  const player = new Player(null);
  player.getPacketSender = () => new Proxy({}, { get: () => () => {} });
  player.moveTo(new Location(2270, 4316, 0));
  player.setNeedsPlacement(false);
  player.setRegistered(true);
  players.set('qa', player);

  const npc = new NPC(797, new Location(2269, 4316, 0));
  assert.equal(World.getNpcs().add(npc, true), true, 'real NPC registered');
  const setHp = tools.set_npc_hitpoints;
  try {
    assert.throws(() => setHp({ player: 'qa', npcIndex: 999999, hitpoints: 1 }), /No NPC at index/);
    assert.throws(() => setHp({ player: 'qa', npcIndex: npc.getIndex(), hitpoints: 0 }), /from 1 to 130/);
    assert.throws(() => setHp({ player: 'qa', npcIndex: npc.getIndex(), hitpoints: 131 }), /from 1 to 130/);

    const lowered = setHp({ player: 'qa', npcIndex: npc.getIndex(), hitpoints: 60 });
    assert.equal(lowered.before, 130);
    assert.equal(lowered.hitpoints, 60);
    assert.equal(npc.getHitpoints(), 60, 'positive path lowers the real NPC');
    assert.throws(() => setHp({ player: 'qa', npcIndex: npc.getIndex(), hitpoints: 60 }), /must reduce/);

    player.setArea({ getObjects: () => [] });
    assert.throws(() => setHp({ player: 'qa', npcIndex: npc.getIndex(), hitpoints: 50 }), /private area/);
    player.setArea(null);

    const otherOwner = new Player(null);
    npc.setOwner(otherOwner);
    assert.throws(() => setHp({ player: 'qa', npcIndex: npc.getIndex(), hitpoints: 50 }), /Cannot target NPC/);
    npc.setOwner(null);

    const lastHit = setHp({ player: 'qa', npcIndex: npc.getIndex(), hitpoints: 1 });
    assert.equal(lastHit.hitpoints, 1);
    assert.equal(npc.getHitpoints(), 1, 'never sets an anonymous 0-HP death');
    assert.notEqual(npc.isDyingFunction?.(), true, 'the NPC stays alive for the real killing hit');
  } finally {
    World.getNpcs().remove(npc);
  }
});

test('NPC regeneration stays integer and a legacy fractional HP dies to a normal hit', () => {
  const player = new Player(null);
  player.setRegistered(true);
  const npc = new NPC(797, new Location(2270, 4316, 0));
  npc.setMaxHitpoints(5);
  npc.setHitpoints(1);
  assert.equal(World.getNpcs().add(npc, true), true, 'real NPC registered');
  try {
    // A fresh NPC's last attack is elapsed, so process() takes the regeneration path.
    npc.process();
    assert.equal(npc.getHitpoints(), 2, '10% of max 5 regenerates as one whole hitpoint');
    assert.equal(Number.isInteger(npc.getHitpoints()), true, 'regeneration never stores a fraction');

    // Legacy saves/runtime could still hold 0.5 HP. A normal integer hit must kill it and
    // keep the player as the killer, not clamp the damage to a fractional 0.5.
    npc.setHitpoints(0.5);
    const killingHit = new HitDamage(1, HitMask.RED).setSource(player);
    npc.getCombat().getHitQueue().addPendingDamage([killingHit]);
    // The regeneration process above already drained this cycle; land the hit on the next one.
    npc.getCombat().getHitQueue().process(World.getProcessCycle() + 1);
    assert.equal(npc.getHitpoints(), 0, 'a normal 1-damage hit finishes a legacy 0.5 HP actor');
    assert.equal(npc.isDyingFunction?.(), true, 'the real NPC death path ran');
    assert.equal(npc.getCombat().getHitQueue().getLastAppliedHit(), killingHit);
    assert.equal(killingHit.getSource(), player, 'the killer is the real hit source');
  } finally {
    World.getNpcs().remove(npc);
  }
});
