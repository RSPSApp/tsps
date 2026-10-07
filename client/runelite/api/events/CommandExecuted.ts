export class CommandExecuted {
    constructor(
        private readonly command: string,
        private readonly arguments_: string[] = [],
    ) {}

    getCommand(): string {
        return this.command;
    }

    getArguments(): string[] {
        return this.arguments_;
    }
}
