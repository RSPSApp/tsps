"use strict";

/**
 * The Archive's lobby: the party overlay (tfa_lobby, 975) while inside it, leaving a party on
 * the way out, and the raid's saved varbits at login.
 *
 * Captured: 975 opens on overlay_hud as you arrive, with the party's eight names on 975:5, and
 * closes as you go into the Archive. The Record Keeper's and General Montoya's conversations are
 * their transcripts in npc-dialogues.json; Montoya quotes Armacus about "her eyes" to a female
 * character, so the pronoun follows the player's.
 */

const Shared = require("./Shared.FracturedArchive");
const Grouping = require("./Grouping.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const GENERAL_MONTOYA = "General Montoya";
const PRONOUN = "[his/her]";

function createLobbyArea(api) {
  const { Area, Boundary } = api.core;
  const { LOBBY } = Shared;
  class ArchiveLobby extends Area {
    getName() {
      return "The Fractured Archive lobby";
    }

    postEnter(mobile) {
      if (mobile.isPlayer?.()) enterLobby(mobile.getAsPlayer());
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) leaveLobby(mobile.getAsPlayer(), logout);
    }
  }
  return new ArchiveLobby([new Boundary(LOBBY.minX, LOBBY.maxX, LOBBY.minY, LOBBY.maxY, LOBBY.z)]);
}

function enterLobby(player) {
  if (Raid.raidOf(player)?.member(player).roomKey) return;
  player.getPacketSender().sendSubInterface(Shared.id("component", "OVERLAY_HUD"), Shared.id("iface", "LOBBY"), 1);
  Grouping.refreshOverlay(player);
}

/** Out of the lobby, other than into the Archive: out of the party and any application. */
function leaveLobby(player, logout) {
  if (Raid.raidOf(player)) return;
  if (!logout) player.getPacketSender().closeSubInterface(Shared.id("component", "OVERLAY_HUD"));
  Grouping.leaveLobby(player);
}

/** "[his/her]" in Montoya's lines, by the player's appearance. */
function fillPronoun(request) {
  if (request.definition?.getName?.() !== GENERAL_MONTOYA || !String(request.text ?? "").includes(PRONOUN)) return;
  const male = request.player?.getAppearance?.()?.isMale?.() !== false;
  request.text = request.text.replace(PRONOUN, male ? "his" : "her");
}

module.exports = function registerLobby(api) {
  Shared.bind(api);
  api.registerArea(createLobbyArea(api));
  api.onCustomEvent("npc-dialogue:line", fillPronoun);
};

Object.assign(module.exports, { enterLobby, leaveLobby, fillPronoun });
