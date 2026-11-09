"use strict";

/**
 * What a champion is worth, as captured for the Giant (rsprox recording 2180) and from the Wiki:
 * - the kill: champions_defeated_* and champions_slain set, the scroll taken, the same XP to
 *   Hitpoints and Slayer, the "A New Champion!" jingle and the reward scroll (champions_scroll)
 *   with "Well done, you defeated the Giant Champion!" and the XP; beating the tenth champion
 *   brings Leon d'Cour's challenge, beating Leon his congratulations (Wiki transcripts);
 * - the Chest of Champions: one Champion's lamp at a time for each champion beaten and not yet
 *   rubbed for; the lamp gives ten times the kill's XP to both skills once confirmed, setting
 *   champions_lamps (captured when rubbed);
 * - reading a scroll: its letter on the handwritten message scroll (layout captured for the Giant);
 * - scroll drops: only for players with 32 Quest Points, and never for a champion already beaten,
 *   who are told so instead (Wiki, Champion's scroll).
 */
const Common = require("./Common.ChampionsChallenge");
const { sessionOfNpc } = require("./Gallery.ChampionsChallenge");
const { QUEST_POINTS_ATTRIBUTE } = require("../../quests/QuestRuntime");

const LAMP_XP_MULTIPLIER = 10;
const REQUIRED_QUEST_POINTS = 32;
/** The chest when no champion has been beaten (Chest of Champions, closed). */
const LOCKED_MESSAGE = "It's locked.";
const LOCKED_SOUND = 2402;
const NOTHING_MESSAGE = "There's nothing in here for you now.";
const RUB_FIRST = "Maybe you should rub that lamp you're holding before you try looking for more rewards.";
const NO_SPACE = "There's a reward in here for you, but don't have space to hold it.";
const SCROLL_DROPPED = "<col=ff0000>A Champion's scroll falls to the ground as you slay your opponent.</col>";
const SCROLL_WITHHELD = "<col=ff0000>You have a funny feeling that you would have received a Champion's scroll...</col>";
const LEON_CHALLENGE = "You have done well brave adventurer, but I would test your mettle now. You may arrange the fight with Larxus at your leisure.";
const LEON_DEFEATED = "Adventurer, you have defeated me in battle! For this, I congratulate you. Please accept my cape as a sign of your accomplishment.";
/** The message scroll's first line of letter text, and its signature line (captured, Giant). */
const LETTER_LINE = 4;
const SIGNATURE_LINE = 7;

const xpText = (xp) => xp.toLocaleString("en-US");
const uid = (group, component) => (group << 16) | component;

function itemBox(player, itemId, text, then = null) {
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = Common.core;
  const chain = new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text));
  if (then) chain.add(new ActionDialogue(1, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

function speak(player, npcId, text, then = null) {
  const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = Common.core;
  const chain = new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text));
  if (then) chain.add(new ActionDialogue(1, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

function giveXp(player, xp) {
  const { Skill } = Common.core;
  const skills = player.getSkillManager();
  skills.addExperience(Skill.HITPOINTS, xp, true);
  skills.addExperience(Skill.SLAYER, xp, true);
}

/** The champions_scroll reward interface, as captured. */
function openRewardScroll(player, champion) {
  const { group, message, pic, slayer, hitpoints, zoom } = Common.DATA.interfaces.reward;
  const sender = player.getPacketSender();
  sender.sendString(`Well done, you defeated the ${Common.title(champion)}!`, uid(group, message));
  sender.sendString(`${xpText(champion.xp)} Slayer XP`, uid(group, slayer));
  sender.sendString(`${xpText(champion.xp)} Hitpoints XP`, uid(group, hitpoints));
  sender.sendItemOnInterface(uid(group, pic), champion.scroll ?? Common.DATA.items.leonScroll, 0, zoom);
  sender.sendInterface(group);
}

function championKilled({ npc, npcId }) {
  const session = sessionOfNpc(npc);
  const champion = Common.byNpc.get(npcId);
  if (!session || !champion || session.champion !== npc) return;
  const { player } = session;
  session.champion = null;
  session.challenge = null;
  const leonWasLocked = !Common.leonUnlocked(player);
  Common.setDefeated(player, champion);
  if (champion.scroll) player.getInventory().delete(champion.scroll, 1);
  giveXp(player, champion.xp);
  player.getPacketSender().sendJingle(Common.DATA.jingle, 0);
  openRewardScroll(player, champion);
  if (champion === Common.LEON) speak(player, Common.LEON.npc, LEON_DEFEATED);
  else if (leonWasLocked && Common.leonUnlocked(player)) speak(player, Common.LEON.npc, LEON_CHALLENGE);
}

function lockedChest({ player }) {
  player.sendMessage(LOCKED_MESSAGE);
  player.getPacketSender().sendSound(LOCKED_SOUND, 1, 0);
  return true;
}

function searchChest({ player }) {
  const lamp = Common.DATA.items.lamp;
  const champion = Common.unclaimed(player);
  if (Common.holdsLamp(player)) {
    itemBox(player, lamp, RUB_FIRST);
  } else if (!champion) {
    player.sendMessage(NOTHING_MESSAGE);
  } else if (player.getInventory().getFreeSlots() === 0) {
    itemBox(player, lamp, NO_SPACE);
  } else {
    player.getInventory().adds(lamp, 1);
    itemBox(player, lamp, `Well done, you defeated the ${Common.title(champion)}! Here's a reward for you.`);
  }
  return true;
}

function rubLamp({ player, itemId }) {
  const champion = Common.unclaimed(player);
  if (!champion) {
    player.sendMessage(NOTHING_MESSAGE);
    return true;
  }
  const xp = xpText(champion.xp * LAMP_XP_MULTIPLIER);
  itemBox(player, itemId, `Well done, you defeated the ${Common.title(champion)}! This lamp will award you ${xp} XP in Slayer and Hitpoints.`, () => {
    Common.api.sendMultiChatboxPrompt(player, `Gain ${xp} XP in Slayer and Hitpoints?`,
      "Proceed", () => claimLamp(player, itemId, champion),
      "Cancel", () => player.getPacketSender().sendInterfaceRemoval());
  });
  return true;
}

function claimLamp(player, itemId, champion) {
  if (!player.getInventory().contains(itemId) || Common.hasRubbed(player, champion)) return;
  player.getInventory().delete(itemId, 1);
  Common.setRubbed(player, champion);
  giveXp(player, champion.xp * LAMP_XP_MULTIPLIER);
  itemBox(player, itemId, `You gain ${xpText(champion.xp * LAMP_XP_MULTIPLIER)} XP in Slayer and Hitpoints.`);
}

/** A champion's scroll, read: its letter in handwriting. */
function readScroll({ player, itemId }) {
  const champion = Common.byScroll.get(itemId);
  if (!champion) return false;
  const { group, lines } = Common.DATA.interfaces.scroll;
  const text = new Array(lines + 1).fill("");
  const first = champion.letter.length > SIGNATURE_LINE - LETTER_LINE - 1 ? LETTER_LINE - 1 : LETTER_LINE;
  champion.letter.forEach((line, index) => { text[first + index] = line; });
  text[SIGNATURE_LINE] = champion.signature;
  const sender = player.getPacketSender();
  for (let line = 1; line <= lines; line++) sender.sendString(text[line], uid(group, line));
  sender.sendInterface(group);
  return true;
}

/** Scroll drops for players who can't take the challenge, or have already won it, are withheld. */
function gateScrollDrops({ player, drops }) {
  if (!player || !Array.isArray(drops)) return;
  for (let index = drops.length - 1; index >= 0; index--) {
    const champion = Common.byScroll.get(drops[index]?.itemId);
    if (!champion) continue;
    const eligible = (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) >= REQUIRED_QUEST_POINTS;
    if (eligible && !Common.hasDefeated(player, champion)) {
      player.sendMessage(SCROLL_DROPPED);
      continue;
    }
    drops.splice(index, 1);
    if (eligible) player.sendMessage(SCROLL_WITHHELD);
  }
}

function sendProgress({ player }) {
  Common.sendVarp(player);
}

function attachRewards(api) {
  api.persistAttribute(Common.DEFEATED_ATTRIBUTE, 0);
  api.persistAttribute(Common.LAMPS_ATTRIBUTE, 0);
  api.onPlayerLogin(sendProgress);
  api.onNpcDeath(championKilled);
  api.onObjectInteraction("Chest of Champions", { Open: lockedChest, Search: searchChest });
  api.onItemAction("Champion's lamp", { Rub: rubLamp });
  for (const champion of Common.SCROLL_CHAMPIONS) api.onItemAction(championScrollName(champion), { Read: readScroll });
  api.onCustomEvent("npc-drops:roll", gateScrollDrops);
}

/** The cache's name for a champion's scroll ("Giant champion scroll"). */
function championScrollName(champion) {
  return Common.core.ItemDefinition.forId(champion.scroll).getName();
}

module.exports = { attachRewards, championKilled, gateScrollDrops, readScroll, searchChest, rubLamp };
