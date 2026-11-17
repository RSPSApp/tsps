/**
 * The Old Memorial in the Kourend Woodland (loc kourendwoodland_statue, 1520,3478): Inspect.
 *
 * Recorded (rsprox.net recording 363, rev 231, five inspects from tick 2188): the player turns to
 * the memorial and a message box opens with King Kharedst IV's words, the three key words in
 * purple. Continue offers to recharge a carried Book of the Dead (tick 2191).
 */
const MEMORIAL_NAME = "Old Memorial";
const INSCRIPTION = "'Obey the <col=800080>Laws<col=000000> of your <col=800080>Body<col=000000>, "
  + "<col=800080>Mind<col=000000> and <col=800080>Soul<col=000000>.' - King Kharedst IV";

let core;
let api;

function continueMemorial(player, object) {
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();
  api.emitCustomEvent("kharedst:memorial-inspected", { player, object });
}

function inspectMemorial({ player, object }) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new StatementDialogue(0, INSCRIPTION))
    .add(new ActionDialogue(1, { execute: () => continueMemorial(player, object) })));
  return true;
}

module.exports = {
  name: "KourendWoodland",
  description: "The Old Memorial in the Kourend Woodland: Inspect shows King Kharedst IV's inscription, then offers book recharging.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    pluginApi.onObjectInteraction(MEMORIAL_NAME, { Inspect: inspectMemorial });
  },
};

module.exports._test = { INSCRIPTION };
