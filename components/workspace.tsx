"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Eye,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Plus,
  Repeat2,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
  UserCog,
  X,
} from "lucide-react";
import { type BootstrapData, ROLE_LABELS, type Task } from "@/lib/types";
import {
  api,
  dateLabel,
  initials,
  isOverdue,
  sortTasks,
  today,
  type View,
  type ViewProps,
} from "@/lib/client";
import {
  Avatar,
  EmptyState,
  PageHeader,
  PriorityBadge,
  StatusBadge,
} from "./ui";
import { HotelsView, HotelDetail } from "./hotels";
import { TasksView, TaskDetail, TaskComposer } from "./tasks";
import { UsersView } from "./users";
import { BrandLogo } from "./brand";
import { CalendarView } from "./calendar";
import { NotificationBell, NotificationsView } from "./notifications";
import { RecurrencesView } from "./recurrences";
import { ReportsView } from "./reports";

const names: Record<View, string> = {
  overview: "Genel Bakış",
  hotels: "Oteller",
  hotel: "Otel detayı",
  tasks: "Görevler",
  task: "Görev detayı",
  calendar: "Takvim",
  notifications: "Bildirimler",
  recurrences: "Düzenli İşler",
  reports: "Otel Raporları",
  team: "Ekip",
  users: "Kullanıcılar",
  permissions: "Yetkiler",
};
export default function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const view = (params.get("view") || "overview") as View;
  const id = params.get("id") || "";
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState<{ message: string; kind: string } | null>(
    null,
  );
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [showActivity, setShowActivity] = useState(false);
  const [compose, setCompose] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string, kind = "success") => {
    setToast({ message, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  const navigate = useCallback(
    (v: View, id?: string) => {
      router.push(
        v === "overview"
          ? "/"
          : `/?view=${v}${id ? `&id=${encodeURIComponent(id)}` : ""}`,
      );
      setMenu(false);
      setSearch("");
      setShowActivity(false);
    },
    [router],
  );
  const refresh = useCallback(async () => {
    const r = await fetch("/api/bootstrap", { cache: "no-store" });
    if (r.status === 401) {
      router.replace("/login");
      return;
    }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Veriler yüklenemedi.");
    setData(d);
    setLoadError("");
  }, [router]);
  useEffect(() => {
    refresh().catch((e) => setLoadError(e.message));
    const onFocus = () => {
      refresh().catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);
  async function logout() {
    try {
      await api("/api/logout", {});
      router.replace("/login");
      router.refresh();
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }
  if (!data)
    return (
      <div className="app-loading">
        <BrandLogo />
        <h2>
          {loadError
            ? "Çalışma alanı açılamadı"
            : "Çalışma alanınız hazırlanıyor"}
        </h2>
        <p>{loadError || "Oteller ve görevler yükleniyor…"}</p>
        {loadError && (
          <button
            className="btn btn-primary"
            onClick={() => refresh().catch((e) => setLoadError(e.message))}
          >
            Tekrar dene
          </button>
        )}
      </div>
    );
  const props: ViewProps = { data, refresh, notify, navigate };
  const user = data.user;
  const admin = user.role === "admin";
  const observer = user.role === "observer";
  const alerts = admin
    ? data.tasks.filter((t) => t.status === "review").length
    : data.tasks.filter((t) => t.assigneeId === user.id && isOverdue(t)).length;
  const nav = [
    {
      view: "overview" as View,
      label: observer
        ? "Genel Bakış"
        : user.role === "staff"
          ? "Çalışma Alanım"
          : "Genel Bakış",
      icon: LayoutDashboard,
    },
    {
      view: "hotels" as View,
      label: observer ? "Otellerim" : "Oteller",
      icon: Building2,
    },
    { view: "tasks" as View, label: "Görevler", icon: ListTodo },
    { view: "calendar" as View, label: "Takvim", icon: CalendarDays },
    {
      view: "reports" as View,
      label: "Otel Raporları",
      icon: ChartNoAxesCombined,
    },
    { view: "notifications" as View, label: "Bildirimler", icon: Bell },
    ...(admin
      ? [{ view: "recurrences" as View, label: "Düzenli İşler", icon: Repeat2 }]
      : []),
    ...(!observer
      ? [{ view: "team" as View, label: "Ekip", icon: Users }]
      : []),
    ...(admin
      ? [{ view: "users" as View, label: "Kullanıcılar", icon: UserCog }]
      : []),
  ];
  const searchResults = search.trim()
    ? data.tasks
        .filter((t) =>
          `${t.title} ${t.code} ${data.hotels.find((h) => h.id === t.hotelId)?.name}`
            .toLocaleLowerCase("tr")
            .includes(search.toLocaleLowerCase("tr")),
        )
        .slice(0, 7)
    : [];
  return (
    <div className="app-shell">
      {menu && <div className="mobile-shade" onClick={() => setMenu(false)} />}
      <aside className={`sidebar ${menu ? "sidebar-open" : ""}`}>
        <button
          className="brand brand-button"
          onClick={() => navigate("overview")}
        >
          <BrandLogo tone="light" />
          <span>Operasyon Paneli</span>
        </button>
        <div className="workspace-label">ÇALIŞMA ALANI</div>
        <nav aria-label="Ana menü">
          {nav.map((n) => (
            <button
              key={n.view}
              className={`nav-item ${view === n.view || (n.view === "hotels" && view === "hotel") || (n.view === "tasks" && view === "task") ? "active" : ""}`}
              onClick={() => navigate(n.view)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.view === "tasks" && alerts > 0 && (
                <span className="nav-count">{alerts}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {admin && (
            <button
              className={`nav-item ${view === "permissions" ? "active" : ""}`}
              onClick={() => navigate("permissions")}
            >
              <ShieldCheck size={19} />
              <span>Yetkiler</span>
            </button>
          )}
          <div className="sidebar-note">
            <span className="live-dot" />
            {data.demo ? "Yerel demo" : "Çalışma alanı aktif"}
            <span className="version">v0.1</span>
          </div>
          <div className="sidebar-profile">
            <Avatar name={user.name} />
            <div>
              <strong>{user.name}</strong>
              <span>{ROLE_LABELS[user.role]}</span>
            </div>
            <button
              className="logout-btn"
              aria-label="Çıkış yap"
              title="Çıkış yap"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-btn menu-toggle"
              aria-label={menu ? "Menüyü kapat" : "Menüyü aç"}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Menu size={21} />
            </button>
            <span>Çalışma Alanı</span>
            <ChevronRight size={13} />
            <strong>{names[view] || "Genel Bakış"}</strong>
          </div>
          <div className="topbar-right">
            <div className="global-search">
              <Search size={17} />
              <input
                aria-label="Otel veya görev ara"
                placeholder="Otel veya görev ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearch("");
                  if (e.key === "Enter" && searchResults[0])
                    navigate("task", searchResults[0].id);
                }}
              />
              <kbd>⌕</kbd>
              {search && (
                <div className="search-results">
                  <div className="small-title">GÖREV SONUÇLARI</div>
                  {searchResults.length ? (
                    searchResults.map((t) => (
                      <button key={t.id} onClick={() => navigate("task", t.id)}>
                        <span>
                          {t.title}
                          <small>
                            {data.hotels.find((h) => h.id === t.hotelId)?.name}{" "}
                            · {t.code}
                          </small>
                        </span>
                        <ArrowUpRight size={15} />
                      </button>
                    ))
                  ) : (
                    <p>Bu aramaya uygun görev bulunamadı.</p>
                  )}
                </div>
              )}
            </div>
            <div className="topbar-divider" />
            <NotificationBell
              userId={user.id}
              onOpen={() => navigate("notifications")}
            />
            <div className="activity-menu">
              <button
                className="icon-btn"
                aria-label="Son hareketleri göster"
                onClick={() => setShowActivity(!showActivity)}
              >
                <Activity size={19} />
              </button>
              {showActivity && (
                <div className="activity-dropdown">
                  <h3>Son hareketler</h3>
                  {data.activities.slice(0, 8).map((a) => (
                    <button
                      key={a.id}
                      disabled={!a.taskId}
                      onClick={() => a.taskId && navigate("task", a.taskId)}
                    >
                      <span className="activity-dot" />
                      <span>
                        <strong>{a.userName}</strong> {a.message}
                        <small>
                          {new Intl.DateTimeFormat("tr-TR", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(a.createdAt))}
                        </small>
                      </span>
                    </button>
                  ))}
                  {!data.activities.length && <p>Henüz bir hareket yok.</p>}
                </div>
              )}
            </div>
            <Avatar name={user.name} size="small" />
            <span className="header-user">{user.name}</span>
            <span className="role-pill">{ROLE_LABELS[user.role]}</span>
          </div>
        </header>
        <main className="workspace-main" key={`${view}-${id}`}>
          {view === "hotels" ? (
            <HotelsView {...props} />
          ) : view === "hotel" ? (
            <HotelDetail {...props} hotelId={id} />
          ) : view === "tasks" ? (
            <TasksView {...props} />
          ) : view === "task" ? (
            <TaskDetail {...props} taskId={id} />
          ) : view === "calendar" ? (
            <CalendarView {...props} />
          ) : view === "notifications" ? (
            <NotificationsView {...props} />
          ) : view === "reports" ? (
            <ReportsView {...props} />
          ) : view === "recurrences" && admin ? (
            <RecurrencesView {...props} />
          ) : view === "team" && !observer ? (
            <TeamView {...props} />
          ) : view === "users" && admin ? (
            <UsersView {...props} />
          ) : view === "permissions" && admin ? (
            <PermissionsView />
          ) : (
            <Overview {...props} onCreate={() => setCompose(true)} />
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            DGTLFACE <span className="muted">/</span> Birlikte, daha düzenli.
          </span>
          <span>
            {data.demo
              ? "Örnek veriler · Yerel çalışma alanı"
              : "Operasyon Paneli"}
            <span className="footer-dot" />
          </span>
        </footer>
      </div>
      {compose && <TaskComposer {...props} onClose={() => setCompose(false)} />}{" "}
      {toast && (
        <div
          role="status"
          className={`toast ${toast.kind === "error" ? "toast-error" : ""}`}
        >
          {toast.kind === "error" ? (
            <TriangleAlert size={18} />
          ) : (
            <Check size={18} />
          )}{" "}
          {toast.message}
          <button aria-label="Bildirimi kapat" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function Overview(props: ViewProps & { onCreate: () => void }) {
  const { data, navigate, onCreate } = props;
  const u = data.user;
  const admin = u.role === "admin";
  const observer = u.role === "observer";
  const own =
    u.role === "staff"
      ? data.tasks.filter((t) => t.assigneeId === u.id)
      : data.tasks;
  const open = own.filter((t) => t.status !== "completed");
  const waiting = data.tasks.filter((t) => t.status === "waiting");
  const review = data.tasks.filter((t) => t.status === "review");
  const late = own.filter(isOverdue);
  const ordered = sortTasks(open).slice(0, 5);
  const complete = own.filter((t) => t.status === "completed").length;
  const ratio = own.length ? Math.round((complete / own.length) * 100) : 0;
  const metrics = [
    {
      label: observer
        ? "Bağlı otel"
        : u.role === "staff"
          ? "Atanan görev"
          : "Aktif otel",
      value: u.role === "staff" ? own.length : data.hotels.length,
      icon: observer
        ? Building2
        : u.role === "staff"
          ? ClipboardList
          : Building2,
      tone: "teal",
      sub:
        u.role === "staff"
          ? "Size atanan bütün işler"
          : "Birlikte yönettiğimiz süreçler",
    },
    {
      label: "Devam eden",
      value: own.filter((t) => t.status === "in_progress").length,
      icon: Clock3,
      tone: "blue",
      sub: "Ekiplerin üzerinde çalıştığı işler",
    },
    {
      label: admin ? "Kontrol bekliyor" : "Bilgi bekleniyor",
      value: admin ? review.length : waiting.length,
      icon: admin ? Eye : Clock3,
      tone: "amber",
      sub: admin
        ? "Tamamlanmak için onayınızı bekliyor"
        : "İlerlemek için bir adım daha",
    },
    {
      label: "Geciken görev",
      value: late.length,
      icon: TriangleAlert,
      tone: "red",
      sub: "Teslim tarihi geçen açık işler",
    },
  ];
  const date = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
    timeZone: "Europe/Istanbul",
  }).format(new Date());
  return (
    <>
      <div className="overview-topline">
        <span>
          <span className="live-dot" />{" "}
          {observer
            ? "OTEL ÇALIŞMA ALANI"
            : u.role === "staff"
              ? "KİŞİSEL ÇALIŞMA ALANI"
              : "OPERASYON MERKEZİ"}
        </span>
        <span>
          <CalendarDays size={14} />
          {date}
        </span>
      </div>
      <PageHeader
        title={
          u.role === "staff"
            ? `Merhaba, ${u.name.split(" ")[0]}.`
            : "Genel Bakış"
        }
        description={
          observer
            ? "Oteliniz için yürütülen çalışmaların güncel durumu."
            : u.role === "staff"
              ? "Öncelikleriniz net. Bugünün işlerine birlikte bakalım."
              : "Oteller, ekipler ve işler. Her şey aynı yerde."
        }
        actions={
          <>
            {data.demo && <span className="demo-pill">Örnek veriler</span>}
            {admin && (
              <button className="btn btn-primary" onClick={onCreate}>
                <Plus size={17} /> Yeni görev
              </button>
            )}
          </>
        }
      />
      <div className="metric-strip">
        {metrics.map((m) => (
          <div className="metric" key={m.label}>
            <div className={`metric-icon ${m.tone}`}>
              <m.icon size={21} />
            </div>
            <div>
              <span className="metric-label">{m.label}</span>
              <strong>{m.value.toLocaleString("tr")}</strong>
              <small>{m.sub}</small>
            </div>
          </div>
        ))}
      </div>
      {admin && review.length > 0 && (
        <button
          className="review-banner"
          onClick={() => navigate("task", review[0].id)}
        >
          <span className="review-banner-icon">
            <CheckCheck size={20} />
          </span>
          <span>
            <strong>{review.length} iş son kontrolünüzü bekliyor.</strong>
            <small>
              Ekibiniz tamamladı. İnceleyin, onaylayın veya revizyona gönderin.
            </small>
          </span>
          <span className="review-banner-action">
            İncele <ArrowRight size={17} />
          </span>
        </button>
      )}
      <div className="overview-grid">
        <div className="stack">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{observer ? "Otelleriniz" : "Oteller"}</h2>
                <p>Kurulumdan operasyona, güncel durum</p>
              </div>
              <button className="text-btn" onClick={() => navigate("hotels")}>
                Tümünü gör <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table overview-hotel-table">
                <thead>
                  <tr>
                    <th>Otel</th>
                    <th>Aşama</th>
                    <th>Kurulum ilerlemesi</th>
                    <th>Açık iş</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.hotels.slice(0, 4).map((h) => {
                    const tasks = data.tasks.filter((t) => t.hotelId === h.id);
                    const done = tasks.filter(
                      (t) => t.status === "completed",
                    ).length;
                    const pct = tasks.length
                      ? Math.round((done / tasks.length) * 100)
                      : 0;
                    return (
                      <tr key={h.id}>
                        <td>
                          <button
                            className="cell-hotel"
                            onClick={() => navigate("hotel", h.id)}
                          >
                            <Avatar name={h.name} color={h.color} />
                            <span>
                              <strong>{h.name}</strong>
                              <small>{h.location}</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span
                            className={`stage-chip ${h.stage === "operation" ? "green" : ""}`}
                          >
                            {h.stage === "operation" ? "Operasyon" : "Kurulum"}
                          </span>
                        </td>
                        <td>
                          <div className="progress-cell">
                            <div className="progress-track">
                              <i style={{ width: `${pct}%` }} />
                            </div>
                            <span>{pct}%</span>
                          </div>
                        </td>
                        <td>
                          <strong>{tasks.length - done}</strong>
                        </td>
                        <td>
                          <button
                            className="icon-btn"
                            aria-label={`${h.name} detayını aç`}
                            onClick={() => navigate("hotel", h.id)}
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
            {!data.hotels.length && (
              <EmptyState
                title="Henüz otel yok"
                description="İlk otelinizi ekleyerek çalışma alanını oluşturun."
              />
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  {u.role === "staff" ? "Öncelikli işlerim" : "Öncelikli işler"}
                </h2>
                <p>Öncelik sırasına göre · 1 en yüksek</p>
              </div>
              <button className="text-btn" onClick={() => navigate("tasks")}>
                Tüm görevler <ArrowUpRight size={15} />
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Öncelik</th>
                    <th>Görev</th>
                    <th>Durum</th>
                    <th>Hedef</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <PriorityBadge value={t.priority} />
                      </td>
                      <td>
                        <button
                          className="task-title-button"
                          onClick={() => navigate("task", t.id)}
                        >
                          {t.title}
                          <small>
                            {data.hotels.find((h) => h.id === t.hotelId)?.name}{" "}
                            <span>·</span> {t.department}
                          </small>
                        </button>
                      </td>
                      <td>
                        <StatusBadge status={t.status} />
                      </td>
                      <td>
                        <span className={isOverdue(t) ? "overdue-text" : ""}>
                          {dateLabel(t.dueDate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!ordered.length && (
              <EmptyState
                title="Bütün işler yolunda"
                description="Şu anda açık bir görev bulunmuyor."
              />
            )}
          </section>
        </div>
        <div className="stack">
          <section className="panel waiting-panel">
            <div className="panel-heading">
              <h2>Otelden beklenenler</h2>
              <span className="counter">{waiting.length}</span>
            </div>
            <div className="waiting-list">
              {waiting.slice(0, 4).map((t) => (
                <button key={t.id} onClick={() => navigate("task", t.id)}>
                  <span className="waiting-clock">
                    <Clock3 size={16} />
                  </span>
                  <span>
                    <strong>{t.title}</strong>
                    <small>
                      {data.hotels.find((h) => h.id === t.hotelId)?.name}
                    </small>
                    <em>{t.waitingReason || t.hotelInput}</em>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
            </div>
            {!waiting.length && (
              <div className="compact-empty">
                <CheckCheck size={22} />
                <span>Bekleyen bir bilgi yok.</span>
              </div>
            )}
          </section>
          <section className="panel completion-panel">
            <div className="panel-heading">
              <h2>
                {u.role === "staff" ? "İşlerimin özeti" : "Genel ilerleme"}
              </h2>
              <Sparkles size={16} className="muted" />
            </div>
            <div className="completion-number">
              {ratio}
              <span>%</span>
            </div>
            <div className="completion-copy">
              {complete} / {own.length} görev tamamlandı
            </div>
            <div className="progress-track">
              <i style={{ width: `${ratio}%` }} />
            </div>
            <div className="completion-breakdown">
              <span>
                <i className="dot teal-bg" />
                Tamamlanan<strong>{complete}</strong>
              </span>
              <span>
                <i className="dot muted-bg" />
                Açık işler<strong>{open.length}</strong>
              </span>
            </div>
          </section>
          <section className="note-card">
            <ShieldCheck size={20} />
            <div>
              <strong>
                {observer
                  ? "Size özel görünüm"
                  : u.role === "staff"
                    ? "Kontrolle tamamlanan işler"
                    : "Ortak hedef, net sorumluluk"}
              </strong>
              <p>
                {observer
                  ? "Yalnızca hesabınıza bağlı otellerin çalışmalarını görüntülüyorsunuz."
                  : u.role === "staff"
                    ? "İşiniz bittiğinde kontrole gönderin. Yönetici onayladığında tamamlanır."
                    : "Öncelikleri belirleyin, işleri ekibinize atayın ve tamamlanan çalışmaları onaylayın."}
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function TeamView({ data, navigate }: ViewProps) {
  const [query, setQuery] = useState("");
  const users = data.users.filter(
    (u) =>
      u.role !== "observer" &&
      u.active !== false &&
      `${u.name} ${u.department}`
        .toLocaleLowerCase("tr")
        .includes(query.toLocaleLowerCase("tr")),
  );
  return (
    <>
      <PageHeader
        title="Ekip"
        description="İşi birlikte yürüten insanlar ve güncel görev dağılımı."
        actions={
          <>
            <span className="chip">{users.length} aktif ekip üyesi</span>
            {data.user.role === "admin" && (
              <button
                className="btn btn-secondary"
                onClick={() => navigate("users")}
              >
                <UserCog size={16} /> Kullanıcıları yönet
              </button>
            )}
          </>
        }
      />
      <div className="toolbar">
        <div className="search-input">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="İsim veya ekip ara…"
            aria-label="Ekip üyesi ara"
          />
        </div>
      </div>
      <div className="team-grid">
        {users.map((u) => {
          const tasks = data.tasks.filter((t) => t.assigneeId === u.id);
          const open = tasks.filter((t) => t.status !== "completed");
          const priority = sortTasks(open)[0];
          return (
            <section className="panel team-card" key={u.id}>
              <div className="team-card-header">
                <Avatar name={u.name} size="large" />
                <span className="role-pill">{ROLE_LABELS[u.role]}</span>
              </div>
              <h2>{u.name}</h2>
              <p>{u.department}</p>
              <small>{u.email}</small>
              <div className="team-metrics">
                <span>
                  <strong>{open.length}</strong>Açık görev
                </span>
                <span>
                  <strong>
                    {tasks.filter((t) => t.status === "review").length}
                  </strong>
                  Kontrolde
                </span>
                <span>
                  <strong>{tasks.filter(isOverdue).length}</strong>Geciken
                </span>
              </div>
              <div className="team-next">
                <span className="small-title">SIRADAKİ ÖNCELİK</span>
                {priority ? (
                  <button onClick={() => navigate("task", priority.id)}>
                    <PriorityBadge value={priority.priority} />
                    <span>{priority.title}</span>
                    <ChevronRight size={16} />
                  </button>
                ) : (
                  <p>Açık görev bulunmuyor.</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {!users.length && <EmptyState title="Ekip üyesi bulunamadı" />}
    </>
  );
}
function PermissionsView() {
  const rows = [
    [
      "Tüm otelleri ve görevleri görüntüleme",
      "Tümü",
      "Tümü",
      "Yalnızca bağlı oteller",
    ],
    ["Otel ve görev oluşturma", "Var", "Yok", "Yok"],
    ["Kullanıcı, rol ve otel erişimi yönetimi", "Var", "Yok", "Yok"],
    ["Görev atama ve öncelik belirleme", "Var", "Yok", "Yok"],
    ["Teslim takvimini görüntüleme", "Tümü", "Tümü", "Yalnızca bağlı oteller"],
    ["Otel raporu ve dışa aktarma", "Tümü", "Tümü", "Yalnızca bağlı oteller"],
    [
      "Kişisel bildirimleri görüntüleme",
      "Kendi bildirimleri",
      "Kendi bildirimleri",
      "Kendi bildirimleri",
    ],
    ["Düzenli iş oluşturma ve yönetme", "Var", "Yok", "Yok"],
    [
      "Dosya ve bağlantıları görüntüleme",
      "Tümü",
      "Tümü",
      "Yalnızca bağlı oteller",
    ],
    [
      "Açık göreve dosya veya bağlantı ekleme",
      "Tüm görevler",
      "Yalnızca kendi görevleri",
      "Yok",
    ],
    [
      "Görev durumu ve kriterleri güncelleme",
      "Tüm görevler",
      "Yalnızca kendi görevleri",
      "Yok",
    ],
    ["Yorum ekleme", "Tüm görevler", "Yalnızca kendi görevleri", "Yok"],
    ["İşi kontrole gönderme", "Var", "Kendi görevleri", "Yok"],
    ["İşi onaylama veya revizyona gönderme", "Var", "Yok", "Yok"],
  ];
  return (
    <>
      <PageHeader
        title="Yetkiler"
        description="Çalışma alanında kimin neyi görebildiği ve değiştirebildiği."
      />
      <div className="notice">
        <ShieldCheck size={20} />
        <span>
          Bu ilk sürümde roller tanımlı kurallarla çalışır. Yetkiler her işlemde
          sunucuda doğrulanır.
        </span>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table className="data-table permissions-table">
            <thead>
              <tr>
                <th>İşlem</th>
                <th>
                  <ShieldCheck size={15} /> Yönetici
                </th>
                <th>
                  <Users size={15} /> Personel
                </th>
                <th>
                  <Eye size={15} /> Otel gözlemcisi
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[0]}>
                  {r.map((v, i) => (
                    <td key={i}>
                      {i === 0 ? (
                        <strong>{v}</strong>
                      ) : v === "Yok" ? (
                        <span className="muted">—</span>
                      ) : (
                        <span className="permission-yes">
                          <Check size={14} />
                          {v}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel approval-flow">
        <h2>Tamamlanma akışı</h2>
        <div>
          <span>Personel işi yapar</span>
          <ArrowRight size={18} />
          <span>Kontrole gönderir</span>
          <ArrowRight size={18} />
          <span>Yönetici inceler</span>
          <ArrowRight size={18} />
          <span className="flow-complete">
            <CheckCheck size={16} /> Tamamlandı
          </span>
        </div>
        <p>
          Revizyon gereken işler, yöneticinin açıklamasıyla personele geri
          döner.
        </p>
      </section>
    </>
  );
}
