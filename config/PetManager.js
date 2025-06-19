const { formatMessage, formatTimeLeft } = require('./actions');
const { TEXT } = require('./text');
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
    const startTime = bukashka.adventureStartTime;
    const elapsed = Math.floor((now - startTime) / 1000);
    return Math.max(0, 30 - elapsed);
  }

  async startAdventure(chatId, ADVENTURES) {
    const snapshot = await this.petsRef.child(chatId).once('value');
    const bukashka = snapshot.val();
    if (!bukashka) return;

    const adventure = ADVENTURES[Math.floor(Math.random() * ADVENTURES.length)];
    
    // Обновляем данные в Firebase с временными метками
    await this.petsRef.child(chatId).update({
      isAdventuring: true,
      adventureResult: adventure,
      adventureStartTime: Date.now()
    });

    // Устанавливаем таймер для завершения приключения
    this.adventureTimers[chatId] = setTimeout(() => {
      this.completeAdventure(chatId);
    }, 30 * 1000);

    await this.bot.sendMessage(
      chatId,
      formatMessage(TEXT.ADVENTURE.START(bukashka.name, formatTimeLeft(30))),
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

    // Обновляем данные в Firebase
    await this.petsRef.child(chatId).update({
      feed: newFeed,
      happy: newHappy,
      isAdventuring: false,
      adventureResult: null,
      adventureStartTime: null
    });

    clearTimeout(this.adventureTimers[chatId]);
    delete this.adventureTimers[chatId];

    const resultMessage = formatMessage(TEXT.ADVENTURE.COMPLETE(adventure.text, adventure.feed, adventure.happiness));

    await this.bot.sendMessage(chatId, resultMessage, {
      parse_mode: "MarkdownV2",
    });

    if (newFeed === 0) {
      await this.killBukashka(chatId, chatId, "последствий приключения");
    }
  }

  async startFeedTimer(userId, chatId) {
    if (this.feedTimers[userId]) {
      clearInterval(this.feedTimers[userId]);
    }

    this.feedTimers[userId] = setInterval(async () => {
      const snapshot = await this.petsRef.child(userId).once('value');
      const bukashka = snapshot.val();
      
      if (bukashka) {
        if (bukashka.isAdventuring) return;

        const newFeed = Math.max(0, bukashka.feed - 1);
        const newHappy = Math.max(0, bukashka.happy - 5);

        // Обновляем данные в Firebase
        await this.petsRef.child(userId).update({
          feed: newFeed,
          happy: newHappy
        });

        if (newFeed < 10 && [10, 5, 1].includes(newFeed)) {
          await this.bot.sendMessage(chatId, formatMessage(TEXT.FEED.HUNGRY(bukashka.name, newFeed)), {
            parse_mode: "MarkdownV2",
          });
        }

        if (newFeed === 0) {
          await this.killBukashka(userId, chatId, "голод");
        }
      }
    }, 3 * 60 * 60 * 1000);
  }

  stopFeedTimer(userId) {
    if (this.feedTimers[userId]) {
      clearInterval(this.feedTimers[userId]);
      delete this.feedTimers[userId];
    }
  }

  async killBukashka(userId, chatId, reason) {
    const snapshot = await this.petsRef.child(userId).once('value');
    const bukashka = snapshot.val();
    
    if (bukashka) {
      const age = Math.floor((Date.now() - new Date(bukashka.creationDate)) / (24 * 60 * 60 * 1000));

      this.stopFeedTimer(userId);
      
      // Удаляем данные из Firebase
      await this.petsRef.child(userId).remove();

      await this.bot.sendMessage(chatId, formatMessage(TEXT.STATUS.DEAD(reason, formatTimeLeft(age * 24 * 60 * 60))), {
        parse_mode: "MarkdownV2"
      });
    }
  }

  async createBukashka(userId, chatId, name, DEFAULT_BUKASHKA) {
    const bukashkaData = {
      name,
      creationDate: new Date().toISOString(),
      lastFeedTime: Date.now(),
      adventureStartTime: null,
      ...DEFAULT_BUKASHKA
    };

    // Сохраняем данные в Firebase
    await this.petsRef.child(userId).set(bukashkaData);

    this.startFeedTimer(userId, chatId);
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
    return bukashka ? bukashka.lastFeedTime : 0;
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
}

module.exports = PetManager; 