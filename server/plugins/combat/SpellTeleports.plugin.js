const TABLETS = require("./data/teleport-tablets.json");

let core;
let pluginApi;

const HOUSE_TABLET = "teleport to house";
const HOUSE_TABLET_OPTIONS = new Set(["break", "inside", "outside"]);
/**
 * The house tablet's Group option goes to a Group Ironman teammate's house (Wiki). This server has
 * no Ironman groups, so every player gets live's refusal: the line on the click tick, the tablet
 * kept and no teleport (rsprox.net capture 2919, tick 2179).
 */
const HOUSE_TABLET_GROUP = "group";
const NOT_IN_GROUP = "You are not in an Ironman Group.";
/** A redirected house tablet (scroll of redirection) that finishes the Desert Diary's Pollnivneach task. */
const POLLNIVNEACH_REDIRECT = "pollnivneach teleport";
const POLLNIVNEACH_REDIRECT_TASK = "teleport-to-pollnivneach-with-a-redirected-telep";
// One bit per alternate tablet (in teleport-tablets.json order), set when Break goes to the alternate.
const ALTERNATES_ATTRIBUTE = "spell-teleports:alternates";
// The spell's own options (client script 2615 names op1/op3 "Cast").
const SPELL_ALTERNATE_OP = 2;
const SPELL_CONFIGURE_OP = 10;
// Teleport to House's op2 (interface magic_spellbook:teleport_to_your_house): "Outside", whatever the house's setting.
const HOUSE_OUTSIDE_OP = 2;
const ALTERNATES = new Map(Object.entries(TABLETS.alternates).map(([name, data], index) => [name, { ...data, name, bit: 1 << index }]));
/**
 * Wilderness teleport warnings: each is an All Settings row (setting id) over its varbit, saved by the Settings
 * plugin, so the row and the spellbook's op10 change the same value. A spell warns while its varbit is 1 (op10 then
 * reads "Disable warning", client script magic_spellbook_modifyops), and is on by default. A tablet warns while its
 * varbit is 0 (its row's struct reads it inverted), so it is on by default too.
 */
const SPELL_WARNINGS = new Map([
  ["teleport to target", { setting: 60, varbit: "bounty_teleport_warning" }],
  ["dareeyak teleport", { setting: 61, varbit: "dareeyak_teleport_warning" }],
  ["carrallanger teleport", { setting: 62, varbit: "carrallagar_teleport_warning" }],
  ["annakarl teleport", { setting: 63, varbit: "annakarl_teleport_warning" }],
  ["ghorrock teleport", { setting: 64, varbit: "ghorrock_teleport_warning" }],
].map(([name, warning]) => [name, { ...warning, warns: 1 }]));
// `deep` picks the warning's line. Ours: the Ice Plateau, Cemetery and Wilderness crabs tablets, which land past
// level 30, use the deep line, and Carrallanger (level 19) the other.
const TABLET_WARNINGS = new Map([
  ["ice plateau teleport", { setting: 67, varbit: "teletab_ice_plateau_warning", deep: true }],
  ["cemetery teleport", { setting: 68, varbit: "teletab_cemetery_warning", deep: true }],
  ["wilderness crabs teleport", { setting: 69, varbit: "teletab_wildycrabs_warning", deep: true }],
  ["dareeyak teleport", { setting: 70, varbit: "teletab_dareeyak_warning", deep: false }],
  ["carrallanger teleport", { setting: 71, varbit: "teletab_carrallangar_warning", deep: false }],
  ["annakarl teleport", { setting: 72, varbit: "teletab_annakarl_warning", deep: true }],
  ["ghorrock teleport", { setting: 73, varbit: "teletab_ghorrock_warning", deep: true }],
].map(([name, warning]) => [name, { ...warning, warns: 0 }]));
// All Settings' buttons: Enable/Disable Wilderness teleport warnings (77/76) and tablet warnings (75/74).
const WARNING_BUTTONS = new Map([
  [77, { warnings: SPELL_WARNINGS, on: true }],
  [76, { warnings: SPELL_WARNINGS, on: false }],
  [75, { warnings: TABLET_WARNINGS, on: true }],
  [74, { warnings: TABLET_WARNINGS, on: false }],
]);
const SPELL_WARNING = ["Are you sure you wish to teleport to the Wilderness?", "Yes, teleport me now.", "No, I want to stay here."];
const tabletWarning = (warning) => [warning.deep ? "Teleport into the DEEP wilderness?" : "Teleport into the wilderness?", "Yes", "No"];
// The spells' warnings were kept here before All Settings had them (one bit per spell, off by default). Its "on"
// bits match the new default and "off" was only the old default, so it is cleared at login.
const LEGACY_WARNINGS_ATTRIBUTE = "spell-teleports:wilderness-warnings";

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
  // The Watchtower's tower top and Ape Atoll's landing keep their one tile (docs/teleport-tablets.md): around them the
  // square holds tiles the player can't walk out of (outside the tower's walls; a sealed pocket on Ape Atoll).
  if (FIXED_LANDINGS.some((name) => standardCentre(name)?.equals(centre))) return centre;
  const tiles = [];
  for (let dx = -LANDING_RADIUS; dx <= LANDING_RADIUS; dx++) {
    for (let dy = -LANDING_RADIUS; dy <= LANDING_RADIUS; dy++) {
      const at = centre.transform(dx, dy);
      if (!core.RegionManager.blocked(at, null)) tiles.push(at);
    }
  }
  return tiles.length ? tiles[Math.floor(Math.random() * tiles.length)] : centre;
}

/** Standard teleports that land on their own tile, not the 5x5 square (and their tablets, Break included). */
const FIXED_LANDINGS = ["watchtower teleport", "ape atoll teleport"];

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
  const inventory = player.getInventory();
  if (!inventory.contains(event.itemId)) return;
  // Tablets stack, so reverting one of several frees no slot: the house tablet needs room, or it was lost.
  const last = inventory.getAmount(event.itemId) === 1;
  if (!last && inventory.getAddableAmount(new core.Item(core.ItemIdentifiers.TELEPORT_TO_HOUSE, 1)) < 1) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  inventory.deleteNumber(event.itemId, 1);
  inventory.adds(core.ItemIdentifiers.TELEPORT_TO_HOUSE, 1);
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
  if (name === HOUSE_TABLET && option === HOUSE_TABLET_GROUP) return refuseGroupHouse(event);
  const alternate = ALTERNATES.get(name);
  if (alternate && option === "toggle") return toggleDestination(event, alternate);
  const target = tabletDestination(event, name, option);
  if (!target) return;
  const { player } = event;
  const locked = tabletQuestLock(player, name);
  if (locked) return player.sendMessage(locked);
  if (name === POLLNIVNEACH_REDIRECT) {
    const arrival = target.onArrival;
    target.onArrival = () => {
      pluginApi.emitCustomEvent("diary:task", { player, diary: "desert", task: POLLNIVNEACH_REDIRECT_TASK });
      arrival?.();
    };
  }
  const usable = () => player.getInventory().contains(event.itemId) && core.TeleportHandler.checkReqs(player, target.destination);
  if (!usable()) return;
  // OSRS uses the tablet up two ticks in, as it is absorbed (docs/teleport-tablets.md).
  const useUp = () => player.getInventory().deleteNumber(event.itemId, 1);
  // The Wilderness warning asks first, then any other (the boat-at-sea warning).
  const breakTablet = () => core.TeleportHandler.confirm(player, target.destination,
    () => core.TeleportHandler.teleport(player, target.destination, core.TeleportType.TELE_TAB, false, target.onArrival, useUp), 20, { item: event.itemId });
  const warning = TABLET_WARNINGS.get(name);
  if (!warning || !warningOn(player, warning)) return breakTablet();
  const [title, yes, no] = tabletWarning(warning);
  pluginApi.sendMultiChatboxPrompt(player, title, yes, () => usable() && breakTablet(), no, () => {});
}

function refuseGroupHouse(event) {
  event.handled = true;
  event.player.sendMessage(NOT_IN_GROUP);
}

/** The clicked scroll in the inventory, as a "teleport-scroll:read" source. */
function inventoryScroll(player, itemId) {
  return {
    item: itemId,
    has: () => player.getInventory().contains(itemId),
    spend: () => {
      if (!player.getInventory().contains(itemId)) return false;
      player.getInventory().deleteNumber(itemId, 1);
      return true;
    },
  };
}

/**
 * A teleport scroll is used up on the click (docs/teleport-tablets.md). `source` is where the
 * scroll comes from: the inventory, or a scroll store such as the Master scroll book. Its `item`
 * is what a warning's yes checks the player still carries (the scroll, or the book).
 */
function readScroll(event, destination, source = inventoryScroll(event.player, event.itemId)) {
  const { player } = event;
  event.handled = true;
  if (!source.has() || !core.TeleportHandler.checkReqs(player, destination)) return;
  core.TeleportHandler.confirm(player, destination, () => {
    if (!source.spend()) return;
    core.TeleportHandler.teleport(player, destination, core.TeleportType.TELE_SCROLL, false);
  }, 20, { item: source.item ?? event.itemId });
}

/** "teleport-scroll:read" { player, itemId, source }: a stored scroll read like the inventory one. */
function readStoredScroll(request) {
  if (request.handled) return;
  const name = core.ItemDefinition.forId(request.itemId)?.getName?.()?.toLowerCase() ?? "";
  const scroll = TABLETS.scrolls[name];
  if (scroll) readScroll(request, tile(scroll), request.source);
}

function syncAlternates({ player }) {
  for (const alternate of ALTERNATES.values()) {
    if (alternateChosen(player, alternate)) sendAlternate(player, alternate);
  }
}

function clearLegacyWarnings({ player }) {
  if (player.getAttribute(LEGACY_WARNINGS_ATTRIBUTE)) player.setAttribute(LEGACY_WARNINGS_ATTRIBUTE, 0);
}

function warningOn(player, warning) {
  const varbit = core.CacheDefinitions.getVarbitId(warning.varbit);
  return varbit != null && player.getPacketSender().getVarbit(varbit) === warning.warns;
}

/** Through the Settings plugin, which sends and saves the row's varbit. */
function setWarning(player, warning, on) {
  pluginApi.emitCustomEvent("settings:set", { player, settingId: warning.setting, value: on ? warning.warns : 1 - warning.warns });
}

/** op10 on a Wilderness teleport: flip its warning (the client relabels the op from the varbit). */
function toggleWarning(event) {
  const warning = event.opId === SPELL_CONFIGURE_OP && SPELL_WARNINGS.get(event.spellName?.trim().toLowerCase());
  if (!warning) return;
  event.handled = true;
  setWarning(event.player, warning, !warningOn(event.player, warning));
}

/** A Wilderness teleport spell about to be cast (nothing used yet): with its warning on, it waits for a yes. */
function confirmSpell(request) {
  const warning = SPELL_WARNINGS.get(request.name);
  if (request.handled || !warning || !warningOn(request.player, warning)) return;
  request.handled = true;
  const [title, yes, no] = SPELL_WARNING;
  pluginApi.sendMultiChatboxPrompt(request.player, title, yes, () => request.proceed(), no, () => {});
}

/** All Settings' enable/disable-all buttons set every spell's, or every tablet's, warning. */
function setAllWarnings(request) {
  const button = WARNING_BUTTONS.get(request.settingId);
  if (request.handled || !button) return;
  request.handled = true;
  for (const warning of button.warnings.values()) setWarning(request.player, warning, button.on);
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
 * Wiki (Standard spellbook): these teleports each require a quest's completion. The spells; the tablets are
 * QUEST_LOCKED_TABLETS. TSPS wording for the refusal: the retail line has not been established.
 */
const QUEST_LOCKED_SPELLS = new Map([
  ["kourend castle teleport", { key: "client_of_kourend", name: "Client of Kourend" }],
  // Wiki (Ardougne teleport scroll): the spell is learned by reading Edmond's scroll, Plague City's stage 30.
  ["ardougne teleport", { key: "plague_city", name: "Plague City", stage: 30, unread: "You need to read Edmond's magic scroll to cast this spell." }],
  ["civitas illa fortis teleport", { key: "twilights_promise", name: "Twilight's Promise" }],
  ["trollheim teleport", { key: "eadgars_ruse", name: "Eadgar's Ruse" }],
]);

/**
 * The refusal for a quest-locked standard teleport the player hasn't unlocked, or null. `action` ends the line
 * ("cast this spell", or "direct this teleport" for the house portals).
 */
function questLockRefusal(player, name, action) {
  const locked = QUEST_LOCKED_SPELLS.get(name);
  if (!locked) return null;
  const quest = { player, key: locked.key, complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", quest);
  if (!quest.complete) return `You need to complete ${locked.name} to ${action}.`;
  if (locked.stage === undefined) return null;
  const stage = { player, key: locked.key, stage: null };
  pluginApi.emitCustomEvent("quest:get-stage", stage);
  if (Number(stage.stage) >= locked.stage) return null;
  return locked.unread.replace("cast this spell", action);
}

/**
 * Wiki (Ardougne, Kourend Castle and Civitas illa Fortis teleport tablets): using the tablet requires the spell's
 * quest; Ardougne's needs Plague City finished but not Edmond's scroll read, and Trollheim's tablet needs nothing.
 */
const QUEST_LOCKED_TABLETS = ["ardougne teleport", "kourend castle teleport", "civitas illa fortis teleport"];

/**
 * The refusal for a quest-locked tablet, or null. Recorded: "You need to have completed the Plague City quest to use
 * this spell." (rsprox_transcripts/242/900268.txt) and the Twilight's Promise line (242/900261.txt), tablet kept.
 */
function tabletQuestLock(player, name) {
  if (!QUEST_LOCKED_TABLETS.includes(name)) return null;
  const locked = QUEST_LOCKED_SPELLS.get(name);
  const quest = { player, key: locked.key, complete: false };
  pluginApi.emitCustomEvent("quest:is-complete", quest);
  return quest.complete ? null : `You need to have completed the ${locked.name} quest to use this spell.`;
}

/**
 * Wiki (Portal chamber, Portal nexus): directing a portal "requires the same Magic level and quest requirements as
 * casting the spell". The house portals ask here so the two share one list; sets `event.refusal`.
 */
function teleportQuestLock(event) {
  // Other answerers (a quest's own lock, as Watchtower) may refuse too: the first refusal stands.
  event.refusal ??= questLockRefusal(event.player, event.name?.trim().toLowerCase(), event.action ?? "cast this spell");
}

/**
 * Teleport to House without a house went to Rimmington and spent its runes. It is refused first, with the house
 * tablet's line (Construction answers "construction:owns-house"), so nothing is spent.
 */
function hasHouse(player) {
  const request = { player, owns: true };
  pluginApi.emitCustomEvent("construction:owns-house", request);
  return request.owns !== false;
}

/** The standard spell requires the Awowogei rescue; the Arceuus spell and tablet are separate. */
function mayCastApeAtoll(player, name) {
  if (name === HOUSE_TABLET && player.getSpellbook() === core.MagicSpellbook.NORMAL && !hasHouse(player)) {
    player.sendMessage("You do not own a house. Speak to an Estate agent to buy one.");
    return false;
  }
  if (QUEST_LOCKED_SPELLS.has(name) && player.getSpellbook() === core.MagicSpellbook.NORMAL) {
    const refusal = questLockRefusal(player, name, "cast this spell");
    if (refusal) player.sendMessage(refusal);
    return !refusal;
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

/**
 * Teleport to House's "Outside" lands at the house portal in the house's town (Construction says where), and tells
 * Construction on arrival not to take the player in. Cast is left to the usual cast: it follows the house's setting.
 */
function castHouseOutside(event, name) {
  const request = { player: event.player, option: "outside", destination: null, onArrival: null };
  pluginApi.emitCustomEvent("construction:house-tablet", request);
  if (!request.destination || core.SpellTeleports.handleSelf(event.player, name, request.destination, "outside")) {
    event.handled = true;
  }
}

/** A standard spellbook teleport, on a tile of its landing square; anything else is left to the usual cast. */
function castStandard(event, name) {
  if (!mayCastApeAtoll(event.player, name)) { event.handled = true; return; }
  if (name === HOUSE_TABLET && event.opId === HOUSE_OUTSIDE_OP && event.player.getSpellbook() === core.MagicSpellbook.NORMAL) {
    castHouseOutside(event, name);
    return;
  }
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

/**
 * "spell:landing-tile" { name, alternate?, tile }: where a teleport that goes where the spell `name` goes lands (the
 * house portals and nexus). `tile` becomes a tile of the spell's landing square, or of its alternate's
 * (`alternate: true`); it is left as it was for a spell that lands on its own tile.
 */
function landingTile(request) {
  const alternate = request.alternate ? ALTERNATES.get(request.name) : null;
  const centre = alternate ? tile(alternate.tile) : standardCentre(request.name);
  if (centre) request.tile = landing(centre);
}

module.exports = {
  name: "SpellTeleports",
  description: "Teleport tablets and spell teleports, including house tablets and redirected scrolls, from the teleport-tablets data file.",
  register(api) {
    core = api.core;
    pluginApi = api;
    api.persistAttribute(ALTERNATES_ATTRIBUTE, 0);
    api.persistAttribute(LEGACY_WARNINGS_ATTRIBUTE, 0);
    api.onItemAction(useTablet);
    api.onPlayerLogin(syncAlternates);
    api.onPlayerLogin(clearLegacyWarnings);
    api.onSpellCast(toggleWarning);
    api.onSpellCast(castAlternate);
    api.onInterfaceActionClick(castSpell);
    api.onCustomEvent("magic:teleport-quest-lock", teleportQuestLock);
    api.onCustomEvent("spell:landing-tile", landingTile);
    api.onCustomEvent("spell:teleport-confirm", confirmSpell);
    api.onCustomEvent("settings:setting-clicked", setAllWarnings);
    api.onCustomEvent("teleport-scroll:read", readStoredScroll);
  },
};
