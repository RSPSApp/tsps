"use strict";

const { api, Skill, ItemDefinition, ItemIdentifiers: Items, DialogueChainBuilder, NpcDialogue, StatementDialogue, ItemStatementDialogue, ActionDialogue, EndDialogue } = require("./Core.Construction");
const Data = require("./Data.Construction");
const Ids = require("./Ids.Construction");
const Estate = require("./Estate.Construction");
const House = require("./House.Construction");
const Menu = require("./Menu.Construction");

const VARROCK_ESTATE_AGENT = { x: 3240, y: 3476, z: 0 };
const VARROCK_FANCY_STONE_TASK = "have-the-varrock-estate-agent-decorate-your-hous";
const KOUREND_VISITED_VARBIT = Ids.varbit("zeah_playerhasvisited");
const VARLAMORE_VISITED_VARBIT = Ids.varbit("varlamore_visited");
const SONG_OF_THE_ELVES_VARBIT = Ids.varbit("sote");
const CHRISTMAS_STYLE_VARBIT = Ids.varbit("xmas20_poh_wallkit");
const DEADMAN_STYLE_VARBIT = Ids.varbit("deadman_2026_poh_ornament_unlocked");

function say(event, text, next) {
  event.player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, event.npcId, text),
    next ? new ActionDialogue(1, { execute: next }) : new EndDialogue(1),
  ));
}

function stillAtAgent(event) {
  const current = event.player.getLocation(), npc = event.npc.getLocation();
  return !event.player.getPrivateArea() && current.getZ() === npc.getZ()
    && Math.max(Math.abs(current.getX() - npc.getX()), Math.abs(current.getY() - npc.getY())) <= 6;
}

function saveHouse(player) {
  player.setAttribute(Data.HOUSE_ATTRIBUTE, House.houseStateFor(player));
  House.syncHouseOptions(player);
}

function pay(event, amount, refusal = `You need ${amount.toLocaleString("en-US")} coins to do that.`) {
  if (!stillAtAgent(event)) return false;
  if (event.player.getInventory().getAmount(Items.COINS) < amount) {
    say(event, refusal);
    return false;
  }
  if (amount) event.player.getInventory().delete(Items.COINS, amount);
  return true;
}

function giveGuide(event) {
  if (!stillAtAgent(event)) return;
  const inventory = event.player.getInventory();
  if (inventory.contains(Items.CONSTRUCTION_GUIDE) || event.player.getBanks().some(bank => bank?.contains(Items.CONSTRUCTION_GUIDE))) {
    say(event, "You already have a Construction guide.");
  } else if (inventory.getFreeSlots() === 0) {
    say(event, "Make some space in your inventory and I can give you a Construction guide.");
  } else {
    inventory.adds(Items.CONSTRUCTION_GUIDE, 1);
    say(event, "This book will help you to start building your house.");
  }
}

function buyHouse(event) {
  const saved = House.houseStateFor(event.player);
  if (saved.owned !== false || !pay(event, 1000)) return;
  saved.owned = true;
  saved.location = 1;
  saved.style = 0;
  saveHouse(event.player);
  say(event, "Thank you. Go through the Rimmington house portal and you will find your house ready for you to start building in it.", () => giveGuide(event));
}

function offerHouse(event) {
  say(event, "I can sell you a starting house in Rimmington for 1000 coins. As your Construction level increases, you can have it moved to other areas and redecorated in other styles.", () =>
    api.sendMultiChatboxPrompt(event.player, "Do you want to buy a starter house?",
      "Yes please!", () => buyHouse(event), "No thanks", () => {}));
}

function describeHouses(event) {
  api.sendMultiChatboxPrompt(event.player, "What would you like to know?",
    "How do I get started?", () => say(event, "Enter your house in building mode. Bring a hammer, a saw and materials, then select a hotspot to build furniture. Your Construction guide explains the rooms and furniture you can build."),
    "How do I get building materials?", () => say(event, "Take logs to a sawmill to have them made into planks. You can buy nails and a saw there. Different furniture requires different materials, which are shown in the build menu."),
    "How do I add rooms?", () => say(event, "In building mode, use a door hotspot or the House Viewer to add a room. More rooms become available as your Construction level increases."),
    "How can friends visit?", () => say(event, "Your friends can use the portal where your house is located. Open your house in normal mode, unlock the portal and set your Private chat to allow them to visit."),
    "That's all, thanks.", () => {});
}

function buyCape(event) {
  const player = event.player;
  if (player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) < 99) {
    say(event, "You need a Construction level of 99 to buy a cape of accomplishment.");
    return;
  }
  const inventory = player.getInventory();
  const coins = inventory.getAmount(Items.COINS);
  if (inventory.getFreeSlots() + (coins === 99000 ? 1 : 0) < 2) {
    say(event, "You'll need room for both the cape and its hood.");
    return;
  }
  if (!pay(event, 99000)) return;
  const trimmed = Skill.values().filter(skill => player.getSkillManager().getMaxLevel(skill) >= 99).length > 1;
  inventory.adds(trimmed ? Items.CONSTRUCT_CAPE_T_ : Items.CONSTRUCT_CAPE, 1);
  inventory.adds(Items.CONSTRUCT_HOOD, 1);
  say(event, "Wear your cape with pride! You have mastered Construction.");
}

function offerCape(event) {
  if (event.player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) < 99) {
    say(event, "This is a cape of accomplishment. When you reach level 99 Construction, I can sell you one for 99,000 coins.");
    return;
  }
  api.sendMultiChatboxPrompt(event.player, "Buy a Construction cape for 99,000 coins?",
    "Yes, please.", () => buyCape(event), "No, thanks.", () => {});
}

// rsprox captures (Redecorate and Relocate on poh_estate_agent, rev 229-236): the styles in this
// order, Canifis before Civitas (saved styles keep their house-styles.json index).
const STYLE_MENU_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 10, 12];
const WILDERNESS_STYLE = 12;
const TWISTED_STYLE = 7;
const LOCKED_COLOUR = "5f5f5f";

function styleUnlocked(player, saved, index) {
  return saved.unlockedStyles?.includes(index) || (index === 9 && player.getPacketSender().getVarbit(CHRISTMAS_STYLE_VARBIT) === 1)
    || (index === WILDERNESS_STYLE && player.getPacketSender().getVarbit(DEADMAN_STYLE_VARBIT) === 1);
}

/** Whether a style can be picked now: unlocked, or its blueprints carried (Twisted always takes them). */
function styleAvailable(player, saved, index) {
  const style = Estate.HOUSE_STYLES[index];
  if (style.blueprint && (index === TWISTED_STYLE || !styleUnlocked(player, saved, index))) return player.getInventory().contains(style.blueprint);
  return !style.holiday || styleUnlocked(player, saved, index);
}

/**
 * rsprox captures: Relocate is "Select a New Location" with "Rimmington (5,000)" rows; Redecorate is
 * "Choose a style:" with "Basic wood - 5,000 coins", "Twisted theme - Twisted blueprints" for a
 * blueprint style, grey while it can't be picked, and Cancel. The Wilderness theme is only listed
 * once it can be used.
 */
function showMenu(event, kind) {
  const player = event.player, saved = House.houseStateFor(player);
  if (saved.owned === false) { offerHouse(event); return true; }
  if (kind === "location") {
    Menu.openMenu(player, "Select a New Location",
      Estate.HOUSE_LOCATIONS.map(choice => `${choice.name} (${choice.cost.toLocaleString("en-US")})`),
      index => changeHouse(event, kind, index));
    return true;
  }
  const order = STYLE_MENU_ORDER.filter(index => index !== WILDERNESS_STYLE || styleAvailable(player, saved, index));
  const labels = order.map(index => {
    const style = Estate.HOUSE_STYLES[index];
    const label = `${style.name} - ${style.blueprint ? ItemDefinition.forId(style.blueprint).getName() : `${style.cost.toLocaleString("en-US")} coins`}`;
    return styleAvailable(player, saved, index) ? label : `<col=${LOCKED_COLOUR}>${label}</col>`;
  });
  Menu.openMenu(player, "Choose a style:", [...labels, "Cancel"], index => {
    if (index < order.length) changeHouse(event, kind, order[index]);
  });
  return true;
}

function relocate(event) { return showMenu(event, "location"); }
function redecorate(event) { return showMenu(event, "style"); }

/** rsprox captures (menu:lj_layer1 after Relocate/Redecorate, rev 229): no confirmation; the coins go and the agent says so. */
function changeHouse(event, kind, index) {
  if (!stillAtAgent(event)) return;
  const player = event.player, saved = House.houseStateFor(player);
  if (saved.owned === false) return;
  const choice = kind === "location" ? Estate.HOUSE_LOCATIONS[index] : Estate.HOUSE_STYLES[index];
  if (!choice) return;
  if (player.getSkillManager().getMaxLevel(Skill.CONSTRUCTION) < choice.level) {
    say(event, `You need a Construction level of ${choice.level} for that. A temporary boost will not help.`);
    return;
  }
  const noCoins = `Hmph. Come back when you have ${choice.cost.toLocaleString("en-US")} coins.`;
  const lines = [];
  if (kind === "location") {
    const destination = Estate.HOUSE_LOCATIONS[index];
    if ((saved.location ?? 1) === destination.id) { say(event, "Your house is already there!"); return; }
    if (destination.id === 8 && !saved.visitedKourend && player.getPacketSender().getVarbit(KOUREND_VISITED_VARBIT) === 0) {
      say(event, "You must visit Great Kourend before moving your house to Hosidius."); return;
    }
    if (destination.id === 13 && !saved.visitedVarlamore && player.getPacketSender().getVarbit(VARLAMORE_VISITED_VARBIT) === 0) {
      say(event, "You must visit Varlamore before moving your house to Aldarin."); return;
    }
    if (destination.id === 9 && player.getPacketSender().getVarbit(SONG_OF_THE_ELVES_VARBIT) < 200) {
      say(event, "Prifddinas? I've never heard of it. Are you sure it's a real place?"); return;
    }
    if (!pay(event, choice.cost, noCoins)) return;
    House.releaseHouse(player, false);
    saved.location = destination.id;
    lines.push({ npc: `Your house has been moved to ${choice.name}.` });
  } else {
    const style = Estate.HOUSE_STYLES[index], oldStyle = Estate.houseStyleIndex(saved);
    if (oldStyle === index) { say(event, "Your house is already decorated in that style."); return; }
    const unlocked = styleUnlocked(player, saved, index);
    if (style.holiday && !unlocked) { say(event, `You must complete a ${style.holiday} event to unlock that house style.`); return; }
    const inventory = player.getInventory();
    const blueprint = style.blueprint && (index === TWISTED_STYLE || !unlocked) ? style.blueprint : 0;
    if (blueprint && !inventory.contains(blueprint)) { say(event, "Bring me the blueprints for that style first."); return; }
    const returnedBlueprint = oldStyle === TWISTED_STYLE;
    const freedSlots = (blueprint && inventory.getAmount(blueprint) === 1 ? 1 : 0)
      + (choice.cost > 0 && inventory.getAmount(Items.COINS) === choice.cost ? 1 : 0);
    if (returnedBlueprint && inventory.getFreeSlots() + freedSlots < 1) {
      say(event, "Make room for me to return your Twisted blueprints before changing styles."); return;
    }
    if (!pay(event, choice.cost, noCoins)) return;
    House.releaseHouse(player, false);
    if (blueprint) inventory.delete(blueprint, 1);
    if (returnedBlueprint) inventory.adds(Items.TWISTED_BLUEPRINTS, 1);
    if ((style.blueprint && index !== TWISTED_STYLE) || style.holiday) saved.unlockedStyles = [...new Set([...(saved.unlockedStyles ?? []), index])];
    saved.style = index;
    if (index === TWISTED_STYLE) lines.push({ npc: "Absolutely, let me borrow your blueprints and I'll make it happen! You will get them back if you redecorate your house to a different theme." });
    if (returnedBlueprint) lines.push({ statement: "The Estate agent returns your blueprints." });
    lines.push({ npc: "Your house has been redecorated." });
  }
  saveHouse(player);
  if (kind === "style" && choice.name === "Fancy stone" && event.npc?.getLocation) {
    const agent = event.npc.getLocation();
    if (agent.getZ() === VARROCK_ESTATE_AGENT.z
      && Math.abs(agent.getX() - VARROCK_ESTATE_AGENT.x) <= 4
      && Math.abs(agent.getY() - VARROCK_ESTATE_AGENT.y) <= 4) {
      api.emitCustomEvent("diary:task", { player, diary: "varrock", task: VARROCK_FANCY_STONE_TASK });
    }
  }
  if (kind === "style") {
    api.emitCustomEvent("construction:house-redecorated", {
      player, style: choice.name, npc: event.npc, location: event.npc?.getLocation?.(),
    });
  }
  const chain = new DialogueChainBuilder();
  lines.forEach((line, step) => chain.add(line.npc ? new NpcDialogue(step, event.npcId, line.npc) : new StatementDialogue(step, line.statement)));
  chain.add(new EndDialogue(lines.length));
  player.getDialogueManager().startDialogues(chain);
}

function talk(event) {
  say(event, "Hello. Welcome to the Gielinor Housing Agency! What can I do for you?", () => {
    if (House.houseStateFor(event.player).owned === false) {
      api.sendMultiChatboxPrompt(event.player, "What would you like to say?",
        "How can I get a house?", () => offerHouse(event),
        "Tell me about houses.", () => describeHouses(event));
    } else {
      api.sendMultiChatboxPrompt(event.player, "What would you like to say?",
        "Can you move my house please?", () => relocate(event),
        "Can you redecorate my house please?", () => redecorate(event),
        "Could I have a Construction guidebook?", () => giveGuide(event),
        "Tell me about houses.", () => describeHouses(event),
        "Tell me about your skillcape.", () => offerCape(event));
    }
  });
  return true;
}


const MESSAGE_BOX_CHAT_TYPE = 115;

/**
 * Inspect, as captured on the Twisted blueprints (rsprox 2548, rev 229, cycle 35): the chat line
 * as a message box type, then the object box beside the item. Hosidius's words are the Wiki's.
 */
function inspectBlueprints(theme) {
  return ({ player, itemId }) => {
    const text = `These blueprints appear to be a set of instructions for<br>creating the ${theme} player-owned house theme.<br>Perhaps an Estate Agent can make use of these?`;
    player.getPacketSender().sendTypedMessage(MESSAGE_BOX_CHAT_TYPE, text.replace(/<br>/g, " "));
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text)));
    return true;
  };
}

function attachEstateAgents(api) {
  api.onItemAction("Twisted blueprints", { Inspect: inspectBlueprints("Twisted") });
  api.onItemAction("Hosidius blueprints", { Inspect: inspectBlueprints("Hosidius") });
  api.onNpcInteraction("Estate agent", { "Talk-to": talk, Relocate: relocate, Redecorate: redecorate });
  api.onNpcInteraction("Estate Agent", { "Talk-to": talk, Relocate: relocate, Redecorate: redecorate });
  api.onNpcInteraction("Alwyn", { "Talk-to": talk, Relocate: relocate, Redecorate: redecorate });
}

Object.assign(module.exports, { attachEstateAgents });
