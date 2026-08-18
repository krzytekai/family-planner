# Database

## Migracje

Migracje są wykonywane kolejno i ręcznie zatwierdzane przed uruchomieniem na środowisku produkcyjnym:

1. `0000_foundation.sql`
2. `0001_auth_multifamily.sql`
3. `0002_family_members_profiles_relation.sql`
4. `0003_tasks.sql`
5. `0004_calendar_events.sql`
6. `0005_shopping.sql`
7. `0006_notifications.sql`

Codex przygotowuje pliki migracji, ale nie uruchamia ich samodzielnie na produkcyjnym projekcie Supabase.

## Tasks

`public.tasks` należy zawsze do jednej rodziny przez `family_id`. Rekord przechowuje tytuł, opcjonalny opis, status, priorytet, osobę przypisaną, termin, twórcę i znaczniki czasu.

Dozwolone statusy:

- `todo`
- `in_progress`
- `done`

Dozwolone priorytety:

- `low`
- `normal`
- `high`

`assigned_to` i `created_by` wskazują na `public.profiles`, dzięki czemu PostgREST może osadzić oba profile. Zapytanie frontendu rozróżnia relacje przez nazwy `tasks_assigned_to_fkey` i `tasks_created_by_fkey`.

## Integralność zapisu

- `created_by` domyślnie przyjmuje `auth.uid()` i nie jest kolumną dostępną w grancie INSERT.
- `family_id` i `created_by` nie mogą zostać zmienione po utworzeniu zadania.
- `completed_at` jest zarządzane wyłącznie przez trigger bazy: klient nie ma grantu do tej kolumny, nie może podać własnej daty, a istniejąca data wykonania jest zachowywana przy zwykłej aktualizacji ukończonego zadania.
- Osoba przypisana musi mieć aktywne członkostwo w tej samej rodzinie.

## Audyt

Trigger `audit_task_change` zapisuje zdarzenia w `public.audit_logs`:

- utworzenie: `task.created`,
- zwykła aktualizacja lub cofnięcie wykonania: `task.updated`,
- przejście do `done`: `task.completed`,
- usunięcie: `task.deleted`.

Metadane audytu nie zawierają treści opisu zadania. Przechowują status, priorytet, przypisanie i termin.

## Calendar events

`public.calendar_events` przechowuje wyłącznie wydarzenia rodzinne. Wydarzenia godzinowe używają `starts_at`/`ends_at` typu `timestamptz`, a całodniowe `start_date`/`end_date` typu `date`. Constraint wymusza użycie dokładnie jednego wariantu oraz poprawną kolejność końca i początku.

Zadania z `due_at` nie są kopiowane do tej tabeli. Aplikacja pobiera oba źródła dla widocznego zakresu i łączy je w modelu `CalendarItem`.

Trigger audytowy zapisuje `calendar_event.created`, `calendar_event.updated` i `calendar_event.deleted`. Metadane obejmują typ, wariant całodniowy, daty i lokalizację, ale nie opis.

## Shopping

`public.shopping_lists` przechowuje wiele list jednej rodziny. `public.shopping_items` wskazuje listę przez composite FK `(list_id, family_id) → shopping_lists(id, family_id)`, więc nawet przy błędnym żądaniu produkt nie może przejść między tenantami.

`quantity` jest `numeric(10,3)` i, jeśli podane, musi być dodatnie. Kategorie i jednostki pozostają tekstowe, co pozwala później wprowadzić wartości użytkownika.

Pola `purchased_by` i `purchased_at` są zarządzane przez `private.prepare_shopping_item_write()`. Przejście do kupionego zapisuje bieżącego użytkownika i czas, cofnięcie je zeruje, a zwykła edycja kupionego produktu zachowuje oryginalne metadane.

## Notifications and reminders

`public.notifications` jest trwałą skrzynką odbiorczą użytkownika, a `public.reminders` przechowuje osobiste, oczekujące przypomnienia do zadań i wydarzeń. `notification_devices` stanowi bezpieczny rejestr tokenów FCM/Web Push na przyszłość, natomiast `notification_preferences` przechowuje ustawienia per użytkownik i rodzina.

Powiadomienie o przypisaniu zadania tworzy trigger bazy. Preferencja typu zdarzenia decyduje o utworzeniu kanonicznego `notification`; kanały `in_app_enabled` i `push_enabled` są rozdzielone. Terminy obsługuje wyłącznie `private.process_due_reminders(batch_size)`: funkcja wybiera rekordy `pending` z `FOR UPDATE SKIP LOCKED`, ponownie sprawdza aktywne członkostwo, deduplikuje wpis skrzynki i kończy przypomnienie jako `fired` albo `cancelled`. Funkcji nie udostępniono rolom `anon` ani `authenticated`; scheduler musi wywoływać ją w zaufanym kontekście bazy, np. co minutę przez Supabase Cron/pg_cron. Frontend nie używa timerów do dostarczania przypomnień.
