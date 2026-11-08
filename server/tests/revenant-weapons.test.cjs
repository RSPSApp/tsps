// Run after yarn build: node --test tests/revenant-weapons.test.cjs
// Viggora's chainmace, the Ursine chainmace and Craw's bow: ether activation, one ether an attack,
// the Wilderness passive, Uncharge, Dismantle and the death drop (docs/revenant-weapons.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Weapons = require("../plugins/items/RevenantWeapons.plugin");
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const W = Weapons._test;
const hooks = {};
const actions = {};
const events = {};
const ground = [];
let cycle = 100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  Weapons.register({
    core: { ...core, World: { getProcessCycle: () => cycle }, ItemOnGroundManager: { registerLocation: (owner, item) => ground.push({ owner, item }) } },
    onItemOnItem: (handler) => { hooks.charge = handler; },
    onItemAction: (name, options) => { actions[name] = options; },
    onCustomEvent: (name, handler) => { hooks[name] = handler; },
    registerRangedAmmoHandler: (handler) => { hooks.ammo = handler; },
    registerRangedCombatModifier: (handler) => { hooks.ranged = handler; },
    registerMeleeHitModifier: (handler) => { hooks.meleeHit = handler; },
    registerMeleeAttackAccuracyModifier: (handler) => { hooks.meleeAccuracy = handler; },
    onPlayerDeathItemDrop: (handler) => { hooks.death = handler; },
    emitCustomEvent: (name, request) => events[name]?.(request),
  });
});

const WEAPONS = [
  { name: "Viggora's chainmace", label: "chainmace", charged: I.VIGGORAS_CHAINMACE, uncharged: I.VIGGORAS_CHAINMACE_U_, melee: true },
  { name: "Ursine chainmace", label: "chainmace", charged: I.URSINE_CHAINMACE, uncharged: I.URSINE_CHAINMACE_U_, melee: true },
  { name: "Craw's bow", label: "bow", charged: I.CRAWS_BOW, uncharged: I.CRAWS_BOW_U_, melee: false },
];
const [VIGGORA, URSINE, CRAW] = WEAPONS;

function player() {
  const p = new Player(null);
  p.setUsername("revenant-weapon-test");
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

// An activated weapon holding `charges` (null: the uncharged one), worn or carried.
function weapon(p, kind, charges, worn = false) {
  const item = new core.Item(charges === null ? kind.uncharged : kind.charged, 1);
  if (charges) item.setMetaValue(W.CHARGES_META, charges);
  if (charges !== null) item.setMetaValue(W.DEPOSIT_META, true);
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

const npc = (wild) => ({ isNpc: () => true, getLocation: () => new core.Location(3090, wild ? 3600 : 3490, 0) });
const fighting = (p, target) => { p.getCombat = () => ({ getTarget: () => target }); };
const swing = (p, target) => hooks["combat:attack-started"]({ attacker: p, target, method: { type: () => core.CombatType.MELEE } });

for (const kind of WEAPONS) {
  test(`${kind.name}: 1,000 ether activates it, 16,000 more are charges, Uncharge returns every ether`, () => {
    const p = player();
    const item = weapon(p, kind, null);
    p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 20000));
    assert.equal(charge(p, item).handled, true);
    assert.match(p.prompt, /0 - 16,000/);
    p.amountAction.execute(20000);
    assert.equal(item.getId(), kind.charged);
    assert.equal(W.chargesOf(item), 16000);
    assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 3000);
    assert.deepEqual(p.messages.slice(0, 2), [
      "You use 1,000 ether to activate the weapon.",
      "You add a further 16,000 revenant ether to your weapon, giving it a total of 16,000 charges.",
    ]);
    actions[kind.name].Check({ player: p, item });
    assert.equal(p.messages.at(-1), `Your ${kind.label} has 16,000 charges left powering it.`);
    assert.equal(actions[kind.name].Uncharge({ player: p, item }), true);
    assert.equal(item.getId(), kind.uncharged);
    assert.equal(W.chargesOf(item), 0);
    assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 20000);
  });

  test(`${kind.name}: under 1,000 ether it cannot be activated; a full one takes no more`, () => {
    const p = player();
    const item = weapon(p, kind, null);
    p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 999));
    charge(p, item);
    assert.equal(p.amountAction, undefined);
    assert.equal(p.messages.at(-1), "You need 1,000 revenant ether to activate the weapon.");
    const full = weapon(p, kind, 16000);
    p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 50));
    charge(p, full);
    assert.equal(p.amountAction, undefined);
    assert.equal(p.messages.at(-1), `Your ${kind.label} cannot hold any more ether.`);
  });

  test(`${kind.name}: Dismantle on the uncharged one gives 7,500 ether; a charged one cannot be dismantled`, () => {
    const p = player();
    const item = weapon(p, kind, null);
    assert.equal(actions[`${kind.name} (u)`].Dismantle({ player: p, item }), true);
    assert.equal(p.getInventory().getAmount(kind.uncharged), 0);
    assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), W.DISMANTLE_ETHER);
    const charged = weapon(p, kind, 5);
    assert.equal(W.dismantle({ player: p, item: charged }), false);
    assert.equal(p.getInventory().getAmount(kind.charged), 1);
  });

  test(`${kind.name}: a refused Dismantle keeps the weapon`, () => {
    // The ether stack can't take 7,500 more: the weapon was deleted and the emptied slot "restored".
    const p = player();
    const item = weapon(p, kind, null);
    p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 2147483647 - 1000));
    assert.equal(actions[`${kind.name} (u)`].Dismantle({ player: p, item }), true);
    assert.equal(p.messages.at(-1), `You don't have enough inventory space to dismantle your ${kind.label}.`);
    assert.equal(p.getInventory().getAmount(kind.uncharged), 1, "the weapon is still there");
  });

  test(`${kind.name}: Wilderness PvP death loses the activation ether and charges, protected or not`, () => {
    for (const kept of [true, false]) {
      ground.length = 0;
      const p = player();
      const item = weapon(p, kind, 7);
      hooks.death({ player: p, killer: player(), item, kept, shouldDropItems: true, location: new core.Location(3090, 3600, 0) });
      assert.equal(item.getId(), kind.uncharged);
      assert.equal(W.chargesOf(item), 0);
      assert.equal(ground[0].item.getAmount(), 1007);
    }
    const p = player();
    const item = weapon(p, kind, 7);
    hooks.death({ player: p, killer: player(), item, kept: false, shouldDropItems: true, location: new core.Location(3090, 3490, 0) });
    assert.equal(item.getId(), kind.charged);
    assert.equal(W.chargesOf(item), 7);
  });
}

test("a melee swing spends one ether, in or out of the Wilderness, and an empty chainmace swings uncharged", () => {
  for (const kind of [VIGGORA, URSINE]) {
    const p = player();
    const item = weapon(p, kind, 2, true);
    swing(p, npc(false));
    assert.equal(W.chargesOf(item), 1);
    swing(p, npc(true));
    assert.equal(W.chargesOf(item), 0);
    assert.equal(item.getId(), kind.charged);
    swing(p, npc(true));
    assert.equal(W.chargesOf(item), 0);
    const bare = player();
    const plain = weapon(bare, kind, null, true);
    swing(bare, npc(true));
    assert.equal(plain.getId(), kind.uncharged);
    assert.equal(W.chargesOf(plain), 0);
  }
});

test("Craw's bow fires only with ether and spends one a shot", () => {
  const p = player();
  const item = weapon(p, CRAW, 2, true);
  assert.equal(hooks.ammo.checkAmmo(p, 1), true);
  hooks.ammo.decrementAmmo(p, null, 1);
  hooks.ammo.decrementAmmo(p, null, 1);
  assert.equal(W.chargesOf(item), 0);
  assert.equal(item.getId(), CRAW.charged);
  assert.equal(hooks.ammo.checkAmmo(p, 1), false);
  assert.equal(p.messages.at(-1), "There is not enough revenant ether left powering your bow.");
  const unactivated = weapon(player(), CRAW, null, true);
  const q = player();
  q.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = unactivated;
  assert.equal(hooks.ammo.checkAmmo(q, 1), false);
  for (const other of [I.WEBWEAVER_BOW, I.VIGGORAS_CHAINMACE, I.ACCURSED_SCEPTRE, I.THAMMARONS_SCEPTRE]) {
    q.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = new core.Item(other, 1);
    assert.equal(hooks.ammo.checkAmmo(q, 1), null);
    assert.equal(hooks.ammo.decrementAmmo(q, null, 1), false);
  }
});

test("charged, the melee passive is +50% accuracy and damage against Wilderness NPCs only", () => {
  const p = player();
  weapon(p, VIGGORA, 3, true);
  const modify = (wild, npcTarget = true) => {
    const target = { ...npc(wild), isNpc: () => npcTarget };
    fighting(p, target);
    return [hooks.meleeHit(p, 100), hooks.meleeAccuracy(p, 100)];
  };
  assert.deepEqual(modify(true), [150, 150]);
  assert.deepEqual(modify(false), [100, 100]);
  assert.deepEqual(modify(true, false), [100, 100]);
  const other = player();
  weapon(other, VIGGORA, null, true);
  fighting(other, npc(true));
  assert.deepEqual([hooks.meleeHit(other, 100), hooks.meleeAccuracy(other, 100)], [100, 100]);
});

test("the last ether keeps the passive for the attack it paid for, and the next one has none", () => {
  const p = player();
  weapon(p, URSINE, 1, true);
  const target = npc(true);
  fighting(p, target);
  swing(p, target);
  assert.equal(hooks.meleeHit(p, 100), 150);
  cycle++;
  assert.equal(hooks.meleeHit(p, 100), 100);
});

test("Craw's bow gets the same passive on ranged accuracy and damage", () => {
  const p = player();
  weapon(p, CRAW, 1, true);
  hooks.ammo.decrementAmmo(p);
  for (const modify of [hooks.ranged.modifyMaxHit, hooks.ranged.modifyAttackRoll]) {
    assert.equal(modify(p, npc(true), 100), 150);
    assert.equal(modify(p, npc(false), 100), 100);
  }
  cycle++;
  assert.equal(hooks.ranged.modifyMaxHit(p, npc(true), 100), 100);
});

test("charge-saving content keeps the ether and the passive", () => {
  const p = player();
  const item = weapon(p, VIGGORA, 1, true);
  events["combat:consume-charge"] = (request) => { request.skip = true; };
  swing(p, npc(true));
  delete events["combat:consume-charge"];
  assert.equal(W.chargesOf(item), 1);
});

test("a weapon without a paid deposit refunds and drops only its charges", () => {
  const p = player();
  const bought = new core.Item(CRAW.charged, 1);
  bought.setMetaValue(W.CHARGES_META, 5);
  p.getInventory().addItem(bought);
  const item = p.getInventory().getItems().find((held) => held.getId() === CRAW.charged);
  actions[CRAW.name].Uncharge({ player: p, item });
  assert.equal(item.getId(), CRAW.uncharged);
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 5);
});

test("a weapon bought before the deposit rule cannot be Uncharged then Dismantled for ether", () => {
  for (const kind of WEAPONS) {
    const p = player();
    const bought = new core.Item(kind.charged, 1);
    p.getInventory().addItem(bought);
    const item = p.getInventory().getItems().find((held) => held.getId() === kind.charged);
    actions[kind.name].Uncharge({ player: p, item });
    assert.equal(item.getId(), kind.uncharged);
    assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 0);
    assert.equal(actions[`${kind.name} (u)`].Dismantle({ player: p, item }), true);
    assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 0, `${kind.name}: no ether from dismantling`);
    assert.equal(p.getInventory().getAmount(kind.uncharged), 1, `${kind.name}: the weapon is kept`);
  }
});

test("activating an unpaid weapon again does not clear the mark, so Dismantle stays refused", () => {
  const p = player();
  const bought = new core.Item(CRAW.charged, 1);
  p.getInventory().addItem(bought);
  const item = p.getInventory().getItems().find((held) => held.getId() === CRAW.charged);
  actions[CRAW.name].Uncharge({ player: p, item });
  p.getInventory().addItem(new core.Item(I.REVENANT_ETHER, 1000));
  W.addEther(p, item, 0);
  actions[CRAW.name].Uncharge({ player: p, item });
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 1000);
  actions[`${CRAW.name} (u)`].Dismantle({ player: p, item });
  assert.equal(p.getInventory().getAmount(I.REVENANT_ETHER), 1000);
  assert.equal(p.getInventory().getAmount(CRAW.uncharged), 1);
});
