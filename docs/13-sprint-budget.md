# Sprint Budget — budżet rodzinny i rozliczenia

## Model

Transakcja rozróżnia `created_by` (kto wpisał rekord) od `paid_by` (kto faktycznie zapłacił). Formularz nowego wydatku ustawia `paid_by` na bieżącego użytkownika, ale pozwala wybrać innego aktywnego dorosłego. Baza ustawia `created_by` z `auth.uid()` i sprawdza rodzinę płatnika.

Owner/admin konfiguruje `budget_settlement_members`. Przy utworzeniu wspólnego wydatku trigger wykonuje snapshot do `budget_expense_participants`. Późniejsza zmiana konfiguracji nie zmienia historii. Koszt jest dzielony równo; `share_weight` pozostawia neutralne miejsce na przyszłe wagi.

## Saldo i pieniądze

Saldo osoby to: zapłacone kwoty minus udziały plus wysłane settlementy minus otrzymane settlementy. Dodatnie oznacza „do otrzymania”, ujemne „do zapłaty”. Settlement jest transferem, nie wydatkiem. Algorytm wierzycieli/dłużników działa dla 2–N osób.

Kwoty z `numeric(12,2)` są przeliczane na integer cents. Reszta dzielenia trafia deterministycznie według posortowanego `user_id`, dlatego suma udziałów i suma sald nie gubi grosza.

## Plan, bezpieczeństwo i mobile

Dashboard porównuje rzeczywiste wydatki z miesięcznym planem. „Saldo łączne” pobiera dane od początku, a widok miesięczny używa dat z wybranego okresu. RLS blokuje child i cross-tenant access. Widok 360–430 px używa kart, dolnego arkusza formularza i centralnego `+`; płatnik jest już wybrany. Kod jest gotowy do osadzenia w Capacitor.

Przyszłe rozszerzenia obejmują nierówne udziały, własne kategorie, cykliczność, import, OCR, wiele walut i cele oszczędnościowe; Sprint ich nie implementuje.
