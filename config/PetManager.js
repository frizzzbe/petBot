const { formatMessage, formatTimeLeft } = require('./actions');
const { TEXT } = require('./text');
const { INTERVALS, VALUE } = require('./constants');
const admin = require('firebase-admin');

class PetManager {
  constructor(bot) {
    this.bot = bot;
    this.db = admin.database();
    this.petsRef = this.db.ref('pets');
    this.feedTimers = {};
    this.adventureTimers = {};
  }

  async getAdventureTimeLeft(userId) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();

    if (!bukashka || !bukashka.isAdventuring || !bukashka.adventureStartTime) {
      return 0;
    }

    const now = Date.now();
    const startTime = new Date(bukashka.adventureStartTime).getTime();
    const elapsed = Math.floor((now - startTime) / 1000);
    return Math.max(0, Math.floor(INTERVALS.ADVENTURE / 1000) - elapsed);
  }

  async startAdventure(chatId, ADVENTURES) {
    const snapshot = await this.petsRef.child(chatId).once('value');
    const bukashka = snapshot.val();
    if (!bukashka) return;

    const adventure = ADVENTURES[Math.floor(Math.random() * ADVENTURES.length)];

    // Проверяем наличие ускоряющего буста
    let adventureInterval = INTERVALS.ADVENTURE;
    if (bukashka.boost === 'adventure_boost') {
      adventureInterval = Math.floor(INTERVALS.ADVENTURE / 1.5);
    }

    // Обновляем данные в Firebase с временными метками
    await this.petsRef.child(chatId).update({
      isAdventuring: true,
      adventureResult: adventure,
      adventureStartTime: new Date().toISOString()
    });

    // Устанавливаем таймер для завершения приключения
    this.adventureTimers[chatId] = setTimeout(() => {
      this.completeAdventure(chatId);
    }, adventureInterval);

    await this.bot.sendMessage(
      chatId,
      formatMessage(TEXT.ADVENTURE.START(bukashka.name, formatTimeLeft(Math.floor(adventureInterval / 1000)))),
      { parse_mode: "MarkdownV2" }
    );
  }

  async completeAdventure(chatId) {
    const snapshot = await this.petsRef.child(chatId).once('value');
    const bukashka = snapshot.val();
    if (!bukashka || !bukashka.isAdventuring) return;

    const adventure = bukashka.adventureResult;
    if (!adventure) return;

    const newFeed = Math.max(0, Math.min(100, bukashka.feed + adventure.feed));
    const newHappy = Math.max(0, Math.min(100, bukashka.happy + adventure.happiness));

    // Логика монеток
    let coinsEarned = 0;
    if (adventure.feed < 0 && adventure.happiness < 0) {
      coinsEarned = Math.floor(Math.random() * 41) + 10; // 10-50 монет
    } else if (adventure.feed > 0 || adventure.happiness > 0) {
      coinsEarned = Math.floor(Math.random() * 15) + 5; // 5-20 монет
    } else {
      coinsEarned = Math.floor(Math.random() * 5) + 1; // 1-5 монет
    }
    const newCoins = (bukashka.coins || 0) + coinsEarned;

    // Обновляем данные в Firebase
    await this.petsRef.child(chatId).update({
      feed: newFeed,
      happy: newHappy,
      isAdventuring: false,
      adventureResult: null,
      adventureStartTime: null,
      coins: newCoins
    });

    clearTimeout(this.adventureTimers[chatId]);
    delete this.adventureTimers[chatId];

    const resultMessage = formatMessage(
      `${TEXT.ADVENTURE.COMPLETE(adventure.text, adventure.feed, adventure.happiness, coinsEarned)}`
    );

    await this.bot.sendMessage(chatId, resultMessage, {
      parse_mode: "MarkdownV2",
    });

    if (newFeed === 0) {
      await this.killBukashka(chatId, chatId, "последствий приключения");
    }
  }

  async killBukashka(userId, chatId, reason) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();

    if (bukashka) {
      const ageSeconds = Math.floor((Date.now() - new Date(bukashka.creationDate)) / 1000);

      // Удаляем данные из Firebase
      await this.petsRef.child(userId).remove();

      await this.bot.sendMessage(chatId, formatMessage(TEXT.STATUS.DEAD(reason, formatTimeLeft(ageSeconds))), {
        parse_mode: "MarkdownV2"
      });
    }
  }

  async createBukashka(userId, chatId, name, DEFAULT_BUKASHKA) {
    const bukashkaData = {
      name,
      creationDate: new Date().toISOString(),
      lastFeedTime: "",
      adventureStartTime: null,
      coins: 0,
      ...DEFAULT_BUKASHKA
    };

    // Сохраняем данные в Firebase
    await this.petsRef.child(userId).set(bukashkaData);
  }

  async getBukashka(userId) {
    const snapshot = await this.petsRef.child(userId).once('value');
    return snapshot.val();
  }

  async emptyPetMsg(chatId) {
    await this.bot.sendMessage(
      chatId,
      formatMessage(TEXT.STATUS.NO_BUKASHKA),
      { parse_mode: "MarkdownV2" }
    );
  }

  // Метод для получения времени последнего кормления из базы данных
  async getLastFeedTime(userId) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();
    return bukashka && bukashka.lastFeedTime ? new Date(bukashka.lastFeedTime).getTime() : 0;
  }

  // Метод для обновления времени последнего кормления в базе данных
  async updateLastFeedTime(userId, timestamp) {
    await this.petsRef.child(userId).update({
      lastFeedTime: timestamp
    });
  }

  // Установить фотографию для букашки
  async updloadPetImage(userId, image) {
    await this.petsRef.child(userId).update({
      image: image
    });
  }

  // Получить время последней игры
  async getLastGameTime(userId) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();
    return bukashka && bukashka.lastGameTime ? new Date(bukashka.lastGameTime).getTime() : 0;
  }

  // Обновить время последней игры
  async updateLastGameTime(userId, timestamp) {
    await this.petsRef.child(userId).update({ lastGameTime: timestamp });
  }

  // уменьшение сытости и счастья у всех букашек
  static async batchFeedDecay(bot, petsRef) {
    const snapshot = await petsRef.once('value');
    const pets = snapshot.val();
    if (!pets) return;
    for (const [userId, bukashka] of Object.entries(pets)) {
      if (!bukashka) continue;
      if (bukashka.isAdventuring) continue;
      // Учитываем буст на меньше голода
      let feedDecay = VALUE.FEED_DECAY;
      if (bukashka.boost === 'feed_boost') {
        feedDecay = feedDecay / 1.5;
      }
      const newFeed = Math.max(0, (bukashka.feed || 0) - feedDecay);
      const newHappy = Math.max(0, (bukashka.happy || 0) - VALUE.HAPPY_DECAY);
      await petsRef.child(userId).update({ feed: newFeed, happy: newHappy });
      if (newFeed < 10) {
        await bot.sendMessage(userId, formatMessage(TEXT.FEED.HUNGRY(bukashka.name, newFeed)), {
          parse_mode: "MarkdownV2",
        });
      }
      if (newFeed <= 0) {
        const petManager = new PetManager(bot);
        await petManager.killBukashka(userId, userId, "голод");
      }
    }
  }

  // завершение приключений у всех букашек
  static async batchCompleteAdventures(bot, petsRef) {
    const snapshot = await petsRef.once('value');
    const pets = snapshot.val();
    if (!pets) return;
    const now = Date.now();
    for (const [userId, bukashka] of Object.entries(pets)) {
      if (!bukashka || !bukashka.isAdventuring || !bukashka.adventureStartTime) continue;
      const elapsed = Math.floor((now - bukashka.adventureStartTime) / 1000);
      if (elapsed >= INTERVALS.ADVENTURE / 1000) {
        const petManager = new PetManager(bot);
        await petManager.completeAdventure(userId);
      }
    }
  }

  // Установить boost для букашки с учетом стоимости
  async setBoost(userId, boostType, price) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();
    if (!bukashka || (bukashka.coins || 0) < price) {
      return false;
    }
    let replaced = null;
    if (bukashka.boost) {
      replaced = bukashka.boost;
    }
    await this.petsRef.child(userId).update({
      boost: boostType,
      coins: (bukashka.coins || 0) - price
    });
    if (replaced) {
      return { replaced, newBoost: boostType };
    }
    return true;
  }
}

module.exports = PetManager; 