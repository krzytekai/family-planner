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

## System UI, splash i ikona

Capacitor ładuje lokalny bundle z `apps/web/dist`; nie ma `server.url` ani zgody na cleartext. System bars korzystają z ciemnego stylu i zmiennych safe-area Capacitor 8. Klawiatura działa w trybie `adjustResize`.

Splash ma ciemne tło `#0A0A0F` i szybkie przejście do aplikacji. Wygenerowane ikony/adaptive icon są technicznie poprawnym placeholderem Capacitor. Przed wydaniem należy zastąpić wszystkie `mipmap-*` oraz splash foreground finalnym, zatwierdzonym brandingiem — bez zmiany `applicationId`.

## FCM i deep links — kolejny etap

Nie dodano Firebase ani `google-services.json`. Następny etap wymaga:

1. projektu Firebase przypisanego do `pl.turscy.planer`,
2. bezpiecznie dostarczonego `google-services.json`,
3. oficjalnego pluginu Push Notifications,
4. zgody `POST_NOTIFICATIONS`, rejestracji/odświeżania tokenu i zapisu tokenu dla zalogowanego użytkownika,
5. obsługi foreground/background/tap,
6. mapowania payloadu na przyszłe trasy `planer://tasks/<id>`, `planer://calendar/<id>`, `planer://shopping/<id>` i `planer://budget`.

Obecna nawigacja jest stanem aplikacji, więc manifest nie rejestruje jeszcze schematu `planer://`; rejestrację należy dodać razem z walidacją payloadu i docelowym dispatcherem deep linków.

## Checklista testu na telefonie

- instalacja i pierwsze uruchomienie APK,
- logowanie oraz odtworzenie sesji po restarcie,
- Dashboard, Kalendarz, Zadania, Zakupy, Budżet, Powiadomienia i Admin,
- modale, klawiatura, scroll, safe-area i systemowy Back,
- zmiana rozmiaru/orientacji,
- zachowanie bez internetu i po odzyskaniu połączenia,
- status bar, system navigation bar oraz dolny MobileNav bez nakładania.
