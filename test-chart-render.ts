import { renderHtmlToImage, closeRenderer } from "./src/canvas/renderer.js";
import fs from "fs";

const mockChartPayload = JSON.stringify({
    type: "doughnut",
    data: {
        labels: ["Geral", "Moradia", "Alimentação"],
        datasets: [{
            data: [2236.14, 610.0, 19.0],
            backgroundColor: ["#FF6384", "#36A2EB", "#FFCE56"],
            borderWidth: 2,
            borderColor: "#1a1a2e"
        }]
    },
    options: {
        plugins: {
            title: {
                display: true,
                text: "TESTE DE GASTOS",
                color: "#fff",
                font: { size: 18, weight: "bold" }
            },
            legend: {
                position: "bottom",
                labels: { color: "#fff", font: { size: 14 } }
            }
        }
    }
});

async function runTest() {
    console.log("📸 Testing chart rendering...");
    try {
        const buffer = await renderHtmlToImage(mockChartPayload, "chart");
        fs.writeFileSync("test-chart-output.png", buffer);
        console.log("✅ Chart rendered successfully to test-chart-output.png");
    } catch (e) {
        console.error("❌ Chart rendering failed:", e);
    } finally {
        await closeRenderer();
    }
}

runTest();
