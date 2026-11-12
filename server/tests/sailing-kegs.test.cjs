// Run after `yarn build`: node --test tests/sailing-kegs.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { Sailing } = require("../dist/game/content/sailing/Sailing");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { Mobile } = require("../dist/game/entity/impl/Mobile");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Item } = require("../dist/game/model/Item");
const { Location } = require("../dist/game/model/Location");
const { Skill } = require("../dist/game/model/Skill");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { emptySailingState, normalizeSailingState } = require("../dist/game/content/sailing/SailingState");
const facilities = require("../plugins/skills/sailing/BoatFacilities.Sailing");
const { slotVarbits, hotspotDataVarbit } = require("../plugins/skills/sailing/BoatVarbits.Sailing");

const STACKABLE = new Set([995, 31812, 31815, 31818, 31821, 31824]);
ItemDefinition.forId = (id) => ({
  getId: () => id,
  getName: () => `item ${id}`,
  isStackable: () => STACKABLE.has(id),
  isNoted: () => STACKABLE.has(id) && id !== 995,
  getExamine: () => "",
});

const KEG_EMPTY = 59691;
const WHIRLPOOL = 31811;
const HORIZONS_LURE = 31823;
const NOTED_HORIZONS_LURE = 31824;
const BEER_GLASS = 1919;
const VARBIT_WHIRLPOOL_ACTIVE = 19180;
const DOCK = "the_pandemonium";

let nextIndex = 400;
function sailor() {
  const player = Object.create(Mobile.prototype);
  const index = nextIndex++;
  let sailing = emptySailingState();
  let location = new Location(3069, 2987, 0);
  const varbits = new Map();
  const sounds = [];
  const boxes = [];
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (key === "getVarbit") return varbits.get(args[0]) ?? 0;
      if (key === "sendVarbit") varbits.set(args[0], args[1]);
      if (key === "sendSoundEffect") sounds.push(args);
      return sender;
    },
  });
  Object.assign(player, {
    messages: [], varbits, sounds, boxes, animations: [], animationDelays: [],
    getIndex: () => index,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getUsername: () => "keg", getDisplayName: () => "keg",
    sendMessage: (message) => player.messages.push(message),
    getLocation: () => location,
    setLocation: (next) => { location = next; return player; },
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {} }),
    setNeedsPlacement() {},
    setResetMovementQueue() {},
    setMobileInteraction() {},
    getSailing: () => sailing,
    setSailing: (next) => { sailing = next; },
    getPacketSender: () => sender,
    performAnimation: (animation) => {
      player.animations.push(animation.getId());
      player.animationDelays.push(animation.getDelay());
    },
    getDialogueManager: () => ({ startDialogues: (chain) => boxes.push(chain) }),
  });
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  return player;
}

function registerKegs() {
  const hooks = { objectHandlers: [], itemOnObject: [], xp: [], events: {} };
  require("../plugins/skills/sailing/Kegs.Sailing").register({
    onObjectInteraction: (handler) => hooks.objectHandlers.push(handler),
    onItemOnObject: (handler) => hooks.itemOnObject.push(handler),
    onCanGainExperience: (handler) => hooks.xp.push(handler),
    onCustomEvent: (name, handler) => { hooks.events[name] = handler; },
    sendMultiChatboxPrompt: (_player, title, ...pairs) => { hooks.prompt = { title, pairs }; },
  });
  return hooks;
}

/** The last item box started: [its item, its text]. */
function lastBox(player) {
  const entry = [...(player.boxes.at(-1)?.dialogues?.values() ?? [])][0];
  return entry ? [entry.getItemId(), entry.getText()] : undefined;
}

let kegs;
let kegRow;
before(() => {
  require("../plugins/skills/sailing/Panel.Sailing").register({
    core: {}, onCustomEvent: () => {}, onPlayerLogin: () => {}, onInterfaceActionClick: () => {},
  });
  Sailing.initialize();
  kegs = registerKegs();
  kegRow = facilities.facilityNamed("Keg");
});

/** A player at sea in their skiff with a keg built on its first hotspot that allows one. */
function atSeaWithKeg() {
  const player = sailor();
  const owned = Sailing.giveBoat(player, "skiff", DOCK);
  const hotspot = facilities.hotspotsOf("skiff").find((candidate) => candidate.allowed.includes(kegRow));
  facilities.setFacility(owned, hotspot.id, kegRow);
  assert.equal(Sailing.board(player, DOCK), null);
  const boat = Sailing.instanceAboard(player);
  const loc = BoatManager.getSpec(boat).locs.find((candidate) => candidate.hotspot === hotspot.id);
  const location = { x: boat.deckBaseX + loc.x, y: boat.deckBaseY + loc.y, z: 0 };
  const objectId = () => BoatManager.getSpec(boat).locs.find((candidate) => candidate.hotspot === hotspot.id).id;
  const use = (itemId) => {
    const itemSlot = player.getInventory().getItems().findIndex((item) => item?.getId?.() === itemId);
    const event = { player, objectId: objectId(), itemId, itemSlot, location, handled: false };
    kegs.itemOnObject.forEach((handler) => handler(event));
    return event.handled;
  };
  const click = (clickType) => {
    const event = { player, objectId: objectId(), clickType, location, handled: false };
    kegs.objectHandlers.forEach((handler) => handler(event));
    return event.handled;
  };
  return { player, owned, boat, hotspot: hotspot.id, objectId, use, click,
    done: () => Sailing.disembark(player, DOCK) };
}

test("a keg's drink is the hotspot's extra data and picks its loc", () => {
  const sloop = { slot: 2, type: "sloop", facilities: [], name: [0, 0, 0], location: { kind: "docked", dock: DOCK }, parts: {} };
  const hotspot = facilities.hotspotsOf("sloop").find((candidate) => candidate.allowed.includes(kegRow));
  facilities.setFacility(sloop, hotspot.id, kegRow);
  assert.equal(facilities.hotspotLocs(sloop).find((loc) => loc.hotspot === hotspot.id).id, KEG_EMPTY);
  sloop.hotspotData = [];
  sloop.hotspotData[hotspot.id] = 7;
  assert.equal(facilities.hotspotLocs(sloop).find((loc) => loc.hotspot === hotspot.id).id, 59698, "Keg of horizon's lure");
  // sailing_boat_3_hotspot_2_extra_data is 19363 (captured 0 -> 3 for whirlpool surprise).
  assert.equal(hotspotDataVarbit(2, 2), 19363);
  assert.equal(hotspotDataVarbit(0, 11), 20209, "sailing_boat_1_hotspot_11_extra_data");
  assert.equal(hotspotDataVarbit(0, 12), 20210);
  assert.equal(slotVarbits(2, sloop).get(hotspotDataVarbit(2, hotspot.id)), 7);
  // A save keeps it; replacing the keg empties it.
  const saved = normalizeSailingState(JSON.parse(JSON.stringify({ boats: [sloop] })));
  assert.equal(saved.boats[0].hotspotData[hotspot.id], 7);
  facilities.setFacility(sloop, hotspot.id, kegRow);
  assert.equal(sloop.hotspotData[hotspot.id], 0);
  assert.equal(normalizeSailingState({ boats: [{ ...sloop }] }).boats[0].hotspotData, undefined);
});

test("25 ales pour into the empty keg, a glass fills from it, and Empty empties it", () => {
  const h = atSeaWithKeg();
  try {
    assert.equal(h.objectId(), KEG_EMPTY);
    // Check on the empty keg.
    assert.equal(h.click(1), true);

    // Too few ales: nothing poured.
    h.player.getInventory().add(new Item(HORIZONS_LURE, 24), false);
    assert.equal(h.use(HORIZONS_LURE), true);
    assert.equal(h.objectId(), KEG_EMPTY);
    assert.equal(h.player.getInventory().getAmount(HORIZONS_LURE), 24);
    assert.match(h.player.messages.at(-1), /You need 25 of an ale/);

    // 25 noted.
    h.player.getInventory().add(new Item(NOTED_HORIZONS_LURE, 30), false);
    assert.equal(h.use(NOTED_HORIZONS_LURE), true);
    assert.equal(h.player.getInventory().getAmount(NOTED_HORIZONS_LURE), 5);
    assert.equal(h.player.getInventory().getAmount(HORIZONS_LURE), 24, "not a mixture");
    assert.equal(h.objectId(), 59698, "Keg of horizon's lure");
    assert.equal(h.owned.hotspotData[h.hotspot], 7);
    assert.equal(h.player.varbits.get(hotspotDataVarbit(h.owned.slot, h.hotspot)), 7);
    assert.deepEqual(h.player.animations, [832]);
    assert.equal(h.player.sounds.at(-1)[0], 2401);

    // A beer glass fills from it in its own slot, and the keg never runs out.
    h.player.getInventory().add(new Item(BEER_GLASS, 2), false);
    const glassSlot = h.player.getInventory().getItems().findIndex((item) => item?.getId?.() === BEER_GLASS);
    const freed = h.player.getInventory().getItems().findIndex((item) => item?.getId?.() === HORIZONS_LURE);
    assert.ok(freed < glassSlot);
    h.player.getInventory().setItem(freed, new Item(-1, 0)); // a free slot before the glass
    assert.equal(h.use(BEER_GLASS), true);
    assert.equal(h.player.getInventory().getItems()[glassSlot].getId(), HORIZONS_LURE, "the glass's slot");
    assert.equal(h.use(BEER_GLASS), true);
    assert.equal(h.player.messages.at(-1), "You fill a glass from the keg.");
    assert.equal(h.player.getInventory().getAmount(BEER_GLASS), 0);
    assert.equal(h.player.getInventory().getAmount(HORIZONS_LURE), 25, "23 left over, 2 filled");
    assert.equal(h.player.animations.at(-1), 3660);
    assert.equal(h.player.animationDelays.at(-1), 11);
    assert.equal(h.objectId(), 59698);
    assert.equal(h.use(WHIRLPOOL), false, "a filled keg takes no other ale");

    // Empty: the confirmation, then the keg is empty again and nothing comes back.
    assert.equal(h.click(2), true);
    assert.equal(kegs.prompt.title, "Are you sure you wish to empty the keg?<br>All of its contents will be lost.");
    assert.deepEqual(kegs.prompt.pairs.filter((_, i) => i % 2 === 0), ["Yes, empty the keg.", "No, do not empty the keg."]);
    kegs.prompt.pairs[3](h.player);
    assert.equal(h.objectId(), 59698, "No keeps it");
    kegs.prompt.pairs[1](h.player);
    assert.equal(h.objectId(), KEG_EMPTY);
    assert.equal(h.owned.hotspotData[h.hotspot], 0);
    assert.equal(h.player.getInventory().getAmount(NOTED_HORIZONS_LURE), 5);
  } finally {
    h.done();
  }
});

test("Check describes the keg in a box showing its glass", () => {
  const h = atSeaWithKeg();
  try {
    h.click(1);
    assert.deepEqual(lastBox(h.player), [BEER_GLASS,
      "Unfortunately this keg is empty... On the bright side, it is now ready to be filled with some nice cold drinks."]);
    h.player.getInventory().add(new Item(WHIRLPOOL, 25), false);
    h.use(WHIRLPOOL);
    assert.equal(h.player.getInventory().getAmount(WHIRLPOOL), 0, "all 25 glasses poured");
    assert.deepEqual(lastBox(h.player), [WHIRLPOOL,
      "You carefully pour all of the alcohol into the keg. Once done, you do a double take as somehow there appears to be far more inside the keg than you actually put in."]);
    h.click(1);
    assert.deepEqual(lastBox(h.player), [WHIRLPOOL,
      "This keg is filled with whirlpool surprise. A keg of whirlpool surprise gives your crew a minimum of 2 Deckhandiness and 2 Helmsmanship."]);
  } finally {
    h.done();
  }
});

test("while aboard, horizon's lure adds 2.5% Sailing XP and whirlpool surprise raises the crew's stats", () => {
  const h = atSeaWithKeg();
  const gain = (skill) => {
    const event = { player: h.player, skill, experience: 100, allow: null, multiplier: 1 };
    kegs.xp.forEach((handler) => handler(event));
    return event.multiplier;
  };
  const { crewStat, cannonMaxHitBonus } = require("../plugins/skills/sailing/Kegs.Sailing");
  try {
    assert.equal(gain(Skill.SAILING), 1);
    h.player.getInventory().add(new Item(HORIZONS_LURE, 25), false);
    h.use(HORIZONS_LURE);
    assert.equal(gain(Skill.SAILING), 1.025);
    assert.equal(gain(Skill.FISHING), 1, "only Sailing");
    assert.equal(crewStat(h.owned, 1, 3), 1, "no whirlpool surprise");
    assert.equal(cannonMaxHitBonus(h.player), 0);

    h.click(2);
    kegs.prompt.pairs[1](h.player);
    h.player.getInventory().add(new Item(WHIRLPOOL, 25), false);
    h.use(WHIRLPOOL);
    assert.equal(h.player.varbits.get(VARBIT_WHIRLPOOL_ACTIVE), 1, "sailing_sidepanel_whirlpool_surprise_active");
    assert.equal(gain(Skill.SAILING), 1, "the lure was emptied");
    assert.deepEqual([crewStat(h.owned, 1, 3), crewStat(h.owned, 0, 1), crewStat(h.owned, 4, 3), crewStat(h.owned, 1, 2)], [2, 2, 4, 1],
      "Deckhandiness and Helmsmanship at least 2; Privateering unchanged");
    kegs.events["sailing:left"]({ player: h.player, reason: "disembark" });
    assert.equal(h.player.varbits.get(VARBIT_WHIRLPOOL_ACTIVE), 0);
  } finally {
    h.done();
  }
  assert.equal(gain(Skill.SAILING), 1, "ashore no keg applies");
});

test("perildance bitter raises cannon max hits by one", () => {
  const h = atSeaWithKeg();
  const { cannonMaxHitBonus } = require("../plugins/skills/sailing/Kegs.Sailing");
  try {
    h.player.getInventory().add(new Item(31817, 25), false);
    h.use(31817);
    assert.equal(h.objectId(), 59696);
    assert.equal(cannonMaxHitBonus(h.player), 1);
  } finally {
    h.done();
  }
});
