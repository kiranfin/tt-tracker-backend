import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({
    logger: true
});

await app.register(cors, {
    origin: true
});

app.get("/health", async () => {
    return {
        ok: true,
        service: "tt-tracker-api"
    };
});

const port = Number(process.env.PORT ?? 4001);

try {
    await app.listen({
        port,
        host: "127.0.0.1"
    });

    app.log.info(`Server läuft auf http://127.0.0.1:${port}`);
} catch (error) {
    app.log.error(error);
    process.exit(1);
}