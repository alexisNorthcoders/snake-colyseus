import { Schema, type } from "@colyseus/schema";
import { PlayerColors } from "./PlayerColors";
import { Snake } from "./SnakeState";

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
    }
}