# Planer rodzinny

**Designed & developed by Krzytek**

Rodzinne centrum organizacji budowane jako bezpieczna, modułowa aplikacja multi-family.

Moduły obejmują zadania, kalendarz, zakupy, powiadomienia oraz budżet rodzinny z rozliczaniem wspólnych wydatków. Budżet rozróżnia autora wpisu od faktycznego płatnika i zachowuje historyczne snapshoty uczestników.

## Sprint 0 — Foundation

Aktualny zakres:
- React + TypeScript + Vite
- Tailwind CSS 4
- responsywny dashboard desktop/mobile
- struktura feature-based
- przygotowanie pod Supabase Auth/PostgreSQL/RLS
- nagłówki bezpieczeństwa dla Vercel
- dokumentacja architektury, bezpieczeństwa i roadmapy
- CI na GitHub Actions

## Wymagania

- Node.js 22.12+ (zalecane)
- pnpm 10+

## Uruchomienie

```bash
pnpm install
pnpm dev
```

Aplikacja: `http://localhost:5173`

## Build

```bash
pnpm build
```

## Sprint 1 — konfiguracja Supabase
Aktualna paczka zawiera logowanie, multi-family, role i panel administratora. Instrukcja: `docs/07-sprint-1-auth.md`.

## Sprint 2 — Dashboard + Tasks

Dashboard korzysta z prawdziwych zadań Supabase, szybkiego dodawania i zmiany statusu. Osobny ekran „Zadania” udostępnia wszystkie zadania rodziny, grupowanie statusów i filtry. Przed uruchomieniem tej wersji ręcznie przejrzyj i zastosuj `database/migrations/0003_tasks.sql`. Szczegóły: `docs/09-sprint-2-tasks.md`.

## Sprint 3 — Kalendarz rodzinny

Widok miesiąca łączy wydarzenia z `calendar_events` z terminami istniejących zadań bez kopiowania danych. Obsługuje wydarzenia godzinowe, całodniowe i wielodniowe, agendę dnia, filtry oraz uprawnienia zgodne z RLS. Migracja `database/migrations/0004_calendar_events.sql` wymaga ręcznego review i wdrożenia. Szczegóły: `docs/10-sprint-3-calendar.md`.

## Sprint 4 — Lista zakupów

Moduł obsługuje wiele rodzinnych list, produkty, ilości, kategorie, oznaczanie jako kupione, archiwizację i bezpieczne uprawnienia dla wszystkich ról. Migracja `database/migrations/0005_shopping.sql` wymaga ręcznego review i wdrożenia. Szczegóły: `docs/11-sprint-4-shopping.md`.
