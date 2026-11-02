// Run after `yarn build`: node --test tests/powered-staves.test.cjs
// Powered staves (plugins/items/PoweredStaff.js, docs/powered-staves.md): the tridents and their
// (e) versions, the Eye of Ayak and the Accursed sceptre, with Soul Rend and Condemn.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { Item } = require("../dist/game/model/Item");
const { Location } = require("../dist/game/model/Location");
const { FightType } = require("../dist/game/content/combat/FightType");

const core = PluginManager.getCoreApi();

function register(plugin) {
  const hooks = { resolvers: [], events: new Map(), actions: new Map(), itemOnItem: [], specials: [] };
  plugin.register({
    core,
    registerCombatMethodResolver: (resolver) => hooks.resolvers.push(resolver),
    registerCombatSpecial: (special) => hooks.specials.push(special),
    onCustomEvent: (name, handler) => hooks.events.set(name, [...(hooks.events.get(name) ?? []), handler]),
    emitCustomEvent: (name, payload) => (hooks.events.get(name) ?? []).forEach((handler) => handler(payload)),
    onItemAction: (name, actions) => hooks.actions.set(name, actions),
    onItemOnItem: (handler) => hooks.itemOnItem.push(handler),
    onPlayerLogin() {},
  });
  return hooks;
}

const Trident = require("../plugins/items/Trident.plugin");
const EyeOfAyak = require("../plugins/items/EyeOfAyak.plugin");
const Accursed = require("../plugins/items/AccursedSceptre.plugin");
const trident = register(Trident);
const eye = register(EyeOfAyak);
const accursed = register(Accursed);

function player({ weapon = null, magic = 99, items = {}, at = new Location(3200, 3200, 0) } = {}) {
  const equipment = new Array(14).fill(null);
  equipment[core.Equipment.WEAPON_SLOT] = weapon;
  const amounts = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const inventoryItems = [];
  const state = { castSpell: null, reset: false, messages: [], varbits: new Map(), prompt: null, amountAction: null, special: null };
  const self = {
    state,
    inventoryItems,
    amounts,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => self,
    getLocation: () => at,
    getEquipment: () => ({ getItems: () => equipment, refreshItems() {} }),
    getInventory: () => ({
      getItems: () => inventoryItems,
      getAmount: (id) => amounts.get(id) ?? 0,
      deleteNumber: (id, amount) => amounts.set(id, Math.max(0, (amounts.get(id) ?? 0) - amount)),
      contains: (id) => (amounts.get(id) ?? 0) > 0,
      getFreeSlots: () => 28,
      addItem: (item) => amounts.set(item.getId(), (amounts.get(item.getId()) ?? 0) + item.getAmount()),
      refreshItems() {},
    }),
    getSkillManager: () => ({ getCurrentLevel: () => magic }),
    getCombat: () => ({
      setCastSpell: (spell) => { state.castSpell = spell; },
      getCastSpell: () => state.castSpell,
      reset: () => { state.reset = true; },
      getTarget: () => state.target ?? null,
    }),
    getUpdateFlag: () => ({ flag() {} }),
    getPacketSender: () => ({
      sendVarbit: (id, value) => state.varbits.set(id, value),
      sendEnterAmountPrompt: (title) => { state.prompt = title; },
    }),
    setEnteredAmountAction: (action) => { state.amountAction = action; },
    isSpecialActivated: () => state.special != null,
    getCombatSpecial: () => (state.special ? { getId: () => state.special } : null),
    sendMessage: (message) => state.messages.push(message),
  };
  return self;
}

function staffItem(id, key, charges) {
  const item = new Item(id, 1);
  if (charges > 0) item.setMetaValue(key, charges);
  return item;
}

const at = (x, y) => ({ getLocation: () => new Location(x, y, 0), getSize: () => 1, getPrivateArea: () => null });
const NPC = { isPlayer: () => false, isNpc: () => true };

test("tridents attack with their built-in spell; the max hit follows Magic (Wiki)", () => {
  const resolve = (p) => trident.resolvers[0].resolve(p);
  const key = Trident._test.TRIDENT_CHARGE_META_KEY;
  for (const id of [I.TRIDENT_OF_THE_SEAS, I.TRIDENT_OF_THE_SWAMP, I.TRIDENT_OF_THE_SEAS_E_, I.TRIDENT_OF_THE_SWAMP_E_]) {
    assert.ok(resolve(player({ weapon: staffItem(id, key, 5) })), `item ${id} resolves`);
  }
  assert.equal(resolve(player({ weapon: new Item(I.STAFF_OF_FIRE, 1) })), null);

  const seas = player({ weapon: staffItem(I.TRIDENT_OF_THE_SEAS, key, 5) });
  const method = resolve(seas);
  assert.equal(method.attackSpeed(seas), 4);
  assert.equal(method.attackDistance(seas), 7);
  seas.getFightType = () => FightType.POWERED_STAFF_LONGRANGE;
  assert.equal(method.attackDistance(seas), 9, "Longrange adds 2");
  assert.equal(method.canAttack(seas, NPC), true);
  assert.equal(seas.state.castSpell.maximumHit(), 28, "floor(99 / 3) - 5");
  assert.equal(seas.state.castSpell.castAnimation().getId(), 11430, "human_castwave_staff_walkmerge");
  assert.equal(seas.state.castSpell.startGraphic().getId(), 1251);
  assert.equal(seas.state.castSpell.castSound().getId(), 178);

  const [seasRecipe, swampRecipe] = Trident._test.RECIPES;
  assert.equal(Trident._test.maxHit(seasRecipe, player({ magic: 75 })), 20);
  assert.equal(Trident._test.maxHit(seasRecipe, player({ magic: 1 })), 1, "never below 1");
  assert.equal(Trident._test.maxHit(swampRecipe, player({ magic: 99 })), 31, "floor(99 / 3) - 2");
  assert.equal(Trident._test.maxHit(swampRecipe, player({ magic: 1 })), 4, "never below 4");
});

test("trident projectiles end 46 + 10 a tile, and the hit lands as they arrive (rsprox)", () => {
  assert.deepEqual([1, 2, 3, 6].map((d) => Trident._test.projectileEnd(at(3200, 3200), at(3200 + d, 3200))), [56, 66, 76, 106]);
  const seas = player({ weapon: staffItem(I.TRIDENT_OF_THE_SEAS, Trident._test.TRIDENT_CHARGE_META_KEY, 5) });
  trident.resolvers[0].resolve(seas).canAttack(seas, NPC);
  const projectile = seas.state.castSpell.castProjectile(at(3200, 3200), at(3203, 3200));
  assert.deepEqual([projectile.delay, projectile.speed, projectile.startHeight * 4, projectile.endHeight * 4, projectile.angle, projectile.progress],
    [51, 76, 92, 60, 16, 64]);
});

test("each cast spends a charge, warns every 100, and an empty trident refuses (rsprox)", () => {
  const key = Trident._test.TRIDENT_CHARGE_META_KEY;
  const staff = staffItem(I.TRIDENT_OF_THE_SEAS, key, 101);
  const seas = player({ weapon: staff });
  const method = trident.resolvers[0].resolve(seas);
  assert.equal(method.canAttack(seas, NPC), true);
  assert.equal(Trident._test.getCharges(staff), 100);
  assert.equal(seas.state.messages.at(-1), "Your Trident of the seas has 100 charges left.");
  staff.setMetaValue(key, 1);
  assert.equal(method.canAttack(seas, NPC), true);
  assert.equal(staff.getId(), I.UNCHARGED_TRIDENT, "the last charge leaves it uncharged");
  assert.equal(method.canAttack(seas, NPC), false);
  assert.match(seas.state.messages.at(-1), /no charges/);
  assert.equal(seas.state.reset, true);

  Trident._test.sendChargeStatus({ player: seas, item: staffItem(I.TRIDENT_OF_THE_SEAS, key, 2496) });
  assert.equal(seas.state.messages.at(-1), "Your Trident of the seas has 2,496 charges.");
});

test("the (e) tridents hold 20,000 charges (Wiki)", () => {
  const recipe = Trident._test.recipeForTridentId(I.UNCHARGED_TRIDENT_E_);
  assert.equal(recipe.maxCharges, 20000);
  const staff = new Item(I.UNCHARGED_TRIDENT_E_, 1);
  const p = player({ items: { [I.DEATH_RUNE]: 3000, [I.CHAOS_RUNE]: 3000, [I.FIRE_RUNE]: 15000, [I.COINS]: 30000 } });
  p.inventoryItems.push(staff);
  Trident._test.chargeTrident(p, staff, 0, recipe);
  assert.equal(staff.getId(), I.TRIDENT_OF_THE_SEAS_E_);
  assert.equal(Trident._test.getCharges(staff), 3000, "more than a plain trident's 2,500");
});

test("the swamp trident venoms a quarter of its damaging hits (Wiki)", () => {
  const original = Math.random;
  const poisoned = [];
  const realPoison = core.CombatFactory.poisonEntity;
  core.CombatFactory.poisonEntity = (target, severity, type) => poisoned.push([severity, type]);
  try {
    const hit = (accurate, damage, venomed = false) => ({
      isAccurate: () => accurate, getTotalDamage: () => damage, getTarget: () => ({ isVenomed: () => venomed }),
    });
    Math.random = () => 0.2;
    Trident._test.venom(hit(true, 5));
    Trident._test.venom(hit(false, 0));
    Trident._test.venom(hit(true, 0));
    Trident._test.venom(hit(true, 5, true));
    Math.random = () => 0.3;
    Trident._test.venom(hit(true, 5));
    assert.deepEqual(poisoned, [[6, 2]]);
  } finally {
    Math.random = original;
    core.CombatFactory.poisonEntity = realPoison;
  }
});

test("Eye of Ayak: 3 ticks, 6 tiles, floor(Magic / 3) - 6, and it steps aside for Soul Rend (Wiki)", () => {
  const { CHARGES_KEY, CHARGES_VARBIT } = EyeOfAyak._test;
  const staff = staffItem(I.EYE_OF_AYAK, CHARGES_KEY, 2);
  const p = player({ weapon: staff });
  const method = eye.resolvers[0].resolve(p);
  assert.equal(method.attackSpeed(p), 3);
  assert.equal(method.attackDistance(p), 6);
  assert.equal(method.canAttack(p, NPC), true);
  assert.equal(p.state.castSpell.maximumHit(), 27);
  assert.equal(p.state.varbits.get(CHARGES_VARBIT), 1, "the charge count is shown");
  assert.deepEqual([1, 2, 3, 4].map((d) => EyeOfAyak._test.projectileEnd(at(3200, 3200), at(3200 + d, 3200))), [53, 56, 61, 66]);
  p.state.special = "eye_of_ayak";
  assert.equal(eye.resolvers[0].resolve(p), null, "Soul Rend's own method attacks");
});

test("Eye of Ayak charges with demon tears or runes, never both (rsprox 3080)", () => {
  const { MATERIAL_KEY } = EyeOfAyak._test;
  const staff = new Item(I.EYE_OF_AYAK_UNCHARGED_, 1);
  const p = player({ items: { [I.DEMON_TEAR]: 40, [I.DEATH_RUNE]: 10, [I.CHAOS_RUNE]: 10 } });
  p.inventoryItems.push(staff);
  EyeOfAyak._test.chargeWithItem({ player: p, usedItem: new Item(I.DEMON_TEAR, 40), usedWithItem: staff, usedItemId: I.DEMON_TEAR, usedWithItemId: staff.getId() });
  assert.equal(p.state.prompt, "How many charges do you wish to add? (0 - 40)");
  p.state.amountAction.execute(25);
  assert.equal(staff.getId(), I.EYE_OF_AYAK);
  assert.equal(EyeOfAyak._test.staff.chargesOf(staff), 25);
  assert.equal(staff.getMetaValue(MATERIAL_KEY), "tears");
  assert.equal(p.amounts.get(I.DEMON_TEAR), 15);
  assert.equal(p.state.messages.at(-1), "The Eye of Ayak has been charged with demon tears. It currently has 25 charges.");

  EyeOfAyak._test.chargeWithItem({ player: p, usedItem: new Item(I.DEATH_RUNE, 10), usedWithItem: staff, usedItemId: I.DEATH_RUNE, usedWithItemId: staff.getId() });
  assert.match(p.state.messages.at(-1), /charged with demon tears, and thus can only be charged with more demon tears/);

  EyeOfAyak._test.refund(p, staff);
  assert.equal(staff.getId(), I.EYE_OF_AYAK_UNCHARGED_);
  assert.equal(p.amounts.get(I.DEMON_TEAR), 40, "every tear comes back");
  assert.equal(p.state.messages.at(-1), "You uncharge the Eye of Ayak.");

  EyeOfAyak._test.chargeEye(p, staff, "runes");
  p.state.amountAction.execute(5);
  assert.equal(p.amounts.get(I.DEATH_RUNE), 0, "two death runes a charge");
  assert.equal(p.amounts.get(I.CHAOS_RUNE), 5, "and one chaos rune");
});

test("Accursed sceptre: a 1,000 ether deposit, then up to 16,000 charges (Wiki, rsprox)", () => {
  const { CHARGES_KEY, ACTIVATION_ETHER } = Accursed._test;
  const sceptre = new Item(I.ACCURSED_SCEPTRE_U_, 1);
  const p = player({ items: { [I.REVENANT_ETHER]: 1500 } });
  p.inventoryItems.push(sceptre);
  Accursed._test.chargeWithEther({ player: p, usedItem: new Item(I.REVENANT_ETHER, 1500), usedWithItem: sceptre, usedItemId: I.REVENANT_ETHER, usedWithItemId: sceptre.getId() });
  assert.equal(p.state.prompt, "How many ether would you like to add? (0 - 500)");
  p.state.amountAction.execute(500);
  assert.equal(sceptre.getId(), I.ACCURSED_SCEPTRE);
  assert.equal(sceptre.getMetaValue(CHARGES_KEY), 500);
  assert.deepEqual(p.state.messages.slice(-2), [
    "You use 1,000 ether to activate the weapon.",
    "You add a further 500 revenant ether to your weapon, giving it a total of 500 charges.",
  ]);
  Accursed._test.checkCharges({ player: p, item: sceptre });
  assert.equal(p.state.messages.at(-1), "Your sceptre has 500 charges left powering it.");

  // Emptied, it keeps its deposit: still the charged sceptre, refusing to cast.
  const worn = player({ weapon: sceptre });
  sceptre.setMetaValue(CHARGES_KEY, 1);
  const method = accursed.resolvers[0].resolve(worn);
  assert.equal(method.attackSpeed(worn), 4);
  assert.equal(method.canAttack(worn, NPC), true);
  assert.equal(worn.state.castSpell.maximumHit(), 27, "floor(99 / 3) - 6");
  assert.equal(sceptre.getId(), I.ACCURSED_SCEPTRE);
  assert.equal(method.canAttack(worn, NPC), false);
  assert.equal(worn.state.messages.at(-1), "There is not enough revenant ether left powering your sceptre.");

  sceptre.setMetaValue(CHARGES_KEY, 200);
  Accursed._test.uncharge({ player: p, item: sceptre });
  assert.equal(sceptre.getId(), I.ACCURSED_SCEPTRE_U_);
  assert.equal(p.amounts.get(I.REVENANT_ETHER), 200 + ACTIVATION_ETHER, "the deposit comes back too");
});

test("Accursed sceptre (a) autocasts instead, and either gives +50% against Wilderness NPCs (Wiki)", () => {
  const { CHARGES_KEY } = Accursed._test;
  const swapped = staffItem(I.ACCURSED_SCEPTRE, CHARGES_KEY, 10);
  const p = player({ weapon: swapped });
  p.inventoryItems.push(swapped);
  Accursed._test.swap({ player: p, item: swapped });
  assert.equal(swapped.getId(), I.ACCURSED_SCEPTRE_A_);
  assert.equal(swapped.getMetaValue(CHARGES_KEY), 10, "charges are kept");
  assert.equal(accursed.resolvers[0].resolve(p), null, "no built-in spell: it autocasts");

  const wilderness = { isPlayer: () => false, isNpc: () => true, getLocation: () => new Location(3100, 3600, 0) };
  const town = { isPlayer: () => false, isNpc: () => true, getLocation: () => new Location(3200, 3200, 0) };
  const boosted = { attacker: p, target: wilderness, maxHit: 30, attackRoll: 1000 };
  Accursed._test.boostMaxHit(boosted);
  Accursed._test.boostAccuracy(boosted);
  assert.deepEqual([boosted.maxHit, boosted.attackRoll], [45, 1500]);
  const plain = { attacker: p, target: town, maxHit: 30, attackRoll: 1000 };
  Accursed._test.boostMaxHit(plain);
  assert.equal(plain.maxHit, 30, "only in the Wilderness");
  p.state.target = wilderness;
  Accursed._test.spellCast({ player: p });
  assert.equal(swapped.getMetaValue(CHARGES_KEY), 9, "a spellbook cast there spends a charge");
});

test("Soul Rend lowers Magic Defence by the damage, never below 0, keeping other overrides (Wiki)", () => {
  let registered;
  require("../plugins/combat/specials/EyeOfAyak.SpecialAttack")({ core, registerCombatSpecial: (s) => { registered = s; }, emitCustomEvent() {} });
  assert.equal(registered.traits.damageMultiplier, 1.3);
  assert.equal(registered.traits.accuracyMultiplier, 2);
  const npc = {
    defenceBonusOverrides: [null, 7, null, null, null],
    isNpc: () => true, getAsNpc: () => npc,
    getDefenceBonus: (index) => (index === 3 ? 20 : 0),
    setDefenceBonusOverrides(bonuses) { this.defenceBonusOverrides = bonuses; },
  };
  const hit = (damage) => ({ getAttacker: () => null, getTarget: () => npc, isAccurate: () => true, getTotalDamage: () => damage });
  registered.combatMethod.handleAfterHitEffects(hit(12));
  assert.deepEqual(npc.defenceBonusOverrides, [null, 7, null, 8, null]);
  registered.combatMethod.handleAfterHitEffects(hit(12));
  assert.equal(npc.defenceBonusOverrides[3], 0, "never below 0");
  assert.equal(registered.combatMethod.attackSpeed(), 5);
});

test("Condemn covers both sceptres and rolls 1.5 times (Wiki)", () => {
  let registered;
  require("../plugins/combat/specials/AccursedSceptre.SpecialAttack")({ core, registerCombatSpecial: (s) => { registered = s; }, emitCustomEvent() {} });
  assert.deepEqual(registered.itemIds, [I.ACCURSED_SCEPTRE, I.ACCURSED_SCEPTRE_A_]);
  assert.equal(registered.traits.damageMultiplier, 1.5);
  assert.equal(registered.traits.accuracyMultiplier, 1.5);
});

test("an armed Soul Rend lends nothing to an explicitly cast spell (PR #1947 review)", async () => {
  const path = require("node:path");
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
  const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
  const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
  const { DamageFormulas } = require("../dist/game/content/combat/formula/DamageFormulas");
  const { Skill } = require("../dist/game/model/Skill");
  require("../plugins/combat/specials/EyeOfAyak.SpecialAttack")({
    core, registerCombatSpecial: (definition) => CombatSpecial.register(definition), emitCustomEvent: () => {},
  });

  const player = new Player(null, new Location(3200, 3200, 0));
  player.getPacketSender = () => new Proxy({}, { get: () => () => {} });
  player.getSkillManager().setMaxLevel(Skill.MAGIC, 99).setCurrentLevel(Skill.MAGIC, 99, false);
  const staff = staffItem(I.EYE_OF_AYAK, EyeOfAyak._test.CHARGES_KEY, 10);
  player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = staff;
  CombatSpecial.assign(player);
  const target = core.NPC.create(3106, new Location(3203, 3200, 0));
  target.setHitpoints(1000); // a hit is capped at the target's hitpoints
  player.getCombat().setTarget?.(target);
  const surge = CombatSpells.FIRE_SURGE.getSpell();

  const ceiling = (armed) => {
    player.setSpecialActivated(armed);
    player.getCombat().setCastSpell(surge);
    const method = CombatFactory.getMethod(player);
    assert.equal(method, CombatFactory.MAGIC_COMBAT, "the explicit spell owns the attack");
    const original = Math.random;
    Math.random = () => 0.999999; // the roll's ceiling: always accurate, the top damage
    try {
      return method.hits(player, target)[0].getTotalDamage();
    } finally {
      Math.random = original;
    }
  };
  const unarmed = ceiling(false);
  const armed = ceiling(true);
  assert.ok(unarmed > 0);
  assert.equal(armed, unarmed, "Soul Rend's 1.3 stays with Soul Rend");
  assert.equal(player.isSpecialActivated(), true, "the special stays armed for the next attack");
  assert.equal(player.getSpecialPercentage(), 100, "no energy is spent");
  assert.equal(EyeOfAyak._test.staff.chargesOf(staff), 10, "no charge is spent");

  // Soul Rend's own paid hit keeps its multiplier: the bounds read the armed special.
  player.setSpecialActivated(true);
  player.getCombat().setCastSpell(EyeOfAyak._test.staff.spellFor(player));
  const special = DamageFormulas.sourceHitBounds(player, core.CombatType.MAGIC, target).maximum;
  player.setSpecialActivated(false);
  const plain = DamageFormulas.sourceHitBounds(player, core.CombatType.MAGIC, target).maximum;
  assert.equal(special, Math.floor(plain * 1.3));
});

test("the Accursed sceptre's last charge still pays for its own Wilderness passive (PR #1947 review)", () => {
  const { World } = require("../dist/game/World");
  const { CHARGES_KEY } = Accursed._test;
  const wilderness = { isPlayer: () => false, isNpc: () => true, getLocation: () => new Location(3103, 3600, 0) };
  const cycle = World.getProcessCycle;
  let tick = 1000;
  World.getProcessCycle = () => tick;
  try {
    // The built-in spell: canAttack pays the charge, then the hit is rolled on the same tick.
    const builtIn = (charges) => {
      const sceptre = staffItem(I.ACCURSED_SCEPTRE, CHARGES_KEY, charges);
      const p = player({ weapon: sceptre });
      assert.equal(accursed.resolvers[0].resolve(p).canAttack(p, wilderness), true);
      const roll = { attacker: p, target: wilderness, maxHit: 30, attackRoll: 1000 };
      Accursed._test.boostMaxHit(roll);
      Accursed._test.boostAccuracy(roll);
      return [roll.maxHit, roll.attackRoll, Accursed._test.sceptre.chargesOf(sceptre)];
    };
    assert.deepEqual(builtIn(2), [45, 1500, 1]);
    assert.deepEqual(builtIn(1), [45, 1500, 0], "the last charge is a paid attack too");

    // A spellbook cast with the (a) sceptre pays at cast-committed, before its roll.
    const sceptre = staffItem(I.ACCURSED_SCEPTRE_A_, CHARGES_KEY, 1);
    const p = player({ weapon: sceptre });
    p.state.target = wilderness;
    Accursed._test.spellCast({ player: p });
    assert.equal(sceptre.getMetaValue(CHARGES_KEY), undefined, "its last charge is spent");
    const roll = { attacker: p, target: wilderness, maxHit: 30, attackRoll: 1000 };
    Accursed._test.boostMaxHit(roll);
    assert.equal(roll.maxHit, 45);
    tick++;
    const next = { attacker: p, target: wilderness, maxHit: 30, attackRoll: 1000 };
    Accursed._test.boostMaxHit(next);
    assert.equal(next.maxHit, 30, "the next attack, unpaid, gets nothing");
  } finally {
    World.getProcessCycle = cycle;
  }
});
