import { isDeepStrictEqual } from "node:util";

const expectedSchema = {
  columns: [
    ["dub_segments", 1, "id", "uuid", true, "gen_random_uuid()"],
    ["dub_segments", 2, "dub_id", "uuid", true, ""],
    ["dub_segments", 3, "idx", "integer", true, ""],
    ["dub_segments", 4, "start_ms", "integer", true, ""],
    ["dub_segments", 5, "end_ms", "integer", true, ""],
    ["dub_segments", 6, "original_text", "text", true, "''"],
    ["dub_segments", 7, "text", "text", true, "''"],
    ["dub_segments", 8, "audio_key", "text", true, ""],
    ["dub_segments", 9, "mime", "text", true, "'audio/mpeg'"],
    ["dubs", 1, "id", "uuid", true, "gen_random_uuid()"],
    ["dubs", 2, "platform", "text", true, ""],
    ["dubs", 3, "video_id", "text", true, ""],
    ["dubs", 4, "source_lang", "text", true, ""],
    ["dubs", 5, "target_lang", "text", true, ""],
    ["dubs", 6, "voice", "text", true, ""],
    ["dubs", 7, "provider", "text", true, ""],
    ["dubs", 8, "title", "text", true, "''"],
    ["dubs", 9, "visibility", "text", true, "'public'"],
    ["dubs", 10, "status", "text", true, "'pending'"],
    ["dubs", 11, "owner_token_hash", "text", true, ""],
    ["dubs", 12, "duration_ms", "integer", true, "0"],
    ["dubs", 13, "segment_count", "integer", true, "0"],
    ["dubs", 14, "created_at", "timestamp with time zone", true, "now()"],
    ["dubs", 15, "updated_at", "timestamp with time zone", true, "now()"],
    ["dubs", 16, "generation_profile", "text", false, ""],
    ["dubs", 17, "voice_profile", "text", false, ""],
    ["dubs", 18, "rights_asserted_at", "timestamp with time zone", false, ""]
  ],
  constraints: [
    ["dub_segments", "dub_segments_dub_id_dubs_id_fk", "f", "FOREIGN KEY (dub_id) REFERENCES dubs(id) ON DELETE CASCADE"],
    ["dub_segments", "dub_segments_pkey", "p", "PRIMARY KEY (id)"],
    ["dubs", "dubs_pkey", "p", "PRIMARY KEY (id)"]
  ],
  indexes: [
    ["dub_segments", "dub_segments_dub_idx", true, "btree", ["dub_id", "idx"]],
    ["dubs", "dubs_lookup_idx", true, "btree", ["platform", "video_id", "target_lang", "voice", "provider"]],
    ["dubs", "dubs_public_idx", false, "btree", ["visibility", "created_at"]]
  ]
};

function normalizeExpression(value) {
  return (value ?? "")
    .replaceAll('"', "")
    .replaceAll("public.", "")
    .replace(/::text\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/,\s+/g, ", ")
    .trim();
}

export async function readManagedTableNames(sql) {
  const rows = await sql`
    SELECT c.relname AS "tableName"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN ('dubs', 'dub_segments')
    ORDER BY c.relname
  `;
  return rows.map((row) => row.tableName);
}

export async function readManagedSchema(sql) {
  const columnRows = await sql`
    SELECT
      c.relname AS "tableName",
      a.attnum AS "ordinalPosition",
      a.attname AS "columnName",
      format_type(a.atttypid, a.atttypmod) AS "dataType",
      a.attnotnull AS "isNotNull",
      pg_get_expr(ad.adbin, ad.adrelid) AS "columnDefault"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN ('dubs', 'dub_segments')
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum
  `;
  const constraintRows = await sql`
    SELECT
      c.relname AS "tableName",
      con.conname AS "constraintName",
      con.contype AS "constraintType",
      pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('dubs', 'dub_segments')
    ORDER BY c.relname, con.conname
  `;
  const indexRows = await sql`
    SELECT
      t.relname AS "tableName",
      i.relname AS "indexName",
      x.indisunique AS "isUnique",
      am.amname AS method,
      array_agg(a.attname ORDER BY key.ordinality) AS columns
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_am am ON am.oid = i.relam
    CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS key(attnum, ordinality)
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum
    LEFT JOIN pg_constraint con ON con.conindid = x.indexrelid
    WHERE n.nspname = 'public'
      AND t.relname IN ('dubs', 'dub_segments')
      AND con.oid IS NULL
    GROUP BY t.relname, i.relname, x.indisunique, am.amname
    ORDER BY t.relname, i.relname
  `;
  return {
    columns: columnRows.map((row) => [
      row.tableName,
      Number(row.ordinalPosition),
      row.columnName,
      row.dataType,
      row.isNotNull,
      normalizeExpression(row.columnDefault)
    ]),
    constraints: constraintRows.map((row) => [
      row.tableName,
      row.constraintName,
      row.constraintType,
      normalizeExpression(row.definition)
    ]),
    indexes: indexRows.map((row) => [
      row.tableName,
      row.indexName,
      row.isUnique,
      row.method,
      row.columns
    ])
  };
}

export async function assertManagedSchema(sql) {
  const actualSchema = await readManagedSchema(sql);
  if (!isDeepStrictEqual(actualSchema, expectedSchema)) {
    throw new Error(`Managed schema mismatch\nexpected=${JSON.stringify(expectedSchema)}\nactual=${JSON.stringify(actualSchema)}`);
  }
  return actualSchema;
}

export async function readManagedRowCounts(sql) {
  const [row] = await sql`
    SELECT
      (SELECT count(*) FROM dubs) AS dubs,
      (SELECT count(*) FROM dub_segments) AS "dubSegments"
  `;
  return {
    dubs: String(row.dubs),
    dubSegments: String(row.dubSegments)
  };
}

export async function readMigrationCount(sql) {
  const [relation] = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS name`;
  if (!relation.name) {
    return 0;
  }
  const [row] = await sql`SELECT count(*) AS count FROM drizzle.__drizzle_migrations`;
  return Number(row.count);
}

export function formatRowCounts(counts) {
  return `dubs=${counts.dubs} dub_segments=${counts.dubSegments}`;
}
