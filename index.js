require('dotenv').config();

const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const fs = require("fs");
const serviceAccount = require("./db-access.json");

// Internal dependencies
const { COMMANDS, DEFAULT_BUKASHKA, ADVENTURES } = require('./config/constants');
const { 
  getFeedResult,
  normalizeCommand,
  sendBukashkaInfo 
} = require('./config/actions');
const { formatTimeLeft, formatMessage } = require('./utils/helpers');
const BukashkaManager = require('./config/BukashkaManager');
const { TEXT } = require('./config/text');

// Firebase initialization
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_KEY_URL
});

// Database references
const db = admin.database();
const rootRef = db.ref('/');
const petsRef = db.ref('pets');

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
    } else if (userRequest === "букашку в бд") {
      const newBukashkaData = {
        chatId: 'someNewChatId123',
        name: 'Buddy',
        feed: 100,
        happy: 100,
        image: 'url_to_buddy.png',
        isAdventuring: false,
        adventureEndTime: null,
        lastFeedTime: Date.now()
      };
      
      // Assuming the userId is 'newUserId45678'
      const userId = 'newUserId45678';
      
      // Use .set() to write data to a specific path (overwriting anything already there)
      petsRef.child(userId).set(newBukashkaData)
        .then(() => {
          console.log(`Bukashka for user ${userId} saved successfully!`);
        })
        .catch((error) => {
          console.error('Error saving bukashka:', error);
        });
    } else if (userRequest === "букашку из бд") {
      const userId = 'newUserId45678';
      
      petsRef.child(userId).once('value')
      .then((snapshot) => {
        if (snapshot.exists()) {
          const bukashkaData = snapshot.val();
          console.log(`Data for bukashka ${userId}:`, bukashkaData);
        } else {
          console.log(`Bukashka with userId ${userId} does not exist.`);
        }
      })
      .catch((error) => {
        console.error('Error reading bukashka:', error);
      });
      
      const userIdToUpdate = 'someUserId12345'; // Replace with a real userId

      // Обновление в БД
// // Update the feed and lastFeedTime
// const updates = {
//   feed: 100, // Max feed
//   lastFeedTime: Date.now()
// };

// bukashkasRef.child(userIdToUpdate).update(updates)
//   .then(() => {
//     console.log(`Bukashka ${userIdToUpdate} updated successfully!`);
//   })
//   .catch((error) => {
//     console.error('Error updating bukashka:', error);
//   });
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
