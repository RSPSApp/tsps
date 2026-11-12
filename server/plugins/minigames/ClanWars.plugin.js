/** Bounded legacy chat-channel melee-only LTS, kill-target and timed battles. See docs/clan-wars.md. */
const C = require("./clanwars/Common.ClanWars");
const Match = require("./clanwars/Match.ClanWars");
const Negotiation = require("./clanwars/Negotiation.ClanWars");
const Viewing = require("./clanwars/Viewing.ClanWars");

function entered({ player }) { if (C.inLobby(player)) player.getPacketSender().sendPlayerOption(4, "Challenge"); }
function left({ player }) { Negotiation.cancelPlayer(player); player.getPacketSender().sendPlayerOption(4, ""); }
function toggleXp({ player }) {
  C.api.emitCustomEvent("clan-wars:xp-setting", { player, toggle: true });
}
function blockXp(event) {
  if (!C.matches.has(event.player)) return;
  const query = { player: event.player, disabled: false };
  C.api.emitCustomEvent("clan-wars:xp-setting", query);
  if (query.disabled) event.allow = false;
}
function attach(api) {
  C.init(api);
  Match.attach(api);
  Negotiation.attach(api);
  Viewing.attach(api);
  api.onZoneEnter({ ...C.LOBBY, levels: [0] }, entered);
  api.onZoneExit({ ...C.LOBBY, levels: [0] }, left);
  api.onServerShutdown(Negotiation.shutdown);
}
module.exports = {
  name: "ClanWars",
  description: "Adds bounded Clan Wars: legacy chat-channel, melee-only Last Team Standing, kill-target and timed battles played through the challenge and exit portals.",
  register(api) {
    attach(api);
    api.onObjectInteraction("Challenge portal", { Enter: Match.enter, Join: Match.enter, "Disable-XP": toggleXp });
    api.onObjectInteraction("Exit portal", { Forfeit: Match.leave });
    api.onObjectInteraction("Portal", { Exit: Match.exit });
    api.onObjectInteraction("Viewing orb", { Use: Viewing.use });
    api.onCanGainExperience(blockXp);
  },
};
