# Planer rodzinny

**Designed & developed by Krzytek**

Rodzinne centrum organizacji budowane jako bezpieczna, modułowa aplikacja multi-family.

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
