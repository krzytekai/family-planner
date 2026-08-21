# Sprint 7.6.1 — cykl życia nieruchomości

Status: implementacja gotowa do review. Migracja `0014_property_lifecycle.sql` nie została uruchomiona.

## Archiwizacja

RPC `archive_property` ustawia nieruchomość jako nieaktywną, zawiesza wyłącznie aktywne definicje opłat i anuluje oczekujące przypomnienia. Należności, płatności, fired reminders i powiązania z Budżetem pozostają w historii.

RPC `restore_property` reaktywuje definicje zawieszone przez archiwizację i odtwarza przyszłe przypomnienia dla istniejących oczekujących należności. Kolejne wejście do modułu uruchamia idempotentny generator z unikalnością `(charge_definition_id,due_date)`.

## Trwałe usunięcie

RPC `delete_property_permanently` wymaga owner/admin i blokuje docelową nieruchomość w obrębie wskazanej rodziny. Atomowo usuwa zależne notifications, reminders, należności, definicje, harmonogramy, reguły i części. Powiązane `budget_transactions` pozostają niezależną historią finansową.

## Uprawnienia

- archive/restore: owner, admin, adult,
- permanent delete: owner, admin,
- child i anon: brak dostępu,
- każde RPC weryfikuje `family_id` i używa `SECURITY DEFINER` z pustym `search_path`.

## UI

Ustawienia rozdzielają widoki Aktywne/Zarchiwizowane. Techniczne identyfikatory kategorii, statusów, recurrence, amount mode i unit type są centralnie mapowane na polskie etykiety.
