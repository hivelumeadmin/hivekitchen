# HiveKitchen — Backend Architecture

**Version:** 1.0
**Status:** Draft
**Stack:** TypeScript · Fastify · Zod · OpenAI Agents SDK · Supabase · ElevenLabs · Pino · Swagger / OpenAPI

---

## 1. Purpose and Architectural Philosophy

This document defines the high-level architecture of the HiveKitchen backend API. The backend serves as the sole intelligent layer of the system. The client and all frontend surfaces interact with it exclusively through a versioned HTTP API. No business logic, agent orchestration, or data persistence lives in the client.

The architecture is governed by four principles that must be preserved as the system evolves.

**Domain Isolation.** The core business rules and agent logic are never coupled to Fastify, Supabase, or any other infrastructure concern. If Fastify were replaced with another HTTP framework tomorrow, the domain would be untouched. If Supabase were replaced with another database, the agent logic and business rules would not require modification. Every external dependency is treated as a plugin or adapter, not as a first-class participant in domain logic.

**Module Boundary Enforcement.** Each vertical slice of the system owns its routes, services, schemas, and types. Nothing bleeds across module boundaries without a deliberate and documented interface. Cross-module communication happens through service interfaces, never through direct import of another module's internal files.

**Persistence and Transport Independence.** The agents, orchestrator, and tools do not know or care how data reaches them or how responses leave the system. They operate on typed domain objects. The repository layer handles the translation to and from Supabase. The route layer handles the translation to and from HTTP.

**Long-Term Maintainability.** Every decision in this architecture prefers explicitness over convenience. Schemas are validated at the boundary with Zod. All I/O is typed. All routes are documented. All significant operations are logged and audited. There are no magic globals, no ambient state, and no implicit side effects.

---

## 2. Technology Stack

**TypeScript** is the implementation language for the entire backend. Strict mode is enabled. No `any` is used in production code without explicit justification in a comment. Type safety is treated as documentation.

**Fastify** is the HTTP framework, chosen for its performance profile, its first-class plugin system, and its schema-native request validation pipeline. Fastify's plugin system is used to inject all infrastructure dependencies — database clients, AI clients, logger instances — as decorated properties on the Fastify instance, making them available throughout the application without importing global singletons.

**Zod** is used for all schema definition and runtime validation. Every request body, query parameter, path parameter, and API response is defined as a Zod schema first. These schemas are the single source of truth. They are used to generate Fastify's JSON Schema (for request validation and Swagger documentation) and TypeScript types simultaneously, eliminating drift between runtime validation and compile-time types.

**OpenAI Agents SDK** powers the agent orchestration layer. The SDK handles agent lifecycle, tool execution, handoffs between agents, and conversation threading. The backend wraps the SDK in a domain-aware orchestration module so that the SDK's interface remains an internal implementation detail, not a public contract.

**Supabase** serves two purposes: it is the primary relational database (PostgreSQL) and it is the authentication provider. These two concerns are handled by separate modules inside the backend even though they share the same underlying Supabase project. The repository module holds all database interaction. The auth module holds all identity and session logic. They share a Supabase client plugin but nothing else.

**ElevenLabs** is integrated for text-to-speech output, supporting the multimodal seamless switching UX principle. It is encapsulated as a plugin and accessed exclusively through a service interface. Routes and agents never call the ElevenLabs SDK directly.

**Pino** is the structured logger. Every log entry is a JSON object. No `console.log` appears anywhere in production code. Log levels (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) are used consistently and semantically. Pino's child logger pattern is used to attach request-scoped context (request ID, user ID, session ID, agent run ID) to all log entries produced during a single request lifecycle.

**Swagger / OpenAPI** documents every route. The documentation is generated automatically from Zod schemas via the `@fastify/swagger` and `@fastify/swagger-ui` plugins. The OpenAPI specification is available as a live endpoint and as a generated file. No route is considered complete until its schema, response shapes, and error cases are fully documented.

---

## 3. System Overview

The backend is a single deployable service. It receives HTTP requests from the frontend client, authenticates and authorizes them, routes them to the appropriate module, and returns structured responses. For operations involving agent execution, it streams responses back to the client using Server-Sent Events. For operations involving voice, it calls ElevenLabs and returns or streams the resulting audio. All meaningful operations are logged with Pino and written to the audit trail.

The system has no public-facing consumer other than the frontend client. There are no webhooks, no third-party callbacks, and no public endpoints that bypass authentication. The only exception is the Supabase Auth callback route, which is handled by the auth module and immediately exchanges the OAuth token for a server-managed session.

---

## 4. Project Structure


backend-api/
├── src/
│ ├── plugins/ # Infrastructure adapters as Fastify plugins
│ │ ├── supabase.plugin.ts # Supabase client → fastify.supabase
│ │ ├── openai.plugin.ts # OpenAI client → fastify.openai
│ │ ├── elevenlabs.plugin.ts # ElevenLabs client → fastify.elevenlabs
│ │ └── swagger.plugin.ts # OpenAPI / Swagger UI registration
│ │
│ ├── agents/ # AI execution layer (transport-agnostic)
│ │ ├── orchestrator.ts # Triage / router agent — entry point for all AI runs
│ │ ├── specialists/ # Domain-specific agents
│ │ │ ├── planner.agent.ts # Weekly meal plan generation
│ │ │ ├── nutrition.agent.ts # Nutritional analysis and advice
│ │ │ └── support.agent.ts # User support and clarification
│ │ ├── tools/ # Executable functions registered with agents
│ │ │ ├── plan.tools.ts # Create, update, retrieve plans
│ │ │ ├── recipe.tools.ts # Search and fetch recipes
│ │ │ └── memory.tools.ts # Read/write user memory and preferences
│ │ └── agent.types.ts # Agent input/output domain types
│ │
│ ├── modules/ # API feature modules (vertical slices)
│ │ ├── auth/
│ │ │ ├── auth.routes.ts
│ │ │ ├── auth.service.ts
│ │ │ └── auth.schema.ts
│ │ ├── users/
│ │ │ ├── users.routes.ts
│ │ │ ├── users.service.ts
│ │ │ ├── users.repository.ts
│ │ │ └── users.schema.ts
│ │ ├── plans/
│ │ │ ├── plans.routes.ts
│ │ │ ├── plans.service.ts
│ │ │ ├── plans.repository.ts
│ │ │ └── plans.schema.ts
│ │ └── chat/
│ │ ├── chat.routes.ts # POST /chat/stream — SSE endpoint
│ │ ├── chat.service.ts # Orchestrator invocation + memory recall
│ │ ├── chat.repository.ts # Thread persistence in Supabase
│ │ └── chat.schema.ts
│ │
│ ├── repository/ # Shared repository infrastructure
│ │ ├── base.repository.ts # Common query helpers, error normalization
│ │ └── repository.types.ts # Generic repository interfaces
│ │
│ ├── audit/ # Audit trail module
│ │ ├── audit.service.ts # Write audit events
│ │ ├── audit.repository.ts # Persist to audit_log table
│ │ └── audit.types.ts # AuditEvent type definitions
│ │
│ ├── middleware/ # Fastify hooks and middleware
│ │ ├── authenticate.hook.ts # JWT validation on every protected route
│ │ ├── authorize.hook.ts # Role and permission checks
│ │ ├── request-id.hook.ts # Attach unique request ID for tracing
│ │ └── audit.hook.ts # Attach audit writer to request lifecycle
│ │
│ ├── common/ # Shared utilities and types
│ │ ├── errors.ts # Domain error classes
│ │ ├── logger.ts # Pino instance and child logger factory
│ │ └── env.ts # Zod-validated environment config
│ │
│ ├── types/ # Global TypeScript type declarations
│ │ ├── fastify.d.ts # Fastify instance decoration types
│ │ └── supabase.types.ts # Generated Supabase database types
│ │
│ ├── app.ts # Application factory: plugin + module registration
│ └── index.ts # Entry point: create app, bind port, start server
│
├── supabase/
│ ├── migrations/ # Versioned SQL migrations
│ │ ├── 0001_initial_schema.sql
│ │ ├── 0002_pgvector_extension.sql
│ │ ├── 0003_memory_store.sql
│ │ ├── 0004_thread_logs.sql
│ │ └── 0005_audit_log.sql
│ └── functions/ # Optional Supabase Edge Functions
│ └── rag-retrieval/ # Fast vector search pipeline
│
├── .env
├── tsconfig.json
└── package.json

---

## 5. Module Breakdown

### 5.1 Plugins Layer

Plugins are the boundary between infrastructure and application. Every external dependency — Supabase, OpenAI, ElevenLabs — is wrapped in a Fastify plugin that registers the client once and decorates the Fastify instance so it is available throughout the request lifecycle. No module imports an SDK client directly. They always access it through the decorated Fastify instance passed via Fastify's plugin and route context.

This pattern means that in testing environments, any plugin can be replaced with a mock without touching application logic. It also means the initialization order is explicit and controlled: infrastructure plugins register first, then application modules register on top of them.

The Swagger plugin registers both the OpenAPI JSON specification endpoint and the Swagger UI. It is configured with API metadata, security scheme definitions (Bearer token), and tag groupings that match the module structure. Every route's schema definition automatically populates the generated specification.

### 5.2 Agents Module — AI Execution Layer

The agents module is the most distinctive part of the HiveKitchen backend. It is entirely decoupled from HTTP concerns. Nothing in it imports from Fastify. It receives typed domain inputs, performs work using the OpenAI Agents SDK, and returns typed domain outputs or emits typed streaming events. This design directly supports the HCID principle of AI Proposes, Humans Decide — the agents produce suggestions and plans, but the service and route layers enforce the confirmation and approval flows before any persistent action is taken.

**Orchestrator.** The orchestrator is a triage and router agent implemented using the OpenAI Agents SDK's handoff mechanism. When a chat request arrives, the orchestrator receives the full conversation context and decides which specialist agent is best suited to handle it. This decision may result in a direct response or a handoff to a specialist. The orchestrator also handles multi-step flows where more than one specialist must contribute before a response is ready.

**Specialist Agents.** Specialist agents are domain-scoped agents registered with the SDK. Each specialist has a defined purpose, a system prompt, and a set of tools it is permitted to use. The planner agent has access to plan tools and recipe tools but not support tools. This scoping is intentional and enforced at the SDK level, not through convention. Specialists do not call each other directly; all routing goes through the orchestrator.

**Tools.** Tools are the executable functions that agents call to interact with the outside world. A tool is a plain TypeScript function with a Zod-defined input schema. Tools may read from or write to the database via the repository layer, call external APIs, or compute results in memory. Tools are the only place within the agents module where side effects are permitted. Every tool call is logged by the audit service, supporting the Explainability On Demand principle — when a user asks "why this recommendation?", the audit trail of tool calls provides the foundation for that explanation.

The agents module communicates with the rest of the application through a clean interface. The chat service calls `orchestrator.run(input)` and receives either a complete response or an async iterable of streaming events. The orchestrator does not know about HTTP, Fastify, or SSE.

### 5.3 Modules Layer — Feature API Modules

Each feature module follows an identical internal structure: routes, service, repository, and schema. This uniformity is enforced by convention and code review, not by framework magic.

**Routes** define the HTTP contract. They register the path, method, Zod schema (which becomes both validation and Swagger documentation), authentication hook reference, and handler function. Handlers are thin: they extract validated input, call the service, and serialize the response. No business logic lives in a handler.

**Services** contain business logic. They orchestrate calls to repositories, other services, and the agents module. A service does not import Fastify types, Supabase SDK types, or HTTP status codes. It operates on domain types and throws domain errors defined in `common/errors.ts`.

**Repositories** are the only files permitted to import the Supabase client or write raw SQL. They expose typed methods like `findById`, `create`, `update`, and `delete`. They map Supabase row types to domain types on the way out. They never throw HTTP errors; they throw domain errors that the service layer interprets.

**Schemas** define Zod schemas for all inputs and outputs of the module. These are shared between the route (for Fastify validation) and the service (for runtime type assertions where needed). TypeScript types are inferred from Zod schemas using `z.infer<>`.

### 5.4 Repository Module — Shared Infrastructure

The `repository/` directory contains the base repository class and shared infrastructure that all feature repositories extend. It provides common patterns for error normalization (converting Supabase-specific error codes into domain errors), pagination helpers, and query construction utilities.

The base repository receives the Supabase client as a constructor argument, ensuring that repositories are testable by injecting a mock client. They never access the client through a global or module-level import.

### 5.5 Authentication and Authorization

Authentication and authorization are treated as a separate bounded module even though both currently use Supabase under the hood. This separation ensures that migrating to a different identity provider in the future requires changes only within the auth module, not across the codebase.

**Authentication** is handled by a Fastify `onRequest` hook (`authenticate.hook.ts`) registered on all protected routes. The hook extracts the Bearer token from the Authorization header, validates it using the Supabase JWT secret, and attaches the decoded user payload to the request object. If the token is missing or invalid, the hook rejects the request with a 401 before it reaches the route handler.

**Authorization** is handled by a separate `onRequest` hook (`authorize.hook.ts`) registered per-route or per-module when role or permission checks are required. The authorization hook reads the user payload attached by the authentication hook and evaluates it against the required role or permission for that route. Authorization failures return a 403. The two hooks are always applied in order: authentication first, then authorization.

The auth module itself exposes routes for sign-in, sign-up, sign-out, token refresh, and the OAuth callback. These routes either bypass or have minimal authentication requirements and are explicitly documented as such in the OpenAPI specification.

### 5.6 Audit Module

The audit module records a structured event for every significant operation in the system. Significant operations include all write operations, all agent runs, all authentication events, all authorization failures, and any operation touching sensitive user data. This module is the backbone of the Explainability On Demand and Feedback Without Friction UX principles — it provides the data layer that makes "why did the AI do this?" answerable and ensures all user feedback signals are durably captured.

An audit event is a typed record containing the actor (user ID or system), the action (a namespaced string like `plan.created` or `agent.run.completed`), the resource type, the resource ID, a timestamp, the request ID, and a metadata object for additional context. The request ID links the audit event to all Pino log entries from the same request, enabling complete trace reconstruction.

The audit service writes events asynchronously to the `audit_log` table in Supabase. Writes are fire-and-forget in the happy path but errors during audit writes are logged at the `error` level and never cause the originating request to fail. The audit log is append-only; no row in the audit table is ever updated or deleted.

An `audit.hook.ts` is attached to the Fastify `onResponse` lifecycle hook so that route-level audit events are always written after the response is sent, ensuring zero latency impact on the client.

### 5.7 Logging

Pino is configured as the Fastify logger with a JSON serializer in production and `pino-pretty` in development. Log levels are set by environment variable. The default production level is `info`.

Every log entry produced during a request lifecycle carries a child logger instance that includes the request ID, the authenticated user ID (when available), and the session ID. This is achieved by creating a child logger in the `onRequest` hook and attaching it to the request object. All route handlers and services that receive the request object use `request.log` rather than the root logger, ensuring consistent context enrichment.

Agent runs produce additional log context including the run ID, the active agent name, and the tool being called. This creates a complete, queryable trace of every AI execution in the structured log output.

Log entries follow a consistent shape: `timestamp`, `level`, `requestId`, `userId`, `module`, `action`, and `message`. This shape enables log aggregation and querying in any log management system without custom parsing.

---

## 6. Server-Sent Events

Agent-driven chat responses are streamed to the client using Server-Sent Events originating from the backend. The `POST /chat/stream` route in the chat module is the primary SSE endpoint. This streaming architecture directly supports the Progressive Disclosure and Communicate Uncertainty UX principles by allowing the AI to surface information incrementally and signal its own processing state in real time.

When a request arrives at this route, the handler sets the response headers to `Content-Type: text/event-stream`, disables response buffering, and passes control to the chat service. The chat service invokes the orchestrator and receives an async iterable of typed streaming events from the OpenAI Agents SDK. For each event in the stream, the service formats it as an SSE data frame and writes it directly to the response stream. The stream is terminated with a `[DONE]` event once the agent run completes.

Each SSE event carries a typed payload. Delta events carry incremental text content. Tool events carry tool call start and completion signals for UI indicators. Status events carry agent handoff notifications and run completion signals. The client can render progressive output immediately without polling.

Error handling in SSE streams is treated carefully. If an error occurs mid-stream, a terminal error event is written before the stream closes, giving the client structured information about what went wrong rather than a raw connection drop.

For voice output, the ElevenLabs plugin is invoked with the agent's final text response. The resulting audio can either be returned as a separate HTTP response or streamed via a second SSE channel, depending on the use case.

---

## 7. API Documentation

Every route in the system is documented via Swagger / OpenAPI. Documentation is not a separate deliverable; it is a byproduct of the Zod schema definitions that already exist for validation. The `@fastify/swagger` plugin reads the JSON Schema derived from Zod and generates the OpenAPI specification automatically.

Each route carries a full schema block defining the request body or query parameters, all success response shapes, and all error response shapes. Routes are tagged by module (`auth`, `users`, `plans`, `chat`) so the Swagger UI presents a navigable, organized interface.

Security schemes are defined at the global level: Bearer token authentication applies to all routes except the public auth routes. The Swagger UI reflects this with lock icons and the ability to authenticate within the UI for manual testing.

The OpenAPI specification is served at `GET /documentation/json` and the interactive Swagger UI at `GET /documentation`. In production, access to the documentation routes should be restricted to internal networks or protected by an API key.

API versioning is expressed in the URL path (`/v1/...`). The current version is `v1`. Breaking changes to any route require a new version prefix, not modification of existing versioned routes.

---

## 8. Environment and Configuration

All environment variables are validated at startup using a Zod schema defined in `src/common/env.ts`. If any required variable is missing or fails type validation, the application refuses to start and logs a structured fatal error describing exactly which variables are invalid. There is no runtime fallback for missing configuration.

The configuration schema covers the following: Supabase URL, Supabase service role key, Supabase JWT secret, OpenAI API key, ElevenLabs API key, server port, log level, and environment name (`development`, `staging`, `production`). Sensitive values are never logged.

---

## 9. Database Migrations

All schema changes are managed through versioned SQL migration files in `supabase/migrations/`. Migrations are sequential, immutable, and tracked by Supabase's migration runner. No schema change is applied directly to the database; all changes go through a migration file.

The initial migrations establish the core schema: the user profiles table, the plans table, the recipes table, and the chat threads table. Subsequent migrations add the `pgvector` extension for semantic memory, the memory store table for user preference embeddings, the thread logs table for persistent agent conversation history, and the audit log table.

The audit log table schema uses `UNLOGGED` status consideration for high-throughput scenarios but defaults to a fully logged table to ensure durability. The memory store table uses pgvector's `vector` column type and an `ivfflat` index for approximate nearest-neighbor search. Both tables are created by migrations and never modified by application code outside of insert operations.

---

## 10. Error Handling

Errors in the system are categorized into domain errors and unexpected errors.

**Domain errors** are typed classes defined in `common/errors.ts` — for example, `NotFoundError`, `UnauthorizedError`, `ValidationError`, and `ConflictError`. Services throw these errors. A global Fastify error handler maps domain error types to appropriate HTTP status codes and formats the response body as a consistent JSON error schema documented in the OpenAPI spec.

**Unexpected errors** (those that are not domain errors) are caught by the same global handler, logged at the `error` level with a full stack trace, and returned to the client as a generic 500 with a request ID so the client can report it. The internal error detail is never exposed in the response body in production.

---

## 11. Alignment with HCID UX Principles

The backend architecture is designed to structurally enforce the Human-Centered Interface Design principles defined in the HiveKitchen UX Principles document. This alignment is not advisory; it is embedded in the system design.

**AI Proposes, Humans Decide** is enforced by the separation between agent output and persistence. Agents generate plans, suggestions, and recommendations as typed domain objects. These outputs are returned to the client as proposals. The write path — persisting a plan, updating a preference, confirming a recipe — requires a separate, explicit user-initiated request. No agent tool call persists a final result without a confirmation step mediated by the service layer.

**Progressive Disclosure** is supported by the SSE streaming architecture. The client receives incremental content as the agent produces it, enabling layered rendering — summary first, then detail, then supporting data — without waiting for the complete response. The typed event system allows the client to distinguish between content chunks, tool activity signals, and status updates, enabling progressive UI rendering at each stage.

**Explainability On Demand** is powered by the audit module and agent tool call logging. Every agent run, every tool invocation, and every data source accessed during a response is recorded. When a user requests an explanation, the backend can reconstruct the reasoning chain from the audit trail and present it in plain language through the chat interface or a dedicated explanation endpoint.

**Communicate Uncertainty** is supported at the agent layer through system prompt design and at the API layer through typed response metadata. Agent responses can carry confidence qualifiers and assumption flags as structured fields, not just as prose embedded in the text. The client can use these fields to render uncertainty indicators in the UI.

**Feedback Without Friction** is supported by lightweight feedback endpoints in the chat and plans modules. Thumbs up, thumbs down, and inline edit signals are captured as structured events, persisted through the repository layer, and recorded in the audit trail. The feedback pipeline is asynchronous and adds no latency to the primary response flow.

**Multimodal, Seamless Switching** is supported by the ElevenLabs integration for voice output and the transport-agnostic design of the agents module. The same agent output can be rendered as text via SSE, converted to speech via ElevenLabs, or both. The chat service manages modality context so that switching between text and voice mid-conversation does not disrupt the thread.

---

## 12. Key Architectural Constraints

To preserve the principles outlined in this document, the following constraints are treated as hard rules enforced through code review and, where possible, through linting rules.

No route handler may contain business logic. Handlers call services and return results. Services contain all business logic and call repositories. Repositories contain all database interaction. This three-layer boundary is inviolable within a module.

No file outside `src/plugins/` may import an SDK directly. Supabase, OpenAI, and ElevenLabs clients are always accessed through the Fastify instance decoration or through a constructor-injected interface.

No file within `src/agents/` may import from Fastify or reference HTTP concepts. The agents module is transport-agnostic.

Every new table requires a migration file. No application code creates or alters tables at runtime.

Every new route requires a complete Zod schema covering request inputs and all response shapes before it can be merged.
---