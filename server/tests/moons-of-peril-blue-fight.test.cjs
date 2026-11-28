// Run after `yarn build`: node --test tests/moons-of-peril-blue-fight.test.cjs
// The Blue Moon fight as rsprox 1693/1104/3276 show it (#6917): the chip on each hit, the hidden Moon and
// emptying block bar of Weapon Freeze, when the ice floor strikes, Frost Storm's chunk and walk-through
// storms, projectile heights, the exit stairs' range and the death stand-in's facing. Real engine: every
// plugin loaded, a real Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");

let core, Blue, Cycle, Common, Attacks, Kill, Fight, index = 8950;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  Blue = require("../plugins/bosses/moonsofperil/BlueMoon.MoonsOfPeril")._test;
  Cycle = require("../plugins/bosses/moonsofperil/Cycle.MoonsOfPeril");
  Common = require("../plugins/bosses/moonsofperil/Common.MoonsOfPeril");
  Attacks = require("../plugins/bosses/moonsofperil/Attacks.MoonsOfPeril");
  Kill = require("../plugins/bosses/moonsofperil/Kill.MoonsOfPeril");
  ({ Fight } = require("../plugins/bosses/moonsofperil/Fight.MoonsOfPeril"));
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** A fighter in the Blue Moon's arena, standing at an offset from the Moon. */
function enter(t, offset = [0, -2]) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername("blue" + player.getIndex()); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(Common.tileAt("blue", offset));
  const varbits = [];
  const sender = player.getPacketSender();
  const original = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value) => { varbits.push([id, value]); return original(id, value); });
  const arena = Cycle.arenaOf("blue");
  // The arena's own loop would run specials and attacks of its own under the test.
  t.mock.method(arena, "process", () => {});
  const fight = new Fight(arena, player);
  arena.fights.set(player, fight);
  t.after(() => { fight.stopSpecial(); arena.fights.delete(player); arena.setHidden(false); player.setRegistered(false); });
  const last = (name) => varbits.filter(([id]) => id === Common.data.varbits[name]).at(-1)?.[1];
  return { player, arena, fight, last };
}

test("the Moon loses a hundredth of its health on each of an attack's first three ticks", (t) => {
  const { arena, fight } = enter(t);
  fight.hp = 449;
  const seen = [];
  Attacks.attack(arena);
  seen.push(fight.hp);
  for (let i = 0; i < 3; i++) { core.TaskManager.process(); seen.push(fight.hp); }
  assert.deepEqual(seen, [445, 441, 437, 437]);
});

test("Weapon Freeze hides the Moon behind its stand-in until it leaves", (t) => {
  const { player, arena, fight, last } = enter(t);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.DRAGON_DAGGER, 1));
  fight.startSpecial(Blue.freeze, 0);
  const hidden = [];
  for (let offset = 0; offset <= 8; offset++) {
    Blue.freeze.shared(arena, offset);
    fight.tickSpecial(Blue.freeze, offset);
    hidden.push(last("hideNpc") ?? 0);
  }
  assert.deepEqual(hidden, [0, 0, 1, 1, 1, 1, 1, 1, 0]);
});

test("the marked ice block shows the live headbar, empties on the last punch and stays standing", (t) => {
  const { player, arena, fight } = enter(t);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.DRAGON_DAGGER, 1));
  fight.startSpecial(Blue.freeze, 0);
  for (let offset = 0; offset <= 4; offset++) { Blue.freeze.shared(arena, offset); fight.tickSpecial(Blue.freeze, offset); }
  const block = fight.state.blocks[fight.state.target];
  assert.deepEqual(block.getHealthBar(), { id: 22, width: 160 });
  assert.equal(block.isHitpointsLocked(), true);
  assert.equal(block.getHitpoints(), 72);
  const shown = [];
  for (let punch = 0; punch < 9; punch++) {
    const part = { setDamage() {}, setSplatTypes() {} };
    Blue.hitBlock(block, { getHits: () => [part], getAttacker: () => player, updateTotalDamage() {} });
    shown.push(block.getDisplayedHealth().current);
  }
  assert.deepEqual(shown, [64, 56, 48, 40, 32, 24, 16, 8, 0]);
  assert.equal(fight.state.retrieved, true, "the weapon is back");
});

test("the ice floor strikes three ticks after it rises, so a step on the second tick is in time", (t) => {
  // (-7,-3) is on the first captured pattern; (0,-2) is on it too, (10,10) on none.
  const { player, arena, fight } = enter(t, [-7, -3]);
  const random = Math.random;
  Math.random = () => 0;
  t.after(() => { Math.random = random; });
  const struck = [];
  let offset = 0;
  fight.hurt = () => { struck.push(offset); return 1; };
  fight.startSpecial(Blue.freeze, 0);
  for (offset = 0; offset <= 19; offset++) {
    // Off the floor of the second wave (rises at 16) once the tick two later has moved them.
    if (offset === 19) player.setLocation(Common.tileAt("blue", [10, 10]));
    fight.tickSpecial(Blue.freeze, offset);
  }
  const floorStrikes = struck.filter((at) => at >= 8);
  assert.deepEqual(floorStrikes, [11], "struck on wave+3 only; the dodged wave missed");
});

test("Frost Storm takes a fifth of the Moon's health, and its storms walk through everything", (t) => {
  const { fight } = enter(t, [2, -1]);
  fight.hp = 183;
  fight.startSpecial(Blue.storm, 0);
  fight.tickSpecial(Blue.storm, 0);
  assert.equal(fight.hp, 147);
  const random = Math.random;
  Math.random = () => 0.1;
  t.after(() => { Math.random = random; });
  for (let offset = 1; offset <= 3 && !fight.state.storms.length; offset++) fight.tickSpecial(Blue.storm, offset);
  assert.ok(fight.state.storms.length > 0, "storms spawned");
  for (const { npc } of fight.state.storms) {
    assert.equal(npc.canWalkThroughNPCs(), true);
    assert.equal(npc.hasFlag("movement:ignore-clipping"), true);
  }
});

test("the Blue Moon's projectiles use the captured heights (the packet sender takes a quarter of them)", () => {
  const { freeze, storm } = Common.data.specials;
  assert.deepEqual([freeze.freezeProjectile.startHeight, freeze.freezeProjectile.endHeight], [17, 25]);
  assert.deepEqual([storm.castProjectile.startHeight, storm.castProjectile.endHeight], [207, 12]);
});

test("the exit stairs are used from across the arena", () => {
  const { approachStairs } = require("../plugins/bosses/moonsofperil/Arena.MoonsOfPeril");
  for (const objectId of [53003, 53004]) {
    const event = { objectId };
    approachStairs(event);
    assert.equal(event.approachRange, 10, `stairs ${objectId}`);
  }
  const other = { objectId: 51373 };
  approachStairs(other);
  assert.equal(other.approachRange, undefined, "a statue is still walked up to");
});

test("the death stand-in snaps round to the player", () => {
  const at = (x, y) => ({ getLocation: () => new core.Location(x, y, 0) });
  const standIn = { getSize: () => 5, getLocation: () => new core.Location(1438, 9678, 0) };
  assert.equal(Kill.angleTo(standIn, at(1440, 9670)), 0, "south");
  assert.equal(Kill.angleTo(standIn, at(1432, 9680)), 512, "west");
  assert.equal(Kill.angleTo(standIn, at(1440, 9690)), 1024, "north");
  assert.equal(Kill.angleTo(standIn, at(1450, 9680)), 1536, "east");
});
