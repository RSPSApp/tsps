/** Type alias for rendering context (supports both regular and offscreen canvas) */
export type RenderContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface WorldGridLayout {
    cols: number;
    rows: number;
    xGap: number;
    yGap: number;
    xOffset: number;
    yOffset: number;
    rowWidth: number;
    rowHeight: number;
    worldCount: number;
    columnsPerPage: number;
    totalColumns: number;
}

export interface WorldHoverResult {
    index: number; // Index in sorted worlds array, or -1 if none
    world: World | null; // The hovered world, or null
    x: number; // X position of hovered cell
    y: number; // Y position of hovered cell
}

/** How the login scene may grow past 1:1 on large viewports (Stretched Mode). */
export interface LoginStretch {
    integerScaling: boolean;
}

export interface LoginLayoutConfig {
    /** Scale factor for all positions/sizes (1.0 = desktop baseline) */
    scale: number;
    /** Mobile mode active (touch device or forced via URL) */
    isMobile: boolean;
    /** Touch input detected */
    isTouch: boolean;
    /** Minimum touch target size (44px scaled) */
    minTouchTarget: number;
    /** Use list view for world select instead of grid */
    worldSelectListMode: boolean;
    /** Screen orientation */
    orientation: "portrait" | "landscape";
    /** Viewport width */
    viewportWidth: number;
    /** Viewport height */
    viewportHeight: number;
}

export interface World {
    id: number;
    population: number; // -1 = offline
    location: number; // 0=US, 1=UK, 3=Australia, 7=Germany
    activity: string; // World type description
    properties: number; // Flags: 1=members, 4=pvp, etc.
}

export const WorldFlags = {
    MEMBERS: 1,
    PVP: 4,
    BOUNTY: 0x20,
    HIGH_RISK: 0x400,
    SKILL_TOTAL: 0x800,
    BETA: 0x20000,
    FRESH_START: 0x2000000,
    DEADMAN: 0x20000000,
} as const;

export enum WorldBackgroundType {
    FREE_NORMAL = 0,
    MEMBERS_NORMAL = 1,
    FREE_PVP = 2,
    MEMBERS_PVP = 3,
    FREE_BETA = 4,
    MEMBERS_BETA = 5,
    FREE_DEADMAN = 6,
    MEMBERS_DEADMAN = 7,
    FREE_FRESH_START = 8,
    MEMBERS_FRESH_START = 9,
    FREE_HIGH_RISK = 10,
    MEMBERS_HIGH_RISK = 11,
}

export interface ServerListEntry {
    name: string;
    address: string;
    secure: boolean;
    playerCount: number | null;
    maxPlayers: number;
    transport?: "websocket" | "webrtc";
    signalUrl?: string;
    worldId?: string;
    ownerUsername?: string;
    iceServers?: RTCIceServer[];
    relayDiscovered?: boolean;
}
