# Досрочка — Telegram-бот с Mini App

Калькулятор досрочного погашения кредита, который открывается прямо в Telegram.
Цифры пользователя хранятся в облаке Telegram (CloudStorage), а не на сервере.

- `docs/index.html` — само приложение (публикуется на GitHub Pages)
- `bot.py` — бот: кнопка меню и ответ на /start (только стандартная библиотека Python)
- `.env` — настройки и токен (в git не попадает)

## Приложение на GitHub Pages

1. Settings → Pages → Source: **Deploy from a branch**, Branch: **main**, папка **/docs**.
2. Через минуту приложение доступно по адресу `https://<логин>.github.io/<репозиторий>/`.
3. Впишите этот адрес в `.env` → `WEBAPP_URL=` и запустите `start.bat`.

Любой `git push` с изменениями в `docs/` обновляет приложение.

## Бот

Основной бот работает в облаке: https://dosrochka-bot.gitman678.workers.dev (см. раздел ниже).
`bot.py` / `start.bat` — локальный запасной вариант; при активном webhook он не запускается.

## Бот в облаке: Cloudflare Workers (напоминания, работа 24/7)

Код — `worker/worker.js`. Бот получает сообщения через webhook, хранит напоминания в KV
и каждый день в 09:00 МСК рассылает их по cron. ПК и `bot.py` после этого не нужны.

1. dash.cloudflare.com → **Workers & Pages → Create → Worker** → имя `dosrochka-bot` → Deploy.
2. **Edit code** → вставить содержимое `worker/worker.js` → Deploy.
3. **Storage & Databases → KV → Create** namespace `dosrochka`.
4. Worker → **Settings → Bindings → Add → KV namespace**: имя переменной `REMINDERS`, namespace `dosrochka`.
5. Worker → **Settings → Variables and Secrets**: секреты `BOT_TOKEN` и `WEBHOOK_SECRET` (значение из `.env`),
   по желанию переменная `ALLOWED_USER_IDS`.
6. Worker → **Settings → Triggers → Cron**: `0 6 * * *`.
7. Прописать адрес Worker в `docs/index.html` (`REMIND_API`) и поставить webhook:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<адрес Worker>/telegram&secret_token=<WEBHOOK_SECRET>`.

## Без хостинга (запасной вариант)

Если `WEBAPP_URL` пустой, бот раздаёт `docs/` с ПК через бесплатный туннель Cloudflare
(нужен `winget install --id Cloudflare.cloudflared`). Адрес туннеля меняется при каждом запуске.
