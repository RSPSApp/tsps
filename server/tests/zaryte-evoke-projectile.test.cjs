// Run after `yarn build`: node --test tests/zaryte-evoke-projectile.test.cjs
// The Zaryte crossbow's Evoke flies its own zcb_specialattack spotanim (1995) on a flat 41 -> 75 path at heights
// 44 -> 36, whatever the distance (rsprox_transcripts/227/01752.txt), as Armadyl Eye does. It sent the equipped bolt
// (27) on the normal trajectory instead: 41 -> 66 at 4 tiles, 41 -> 86 at 8.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Projectile } = require("../dist/game/model/Projectile");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");

let core, special;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = PluginManager.createApi("ZaryteEvokeProjectile");
  require("../plugins/combat/specials/ZaryteCrossbow.SpecialAttack")({
    ...api, core, registerCombatSpecial: (definition) => { special = definition; api.registerCombatSpecial(definition); },
  });
});

function shooter(t) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("zcbevoke");
  p.setLocation(new core.Location(3200, 3200, 0));
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.ZARYTE_CROSSBOW, 1));
  p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(core.ItemIdentifiers.RUNITE_BOLTS, 100));
  p.setSpecialPercentage?.(100);
  t.after(() => core.TaskManager.cancelTasks(p));
  return p;
}

test("Evoke sends 1995 on the flat 41 -> 75 path at 4 and 8 tiles", (t) => {
  const sent = [];
  t.mock.method(Projectile.prototype, "sendProjectile", function () { sent.push(this); return this; });
  for (const tiles of [4, 8]) {
    const p = shooter(t);
    const npc = new NPC(core.NpcIdentifiers.MAN ?? 3106, new core.Location(3200 + tiles, 3200, 0));
    special.combatMethod.start(p, npc);
    const shot = sent.at(-1);
    assert.ok(shot, `a projectile at ${tiles} tiles`);
    assert.deepEqual(
      { id: shot.projectileId, start: shot.delay, end: shot.speed, startHeight: shot.startHeight * 4, endHeight: shot.endHeight * 4, angle: shot.angle },
      { id: 1995, start: 41, end: 75, startHeight: 176, endHeight: 146, angle: 5 },
      `${tiles} tiles`,
    );
  }
});
