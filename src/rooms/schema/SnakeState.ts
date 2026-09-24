import { Schema, ArraySchema, type } from "@colyseus/schema";
import { DirectionVector } from "../../contants";
import { Cell, gameConfig } from "../../gameConfig";

export class Coordinates extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;

    constructor(x: number = 0, y: number = 0) {
        super();
        this.x = x;
        this.y = y;
    }
}

/**
 * The tail is a ring buffer, so a tick rewrites one segment instead of
 * shifting every one of them along — which would put the whole tail in the
 * patch. `tailCursor` is the slot holding the oldest segment, the next one to
 * be overwritten; walking forward from it runs oldest to newest, wrapping
 * round. Clients read it back with `tailCells`.
 */
export class Snake extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    // Ring order, not body order: change it only through the methods below,
    // or the cursor stops pointing at the oldest segment.
    @type([Coordinates]) tail = new ArraySchema<Coordinates>();
    @type("number") tailCursor: number = 0;
    @type("boolean") isDead: boolean = false;
    @type("number") score: number = 0;
    @type("number") size: number = 0;
    @type(Coordinates) direction: Coordinates = new Coordinates();
    @type("string") playerId: string = "";

    // Server-only, not synced: the direction the snake last actually moved in,
    // which a turn is checked against. `direction` holds the latest key, and
    // two keys inside one tick could otherwise add up to a reversal.
    movedDirection: DirectionVector = { x: 0, y: 0 };

    /** Replaces the whole tail with `cells`, given newest first. */
    setTail(cells: Cell[]) {
        this.tail.splice(0, this.tail.length);
        this.writeOldestFirst(cells);
    }

    /** Moves the tail up behind the head, which has just left `vacated`. */
    advanceTail(vacated: Cell) {
        if (this.tail.length === 0) return;

        const oldest = this.tail[this.tailCursor];
        oldest.x = vacated.x;
        oldest.y = vacated.y;
        this.tailCursor = (this.tailCursor + 1) % this.tail.length;
    }

    /**
     * Adds a segment on top of the tail's last one, or on the head for a snake
     * with no tail yet. The array can't take an insert mid-ring, so the tail
     * is first rewritten oldest first from slot 0 — O(length), but only once
     * per pellet — and the new segment appended as the oldest of all.
     */
    growTail() {
        const cells = tailCells(this);
        const end = cells[cells.length - 1] ?? { x: this.x, y: this.y };

        if (this.tailCursor !== 0) this.writeOldestFirst(cells);

        this.tail.push(new Coordinates(end.x, end.y));
        this.tailCursor = this.tail.length - 1;
    }

    /**
     * Lays `cells`, given newest first, into the ring oldest first from slot
     * 0 — reusing the slots already there, adding any that are missing — and
     * points the cursor at slot 0.
     */
    private writeOldestFirst(cells: Cell[]) {
        [...cells].reverse().forEach(({ x, y }, i) => {
            const slot = this.tail[i];
            if (!slot) {
                this.tail.push(new Coordinates(x, y));
                return;
            }
            slot.x = x;
            slot.y = y;
        });
        this.tailCursor = 0;
    }
}

/**
 * A snake's tail cells in body order, newest (next to the head) first, as
 * copies rather than the live segments. Takes anything shaped like a snake, so
 * it reads a client's decoded copy as well.
 */
export const tailCells = ({ tail, tailCursor }: { tail: ArrayLike<Cell>; tailCursor: number }): Cell[] => {
    const { length } = tail;
    return Array.from({ length }, (_, i) => {
        const { x, y } = tail[(tailCursor - 1 - i + length) % length];
        return { x, y };
    });
};

export class PlayerColors extends Schema {
    @type("string") head: string;
    @type("string") body: string;
    @type("string") eyes: string;

    constructor(head?: string, body?: string, eyes?: string) {
        super();
        this.head = head || "#ffffff";
        this.body = body || "#ffffff";
        this.eyes = eyes || "#ffffff";
    }
}

export class Player extends Schema {
    @type("string") id: string;
    @type("string") name: string;
    @type(PlayerColors) colours: PlayerColors;
    @type(Snake) snake: Snake;
    // A virtual player run by the server: no socket, no client.
    @type("boolean") isBot: boolean = false;

    constructor(id: string, name: string, colours: PlayerColors) {
        super();
        this.id = id;
        this.name = name;
        this.colours = colours;
        this.snake = new Snake();
        this.snake.playerId = id;  // Set the snake's playerId too
    }
}

export class Food extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("number") index: number = 0;
    @type("string") type: string = "redApple";
}

export type Phase = "lobby" | "countdown" | "playing" | "ended";

export class GameState extends Schema {
    @type("string") phase: Phase = "lobby";
    @type("number") countdown: number = 0;
    // Length of one simulation tick in ms, fixed at room creation, so clients can pace their animation.
    @type("number") tickMs: number = 1000 / gameConfig.fps;
    // Seed of the room's rule RNG, fixed at room creation, so the room's food can be replayed from it.
    @type("number") seed: number = 0;
    @type("number") aliveCount: number = 0;
    @type("number") backgroundNumber: number = 0;
    @type([Player]) players = new ArraySchema<Player>();
    @type([Food]) foodCoordinates = new ArraySchema<Food>();
}