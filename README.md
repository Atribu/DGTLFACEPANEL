# DGTLFACE Operasyon Paneli

Otellerin kurulum işlerini, ekip sorumluluklarını ve yönetici onayını takip eden ilk çalışan sürüm. Next.js, React ve TypeScript ile geliştirilmiştir. Veriler sunucuda saklanır; rol ve işlem yetkileri API katmanında doğrulanır. Uygulama henüz yayınlanmadı.

## Yerelde çalıştırma

Geliştirmede Node.js 24 ve npm kullanılıyor.

```sh
npm install
npm run dev
```

Tarayıcıda [http://127.0.0.1:3000](http://127.0.0.1:3000) adresini açın. Farklı bir port için `npm run dev -- --port 3001` kullanılabilir.

`DATABASE_URL` verilmezse PGlite, verileri kalıcı olarak `.data/postgres` dizininde tutar. Uygulamayı yeniden başlatmak kayıtları sıfırlamaz. İlk açılışta demo hesaplar ve örnek işler bir kez oluşturulur; yerel oturum anahtarı `.data/session-secret` dosyasında saklanır. `.data` ve `.env.local` Git dışında tutulur.

`npm run dev`, `scripts/dev.cjs` üzerinden başlar. Bu betik, mevcut yerel ortamda Console Ninja'nın Next.js içine eklediği ve PGlite ile çakışan geliştirme kancasını yalnızca uygulamanın geliştirme sürecinde atlar. Editör ayarlarını veya kurulu eklentiyi değiştirmez; build/start akışına uygulanmaz.

## Marka görünümü

Panel, DGTLFACE'in resmî sitesindeki SVG logo ve simgeyi kullanır. Ana renkler koyu mor `#140F25`, mor `#A754CF`, mavi `#547CCF` ve turkuaz `#54B9CF` tonlarıdır. Küçük metinler ve butonlarda kontrast için koyulaştırılmış mor kullanılır; durumların başarı, uyarı ve hata renkleri ayrıca korunur. Logo dosyaları yereldir; panel açılırken DGTLFACE sitesinden tekrar yüklenmez. Kaynaklar ve açık zemin için yapılan logo renk uyarlaması [docs/marka-kaynaklari.json](docs/marka-kaynaklari.json) dosyasındadır.

## Demo hesaplar

Aşağıdaki hesapların ortak şifresi: **`Demo2026!`**

| Hesap | Rol / ekip |
| --- | --- |
| `admin@dgtlface.demo` | Yönetici — Mert Yılmaz |
| `ayse@dgtlface.demo` | Personel — Proje Yöneticisi |
| `emre@dgtlface.demo` | Personel — Web & IT |
| `deniz@dgtlface.demo` | Personel — Performans Pazarlama |
| `selin@dgtlface.demo` | Personel — Kreatif Ekip |
| `otel@dgtlface.demo` | Otel gözlemcisi — yalnızca Luna Resort & Spa |

İlk demo verisi 4 otel, 6 kullanıcı ve **135 görev** içerir: Luna 93, Mira 16, Nova 14, Oliva 12. Tarihler, sorumlular ve iş durumları örnek çalışma akışını göstermek için oluşturulur.

## İş akışı ve roller

| İşlem | Yönetici | Personel | Otel gözlemcisi |
| --- | --- | --- | --- |
| Otel ve görevleri görme | Tümü | Tümü | Yalnızca bağlı oteller |
| Otel/görev oluşturma; görev bilgilerini, sorumluyu ve önceliği düzenleme | Var | Yok | Yok |
| Durum/kriter güncelleme; yorum yazma; kontrole gönderme | Tüm görevler | Yalnızca kendisine atanmış görevler | Yok |
| Kontrolü onaylama, gerekçeyle geri gönderme, işi yeniden açma | Var | Yok | Yok |

Görev durumları **Planlandı → Devam ediyor / Bekliyor → Kontrol bekliyor → Tamamlandı** şeklinde ilerler. Beklemeye alınan iş için neden yazılır. Tamamlanma kriterleri işaretlendikten sonra görev kontrole gönderilir; işi yalnızca yönetici onayı tamamlar. Kontroldeki ve tamamlanmış işlerin durum/kriter değişiklikleri kilitlidir; yönetici işi geri gönderebilir veya yeniden açabilir. Yorumlar ayrıca kaydedilir.

Öncelikler **1–10** arasındadır: **1 en yüksek**, 10 en düşük. Görevler tamamlanmamış işler önce gelecek şekilde, ardından öncelik ve hedef tarihe göre sıralanır. Gecikme hesabı Türkiye saat dilimine göre yapılır.

## Kaynak görev listesi

Kaynak, [DGTLFACE Yeni Otel Entegrasyon Sureci](https://docs.google.com/spreadsheets/d/1A0hUfjNLQAJCJAEJisz5m2m-GxnskE0vBHUSIg2kb8U/edit) dosyasından alınan [docs/gorev-referansi.json](docs/gorev-referansi.json) kaydıdır. Uygulama Google Sheets ile canlı senkronizasyon yapmaz.

Yeni otel formundaki **“93 görevlik kurulum listesini ekle”** seçeneği varsayılan olarak açıktır. Ana Checklist'teki 93 görevin tamamı; görev kodu, aşama, departman sorumluluğu, otelden beklenen girdi ve tamamlanma kriteriyle oluşturulur. Hizmet seçimi bu listeyi azaltmaz. Seçenek kapatılırsa boş bir otel çalışma alanı oluşturulur.

Her otelin görev ve kriter kayıtları bağımsız kimlikler alır. Kaynaktaki tekrar eden görünen görev kodları korunur. Kaynak öncelikleri `Kritik → 1`, `Yüksek → 3`, diğerleri `5` olarak başlatılır. Proje Yöneticisi görevleri otelin seçilen sorumlusuna atanır; kalan görevlerin kişi atamalarını yönetici yapar. Yeni şablon görevlerinde hedef tarihler boş başlar.

## Mevcut kapsam

- Role göre genel bakış, görev sayıları, geciken işler ve kontrol bekleyen işler.
- Otel listesi, arama, kurulum/operasyon filtreleri, ilerleme ve aşama bazlı görev takibi.
- Otel oluşturma, otel bilgileri ve hareket geçmişi.
- Görev listesi ve durum sütunlarıyla pano; otel, ekip, durum, kişisel işler, bugün ve gecikenler filtreleri.
- Görev oluşturma/düzenleme, kişi atama, öncelik ve hedef tarih belirleme.
- Tamamlanma kriterleri, bekleme nedeni, yorumlar ve yönetici onay akışı.
- Göreve dosya veya bağlantı ekleme, yetkili indirme ve ek kaldırma; kontrol/tamamlanma aşamasında teslimleri koruyan kilit.
- Aylık teslim takvimi, seçili günün işleri, otel/kişi/durum filtreleri ve tarihsiz görevler.
- Kişisel okunmuş/okunmamış bildirimler, görev atama ve teslim hatırlatmaları.
- Yöneticiye özel haftalık/aylık düzenli işler ve otomatik görev oluşturma.
- Dönem ve otel filtreli güncel durum raporu, Excel için CSV ve tarayıcıdan yazdırma/PDF kaydı.
- Ekip iş yükü görünümü ve mevcut rol kurallarını gösteren yetkiler sayfası.
- Yöneticiye özel kullanıcı oluşturma/düzenleme, rol ve gözlemci otel erişimi yönetimi, hesap pasifleştirme.
- Otel koordinasyon sorumlusunu değiştirme; görev sorumlularını görev düzenleyicisinden devretme.
- Kalıcı veritabanı, e-posta/şifre girişi ve 8 saatlik sunucu doğrulamalı oturum.

E-posta ile kullanıcı daveti, şifre sıfırlama, e-posta/mesaj bildirimleri ve Google Sheets/PMS/OTA entegrasyonları sonraki kapsam için ayrılmıştır. Ekip ekranı güncel iş yükünü, Yetkiler ekranı rol kurallarını gösterir. Hesaplar yöneticiye özel Kullanıcılar ekranından yönetilir. Üst çubuktaki hareket listesi uygulama içi kayıtları gösterir.

## Dosyalar ve bağlantılar

Görev detayındaki **Dosyalar ve bağlantılar** alanında yönetici veya görevin sorumlusu teslim ekleyebilir. Görevi görmeye yetkili kullanıcılar ekleri de görür; otel gözlemcilerinin otel kapsamı indirme isteklerinde de doğrulanır. Dosyalar herkese açık bir dizine yazılmaz; içerikleri ve bilgileri aynı veritabanında tutulur.

Her dosya en fazla 10 MiB olabilir; görev başına dosya ve bağlantıların toplamı en fazla 20 aktif ektir. Desteklenen dosyalar PDF, PNG, JPEG, WebP, TXT, CSV, DOCX, XLSX, PPTX ve ZIP'tir. Bağlantılar yalnızca HTTP/HTTPS adresleri olabilir; panel bağlantıdaki içeriği kendi sunucusunda indirmez veya önizlemez.

Yönetici açık görevlerde tüm ekleri, personel ise kendisine atanmış açık görevlerde kendi eklerini kaldırabilir. Kaldırma kaydı ve dosya verisi veritabanında korunur; kaldırılan ekler listelenmez ve indirilemez. Arayüzde geri yükleme seçeneği henüz yoktur. Kontrol bekleyen veya tamamlanmış görevlerin ekleri değiştirilemez; yönetici önce işi revizyona göndermeli veya yeniden açmalıdır. Ekleme/kaldırma işlemleri görev geçmişine yazılır. Üretimde veritabanı yedekleri ekleri de kapsamalıdır.

## Teslim takvimi

**Takvim** ekranı mevcut görevlerin hedef tarihlerini ay görünümünde gösterir. Bir gün seçildiğinde o günün işleri öncelik sırasıyla açılır; göreve tıklamak detayına götürür. Otel, sorumlu ve durum filtreleri uygulanabilir. Henüz hedef tarihi olmayan işler ayrı listelenir. Gözlemciler yalnızca bağlı otellerinin görevlerini görür. Tarih değişikliği yönetici tarafından görev düzenleme formundan yapılır; takvimde sürükleyerek tarih değiştirme yoktur.

## Bildirimler, düzenli işler ve raporlar

**Bildirimler** kişiye özeldir. Atama, öncelik/hedef tarih değişikliği ve revizyon sorumluya; kontrole gönderme yöneticilere; bekleme ve tamamlanma ilgili otelin gözlemcilerine de bildirilir. İşlemi yapan kişiye kendi işlemi için bildirim gönderilmez. Bugün teslim edilecek ve geciken açık işler sorumluya ve yöneticilere birer kez hatırlatılır; aynı kontrol tekrar çalışınca aynı bildirim çoğalmaz. Herkes yalnızca kendi bildirimlerini okur/okundu işaretler. Gözlemcinin güncel otel erişimi ayrıca uygulanır. Liste en fazla 100 kayıt gösterir; okunmamış sayısı ve “tümünü okundu işaretle” daha eski kayıtları da kapsar. Zil 60 saniyede bir ve pencereye dönüldüğünde yenilenir. Bu sürüm uygulama içi bildirim kullanır.

**Düzenli İşler** yalnızca yöneticide görünür. Otel, sorumlu, görev metni, öncelik, tamamlanma kriterleri, başlangıç günü ve haftalık/aylık sıklık seçilir. Hedef tarih her dönem başlangıcından 0–30 gün sonra olabilir. Aylık işler başlangıç gününe bağlıdır: 31 Ocak → Şubat ayının son günü → 31 Mart. Aynı kural/dönem için yalnızca bir görev oluşur. Her görev bağımsız kriter ve onay geçmişiyle normal iş akışına katılır. Plan düzenlemeleri gelecekteki görevlere uygulanır; oluşmuş işler korunur. Durdurma kayıtları silmez; devam ettirme duraklama sırasında kaçırılan dönemleri atlar. Sunucunun kapalı kaldığı dönemler her kontrolde kural başına en fazla 12 görevle tamamlanır; sonraki kontroller kalanları işler. Sorumlu pasif veya gözlemci olursa plan gerekçesiyle bekler; yönetici aktif bir sorumlu seçmelidir.

**Otel Raporları**, hedef tarihi seçilen döneme düşen görevlerin **şu anki durumunu** gösterir; geçmişte o tarihteki durum veya o dönemde tamamlanan iş sayısı değildir. Dönem en fazla 366 gündür. Tarihsiz işler ayrı sayılır; istenirse ayrı listeyle dahil edilir, dönem toplamına karıştırılmaz. Yönetici ve personel tüm otellerden, gözlemci yalnızca bağlı otellerinden rapor alır. **Excel için CSV** Türkçe karakterler, noktalı virgül ayırıcı ve formül metinlerini etkisizleştirme ile dışa aktarır. **Yazdır / PDF** tarayıcının yazdırma penceresini açar; PDF olarak kaydetme buradan yapılır.

### Zamanlanmış işlerin çalışması

`npm run dev`, yerel sunucuyla birlikte `scripts/worker.ts` işlemini de başlatır ve kapanırken durdurur. Worker her dakika sunucudaki yetkili bakım API'sini çağırır; veritabanını ikinci bir süreçten açmaz. Yerelde anahtar `.data/jobs-secret` dosyasında saklanır. Panel açıldığında da kaçırılmış işler kontrol edilir. Tarayıcının açık olması gerekmez; sunucu ve worker çalışır durumda olmalıdır.

Üretimde web sunucusunun yanında ayrı ve yeniden başlatılabilir bir servis olarak çalıştırın:

```sh
NODE_ENV=production npm run worker
# Tek seferlik kontrol:
NODE_ENV=production npm run worker -- --once
```

Worker ile web sunucusu aynı `JOBS_SECRET` değerini kullanır. Bu anahtar oturum anahtarından ayrı ve en az 32 rastgele karakter olmalıdır. Aynı sunucu için `MAINTENANCE_ORIGIN=http://127.0.0.1:3000` kullanılır; uzak bağlantı HTTPS gerektirir. API geçerli Bearer anahtarı olmadan çalışmaz. Worker üretimde ayrıca devreye alınmalıdır; yalnız `npm run start` onu başlatmaz.

## Kullanıcı ve otel erişimi yönetimi

Yönetici, **Kullanıcılar → Kullanıcı ekle** formundan ad, e-posta, ilk giriş şifresi, ekip ve rol belirler. İlk şifre en az 12 karakter olmalıdır. Otel gözlemcisi için erişebileceği en az bir otel seçilir; yönetici ve personel tüm otelleri görebilir. E-posta daveti gönderilmez.

Kullanıcının adını, e-postasını, ekibini, rolünü ve otel erişimlerini düzenleyebilirsiniz. Pasif hesaplar giriş yapamaz ve yeni görev atamalarında görünmez. Mevcut görev ve yorum geçmişleri korunur. Pasifleştirmeden veya gözlemci rolüne geçirmeden önce açık görevleri başka bir aktif kişiye devredin; otel koordinasyon sorumluluğu varsa otel detayındaki **Sorumluyu değiştir** seçeneğini kullanın. Görev devri ayrıca yapılır.

Kendi yönetici hesabınızı pasifleştiremez veya kendi yönetici rolünüzü kaldıramazsınız. Hesap durumu, rolü veya otel erişimi değişen kullanıcının yeniden giriş yapması gerekir. Pasifleştirildikten sonra tekrar açılan hesapların eski oturumları yeniden geçerli olmaz.

## PostgreSQL ve üretim ayarları

`DATABASE_URL` tanımlandığında uygulama PGlite yerine PostgreSQL kullanır. Veritabanı tabloları ilk bağlantıda oluşturulur. PGlite verileri PostgreSQL'e otomatik taşınmaz.

[.env.example](.env.example) dosyasını `.env.local` olarak kopyalayın ve ortama göre doldurun:

| Değişken | Kullanım |
| --- | --- |
| `DATABASE_URL` | PostgreSQL bağlantı adresi; üretimde zorunlu. |
| `SESSION_SECRET` | En az 32 karakterlik rastgele oturum anahtarı; üretimde zorunlu. |
| `JOBS_SECRET` | Zamanlanmış iş API’si için ayrı, en az 32 karakterlik rastgele anahtar. |
| `MAINTENANCE_ORIGIN` | Worker’ın web sunucusuna erişeceği köken; varsayılan yerel adres önerilir. |
| `APP_ORIGIN` | Ters vekil kullanıldığında tarayıcıdaki gerçek köken, örneğin `https://panel.example.com`. |
| `ENABLE_DEMO` | Üretimde `false` olmalı. Geliştirmede PostgreSQL üzerinde demo oluşturmak için `true` seçilebilir. |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | İlk yönetici hesabını oluşturma betiğinin girdileri; şifre en az 12 karakter olmalı. |

Yerel geliştirmede `DATABASE_URL` boşsa `ENABLE_DEMO=false` olsa da demo açıktır. Üretim ayrı, demo kaydı bulunmayan bir PostgreSQL veritabanıyla çalışır: `NODE_ENV=production` altında demo açılması ve daha önce demo verileri eklenmiş veritabanının kullanılması reddedilir.

Örnek oturum anahtarı üretimi:

```sh
node -e 'console.log(require("node:crypto").randomBytes(48).toString("base64url"))'
```

`.env.local` içindeki üretim bağlantısını ve `ADMIN_*` alanlarını doldurduktan sonra ilk yönetici hesabını oluşturun:

```sh
NODE_ENV=production node --env-file=.env.local --import tsx scripts/create-admin.ts
```

Betik `.env.local` dosyasını bu komuttaki `--env-file` sayesinde okur; aynı e-posta zaten kayıtlıysa değişiklik yapmadan durur. Şifreyi çıktıya yazmaz.

```sh
npm run build
npm run start
```

Üretim sunucusu `127.0.0.1:3000` üzerinde dinler; HTTPS sağlayan bir ters vekilin arkasında çalıştırılmalıdır. Üretim oturum çerezi HTTPS gerektirir. `/api/health` uygulamanın veritabanı bağlantısını, depolama türünü ve demo durumunu döndürür.

## Kontroller

```sh
npm run typecheck
npm test
npm run test:integration
npm run build
```

Testler rol sınırlarını, otel kapsamını, sunucu tarafındaki yetkisiz işlem reddini, onay akışını, veri doğrulamasını ve 93 görevlik şablonun korunmasını kapsar. Kullanıcı yönetimi testleri ayrı bir bellek içi PGlite veritabanında hesap oluşturmayı, parola verilerinin yanıtlarda bulunmamasını, pasif hesapları, eski oturumların iptalini, eşzamanlı yönetici değişikliklerini ve iş devrini doğrular. Mevcut repository testleri bellek içi bir sorgu adaptörü kullanır. Testler uygulamanın kalıcı veritabanını açmaz.

`npm run test:integration`, geçici bir kaynak kopyasında ayrı Next.js sunucusu ve PGlite veritabanı başlatır. Gerçek oturum çerezleriyle yönetici/personel/gözlemci isteklerini; görev atama, öncelik sınırları, kriterler, bekleme gerekçesi, kontrol, revizyon, onay, yeniden açma ve 93 görev şablonunu doğrular. Dosya/bağlantı ekleme, yetkili indirme, aynı içerikle geri okuma, kaldırma, boyut/tür sınırları ve onay sonrası kilit de bu akışa dahildir. Test kendi veritabanını ve sunucusunu temizler; yerel `.data` kayıtlarını değiştirmez.

Ek testleri gerçek bellek içi PGlite üzerinde 10 MiB sınırını, eşzamanlı 20 ek sınırını, yükleme sırasında yeniden yetki kontrolünü ve kaydı koruyan kaldırmayı doğrular. Takvim testleri Pazartesi başlangıcını, artık yılları, yıl geçişlerini, tarih sıralamasını ve filtrelerin mevcut otel kapsamını korumasını kapsar.

Yeni özellik testleri kişisel bildirim sahipliğini ve otel kapsamını, yinelenen hatırlatmaların önlenmesini, haftalık/aylık tarih hesaplarını, eşzamanlı görev üretiminde tekillik ve işlem bütünlüğünü, rapor dönemi/yetkileri ve CSV güvenliğini kapsar.

## Gerçek ekip pilotu öncesi

Uygulama şu anda yerelde çalışır; canlı yayın ve otomatik üretim yedeği henüz kurulmadı. Gerçek ekip pilotu için sunucu/alan adı, HTTPS, ayrı PostgreSQL veritabanı, web ve worker servisleri ile otomatik veritabanı yedeği ve geri yükleme denemesi hazırlanmalıdır. Örnek hesaplar ve demo verileri üretime taşınmamalıdır.
