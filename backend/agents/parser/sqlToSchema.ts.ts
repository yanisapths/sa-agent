import { Parser } from "node-sql-parser";

export interface Column {
  name: string;
  type: string;
  nullable?: boolean;
  primary?: boolean;
  unique?: boolean;
  default?: string | null;
  references?: {
    table: string;
    column: string;
  };
}

export interface TableSchema {
  table: string;
  columns: Column[];
  primaryKeys: string[];
  foreignKeys: {
    column: string;
    references: { table: string; column: string };
  }[];
}

const parser = new Parser();

export function parseSQLToSchema(sql: string): TableSchema[] {
  const ast = parser.astify(sql);
  const statements = Array.isArray(ast) ? ast : [ast];

  const tables: TableSchema[] = [];

  for (const stmt of statements) {
    const s = stmt as any;
    if (s?.type !== "create") continue;
    if (s?.keyword !== "table") continue;

    const tableName: string | undefined = Array.isArray(s.table)
      ? s.table?.[0]?.table
      : s.table?.table;
    if (!tableName) continue;

    const schema: TableSchema = {
      table: tableName,
      columns: [],
      primaryKeys: [],
      foreignKeys: [],
    };

    const createDefinitions: any[] = s.create_definitions ?? [];
    for (const def of createDefinitions) {
      // Column definition
      if (def.resource === "column") {
        const colName: string | undefined = def.column?.column ?? def.column;
        if (!colName) continue;
        const col: Column = {
          name: colName,
          type: def.definition?.dataType || "unknown",
          nullable: !def.nullable,
        };

        // Constraints
        if ((def as any).primary_key) {
          col.primary = true;
          schema.primaryKeys.push(col.name);
        }

        if (def.unique) {
          col.unique = true;
        }

        if (def.default_val) {
          col.default = def.default_val.value;
        }

        schema.columns.push(col);
      }

      // Table-level constraints (FK, PK)
      if (def.resource === "constraint") {
        const constraintType: string = String(
          def.constraint_type ?? "",
        ).toLowerCase();
        if (constraintType === "primary key") {
          for (const c of def.definition ?? []) {
            const colName: string | undefined =
              c?.column ?? c?.expr?.column ?? c;
            if (colName) schema.primaryKeys.push(colName);
          }
        }

        if (constraintType === "foreign key") {
          const fkCol: string | undefined =
            def.definition?.[0]?.column ?? def.definition?.[0]?.expr?.column;
          const ref = def.reference;
          if (!fkCol || !ref) continue;

          const fk = {
            column: fkCol,
            references: {
              table: Array.isArray(ref.table)
                ? ref.table?.[0]?.table
                : ref.table?.table,
              column:
                ref.definition?.[0]?.column ??
                ref.definition?.[0]?.expr?.column,
            },
          };
          if (!fk.references.table || !fk.references.column) continue;

          schema.foreignKeys.push(fk);

          // attach to column
          const col = schema.columns.find((c) => c.name === fkCol);
          if (col) {
            col.references = fk.references;
          }
        }
      }
    }

    tables.push(schema);
  }

  return tables;
}
