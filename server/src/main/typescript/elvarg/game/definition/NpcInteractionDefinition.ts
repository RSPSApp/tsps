export interface NpcInteractionActionDefinition {
    method: string;
    args: Record<string, unknown>;
    source: string;
}

export class NpcInteractionDefinition {
    private static definitions = new Map<number, NpcInteractionDefinition>();

    constructor(
        private readonly npcId: number,
        private readonly firstClick: NpcInteractionActionDefinition | null,
        private readonly secondClick: NpcInteractionActionDefinition | null,
        private readonly thirdClick: NpcInteractionActionDefinition | null,
        private readonly fourthClick: NpcInteractionActionDefinition | null = null,
        private readonly fifthClick: NpcInteractionActionDefinition | null = null
    ) {}

    public static replace(definitions: NpcInteractionDefinition[]): void {
        this.definitions.clear();
        for (const definition of definitions) {
            this.definitions.set(definition.getNpcId(), definition);
        }
    }

    public static forNpcId(npcId: number): NpcInteractionDefinition | undefined {
        return this.definitions.get(npcId);
    }

    public static all(): readonly NpcInteractionDefinition[] {
        return Array.from(this.definitions.values());
    }

    public getNpcId(): number {
        return this.npcId;
    }

    public getAction(clickType: number): NpcInteractionActionDefinition | null {
        if (clickType === 1) {
            return this.firstClick;
        }
        if (clickType === 2) {
            return this.secondClick;
        }
        if (clickType === 3) {
            return this.thirdClick;
        }
        if (clickType === 4) {
            return this.fourthClick;
        }
        if (clickType === 5) {
            return this.fifthClick;
        }
        return null;
    }

    public getFirstClick(): NpcInteractionActionDefinition | null {
        return this.firstClick;
    }

    public getSecondClick(): NpcInteractionActionDefinition | null {
        return this.secondClick;
    }

    public getThirdClick(): NpcInteractionActionDefinition | null {
        return this.thirdClick;
    }

    public getFourthClick(): NpcInteractionActionDefinition | null {
        return this.fourthClick;
    }

    public getFifthClick(): NpcInteractionActionDefinition | null {
        return this.fifthClick;
    }
}
