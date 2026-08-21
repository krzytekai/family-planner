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
8. `0007_fix_due_reminders_processor.sql`
9. `0008_budget.sql`
10. `0009_fcm_push_delivery.sql`
11. `0010_push_dispatcher_cron.sql`
12. `0011_recurring_tasks.sql` (zastosowana ręcznie na produkcyjnym Supabase)
13. `0012_family_platform_administration.sql` (wdrożona produkcyjnie; post-migration verification: PASS)

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

### Zadania cykliczne (0011)

`task_recurrence_series` przechowuje stabilną definicję serii: ścisłą regułę JSONB, strefę IANA, termin kotwiczący i stan aktywności. Każde wystąpienie pozostaje zwykłym rekordem `tasks`; pola `recurrence_series_id`, `occurrence_index` oraz `generated_from_task_id` tworzą historię bez generowania wielu przyszłych zadań.

Trigger po przejściu `status != done → done` blokuje serię i tworzy co najwyżej jedno następne wystąpienie. Unikalności `(recurrence_series_id, occurrence_index)` i `generated_from_task_id` chronią również przed retry oraz równoległymi żądaniami. Daty są liczone w lokalnym kalendarzu strefy serii. Dzień 29/30/31 jest przycinany do końca krótszego miesiąca, ale reguła zachowuje dzień kotwiczący, więc kolejny dłuższy miesiąc wraca do pierwotnego dnia.

Logiczny `assignee_reminder_offset_minutes` należy do zadania. `reminder_kind` rozróżnia stare i nowe przypomnienia osobiste (`personal`, wartość domyślna) od backendowych przypomnień obowiązku (`task_assignee`). Dzięki temu oba rodzaje mogą istnieć dla jednego użytkownika i taska bez konfliktu unikalności. Konkretne rekordy `task_assignee` są tworzone przez kontrolowane RPC dla `assigned_to`, nigdy dla odbiorcy wskazanego dowolnie przez klienta. Następne occurrence dziedziczy offset i otrzymuje nowy rekord `pending` wyliczony od nowego `due_at`.

`recurrence_until` nie jest częścią 0011. Zakończenie serii odbywa się jawnie przez `recurrence_enabled=false` i `stopped_at`; ograniczenie datą zostanie dodane dopiero razem z pełnym RPC oraz UX.

### Administracja rodzin i platformy (0012)

Krytyczne mutacje `family_members` przechodzą przez `manage_family_member`, a constraint trigger wymusza co najmniej jednego aktywnego ownera. Usunięcie membership nie usuwa konta Auth. `create_additional_family` tworzy nowy tenant i ownera w jednej transakcji. `platform_admins` jest niezależne od `family_role`, nie ma zapisów klienckich ani automatycznego bootstrapu.

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

## Budget

`budget_transactions` przechowuje przychody i wydatki, `budget_plans` miesięczne limity, `budget_settlements` transfery wyrównujące, a `budget_settlement_members` bieżącą konfigurację. `budget_expense_participants` jest niezmiennym snapshotem składu konkretnego wspólnego wydatku i ma tenant-safe composite FK. `paid_by` wskazuje płatnika, a `created_by` autora wpisu.
