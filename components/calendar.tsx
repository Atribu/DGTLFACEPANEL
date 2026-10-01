"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Filter,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import { today, type ViewProps } from "@/lib/client";
import type { Task, TaskStatus } from "@/lib/types";
import {
  buildMonthGrid,
  calendarDateKey,
  calendarDayLabel,
  calendarMonthLabel,
  filterCalendarTasks,
  groupCalendarTasks,
  shiftMonth,
  startOfMonth,
  type CalendarFilters,
} from "@/lib/calendar";
import {
  Avatar,
  EmptyState,
  PageHeader,
  PriorityBadge,
  StatusBadge,
} from "./ui";
import { TaskComposer } from "./tasks";
import styles from "./calendar.module.css";

const weekdays = [
  ["Pazartesi", "Pzt"],
  ["Salı", "Sal"],
  ["Çarşamba", "Çar"],
  ["Perşembe", "Per"],
  ["Cuma", "Cum"],
  ["Cumartesi", "Cmt"],
  ["Pazar", "Paz"],
];
const defaultFilters: CalendarFilters = {
  hotelId: "",
  assignee: "all",
  status: "all",
};
const statusClasses: Record<TaskStatus, string> = {
  planned: styles.planned,
  in_progress: styles.inProgress,
  waiting: styles.waiting,
  review: styles.review,
  completed: styles.completed,
};

export function CalendarView(props: ViewProps) {
  const { data, navigate } = props;
  const currentDay = today();
  const [month, setMonth] = useState(() => startOfMonth(today()));
  const [selectedDay, setSelectedDay] = useState(today);
  const [filters, setFilters] = useState<CalendarFilters>(defaultFilters);
  const [composing, setComposing] = useState(false);
  const days = useMemo(() => buildMonthGrid(month), [month]);
  const tasks = useMemo(
    () => filterCalendarTasks(data.tasks, filters, data.user.id),
    [data.tasks, data.user.id, filters],
  );
  const { dated, undated } = useMemo(() => groupCalendarTasks(tasks), [tasks]);
  const hotelById = useMemo(
    () => new Map(data.hotels.map((hotel) => [hotel.id, hotel])),
    [data.hotels],
  );
  const userById = useMemo(
    () => new Map(data.users.map((user) => [user.id, user])),
    [data.users],
  );
  const monthTasks = tasks.filter(
    (task) => calendarDateKey(task.dueDate)?.slice(0, 7) === month.slice(0, 7),
  );
  const monthCompleted = monthTasks.filter(
    (task) => task.status === "completed",
  ).length;
  const monthLate = monthTasks.filter(
    (task) =>
      task.status !== "completed" &&
      calendarDateKey(task.dueDate)! < currentDay,
  ).length;
  const selectedTasks = dated.get(selectedDay) || [];
  const hasFilters =
    filters.hotelId !== "" ||
    filters.assignee !== "all" ||
    filters.status !== "all";
  const assignees = data.users.filter((user) => user.role !== "observer");
  const patchFilter = (patch: Partial<CalendarFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  function moveMonth(direction: number) {
    const next = shiftMonth(month, direction);
    setMonth(next);
    setSelectedDay(next);
  }
  function selectDay(date: string) {
    setSelectedDay(date);
    if (date.slice(0, 7) !== month.slice(0, 7)) setMonth(startOfMonth(date));
  }
  function goToToday() {
    const date = today();
    setMonth(startOfMonth(date));
    setSelectedDay(date);
  }
  function taskCard(task: Task) {
    const hotel = hotelById.get(task.hotelId);
    const owner = task.assigneeId ? userById.get(task.assigneeId) : undefined;
    const date = calendarDateKey(task.dueDate);
    const late =
      date !== null && date < currentDay && task.status !== "completed";
    return (
      <li key={task.id}>
        <button
          className={styles.agendaCard}
          onClick={() => navigate("task", task.id)}
          aria-label={`${task.title} görevini aç`}
        >
          <span className={styles.cardTop}>
            <span className={styles.taskCode}>{task.code}</span>
            <PriorityBadge value={task.priority} />
          </span>
          <strong
            className={`${styles.taskTitle} ${task.status === "completed" ? styles.doneTitle : ""}`}
          >
            {task.title}
          </strong>
          <span className={styles.hotelName}>
            <span
              className={styles.hotelDot}
              style={{ background: hotel?.color || "var(--accent)" }}
            />
            {hotel?.name || "Otel"}
          </span>
          <span className={styles.cardMeta}>
            <StatusBadge status={task.status} />
            {late && (
              <span className={styles.lateLabel}>
                <Clock3 size={11} />
                Gecikti
              </span>
            )}
          </span>
          <span className={styles.cardFooter}>
            <span className={styles.owner}>
              {owner ? (
                <Avatar name={owner.name} size="small" />
              ) : (
                <UserRound size={14} />
              )}
              <span>{owner?.name || "Sorumlu atanmadı"}</span>
            </span>
            <ArrowRight size={15} aria-hidden="true" />
          </span>
        </button>
      </li>
    );
  }

  return (
    <div className={styles.calendarView}>
      <PageHeader
        eyebrow="İŞ PLANLAMASI"
        title="Takvim"
        description="Görevlerin teslim tarihlerini ve günlük iş planını birlikte görün."
        actions={
          data.user.role === "admin" ? (
            <button
              className="btn btn-primary"
              onClick={() => setComposing(true)}
            >
              <Plus size={16} />
              Yeni görev
            </button>
          ) : undefined
        }
      />

      <div
        className={styles.filters}
        role="group"
        aria-label="Takvim filtreleri"
      >
        <span className={styles.filterLabel}>
          <Filter size={15} />
          Görünüm
        </span>
        <label className={styles.filterField}>
          <span>Otel</span>
          <select
            className="select"
            aria-label="Takvimi otele göre filtrele"
            value={filters.hotelId}
            onChange={(event) => patchFilter({ hotelId: event.target.value })}
          >
            <option value="">Tüm oteller</option>
            {data.hotels.map((hotel) => (
              <option key={hotel.id} value={hotel.id}>
                {hotel.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Sorumlu</span>
          <select
            className="select"
            aria-label="Takvimi sorumluya göre filtrele"
            value={filters.assignee}
            onChange={(event) => patchFilter({ assignee: event.target.value })}
          >
            <option value="all">Tüm sorumlular</option>
            {data.user.role !== "observer" && (
              <option value="mine">Bana atanan</option>
            )}
            <option value="unassigned">Sorumlu atanmamış</option>
            {assignees.map((user) => (
              <option key={user.id} value={`user:${user.id}`}>
                {user.name}
                {user.active === false ? " · Pasif" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>Durum</span>
          <select
            className="select"
            aria-label="Takvimi duruma göre filtrele"
            value={filters.status}
            onChange={(event) =>
              patchFilter({
                status: event.target.value as CalendarFilters["status"],
              })
            }
          >
            <option value="all">Tüm durumlar</option>
            <option value="open">Açık görevler</option>
            <option value="completed">Tamamlanan</option>
          </select>
        </label>
        {hasFilters && (
          <button
            className={`btn btn-secondary btn-small ${styles.clearFilters}`}
            onClick={() => setFilters(defaultFilters)}
          >
            <X size={13} />
            Temizle
          </button>
        )}
      </div>

      <div className={styles.layout}>
        <section
          className={`panel ${styles.monthPanel}`}
          aria-labelledby="calendar-month-title"
        >
          <div className={styles.monthHeader}>
            <div className={styles.monthTitle}>
              <span className={styles.calendarIcon}>
                <CalendarDays size={20} />
              </span>
              <div>
                <h2 id="calendar-month-title" aria-live="polite">
                  {calendarMonthLabel(month)}
                </h2>
                <p>Teslim tarihine göre görevler</p>
              </div>
            </div>
            <div className={styles.navigation}>
              <button
                className="btn btn-secondary btn-small"
                onClick={goToToday}
              >
                Bugün
              </button>
              <div className={styles.monthArrows}>
                <button
                  className="icon-btn"
                  aria-label="Önceki ay"
                  onClick={() => moveMonth(-1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Sonraki ay"
                  onClick={() => moveMonth(1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </div>
          <div className={styles.monthSummary} aria-live="polite">
            <span>
              <CalendarClock size={13} />
              <strong>{monthTasks.length}</strong> görev
            </span>
            <span>
              <CheckCheck size={13} />
              <strong>{monthCompleted}</strong> tamamlanan
            </span>
            <span className={monthLate ? styles.lateLabel : ""}>
              <Clock3 size={13} />
              <strong>{monthLate}</strong> geciken
            </span>
            {hasFilters && (
              <span className={styles.filteredNote}>Filtrelenmiş görünüm</span>
            )}
          </div>
          <div className={styles.weekdays} aria-hidden="true">
            {weekdays.map(([full, short]) => (
              <span key={full}>
                <span className={styles.weekdayFull}>{full}</span>
                <span className={styles.weekdayShort}>{short}</span>
              </span>
            ))}
          </div>
          <div
            className={styles.monthGrid}
            role="group"
            aria-label={`${calendarMonthLabel(month)} günleri; görevleri görmek için gün seçin`}
          >
            {days.map((day) => {
              const items = dated.get(day.date) || [];
              const lateCount =
                day.date < currentDay
                  ? items.filter((task) => task.status !== "completed").length
                  : 0;
              const isToday = day.date === currentDay;
              return (
                <button
                  key={day.date}
                  className={[
                    styles.day,
                    day.weekend ? styles.weekend : "",
                    !day.inMonth ? styles.outside : "",
                    isToday ? styles.isToday : "",
                    day.date === selectedDay ? styles.selected : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => selectDay(day.date)}
                  aria-pressed={day.date === selectedDay}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`${calendarDayLabel(day.date)}${isToday ? ", bugün" : ""}; ${items.length} görev${lateCount ? `, ${lateCount} geciken` : ""}`}
                >
                  <span className={styles.dayTop}>
                    <span className={styles.dayNumber}>{day.day}</span>
                    {items.length > 0 && (
                      <span
                        className={`${styles.dayCount} ${lateCount ? styles.lateCount : ""}`}
                      >
                        {items.length}
                      </span>
                    )}
                  </span>
                  <span className={styles.dayEntries}>
                    {items.slice(0, 2).map((task) => (
                      <span
                        key={task.id}
                        className={`${styles.dayEntry} ${statusClasses[task.status]}`}
                      >
                        <span className={styles.eventPriority}>
                          {task.priority}
                        </span>
                        <span className={styles.eventTitle}>{task.title}</span>
                      </span>
                    ))}
                    {items.length > 2 && (
                      <span className={styles.moreTasks}>
                        +{items.length - 2} görev daha
                      </span>
                    )}
                  </span>
                  {items.length > 0 && (
                    <span className={styles.mobileDots} aria-hidden="true">
                      {items.slice(0, 3).map((task) => (
                        <span
                          className={`${styles.statusDot} ${statusClasses[task.status]}`}
                          key={task.id}
                        />
                      ))}
                      {items.length > 3 && (
                        <span className={styles.moreDot}>+</span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className={styles.calendarFootnote}>
            <span>
              <i className={styles.todayKey} />
              Bugün
            </span>
            <span>Bir gün seçerek görevlerini inceleyin.</span>
          </div>
        </section>

        <aside
          className={`panel ${styles.agenda}`}
          aria-labelledby="calendar-agenda-title"
        >
          <div className={styles.agendaHeader}>
            <span className={styles.eyebrow}>GÜNÜN PLANI</span>
            <h2 id="calendar-agenda-title">{calendarDayLabel(selectedDay)}</h2>
            <div className={styles.agendaSummary}>
              <span>
                {selectedTasks.length} görev
                {selectedDay === currentDay ? " · Bugün" : ""}
              </span>
              <span>Öncelik 1 en yüksek</span>
            </div>
          </div>
          <div aria-live="polite" className={styles.agendaBody}>
            {selectedTasks.length ? (
              <ul className={styles.agendaList}>
                {selectedTasks.map(taskCard)}
              </ul>
            ) : (
              <EmptyState
                title="Bu gün için görev yok"
                description={
                  hasFilters
                    ? "Seçili filtrelere uyan teslim tarihli bir görev bulunmuyor."
                    : "Takvimden başka bir gün seçebilir veya tarihsiz görevleri inceleyebilirsiniz."
                }
              />
            )}
          </div>
        </aside>
      </div>

      <details className={`panel ${styles.undated}`}>
        <summary className={styles.undatedHeader}>
          <span className={styles.undatedHeading}>
            <span className={styles.undatedIcon}>
              <CalendarClock size={20} />
            </span>
            <span>
              <strong>
                Tarihi belirlenmeyen görevler{" "}
                <span className={styles.undatedCount}>{undated.length}</span>
              </strong>
              <span className={styles.undatedHint}>
                Bu görevler, teslim tarihi eklenene kadar burada görünür.
              </span>
            </span>
          </span>
          <span className={styles.disclosureLabel}>
            Görevler
            <ChevronDown size={17} />
          </span>
        </summary>
        {undated.length ? (
          <ul className={styles.undatedList}>{undated.map(taskCard)}</ul>
        ) : (
          <div className={styles.undatedEmpty}>
            <CheckCheck size={18} />
            <span>Bu görünümde tarihsiz görev bulunmuyor.</span>
          </div>
        )}
      </details>
      {composing && data.user.role === "admin" && (
        <TaskComposer
          {...props}
          hotelId={filters.hotelId || undefined}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
