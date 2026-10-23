import { Mobile } from "../../../entity/impl/Mobile";
import { Server } from "../../../../Server";
import { RegionManager } from "../../../collision/RegionManager";
import { Location } from "../../Location";
import { PluginManager } from "../../../../plugins/PluginManager";
import { RsmodRouteFinding } from "./RsmodRouteFinding";
import * as fs from "fs";
import * as path from "path";

export class PathFinder {
    // Debounce path-blocked events aggressively: repeated retries against the
    // same destination within a short window do not provide extra recovery
    // signal for bot logic, but they do add measurable hook overhead.
    private static readonly PATH_BLOCKED_EVENT_DEBOUNCE_MS = 1200;
    // Bots generate substantially more repeated "no path" attempts than human
    // players, so use a longer debounce window for bot entities.
    private static readonly PATH_BLOCKED_EVENT_BOT_DEBOUNCE_MS = 2500;
    private static LOG_DIR = path.join(process.cwd(), "logs");
    private static LOG_FILE = path.join(PathFinder.LOG_DIR, "movement.log");
    private static LOG_READY = false;
    private static LOG_ENABLED = false;
    private static blockedEventTracker = new WeakMap<Mobile, {
        signature: string;
        lastEmittedAtMs: number;
    }>();
    private static readonly rsmodRouteFinding = new RsmodRouteFinding();

    private static log(line: string) {
        if (!PathFinder.LOG_ENABLED) {
            return;
        }

        const msg = `${new Date().toISOString()} [pathfinder] ${line}`;
        console.log(msg);
        try {
            if (!PathFinder.LOG_READY) {
                fs.mkdirSync(PathFinder.LOG_DIR, { recursive: true });
                PathFinder.LOG_READY = true;
            }
            fs.appendFileSync(PathFinder.LOG_FILE, msg + "\n", { encoding: "utf8" });
        } catch (e) {
            // Ignore file logging errors.
        }
    }

    private static shouldEmitPathBlockedEvent(
        entity: Mobile,
        signature: string,
        nowMs: number
    ): boolean {
        const isBot =
            entity?.isPlayer?.() === true &&
            entity.getAsPlayer?.()?.isPlayerBot?.() === true;
        const debounceMs = isBot
            ? PathFinder.PATH_BLOCKED_EVENT_BOT_DEBOUNCE_MS
            : PathFinder.PATH_BLOCKED_EVENT_DEBOUNCE_MS;
        const previous = PathFinder.blockedEventTracker.get(entity);
        if (
            previous &&
            previous.signature === signature &&
            nowMs - previous.lastEmittedAtMs < debounceMs
        ) {
            return false;
        }
        PathFinder.blockedEventTracker.set(entity, {
            signature,
            lastEmittedAtMs: nowMs,
        });
        return true;
    }
    public static isDiagonalTiles(attacker: Location, attacked: Location): boolean {
        return (
            Math.abs(attacker.getX() - attacked.getX()) === 1 &&
            Math.abs(attacker.getY() - attacked.getY()) === 1
        );
    }

    private static emitNoPath(
        entity: Mobile,
        srcX: number,
        srcY: number,
        destX: number,
        destY: number,
        height: number,
        basicPather: boolean,
        size: number,
        xLength: number,
        yLength: number,
        direction: number,
        blockingMask: number
    ): void {
        Server.logDebug("error.. no path found... path probably not reachable.");
        PathFinder.log(`no path found to ${destX},${destY}`);
        const signature = [
            `${destX},${destY},${height}`,
            `b:${basicPather ? 1 : 0}`,
            `s:${size}`,
            `xl:${xLength}`,
            `yl:${yLength}`,
            `d:${direction}`,
            `m:${blockingMask}`,
        ].join("|");
        if (PathFinder.shouldEmitPathBlockedEvent(entity, signature, Date.now())) {
            PluginManager.emitPathBlocked({
                entity,
                isPlayer: entity.isPlayer(),
                username: entity.isPlayer() ? (entity.getAsPlayer()?.getUsername() ?? null) : null,
                from: {
                    x: srcX,
                    y: srcY,
                    z: height,
                },
                to: {
                    x: destX,
                    y: destY,
                    z: height,
                },
                basicPather,
                requestedSize: size,
                xLength,
                yLength,
                direction,
                blockingMask,
            });
        }
    }

    private static applyRsmodRoute(
        entity: Mobile,
        destX: number,
        destY: number,
        options: {
            destWidth?: number;
            destLength?: number;
            locAngle?: number;
            locShape?: number;
            moveNear?: boolean;
            blockAccessFlags?: number;
            maxWaypoints?: number;
            requestedSize?: number;
            xLength?: number;
            yLength?: number;
            direction?: number;
            blockingMask?: number;
        } = {}
    ): number {
        // A recalculation replaces the final stretch from the actor's live tile.
        entity.getMovementQueue().reset(false);
        entity.getMovementQueue().lastDestX = destX;
        entity.getMovementQueue().lastDestY = destY;

        const height = entity.getLocation().getZ();
        const srcX = entity.getLocation().getX();
        const srcY = entity.getLocation().getY();
        const regionBaseX = entity.getLocation().getRegionX() << 3;
        const regionBaseY = entity.getLocation().getRegionY() << 3;
        const route = PathFinder.rsmodRouteFinding.findRoute({
            level: height,
            srcX,
            srcY,
            srcSize: Math.max(entity.getSize(), 1),
            destX,
            destY,
            destWidth: options.destWidth ?? 1,
            destLength: options.destLength ?? 1,
            locAngle: options.locAngle ?? 0,
            locShape: options.locShape ?? -1,
            moveNear: options.moveNear ?? true,
            blockAccessFlags: options.blockAccessFlags ?? 0,
            // Matches OSRS's 25-checkpoint path cap (see RsmodRouteFinding's default).
            maxWaypoints: options.maxWaypoints ?? 25,
            privateArea: entity.getPrivateArea(),
        });

        if (!route.success) {
            entity.getMovementQueue().setRoute(false, route.alternative);
            entity.getMovementQueue().syncDestinationFlagToRoute();
            PathFinder.emitNoPath(
                entity,
                srcX,
                srcY,
                destX,
                destY,
                height,
                options.moveNear === true,
                options.requestedSize ?? 0,
                options.xLength ?? 0,
                options.yLength ?? 0,
                options.direction ?? 0,
                options.blockingMask ?? 0
            );
            return 0;
        }

        entity.getMovementQueue().setRoute(true, route.alternative);
        entity
            .getMovementQueue()
            .setPathX(route.endX - regionBaseX)
            .setPathY(route.endY - regionBaseY);

        let steps = 0;
        for (const waypoint of route.waypoints) {
            entity.getMovementQueue().addCheckpoint(new Location(waypoint.x, waypoint.y, waypoint.z));
            steps++;
        }
        entity.getMovementQueue().syncDestinationFlagToRoute();

        PathFinder.log(
            `route built entity=${entity.isPlayer() ? "player:" + entity.getAsPlayer().getUsername() : "npc"} steps=${steps} dest=${destX},${destY} alt=${route.alternative ? 1 : 0}`
        );
        return steps;
    }

    public static reachedEntity(entity: Mobile, target: Mobile): boolean {
        return PathFinder.rsmodRouteFinding.reachedAbsolute({
            level: entity.getLocation().getZ(),
            srcX: entity.getLocation().getX(),
            srcY: entity.getLocation().getY(),
            srcSize: Math.max(entity.getSize(), 1),
            destX: target.getLocation().getX(),
            destY: target.getLocation().getY(),
            destWidth: Math.max(target.getSize(), 1),
            destLength: Math.max(target.getSize(), 1),
            locShape: -2,
            privateArea: entity.getPrivateArea(),
        });
    }

    public static reachedObject(
        entity: Mobile,
        destX: number,
        destY: number,
        destWidth: number,
        destLength: number,
        locAngle: number,
        locShape: number,
        blockAccessFlags: number
    ): boolean {
        return PathFinder.rsmodRouteFinding.reachedAbsolute({
            level: entity.getLocation().getZ(),
            srcX: entity.getLocation().getX(),
            srcY: entity.getLocation().getY(),
            srcSize: Math.max(entity.getSize(), 1),
            destX,
            destY,
            destWidth,
            destLength,
            locAngle,
            locShape,
            blockAccessFlags,
            privateArea: entity.getPrivateArea(),
        });
    }

    static calculateCombatRoute(player: Mobile, target: Mobile) {
        PathFinder.applyRsmodRoute(player, target.getLocation().getX(), target.getLocation().getY(), {
            destWidth: Math.max(target.getSize(), 1),
            destLength: Math.max(target.getSize(), 1),
            locShape: -2,
            moveNear: true,
        });
        player.setMobileInteraction(target);
    }

    static calculateEntityRoute(player: Mobile, target: Mobile, range = 1) {
        const targetSize = Math.max(target.getSize(), 1);
        const interactionRange = Math.max(1, Math.floor(range));
        const extraReach = interactionRange - 1;
        const destinationSize = interactionRange === 1 ? targetSize : interactionRange * 2 - 1;
        return PathFinder.applyRsmodRoute(
            player,
            target.getLocation().getX() - extraReach,
            target.getLocation().getY() - extraReach,
            {
                // Widen the destination area for plugin-approved long-range interactions. The
                // route finder still walks only across collision-valid tiles; this lets an
                // interaction reach an NPC across a blocked obstacle without walking through it.
                destWidth: destinationSize,
                destLength: destinationSize,
                locShape: -2,
                moveNear: true,
            }
        );
    }

    /** OpenRune's footprint-aware destination for one-step NPC pursuit. */
    static naiveEntityDestination(source: Mobile, target: Mobile): Location {
        const sourceLocation = source.getLocation();
        const targetLocation = target.getLocation();
        const sourceSize = Math.max(1, source.getSize() | 0);
        const targetSize = Math.max(1, target.getSize() | 0);
        const diagonal = (sourceLocation.getX() - targetLocation.getX()) +
            (sourceLocation.getY() - targetLocation.getY());
        const anti = (sourceLocation.getX() - targetLocation.getX()) -
            (sourceLocation.getY() - targetLocation.getY());
        const southWest = anti < 0;
        const northWest = diagonal >= targetSize - sourceSize;
        const northEast = anti > 0;
        const southEast = diagonal <= targetSize - sourceSize;
        let offsetX = 0;
        let offsetY = 0;

        if (southWest && !northWest) {
            offsetX = -sourceSize;
            offsetY = diagonal >= -sourceSize
                ? Math.min(diagonal + sourceSize, targetSize - 1)
                : anti > -sourceSize ? -(sourceSize + anti) : 0;
        } else if (northWest && !northEast) {
            offsetX = anti >= -targetSize
                ? Math.min(anti + targetSize, targetSize - 1)
                : diagonal < targetSize ? Math.max(diagonal - targetSize, -(sourceSize - 1)) : 0;
            offsetY = targetSize;
        } else if (northEast && !southEast) {
            offsetX = targetSize;
            offsetY = anti <= targetSize
                ? targetSize - anti
                : diagonal < targetSize ? Math.max(diagonal - targetSize, -(sourceSize - 1)) : 0;
        } else {
            offsetX = diagonal > -sourceSize
                ? Math.min(diagonal + sourceSize, targetSize - 1)
                : anti < sourceSize ? Math.max(anti - sourceSize, -(sourceSize - 1)) : 0;
            offsetY = -sourceSize;
        }

        return new Location(
            targetLocation.getX() + offsetX,
            targetLocation.getY() + offsetY,
            targetLocation.getZ()
        );
    }

    static calculateWalkRoute(player: Mobile, destX: number, destY: number) {
        if (player.isPlayer()) {
            PathFinder.log(
                `calculateWalkRoute entity=player:${player.getAsPlayer().getUsername()} from=${player.getLocation().getX()},${player.getLocation().getY()},${player.getLocation().getZ()} to=${destX},${destY}`
            );
        }
        return PathFinder.applyRsmodRoute(player, destX, destY, {
            locShape: -1,
            moveNear: true,
        });
    }

    static calculateGroundItemRoute(entity: Mobile, destination: Location) {
        return PathFinder.applyRsmodRoute(entity, destination.getX(), destination.getY(), {
            locShape: -1,
            // Blocked item tiles can still be picked up from a collision-reachable side.
            moveNear: true,
        });
    }

    /** Standing exactly on the destination tile. */
    static reachedTile(entity: Mobile, destination: Location): boolean {
        return entity.getLocation().equals(destination);
    }

    /**
     * Operable distance for a ground item: on its tile, or adjacent to it. Upstream
     * expresses this as reached(shape -1) || reached(shape -2) - shape -1 has no exit
     * strategy so it only passes on an exact tile match, shape -2 is the exclusive
     * rectangle used for entities.
     */
    static reachedObj(entity: Mobile, destination: Location): boolean {
        if (PathFinder.reachedTile(entity, destination)) {
            return true;
        }
        return PathFinder.rsmodRouteFinding.reachedAbsolute({
            level: entity.getLocation().getZ(),
            srcX: entity.getLocation().getX(),
            srcY: entity.getLocation().getY(),
            srcSize: Math.max(entity.getSize(), 1),
            destX: destination.getX(),
            destY: destination.getY(),
            destWidth: 1,
            destLength: 1,
            locShape: -2,
            privateArea: entity.getPrivateArea(),
        });
    }


    /** calculateRoute with move-near enabled; a loc click settles for the closest tile. */
    static calculateObjectRoute(entity: Mobile, size: number, destX: number, destY: number, xLength: number, yLength: number, direction: number, blockingMask: number) {
        return PathFinder.calculateRoute(entity, size, destX, destY, xLength, yLength, direction, blockingMask, true);
    }

    public static calculateRoute(entity: Mobile, size: number, destX: number, destY: number, xLength: number, yLength: number, direction: number, blockingMask: number, basicPather: boolean): number {
        PathFinder.log(
            `calculateRoute entity=${entity.isPlayer() ? "player:" + entity.getAsPlayer().getUsername() : "npc"} dest=${destX},${destY} size=${size} basic=${basicPather}`
        );
        let destWidth = 1;
        let destLength = 1;
        let locShape = -1;
        let locAngle = 0;
        let blockAccessFlags = 0;

        if (xLength > 0 && yLength > 0) {
            destWidth = xLength;
            destLength = yLength;
            locShape = 10;
            locAngle = direction;
            blockAccessFlags = blockingMask;
        } else if (size !== 0) {
            locShape = size - 1;
            locAngle = direction;
            blockAccessFlags = blockingMask;
        }

        return PathFinder.applyRsmodRoute(entity, destX, destY, {
            destWidth,
            destLength,
            locAngle,
            locShape,
            moveNear: basicPather,
            blockAccessFlags,
            requestedSize: size,
            xLength,
            yLength,
            direction,
            blockingMask,
        });
    }

    public static findWalkable(entity: Mobile, x: number, y: number, targetSize: number): boolean {
        // Step West
        if (PathFinder.calculateRoute(entity, entity.getSize(), x - targetSize, y, 0, 0, 0, 0, false) > 0)
            return true;
        // Step East
        if (PathFinder.calculateRoute(entity, entity.getSize(), x + targetSize, y, 0, 0, 0, 0, false) > 0)
            return true;
        // Step North
        if (PathFinder.calculateRoute(entity, entity.getSize(), x, y + targetSize, 0, 0, 0, 0, false) > 0)
            return true;
        // Step South
        if (PathFinder.calculateRoute(entity, entity.getSize(), x, y - targetSize, 0, 0, 0, 0, false) > 0)
            return true;
        return false;
    }
}    
