# Security Baseline

Projekt przyjmuje OWASP ASVS 5.0.0 jako główną bazę wymagań weryfikacyjnych oraz OWASP Top 10:2025 jako model najczęstszych klas ryzyka.

Dane finansowe mają podwyższony poziom ochrony. Dostęp otrzymują wyłącznie aktywni `owner`, `admin` i `adult`; rola `child` jest odrzucana przez RLS. Snapshotami wspólnych wydatków zarządza wyłącznie trigger bazy.

## Zasady
- Least privilege i deny-by-default.
- Supabase Auth zamiast własnego magazynu haseł.
- RLS na każdej tabeli dostępnej przez API.
- Tenant isolation przez `family_id` + zweryfikowane członkostwo.
- Brak klucza `service_role` po stronie przeglądarki.
- Sekrety tylko w środowisku serwerowym / panelu Vercel.
- Walidacja danych na granicach systemu.
- CSP i security headers.
- Audit log dla operacji administracyjnych i wrażliwych.
- MFA-ready dla owner/admin.
- Dependency scanning i automatyczne aktualizacje bezpieczeństwa.
- Prywatne buckety Storage + RLS.

## Zadania rodzinne
- `tasks` ma włączone RLS i domyślnie nie udostępnia nic roli `anon`.
- Odczyt wymaga aktywnego członkostwa w rodzinie zadania.
- Tworzenie jest ograniczone do aktywnych ról `owner`, `admin` i `adult`.
- Aktualizacja wymaga roli `owner`/`admin`, bycia twórcą albo osobą przypisaną.
- Usunięcie wymaga roli `owner`/`admin` albo bycia twórcą.
- `family_id` i `created_by` są niezmienne po utworzeniu; przypisany użytkownik musi być aktywnym członkiem tej samej rodziny.
- Frontend nie wysyła `created_by`. Baza ustawia go przez `auth.uid()`, grant INSERT nie obejmuje tej kolumny, a RLS ponownie sprawdza tożsamość.
- Klient korzysta wyłącznie z publishable key. Service role nie jest dostępne w przeglądarce.
- Trigger audytowy zapisuje `task.created`, `task.updated`, `task.completed` i `task.deleted` w `audit_logs`.

## Kalendarz rodzinny

- `calendar_events` ma RLS i nie jest dostępne dla `anon`.
- Każdy aktywny członek rodziny, w tym `child`, może czytać kalendarz swojej rodziny.
- Tworzyć mogą wyłącznie `owner`, `admin` i `adult`; `created_by` pochodzi z `auth.uid()`.
- Aktualizacja i usuwanie wymagają roli `owner`/`admin` albo bycia twórcą wydarzenia.
- Column grants wykluczają modyfikację `id`, `family_id`, `created_by`, `created_at` oraz `updated_at`.
- Prywatne funkcje triggerowe normalizują zapis i tworzą audyt bez przyznawania `authenticated` dostępu do schematu `private`.

## Lista zakupów

- `shopping_lists` i `shopping_items` mają RLS oraz brak dostępu `anon`.
- Composite FK `(list_id, family_id)` blokuje przypisanie produktu do listy innej rodziny.
- Listy tworzą role dorosłe; zarządzają nimi owner/admin/twórca.
- Każdy aktywny członek, w tym child, może dodać produkt i zmienić wyłącznie `is_purchased`.
- Trigger porównuje `OLD/NEW` i odrzuca zmianę danych produktu przez osobę niebędącą owner/admin/twórcą.
- `purchased_by` i `purchased_at` są poza grantami klienta i ustawia je wyłącznie trigger z `auth.uid()`.
- Audyt jest bazodanowy; frontend nie zapisuje `audit_logs`.

## Backup
Backup nie może przechowywać haseł użytkowników. Eksporty zawierające dane prywatne będą szyfrowane przed trwałym przechowaniem.
