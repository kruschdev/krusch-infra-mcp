# Krusch Infra MCP Context

This is the SRE (Site Reliability Engineering) Boundary Server for the KruschDev ecosystem.

## Rules
- **No Sudo, No Teardowns**: The agent executing this server has explicit restrictions against destroying infrastructure. Tools are read-heavy (`get_container_health`, `tail_logs`) and recovery-focused (`restart_service`).
- **Core Database Safety**: `kruschdb` and Postgres services are hard-blocked from being restarted via the standard generic tool to prevent data corruption.
- **Strict Directory Execution**: Docker commands are strictly locked to explicit `project_path` directories containing verified `docker-compose.yml` files to prevent arbitrary bash injection.

## Ecosystem Role
The orchestrator delegates to this MCP when diagnosing failed deployments or monitoring system load. It does not replace Signet (which handles personal communication) or PG-Git (which handles code).
