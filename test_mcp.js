import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function main() {
  const transport = new SSEClientTransport(new URL("http://localhost:5446/mcp/sse"));
  const client = new Client({
    name: "test-client",
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  console.log("Connected to MCP server!");

  const tools = await client.listTools();
  console.log("Available tools:", tools.tools.map(t => t.name));

  const health = await client.callTool({
    name: "get_fleet_status",
    arguments: {}
  });

  console.log("Fleet status result:", health.content[0].text);
  process.exit(0);
}

main().catch(console.error);
