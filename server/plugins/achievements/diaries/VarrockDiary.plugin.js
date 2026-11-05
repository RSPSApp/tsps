/**
 * Varrock Diary tasks that follow from another plugin's successful action. The catalogue and
 * progress dispatch live in AchievementDiaries; this file only names the task each action earns.
 *
 * Tasks whose action already lives elsewhere are credited there: the tea stall
 * (Actions.AchievementDiaries), the Stronghold's second level, Stray Dogs, the Varrock rooftop
 * lap, canoes, Edgeville's pipe and Vannaka, the Sawmill's planks, and the skull sceptre.
 *
 * OSRS Wiki: Varrock Diary. Locations are the cache's object placements (`yarn dump:loc`).
 */
const DIARY = "varrock";
const DiaryProgress = require("./Progress.AchievementDiaries");
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);

const TASK = {
  iron: "mine-some-iron-in-the-south-east-mining-patch-ne",
  dyingTree: "chop-down-a-dying-tree-in-the-lumber-yard",
  fence: "jump-over-the-fence-south-of-varrock",
  trout: "catch-some-trout-in-the-river-lum-at-barbarian-v",
  earthRunes: "craft-some-earth-runes-from-essence",
  browseThessalia: "browse-thessalia-s-store",
  newspaper: "buy-a-newspaper",
  bowl: "spin-a-bowl-on-the-pottery-wheel-and-fire-it-in",
  varrockTeleport: "cast-the-teleport-to-varrock-spell",
  spiritTree: "use-the-spirit-tree-north-of-varrock",
  balloon: "use-the-balloon-to-travel-from-varrock",
  digsitePendant: "teleport-to-the-digsite-using-a-digsite-pendant",
  emotes: "perform-the-4-emotes-from-the-stronghold-of-secu",
  haigHalem: "speak-to-haig-halen-after-obtaining-at-least-50",
  paddewwa: "teleport-to-paddewwa",
  yewBurn: "chop-some-yew-logs-in-varrock-and-burn-them-at-t",
  orlando: "speak-to-orlando-smith-when-you-have-achieved-15",
  superCombat: "create-a-super-combat-potion-in-varrock-west-ban",
  summerPie: "bake-a-summer-pie-in-the-cooking-guild",
  earthRunes100: "craft-100-or-more-earth-runes-simultaneously-fro",
  lunarPlanks: "use-lunar-magic-to-make-20-mahogany-planks-at-th",
  runeDarts: "smith-and-fletch-ten-rune-darts-within-varrock",
};

/** The yew task resets when any other diary task is completed or updated (Wiki). */
const YEW_CHOPPED_ATTRIBUTE = "varrock-diary:yew-chopped";
const BOWL_SPUN_ATTRIBUTE = "varrock-diary:bowl-spun";
const SOS_EMOTES_ATTRIBUTE = "varrock-diary:sos-emotes";
const DART_TIPS_ATTRIBUTE = "varrock-diary:rune-dart-tips";
const DARTS_ATTRIBUTE = "varrock-diary:rune-darts";
const LUNAR_PLANKS_ATTRIBUTE = "varrock-diary:lunar-planks";
const DART_TARGET = 10;
const LUNAR_PLANK_TARGET = 20;

/** Cache object placements: `yarn dump:loc "Iron rocks"`, "Dying tree", "Yew tree". */
const SOUTH_EAST_MINE = { minX: 3278, maxX: 3296, minY: 3360, maxY: 3378, z: 0 };
const LUMBER_YARD = { minX: 3290, maxX: 3325, minY: 3488, maxY: 3520, z: 0 };
const BARBARIAN_VILLAGE_RIVER = { minX: 3090, maxX: 3125, minY: 3410, maxY: 3445, z: 0 };
const BARBARIAN_VILLAGE_POTTERY = { minX: 3078, maxX: 3093, minY: 3400, maxY: 3416, z: 0 };
const VARROCK_CITY = { minX: 3150, maxX: 3280, minY: 3360, maxY: 3520, z: 0 };
const SOUTH_VARROCK_FENCE = { minX: 3236, maxX: 3244, minY: 3329, maxY: 3340, z: 0 };
const VARROCK_CHURCH_TOP = { minX: 3245, maxX: 3265, minY: 3470, maxY: 3490, z: 3 };
const VARROCK_WEST_BANK = { minX: 3179, maxX: 3191, minY: 3431, maxY: 3446, z: 0 };
const COOKING_GUILD = { minX: 3136, maxX: 3153, minY: 3446, maxY: 3460, z: 1 };

/** The Grand Exchange's spirit tree is the one "north of Varrock". */
const GRAND_EXCHANGE_TREE = [3184, 3509];
const NEWSPAPER_PRICE = 50;
const HAIG_KUDOS = 50;
const ORLANDO_KUDOS = 153;
/** Emote slots of Flap, Slap Head, Idea and Stamp (plugins/interface/data/emotes.json). */
const STRONGHOLD_EMOTES = new Set([28, 29, 30, 31]);

let api;

function inside(location, bounds) {
  if (!location) return false;
  return location.getZ() === bounds.z
    && location.getX() >= bounds.minX && location.getX() <= bounds.maxX
    && location.getY() >= bounds.minY && location.getY() <= bounds.maxY;
}

function near(location, [x, y], distance) {
  return !!location && Math.abs(location.getX() - x) <= distance && Math.abs(location.getY() - y) <= distance;
}

const publicAt = (player, bounds) => player?.getPrivateArea?.() === null && inside(player.getLocation?.(), bounds);

function done(player, task, extra = {}) {
  if (!player) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task, ...extra });
}

function nameOf(definition) {
  return definition?.getName?.() ?? "";
}

/** The rock's own name, so another ore's success at the same site cannot count. */
function mined({ player, object, oreId, success }) {
  if (!success || oreId !== api.core.ItemIdentifiers.IRON_ORE) return;
  if (nameOf(object?.getDefinition?.()) !== "Iron rocks" || !publicAt(player, SOUTH_EAST_MINE)) return;
  done(player, TASK.iron);
}

function chopped({ player, object, success }) {
  if (!success) return;
  const name = nameOf(object?.getDefinition?.());
  if (name === "Dying tree" && publicAt(player, LUMBER_YARD)) {
    done(player, TASK.dyingTree);
  } else if (name === "Yew tree" && publicAt(player, VARROCK_CITY)) {
    if (player.getAttribute(YEW_CHOPPED_ATTRIBUTE) !== true) {
      player.setAttribute(YEW_CHOPPED_ATTRIBUTE, true);
      DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.yewBurn);
    }
  }
}

function fenceJumped({ player, shortcut }) {
  if (shortcut !== "Fence (Varrock)" || !publicAt(player, SOUTH_VARROCK_FENCE)) return;
  done(player, TASK.fence);
}

function fished({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.RAW_TROUT) return;
  if (!publicAt(player, BARBARIAN_VILLAGE_RIVER)) return;
  done(player, TASK.trout);
}

function runesCrafted({ player, runeId, rolls, amountPerEssence }) {
  if (runeId !== api.core.ItemIdentifiers.EARTH_RUNE) return;
  done(player, TASK.earthRunes);
  if ((Number(rolls) || 0) * (Number(amountPerEssence) || 0) >= 100) done(player, TASK.earthRunes100);
}

function potteryMade({ player, itemId, kind }) {
  if (kind !== "pottery" || !publicAt(player, BARBARIAN_VILLAGE_POTTERY)) return;
  const ids = api.core.ItemIdentifiers;
  if (itemId === ids.UNFIRED_BOWL && player.getAttribute(BOWL_SPUN_ATTRIBUTE) !== true) {
    player.setAttribute(BOWL_SPUN_ATTRIBUTE, true);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.bowl);
  }
  if (itemId === ids.BOWL && player.getAttribute(BOWL_SPUN_ATTRIBUTE) === true) {
    player.setAttribute(BOWL_SPUN_ATTRIBUTE, false);
    done(player, TASK.bowl);
  }
}

function dialogueAction(event) {
  const { player, action, target } = event;
  if (!player) return;
  if (action === "open_shop" && target === "Thessalia's Fine Clothes.") {
    done(player, TASK.browseThessalia);
  }
  if (action === "receive" && event.npcId === api.core.NpcIdentifiers.BENNY && /newspaper/i.test(event.text ?? "")) {
    buyNewspaper(event);
  }
}

/** Benny's "Sure, here you go..." step: the Wiki transcript has no item/coin action of its own. */
function buyNewspaper(event) {
  const { player } = event;
  event.handled = true;
  const inventory = player.getInventory();
  const ids = api.core.ItemIdentifiers;
  if (inventory.getAmount(ids.COINS) < NEWSPAPER_PRICE || inventory.getFreeSlots() === 0) {
    event.end = true;
    return;
  }
  inventory.delete(ids.COINS, NEWSPAPER_PRICE);
  inventory.adds(ids.NEWSPAPER, 1);
  done(player, TASK.newspaper);
}

/** Benny's coin guard, so the "no cash" branch is not the unresolved default. */
function dialogueCondition(event) {
  if (event.npcId !== api.core.NpcIdentifiers.BENNY) return null;
  const text = String(event.text ?? "").toLowerCase();
  const enough = event.player.getInventory().getAmount(api.core.ItemIdentifiers.COINS) >= NEWSPAPER_PRICE;
  if (text.includes("does not have at least 50 coins")) return !enough;
  if (text.includes("has at least 50 coins")) return enough;
  return null;
}

function spoken(event) {
  const { player, npcId } = event;
  if (!player) return;
  const ids = api.core.NpcIdentifiers;
  if (npcId === ids.CURATOR_HAIG_HALEN && kudos(player) >= HAIG_KUDOS) done(player, TASK.haigHalem);
  if (npcId === ids.ORLANDO_SMITH && kudos(player) >= ORLANDO_KUDOS) done(player, TASK.orlando);
}

function kudos(player) {
  const request = { player, kudos: 0 };
  api.emitCustomEvent("museum:get-kudos", request);
  return Number(request.kudos) || 0;
}

function teleported({ player, name }) {
  if (!player || player.getHitpoints?.() <= 0 || player.isDyingReturn?.() === true) return;
  const spell = String(name ?? "").trim().toLowerCase();
  if (spell === "varrock teleport") done(player, TASK.varrockTeleport);
  if (spell === "paddewwa teleport") done(player, TASK.paddewwa);
}

function spiritTree({ player, tree }) {
  if (!player || player.getPrivateArea?.() !== null) return;
  if (tree === "Grand Exchange" || near(player.getLocation?.(), GRAND_EXCHANGE_TREE, 8)) done(player, TASK.spiritTree);
}

function balloon({ player, station, origin, opensRoute }) {
  if (!player || station === "varrock" || origin?.station !== "varrock" || origin?.isPublic !== true) return;
  if (opensRoute === true || player.getHitpoints?.() <= 0 || player.isDyingReturn?.() === true) return;
  done(player, TASK.balloon);
}

function jewelleryTeleport({ player, key, label }) {
  if (!player || key !== "digsite" || label !== "Digsite") return;
  if (player.getHitpoints?.() <= 0 || player.isDyingReturn?.() === true) return;
  done(player, TASK.digsitePendant);
}

function emote({ player, slot }) {
  if (!player || !STRONGHOLD_EMOTES.has(slot)) return;
  const seen = new Set(Array.isArray(player.getAttribute(SOS_EMOTES_ATTRIBUTE)) ? player.getAttribute(SOS_EMOTES_ATTRIBUTE) : []);
  const alreadySeen = seen.has(slot);
  seen.add(slot);
  player.setAttribute(SOS_EMOTES_ATTRIBUTE, [...seen]);
  if (seen.size === STRONGHOLD_EMOTES.size) done(player, TASK.emotes);
  else if (!alreadySeen) DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.emotes);
}

function burned({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.YEW_LOGS) return;
  if (!publicAt(player, VARROCK_CHURCH_TOP) || player.getAttribute(YEW_CHOPPED_ATTRIBUTE) !== true) return;
  player.setAttribute(YEW_CHOPPED_ATTRIBUTE, false);
  done(player, TASK.yewBurn);
}

/** The Wiki: completing or updating any other diary task resets the yew progress. */
function resetYewOnOtherTask(event) {
  if (!event?.player || (event.diary === DIARY && event.task === TASK.yewBurn)) return;
  event.player.setAttribute(YEW_CHOPPED_ATTRIBUTE, false);
}

function potionMade({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.SUPER_COMBAT_POTION_4_ || !publicAt(player, VARROCK_WEST_BANK)) return;
  done(player, TASK.superCombat);
}

function cooked({ player, itemId }) {
  if (itemId !== api.core.ItemIdentifiers.SUMMER_PIE || !publicAt(player, COOKING_GUILD)) return;
  done(player, TASK.summerPie);
}

function dartTips({ player, itemId, amount, kind }) {
  if (kind !== "smith" || itemId !== api.core.ItemIdentifiers.RUNE_DART_TIP || !publicAt(player, VARROCK_CITY)) return;
  countDarts(player, DART_TIPS_ATTRIBUTE, Number(amount) || 1);
}

function dartsFletched({ player, itemId, amount }) {
  if (itemId !== api.core.ItemIdentifiers.RUNE_DART || !publicAt(player, VARROCK_CITY)) return;
  countDarts(player, DARTS_ATTRIBUTE, Number(amount) || 1);
}

function countDarts(player, attribute, amount = 1) {
  const previous = Number(player.getAttribute(attribute)) || 0;
  const next = Math.min(DART_TARGET, (Number(player.getAttribute(attribute)) || 0) + amount);
  player.setAttribute(attribute, next);
  const complete = (Number(player.getAttribute(DART_TIPS_ATTRIBUTE)) || 0) >= DART_TARGET
    && (Number(player.getAttribute(DARTS_ATTRIBUTE)) || 0) >= DART_TARGET;
  if (complete) done(player, TASK.runeDarts);
  else if (next > previous) DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.runeDarts);
}

/** Plank Make's repeat task: one event per genuine log conversion, an end event on interruption. */
function lunarPlank({ player, plankId }) {
  if (plankId !== api.core.ItemIdentifiers.MAHOGANY_PLANK || !publicAt(player, LUMBER_YARD)) return;
  const made = (Number(player.getAttribute(LUNAR_PLANKS_ATTRIBUTE)) || 0) + 1;
  if (made >= LUNAR_PLANK_TARGET) {
    player.setAttribute(LUNAR_PLANKS_ATTRIBUTE, 0);
    done(player, TASK.lunarPlanks);
  } else {
    player.setAttribute(LUNAR_PLANKS_ATTRIBUTE, made);
    DiaryProgress.notifyTaskProgress(player, DIARY_DATA, TASK.lunarPlanks);
  }
}

function lunarPlankBatchEnded({ player }) {
  player?.setAttribute?.(LUNAR_PLANKS_ATTRIBUTE, 0);
}

/** A cast does not survive logout, so a relog starts no batch part-way through. */
function resetLunarBatch({ player }) {
  player?.setAttribute?.(LUNAR_PLANKS_ATTRIBUTE, 0);
}

module.exports = {
  name: "VarrockDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    api = registry;
    api.persistAttribute(YEW_CHOPPED_ATTRIBUTE, false);
    api.persistAttribute(BOWL_SPUN_ATTRIBUTE, false);
    api.persistAttribute(SOS_EMOTES_ATTRIBUTE, []);
    api.persistAttribute(DART_TIPS_ATTRIBUTE, 0);
    api.persistAttribute(DARTS_ATTRIBUTE, 0);
    api.persistAttribute(LUNAR_PLANKS_ATTRIBUTE, 0);
    api.onCustomEvent("mining:attempt", mined);
    api.onCustomEvent("woodcutting:attempt", chopped);
    api.onCustomEvent("fishing:success", fished);
    api.onCustomEvent("agility:obstacle", fenceJumped);
    api.onCustomEvent("runecrafting:success", runesCrafted);
    api.onCustomEvent("skills:produced", potteryMade);
    api.onCustomEvent("npc-dialogue:action", dialogueAction);
    api.onCustomEvent("npc-dialogue:line", spoken);
    api.onNpcDialogueCondition(dialogueCondition);
    api.onCustomEvent("spell:teleport-arrival", teleported);
    api.onCustomEvent("spirit-trees:travelled", spiritTree);
    api.onCustomEvent("balloon-transport:passenger-arrival", balloon);
    api.onCustomEvent("jewellery:teleport-arrival", jewelleryTeleport);
    api.onCustomEvent("player:emote", emote);
    api.onCustomEvent("firemaking:success", burned);
    api.onCustomEvent("diary:task", resetYewOnOtherTask);
    api.onCustomEvent("herblore:made", potionMade);
    api.onCustomEvent("cooking:success", cooked);
    api.onCustomEvent("skills:produced", dartTips);
    api.onCustomEvent("fletching:made", dartsFletched);
    api.onCustomEvent("magic:plank-make", lunarPlank);
    api.onCustomEvent("magic:plank-make-end", lunarPlankBatchEnded);
    api.onPlayerLogin(resetLunarBatch);
  },
  _test: {
    TASK, SOUTH_EAST_MINE, LUMBER_YARD, BARBARIAN_VILLAGE_RIVER, VARROCK_CITY, SOUTH_VARROCK_FENCE,
    VARROCK_CHURCH_TOP, VARROCK_WEST_BANK, COOKING_GUILD, STRONGHOLD_EMOTES,
    mined, chopped, fenceJumped, fished, runesCrafted, potteryMade, dialogueAction, dialogueCondition,
    spoken, teleported, spiritTree, balloon, jewelleryTeleport, emote, burned,
    resetYewOnOtherTask, potionMade, cooked, dartTips, dartsFletched, lunarPlank,
    lunarPlankBatchEnded, resetLunarBatch, buyNewspaper,
  },
};
