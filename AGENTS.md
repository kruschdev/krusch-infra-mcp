# Krusch Infra MCP Context

This is the SRE (Site Reliability Engineering) Boundary Server for the KruschDev ecosystem.

## Rules
- **No Sudo, No Teardowns**: The agent executing this server has explicit restrictions against destroying infrastructure. Tools are read-heavy (`get_container_health`, `tail_logs`) and recovery-focused (`restart_service`).
- **No Shell Injection**: Fleet pings use `execFile` (args array, no shell). All other user inputs are validated or sanitized before interpolation.
- **Core Database Safety**: `kruschdb`, `postgres`, and `prod_db` services are hard-blocked from being restarted (case-insensitive match) to prevent data corruption.
- **Strict Directory Execution**: Docker commands are locked to `project_path` directories containing verified `docker-compose.yml` files. An optional allowlist (`ALLOWED_PROJECT_PATHS`) can restrict paths further.
- **SSE Authentication**: Standalone HTTP mode requires `INFRA_MCP_API_KEY` bearer token. Unauthenticated access is rejected.

## Ecosystem Role
The orchestrator delegates to this MCP when diagnosing failed deployments or monitoring system load. It does not replace Signet (which handles personal communication) or PG-Git (which handles code).
