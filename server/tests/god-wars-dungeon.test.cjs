// node --test tests/god-wars-dungeon.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Rules = require("../plugins/bosses/godwars/Rules.GodWars");
const Common = require("../plugins/bosses/godwars/Common.GodWars");

const at = (x, y, z) => ({ getX: () => x, getY: () => y, getZ: () => z });

function fakePlayer() {
  const attributes = new Map();
  const varbits = new Map();
  return {
    varbits,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ sendVarbit: (id, value) => varbits.set(id, value) }),
  };
}

test("a boss door spends 40 essence first, the ecumenical key only when the essence is short", () => {
  assert.equal(Rules.canOpenBossDoor({ killCount: 39, hasKey: false }).ok, false);
  assert.equal(Rules.canOpenBossDoor({ killCount: 39, hasKey: false }).required, 40);
  assert.deepEqual(Rules.canOpenBossDoor({ killCount: 40, hasKey: true }), { ok: true, spendsEssence: 40 });
  assert.deepEqual(Rules.canOpenBossDoor({ killCount: 0, hasKey: true }), { ok: true, consumesKey: true });
});

test("followers, generals and bodyguards count for their own god", () => {
  assert.equal(Common.factionForNpc(2215).key, "bandos");
  assert.equal(Common.factionForNpc(2241).key, "bandos");
  assert.equal(Common.factionForNpc(3175).key, "armadyl");
  assert.equal(Common.factionForNpc(2213).key, "saradomin");
  assert.equal(Common.factionForNpc(3160).key, "zamorak");
  assert.equal(Common.factionForNpc(11293), null);
});

test("chambers and the dungeon are told apart by tile", () => {
  assert.equal(Common.factionForRoom(at(2864, 5354, 2)).key, "bandos");
  assert.equal(Common.factionForRoom(at(2862, 5354, 2)), null);
  assert.equal(Common.factionForRoom(at(2897, 5269, 0)).key, "saradomin");
  assert.equal(Common.inDungeon(at(2882, 5311, 2)), true);
  assert.equal(Common.inDungeon(at(2916, 3745, 0)), false);
});

test("essence sits on the god's varbit and stops at 4,000", () => {
  const player = fakePlayer();
  const bandos = Common.factionByKey("bandos");
  Common.setEssence(player, bandos, 4100);
  assert.equal(Common.getEssence(player, bandos), 4000);
  assert.equal(player.varbits.get(3975), 4000);
  Common.resetEssence(player);
  assert.equal(Common.getEssence(player, bandos), 0);
  assert.equal(player.varbits.get(3976), 0);
});

test("the Wiki's protection items count for their god, not for a god named inside them", () => {
  const [armadyl, bandos, saradomin, zamorak] = ["armadyl", "bandos", "saradomin", "zamorak"].map(Common.factionByKey);
  assert.equal(Common.isGodItem(armadyl, 12610, "Book of Law"), true);
  assert.equal(Common.isGodItem(saradomin, 1718, "Holy symbol"), true);
  assert.equal(Common.isGodItem(bandos, 20232, "War blessing"), true);
  assert.equal(Common.isGodItem(armadyl, 22550, "Craw's bow (u)"), true);
  assert.equal(Common.isGodItem(zamorak, 3842, "Unholy book"), true);
  assert.equal(Common.isGodItem(saradomin, 3842, "Unholy book"), false);
  assert.equal(Common.isGodItem(armadyl, 28537, "Corrupted armadyl godsword"), false);
  assert.equal(Common.isGodItem(saradomin, 23332, "Rune scimitar"), true);
  assert.equal(Common.isGodItem(saradomin, 1333, "Rune scimitar"), false);
  // The 28 October 2026 update put the Rondache in the Wiki's Saradomin shield row.
  assert.equal(Common.isGodItem(saradomin, 34719, "Rondache"), true);
  assert.equal(Common.isGodItem(bandos, 34719, "Rondache"), false);
});

test("the count is of worn protection items, and Staff of Light counts for Saradomin and Zamorak", () => {
  const names = { 1718: "Holy symbol", 22296: "Staff of Light", 3842: "Unholy book", 20220: "Holy blessing" };
  Common.init({ core: { ItemDefinition: { forId: (id) => ({ getName: () => names[id] }) } } });
  const worn = [1718, 22296, 3842, 20220, -1].map((id) => ({ getId: () => id }));
  const player = { getEquipment: () => ({ getItems: () => [...worn, null] }) };
  assert.equal(Common.godItemCount(player, Common.factionByKey("saradomin")), 3);
  assert.equal(Common.godItemCount(player, Common.factionByKey("zamorak")), 2);
  assert.equal(Common.godItemCount(player, Common.factionByKey("armadyl")), 0);
});

test("every general's and bodyguard's projectile hit splats on the tick it lands (#1862)", () => {
  const { Projectile } = require("../dist/game/model/Projectile");
  const { Location } = require("../dist/game/model/Location");
  const gods = { saradomin: "Saradomin", zamorak: "Zamorak", armadyl: "Armadyl", bandos: "Bandos" };
  const sent = [];
  const previous = Common.core;
  const chain = { withAngle: () => chain, withProgress: () => chain, sendProjectile: () => {} };
  Common.init({
    core: {
      ...previous,
      CombatMethod: class {},
      CombatType: { MELEE: "MELEE", RANGED: "RANGED", MAGIC: "MAGIC" },
      CombatFactory: { applyStyleDamage: () => {} },
      PendingHit: class { constructor(attacker, target, method, delay) { this.delay = delay; } },
      Animation: class {},
      Graphic: class {},
      Sound: class {},
      Sounds: { sendSound: () => {} },
      Misc: { randomInclusive: () => 0 },
      Projectile: {
        centreOf: Projectile.centreOf,
        ticksToLand: Projectile.ticksToLand,
        createProjectile: (src, target, id, delay, end) => { sent.push({ id, delay, end }); return chain; },
      },
    },
  });
  const providers = new Map();
  const api = { registerNpcCombatMethodProvider: (id, Method) => providers.set(id, Method) };
  try {
    for (const [key, name] of Object.entries(gods)) {
      require(`../plugins/bosses/godwars/${name}.GodWars`)[`attach${name}`](api);
      assert.ok(Common.factionByKey(key));
    }
    let checked = 0;
    const flights = new Map();
    for (const [npcId, Method] of providers) {
      for (const tiles of [1, 4, 8]) {
        sent.length = 0;
        const npc = {
          getLocation: () => new Location(2900, 5200, 0), getSize: () => 1,
          performAnimation: () => {}, performGraphic: () => {}, forceChat: () => {},
          getDefinition: () => ({ getMaxHit: () => 10 }),
          __godwarsChamber: { area: { getPlayers: () => [] } },
        };
        const target = {
          getLocation: () => new Location(2900 + tiles, 5200, 0), getSize: () => 1, getHitpoints: () => 99,
          performGraphic: () => {}, isPlayer: () => true,
        };
        const method = new Method();
        method.start(npc, target);
        const hits = method.hits(npc, target);
        if (sent.length === 0) continue;
        const { id, delay, end } = sent[0];
        assert.ok(end > delay + 1, `${npcId} at ${tiles} tiles: end ${end} after launch ${delay}`);
        assert.equal(hits[0].delay, Projectile.ticksToLand(end), `${npcId} at ${tiles} tiles`);
        flights.set(`${id}@${tiles}`, end);
        checked++;
      }
    }
    assert.ok(checked >= 30, `checked ${checked} flights`);
    // Growler: captured 26 + 10 a tile, launched at 35 - next to her it would land before launch.
    assert.equal(flights.get("1183@1"), 50);
    assert.equal(flights.get("1183@4"), 66);
    // K'ril's flames: the captured flat 56 lands on tick 2.
    assert.equal(flights.get("1225@8"), 56);
  } finally {
    Common.init({ core: previous });
  }
});
