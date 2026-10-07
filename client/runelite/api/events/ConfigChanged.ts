export class ConfigChanged {
    constructor(
        private readonly group: string,
        private readonly key: string,
        private readonly oldValue: string | undefined,
        private readonly newValue: string | undefined,
    ) {}

    getGroup(): string {
        return this.group;
    }

    getKey(): string {
        return this.key;
    }

    getOldValue(): string | undefined {
        return this.oldValue;
    }

    getNewValue(): string | undefined {
        return this.newValue;
    }
}
