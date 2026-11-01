/**
 * Clans (see docs/clans.md): the Clan Hub, the player's own clan, `//` chat and the Your Clan tab.
 * Core.Clans.js holds the shared state; Formation.Clans.js and Settings.Clans.js their screens.
 */

const Broadcasts = require("./Broadcasts.Clans");
const Contents = require("./Contents.Clans");
const Core = require("./Core.Clans");
const Formation = require("./Formation.Clans");
const Guests = require("./Guests.Clans");
const Hall = require("./Hall.Clans");
const Screens = require("./Screens.Clans");
const Management = require("./Management.Clans");
const Settings = require("./Settings.Clans");
const Store = require("./Store.Clans");
const { FriendsChatManager } = require("../FriendsChatManager");

const CLAN_CHAT_MESSAGE_TYPE = 41;
const GUEST_CHAT_MESSAGE_TYPE = 44;
const GUEST_NOTICE_MESSAGE_TYPE = 46;
const GUEST_INTRO = "To talk in this clan's channel, start each line of chat with /// or /g.";
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
 * Every other slot belongs to something: 1-3 Attack, Trade, Follow; 4 and 6 the duel's; 7 the house
 * kick; 8 Report. Slot 5 is already "Recruit" on every player, for the bots (RegisterBotStatusInteractions),
 * so this is the same option on a real player. The hub's extent is ours: the Wiki only places it at the
 * Grand Exchange's south-east corner, and the Clerk stands at its middle.
 */
const RECRUIT_OPTION_SLOT = 5;
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
  showRecruitOption(player);
  let clan = Core.clanOf(player);
  if (clan) {
    Core.settleOwnership(clan);
    clan = Core.clanOf(player);
  }
  Core.sendClan(player, clan);
  Core.resetGuestView(player);
  if (clan) Screens.wearColours(player, clan);
  Broadcasts.noteCombat(player);
  if (!clan) {
    Core.send(player, core.encodeClanChannelFull(Core.OWN_CLAN, null));
    return;
  }
  const member = Core.memberOf(clan, Core.accountOf(player));
  Core.noteSeen(clan, member);
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
  Contents.playerGone(player);
  Core.removeGuestViewer(player);
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

/** A channel user's right-click ops (clan_sidepanel_op), by name: slots shift as people leave. */
function channelAction(event) {
  const { player, packet } = event;
  if (packet.type !== "clan_channel_action") return;
  event.handled = true;
  const channel = Core.channelOf(player);
  const own = channel && Core.memberOf(channel.clan, Core.accountOf(player));
  const wanted = packet.name.toLowerCase();
  const target = channel?.users.find((user) => user.name.toLowerCase() === wanted);
  if (!own || !target || target.player === player) return;
  const { clan } = channel;
  if (packet.action === "kick") {
    if (own.rank < clan.kickRank || target.rank >= own.rank) {
      player.sendMessage("You are not a high enough rank to kick that player.");
      return;
    }
    if (target.guest) {
      Core.removeFromGuestChannel(target.player);
      target.player.getPacketSender().sendTypedMessage(GUEST_NOTICE_MESSAGE_TYPE, "You have been kicked from the channel.");
      return;
    }
    Core.removeFromChannel(target.player);
    Core.send(target.player, core.encodeClanChannelFull(Core.OWN_CLAN, null));
    Core.sendNotice(target.player, "You have been kicked from the channel.");
    return;
  }
  if (packet.action === "mute") {
    const member = Core.memberOf(clan, Core.accountOf(target.player));
    if (member && own.rank >= clan.kickRank && member.rank < own.rank) Core.setMemberMuted(clan, member, packet.value === 1);
    return;
  }
  if (!target.guest) {
    player.sendMessage("That player must be expelled from the clan before they can be banned.");
    return;
  }
  if (!Management.canBan(player, clan)) {
    player.sendMessage("You are not a high enough rank to ban players.");
    return;
  }
  Management.addBan(player, clan, target.name);
}

function chat(event) {
  const { player, packet } = event;
  if (packet.type !== "clan_chat") return;
  event.handled = true;
  const isGuest = packet.clanType === Core.LISTENED_CLAN;
  if (!isGuest && packet.clanType !== Core.OWN_CLAN) return;
  const channel = isGuest ? Core.guestChannelOf(player) : Core.channelOf(player);
  if (!channel) {
    if (isGuest) player.getPacketSender().sendTypedMessage(GUEST_NOTICE_MESSAGE_TYPE, "You are not currently in a guest clan channel.");
    else Core.sendNotice(player, "You are not currently in a clan channel.");
    return;
  }
  const speaker = isGuest ? null : Core.memberOf(channel.clan, Core.accountOf(player));
  if (speaker?.muted) {
    Core.sendNotice(player, "You are muted in this clan's channel.");
    return;
  }
  if ((speaker?.rank ?? -1) < channel.clan.talkRank) {
    Core.sendNotice(player, "You are not a high enough rank to talk in this clan's channel.");
    return;
  }
  const text = FriendsChatManager.cleanMessage(packet.text, MAX_MESSAGE_LENGTH);
  if (!text || !FriendsChatManager.allowChat(player, text)) return;
  const line = (type) => core.encodeChatMessage("clan", text, player.getUsername(), channel.clan.name, player.getIndex(), type);
  const forMembers = line(CLAN_CHAT_MESSAGE_TYPE);
  const forGuests = line(GUEST_CHAT_MESSAGE_TYPE);
  for (const user of channel.users) {
    if (!user.player.getRelations().hasIgnore(player.getLongUsername())) Core.send(user.player, user.guest ? forGuests : forMembers);
  }
}

/** The cache enum's entries, without its title (key -1), as [key, name] by key. */
function enumEntries(id) {
  return [...core.CacheDefinitions.getEnumValues(id)].filter(([key, name]) => key >= 0 && name).sort((a, b) => a[0] - b[0]);
}

function viewBoard({ player }) {
  Guests.openBoard(player);
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
  const inventory = player.getInventory();
  const clan = Core.clanOf(player);
  for (const id of [Screens.cloakFor(clan), Screens.vexillumFor(clan)]) {
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

/** Always shown, as the bots' is on the same slot; recruitClanMember says where it works. */
function showRecruitOption(player) {
  if (player.isPlayerBot?.() !== true) player.getPacketSender().sendPlayerOption(RECRUIT_OPTION_SLOT, "Recruit", false);
}

function wearsVexillum(player) {
  return player.getEquipment().getItems?.().some((item) => Screens.isVexillum(item?.getId?.())) ?? false;
}

/** Live: at the hub, or anywhere with a vexillum on for a clan that is recruiting (Wiki: Clan). */
function recruitClanMember(player, target) {
  const clan = Core.clanOf(player);
  if (!clan) {
    player.sendMessage("You are not in a clan.");
    return;
  }
  if (!inClanHub(player) && !wearsVexillum(player)) {
    player.sendMessage("You can only recruit at the Clan Hub, or with a clan vexillum equipped.");
    return;
  }
  if (Core.memberOf(clan, Core.accountOf(player)).rank < Core.permissionRank(clan, Core.SETTING_RECRUIT)) {
    player.sendMessage("You are not a high enough rank to recruit.");
    return;
  }
  if (Core.isBanned(clan, target.getUsername())) {
    player.sendMessage(`${target.getUsername()} is banned from your clan.`);
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
  Hall.reset();
  Contents.reset();
}

module.exports = {
  name: "Clans",
  register(api) {
    core = api.core;
    emit = api.emitCustomEvent;
    Core.init(api.core, api.emitCustomEvent);
    Contents.init(api, Hall.hallOf);
    Contents.setScheduler(later);
    Settings.init(api.core);
    Management.init(Settings.open);
    Guests.init(api.core, later, Settings.openAsGuest, Screens.interestNames, Settings.runeDateText);
    Broadcasts.init(api.core);
    Hall.init(api.core);
    Screens.init(api.core, Settings.open, enumEntries, Management.showRankPopup, Settings.runeDateText);
    Core.setMembershipListeners(Broadcasts.joined, Broadcasts.left);
    Formation.init(api);
    api.onCustomEvent("player:bootstrap-complete", login);
    api.onPlayerLogout(logout);
    api.onSocialPacket(chat);
    api.onSocialPacket(channelAction);
    api.onInterfaceActionClick(clickYourClan);
    api.onInterfaceActionClick(Formation.clickPanel);
    api.onInterfaceActionClick(Settings.click);
    api.onInterfaceActionClick(Management.click);
    api.onInterfaceActionClick(Guests.clickGuestPanel);
    api.onInterfaceActionClick(Guests.clickApplicants);
    api.onInterfaceActionClick(Guests.clickBoard);
    api.onObjectInteraction("Clan recruitment board", { View: viewBoard });
    api.onObjectInteraction("Clan hall portal", { Enter: Hall.enterOwn, "Enter-member": Hall.enterOwn, "Enter-guest": Hall.enterGuest });
    api.onObjectInteraction("Portal", { Leave: Hall.leave });
    api.onObjectInteraction("Clan Coffer", { Use: Hall.useCoffer });
    api.onObjectInteraction("Chest", { Open: Contents.openChest, "Check-permissions": Contents.checkPermissions });
    api.onObjectInteraction("Lever", { Pull: Contents.pullLever });
    api.onObjectInteraction("Party Balloon", { Burst: Contents.burst });
    api.onObjectInteraction("Piano", { Entertain: Contents.entertain, "Play-quietly": Contents.playQuietly, "Background-music": Contents.backgroundMusic });
    api.onObjectInteraction("Stool", { "Sit-on": Contents.sit });
    api.onObjectInteraction("Wooden bench", { "Sit-on": Contents.sit });
    api.onObjectInteraction("Dummy", { Attack: Contents.hitDummy });
    api.onObjectInteraction("Bookcase", { Search: Contents.searchBooks });
    api.onInterfaceActionClick(Contents.clickChest);
    api.onInterfaceActionClick(Contents.clickPiano);
    api.onCustomEvent("player:varp-transmit", Contents.varpTransmitted);
    api.onCustomEvent("interface:closed", Contents.interfaceClosed);
    api.onCustomEvent("interface:opened", Contents.interfaceOpened);
    api.onInterfaceActionClick(Hall.clickCoffer);
    api.onInterfaceActionClick(Screens.clickInterests);
    api.onInterfaceActionClick(Screens.clickEvents);
    api.onInterfaceActionClick(Screens.clickForm);
    api.onInterfaceActionClick(Screens.clickHall);
    api.onCustomEvent("player:varp-transmit", Screens.varpTransmitted);
    api.onPlayerLevelUp(Broadcasts.levelUp);
    api.onPlayerDeathDrops(Broadcasts.deathDrops);
    api.onCustomEvent("quest:completed", Broadcasts.questCompleted);
    api.onCustomEvent("combat-achievements:completed", Broadcasts.combatTask);
    api.onCustomEvent("collection-log:new-item", Broadcasts.collectionLog);
    api.onCustomEvent("npc-drops:roll", Broadcasts.drops);
    api.onExperienceGained(Broadcasts.experience);
    api.onCustomEvent("boss:personal-best", Broadcasts.personalBest);
    api.onCustomEvent("diary:tier-complete", Broadcasts.diaryTier);
    api.onCustomEvent("ironman:hardcore-death", Broadcasts.hardcoreDeath);
    api.onCustomEvent("loot-keys:opened", Broadcasts.lootKey);
    api.onCustomEvent("player:varp-transmit", Management.varpTransmitted);
    api.onPlayerOption(recruit);
    api.onCustomEvent("magic:spell-on-player", Formation.inviteByTarget);
    api.onCustomEvent("agent:advance-time", Formation.advanceTime);
    api.onNpcInteraction("Clerk", { "Talk-to": talkToClerk, Items: clerkItems });
    api.registerCommand("clancreate", createClanCommand, api.core.PlayerRights.OWNER, "Create a clan");
    api.registerCommand("clanadd", addMemberCommand, api.core.PlayerRights.OWNER, "Add an online player to your clan");
  },
  _reset: reset,
};
