"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import {
  Building2,
  Check,
  CirclePause,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react";
import { api, departments, type ViewProps } from "@/lib/client";
import { ROLE_LABELS, type Role, type User } from "@/lib/types";
import {
  Avatar,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SubmitButton,
} from "./ui";

const roles: Role[] = ["admin", "staff", "observer"];
const isActive = (user: User & { active?: boolean }) => user.active !== false;
const roleDescriptions: Record<Role, string> = {
  admin: "Tüm otelleri, görevleri ve kullanıcıları yönetir.",
  staff:
    "Tüm otelleri ve işleri görür. Yalnızca kendisine atanan işlerde işlem yapabilir.",
  observer:
    "Seçilen otellerin işlerini görüntüler. Görevlerde değişiklik yapamaz.",
};
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "İşlem tamamlanamadı. Lütfen tekrar deneyin.";

export function UsersView(props: ViewProps) {
  const { data } = props;
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [stateFilter, setStateFilter] = useState<"all" | "active" | "inactive">(
    "all",
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | undefined>(undefined);
  const hotelById = useMemo(
    () => new Map(data.hotels.map((hotel) => [hotel.id, hotel])),
    [data.hotels],
  );
  const workloads = useMemo(() => {
    const counts = new Map<string, { open: number; completed: number }>();
    for (const task of data.tasks) {
      if (!task.assigneeId) continue;
      const count = counts.get(task.assigneeId) || { open: 0, completed: 0 };
      count[task.status === "completed" ? "completed" : "open"]++;
      counts.set(task.assigneeId, count);
    }
    return counts;
  }, [data.tasks]);
  const visibleUsers = data.users
    .filter((user) => {
      const searchable = [
        user.name,
        user.email,
        user.department,
        ROLE_LABELS[user.role],
        ...user.hotelIds.map((id) => hotelById.get(id)?.name || ""),
      ]
        .join(" ")
        .toLocaleLowerCase("tr");
      return (
        (roleFilter === "all" || user.role === roleFilter) &&
        (stateFilter === "all" ||
          (stateFilter === "active" ? isActive(user) : !isActive(user))) &&
        searchable.includes(search.trim().toLocaleLowerCase("tr"))
      );
    })
    .sort(
      (a, b) =>
        Number(isActive(b)) - Number(isActive(a)) ||
        a.name.localeCompare(b.name, "tr"),
    );
  const activeCount = data.users.filter(isActive).length;
  const inactiveCount = data.users.length - activeCount;
  const tabs: {
    value: typeof stateFilter;
    label: string;
    count: number;
  }[] = [
    { value: "all", label: "Tüm kullanıcılar", count: data.users.length },
    { value: "active", label: "Aktif", count: activeCount },
    { value: "inactive", label: "Pasif", count: inactiveCount },
  ];
  const metrics = [
    {
      label: "Toplam kullanıcı",
      count: data.users.length,
      hint: "Ekip ve otel yetkilileri",
      Icon: Users,
      color: "blue",
    },
    {
      label: "Aktif hesap",
      count: activeCount,
      hint: "Sisteme giriş yapabilir",
      Icon: UserCheck,
      color: "teal",
    },
    {
      label: "Otel gözlemcisi",
      count: data.users.filter((user) => user.role === "observer").length,
      hint: "Seçilen otelleri görüntüler",
      Icon: Eye,
      color: "blue",
    },
    {
      label: "Pasif hesap",
      count: inactiveCount,
      hint: "İş geçmişi korunur",
      Icon: CirclePause,
      color: "amber",
    },
  ];
  const hasFilters =
    search.trim() || roleFilter !== "all" || stateFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setRoleFilter("all");
    setStateFilter("all");
  };

  if (data.user.role !== "admin")
    return (
      <EmptyState
        title="Kullanıcı yönetimi için yönetici yetkisi gerekiyor"
        description="Hesapları ve otel erişimlerini yalnızca yöneticiler düzenleyebilir."
      />
    );

  return (
    <>
      <PageHeader
        eyebrow="YÖNETİM"
        title="Kullanıcılar"
        description="Ekibinizin hesaplarını, rollerini ve otel erişimlerini yönetin."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingUser(undefined);
              setComposerOpen(true);
            }}
          >
            <Plus size={17} /> Kullanıcı ekle
          </button>
        }
      />
      <div className="metric-strip">
        {metrics.map(({ label, count, hint, Icon, color }) => (
          <div className="metric" key={label}>
            <span className={`metric-icon ${color}`}>
              <Icon size={19} />
            </span>
            <div>
              <span className="metric-label">{label}</span>
              <strong>{count}</strong>
              <small>{hint}</small>
            </div>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="toolbar" style={{ gap: 16, flexWrap: "wrap" }}>
          <div
            className="tabs"
            role="group"
            aria-label="Kullanıcıları hesap durumuna göre filtrele"
            style={{ flexWrap: "wrap" }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.value}
                className={`tab ${stateFilter === tab.value ? "active" : ""}`}
                aria-pressed={stateFilter === tab.value}
                onClick={() => setStateFilter(tab.value)}
              >
                {tab.label} <span className="tab-count">{tab.count}</span>
              </button>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              flex: "1 1 340px",
              justifyContent: "flex-end",
            }}
          >
            <label
              className="search-field"
              style={{ flex: "1 1 220px", maxWidth: 320 }}
            >
              <Search size={16} />
              <input
                aria-label="Kullanıcı ara"
                placeholder="Ad, e-posta veya otel ara..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select
              className="select"
              style={{ width: "auto", minWidth: 140 }}
              value={roleFilter}
              aria-label="Role göre filtrele"
              onChange={(event) =>
                setRoleFilter(event.target.value as typeof roleFilter)
              }
            >
              <option value="all">Tüm roller</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            {hasFilters && (
              <button
                className="btn btn-small btn-secondary"
                onClick={clearFilters}
              >
                Temizle
              </button>
            )}
          </div>
        </div>
        <div className="task-list-meta">
          <span>{visibleUsers.length} kullanıcı gösteriliyor</span>
          <span>
            <ShieldCheck size={14} /> Erişimler yönetici kontrolünde
          </span>
        </div>
        {visibleUsers.length ? (
          <div className="table-wrap">
            <table className="data-table users-table">
              <thead>
                <tr>
                  <th>Kullanıcı</th>
                  <th>Rol ve ekip</th>
                  <th>Otel erişimi</th>
                  <th>Görevler</th>
                  <th>Hesap</th>
                  <th>
                    <span className="sr-only">Kullanıcı işlemleri</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => {
                  const workload = workloads.get(user.id) || {
                    open: 0,
                    completed: 0,
                  };
                  const RoleIcon =
                    user.role === "admin"
                      ? ShieldCheck
                      : user.role === "observer"
                        ? Eye
                        : UserRound;
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="assignee-cell">
                          <Avatar name={user.name} />
                          <div>
                            <span className="inline-items">
                              <strong>{user.name}</strong>
                              {user.id === data.user.id && (
                                <span className="chip">Siz</span>
                              )}
                            </span>
                            <span className="subtext">{user.email}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="inline-items">
                          <RoleIcon size={14} /> {ROLE_LABELS[user.role]}
                        </span>
                        <span className="subtext">{user.department}</span>
                      </td>
                      <td>
                        {user.role === "observer" ? (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              maxWidth: 300,
                            }}
                          >
                            {user.hotelIds.length ? (
                              user.hotelIds.map((id) => (
                                <span className="chip" key={id}>
                                  <Building2 size={12} />{" "}
                                  {hotelById.get(id)?.name || "Otel bulunamadı"}
                                </span>
                              ))
                            ) : (
                              <span className="muted">Otel atanmadı</span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-items">
                            <Building2 size={13} /> Tüm oteller
                          </span>
                        )}
                      </td>
                      <td>
                        {user.role === "observer" ? (
                          <>
                            <span className="muted">Görüntüleme yetkisi</span>
                            {workload.completed > 0 && (
                              <span className="subtext">
                                {workload.completed} tamamlanan iş geçmişi
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span>
                              <strong>{workload.open}</strong> açık iş
                            </span>
                            <span className="subtext">
                              {workload.completed} tamamlandı
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${isActive(user) ? "status-completed" : "status-planned"}`}
                        >
                          {isActive(user) ? (
                            <Check size={12} />
                          ) : (
                            <CirclePause size={12} />
                          )}
                          {isActive(user) ? "Aktif" : "Pasif"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-small btn-secondary"
                          aria-label={`${user.name} kullanıcısını düzenle`}
                          onClick={() => {
                            setEditingUser(user);
                            setComposerOpen(true);
                          }}
                        >
                          <Pencil size={14} /> Düzenle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Bu filtrelere uygun kullanıcı bulunamadı"
            description="Aramanızı değiştirebilir veya tüm hesapları görebilirsiniz."
            action={
              <button className="btn btn-secondary" onClick={clearFilters}>
                Filtreleri temizle
              </button>
            }
          />
        )}
        <div className="task-table-footer">
          <ShieldCheck size={14} />
          <span>
            Pasif hesapların sisteme girişi kapatılır; görevleri ve işlem
            geçmişi korunur.
          </span>
        </div>
      </section>
      {composerOpen && (
        <UserComposer
          {...props}
          user={editingUser}
          onClose={() => setComposerOpen(false)}
        />
      )}
    </>
  );
}

function UserComposer({
  data,
  refresh,
  notify,
  user,
  onClose,
}: ViewProps & { user?: User; onClose: () => void }) {
  const fieldId = useId();
  const [role, setRole] = useState<Role>(user?.role || "staff");
  const [hotelIds, setHotelIds] = useState<string[]>(user?.hotelIds || []);
  const [active, setActive] = useState(user ? isActive(user) : true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const editingSelf = user?.id === data.user.id;
  const departmentOptions = [
    ...new Set([
      "Yönetim",
      ...departments,
      "Otel Yönetimi",
      ...data.users.map((item) => item.department),
    ]),
  ].filter(Boolean);

  function toggleHotel(id: string) {
    setHotelIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || data.user.role !== "admin") return;
    setFormError("");
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name") || "").trim();
    const email = String(values.get("email") || "")
      .trim()
      .toLowerCase();
    const department = String(values.get("department") || "").trim();
    const password = String(values.get("password") || "");
    if (!name || !email || !department) {
      setFormError("Ad soyad, e-posta ve departman alanlarını doldurun.");
      return;
    }
    if (role === "observer" && hotelIds.length === 0) {
      setFormError("Otel gözlemcisi için en az bir otel seçin.");
      return;
    }
    if (!user && (password.length < 12 || password.length > 256)) {
      setFormError("İlk giriş şifresi 12 ile 256 karakter arasında olmalı.");
      return;
    }
    const body = {
      name,
      email,
      department,
      role: editingSelf ? user!.role : role,
      hotelIds: role === "observer" ? hotelIds : [],
      ...(user
        ? { active: editingSelf ? isActive(user) : active }
        : { password }),
    };
    setBusy(true);
    try {
      await api(
        user ? `/api/users/${user.id}` : "/api/users",
        body,
        user ? "PATCH" : "POST",
      );
      try {
        await refresh();
        notify(
          user
            ? "Kullanıcı bilgileri güncellendi."
            : "Kullanıcı hesabı oluşturuldu.",
        );
      } catch {
        notify(
          "Hesap kaydedildi; liste yenilenemedi. Yeniden hesap oluşturmanıza gerek yok. Sayfayı yenileyin.",
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
      title={user ? "Kullanıcıyı düzenle" : "Yeni kullanıcı ekle"}
      subtitle={
        user
          ? `${user.name} · Hesap bilgilerini ve erişimini düzenleyin.`
          : "Hesabı tanımlayın, rolünü ve erişebileceği otelleri seçin."
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
            style={{ marginBottom: 18 }}
          >
            {formError}
          </div>
        )}
        <div className="stack">
          <div className="form-grid">
            <Field label="Ad soyad *">
              <input
                className="input"
                name="name"
                autoComplete="name"
                defaultValue={user?.name || ""}
                placeholder="Ad ve soyad"
                disabled={busy}
                required
                maxLength={200}
              />
            </Field>
            <Field label="E-posta *">
              <input
                className="input"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={user?.email || ""}
                placeholder="isim@sirket.com"
                disabled={busy}
                required
                maxLength={254}
              />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Kullanıcı rolü *">
              <select
                className="select"
                value={role}
                disabled={editingSelf || busy}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {roles.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Departman / ekip *">
              <input
                className="input"
                name="department"
                list={`${fieldId}-departments`}
                defaultValue={user?.department || ""}
                disabled={busy}
                placeholder={
                  role === "observer"
                    ? "Örneğin: Otel Yönetimi"
                    : "Örneğin: Web & IT"
                }
                required
                maxLength={200}
              />
              <datalist id={`${fieldId}-departments`}>
                {departmentOptions.map((department) => (
                  <option key={department} value={department} />
                ))}
              </datalist>
            </Field>
          </div>
          <div className="notice">
            <ShieldCheck size={17} />
            <span>{roleDescriptions[role]}</span>
          </div>
          {editingSelf && (
            <p className="subtext">
              Kendi rolünüzü ve hesabınızın aktif durumunu bu ekrandan
              değiştiremezsiniz.
            </p>
          )}
          {role === "observer" ? (
            <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend className="field-label" style={{ marginBottom: 8 }}>
                Erişebileceği oteller *
              </legend>
              <p className="subtext" style={{ marginBottom: 10 }}>
                En az bir otel seçin. Diğer oteller bu kullanıcıya gösterilmez.
              </p>
              {data.hotels.length ? (
                <div
                  className="checklist"
                  style={{ maxHeight: 210, overflowY: "auto" }}
                >
                  {data.hotels.map((hotel) => (
                    <label
                      className={`checklist-item ${hotelIds.includes(hotel.id) ? "checked" : ""}`}
                      key={hotel.id}
                    >
                      <input
                        type="checkbox"
                        checked={hotelIds.includes(hotel.id)}
                        disabled={busy}
                        onChange={() => toggleHotel(hotel.id)}
                      />
                      <span>
                        {hotel.name}
                        <small className="subtext">{hotel.location}</small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="notice notice-warning">
                  Gözlemci eklemeden önce Oteller sayfasından bir otel
                  oluşturun.
                </div>
              )}
              <p className="subtext" style={{ marginTop: 10 }}>
                {hotelIds.length} otel seçildi
              </p>
            </fieldset>
          ) : (
            <div className="inline-items">
              <Building2 size={15} />
              <span>Tüm otellere erişebilir; ayrı otel seçimi gerekmez.</span>
            </div>
          )}
          {!user && (
            <div className="field">
              <label className="field-label" htmlFor={`${fieldId}-password`}>
                İlk giriş şifresi *
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id={`${fieldId}-password`}
                  className="input"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  disabled={busy}
                  required
                  placeholder="En az 12 karakter"
                  style={{ minWidth: 0 }}
                  aria-describedby={`${fieldId}-password-hint`}
                />
                <button
                  className="btn btn-secondary"
                  type="button"
                  aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                  aria-pressed={showPassword}
                  disabled={busy}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <small id={`${fieldId}-password-hint`}>
                Kullanıcı sisteme bu şifreyle giriş yapar. İlk giriş bilgisini
                kullanıcıyla paylaşın.
              </small>
            </div>
          )}
          {user && (
            <div>
              <span className="field-label">Hesap durumu</span>
              <label className="checklist-item" style={{ paddingBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={active}
                  disabled={editingSelf || busy}
                  onChange={(event) => setActive(event.target.checked)}
                />
                <span>Hesap aktif</span>
              </label>
              <p className="subtext">
                {active
                  ? "Kullanıcı mevcut rolüyle sisteme giriş yapabilir."
                  : "Sisteme girişi kapatılır. Mevcut görevleri ve işlem geçmişi korunur."}
              </p>
              {!active && (
                <div
                  className="notice notice-warning"
                  style={{ marginTop: 12 }}
                >
                  <CirclePause size={17} />
                  <span>
                    Açık görevleri veya otel sorumluluğu varsa hesabı pasife
                    almadan önce başka bir sorumluya aktarın.
                  </span>
                </div>
              )}
            </div>
          )}
          {!user && (
            <p className="subtext inline-items">
              <KeyRound size={14} /> Yeni hesap aktif olarak oluşturulur.
            </p>
          )}
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
            {user ? "Değişiklikleri kaydet" : "Hesabı oluştur"}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
