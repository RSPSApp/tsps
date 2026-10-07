// Run after `yarn build`: node --test tests/crystal-pickaxe.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const CrystalPickaxe = require("../plugins/skills/mining/CrystalPickaxe.Mining");

const itemActions = new Map();
CrystalPickaxe.attach({
  core: { Equipment, ItemIds, ItemIdentifiers: require("../dist/util/ItemIdentifiers").ItemIdentifiers },
  onItemAction: (name, actions) => itemActions.set(name, actions),
  onItemOnItem() {},
});

function item(id, amount = 1) {
  return {
    id,
    amount,
    meta: {},
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getAmount() { return this.amount; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, next) {
      if (next === undefined) delete this.meta[key];
      else this.meta[key] = next;
    },
  };
}

function createPlayer(weapon = null) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  if (weapon) equipment[Equipment.WEAPON_SLOT] = weapon;
  const messages = [];
  return {
    messages,
    getEquipment: () => ({
      getItems: () => equipment,
      contains: (id) => equipment.some((entry) => entry?.getId?.() === id),
      refreshItems: () => {},
    }),
    getInventory: () => ({ getItems: () => [], refreshItems: () => {} }),
    sendMessage: (message) => messages.push(message),
  };
}

test("crystal pickaxe charges start at 10,000 and go inactive at zero", () => {
  const pickaxe = item(ItemIds.CRYSTAL_PICKAXE);
  const player = createPlayer(pickaxe);
  assert.equal(CrystalPickaxe.charges(pickaxe), 10000);
  assert.equal(CrystalPickaxe.tryUseCharge(player, () => 0.5), true);
  assert.equal(CrystalPickaxe.charges(pickaxe), 9999);
  pickaxe.setMetaValue("crystal-pickaxe", { charges: 1 });
  assert.equal(CrystalPickaxe.tryUseCharge(player, () => 0.5), true);
  assert.equal(pickaxe.getId(), ItemIds.CRYSTAL_PICKAXE_INACTIVE_);
  assert.match(player.messages.at(-1), /run out of charges/);
});

test("an elven signet saves the charge one time in ten", () => {
  const pickaxe = item(ItemIds.CRYSTAL_PICKAXE);
  const player = createPlayer(pickaxe);
  player.getEquipment().getItems()[Equipment.RING_SLOT] = item(ItemIds.ELVEN_SIGNET);
  assert.equal(CrystalPickaxe.tryUseCharge(player, () => 0.05), false);
  assert.equal(CrystalPickaxe.charges(pickaxe), 10000);
  assert.equal(CrystalPickaxe.tryUseCharge(player, () => 0.5), true);
  assert.equal(CrystalPickaxe.charges(pickaxe), 9999);
});

test("poisoned spears and the 3rd Age bow are wired in the item data", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const items = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "definitions", "item-gameplay.json"), "utf8"));
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  for (const id of [1251, 1253, 1255, 1257, 1259, 1261, 1263, 3170, 3176]) {
    assert.equal(byId.get(id)?.weaponInterface, "SPEAR", `poisoned spear ${id}`);
  }
  assert.equal(byId.get(12424)?.weaponInterface, "SHORTBOW");
  const { RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
  const bow = RangedWeapon.getFor({ getEquipment: () => ({ getItems: () => new Array(14).fill(null).map((_, i) => ({ getId: () => (i === Equipment.WEAPON_SLOT ? 12424 : 0) })) }) });
  assert.ok(bow, "3rd Age bow resolves a ranged weapon");
});
