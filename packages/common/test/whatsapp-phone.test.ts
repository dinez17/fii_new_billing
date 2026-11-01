import {expect,it} from "vitest";
import {normalizeWhatsappPhone} from "../src/whatsapp-phone.js";
it("normalizes selected WhatsApp destinations without accepting URLs or messages",()=>{
 expect(normalizeWhatsappPhone("98765 43210")).toBe("919876543210");
 expect(normalizeWhatsappPhone("+91 98765-43210")).toBe("919876543210");
 expect(normalizeWhatsappPhone("+44 7700 900123")).toBe("447700900123");
 expect(normalizeWhatsappPhone(null)).toBeNull();
 expect(normalizeWhatsappPhone("https://example.test")).toBeNull();
 expect(normalizeWhatsappPhone("123")).toBeNull();
});
