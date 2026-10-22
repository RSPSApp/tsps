import { GameStateChanged, PluginMessage } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { Plugin, type PluginDescriptor } from "@runelite/client/plugins/Plugin";
import { CLIENT_TOKEN, inject } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import type { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { isSocketOpen, send } from "../../../network/serverConnection/connection/send";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetActionEvent } from "../../widgets/widgetActionPayload";
import { createBugReportNavigationButton } from "./BugReportPanel";
import { BUG_REPORT_CHANNEL, BugReportUpload, encodeReport } from "./BugReportUpload";
import { ClientLogBuffer, captureConsole } from "./ClientLogBuffer";
import { collectClientDiagnostics } from "./clientDiagnostics";
import { composeGameFrame, encodeScreenshot } from "./gameScreenshot";

// Cache chatbox: the Report button (162:31), whose op 4 is "Report game bug".
const REPORT_BUTTON = (162 << 16) | 31;
const REPORT_GAME_BUG_OP = 4;
// The welcome screen: the root interface from login until the player clicks to play.
const WELCOME_SCREEN = 378;
const FRAME_TIMEOUT_MS = 2000;

/** crypto.randomUUID needs a secure context; a LAN address over plain http isn't one. */
function reportId(): string {
    return typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export type BugReportState = {
    description: string;
    includeScreenshot: boolean;
    includeDiagnostics: boolean;
    /** The game when the form opened, as a JPEG data URL. */
    screenshot?: string;
    capturing: boolean;
    phase: "editing" | "sending" | "sent" | "failed";
    /** Share of the chunks sent, 0 to 1, while sending. */
    progress: number;
    error?: string;
    issueUrl?: string;
    issueNumber?: number;
    /** Whether the world takes reports: it answers the panel's `status` request. */
    world: "unknown" | "available" | "unavailable";
    /** Where the world files reports ("github.com/owner/repo"), from its status answer. */
    destination?: string;
};

const FRESH_FORM = {
    description: "",
    includeScreenshot: true,
    includeDiagnostics: true,
    screenshot: undefined,
    capturing: false,
    phase: "editing",
    progress: 0,
    error: undefined,
    issueUrl: undefined,
    issueNumber: undefined,
} as const;

/**
 * Report a Bug (#581): a sidebar button, `::bug [text]` and the chatbox Report button's
 * "Report game bug" open one form. A report carries the description, a screenshot and the
 * diagnostics (recent console, position, inventory, equipment, varps) unless the player turns
 * them off; the server files it on GitHub.
 */
export class BugReportPlugin extends Plugin {
    static descriptor: PluginDescriptor = {
        name: "Report a Bug",
        description: "The sidebar's bug report form, also opened with ::bug.",
        tags: ["bug", "report", "feedback"],
        hidden: true,
        configKey: "bugreportplugin",
    };

    private readonly client = inject<OsrsClient>(CLIENT_TOKEN);
    private readonly clientToolbar = inject(ClientToolbar);
    private readonly listeners = new Set<() => void>();
    private readonly logs = new ClientLogBuffer();
    private readonly upload = new BugReportUpload((data) =>
        send({ type: "plugin_message", payload: { channel: BUG_REPORT_CHANNEL, data } }));
    private restoreConsole?: () => void;
    private navButton?: NavigationButton;
    private frameWaiter?: (frame: HTMLCanvasElement | undefined) => void;
    /** Counts screenshot requests, so an older capture that finishes late can't replace a newer one. */
    private captures = 0;
    /** The screenshot is one the player asked for with Retake screenshot, not one the form took. */
    private screenshotAsked = false;
    /** The welcome screen ("Click here to play") was up at the last game tick. */
    private onWelcomeScreen = false;
    private statusRequested = false;
    private panelsShown = 0;
    private state: BugReportState = { ...FRESH_FORM, world: "unknown" };

    protected async startUp(): Promise<void> {
        this.restoreConsole = captureConsole(this.logs);
        this.navButton = createBugReportNavigationButton(this);
        this.clientToolbar.addNavigation(this.navButton);
    }

    protected async shutDown(): Promise<void> {
        if (this.navButton) this.clientToolbar.removeNavigation(this.navButton);
        this.navButton = undefined;
        this.restoreConsole?.();
        this.restoreConsole = undefined;
        this.upload.cancel("The bug report form was closed.");
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): BugReportState {
        return this.state;
    }

    /** Opens the form; `description` fills an empty one (`::bug the door won't open`). */
    open(description = ""): void {
        if (this.state.phase === "sent") this.update({ ...FRESH_FORM });
        const fresh = !this.state.description.trim();
        if (description && fresh) this.update({ description });
        if (this.navButton) this.clientToolbar.openPanel(this.navButton);
        this.panelOpened(fresh);
    }

    /** The panel is showing; it calls the returned function when it closes. */
    panelShown(): () => void {
        this.panelsShown++;
        this.panelOpened();
        return () => {
            this.panelsShown--;
        };
    }

    isLoggedIn(): boolean {
        return this.client.isLoggedIn();
    }

    /**
     * Take the screenshot and ask the world whether it takes reports, once logged in. A form
     * with nothing written yet gets a new screenshot; a draft keeps the one it has.
     */
    panelOpened(fresh = !this.state.description.trim()): void {
        if (this.state.phase === "sent") this.update({ ...FRESH_FORM });
        if (!this.state.capturing && (fresh || !this.state.screenshot)) void this.takeScreenshot();
        if (this.state.world === "unknown" && !this.statusRequested && this.client.isLoggedIn() && isSocketOpen()) {
            this.statusRequested = true;
            send({ type: "plugin_message", payload: { channel: BUG_REPORT_CHANNEL, data: { type: "status" } } });
        }
    }

    setDescription(description: string): void {
        this.update({ description });
    }

    setIncludeScreenshot(includeScreenshot: boolean): void {
        this.update({ includeScreenshot });
    }

    setIncludeDiagnostics(includeDiagnostics: boolean): void {
        this.update({ includeDiagnostics });
    }

    /** "Report another bug": a fresh form with a new screenshot. */
    reset(): void {
        this.update({ ...FRESH_FORM });
        void this.takeScreenshot();
    }

    /** Retake screenshot: the player's own picture, which entering the world doesn't replace. */
    retakeScreenshot(): Promise<void> {
        return this.takeScreenshot(true);
    }

    private async takeScreenshot(asked = false): Promise<void> {
        if (!this.client.isLoggedIn()) return;
        const capture = ++this.captures;
        this.screenshotAsked = asked;
        this.update({ capturing: true });
        let screenshot: string | undefined;
        try {
            const frame = await this.nextFrame();
            screenshot = frame ? await encodeScreenshot(frame) : undefined;
        } catch (error) {
            console.warn("[bug-report] screenshot failed", error);
        }
        if (capture !== this.captures) return;
        this.update({ capturing: false, screenshot: screenshot ?? this.state.screenshot });
    }

    /** Why a described report can't be sent here, or undefined when it can. */
    blockedReason(): string | undefined {
        if (!this.client.isLoggedIn()) return "Log in to send a report.";
        if (this.state.world === "unavailable") return "This world doesn't take bug reports.";
        return undefined;
    }

    async submit(): Promise<void> {
        if (this.state.phase === "sending" || this.blockedReason() || !this.state.description.trim()) return;
        const { description, includeScreenshot, includeDiagnostics, screenshot } = this.state;
        this.update({ phase: "sending", progress: 0, error: undefined });
        try {
            const report = {
                description: description.trim(),
                screenshot: includeScreenshot ? screenshot : undefined,
                diagnostics: includeDiagnostics ? collectClientDiagnostics(this.client, this.logs) : undefined,
            };
            const sent = await this.upload.upload(reportId(), encodeReport(report),
                (progress) => this.update({ progress }));
            this.update({ phase: "sent", issueUrl: sent.issueUrl, issueNumber: sent.issueNumber });
        } catch (error) {
            this.update({ phase: "failed", error: error instanceof Error ? error.message : String(error) });
        }
    }

    handleClientCommand(command: string): boolean {
        const [name, ...words] = command.trim().split(/\s+/);
        if (name.toLowerCase() !== "bug") return false;
        this.open(words.join(" "));
        return true;
    }

    handleWidgetAction(event: WidgetActionEvent): boolean {
        if (event.widget?.uid !== REPORT_BUTTON) return false;
        const option = String(event.option ?? "").replace(/<[^>]*>/g, "").trim().toLowerCase();
        if (event.opIndex !== REPORT_GAME_BUG_OP && option !== "report game bug") return false;
        this.open();
        return true;
    }

    afterFrame(scene: HTMLCanvasElement): void {
        const waiter = this.frameWaiter;
        if (!waiter) return;
        this.frameWaiter = undefined;
        // Now, in the task that drew it: WebGL clears the canvas once the frame is presented.
        let frame: HTMLCanvasElement | undefined;
        try {
            frame = composeGameFrame(scene);
        } catch (error) {
            console.warn("[bug-report] screenshot failed", error);
        }
        waiter(frame);
    }

    onPluginMessage(event: PluginMessage): void {
        if (event.channel !== BUG_REPORT_CHANNEL) return;
        const data = event.data as { type?: unknown; destination?: unknown };
        if (data.type === "status") {
            this.update({ world: "available", destination: typeof data.destination === "string" ? data.destination : undefined });
        } else if (data.type === "unavailable") {
            this.update({ world: "unavailable", destination: undefined });
            this.upload.cancel("This world doesn't take bug reports.");
        } else {
            this.upload.handle(event.data as { type: string });
        }
    }

    onGameStateChanged(event: GameStateChanged): void {
        const state = event.getGameState();
        if ([GameState.LOGIN_SCREEN, GameState.CONNECTION_LOST, GameState.HOPPING].includes(state)) {
            this.upload.cancel("You were logged out before the report was sent.");
            this.statusRequested = false;
            this.onWelcomeScreen = false;
            this.update({ world: "unknown", destination: undefined });
        } else if (state === GameState.LOGGED_IN && this.panelsShown > 0) {
            // The form was open on the login screen: now there's a game to capture and a world to ask.
            this.panelOpened();
        } else {
            this.update({});
        }
    }

    /**
     * A form open through login took the welcome screen ("Click here to play"). When the player
     * enters the world, it takes the world instead, unless they wrote something or retook it.
     */
    onGameTick(): void {
        const welcome = this.client.widgetManager?.rootInterface === WELCOME_SCREEN;
        const enteredWorld = this.onWelcomeScreen && !welcome;
        this.onWelcomeScreen = welcome;
        if (enteredWorld && this.panelsShown > 0 && !this.screenshotAsked && !this.state.description.trim()) {
            void this.takeScreenshot();
        }
    }

    /** The next frame drawn, composed for a screenshot, or undefined if none is drawn soon. */
    private nextFrame(): Promise<HTMLCanvasElement | undefined> {
        this.frameWaiter?.(undefined);
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (this.frameWaiter !== waiter) return;
                this.frameWaiter = undefined;
                resolve(undefined);
            }, FRAME_TIMEOUT_MS);
            const waiter = (frame: HTMLCanvasElement | undefined): void => {
                clearTimeout(timer);
                resolve(frame);
            };
            this.frameWaiter = waiter;
        });
    }

    private update(patch: Partial<BugReportState>): void {
        this.state = { ...this.state, ...patch };
        for (const listener of [...this.listeners]) listener();
    }
}
