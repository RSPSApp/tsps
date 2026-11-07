const TABLETS = require("./data/teleport-tablets.json");

let core;
let pluginApi;

const HOUSE_TABLET = "teleport to house";
const HOUSE_TABLET_OPTIONS = new Set(["break", "inside", "outside"]);
/** A redirected house tablet (scroll of redirection) that finishes the Desert Diary's Pollnivneach task. */
const POLLNIVNEACH_REDIRECT = "pollnivneach teleport";
const POLLNIVNEACH_REDIRECT_TASK = "teleport-to-pollnivneach-with-a-redirected-telep";
// One bit per alternate tablet (in teleport-tablets.json order), set when Break goes to the alternate.
const ALTERNATES_ATTRIBUTE = "spell-teleports:alternates";
// The spell's own options (client script 2615 names op1/op3 "Cast").
const SPELL_ALTERNATE_OP = 2;
const SPELL_CONFIGURE_OP = 10;
const ALTERNATES = new Map(Object.entries(TABLETS.alternates).map(([name, data], index) => [name, { ...data, name, bit: 1 << index }]));
// The Wilderness teleports' op10 (client script magic_spellbook_modifyops): "Disable warning" while
// the spell's varbit is 1, "Enable warning" while it is 0. It toggles the varbit and never casts.
// One bit per spell, set while its warning is on.
const WILDERNESS_WARNINGS_ATTRIBUTE = "spell-teleports:wilderness-warnings";
const WILDERNESS_WARNINGS = new Map([
  ["dareeyak teleport", "dareeyak_teleport_warning"],
  ["carrallanger teleport", "carrallagar_teleport_warning"],
  ["annakarl teleport", "annakarl_teleport_warning"],
  ["ghorrock teleport", "ghorrock_teleport_warning"],
  ["teleport to target", "bounty_teleport_warning"],
].map(([name, varbit], index) => [name, { varbit, bit: 1 << index }]));

function spellName(event) {
  const itemId = event.itemId ?? -1;
  const packed = Number.isInteger(event.groupId) && Number.isInteger(event.childId)
    ? (event.groupId << 16) | (event.childId & 0xffff)
    : -1;
  return core.CacheDefinitions.getSpellName(event.buttonId, itemId)
    ?? core.CacheDefinitions.getSpellName(packed, itemId)
    ?? core.CacheDefinitions.getSpellName(event.childId ?? -1, itemId);
}

let spellDestinations = null;
let standardCentres = null;

/** A standard teleport lands on a random free tile within this many of its destination (rsprox captures). */
const LANDING_RADIUS = 2;

/**
 * Tablets share their spell's name ("Varrock teleport") and destination. Arceuus comes last
 * so its Ape Atoll teleport wins: the Ape Atoll tablet is the Arceuus one.
 */
function spellDestination(name) {
  spellDestinations ??= new Map([
    ...core.SpellTeleports.getTeleportDestinations(),
    ...core.LunarSpells.getTeleportDestinations(),
    ...core.ArceuusSpells.getTeleportDestinations(),
  ].map((spell) => [spell.name, spell.destination]));
  return spellDestinations.get(name);
}

const tile = (coordinates) => coordinates && new core.Location(...coordinates);

/**
 * Standard spellbook teleports (and their tablets) land anywhere in the 5x5 square around their
 * destination: rsprox captures of the Grand Exchange option (334 landings, x 3161-3165,
 * y 3476-3480) and of Varrock, Lumbridge, Falador, Camelot, Seers', Ardougne, Kourend and
 * Civitas illa Fortis; the Wiki maps Trollheim's as a square of radius 2. Blocked tiles are skipped.
 */
function landing(centre) {
  if (!centre) return centre;
  const tiles = [];
  for (let dx = -LANDING_RADIUS; dx <= LANDING_RADIUS; dx++) {
    for (let dy = -LANDING_RADIUS; dy <= LANDING_RADIUS; dy++) {
      const at = centre.transform(dx, dy);
      if (!core.RegionManager.blocked(at, null)) tiles.push(at);
    }
  }
  return tiles.length ? tiles[Math.floor(Math.random() * tiles.length)] : centre;
}

/** Where a standard spellbook teleport lands around, by spell name (not the house). */
function standardCentre(name) {
  standardCentres ??= new Map(core.SpellTeleports.getTeleportDestinations()
    .filter((spell) => spell.spellbook === core.MagicSpellbook.NORMAL && spell.name !== HOUSE_TABLET)
    .map((spell) => [spell.name, spell.destination]));
  return standardCentres.get(name);
}

function diaryComplete(player, diary) {
  const request = { player, diary: diary.key, tier: diary.tier, complete: false };
  pluginApi.emitCustomEvent("diary:is-complete", request);
  return request.complete;
}

const DIARY_TIERS = ["easy", "medium", "hard", "elite"];

/** As captured for Varrock: "the medium, hard or elite tier of the Varrock achievement diary". */
function diaryMessage(player, diary) {
  const tiers = DIARY_TIERS.slice(DIARY_TIERS.indexOf(diary.tier));
  const named = tiers.length > 1 ? `${tiers.slice(0, -1).join(", ")} or ${tiers.at(-1)}` : tiers[0];
  player.sendMessage(`You must complete the ${named} tier of the ${diary.name} achievement diary to use this feature.`);
}

const alternateChosen = (player, alternate) => (Number(player.getAttribute(ALTERNATES_ATTRIBUTE)) & alternate.bit) !== 0;

/**
 * Varrock, Camelot and Watchtower tablets: their own options pick the town or its alternate,
 * and Break follows Toggle once the alternate's diary is done. Null when the option is refused.
 */
function alternateDestination(player, name, option, alternate) {
  if (option === alternate.alternate.toLowerCase()) {
    if (diaryComplete(player, alternate.diary)) return tile(alternate.tile);
    diaryMessage(player, alternate.diary);
    return null;
  }
  if (option === "break" && alternateChosen(player, alternate) && diaryComplete(player, alternate.diary)) {
    return tile(alternate.tile);
  }
  return spellDestination(name);
}

/** The alternate's varbit (client script 2615 reads 1 as the alternate) follows the toggle. */
function sendAlternate(player, alternate) {
  const varbit = core.CacheDefinitions.getVarbitId(alternate.varbit);
  if (varbit != null) player.getPacketSender().sendVarbit(varbit, alternateChosen(player, alternate) ? 1 : 0);
}

function chooseAlternate(player, alternate, chosen) {
  const bits = Number(player.getAttribute(ALTERNATES_ATTRIBUTE)) || 0;
  player.setAttribute(ALTERNATES_ATTRIBUTE, chosen ? bits | alternate.bit : bits & ~alternate.bit);
  sendAlternate(player, alternate);
}

function toggleDestination(event, alternate) {
  const { player } = event;
  event.handled = true;
  if (!diaryComplete(player, alternate.diary)) {
    diaryMessage(player, alternate.diary);
    return;
  }
  chooseAlternate(player, alternate, !alternateChosen(player, alternate));
  const destination = alternateChosen(player, alternate) ? alternate.alternate : alternate.primary;
  player.sendMessage(`Your ${alternate.primary} teleport tablets will now take you to ${destination}.`);
}

/** A redirected house tablet goes back to being a Teleport to house tablet; the scroll is not returned. */
function revertTablet(event) {
  const { player } = event;
  event.handled = true;
  if (!player.getInventory().contains(event.itemId)) return;
  player.getInventory().deleteNumber(event.itemId, 1);
  player.getInventory().adds(core.ItemIdentifiers.TELEPORT_TO_HOUSE, 1);
}

function houseDestination(event, option) {
  if (!HOUSE_TABLET_OPTIONS.has(option)) return null;
  const request = { player: event.player, option, destination: null, onArrival: null };
  pluginApi.emitCustomEvent("construction:house-tablet", request);
  event.handled = true;
  return request.destination && { destination: request.destination, onArrival: request.onArrival ?? undefined };
}

/** Where a tablet's option goes, or null when it isn't a teleport option of a tablet we know. */
function tabletDestination(event, name, option) {
  if (name === HOUSE_TABLET) return houseDestination(event, option);
  const alternate = ALTERNATES.get(name);
  const known = option === "break" || (alternate && option === alternate.primary.toLowerCase())
    || (alternate && option === alternate.alternate.toLowerCase());
  if (!known) return null;
  const destination = alternate
    ? alternateDestination(event.player, name, option, alternate)
    : spellDestination(name) ?? tile(TABLETS.redirects[name]) ?? tile(TABLETS.tablets[name]);
  if (destination !== undefined) event.handled = true;
  // A tablet lands like its spell: the alternates' towns, and the standard spells' (not the Arceuus Ape Atoll).
  const square = alternate || standardCentre(name)?.equals(destination);
  return destination && { destination: square ? landing(destination) : destination };
}

/**
 * Teleport tablets, the house tablet (Construction says where the player's house is) and
 * teleport scrolls. The usual teleport rules (level 20 Wilderness, teleblock, busy) are checked
 * first, so a refused tablet or scroll is never used up.
 */
function useTablet(event) {
  const option = event.option?.toLowerCase() ?? "";
  const name = core.ItemDefinition.forId(event.itemId)?.getName?.()?.toLowerCase() ?? "";
  const scroll = TABLETS.scrolls[name];
  if (scroll) {
    if (option === "teleport") readScroll(event, tile(scroll));
    return;
  }
  if (option === "revert" && TABLETS.redirects[name]) return revertTablet(event);
  const alternate = ALTERNATES.get(name);
  if (alternate && option === "toggle") return toggleDestination(event, alternate);
  const target = tabletDestination(event, name, option);
  if (!target) return;
  const { player } = event;
  if (name === POLLNIVNEACH_REDIRECT) {
    const arrival = target.onArrival;
    target.onArrival = () => {
      pluginApi.emitCustomEvent("diary:task", { player, diary: "desert", task: POLLNIVNEACH_REDIRECT_TASK });
      arrival?.();
    };
  }
  if (!player.getInventory().contains(event.itemId) || !core.TeleportHandler.checkReqs(player, target.destination)) return;
  // OSRS uses the tablet up two ticks in, as it is absorbed (docs/teleport-tablets.md).
  const useUp = () => player.getInventory().deleteNumber(event.itemId, 1);
  core.TeleportHandler.teleport(player, target.destination, core.TeleportType.TELE_TAB, false, target.onArrival, useUp);
}

/** A teleport scroll is used up on the click (docs/teleport-tablets.md). */
function readScroll(event, destination) {
  const { player } = event;
  event.handled = true;
  if (!player.getInventory().contains(event.itemId) || !core.TeleportHandler.checkReqs(player, destination)) return;
  player.getInventory().deleteNumber(event.itemId, 1);
  core.TeleportHandler.teleport(player, destination, core.TeleportType.TELE_SCROLL, false);
}

function syncAlternates({ player }) {
  for (const alternate of ALTERNATES.values()) {
    if (alternateChosen(player, alternate)) sendAlternate(player, alternate);
  }
  for (const warning of WILDERNESS_WARNINGS.values()) {
    if (warningOn(player, warning)) sendWarning(player, warning);
  }
}

function warningOn(player, warning) {
  return ((Number(player.getAttribute(WILDERNESS_WARNINGS_ATTRIBUTE)) || 0) & warning.bit) !== 0;
}

function sendWarning(player, warning) {
  const varbit = core.CacheDefinitions.getVarbitId(warning.varbit);
  if (varbit != null) player.getPacketSender().sendVarbit(varbit, warningOn(player, warning) ? 1 : 0);
}

/** op10 on a Wilderness teleport: flip its warning (the client relabels the op from the varbit). */
function toggleWarning(event) {
  const warning = event.opId === SPELL_CONFIGURE_OP && WILDERNESS_WARNINGS.get(event.spellName?.trim().toLowerCase());
  if (!warning) return;
  event.handled = true;
  const bits = Number(event.player.getAttribute(WILDERNESS_WARNINGS_ATTRIBUTE)) || 0;
  event.player.setAttribute(WILDERNESS_WARNINGS_ATTRIBUTE, bits ^ warning.bit);
  sendWarning(event.player, warning);
}

/**
 * Configure on the spell (rsprox capture): "Spellbook/portal default: <current>", then
 * "Change to <other>" or "Cancel."; the change sets the varbit and confirms in the chatbox.
 */
function configureSpell(player, alternate) {
  if (!diaryComplete(player, alternate.diary)) {
    diaryMessage(player, alternate.diary);
    return;
  }
  const chosen = alternateChosen(player, alternate);
  const next = chosen ? alternate.configure.primary : alternate.configure.alternate;
  pluginApi.sendMultiChatboxPrompt(player, `Spellbook/portal default: ${chosen ? alternate.alternate : alternate.primary}`,
    next.change, () => {
      chooseAlternate(player, alternate, !chosen);
      player.sendMessage(next.message);
    },
    "Cancel.", () => {});
}

/**
 * Varrock, Camelot and Watchtower Teleport (client script 2615): op1 and op3 cast to the town
 * (op3 stands in for op1 once the alternate is the default), landing as every standard teleport
 * does; op2 casts to the alternate, behind the tablet's diary, and op10 configures.
 */
function castAlternate(event) {
  const { player } = event;
  const name = event.spellName?.trim().toLowerCase();
  const alternate = ALTERNATES.get(name);
  if (!alternate || (event.opId !== SPELL_ALTERNATE_OP && event.opId !== SPELL_CONFIGURE_OP)) {
    castStandard(event, name);
    return;
  }
  event.handled = true;
  if (event.opId === SPELL_CONFIGURE_OP) {
    configureSpell(player, alternate);
  } else if (diaryComplete(player, alternate.diary)) {
    core.SpellTeleports.handleSelf(player, name, landing(tile(alternate.tile)));
  } else {
    diaryMessage(player, alternate.diary);
  }
}

/**
 * Wiki (Standard spellbook): these teleports each require a quest's completion. The spells only; the tablets are
 * separate. TSPS wording for the refusal: the retail line has not been established.
 */
const QUEST_LOCKED_SPELLS = new Map([
  ["kourend castle teleport", { key: "client_of_kourend", name: "Client of Kourend" }],
  // Wiki (Ardougne teleport scroll): the spell is learned by reading Edmond's scroll, Plague City's stage 30.
  ["ardougne teleport", { key: "plague_city", name: "Plague City", stage: 30, unread: "You need to read Edmond's magic scroll to cast this spell." }],
  ["civitas illa fortis teleport", { key: "twilights_promise", name: "Twilight's Promise" }],
  ["trollheim teleport", { key: "eadgars_ruse", name: "Eadgar's Ruse" }],
]);

/** The standard spell requires the Awowogei rescue; the Arceuus spell and tablet are separate. */
function mayCastApeAtoll(player, name) {
  const locked = QUEST_LOCKED_SPELLS.get(name);
  if (locked && player.getSpellbook() === core.MagicSpellbook.NORMAL) {
    const quest = { player, key: locked.key, complete: false };
    pluginApi.emitCustomEvent("quest:is-complete", quest);
    if (!quest.complete) {
      player.sendMessage(`You need to complete ${locked.name} to cast this spell.`);
      return false;
    }
    if (locked.stage === undefined) return true;
    const stage = { player, key: locked.key, stage: null };
    pluginApi.emitCustomEvent("quest:get-stage", stage);
    if (Number(stage.stage) >= locked.stage) return true;
    player.sendMessage(locked.unread);
    return false;
  }
  if (name !== "ape atoll teleport" || player.getSpellbook() !== core.MagicSpellbook.NORMAL) return true;
  const rescue = { player, rescue: "king-awowogei", complete: false };
  pluginApi.emitCustomEvent("recipe-for-disaster:rescue-status", rescue);
  if (rescue.complete) return true;
  // Older completed RFD saves may not have each individual rescue bit.
  const quest = { player, key: "recipe_for_disaster", complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", quest);
  if (quest.complete) return true;
  // TSPS fallback wording: the exact retail refusal has not been established.
  player.sendMessage("You must free King Awowogei before casting this spell.");
  return false;
}

/** A standard spellbook teleport, on a tile of its landing square; anything else is left to the usual cast. */
function castStandard(event, name) {
  if (!mayCastApeAtoll(event.player, name)) { event.handled = true; return; }
  const centre = standardCentre(name);
  if (centre && core.SpellTeleports.handleSelf(event.player, name, landing(centre))) event.handled = true;
}

function castSpell(event) {
  const name = spellName(event)?.trim().toLowerCase();
  if (!mayCastApeAtoll(event.player, name)) { event.handled = true; return; }
  const destination = landing(standardCentre(name));
  if (core.SpellTeleports.handleSelf(event.player, name, destination)) {
    event.handled = true;
  }
}

module.exports = {
  name: "SpellTeleports",
  register(api) {
    core = api.core;
    pluginApi = api;
    api.persistAttribute(ALTERNATES_ATTRIBUTE, 0);
    api.persistAttribute(WILDERNESS_WARNINGS_ATTRIBUTE, 0);
    api.onItemAction(useTablet);
    api.onPlayerLogin(syncAlternates);
    api.onSpellCast(toggleWarning);
    api.onSpellCast(castAlternate);
    api.onInterfaceActionClick(castSpell);
  },
};
