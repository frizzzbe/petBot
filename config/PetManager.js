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

    if (!bukashka || !bukashka.isAdventuring || !bukashka.state || !bukashka.state.adventureStartTime) {
      return 0;
    }

    const now = Date.now();
    const startTime = new Date(bukashka.state.adventureStartTime).getTime();
    const elapsed = Math.floor((now - startTime) / 1000);
    return Math.max(0, Math.floor(INTERVALS.ADVENTURE / 1000) - elapsed);
  }

  async startAdventure(userId, chatId, ADVENTURES) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();
    if (!bukashka) return;

    // Обновляем lastChatId в state
    const state = { ...(bukashka.state || {}), lastChatId: chatId, adventureStartTime: new Date().toISOString() };
    await this.petsRef.child(userId).update({ state });

    const adventure = ADVENTURES[Math.floor(Math.random() * ADVENTURES.length)];

    // Проверяем наличие ускоряющего буста
    let adventureInterval = INTERVALS.ADVENTURE;
    let usedAdventureBoost = false;
    if (bukashka.boost === 'adventure_boost') {
      adventureInterval = Math.floor(INTERVALS.ADVENTURE / 1.5);
      usedAdventureBoost = true;
    }

    // Обновляем данные в Firebase с временными метками
    await this.petsRef.child(userId).update({
      isAdventuring: true,
      adventureResult: adventure,
      state
    });

    // Устанавливаем таймер для завершения приключения
    this.adventureTimers[userId] = setTimeout(async () => {
      // Получаем актуальный lastChatId из базы
      const snap = await this.petsRef.child(userId).once('value');
      const pet = snap.val();
      const notifyChatId = pet && pet.state && pet.state.lastChatId ? pet.state.lastChatId : userId;
      await this.completeAdventure(userId, notifyChatId);
    }, adventureInterval);

    await this.bot.sendMessage(
      chatId,
      formatMessage(TEXT.ADVENTURE.START(bukashka.name, formatTimeLeft(Math.floor(adventureInterval / 1000)))),
      { parse_mode: "MarkdownV2" }
    );
  }

  async completeAdventure(userId, chatId, username) {
    const snapshot = await this.petsRef.child(userId).once('value');
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
      state: { ...(bukashka.state || {}), adventureStartTime: null },
      coins: newCoins,
      level: newLevel
    };
    if (bukashka.boost === 'adventure_boost' || usedHappyBoost) {
      updateData.boost = null;
    }

    // Обновляем данные в Firebase
    await this.petsRef.child(userId).update(updateData);

    clearTimeout(this.adventureTimers[userId]);
    delete this.adventureTimers[userId];

    let usedBoostText = null;
    if (bukashka.boost === 'adventure_boost') {
      usedBoostText = 'Был использован буст: Ускорение приключений.';
    } else if (usedHappyBoost) {
      usedBoostText = 'Был использован буст: Больше счастья.';
    }

    // Формируем userTag из username или userId
    let userTag = "";
    if (username) {
      userTag = `@${username} `;
    } else {
      userTag = `[user](tg://user?id=${userId}) `;
    } 

    // userTag формируется во внешнем коде и передаётся сюда
    const resultMessage = formatMessage(
      TEXT.ADVENTURE.COMPLETE({
        userTag,
        name: bukashka.name,
        text: adventure.text,
        feed: adventure.feed,
        happiness: adventureHappiness,
        money: coinsEarned,
        usedBoostText,
        levelChange: levelPoints,
        levelNow: newLevel
      })
    );


    await this.bot.sendMessage(chatId, resultMessage, {
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true
    });

    if (newFeed === 0) {
      await this.killBukashka(userId, chatId, "последствий приключения");
    }
  }

  async killBukashka(userId, chatId, reason) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();

    if (bukashka) {
      const creation = new Date(bukashka.creationDate);
      const ageSeconds = isNaN(creation) ? 0 : Math.floor((Date.now() - creation) / 1000);

      // Удаляем данные из Firebase
      await this.petsRef.child(userId).remove();

      // Определяем, куда отправлять сообщение о смерти
      let notifyChatId = chatId;
      if (bukashka.state && bukashka.state.lastChatId) {
        notifyChatId = bukashka.state.lastChatId;
      }

      await this.bot.sendMessage(notifyChatId, formatMessage(TEXT.STATUS.DEAD(reason, formatTimeLeft(ageSeconds))), {
        parse_mode: "MarkdownV2"
      });
    }
  }

  async createBukashka(userId, chatId, name, DEFAULT_BUKASHKA) {
    const bukashkaData = {
      name,
      creationDate: new Date().toISOString(),
      coins: 0,
      state: {
        lastChatId: chatId,
        lastFeedDecayTime: null,
        lastFeedTime: null,
        lastFeedWarning: 100,
        lastGameTime: null,
        adventureStartTime: null,
        feedBoostUntil: null
      },
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
    return bukashka && bukashka.state && bukashka.state.lastFeedTime ? new Date(bukashka.state.lastFeedTime).getTime() : 0;
  }

  // Метод для обновления времени последнего кормления в базе данных
  async updateLastFeedTime(userId, timestamp) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();
    await this.petsRef.child(userId).update({ state: {...bukashka.state, lastFeedTime: timestamp} });
  }

  // Установить фотографию или gif для букашки
  async updloadPetImage(userId, imageObj) {
    await this.petsRef.child(userId).update({
      image: imageObj
    });
  }

  // Получить время последней игры
  async getLastGameTime(userId) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();
    return bukashka && bukashka.state && bukashka.state.lastGameTime ? new Date(bukashka.state.lastGameTime).getTime() : 0;
  }

  // Обновить время последней игры
  async updateLastGameTime(userId, timestamp) {
    // userId — всегда id владельца букашки, а не chatId!
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();
    const state = bukashka?.state || {};
    state.lastGameTime = timestamp;
    await this.petsRef.child(userId).update({ state });
  }

  // уменьшение сытости и счастья у всех букашек
  static async batchFeedDecay(bot, petsRef) {
    const snapshot = await petsRef.once('value');
    const pets = snapshot.val();
    if (!pets) return;
    const now = Date.now();
    for (const [userId, bukashka] of Object.entries(pets)) {
      if (!bukashka) continue;
      if (bukashka.isAdventuring) continue;
      let feedDecay = VALUE.FEED_DECAY;

      // Проверяем срок действия feed_boost
      if (bukashka.boost === 'feed_boost') {
        const state = bukashka.state || {};
        if (!state.feedBoostUntil || now > new Date(state.feedBoostUntil).getTime()) {
          state.feedBoostUntil = null;
          await petsRef.child(userId).update({ boost: null, state });
        } else {
          feedDecay = feedDecay / 1.5;
        }
      } else if (bukashka.state && bukashka.state.feedBoostUntil) {
        const state = bukashka.state || {};
        state.feedBoostUntil = null;
        await petsRef.child(userId).update({ state });
      }

      // --- пропорциональное уменьшение сытости ---
      const lastDecay = bukashka.state && bukashka.state.lastFeedDecayTime ? new Date(bukashka.state.lastFeedDecayTime).getTime() : now;
      const intervalsMissed = Math.floor((now - lastDecay) / INTERVALS.FEED_DECAY) || 1;
      const totalFeedDecay = feedDecay * intervalsMissed;
      const oldFeed = bukashka.feed || 0;
      const newFeed = Math.max(0, oldFeed - totalFeedDecay);
      const newHappy = Math.max(0, (bukashka.happy || 0) - VALUE.HAPPY_DECAY * intervalsMissed);

      const state = bukashka.state || {}
      state.lastFeedDecayTime = new Date(now).toISOString();
      await petsRef.child(userId).update({ feed: newFeed, happy: newHappy, state });
      
      // предупреждения о голоде
      const thresholds = [10, 5, 1];
      let lastFeedWarning = state.lastFeedWarning !== undefined ? state.lastFeedWarning : 100;
      const crossed = thresholds.find(threshold =>
        oldFeed > threshold && newFeed <= threshold && threshold < lastFeedWarning
      );
      if (crossed !== undefined) {
        await bot.sendMessage(userId, formatMessage(TEXT.FEED.HUNGRY(bukashka.name, newFeed)), {
          parse_mode: "MarkdownV2",
        });
        state.lastFeedWarning = crossed;
        await petsRef.child(userId).update({ state });
      }
      // Если сытость поднялась выше текущего порога — сбрасываем предупреждение
      if (newFeed > lastFeedWarning) {
        state.lastFeedWarning = 100;
        await petsRef.child(userId).update({ state });
      }
      if (newFeed <= 0) {
        const petManager = new PetManager(bot);
        // Передаем lastChatId если есть, иначе userId
        const notifyChatId = bukashka.state && bukashka.state.lastChatId ? bukashka.state.lastChatId : userId;
        await petManager.killBukashka(userId, notifyChatId, "голод");
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
      if (!bukashka || !bukashka.isAdventuring || !bukashka.state || !bukashka.state.adventureStartTime) continue;
      const elapsed = Math.floor((now - new Date(bukashka.state.adventureStartTime).getTime()) / 1000);
      if (elapsed >= INTERVALS.ADVENTURE / 1000) {
        const petManager = new PetManager(bot);
        const chatId = bukashka.state && bukashka.state.lastChatId ? bukashka.state.lastChatId : userId;
        // username из bukashka.state или null
        const username = bukashka.state && bukashka.state.username ? bukashka.state.username : null;
        await petManager.completeAdventure(userId, chatId, username);
      }
    }
  }

  // Установить boost для букашки с учетом стоимости
  async setBoost(userId, boostType, price) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();
    const state = bukashka.state || {};
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
      state.feedBoostUntil = new Date(Date.now() + INTERVALS.FEED_BOOST_DURATION).toISOString();
    } else {
      state.feedBoostUntil = null;
    }
    updateData.state = state;
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
      if (!bukashka || !bukashka.isAdventuring || !bukashka.state || !bukashka.state.adventureStartTime) continue;
      let adventureInterval = require('./constants').INTERVALS.ADVENTURE;
      if (bukashka.boost === 'adventure_boost') {
        adventureInterval = Math.floor(adventureInterval / 1.5);
      }
      const startTime = new Date(bukashka.state.adventureStartTime).getTime();
      const left = (startTime + adventureInterval) - now;
      const petManager = new PetManager(bot);
      const chatId = bukashka.state && bukashka.state.lastChatId ? bukashka.state.lastChatId : userId;
      // username из bukashka.state или null
      const username = bukashka.state && bukashka.state.username ? bukashka.state.username : null;
      if (left <= 0) {
        await petManager.completeAdventure(userId, chatId, username);
      } else {
        // Восстанавливаем таймер на остаток времени
        if (!petManager.adventureTimers) petManager.adventureTimers = {};
        petManager.adventureTimers[userId] = setTimeout(async () => {
          const snap = await petsRef.child(userId).once('value');
          const pet = snap.val();
          const notifyChatId = pet && pet.state && pet.state.lastChatId ? pet.state.lastChatId : userId;
          const username = pet && pet.state && pet.state.username ? pet.state.username : null;
          await petManager.completeAdventure(userId, notifyChatId, username);
        }, left);
      }
    }
  }
}

module.exports = PetManager; 