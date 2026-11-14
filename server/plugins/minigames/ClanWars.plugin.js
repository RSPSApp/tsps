/** Bounded legacy chat-channel team battles with optional elemental Magic. See docs/clan-wars.md. */
const C = require("./clanwars/Common.ClanWars");
const Match = require("./clanwars/Match.ClanWars");
const Negotiation = require("./clanwars/Negotiation.ClanWars");
const Viewing = require("./clanwars/Viewing.ClanWars");
const Restrictions = require("./clanwars/Restrictions.ClanWars");

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
  Restrictions.attach(api);
  api.onZoneEnter({ ...C.LOBBY, levels: [0] }, entered);
  api.onZoneExit({ ...C.LOBBY, levels: [0] }, left);
  api.onServerShutdown(Negotiation.shutdown);
}
module.exports = {
  name: "ClanWars",
  description: "Adds bounded Clan Wars: legacy chat-channel Last Team Standing, kill-target and timed battles, melee with optional standard elemental Magic. Casting supports basic/elemental staves and elemental tomes, spends runes and charges normally, and discards queued battle hits without refund at participation boundaries.",
  register(api) {
    attach(api);
    api.onObjectInteraction("Challenge portal", { Enter: Match.enter, Join: Match.enter, "Disable-XP": toggleXp });
    api.onObjectInteraction("Exit portal", { Forfeit: Match.forfeit });
    api.onObjectInteraction("Portal", { Exit: Match.exit });
    api.onObjectInteraction("Viewing orb", { Use: Viewing.use });
    api.onCanGainExperience(blockXp);
  },
};
