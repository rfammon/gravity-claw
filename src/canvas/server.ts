import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.CANVAS_WS_PORT ? parseInt(process.env.CANVAS_WS_PORT) : 8081;
let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function startCanvasServer() {
    if (wss) return;

    try {
        wss = new WebSocketServer({ port: PORT });

        wss.on("connection", (ws) => {
            console.log("🎨 Live Canvas client connected");
            clients.add(ws);

            ws.on("close", () => {
                console.log("🎨 Live Canvas client disconnected");
                clients.delete(ws);
            });

            ws.on("error", (err) => {
                console.error("🎨 Live Canvas WS error:", err);
            });

            // Allow receiving generic events from canvas
            ws.on("message", (msg) => {
                const text = msg.toString();
                console.log("🎨 Received from Canvas:", text);
            });
        });

        console.log(`🎨 Live Canvas WebSocket server running on ws://localhost:${PORT}`);
    } catch (err) {
        console.error("❌ Failed to start Live Canvas WebSocket server:", err);
    }
}

export function broadcastToCanvas(payload: any): boolean {
    if (!wss) {
        console.warn("⚠️ Live Canvas server not running. Cannot broadcast.");
        return false;
    }

    if (clients.size === 0) {
        console.warn("⚠️ No Live Canvas clients connected to receive push.");
        return false;
    }

    const message = JSON.stringify(payload);
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }

    return true;
}
