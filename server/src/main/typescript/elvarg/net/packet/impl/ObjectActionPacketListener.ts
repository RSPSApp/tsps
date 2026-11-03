import { ObjectDefinition } from "../../../game/definition/ObjectDefinition";
import { MapObjects } from "../../../game/entity/impl/object/MapObjects";
import { Player } from "../../../game/entity/impl/player/Player";
import { Location } from "../../../game/model/Location";
import { PluginManager } from "../../../plugins/PluginManager";
import { BoatManager } from "../../../game/content/sailing/BoatManager";
import type { Boat } from "../../../game/content/sailing/Boat";
import type { GameObject } from "../../../game/entity/impl/object/GameObject";
import { Task } from "../../../game/task/Task";
import { TaskManager } from "../../../game/task/TaskManager";

/**
 * How far from the tile under a player on a boat deck a main-world loc can be used. A dock's
 * gangplank was used from 9 tiles away in a live capture (Port Sarim).
 */
const DECK_REACH_TILES = 12;
/**
 * From the player's boat to an NPC ship whose loc they click (the trials' rum boats, rsprox: answered
 * up to 12.5 tiles, centre to centre). A click from further away waits for the boats to close in
 * (answered a tick later in the captures); ours: for up to 10 ticks, and a newer click replaces it.
 */
const OTHER_DECK_REACH_TILES = 12;
const OTHER_DECK_WAIT_TICKS = 10;
/** How far off an NPC ship can be for a click on its loc to find it by id. */
const OTHER_DECK_SEARCH_TILES = 32;
const pendingOtherDeck = new WeakMap<Player, object>();

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
    // A loc on another boat's deck (a Barracuda Trial's rum boat, seen from the player's own).
    pendingOtherDeck.delete(player);
    const remote = ObjectActionPacketListener.onOtherDeck(player, id, x, y);
    const object = remote?.object ?? MapObjects.getPrivateArea(player, id, objectLocation);
    if (!object) {
      return;
    }
    const definition = ObjectDefinition.forPlayer(object.getId(), player);
    if (!definition) return;
    if (!Number.isInteger(clickType) || clickType < 1 || clickType > 5) {
      const normalized = action?.trim().toLowerCase();
      clickType = normalized
        ? (definition?.getInteractions()?.findIndex((option) => option?.toLowerCase() === normalized) ?? -1) + 1
        : 0;
    }
    if (clickType < 1 || clickType > 5) return;

    const option = definition?.getInteractions()?.[clickType - 1]?.toLowerCase();
    const executeInteraction = () => {
      // Another player may have opened, emptied or replaced it on the way: nothing happens. A loc
      // on another boat's deck is checked on that deck (the player's own area doesn't hold it).
      const stands = remote
        ? BoatManager.getDeck(remote.boat)?.getObjects().includes(object) === true
        : MapObjects.stillStands(player, id, objectLocation, object);
      if (!stands) return;
      const interactionLocation = player.getLocation().clone();
      player.getMovementQueue().reset();
      player.getMovementQueue().walkToReset();
      player.setPositionToFace(player.getLocation().equals(object.getLocation()) ? null : object.getLocation());

      const pluginHandled = PluginManager.emitObjectInteraction({
        player,
        object,
        definition,
        objectId: object.getId(),
        clickType,
        option,
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

      if (option === "bank") {
        player.getBank(player.getCurrentBankTab()).open();
        return;
      }

    };

    // Another boat's loc is used from the player's own boat when the boats are close enough;
    // live answers clicks from further away with nothing at all.
    if (remote) {
      const inReach = () => {
        const root = BoatManager.rootLocation(player);
        return Math.max(Math.abs(remote.boat.tileX - root.getX()), Math.abs(remote.boat.tileY - root.getY())) <= OTHER_DECK_REACH_TILES;
      };
      const token = {};
      pendingOtherDeck.set(player, token);
      if (inReach()) {
        executeInteraction();
        return;
      }
      let waited = 0;
      TaskManager.submit(new (class extends Task {
        constructor() { super(1, player, false); }
        execute(): void {
          if (pendingOtherDeck.get(player) !== token || ++waited > OTHER_DECK_WAIT_TICKS || !player.isRegistered()) {
            this.stop();
            return;
          }
          if (!inReach()) return;
          this.stop();
          executeInteraction();
        }
      })());
      return;
    }

    // From a boat deck there is no path across the water: main-world locs (a dock's
    // gangplank) are used from the deck when close to the tile under the player.
    if (player.getPrivateArea()?.countsAsMainWorld() && object.getPrivateArea() == null) {
      const source = player.getLocation();
      const reach = PluginManager.deckReach.get(object.getId());
      // Live answers a land loc clicked from a boat (a tree, a sign) with this (rsprox 901, 347).
      if (reach === undefined && !PluginManager.usableFromDeck.has(definition.getName?.() ?? "")
        && !PluginManager.usableFromDeck.has(object.getId())) {
        player.sendMessage("I can't do that from here!");
        return;
      }
      const root = BoatManager.rootLocation(player);
      const location = object.getLocation();
      const inReach = Math.max(Math.abs(location.getX() - root.getX()), Math.abs(location.getY() - root.getY())) <= (reach ?? DECK_REACH_TILES);
      // Too far: the player stays at the helm (rsprox 3455, a charting spot: the message alone).
      if (!inReach) {
        if (reach === undefined) player.sendMessage("I can't reach that!");
        return;
      }
      // Route hooks also release the helm, even when no land route can be built; locs used from
      // the helm at their own reach (a Barracuda Trial's outcrops) leave the boat sailing.
      if (reach === undefined) {
        PluginManager.emitObjectRoute({
          player, object, definition, objectId: object.getId(), clickType,
          sourceLocation: { x: source.getX(), y: source.getY(), z: source.getZ() },
          destination: null,
        });
      }
      executeInteraction();
      return;
    }

    player.getMovementQueue().walkToObject(object, {
      execute: executeInteraction,
    }, clickType);
  }

  /** The clicked loc on a boat's deck other than the one the player is on, and that boat. */
  private static onOtherDeck(player: Player, id: number, x: number, y: number): { object: GameObject; boat: Boat } | undefined {
    const own = player.getPrivateArea();
    const matches = (entry: GameObject) => entry.getId() === id || ObjectDefinition.forPlayer(entry.getId(), player)?.id === id;
    // Only the NPC ships' decks (a Barracuda Trial's rum boats): never another player's boat.
    const ships = BoatManager.all().filter((boat) => boat.static && BoatManager.getDeck(boat) && BoatManager.getDeck(boat) !== own
      && BoatManager.canSeeBoat(player, boat));
    if (ships.length === 0) return undefined;
    if (BoatManager.isDeckTile(x, y)) {
      for (const boat of ships) {
        if (!boat.containsDeckTile(x, y)) continue;
        const object = BoatManager.getDeck(boat)!.getObjects().find((entry) => entry.getLocation().getX() === x
          && entry.getLocation().getY() === y && matches(entry));
        if (object) return { object, boat };
      }
    }
    // The tile didn't match (a click on a ship drawn at sea may come in other coordinates): the
    // nearest NPC ship close by with that loc on its deck.
    const root = BoatManager.rootLocation(player);
    let best: { object: GameObject; boat: Boat; distance: number } | undefined;
    for (const boat of ships) {
      const distance = Math.max(Math.abs(boat.tileX - root.getX()), Math.abs(boat.tileY - root.getY()));
      if (distance > OTHER_DECK_SEARCH_TILES || (best && best.distance <= distance)) continue;
      const object = BoatManager.getDeck(boat)!.getObjects().find((entry) => matches(entry)
        && ObjectDefinition.forPlayer(entry.getId(), player)?.getInteractions()?.some(Boolean));
      if (object) best = { object, boat, distance };
    }
    if (best) return { object: best.object, boat: best.boat };
    return undefined;
  }
}
