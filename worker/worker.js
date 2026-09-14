// Досрочка — Telegram-бот на Cloudflare Workers.
// Отвечает на сообщения через webhook, хранит напоминания в KV и раз в день рассылает их по cron.
// Мини-игры с прогнозом (кегли/баскетбол/футбол) используют инлайн-кнопки — для них webhook
// должен быть подписан не только на "message", но и на "callback_query" (setWebhook →
// allowed_updates), иначе Telegram не станет присылать нажатия этих кнопок.
//
// Нужные настройки Worker:
//   Secrets:   BOT_TOKEN, WEBHOOK_SECRET
//   Variables: ALLOWED_USER_IDS (необязательно, через запятую)
//   KV:        REMINDERS
//   Cron:      0 6 * * *   (09:00 по Москве)

const APP_URL = 'https://fallienstar.github.io/dosrochka/';
const ALLOWED_ORIGINS = ['https://fallienstar.github.io'];
const MSK_OFFSET_MS = 3 * 3600 * 1000;

const LUCK_TEXT = '🍀 Мне повезет?'; // старая кнопка, оставлена только для совместимости со старой клавиатурой
const REMIND_TEXT = '🔔 Мои напоминания';
const OPEN_TEXT = 'Открыть Досрочку';
const START_TEXT = '🔄 Старт';
const GAMES_TEXT = '🎮 Мини-игры';
const SLOTS_TEXT = '🎰 Слоты';
const LINK_TEXT = '🔗 Ссылка на приложение';
const BACK_TEXT = '⬅️ Назад';
const SLOT_WINS = new Set([1, 22, 43, 64]); // три одинаковых символа в 🎰
const WIN_TEXT = 'Поздравляю, сегодня твой день!';
const SLOT_ANIMATION_MS = 2300;
const SLOT_LOSE = [
  'Не в этот раз. Не переживай — досрочка работает и без везения 😉',
  'Мимо, но не переживай: каждая доплата по кредиту — уже маленький выигрыш 💪',
  'Не переживай! Удача любит тех, кто гасит кредит по плану 📉',
  'Барабаны не сошлись, зато ты сходишься с планом. Это важнее 📅',
  'Не повезло в слотах — повезёт в жизни. Ты уже на правильном пути 🛤',
  'Удача — дело случая, а закрытый кредит — дело привычки. Ты справишься 💼',
  'Каждый месяц без новых долгов — вот настоящий джекпот 🏆',
  'Не переживай: проценты сегодня тоже не выиграли, ты их урезаешь 😎',
  'Мимо! Но помни: 1000 ₽ досрочки надёжнее любых трёх семёрок 🎯',
  'Сегодня не твой спин, но точно твой день. Держи курс 🧭',
  'Слоты крутятся случайно, а твой долг уменьшается по плану. Кто круче? Ты 💪',
  'Не расстраивайся — у банка шансов против твоей дисциплины ещё меньше 😉',
  'Проигрыш в слотах ничего не стоит. А вот каждая досрочка приносит экономию 💸',
  'Маленькие шаги каждый месяц — и однажды последний платёж. Ты ближе, чем кажется 🚶',
  'Удача отдыхает, а ты работаешь на свою свободу от долгов. Уважение 🙌',
  'Не выпало? Ничего страшного. Главное, что выпадает из графика — лишние месяцы 📆',
  'Спокойно: настоящий выигрыш — день, когда пишешь «кредит закрыт» ✅',
  'Не твой спин — не твоя проблема. Твоя задача — план, и ты с ней справляешься 📋',
  'Даже без трёх семёрок ты становишься богаче с каждым платежом 📈',
  'Не переживай! Лучшая ставка — на себя, и она уже работает 🔥',
  'Сегодня мимо, завтра повезёт. А кредит тем временем становится меньше 📉',
  'Это не проигрыш — просто удача отложена на что-то покрупнее 🍀',
  'Не вышло? Выпей чаю, посмотри на график долга — он идёт вниз ☕',
  'Удача капризная, а цифры честные: каждая доплата работает на тебя 🔢',
  'Не повезло? Зато ты знаешь точную дату, когда станешь свободным. Это сила 🗓',
  'Секрет успеха не в везении, а в том, чтобы не сдаваться. Продолжай 🚀',
  'Мимо, но ты молодец уже потому, что держишь финансы под контролем 🧠',
  'Барабаны сегодня ленятся. А ты — нет. Так держать 💥',
  'Не переживай: у тех, кто гасит досрочно, удача рано или поздно догоняет 🏃',
  'Три одинаковых не выпало, зато у тебя один чёткий план. Этого достаточно 🎯',
  'Ни одной семёрки? Зато минус проценты каждый месяц. Хороший размен 🤝',
  'Не твой раунд. Но игра «закрыть кредит» идёт в твою пользу 🕹',
  'Удача не пришла — значит, придёт вовремя. А пока — ещё один шаг к нулю 0️⃣',
  'Каждый рубль досрочки — это рубль, который не достанется процентам 🛡',
  'Не расстраивайся: самые крупные выигрыши собираются из маленьких решений 🧱',
  'Мимо! Но финансовая свобода не разыгрывается в слотах — её строят. Ты строишь 🏗',
  'Сегодня без джекпота, но с планом. Это лучше, чем наоборот 😉',
  'Проигрыш? Нет. Тренировка терпения — а оно тебе пригодится до последнего платежа 🧘',
  'Не переживай! Решение гасить кредит быстрее — уже выигрыш 🥇',
  'Удача любит настойчивых. Крути ещё — и не забудь про досрочку 15 числа 🔁',
];

const DESKTOP_TEXT = `🖥 Ссылка на приложение — работает и в обычном браузере на компьютере, не только в Telegram:\n${APP_URL}`;
const APP_LINK_TEXT = `🔗 Прямая ссылка на приложение — открывается и в Telegram, и в обычном браузере:\n${APP_URL}`;

// Игры с прогнозом: сначала спрашиваем «попадёт или нет», потом крутим настоящий Telegram-дайс
// и сравниваем результат с прогнозом. Монетка — без дайса, просто честный рандом 50/50.
const GAMES = {
  coin: {
    key: 'coin',
    label: '🪙 Монетка',
    ask: 'Загадай: орёл или решка?',
    options: [
      ['heads', '🦅 Орёл'],
      ['tails', '🪙 Решка'],
    ],
  },
  bowling: {
    key: 'bowling',
    label: '🎳 Кегли',
    ask: 'Собьёшь все кегли одним броском?',
    options: [
      ['yes', '✅ Собью все'],
      ['no', '❌ Не все'],
    ],
    dice: '🎳',
    isSuccess: (v) => v === 6,
    successText: 'Страйк! Все кегли сбиты 🎳💥',
    failText: 'Часть кеглей осталась стоять.',
  },
  basket: {
    key: 'basket',
    label: '🏀 Баскетбол',
    ask: 'Как думаешь, попадёшь в кольцо?',
    options: [
      ['yes', '✅ Попаду'],
      ['no', '❌ Мимо'],
    ],
    dice: '🏀',
    isSuccess: (v) => v >= 4,
    successText: 'Мяч точно влетел в кольцо! 🏀',
    failText: 'Мяч пролетел мимо кольца.',
  },
  football: {
    key: 'football',
    label: '⚽ Футбол',
    ask: 'Забьёшь гол?',
    options: [
      ['yes', '✅ Забью'],
      ['no', '❌ Мимо'],
    ],
    dice: '⚽',
    isSuccess: (v) => v >= 4,
    successText: 'Гол! ⚽️🥅',
    failText: 'Мимо ворот.',
  },
};
const GAME_ANIMATION_MS = 2500;

const DISCLAIMER =
  'Досрочка — калькулятор для самостоятельных расчётов, а не финансовая или юридическая консультация. ' +
  'Суммы и даты приблизительные: сверяйтесь с графиком платежей и договором.';

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// ---------- helpers ----------

const rub = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';

async function tg(env, method, params) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const err = new Error(`${method}: ${data.description || res.status}`);
    err.code = data.error_code;
    throw err;
  }
  return data.result;
}

function isAllowed(env, userId) {
  const ids = String(env.ALLOWED_USER_IDS || '').split(/[,\s]+/).filter(Boolean);
  return !ids.length || ids.includes(String(userId));
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  if (!ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// Проверка подписи initData из Mini App: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
async function hmac(key, data) {
  const raw = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data)));
}
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function verifyInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = await hmac('WebAppData', botToken);
  if (toHex(await hmac(secret, checkString)) !== hash) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > 86400) return null;
  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

// Закрепляем прямую ссылку на приложение — Mini App внутри Telegram Desktop открывается
// небольшим окном, а по этой ссылке страница открывается полноразмерной в обычном браузере.
// Пин только один раз на чат, чтобы /start не плодил его заново при каждом запуске.
async function pinDesktopLink(env, chatId) {
  const key = `pinned:${chatId}`;
  if (await env.REMINDERS.get(key)) return;
  const msg = await tg(env, 'sendMessage', { chat_id: chatId, text: DESKTOP_TEXT });
  await tg(env, 'pinChatMessage', { chat_id: chatId, message_id: msg.message_id, disable_notification: true });
  await env.REMINDERS.put(key, '1');
}

// ---------- бот ----------

// Постоянная клавиатура под полем ввода — чтобы не набирать команды руками.
// Кнопка «Открыть Досрочку» открывает Mini App одним тапом, без /start и без бокового меню.
const mainKeyboard = () => ({
  keyboard: [
    [{ text: OPEN_TEXT, web_app: { url: APP_URL } }],
    [{ text: GAMES_TEXT }, { text: REMIND_TEXT }],
    [{ text: LINK_TEXT }, { text: START_TEXT }],
  ],
  resize_keyboard: true,
  is_persistent: true,
});

const gamesKeyboard = () => ({
  keyboard: [
    [{ text: SLOTS_TEXT }, { text: GAMES.coin.label }],
    [{ text: GAMES.bowling.label }, { text: GAMES.basket.label }],
    [{ text: GAMES.football.label }],
    [{ text: BACK_TEXT }],
  ],
  resize_keyboard: true,
  is_persistent: true,
});

// Клавиатура-вопрос под конкретную игру: два варианта прогноза, callback_data вида «g:игра:вариант»
const gameAskKeyboard = (game) => ({
  inline_keyboard: [game.options.map(([value, text]) => ({ text, callback_data: `g:${game.key}:${value}` }))],
});

const norm = (text) => text.replace(/ё/g, 'е').toLowerCase().replace(/^[\s🎰🍀🔔🔄]+/u, '').replace(/[\s?!🎰🍀🔔🔄]+$/u, '');
const isLuckRequest = (text) => norm(text) === 'мне повезет'; // старая кнопка/фраза — по-прежнему запускает слоты
const isRemindRequest = (text) => ['мои напоминания', 'напоминания'].includes(norm(text));
// Настоящую синюю кнопку «START» Telegram рисует сам только в чате без единого сообщения —
// как только там что-то написано, кнопка пропадает навсегда, и вернуть её нельзя. Эта клавиша —
// замена: повторяет то же самое приветствие, что и команда /start.
const isStartRequest = (text) => norm(text) === 'старт';

function coinResultText(outcome, correct) {
  const fact = outcome === 'heads' ? 'Выпал орёл 🦅' : 'Выпала решка 🪙';
  return (correct ? '🎉 Угадал! ' : 'Не угадал. ') + fact + (correct ? '' : ' Попробуй ещё раз!');
}
function diceResultText(game, success, correct) {
  return (correct ? '🎯 Прогноз сбылся! ' : 'Прогноз не сбылся. ') + (success ? game.successText : game.failText);
}

async function nextLosePhrase(env, chatId) {
  // случайные фразы без повторов, пока не пройдём весь список
  const key = `bag:${chatId}`;
  let bag = (await env.REMINDERS.get(key, 'json')) || [];
  if (!Array.isArray(bag) || !bag.length) {
    bag = SLOT_LOSE.map((_, i) => i);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  const index = bag.pop();
  await env.REMINDERS.put(key, JSON.stringify(bag), { expirationTtl: 60 * 60 * 24 * 90 });
  return SLOT_LOSE[index] || SLOT_LOSE[0];
}

async function playSlots(env, ctx, chatId) {
  const dice = await tg(env, 'sendDice', { chat_id: chatId, emoji: '🎰' });
  const won = SLOT_WINS.has(dice.dice.value);
  const phrase = won ? null : await nextLosePhrase(env, chatId);
  ctx.waitUntil(
    (async () => {
      await new Promise((r) => setTimeout(r, SLOT_ANIMATION_MS)); // ждём, пока барабаны докрутятся
      if (won) {
        await tg(env, 'sendMessage', { chat_id: chatId, text: WIN_TEXT });
        await tg(env, 'sendMessage', { chat_id: chatId, text: '🎉', reply_markup: gamesKeyboard() });
      } else {
        await tg(env, 'sendMessage', { chat_id: chatId, text: phrase, reply_markup: gamesKeyboard() });
      }
    })().catch((e) => console.log('slots:', e.message)),
  );
}

// Нажатие инлайн-кнопки прогноза («Попаду» / «Мимо» и т. п.) приходит отдельным типом
// обновления — callback_query, а не message. Монетка считается тут же честным рандомом,
// у остальных игр крутим настоящий Telegram-дайс и сверяем результат с прогнозом.
async function handleCallback(env, ctx, cq) {
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const userId = cq.from && cq.from.id;
  tg(env, 'answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {}); // не ждём — просто убираем спиннер
  if (!chatId || !isAllowed(env, userId)) return;

  const [, key, guess] = String(cq.data || '').split(':');
  const game = GAMES[key];
  if (!game) return;
  const pickLabel = (game.options.find(([v]) => v === guess) || [])[1] || guess;

  await tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: cq.message.message_id,
    text: `${game.ask}\nТвой прогноз: ${pickLabel}`,
    reply_markup: { inline_keyboard: [] }, // прогноз сделан — прячем кнопки, чтобы не жали дважды
  }).catch(() => {});

  if (key === 'coin') {
    const outcome = Math.random() < 0.5 ? 'heads' : 'tails';
    const correct = guess === outcome;
    ctx.waitUntil(
      new Promise((r) => setTimeout(r, 1200))
        .then(() => tg(env, 'sendMessage', { chat_id: chatId, text: coinResultText(outcome, correct) }))
        .catch((e) => console.log('coin:', e.message)),
    );
    return;
  }

  const dice = await tg(env, 'sendDice', { chat_id: chatId, emoji: game.dice });
  const success = game.isSuccess(dice.dice.value);
  const correct = (guess === 'yes') === success;
  ctx.waitUntil(
    new Promise((r) => setTimeout(r, GAME_ANIMATION_MS)) // ждём, пока анимация дайса доиграет
      .then(() => tg(env, 'sendMessage', { chat_id: chatId, text: diceResultText(game, success, correct) }))
      .catch((e) => console.log('game:', e.message)),
  );
}

function describeReminders(rec) {
  if (!rec || !rec.items || !rec.items.length) return 'Напоминания выключены. Включить можно в приложении: вкладка «Долги» → «Напоминания в Telegram».';
  const when = rec.before === 0 ? 'в день платежа' : rec.before === 1 ? 'за день до платежа' : `за ${rec.before} дня до платежа`;
  const lines = rec.items.map((it) => `• ${it.name} — ${it.day} числа, ${it.approx ? '≈ ' : ''}${rub(it.amount)}`);
  return `🔔 Напоминаю ${when}, в 9:00 по Москве:\n${lines.join('\n')}` +
    (rec.extra ? `\n\n💪 И про досрочку: +${rub(rec.extra.amount)} в месяц (${rec.extra.name}).` : '') +
    '\n\nВыключить можно командой /stop.';
}

async function handleMessage(env, ctx, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from && msg.from.id;
  const text = (msg.text || '').trim();
  const command = text.startsWith('/') ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';
  const send = (t, extra = {}) => tg(env, 'sendMessage', { chat_id: chatId, text: t, ...extra });

  if (command === '/id') return send(`Ваш Telegram ID: ${userId}`);
  if (!isAllowed(env, userId)) return send('Это личный бот.');

  if (command === '/start' || command === '/app' || isStartRequest(text)) {
    await tg(env, 'setChatMenuButton', {
      chat_id: chatId,
      menu_button: { type: 'web_app', text: 'Досрочка', web_app: { url: APP_URL } },
    }).catch(() => {});
    await pinDesktopLink(env, chatId).catch((e) => console.log('pin:', e.message));
    return send(
      'Досрочка — планировщик погашения долгов: кредиты, кредитные карты, микрозаймы.\n\n' +
        DISCLAIMER +
        '\n\nКнопки внизу 👇 — открыть приложение, испытать удачу или посмотреть напоминания.',
      { reply_markup: mainKeyboard() },
    );
  }
  if (command === '/luck' || isLuckRequest(text)) return playSlots(env, ctx, chatId);
  if (command === '/remind' || isRemindRequest(text)) {
    return send(describeReminders(await env.REMINDERS.get(`rem:${userId}`, 'json')), { reply_markup: mainKeyboard() });
  }
  if (command === '/stop') {
    await env.REMINDERS.delete(`rem:${userId}`);
    return send('Напоминания выключены. Включить снова можно в приложении.', { reply_markup: mainKeyboard() });
  }
  if (text === GAMES_TEXT) return send('Выбери игру 👇', { reply_markup: gamesKeyboard() });
  if (text === BACK_TEXT) return send('Главное меню 👇', { reply_markup: mainKeyboard() });
  if (text === LINK_TEXT) return send(APP_LINK_TEXT, { reply_markup: mainKeyboard() });
  if (text === SLOTS_TEXT) return playSlots(env, ctx, chatId);
  const game = Object.values(GAMES).find((g) => g.label === text);
  if (game) return send(game.ask, { reply_markup: gameAskKeyboard(game) });
  return send('Не понял команду. Выберите действие на кнопках внизу 👇', { reply_markup: mainKeyboard() });
}

// ---------- API напоминаний для Mini App ----------

function sanitizeReminder(body) {
  const items = (Array.isArray(body.items) ? body.items : [])
    .slice(0, 20)
    .map((it) => ({
      name: String(it.name || 'Долг').slice(0, 60),
      day: Math.min(31, Math.max(1, Math.round(Number(it.day) || 1))),
      amount: Math.min(1e10, Math.max(0, Math.round(Number(it.amount) || 0))),
      approx: !!it.approx,
    }));
  const extra = body.extra && Number(body.extra.amount) > 0
    ? { name: String(body.extra.name || '').slice(0, 60), amount: Math.min(1e10, Math.round(Number(body.extra.amount))) }
    : null;
  const before = [0, 1, 3].includes(Number(body.before)) ? Number(body.before) : 1;
  return { before, items, extra };
}

async function handleRemindersApi(request, env) {
  const cors = corsHeaders(request);
  const body = await request.json().catch(() => null);
  const user = body && (await verifyInitData(body.initData || '', env.BOT_TOKEN));
  if (!user) return json({ ok: false, error: 'auth' }, 401, cors);
  if (!isAllowed(env, user.id)) return json({ ok: false, error: 'forbidden' }, 403, cors);
  const key = `rem:${user.id}`;

  if (body.action === 'get') return json({ ok: true, data: await env.REMINDERS.get(key, 'json') }, 200, cors);

  const rec = { chatId: user.id, ...sanitizeReminder(body), updated: Date.now() };
  if (!rec.items.length) {
    await env.REMINDERS.delete(key);
    return json({ ok: true, off: true }, 200, cors);
  }
  try {
    await tg(env, 'sendMessage', { chat_id: user.id, text: describeReminders(rec) });
  } catch (e) {
    return json({ ok: false, error: e.code === 403 || e.code === 400 ? 'blocked' : 'telegram' }, 200, cors);
  }
  await env.REMINDERS.put(key, JSON.stringify(rec));
  return json({ ok: true }, 200, cors);
}

// ---------- ежедневная рассылка ----------

async function runReminders(env) {
  const today = new Date(Date.now() + MSK_OFFSET_MS); // «сейчас» по Москве в UTC-полях
  let cursor;
  do {
    const page = await env.REMINDERS.list({ prefix: 'rem:', cursor });
    for (const { name: key } of page.keys) {
      const rec = await env.REMINDERS.get(key, 'json');
      if (!rec || !rec.items || !rec.items.length) continue;
      const target = new Date(today);
      target.setUTCDate(target.getUTCDate() + (rec.before || 0));
      const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      const due = rec.items.filter((it) => Math.min(it.day, daysInMonth) === target.getUTCDate());
      if (!due.length) continue;

      const when = rec.before === 0 ? 'Сегодня' : rec.before === 1 ? 'Завтра' : `Через ${rec.before} дня`;
      const date = `${target.getUTCDate()} ${MONTHS_GEN[target.getUTCMonth()]}`;
      const total = due.reduce((a, it) => a + it.amount, 0);
      const firstDay = Math.min(...rec.items.map((it) => Math.min(it.day, daysInMonth)));
      let text = `📅 ${when}, ${date} — ${due.length > 1 ? 'платежи' : 'платёж'} по долгам:\n` +
        due.map((it) => `• ${it.name} — ${it.approx ? '≈ ' : ''}${rub(it.amount)}`).join('\n');
      if (due.length > 1) text += `\nИтого: ${rub(total)}`;
      if (rec.extra && target.getUTCDate() === firstDay) {
        text += `\n\n💪 План досрочки: +${rub(rec.extra.amount)} в месяц. Не забудьте подать заявку на досрочное погашение до списания.`;
      }
      try {
        await tg(env, 'sendMessage', { chat_id: rec.chatId, text });
      } catch (e) {
        if (e.code === 403) await env.REMINDERS.delete(key); // бот заблокирован — больше не пишем
        else console.log('reminder:', key, e.message);
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

// ---------- entry ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });

    if (url.pathname === '/telegram' && request.method === 'POST') {
      if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const update = await request.json().catch(() => null);
      try {
        if (update && update.message && update.message.chat) await handleMessage(env, ctx, update.message);
        else if (update && update.callback_query) await handleCallback(env, ctx, update.callback_query);
      } catch (e) {
        console.log('update:', e.message); // всегда отвечаем 200, иначе Telegram будет слать повторно
      }
      return new Response('ok');
    }

    if (url.pathname === '/api/reminders' && request.method === 'POST') return handleRemindersApi(request, env);

    return new Response('Досрочка bot is running');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
};
