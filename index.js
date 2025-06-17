const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const { COMMANDS, DEFAULT_BUKASHKA, ADVENTURES } = require('./config/constants');
const {
  getFeedResult,
  normalizeCommand,
  sendBukashkaInfo
} = require('./config/actions');
const { formatTimeLeft, formatMessage } = require('./utils/helpers');
const BukashkaManager = require('./config/BukashkaManager');
const { TEXT } = require('./config/text');

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
    const userRequest = normalizeCommand(msg.text);

    if (msg.text === "/start") {
      await bot.sendMessage(msg.chat.id, formatMessage(TEXT.START.WELCOME), {
        reply_markup: {
          keyboard: [
            ["⭐️ Взять букашку", "⭐️ Покормить"],
            ["⭐️ Моя букашка", "❓ Где букашка"],
            ["🎒 Букашку в приключение", "💀 Раздавить букашку"]
          ],
          resize_keyboard: true,
        },
      });
    } else if (msg.text === "/help") {
      await bot.sendMessage(msg.chat.id, formatMessage(TEXT.HELP), {
        parse_mode: "MarkdownV2"
      });
    } else if (userRequest === "взять букашку") {
      const userId = msg.from.id;
      if (bukashkaManager.getBukashka(userId)) {
        await bot.sendMessage(
          msg.chat.id,
          formatMessage(TEXT.STATUS.ALREADY_EXISTS),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      await bot.sendMessage(
        msg.chat.id,
        formatMessage(TEXT.START.NEW_BUKASHKA),
        { parse_mode: "MarkdownV2" }
      );

      bot.once("message", async (nameMsg) => {
        const buakakaName = nameMsg.text;
        await bukashkaManager.createBukashka(userId, msg.chat.id, buakakaName, DEFAULT_BUKASHKA);

        await bot.sendMessage(
          msg.chat.id,
          formatMessage(TEXT.START.CONGRATULATIONS(buakakaName)),
          { parse_mode: "MarkdownV2" }
        );
      });
    } else if (userRequest === "покормить") {
      const userId = msg.from.id;
      const bukashka = bukashkaManager.getBukashka(userId);
      if (!bukashka) {
        await bukashkaManager.emptyPetMsg(msg.chat.id);
        return;
      }

      if (bukashka.isAdventuring) {
        await bot.sendMessage(
          msg.chat.id,
          formatMessage(TEXT.FEED.IN_ADVENTURE),
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
          formatMessage(TEXT.FEED.WAIT(remainingTime)),
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
        await bot.sendMessage(msg.chat.id, TEXT.FEED.ERROR);
      }
    } else if (userRequest === "моя букашка") {
      const userId = msg.from.id;
      const bukashka = bukashkaManager.getBukashka(userId);
      if (bukashka) {
        await sendBukashkaInfo(msg.chat.id, bukashka, 0, 0, bot);
      } else {
        await bukashkaManager.emptyPetMsg(msg.chat.id);
      }
    } else if (userRequest === "букашку в приключение") {
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
          formatMessage(TEXT.ADVENTURE.IN_PROGRESS(bukashka.name, formatTimeLeft(timeLeft))),
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
          formatMessage(TEXT.ADVENTURE.LOW_FEED),
          {
            parse_mode: "MarkdownV2",
            reply_markup: keyboard
          }
        );
        return;
      }

      await bukashkaManager.startAdventure(msg.chat.id, ADVENTURES);
    } else if (userRequest === "где букашка") {
      const userId = msg.from.id;
      const bukashka = bukashkaManager.getBukashka(userId);
      if (!bukashka) {
        await bukashkaManager.emptyPetMsg(msg.chat.id);
        return;
      }

      const isAdventuring = bukashkaManager.isInAdventure(userId);
      const timeLeft = isAdventuring ? bukashkaManager.getAdventureTimeLeft(userId) : 0;

      await bot.sendMessage(
        msg.chat.id,
        formatMessage(TEXT.ADVENTURE.LOCATION(bukashka.name, isAdventuring, formatTimeLeft(timeLeft))),
        { parse_mode: "MarkdownV2" }
      );
    } else if (userRequest === "раздавить букашку") {
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
      await sendBukashkaInfo(msg.chat.id, bukashka, 0, 0, bot);
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
    bot.answerCallbackQuery(query.id, { text: TEXT.STATUS.NO_BUKASHKA });
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
      formatMessage(TEXT.ADVENTURE.CANCEL(bukashka.name)),
      { parse_mode: "MarkdownV2" }
    );
  }
});
