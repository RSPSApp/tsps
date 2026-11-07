/** An interface group finished loading (RuneLite's WidgetLoaded). Posted when the widget manager opens a group. */
export class WidgetLoaded {
    constructor(private readonly groupId: number) {}

    getGroupId(): number {
        return this.groupId;
    }
}
