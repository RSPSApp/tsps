import { getServerListUrl } from "../../../config/clientEnv";
import type { ServerListEntry, World } from "./types";

export const MOCK_WORLDS: World[] = [
    { id: 301, population: 487, location: 0, activity: "Trade - Free", properties: 0 },
    { id: 302, population: 1243, location: 0, activity: "Trade - Members", properties: 1 },
    { id: 303, population: 89, location: 1, activity: "Skill Total 500", properties: 1 },
    { id: 304, population: 234, location: 1, activity: "PvP World", properties: 1 | 4 },
    { id: 305, population: 567, location: 0, activity: "Free-to-play", properties: 0 },
    { id: 306, population: 1890, location: 3, activity: "Members", properties: 1 },
    { id: 307, population: 45, location: 7, activity: "Skill Total 750", properties: 1 },
    { id: 308, population: 678, location: 0, activity: "Members", properties: 1 },
    { id: 309, population: -1, location: 1, activity: "Offline", properties: 0 },
    { id: 310, population: 432, location: 0, activity: "Members", properties: 1 },
    { id: 311, population: 123, location: 3, activity: "Free-to-play", properties: 0 },
    { id: 312, population: 876, location: 7, activity: "Members", properties: 1 },
    { id: 313, population: 345, location: 0, activity: "Bounty Hunter", properties: 1 },
    { id: 314, population: 654, location: 1, activity: "Members", properties: 1 },
    { id: 315, population: 234, location: 0, activity: "Free-to-play", properties: 0 },
    { id: 316, population: 1567, location: 0, activity: "Members", properties: 1 },
];

export const FALLBACK_SERVERS: ServerListEntry[] = [
    {
        name: "Local Development",
        address: "localhost:43594",
        secure: false,
        playerCount: null,
        maxPlayers: 2047,
    },
];

export const SERVER_LIST_URL = getServerListUrl();
export const SERVER_LIST_PANEL_WIDTH = 380;
export const SERVER_LIST_OWNER_COLUMN_START = 150;
export const SERVER_LIST_PLAYERS_COLUMN_START = 310;

export const LOGIN_LAYOUT = {
    LOGIN_BOX_X: 202,
    LOGIN_BOX_CENTER: 382,
    TITLEBOX_Y: 170,
    TITLEBOX_FALLBACK_WIDTH: 360,
    TITLEBOX_FALLBACK_HEIGHT: 200,
    BOTTOM_CONTROLS_RESERVE: 52,
    BOTTOM_CONTROLS_Y: 463,
    CONTENT_WIDTH: 765,
    SCENE_WIDTH: 765,
    SCENE_HEIGHT: 503,
    TITLE_BG_WIDTH: 1089,
    /** How much larger than the scene the cache's title art may be drawn on large viewports. */
    TITLE_ART_MAX_GROWTH: 2,
    MAX_BG_WIDTH: 765,
    MAX_BG_HEIGHT: 503,
    // Viewport height (CSS px) at which the classic scene draws 1:1, about a maximised
    // browser on a 1080p screen. Taller viewports grow the scene by the same ratio.
    SCENE_REFERENCE_VIEWPORT_HEIGHT: 960,
    CARET_BLINK_INTERVAL_MS: 500,
} as const;
