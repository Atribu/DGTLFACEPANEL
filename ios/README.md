# DGTLFACE İşler — iPhone

Her otel için 93 hazır işlemi 12 grupta gösteren kişisel kontrol listesi. Her otelin tikleri ve işlem notları ayrı tutulur; her telefonun kayıtları bağımsızdır. Uygulama internet veya kullanıcı hesabı gerektirmez.

Ana ekranda oteller ve her birinin ilerlemesi bulunur. Otelden işlem grubuna, ardından görevlere geçilir. Başlangıç otelleri: Miramare Beach, Miramare Quenn, Port Nature Luxury Resort, SY Hotels, Mi Hotel ve Teona Hotel. Uygulamadan yeni otel eklenebilir ve otel adı değiştirilebilir. İşaretler geri alınabilir. Arama, Tümü / Kalan / Biten filtreleri ve yalnızca seçilen otelin tiklerini temizleyen onaylı sıfırlama vardır; notlar korunur. Her işlemin altında kişisel not önizlemesi ve not düzenleme düğmesi bulunur. Notlar, düzenleme sayfasındaki **Kaydet** ile saklanır. İşlemlerin kaynak açıklamaları “Ayrıntılar” altında gösterilir. DGTLFACE logosu ve renkleri kullanılır.

## Hazır olan ve gereken

Kaynak kod, uygulama simgesi, işlem listesi ve Xcode projesi hazır. 1.1.0 (2) sürümüne otel bazında ilerleme ve not alanları eklendi. **22 veri katmanı testi** geçti; iOS cihaz ve iOS Simulator için **Release derlemeleri** başarılı. Cihaz sürümü kişisel hesapla imzalandı ve imza doğrulandı. iPhone 18 Pro / iOS 27 simülatöründe altı otel, görev gruplarına geçiş, tik koyma, çok satırlı Türkçe not yazma/kaydetme ve notun görev altında görünmesi denendi. İkinci otelde aynı görevin tikinin ve notunun boş kaldığı ekrandan, altı otelin ayrılığı kaydedilen dosyadan doğrulandı. Bağımsız kod incelemesi kayıtların korunmasını ve otel bağlamlarını kontrol etti. 13 Ekim 2026’da 1.1.0 (2) güncellemesi aynı paket kimliğiyle, uygulama silinmeden yerel ağ üzerinden iPhone 13’e yüklendi; cihazdan sürüm numarası doğrulandı. Xcode’dan yeni sürümü açma adımı telefonun ekran kilidinin açılmasını bekliyor; bu sürümün fiziksel cihaz arayüz kontrolü henüz tamamlanmadı.

Xcode 27.0 ve iOS geliştirme araçları kuruldu. 13 Ekim 2026’da kişisel Apple hesabıyla imzalanan **DGTLFACE İşler 1.0.0 (1)**, iOS 26.6.2 kullanan iPhone 13’e yüklendi. İmza denetimi ve cihazdaki paket kimliğiyle kurulum doğrulandı; kullanıcı geliştiriciye güven onayından sonra uygulamanın açıldığını bildirdi. Gerçek pil tüketimi henüz ölçülmedi. Gereken minimum iOS sürümü 17’dir.

## Mac’ten iPhone’a kurulum

1. Mac App Store’dan Xcode’u kur, ilk açılışta gerekli iOS bileşenlerini tamamla. Bu Mac’te bu adım tamamlandı.
2. Bu klasördeki `DGTLFACEChecklist.xcodeproj` dosyasını Xcode ile aç.
3. Xcode → Settings → Apple Accounts bölümünde kendi Apple hesabınla giriş yap.
4. Solda projeyi, ardından **DGTLFACEChecklist** hedefini seç. **Signing & Capabilities** altında **Automatically manage signing** açık olsun; **Team** alanında hesabını seç. Ücretsiz hesapta “Personal Team” görünür.
5. Bundle Identifier başlangıçta `com.dgtlface.personalchecklist`. Kullanılamadığına dair hata çıkarsa sana özgü bir tanımlayıcı belirle ve sonraki yüklemelerde aynı tanımlayıcıyı koru.
6. iPhone’u kabloyla bağla, kilidini aç ve bilgisayara güven isteğini telefonda onayla. Gerekirse iPhone’da Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu’nu açıp yeniden başlatma adımlarını tamamla.
7. Xcode’un üst bölümünde çalışma hedefi olarak iPhone’unu seç ve ▶ Run’a bas. Derleme ve yükleme tamamlanınca “DGTLFACE İşler” açılır.

Paylaşılan şemanın Run ayarı günlük kullanım için optimize edilmiş **Release** derlemesini kullanır ve hata ayıklayıcı kapalıdır. Kod üzerinde hata ayıklamak gerektiğinde Product → Scheme → Edit Scheme → Run → Info altında Debug derlemesini seçip Debug executable seçeneğini açabilirsin.

[Apple’ın cihazda çalıştırma rehberi](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices) ve [Geliştirici Modu adımları](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).

Ücretsiz Personal Team ile kurulumun imzası **7 gün sonra sona erer**; Xcode’dan yeniden derleyip yüklemek gerekir. Apple bu yöntem için en fazla 3 cihaz ve cihaz başına 3 uygulama sınırı bildiriyor. Başka bir iPhone’a kurulumda da cihaz için geçerli imzalama gerekir; dosyayı göndermek tek başına kurulum sağlamaz. [Apple’ın hesap ve kurulum sınırları](https://developer.apple.com/help/account/basics/about-your-developer-account).

Bu kurulumun imzalama profili **20 Ekim 2026, 12:57 (Türkiye saati)** tarihinde sona eriyor. Uygulamayı silmeden aynı proje, Apple hesabı ve paket kimliğiyle yeniden Run yaparak imzayı yenile.

## Telefon üzerinde son kontrol

- İlk açılışta altı oteli, her otelde 93 işlem ve 12 grubu doğrula.
- Bir otelde birkaç işleme tik koy ve bir işleme çok satırlı not yazıp Kaydet'e dokun; başka otelde aynı işlemin boş kaldığını kontrol et. Uygulamayı kapatıp yeniden açınca ilk oteldeki tiklerin ve notun kaldığını doğrula.
- Not değişikliğinden vazgeç; önceki notun korunduğunu kontrol et. Notu boşaltıp kaydederek kaldırmayı dene.
- Bir otel ekle ve adını değiştir; yeniden açınca adının korunduğunu, aynı isimle ikinci otelin eklenemediğini kontrol et.
- Uçak modunda bir tiki kaldırıp diğerini işaretle, tekrar açarak kaydı kontrol et.
- Arama ve üç filtreyi dene. Kalan filtresinde bir grubun son işlemini tamamlamayı da kontrol et.
- “İşaretleri sıfırla” onayında önce vazgeç, sonra onaylayarak sadece o otelin tiklerinin temizlendiğini; notlarının ve diğer otellerin kayıtlarının korunduğunu kontrol et.
- Küçük ekran, büyük yazı boyutu ve VoiceOver ile listeyi dene.
- İkinci iPhone’da kurulduğunda ilk telefondaki tiklerin taşınmadığını doğrula.

## İlerlemenin saklanması

Oteller, işaretler ve notlar uygulamanın kendi alanındaki `Application Support/DGTLFACEChecklist/progress-v2.json` dosyasında saklanır. Tikler değiştiği anda; otel adı ve notlar Kaydet'e basıldığında atomik olarak yazılır. Uygulama kapanınca korunur. Kayıt yazılamazsa önceki durum korunur ve hata gösterilir; not düzenleme sayfasındaki taslak kapanmaz. Bozuk kayıt kendiliğinden sıfırlanmaz.

İlk 1.1 açılışında eski `progress-v1.json` okunarak tikler taşınır; kaynak dosya değiştirilmez. Bir otelle ilişkilendirilmemiş eski tikler **Mevcut işlerim** adlı ayrı listede korunur. Yeni oteller boş başlar. Yeni kayıt mevcutsa tekrar aktarım veya başlangıç otellerini yeniden oluşturma yapılmaz.

Uygulamayı telefondan silmek kayıtları da siler. İmza yenilerken uygulamayı silmeden, aynı tanımlayıcıyla yeniden yükle. Uygulama içinde dışa aktarma veya telefonlar arası eşitleme bulunmaz; cihazın iOS yedekleme ve geri yükleme davranışı ayrıdır.

## Pil ve kaynak kullanımı

- Arka plan görevi, zamanlayıcı, sürekli yenileme, internet isteği, konum takibi veya sürekli animasyon yoktur. Ekranın otomatik kapanması engellenmez.
- Aranacak metinler açılışta bir kez hazırlanır. Türkçe harf dönüşümü her satır için tekrar yapılmaz; sorgu ekran güncellemesinde bir kez hazırlanır.
- Arama sonuçları ve grup sayaçları aynı ekran çiziminde tekrar tekrar hesaplanmaz. İşlem sayısı önceden hesaplanır; sayım sırasında geçici işlem dizileri oluşturulmaz.
- Kayıt yalnızca veri gerçekten değiştiğinde yapılır. Küçük JSON dosyası tek atomik yazmayla hemen saklanır; değişmeyen bir notu kaydetmek veya boş listeyi tekrar sıfırlamak diske yazmaz. Not yazarken her tuşta kayıt yapılmaz; Kaydet'e basıldıktan sonra beklemek gerekmez.
- Sistem koyu görünümü ve yerel iOS listeleri kullanılır. Günlük kullanım derlemesinde Swift optimizasyonu açıktır (`Release`, `-O`).

Bunlar kod düzeyinde yapılan düzenlemelerdir; belirli bir pil tasarrufu yüzdesi ölçülmüş değildir. Xcode ve iPhone hazır olduğunda Release sürümüyle açılış, 1 dakika dokunmadan bekleme, arama/tik koyma ve arka plana geçiş senaryoları ölçülmelidir. Aynı telefon, ekran parlaklığı ve koşullarla karşılaştırma yapılmalı; CPU, bellek ve disk etkinliği gözlenmelidir. iOS 26 ve sonrasında Instruments Power Profiler kullanılabilir; daha eski cihazlarda Xcode’un kullanılabilir enerji ve performans araçlarıyla kontrol gerekir. Şarj sırasında Power Profiler’ın toplam sistem enerji değeri 0 görünebildiği için pil karşılaştırması şarjdan ayrılmış cihazda yapılmalıdır. [Apple’ın pil ölçüm rehberi](https://developer.apple.com/documentation/xcode/measuring-your-app-s-power-use-with-power-profiler).

## Gruplar

| Grup | İşlem |
| --- | ---: |
| Proje Açılışı | 5 |
| Telefon & NAC | 8 |
| WhatsApp | 1 |
| Connexease | 1 |
| Erişim & Güvenlik | 8 |
| Elektraweb & Asisia | 14 |
| OTA & Dağıtım | 12 |
| Marka & İçerik | 6 |
| Web & Rezervasyon | 10 |
| Ölçümleme & Veri | 10 |
| Sosyal Medya | 5 |
| Reklam & Talep | 13 |
| **Toplam** | **93** |

## Geliştirme

SwiftUI arayüzü ve Foundation tabanlı yerel kayıt kullanılır. Harici paket veya sunucu bağımlılığı yoktur. Web panelinden ayrı bir Xcode projesidir.

İşlem kaynağı ana projenin `docs/gorev-referansi.json` dosyasıdır. Uygulama bu dosyadan üretilen `DGTLFACEChecklist/Resources/checklist.json` kopyasını paketinde taşır. Kaynak değişirse depo kökünden çalıştır:

```sh
python3 ios/scripts/sync-checklist.py
sh ios/scripts/test-core.sh
```

Ardından Xcode’dan yeniden derleyip telefona yükle. Canlı panel veya Google Sheets değişiklikleri telefona kendiliğinden aktarılmaz. Kaynak satır kimliklerini (`sourceRow`) mevcut işlemler için koru; ilerleme bu kimliklerle ilişkilendirilir. Aynı görünen işlem koduna sahip farklı satırlar bağımsız işaretlenir. Kaynaktaki “Kritik” önceliği 1, “Yüksek” 3, diğerleri 5 olarak gösterilir; grup ve işlem sıralaması kaynakla aynıdır.

`test-core.sh`, geçici dizinde Swift ile veri katmanı testlerini derleyip çalıştırır: katalog ve Türkçe arama, otellerin bağımsız tikleri/notları, otel ekleme ve ad değiştirme, yeniden açma, notları koruyan sıfırlama, gereksiz yazmaların engellenmesi, v1'den v2'ye aktarım ve hata durumunda kayıtların korunması. Bu testler iOS arayüz derlemesinin veya cihaz testinin yerine geçmez.
