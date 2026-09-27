import { Schema, ArraySchema, type } from "@colyseus/schema";
import { Cell, DirectionVector, FoodPlacement, GameMode, advanceTail, growTail, rulesConfig, setTail } from "../../engine";
import { gameConfig } from "../../gameConfig";

// Re-exported so readers of the schema keep one import for the tail's body order.
export { tailCells } from "../../engine";

export class Coordinates extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;

    constructor(x: number = 0, y: number = 0) {
        super();
        this.x = x;
        this.y = y;
    }
}

export const newCoordinates = (x: number, y: number) => new Coordinates(x, y);

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
    // Ticks since the snake last ate. Counted in an endless round only: the
    // score starts draining once it reaches the game's `hungerTicks`.
    @type("number") hunger: number = 0;
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

/** A synced pellet from a placement the engine picked. */
export const newFood = ({ x, y, index, type }: FoodPlacement) => {
    const food = new Food();
    food.x = x;
    food.y = y;
    food.index = index;
    food.type = type;
    return food;
};

export type Phase = "lobby" | "countdown" | "playing" | "ended";

export class GameState extends Schema {
    @type("string") phase: Phase = "lobby";
    @type("number") countdown: number = 0;
    // The kind of round the room plays, fixed at room creation.
    @type("string") mode: GameMode = "timed";
    // Length of one simulation tick in ms, fixed at room creation, so clients can pace their animation.
    @type("number") tickMs: number = 1000 / gameConfig.fps;
    // Seed of the room's rule RNG, fixed at room creation, so the room's food can be replayed from it.
    @type("number") seed: number = 0;
    @type("number") aliveCount: number = 0;
    // Ticks left in a timed round, counted down each tick; this times `tickMs` is the ms left. Unused in an endless round.
    @type("number") ticksLeft: number = 0;
    // The ticks a timed round started with, so clients can show the time left as a fraction of it.
    @type("number") tickLimit: number = 0;
    // Ticks a snake can go without food before its score starts draining in
    // an endless round, so clients know when to show the hunger bar.
    @type("number") hungerTicks: number = rulesConfig.hungerTicks;
    @type("number") backgroundNumber: number = 0;
    @type([Player]) players = new ArraySchema<Player>();
    @type([Food]) foodCoordinates = new ArraySchema<Food>();
}