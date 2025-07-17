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

// Добавляем объект для отслеживания ожидания фото
const waitingForPhoto = {};
// Добавляем объект для отслеживания ожидания имени
const waitingForName = {};

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
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const userName = msg.from.username;
    const userRequest = normalizeCommand(msg.text);
  
    if (["/start", "/start@bukashki_pet_bot"].includes(msg.text)) {
      await bot.sendMessage(chatId, formatMessage(TEXT.START.WELCOME), {
        parse_mode: "MarkdownV2"
      });
    } else if (["/menu", "/menu@bukashki_pet_bot"].includes(msg.text)) {
      // Удаляем команду пользователя
      await bot.deleteMessage(chatId, msg.message_id);
      const sent = await bot.sendMessage(chatId, "Вы открыли /menu", {
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
    } else if (msg.text === "z") {
      await bot.sendMessage(chatId, formatMessage(`Вас zовут @${userName}`), {
        parse_mode: "MarkdownV2"
      });
      return;
    } else if (msg.text === "Закрыть меню") {
      // Удаляем команду пользователя
      await bot.deleteMessage(chatId, msg.message_id);
      const sent = await bot.sendMessage(chatId, "Вы закрыли меню", {
        reply_markup: {
          remove_keyboard: true
        }
      });
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});

      return;
    } else if (["/help", "/help@bukashki_pet_bot"].includes(msg.text)) {
      await bot.sendMessage(chatId, formatMessage(TEXT.HELP), {
        parse_mode: "MarkdownV2"
      });
    } else if (["/img", "/img@bukashki_pet_bot"].includes(msg.text)) {
      const bukashka = await petObject.getBukashka(userId);
      if (!bukashka) {
        await petObject.emptyPetMsg(chatId);
        return;
      }
      waitingForPhoto[userId] = true;
      await bot.sendMessage(chatId, "Отправьте фотографию для профиля вашей букашки.");
    } else if (userRequest === "взять букашку" || ["/take@bukashki_pet_bot", "/take"].includes(msg.text)) {
      const pet = await petObject.getBukashka(userId);
      if (pet) {
        await bot.sendMessage(
          chatId,
          formatMessage(TEXT.STATUS.ALREADY_EXISTS),
          { parse_mode: "MarkdownV2" }
        );
        // Инициализация таймера голодания для уже существующей букашки
        petObject.startFeedTimer(userId, chatId);
        return;
      }

      await bot.sendMessage(
        chatId,
        formatMessage(TEXT.START.NEW_BUKASHKA),
        { parse_mode: "MarkdownV2" }
      );
      // Сохраняем ожидание имени для userId
      waitingForName[userId] = { chatId: chatId, userName };
    } else if (userRequest === "поиграть") {
      const bukashka = await petObject.getBukashka(userId);
      if (!bukashka) {
        await petObject.emptyPetMsg(chatId);
        return;
      }
      if (bukashka.isAdventuring) {
        await bot.sendMessage(
          chatId,
          formatMessage(TEXT.GAME.IN_ADVENTURE),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }
      const lastGame = await petObject.getLastGameTime(userId);
      if (await checkInterval(lastGame, INTERVALS.GAME, 'game', chatId, bot)) return;

      await bot.sendMessage(
        chatId,
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
      const bukashka = await petObject.getBukashka(userId);
      if (!bukashka) {
        await petObject.emptyPetMsg(chatId);
        return;
      }

      if (bukashka.isAdventuring) {
        await bot.sendMessage(
          chatId,
          formatMessage(TEXT.FEED.IN_ADVENTURE),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      const lastFeed = await petObject.getLastFeedTime(userId);
      if (await checkInterval(lastFeed, INTERVALS.FEED, 'feed', chatId, bot)) return;

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
          await bot.sendMessage(chatId, formatMessage(feedResult.message), {
            parse_mode: "MarkdownV2",
          });
        } catch (error) {
          // Отправляем сообщение без форматирования в случае ошибки
          await bot.sendMessage(chatId, feedResult.message.replace(/\\/g, ''));
        }

        // Проверяем, не умерла ли букашка от неприятной еды
        if (newFeed === 0 && feedResult.type === "говняшка") {
          await petObject.killBukashka(userId, chatId, "Поела говна и померла 😢");
          return;
        }
      } catch (error) {
        console.error('Error while feeding:', error);
        await bot.sendMessage(chatId, TEXT.FEED.ERROR);
      }
    } else if (userRequest === "моя букашка") {
      const bukashka = await petObject.getBukashka(userId);
      if (bukashka) {
        await sendBukashkaInfo(chatId, userId, 0, 0, bot);
      } else {
        await petObject.emptyPetMsg(chatId);
      }
    } else if (userRequest === "букашку в приключение") {
      const bukashka = await petObject.getBukashka(userId);
      if (!bukashka) {
        await petObject.emptyPetMsg(chatId);
        return;
      }

      if (bukashka.isAdventuring) {
        const timeLeft = await petObject.getAdventureTimeLeft(userId);
        await bot.sendMessage(
          chatId,
          formatMessage(TEXT.ADVENTURE.IN_PROGRESS(bukashka.name, formatTimeLeft(timeLeft))),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      // Сохраняем username в state для batch-обработчиков
      const snapshot = await petObject.petsRef.child(userId).once('value');
      const bukashkaData = snapshot.val();
      const state = { ...(bukashkaData?.state || {}), userName };
      await petObject.petsRef.child(userId).update({ state });

      await petObject.startAdventure(userId, chatId, ADVENTURES);
    } else if (userRequest === "где букашка") {
      const bukashka = await petObject.getBukashka(userId);
      if (!bukashka) {
        await petObject.emptyPetMsg(chatId);
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
        chatId,
        formatMessage(TEXT.ADVENTURE.LOCATION(bukashka.name, bukashka.isAdventuring, formatTimeLeft(timeLeft))),
        { parse_mode: "MarkdownV2" }
      );
    } else if (userRequest === "раздавить букашку") {
      const bukashka = await petObject.getBukashka(userId);
      if (bukashka) {
        // Используем новое сообщение с именем
        await petObject.killBukashka(userId, chatId, TEXT.STATUS.CRUSHED(bukashka.name));
      } else {
        await petObject.emptyPetMsg(chatId);
      }
    } else if (userRequest === "магазин") {
      // Проверяем активный буст и статус приключения
      const bukashka = await petObject.getBukashka(userId);
      if (bukashka && bukashka.isAdventuring) {
        await bot.sendMessage(chatId, formatMessage(TEXT.SHOP.IN_ADVENTURE), { parse_mode: "MarkdownV2" });
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
      // Добавляем строку с балансом монет
      let coinsInfo = '';
      if (bukashka) {
        coinsInfo = `\nВаш баланс: ${bukashka.coins || 0} монет 🪙`;
      }
      await bot.sendMessage(
        chatId,
        formatMessage(TEXT.SHOP.WELCOME()) + `\n${coinsInfo}\n\n${boostInfo}`,
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
        await bot.sendMessage(chatId, 'Нет ни одной букашки в рейтинге.');
        return;
      }
      // Преобразуем в массив и сортируем по уровню (level)
      const petList = Object.values(pets)
        .map(b => ({ name: b.name, level: b.level || 0 }))
        .sort((a, b) => (b.level || 0) - (a.level || 0))
        .slice(0, 20);
      if (petList.length === 0) {
        await bot.sendMessage(chatId, 'Нет ни одной букашки в рейтинге.');
        return;
      }
      // Формируем текст рейтинга
      const ratingText = petList.map((b, i) => {
        const lvl = getBukashkaLevel(b.level);
        const rest = b.level % 100;
        return `${i + 1}. ${b.name} - Уровень ${lvl} (${rest}/100)`;
      }).join('\n');
      await bot.sendMessage(chatId, `🔝 Топ букашек во всём мире:\n${ratingText}`);
    }
  } catch (error) {
    console.error(error);
  }
});

// Глобальный обработчик для ввода имени букашки
bot.on("message", async (nameMsg) => {
  const userId = nameMsg.from.id;
  if (waitingForName[userId]) {
    // Проверяем, что это текст
    if (!nameMsg.text) {
      await bot.sendMessage(namechatId, "Некорректный ввод");
      return;
    }
    const buakakaName = nameMsg.text;
    const { chatId, userName } = waitingForName[userId];
    await petObject.createBukashka(userId, chatId, buakakaName, DEFAULT_BUKASHKA, userName);
    await bot.sendMessage(
      chatId,
      formatMessage(TEXT.START.CONGRATULATIONS(buakakaName)),
      { parse_mode: "MarkdownV2" }
    );
    delete waitingForName[userId];
  }
});

// Универсальный обработчик для фото и gif-анимаций
async function handlePetMedia(msg, type) {
  try {
    const userId = msg.from.id;
    let file_id;
    // Проверяем тип сообщения: если не photo/animation, игнорируем
    if (type === 'photo') {
      if (!msg.photo) return; // Ожидали фото, а пришло что-то другое
      file_id = msg.photo[msg.photo.length - 1].file_id;
    } else if (type === 'gif') {
      if (!msg.animation) return; // Ожидали gif, а пришло что-то другое
      file_id = msg.animation.file_id;
    } else {
      return;
    }
    const bukashka = await petObject.getBukashka(userId);
    if (!bukashka) {
      await petObject.emptyPetMsg(chatId);
      return;
    }
    // Проверяем, что фото ждёт именно этот пользователь
    if (waitingForPhoto[userId] && msg.from.id === userId) {
      await petObject.updloadPetImage(userId, { file_id, type });
      await sendBukashkaInfo(chatId, userId, 0, 0, bot);
      waitingForPhoto[userId] = false;
    }
    // Если кто-то другой отправил фото, просто игнорируем
  } catch (error) {
    console.error(error);
  }
}

bot.on("photo", async (msg) => {
  await handlePetMedia(msg, 'photo');
});

bot.on("animation", async (msg) => {
  await handlePetMedia(msg, 'gif');
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
    if (bukashka && bukashka.isAdventuring) {
      await bot.sendMessage(chatId, formatMessage(TEXT.SHOP.IN_ADVENTURE), { parse_mode: "MarkdownV2" });
      return;
    }
    bot.answerCallbackQuery(query.id);
    let boostType = null;
    let price = 0;
    let boostText = '';
    if (query.data === "boost_adventure") { boostType = "adventure_boost"; price = SHOP_PRICES.adventure_boost; boostText = 'Ускорение приключений'; }
    if (query.data === "boost_happy") { boostType = "happy_boost"; price = SHOP_PRICES.happy_boost; boostText = 'Больше счастья'; }
    if (query.data === "boost_feed") { boostType = "feed_boost"; price = SHOP_PRICES.feed_boost; boostText = 'Меньше голода'; }
    // Проверка: нельзя купить тот же буст повторно
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
    if (bukashka && bukashka.isAdventuring) {
      await bot.sendMessage(chatId, formatMessage(TEXT.SHOP.IN_ADVENTURE), { parse_mode: "MarkdownV2" });
      return;
    }
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
    if (bukashka && bukashka.isAdventuring) {
      await bot.sendMessage(chatId, formatMessage(TEXT.SHOP.IN_ADVENTURE), { parse_mode: "MarkdownV2" });
      return;
    }
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
