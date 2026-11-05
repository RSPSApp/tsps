"use strict";

const { api, Animation, CacheDefinitions, CountdownTask, DialogueChainBuilder, ItemStatementDialogue, ActionDialogue, NpcDialogue, PlayerDialogue, OptionDialogue, EndDialogue, Skill, TaskManager } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// Skill hall trophies (rsprox captures, cache scripts 7847-7855): the head and fishing spaces take
// a blank display in one of three woods, whose Trophies op opens poh_trophy_menu (912) with
// poh_trophy_side (911). The menu lists each trophy (TROPHIES below)
// under Basic, Superior or Elite by level and reads varps 261 (the display's wood, 1-3), 262 (the
// trophy shown), 263 (2 for heads, 4 for fish) and 264 (a bit per trophy the owner has mounted).
// A stuffed item clicked in the side panel is mounted for good (reach_forward_high, its
// experience, the display shows it); Display shows a mounted one again ("You'd need a mahogany
// mount to display that head."), Examine gives "<name>: Requires level # Construction.". Boss
// heads offer their combat experience first ("You can get 200 XP in Defence, Attack, Strength,
// Ranged and Magic for installing that head."), which may be declined (Wiki). Experience per
// trophy is the Wiki's (the basilisk's Slayer 341 is captured); the decline prompt is ours.
const WOODS = { head: ["teak", "mahogany", "gilded"], fish: ["oak", "teak", "mahogany"] };
// The trophy menu's trophies (cache enum 5215: menu index -> furniture row; heads are enum 5213's,
// fish 5214's): the stuffed item the row uses, its level, menu icon and the loc it shows in each
// display wood (poh_trophy_<name>_<wood>). Experience for mounting is the Wiki's, by row name.
const EXPERIENCE = require("./data/trophy-experience.json");
const PLANKS = new Set(["plank_oak", "plank_teak", "plank_mahogany", "gold_leaf", "any_nails"].map(Ids.obj));
const FURNITURE_TABLE = CacheDefinitions.getDbTableId("furniture");
const furnitureColumn = (name) => CacheDefinitions.getDbColumn(FURNITURE_TABLE, name);
const FISH = new Set([...CacheDefinitions.getEnumValues(5214).values()].map(Number));
const TROPHIES = [...CacheDefinitions.getEnumValues(5215)].sort(([a], [b]) => a - b).map(([key, value]) => {
  const row = CacheDefinitions.getDbRow(Number(value));
  const rowName = CacheDefinitions.getDbRowName(Number(value)) ?? "";
  const display = FISH.has(Number(key)) ? "fish" : "head";
  const base = rowName.replace(/^poh_trophy_/, "").replace(/_head$/, "");
  const locs = {};
  WOODS[display].forEach((wood, tier) => {
    const id = CacheDefinitions.getLocId(`poh_trophy_${base}_${wood}`);
    if (id != null) locs[tier + 1] = id;
  });
  const materials = row?.column(furnitureColumn("material_cost")) ?? [];
  let item = -1;
  for (let i = 0; i + 1 < materials.length; i += 2) if (!PLANKS.has(materials[i])) item = materials[i];
  return {
    key: Number(key), row: Number(value), name: String(row?.column(furnitureColumn("name"))[0] ?? base), display, item,
    menuItem: Number(row?.column(furnitureColumn("model_obj"))[0] ?? -1), level: Number(row?.column(furnitureColumn("level_requirement"))[1] ?? 1),
    locs, experience: EXPERIENCE[rowName] ?? {},
  };
});
const MENU = Ids.iface("poh_trophy_menu");
const SIDE = Ids.iface("poh_trophy_side");
const TIER_COMPONENTS = new Set([4, 5, 6]);
const SIDE_ITEMS = 0;
const MAIN_MODAL_UID = Ids.component("toplevel_osrs_stretch:mainmodal");
const SIDE_MODAL_UID = Ids.component("toplevel_osrs_stretch:sidemodal");
const SIDE_MODAL_TYPE = 3;
const VARP_TIER = Ids.varp("if1");
const VARP_SHOWN = Ids.varp("if2");
const VARP_TYPE = Ids.varp("if3");
const VARP_MOUNTED = Ids.varp("if4");
const TYPE_IDS = { head: 2, fish: 4 };
const REACH = Ids.seq("reach_forward_high");
const DISPLAYS = {
  HEAD_DISPLAY_TEAK: { type: "head", tier: 1 }, HEAD_DISPLAY_MAHOGANY: { type: "head", tier: 2 }, HEAD_DISPLAY_GILDED: { type: "head", tier: 3 },
  FISH_DISPLAY_OAK: { type: "fish", tier: 1 }, FISH_DISPLAY_TEAK: { type: "fish", tier: 2 }, FISH_DISPLAY_MAHOGANY: { type: "fish", tier: 3 },
};
const MOUNTED_ATTRIBUTE = "construction:trophies";
const KURASK = Ids.npc("slayer_kursk_1"); // the chathead
const KQ_HEAD_NPC = Ids.npc("kalphite_queen"); // the chathead
const KQ_HEAD_TASK = "speak-to-the-kq-head-in-your-poh";
// Furniture of the old trophy system (one piece per trophy), by the trophy it showed.
const OLD_TROPHIES = {
  CRAWLING_HAND: 0, COCKATRICE_HEAD: 1, BASILISK_HEAD: 2, KURASK_HEAD: 3, ABYSSAL_DEMON_HEAD: 4, KBD_HEADS: 5,
  KALPHITE_QUEEN_HEAD: 6, VORKATH_HEAD: 7, MOUNTED_BASS: 9, MOUNTED_SWORDFISH: 10, MOUNTED_SHARK: 11,
};
const DISPLAY_FOR_TIER = { head: ["HEAD_DISPLAY_TEAK", "HEAD_DISPLAY_MAHOGANY", "HEAD_DISPLAY_GILDED"], fish: ["FISH_DISPLAY_OAK", "FISH_DISPLAY_TEAK", "FISH_DISPLAY_MAHOGANY"] };

/** player -> the display their open trophy menu is for */
const openFor = new WeakMap();

const byKey = new Map(TROPHIES.map(trophy => [trophy.key, trophy]));
const byItem = new Map(TROPHIES.map(trophy => [trophy.item, trophy]));
const lowestTier = (trophy) => Math.min(...Object.keys(trophy.locs).map(Number));

function mounted(player) {
  return new Set(player.getAttribute(MOUNTED_ATTRIBUTE) ?? []);
}

/** Instance.rebuild, before furniture is drawn: each display shows its trophy in its own wood. */
function refreshDisplays(house) {
  for (const entry of house.furnitureEntries()) {
    const furniture = entry.furniture;
    const old = OLD_TROPHIES[furniture.buildableKey];
    if (old !== undefined) migrate(house, furniture, old);
    const display = DISPLAYS[furniture.buildableKey];
    if (!display) continue;
    const loc = byKey.get(furniture.trophy)?.locs[display.tier];
    if (loc) furniture.displayObjectId = loc;
    else delete furniture.displayObjectId;
  }
}

/** An old-system trophy becomes a display of its first wood that shows it, and it counts as mounted. */
function migrate(house, furniture, key) {
  const trophy = byKey.get(key);
  furniture.buildableKey = DISPLAY_FOR_TIER[trophy.display][lowestTier(trophy) - 1];
  furniture.trophy = key;
  for (const room of house.save.rooms.flat(2)) {
    if (!room?.furniture) continue;
    for (const [hotspot, value] of Object.entries(room.furniture)) if (OLD_TROPHIES[value] === key) room.furniture[hotspot] = furniture.buildableKey;
  }
  if (house.owner) house.owner.setAttribute(MOUNTED_ATTRIBUTE, [...mounted(house.owner).add(key)]);
}

function displayAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const display = furniture && DISPLAYS[furniture.buildableKey];
  return display ? { house, furniture, display } : null;
}

function trophiesOption(event) {
  const found = displayAt(event);
  if (!found) return false;
  const player = event.player;
  if (found.house.owner !== player) return player.sendMessage("Only the owner of the house can change the trophies."), true;
  openMenu(player, found);
  return true;
}

function openMenu(player, found) {
  const { furniture, display } = found;
  openFor.set(player, found);
  const bits = [...mounted(player)].reduce((value, key) => value | (1 << key), 0);
  const sender = player.getPacketSender();
  sender.sendConfig(VARP_TIER, display.tier);
  sender.sendConfig(VARP_SHOWN, furniture.trophy ?? -1);
  sender.sendConfig(VARP_TYPE, TYPE_IDS[display.type]);
  sender.sendConfig(VARP_MOUNTED, bits);
  sender.sendInterface(MENU);
  sender.sendSubInterface(SIDE_MODAL_UID, SIDE, SIDE_MODAL_TYPE);
}

function closeMenu(player) {
  openFor.delete(player);
  player.getPacketSender().closeSubInterface(MAIN_MODAL_UID);
  player.getPacketSender().closeSubInterface(SIDE_MODAL_UID);
}

/** The menu's tiers (Display/Examine) and the side panel's stuffed items (mount). */
function interfaceClick(event) {
  const menu = event.groupId === MENU && TIER_COMPONENTS.has(event.childId);
  const side = event.groupId === SIDE && event.childId === SIDE_ITEMS;
  if (!menu && !side) return;
  event.handled = true;
  const player = event.player;
  const found = openFor.get(player);
  if (!found || House.houseFor(player) !== found.house) return closeMenu(player);
  if (side) {
    const trophy = byItem.get(event.itemId);
    if (trophy) mount(player, found, trophy);
    else player.sendMessage("You can't mount that here.");
    return;
  }
  const trophy = TROPHIES.find(entry => entry.menuItem === event.itemId);
  if (!trophy) return;
  if ((event.opId ?? event.action ?? 1) > 1) return player.sendMessage(`${trophy.name}: Requires level ${trophy.level} Construction.`);
  if (!mounted(player).has(trophy.key)) return player.sendMessage(`You haven't mounted ${trophy.name.toLowerCase()} yet.`);
  show(player, found, trophy);
}

function needWood(player, display, trophy) {
  const wood = WOODS[display.type][lowestTier(trophy) - 1];
  player.sendMessage(`You'd need a ${wood} mount to display that ${display.type === "head" ? "head" : "fish"}.`);
}

function show(player, found, trophy) {
  const { house, furniture, display } = found;
  if (trophy.display !== display.type) return player.sendMessage("That doesn't go on this display.");
  if (!trophy.locs[display.tier]) return needWood(player, display, trophy);
  closeMenu(player);
  player.performAnimation(new Animation(REACH));
  furniture.trophy = trophy.key;
  furniture.displayObjectId = trophy.locs[display.tier];
  house.redrawFurniture();
  House.saveHouse(house);
}

function mount(player, found, trophy) {
  const { display } = found;
  if (trophy.display !== display.type) return player.sendMessage("That doesn't go on this display.");
  if (player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION) < trophy.level) {
    return player.sendMessage(`You need a Construction level of ${trophy.level} to mount that.`);
  }
  if (!trophy.locs[display.tier]) {
    if (trophy.experience.combat) return combatOffer(player, trophy, () => needWood(player, display, trophy));
    return needWood(player, display, trophy);
  }
  if (!trophy.experience.combat) return install(player, found, trophy, true);
  closeMenu(player);
  combatOffer(player, trophy, () => api.sendMultiChatboxPrompt(player, "Take the combat experience?",
    "Yes", () => install(player, found, trophy, true),
    "No", () => install(player, found, trophy, false)));
}

function combatOffer(player, trophy, then) {
  closeMenu(player);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, trophy.item, `You can get ${trophy.experience.combat.ATTACK} XP in Defence, Attack, Strength,<br>Ranged and Magic for installing that head.`),
    new ActionDialogue(1, { execute: then }),
  ));
}

function install(player, found, trophy, withCombat) {
  const { house } = found;
  if (House.houseFor(player) !== house || !player.getInventory().contains(trophy.item)) return;
  player.getInventory().delete(trophy.item, 1);
  for (const [skill, amount] of Object.entries(trophy.experience)) {
    if (skill === "combat") {
      if (withCombat) for (const [name, xp] of Object.entries(amount)) player.getSkillManager().addExperiences(Skill[name], xp);
    } else {
      player.getSkillManager().addExperiences(Skill[skill], amount);
    }
  }
  player.setAttribute(MOUNTED_ATTRIBUTE, [...mounted(player).add(trophy.key)]);
  show(player, found, trophy);
  TaskManager.submit(new CountdownTask(player, 2, () => {
    if (House.houseFor(player) === house) openMenu(player, found);
  }));
}

function talkTo(event) {
  const found = displayAt(event);
  const trophy = byKey.get(found?.furniture.trophy);
  if (trophy?.name === "Kurask head") {
    event.player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, KURASK, "I KILL YOU!!!")));
    return true;
  }
  if (trophy?.name === "KQ head") {
    talkToKqHead(event.player, found.house);
    return true;
  }
  return false;
}

/** The mounted KQ head's transcript: the owner is threatened, a guest is answered with the owner's kill. */
function talkToKqHead(player, house) {
  const chain = new DialogueChainBuilder();
  if (house.owner === player) {
    api.emitCustomEvent("diary:task", { player, diary: "desert", task: KQ_HEAD_TASK });
    chain
      .add(new NpcDialogue(0, KQ_HEAD_NPC, "Soft-thing! How dare you approach the queen of the kalphite?"))
      .add(new PlayerDialogue(1, "I killed you, remember?"))
      .add(new NpcDialogue(2, KQ_HEAD_NPC, "Yes, you killed this queen, but by now another will have risen up! One kalphite may die but the hive goes on!"))
      .add(new NpcDialogue(3, KQ_HEAD_NPC, "The kalphite race grows stronger every day, and our young feed on the blood of the soft-things that invade from above!"))
      .add(new NpcDialogue(4, KQ_HEAD_NPC, "Someday we will overrun the world again and all soft creatures will die. But we will reserve the worst fate for those who have killed a queen and hung her head in their house."))
      .add(new NpcDialogue(5, KQ_HEAD_NPC, "We will lay our eggs in your brain and you will not die until it explodes and a million kalphite emerge to make a grand hive of all the world!"))
      .add(new OptionDialogue(6, {
        executeOption(option) {
          const brave = Number(option) === 1;
          player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
            new PlayerDialogue(0, brave ? "You don't scare me!" : "Please don't kill me!"),
            new NpcDialogue(1, KQ_HEAD_NPC, brave
              ? "Your pitiful misplaced confidence is irrelevant. You will all die!"
              : "Ha ha ha! It is too late for pleading now, pathetic mammal! Your fate is sealed!"),
            new EndDialogue(2),
          ));
        },
      }, "You don't scare me!", "Please don't kill me!"));
  } else {
    const owner = house.owner.getDisplayName();
    chain
      .add(new NpcDialogue(0, KQ_HEAD_NPC, "Soft-thing! How dare you approach the queen of the kalphite?"))
      .add(new PlayerDialogue(1, `${owner} killed you! I can do what I like.`))
      .add(new NpcDialogue(2, KQ_HEAD_NPC, `${owner} killed me but you could not. My successor will be as strong as me. Come down to meet her, she is unafraid.`))
      .add(new EndDialogue(3));
  }
  player.getDialogueManager().startDialogues(chain);
}

function attachTrophies(api) {
  api.persistAttribute(MOUNTED_ATTRIBUTE, []);
  // The mounted locs' own names ("Vorkath head"), which differ from the menu's ("Vorkath's Head").
  const mountedNames = TROPHIES.flatMap(trophy => Object.values(trophy.locs)).map(id => CacheDefinitions.getObject(id)?.name).filter(Boolean);
  const names = new Set(["Teak display", "Mahogany display", "Gilded display", "Oak display", ...mountedNames]);
  for (const name of names) api.onObjectInteraction(name, { Trophies: trophiesOption, "Talk-to": talkTo });
  api.onInterfaceActionClick(interfaceClick);
  api.onCustomEvent("interface:close", ({ player }) => openFor.delete(player));
}

Object.assign(module.exports, { attachTrophies, refreshDisplays, MOUNTED_ATTRIBUTE, _test: { talkTo, talkToKqHead, byKey } });
