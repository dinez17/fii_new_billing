import {describe,it,expect} from "vitest";
import {calculateTdsSettlement as calculate} from "../../../apps/admin-web/src/features/payments/tds-calculation";
const row={id:"one",balance:5600,date:"2026-10-31",number:"FII/90"};
describe("selected invoice TDS settlement",()=>{
  it("calculates the requested invoice-minus-receipt example exactly",()=>{
    expect(calculate([row],"5552.47")).toMatchObject({valid:true,tdsAmount:"47.53",allocations:{one:"5552.47"},tdsAllocations:{one:"47.53"}});
  });
  it("uses outstanding balance after prior payments",()=>expect(calculate([{...row,balance:600}],"590").tdsAmount).toBe("10.00"));
  it("does not include unselected invoices",()=>expect(calculate([],"0").tdsAmount).toBe("0.00"));
  it("rejects negative and invalid cash",()=>{for(const amount of ["-1","bad"])expect(calculate([row],amount).valid).toBe(false);});
  it("settles 998 from a 1000 receipt and leaves 2 on account without TDS",()=>{
    const result=calculate([{...row,balance:499},{...row,id:"two",balance:499}],"1000");
    expect(result).toMatchObject({valid:true,selectedBalance:"998.00",tdsAmount:"0.00",allocations:{one:"499.00",two:"499.00"},tdsAllocations:{}});
    expect(1000-Object.values(result.allocations).reduce((sum,value)=>sum+Number(value),0)).toBe(2);
  });
  it("supports a TDS-only settlement",()=>expect(calculate([row],"0").tdsAllocations).toEqual({one:"5600.00"}));
  it("allocates cash oldest first and the remaining balance as TDS",()=>{
    expect(calculate([{...row,id:"new",date:"2026-11-01",balance:200},{...row,balance:100}],"250")).toMatchObject({allocations:{one:"100.00",new:"150.00"},tdsAllocations:{new:"50.00"},tdsAmount:"50.00"});
  });
});
