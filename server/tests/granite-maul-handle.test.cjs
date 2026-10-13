// Run after `yarn build`: node --test tests/granite-maul-handle.test.cjs
// The ornate maul handle: what it attaches to, the warning and its switch, Revert destroying the
// handle, and the 50% Quick Smash both ornate forms pay.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { PluginManager } = require("../dist/plugins/PluginManager");

const Handle = require("../plugins/items/OrnateMaulHandle.plugin");

const PLAIN = ItemIdentifiers.GRANITE_MAUL; // cache granite_maul
const CLAMPED = ItemIdentifiers.GRANITE_MAUL_3; // granite_maul_pretty
const HANDLED = ItemIdentifiers.GRANITE_MAUL_5; // granite_maul_plus
const BOTH = ItemIdentifiers.GRANITE_MAUL_7; // granite_maul_pretty_plus
const HANDLE = ItemIdentifiers.ORNATE_MAUL_HANDLE; // granite_maul_upgrade

function createPlayer(slots) {
  const items = slots.map((id) => ({
    id,
    getId() {
      return this.id;
    },
    setId(next) {
      this.id = next;
    },
  }));
  const attributes = new Map();
  const messages = [];
  const inventory = {
    getItems: () => items,
    // Clears the slot in place, as ItemContainer.deletedItem does.
    deleteNumber: (id) => {
      const slot = items.findIndex((entry) => entry?.getId() === id);
      if (slot >= 0) {
        items[slot].id = -1;
      }
    },
    refreshItems: () => {},
  };
  return {
    items,
    messages,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    sendMessage: (message) => messages.push(message),
    idAt: (slot) => items[slot]?.getId(),
  };
}

/** Registers the plugin against a stub api and returns the hooks and prompts it collected. */
function registerPlugin() {
  const prompts = [];
  const persisted = [];
  const hooks = {};
  Handle.register({
    persistAttribute: (key) => persisted.push(key),
    onItemOnItem: (handler) => {
      hooks.attach = handler;
    },
    onItemAction: (itemName, actions) => {
      hooks.itemName = itemName;
      hooks.revert = actions.Revert;
    },
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      prompts.push({ player, title, pairs });
      return true;
    },
    log: () => {},
  });
  /** Uses the item in one slot on the item in another, as the client reports it. */
  const use = (player, usedSlot, usedWithSlot) => {
    const event = {
      player,
      usedItem: player.items[usedSlot],
      usedItemId: player.idAt(usedSlot),
      usedItemSlot: usedSlot,
      usedWithItem: player.items[usedWithSlot],
      usedWithItemId: player.idAt(usedWithSlot),
      usedWithItemSlot: usedWithSlot,
      handled: false,
    };
    hooks.attach(event);
    return event;
  };
  /** Answers an open warning with the nth option, and runs whatever it promised. */
  const answer = (prompt, option) => prompt.pairs[option * 2 + 1](prompt.player);
  return { prompts, persisted, hooks, use, answer };
}

test("the handle table maps each maul onto the cache's ornate form", () => {
  const loaded = Handle._test.loadHandleForms();
  assert.equal(loaded.handle, HANDLE);
  assert.equal(loaded.forms.get(PLAIN), HANDLED, "a plain maul takes the handle");
  assert.equal(loaded.forms.get(CLAMPED), BOTH, "a clamped maul takes the handle too");
  assert.equal(loaded.forms.get(HANDLED), undefined, "a maul that already has one is not a base");
});

test("attaching warns, then consumes the handle and swaps the maul", () => {
  const { prompts, use, answer } = registerPlugin();
  const player = createPlayer([HANDLE, -1, PLAIN]);
  const event = use(player, 0, 2);
  assert.equal(event.handled, true);
  assert.equal(prompts.length, 1, "the attach is confirmed first");
  assert.equal(player.idAt(2), PLAIN, "nothing changes until the player answers");
  answer(prompts[0], 0);
  assert.equal(player.idAt(2), HANDLED);
  assert.equal(player.idAt(0), -1, "the handle is consumed");
  assert.match(player.messages[0], /attach the ornate maul handle/);
});

test("'don't ask again' attaches at once and stops the warning", () => {
  const { prompts, persisted, use, answer } = registerPlugin();
  const player = createPlayer([HANDLE, CLAMPED]);
  use(player, 0, 1);
  answer(prompts[0], 1);
  assert.equal(player.idAt(1), BOTH);
  assert.ok(persisted.includes(Handle._test.SKIP_WARNING_ATTRIBUTE), "the switch is saved");

  const second = createPlayer([HANDLE, PLAIN]);
  second.setAttribute(Handle._test.SKIP_WARNING_ATTRIBUTE, true);
  use(second, 0, 1);
  assert.equal(prompts.length, 1, "the warning is not shown again");
  assert.equal(second.idAt(1), HANDLED);
});

test("'No.' leaves the maul and the handle alone", () => {
  const { prompts, use, answer } = registerPlugin();
  const player = createPlayer([HANDLE, PLAIN]);
  use(player, 0, 1);
  answer(prompts[0], 2);
  assert.equal(player.idAt(1), PLAIN);
  assert.equal(player.idAt(0), HANDLE);
});

test("an attach resolved after the handle moved away does nothing", () => {
  const { prompts, use } = registerPlugin();
  const player = createPlayer([HANDLE, PLAIN]);
  use(player, 0, 1);
  player.items[0].id = -1;
  player.items[1].id = HANDLE;
  prompts[0].pairs[1](player);
  assert.equal(player.idAt(1), HANDLE, "the maul slot no longer holds a maul, so nothing swaps");
  assert.equal(player.messages.length, 0);
});

test("reverting gives back the maul the handle went onto and destroys the handle", () => {
  const { hooks } = registerPlugin();
  assert.equal(hooks.itemName, "Granite maul", "hooked by name, so no variant id list to miss");
  const player = createPlayer([HANDLED]);
  assert.equal(hooks.revert({ player, item: player.items[0], itemId: HANDLED }), true);
  assert.equal(player.idAt(0), PLAIN);
  assert.equal(player.messages.length, 1, "nothing is handed back: the handle is simply gone");

  const both = createPlayer([BOTH]);
  assert.equal(hooks.revert({ player: both, item: both.items[0], itemId: BOTH }), true);
  assert.equal(both.idAt(0), CLAMPED, "the clamp stays: only the handle is destroyed");
});

test("Revert leaves mauls with no handle to their own feature", () => {
  const { hooks } = registerPlugin();
  const player = createPlayer([CLAMPED, PLAIN]);
  // The clamped maul's Revert belongs to the granite clamp, which is not this handle's page.
  assert.equal(hooks.revert({ player, item: player.items[0], itemId: CLAMPED }), false);
  assert.equal(hooks.revert({ player, item: player.items[1], itemId: PLAIN }), false);
});

test("both ornate forms pay 50% for Quick Smash, the plain and clamped mauls 60%", () => {
  require("../plugins/combat/specials/GraniteMaul.SpecialAttack")({
    core: PluginManager.getCoreApi(),
    registerCombatSpecial: CombatSpecial.register,
  });
  const special = CombatSpecial.getById("granite_maul");
  assert.ok(special, "the granite maul keeps its special");
  assert.equal(CombatSpecial.getForWeaponId(BOTH), special, "the handled and clamped maul can smash");
  assert.equal(special.getDrainAmountForWeaponId(PLAIN), 60);
  assert.equal(special.getDrainAmountForWeaponId(CLAMPED), 60);
  assert.equal(special.getDrainAmountForWeaponId(HANDLED), 50);
  assert.equal(special.getDrainAmountForWeaponId(BOTH), 50);
});

test("Justine sells the handle for 15 Last Man Standing points", () => {
  const file = path.resolve(__dirname, "../data/definitions/shops.json");
  const shop = JSON.parse(fs.readFileSync(file, "utf8")).find((entry) => entry.id === 1449);
  assert.equal(shop.currency, "LAST MAN STANDING POINTS");
  assert.equal(shop.prices[String(HANDLE)], 15);
  assert.ok(shop.originalStock.some((entry) => entry.id === HANDLE), "and it is in stock");
});

test("every granite maul form still takes 50 Attack and 50 Strength to wield", () => {
  const file = path.resolve(__dirname, "../data/definitions/item-gameplay.json");
  const rows = new Map(JSON.parse(fs.readFileSync(file, "utf8")).map((row) => [row.id, row]));
  for (const id of [CLAMPED, HANDLED, BOTH]) {
    assert.deepEqual(rows.get(id).requirements, rows.get(PLAIN).requirements, `${id} matches the plain maul`);
  }
});
