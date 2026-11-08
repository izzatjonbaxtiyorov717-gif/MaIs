// Mais CRM — Telegram-бот для отчётов
// Запуск: npm install && npm start
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const { TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALLOWED_CHAT_IDS } = process.env;

if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Заполните .env — см. .env.example');
  process.exit(1);
}

// service_role ключ обходит RLS — бот работает на сервере, это безопасно,
// т.к. доступ к самому боту ограничен списком ALLOWED_CHAT_IDS.
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

const allowed = (ALLOWED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
function isAllowed(chatId) {
  return allowed.length === 0 || allowed.includes(String(chatId));
}

const STATUS_LABELS = {
  deposit: 'Предоплата получена',
  material: 'Материал получен',
  cut: 'Материал раскроен',
  tailor: 'У портного',
  finishing: 'Глажка/упаковка',
  completed: 'Выдано клиенту',
  cancel: 'Отменено',
};

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

async function buildReport() {
  const [{ data: tx }, { data: orders }, { data: clients }] = await Promise.all([
    sb.from('transactions').select('type, amount'),
    sb.from('orders').select('status, amount'),
    sb.from('clients').select('id'),
  ]);

  const income = (tx || []).filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const expense = (tx || []).filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);

  const byStatus = {};
  Object.keys(STATUS_LABELS).forEach(k => byStatus[k] = 0);
  (orders || []).forEach(o => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });

  let text = `📊 *Отчёт Mais CRM*\n\n`;
  text += `Приход: ${fmt(income)}\nРасход: ${fmt(expense)}\nПрибыль: ${fmt(income - expense)}\n\n`;
  text += `Клиентов: ${(clients || []).length}\n\n`;
  text += `*Заявки по этапам:*\n`;
  Object.entries(STATUS_LABELS).forEach(([k, label]) => {
    text += `${label}: ${byStatus[k] || 0}\n`;
  });
  return text;
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    isAllowed(msg.chat.id)
      ? 'Привет! Команда /report — сводка по заявкам и финансам.'
      : 'Доступ к этому боту ограничен. Обратитесь к администратору.'
  );
});

bot.onText(/\/report/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(chatId)) {
    bot.sendMessage(chatId, 'Доступ к этому боту ограничен.');
    return;
  }
  try {
    const text = await buildReport();
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, 'Не удалось получить отчёт. Попробуйте позже.');
  }
});

console.log('Mais CRM bot запущен (polling)...');
