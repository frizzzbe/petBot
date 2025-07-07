const { TEXT } = require('./text');
const { formatTimeLeft, escapeMarkdown, formatMessage, getBukashkaLevel } = require('../utils/helpers');
const admin = require('firebase-admin');

// Функция для форматирования информации о букашке
const formatBukashkaInfo = (bukashka, feedChange = 0, happinessChange = 0) => {
  const feedDisplay = feedChange
    ? `${bukashka.feed} (${feedChange > 0 ? '+' : ''}${feedChange})`
    : bukashka.feed;
  const happinessDisplay = happinessChange
    ? `${bukashka.happy} (${happinessChange > 0 ? '+' : ''}${happinessChange})`
    : bukashka.happy;
  const happyEmoji = (bukashka.happy || 0) >= 40 ? '😊' : '😢';

  // Вычисляем возраст букашки в секундах
  const now = new Date();
  const creationDate = new Date(bukashka.creationDate);
  const ageInSeconds = Math.floor((now - creationDate) / 1000);

  // Информация о бусте
  let boostInfo = '';
  if (bukashka.boost) {
    let boostName = '';
    if (bukashka.boost === 'adventure_boost') boostName = 'Ускорение приключений';
    if (bukashka.boost === 'happy_boost') boostName = 'Больше счастья';
    if (bukashka.boost === 'feed_boost') boostName = 'Меньше голода';
    boostInfo = `\n*Активный буст:* ${boostName}`;
  }

  // Формат уровня
  const lvl = getBukashkaLevel(bukashka.level);
  const lvlRest = (bukashka.level || 0) % 100;
  const levelDisplay = `${lvl} уровень ${lvlRest}/100`;

  // Информация о счастье и опыте
  let happyExpInfo = '';
  if ((bukashka.happy || 0) < 40) {
    happyExpInfo = '\nБукашка грустит и будет получать меньше опыта за приключения!';
  } else if ((bukashka.happy || 0) > 70) {
    happyExpInfo = '\nБукашка очень счастлива и будет получать больше опыта за приключения!';
  }

  return formatMessage(`
✨ Информация о вашей букашке! 🐛

*Имя:* ${bukashka.name}
*Возраст:* ${formatTimeLeft(ageInSeconds)}
*Уровень:* ${levelDisplay}
*Сытость:* ${feedDisplay} 🌱
*Счастье:* ${happinessDisplay} ${happyEmoji}
*Монетки:* ${bukashka.coins || 0} 🪙
*Статус:* ${bukashka.isAdventuring ? 'В приключении! 🧭' : 'Дома 🏡'}${boostInfo}${happyExpInfo}

${feedChange || happinessChange
      ? TEXT.FEED.THANKS
      : TEXT.FEED.HAPPY
    }
  `);
};

// Универсальная функция для отправки фото или gif с подписью
const sendPetMedia = async (chatId, image, message, bot) => {
  // Поддержка старого формата (image — строка)
  if (typeof image === 'string') {
    await bot.sendPhoto(chatId, image, {
      caption: message,
      parse_mode: "MarkdownV2",
    });
    return;
  }
  // Новый формат (image — объект)
  if (image.type === 'gif') {
    await bot.sendAnimation(chatId, image.file_id, {
      caption: message,
      parse_mode: "MarkdownV2",
    });
  } else {
    await bot.sendPhoto(chatId, image.file_id, {
      caption: message,
      parse_mode: "MarkdownV2",
    });
  }
};

// Функция для отправки информации о букашке
const sendBukashkaInfo = async (chatId, userId, feedChange = 0, happinessChange = 0, bot) => {
  // Получаем актуальные данные из Firebase
  const petsRef = admin.database().ref('pets');
  const snapshot = await petsRef.child(userId).once('value');
  const currentBukashka = snapshot.val();

  const message = formatBukashkaInfo(currentBukashka, feedChange, happinessChange);

  if (currentBukashka && currentBukashka.image) {
    await sendPetMedia(chatId, currentBukashka.image, message, bot);
  } else {
    // Если фото нет, отправляем только информацию
    await bot.sendMessage(chatId, message, {
      parse_mode: "MarkdownV2",
    });
  }
};

// Функция для расчета возраста букашки
const calculateAge = (creationDate) => {
  const now = new Date();
  const creation = new Date(creationDate);
  const ageDiff = now - creation;

  const minutes = Math.floor(ageDiff / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days} дн. ${remainingHours} ч.`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours} ч. ${remainingMinutes} мин.`;
  } else {
    return `${minutes} мин.`;
  }
};

// Функция для определения результата кормления
const getFeedResult = (bukashkaName) => {
  const random = Math.random() * 100; // Генерируем число от 0 до 100

  if (random < 5) {
    return {
      type: "говняшка",
      amount: -5,
      happiness: -10,
      message: formatMessage(TEXT.FEED.BAD_FOOD(bukashkaName)),
    };
  } else if (random < 60) {
    return {
      type: "водичку",
      amount: 5,
      happiness: 0,
      message: formatMessage(TEXT.FEED.WATER(bukashkaName)),
    };
  } else if (random < 90) {
    return {
      type: "листик",
      amount: 10,
      happiness: 5,
      message: formatMessage(TEXT.FEED.LEAF(bukashkaName)),
    };
  } else {
    return {
      type: "яблочко",
      amount: 20,
      happiness: 15,
      message: formatMessage(TEXT.FEED.APPLE(bukashkaName)),
    };
  }
};

// Функция для нормализации текста команды
const normalizeCommand = (text) => {
  return text.toLowerCase().replace(/[^а-яёa-z0-9\/\s]/gi, '').trim();
};

// Универсальная функция проверки интервала
const checkInterval = async (lastTime, interval, actionName, chatId, bot) => {
  const now = Date.now();
  if (now - lastTime < interval) {
    const left = Math.ceil((interval - (now - lastTime)) / 1000);
    let msg = '';
    switch (actionName) {
      case 'feed':
        msg = `Подождите еще ${formatTimeLeft(left)} перед следующим кормлением! ⏳`;
        break;
      case 'game':
        msg = `Нельзя играть слишком часто!\nПодождите еще ${formatTimeLeft(left)}`;
        break;
      default:
        msg = `Подождите еще ${formatTimeLeft(left)} до следующего действия.`;
    }
    await bot.sendMessage(chatId, formatMessage(msg), { parse_mode: "MarkdownV2" });
    return true;
  }
  return false;
};

// Универсальный обработчик для мини-игр (dice, bowling)
const handleGameAction = async ({ bot, chatId, userId, pet, petsRef, TEXT, value }) => {
  let happyChange = 0;
  let coinsChange = 0;
  let msg = '';
    switch (value) {
      case 1:
        happyChange = -5;
        break;
      case 2:
        happyChange = -3;
        break;
      case 3:
        happyChange = 0;
        break;
      case 4:
        happyChange = 3;
        break;
      case 5:
        happyChange = 7;
        coinsChange = Math.floor(Math.random() * 5) + 2;
        break;
      case 6:
        happyChange = 10;
        coinsChange = Math.floor(Math.random() * 10) + 5;
        break;
    }
    msg = TEXT.GAME.DICE_RESULT(value, happyChange, coinsChange);
  if (pet) {
    const newHappy = Math.max(0, Math.min(100, (pet.happy || 0) + happyChange));
    const newCoins = (pet.coins || 0) + coinsChange;
    await petsRef.child(userId).update({
      happy: newHappy,
      coins: newCoins
    });
    setTimeout(async () => {
      await bot.sendMessage(chatId, formatMessage(msg), { parse_mode: "MarkdownV2" });
    }, 3500);
  }
  return { happyChange, coinsChange, msg };
};

module.exports = {
  formatTimeLeft,
  escapeMarkdown,
  formatMessage,
  formatBukashkaInfo,
  sendBukashkaInfo,
  calculateAge,
  getFeedResult,
  normalizeCommand,
  checkInterval,
  handleGameAction
};
