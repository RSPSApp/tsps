import type { PrivateArea } from "../../areas/impl/PrivateArea";

const SEARCH_MAP_SIZE = 128;
const RING_BUFFER_SIZE = 4096;
const DISTANCE_SENTINEL = 99_999_999;
const SRC_DIRECTION_SENTINEL = 99;
const MAX_ALTERNATIVE_ROUTE_LOWEST_COST = 1000;
const MAX_ALTERNATIVE_ROUTE_SEEK_RANGE = 100;
const MAX_ALTERNATIVE_ROUTE_DISTANCE_FROM_DESTINATION = 10;

const DIR_NORTH = 0x1;
const DIR_EAST = 0x2;
const DIR_SOUTH = 0x4;
const DIR_WEST = 0x8;
const DIR_SOUTH_WEST = DIR_WEST | DIR_SOUTH;
const DIR_NORTH_WEST = DIR_WEST | DIR_NORTH;
const DIR_SOUTH_EAST = DIR_EAST | DIR_SOUTH;
const DIR_NORTH_EAST = DIR_EAST | DIR_NORTH;

const BLOCK_ACCESS_NORTH = 0x1;
const BLOCK_ACCESS_EAST = 0x2;
const BLOCK_ACCESS_SOUTH = 0x4;
const BLOCK_ACCESS_WEST = 0x8;

const WALL_NORTH_WEST = 0x1;
const WALL_NORTH = 0x2;
const WALL_NORTH_EAST = 0x4;
const WALL_EAST = 0x8;
const WALL_SOUTH_EAST = 0x10;
const WALL_SOUTH = 0x20;
const WALL_SOUTH_WEST = 0x40;
const WALL_WEST = 0x80;
const LOC = 0x100;
const GROUND_DECOR = 0x40000;
const BLOCK_WALK = 0x200000;

const FLOOR_BLOCKED = BLOCK_WALK | GROUND_DECOR;
const BLOCK_WEST = WALL_EAST | LOC | FLOOR_BLOCKED;
const BLOCK_EAST = WALL_WEST | LOC | FLOOR_BLOCKED;
const BLOCK_SOUTH = WALL_NORTH | LOC | FLOOR_BLOCKED;
const BLOCK_NORTH = WALL_SOUTH | LOC | FLOOR_BLOCKED;
const BLOCK_SOUTH_WEST = WALL_NORTH | WALL_NORTH_EAST | WALL_EAST | LOC | FLOOR_BLOCKED;
const BLOCK_SOUTH_EAST = WALL_NORTH_WEST | WALL_NORTH | WALL_WEST | LOC | FLOOR_BLOCKED;
const BLOCK_NORTH_WEST = WALL_EAST | WALL_SOUTH_EAST | WALL_SOUTH | LOC | FLOOR_BLOCKED;
const BLOCK_NORTH_EAST = WALL_SOUTH | WALL_SOUTH_WEST | WALL_WEST | LOC | FLOOR_BLOCKED;
const BLOCK_NORTH_AND_SOUTH_EAST =
  WALL_NORTH | WALL_NORTH_EAST | WALL_EAST | WALL_SOUTH_EAST | WALL_SOUTH | LOC | FLOOR_BLOCKED;
const BLOCK_NORTH_AND_SOUTH_WEST =
  WALL_NORTH_WEST | WALL_NORTH | WALL_SOUTH | WALL_SOUTH_WEST | WALL_WEST | LOC | FLOOR_BLOCKED;
const BLOCK_NORTH_EAST_AND_WEST =
  WALL_NORTH_WEST | WALL_NORTH | WALL_NORTH_EAST | WALL_EAST | WALL_WEST | LOC | FLOOR_BLOCKED;
const BLOCK_SOUTH_EAST_AND_WEST =
  WALL_EAST | WALL_SOUTH_EAST | WALL_SOUTH | WALL_SOUTH_WEST | WALL_WEST | LOC | FLOOR_BLOCKED;

const WALL_STRATEGY = 0;
const WALL_DECO_STRATEGY = 1;
const RECTANGLE_STRATEGY = 2;
const NO_STRATEGY = 3;
const RECTANGLE_EXCLUSIVE_STRATEGY = 4;

const WALLDECOR_DIAGONAL_NOOFFSET_SHAPE = 7;

export type RsmodWaypoint = { x: number; y: number; z: number };

type CollisionLookup = (x: number, y: number, level: number, privateArea: PrivateArea | null) => number;

export type RsmodRouteResult = {
  waypoints: RsmodWaypoint[];
  alternative: boolean;
  success: boolean;
  endX: number;
  endY: number;
};

type ReachOptions = {
  level: number;
  srcX: number;
  srcY: number;
  srcSize: number;
  destX: number;
  destY: number;
  destWidth?: number;
  destLength?: number;
  locAngle?: number;
  locShape?: number;
  blockAccessFlags?: number;
  privateArea: PrivateArea | null;
};

type FindRouteOptions = ReachOptions & {
  moveNear?: boolean;
  maxWaypoints?: number;
};

function rotateDimensions(angle: number, a: number, b: number): number {
  return (angle & 0x1) !== 0 ? b : a;
}

function rotateBlockAccess(angle: number, blockAccessFlags: number): number {
  blockAccessFlags &= 0xf;
  if (angle === 0) {
    return blockAccessFlags;
  }
  return (((blockAccessFlags << angle) & 0xf) | (blockAccessFlags >> (4 - angle))) & 0xf;
}

function collides(
  srcX: number,
  srcY: number,
  destX: number,
  destY: number,
  srcWidth: number,
  srcLength: number,
  destWidth: number,
  destLength: number
): boolean {
  if (srcX >= destX + destWidth || srcX + srcWidth <= destX) {
    return false;
  }
  return srcY < destY + destLength && destY < srcLength + srcY;
}

export class RsmodRouteFinding {
  private readonly directions = new Int32Array(SEARCH_MAP_SIZE * SEARCH_MAP_SIZE);
  private readonly distances = new Int32Array(SEARCH_MAP_SIZE * SEARCH_MAP_SIZE);
  private readonly validLocalX = new Int32Array(RING_BUFFER_SIZE);
  private readonly validLocalY = new Int32Array(RING_BUFFER_SIZE);
  private currLocalX = 0;
  private currLocalY = 0;
  private bufReaderIndex = 0;
  private bufWriterIndex = 0;
  private getClipping?: CollisionLookup;

  public constructor(getClipping?: CollisionLookup) {
    this.getClipping = getClipping;
  }

  public findRoute(options: FindRouteOptions): RsmodRouteResult {
    const {
      level,
      srcX,
      srcY,
      srcSize,
      destX,
      destY,
      privateArea,
      destWidth = 1,
      destLength = 1,
      locAngle = 0,
      locShape = -1,
      moveNear = true,
      blockAccessFlags = 0,
      // Real OSRS/RSMod caps an extracted path at 25 checkpoints - a
      // longer route stops at the 25th and needs a fresh click to continue.
      maxWaypoints = 25,
    } = options;

    this.reset();

    const baseX = srcX - (SEARCH_MAP_SIZE >> 1);
    const baseY = srcY - (SEARCH_MAP_SIZE >> 1);
    const localSrcX = srcX - baseX;
    const localSrcY = srcY - baseY;
    const localDestX = destX - baseX;
    const localDestY = destY - baseY;

    this.appendDirection(localSrcX, localSrcY, SRC_DIRECTION_SENTINEL, 0);

    let pathFound = false;
    if (srcSize === 1) {
      pathFound = this.routeFindSize1(
        baseX,
        baseY,
        level,
        localDestX,
        localDestY,
        destWidth,
        destLength,
        srcSize,
        locAngle,
        locShape,
        blockAccessFlags,
        privateArea
      );
    } else {
      pathFound = this.routeFindBig(
        baseX,
        baseY,
        level,
        localDestX,
        localDestY,
        destWidth,
        destLength,
        srcSize,
        locAngle,
        locShape,
        blockAccessFlags,
        privateArea
      );
    }

    if (!pathFound) {
      if (!moveNear) {
        return { waypoints: [], alternative: false, success: false, endX: srcX, endY: srcY };
      }
      const foundApproachPoint = this.findClosestApproachPoint(
        localDestX,
        localDestY,
        rotateDimensions(locAngle, destWidth, destLength),
        rotateDimensions(locAngle, destLength, destWidth)
      );
      if (!foundApproachPoint) {
        return { waypoints: [], alternative: false, success: false, endX: srcX, endY: srcY };
      }
    }

    const endLocalX = this.currLocalX;
    const endLocalY = this.currLocalY;
    const waypoints: RsmodWaypoint[] = [];
    let nextDirection = this.directionAt(this.currLocalX, this.currLocalY);
    let currentDirection = -1;

    // Bounded exactly like RouteFinding.findRoute's `for (i in directions.indices)`.
    // A direction of 0 advances neither axis, so an unvisited or corrupt cell would
    // otherwise spin this loop forever and hang the game tick.
    for (
      let guard = this.directions.length;
      guard > 0 && (this.currLocalX !== localSrcX || this.currLocalY !== localSrcY);
      guard--
    ) {
      if (currentDirection !== nextDirection) {
        currentDirection = nextDirection;
        if (waypoints.length >= maxWaypoints) {
          waypoints.pop();
        }
        waypoints.unshift({
          x: baseX + this.currLocalX,
          y: baseY + this.currLocalY,
          z: level,
        });
      }
      if ((currentDirection & DIR_EAST) !== 0) {
        this.currLocalX++;
      } else if ((currentDirection & DIR_WEST) !== 0) {
        this.currLocalX--;
      }
      if ((currentDirection & DIR_NORTH) !== 0) {
        this.currLocalY++;
      } else if ((currentDirection & DIR_SOUTH) !== 0) {
        this.currLocalY--;
      }
      nextDirection = this.directionAt(this.currLocalX, this.currLocalY);
    }

    return {
      waypoints,
      alternative: !pathFound,
      success: true,
      endX: baseX + endLocalX,
      endY: baseY + endLocalY,
    };
  }

  public reachedAbsolute(options: ReachOptions): boolean {
    const {
      level,
      srcX,
      srcY,
      srcSize,
      destX,
      destY,
      privateArea,
      destWidth = 1,
      destLength = 1,
      locAngle = 0,
      locShape = -1,
      blockAccessFlags = 0,
    } = options;

    const baseX = srcX - (SEARCH_MAP_SIZE >> 1);
    const baseY = srcY - (SEARCH_MAP_SIZE >> 1);
    return this.reached(
      baseX,
      baseY,
      level,
      srcX - baseX,
      srcY - baseY,
      destX - baseX,
      destY - baseY,
      destWidth,
      destLength,
      srcSize,
      locAngle,
      locShape,
      blockAccessFlags,
      privateArea
    );
  }

  private routeFindSize1(
    baseX: number,
    baseY: number,
    level: number,
    localDestX: number,
    localDestY: number,
    destWidth: number,
    destLength: number,
    srcSize: number,
    locAngle: number,
    locShape: number,
    blockAccessFlags: number,
    privateArea: PrivateArea | null
  ): boolean {
    const relativeSearchSize = SEARCH_MAP_SIZE - 1;
    while (this.bufWriterIndex !== this.bufReaderIndex) {
      this.currLocalX = this.validLocalX[this.bufReaderIndex];
      this.currLocalY = this.validLocalY[this.bufReaderIndex];
      this.bufReaderIndex = (this.bufReaderIndex + 1) & (RING_BUFFER_SIZE - 1);

      if (
        this.reached(
          baseX,
          baseY,
          level,
          this.currLocalX,
          this.currLocalY,
          localDestX,
          localDestY,
          destWidth,
          destLength,
          srcSize,
          locAngle,
          locShape,
          blockAccessFlags,
          privateArea
        )
      ) {
        return true;
      }

      const nextDistance = this.distanceAt(this.currLocalX, this.currLocalY) + 1;

      let x = this.currLocalX - 1;
      let y = this.currLocalY;
      if (
        this.currLocalX > 0 &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_WEST)
      ) {
        this.appendDirection(x, y, DIR_EAST, nextDistance);
      }

      x = this.currLocalX + 1;
      y = this.currLocalY;
      if (
        this.currLocalX < relativeSearchSize &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_EAST)
      ) {
        this.appendDirection(x, y, DIR_WEST, nextDistance);
      }

      x = this.currLocalX;
      y = this.currLocalY - 1;
      if (
        this.currLocalY > 0 &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_SOUTH)
      ) {
        this.appendDirection(x, y, DIR_NORTH, nextDistance);
      }

      x = this.currLocalX;
      y = this.currLocalY + 1;
      if (
        this.currLocalY < relativeSearchSize &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_NORTH)
      ) {
        this.appendDirection(x, y, DIR_SOUTH, nextDistance);
      }

      x = this.currLocalX - 1;
      y = this.currLocalY - 1;
      if (
        this.currLocalX > 0 &&
        this.currLocalY > 0 &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_SOUTH_WEST) &&
        this.canMove(this.flagAt(baseX, baseY, x, this.currLocalY, level, privateArea), BLOCK_WEST) &&
        this.canMove(this.flagAt(baseX, baseY, this.currLocalX, y, level, privateArea), BLOCK_SOUTH)
      ) {
        this.appendDirection(x, y, DIR_NORTH_EAST, nextDistance);
      }

      x = this.currLocalX + 1;
      y = this.currLocalY - 1;
      if (
        this.currLocalX < relativeSearchSize &&
        this.currLocalY > 0 &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_SOUTH_EAST) &&
        this.canMove(this.flagAt(baseX, baseY, x, this.currLocalY, level, privateArea), BLOCK_EAST) &&
        this.canMove(this.flagAt(baseX, baseY, this.currLocalX, y, level, privateArea), BLOCK_SOUTH)
      ) {
        this.appendDirection(x, y, DIR_NORTH_WEST, nextDistance);
      }

      x = this.currLocalX - 1;
      y = this.currLocalY + 1;
      if (
        this.currLocalX > 0 &&
        this.currLocalY < relativeSearchSize &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_NORTH_WEST) &&
        this.canMove(this.flagAt(baseX, baseY, x, this.currLocalY, level, privateArea), BLOCK_WEST) &&
        this.canMove(this.flagAt(baseX, baseY, this.currLocalX, y, level, privateArea), BLOCK_NORTH)
      ) {
        this.appendDirection(x, y, DIR_SOUTH_EAST, nextDistance);
      }

      x = this.currLocalX + 1;
      y = this.currLocalY + 1;
      if (
        this.currLocalX < relativeSearchSize &&
        this.currLocalY < relativeSearchSize &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_NORTH_EAST) &&
        this.canMove(this.flagAt(baseX, baseY, x, this.currLocalY, level, privateArea), BLOCK_EAST) &&
        this.canMove(this.flagAt(baseX, baseY, this.currLocalX, y, level, privateArea), BLOCK_NORTH)
      ) {
        this.appendDirection(x, y, DIR_SOUTH_WEST, nextDistance);
      }
    }
    return false;
  }

  private routeFindBig(
    baseX: number,
    baseY: number,
    level: number,
    localDestX: number,
    localDestY: number,
    destWidth: number,
    destLength: number,
    srcSize: number,
    locAngle: number,
    locShape: number,
    blockAccessFlags: number,
    privateArea: PrivateArea | null
  ): boolean {
    const relativeSearchSize = SEARCH_MAP_SIZE - srcSize;
    while (this.bufWriterIndex !== this.bufReaderIndex) {
      this.currLocalX = this.validLocalX[this.bufReaderIndex];
      this.currLocalY = this.validLocalY[this.bufReaderIndex];
      this.bufReaderIndex = (this.bufReaderIndex + 1) & (RING_BUFFER_SIZE - 1);

      if (
        this.reached(
          baseX,
          baseY,
          level,
          this.currLocalX,
          this.currLocalY,
          localDestX,
          localDestY,
          destWidth,
          destLength,
          srcSize,
          locAngle,
          locShape,
          blockAccessFlags,
          privateArea
        )
      ) {
        return true;
      }

      const nextDistance = this.distanceAt(this.currLocalX, this.currLocalY) + 1;

      let x = this.currLocalX - 1;
      let y = this.currLocalY;
      if (
        this.currLocalX > 0 &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_SOUTH_WEST) &&
        this.canMove(
          this.flagAt(baseX, baseY, x, this.currLocalY + srcSize - 1, level, privateArea),
          BLOCK_NORTH_WEST
        )
      ) {
        let blocked = false;
        for (let i = 1; i < srcSize - 1; i++) {
          if (
            !this.canMove(
              this.flagAt(baseX, baseY, x, this.currLocalY + i, level, privateArea),
              BLOCK_NORTH_AND_SOUTH_EAST
            )
          ) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          this.appendDirection(x, y, DIR_EAST, nextDistance);
        }
      }

      x = this.currLocalX + 1;
      y = this.currLocalY;
      if (
        this.currLocalX < relativeSearchSize &&
        this.directionAt(x, y) === 0 &&
        this.canMove(
          this.flagAt(baseX, baseY, this.currLocalX + srcSize, y, level, privateArea),
          BLOCK_SOUTH_EAST
        ) &&
        this.canMove(
          this.flagAt(
            baseX,
            baseY,
            this.currLocalX + srcSize,
            this.currLocalY + srcSize - 1,
            level,
            privateArea
          ),
          BLOCK_NORTH_EAST
        )
      ) {
        let blocked = false;
        for (let i = 1; i < srcSize - 1; i++) {
          if (
            !this.canMove(
              this.flagAt(
                baseX,
                baseY,
                this.currLocalX + srcSize,
                this.currLocalY + i,
                level,
                privateArea
              ),
              BLOCK_NORTH_AND_SOUTH_WEST
            )
          ) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          this.appendDirection(x, y, DIR_WEST, nextDistance);
        }
      }

      x = this.currLocalX;
      y = this.currLocalY - 1;
      if (
        this.currLocalY > 0 &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_SOUTH_WEST) &&
        this.canMove(
          this.flagAt(baseX, baseY, this.currLocalX + srcSize - 1, y, level, privateArea),
          BLOCK_SOUTH_EAST
        )
      ) {
        let blocked = false;
        for (let i = 1; i < srcSize - 1; i++) {
          if (
            !this.canMove(
              this.flagAt(baseX, baseY, this.currLocalX + i, y, level, privateArea),
              BLOCK_NORTH_EAST_AND_WEST
            )
          ) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          this.appendDirection(x, y, DIR_NORTH, nextDistance);
        }
      }

      x = this.currLocalX;
      y = this.currLocalY + 1;
      if (
        this.currLocalY < relativeSearchSize &&
        this.directionAt(x, y) === 0 &&
        this.canMove(
          this.flagAt(baseX, baseY, x, this.currLocalY + srcSize, level, privateArea),
          BLOCK_NORTH_WEST
        ) &&
        this.canMove(
          this.flagAt(
            baseX,
            baseY,
            this.currLocalX + srcSize - 1,
            this.currLocalY + srcSize,
            level,
            privateArea
          ),
          BLOCK_NORTH_EAST
        )
      ) {
        let blocked = false;
        for (let i = 1; i < srcSize - 1; i++) {
          if (
            !this.canMove(
              this.flagAt(
                baseX,
                baseY,
                x + i,
                this.currLocalY + srcSize,
                level,
                privateArea
              ),
              BLOCK_SOUTH_EAST_AND_WEST
            )
          ) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          this.appendDirection(x, y, DIR_SOUTH, nextDistance);
        }
      }

      x = this.currLocalX - 1;
      y = this.currLocalY - 1;
      if (
        this.currLocalX > 0 &&
        this.currLocalY > 0 &&
        this.directionAt(x, y) === 0 &&
        this.canMove(this.flagAt(baseX, baseY, x, y, level, privateArea), BLOCK_SOUTH_WEST)
      ) {
        let blocked = false;
        for (let i = 1; i < srcSize; i++) {
          if (
            !this.canMove(
              this.flagAt(baseX, baseY, x, this.currLocalY + i - 1, level, privateArea),
              BLOCK_NORTH_AND_SOUTH_EAST
            ) ||
            !this.canMove(
              this.flagAt(baseX, baseY, this.currLocalX + i - 1, y, level, privateArea),
              BLOCK_NORTH_EAST_AND_WEST
            )
          ) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          this.appendDirection(x, y, DIR_NORTH_EAST, nextDistance);
        }
      }

      x = this.currLocalX + 1;
      y = this.currLocalY - 1;
      if (
        this.currLocalX < relativeSearchSize &&
        this.currLocalY > 0 &&
        this.directionAt(x, y) === 0 &&
        this.canMove(
          this.flagAt(baseX, baseY, this.currLocalX + srcSize, y, level, privateArea),
          BLOCK_SOUTH_EAST
        )
      ) {
        let blocked = false;
        for (let i = 1; i < srcSize; i++) {
          if (
            !this.canMove(
              this.flagAt(
                baseX,
                baseY,
                this.currLocalX + srcSize,
                this.currLocalY + i - 1,
                level,
                privateArea
              ),
              BLOCK_NORTH_AND_SOUTH_WEST
            ) ||
            !this.canMove(
              this.flagAt(baseX, baseY, this.currLocalX + i, y, level, privateArea),
              BLOCK_NORTH_EAST_AND_WEST
            )
          ) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          this.appendDirection(x, y, DIR_NORTH_WEST, nextDistance);
        }
      }

      x = this.currLocalX - 1;
      y = this.currLocalY + 1;
      if (
        this.currLocalX > 0 &&
        this.currLocalY < relativeSearchSize &&
        this.directionAt(x, y) === 0 &&
        this.canMove(
          this.flagAt(baseX, baseY, x, this.currLocalY + srcSize, level, privateArea),
          BLOCK_NORTH_WEST
        )
      ) {
        let blocked = false;
        for (let i = 1; i < srcSize; i++) {
          if (
            !this.canMove(
              this.flagAt(baseX, baseY, x, this.currLocalY + i, level, privateArea),
              BLOCK_NORTH_AND_SOUTH_EAST
            ) ||
            !this.canMove(
              this.flagAt(
                baseX,
                baseY,
                this.currLocalX + i - 1,
                this.currLocalY + srcSize,
                level,
                privateArea
              ),
              BLOCK_SOUTH_EAST_AND_WEST
            )
          ) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          this.appendDirection(x, y, DIR_SOUTH_EAST, nextDistance);
        }
      }

      x = this.currLocalX + 1;
      y = this.currLocalY + 1;
      if (
        this.currLocalX < relativeSearchSize &&
        this.currLocalY < relativeSearchSize &&
        this.directionAt(x, y) === 0 &&
        this.canMove(
          this.flagAt(
            baseX,
            baseY,
            this.currLocalX + srcSize,
            this.currLocalY + srcSize,
            level,
            privateArea
          ),
          BLOCK_NORTH_EAST
        )
      ) {
        let blocked = false;
        for (let i = 1; i < srcSize; i++) {
          if (
            !this.canMove(
              this.flagAt(
                baseX,
                baseY,
                this.currLocalX + i,
                this.currLocalY + srcSize,
                level,
                privateArea
              ),
              BLOCK_SOUTH_EAST_AND_WEST
            ) ||
            !this.canMove(
              this.flagAt(
                baseX,
                baseY,
                this.currLocalX + srcSize,
                this.currLocalY + i,
                level,
                privateArea
              ),
              BLOCK_NORTH_AND_SOUTH_WEST
            )
          ) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          this.appendDirection(x, y, DIR_SOUTH_WEST, nextDistance);
        }
      }
    }
    return false;
  }

  private findClosestApproachPoint(
    localDestX: number,
    localDestY: number,
    width: number,
    length: number
  ): boolean {
    let lowestCost = MAX_ALTERNATIVE_ROUTE_LOWEST_COST;
    let maxAlternativePath = MAX_ALTERNATIVE_ROUTE_SEEK_RANGE;
    const alternativeRouteRange = MAX_ALTERNATIVE_ROUTE_DISTANCE_FROM_DESTINATION;
    for (let x = localDestX - alternativeRouteRange; x <= localDestX + alternativeRouteRange; x++) {
      for (let y = localDestY - alternativeRouteRange; y <= localDestY + alternativeRouteRange; y++) {
        if (
          x < 0 ||
          y < 0 ||
          x >= SEARCH_MAP_SIZE ||
          y >= SEARCH_MAP_SIZE ||
          this.distanceAt(x, y) >= MAX_ALTERNATIVE_ROUTE_SEEK_RANGE
        ) {
          continue;
        }
        const dx = x < localDestX ? localDestX - x : x > localDestX + width - 1 ? x - (width + localDestX - 1) : 0;
        const dy = y < localDestY ? localDestY - y : y > localDestY + length - 1 ? y - (localDestY + length - 1) : 0;
        const cost = dx * dx + dy * dy;
        if (cost < lowestCost || (cost === lowestCost && maxAlternativePath > this.distanceAt(x, y))) {
          this.currLocalX = x;
          this.currLocalY = y;
          lowestCost = cost;
          maxAlternativePath = this.distanceAt(x, y);
        }
      }
    }
    return lowestCost !== MAX_ALTERNATIVE_ROUTE_LOWEST_COST;
  }

  private reached(
    baseX: number,
    baseY: number,
    level: number,
    localSrcX: number,
    localSrcY: number,
    localDestX: number,
    localDestY: number,
    destWidth: number,
    destLength: number,
    srcSize: number,
    locAngle: number,
    locShape: number,
    blockAccessFlags: number,
    privateArea: PrivateArea | null
  ): boolean {
    const srcX = localSrcX + baseX;
    const srcY = localSrcY + baseY;
    const destX = localDestX + baseX;
    const destY = localDestY + baseY;
    const exitStrategy = this.exitStrategy(locShape);
    if (exitStrategy !== RECTANGLE_EXCLUSIVE_STRATEGY && srcX === destX && srcY === destY) {
      return true;
    }
    if ((exitStrategy === WALL_STRATEGY || exitStrategy === WALL_DECO_STRATEGY) &&
      collides(srcX, srcY, destX, destY, srcSize, srcSize, 1, 1)) {
      return true;
    }
    switch (exitStrategy) {
      case WALL_STRATEGY:
        return srcSize === 1
          ? this.reachWall1(level, srcX, srcY, destX, destY, locShape, locAngle, privateArea)
          : this.reachWallN(level, srcX, srcY, destX, destY, srcSize, locShape, locAngle, privateArea);
      case WALL_DECO_STRATEGY:
        return srcSize === 1
          ? this.reachWallDeco1(level, srcX, srcY, destX, destY, locShape, locAngle, privateArea)
          : this.reachWallDecoN(level, srcX, srcY, destX, destY, srcSize, locShape, locAngle, privateArea);
      case RECTANGLE_STRATEGY:
        return this.reachRectangle(
          level,
          srcX,
          srcY,
          destX,
          destY,
          srcSize,
          destWidth,
          destLength,
          locAngle,
          blockAccessFlags,
          privateArea,
          false
        );
      case RECTANGLE_EXCLUSIVE_STRATEGY:
        return this.reachRectangle(
          level,
          srcX,
          srcY,
          destX,
          destY,
          srcSize,
          destWidth,
          destLength,
          locAngle,
          blockAccessFlags,
          privateArea,
          true
        );
      default:
        return false;
    }
  }

  private reachRectangle(
    level: number,
    srcX: number,
    srcY: number,
    destX: number,
    destY: number,
    srcSize: number,
    destWidth: number,
    destLength: number,
    locAngle: number,
    blockAccessFlags: number,
    privateArea: PrivateArea | null,
    exclusive: boolean
  ): boolean {
    const rotatedWidth = rotateDimensions(locAngle, destWidth, destLength);
    const rotatedLength = rotateDimensions(locAngle, destLength, destWidth);
    const rotatedBlockAccess = rotateBlockAccess(locAngle, blockAccessFlags);
    const overlaps = collides(srcX, srcY, destX, destY, srcSize, srcSize, rotatedWidth, rotatedLength);
    if (exclusive ? overlaps : overlaps) {
      if (!exclusive) {
        return true;
      }
      return false;
    }
    if (srcSize === 1) {
      return this.reachRectangle1(
        level,
        srcX,
        srcY,
        destX,
        destY,
        rotatedWidth,
        rotatedLength,
        rotatedBlockAccess,
        privateArea
      );
    }
    return this.reachRectangleN(
      level,
      srcX,
      srcY,
      destX,
      destY,
      srcSize,
      srcSize,
      rotatedWidth,
      rotatedLength,
      rotatedBlockAccess,
      privateArea
    );
  }

  private reachRectangle1(
    level: number,
    srcX: number,
    srcY: number,
    destX: number,
    destY: number,
    destWidth: number,
    destLength: number,
    blockAccessFlags: number,
    privateArea: PrivateArea | null
  ): boolean {
    const east = destX + destWidth - 1;
    const north = destY + destLength - 1;

    if (
      srcX === destX - 1 &&
      srcY >= destY &&
      srcY <= north &&
      (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_EAST) === 0 &&
      (blockAccessFlags & BLOCK_ACCESS_WEST) === 0
    ) {
      return true;
    }
    if (
      srcX === east + 1 &&
      srcY >= destY &&
      srcY <= north &&
      (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_WEST) === 0 &&
      (blockAccessFlags & BLOCK_ACCESS_EAST) === 0
    ) {
      return true;
    }
    if (
      srcY + 1 === destY &&
      srcX >= destX &&
      srcX <= east &&
      (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_NORTH) === 0 &&
      (blockAccessFlags & BLOCK_ACCESS_SOUTH) === 0
    ) {
      return true;
    }
    return (
      srcY === north + 1 &&
      srcX >= destX &&
      srcX <= east &&
      (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_SOUTH) === 0 &&
      (blockAccessFlags & BLOCK_ACCESS_NORTH) === 0
    );
  }

  private reachRectangleN(
    level: number,
    srcX: number,
    srcY: number,
    destX: number,
    destY: number,
    srcWidth: number,
    srcLength: number,
    destWidth: number,
    destLength: number,
    blockAccessFlags: number,
    privateArea: PrivateArea | null
  ): boolean {
    const srcEast = srcX + srcWidth;
    const srcNorth = srcLength + srcY;
    const destEast = destWidth + destX;
    const destNorth = destLength + destY;
    if (destEast === srcX && (blockAccessFlags & BLOCK_ACCESS_EAST) === 0) {
      const fromY = Math.max(srcY, destY);
      const toY = Math.min(srcNorth, destNorth);
      for (let sideY = fromY; sideY < toY; sideY++) {
        if ((this.absoluteFlag(destEast - 1, sideY, level, privateArea) & WALL_EAST) === 0) {
          return true;
        }
      }
    } else if (srcEast === destX && (blockAccessFlags & BLOCK_ACCESS_WEST) === 0) {
      const fromY = Math.max(srcY, destY);
      const toY = Math.min(srcNorth, destNorth);
      for (let sideY = fromY; sideY < toY; sideY++) {
        if ((this.absoluteFlag(destX, sideY, level, privateArea) & WALL_WEST) === 0) {
          return true;
        }
      }
    } else if (srcY === destNorth && (blockAccessFlags & BLOCK_ACCESS_NORTH) === 0) {
      const fromX = Math.max(srcX, destX);
      const toX = Math.min(srcEast, destEast);
      for (let sideX = fromX; sideX < toX; sideX++) {
        if ((this.absoluteFlag(sideX, destNorth - 1, level, privateArea) & WALL_NORTH) === 0) {
          return true;
        }
      }
    } else if (destY === srcNorth && (blockAccessFlags & BLOCK_ACCESS_SOUTH) === 0) {
      const fromX = Math.max(srcX, destX);
      const toX = Math.min(srcEast, destEast);
      for (let sideX = fromX; sideX < toX; sideX++) {
        if ((this.absoluteFlag(sideX, destY, level, privateArea) & WALL_SOUTH) === 0) {
          return true;
        }
      }
    }
    return false;
  }

  private reachWall1(
    level: number,
    srcX: number,
    srcY: number,
    destX: number,
    destY: number,
    locShape: number,
    locAngle: number,
    privateArea: PrivateArea | null
  ): boolean {
    switch (locShape) {
      case 0:
        switch (locAngle) {
          case 0:
            return (
              (srcX === destX - 1 && srcY === destY) ||
              (srcX === destX &&
                srcY === destY + 1 &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_NORTH) === 0) ||
              (srcX === destX &&
                srcY === destY - 1 &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_SOUTH) === 0)
            );
          case 1:
            return (
              (srcX === destX && srcY === destY + 1) ||
              (srcX === destX - 1 &&
                srcY === destY &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_WEST) === 0) ||
              (srcX === destX + 1 &&
                srcY === destY &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_EAST) === 0)
            );
          case 2:
            return (
              (srcX === destX + 1 && srcY === destY) ||
              (srcX === destX &&
                srcY === destY + 1 &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_NORTH) === 0) ||
              (srcX === destX &&
                srcY === destY - 1 &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_SOUTH) === 0)
            );
          case 3:
            return (
              (srcX === destX && srcY === destY - 1) ||
              (srcX === destX - 1 &&
                srcY === destY &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_WEST) === 0) ||
              (srcX === destX + 1 &&
                srcY === destY &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_EAST) === 0)
            );
        }
        break;
      case 2:
        switch (locAngle) {
          case 0:
            return (
              (srcX === destX - 1 && srcY === destY) ||
              (srcX === destX && srcY === destY + 1) ||
              (srcX === destX + 1 &&
                srcY === destY &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_EAST) === 0) ||
              (srcX === destX &&
                srcY === destY - 1 &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_SOUTH) === 0)
            );
          case 1:
            return (
              (srcX === destX - 1 &&
                srcY === destY &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_WEST) === 0) ||
              (srcX === destX && srcY === destY + 1) ||
              (srcX === destX + 1 && srcY === destY) ||
              (srcX === destX &&
                srcY === destY - 1 &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_SOUTH) === 0)
            );
          case 2:
            return (
              (srcX === destX - 1 &&
                srcY === destY &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_WEST) === 0) ||
              (srcX === destX &&
                srcY === destY + 1 &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_NORTH) === 0) ||
              (srcX === destX + 1 && srcY === destY) ||
              (srcX === destX && srcY === destY - 1)
            );
          case 3:
            return (
              (srcX === destX - 1 && srcY === destY) ||
              (srcX === destX &&
                srcY === destY + 1 &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_NORTH) === 0) ||
              (srcX === destX + 1 &&
                srcY === destY &&
                (this.absoluteFlag(srcX, srcY, level, privateArea) & BLOCK_EAST) === 0) ||
              (srcX === destX && srcY === destY - 1)
            );
        }
        break;
      case 9:
        return (
          (srcX === destX &&
            srcY === destY + 1 &&
            (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_SOUTH) === 0) ||
          (srcX === destX &&
            srcY === destY - 1 &&
            (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_NORTH) === 0) ||
          (srcX === destX - 1 &&
            srcY === destY &&
            (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_EAST) === 0) ||
          (srcX === destX + 1 &&
            srcY === destY &&
            (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_WEST) === 0)
        );
    }
    return false;
  }

  private reachWallN(
    level: number,
    srcX: number,
    srcY: number,
    destX: number,
    destY: number,
    srcSize: number,
    locShape: number,
    locAngle: number,
    privateArea: PrivateArea | null
  ): boolean {
    const east = srcX + srcSize - 1;
    const north = srcY + srcSize - 1;
    switch (locShape) {
      case 0:
        switch (locAngle) {
          case 0:
            return (
              (srcX === destX - srcSize && srcY <= destY && north >= destY) ||
              (destX >= srcX &&
                destX <= east &&
                srcY === destY + 1 &&
                (this.absoluteFlag(destX, srcY, level, privateArea) & BLOCK_NORTH) === 0) ||
              (destX >= srcX &&
                destX <= east &&
                srcY === destY - srcSize &&
                (this.absoluteFlag(destX, north, level, privateArea) & BLOCK_SOUTH) === 0)
            );
          case 1:
            return (
              (destX >= srcX && destX <= east && srcY === destY + 1) ||
              (srcX === destX - srcSize &&
                srcY <= destY &&
                north >= destY &&
                (this.absoluteFlag(east, destY, level, privateArea) & BLOCK_WEST) === 0) ||
              (srcX === destX + 1 &&
                srcY <= destY &&
                north >= destY &&
                (this.absoluteFlag(srcX, destY, level, privateArea) & BLOCK_EAST) === 0)
            );
          case 2:
            return (
              (srcX === destX + 1 && srcY <= destY && north >= destY) ||
              (destX >= srcX &&
                destX <= east &&
                srcY === destY + 1 &&
                (this.absoluteFlag(destX, srcY, level, privateArea) & BLOCK_NORTH) === 0) ||
              (destX >= srcX &&
                destX <= east &&
                srcY === destY - srcSize &&
                (this.absoluteFlag(destX, north, level, privateArea) & BLOCK_SOUTH) === 0)
            );
          case 3:
            return (
              (destX >= srcX && destX <= east && srcY === destY - srcSize) ||
              (srcX === destX - srcSize &&
                srcY <= destY &&
                north >= destY &&
                (this.absoluteFlag(east, destY, level, privateArea) & BLOCK_WEST) === 0) ||
              (srcX === destX + 1 &&
                srcY <= destY &&
                north >= destY &&
                (this.absoluteFlag(srcX, destY, level, privateArea) & BLOCK_EAST) === 0)
            );
        }
        break;
      case 2:
        switch (locAngle) {
          case 0:
            return (
              (srcX === destX - srcSize && srcY <= destY && north >= destY) ||
              (destX >= srcX && destX <= east && srcY === destY + 1) ||
              (srcX === destX + 1 &&
                srcY <= destY &&
                north >= destY &&
                (this.absoluteFlag(srcX, destY, level, privateArea) & BLOCK_EAST) === 0) ||
              (destX >= srcX &&
                destX <= east &&
                srcY === destY - srcSize &&
                (this.absoluteFlag(destX, north, level, privateArea) & BLOCK_SOUTH) === 0)
            );
          case 1:
            return (
              (srcX === destX - srcSize &&
                srcY <= destY &&
                north >= destY &&
                (this.absoluteFlag(east, destY, level, privateArea) & BLOCK_WEST) === 0) ||
              (destX >= srcX && destX <= east && srcY === destY + 1) ||
              (srcX === destX + 1 && srcY <= destY && north >= destY) ||
              (destX >= srcX &&
                destX <= east &&
                srcY === destY - srcSize &&
                (this.absoluteFlag(destX, north, level, privateArea) & BLOCK_SOUTH) === 0)
            );
          case 2:
            return (
              (srcX === destX - srcSize &&
                srcY <= destY &&
                north >= destY &&
                (this.absoluteFlag(east, destY, level, privateArea) & BLOCK_WEST) === 0) ||
              (destX >= srcX &&
                destX <= east &&
                srcY === destY + 1 &&
                (this.absoluteFlag(destX, srcY, level, privateArea) & BLOCK_NORTH) === 0) ||
              (srcX === destX + 1 && srcY <= destY && north >= destY) ||
              (destX >= srcX && destX <= east && srcY === destY - srcSize)
            );
          case 3:
            return (
              (srcX === destX - srcSize && srcY <= destY && north >= destY) ||
              (destX >= srcX &&
                destX <= east &&
                srcY === destY + 1 &&
                (this.absoluteFlag(destX, srcY, level, privateArea) & BLOCK_NORTH) === 0) ||
              (srcX === destX + 1 &&
                srcY <= destY &&
                north >= destY &&
                (this.absoluteFlag(srcX, destY, level, privateArea) & BLOCK_EAST) === 0) ||
              (destX >= srcX && destX <= east && srcY === destY - srcSize)
            );
        }
        break;
      case 9:
        return (
          (destX >= srcX &&
            destX <= east &&
            srcY === destY + 1 &&
            (this.absoluteFlag(destX, srcY, level, privateArea) & BLOCK_NORTH) === 0) ||
          (destX >= srcX &&
            destX <= east &&
            srcY === destY - srcSize &&
            (this.absoluteFlag(destX, north, level, privateArea) & BLOCK_SOUTH) === 0) ||
          (srcX === destX - srcSize &&
            srcY <= destY &&
            north >= destY &&
            (this.absoluteFlag(east, destY, level, privateArea) & BLOCK_WEST) === 0) ||
          (srcX === destX + 1 &&
            srcY <= destY &&
            north >= destY &&
            (this.absoluteFlag(srcX, destY, level, privateArea) & BLOCK_EAST) === 0)
        );
    }
    return false;
  }

  private reachWallDeco1(
    level: number,
    srcX: number,
    srcY: number,
    destX: number,
    destY: number,
    locShape: number,
    locAngle: number,
    privateArea: PrivateArea | null
  ): boolean {
    if (locShape >= 6 && locShape <= 7) {
      const angle = locShape === WALLDECOR_DIAGONAL_NOOFFSET_SHAPE ? (locAngle + 2) & 0x3 : locAngle;
      switch (angle) {
        case 0:
          return (
            (srcX === destX + 1 &&
              srcY === destY &&
              (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_WEST) === 0) ||
            (srcX === destX &&
              srcY === destY - 1 &&
              (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_NORTH) === 0)
          );
        case 1:
          return (
            (srcX === destX - 1 &&
              srcY === destY &&
              (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_EAST) === 0) ||
            (srcX === destX &&
              srcY === destY - 1 &&
              (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_NORTH) === 0)
          );
        case 2:
          return (
            (srcX === destX - 1 &&
              srcY === destY &&
              (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_EAST) === 0) ||
            (srcX === destX &&
              srcY === destY + 1 &&
              (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_SOUTH) === 0)
          );
        case 3:
          return (
            (srcX === destX + 1 &&
              srcY === destY &&
              (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_WEST) === 0) ||
            (srcX === destX &&
              srcY === destY + 1 &&
              (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_SOUTH) === 0)
          );
      }
    } else if (locShape === 8) {
      return (
        (srcX === destX &&
          srcY === destY + 1 &&
          (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_SOUTH) === 0) ||
        (srcX === destX &&
          srcY === destY - 1 &&
          (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_NORTH) === 0) ||
        (srcX === destX - 1 &&
          srcY === destY &&
          (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_EAST) === 0) ||
        (srcX === destX + 1 &&
          srcY === destY &&
          (this.absoluteFlag(srcX, srcY, level, privateArea) & WALL_WEST) === 0)
      );
    }
    return false;
  }

  private reachWallDecoN(
    level: number,
    srcX: number,
    srcY: number,
    destX: number,
    destY: number,
    srcSize: number,
    locShape: number,
    locAngle: number,
    privateArea: PrivateArea | null
  ): boolean {
    const east = srcX + srcSize - 1;
    const north = srcY + srcSize - 1;
    if (locShape >= 6 && locShape <= 7) {
      const angle = locShape === WALLDECOR_DIAGONAL_NOOFFSET_SHAPE ? (locAngle + 2) & 0x3 : locAngle;
      switch (angle) {
        case 0:
          return (
            (srcX === destX + 1 &&
              srcY <= destY &&
              north >= destY &&
              (this.absoluteFlag(srcX, destY, level, privateArea) & WALL_WEST) === 0) ||
            (srcX <= destX &&
              srcY === destY - srcSize &&
              east >= destX &&
              (this.absoluteFlag(destX, north, level, privateArea) & WALL_NORTH) === 0)
          );
        case 1:
          return (
            (srcX === destX - srcSize &&
              srcY <= destY &&
              north >= destY &&
              (this.absoluteFlag(east, destY, level, privateArea) & WALL_EAST) === 0) ||
            (srcX <= destX &&
              srcY === destY - srcSize &&
              east >= destX &&
              (this.absoluteFlag(destX, north, level, privateArea) & WALL_NORTH) === 0)
          );
        case 2:
          return (
            (srcX === destX - srcSize &&
              srcY <= destY &&
              north >= destY &&
              (this.absoluteFlag(east, destY, level, privateArea) & WALL_EAST) === 0) ||
            (srcX <= destX &&
              srcY === destY + 1 &&
              east >= destX &&
              (this.absoluteFlag(destX, srcY, level, privateArea) & WALL_SOUTH) === 0)
          );
        case 3:
          return (
            (srcX === destX + 1 &&
              srcY <= destY &&
              north >= destY &&
              (this.absoluteFlag(srcX, destY, level, privateArea) & WALL_WEST) === 0) ||
            (srcX <= destX &&
              srcY === destY + 1 &&
              east >= destX &&
              (this.absoluteFlag(destX, srcY, level, privateArea) & WALL_SOUTH) === 0)
          );
      }
    } else if (locShape === 8) {
      return (
        (srcX <= destX &&
          srcY === destY + 1 &&
          east >= destX &&
          (this.absoluteFlag(destX, srcY, level, privateArea) & WALL_SOUTH) === 0) ||
        (srcX <= destX &&
          srcY === destY - srcSize &&
          east >= destX &&
          (this.absoluteFlag(destX, north, level, privateArea) & WALL_NORTH) === 0) ||
        (srcX === destX - srcSize &&
          srcY <= destY &&
          north >= destY &&
          (this.absoluteFlag(east, destY, level, privateArea) & WALL_EAST) === 0) ||
        (srcX === destX + 1 &&
          srcY <= destY &&
          north >= destY &&
          (this.absoluteFlag(srcX, destY, level, privateArea) & WALL_WEST) === 0)
      );
    }
    return false;
  }

  private exitStrategy(locShape: number): number {
    if (locShape === -2) {
      return RECTANGLE_EXCLUSIVE_STRATEGY;
    }
    if (locShape === -1) {
      return NO_STRATEGY;
    }
    if ((locShape >= 0 && locShape <= 3) || locShape === 9) {
      return WALL_STRATEGY;
    }
    if (locShape < 9) {
      return WALL_DECO_STRATEGY;
    }
    if ((locShape >= 10 && locShape <= 11) || locShape === 22) {
      return RECTANGLE_STRATEGY;
    }
    return NO_STRATEGY;
  }

  private canMove(tileFlag: number, blockFlag: number): boolean {
    return (tileFlag & blockFlag) === 0;
  }

  private absoluteFlag(x: number, y: number, level: number, privateArea: PrivateArea | null): number {
    if (!this.getClipping) {
      const { RegionManager } = require("../../../collision/RegionManager");
      this.getClipping = RegionManager.getClipping.bind(RegionManager);
    }
    return this.getClipping(x, y, level, privateArea);
  }

  private flagAt(
    baseX: number,
    baseY: number,
    localX: number,
    localY: number,
    level: number,
    privateArea: PrivateArea | null
  ): number {
    return this.absoluteFlag(baseX + localX, baseY + localY, level, privateArea);
  }

  private appendDirection(x: number, y: number, direction: number, distance: number): void {
    const index = this.index(x, y);
    this.directions[index] = direction;
    this.distances[index] = distance;
    this.validLocalX[this.bufWriterIndex] = x;
    this.validLocalY[this.bufWriterIndex] = y;
    this.bufWriterIndex = (this.bufWriterIndex + 1) & (RING_BUFFER_SIZE - 1);
  }

  private reset(): void {
    this.directions.fill(0);
    this.distances.fill(DISTANCE_SENTINEL);
    this.bufReaderIndex = 0;
    this.bufWriterIndex = 0;
  }

  private index(x: number, y: number): number {
    return x * SEARCH_MAP_SIZE + y;
  }

  private directionAt(x: number, y: number): number {
    return this.directions[this.index(x, y)];
  }

  private distanceAt(x: number, y: number): number {
    return this.distances[this.index(x, y)];
  }
}
