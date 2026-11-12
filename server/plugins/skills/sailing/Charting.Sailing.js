// Sailing's sea charting (docs/sea-charting.md): 358 tasks around the seas, of six kinds, each
// charted once into the Captain's log for Sailing XP, with bonuses for whole seas and oceans. The
// units are in ./charting/.
const common = require("./charting/Common.Charting");

module.exports = {
  register(api) {
    common.init(api);
    require("./charting/Progress.Charting")(api);
    require("./charting/Markers.Charting")(api);
    require("./charting/Generic.Charting")(api);
    require("./charting/Spyglass.Charting")(api);
    require("./charting/CurrentDuck.Charting")(api);
    require("./charting/Weather.Charting")(api);
    require("./charting/DrinkCrate.Charting")(api);
    require("./charting/Mermaid.Charting")(api);
    require("./charting/Tutor.Charting")(api);
    require("./charting/Dev.Charting")(api);
  },
};
