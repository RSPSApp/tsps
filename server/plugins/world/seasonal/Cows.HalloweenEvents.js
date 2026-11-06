"use strict";

// Sarah's scarecrow: a dance emote in her cow pen (transcript
// "spooky-scarecrow-dancing-in-the-cow-pen"). Each cow and calf there answers
// with one of the transcript's four moos; Sarah's dairy cow is scenery and is silent.
const Progress = require("./Progress.HalloweenEvents");
const { cowPen, cowNames, danceEmotes } = require("./data/halloween-2025-scene.json");
const MOOS = Object.freeze(["Mooo", "Moooo", "Mooooo", "Moooooo"]);
let dances;

function inPen(location) {
  return location.getZ() === cowPen.z && location.getX() >= cowPen.minX && location.getX() <= cowPen.maxX &&
    location.getY() >= cowPen.minY && location.getY() <= cowPen.maxY;
}

function danceSequences(api) {
  dances ??= new Set(danceEmotes.map(symbol => api.core.CacheDefinitions.getSeqId(symbol)).filter(id => id !== null));
  return dances;
}

function emote(api, Dialogue, { player, sequence }) {
  if (!Dialogue.active() || !danceSequences(api).has(sequence) || !inPen(player.getLocation())) return;
  for (const npc of api.core.World.getNpcs()) {
    if (!npc?.isRegistered() || !cowNames.includes(npc.getDefinition()?.getName()) || !inPen(npc.getLocation())) continue;
    npc.forceChat(MOOS[Math.floor(Math.random() * MOOS.length)]);
  }
  const state = Progress.read(player);
  if (!state.sarahIntro || state.stage < Progress.STAGE.STARTED || state.stage >= Progress.STAGE.DECORATED) {
    player.sendMessage(Dialogue.messageText("5LkGzx"));
  } else if (!state.sarahEmote) {
    Progress.update(api, player, next => !next.sarahEmote && (next.sarahEmote = true));
    player.sendMessage(Dialogue.messageText("uYcNOR"));
  } else {
    player.sendMessage(Dialogue.messageText("8M1Knx"));
  }
}

module.exports = { emote, inPen };
