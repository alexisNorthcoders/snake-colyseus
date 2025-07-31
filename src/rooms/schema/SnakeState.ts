import { Schema, ArraySchema, type } from "@colyseus/schema";

export class Coordinates extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;

    constructor(x: number = 0, y: number = 0) {
        super();
        this.x = x;
        this.y = y;
    }
}

export class Snake extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type([Coordinates]) tail: Coordinates[] = [];
    @type("boolean") isDead: boolean = false;
    @type("number") score: number = 0;
    @type("number") size: number = 0;
    @type(Coordinates) speed: Coordinates = new Coordinates();
    @type(Coordinates) direction: Coordinates = new Coordinates();  // Changed to use Coordinates
    @type("string") type: string = "player";
    @type("string") playerId: string = "";
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
    @type("string") type: string = "player";
    @type(PlayerColors) colours: PlayerColors;
    @type(Snake) snake: Snake;

    constructor(id: string, name: string, colours: PlayerColors) {
        super();
        this.id = id;
        this.name = name;
        this.colours = colours;
        this.snake = new Snake();
        this.snake.playerId = id;  // Set the snake's playerId too
        this.snake.type = "player";
    }
}

export class Food extends Schema {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("number") index: number = 0;
    @type("string") type: string = "redApple";
}

export class GameState extends Schema {
    @type("boolean") hasGameStarted: boolean = false;
    @type("number") nextPositionIndex: number = 0;
    @type("number") aliveCount: number = 0;
    @type([Player]) players = new ArraySchema<Player>();
    @type([Food]) foodCoordinates = new ArraySchema<Food>();
}