# Backup i eksport danych

## Faza 1 — eksport lokalny

Owner i administrator aktywnej rodziny mogą utworzyć wersjonowaną kopię JSON albo eksport CSV wybranego zestawu tabelarycznego. Dane są pobierane przez `public.export_family_data(uuid,text[])`, które kontroluje rolę po stronie bazy i buduje dane biznesowe w jednym snapshotcie zapytania PostgreSQL.

Obsługiwane moduły: `family`, `members`, `tasks`, `calendar`, `shopping`, `budget`, `fixedCharges`, `reminders`. Podstawowy obiekt rodziny oraz manifest są zawsze obecne. Moduł niewybrany jest pominięty, a wybrany pusty zawiera puste tablice lub ustrukturyzowany pusty obiekt.

Rekordy modułów używają camelCase i zachowują UUID oraz relacje potrzebne do przyszłego kontrolowanego restore. `propertyCharges.budgetTransactionId` jest referencją do modułu Budżet; transakcja nie jest duplikowana. Jeżeli Budżet nie został wybrany, referencja nadal pozostaje w eksporcie i wskazuje dane poza jego zakresem.

Przypomnienia mają jawny `scope: current_user`. Eksport nie rozszerza uprawnień ownera/admina do prywatnych przypomnień innych osób.

Kopia nie zawiera e-maili, danych Auth, haseł, tokenów, urządzeń, powiadomień, sekretów push, Vault, administracji platformy ani logów audytowych. Sam eksport zapisuje wyłącznie zdarzenie `family.backup.exported` z formatem, wersją, nazwami modułów i licznikami.

Synchroniczny eksport ma limit 8 MiB liczony z reprezentacji UTF-8 JSON. Przekroczenie limitu kończy się jawnym błędem; dane nie są obcinane. `recordCounts` umożliwia kontrolę kompletności.

CSV jest dostępny dla zadań, wydarzeń, produktów zakupowych, transakcji budżetowych i wygenerowanych opłat. Pliki używają UTF-8 BOM, średnika, poprawnego cytowania oraz neutralizacji wartości zaczynających się od `=`, `+`, `-` lub `@`.

Web zapisuje plik przez tymczasowy Blob URL. Android zapisuje plik w prywatnym katalogu cache aplikacji i otwiera systemowy Share Sheet przez oficjalne pluginy Capacitor Filesystem i Share. Treść kopii nie trafia do localStorage ani sessionStorage.

## Przyszłe etapy

Niezaimplementowane pozostają: restore/import, mapowanie użytkowników między środowiskami Auth, cykliczne kopie, szyfrowane kopie w chmurze, historia backupów oraz asynchroniczny eksport do prywatnego Supabase Storage. Restore nie może zakładać, że źródłowy UUID użytkownika da się odtworzyć w innym środowisku; potrzebna będzie jawna warstwa mapowania członków.
