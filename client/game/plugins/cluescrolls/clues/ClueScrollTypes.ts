/*
 * Copyright (c) 2018, Tomas Slusny <slusnucky@gmail.com>
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * Copyright (c) 2020, Jordan Atwood <jordan.atwood423@gmail.com>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { WorldPoint } from "@runelite/api/coords/WorldPoint";
import type { ClueScrollPlugin } from "../ClueScrollPlugin";

/**
 * RuneLite's clue capability interfaces. Java tests them with `instanceof`; here each has a type
 * guard that checks for the interface's methods.
 */

/** A clue with one place to go (LocationClueScroll); `getLocations` defaults to that one place. */
export interface LocationClueScroll {
    getLocation(plugin: ClueScrollPlugin): WorldPoint | null;
    getLocations?(plugin: ClueScrollPlugin): WorldPoint[];
}

/** A clue with several places that narrow down or get ticked off (LocationsClueScroll). */
export interface LocationsClueScroll {
    reset(): void;
    getLocations(plugin: ClueScrollPlugin): WorldPoint[];
}

/** A clue that points at an object by id at its location (ObjectClueScroll). */
export interface ObjectClueScroll extends LocationClueScroll {
    getObjectIds(): number[];
}

/** A clue that highlights objects by name, optionally only in some regions (NamedObjectClueScroll). */
export interface NamedObjectClueScroll {
    getObjectNames(): string[];
    getObjectRegions(): number[] | null;
}

/** A clue that points at NPCs by name, optionally only in some regions (NpcClueScroll). */
export interface NpcClueScroll {
    getNpcs(plugin: ClueScrollPlugin): Array<string | null>;
    getNpcRegions?(): number[];
}

const has = (value: unknown, method: string): boolean =>
    typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)[method] === "function";

export function isLocationClueScroll(clue: unknown): clue is LocationClueScroll {
    return has(clue, "getLocation");
}

export function isLocationsClueScroll(clue: unknown): clue is LocationsClueScroll {
    return has(clue, "reset") && has(clue, "getLocations");
}

export function isObjectClueScroll(clue: unknown): clue is ObjectClueScroll {
    return has(clue, "getObjectIds");
}

export function isNamedObjectClueScroll(clue: unknown): clue is NamedObjectClueScroll {
    return has(clue, "getObjectNames");
}

export function isNpcClueScroll(clue: unknown): clue is NpcClueScroll {
    return has(clue, "getNpcs");
}

/** LocationClueScroll.getLocations' default: the one location, or none. */
export function locationClueLocations(clue: LocationClueScroll, plugin: ClueScrollPlugin): WorldPoint[] {
    if (clue.getLocations) return clue.getLocations(plugin);
    const location = clue.getLocation(plugin);
    return location ? [location] : [];
}

/** NpcClueScroll.getNpcRegions' default: no restriction. */
export function npcClueRegions(clue: NpcClueScroll): number[] {
    return clue.getNpcRegions ? clue.getNpcRegions() : [];
}
