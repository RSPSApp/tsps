// Run after `yarn build`: node --test tests/tempoross-harpoons.test.cjs
// Tempoross harpoons follow Fishing's own requirements: a crystal harpoon needs 71 Fishing and 50 Agility (Wiki).
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const Shared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const { harpoonOf } = require("../plugins/minigames/tempoross/Spots.Tempoross");

let core;
before(() => {
  core = PluginManager.getCoreApi();
  Shared.bind({ core });
});

function fisher(levels, carried) {
  const { Skill } = core;
  const current = new Map(Object.entries(levels).map(([name, level]) => [Skill[name], level]));
  return {
    getSkillManager: () => ({ getCurrentLevel: (skill) => current.get(skill) ?? 1 }),
    getInventory: () => ({ contains: (id) => carried.includes(id) }),
    getEquipment: () => ({ contains: () => false }),
  };
}

test("a crystal harpoon needs 50 Agility; without it the next harpoon carried is used", () => {
  const ids = core.ItemIdentifiers;
  const carried = [ids.CRYSTAL_HARPOON, ids.HARPOON];
  assert.equal(harpoonOf(fisher({ FISHING: 99, AGILITY: 50 }, carried))?.tier, "crystal");
  assert.equal(harpoonOf(fisher({ FISHING: 99, AGILITY: 49 }, carried))?.tier, "harpoon");
  assert.equal(harpoonOf(fisher({ FISHING: 99, AGILITY: 49 }, [ids.CRYSTAL_HARPOON])), null);
});

test("an inactive crystal harpoon needs 71 Fishing and 50 Agility, as in Fishing", () => {
  const ids = core.ItemIdentifiers;
  const carried = [ids.CRYSTAL_HARPOON_INACTIVE_];
  assert.equal(harpoonOf(fisher({ FISHING: 71, AGILITY: 50 }, carried))?.tier, "dragon");
  assert.equal(harpoonOf(fisher({ FISHING: 70, AGILITY: 50 }, carried)), null);
  assert.equal(harpoonOf(fisher({ FISHING: 71, AGILITY: 49 }, carried)), null);
});

test("an infernal harpoon needs 75 Fishing, as in Fishing; below it the next harpoon carried is used", () => {
  const ids = core.ItemIdentifiers;
  const carried = [ids.INFERNAL_HARPOON, ids.HARPOON];
  assert.equal(harpoonOf(fisher({ FISHING: 75 }, carried))?.tier, "dragon");
  assert.equal(harpoonOf(fisher({ FISHING: 74 }, carried))?.tier, "harpoon");
  assert.equal(harpoonOf(fisher({ FISHING: 74 }, [ids.INFERNAL_HARPOON_UNCHARGED_])), null, "uncharged too");
});
