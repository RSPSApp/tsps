/**
 * Kourend & Kebos diary credit for the skills/combat finishing group:
 * - Dig up some Saltpetre (easy), from the deposit handler.
 * - Mine some Volcanic Sulphur (medium), from a successful sulphur rock.
 * - Create an Ape Atoll teleport tablet (elite), from the Arceuus lectern.
 * - Create your own Battlestaff from scratch within the Farming Guild (elite), from fletching
 *   bark harvested from the player's own celastrus tree into a battlestaff inside the guild.
 *
 * The Sand Crab (easy) credit stays in DormantNpcs, which owns the crab pair and its area check.
 */
const DIARY = "kourend";
const CELASTRUS_HARVESTED_ATTRIBUTE = "kourend:celastrus-harvested";
const TASKS = {
  saltpetre: "dig-up-some-saltpetre",
  sulphur: "mine-some-volcanic-sulphur",
  apeAtollTablet: "create-an-ape-atoll-teleport-tablet",
  battlestaff: "create-your-own-battlestaff-from-scratch-within",
};
/** The Farming Guild's planting area, as its contracts bound it (plugins/skills/farming/Guild.Farming.js). */
const FARMING_GUILD = [1216, 1279, 3712, 3775];

let api;
let item;

function eligible(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0
    && !player.isDyingReturn?.() && player.getPrivateArea?.() == null;
}

function inside(location, [minX, maxX, minY, maxY]) {
  if (!location) return false;
  return location.getZ() === 0
    && location.getX() >= minX && location.getX() <= maxX
    && location.getY() >= minY && location.getY() <= maxY;
}

function complete(player, task) {
  if (!eligible(player)) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function saltpetreDug({ player, amount }) {
  if (Number.isInteger(amount) && amount > 0) complete(player, TASKS.saltpetre);
}

function mined({ player, itemId }) {
  if (itemId === item.VOLCANIC_SULPHUR) complete(player, TASKS.sulphur);
}

function tabletMade({ player, itemId }) {
  if (itemId === item.APE_ATOLL_TELEPORT) complete(player, TASKS.apeAtollTablet);
}

function harvested({ player, crop, patch, itemId, amount }) {
  if (!eligible(player) || crop !== "CELASTRUS" || itemId !== item.CELASTRUS_BARK || !(amount > 0)) return;
  if (patch?.z === 0 && patch.x >= FARMING_GUILD[0] && patch.x <= FARMING_GUILD[1]
    && patch.y >= FARMING_GUILD[2] && patch.y <= FARMING_GUILD[3]) {
    player.setAttribute(CELASTRUS_HARVESTED_ATTRIBUTE, true);
  }
}

function fletched({ player, itemId }) {
  if (itemId === item.BATTLESTAFF && player.getAttribute(CELASTRUS_HARVESTED_ATTRIBUTE) === true
    && inside(player?.getLocation?.(), FARMING_GUILD)) complete(player, TASKS.battlestaff);
}

module.exports = {
  name: "KourendDiarySkillsFinish",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    item = pluginApi.core.ItemIdentifiers;
    api.persistAttribute(CELASTRUS_HARVESTED_ATTRIBUTE, false);
    api.onCustomEvent("farming:harvested", harvested);
    api.onCustomEvent("mining:saltpetre", saltpetreDug);
    api.onCustomEvent("mining:success", mined);
    api.onCustomEvent("construction:tablet-made", tabletMade);
    api.onCustomEvent("fletching:made", fletched);
  },
  _test: { TASKS, FARMING_GUILD, inside, saltpetreDug, mined, tabletMade, fletched },
};
