# Sprint 3 — Kalendarz rodzinny

## Model danych

Migracja `0004_calendar_events.sql` dodaje `public.calendar_events`. Każdy rekord należy do rodziny, ma twórcę, typ i jeden z dwóch rozłącznych wariantów czasu:

- wydarzenie godzinowe: wymagane `starts_at` (`timestamptz`), opcjonalne `ends_at`,
- wydarzenie całodniowe: wymagane `start_date` (`date`), opcjonalne `end_date`.

Pola `date` nie są przeliczane na UTC, dzięki czemu wydarzenie całodniowe nie przesuwa się przy zmianie strefy. Wartości z `datetime-local` są przeliczane w przeglądarce na ISO/UTC i po odczycie formatowane w lokalnej strefie.

## RLS i uprawnienia

- SELECT: każdy aktywny członek własnej rodziny,
- INSERT: `owner`, `admin`, `adult`, z `created_by = auth.uid()`,
- UPDATE i DELETE: `owner`, `admin` albo twórca.

Grants kolumnowe nie pozwalają klientowi modyfikować pól systemowych. Prywatny trigger normalizuje tekst, aktualizuje `updated_at` i blokuje zmianę rodziny lub twórcy. Drugi prywatny trigger zapisuje audyt w `public.audit_logs`.

## Połączenie wydarzeń i zadań

Wydarzenia i zadania pozostają niezależnymi encjami. Dla widocznych 42 dni aplikacja równolegle pobiera:

- przecinające zakres rekordy `calendar_events`,
- rekordy `tasks` z `due_at` w zakresie.

Frontend tworzy unię `CalendarItem` i dopiero w pamięci grupuje wpisy według dnia. Wydarzenia wielodniowe pojawiają się w każdym dniu zakresu, bez duplikowania rekordów w bazie.

## CalendarView

Desktop pokazuje miesięczną siatkę od poniedziałku, sterowanie miesiącem, filtry i agendę wybranego dnia. Na telefonie siatka jest kompaktowa, a szczegóły pozostają w czytelnej agendzie pod nią. Wydarzenia i zadania mają odmienne oznaczenia; kliknięcie zadania prowadzi do modułu Zadania.

Centralny przycisk `+` jest kontekstowy: w kalendarzu otwiera formularz wydarzenia, a na Dashboardzie i w Zadaniach zachowuje szybkie dodawanie zadania. Dashboard wyświetla trzy najbliższe wydarzenia z odnośnikiem do kalendarza.

## Poza zakresem

Sprint nie dodaje cykliczności, przypomnień, powiadomień ani integracji z Google Calendar.
