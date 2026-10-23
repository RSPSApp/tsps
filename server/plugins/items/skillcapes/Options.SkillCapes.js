/**
 * The skillcapes' own options (Wiki: Cape of Accomplishment; messages and menus from rsprox
 * captures where they were recorded):
 *
 * - Agility "Stamina Boost": once a day, full run energy and a minute of the stamina effect
 *   ("You feel reinvigorated.").
 * - Herblore "Search": a pestle and mortar (animation searchcape_pestle).
 * - Fletching "Search": a mithril grapple and a bronze crossbow, three times a day (varbit
 *   free_grapple; animation searchcape_grapple).
 * - Magic "Spellbook": change spellbook up to five times a day ("Choose spellbook: (5/5 left)",
 *   varbit sb_swap_check); "Check" says how many changes were used.
 * - Ranging "Commune": the undead chicken's metal-gathering, on or off. Worn, the cape saves
 *   ammunition as Ava's accumulator (72%), or 80% once Vorkath's head has been used on a Ranging
 *   or max cape; the head is used up and the upgrade covers every such cape the player owns.
 * - Defence "Toggle Effect" (the ring of life effect, varbit rol_toggle) and "Toggle Respawn"
 *   (the save teleports to the Ardougne marketplace after the medium Ardougne Diary).
 *
 * The max cape's Features and Spellbook menus call the same handlers.
 */
const Capes = require("./Common.SkillCapes");

const STAMINA_KEY = "stamina";
const GRAPPLE_KEY = "grapple";
const SPELLBOOK_KEY = "spellbook";
const STAMINA_PER_DAY = 1;
const GRAPPLES_PER_DAY = 3;
const SPELLBOOKS_PER_DAY = 5;
const STAMINA_DURATION_MS = 60_000;
const FULL_RUN_ENERGY = 100;
const RED = "<col=ef1020>";
const SPELLBOOK_VARBIT = "sb_swap_check";
const GRAPPLE_VARBIT = "free_grapple";
const ROL_TOGGLE_VARBIT = "rol_toggle";
const ROL_OFF_ATTRIBUTE = "skillcapes:ring-of-life-off";
const ROL_ARDOUGNE_ATTRIBUTE = "skillcapes:ring-of-life-ardougne";
const JUNK_OFF_ATTRIBUTE = Capes.JUNK_OFF_ATTRIBUTE;
const ARDOUGNE_MARKET = [2662, 3305, 0];
const VORKATH_UPGRADE_ATTRIBUTE = Capes.VORKATH_UPGRADE_ATTRIBUTE;
const ACCUMULATOR_RECOVERY = 72;
const ASSEMBLER_RECOVERY = 80;

const BOOKS = [
  { name: "Standard", key: "NORMAL" },
  { name: "Ancient", key: "ANCIENT" },
  { name: "Lunar", key: "LUNAR" },
  { name: "Arceuus", key: "ARCEUUS" },
];

let api;

function varbit(player, name, value) {
  const id = Capes.core.CacheDefinitions.getVarbitId(name);
  if (Number.isInteger(id)) player.getPacketSender().sendVarbit(id, value);
}

function syncVarbits({ player }) {
  varbit(player, SPELLBOOK_VARBIT, Capes.dailyUses(player, SPELLBOOK_KEY));
  varbit(player, GRAPPLE_VARBIT, Capes.dailyUses(player, GRAPPLE_KEY));
  varbit(player, ROL_TOGGLE_VARBIT, player.getAttribute(ROL_OFF_ATTRIBUTE) === true ? 1 : 0);
}

// --- Stamina Boost --------------------------------------------------------------------------

function staminaBoost(player) {
  if (Capes.dailyUses(player, STAMINA_KEY) >= STAMINA_PER_DAY) {
    player.sendMessage("You have already used your cape's stamina boost today.");
    return;
  }
  Capes.useDaily(player, STAMINA_KEY);
  api.emitCustomEvent("potions:apply-stamina", { player, energy: FULL_RUN_ENERGY, durationMs: STAMINA_DURATION_MS });
  player.sendMessage("You feel reinvigorated.");
}

// --- Search ---------------------------------------------------------------------------------

function searchPestle(player) {
  const { ItemIdentifiers, Animation } = Capes.core;
  if (player.getInventory().getFreeSlots() === 0) {
    player.sendMessage("You need a free inventory space to search your cape.");
    return;
  }
  player.performAnimation(new Animation(Capes.seqId("searchcape_pestle")));
  player.getInventory().adds(ItemIdentifiers.PESTLE_AND_MORTAR, 1);
  player.sendMessage(`You search the cape and find a ${RED}Pestle and mortar</col>.`);
}

function searchGrapple(player) {
  const { ItemIdentifiers, Animation } = Capes.core;
  const used = Capes.dailyUses(player, GRAPPLE_KEY);
  if (used >= GRAPPLES_PER_DAY) {
    player.sendMessage("You have already searched your cape three times today.");
    return;
  }
  if (player.getInventory().getFreeSlots() < 2) {
    player.sendMessage("You need two free inventory spaces to search your cape.");
    return;
  }
  player.performAnimation(new Animation(Capes.seqId("searchcape_grapple")));
  player.getInventory().adds(ItemIdentifiers.MITH_GRAPPLE, 1);
  player.getInventory().adds(ItemIdentifiers.BRONZE_CROSSBOW, 1);
  varbit(player, GRAPPLE_VARBIT, Capes.useDaily(player, GRAPPLE_KEY));
  player.sendMessage(`You search the cape and find a ${RED}Mithril grapple</col> and a ${RED}Bronze crossbow</col>.`);
}

/** The max cape's Search: "What would you like to search for?" */
function searchMenu(player) {
  api.sendMultiChatboxPrompt(player, "What would you like to search for?",
    "Pestle and Mortar", () => searchPestle(player),
    "Mith Grapple & Crossbow", () => searchGrapple(player),
    "Cancel", () => {});
}

// --- Spellbook ------------------------------------------------------------------------------

function currentBook(player) {
  const { MagicSpellbook } = Capes.core;
  return BOOKS.find((book) => MagicSpellbook[book.key] === player.getSpellbook()) ?? BOOKS[0];
}

function spellbookChanges(player) {
  return `${RED}You have changed your spellbook ${Capes.dailyUses(player, SPELLBOOK_KEY)}/${SPELLBOOKS_PER_DAY} times today.</col>`;
}

function changeSpellbook(player, name) {
  const { MagicSpellbook, Autocasting, Skill } = Capes.core;
  const book = BOOKS.find((candidate) => candidate.name.toLowerCase() === String(name).toLowerCase());
  if (!book) return;
  if (book === currentBook(player)) {
    Capes.messageBox(player, "You're already on that spellbook.");
    return;
  }
  if (Capes.dailyUses(player, SPELLBOOK_KEY) >= SPELLBOOKS_PER_DAY) {
    player.sendMessage(spellbookChanges(player));
    return;
  }
  if (book.key === "LUNAR" && Capes.baseLevel(player, Skill.DEFENCE) < 40) {
    player.sendMessage("You need at least level 40 Defence to use the Lunar spellbook.");
    return;
  }
  player.setSpellbook(MagicSpellbook[book.key]);
  Autocasting.setAutocast(player, null);
  player.getPacketSender().sendTabInterface(6, player.getSpellbook().getInterfaceId());
  varbit(player, SPELLBOOK_VARBIT, Capes.useDaily(player, SPELLBOOK_KEY));
  player.sendMessage(`${book.name} spellbook activated.`);
  player.sendMessage(spellbookChanges(player));
}

function spellbookMenu(player) {
  const left = SPELLBOOKS_PER_DAY - Capes.dailyUses(player, SPELLBOOK_KEY);
  const current = currentBook(player);
  const pairs = BOOKS.filter((book) => book !== current).flatMap((book) => [book.name, () => changeSpellbook(player, book.name)]);
  api.sendMultiChatboxPrompt(player, `Choose spellbook: (${left}/${SPELLBOOKS_PER_DAY} left)`, ...pairs, "Cancel", () => {});
}

function checkSpellbook(player) {
  player.sendMessage(spellbookChanges(player));
}

// --- Commune (Ranging) ----------------------------------------------------------------------

function commune(player) {
  const gathering = player.getAttribute(JUNK_OFF_ATTRIBUTE) !== true;
  Capes.talk(player, [
    { statement: gathering
      ? "The undead chicken can protect some of your ammunition while you're ranging, and will also gather random metal items for you."
      : "The undead chicken understands that you currently don't want it to accumulate random metal items while you've got it equipped." },
    () => api.sendMultiChatboxPrompt(player, gathering ? "Ask it to stop gathering junk?" : "Ask it to start gathering junk?",
      "Yes", () => player.setAttribute(JUNK_OFF_ATTRIBUTE, gathering),
      "No", () => {}),
  ]);
}

// --- Ring of life (Defence) -----------------------------------------------------------------

function toggleEffect(player) {
  const enabled = player.getAttribute(ROL_OFF_ATTRIBUTE) !== true;
  Capes.talk(player, [
    { statement: `Your cape will${enabled ? " " : " not "}currently teleport you to safety should your health reach dangerous levels.` },
    () => api.sendMultiChatboxPrompt(player, `Would you like to ${enabled ? "disable" : "enable"} this feature?`,
      "Yes", () => {
        player.setAttribute(ROL_OFF_ATTRIBUTE, enabled);
        varbit(player, ROL_TOGGLE_VARBIT, enabled ? 1 : 0);
        Capes.messageBox(player, `Your cape will follow your instructions to${enabled ? " not " : " "}save you when your health is low.`);
      },
      "No", () => {}),
  ]);
}

function ardougneDiaryDone(player) {
  const request = { player, diary: "ardougne", tier: "medium", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function toggleRespawn(player) {
  if (!ardougneDiaryDone(player)) {
    player.sendMessage("You need to complete the medium Ardougne Diary to change where your cape takes you.");
    return;
  }
  api.sendMultiChatboxPrompt(player, "Choose a respawn destination.",
    "Ardougne", () => player.setAttribute(ROL_ARDOUGNE_ATTRIBUTE, true),
    "Default", () => player.setAttribute(ROL_ARDOUGNE_ATTRIBUTE, false));
}

/** The max cape's "Ring of Life settings". */
function ringOfLifeMenu(player) {
  api.sendMultiChatboxPrompt(player, "Select an option",
    "Ring of Life effect", () => toggleEffect(player),
    "Ring of life respawn", () => toggleRespawn(player),
    "Cancel", () => {});
}

/**
 * "skillcape:ring-of-life" `{ player, active, destination }`: whether a worn cape (Defence or
 * max) saves the player, and where to (null: their respawn point).
 */
function ringOfLife(request) {
  const { player } = request;
  if (!player || !Capes.hasPerk(player, "DEFENCE") || player.getAttribute(ROL_OFF_ATTRIBUTE) === true) return;
  request.active = true;
  if (player.getAttribute(ROL_ARDOUGNE_ATTRIBUTE) === true) request.destination = ARDOUGNE_MARKET;
}

/** "skillcape:ammo-recovery" `{ player, recovery }`: a worn Ranging (or max) cape's share. */
function ammoRecovery(request) {
  const { player } = request;
  if (!player || request.recovery != null) return;
  // Max capes combined with an Ava's device keep that device's own rate (Wiki: Max cape).
  const combined = Capes.COMBINED_BY_CAPE.get(Capes.capeSlotId(player));
  if (combined) {
    if (/assembler/i.test(combined.label)) request.recovery = ASSEMBLER_RECOVERY;
    else if (/accumulator/i.test(combined.label)) request.recovery = ACCUMULATOR_RECOVERY;
    return;
  }
  if (!Capes.hasPerk(player, "RANGED")) return;
  request.recovery = player.getAttribute(VORKATH_UPGRADE_ATTRIBUTE) === true ? ASSEMBLER_RECOVERY : ACCUMULATOR_RECOVERY;
}

function upgradeWithVorkathHead(event) {
  const { player, usedItemId, usedWithItemId } = event;
  const head = Capes.objId("vorkath_head");
  const other = usedItemId === head ? usedWithItemId : usedWithItemId === head ? usedItemId : null;
  if (other === null || !Capes.capeHasPerk(other, "RANGED") || Capes.COMBINED_BY_CAPE.has(other)) return;
  event.handled = true;
  if (player.getAttribute(VORKATH_UPGRADE_ATTRIBUTE) === true) {
    player.sendMessage("Your cape has already been upgraded.");
    return;
  }
  player.getInventory().deleteNumber(head, 1);
  player.setAttribute(VORKATH_UPGRADE_ATTRIBUTE, true);
  player.sendMessage("You use Vorkath's head on your cape. It will now save more of your ammunition.");
}

/** "skillcape:accumulator-junk" `{ player, gathering }`: the Commune setting. */
function accumulatorJunk(request) {
  if (request?.player) request.gathering = request.player.getAttribute(JUNK_OFF_ATTRIBUTE) !== true;
}

const HANDLERS = {
  AGILITY: { "Stamina Boost": staminaBoost },
  HERBLORE: { Search: searchPestle },
  FLETCHING: { Search: searchGrapple },
  MAGIC: { Spellbook: spellbookMenu, Check: checkSpellbook },
  RANGED: { Commune: commune },
  DEFENCE: { "Toggle Effect": toggleEffect, "Toggle Respawn": toggleRespawn },
};

function capeOption(event) {
  const cape = Capes.CAPE_BY_ITEM.get(event.itemId);
  const handlers = cape && HANDLERS[cape.skillKey];
  if (!handlers) return;
  const { option, sub } = Capes.itemOption(event);
  const handler = handlers[option];
  if (!handler) return;
  event.handled = true;
  if (cape.skillKey === "MAGIC" && sub) changeSpellbook(event.player, sub);
  else handler(event.player);
}

module.exports = function attachOptions(pluginApi) {
  api = pluginApi;
  api.persistAttribute(ROL_OFF_ATTRIBUTE, false);
  api.persistAttribute(ROL_ARDOUGNE_ATTRIBUTE, false);
  api.persistAttribute(JUNK_OFF_ATTRIBUTE, false);
  api.persistAttribute(VORKATH_UPGRADE_ATTRIBUTE, false);
  api.persistAttribute(Capes.DAILY_ATTRIBUTE, null);
  api.onItemAction(capeOption);
  // A mounted cape (house cape hanger) runs its option as the item would: { player, itemId, option }.
  api.onCustomEvent("skillcape:operate", (request) => { if (!request.handled) capeOption(request); });
  api.onCustomEvent("skillcape:ring-of-life", ringOfLife);
  api.onCustomEvent("skillcape:accumulator-junk", accumulatorJunk);
  api.onCustomEvent("skillcape:ammo-recovery", ammoRecovery);
  api.onItemOnItem(upgradeWithVorkathHead);
  api.onPlayerLogin(syncVarbits);
};

Object.assign(module.exports, {
  staminaBoost, searchPestle, searchGrapple, searchMenu, spellbookMenu, changeSpellbook, checkSpellbook, commune,
  ringOfLifeMenu, toggleEffect, toggleRespawn,
  _test: { capeOption, changeSpellbook, staminaBoost, searchGrapple, ringOfLife, ammoRecovery, upgradeWithVorkathHead, BOOKS },
});
