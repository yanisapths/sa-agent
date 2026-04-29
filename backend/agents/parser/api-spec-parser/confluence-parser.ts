import { Document } from "@langchain/core/documents";

// ─── Types ────────────────────────────────────────────────────────────────────

type Field = {
  name: string;
  type: string;
  required: boolean;
  location?: string;
  description?: string;
};

type ResponseCode = {
  httpCode: string;
  bodyCode: string;
  scenario: string;
  description: string;
};

type DatabaseTable = {
  tableName: string;
  columns: string[];
  operation: string; // e.g. "INSERT", "SELECT", "UPDATE"
};

type ParsedAPI = {
  method: string;
  endpoint: string;
  objective: string;
  database: DatabaseTable[];
  requestFields: Field[];
  responseFields: Field[];
  responseCodes: ResponseCode[];
  requestSample: string;
  responseSample: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

type Section =
  | "none"
  | "objective"
  | "database"
  | "request_schema"
  | "request_sample"
  | "response_code"
  | "response_schema"
  | "response_sample";

const SECTION_MARKERS: { pattern: RegExp; section: Section }[] = [
  { pattern: /^OBJECTIVE$/i, section: "objective" },
  { pattern: /^DATABASE$/i, section: "database" },
  { pattern: /^REQUEST SCHEMA$/i, section: "request_schema" },
  { pattern: /^REQUEST SAMPLE$/i, section: "request_sample" },
  { pattern: /^RESPONSE CODE$/i, section: "response_code" },
  { pattern: /^RESPONSE SCHEMA$/i, section: "response_schema" },
  { pattern: /^RESPONSE SAMPLE$/i, section: "response_sample" },
  // Stop sections — things that look like content but mark a boundary
  {
    pattern: /^(REQUEST|RESPONSE|SEQUENCE DIAGRAM|DIAGRAM|CHANGE LOG)$/i,
    section: "none",
  },
];

const SKIP_LINES = new Set([
  "FIELD NAME",
  "LOCATION",
  "TYPE",
  "MANDATORY (M/O/C)",
  "M/O/C",
  "DESCRIPTION",
  "REMARK",
  "FIELD",
  "HTTP CODE",
  "BODY CODE",
  "SCENARIO",
  "TABLE",
  "COLUMN",
]);

// Lines that look like HTTP sample headers — stop schema parsing
const HTTP_SAMPLE_LINE = /^HTTP\s+\d{3}/i;

function isSkippable(line: string): boolean {
  return line === "" || /^-+$/.test(line) || SKIP_LINES.has(line.toUpperCase());
}

function stripColorSuffix(s: string): string {
  return s.replace(/(Green|Red|Yellow|Blue|Orange)$/i, "").trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEndpoint(title?: string) {
  const match = title?.match(/\[(GET|POST|PUT|DELETE|PATCH)\]\s*(.+)/i);
  return {
    method: match?.[1]?.toUpperCase() || "UNKNOWN",
    endpoint: match?.[2]?.trim() || "",
  };
}

function isSectionMarker(line: string): boolean {
  return SECTION_MARKERS.some((m) => m.pattern.test(line));
}

// ─── Row consumers ────────────────────────────────────────────────────────────

/**
 * Request schema rows: index, name, location, type, mandatory, ?description, ?remark
 * Each cell is on its own line.
 */
function consumeRequestRow(
  lines: string[],
  startIndex: number,
): { field: Field; consumed: number } | null {
  const first = lines[startIndex]?.trim();
  if (!first || !/^\d+$/.test(first)) return null;

  const VALID_LOCATIONS = /^(header|body|query|path param|path)$/i;

  const cells: string[] = [first];
  let i = startIndex + 1;

  while (i < lines.length && cells.length < 7) {
    const line = lines[i].trim();
    if (isSectionMarker(line)) break;
    // A bare digit alone = new row index — but only after we have enough cells
    if (/^\d+$/.test(line) && cells.length >= 4) break;
    cells.push(line);
    i++;
  }

  if (cells.length < 4) return null;

  const [, name, location, type, mandatory = "O"] = cells;
  if (!VALID_LOCATIONS.test(location?.trim() ?? "")) return null;

  // description = everything after mandatory, joined (handles multi-line remarks)
  const description = cells.slice(5).join(" ").trim();

  return {
    field: {
      name: name?.trim(),
      location: location?.trim(),
      type: type?.trim(),
      required: mandatory?.trim().toUpperCase() === "M",
      description: description || cells[5]?.trim() || "",
    },
    consumed: i - startIndex,
  };
}

/**
 * Response schema rows: index, fieldName, type, mandatory, ?description
 * Stops at HTTP sample lines like "HTTP 200", "HTTP 400"
 */
function consumeResponseFieldRow(
  lines: string[],
  startIndex: number,
): { field: Field; consumed: number } | null {
  const first = lines[startIndex]?.trim();
  if (!first || !/^\d+$/.test(first)) return null;

  const cells: string[] = [first];
  let i = startIndex + 1;

  while (i < lines.length && cells.length < 5) {
    const line = lines[i].trim();
    if (isSectionMarker(line)) break;
    if (HTTP_SAMPLE_LINE.test(line)) break; // response sample labels bleeding in
    if (/^\d+$/.test(line) && cells.length >= 3) break;
    cells.push(line);
    i++;
  }

  if (cells.length < 3) return null;

  const [, name, type, mandatory = "O", description = ""] = cells;
  if (!/^(M|O|C)$/i.test(mandatory?.trim())) return null;

  return {
    field: {
      name: name?.trim(),
      type: type?.trim(),
      required: mandatory?.trim().toUpperCase() === "M",
      description: description?.trim(),
    },
    consumed: i - startIndex,
  };
}

/**
 * Response code rows: "200 OKGreen", "2000Green", "Scenario", "?description"
 */
function consumeResponseCodeRow(
  lines: string[],
  startIndex: number,
): { code: ResponseCode; consumed: number } | null {
  const first = lines[startIndex]?.trim();
  if (!first || !/^\d{3}\s/.test(first)) return null;

  const cells: string[] = [first];
  let i = startIndex + 1;

  while (i < lines.length && cells.length < 4) {
    const line = lines[i].trim();
    if (isSectionMarker(line)) break;
    if (/^\d{3}\s/.test(line)) break; // next HTTP status row
    cells.push(line);
    i++;
  }

  if (cells.length < 2) return null;

  return {
    code: {
      httpCode: stripColorSuffix(cells[0]),
      bodyCode: stripColorSuffix(cells[1] ?? ""),
      scenario: stripColorSuffix(cells[2] ?? ""),
      description: stripColorSuffix(cells[3] ?? ""),
    },
    consumed: i - startIndex,
  };
}

/**
 * Database section format:
 *   <table_name>
 *    * column_one
 *    * column_two
 *   [INSERT] - insert data into tbl: <table_name>
 *
 * A new table starts when we see a line that is NOT a bullet, NOT an operation,
 * and NOT a skip line — i.e. a plain table name.
 */
function parseDatabaseSection(
  lines: string[],
  startIndex: number,
): {
  tables: DatabaseTable[];
  consumed: number;
} {
  const tables: DatabaseTable[] = [];
  let i = startIndex;

  let currentTable: DatabaseTable | null = null;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (isSectionMarker(line) && line.toUpperCase() !== "DATABASE") break;
    if (isSkippable(line)) {
      i++;
      continue;
    }

    // Operation line: [INSERT], [SELECT], [UPDATE], [DELETE]
    const opMatch = line.match(/^\[(INSERT|SELECT|UPDATE|DELETE)\]/i);
    if (opMatch) {
      if (currentTable) {
        currentTable.operation = opMatch[1].toUpperCase();
        tables.push(currentTable);
        currentTable = null;
      }
      i++;
      continue;
    }

    // Bullet column line: " * column_name" or "* column_name"
    const bulletMatch = line.match(/^\*\s+(.+)/);
    if (bulletMatch) {
      if (currentTable) {
        currentTable.columns.push(bulletMatch[1].trim());
      }
      i++;
      continue;
    }

    // Otherwise it's a table name — start a new table block
    // But first push any dangling table without an operation
    if (currentTable) {
      tables.push(currentTable);
    }
    currentTable = { tableName: line, columns: [], operation: "SELECT" };
    i++;
  }

  // Push last table if no trailing operation line
  if (currentTable) tables.push(currentTable);

  return { tables, consumed: i - startIndex };
}

// ─── Main plain-text parser ───────────────────────────────────────────────────

function parsePlainText(
  content: string,
  method: string,
  endpoint: string,
): ParsedAPI {
  const rawLines = content.split("\n").map((l) => l.trim());

  let section: Section = "none";
  const requestFields: Field[] = [];
  const responseFields: Field[] = [];
  const responseCodes: ResponseCode[] = [];
  const objectiveLines: string[] = [];
  const requestSampleLines: string[] = [];
  const responseSampleLines: string[] = [];
  let database: DatabaseTable[] = [];

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];

    // ── Section detection ──────────────────────────────────────────────────
    const sectionMatch = SECTION_MARKERS.find((m) => m.pattern.test(line));
    if (sectionMatch) {
      section = sectionMatch.section;

      // Database needs its own multi-line consumer
      if (section === "database") {
        const result = parseDatabaseSection(rawLines, i + 1);
        database = result.tables;
        i += result.consumed + 1;
        section = "none";
        continue;
      }

      i++;
      continue;
    }

    if (isSkippable(line)) {
      i++;
      continue;
    }

    // ── Per-section consumption ────────────────────────────────────────────

    if (section === "objective") {
      // Collect numbered objective lines: "1. Create user..." or bare text
      // Stop at things that look like section headers
      objectiveLines.push(line.replace(/^\d+\.\s*/, "").trim());
      i++;
      continue;
    }

    if (section === "request_schema") {
      const result = consumeRequestRow(rawLines, i);
      if (result) {
        requestFields.push(result.field);
        i += result.consumed;
        continue;
      }
    }

    if (section === "response_schema") {
      // Hard stop at HTTP sample lines
      if (HTTP_SAMPLE_LINE.test(line)) {
        i++;
        continue;
      }
      const result = consumeResponseFieldRow(rawLines, i);
      if (result) {
        responseFields.push(result.field);
        i += result.consumed;
        continue;
      }
    }

    if (section === "response_code") {
      const result = consumeResponseCodeRow(rawLines, i);
      if (result) {
        responseCodes.push(result.code);
        i += result.consumed;
        continue;
      }
    }

    if (section === "request_sample") {
      requestSampleLines.push(line);
    }
    if (section === "response_sample") {
      responseSampleLines.push(line);
    }

    i++;
  }

  return {
    method,
    endpoint,
    objective: objectiveLines.join(" | "),
    database,
    requestFields,
    responseFields,
    responseCodes,
    requestSample: requestSampleLines.join("\n").trim(),
    responseSample: responseSampleLines.join("\n").trim(),
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function parseConfluenceToDocuments(
  doc: Document<Record<string, any>>,
): Document[] {
  const rawContent = doc.pageContent;
  const { method, endpoint } = parseEndpoint(doc.metadata.title);
  const parsed = parsePlainText(rawContent, method, endpoint);
  return buildDocuments(parsed, doc.metadata);
}

// ─── Build final Documents ────────────────────────────────────────────────────
function buildDocuments(
  parsed: ParsedAPI,
  originalMetadata: Record<string, any>,
): Document[] {
  const {
    method,
    endpoint,
    objective,
    database,
    requestFields,
    responseFields,
    responseCodes,
    requestSample,
    responseSample,
  } = parsed;

  const docs: Document[] = [];

  // 1. Summary — natural language, best for semantic search
  docs.push(
    new Document({
      pageContent: [
        `${method} ${endpoint} is an API endpoint in the ${serviceFromEndpoint(endpoint)} service.`,
        objective ? `Purpose: ${objective}.` : "",
        requestFields.length > 0
          ? `It accepts ${requestFields
              .filter((f) => f.required)
              .map((f) => f.name)
              .join(", ")} as required inputs` +
            (requestFields.some((f) => !f.required)
              ? ` and ${requestFields
                  .filter((f) => !f.required)
                  .map((f) => f.name)
                  .join(", ")} as optional.`
              : ".")
          : "",
        responseFields.length > 0
          ? `It returns ${responseFields.map((f) => f.name).join(", ")}.`
          : "",
        database.length > 0
          ? `Database: ${database.map((t) => `${t.operation}s into ${t.tableName}`).join(", ")}.`
          : "",
        responseCodes.length > 0
          ? `Possible errors: ${responseCodes
              .filter((c) => !c.httpCode.startsWith("200"))
              .map((c) => `${c.bodyCode} (${c.scenario})`)
              .join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      metadata: {
        type: "api_summary",
        endpoint,
        method,
        service: serviceFromEndpoint(endpoint),
        writes_tables: database
          .filter((t) => t.operation !== "SELECT")
          .map((t) => t.tableName),
        reads_tables: database
          .filter((t) => t.operation === "SELECT")
          .map((t) => t.tableName),
        requires_auth: requestFields.some(
          (f) => f.name.toLowerCase() === "authorization" && f.required,
        ),
        title: originalMetadata.title,
        source: originalMetadata.url,
      },
    }),
  );

  // 2. Overview — structured, good for "what does X do + what params"
  docs.push(
    new Document({
      pageContent: [
        `API Endpoint: ${method} ${endpoint}`,
        objective ? `Objective: ${objective}` : "",
        requestFields.length > 0 ? "\nRequest Fields:" : "",
        ...requestFields.map(
          (f) =>
            `- ${f.name} (${f.type}, ${f.required ? "required" : "optional"}) [${f.location}]` +
            (f.description ? ` — ${f.description}` : ""),
        ),
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        type: "api_overview",
        endpoint,
        method,
        title: originalMetadata.title,
        source: originalMetadata.url,
      },
    }),
  );

  // 3. Request schema — "what params does X take?"
  if (requestFields.length > 0) {
    docs.push(
      new Document({
        pageContent: [
          `Request schema for ${method} ${endpoint}:`,
          ...requestFields.map(
            (f) =>
              `- ${f.name}: ${f.type} (${f.required ? "required" : "optional"})` +
              (f.location ? ` in ${f.location}` : "") +
              (f.description ? ` — ${f.description}` : ""),
          ),
          requestSample ? `\nExample:\n${requestSample}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: { type: "api_request", endpoint, method },
      }),
    );
  }

  // 4. Response schema — "what does X return?"
  if (responseFields.length > 0 || responseSample) {
    docs.push(
      new Document({
        pageContent: [
          `Response schema for ${method} ${endpoint}:`,
          ...responseFields.map(
            (f) =>
              `- ${f.name}: ${f.type} (${f.required ? "required" : "optional"})` +
              (f.description ? ` — ${f.description}` : ""),
          ),
          responseSample ? `\nExample:\n${responseSample}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: { type: "api_response", endpoint, method },
      }),
    );
  }

  // 5. Error codes — "what errors can X return?"
  if (responseCodes.length > 0) {
    docs.push(
      new Document({
        pageContent: [
          `Response codes for ${method} ${endpoint}:`,
          ...responseCodes.map(
            (c) =>
              `- HTTP ${c.httpCode} / code ${c.bodyCode}: ${c.scenario}` +
              (c.description ? ` — ${c.description}` : ""),
          ),
        ].join("\n"),
        metadata: { type: "api_errors", endpoint, method },
      }),
    );
  }

  // 6. Database — "which tables does X touch?"
  if (database.length > 0) {
    docs.push(
      new Document({
        pageContent: [
          `Database operations for ${method} ${endpoint}:`,
          ...database.map(
            (t) =>
              `- [${t.operation}] ${t.tableName}` +
              (t.columns.length > 0
                ? `\n  columns: ${t.columns.join(", ")}`
                : ""),
          ),
        ].join("\n"),
        metadata: {
          type: "api_database",
          endpoint,
          method,
          writes_tables: database
            .filter((t) => t.operation !== "SELECT")
            .map((t) => t.tableName),
          reads_tables: database
            .filter((t) => t.operation === "SELECT")
            .map((t) => t.tableName),
        },
      }),
    );
  }

  return docs;
}

function serviceFromEndpoint(endpoint: string): string {
  const match = endpoint.match(/\/([^/]+)-service/);
  return match ? match[1] : "unknown";
}
