# Database

## Migracje

Migracje są wykonywane kolejno i ręcznie zatwierdzane przed uruchomieniem na środowisku produkcyjnym:

1. `0000_foundation.sql`
2. `0001_auth_multifamily.sql`
3. `0002_family_members_profiles_relation.sql`
4. `0003_tasks.sql`

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
