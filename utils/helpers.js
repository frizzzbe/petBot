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

module.exports = {
  formatTimeLeft,
  escapeMarkdown,
  formatMessage
};
