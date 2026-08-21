# Sprint 7 — zadania cykliczne i obowiązki rodzinne

Status: Sprint 7 zakończony. Migracja `0011_recurring_tasks.sql` została ręcznie zastosowana na produkcyjnym Supabase i zweryfikowana testem funkcjonalnym.

## Model

Seria jest osobnym rekordem `task_recurrence_series`. W tabeli `tasks` istnieje tylko bieżące wystąpienie oraz historia ukończonych wystąpień. Po ukończeniu backend tworzy dokładnie jeden kolejny task. Historia łączy się przez stabilne `recurrence_series_id`, rosnący `occurrence_index` i `generated_from_task_id`.

Reguły obejmują dni, tygodnie z wybranymi dniami, miesiące i lata oraz interwał `1..1000`. JSONB odrzuca brakujące, nadmiarowe i niepoprawne pola. Obliczenia używają nazwanej strefy IANA i lokalnego czasu kotwicy, dlatego godzina pozostaje stała przez DST.

## Przypomnienia assignee

Formularz może zapisać offset 10/30/60/180/1440 minut lub wartość niestandardową. RPC nie przyjmuje `recipient_user_id`: pobiera odbiorcę z aktywnego `assigned_to`. Zmiana assignee przenosi oczekujące przypomnienie, usunięcie assignee je anuluje, a zmiana terminu przelicza czas z zachowaniem offsetu.

`reminder_kind` ma wartości `personal` i `task_assignee`. Istniejące rekordy otrzymują bezpieczny default `personal`, a unikalność zawiera rodzaj reminderu, więc obie intencje mogą współistnieć. Nowe occurrence dziedziczy konfigurację offsetu i tworzy własny reminder `task_assignee`. Rekordy `fired` i `cancelled` nie są kopiowane. Jeden completion trigger najpierw tworzy następne occurrence wraz z reminderem, a następnie anuluje wyłącznie stary reminder `task_assignee`. Standardowy processor nadal respektuje `task_reminders_enabled`, a istniejący FCM outbox rozsyła kanoniczne powiadomienie na aktywne urządzenia odbiorcy.

Każde wygenerowane occurrence celowo uruchamia `task_assigned`, również gdy poprzednie occurrence wykonał sam assignee. `recurrence_until` pozostaje poza 0011; obecny UX obsługuje jawne zakończenie serii.

## Bezpieczeństwo i audyt

Bezpośrednie zapisy pól serii i przypomnień backendowych nie są przyznane `authenticated`. RPC oraz triggery mają pusty `search_path`, jawne revoke/grant i sprawdzają rodzinę, rolę oraz aktywne członkostwo. Audyt obejmuje rozpoczęcie, zmianę i zatrzymanie serii, wygenerowanie occurrence oraz utworzenie, zmianę i anulowanie reminderu assignee.
