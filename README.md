# Krusch Infra MCP (SRE Boundary Server)

<p align="center">
  <img src="https://placehold.co/800x400/0F172A/10B981.png?text=Krusch+Infra+MCP%0ADevOps+Boundary+Server" alt="Infra Banner" width="100%">
</p>

A hyper-specialized, model-agnostic **Site Reliability Engineering (SRE) MCP Server** designed to provide Agentic Swarms with secure, heavily gated access to local Docker daemon telemetry, fleet monitoring, and automated container recovery.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Node](https://img.shields.io/badge/Node.js-22+-green.svg)
![Proxy](https://img.shields.io/badge/Agentic_Proxy-Supported-blue.svg)
![Docker](https://img.shields.io/badge/Docker-Managed-blueviolet.svg)

## 🧠 Why the Infra MCP?

In a robust "Director-Worker" agentic architecture, your main orchestrator should never execute raw bash commands or hold `sudo` privileges. The Krusch Infra MCP acts as the **Secure Capability Boundary** for infrastructure operations:
1. **Delegated Execution**: Instead of hallucinating shell commands, the Agentic Proxy strictly delegates DevOps tasks to this isolated MCP.
2. **Read-Heavy Telemetry**: Exposes structured JSON outputs from `docker ps` and structured log tailing, allowing the LLM to rapidly diagnose system hangs without parsing messy CLI text.
3. **Bounded Recovery**: Grants the swarm the ability to autonomously restart deadlocked services (`docker-compose restart`) while explicitly hard-blocking destructive actions (`down`, `rm`) or the reboot of core databases.

## ⚠️ The DevOps Security Boundary

It is critical to understand that the Infra MCP **does not expose raw shell access**. 

If an LLM was given raw terminal access to `prod-server`, a simple hallucination could execute `rm -rf` or `docker-compose down -v`, destroying production data. Instead, this MCP implements a strict security posture:
- **No Sudo**: Executes Docker commands entirely within unprivileged user-space (`docker` group).
- **Directory Fencing**: Log-tailing and restarts require an absolute path to a verified `docker-compose.yml` file, preventing arbitrary bash injection.
- **Database Protection**: The `restart_service` tool hard-blocks restarting core ecosystem databases (e.g., `prod_db`, `postgres`) to prevent accidental cluster degradation.

## 🤝 The DBOS Agentic Ecosystem

This project is a dedicated node within the **Krusch DBOS Agentic Ecosystem**. The architecture moves away from monolithic local applications into a highly modular, distributed swarm of specialized Model Context Protocol (MCP) servers.

- **[Krusch DBOS MCP](https://github.com/kruschdev/krusch-dbos-mcp)**: The central Orchestrator and Postgres-backed state machine.
- **[Krusch Agentic Proxy](https://github.com/kruschdev/krusch-agentic-mcp)**: The Intelligence Layer (LLM Waterfall Router).
- **[PG-Git MCP](https://github.com/kruschdev/pg-git)**: Source Control Boundary (Code Editing & Commits).
- **[Krusch Infra MCP](https://github.com/kruschdev/krusch-infra-mcp)**: System Ops Boundary (Docker & SRE).
- **[Signet MCP](https://github.com/kruschdev/signet)**: Communications Boundary (Email & Calendar).
- **[Krusch Memory MCP](https://github.com/kruschdev/krusch-memory-mcp)**: Episodic History Boundary (Project-isolated Temporal Memory).

> 🗺️ **Want to see the big picture?** Read the [Ecosystem Blueprint](https://github.com/kruschdev/krusch-dbos-mcp/blob/main/ECOSYSTEM.md) for a complete diagram of how these boundaries fit together.

## ⚡ Quick Start

```bash
npm install
```

### Stdio Mode (Default)
Run standard MCP over stdio (best when spawned locally directly by DBOS or Claude Desktop):
```bash
node server.js
```

### Standalone API Mode (HTTP / SSE)
Run independently so remote orchestrators can connect via HTTP across your Tailscale mesh:
```bash
PORT=5446 node server.js
```
*Connect your orchestrator to `http://<host>:5446/mcp/sse`*

### Integration

**For OpenClaw, Claude Desktop, or Cursor**, add the Krusch Infra MCP to your `mcp_client_config.json`:

```json
{
  "mcpServers": {
    "krusch_infra": {
      "command": "node",
      "args": ["/absolute/path/to/krusch-infra-mcp/server.js"]
    }
  }
}
```

**For Hermes Agent**, add the following to your `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  krusch_infra:
    command: "node"
    args: ["/absolute/path/to/krusch-infra-mcp/server.js"]
```

---

## 🚀 Real-World Usage Examples

When wired into your Agentic Proxy, the Orchestrator will seamlessly route infrastructure tasks to this server.

**Example 1: Diagnosing a Crash**
> **You:** "Is the Jellyfin server down on media-server?"
> **Orchestrator:** *[Calls `get_container_health`]* "Yes, it shows as Exited."
> **Orchestrator:** *[Calls `tail_logs` on the jellyfin path]* "It looks like an FFmpeg transcode timeout. I will restart it."
> **Orchestrator:** *[Calls `restart_service`]* "Jellyfin is back online."

**Example 2: Fleet Status Check**
> **You:** "Ping the cluster mesh to see what's online."
> **Orchestrator:** *[Calls `get_fleet_status`]* "node-1 and node-2 are online. node-3 is currently offline."

---

## 🛠️ Included Tools

| Tool | Description |
|------|-------------|
| `get_fleet_status` | Validates network reachability across the cluster mesh via ICMP. |
| `get_container_health` | Reads structured JSON telemetry directly from the Docker daemon. |
| `tail_logs` | Diagnoses service crashes directly from verified compose projects. |
| `restart_service` | Safely bounces a deadlocked service (destructive actions blocked). |

## License
MIT License. Created by [kruschdev](https://github.com/kruschdev).
