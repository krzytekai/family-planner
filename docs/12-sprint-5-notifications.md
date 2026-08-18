# Sprint 5 — Notifications + Reminders

Sprint dodaje trwałe centrum powiadomień, licznik nieprzeczytanych, preferencje i osobiste przypomnienia do zadań oraz wydarzeń. Kliknięcie powiadomienia oznacza je jako przeczytane i otwiera właściwy moduł.

## Zdarzenie a kanał dostarczenia

`public.notifications` jest kanonicznym rekordem zdarzenia przeznaczonego dla użytkownika. Preferencje typu (`task_assigned_enabled`, `task_reminders_enabled`, `calendar_reminders_enabled`) decydują, czy takie zdarzenie powstaje. Preferencje kanałów (`in_app_enabled`, `push_enabled`) są od tej decyzji niezależne.

Wyłączenie `in_app_enabled` ukrywa kanoniczne zdarzenia w centrum aplikacji, ale ich nie usuwa i nie blokuje utworzenia. Dzięki temu `in_app_enabled=false` razem z `push_enabled=true` nie zamyka drogi do przyszłego dostarczenia Android Push.

```text
Reminder / application event
        |
        v
canonical notification
        |
        +--> in-app channel
        |
        +--> future Android FCM delivery
```

## Dostarczanie

Przypomnienia nie zależą od otwartej karty przeglądarki. Zaufany scheduler powinien cyklicznie wywoływać `private.process_due_reminders(100)`. Funkcja blokuje partie przez `FOR UPDATE SKIP LOCKED`, a unikalny `dedupe_key` stanowi drugą ochronę przed powtórzeniem. Przed wygenerowaniem zdarzenia ponownie sprawdza aktywne członkostwo odbiorcy. Przypomnienie użytkownika zablokowanego lub usuniętego z rodziny zostaje anulowane i nie wraca do kolejki.

Migracja tylko przygotowuje kontrakt. Nie konfiguruje produkcyjnego Crona ani zewnętrznego dostawcy push.

## Android-ready

Repozytorium nie zawiera obecnie projektu Capacitor/Android ani ustalonego application ID, dlatego Sprint nie generuje sztucznego katalogu `android/`. Model `notification_devices` obsługuje platformę `android` i provider `fcm`. `push_enabled` jest wyłącznie preferencją przygotowaną pod przyszły kanał Android Push; Sprint 5 nie dostarcza systemowych powiadomień FCM, a przełącznik w UI jest oznaczony jako „w przygotowaniu” i wyłączony.

Kolejny etap natywny powinien ustalić application ID, dodać kontener Capacitor, rejestrować token FCM zalogowanego użytkownika, wysyłać push z zaufanego backendu i przekazywać `source_type` oraz `source_id` do deep linku. Żaden sekret FCM ani Supabase service role nie może znaleźć się w aplikacji lub APK.

## Audyt

Tworzenie, zmiana i usuwanie przypomnienia zapisuje `reminder.created`, `reminder.updated` i `reminder.deleted`. Pierwsze oznaczenie powiadomienia jako przeczytanego zapisuje `notification.read`. Frontend nie dubluje audytu.
