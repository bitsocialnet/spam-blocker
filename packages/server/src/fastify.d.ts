import "fastify";
import type PKC from "@pkcprotocol/pkc-js";

type PkcInstance = Awaited<ReturnType<typeof PKC>>;

declare module "fastify" {
    interface FastifyInstance {
        getPkcInstance: () => Promise<PkcInstance>;
    }
}
