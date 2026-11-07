/** java.awt geometry for ported plugins: points, sizes, rectangles and polygons in canvas pixels. */

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface Dimension {
    readonly width: number;
    readonly height: number;
}

/** A shape an overlay can outline, fill or hit-test (java.awt.Shape, as far as plugins use it). */
export interface Shape {
    contains(x: number, y: number): boolean;
    getBounds(): Rectangle;
}

export class Rectangle implements Shape {
    constructor(
        public x: number = 0,
        public y: number = 0,
        public width: number = 0,
        public height: number = 0,
    ) {}

    contains(px: number, py: number): boolean {
        return this.width > 0 && this.height > 0 && px >= this.x && py >= this.y && px < this.x + this.width && py < this.y + this.height;
    }

    getBounds(): Rectangle {
        return new Rectangle(this.x, this.y, this.width, this.height);
    }

    /** java.awt.Rectangle.contains(Rectangle): the other rectangle lies entirely inside this one. */
    containsRect(other: Rectangle): boolean {
        if (this.width <= 0 || this.height <= 0 || other.width <= 0 || other.height <= 0) return false;
        return other.x >= this.x && other.y >= this.y && other.x + other.width <= this.x + this.width && other.y + other.height <= this.y + this.height;
    }

    /** java.awt.Rectangle.intersects: the two rectangles share any area. */
    intersects(other: Rectangle): boolean {
        if (this.width <= 0 || this.height <= 0 || other.width <= 0 || other.height <= 0) return false;
        return other.x < this.x + this.width && other.x + other.width > this.x && other.y < this.y + this.height && other.y + other.height > this.y;
    }

    /** The four corners, clockwise from the top left, for drawing as a polygon. */
    corners(): ReadonlyArray<readonly [number, number]> {
        return [
            [this.x, this.y],
            [this.x + this.width, this.y],
            [this.x + this.width, this.y + this.height],
            [this.x, this.y + this.height],
        ];
    }

    setLocation(x: number, y: number): void {
        this.x = x;
        this.y = y;
    }

    setSize(width: number, height: number): void {
        this.width = width;
        this.height = height;
    }
}

export class Polygon implements Shape {
    constructor(public readonly points: ReadonlyArray<readonly [number, number]>) {}

    /** Even-odd ray casting, as java.awt.Polygon.contains. */
    contains(px: number, py: number): boolean {
        const pts = this.points;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    getBounds(): Rectangle {
        if (this.points.length === 0) return new Rectangle();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of this.points) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        return new Rectangle(minX, minY, maxX - minX, maxY - minY);
    }
}

/** A shape's outline as points, for the renderer's polyline and polygon calls. */
export function shapePoints(shape: Shape): ReadonlyArray<readonly [number, number]> {
    return shape instanceof Polygon ? shape.points : shape.getBounds().corners();
}
