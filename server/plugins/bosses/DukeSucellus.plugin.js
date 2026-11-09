"use strict";
const Common = require("./dukesucellus/Common.DukeSucellus");
const Site = require("./dukesucellus/Site.DukeSucellus");
const Preparation = require("./dukesucellus/Preparation.DukeSucellus");
const Records = require("./dukesucellus/Records.DukeSucellus");
const Fight = require("./dukesucellus/Fight.DukeSucellus");
module.exports = {
    name: "Duke Sucellus",
    description: "Duke Sucellus: his site, the preparation, the kill records and the fight.",
    members: true,
    register(api) {
        Common.init(api);
        Site.attach(api);
        Preparation.attach(api);
        Fight.attach(api);
Records.attach(api);
    },
};
