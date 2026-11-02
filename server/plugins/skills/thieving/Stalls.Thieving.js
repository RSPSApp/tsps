/**
 * Stalls (Wiki: Thieving#Stalls and each stall's page).
 *
 * rsprox captures (recordings 1554, 3220 and Leagues/Grid Master 1098, 1102, 1104, 1105, 3275):
 * every attempt and steal line is a spam message. The pickup animation and synth 2581 play on the
 * click; a tick later the item, the line and the empty stall. A stolen item is "You steal a cake.",
 * "an uncut emerald", "a silver bar", "a banana"; a few have their own line (bread, silver ore,
 * silk, tea). Items not seen in a capture follow the same rule ("some" for a plural name).
 */
let core;
const THEFT_ATTRIBUTE = "thieving:stall-thefts";
const theftTimers = new WeakMap();
const THIEVING_SOUND = 2581;
const GUARDS = new Set(["guard", "market guard", "black guard", "knight of ardougne", "paladin", "hero", "guard dog"]);
/** Lookouts that attack without the guards' line (Hosidius's guard dogs). */
const SILENT_GUARDS = new Set(["guard dog"]);
// shortcut: a five-tile lookout range, verify the exact radius against a live stall capture.
const LOOKOUT_RADIUS = 5;
const depleted = new WeakMap();
// Mainland stalls allow a theft every two ticks; Port Roberts' every five (below).
const STEAL_DELAY_MS = 1000;
const PORT_ROBERTS_STEAL_DELAY_MS = 3000;

const STALLS = new Map([
  [
    "Bakery stall",
    {
      respawnTicks: 4, owners: ["Baker", "Randivor"],
      theft: "cake", minutes: 15, safeUnderOwner: true,
      petBase: 124066,
      level: 5,
      xp: 16,
      rewards: [
        ["CAKE", 1, 13],
        ["BREAD", 1, 5, "You steal some bread."],
        ["CHOCOLATE_SLICE", 1, 2],
      ],
    },
  ],
  ["Silk stall", { theft: "silk", attemptMessage: "You attempt to steal some silk from the silk stall.", respawnTicks: 8, owners: ["Silk merchant", "Silk Merchant", "Anwen"], petBase: 68926, level: 20, xp: 24,
    rewards: [["SILK", 1, 1, "You steal a piece of silk."]] }],
  // The Wiki's cup of tea is cup_of_tea (1978), which notes; CUP_OF_TEA (712) is display_tea, which doesn't.
  ["Tea stall", { theft: "tea", attemptMessage: "You attempt to steal a cup of tea...", respawnTicks: 4, owners: ["Tea Seller"], petBase: 68926, level: 5, xp: 16, rewards: [["CUP_OF_TEA_2", 1, 1, "You steal a cup of tea."]] }],
  ["Fur stall", { theft: "fur", respawnTicks: 12, owners: ["Fur trader", "Fur Merchant"], petBase: 36490, level: 35, xp: 45, rewards: [["GREY_WOLF_FUR", 1, 1]] }],
  [
    "Gem stall",
    {
      theft: "gem", attemptMessage: "You attempt to steal a gem from the gem stall.", respawnTicks: 100, owners: ["Gem merchant", "Gem Merchant", "Hervi", "Glenda"],
      petBase: 36490,
      level: 75,
      xp: 408,
      rewards: [
        ["UNCUT_SAPPHIRE", 1, 105, "You steal an uncut sapphire."],
        ["UNCUT_EMERALD", 1, 17],
        ["UNCUT_RUBY", 1, 5],
        ["UNCUT_DIAMOND", 1, 1],
      ],
    },
  ],
  [
    "Seed Stall",
    {
      theft: "seed", respawnTicks: 4, owners: ["Olivia"],
      petBase: 36490,
      level: 27,
      xp: 10,
      rewards: [
        ["HAMMERSTONE_SEED", 1, 120],
        ["POTATO_SEED", 1, 119],
        ["MARIGOLD_SEED", 1, 119],
        ["BARLEY_SEED", 1, 118],
        ["ONION_SEED", 1, 89],
        ["ASGARNIAN_SEED", 1, 83],
        ["CABBAGE_SEED", 1, 71],
        ["YANILLIAN_SEED", 1, 47],
        ["ROSEMARY_SEED", 1, 36],
        ["NASTURTIUM_SEED", 1, 35],
        ["TOMATO_SEED", 1, 35],
        ["JUTE_SEED", 1, 35],
        ["SWEETCORN_SEED", 1, 30],
        ["KRANDORIAN_SEED", 1, 24],
        ["STRAWBERRY_SEED", 1, 18],
        ["WILDBLOOD_SEED", 1, 12],
        ["WATERMELON_SEED", 1, 9],
      ],
    },
  ],
]);

STALLS.set("Silver stall", { theft: "silver", attemptMessage: "You attempt to steal some silver from the silver stall.", respawnTicks: 32, owners: ["Silver merchant", "Osian", "Gulldamar"], petBase: 36490, level: 50, xp: 205,
  rewards: [["SILVER_ORE", 1, 16, "You steal a piece of silver."], ["SILVER_BAR", 1, 3], ["TIARA", 1, 1]] });
STALLS.set("Spice stall", { theft: "spice", minutes: 6, respawnTicks: 10, owners: ["Spice seller", "Spice Merchant", "Caerwyn"], petBase: 36490, level: 65, xp: 92, rewards: [["SPICE", 1, 1]] });
STALLS.set("Market stall", { theft: "wine", respawnTicks: 8, owners: ["Fortunato"], petBase: 36490, level: 22, xp: 27,
  rewards: [["BOTTLE_OF_WINE", 1, 11], ["GRAPES", 1, 17], ["JUG", 1, 39], ["JUG_OF_WATER", 1, 20], ["JUG_OF_WINE", 1, 13]] });

// Hosidius (Wiki: Fruit Stall): restocks in 2.4 seconds; guard dogs watch the town square's.
STALLS.set("Fruit Stall", { theft: "hosidius", respawnTicks: 4, owners: [], petBase: 124066, level: 25, xp: 28.5,
  rewards: [["COOKING_APPLE", 1, 40], ["BANANA", 1, 20], ["STRAWBERRY", 1, 7], ["JANGERBERRIES", 1, 5], ["LEMON", 1, 5], ["REDBERRIES", 1, 5],
    ["PINEAPPLE", 1, 5], ["LIME", 1, 5], ["STRANGE_FRUIT", 1, 5], ["GOLOVANOVA_FRUIT_TOP", 1, 2], ["PAPAYA_FRUIT", 1, 1]] });
// Rellekka, Miscellania, Etceteria and the Warrens (Wiki: Fish stall, Veg stall). The Warrens'
// stall has a thief instead of a guard watching it.
STALLS.set("Fish stall", { theft: "fish", minutes: 15, respawnTicks: 12, owners: ["Fish monger", "Fishmonger"], guards: ["thief"], petBase: 36490, level: 42, xp: 42,
  rewards: [["RAW_SALMON", 1, 14], ["RAW_TUNA", 1, 5], ["RAW_LOBSTER", 1, 1]] });
STALLS.set("Veg stall", { theft: "veg", respawnTicks: 2, owners: ["Greengrocer"], petBase: 206777, level: 2, xp: 10,
  rewards: [["POTATO", 1, 3], ["CABBAGE", 1, 2], ["ONION", 1, 2], ["TOMATO", 1, 2], ["GARLIC", 1, 1]] });

// Keldagrim (Wiki: Crossbow stall, Crafting stall). The clothes stall has nothing to steal (below).
const CRAFTING_REWARDS = [["AMULET_MOULD", 1, 12], ["BRACELET_MOULD", 1, 12], ["NECKLACE_MOULD", 1, 11], ["RING_MOULD", 1, 11], ["CHISEL", 1, 6], ["GOLD_BAR", 1, 2]];
STALLS.set("Crossbow stall", { theft: "xbows", respawnTicks: 8, owners: ["Hirko"], petBase: 36490, level: 49, xp: 52,
  rewards: [["BRONZE_BOLTS", 3, 46], ["BRONZE_LIMBS", 3, 18], ["WOODEN_STOCK", 3, 12], ["MITHRIL_BOLTS", 3, 3], ["MITHRIL_LIMBS", 3, 1]] });
STALLS.set("Crafting stall", { theft: "keldacraft", respawnTicks: 8, owners: ["Nolar"], petBase: 47718, level: 5, xp: 20, rewards: CRAFTING_REWARDS });

/**
 * Ape Atoll (Wiki: Crafting stall, Food Stall, General Stall, Magic Stall, Scimitar Stall): only
 * in human form, and an attempt can miss by the stall's Skilling success chart (no stun, try again
 * at once). The owners neither watch the stall nor refuse to trade afterwards. The General Stall
 * is not on Rocky's list; it takes the other low-level Ape Atoll stalls' rate.
 */
const APE_ATOLL_STALL = { owners: [], marksMerchant: false, humanOnly: true };
STALLS.set("Food Stall", { ...APE_ATOLL_STALL, respawnTicks: 6, petBase: 47718, level: 5, xp: 16, success: [200, 480], rewards: [["BANANA", 1, 1]] });
STALLS.set("Crafting Stall", { ...APE_ATOLL_STALL, respawnTicks: 8, petBase: 47718, level: 5, xp: 20, success: [128, 512], rewards: CRAFTING_REWARDS });
STALLS.set("General Stall", { ...APE_ATOLL_STALL, respawnTicks: 8, petBase: 47718, level: 5, xp: 25, success: [128, 512],
  rewards: [["HAMMER", 1, 1], ["POT", 1, 1], ["TINDERBOX", 1, 1]] });
STALLS.set("Magic Stall", { ...APE_ATOLL_STALL, respawnTicks: 12, petBase: 36490, level: 65, xp: 90, success: [20, 180],
  rewards: [["AIR_RUNE", 1, 6], ["EARTH_RUNE", 1, 6], ["FIRE_RUNE", 1, 6], ["LAW_RUNE", 1, 1], ["NATURE_RUNE", 1, 1]] });
STALLS.set("Scimitar Stall", { ...APE_ATOLL_STALL, respawnTicks: 32, petBase: 36490, level: 65, xp: 210, success: [20, 180],
  rewards: [["IRON_SCIMITAR", 1, 23], ["STEEL_SCIMITAR", 1, 13], ["MITHRIL_SCIMITAR", 1, 3], ["ADAMANT_SCIMITAR", 1, 1]] });
const MISSED_THEFT_MESSAGE = "You attempt to steal from the stall but you miss your chance...";
const MONKEY_FORM_MESSAGE = "You wouldn't like to blow your cover by getting caught stealing.";
const CLOTHES_STALL_MESSAGE = "You don't really see anything you'd want to steal from this stall.";

STALLS.set("Baker's stall", STALLS.get("Bakery stall"));
STALLS.set("Baker's Stall", STALLS.get("Bakery stall"));
STALLS.set("Gem Stall", STALLS.get("Gem stall"));

/**
 * Port Roberts' market (Wiki: Port Roberts#Marketplace thieving): nine stalls that reuse the
 * mainland stalls' names, so each is keyed by its cache loc name instead. They have their own
 * levels, XP and stock, never deplete, and allow a theft every five ticks instead of two; their
 * shops stay open to a recent thief, so a theft there marks no merchant (and no cache varbit).
 * The guards' rotation and the jail are separate content.
 */
const PORT_ROBERTS_STALLS = new Map([
  ["port_roberts_market_stall_veg", { level: 2, xp: 5, petBase: 206777, rewards: [
    ["POTATO", 1, 3], ["CABBAGE", 1, 2], ["ONION", 1, 2], ["TOMATO", 1, 2], ["GARLIC", 1, 1],
  ] }],
  ["port_roberts_market_stall_silk", { level: 20, xp: 24, petBase: 36490, rewards: [["SILK", 1, 1, "You steal a piece of silk."]] }],
  ["port_roberts_market_stall_fur", { level: 35, xp: 38.5, petBase: 36490, rewards: [["BEAR_FUR", 1, 7], ["GREY_WOLF_FUR", 1, 1]] }],
  ["port_roberts_market_stall_fish", { level: 42, xp: 49.5, petBase: 36490, rewards: [
    ["RAW_SALMON", 1, 170], ["RAW_TUNA", 1, 62], ["RAW_LOBSTER", 1, 12],
    ["RAW_SWORDTIP_SQUID", 1, 7], ["RAW_GIANT_KRILL", 1, 4], ["RAW_HADDOCK", 1, 1],
  ] }],
  ["port_roberts_market_stall_silver", { level: 50, xp: 80, petBase: 36490, rewards: [
    ["SILVER_ORE", 1, 6], ["SILVER_BAR", 1, 3], ["TIARA", 1, 1],
  ] }],
  ["port_roberts_market_stall_spice", { level: 65, xp: 110, petBase: 36490, rewards: [["SPICE", 1, 1]] }],
  ["port_roberts_market_stall_gems", { level: 75, xp: 129.5, petBase: 36490, rewards: [
    ["UNCUT_SAPPHIRE", 1, 210], ["SAPPHIRE", 1, 105], ["UNCUT_EMERALD", 1, 34], ["EMERALD", 1, 17],
    ["UNCUT_RUBY", 1, 10], ["RUBY", 1, 5], ["UNCUT_DIAMOND", 1, 2], ["DIAMOND", 1, 1],
  ] }],
  ["port_roberts_market_stall_ore", { level: 82, xp: 191, petBase: 36490, rewards: [
    ["IRON_ORE", 1, 25], ["COAL", 1, 15], ["SILVER_ORE", 1, 10], ["GOLD_ORE", 1, 10],
    ["MITHRIL_ORE", 1, 10], ["ADAMANTITE_ORE", 1, 4], ["RUNITE_ORE", 1, 1],
  ] }],
  ["port_roberts_market_stall_cball", { level: 87, xp: 223, petBase: 36490, rewards: [
    ["BRONZE_CANNONBALL", 1, 79], ["IRON_CANNONBALL", 1, 64], ["STEEL_CANNONBALL", 1, 56],
    ["MITHRIL_CANNONBALL", 1, 24], ["ADAMANT_CANNONBALL", 1, 24], ["RUNE_CANNONBALL", 1, 8],
    ["DRAGON_CANNONBALL", 1, 1],
  ] }],
].map(([loc, stall]) => [loc, { depletes: false, marksMerchant: false, stealDelayMs: PORT_ROBERTS_STEAL_DELAY_MS, owners: [], ...stall }]));

/**
 * Mor Ul Rek (Wiki: Shop Counter (gems), Shop Counter (ore)): both counters are "Shop Counter", so
 * the cache loc name picks each, and TzHaar-Hur-Rin won't trade with a thief for 30 minutes. The gem
 * counter first rolls 1/50,000 for an onyx (uncut 2/3 of the time, Mod Ash), then its gem table.
 */
const MOR_UL_REK_STALLS = new Map([
  ["tzhaar_shopcounter_gem", { level: 75, xp: 408, respawnTicks: 175,
    rare: { chance: 50000, rewards: [["UNCUT_ONYX", 1, 2, "You steal an uncut onyx! Wow!"], ["ONYX", 1, 1, "You steal an onyx! Wow!"]] },
    rewards: [
      ["UNCUT_SAPPHIRE", 1, 1000], ["SAPPHIRE", 1, 500], ["UNCUT_EMERALD", 1, 600], ["EMERALD", 1, 300], ["UNCUT_RUBY", 1, 300], ["RUBY", 1, 150],
      ["UNCUT_DIAMOND", 1, 98], ["DIAMOND", 1, 49], ["UNCUT_DRAGONSTONE", 1, 2], ["DRAGONSTONE", 1, 1],
    ] }],
  ["tzhaar_shopcounter_ore", { level: 82, xp: 350, respawnTicks: 50, rewards: [
    ["IRON_ORE", 1, 25], ["COAL", 1, 15], ["SILVER_ORE", 1, 10], ["GOLD_ORE", 1, 10], ["MITHRIL_ORE", 1, 10], ["ADAMANTITE_ORE", 1, 8], ["RUNITE_ORE", 1, 2],
  ] }],
].map(([loc, stall]) => [loc, { theft: "tzhaar_gemore", minutes: 30, owners: ["TzHaar-Hur-Rin"], petBase: 36490, ...stall }]));

/** Stalls that share a name with others, keyed by their cache loc name. */
const LOC_STALLS = new Map([...PORT_ROBERTS_STALLS, ...MOR_UL_REK_STALLS]);
const ALL_STALLS = [...new Set([...STALLS.values(), ...LOC_STALLS.values()])];

function randomReward(rewards) {
  const totalWeight = rewards.reduce((sum, [, , weight]) => sum + weight, 0);
  let roll = Math.floor(Math.random() * totalWeight);
  for (const reward of rewards) {
    roll -= reward[2];
    if (roll < 0) {
      return { item: new core.Item(core.ItemIds[reward[0]], reward[1]), message: reward[3] };
    }
  }
  const [itemId, amount, , message] = rewards[rewards.length - 1];
  return { item: new core.Item(core.ItemIds[itemId], amount), message };
}

let pluginApi;

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

/** "You steal a cake.", "an uncut emerald", "some jangerberries" (a plural name), as live names a stolen item. */
function stealLine(item) {
  const name = String(item.getDefinition().getName() ?? "").toLowerCase();
  const article = /[^s]s$/.test(name) ? "some" : /^[aeiou]/.test(name) ? "an" : "a";
  return `You steal ${article} ${name}.`;
}

/**
 * The cache's empty counterpart, preserving each market's stall model and footprint: the empty
 * stall is the full one's own base model (Rellekka's fish stall is models 4292 + 1421, its empty
 * market stall 1421; Keldagrim's 5879 + goods and 5879; Ape Atoll's go back to a bamboo desk).
 */
function emptyStallId(object) {
  const ids = core.ObjectIdentifiers;
  const id = object.getId();
  if ([ids.FISH_STALL, ids.FUR_STALL_2, ids.FISH_STALL_2, ids.VEG_STALL, ids.FISH_STALL_3, ids.VEG_STALL_2, ids.FISH_STALL_4].includes(id)) return ids.MARKET_STALL_7;
  if ([ids.CROSSBOW_STALL, ids.CRAFTING_STALL_2].includes(id)) return ids.MARKET_STALL_12;
  if ([ids.CRAFTING_STALL, ids.FOOD_STALL, ids.GENERAL_STALL, ids.MAGIC_STALL, ids.SCIMITAR_STALL].includes(id)) return ids.BAMBOO_DESK;
  if ([ids.SHOP_COUNTER_4, ids.SHOP_COUNTER_5].includes(id)) return ids.SHOP_COUNTER_3;
  if (id === ids.MARKET_STALL_14) return ids.MARKET_STALL_15;
  if (id === ids.BAKERS_STALL_2) return ids.EMPTY_STALL;
  if ([ids.GEM_STALL_2, ids.BAKERY_STALL_2, ids.SILVER_STALL_2].includes(id)) return ids.MARKET_STALL_12;
  if (id === ids.FRUIT_STALL_3) return ids.FRUIT_STALL;
  if ([ids.SILK_STALL_5, ids.SILVER_STALL_4, ids.GEM_STALL_6, ids.SPICE_STALL_5].includes(id)) return ids.MARKET_STALL_25;
  if ([ids.SILK_STALL_7, ids.FUR_STALL_7, ids.GEM_STALL_8, ids.SPICE_STALL_6, ids.BAKERS_STALL_4].includes(id)) return ids.MARKET_STALL_28;
  return ids.MARKET_STALL;
}

function depleteStall(object, ticks) {
  if (depleted.has(object)) return;
  depleted.set(object, core.World.getProcessCycle());
  const empty = new core.GameObject(emptyStallId(object), object.getLocation().clone(), object.getType(), object.getFace(), object.getPrivateArea()).setOwner(object.getOwner());
  if (!object.getPrivateArea()?.isDestroyed()) {
    core.ObjectManager.deregister(object, true);
    core.ObjectManager.register(empty, true);
  }
  core.TaskManager.submit(new core.CountdownTask(object, ticks, () => {
    depleted.delete(object);
    if (object.getPrivateArea()?.isDestroyed()) return;
    core.ObjectManager.deregister(empty, true);
    object.getPrivateArea()?.add(object);
    core.ObjectManager.register(object, true);
  }));
}

/**
 * Another character blocks line of sight (Wiki: Line of sight), which is why standing under
 * the baker is the bakery stalls' documented safe spot. The owner's own check is separate:
 * an owner sharing the thief's tile may still notice them.
 */
function hiddenFromGuards(nearby, player) {
  return nearby.some((npc) => npc.getHitpoints() > 0 && npc.getLocation().equals(player.getLocation()));
}

/**
 * A stall always succeeds unless a guard or its owner can see the thief. Content may keep the
 * thief from being caught ("thieving:stall-watch" { player, object, unseen }, a league relic).
 */
function caughtStealing(player, stall, object) {
  const watch = { player, object, unseen: false };
  pluginApi.emitCustomEvent("thieving:stall-watch", watch);
  if (watch.unseen === true) return false;
  const nearby = core.World.getNpcsNear(player.getLocation(), LOOKOUT_RADIUS, player.getPrivateArea());
  const guarding = (npc) => {
    const name = String(npc.getDefinition().getName() ?? "").toLowerCase();
    return GUARDS.has(name) || !!stall.guards?.includes(name);
  };
  const guards = hiddenFromGuards(nearby, player) ? [] : nearby.filter((npc) => guarding(npc) && npc.getDefinition().isAttackable() && npc.getHitpoints() > 0 && !npc.getCombat().getTarget());
  const seesPlayer = (npc) => core.RegionManager.canProjectileAttackBounds(npc.getLocation(), player.getLocation(), npc.getSize(), npc.getSize(), 1, 1, player.getPrivateArea());
  const lookout = guards.find((npc) => !npc.getLocation().equals(player.getLocation()) && seesPlayer(npc))
    ?? nearby.find((npc) => stall.owners.includes(npc.getDefinition().getName()) && npc.getHitpoints() > 0
      && (!stall.safeUnderOwner || !npc.getLocation().equals(player.getLocation())) && seesPlayer(npc));
  if (!lookout) return false;
  if (!SILENT_GUARDS.has(String(lookout.getDefinition().getName() ?? "").toLowerCase())) lookout.forceChat("Hey! Get your hands off there!");
  const guard = guards.includes(lookout) ? lookout : guards[0];
  if (guard) guard.getCombat().attack(player);
  return true;
}

// The client uses these cache varbits for the merchants' stolen-stock state.
function syncTheft(player, key, value) {
  const id = core.CacheDefinitions.getVarbitId(`marketthief_${key}`);
  if (id != null) player.getPacketSender().sendVarbit(id, value);
}

const REGIONAL_THEFT_KEYS = new Map([
  ["dwarf_market_bakery", "keldabread"], ["dwarf_market_gems", "keldagem"], ["dwarf_market_silver", "keldasilver"],
  ["viking_fur_market", "vikingfur"], ["vikingexile_fur_market", "vikingfur"],
  ["prif_marketstall_silk", "silk_prif"], ["prif_marketstall_silver", "silver_prif"],
  ["prif_marketstall_gem", "gem_prif"], ["prif_marketstall_spice", "spice_prif"],
  ["viking_fish_market", "vikingfish"], ["misc_fish_market", "miscfish"], ["etc_fish_market", "etcfish"], ["fish_stall_warrens", "warrensfish"],
  ["misc_veg_market", "miscveg"], ["etc_veg_market", "etcveg"],
]);

function theftVarbitKey(object, stall) {
  return REGIONAL_THEFT_KEYS.get(core.CacheDefinitions.getLocNames().get(object.getId())) ?? stall.theft;
}

function stopTheftTimers(player) {
  for (const task of theftTimers.get(player)?.values() ?? []) task.stop();
  theftTimers.delete(player);
}

function rememberTheft(player, stall, varbitKey) {
  const key = stall.theft;
  const previous = player.getAttribute(THEFT_ATTRIBUTE) ?? {};
  const varbits = [...new Set([...(previous[key] ?? []), ...(varbitKey ? [varbitKey] : [])])];
  const stolen = { ...previous, [key]: varbits };
  player.setAttribute(THEFT_ATTRIBUTE, stolen);
  let timers = theftTimers.get(player);
  if (!timers) theftTimers.set(player, timers = new Map());
  timers.get(key)?.stop();
  for (const bit of varbits) syncTheft(player, bit, 1);
  const task = new core.CountdownTask(player, (stall.minutes ?? 10) * 100, () => {
    const remaining = { ...player.getAttribute(THEFT_ATTRIBUTE) };
    delete remaining[key];
    player.setAttribute(THEFT_ATTRIBUTE, Object.keys(remaining).length ? remaining : null);
    timers.delete(key);
    for (const bit of varbits) syncTheft(player, bit, 0);
  });
  timers.set(key, task);
  core.TaskManager.submit(task);
}

function login({ player }) {
  // The Wiki requires consecutive in-game minutes; a logout restarts the wait.
  for (const stall of ALL_STALLS) {
    if (stall.theft && player.getAttribute(THEFT_ATTRIBUTE)?.[stall.theft]) rememberTheft(player, stall);
  }
}

function logout({ player }) {
  stopTheftTimers(player);
}

function merchantInteraction(event) {
  const name = event.definition.getName();
  const stall = ALL_STALLS.find((entry) => entry.marksMerchant !== false && entry.owners.includes(name));
  if (!stall || !event.player.getAttribute(THEFT_ATTRIBUTE)?.[stall.theft]) return false;
  event.npc.forceChat(name === "Fortunato" ? "You're the thief who stole from me!" : "You're the one who stole something from me!");
  core.TaskManager.submit(new core.CountdownTask(event.npc, 2, () => event.npc.forceChat("Guards guards!")));
  const guard = core.World.getNpcsNear(event.player.getLocation(), LOOKOUT_RADIUS, event.player.getPrivateArea()).find((npc) =>
    GUARDS.has(String(npc.getDefinition().getName() ?? "").toLowerCase()) && npc.getDefinition().isAttackable()
    && npc.getHitpoints() > 0 && !npc.getCombat().getTarget());
  if (guard) guard.getCombat().attack(event.player);
  event.handled = true;
}

/** Where something stands, as plain coordinates. */
function tile(location) {
  return { x: location?.getX?.(), y: location?.getY?.(), z: location?.getZ?.() };
}

function samePlace(location, from) {
  const here = tile(location);
  return !!from && here.x !== undefined && here.x === from.x && here.y === from.y && here.z === from.z;
}

/** A stall's identity: Port Roberts' nine and Mor Ul Rek's two share names, the cache loc name separates them. */
function stallFor(object, name) {
  return LOC_STALLS.get(core.CacheDefinitions.getLocNames().get(object.getId())) ?? STALLS.get(name);
}

/** The gem counter's onyx comes before its gem table (Mod Ash, Wiki: Shop Counter (gems)). */
function rollStall(stall) {
  if (stall.rare && Math.floor(Math.random() * stall.rare.chance) === 0) return randomReward(stall.rare.rewards);
  return randomReward(stall.rewards);
}

/** Wiki (Module:Skilling success chart): low/high interpolated by level, out of 256. */
function successChance([low, high], level) {
  return Math.max(0, Math.min(1, (1 + Math.floor(low * (99 - level) / 98 + high * (level - 1) / 98 + 0.5)) / 256));
}

/** Ape Atoll's stalls refuse a monkey ("greegree:form" answers while the player is transformed). */
function inMonkeyForm(player) {
  const request = { player, form: null };
  pluginApi.emitCustomEvent("greegree:form", request);
  return request.form != null;
}

function stealFromClothesStall({ player }) {
  player.sendMessage(CLOTHES_STALL_MESSAGE);
}

function finishTheft(event, stall) {
  const { player, object } = event;
  if (object.getPrivateArea()?.isDestroyed()) return;
  // Another item can fill the final slot during the attempt tick.
  if (player.getInventory().isFull()) { player.getInventory().full(); return; }
  if (stall.success && Math.random() >= successChance(stall.success, player.getSkillManager().getCurrentLevel(core.Skill.THIEVING))) {
    player.sendMessage(MISSED_THEFT_MESSAGE);
    return;
  }
  const { item: reward, message } = rollStall(stall);
  const request = { player, itemId: reward.getId(), amount: reward.getAmount(), stored: 0 };
  pluginApi.emitCustomEvent("storage:gather", request);
  if (reward.getAmount() > request.stored) player.getInventory().addItem(new core.Item(reward.getId(), reward.getAmount() - request.stored));
  player.getSkillManager().addExperiences(core.Skill.THIEVING, stall.xp);
  spam(player, message ?? stealLine(reward));
  if (stall.marksMerchant !== false) rememberTheft(player, stall, theftVarbitKey(object, stall));
  pluginApi.emitCustomEvent("thieving:success", { player, skill: core.Skill.THIEVING, petBase: stall.petBase, method: "stall",
    stall: event.definition.getName(), itemId: reward.getId(), location: object.getLocation() });
  const ticks = object.getId() === core.ObjectIdentifiers.BAKERY_STALL_2 ? 16 : stall.respawnTicks;
  // Content may keep the stall stocked ("thieving:deplete-stall", a league relic) and ask for another go ("thieving:done").
  const depletion = { player, object, handled: false };
  pluginApi.emitCustomEvent("thieving:deplete-stall", depletion);
  if (!depletion.handled && stall.depletes !== false) depleteStall(object, ticks);
  const done = { player, kind: "stall", object, succeeded: true, again: false };
  pluginApi.emitCustomEvent("thieving:done", done);
  // A repeat only while the player stands where they stole from.
  // Keyed by the player's index, as their other actions: walking off cancels it; and checked again when it fires.
  if (done.again && samePlace(player.getLocation(), event.from)) core.TaskManager.submit(new core.CountdownTask(player.getIndex(), 1, () => {
    if (samePlace(player.getLocation(), event.from) && player.getMovementQueue?.()?.isMovings?.() !== true) handleStealFromStall({ ...event, repeat: true });
  }));
}

function handleStealFromStall(event) {
  const stall = stallFor(event.object, event.definition.getName());
  if (!stall) {
    return false;
  }

  // Other objects share the wine stall's name, including its clickable empty version.
  if (event.definition.getName() === "Market stall" && event.object.getId() !== core.ObjectIdentifiers.MARKET_STALL_14) return;
  event.handled = true;
  if (depleted.has(event.object)) return;

  const player = event.player;
  if (stall.humanOnly && inMonkeyForm(player)) {
    player.sendMessage(MONKEY_FORM_MESSAGE);
    return;
  }
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < stall.level) {
    player.sendMessage(`You need a Thieving level of at least ${stall.level} to do this.`);
    event.handled = true;
    return;
  }
  if (!event.repeat && !player.getClickDelay().elapsedTime(stall.stealDelayMs ?? STEAL_DELAY_MS)) {
    event.handled = true;
    return;
  }
  if (player.getInventory().isFull()) {
    player.getInventory().full();
    event.handled = true;
    return;
  }

  player.setPositionToFace(event.object.getLocation());
  const attempt = stall.attemptMessage;
  if (attempt) spam(player, attempt);
  if (caughtStealing(player, stall, event.object)) return;
  player.getClickDelay().reset();
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_pickuptable")));
  player.getPacketSender().sendSound(THIEVING_SOUND, 10, 0);
  const from = event.from ?? tile(player.getLocation());
  core.TaskManager.submit(new core.CountdownTask(player, 1, () => finishTheft({ ...event, from }, stall)));
  event.handled = true;
}

function attach(api) {
  core = api.core;
  pluginApi = api;
  api.persistAttribute(THEFT_ATTRIBUTE, null);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onNpcsInteraction([...new Set(ALL_STALLS.filter((stall) => stall.marksMerchant !== false).flatMap((stall) => stall.owners))], { "Talk-to": merchantInteraction, Trade: merchantInteraction });
  api.onObjectInteraction("Silver stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Spice stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Market stall", { "Steal-From": handleStealFromStall });
  api.onObjectInteraction("Bakery stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Silk stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Tea stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Fur stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Gem stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Gem Stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Baker's stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Baker's Stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Seed Stall", { "Steal from": handleStealFromStall });
  api.onObjectInteraction("Fruit Stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Veg stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Fish stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Crossbow stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Crafting stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Clothes stall", { "Steal-from": stealFromClothesStall });
  api.onObjectInteraction("Crafting Stall", { "Steal from": handleStealFromStall });
  api.onObjectInteraction("Food Stall", { "Steal from": handleStealFromStall });
  api.onObjectInteraction("General Stall", { "Steal from": handleStealFromStall });
  api.onObjectInteraction("Magic Stall", { "Steal from": handleStealFromStall });
  api.onObjectInteraction("Scimitar Stall", { "Steal from": handleStealFromStall });
  // Port Roberts and Mor Ul Rek (their cache loc names pick the definition).
  api.onObjectInteraction("Ore stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Cannonball stall", { "Steal-from": handleStealFromStall });
  api.onObjectInteraction("Shop Counter", { "Steal-from": handleStealFromStall });
}

module.exports = attach;
module.exports._test = { handleStealFromStall, stealFromClothesStall, stealLine, successChance, STALLS, PORT_ROBERTS_STALLS, MOR_UL_REK_STALLS, depleted, emptyStallId, merchantInteraction, login, logout, THEFT_ATTRIBUTE };
