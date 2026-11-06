import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRazorpayRouter, parseTrustProxy } from "./server/razorpay";

try {
  process.loadEnvFile?.();
} catch {
  // Non-fatal if .env does not exist
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startServer() {
  const app = express();
  const server = createServer(app);

  const isProduction = process.env.NODE_ENV === "production";

  // Configure reverse proxy trust safely based on environment and TRUST_PROXY
  const trustProxySetting = parseTrustProxy(process.env.TRUST_PROXY, isProduction);
  app.set("trust proxy", trustProxySetting);

  app.use(express.json());

  // Register Razorpay sandbox API endpoints
  app.use("/api/razorpay", createRazorpayRouter());

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      configFile: path.resolve(__dirname, "vite.config.ts"),
    });
    app.use(vite.middlewares);
  } else {
    const staticPath = path.resolve(__dirname, "dist", "public");
    app.use(express.static(staticPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(staticPath, "index.html"));
    });
  }

  // In development, the app server must run on port 3000 behind the NGINX proxy (port 8080).
  // Only production deployments should bind directly to process.env.PORT.
  const port = isProduction ? Number(process.env.PORT) || 8080 : 3000;

  server.listen(port, "0.0.0.0", () => {
    console.log(`ROAM server running on http://0.0.0.0:${port}/`);
  });

  return { app, server };
}

startServer().catch(console.error);
