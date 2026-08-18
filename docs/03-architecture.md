# Architecture

## Warstwy
UI → application/services → repositories → Supabase/PostgreSQL.

Moduł `features/budget` zachowuje podział feature-based: repository odpowiada za authenticated Supabase API, hook za spójny refetch po mutacji i focusie, komponenty za responsywny UX, a czyste utils za obliczenia w integer cents. PostgreSQL odpowiada za tenant isolation, snapshot uczestników i audyt.

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

## Feature shopping

`apps/web/src/features/shopping` dzieli moduł na repozytorium Supabase, hook stanu, testowalne utilities i komponenty widoku/modalów. `ShoppingView` pracuje na jednej wybranej liście, dzięki czemu produkty różnych list nie mieszają się. Dashboard używa lekkiego zapytania podglądowego zwracającego licznik i maksymalnie pięć niekupionych pozycji.

Centralny przycisk mobile wysyła do aktywnego feature wyłącznie sygnał otwarcia właściwego formularza. Logika zapisu i uprawnień pozostaje poza `App.tsx`.

## Multi-family
Każdy rekord domenowy związany z rodziną posiada `family_id`. Dostęp jest weryfikowany przez RLS na podstawie tabeli `family_members`.

## Audyt
Rekordy domenowe standardowo posiadają `created_by`, `updated_by`, `created_at`, `updated_at`.
Zdarzenia zadań są zapisywane przez trigger PostgreSQL, dlatego audyt obejmuje każdą dozwoloną ścieżkę zapisu, a nie tylko bieżący frontend.
Analogicznie zmiany `calendar_events` audytuje prywatna funkcja triggerowa bazy.
Listy i produkty zakupowe również są audytowane przez prywatne triggery, w tym osobne zdarzenia kupienia i cofnięcia kupienia.
