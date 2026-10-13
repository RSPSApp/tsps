import { ObjectDefinition } from "../../../game/definition/ObjectDefinition";
import { MapObjects } from "../../../game/entity/impl/object/MapObjects";
import { Player } from "../../../game/entity/impl/player/Player";
import { Location } from "../../../game/model/Location";
import { PluginManager } from "../../../plugins/PluginManager";
import { BoatManager } from "../../../game/content/sailing/BoatManager";

/**
 * How far from the tile under a player on a boat deck a main-world loc can be used. A dock's
 * gangplank was used from 9 tiles away in a live capture (Port Sarim).
 */
const DECK_REACH_TILES = 12;

export class ObjectActionPacketListener {
  public executeAction(
    player: Player,
    id: number,
    x: number,
    y: number,
    clickType = 0,
    action?: string
  ): void {
    if (!player || player.getHitpoints() <= 0 || player.busy()) {
      return;
    }
    const objectLocation = new Location(
      x,
      y,
      player.getLocation().getZ()
    );
    const sourceLocation = player.getLocation().clone();
    const object = MapObjects.getPrivateArea(player, id, objectLocation);
    if (!object) {
      return;
    }
    const definition = ObjectDefinition.forPlayer(object.getId(), player);
    if (!definition) return;
    if (clickType < 1 || clickType > 5) {
      const normalized = action?.trim().toLowerCase();
      clickType = normalized
        ? (definition?.getInteractions()?.findIndex((option) => option?.toLowerCase() === normalized) ?? -1) + 1
        : 0;
    }
    if (clickType < 1 || clickType > 5) return;

    const option = definition?.getInteractions()?.[clickType - 1]?.toLowerCase();
    const routeEvent = {
      player,
      object,
      definition,
      objectId: object.getId(),
      clickType,
      sourceLocation: {
        x: sourceLocation.getX(),
        y: sourceLocation.getY(),
        z: sourceLocation.getZ(),
      },
      destination: null as { x: number; y: number; z: number } | null,
    };
    PluginManager.emitObjectRoute(routeEvent);
    const executeInteraction = () => {
      const interactionLocation = player.getLocation().clone();
      player.getMovementQueue().reset();
      player.getMovementQueue().walkToReset();
      player.setPositionToFace(object.getLocation());

      const pluginHandled = PluginManager.emitObjectInteraction({
        player,
        object,
        definition,
        objectId: object.getId(),
        clickType,
        location: {
          x: object.getLocation().getX(),
          y: object.getLocation().getY(),
          z: object.getLocation().getZ(),
        },
        sourceLocation: {
          x: interactionLocation.getX(),
          y: interactionLocation.getY(),
          z: interactionLocation.getZ(),
        },
        handled: false,
      });
      if (pluginHandled) {
        return;
      }

      // --- ADD YOUR LOG RAFT SHORTCUT HERE ---
      if (object.getId() === 1987) {
        player.getPacketSender().sendMessage("You board the log raft and navigate the falls...");
        player.moveTo(new Location(2512, 3476, 0)); 
        return;
      }
      if (object.getId() === 10283) {
        player.getPacketSender().sendMessage("You attempt to swim across the rushing river...");
        // Teleports the player to the central rock in the river
        player.moveTo(new Location(2512, 3467, 0)); 
        return;
      }
      if (object.getId() === 2020) {
        player.getPacketSender().sendMessage("You tie a rope to the dead tree and lower yourself down...");
        // Teleports you safely onto the lower ledge by the waterfall door
        player.moveTo(new Location(2511, 3463, 0)); 
        return;
      }
      if (object.getId() === 2010) {
        player.getPacketSender().sendMessage("You open the door and step through the waterfall...");
        // Teleports the player to the standard start of the Waterfall Dungeon cave
        player.moveTo(new Location(2575, 9861, 0)); 
        return;
      }
      // --- 1. THE CRATE (Finding the Key) ---
      if (object.getId() === 1990) {
        player.getPacketSender().sendMessage("You search the crate...");
        
        if (player.getInventory().isFull()) {
          player.getPacketSender().sendMessage("Your inventory is too full to carry the key.");
          return;
        }
        
        player.getPacketSender().sendMessage("You find a small key hidden inside!");
        return;
        }

        // --- 2. THE INNER GATES (Unlocking the Statue Room) ---
        if (object.getId() === 1991 || object.getId() === 1992) {    
          player.getPacketSender().sendMessage("You unlock the gate and step inside.");
          // Teleports the player past the gate line into the inner room
          player.moveTo(new Location(2569, 9893, 0)); 
          return;
        }

        // --- 3. THE CHALICE OF ETERNITY (Quest Completion Shortcut) ---
        if (object.getId() === 1996 || object.getId() === 2004 || object.getId() === 2000) { // Chalice object IDs
          player.getPacketSender().sendMessage("You approach the Chalice of Eternity...");
          
          // Teleport the player safely back out to the waterfall house
          player.moveTo(new Location(2534, 3511, 0)); 
          return;
        }


      // ---------------------------------------

      if (option === "bank") {
        player.getBank(player.getCurrentBankTab()).open();
        return;
      }

      console.warn(
        `[object-click-debug] unhandled id=${object.getId()} name="${definition?.getName() ?? "?"}" ` +
        `type=${object.getType()} face=${object.getFace()} loc=${object.getLocation().getX()},${object.getLocation().getY()},${object.getLocation().getZ()} ` +
        `action="${definition?.getInteractions()?.[clickType - 1] ?? "?"}"`
      );
    };

    // From a boat deck there is no path across the water: main-world locs (a dock's
    // gangplank) are used from the deck when close to the tile under the player.
    if (player.getPrivateArea()?.countsAsMainWorld() && object.getPrivateArea() == null) {
      const root = BoatManager.rootLocation(player);
      const location = object.getLocation();
      if (Math.max(Math.abs(location.getX() - root.getX()), Math.abs(location.getY() - root.getY())) <= DECK_REACH_TILES) {
        executeInteraction();
      } else {
        player.sendMessage("You can't reach that.");
      }
      return;
    }

    if (routeEvent.destination) {
      const { x: routeX, y: routeY, z: routeZ } = routeEvent.destination;
      player.getMovementQueue().walkToTile(new Location(routeX, routeY, routeZ), executeInteraction);
      return;
    }

    player.getMovementQueue().walkToObject(object, {
      execute: executeInteraction,
    });
  }
}
