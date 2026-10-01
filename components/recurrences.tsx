"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarDays,
  CirclePause,
  Clock3,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api, departments, type ViewProps } from "@/lib/client";
import {
  createRecurrenceSchema,
  patchRecurrenceSchema,
  istanbulToday,
  isCalendarDay,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from "@/lib/recurrence";
import {
  Avatar,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  PriorityBadge,
  SubmitButton,
} from "./ui";
import styles from "./recurrences.module.css";

const dateLabel = (day: string | null) =>
  day
    ? new Intl.DateTimeFormat("tr-TR", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${day}T12:00:00Z`))
    : "Henüz oluşmadı";
function cadence(rule: Pick<RecurrenceRule, "startsOn" | "frequency">) {
  return rule.frequency === "weekly"
    ? `Her ${new Intl.DateTimeFormat("tr-TR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${rule.startsOn}T12:00:00Z`))}`
    : `Her ayın ${Number(rule.startsOn.slice(8))}. günü`;
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "İşlem tamamlanamadı.";

export function RecurrencesView(props: ViewProps) {
  const { data, refresh, notify } = props;
  const [rules, setRules] = useState<RecurrenceRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "paused" | "blocked">(
    "all",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<RecurrenceRule | undefined>();
  useEffect(() => {
    if (data.user.role !== "admin") return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch("/api/recurrences", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || "Düzenli işler yüklenemedi.");
        return body as { recurrences: RecurrenceRule[] };
      })
      .then((body) => {
        if (!controller.signal.aborted) setRules(body.recurrences);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorText(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [data, reload]);

  async function toggle(rule: RecurrenceRule) {
    if (busy) return;
    setBusy(rule.id);
    try {
      const result = await api<{ recurrence: RecurrenceRule }>(
        `/api/recurrences/${rule.id}`,
        { action: rule.active ? "pause" : "resume" },
        "PATCH",
      );
      setRules((current) =>
        current.map((item) => (item.id === rule.id ? result.recurrence : item)),
      );
      try {
        await refresh();
        notify(
          rule.active
            ? "Düzenli iş duraklatıldı."
            : "Düzenli iş devam ettirildi.",
        );
      } catch {
        notify(
          "Değişiklik kaydedildi; ekran yenilenemedi. İşlemi tekrarlamanıza gerek yok.",
          "error",
        );
      }
      setReload((current) => current + 1);
    } catch (failure) {
      notify(errorText(failure), "error");
    } finally {
      setBusy(null);
    }
  }
  if (data.user.role !== "admin")
    return (
      <EmptyState
        title="Düzenli işleri yöneticiler yönetebilir"
        description="Size atanan dönemsel işler, görev listenizde görünür."
      />
    );
  const filtered = rules.filter((rule) => {
    const hotel = data.hotels.find((item) => item.id === rule.hotelId);
    const assignee = data.users.find((item) => item.id === rule.assigneeId);
    return (
      (filter === "all" ||
        (filter === "active" && rule.active && !rule.blockedReason) ||
        (filter === "paused" && !rule.active) ||
        (filter === "blocked" && rule.active && Boolean(rule.blockedReason))) &&
      `${rule.title} ${hotel?.name} ${assignee?.name} ${rule.department}`
        .toLocaleLowerCase("tr")
        .includes(search.trim().toLocaleLowerCase("tr"))
    );
  });
  const tabs = [
    { value: "all", label: "Tüm planlar", count: rules.length },
    {
      value: "active",
      label: "Aktif",
      count: rules.filter((rule) => rule.active && !rule.blockedReason).length,
    },
    {
      value: "paused",
      label: "Duraklatılan",
      count: rules.filter((rule) => !rule.active).length,
    },
    {
      value: "blocked",
      label: "İşlem gerekiyor",
      count: rules.filter((rule) => rule.active && rule.blockedReason).length,
    },
  ] as const;
  return (
    <>
      <PageHeader
        eyebrow="İŞ PLANLAMA"
        title="Düzenli işler"
        description="Haftalık ve aylık işleri bir kez planlayın; her dönem ayrı bir görev oluşsun."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditing(undefined);
              setComposer(true);
            }}
          >
            <Plus size={16} /> Düzenli iş ekle
          </button>
        }
      />
      <div className="notice">
        <Repeat2 size={18} />
        <div>
          <strong>Her dönem kendi kaydını korur.</strong>
          <p>
            Oluşan görevler personel tarafından kontrole gönderilir ve yönetici
            onayıyla tamamlanır. Plan değişiklikleri önceki görevleri
            değiştirmez.
          </p>
        </div>
      </div>
      <section className="panel">
        <div className={`toolbar ${styles.toolbar}`}>
          <div
            className={`tabs ${styles.tabs}`}
            role="group"
            aria-label="Plan durumuna göre filtrele"
          >
            {tabs.map((tab) => (
              <button
                key={tab.value}
                className={`tab ${filter === tab.value ? "active" : ""}`}
                aria-pressed={filter === tab.value}
                onClick={() => setFilter(tab.value)}
              >
                {tab.label}
                <span className="tab-count">{tab.count}</span>
              </button>
            ))}
          </div>
          <label className="search-field">
            <Search size={15} />
            <input
              aria-label="Düzenli iş ara"
              placeholder="İş, otel veya sorumlu ara..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {loading && (
          <p className={styles.loading} role="status">
            Planlar yükleniyor…
          </p>
        )}
        {error && (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => setReload((current) => current + 1)}
            >
              Tekrar dene
            </button>
          </div>
        )}
        {!loading && !error && !filtered.length && (
          <EmptyState
            title={
              rules.length
                ? "Bu görünümde plan yok"
                : "İlk düzenli işinizi planlayın"
            }
            description="Örneğin haftalık OTA kontrolü veya aylık içerik planı için ayrı görevler oluşturabilirsiniz."
          />
        )}
        {filtered.length > 0 && (
          <div className="table-wrap">
            <table className={`data-table ${styles.table}`}>
              <thead>
                <tr>
                  <th>İş ve otel</th>
                  <th>Sorumlu</th>
                  <th>Tekrar</th>
                  <th>Sonraki görev</th>
                  <th>Öncelik</th>
                  <th>Durum</th>
                  <th>
                    <span className="sr-only">Plan işlemleri</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rule) => {
                  const hotel = data.hotels.find(
                    (item) => item.id === rule.hotelId,
                  );
                  const assignee = data.users.find(
                    (item) => item.id === rule.assigneeId,
                  );
                  return (
                    <tr key={rule.id}>
                      <td>
                        <strong>{rule.title}</strong>
                        <span className="subtext">
                          {hotel?.name} · {rule.department}
                        </span>
                        {rule.blockedReason && (
                          <p className={styles.blocked}>{rule.blockedReason}</p>
                        )}
                      </td>
                      <td>
                        <span className="assignee-cell">
                          <Avatar
                            name={assignee?.name || "Sorumlu"}
                            size="small"
                          />
                          {assignee?.name || "Sorumlu bulunamadı"}
                        </span>
                      </td>
                      <td>
                        <span className="inline-items">
                          <Repeat2 size={14} />
                          {cadence(rule)}
                        </span>
                        <span className="subtext">
                          Hedef:{" "}
                          {rule.dueOffsetDays === 0
                            ? "aynı gün"
                            : `${rule.dueOffsetDays} gün sonra`}
                        </span>
                      </td>
                      <td>
                        <span className="inline-items">
                          <CalendarDays size={14} />
                          {rule.active
                            ? dateLabel(rule.nextRunOn)
                            : "Duraklatıldı"}
                        </span>
                        <span className="subtext">
                          Son dönem: {dateLabel(rule.lastRunOn)}
                        </span>
                      </td>
                      <td>
                        <PriorityBadge value={rule.priority} />
                      </td>
                      <td>
                        <span
                          className={`badge ${!rule.active ? "status-planned" : rule.blockedReason ? "status-waiting" : "status-review"}`}
                        >
                          {!rule.active
                            ? "Duraklatıldı"
                            : rule.blockedReason
                              ? "İşlem gerekiyor"
                              : "Aktif"}
                        </span>
                      </td>
                      <td>
                        <div className={styles.actions}>
                          <button
                            className="btn btn-small btn-secondary"
                            onClick={() => {
                              setEditing(rule);
                              setComposer(true);
                            }}
                          >
                            <Pencil size={13} /> Düzenle
                          </button>
                          <button
                            className="btn btn-small btn-secondary"
                            disabled={Boolean(busy)}
                            onClick={() => void toggle(rule)}
                          >
                            {rule.active ? (
                              <CirclePause size={13} />
                            ) : (
                              <Play size={13} />
                            )}
                            {busy === rule.id
                              ? "Kaydediliyor…"
                              : rule.active
                                ? "Duraklat"
                                : "Devam et"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="task-table-footer">
          <Clock3 size={14} />
          <span>
            Türkiye tarihine göre çalışır. Duraklatılan dönemler devam
            edildiğinde atlanır.
          </span>
        </div>
      </section>
      {composer && (
        <RecurrenceComposer
          {...props}
          rule={editing}
          onSaved={() => {
            setComposer(false);
            setReload((current) => current + 1);
          }}
          onClose={() => setComposer(false)}
        />
      )}
    </>
  );
}

function RecurrenceComposer({
  data,
  refresh,
  notify,
  rule,
  onSaved,
  onClose,
}: ViewProps & {
  rule?: RecurrenceRule;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    rule?.frequency || "weekly",
  );
  const [startsOn, setStartsOn] = useState(rule?.startsOn || istanbulToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const people = data.users.filter(
    (user) => user.active !== false && user.role !== "observer",
  );
  const unavailable =
    rule && !people.some((user) => user.id === rule.assigneeId)
      ? data.users.find((user) => user.id === rule.assigneeId)
      : null;
  const teams = [
    ...new Set([
      ...departments,
      ...data.users.map((user) => user.department),
      ...(rule ? [rule.department] : []),
    ]),
  ];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const fields = {
      title: String(form.get("title") || "").trim(),
      description: String(form.get("description") || "").trim(),
      department: String(form.get("department") || ""),
      assigneeId: String(form.get("assigneeId") || ""),
      priority: Number(form.get("priority")),
      dueOffsetDays: Number(form.get("dueOffsetDays")),
      checklist: String(form.get("checklist") || "")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    };
    const parsed = rule
      ? patchRecurrenceSchema.safeParse({ action: "update", ...fields })
      : createRecurrenceSchema.safeParse({
          ...fields,
          hotelId: String(form.get("hotelId") || ""),
          frequency,
          startsOn,
        });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Alanları kontrol edin.");
      return;
    }
    setBusy(true);
    try {
      await api(
        rule ? `/api/recurrences/${rule.id}` : "/api/recurrences",
        parsed.data,
        rule ? "PATCH" : "POST",
      );
      try {
        await refresh();
        notify(rule ? "Düzenli iş güncellendi." : "Düzenli iş planlandı.");
      } catch {
        notify(
          "Plan kaydedildi; ekran yenilenemedi. Yeniden oluşturmanıza gerek yok.",
          "error",
        );
      }
      onSaved();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={rule ? "Düzenli işi düzenle" : "Düzenli iş planla"}
      subtitle={
        rule
          ? "Değişiklikler yalnızca bundan sonra oluşacak görevleri etkiler."
          : "Bir otel seçin; işin sorumlusunu ve tekrar sıklığını belirleyin."
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={save}>
        {error && (
          <div className="notice notice-warning" role="alert">
            {error}
          </div>
        )}
        <div className="stack">
          <Field label="İşin adı *">
            <input
              className="input"
              name="title"
              defaultValue={rule?.title || ""}
              required
              maxLength={200}
              placeholder="Örneğin: Haftalık OTA fiyat kontrolü"
            />
          </Field>
          <div className="form-grid">
            <Field label="Otel *">
              <select
                className="select"
                name="hotelId"
                defaultValue={rule?.hotelId || ""}
                disabled={Boolean(rule)}
                required
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
                defaultValue={rule?.department || ""}
                required
              >
                <option value="" disabled>
                  Ekip seçin
                </option>
                {teams.map((team) => (
                  <option key={team}>{team}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Açıklama">
            <textarea
              className="textarea"
              name="description"
              rows={2}
              defaultValue={rule?.description || ""}
              maxLength={5000}
              placeholder="Her dönemde yapılacak çalışmayı açıklayın."
            />
          </Field>
          <div className="form-grid">
            <Field label="Sorumlu *">
              <select
                className="select"
                name="assigneeId"
                defaultValue={rule?.assigneeId || ""}
                required
              >
                <option value="" disabled>
                  Aktif bir sorumlu seçin
                </option>
                {unavailable && (
                  <option value={unavailable.id} disabled>
                    {unavailable.name} · Yeniden atama gerekiyor
                  </option>
                )}
                {people.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.department}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Öncelik" hint="1 en yüksek, 10 en düşük öncelik.">
              <select
                className="select"
                name="priority"
                defaultValue={rule?.priority || 5}
              >
                {Array.from({ length: 10 }, (_, index) => index + 1).map(
                  (priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ),
                )}
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Tekrar sıklığı">
              <select
                className="select"
                value={frequency}
                disabled={Boolean(rule)}
                onChange={(event) =>
                  setFrequency(event.target.value as RecurrenceFrequency)
                }
              >
                <option value="weekly">Haftalık</option>
                <option value="monthly">Aylık</option>
              </select>
            </Field>
            <Field label="İlk görevin oluşacağı gün *">
              <input
                className="input"
                type="date"
                value={startsOn}
                min={rule ? undefined : istanbulToday()}
                disabled={Boolean(rule)}
                onChange={(event) => setStartsOn(event.target.value)}
                required
              />
            </Field>
          </div>
          {isCalendarDay(startsOn) && (
            <div className="notice">
              <Repeat2 size={17} />
              <div>
                <strong>{cadence({ startsOn, frequency })}</strong>
                <p>
                  {frequency === "monthly"
                    ? "O günün bulunmadığı aylarda ayın son günü kullanılır; sonraki ayda asıl güne dönülür."
                    : "Her hafta aynı gün yeni bir görev oluşturulur."}
                  {rule &&
                    " Otel ve tekrar takvimi bu plan oluşturulduktan sonra değiştirilmez."}
                </p>
              </div>
            </div>
          )}
          <Field
            label="Görev oluştuktan kaç gün sonra teslim edilmeli?"
            hint="0: oluştuğu gün teslim. En fazla 30 gün."
          >
            <input
              className="input"
              name="dueOffsetDays"
              type="number"
              min={0}
              max={30}
              step={1}
              defaultValue={rule?.dueOffsetDays ?? 0}
              required
            />
          </Field>
          <Field
            label="Tamamlanma kriterleri *"
            hint="Her satıra bir kriter yazın. Her yeni görev bu kriterlerle başlar."
          >
            <textarea
              className="textarea"
              name="checklist"
              rows={3}
              required
              maxLength={20000}
              defaultValue={rule?.checklist.join("\n") || ""}
              placeholder={
                "Fiyatlar karşılaştırıldı\nFarklar kontrol edildi ve kaydedildi"
              }
            />
          </Field>
          <p className={styles.hint}>
            <ShieldCheck size={14} /> Oluşan her görev yönetici onayıyla
            tamamlanır. Sorumlu pasifleşirse yeni görevler bekletilir.
          </p>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Vazgeç
          </button>
          <SubmitButton busy={busy}>
            {rule ? "Değişiklikleri kaydet" : "Planı oluştur"}
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
