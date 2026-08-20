# Android — Capacitor foundation

## Wymagania lokalne

- Node.js 22.x i npm 10+
- Android Studio 2025.2.1 lub nowszy
- Android SDK Platform 36 oraz aktualne Android SDK Build-Tools
- JDK 21 (JBR dostarczany przez Android Studio jest wystarczający)

Ustaw `ANDROID_HOME` na katalog SDK. Na Windows najczęściej jest to `%LOCALAPPDATA%\Android\Sdk`. Gradle może wymagać `JAVA_HOME` wskazującego JDK 21.

## Codzienny workflow

Po zmianie kodu React uruchom z katalogu głównego:

```bash
npm run android:sync
```

Skrypt buduje `apps/web/dist` i wykonuje `npx cap sync android`. Platformę dodano już raz — nie uruchamiaj ponownie `npx cap add android`.

Android Studio otworzysz poleceniem:

```bash
npm run android:open
```

Debug APK:

```bash
npm run android:build:debug
```

Wynik powinien znaleźć się w `android/app/build/outputs/apk/debug/app-debug.apk`. Zawsze potwierdź ścieżkę po buildzie zamiast zakładać jej istnienie.

## Wersjonowanie i release

`versionCode` i `versionName` znajdują się w `android/app/build.gradle`. Obecny start to `versionCode 1` i `versionName "0.2.0"`, zgodny z wersją aplikacji w `package.json`.

Release AAB można przygotować poleceniem:

```bash
npm run android:build:aab
```

Przed dystrybucją trzeba utworzyć bezpieczny keystore, skonfigurować signing poza repozytorium oraz zwiększyć `versionCode`. Nie commituj haseł, `local.properties`, `google-services.json`, `*.jks`, `*.keystore`, `.env`, `SUPABASE_SECRET_KEY` ani klucza service role.

## Supabase i GitHub Actions

APK używa wyłącznie publicznej konfiguracji klienta Vite:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Workflow `.github/workflows/android-build.yml` oczekuje GitHub Actions Repository Variables o tych nazwach; alternatywnie mogą to być Secrets o identycznych nazwach. Workflow używa Node 22, JDK 21, cache npm/Gradle, wykonuje `npm ci`, build web, `cap sync`, `assembleDebug` i publikuje APK jako artifact.

## Walidacja Firebase przed buildem Android

APK używany do testów FCM musi przejść `npm run android:firebase:check`. Sam sukces Gradle nie oznacza, że APK jest FCM-ready.

W GitHub Actions prawdziwy `android/app/google-services.json` jest odtwarzany z `FIREBASE_GOOGLE_SERVICES_JSON_B64`. Workflow waliduje JSON i klienta `pl.rodzinny.planer` przed `cap sync` oraz `assembleDebug`; brakująca lub nieprawidłowa konfiguracja zatrzymuje job przed utworzeniem APK. Artifact z tego workflow jest referencyjnym buildem do testów FCM.

Lokalnie musi istnieć ignorowany przez Git plik `android/app/google-services.json`. Przed synchronizacją lub buildem uruchom:

```powershell
npm run android:firebase:check
```

Skrypty `npm run android:build:debug` i `npm run android:build:aab` wykonują tę kontrolę automatycznie przez `android:sync`. Nie dodawaj fallbacku, mocka ani przykładowego Firebase JSON do lokalnego lub CI buildu.

## System UI, splash i ikona

Capacitor ładuje lokalny bundle z `apps/web/dist`; nie ma `server.url` ani zgody na cleartext. System bars korzystają z ciemnego stylu i zmiennych safe-area Capacitor 8. Klawiatura działa w trybie `adjustResize`.

Splash ma ciemne tło `#0A0A0F` i szybkie przejście do aplikacji. Wygenerowane ikony/adaptive icon są technicznie poprawnym placeholderem Capacitor. Przed wydaniem należy zastąpić wszystkie `mipmap-*` oraz splash foreground finalnym, zatwierdzonym brandingiem — bez zmiany `applicationId`.

## FCM i deep links

Klient Firebase Android jest skonfigurowany dla `pl.rodzinny.planer`, a oficjalny plugin Push Notifications obsługuje zgodę systemową, rejestrację tokenu, kanały oraz zdarzenia foreground/background/tap. Prawdziwy `google-services.json` pozostaje poza repozytorium: lokalnie jest ignorowany przez Git, a workflow CI odtwarza go z zaszyfrowanego GitHub Actions secretu. Backendowy service account, wdrożenie Edge Function i Cron są osobnym, późniejszym etapem opisanym w `docs/fcm.md`.

Payload mapuje powiadomienia na istniejące widoki Tasks, Calendar i Dashboard. Docelowe publiczne trasy `planer://tasks/<id>`, `planer://calendar/<id>`, `planer://shopping/<id>` i `planer://budget` nie są jeszcze rejestrowane w manifeście.

Obecna nawigacja jest stanem aplikacji, więc manifest nie rejestruje jeszcze schematu `planer://`; rejestrację należy dodać razem z walidacją payloadu i docelowym dispatcherem deep linków.

`pl.rodzinny.planer` jest odrębnym identyfikatorem aplikacji Android od wcześniejszego `pl.turscy.planer`. APK z nowym identyfikatorem nie zaktualizuje wcześniejszego debug APK „na wierzch” i może zostać zainstalowany jako osobna aplikacja. To świadoma zmiana wykonana przed konfiguracją Firebase.

## Checklista testu na telefonie

- instalacja i pierwsze uruchomienie APK,
- logowanie oraz odtworzenie sesji po restarcie,
- Dashboard, Kalendarz, Zadania, Zakupy, Budżet, Powiadomienia i Admin,
- modale, klawiatura, scroll, safe-area i systemowy Back,
- zmiana rozmiaru/orientacji,
- zachowanie bez internetu i po odzyskaniu połączenia,
- status bar, system navigation bar oraz dolny MobileNav bez nakładania.
