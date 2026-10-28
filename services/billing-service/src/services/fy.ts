import { prisma } from "@fii/database";
import { badRequest } from "@fii/common";

/** Returns the active FY and asserts `date` falls inside it and it's unlocked. */
export async function assertActiveFy(tenantId: string, date: Date) {
  const fy = await prisma.financialYear.findFirst({ where: { tenantId, isActive: true } });
  if (!fy) throw badRequest("No active financial year — create/activate one in Settings");
  if (fy.isLocked) throw badRequest(`FY ${fy.code} is locked`);
  if (date < fy.startDate || date > fy.endDate) {
    throw badRequest(`Document date must fall inside the active FY ${fy.code}`);
  }
  return fy;
}
