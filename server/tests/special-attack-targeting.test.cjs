// Run after `yarn build`: node --test tests/special-attack-targeting.test.cjs
// Generic multi-target selection (NPCs and players) shared by Powerstab and Sweep.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { SpecialAttackTargetingResolver } = require("../dist/game/content/combat/SpecialAttackTargeting");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { World } = require("../dist/game/World");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CanAttackResponse } = require("../dist/game/content/combat/CombatFactory");
const { TimerKey } = require("../dist/util/timers/TimerKey");

const core = PluginManager.getCoreApi();
for (const file of ["Dragon2hSword", "DragonHalberd"]) {
  require(`../plugins/combat/specials/${file}.SpecialAttack`)({ core, registerCombatSpecial: CombatSpecial.register });
}
const powerstab = CombatSpecial.getById("dragon_2h_sword").getTraits().targeting;
const sweep = CombatSpecial.getById("dragon_halberd").getTraits().targeting;

const mobile = (kind, x, y, { size = 1, attackable = true } = {}) => ({
  kind, attackable,
  isPlayer: () => kind === "player",
  isNpc: () => kind === "npc",
  getAsNpc() { return this; },
  getSize: () => size,
  getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => 0, getDistance: (o) => Math.max(Math.abs(o.getX() - x), Math.abs(o.getY() - y)) }),
});
const npc = (x, y, opts) => mobile("npc", x, y, opts);
const player = (x, y, opts) => mobile("player", x, y, opts);

function resolve(t, { npcs = [], players = [], attacker, primary, targeting, multi = true }) {
  t.mock.restoreAll();
  t.mock.method(World, "getNpcs", () => npcs);
  t.mock.method(World, "getPlayers", () => players);
  t.mock.method(AreaManager, "inMulti", () => multi);
  t.mock.method(CombatFactory, "canAttackSecondaryTarget", (a, p, candidate) =>
    candidate !== a && candidate !== p && candidate.attackable);
  return SpecialAttackTargetingResolver.resolve(attacker, primary, targeting).secondaryTargets;
}

test("Powerstab: neighbours of any kind, own tile included, never the attacker or the primary", (t) => {
  const attacker = player(10, 10);
  const primary = npc(11, 10);
  const adjacent = npc(9, 9);
  const onTop = npc(10, 10);
  const far = npc(13, 10);
  const big = npc(7, 10, { size: 3 }); // covers x 7..9, touching the attacker's column
  const bystander = player(10, 11);
  const swept = resolve(t, { npcs: [primary, adjacent, onTop, far, big], players: [attacker, bystander], attacker, primary, targeting: powerstab });
  assert.deepEqual(swept, [adjacent, onTop, big, bystander]);
});

test("Powerstab caps at 14 targets and three players, counting a player primary", (t) => {
  const attacker = player(10, 10);
  const crowd = Array.from({ length: 20 }, () => npc(10, 11));
  assert.equal(resolve(t, { npcs: crowd, attacker, primary: npc(11, 10), targeting: powerstab }).length, 13);

  const rivals = Array.from({ length: 6 }, () => player(9, 10));
  const npcPrimary = npc(11, 10);
  assert.equal(resolve(t, { npcs: [npcPrimary], players: rivals, attacker, primary: npcPrimary, targeting: powerstab }).length, 3, "three players");
  const playerPrimary = player(11, 10);
  assert.equal(
    resolve(t, { players: [playerPrimary, ...rivals], attacker, primary: playerPrimary, targeting: powerstab }).length, 2,
    "the primary is one of the three",
  );
});

test("Powerstab/Sweep skip candidates the attack checks refuse, and need multi-combat", (t) => {
  const attacker = player(10, 10);
  const primary = player(11, 10);
  const immune = player(9, 10, { attackable: false });
  const fair = player(10, 9);
  const protectedNpc = npc(9, 11, { attackable: false });
  const swept = resolve(t, { npcs: [protectedNpc], players: [immune, fair], attacker, primary, targeting: powerstab });
  assert.deepEqual(swept, [fair]);
  assert.deepEqual(resolve(t, { players: [immune, fair], attacker, primary, targeting: powerstab, multi: false }), []);
  assert.deepEqual(resolve(t, { players: [fair], attacker: npc(10, 10), primary, targeting: powerstab }), [], "players only");
});

test("a special without maxPlayerTargets never sweeps players", (t) => {
  const attacker = player(10, 10);
  const primary = npc(11, 10);
  const rival = player(9, 10);
  const bystander = npc(9, 9);
  const { maxPlayerTargets, ...npcOnly } = powerstab;
  assert.equal(maxPlayerTargets, 3);
  assert.deepEqual(resolve(t, { npcs: [primary, bystander], players: [rival], attacker, primary, targeting: npcOnly }), [bystander]);
});

test("Sweep: 1x3 strip centred on the primary, stacked players each counted, three-player cap", (t) => {
  const attacker = player(10, 10);
  const primary = npc(12, 10);
  const left = player(12, 11);
  const stacked = [player(12, 10), player(12, 10), player(12, 10)];
  const outside = npc(12, 13);
  const swept = resolve(t, { npcs: [primary, outside], players: [left, ...stacked, player(11, 10), player(13, 10)], attacker, primary, targeting: sweep });
  assert.deepEqual(swept, [stacked[0], stacked[1], stacked[2]], "strip order, three players max");
});

test("Sweep on a player primary uses the same three-player cap and a large NPC ignores the line", (t) => {
  const attacker = player(10, 10);
  const primary = player(12, 10);
  const mates = [player(12, 10), player(12, 11), player(12, 9)];
  assert.equal(resolve(t, { players: [primary, ...mates], attacker, primary, targeting: sweep }).length, 2);

  const boss = npc(12, 10, { size: 3 });
  const result = SpecialAttackTargetingResolver.resolve(attacker, boss, sweep);
  assert.equal(result.largeTargetExtraHit, true);
  assert.deepEqual(result.secondaryTargets, []);
});

test("Sweep follows diagonal facing and ignores targets before or beyond the strip", (t) => {
  const attacker = player(10, 10);
  const primary = player(12, 12);
  const left = player(11, 13);
  const right = player(13, 11);
  const outside = [player(11, 11), player(13, 13), player(12, 11)];
  assert.deepEqual(resolve(t, { players: [...outside, left, right], attacker, primary, targeting: sweep }), [right, left]);
});

test("shared secondary permissions enforce policy, multicombat, immunity and duel isolation", (t) => {
  const actor = (kind) => ({
    isNpc: () => kind === "npc",
    isPlayer: () => kind === "player",
    getAsNpc() { return this; },
    getAsPlayer() { return this; },
    getDueling: () => ({ inDuel: () => false }),
    getHitpoints: () => 50,
    getCurrentDefinition: () => ({ isAttackable: () => true }),
    getTimers: () => ({ has: () => false }),
    getLocation: () => ({ isWithinDistance: (_, radius) => radius >= 2 }),
  });
  const attacker = actor("player");
  const primary = actor("npc");
  const candidate = actor("player");
  t.mock.method(CombatFactory, "validTarget", () => true);
  const multi = t.mock.method(AreaManager, "inMulti", () => true);
  const policy = t.mock.method(CombatFactory, "canAttackByPolicy", () => CanAttackResponse.CAN_ATTACK);
  const allowed = (target = candidate, radius) => CombatFactory.canAttackSecondaryTarget(attacker, primary, target, radius);
  assert.equal(allowed(), true, "shape-based attacks may omit radius");
  assert.equal(allowed(candidate, 1), false, "spell radius stays enforced");
  assert.equal(allowed(candidate, 2), true);
  policy.mock.mockImplementation(() => CanAttackResponse.CANT_ATTACK_IN_AREA);
  assert.equal(allowed(), false, "protected/out-of-range players");
  assert.equal(allowed(actor("npc")), false, "NPC area policy also applies");
  policy.mock.mockImplementation(() => CanAttackResponse.CAN_ATTACK);
  multi.mock.mockImplementation(() => false);
  assert.equal(allowed(), false);
  multi.mock.mockImplementation(() => true);
  const immuneNpc = actor("npc");
  immuneNpc.getTimers = () => ({ has: (key) => key === TimerKey.ATTACK_IMMUNITY });
  assert.equal(allowed(immuneNpc), false);
  const dueller = actor("player");
  dueller.getDueling = () => ({ inDuel: () => true });
  assert.equal(allowed(dueller), false);
  assert.equal(allowed(primary), false);
  assert.equal(allowed(attacker), false);
  t.mock.method(CombatFactory, "validTarget", () => false);
  assert.equal(allowed(), false, "invalid, dead, or separate-instance targets");
});
