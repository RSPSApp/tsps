import type { EditModeTile, EditModeWorldZone, EditModeBoundedWorldZone } from "./types";

type WorldMapArea = {
    id: number;
    regionLowX: number;
    regionHighX: number;
    regionLowY: number;
    regionHighY: number;
    coord(x: number, y: number): { plane: number; x: number; y: number } | undefined;
};

type EditorWorldMapClient = {
    worldMapState: {
        currentArea?: WorldMapArea;
        displayX: number;
        displayY: number;
        setCurrentMapAreaId(id: number): void;
        setCurrentMapAreaAndPosition(plane: number, x: number, y: number): void;
        setDisplayPosition(x: number, y: number): void;
    };
    getWorldMapImageTile(
        mapX: number,
        mapY: number,
        level?: number,
        accessPriority?: number,
    ): { pixels?: Uint8Array; width: number; height: number } | undefined;
};

const MAX_TILE_CANVASES = 48;

type ZoneVisibility = { showPvp: boolean; showMulti: boolean; showDuel: boolean; showSafe: boolean; showF2p: boolean };

// Draw order on overlap: the first visible tag wins.
const ZONE_TYPE_LABELS = [["duel", "Duel"], ["safe", "Safe"], ["f2p", "F2P"], ["pvp", "PvP"], ["multi-combat", "Multi-combat"]] as const;
const ZONE_COLORS: Record<string, string> = {
    duel: "#c4b5fd", safe: "#86efac", f2p: "#93c5fd", pvp: "#fca5a5", "multi-combat": "#fcd34d",
};

/** The colour a zone is drawn in, or undefined while none of its tags are toggled on. */
function zoneColor(visible: ZoneVisibility, zone: EditModeWorldZone): string | undefined {
    const shown: Record<string, boolean> = {
        duel: visible.showDuel, safe: visible.showSafe, f2p: visible.showF2p, pvp: visible.showPvp, "multi-combat": visible.showMulti,
    };
    const tag = ZONE_TYPE_LABELS.find(([tag]) => shown[tag] && zone.tags.includes(tag))?.[0];
    return tag ? ZONE_COLORS[tag] : undefined;
}

/**
 * The editor map deliberately does not mount widget group 595. It reuses the
 * cached in-game map tiles, but owns its DOM and pointer events completely.
 */
export class EditorWorldMap {
    private panel?: HTMLDivElement;
    private canvas?: HTMLCanvasElement;
    private context?: CanvasRenderingContext2D;
    private abort?: AbortController;
    private centerX = 0;
    private centerY = 0;
    private anchorTile?: EditModeTile;
    private pixelsPerTile = 2;
    private animationFrame?: number;
    private previousMapState?: { areaId: number; displayX: number; displayY: number };
    private readonly tileCanvases = new Map<string, HTMLCanvasElement>();
    private plotting = false;
    private plotStart?: { x: number; y: number };
    private plotEnd?: { x: number; y: number };
    private selectedZoneIndex?: number;
    private newZoneButton?: HTMLButtonElement;
    private zoneTypeSelect?: HTMLSelectElement;
    private deleteZoneButton?: HTMLButtonElement;

    constructor(
        private readonly client: EditorWorldMapClient,
        private readonly onNavigate: (tile: EditModeTile) => void,
        private readonly getZones: () => (ZoneVisibility & { zones: readonly EditModeWorldZone[] }) | undefined,
        private readonly onZoneResize: (index: number, bounds: Pick<EditModeBoundedWorldZone, "minX" | "maxX" | "minY" | "maxY">) => void,
        private readonly onNewZone: (bounds: Pick<EditModeBoundedWorldZone, "minX" | "maxX" | "minY" | "maxY">, tag: EditModeWorldZone["tags"][number]) => void,
        private readonly onZoneTypeChange: (index: number, tag: EditModeWorldZone["tags"][number]) => void,
        private readonly onZoneDelete: (index: number) => void,
    ) {}

    private get canEditZones(): boolean {
        return this.getZones() !== undefined;
    }

    isOpen(): boolean {
        return this.panel !== undefined;
    }

    toggle(tile: EditModeTile | undefined): void {
        if (this.panel) {
            this.close();
            return;
        }
        if (!tile) return;
        const state = this.client.worldMapState;
        this.previousMapState = state.currentArea
            ? { areaId: state.currentArea.id, displayX: state.displayX, displayY: state.displayY }
            : undefined;
        state.setCurrentMapAreaAndPosition(tile.plane, tile.tileX, tile.tileY);
        this.centerX = state.displayX;
        this.centerY = state.displayY;
        this.anchorTile = { ...tile };
        this.open();
    }

    close(): void {
        if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = undefined;
        this.abort?.abort();
        this.abort = undefined;
        this.panel?.remove();
        this.panel = undefined;
        this.canvas = undefined;
        this.context = undefined;
        this.tileCanvases.clear();
        this.anchorTile = undefined;
        this.plotting = false;
        this.plotStart = undefined;
        this.plotEnd = undefined;
        this.selectedZoneIndex = undefined;
        this.zoneTypeSelect = undefined;
        this.deleteZoneButton = undefined;
        if (this.previousMapState) {
            const { areaId, displayX, displayY } = this.previousMapState;
            this.client.worldMapState.setCurrentMapAreaId(areaId);
            this.client.worldMapState.setDisplayPosition(displayX, displayY);
            this.previousMapState = undefined;
        }
    }

    private open(): void {
        const panel = document.createElement("div");
        const canvas = document.createElement("canvas");
        const heading = document.createElement("strong");
        const close = document.createElement("button");
        this.panel = panel;
        this.canvas = canvas;
        this.context = canvas.getContext("2d") ?? undefined;
        this.abort = new AbortController();
        const signal = this.abort.signal;

        panel.dataset.mapEditor = "world-map";
        Object.assign(panel.style, {
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: "10006",
            width: "min(900px, calc(100vw - 32px))",
            height: "min(720px, calc(100vh - 32px))",
            display: "flex",
            flexDirection: "column",
            padding: "12px",
            boxSizing: "border-box",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: "7px",
            color: "#e5e7eb",
            background: "rgba(18,20,24,0.98)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.58)",
            font: "12px/1.4 sans-serif",
        });
        const header = document.createElement("div");
        Object.assign(header.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "9px",
        });
        heading.textContent = "World map";
        close.type = "button";
        close.textContent = "×";
        close.title = "Close world map";
        close.setAttribute("aria-label", close.title);
        Object.assign(close.style, {
            width: "25px",
            height: "25px",
            padding: "0",
            border: "0",
            color: "#aeb8c8",
            background: "transparent",
            cursor: "pointer",
            font: "22px/22px sans-serif",
        });
        close.addEventListener("click", () => this.close(), { signal });
        const newZone = this.newZoneButton = document.createElement("button");
        newZone.type = "button";
        newZone.textContent = "⤢  New zone";
        newZone.style.display = this.canEditZones ? "inline-block" : "none";
        newZone.title = "Plot a new zone by dragging a rectangle on the map";
        Object.assign(newZone.style, {
            height: "25px", padding: "0 9px", border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "4px", color: "#e5e7eb", background: "#1b1e25", cursor: "pointer",
        });
        newZone.addEventListener("click", () => {
            this.setSelectedZone(undefined);
            this.plotting = !this.plotting;
            newZone.style.background = this.plotting ? "#374151" : "#1b1e25";
            canvas.style.cursor = this.plotting ? "crosshair" : "grab";
        }, { signal });
        const zoneType = document.createElement("select");
        zoneType.title = "Zone type";
        zoneType.setAttribute("aria-label", zoneType.title);
        for (const [tag, label] of ZONE_TYPE_LABELS) zoneType.add(new Option(label, tag));
        Object.assign(zoneType.style, {
            display: "none", height: "25px", padding: "0 5px", border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "4px", color: "#e5e7eb", background: "#303640", font: "inherit",
        });
        zoneType.addEventListener("change", () => {
            if (this.selectedZoneIndex !== undefined) this.onZoneTypeChange(this.selectedZoneIndex, zoneType.value as EditModeWorldZone["tags"][number]);
        }, { signal });
        const deleteZone = document.createElement("button");
        deleteZone.type = "button";
        deleteZone.textContent = "Delete zone";
        deleteZone.title = "Delete selected zone";
        Object.assign(deleteZone.style, {
            display: "none", height: "25px", padding: "0 9px", border: "1px solid rgba(248,113,113,0.45)",
            borderRadius: "4px", color: "#fca5a5", background: "rgba(127,29,29,0.22)", cursor: "pointer",
        });
        deleteZone.addEventListener("click", () => {
            if (this.selectedZoneIndex === undefined) return;
            this.onZoneDelete(this.selectedZoneIndex);
            this.setSelectedZone(undefined);
        }, { signal });
        this.zoneTypeSelect = zoneType;
        this.deleteZoneButton = deleteZone;
        const zoneControl = document.createElement("div");
        Object.assign(zoneControl.style, { display: "inline-flex", gap: "0" });
        Object.assign(zoneType.style, { borderRadius: "4px 0 0 4px", margin: "0", boxSizing: "border-box" });
        Object.assign(newZone.style, { borderRadius: "0 4px 4px 0", borderLeft: "0", margin: "0", boxSizing: "border-box" });
        zoneControl.append(zoneType, newZone);
        header.append(heading, zoneControl, deleteZone, close);
        Object.assign(canvas.style, {
            flex: "1 1 auto",
            minHeight: "0",
            width: "100%",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "4px",
            background: "#090b0f",
            cursor: "grab",
            touchAction: "none",
        });
        panel.append(header, canvas);
        panel.addEventListener("mousedown", (event) => event.stopPropagation(), { signal });
        panel.addEventListener("click", (event) => event.stopPropagation(), { signal });
        document.body.appendChild(panel);

        let dragging = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let originX = 0;
        let originY = 0;
        let zoneDrag: { index: number; corner: "nw" | "ne" | "sw" | "se" | "n" | "e" | "s" | "w" } | undefined;
        canvas.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            if (this.plotting) {
                this.plotStart = this.worldTileAt(event.offsetX, event.offsetY);
                this.plotEnd = this.plotStart;
                moved = false;
                dragging = true;
                canvas.setPointerCapture(event.pointerId);
                return;
            }
            zoneDrag = this.zoneHandleAt(event.offsetX, event.offsetY);
            if (zoneDrag) this.setSelectedZone(zoneDrag.index);
            dragging = true;
            moved = false;
            startX = event.clientX;
            startY = event.clientY;
            originX = this.centerX;
            originY = this.centerY;
            canvas.setPointerCapture(event.pointerId);
            canvas.style.cursor = "grabbing";
        }, { signal });
        canvas.addEventListener("pointermove", (event) => {
            if (!dragging) {
                canvas.style.cursor = this.plotting ? "crosshair" : this.zoneCursorAt(event.offsetX, event.offsetY);
                return;
            }
            if (this.plotting && this.plotStart) {
                this.plotEnd = this.worldTileAt(event.offsetX, event.offsetY);
                moved = true;
                return;
            }
            if (!zoneDrag) canvas.style.cursor = this.zoneCursorAt(event.offsetX, event.offsetY);
            if (zoneDrag) {
                const zone = this.getZones()?.zones[zoneDrag.index];
                const next = this.worldTileAt(event.offsetX, event.offsetY);
                if (zone && zone.minX !== undefined && next) {
                    const bounds = {
                        minX: zoneDrag.corner.includes("w") ? Math.min(next.x, zone.maxX - 1) : zone.minX,
                        maxX: zoneDrag.corner.includes("e") ? Math.max(next.x, zone.minX + 1) : zone.maxX,
                        minY: zoneDrag.corner.includes("s") ? Math.min(next.y, zone.maxY - 1) : zone.minY,
                        maxY: zoneDrag.corner.includes("n") ? Math.max(next.y, zone.minY + 1) : zone.maxY,
                    };
                    this.onZoneResize(zoneDrag.index, bounds);
                    moved = true;
                }
                return;
            }
            const deltaX = event.clientX - startX;
            const deltaY = event.clientY - startY;
            moved ||= Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4;
            this.centerX = originX - deltaX / this.pixelsPerTile;
            this.centerY = originY + deltaY / this.pixelsPerTile;
        }, { signal });
        const release = (event: PointerEvent) => {
            if (!dragging) return;
            dragging = false;
            if (this.plotting && this.plotStart && this.plotEnd) {
                this.onNewZone({ minX: Math.min(this.plotStart.x, this.plotEnd.x), maxX: Math.max(this.plotStart.x, this.plotEnd.x), minY: Math.min(this.plotStart.y, this.plotEnd.y), maxY: Math.max(this.plotStart.y, this.plotEnd.y) }, zoneType.value as EditModeWorldZone["tags"][number]);
                this.plotStart = undefined;
                this.plotEnd = undefined;
                this.plotting = false;
                newZone.style.background = "#1b1e25";
                canvas.style.cursor = "grab";
            }
            const selected = zoneDrag?.index ?? this.zoneAt(event.offsetX, event.offsetY);
            zoneDrag = undefined;
            canvas.style.cursor = this.plotting ? "crosshair" : this.zoneCursorAt(event.offsetX, event.offsetY);
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
            if (!moved && selected !== undefined) this.setSelectedZone(selected);
            else if (!moved) this.navigate(event.offsetX, event.offsetY);
        };
        canvas.addEventListener("pointerup", release, { signal });
        canvas.addEventListener("pointercancel", release, { signal });
        canvas.addEventListener("wheel", (event) => {
            event.preventDefault();
            this.pixelsPerTile = Math.max(1, Math.min(8, this.pixelsPerTile * (event.deltaY < 0 ? 1.25 : 0.8)));
        }, { passive: false, signal });
        window.addEventListener("keydown", (event) => {
            if (event.key === "Escape") this.close();
        }, { capture: true, signal });
        this.draw();
    }

    private navigate(screenX: number, screenY: number): void {
        const canvas = this.canvas;
        const area = this.client.worldMapState.currentArea;
        if (!canvas || !area) return;
        const displayX = Math.floor(this.centerX + (screenX - canvas.width / 2) / this.pixelsPerTile);
        const displayY = Math.floor(this.centerY - (screenY - canvas.height / 2) / this.pixelsPerTile);
        const coord = area.coord(displayX, displayY);
        if (!coord) return;
        this.close();
        this.onNavigate({ tileX: coord.x, tileY: coord.y, plane: coord.plane });
    }

    private worldTileAt(screenX: number, screenY: number): { x: number; y: number } | undefined {
        const canvas = this.canvas;
        if (!canvas) return undefined;
        return {
            x: Math.floor(this.centerX + (screenX - canvas.width / 2) / this.pixelsPerTile),
            y: Math.floor(this.centerY - (screenY - canvas.height / 2) / this.pixelsPerTile),
        };
    }

    private zoneHandleAt(screenX: number, screenY: number): { index: number; corner: "nw" | "ne" | "sw" | "se" } | undefined {
        if (!this.canEditZones) return undefined;
        const canvas = this.canvas;
        const visible = this.getZones();
        if (!canvas || !visible) return undefined;
        const corners = (zone: EditModeBoundedWorldZone) => [
            ["nw", zone.minX, zone.maxY + 1], ["ne", zone.maxX + 1, zone.maxY + 1],
            ["sw", zone.minX, zone.minY], ["se", zone.maxX + 1, zone.minY],
        ] as const;
        for (let index = 0; index < visible.zones.length; index++) {
            const zone = visible.zones[index];
            if (zone.minX === undefined) continue;
            if (!zoneColor(visible, zone)) continue;
            for (const [corner, x, y] of corners(zone)) {
                const px = canvas.width / 2 + (x - this.centerX) * this.pixelsPerTile;
                const py = canvas.height / 2 - (y - this.centerY) * this.pixelsPerTile;
                if (Math.hypot(screenX - px, screenY - py) <= 9) return { index, corner };
            }
        }
        return undefined;
    }

    private zoneAt(screenX: number, screenY: number): number | undefined {
        if (!this.canEditZones) return undefined;
        const tile = this.worldTileAt(screenX, screenY);
        const visible = this.getZones();
        if (!tile || !visible) return undefined;
        for (let index = visible.zones.length - 1; index >= 0; index--) {
            const zone = visible.zones[index];
            if (zone.minX === undefined) continue;
            if (zoneColor(visible, zone) && tile.x >= zone.minX && tile.x <= zone.maxX && tile.y >= zone.minY && tile.y <= zone.maxY) return index;
        }
        return undefined;
    }

    private setSelectedZone(index: number | undefined): void {
        this.selectedZoneIndex = index;
        const zone = index === undefined ? undefined : this.getZones()?.zones[index];
        if (this.zoneTypeSelect) {
            this.zoneTypeSelect.style.display = this.canEditZones ? "inline-block" : "none";
            if (zone) this.zoneTypeSelect.value = ZONE_TYPE_LABELS.find(([tag]) => zone.tags.includes(tag))?.[0] ?? "pvp";
        }
        if (this.deleteZoneButton) this.deleteZoneButton.style.display = zone ? "inline-block" : "none";
    }

    private zoneCursorAt(screenX: number, screenY: number): string {
        const canvas = this.canvas;
        const visible = this.getZones();
        if (!canvas || !visible) return "grab";
        for (const zone of visible.zones) {
            if (zone.minX === undefined) continue;
            if (!zoneColor(visible, zone)) continue;
            const left = canvas.width / 2 + (zone.minX - this.centerX) * this.pixelsPerTile;
            const right = canvas.width / 2 + (zone.maxX + 1 - this.centerX) * this.pixelsPerTile;
            const top = canvas.height / 2 - (zone.maxY + 1 - this.centerY) * this.pixelsPerTile;
            const bottom = canvas.height / 2 - (zone.minY - this.centerY) * this.pixelsPerTile;
            const edge = 8;
            const nearLeft = Math.abs(screenX - left) <= edge;
            const nearRight = Math.abs(screenX - right) <= edge;
            const nearTop = Math.abs(screenY - top) <= edge;
            const nearBottom = Math.abs(screenY - bottom) <= edge;
            const onVertical = (nearLeft || nearRight) && screenY >= top - edge && screenY <= bottom + edge;
            const onHorizontal = (nearTop || nearBottom) && screenX >= left - edge && screenX <= right + edge;
            if (onVertical && onHorizontal) {
                return (nearLeft && nearTop) || (nearRight && nearBottom) ? "nwse-resize" : "nesw-resize";
            }
            if (onVertical) return "ew-resize";
            if (onHorizontal) return "ns-resize";
        }
        return "grab";
    }

    private draw = (): void => {
        if (this.newZoneButton) this.newZoneButton.style.display = this.canEditZones ? "inline-block" : "none";
        if (this.zoneTypeSelect) this.zoneTypeSelect.style.display = this.canEditZones ? "inline-block" : "none";
        const canvas = this.canvas;
        const context = this.context;
        const area = this.client.worldMapState.currentArea;
        if (!canvas || !context || !area) return;
        const bounds = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(bounds.width));
        const height = Math.max(1, Math.floor(bounds.height));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        context.fillStyle = "#090b0f";
        context.fillRect(0, 0, width, height);
        const minX = Math.max(area.regionLowX, Math.floor((this.centerX - width / this.pixelsPerTile / 2) / 64) - 1);
        const maxX = Math.min(area.regionHighX, Math.floor((this.centerX + width / this.pixelsPerTile / 2) / 64) + 1);
        const minY = Math.max(area.regionLowY, Math.floor((this.centerY - height / this.pixelsPerTile / 2) / 64) - 1);
        const maxY = Math.min(area.regionHighY, Math.floor((this.centerY + height / this.pixelsPerTile / 2) / 64) + 1);
        for (let mapX = minX; mapX <= maxX; mapX++) {
            for (let mapY = minY; mapY <= maxY; mapY++) {
                const tile = this.client.getWorldMapImageTile(mapX, mapY, 0, 1);
                const x = Math.round(width / 2 + (mapX * 64 - this.centerX) * this.pixelsPerTile);
                const y = Math.round(height / 2 - ((mapY + 1) * 64 - this.centerY) * this.pixelsPerTile);
                const cachedCanvas = this.tileCanvases.get(`${mapX}:${mapY}`);
                const pixels = tile?.pixels;
                // The shared world-map cache may release pixel buffers after the
                // normal map renderer uploads them. Keep the editor's canvas
                // snapshot visible while that happens (and while a tile reloads).
                if (!tile || !pixels) {
                    if (cachedCanvas) {
                        context.drawImage(cachedCanvas, x, y, 64 * this.pixelsPerTile, 64 * this.pixelsPerTile);
                        continue;
                    }
                    context.strokeStyle = "rgba(148,163,184,0.13)";
                    context.strokeRect(x, y, 64 * this.pixelsPerTile, 64 * this.pixelsPerTile);
                    continue;
                }
                context.drawImage(this.getTileCanvas(`${mapX}:${mapY}`, { ...tile, pixels }), x, y, 64 * this.pixelsPerTile, 64 * this.pixelsPerTile);
            }
        }
        const visible = this.getZones();
        if (visible) {
            for (let index = 0; index < visible.zones.length; index++) {
                const zone = visible.zones[index];
                if (zone.minX === undefined) continue;
                const color = zoneColor(visible, zone);
                if (!color) continue;
                const x = width / 2 + (zone.minX - this.centerX) * this.pixelsPerTile;
                const y = height / 2 - (zone.maxY + 1 - this.centerY) * this.pixelsPerTile;
                const w = (zone.maxX - zone.minX + 1) * this.pixelsPerTile;
                const h = (zone.maxY - zone.minY + 1) * this.pixelsPerTile;
                context.fillStyle = `${color}33`;
                context.fillRect(x, y, w, h);
                context.strokeStyle = color;
                context.lineWidth = index === this.selectedZoneIndex ? 4 : 2;
                context.strokeRect(x, y, w, h);
                for (const [, cornerX, cornerY] of [["nw", zone.minX, zone.maxY + 1], ["ne", zone.maxX + 1, zone.maxY + 1], ["sw", zone.minX, zone.minY], ["se", zone.maxX + 1, zone.minY]] as const) {
                    context.fillRect(width / 2 + (cornerX - this.centerX) * this.pixelsPerTile - 3, height / 2 - (cornerY - this.centerY) * this.pixelsPerTile - 3, 6, 6);
                }
            }
        }
        if (this.anchorTile) {
            context.fillStyle = "#a855f7";
            context.beginPath();
            context.arc(width / 2 + (this.anchorTile.tileX + 0.5 - this.centerX) * this.pixelsPerTile, height / 2 - (this.anchorTile.tileY + 0.5 - this.centerY) * this.pixelsPerTile, 5, 0, Math.PI * 2);
            context.fill();
        }
        if (this.plotStart && this.plotEnd) {
            const x = width / 2 + (Math.min(this.plotStart.x, this.plotEnd.x) - this.centerX) * this.pixelsPerTile;
            const y = height / 2 - (Math.max(this.plotStart.y, this.plotEnd.y) + 1 - this.centerY) * this.pixelsPerTile;
            context.strokeStyle = ZONE_COLORS[this.zoneTypeSelect?.value ?? ""] ?? ZONE_COLORS["multi-combat"];
            context.setLineDash([5, 4]);
            context.strokeRect(x, y, (Math.abs(this.plotEnd.x - this.plotStart.x) + 1) * this.pixelsPerTile, (Math.abs(this.plotEnd.y - this.plotStart.y) + 1) * this.pixelsPerTile);
            context.setLineDash([]);
        }
        this.animationFrame = requestAnimationFrame(this.draw);
    };

    private getTileCanvas(key: string, tile: { pixels: Uint8Array; width: number; height: number }): HTMLCanvasElement {
        const cached = this.tileCanvases.get(key);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = tile.width;
        canvas.height = tile.height;
        canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(tile.pixels), tile.width, tile.height), 0, 0);
        this.tileCanvases.set(key, canvas);
        while (this.tileCanvases.size > MAX_TILE_CANVASES) this.tileCanvases.delete(this.tileCanvases.keys().next().value!);
        return canvas;
    }
}
