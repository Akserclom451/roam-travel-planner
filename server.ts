import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRazorpayRouter } from "./server/razorpay";

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

  app.use(express.json());

  // Register Razorpay sandbox API endpoints
  app.use("/api/razorpay", createRazorpayRouter());

  const isProduction = process.env.NODE_ENV === "production";

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

  const port = Number(process.env.PORT) || 3000;

  server.listen(port, "0.0.0.0", () => {
    console.log(`ROAM server running on http://0.0.0.0:${port}/`);
  });

  return { app, server };
}

startServer().catch(console.error);
