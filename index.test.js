import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "./index.js";

test("GET / returns a hostname", async () => {
    const res = await request(app).get("/");
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.hostname === "string");
    assert.ok(res.body.hostname.length > 0);
});

test("GET /health returns OK", async () => {
    const res = await request(app).get("/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "OK" });
});

test("GET /unknown returns 404", async () => {
    const res = await request(app).get("/unknown");
    assert.equal(res.status, 404);
});
