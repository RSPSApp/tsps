/**
 * The spirit tree network (https://oldschool.runescape.wiki/w/Spirit_tree; docs/spirit-trees.md),
 * as live OSRS plays it (rsprox capture database):
 *
 * - Travel on a tree opens the menu interface (187) through its script with "Spirit Tree
 *   Locations" and every tree in plugins/world/data/spirit-trees.json, those the player can't
 *   use greyed out. The choice comes back as a pause button on 187:3 whose sub is the slot.
 * - Choosing a tree: the menu closes, "You place your hands on the dry tough bark..." appears
 *   in the chat and in an objectbox with the spirit tree's picture and no button, the player
 *   reaches for the tree, and two ticks later they stand by the other tree. A tick after that
 *   the line comes again, in the same box with "Click here to continue".
 * - The client keeps the last choice in spirit_tree_previous (varbit 20252): the tree's menu
 *   slot plus one, sent on each choice and on login.
 * - A greyed tree: "You cannot travel to that land at this time." The tree they're at: "You're
 *   already here." (the tree speaks both).
 * - Last-destination: straight to the last tree travelled to; the first time, the tree asks
 *   where to go and the menu opens.
 * - Talk-to: "Hello gnome friend. Where would you like to go?", then the menu.
 * - The Poison Waste tree is named "Spirit Tree", like the farming patches; it's taken only at a
 *   listed tree's tile, so the patches stay Farming's.
 * - Player-grown trees (Farming) open the same menu ("spirit-trees:open"); Farming answers
 *   which of its spirit tree patches are grown and checked ("spirit-trees:grown").
 * - "Your house" names where the player's house stands ("Your house (Yanille)") and is offered
 *   once a spirit tree is built in it (Construction's "construction:spirit-tree"). Travel there
 *   is the same bark and reach; two ticks later the house loads and the player stands beside
 *   its tree ("construction:spirit-tree-travel").
 *
 * The network needs Tree Gnome Village; leaving the Gnome Stronghold's tree needs The Grand
 * Tree. Quests this server doesn't have don't block, as elsewhere.
 */
const fs = require("fs");
const path = require("path");
const QuestRuntime = require("../quests/QuestRuntime");

const NETWORK_QUEST = "Tree Gnome Village";
const LAST_DESTINATION_ATTRIBUTE = "spirit-trees:last-destination";
const MENU_ATTRIBUTE = "spirit-trees:menu";
/** The trip under way: a newer trip takes over from an older one still finishing. */
const TRIP_ATTRIBUTE = "spirit-trees:trip";
const MENU = 187;
const MENU_CHOICES = 3;
const MAIN_MODAL = (161 << 16) | 16;
const CHATBOX_MODAL = (162 << 16) | 566;
const OBJECTBOX = 193;
const OBJECTBOX_UNIVERSE = OBJECTBOX << 16;
const OBJECTBOX_ITEM = (OBJECTBOX << 16) | 1;
const OBJECTBOX_TEXT = (OBJECTBOX << 16) | 2;
/** spirit_tree_dummy: the picture in the travel box, at the objectbox's zoom. */
const SPIRIT_TREE_ITEM = 6063;
const ITEM_ZOOM = 400;
/** spirit_tree_previous: the last tree travelled to, as its menu slot plus one (0: none yet). */
const PREVIOUS_VARBIT = 20252;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_MENU = 217;
const SCRIPT_OBJECTBOX_BUTTONS = 2868;
/** chatdefault_restoreinput: the chatbox's input back after the menu, as the game sends it. */
const SCRIPT_RESTORE_INPUT = 2158;
const PAUSE_BUTTON = 1;
const MENU_SLOTS = 127;
const GREY = "<col=5f5f5f>";
const TITLE = "Spirit Tree Locations";
const TRAVEL_TEXT = "You place your hands on the dry tough bark of the spirit tree, and feel a surge of energy run through your veins.";
/** The same words as the box lays them out. */
const TRAVEL_BOX_TEXT = "You place your hands on the dry tough bark of the<br>spirit tree, and feel a surge of energy run through<br>your veins.";
const CANNOT_TRAVEL = "You cannot travel to that land at this time.";
const ALREADY_HERE = "You're already here.";
const GREETING = "Hello gnome friend. Where would you like to go?";
const FIRST_LAST_DESTINATION = "This once, you will have to tell me where you wish to go, for I do not yet know where to take you back.";
/** Reaching for the tree; the move follows two ticks later. */
const REACH_ANIMATION = 828;
const REACH_DELAY = 15;
const MOVE_TICKS = 2;
/** The box with its continue button, a tick after the landing. */
const LANDED_BOX_TICKS = 1;
/** The trees' chatheads: the ancient trees (Tree Gnome Village, the Stronghold) and the young ones. */
const ANCIENT_TREE_HEAD = 4982;
const YOUNG_TREE_HEAD = 4981;
const ANCIENT_TREE_LOCS = new Set([26259, 26260, 26261]);
/** How far from a listed tree's tile the clicked tree may stand (trees are several tiles big). */
const TREE_REACH = 6;

let core = null;
let pluginApi = null;
let trees = [];

function loadTrees() {
  const file = path.join(__dirname, "data", "spirit-trees.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).trees;
}

/** The quest is complete, or (with `stage`) has reached that stage, as Poison Waste's chimed tree. */
function questComplete(player, name, stage) {
  if (!name) return true;
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.name === name);
  if (!quest) return true;
  return stage === undefined ? quest.isComplete(player) : quest.isComplete(player) || quest.getStage(player) >= stage;
}

function hasSkills(player, skills) {
  return Object.entries(skills ?? {}).every(([name, level]) => {
    const skill = core.Skill.values().find((candidate) => candidate.getName() === name);
    return !skill || player.getSkillManager().getMaxLevel(skill) >= level;
  });
}

/** Construction's answer for "Your house": { owns, location, built }. */
function houseTree(player) {
  const request = { player, owns: false, location: null, built: false };
  pluginApi.emitCustomEvent("construction:spirit-tree", request);
  return request;
}

/** The menu's name for a tree: the house's carries where it stands. */
function label(player, tree) {
  if (!tree.house) return tree.name;
  const house = houseTree(player);
  return house.owns && house.location ? `${tree.name} (${house.location})` : tree.name;
}

const near = (tile, x, y, z, reach) => tile && tile[2] === z && Math.abs(tile[0] - x) <= reach && Math.abs(tile[1] - y) <= reach;

/** The listed permanent tree at a location, or null. */
function treeAt(location) {
  const [x, y, z] = [location.getX(), location.getY(), location.getZ()];
  return trees.find((tree) => near(tree.tree, x, y, z, TREE_REACH)) ?? null;
}

/** Farming's grown and checked spirit tree patches: [{ x, y, z }]. */
function grownPatches(player) {
  const request = { player, patches: [] };
  pluginApi.emitCustomEvent("spirit-trees:grown", request);
  return request.patches;
}

/** "spirit-trees:destinations" { player, list }: the trees the player can travel to now, as { name, location } (a league relic's fairy mushroom). */
function destinationsEvent(request) {
  if (!request?.player || !Array.isArray(request.list)) return;
  const grown = grownPatches(request.player);
  for (const tree of trees) {
    const tile = destination(request.player, tree, grown);
    if (Array.isArray(tile)) request.list.push({ name: tree.name, location: new core.Location(tile[0], tile[1], tile[2] ?? 0) });
  }
}

/** Where a tree puts the player ("house" for their own house's tree), or null when they can't travel there now. */
function destination(player, tree, grown) {
  if (tree.house) return houseTree(player).built ? "house" : null;
  if (!questComplete(player, tree.requires, tree.requiresStage) || !hasSkills(player, tree.skills)) return null;
  if (tree.mooredAt && !(player.getSailing().mooredDocks ?? []).includes(tree.mooredAt)) return null;
  if (tree.grown) {
    const patch = grown.find((candidate) => near(tree.grown, candidate.x, candidate.y, candidate.z, 3));
    if (!patch) return null;
    return tree.landing ?? [patch.x - 1, patch.y, patch.z];
  }
  return tree.landing;
}

function speak(player, head, text, then) {
  const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = core;
  const chain = new DialogueChainBuilder().add(new NpcDialogue(0, head, text));
  if (then) chain.add(new ActionDialogue(1, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

function headOf(object) {
  return ANCIENT_TREE_LOCS.has(object?.getDefinition?.()?.getId?.() ?? object?.getId?.()) ? ANCIENT_TREE_HEAD : YOUNG_TREE_HEAD;
}

function canUseNetwork(player, from) {
  if (!questComplete(player, NETWORK_QUEST)) {
    player.sendMessage("You need to have completed Tree Gnome Village to use the spirit tree network.");
    return false;
  }
  if (from && !questComplete(player, from.leaveRequires)) {
    player.sendMessage(`You need to have completed ${from.leaveRequires} to travel from this tree.`);
    return false;
  }
  return true;
}

/** Opens the menu with every tree, greying out those the player can't travel to now. */
function openMenu(player, from, head) {
  const grown = grownPatches(player);
  const choices = trees.map((tree) => ({ tree, to: destination(player, tree, grown) }));
  const labels = choices.map(({ tree, to }) => (to ? label(player, tree) : `${GREY}${label(player, tree)}</col>`));
  player.setAttribute(MENU_ATTRIBUTE, { from: from?.name ?? null, head, choices });
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  player.setInterfaceId(MENU);
  sender.sendSubInterface(MAIN_MODAL, MENU, 0);
  sender.sendClientScript(SCRIPT_MENU, TITLE, [...labels, "Cancel"].join("|"), 1);
  sender.sendInterfaceFlagsRange((MENU << 16) | MENU_CHOICES, 0, MENU_SLOTS, PAUSE_BUTTON);
}

/** The last tree travelled to, for the client: its menu slot plus one. */
function sendPrevious(player) {
  const slot = trees.findIndex((tree) => tree.name === player.getAttribute(LAST_DESTINATION_ATTRIBUTE));
  if (slot >= 0) player.getPacketSender().sendVarbit(PREVIOUS_VARBIT, slot + 1);
}

function restorePrevious({ player }) {
  if (!player || player.isPlayerBot?.() === true) return;
  sendPrevious(player);
}

/** The bark line in the chat, and in the objectbox beside the spirit tree; `button` adds "Click here to continue". */
function sendBark(player, button) {
  const sender = player.getPacketSender();
  sender.sendTypedMessage(core.ChatType.MESBOX, TRAVEL_TEXT);
  if (button) {
    const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new ItemStatementDialogue(0, SPIRIT_TREE_ITEM, TRAVEL_BOX_TEXT))
      .add(new EndDialogue(1)));
    return;
  }
  sender.sendChatboxInterface(OBJECTBOX);
  sender.sendClientScript(SCRIPT_OBJECTBOX_BUTTONS, "");
  sender.sendInterfaceFlagsRange(OBJECTBOX_UNIVERSE, -1, -1, 0);
  sender.sendItemOnInterfaces(OBJECTBOX_ITEM, SPIRIT_TREE_ITEM, ITEM_ZOOM);
  sender.sendString(TRAVEL_BOX_TEXT, OBJECTBOX_TEXT);
}

/**
 * The captured travel: the bark box and the reach, the move two ticks later, then the box again
 * with its continue button. The house hands off to its loading instead, and has no second box.
 */
function travel(player, tree, to) {
  const { Task, TaskManager, Animation, Location } = core;
  const sender = player.getPacketSender();
  player.setAttribute(LAST_DESTINATION_ATTRIBUTE, tree.name);
  sendPrevious(player);
  sendBark(player, false);
  player.performAnimation(new Animation(REACH_ANIMATION, REACH_DELAY));
  // A grown tree is one of this player's own checked patches (Farming's "spirit-trees:grown").
  pluginApi.emitCustomEvent("spirit-trees:travelled", { player, tree: tree.name, planted: Boolean(tree.grown) });
  const movement = player.getMovementQueue();
  movement.setBlockMovement(true).reset();
  const trip = {};
  player.setAttribute(TRIP_ATTRIBUTE, trip);
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, player, false);
      this.ticks = 0;
    }
    execute() {
      this.ticks++;
      if (player.getAttribute(TRIP_ATTRIBUTE) !== trip) {
        this.superseded = true;
        this.stop();
      } else if (!player.isRegistered() || player.getHitpoints() <= 0) {
        this.stop();
      } else if (this.ticks === MOVE_TICKS && to === "house") {
        sender.closeSubInterface(CHATBOX_MODAL);
        // The house's loading holds the player still from here on.
        movement.setBlockMovement(false);
        this.handedOff = true;
        const from = player.getLocation?.()?.clone?.() ?? null;
        const fromInstance = player.getPrivateArea?.() != null;
        pluginApi.emitCustomEvent("construction:spirit-tree-travel", { player });
        if (player.getPrivateArea?.() != null && from && !player.getLocation().equals(from)) {
          pluginApi.emitCustomEvent("teleport:landed", { player, from, fromInstance, to: player.getLocation().clone() });
        }
        this.stop();
      } else if (this.ticks === MOVE_TICKS) {
        const from = player.getLocation?.()?.clone?.() ?? null;
        const fromInstance = player.getPrivateArea?.() != null;
        const destination = new Location(to[0], to[1], to[2]);
        player.moveTo(destination);
        // As the core's teleports do ("teleport:landed"): where it began, for content that remembers it.
        pluginApi?.emitCustomEvent?.("teleport:landed", { player, from, fromInstance, to: destination });
      } else if (this.ticks >= MOVE_TICKS + LANDED_BOX_TICKS) {
        sendBark(player, true);
        this.stop();
      }
    }
    stop() {
      if (!this.handedOff && !this.superseded) movement.setBlockMovement(false);
      if (!this.superseded) player.setAttribute(TRIP_ATTRIBUTE, null);
      super.stop();
    }
  })());
}

/** A choice from the menu, or Last-destination: the tree speaks when it can't take them there. */
function goTo(player, choice, menu) {
  if (!choice.to) {
    speak(player, menu.head, CANNOT_TRAVEL);
    return;
  }
  if (choice.tree.name === menu.from) {
    speak(player, menu.head, ALREADY_HERE);
    return;
  }
  travel(player, choice.tree, choice.to);
}

function travelOption(event) {
  const { player, object } = event;
  const from = treeAt(object.getLocation());
  if (!canUseNetwork(player, from)) return;
  openMenu(player, from, headOf(object));
}

function talkToOption(event) {
  const { player, object } = event;
  const from = treeAt(object.getLocation());
  if (!canUseNetwork(player, from)) return;
  const head = headOf(object);
  speak(player, head, GREETING, () => openMenu(player, from, head));
}

/** "Spirit Tree" is also the farming patches' name: only the listed trees (Poison Waste) are ours. */
function ownTree(handler) {
  return (event) => {
    if (!treeAt(event.object.getLocation())) return false;
    handler(event);
    return true;
  };
}

function lastDestinationOption(event) {
  const { player, object } = event;
  const from = treeAt(object.getLocation());
  if (!canUseNetwork(player, from)) return;
  const head = headOf(object);
  const last = trees.find((tree) => tree.name === player.getAttribute(LAST_DESTINATION_ATTRIBUTE));
  if (!last) {
    speak(player, head, FIRST_LAST_DESTINATION, () => openMenu(player, from, head));
    return;
  }
  goTo(player, { tree: last, to: destination(player, last, grownPatches(player)) }, { from: from?.name ?? null, head });
}

/** Travel on a grown tree (Farming): the same menu, from that patch. */
function openFromPatch({ player, x, y, z }) {
  if (!canUseNetwork(player, null)) return;
  const from = trees.find((tree) => near(tree.grown, x, y, z, TREE_REACH)) ?? null;
  openMenu(player, from, YOUNG_TREE_HEAD);
}

/** A tree away from the network's own sites (a player-owned house's): its last destination. */
function lastDestinationFrom({ player }) {
  if (!canUseNetwork(player, null)) return;
  const last = trees.find((tree) => tree.name === player.getAttribute(LAST_DESTINATION_ATTRIBUTE));
  if (!last) {
    speak(player, YOUNG_TREE_HEAD, FIRST_LAST_DESTINATION, () => openMenu(player, null, YOUNG_TREE_HEAD));
    return;
  }
  goTo(player, { tree: last, to: destination(player, last, grownPatches(player)) }, { from: null, head: YOUNG_TREE_HEAD });
}

const ownTreeTravel = ownTree(travelOption);
const ownTreeTalkTo = ownTree(talkToOption);
const ownTreeLastDestination = ownTree(lastDestinationOption);

function chooseTree(event) {
  const buttonId = Number(event.buttonId ?? 0);
  if ((event.groupId ?? (buttonId >>> 16)) !== MENU || (event.childId ?? (buttonId & 0xffff)) !== MENU_CHOICES) return;
  const { player } = event;
  const menu = player.getAttribute(MENU_ATTRIBUTE);
  if (!menu) return;
  event.handled = true;
  player.setAttribute(MENU_ATTRIBUTE, null);
  player.getPacketSender().closeSubInterface(MAIN_MODAL);
  player.getPacketSender().sendInterfaceScript(SCRIPT_RESTORE_INPUT);
  player.setInterfaceId(-1);
  const choice = menu.choices[Number(event.action)];
  if (choice) goTo(player, choice, menu);
}

function menuClosed({ player, interfaceId }) {
  if (interfaceId !== MENU) return;
  player.setAttribute(MENU_ATTRIBUTE, null);
  player.getPacketSender().sendInterfaceScript(SCRIPT_RESTORE_INPUT);
}

module.exports = {
  name: "SpiritTrees",
  description: "Spirit tree network: the location menu, travel, talk-to and last-destination, with trees you cannot use greyed out.",
  members: true,
  _test: { loadTrees: () => loadTrees(), destination, canUseNetwork, treeAt, openMenu, chooseTree, travelOption, talkToOption, lastDestinationOption, openFromPatch, ownTreeTravel },
  register(api) {
    core = api.core;
    pluginApi = api;
    trees = loadTrees();
    api.persistAttribute(LAST_DESTINATION_ATTRIBUTE);
    api.onPlayerLogin(restorePrevious);
    api.onObjectInteraction("Spirit tree", { Travel: travelOption, "Talk-to": talkToOption, "Last-destination": lastDestinationOption });
    api.onObjectInteraction("Spirit Tree", { Travel: ownTreeTravel, "Talk-to": ownTreeTalkTo, "Last-destination": ownTreeLastDestination });
    api.onInterfaceActionClick(chooseTree);
    api.onCustomEvent("spirit-trees:open", openFromPatch);
    api.onCustomEvent("spirit-trees:last-destination", lastDestinationFrom);
    api.onCustomEvent("spirit-trees:destinations", destinationsEvent);
    api.onCustomEvent("interface:closed", menuClosed);
  },
};
