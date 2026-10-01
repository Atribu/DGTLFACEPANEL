"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_FORMAT_LABEL,
  MAX_ATTACHMENT_BYTES,
  MAX_TASK_ATTACHMENTS,
  type TaskAttachment,
} from "@/lib/attachments";
import type { ViewProps } from "@/lib/client";
import type { Task, User } from "@/lib/types";
import styles from "./task-attachments.module.css";

type Props = {
  task: Task;
  user: User;
  refresh: ViewProps["refresh"];
  notify: ViewProps["notify"];
};
type AttachmentState = {
  items: TaskAttachment[];
  status: "loading" | "ready" | "error";
  hasLoaded: boolean;
  error: string;
};

function sizeLabel(size: number | null) {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  return (
    new Intl.NumberFormat("tr-TR", {
      maximumFractionDigits: size < 1024 * 1024 ? 0 : 1,
    }).format(size / (size < 1024 * 1024 ? 1024 : 1024 * 1024)) +
    (size < 1024 * 1024 ? " KB" : " MB")
  );
}
function safeLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}
const attachmentDate = (value: string) =>
  new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
function attachmentIcon(item: TaskAttachment) {
  if (item.kind === "link") return Link2;
  if (item.mimeType?.startsWith("image/")) return ImageIcon;
  if (item.fileName?.toLowerCase().endsWith(".zip")) return FileArchive;
  return FileText;
}
async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new Error(
      data?.error || "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
    );
  return data as T;
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "İşlem tamamlanamadı. Lütfen tekrar deneyin.";

export function TaskAttachments({ task, user, refresh, notify }: Props) {
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const mutationBusy = useRef(false);
  const mounted = useRef(true);
  const loadVersion = useRef(0);
  const [state, setState] = useState<AttachmentState>({
    items: [],
    status: "loading",
    hasLoaded: false,
    error: "",
  });
  const [reload, setReload] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [kind, setKind] = useState<"file" | "link">("file");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState("");
  const canWork =
    user.active !== false &&
    (user.role === "admin" ||
      (user.role === "staff" && task.assigneeId === user.id));
  const canEdit =
    canWork && task.status !== "review" && task.status !== "completed";
  const atLimit = state.items.length >= MAX_TASK_ATTACHMENTS;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const version = ++loadVersion.current;
    setState((current) => ({ ...current, status: "loading", error: "" }));
    void fetch(`/api/tasks/${encodeURIComponent(task.id)}/attachments`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(responseData<{ attachments: TaskAttachment[] }>)
      .then(({ attachments }) => {
        if (!controller.signal.aborted && version === loadVersion.current)
          setState({
            items: attachments,
            status: "ready",
            hasLoaded: true,
            error: "",
          });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && version === loadVersion.current)
          setState((current) => ({
            ...current,
            status: "error",
            error: message(error),
          }));
      });
    return () => controller.abort();
  }, [task.id, task.updatedAt, reload]);

  function resetComposer() {
    setComposerOpen(false);
    setTitle("");
    setUrl("");
    setSelectedFile(null);
    setFormError("");
    if (fileInput.current) fileInput.current.value = "";
  }
  async function refreshAfterSave(success: string) {
    try {
      await refresh();
      notify(success);
    } catch {
      notify(
        `${success} Diğer görev bilgileri yenilenemedi; işlemi tekrarlamanıza gerek yok.`,
        "error",
      );
    }
  }
  async function addAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || mutationBusy.current || atLimit) return;
    setFormError("");
    if (kind === "link" && (!title.trim() || !safeLink(url.trim()))) {
      setFormError(
        "Bir bağlantı adı ve http:// veya https:// ile başlayan geçerli bir adres yazın. Bağlantı kullanıcı adı veya şifre içermemeli.",
      );
      return;
    }
    if (kind === "file") {
      if (!selectedFile) {
        setFormError("Eklemek istediğiniz dosyayı seçin.");
        return;
      }
      if (selectedFile.size > MAX_ATTACHMENT_BYTES) {
        setFormError(
          `Dosya en fazla ${sizeLabel(MAX_ATTACHMENT_BYTES)} olabilir.`,
        );
        return;
      }
      const extension = "." + selectedFile.name.split(".").pop()?.toLowerCase();
      if (!ATTACHMENT_ACCEPT.split(",").includes(extension)) {
        setFormError(
          `Bu dosya türü desteklenmiyor. Ekleyebileceğiniz dosyalar: ${ATTACHMENT_FORMAT_LABEL}.`,
        );
        return;
      }
    }
    mutationBusy.current = true;
    setBusy("add");
    let body: FormData | string;
    if (kind === "file") {
      const form = new FormData();
      form.append("file", selectedFile!);
      if (title.trim()) form.append("title", title.trim());
      body = form;
    } else
      body = JSON.stringify({
        kind: "link",
        title: title.trim(),
        url: url.trim(),
      });
    try {
      const response = await fetch(
        `/api/tasks/${encodeURIComponent(task.id)}/attachments`,
        {
          method: "POST",
          body,
          ...(kind === "link"
            ? { headers: { "Content-Type": "application/json" } }
            : {}),
        },
      );
      const { attachment } = await responseData<{ attachment: TaskAttachment }>(
        response,
      );
      if (mounted.current) {
        loadVersion.current++;
        setState((current) => ({
          items: [
            attachment,
            ...current.items.filter((item) => item.id !== attachment.id),
          ],
          status: "ready",
          hasLoaded: true,
          error: "",
        }));
        resetComposer();
        setReload((current) => current + 1);
      }
      await refreshAfterSave(
        attachment.kind === "file" ? "Dosya eklendi." : "Bağlantı eklendi.",
      );
    } catch (error) {
      if (mounted.current) setFormError(message(error));
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  async function removeAttachment(item: TaskAttachment) {
    if (
      !canEdit ||
      mutationBusy.current ||
      (user.role !== "admin" && item.userId !== user.id)
    )
      return;
    mutationBusy.current = true;
    setBusy(item.id);
    setRemoveError("");
    try {
      const response = await fetch(
        `/api/attachments/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      await responseData<{ ok: true }>(response);
      if (mounted.current) {
        loadVersion.current++;
        setState((current) => ({
          ...current,
          items: current.items.filter(
            (attachment) => attachment.id !== item.id,
          ),
          status: "ready",
          error: "",
        }));
        setRemoveId(null);
        setReload((current) => current + 1);
      }
      await refreshAfterSave("Ek görevden kaldırıldı.");
    } catch (error) {
      if (mounted.current) setRemoveError(message(error));
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <section
      className={`panel ${styles.card}`}
      aria-labelledby={`${fieldId}-heading`}
    >
      <div className={`panel-heading ${styles.heading}`}>
        <div>
          <h2 id={`${fieldId}-heading`}>
            <Paperclip size={18} /> Dosyalar ve bağlantılar{" "}
            <span className="chip">
              {state.hasLoaded ? state.items.length : "…"}
            </span>
          </h2>
          <p>Bu işe ait belgeler, görseller ve referans bağlantıları.</p>
        </div>
        {canEdit && !composerOpen && (
          <button
            className="btn btn-secondary btn-small"
            disabled={Boolean(busy) || !state.hasLoaded || atLimit}
            onClick={() => {
              setFormError("");
              setKind("file");
              setComposerOpen(true);
            }}
          >
            <Plus size={15} /> Ek ekle
          </button>
        )}
      </div>
      <div className={styles.body}>
        <p className={styles.visibility}>
          <Users size={14} /> Bu görevi görebilen kişiler ekleri de görebilir.
        </p>
        {state.status === "loading" && (
          <p className={styles.loading} role="status">
            <LoaderCircle size={15} className="spin" />
            {state.hasLoaded ? "Ekler güncelleniyor…" : "Ekler yükleniyor…"}
          </p>
        )}
        {state.status === "error" && (
          <div className={styles.error} role="alert">
            <div>
              <strong>Ekler yüklenemedi.</strong>
              <p>
                {state.error}
                {state.hasLoaded && " Son görüntülenen kayıtlar gösteriliyor."}
              </p>
            </div>
            <button
              className="btn btn-secondary btn-small"
              onClick={() => setReload((current) => current + 1)}
            >
              Tekrar dene
            </button>
          </div>
        )}
        {state.hasLoaded && state.items.length === 0 && !composerOpen && (
          <div className={styles.empty}>
            <span>
              <Paperclip size={21} />
            </span>
            <strong>Henüz ek bulunmuyor</strong>
            <p>
              {canEdit
                ? "İşle ilgili bir belge, görsel veya bağlantı ekleyebilirsiniz."
                : "Bu göreve eklenen dosyalar ve bağlantılar burada görünür."}
            </p>
          </div>
        )}
        {state.items.length > 0 && (
          <ul className={styles.list}>
            {state.items.map((item) => {
              const Icon = attachmentIcon(item);
              const link = item.kind === "link" ? safeLink(item.url) : null;
              const canRemove =
                canEdit && (user.role === "admin" || item.userId === user.id);
              return (
                <li className={styles.item} key={item.id}>
                  <div className={styles.itemMain}>
                    <span className={styles.itemIcon}>
                      <Icon size={20} />
                    </span>
                    <div className={styles.itemContent}>
                      <strong className={styles.title}>{item.title}</strong>
                      <span className={styles.fileDetails}>
                        {item.kind === "file"
                          ? [item.fileName, sizeLabel(item.size)]
                              .filter(Boolean)
                              .join(" · ")
                          : link
                            ? `Bağlantı · ${link.hostname}`
                            : "Bağlantı adresi kullanılamıyor"}
                      </span>
                      <span className={styles.metadata}>
                        {item.userName} <span aria-hidden="true">·</span>{" "}
                        <time dateTime={item.createdAt}>
                          {attachmentDate(item.createdAt)}
                        </time>
                      </span>
                    </div>
                    <div className={styles.itemActions}>
                      {item.kind === "file" ? (
                        <a
                          className={styles.openLink}
                          href={`/api/attachments/${encodeURIComponent(item.id)}`}
                          download={item.fileName || undefined}
                          aria-label={`${item.title} dosyasını indir`}
                        >
                          <Download size={15} /> İndir
                        </a>
                      ) : (
                        link && (
                          <a
                            className={styles.openLink}
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${item.title} bağlantısını yeni sekmede aç`}
                          >
                            <ExternalLink size={15} /> Aç
                          </a>
                        )
                      )}
                      {canRemove && (
                        <button
                          type="button"
                          className={`icon-btn ${styles.removeButton}`}
                          aria-label={`${item.title} ekini kaldır`}
                          title="Eki kaldır"
                          disabled={Boolean(busy)}
                          onClick={() => {
                            setRemoveId(item.id);
                            setRemoveError("");
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                  {canRemove && removeId === item.id && (
                    <div className={styles.confirmation}>
                      <p>Bu eki görevden kaldırmak istiyor musunuz?</p>
                      <div className={styles.confirmActions}>
                        <button
                          className={`btn btn-small ${styles.confirmRemove}`}
                          disabled={Boolean(busy)}
                          onClick={() => void removeAttachment(item)}
                        >
                          {busy === item.id ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}{" "}
                          Kaldır
                        </button>
                        <button
                          className="btn btn-secondary btn-small"
                          disabled={Boolean(busy)}
                          onClick={() => {
                            setRemoveId(null);
                            setRemoveError("");
                          }}
                        >
                          Vazgeç
                        </button>
                      </div>
                      {removeError && (
                        <p className={styles.inlineError} role="alert">
                          {removeError}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && atLimit && (
          <p className={styles.locked}>
            <LockKeyhole size={14} /> Bu görevde en fazla {MAX_TASK_ATTACHMENTS}{" "}
            ek bulunabilir. Yeni bir ek için önce mevcut eklerden birini
            kaldırın.
          </p>
        )}
        {canWork && !canEdit && (
          <p className={styles.locked}>
            <LockKeyhole size={14} /> Kontrol bekleyen veya tamamlanan işlerin
            ekleri değiştirilemez. Gerekirse yönetici görevi yeniden açabilir.
          </p>
        )}
        {canEdit && composerOpen && (
          <form className={styles.composer} onSubmit={addAttachment}>
            <div className={styles.composerHeading}>
              <strong>Göreve ek ekle</strong>
              <div
                className={`tabs ${styles.kindTabs}`}
                role="group"
                aria-label="Ek türü"
              >
                <button
                  type="button"
                  className={`tab ${kind === "file" ? "active" : ""}`}
                  aria-pressed={kind === "file"}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setKind("file");
                    setFormError("");
                  }}
                >
                  <FileIcon size={14} /> Dosya
                </button>
                <button
                  type="button"
                  className={`tab ${kind === "link" ? "active" : ""}`}
                  aria-pressed={kind === "link"}
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setKind("link");
                    setFormError("");
                  }}
                >
                  <Link2 size={14} /> Bağlantı
                </button>
              </div>
            </div>
            {formError && (
              <div className={styles.error} role="alert">
                {formError}
              </div>
            )}
            {kind === "file" && (
              <div className={styles.field}>
                <label htmlFor={`${fieldId}-file`}>Dosya *</label>
                <input
                  ref={fileInput}
                  id={`${fieldId}-file`}
                  name="file"
                  type="file"
                  accept={ATTACHMENT_ACCEPT}
                  className={styles.fileInput}
                  disabled={Boolean(busy)}
                  required={!selectedFile}
                  aria-describedby={`${fieldId}-file-hint`}
                  onChange={(event) => {
                    setSelectedFile(event.target.files?.[0] || null);
                    setFormError("");
                  }}
                />
                <p id={`${fieldId}-file-hint`}>
                  {ATTACHMENT_FORMAT_LABEL} · Dosya başına en fazla{" "}
                  {sizeLabel(MAX_ATTACHMENT_BYTES)}.
                </p>
                {selectedFile && (
                  <span className={styles.selectedFile}>
                    <Paperclip size={13} /> {selectedFile.name} ·{" "}
                    {sizeLabel(selectedFile.size)}
                  </span>
                )}
              </div>
            )}
            <div className={styles.field}>
              <label htmlFor={`${fieldId}-title`}>
                {kind === "link" ? "Bağlantı adı *" : "Dosya başlığı"}
              </label>
              <input
                className="input"
                id={`${fieldId}-title`}
                name="title"
                placeholder={
                  kind === "link"
                    ? "Örneğin: Aylık içerik planı"
                    : "Boş bırakırsanız dosyanın adı kullanılır"
                }
                maxLength={200}
                required={kind === "link"}
                disabled={Boolean(busy)}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            {kind === "link" && (
              <div className={styles.field}>
                <label htmlFor={`${fieldId}-url`}>Bağlantı adresi *</label>
                <input
                  className="input"
                  type="url"
                  inputMode="url"
                  id={`${fieldId}-url`}
                  name="url"
                  placeholder="https://..."
                  required
                  disabled={Boolean(busy)}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
            )}
            <div className={styles.formActions}>
              <button
                className="btn btn-secondary btn-small"
                type="button"
                disabled={Boolean(busy)}
                onClick={resetComposer}
              >
                Vazgeç
              </button>
              <button
                className="btn btn-primary btn-small"
                type="submit"
                disabled={Boolean(busy) || atLimit}
              >
                {busy === "add" ? (
                  <LoaderCircle size={15} className="spin" />
                ) : kind === "file" ? (
                  <Upload size={15} />
                ) : (
                  <Plus size={15} />
                )}
                {busy === "add"
                  ? "Ekleniyor…"
                  : kind === "file"
                    ? "Dosyayı ekle"
                    : "Bağlantıyı ekle"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
