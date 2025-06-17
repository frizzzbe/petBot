const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const { COMMANDS, DEFAULT_BUKASHKA, ADVENTURES } = require('./config/constants');
const {
  formatTimeLeft,
  formatMessage,
  calculateAge,
  getFeedResult,
  normalizeCommand,
} = require('./config/actions');
const BukashkaManager = require('./config/BukashkaManager');

require("dotenv").config();

const bot = new TelegramBot(process.env.API_KEY_BOT, {
  polling: true,
});

const bukashkaManager = new BukashkaManager(bot);

//Массив с объектами для меню команд
const commands = [
  { command: "start", description: "Запуск бота" },
  { command: "help", description: "Раздел помощи" },
];

// Устанавливаем меню команд
bot.setMyCommands(COMMANDS);

bot.on("text", async (msg) => {
  try {
    const normalizedText = normalizeCommand(msg.text);

    if (msg.text.startsWith("/start")) {
      await bot.sendMessage(msg.chat.id, `Вы запустили бота! 👋🏻`, {
        reply_markup: {
          keyboard: [
            ["⭐️ Взять букашку", "⭐️ Покормить"],
            ["⭐️ Моя букашка", "❓ Где букашка"],
            ["🎒 Букашку в приключение"],
          ],
          resize_keyboard: true,
        },
      });
    } else if (msg.text === "/help" || normalizedText === "help") {
      const helpMessage = formatMessage(`Доступные команды бота: 🐛

/start - Запуск бота и получение основного меню
/help - Показать это сообщение с описанием команд

Основные действия:
⭐️ Взять букашку - Завести нового питомца
⭐️ Покормить - Покормить вашу букашку
⭐️ Моя букашка - Посмотреть информацию о вашем питомце
⭐️ Картинка - Отправить фото для вашей букашки
🎒 Букашку в приключение - Отправить букашку в 6-часовое приключение
❓ Где букашка - Проверить статус приключения
раздавить букашку - Позволит вам избавиться от питомца

Важно: Букашка требует регулярного ухода! Не забывайте кормить её и следить за уровнем счастья.`);

      await bot.sendMessage(msg.chat.id, helpMessage, {
        parse_mode: "MarkdownV2"
      });
    } else if (normalizedText === "взять букашку") {
      const userId = msg.from.id;
      if (bukashkaManager.getBukashka(userId)) {
        await bot.sendMessage(
          msg.chat.id,
          formatMessage("У вас уже есть букашка! Если хотите завести новую, сначала раздавите текущую."),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      await bot.sendMessage(
        msg.chat.id,
        formatMessage("Как вы хотите назвать вашу букашку?"),
        { parse_mode: "MarkdownV2" }
      );

      bot.once("message", async (nameMsg) => {
        const buakakaName = nameMsg.text;
        await bukashkaManager.createBukashka(userId, msg.chat.id, buakakaName, DEFAULT_BUKASHKA);

        await bot.sendMessage(
          msg.chat.id,
          formatMessage(`Поздравляем! Теперь у вас есть букашка по имени ${buakakaName}! 🎉\n\nИспользуйте команду "покормить", чтобы покормить вашу букашку.`),
          { parse_mode: "MarkdownV2" }
        );
      });
    } else if (normalizedText === "покормить") {
      const userId = msg.from.id;
      const bukashka = bukashkaManager.getBukashka(userId);
      if (!bukashka) {
        await bukashkaManager.emptyPetMsg(msg.chat.id);
        return;
      }

      if (bukashka.isAdventuring) {
        await bot.sendMessage(
          msg.chat.id,
          formatMessage("Ваша букашка сейчас в приключении и не может есть! Подождите, пока она вернется. 🎒"),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      // Проверяем, прошло ли 3 секунды с последнего кормления
      const now = Date.now();
      const lastFeed = bukashkaManager.lastFeedTime[userId] || 0;

      if (now - lastFeed < 3000) {
        const remainingTime = Math.ceil((3000 - (now - lastFeed)) / 1000);
        await bot.sendMessage(
          msg.chat.id,
          formatMessage(`Подождите еще ${remainingTime} сек. перед следующим кормлением! ⏳`),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      try {
        const feedResult = getFeedResult(bukashka.name);

        // Обновляем время последнего кормления
        bukashkaManager.lastFeedTime[userId] = now;

        // Увеличиваем сытость и счастье в зависимости от результата
        bukashka.feed = Math.max(0, Math.min(100, bukashka.feed + feedResult.amount));
        bukashka.happy = Math.max(0, Math.min(100, bukashka.happy + feedResult.happiness));

        try {
          await bot.sendMessage(msg.chat.id, formatMessage(feedResult.message), {
            parse_mode: "MarkdownV2",
          });
        } catch (error) {
          // Отправляем сообщение без форматирования в случае ошибки
          await bot.sendMessage(msg.chat.id, feedResult.message.replace(/\\/g, ''));
        }

        // Проверяем, не умерла ли букашка от неприятной еды
        if (bukashka.feed === 0 && feedResult.type === "говняшка") {
          await bukashkaManager.killBukashka(userId, msg.chat.id, "Поела говна и померла 😢");
          return;
        }
      } catch (error) {
        await bot.sendMessage(msg.chat.id, "Произошла ошибка при кормлении букашки. Попробуйте еще раз.");
      }
    } else if (normalizedText === "моя букашка") {
      const userId = msg.from.id;
      const bukashka = bukashkaManager.getBukashka(userId);
      if (bukashka) {
        await bot.sendMessage(msg.chat.id, formatMessage(`
✨ Информация о вашей букашке! 🐛

**Имя:** ${bukashka.name}  
**Возраст:** ${calculateAge(bukashka.creationDate)}  
**Уровень:** ${bukashka.level}  
**Сытость:** ${bukashka.feed} 🌱  
**Счастье:** ${bukashka.happy} 😊

Ваша букашка очень рада вас видеть! 💖
`), { parse_mode: "MarkdownV2" });
      } else {
        await bukashkaManager.emptyPetMsg(msg.chat.id);
      }
    } else if (normalizedText === "букашку в приключение") {
      const userId = msg.from.id;
      const bukashka = bukashkaManager.getBukashka(userId);
      if (!bukashka) {
        await bukashkaManager.emptyPetMsg(msg.chat.id);
        return;
      }

      if (bukashkaManager.isInAdventure(userId)) {
        const timeLeft = bukashkaManager.getAdventureTimeLeft(userId);
        await bot.sendMessage(
          msg.chat.id,
          formatMessage(`Ваша букашка ${bukashka.name} уже в приключении! 🎒\n\nОсталось времени: ${formatTimeLeft(timeLeft)}`),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      if (bukashka.feed < 10) {
        const keyboard = {
          inline_keyboard: [
            [
              { text: "Рискнуть", callback_data: "adventure_risk" },
              { text: "Отказаться", callback_data: "adventure_cancel" }
            ]
          ]
        };

        await bot.sendMessage(
          msg.chat.id,
          formatMessage(`⚠️ Внимание! Уровень сытости вашей букашки слишком низкий (меньше 10). Если приключение окажется неудачным, букашка может умереть от голода!`),
          {
            parse_mode: "MarkdownV2",
            reply_markup: keyboard
          }
        );
        return;
      }

      await bukashkaManager.startAdventure(msg.chat.id, ADVENTURES);
    } else if (normalizedText === "где букашка") {
      const userId = msg.from.id;
      const bukashka = bukashkaManager.getBukashka(userId);
      if (!bukashka) {
        await bukashkaManager.emptyPetMsg(msg.chat.id);
        return;
      }

      if (bukashkaManager.isInAdventure(userId)) {
        const timeLeft = bukashkaManager.getAdventureTimeLeft(userId);
        await bot.sendMessage(
          msg.chat.id,
          formatMessage(`Ваша букашка ${bukashka.name} сейчас в приключении! 🎒\n\nОсталось времени: ${formatTimeLeft(timeLeft)}\n\nВы можете проверить её состояние, используя команду "Моя букашка".`),
          { parse_mode: "MarkdownV2" }
        );
      } else {
        await bot.sendMessage(
          msg.chat.id,
          formatMessage(`Ваша букашка ${bukashka.name} сейчас дома и готова к новым приключениям! 🏠\n\nИспользуйте команду "Букашку в приключение", чтобы отправить её в путешествие.`),
          { parse_mode: "MarkdownV2" }
        );
      }
    } else if (normalizedText === "раздавить букашку") {
      const userId = msg.from.id;
      if (bukashkaManager.getBukashka(userId)) {
        await bukashkaManager.killBukashka(userId, msg.chat.id, "раздавлена хозяином");
      } else {
        await bukashkaManager.emptyPetMsg(msg.chat.id);
      }
    } else {
      //Отправляем пользователю сообщение
      const msgWait = await bot.sendMessage(
        msg.chat.id,
        `Бот генерирует ответ...`
      );

      //Через 2 секунды редактируем сообщение о генерации и вставляем туда сообщение пользователя (эхо-бот)
      setTimeout(async () => {
        await bot.editMessageText(msg.text, {
          chat_id: msgWait.chat.id,
          message_id: msgWait.message_id,
        });
      }, 2000);
    }
  } catch (error) {
    console.log(error);
  }
});

bot.on("photo", async (msg) => {
  try {
    const userId = msg.from.id;
    const photo = msg.photo[msg.photo.length - 1];
    const bukashka = bukashkaManager.getBukashka(userId);

    if (bukashka) {
      bukashka.image = photo.file_id;
      await bot.sendPhoto(msg.chat.id, photo.file_id, {
        caption: formatMessage(`
✨ Информация о вашей букашке! 🐛

**Имя:** ${bukashka.name}  
**Возраст:** ${calculateAge(bukashka.creationDate)}  
**Уровень:** ${bukashka.level}  
**Сытость:** ${bukashka.feed} 🌱  
**Счастье:** ${bukashka.happy} 😊

Ваша букашка очень рада вас видеть! 💖
`),
        parse_mode: "MarkdownV2"
      });
    } else {
      await bukashkaManager.emptyPetMsg(msg.chat.id);
    }
  } catch (error) {
    console.log(error);
  }
});

// Добавляем обработчик для кнопок
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const bukashka = bukashkaManager.getBukashka(chatId);

  if (!bukashka) {
    bot.answerCallbackQuery(query.id, { text: "У вас нет букашки!" });
    return;
  }

  if (query.data === "adventure_risk") {
    bot.answerCallbackQuery(query.id);
    await bukashkaManager.startAdventure(chatId, ADVENTURES);
  } else if (query.data === "adventure_cancel") {
    bot.answerCallbackQuery(query.id);
    bot.deleteMessage(chatId, query.message.message_id);
    await bot.sendMessage(
      chatId,
      formatMessage(`Букашка ${bukashka.name} благодарна за вашу заботу! 🥰\n\nЛучше подождать, пока она наберется сил, и тогда отправиться в приключение вместе. 💖`),
      { parse_mode: "MarkdownV2" }
    );
  }
});
