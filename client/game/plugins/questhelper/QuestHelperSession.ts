import { parseHelperCatalog, parseHelperResponse, type HelperCatalog, type HelperResponse, type OrderedClientEvent, type ReadonlyClientSnapshot } from "./QuestHelperProtocol";
export type HelperSessionState = {
    selected: string;
    variant?: string;
    catalog: HelperCatalog | null;
    result: HelperResponse | null;
    status: string;
    version: number;
};
export class QuestHelperSession {
    private account: string | null = null;
    private session = "";
    private sequence = 0;
    private lastTick = -1;
    private inFlight = false;
    private autoSelectTutorial = true;
    private state: HelperSessionState = { selected: "", catalog: null, result: null, status: "Log in to use Quest Helper.", version: 0 };
    private readonly listeners = new Set<() => void>();
    constructor(private readonly send: (data: unknown) => void, private readonly sessionId = () => globalThis.crypto.randomUUID()) { }
    getState = (): HelperSessionState => this.state;
    hasPendingEvaluation(): boolean { return this.inFlight; }
    isCurrentMessage(data: {
        protocol?: unknown;
        session?: unknown;
    }): boolean { return !!this.account && !!this.session && data.protocol === 1 && data.session === this.session; }
    acceptError(data: {
        protocol?: unknown;
        session?: unknown;
        sequence?: unknown;
        message?: unknown;
    }): boolean {
        if (!this.isCurrentMessage(data) || (data.sequence !== undefined && data.sequence !== this.sequence) || typeof data.message !== "string")
            return false;
        this.fail(data.message.slice(0, 16384));
        return true;
    }
    restart(message: string): void { this.endSession(); this.lastTick = -1; this.patch({ result: null, status: message }); }
    subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    select(questKey: string, variant?: string): void {
        this.autoSelectTutorial = false;
        if (questKey === this.state.selected && variant === this.state.variant)
            return;
        this.endSession();
        this.patch({ selected: questKey, variant, result: null, status: questKey ? "Waiting for a fresh game snapshot…" : "Choose a quest." });
        this.lastTick = -1;
    }
    update(account: string | null, snapshot?: ReadonlyClientSnapshot, events: readonly OrderedClientEvent[] = []): void {
        if (account !== this.account) {
            this.endSession();
            this.account = account;
            this.autoSelectTutorial = true;
            this.lastTick = -1;
            this.patch({ result: null, catalog: null, status: account ? "Loading quest catalog…" : "Log in to use Quest Helper." });
        }
        if (!account)
            return;
        if (!this.session) {
            this.session = this.sessionId();
            this.sequence = 0;
            this.send({ type: "catalog", protocol: 1, session: this.session });
            if (this.state.selected)
                this.send({ type: "select", protocol: 1, session: this.session, questKey: this.state.selected, helperVariant: this.state.variant });
        }
        if (!snapshot)
            return;
        if (!this.state.selected || snapshot.tick === this.lastTick || this.inFlight)
            return;
        this.lastTick = snapshot.tick;
        const request = { type: "evaluate", protocol: 1, session: this.session, sequence: ++this.sequence, questKey: this.state.selected, helperVariant: this.state.variant, snapshot, events };
        this.inFlight = true;
        this.send(request);
    }
    accept(data: unknown): boolean {
        const result = parseHelperResponse(data);
        if (!result || !this.account || result.session !== this.session || result.sequence !== this.sequence || result.questKey !== this.state.selected)
            return false;
        this.inFlight = false;
        const catalog = result.status === "complete" && this.state.catalog ? {
            ...this.state.catalog,
            quests: this.state.catalog.quests.map(quest => quest.questKey === result.questKey ? { ...quest, status: "FINISHED" as const } : quest),
        } : this.state.catalog;
        this.patch({ result, catalog, status: result.status === "active" ? "Guided route active" : result.status === "complete" ? "Quest complete" : result.status === "unsupported" ? "This route is unsupported" : "Quest Helper is unavailable" });
        return true;
    }
    acceptCatalog(data: unknown): boolean {
        if (!data || typeof data !== "object" || (data as {
            session?: unknown;
        }).session !== this.session || !this.account)
            return false;
        const catalog = parseHelperCatalog(data);
        if (!catalog)
            return false;
        this.patch({ catalog, status: this.state.selected ? this.state.status : "Choose a quest." });
        if (this.autoSelectTutorial && !this.state.selected) {
            this.autoSelectTutorial = false;
            const tutorial = catalog.quests.find(quest => quest.questKey === "learning_the_ropes" && quest.supported && (quest.status === "NOT_STARTED" || quest.status === "IN_PROGRESS"));
            if (tutorial) this.select(tutorial.questKey, tutorial.helperVariant);
        }
        return true;
    }
    fail(message: string): void { this.inFlight = false; this.patch({ result: null, status: message }); }
    close(): void { this.endSession(); this.account = null; this.lastTick = -1; this.patch({ result: null, catalog: null, status: "Quest Helper is stopped." }); }
    private endSession(): void { if (this.session)
        this.send({ type: "close", protocol: 1, session: this.session }); this.session = ""; this.sequence = 0; this.inFlight = false; }
    private patch(patch: Partial<HelperSessionState>): void { this.state = { ...this.state, ...patch, version: this.state.version + 1 }; for (const listener of this.listeners)
        listener(); }
}
