import express from "express";
import { hostname as _hostname } from "os";

const PORT = process.env.PORT ?? 3000;
export const app = express();

app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
        console.log(JSON.stringify({
            ts: new Date().toISOString(),
            method: req.method,
            path: req.path,
            status: res.statusCode,
            ms: Date.now() - start,
            host: _hostname(),
        }));
    });
    next();
});

app.get("/", (req, res) => {
    res.json({ hostname: _hostname() });
});

app.get("/health", (req, res) => {
    res.json({ status: "OK" });
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`API listening on http://0.0.0.0:${PORT}`);
    });
}