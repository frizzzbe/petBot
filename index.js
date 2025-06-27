require('dotenv').config();

const TelegramBot = require("node-telegram-bot-api");
const admin = require("firebase-admin");
const serviceAccount = require("./db-access.json");

const PetManager = require('./config/PetManager');
const { COMMANDS, DEFAULT_BUKASHKA, ADVENTURES, INTERVALS, STICKERS, SHOP_PRICES } = require('./config/constants');
const { TEXT } = require('./config/text');
const {
  getFeedResult,
  normalizeCommand,
  sendBukashkaInfo,
  checkInterval,
  handleGameAction
} = require('./config/actions');
const { formatTimeLeft, formatMessage, getBukashkaLevel } = require('./utils/helpers');

// Firebase initialization
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_KEY_URL
});

const bot = new TelegramBot(process.env.API_KEY_BOT, {
  polling: true,
});

const petObject = new PetManager(bot);

// Глобальный cron для batch-обработки голодания и приключений
const db = admin.database();
const petsRef = db.ref('pets');

// Проверка и завершение просроченных приключений при запуске
PetManager.checkAndFinishAdventures(bot, petsRef);

setInterval(async () => {
  await PetManager.batchFeedDecay(bot, petsRef);
  await PetManager.batchCompleteAdventures(bot, petsRef);
}, INTERVALS.FEED_DECAY); // раз в 15 минут

// Устанавливаем меню команд
bot.setMyCommands(COMMANDS);

bot.on("text", async (msg) => {
  try {
    const userRequest = normalizeCommand(msg.text);

    if (["/start", "/start@bukashki_pet_bot"].includes(msg.text)) {
      await bot.sendMessage(msg.chat.id, formatMessage(TEXT.START.WELCOME), {
        parse_mode: "MarkdownV2"
      });
    } else if (["/menu", "/menu@bukashki_pet_bot"].includes(msg.text)) {
      // Удаляем команду пользователя
      await bot.deleteMessage(msg.chat.id, msg.message_id);
      const sent = await bot.sendMessage(msg.chat.id, "Вы открыли /menu", {
        reply_markup: {
          keyboard: [
            ["⭐️ Покормить", "⭐️ Моя букашка"],
            ["❓ Где букашка", "🎒 Букашку в приключение"],
            ["🎲 Поиграть", "🏪 Магазин"],
            ["💀 Раздавить букашку", "Закрыть меню"]
          ],
          resize_keyboard: true,
        }
      });
      return;
    } else if (msg.text === "Закрыть меню") {
      // Удаляем команду пользователя
      await bot.deleteMessage(msg.chat.id, msg.message_id);
      const sent = await bot.sendMessage(msg.chat.id, "Вы закрыли меню", {
        reply_markup: {
          remove_keyboard: true
        }
      });
        bot.deleteMessage(msg.chat.id, sent.message_id).catch(() => {});

      return;
    } else if (["/help", "/help@bukashki_pet_bot"].includes(msg.text)) {
      await bot.sendMessage(msg.chat.id, formatMessage(TEXT.HELP), {
        parse_mode: "MarkdownV2"
      });
    } else if (userRequest === "взять букашку" || ["/take@bukashki_pet_bot", "/take"].includes(msg.text)) {
      const userId = msg.from.id;
      const pet = await petObject.getBukashka(userId);
      if (pet) {
        await bot.sendMessage(
          msg.chat.id,
          formatMessage(TEXT.STATUS.ALREADY_EXISTS),
          { parse_mode: "MarkdownV2" }
        );
        // Инициализация таймера голодания для уже существующей букашки
        petObject.startFeedTimer(userId, msg.chat.id);
        return;
      }

      await bot.sendMessage(
        msg.chat.id,
        formatMessage(TEXT.START.NEW_BUKASHKA),
        { parse_mode: "MarkdownV2" }
      );

      bot.once("message", async (nameMsg) => {
        const buakakaName = nameMsg.text;
        await petObject.createBukashka(userId, msg.chat.id, buakakaName, DEFAULT_BUKASHKA);

        await bot.sendMessage(
          msg.chat.id,
          formatMessage(TEXT.START.CONGRATULATIONS(buakakaName)),
          { parse_mode: "MarkdownV2" }
        );
      });
    } else if (userRequest === "поиграть") {
      const userId = msg.from.id;
      const lastGame = await petObject.getLastGameTime(userId);
      if (await checkInterval(lastGame, INTERVALS.GAME, 'game', msg.chat.id, bot)) return;

      await bot.sendMessage(
        msg.chat.id,
        formatMessage("Выберите игру"),
        {
          parse_mode: "MarkdownV2", reply_markup: {
            inline_keyboard: [
              [
                { text: "Бросить кубик", callback_data: "dice" },
                { text: "Боулинг", callback_data: "bowling" }
              ]
            ]
          }
        }
      );
    } else if (userRequest === "покормить") {
      const userId = msg.from.id;
      const bukashka = await petObject.getBukashka(userId);
      if (!bukashka) {
        await petObject.emptyPetMsg(msg.chat.id);
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

      const lastFeed = await petObject.getLastFeedTime(userId);
      if (await checkInterval(lastFeed, INTERVALS.FEED, 'feed', msg.chat.id, bot)) return;

      try {
        const feedResult = getFeedResult(bukashka.name);

        // Обновляем время последнего кормления в базе данных
        await petObject.updateLastFeedTime(userId, new Date().toISOString());

        // Увеличиваем сытость и счастье в зависимости от результата
        const newFeed = Math.max(0, Math.min(100, bukashka.feed + feedResult.amount));
        const newHappy = Math.max(0, Math.min(100, bukashka.happy + feedResult.happiness));

        // Обновляем значения в базе данных
        await petObject.petsRef.child(userId).update({
          feed: newFeed,
          happy: newHappy
        });

        try {
          await bot.sendMessage(msg.chat.id, formatMessage(feedResult.message), {
            parse_mode: "MarkdownV2",
          });
        } catch (error) {
          // Отправляем сообщение без форматирования в случае ошибки
          await bot.sendMessage(msg.chat.id, feedResult.message.replace(/\\/g, ''));
        }

        // Проверяем, не умерла ли букашка от неприятной еды
        if (newFeed === 0 && feedResult.type === "говняшка") {
          await petObject.killBukashka(userId, msg.chat.id, "Поела говна и померла 😢");
          return;
        }
      } catch (error) {
        console.error('Error while feeding:', error);
        await bot.sendMessage(msg.chat.id, TEXT.FEED.ERROR);
      }
    } else if (userRequest === "моя букашка") {
      const userId = msg.from.id;
      const bukashka = await petObject.getBukashka(userId);
      if (bukashka) {
        await sendBukashkaInfo(msg.chat.id, userId, 0, 0, bot);
      } else {
        await petObject.emptyPetMsg(msg.chat.id);
      }
    } else if (userRequest === "букашку в приключение") {
      const userId = msg.from.id;
      const bukashka = await petObject.getBukashka(userId);
      if (!bukashka) {
        await petObject.emptyPetMsg(msg.chat.id);
        return;
      }

      if (bukashka.isAdventuring) {
        const timeLeft = await petObject.getAdventureTimeLeft(userId);
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

      await petObject.startAdventure(userId, msg.chat.id, ADVENTURES);
    } else if (userRequest === "где букашка") {
      const userId = msg.from.id;
      const bukashka = await petObject.getBukashka(userId);
      if (!bukashka) {
        await petObject.emptyPetMsg(msg.chat.id);
        return;
      }

      let timeLeft = 0;
      if (bukashka.isAdventuring && bukashka.state && bukashka.state.adventureStartTime) {
        let adventureInterval = INTERVALS.ADVENTURE;
        if (bukashka.boost === 'adventure_boost') {
          adventureInterval = Math.floor(adventureInterval / 1.5);
        }
        const startTime = new Date(bukashka.state.adventureStartTime).getTime();
        const now = Date.now();
        timeLeft = Math.max(0, Math.floor((startTime + adventureInterval - now) / 1000));
      }

      await bot.sendMessage(
        msg.chat.id,
        formatMessage(TEXT.ADVENTURE.LOCATION(bukashka.name, bukashka.isAdventuring, formatTimeLeft(timeLeft))),
        { parse_mode: "MarkdownV2" }
      );
    } else if (userRequest === "раздавить букашку") {
      const userId = msg.from.id;
      const bukashka = await petObject.getBukashka(userId);
      if (bukashka) {
        await petObject.killBukashka(userId, msg.chat.id, "раздавлена хозяином");
      } else {
        await petObject.emptyPetMsg(msg.chat.id);
      }
    } else if (userRequest === "магазин") {
      // Проверяем активный буст и статус приключения
      const userId = msg.from.id;
      const bukashka = await petObject.getBukashka(userId);
      if (bukashka && bukashka.isAdventuring) {
        await bot.sendMessage(msg.chat.id, 'Нельзя посещать магазин, пока букашка находится в приключении!');
        return;
      }
      let boostInfo = '';
      if (bukashka && bukashka.boost) {
        let boostName = '';
        if (bukashka.boost === 'adventure_boost') boostName = 'Ускорение приключений';
        if (bukashka.boost === 'happy_boost') boostName = 'Больше счастья';
        if (bukashka.boost === 'feed_boost') boostName = 'Меньше голода';
        boostInfo = formatMessage(TEXT.SHOP.ACTIVE_INFO(boostName)) + '\n\n';
      }
      await bot.sendMessage(
        msg.chat.id,
        formatMessage(TEXT.SHOP.WELCOME()) + `\n\n${boostInfo}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Ускорение приключений", callback_data: "boost_adventure" },
                { text: "Больше счастья", callback_data: "boost_happy" },
              ],
              [
                { text: "Меньше голода", callback_data: "boost_feed" },
                { text: "Кролик", callback_data: "shop_rabbit" }
              ],
              [
                { text: "Казик 🎰", callback_data: "casino" }
              ]
            ]
          },
          parse_mode: "MarkdownV2"
        }
      );
    } else if (userRequest === "рейтинг") {
      // Получаем всех букашек из базы
      const snapshot = await petsRef.once('value');
      const pets = snapshot.val();
      if (!pets) {
        await bot.sendMessage(msg.chat.id, 'Нет ни одной букашки в рейтинге.');
        return;
      }
      // Преобразуем в массив и сортируем по уровню (level)
      const petList = Object.values(pets)
        .map(b => ({ name: b.name, level: b.level || 0 }))
        .sort((a, b) => (b.level || 0) - (a.level || 0))
        .slice(0, 20);
      if (petList.length === 0) {
        await bot.sendMessage(msg.chat.id, 'Нет ни одной букашки в рейтинге.');
        return;
      }
      // Формируем текст рейтинга
      const ratingText = petList.map((b, i) => {
        const lvl = getBukashkaLevel(b.level);
        const rest = b.level % 100;
        return `${i + 1}. ${b.name} - Уровень ${lvl} (${rest}/100)`;
      }).join('\n');
      await bot.sendMessage(msg.chat.id, `🔝 Топ букашек во всём мире:\n${ratingText}`);
    }
  } catch (error) {
    console.error(error);
  }
});

bot.on("photo", async (msg) => {
  try {
    const userId = msg.from.id;
    const photo = msg.photo[msg.photo.length - 1];
    const bukashka = await petObject.getBukashka(userId);

    if (bukashka) {
      await petObject.updloadPetImage(userId, photo.file_id);
      await sendBukashkaInfo(msg.chat.id, userId, 0, 0, bot);
    } else {
      await petObject.emptyPetMsg(msg.chat.id);
    }
  } catch (error) {
    console.error(error);
  }
});

// Добавляем обработчик для кнопок
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const bukashka = await petObject.getBukashka(userId);

  if (!bukashka) {
    bot.answerCallbackQuery(query.id, { text: TEXT.STATUS.NO_BUKASHKA });
    return;
  }

  if (query.data === "adventure_risk") {
    bot.answerCallbackQuery(query.id);
    await petObject.startAdventure(userId, chatId, ADVENTURES);
    return;
  } else if (query.data === "adventure_cancel") {
    bot.answerCallbackQuery(query.id);
    bot.deleteMessage(chatId, query.message.message_id);
    await bot.sendMessage(
      chatId,
      formatMessage(TEXT.ADVENTURE.CANCEL(bukashka.name)),
      { parse_mode: "MarkdownV2" }
    );
  } else if (query.data === "dice" || query.data === "bowling") {
    bot.answerCallbackQuery(query.id);
    await bot.deleteMessage(chatId, query.message.message_id);
    const lastGame = await petObject.getLastGameTime(userId);
    if (await checkInterval(lastGame, INTERVALS.GAME, 'game', chatId, bot)) return;
    const { dice } = await bot.sendDice(chatId, { emoji: query.data === "dice" ? "🎲" : "🎳" });
    const pet = await petObject.getBukashka(userId);
    await handleGameAction({
      bot,
      chatId,
      userId,
      pet,
      petsRef: petObject.petsRef,
      TEXT,
      value: dice.value
    });
    await petObject.updateLastGameTime(userId, new Date().toISOString());
    return;
  } else if (query.data === "boost_adventure" || query.data === "boost_happy" || query.data === "boost_feed") {
    bot.answerCallbackQuery(query.id);
    let boostType = null;
    let price = 0;
    let boostText = '';
    if (query.data === "boost_adventure") { boostType = "adventure_boost"; price = SHOP_PRICES.adventure_boost; boostText = 'Ускорение приключений'; }
    if (query.data === "boost_happy") { boostType = "happy_boost"; price = SHOP_PRICES.happy_boost; boostText = 'Больше счастья'; }
    if (query.data === "boost_feed") { boostType = "feed_boost"; price = SHOP_PRICES.feed_boost; boostText = 'Меньше голода'; }
    // Проверка: нельзя купить тот же буст повторно
    if (bukashka && bukashka.isAdventuring) {
      await bot.sendMessage(chatId, 'Нельзя покупать бусты, пока букашка находится в приключении!');
      return;
    }
    if (bukashka && bukashka.boost === boostType) {
      await bot.sendMessage(chatId, formatMessage(TEXT.SHOP.ALREADY_THIS_BOOST(boostText)), { parse_mode: "MarkdownV2" });
      return;
    }
    const success = await petObject.setBoost(userId, boostType, price);
    if (success === true) {
      await bot.sendMessage(chatId, formatMessage(TEXT.SHOP.SUCCESS(boostText, price) + '\n\n' + TEXT.SHOP.BOOST_INFO(boostType)), { parse_mode: "MarkdownV2" });
    } else if (success && success.replaced) {
      let oldBoostName = '';
      if (success.replaced === 'adventure_boost') oldBoostName = 'Ускорение приключений';
      if (success.replaced === 'happy_boost') oldBoostName = 'Больше счастья';
      if (success.replaced === 'feed_boost') oldBoostName = 'Меньше голода';
      await bot.sendMessage(chatId, formatMessage(TEXT.SHOP.REPLACED_BOOST(oldBoostName, boostText, price) + '\n\n' + TEXT.SHOP.BOOST_INFO(boostType)), { parse_mode: "MarkdownV2" });
    } else if (success && success.already) {
      let boostName = '';
      if (success.current === 'adventure_boost') boostName = 'Ускорение приключений';
      if (success.current === 'happy_boost') boostName = 'Больше счастья';
      if (success.current === 'feed_boost') boostName = 'Меньше голода';
      await bot.sendMessage(chatId, formatMessage(TEXT.SHOP.ALREADY_BOOST(boostName)), { parse_mode: "MarkdownV2" });
    } else {
      await bot.sendMessage(chatId, formatMessage(TEXT.SHOP.NOT_ENOUGH), { parse_mode: "MarkdownV2" });
    }
    return;
  } else if (query.data === "shop_rabbit") {
    bot.answerCallbackQuery(query.id);
    const bukashka = await petObject.getBukashka(userId);
    if (!bukashka) {
      await petObject.emptyPetMsg(chatId);
      return;
    }
    if ((bukashka.coins || 0) < SHOP_PRICES.rabbit) {
      await bot.sendMessage(chatId, 'Недостаточно монет для покупки кролика!');
      return;
    }
    const happyAdd = Math.floor(Math.random() * 8) + 8; // 8-15
    const newHappy = Math.min(100, (bukashka.happy || 0) + happyAdd);
    await petObject.petsRef.child(userId).update({
      coins: (bukashka.coins || 0) - SHOP_PRICES.rabbit,
      happy: newHappy
    });
    await bot.sendSticker(chatId, STICKERS.RABBIT[Math.floor(Math.random() * STICKERS.RABBIT.length)])
    await bot.sendMessage(chatId, `${TEXT.SHOP.RABBIT_SUCCESS}\n\nСчастье увеличилось: ${newHappy} (+${happyAdd})`);
    return;
  } else if (query.data === "casino") {
    bot.answerCallbackQuery(query.id);
    if ((bukashka.coins || 0) < SHOP_PRICES.PRICE) {
      await bot.sendMessage(chatId, TEXT.CASINO.NOT_ENOUGH(SHOP_PRICES.PRICE));
      return;
    }
    await petObject.petsRef.child(userId).update({ coins: bukashka.coins - SHOP_PRICES.PRICE });
    const { dice } = await bot.sendDice(chatId, { emoji: "🎰" });
    setTimeout(async () => {
      if (dice.value === 64) {
        const updatedSnapshot = await petObject.petsRef.child(userId).once('value');
        const updatedBukashka = updatedSnapshot.val();
        const safeHappy = Number.isFinite(updatedBukashka.happy) ? updatedBukashka.happy : 0;
        await petObject.petsRef.child(userId).update({
          coins: updatedBukashka.coins + SHOP_PRICES.JACKPOT.coins,
          happy: Math.min(100, safeHappy + SHOP_PRICES.JACKPOT.happy)
        });
        await bot.sendMessage(chatId, TEXT.CASINO.JACKPOT(SHOP_PRICES.JACKPOT));
      } else if ([1, 22, 43].includes(dice.value)) {
        // 1 === "bar bar bar"
        // 22 === "berry berry berry"
        // 43 === "lemon lemon lemon"
        const updatedSnapshot = await petObject.petsRef.child(userId).once('value');
        const updatedBukashka = updatedSnapshot.val();
        const safeHappy = Number.isFinite(updatedBukashka.happy) ? updatedBukashka.happy : 0;
        await petObject.petsRef.child(userId).update({
          coins: updatedBukashka.coins + SHOP_PRICES.WIN.coins,
          happy: Math.min(100, safeHappy + SHOP_PRICES.WIN.happy)
        });
        await bot.sendMessage(chatId, TEXT.CASINO.WIN(SHOP_PRICES.WIN));
      } else {
        await bot.sendMessage(chatId, TEXT.CASINO.LOSE);
      }
    }, 2000);
    return;
  }
});
