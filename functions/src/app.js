import cors from "cors";
import express from "express";
import { query } from "./db/pool.js";
import lutsRouter from "./routes/luts.js";
import presetsRouter from "./routes/presets.js";
import projectsRouter from "./routes/projects.js";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

// Normalize Firebase Hosting rewrite prefix (/api/* -> /*) when invoked behind Hosting
app.use((req, _res, next) => {
  if (req.url === "/api" || req.url.startsWith("/api/")) {
    req.url = req.url.slice(4) || "/";
  }
  next();
});

/** Health check verifying API & PostgreSQL connectivity */
app.get("/health", async (_req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(200).json({ ok: true, db: "unconfigured" });
  }
  try {
    await query("SELECT 1");
    return res.status(200).json({ ok: true, db: "connected" });
  } catch (err) {
    return res.status(503).json({ ok: false, db: "error", message: err.message });
  }
});

app.use("/v1/projects", projectsRouter);
app.use("/v1/presets", presetsRouter);
app.use("/v1/luts", lutsRouter);

// Centralized JSON error handler
app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  res.status(status).json({
    error: status >= 500 ? "Internal server error" : err.message,
  });
});

export default app;
