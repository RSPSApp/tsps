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
    messages: [], varbits, sounds, boxes, animations: [],
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
    performAnimation: (animation) => player.animations.push(animation.getId()),
    getDialogueManager: () => ({ startDialogues: (chain) => boxes.push(chain) }),
  });
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  return player;
}

function registerKegs() {
  const hooks = { objectHandlers: [], itemOnObject: [], xp: [], events: {} };
  require("../plugins/skills/sailing/Kegs.plugin").register({
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
  require("../plugins/skills/sailing/Sailing.plugin").register({
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
    const event = { player, objectId: objectId(), itemId, location, handled: false };
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

    // A beer glass fills from it, and it never runs out.
    h.player.getInventory().add(new Item(BEER_GLASS, 2), false);
    assert.equal(h.use(BEER_GLASS), true);
    assert.equal(h.use(BEER_GLASS), true);
    assert.equal(h.player.messages.at(-1), "You fill a glass from the keg.");
    assert.equal(h.player.getInventory().getAmount(BEER_GLASS), 0);
    assert.equal(h.player.getInventory().getAmount(HORIZONS_LURE), 26);
    assert.equal(h.player.animations.at(-1), 3660);
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
  const { crewStat, cannonMaxHitBonus } = require("../plugins/skills/sailing/Kegs.plugin");
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
  const { cannonMaxHitBonus } = require("../plugins/skills/sailing/Kegs.plugin");
  try {
    h.player.getInventory().add(new Item(31817, 25), false);
    h.use(31817);
    assert.equal(h.objectId(), 59696);
    assert.equal(cannonMaxHitBonus(h.player), 1);
  } finally {
    h.done();
  }
});

// --- Chartin' Charles McAtless's drinks.

const { PluginManager } = require("../dist/plugins/PluginManager");
const { ActionDialogue } = require("../dist/game/model/dialogues/entries/impl/ActionDialogue");
const chartingCommon = require("../plugins/skills/sailing/charting/Common.Charting");
const drinks = require("../plugins/skills/sailing/charting/Drinks.Charting");

/** A customer whose dialogues play through at once: the lines said, in order, and the menus offered. */
function customer() {
  const player = sailor();
  const attributes = new Map();
  player.getAttribute = (key) => attributes.get(key);
  player.setAttribute = (key, value) => { attributes.set(key, value); return player; };
  player.said = [];
  player.getDialogueManager = () => ({
    startDialogues: (chain) => {
      for (const entry of chain.dialogues.values()) {
        if (entry instanceof ActionDialogue) entry.send(player);
        else player.said.push(entry.getText());
      }
    },
  });
  return player;
}

let menu;
let charlesChoice;
before(() => {
  const real = PluginManager.createApi("SailingKegsTest");
  drinks({
    ...real,
    onCustomEvent: (name, handler) => { if (name === "npc-dialogue:choice") charlesChoice = handler; },
    sendMultiChatboxPrompt: (_player, title, ...pairs) => { menu = { title, pairs }; },
    emitCustomEvent: () => {},
  });
});

/** Picks a menu option by its text. */
function pick(player, text) {
  const at = menu.pairs.indexOf(text);
  assert.ok(at >= 0, `"${text}" in ${JSON.stringify(menu.pairs.filter((p) => typeof p === "string"))}`);
  menu.pairs[at + 1](player);
}

/** Marks every spot of the first `count` seas (of an ocean, or any) as charted. */
function chartSeas(player, count, ocean) {
  chartingCommon.allSpots();
  const seas = [...chartingCommon.allSeas().values()]
    .filter((sea) => sea.type === 0 && sea.spots.length > 0 && (!ocean || sea.ocean?.name === ocean))
    .slice(0, count);
  assert.equal(seas.length, count, `${count} seas in ${ocean ?? "all oceans"}`);
  chartingCommon.updateProgress(player, (saved) => {
    saved.charted = [...new Set([...saved.charted, ...seas.flatMap((sea) => sea.spots.map((spot) => spot.uid))])];
  });
}

function chooseDrink(player, option) {
  const event = { player, npcId: 15151, option, stepId: undefined };
  charlesChoice(event);
  return event.end === true;
}

test("Charles won't sell horizon's lure before 70 seas are charted", () => {
  const player = customer();
  assert.equal(chooseDrink(player, "Horizon's lure."), true, "the drink's branch plays here");
  assert.deepEqual(player.said.slice(0, 2), ["Horizon's lure.",
    "Ah, the old classic. In many ways, there's nothing too fancy about horizon's lure. It's quite simply the perfect drink when all you care about is sailing."]);
  assert.ok(player.said.includes("Having a keg of horizon's lure on your boat will give a 2.5% boost to all Sailing experience gained."));
  assert.ok(player.said.includes("Buying horizon's lure requires the following: Completely chart 70 seas across all oceans."));
  assert.equal(menu.title, "Select an option", "back to the drinks");
  assert.equal(chooseDrink(player, "Hello."), false, "other options are the transcript's");
});

test("with the seas charted, Charles sells a glass for 300 coins or a keg's worth, noted, for 7,500", () => {
  const player = customer();
  chartSeas(player, 70);
  player.getInventory().add(new Item(995, 7900), false);
  chooseDrink(player, "Horizon's lure.");
  assert.equal(player.said.at(-1), "Anyway, I'm pleased to say that you've done enough charting for me to sell you some! Would you like to buy a glass to sample it? Or do you want enough to fill a keg?");
  assert.equal(menu.title, "How much horizon's lure would you like to buy?");
  pick(player, "A keg full (25).");
  assert.equal(menu.title, "Buy 25 x horizon's lure for 7,500 coins?");
  pick(player, "Yes.");
  assert.equal(player.getInventory().getAmount(NOTED_HORIZONS_LURE), 25);
  assert.equal(player.getInventory().getAmount(995), 400);
  assert.deepEqual(player.said.slice(-2), ["Charles sells you 25 x horizon's lure.", "There you go! Enjoy! Now, are you interested in any other drinks?"]);
  assert.equal(menu.title, "Select an option");

  chooseDrink(player, "Horizon's lure.");
  pick(player, "A glass (1).");
  assert.equal(menu.title, "Buy 1 x horizon's lure for 300 coins?");
  pick(player, "Yes.");
  assert.equal(player.getInventory().getAmount(HORIZONS_LURE), 1);
  assert.equal(player.getInventory().getAmount(995), 100);
  chooseDrink(player, "Horizon's lure.");
  pick(player, "A glass (1).");
  pick(player, "Yes.");
  assert.equal(player.said.at(-1), "Even I can see you don't have space to hold that, and just to be completely clear, I am totally blind!");
  assert.equal(player.getInventory().getAmount(HORIZONS_LURE), 1, "100 coins buy nothing");
});

test("kraken ink stout and perildance bitter need seas in particular oceans", () => {
  const player = customer();
  const [kraken, perildance, trawler] = drinks.DRINKS;
  chartSeas(player, 5, "Ardent Ocean");
  assert.equal(drinks.canBuy(player, kraken), false);
  chartSeas(player, 5, "Unquiet Ocean");
  assert.equal(drinks.canBuy(player, kraken), true);
  chartSeas(player, 8, "Western Ocean");
  assert.equal(drinks.canBuy(player, perildance), false);
  chartSeas(player, 5, "Shrouded Ocean");
  assert.equal(drinks.canBuy(player, perildance), true);
  assert.equal(drinks.canBuy(player, trawler), false, "23 seas, not 50");
});
