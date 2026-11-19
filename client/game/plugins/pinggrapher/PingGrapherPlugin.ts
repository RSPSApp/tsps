import { GameState } from "@runelite/api/GameState";
import type { GameStateChanged } from "@runelite/api/events";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { ClientImpl } from "../../../runelite/impl/ClientImpl";
import { fetchContent, getContentApiBase } from "../../../network/serverConnection/contentApi";
import { getLastUrl } from "../../../network/serverConnection/outgoing/connectionInfo";
import { drawTextGL } from "../../../widgets/components/TextRenderer";
import { drawLine } from "../../../widgets/gl/widgetsGl/drawLines";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../ClientPluginManager";
import { PingGrapherConfig } from "./PingGrapherConfig";

/** Adapted from yuh25/Ping-Grapher (BSD-2-Clause, see LICENSE). */
export class PingGrapherPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Ping Grapher", description: "Graph application latency to the current world and game tick timing",
        tags: ["ping", "graph", "latency", "tick", "network", "lag"],
        configKey: "pinggraphplugin", enabledByDefault: false,
    };
    static config = PingGrapherConfig;
    readonly config = inject(PingGrapherConfig);
    readonly pings: number[] = [];
    readonly ticks: number[] = [];
    noResponseCount = 0;
    private lastTick?: number;
    private timer?: ReturnType<typeof setTimeout>;
    private generation = 0;
    private loggedIn = false;
    private session = 0;
    readonly widgetOverlay: WidgetOverlay = {
        movable: { name: "PingGraphOverlay", position: OverlayPosition.TOP_LEFT },
        signature: () => this.loggedIn ? JSON.stringify([this.pings, this.ticks, this.noResponseCount,
            Object.keys(PingGrapherConfig.items).map(key => this.config[key]())]) : "",
        draw: context => this.draw(context),
    };

    private readonly gameState: () => GameState;

    constructor(private readonly now = () => performance.now(),
        private readonly probe = async () => {
            const base = getContentApiBase();
            if (!base) return fetchContent("/api/world-info");
            const response = await fetch(`${base}/api/world-info`, {
                cache: "no-store", signal: AbortSignal.timeout(3000),
            });
            if (!response.ok) throw new Error(`Ping failed: ${response.status}`);
            return response.json();
        },
        gameState?: () => GameState,
        private readonly world = getLastUrl) {
        super();
        const client = gameState ? undefined : new ClientImpl(inject<OsrsClient>(CLIENT_TOKEN));
        this.gameState = gameState ?? (() => client!.getGameState());
    }

    protected async startUp(): Promise<void> {
        this.reset();
        this.loggedIn = this.gameState() === GameState.LOGGED_IN;
        const generation = ++this.generation;
        const poll = async () => {
            await this.sample(generation);
            if (generation === this.generation) this.timer = setTimeout(poll, 1000);
        };
        this.timer = setTimeout(poll, 1000);
    }

    protected async shutDown(): Promise<void> {
        ++this.generation;
        clearTimeout(this.timer);
        this.loggedIn = false;
        this.reset();
    }

    private reset(): void {
        this.pings.length = this.ticks.length = 0;
        this.lastTick = undefined;
        this.noResponseCount = 0;
    }

    onGameStateChanged(event: GameStateChanged): void {
        this.loggedIn = event.getGameState() === GameState.LOGGED_IN;
        if (!this.loggedIn) { ++this.session; this.reset(); }
    }

    onGameTick(): void {
        if (!this.loggedIn) return;
        const now = this.now();
        if (this.lastTick !== undefined) this.append(this.ticks, Math.round(now - this.lastTick));
        this.lastTick = now;
    }

    private append(list: number[], value: number): void {
        list.push(value);
        if (list.length > 100) list.shift();
    }

    async sample(generation = this.generation): Promise<void> {
        if (!this.loggedIn) return;
        const world = this.world();
        const session = this.session;
        const started = this.now();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([this.probe(), new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error("Ping timed out")), 3000);
            })]);
            if (generation !== this.generation || session !== this.session || !this.loggedIn || this.world() !== world) return;
            this.append(this.pings, Math.max(0, Math.round(this.now() - started)));
            this.noResponseCount = 0;
        } catch {
            if (generation !== this.generation || session !== this.session || !this.loggedIn || this.world() !== world) return;
            ++this.noResponseCount;
            if (this.config.enablePingSpikes()) this.append(this.pings, -1);
        } finally { clearTimeout(timeout); }
    }

    private draw(context: WidgetOverlayDrawContext) {
        if (!this.loggedIn || !this.isStarted()) return [];
        const c = this.config;
        const values = c.graphTicks() ? this.ticks : this.pings;
        const valid = values.filter(value => value >= 0);
        const min = valid.length ? Math.min(...valid) : 0;
        const max = valid.length ? Math.max(...valid) : 0;
        const current = valid.at(-1) ?? 0;
        const warning = (c.warnMaxToggle() ? max : current) > (c.graphTicks() ? c.warnTickVal() : c.warnPingVal());
        if (c.warningHideOverlay() && !warning) return [];
        const width = Math.max(120, Math.min(600, c.width()));
        const height = c.hideGraph() ? 22 : Math.max(50, Math.min(300, c.height()));
        const at = context.place(this.widgetOverlay, width, height);
        if (!at) return [];
        const { x, y, scaleX: sx, scaleY: sy } = at;
        context.renderer.drawRect(x, y, width * sx, height * sy, warning ? [0.35, 0.04, 0.04, 0.7] : [0.067, 0.067, 0.067, 0.6]);
        if (!c.toggleLineOnly()) {
            const value = !c.graphTicks() && this.noResponseCount >= c.noResponseLimit() ? c.noResponseMsg() : valid.length ? `${current}ms` : "-";
            drawTextGL(context.renderer, context.fontLoader,
                `${c.graphTicks() ? "Tick" : "Latency"}: ${value}  ${min}-${max}ms`,
                x + 4 * sx, y + 2 * sy, (width - 8) * sx, 18 * sy, 494,
                warning ? 0xff1111 : 0xffff18, 0, 0, true, 1, undefined, sx, sy);
        }
        if (!c.hideGraph()) {
            const top = c.toggleLineOnly() ? 4 : 24;
            const floor = c.toggleRange() ? min : 0;
            const range = Math.max(1, max - floor);
            const py = (v: number) => y + (height - 4 - ((Math.max(floor, v) - floor) / range) * (height - top - 4)) * sy;
            values.forEach((value, i) => {
                if (!i) return;
                const px = (index: number) => x + (4 + (100 - values.length + index) * (width - 8) / 99) * sx;
                drawLine(context.renderer, px(i - 1), py(values[i - 1]), px(i), py(value),
                    value < 0 || values[i - 1] < 0 ? [1, 0.067, 0.067, 1] : [1, 1, 0, 1]);
            });
        }
        return [{ x, y, w: width * sx, h: height * sy }];
    }
}
