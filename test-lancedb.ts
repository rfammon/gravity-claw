import { rag } from "./src/rag-provider.js";

async function test() {
    console.log("🧪 Testing LanceDB integration...");
    try {
        // We'll try to add a fact. This requires Ollama to be running for embeddings.
        await rag.addFact("test-user", "Rafael mora na Praia Grande e trabalha com Geoprocessamento.", { source: "test" });
        console.log("✅ Fact added.");
        
        const results = await rag.searchFacts("test-user", "Onde o Rafael mora?");
        console.log("🔍 Search results:", results);
        
        if (results.some(r => r.includes("Praia Grande"))) {
            console.log("🎉 SUCCESS: Semantic search returned the correct fact!");
        } else {
            console.log("⚠️ Search returned results but maybe not the best match.");
        }
    } catch (err) {
        console.error("❌ Test failed. Is Ollama running?");
        console.error(err);
    }
}

test();
