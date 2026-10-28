import { IconButton } from "../../components/IconButton";
import { ListTable } from "../../components/ListPagination";
import { useQuery } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface ExportJob {
  id: string;
  reportType: string;
  format: string;
  status: string;
  error?: string;
  createdAt?: string;
  finishedAt?: string;
}

/** All queued report exports in one place — download when DONE. */
export function ExportsPage() {
  const hasPerm = useAuth((s) => s.hasPerm);

  const jobs = useQuery({
    queryKey: ["report-jobs"],
    queryFn: async () => (await api.get("/reports/export")).data as ExportJob[],
    enabled: hasPerm("report:export"),
    refetchInterval: 4000,
  });

  async function download(jobId: string) {
    try {
      const { data } = await api.get(`/reports/export/${jobId}/download`, { responseType: "blob" });
      window.open(URL.createObjectURL(data), "_blank");
    } catch (err) { alert(errMessage(err)); }
  }

  return (
    <>
      <h2 className="page-title">Report Exports</h2>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>
        Files queued from any report's Export buttons appear here. The list refreshes
        automatically while a job is processing.
      </p>
      <ListTable>
        <thead><tr><th>Report</th><th>Format</th><th>Requested</th><th>Status</th><th /></tr></thead>
        <tbody>
          {jobs.data?.map((j) => (
            <tr key={j.id}>
              <td>{j.reportType.replace(/_/g, " ")}</td>
              <td>{j.format}</td>
              <td>{j.createdAt ? new Date(j.createdAt).toLocaleString() : "—"}</td>
              <td>
                <span className={`badge ${j.status === "DONE" ? "ok" : j.status === "FAILED" ? "warn" : ""}`} title={j.error}>
                  {j.status}
                </span>
                {j.status === "FAILED" && j.error && (
                  <div style={{ fontSize: 12, color: "var(--danger)" }}>{j.error.slice(0, 120)}</div>
                )}
              </td>
              <td>{j.status === "DONE" && <IconButton className="small" onClick={() => void download(j.id)} icon="download" label="Download">Download</IconButton>}</td>
            </tr>
          ))}
          {jobs.data?.length === 0 && (
            <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No exports yet — open a report and use Export CSV/PDF.</td></tr>
          )}
        </tbody>
      </ListTable>
    </>
  );
}
