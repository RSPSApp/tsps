/**
 * The bank's tutorial button (bankmain:bank_tut, the "?" by the bank's title; hidden by the bank
 * setting bank_hidebanktut): a 16-step screen highlight walkthrough of the bank
 * (https://oldschool.runescape.wiki/w/Bank), run by ScreenHighlight. As rsprox captures show it
 * (rsprox.net recording 3937, rev 236, ticks 1653-2665; 3923, rev 235, the first step):
 * - The click shows swap mode (bank_insertmode 0), closes the bank and opens it again, makes the
 *   inventory side unclickable (highlight_noclick on bankside:bankside_highlight), then mounts the
 *   walkthrough in bankmain:bank_highlight: no hnt_selected_hint, text colour -1, the text
 *   script's fourth argument true. The steps are in ./data/bank-tutorial.json.
 * - Finish (the last step's Continue) leaves hnt_hint_step on the last step, closes the
 *   walkthrough and opens the bank again, which shows the player's own swap/insert mode.
 * - Clicking the button again starts over from the first step.
 * Ours: the swap mode is only shown, the player's own mode is kept (live may switch it for the
 * walkthrough; it shows it back at Finish). Closing the bank mid-walkthrough ends it with the bank
 * (no recording shows it), and the next bank opening shows the player's own mode again.
 */
const TUTORIAL = require("./data/bank-tutorial.json");

const KEY = "bank-tutorial";
const INSERT_MODE_VARBIT = 3959;
const MESLAYER_CLOSE_SCRIPT = 101;
const MESLAYER_MODE_AMOUNT = 11;
const HIGHLIGHT_NOCLICK_SCRIPT = 3406;
const HIGHLIGHT_NOCLICK_CLEAR_SCRIPT = 3407;
/** The bank's mounts in toplevel_osrs_stretch, as Bank.open uses them. */
const BANK_MAIN_TARGET = (161 << 16) | 16;
const BANK_SIDE_TARGET = (161 << 16) | 74;

let api = null;
function bind(pluginApi) {
  api = pluginApi;
}
let ids = null;

function lookup() {
  if (ids) return ids;
  const { CacheDefinitions } = api.core;
  ids = {
    button: CacheDefinitions.getComponentId("bankmain:bank_tut"),
    host: CacheDefinitions.getComponentId("bankmain:bank_highlight"),
    noclick: CacheDefinitions.getComponentId("bankside:bankside_highlight"),
  };
  return ids;
}

/** The bank closed and opened again, as live does around the walkthrough. */
function reopenBank(player) {
  const sender = player.getPacketSender();
  sender.closeSubInterface(BANK_MAIN_TARGET);
  sender.sendInterfaceScript(MESLAYER_CLOSE_SCRIPT, [MESLAYER_MODE_AMOUNT]);
  sender.sendInterfaceScript(HIGHLIGHT_NOCLICK_CLEAR_SCRIPT, [lookup().noclick]);
  sender.closeSubInterface(BANK_SIDE_TARGET);
  player.getBank(player.getCurrentBankTab()).open();
}

function startTutorial(event) {
  const { player, packet } = event;
  if (packet.widgetId !== lookup().button || !api.core.Bank.isOpen(player)) return;
  event.handled = true;
  reopenBank(player);
  if (!api.core.Bank.isOpen(player)) return;
  const sender = player.getPacketSender();
  sender.sendVarbit(INSERT_MODE_VARBIT, 0);
  sender.sendInterfaceScript(HIGHLIGHT_NOCLICK_SCRIPT, [lookup().noclick]);
  api.emitCustomEvent("screen-highlight:show", {
    player, key: KEY, host: lookup().host, colour: -1, finishStep: false, steps: TUTORIAL.steps,
  });
}

function tutorialFinished({ player, key }) {
  if (key !== KEY || !api.core.Bank.isOpen(player)) return;
  reopenBank(player);
}

module.exports = {
  name: "BankTutorial",
  description: "The bank's tutorial button: the 16-step screen highlight walkthrough of the bank.",
  register(pluginApi) {
    bind(pluginApi);
    pluginApi.onCustomEvent("player:widget-action", startTutorial);
    pluginApi.onCustomEvent("screen-highlight:finished", tutorialFinished);
  },
};
