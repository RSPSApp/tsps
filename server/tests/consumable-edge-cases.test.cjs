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
let combinePotions, emptyVessel, staminaFromHook, drinkPotion, core, staminaEffect;
before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  // Register after the cache is up: the potion plugin resolves its orb components at register.
  Potions.register(new Proxy({}, {
    get: (_, key) => key === "core" ? core : (...args) => {
      if (key === "onItemAction") emptyVessel = args[0];
      if (key === "onItemFirstAction") drinkPotion = args[0];
      if (key === "onCustomEvent" && args[0] === "potions:apply-stamina") staminaFromHook = args[1];
      if (key === "emitCustomEvent" && args[0] === "potions:stamina-effect") staminaEffect = { ...args[1] };
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
  clearPrayerRegeneration, processBoostDecay, notePreserveActivated, curePoisonAndVenom,
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
  const varbits = [];
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
    varbits,
    attributes,
    prayerActive: [],
    poisonImmunity,
    poisonDamage: current,
    venomed: current > 0,
    isVenomed() { return this.venomed && this.poisonDamage > 0; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPrayerActive: () => player.prayerActive,
    getInventory: () => ({ contains: (id) => inventory.includes(id) }),
    getEquipment: () => ({ contains: (id) => equipment.includes(id) }),
    getPacketSender: () => ({ sendSound() { return this; }, sendPoisonType() {}, sendRunEnergy() {}, sendVarbit(id, value) { varbits.push([id, value]); return this; } }),
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
      getRestingLevel: () => base,
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

test("two divine potions keep their own five minutes: the second doesn't drop the first's boost (Wiki)", (t) => {
  const player = createPlayer({ current: 99 });
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  applyDivine(player, (p) => p.levels.set(Skill.ATTACK, 118), [Skill.ATTACK], { damage: 0 });
  now += 60_000;
  applyDivine(player, (p) => p.levels.set(Skill.RANGED, 112), [Skill.RANGED], { damage: 0 });
  const skills = () => (player.getAttribute("potions:divine:state")?.targets ?? []).map((entry) => entry.skillIndex).sort();
  assert.deepEqual(skills(), [Skill.ATTACK.getIndex(), Skill.RANGED.getIndex()].sort(), "both stay pinned");
  now += 4 * 60_000 + 1; // the first potion's five minutes are over, the second has a minute left
  processDivine(player);
  assert.equal(player.levels.get(Skill.ATTACK), 99, "the first potion's boost ends on its own time");
  assert.equal(player.levels.get(Skill.RANGED), 112, "the second's is still held");
  assert.deepEqual(skills(), [Skill.RANGED.getIndex()]);
  now += 60_000;
  processDivine(player);
  assert.equal(player.levels.get(Skill.RANGED), 99);
  assert.equal(player.getAttribute("potions:divine:state"), null);
});

// rsprox_transcripts/239/04263.txt (a normal world): the warning as the timers reach 30 ticks, the worn-off line at 0,
// one line for a potion's skills together. 234 and 237: a divine ranging potion's own warning. 237/01148.txt and seven
// more: dying clears the timers with no line.
test("divine potions: the warning at 30 ticks left, the worn-off line at the end, and a silent clear on death", (t) => {
  const WARNING = "<col=ff3045>Your divine potion effect is about to expire.</col>";
  const RANGING = "<col=ff3045>Your divine ranging potion is about to expire.</col>";
  const WORN_OFF = "<col=ff3045>The effects of the divine potion have worn off.";
  const TICK = 600;
  let now = 2_000_000;
  t.mock.method(Date, "now", () => now);
  const drink = (skills) => {
    const player = createPlayer({ current: 99 });
    const lines = [];
    player.sendMessage = (text) => lines.push(text);
    applyDivine(player, (p) => { for (const skill of skills) p.levels.set(skill, 112); }, skills, { damage: 0 });
    return { player, lines };
  };
  const bastion = drink([Skill.RANGED, Skill.DEFENCE]);
  now += 469 * TICK;
  processDivine(bastion.player);
  assert.deepEqual(bastion.lines, [], "31 ticks left: nothing yet");
  now += TICK;
  processDivine(bastion.player);
  processDivine(bastion.player);
  assert.deepEqual(bastion.lines, [WARNING], "30 ticks left: one line for both skills, once");
  now += 30 * TICK;
  processDivine(bastion.player);
  assert.deepEqual(bastion.lines, [WARNING, WORN_OFF]);
  assert.equal(bastion.player.levels.get(Skill.RANGED), 99);

  const ranging = drink([Skill.RANGED]);
  now += 470 * TICK;
  processDivine(ranging.player);
  assert.deepEqual(ranging.lines, [RANGING], "the divine ranging potion names itself");

  const dead = drink([Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]);
  Potions._test.clearDivineOnDeath({ player: dead.player });
  assert.equal(dead.player.getAttribute("potions:divine:state"), null);
  now += 600 * TICK;
  processDivine(dead.player);
  assert.deepEqual(dead.lines, [], "no line on death, and none later");
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
  assert.equal(player.levels.get(Skill.ATTACK), 105, "the reduced divine level holds after a relog");
  assert.equal(player.getAttribute("potions:divine:state").targets[0].target, 105);
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
    MagicSpellbook: require("../dist/game/model/MagicSpellbook").MagicSpellbook,
    RegionManager: { blocked: () => false },
  },
  persistAttribute() {},
  onItemAction: (handler) => { breakTablet = handler; },
  onPlayerLogin() {},
  onSpellCast() {},
  emitCustomEvent: (name, request) => houseTablet(request),
  onCustomEvent() {},
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
  // Anywhere in the Varrock spell's 5x5 landing square (rsprox captures).
  const { destination } = teleports[0];
  assert.ok(Math.abs(destination.getX() - 3213) <= 2 && Math.abs(destination.getY() - 3424) <= 2, `${destination.getX()},${destination.getY()}`);
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

test("the minute cycle decays boosts one point toward base and leaves drains to the core", () => {
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
  assert.equal(player.levels.get(Skill.STRENGTH), 90, "drains restore on the core's own timer, not a second time here");
  assert.equal(player.levels.get(Skill.PRAYER), 110, "prayer points do not decay");
  assert.equal(player.levels.get(Skill.HITPOINTS), 110, "hitpoints above base drop on the core's Hitpoints timer");
});

test("Preserve stretches the boost cycle to 90 seconds once it has been on for 15", () => {
  const { PrayerHandler } = core;
  const player = createPlayer({ base: 99, current: 99 });
  player.levels.set(Skill.ATTACK, 110);
  player.prayerActive[PrayerHandler.PRESERVE] = true;
  notePreserveActivated({ player, prayerId: PrayerHandler.PRESERVE });
  player.setAttribute("potions:preserve-since", Date.now() - 15_000);

  const cycleEnd = Date.now() - 1;
  player.setAttribute("potions:boost-cycle", cycleEnd);
  processBoostDecay(player);
  assert.equal(player.levels.get(Skill.ATTACK), 110, "the boost holds when the minute ends");
  assert.equal(player.getAttribute("potions:boost-cycle"), cycleEnd + 30_000, "the cycle runs 30 seconds longer");
  player.setAttribute("potions:boost-cycle", Date.now() - 1);
  processBoostDecay(player);
  assert.equal(player.levels.get(Skill.ATTACK), 109, "then the stretched cycle decays it");

  notePreserveActivated({ player, prayerId: PrayerHandler.PRESERVE });
  player.setAttribute("potions:boost-cycle", Date.now() - 1);
  processBoostDecay(player);
  assert.equal(player.levels.get(Skill.ATTACK), 108, "Preserve switched on under 15 seconds ago does not stretch it");
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
  player.setVenomed(false);
  Potions._test.findPotionEntry(ItemIdentifiers.ANTIPOISON_MIX_2_).potion.effect(player);
  assert.equal(player.levels.get(Skill.HITPOINTS), 53, "the mix adds 3 Hitpoints");
  assert.equal(player.poisonDamage, 0);
  assert.equal(player.venomed, false);
  assert.equal(player.poisonImmunity.seconds, 90);
});

test("a ranging mix drinks as a ranging potion and heals 6; an attack mix heals 3", () => {
  const ranger = createPlayer({ base: 99, current: 50 });
  const entry = Potions._test.findPotionEntry(ItemIdentifiers.RANGING_MIX_2_);
  assert.equal(entry.replacementId, ItemIdentifiers.RANGING_MIX_1_);
  assert.equal(Potions._test.findPotionEntry(ItemIdentifiers.RANGING_MIX_1_).doses, 1);
  entry.potion.effect(ranger);
  // A drained stat gains the boost from where it stands (rsprox 226/01702: super combat at 97/99 gives 116).
  assert.equal(ranger.levels.get(Skill.RANGED), 50 + 13, "Wiki: +4 + 10%, 13 at 99, added to the current 50");
  assert.equal(ranger.levels.get(Skill.HITPOINTS), 56);
  const rested = createPlayer({ base: 99, current: 99 });
  entry.potion.effect(rested);
  assert.equal(rested.levels.get(Skill.RANGED), 99 + 13, "from base: the full boost");
  entry.potion.effect(rested);
  assert.equal(rested.levels.get(Skill.RANGED), 99 + 13, "and never past base + boost");
  const fighter = createPlayer({ base: 99, current: 50 });
  Potions._test.findPotionEntry(ItemIdentifiers.ATTACK_MIX_2_).potion.effect(fighter);
  assert.equal(fighter.levels.get(Skill.HITPOINTS), 53);
});

test("an energy potion and an energy mix restore 15% run energy a dose; the mix also heals 3", () => {
  for (const [id, heals] of [[ItemIdentifiers.ENERGY_POTION_4_, 0], [ItemIdentifiers.ENERGY_MIX_2_, 3]]) {
    const runner = createPlayer({ base: 99, current: 50 });
    const effect = Potions._test.findPotionEntry(id).potion.effect;
    effect(runner);
    assert.equal(runner.getRunEnergy(), 15, "Wiki: 15% a dose from 0%");
    runner.setRunEnergy(50);
    effect(runner);
    assert.equal(runner.getRunEnergy(), 65, "and from 50%");
    assert.equal(runner.levels.get(Skill.HITPOINTS), 50 + heals * 2);
  }
});

test("a Zamorak mix deals floor((HP - 1) / 8) then heals 6, keeping the brew's boosts and Prayer", () => {
  for (const [hp, after] of [[50, 50], [99, 93], [1, 7]]) {
    const player = createPlayer({ base: 99, current: 99 });
    player.levels.set(Skill.HITPOINTS, hp);
    Potions._test.findPotionEntry(ItemIdentifiers.ZAMORAK_MIX_2_).potion.effect(player);
    assert.equal(player.levels.get(Skill.HITPOINTS), after, `Wiki, at ${hp} Hitpoints`);
  }
  const mixed = createPlayer({ base: 99, current: 99 });
  const brewed = createPlayer({ base: 99, current: 99 });
  Potions._test.findPotionEntry(ItemIdentifiers.ZAMORAK_MIX_2_).potion.effect(mixed);
  Potions._test.findPotionEntry(ItemIdentifiers.ZAMORAK_BREW_4_).potion.effect(brewed);
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.PRAYER]) {
    assert.equal(mixed.levels.get(skill), brewed.levels.get(skill), "the stat changes are the brew's");
  }
});

test("a weaker antipoison never shortens an active poison immunity", () => {
  const player = createPlayer({ base: 99, current: 99 });
  Potions._test.findPotionEntry(ItemIdentifiers.ANTI_VENOM_4_).potion.effect(player);
  assert.equal(player.poisonImmunity.seconds, 738, "anti-venom gives the published41-step tier");
  Potions._test.findPotionEntry(ItemIdentifiers.ANTIPOISON_4_).potion.effect(player);
  assert.equal(player.poisonImmunity.seconds, 738, "the weaker dose does not decrease it");
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

// rsprox_transcripts/239/04269.txt, 239/04288.txt and 231/02990.txt (normal worlds): the timer steps 66 down to 0 every
// 12 ticks; "...has almost run out!" at 3 left, "...have worn off." at 0, and the worn-off line on death too (239/04272).
// The client's timer, as recorded: prayer_regeneration_potion_timer (11361) 0 -> 66 on a drink (231/02990.txt:8541), a
// step down every 12 ticks, 57 -> 66 on a re-drink (239/04272.txt:13136), -> 0 on expiry or death (239/04272:65174).
test("prayer regeneration sends its timer varbit: 66 on a drink, each step, 0 at the end, and again on login", () => {
  const TIMER = 11361;
  const { resumePrayerRegenerationTimer } = Potions._test;
  const player = createPlayer({ base: 99, current: 1 });
  const values = () => player.varbits.filter(([id]) => id === TIMER).map(([, value]) => value);
  const step = () => { player.getAttribute("potions:prayer-regen:state").nextRestoreAt = Date.now() - 1; processPrayerRegeneration(player); };
  applyPrayerRegeneration(player);
  assert.deepEqual(values(), [66], "a drink");
  step(); step(); step();
  assert.deepEqual(values(), [66, 65, 64, 63], "a step each interval");
  applyPrayerRegeneration(player);
  assert.equal(values().at(-1), 66, "a re-drink starts it again");
  player.varbits.length = 0;
  resumePrayerRegenerationTimer({ player });
  assert.deepEqual(values(), [66], "login shows a running potion's steps");
  clearPrayerRegeneration({ player });
  assert.equal(values().at(-1), 0, "death zeroes it");
  player.varbits.length = 0;
  resumePrayerRegenerationTimer({ player });
  assert.deepEqual(values(), [], "nothing to show with no potion running");

  const expiring = createPlayer({ base: 99, current: 1 });
  const lines = [];
  expiring.sendMessage = (text) => lines.push(`line`);
  applyPrayerRegeneration(expiring);
  expiring.getAttribute("potions:prayer-regen:state").left = 1;
  expiring.varbits.length = 0;
  expiring.getAttribute("potions:prayer-regen:state").nextRestoreAt = Date.now() - 1;
  processPrayerRegeneration(expiring);
  assert.deepEqual(expiring.varbits, [[TIMER, 0]], "the last step sends 0");
  assert.equal(lines.length, 1, "with the worn-off line");
});

test("prayer regeneration: 66 steps, the warning at 3 left, the worn-off line at the end and on death", () => {
  const WARNING = "<col=ff3045>Your Prayer Regeneration potion has almost run out!";
  const WORN_OFF = "<col=ff3045>The effects of your Prayer Regeneration potion have worn off.";
  const player = createPlayer({ base: 99, current: 1 });
  const lines = [];
  player.sendMessage = (text) => lines.push(text);
  applyPrayerRegeneration(player);
  const step = () => { player.getAttribute("potions:prayer-regen:state").nextRestoreAt = Date.now() - 1; processPrayerRegeneration(player); };
  for (let i = 0; i < 62; i++) step();
  assert.deepEqual(lines, [], "nothing said for the first 62 steps");
  step();
  assert.deepEqual(lines, [WARNING], "3 steps left");
  step(); step();
  assert.deepEqual(lines, [WARNING]);
  step();
  assert.deepEqual(lines, [WARNING, WORN_OFF], "the 66th step ends it");
  assert.equal(player.getAttribute("potions:prayer-regen:state"), null);
  assert.equal(player.levels.get(Skill.PRAYER), 1 + 66, "a point each step");

  lines.length = 0;
  applyPrayerRegeneration(player);
  for (let i = 0; i < 10; i++) step();
  applyPrayerRegeneration(player);
  assert.equal(player.getAttribute("potions:prayer-regen:state").left, 66, "a drink while it runs starts it again");
  clearPrayerRegeneration({ player });
  assert.deepEqual(lines, [WORN_OFF], "dying ends it with the worn-off line");
  clearPrayerRegeneration({ player });
  assert.deepEqual(lines, [WORN_OFF], "and says nothing with no potion running");
});

// rsprox_transcripts/226/01702.txt:105119-105678 (a normal world): Attack, Strength and Defence at 97/99, a super
// combat potion, then 116 each: the boost (19) added to the current level. 226/01696.txt: 96 -> 115 and 98 -> 117.
test("a boost adds to the current level, capped at base + boost (super combat, as recorded)", () => {
  const superCombat = Potions._test.findPotionEntry(ItemIdentifiers.SUPER_COMBAT_POTION_4_);
  assert.ok(superCombat, "the potion is registered");
  for (const [current, after] of [[97, 116], [96, 115], [98, 117], [99, 118], [110, 118]]) {
    const player = createPlayer({ base: 99, current });
    superCombat.potion.effect(player);
    for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE]) assert.equal(player.levels.get(skill), after, `${current} -> ${after}`);
  }
});

test("the Drunken Dwarf's beer is drinkable and leaves a beer glass", () => {
  const entry = Potions._test.findPotionEntry(ItemIdentifiers.BEER);
  assert.equal(entry.replacementId, ItemIdentifiers.BEER_GLASS);
  assert.equal(entry.potion.shareable, false);
  assert.equal(Potions._test.findPotionEntry(ItemIdentifiers.BEER_2), null, "noted beer cannot be drunk");
  const player = createPlayer({ base: 99, current: 50 });
  entry.potion.effect(player);
  assert.equal(player.levels.get(Skill.HITPOINTS), 51);
  assert.equal(player.levels.get(Skill.STRENGTH), 52, "+2 on the current 50");
  assert.equal(player.levels.get(Skill.ATTACK), 46);
  entry.potion.effect(player);
  assert.equal(player.levels.get(Skill.STRENGTH), 54, "a drained stat gains the boost again");
  const rested = createPlayer({ base: 99, current: 99 });
  entry.potion.effect(rested);
  entry.potion.effect(rested);
  assert.equal(rested.levels.get(Skill.STRENGTH), 101, "from base the boost does not stack");
  assert.equal(player.levels.get(Skill.ATTACK), 43, "the drain uses the current level");
});

test("drinking beer sends its captured feedback instead of potion completion text", t => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null);
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(player, "getPacketSender", () => sender);
  t.mock.method(player, "sendMessage", message => messages.push(message));
  const beer = core.CacheDefinitions.getObjId("beer");
  const glass = core.CacheDefinitions.getObjId("beer_glass");
  assert.equal(beer, ItemIdentifiers.BEER);
  assert.equal(glass, ItemIdentifiers.BEER_GLASS);
  assert.equal(core.CacheDefinitions.getItem(beer).inventoryActions[0], "Drink");
  player.getInventory().setItem(0, new Item(beer, 1));

  assert.equal(drinkPotion({ player, itemId: beer, slot: 0 }), true);
  assert.equal(player.getInventory().getItems()[0].getId(), glass);
  assert.deepEqual(messages, [
    "You drink the beer. You feel slightly reinvigorated...",
    "...and slightly dizzy too.",
  ]);

  // A blocked repeat must neither consume another beer nor repeat success feedback.
  player.getInventory().setItem(1, new Item(beer, 1));
  drinkPotion({ player, itemId: beer, slot: 1 });
  assert.equal(player.getInventory().getItems()[1].getId(), beer);
  assert.equal(messages.length, 2);
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

// Nightmare Zone's overload (and its 51 Hitpoints) is tested in nightmare-zone.test.cjs.
test("a Saradomin brew may over-heal", () => {
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

test("extended stamina potions restore 40% run energy with a 4-minute drain cut and cost a ring two charges", () => {
  const I = ItemIdentifiers;
  const chain = [I.EXTENDED_STAMINA_POTION_4_, I.EXTENDED_STAMINA_POTION_3_, I.EXTENDED_STAMINA_POTION_2_, I.EXTENDED_STAMINA_POTION_1_];
  chain.forEach((id, index) => {
    const entry = Potions._test.findPotionEntry(id);
    assert.ok(entry, `dose ${4 - index} is a potion`);
    assert.equal(entry.doses, 4 - index);
  });
  const player = createPlayer();
  const now = Date.now();
  Potions._test.findPotionEntry(I.EXTENDED_STAMINA_POTION_4_).potion.effect(player);
  assert.equal(player.getRunEnergy(), 40);
  assert.deepEqual([staminaEffect.energy, staminaEffect.durationMs, staminaEffect.charges], [40, 240000, 2]);
  const end = player.getAttribute("potions:stamina:end");
  assert.ok(end >= now + 240000 && end <= Date.now() + 240000);
  // An ordinary dose stays at 20% for 2 minutes and one charge.
  Potions._test.findPotionEntry(I.STAMINA_POTION_4_).potion.effect(createPlayer());
  assert.deepEqual([staminaEffect.energy, staminaEffect.durationMs, staminaEffect.charges], [20, 120000, 1]);
});
