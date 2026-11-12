export interface EnteredAmountAction {
    acceptsZero?: boolean;
    acceptsNegative?: boolean;
    execute(amount: number): void;
    /** Runs when the prompt is dropped unanswered (PacketSender.abortInputPrompt). */
    cancel?(): void;
}
