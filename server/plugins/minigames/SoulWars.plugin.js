/**
 * Soul Wars (https://oldschool.runescape.wiki/w/Soul_Wars), built from rsprox recordings
 * (plugins/minigames/data/soul-wars.json). The units are in ./soulwars/:
 * - Lobby: the portals, the waiting area, the queue and countdown;
 * - Match: the instanced arena, teams, HUD, time, the end and Zeal;
 * - Death: graveyards, ghosts, barriers and who may fight whom;
 * - Avatars: strength, defeats and returns;
 * - Control: the obelisk and graveyards changing hands;
 * - Souls: Forgotten Souls, wolves, fragments and the obelisk;
 * - Supplies: the tables, potions, bandages, bones and the activity bar;
 * - Bots: filling the queue on small worlds (world config `SoulWars:seedBots`), and playing;
 * - Rewards: the Nomad's Zeal shop (experience, imbues and the other rewards);
 * - Tutorial: the Nomad's demonstration, needed before a first game;
 * - Scoreboard: the lobby scoreboard's personal and global statistics.
 */
const Common = require("./soulwars/Common.SoulWars");
const Lobby = require("./soulwars/Lobby.SoulWars");
const Match = require("./soulwars/Match.SoulWars");
const Death = require("./soulwars/Death.SoulWars");
const Avatars = require("./soulwars/Avatars.SoulWars");
const Control = require("./soulwars/Control.SoulWars");
const Souls = require("./soulwars/Souls.SoulWars");
const Supplies = require("./soulwars/Supplies.SoulWars");
const Stats = require("./soulwars/Stats.SoulWars");
const Bots = require("./soulwars/Bots.SoulWars");
const Rewards = require("./soulwars/Rewards.SoulWars");
const Tutorial = require("./soulwars/Tutorial.SoulWars");
const Scoreboard = require("./soulwars/Scoreboard.SoulWars");

module.exports = {
  name: "Soul Wars",
  config: {
    "SoulWars:seedBots": {
      type: "boolean", label: "Seed Soul Wars with bots", default: false,
      help: "Development aid: fills the lobby with bots. Leave off so production lobbies are players only.",
    },
    "SoulWars:minPlayers": {
      type: "number", label: "Players needed to start", defaultText: "20, as on the Wiki", integer: true, min: 2,
      help: "Lowest number of players a game needs. Never under 2, since both teams need a player.",
    },
  },
  members: true,
  register(api) {
    Common.init(api);
    Stats.attachStats(api);
    Lobby.attachLobby(api);
    Match.attachMatch(api);
    Death.attachDeath(api);
    Avatars.attachAvatars(api);
    Control.attachControl(api);
    Souls.attachSouls(api);
    Supplies.attachSupplies(api);
    Bots.attachBots(api);
    Rewards.attachRewards(api);
    Tutorial.attachTutorial(api);
    Scoreboard.attachScoreboard(api);
  },
};
