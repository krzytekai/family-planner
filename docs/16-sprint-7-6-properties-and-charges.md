# Sprint 7.6 — Nieruchomości i opłaty

Status: Sprint 7.6 zakończony. Migracja `0013_properties_and_charges.sql` została wdrożona produkcyjnie i przeszła post-migration verification.

## Model

Hierarchia to rodzina → nieruchomość → opcjonalna część → definicja opłaty → konkretna należność. Nazwy nieruchomości, części i opłat są dowolne; kategorie służą wyłącznie raportowaniu. Kwoty mają format `numeric(12,2)` zgodny z Budżetem.

Definicje wspierają opłatę jednorazową, miesięczną, co X miesięcy, roczną i zestaw konkretnych dat w roku. `amount_mode` rozróżnia kwotę stałą, zmienną i opcjonalną.

## Generacja i historia

Frontend wywołuje `ensure_property_charges(family_id,range_start,range_end)` dla wybranego roku. Zakres nie może przekroczyć 400 dni. Generator nie wymaga nowego Crona, a unikalność cyklu i `ON CONFLICT DO NOTHING` zabezpieczają retry. Opłacone oraz anulowane occurrence pozostają w historii. „Po terminie” jest wyliczane z `pending + due_date < today`.

## Przypomnienia

W Sprint 7.6 reguły są osobiste: odbiorcą jest twórca definicji pobrany z `auth.uid()`. Presety to 7 i 2 dni przed, dzień terminu oraz dzień po, ale baza obsługuje offset od -30 do 365 dni. Model pozwala później dodać bezpieczny wybór innych dorosłych odbiorców.

Occurrence tworzy backendowy reminder rodzaju `property_charge`. Procesor due reminders używa istniejącego notification/outbox/FCM pipeline. Opłacenie albo anulowanie należności anuluje tylko jej przyszłe rekordy pending; fired reminders pozostają historią. Push dispatcher, Vault, Cron i pg_net nie są zmieniane.

## Budżet

Definicja wybiera tryb ręczny albo automatyczny. Przy płatności użytkownik może również jednorazowo zaznaczyć synchronizację. `pay_property_charge` blokuje charge, tworzy najwyżej jedną transakcję expense i zapisuje `budget_transaction_id`. Kolejna edycja płatności aktualizuje kwotę, datę, płatnika i opis istniejącej transakcji.

## Uprawnienia i multi-family

Owner, admin i adult mogą zarządzać modułem oraz oznaczać płatności. Child nie ma dostępu. Każda tabela jest family-scoped, RLS korzysta z aktywnej roli, a composite FK wymuszają zgodność tenantów. Zmiana aktywnej rodziny montuje hook z nowym `familyId` i pobiera osobne dane.

## UX

Moduł zawiera Pulpit, Opłaty, Do zapłaty, Tabelę roku, Historię i Ustawienia. Tabela roku zachowuje układ arkusza, ma poziomy scroll oraz sticky pierwszą kolumnę na mobile. Formularze nie pokazują użytkownikowi JSON recurrence.
