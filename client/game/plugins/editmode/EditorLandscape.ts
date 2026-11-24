import { fetchContent } from "../../../network/serverConnection/contentApi";
import { WORLD_COORD_MAX } from "./EditorCoordinates";
import type { MapFootprint } from "./EditorWorldMap";
import type { EditModeRegionPack, EditModeTile } from "./types";

type Landform = { id: string; label: string; about: string };
type Biome = { id: string; label: string; reference: string };
type Size = { id: string; label: string; width: number; height: number };

type LandscapeCatalog = {
    landforms: Landform[];
    biomes: Biome[];
    sizes: Size[];
    maxWidth: number;
    maxHeight: number;
};

export type LandscapeDraft = { query: string; regions: readonly number[]; location: EditModeTile };

const examples = [
    { label: "Basement", landform: "cavern", biome: "alpine", size: "tiny" },
    { label: "Mountain valley", landform: "basin", biome: "forest", size: "large" },
    { label: "Tropical island", landform: "island", biome: "tropical", size: "large" },
    { label: "Swampland", landform: "wetlands", biome: "swamp", size: "region" },
];

type EncodedPack = { regionId: number; data: string };

type LandscapePreview = {
    packs?: EncodedPack[];
    width: number;
    height: number;
    regions: number[];
    occupied: number[];
    sceneryCount: number;
    sourceRegions?: number[];
    biome?: string;
    low: number;
    high: number;
    preview: { columns: number; rows: number; colours: string[]; pixels: string };
};

async function landscapeData<T>(part = ""): Promise<T> {
    const payload = await fetchContent("/api/world/landscapes" + part);
    if (!payload || typeof payload !== "object") throw new Error("Connect to the development world to generate maps.");
    if (payload.error) throw new Error(payload.error);
    return payload as T;
}

export function loadOccupiedMapSquares(): Promise<number[]> {
    return landscapeData("/occupied");
}

export async function loadBiomeScenery(biome: string): Promise<readonly { id: number; name: string }[]> {
    return landscapeData("/scenery?" + new URLSearchParams({ biome }));
}

function drawOverview(canvas: HTMLCanvasElement, plan: LandscapePreview): void {
    const { columns, rows, colours, pixels } = plan.preview;
    canvas.width = columns;
    canvas.height = rows;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = context.createImageData(columns, rows);
    const palette = colours.map((color) => Number.parseInt(color.slice(1), 16));
    const bytes = window.atob(pixels);
    for (let i = 0; i < columns * rows; i++) {
        const index = bytes.charCodeAt(i * 3);
        if (index === 255) continue;
        const color = palette[index];
        const elevation = bytes.charCodeAt(i * 3 + 2);
        const light = bytes.charCodeAt(i * 3 + 1) / 153 + elevation / 600 + 0.18;
        image.data[i * 4] = (color >> 16) * light;
        image.data[i * 4 + 1] = ((color >> 8) & 255) * light;
        image.data[i * 4 + 2] = (color & 255) * light;
        image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
}

export async function attachLandscapeEditor(
    panel: HTMLElement,
    origin: EditModeTile,
    inputStyle: Partial<CSSStyleDeclaration>,
    button: (text: string, title: string, run: () => void) => HTMLButtonElement,
    options: {
        draft?: LandscapeDraft;
        footprint?: MapFootprint;
        expand?: boolean;
        source?: string;
        changeFootprint?: () => void;
        pendingSquares: () => readonly number[];
        hasDraftEdits: (regions: readonly number[]) => boolean;
        autoFindSite?: boolean;
        showScene?: (packs: readonly EditModeRegionPack[], location: EditModeTile, span: number) => void;
        focusScene?: (location: EditModeTile, span: number) => void;
        cancelScene?: () => void;
        stage: (packs: readonly EditModeRegionPack[], origin: EditModeTile, draft: LandscapeDraft, replace: boolean) => void;
    },
): Promise<void> {
    const status = document.createElement("div");
    status.role = "status";
    status.textContent = "Loading landscape presets…";
    panel.append(status);
    try {
        const catalog = await landscapeData<LandscapeCatalog>();
        if (!panel.isConnected) return;
        const layout = document.createElement("div");
        Object.assign(layout.style, { display: "grid", gap: "8px" });
        const select = (values: { id: string; label: string }[], value: string) => {
            const field = document.createElement("select");
            for (const option of values) field.add(new window.Option(option.label, option.id));
            field.value = value;
            return field;
        };
        const number = (value: number, min: number, max: number) => {
            const field = document.createElement("input");
            field.type = "number";
            field.value = String(value);
            field.min = String(min);
            field.max = String(max);
            field.required = true;
            return field;
        };
        const row = (...children: HTMLElement[]) => {
            const element = document.createElement("div");
            Object.assign(element.style, { display: "grid", gridTemplateColumns: "1fr ".repeat(children.length).trim(), gap: "7px" });
            element.append(...children);
            return element;
        };
        const field = (label: string, input: HTMLInputElement | HTMLSelectElement) => {
            Object.assign(input.style, inputStyle, { minWidth: "0" });
            const element = document.createElement("label");
            Object.assign(element.style, { display: "grid", gap: "3px", minWidth: "0" });
            element.append(label, input);
            return element;
        };
        let draft = options.draft;
        const previous = new URLSearchParams(draft?.query);
        const initial = (key: string, fallback: number) => Number(previous.get(key) ?? fallback);
        const footprint = options.footprint;
        const landform = select(catalog.landforms, previous.get("landform") ?? (origin.tileY >= 6400 && footprint ? "cavern" : "hills"));
        const biome = select(options.expand ? [{ id: "auto", label: "Match nearby terrain" }, ...catalog.biomes] : catalog.biomes,
            previous.get("biome") ?? (options.expand ? "auto" : "forest"));
        const initialSize = catalog.sizes.find(({ width, height }) => width === initial("width", 64) && height === initial("height", 64));
        const selectSize = select([
            ...catalog.sizes.map((size) => ({ ...size, label: `${size.label} (${size.width} × ${size.height})` })),
            { id: "custom", label: "Custom dimensions" },
        ], initialSize?.id ?? "custom");
        const x = number(initial("x", origin.tileX), 0, WORLD_COORD_MAX);
        const y = number(initial("y", origin.tileY), 0, WORLD_COORD_MAX);
        const width = number(initial("width", footprint?.width ?? 64), 6, catalog.maxWidth);
        const height = number(initial("height", footprint?.height ?? 64), 6, catalog.maxHeight);
        const seed = number(initial("seed", 1), 0, 2147483647);
        const relief = number(initial("relief", 100), 0, 200);
        const foliage = number(initial("foliage", 100), 0, 200);
        const lakes = number(initial("lakes", 0), 0, 12);
        const edgeBlend = number(initial("edgeBlend", 28), 4, 48);
        const slider = (label: string, input: HTMLInputElement, suffix = "") => {
            input.type = "range";
            const wrapper = field(label, input);
            const value = document.createElement("output");
            const update = () => { value.textContent = `${input.value}${suffix}`; };
            input.addEventListener("input", update);
            update();
            wrapper.append(value);
            Object.assign(wrapper.style, { gridTemplateColumns: "1fr auto" });
            input.style.gridRow = "2";
            input.style.gridColumn = "1 / -1";
            value.style.color = "#cbd5e1";
            return wrapper;
        };
        const scenery = document.createElement("input");
        scenery.type = "checkbox";
        scenery.checked = previous.get("scenery") !== "false";
        const sceneryLabel = document.createElement("label");
        sceneryLabel.append(scenery, " Add native scenery");

        const map = document.createElement("canvas");
        map.setAttribute("aria-label", "Landscape elevation preview, north up");
        map.setAttribute("role", "img");
        Object.assign(map.style, { width: "100%", maxHeight: "210px", objectFit: "contain", imageRendering: "pixelated",
            border: "1px solid rgba(255,255,255,0.16)", borderRadius: "4px", background: "#090b0f" });
        map.hidden = true;
        const description = document.createElement("div");
        description.style.color = "#cbd5e1";
        const custom = row(field("Width in tiles", width), field("Depth in tiles", height));
        const location = document.createElement("fieldset");
        Object.assign(location.style, { margin: "0", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "4px" });
        const legend = document.createElement("legend");
        legend.textContent = "South-west tile";
        const findSpace = button("Find empty space", "Find room for this landscape automatically", () => {
            if (!width.reportValidity() || !height.reportValidity()) return;
            findSpace.disabled = true;
            const current = revision;
            const query = new URLSearchParams({ landform: landform.value, width: width.value, height: height.value,
                skip: options.pendingSquares().join(",") });
            void landscapeData<{ x: number; y: number }>("/site?" + query).then((site) => {
                if (!panel.isConnected || current !== revision) return;
                x.value = String(site.x);
                y.value = String(site.y);
                schedule();
            }).catch((error) => {
                if (current === revision) status.textContent = error instanceof Error ? error.message : String(error);
            }).finally(() => { findSpace.disabled = false; });
        });
        location.append(legend, row(field("X", x), field("Y", y)), findSpace);
        const advanced = document.createElement("details");
        const advancedLabel = document.createElement("summary");
        advancedLabel.textContent = "Seed";
        const randomize = button("Reroll layout", "Preview another landscape at this location", () => {
            const next = Math.floor(Math.random() * 2147483647);
            seed.value = String(next === seed.valueAsNumber ? next + 1 : next);
            schedule();
        });
        advanced.append(advancedLabel, field("Seed", seed));
        const sliders = [slider("Height variation", relief, "%"), slider("Foliage density", foliage, "%"), slider("Extra lakes", lakes)];
        if (options.expand) sliders.push(slider("Edge blend", edgeBlend, " tiles"));

        const unpack = (encoded: readonly EncodedPack[]) => {
            const packs = encoded.map(({ regionId, data }) =>
                ({ regionId, data: Uint8Array.from(window.atob(data), (char) => char.charCodeAt(0)) }));
            if (footprint && (packs.length !== footprint.regions.length ||
                new Set(packs.map(({ regionId }) => regionId)).size !== footprint.regions.length ||
                packs.some(({ regionId }) => !footprint.regions.includes(regionId)))) {
                throw new Error("The generated map squares do not match the selection.");
            }
            return packs;
        };
        const locationFor = (query: URLSearchParams): EditModeTile => {
            let tileX = Number(query.get("x")) + Math.floor(Number(query.get("width")) / 2);
            let tileY = Number(query.get("y")) + Math.floor(Number(query.get("height")) / 2);
            if (footprint && !footprint.regions.includes(((tileX >> 6) << 8) | (tileY >> 6))) {
                const distance = (square: number) =>
                    Math.hypot((square >> 8) * 64 + 32 - tileX, (square & 255) * 64 + 32 - tileY);
                const center = footprint.regions.reduce((best, id) => distance(id) < distance(best) ? id : best);
                tileX = (center >> 8) * 64 + 32;
                tileY = (center & 255) * 64 + 32;
            }
            return { tileX, tileY, plane: 0 };
        };
        let revision = 0;
        let timer: number | undefined;
        let approved: { query: URLSearchParams; replace: boolean; packs?: EditModeRegionPack[] } | undefined;
        let sceneLocation: EditModeTile | undefined;
        let buildingPreview = false;
        let creating = false;
        const acceptLabel = options.showScene ? "Keep this terrain" : "Generate in editor";
        const acceptHint = options.showScene ? "Keep this terrain as an unsaved map draft" : "Open this landscape as an unsaved draft";
        const create = button(acceptLabel, acceptHint, () => {
            if (!approved || creating) return;
            const { query, replace, packs: preview } = approved;
            const current = revision;
            creating = true;
            create.disabled = true;
            status.textContent = "Keeping terrain…";
            const result = preview ? Promise.resolve(preview) : landscapeData<EncodedPack[]>("/packs?" + query).then(unpack);
            void result.then((packs) => {
                if (!panel.isConnected || current !== revision) return;
                const location = locationFor(query);
                const generated = { query: query.toString(), regions: packs.map(({ regionId }) => regionId), location };
                options.stage(packs, location, generated, replace);
                draft = generated;
                status.textContent = "Draft kept. Open Review changes when you’re ready to save.";
                approved = undefined;
            }).catch((error) => {
                if (current === revision) status.textContent = error instanceof Error ? error.message : String(error);
            }).finally(() => {
                creating = false;
                if (current !== revision) void refresh(revision);
                else create.disabled = !approved;
            });
        });
        const focus = button("Focus terrain", "Center the camera on the preview", () => {
            if (sceneLocation) options.focusScene?.(sceneLocation, Math.max(width.valueAsNumber, height.valueAsNumber));
        });
        focus.disabled = true;
        const refresh = async (current: number) => {
            if (!panel.isConnected || creating || buildingPreview) return;
            if (![x, y, width, height, seed, relief, foliage, lakes].every((input) => input.checkValidity())) {
                status.textContent = "Enter valid tile coordinates and dimensions.";
                return;
            }
            const query = new URLSearchParams({
                x: x.value, y: y.value, width: width.value, height: height.value, seed: seed.value,
                relief: relief.value, foliage: foliage.value, lakes: lakes.value, scenery: String(scenery.checked), biome: biome.value, landform: landform.value,
            });
            if (footprint) query.set("squares", footprint.regions.join(","));
            if (options.expand) {
                query.set("extend", "true");
                query.set("edgeBlend", edgeBlend.value);
            }
            if (options.source) query.set("source", options.source);
            buildingPreview = true;
            try {
                const result = await landscapeData<LandscapePreview>((options.showScene ? "/scene?" : "/preview?") + query);
                if (!panel.isConnected || current !== revision) return;
                drawOverview(map, result);
                map.hidden = false;
                const reference = result.sourceRegions?.length ? ` · Blending with ${result.sourceRegions.join(", ")}` : "";
                const info = `${result.width} × ${result.height} tiles · ${result.regions.length} map squares · ${result.sceneryCount.toLocaleString()} scenery objects${reference}`;
                const pending = new Set(options.pendingSquares());
                const replace = draft?.regions.length === result.regions.length &&
                    result.regions.every((id) => pending.has(id) && draft?.regions.includes(id));
                const used = result.occupied.length > 0 || (!replace && result.regions.some((id) => pending.has(id)));
                const edited = replace && options.hasDraftEdits(result.regions);
                const currentDraft = replace && draft?.query === query.toString();
                create.textContent = replace ? "Replace draft terrain" : acceptLabel;
                status.textContent = used ? `${info}. Site in use. ${footprint ? "Change map squares." : "Choose Find empty space."}`
                    : edited ? "This draft has edits. Undo them or find another site to try this layout."
                    : currentDraft ? "Landscape draft is open. Reroll or change a setting to update it."
                    : info;
                if (!used && !edited && !currentDraft) {
                    const packs = options.showScene ? unpack(result.packs ?? []) : undefined;
                    if (packs && options.showScene) {
                        sceneLocation = locationFor(query);
                        options.showScene(packs, sceneLocation, Math.max(result.width, result.height));
                        focus.disabled = false;
                        status.textContent = "Previewing in world. Use WASD to look around.";
                    }
                    approved = { query, replace, packs };
                }
                create.disabled = !approved;
            } catch (error) {
                if (current !== revision) return;
                map.hidden = true;
                status.textContent = error instanceof Error ? error.message : String(error);
            } finally {
                buildingPreview = false;
                if (current !== revision && panel.isConnected) {
                    window.clearTimeout(timer);
                    timer = window.setTimeout(() => void refresh(revision), 60);
                }
            }
        };
        const schedule = () => {
            window.clearTimeout(timer);
            approved = undefined;
            create.disabled = true;
            const selected = catalog.sizes.find((size) => size.id === selectSize.value);
            custom.style.display = selected ? "none" : "grid";
            if (!footprint && selected) {
                width.value = String(selected.width);
                height.value = String(selected.height);
            }
            const shape = catalog.landforms.find((item) => item.id === landform.value);
            const material = catalog.biomes.find((item) => item.id === biome.value);
            for (const control of [relief, foliage, lakes]) control.disabled = landform.value === "cavern";
            description.textContent = `${shape?.about ?? ""} ${options.expand && biome.value === "auto"
                ? "Match the ground and scenery along the shared edges."
                : `Ground and scenery based on ${material?.reference ?? "the OSRS cache"}.`}`;
            status.textContent = "Updating terrain preview…";
            const current = ++revision;
            timer = window.setTimeout(() => void refresh(current), 160);
        };
        const quickStart = document.createElement("div");
        Object.assign(quickStart.style, { display: "flex", gap: "5px", flexWrap: "wrap" });
        for (const example of examples) quickStart.append(button(example.label, example.label, () => {
            landform.value = example.landform;
            biome.value = example.biome;
            selectSize.value = example.size;
            schedule();
        }));
        for (const control of [x, y, width, height, seed, relief, foliage, lakes, edgeBlend, landform, biome, selectSize, scenery]) {
            control.addEventListener("change", schedule);
        }
        if (footprint) {
            const squares = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = `${footprint.regions.length} selected map squares · ${footprint.width / 64} × ${footprint.height / 64} footprint`;
            const ids = document.createElement("div");
            ids.textContent = footprint.regions.join(", ");
            ids.style.overflowWrap = "anywhere";
            squares.append(summary, ids);
            layout.append(squares, button("Change map squares", "Return to the world map", () => options.changeFootprint?.()));
        }
        layout.append(quickStart, row(field("Landform", landform), field("Biome", biome)));
        if (!footprint) layout.append(field("Size", selectSize), custom, location);
        if (options.showScene) {
            const overview = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = "Map overview";
            overview.append(summary, map);
            const actions = document.createElement("div");
            Object.assign(actions.style, { display: "flex", gap: "6px", flexWrap: "wrap" });
            actions.append(randomize, focus);
            const footer = document.createElement("div");
            Object.assign(footer.style, { display: "grid", gap: "7px", position: "sticky", bottom: "0",
                background: "#171a1f", padding: "8px 0 2px", borderTop: "1px solid #ffffff24" });
            create.style.background = "#274f88";
            const choices = document.createElement("div");
            Object.assign(choices.style, { display: "flex", gap: "7px", flexWrap: "wrap" });
            const cancel = button("Cancel", "Discard this terrain preview", () => options.cancelScene?.());
            choices.append(create, cancel);
            footer.append(status, choices);
            layout.append(description, actions, ...sliders, advanced, overview, footer);
        } else layout.append(description, map, randomize, ...sliders, advanced, sceneryLabel, status, create);
        panel.append(layout);
        schedule();
        if (options.autoFindSite) findSpace.click();
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
    }
}
