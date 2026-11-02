import {beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({settings:vi.fn(),create:vi.fn()}));
vi.mock("@fii/database",()=>({prisma:{setting:{findMany:mocks.settings}}}));
vi.mock("@fii/common",async original=>({...await original<object>(),decryptSecret:(s:string)=>s}));
vi.mock("nodemailer",()=>({default:{createTransport:mocks.create}}));
vi.mock("../src/services/pdf.service.js",()=>({buildInvoicePdfBuffer:vi.fn()}));
vi.mock("@fii/pdf",()=>({buildSalesDocumentPdfBuffer:vi.fn()}));
import {smtpFor} from "../src/services/mail.service.js";
const config=(password:string,port="587")=>Object.entries({enabled:"true",host:"smtp.example.test",port,user:"sender@example.test",password}).map(([key,value])=>({key,value,isSecret:key==="password"}));
describe("SMTP credential refresh",()=>{
 beforeEach(()=>{mocks.settings.mockReset();mocks.create.mockReset();});
 it("reuses unchanged settings, then replaces and closes the stale connection after password or port changes",async()=>{
  const first={close:vi.fn()},second={close:vi.fn()},third={close:vi.fn()};mocks.create.mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third);
  mocks.settings.mockResolvedValue(config("old-test-password"));expect((await smtpFor("refresh-test")).t).toBe(first);expect((await smtpFor("refresh-test")).t).toBe(first);expect(mocks.create).toHaveBeenCalledTimes(1);
  mocks.settings.mockResolvedValue(config("new-test-password"));expect((await smtpFor("refresh-test")).t).toBe(second);expect(first.close).toHaveBeenCalledOnce();expect(mocks.create.mock.calls[1][0].auth.pass).toBe("new-test-password");
  mocks.settings.mockResolvedValue(config("new-test-password","465"));expect((await smtpFor("refresh-test")).t).toBe(third);expect(second.close).toHaveBeenCalledOnce();expect(mocks.create.mock.calls[2][0].secure).toBe(true);
 });
 it("keeps tenants independent",async()=>{const first={close:vi.fn()},second={close:vi.fn()};mocks.create.mockReturnValueOnce(first).mockReturnValueOnce(second);mocks.settings.mockResolvedValue(config("fake-app-password"));await smtpFor("tenant-first");await smtpFor("tenant-second");expect(first.close).not.toHaveBeenCalled();expect(mocks.create).toHaveBeenCalledTimes(2);});
});
