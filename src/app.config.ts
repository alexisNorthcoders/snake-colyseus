import config from "@colyseus/tools";
import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";

/**
 * Import your Room files
 */
import { SnakeRoom } from "./rooms/SnakeRoom";
import { modeOf } from "./engine";

export default config({
    initializeGameServer: (gameServer) => {
        /**
         * Define your room handlers:
         */
        // Rooms are matched by speed and mode: a joinOrCreate never lands in a
        // room at another speed or of another mode.
        const snake = gameServer.define('snake', SnakeRoom).filterBy(['speed', 'mode']);
        // A missing option is left out of the filter, so a join that sends no
        // mode would match rooms of every mode. The mode is always filled in
        // instead, the way the room reads it, for the room's listing and for
        // every join alike: a modeless client only ever meets timed rooms.
        const filterOptions = snake.getFilterOptions.bind(snake);
        snake.getFilterOptions = (options) => ({ ...filterOptions(options), mode: modeOf(options?.mode) });
    },
    initializeExpress: (app) => {
        /**
         * Bind your custom express routes here:
         * Read more: https://expressjs.com/en/starter/basic-routing.html
         */
        app.get("/hello_world", (req, res) => {
            res.send("It's time to kick ass and chew bubblegum!");
        });

        /**
         * Use @colyseus/playground
         * (It is not recommended to expose this route in a production environment)
         */
        if (process.env.NODE_ENV !== "production") {
            app.use("/", playground());
        }

        /**
         * Use @colyseus/monitor
         * It is recommended to protect this route with a password
         * Read more: https://docs.colyseus.io/tools/monitor/#restrict-access-to-the-panel-using-a-password
         */
        app.use("/monitor", monitor());
    },


    beforeListen: () => {
        /**
         * Before before gameServer.listen() is called.
         */
    }
});
