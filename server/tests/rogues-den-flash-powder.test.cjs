// From server/: yarn build && node --test tests/rogues-den-flash-powder.test.cjs
//
// UseItemPacketListener.itemOnNpc emits { player, target, ... }; the Rogues' Den flash powder
// handler used to read `npc`, so every normal use on a Rogue Guard was a no-op. This drives the
// real packet listener and the production plugin registration, and checks the handler reads the
// event shape the listener actually sends.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const ROOT = path.resolve(__dirname, '..');
const FLASH_POWDER = 5559;
const ROGUE_GUARD = 3190;
const BRIAN = 3189;
const GUARD_TILE = [2958, 5003, 1];

let Player;
let NPC;
let Location;
let World;
let UseItemPacketListener;
let PluginManager;
let seen;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();

  ({ Player } = require('../dist/game/entity/impl/player/Player'));
  ({ NPC } = require('../dist/game/entity/impl/npc/NPC'));
  ({ Location } = require('../dist/game/model/Location'));
  ({ World } = require('../dist/game/World'));
  ({ UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener'));
  ({ PluginManager } = require('../dist/plugins/PluginManager'));

  // Production registration: the same attach path a running server uses.
  require('../plugins/minigames/RoguesDen.plugin').register(
    PluginManager.createApi('RoguesDenFlashPowderRegression'),
  );

  // A later hook only sees the event when the Rogues' Den handler did not mark it handled.
  seen = [];
  PluginManager.createApi('RoguesDenFlashPowderProbe')
    .onItemOnNpc((event) => { seen.push(event); }, { noted: false });
});

function account(x, y, z) {
  const messages = [];
  const sender = new Proxy({}, {
    get: (target, key) => (key === 'sendMessage'
      ? (message) => messages.push(String(message))
      : () => sender),
  });
  const player = new Player(null);
  player.getPacketSender = () => sender;
  player.moveTo(new Location(x, y, z));
  player.setNeedsPlacement(false);
  player.getInventory().adds(FLASH_POWDER, 1);
  return { player, messages };
}

function spawnNpc(id, [x, y, z]) {
  const npc = new NPC(id, new Location(x, y, z));
  assert.equal(World.getNpcs().add(npc, true), true, `real NPC ${id} registered`);
  return npc;
}

function useOnNpc(player, npc) {
  UseItemPacketListener.itemOnNpc(player, 149, npc.getIndex(), FLASH_POWDER, 0);
}

test('the real item-on-NPC packet blinds a Rogue Guard with flash powder', () => {
  const { player, messages } = account(...GUARD_TILE);
  const guard = spawnNpc(ROGUE_GUARD, GUARD_TILE);
  try {
    seen.length = 0;
    useOnNpc(player, guard);

    assert.equal(player.getInventory().getAmount(FLASH_POWDER), 0, 'one dose is consumed');
    assert.equal(guard.__roguesDenStunnedUntil, 10, 'the guard is blinded for ten ticks');
    assert.deepEqual(messages, [
      'You throw the flash powder at the rogue guard.',
      'The rogue guard is blinded!',
    ]);
    assert.equal(seen.length, 0, 'the handler marks the event handled, so no later hook runs');
  } finally {
    World.getNpcs().remove(guard);
  }
});

test('using the powder on a non-guard NPC is not consumed and stays unhandled', () => {
  const { player } = account(...GUARD_TILE);
  const brian = spawnNpc(BRIAN, GUARD_TILE);
  try {
    seen.length = 0;
    useOnNpc(player, brian);

    assert.equal(player.getInventory().getAmount(FLASH_POWDER), 1, 'the powder is not spent');
    assert.equal(brian.__roguesDenStunnedUntil, undefined, 'a non-guard is never blinded');
    assert.equal(seen.length, 1, 'the event reached later hooks');
    assert.equal(seen[0].target, brian, 'the handler sees the listened NPC as event.target');
    assert.equal(seen[0].handled, false, 'the event is left unhandled');
  } finally {
    World.getNpcs().remove(brian);
  }
});
