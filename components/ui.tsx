"use client";
import { useEffect, useRef } from "react";
import {
  X,
  Check,
  ArrowUp,
  Circle,
  Clock3,
  CheckCheck,
  Pause,
  Eye,
  LoaderCircle,
} from "lucide-react";
import { STATUS_LABELS, type TaskStatus } from "@/lib/types";
import { initials } from "@/lib/client";
export function Avatar({
  name,
  color,
  size = "normal",
}: {
  name: string;
  color?: string;
  size?: "small" | "normal" | "large";
}) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={color ? { background: color } : undefined}
    >
      {initials(name)}
    </span>
  );
}
export function StatusBadge({ status }: { status: TaskStatus }) {
  const Icon = {
    planned: Circle,
    in_progress: Clock3,
    waiting: Pause,
    review: Eye,
    completed: CheckCheck,
  }[status];
  return (
    <span className={`badge status-${status}`}>
      <Icon size={12} />
      {STATUS_LABELS[status]}
    </span>
  );
}
export function PriorityBadge({ value }: { value: number }) {
  return (
    <span
      className={`priority priority-${value <= 2 ? "high" : value <= 5 ? "medium" : "low"}`}
      title={`Öncelik ${value} / 10 · 1 en yüksek`}
    >
      <ArrowUp size={12} />
      {value}
    </span>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Check size={24} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = ref.current;
    const focus = () =>
      el?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && el) {
        const els = [
          ...el.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
          ),
        ];
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      window.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" aria-label="Kapat" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function SubmitButton({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="submit" className="btn btn-primary" disabled={busy}>
      {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{" "}
      {children}
    </button>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}
