# FCM — natywne powiadomienia Android

Ten dokument jest runbookiem wdrożeniowym. Nie zawiera sekretów ani danych konkretnego projektu. Nie wklejaj klucza prywatnego do repozytorium, APK, Vite ani czatu.

## A. Architektura

`public.notifications` jest jedynym źródłem prawdy o powiadomieniu. Trigger z migracji `0009_fcm_push_delivery.sql` tworzy prywatne delivery per aktywne urządzenie tylko wtedy, gdy `push_enabled` dla rodziny i użytkownika jest włączone. Edge Function claimuje delivery przez `FOR UPDATE SKIP LOCKED`, wysyła FCM HTTP v1 i zapisuje wynik. Centrum in-app czyta nadal wyłącznie canonical notifications.

Przepływ: zadanie/przypomnienie → `public.notifications` → `private.notification_push_deliveries` → `push-dispatcher` → FCM → Android.

Edge Function wybiera backendowy klucz Supabase z dostarczanego przez platformę słownika `SUPABASE_SECRET_KEYS`, używając wpisu `default` (`sb_secret_...`). Nie trzeba tworzyć własnego sekretu z kluczem Supabase. `SUPABASE_SERVICE_ROLE_KEY` pozostaje wyłącznie fallbackiem kompatybilności dla starszych projektów; żadna wartość klucza nie może trafić do logów, klienta webowego ani APK.

### Ownership instalacji

Klient tworzy trwałą parę `installation_id` oraz co najmniej 256-bitowy `installation_secret` zapisany w lokalnym storage WebView. Secret nie zmienia się przy logout/login i nigdy nie jest logowany. Baza zapisuje wyłącznie SHA-256 secretu w `private.notification_device_credentials`; hash nie jest dostępny przez API klienta.

Istniejąca instalacja może zmienić token lub właściciela wyłącznie po poprawnej weryfikacji secretu. Sama znajomość `installation_id` lub FCM tokenu nie wystarcza. Jeżeli nowa instalacja otrzyma token zajęty przez inny rekord, rejestracja kończy się fail-closed. Recovery wymaga uzyskania nowego tokenu FCM albo świadomego administracyjnego usunięcia/dezaktywacji starego rekordu po weryfikacji — backend nie przejmuje go automatycznie.

## B. Firebase project setup

W Firebase Console utwórz lub wybierz projekt przeznaczony dla Planera rodzinnego. W ustawieniach projektu zanotuj Project ID. Nie automatyzuj tworzenia projektu z repozytorium.

## C. Android app registration

Dodaj aplikację Android do projektu Firebase. Package name musi dokładnie odpowiadać applicationId aplikacji.

## D. Package name

Wymagany package name: `pl.rodzinny.planer`. Podstawowy FCM nie wymaga SHA-1.

`pl.rodzinny.planer` jest dla Androida inną aplikacją niż wcześniejsze `pl.turscy.planer`. Dotychczasowych debug APK nie można zaktualizować nowym APK „na wierzch”; system może zainstalować je jako osobne aplikacje. Zmiana jest świadoma i została wykonana przed finalną konfiguracją Firebase.

## E. Pobranie google-services.json

Firebase Console → Project settings → Your apps → Android app → Download `google-services.json`. Sprawdź, że `package_name` w pliku to `pl.rodzinny.planer`.

## F. Lokalna lokalizacja google-services.json

Umieść prawdziwy plik w `android/app/google-services.json`. Plik jest ignorowany przez Git. Zweryfikuj przed każdym stagingiem:

```powershell
git check-ignore android/app/google-services.json
git status --short
```

## G. GitHub secret FIREBASE_GOOGLE_SERVICES_JSON_B64

Zakoduj cały plik lokalnie bez drukowania go w logach i zapisz wynik bezpośrednio jako Actions secret `FIREBASE_GOOGLE_SERVICES_JSON_B64`:

```powershell
$firebaseClientPath = Resolve-Path 'android/app/google-services.json'
[Convert]::ToBase64String([IO.File]::ReadAllBytes($firebaseClientPath)) | Set-Clipboard
```

GitHub → Settings → Secrets and variables → Actions → New repository secret. Workflow dekoduje sekret przed `cap sync`, nie wypisując JSON.

## H. Firebase service account

Firebase/Google Cloud Console → IAM & Admin → Service Accounts. Utwórz dedykowane konto do wysyłki FCM z minimalnymi uprawnieniami (Firebase Cloud Messaging API Admin), następnie wygeneruj jeden klucz JSON. Przechowuj go poza repozytorium. Client email i private key służą wyłącznie Edge Function.

## I. Bezpieczne Base64 service account JSON

Zakoduj plik lokalnie i przechowuj wartość wyłącznie w managerze sekretów:

```powershell
$serviceAccountPath = Resolve-Path 'C:\secure\firebase-service-account.json'
$env:FCM_SERVICE_ACCOUNT_JSON_B64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($serviceAccountPath))
```

Po zakończeniu sesji usuń zmienną: `Remove-Item Env:FCM_SERVICE_ACCOUNT_JSON_B64`.

## J. Supabase secret FCM_SERVICE_ACCOUNT_JSON_B64

Po zalogowaniu Supabase CLI ustaw sekret bez zapisywania go w pliku projektu:

```powershell
supabase secrets set "FCM_SERVICE_ACCOUNT_JSON_B64=$env:FCM_SERVICE_ACCOUNT_JSON_B64" --project-ref <PROJECT_REF>
```

## K. PUSH_WORKER_SECRET

Wygeneruj co najmniej 32 losowe bajty lokalnie. Nie używaj hasła człowieka ani wartości z dokumentacji:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:PUSH_WORKER_SECRET = [Convert]::ToBase64String($bytes)
supabase secrets set "PUSH_WORKER_SECRET=$env:PUSH_WORKER_SECRET" --project-ref <PROJECT_REF>
```

## L. Worker secret w Supabase Vault

W SQL Editor zapisz worker secret i pełny URL wdrożonej funkcji jako dwa sekrety Vault. Wartości wpisuj bezpośrednio w zaufanym SQL Editorze, nigdy w migracji:

```sql
select vault.create_secret('<WORKER_SECRET>', 'push_worker_secret');
select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/push-dispatcher', 'push_dispatcher_url');
```

## M. Deploy push-dispatcher

Funkcja ma `verify_jwt=false`, ale każdy request musi mieć prawidłowy `x-push-worker-secret`. Deploy:

```powershell
supabase functions deploy push-dispatcher --project-ref <PROJECT_REF> --no-verify-jwt
```

## N. Supabase Cron

Włącz rozszerzenia `pg_cron`, `pg_net` i Vault. Następnie utwórz job co minutę, pobierając URL i sekret z Vault:

```sql
select cron.schedule(
  'dispatch-fcm-push',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatcher_url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-push-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_worker_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Sprawdź wynik w `cron.job_run_details` oraz odpowiedzi `net._http_response`. Nie loguj nagłówka z sekretem.

## O. Migracja 0009

Najpierw przejrzyj pełny plik `database/migrations/0009_fcm_push_delivery.sql`, wykonaj go ręcznie na właściwym projekcie Supabase i sprawdź, czy PostgREST przeładował schema cache. Nie modyfikuj historycznych `0006` ani `0007`.

## P. Pierwszy test

1. Zbuduj APK z prawdziwym `google-services.json` i publiczną konfiguracją Supabase.
2. Zainstaluj APK, zaloguj się, wybierz „Włącz” w preprompcie i przyznaj zgodę Android.
3. Sprawdź fingerprint aktywnego urządzenia, nie token.
4. W aplikacji przypisz zadanie do użytkownika lub ustaw reminder.
5. Uruchom dispatcher przez Cron lub autoryzowany request.
6. Sprawdź canonical notification i delivery status.

## Q. Kontrola tokenu bez ujawniania

W SQL Editor używaj fingerprintu zamiast tokenu:

```sql
select id, user_id, installation_id, platform, provider,
       left(encode(digest(push_token, 'sha256'), 'hex'), 12) as token_fingerprint,
       last_seen_at, disabled_at
from public.notification_devices
order by last_seen_at desc;
```

## R. Kontrola delivery status

Tabela jest celowo prywatna i niewidoczna dla klienta. Administrator bazy może sprawdzić bez tokenów:

```sql
select id, notification_id, device_id, status, attempt_count,
       next_attempt_at, claimed_at, sent_at, last_error
from private.notification_push_deliveries
order by created_at desc
limit 100;
```

## S. Rotacja service account key

Utwórz nowy klucz, zakoduj go lokalnie, zaktualizuj `FCM_SERVICE_ACCOUNT_JSON_B64`, wykonaj test push, a następnie natychmiast usuń stary klucz w Google Cloud Console. Wyczyść lokalne pliki i zmienne środowiskowe. Nigdy nie utrzymuj wielu starych aktywnych kluczy.

## T. Troubleshooting Android permission

- Android 13+: Settings → Apps → Planer rodzinny → Notifications; stan denied nie powinien wywoływać promptu w pętli.
- Android 12 i starszy: Capacitor zwraca granted; sprawdź ustawienia kanałów `reminders` i `general`.
- Brak prepromptu po „Później” jest zamierzony. W testach wyczyść dane aplikacji, aby odtworzyć pierwsze uruchomienie.
- Web nie inicjalizuje natywnego pluginu i pokazuje stan niedostępny.

## U. Troubleshooting błędów tokenu i konfiguracji

FCM `UNREGISTERED` oraz jednoznaczny tokenowy `google.firebase.fcm.v1.FcmError/INVALID_ARGUMENT` oznaczają permanentny błąd tokenu. Dispatcher oznacza delivery jako failed i ustawia `disabled_at`, bez usuwania historii. Kolejna prawidłowa rejestracja tej instalacji może reaktywować rekord.

`SENDER_ID_MISMATCH` oraz ogólny `INVALID_ARGUMENT`/`google.rpc.BadRequest` są permanentnymi błędami konfiguracji lub requestu, ale nie wyłączają urządzenia. `QUOTA_EXCEEDED`, `UNAVAILABLE` i `INTERNAL` korzystają z retry/backoff; nagłówek `Retry-After` ma pierwszeństwo, jeśli FCM go zwróci.

## V. Troubleshooting GitHub Android build

- Secret `FIREBASE_GOOGLE_SERVICES_JSON_B64` musi istnieć i dekodować się do niepustego JSON.
- `VITE_SUPABASE_URL` i `VITE_SUPABASE_PUBLISHABLE_KEY` pozostają wymagane.
- Workflow zachowuje Node 22, JDK 21, wrapper Gradle i `assembleDebug`.
- Nie dodawaj `google-services.json`, service account, `.env`, APK ani Gradle build outputs do stagingu.

## W. Checklista background/killed app

- [ ] Foreground: pojedynczy banner/sound i odświeżone NotificationCenter.
- [ ] Background: systemowy push na kanale właściwego typu.
- [ ] Ekran wygaszony: reminder dociera z wysokim priorytetem.
- [ ] Killed app: notification payload wyświetla wpis w tray.
- [ ] Tap po killed start: login (jeśli potrzebny), następnie Tasks/Calendar i `read_at`.
- [ ] `push_enabled=false` dla rodziny: delivery nie powstaje / jest anulowane.
- [ ] Wylogowany user A, zalogowany user B na telefonie: brak unique violation i brak push dla A.
- [ ] Dwa urządzenia użytkownika: po jednym delivery na urządzenie.
- [ ] Retry tej samej notification: stabilny tag nie tworzy duplikatów w tray.

## Kolejność wdrożenia

1. Code review.
2. Firebase project/app configuration.
3. Lokalny `google-services.json`.
4. Review migracji 0009.
5. Ręczne wykonanie migracji 0009.
6. Edge Function secrets.
7. Deploy `push-dispatcher`.
8. Supabase Vault/Cron.
9. GitHub secret klienta Firebase.
10. Android APK build.
11. Instalacja APK.
12. Permission.
13. Device token registration.
14. Test FCM.
15. Test background.
16. Test killed app.
17. Test automatycznego remindera.
