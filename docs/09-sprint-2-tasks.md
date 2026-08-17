# Sprint 2 — Dashboard + Tasks

## Zakres

- tabela `public.tasks` z indeksami, walidacją i RLS,
- audyt tworzenia, aktualizacji, wykonania i usuwania zadań,
- feature-based frontend w `features/tasks`,
- zadania na dziś pobierane z Supabase,
- szybkie dodawanie z terminem, priorytetem i przypisaniem,
- wykonanie oraz cofnięcie wykonania,
- prawdziwe statystyki aktywnych zadań i terminów na dziś,
- loading, empty, error i disabled states,
- testy jednostkowe statystyk, filtrowania oraz uprawnień UI.

## Wdrożenie

1. Przejrzyj pełną treść `database/migrations/0003_tasks.sql`.
2. Po ręcznym zatwierdzeniu uruchom migrację w SQL Editor wybranego projektu Supabase.
3. Zweryfikuj w Supabase, że tabela ma włączone RLS i utworzone cztery policies.
4. Wdróż frontend dopiero po zastosowaniu migracji, aby zapytania PostgREST widziały relacje profili.

Migracja kończy się `NOTIFY pgrst, 'reload schema';`, ale nie jest automatycznie wykonywana przez aplikację ani proces builda.
