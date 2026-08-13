# Architecture

## Warstwy
UI → application/services → repositories → Supabase/PostgreSQL.

UI nie importuje bezpośrednio zapytań do Supabase. Pozwala to wymienić backend bez przepisywania komponentów.

## Multi-family
Każdy rekord domenowy związany z rodziną posiada `family_id`. Dostęp jest weryfikowany przez RLS na podstawie tabeli `family_members`.

## Audyt
Rekordy domenowe standardowo posiadają `created_by`, `updated_by`, `created_at`, `updated_at`.
