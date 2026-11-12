// Run after `yarn build`: node --test tests/sea-charting.test.cjs
// Sailing's sea charting against the cache and the rsprox captures (docs/sea-charting.md).
const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Sailing } = require("../dist/game/content/sailing/Sailing");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { Mobile } = require("../dist/game/entity/impl/Mobile");
const { Location } = require("../dist/game/model/Location");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { emptySailingState } = require("../dist/game/content/sailing/SailingState");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { World } = require("../dist/game/World");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const common = require("../plugins/skills/sailing/charting/Common.Charting");
const generic = require("../plugins/skills/sailing/charting/Generic.Charting");
const { content } = require("../plugins/skills/sailing/SailingContent.Sailing");

const SAILING = "Sailing";
const VARP_SPOTS = 5016;
const varbit = (name) => CacheDefinitions.getVarbitId(name);
const blue = (text) => `<col=0090bc>${text}</col>`;

/** The object handlers the charting units registered, run as a click would run them. */
const objectHandlers = [];
const beforeObjectHandlers = [];
before(() => {
  content();
  const real = PluginManager.createApi("SeaChartingTest");
  const api = {
    ...real,
    persistAttribute() {},
    onObjectInteraction: (handler) => { if (typeof handler === "function") objectHandlers.push(handler); },
    onBeforeObjectInteraction: (handler) => beforeObjectHandlers.push(handler),
  };
  require("../plugins/skills/sailing/Panel.Sailing").register(real);
  require("../plugins/skills/sailing/Helm.Sailing").register({ ...real, onObjectInteraction() {}, onObjectRoute() {} });
  require("../plugins/interface/Notifications.plugin").register(real);
  require("../plugins/skills/sailing/Charting.Sailing").register(api);
});

let nextIndex = 900;
/** A player on the real Mobile prototype, with varbits, varps, attributes and what they're sent. */
function captain({ level = 99 } = {}) {
  const player = Object.create(Mobile.prototype);
  const index = nextIndex++;
  const varbits = new Map();
  const varps = new Map();
  const attributes = new Map();
  const sent = [];
  const xp = [];
  const animations = [];
  const levels = new Map([[SAILING, level]]);
  let location = new Location(3035, 2920, 0);
  let sailing = emptySailingState();
  let current;
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (key === "getVarbit") {
        const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(args[0]);
        return ((varps.get(baseVar) ?? 0) >>> startBit) & ((2 ** (endBit - startBit + 1)) - 1);
      }
      if (key === "getVarp") return varps.get(args[0]) ?? 0;
      if (key === "sendVarbit") {
        const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(args[0]);
        const mask = ((2 ** (endBit - startBit + 1)) - 1) << startBit;
        varps.set(baseVar, ((varps.get(baseVar) ?? 0) & ~mask) | ((args[1] << startBit) & mask));
        varbits.set(args[0], args[1]);
      }
      if (key === "sendConfig") varps.set(args[0], args[1] | 0);
      sent.push([key, ...args]);
      return sender;
    },
  });
  Object.assign(player, {
    varbits, varps, attributes, sent, xp, levels, animations,
    messages: () => sent.filter(([key]) => key === "sendMessage" || key === "sendTypedMessage").map((entry) => entry.at(-1)),
    getIndex: () => index,
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    getAsPlayer: () => player,
    getUsername: () => "captain", getDisplayName: () => "captain",
    getRights: () => 0,
    sendMessage: (message) => sent.push(["sendMessage", message]),
    performAnimation: (animation) => animations.push(animation.getId?.() ?? animation.id ?? animation),
    performGraphic() {},
    setPositionToFace() { return player; },
    getLocation: () => location,
    setLocation: (next) => { location = next; return player; },
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {}, size: () => 0 }),
    setNeedsPlacement() {},
    setResetMovementQueue() {},
    setMobileInteraction() {},
    getLocalPlayers: () => [],
    getSailing: () => sailing,
    setSailing: (next) => { sailing = next; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels.get(skill.getName?.() ?? skill) ?? 1,
      getMaxLevel: (skill) => levels.get(skill.getName?.() ?? skill) ?? 1,
      addExperiences: (skill, amount) => xp.push(amount),
    }),
    getEquipment: () => ({ get: () => undefined, getItems: () => [], contains: () => false }),
    getSpellbook: () => ({ getInterfaceId: () => 218 }),
    getBank: () => ({ contains: () => false }),
    getDialogueManager: () => ({
      startDialogues: (chain) => { player.chain = chain; current = [...chain.getDialogues().values()][0]; },
      getCurrent: () => current,
      reset() { current = undefined; },
    }),
    getPacketSender: () => sender,
    getInterfaceId: () => player.interfaceId ?? -1,
    setInterfaceId: (id) => { player.interfaceId = id; },
  });
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  World.getPlayers().get = ((get) => (i) => (i === index ? player : get(i)))(World.getPlayers().get.bind(World.getPlayers()));
  return player;
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    World.processCycle = (World.processCycle | 0) + 1;
    TaskManager.process();
    BoatManager.tick();
    // The ducks out at sea walk as the world would move them.
    for (const duck of require("../plugins/skills/sailing/charting/CurrentDuck.Charting").ducks.values()) duck.npc.getMovementQueue().process();
  }
}

/** On a skiff at the helm, by the Bay of Sarim's treacherous rock. */
function atTheHelm(player) {
  Sailing.giveBoat(player, "skiff", "the_pandemonium");
  assert.equal(Sailing.board(player, "the_pandemonium"), null);
  const boat = Sailing.instanceAboard(player);
  boat.helmPlayerId = player.getIndex();
  player.varbits.set(19105, 3); // sailing_boat_facility_lockedin: at the helm
  BoatManager.teleport(boat, { fineX: 3080 * 128 + 64, fineY: 3228 * 128 + 64 });
  return boat;
}

function leave(player) {
  const boat = Sailing.instanceAboard(player);
  if (boat) BoatManager.dispose(boat);
}

/** A Chart click on a generic spot's loc, as the object listener hands it to the plugins. */
function chart(player, key, clickType = 1) {
  const spot = common.spotByKey(key);
  const id = [...generic.spotsByLoc()].find(([, each]) => each === spot)[0];
  const event = { player, objectId: id, clickType, option: "Chart", location: { x: 0, y: 0, z: 0 }, handled: false };
  for (const handler of objectHandlers) {
    handler(event);
    if (event.handled) break;
  }
  return event;
}

function spotBit(player, spot) {
  return ((player.varps.get(VARP_SPOTS + (spot.uid >> 5)) ?? 0) >>> (spot.uid & 31)) & 1;
}

test("the cache's 358 charting tasks, six kinds, each with its completion bit (script 9004)", () => {
  const spots = [...common.allSpots().values()];
  assert.equal(spots.length, 358);
  const kinds = {};
  for (const spot of spots) kinds[spot.type] = (kinds[spot.type] ?? 0) + 1;
  assert.deepEqual(kinds, { generic: 94, spyglass: 57, current_duck: 54, drink_crate: 65, weather_troll: 31, mermaid_guide: 57 });
  assert.deepEqual(spots.map((spot) => spot.uid).sort((a, b) => a - b), Array.from({ length: 358 }, (_, i) => i));
  let named = 0;
  for (const spot of spots) {
    const id = varbit(`sailing_charting_${spot.key}_complete`);
    if (id === null || id === undefined) continue;
    named++;
    const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
    assert.deepEqual([baseVar, startBit, endBit], [VARP_SPOTS + (spot.uid >> 5), spot.uid & 31, spot.uid & 31], spot.key);
  }
  // Only the Porth Gwenith weather troll's bit has no varbit name.
  assert.equal(named, 357);
});

test("every generic task has its Chart loc (or a Port Sarim loc) and its captured line", () => {
  const byLoc = generic.spotsByLoc();
  assert.equal(byLoc.size, 92);
  const withLoc = new Set(byLoc.values());
  const without = common.spotsOfType("generic").filter((spot) => !withLoc.has(spot)).map((spot) => spot.key).sort();
  assert.deepEqual(without, ["generic_board_port_sarim", "generic_salvage_station_port_sarim"]);
  for (const spot of common.spotsOfType("generic")) assert.ok(spot.flavour?.length > 0, spot.key);
  for (const id of byLoc.keys()) assert.deepEqual(CacheDefinitions.getObject(id).interactions?.[0] ?? CacheDefinitions.getObject(id).actions?.[0], "Chart");
});

test("seas and oceans count their tasks as the completion messages do (rsprox: Ardent 69, Miscellaneous 33)", () => {
  const seas = [...common.allSeas().values()];
  const named = (name) => seas.find((sea) => sea.name === name);
  assert.equal(named("Bay of Sarim").spots.length, 5);
  assert.equal(common.oceanSpots(named("Ardent Ocean")).length, 69);
  assert.equal(common.oceanSpots(named("Shrouded Ocean")).length, 75);
  assert.equal(common.oceanSpots(named("Miscellaneous")).length, 33);
  // The bonus by the sea's XP level (the Wiki; rsprox 944: 17,230 for the Southern Expanse).
  assert.equal(common.seaBonusXp(named("Southern Expanse")), 17230);
  assert.equal(common.seaBonusXp(named("Bay of Sarim")), 190);
  assert.equal(common.seaBonusXp(named("Kharidian Sea")), 190);
  assert.equal(common.seaBonusXp(named("Pilgrims' Passage")), 1710);
  assert.equal(common.seaBonusXp(named("Sea of Shells")), 2880);
  assert.equal(common.seaBonusXp(named("Bonus Dives")), 1710);
});

test("Chart from the helm: the helm goes on the click, the charting a tick later (rsprox 1009)", () => {
  const player = captain();
  atTheHelm(player);
  try {
    const spot = common.spotByKey("generic_rock_bay_of_sarim");
    const event = chart(player, "generic_rock_bay_of_sarim");
    assert.equal(event.handled, true);
    assert.equal(player.varbits.get(19105), 0, "facility_lockedin 3->0 on the click");
    assert.equal(player.varbits.get(19205), 0, "player_at_helm 1->0");
    assert.equal(spotBit(player, spot), 0);
    assert.deepEqual(player.xp, []);
    tick();
    assert.deepEqual(player.animations.slice(-1), [13302]);
    assert.equal(spotBit(player, spot), 1);
    assert.deepEqual(player.messages().slice(-4), [
      "You note the position of the dangerous rocks in your charts.",
      `Charting complete: ${blue("Find a treacherous rock formation near Draynor Village.")}`,
      `Bay of Sarim charting completion: ${blue("1/5")}`,
      `Ardent Ocean charting completion: ${blue("1/69")}`,
    ]);
    assert.ok(player.sent.some(([key, script, args]) => key === "sendInterfaceScript" && script === 3343
      && args[0] === "Charting Complete!" && args[1] === "Find a treacherous rock formation near Draynor Village."));
    assert.ok(player.sent.some(([key, id]) => key === "sendSoundEffect" && id === 11166));
    assert.deepEqual(player.xp, [35]);
    assert.equal(player.varps.get(5037), 1, "sailing_charting_total_entries");

    chart(player, "generic_rock_bay_of_sarim");
    assert.equal(player.messages().at(-1), "You have already charted this and can get no further information from it.");
    assert.deepEqual(player.xp, [35]);
  } finally {
    leave(player);
  }
});

test("Chart off the helm answers on the click (rsprox 3455)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  boat.helmPlayerId = undefined;
  player.varbits.set(19105, 0);
  try {
    chart(player, "generic_rowboat_bay_of_sarim");
    assert.equal(player.messages().at(-3).startsWith("Charting complete:"), true);
    assert.deepEqual(player.xp, [35]);
  } finally {
    leave(player);
  }
});

test("the last task in a sea completes it: the sea's messages, bonus XP and rapids variable (rsprox 944)", () => {
  const player = captain();
  try {
    const sea = common.spotByKey("generic_rock_bay_of_sarim").sea;
    const [last, ...rest] = sea.spots;
    for (const spot of rest) common.complete(player, spot);
    player.xp.length = 0;
    common.complete(player, last);
    const messages = player.messages();
    const at = messages.indexOf(`You have completed charting a sea: ${blue("Bay of Sarim")}`);
    assert.ok(at > 0, messages.join("\n"));
    assert.equal(messages[at - 1], `Ardent Ocean charting completion: ${blue("5/69")}`);
    const rapids = sea.rapids ? [`Fully charting this sea has unlocked the use of some ${blue("rapids")} within it.`] : [];
    assert.deepEqual(messages.slice(at + 1), [...rapids, `You are awarded an additional ${blue("190")} Sailing XP.`]);
    assert.deepEqual(player.xp, [common.xpFor(last) + 190]);
    assert.equal(player.sent.filter(([key, id]) => key === "sendVarbit" && id === varbit("sailing_sea_bay_of_sarim_charting_complete")).length, 0, "sent as its varp word");
    const seaVarbit = CacheDefinitions.getVarbit(varbit("sailing_sea_bay_of_sarim_charting_complete"));
    assert.equal((player.varps.get(seaVarbit.baseVar) >>> seaVarbit.startBit) & 1, 1);
  } finally {
    leave(player);
  }
});

test("an ocean's last task owes its bonus from Chartin' Charles (rsprox: Western Ocean)", () => {
  const player = captain();
  try {
    const ocean = [...common.allSeas().values()].find((sea) => sea.name === "Sunset Ocean");
    const list = common.oceanSpots(ocean);
    for (const spot of list) common.complete(player, spot);
    const messages = player.messages();
    assert.ok(messages.includes(`You have completed charting an ocean: ${blue("Sunset Ocean")}`));
    assert.ok(messages.includes("For fully charting this ocean, Chartin' Charles McAtless on the Pandemonium will provide you with some training when you next speak to him."));
    for (const suffix of ["charting_complete", "charting_ever_complete", "charting_xp_owed"]) {
      const { baseVar, startBit } = CacheDefinitions.getVarbit(varbit(`sailing_sea_sunset_ocean_${suffix}`));
      assert.equal((player.varps.get(baseVar) >>> startBit) & 1, 1, suffix);
    }
    assert.deepEqual(common.progress(player).owed, [ocean.row]);
  } finally {
    leave(player);
  }
});

const notifications = require("../plugins/interface/Notifications.plugin");
/** The popup texts shown and queued for the player, in order. */
function popups(player) {
  const shown = player.sent.filter(([key, script]) => key === "sendInterfaceScript" && script === 3343).map(([, , args]) => args[1]);
  return [...shown, ...(notifications._test.queues.get(player)?.waiting ?? []).map((popup) => popup.text)];
}

test("the Miscellaneous groups complete as a group, not an ocean (rsprox 948)", () => {
  const player = captain();
  try {
    const misc = [...common.allSeas().values()].find((sea) => sea.type === common.SEA_TYPE.MISCELLANEOUS);
    assert.equal(misc.name, "Miscellaneous");
    const list = common.oceanSpots(misc);
    for (const spot of list.slice(0, -1)) common.complete(player, spot);
    const last = list.at(-1);
    const from = player.messages().length;
    common.complete(player, last);
    const messages = player.messages().slice(from);
    const at = messages.indexOf(`You have completed charting a group: ${blue("Miscellaneous")}`);
    assert.ok(at > 0, messages.join("\n"));
    assert.equal(messages[at - 2], `You have completed charting a group: ${blue(last.sea.name)}`);
    assert.equal(messages[at + 1], "For fully charting this group, Chartin' Charles McAtless on the Pandemonium will provide you with some training when you next speak to him.");
    assert.ok(!messages.some((line) => line.includes("an ocean") || line.includes("this ocean")), messages.join("\n"));
    assert.deepEqual(popups(player).slice(-3), [last.hint, `${last.sea.name} fully charted!`, "Miscellaneous fully charted!"]);
    assert.deepEqual(common.progress(player).owed, [misc.row]);
  } finally {
    leave(player);
  }
});

test("a sea's and an ocean's last task queue their own popups after the task's (rsprox 948)", () => {
  const player = captain();
  try {
    const ocean = [...common.allSeas().values()].find((sea) => sea.name === "Sunset Ocean");
    const list = common.oceanSpots(ocean);
    for (const spot of list.slice(0, -1)) common.complete(player, spot);
    const last = list.at(-1);
    const before = popups(player).length;
    common.complete(player, last);
    assert.deepEqual(popups(player).slice(before), [last.hint, `${last.sea.name} fully charted!`, "Sunset Ocean fully charted!"]);
  } finally {
    leave(player);
  }
});

test("the last of every task charts the entire sea: its lines, variables and popup (rsprox 948)", () => {
  const player = captain();
  try {
    const all = [...common.allSpots().values()];
    for (const spot of all.slice(0, -1)) common.complete(player, spot);
    const from = player.sent.length;
    const fromMessages = player.messages().length;
    common.complete(player, all.at(-1));
    const messages = player.messages().slice(fromMessages);
    const at = messages.indexOf("<col=0090bc>You have fully charted the entire sea!");
    assert.ok(at > 0, messages.join("\n"));
    assert.equal(messages[at + 1], "For fully charting the entire sea, Chartin' Charles McAtless on the Pandemonium will provide you with some final training when you next speak to him.");
    const full = ["sailing_charting_full_completion", "sailing_charting_full_completion_xp_owed",
      "sailing_charting_full_completion_ever_complete"].map(varbit);
    const order = player.sent.slice(from).filter(([key, id]) => key === "sendVarbit" && full.includes(id)).map(([, id]) => id);
    assert.deepEqual(order, full, "live's order: complete, then the lines, then owed and ever-complete");
    assert.equal(popups(player).at(-1), "Entire sea fully charted!");
    assert.equal(common.progress(player).fullOwed, true);
  } finally {
    leave(player);
  }
});

test("the charts are saved and sent again at login", () => {
  const player = captain();
  try {
    const spots = ["generic_rock_bay_of_sarim", "generic_crab_statue", "spyglass_wizards_tower"].map(common.spotByKey);
    for (const spot of spots) common.complete(player, spot);
    const saved = common.progress(player);
    const next = captain();
    next.attributes.set(common.PROGRESS_ATTRIBUTE, JSON.parse(JSON.stringify(saved)));
    common.sendProgress(next);
    for (const spot of spots) assert.equal(spotBit(next, spot), 1, spot.key);
    assert.equal(next.varps.get(5037), 3);
    assert.equal(spotBit(next, common.spotByKey("generic_rowboat_bay_of_sarim")), 0);
  } finally {
    leave(player);
  }
});

test("the Port Sarim salvaging station charts its task as it's used (rsprox 3467)", () => {
  const player = captain();
  const spot = common.spotByKey("generic_salvage_station_port_sarim");
  const event = {
    player, objectId: 60462, clickType: 1, option: "Sort-salvage",
    definition: { getName: () => "Salvaging station" }, location: { x: 3029, y: 3207, z: 0 }, handled: false,
  };
  for (const handler of beforeObjectHandlers) handler(event);
  assert.equal(event.handled, false, "the station still sorts");
  assert.deepEqual(player.messages().slice(0, 2), [
    "This station is perfect for sorting any salvage you can pull up from shipwrecks. You make a note of it.",
    `Charting complete: ${blue("Interact with the salvaging station in Port Sarim.")}`,
  ]);
  assert.equal(spotBit(player, spot), 1);
  // Another port's station charts nothing.
  const other = captain();
  for (const handler of beforeObjectHandlers) handler({ ...event, player: other, location: { x: 1800, y: 3700, z: 0 } });
  assert.deepEqual(other.messages(), []);
});

test("the crab statue hands over a Medallion fragment (rsprox 944)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  boat.helmPlayerId = undefined;
  player.varbits.set(19105, 0);
  try {
    chart(player, "generic_crab_statue");
    assert.equal(player.getInventory().getAmount(32395), 1);
    assert.match(player.chain ? JSON.stringify([...player.chain.getDialogues().values()].map((d) => d.text ?? d.lines ?? d)) : "", /mysterious piece of a medallion/);
  } finally {
    leave(player);
  }
});

const spyglass = require("../plugins/skills/sailing/charting/Spyglass.Charting");
// The combat tab's weapon setup needs a whole player; here it only mounts the tab.
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const realAssign = WeaponInterfaceManager.assign;
WeaponInterfaceManager.assign = (player) => player.getPacketSender().sendTabInterface(0, 593);
after(() => { WeaponInterfaceManager.assign = realAssign; });

test("the spyglass far from any view: nothing to look at (rsprox 907 and others)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  BoatManager.teleport(boat, { fineX: 3000 * 128, fineY: 3300 * 128 });
  try {
    spyglass.lookThrough({ player });
    assert.equal(player.messages().at(-1), "There isn't anything nearby worth looking at.");
    assert.equal(player.varbits.get(19105), 3, "the helm is kept");
  } finally {
    leave(player);
  }
});

test("the spyglass by the Wizards' Tower plays its captured view, then charts it (rsprox 3455)", () => {
  const player = captain();
  const boat = atTheHelm(player);
  const spot = common.spotByKey("spyglass_wizards_tower");
  BoatManager.teleport(boat, { fineX: 3104 * 128 + 64, fineY: 3183 * 128 + 64 });
  try {
    const sentFrom = player.sent.length;
    spyglass.lookThrough({ player });
    assert.equal(player.varbits.get(19105), 0, "the helm is let go of on the click");
    tick();
    assert.deepEqual(player.animations.slice(-1), [13301]);
    tick();
    assert.ok(player.sent.slice(sentFrom).some(([key, , group]) => key === "sendSubInterface" && group === 174), "fade out");
    tick(2);
    assert.equal(player.varbits.get(varbit("cutscene_status")), 1);
    assert.equal(player.varbits.get(varbit("fov_clamp")), 3);
    const moves = player.sent.slice(sentFrom).filter(([key]) => key === "sendCameraMoveTo" || key === "sendCameraLookAt");
    assert.deepEqual(moves, [
      ["sendCameraMoveTo", 3105, 3178, 2000, { rate: 232, rate2: 100 }],
      ["sendCameraLookAt", 3102, 3161, 100, { rate: 232, rate2: 100 }],
    ]);
    tick(2);
    assert.ok(player.sent.some(([key, , group]) => key === "sendSubInterface" && group === 936), "the spyglass overlay");
    // The fade out at shot tick 20, the camera back 3 ticks later, the charting 2 after that.
    tick(21);
    assert.equal(spotBit(player, spot), 0);
    assert.ok(player.sent.some(([key]) => key === "sendCameraReset"));
    assert.equal(player.varbits.get(varbit("cutscene_status")), 0);
    tick(2);
    assert.equal(spotBit(player, spot), 1);
    assert.equal(player.messages().at(-3), `Charting complete: ${blue("Use your spyglass to get a good view of the Wizards' Tower from the north.")}`);
    assert.deepEqual(player.xp, [50]);
    assert.equal(player.sent.filter(([key]) => key === "sendCameraMoveTo" || key === "sendCameraLookAt").length, 8);

    // Charted views aren't looked at again.
    spyglass.lookThrough({ player });
    assert.equal(player.messages().at(-1), "There isn't anything nearby worth looking at.");
  } finally {
    leave(player);
  }
});

test("a spyglass view locks the tabs, XP drops and world options, then gives them back (rsprox 948, 939)", () => {
  const player = captain();
  player.setAttribute("xp-drops:enabled", true);
  const hudResets = [];
  PluginManager.createApi("SpyglassHudTest").onCustomEvent("boss-hud:reset", (event) => hudResets.push(event.player));
  const boat = atTheHelm(player);
  BoatManager.teleport(boat, { fineX: 3104 * 128 + 64, fineY: 3183 * 128 + 64 });
  tick(); // the boarded sidepanel is mounted a tick after boarding
  const TOPLEVEL = 161;
  assert.equal(player.varbits.get(19151), 1, "sailing_sidepanel_visible: the sidepanel is on the combat tab");
  try {
    const from = player.sent.length;
    spyglass.lookThrough({ player });
    tick(2);
    assert.deepEqual(hudResets, [player], "the fade out clears the NPC health overlay");
    assert.ok(!player.sent.slice(from).some(([key]) => key === "sendHideNpcOps"), "the world stays clickable until the cutscene tick");
    tick(2);
    const closed = player.sent.slice(from).filter(([key]) => key === "closeSubInterface").map(([, uid]) => uid & 0xffff);
    // xp_drops, then combat, magic, stats, journal, inventory, worn items, prayer, settings, emotes.
    assert.deepEqual(closed.sort((a, b) => a - b), [9, 76, 77, 78, 79, 80, 81, 82, 87, 88]);
    assert.ok(player.sent.slice(from).every(([key, uid]) => key !== "closeSubInterface" || uid >>> 16 === TOPLEVEL));
    assert.deepEqual(player.sent.slice(from).filter(([key]) => key === "sendHideNpcOps" || key === "sendHideObjOps"),
      [["sendHideNpcOps", true], ["sendHideObjOps", true]]);

    const restoreFrom = player.sent.length;
    tick(23);
    const restored = player.sent.slice(restoreFrom);
    assert.ok(restored.some(([key]) => key === "sendCameraReset"));
    assert.deepEqual(restored.filter(([key]) => key === "sendHideNpcOps" || key === "sendHideObjOps"),
      [["sendHideNpcOps", false], ["sendHideObjOps", false]]);
    assert.ok(restored.some(([key, uid, group]) => key === "sendSubInterface" && uid === ((TOPLEVEL << 16) | 9) && group === 122), "XP drops back");
    const tabs = restored.filter(([key]) => key === "sendTabInterface").map(([, slot, group]) => [slot, group]);
    for (const group of [320, 629, 149, 387, 541, 218, 116, 216]) assert.ok(tabs.some(([, each]) => each === group), `tab ${group} back`);
    const combatTab = restored.filter(([key, uid]) => key === "sendSubInterface" && uid === ((TOPLEVEL << 16) | 76)).map(([, , group]) => group);
    assert.equal(combatTab.at(-1), 937, "the sailing sidepanel back on the combat tab");
    assert.deepEqual(hudResets, [player, player], "the fade back in clears it again");
  } finally {
    leave(player);
  }
});

test("a random event that took the player during a view keeps its tabs closed at the view's end", () => {
  const events = require("../plugins/npcs/random-events/Teleports.RandomEvents");
  const realSessionOf = events.sessionOf;
  const player = captain();
  const boat = atTheHelm(player);
  BoatManager.teleport(boat, { fineX: 3104 * 128 + 64, fineY: 3183 * 128 + 64 });
  tick();
  try {
    spyglass.lookThrough({ player });
    tick(4);
    events.sessionOf = (each) => (each === player ? { kind: "drill" } : realSessionOf(each));
    const from = player.sent.length;
    tick(23);
    const restored = player.sent.slice(from);
    assert.ok(restored.some(([key]) => key === "sendCameraReset"), "the view still ends");
    assert.ok(!restored.some(([key]) => key === "sendTabInterface"), "no tab is re-mounted");
    assert.deepEqual(restored.filter(([key]) => key === "sendHideNpcOps"), [["sendHideNpcOps", false]]);
  } finally {
    events.sessionOf = realSessionOf;
    leave(player);
  }
});

test("all 57 views have their captured shots and spot; ducks and views their hint markers", () => {
  const views = common.spotsOfType("spyglass");
  assert.equal(views.filter((spot) => spot.view?.shots?.length >= 2 && spot.view.fadeOut > 0).length, 57);
  assert.equal(views.filter((spot) => spot.marker).length, 56, "every view but Chartin' Charles's, seen on foot in the cave");
  assert.equal(common.spotsOfType("current_duck").filter((spot) => spot.marker).length, 54);
});

const currentDuck = require("../plugins/skills/sailing/charting/CurrentDuck.Charting");
const ITEM_DUCK = 31805;

/** A captain with the duck, Current Affairs done or not, on a boat at a tile. */
function duckCaptain({ questDone = true, at = [2835, 3414] } = {}) {
  const player = captain();
  const boat = atTheHelm(player);
  BoatManager.teleport(boat, { fineX: at[0] * 128 + 64, fineY: at[1] * 128 + 64 });
  player.getInventory().add(new (require("../dist/game/model/Item").Item)(ITEM_DUCK, 1), true);
  player.questDone = questDone;
  return player;
}

before(() => {
  PluginManager.createApi("SeaChartingQuests").onCustomEvent("quest:is-complete", (request) => {
    if (request.key === "current_affairs" && request.player?.questDone !== undefined) request.complete = request.player.questDone;
    if (request.player?.questsDone) request.complete = request.player.questsDone.has(request.key);
  });
});

function releaseAndFollow(player) {
  currentDuck.trackCurrent({ player });
  tick(2);
  const duck = currentDuck.ducks.get(player);
  assert.ok(duck, "the duck is out");
  return duck;
}

test("a duck released away from any current: nothing to track (rsprox, 55 times)", () => {
  const player = duckCaptain({ at: [3000, 3300] });
  try {
    currentDuck.trackCurrent({ player });
    assert.equal(player.messages().at(-1), "You don't spot any currents worth tracking.");
    assert.equal(player.getInventory().getAmount(ITEM_DUCK), 1);
  } finally {
    leave(player);
  }
});

test("other currents wait for Current Affairs; its own Catherby current doesn't", () => {
  const player = duckCaptain({ questDone: false, at: [3082, 3203] });
  try {
    currentDuck.trackCurrent({ player });
    assert.equal(player.messages().at(-1), "You don't spot any currents worth tracking.");
  } finally {
    leave(player);
  }
  const quester = duckCaptain({ questDone: false });
  try {
    releaseAndFollow(quester);
  } finally {
    currentDuck.ducks.delete(quester);
    leave(quester);
  }
});

test("the Catherby duck follows its captured route, stops and is collected from the deck (rsprox 3467)", () => {
  const player = duckCaptain();
  try {
    const spot = common.spotByKey("current_duck_catherby_bay");
    currentDuck.trackCurrent({ player });
    assert.equal(player.varbits.get(19105), 0, "the helm is let go of");
    tick();
    assert.deepEqual(player.animations.slice(-1), [13305]);
    tick();
    const duck = currentDuck.ducks.get(player);
    assert.equal(player.messages().at(-1), "<col=3366ff>You release your current duck and he begins tracking the currents...</col>");
    assert.equal(player.getInventory().getAmount(ITEM_DUCK), 0);
    assert.equal(duck.npc.getId(), 15152);
    assert.deepEqual([duck.npc.getLocation().getX(), duck.npc.getLocation().getY()], [2837, 3414]);
    assert.equal(player.varbits.get(14192), 5, "current_hint_arrow");

    const moving = { player, npc: duck.npc, npcId: 15152, clickType: 1, range: 1 };
    currentDuck.collect(moving);
    assert.equal(duck.stopped, false);

    tick(duck.steps.length + 3);
    assert.equal(duck.stopped, true);
    assert.deepEqual([duck.npc.getLocation().getX(), duck.npc.getLocation().getY()], [2802, 3322]);
    assert.equal(player.messages().at(-1), "<col=3366ff>Your current duck comes to a stop.</col>");

    const route = { player, npc: duck.npc, npcId: 15153, clickType: 1, range: 1 };
    for (const handler of PluginManager.npcRouteHooks ?? []) handler.handler(route);
    currentDuck.collect({ player, npc: duck.npc });
    tick(2);
    assert.deepEqual(player.animations.slice(-1), [13304]);
    assert.equal(spotBit(player, spot), 1);
    assert.equal(player.getInventory().getAmount(ITEM_DUCK), 1);
    assert.equal(currentDuck.ducks.has(player), false);
    assert.equal(duck.npc.isRegistered(), false);
    assert.deepEqual(player.xp, [common.xpFor(spot)]);
    assert.equal(player.messages().at(-3), `Charting complete: ${blue("Test the currents south west of the Obelisk of Water.")}`);

    // Every later run pays again (give_repeat_xp).
    BoatManager.teleport(Sailing.instanceAboard(player), { fineX: 2835 * 128 + 64, fineY: 3414 * 128 + 64 });
    const again = releaseAndFollow(player);
    tick(again.steps.length + 3);
    currentDuck.collect({ player, npc: again.npc });
    tick(2);
    assert.deepEqual(player.xp, [125, 125]);
  } finally {
    leave(player);
  }
});

test("every current's route runs from its release to its end a tile at a time", () => {
  for (const spot of common.spotsOfType("current_duck")) {
    assert.ok(spot.route?.length >= 2, spot.key);
    const steps = currentDuck.routeSteps(spot.route);
    assert.deepEqual(steps.at(-1), spot.location2 ? spot.route.at(-1) : steps.at(-1), spot.key);
    assert.ok(Math.max(Math.abs(spot.route[0][0] - spot.location[0]), Math.abs(spot.route[0][1] - spot.location[1])) <= 8, spot.key);
  }
});

/** Where a duck sets off on each leg after its first: the tile before each leg's first step. */
function legCorners(key) {
  const spot = common.spotByKey(key);
  const steps = currentDuck.routeSteps(spot.route);
  return [...currentDuck.legStarts(spot.route, steps)].sort((a, b) => a - b).map((i) => steps[i - 1]);
}

test("a duck quacks again where each leg of its current starts (rsprox 948)", () => {
  // Every "Quack!" the swimming duck gave in the captures, after the one on release.
  assert.deepEqual(legCorners("current_duck_crystal_sea"),
    [[1936, 3295], [1958, 3302], [1971, 3298], [1989, 3304], [2003, 3299], [2020, 3307], [2041, 3304]]);
  assert.deepEqual(legCorners("current_duck_gulf_of_kourend"), [[1809, 3656], [1814, 3645], [1816, 3632],
    [1820, 3619], [1822, 3609], [1823, 3595], [1821, 3609], [1825, 3622], [1824, 3637], [1828, 3648], [1834, 3653],
    [1838, 3664], [1846, 3669], [1856, 3680], [1853, 3694], [1850, 3706], [1839, 3702]]);
});

/** The quacks' area sounds since `from`: [x, y, delay]. */
function quacks(player, from = 0) {
  return player.sent.slice(from).filter(([key, id]) => key === "sendAreaSound" && id === 413).map(([, , x, y, , , delay]) => [x, y, delay]);
}

test("the swimming duck quacks on each leg; stopped, it quacks twice every 10 ticks (rsprox 940, 948)", () => {
  const player = duckCaptain();
  try {
    const duck = releaseAndFollow(player);
    const corners = [...duck.legs].sort((a, b) => a - b).map((i) => duck.steps[i - 1]);
    const from = player.sent.length;
    for (let i = 0; i < duck.steps.length + 3 && !duck.stopped; i++) tick();
    assert.equal(duck.stopped, true);
    const [endX, endY] = duck.steps.at(-1);
    const swimming = quacks(player, from);
    // The release's quack, then one per leg.
    const [startX, startY] = duck.spot.route[0];
    assert.deepEqual(swimming.slice(0, corners.length + 1), [[startX, startY, 0], ...corners.map(([x, y]) => [x, y, 0])]);
    // The stop: two quacks, the second 12 client cycles later.
    assert.deepEqual(swimming.slice(corners.length + 1), [[endX, endY, 0], [endX, endY, 12]]);
    const stopped = player.sent.length;
    tick(9);
    assert.deepEqual(quacks(player, stopped), []);
    tick(1);
    assert.deepEqual(quacks(player, stopped), [[endX, endY, 0], [endX, endY, 12]]);
    tick(10);
    assert.equal(quacks(player, stopped).length, 4);
  } finally {
    currentDuck.ducks.delete(player);
    leave(player);
  }
});

/** An inventory click on a tool, as the item action listener hands it to the plugins. */
function itemOption(player, itemId, option, clickType) {
  const slot = player.getInventory().getSlotForItemId(itemId);
  const event = { player, interfaceId: 149, item: player.getInventory().get(slot), itemId, slot, clickType, option, handled: false };
  PluginManager.emitItemAction(event);
  return event;
}

test("Inspect on the duck and the spyglass opens the tool's object box (rsprox 948, 3455)", () => {
  const { Item } = require("../dist/game/model/Item");
  const spyglass = require("../plugins/skills/sailing/charting/Spyglass.Charting");
  for (const [itemId, text] of [[ITEM_DUCK, currentDuck.INSPECT], [31803, spyglass.INSPECT]]) {
    const player = captain();
    player.getInventory().add(new Item(itemId, 1), true);
    const event = itemOption(player, itemId, "Inspect", 2);
    assert.equal(event.handled, true, String(itemId));
    const [box] = dialogueTexts(player);
    assert.ok(box?.includes(text), box);
    assert.ok(box?.includes(String(itemId)), box);
    assert.equal(player.getInventory().getAmount(itemId), 1);
  }
});

test("Dismiss sends the duck back to the tools compartment (Wiki: Transcript:Current duck)", () => {
  const player = duckCaptain();
  try {
    const event = itemOption(player, ITEM_DUCK, "Dismiss", 5);
    assert.equal(event.handled, true);
    assert.equal(player.getInventory().getAmount(ITEM_DUCK), 0);
    assert.ok(player.getSailing().tools.includes(2));
    assert.equal(player.messages().at(-1), "You dismiss the duck and he flies away.");
  } finally {
    leave(player);
  }
});

test("a completed sea's popup takes over the task's banner 13 ticks later, with jingle 830 (rsprox 948)", () => {
  const player = captain();
  try {
    const ocean = [...common.allSeas().values()].find((sea) => sea.name === "Ardent Ocean");
    const list = common.oceanSpots(ocean);
    // The earlier tasks with the popups off (All Settings), so none is still queued.
    player.getPacketSender().sendVarbit(18142, 1);
    for (const spot of list.slice(0, -1)) common.complete(player, spot);
    player.getPacketSender().sendVarbit(18142, 0);
    const last = list.at(-1);
    const from = player.sent.length;
    common.complete(player, last);
    const banner = [];
    for (let t = 0; t <= 45; t++) {
      for (const entry of player.sent.splice(from)) {
        const [key, a, b] = entry;
        if (key === "sendInterfaceScript" && a === 3343) banner.push([t, b[1]]);
        if (key === "sendJingle") banner.push([t, "jingle", a]);
        if (key === "sendSubInterface" && b === 660) banner.push([t, "open"]);
        if (key === "closeSubInterface" && a === ((161 << 16) | 13)) banner.push([t, "close"]);
      }
      tick();
    }
    assert.deepEqual(banner, [
      [0, "open"], [0, last.hint],
      [13, `${last.sea.name} fully charted!`], [13, "jingle", 830],
      [26, "Ardent Ocean fully charted!"], [26, "jingle", 830],
      [39, "close"],
    ]);
  } finally {
    leave(player);
  }
});

const weather = require("../plugins/skills/sailing/charting/Weather.Charting");
const ITEM_STATION = 31809;
const ITEM_STATION_FULL = 31810;

function dialogueTexts(player) {
  return player.chain ? [...player.chain.getDialogues().values()].map((step) => JSON.stringify(step)) : [];
}

test("the winds circle each weather spot as the captured readings do", () => {
  const rimmington = common.spotByKey("weather_troll_rimmington_strait");
  const [x, y] = rimmington.location2;
  // rsprox 3465: 7 tiles north east of the spot, the station read "south".
  assert.equal(weather.windAt(rimmington, x + 7, y + 7), "south");
  const khazard = common.spotByKey("weather_troll_strait_of_khazard");
  // rsprox 2836: 8 west and 10 north of it, "south west".
  assert.equal(weather.windAt(khazard, khazard.location2[0] - 8, khazard.location2[1] + 10), "south west");
  for (const spot of common.spotsOfType("weather_troll")) {
    assert.ok(spot.location && spot.location2, spot.key);
    assert.equal(weather.taskAt(spot.location[0], spot.location[1]), spot, spot.key);
  }
});

test("a weather troll's station, a reading at the spot and the hand-in chart the task (rsprox 944)", () => {
  const player = captain();
  atTheHelm(player);
  const spot = common.spotByKey("weather_troll_rimmington_strait");
  const troll = { getLocation: () => new Location(spot.location[0], spot.location[1], 0) };
  try {
    player.levels.set(SAILING, 50);
    weather.collectData({ player, npc: troll });
    assert.match(dialogueTexts(player).join(), /You no good sail her/);
    assert.equal(player.getInventory().getAmount(ITEM_STATION), 0);

    player.levels.set(SAILING, 99);
    weather.collectData({ player, npc: troll });
    assert.equal(player.getInventory().getAmount(ITEM_STATION), 1);
    assert.match(dialogueTexts(player)[0], /The troll hands you a portable weather station/);
    weather.collectData({ player, npc: troll });
    assert.match(dialogueTexts(player).join(), /You already have number getter/);

    const boat = Sailing.instanceAboard(player);
    BoatManager.teleport(boat, { fineX: (spot.location2[0] + 7) * 128 + 64, fineY: (spot.location2[1] + 7) * 128 + 64 });
    weather.takeReading({ player });
    assert.equal(player.messages().at(-1), "The weather station reads that the wind is blowing toward the <col=3366ff>south</col>.");

    BoatManager.teleport(boat, { fineX: spot.location2[0] * 128 + 64, fineY: spot.location2[1] * 128 + 64 });
    weather.takeReading({ player });
    assert.equal(player.getInventory().getAmount(ITEM_STATION_FULL), 1);
    assert.equal(player.getInventory().getAmount(ITEM_STATION), 0);
    tick();
    assert.deepEqual(player.animations.slice(-1), [13303]);
    assert.match(dialogueTexts(player)[0], /You find a spot where the winds have dropped/);

    // Another troll's station isn't hers.
    const other = common.spotByKey("weather_troll_strait_of_khazard");
    weather.collectData({ player, npc: { getLocation: () => new Location(other.location[0], other.location[1], 0) } });
    assert.match(dialogueTexts(player).join(), /You already have number getter|Number getter not for here/);

    weather.collectData({ player, npc: troll });
    assert.equal(player.getInventory().getAmount(ITEM_STATION_FULL), 0);
    assert.equal(spotBit(player, spot), 1);
    assert.deepEqual(player.xp, [250]);
    assert.match(dialogueTexts(player).join(), /You hand over the troll's weather station.*Numbers so tasty/);
  } finally {
    leave(player);
  }
});

test("every weather task has its troll spawned", () => {
  const spawns = require("../data/definitions/npc-spawns.json").filter((entry) => entry.id === 15154);
  for (const spot of common.spotsOfType("weather_troll")) {
    assert.ok(spawns.some((entry) => Math.max(Math.abs(entry.x - spot.location[0]), Math.abs(entry.y - spot.location[1])) <= 4), spot.key);
  }
});

const drinkCrate = require("../plugins/skills/sailing/charting/DrinkCrate.Charting");
const ITEM_CROWBAR = 31807;

function crateClick(player, key) {
  const [x, y] = common.spotByKey(key).location;
  const event = { player, objectId: 59283, clickType: 1, option: "Pry-open", location: { x, y, z: 0 }, handled: false };
  drinkCrate.pryOpen(event);
  return event;
}

test("every drink task has its crate tile and drink, and most their captured lines", () => {
  const byItem = drinkCrate.drinks();
  assert.equal(byItem.size, 65);
  const tasks = common.spotsOfType("drink_crate");
  assert.equal(tasks.filter((spot) => spot.location).length, 65);
  assert.ok(tasks.filter((spot) => spot.drink?.lines?.length).length >= 60);
});

test("a drink crate: no crowbar, the drink, already holding one (rsprox 907, 948)", () => {
  const player = captain();
  player.questsDone = new Set(["prying_times"]);
  atTheHelm(player);
  try {
    const event = crateClick(player, "drink_crate_mango_gin");
    assert.equal(event.handled, true);
    assert.match(JSON.stringify([...player.chain?.getDialogues?.().values?.() ?? []]) + JSON.stringify(player.sent.slice(-6)), /You require a crowbar to do that/);

    player.getInventory().add(new (require("../dist/game/model/Item").Item)(ITEM_CROWBAR, 1), true);
    crateClick(player, "drink_crate_mango_gin");
    const spot = common.spotByKey("drink_crate_mango_gin");
    assert.equal(player.getInventory().getAmount(spot.item), 1);
    assert.match(dialogueTexts(player)[0], /You pry open the crate and take a bottle of captain clop's mango gin to sample/);
    assert.ok(player.sent.some(([key, id]) => key === "sendSoundEffect" && id === 67));

    crateClick(player, "drink_crate_mango_gin");
    assert.equal(player.getInventory().getAmount(spot.item), 1);
    assert.match(dialogueTexts(player)[0], /The crate contains a bottle of captain clop's mango gin, but you don't take it as you already have one/);
  } finally {
    leave(player);
  }
});

test("with a full inventory the weather troll keeps her station and the crate its drink", () => {
  const { Item } = require("../dist/game/model/Item");
  const player = captain();
  player.questsDone = new Set(["prying_times"]);
  atTheHelm(player);
  const spot = common.spotByKey("weather_troll_rimmington_strait");
  const troll = { getLocation: () => new Location(spot.location[0], spot.location[1], 0) };
  const crate = common.spotByKey("drink_crate_mango_gin");
  try {
    player.getInventory().add(new Item(ITEM_CROWBAR, 1), true);
    while (player.getInventory().getFreeSlots() > 0) player.getInventory().add(new Item(1351, 1), true);
    player.chain = null;

    weather.collectData({ player, npc: troll });
    assert.equal(player.getInventory().getAmount(ITEM_STATION), 0);
    assert.equal(player.getAttribute("charting:weather-station"), undefined);
    assert.equal(player.messages().at(-1), "You don't have enough inventory space.");
    assert.equal(dialogueTexts(player).length, 0);

    crateClick(player, "drink_crate_mango_gin");
    assert.equal(player.getInventory().getAmount(crate.item), 0);
    assert.equal(player.messages().at(-1), "You don't have enough inventory space.");
    assert.equal(dialogueTexts(player).length, 0);
    assert.ok(!player.sent.some(([key, id]) => key === "sendSoundEffect" && id === 67));

    // The last slot free: both hand over as usual.
    player.getInventory().delete(1351, 1);
    weather.collectData({ player, npc: troll });
    assert.equal(player.getInventory().getAmount(ITEM_STATION), 1);
    player.getInventory().delete(1351, 1);
    crateClick(player, "drink_crate_mango_gin");
    assert.equal(player.getInventory().getAmount(crate.item), 1);
  } finally {
    leave(player);
  }
});

test("drinking a crate's drink charts it, with its own lines (rsprox 907)", () => {
  const player = captain();
  player.questsDone = new Set(["prying_times"]);
  const spot = common.spotByKey("drink_crate_mango_gin");
  drinkCrate.drinks();
  player.getInventory().add(new (require("../dist/game/model/Item").Item)(spot.item, 1), true);
  const event = { player, item: player.getInventory().get(0), itemId: spot.item, slot: 0, clickType: 2, option: "Drink", handled: false };
  drinkCrate.drink(event);
  assert.equal(event.handled, true);
  assert.match(dialogueTexts(player)[0], /This drink has been sealed in a crate/);
  assert.equal(spotBit(player, spot), 0);

  player.attributes.set(drinkCrate.NO_WARNING_ATTRIBUTE, true);
  drinkCrate.drink({ player, item: player.getInventory().get(0), itemId: spot.item, slot: 0, clickType: 2, option: "Drink", handled: false });
  assert.equal(player.getInventory().getAmount(spot.item), 0);
  assert.deepEqual(player.messages().slice(0, 3), [
    "You drink the bottle of captain clop's mango gin.",
    "You can't feel your legs.",
    `Charting complete: ${blue(spot.hint)}`,
  ]);
  assert.deepEqual(player.animations.slice(-1), [11288]);
  assert.deepEqual(player.xp, [75]);
});

test("Prying Times keeps its stout until the quest is done", () => {
  const player = captain();
  player.questsDone = new Set();
  const spot = common.spotByKey("drink_crate_prying_times");
  drinkCrate.drinks();
  const event = { player, itemId: spot.item, option: "Drink", handled: false };
  drinkCrate.drink(event);
  assert.equal(event.handled, false);
});

const mermaid = require("../plugins/skills/sailing/charting/Mermaid.Charting");
const tutor = require("../plugins/skills/sailing/charting/Tutor.Charting");

function mermaidAt(spot) {
  return { getId: () => 15154 + spot.mermaid.guide, getLocation: () => new Location(spot.mermaid.at[0], spot.mermaid.at[1], 0), performAnimation() {} };
}

test("every dive has its mermaid, riddle and answers, and its mermaid spawned", () => {
  const spawns = require("../data/definitions/npc-spawns.json");
  for (const spot of common.spotsOfType("mermaid_guide")) {
    assert.ok(spot.mermaid?.riddle?.length && spot.mermaid.answers?.length, spot.key);
    assert.equal(mermaid.taskOf(mermaidAt(spot)), spot, spot.key);
    assert.ok(spawns.some((entry) => entry.id === 15154 + spot.mermaid.guide && entry.x === spot.mermaid.at[0] && entry.y === spot.mermaid.at[1]), spot.key);
  }
});

test("a mermaid's dive: the gear, the riddle, a wrong then right answer, the charting (rsprox 939)", () => {
  const player = captain();
  const spot = common.spotByKey("mermaid_guide_mudskipper_sound");
  const npc = mermaidAt(spot);
  let worn = [];
  player.getEquipment = () => ({ contains: (id) => worn.includes(id) });
  let syntax;
  player.setEnteredSyntaxAction = (action) => { syntax = action; };
  try {
    mermaid.dive({ player, npc });
    assert.match(dialogueTexts(player).join(), /You need to be wearing diving equipment to dive with me!/);

    worn = [7534, 7535];
    mermaid.dive({ player, npc });
    assert.match(dialogueTexts(player).join(), /I want something in return.*apple pie.*three answers/);
    const askedTitles = () => player.sent.filter(([key, id]) => key === "sendInterfaceScript" && id === 750).map(([, , args]) => args[0]);
    // The chain's last step asks; run it as continuing would.
    [...player.chain.getDialogues().values()].at(-1).execute?.() ?? [...player.chain.getDialogues().values()].at(-1).action?.execute?.();
    assert.equal(askedTitles().at(-1), "Submit your first answer to the mermaid's puzzle:");
    syntax.execute("2313");
    assert.equal(askedTitles().at(-1), "Submit your second answer to the mermaid's puzzle:");
    syntax.execute("1933");
    syntax.execute("1");
    assert.match(dialogueTexts(player).join(), /I don't think that's right... You should try again./);

    for (const answer of [1955, 1933, 2313]) {
      if (syntax && answer === 1955) [...player.chain.getDialogues().values()].at(-1).execute?.() ?? [...player.chain.getDialogues().values()].at(-1).action?.execute?.();
      syntax.execute(String(answer));
    }
    // The box opens with no continue while she dives (rsprox 944): an empty continue line, no events.
    assert.ok(dived(player));
    assert.deepEqual(player.sent.filter(([key]) => key === "sendString").slice(-1)[0].slice(1, 2), [""]);
    assert.equal(player.sent.filter(([key]) => key === "sendInterfaceFlagsRange").at(-1).at(-1), 0);
    assert.doesNotMatch(dialogueTexts(player).join(), /satisfied with your answer|There you go/);
    tick(1);
    assert.equal(player.varbits.get(6719), 2); // minimap_state: off a tick after the fade out
    tick(7);
    assert.equal(player.varbits.get(6719), 0);
    assert.equal(spotBit(player, spot), 0);
    tick(2);
    assert.equal(spotBit(player, spot), 1);
    assert.deepEqual(player.xp, [175]);
    assert.ok(player.sent.some(([key, uid]) => key === "closeSubInterface" && uid === ((161 << 16) | 1)));
    // Then the same box to continue, and only after it her closing line.
    const steps = [...player.chain.getDialogues().values()].map((step) => JSON.stringify(step));
    assert.match(steps[0], /The mermaid, satisfied with your answer/);
    assert.match(steps[1], /There you go. Hope the dive got you everything you needed!/);
  } finally {
    leave(player);
  }
});

/** The dive text sent as the message box, since the last check. */
function dived(player, from = 0) {
  return player.sent.slice(from).some(([key, text]) => key === "sendString" && /^The mermaid, satisfied with your answer/.test(text));
}

/** Diving gear on, the riddle asked: answers go in as the item search and count prompts would. */
const riddledPlayers = [];
function riddled(uid) {
  const player = captain();
  riddledPlayers.push(player);
  const spot = common.spotsOfType("mermaid_guide").find((each) => each.uid === uid);
  const npc = mermaidAt(spot);
  player.getEquipment = () => ({ contains: (id) => id === 7534 || id === 7535 });
  const prompts = { syntax: null, amount: null };
  player.setEnteredSyntaxAction = (action) => { prompts.syntax = action; };
  player.setEnteredAmountAction = (action) => { prompts.amount = action; };
  const lastStep = () => [...player.chain.getDialogues().values()].at(-1);
  const riddle = () => { const step = lastStep(); (step.execute ?? step.action.execute).call(step.action ?? step); };
  mermaid.dive({ player, npc });
  riddle();
  const titles = () => player.sent.filter(([key, id]) => key === "sendInterfaceScript" && id === 750).map(([, , args]) => args[0]);
  const counts = () => player.sent.filter(([key]) => key === "sendEnterAmountPrompt").map(([, title]) => title);
  return { player, spot, prompts, riddle, titles, counts };
}

/** Riddled divers leave their boats even when a test fails part way. */
test.afterEach(() => { for (const player of riddledPlayers.splice(0)) leave(player); });

test("a mermaid takes any of an answer's alternatives, and Selina's coal riddle only coal (rsprox 944, the Wiki)", () => {
  // Selina, the Ooglog Channel: one answer; charcoal is wrong, coal right (rsprox 944).
  const coal = riddled(126);
  assert.deepEqual(coal.titles(), ["Submit your answer to the mermaid's puzzle:"]);
  coal.prompts.syntax.execute("973");
  assert.match(dialogueTexts(coal.player).join(), /I don't think that's right... You should try again./);
  coal.riddle();
  coal.prompts.syntax.execute("453");
  assert.ok(dived(coal.player));
  leave(coal.player);

  // The Wiki's alternatives: grimy tarromin, a light bow tie, a teak plank, a rune med helm.
  for (const [uid, ids] of [[350, [203]], [324, [19985]], [312, [8780]], [45, [1103, 1147]], [128, [213]]]) {
    const each = riddled(uid);
    for (const id of ids) each.prompts.syntax.execute(String(id));
    assert.ok(dived(each.player), String(uid));
    leave(each.player);
  }
});

test("a mermaid's quantity riddle asks how many of each item (rsprox 940, 948)", () => {
  // Gloria, Catherby: 5 cabbage seeds.
  const seeds = riddled(46);
  seeds.prompts.syntax.execute("5324");
  assert.deepEqual(seeds.counts(), ["Cabbage seed: How many should there be?"]);
  assert.ok(!dived(seeds.player));
  seeds.prompts.amount.execute(4);
  assert.match(dialogueTexts(seeds.player).join(), /I don't think that's right/);
  seeds.riddle();
  seeds.prompts.syntax.execute("5324");
  seeds.prompts.amount.execute(5);
  assert.ok(dived(seeds.player));
  leave(seeds.player);

  // Gloria's ring of returning: six items, three air runes, in the order given.
  const ring = riddled(321);
  for (const [id, count] of [[442, 1], [1755, 1], [1627, 1], [1592, 1], [564, 1], [556, 3]]) {
    ring.prompts.syntax.execute(String(id));
    ring.prompts.amount.execute(count);
  }
  assert.equal(ring.titles().at(-1), "Submit your sixth answer to the mermaid's puzzle:");
  assert.equal(ring.counts().at(-1), "Air rune: How many should there be?");
  assert.ok(dived(ring.player));
  leave(ring.player);
});

test("every mermaid answer is a real item, and counts only where the riddle asks for quantities", () => {
  const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
  for (const spot of common.spotsOfType("mermaid_guide")) {
    const { answers, counts, riddle } = spot.mermaid;
    for (const id of answers.flat()) assert.notEqual(ItemDefinition.forId(id)?.getName?.() ?? "null", "null", `${spot.key} ${id}`);
    assert.equal(Boolean(counts), /quantity/.test(riddle.at(-1)), spot.key);
    if (counts) assert.equal(counts.length, answers.length, spot.key);
  }
});

test("Chartin' Charles pays the owed ocean bonuses at once (rsprox 948)", () => {
  const player = captain();
  player.getInventory().add(new (require("../dist/game/model/Item").Item)(31985, 1), false); // the captain's log
  const ocean = [...common.allSeas().values()].find((sea) => sea.name === "Sunset Ocean");
  for (const spot of common.oceanSpots(ocean)) common.complete(player, spot);
  assert.equal(tutor.answerCondition({ player, npcId: 15151, stepId: "jBl-4T" }), true);
  player.levels.set(SAILING, 30);
  assert.equal(tutor.answerCondition({ player, npcId: 15151, stepId: "CDpkRB" }), true, "under the ocean's level");
  player.levels.set(SAILING, 99);
  player.xp.length = 0;
  tutor.pay(player);
  assert.deepEqual(player.xp, [2000]);
  assert.equal(player.messages().at(-1), "You are awarded <col=0090bc>2,000</col> Sailing XP for sharing charting information from the entire ocean!");
  const { baseVar, startBit } = CacheDefinitions.getVarbit(varbit("sailing_sea_sunset_ocean_charting_xp_owed"));
  assert.equal((player.varps.get(baseVar) >>> startBit) & 1, 0);
  assert.equal(tutor.answerCondition({ player, npcId: 15151, stepId: "dx41Cr" }), true, "nothing owed now");
  tutor.pay(player);
  assert.deepEqual(player.xp, [2000]);
});

test("Chartin' Charles pays no bonus without the captain's log in the inventory (Wiki)", () => {
  // Wiki (Chartin' Charles, Training): "You must have the captain's log in your inventory to receive the bonus XP."
  const player = captain();
  const ocean = [...common.allSeas().values()].find((sea) => sea.name === "Sunset Ocean");
  for (const spot of common.oceanSpots(ocean)) common.complete(player, spot);
  player.xp.length = 0;
  assert.equal(tutor.answerCondition({ player, npcId: 15151, stepId: "dx41Cr" }), true, "his nothing-owed answer");
  assert.equal(tutor.answerCondition({ player, npcId: 15151, stepId: "jBl-4T" }), false);
  tutor.pay(player);
  assert.deepEqual(player.xp, [], "no XP");
  player.getInventory().add(new (require("../dist/game/model/Item").Item)(31985, 1), false);
  tutor.pay(player);
  assert.deepEqual(player.xp, [2000], "the ocean is still owed, and paid once the log is carried");
});

test("a full inventory leaves the crab statue uncharted until its fragment fits (review #1472)", () => {
  const { Item } = require("../dist/game/model/Item");
  const player = captain();
  const boat = atTheHelm(player);
  boat.helmPlayerId = undefined;
  player.varbits.set(19105, 0);
  const spot = common.spotByKey("generic_crab_statue");
  try {
    for (let i = 0; i < 28; i++) player.getInventory().add(new Item(1511, 1), false);
    assert.equal(player.getInventory().getFreeSlots(), 0);
    chart(player, "generic_crab_statue");
    tick();
    assert.equal(spotBit(player, spot), 0, "not charted");
    assert.equal(player.getInventory().getAmount(32395), 0);
    assert.equal(player.messages().at(-1), "You don't have enough inventory space.");
    assert.deepEqual(player.xp, []);

    player.getInventory().delete(1511, 1);
    chart(player, "generic_crab_statue");
    tick();
    assert.equal(spotBit(player, spot), 1);
    assert.equal(player.getInventory().getAmount(32395), 1, "the fragment, once there's room");
  } finally {
    leave(player);
  }
});

test("All Settings' Charting popups off (settings_sailing_charting_popup): the charting is told in chat only", () => {
  for (const off of [0, 1]) {
    const player = captain();
    atTheHelm(player);
    try {
      player.getPacketSender().sendVarbit(varbit("settings_sailing_charting_popup"), off);
      chart(player, "generic_rock_bay_of_sarim");
      tick();
      assert.ok(player.messages().includes(`Charting complete: ${blue("Find a treacherous rock formation near Draynor Village.")}`));
      const popup = player.sent.some(([key, script]) => key === "sendInterfaceScript" && script === 3343);
      assert.equal(popup, off === 0, off ? "no popup" : "the popup, as by default");
    } finally {
      leave(player);
    }
  }
});

test("All Settings' Current duck hint arrow off: the released duck gets no arrow", () => {
  for (const off of [0, 1]) {
    const player = duckCaptain();
    try {
      player.getPacketSender().sendVarbit(varbit("sailing_current_duck_hintarrow_disabled"), off);
      currentDuck.trackCurrent({ player });
      tick(2);
      assert.ok(currentDuck.ducks.get(player), "the duck is out either way");
      assert.equal(player.sent.some(([key]) => key === "sendEntityHint"), off === 0);
      assert.equal(player.varbits.get(14192), off ? undefined : 5, "current_hint_arrow");
    } finally {
      leave(player);
    }
  }
});
