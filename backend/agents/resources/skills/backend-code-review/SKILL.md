---
name: backend-code-review
description: Review a backend change against the team's design, code, and runbook checklists — API-to-UI mapping, naming decisions, SQL safety, unit test coverage, and the deployment steps a release needs. Use when reviewing a diff or MR, checking a design before implementation, or assembling a runbook.
---

# Backend code review

Three gates, in order. A change that has not passed the earlier one is not ready
for the later one.

| Gate | When | Question it answers |
| --- | --- | --- |
| Design review | before implementation | is this the right shape, and what does it break |
| Code review | on the diff | does it follow the project's decisions |
| Runbook review | before release | can someone else deploy and verify it |

## Procedure

1. Establish what changed — the diff, or the plan if the gate is design review.
2. `simulate_impact` on every table, column, endpoint, and file it touches.
   A review with no blast radius is an opinion.
3. `search_decisions` on the area. A change that reverses a recorded decision
   without arguing against it is a critical finding.
4. Confirm every column and type against `describe_tables`, and every endpoint
   against `search_docs` / `get_doc_page`. Never accept an invented one.
5. Walk the checklist for the gate you are at. Report findings as
   **critical** (must fix), **suggestion**, or **ship-ready**.
6. List the deployment actions the change needs, for the runbook.

Go layout, handler shape, repo and test conventions are in `backend-go`.
Endpoint and payload design is in `backend`.


### Review design before implement checklist

| **NO** | **Purpose**                                                                                                                                                                                                                                                                                            | **Example**                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 1      | List all API with method and batch cronjob to map with UI interface - Endpoint - Method - Request/Response (Optional)                                                                                                                                                                                  | API - \[GET\] - /api/v1/user - \[POST\] - /api/v1/user Cronjob - \[JOB\] - update employee information |
| 2      | End-to-end flow diagram - All cases flow - Authentication & Unauthentication user flow                                                                                                                                                                                                                 |                                                                                                        |
| 3      | Database structure - Schema for normalization/denormalization - Primary keys, foreign keys, indexes - Migration strategy                                                                                                                                                                               |                                                                                                        |
| 4      | Design - consider design to add new structure over edit the old structure because if we edit the old structure we need to check for impact of editing the old structure - check impact the new design on existing system on both existing business logic, existing data and existing data structure    |                                                                                                        |
| 5      | API-to-UI Mapping - For each API endpoint, provide the entry points in the UI where it is called (e.g., which pages or modules trigger the API). - Example: API: \[GET\] /api/v1/user Used in UI: Login page (fetch user profile), Dashboard (auto-refresh user info), Settings page (load user data). |                                                                                                        |

### Code review checklist

| **NO** | **Purpose**                                                                                                                                                                                                                                                                                                             | **Example**                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1      | Naming convention - Variables, functions, and methods follow project style guide - Database tables & columns name consistently                                                                                                                                                                                          | - path param in gin handler using `snake_case` (:asset_id) - variable, function using `camelCase` (tokenAmount) |
| 2      | SQL syntax - Queries optimized with where-condition - Safe parameterization (prepare state $1 to parse parameter) - Defer close function in every query rows                                                                                                                                                            | - `defer rows.Close()` - `WHERE LOWER(walletAddress) = LOWER(walletAddress)`                                    |
| 3      | Unit test - Handler unit test to test expected response - Business function unit test to test business logic                                                                                                                                                                                                            |                                                                                                                 |
| 4      | API document - Change log, Sequence diagram, Request/Response data - Objective and Remark about this api                                                                                                                                                                                                                |                                                                                                                 |
| 5      | Deployment (record action that need to be include in runbook) - check if there are any new/edit config - check if there are any new db ddl script - check if there are any need to migrate exist data (update data) - check if there are any need of new data (insert data) - always verify smart contract after deploy |                                                                                                                 |

### Runbook checklist

| **NO** | **Purpose**                                                                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Pre-requisite (every step we can do on our own and don’t affect current platform) - Upload new file to blob storage - Prepare new version configuration - Action via backoffice website |
| 2      | Deployment - Service deployment (version) - Database scripts (new features and migrations)                                                                                              |
| 3      | PVT - Database scripts (PVT, mock data) - List all testcases to run pvt - Test all action after go-live                                                                                 |
| 4      | Go-live - Re-open platform for user                                                                                                                                                     |

### Naming convention

| **No** | **Description**                | **Choice**                                              | **Decision**                                                                                       |
| ------ | ------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1      | File name in project           | - asset_handler_test.go - asset_test.go                 | asset_test.go                                                                                      |
| 2      | ID variable in code            | - ID - Id                                               | Id                                                                                                 |
| 3      | Query param in API path        | - ?sortBy=name&orderBy=asc - ?sort_by=name&order_by=asc | sortBy=name&orderBy=asc                                                                            |
| 4      | API path name                  | - singular (asset) - plural (assets)                    | singular (asset)                                                                                   |
| 5      | Database table name            | - singular (asset) - plural (assets)                    | singular (asset)                                                                                   |
| 6      | Database column timestamp name | - created_at - created_date_time                        | using `*_at` for system-generated action timestampusing `*_date_time` for business logic timestamp |
| 7      | Request/Response body          | - `camelCase` - `snake_case`                            | `camelCase`                                                                                        |
| 8      | Env management                 | - spf13/viper - caarlos0/env/v11                        | caarlos0/env/v11                                                                                   |

### Checklist

> design review

- [ ] \- API path map to UI
- [ ] \- Workflow
- [ ] \- Database structure

> code review

- [ ] \- API path with method
- [ ] \- Authentication token or Access control
- [ ] \- Naming convention follow project style guide
- [ ] \- SQL optimization “INNER JOIN, WHERE in subquery, LIKE”
- [ ] \- Close query rows connection “defer rows.Close()”
- [ ] \- Code optimization “For loop, If else” (optional)
- [ ] \- Unit test “Handler, Function”

> runbook review

- [ ] \- List all deployed features
- [ ] \- List step by step to deploy features “Manual database script, Manual action”
- [ ] \- Prepare service tag version
- [ ] \- Prepare configuration in kustomize “PVT,PRD”
- [ ] \- Maintenance platform step (optional)
- [ ] \- PVT all deployed feature testcases
