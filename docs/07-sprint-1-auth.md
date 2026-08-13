# Sprint 1 — Auth, multi-family i administracja

## Zakres
- Supabase Auth: logowanie e-mail/hasło.
- Brak publicznej rejestracji w UI.
- Multi-family przez `families` + `family_members`.
- Role: owner, admin, adult, child.
- Status członkostwa: active / blocked.
- RLS na tabelach domenowych Sprintu 1.
- Serwerowa funkcja Vercel `/api/admin/users` do operacji administracyjnych.
- Audit log dla tworzenia użytkowników i pierwszej rodziny.

## Sekrety
Frontend dostaje wyłącznie `VITE_SUPABASE_URL` oraz `VITE_SUPABASE_PUBLISHABLE_KEY`.
`SUPABASE_SECRET_KEY` istnieje wyłącznie w środowisku serwerowym Vercela i nigdy nie może mieć prefiksu `VITE_`.

## Pierwsze uruchomienie
1. Utwórz projekt Supabase.
2. Uruchom `database/migrations/0001_auth_multifamily.sql` w SQL Editor.
3. Wyłącz publiczne sign-upy, jeżeli mają być dostępne tylko konta tworzone przez administratora.
4. W Supabase Auth utwórz ręcznie pierwsze konto właściciela.
5. Ustaw zmienne środowiskowe w Vercel i wykonaj nowy deployment.
6. Zaloguj się. Aplikacja zaproponuje jednorazowe utworzenie pierwszej rodziny.
7. W panelu Administracja dodawaj kolejnych członków.
