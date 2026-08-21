# Sprint 7.5 — Family & Application Administration

Status: wdrożone produkcyjnie. Migracja `0012_family_platform_administration.sql` przeszła post-migration verification.

## Role rodzinne

Owner zarządza nazwą rodziny oraz rolami i statusem admin/adult/child. Admin może dodawać i zarządzać wyłącznie adult/child. Adult i child nie otrzymują administracyjnych RPC. Owner jest chroniony: 0012 nie implementuje transferu ownership, dlatego ownera nie można zdegradować, zablokować ani usunąć. Constraint trigger stanowi dodatkową ochronę ostatniego aktywnego ownera.

## Multi-family

Hook rodziny pobiera wszystkie aktywne membership użytkownika. Wybrana rodzina jest zapamiętywana per-user w localStorage, ale lista pochodzi z Supabase, a obcy identyfikator jest odrzucany przez fallback. Zmiana kontekstu przeładowuje hooki modułów przez `familyId`; urządzenie FCM pozostaje przypisane do użytkownika, natomiast preferencje powiadomień pozostają family-scoped. Owner/admin/adult mogą utworzyć kolejny tenant przez `create_additional_family`; child nie może.

## Usuwanie i konta Auth

`remove` usuwa wyłącznie wiersz `family_members`. Konto Auth, profil i członkostwa w innych rodzinach pozostają. Tworzenie nowego użytkownika nadal odbywa się backendowo przez Auth Admin API; przy błędzie profilu lub membership nowo utworzone konto jest usuwane jako cleanup. Hasła nie są zapisywane przez aplikację. Reset hasła pozostaje standardową funkcją Supabase Auth.

## Platform admin

`platform_admins` jest osobną, chronioną tabelą, a nie wartością `family_role`. Frontend sprawdza `is_platform_admin()`, ale granicą bezpieczeństwa pozostają funkcje SECURITY DEFINER. Panel pokazuje wyłącznie agregaty, rodziny i podstawowe dane profili; nie pokazuje haseł, tokenów, urządzeń ani sekretów. Globalne usuwanie lub blokowanie kont Auth pozostaje poza zakresem.

Pierwszego administratora platformy nadaje operator świadomym SQL po zweryfikowaniu UUID profilu; migracja nie zawiera emaila ani UUID:

```sql
insert into public.platform_admins(user_id, role, active, created_by)
values ('<ZWERYFIKOWANY_PROFILE_UUID>'::uuid, 'superadmin', true, '<ZWERYFIKOWANY_OPERATOR_UUID>'::uuid);
```

## Audyt i granice bezpieczeństwa

RPC zapisują `family.updated`, zdarzenia cyklu życia membership oraz działania platform admina. Bezpośrednie INSERT/UPDATE/DELETE `family_members` i wszystkie operacje na `platform_admins` pozostają odebrane rolom klienckim. Wszystkie funkcje z podniesionymi uprawnieniami używają `SET search_path = ''` i jawnie kwalifikowanych obiektów.
