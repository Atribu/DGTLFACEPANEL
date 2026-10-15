# DGTLFACE İşler — iPhone

**1.3.0 (4)** sürümü, [DGTLFACE web paneline](https://panel.dgtlface.com) aynı hesapla bağlanan ekip uygulamasıdır. Oteller, görevler, kriter tikleri ve ekip yorumları sunucudaki ortak veritabanından alınır. Eski kişisel kayıtlar ayrıca cihaz arşivinde korunur. Minimum iOS sürümü 17'dir; SwiftUI ve sistem kütüphaneleri kullanılır, harici Swift paketi gerekmez.

## Kullanım ve yetkiler

Webde kullandığın e-posta ve şifreyle giriş yap. Ayrı mobil hesap veya yeni ortam değişkeni gerekmez. Oturum en fazla 8 saattir; süresi dolduğunda veya hesap yetkileri değiştiğinde yeniden giriş gerekir.

- Yönetici tüm otel ve görevleri görür; kriterleri ve durumu değiştirebilir, yorum ekleyebilir, kontrolü onaylayabilir, işi geri gönderebilir veya yeniden açabilir.
- Personel tüm otelleri görür; yalnızca kendisine atanmış görevlerde kriter/durum değiştirir, yorum ekler ve kontrole gönderir.
- Otel gözlemcisi yalnızca bağlı otellerini ve bunların görev/yorumlarını görüntüler; değişiklik yapamaz.

Alt menü **Genel bakış, Oteller, Görevler, Takvim ve Diğer** bölümlerinden oluşur. Otellerde işlem grupları ve görevler korunur; tüm görevlerde otel, durum, sorumlu, departman, grup ve öncelik filtresi vardır. Görevler varsayılan olarak öncelik puanıyla sıralanır: **1 en önce, 10 en sonra**. Takvim seçili gün, ay ve tarihsiz işleri gösterir. Tarih karşılaştırmaları İstanbul saat dilimindedir; Türkçe İ/i araması desteklenir.

Yönetici mobilde yeni görev oluşturabilir; başlık, açıklama, departman, işlem grubu, sorumlu, 1–10 öncelik, teslim tarihi ve otelden gerekli bilgiyi düzenleyebilir. Sorumlu ve tarih kaldırılabilir. Kriter metinleri webde olduğu gibi yalnız görev oluştururken belirlenir; mevcut kriterler işaretlenir. Yeni otel (isteğe bağlı başlangıç şablonuyla), otel sorumlusu değiştirme, kullanıcı oluşturma/düzenleme, rol/otel kapsamı ve aktiflik yönetimi **Diğer** bölümündedir. İlk kullanıcı parolası oluşturma formunda girilir; parola sıfırlama ve otel/görev silme mevcut web panelinin de sunduğu işlemler değildir.

**Diğer** bölümünde ekip iş yükü, bildirimler (tek tek/tümü okundu), otel ve dönem filtreli raporlar (CSV/PDF, yazdırma), son hareketler, yetki açıklamaları ve yönetici için haftalık/aylık düzenli işler bulunur. Düzenli iş oluşturma, sonraki işlerin bilgilerini düzenleme, duraklatma ve sürdürme webdeki kuralları kullanır; sunucudaki mevcut bakım/worker düzeni geçerlidir.

Görev ayrıntısından **Dosyalar ve bağlantılar** ve **Görev geçmişi** açılır. Desteklenen dosyalar PDF, PNG, JPG, WEBP, TXT, CSV, DOCX, XLSX, PPTX, ZIP; dosya başına 10 MB, görev başına en fazla 20 ektir. Yetkili kullanıcı dosya veya HTTP(S) bağlantısı ekleyebilir; dosyayı sistem dosya seçicisiyle indirebilir. Açık görevlerde yönetici tüm ekleri, personel yalnız kendi eklerini kaldırabilir. Kaldırma onay ister. Dosyalar oturumla indirilir; oturum bilgisi dış bağlantılara gönderilmez.

**Tik koymak bir tamamlanma kriterini işaretler.** Tüm kriterler hazır olunca iş yönetici kontrolüne gönderilir; ancak yönetici onayıyla “Tamamlandı” olur. Kontrol veya tamamlandı aşamasındaki kriterler kilitlidir. Yönetici işi geri gönderebilir veya yeniden açabilir.

**Yorum / açıklama ekle** alanı ortak ekip yorumuna yeni bir kayıt ekler. Bu notlar webde de görünür ve görevi görmeye yetkili otel gözlemcileri tarafından okunabilir. Mevcut yorum üzerine yazılmaz. Aynı gönderimin bağlantı sorunu nedeniyle tekrar denenmesi aynı yorum kaydını döndürür; yeni kopya oluşturmaz. Başka biri görevi değiştirmişse eski sürüme dayanan tik/durum işlemi uygulanmaz; güncel bilgi alınıp tekrar denenir.

## Eşitleme ve çevrimdışı kullanım

Uygulama açıldığında, ön plana döndüğünde ve elle yenilendiğinde güncel veriler alınır. Ekran açıkken normalde **30 saniyede**, Düşük Güç Modu'nda **90 saniyede** kontrol yapılır. Bağlantı hatalarında deneme aralığı **300 saniyeye kadar** uzar. Web paneli görünürken **30 saniyede** kontrol edilir; her iki tarafta elle yenileme de vardır. Bu nedenle diğer cihazdaki değişiklikler bir sonraki başarılı kontrolde görünür; anlık push bildirimi kullanılmaz.

Değişiklik yoksa ETag/304 yanıtı tüm görev listesinin yeniden indirilmesini önler. iPhone arka plana geçince düzenli kontrol durur; arka plan servisi, push bildirimi, konum takibi veya ekranı açık tutma yoktur.

İnternet kesilirse **son indirilen liste salt okunur** gösterilir. Sunucuya yeniden bağlanıp oturum doğrulanana kadar kriter/durum değişikliği veya yorum gönderilemez. Çevrimdışı değişiklik kuyruğu yoktur. Yönetim, rapor, bildirim, ek ve hareket listeleri kalıcı önbelleğe yazılmaz; oturum içinde daha önce alınmış liste varsa salt okunur gösterilir. Bu ekranlar yalnız görünürken mevcut ön plan yenilemesine katılır; ayrı zamanlayıcı başlatmaz. Açık yorum taslağı bir gönderim hatasında ekranda tutulur; gönderildiği doğrulanmadan başarı gösterilmez. Başarılı sunucu kaydı ortak veritabanında saklanır.

## Oturum ve kayıtların saklanması

Parola kalıcı olarak saklanmaz. Oturum çerezi, yalnız bu cihazda kullanılabilen ve cihaz kilidi açıkken erişilen Keychain kaydında tutulur. İstekler sabit HTTPS panel adresine gider; oturum çerezi başka sunucuya yönlendirilmez. Webdeki rol ve otel kapsamı her API isteğinde sunucuda doğrulanır.

Ekip önbelleği `Application Support/DGTLFACETeam/team-cache-v1.json` dosyasındadır. Kullanıcı kimliğine bağlıdır, iOS dosya korumasıyla yazılır ve yedekten hariç tutulur. 1.3 sürümünde önbellek şeması 2'dir; eski şema 1 önbelleği okunabilir, fakat otelin yeni yönetim alanlarını tam almak için eski ETag kullanılmadan ilk bağlantıda liste yeniden indirilir. Çıkışta, oturum sona erdiğinde veya sunucu `401` döndürdüğünde ekip görünümü ve önbelleği temizlenir. Başka hesapla giriş yapıldığında önceki hesabın listesi kullanılmaz. Önbellek sunucudaki kayıtların yerine geçmez.

Önceki sürümlerin `Application Support/DGTLFACEChecklist/progress-v1.json` ve `progress-v2.json` kayıtları **Eski cihaz kayıtları** ekranında salt okunur arşiv olarak açılır. Eski tikler ve kişisel notlar otomatik olarak ortak görevlere aktarılmaz. Kaynak satırları ve görünen görev kodları aynı olsa da eski kişisel işaretler ortak yönetici onay sürecinin yerine geçirilmez. v1 kayıtlarının v2 biçimine taşınmasında kaynak v1 dosyası korunur; otelle eşleştirilmemiş tikler **Mevcut işlerim** listesinde kalır.

**Uygulamayı telefondan silmek cihaz arşivini de silebilir.** Güncellemeyi ve imza yenilemeyi mevcut uygulamayı silmeden, aynı Apple hesabı ve `com.dgtlface.personalchecklist` paket kimliğiyle yap.

## Yayın ve Mac'ten iPhone'a kurulum

1. Mevcut web/API sürümünün yayında olması gerekir. 1.2 ekip eşitlemesi ve mevcut web yönetim API'leri zaten yayındaysa 1.3 için ek sunucu yayını veya veritabanı işlemi gerekmez. Mevcut veritabanı, hesaplar ve ortam ayarları kullanılır.
2. Mac'te Xcode'u aç; ilk açılışta gerekli iOS bileşenlerini tamamla. Bu projede Xcode ve geliştirme araçları daha önce kurulmuştur.
3. `ios/DGTLFACEChecklist.xcodeproj` dosyasını aç. Xcode → Settings → Apple Accounts bölümünde mevcut Apple hesabının açık olduğunu kontrol et.
4. **DGTLFACEChecklist** hedefinin **Signing & Capabilities** bölümünde **Automatically manage signing** açık, **Team** mevcut hesabın olmalı. Bu güncellemede **Bundle Identifier değerini değiştirme**; aynı uygulamayı güncelliyoruz.
5. iPhone'u kabloyla bağla, kilidini aç ve gerekiyorsa bilgisayara güven isteğini onayla. Gerekirse Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu'nu etkinleştirip telefonun istediği yeniden başlatma adımlarını tamamla.
6. Xcode çalışma hedefinden iPhone'u seçip ▶ Run'a bas. Aynı kimlikle yüklenen **1.3.0 (4)** mevcut uygulamayı günceller. İlk girişte web hesabını kullan.

Paylaşılan şemanın Run ayarı günlük kullanım için optimize edilmiş **Release** derlemesini kullanır ve hata ayıklayıcı kapalıdır. Geliştirme gerektiğinde Product → Scheme → Edit Scheme → Run → Info bölümünden Debug ve Debug executable seçilebilir.

Kişisel Apple hesabının geliştirme imzası geçicidir. Geçerlilik bitince uygulamayı silmeden aynı proje, hesap ve paket kimliğiyle yeniden Run yap. Güncel geçerlilik tarihini Xcode'daki imzalama profilinden kontrol et. Başka iPhone'a kurulum da o cihaz için geçerli imzalama gerektirir; uygulama dosyasını göndermek tek başına yeterli değildir. [Apple cihazda çalıştırma rehberi](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices), [Geliştirici Modu adımları](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device) ve [hesap sınırları](https://developer.apple.com/help/account/basics/about-your-developer-account).

Bu kaynak değişikliği sunucuya yayınlama veya fiziksel iPhone'a kurulum yapmaz. **1.3.0 yönetim işlemlerinin canlı uçtan uca testi**, telefon güncellendikten sonra yetkili hesaplarla yapılmalıdır. Otomatik testler canlı kayıtları değiştirmez.

## Telefonda ve webde son kontrol

- Yöneticiyle giriş yap; mevcut otelleri ve sunucudaki görevleri doğrula. Başlangıç aktarımı değişmeden duruyorsa altı otelde toplam 558 görev vardır; sonradan eklenen/silinen işlere göre sayı değişebilir.
- Açık bir görevde telefondan kriter işaretle. Webi elle yenileyerek veya görünür panelin kontrolünü bekleyerek aynı kriteri gör. Webden açıklama/öncelik değiştir ve telefonda yenileyerek kontrol et.
- Telefonda Türkçe çok satırlı bir yorum ekle; webde aynı görevin yorumlarında bir kez göründüğünü doğrula. Yorum gönderim hatasında taslağın korunduğunu kontrol et.
- İki cihazda aynı görevi açıp birinde değiştir; diğerindeki eski sürüme dayanan değişikliğin uyarıyla reddedildiğini, yeni verinin üzerine yazılmadığını doğrula.
- Personel hesabıyla kendisine atanmış görevi düzenle; başka görevleri yalnızca görüntüle. Gözlemciyle yalnız bağlı otelleri gör ve değişiklik düğmelerinin kapalı olduğunu kontrol et.
- Tüm kriterleri işaretleyip kontrole gönder; yönetici onayı sonrası tamamlandı durumunu her iki tarafta doğrula.
- Uçak modunda kaydedilmiş listeyi gör, değişiklik yapılamadığını doğrula. Bağlantıyı açıp yeniledikten sonra devam et. Uygulamayı arka plana alınca düzenli isteklerin durduğunu kontrol et.
- Çıkış yaptıktan sonra ekip listesinin temizlendiğini, farklı hesapla girişte önceki otel kapsamının görünmediğini kontrol et.
- **Eski cihaz kayıtları** bölümünde önceki kişisel tik ve notları görüntüle; ortak görevlerden bağımsız ve salt okunur kaldığını doğrula.
- Küçük ekran, büyük yazı boyutu ve VoiceOver ile liste, kriterler ve yorum formunu kontrol et.

## Geliştirme ve testler

Mobil uygulama web panelinden ayrı bir Xcode projesidir; ekip verisi sunucudan alınır. Paket içindeki `DGTLFACEChecklist/Resources/checklist.json` eski kişisel arşivin görev metinlerini çözmek için korunur. Kaynağı ana projenin `docs/gorev-referansi.json` dosyasıdır. Paket kataloğunu bilinçli olarak güncellerken kaynak satır kimliklerini (`sourceRow`) koru; eski kayıtlar bu kimlikleri kullanır. Aynı görünen işlem koduna sahip farklı satırlar ayrı kayıtlardır. Google Sheets ile canlı bağlantı yoktur.

Depo kökünden:

```sh
# Yalnız paket/arşiv kataloğu kaynağı değiştiyse:
python3 ios/scripts/sync-checklist.py

# İzole Swift testleri:
sh ios/scripts/test-core.sh
sh ios/scripts/test-api.sh
sh ios/scripts/test-team.sh
sh ios/scripts/test-selection.sh

# Web/API kontrolleri:
npm run typecheck
npm test
npm run test:integration
npm run build
```

Core testleri eski otel bazlı tik/not kayıtlarını, v1→v2 aktarımını ve hata halinde kayıtların korunmasını kapsar. API testleri sahte taşıma/kimlik deposuyla oturum, HTTPS, çerez, yönlendirme ve hata akışlarını denetler. Store testleri geçici önbellek ve sahte servisle hesap ayrılığını, eşzamanlı yanıtları, çevrimdışı salt okunur davranışı ve değişiklikleri doğrular. Gerçek Keychain, canlı hesaplar ve cihaz arşivi bu testlerde kullanılmaz. Web testleri otel kapsamı, ETag/304, eski sürüm çatışmaları, yorum tekrarlarının tekilleştirilmesi ve yavaş gönderim sırasında iptal edilen yetkileri de kapsar. Bunlar fiziksel cihaz testinin yerine geçmez.

## Pil ve kaynak kullanımı

Yerel iOS arayüzü ve optimize Release derlemesi kullanılır. Düzenli istekler yalnız ön planda çalışır; Düşük Güç Modu ve hata sonrası bekleme süreleri gereksiz ağ kullanımını azaltır. Değişmeyen yanıtlarda tam içerik indirilmez, değişmeyen ekip önbelleği tekrar yazılmaz. Not yazarken her tuşta sunucuya gönderim yapılmaz. Arka planda sürekli bağlantı, konum takibi veya animasyon yoktur; ekranın otomatik kapanması engellenmez.

Bu önlemler kod düzeyindedir; **gerçek pil tüketimi veya tasarruf yüzdesi ölçülmüş değildir**. Fiziksel cihazda aynı parlaklık ve koşullarla açılış, bekleme, arama/kriter değişikliği, bağlantı kesilmesi ve arka plana geçiş ölçülmelidir. Şarjdan ayrılmış cihazda CPU, bellek, ağ ve enerji etkinliği gözlenebilir. [Apple'ın pil ölçüm rehberi](https://developer.apple.com/documentation/xcode/measuring-your-app-s-power-use-with-power-profiler).

## Önceki kurulumların kaydı

**1.0.0 (1)**, 13 Ekim 2026'da kişisel Apple hesabıyla imzalanarak iOS 26.6.2 kullanan iPhone 13'e yüklendi; kullanıcı güven onayından sonra uygulamanın açıldığını bildirdi. Bu sürüm kişisel, çevrimdışı listeydi.

**1.1.0 (2)**, aynı gün altı otel için bağımsız tik/not alanlarıyla hazırlandı. Eski veri katmanının 22 testi ve cihaz/simülatör Release derlemeleri geçti; simülatörde otel ayrılığı, Türkçe notlar ve kayıt kalıcılığı kontrol edildi. Aynı paket kimliğiyle uygulama silinmeden yerel ağ üzerinden iPhone 13'e yüklendi; sürüm numarası cihazdan doğrulandı ve kullanıcı uygulamanın çalıştığını bildirdi.


**1.2.0 (3)**, 14 Ekim 2026'da aynı paket kimliğiyle fiziksel iPhone 13'e yüklendi ve açıldı. Güncellemeden önce kişisel kayıtların yerel yedeği alındı; kurulumdan sonra v1/v2 dosyalarının değişmediği doğrulandı. Kullanıcı canlı hesabıyla tüm otelleri gördüğünü ve telefondaki değişikliklerin webde göründüğünü bildirdi.

**1.3.0 (4)**, 15 Ekim 2026'da iPhone 13'e aynı paket kimliğiyle yüklendi; cihazdan sürüm/build doğrulandı ve uygulama başlatıldı. Kişisel kayıtlar önceden Mac'e yedeklendi; kurulum sonrasında v1/v2 dosyalarının SHA-256 özetleri aynı kaldı. 22 arşiv/core, 20 API, 20 store ve 12 filtre/tarih kontrolü (**74 toplam**) geçti. iPhone ve simülatör Release derlemeleri ile cihaz imzası doğrulandı.

Canlıya bağlanmayan, ayrı paket kimlikli geçici simülatör uygulamasında menüler, filtreler, görev ve kullanıcı formları incelendi. Reddedilen kayıtta form/taslak koruması yeniden doğrulandı. PDF testi 180 görev içeren 51 sayfada tüm görev metinlerini, Türkçe karakterleri ve taşmasız kenar boşluklarını doğruladı. Geçici QA uygulaması testten sonra simülatörden kaldırıldı. Gerçek AirPrint yazıcı denemesi ve yeni yönetim işlemlerinin canlı hesaplarla kaydı yapılmadı; canlı veride otomatik deneme kaydı oluşturulmadı.
