# DGTLFACE İşler — iPhone

**1.2.0 (3)** sürümü, [DGTLFACE web paneline](https://panel.dgtlface.com) aynı hesapla bağlanan ekip uygulamasıdır. Oteller, görevler, kriter tikleri ve ekip yorumları sunucudaki ortak veritabanından alınır. Eski kişisel kayıtlar ayrıca cihaz arşivinde korunur. Minimum iOS sürümü 17'dir; SwiftUI ve sistem kütüphaneleri kullanılır, harici Swift paketi gerekmez.

## Kullanım ve yetkiler

Webde kullandığın e-posta ve şifreyle giriş yap. Ayrı mobil hesap veya yeni ortam değişkeni gerekmez. Oturum en fazla 8 saattir; süresi dolduğunda veya hesap yetkileri değiştiğinde yeniden giriş gerekir.

- Yönetici tüm otel ve görevleri görür; kriterleri ve durumu değiştirebilir, yorum ekleyebilir, kontrolü onaylayabilir, işi geri gönderebilir veya yeniden açabilir.
- Personel tüm otelleri görür; yalnızca kendisine atanmış görevlerde kriter/durum değiştirir, yorum ekler ve kontrole gönderir.
- Otel gözlemcisi yalnızca bağlı otellerini ve bunların görev/yorumlarını görüntüler; değişiklik yapamaz.

Ana ekranda oteller, her otelde işlem grupları, ardından görevler bulunur. Görevler öncelik puanıyla sıralanır: **1 en önce, 10 en sonra**. Görev ayrıntısında açıklama, sorumlu, otelden gerekli bilgi, tamamlanma kriterleri ve ekip yorumları gösterilir. Yeni otel, kullanıcı, kişi ataması ve öncelik düzenlemeleri web panelinden yapılır.

**Tik koymak bir tamamlanma kriterini işaretler.** Tüm kriterler hazır olunca iş yönetici kontrolüne gönderilir; ancak yönetici onayıyla “Tamamlandı” olur. Kontrol veya tamamlandı aşamasındaki kriterler kilitlidir. Yönetici işi geri gönderebilir veya yeniden açabilir.

**Yorum / açıklama ekle** alanı ortak ekip yorumuna yeni bir kayıt ekler. Bu notlar webde de görünür ve görevi görmeye yetkili otel gözlemcileri tarafından okunabilir. Mevcut yorum üzerine yazılmaz. Aynı gönderimin bağlantı sorunu nedeniyle tekrar denenmesi aynı yorum kaydını döndürür; yeni kopya oluşturmaz. Başka biri görevi değiştirmişse eski sürüme dayanan tik/durum işlemi uygulanmaz; güncel bilgi alınıp tekrar denenir.

## Eşitleme ve çevrimdışı kullanım

Uygulama açıldığında, ön plana döndüğünde ve elle yenilendiğinde güncel veriler alınır. Ekran açıkken normalde **30 saniyede**, Düşük Güç Modu'nda **90 saniyede** kontrol yapılır. Bağlantı hatalarında deneme aralığı **300 saniyeye kadar** uzar. Web paneli görünürken **30 saniyede** kontrol edilir; her iki tarafta elle yenileme de vardır. Bu nedenle diğer cihazdaki değişiklikler bir sonraki başarılı kontrolde görünür; anlık push bildirimi kullanılmaz.

Değişiklik yoksa ETag/304 yanıtı tüm görev listesinin yeniden indirilmesini önler. iPhone arka plana geçince düzenli kontrol durur; arka plan servisi, push bildirimi, konum takibi veya ekranı açık tutma yoktur.

İnternet kesilirse **son indirilen liste salt okunur** gösterilir. Sunucuya yeniden bağlanıp oturum doğrulanana kadar kriter/durum değişikliği veya yorum gönderilemez. Çevrimdışı değişiklik kuyruğu yoktur. Açık yorum taslağı bir gönderim hatasında ekranda tutulur; gönderildiği doğrulanmadan başarı gösterilmez. Başarılı sunucu kaydı ortak veritabanında saklanır.

## Oturum ve kayıtların saklanması

Parola kalıcı olarak saklanmaz. Oturum çerezi, yalnız bu cihazda kullanılabilen ve cihaz kilidi açıkken erişilen Keychain kaydında tutulur. İstekler sabit HTTPS panel adresine gider; oturum çerezi başka sunucuya yönlendirilmez. Webdeki rol ve otel kapsamı her API isteğinde sunucuda doğrulanır.

Ekip önbelleği `Application Support/DGTLFACETeam/team-cache-v1.json` dosyasındadır. Kullanıcı kimliğine bağlıdır, iOS dosya korumasıyla yazılır ve yedekten hariç tutulur. Çıkışta, oturum sona erdiğinde veya sunucu `401` döndürdüğünde ekip görünümü ve önbelleği temizlenir. Başka hesapla giriş yapıldığında önceki hesabın listesi kullanılmaz. Önbellek sunucudaki kayıtların yerine geçmez.

Önceki sürümlerin `Application Support/DGTLFACEChecklist/progress-v1.json` ve `progress-v2.json` kayıtları **Eski cihaz kayıtları** ekranında salt okunur arşiv olarak açılır. Eski tikler ve kişisel notlar otomatik olarak ortak görevlere aktarılmaz. Kaynak satırları ve görünen görev kodları aynı olsa da eski kişisel işaretler ortak yönetici onay sürecinin yerine geçirilmez. v1 kayıtlarının v2 biçimine taşınmasında kaynak v1 dosyası korunur; otelle eşleştirilmemiş tikler **Mevcut işlerim** listesinde kalır.

**Uygulamayı telefondan silmek cihaz arşivini de silebilir.** Güncellemeyi ve imza yenilemeyi mevcut uygulamayı silmeden, aynı Apple hesabı ve `com.dgtlface.personalchecklist` paket kimliğiyle yap.

## Yayın ve Mac'ten iPhone'a kurulum

1. Önce bu deponun web/API değişikliklerini mevcut sunucuya yayınla. Mobil uygulamanın `/api/mobile/bootstrap`, görev ve yorum uçlarına erişebilmesi gerekir. Mevcut veritabanı, hesaplar ve ortam ayarları kullanılır.
2. Mac'te Xcode'u aç; ilk açılışta gerekli iOS bileşenlerini tamamla. Bu projede Xcode ve geliştirme araçları daha önce kurulmuştur.
3. `ios/DGTLFACEChecklist.xcodeproj` dosyasını aç. Xcode → Settings → Apple Accounts bölümünde mevcut Apple hesabının açık olduğunu kontrol et.
4. **DGTLFACEChecklist** hedefinin **Signing & Capabilities** bölümünde **Automatically manage signing** açık, **Team** mevcut hesabın olmalı. Bu güncellemede **Bundle Identifier değerini değiştirme**; aynı uygulamayı güncelliyoruz.
5. iPhone'u kabloyla bağla, kilidini aç ve gerekiyorsa bilgisayara güven isteğini onayla. Gerekirse Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu'nu etkinleştirip telefonun istediği yeniden başlatma adımlarını tamamla.
6. Xcode çalışma hedefinden iPhone'u seçip ▶ Run'a bas. Aynı kimlikle yüklenen **1.2.0 (3)** mevcut uygulamayı günceller. İlk girişte web hesabını kullan.

Paylaşılan şemanın Run ayarı günlük kullanım için optimize edilmiş **Release** derlemesini kullanır ve hata ayıklayıcı kapalıdır. Geliştirme gerektiğinde Product → Scheme → Edit Scheme → Run → Info bölümünden Debug ve Debug executable seçilebilir.

Kişisel Apple hesabının geliştirme imzası geçicidir. Geçerlilik bitince uygulamayı silmeden aynı proje, hesap ve paket kimliğiyle yeniden Run yap. Güncel geçerlilik tarihini Xcode'daki imzalama profilinden kontrol et. Başka iPhone'a kurulum da o cihaz için geçerli imzalama gerektirir; uygulama dosyasını göndermek tek başına yeterli değildir. [Apple cihazda çalıştırma rehberi](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices), [Geliştirici Modu adımları](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device) ve [hesap sınırları](https://developer.apple.com/help/account/basics/about-your-developer-account).

Bu kaynak değişikliği sunucuya yayınlama veya fiziksel iPhone'a kurulum yapmaz. **1.2.0'ın canlı uçtan uca testi**, web güncellemesi yayınlandıktan ve telefon güncellendikten sonra yapılmalıdır.

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

**1.1.0 (2)**, aynı gün altı otel için bağımsız tik/not alanlarıyla hazırlandı. Eski veri katmanının 22 testi ve cihaz/simülatör Release derlemeleri geçti; simülatörde otel ayrılığı, Türkçe notlar ve kayıt kalıcılığı kontrol edildi. Aynı paket kimliğiyle uygulama silinmeden yerel ağ üzerinden iPhone 13'e yüklendi; sürüm numarası cihazdan doğrulandı ve kullanıcı uygulamanın çalıştığını bildirdi. Bu geçmiş kurulum **1.2.0 ekip eşitlemesinin telefona kurulduğu anlamına gelmez**.
