const fs = require("fs");
const path = require("path");
const { effectiveFile, commitWorldFiles } = require("./MapEditFiles");

const filePath = () => path.resolve(process.cwd(), "data/definitions/ground-items-custom.json");

function readGroundItemEdits() {
  const file = effectiveFile(filePath());
  return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

function updateGroundItem(placement, remove) {
  const same = ({ id, location }) => id === placement.id && location.x === placement.location.x
    && location.y === placement.location.y && location.z === placement.location.z;
  const spawns = readGroundItemEdits();
  const existing = spawns.findIndex(same);
  if (remove && existing < 0) return false;
  if (remove) spawns.splice(existing, 1);
  else if (existing < 0) spawns.push(placement);
  else spawns[existing] = { ...spawns[existing], ...placement };
  commitWorldFiles(new Map([[filePath(), JSON.stringify(spawns, null, 2) + "\n"]]));
  return true;
}

module.exports = {
  name: "GroundItemsEditor",
  description: "Loads ground item placements saved by the map editor.",
  readGroundItemEdits,
  updateGroundItem,
  register(api) {
    api.registerDefinitionSource("ground_items", { name: "map-editor", load: readGroundItemEdits });
  },
};
