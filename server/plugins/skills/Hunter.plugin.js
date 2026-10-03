"use strict";

const Runtime = require("./hunter/Runtime.Hunter");
const Traps = require("./hunter/Traps.Hunter");
const Catching = require("./hunter/Catching.Hunter");
const Birdhouses = require("./hunter/Birdhouses.Hunter");
const Tracking = require("./hunter/Tracking.Hunter");
const Pitfalls = require("./hunter/Pitfalls.Hunter");
const Aerial = require("./hunter/Aerial.Hunter");
const MagicBoxes = require("./hunter/MagicBoxes.Hunter");

const Rabbits = require("./hunter/Rabbits.Hunter");
const Herbiboar = require("./hunter/Herbiboar.Hunter");
const Crabs = require("./hunter/Crabs.Hunter");
const DriftNets = require("./hunter/DriftNets.Hunter");
const Dungeon = require("./hunter/Dungeon.Hunter");
const Rumours = require("./hunter/Rumours.Hunter");
const Broavs = require("./hunter/Broavs.Hunter");

module.exports = {
  name: "Hunter",
  members: true,
  register(api) {
    api.onServerStartup(Runtime.start.bind(null, api));
    api.onServerShutdown(Runtime.shutdown);
    api.persistAttribute(Birdhouses.ATTRIBUTE);
    api.persistAttribute(Crabs.ATTRIBUTE);
    api.persistAttribute(DriftNets.ATTRIBUTE);
    api.persistAttribute(Rumours.ATTRIBUTE);
    api.persistAttribute(Tracking.ATTRIBUTE);
    api.persistAttribute(Aerial.ATTRIBUTE);
    api.persistAttribute("hunter.herbiboars");
    api.onCustomEvent("hunter:success", Rumours.success);
    api.onPlayerLogin(Runtime.login);
    api.onPlayerLogout(Runtime.cleanup);
    api.onPlayerDisconnect(Runtime.cleanup);
    api.onPlayerDeath(Runtime.cleanup);
    api.onPlayerProcess(Runtime.processPlayer);
    api.onCanEquip(Runtime.equipment);
    api.onCanUnequip(Runtime.equipment);
    api.onNpcRoute(Runtime.npcRoute);
    api.onAnyNpcInteraction({ Catch: Runtime.catchNpc, Tease: Pitfalls.tease, Retrieve: Catching.retrieve });
    api.onNpcInteraction("Matthias", { "Quick-falcon": Catching.hire, Falconry: Catching.hire });
    api.onNpcInteraction("Alry the Angler", { "Get bird": Aerial.borrow, "Talk-to": Aerial.talk });
    api.onItemAction("Bird snare", { Lay: Traps.activate });
    api.onItemAction("Box trap", { Lay: Traps.activate });
    api.onItemAction("Rabbit snare", { Lay: Traps.activate });
    api.onObjectInteraction("Rabbit snare", { Check: Traps.check, Dismantle: Traps.dismantle, Reset: Traps.reset });
    api.onObjectInteraction("Rabbit hole", { Flush: Rabbits.flush });
    api.onItemAction("Ring of pursuit", { Check: Tracking.checkRing, Break: Tracking.breakRing });
    api.onNpcInteraction("Herbiboar", { Harvest: Herbiboar.harvest });
    api.onObjectInteraction("Rock", { Trap: Dungeon.rock });
    api.onObjectInteraction("Bush", { Rustle: Dungeon.rustle });
    api.onObjectInteraction("Pit trap", { Bait: Broavs.bait, Dismantle: Broavs.dismantle });
    api.onNpcInteraction("Broav", { "Pick-up": Broavs.pickup });
    for (const name of ["Broav", "Unconscious broav"]) api.onItemAction(name, { Release: Broavs.release });
    api.onItemAction("Magic box", { Activate: Traps.activate });
    api.onGroundItemSecondClick([api.core.ItemIdentifiers.BIRD_SNARE, api.core.ItemIdentifiers.BOX_TRAP, api.core.ItemIdentifiers.MAGIC_BOX, api.core.ItemIdentifiers.RABBIT_SNARE], Traps.groundActivate);
    for (const name of ["Bird snare", "Box trap", "Shaking box", "Magic box", "Magic box failed", "Deadfall", "Boulder", "Large boulder", "Net trap", "Young tree", "Collapsed trap"])
      api.onObjectInteraction(name, { Check: Traps.check, Retrieve: Traps.check, Dismantle: Runtime.dismantle, Deactivate: Traps.dismantle, Reset: Traps.reset, Investigate: Traps.investigate, "Set-trap": Traps.build, Trap: Traps.build });
    api.onObjectInteraction("Pit", { Trap: Runtime.pitBuild });
    api.onObjectInteraction("Spiked pit", { Jump: Pitfalls.jump, Dismantle: Traps.dismantle });
    for (const name of ["Burrow", "Bush", "Plant", "Snow drift", "Disturbed sand", "Tunnel", "Hollow log", "Cactus", "Rockslide", "Jungle plant", "Rock", "Mushroom", "Smelly mushroom", "Muddy patch", "Seaweed", "Driftwood"])
      api.onObjectInteraction(name, { Inspect: Runtime.inspect, Search: Runtime.inspect, Attack: Runtime.attack });
    api.onObjectInteraction("Space", { Build: Birdhouses.build });
    for (const name of ["Birdhouse", "Oak birdhouse", "Willow birdhouse", "Teak birdhouse", "Maple birdhouse", "Mahogany birdhouse", "Yew birdhouse", "Magic birdhouse", "Redwood birdhouse", "Birdhouse (empty)", "Oak birdhouse (empty)", "Willow birdhouse (empty)", "Teak birdhouse (empty)", "Maple birdhouse (empty)", "Mahogany birdhouse (empty)", "Yew birdhouse (empty)", "Magic birdhouse (empty)", "Redwood birdhouse (empty)"])
      api.onObjectInteraction(name, { Interact: Birdhouses.empty, Empty: Birdhouses.empty, Reset: Birdhouses.reset, Seeds: Birdhouses.seeds, Dismantle: Birdhouses.dismantle });
    for (const name of ["Ruby harvest", "Sapphire glacialis", "Snowy knight", "Black warlock", "Sunlight moth", "Moonlight moth"])
      api.onItemAction(name, { Release: Catching.release });
    for (const name of ["Baby impling jar", "Young impling jar", "Gourmet impling jar", "Earth impling jar", "Essence impling jar", "Eclectic impling jar", "Nature impling jar", "Magpie impling jar", "Ninja impling jar", "Dragon impling jar", "Crystal impling jar", "Lucky impling jar"])
      api.onItemAction(name, { Loot: Catching.loot });
    for (const name of ["Ferret", "Swamp lizard", "Orange salamander", "Red salamander", "Black salamander", "Tecu salamander", "Immature tecu salamander"])
      api.onItemAction(name, { Release: Runtime.release });
    for (const name of ["Imp-in-a-box(2)", "Imp-in-a-box(1)"])
      api.onItemAction(name, { "Bank-all": MagicBoxes.explain, Bank: MagicBoxes.explain, "Talk-to": MagicBoxes.explain, Release: MagicBoxes.release });
    api.onObjectInteraction("Hole", { "Build-trap": Crabs.build });
    api.onObjectInteraction("Crab trap (empty)", { Bait: Crabs.bait });
    for (const name of ["Crab trap (baited)", "Crab trap (full)"]) api.onObjectInteraction(name, { Empty: Crabs.empty });
    api.onNpcInteraction("Ceto", { "Talk-to": DriftNets.pay, Pay: DriftNets.pay });
    api.onNpcInteraction("Fish shoal", { Chase: DriftNets.chase });
    for (const name of ["Drift net anchors", "Drift net (full)"]) api.onObjectInteraction(name, {
      "Set up": DriftNets.setup, "Take down": DriftNets.takeDown, Harvest: DriftNets.harvest, Inspect: DriftNets.inspect });
    api.onObjectInteraction("<col=ffff00>Annette</col>", { "Talk-to": DriftNets.storage, Nets: DriftNets.storage });
    api.onObjectInteraction("Plant door", { Navigate: DriftNets.exit });
    for (const name of ["Huntmaster Gilman (Novice)", "Guild Hunter Cervus (Adept)", "Guild Hunter Ornus (Adept)",
      "Guild Hunter Aco (Expert)", "Guild Hunter Teco (Expert)", "Guild Hunter Wolf (Master)"])
      api.onNpcInteraction(name, { "Talk-to": Rumours.interact, Rumour: Rumours.interact });
    api.onNpcInteraction("Guild Scribe Verity", { "Talk-to": Rumours.verity, "Rumour-settings": Rumours.verity });
    for (const name of ["Hunters' loot sack (basic)", "Hunters' loot sack (adept)", "Hunters' loot sack (expert)", "Hunters' loot sack (master)"])
      api.onItemAction(name, { Open: Rumours.open });
    for (const name of ["Basic quetzal whistle", "Enhanced quetzal whistle", "Perfected quetzal whistle", "Perfected quetzal whistle(i)"])
      api.onItemAction(name, { Rumour: Rumours.check });
    api.onItemOnObject(Runtime.objectUse, { noted: false });
    api.onItemOnObject("Drift net", "<col=ffff00>Annette</col>", DriftNets.use, { noted: true });
    api.onItemOnItem(Runtime.itemUse, { noted: false });
    api.onItemOnPlayer(Catching.boost, { noted: false });
    api.onItemOnNpc(Runtime.npcUse, { noted: false });
  },
};
