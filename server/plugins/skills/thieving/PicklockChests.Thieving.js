/**
 * The "Picklock" thieving chests that nothing answered (issue #5744): the Aldarin villas' six chests, the Sailing
 * pirate chests (rusty on Dognose Island and Vatrachos Island, tarnished on the Crown Jewel and Shimmering Atoll,
 * reinforced on Ynysdail and Brittle Isle) and the Lizardman Temple's three stone chests. Each is a cache loc named
 * "Chest" or "Stone chest" with the one option Picklock, so a click fell through to nothing at all.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Chest_(Aldarin_Villas), /w/Rusty_chest, /w/Tarnished_chest,
 * /w/Reinforced_chest and /w/Stone_chest. None needs a lockpick: a carried one raises the chance by 25/256 (the
 * pages' with-lockpick charts sit 25 rolls above the without ones everywhere) and is never used up. The charts are
 * linear between two charted levels, so each kind keeps those two points as a roll out of 256.
 *
 * rsprox.net recording 1105 (rev 237, Leagues, Aldarin chest 54773 at 1350,2947, 108 loots, all successes), ticks
 * from the click on the adjacent chest:
 * - 0: human_lockedchest (537), sound 1243, "You attempt to picklock the chest." (spam)
 * - 2: human_openchest (536, delay 10), sound 52 (delay 10), "You manage to unlock the chest." (spam)
 * - 3: "You steal some loot from the chest." (spam), the loot, the Thieving XP (2,400 at Leagues' 12x: 200) and the chest
 *   open (54774); 4: sound 51 (delay 15); 5: the chest closed again (54773). It is the Isle of Souls chest's timeline
 *   (SoulChest.Thieving.js) and every kind here follows it: no capture of the pirate or Lizardman chests exists.
 *   A further 24 Thieving XP (2 at 12x) lands on the tick after the loot and is not explained here.
 *
 * Ours (nothing captured): the failure's lines (the Isle of Souls chest's "You fail to picklock the chest." and sound
 * 2402) and the level refusal (that chest's line); a loot that does not fit is not given, though the XP is. The Aldarin
 * chest's failure teleport to "a nearby well" copies that chest's trap animation and lines and lands on a walkable tile
 * beside the well nearest the chest (the Wiki shows the well on a map only). The pirate chests' and the temple's
 * failure teleports (the Wiki gives their share but no destination coordinates) are not implemented: a failed roll
 * only fails. The temple's loot respawns "instantly", read as the same two open ticks; the pirate chests state no respawn.
 */
const ObstacleRunner = require("../agility/ObstacleRunner.Agility");

const OPEN_TICKS = 2;
/** Every Wiki with-lockpick chart sits this many rolls (out of 256) above the without-lockpick one. */
const LOCKPICK_BONUS = 25;
const TELEPORT_ANIMATION = "human_castteleport";

const SOUND = Object.freeze({ ATTEMPT: 1243, FAIL: 2402, UNLOCK: 52, LOOT: 51, TRAP: 200 });
const TRAP_SOUND_RADIUS = 10;
const MESSAGE = Object.freeze({
  ATTEMPT: { spam: "You attempt to picklock the chest." },
  FAIL: { spam: "You fail to picklock the chest." },
  UNLOCK: { spam: "You manage to unlock the chest." },
  LOOT: { spam: "You steal some loot from the chest." },
  TRAP: { spam: "You have activated a trap on the chest." },
});

/** The Wiki's uncut gem roll, out of 10 (4/75, 3/75, 2/75 and 1/75). */
const GEMS = Object.freeze([["UNCUT_SAPPHIRE", 4], ["UNCUT_EMERALD", 3], ["UNCUT_RUBY", 2], ["UNCUT_DIAMOND", 1]]);
/** The Sailing frag table: [ItemIdentifiers key, weight] (6/600, 3/600 and 1/600). */
const FRAGS = Object.freeze([["ELKHORN_FRAG", 6], ["PILLAR_FRAG", 3], ["UMBRAL_FRAG", 1]]);
/** The Lizardman Temple's bolt tips table (opal 6/1,110 ... onyx 2/1,110), 4-12 of one. */
const BOLT_TIPS = Object.freeze([
  ["OPAL_BOLT_TIPS", 6], ["JADE_BOLT_TIPS", 2], ["PEARL_BOLT_TIPS", 6], ["TOPAZ_BOLT_TIPS", 2],
  ["SAPPHIRE_BOLT_TIPS", 2], ["EMERALD_BOLT_TIPS", 3], ["RUBY_BOLT_TIPS", 4], ["DIAMOND_BOLT_TIPS", 6],
  ["DRAGONSTONE_BOLT_TIPS", 4], ["ONYX_BOLT_TIPS", 2],
]);
/** The uncommon seed table: [ItemIdentifiers key, the Wiki's "1 in N" in an Aldarin chest]. A row's weight is 1 / N; the temple's N are the same rows scaled. */
const SEEDS = Object.freeze([
  ["LIMPWURT_SEED", 114.7], ["STRAWBERRY_SEED", 120], ["MARRENTILL_SEED", 125.8], ["JANGERBERRY_SEED", 170.9],
  ["TARROMIN_SEED", 184.9], ["WILDBLOOD_SEED", 189.4], ["WATERMELON_SEED", 249.5], ["HARRALANDER_SEED", 280.7],
  ["SNAPE_GRASS_SEED", 393], ["RANARR_SEED", 403.1], ["WHITEBERRY_SEED", 462.4], ["MUSHROOM_SPORE", 542.1],
  ["TOADFLAX_SEED", 582.2], ["BELLADONNA_SEED", 873.3], ["IRIT_SEED", 873.3], ["POISON_IVY_SEED", 1209.2],
  ["AVANTOE_SEED", 1310], ["CACTUS_SEED", 1310], ["KWUARM_SEED", 1746.7], ["POTATO_CACTUS_SEED", 1965],
  ["SNAPDRAGON_SEED", 3144], ["CADANTINE_SEED", 3930], ["LANTADYME_SEED", 5240], ["DWARF_WEED_SEED", 7860],
  ["TORSTOL_SEED", 15720],
].map(([key, oneIn]) => [key, 1 / oneIn]));

/** A table row's key for a sub-table roll. */
const SUB = Object.freeze({ GEM: GEMS, FRAGS, BOLT_TIPS, SEED: SEEDS });
const CLUE = Object.freeze({ medium: "CLUE_SCROLL_MEDIUM_", hard: "CLUE_SCROLL_HARD_" });

/** Rows are [ItemIdentifiers key or a SUB / CLUE key, min, max, weight]. */
const ALDARIN_LOOT = Object.freeze([
  ["COINS", 100, 200, 20], ["COINS", 250, 500, 10], ["COINS", 600, 1200, 4],
  ["SILVER_BAR", 1, 1, 3], ["GOLD_BAR", 1, 1, 3], ["GEM", 1, 1, 8],
  ["SPINACH_ROLL", 1, 1, 4], ["BLESSED_BONE_SHARDS", 10, 20, 2], ["ECLIPSE_RED", 1, 1, 2], ["SEED", 1, 1, 4],
]);
/**
 * A pirate chest's 60 rolls from its Wiki page: a dagger and a scimitar (3/60 each), three cannonballs (3, 2 and 1/60,
 * 5-10), a gem (8), coins (20), silver and gold bars (4 each), a rune (3, 5-10), two necklaces (2 each), two of a frag
 * (3) and the frag table (1). The pages' rows add to 59, not 60; the weights are used as given.
 */
function pirateLoot({ dagger, scimitar, cannonballs, coins, rune, necklaces, frag }) {
  return Object.freeze([
    [dagger, 1, 1, 3], [scimitar, 1, 1, 3],
    [cannonballs[0], 5, 10, 3], [cannonballs[1], 5, 10, 2], [cannonballs[2], 5, 10, 1],
    ["GEM", 1, 1, 8], ["COINS", coins[0], coins[1], 20], ["SILVER_BAR", 1, 1, 4], ["GOLD_BAR", 1, 1, 4],
    [rune, 5, 10, 3], [necklaces[0], 1, 1, 2], [necklaces[1], 1, 1, 2], [frag, 2, 2, 3], ["FRAGS", 1, 1, 1],
  ]);
}
const LIZARDMAN_LOOT = Object.freeze([
  ["BOLT_TIPS", 4, 12, 10], ["SEED", 1, 1, 15], ["COINS", 20, 260, 100], ["XERICIAN_FABRIC", 1, 1, 66],
  ["LIZARDMAN_FANG", 1, 1, 85], ["UNCUT_SAPPHIRE", 1, 1, 12], ["UNCUT_RUBY", 1, 1, 8], ["CLUE_MEDIUM", 1, 1, 3],
  ["XERICS_TALISMAN_INERT_", 1, 1, 1],
]);

/** The Aldarin villas' wells, from the cache (loc 46805, 2x2: south-west corner). */
const WELLS = Object.freeze([[1353, 2912], [1373, 2939], [1378, 2968]]);
const WELL_SIZE = 2;

/**
 * One row a kind of chest. `chance` is the Wiki chart's two points (a roll out of 256 at each level); `teleport` the
 * share of failed rolls that teleport, at the same two levels, with `tile(object)` for where; `pre` the rolls made
 * before the table: { chance, tier } for a clue, or { chance, item, once } for the Medallion fragment.
 */
const KINDS = Object.freeze([
  {
    key: "aldarin", closed: ["aldarin_thieving_chest"], open: "aldarin_thieving_chest_open", level: 36, xp: 200,
    chance: { lowLevel: 36, lowRoll: 55, highLevel: 99, highRoll: 151 },
    teleport: { low: 0.211, high: 0.0703, tile: wellTile },
    pre: [{ chance: 1 / 90, clue: "medium" }], loot: ALDARIN_LOOT,
  },
  {
    key: "rusty", closed: ["rusty_pirate_thieving_chest_dognose", "rusty_pirate_thieving_chest_vatrachos"],
    open: "rusty_pirate_thieving_chest_open", level: 33, xp: 90,
    chance: { lowLevel: 33, lowRoll: 48, highLevel: 99, highRoll: 156 },
    pre: [{ chance: 1 / 4, item: "MEDALLION_FRAGMENT", unless: ["MEDALLION_FRAGMENT", "MEDALLION_OF_THE_DEEP"], only: "rusty_pirate_thieving_chest_dognose" },
      { chance: 1 / 200, clue: "medium" }],
    loot: pirateLoot({
      dagger: "STEEL_DAGGER", scimitar: "STEEL_SCIMITAR", cannonballs: ["BRONZE_CANNONBALL", "IRON_CANNONBALL", "STEEL_CANNONBALL"],
      coins: [100, 200], rune: "MIND_RUNE", necklaces: ["SAPPHIRE_NECKLACE", "EMERALD_NECKLACE"], frag: "ELKHORN_FRAG",
    }),
  },
  {
    key: "tarnished", closed: ["tarnished_pirate_thieving_chest_crown_jewel", "tarnished_pirate_thieving_chest_shimmering_atoll"],
    open: "tarnished_pirate_thieving_chest_open", level: 54, xp: 122.5,
    chance: { lowLevel: 54, lowRoll: 83, highLevel: 99, highRoll: 156 },
    pre: [{ chance: 1 / 150, clue: "medium" }],
    loot: pirateLoot({
      dagger: "MITHRIL_DAGGER", scimitar: "MITHRIL_SCIMITAR", cannonballs: ["IRON_CANNONBALL", "STEEL_CANNONBALL", "MITHRIL_CANNONBALL"],
      coins: [200, 400], rune: "CHAOS_RUNE", necklaces: ["EMERALD_NECKLACE", "RUBY_NECKLACE"], frag: "PILLAR_FRAG",
    }),
  },
  {
    key: "reinforced", closed: ["reinforced_pirate_thieving_chest_ynysdail", "reinforced_pirate_thieving_chest_brittle"],
    open: "reinforced_pirate_thieving_chest_open", level: 76, xp: 182.5,
    chance: { lowLevel: 76, lowRoll: 118, highLevel: 99, highRoll: 156 },
    pre: [{ chance: 1 / 140, clue: "hard" }],
    loot: pirateLoot({
      dagger: "ADAMANT_DAGGER", scimitar: "ADAMANT_SCIMITAR", cannonballs: ["STEEL_CANNONBALL", "MITHRIL_CANNONBALL", "ADAMANT_CANNONBALL"],
      coins: [500, 1000], rune: "DEATH_RUNE", necklaces: ["RUBY_NECKLACE", "DIAMOND_NECKLACE"], frag: "UMBRAL_FRAG",
    }),
  },
  {
    key: "lizardman", closed: ["molch_temple_chest_theiving"], open: "molch_temple_chest_theiving_open", level: 64, xp: 280,
    chance: { lowLevel: 64, lowRoll: 80, highLevel: 99, highRoll: 155 },
    pre: [], loot: LIZARDMAN_LOOT,
  },
]);

/** The cache names the chests carry (hooks are by name). */
const CHEST_NAMES = Object.freeze(["Chest", "Rusty chest", "Tarnished chest", "Reinforced chest", "Stone chest"]);

let api;
let core;
let ids = null;
/** ObstacleRunner is set up on the first attempt, not at attach (unit tests attach with a partial api). */
let runnerReady = false;
/** The unit's rolls; tests replace it. */
let random = Math.random;
/** Players mid-attempt. */
const attempts = new WeakSet();
/** Open chests by tile: { closed, open, token }. */
const opened = new Map();

function resolveIds() {
  if (ids) return ids;
  const cache = core.CacheDefinitions;
  ids = {
    kinds: new Map(),
    lockedChest: cache.getSeqId("human_lockedchest"),
    openChest: cache.getSeqId("human_openchest"),
    castTeleport: cache.getSeqId(TELEPORT_ANIMATION),
    castGfx: cache.getSpotanimId("teleport_casting"),
    busy: cache.getVarbitId("busy"),
  };
  for (const kind of KINDS) {
    const open = cache.getLocId(kind.open);
    for (const name of kind.closed) ids.kinds.set(cache.getLocId(name), { kind, open, name });
  }
  return ids;
}

const tileKey = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;

function lerp(level, lowLevel, low, highLevel, high) {
  const along = (Math.max(lowLevel, Math.min(highLevel, level)) - lowLevel) / (highLevel - lowLevel);
  return low + (high - low) * along;
}

/** Wiki chart, linear between the kind's two charted levels, out of 256. */
function successChance(kind, level, lockpick) {
  const { lowLevel, lowRoll, highLevel, highRoll } = kind.chance;
  return (lerp(level, lowLevel, lowRoll, highLevel, highRoll) + (lockpick ? LOCKPICK_BONUS : 0)) / 256;
}

/** Share of failed rolls that teleport (0 where the kind has none). */
function teleportChance(kind, level) {
  if (!kind.teleport) return 0;
  return lerp(level, kind.chance.lowLevel, kind.teleport.low, kind.chance.highLevel, kind.teleport.high);
}

function weighted(rows, weightOf) {
  const total = rows.reduce((sum, row) => sum + weightOf(row), 0);
  let roll = random() * total;
  for (const row of rows) {
    roll -= weightOf(row);
    if (roll < 0) return row;
  }
  return rows[rows.length - 1];
}

/** A clue through the shared clue services: one per tier, a scroll box after X Marks the Spot. Null when it cannot be held. */
function clue(player, tier) {
  const allowed = { player, tier, allowed: null };
  api.emitCustomEvent("treasure-trails:can-receive", allowed);
  if (allowed.allowed === false) {
    api.emitCustomEvent("treasure-trails:missed-clue", { player, tier });
    return null;
  }
  const award = { player, itemId: core.ItemIdentifiers[CLUE[tier]], box: false };
  api.emitCustomEvent("treasure-trails:clue-item", award);
  return new core.Item(award.itemId, 1);
}

function ownsItem(player, id) {
  return player.getInventory().contains(id) || player.getEquipment().contains(id)
    || (player.getBanks?.() ?? []).some((bank) => bank?.contains?.(id));
}

/** One loot: an Item, or null when the roll is a clue the player cannot hold. */
function rollLoot(player, entry) {
  const { kind } = entry;
  const I = core.ItemIdentifiers;
  for (const pre of kind.pre) {
    if (pre.only && pre.only !== entry.name) continue;
    if (pre.unless?.some((key) => ownsItem(player, I[key]))) continue;
    if (random() >= pre.chance) continue;
    return pre.clue ? clue(player, pre.clue) : new core.Item(I[pre.item], 1);
  }
  const [key, min, max] = weighted(kind.loot, (row) => row[3]);
  if (key === "CLUE_MEDIUM") return clue(player, "medium");
  const itemKey = SUB[key] ? weighted(SUB[key], (row) => row[1])[0] : key;
  return new core.Item(I[itemKey], min + Math.floor(random() * (max - min + 1)));
}

/** The whole item fits: a stack it joins, or a free slot per unstackable item. */
function fits(player, item) {
  return player.getInventory().getAddableAmount(item) >= item.getAmount();
}

function giveLoot(player, entry, object) {
  const item = rollLoot(player, entry);
  if (item && fits(player, item)) {
    player.getInventory().add(item, false);
    player.getInventory().refreshItems();
  }
  player.getSkillManager().addExperiences(core.Skill.THIEVING, entry.kind.xp);
  api.emitCustomEvent("chest:opened", { player, objectId: object.getId() });
}

/** The chest shows open for everyone until 2 ticks after the latest loot. */
function openChest(object, entry) {
  const key = tileKey(object.getLocation());
  let state = opened.get(key);
  if (!state) {
    const closed = object;
    const open = new core.GameObject(entry.open, closed.getLocation().clone(), closed.getType(), closed.getFace(), closed.getPrivateArea());
    state = { closed, open, token: 0 };
    opened.set(key, state);
    core.ObjectManager.deregister(closed, true);
    core.ObjectManager.register(open, true);
  }
  const token = ++state.token;
  core.TaskManager.submit(new core.CountdownTask(state.open, OPEN_TICKS, () => {
    if (state.token !== token || opened.get(key) !== state) return;
    opened.delete(key);
    core.ObjectManager.deregister(state.open, true);
    core.ObjectManager.register(state.closed, true);
  }));
}

/** The well nearest the chest (the villas' upper floors stand over the same ground). */
function nearestWell(object) {
  const at = object.getLocation();
  const distance = (well) => Math.abs(well[0] - at.getX()) + Math.abs(well[1] - at.getY());
  return WELLS.reduce((best, well) => (distance(well) < distance(best) ? well : best), WELLS[0]);
}

/** A walkable ground tile in the ring around the well, or the tile south-west of it when none is. */
function wellTile(object) {
  const [wx, wy] = nearestWell(object);
  const ring = [];
  for (let x = wx - 1; x <= wx + WELL_SIZE; x++) {
    for (let y = wy - 1; y <= wy + WELL_SIZE; y++) {
      const inside = x >= wx && x < wx + WELL_SIZE && y >= wy && y < wy + WELL_SIZE;
      if (!inside && !core.RegionManager.blocked(new core.Location(x, y, 0), null)) ring.push([x, y, 0]);
    }
  }
  return ring.length === 0 ? [wx - 1, wy - 1, 0] : ring[Math.floor(random() * ring.length)];
}

function steps(player, object, entry, outcome) {
  const id = resolveIds();
  const start = [
    { anim: id.lockedChest },
    { sound: SOUND.ATTEMPT },
    { msg: MESSAGE.ATTEMPT },
    { wait: 1 },
    { varbit: [id.busy, 1] },
    { wait: 1 },
  ];
  if (outcome === "unlock") {
    return [...start,
      { anim: id.openChest, delay: 10 },
      { sound: SOUND.UNLOCK, delay: 10 },
      { msg: MESSAGE.UNLOCK },
      { wait: 1 },
      { msg: MESSAGE.LOOT },
      { run: () => { giveLoot(player, entry, object); openChest(object, entry); } },
      { wait: 1 },
      { sound: SOUND.LOOT, delay: 15 },
      { wait: 1 },
      { varbit: [id.busy, 0] },
    ];
  }
  const failed = [{ sound: SOUND.FAIL }, { msg: MESSAGE.FAIL }];
  if (outcome === "fail") return [...start, ...failed, { varbit: [id.busy, 0] }];
  const at = player.getLocation();
  return [...start,
    { anim: id.castTeleport },
    { gfx: id.castGfx, height: 92 },
    { areaSound: SOUND.TRAP, at: [at.getX(), at.getY(), at.getZ()], radius: TRAP_SOUND_RADIUS },
    ...failed,
    { wait: 2 },
    { msg: MESSAGE.TRAP },
    { wait: 1 },
    { varbit: [id.busy, 0] },
    { anim: -1 },
    { tele: entry.kind.teleport.tile(object) },
  ];
}

function hasLockpick(player) {
  return player.getInventory().contains(core.ItemIdentifiers.LOCKPICK);
}

function outcomeFor(player, kind) {
  const level = player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
  if (random() < successChance(kind, level, hasLockpick(player))) return "unlock";
  return random() < teleportChance(kind, level) ? "teleport" : "fail";
}

function picklock(event) {
  const { player, object } = event;
  const entry = player && object ? resolveIds().kinds.get(object.getId()) : null;
  if (!entry) return false;
  if (attempts.has(player) || ObstacleRunner.isBusy(player)) return true;
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < entry.kind.level) {
    player.sendMessage(`You need a Thieving level of at least ${entry.kind.level} to do this.`);
    return true;
  }
  player.setPositionToFace(object.getLocation());
  const outcome = outcomeFor(player, entry.kind);
  if (!runnerReady) {
    ObstacleRunner.init(api);
    runnerReady = true;
  }
  attempts.add(player);
  ObstacleRunner.run({ player, object }, steps(player, object, entry, outcome), {
    keepAnimation: true,
    onFinish: (completed) => {
      attempts.delete(player);
      // An attempt cut short (death, logout) never reaches its busy 0.
      if (!completed) player.getPacketSender().sendVarbit(resolveIds().busy, 0);
    },
  });
  return true;
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  ids = null;
  runnerReady = false;
  for (const name of CHEST_NAMES) pluginApi.onObjectInteraction(name, { Picklock: picklock });
};
module.exports._test = {
  KINDS, GEMS, FRAGS, BOLT_TIPS, SEEDS, WELLS, OPEN_TICKS, LOCKPICK_BONUS, opened,
  successChance, teleportChance, rollLoot, picklock, wellTile, resolveIds,
  setRandom(fn) { random = fn ?? Math.random; },
  reset() { ids = null; opened.clear(); },
};
