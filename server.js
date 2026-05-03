import "dotenv/config";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ── Configuration ────────────────────────────────────────────────────────────

/** Maximum time (ms) any shell command is allowed to run before being killed. */
const EXEC_TIMEOUT_MS = 15_000;

/** Strict hostname/IP validation pattern (alphanumeric, dots, hyphens, colons for IPv6). */
const HOST_RE = /^[a-zA-Z0-9._:-]+$/;

/**
 * Allowlist of project directories that tools are permitted to operate on.
 * Resolved to absolute paths at runtime. Add entries here to authorize new projects.
 * Set via ALLOWED_PROJECT_PATHS env var (colon-separated) or fall back to defaults.
 */
const ALLOWED_PROJECT_PATHS = (process.env.ALLOWED_PROJECT_PATHS || "")
  .split(":")
  .map(p => p.trim())
  .filter(Boolean);

/**
 * Services that are hard-blocked from being restarted.
 * Checked case-insensitively. Any service whose name contains one of these tokens is blocked.
 */
const BLOCKED_SERVICE_TOKENS = ["kruschdb", "postgres", "prod_db"];

// ── Compose Command Detection ────────────────────────────────────────────────

/** Detect whether the host has `docker compose` (v2) or legacy `docker-compose` (v1). */
let composeCommand = "docker compose"; // modern default

async function detectComposeCommand() {
  try {
    await execAsync("docker compose version", { timeout: 5000 });
    composeCommand = "docker compose";
  } catch {
    try {
      await execAsync("docker-compose version", { timeout: 5000 });
      composeCommand = "docker-compose";
    } catch {
      console.error("WARNING: Neither 'docker compose' nor 'docker-compose' found. Compose tools will fail.");
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validates that a given project_path is within the allowlist and contains a docker-compose.yml.
 * Returns an error response object if validation fails, or null if valid.
 */
async function validateProjectPath(projectPath) {
  const resolved = path.resolve(projectPath);

  // If an allowlist is configured, enforce it
  if (ALLOWED_PROJECT_PATHS.length > 0) {
    const allowed = ALLOWED_PROJECT_PATHS.some(
      ap => resolved === path.resolve(ap) || resolved.startsWith(path.resolve(ap) + path.sep)
    );
    if (!allowed) {
      return {
        content: [{ type: "text", text: `Security Policy: Path '${resolved}' is not in the allowed project paths.` }],
        isError: true
      };
    }
  }

  // Verify docker-compose.yml exists
  const composePath = path.join(resolved, "docker-compose.yml");
  try {
    await fs.access(composePath);
  } catch {
    return {
      content: [{ type: "text", text: `No docker-compose.yml found at ${resolved}` }],
      isError: true
    };
  }

  return null; // valid
}

/**
 * Checks if a service name matches any blocked token (case-insensitive).
 */
function isBlockedService(serviceName) {
  const lower = serviceName.toLowerCase();
  return BLOCKED_SERVICE_TOKENS.some(token => lower === token || lower.includes(token));
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const mcpServer = new McpServer({
  name: "krusch-infra-mcp",
  version: "1.0.0"
});

// Tool: get_fleet_status
mcpServer.tool(
  "get_fleet_status",
  "Pings known nodes to verify network mesh integrity and availability.",
  {
    nodes: z.array(z.string()).optional().describe("Optional list of hostnames or IPs to ping. Defaults to localhost.")
  },
  async ({ nodes = ["localhost"] }) => {
    const results = [];
    for (const node of nodes) {
      // Validate hostname/IP to prevent command injection
      if (!HOST_RE.test(node)) {
        results.push({ node, status: "rejected", error: "Invalid hostname or IP format" });
        continue;
      }
      try {
        // execFileAsync never invokes a shell — immune to injection
        await execFileAsync("ping", ["-c", "1", "-W", "1", node], { timeout: EXEC_TIMEOUT_MS });
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
      const { stdout } = await execAsync("docker ps --format '{{json .}}'", { timeout: EXEC_TIMEOUT_MS });

      // Output is one JSON object per line — split on actual newlines
      const containers = stdout.trim().split("\n").filter(Boolean).map(line => {
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
  "Securely wraps compose logs for a specific project directory to diagnose crashes.",
  {
    project_path: z.string().describe("Absolute path to the project directory containing docker-compose.yml"),
    service: z.string().optional().describe("Optional specific service name to tail. If omitted, tails all services in the compose file."),
    tail_count: z.number().int().min(1).max(1000).default(50).describe("Number of lines to tail (1-1000, default 50)")
  },
  async ({ project_path, service = "", tail_count = 50 }) => {
    try {
      const pathError = await validateProjectPath(project_path);
      if (pathError) return pathError;

      // Sanitize service name — alphanumeric, hyphens, underscores only
      const safeService = service.replace(/[^a-zA-Z0-9_-]/g, "");
      const resolved = path.resolve(project_path);

      const { stdout, stderr } = await execAsync(
        `${composeCommand} logs --tail=${tail_count} ${safeService}`,
        { cwd: resolved, timeout: EXEC_TIMEOUT_MS }
      );

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
  "Safely executes compose restart to recover from deadlocks. Destructive actions (down/rm) are explicitly blocked.",
  {
    project_path: z.string().describe("Absolute path to the project directory containing docker-compose.yml"),
    service: z.string().optional().describe("Optional specific service name to restart. If omitted, restarts all services in the compose file.")
  },
  async ({ project_path, service = "" }) => {
    try {
      const pathError = await validateProjectPath(project_path);
      if (pathError) return pathError;

      // Sanitize service name
      const safeService = service.replace(/[^a-zA-Z0-9_-]/g, "");
      const resolved = path.resolve(project_path);

      // Security check: block restarting critical DB infrastructure (case-insensitive)
      if (safeService && isBlockedService(safeService)) {
        return {
          content: [{ type: "text", text: `Security Policy: Restarting core database services ('${safeService}') is blocked via Infra MCP.` }],
          isError: true
        };
      }

      const { stdout, stderr } = await execAsync(
        `${composeCommand} restart ${safeService}`,
        { cwd: resolved, timeout: EXEC_TIMEOUT_MS }
      );

      return {
        content: [{ type: "text", text: `Restart successful. Output: ${stdout || stderr}` }]
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Failed to restart service: ${err.message}` }], isError: true };
    }
  }
);

// ── Transport & Server Start ─────────────────────────────────────────────────

async function main() {
  // Detect compose command before accepting any connections
  await detectComposeCommand();

  const port = process.env.PORT;

  if (port) {
    // ── Standalone SSE Mode ──────────────────────────────────────────────────
    const app = express();
    app.use(cors());

    // Require bearer token authentication in SSE mode
    const apiKey = process.env.INFRA_MCP_API_KEY;
    if (!apiKey) {
      console.error("FATAL: INFRA_MCP_API_KEY environment variable is required for SSE mode.");
      console.error("Set it in .env or export it before starting the server.");
      process.exit(1);
    }

    app.use((req, res, next) => {
      if (req.headers.authorization !== `Bearer ${apiKey}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      next();
    });

    // Multi-client session map — each SSE connection gets its own transport
    const sessions = new Map();

    app.get("/mcp/sse", async (req, res) => {
      const sessionId = crypto.randomUUID();
      const transport = new SSEServerTransport(`/mcp/messages?sessionId=${sessionId}`, res);
      sessions.set(sessionId, transport);

      // Clean up on disconnect
      res.on("close", () => {
        sessions.delete(sessionId);
        console.log(`SSE client disconnected (session: ${sessionId})`);
      });

      await mcpServer.connect(transport);
      console.log(`New SSE client connected (session: ${sessionId})`);
    });

    app.post("/mcp/messages", async (req, res) => {
      const sessionId = req.query.sessionId;
      const transport = sessions.get(sessionId);
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(503).json({ error: "No active SSE connection for this session" });
      }
    });

    const server = app.listen(port, () => {
      console.log(`Krusch Infra MCP running in Standalone SSE mode on http://localhost:${port}`);
    });

    // Graceful shutdown for HTTP mode
    const shutdown = async () => {
      console.log("Shutting down SSE server...");
      for (const [id, transport] of sessions) {
        try { await transport.close(); } catch { /* best-effort */ }
        sessions.delete(id);
      }
      server.close(() => {
        console.log("HTTP server closed.");
        process.exit(0);
      });
      // Force exit if graceful shutdown takes too long
      setTimeout(() => process.exit(1), 5000);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } else {
    // ── Standard Stdio Mode ──────────────────────────────────────────────────
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error("Krusch Infra MCP Server running on stdio");

    // Graceful shutdown for stdio mode
    const shutdown = async () => {
      console.error("Shutting down stdio server...");
      await mcpServer.close();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}

main().catch(console.error);
