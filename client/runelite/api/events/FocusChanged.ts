export class FocusChanged {
    constructor(private readonly focused: boolean) {}

    isFocused(): boolean {
        return this.focused;
    }
}
