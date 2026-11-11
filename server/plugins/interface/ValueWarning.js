/**
 * Shared by the All Settings value warnings (drop, Alchemy, Grand Exchange, birdhouse seeds) and the
 * loot drop notifications: what an item is worth, a "Set value threshold" number prompt for a row,
 * and the item box plus two options that every warning asks with.
 *
 * Worth is the Grand Exchange guide price of the unnoted item, times the quantity; an untradeable
 * item has no worth (its loot line names no value).
 */
const FLOATER_CHATBOX_VARBIT = 16075;
const BUSY_VARBIT = 12393;

function definitionOf(core, itemId) {
  const definition = core.ItemDefinition.forId(itemId);
  const base = definition?.unNote?.() ?? itemId;
  return base === itemId ? definition : core.ItemDefinition.forId(base);
}

function tradeable(core, itemId) {
  return definitionOf(core, itemId)?.isTradeable?.() === true;
}

/** The guide price of `amount` of the item, 0 for an untradeable one. */
function itemValue(core, itemId, amount = 1) {
  if (!(itemId > 0) || !tradeable(core, itemId)) return 0;
  const price = Math.max(0, Math.floor(Number(definitionOf(core, itemId).getGrandExchangeValue?.()) || 0));
  return price * Math.max(0, Math.trunc(Number(amount) || 0));
}

/** Whether `value` reaches a warning's threshold: worth at least it. Ours: a threshold of 0 never warns. */
function reaches(value, threshold) {
  const minimum = Number(threshold) || 0;
  return minimum > 0 && value >= minimum;
}

/**
 * Asks for a number row's value as the Alchemy row does ("settings:set" saves and resends it),
 * clamped to 0..max.
 */
function promptSetting(api, player, settingId, prompt, max) {
  const sender = player.getPacketSender();
  sender.sendVarbit(FLOATER_CHATBOX_VARBIT, 1);
  sender.sendVarbit(BUSY_VARBIT, 1);
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute: (amount) => {
      const value = Math.max(0, Math.min(max, Math.trunc(Number(amount) || 0)));
      api.emitCustomEvent("settings:set", { player, settingId, value });
      sender.sendVarbit(FLOATER_CHATBOX_VARBIT, 0);
      sender.sendVarbit(BUSY_VARBIT, 0);
    },
  });
  sender.sendEnterAmountPrompt(prompt);
}

/**
 * The warning as live asks it: `text` in an item box (and in chat, without its line break), then
 * `title` over the two options. `proceed` runs on the first option only. Only the chatbox closes,
 * so an interface open behind it (the Grand Exchange) stays open.
 */
function confirm(core, player, { itemId, text, title, yes, no, proceed }) {
  const { DialogueChainBuilder, ItemStatementDialogue, StatementDialogue, OptionDialogue } = core;
  const owner = {};
  player.sendMessage(text.replace(/<br>/g, " "));
  const chain = new DialogueChainBuilder()
    .add(itemId > 0 ? new ItemStatementDialogue(0, itemId, text) : new StatementDialogue(0, text))
    .add(new OptionDialogue(1, {
      executeOption: (option) => {
        player.getPacketSender().closeChatboxFor(owner);
        if (Number(option) === 1) proceed();
      },
    }, yes, no).setTitle(title));
  player.getDialogueManager().startDialogues(chain, owner);
}

module.exports = { itemValue, tradeable, reaches, promptSetting, confirm };
