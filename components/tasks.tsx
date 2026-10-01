"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Clock3,
  Columns3,
  CornerUpLeft,
  Eye,
  List,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import {
  api,
  dateLabel,
  departments,
  isOverdue,
  sortTasks,
  today,
  type ViewProps,
} from "@/lib/client";
import {
  STATUS_LABELS,
  type Activity,
  type BootstrapData,
  type Task,
  type TaskComment,
  type TaskStatus,
} from "@/lib/types";
import {
  Avatar,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  PriorityBadge,
  StatusBadge,
  SubmitButton,
} from "./ui";
import { TaskAttachments } from "./task-attachments";

const statuses = Object.keys(STATUS_LABELS) as TaskStatus[];
type QuickFilter = "all" | "mine" | "today" | "overdue" | "review";
type Filters = {
  query: string;
  hotel: string;
  department: string;
  status: string;
  quick: QuickFilter;
  mode: "list" | "board";
};
const defaultFilters: Filters = {
  query: "",
  hotel: "",
  department: "",
  status: "",
  quick: "all",
  mode: "list",
};
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
const timestamp = (value: string) =>
  new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));

export function TasksView(props: ViewProps) {
  const { data, navigate } = props;
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [loaded, setLoaded] = useState(false);
  const [composer, setComposer] = useState(false);
  const isAdmin = data.user.role === "admin";
  const patchFilter = (patch: Partial<Filters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(
        `dgtlface-task-filters-${data.user.id}`,
      );
      if (stored) {
        const saved = JSON.parse(stored) as Partial<Filters>;
        setFilters({
          query: typeof saved.query === "string" ? saved.query : "",
          hotel: typeof saved.hotel === "string" ? saved.hotel : "",
          department:
            typeof saved.department === "string" ? saved.department : "",
          status: statuses.includes(saved.status as TaskStatus)
            ? saved.status!
            : "",
          quick: ["all", "mine", "today", "overdue", "review"].includes(
            saved.quick || "",
          )
            ? saved.quick!
            : "all",
          mode: saved.mode === "board" ? "board" : "list",
        });
      } else setFilters(defaultFilters);
    } catch {
      /* A blocked browser storage should not block task access. */
    }
    setLoaded(true);
  }, [data.user.id]);
  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(
        `dgtlface-task-filters-${data.user.id}`,
        JSON.stringify(filters),
      );
    } catch {
      /* Keep the current view usable without storage. */
    }
  }, [data.user.id, filters, loaded]);

  const hotelById = useMemo(
    () => new Map(data.hotels.map((hotel) => [hotel.id, hotel])),
    [data.hotels],
  );
  const userById = useMemo(
    () => new Map(data.users.map((user) => [user.id, user])),
    [data.users],
  );
  const departmentOptions = useMemo(
    () =>
      [
        ...new Set([
          ...departments,
          ...data.tasks.map((task) => task.department),
        ]),
      ].filter(Boolean),
    [data.tasks],
  );
  const tasks = useMemo(
    () =>
      sortTasks(
        data.tasks.filter((task) => {
          const query = filters.query.trim().toLocaleLowerCase("tr");
          const searchable =
            `${task.title} ${task.code} ${hotelById.get(task.hotelId)?.name || ""} ${task.department}`.toLocaleLowerCase(
              "tr",
            );
          if (query && !searchable.includes(query)) return false;
          if (filters.hotel && task.hotelId !== filters.hotel) return false;
          if (filters.department && task.department !== filters.department)
            return false;
          if (filters.status && task.status !== filters.status) return false;
          if (filters.quick === "mine" && task.assigneeId !== data.user.id)
            return false;
          if (
            filters.quick === "today" &&
            (task.dueDate?.slice(0, 10) !== today() ||
              task.status === "completed")
          )
            return false;
          if (filters.quick === "overdue" && !isOverdue(task)) return false;
          if (filters.quick === "review" && task.status !== "review")
            return false;
          return true;
        }),
      ),
    [data.tasks, data.user.id, filters, hotelById],
  );
  const activeCount = data.tasks.filter(
    (task) => task.status !== "completed",
  ).length;
  const overdueCount = data.tasks.filter(isOverdue).length;
  const reviewCount = data.tasks.filter(
    (task) => task.status === "review",
  ).length;
  const quickFilters: { value: QuickFilter; label: string; count?: number }[] =
    [
      { value: "all", label: "Tüm işler", count: data.tasks.length },
      ...(data.user.role !== "observer"
        ? [
            {
              value: "mine" as const,
              label: "İşlerim",
              count: data.tasks.filter(
                (task) => task.assigneeId === data.user.id,
              ).length,
            },
          ]
        : []),
      { value: "today", label: "Bugün" },
      { value: "overdue", label: "Gecikenler", count: overdueCount },
      { value: "review", label: "Kontrol bekleyen", count: reviewCount },
    ];
  const hasFilters = Boolean(
    filters.query ||
    filters.hotel ||
    filters.department ||
    filters.status ||
    filters.quick !== "all",
  );

  return (
    <>
      <PageHeader
        eyebrow="ÇALIŞMA ALANI"
        title="Görevler"
        description="Her işin bir sorumlusu, her adımın net bir önceliği var."
        actions={
          isAdmin ? (
            <button
              className="btn btn-primary"
              onClick={() => setComposer(true)}
            >
              <Plus size={17} /> Yeni görev
            </button>
          ) : undefined
        }
      />
      <div className="task-summary-line">
        <span>
          <span className="task-summary-dot" /> <strong>{activeCount}</strong>{" "}
          açık görev
        </span>
        <span>
          <Clock3 size={14} /> <strong>{overdueCount}</strong> geciken
        </span>
        <span>
          <Eye size={14} /> <strong>{reviewCount}</strong> kontrol bekleyen
        </span>
      </div>
      <section className="panel task-workspace">
        <div className="toolbar task-toolbar">
          <div
            className="quick-filters"
            role="group"
            aria-label="Hızlı görev filtreleri"
          >
            {quickFilters.map((filter) => (
              <button
                key={filter.value}
                className={`tab ${filters.quick === filter.value ? "active" : ""}`}
                aria-pressed={filters.quick === filter.value}
                onClick={() => patchFilter({ quick: filter.value })}
              >
                {filter.label}
                {filter.count !== undefined && (
                  <span className="tab-count">{filter.count}</span>
                )}
              </button>
            ))}
          </div>
          <div className="view-switch" role="group" aria-label="Görev görünümü">
            <button
              className={`icon-btn ${filters.mode === "list" ? "active" : ""}`}
              aria-label="Liste görünümü"
              title="Liste"
              aria-pressed={filters.mode === "list"}
              onClick={() => patchFilter({ mode: "list" })}
            >
              <List size={17} />
            </button>
            <button
              className={`icon-btn ${filters.mode === "board" ? "active" : ""}`}
              aria-label="Pano görünümü"
              title="Pano"
              aria-pressed={filters.mode === "board"}
              onClick={() => patchFilter({ mode: "board" })}
            >
              <Columns3 size={17} />
            </button>
          </div>
        </div>
        <div className="filter-row task-filter-row">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Görev ara"
              placeholder="Görev veya otel ara..."
              value={filters.query}
              onChange={(event) => patchFilter({ query: event.target.value })}
            />
          </label>
          <select
            className="select"
            aria-label="Otele göre filtrele"
            value={filters.hotel}
            onChange={(event) => patchFilter({ hotel: event.target.value })}
          >
            <option value="">Tüm oteller</option>
            {data.hotels.map((hotel) => (
              <option key={hotel.id} value={hotel.id}>
                {hotel.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Ekibe göre filtrele"
            value={filters.department}
            onChange={(event) =>
              patchFilter({ department: event.target.value })
            }
          >
            <option value="">Tüm ekipler</option>
            {departmentOptions.map((department) => (
              <option key={department}>{department}</option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Duruma göre filtrele"
            value={filters.status}
            onChange={(event) => patchFilter({ status: event.target.value })}
          >
            <option value="">Tüm durumlar</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              className="btn btn-small btn-secondary"
              onClick={() =>
                setFilters({ ...defaultFilters, mode: filters.mode })
              }
            >
              Temizle
            </button>
          )}
        </div>
        <div className="task-list-meta">
          <span>{tasks.length} görev gösteriliyor</span>
          <span>
            <ArrowDownWideNarrow size={14} /> Öncelik: 1 → 10{" "}
            <span className="desktop-only">· ardından teslim tarihi</span>
          </span>
        </div>
        {tasks.length === 0 ? (
          <EmptyState
            title="Bu görünümde görev yok"
            description={
              hasFilters
                ? "Farklı bir filtre seçebilir veya filtreleri temizleyebilirsiniz."
                : "Otel işleri oluşturulduğunda burada görünecek."
            }
            action={
              hasFilters ? (
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    setFilters({ ...defaultFilters, mode: filters.mode })
                  }
                >
                  Filtreleri temizle
                </button>
              ) : isAdmin ? (
                <button
                  className="btn btn-primary"
                  onClick={() => setComposer(true)}
                >
                  <Plus size={16} /> İlk görevi oluştur
                </button>
              ) : undefined
            }
          />
        ) : filters.mode === "list" ? (
          <div className="table-wrap">
            <table className="data-table task-table">
              <thead>
                <tr>
                  <th>Görev</th>
                  <th>Otel</th>
                  <th>Sorumlu</th>
                  <th>Durum</th>
                  <th>Öncelik</th>
                  <th>Teslim tarihi</th>
                  <th>
                    <span className="sr-only">Görevi aç</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, index) => {
                  const assignee = task.assigneeId
                    ? userById.get(task.assigneeId)
                    : undefined;
                  return (
                    <tr
                      key={task.id}
                      className={`${task.status === "completed" ? "completed-task" : ""} ${task.status === "completed" && tasks[index - 1]?.status !== "completed" ? "completed-first" : ""}`}
                    >
                      <td>
                        <button
                          className="task-title-link"
                          onClick={() => navigate("task", task.id)}
                        >
                          <span
                            className={`task-state-mark state-${task.status}`}
                          >
                            {task.status === "completed" && <Check size={11} />}
                          </span>
                          <span>
                            <strong>{task.title}</strong>
                            <span className="subtext">
                              {task.code} <span>·</span> {task.department}
                              {task.status === "waiting" && task.waitingReason
                                ? ` · ${task.waitingReason}`
                                : ""}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="hotel-cell">
                          <span
                            className="hotel-dot"
                            style={{
                              background:
                                hotelById.get(task.hotelId)?.color ||
                                "var(--accent)",
                            }}
                          />
                          {hotelById.get(task.hotelId)?.name || "Otel"}
                        </span>
                      </td>
                      <td>
                        {assignee ? (
                          <span className="assignee-cell">
                            <Avatar name={assignee.name} size="small" />
                            <span>{assignee.name}</span>
                          </span>
                        ) : (
                          <span className="muted">Atanmadı</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={task.status} />
                      </td>
                      <td>
                        <PriorityBadge value={task.priority} />
                      </td>
                      <td>
                        <span
                          className={
                            isOverdue(task) ? "due-overdue" : "due-date"
                          }
                        >
                          <CalendarDays size={13} />
                          {dateLabel(task.dueDate)}
                        </span>
                      </td>
                      <td>
                        <button
                          className="icon-btn"
                          aria-label={`${task.title} görevini aç`}
                          onClick={() => navigate("task", task.id)}
                        >
                          <ChevronRight size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="board">
            {statuses.map((status) => (
              <section className={`board-column board-${status}`} key={status}>
                <div className="board-column-heading">
                  <StatusBadge status={status} />
                  <span className="muted">
                    {tasks.filter((task) => task.status === status).length}
                  </span>
                </div>
                <div className="stack">
                  {tasks
                    .filter((task) => task.status === status)
                    .map((task) => {
                      const assignee = task.assigneeId
                        ? userById.get(task.assigneeId)
                        : undefined;
                      return (
                        <button
                          key={task.id}
                          className="task-card"
                          onClick={() => navigate("task", task.id)}
                        >
                          <div className="task-card-top">
                            <span className="subtext">{task.code}</span>
                            <PriorityBadge value={task.priority} />
                          </div>
                          <h3>{task.title}</h3>
                          <span className="subtext">
                            {hotelById.get(task.hotelId)?.name} ·{" "}
                            {task.department}
                          </span>
                          {task.status === "waiting" && task.waitingReason && (
                            <div className="task-card-waiting">
                              {task.waitingReason}
                            </div>
                          )}
                          <div className="task-card-footer">
                            <span
                              className={
                                isOverdue(task) ? "due-overdue" : "due-date"
                              }
                            >
                              <CalendarDays size={13} />
                              {dateLabel(task.dueDate)}
                            </span>
                            {assignee ? (
                              <Avatar name={assignee.name} size="small" />
                            ) : (
                              <span className="muted">Atanmadı</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  {!tasks.some((task) => task.status === status) && (
                    <p className="board-empty">Bu aşamada görev yok</p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
        {tasks.length > 0 && (
          <div className="task-table-footer">
            <ShieldCheck size={14} />
            <span>
              {data.user.role === "observer"
                ? "Yalnızca size bağlı otellerin işlerini görüntülüyorsunuz."
                : data.user.role === "staff"
                  ? "Tüm işleri görebilir, kendinize atanan görevleri güncelleyebilirsiniz."
                  : "Görev önceliklerini ve sorumlularını yönetici olarak düzenleyebilirsiniz."}
            </span>
          </div>
        )}
      </section>
      {composer && (
        <TaskComposer
          {...props}
          hotelId={filters.hotel || undefined}
          onClose={() => setComposer(false)}
        />
      )}
    </>
  );
}

export function TaskDetail(props: ViewProps & { taskId: string }) {
  const { data, taskId, refresh, notify, navigate } = props;
  const task = data.tasks.find((item) => item.id === taskId);
  const [busy, setBusy] = useState("");
  const [composer, setComposer] = useState(false);
  const [reasonModal, setReasonModal] = useState<"waiting" | "return" | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [activityTab, setActivityTab] = useState<"comments" | "history">(
    "comments",
  );
  const [historyRetry, setHistoryRetry] = useState(0);
  const [history, setHistory] = useState<{
    taskId: string;
    source: BootstrapData;
    status: "loading" | "ready" | "error";
    comments: TaskComment[];
    activities: Activity[];
    error: string;
  } | null>(null);

  useEffect(() => {
    setComposer(false);
    setReasonModal(null);
    setReason("");
    setComment("");
    setActivityTab("comments");
  }, [taskId]);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const base = {
      taskId,
      source: data,
      comments: [] as TaskComment[],
      activities: [] as Activity[],
      error: "",
    };
    setHistory({ ...base, status: "loading" });
    void fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          task: Task;
          comments: TaskComment[];
          activities: Activity[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || "Görev geçmişi yüklenemedi.");
        if (result.task.id !== taskId)
          throw new Error("Görev geçmişi doğrulanamadı.");
        if (current && !controller.signal.aborted)
          setHistory({
            ...base,
            status: "ready",
            comments: result.comments,
            activities: result.activities,
          });
      })
      .catch((error: unknown) => {
        if (current && !controller.signal.aborted)
          setHistory({ ...base, status: "error", error: errorMessage(error) });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [taskId, data, historyRetry]);

  if (!task)
    return (
      <EmptyState
        title="Görev bulunamadı"
        description="Görev kaldırılmış olabilir veya bu göreve erişim yetkiniz olmayabilir."
        action={
          <button
            className="btn btn-secondary"
            onClick={() => navigate("tasks")}
          >
            <ArrowLeft size={16} /> Görevlere dön
          </button>
        }
      />
    );
  const hotel = data.hotels.find((item) => item.id === task.hotelId);
  const assignee = data.users.find((item) => item.id === task.assigneeId);
  const isAdmin = data.user.role === "admin";
  const canWork =
    isAdmin || (data.user.role === "staff" && task.assigneeId === data.user.id);
  const canEdit =
    canWork && task.status !== "review" && task.status !== "completed";
  const doneCount = task.checklist.filter((item) => item.done).length;
  const allDone = task.checklist.every((item) => item.done);
  const currentHistory =
    history?.taskId === taskId && history.source === data ? history : null;
  const historyComplete = currentHistory?.status === "ready";
  const comments = [
    ...(historyComplete
      ? currentHistory.comments
      : data.comments.filter((item) => item.taskId === taskId)),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const activities = [
    ...(historyComplete
      ? currentHistory.activities
      : data.activities.filter((item) => item.taskId === taskId)),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  async function mutate(
    body: Record<string, unknown>,
    success: string,
    action: string,
  ) {
    if (busy) return false;
    setBusy(action);
    try {
      await api(`/api/tasks/${taskId}`, body, "PATCH");
      await refresh();
      notify(success);
      return true;
    } catch (error) {
      notify(errorMessage(error), "error");
      return false;
    } finally {
      setBusy("");
    }
  }
  async function submitReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) return;
    const success =
      reasonModal === "return"
        ? await mutate(
            { action: "return", reason: reason.trim() },
            "Görev düzeltme için geri gönderildi.",
            "return",
          )
        : await mutate(
            {
              action: "status",
              status: "waiting",
              waitingReason: reason.trim(),
            },
            "Görev beklemeye alındı.",
            "waiting",
          );
    if (success) {
      setReasonModal(null);
      setReason("");
    }
  }
  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comment.trim() || busy) return;
    setBusy("comment");
    try {
      await api(`/api/tasks/${taskId}/comments`, { body: comment.trim() });
      setComment("");
      setHistoryRetry((value) => value + 1);
      try {
        await refresh();
        notify("Yorum eklendi.");
      } catch {
        notify(
          "Yorum kaydedildi; ekran yenilenemedi. Yeniden yorum göndermenize gerek yok.",
          "error",
        );
      }
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <nav className="breadcrumbs" aria-label="Sayfa yolu">
        <button onClick={() => navigate("tasks")}>Görevler</button>
        <ChevronRight size={13} />
        <button onClick={() => navigate("hotel", task.hotelId)}>
          {hotel?.name || "Otel"}
        </button>
        <ChevronRight size={13} />
        <span>{task.code}</span>
      </nav>
      <PageHeader
        eyebrow={`${task.code} · ${task.department}`}
        title={task.title}
        description={`${hotel?.name || "Otel"} · ${task.stage || "Genel"}`}
        actions={
          isAdmin ? (
            <button
              className="btn btn-secondary"
              onClick={() => setComposer(true)}
            >
              <Pencil size={16} /> Görevi düzenle
            </button>
          ) : undefined
        }
      />
      <div className="task-detail-band panel">
        <div>
          <span className="detail-label">Durum</span>
          <StatusBadge status={task.status} />
        </div>
        <div>
          <span className="detail-label">Öncelik</span>
          <span className="inline-items">
            <PriorityBadge value={task.priority} />
            <span className="muted">/ 10</span>
          </span>
        </div>
        <div>
          <span className="detail-label">Teslim tarihi</span>
          <span className={isOverdue(task) ? "due-overdue" : "due-date"}>
            <CalendarDays size={15} />
            {dateLabel(task.dueDate)}
            {isOverdue(task) && <span className="tag">Gecikti</span>}
          </span>
        </div>
        <div>
          <span className="detail-label">Tamamlanma kriterleri</span>
          <span className="inline-items">
            <CircleCheck size={16} />
            <strong>
              {doneCount} / {task.checklist.length}
            </strong>
            <span className="muted">tamamlandı</span>
          </span>
        </div>
      </div>
      <div className="detail-grid task-detail-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <ClipboardList size={18} /> Görev açıklaması
              </h2>
            </div>
            <div className="panel-body">
              <p className="preserve-whitespace">
                {task.description || "Bu görev için ek açıklama girilmedi."}
              </p>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <CircleCheck size={18} /> Tamamlanma kriterleri
              </h2>
              <span className="chip">
                {doneCount}/{task.checklist.length}
              </span>
            </div>
            <div className="panel-body">
              <p className="muted task-section-intro">
                İşi kontrole göndermeden önce aşağıdaki adımları tamamlayın.
              </p>
              {task.checklist.length ? (
                <div className="checklist">
                  {task.checklist.map((item) => (
                    <label
                      key={item.id}
                      className={`checklist-item ${item.done ? "checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={!canEdit || Boolean(busy)}
                        onChange={(event) =>
                          void mutate(
                            {
                              action: "checklist",
                              itemId: item.id,
                              done: event.target.checked,
                            },
                            event.target.checked
                              ? "Kriter tamamlandı."
                              : "Kriter yeniden açıldı.",
                            item.id,
                          )
                        }
                      />
                      <span>{item.text}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  Bu görev için ayrı bir kontrol maddesi tanımlanmadı.
                </p>
              )}
              {canEdit && (
                <div className="task-submit-row">
                  <span className="subtext">
                    {allDone
                      ? "Görev yönetici kontrolüne gönderilmeye hazır."
                      : `${task.checklist.length - doneCount} kriter daha tamamlanmalı.`}
                  </span>
                  <button
                    className="btn btn-primary"
                    disabled={!allDone || Boolean(busy)}
                    onClick={() =>
                      void mutate(
                        { action: "submit" },
                        "Görev yönetici kontrolüne gönderildi.",
                        "submit",
                      )
                    }
                  >
                    <Send size={15} />{" "}
                    {busy === "submit" ? "Gönderiliyor…" : "Kontrole gönder"}
                  </button>
                </div>
              )}
              {task.status === "review" && (
                <div className="notice">
                  <Eye size={17} />
                  <span>
                    İş kontrol aşamasında. Tamamlanması için yönetici onayı
                    bekleniyor.
                  </span>
                </div>
              )}
              {task.status === "completed" && (
                <div className="notice">
                  <CheckCheck size={17} />
                  <span>
                    Bu görev yönetici tarafından onaylandı ve tamamlandı.
                  </span>
                </div>
              )}
            </div>
          </section>
          {(task.hotelInput || task.waitingReason) && (
            <section
              className={`panel ${task.status === "waiting" ? "task-waiting-panel" : ""}`}
            >
              <div className="panel-heading">
                <h2>
                  <Building2 size={18} /> Otelden beklenenler
                </h2>
                {task.status === "waiting" && <StatusBadge status="waiting" />}
              </div>
              <div className="panel-body">
                {task.hotelInput && (
                  <p className="preserve-whitespace">{task.hotelInput}</p>
                )}
                {task.waitingReason && (
                  <div className="notice notice-warning">
                    <Clock3 size={17} />
                    <div>
                      <strong>Bekleme nedeni</strong>
                      <p className="preserve-whitespace">
                        {task.waitingReason}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
          <TaskAttachments
            key={task.id}
            task={task}
            user={data.user}
            refresh={refresh}
            notify={notify}
          />
          <section className="panel">
            <div className="toolbar task-activity-toolbar">
              <div
                className="tabs"
                role="group"
                aria-label="Görev geçmişi görünümü"
              >
                <button
                  className={`tab ${activityTab === "comments" ? "active" : ""}`}
                  onClick={() => setActivityTab("comments")}
                  aria-pressed={activityTab === "comments"}
                >
                  <MessageSquare size={15} /> Yorumlar{" "}
                  <span className="tab-count">{comments.length}</span>
                </button>
                <button
                  className={`tab ${activityTab === "history" ? "active" : ""}`}
                  onClick={() => setActivityTab("history")}
                  aria-pressed={activityTab === "history"}
                >
                  <Clock3 size={15} /> İşlem geçmişi
                </button>
              </div>
            </div>
            <div className="panel-body">
              {!historyComplete &&
                (currentHistory?.status === "error" ? (
                  <div className="notice notice-warning" role="alert">
                    <div>
                      <strong>Tam görev geçmişi yüklenemedi.</strong>
                      <p>
                        Görünen kayıtlar eksik veya güncel olmayabilir.{" "}
                        {currentHistory.error}
                      </p>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => setHistoryRetry((value) => value + 1)}
                      >
                        Tekrar dene
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="notice" role="status">
                    <Clock3 size={17} />
                    <span>
                      Tüm yorumlar ve işlem geçmişi yükleniyor. Şimdilik son
                      görünümdeki kayıtlar gösteriliyor.
                    </span>
                  </div>
                ))}
              {activityTab === "comments" ? (
                <>
                  <div className="stack">
                    {comments.length ? (
                      comments.map((item) => (
                        <article className="comment" key={item.id}>
                          <Avatar name={item.userName} size="small" />
                          <div className="comment-content">
                            <div className="comment-heading">
                              <strong>{item.userName}</strong>
                              <time dateTime={item.createdAt}>
                                {timestamp(item.createdAt)}
                              </time>
                            </div>
                            <p className="preserve-whitespace">{item.body}</p>
                          </div>
                        </article>
                      ))
                    ) : (
                      <p className="muted">
                        {historyComplete
                          ? "Henüz yorum yok. Görevle ilgili notlar burada toplanır."
                          : "Son görünümde yorum bulunmuyor."}
                      </p>
                    )}
                  </div>
                  {canWork && (
                    <form className="comment-form" onSubmit={addComment}>
                      <label className="sr-only" htmlFor="task-comment">
                        Göreve yorum ekle
                      </label>
                      <textarea
                        id="task-comment"
                        className="textarea"
                        placeholder="İlerlemeyle ilgili bir not bırak…"
                        rows={3}
                        value={comment}
                        maxLength={4000}
                        onChange={(event) => setComment(event.target.value)}
                        required
                      />
                      <div className="form-actions">
                        <button
                          className="btn btn-secondary btn-small"
                          type="submit"
                          disabled={!comment.trim() || Boolean(busy)}
                        >
                          <Send size={14} />
                          {busy === "comment" ? "Gönderiliyor…" : "Yorum ekle"}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              ) : (
                <div className="activity-list">
                  {activities.length ? (
                    activities.map((item) => (
                      <article className="activity-item" key={item.id}>
                        <span className="activity-dot" />
                        <div>
                          <p>
                            <strong>{item.userName}</strong> {item.message}
                          </p>
                          <time dateTime={item.createdAt} className="subtext">
                            {timestamp(item.createdAt)}
                          </time>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="muted">
                      {historyComplete
                        ? "Henüz işlem kaydı yok."
                        : "Son görünümde işlem kaydı bulunmuyor."}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
        <aside className="stack task-sidebar">
          <section className="panel">
            <div className="panel-heading">
              <h2>
                <UserRound size={17} /> Görev bilgileri
              </h2>
            </div>
            <div className="panel-body stack">
              <div>
                <span className="detail-label">Sorumlu</span>
                {assignee ? (
                  <div className="assignee-cell">
                    <Avatar name={assignee.name} />
                    <div>
                      <strong>{assignee.name}</strong>
                      <span className="subtext">{assignee.department}</span>
                    </div>
                  </div>
                ) : (
                  <span className="muted">Henüz atanmadı</span>
                )}
              </div>
              <div className="separator" />
              <div>
                <span className="detail-label">Otel</span>
                <button
                  className="text-link"
                  onClick={() => navigate("hotel", task.hotelId)}
                >
                  {hotel?.name || "Otel"} <ArrowRight size={13} />
                </button>
              </div>
              <div>
                <span className="detail-label">Ekip</span>
                <span>{task.department}</span>
              </div>
              <div>
                <span className="detail-label">Aşama</span>
                <span>{task.stage || "Genel"}</span>
              </div>
              <div>
                <span className="detail-label">Son güncelleme</span>
                <span className="subtext">{timestamp(task.updatedAt)}</span>
              </div>
            </div>
          </section>
          {canEdit && (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <SlidersHorizontal size={17} /> İş durumu
                </h2>
              </div>
              <div className="panel-body">
                <Field label="Çalışma durumunu güncelle">
                  <select
                    className="select"
                    value={task.status}
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      if (event.target.value === "waiting") {
                        setReason(task.waitingReason);
                        setReasonModal("waiting");
                      } else {
                        void mutate(
                          { action: "status", status: event.target.value },
                          "Görev durumu güncellendi.",
                          "status",
                        );
                      }
                    }}
                  >
                    {(
                      ["planned", "in_progress", "waiting"] as TaskStatus[]
                    ).map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </Field>
                {task.status === "waiting" && (
                  <button
                    className="text-link"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      setReason(task.waitingReason);
                      setReasonModal("waiting");
                    }}
                  >
                    Bekleme nedenini düzenle
                  </button>
                )}
                <p className="subtext" style={{ marginTop: 12 }}>
                  Tüm kriterler tamamlandığında işi yönetici kontrolüne
                  gönderin.
                </p>
              </div>
            </section>
          )}
          {isAdmin && task.status === "review" && (
            <section className="panel task-approval-panel">
              <div className="panel-heading">
                <h2>
                  <ShieldCheck size={18} /> Yönetici kontrolü
                </h2>
              </div>
              <div className="panel-body stack">
                <p className="muted">
                  Yapılan işi ve tamamlanma kriterlerini inceleyip karar verin.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void mutate(
                      { action: "approve" },
                      "Görev onaylandı ve tamamlandı.",
                      "approve",
                    )
                  }
                >
                  <CheckCheck size={16} />
                  {busy === "approve" ? "Onaylanıyor…" : "Onayla ve tamamla"}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setReason("");
                    setReasonModal("return");
                  }}
                >
                  <CornerUpLeft size={16} /> Düzeltme iste
                </button>
              </div>
            </section>
          )}
          {isAdmin && task.status === "completed" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  <CheckCheck size={18} /> Tamamlanan iş
                </h2>
              </div>
              <div className="panel-body stack">
                <p className="muted">
                  Ek çalışma gerekiyorsa görevi yeniden açabilirsiniz. İşlem
                  geçmişi korunur.
                </p>
                <button
                  className="btn btn-secondary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void mutate(
                      { action: "reopen" },
                      "Görev yeniden açıldı.",
                      "reopen",
                    )
                  }
                >
                  <CornerUpLeft size={16} />
                  {busy === "reopen" ? "Açılıyor…" : "Görevi yeniden aç"}
                </button>
              </div>
            </section>
          )}
          {data.user.role === "observer" && (
            <div className="notice">
              <Eye size={18} />
              <div>
                <strong>Gözlemci görünümü</strong>
                <p>
                  Otelinizin işlerini ve ilerlemesini buradan takip
                  edebilirsiniz.
                </p>
              </div>
            </div>
          )}
          {data.user.role === "staff" && !canWork && (
            <div className="notice">
              <Eye size={18} />
              <p>
                Bu görev başka bir ekip üyesine ait. Tüm ayrıntıları
                görüntüleyebilirsiniz.
              </p>
            </div>
          )}
        </aside>
      </div>
      {composer && (
        <TaskComposer
          {...props}
          task={task}
          onClose={() => setComposer(false)}
        />
      )}
      {reasonModal && (
        <Modal
          title={
            reasonModal === "return" ? "Düzeltme iste" : "Görevi beklemeye al"
          }
          subtitle={
            reasonModal === "return"
              ? "Personelin hangi noktaları düzeltmesi gerektiğini açıklayın."
              : "İşin ilerlemesi için ne beklendiğini ekibinizle paylaşın."
          }
          onClose={() => {
            if (!busy) setReasonModal(null);
          }}
        >
          <form onSubmit={submitReason}>
            <Field
              label={
                reasonModal === "return"
                  ? "Düzeltme açıklaması"
                  : "Bekleme nedeni"
              }
            >
              <textarea
                className="textarea"
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={
                  reasonModal === "return"
                    ? "Kontrol sırasında gördüğünüz eksiklikler…"
                    : "Örneğin: Otelden domain yönetim erişimi bekleniyor."
                }
                required
                maxLength={2000}
              />
            </Field>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={Boolean(busy)}
                onClick={() => setReasonModal(null)}
              >
                Vazgeç
              </button>
              <SubmitButton busy={Boolean(busy)}>
                {reasonModal === "return"
                  ? "Düzeltmeye gönder"
                  : "Beklemeye al"}
              </SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function TaskComposer({
  data,
  refresh,
  notify,
  onClose,
  hotelId,
  task,
}: ViewProps & { onClose: () => void; hotelId?: string; task?: Task }) {
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const staff = data.users.filter(
    (user) => user.role !== "observer" && user.active !== false,
  );
  const historicalAssignee =
    task?.assigneeId && !staff.some((user) => user.id === task.assigneeId)
      ? data.users.find((user) => user.id === task.assigneeId)
      : undefined;
  const departmentOptions = [
    ...new Set([...departments, ...data.tasks.map((item) => item.department)]),
  ].filter(Boolean);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError("");
    const values = new FormData(event.currentTarget);
    const priority = Number(values.get("priority"));
    const title = String(values.get("title") || "").trim();
    const selectedHotelId =
      task?.hotelId || String(values.get("hotelId") || "");
    const department = String(values.get("department") || "");
    if (!title || !selectedHotelId || !department) {
      setFormError("Görev adı, otel ve ekip alanlarını doldurun.");
      return;
    }
    if (!Number.isInteger(priority) || priority < 1 || priority > 10) {
      setFormError("Öncelik 1 ile 10 arasında bir tam sayı olmalı.");
      return;
    }
    const checklist = String(values.get("checklist") || "")
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!task && !checklist.length) {
      setFormError("En az bir tamamlanma kriteri ekleyin.");
      return;
    }
    if (
      !task &&
      (checklist.length > 30 || checklist.some((item) => item.length > 2000))
    ) {
      setFormError(
        "En fazla 30 kriter ekleyebilirsiniz. Her kriter 2.000 karakterden kısa olmalı.",
      );
      return;
    }
    const assigneeId = String(values.get("assigneeId") || "") || null;
    const body = {
      title,
      department,
      priority,
      description: String(values.get("description") || "").trim(),
      ...(!task || assigneeId !== task.assigneeId ? { assigneeId } : {}),
      dueDate: String(values.get("dueDate") || "") || null,
      hotelInput: String(values.get("hotelInput") || "").trim(),
      stage: String(values.get("stage") || "").trim() || "Genel",
      ...(task
        ? { action: "update" }
        : { hotelId: selectedHotelId, checklist }),
    };
    setBusy(true);
    try {
      await api(
        task ? `/api/tasks/${task.id}` : "/api/tasks",
        body,
        task ? "PATCH" : "POST",
      );
      try {
        await refresh();
        notify(
          task ? "Görev bilgileri güncellendi." : "Yeni görev oluşturuldu.",
        );
      } catch {
        notify(
          "Görev kaydedildi; liste yenilenemedi. Tekrar kaydetmenize gerek yok. Sayfayı yenileyin.",
          "error",
        );
      }
      onClose();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (data.user.role !== "admin") return null;
  return (
    <Modal
      title={task ? "Görevi düzenle" : "Yeni görev oluştur"}
      subtitle={
        task
          ? `${task.code} · Görev kapsamını, sorumluyu ve önceliği güncelleyin.`
          : "İşi tanımlayın, sorumlusunu seçin ve önceliğini belirleyin."
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={save}>
        {formError && (
          <div
            className="notice notice-warning"
            role="alert"
            style={{ marginBottom: 16 }}
          >
            {formError}
          </div>
        )}
        <div className="stack">
          <Field label="Görev adı *">
            <input
              className="input"
              name="title"
              placeholder="Örneğin: Rezervasyon bağlantısını test et"
              defaultValue={task?.title || ""}
              required
              maxLength={200}
            />
          </Field>
          <div className="form-grid">
            <Field label="Otel *">
              <select
                className="select"
                name="hotelId"
                defaultValue={task?.hotelId || hotelId || ""}
                required
                disabled={Boolean(task)}
              >
                <option value="" disabled>
                  Otel seçin
                </option>
                {data.hotels.map((hotel) => (
                  <option key={hotel.id} value={hotel.id}>
                    {hotel.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ekip *">
              <select
                className="select"
                name="department"
                defaultValue={task?.department || ""}
                required
              >
                <option value="" disabled>
                  Ekip seçin
                </option>
                {departmentOptions.map((department) => (
                  <option key={department}>{department}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Açıklama">
            <textarea
              className="textarea"
              name="description"
              rows={3}
              placeholder="Yapılacak işin kapsamını ve gerekli ayrıntıları yazın."
              defaultValue={task?.description || ""}
              maxLength={5000}
            />
          </Field>
          <div className="form-grid">
            <Field label="Sorumlu">
              <select
                className="select"
                name="assigneeId"
                defaultValue={task?.assigneeId || ""}
              >
                <option value="">Henüz atanmadı</option>
                {historicalAssignee && (
                  <option value={historicalAssignee.id}>
                    {historicalAssignee.name} · Mevcut atama
                  </option>
                )}
                {staff.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.department}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Öncelik *" hint="1 en yüksek, 10 en düşük öncelik.">
              <select
                className="select"
                name="priority"
                defaultValue={task?.priority || 5}
              >
                {Array.from({ length: 10 }, (_, index) => index + 1).map(
                  (priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                      {priority === 1
                        ? " · En yüksek öncelik"
                        : priority === 10
                          ? " · En düşük öncelik"
                          : ""}
                    </option>
                  ),
                )}
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Teslim tarihi">
              <input
                className="input"
                type="date"
                name="dueDate"
                defaultValue={task?.dueDate?.slice(0, 10) || ""}
              />
            </Field>
            <Field label="Süreç aşaması">
              <input
                className="input"
                name="stage"
                defaultValue={task?.stage || "Genel"}
                placeholder="Örneğin: Teknik kurulum"
                maxLength={150}
              />
            </Field>
          </div>
          {!task && (
            <Field
              label="Tamamlanma kriterleri *"
              hint="Her satıra bir kriter yazın. Tüm kriterler tamamlanmadan görev kontrole gönderilemez."
            >
              <textarea
                className="textarea"
                name="checklist"
                rows={3}
                placeholder={
                  "Bağlantı masaüstü ve mobilde kontrol edildi\nTest rezervasyonu başarıyla tamamlandı"
                }
                required
                maxLength={10000}
              />
            </Field>
          )}
          <Field label="Otelden beklenen bilgi veya erişim">
            <textarea
              className="textarea"
              name="hotelInput"
              rows={2}
              placeholder="Örneğin: Domain yönetim paneli erişimi"
              defaultValue={task?.hotelInput || ""}
              maxLength={3000}
            />
          </Field>
        </div>
        <div className="form-actions">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Vazgeç
          </button>
          <SubmitButton busy={busy}>
            {task ? "Değişiklikleri kaydet" : "Görevi oluştur"}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
