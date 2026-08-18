# Sprint 4 — Lista zakupów

## Model

`shopping_lists` reprezentuje wiele nazwanych list jednej rodziny. Lista może być aktywna albo zarchiwizowana. `shopping_items` przechowuje nazwę, dodatnią ilość dziesiętną, jednostkę, tekstową kategorię, notatkę i status kupienia.

Relacja `(list_id, family_id) → shopping_lists(id, family_id)` jest composite FK z `ON DELETE CASCADE`. Produkt nie może wskazywać listy innego tenanta, a usunięcie listy usuwa jej produkty.

## Role i RLS

- każdy aktywny członek czyta listy i produkty,
- owner/admin/adult tworzą listy,
- owner/admin/twórca zarządzają listą,
- każdy członek, w tym child, dodaje produkt i zmienia jego status kupienia,
- owner/admin/twórca edytują i usuwają produkt.

RLS dopuszcza wspólną aktualizację produktu, ale `private.prepare_shopping_item_write()` porównuje `OLD/NEW`. Użytkownik bez pełnego prawa może zmienić tylko `is_purchased`; próba zmiany nazwy, ilości, jednostki, kategorii lub notatki kończy się wyjątkiem.

## Metadane zakupu

Frontend wysyła wyłącznie `is_purchased`. Trigger bazy ustawia `purchased_by = auth.uid()` oraz `purchased_at = now()`, zeruje je przy cofnięciu i zachowuje przy innych aktualizacjach kupionego produktu. Kolumny te nie są objęte grantami INSERT/UPDATE.

## Audyt

Prywatne funkcje `SECURITY DEFINER` zapisują zdarzenia list i produktów do `audit_logs`. Zmiana statusu tworzy dokładnie jedno zdarzenie `shopping_item.purchased` albo `shopping_item.unpurchased`.

## Frontend i mobile

`ShoppingView` pokazuje selektor list, liczniki, filtry, sekcje „Do kupienia” i „Kupione” oraz modale CRUD. Archiwalne listy są ukryte domyślnie. Centralny `+` dodaje produkt do wybranej listy, a przy braku listy otwiera tworzenie pierwszej listy dla roli dorosłej.

Dashboard pokazuje liczbę niekupionych produktów z aktywnych list oraz maksymalnie pięć pozycji. Duży przycisk statusu produktu ma spinner, blokadę wielokliku i etykietę `aria-label`.
