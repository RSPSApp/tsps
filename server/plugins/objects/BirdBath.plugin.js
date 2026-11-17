"use strict";

/**
 * The bird baths of Civitas illa Fortis (Wiki: Bird bath, Transcript:Bird bath). Drink-from asks
 * "Drink from the bird bath?" (Yes. / No.); a yes plays poh_pool_drink_silent and synth 2401 and
 * closes the menu, and two ticks later one of the transcript's four random outcomes follows, the
 * player's line with it (RSProx 237/1098 ticks 14895-14897, the poison outcome: the poison first,
 * "You have been poisoned!", then the line with the chatsad1 head):
 *   1. "I don't know why I did that..."                                  nothing
 *   2. "Well I'm not really sure what I expected. I hope I didn't ..."   1 damage
 *   3. "Well that was disgusting! It had dirt, sticks and leaves ..."    Defence +2
 *   4. "Eugh! I don't feel too good..."                                  poison, 2 severity (varp 2)
 * Emits `bird-bath:drank` { player, outcome } on that tick (the league's "Drink from a bird bath").
 * A bowl, jug, bucket or vial used on it says "There really isn't enough water in here to do
 * that." (Wiki). Ours: the heads of outcomes 1-3 (only the poison one is recorded).
 */
const NAME = "Bird bath";
const QUESTION = "Drink from the bird bath?";
const DRINK_SOUND = 2401;
const OUTCOME_TICKS = 2;
const NOT_ENOUGH_WATER = "There really isn't enough water in here to do that.";
const VESSELS = ["BOWL", "JUG", "BUCKET", "VIAL"];
/** chatsad1 (RSProx 237/1098 tick 14897), and ours for the others. */
const SAD = 610;
const CALM = 589;
const OUTCOMES = [
  { line: "I don't know why I did that...", head: CALM },
  { line: "Well I'm not really sure what I expected. I hope I didn't contract any horrible diseases...", head: SAD, damage: 1 },
  { line: "Well that was disgusting! It had dirt, sticks and leaves in it! I do feel oddly invigorated though...", head: CALM, defence: 2 },
  { line: "Eugh! I don't feel too good...", head: SAD, poison: 2 },
];

let api = null;

function apply(player, outcome) {
  const { core } = api;
  if (outcome.damage) {
    const damage = player.getHitpoints() > outcome.damage ? outcome.damage : 0;
    player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, damage > 0 ? core.HitMask.RED : core.HitMask.BLUE)]);
  }
  if (outcome.defence) {
    const skills = player.getSkillManager();
    const cap = skills.getMaxLevel(core.Skill.DEFENCE) + outcome.defence;
    const current = skills.getCurrentLevel(core.Skill.DEFENCE);
    if (current < cap) skills.setCurrentLevel(core.Skill.DEFENCE, Math.min(cap, current + outcome.defence));
  }
  if (outcome.poison) core.CombatFactory.poisonEntity(player, outcome.poison);
}

function drink(player, random) {
  const { core } = api;
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("poh_pool_drink_silent")));
  player.getPacketSender().sendSoundEffect(DRINK_SOUND, 1, 0);
  const from = player.getLocation().clone();
  core.TaskManager.submit(new core.CountdownTask(player, OUTCOME_TICKS, () => {
    if (!player.isRegistered() || player.getHitpoints() <= 0 || !player.getLocation().equals(from)) return;
    const index = Math.min(OUTCOMES.length - 1, Math.floor((random ?? Math.random)() * OUTCOMES.length));
    const outcome = OUTCOMES[index];
    api.emitCustomEvent("bird-bath:drank", { player, outcome: index + 1 });
    apply(player, outcome);
    const { DialogueChainBuilder, PlayerDialogue, EndDialogue } = core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new PlayerDialogue(0, outcome.line, outcome.head))
      .add(new EndDialogue(1)));
  }));
}

function drinkFrom({ player }) {
  const { core } = api;
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) drink(player);
      },
    }, "Yes.", "No.").setTitle(QUESTION),
  ));
  return true;
}

function vesselOnBath(event) {
  const I = api.core.ItemIdentifiers;
  if (!VESSELS.some((name) => I[name] === event.itemId)) return false;
  event.player.sendMessage(NOT_ENOUGH_WATER);
  return true;
}

module.exports = {
  name: "BirdBath",
  description: "Lets players drink from Civitas illa Fortis' bird baths, with the transcript's four random outcomes.",
  members: true,
  _test: { drinkFrom, drink, OUTCOMES, QUESTION, NOT_ENOUGH_WATER },
  register(pluginApi) {
    api = pluginApi;
    api.onObjectInteraction(NAME, { "Drink-from": drinkFrom });
    for (const vessel of VESSELS) {
      const id = api.core.ItemIdentifiers[vessel];
      const itemName = Number.isInteger(id) ? api.core.CacheDefinitions.getItem(id)?.name : null;
      if (itemName) api.onItemOnObject(itemName, NAME, vesselOnBath);
    }
  },
};
