"""Generate an idempotent PostgreSQL staging import; never execute source SQL."""
import argparse
import hashlib
import json
from pathlib import Path
from lisoft_source import COMPANY_COLUMNS, read_dump

def sql_text(value):
    text = json.dumps(value, ensure_ascii=False)
    delimiter = "$lisoft_" + hashlib.sha256(text.encode()).hexdigest()[:20] + "$"
    if delimiter in text:
        raise ValueError("SQL delimiter collision")
    return delimiter + text + delimiter

def create_staging_sql(source):
    digest = hashlib.sha256(Path(source).read_bytes()).hexdigest()
    tables = read_dump(source)
    lines = ["BEGIN;", "CREATE TABLE IF NOT EXISTS migration_source (source_sha256 text PRIMARY KEY, company_ids integer[] NOT NULL, imported_at timestamptz NOT NULL DEFAULT now());",
        "CREATE TABLE IF NOT EXISTS migration_row (source_sha256 text NOT NULL REFERENCES migration_source(source_sha256), company_id integer NOT NULL CHECK(company_id IN (1,30)), source_table text NOT NULL, source_id text NOT NULL, row_data jsonb NOT NULL, PRIMARY KEY(source_sha256,company_id,source_table,source_id));",
        f"INSERT INTO migration_source(source_sha256,company_ids) VALUES('{digest}',ARRAY[1,30]) ON CONFLICT DO NOTHING;"]
    keys = {"user_company_info": "company_id", "user_cust_vendor_details": "user_cust_vendor_id", "user_product": "user_product_id", "user_bills": "billid", "user_purchase_bills": "billid", "user_receipt": "user_receipt_id", "user_purchase_receipt": "user_receipt_id", "user_quotes": "billid", "user_quotes1": "billid"}
    counts = {}
    for table, rows in tables.items():
        key = keys.get(table, "id")
        counts[table] = len(rows)
        seen = set()
        for row in rows:
            source_id = row[key]
            if not source_id.isdigit():
                raise ValueError("Non-numeric source ID")
            identity = (row[COMPANY_COLUMNS[table]], source_id)
            if identity in seen:
                raise ValueError(f"Duplicate source ID in {table}")
            seen.add(identity)
            lines.append(f"INSERT INTO migration_row VALUES ('{digest}',{identity[0]},'{table}','{source_id}',{sql_text(row)}::jsonb) ON CONFLICT DO NOTHING;")
    lines.extend(["COMMIT;", f"SELECT company_id,source_table,count(*) FROM migration_row WHERE source_sha256='{digest}' GROUP BY company_id,source_table ORDER BY company_id,source_table;"])
    return "\n".join(lines), digest, counts

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("source"); parser.add_argument("--output", default="reports/migration/lisoft/staging-import.sql")
    args = parser.parse_args(); sql, digest, counts = create_staging_sql(args.source)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True); Path(args.output).write_text(sql, encoding="utf-8")
    print(json.dumps({"source_sha256": digest, "staged_rows": sum(counts.values()), "counts": counts}))
