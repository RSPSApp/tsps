/**
 * Falador achievement diary gameplay credit.
 *
 * Each handler below runs after the qualifying action has already succeeded in the plugin that
 * owns it; nothing here awards credit for an attempt, a failure or an admin/league shortcut.
 * Task keys are the catalogue's (data/achievement-diaries.json); object ids come from the cache
 * (`yarn dump:loc`), NPC/locations from npc-spawns.json and the OSRS Wiki.
 */
const DIARY = "falador";
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);

const TASK = {
  westernWall: "climb-over-the-western-falador-wall",
  sarahShop: "browse-sarah-s-farm-shop",
  haircut: "get-a-haircut-or-a-shave-from-the-falador-hairdr",
  pumpBucket: "fill-a-bucket-from-the-pump-north-of-falador-wes",
  duck: "kill-a-duck-in-falador-park",
  mindTiara: "make-a-mind-tiara",
  entrana: "take-the-boat-to-entrana",
  strut: "repair-a-broken-strut-in-the-motherlode-mine",
  securityBook: "claim-a-security-book-from-the-security-guard-at",
  bluriteLimbs: "smith-some-blurite-limbs-on-doric-s-anvil",
  lantern: "light-a-bullseye-lantern-at-the-chemist-s-in-rim",
  telegrabWine: "telegrab-some-wine-of-zamorak-at-the-chaos-templ",
  mogre: "kill-a-mogre-at-mudskipper-point",
  ratPits: "visit-the-port-sarim-rat-pits",
  guard: "pickpocket-a-falador-guard",
  guthixAltar: "pray-at-the-altar-of-guthix-in-taverley-whilst-w",
  craftingGuildGold: "mine-some-gold-ore-at-the-crafting-guild",
  crevice: "squeeze-through-the-crevice-in-the-dwarven-mines",
  willow: "chop-and-burn-some-willow-logs-in-taverley",
  fruitBasket: "craft-a-fruit-basket-on-the-falador-farm-loom",
  faladorTeleport: "teleport-to-falador",
  mindRunes: "craft-140-mind-runes-simultaneously-from-essence",
  giantMole: "kill-the-giant-mole-beneath-falador-park",
  skeletalWyvern: "kill-a-skeletal-wyvern-in-the-asgarnia-ice-dunge",
  miningGuild: "enter-the-mining-guild-wearing-a-prospector-helm",
  blueDragon: "kill-the-blue-dragon-under-the-heroes-guild",
  portSarimPrayer: "recharge-your-prayer-in-the-port-sarim-church-wh",
  warriorsGuild: "enter-the-warriors-guild",
  dwarvenHelmet: "equip-a-dwarven-helmet-within-the-dwarven-mines",
  airRunes: "craft-252-air-runes-simultaneously-from-essence",
  capeEmote: "perform-a-skillcape-or-quest-cape-emote-at-the-t",
  strangeFloor: "jump-over-the-strange-floor-in-taverley-dungeon",
  saradominBrew: "mix-a-saradomin-brew-in-falador-east-bank",
};

const SARAH_SHOP_ID = 1309;
const SECURITY_GUARD_NPC_ID = 5442;
const FALADOR_HAIRDRESSER = [2946, 3379];
const PUMP_LOC_ID = 24004;
const PUMP = [2947, 3382];
const CHEMIST = [2934, 3210];
const CHAOS_TEMPLE = [2930, 3515];
const GUTHIX_ALTAR_LOC_ID = 410;
const GUTHIX_ALTAR = [2925, 3483];
const PORT_SARIM_ALTAR_LOC_ID = 409;
const PORT_SARIM_ALTAR = [2995, 3177];
const FALADOR_TELEPORT = [2965, 3378];
const DORIC_ANVIL = [2950, 3451];
const FALADOR_FARM_LOOM = [3039, 3287];
const FALADOR_CASTLE_TOP = { minX: 2955, maxX: 2995, minY: 3325, maxY: 3355, levels: [3] };
const SKILLCAPE_EMOTE_SLOT = 43;

const FALADOR_PARK = { minX: 2970, maxX: 3000, minY: 3350, maxY: 3395, levels: [0] };
const MUDSKIPPER_POINT = { minX: 2930, maxX: 3015, minY: 3060, maxY: 3130, levels: [0] };
const ICE_DUNGEON = { minX: 3015, maxX: 3090, minY: 9530, maxY: 9600, levels: [0] };
const HEROES_DUNGEON = { minX: 2880, maxX: 2965, minY: 9760, maxY: 9840, levels: [0] };
const MOLE_LAIR = { minX: 1720, maxX: 1795, minY: 5140, maxY: 5250, levels: [0] };
const CRAFTING_GUILD = { minX: 2915, maxX: 2950, minY: 3265, maxY: 3305, levels: [0] };
const FALADOR_CITY = { minX: 2935, maxX: 3065, minY: 3320, maxY: 3405, levels: [0] };
const TAVERLEY = { minX: 2860, maxX: 2960, minY: 3380, maxY: 3480, levels: [0] };
const FALADOR_EAST_BANK = { minX: 3006, maxX: 3020, minY: 3350, maxY: 3362, levels: [0] };
const DWARVEN_MINE = { minX: 3005, maxX: 3070, minY: 9730, maxY: 9850, levels: [0] };
const MINING_GUILD = { minX: 3035, maxX: 3068, minY: 9735, maxY: 9756, levels: [0] };
// The two members' entrances are south of their north-facing doors (cache locs 30365/30366).
const MINING_GUILD_WEST_ENTRANCE = { minX: 3019, maxX: 3019, minY: 9732, maxY: 9732, levels: [0] };
const MINING_GUILD_SOUTH_ENTRANCE = { minX: 3043, maxX: 3043, minY: 9729, maxY: 9729, levels: [0] };
const WARRIORS_GUILD = { minX: 2835, maxX: 2876, minY: 3533, maxY: 3560, levels: [0] };
const PORT_SARIM_RAT_PITS = { minX: 3010, maxX: 3028, minY: 3225, maxY: 3240, levels: [0] };

const CRUMBLING_FALADOR_WALL = 24222;
const DWARVEN_MINE_CREVICE = 16543;
const TAVERLEY_STRANGE_FLOOR = 16510;

const GOLD_ORE_IDS = new Set([444, 445]);
const BLURITE_LIMBS_IDS = new Set([9422, 15103]);
const SARADOMIN_BREW_IDS = new Set([6685, 6686, 6687, 15269]);
const WILLOW_LOG_IDS = new Set([1519, 1520, 13985]);
const MIND_TIARA_IDS = new Set([5529, 5530, 19250]);
const LIT_BULLSEYE_LANTERN_IDS = new Set([4550]);
const BASKET_ID = 5376;
const WINE_OF_ZAMORAK_ID = 245;
const SECURITY_BOOK_ID = 9003;
const DWARVEN_HELMET_ID = 11200;
const PROSPECTOR_HELMET_IDS = new Set([12013, 16245]);
const GOLDEN_PROSPECTOR_HELMET_IDS = new Set([25549, 25550]);
const WILLOW_CHOP_ATTRIBUTE = "falador-diary:taverley-willow-chopped";
const WILLOW_CHOP_WINDOW_MS = 10 * 60 * 1000;

let api;
let core;

function inZone(location, zone) {
  if (!location) return false;
  if (zone.levels && !zone.levels.includes(location.getZ())) return false;
  const x = location.getX();
  const y = location.getY();
  return x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY;
}

function near(location, [x, y], radius, z = 0) {
  return location?.getZ?.() === z
    && Math.abs(location.getX() - x) <= radius
    && Math.abs(location.getY() - y) <= radius;
}

function award(player, task) {
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function npcName(npc, player) {
  return npc?.getCurrentDefinition?.(player)?.getName?.() ?? npc?.getDefinition?.()?.getName?.() ?? "";
}

function isPlayer(killer) {
  return killer?.isPlayer?.() === true && killer.getHitpoints?.() > 0;
}

function onNpcDeath({ killer, npc }) {
  if (!isPlayer(killer) || !npc) return;
  const name = npcName(npc, killer);
  const at = npc.getLocation?.();
  if (name === "Duck" && inZone(at, FALADOR_PARK)) award(killer, TASK.duck);
  else if (name === "Mogre" && inZone(at, MUDSKIPPER_POINT)) award(killer, TASK.mogre);
  else if (name === "Skeletal Wyvern" && inZone(at, ICE_DUNGEON)) award(killer, TASK.skeletalWyvern);
  else if (name === "Blue dragon" && inZone(at, HEROES_DUNGEON)) award(killer, TASK.blueDragon);
  else if (name === "Giant Mole" && inZone(at, MOLE_LAIR)) award(killer, TASK.giantMole);
}

function onShopOpened({ player, shopId }) {
  if (shopId === SARAH_SHOP_ID) award(player, TASK.sarahShop);
}

function onWaterFilled({ player, objectId, name, itemId }) {
  if (itemId !== core.ItemIdentifiers.BUCKET) return;
  if (objectId !== PUMP_LOC_ID && String(name ?? "").toLowerCase() !== "waterpump") return;
  if (near(player.getLocation(), PUMP, 2)) award(player, TASK.pumpBucket);
}

function onTiaraBound({ player, tiaraId }) {
  if (MIND_TIARA_IDS.has(tiaraId)) award(player, TASK.mindTiara);
}

function onLanternLit({ player, itemId }) {
  if (LIT_BULLSEYE_LANTERN_IDS.has(itemId) && near(player.getLocation(), CHEMIST, 4)) award(player, TASK.lantern);
}

function onStrutRepaired({ player }) {
  if (player) award(player, TASK.strut);
}

function onEntranaBoarded({ player }) {
  if (player) award(player, TASK.entrana);
}

function onMakeoverApplied({ player, type }) {
  if ((type === 0 || type === 1) && near(player.getLocation(), FALADOR_HAIRDRESSER, 3)) award(player, TASK.haircut);
}

function onSkillsProduced({ player, itemId, kind }) {
  if (kind === "weaving" && itemId === BASKET_ID && near(player.getLocation(), FALADOR_FARM_LOOM, 2)) award(player, TASK.fruitBasket);
}

function onMiningSuccess({ player, itemId }) {
  if (GOLD_ORE_IDS.has(itemId) && inZone(player.getLocation(), CRAFTING_GUILD)) award(player, TASK.craftingGuildGold);
}

function onSmithingSuccess({ player, itemId }) {
  if (BLURITE_LIMBS_IDS.has(itemId) && near(player.getLocation(), DORIC_ANVIL, 2)) award(player, TASK.bluriteLimbs);
}

function onHerbloreMade({ player, itemId }) {
  if (SARADOMIN_BREW_IDS.has(itemId) && inZone(player.getLocation(), FALADOR_EAST_BANK)) award(player, TASK.saradominBrew);
}

function onRunecraftingSuccess({ player, runeId, rolls, amountPerEssence }) {
  const made = Number(rolls) * Number(amountPerEssence);
  if (runeId === core.ItemIdentifiers.MIND_RUNE && made >= 140) award(player, TASK.mindRunes);
  else if (runeId === core.ItemIdentifiers.AIR_RUNE && made >= 252) award(player, TASK.airRunes);
}

function onWoodcuttingSuccess({ player, logId }) {
  if (!WILLOW_LOG_IDS.has(logId) || !inZone(player.getLocation(), TAVERLEY)) return;
  const choppedAt = Date.now();
  const previous = Number(player.getAttribute(WILLOW_CHOP_ATTRIBUTE) ?? 0);
  player.setAttribute(WILLOW_CHOP_ATTRIBUTE, choppedAt);
  if (!previous) DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.willow);
}

function onFiremakingSuccess({ player, itemId }) {
  if (!WILLOW_LOG_IDS.has(itemId) || !inZone(player.getLocation(), TAVERLEY)) return;
  const choppedAt = Number(player.getAttribute(WILLOW_CHOP_ATTRIBUTE) ?? 0);
  if (!choppedAt || Date.now() - choppedAt > WILLOW_CHOP_WINDOW_MS) return;
  player.setAttribute(WILLOW_CHOP_ATTRIBUTE, null);
  award(player, TASK.willow);
}

function onTeleportArrival({ player, name }) {
  if (String(name ?? "").trim().toLowerCase() !== "falador teleport") return;
  if (near(player.getLocation(), FALADOR_TELEPORT, 3)) award(player, TASK.faladorTeleport);
}

function onTelekineticGrab({ player, itemId, position }) {
  if (itemId !== WINE_OF_ZAMORAK_ID) return;
  if (near(position, CHAOS_TEMPLE, 6)) award(player, TASK.telegrabWine);
}

function onThievingDone({ player, kind, succeeded, npc }) {
  if (kind !== "pickpocket" || !succeeded || npcName(npc, player) !== "Guard") return;
  if (inZone(npc.getLocation(), FALADOR_CITY)) award(player, TASK.guard);
}

function onAgilityObstacle({ player, objectId }) {
  if (objectId === CRUMBLING_FALADOR_WALL) award(player, TASK.westernWall);
  else if (objectId === DWARVEN_MINE_CREVICE) award(player, TASK.crevice);
  else if (objectId === TAVERLEY_STRANGE_FLOOR) award(player, TASK.strangeFloor);
}

function wornName(player, slot) {
  const id = player.getEquipment().get(slot)?.getId?.() ?? -1;
  return String(core.CacheDefinitions.getItem(id)?.name ?? "");
}

function wearsAll(player, expected) {
  return Object.entries(expected).every(([slot, names]) => names.includes(wornName(player, core.Equipment[slot])));
}

const INITIATE_SET = {
  HEAD_SLOT: ["Initiate sallet"],
  BODY_SLOT: ["Initiate hauberk"],
  LEG_SLOT: ["Initiate cuisse"],
};
const PROSELYTE_SET = {
  HEAD_SLOT: ["Proselyte sallet"],
  BODY_SLOT: ["Proselyte hauberk"],
  LEG_SLOT: ["Proselyte cuisse", "Proselyte tasset"],
};

function onAltarPrayed({ player, objectId, location }) {
  if (!location) return;
  if (objectId === GUTHIX_ALTAR_LOC_ID && near(location, GUTHIX_ALTAR, 2) && wearsAll(player, INITIATE_SET)) {
    award(player, TASK.guthixAltar);
  } else if (objectId === PORT_SARIM_ALTAR_LOC_ID && near(location, PORT_SARIM_ALTAR, 2) && wearsAll(player, PROSELYTE_SET)) {
    award(player, TASK.portSarimPrayer);
  }
}

function onEquipmentChanged({ player }) {
  const head = player.getEquipment().get(core.Equipment.HEAD_SLOT)?.getId?.() ?? -1;
  if (head === DWARVEN_HELMET_ID && inZone(player.getLocation(), DWARVEN_MINE)) award(player, TASK.dwarvenHelmet);
}

function onEmote({ player, slot }) {
  if (slot === SKILLCAPE_EMOTE_SLOT && inZone(player.getLocation(), FALADOR_CASTLE_TOP)) award(player, TASK.capeEmote);
}

function onWarriorsGuildEntered({ player }) {
  award(player, TASK.warriorsGuild);
}

function onMiningGuildEntered({ player }) {
  const head = player.getEquipment().get(core.Equipment.HEAD_SLOT)?.getId?.() ?? -1;
  if (PROSPECTOR_HELMET_IDS.has(head) || GOLDEN_PROSPECTOR_HELMET_IDS.has(head)) award(player, TASK.miningGuild);
}

function onRatPitsEntered({ player }) {
  award(player, TASK.ratPits);
}

function hasSecurityBook(player) {
  if (player.getInventory().contains(SECURITY_BOOK_ID)) return true;
  return (player.getBanks?.() ?? []).some((bank) => bank?.getAmount?.(SECURITY_BOOK_ID) > 0);
}

function onDialogueCondition({ player, npcId, text }) {
  if (npcId !== SECURITY_GUARD_NPC_ID || typeof text !== "string") return null;
  if (text.includes("does not already have a security book")) return !hasSecurityBook(player);
  if (text.includes("already has a security book")) return hasSecurityBook(player);
  return null;
}

function onDialogueAction(event) {
  if (event.npcId !== SECURITY_GUARD_NPC_ID || !event.player) return;
  const givesBook = event.stepId === "Uj1iZS" || event.stepId === "ujI56T"
    || (event.action === "receive" && /security book/i.test(String(event.text ?? "")));
  if (!givesBook) return;
  if (!hasSecurityBook(event.player)) {
    event.player.getInventory().addItem(new core.Item(SECURITY_BOOK_ID, 1));
    if (!hasSecurityBook(event.player)) return;
  }
  award(event.player, TASK.securityBook);
}

function bind(registry) {
  api = registry;
  core = registry.core;
  api.onNpcDeath(onNpcDeath);
  api.onCustomEvent("shop:opened", onShopOpened);
  api.onCustomEvent("water-source:filled", onWaterFilled);
  api.onCustomEvent("runecrafting:tiara", onTiaraBound);
  api.onCustomEvent("oil-lights:lit", onLanternLit);
  api.onCustomEvent("motherlode:strut-repaired", onStrutRepaired);
  api.onCustomEvent("entrana:boarded", onEntranaBoarded);
  api.onCustomEvent("makeover:applied", onMakeoverApplied);
  api.onCustomEvent("skills:produced", onSkillsProduced);
  api.onCustomEvent("mining:success", onMiningSuccess);
  api.onCustomEvent("smithing:success", onSmithingSuccess);
  api.onCustomEvent("herblore:made", onHerbloreMade);
  api.onCustomEvent("runecrafting:success", onRunecraftingSuccess);
  api.onCustomEvent("woodcutting:success", onWoodcuttingSuccess);
  api.onCustomEvent("firemaking:success", onFiremakingSuccess);
  api.onCustomEvent("spell:teleport-arrival", onTeleportArrival);
  api.onCustomEvent("magic:telekinetic-grab", onTelekineticGrab);
  api.onCustomEvent("thieving:done", onThievingDone);
  api.onCustomEvent("agility:obstacle", onAgilityObstacle);
  api.onCustomEvent("altar:prayed", onAltarPrayed);
  api.onCustomEvent("equipment:changed", onEquipmentChanged);
  api.onCustomEvent("player:emote", onEmote);
  api.onCustomEvent("npc-dialogue:action", onDialogueAction);
  api.onNpcDialogueCondition(onDialogueCondition);
  api.onZoneEnter(WARRIORS_GUILD, onWarriorsGuildEntered);
  api.onZoneEnter(MINING_GUILD, onMiningGuildEntered);
  api.onZoneEnter(MINING_GUILD_WEST_ENTRANCE, onMiningGuildEntered);
  api.onZoneEnter(MINING_GUILD_SOUTH_ENTRANCE, onMiningGuildEntered);
  api.onZoneEnter(PORT_SARIM_RAT_PITS, onRatPitsEntered);
}

module.exports = {
  name: "FaladorDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    bind(api);
  },
  _test: {
    TASK, onNpcDeath, onShopOpened, onWaterFilled, onTiaraBound, onLanternLit, onStrutRepaired,
    onEntranaBoarded, onMakeoverApplied, onSkillsProduced, onMiningSuccess, onSmithingSuccess,
    onHerbloreMade, onRunecraftingSuccess, onWoodcuttingSuccess, onFiremakingSuccess,
    onTeleportArrival, onTelekineticGrab, onThievingDone, onAgilityObstacle, onAltarPrayed,
    onEquipmentChanged, onEmote, onWarriorsGuildEntered, onMiningGuildEntered, onRatPitsEntered,
    onDialogueCondition, onDialogueAction, hasSecurityBook, inZone, near, wearsAll,
    WILLOW_CHOP_ATTRIBUTE,
  },
};
