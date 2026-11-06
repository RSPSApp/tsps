// Run after yarn build: node --test tests/webweaver-bow.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Bow = require("../plugins/items/WebweaverBow.plugin");
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const B = Bow._test;
const hooks = {};
const events = {};
let cycle = 100;
const ground = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  Bow.register({
    core: { ...core, World: { getProcessCycle: () => cycle }, ItemOnGroundManager: { registerLocation: (owner, item) => ground.push({ owner, item }) } },
    onItemOnItem: (handler) => { hooks.charge = handler; },
    onItemAction() {},
    registerRangedAmmoHandler: (handler) => { hooks.ammo = handler; },
    registerRangedCombatModifier: (handler) => { hooks.boost = handler; },
    onPlayerDeathItemDrop: (handler) => { hooks.death = handler; },
    emitCustomEvent: (name, request) => events[name]?.(request),
  });
});

function player() {
  const p = new Player(null);
  p.setUsername("webweaver-test");
  const messages = [];
  const sender = new Proxy({}, { get: (_, key) => key === "sendEnterAmountPrompt"
    ? (text) => { p.prompt = text; }
    : () => sender });
  p.getPacketSender = () => sender;
  p.sendMessage = (message) => messages.push(message);
  p.setEnteredAmountAction = (action) => { p.amountAction = action; };
  p.messages = messages;
  return p;
}

// A charged bow is activated through addEther unless `paid` is false (a shop, spawn or old save).
function bow(p, charges, worn = false, paid = true) {
  const item = new core.Item(charges === null ? I.WEBWEAVER_BOW_U_ : I.WEBWEAVER_BOW, 1);
  if (charges) item.setMetaValue(B.CHARGES_META, charges);
  if (charges !== null && paid) item.setMetaValue(B.DEPOSIT_META, true);
  if (worn) p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = item;
  else p.getInventory().addItem(item);
  return worn ? item : p.getInventory().getItems().find((held) => held.getId() === item.getId());
}

function charge(p, item) {
  const ether = p.getInventory().getItems().find((held) => held.getId() === I.REVENANT_ETHER);
  const request = { player: p, usedItem: ether, usedWithItem: item };
  hooks.charge(request);
  return request;
}

test("ether activates the bow, caps usable charges at 16,000 and conserves every ether on uncharge", () => {
  const p = player();
  const item = bow(p, null);
  p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 20000));
  assert.equal(charge(p, item).handled, true);
  assert.match(p.prompt, /0 - 16,000/);
  p.amountAction.execute(20000);
  assert.equal(item.getId(), I.WEBWEAVER_BOW);
  assert.equal(B.chargesOf(item), 16000);
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 3000);
  B.uncharge({ player: p, item });
  assert.equal(item.getId(), I.WEBWEAVER_BOW_U_);
  assert.equal(B.chargesOf(item), 0);
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 20000);
});

test("activation-only, insufficient ether, top-ups and a stale amount prompt cannot create ether", () => {
  const p = player();
  const item = bow(p, null);
  p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 999));
  charge(p, item);
  assert.equal(p.amountAction, undefined);
  p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 1));
  charge(p, item);
  p.amountAction.execute(0);
  assert.equal(item.getId(), I.WEBWEAVER_BOW);
  assert.equal(B.chargesOf(item), 0);
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 0);
  p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 10));
  charge(p, item);
  p.getInventory().deleteNumber(I.REVENANT_ETHER, 7);
  p.amountAction.execute(10);
  assert.equal(B.chargesOf(item), 3);
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 0);
  p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 10));
  charge(p, item);
  const slot = p.getInventory().getItems().indexOf(item);
  p.getInventory().getItems()[slot] = new core.Item(-1, 0);
  p.amountAction.execute(10);
  assert.equal(B.chargesOf(item), 3);
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 10);
});

test("restricted ether and preset bows cannot fund charges or refundable activation reserves", () => {
  for (const presetBow of [true, false]) {
    const p = player();
    const item = bow(p, null);
    const ether = new core.Item(I.REVENANT_ETHER, 2000);
    (presetBow ? item : ether).setMetaValue(core.Item.PRESET_META, true);
    p.getInventory().addItem(ether);
    charge(p, item);
    assert.equal(p.amountAction, undefined);
    assert.equal(item.getId(), I.WEBWEAVER_BOW_U_);
    assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 2000);
  }
  const p = player();
  const item = bow(p, 1);
  item.setMetaValue(core.Item.PRESET_META, true);
  B.uncharge({ player: p, item });
  assert.equal(item.getId(), I.WEBWEAVER_BOW);
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 0);
});

test("each attack spends one charge from its own bow; an empty bow stays activated and refuses another shot", () => {
  const p = player();
  const item = bow(p, 2, true);
  const spare = bow(p, 15);
  for (const special of [false, true]) {
    p.setSpecialActivated(special);
    assert.equal(hooks.ammo.checkAmmo(p, 1), true);
    hooks.ammo.decrementAmmo(p, null, special ? 4 : 1);
  }
  assert.equal(B.chargesOf(item), 0);
  assert.equal(item.getId(), I.WEBWEAVER_BOW);
  assert.equal(B.chargesOf(spare), 15);
  assert.equal(hooks.ammo.checkAmmo(p, 1), false);
  for (const other of [I.CRAWS_BOW, I.VIGGORAS_CHAINMACE, I.URSINE_CHAINMACE, I.ACCURSED_SCEPTRE]) {
    p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = new core.Item(other, 1);
    assert.equal(hooks.ammo.checkAmmo(p, 1), null);
    assert.equal(hooks.ammo.decrementAmmo(p, null, 1), false);
  }
});

test("the last paid shot keeps its 50% Wilderness NPC bonus, with no PvP or outside-Wilderness bonus", () => {
  const p = player();
  bow(p, 1, true);
  const target = (npc, wild) => ({ isNpc: () => npc, getLocation: () => new core.Location(3090, wild ? 3600 : 3490, 0) });
  hooks.ammo.decrementAmmo(p);
  for (const modify of [hooks.boost.modifyMaxHit, hooks.boost.modifyAttackRoll]) {
    assert.equal(modify(p, target(true, true), 100), 150);
    assert.equal(modify(p, target(true, false), 100), 100);
    assert.equal(modify(p, target(false, true), 100), 100);
  }
  cycle++;
  assert.equal(hooks.boost.modifyMaxHit(p, target(true, true), 100), 100);
});

test("charge-saving content preserves the charge and still gets its passive", () => {
  const p = player();
  const item = bow(p, 1, true);
  events["combat:consume-charge"] = (request) => { request.skip = true; };
  hooks.ammo.decrementAmmo(p);
  delete events["combat:consume-charge"];
  assert.equal(B.chargesOf(item), 1);
});

test("the passive multiplies Salve (i)/(ei) ranged bonuses; Salve (e) has no ranged bonus", () => {
  const salve = require("../plugins/combat/effects/SalveAmulet.EquipmentEffects")._test;
  const p = player();
  bow(p, 2, true);
  const target = {
    isNpc: () => true,
    getAsNpc() { return this; },
    getCurrentDefinition: () => ({ hasAttribute: (attribute) => attribute === "undead" }),
    getLocation: () => new core.Location(3090, 3600, 0),
  };
  p.getCombat = () => ({ getTarget: () => target });
  for (const [id, expected] of [[I.SALVE_AMULET_E_, 150], [I.SALVE_AMULET_I_, 174], [I.SALVE_AMULET_EI_, 180]]) {
    p.getEquipment().getItems()[core.Equipment.AMULET_SLOT] = new core.Item(id, 1);
    assert.equal(B.boost(p, target, salve.rangedBoost(p, 100)), expected);
  }
});

test("uncharge checks refund space before changing the bow", () => {
  const p = player();
  const item = bow(p, 2);
  p.getInventory().getAddableAmount = () => 0;
  B.uncharge({ player: p, item });
  assert.equal(item.getId(), I.WEBWEAVER_BOW);
  assert.equal(B.chargesOf(item), 2);
});

test("Wilderness PvP loses reserve and charges even when protected; other deaths preserve normal handling", () => {
  for (const kept of [true, false]) {
    ground.length = 0;
    const p = player();
    const item = bow(p, 7);
    const killer = player();
    hooks.death({ player: p, killer, item, kept, shouldDropItems: true, location: new core.Location(3090, 3600, 0) });
    assert.equal(item.getId(), I.WEBWEAVER_BOW_U_);
    assert.equal(B.chargesOf(item), 0);
    assert.equal(ground.length, 1);
    assert.equal(ground[0].owner, killer);
    assert.equal(ground[0].item.getAmount(), 1007);
  }
  for (const [wild, dangerous] of [[false, true], [true, false]]) {
    const p = player();
    const item = bow(p, 7);
    hooks.death({ player: p, killer: player(), item, kept: false, shouldDropItems: dangerous, location: new core.Location(3090, wild ? 3600 : 3490, 0) });
    assert.equal(item.getId(), I.WEBWEAVER_BOW);
    assert.equal(B.chargesOf(item), 7);
  }
});

test("a charged bow without a paid deposit (shop, spawn, older save) refunds only its charges on uncharge", () => {
  for (const charges of [0, 5]) {
    const p = player();
    const item = bow(p, charges, false, false);
    B.uncharge({ player: p, item });
    assert.equal(item.getId(), I.WEBWEAVER_BOW_U_);
    assert.equal(B.chargesOf(item), 0);
    assert.equal(item.getMetaValue(B.DEPOSIT_META), undefined);
    assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), charges);
    assert.equal(p.messages.at(-1), charges ? "You uncharge your bow, regaining 5 revenant ether." : "You uncharge your bow.");
  }
});

test("Wilderness PvP death of a bow without a paid deposit drops only its charges", () => {
  for (const charges of [0, 7]) {
    ground.length = 0;
    const p = player();
    const item = bow(p, charges, false, false);
    hooks.death({ player: p, killer: player(), item, kept: false, shouldDropItems: true, location: new core.Location(3090, 3600, 0) });
    assert.equal(item.getId(), I.WEBWEAVER_BOW_U_);
    assert.deepEqual(ground.map(({ item }) => item.getAmount()), charges ? [7] : []);
  }
});

test("charging a charged bow without a paid deposit takes the 1,000 activation ether first", () => {
  const p = player();
  const item = bow(p, 3, false, false);
  p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 999));
  charge(p, item);
  assert.equal(p.amountAction, undefined);
  assert.match(p.messages.at(-1), /need 1,000 revenant ether/);
  p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 501));
  charge(p, item);
  assert.match(p.prompt, /0 - 500/);
  p.amountAction.execute(500);
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 0);
  assert.equal(B.chargesOf(item), 503);
  assert.equal(item.getMetaValue(B.DEPOSIT_META), true);
  B.uncharge({ player: p, item });
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 1503);
});

test("a bow activated through ether still loses its deposit and charges to the PvP killer", () => {
  ground.length = 0;
  const p = player();
  const item = bow(p, null);
  p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 1004));
  charge(p, item);
  p.amountAction.execute(4);
  const killer = player();
  hooks.death({ player: p, killer, item, kept: false, shouldDropItems: true, location: new core.Location(3090, 3600, 0) });
  assert.equal(item.getId(), I.WEBWEAVER_BOW_U_);
  assert.equal(item.getMetaValue(B.DEPOSIT_META), undefined);
  assert.equal(ground.length, 1);
  assert.equal(ground[0].owner, killer);
  assert.equal(ground[0].item.getAmount(), 1004);
});

test("Wilderness PvM retains charges for the general death and grave rules", () => {
  const p = player();
  const item = bow(p, 8);
  const event = { player: p, killer: null, item, kept: true, shouldDropItems: true, location: new core.Location(3090, 3600, 0) };
  hooks.death(event);
  assert.equal(B.chargesOf(item), 8);
  assert.equal(item.getId(), I.WEBWEAVER_BOW);
});

test("the actual death producer drops an unprotected bow and ether, keeps only a protected bow, and respects developer immunity", (t) => {
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  t.mock.method(PluginManager, "emitPlayerDeathItemDrop", (event) => { hooks.death(event); return event.handled === true; });
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item) => ground.push({ owner, item }));
  for (const protectedBow of [true, false]) {
    ground.length = 0;
    const p = player();
    const killer = player();
    const item = bow(p, 10, true);
    p.setLocation(new core.Location(3090, 3600, 0));
    p.setSkullTimer(protectedBow ? 0 : 100);
    const kept = PlayerDeathTask.dropItems(p, killer, p.getLocation());
    assert.deepEqual(kept, protectedBow ? [item] : []);
    assert.equal(item.getId(), I.WEBWEAVER_BOW_U_);
    assert.equal(ground.filter(({ item }) => item.getId() === I.REVENANT_ETHER)[0].item.getAmount(), 1010);
    assert.equal(ground.filter(({ item }) => item.getId() === I.WEBWEAVER_BOW_U_).length, protectedBow ? 0 : 1);
    assert.equal(killer.messages.some((message) => message.includes("no valuable items")), false);
  }
  ground.length = 0;
  const p = player();
  p.setRights(core.PlayerRights.DEVELOPER);
  p.setLocation(new core.Location(3090, 3600, 0));
  const item = bow(p, 10, true);
  assert.deepEqual(PlayerDeathTask.dropItems(p, player(), p.getLocation()), [item]);
  assert.equal(item.getId(), I.WEBWEAVER_BOW);
  assert.equal(B.chargesOf(item), 10);
  assert.equal(ground.length, 0);
});
