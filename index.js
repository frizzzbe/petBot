const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

require("dotenv").config();

const bot = new TelegramBot(process.env.API_KEY_BOT, {
	polling: true,
});

//Массив с объектами для меню команд
const commands = [
	{ command: "start", description: "Запуск бота" },
	{ command: "help", description: "Раздел помощи" },
];

const userBukashki = {};
const feedTimers = {};
const lastFeedTime = {}; // Хранит время последнего кормления для каждого пользователя

// Функция для форматирования информации о букашке
function formatBukashkaInfo(bukashka, feedChange = 0) {
	const feedDisplay = feedChange
		? `${bukashka.feed} \\(\\+${feedChange}\\)`
		: bukashka.feed;

	// Вычисляем возраст букашки
	const now = new Date();
	const creationDate = new Date(bukashka.creationDate);
	const ageDiff = now - creationDate;

	// Конвертируем в минуты, часы и дни
	const minutes = Math.floor(ageDiff / (1000 * 60));
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	// Форматируем возраст в зависимости от времени жизни
	let ageDisplay;
	if (days > 0) {
		const remainingHours = hours % 24;
		ageDisplay = `${days} дн\\. ${remainingHours} ч\\.`;
	} else if (hours > 0) {
		const remainingMinutes = minutes % 60;
		ageDisplay = `${hours} ч\\. ${remainingMinutes} мин\\.`;
	} else {
		ageDisplay = `${minutes} мин\\.`;
	}

	return `
✨ Информация о вашей букашке\\! 🐛

**Имя:** ${bukashka.name}  
**Возраст:** ${ageDisplay}  
**Уровень:** ${bukashka.level}  
**Сытость:** ${feedDisplay} 🌱  
**Счастье:** ${bukashka.happy} 😊

${
	feedChange
		? "Спасибо, что покормили вашего питомца\\! 💖"
		: "Ваш питомец очень рад вас видеть\\! 💖"
}
  `;
}

// Функция для отправки информации о букашке
async function sendBukashkaInfo(chatId, bukashka, feedChange = 0) {
	const message = formatBukashkaInfo(bukashka, feedChange);

	if (bukashka.image) {
		// Если есть фото букашки, отправляем его с информацией
		await bot.sendPhoto(chatId, bukashka.image, {
			caption: message,
			parse_mode: "MarkdownV2",
		});
	} else {
		// Если фото нет, отправляем только информацию
		await bot.sendMessage(chatId, message, {
			parse_mode: "MarkdownV2",
		});
	}
}

// Функция для запуска таймера уменьшения сытости
function startFeedTimer(userId, chatId) {
	// Останавливаем предыдущий таймер, если он существует
	if (feedTimers[userId]) {
		clearInterval(feedTimers[userId]);
	}

	// Запускаем новый таймер
	feedTimers[userId] = setInterval(async () => {
		if (userBukashki[userId]) {
			const bukashka = userBukashki[userId];
			bukashka.feed = Math.max(0, bukashka.feed - 1); // Уменьшаем сытость, но не ниже 0

			// Если букашка голодная, отправляем уведомление
			if (bukashka.feed < 10) {
				// Отправляем уведомление только при определенных уровнях сытости
				if ([10, 5, 1].includes(bukashka.feed)) {
					const hungerMessage = `
⚠️ *Внимание\\!* Ваша букашка ${bukashka.name} голодна\\! 🐛

Текущий уровень сытости: ${bukashka.feed} 🌱
Пожалуйста, покормите вашего питомца, используя команду "⭐️ Покормить"\\!
`;

					await bot.sendMessage(chatId, hungerMessage, {
						parse_mode: "MarkdownV2",
					});
				}
			}

			// Проверка на смерть от голода
			if (bukashka.feed === 0) {
				await killBukashka(userId, chatId, "голод");
			}
		}
	}, 3000); // 3 секунды
}

// Функция для остановки таймера
function stopFeedTimer(userId) {
	if (feedTimers[userId]) {
		clearInterval(feedTimers[userId]);
		delete feedTimers[userId];
	}
}

// Функция для убийства букашки
async function killBukashka(userId, chatId, reason) {
	if (userBukashki[userId]) {
		const bukashka = userBukashki[userId];
		const deathMessage = `
💀 *Ваша букашка ${bukashka.name} умерла\\!* 

Причина смерти: ${reason}
Возраст на момент смерти: ${calculateAge(bukashka.creationDate)}

Нажмите "⭐️ Взять букашку", чтобы завести нового питомца\\. 🐛
`;

		// Останавливаем таймер
		stopFeedTimer(userId);

		// Удаляем букашку
		delete userBukashki[userId];

		await bot.sendMessage(chatId, deathMessage, {
			parse_mode: "MarkdownV2",
		});
	}
}

// Функция для расчета возраста букашки
function calculateAge(creationDate) {
	const now = new Date();
	const creation = new Date(creationDate);
	const ageDiff = now - creation;

	const minutes = Math.floor(ageDiff / (1000 * 60));
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		const remainingHours = hours % 24;
		return `${days} дн\\. ${remainingHours} ч\\.`;
	} else if (hours > 0) {
		const remainingMinutes = minutes % 60;
		return `${hours} ч\\. ${remainingMinutes} мин\\.`;
	} else {
		return `${minutes} мин\\.`;
	}
}

// Функция для определения результата кормления
function getFeedResult(bukashkaName) {
	const random = Math.random() * 100; // Генерируем число от 0 до 100

	if (random < 60) {
		return {
			type: "водичку",
			amount: 5,
			happiness: 0,
			message: `${bukashkaName} выпила водичку 🍽️\nСытость увеличилась на 5 🌱`,
		};
	} else if (random < 90) {
		return {
			type: "листик",
			amount: 10,
			happiness: 5,
			message: `${bukashkaName} съела листик 🍽️\nСытость увеличилась на 10 🌱\nСчастье увеличилось на 5 😊`,
		};
	} else {
		return {
			type: "яблочко",
			amount: 20,
			happiness: 15,
			message: `🎉 *Невероятно\\!* 🎉\n\nВаша ${bukashkaName} нашла и съела яблочко\\! 🍎\nСытость увеличилась на 20 🌱\nСчастье увеличилось на 15 😊\n\nВаша букашка очень счастлива\\! 💖`,
		};
	}
}

//Устанавливаем меню команд
bot.setMyCommands(commands);

bot.on("text", async (msg) => {
	try {
		if (msg.text.startsWith("/start")) {
			await bot.sendMessage(msg.chat.id, `Вы запустили бота! 👋🏻`, {
				reply_markup: {
					keyboard: [
						["⭐️ Взять букашку", "⭐️ Покормить"],
						["⭐️ Моя букашка", "⭐️ Картинка"],
						["❌ Закрыть меню"],
					],
					resize_keyboard: true,
				},
			});
		} else if (msg.text == "/help") {
			const helpMessage = `
Доступные команды бота: 🐛

/start - Запуск бота и получение основного меню
/help - Показать это сообщение с описанием команд

Основные действия:
⭐️ Взять букашку - Завести нового питомца
⭐️ Покормить - Покормить вашу букашку
⭐️ Моя букашка - Посмотреть информацию о вашем питомце
⭐️ Картинка - Отправить фото для вашей букашки

Важно знать:
• Если сытость упадет до 0, букашка умрет от голода
• Команда "раздавить букашку" позволит вам избавиться от питомца

Управление меню:
❌ Закрыть меню - Скрыть клавиатуру

Нажмите на команду, чтобы использовать её!
`;

			await bot.sendMessage(msg.chat.id, helpMessage, {
				disable_web_page_preview: true,
			});
		} else if (msg.text == "⭐️ Взять букашку") {
			const userId = msg.from.id;
			if (!userBukashki[userId]) {
				await bot.sendMessage(
					msg.chat.id,
					"Как вы хотите назвать вашу букашку? 🐛"
				);

				bot.once("message", async (nameMsg) => {
					const buakakaName = nameMsg.text;

					// Инициализация букашки с датой создания
					userBukashki[userId] = {
						name: buakakaName,
						creationDate: new Date().toISOString(),
						level: 1,
						feed: 10,
						happy: 50,
						image: null,
					};

					const bukashka = userBukashki[userId];
					await sendBukashkaInfo(msg.chat.id, bukashka);

					// Запускаем таймер уменьшения сытости
					startFeedTimer(userId, msg.chat.id);
				});
			} else {
				await bot.sendMessage(
					msg.chat.id,
					"У вас уже есть букашка! Используйте другие команды для ухода за ней."
				);
			}
		} else if (msg.text == "⭐️ Покормить") {
			const userId = msg.from.id;
			if (userBukashki[userId]) {
				// Проверяем, прошло ли 3 секунды с последнего кормления
				const now = Date.now();
				const lastFeed = lastFeedTime[userId] || 0;

				if (now - lastFeed < 3000) {
					const remainingTime = Math.ceil((3000 - (now - lastFeed)) / 1000);
					await bot.sendMessage(
						msg.chat.id,
						`Подождите еще ${remainingTime} сек\\. перед следующим кормлением\\! ⏳`,
						{ parse_mode: "MarkdownV2" }
					);
					return;
				}

				const bukashka = userBukashki[userId];
				const feedResult = getFeedResult(bukashka.name);

				// Обновляем время последнего кормления
				lastFeedTime[userId] = now;

				// Увеличиваем сытость и счастье в зависимости от результата
				bukashka.feed = Math.min(100, bukashka.feed + feedResult.amount);
				bukashka.happy = Math.min(100, bukashka.happy + feedResult.happiness);

				await bot.sendMessage(msg.chat.id, feedResult.message, {
					parse_mode: "MarkdownV2",
				});

				await sendBukashkaInfo(msg.chat.id, bukashka, feedResult.amount);
			} else {
				await bot.sendMessage(
					msg.chat.id,
					"У вас пока нет букашки\\! Используйте команду 'взять букашку', чтобы завести питомца\\. 🐛",
					{ parse_mode: "MarkdownV2" }
				);
			}
		} else if (msg.text == "⭐️ Моя букашка") {
			const userId = msg.from.id;
			if (userBukashki[userId]) {
				const bukashka = userBukashki[userId];
				await sendBukashkaInfo(msg.chat.id, bukashka);
			} else {
				await bot.sendMessage(
					msg.chat.id,
					"У вас пока нет букашки\\! Используйте команду 'взять букашку', чтобы завести питомца\\. 🐛",
					{ parse_mode: "MarkdownV2" }
				);
			}
		} else if (msg.text == "⭐️ Картинка") {
			await bot.sendMessage(
				msg.chat.id,
				"Пожалуйста, отправьте изображение, которое вы хотите отправить обратно."
			);
		} else if (msg.text == "раздавить букашку") {
			const userId = msg.from.id;
			if (userBukashki[userId]) {
				await killBukashka(userId, msg.chat.id, "раздавлена хозяином");
			} else {
				await bot.sendMessage(
					msg.chat.id,
					"У вас нет букашки, которую можно раздавить\\! 🐛",
					{ parse_mode: "MarkdownV2" }
				);
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

		if (userBukashki[userId]) {
			userBukashki[userId].image = photo.file_id;

			await sendBukashkaInfo(msg.chat.id, userBukashki[userId]);
		} else {
			await bot.sendPhoto(msg.chat.id, photo.file_id, {
				caption: `Привет, ${bukashka.name}\\!`,
				parse_mode: "MarkdownV2",
			});
		}
	} catch (error) {
		console.log(error);
	}
});
