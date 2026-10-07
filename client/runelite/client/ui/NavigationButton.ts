import type { ComponentType, JSX } from "react";

/** A sidebar icon: an inline SVG (or any element) drawn at the rail's icon size. */
export type NavigationIcon = (props: { label: string }) => JSX.Element;

/**
 * RuneLite's `NavigationButton`: one sidebar icon and the panel it opens. RuneLite's
 * `PluginPanel` is a Swing component; here `panel` is a React component, the one part of a
 * port that is a rewrite (docs/RuneLite_API_shape_implementation.md, §3).
 */
export class NavigationButton {
    readonly tooltip: string;
    readonly icon?: NavigationIcon;
    readonly priority: number;
    readonly panel?: ComponentType;
    readonly onClick?: () => void;

    private constructor(builder: NavigationButtonBuilder) {
        this.tooltip = builder.values.tooltip;
        this.icon = builder.values.icon;
        this.priority = builder.values.priority;
        this.panel = builder.values.panel;
        this.onClick = builder.values.onClick;
    }

    static builder(): NavigationButtonBuilder {
        return new NavigationButtonBuilder((builder) => new NavigationButton(builder));
    }

    getTooltip(): string {
        return this.tooltip;
    }

    getPriority(): number {
        return this.priority;
    }

    getPanel(): ComponentType | undefined {
        return this.panel;
    }
}

/** Lombok-style builder, as RuneLite plugins write it. */
export class NavigationButtonBuilder {
    readonly values: {
        tooltip: string;
        icon?: NavigationIcon;
        priority: number;
        panel?: ComponentType;
        onClick?: () => void;
    } = { tooltip: "", priority: 0 };

    constructor(private readonly create: (builder: NavigationButtonBuilder) => NavigationButton) {}

    tooltip(tooltip: string): this {
        this.values.tooltip = tooltip;
        return this;
    }

    icon(icon: NavigationIcon): this {
        this.values.icon = icon;
        return this;
    }

    priority(priority: number): this {
        this.values.priority = priority;
        return this;
    }

    panel(panel: ComponentType): this {
        this.values.panel = panel;
        return this;
    }

    onClick(onClick: () => void): this {
        this.values.onClick = onClick;
        return this;
    }

    build(): NavigationButton {
        return this.create(this);
    }
}
