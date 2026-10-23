// Run after `yarn build`: node --test tests/consumable-edge-cases.test.cjs
const assert = require("node:assert/strict");
const path = require("path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const Potions = require("../plugins/items/Potions.plugin");
const { Item } = require("../dist/game/model/Item");
const { PluginManager } = require("../dist/plugins/PluginManager");
let combinePotions, emptyVessel, staminaFromHook, core;
before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  // Register after the cache is up: the potion plugin resolves its orb components at register.
  Potions.register(new Proxy({}, {
    get: (_, key) => key === "core" ? core : (...args) => {
      if (key === "onItemAction") emptyVessel = args[0];
      if (key === "onCustomEvent" && args[0] === "potions:apply-stamina") staminaFromHook = args[1];
      // The Skillcapes plugin answers this; a worn Prayer cape is all these tests need.
      if (key === "emitCustomEvent" && args[0] === "skillcape:has-perk" && args[1].skill === "PRAYER") {
        args[1].result = args[1].player.getEquipment().contains(ItemIdentifiers.PRAYER_CAPE);
      }
      if (key === "onItemOnItem") {
        combinePotions = args[0];
        assert.deepEqual(args[1], { noted: false });
      }
    },
  }));
});
const {
  applyPrayerRestore, applySanfewRestore, applyAncientBrew, applyDivine, processDivine,
  applyMenaphiteRemedy, processMenaphite, applyPrayerRegeneration, processPrayerRegeneration,
  clearPrayerRegeneration, processBoostDecay, curePoisonAndVenom,
  pauseTimedEffects, resumeTimedEffects,
} = Potions._test;

function vessels(ids) {
  const items = ids.map((id) => new Item(id, 1));
  const sent = { messages: [], sounds: [], refreshes: 0 };
  const inventory = {
    getItems: () => items,
    setItem(slot, item) { items[slot] = item; return this; },
    refreshItems() { sent.refreshes++; return this; },
  };
  const sender = {
    sendSound(id) { sent.sounds.push(id); return sender; },
    sendTypedMessage(type, text) { sent.messages.push(text); return sender; },
  };
  return { items, sent, player: { getInventory: () => inventory, getPacketSender: () => sender, sendMessage() {} } };
}

function pour(sourceId, targetId, sourceSlot = 0, targetSlot = 1, detail = false) {
  const { items, sent, player } = vessels([sourceId, targetId]);
  const event = {
    player, usedItemId: sourceId, usedWithItemId: targetId,
    usedItemSlot: sourceSlot, usedWithItemSlot: targetSlot, handled: false,
  };
  combinePotions(event);
  const result = { ids: items.map((item) => item.getId()), refreshes: sent.refreshes, handled: event.handled };
  return detail ? { ...result, ...sent } : result;
}

test("using matching potions combines doses in either order and leaves a vial", () => {
  const I = ItemIdentifiers;
  assert.deepEqual(pour(I.ENERGY_POTION_1_, I.ENERGY_POTION_3_), {
    ids: [I.VIAL, I.ENERGY_POTION_4_], refreshes: 1, handled: true,
  });
  assert.deepEqual(pour(I.ENERGY_POTION_3_, I.ENERGY_POTION_1_), {
    ids: [I.VIAL, I.ENERGY_POTION_4_], refreshes: 1, handled: true,
  });
  assert.deepEqual(pour(I.PRAYER_POTION_3_, I.PRAYER_POTION_3_), {
    ids: [I.PRAYER_POTION_2_, I.PRAYER_POTION_4_], refreshes: 1, handled: true,
  });
  assert.deepEqual(pour(I.GUTHIX_REST_1_, I.GUTHIX_REST_3_), {
    ids: [I.EMPTY_CUP, I.GUTHIX_REST_4_], refreshes: 1, handled: true,
  });
});

test("combining never mixes potion variants, notes or the same slot", () => {
  const I = ItemIdentifiers;
  for (const [a, b, targetSlot] of [
    [I.ENERGY_POTION_1_, I.PRAYER_POTION_3_, 1],
    [I.SUPER_RESTORE_1_, I.BLIGHTED_SUPER_RESTORE_3_, 1],
    [I.ENERGY_POTION_1__2, I.ENERGY_POTION_3_, 1],
    [I.ENERGY_POTION_3_, I.ENERGY_POTION_3_, 0],
  ]) {
    const result = pour(a, b, 0, targetSlot);
    assert.deepEqual(result.ids, [a, b]);
    assert.equal(result.refreshes, 0);
  }
  const result = pour(I.ENERGY_POTION_1_, I.ENERGY_POTION_4_);
  assert.deepEqual(result.ids, [I.ENERGY_POTION_1_, I.ENERGY_POTION_4_]);
  assert.equal(result.refreshes, 0);
});

test("pouring says how many doses there are now, with the pouring sound", () => {
  const I = ItemIdentifiers;
  const result = pour(I.SUPER_RESTORE_2_, I.SUPER_RESTORE_3_, 0, 1, true);
  assert.deepEqual(result.ids, [I.SUPER_RESTORE_1_, I.SUPER_RESTORE_4_]);
  assert.deepEqual(result.messages, ["You have combined the liquid into four doses."]);
  assert.deepEqual(result.sounds, [2401]);
  assert.deepEqual(pour(I.SUPER_RESTORE_1_, I.SUPER_RESTORE_2_, 0, 1, true).messages, ["You have combined the liquid into three doses."]);
});

test("potions with no drink effect and barbarian mixes combine through the cache's dose enum", () => {
  const obj = (name) => core.CacheDefinitions.getObjId(name);
  assert.deepEqual(pour(obj("1dosegoading"), obj("2dosegoading")).ids, [obj("vial_empty"), obj("3dosegoading")]);
  assert.deepEqual(pour(obj("brutal_1dose1attack"), obj("brutal_1dose1attack")).ids, [obj("vial_empty"), obj("brutal_2dose1attack")]);
});

test("a potion used on an empty vial is shared out, the larger half staying", () => {
  const I = ItemIdentifiers;
  const result = pour(I.SUPER_RESTORE_3_, I.VIAL, 0, 1, true);
  assert.deepEqual(result.ids, [I.SUPER_RESTORE_2_, I.SUPER_RESTORE_1_]);
  assert.deepEqual(result.messages, ["You divide the liquid between the vessels."]);
  assert.deepEqual(pour(I.VIAL, I.SUPER_RESTORE_4_).ids, [I.SUPER_RESTORE_2_, I.SUPER_RESTORE_2_]);
  assert.deepEqual(pour(I.SUPER_RESTORE_1_, I.VIAL).ids, [I.SUPER_RESTORE_1_, I.VIAL]);
});

test("Empty leaves the vial: potions, unfinished potions and a vial of water", () => {
  const obj = (name) => core.CacheDefinitions.getObjId(name);
  for (const name of ["3dose2restore", "ranarrvial", "vial_water", "weapon_poison"]) {
    const { items, sent, player } = vessels([obj(name)]);
    const event = { player, itemId: obj(name), slot: 0, clickType: 4, handled: false };
    emptyVessel(event);
    assert.equal(event.handled, true, name);
    assert.equal(items[0].getId(), obj("vial_empty"), name);
    assert.deepEqual(sent.messages, ["You empty the vial."]);
  }
  const { player } = vessels([obj("3dose2restore")]);
  const drink = { player, itemId: obj("3dose2restore"), slot: 0, clickType: 1, handled: false };
  emptyVessel(drink);
  assert.equal(drink.handled, false, "Drink is not Empty");
});

function createPlayer({ base = 99, current = 1, inventory = [], equipment = [] } = {}) {
  const levels = new Map(Skill.values().map((skill) => [skill, current]));
  const attributes = new Map();
  let runEnergy = 0;
  const poisonImmunity = {
    seconds: 0,
    startedAt: 0,
    start(seconds) { this.seconds = seconds; this.startedAt = Date.now(); },
    stop() { this.seconds = 0; },
    secondsRemaining() { return this.seconds > 0 ? Math.max(0, this.seconds - Math.floor((Date.now() - this.startedAt) / 1000)) : 0; },
    finished() { return this.secondsRemaining() === 0; },
  };
  const player = {
    levels,
    attributes,
    poisonImmunity,
    poisonDamage: current,
    venomed: current > 0,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({ contains: (id) => inventory.includes(id) }),
    getEquipment: () => ({ contains: (id) => equipment.includes(id) }),
    getPacketSender: () => ({ sendSound() { return this; }, sendPoisonType() {}, sendRunEnergy() {} }),
    getSession: () => ({ sendClientPacket() {} }),
    setHitpoints(value) { levels.set(Skill.HITPOINTS, value); },
    setPoisonDamage(value) { player.poisonDamage = value; },
    setVenomed(value) { player.venomed = value; },
    getRunEnergy: () => runEnergy,
    setRunEnergy(value) { runEnergy = value; },
    sendMessage() {},
    getCombat: () => ({ getPoisonImmunityTimer: () => poisonImmunity }),
    getSkillManager: () => ({
      getMaxLevel: () => base,
      getCurrentLevel: (skill) => levels.get(skill),
      setCurrentLevels: (skill, level) => levels.set(skill, level),
      increaseCurrentLevel: (skill, amount, max) => levels.set(skill, Math.min(max, levels.get(skill) + amount)),
      decreaseCurrentLevel: (skill, amount, minimum) => levels.set(skill, Math.max(minimum, levels.get(skill) - amount)),
    }),
  };
  return player;
}

test("prayer potions restore 7 + 25%, or 27% with a holy wrench or worn prayer cape", () => {
  const plain = createPlayer();
  applyPrayerRestore(plain, false);
  assert.equal(plain.levels.get(Skill.PRAYER), 1 + 7 + 24);
  const wrench = createPlayer({ inventory: [ItemIdentifiers.HOLY_WRENCH] });
  applyPrayerRestore(wrench, false);
  assert.equal(wrench.levels.get(Skill.PRAYER), 1 + 7 + 26);
  const cape = createPlayer({ equipment: [ItemIdentifiers.PRAYER_CAPE] });
  applyPrayerRestore(cape, true);
  assert.equal(cape.levels.get(Skill.PRAYER), 1 + 8 + 26);
});

test("a Sanfew dose restores 4 + 30% (prayer 32% with the bonus)", () => {
  const player = createPlayer({ equipment: [ItemIdentifiers.RING_OF_THE_GODS_I_] });
  applySanfewRestore(player);
  assert.equal(player.levels.get(Skill.ATTACK), 1 + 4 + 29);
  assert.equal(player.levels.get(Skill.PRAYER), 1 + 4 + 31);
});

test("a divine potion's timer pauses while logged out and the state survives a save", () => {
  const player = createPlayer({ current: 99 });
  applyDivine(player, (p) => p.levels.set(Skill.ATTACK, 118), [Skill.ATTACK]);
  const state = player.getAttribute("potions:divine:state");
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state, "the state is JSON so it can be persisted");
  const remaining = state.endsAt - Date.now();
  pauseTimedEffects({ player });
  player.setAttribute("potions:paused-at", Date.now() - 60 * 60 * 1000);
  resumeTimedEffects({ player });
  const resumed = player.getAttribute("potions:divine:state");
  assert.ok(resumed.endsAt - Date.now() >= remaining + 60 * 60 * 1000 - 50);
  player.levels.set(Skill.ATTACK, 105);
  processDivine(player);
  assert.equal(player.levels.get(Skill.ATTACK), 118, "the divine level holds after a relog");
});

const SpellTeleports = require("../plugins/combat/SpellTeleports.plugin");
const teleports = [];
/** Stands in for Construction's "construction:house-tablet" answer. */
let ownsHouse = true;
const HOUSE_PORTAL = new (require("../dist/game/model/Location").Location)(2953, 3224, 0);
function houseTablet(request) {
  if (!ownsHouse) return;
  request.destination = HOUSE_PORTAL;
  request.onArrival = request.option === "outside" ? null : () => "entered";
}
let allowTeleport = true;
let breakTablet;
SpellTeleports.register({
  core: {
    Location: require("../dist/game/model/Location").Location,
    ItemDefinition: { forId: (id) => ({ getName: () => (
      id === ItemIdentifiers.VARROCK_TELEPORT ? "Varrock teleport" :
      id === ItemIdentifiers.RELLEKKA_TELEPORT ? "Rellekka teleport" :
      id === ItemIdentifiers.NARDAH_TELEPORT ? "Nardah teleport" : "Teleport to house"
    ) }) },
    TeleportHandler: {
      checkReqs: () => allowTeleport,
      teleport: (player, destination, type, warning, onArrival, onMiddle) =>
        teleports.push({ destination, type, onArrival, onMiddle }),
    },
    TeleportType: { TELE_TAB: "TELE_TAB", TELE_SCROLL: "TELE_SCROLL" },
    SpellTeleports: require("../dist/game/content/combat/magic/SpellTeleports").SpellTeleports,
    LunarSpells: { getTeleportDestinations: () => [] },
    ArceuusSpells: { getTeleportDestinations: () => [] },
  },
  persistAttribute() {},
  onItemAction: (handler) => { breakTablet = handler; },
  onPlayerLogin() {},
  onSpellCast() {},
  emitCustomEvent: (name, request) => houseTablet(request),
  onInterfaceActionClick() {},
});

function tabletHolder(count) {
  const items = new Array(count).fill(ItemIdentifiers.VARROCK_TELEPORT);
  return {
    items,
    getAttribute: () => undefined,
    getInventory: () => ({
      contains: (id) => items.includes(id),
      deleteNumber: (id) => items.splice(items.indexOf(id), 1),
    }),
  };
}

test("breaking a tablet teleports to its spell's destination and uses one tablet", () => {
  teleports.length = 0;
  allowTeleport = true;
  const player = tabletHolder(2);
  const event = { player, itemId: ItemIdentifiers.VARROCK_TELEPORT, option: "Break", handled: false };
  breakTablet(event);
  assert.equal(event.handled, true);
  assert.equal(player.items.length, 2, "the tablet goes as it is absorbed, two ticks in");
  teleports[0].onMiddle();
  assert.equal(player.items.length, 1);
  assert.deepEqual([teleports[0].destination.getX(), teleports[0].destination.getY()], [3213, 3424]);
  assert.equal(teleports[0].type, "TELE_TAB");
});

test("a redirected Rellekka house tablet goes to the portal outside the Fremennik gates", () => {
  teleports.length = 0;
  allowTeleport = true;
  const player = tabletHolder(1);
  const event = { player, itemId: ItemIdentifiers.RELLEKKA_TELEPORT, option: "Break", handled: false };
  player.items[0] = ItemIdentifiers.RELLEKKA_TELEPORT;
  breakTablet(event);
  assert.equal(event.handled, true);
  assert.equal(teleports.length, 1);
  assert.deepEqual(
    [teleports[0].destination.getX(), teleports[0].destination.getY(), teleports[0].destination.getZ()],
    [2670, 3632, 0]
  );
  assert.equal(teleports[0].type, "TELE_TAB");
});

test("a Nardah scroll uses its Teleport action and is used up on the click", () => {
  teleports.length = 0;
  allowTeleport = true;
  const player = tabletHolder(1);
  player.items[0] = ItemIdentifiers.NARDAH_TELEPORT;
  const event = { player, itemId: ItemIdentifiers.NARDAH_TELEPORT, option: "Teleport", handled: false };
  breakTablet(event);
  assert.equal(event.handled, true);
  assert.equal(teleports.length, 1);
  assert.deepEqual(
    [teleports[0].destination.getX(), teleports[0].destination.getY(), teleports[0].destination.getZ()],
    [3401, 2918, 0]
  );
  assert.equal(teleports[0].type, "TELE_SCROLL");
  assert.equal(player.items.length, 0, "scrolls go on the click (docs/teleport-tablets.md)");
});

test("a refused tablet (teleblock, deep Wilderness, busy) is not used up", () => {
  teleports.length = 0;
  allowTeleport = false;
  const player = tabletHolder(1);
  breakTablet({ player, itemId: ItemIdentifiers.VARROCK_TELEPORT, option: "Break", handled: false });
  assert.equal(player.items.length, 1);
  assert.equal(teleports.length, 0);
});

function houseTabletHolder() {
  const items = [ItemIdentifiers.TELEPORT_TO_HOUSE];
  return {
    items,
    getInventory: () => ({
      contains: (id) => items.includes(id),
      deleteNumber: (id) => items.splice(items.indexOf(id), 1),
    }),
  };
}

test("a house tablet without a house is refused and kept", () => {
  teleports.length = 0;
  allowTeleport = true;
  ownsHouse = false;
  const player = houseTabletHolder();
  const event = { player, itemId: ItemIdentifiers.TELEPORT_TO_HOUSE, option: "Break", handled: false };
  breakTablet(event);
  assert.equal(event.handled, true);
  assert.equal(player.items.length, 1);
  assert.equal(teleports.length, 0);
});

test("a house tablet goes to the house portal and enters unless Outside was chosen", () => {
  teleports.length = 0;
  allowTeleport = true;
  ownsHouse = true;
  for (const option of ["Break", "Inside", "Outside"]) {
    breakTablet({ player: houseTabletHolder(), itemId: ItemIdentifiers.TELEPORT_TO_HOUSE, option, handled: false });
  }
  assert.equal(teleports.length, 3);
  assert.ok(teleports.every(({ destination }) => destination === HOUSE_PORTAL));
  assert.deepEqual(teleports.map(({ onArrival }) => onArrival?.() ?? null), ["entered", "entered", null]);
});

test("the minute cycle decays boosts and restores drains one point toward base", () => {
  const player = createPlayer({ base: 99, current: 99 });
  player.levels.set(Skill.ATTACK, 110);
  player.levels.set(Skill.STRENGTH, 90);
  player.levels.set(Skill.PRAYER, 110);
  player.levels.set(Skill.HITPOINTS, 110);

  processBoostDecay(player);
  assert.equal(player.levels.get(Skill.ATTACK), 110, "the first process only arms the cycle");
  player.setAttribute("potions:boost-cycle", Date.now() - 1);
  processBoostDecay(player);
  assert.equal(player.levels.get(Skill.ATTACK), 109, "a boost loses a point");
  assert.equal(player.levels.get(Skill.STRENGTH), 91, "a drain gains a point");
  assert.equal(player.levels.get(Skill.PRAYER), 110, "prayer points do not decay");
  assert.equal(player.levels.get(Skill.HITPOINTS), 110, "hitpoints do not decay");
});

test("a divine-timed skill is pinned and only decays after the divine state ends", () => {
  const player = createPlayer({ base: 99, current: 99 });
  applyDivine(player, (p) => p.levels.set(Skill.ATTACK, 118), [Skill.ATTACK]);
  processDivine(player);
  player.setAttribute("potions:boost-cycle", Date.now() - 1);
  processBoostDecay(player);
  assert.equal(player.levels.get(Skill.ATTACK), 118, "the divine boost holds through a decay cycle");
  player.setAttribute("potions:divine:state", null);
  player.setAttribute("potions:boost-cycle", Date.now() - 1);
  processBoostDecay(player);
  assert.equal(player.levels.get(Skill.ATTACK), 117, "once unpinned it decays normally");
});

test("ancient and forgotten brew boost Magic, over-restore prayer and drain melee stats", () => {
  const player = createPlayer({ base: 99, current: 99 });
  applyAncientBrew(player, 2, 0.05);
  assert.equal(player.levels.get(Skill.MAGIC), 99 + 2 + 4, "floor(99 * 0.05) + 2");
  assert.equal(player.levels.get(Skill.PRAYER), 103, "floor(99 * 0.10) + 2, capped at +5% over base");
  assert.equal(player.levels.get(Skill.ATTACK), 99 - (2 + 9), "floor(99 * 0.10) + 2 drain");

  const forgotten = createPlayer({ base: 99, current: 99 });
  applyAncientBrew(forgotten, 3, 0.08);
  assert.equal(forgotten.levels.get(Skill.MAGIC), 99 + 3 + 7, "floor(99 * 0.08) + 3");
});

test("Menaphite remedy restores combat stats every 15s and dispels divine boosts", () => {
  const player = createPlayer({ base: 99, current: 1 });
  applyDivine(player, () => {}, [Skill.ATTACK]);
  applyMenaphiteRemedy(player);
  assert.equal(player.getAttribute("potions:divine:state"), null, "divine state is dispelled");
  assert.equal(player.levels.get(Skill.PRAYER), 1, "prayer is not restored");
  assert.equal(player.levels.get(Skill.ATTACK), 1 + 15 + 6, "floor(99 * 0.16) + 6");
  player.getAttribute("potions:menaphite:state").nextRestoreAt = Date.now() - 1;
  processMenaphite(player);
  assert.equal(player.levels.get(Skill.ATTACK), 1 + 2 * (15 + 6), "the 15s restore repeats");
  player.setAttribute("potions:menaphite:state", { endsAt: Date.now() - 1, nextRestoreAt: Date.now() - 1 });
  processMenaphite(player);
  assert.equal(player.getAttribute("potions:menaphite:state"), null, "the state expires after 5 minutes");
});

test("alcohol registrations load and apply their Wiki boosts", () => {
  for (const id of [ItemIdentifiers.WIZARDS_MIND_BOMB, ItemIdentifiers.DWARVEN_STOUT, ItemIdentifiers.AXEMANS_FOLLY, ItemIdentifiers.BANDITS_BREW]) {
    const entry = Potions._test.findPotionEntry(id);
    assert.ok(entry, `registered ${id}`);
  }
  const player = createPlayer({ base: 99, current: 99 });
  Potions._test.findPotionEntry(ItemIdentifiers.WIZARDS_MIND_BOMB).potion.effect(player);
  assert.equal(player.levels.get(Skill.MAGIC), 102);
  assert.equal(player.levels.get(Skill.ATTACK), 99 - (1 + 4));
  const stout = createPlayer({ base: 99, current: 99 });
  Potions._test.findPotionEntry(ItemIdentifiers.DWARVEN_STOUT).potion.effect(stout);
  assert.equal(stout.levels.get(Skill.MINING), 100);
  assert.equal(stout.levels.get(Skill.SMITHING), 100);
});

test("Vampyrium supplies use the shared potion registry and their documented effects", () => {
  const I = ItemIdentifiers;
  const rank = Potions._test.findPotionEntry(I.RANK_FROTHY_POTION_4_);
  const foul = Potions._test.findPotionEntry(I.FOUL_CHUNKY_POTION_4_);
  const rancid = Potions._test.findPotionEntry(I.RANCID_SLIMY_POTION_4_);
  const jar = Potions._test.findPotionEntry(I.JAR_OF_CONGEALED_BLOOD);
  for (const entry of [rank, foul, rancid, jar]) {
    assert.ok(entry, "each cache item is a registered consumable");
    assert.equal(entry.potion.area, "vampyrium", "the supplies are limited to Vampyrium");
  }
  assert.equal(rank.replacementId, I.RANK_FROTHY_POTION_3_);
  assert.equal(foul.replacementId, I.FOUL_CHUNKY_POTION_3_);
  assert.equal(rancid.replacementId, I.RANCID_SLIMY_POTION_3_);
  assert.equal(jar.replacementId, -1, "the one-use jar leaves no vial");

  const boosted = createPlayer({ base: 99, current: 99 });
  rank.potion.effect(boosted);
  assert.deepEqual([Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE].map((skill) => boosted.levels.get(skill)), [118, 118, 118]);

  const restored = createPlayer({ base: 99, current: 50 });
  restored.levels.set(Skill.ATTACK, 80);
  restored.levels.set(Skill.PRAYER, 1);
  const hpBefore = restored.levels.get(Skill.HITPOINTS);
  foul.potion.effect(restored);
  assert.equal(restored.levels.get(Skill.ATTACK), 99, "foul chunky restores lowered stats");
  assert.equal(restored.levels.get(Skill.PRAYER), 33, "it restores prayer like a super restore");
  assert.equal(restored.levels.get(Skill.HITPOINTS), hpBefore, "it does not heal Hitpoints");
  assert.ok(restored.getAttribute("potions:prayer-regen:state"), "it starts prayer regeneration");

  const brew = createPlayer({ base: 99, current: 99 });
  rancid.potion.effect(brew);
  assert.equal(brew.levels.get(Skill.HITPOINTS), 115, "rancid slimy overheals by 15% + 2");
  assert.equal(brew.levels.get(Skill.DEFENCE), 120, "it boosts Defence by 20% + 2");
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.MAGIC, Skill.RANGED]) {
    assert.equal(brew.levels.get(skill), 98, "it drains each offensive stat by only one level");
  }

  const wounded = createPlayer({ base: 99, current: 59 });
  rancid.potion.effect(wounded);
  assert.equal(wounded.levels.get(Skill.HITPOINTS), 75, "a wounded player heals by 15% + 2 instead of jumping to the boosted cap");

  const healed = createPlayer({ base: 99, current: 1 });
  jar.potion.effect(healed);
  assert.equal(healed.levels.get(Skill.HITPOINTS), 99);
  assert.equal(healed.levels.get(Skill.PRAYER), 99);
  assert.equal(healed.getRunEnergy(), 100, "the edible jar also restores run energy");
});

test("curing poison also clears the sticky venom flag", () => {
  const player = createPlayer({ current: 99 });
  player.setPoisonDamage(20);
  player.setVenomed(true);
  curePoisonAndVenom(player);
  assert.equal(player.poisonDamage, 0);
  assert.equal(player.venomed, false);
});

test("an antipoison mix heals its extra 3 Hitpoints and cures poison in one drink", () => {
  const player = createPlayer({ base: 99, current: 50 });
  player.setPoisonDamage(20);
  player.setVenomed(true);
  Potions._test.findPotionEntry(ItemIdentifiers.ANTIPOISON_MIX_2_).potion.effect(player);
  assert.equal(player.levels.get(Skill.HITPOINTS), 53, "the mix adds 3 Hitpoints");
  assert.equal(player.poisonDamage, 0);
  assert.equal(player.venomed, false);
  assert.equal(player.poisonImmunity.seconds, 90);
});

test("a weaker antipoison never shortens an active poison immunity", () => {
  const player = createPlayer({ base: 99, current: 99 });
  Potions._test.findPotionEntry(ItemIdentifiers.ANTI_VENOM_4_).potion.effect(player);
  assert.equal(player.poisonImmunity.seconds, 720, "anti-venom gives 12 minutes");
  Potions._test.findPotionEntry(ItemIdentifiers.ANTIPOISON_4_).potion.effect(player);
  assert.equal(player.poisonImmunity.seconds, 720, "the weaker dose does not decrease it");
  player.poisonImmunity.seconds = 0;
  Potions._test.findPotionEntry(ItemIdentifiers.ANTIDOTE_4_).potion.effect(player);
  assert.equal(player.poisonImmunity.seconds, 540, "Antidote+ gives 9 minutes");
  player.poisonImmunity.seconds = 0;
  Potions._test.findPotionEntry(ItemIdentifiers.ANTI_VENOM_4__3).potion.effect(player);
  assert.equal(player.poisonImmunity.seconds, 900, "Anti-venom+ gives 15 minutes");
});

test("prayer regeneration restores a point every 12 ticks, never above max, and clears on death", () => {
  const entry = Potions._test.findPotionEntry(ItemIdentifiers.PRAYER_REGENERATION_POTION_4_);
  assert.ok(entry, "the potion is registered");
  assert.equal(entry.replacementId, ItemIdentifiers.PRAYER_REGENERATION_POTION_3_, "doses chain");
  assert.equal(entry.potion.shareable, false, "it cannot be shared by Stat Restore Pot Share");

  const player = createPlayer({ base: 99, current: 1 });
  applyPrayerRegeneration(player);
  assert.equal(player.levels.get(Skill.PRAYER), 1, "nothing is restored instantly");
  processPrayerRegeneration(player);
  assert.equal(player.levels.get(Skill.PRAYER), 1, "the first point waits for the 12-tick interval");

  const state = player.getAttribute("potions:prayer-regen:state");
  state.nextRestoreAt = Date.now() - 1;
  processPrayerRegeneration(player);
  assert.equal(player.levels.get(Skill.PRAYER), 2, "one point per interval");

  player.levels.set(Skill.PRAYER, 99);
  state.nextRestoreAt = Date.now() - 1;
  processPrayerRegeneration(player);
  assert.equal(player.levels.get(Skill.PRAYER), 99, "prayer never exceeds max");

  player.setAttribute("potions:prayer-regen:state", { endsAt: Date.now() - 1, nextRestoreAt: Date.now() - 1 });
  processPrayerRegeneration(player);
  assert.equal(player.getAttribute("potions:prayer-regen:state"), null, "the state expires after 8 minutes");

  applyPrayerRegeneration(player);
  clearPrayerRegeneration({ player });
  assert.equal(player.getAttribute("potions:prayer-regen:state"), null, "death clears the effect");
});

test("the Drunken Dwarf's beer is drinkable and leaves a beer glass", () => {
  const entry = Potions._test.findPotionEntry(ItemIdentifiers.BEER);
  assert.equal(entry.replacementId, ItemIdentifiers.BEER_GLASS);
  assert.equal(entry.potion.shareable, false);
  assert.equal(Potions._test.findPotionEntry(ItemIdentifiers.BEER_2), null, "noted beer cannot be drunk");
  const player = createPlayer({ base: 99, current: 50 });
  entry.potion.effect(player);
  assert.equal(player.levels.get(Skill.HITPOINTS), 51);
  assert.equal(player.levels.get(Skill.STRENGTH), 101);
  assert.equal(player.levels.get(Skill.ATTACK), 46);
  entry.potion.effect(player);
  assert.equal(player.levels.get(Skill.STRENGTH), 101, "the boost does not stack");
  assert.equal(player.levels.get(Skill.ATTACK), 43, "the drain uses the current level");
});

test("Moonlight mead and Slayer's respite match the Wiki", () => {
  const mead = createPlayer({ base: 99, current: 50 });
  Potions._test.findPotionEntry(ItemIdentifiers.MOONLIGHT_MEAD).potion.effect(mead);
  assert.equal(mead.levels.get(Skill.HITPOINTS), 54, "moonlight mead heals 4");
  const matureMead = createPlayer({ base: 99, current: 50 });
  Potions._test.findPotionEntry(ItemIdentifiers.MOONLIGHT_MEAD_M_).potion.effect(matureMead);
  assert.equal(matureMead.levels.get(Skill.HITPOINTS), 56, "mature moonlight mead heals 6");

  const respite = createPlayer({ base: 99, current: 99 });
  Potions._test.findPotionEntry(ItemIdentifiers.SLAYERS_RESPITE).potion.effect(respite);
  assert.equal(respite.levels.get(Skill.SLAYER), 101, "+2 Slayer");
  assert.equal(respite.levels.get(Skill.ATTACK), 99 - (2 + Math.floor(99 * 0.02)));
  const matureRespite = createPlayer({ base: 99, current: 99 });
  Potions._test.findPotionEntry(ItemIdentifiers.SLAYERS_RESPITE_M_).potion.effect(matureRespite);
  assert.equal(matureRespite.levels.get(Skill.SLAYER), 103, "+4 Slayer");
});

test("Overload needs more than 50 Hitpoints and a Saradomin brew may over-heal", () => {
  const overload = Potions._test.findPotionEntry(ItemIdentifiers.OVERLOAD_4_);
  assert.equal(overload.potion.canUse(createPlayer({ base: 99, current: 50 })), false);
  assert.equal(overload.potion.canUse(createPlayer({ base: 99, current: 51 })), true);

  const brewed = createPlayer({ base: 99, current: 50 });
  Potions._test.findPotionEntry(ItemIdentifiers.SARADOMIN_BREW_4_).potion.effect(brewed);
  assert.equal(brewed.levels.get(Skill.HITPOINTS), 50 + Math.floor(2 + 99 * 0.15), "the brew may heal over max");
  assert.equal(brewed.levels.get(Skill.ATTACK), 50 - (2 + Math.floor(50 * 0.1)));
});


test("shared stamina requests support timed restorative food without consuming a potion",()=>{
 const attrs=new Map();let energy=10;const player={getRunEnergy:()=>energy,setRunEnergy:n=>energy=n,getPacketSender:()=>({sendRunEnergy(){}}),setAttribute:(k,v)=>attrs.set(k,v)};
 const now=Date.now();staminaFromHook({player,energy:20,durationMs:60000});
 assert.equal(energy,30);assert.equal(attrs.get("potions:stamina:acc"),0);
 assert.ok(attrs.get("potions:stamina:end")>=now+60000&&attrs.get("potions:stamina:end")<=Date.now()+60000);
});
