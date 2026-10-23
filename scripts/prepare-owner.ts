import { randomBytes } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "../lib/server/password";
import { SYSTEM_OWNER_EMAIL } from "../lib/server/owner-identity";

// Generates an offline, one-use setup package. It never connects to a database,
// prints a password, changes .env.local, or overwrites an earlier credential.
async function main() {
  const folder = path.resolve(".data", "system-owner-setup");
  await mkdir(path.dirname(folder), { recursive:true, mode:0o700 });
  await mkdir(folder, { mode:0o700 });
  await chmod(folder, 0o700);
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(password);
  await writeFile(path.join(folder,"server.env"), `SYSTEM_OWNER_PASSWORD_HASH=${passwordHash}\n`, {flag:"wx",mode:0o600});
  await writeFile(path.join(folder,"hesap-bilgileri.txt"), [
    "DGTLFACE — Özel sahip hesabı", "", `E-posta: ${SYSTEM_OWNER_EMAIL}`, `Şifre: ${password}`, "",
    "Kodla gelen sahip hesabı için ek ayar gerekmez. Bu dosyalar yalnız farklı bir ilk kurulum parolası seçmek içindir.",
    "İsteğe bağlı: server.env dosyasındaki SYSTEM_OWNER_PASSWORD_HASH değerini ilk hesap oluşturulmadan önce sunucunun ortam değişkenlerine ekleyin.",
    "Yeni kodla web ve worker servisleri yeniden başlayınca hesap bir kez oluşturulur. Sonraki yayınlar parolayı sıfırlamaz.",
    "Zaten oluşturulmuş bir hesabın parolası bu betikle veya ortam değişkeniyle değiştirilmez.",
    "Kurulumdan sonra ortam değişkeni kaldırılabilir; hesap ve parola veritabanında kalır.",
    "Bu klasörü, parolayı ve server.env dosyasını GitHub'a göndermeyin veya paylaşmayın.",
    "Bu komut henüz hiçbir sunucuda hesap açmadı; yalnız güvenli kurulum bilgisi hazırladı.", "",
  ].join("\n"), {flag:"wx",mode:0o600});
  console.log(`Kurulum dosyaları hazır: ${folder}`);
  console.log("İsteğe bağlı ilk kurulum parolası hazır; mevcut hesapları veya kodla gelen özeti değiştirmez. Parola ekrana yazılmadı.");
}
main().catch(error => {
  console.error((error as NodeJS.ErrnoException).code === "EEXIST"
    ? "Kurulum klasörü zaten var; mevcut parola değiştirilmedi. .data/system-owner-setup içindeki dosyaları kullanın."
    : error instanceof Error ? error.message : "Kurulum dosyaları hazırlanamadı.");
  process.exitCode = 1;
});
