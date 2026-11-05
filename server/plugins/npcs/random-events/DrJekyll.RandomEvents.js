"use strict";

// Lines and order from the Wiki's Dr Jekyll transcript and recordings 560 (tick 13077: a herb
// handed over) and 4056 (tick 6010: no herb). The potion is handed over when the player's own
// line is continued, then Jekyll says his thanks. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const ASK_EXPRESSION = 569, PLAYER_EXPRESSION = 588, THANKS_EXPRESSION = 567, SPARE_EXPRESSION = 589;
const THANKS = "Thank you so much! Here, take this potion in return.";
const SPARE = "Fair enough. Here, have a spare potion, and thanks for<br>your time.";

function addDefinition(api, { definitions }) {
  const { DR_JEKYLL, DR_JEKYLL_2 } = api.core.NpcIdentifiers;
  definitions.push({ id: DR_JEKYLL, underwaterId: DR_JEKYLL_2, kind: "jekyll",
    linger: true,
    greet: name => `Hello, ${name}. I need a herb.`,
    nags: [name => `Hey, ${name}!`, name => `Excuse me, ${name}?`, name => `Can you hear me, ${name}?`,
      name => `I just need a herb, ${name}!`, name => `I'll give you a free potion, ${name}!`],
    goodbye: "Maybe later.",
    // 3273: "someone else", where the Wiki transcript has the owner's name.
    otherPlayerLine: owner => `Sorry, I'm trying to get a herb from someone else, but ${owner.getAppearance().isMale() ? "he" : "she"} seems to be ignoring me.`,
    leavingLine: () => "Excuse me, I must be off now.",
    zoneLine: () => "I'll be off now.",
    talk: talk.bind(null, api) });
}

// The article stays "a", avantoe and irit leaf included (the transcript marks them {{sic}}).
function askLine(name) {
  return `Have you got any ${name}? I've fixed my Hyde problem, so it's not urgent, but I could do with a ${name}.`;
}

function talk(api, active, { valid, serve }) {
  const I = api.core.ItemIdentifiers;
  // Ascending Herblore order: highest clean, unnoted herb is requested each talk.
  const exchanges = [
    [I.GUAM_LEAF, I.STRENGTH_POTION_4_, "guam leaf"],
    [I.MARRENTILL, I.ANTIPOISON_4_, "marrentill"],
    [I.TARROMIN, I.ATTACK_POTION_4_, "tarromin"],
    [I.HARRALANDER, I.RESTORE_POTION_4_, "harralander"],
    [I.RANARR_WEED, I.ENERGY_POTION_4_, "ranarr weed"],
    [I.TOADFLAX, I.DEFENCE_POTION_4_, "toadflax"],
    [I.IRIT_LEAF, I.AGILITY_POTION_4_, "irit leaf"],
    [I.AVANTOE, I.SUPER_ATTACK_4_, "avantoe"],
    [I.KWUARM, I.SUPER_ENERGY_4_, "kwuarm"],
    [I.SNAPDRAGON, I.SUPER_STRENGTH_4_, "snapdragon"],
    [I.CADANTINE, I.SUPER_RESTORE_4_, "cadantine"],
    [I.LANTADYME, I.SUPER_DEFENCE_4_, "lantadyme"],
    [I.DWARF_WEED, I.MAGIC_POTION_4_, "dwarf weed"],
    [I.TORSTOL, I.STAMINA_POTION_4_, "torstol"],
  ];
  const player = active.player, inventory = player.getInventory(), npcId = active.npc.getId();
  const exchange = [...exchanges].reverse().find(([id]) => inventory.containsNumber(id));
  const request = {};
  active.prompt = request;
  const current = () => active.prompt === request && valid(active, player);
  const say = (text, expression) => Flow.chat(api, { player, npcId, lines: [{ text, expression }] });
  const close = () => player.getPacketSender().sendInterfaceRemoval();
  const spare = () => {
    if (current() && serve(active, [I.STRENGTH_POTION_2_])) say(SPARE, SPARE_EXPRESSION);
    else close();
  };
  const reply = (text, onEnd) => Flow.chat(api, { player, npcId,
    pages: [{ player: true, text, expression: PLAYER_EXPRESSION }], onEnd });
  if (!exchange) {
    Flow.chat(api, { player, npcId,
      pages: [{ text: askLine("guam leaf"), expression: ASK_EXPRESSION },
        { player: true, text: "I don't have any.", expression: PLAYER_EXPRESSION }],
      onEnd: spare });
    return;
  }
  const [herbId, potionId, name] = exchange;
  const slot = inventory.getItems().findIndex(item => item?.getId() === herbId && item.getAmount() > 0);
  const herb = inventory.get(slot);
  const trade = () => {
    if (!current()) { close(); return; }
    // The herb moved during the dialogue: nothing to hand over, so he gives the spare potion.
    if (inventory.get(slot) !== herb || herb.getId() !== herbId || herb.getAmount() !== 1) { spare(); return; }
    if (serve(active, [potionId], { slot, item: herb })) say(THANKS, THANKS_EXPRESSION);
  };
  Flow.chat(api, { player, npcId, lines: [{ text: askLine(name), expression: ASK_EXPRESSION }],
    options: [["Here you are.", () => reply("Here you are.", trade)],
      ["No, I need it myself.", () => reply("No, I need it myself.", spare)]] });
}

module.exports = { addDefinition };
