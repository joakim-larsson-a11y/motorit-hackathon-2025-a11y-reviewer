import { AuditStatus, PageStatus } from "@prisma/client";

type SupportedStatus = AuditStatus | PageStatus;

const STATUS_STYLES: Record<SupportedStatus, string> = {
  PENDING: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
  PROCESSING: "bg-sky-500/10 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  COMPLETE_WITH_ISSUES:
    "bg-amber-600/10 text-amber-700 dark:bg-amber-600/20 dark:text-amber-200",
  COMPLETE_NO_ISSUES:
    "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  FAILED: "bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
  QUEUED: "bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200",
  IN_PROGRESS: "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200",
};

const STATUS_LABELS: Record<SupportedStatus, string> = {
  PENDING: "Avvaktar",
  PROCESSING: "Bearbetar",
  COMPLETE_WITH_ISSUES: "Klar med problem",
  COMPLETE_NO_ISSUES: "Klar utan problem",
  FAILED: "Misslyckades",
  QUEUED: "Köad",
  IN_PROGRESS: "Pågår",
};

export function StatusBadge({ status }: { status: SupportedStatus }) {
  const style =
    STATUS_STYLES[status] ??
    "bg-slate-500/10 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200";
  const label = STATUS_LABELS[status] ?? status;

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
