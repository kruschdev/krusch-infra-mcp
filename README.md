# Krusch Infra MCP

The specialized DevOps (SRE) Model Context Protocol (MCP) server for the KruschDev ecosystem.

## 🚀 Purpose

In a robust "Director-Worker" agentic swarm, the main Orchestrator should not execute raw bash commands. The **Krusch Infra MCP** acts as the secure boundary for all infrastructure operations. It allows the Orchestrator to safely monitor fleet nodes, parse container health, tail logs, and recover from failures via targeted restarts.

## 🛡️ The Secure Capability Boundary

This server enforces strict operational limits:
1. **No Sudo**: Executes docker commands entirely within user-space permissions.
2. **Directory Fencing**: Log-tailing and restarts strictly require an absolute path to a verified `docker-compose.yml` file.
3. **Database Protection**: The `restart_service` tool hard-blocks restarting core database services (like `kruschdb`) to prevent accidental cluster degradation.

## ⚡ Setup

```bash
npm install
```

### Stdio Mode (Default)
Run standard MCP over stdio (best when spawned directly by Claude Desktop or DBOS):
```bash
node server.js
```

### Standalone API Mode (HTTP / SSE)
Run independently so remote orchestrators can connect via HTTP:
```bash
PORT=5446 node server.js
```
*Connect your orchestrator to `http://<host>:5446/mcp/sse`*

## 🛠️ Included Tools
* `get_fleet_status`: Validates network reachability across the homelab mesh.
* `get_container_health`: Reads structured JSON data from the Docker daemon.
* `tail_logs`: Diagnoses service crashes directly from compose projects.
* `restart_service`: Safely bounces a deadlocked service.
