"use strict";

const { PluginManager } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Prizes = require("./Prizes.Construction");

// Hangman (rsprox captures, Wiki): Activate says "You activate the hangman game." and the hidden
// word ("Hangman word: _______") to everyone in the house, and the mannequin (poh_hangman_armour1)
// stands in for the game. Guess-letter opens poh_hangman in the chatbox with the word: a click on a
// letter guesses it; "Guess" switches to picking up to five of the remaining letters ("You can only
// guess five letters."), all of which must be in the word, and a second click sends them. A wrong
// guess dresses the mannequin in one more piece (armour1..armour10) and plays synth 970; the tenth
// ends the game. "You've just had your turn." stops one player guessing twice running while others
// play. Filling the word in wins: "Hangman word: ICEGIANT! <name> is the winner!". Words are the
// Wiki's list. The no-winner ending and its message are this server's.
const INTERFACE = Ids.iface("poh_hangman");
const LETTERS = 26; // poh_hangman_letter1..26 are components 0..25
const GUESS_BUTTON = 27;
const GUESS_BOX = 28;
const WORD_BOX = 29;
const INSTRUCTIONS = 31;
// The mannequin, one form per wrong guess: poh_hangman_armour1 to poh_hangman_armour10.
const MANNEQUIN = Array.from({ length: 10 }, (_, index) => Ids.npc(`poh_hangman_armour${index + 1}`));
const PIECES = 10;
const WRONG_SOUND = 970;
const MAX_GUESS = 5;
const WORDS = [
  "ABYSSAL", "ADAMANTITE", "ALKHARID", "ARDOUGNE", "ASGARNIA", "AVANTOE", "BANSHEE", "BARROWS", "BASILISK", "BLOODVELD",
  "BOBTHECAT", "BRIMHAVEN", "BURTHORPE", "CADANTINE", "CAMELOT", "CANIFIS", "CATHERBY", "CHAOSDRUID", "CHAOSDWARF",
  "CHOMPYBIRD", "COCKATRICE", "CRANDOR", "DAGANNOTH", "DORGESHUUN", "DRAGON", "DRAYNOR", "DUSTDEVIL", "DWARFWEED",
  "EDGEVILLE", "ENTRANA", "FALADOR", "FELDIP", "FIREGIANT", "FREMENNIK", "GARGOYLE", "GOBLIN", "GRANDTREE", "GUAMLEAF",
  "GUTANOTH", "GUTHIX", "HELLHOUND", "HIGHWAYMAN", "HILLGIANT", "HOBGOBLIN", "ICEGIANT", "ICEQUEEN", "ICETROLL",
  "ICEWARRIOR", "ICEWOLF", "IRITLEAF", "ISAFDAR", "JOGRE", "KALPHITE", "KANDARIN", "KARAMJA", "KELDAGRIM", "KHAZARD",
  "KWUARM", "LANTADYME", "LLETYA", "LUMBRIDGE", "MARRENTILL", "MENAPHOS", "MISTHALIN", "MITHRIL", "MORTTON", "MORYTANIA",
  "MOSSGIANT", "NECHRYAEL", "NIGHTSHADE", "PALADIN", "PHASMATYS", "PORTSARIM", "PRIFDDINAS", "PYREFIEND", "RANARRWEED",
  "RELLEKKA", "RIMMINGTON", "RUNESCAPE", "RUNITE", "SARADOMIN", "SKELETON", "SNAPDRAGON", "SNAPEGRASS", "SOPHANEM",
  "SOULLESS", "SPIRITTREE", "TARROMIN", "TAVERLEY", "TERRORBIRD", "TIRANNWN", "TOADFLAX", "TORSTOL", "UGTHANKI",
  "UNICORN", "VARROCK", "YANILLE", "ZAMORAK",
];

/** house -> { word, found: Set, wrong, npc, furniture, last } */
const games = new WeakMap();
/** player -> letters picked in "Guess" mode, or undefined in single-letter mode */
const picking = new WeakMap();

function pattern(game) {
  return [...game.word].map(letter => (game.found.has(letter) ? letter : "_")).join("");
}

function tellHouse(house, text) {
  for (const player of house.getPlayers()) player.sendMessage(text);
}

function activate(event) {
  const player = event.player;
  const house = House.houseFor(player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  if (furniture?.buildableKey !== "HANGMAN") return false;
  if (house.buildingMode) return player.sendMessage("You cannot start a game while in building mode."), true;
  if (games.has(house)) return player.sendMessage("A game of hangman is already being played."), true;
  Prizes.offer(player, house, "hangman", () => start(player, house, furniture, event.location));
  return true;
}

function start(player, house, furniture, location) {
  if (games.has(house) || House.houseFor(player) !== house || house.buildingMode) return;
  const npc = PluginManager.spawnNpc({ id: MANNEQUIN[0], x: location.x, y: location.y, z: location.z, wanderRadius: 0 });
  if (!npc) return;
  npc.__skipDefaultRespawn = true;
  house.enter(npc);
  house.hideFurniture(furniture);
  const game = { word: WORDS[Math.floor(Math.random() * WORDS.length)], found: new Set(), wrong: 0, npc, furniture, last: null };
  games.set(house, game);
  player.sendMessage("You activate the hangman game.");
  tellHouse(house, `Hangman word: ${pattern(game)}`);
}

function gameFor(event) {
  const house = House.houseFor(event.player);
  const game = house && games.get(house);
  return game && game.npc === event.npc ? { house, game } : null;
}

function guessLetter(event) {
  const found = gameFor(event);
  if (!found) return false;
  picking.delete(event.player);
  openBoard(event.player, found.game);
  return true;
}

function openBoard(player, game) {
  const sender = player.getPacketSender();
  sender.sendString(pattern(game), (INTERFACE << 16) | WORD_BOX);
  sender.sendString("", (INTERFACE << 16) | GUESS_BOX);
  sender.sendInterfaceDisplayState((INTERFACE << 16) | INSTRUCTIONS, true);
  sender.sendChatboxInterface(INTERFACE);
}

function banish(event) {
  const found = gameFor(event);
  if (!found) return false;
  end(found.house, found.game);
  return true;
}

function interfaceClick(event) {
  if (event.groupId !== INTERFACE) return;
  event.handled = true;
  const player = event.player;
  const house = House.houseFor(player);
  const game = house && games.get(house);
  if (!game) return player.getPacketSender().sendInterfaceRemoval();
  const sender = player.getPacketSender();
  if (event.childId === GUESS_BUTTON) {
    const picked = picking.get(player);
    if (!picked) {
      picking.set(player, []);
      sender.sendInterfaceDisplayState((INTERFACE << 16) | INSTRUCTIONS, false);
      return;
    }
    picking.delete(player);
    if (picked.length) guess(player, house, game, picked);
    return;
  }
  if (event.childId < 0 || event.childId >= LETTERS) return;
  const letter = String.fromCharCode(65 + event.childId);
  const picked = picking.get(player);
  if (!picked) return guess(player, house, game, [letter]);
  if (picked.includes(letter) || game.found.has(letter)) return;
  if (picked.length >= MAX_GUESS) return player.getPacketSender().sendMessage("You can only guess five letters.");
  picked.push(letter);
  sender.sendString(picked.join(""), (INTERFACE << 16) | GUESS_BOX);
}

function guess(player, house, game, letters) {
  const others = house.getPlayers().some(other => other !== player);
  if (game.last === player && others) {
    player.getPacketSender().sendInterfaceRemoval();
    return player.sendMessage("You've just had your turn.");
  }
  game.last = player;
  const right = letters.every(letter => game.word.includes(letter) && !game.found.has(letter));
  if (right) {
    for (const letter of letters) game.found.add(letter);
  } else {
    game.wrong++;
    for (const occupant of house.getPlayers()) occupant.getPacketSender().sendSound(WRONG_SOUND, 0, 0);
    if (game.wrong < PIECES) game.npc.setNpcTransformationId?.(MANNEQUIN[game.wrong]);
  }
  const shown = pattern(game);
  if (!shown.includes("_")) {
    player.getPacketSender().sendInterfaceRemoval();
    tellHouse(house, `Hangman word: ${game.word}! ${player.getDisplayName()} is the winner!`);
    Prizes.award(house, "hangman", player);
    return end(house, game);
  }
  if (game.wrong >= PIECES) {
    player.getPacketSender().sendInterfaceRemoval();
    tellHouse(house, `Hangman word: ${game.word}! The mannequin is fully dressed: nobody wins.`);
    return end(house, game);
  }
  game.npc.forceChat(shown);
  tellHouse(house, `Hangman word: ${shown}`);
  openBoard(player, game);
}

function end(house, game) {
  games.delete(house);
  Prizes.withdraw(house, "hangman");
  if (game.npc.isRegistered()) {
    house.leave(game.npc, false);
    PluginManager.removeNpc(game.npc);
  }
  house.showFurniture(game.furniture);
}

/** Instance.rebuild in building mode: the game is packed away. */
function resetHangman(house) {
  const game = games.get(house);
  if (game && house.buildingMode) end(house, game);
}

function attachHangman(api) {
  api.onObjectInteraction("Hangman game", { Activate: activate });
  api.onNpcInteraction("Hangman game", { "Guess-letter": guessLetter, Banish: banish });
  api.onInterfaceActionClick(interfaceClick);
}

Object.assign(module.exports, { attachHangman, resetHangman });
