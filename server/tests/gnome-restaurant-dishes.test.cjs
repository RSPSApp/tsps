// Run after `yarn build`: node --test tests/gnome-restaurant-dishes.test.cjs
// A real Player makes each easy-order dish through the gnome cuisine menu: Prepare on the half baked crunchy or batta, pick the dish and
// create; the bake row in cooking.json; then the garnish on the baked dish. Toad crunchies are the control.
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

test("the five easy-order dishes can be prepared, baked and garnished", async () => {
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
    player.isRegistered = () => true;
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
    const gained = player.getSkillManager().getExperience(Skill.COOKING) - xp0;
    assert.ok(gained > 0, `${d.name}: Cooking XP`);
  }
});
