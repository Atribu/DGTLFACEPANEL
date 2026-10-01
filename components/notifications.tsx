"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  Clock,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { api, type ViewProps } from "../lib/client";
import type {
  NotificationList,
  PersonalNotification,
} from "../lib/notifications";
import styles from "./notifications.module.css";

const changedEvent = "dgtlface:notifications-changed";
const empty: NotificationList = { notifications: [], unreadCount: 0 };

function useNotifications(userId: string) {
  const [value, setValue] = useState<NotificationList>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Bildirimler alınamadı.");
      if (!controller.signal.aborted) {
        setValue(result);
        setError("");
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Bildirimler alınamadı.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setValue(empty);
    setLoading(true);
    setError("");
    void refresh();
    const reload = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(reload, 60_000);
    window.addEventListener("focus", reload);
    window.addEventListener(changedEvent, reload);
    document.addEventListener("visibilitychange", reload);
    return () => {
      pending.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", reload);
      window.removeEventListener(changedEvent, reload);
      document.removeEventListener("visibilitychange", reload);
    };
  }, [refresh]);

  return { ...value, loading, error, refresh };
}

export function NotificationBell({
  userId,
  onOpen,
}: {
  userId: string;
  onOpen: () => void;
}) {
  const { unreadCount, error } = useNotifications(userId);
  const label = error
    ? "Bildirimler; sayı şu anda alınamıyor"
    : `Bildirimler${unreadCount ? `, ${unreadCount} okunmamış` : ""}`;
  return (
    <button
      type="button"
      className={styles.bell}
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      <Bell size={19} aria-hidden="true" />
      {unreadCount > 0 && (
        <span className={styles.badge} aria-hidden="true">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
}

export function NotificationsView({
  data,
  navigate,
  notify,
  refresh: refreshWorkspace,
}: ViewProps) {
  const { notifications, unreadCount, loading, error, refresh } =
    useNotifications(data.user.id);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const visible =
    filter === "unread"
      ? notifications.filter((item) => !item.readAt)
      : notifications;
  const hotelNames = new Map(
    data.hotels.map((hotel) => [hotel.id, hotel.name]),
  );

  async function markRead(item?: PersonalNotification) {
    setBusy(item?.id ?? "all");
    try {
      await api(
        "/api/notifications",
        item ? { action: "read", id: item.id } : { action: "read_all" },
        "PATCH",
      );
      window.dispatchEvent(new Event(changedEvent));
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : "Bildirim güncellenemedi.",
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  async function openTask(item: PersonalNotification) {
    if (!item.readAt) await markRead(item);
    try {
      await refreshWorkspace();
      navigate("task", item.taskId);
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : "Görev bilgileri alınamadı.",
        "error",
      );
    }
  }

  return (
    <section className={styles.page} aria-labelledby="notifications-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>KİŞİSEL AKIŞINIZ</p>
          <h1 id="notifications-title">Bildirimler</h1>
          <p>
            {data.user.role === "observer"
              ? "Otellerinizde beklemeye alınan ve yönetici onayıyla tamamlanan işleri takip edin."
              : "Size atanan işler, yönetici kontrolü ve önemli tarihleri buradan takip edin."}
          </p>
        </div>
        <button
          type="button"
          className={styles.readAll}
          onClick={() => void markRead()}
          disabled={!!busy || unreadCount === 0 || loading}
        >
          <CheckCheck size={17} aria-hidden="true" />{" "}
          {busy === "all" ? "Güncelleniyor…" : "Tümünü okundu işaretle"}
        </button>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.filters} aria-label="Bildirim filtresi">
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            Tümü
          </button>
          <button
            type="button"
            aria-pressed={filter === "unread"}
            onClick={() => setFilter("unread")}
          >
            Okunmamış <span>{unreadCount}</span>
          </button>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void refresh()}
          aria-label="Bildirimleri yenile"
          title="Bildirimleri yenile"
        >
          <RefreshCw size={16} aria-hidden="true" /> <span>Yenile</span>
        </button>
      </div>

      {error && (
        <div role="alert" className={styles.error}>
          {error}{" "}
          <button type="button" onClick={() => void refresh()}>
            Tekrar dene
          </button>
        </div>
      )}
      {loading ? (
        <div className={styles.empty} role="status">
          Bildirimler yükleniyor…
        </div>
      ) : visible.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Inbox size={26} aria-hidden="true" />
          </span>
          <h2>
            {filter === "unread"
              ? "Okunmamış bildiriminiz yok"
              : "Henüz bildiriminiz yok"}
          </h2>
          <p>
            {filter === "unread"
              ? "Yeni bir gelişme olduğunda burada göreceksiniz."
              : "Görevlerinizdeki gelişmeler bu alanda görünecek."}
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {visible.map((item) => (
            <li
              key={item.id}
              className={`${styles.item} ${!item.readAt ? styles.unread : ""}`}
            >
              <span
                className={`${styles.icon} ${item.kind === "overdue" || item.kind === "waiting" ? styles.attention : ""}`}
                aria-hidden="true"
              >
                {item.kind === "approved" ? (
                  <CheckCheck size={19} />
                ) : item.kind === "due_today" || item.kind === "overdue" ? (
                  <Clock size={19} />
                ) : (
                  <Bell size={18} />
                )}
              </span>
              <div className={styles.content}>
                <div className={styles.itemTop}>
                  <h2>{item.title}</h2>
                  {!item.readAt && (
                    <span className={styles.unreadLabel}>Yeni</span>
                  )}
                </div>
                <p>{item.message}</p>
                <div className={styles.metadata}>
                  <span>{hotelNames.get(item.hotelId) ?? "Otel görevi"}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={item.createdAt}>
                    {timestamp(item.createdAt)}
                  </time>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.openTask}
                    disabled={!!busy}
                    onClick={() => void openTask(item)}
                  >
                    Görevi aç <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                  {!item.readAt && (
                    <button
                      type="button"
                      className={styles.markRead}
                      disabled={!!busy}
                      onClick={() => void markRead(item)}
                    >
                      <Check size={15} aria-hidden="true" />{" "}
                      {busy === item.id ? "Güncelleniyor…" : "Okundu işaretle"}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && notifications.length === 100 && (
        <p className={styles.limit}>
          Okunmamışlar önce olmak üzere son 100 bildirim gösteriliyor. “Tümünü
          okundu işaretle” tüm kişisel bildirimlerinizi kapsar.
        </p>
      )}
    </section>
  );
}
