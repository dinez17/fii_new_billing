import {describe,it,expect} from "vitest";
import {parseCsv,bankRows} from "../src/bank-csv.js";
describe("mapped bank statement CSV",()=>{
 it("handles BOM, quoted separators, escaped quotes and multiline narration",()=>{const r=parseCsv('\uFEFFDate,Ref,Narration,Debit,Credit\r\n31/10/2026,UTR1,"Customer, ""A""\nline",,"1,500.25"');expect(r[0][0]).toBe("Date");expect(r[1][2]).toContain("Customer,");expect(bankRows(r,{date:0,reference:1,narration:2,debit:3,credit:4,dateFormat:"DMY"})[0].credit).toBe(1500.25);});
 it("rejects impossible dates and mixed directions",()=>{expect(()=>bankRows(parseCsv('Date,Ref,Debit,Credit\n31-02-2026,A,0,10'),{date:0,reference:1,narration:-1,debit:2,credit:3,dateFormat:"DMY"})).toThrow("calendar date");expect(()=>bankRows(parseCsv('Date,Ref,Debit,Credit\n2026-10-31,A,1,10'),{date:0,reference:1,narration:-1,debit:2,credit:3,dateFormat:"ISO"})).toThrow("exactly one");});
});
