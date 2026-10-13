/**
 * The Sisterhood Sanctuary's side of the fight, as captured:
 * - the Pool of Nightmares (multiloc 29710) shows Drink-from while varbit 10237 is 1; open to all
 *   since August 2022 (Wiki), so it is set at login;
 * - the first drink has Sister Senga stop the player and tell them about Phosani (her lines as
 *   captured, setting varbits 12419 and 10240 as it goes); later drinks go straight to the warning;
 * - Shura (multinpc 9459) and Sister Senga (9473) gain Collect once the player has been in their
 *   dream (varbits 10137 and 10239), kept for later logins.
 */
const Common = require("./Common.Nightmare");
const Dream = require("./Dream.Nightmare");

const FIRST_ENTRY_ATTRIBUTE = "nightmare:first-entry";
const PHOSANI_FIRST_ENTRY_ATTRIBUTE = "nightmare:phosani-first-entry";
const SENGA = 9472;

const SENGA_INTRO = [
  ["npc", "I would advise against doing that, traveller. You do not yet know what you are up against."],
  ["player", "What are you doing up here?"],
  ["npc", "Keeping an eye on Mother."],
  ["player", "Mother?"],
  ["npc", "Phosani, the founder of our sect and creator of this sanctuary. She is our mother, and always will be."],
  ["player", "I see... So where is she?"],
  ["npc", "She lies in this coffin."],
  ["player", "Oh... So she's dead?"],
  ["npc", "Dead? No. She sleeps the everlasting slumber."],
  ["player", "Right. The coffin looks pretty secure to me. Why do you need to keep an eye on her?"],
  ["npc", "The creature down there, the one that Siren calls the Nightmare. It has been invading Mother's mind, feeding on her."],
  ["npc", "Mother is strong, but not strong enough to fight it off alone. She needs help."],
  ["player", "Needs help does she? Maybe I could be of assistance?"],
  ["varbit", "phosaniSkipIntro"],
  ["npc", "That would be appreciated, traveller. You can use the pool here to enter Mother's mind and take on the Nightmare within."],
  ["npc", "Be warned though. If you enter, you enter alone. No one else can help you with this one."],
  ["player", "I see. I'll have to be careful then."],
  ["varbit", "phosaniIntro"],
  ["npc", "Indeed. Good luck, traveller."],
];

/**
 * Sister Senga's lines, as chains that each end in an action: an ActionDialogue shows nothing, so
 * one mid-chain would leave the player on a line they can't continue. Each varbit the capture sets
 * part-way is set as the next chain starts.
 */
function sengaIntro(player, from = 0) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue } = Common.core;
  const chain = new DialogueChainBuilder();
  let index = 0;
  let at = from;
  for (; at < SENGA_INTRO.length; at++) {
    const [kind, text] = SENGA_INTRO[at];
    if (kind === "varbit") break;
    chain.add(kind === "npc" ? new NpcDialogue(index++, SENGA, text) : new PlayerDialogue(index++, text));
  }
  const next = SENGA_INTRO[at];
  chain.add(new ActionDialogue(index, {
    execute: () => {
      if (next) {
        player.getPacketSender().sendVarbit(Common.data.varbits[next[1]], 1);
        sengaIntro(player, at + 1);
        return;
      }
      player.setAttribute(Common.PHOSANI_INTRO_ATTRIBUTE, true);
      player.getPacketSender().sendInterfaceRemoval();
    },
  }));
  player.getDialogueManager().startDialogues(chain);
}

function drinkFrom({ player }) {
  if (!player.getAttribute(Common.PHOSANI_INTRO_ATTRIBUTE)) {
    sengaIntro(player);
    return true;
  }
  Dream.drinkFromPool(player);
  return true;
}

/** Keeps Shura's and Sister Senga's Collect, and opens the Pool, for this login. */
function syncVarbits({ player }) {
  const sender = player.getPacketSender();
  const { varbits } = Common.data;
  sender.sendVarbit(varbits.poolEnabled, 1);
  if (player.getAttribute(FIRST_ENTRY_ATTRIBUTE)) sender.sendVarbit(varbits.firstEntry, 1);
  if (player.getAttribute(PHOSANI_FIRST_ENTRY_ATTRIBUTE)) sender.sendVarbit(varbits.phosaniFirstEntry, 1);
  if (player.getAttribute(Common.PHOSANI_INTRO_ATTRIBUTE)) {
    sender.sendVarbit(varbits.phosaniSkipIntro, 1);
    sender.sendVarbit(varbits.phosaniIntro, 1);
  }
}

/** Entering a dream unlocks Collect on its keeper. */
function enteredDream(player, phosani) {
  player.setAttribute(phosani ? PHOSANI_FIRST_ENTRY_ATTRIBUTE : FIRST_ENTRY_ATTRIBUTE, true);
}

function attachSanctuary(api) {
  api.persistAttribute(FIRST_ENTRY_ATTRIBUTE);
  api.persistAttribute(PHOSANI_FIRST_ENTRY_ATTRIBUTE);
  api.persistAttribute(Common.PHOSANI_INTRO_ATTRIBUTE);
  api.onPlayerLogin(syncVarbits);
  api.onObjectInteraction("Pool of Nightmares", { "Drink-from": drinkFrom });
}

module.exports = { attachSanctuary, enteredDream };
