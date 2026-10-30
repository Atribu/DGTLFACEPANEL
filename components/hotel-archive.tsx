"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { api, type ViewProps } from "@/lib/client";
import type { Hotel } from "@/lib/types";
import { Avatar, EmptyState, Field, Modal } from "./ui";
import styles from "./hotel-archive.module.css";

interface ArchivedHotel {
  hotel: Hotel;
  counts: { tasks: number; comments: number; attachments: number; recurrences: number };
}

const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : "İşlem tamamlanamadı. Lütfen tekrar deneyin.";

function archiveDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Tarih bilgisi yok";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}

export function HotelArchivePanel(props: ViewProps & { search: string }) {
  const { data, search, notify, refresh } = props;
  const [entries, setEntries] = useState<ArchivedHotel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<{ entry: ArchivedHotel; action: "restore" | "delete" }>();
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const isAdmin = data.user.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    request.current = controller;
    const current = ++sequence.current;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const response = await fetch("/api/hotels/archived", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Otel arşivi yüklenemedi.");
        if (sequence.current === current && !controller.signal.aborted)
          setEntries(body.hotels);
      } catch (cause) {
        if (sequence.current === current && !controller.signal.aborted)
          setError(errorMessage(cause));
      } finally {
        if (sequence.current === current && !controller.signal.aborted)
          setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [isAdmin, data.user.id, revision]);

  function reload() {
    request.current?.abort();
    sequence.current++;
    setRevision((value) => value + 1);
  }

  async function onChanged(entry: ArchivedHotel, action: "restore" | "delete") {
    // A response started before this mutation must not restore an outdated row.
    request.current?.abort();
    sequence.current++;
    setEntries((current) => current.filter(({ hotel }) => hotel.id !== entry.hotel.id));
    setSelected(undefined);
    reload();
    const message = action === "restore"
      ? `${entry.hotel.name} aktif otellere geri alındı. Tekrarlayan görevler duraklatılmış olarak kaldı.`
      : `${entry.hotel.name} ve otele bağlı içerikler kalıcı olarak silindi.`;
    try {
      await refresh();
      notify(message);
    } catch {
      notify(`${message} Diğer panel verileri yenilenemedi; sayfayı yenileyin.`, "error");
    }
  }

  if (!isAdmin) return null;
  const query = search.trim().toLocaleLowerCase("tr");
  const shown = entries.filter(({ hotel }) => {
    const manager = data.users.find((user) => user.id === hotel.managerId);
    return [hotel.name, hotel.location, ...hotel.services, manager?.name || ""]
      .join(" ").toLocaleLowerCase("tr").includes(query);
  });

  return (
    <>
      <div className={`muted ${styles.archiveInfo}`}>
        Arşivdeki oteller günlük listelerde görünmez; görevleri ve dosyaları korunur.
        Geri alma ve kalıcı silme işlemlerini yalnızca yöneticiler yapabilir.
      </div>
      {loading ? (
        <div className={styles.archiveInfo} role="status">
          <LoaderCircle size={16} className="spin" aria-hidden="true" /> Arşiv yükleniyor…
        </div>
      ) : error ? (
        <div className={styles.archiveInfo}>
          <p className="notice notice-warning" role="alert">{error}</p>
          <button className="btn btn-secondary" onClick={reload}>
            <RefreshCw size={16} /> Tekrar dene
          </button>
        </div>
      ) : shown.length ? (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr>
                <th>OTEL</th><th>ARŞİVLENME</th><th>KORUNAN İÇERİK</th><th>İŞLEMLER</th>
              </tr></thead>
              <tbody>
                {shown.map((entry) => (
                  <tr key={entry.hotel.id}>
                    <td>
                      <div className={styles.actions} style={{ alignItems: "center", flexWrap: "nowrap" }}>
                        <Avatar name={entry.hotel.name} color={entry.hotel.color} />
                        <span><strong>{entry.hotel.name}</strong><span className="subtext">{entry.hotel.location || "Konum eklenmedi"}</span></span>
                      </div>
                    </td>
                    <td>{archiveDate(entry.hotel.archivedAt)}</td>
                    <td>
                      <div>{entry.counts.tasks} görev · {entry.counts.comments} yorum</div>
                      <div className="subtext">{entry.counts.attachments} ek · {entry.counts.recurrences} tekrarlayan görev kuralı</div>
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button className="btn btn-secondary btn-small" disabled={!!selected} aria-label={`${entry.hotel.name} otelini geri al`} onClick={() => setSelected({ entry, action: "restore" })}>
                          <ArchiveRestore size={15} /> Geri al
                        </button>
                        <button className={`btn btn-small ${styles.deleteButton}`} disabled={!!selected || !entry.hotel.archivedAt} aria-label={`${entry.hotel.name} otelini kalıcı sil`} onClick={() => setSelected({ entry, action: "delete" })}>
                          <Trash2 size={15} /> Kalıcı sil
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.archiveInfo}>
            <span className="muted">{shown.length} arşivlenmiş otel gösteriliyor. </span>
            <button className="text-btn" disabled={!!selected} onClick={reload}>Listeyi yenile</button>
          </div>
        </>
      ) : (
        <EmptyState
          title={entries.length ? "Eşleşen arşiv kaydı bulunamadı" : "Otel arşivi boş"}
          description={entries.length ? "Farklı bir otel adı veya konumla aramayı deneyin." : "Otel detayındaki Arşivle düğmesiyle kaldırdığınız oteller burada görünür."}
          action={<button className="btn btn-secondary" onClick={reload}><RefreshCw size={16} /> Listeyi yenile</button>}
        />
      )}
      {selected && (
        <ArchivedHotelDialog
          key={`${selected.entry.hotel.id}-${selected.action}`}
          {...selected}
          onChanged={() => onChanged(selected.entry, selected.action)}
          onClose={() => setSelected(undefined)}
          onReload={() => { setSelected(undefined); reload(); }}
        />
      )}
    </>
  );
}

function ArchivedHotelDialog({ entry, action, onChanged, onClose, onReload }: {
  entry: ArchivedHotel;
  action: "restore" | "delete";
  onChanged: () => Promise<void>;
  onClose: () => void;
  onReload: () => void;
}) {
  const [confirmationName, setConfirmationName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const deleting = action === "delete";
  const { hotel, counts } = entry;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || (deleting && (confirmationName !== hotel.name || !hotel.archivedAt))) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/api/hotels/${hotel.id}`,
        deleting ? { confirmationName, archivedAt: hotel.archivedAt } : { action: "restore" },
        deleting ? "DELETE" : "PATCH");
      await onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title={deleting ? "Oteli kalıcı sil" : "Oteli geri al"} subtitle={hotel.name} onClose={() => { if (!pending.current) onClose(); }}>
      <form onSubmit={submit} aria-busy={busy}>
        <div className={`notice ${deleting ? "notice-warning" : ""} ${styles.notice}`}>
          {deleting ? <Trash2 size={18} aria-hidden="true" /> : <ArchiveRestore size={18} aria-hidden="true" />}
          <div>
            <strong>{deleting ? "Bu işlem geri alınamaz." : "Otel tekrar aktif listelere alınacak."}</strong>
            <p>{deleting
              ? "Otel, görevleri, kontrol listeleri, yorumları, dosya ve bağlantı ekleri, bildirimleri ve tekrarlayan görev kuralları kalıcı olarak silinir."
              : "Korunan görevler, yorumlar ve dosyalar yeniden erişilebilir olur. Tekrarlayan görev kuralları duraklatılmış kalır; gerekiyorsa Düzenli İşler ekranından yeniden başlatın."}</p>
          </div>
        </div>
        {deleting && (
          <>
            <div className={styles.counts} aria-label="Silinecek içerikler">
              <div><strong>{counts.tasks}</strong>Görev</div>
              <div><strong>{counts.comments}</strong>Yorum</div>
              <div><strong>{counts.attachments}</strong>Dosya ve bağlantı eki</div>
              <div><strong>{counts.recurrences}</strong>Tekrarlayan görev kuralı</div>
            </div>
            <p className={styles.hint}>Ek sayısına daha önce kaldırılmış kayıtlar da dahildir. Silme işleminin kim tarafından ve ne zaman yapıldığına dair yönetim kaydı korunur.</p>
            <Field label="Onaylamak için otel adını aynen yazın" hint={hotel.name}>
              <input className="input" name="confirmationName" value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} required />
            </Field>
          </>
        )}
        {error && <div className="notice notice-warning" role="alert"><span>{error}</span><button type="button" className="text-btn" disabled={busy} onClick={onReload}>Arşivi yenile</button></div>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Vazgeç</button>
          <button type="submit" className={`btn ${deleting ? styles.deleteButton : "btn-primary"}`} disabled={busy || (deleting && (confirmationName !== hotel.name || !hotel.archivedAt))}>
            {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : deleting ? <Trash2 size={16} aria-hidden="true" /> : <ArchiveRestore size={16} aria-hidden="true" />}
            {busy ? "İşlem yapılıyor…" : deleting ? "Oteli kalıcı sil" : "Oteli geri al"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function HotelArchiveDialog({ hotel, refresh, notify, navigate, onClose }: ViewProps & { hotel: Hotel; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function archive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/api/hotels/${hotel.id}`, { action: "archive" }, "PATCH");
      try {
        await refresh();
        notify(`${hotel.name} arşivlendi. İçerikler korundu; tekrarlayan görevler duraklatıldı.`);
      } catch {
        notify("Otel arşivlendi; panel verileri yenilenemedi. Sayfayı yenileyin.", "error");
      }
      navigate("hotels");
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title="Oteli arşivle" subtitle={hotel.name} onClose={() => { if (!pending.current) onClose(); }}>
      <form onSubmit={archive} aria-busy={busy}>
        <div className={`notice notice-warning ${styles.notice}`}>
          <Archive size={18} aria-hidden="true" />
          <div><strong className={styles.name}>{hotel.name} arşivlenecek.</strong><p>Otel ve işleri günlük listelerden kaldırılır. Görevler, yorumlar ve dosyalar korunur; tekrarlayan görev kuralları duraklatılır.</p></div>
        </div>
        <p className={styles.hint}>Oteller → Arşiv bölümünden daha sonra geri alabilir veya kalıcı olarak silebilirsiniz. Arşivlenen otele ekip ve otel gözlemcileri erişemez.</p>
        {error && <div className="notice notice-warning" role="alert">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Vazgeç</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
            {busy ? "Arşivleniyor…" : "Oteli arşivle"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
