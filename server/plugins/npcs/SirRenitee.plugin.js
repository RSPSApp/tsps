/**
 * Sir Renitee, chief herald of Falador (members).
 *
 * He reports a player's family crest (16 Construction, boostable) and repaints it for a fee
 * (5,000 coins, or 500,000 for the money-bag; 70 Prayer is unboostable for the three god
 * symbols). The crest is randomised the first time it is asked for and kept in a saved
 * attribute. The words are the generated "Sir Renitee" transcript; this plugin only answers its
 * prose conditions, fills the current-crest blank and performs the payment/hand-in action.
 *
 * Source: OSRS Wiki "Sir Renitee" and "Heraldic crest"; the generated dialogue's condition ids
 * and the shared give action rD0rPf.
 */
const CREST_ATTRIBUTE = "heraldry:crest";
const DEFAULT_COST = 5000;
const MONEY_COST = 500000;
const CREST_LEVEL = 16;
const PRAYER_LEVEL = 70;

/** The sixteen options in the transcript, in its order. */
const CRESTS = [
  "Shield of Arrav", "Asgarnia", "Dorgeshuun symbol", "Dragon", "Fairy", "Guthix", "HAM", "Horse",
  "Jogre", "Kandarin", "Misthalin", "Money", "Saradomin", "Skull", "Varrock", "Zamorak",
];

/** How Sir Renitee's table describes each crest, used to fill the reveal line. */
const CREST_NAMES = {
  "Shield of Arrav": "the Shield of Arrav",
  Asgarnia: "the symbol of Asgarnia",
  "Dorgeshuun symbol": "the Dorgeshuun symbol",
  Dragon: "a dragon",
  Fairy: "a fairy",
  Guthix: "the symbol of Guthix",
  HAM: "the symbol of the HAM cult",
  Horse: "a horse",
  Jogre: "a jungle ogre",
  Kandarin: "the symbol of Kandarin",
  Misthalin: "the symbol of Misthalin",
  Money: "a money bag",
  Saradomin: "the symbol of Saradomin",
  Skull: "a skull",
  Varrock: "the symbol of Varrock",
  Zamorak: "the symbol of Zamorak",
};

const TOY_HORSES = new Set([2520, 2521, 2522, 2523, 2524, 2525, 2526, 2527, 14304, 14305, 14306, 14307]);

/**
 * The NPC line that confirms each symbol. The generated transcript's "jump above" for every
 * symbol but Shield of Arrav lost its target and replays the line, so the change is performed
 * once the confirmation line is finished instead of on the shared give action.
 */
const CONFIRMATIONS = {
  Asgarnia: "Ah, splendid, splendid.",
  "Dorgeshuun symbol": "Ah yes, our new neighbours under Lumbridge.",
  Dragon: "I see you are a mighty dragon-slayer!",
  Fairy: "Hmm, mmm, yes, everyone likes pretty fairies.",
  Guthix: "Guthix, god of balance!",
  HAM: "Hmm, I'm not sure I like that HAM group",
  Horse: "Ah, I see you've brought a toy horse",
  Jogre: "A Jungle Ogre, eh?",
  Kandarin: "Our neighbours in the west?",
  Misthalin: "Ah, the fair land of Lumbridge and Varrock.",
  Money: "Thank you very much! You may now use a money-bag",
  Saradomin: "Ah, the great god Saradomin!",
  Skull: "Of... of course you can have a skull symbol",
  Varrock: "Ah, Varrock, a fine city!",
  Zamorak: "The god of Chaos?",
};

const PENDING = new WeakMap();
let api;
let core;

function coins(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS);
}

function prayerLevel(player) {
  return player.getSkillManager().getMaxLevel(core.Skill.PRAYER);
}

function constructionLevel(player) {
  return player.getSkillManager().getCurrentLevel(core.Skill.CONSTRUCTION);
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function hasToyHorse(player) {
  return [...TOY_HORSES].some((id) => player.getInventory().contains(id));
}

/** The saved crest, randomised and stored the first time it is needed. */
function crestFor(player) {
  const saved = player.getAttribute(CREST_ATTRIBUTE);
  if (CRESTS.includes(saved)) return saved;
  const crest = CRESTS[Math.floor(Math.random() * CRESTS.length)];
  player.setAttribute(CREST_ATTRIBUTE, crest);
  return crest;
}

function crestCost(crest) {
  return crest === "Money" ? MONEY_COST : DEFAULT_COST;
}

function changeCrest(player, crest) {
  const cost = crestCost(crest);
  if (coins(player) < cost) {
    player.sendMessage("I don't have that much money on me.");
    return false;
  }
  const previous = crestFor(player);
  player.getInventory().deleteNumber(core.ItemIdentifiers.COINS, cost);
  player.setAttribute(CREST_ATTRIBUTE, crest);
  PENDING.delete(player);
  api.emitCustomEvent("sir-renitee:crest-changed", { player, crest, previous });
  return true;
}

function onCondition({ player, npcId, text, stepId }) {
  if (npcId !== core.NpcIdentifiers.SIR_RENITEE || !player) return null;
  switch (stepId) {
    case "PgNKW-":
      return constructionLevel(player) < CREST_LEVEL;
    case "bWcmMN":
      return coins(player) < DEFAULT_COST;
    case "lz_O44":
      return coins(player) >= DEFAULT_COST;
    case "OIPV81":
      return coins(player) < MONEY_COST;
    case "5tDf73":
      return coins(player) >= MONEY_COST;
    case "rS9uI_":
    case "MybEzI":
    case "DLb4xv":
      return prayerLevel(player) < PRAYER_LEVEL;
    case "hXd87x":
    case "m7Lfzz":
    case "pSHrf2":
      return prayerLevel(player) >= PRAYER_LEVEL;
    case "j62EZO":
      return !questComplete(player, "shield_of_arrav");
    case "ymQodA":
      return questComplete(player, "shield_of_arrav");
    case "PejgPW":
      return !questComplete(player, "the_lost_tribe");
    case "dKyN-7":
      return questComplete(player, "the_lost_tribe");
    case "qg8aZe":
      return !questComplete(player, "dragon_slayer_i");
    case "irbW7_":
      return questComplete(player, "dragon_slayer_i");
    case "_aZ7ih":
      return !questComplete(player, "lost_city");
    case "gB8hQ4":
      return questComplete(player, "lost_city");
    case "aSgK_x":
      return !hasToyHorse(player);
    case "dtgqEg":
      return hasToyHorse(player);
    case "ihsYOW":
      return player.isSkulled() !== true;
    case "FjSslP":
      return player.isSkulled() === true;
    default:
      return null;
  }
}

/** Fills the reveal line, finishes a crest change and credits the easy discovery task. */
function onLine(request) {
  if (request.npcId !== core.NpcIdentifiers.SIR_RENITEE || typeof request.text !== "string") return;
  const pending = PENDING.get(request.player);
  if (pending && CONFIRMATIONS[pending] && request.text.includes(CONFIRMATIONS[pending])) {
    request.after = () => {
      changeCrest(request.player, pending);
      request.player.getDialogueManager().reset();
      request.player.getPacketSender().sendInterfaceRemoval();
    };
    return;
  }
  if (!request.text.includes("[current family crest]")) return;
  const crest = crestFor(request.player);
  request.text = request.text.replace(/\[current family crest\]/gi, CREST_NAMES[crest] ?? crest);
  request.after = () => api.emitCustomEvent("sir-renitee:crest-identified", { player: request.player });
}

function onChoice({ player, npcId, option }) {
  if (npcId !== core.NpcIdentifiers.SIR_RENITEE || !player) return;
  if (CRESTS.includes(option)) PENDING.set(player, option);
}

/** The transcript's shared "give 5,000 coins" action, used by every symbol except Money. */
function onAction(event) {
  if (event.npcId !== core.NpcIdentifiers.SIR_RENITEE || !event.player) return;
  if (event.stepId !== "rD0rPf" || event.action !== "give") return;
  const crest = PENDING.get(event.player);
  if (!crest || crest === "Money") return;
  event.handled = true;
  changeCrest(event.player, crest);
}

function bind(registry) {
  api = registry;
  core = registry.core;
  api.persistAttribute(CREST_ATTRIBUTE);
  api.onNpcDialogueCondition(onCondition);
  api.onCustomEvent("npc-dialogue:line", onLine);
  api.onCustomEvent("npc-dialogue:choice", onChoice);
  api.onCustomEvent("npc-dialogue:action", onAction);
}

module.exports = {
  name: "SirRenitee",
  members: true,
  register(registry) {
    bind(registry);
  },
  _test: { CRESTS, CREST_ATTRIBUTE, crestFor, crestCost, changeCrest, onCondition, onLine, onChoice, onAction },
};
