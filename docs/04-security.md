# Security Baseline

Projekt przyjmuje OWASP ASVS 5.0.0 jako główną bazę wymagań weryfikacyjnych oraz OWASP Top 10:2025 jako model najczęstszych klas ryzyka.

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

## Backup
Backup nie może przechowywać haseł użytkowników. Eksporty zawierające dane prywatne będą szyfrowane przed trwałym przechowaniem.
