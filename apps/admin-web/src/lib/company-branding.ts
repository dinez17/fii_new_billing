import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

export function companyBrandingQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["company", "sidebar-branding", userId],
    queryFn: async () => (await api.get("/settings/branding")).data as {
      name: string;
      logoUrl: string | null;
      gstin: string | null;
    },
    enabled: !!userId,
  });
}
