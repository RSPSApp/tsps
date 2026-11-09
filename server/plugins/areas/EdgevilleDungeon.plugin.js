/**
 * The Edgeville Dungeon (https://oldschool.runescape.wiki/w/Edgeville_Dungeon), from
 * plugins/areas/data/edgeville-dungeon.json: the brass key door and the area's diary tasks, as
 * captured. Each lives in ./edgevilledungeon/. Obor's and Bryophyta's lairs are the GiantLairs
 * plugin (plugins/bosses). See docs/edgeville-dungeon.md.
 */
const Dungeon = require("./edgevilledungeon/Common.EdgevilleDungeon");

module.exports = {
  name: "EdgevilleDungeon",
  description: "Edgeville Dungeon's brass key door and its achievement diary tasks.",
  register(api) {
    Dungeon.init(api);
    require("./edgevilledungeon/BrassKeyDoor.EdgevilleDungeon")(api);
    require("./edgevilledungeon/Diary.EdgevilleDungeon")(api);
  },
};
