// Run after `yarn build`: node --test tests/gnome-restaurant-dishes.test.cjs
// Real Players prepare and garnish controlled baked inputs; actual native-menu
// and range baking coverage lives in gnome-restaurant.test.cjs. Toad is the control.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const src = (p) => path.join(__dirname, "..", "dist", p);

const DISHES = [
  { name: "toad crunchies (control)", menu: "Half baked crunchy", base: "half_baked_crunchy", slot: 0, half: 9581, baked: 9582, finisher: "equa_leaves", out: "toad_crunchies", items: [["toads_legs", 2], ["gnome_spice", 1]] },
  { name: "spicy crunchies", menu: "Half baked crunchy", base: "half_baked_crunchy", slot: 1, half: 9579, baked: 9580, finisher: "gnome_spice", out: "spicy_crunchies", items: [["equa_leaves", 2], ["gnome_spice", 1]], used: [["equa_leaves", 2]] },
  { name: "worm crunchies", menu: "Half baked crunchy", base: "half_baked_crunchy", slot: 2, half: 9583, baked: 9584, finisher: "gnome_spice", out: "worm_crunchies", items: [["king_worm", 2], ["equa_leaves", 1], ["gnome_spice", 1]], used: [["king_worm", 2], ["equa_leaves", 1]] },
  { name: "fruit batta", menu: "Half baked batta", base: "half_baked_batta", slot: 0, half: 9478, baked: 9479, finisher: "gnome_spice", out: "fruit_batta", items: [["equa_leaves", 4], ["lime_chunks", 1], ["orange_chunks", 1], ["pineapple_chunks", 1]] },
  { name: "worm batta", menu: "Half baked batta", base: "half_baked_batta", slot: 2, half: 9480, baked: 9481, finisher: "equa_leaves", out: "worm_batta", items: [["king_worm", 1], ["cheese", 1], ["gnome_spice", 1]], used: [["king_worm", 1], ["cheese", 1]] },
  { name: "vegetable batta", menu: "Half baked batta", base: "half_baked_batta", slot: 3, half: 9485, baked: 9486, finisher: "equa_leaves", out: "vegetable_batta", items: [["tomato", 2], ["dwellberries", 1], ["onion", 1], ["cheese", 1], ["cabbage", 1]] },
];

test("easy-order preparations and garnishes retain spice and consume leaves", async (t) => {
  require(src("Server")).Server.installProductionPathResolver();
  await require(src("game/cache/CachePipeline")).CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { PluginManager } = require(src("plugins/PluginManager"));
  const { Player } = require(src("game/entity/impl/player/Player"));
  const { PlayerSession } = require(src("net/PlayerSession"));
  const { Skill } = require(src("game/model/Skill"));
  const api = PluginManager.createApi("GnomeDishesProbe");
  const actions = new Map(), clicks = [], onItems = [];
  const capture = Object.create(api);
  capture.onItemAction = (name, map) => { actions.set(name, map); return api.onItemAction(name, map); };
  capture.onInterfaceActionClick = (fn) => { clicks.push(fn); return api.onInterfaceActionClick(fn); };
  capture.onItemOnItem = (fn, o) => { onItems.push(fn); return api.onItemOnItem(fn, o); };
  require(path.join(__dirname, "..", "plugins/skills/cooking/Cookers.Cooking"))(capture);
  require(path.join(__dirname, "..", "plugins/skills/cooking/Gnome.Cooking"))(capture);
  const core = PluginManager.getCoreApi(), C = core.CacheDefinitions, obj = (n) => C.getObjId(n);
  const group = C.getInterfaceId("aluft_cooking");
  const click = C.getComponentId("aluft_cooking:cuisine_clickzone"), create = C.getComponentId("aluft_cooking:confirmation");
  const allRows = JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "plugins/skills/data/cooking.json"), "utf8")));
  for (const d of DISHES) {
    const session = new PlayerSession({ isOpen: () => true, send: () => {} });
    const player = new Player(session); session.setPlayer(player); player.setUsername("dish" + DISHES.indexOf(d));
    player.setRegistered(true);
    player.getSkillManager().setLevel(Skill.COOKING, 60);
    const inv = player.getInventory();
    inv.adds(obj(d.base), 1);
    for (const [n, a] of d.items) inv.adds(obj(n), a);
    const slot = inv.getItems().findIndex((i) => i?.getId() === obj(d.base));
    actions.get(d.menu).Prepare({ player, item: inv.getItems()[slot], slot, itemId: obj(d.base) });
    assert.equal(player.getInterfaceId(), group, `${d.name}: the menu opened`);
    for (const fn of clicks) fn({ player, buttonId: click, slot: d.slot, action: 1 });
    for (const fn of clicks) fn({ player, buttonId: create, action: 1 });
    assert.equal(inv.getAmount(d.half), 1, `${d.name}: half made item ${d.half} made`);
    for (const [n] of d.used ?? d.items.filter(([n]) => n !== "gnome_spice")) assert.equal(inv.getAmount(obj(n)), 0, `${d.name}: ${n} used`);
    assert.match(allRows, new RegExp(`"raw":${d.half},"cooked":${d.baked},`), `${d.name}: bake row ${d.half} -> ${d.baked} in cooking.json`);
    inv.adds(d.baked, 1);
    if (!inv.getAmount(obj(d.finisher))) inv.adds(obj(d.finisher), 1);
    const bs = inv.getItems().findIndex((i) => i?.getId() === d.baked), fs2 = inv.getItems().findIndex((i) => i?.getId() === obj(d.finisher));
    const xp0 = player.getSkillManager().getExperience(Skill.COOKING);
    const ev = { player, usedItem: inv.getItems()[bs], usedItemId: d.baked, usedItemSlot: bs, usedWithItem: inv.getItems()[fs2], usedWithItemId: obj(d.finisher), usedWithItemSlot: fs2 };
    for (const fn of onItems) fn(ev);
    assert.equal(inv.getAmount(obj(d.out)), 1, `${d.name}: the finished dish (${d.out}) is in the pack`);
    assert.equal(inv.getAmount(d.baked), 0, `${d.name}: the baked item is used up`);
    if (d.finisher === "gnome_spice") assert.equal(inv.getAmount(obj("gnome_spice")), 1, `${d.name}: reusable spice remains`);
    else assert.equal(inv.getAmount(obj(d.finisher)), 0, `${d.name}: the garnish leaf is consumed`);
    const gained = player.getSkillManager().getExperience(Skill.COOKING) - xp0;
    assert.ok(gained > 0, `${d.name}: Cooking XP`);
  }
  const { UseItemPacketListener } = require(src("net/packet/impl/UseItemPacketListener"));
  let actorIndex = 0;
  function actor() {
    const session = new PlayerSession({ isOpen: () => true, send: () => {} }), p = new Player(session);
    session.setPlayer(p); p.setUsername("spicetest" + actorIndex++); p.setRegistered(true);
    p.getInventory().adds(9580, 1); p.getInventory().adds(obj("gnome_spice"), 1);
    return p;
  }
  const snapshot = p => p.getInventory().getItems().map(item => [item.getId(), item.getAmount(), item.getMeta()]);
  const xp = p => p.getSkillManager().getExperience(Skill.COOKING);
  const slot = (p, value) => p.getInventory().getSlotForItemId(value);
  await t.test("selected restricted spice cannot fall back to a plain spare", () => {
    for (const key of [core.Item.PRESET_META, core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META]) {
      const p = actor(), inv = p.getInventory(), selected = slot(p, obj("gnome_spice"));
      inv.getItems()[selected].setMetaValue(key, true); inv.adds(obj("gnome_spice"), 1);
      const before = snapshot(p), beforeXp = xp(p);
      UseItemPacketListener.itemOnItem(p, slot(p, 9580), selected);
      assert.deepEqual(snapshot(p), before); assert.equal(xp(p), beforeXp);
      const plain = inv.getItems().findIndex(item => item.getId() === obj("gnome_spice") && !item.isPresetItem() && !item.isUntradeable() && !item.isUnbankable());
      assert.ok(plain >= 0); UseItemPacketListener.itemOnItem(p, plain, slot(p, 9580));
      assert.equal(inv.getAmount(obj("spicy_crunchies")), 1); assert.equal(inv.getAmount(obj("gnome_spice")), 2);
    }
  });
  await t.test("a real slot move rejects an adversarial stale event; fresh native use succeeds in a full pack", () => {
    const p = actor(), inv = p.getInventory(), sourceSlot = slot(p, 9580), toolSlot = slot(p, obj("gnome_spice"));
    const selectedTool = inv.getItems()[toolSlot];
    const stale = { player: p, usedItem: inv.getItems()[sourceSlot], usedItemId: 9580, usedItemSlot: sourceSlot,
      usedWithItem: selectedTool, usedWithItemId: obj("gnome_spice"), usedWithItemSlot: toolSlot, handled: false };
    inv.swap(toolSlot, 5); inv.refreshItems();
    const before = snapshot(p), beforeXp = xp(p);
    // Native item-on-item is synchronous; this stale hook event is adversarial.
    PluginManager.emitItemOnItem(stale);
    assert.deepEqual(snapshot(p), before); assert.equal(xp(p), beforeXp);
    inv.adds(obj("bread"), inv.getFreeSlots()); assert.equal(inv.getFreeSlots(), 0);
    UseItemPacketListener.itemOnItem(p, 5, slot(p, 9580));
    assert.equal(inv.getAmount(obj("spicy_crunchies")), 1); assert.equal(inv.getAmount(obj("gnome_spice")), 1);
    assert.equal(inv.getItems()[5], selectedTool); assert.equal(inv.getFreeSlots(), 0); assert.equal(xp(p) - beforeXp, 42);
  });
  await t.test("malformed selected tool amount is rejected without food or XP", () => {
    const p = actor(), inv = p.getInventory(), selected = slot(p, obj("gnome_spice"));
    inv.getItems()[selected].setAmount(2);
    const before = snapshot(p), beforeXp = xp(p);
    UseItemPacketListener.itemOnItem(p, slot(p, 9580), selected);
    assert.deepEqual(snapshot(p), before); assert.equal(xp(p), beforeXp);
  });
});
