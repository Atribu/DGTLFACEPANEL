"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCheck,
  Clock3,
  Download,
  Eye,
  FileText,
  LoaderCircle,
  Printer,
  RefreshCw,
} from "lucide-react";
import { today, type ViewProps } from "@/lib/client";
import { STATUS_LABELS, type TaskStatus } from "@/lib/types";
import {
  defaultReportPeriod,
  reportDateLabel,
  reportFilename,
  reportQuery,
  validateReportFilters,
  type HotelReport,
  type ReportFilters,
  type ReportTask,
} from "@/lib/reports";
import { BrandLogo } from "./brand";
import { EmptyState, PageHeader, PriorityBadge, StatusBadge } from "./ui";
import styles from "./reports.module.css";

const statusOrder: TaskStatus[] = [
  "completed",
  "in_progress",
  "review",
  "waiting",
  "planned",
];
const statusClass: Record<TaskStatus, string> = {
  planned: styles.planned,
  in_progress: styles.inProgress,
  waiting: styles.waiting,
  review: styles.review,
  completed: styles.completed,
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Rapor hazırlanamadı. Lütfen tekrar deneyin.";

export function ReportsView({ data, notify, navigate, refresh }: ViewProps) {
  const [draft, setDraft] = useState<ReportFilters>(() => ({
    hotelId: data.hotels[0]?.id || "",
    ...defaultReportPeriod(today()),
    includeUndated: false,
  }));
  const [applied, setApplied] = useState<ReportFilters | null>(() =>
    data.hotels.length
      ? {
          hotelId: data.hotels[0].id,
          ...defaultReportPeriod(today()),
          includeUndated: false,
        }
      : null,
  );
  const [report, setReport] = useState<HotelReport | null>(null);
  const [loading, setLoading] = useState(Boolean(applied));
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [openingTask, setOpeningTask] = useState<string | null>(null);
  const query = applied ? reportQuery(applied) : "";
  const dirty = !applied || reportQuery(draft) !== query;
  const patchDraft = (patch: Partial<ReportFilters>) =>
    setDraft((current) => ({ ...current, ...patch }));

  useEffect(() => {
    document.body.classList.add("report-print-view");
    return () => document.body.classList.remove("report-print-view");
  }, []);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setReport(null);
    void fetch(`/api/reports?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Rapor yüklenemedi.");
        if (!controller.signal.aborted) setReport(result.report as HotelReport);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, retry]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const next = validateReportFilters(draft);
      setFormError("");
      setLoading(true);
      setApplied(next);
      setRetry((value) => value + 1);
    } catch (cause) {
      setFormError(errorText(cause));
    }
  }

  async function downloadCsv() {
    if (!report || loading || exporting || dirty) return;
    setExporting(true);
    try {
      const response = await fetch(
        `/api/reports/export?${reportQuery(report.filters)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "CSV indirilemedi.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers
          .get("content-disposition")
          ?.match(/filename="([^"]+)"/)?.[1] || reportFilename(report);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      notify("Excel için CSV dosyası hazırlandı.");
    } catch (cause) {
      notify(errorText(cause), "error");
    } finally {
      setExporting(false);
    }
  }

  async function openTask(taskId: string) {
    if (openingTask) return;
    setOpeningTask(taskId);
    try {
      await refresh();
      navigate("task", taskId);
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : "Görev bilgileri alınamadı.",
        "error",
      );
    } finally {
      setOpeningTask(null);
    }
  }

  function taskTable(rows: ReportTask[], label: string) {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={label}>
          <thead>
            <tr>
              <th>Görev</th>
              <th>Departman</th>
              <th>Sorumlu</th>
              <th>Öncelik</th>
              <th>Teslim tarihi</th>
              <th>Güncel durum</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => (
              <tr key={task.id}>
                <td>
                  <span className={styles.taskCode}>{task.code}</span>
                  <button
                    className={styles.taskLink}
                    onClick={() => void openTask(task.id)}
                    disabled={openingTask !== null}
                    aria-busy={openingTask === task.id}
                  >
                    {task.title}
                    {openingTask === task.id ? (
                      <LoaderCircle
                        size={12}
                        className="spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowUpRight size={12} aria-hidden="true" />
                    )}
                  </button>
                  {task.waitingReason && (
                    <span className={styles.waitingReason}>
                      <strong>Bekleme nedeni: </strong>
                      {task.waitingReason}
                    </span>
                  )}
                </td>
                <td>{task.department}</td>
                <td>{task.assigneeName}</td>
                <td>
                  <PriorityBadge value={task.priority} />
                </td>
                <td>
                  <span>
                    {task.dueDate ? reportDateLabel(task.dueDate) : "Tarih yok"}
                  </span>
                  {task.overdue && (
                    <span className={styles.overdue}>Gecikti</span>
                  )}
                </td>
                <td>
                  <StatusBadge status={task.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div data-report-controls>
        <PageHeader
          eyebrow="OTEL PERFORMANSI"
          title="Raporlar"
          description="Bir otelin seçili dönemde teslim tarihi bulunan işlerini raporlayın."
        />
        <form className={`panel ${styles.filters}`} onSubmit={submit}>
          <div className={styles.filterFields}>
            <label className={styles.field}>
              <span>Otel</span>
              <select
                className="select"
                aria-label="Rapor oteli"
                value={draft.hotelId}
                onChange={(event) =>
                  patchDraft({ hotelId: event.target.value })
                }
                required
                disabled={!data.hotels.length}
              >
                <option value="" disabled>
                  Otel seçin
                </option>
                {data.hotels.map((hotel) => (
                  <option value={hotel.id} key={hotel.id}>
                    {hotel.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Başlangıç tarihi</span>
              <input
                className="input"
                aria-label="Rapor başlangıç tarihi"
                type="date"
                value={draft.from}
                onChange={(event) => patchDraft({ from: event.target.value })}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Bitiş tarihi</span>
              <input
                className="input"
                aria-label="Rapor bitiş tarihi"
                type="date"
                value={draft.to}
                min={draft.from || undefined}
                onChange={(event) => patchDraft({ to: event.target.value })}
                required
              />
            </label>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!data.hotels.length || loading}
            >
              {loading ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <BarChart3 size={15} />
              )}
              Raporu getir
            </button>
          </div>
          <div className={styles.filterBottom}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={draft.includeUndated}
                onChange={(event) =>
                  patchDraft({ includeUndated: event.target.checked })
                }
              />
              Tarihsiz görevleri ek bölüm olarak ekle
            </label>
            <span>En fazla 366 gün</span>
          </div>
          {formError && (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          )}
        </form>
        <div className={styles.reportToolbar}>
          <span>
            {dirty && report
              ? "Filtreler değişti. Güncellemek için Raporu getir düğmesine basın."
              : "Teslim tarihi bu dönemde olan görevlerin güncel durumu"}
          </span>
          <div>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => window.print()}
              disabled={!report || loading || dirty}
            >
              <Printer size={14} />
              Yazdır / PDF
            </button>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => void downloadCsv()}
              disabled={!report || loading || exporting || dirty}
            >
              {exporting ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Download size={14} />
              )}
              Excel için CSV
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <section
          className={`panel ${styles.loading}`}
          data-report-controls
          role="status"
        >
          <LoaderCircle size={27} className="spin" />
          <h3>Otel raporu hazırlanıyor</h3>
          <p>Görevlerin güncel durumları alınıyor.</p>
        </section>
      )}
      {!loading && error && (
        <section className="panel" data-report-controls>
          <EmptyState
            title="Rapor yüklenemedi"
            description={error}
            action={
              <button
                className="btn btn-secondary"
                onClick={() => setRetry((value) => value + 1)}
              >
                <RefreshCw size={15} />
                Tekrar dene
              </button>
            }
          />
        </section>
      )}
      {!data.hotels.length && (
        <section className="panel" data-report-controls>
          <EmptyState
            title="Raporlanacak otel bulunmuyor"
            description="Erişiminiz olan otellerin raporları burada görüntülenir."
          />
        </section>
      )}

      {!loading && report && (
        <article className={`panel ${styles.document}`} data-hotel-report>
          <header className={styles.documentHeader}>
            <div className={styles.brandRow}>
              <BrandLogo />
              <span className={styles.documentLabel}>
                <FileText size={15} />
                OTEL İŞ RAPORU
              </span>
            </div>
            <div className={styles.reportHeading}>
              <div>
                <h2>{report.hotel.name}</h2>
                <p>{report.hotel.location}</p>
              </div>
              <div className={styles.period}>
                <CalendarDays size={16} />
                <span>
                  {reportDateLabel(report.filters.from)}
                  <span> — </span>
                  {reportDateLabel(report.filters.to)}
                </span>
              </div>
            </div>
            <p className={styles.scope}>
              Teslim tarihi bu dönemde olan görevlerin güncel durumu
            </p>
            <div className={styles.documentMeta}>
              <span>
                Rapor oluşturma:{" "}
                {new Intl.DateTimeFormat("tr-TR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Europe/Istanbul",
                }).format(new Date(report.generatedAt))}{" "}
                · Türkiye saati
              </span>
              <span>{report.hotel.services.join(" · ")}</span>
            </div>
          </header>

          <div className={styles.metrics}>
            {[
              {
                label: "Dönemde teslim tarihli",
                value: report.summary.total,
                Icon: FileText,
                tone: styles.totalMetric,
              },
              {
                label: "Tamamlandı",
                value: report.summary.completed,
                Icon: CheckCheck,
                tone: styles.completeMetric,
              },
              {
                label: "Devam ediyor",
                value: report.summary.in_progress,
                Icon: Clock3,
                tone: styles.progressMetric,
              },
              {
                label: "Kontrol bekliyor",
                value: report.summary.review,
                Icon: Eye,
                tone: styles.reviewMetric,
              },
              {
                label: "Geciken",
                value: report.summary.overdue,
                Icon: CalendarDays,
                tone: styles.lateMetric,
              },
            ].map(({ label, value, Icon, tone }) => (
              <div key={label} className={`${styles.metric} ${tone}`}>
                <span>
                  <Icon size={15} />
                  {label}
                </span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          <section
            className={styles.distribution}
            aria-label="Güncel görev durumlarının dağılımı"
          >
            <div className={styles.distributionHeading}>
              <h3>Güncel durum dağılımı</h3>
              <span>
                <strong>%{report.summary.completionRate}</strong> tamamlandı
              </span>
            </div>
            <div className={styles.statusTrack} aria-hidden="true">
              {statusOrder.map(
                (status) =>
                  report.summary[status] > 0 && (
                    <span
                      className={statusClass[status]}
                      key={status}
                      style={{
                        width: `${(report.summary[status] / report.summary.total) * 100}%`,
                      }}
                    />
                  ),
              )}
            </div>
            <div className={styles.legend}>
              {statusOrder.map((status) => (
                <span key={status}>
                  <i className={statusClass[status]} />
                  {STATUS_LABELS[status]}
                  <strong>{report.summary[status]}</strong>
                </span>
              ))}
            </div>
          </section>

          <div className={styles.sectionTitle}>
            <div>
              <h3>Dönemin görevleri</h3>
              <p>
                Öncelik 1 en yüksek, 10 en düşük. Gecikme{" "}
                {reportDateLabel(report.today)} itibarıyla hesaplanır.
              </p>
            </div>
            <span>{report.tasks.length} görev</span>
          </div>
          {report.tasks.length ? (
            taskTable(report.tasks, "Seçili dönemde teslim tarihli görevler")
          ) : (
            <div className={styles.emptyReport}>
              <CalendarDays size={23} />
              <strong>Bu dönemde teslim tarihli görev yok</strong>
              <p>
                Farklı bir tarih aralığı seçebilir veya tarihsiz görevleri ek
                bölüme dahil edebilirsiniz.
              </p>
            </div>
          )}

          <div className={styles.undatedNote}>
            <CalendarDays size={15} />
            <span>
              Bu otelde <strong>{report.undated.count} tarihsiz görev</strong>{" "}
              bulunuyor. Bu görevler dönem toplamlarına dahil değildir.
              {report.undated.included && " Ayrı ek bölümde listelenmiştir."}
            </span>
          </div>
          {report.undated.included && (
            <section>
              <div className={styles.sectionTitle}>
                <div>
                  <h3>Tarihsiz görevler · Ek bölüm</h3>
                  <p>
                    Dönem filtresinin dışında, teslim tarihi belirlenmemiş
                    işler.
                  </p>
                </div>
                <span>{report.undated.tasks.length} görev</span>
              </div>
              {report.undated.tasks.length ? (
                taskTable(report.undated.tasks, "Tarihsiz görevler ek bölümü")
              ) : (
                <p className={styles.noUndated}>
                  Bu otelde tarihsiz görev bulunmuyor.
                </p>
              )}
            </section>
          )}
          <footer className={styles.documentFooter}>
            <strong>DGTLFACE</strong>
            <span>
              Bu rapor teslim tarihi kapsamına göre güncel durumu gösterir;
              seçili dönemde tamamlanan işlerin tarihçesi değildir.
            </span>
          </footer>
        </article>
      )}
    </div>
  );
}
