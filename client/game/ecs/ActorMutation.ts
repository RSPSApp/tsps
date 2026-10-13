export type ActorMutation = {
    index: number;
    kind: "spawn" | "despawn" | "composition" | "appearance" | "animation" | "interacting" | "overhead";
    oldId?: number;
    text?: string;
};
