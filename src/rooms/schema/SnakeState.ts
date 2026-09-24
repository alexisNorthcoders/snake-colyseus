import { Schema, ArraySchema, type } from "@colyseus/schema";
import { DirectionVector } from "../../contants";
import { Cell, gameConfig } from "../../gameConfig";
import { advanceTail, growTail, setTail } from "../../engine/tail";

export { tailCells } from "../../engine/tail";

export class Coordinates extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;

    constructor(x: number = 0, y: number = 0) {
        super();
        this.x = x;
        this.y = y;
    }
}

const newCoordinates = (x: number, y: number) => new Coordinates(x, y);

/**
 * The tail is a ring buffer laid out by the engine's tail functions (see
 * `engine/tail`); the methods below only delegate to them. Clients read it
 * back with `tailCells`.
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
    setTail(cells: Cell[]) { setTail(this, cells, newCoordinates); }

    /** Moves the tail up behind the head, which has just left `vacated`. */
    advanceTail(vacated: Cell) { advanceTail(this, vacated); }

    /** Adds a segment on top of the tail's last one, or on the head. */
    growTail() { growTail(this, newCoordinates); }
}

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