/**
 * The four reward rooms, as captured. The first three (Gift of Peace, Grain of Plenty, Box of
 * Health) speak, then give their coins (Wiki: 2,000, 3,000 and 5,000), the floor's emote and its
 * jingle; the Box of Health also restores every stat. The Cradle of Life speaks, shows the boots,
 * lets the player pick a pair from the skill-multi menu and unlocks Stamp Foot; it can be
 * searched again for more boots (Wiki). A floor's reward counts as its completion.
 */
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Sound } = require("../../../src/main/typescript/elvarg/game/Sound");
const { Sounds } = require("../../../src/main/typescript/elvarg/game/Sounds");
const { CreationMenu } = require("../../../src/main/typescript/elvarg/game/model/menu/CreationMenu");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { StatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/StatementDialogue");
const { ItemStatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { ActionDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ActionDialogue");
const { EndDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");
const { DoubleItemDialogue } = require("./SosDialogues");
const Data = require("./SosData");

const COINS = 995;
const CHEST_SOUND = new Sound(1247, 1, 0, 0);
const CRADLE_SOUND = new Sound(1246, 1, 0, 0);

function restoreAll(player) {
  const skills = player.getSkillManager();
  for (const skill of Skill.values()) {
    const max = skills.getMaxLevel(skill);
    if (skill === Skill.HITPOINTS) {
      if (player.getHitpoints() < max) player.setHitpoints(max);
    } else if (skills.getCurrentLevel(skill) < max) {
      skills.setCurrentLevels(skill, max, true);
    }
  }
  player.sendMessage("You feel refreshed and renewed.");
}

function openChest(player, floor) {
  const reward = floor.reward;
  const chain = new DialogueChainBuilder();
  if (Data.isClaimed(player, floor)) {
    chain.add(new StatementDialogue(0, "You have already claimed your reward from this level."), new EndDialogue(1));
    player.getDialogueManager().startDialogues(chain);
    return true;
  }
  Sounds.sendSound(player, CHEST_SOUND);
  chain.add(
    new StatementDialogue(0, reward.opening),
    new ActionDialogue(1, { execute: () => {
      if (Data.isClaimed(player, floor)) {
        player.getDialogueManager().advance();
        return;
      }
      Data.claim(player, floor);
      if (reward.restore) restoreAll(player);
      player.getInventory().adds(COINS, reward.coins);
      player.getPacketSender().sendJingle(reward.jingle, 0);
      // An action shows nothing itself: go straight on to the congratulations.
      player.getDialogueManager().advance();
    } }),
    new StatementDialogue(2, `...congratulations adventurer, you have been deemed worthy of this reward. You have also unlocked the ${reward.emote} emote!`),
    new EndDialogue(3),
  );
  player.getDialogueManager().startDialogues(chain);
  return true;
}

function claimBoots(player, floor, itemId) {
  const boots = Data.DATA.boots.find((entry) => entry.item === itemId);
  if (!boots) return;
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space.");
    return;
  }
  const first = !Data.isClaimed(player, floor);
  if (first) Data.claim(player, floor);
  player.getInventory().adds(itemId, 1);
  player.getPacketSender().sendJingle(floor.reward.jingle, 0);
  const text = first
    ? `You claim your prize: ${boots.name}<br>You have unlocked the '${floor.reward.emote}' emote.`
    : `You claim your prize: ${boots.name}`;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, itemId, text),
    new EndDialogue(1),
  ));
}

function searchCradle(player, floor) {
  const [fancy, fighting, fancier] = Data.DATA.boots.map((entry) => entry.item);
  Sounds.sendSound(player, CRADLE_SOUND);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, "As your hand touches the cradle, you hear a voice in your head of a million dead adventurers..."),
    new StatementDialogue(1, "... welcome adventurer... you have learnt the value of securing your account, and may claim your prize..."),
    new DoubleItemDialogue(2, fancy, fighting, "You may claim these boots. They protect your feet<br>equally, but they look very different."),
    new DoubleItemDialogue(3, fighting, fancier, "You can return here for more boots at any time, or to<br>get replacements if you lose them."),
    new ActionDialogue(4, { execute: () => {
      player.getPacketSender().sendCreationMenu(new CreationMenu(
        "Select the boots you want.",
        [fancy, fighting, fancier],
        { execute: (itemId) => claimBoots(player, floor, itemId) },
      ));
    } }),
  ));
  return true;
}

function open(event) {
  const name = event.definition?.getName?.();
  const floor = Data.FLOORS.find((entry) => entry.reward.name === name);
  if (!floor) return false;
  return floor.reward.coins === undefined ? searchCradle(event.player, floor) : openChest(event.player, floor);
}

module.exports = { open, openChest, searchCradle, claimBoots, restoreAll };
