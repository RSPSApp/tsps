import type { WorldEntity } from "../worldview/WorldEntity";

/** sailing_sidepanel_player_at_helm: set by the server while the player steers. */
const VARBIT_PLAYER_AT_HELM = 19205;
const FINE_UNITS_PER_TILE = 128;
/** Helm headings are 16 steps of 128 angle units. */
const HEADING_STEP = 128;

export interface HelmSteeringDeps {
    getVarbit(varbitId: number): number;
    /** World view (boat) the local player stands in, or -1. */
    getLocalWorldViewId(): number;
    getWorldEntity(entityIndex: number): WorldEntity | undefined;
    /** Whether a tile is in the boat's deck scene rather than the main world. */
    isDeckTile(entityIndex: number, tileX: number, tileY: number): boolean;
    projectDeckToWorld(
        entityIndex: number,
        fineX: number,
        fineY: number,
    ): { x: number; y: number } | undefined;
    /** World fine point on the sea under the last left click. */
    pickClickedSeaPoint(entityIndex: number): { x: number; y: number } | undefined;
    sendSetHeading(heading: number): void;
}

/**
 * While the player is at a helm, a walk click steers instead: like the OSRS client in heading
 * interaction mode, the heading is worked out from the boat as it is drawn and sent as
 * SET_HEADING. Returns false when the click should walk as normal.
 */
export function steerFromHelm(deps: HelmSteeringDeps, tileX: number, tileY: number): boolean {
    const debug = (globalThis as { __helmDebug?: boolean }).__helmDebug === true;
    const atHelm = deps.getVarbit(VARBIT_PLAYER_AT_HELM) | 0;
    const entityIndex = deps.getLocalWorldViewId();
    const boat = entityIndex >= 0 ? deps.getWorldEntity(entityIndex) : undefined;
    if (atHelm !== 1 || entityIndex < 0 || !boat?.hasPosition) {
        if (debug) console.log("[helm] not steering", JSON.stringify({ tileX, tileY, atHelm, entityIndex }));
        return false;
    }

    let targetX = tileX * FINE_UNITS_PER_TILE + FINE_UNITS_PER_TILE / 2;
    let targetY = tileY * FINE_UNITS_PER_TILE + FINE_UNITS_PER_TILE / 2;
    // Clicks near the boat resolve to tiles of its deck scene, which aren't reliable for the
    // sea around it, so aim at where the click meets the water instead.
    const onDeck = deps.isDeckTile(entityIndex, tileX, tileY);
    if (onDeck) {
        const world =
            deps.pickClickedSeaPoint(entityIndex) ??
            deps.projectDeckToWorld(entityIndex, targetX, targetY);
        if (!world) return true;
        targetX = world.x;
        targetY = world.y;
    }

    const heading = headingIndexToward(boat.position.x, boat.position.z, targetX, targetY);
    if (debug) {
        console.log("[helm] steer", JSON.stringify({
            clickedTile: { x: tileX, y: tileY },
            onDeck,
            targetTile: { x: targetX / FINE_UNITS_PER_TILE, y: targetY / FINE_UNITS_PER_TILE },
            boatTile: {
                x: boat.position.x / FINE_UNITS_PER_TILE,
                y: boat.position.z / FINE_UNITS_PER_TILE,
            },
            heading,
        }));
    }
    if (heading !== undefined) deps.sendSetHeading(heading);
    return true;
}

/** Packed heading (0-15) from one fine position to another; undefined when they coincide. */
export function headingIndexToward(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
): number | undefined {
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (Math.abs(dx) < FINE_UNITS_PER_TILE / 2 && Math.abs(dy) < FINE_UNITS_PER_TILE / 2) {
        return undefined;
    }
    // Angle 0 faces south and increases clockwise seen from above (512 = west).
    const angle = Math.atan2(-dx, -dy) * (1024 / Math.PI);
    return Math.round(angle / HEADING_STEP) & 15;
}

/** The pieces of the client the helm steering needs. */
export interface HelmSteeringClient {
    varManager: { getVarbit(varbitId: number): number };
    controlledPlayerServerId: number;
    playerEcs: {
        getIndexForServerId(serverId: number): number | undefined;
        getWorldViewId(index: number): number;
    };
    worldViewManager: {
        getWorldEntity(entityIndex: number): WorldEntity | undefined;
        getWorldView(entityIndex: number): { containsTile(x: number, y: number): boolean } | undefined;
    };
    renderer?: unknown;
    inputManager?: { leftClickX: number; leftClickY: number };
}

export function createHelmSteeringDeps(
    client: HelmSteeringClient,
    sendSetHeading: (heading: number) => void,
): HelmSteeringDeps {
    return {
        getVarbit: (varbitId) => client.varManager.getVarbit(varbitId),
        getLocalWorldViewId: () => {
            const index = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
            return index === undefined ? -1 : client.playerEcs.getWorldViewId(index) | 0;
        },
        getWorldEntity: (entityIndex) => client.worldViewManager.getWorldEntity(entityIndex),
        isDeckTile: (entityIndex, tileX, tileY) =>
            client.worldViewManager.getWorldView(entityIndex)?.containsTile(tileX, tileY) ?? false,
        projectDeckToWorld: (entityIndex, fineX, fineY) =>
            (
                client.renderer as
                    | {
                          projectDeckToWorld?: (
                              entityIndex: number,
                              fineX: number,
                              fineY: number,
                          ) => { x: number; y: number } | undefined;
                      }
                    | undefined
            )?.projectDeckToWorld?.(entityIndex, fineX, fineY),
        pickClickedSeaPoint: (entityIndex) => {
            const input = client.inputManager;
            if (!input) return undefined;
            return (
                client.renderer as
                    | {
                          pickSeaPointAt?: (
                              entityIndex: number,
                              mouseX: number,
                              mouseY: number,
                          ) => { x: number; y: number } | undefined;
                      }
                    | undefined
            )?.pickSeaPointAt?.(entityIndex, input.leftClickX, input.leftClickY);
        },
        sendSetHeading,
    };
}
