# Graph Report - sa-agent  (2026-09-01)

## Corpus Check
- Corpus is ~36,944 words - fits in a single context window. You may not need a graph.

## Summary
- 764 nodes · 1290 edges · 59 communities (23 shown, 34 thin omitted)
- Extraction: 94% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 66 edges (avg confidence: 0.86)
- Token cost: 167,945 input · 0 output

## Community Hubs (Navigation)
- Chat UI Components
- Express Server & Vault Service
- MCP Clients & Core Tools
- Vault API Contract
- Frontend Dependencies
- Agent Skill Definitions
- Knowledge Ingestion Pipeline
- Six-Phase Harness Loop
- Jira API & MCP Server
- App Shell & Layout
- Agent Builder & Harness Core
- Frontend TypeScript Config
- Backend Package Manifest
- Vault Feature Module
- Architecture Rationale
- Confluence Spec Parser
- Backend TypeScript Config
- Frontend API Types
- Chat Route & Artifacts
- LangChain Core Dependencies
- Next.js Starter Assets
- Claude MCP Server Config
- Frontend Service Client
- sa-mcp Launcher Script
- Express Type Augmentation
- Frontend Env Types
- chromadb Dependency
- cors Dependency
- deepagents Dependency
- dotenv Dependency
- express Dependency
- html-to-text Dependency
- langchain Dependency
- LangChain Anthropic Provider
- LangGraph Dependency
- LangChain MCP Adapters
- LangChain Mistral Provider
- LangChain Ollama Provider
- LangChain OpenAI Provider
- LangChain Text Splitters
- langsmith Dependency
- MCP SDK Dependency
- multer Dependency
- node-sql-parser Dependency
- openai Dependency
- pg Dependency
- pgsql-ast-parser Dependency
- Supabase JS Client
- tsx Dependency
- cors Type Definitions
- multer Type Definitions
- node Type Definitions
- zod Dependency
- ESLint Configuration
- Next.js Build Config
- Next.js Env Declarations
- PostCSS Configuration

## God Nodes (most connected - your core abstractions)
1. `Frontend Conventions` - 21 edges
2. `HttpError` - 18 edges
3. `compilerOptions` - 17 edges
4. `compilerOptions` - 16 edges
5. `config` - 15 edges
6. `uploadFile()` - 15 edges
7. `System Analyst Skill` - 13 edges
8. `getSupabase()` - 12 edges
9. `throwIfError()` - 12 edges
10. `queryString()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Mention Token (@Folder/file)` --semantically_similar_to--> `Grounding Hierarchy`  [INFERRED] [semantically similar]
  frontend/features/vault/API.md → README.md
- `vault_files Postgres Table` --conceptually_related_to--> `describe_tables`  [AMBIGUOUS]
  frontend/features/vault/API.md → README.md
- `Forms With React Hook Form and Zod` --semantically_similar_to--> `API Contract Requirements`  [INFERRED] [semantically similar]
  frontend/FRONTEND_CONVETIONS.md → backend/agents/resources/skills/backend/SKILL.md
- `GET /v1/vault/mentions` --semantically_similar_to--> `Pagination Convention (limit/offset + deterministic ORDER BY)`  [INFERRED] [semantically similar]
  frontend/features/vault/API.md → backend/agents/resources/skills/backend/SKILL.md
- `Spec Design Agent (Vault Consumer)` --semantically_similar_to--> `System Analyst Skill`  [INFERRED] [semantically similar]
  frontend/features/vault/API.md → backend/agents/resources/skills/system-analyst/SKILL.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Six-phase harness specialists gated by a human** — backend_agents_claude_agents_system_analyst_system_analyst, backend_agents_claude_agents_solution_architect_solution_architect, backend_agents_claude_agents_coder_coder, backend_agents_claude_agents_test_engineer_test_engineer, backend_agents_claude_agents_reviewer_reviewer, backend_agents__docs__architecture_harness_loop, backend_agents__docs__architecture_human_gate [EXTRACTED 1.00]
- **Grounding stack: live DB over index over Jira, never invent** — backend_readme_live_schema_grounding, backend_agents__docs__architecture_grounding_order, backend_agents_resources_agents_sources_of_truth, backend_agents_claude_memory_agents_sources_of_truth, backend_agents_resources_agents_never_invent_rule, backend_readme_jira_mcp [EXTRACTED 1.00]
- **Dual-runtime plugin delivery (Claude Code and Codex)** — backend_agents_claude_readme_sa_agent_plugin, backend_agents_claude_readme_mcp_json, backend_agents_claude_readme_mcp_codex_json, backend_readme_sa_mcp_launcher, backend_agents_claude_readme_codex_env_limitation, backend_agents_claude_readme_sa_agent_home, backend_agents__docs__architecture_marketplace_manifest [EXTRACTED 1.00]
- **sa-agent Phase Pipeline (discuss to plan to execute to test)** — readme_phase_discipline, backend_agents_resources_skills_system_analyst_skill_system_analyst, backend_agents_resources_skills_solution_architect_skill_solution_architect, backend_agents_resources_skills_backend_skill_backend, backend_agents_resources_skills_test_engineer_skill_test_engineer [EXTRACTED 1.00]
- **sa-knowledge Grounding Tool Suite** — readme_list_tables, readme_describe_tables, readme_inspect_relationships, readme_run_sql, readme_search_api_specs, readme_search_schema_docs, readme_grounding_hierarchy [EXTRACTED 1.00]
- **Vault Mention Hydration Flow** — frontend_features_vault_api_upload_vault_file, frontend_features_vault_api_list_vault_mentions, frontend_features_vault_api_mention_token, frontend_features_vault_api_chat_agent, frontend_features_vault_api_spec_design_agent, frontend_features_vault_api_supabase_storage_bucket [EXTRACTED 1.00]
- **Next.js Starter Link-Card Icon Row (docs / deploy / learn affordances)** — frontend_public_file_fileicon, frontend_public_globe_globeicon, frontend_public_window_windowicon [INFERRED 0.85]
- **Unmodified create-next-app public/ Asset Bundle** — frontend_public_next_nextlogo, frontend_public_vercel_vercellogo, frontend_public_file_fileicon, frontend_public_globe_globeicon, frontend_public_window_windowicon [INFERRED 0.85]

## Communities (59 total, 34 thin omitted)

### Community 0 - "Chat UI Components"
Cohesion: 0.05
Nodes (54): metadata, Attachment, ChatInput(), ChatInputProps, formatSize(), MentionItem, sendButtonVariants, ChatInterface() (+46 more)

### Community 1 - "Express Server & Vault Service"
Cohesion: 0.08
Nodes (52): getSupabase(), requiredEnv(), app, errorMessageOf(), HttpError, PostgrestLike, queryNumber(), queryString() (+44 more)

### Community 2 - "MCP Clients & Core Tools"
Cohesion: 0.08
Nodes (37): normalizeIssueKey(), envRecord(), getJiraMcpClient(), getJiraMcpTools(), hasJiraRestAuth(), isJiraMcpConfigured(), jiraConnection(), LOCAL_SERVER (+29 more)

### Community 3 - "Vault API Contract"
Cohesion: 0.07
Nodes (48): Consistent Error Envelope (code/message/details), Next.js Agent Rules Block, frontend/CLAUDE.md @AGENTS.md Pointer, BearerAuth Scheme, Chat Agent (Vault Consumer), POST /v1/vault/folders, DELETE /v1/vault/files/{fileId}, DELETE /v1/vault/folders/{folderId} (+40 more)

### Community 4 - "Frontend Dependencies"
Cohesion: 0.04
Nodes (44): clsx, eslint, eslint-config-next, framer-motion, dependencies, clsx, framer-motion, lucide-react (+36 more)

### Community 5 - "Agent Skill Definitions"
Cohesion: 0.09
Nodes (43): Backend Skill, API Contract Requirements, Backend Data Access Rules, Endpoint Conventions, Pagination Convention (limit/offset + deterministic ORDER BY), get_jira_ticket, Jira Skill (Discuss Only), One Issue Key Per Call Rule (+35 more)

### Community 6 - "Knowledge Ingestion Pipeline"
Cohesion: 0.10
Nodes (28): createLoader(), main(), docs, schemas, Column, dataTypeToString(), parseSQLToSchema(), relationshipToDocuments() (+20 more)

### Community 7 - "Six-Phase Harness Loop"
Cohesion: 0.07
Nodes (37): discuss phase, execute phase, Grounding order: live DB, index, Jira, M7 hard HITL via Deep Agents interruptOn, Human-in-the-loop gate per phase, Marketplace manifests (.claude-plugin / .agents/plugins), Milestones M0-M7, plan phase (+29 more)

### Community 8 - "Jira API & MCP Server"
Cohesion: 0.12
Nodes (26): acceptanceCriteria(), adfToText(), authHeader(), descriptionOf(), extractAcFromDescription(), fetchIssue(), fieldText(), formatTicket() (+18 more)

### Community 9 - "App Shell & Layout"
Cohesion: 0.11
Nodes (19): metadata, Providers(), providersProps, AppSidebar(), AppSidebarProps, bottomNavItems, mainNavItems, AppTabs() (+11 more)

### Community 10 - "Agent Builder & Harness Core"
Cohesion: 0.14
Nodes (23): AgentSpec, createBackend(), defineAgent(), RESOURCE_ROOT, ARTIFACT, harnessSubagents(), INDEX, JIRA (+15 more)

### Community 11 - "Frontend TypeScript Config"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 12 - "Backend Package Manifest"
Cohesion: 0.07
Nodes (27): devDependencies, @types/bun, @types/express, @types/pg, @types/uuid, typescript, main, name (+19 more)

### Community 13 - "Vault Feature Module"
Cohesion: 0.14
Nodes (18): metadata, buildMentions(), MOCK_FOLDERS, toMentionToken(), vaultMentions, vaultService, CreateFolderInput, VaultApiResponse (+10 more)

### Community 14 - "Architecture Rationale"
Cohesion: 0.10
Nodes (25): The artifact file is the interface (no /start command), sa-agent as capability provider, not the product, Cheap orchestrator router with narrow specialist tools, Context management (brief, artifact, discard the thread), Per-phase distillation makes the next phase cheap, Six-phase harness loop, Keep both surfaces in sync (LangChain path vs plugin path), agents/tools/core shared tool implementations (+17 more)

### Community 15 - "Confluence Spec Parser"
Cohesion: 0.18
Nodes (19): buildDocuments(), consumeRequestRow(), consumeResponseCodeRow(), consumeResponseFieldRow(), DatabaseTable, Field, isSectionMarker(), isSkippable() (+11 more)

### Community 16 - "Backend TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, allowJs, jsx, lib, module, moduleDetection, moduleResolution (+11 more)

### Community 17 - "Frontend API Types"
Cohesion: 0.17
Nodes (10): ApiParameter, ApiResponse, ApiSpecData, ChatApiResponse, ChatResponseData, ChatResponseType, CodeData, DiagramData (+2 more)

### Community 18 - "Chat Route & Artifacts"
Cohesion: 0.42
Nodes (8): lastAssistantContent(), normalizeApiSpec(), normalizeArtifact(), stripThinking(), tryParseJsonObject(), chatHandler(), toContentBlocks(), upload

### Community 19 - "LangChain Core Dependencies"
Cohesion: 0.22
Nodes (9): dependencies, cheerio, @chroma-core/default-embed, @langchain/community, @langchain/core, cheerio, @chroma-core/default-embed, @langchain/community (+1 more)

### Community 20 - "Next.js Starter Assets"
Cohesion: 0.48
Nodes (7): File Document Icon (file.svg), Monochrome 16px #666 Icon System, Globe / World Icon (globe.svg), create-next-app Default Public Assets, Next.js Wordmark Logo (next.svg), Vercel Triangle Logomark (vercel.svg), Browser Window Icon (window.svg)

### Community 21 - "Claude MCP Server Config"
Cohesion: 0.60
Nodes (4): jira, sa-knowledge, SA_AGENT_RUNTIME, bun

### Community 22 - "Frontend Service Client"
Cohesion: 0.40
Nodes (4): RespType, Role, UIMessage, UIMessagePart

## Ambiguous Edges - Review These
- `Bifrost model gateway` → `LangSmith tracing of MCP tool runs`  [AMBIGUOUS]
  backend/agents/claude/README.md · relation: conceptually_related_to
- `Vault storage API (/v1/vault)` → `Ingestion pipelines (confluence / ddl / url)`  [AMBIGUOUS]
  backend/README.md · relation: conceptually_related_to
- `describe_tables` → `vault_files Postgres Table`  [AMBIGUOUS]
  frontend/features/vault/API.md · relation: conceptually_related_to
- `Current Project Stack` → `Next.js create-next-app Starter README`  [AMBIGUOUS]
  frontend/README.md · relation: conceptually_related_to
- `Monochrome 16px #666 Icon System` → `create-next-app Default Public Assets`  [AMBIGUOUS]
  frontend/public/file.svg · relation: conceptually_related_to

## Knowledge Gaps
- **209 isolated node(s):** `RESOURCE_ROOT`, `SCHEMA`, `INDEX`, `JIRA`, `schemas` (+204 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 256 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **34 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Bifrost model gateway` and `LangSmith tracing of MCP tool runs`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Vault storage API (/v1/vault)` and `Ingestion pipelines (confluence / ddl / url)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `describe_tables` and `vault_files Postgres Table`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Current Project Stack` and `Next.js create-next-app Starter README`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Monochrome 16px #666 Icon System` and `create-next-app Default Public Assets`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `config` connect `Knowledge Ingestion Pipeline` to `Express Server & Vault Service`, `Agent Builder & Harness Core`, `MCP Clients & Core Tools`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `dependencies` connect `LangChain Core Dependencies` to `Backend Package Manifest`, `chromadb Dependency`, `cors Dependency`, `deepagents Dependency`, `dotenv Dependency`, `express Dependency`, `html-to-text Dependency`, `langchain Dependency`, `LangChain Anthropic Provider`, `LangGraph Dependency`, `LangChain MCP Adapters`, `LangChain Mistral Provider`, `LangChain Ollama Provider`, `LangChain OpenAI Provider`, `LangChain Text Splitters`, `langsmith Dependency`, `MCP SDK Dependency`, `multer Dependency`, `node-sql-parser Dependency`, `openai Dependency`, `pg Dependency`, `pgsql-ast-parser Dependency`, `Supabase JS Client`, `tsx Dependency`, `cors Type Definitions`, `multer Type Definitions`, `node Type Definitions`, `zod Dependency`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._