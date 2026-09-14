"""Досрочка: Telegram-бот с Mini App.

Если в .env указан WEBAPP_URL (например, адрес GitHub Pages), бот просто ставит
кнопку меню на этот адрес и отвечает на /start. Иначе при запуске:
  1. Раздаёт папку docs/ локально на http://127.0.0.1:PORT.
  2. Поднимает бесплатный HTTPS-туннель Cloudflare (trycloudflare.com) —
     Telegram открывает Mini App только по HTTPS.
  3. Ставит кнопку меню бота на адрес туннеля (адрес меняется при каждом запуске).
  4. Отвечает на /start кнопкой «Открыть Досрочку».

Зависимости: только стандартная библиотека Python 3.9+ и cloudflared.
"""

import json
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEBAPP_DIR = ROOT / "docs"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env(ROOT / ".env")

TOKEN = os.environ.get("BOT_TOKEN", "").strip()
PORT = int(os.environ.get("PORT", "8080"))
WEBAPP_URL = os.environ.get("WEBAPP_URL", "").strip()
ALLOWED_IDS = {
    int(x) for x in re.split(r"[,\s]+", os.environ.get("ALLOWED_USER_IDS", "")) if x.strip().isdigit()
}
BUTTON_TEXT = "Открыть Досрочку"
LUCK_TEXT = "🎰 Мне повезет?"
# Значение 🎰 от 1 до 64; три одинаковых символа выпадают на 1, 22, 43 и 64
SLOT_WINS = {1: "Три BAR", 22: "Три винограда", 43: "Три лимона", 64: "777"}
SLOT_LOSE = [
    "Не в этот раз. Не переживай — досрочка работает и без везения 😉",
    "Мимо, но не переживай: каждая доплата по кредиту — уже маленький выигрыш 💪",
    "Не переживай! Удача любит тех, кто гасит кредит по плану 📉",
]
SLOT_ANIMATION_SEC = 2.3
STATE = {"url": WEBAPP_URL, "proc": None}


def log(msg: str) -> None:
    print(time.strftime("[%H:%M:%S] ") + msg, flush=True)


# ---------- Telegram Bot API ----------

def api(method: str, http_timeout: int = 30, **params):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{TOKEN}/{method}",
        data=json.dumps(params).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=http_timeout) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as err:
        data = json.loads(err.read().decode("utf-8", "replace") or "{}")
    if not data.get("ok"):
        raise RuntimeError(f"{method}: {data.get('description', data)}")
    return data["result"]


def web_app_button(url: str) -> dict:
    return {"inline_keyboard": [[{"text": BUTTON_TEXT, "web_app": {"url": url}}]]}


def set_menu_button(url: str) -> None:
    menu = {"type": "web_app", "text": "Досрочка", "web_app": {"url": url}}
    if ALLOWED_IDS:
        for chat_id in ALLOWED_IDS:
            try:
                api("setChatMenuButton", chat_id=chat_id, menu_button=menu)
            except RuntimeError as err:
                log(f"Не удалось поставить кнопку для {chat_id}: {err} (напишите боту /start и перезапустите)")
    else:
        api("setChatMenuButton", menu_button=menu)
    api("setMyCommands", commands=[
        {"command": "start", "description": "Открыть Досрочку"},
        {"command": "luck", "description": "Мне повезет?"},
        {"command": "id", "description": "Показать мой Telegram ID"},
    ])


def luck_keyboard() -> dict:
    return {"keyboard": [[{"text": LUCK_TEXT}]], "resize_keyboard": True, "is_persistent": True}


def is_luck_request(text: str) -> bool:
    return text.replace("ё", "е").lower().strip(" ?!🎰") == "мне повезет"


def play_slots(chat_id: int) -> None:
    value = api("sendDice", chat_id=chat_id, emoji="🎰")["dice"]["value"]
    if value in SLOT_WINS:
        text = f"🎉 {SLOT_WINS[value]}! Поздравляю, сегодня твой день!"
    else:
        text = random.choice(SLOT_LOSE)

    def reply():  # ждём, пока барабаны докрутятся, чтобы не спойлерить результат
        try:
            api("sendMessage", chat_id=chat_id, text=text, reply_markup=luck_keyboard())
        except Exception as err:
            log(f"Не удалось отправить результат слотов: {err}")

    threading.Timer(SLOT_ANIMATION_SEC, reply).start()


def handle_message(msg: dict) -> None:
    chat_id = msg["chat"]["id"]
    user_id = msg.get("from", {}).get("id")
    text = (msg.get("text") or "").strip()
    command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""

    if command == "/id":
        api("sendMessage", chat_id=chat_id, text=f"Ваш Telegram ID: {user_id}")
        return
    if ALLOWED_IDS and user_id not in ALLOWED_IDS:
        api("sendMessage", chat_id=chat_id, text="Это личный бот.")
        return
    if command in ("/start", "/app"):
        url = STATE["url"]
        try:  # обновляем кнопку меню именно в этом чате, чтобы телефон не держал старый адрес
            api("setChatMenuButton", chat_id=chat_id,
                menu_button={"type": "web_app", "text": "Досрочка", "web_app": {"url": url}})
        except RuntimeError as err:
            log(f"Не удалось обновить кнопку меню в чате {chat_id}: {err}")
        api(
            "sendMessage",
            chat_id=chat_id,
            text="Досрочка — планировщик досрочного погашения кредита.\n"
                 "Нажмите кнопку ниже или «Досрочка» в меню слева от поля ввода.",
            reply_markup=web_app_button(url),
        )
        api("sendMessage", chat_id=chat_id, text="А ещё можно испытать удачу 👇", reply_markup=luck_keyboard())
    elif command == "/luck" or is_luck_request(text):
        play_slots(chat_id)
    else:
        api("sendMessage", chat_id=chat_id, text="Нажмите /start, чтобы открыть приложение.")


def poll() -> None:
    api("deleteWebhook", drop_pending_updates=False)
    offset = None
    log("Бот слушает сообщения. Остановить: Ctrl+C")
    while True:
        try:
            params = {"timeout": 50, "allowed_updates": ["message"]}
            if offset is not None:
                params["offset"] = offset
            for update in api("getUpdates", http_timeout=65, **params):
                offset = update["update_id"] + 1
                if "message" in update:
                    try:
                        handle_message(update["message"])
                    except Exception as err:  # одно сообщение не должно ронять бота
                        log(f"Ошибка обработки сообщения: {err}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as err:
            log(f"Нет связи с Telegram ({err}), повтор через 5 с")
            time.sleep(5)
        except RuntimeError as err:
            if "Conflict" in str(err):
                log("Бот уже запущен в другом окне — закройте лишнее окно. Повтор через 10 с")
                time.sleep(10)
            else:
                log(f"Ошибка Telegram: {err}, повтор через 5 с")
                time.sleep(5)


# ---------- Local web server ----------

class QuietHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def start_http() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), partial(QuietHandler, directory=str(WEBAPP_DIR)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"Mini App доступно локально: http://127.0.0.1:{PORT}")


# ---------- Cloudflare quick tunnel ----------

def find_cloudflared():
    found = shutil.which("cloudflared")
    if found:
        return found
    for candidate in (
        r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
        r"C:\Program Files\cloudflared\cloudflared.exe",
        str(ROOT / "cloudflared.exe"),
    ):
        if Path(candidate).exists():
            return candidate
    return None


class TunnelError(Exception):
    pass


def wait_until_reachable(url: str, seconds: int = 40) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=8) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


def start_tunnel():
    exe = find_cloudflared()
    if not exe:
        raise TunnelError(
            "Не найден cloudflared.\n"
            "Установите его командой:  winget install --id Cloudflare.cloudflared\n"
            "и перезапустите start.bat (возможно, после перезапуска терминала)."
        )
    proc = subprocess.Popen(
        [exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{PORT}"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )
    found = {}
    ready = threading.Event()

    def drain():
        for line in proc.stdout:
            match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if match and not ready.is_set():
                found["url"] = match.group(0)
                ready.set()
        ready.set()

    threading.Thread(target=drain, daemon=True).start()
    log("Поднимаю HTTPS-туннель Cloudflare…")
    if not ready.wait(60) or "url" not in found:
        proc.terminate()
        raise TunnelError("Туннель не запустился за 60 секунд. Проверьте интернет.")
    url = found["url"]
    if not wait_until_reachable(url):
        log("Адрес туннеля пока не открывается с этого ПК — возможно, DNS ещё обновляется.")
    return url, proc


def bring_up_tunnel() -> None:
    url, proc = start_tunnel()
    STATE["url"], STATE["proc"] = url, proc
    log(f"Публичный адрес Mini App: {url}")
    set_menu_button(url)
    log("Кнопка меню бота обновлена" + (f" для {len(ALLOWED_IDS)} пользоват." if ALLOWED_IDS else " для всех"))


def tunnel_watchdog() -> None:
    """Если туннель упал — поднимаем новый и переставляем кнопку меню."""
    fails, seen_ok = 0, False
    while True:
        time.sleep(15)
        proc, url = STATE["proc"], STATE["url"]
        dead = proc is not None and proc.poll() is not None
        if not dead and url:
            if wait_until_reachable(url, seconds=10):
                fails, seen_ok = 0, True
            elif seen_ok:  # считаем сбои, только если адрес уже хоть раз открывался с этого ПК
                fails += 1
            dead = fails >= 3
        if not dead:
            continue
        log("Туннель перестал отвечать — перезапускаю…")
        if proc and proc.poll() is None:
            proc.terminate()
        try:
            bring_up_tunnel()
            fails, seen_ok = 0, False
            log("Туннель восстановлен. В чате с ботом нажмите /start, чтобы получить новую кнопку.")
        except (TunnelError, RuntimeError, OSError) as err:
            log(f"Не удалось перезапустить туннель: {err}. Повтор через 15 с")


def main() -> None:
    if not TOKEN:
        sys.exit("В файле .env не указан BOT_TOKEN. Откройте .env и впишите токен от @BotFather.")
    if not (WEBAPP_DIR / "index.html").exists():
        sys.exit(f"Не найден {WEBAPP_DIR / 'index.html'}")

    me = api("getMe")
    log(f"Бот: @{me['username']}")

    if not WEBAPP_URL:
        start_http()
    if WEBAPP_URL:
        log(f"Публичный адрес Mini App: {WEBAPP_URL}")
        set_menu_button(WEBAPP_URL)
    else:
        try:
            bring_up_tunnel()
        except TunnelError as err:
            sys.exit(str(err))
        threading.Thread(target=tunnel_watchdog, daemon=True).start()
    if not ALLOWED_IDS:
        log("Совет: напишите боту /id и впишите свой ID в ALLOWED_USER_IDS в .env, чтобы бот был только вашим.")

    try:
        poll()
    except KeyboardInterrupt:
        log("Остановка…")
    finally:
        if STATE["proc"]:
            STATE["proc"].terminate()


if __name__ == "__main__":
    main()
