const { formatMessage, formatTimeLeft } = require('./actions');

class BukashkaManager {
  constructor(bot) {
    this.bot = bot;
    this.userBukashki = {};
    this.feedTimers = {};
    this.lastFeedTime = {};
    this.adventureTimers = {};
    this.adventureStartTime = {};
  }

  isInAdventure(userId) {
    const bukashka = this.userBukashki[userId];
    return bukashka && bukashka.isAdventuring;
  }

  getAdventureTimeLeft(userId) {
    const startTime = this.adventureStartTime[userId];
    if (!startTime) return 0;

    const now = Date.now();
    const elapsed = Math.floor((now - startTime) / 1000);
    return Math.max(0, 30 - elapsed);
  }

  async startAdventure(chatId, ADVENTURES) {
    const bukashka = this.userBukashki[chatId];
    if (!bukashka) return;

    const adventure = ADVENTURES[Math.floor(Math.random() * ADVENTURES.length)];
    bukashka.isAdventuring = true;
    bukashka.adventureResult = adventure;
    this.adventureStartTime[chatId] = Date.now();

    this.adventureTimers[chatId] = setTimeout(() => {
      this.completeAdventure(chatId);
    }, 30 * 1000);

    await this.bot.sendMessage(
      chatId,
      formatMessage(`Ваша букашка ${bukashka.name} отправилась в приключение!\n\nБукашка вернется через ${formatTimeLeft(30)}. Во время приключения вы не сможете кормить букашку.`),
      { parse_mode: "MarkdownV2" }
    );
  }

  async completeAdventure(chatId) {
    const bukashka = this.userBukashki[chatId];
    if (!bukashka || !bukashka.isAdventuring) return;

    const adventure = bukashka.adventureResult;

    bukashka.feed = Math.max(0, Math.min(100, bukashka.feed + adventure.feed));
    bukashka.happy = Math.max(0, Math.min(100, bukashka.happy + adventure.happiness));

    clearTimeout(this.adventureTimers[chatId]);
    delete this.adventureTimers[chatId];
    delete this.adventureStartTime[chatId];
    bukashka.isAdventuring = false;

    const resultMessage = formatMessage(`
🎒 *Приключение завершено!* 🎒

${adventure.text}

Эффекты:
${adventure.feed > 0 ? '+' : ''}${adventure.feed} к сытости 🌱
${adventure.happiness > 0 ? '+' : ''}${adventure.happiness} к счастью 😊
`);

    await this.bot.sendMessage(chatId, resultMessage, {
      parse_mode: "MarkdownV2",
    });

    if (bukashka.feed === 0) {
      await this.killBukashka(chatId, chatId, "последствий приключения");
    }
  }

  startFeedTimer(userId, chatId) {
    if (this.feedTimers[userId]) {
      clearInterval(this.feedTimers[userId]);
    }

    this.feedTimers[userId] = setInterval(async () => {
      if (this.userBukashki[userId]) {
        if (this.isInAdventure(userId)) return;

        const bukashka = this.userBukashki[userId];
        bukashka.feed = Math.max(0, bukashka.feed - 1);
        bukashka.happy = Math.max(0, bukashka.happy - 5);

        if (bukashka.feed < 10 && [10, 5, 1].includes(bukashka.feed)) {
          const hungerMessage = formatMessage(`
                    ⚠️ *Внимание!* Ваша букашка ${bukashka.name} голодна! 🐛

                    Текущий уровень сытости: ${bukashka.feed} 🌱
                    Пожалуйста, покормите вашего питомца, используя команду "⭐️ Покормить"!
                    `);

          await this.bot.sendMessage(chatId, hungerMessage, {
            parse_mode: "MarkdownV2",
          });
        }

        if (bukashka.feed === 0) {
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
    if (this.userBukashki[userId]) {
      const bukashka = this.userBukashki[userId];
      const age = Math.floor((Date.now() - new Date(bukashka.creationDate)) / (24 * 60 * 60 * 1000));
      const deathMessage = formatMessage(`💀 *Ваша букашка ${bukashka.name} умерла!* 

Причина: ${reason}
Возраст: ${formatTimeLeft(age * 24 * 60 * 60)}

Вы можете завести новую букашку, используя команду "⭐️ Взять букашку"`);

      this.stopFeedTimer(userId);
      delete this.userBukashki[userId];

      await this.bot.sendMessage(chatId, deathMessage, {
        parse_mode: "MarkdownV2"
      });
    }
  }

  async createBukashka(userId, chatId, name, DEFAULT_BUKASHKA) {
    this.userBukashki[userId] = {
      name,
      creationDate: new Date().toISOString(),
      ...DEFAULT_BUKASHKA
    };

    this.startFeedTimer(userId, chatId);
  }

  getBukashka(userId) {
    return this.userBukashki[userId];
  }

  async emptyPetMsg(chatId) {
    await this.bot.sendMessage(
      chatId,
      formatMessage("У вас пока нет букашки! Используйте команду 'взять букашку', чтобы завести питомца. 🐛"),
      { parse_mode: "MarkdownV2" }
    );
  }
}

module.exports = BukashkaManager; 