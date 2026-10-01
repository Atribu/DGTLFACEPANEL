"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  Eye,
  ShieldCheck,
  Users,
  LoaderCircle,
} from "lucide-react";
import { api } from "@/lib/client";
import { BrandLogo, BrandMark } from "./brand";
export default function Login({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/login", { email, password });
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const accounts = [
    { label: "Yönetici", email: "admin@dgtlface.demo", icon: ShieldCheck },
    { label: "Personel", email: "ayse@dgtlface.demo", icon: Users },
    { label: "Otel gözlemcisi", email: "otel@dgtlface.demo", icon: Eye },
  ];
  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="brand">
          <BrandLogo tone="light" />
          <span>OPERASYON PANELİ</span>
        </div>
        <div className="login-pitch">
          <div className="eyebrow">
            <span className="live-dot" /> BİRLİKTE, DAHA DÜZENLİ
          </div>
          <h1>
            Her otel.
            <br /> Her ekip.
            <br /> <em>Aynı hedef.</em>
          </h1>
          <p>
            İlk kurulumdan günlük operasyonlara.
            <br />
            İşin bütün resmi, tek çalışma alanında.
          </p>
          <div className="login-preview">
            <div className="preview-top">
              <Building2 size={20} />
              <span>Luna Resort</span>
              <span className="preview-tag">Kurulum</span>
            </div>
            <div className="preview-line">
              <span>Web & Rezervasyon</span>
              <span>74%</span>
            </div>
            <div className="preview-progress">
              <i />
            </div>
            <div className="preview-bottom">
              <span>
                <Check size={14} /> Ekipler aynı sayfada
              </span>
              <ArrowUpRight size={19} />
            </div>
          </div>
        </div>
        <div className="login-footer">
          DGTLFACE <span>Birlikte üretiyoruz.</span>
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-form-inner">
          <div className="login-kicker">
            <span className="small-logo">
              <BrandMark />
            </span>{" "}
            ÇALIŞMA ALANINIZ
          </div>
          <h2>Tekrar hoş geldiniz.</h2>
          <p className="login-lead">Kaldığınız yerden birlikte devam edelim.</p>
          <form onSubmit={submit}>
            <label className="field">
              <span className="field-label">E-posta adresi</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="isim@dgtlface.com"
              />
            </label>
            <label className="field">
              <span className="field-label">Şifre</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Şifrenizi girin"
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="btn btn-primary login-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  Giriş yap <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          {demo && (
            <div className="demo-accounts">
              <div className="demo-label">
                <span className="live-dot" /> Yerel demo · Örnek hesaplar
              </div>
              <p>Bir rol seçin, ardından giriş yapın.</p>
              <div className="demo-role-buttons">
                {accounts.map((a) => (
                  <button
                    key={a.email}
                    className={email === a.email ? "selected" : ""}
                    onClick={() => {
                      setEmail(a.email);
                      setPassword("Demo2026!");
                      setError("");
                    }}
                  >
                    <a.icon size={17} />
                    {a.label}
                  </button>
                ))}
              </div>
              <small>
                Örnek verilerle çalışır. Değişiklikler bu bilgisayarda saklanır.
              </small>
            </div>
          )}
          <div className="login-help">
            <ShieldCheck size={15} /> Erişiminiz hesabınıza tanımlı yetkilerle
            sınırlıdır.
          </div>
        </div>
        <div className="login-bottom">
          © {new Date().getFullYear()} DGTLFACE{" "}
          <span>Operasyon çalışma alanı</span>
        </div>
      </section>
    </main>
  );
}
