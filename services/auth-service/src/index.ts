import express from "express";
import helmet from "helmet";
import { httpMetrics, mountOps } from "@fii/common";
import { prisma } from "@fii/database";
import { errorHandler, log } from "./http.js";
import { authRouter } from "./routes/auth.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { rolesRouter } from "./routes/roles.routes.js";
import { auditRouter } from "./routes/audit.routes.js";
import { platformRouter } from "./routes/platform.routes.js";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", 1);
app.use(httpMetrics("auth-service"));

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "auth-service" }));
mountOps(app, { name: "auth-service", checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/roles", rolesRouter);
app.use("/api/v1/audit-logs", auditRouter);
app.use("/api/v1/platform/tenants", platformRouter);

app.use(errorHandler);

const port = Number(process.env.AUTH_SERVICE_PORT ?? 8081);
app.listen(port, () => log.info({ port }, "auth-service listening"));
