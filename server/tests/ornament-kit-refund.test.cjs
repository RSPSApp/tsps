// Run after `yarn build`: node --test tests/ornament-kit-refund.test.cjs
//
// #2266: dismantling an ornamented item must return the kit. The Wiki's item pages say so for each
// item below ("can be dismantled anytime, returning the tradeable <item> and ornament kit"; the
// Void and Echo Ahrim's pages say "reverted anytime, returning the item and kit"). The Ornament kit
// page gives the rule: Treasure Trail kits are kept on revert, only some others (the Last Man
// Standing shop kits) are lost.
//
// Real engine: PluginManager with every plugin loaded, a real Player and inventory, the real
// preset producer, and the item option dispatched through PluginManager.emitItemAction.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");

// [ornamented item, base item, kit]: every item whose Wiki page states that the kit comes back.
const RETURNS_THE_KIT = [
  [23230, 8850, 23227], // Rune defender (t)
  [12417, 11335, 12538], // Dragon full helm (g)
  [12414, 3140, 12534], // Dragon chainbody (g)
  [22242, 21892, 22236], // Dragon platebody (g)
  [12415, 4087, 12536], // Dragon platelegs (g): the Dragon legs/skirt ornament kit
  [12416, 4585, 12536], // Dragon plateskirt (g): the same legs/skirt kit
  [22234, 11840, 22231], // Dragon boots (g)
  [12418, 1187, 12532], // Dragon sq shield (g)
  [22244, 21895, 22239], // Dragon kiteshield (g)
  [20000, 4587, 20002], // Dragon scimitar (or)
  [19722, 12954, 20143], // Dragon defender (t): on the real dragon defender, not the Last Man Standing one (23597)
  [23235, 6528, 23232], // Tzhaar-ket-om (t)
  [23240, 11128, 23237], // Berserker necklace (or)
  [12436, 6585, 12526], // Amulet of fury (or)
  [20366, 19553, 20062], // Amulet of torture (or)
  [22249, 19547, 22246], // Necklace of anguish (or)
  [23444, 19544, 23348], // Tormented bracelet (or)
  [19720, 12002, 20065], // Occult necklace (or)
  [12457, 6918, 12528], // Dark infinity hat (Dark infinity colour kit)
  [12419, 6918, 12530], // Light infinity hat (Light infinity colour kit)
  [26463, 8839, 26479], // Void knight top (or)
  [26465, 8840, 26479], // Void knight robe (or)
  [26467, 8842, 26479], // Void knight gloves (or)
  [26469, 13072, 26479], // Elite void top (or)
  [26471, 13073, 26479], // Elite void robe (or)
  [26473, 11663, 26479], // Void mage helm (or)
  [26475, 11664, 26479], // Void ranger helm (or)
  [26477, 11665, 26479], // Void melee helm (or)
  // Echo Ahrim's: an undamaged piece reverts to the undamaged one (Wiki lists Ahrim's hood "Undamaged"
  // 4708 and "100" 4856 as separate versions); a used "100" piece is covered by the round-trip tests.
  [30445, 4708, 30451], // Echo ahrim's hood
  [30447, 4712, 30451], // Echo ahrim's robetop
  [30449, 4714, 30451], // Echo ahrim's robeskirt
  [30568, 4710, 30451], // Echo ahrim's staff
  [25734, 22324, 25742], // Holy ghrazi rapier
  [25738, 22486, 25742], // Holy Scythe of Vitur (uncharged)
  [25733, 22481, 25742], // Holy sanguinesti staff (uncharged)
  [25741, 22486, 25744], // Sanguine Scythe of Vitur (uncharged)
];
// The ornamented godswords (Armadyl, Bandos, Saradomin, Zamorak (or)) are left out: PR #2282 (#2267) owns their kit refund.
// Charged, they have no take-apart option in the cache (the Wiki: discharge them first, at the Theatre
// of Blood bank for the scythes); the uncharged rows above cover their kit refund.
const CHARGED_THEATRE_ITEMS = [
  [25736, "Holy Scythe of Vitur"],
  [25731, "Holy sanguinesti staff"],
  [25739, "Sanguine Scythe of Vitur"],
];
const TRAILBLAZER_GRACEFUL_HOOD = 25069; // the Wiki does not say whether its kit comes back
const DRAGON_FULL_HELM_G = 12417;
const DRAGON_FULL_HELM = 11335;
const DRAGON_FULL_HELM_KIT = 12538;
const BONES = 526;

let core;
let next = 4100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("kitrefund" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3234, 3222, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function preset(id) {
  assert.equal(Presets.isEnabled(), true, "the Presets plugin is registered");
  const item = Presets._test.spawnPresetItem(new core.Item(id, 1), Presets.getGlobalPresetPool()[0]);
  assert.equal(item.isPresetItem(), true, "the producer marked the item");
  return item;
}

const real = (id) => new core.Item(id, 1);
const give = (player, ...items) => items.forEach((item) => player.getInventory().add(item, false));
const held = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0);
const ids = (player) => held(player).map((item) => item.getId()).sort((a, b) => a - b);
const sortedIds = (list) => [...list].sort((a, b) => a - b);

function slotOf(player, item) {
  return player.getInventory().getItems().findIndex((entry) => entry && entry.equals(item));
}

/** The option the cache gives the item for taking it apart: the test fails if it has none. */
function optionFor(itemId) {
  const actions = core.CacheDefinitions.getItem(itemId)?.inventoryActions ?? [];
  const option = ["Dismantle", "Revert", "Detach"].find((name) => actions.includes(name));
  assert.ok(option, `item ${itemId} has no Dismantle, Revert or Detach in the cache: ${JSON.stringify(actions)}`);
  return option;
}

function dismantle(player, itemValue) {
  const slot = slotOf(player, itemValue);
  assert.ok(slot >= 0, "the item is in the inventory");
  const item = player.getInventory().getItems()[slot];
  const option = optionFor(item.getId());
  const index = (core.CacheDefinitions.getItem(item.getId())?.inventoryActions ?? []).indexOf(option);
  return PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot,
    clickType: index + 1, option, handled: false,
  });
}

test("the charged Theatre items have no take-apart option, so there is nothing to dispatch", () => {
  for (const [id, name] of CHARGED_THEATRE_ITEMS) {
    const actions = core.CacheDefinitions.getItem(id)?.inventoryActions ?? [];
    for (const option of ["Dismantle", "Revert", "Detach"]) {
      assert.equal(actions.includes(option), false, `${name} (${id}) lists ${option}: ${JSON.stringify(actions)}`);
    }
  }
});

test("dismantling Dragon full helm (g) gives back the full helm and the kit (the issue)", (t) => {
  const { player } = actor(t);
  give(player, real(DRAGON_FULL_HELM_G));
  assert.equal(dismantle(player, real(DRAGON_FULL_HELM_G)), true);
  assert.deepEqual(ids(player), sortedIds([DRAGON_FULL_HELM, DRAGON_FULL_HELM_KIT]));
});

for (const [ornamented, base, kit] of RETURNS_THE_KIT) {
  test(`item ${ornamented}: dismantling returns base ${base} and kit ${kit}`, (t) => {
    const { player } = actor(t);
    give(player, real(ornamented));
    assert.equal(dismantle(player, real(ornamented)), true, "the option is handled");
    assert.deepEqual(ids(player), sortedIds([base, kit]));
    const returned = held(player).find((item) => item.getId() === kit);
    assert.equal(returned.isPresetItem(), false);
    // The Holy and Sanguine kits are untradeable by definition (Wiki infobox "tradeable = No", and the
    // cache agrees), so what must hold is that the kit comes back exactly as its definition says, with
    // no restriction metadata of its own.
    assert.equal(returned.isTradeable(), ItemDefinition.forId(kit).isTradeable(),
      "the kit's tradeability is its definition's, not a restriction we added");
    assert.equal(returned.isUnbankable(), false);
    assert.notEqual(returned.getMetaValue(core.Item.UNTRADEABLE_META), true);
  });
}

test("a full inventory refuses the dismantle and loses nothing", (t) => {
  const { player, messages } = actor(t);
  const fillers = Array.from({ length: 27 }, () => real(BONES));
  give(player, ...fillers, real(DRAGON_FULL_HELM_G));
  assert.equal(player.getInventory().getFreeSlots(), 0, "the inventory is full");
  dismantle(player, real(DRAGON_FULL_HELM_G));
  assert.equal(held(player).filter((item) => item.getId() === DRAGON_FULL_HELM_G).length, 1, "still ornamented");
  assert.equal(held(player).filter((item) => item.getId() === DRAGON_FULL_HELM_KIT).length, 0);
  assert.match(messages.join("\n"), /inventory space/);
});

test("a preset ornamented item is refused: the kit would be a free, unrestricted copy", (t) => {
  const { player, messages } = actor(t);
  give(player, preset(DRAGON_FULL_HELM_G));
  dismantle(player, preset(DRAGON_FULL_HELM_G));
  assert.deepEqual(ids(player), [DRAGON_FULL_HELM_G]);
  assert.equal(held(player)[0].isPresetItem(), true);
  assert.ok(messages.length >= 1, "the player is told why");
});

test("with a preset and a real ornamented item, the real one is the one taken apart", (t) => {
  const { player } = actor(t);
  const presetHelm = preset(DRAGON_FULL_HELM_G);
  give(player, presetHelm, real(DRAGON_FULL_HELM_G));
  dismantle(player, real(DRAGON_FULL_HELM_G));
  const left = held(player);
  assert.deepEqual(left.map((item) => item.getId()).sort((a, b) => a - b),
    sortedIds([DRAGON_FULL_HELM_G, DRAGON_FULL_HELM, DRAGON_FULL_HELM_KIT]));
  assert.equal(left.find((item) => item.getId() === DRAGON_FULL_HELM_G).isPresetItem(), true,
    "the preset ornamented helm is untouched");
  assert.equal(left.find((item) => item.getId() === DRAGON_FULL_HELM).isPresetItem(), false);
});

test("a kit the Wiki does not say is returned stays unreturned (Trailblazer graceful hood)", (t) => {
  const { player } = actor(t);
  give(player, real(TRAILBLAZER_GRACEFUL_HOOD));
  dismantle(player, real(TRAILBLAZER_GRACEFUL_HOOD));
  assert.equal(held(player).length, 1, "just the plain hood, no kit");
});

test("the infinity colour kits apply with their own kit, not the Occult ornament kit", (t) => {
  const INFINITY_HAT = 6918;
  const OCCULT_KIT = 20065;
  const cases = [[12528, 12457], [12530, 12419]];
  for (const [kit, result] of cases) {
    const { player } = actor(t);
    give(player, real(kit), real(INFINITY_HAT));
    const used = player.getInventory().getItems()[slotOf(player, real(kit))];
    const target = player.getInventory().getItems()[slotOf(player, real(INFINITY_HAT))];
    PluginManager.emitItemOnItem({
      player, usedItem: used, usedItemId: kit, usedItemSlot: slotOf(player, used),
      usedWithItem: target, usedWithItemId: INFINITY_HAT, usedWithItemSlot: slotOf(player, target), handled: false,
    });
    assert.deepEqual(ids(player), [result], `kit ${kit} makes ${result}`);
  }
  const { player } = actor(t);
  give(player, real(OCCULT_KIT), real(INFINITY_HAT));
  const used = player.getInventory().getItems()[slotOf(player, real(OCCULT_KIT))];
  const target = player.getInventory().getItems()[slotOf(player, real(INFINITY_HAT))];
  PluginManager.emitItemOnItem({
    player, usedItem: used, usedItemId: used.getId(), usedItemSlot: slotOf(player, used),
    usedWithItem: target, usedWithItemId: INFINITY_HAT, usedWithItemSlot: slotOf(player, target), handled: false,
  });
  assert.deepEqual(ids(player), sortedIds([OCCULT_KIT, INFINITY_HAT]), "the Occult kit does not fit an infinity hat");
});

// --- Applying kits -----------------------------------------------------------------------------

function useKit(player, kitValue, baseValue) {
  const items = player.getInventory().getItems();
  const kitSlot = slotOf(player, kitValue);
  const baseSlot = slotOf(player, baseValue);
  assert.ok(kitSlot >= 0 && baseSlot >= 0, "both items are in the inventory");
  return PluginManager.emitItemOnItem({
    player, usedItem: items[kitSlot], usedItemId: items[kitSlot].getId(), usedItemSlot: kitSlot,
    usedWithItem: items[baseSlot], usedWithItemId: items[baseSlot].getId(), usedWithItemSlot: baseSlot, handled: false,
  });
}

test("each kit fits only its own items: legs/skirt kit on platelegs and plateskirt, not the platebody kit", (t) => {
  for (const [base, result] of [[4087, 12415], [4585, 12416]]) {
    const { player } = actor(t);
    give(player, real(12536), real(base));
    useKit(player, real(12536), real(base));
    assert.deepEqual(ids(player), [result], `kit 12536 makes ${result}`);
  }
  const { player } = actor(t);
  give(player, real(22236), real(4087));
  useKit(player, real(22236), real(4087));
  assert.deepEqual(ids(player), sortedIds([22236, 4087]), "the platebody kit does not fit platelegs");
});

test("the defender kit trims the real dragon defender, not the Last Man Standing one", (t) => {
  const { player } = actor(t);
  give(player, real(20143), real(12954));
  useKit(player, real(20143), real(12954));
  assert.deepEqual(ids(player), [19722]);
  const { player: other } = actor(t);
  give(other, real(20143), real(23597));
  useKit(other, real(20143), real(23597));
  assert.deepEqual(ids(other), sortedIds([20143, 23597]));
});

test("Echo Ahrim's: undamaged goes in and comes out undamaged, a used piece stays used", (t) => {
  const ECHO_KIT = 30451;
  for (const [plain, echo] of [[4708, 30445], [4856, 30519], [4857, 30525]]) {
    const { player } = actor(t);
    give(player, real(ECHO_KIT), real(plain));
    useKit(player, real(ECHO_KIT), real(plain));
    assert.deepEqual(ids(player), [echo], `plain ${plain} becomes Echo ${echo}`);
    dismantle(player, real(echo));
    assert.deepEqual(ids(player), sortedIds([plain, ECHO_KIT]), `Echo ${echo} gives back plain ${plain} and the kit`);
  }
});

test("a restricted base or kit is refused when applying a kit, and nothing is consumed", (t) => {
  const kit = DRAGON_FULL_HELM_KIT;
  const { player, messages } = actor(t);
  const presetHelm = preset(DRAGON_FULL_HELM);
  give(player, real(kit), presetHelm);
  useKit(player, real(kit), presetHelm);
  assert.deepEqual(ids(player), sortedIds([kit, DRAGON_FULL_HELM]));
  assert.equal(held(player).find((item) => item.getId() === DRAGON_FULL_HELM).isPresetItem(), true);
  assert.ok(messages.length >= 1, "the player is told why");

  const { player: other } = actor(t);
  const presetKit = preset(kit);
  give(other, presetKit, real(DRAGON_FULL_HELM));
  useKit(other, presetKit, real(DRAGON_FULL_HELM));
  assert.deepEqual(ids(other), sortedIds([kit, DRAGON_FULL_HELM]), "a preset kit never makes a refundable item");
});

test("with a preset and a real kit, the real one is the one used", (t) => {
  const kit = DRAGON_FULL_HELM_KIT;
  const { player } = actor(t);
  const presetKit = preset(kit);
  give(player, presetKit, real(kit), real(DRAGON_FULL_HELM));
  useKit(player, real(kit), real(DRAGON_FULL_HELM));
  const left = held(player);
  assert.deepEqual(left.map((item) => item.getId()).sort((a, b) => a - b), sortedIds([kit, DRAGON_FULL_HELM_G]));
  assert.equal(left.find((item) => item.getId() === kit).isPresetItem(), true, "the preset kit is the one left");
});

test("the Echo kit does not apply to a piece that is already Echo", (t) => {
  const ECHO_KIT = 30451;
  for (const echo of [30445, 30519, 30525]) {
    const { player } = actor(t);
    give(player, real(ECHO_KIT), real(echo));
    useKit(player, real(ECHO_KIT), real(echo));
    assert.deepEqual(ids(player), sortedIds([ECHO_KIT, echo]), `Echo ${echo} is left as it is and the kit is kept`);
  }
});
