"use strict";

/**
 * The strange casket's dialogue, verbatim from
 * https://oldschool.runescape.wiki/w/Transcript:Strange_casket
 * (see ../Mimic.plugin.js for behaviour and sources).
 *
 * The casket is an object, so its lines use the item chathead (the Mimic/strange
 * casket item) as object talk does; the player's lines use the normal player
 * chathead. Opt-in state persists per player (Wiki: challenges are disabled by
 * default). With a mimic casket held, the casket offers the fight; "Fight the
 * Mimic" enters the private arena. The death warning is a plain statement box.
 */

const Shared = require("./Shared.Mimic");
const Lair = require("./Lair.Mimic");

const OPTED_IN_ATTRIBUTE = "mimic:opted-in";

/** Option clicks arrive one-based via DialogueManager.handleResume (1 = first option). */
function chain(player, ...entries) {
  const { DialogueChainBuilder } = Shared.core();
  const built = new DialogueChainBuilder();
  entries.forEach((entry, i) => built.add(entry(i)));
  player.getDialogueManager().startDialogues(built);
}

/** The casket's lines, beside the strange casket item as object talk shows it. */
function sayCasket(index, text) {
  return new (Shared.core().ItemStatementDialogue)(index, Shared.ids().CASKET_ITEM, text);
}

function sayInfo(index, text) {
  return new (Shared.core().StatementDialogue)(index, text);
}

function sayPlayer(index, text) {
  return new (Shared.core().PlayerDialogue)(index, text);
}

function ask(index, firstLabel, onFirst, secondLabel, onSecond, thirdLabel, onThird) {
  const { OptionDialogue } = Shared.core();
  const labels = [firstLabel, secondLabel, thirdLabel].filter((label) => label != null);
  const runs = [onFirst, onSecond, onThird].filter((run) => run != null);
  return new OptionDialogue(index, { executeOption: (option) => {
    const run = runs[Number(option) - 1];
    if (run) run();
  } }, ...labels);
}

/**
 * Terminal entry: runs `run`, then closes the chatbox, so dismissing the last
 * line finishes in one press. A bare ActionDialogue answers nothing, leaving
 * the client stuck on "Please wait..." until pressed again.
 */
function endChain(player, index, run) {
  return new (Shared.core().ActionDialogue)(index, { execute: () => {
    run();
    player.getPacketSender().sendInterfaceRemoval();
  } });
}

function isOptedIn(player) {
  return player.getAttribute?.(OPTED_IN_ATTRIBUTE) === true;
}

function hasCasket(player) {
  const { CASKET_ITEM } = Shared.ids();
  const slot = player.getInventory?.()?.getSlotForItemId?.(CASKET_ITEM);
  return Number.isInteger(slot) && slot >= 0;
}

function optIn(player) {
  player.setAttribute(OPTED_IN_ATTRIBUTE, true);
}

function optOut(player) {
  player.setAttribute(OPTED_IN_ATTRIBUTE, false);
}

/** "I don't think I want that." -> "The Mimic is... disappointed." */
function runDisappointed(player) {
  chain(
    player,
    (m) => sayPlayer(m, "I don't think I want that."),
    (m) => sayCasket(m, "The Mimic is... disappointed."),
  );
}

/** "I don't want Mimic challenges anymore." -> opts out. */
function runOptOut(player) {
  chain(
    player,
    (m) => sayPlayer(m, "I don't want Mimic challenges anymore."),
    (m) => sayCasket(m, "Very well. You shall not be challenged by the Mimic again. Return to me if you change your mind."),
    (m) => endChain(player, m, () => optOut(player)),
  );
}

/** "No, I want to keep getting mimic challenges." -> "The Mimic is... pleased." */
function runKeep(player) {
  chain(
    player,
    (m) => sayPlayer(m, "No, I want to keep getting mimic challenges."),
    (m) => sayCasket(m, "The Mimic is... pleased."),
  );
}

/** "Tell me about the Mimic." branch, shared by both standard menus. */
function runTellMe(api, player) {
  chain(
    player,
    (n) => sayCasket(n, "The Mimic is... a casket. When you find treasure, perhaps you will realise your casket is the Mimic."),
    (n) => sayCasket(n, "If so, the Mimic will reveal itself, and summon you to its arena, to fight."),
    (n) => sayCasket(n, "If you are victorious, the Mimic will reward you with... things."),
    (n) => sayCasket(n, "So, would you like the chance to face the Mimic? The rewards are... special."),
    (n) => ask(n,
      "Yes, I'd like to get Mimic challenges.",
      () => {
        chain(
          player,
          (m) => sayPlayer(m, "Yes, I'd like to get Mimic challenges."),
          (m) => sayCasket(m, "The Mimic is... pleased."),
          (m) => endChain(player, m, () => optIn(player)),
        );
      },
      "No, I don't think I want that.",
      () => {
        chain(
          player,
          (m) => sayPlayer(m, "No, I don't think I want that."),
          (m) => sayCasket(m, "You may find me here if you change your mind. The Mimic will wait."),
        );
      }),
  );
}

/** "What are you?" branch; `tired` selects the opt-out wording of the follow-up menu. */
function whatAreYou(api, player, tired) {
  chain(
    player,
    (n) => sayPlayer(n, "What are you?"),
    (n) => sayCasket(n, "As you see, I am... a casket. Some of us are not mere vessels of wealth."),
    (n) => sayCasket(n, "Some of us speak. Some can walk. And some, like the Mimic... can fight."),
    (n) => tired
      ? ask(n,
        "I don't want Mimic challenges anymore.",
        () => runOptOut(player),
        "No, I want to keep getting mimic challenges.",
        () => runKeep(player))
      : ask(n,
        "Tell me about the Mimic.",
        () => runTellMe(api, player),
        "I don't think I want that.",
        () => runDisappointed(player)),
  );
}

/** Standard menu: not opted in. */
function seekChallenge(api, player) {
  chain(
    player,
    (n) => sayCasket(n, "Do you... seek a challenge? If you do, the Mimic will test your mettle."),
    (n) => ask(n,
      "Tell me about the Mimic.",
      () => runTellMe(api, player),
      "What are you?",
      () => whatAreYou(api, player, false),
      "I don't think I want that.",
      () => runDisappointed(player)),
  );
}

/** Opted in: "Do you... tire of the challenge?" */
function tireOfChallenge(api, player) {
  chain(
    player,
    (n) => sayCasket(n, "Do you... tire of the challenge?"),
    (n) => ask(n,
      "I don't want Mimic challenges anymore.",
      () => runOptOut(player),
      "What are you?",
      () => whatAreYou(api, player, true),
      "No, I want to keep getting mimic challenges.",
      () => runKeep(player)),
  );
}

/** Holding a mimic casket: fight now or later. */
function foundYou(api, player) {
  chain(
    player,
    (n) => sayCasket(n, "The Mimic has... found you! Will you fight now?"),
    (n) => ask(n,
      "Fight the Mimic",
      () => {
        chain(
          player,
          (m) => sayInfo(m, "If you die in here, your items can be retrieved from the Strange Casket in Watson's house, for a fee of 90,000 coins. Anything else you leave in here will be lost permanently."),
          (m) => endChain(player, m, () => Lair.enterArena(player)),
        );
      },
      "Come back later",
      () => {
        chain(player, (m) => sayCasket(m, "Return to me when you are prepared."));
      }),
  );
}

/** Search / presenting the casket all open the same transcript. */
function talk(api, player) {
  if (!Shared.alive(player)) return false;
  if (hasCasket(player)) {
    foundYou(api, player);
    return true;
  }
  if (isOptedIn(player)) {
    tireOfChallenge(api, player);
    return true;
  }
  seekChallenge(api, player);
  return true;
}

function attach(api) {
  api.persistAttribute(OPTED_IN_ATTRIBUTE, false);
  api.onObjectInteraction("<col=ffff00>Strange casket</col>", { Search: (event) => talk(api, event.player) });
  api.onItemOnObject("Mimic", "<col=ffff00>Strange casket</col>", (event) => talk(api, event.player));
}

module.exports = { attach, talk, OPTED_IN_ATTRIBUTE };
