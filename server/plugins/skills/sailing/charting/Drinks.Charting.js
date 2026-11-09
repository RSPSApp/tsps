// Chartin' Charles McAtless's drinks ("Can you tell me about these drinks?", his Wiki transcript):
// after a drink's description and its keg line, he sells it once enough seas are completely
// charted, a glass for 300 coins or a keg's worth (25, noted) for 7,500:
//   kraken ink stout: five seas in the Ardent Ocean and five in the Unquiet Ocean;
//   perildance bitter: eight in the Western Ocean and five in the Shrouded Ocean;
//   trawler's trust: 50 seas; horizon's lure: 70 seas.
// The transcript's options for the last three are incomplete, so picking a drink plays its
// branch from here, in the kraken ink stout's words; "Actually, let's talk about something
// else." goes back to his first menu.
const common = require("./Common.Charting");

const NAME = "Chartin' Charles McAtless";
/** Charles and his visible form (Tutor.Charting.js); his lines speak as the form, which has a head. */
const CHARLES = Object.freeze([15151, 1554, 288]);
const SPEAKER = 1554;
const COINS = 995;
const GLASS_PRICE = 300;
const KEG_COUNT = 25;
const SOMETHING_ELSE = "Actually, let's talk about something else.";

const DRINKS = Object.freeze([
  {
    option: "Kraken ink stout.", name: "kraken ink stout", glass: 31814, noted: 31815,
    about: [
      "Well, kraken ink stout is the perfect drink if you consider yourself a bit of a magical sailor as it's said to improve both your sailing and magical abilities.",
      "Many claim that it also increases the likelihood of encountering interesting things while out at sea. I'm not sure how a drink does that, but the world works in strange ways.",
    ],
    keg: "Having a keg of kraken ink stout on your boat will improve the chance of random encounters spawning at sea by 4%.",
    oceans: [["Ardent Ocean", 5], ["Unquiet Ocean", 5]],
    requires: "Completely chart five seas in the Ardent Ocean. Completely chart five seas in the Unquiet Ocean.",
  },
  {
    option: "Perildance bitter.", name: "perildance bitter", glass: 31817, noted: 31818,
    about: [
      "Ah, they say perildance bitter is the best drink you'll find for a sailor who likes to get themselves into a fight or two. It will supposedly improve your strength, along with your sailing and ranging abilities.",
      "But that's not all, for plenty of sailors also claim that a bit of perildance bitter has helped them out of a tight spot by improving their ability to man their boat cannons.",
    ],
    keg: "Having a keg of perildance bitter on your boat will increase the max hit of your cannons by one.",
    oceans: [["Western Ocean", 8], ["Shrouded Ocean", 5]],
    requires: "Completely chart eight seas in the Western Ocean. Completely chart five seas in the Shrouded Ocean.",
  },
  {
    option: "Trawler's trust.", name: "trawler's trust", glass: 31820, noted: 31821,
    about: [
      "Well, as the name suggests, trawler's trust is the drink you want if you're planning to head out trawling. It's said to improve both your sailing and fishing abilities.",
      "I've been told before that drinking it also helps you catch more fish when out deep sea trawling.",
    ],
    keg: "Having a keg of trawler's trust on your boat will give a 5% chance to catch an extra fish whilst deep sea trawling.",
    seas: 50,
    requires: "Completely chart 50 seas across all oceans.",
  },
  {
    option: "Horizon's lure.", name: "horizon's lure", glass: 31823, noted: 31824,
    about: [
      "Ah, the old classic. In many ways, there's nothing too fancy about horizon's lure. It's quite simply the perfect drink when all you care about is sailing.",
      "Not only is it said to make you a better sailor, but it apparently also helps you improve your sailing abilities faster.",
    ],
    keg: "Having a keg of horizon's lure on your boat will give a 2.5% boost to all Sailing experience gained.",
    seas: 70,
    requires: "Completely chart 70 seas across all oceans.",
  },
]);

/** The seas the player has completely charted, as their ocean names. */
function chartedSeas(player) {
  const charted = new Set(common.progress(player).charted);
  const SEA = 0;
  common.allSpots(); // fills in each sea's spots
  return [...common.allSeas().values()]
    .filter((sea) => sea.type === SEA && sea.spots.length > 0 && sea.spots.every((spot) => charted.has(spot.uid)))
    .map((sea) => sea.ocean?.name ?? "");
}

/** Whether the player has charted enough to buy a drink. */
function canBuy(player, drink) {
  const seas = chartedSeas(player);
  if (drink.seas !== undefined) return seas.length >= drink.seas;
  return drink.oceans.every(([ocean, count]) => seas.filter((name) => name === ocean).length >= count);
}

function chain() {
  const { DialogueChainBuilder } = common.core();
  const builder = new DialogueChainBuilder();
  let index = 0;
  const add = (dialogue) => builder.add(dialogue);
  return {
    npc: (text) => add(new (common.core().NpcDialogue)(index++, SPEAKER, text, NAME)),
    player: (text) => add(new (common.core().PlayerDialogue)(index++, text)),
    item: (item, text) => add(new (common.core().ItemStatementDialogue)(index++, item, text)),
    then: (execute) => add(new (common.core().ActionDialogue)(index++, { execute })),
    start: (player) => player.getDialogueManager().startDialogues(builder),
  };
}

/** "Select an option": the four drinks, or back to his first menu. */
function drinksMenu(player) {
  const pairs = DRINKS.flatMap((drink) => [drink.option, () => describe(player, drink)]);
  common.api().sendMultiChatboxPrompt(player, "Select an option", ...pairs, SOMETHING_ELSE, () => somethingElse(player));
}

function somethingElse(player) {
  const lines = chain();
  lines.player(SOMETHING_ELSE);
  lines.then(() => common.api().emitCustomEvent("npc-dialogue:start", { player, npcId: CHARLES[0], handled: false }));
  lines.start(player);
}

function askAnother(player, text) {
  const lines = chain();
  lines.npc(text);
  lines.then(() => drinksMenu(player));
  lines.start(player);
}

/** A drink picked from the menu: what he says about it, its keg, and whether he'll sell it. */
function describe(player, drink) {
  const lines = chain();
  lines.player(drink.option);
  for (const line of drink.about) lines.npc(line);
  lines.item(drink.glass, drink.keg);
  if (!canBuy(player, drink)) {
    lines.npc("While I'd love to sell you some, I'm afraid you need to do some more charting first.");
    lines.item(drink.glass, `Buying ${drink.name} requires the following: ${drink.requires}`);
    lines.npc("Would you like me to tell you about a different drink?");
    lines.then(() => drinksMenu(player));
  } else {
    lines.npc("Anyway, I'm pleased to say that you've done enough charting for me to sell you some! Would you like to buy a glass to sample it? Or do you want enough to fill a keg?");
    lines.then(() => common.api().sendMultiChatboxPrompt(player, `How much ${drink.name} would you like to buy?`,
      "A glass (1).", () => offer(player, drink, 1),
      `A keg full (${KEG_COUNT}).`, () => offer(player, drink, KEG_COUNT),
      "None (0).", () => pass(player)));
  }
  lines.start(player);
}

function pass(player) {
  const lines = chain();
  lines.player("Actually, I'll pass.");
  lines.then(() => askAnother(player, "Very well. Would you like me to tell you about a different drink?"));
  lines.start(player);
}

function offer(player, drink, count) {
  const price = count === 1 ? GLASS_PRICE : GLASS_PRICE * count;
  common.api().sendMultiChatboxPrompt(player, `Buy ${count} x ${drink.name} for ${price.toLocaleString("en-US")} coins?`,
    "Yes.", () => buy(player, drink, count, price),
    "No.", () => pass(player));
}

/** The sale: a glass, or the keg's worth noted. Without the coins or the room he says so. */
function buy(player, drink, count, price) {
  const inventory = player.getInventory();
  const item = count === 1 ? drink.glass : drink.noted;
  // Paying every coin frees their slot for the drink.
  const room = inventory.canTake(new (common.core().Item)(item, count)) || inventory.getAmount(COINS) === price;
  if (inventory.getAmount(COINS) < price || !room) {
    askAnother(player, "Even I can see you don't have space to hold that, and just to be completely clear, I am totally blind!");
    return;
  }
  inventory.delete(COINS, price);
  inventory.add(new (common.core().Item)(item, count));
  const lines = chain();
  lines.item(item, `Charles sells you ${count} x ${drink.name}.`);
  lines.then(() => askAnother(player, "There you go! Enjoy! Now, are you interested in any other drinks?"));
  lines.start(player);
}

/** His drinks menu's options: a drink plays its branch here instead of the transcript's. */
function onChoice(event) {
  if (!CHARLES.includes(event.npcId)) return;
  const drink = DRINKS.find((candidate) => candidate.option === event.option);
  if (!drink) return;
  event.end = true;
  describe(event.player, drink);
}

function attach(api) {
  common.init(api);
  api.onCustomEvent("npc-dialogue:choice", onChoice);
}

module.exports = attach;
module.exports.DRINKS = DRINKS;
module.exports.canBuy = canBuy;
module.exports.describe = describe;
module.exports.buy = buy;
