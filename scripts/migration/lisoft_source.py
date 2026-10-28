"""Read literal phpMyAdmin INSERTs without executing SQL or loading credentials."""
import re
from pathlib import Path

COMPANY_COLUMNS = {
    "user_company_info": "company_id", "user_cust_vendor_details": "user_cust_vendor_comp_id",
    "user_product": "user_product_company_id", "user_bills": "compid", "user_bill_details": "company_id",
    "user_purchase_bills": "compid", "user_purchase_bill_details": "company_id",
    "user_receipt": "receipt_comp_id", "user_purchase_receipt": "receipt_comp_id",
    "user_quotes": "compid", "user_quote_details": "company_id", "user_quotes1": "compid", "user_quote1_details": "company_id",
}

def literal(token):
    value = token.strip()
    if value == "NULL":
        return None
    if value.startswith("'") and value.endswith("'"):
        value = value[1:-1]
        result, i = [], 0
        escapes = {"0": "\0", "b": "\b", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a"}
        while i < len(value):
            if value[i] == "\\" and i + 1 < len(value):
                result.append(escapes.get(value[i + 1], value[i + 1])); i += 2
            elif value[i:i+2] == "''":
                result.append("'"); i += 2
            else:
                result.append(value[i]); i += 1
        return "".join(result)
    if not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", value):
        raise ValueError("Non-literal SQL value rejected")
    return value

def read_dump(path, companies=("1", "30")):
    sql = Path(path).read_text(encoding="utf-8-sig", errors="strict")
    tables = {name: [] for name in COMPANY_COLUMNS}
    for match in re.finditer(r"^INSERT INTO `([^`]+)`\s*\((.*?)\)\s*VALUES\s*", sql, re.S | re.M):
        name = match.group(1)
        if name not in tables:
            continue
        columns = re.findall(r"`([^`]+)`", match.group(2))
        index, token, values, quoted, in_row = match.end(), "", [], False, False
        while index < len(sql):
            char = sql[index]
            if quoted:
                if char == "\\" and index + 1 < len(sql):
                    token += sql[index:index+2]; index += 2; continue
                if char == "'":
                    if sql[index:index+2] == "''":
                        token += "''"; index += 2; continue
                    quoted = False
                token += char
            elif char == "'":
                quoted = True; token += char
            elif char == "(":
                if in_row:
                    raise ValueError("Nested SQL expression rejected")
                in_row, token, values = True, "", []
            elif char in ",)" and in_row:
                values.append(literal(token)); token = ""
                if char == ")":
                    if len(values) != len(columns):
                        raise ValueError(f"Column count mismatch in {name}")
                    row = dict(zip(columns, values))
                    if row[COMPANY_COLUMNS[name]] in companies:
                        tables[name].append(row)
                    in_row = False
            elif char == ";":
                break
            elif in_row:
                token += char
            index += 1
        if quoted or in_row:
            raise ValueError(f"Incomplete INSERT in {name}")
    return tables
