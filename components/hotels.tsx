"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Circle,
  Clock3,
  Eye,
  ListChecks,
  Mail,
  MapPin,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import {
  api,
  dateLabel,
  isOverdue,
  sortTasks,
  type ViewProps,
} from "@/lib/client";
import type { Hotel, Task } from "@/lib/types";
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
import { TaskComposer } from "./tasks";

const serviceOptions = [
  "Web",
  "OTA",
  "Çağrı Merkezi",
  "SEO",
  "Sosyal Medya",
  "Reklam",
];
const stageLabel = (stage: Hotel["stage"]) =>
  stage === "operation" ? "Operasyon" : "Kurulum";
const taskStage = (task: Task) => task.stage.trim() || "Diğer işler";

function taskCounts(tasks: Task[]) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  return {
    total: tasks.length,
    completed,
    open: tasks.length - completed,
    waiting: tasks.filter((task) => task.status === "waiting").length,
    review: tasks.filter((task) => task.status === "review").length,
    late: tasks.filter(isOverdue).length,
    progress: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
  };
}

function Progress({
  tasks,
  compact = false,
}: {
  tasks: Task[];
  compact?: boolean;
}) {
  const counts = taskCounts(tasks);
  return (
    <div style={{ minWidth: compact ? 130 : 180 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 7,
          fontSize: 12,
        }}
      >
        <span className="muted">
          {counts.completed} / {counts.total} tamamlandı
        </span>
        <strong style={{ color: "var(--accent)" }}>%{counts.progress}</strong>
      </div>
      <div
        role="progressbar"
        aria-label="Görevlerin tamamlanma oranı"
        aria-valuenow={counts.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 6,
          borderRadius: 8,
          overflow: "hidden",
          background: "#e9eeee",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${counts.progress}%`,
            borderRadius: 8,
            background: "var(--brand-gradient)",
            transition: "width .25s ease",
          }}
        />
      </div>
    </div>
  );
}

export function HotelsView(props: ViewProps) {
  const { data, navigate } = props;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | Hotel["stage"]>("all");
  const [composing, setComposing] = useState(false);
  const isAdmin = data.user.role === "admin";
  const filtered = data.hotels.filter((hotel) => {
    const manager = data.users.find((user) => user.id === hotel.managerId);
    const searchable = [
      hotel.name,
      hotel.location,
      ...hotel.services,
      manager?.name || "",
    ]
      .join(" ")
      .toLocaleLowerCase("tr");
    return (
      (filter === "all" || hotel.stage === filter) &&
      searchable.includes(search.trim().toLocaleLowerCase("tr"))
    );
  });
  const tabs: { value: typeof filter; label: string; count: number }[] = [
    { value: "all", label: "Tüm oteller", count: data.hotels.length },
    {
      value: "onboarding",
      label: "Kurulum",
      count: data.hotels.filter((hotel) => hotel.stage === "onboarding").length,
    },
    {
      value: "operation",
      label: "Operasyon",
      count: data.hotels.filter((hotel) => hotel.stage === "operation").length,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="MÜŞTERİ YÖNETİMİ"
        title="Oteller"
        description="Her otelin işlerini, ekibini ve ilerlemesini tek yerden takip edin."
        actions={
          isAdmin && (
            <button
              className="btn btn-primary"
              onClick={() => setComposing(true)}
            >
              <Plus size={17} />
              Otel ekle
            </button>
          )
        }
      />
      <section className="panel">
        <div className="toolbar" style={{ gap: 16, flexWrap: "wrap" }}>
          <div className="tabs" aria-label="Otelleri aşamaya göre filtrele">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                className={`tab ${filter === tab.value ? "active" : ""}`}
                aria-pressed={filter === tab.value}
                onClick={() => setFilter(tab.value)}
              >
                {tab.label}
                <span className="tag" style={{ marginLeft: 7 }}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          <label
            style={{
              position: "relative",
              display: "block",
              minWidth: 230,
              flex: "0 1 280px",
            }}
          >
            <Search
              size={16}
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#81908d",
              }}
            />
            <input
              className="input"
              aria-label="Otel ara"
              placeholder="Otel, konum veya sorumlu ara..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ paddingLeft: 37, width: "100%" }}
            />
          </label>
        </div>
        {filtered.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>OTEL</th>
                  <th>HİZMETLER</th>
                  <th>AŞAMA</th>
                  <th>İLERLEME</th>
                  <th>İŞ DURUMU</th>
                  <th>SORUMLU</th>
                  <th aria-label="Oteli aç" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((hotel) => {
                  const tasks = data.tasks.filter(
                    (task) => task.hotelId === hotel.id,
                  );
                  const counts = taskCounts(tasks);
                  const manager = data.users.find(
                    (user) => user.id === hotel.managerId,
                  );
                  return (
                    <tr
                      key={hotel.id}
                      onClick={() => navigate("hotel", hotel.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate("hotel", hotel.id);
                          }}
                          style={{
                            border: 0,
                            background: "transparent",
                            padding: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: 11,
                            textAlign: "left",
                            cursor: "pointer",
                            color: "inherit",
                            font: "inherit",
                          }}
                        >
                          <Avatar name={hotel.name} color={hotel.color} />
                          <span>
                            <strong
                              style={{ display: "block", whiteSpace: "nowrap" }}
                            >
                              {hotel.name}
                            </strong>
                            <span
                              className="subtext"
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                marginTop: 4,
                              }}
                            >
                              <MapPin size={11} />
                              {hotel.location || "Konum eklenmedi"}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 5,
                            maxWidth: 220,
                          }}
                        >
                          {hotel.services.length ? (
                            hotel.services.map((service) => (
                              <span key={service} className="chip">
                                {service}
                              </span>
                            ))
                          ) : (
                            <span className="muted">Hizmet seçilmedi</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className="tag"
                          style={
                            hotel.stage === "operation"
                              ? { background: "#eaf5ed", color: "#388556" }
                              : { background: "#eef2ff", color: "#6571ad" }
                          }
                        >
                          {stageLabel(hotel.stage)}
                        </span>
                      </td>
                      <td>
                        <Progress tasks={tasks} compact />
                      </td>
                      <td>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(2, minmax(68px, 1fr))",
                            gap: "5px 12px",
                            fontSize: 12,
                          }}
                        >
                          <span>
                            <strong>{counts.open}</strong>{" "}
                            <span className="muted">açık</span>
                          </span>
                          <span
                            style={{
                              color: counts.waiting ? "#a27628" : undefined,
                            }}
                          >
                            <strong>{counts.waiting}</strong>{" "}
                            <span className="muted">bekleyen</span>
                          </span>
                          <span>
                            <strong>{counts.review}</strong>{" "}
                            <span className="muted">kontrol</span>
                          </span>
                          <span
                            style={{
                              color: counts.late ? "#c05b56" : undefined,
                            }}
                          >
                            <strong>{counts.late}</strong>{" "}
                            <span className={counts.late ? undefined : "muted"}>
                              geciken
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>
                        {manager ? (
                          <span
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Avatar name={manager.name} size="small" />
                            <span style={{ fontSize: 12 }}>{manager.name}</span>
                          </span>
                        ) : (
                          <span className="muted">Atanmadı</span>
                        )}
                      </td>
                      <td>
                        <ChevronRight size={16} className="muted" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={
              data.hotels.length
                ? "Eşleşen otel bulunamadı"
                : "Henüz otel eklenmedi"
            }
            description={
              data.hotels.length
                ? "Aramanızı veya aşama filtresini değiştirerek tekrar deneyin."
                : isAdmin
                  ? "İlk oteli ekleyin; hazır kurulum listesiyle tüm ekibin işlerini planlayın."
                  : "Erişiminiz olan oteller burada görünecek."
            }
            action={
              data.hotels.length ? (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Filtreleri temizle
                </button>
              ) : isAdmin ? (
                <button
                  className="btn btn-primary"
                  onClick={() => setComposing(true)}
                >
                  <Plus size={16} />
                  İlk oteli ekle
                </button>
              ) : undefined
            }
          />
        )}
        {filtered.length > 0 && (
          <div
            className="muted"
            style={{
              padding: "14px 22px",
              borderTop: "1px solid #edf1ef",
              fontSize: 12,
            }}
          >
            {filtered.length} otel gösteriliyor · Açık iş sayısına bekleyen ve
            kontrol bekleyen işler dahildir.
          </div>
        )}
      </section>
      {composing && (
        <HotelComposer {...props} onClose={() => setComposing(false)} />
      )}
    </>
  );
}

export function HotelDetail(props: ViewProps & { hotelId: string }) {
  const { data, hotelId, navigate } = props;
  const [tab, setTab] = useState<"setup" | "activity" | "info">("setup");
  const [changingManager, setChangingManager] = useState(false);
  const [stage, setStage] = useState("all");
  const [filter, setFilter] = useState<"all" | "open" | "completed" | "review">(
    "all",
  );
  const [composing, setComposing] = useState(false);
  const hotel = data.hotels.find((item) => item.id === hotelId);
  const tasks = useMemo(
    () => data.tasks.filter((task) => task.hotelId === hotelId),
    [data.tasks, hotelId],
  );
  const stages = useMemo(
    () =>
      Array.from(new Set(tasks.map(taskStage))).sort((a, b) =>
        a.localeCompare(b, "tr", { numeric: true }),
      ),
    [tasks],
  );
  useEffect(() => {
    setTab("setup");
    setStage("all");
    setFilter("all");
    setComposing(false);
    setChangingManager(false);
  }, [hotelId]);

  if (!hotel)
    return (
      <section className="panel">
        <EmptyState
          title="Otel bulunamadı"
          description="Bu otele erişiminiz olmayabilir veya otel artık listede olmayabilir."
          action={
            <button
              className="btn btn-secondary"
              onClick={() => navigate("hotels")}
            >
              <ArrowLeft size={16} />
              Otellere dön
            </button>
          }
        />
      </section>
    );

  const counts = taskCounts(tasks);
  const manager = data.users.find((user) => user.id === hotel.managerId);
  const selectedTasks = tasks.filter(
    (task) => stage === "all" || taskStage(task) === stage,
  );
  const shownTasks = sortTasks(
    selectedTasks.filter(
      (task) =>
        filter === "all" ||
        (filter === "open"
          ? task.status !== "completed"
          : task.status === filter),
    ),
  );
  const selectedCounts = taskCounts(selectedTasks);
  const activities = data.activities
    .filter((activity) => activity.hotelId === hotelId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const filters: { value: typeof filter; label: string; count: number }[] = [
    { value: "all", label: "Tümü", count: selectedCounts.total },
    { value: "open", label: "Açık", count: selectedCounts.open },
    {
      value: "review",
      label: "Kontrol bekleyen",
      count: selectedCounts.review,
    },
    {
      value: "completed",
      label: "Tamamlanan",
      count: selectedCounts.completed,
    },
  ];

  return (
    <>
      <button
        className="btn btn-secondary btn-small"
        onClick={() => navigate("hotels")}
        style={{ marginBottom: 20 }}
      >
        <ArrowLeft size={15} />
        Tüm oteller
      </button>
      <PageHeader
        eyebrow="OTEL ÇALIŞMA ALANI"
        title={hotel.name}
        description={`${hotel.location || "Konum eklenmedi"} · ${stageLabel(hotel.stage)} süreci`}
        actions={
          data.user.role === "admin" && (
            <button
              className="btn btn-primary"
              onClick={() => setComposing(true)}
            >
              <Plus size={17} />
              Görev ekle
            </button>
          )
        }
      />
      <div
        className="panel"
        style={{
          padding: "18px 22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar name={hotel.name} color={hotel.color} size="large" />
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 7 }}>
              ALINAN HİZMETLER
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {hotel.services.length ? (
                hotel.services.map((service) => (
                  <span className="chip" key={service}>
                    {service}
                  </span>
                ))
              ) : (
                <span className="muted">Hizmet seçilmedi</span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={manager?.name || "Atanmadı"} size="small" />
          <div>
            <div className="subtext">Otel sorumlusu</div>
            <strong style={{ fontSize: 13 }}>
              {manager?.name || "Atanmadı"}
            </strong>
            {data.user.role === "admin" && (
              <div>
                <button
                  className="text-btn"
                  onClick={() => setChangingManager(true)}
                >
                  Sorumluyu değiştir
                </button>
              </div>
            )}
          </div>
        </div>
        <div style={{ flex: "0 1 260px", width: "100%" }}>
          <Progress tasks={tasks} />
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {[
          {
            label: "Toplam görev",
            value: counts.total,
            Icon: ListChecks,
            color: "#647776",
          },
          {
            label: "Açık görev",
            value: counts.open,
            Icon: Circle,
            color: "var(--accent)",
          },
          {
            label: "Bekleyen",
            value: counts.waiting,
            Icon: Clock3,
            color: "#ab853b",
          },
          {
            label: "Kontrol bekleyen",
            value: counts.review,
            Icon: Eye,
            color: "#8475ad",
          },
          {
            label: "Tamamlanan",
            value: counts.completed,
            Icon: CheckCheck,
            color: "#458967",
          },
          {
            label: "Geciken",
            value: counts.late,
            Icon: CalendarDays,
            color: "#c0645e",
          },
        ].map(({ label, value, Icon, color }) => (
          <div className="panel" key={label} style={{ padding: "17px 18px" }}>
            <div
              className="muted"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                fontSize: 11,
              }}
            >
              <span>{label}</span>
              <Icon size={15} style={{ color }} />
            </div>
            <strong
              style={{
                display: "block",
                marginTop: 9,
                fontSize: 25,
                fontWeight: 600,
                color,
              }}
            >
              {value}
            </strong>
          </div>
        ))}
      </div>
      <div
        className="tabs"
        style={{ marginBottom: 20 }}
        aria-label="Otel detay bölümleri"
      >
        <button
          className={`tab ${tab === "setup" ? "active" : ""}`}
          aria-pressed={tab === "setup"}
          onClick={() => setTab("setup")}
        >
          <ListChecks size={15} />
          Kurulum
        </button>
        <button
          className={`tab ${tab === "activity" ? "active" : ""}`}
          aria-pressed={tab === "activity"}
          onClick={() => setTab("activity")}
        >
          <Clock3 size={15} />
          Hareketler<span className="tag">{activities.length}</span>
        </button>
        <button
          className={`tab ${tab === "info" ? "active" : ""}`}
          aria-pressed={tab === "info"}
          onClick={() => setTab("info")}
        >
          <Building2 size={15} />
          Otel bilgileri
        </button>
      </div>
      {tab === "setup" && (
        <div
          className="detail-grid hotel-detail-grid"
          style={{ alignItems: "start" }}
        >
          <aside className="panel">
            <div className="panel-heading">
              <div>
                <h3>İş aşamaları</h3>
                <p className="subtext">
                  {stages.length} aşama · {tasks.length} görev
                </p>
              </div>
            </div>
            <div className="hotel-stage-list">
              <button
                className={`stage-item ${stage === "all" ? "active" : ""}`}
                aria-pressed={stage === "all"}
                onClick={() => setStage("all")}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <ListChecks size={16} />
                  Tüm aşamalar
                </span>
                <span className="tag">{tasks.length}</span>
              </button>
              {stages.map((name) => {
                const stageTasks = tasks.filter(
                  (task) => taskStage(task) === name,
                );
                const stageCounts = taskCounts(stageTasks);
                return (
                  <button
                    key={name}
                    className={`stage-item ${stage === name ? "active" : ""}`}
                    aria-pressed={stage === name}
                    onClick={() => setStage(name)}
                    style={{ alignItems: "flex-start" }}
                  >
                    <span
                      style={{
                        display: "flex",
                        gap: 9,
                        textAlign: "left",
                        alignItems: "flex-start",
                      }}
                    >
                      <span style={{ lineHeight: 1.5 }}>{name}</span>
                    </span>
                    <span
                      className="tag"
                      style={{ flexShrink: 0, marginTop: 1 }}
                      aria-label={`${stageCounts.completed} / ${stageCounts.total} tamamlandı`}
                    >
                      {stageCounts.completed}/{stageCounts.total}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>{stage === "all" ? "Tüm görevler" : stage}</h3>
                <p className="subtext">
                  Öncelik sırasına göre · 1 en yüksek, 10 en düşük
                </p>
              </div>
              <span className="tag">{selectedTasks.length} görev</span>
            </div>
            <div
              className="toolbar"
              style={{ paddingTop: 0, flexWrap: "wrap" }}
            >
              <div className="tabs" style={{ flexWrap: "wrap" }}>
                {filters.map((item) => (
                  <button
                    key={item.value}
                    className={`tab ${filter === item.value ? "active" : ""}`}
                    aria-pressed={filter === item.value}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label}
                    <span className="tag" style={{ marginLeft: 5 }}>
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {shownTasks.length ? (
              <div>
                {shownTasks.map((task) => {
                  const assignee = data.users.find(
                    (user) => user.id === task.assigneeId,
                  );
                  return (
                    <article
                      key={task.id}
                      style={{
                        borderTop: "1px solid #edf1ef",
                        padding: "18px 22px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 11,
                        }}
                      >
                        <span style={{ paddingTop: 2 }}>
                          <PriorityBadge value={task.priority} />
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: 12,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              onClick={() => navigate("task", task.id)}
                              style={{
                                border: 0,
                                background: "transparent",
                                padding: 0,
                                color: "inherit",
                                font: "inherit",
                                textAlign: "left",
                                cursor: "pointer",
                                flex: "1 1 200px",
                              }}
                            >
                              <span
                                className="subtext"
                                style={{
                                  fontSize: 10,
                                  display: "block",
                                  marginBottom: 5,
                                }}
                              >
                                {task.code}
                                {stage === "all" ? ` · ${taskStage(task)}` : ""}
                              </span>
                              <strong
                                style={{
                                  fontSize: 13,
                                  lineHeight: 1.6,
                                  fontWeight: 600,
                                  textDecoration:
                                    task.status === "completed"
                                      ? "line-through"
                                      : undefined,
                                  opacity:
                                    task.status === "completed" ? 0.65 : 1,
                                }}
                              >
                                {task.title}
                              </strong>
                            </button>
                            <StatusBadge status={task.status} />
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              gap: "9px 18px",
                              marginTop: 11,
                              fontSize: 11,
                            }}
                          >
                            <span
                              className="muted"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              {assignee ? (
                                <Avatar name={assignee.name} size="small" />
                              ) : (
                                <UserRound size={13} />
                              )}
                              {assignee?.name || "Kişi atanmadı"}
                            </span>
                            {task.department && (
                              <span className="muted">{task.department}</span>
                            )}
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                color: isOverdue(task) ? "#bf605c" : "#7c8986",
                              }}
                            >
                              <CalendarDays size={13} />
                              {dateLabel(task.dueDate)}
                              {isOverdue(task) ? " · Gecikti" : ""}
                            </span>
                          </div>
                          {task.waitingReason && (
                            <div
                              style={{
                                marginTop: 11,
                                padding: "8px 10px",
                                borderRadius: 6,
                                fontSize: 11,
                                lineHeight: 1.6,
                                background: "#fcf7ec",
                                color: "#967332",
                              }}
                            >
                              <strong>Bekleme nedeni: </strong>
                              {task.waitingReason}
                            </div>
                          )}
                          {task.hotelInput && (
                            <p
                              className="subtext"
                              style={{
                                margin: "9px 0 0",
                                fontSize: 11,
                                lineHeight: 1.6,
                              }}
                            >
                              <strong>Otelden beklenen: </strong>
                              {task.hotelInput}
                            </p>
                          )}
                        </div>
                        <button
                          className="icon-btn"
                          aria-label={`${task.title} görevini aç`}
                          onClick={() => navigate("task", task.id)}
                          style={{ marginTop: 18 }}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title={
                  tasks.length
                    ? "Bu görünümde görev yok"
                    : "Henüz görev eklenmedi"
                }
                description={
                  tasks.length
                    ? "Farklı bir aşama veya durum filtresi seçebilirsiniz."
                    : "Bu otel için oluşturulan görevler ve kurulum aşamaları burada görünecek."
                }
                action={
                  tasks.length ? (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setFilter("all");
                        setStage("all");
                      }}
                    >
                      Tüm görevleri göster
                    </button>
                  ) : data.user.role === "admin" ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => setComposing(true)}
                    >
                      <Plus size={16} />
                      Görev ekle
                    </button>
                  ) : undefined
                }
              />
            )}
          </section>
        </div>
      )}
      {tab === "activity" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Son hareketler</h3>
              <p className="subtext">Bu otele ait işlerin güncelleme geçmişi</p>
            </div>
          </div>
          {activities.length ? (
            activities.map((activity) => (
              <div
                key={activity.id}
                style={{
                  padding: "17px 22px",
                  borderTop: "1px solid #edf1ef",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <Avatar name={activity.userName} size="small" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, lineHeight: 1.65, fontSize: 13 }}>
                    <strong>{activity.userName}</strong>{" "}
                    <span className="muted">{activity.message}</span>
                  </p>
                  <time
                    className="subtext"
                    dateTime={activity.createdAt}
                    style={{ display: "block", marginTop: 5 }}
                  >
                    {new Intl.DateTimeFormat("tr-TR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Istanbul",
                    }).format(new Date(activity.createdAt))}
                  </time>
                </div>
                {activity.taskId &&
                  tasks.some((task) => task.id === activity.taskId) && (
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => navigate("task", activity.taskId!)}
                    >
                      Göreve git
                      <ArrowRight size={13} />
                    </button>
                  )}
              </div>
            ))
          ) : (
            <EmptyState
              title="Henüz hareket yok"
              description="Görevlerde yapılan değişiklikler burada görünecek."
            />
          )}
        </section>
      )}
      {tab === "info" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>Otel bilgileri</h3>
              <p className="subtext">İletişim, sorumluluk ve hizmet kapsamı</p>
            </div>
          </div>
          <div
            style={{
              padding: "4px 24px 26px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "26px 32px",
            }}
          >
            {[
              { label: "Otel adı", value: hotel.name },
              { label: "Konum", value: hotel.location || "Eklenmedi" },
              { label: "Otel sorumlusu", value: manager?.name || "Atanmadı" },
              {
                label: "Otel yetkilisi",
                value: hotel.contactName || "Eklenmedi",
              },
              { label: "Çalışma aşaması", value: stageLabel(hotel.stage) },
              {
                label: "Eklenme tarihi",
                value: new Intl.DateTimeFormat("tr-TR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "Europe/Istanbul",
                }).format(new Date(hotel.createdAt)),
              },
            ].map((item) => (
              <div key={item.label}>
                <div className="subtext" style={{ marginBottom: 8 }}>
                  {item.label}
                </div>
                <strong style={{ fontSize: 13, fontWeight: 500 }}>
                  {item.value}
                </strong>
              </div>
            ))}
            <div>
              <div className="subtext" style={{ marginBottom: 8 }}>
                İletişim e-postası
              </div>
              {hotel.contactEmail ? (
                <a
                  href={`mailto:${hotel.contactEmail}`}
                  style={{
                    color: "var(--accent)",
                    fontSize: 13,
                    display: "inline-flex",
                    gap: 6,
                    alignItems: "center",
                    overflowWrap: "anywhere",
                  }}
                >
                  <Mail size={14} />
                  {hotel.contactEmail}
                </a>
              ) : (
                <span className="muted">Eklenmedi</span>
              )}
            </div>
            <div>
              <div className="subtext" style={{ marginBottom: 8 }}>
                Alınan hizmetler
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {hotel.services.length ? (
                  hotel.services.map((service) => (
                    <span className="chip" key={service}>
                      {service}
                    </span>
                  ))
                ) : (
                  <span className="muted">Hizmet seçilmedi</span>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
      {composing && data.user.role === "admin" && (
        <TaskComposer
          {...props}
          hotelId={hotelId}
          onClose={() => setComposing(false)}
        />
      )}
      {changingManager && data.user.role === "admin" && (
        <HotelManagerEditor
          {...props}
          hotel={hotel}
          onClose={() => setChangingManager(false)}
        />
      )}
    </>
  );
}

function HotelManagerEditor({
  data,
  hotel,
  refresh,
  notify,
  onClose,
}: ViewProps & { hotel: Hotel; onClose: () => void }) {
  const [managerId, setManagerId] = useState(hotel.managerId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const managers = data.users.filter(
    (user) => user.role !== "observer" && user.active !== false,
  );
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/hotels/${hotel.id}`, { managerId }, "PATCH");
      try {
        await refresh();
        notify("Otel sorumlusu güncellendi.");
      } catch {
        notify(
          "Sorumlu kaydedildi; liste yenilenemedi. Sayfayı yenileyin.",
          "error",
        );
      }
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Sorumlu değiştirilemedi.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Otel sorumlusunu değiştir"
      subtitle={hotel.name}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="modal-form" onSubmit={save}>
        <div className="notice">
          <UserRound size={19} />
          <span>
            Otelin koordinasyon sorumlusunu seçin. Görevleri devretmek için
            görevlerin sorumlu alanını ayrıca güncelleyin.
          </span>
        </div>
        <Field label="Yeni sorumlu">
          <select
            className="select"
            required
            disabled={busy}
            value={managerId}
            onChange={(event) => setManagerId(event.target.value)}
          >
            {managers.map((user) => (
              <option value={user.id} key={user.id}>
                {user.name} · {user.department}
              </option>
            ))}
          </select>
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Vazgeç
          </button>
          <SubmitButton busy={busy}>Sorumluyu kaydet</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

export function HotelComposer(props: ViewProps & { onClose: () => void }) {
  const { data, refresh, navigate, notify, onClose } = props;
  const managers = data.users.filter(
    (user) => user.role !== "observer" && user.active !== false,
  );
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [managerId, setManagerId] = useState(
    managers.some((user) => user.id === data.user.id)
      ? data.user.id
      : managers[0]?.id || "",
  );
  const [services, setServices] = useState<string[]>([]);
  const [template, setTemplate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || data.user.role !== "admin") return;
    if (
      !name.trim() ||
      !location.trim() ||
      !managerId ||
      !contactName.trim() ||
      !contactEmail.trim()
    ) {
      setError(
        "Otel adı, konum, yetkili, e-posta ve sorumlu alanlarını doldurun.",
      );
      return;
    }
    if (!services.length) {
      setError("Otelin aldığı hizmetlerden en az birini seçin.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ hotel?: Hotel; id?: string }>("/api/hotels", {
        name: name.trim(),
        location: location.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        managerId,
        services,
        template,
      });
      try {
        await refresh();
      } catch {
        notify(
          "Otel oluşturuldu. Güncel listeyi görmek için sayfayı yenileyin.",
          "error",
        );
        onClose();
        navigate("hotels");
        return;
      }
      notify(
        template
          ? "Otel ve 93 görevlik kurulum listesi oluşturuldu."
          : "Otel oluşturuldu. Görev eklemeye başlayabilirsiniz.",
      );
      onClose();
      const id = result.hotel?.id || result.id;
      if (id) navigate("hotel", id);
      else navigate("hotels");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Otel oluşturulamadı. Lütfen tekrar deneyin.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (data.user.role !== "admin") return null;
  return (
    <Modal
      title="Yeni otel ekle"
      subtitle="Otelin bilgilerini ve hizmet kapsamını belirleyin."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Otel adı *">
            <input
              className="input"
              placeholder="Örn. Azure Bay Resort"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={160}
              autoComplete="organization"
              disabled={busy}
            />
          </Field>
          <Field label="Konum *">
            <input
              className="input"
              placeholder="Örn. Belek, Antalya"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              required
              maxLength={160}
              disabled={busy}
            />
          </Field>
          <Field label="Otel yetkilisi *">
            <input
              className="input"
              placeholder="Ad soyad"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              maxLength={160}
              autoComplete="name"
              required
              disabled={busy}
            />
          </Field>
          <Field label="Yetkilinin e-posta adresi *">
            <input
              className="input"
              type="email"
              placeholder="isim@otel.com"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              maxLength={254}
              autoComplete="email"
              required
              disabled={busy}
            />
          </Field>
          <Field
            label="Otel sorumlusu *"
            hint="DGTLFACE ekibinden bu otelin takibini yürütecek kişi."
          >
            <select
              className="select"
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
              required
              disabled={busy}
            >
              <option value="" disabled>
                Sorumlu seçin
              </option>
              {managers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                  {user.department ? ` · ${user.department}` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset
          style={{ border: 0, padding: 0, margin: "24px 0" }}
          disabled={busy}
        >
          <legend
            style={{
              padding: 0,
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            Alınan hizmetler *
          </legend>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
              gap: 9,
            }}
          >
            {serviceOptions.map((service) => (
              <label
                key={service}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "11px 12px",
                  border: `1px solid ${services.includes(service) ? "var(--accent-border)" : "var(--line)"}`,
                  borderRadius: 7,
                  background: services.includes(service)
                    ? "var(--accent-soft)"
                    : "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={services.includes(service)}
                  onChange={(event) =>
                    setServices((current) =>
                      event.target.checked
                        ? [...current, service]
                        : current.filter((item) => item !== service),
                    )
                  }
                  style={{ accentColor: "var(--accent)" }}
                />
                {service}
              </label>
            ))}
          </div>
        </fieldset>
        <label
          className="notice"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 11,
            padding: 16,
            borderRadius: 8,
            background: "var(--accent-soft)",
            border: "1px solid var(--accent-border)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={template}
            onChange={(event) => setTemplate(event.target.checked)}
            disabled={busy}
            style={{ accentColor: "var(--accent)", marginTop: 3 }}
          />
          <span>
            <strong style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
              93 görevlik kurulum listesini ekle
            </strong>
            <span
              className="muted"
              style={{ display: "block", fontSize: 12, lineHeight: 1.7 }}
            >
              Kaynak dosyanın Ana Checklist sekmesindeki 93 görevin tamamı;
              aşamaları, tamamlanma kriterleri, otelden beklenen girdileri ve
              departman sorumluluklarıyla eklenir. Hizmet seçimi görev listesini
              azaltmaz.
            </span>
            <span
              className="subtext"
              style={{ display: "block", marginTop: 7 }}
            >
              Seçimi kaldırırsanız boş bir otel çalışma alanı oluşturulur.
            </span>
          </span>
        </label>
        {error && (
          <p
            role="alert"
            style={{
              margin: "16px 0 0",
              padding: 12,
              borderRadius: 7,
              background: "#fff0ed",
              color: "#b05048",
              fontSize: 13,
            }}
          >
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Vazgeç
          </button>
          <SubmitButton busy={busy}>
            {busy ? "Otel oluşturuluyor..." : "Oteli oluştur"}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
