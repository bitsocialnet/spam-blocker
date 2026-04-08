import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/index.js";
import {
    resetPkcLoaderForTest as resetCommunityLoaderForTest,
    setPkcLoaderForTest as setCommunityLoaderForTest
} from "../src/community-resolver.js";

afterEach(() => {
    resetCommunityLoaderForTest();
});

describe("community client access", () => {
    it("exposes a shared community client on the fastify server", async () => {
        const destroy = vi.fn().mockResolvedValue(undefined);
        const instance = { destroy, getCommunity: vi.fn() };
        setCommunityLoaderForTest(async () => instance);

        const server = await createServer({
            port: 0,
            logging: false,
            databasePath: ":memory:"
        });

        await server.fastify.ready();

        const communityClient = await server.fastify.getPkcInstance();
        expect(communityClient).toBe(instance);

        await server.stop();
        expect(destroy).toHaveBeenCalledTimes(1);
    });
});
