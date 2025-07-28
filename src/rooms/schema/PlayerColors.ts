import { Schema, type } from "@colyseus/schema";

export class PlayerColors extends Schema {
    @type("string") head: string;
    @type("string") body: string;
    @type("string") eyes: string;

    constructor(head: string = "#00FF00", body: string = "#008000", eyes: string = "#FFFFFF") {
        super();
        this.head = head;
        this.body = body;
        this.eyes = eyes;
    }
}