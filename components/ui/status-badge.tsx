import { AuditStatus, PageStatus } from "@prisma/client";

type SupportedStatus = AuditStatus | PageStatus;

const STATUS_STYLES: Record<SupportedStatus, string> = {
  PENDING:
    "bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
  PROCESSING: "bg-sky-500/10 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  COMPLETE:
    "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  FAILED: "bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
  QUEUED:
    "bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200",
};

const STATUS_LABELS: Record<SupportedStatus, string> = {
  PENDING: "Avvaktar",
  PROCESSING: "Bearbetar",
  COMPLETE: "Klar",
  FAILED: "Misslyckades",
  QUEUED: "Köad"
};

export function StatusBadge({ status }: { status: SupportedStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
