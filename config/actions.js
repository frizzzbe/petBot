// Функция для форматирования оставшегося времени
const formatTimeLeft = (timeLeft) => {
  const days = Math.floor(timeLeft / (24 * 60 * 60));
  const hours = Math.floor((timeLeft % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((timeLeft % (60 * 60)) / 60);
  const seconds = Math.floor(timeLeft % 60);

  if (days > 0) {
    return `${days} дн. ${hours} ч.`;
  } else if (hours > 0) {
    return `${hours} ч. ${minutes} мин.`;
  } else {
    return `${minutes} мин. ${seconds} сек.`;
  }
};

// Функция для экранирования специальных символов в тексте
const escapeMarkdown = (text) => {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&').replace(/!/g, '\\!');
};

// Функция для форматирования сообщений в MarkdownV2
const formatMessage = (text) => {
  if (!text) return '';

  // Список специальных символов, которые нужно экранировать
  const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];

  // Экранируем каждый специальный символ
  let result = text;
  specialChars.forEach(char => {
    const regex = new RegExp(`\\${char}`, 'g');
    result = result.replace(regex, `\\${char}`);
  });

  return result;
};

// Функция для форматирования информации о букашке
const formatBukashkaInfo = (bukashka, feedChange = 0, happinessChange = 0) => {
  const feedDisplay = feedChange
    ? `${bukashka.feed} (${feedChange > 0 ? '+' : ''}${feedChange})`
    : bukashka.feed;

  const happinessDisplay = happinessChange
    ? `${bukashka.happy} (${happinessChange > 0 ? '+' : ''}${happinessChange})`
    : bukashka.happy;

  // Вычисляем возраст букашки в секундах
  const now = new Date();
  const creationDate = new Date(bukashka.creationDate);
  const ageInSeconds = Math.floor((now - creationDate) / 1000);

  return formatMessage(`
✨ Информация о вашей букашке! 🐛

**Имя:** ${bukashka.name}  
**Возраст:** ${formatTimeLeft(ageInSeconds)}  
**Уровень:** ${bukashka.level}  
**Сытость:** ${feedDisplay} 🌱  
**Счастье:** ${happinessDisplay} 😊

${feedChange || happinessChange
      ? "Спасибо, что покормили вашу букашку! 💖"
      : "Ваша букашка очень рада вас видеть! 💖"
    }
  `);
};

// Функция для отправки информации о букашке
const sendBukashkaInfo = async (chatId, bukashka, feedChange = 0, happinessChange = 0, bot) => {
  const message = formatBukashkaInfo(bukashka, feedChange, happinessChange);

  if (bukashka.image) {
    // Если есть фото букашки, отправляем его с информацией
    await bot.sendPhoto(chatId, bukashka.image, {
      caption: message,
      parse_mode: "MarkdownV2",
    });
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
      message: formatMessage(`😱 *О нет!* Ваша ${bukashkaName} случайно съела говняшку! 💩\nСытость уменьшилась на 5 🌱\nСчастье уменьшилось на 10 😢`),
    };
  } else if (random < 60) {
    return {
      type: "водичку",
      amount: 5,
      happiness: 0,
      message: formatMessage(`${bukashkaName} выпила водичку 🍽️\nСытость увеличилась на 5 🌱`),
    };
  } else if (random < 90) {
    return {
      type: "листик",
      amount: 10,
      happiness: 5,
      message: formatMessage(`${bukashkaName} съела листик 🍽️\nСытость увеличилась на 10 🌱\nСчастье увеличилось на 5 😊`),
    };
  } else {
    return {
      type: "яблочко",
      amount: 20,
      happiness: 15,
      message: formatMessage(`🎉 *Невероятно!* 🎉\n\nВаша ${bukashkaName} нашла и съела яблочко! 🍎\nСытость увеличилась на 20 🌱\nСчастье увеличилось на 15 😊\n\nВаша букашка очень счастлива! 💖`),
    };
  }
};

// Функция для нормализации текста команды
const normalizeCommand = (text) => {
  // Удаляем все символы, кроме букв, цифр и пробелов, и приводим к нижнему регистру
  return text.toLowerCase().replace(/[^а-яёa-z0-9\s]/gi, '').trim();
};

module.exports = {
  formatTimeLeft,
  escapeMarkdown,
  formatMessage,
  formatBukashkaInfo,
  sendBukashkaInfo,
  calculateAge,
  getFeedResult,
  normalizeCommand
};
