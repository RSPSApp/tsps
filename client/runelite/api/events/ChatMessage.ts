/** A line added to the chatbox. `type` is the OSRS chat type id (RuneLite's ChatMessageType). */
export class ChatMessage {
    constructor(
        private readonly type: number,
        private readonly name: string,
        private readonly message: string,
        private readonly sender: string | null,
    ) {}

    getType(): number {
        return this.type;
    }

    getName(): string {
        return this.name;
    }

    getMessage(): string {
        return this.message;
    }

    getSender(): string | null {
        return this.sender;
    }
}
