const { formatMessage, formatTimeLeft } = require('./actions');
const { TEXT } = require('./text');
const { INTERVALS, VALUE, FEED_BOOST_DURATION_MINUTES } = require('./constants');
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
    let usedAdventureBoost = false;
    if (bukashka.boost === 'adventure_boost') {
      adventureInterval = Math.floor(INTERVALS.ADVENTURE / 1.5);
      usedAdventureBoost = true;
    }

    // Обновляем данные в Firebase с временными метками
    await this.petsRef.child(chatId).update({
      isAdventuring: true,
      adventureResult: adventure,
      adventureStartTime: new Date().toISOString()
    });

    // Устанавливаем таймер для завершения приключения
    this.adventureTimers[chatId] = setTimeout(async () => {
      await this.completeAdventure(chatId);
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

    // Применяем буст на счастье, если он есть
    let adventureHappiness = adventure.happiness;
    let usedHappyBoost = false;
    if (bukashka.boost === 'happy_boost' && adventureHappiness > 0) {
      adventureHappiness = Math.round(adventureHappiness * 1.5);
      usedHappyBoost = true;
    }

    const newFeed = Math.max(0, Math.min(100, bukashka.feed + adventure.feed));
    const newHappy = Math.max(0, Math.min(100, bukashka.happy + adventureHappiness));

    // Логика монеток
    let coinsEarned = 0;
    let levelPoints = 0;
    if (adventure.feed < 0 && adventureHappiness < 0) {
      coinsEarned = Math.floor(Math.random() * 41) + 10; // 10-50 монет
      levelPoints = Math.floor(Math.random() * 4) + 15; // 15-18
    } else if (adventure.feed > 0 || adventureHappiness > 0) {
      coinsEarned = Math.floor(Math.random() * 15) + 5; // 5-20 монет
      levelPoints = Math.floor(Math.random() * 8) + 3; // 3-10
    } else {
      coinsEarned = Math.floor(Math.random() * 5) + 1; // 1-5 монет
      levelPoints = Math.floor(Math.random() * 8) + 3; // 3-10
    }
    // Влияние счастья на уровень
    const happyCoef = ((bukashka.happy || 0) / 100) + 0.5;
    levelPoints = Math.floor(levelPoints * happyCoef);
    const newCoins = (bukashka.coins || 0) + coinsEarned;
    const newLevel = (bukashka.level || 0) + levelPoints;

    // Если был активен adventure_boost, сбрасываем его
    let updateData = {
      feed: newFeed,
      happy: newHappy,
      isAdventuring: false,
      adventureResult: null,
      adventureStartTime: null,
      coins: newCoins,
      level: newLevel
    };
    if (bukashka.boost === 'adventure_boost' || usedHappyBoost) {
      updateData.boost = null;
    }

    // Обновляем данные в Firebase
    await this.petsRef.child(chatId).update(updateData);

    clearTimeout(this.adventureTimers[chatId]);
    delete this.adventureTimers[chatId];

    let usedBoostText = null;
    if (bukashka.boost === 'adventure_boost') {
      usedBoostText = 'Был использован буст: Ускорение приключений.';
    } else if (usedHappyBoost) {
      usedBoostText = 'Был использован буст: Больше счастья.';
    }

    const resultMessage = formatMessage(
      `${TEXT.ADVENTURE.COMPLETE(adventure.text, adventure.feed, adventureHappiness, coinsEarned, usedBoostText, levelPoints, newLevel)}`
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
      let feedDecay = VALUE.FEED_DECAY;

      // Проверяем срок действия feed_boost
      if (bukashka.boost === 'feed_boost') {
        if (!bukashka.feedBoostUntil || Date.now() > new Date(bukashka.feedBoostUntil).getTime()) {
          await petsRef.child(userId).update({ boost: null, feedBoostUntil: null });
        } else {
          feedDecay = feedDecay / 1.5;
        }
      } else if (bukashka.feedBoostUntil) {
        await petsRef.child(userId).update({ feedBoostUntil: null });
      }
      const oldFeed = bukashka.feed || 0;
      const newFeed = Math.max(0, oldFeed - feedDecay);
      const newHappy = Math.max(0, (bukashka.happy || 0) - VALUE.HAPPY_DECAY);
      await petsRef.child(userId).update({ feed: newFeed, happy: newHappy });
      
      // предупреждения о голоде
      const thresholds = [10, 5, 1];
      let lastFeedWarning = bukashka.lastFeedWarning ?? 100;
      const crossed = thresholds.find(threshold =>
        oldFeed > threshold && newFeed <= threshold && threshold < lastFeedWarning
      );
      if (crossed !== undefined) {
        await bot.sendMessage(userId, formatMessage(TEXT.FEED.HUNGRY(bukashka.name, newFeed)), {
          parse_mode: "MarkdownV2",
        });
        await petsRef.child(userId).update({ lastFeedWarning: crossed });
      }
      // Если сытость поднялась выше текущего порога — сбрасываем предупреждение
      if (newFeed > lastFeedWarning) {
        await petsRef.child(userId).update({ lastFeedWarning: 100 });
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
    
    let updateData = {
      boost: boostType,
      coins: (bukashka.coins || 0) - price
    };
    if (boostType === 'feed_boost') {
      updateData.feedBoostUntil = new Date(Date.now() + INTERVALS.FEED_BOOST_DURATION).toISOString();
    } else {
      updateData.feedBoostUntil = null;
    }
    await this.petsRef.child(userId).update(updateData);
    if (replaced) {
      return { replaced, newBoost: boostType };
    }
    return true;
  }

  // Проверка и завершение просроченных приключений
  static async checkAndFinishAdventures(bot, petsRef) {
    const snapshot = await petsRef.once('value');
    const pets = snapshot.val();
    if (!pets) return;
    const now = Date.now();
    for (const [userId, bukashka] of Object.entries(pets)) {
      if (!bukashka || !bukashka.isAdventuring || !bukashka.adventureStartTime) continue;
      let adventureInterval = require('./constants').INTERVALS.ADVENTURE;
      if (bukashka.boost === 'adventure_boost') {
        adventureInterval = Math.floor(adventureInterval / 1.5);
      }
      const startTime = new Date(bukashka.adventureStartTime).getTime();
      const left = (startTime + adventureInterval) - now;
      const petManager = new PetManager(bot);
      if (left <= 0) {
        await petManager.completeAdventure(userId);
      } else {
        // Восстанавливаем таймер на остаток времени
        if (!petManager.adventureTimers) petManager.adventureTimers = {};
        petManager.adventureTimers[userId] = setTimeout(() => {
          petManager.completeAdventure(userId);
        }, left);
      }
    }
  }
}

module.exports = PetManager; 