"use strict";

// Presentation only. Deployments keep the selected legacy routine ID.
module.exports = {
  woodcutting: { label: "Woodcutting", profileLabel: "Tree type", defaultProfile: "normal_trees", profiles: { normal_trees: "Normal trees", oak_trees: "Oak trees", willow_trees: "Willow trees", yew_trees: "Yew trees" } },
  mining: { label: "Mining", profileLabel: "Ore", defaultProfile: "copper_tin_rocks", profiles: { copper_tin_rocks: "Copper and tin", iron_rocks: "Iron", coal_rocks: "Coal", mithril_rocks: "Mithril" } },
  fishing: { label: "Fishing", profileLabel: "Fishing method", defaultProfile: "net_fishing", profiles: { net_fishing: "Small net", fly_fishing: "Fly fishing", lobster_fishing: "Lobsters", harpoon_fishing: "Harpoon" } },
};
