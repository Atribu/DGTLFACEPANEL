export type TaskPreset = {
  id: string;
  title: string;
  cadence?: "Günlük" | "Haftalık" | "Aylık" | "Aylık, Ay sonunda";
};

export type TaskPresetStage = {
  name: string;
  tasks: TaskPreset[];
};

const task = (
  id: string,
  title: string,
  cadence?: TaskPreset["cadence"],
): TaskPreset => ({ id, title, ...(cadence ? { cadence } : {}) });

export const INITIAL_SETUP_TASK_STAGES: TaskPresetStage[] = [
  {
    name: "Kuruluş Evrakları",
    tasks: [
      task("documents-tax-certificate", "Vergi levhası"),
      task("documents-tourism-certificate", "Turizm İşletme Belgesi"),
      task("documents-activity-certificate", "Faaliyet Belgesi"),
      task("documents-signature-circular", "İmza Sirküleri"),
      task("documents-trade-registry", "Ticari Sicil Gazetesi"),
      task(
        "documents-authorized-contact",
        "Şirket Yetkili ve iletişim bilgileri",
      ),
    ],
  },
  {
    name: "Finans",
    tasks: [
      task("finance-iban", "Iban bilgisi"),
      task("finance-virtual-pos", "Sanal Pos Bilgisi"),
      task(
        "finance-ad-cards",
        "Reklam Kredi Kartı 2 adet ( sanal kart kurumsal)",
      ),
      task("finance-invoice", "Fatura Bilgisi"),
      task("finance-authorized-person", "Yetkili Kişi Bilgileri"),
    ],
  },
  {
    name: "Operasyonel Kurulum",
    tasks: [
      task("operations-elektra", "Elektra Genel Kurulum"),
      task("operations-asisia", "Asisia Kurulum"),
      task("operations-connexease", "Connexease Genel Kurulum"),
      task("operations-hotel-analysis", "Otel Veri Analizi ve Raporlama"),
      task(
        "operations-contract-entry",
        "OTA ve Call Center için Kontrat Girdisi",
      ),
      task("operations-benchmark", "Benchmark"),
    ],
  },
  {
    name: "Call Center İşlemleri",
    tasks: [
      task("call-center-nac-email", "Nac Geçiş Maili"),
      task("call-center-whatsapp-sim", "Satış Whatsapp Simcard Talebi"),
      task("call-center-fact-sheet", "Fact Sheet"),
      task("call-center-contract", "Kontrat Talebi"),
      task(
        "call-center-sales-rules",
        "Satış Kuralları( ref/nonref ,min geceleme, ön ödeme",
      ),
      task(
        "call-center-asisia-agents",
        "Asisa Proje Kurulumunu Yap ve Agentları Yetkilendir",
      ),
      task(
        "call-center-government-contract",
        "E devlet Sozlesme Onayını Takıp et",
      ),
      task("call-center-ivr", "Sesli Yanıt Sistemleri kurulumu"),
      task(
        "call-center-offer-form",
        "Teklif Formu oluşturulması için Asisia İle İletişime Gir",
      ),
      task(
        "call-center-connexease",
        "Connexease Sosyal Medya ve Whatsapp Bağlantısını Etkinleştir ve Test et",
      ),
    ],
  },
  {
    name: "Ota Entegrasyonu",
    tasks: [
      task(
        "ota-access",
        "Aktif platform şifreleri giriş erişim bilgileri talebi",
      ),
      task(
        "ota-platform-setup",
        "Mevcut Olmayan Uygun platform Tespiti ve Kurulum Talebi Oluşturulması",
      ),
      task(
        "ota-elektra-integration",
        "Otalar ve Elektra Arası Entegrasyon Kontrolu",
      ),
      task(
        "ota-property-rules",
        "Ota İçi Tesis Kuralların ve Krezervasyon Kuralları Doğruluğu Kontrolu",
      ),
      task(
        "ota-images",
        "Ota içi gorsellerin kontrolu ve Fotografların Güncellenmesi",
      ),
      task("ota-amenities", "Tesis Olanakları Kontrolü Ve güncellenmesi"),
      task(
        "ota-room-details",
        "Otalardaki Oda Bilgileri ve Olanakları Kontrolünün Sağlanması",
      ),
      task("ota-payment-methods", "Otaların Ödeme Alma yöntemlerinin Kontrolü"),
      task("ota-review-template", "Otalar Yorum için Şablon Oluşturulması"),
    ],
  },
  {
    name: "Creative",
    tasks: [
      task("creative-meta-access", "Meta Business Erişim bilgisi"),
      task("creative-existing-assets", "Mevcut Görsel Erişimi"),
      task("creative-content-production", "Otel Görsel İçerik Üretimi"),
      task(
        "creative-storage",
        "Çekilen İçeriklerin Depolanması ve Yedeklenmesi",
      ),
      task(
        "creative-shoot-planning",
        "Otel Çekim Planlaması ve Odanın Çekime Hazırlığı",
      ),
      task(
        "creative-room-photos",
        "Her Oda Tipinin Balkon, Oda, Banyo Fotoğraf Çekimi",
      ),
      task(
        "creative-room-video",
        "Her Oda Tipinin Balkon, Oda, Banyo Video Çekimi",
      ),
      task(
        "creative-room-360",
        "Her Oda Tipinin Balkon, Oda, Banyo 360 Çekimi",
      ),
      task(
        "creative-property-photos",
        "Otel Lobi, Resepsiyon, Restorantları, Barları, Havuzları ve Kullanılan Bütün alanların Fotoğraf Çekimi",
      ),
      task(
        "creative-property-video",
        "Otel Lobi, Resepsiyon, Restorantları, Barları, Havuzları ve Kullanılan Bütün alanların Video Çekimi",
      ),
      task(
        "creative-property-360",
        "Otel Lobi, Resepsiyon, Restorantları, Barları, Havuzları ve Kullanılan Bütün alanların 360 Çekimi",
      ),
      task(
        "creative-food-beverage",
        "Otel Restorant Yiyecek ve İçecek Çekimi",
      ),
      task("creative-building", "Otel Genel Bina Fotoğraf Çekimi"),
      task("creative-drone", "Otel Genel Drone Çekimi"),
      task("creative-location-drone", "Otel Konum Drone Çekimi"),
      task("creative-action", "Otel Aksiyon Çekimleri"),
      task("creative-processing", "Çekilen İçeriklerin İşlenmesi"),
      task(
        "creative-platform-formats",
        "İşlenmiş İçeriklerin Platformlara Uygun Hale Getirilmesi",
      ),
      task(
        "creative-feed-plan",
        "İşlenmiş İçeriklerin Kullanılarak Aylık Feed Plan Oluşturulması ve Paylaşımların Planlanması",
      ),
    ],
  },
  {
    name: "Yazılım",
    tasks: [
      task("software-domain-access", "Domain Erişim"),
      task("software-website-update", "Websitesi Güncellenmesi"),
      task("software-design", "Web Sitesi Uygun Tasarım Oluşturulması"),
      task(
        "software-development",
        "Tasarımın Koda Dökülmesi ve Optimize Edilmesi",
      ),
      task(
        "software-translations",
        "Websitesi İçeriklerin 4 dil uyumlu şekilde çevirmesi",
      ),
      task(
        "software-live-chat",
        "Live Chat Widget Entegrasyonunun sağlanması",
      ),
      task(
        "software-privacy",
        "Gizlilik, KVKK ve Çerez metinlerinin otelden Talep edilmesi",
      ),
      task(
        "software-booking-widget",
        "Rezervasyon Widget Oluşturulması ve kontrol edilmesi",
      ),
      task(
        "software-sustainability",
        "Sürdürülebilirlik Politikaları Hakkında Otelden Bilgi talep edilip Siteye Yüklenmesi",
      ),
      task("software-seo", "Seo Alt yapısının oluşturulması"),
    ],
  },
  {
    name: "Seo+Sem",
    tasks: [
      task("seo-google-business", "Google My business Erişimi"),
      task("seo-ga4-gtm", "GA4 ve GTM erişimi"),
      task("seo-search-console", "Search Console"),
      task("seo-competitor-analysis", "Rakip Otel Analizi ve Raporlama"),
      task("seo-keywords", "Anahtar Kelime Analizi"),
      task(
        "seo-meta",
        "Meta Başlık ve Açıklama Optimizasyonu",
      ),
      task("seo-headings", "Başlık Etiketleri Düzenlenmesi"),
      task("seo-internal-links", "Site İçi Linkleme"),
      task("seo-backlinks", "Backlink Oluşturma"),
      task("seo-off-site", "Dış SEO Stratejisi"),
      task("seo-blog", "Aylık SEO Uyumlu Blog Sayfa Üretimi"),
    ],
  },
  {
    name: "Günlük, Haftalık, Aylık",
    tasks: [
      task("recurring-daily-completion", "Günlük İş Tamamlama"),
      task("recurring-weekly-completion", "Haftalık İş Tamamlama"),
      task("recurring-monthly-completion", "Aylık İş Tamamlama"),
      task(
        "recurring-feed-plan",
        "Feed Plan Oluşturulması",
        "Aylık, Ay sonunda",
      ),
      task(
        "recurring-ota-call-center",
        "OTA & Çağrı Merkezi Müsaitlik / Eşleşme Kontrolü",
        "Günlük",
      ),
      task("recurring-seo-cycle", "SEO Çalışma Döngüsü", "Haftalık"),
      task(
        "recurring-creative-cycle",
        "Creative / İçerik Çekim Döngüsü",
        "Aylık",
      ),
      task("recurring-sales-report", "Satış Raporlama", "Günlük"),
      task("recurring-card-movements", "Kredi Kartı Hareketleri", "Günlük"),
      task("recurring-concert-sales", "Konser Satış Kontrol", "Günlük"),
      task(
        "recurring-sem-optimization",
        "SEM / Dijital Reklam Optimizasyonu",
        "Haftalık",
      ),
      task(
        "recurring-contract-tracking",
        "Kontrat Takibi ve Kontrolü",
        "Günlük",
      ),
      task(
        "recurring-benchmark",
        "Benchmark & Rakip Analizi",
        "Haftalık",
      ),
      task(
        "recurring-system-health",
        "Sistem & Entegrasyon Sağlık Kontrolü",
        "Günlük",
      ),
      task(
        "recurring-website-access",
        "↳ Web sitesi erişim kontrolü",
        "Günlük",
      ),
      task(
        "recurring-booking-widget",
        "↳ Rezervasyon widget kontrolü",
        "Günlük",
      ),
      task(
        "recurring-call-center-test",
        "↳ Call Center çağrı testi",
        "Günlük",
      ),
      task(
        "recurring-connexease",
        "↳ Connexease bağlantı kontrolü",
        "Günlük",
      ),
      task("recurring-current-account", "Cari Mutabakat", "Aylık"),
      task("recurring-bonus", "Prim Hesaplama", "Aylık"),
      task(
        "recurring-ad-invoices",
        "ADS / Reklam Faturalarının Kontrolü",
        "Aylık",
      ),
      task(
        "recurring-seo-report",
        "SEO Güncel Durum & Performans Raporu",
        "Aylık",
      ),
    ],
  },
];

export const INITIAL_SETUP_TASKS = INITIAL_SETUP_TASK_STAGES.flatMap((stage) =>
  stage.tasks.map((preset) => ({ ...preset, stage: stage.name })),
);

export const INITIAL_SETUP_TASK_BY_ID = new Map(
  INITIAL_SETUP_TASKS.map((preset) => [preset.id, preset]),
);

const INITIAL_SETUP_STAGE_ORDER = new Map(
  INITIAL_SETUP_TASK_STAGES.map((stage, index) => [stage.name, index]),
);

export function compareTaskStages(left: string, right: string) {
  const leftOrder = INITIAL_SETUP_STAGE_ORDER.get(left);
  const rightOrder = INITIAL_SETUP_STAGE_ORDER.get(right);
  if (leftOrder !== undefined && rightOrder !== undefined) {
    return leftOrder - rightOrder;
  }
  if (leftOrder !== undefined) return -1;
  if (rightOrder !== undefined) return 1;
  return left.localeCompare(right, "tr", { numeric: true });
}
