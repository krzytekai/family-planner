# Architecture

## Warstwy
UI → application/services → repositories → Supabase/PostgreSQL.

UI nie importuje bezpośrednio zapytań do Supabase. Pozwala to wymienić backend bez przepisywania komponentów.

## Feature tasks
Kod zadań znajduje się w `apps/web/src/features/tasks` i jest podzielony na:
- `api/task-repository.ts` — jedyne miejsce z zapytaniami Supabase,
- `hooks/useTasks.ts` — stan ładowania, zapisu, błędów i odświeżania,
- `components/` — szybkie dodawanie i lista zadań na dziś,
- `types.ts` oraz `task-utils.ts` — model domenowy i testowalna logika statystyk.

`App.tsx` składa dashboard z tych elementów, ale nie zawiera zapytań ani reguł domenowych tasków.

## Feature calendar

Kod kalendarza znajduje się w `apps/web/src/features/calendar`: repozytorium odpowiada wyłącznie za zapytania do `calendar_events`, hook zarządza widocznym zakresem i operacjami, komponenty budują miesiąc, agendę oraz modale, a `calendar-utils.ts` zawiera testowalną logikę dat i uprawnień. Hook korzysta z `task-repository.listTasksInRange`, dlatego zadania nie są kopiowane ani pobierane przez drugą implementację.

Frontendowy `CalendarItem` jest unią rozłączną `event | task`. Łączenie następuje wyłącznie w pamięci dla aktualnie widocznego zakresu siatki miesiąca.

## Multi-family
Każdy rekord domenowy związany z rodziną posiada `family_id`. Dostęp jest weryfikowany przez RLS na podstawie tabeli `family_members`.

## Audyt
Rekordy domenowe standardowo posiadają `created_by`, `updated_by`, `created_at`, `updated_at`.
Zdarzenia zadań są zapisywane przez trigger PostgreSQL, dlatego audyt obejmuje każdą dozwoloną ścieżkę zapisu, a nie tylko bieżący frontend.
Analogicznie zmiany `calendar_events` audytuje prywatna funkcja triggerowa bazy.
