import http from "node:http";
import { MemoryEngine } from "../core/engine";
import { GraphExporter } from "../visualization/exporter";
import { ThreeJSGraphRenderer } from "../visualization/threejs_renderer";
import { Server as SocketIOServer } from "socket.io";

export interface WebDashboardHandle {
  server: http.Server;
  ready: Promise<{ host: "127.0.0.1"; port: number; origin: string }>;
  close(): Promise<void>;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://unpkg.com; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

export function serveWebDashboard(
  engine: MemoryEngine,
  port = 3000,
  host: "127.0.0.1" = "127.0.0.1"
): WebDashboardHandle {
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      const references = engine.getLegacyEvidenceReferences();
      let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fractal Memory — Legacy Evidence References</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:20px;background:#121212;color:#fff}.reference{border:1px solid #333;padding:15px;margin-bottom:20px;border-radius:8px;background:#1e1e1e}.badge{display:inline-block;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:bold;background:#6b7280}</style>
</head><body><h1>Unverified Legacy Evidence References</h1>
<p>Compatibility references only. These records are not SAG receipts and do not establish an evidence level.</p>
<a href="/graph">Open live 3D graph</a>`;

      if (references.length === 0) html += "<p>No legacy references found.</p>";
      for (const reference of references) {
        const date = Number.isFinite(reference.createdAt)
          ? new Date(reference.createdAt).toISOString()
          : "invalid timestamp";
        html += `<div class="reference">
<span class="badge">${escapeHtml(reference.evidenceStatus)}</span>
<h3>${escapeHtml(reference.incidentType)}</h3>
<p><strong>ID:</strong> ${escapeHtml(reference.id)}</p>
<p><strong>Target framework:</strong> ${escapeHtml(reference.targetFramework || "N/A")}</p>
<p><strong>Timestamp:</strong> ${escapeHtml(date)}</p>
</div>`;
      }
      html += "</body></html>";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() });
      res.end(html);
      return;
    }

    if (req.url === "/graph") {
      const renderer = new ThreeJSGraphRenderer();
      const html = renderer.generateLiveHtml("Knowledge Graph 3D");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() });
      res.end(html);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders() });
    res.end("Not Found");
  });

  let expectedOrigin: string | undefined;
  const io = new SocketIOServer(server, {
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, origin === undefined || (expectedOrigin !== undefined && origin === expectedOrigin));
    },
  });

  io.on("connection", (socket) => {
    const exporter = new GraphExporter(engine);
    socket.emit("graph-update", exporter.getGraphData());
  });

  (engine as any).broadcastGraphUpdate = () => {
    const exporter = new GraphExporter(engine);
    io.emit("graph-update", exporter.getGraphData());
  };

  server.on("error", (error) => {
    console.error(`[memory] Dashboard server error: ${error.message}`);
  });
  const ready = new Promise<{ host: "127.0.0.1"; port: number; origin: string }>((resolve, reject) => {
    const onStartupError = (error: Error) => reject(error);
    server.once("error", onStartupError);
    server.listen(port, host, () => {
      server.off("error", onStartupError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Dashboard did not expose a TCP listener address"));
        return;
      }
      expectedOrigin = `http://${host}:${address.port}`;
      console.log(`\n🌐 Web dashboard running at ${expectedOrigin}\n`);
      resolve({ host, port: address.port, origin: expectedOrigin });
    });
  });

  let closed = false;
  return {
    server,
    ready,
    close: async () => {
      if (closed) return;
      closed = true;
      delete (engine as any).broadcastGraphUpdate;
      await new Promise<void>((resolve, reject) => {
        io.close(() => {
          if (!server.listening) return resolve();
          server.close((error) => error ? reject(error) : resolve());
        });
      });
    },
  };
}
