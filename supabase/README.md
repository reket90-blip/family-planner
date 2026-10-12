# Supabase setup — Family Planner

Используется отдельный проект Family Planner. Базу My Garage не использовать.

## Security model

- В браузере только publishable key; никогда не добавлять service-role key или VAPID private key во frontend/GitHub.
- Все пользовательские таблицы защищены RLS и приватным allowlist; без приглашения аккаунт не может читать или менять записи.
- В Supabase Authentication отключить **Allow new users to sign up** и создать только аккаунт жены.
- В репозитории пока нет реальных записей; репозиторий рекомендуется сделать приватным перед производственным использованием.

## Database

Выполните `schema.sql` в SQL Editor проекта. Он создаёт таблицы, индексы, триггеры, push-подписки, лог доставки, функции расчёта напоминаний и политики RLS.

В уже развёрнутом проекте миграции применены. Для нового проекта проверьте наличие `pg_cron`, `pg_net` и Vault.

## Server-side secrets

Три значения хранятся в Supabase Vault под именами:
- `family-planner-vapid-public`
- `family-planner-vapid-private`
- `family-planner-cron-secret`

Не копируйте секреты в frontend, GitHub, тикеты или логи. Edge Function `push-notifications` читает конфигурацию через RPC, доступный только роли `service_role`.

## Scheduled job

В рабочем проекте создан cron `family-planner-push-reminders` с расписанием `* * * * *`. Он вызывает Edge Function `push-notifications` с действием `send-due`; секрет авторизации берётся из Vault. Для нового проекта при настройке расписания используйте project ref и publishable/anon key именно этого проекта.

## Account setup

1. Authentication → Settings: отключить публичную регистрацию.
2. Authentication → Users: пригласить только одну учётную запись.
3. Authentication → URL Configuration: установить URL сайта планера и добавить точный URL в Redirect URLs.
4. Войти в планер с приглашённой учётной записью.
5. В Настройки → Push-уведомления нажать «Включить уведомления».
6. На iPhone открыть сайт в Safari, выбрать «Поделиться» → «На экран Домой», затем открыть с иконки. Push доступен для установленных веб-приложений на iOS/iPadOS 16.4+.

## Privacy and testing

Push на заблокированном экране показывает название события. Не добавляйте чувствительные подробности в заголовок события, если они не должны отображаться на экране блокировки. Перед реальным использованием проверьте доставку тестовым событием на 2–3 минуты вперёд.
