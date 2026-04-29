import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

// Create MCP Server
const mcpServer = new McpServer({
  name: "krusch-infra-mcp",
  version: "1.0.0"
});

// Tool: get_fleet_status
mcpServer.tool(
  "get_fleet_status",
  "Pings known homelab nodes to verify network mesh integrity and availability.",
  {
    nodes: z.array(z.string()).optional().describe("Optional list of hostnames or IPs to ping. Defaults to standard fleet (kruschserv, kruschgame, kruschdev).")
  },
  async ({ nodes = ["kruschserv", "kruschgame", "kruschdev"] }) => {
    const results = [];
    for (const node of nodes) {
      try {
        // -c 1 = 1 packet, -W 1 = 1 second timeout
        await execAsync(`ping -c 1 -W 1 ${node}`);
        results.push({ node, status: "online" });
      } catch (err) {
        results.push({ node, status: "offline", error: err.message });
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
);

// Tool: get_container_health
mcpServer.tool(
  "get_container_health",
  "Executes 'docker ps' to return real-time status, uptime, and port mappings of running containers.",
  {},
  async () => {
    try {
      // Check if user has permission to run docker without sudo
      const { stdout } = await execAsync("docker ps --format '{{json .}}'");
      
      // Output is one JSON object per line
      const containers = stdout.trim().split("\\n").filter(Boolean).map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);

      return {
        content: [{ type: "text", text: JSON.stringify(containers, null, 2) }]
      };
    } catch (err) {
      return { 
        content: [{ type: "text", text: `Failed to fetch container health. Ensure the user is in the 'docker' group. Error: ${err.message}` }],
        isError: true 
      };
    }
  }
);

// Tool: tail_logs
mcpServer.tool(
  "tail_logs",
  "Securely wraps 'docker-compose logs' for a specific project directory to diagnose crashes.",
  {
    project_path: z.string().describe("Absolute path to the project directory containing docker-compose.yml"),
    service: z.string().optional().describe("Optional specific service name to tail. If omitted, tails all services in the compose file."),
    tail_count: z.number().default(50).describe("Number of lines to tail (default 50)")
  },
  async ({ project_path, service = "", tail_count = 50 }) => {
    try {
      // Sanitize inputs
      const safeService = service.replace(/[^a-zA-Z0-9_-]/g, "");
      
      // Verify docker-compose.yml exists to prevent arbitrary directory execution
      const composePath = path.join(project_path, "docker-compose.yml");
      try {
        await fs.access(composePath);
      } catch {
        return { content: [{ type: "text", text: `No docker-compose.yml found at ${project_path}` }], isError: true };
      }

      const { stdout, stderr } = await execAsync(`docker-compose logs --tail=${tail_count} ${safeService}`, { cwd: project_path });
      
      return {
        content: [{ type: "text", text: stdout || stderr || "No logs found." }]
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed to tail logs: ${err.message}` }], isError: true };
    }
  }
);

// Tool: restart_service
mcpServer.tool(
  "restart_service",
  "Safely executes 'docker-compose restart <service>' to recover from deadlocks. Destructive actions (down/rm) are explicitly blocked.",
  {
    project_path: z.string().describe("Absolute path to the project directory containing docker-compose.yml"),
    service: z.string().optional().describe("Optional specific service name to restart. If omitted, restarts all services in the compose file.")
  },
  async ({ project_path, service = "" }) => {
    try {
      // Sanitize inputs
      const safeService = service.replace(/[^a-zA-Z0-9_-]/g, "");
      
      // Verify docker-compose.yml exists
      const composePath = path.join(project_path, "docker-compose.yml");
      try {
        await fs.access(composePath);
      } catch {
        return { content: [{ type: "text", text: `No docker-compose.yml found at ${project_path}` }], isError: true };
      }

      // Security check: Hardcoded block against restarting critical DB infrastructure from this generic tool if it matches certain names
      if (safeService === "kruschdb" || safeService.includes("postgres")) {
         return { content: [{ type: "text", text: `Security Policy: Restarting core database services ('${safeService}') is blocked via Infra MCP.` }], isError: true };
      }

      const { stdout, stderr } = await execAsync(`docker-compose restart ${safeService}`, { cwd: project_path });
      
      return {
        content: [{ type: "text", text: `Restart successful. Output: ${stdout || stderr}` }]
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed to restart service: ${err.message}` }], isError: true };
    }
  }
);

// Start Server
async function main() {
  const port = process.env.PORT;

  if (port) {
    // Standalone SSE Mode
    const app = express();
    app.use(cors());
    
    let transport;
    
    app.get("/mcp/sse", async (req, res) => {
      transport = new SSEServerTransport("/mcp/messages", res);
      await mcpServer.connect(transport);
      console.log("New SSE client connected");
    });
    
    app.post("/mcp/messages", express.json(), async (req, res) => {
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(503).send("No active SSE connection");
      }
    });

    app.listen(port, () => {
      console.log(\`Krusch Infra MCP running in Standalone SSE mode on http://localhost:\${port}\`);
    });
  } else {
    // Standard Stdio Mode
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("Krusch Infra MCP Server running on stdio");
  }
}

main().catch(console.error);
