"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowUpRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ListTodo,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { today, type ViewProps } from "@/lib/client";
import type { OwnerConsoleData, OwnerEventKind } from "@/lib/owner-console";
import { ROLE_LABELS } from "@/lib/types";
import { Avatar, EmptyState, PageHeader } from "./ui";
import styles from "./owner-console.module.css";

interface Filters {
  from: string;
  to: string;
  actorId: string;
  kind: OwnerEventKind | "all";
  q: string;
}

const eventLabels: Record<OwnerEventKind, string> = {
  operation: "İşlem",
  user: "Kullanıcı",
  session: "Oturum",
};
const timestampFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function timestamp(value: string | null) {
  return value ? timestampFormatter.format(new Date(value)) : "Henüz kayıt yok";
}
function initialFilters(): Filters {
  const to = today();
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  return { from: start.toISOString().slice(0, 10), to, actorId: "", kind: "all", q: "" };
}
function filterQuery(filters: Filters) {
  return new URLSearchParams({ ...filters, q: filters.q.trim() }).toString();
}
function errorMessage(error: unknown) {
  if (error instanceof TypeError)
    return "Sunucuyla bağlantı kurulamadı. Son alınan veriler gösteriliyor.";
  return error instanceof Error ? error.message : "Sahip paneli yüklenemedi.";
}
function csvCell(value: string) {
  const safe = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function OwnerConsoleView(props: ViewProps) {
  // Do not mount the fetching component for a manually entered owner URL.
  if (props.data.user.role !== "admin" || props.data.user.isOwner !== true) return null;
  return <OwnerConsole {...props} />;
}

function OwnerConsole({ data, navigate, notify }: ViewProps) {
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [filters, setFilters] = useState<Filters>(draft);
  const [offset, setOffset] = useState(0);
  const [snapshot, setSnapshot] = useState<{ value: OwnerConsoleData; query: string; receivedAt: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [retry, setRetry] = useState(0);
  const [foreground, setForeground] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const query = `${filterQuery(filters)}&offset=${offset}`;
  const dirty = filterQuery(draft) !== filterQuery(filters);
  const currentPage = snapshot?.query === query;
  const consoleData = snapshot?.value;
  const stale = !!error || !foreground || !snapshot ||
    now - snapshot.receivedAt > (consoleData?.presenceWindowSeconds || 90) * 1_000;

  useEffect(() => {
    let disposed = false;
    let request: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      if (disposed || request || document.visibilityState !== "visible") return;
      if (!navigator.onLine) {
        setError("İnternet bağlantısı yok. Son alınan veriler gösteriliyor.");
        setLoading(false);
        return;
      }
      const controller = new AbortController();
      request = controller;
      setLoading(true);
      let timedOut = false;
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 20_000);
      try {
        const response = await fetch(`/api/owner/console?${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (disposed || controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) setSnapshot(null);
          throw new Error(result.error || "Sahip paneli yüklenemedi.");
        }
        const receivedAt = Date.now();
        setSnapshot({ value: result as OwnerConsoleData, query, receivedAt });
        setNow(receivedAt);
        setError(navigator.onLine ? "" : "İnternet bağlantısı kesildi. Son alınan veriler gösteriliyor.");
      } catch (cause) {
        if (disposed) return;
        setError(timedOut
          ? "Sunucudan zamanında yanıt alınamadı. Son alınan veriler gösteriliyor."
          : errorMessage(cause));
      } finally {
        if (timeout) clearTimeout(timeout);
        request = null;
        if (!disposed) setLoading(false);
      }
    }

    const onForeground = () => {
      const visible = document.visibilityState === "visible";
      setForeground(visible);
      setNow(Date.now());
      if (visible) void load();
    };
    const onOffline = () => {
      setError("İnternet bağlantısı kesildi. Son alınan veriler gösteriliyor.");
      setNow(Date.now());
    };
    onForeground();
    const interval = window.setInterval(onForeground, 30_000);
    window.addEventListener("focus", onForeground);
    window.addEventListener("online", onForeground);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      disposed = true;
      request?.abort();
      if (timeout) clearTimeout(timeout);
      window.clearInterval(interval);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("online", onForeground);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onForeground);
    };
  }, [query, retry]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.from || !draft.to || draft.from > draft.to) {
      setFormError("Geçerli bir tarih aralığı seçin; başlangıç bitişten sonra olamaz.");
      return;
    }
    setFormError("");
    setFilters({ ...draft, q: draft.q.trim() });
    setOffset(0);
    setRetry((value) => value + 1);
  }

  function downloadCsv() {
    if (!consoleData || !currentPage || !consoleData.events.length || loading || dirty) return;
    const rows = [
      ["Tarih ve saat (Europe/Istanbul)", "Kişi / hesap", "Kayıt türü", "İşlem", "Otel", "Görev"],
      ...consoleData.events.map((event) => [
        timestamp(event.createdAt), event.actorName, eventLabels[event.kind],
        event.message, event.hotelName || "", event.taskTitle || "",
      ]),
    ];
    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `dgtlface-islemler-${filters.from}-${filters.to}-sayfa-${Math.floor(consoleData.offset / consoleData.limit) + 1}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    notify("Bu sayfadaki işlem kayıtları CSV olarak indirildi.");
  }

  const patchDraft = (patch: Partial<Filters>) => setDraft((value) => ({ ...value, ...patch }));
  const summary = consoleData?.summary;
  const metricCards = summary ? [
    { label: "Çevrimiçi", value: stale ? "—" : summary.online, detail: stale ? "Bağlantı durumu doğrulanamadı" : `${summary.activeUsers} aktif hesap içinde`, icon: Wifi, tone: styles.onlineMetric },
    { label: "Açık görev", value: summary.openTasks, detail: "Tamamlanmayı bekleyen işler", icon: ListTodo, tone: "" },
    { label: "Geciken görev", value: summary.overdueTasks, detail: "Teslim tarihi geçmiş açık işler", icon: Clock3, tone: summary.overdueTasks ? styles.attentionMetric : "" },
    { label: "Başarısız giriş", value: summary.failedLoginsToday, detail: "Kayıtlı hesaplar · bugün · Türkiye saati", icon: ShieldCheck, tone: summary.failedLoginsToday ? styles.attentionMetric : "" },
  ] : [];

  return (
    <div className={styles.view}>
      <PageHeader
        title="Sahip Paneli"
        description="Ekip bağlantıları, operasyonun durumu ve zamanıyla birlikte işlem geçmişi."
        actions={
          <button className="btn btn-secondary" disabled={loading} onClick={() => setRetry((value) => value + 1)}>
            <RefreshCw size={15} className={loading ? "spin" : ""} aria-hidden="true" />
            {loading ? "Yenileniyor…" : "Şimdi yenile"}
          </button>
        }
      />
      <div className={styles.snapshotBar}>
        <span className={`${styles.connection} ${stale ? styles.unconfirmed : styles.connected}`}>
          {stale ? <WifiOff size={14} aria-hidden="true" /> : <Wifi size={14} aria-hidden="true" />}
          {!consoleData ? "Bağlantı bekleniyor" : stale ? "Güncel durum doğrulanamadı" : "Bağlantı güncel"}
        </span>
        <span>Son veri: {consoleData ? timestamp(consoleData.generatedAt) : "—"} · Türkiye saati (UTC+3)</span>
        <span>Bu ekran açıkken 30 saniyede bir yenilenir.</span>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          <TriangleAlert size={18} aria-hidden="true" />
          <div><strong>Güncelleme alınamadı</strong><p>{error} Çevrimiçi bilgisi yeniden bağlantı kurulunca doğrulanır.</p></div>
        </div>
      )}
      {!consoleData && loading && (
        <div className={`panel ${styles.loading}`} role="status"><LoaderCircle className="spin" size={25} aria-hidden="true" /><p>Operasyon bilgileri alınıyor…</p></div>
      )}
      {consoleData && summary && (
        <>
          <div className={styles.metrics}>
            {metricCards.map((card) => (
              <section className={`${styles.metric} ${card.tone}`} key={card.label}>
                <div><span>{card.label}</span><card.icon size={18} aria-hidden="true" /></div>
                <strong>{card.value}</strong><p>{card.detail}</p>
              </section>
            ))}
          </div>
          <div className={styles.workflow}>
            <span>{stale ? "Son alınan operasyon" : "Güncel operasyon"} <small>Alttaki tarih filtresi yalnızca işlem geçmişini etkiler.</small></span>
            <div><strong>{summary.awaitingReview}</strong> Kontrol bekleyen</div>
            <div><strong>{summary.waitingTasks}</strong> Bilgi / işlem bekleyen</div>
            <div><strong>{summary.activeUsers}</strong> Aktif hesap</div>
          </div>
          <section className="panel" aria-labelledby="owner-team-heading">
            <div className={`panel-heading ${styles.sectionHeading}`}>
              <div><h2 id="owner-team-heading"><Users size={17} aria-hidden="true" /> Ekip ve bağlantı durumu</h2><p>Çevrimiçi: son {consoleData.presenceWindowSeconds} saniyede panelden bağlantı alındı. Son görülme, çalışma süresini göstermez.</p></div>
              <span className="chip">{consoleData.team.length} hesap</span>
            </div>
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Ekip bağlantı tablosu, yatay kaydırılabilir">
              <table className={styles.table}>
                <thead><tr><th>Kişi</th><th>Bağlantı</th><th>Kanal</th><th>Son görülme</th><th>Son giriş</th><th>Açık</th><th>Geciken</th></tr></thead>
                <tbody>{consoleData.team.map((member) => (
                  <tr key={member.id}>
                    <td><div className={styles.person}><Avatar name={member.name} size="small" /><div><strong>{member.name}</strong><small>{ROLE_LABELS[member.role]}{member.deletedAt ? " · Silinmiş hesap" : !member.active ? " · Pasif hesap" : ""}</small><small>{member.email}</small></div></div></td>
                    <td><span className={`${styles.presence} ${stale && member.active && !member.deletedAt ? styles.unknownPresence : member.online && !stale ? styles.onlinePresence : styles.offlinePresence}`}><i aria-hidden="true" />{member.deletedAt || !member.active ? "Erişim kapalı" : stale ? "Doğrulanamadı" : member.online ? "Çevrimiçi" : "Çevrimdışı"}</span></td>
                    <td><span className={styles.channels}>{member.channels.length ? member.channels.map((channel) => channel === "mobile" ? "iPhone" : "Web").join(" · ") : "—"}</span></td>
                    <td className={styles.timestamp}>{timestamp(member.lastSeenAt)}</td>
                    <td className={styles.timestamp}>{timestamp(member.lastLoginAt)}</td>
                    <td className={styles.number}>{member.openTasks}</td>
                    <td className={`${styles.number} ${member.overdueTasks ? styles.overdue : ""}`}>{member.overdueTasks}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {!consoleData.team.length && <EmptyState title="Henüz ekip hesabı yok" description="Kullanıcı eklediğinizde bağlantı ve görev bilgileri burada görünür." />}
          </section>
          <section className="panel" aria-labelledby="owner-hotels-heading">
            <div className={`panel-heading ${styles.sectionHeading}`}><div><h2 id="owner-hotels-heading"><Building2 size={17} aria-hidden="true" /> Otellerde bekleyen işler</h2><p>Geciken işleri ve kontrol bekleyen teslimleri otel bazında izleyin.</p></div></div>
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Otel iş durumu tablosu, yatay kaydırılabilir">
              <table className={`${styles.table} ${styles.hotelTable}`}>
                <thead><tr><th>Otel</th><th>Açık görev</th><th>Geciken</th><th>Kontrol bekleyen</th><th>Bilgi / işlem bekleyen</th></tr></thead>
                <tbody>{consoleData.hotels.map((hotel) => (
                  <tr key={hotel.id}><td><button className={styles.link} onClick={() => navigate("hotel", hotel.id)}>{hotel.name}<ArrowUpRight size={14} aria-hidden="true" /></button></td><td className={styles.number}>{hotel.openTasks}</td><td className={`${styles.number} ${hotel.overdueTasks ? styles.overdue : ""}`}>{hotel.overdueTasks}</td><td className={styles.number}>{hotel.awaitingReview}</td><td className={styles.number}>{hotel.waitingTasks}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {!consoleData.hotels.length && <EmptyState title="Henüz otel yok" />}
          </section>
        </>
      )}
      <section className="panel" aria-labelledby="owner-events-heading">
        <div className={`panel-heading ${styles.sectionHeading}`}>
          <div><h2 id="owner-events-heading"><Activity size={17} aria-hidden="true" /> İşlem geçmişi</h2><p>İşlemler, kullanıcı değişiklikleri ve oturum kayıtları · En yeni önce · Türkiye saati</p><p>Başarısız girişlerde kişi, giriş denenmiş hesabı belirtir.</p></div>
          <button className="btn btn-secondary btn-small" disabled={!currentPage || !consoleData?.events.length || loading || dirty} onClick={downloadCsv}><Download size={14} aria-hidden="true" /> Bu sayfayı CSV indir</button>
        </div>
        <form className={styles.filters} onSubmit={applyFilters}>
          <div className={styles.filterFields}>
            <label className={styles.field}><span>Başlangıç</span><input required type="date" value={draft.from} max={draft.to || undefined} onChange={(event) => patchDraft({ from: event.target.value })} /></label>
            <label className={styles.field}><span>Bitiş (dahil)</span><input required type="date" value={draft.to} min={draft.from || undefined} onChange={(event) => patchDraft({ to: event.target.value })} /></label>
            <label className={styles.field}><span>Kişi</span><select value={draft.actorId} onChange={(event) => patchDraft({ actorId: event.target.value })}><option value="">Herkes</option><option value={data.user.id}>Ben ({data.user.name})</option>{consoleData?.team.map((member) => <option key={member.id} value={member.id}>{member.name}{member.deletedAt ? " (silinmiş)" : ""}</option>)}</select></label>
            <label className={styles.field}><span>Kayıt türü</span><select value={draft.kind} onChange={(event) => patchDraft({ kind: event.target.value as Filters["kind"] })}><option value="all">Tüm kayıtlar</option><option value="operation">İşlemler</option><option value="user">Kullanıcı değişiklikleri</option><option value="session">Oturumlar</option></select></label>
            <label className={`${styles.field} ${styles.searchField}`}><span>Kayıtlarda ara</span><input type="search" maxLength={120} placeholder="İşlem, otel veya görev…" value={draft.q} onChange={(event) => patchDraft({ q: event.target.value })} /></label>
            <button className="btn btn-primary" type="submit">Filtrele</button>
          </div>
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <div className={styles.filterNote}><span>{dirty ? "Filtre değişikliklerini görmek için Filtrele’ye basın." : `Seçili aralık: ${filters.from.split("-").reverse().join(".")} – ${filters.to.split("-").reverse().join(".")}`}</span><span>CSV yalnızca bu sayfadaki kayıtları içerir.</span></div>
        </form>
        {!currentPage ? (
          <div className={styles.pendingEvents} role="status">{loading ? <><LoaderCircle className="spin" size={18} aria-hidden="true" /> Seçili filtrelerin kayıtları yükleniyor…</> : "Seçili filtrelerin kayıtları alınamadı. Şimdi yenile düğmesiyle tekrar deneyin."}</div>
        ) : consoleData?.events.length ? (
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="İşlem geçmişi tablosu, yatay kaydırılabilir">
            <table className={`${styles.table} ${styles.eventsTable}`}>
              <thead><tr><th>Tarih ve saat (UTC+3)</th><th>Kişi / hesap</th><th>Tür</th><th>İşlem ve detay</th></tr></thead>
              <tbody>{consoleData.events.map((event) => (
                <tr key={`${event.kind}-${event.id}`}>
                  <td className={styles.timestamp}><time dateTime={event.createdAt}>{timestamp(event.createdAt)}</time></td>
                  <td className={styles.eventActor}>{event.actorName}</td>
                  <td><span className={styles.eventKind}>{eventLabels[event.kind]}</span></td>
                  <td className={styles.eventMessage}><p>{event.message}</p>{(event.hotelName || event.taskTitle) && <div>{event.hotelName && <span>{event.hotelName}</span>}{event.taskTitle && (event.taskId ? <button className={styles.link} onClick={() => navigate("task", event.taskId!)}>{event.taskTitle}<ArrowUpRight size={12} aria-hidden="true" /></button> : <span>{event.taskTitle}</span>)}</div>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="Bu filtrelere uygun kayıt yok" description="Tarih aralığını genişletebilir veya kişi ve kayıt türü filtrelerini değiştirebilirsiniz." />}
        <div className={styles.pagination}>
          <span>{currentPage && consoleData ? consoleData.events.length ? `${consoleData.offset + 1}–${consoleData.offset + consoleData.events.length}. kayıtlar` : "0 kayıt" : "—"} · Sayfa başına 50 kayıt</span>
          <div><button className="btn btn-secondary btn-small" aria-label="Önceki kayıt sayfası" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}><ChevronLeft size={15} aria-hidden="true" /> Önceki</button><span>Sayfa {Math.floor(offset / 50) + 1}</span><button className="btn btn-secondary btn-small" aria-label="Sonraki kayıt sayfası" disabled={loading || !currentPage || !consoleData?.hasMore} onClick={() => setOffset((value) => value + 50)}>Sonraki <ChevronRight size={15} aria-hidden="true" /></button></div>
        </div>
      </section>
    </div>
  );
}
