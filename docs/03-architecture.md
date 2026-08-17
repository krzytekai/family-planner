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

## Multi-family
Każdy rekord domenowy związany z rodziną posiada `family_id`. Dostęp jest weryfikowany przez RLS na podstawie tabeli `family_members`.

## Audyt
Rekordy domenowe standardowo posiadają `created_by`, `updated_by`, `created_at`, `updated_at`.
Zdarzenia zadań są zapisywane przez trigger PostgreSQL, dlatego audyt obejmuje każdą dozwoloną ścieżkę zapisu, a nie tylko bieżący frontend.
