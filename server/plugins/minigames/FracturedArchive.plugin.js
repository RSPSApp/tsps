"use strict";

/**
 * The Fractured Archive (Raids 4): the Chasm of Tears shortcut, the lobby (parties, the records,
 * the Ascension rocks, spectating) and the raid: the Archive Guardian, the Nexus between rooms,
 * Bork, Ezekiel, Dreadnoth with the Quartermaster, Xarth, Ocellus and the vault. Each unit lives
 * in ./tfa/; add one line per unit. docs/fractured-archive.md.
 */
module.exports = {
  name: "FracturedArchive",
  members: true,
  register(api) {
    require("./tfa/Entry.FracturedArchive")(api);
    require("./tfa/Lobby.FracturedArchive")(api);
    require("./tfa/Gathering.FracturedArchive")(api);
    require("./tfa/Grouping.FracturedArchive")(api);
    require("./tfa/Records.FracturedArchive")(api);
    require("./tfa/Raid.FracturedArchive")(api);
    require("./tfa/Guardian.FracturedArchive")(api);
    require("./tfa/Hub.FracturedArchive")(api);
    require("./tfa/Bork.FracturedArchive")(api);
    require("./tfa/Ezekiel.FracturedArchive")(api);
    require("./tfa/Dreadnoth.FracturedArchive")(api);
    require("./tfa/Quartermaster.FracturedArchive")(api);
    require("./tfa/Xarth.FracturedArchive")(api);
    require("./tfa/Ocellus.FracturedArchive")(api);
    require("./tfa/Vault.FracturedArchive")(api);
    require("./tfa/Spectate.FracturedArchive")(api);
    require("./tfa/Commands.FracturedArchive")(api);
  },
};
