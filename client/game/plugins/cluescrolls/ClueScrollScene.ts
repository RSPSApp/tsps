/*
 * Copyright (c) 2016-2017, Seth <Sethtroll3@gmail.com>
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import type { NPC } from "@runelite/api/Client";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import { Polygon, type Shape } from "@runelite/awt/Shapes";
import { ClientState } from "../../ClientState";
import type { OsrsClient } from "../../OsrsClient";
import type { SceneGeometry, SceneLoc } from "../../scene/SceneGeometry";
import { convexHull } from "../npcindicators/npcMatching";
import type { ClueScrollPlugin } from "./ClueScrollPlugin";
import type { ClueScroll } from "./clues/ClueScroll";
import { isNamedObjectClueScroll, isNpcClueScroll, npcClueRegions } from "./clues/ClueScrollTypes";
import type { TileObject } from "./clues/TileObject";

/** Tiles on a scene side (RuneLite's Constants.SCENE_SIZE). */
const SCENE_SIZE = 104;

/** A loc in the scene as RuneLite's TileObject: its base id, tile, plane and clickbox this frame. */
export class SceneTileObject implements TileObject {
    private readonly worldLocation: WorldPoint;

    constructor(
        private readonly client: OsrsClient,
        readonly loc: SceneLoc,
    ) {
        this.worldLocation = new WorldPoint(loc.tileX, loc.tileY, loc.plane);
    }

    getId(): number {
        return this.loc.id;
    }

    getWorldLocation(): WorldPoint {
        return this.worldLocation;
    }

    getPlane(): number {
        return this.loc.plane;
    }

    /** The projected hull of the loc's model(s) (RuneLite's getClickbox), or its tile when there is no model. */
    getClickbox(): Shape | null {
        const geometry = this.client.sceneGeometry;
        if (!geometry) return null;
        const projected: Array<[number, number]> = [];
        for (const part of geometry.locModelPoints(this.loc) ?? []) {
            for (const [x, h, y] of part) {
                const p = geometry.worldToScreen(x, h, y);
                if (p) projected.push([p[0], p[1]]);
            }
        }
        if (projected.length >= 3) return new Polygon(convexHull(projected));
        return tilePolygon(geometry, this.loc.tileX, this.loc.tileY, this.loc.plane);
    }

    /** The same loc seen twice is the same object (RuneLite keeps object identity across frames). */
    sameAs(other: SceneTileObject): boolean {
        return other.loc.id === this.loc.id && other.loc.tileX === this.loc.tileX && other.loc.tileY === this.loc.tileY && other.loc.plane === this.loc.plane;
    }
}

function tilePolygon(geometry: SceneGeometry, x: number, y: number, plane: number): Polygon | null {
    const points: Array<[number, number]> = [];
    for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as const) {
        const p = geometry.worldToScreen(cx, geometry.tileHeight(cx, cy, plane), cy);
        if (!p) return null;
        points.push([p[0], p[1]]);
    }
    return new Polygon(points);
}

/** The loc's name, after the player's vars pick its form (RuneLite's impostor). */
function objectNames(plugin: ClueScrollPlugin, id: number): string[] {
    const definition = plugin.getClient().getObjectDefinition(id);
    if (!definition) return [];
    const impostor = definition.getImpostorIds() !== null ? definition.getImpostor() : definition;
    return [definition.getName(), impostor?.getName() ?? "null"];
}

/** Adds the NPCs the clue names to the plugin's marked list and points the hint arrow at the first. */
export function checkClueNPCs(plugin: ClueScrollPlugin, clue: ClueScroll | null, npcs: Iterable<NPC>): void {
    if (!clue || !isNpcClueScroll(clue)) return;
    const clueNpcs = clue.getNpcs(plugin);
    const regions = npcClueRegions(clue);
    if (clueNpcs.length === 0) return;
    for (const npc of npcs) {
        const name = npc.getName();
        if (name === null) continue;
        if (regions.length > 0 && !regions.includes(npc.getWorldLocation().getRegionID())) continue;
        for (const npcName of clueNpcs) {
            if (name === npcName) plugin.getNpcsToMark().push(npc);
        }
    }
    if (plugin.getNpcsToMark().length > 0 && plugin.displayHintArrows()) {
        // Always point at the first NPC seen.
        plugin.getClient().setHintArrow(plugin.getNpcsToMark()[0]);
    }
}

/** Scans the loaded scene's current plane for the objects a named-object clue wants. */
export function checkClueNamedObjects(plugin: ClueScrollPlugin, clue: ClueScroll | null): void {
    if (!clue || !isNamedObjectClueScroll(clue)) return;
    const geometry = plugin.osrsClient.sceneGeometry;
    if (!geometry) return;
    const plane = plugin.getClient().getPlane();
    for (let x = ClientState.baseX; x < ClientState.baseX + SCENE_SIZE; x++) {
        for (let y = ClientState.baseY; y < ClientState.baseY + SCENE_SIZE; y++) {
            for (const loc of geometry.locsAtTile(x, y, plane)) checkClueNamedObject(plugin, clue, new SceneTileObject(plugin.osrsClient, loc));
        }
    }
}

/** Marks one object when a named-object clue names it (and, when it limits regions, its region). */
export function checkClueNamedObject(plugin: ClueScrollPlugin, clue: ClueScroll | null, object: TileObject): void {
    if (!clue || !isNamedObjectClueScroll(clue)) return;
    const names = clue.getObjectNames();
    const regions = clue.getObjectRegions();
    if (names.length === 0 || (regions !== null && !regions.includes(object.getWorldLocation().getRegionID()))) return;
    const found = objectNames(plugin, object.getId());
    for (const name of names) {
        if (found.includes(name)) plugin.getNamedObjectsToMark().add(object);
    }
}

/** Marks the objects with one of the ids standing on a tile (the clue's crate, chest or tree). */
export function highlightObjectsForLocation(plugin: ClueScrollPlugin, location: WorldPoint, objectIds: number[]): void {
    if (!location.isInScene(plugin.getClient())) return;
    const geometry = plugin.osrsClient.sceneGeometry;
    if (!geometry) return;
    for (const loc of geometry.locsAtTile(location.getX(), location.getY(), plugin.getClient().getPlane())) {
        for (const id of objectIds) {
            if (loc.id === id) {
                plugin.getObjectsToMark().push(new SceneTileObject(plugin.osrsClient, loc));
                continue;
            }
            // The loc may be a multiloc whose current form is the id the clue names.
            const definition = plugin.getClient().getObjectDefinition(loc.id);
            const impostor = definition && definition.getImpostorIds() !== null ? definition.getImpostor() : definition;
            if (impostor && impostor.getId() === id) plugin.getObjectsToMark().push(new SceneTileObject(plugin.osrsClient, loc));
        }
    }
}
