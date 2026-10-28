import { z } from "zod";

export const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  otp: z.string().regex(/^\d{6}$/).optional(),
  tenant: z.string().optional(), // legacy field — ignored, tenant comes from the user
});

export const refreshBody = z.object({ refreshToken: z.string().min(32) });

export const passwordResetRequestBody = z.object({
  email: z.string().email(),
  tenant: z.string().min(2).max(100),
});
export const passwordResetBody = z.object({
  token: z.string().min(32),
  newPassword: z.string().min(12).max(72).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/),
});
export const tokenBody = z.object({ token: z.string().min(32) });
export const otpBody = z.object({ code: z.string().regex(/^\d{6}$/) });
export const disableMfaBody = otpBody.extend({ password: z.string().min(1) });

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72)
    .regex(/[A-Z]/, "needs an uppercase letter")
    .regex(/[0-9]/, "needs a digit"),
});

export const createUserBody = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().min(10).max(15).optional(),
  password: z.string().min(8).max(72).optional(),
  roleIds: z.array(z.string().uuid()).min(1),
  status: z.enum(["ACTIVE", "INACTIVE", "LOCKED"]).optional(),
  employeeId: z.string().uuid().optional(),
});
export const updateUserBody = createUserBody.partial();

export const resetPasswordBody = z.object({ newPassword: changePasswordBody.shape.newPassword });

export const createRoleBody = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/, "UPPER_SNAKE_CASE"),
  name: z.string().min(2).max(80),
  description: z.string().max(255).optional(),
  permissionIds: z.array(z.string().uuid()),
});

export const rolePermissionsBody = z.object({ permissionIds: z.array(z.string().uuid()) });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export const auditQuery = pagination.extend({
  userId: z.string().uuid().optional(),
  entity: z.string().optional(),
  action: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
