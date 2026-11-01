/**
 * Clans (see docs/clans.md): the Clan Hub, the player's own clan, `//` chat and the Your Clan tab.
 * Core.Clans.js holds the shared state; Formation.Clans.js and Settings.Clans.js their screens.
 */

const Core = require("./Core.Clans");
const Formation = require("./Formation.Clans");
const Settings = require("./Settings.Clans");
const Store = require("./Store.Clans");
const { FriendsChatManager } = require("../FriendsChatManager");

const CLAN_CHAT_MESSAGE_TYPE = 41;
const MAX_MESSAGE_LENGTH = 80;
const MAX_NAME_LENGTH = 20;

const BUTTON_TIMEOUT_VARBIT = 13806; // clan_transmit_affined_timeout
const YOUR_CLAN_GROUP = 701;
const CHANNEL_BUTTON = 8; // Chat, or Leave once in the channel (rsprox 2528)
const SETTINGS_BUTTON = 9;
/** rsprox 2528 ticks 352-357 and 378-384: the reply to Chat, and how long the button stays grey. */
const JOIN_DELAY_TICKS = 3;
const BUTTON_TIMEOUT_TICKS = 5;

const CLAN_HUB_CLERK = 10759;
/**
 * Slots 5 and 7 are the bots' Recruit and the house kick; 6 is Forfeit, only inside a duel. The hub's
 * extent is ours: the Wiki only places it at the Grand Exchange's south-east corner, and the Clerk
 * stands at its middle.
 */
const RECRUIT_OPTION_SLOT = 6;
const CLAN_HUB = { minX: 3170, maxX: 3192, minY: 3460, maxY: 3482 };

let core = null;
let emit = null;

function later(ticks, action) {
  core.TaskManager.submit(
    new (class extends core.Task {
      constructor() {
        super(ticks, false);
      }
      execute() {
        this.stop();
        action();
      }
    })(),
  );
}

/** Live's order at login: settings, status, then the channel with its intro line (rsprox 3886, 763). */
function login({ player }) {
  Formation.startSession(player);
  refreshRecruitOption(player);
  let clan = Core.clanOf(player);
  if (clan) {
    Core.settleOwnership(clan);
    clan = Core.clanOf(player);
  }
  Core.sendClan(player, clan);
  if (!clan) {
    Core.send(player, core.encodeClanChannelFull(Core.OWN_CLAN, null));
    return;
  }
  const member = Core.memberOf(clan, Core.accountOf(player));
  if (member.rank === Core.RANK_OWNER) {
    clan.ownerLastSeen = Date.now();
    Store.save();
  }
  if (member.leftChannel) {
    Core.send(player, core.encodeClanChannelFull(Core.OWN_CLAN, null));
    return;
  }
  Core.enterClan(player, clan);
}

function logout({ player }) {
  Formation.endSession(player);
  Core.removeFromChannel(player);
  const clan = Core.clanOf(player);
  if (clan && Core.memberOf(clan, Core.accountOf(player)).rank === Core.RANK_OWNER) {
    clan.ownerLastSeen = Date.now();
    Store.save();
  }
}

function greyChannelButton(player) {
  player.getPacketSender().sendVarbit(BUTTON_TIMEOUT_VARBIT, 1);
  later(BUTTON_TIMEOUT_TICKS, () => {
    if (Core.isOnline(player)) player.getPacketSender().sendVarbit(BUTTON_TIMEOUT_VARBIT, 0);
  });
}

function toggleChannel(player) {
  const clan = Core.clanOf(player);
  if (!clan) return;
  const member = Core.memberOf(clan, Core.accountOf(player));
  greyChannelButton(player);
  if (Core.channelOf(player)) {
    Core.removeFromChannel(player);
    member.leftChannel = true;
    Store.save();
    Core.send(player, core.encodeClanChannelFull(Core.OWN_CLAN, null));
    return;
  }
  member.leftChannel = false;
  Store.save();
  later(JOIN_DELAY_TICKS, () => {
    if (Core.isOnline(player) && Core.clanOf(player) === clan) Core.joinChannel(player, clan, member);
  });
}

function clickYourClan(event) {
  if (event.groupId !== YOUR_CLAN_GROUP) return;
  if (event.childId === CHANNEL_BUTTON) toggleChannel(event.player);
  else if (event.childId === SETTINGS_BUTTON) Settings.open(event.player);
  else return;
  event.handled = true;
}

function chat(event) {
  const { player, packet } = event;
  if (packet.type !== "clan_chat") return;
  event.handled = true;
  if (packet.clanType !== Core.OWN_CLAN) return;
  const channel = Core.channelOf(player);
  if (!channel) {
    Core.sendNotice(player, "You are not currently in a clan channel.");
    return;
  }
  const text = FriendsChatManager.cleanMessage(packet.text, MAX_MESSAGE_LENGTH);
  if (!text || !FriendsChatManager.allowChat(player, text)) return;
  const message = core.encodeChatMessage(
    "clan",
    text,
    player.getUsername(),
    channel.clan.name,
    player.getIndex(),
    CLAN_CHAT_MESSAGE_TYPE,
  );
  for (const user of channel.users) {
    if (!user.player.getRelations().hasIgnore(player.getLongUsername())) Core.send(user.player, message);
  }
}

// ---------------------------------------------------------------- the Clerk

function offerToForm(player, npc, npcId) {
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) Formation.start(player);
        else emit("npc-dialogue:start", { player, npc, npcId });
      },
    }, "I'd like to form a clan.", "I have some questions.").setTitle("Select an Option"),
  ));
}

/** Only the hub's Clerk; a member has no use for forming, and hears the transcript as it is. */
function talkToClerk({ player, npc, npcId }) {
  if (npcId !== CLAN_HUB_CLERK || Core.clanOf(player)) return false;
  offerToForm(player, npc, npcId);
  return true;
}

/** Live picks these from an interface the transcript names but the cache's ids don't show. */
function clerkItems({ player, npcId }) {
  if (npcId !== CLAN_HUB_CLERK) return false;
  if (!Core.clanOf(player)) {
    player.sendMessage("You need to be in a clan for that.");
    return true;
  }
  const { ItemIdentifiers } = core;
  const inventory = player.getInventory();
  for (const id of [ItemIdentifiers.CLAN_CLOAK, ItemIdentifiers.CLAN_VEXILLUM]) {
    if (player.getEquipment().containsNumber(id) || inventory.containsNumber(id)) continue;
    if (inventory.getFreeSlots() < 1) {
      player.sendMessage("You need more inventory space for that.");
      return true;
    }
    inventory.adds(id, 1);
  }
  return true;
}

// ---------------------------------------------------------------- recruiting

function inClanHub(player) {
  const location = player.getLocation();
  return location.getZ() === 0 && location.getX() >= CLAN_HUB.minX && location.getX() <= CLAN_HUB.maxX
    && location.getY() >= CLAN_HUB.minY && location.getY() <= CLAN_HUB.maxY;
}

/** The option's reach is the hub's map square, so walking only costs a check per square crossed. */
function refreshRecruitOption(player) {
  if (player.isPlayerBot?.() === true) return;
  const location = player.getLocation();
  const inHubSquare = location.getX() >> 6 === CLAN_HUB.minX >> 6 && location.getY() >> 6 === CLAN_HUB.minY >> 6;
  const shown = inHubSquare || player.getEquipment().containsNumber(core.ItemIdentifiers.CLAN_VEXILLUM);
  player.getPacketSender().sendPlayerOption(RECRUIT_OPTION_SLOT, shown ? "Recruit" : "", false);
}

function mapSquareChanged({ player }) {
  refreshRecruitOption(player);
}

/** These hooks ask before the change, so look again on the next tick. */
function vexillumChanging({ player, item }) {
  if (item?.getId?.() !== core.ItemIdentifiers.CLAN_VEXILLUM) return;
  later(1, () => {
    if (Core.isOnline(player)) refreshRecruitOption(player);
  });
}

/** Live: at the hub, or anywhere with a vexillum on for a clan that is recruiting (Wiki: Clan). */
function recruitClanMember(player, target) {
  const clan = Core.clanOf(player);
  const { ItemIdentifiers } = core;
  if (!clan) {
    player.sendMessage("You are not in a clan.");
    return;
  }
  if (!inClanHub(player) && !player.getEquipment().containsNumber(ItemIdentifiers.CLAN_VEXILLUM)) {
    player.sendMessage("You can only recruit at the Clan Hub, or with a clan vexillum equipped.");
    return;
  }
  if (Core.memberOf(clan, Core.accountOf(player)).rank < Core.RANK_ADMINISTRATOR) {
    player.sendMessage("You are not a high enough rank to recruit.");
    return;
  }
  if (clan.members.length >= Core.MAX_MEMBERS) {
    player.sendMessage("Your clan is full.");
    return;
  }
  if (Core.clanOf(target) || Formation.isForming(target)) {
    player.sendMessage(`${target.getUsername()} is already in a clan.`);
    return;
  }
  if (target.getAttribute("accept-aid") === false) {
    player.sendMessage(`${target.getUsername()} is not accepting aid.`);
    return;
  }
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.sendMessage(`Inviting ${target.getUsername()} to join your clan...`);
  target.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        target.getPacketSender().sendInterfaceRemoval();
        if (Number(option) !== 1) {
          player.sendMessage(`${target.getUsername()} has declined your invitation.`);
        } else if (!Core.clanOf(target) && clan.members.length < Core.MAX_MEMBERS && Core.clanOf(player) === clan) {
          Core.addMember(clan, target);
        }
      },
    }, "Yes.", "No.").setTitle(`Join ${clan.name}?`),
  ));
}

function recruit(event) {
  const { player, target, option } = event;
  if (option !== RECRUIT_OPTION_SLOT || !target || target.isPlayerBot?.() === true) return;
  event.handled = true;
  if (Formation.isForming(player)) Formation.invite(player, target);
  else if (!Core.clanOf(player) && inClanHub(player)) player.sendMessage("Talk to the Clerk to form a clan first.");
  else recruitClanMember(player, target);
}

// ---------------------------------------------------------------- owner-rank shortcuts

/** Skips the Clan Hub, for testing: makes the player the owner of a new clan. */
function createClanCommand({ player, parts }) {
  const name = parts.slice(1).join(" ").trim();
  if (!name || name.length > MAX_NAME_LENGTH || !/^[a-z0-9 _-]+$/i.test(name)) {
    player.sendMessage(`Use ::clancreate <name>: up to ${MAX_NAME_LENGTH} letters, numbers and spaces.`);
    return true;
  }
  if (Core.clanOf(player)) {
    player.sendMessage("You are already in a clan.");
    return true;
  }
  if (Store.byName(name)) {
    player.sendMessage("That name is taken.");
    return true;
  }
  Core.createClan(name, [player]);
  return true;
}

/** Skips the invite, for testing: adds an online player to the commander's clan. */
function addMemberCommand({ player, parts }) {
  const clan = Core.clanOf(player);
  const target = Core.onlinePlayer(parts.slice(1).join(" ").trim().replace(/_/g, " ").toLowerCase());
  if (!clan || !target) {
    player.sendMessage(clan ? "That player is not online." : "You are not in a clan.");
    return true;
  }
  if (Core.clanOf(target)) {
    player.sendMessage("That player is already in a clan.");
    return true;
  }
  Core.addMember(clan, target);
  return true;
}

function reset() {
  Core.reset();
  Formation.reset();
}

module.exports = {
  name: "Clans",
  register(api) {
    core = api.core;
    emit = api.emitCustomEvent;
    Core.init(api.core);
    Settings.init(api.core);
    Formation.init(api);
    api.onCustomEvent("player:bootstrap-complete", login);
    api.onPlayerLogout(logout);
    api.onSocialPacket(chat);
    api.onInterfaceActionClick(clickYourClan);
    api.onInterfaceActionClick(Formation.clickPanel);
    api.onInterfaceActionClick(Settings.click);
    api.onPlayerOption(recruit);
    api.onPlayerMapSquareChange(mapSquareChanged);
    api.onCanEquip(vexillumChanging);
    api.onCanUnequip(vexillumChanging);
    api.onCustomEvent("magic:spell-on-player", Formation.inviteByTarget);
    api.onCustomEvent("agent:advance-time", Formation.advanceTime);
    api.onNpcInteraction("Clerk", { "Talk-to": talkToClerk, Items: clerkItems });
    api.registerCommand("clancreate", createClanCommand, api.core.PlayerRights.OWNER, "Create a clan");
    api.registerCommand("clanadd", addMemberCommand, api.core.PlayerRights.OWNER, "Add an online player to your clan");
  },
  _reset: reset,
};
