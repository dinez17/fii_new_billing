import http from "node:http";
import type { Express, Request, Response, NextFunction } from "express";
import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from "prom-client";
import { createLogger } from "./logger.js";

/** One process-wide Prometheus registry with default Node/process metrics. */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["service", "method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

/** Increment on every published/consumed domain event. */
export const domainEvents = new Counter({
  name: "domain_events_total",
  help: "Domain events by topic and kind (published|consumed|dlq)",
  labelNames: ["service", "topic", "kind"],
  registers: [registry],
});

/** Set to the number of messages sitting in a DLQ topic (alerting target). */
export const dlqDepth = new Gauge({
  name: "dlq_depth",
  help: "Messages currently in a DLQ topic",
  labelNames: ["service", "topic"],
  registers: [registry],
});

/** Express middleware that times every request and labels it by route + status. */
export function httpMetrics(service: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const end = httpDuration.startTimer({ service, method: req.method });
    res.on("finish", () => {
      const route = (req.route?.path as string | undefined) ?? req.path ?? "unknown";
      end({ route, status: res.statusCode });
    });
    next();
  };
}

export interface HealthCheck { name: string; check: () => Promise<void>; }

async function runChecks(checks: HealthCheck[]): Promise<{ ok: boolean; failed: string[] }> {
  const results = await Promise.allSettled(checks.map((c) => c.check()));
  const failed = results.map((r, i) => ({ r, name: checks[i].name })).filter((x) => x.r.status === "rejected").map((x) => x.name);
  return { ok: failed.length === 0, failed };
}

/**
 * Adds /readyz (runs the given checks → 200/503) and /metrics (Prometheus)
 * to an Express service. Services keep their own /healthz liveness route.
 */
export function mountOps(app: Express, opts: { name: string; checks?: HealthCheck[] }): void {
  const checks = opts.checks ?? [];
  app.get("/readyz", (_req, res) => {
    void runChecks(checks).then((r) => res.status(r.ok ? 200 : 503).json({ ok: r.ok, service: opts.name, failed: r.failed }));
  });
  app.get("/metrics", (_req, res) => {
    void registry.metrics().then((m) => { res.setHeader("Content-Type", registry.contentType); res.end(m); });
  });
}

/** Minimal ops HTTP server for workers (which have no Express app). */
export function startOpsServer(opts: { name: string; port: number; checks?: HealthCheck[] }): () => void {
  const log = createLogger(opts.name);
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: opts.name }));
    } else if (req.url === "/readyz") {
      void runChecks(opts.checks ?? []).then((r) => {
        res.writeHead(r.ok ? 200 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: r.ok, service: opts.name, failed: r.failed }));
      });
    } else if (req.url === "/metrics") {
      void registry.metrics().then((m) => { res.writeHead(200, { "content-type": registry.contentType }); res.end(m); });
    } else {
      res.writeHead(404); res.end();
    }
  });
  server.listen(opts.port, () => log.info({ port: opts.port }, `${opts.name} ops endpoint listening`));
  return () => server.close();
}
