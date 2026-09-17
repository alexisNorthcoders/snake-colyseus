import { Client, Room } from "colyseus.js";
import { cli, Options } from "@colyseus/loadtest";

export async function main(options: Options) {
    const client = new Client(options.endpoint);
    // SnakeRoom.onJoin reads name and colours straight off the options, so a
    // client that joins without them throws before it ever connects.
    const room: Room = await client.joinOrCreate(options.roomName, {
        name: `bot-${Math.floor(Math.random() * 10000)}`,
        colours: { head: "#00ff00", body: "#00ff00", eyes: "#ffffff" },
    });

    console.log("joined successfully!");

    room.onMessage("message-type", (payload) => {
        // logic
    });

    room.onStateChange((state) => {
        console.log("state change:", state);
    });

    room.onLeave((code) => {
        console.log("left");
    });
}

cli(main);
