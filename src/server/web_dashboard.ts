import http from "node:http";
import { MemoryEngine } from "../core/engine";

export function serveWebDashboard(engine: MemoryEngine, port = 3000) {
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      const receipts = (engine as any).db.getReceipts();
      
      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Antigravity Memory OS - Visual Timeline</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #121212; color: #fff; }
            .receipt { border: 1px solid #333; padding: 15px; margin-bottom: 20px; border-radius: 8px; background: #1e1e1e; }
            img { max-width: 100%; border-radius: 4px; margin-top: 10px; border: 1px solid #444; }
            .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; margin-bottom: 8px; }
            .l1 { background: #3b82f6; }
            .l2 { background: #8b5cf6; }
            .l3 { background: #ef4444; }
            .l4 { background: #10b981; }
            .l5 { background: #f59e0b; }
          </style>
        </head>
        <body>
          <h1>SAG Receipts Visual Timeline</h1>
          <p>Cross-modal evidence anchoring for Causal Memory.</p>
      `;

      if (receipts.length === 0) {
        html += `<p>No receipts found in the database.</p>`;
      }

      for (const r of receipts) {
        const date = new Date(r.createdAt).toLocaleString();
        html += `
          <div class="receipt">
            <span class="badge ${r.level.toLowerCase()}">${r.level}</span>
            <h3>${r.incidentType}</h3>
            <p><strong>ID:</strong> ${r.id}</p>
            <p><strong>Target Framework:</strong> ${r.targetFramework || 'N/A'}</p>
            <p><strong>Timestamp:</strong> ${date}</p>
        `;
        if (r.b64Evidence) {
          html += `<img src="data:image/png;base64,${r.b64Evidence}" alt="Evidence Screenshot" />`;
        }
        html += `</div>`;
      }

      html += `
        </body>
        </html>
      `;

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${port} is in use, trying ${port + 1}...`);
      serveWebDashboard(engine, port + 1);
    }
  });

  server.listen(port, () => {
    console.log(`\n🌐 Web Timeline Dashboard running at http://localhost:${port}\n`);
  });
}
