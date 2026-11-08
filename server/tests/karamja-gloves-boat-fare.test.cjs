// Run after `yarn build`: node --test tests/karamja-gloves-boat-fare.test.cjs
// Wiki (Seaman Lorris, Karamja Diary): the fare to Musa Point is 15 coins, not 30, while wearing any Karamja gloves.
// The return trip already charged 15; the outbound boats always took 30.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core;
const boats = {};
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const real = PluginManager.createApi("KaramjaGlovesFare");
  const api = new Proxy({ core, getPluginConfig: real.getPluginConfig?.bind(real) }, {
    get: (object, name) => {
      if (name === "onNpcsInteraction") return (names, options) => { for (const n of names) boats[n] = options; };
      return object[name] ?? real[name] ?? (() => {});
    },
  });
  require("../plugins/quests/quests/PiratesTreasure.Quest")(api);
});

function traveller(t, gloves) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("gloves" + (gloves ?? "none"));
  p.setLocation(new core.Location(3029, 3217, 0));
  if (gloves) p.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(gloves, 1));
  p.getInventory().setItem(0, new core.Item(core.ItemIdentifiers.COINS, 100));
  t.after(() => core.TaskManager.cancelTasks(p));
  return p;
}

test("any Karamja gloves halve the Musa Point fare from every Port Sarim boat", (t) => {
  const I = core.ItemIdentifiers;
  for (const npc of ["Seaman Thresnor", "Seaman Lorris", "Captain Tobias"]) {
    for (const gloves of [I.KARAMJA_GLOVES_1, I.KARAMJA_GLOVES_2, I.KARAMJA_GLOVES_3, I.KARAMJA_GLOVES_4]) {
      const p = traveller(t, gloves);
      boats[npc].Travel({ player: p });
      assert.equal(p.getInventory().getAmount(I.COINS), 85, `${npc} with ${gloves}`);
    }
  }
});

test("without the gloves the fare stays 30", (t) => {
  const p = traveller(t, null);
  boats["Captain Tobias"].Travel({ player: p });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.COINS), 70);
});
