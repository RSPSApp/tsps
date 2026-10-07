// Run after `yarn build`: node --test tests/crystal-axe.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const CrystalAxe = require("../plugins/skills/woodcutting/CrystalAxe.Woodcutting");

const itemActions = new Map();
CrystalAxe.attach({
  core: { Equipment, ItemIds, ItemIdentifiers: require("../dist/util/ItemIdentifiers").ItemIdentifiers },
  onItemAction: (name, actions) => itemActions.set(name, actions),
  onItemOnItem() {},
});

function item(id, amount = 1) {
  const value = {
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
  return value;
}

function createPlayer(weapon = null, inventory = []) {
  const equipment = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
  if (weapon) equipment[Equipment.WEAPON_SLOT] = weapon;
  const items = inventory;
  const messages = [];
  return {
    messages,
    getEquipment: () => ({
      getItems: () => equipment,
      contains: (id) => equipment.some((entry) => entry?.getId?.() === id),
      refreshItems: () => {},
    }),
    getInventory: () => ({
      getItems: () => items,
      getAmount: (id) => items.reduce((sum, entry) => sum + (entry?.getId() === id ? entry.getAmount() : 0), 0),
      deleteNumber: (id, amount) => {
        const entry = items.find((candidate) => candidate?.getId() === id);
        if (entry) entry.amount = Math.max(0, entry.amount - amount);
      },
      refreshItems: () => {},
    }),
    sendMessage: (message) => messages.push(message),
  };
}

test("crystal axe charges start at 10,000, spend one per log and go inactive at zero", () => {
  const axe = item(ItemIds.CRYSTAL_AXE);
  const player = createPlayer(axe);
  assert.equal(CrystalAxe.charges(axe), 10000);
  assert.equal(CrystalAxe.tryUseCharge(player, () => 0.5), true);
  assert.equal(CrystalAxe.charges(axe), 9999);

  axe.setMetaValue("crystal-axe", { charges: 1 });
  assert.equal(CrystalAxe.tryUseCharge(player, () => 0.5), true);
  assert.equal(axe.getId(), ItemIds.CRYSTAL_AXE_INACTIVE_);
  assert.match(player.messages.at(-1), /run out of charges/);
});

test("an elven signet saves the charge one time in ten", () => {
  const axe = item(ItemIds.CRYSTAL_AXE);
  const ring = item(ItemIds.ELVEN_SIGNET);
  const player = createPlayer(axe);
  player.getEquipment().getItems()[Equipment.RING_SLOT] = ring;
  assert.equal(CrystalAxe.tryUseCharge(player, () => 0.05), false);
  assert.equal(CrystalAxe.charges(axe), 10000);
  assert.equal(CrystalAxe.tryUseCharge(player, () => 0.5), true);
  assert.equal(CrystalAxe.charges(axe), 9999);
});

test("the Check action reports the remaining charges", () => {
  const axe = item(ItemIds.CRYSTAL_AXE);
  const player = createPlayer(axe);
  itemActions.get("Crystal axe").Check({ player, item: axe });
  assert.equal(player.messages[0], "Your crystal axe has 10,000 charges left.");
});
