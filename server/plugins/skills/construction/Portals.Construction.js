"use strict";

const { api, Skill, TeleportHandler, TeleportType, Wilderness, SpellTeleports, LunarSpells, ArceuusSpells, SpellbookLocks, MagicSpellbook, ObjectIdentifiers, ItemIdentifiers, ItemDefinition } = require("./Core.Construction");
const Data = require("./Data.Construction");
const Instance = require("./Instance.Construction");
const aliases = { moonclan: "LUNAR_ISLE", "ape atoll": "MARIM", "kourend castle": "KOUREND", "fenkenstrain's castle": "FENKENSTRAINS_CASTLE", waterbirth: "WATERBIRTH_ISLAND", watchtower: "YANILLE_WATCHTOWER", barbarian: "BARBARIAN_OUTPOST", khazard: "PORT_KHAZARD" };
function houseDestinations() {
  // Reuse the spell system's costs and destinations; home/house spells cannot be directed.
  return [...SpellTeleports.getTeleportDestinations(), ...LunarSpells.getTeleportDestinations().map(data => ({ ...data, spellbook: MagicSpellbook.LUNAR })), ...ArceuusSpells.getTeleportDestinations().map(data => ({ ...data, arceuus: true, name: data.name === "ape atoll teleport" ? "ape atoll dungeon teleport" : data.name }))]
    .filter(data => data.runes.length && data.name !== "teleport to house")
    .map(data => {
      const name = data.name.replace(/ teleport$/, "");
      const key = aliases[name] ?? name.replace(/ /g, "_").toUpperCase();
      const ids = ObjectIdentifiers;
      // Revision 237 names the mahogany Watchtower model "Yanille Portal".
      const portalIds = name === "watchtower"
        ? [ObjectIdentifiers.YANILLE_WATCHTOWER_PORTAL, ObjectIdentifiers.YANILLE_PORTAL_2, ObjectIdentifiers.YANILLE_WATCHTOWER_PORTAL_2]
        : [ids[`${key}_PORTAL`], ids[`${key}_PORTAL_2`], ids[`${key}_PORTAL_3`]];
      return { ...data, portalIds };
    });
}

// Wiki (Portal chamber): bank notes are accepted for Marim's 100 bananas, so any mix of noted and unnoted bananas pays
// (`ids`, the notes first); quantities stay unchanged.
function directingCost(destination, nexus) {
  const multiplier = nexus ? 1000 : 100;
  return destination.runes.map(rune => {
    const id = rune.getId();
    const ids = [id];
    if (!nexus && destination.name === "ape atoll teleport" && id === ItemIdentifiers.BANANA) {
      const noteId = ItemDefinition.forId(id).getNoteId();
      if (noteId >= 0) ids.unshift(noteId);
    }
    return { id: ids[0], ids, amount: rune.getAmount() * multiplier };
  });
}

function heldFor(inventory, { ids }) {
  return ids.reduce((sum, id) => sum + inventory.getAmount(id), 0);
}

/** Takes one cost line, from its first id onward (noted bananas before unnoted ones). */
function payCost(inventory, { ids, amount }) {
  let left = amount;
  for (const id of ids) {
    const take = Math.min(left, inventory.getAmount(id));
    if (take > 0) inventory.delete(id, take);
    left -= take;
  }
}

/**
 * Where a portal to the spell `name` lands: like the spell, anywhere in its landing square (SpellTeleports), or its
 * alternate's square with `alternate`; else on `fallback`.
 */
function landingTile(name, fallback, alternate = false) {
  const request = { name, alternate, tile: fallback };
  api.emitCustomEvent("spell:landing-tile", request);
  return request.tile ? request.tile.clone() : request.tile;
}

function current(player, house, furniture) {
  return player.getPrivateArea() === house && house.save.rooms.flat(2).some(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture));
}

const DIRECT_ACTION = "direct this teleport";

/**
 * Wiki (Portal chamber): directing "requires the same Magic level and quest requirements as casting the spell", and the
 * owner needn't be on that spellbook "provided they have unlocked it". So: the book's own quest (core SpellbookLocks;
 * Desert Treasure I, Lunar Diplomacy), an Arceuus teleport's quest, then the standard spells' list (SpellTeleports).
 */
function questLockRefusal(player, name) {
  const destination = houseDestinations().find(data => data.name === name);
  if (!destination) return null;
  const book = destination.spellbook === undefined ? null : SpellbookLocks.lockingQuest(player, destination.spellbook);
  if (book) return `You need to complete ${book.name} to ${DIRECT_ACTION}.`;
  if (destination.quest) {
    const query = { player, key: destination.quest.key, complete: false };
    api.emitCustomEvent("quest:is-complete", query);
    if (!query.complete) return `You need to complete ${destination.quest.name} to ${DIRECT_ACTION}.`;
  }
  const lock = { player, name, action: DIRECT_ACTION, refusal: null };
  api.emitCustomEvent("magic:teleport-quest-lock", lock);
  return lock.refusal;
}

/** "barrows teleport" as the refusal names it: "Barrows". */
function destinationTitle(name) {
  return name.replace(/ teleport$/, "").replace(/(^| )([a-z])/g, (match, space, letter) => space + letter.toUpperCase());
}

/**
 * An Arceuus destination before speaking to Tyss (core SpellbookLocks): recorded as two game messages,
 * rsprox_transcripts/227/910262.txt tick 12262 ("to get to get to" as live has it), then the Tyss line.
 */
function arceuusPortalRefused(player, name) {
  const destination = houseDestinations().find(data => data.name === name);
  if (!destination?.arceuus || !SpellbookLocks.arceuusLocked(player, MagicSpellbook.ARCEUUS)) return false;
  player.sendMessage(`You can't create this portal to get to get to ${destinationTitle(name)}`);
  player.sendMessage(SpellbookLocks.ARCEUUS_LOCKED_MESSAGE);
  return true;
}

// The ordinary Ape Atoll destination requires its RFD rescue, including on older completed saves.
function mayConfigureHouseDestination(player, name) {
  if (arceuusPortalRefused(player, name)) return false;
  const refusal = questLockRefusal(player, name);
  if (refusal) { player.sendMessage(refusal); return false; }
  if (name !== "ape atoll teleport") return true;
  const rescue = { player, rescue: "king-awowogei", complete: false };
  api.emitCustomEvent("recipe-for-disaster:rescue-status", rescue);
  if (rescue.complete) return true;
  const quest = { player, key: "recipe_for_disaster", complete: false };
  api.emitCustomEvent("quest:is-complete", quest);
  if (quest.complete) return true;
  // TSPS fallback: the retail refusal text has not been established.
  player.sendMessage("You must free King Awowogei before configuring this teleport.");
  return false;
}

function configureHouseDestination(player, house, furniture, name) {
  if (house.owner !== player || !current(player, house, furniture)) return false;
  const nexus = furniture.hotspotKey === "PORTAL_NEXUS";
  if (!nexus && !furniture.buildableKey.endsWith("_PORTAL_FRAME")) return false;
  if (!nexus) {
    const room = house.save.rooms.flat(2).find(room => Object.values(room?.furnitureByLocation ?? {}).includes(furniture));
    if (!Object.values(room?.furnitureByLocation ?? {}).some(value => value.hotspotKey === "TELEPORT_FOCUS")) {
      player.sendMessage("Build a teleportation focus in this room first.");
      return false;
    }
  }
  const destination = houseDestinations().find(data => data.name === name);
  if (!destination || (!nexus && !destination.portalIds.every(Number.isInteger))) return false;
  const level = nexus ? player.getSkillManager().getMaxLevel(Skill.MAGIC) : player.getSkillManager().getCurrentLevel(Skill.MAGIC);
  if (level < destination.level) { player.sendMessage(`You need Magic level ${destination.level} to direct this teleport.`); return false; }
  const known = furniture.destinations ?? [];
  if (known.includes(name)) { player.sendMessage("That destination is already configured."); return false; }
  const limit = furniture.buildableKey === "MARBLE_PORTAL_NEXUS" ? 4 : furniture.buildableKey === "GILDED_PORTAL_NEXUS" ? 8 : Infinity;
  if (nexus && known.length >= limit) { player.sendMessage("Upgrade your nexus or remove a destination first."); return false; }
  if (!mayConfigureHouseDestination(player, destination.name)) return false;
  const cost = directingCost(destination, nexus);
  const inventory = player.getInventory();
  if (cost.some(entry => heldFor(inventory, entry) < entry.amount)) { player.sendMessage("You do not have all the required runes in your inventory."); return false; }
  for (const entry of cost) payCost(inventory, entry);
  furniture.destinations = nexus ? [...known, name] : [name];
  if (!nexus) {
    const tier = furniture.buildableKey.startsWith("TEAK") ? 0 : furniture.buildableKey.startsWith("MAHOGANY") ? 1 : 2;
    furniture.displayObjectId = destination.portalIds[tier];
    player.getSkillManager().addExperiences(Skill.MAGIC, destination.experience * 5);
  }
  house.owner.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
  for (const occupant of house.getPlayers()) house.rebuild(occupant, house.buildingMode);
  player.sendMessage(`Added ${name}.`);
  return true;
}

function chooseDestination(player, house, furniture, mode, page = 0) {
  if (!current(player, house, furniture)) return;
  const nexus = furniture.hotspotKey === "PORTAL_NEXUS";
  const destinations = houseDestinations().filter(data => mode === "add" ? !(furniture.destinations ?? []).includes(data.name) && (nexus || data.portalIds.every(Number.isInteger)) : furniture.destinations?.includes(data.name));
  if (!destinations.length) { player.sendMessage("There are no destinations to select."); return; }
  const options = [];
  for (const destination of destinations.slice(page * 4, page * 4 + 4)) options.push(destination.name, () => {
    if (!current(player, house, furniture)) return;
    if (mode === "teleport") {
      const travel = () => {
        if (current(player, house, furniture) && furniture.destinations?.includes(destination.name) && TeleportHandler.checkReqs(player, destination.destination)) {
          TeleportHandler.teleport(player, landingTile(destination.name, destination.destination), TeleportType.NORMAL, false);
          api.emitCustomEvent("construction:portal", { player, destination: destination.name });
        }
      };
      if (Wilderness.isInLocation(destination.destination)) api.sendMultiChatboxPrompt(player, "This destination is in the Wilderness. Continue?", "Yes", travel, "No", () => {});
      else travel();
    } else if (house.owner === player) {
      if (mode === "add") {
        for (const { id, amount } of directingCost(destination, nexus)) player.sendMessage(`${amount} x ${ItemDefinition.forId(id).getName()}`);
        api.sendMultiChatboxPrompt(player, "Consume these runes to direct the teleport?", "Yes", () => { configureHouseDestination(player, house, furniture, destination.name); }, "No", () => {});
      } else api.sendMultiChatboxPrompt(player, "Remove this teleport without refunding runes?", "Yes", () => {
        if (house.owner !== player || !current(player, house, furniture)) return;
        furniture.destinations = furniture.destinations?.filter(name => name !== destination.name);
        player.setAttribute(Data.HOUSE_ATTRIBUTE, house.save);
      }, "No", () => {});
    }
  });
  if ((page + 1) * 4 < destinations.length) options.push("More destinations", () => chooseDestination(player, house, furniture, mode, page + 1));
  api.sendMultiChatboxPrompt(player, mode === "teleport" ? "Choose a destination" : "Configure destinations", ...options);
}

function useHousePortal(event) {
  const house = event.player.getPrivateArea();
  if (!(house instanceof Instance.PlayerHouseInstance)) return false;
  const furniture = house.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (!furniture) return false;
  const action = event.definition?.getInteractions()?.[event.clickType - 1]?.toLowerCase();
  // The nexus has its own interfaces (Nexus).
  if (furniture.hotspotKey === "PORTAL_NEXUS" && ["teleport", "teleport menu", "configuration"].includes(action ?? "")) {
    return require("./Nexus.Construction").nexusOption(event, action);
  }
  if (furniture.buildableKey.endsWith("_PORTAL_FRAME") && action === "enter") {
    chooseDestination(event.player, house, furniture, "teleport");
    return true;
  }
  if (action !== "direct-portal") return false;
  if (house.owner !== event.player) { event.player.sendMessage("Only the owner can direct portals."); return true; }
  const position = house.getRoomPositionAt(event.location);
  const portals = Object.values(house.getRoom(position).furnitureByLocation ?? {}).filter(value => value.buildableKey.endsWith("_PORTAL_FRAME"));
  if (!portals.length) { event.player.sendMessage("Build a portal frame in this room first."); return true; }
  const options = [];
  portals.forEach((portal, i) => options.push(`Portal ${i + 1}: ${portal.destinations?.[0] ?? "empty"}`, () => chooseDestination(event.player, house, portal, "add")));
  api.sendMultiChatboxPrompt(event.player, "Which portal?", ...options);
  return true;
}

Object.assign(module.exports, { houseDestinations, configureHouseDestination, mayConfigureHouseDestination, current, landingTile, useHousePortal });
