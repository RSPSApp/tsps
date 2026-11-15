// From server/: node --test tests/respawn-points.test.cjs (after yarn build).
//
// Respawn points (Wiki: Spawning#Respawn_point) through the real plugin API: the NPCs'
// generated transcripts set them (conditions, confirming lines and actions, requirements and the
// 5 million coin unlocks), a death nothing else placed goes there, and the items that send a
// player to their respawn point ask "respawn-point:location". Real Player and Inventory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const plugin = require('../plugins/world/RespawnPoints.plugin');
const T = plugin._test;
const core = PM.getCoreApi();
const done = new Set();
const challengers = new Set();
let members = true;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const stubs = PM.createApi('RespawnPointsStubs');
  stubs.onCustomEvent('quest:is-complete', (q) => { if (done.has(`${q.key}:${q.player.getUsername()}`)) q.complete = true; });
  stubs.onCustomEvent('colosseum:has-rank', (q) => { if (q.rank === 'Challenger' && challengers.has(q.player)) q.reached = true; });
  plugin.register(PM.createApi('RespawnPoints'));
  core.WorldDefinition.isMembersWorld = () => members;
});

let serial = 0;
function actor(coins = 0) {
  const player = new Player(null);
  player.setUsername(`respawn${++serial}`);
  player.setRegistered(true);
  player.getSession = () => ({ sendClientPacket: () => true, write() {}, isConnected: () => true });
  if (coins) player.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, coins), false);
  return player;
}
const npc = (name) => ({ getName: () => name, getId: () => 1 });
const ask = (player, name, text) => PM.emitNpcDialogueCondition({ player, definition: npc(name), npcId: 1, pages: [], text });
function line(player, name, text, key = 'npc') {
  const request = { player, definition: npc(name), text, step: { [key]: text } };
  PM.emitCustomEvent('npc-dialogue:line', request);
  return request;
}
function action(player, name, text) {
  const request = { player, definition: npc(name), action: 'unknown', text, handled: false };
  PM.emitCustomEvent('npc-dialogue:action', request);
  return request;
}
function died(player) {
  const event = { player, killer: null, handled: false };
  PM.emitCustomEvent('player:respawn', event);
  return event;
}
const at = (player) => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
const where = (player) => { const q = { player, location: null }; PM.emitCustomEvent('respawn-point:location', q); return [q.location.getX(), q.location.getY(), q.location.getZ()]; };
const spawn = () => [core.GameConstants.DEFAULT_LOCATION.getX(), core.GameConstants.DEFAULT_LOCATION.getY(), core.GameConstants.DEFAULT_LOCATION.getZ()];
const transcripts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'definitions', 'npc-dialogues.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'world', 'data', 'respawn-points.json'), 'utf8'));

test('every setter line and action is still in its NPC transcript', () => {
  for (const [name, setters] of Object.entries(data.setters)) {
    const text = JSON.stringify(transcripts[name]);
    for (const setter of setters) assert.ok(text.includes(JSON.stringify(setter.line ?? setter.action)), `${name}: ${setter.line ?? setter.action}`);
  }
  const ferox = Object.keys(transcripts.Ferox.variants);
  assert.ok(ferox.includes(data.feroxVariants.paid) && ferox.includes(data.feroxVariants.unpaid));
});

test('without a point the player respawns where they always did, and the items ask the same', () => {
  const player = actor();
  const event = died(player);
  assert.equal(event.handled, false, "core's own respawn (the world's spawn) stands");
  assert.deepEqual(where(player), spawn());
});

test("Crefydd's Prifddinas: only after Song of the Elves; his conditions follow it; a death goes there; back to Lumbridge", () => {
  const player = actor();
  assert.equal(ask(player, 'Crefydd', "If the player's respawn point is not in Prifddinas:"), true);
  assert.equal(ask(player, 'Crefydd', "If the player's respawn point is in Prifddinas:"), false);
  line(player, 'Crefydd', 'Then it shall be so. From now on, you will respawn in Prifddinas.').before();
  assert.equal(T.pointOf(player), 'lumbridge', 'not before the quest');
  done.add(`song_of_the_elves:${player.getUsername()}`);
  const request = line(player, 'Crefydd', 'Then it shall be so. From now on, you will respawn in Prifddinas.');
  assert.equal(T.pointOf(player), 'lumbridge', 'not while the conversation is only being built');
  request.before();
  assert.equal(T.pointOf(player), 'prifddinas');
  assert.equal(ask(player, 'Crefydd', "If the player's respawn point is in Prifddinas:"), true);
  assert.equal(ask(player, 'Sir Tiffy Cashien', "If the player's respawn point is Falador:"), false);
  assert.equal(ask(player, 'Bob', "If the player's respawn point is in Prifddinas:"), null, 'another NPC is not ours');
  const event = died(player);
  assert.equal(event.handled, true);
  assert.deepEqual(at(player), [3263, 6066, 0]);
  assert.deepEqual(where(player), [3263, 6066, 0]);
  members = false;
  assert.deepEqual(where(player), spawn(), 'a members point is Lumbridge on a free world');
  members = true;
  line(player, 'Crefydd', 'Then it shall be so. From now on, you will respawn in Lumbridge.').before();
  assert.equal(T.pointOf(player), 'lumbridge');
  assert.equal(died(player).handled, false);
});

test("Sir Tiffy's, Asteros's and Gloria's points need their quest or rank", () => {
  const player = actor();
  line(player, 'Sir Tiffy Cashien', 'Yes, I want to respawn in Falador.', 'player').before();
  assert.equal(T.pointOf(player), 'lumbridge');
  done.add(`recruitment_drive:${player.getUsername()}`);
  line(player, 'Sir Tiffy Cashien', 'Yes, I want to respawn in Falador.', 'player').before();
  assert.equal(T.pointOf(player), 'falador');
  assert.equal(ask(player, 'Asteros Arceuus', 'If the respawn point changes to Kourend Castle:'), true);
  assert.equal(ask(player, 'Asteros Arceuus', 'If the respawn point changes to Lumbridge:'), true, 'Falador is not Lumbridge: his revert line');
  done.add(`a_kingdom_divided:${player.getUsername()}`);
  line(player, 'Asteros Arceuus', 'Very well. From now on, you will respawn at Kourend Castle.').before();
  assert.equal(T.pointOf(player), 'kourend');
  assert.equal(ask(player, 'Asteros Arceuus', "If player's current respawn point is Kourend Castle:"), true);
  assert.equal(ask(player, 'Asteros Arceuus', 'If the respawn point changes to Kourend Castle:'), false);
  assert.equal(line(player, 'Gloria', 'Thanks.', 'player').before, undefined, "Gloria's 'Thanks.' reverts only her own point");
  line(player, 'Gloria', 'Anytime, [rank].').before();
  assert.equal(T.pointOf(player), 'kourend', 'not below Challenger');
  challengers.add(player);
  line(player, 'Gloria', 'Anytime, [rank].').before();
  assert.equal(T.pointOf(player), 'fortis');
  assert.equal(ask(player, 'Gloria', "If the player's current respawn point is Civitas illa Fortis:"), true);
  line(player, 'Gloria', 'Thanks.', 'player').before();
  assert.equal(T.pointOf(player), 'lumbridge');
});

test("Krystilia's and Ferox's points cost 5 million coins once, from the inventory", () => {
  const COINS = core.ItemIdentifiers.COINS;
  const poor = actor(4_999_999);
  assert.equal(ask(poor, 'Krystilia', 'If player has 5 million coins:'), false);
  assert.equal(ask(poor, 'Krystilia', 'If player does not have 5 million coins:'), true);
  const forged = action(poor, 'Krystilia', 'Player pays 5 million coins and their respawn point is set to Edgeville.');
  assert.equal(forged.end, true);
  assert.equal(poor.getInventory().getAmount(COINS), 4_999_999);
  assert.equal(T.pointOf(poor), 'lumbridge');
  assert.equal(action(poor, 'Krystilia', "Player's respawn point is set to Edgeville.").handled, true);
  assert.equal(T.pointOf(poor), 'lumbridge', 'the free switch needs the unlock');

  const player = actor(10_000_001);
  assert.equal(ask(player, 'Krystilia', 'If the player has not unlocked the Edgeville spawn:'), true);
  assert.equal(ask(player, 'Krystilia', 'If the player is on a Shattered Relics League world:'), false);
  action(player, 'Krystilia', 'Player pays 5 million coins and their respawn point is set to Edgeville.');
  assert.equal(player.getInventory().getAmount(COINS), 5_000_001);
  assert.equal(T.pointOf(player), 'edgeville');
  assert.equal(ask(player, 'Krystilia', 'If the player has unlocked the Edgeville spawn:'), true);
  assert.equal(ask(player, 'Krystilia', "If the player's respawn is in Edgeville:"), true);
  members = false;
  died(player);
  assert.deepEqual(at(player), [3094, 3469, 0], 'Edgeville works on free worlds too');
  members = true;

  assert.equal(PM.emitNpcDialogueVariant({ player, definition: npc('Ferox'), npcId: 1, pages: [] }), data.feroxVariants.unpaid);
  assert.equal(ask(player, 'Ferox', 'With at least five million coins in the inventory:'), true);
  line(player, 'Ferox', 'Yes, switch my respawn to the Enclave.', 'player').before();
  assert.equal(T.pointOf(player), 'edgeville', 'not before paying');
  action(player, 'Ferox', '5 million coins');
  assert.equal(player.getInventory().getAmount(COINS), 1);
  assert.equal(T.pointOf(player), 'ferox');
  assert.equal(PM.emitNpcDialogueVariant({ player, definition: npc('Ferox'), npcId: 1, pages: [] }), data.feroxVariants.paid);
  assert.equal(ask(player, 'Ferox', "If the player's current respawn point is the Ferox Enclave:"), true);
  assert.equal(ask(player, 'Krystilia', "If the player's respawn is in Ferox Enclave:"), true);
  action(player, 'Krystilia', "Player's respawn point is set to Edgeville.");
  assert.equal(T.pointOf(player), 'edgeville', 'set back for free, no second fee');
  assert.equal(player.getInventory().getAmount(COINS), 1);
  line(player, 'Ferox', 'Yes, switch my respawn to the Enclave.', 'player').before();
  assert.equal(T.pointOf(player), 'ferox');
  line(player, 'Ferox', 'Yes, switch my respawn to Lumbridge.', 'player').before();
  assert.equal(T.pointOf(player), 'lumbridge');
});

test('a death another plugin placed, and bots, are left alone', () => {
  const player = actor(5_000_000);
  action(player, 'Krystilia', 'Player pays 5 million coins and their respawn point is set to Edgeville.');
  player.moveTo(new core.Location(3200, 3200, 0));
  const taken = { player, killer: null, handled: true };
  PM.emitCustomEvent('player:respawn', taken);
  assert.deepEqual(at(player), [3200, 3200, 0]);
  player.isPlayerBot = () => true;
  assert.equal(died(player).handled, false);
});
