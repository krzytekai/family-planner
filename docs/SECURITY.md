# Security

Główny baseline bezpieczeństwa projektu znajduje się w [`04-security.md`](04-security.md). Ten dokument opisuje praktyczne zasady dla bieżących funkcji aplikacji.

## Granica zaufania

- Przeglądarka otrzymuje wyłącznie `VITE_SUPABASE_URL` i `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Service role i `SUPABASE_SECRET_KEY` są zabronione w kodzie frontendu.
- Żądania klienta są niezaufane; autoryzację danych domenowych egzekwuje PostgreSQL RLS.

## Izolacja rodzin

Każdy rekord domenowy zawiera `family_id`. Dostęp wymaga aktywnego wpisu w `family_members`, sprawdzanego przez `is_family_member(...)` lub `has_family_role(...)`.

## Tasks

Polityki `public.tasks` realizują zasadę najmniejszych uprawnień:

- aktywny członek może czytać zadania wyłącznie własnej rodziny,
- dziecko nie może tworzyć zadań,
- twórca i osoba przypisana mogą aktualizować dozwolone kolumny zadania,
- tylko twórca lub `owner`/`admin` może usuwać zadanie,
- przypisanie użytkownika spoza rodziny jest odrzucane,
- klient nie ustala `created_by`; wartość pochodzi z uwierzytelnionej sesji przez `auth.uid()`.
- klient nie ustala `completed_at`; znacznik czasu wykonania nadaje i utrzymuje prywatna funkcja triggerowa bazy.

Grants i RLS działają razem: grants ograniczają dostępne operacje i kolumny, a policies ograniczają wiersze oraz wartości zapisu.

## Calendar events

`public.calendar_events` stosuje ten sam model izolacji rodziny. Aktywny członek może czytać, role `owner`/`admin`/`adult` mogą tworzyć, a aktualizacja i usunięcie wymagają roli `owner`/`admin` lub tożsamości twórcy. Dziecko nie może tworzyć wydarzeń ani zarządzać cudzymi.

Klient nie przesyła pól systemowych. `created_by` ustawia baza z `auth.uid()`, a `family_id` i `created_by` są dodatkowo chronione prywatnym triggerem przed zmianą. Operacje frontendowe korzystają wyłącznie z zalogowanego klienta Supabase; RLS pozostaje źródłem autoryzacji.
