import { GameConstants } from "../../GameConstants";
import { Mobile } from "../../entity/impl/Mobile";
import type { Player } from "../../entity/impl/player/Player";
import { Location } from "../../model/Location";
import type { Boat } from "./Boat";
import { BoatManager } from "./BoatManager";
import type { BoatPlacement, BoatSpec } from "./BoatSpec";
import { baseParts, type BoatName, type OwnedBoat } from "./SailingState";

/** OSRS lets a player own up to 5 boats (more slots unlock with Sailing level). */
const MAX_BOATS = 5;

/** A place boats moor: a port gangplank or an island mooring point. */
export interface SailingDock {
    id: string;
    /** A mooring point (an island) rather than a port: it isn't a "standard dock". */
    mooringPoint?: boolean;
    /** Where a boat docked here sits: fine position (1/128 tile) and angle. */
    mooring: BoatPlacement;
    /** Where a boat of a given type sits instead, when it differs (bigger hulls). */
    moorings?: Record<string, BoatPlacement>;
    /** Where a player steps ashore when disembarking here. */
    landing: { x: number; y: number; z: number };
}

/** Why a player left their boat, sent with the `sailing:left` event. */
export type LeaveReason = "disembark" | "sunk" | "logout";

/** Lets content (the sidepanel, varbits) follow boarding and leaving without core knowing it. */
function emit(event: "sailing:boarded" | "sailing:left", payload: object): void {
    (require("../../../plugins/PluginManager") as typeof import("../../../plugins/PluginManager"))
        .PluginManager.emitCustomEvent(event, payload);
}

interface ActiveInstance {
    player: Player;
    slot: number;
}

/**
 * Every transition of a player's boats goes through here, so no path can leave a boat half
 * alive: boarding and disembarking at a dock, sinking on a teleport, Escape or death at sea,
 * recording the boat when its owner logs out and putting them back aboard on login, and
 * recovery by a shipwright.
 */
export class Sailing {
    private static readonly types = new Map<string, BoatSpec>();
    private static readonly docks = new Map<string, SailingDock>();
    private static readonly instances = new Map<Boat, ActiveInstance>();
    /** The player whose move Sailing itself is making, so it isn't taken for a teleport. */
    private static expectedMove: Mobile | null = null;
    private static initialized = false;
    private static specResolver?: (boat: OwnedBoat, base: BoatSpec) => BoatSpec;

    public static initialize(): void {
        if (Sailing.initialized) return;
        Sailing.initialized = true;
        Mobile.onBeforeTeleport((mobile, target) => Sailing.onTeleport(mobile, target));
        BoatManager.onAfterTick(() => Sailing.recordPositions());
    }

    public static registerBoatType(spec: BoatSpec): void {
        Sailing.types.set(spec.type, spec);
    }

    public static registerDock(dock: SailingDock): void {
        Sailing.docks.set(dock.id, dock);
    }

    public static getDock(id: string): SailingDock | undefined {
        return Sailing.docks.get(id);
    }

    /** Adds a boat docked at `dockId` in the player's next free slot. */
    public static giveBoat(
        player: Player,
        type: string,
        dockId: string,
        name: BoatName = [0, 0, 0],
    ): OwnedBoat | undefined {
        const state = player.getSailing();
        const spec = Sailing.types.get(type);
        if (!spec || !Sailing.docks.has(dockId) || state.boats.length >= MAX_BOATS) return undefined;
        let slot = 0;
        while (state.boats.some((boat) => boat.slot === slot)) slot++;
        const boat: OwnedBoat = {
            slot, type, name, hitpoints: 0, facilities: [],
            location: { kind: "docked", dock: dockId },
            cargo: [],
            parts: baseParts(),
        };
        state.boats.push(boat);
        state.boats.sort((a, b) => a.slot - b.slot);
        if (state.activeBoatSlot == null) state.activeBoatSlot = slot;
        return boat;
    }

    public static activeBoat(player: Player): OwnedBoat | undefined {
        const state = player.getSailing();
        return state.boats.find((boat) => boat.slot === state.activeBoatSlot);
    }

    /** The player's own boat instance they are standing on, if any. */
    public static instanceAboard(player: Player): Boat | undefined {
        const boat = BoatManager.getBoatAboard(player);
        return boat && Sailing.instances.get(boat)?.player === player ? boat : undefined;
    }

    /**
     * Boards the player's boat moored at `dockId`. Returns a message to show when they can't
     * (no boat here, or it has sunk), otherwise null.
     */
    public static board(player: Player, dockId: string, slot?: number): string | null {
        if (BoatManager.getBoatAboard(player)) return "You're already on a boat.";
        const dock = Sailing.docks.get(dockId);
        if (!dock) return "You can't board a boat here.";
        const state = player.getSailing();
        const here = (boat: OwnedBoat) => boat.location.kind === "docked" && boat.location.dock === dockId;
        if (slot !== undefined) {
            const chosen = state.boats.find((boat) => boat.slot === slot);
            if (!chosen || !here(chosen)) return "You can't choose that boat at the moment.";
        }
        const boat = slot !== undefined
            ? state.boats.find((candidate) => candidate.slot === slot)
            : [Sailing.activeBoat(player), ...state.boats].find((candidate) => candidate && here(candidate));
        if (!boat) {
            return state.boats.some((candidate) => candidate.location.kind === "sunk")
                ? "Your boat has sunk. A shipwright can recover it for you."
                : "You don't have a boat moored here.";
        }
        const at = boat.location.kind === "docked" ? boat.location.at : undefined;
        if (!Sailing.embark(player, boat, at ?? dock.moorings?.[boat.type] ?? dock.mooring, dockId)) {
            return "There's no room at sea right now.";
        }
        Sailing.dockedAt(player, dock);
        return null;
    }

    /**
     * Docks the boat the player is aboard at `dockId` (its buoy): the player stays aboard, the
     * boat counts as this port's, and the port is where they return if they abandon it.
     */
    public static dock(player: Player, dockId: string): string | null {
        const dock = Sailing.docks.get(dockId);
        const instance = Sailing.instanceAboard(player);
        const boat = Sailing.activeBoat(player);
        if (!dock || !instance || !boat) return "You can't dock here.";
        boat.location = Sailing.atSea(instance, dockId);
        Sailing.dockedAt(player, dock);
        return null;
    }

    /**
     * Takes the player off their boat at `dockId`, which docks it there (if it wasn't), where it
     * is: boarding here again puts it back in the same place.
     */
    public static disembark(player: Player, dockId: string): string | null {
        const dock = Sailing.docks.get(dockId);
        const instance = Sailing.instanceAboard(player);
        const boat = Sailing.activeBoat(player);
        if (!dock || !instance || !boat) return "You can't disembark here.";
        const { fineX, fineY, level, angle } = instance;
        boat.location = { kind: "docked", dock: dockId, at: { fineX, fineY, level, angle } };
        Sailing.dockedAt(player, dock);
        Sailing.leave(player, instance, "disembark");
        Sailing.moveExpected(player, new Location(dock.landing.x, dock.landing.y, dock.landing.z));
        return null;
    }

    /** The helm's Escape: the boat sinks and the player returns to their last dock or buoy. */
    public static escape(player: Player): void {
        const instance = Sailing.instanceAboard(player);
        if (!instance) return;
        Sailing.sink(player, instance);
        Sailing.moveExpected(player, Sailing.returnLocation(player));
    }

    /**
     * Why a shipwright at `dockId` can't recover the boat in `slot` (sunk, or docked at another
     * port), or null. The texts are the boat selection interface's own (cache scripts).
     */
    public static recoverRefusal(player: Player, slot: number, dockId: string): string | null {
        const boat = player.getSailing().boats.find((candidate) => candidate.slot === slot);
        if (!boat || !Sailing.docks.has(dockId) || boat.location.kind === "at_sea") {
            return "You can't choose that boat at the moment.";
        }
        if (boat.location.kind === "docked" && boat.location.dock === dockId) {
            return "That boat is already at the nearby dock. There's no need to recover it.";
        }
        return null;
    }

    /** Brings the boat in `slot` to `dockId`; the shipwright takes the fee. */
    public static recover(player: Player, slot: number, dockId: string): string | null {
        const refusal = Sailing.recoverRefusal(player, slot, dockId);
        if (refusal) return refusal;
        const boat = player.getSailing().boats.find((candidate) => candidate.slot === slot)!;
        boat.location = { kind: "docked", dock: dockId };
        return null;
    }

    /** Keeps the saved position of each boat at sea current, so a save mid-voyage restores it. */
    private static recordPositions(): void {
        for (const [instance, { player, slot }] of Sailing.instances) {
            const boat = player.getSailing().boats.find((owned) => owned.slot === slot);
            if (boat) boat.location = Sailing.atSea(instance, Sailing.lastPortOf(boat));
        }
    }

    /** The port a boat last docked at, for a boat at sea or docked. */
    public static lastPortOf(boat: OwnedBoat): string | undefined {
        return boat.location.kind === "sunk" ? undefined : boat.location.dock;
    }

    /**
     * Logging out at sea keeps the boat at sea: its position is recorded and the player's saved
     * position becomes their return point, in case the boat can't be restored.
     */
    public static onLogout(player: Player): void {
        const instance = Sailing.instanceAboard(player);
        if (!instance) return;
        const boat = Sailing.activeBoat(player);
        if (boat) boat.location = Sailing.atSea(instance, Sailing.lastPortOf(boat));
        Sailing.leave(player, instance, "logout");
        player.setLocation(Sailing.returnLocation(player));
    }

    /** Puts a player who logged out at sea back aboard their boat. */
    public static onLogin(player: Player): void {
        const boat = Sailing.activeBoat(player);
        if (boat?.location.kind === "at_sea") {
            const { fineX, fineY, level, angle, dock } = boat.location;
            if (Sailing.embark(player, boat, { fineX, fineY, level, angle }, dock)) return;
        }
        // A save from a deck with no boat to go back to (such as sailing data lost in a crash).
        const location = player.getLocation();
        if (BoatManager.isDeckTile(location.getX(), location.getY())) {
            player.setLocation(Sailing.returnLocation(player));
        }
    }

    /** Spawns the boat at `placement` and puts the player on its deck. */
    /**
     * Builds a boat's spec from its owned parts. Content registers it (boat parts live in the
     * cache and plugin data); without one a boat is built as its type's base spec.
     */
    public static setSpecResolver(resolver: (boat: OwnedBoat, base: BoatSpec) => BoatSpec): void {
        Sailing.specResolver = resolver;
    }

    /** The spec an owned boat is built from: its type's, with its own parts. */
    public static specFor(boat: OwnedBoat): BoatSpec | undefined {
        const base = Sailing.types.get(boat.type);
        return base && (Sailing.specResolver ? Sailing.specResolver(boat, base) : base);
    }

    /** Records a dock as the player's last (and return point), as boarding or docking there does. */
    private static dockedAt(player: Player, dock: SailingDock): void {
        const state = player.getSailing();
        state.returnPoint = { ...dock.landing };
        state.lastDock = dock.id;
        if (!dock.mooringPoint) state.lastStandardDock = dock.id;
    }

    private static embark(player: Player, boat: OwnedBoat, placement: BoatPlacement, dockId?: string): boolean {
        const spec = Sailing.specFor(boat);
        const instance = spec && BoatManager.spawn(player.getIndex(), spec, placement);
        if (!spec || !instance) return false;
        Sailing.instances.set(instance, { player, slot: boat.slot });
        player.getSailing().activeBoatSlot = boat.slot;
        boat.location = Sailing.atSea(instance, dockId);
        BoatManager.getDeck(instance)!.enter(player);
        Sailing.moveExpected(player, new Location(
            instance.deckBaseX + spec.boardingTile.x, instance.deckBaseY + spec.boardingTile.y, 0));
        emit("sailing:boarded", { player, boat: instance, owned: boat });
        return true;
    }

    private static sink(player: Player, instance: Boat): void {
        const boat = Sailing.activeBoat(player);
        if (boat) boat.location = { kind: "sunk" };
        Sailing.leave(player, instance, "sunk");
    }

    /** Takes the player off the deck and removes the boat from the sea. */
    private static leave(player: Player, instance: Boat, reason: LeaveReason): void {
        Sailing.instances.delete(instance);
        if (instance.helmPlayerId === player.getIndex()) instance.helmPlayerId = undefined;
        BoatManager.getDeck(instance)?.leave(player, false);
        BoatManager.dispose(instance);
        emit("sailing:left", { player, boat: instance, reason });
    }

    private static onTeleport(mobile: Mobile, target: Location): void {
        if (mobile === Sailing.expectedMove || !mobile.isPlayer()) return;
        const player = mobile.getAsPlayer() as Player;
        const instance = Sailing.instanceAboard(player);
        if (!instance || instance.containsDeckTile(target.getX(), target.getY())) return;
        // Teleporting off the boat at sea sinks it.
        Sailing.sink(player, instance);
    }

    private static moveExpected(player: Player, target: Location): void {
        Sailing.expectedMove = player;
        try {
            player.moveTo(target);
        } finally {
            Sailing.expectedMove = null;
        }
    }

    private static returnLocation(player: Player): Location {
        const point = player.getSailing().returnPoint;
        return point ? new Location(point.x, point.y, point.z) : GameConstants.DEFAULT_LOCATION.clone();
    }

    private static atSea(instance: Boat, dock?: string): OwnedBoat["location"] {
        const at = { fineX: instance.fineX, fineY: instance.fineY, level: instance.level, angle: instance.angle };
        return dock ? { kind: "at_sea", ...at, dock } : { kind: "at_sea", ...at };
    }
}
