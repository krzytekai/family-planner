# Security

Główny baseline bezpieczeństwa projektu znajduje się w [`04-security.md`](04-security.md). Ten dokument opisuje praktyczne zasady dla bieżących funkcji aplikacji.

## Granica zaufania

- Przeglądarka otrzymuje wyłącznie `VITE_SUPABASE_URL` i `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Service role i `SUPABASE_SECRET_KEY` są zabronione w kodzie frontendu.
- Żądania klienta są niezaufane; autoryzację danych domenowych egzekwuje PostgreSQL RLS.

## Izolacja rodzin

Każdy rekord domenowy zawiera `family_id`. Dostęp wymaga aktywnego wpisu w `family_members`, sprawdzanego przez `is_family_member(...)` lub `has_family_role(...)`.

## Tasks

Polityki `public.tasks` realizują zasadę najmniejszych uprawnień:

- aktywny członek może czytać zadania wyłącznie własnej rodziny,
- dziecko nie może tworzyć zadań,
- twórca i osoba przypisana mogą aktualizować dozwolone kolumny zadania,
- tylko twórca lub `owner`/`admin` może usuwać zadanie,
- przypisanie użytkownika spoza rodziny jest odrzucane,
- klient nie ustala `created_by`; wartość pochodzi z uwierzytelnionej sesji przez `auth.uid()`.
- klient nie ustala `completed_at`; znacznik czasu wykonania nadaje i utrzymuje prywatna funkcja triggerowa bazy.
- klient nie może bezpośrednio ustawić `recurrence_series_id`, indeksu occurrence ani offsetu przypomnienia assignee,
- utworzenie i zmiana serii przechodzą przez wąskie RPC z `auth.uid()`, kontrolą roli, aktywnego członkostwa i zgodności `family_id`,
- przypomnienie dla assignee nie przyjmuje odbiorcy od klienta; backend odczytuje `tasks.assigned_to` i sprawdza aktywne członkostwo tej samej rodziny.

Grants i RLS działają razem: grants ograniczają dostępne operacje i kolumny, a policies ograniczają wiersze oraz wartości zapisu.

## Calendar events

`public.calendar_events` stosuje ten sam model izolacji rodziny. Aktywny członek może czytać, role `owner`/`admin`/`adult` mogą tworzyć, a aktualizacja i usunięcie wymagają roli `owner`/`admin` lub tożsamości twórcy. Dziecko nie może tworzyć wydarzeń ani zarządzać cudzymi.

Klient nie przesyła pól systemowych. `created_by` ustawia baza z `auth.uid()`, a `family_id` i `created_by` są dodatkowo chronione prywatnym triggerem przed zmianą. Operacje frontendowe korzystają wyłącznie z zalogowanego klienta Supabase; RLS pozostaje źródłem autoryzacji.

## Shopping

Każdy produkt ma zarówno `family_id`, jak i `list_id`, a composite FK wymusza ich zgodność z listą. Column grants blokują zmianę własności i pól systemowych po utworzeniu.

RLS pozwala każdemu aktywnemu członkowi aktualizować produkt, aby możliwy był wspólny checkbox. Prywatny trigger stanowi dodatkową granicę: dla osoby innej niż owner/admin/twórca porównuje dane z `OLD` i dopuszcza wyłącznie zmianę `is_purchased`. Metadane zakupu pochodzą z sesji bazy, nie z klienta.

## Notifications

- Użytkownik czyta i zmienia stan odczytu wyłącznie własnych powiadomień w aktywnej rodzinie.
- Przypomnienia są osobiste: odbiorca i twórca pochodzą z `auth.uid()`, nie z dowolnych pól klienta.
- Wyjątkiem są przypomnienia `task_assignee` tworzone przez `set_task_assignee_reminder`; odbiorcę zawsze wyznacza baza z `tasks.assigned_to`, a bezpośrednie granty do `reminder_kind`, offsetu i odbiorcy pozostają odebrane. Zarządzać nimi może owner/admin albo twórca taska — samo przypisanie, w tym przypisanie dziecka, nie daje tego prawa.
- Trigger sprawdza, czy źródłowe zadanie lub wydarzenie należy do tej samej rodziny; usunięcie źródła usuwa oczekujące przypomnienia.
- Tokeny urządzeń są widoczne i modyfikowalne tylko przez ich właściciela. Service role ani klucze FCM nie trafiają do przeglądarki.
- Funkcje generujące skrzynkę i audyt działają jako `SECURITY DEFINER`, mają pusty `search_path`, jawnie kwalifikowane obiekty i brak `EXECUTE` dla ról publicznych.

## Administracja rodzin i platformy

- Owner zarządza admin/adult/child; admin wyłącznie adult/child. Adult i child nie mają family-admin RPC.
- Trigger bazy blokuje rodzinę bez aktywnego ownera. Transfer ownership nie jest częścią 0012.
- Wybrany `family_id` w localStorage jest tylko preferencją UX; każdy odczyt i zapis nadal podlega membership oraz RLS.
- `platform_admins` nie jest rolą rodzinną. Tabela nie ma grantów dla klienta, a pierwszy superadmin jest nadawany ręcznie przez operatora po UUID profilu.
- Usunięcie członka kasuje tylko membership. Globalne usuwanie/blokowanie Auth pozostaje poza tym sprintem.

## Budget

RLS dopuszcza dane finansowe wyłącznie dla aktywnych ról `owner`, `admin` i `adult`. Child nie może wykonać SELECT ani mutacji tabel budżetowych. Owner/admin zarządza planem i uczestnikami; adult tworzy transakcje, edytuje własne i może zapisać settlement tylko jako jego strona. Tabela snapshotów nie ma grantów mutacji dla klienta.

## Nieruchomości i opłaty

- Moduł jest dostępny wyłącznie aktywnym rolom owner/admin/adult; child nie ma polityk SELECT ani zapisu.
- Wszystkie obiekty mają `family_id`, a composite FK odrzucają podmianę property, unit, definition, charge lub budget transaction z innej rodziny.
- Należności, reguły przypomnień, harmonogramy i linki budżetowe nie mają bezpośrednich grantów zapisu. Krytyczne operacje przechodzą przez narrow RPC z kontrolą roli i pustym `search_path`.
- Odbiorcą przypomnienia jest wyłącznie `auth.uid()` zapisujący definicję. Klient nie może ustawić backendowego `reminder_kind` ani offsetu na dowolnym reminderze.
- Płatność blokuje wiersz charge przed utworzeniem lub aktualizacją powiązanej transakcji, co chroni przed duplikacją przy retry.
- Archiwizacja i przywracanie wymagają aktywnej roli owner/admin/adult i przechodzą przez RPC. Trwałe usunięcie wymaga owner/admin, atomowo usuwa dane zależne nieruchomości i celowo zachowuje niezależne transakcje budżetowe.
