const Journal = require("./adventurepaths/Journal.AdventurePaths");
const Dialogue = require("./adventurepaths/Dialogue.AdventurePaths");
const Items = require("./adventurepaths/Items.AdventurePaths");
const Interface = require("./adventurepaths/Interface.AdventurePaths");
const Progress = require("./adventurepaths/Progress.AdventurePaths");
module.exports = {
    name: "AdventurePaths",
    description: "Adventure Paths with Adventurer Jon: the Combat and Gatherer paths, task claims, starter kits, the Combat voucher and the Lamp of the Gatherer.",
    register(api) {
        Progress.attach(api);
        Interface.attach(api);
        Items.attach(api);
        Dialogue.attach(api);
        Journal.attach(api);
    },
};
