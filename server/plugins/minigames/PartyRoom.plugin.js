"use strict";

/**
 * The Falador Party Room (Wiki: Party Room, Party chest, Party balloon). The rules are in
 * ./partyroom/Room.PartyRoom.js, the chest's file in ./partyroom/Store.PartyRoom.js, and the offer
 * screen it shares with Clan Halls in interface/partychest.
 */
const Room = require("./partyroom/Room.PartyRoom");

module.exports = {
  name: "PartyRoom",
  register(api) {
    Room.attach(api);
  },
};
