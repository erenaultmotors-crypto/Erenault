# Erenault

Eren Oto (Erenault Motors) ekip uygulaması: teklif, sözleşme, satış, iş paylaşımı, mesajlaşma, stok, tedarikçi siparişi, esnaf, hazır motor stoğu ve patron asistanı.

## Parçalar

| Klasör | Ne işe yarar |
| --- | --- |
| `gas/` | Google Apps Script sunucusu (`Kod.gs`) ve müşteri teklif/sözleşme sayfası (`Sayfa.html`). Veriler Eren Oto'nun Google E-Tablo ve Drive'ında durur. |
| `web/` | Ekip uygulamasının ekranları. GitHub Pages'te yayınlanır; APK bunu açar. Güncelleme için yeni APK gerekmez. |
| `app/` | Android kabuğu (Capacitor). Mikrofon, konum, kamera ve dosya paylaşımı izinleri. |
| `.github/workflows/` | Her güncellemede ekranları yayınlar ve APK'yı derler. APK "Releases" bölümüne düşer. |

## Kurulum özeti

1. `gas/Kod.gs` ve `gas/Sayfa.html` Apps Script projesine kopyalanır, **Dağıt → Dağıtımları yönet → Düzenle → Yeni sürüm** ile güncellenir.
2. Web uygulaması adresi (…/exec) `web/config.js` içine yazılır.
3. GitHub → Settings → Pages → Source: **GitHub Actions**.
4. GitHub → Settings → Secrets and variables → Actions: `ANDROID_KEYSTORE` ve `ANDROID_KEYSTORE_PASSWORD` (imza anahtarı; depoya asla konmaz).
5. Actions bittiğinde APK **Releases** bölümünden indirilir.

Gizli bilgiler (API anahtarı, imza anahtarı, şifreler) bu depoda bulunmaz.
