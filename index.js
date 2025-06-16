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
const adventureTimers = {}; // Хранит таймеры приключений
const adventureStartTime = {}; // Хранит время начала приключения

// Массив с возможными приключениями и их эффектами
const adventures = [
	{
		text: "Выша букашка наступила в жвачку и долго провозилась",
		feed: -3,
		happiness: -5
	},
	{
		text: "Встретила ёжика и сильно перепугалась",
		feed: -2,
		happiness: -8
	},
	{
		text: "Нашла другую букашку и весело провела время",
		feed: 0,
		happiness: 20
	},
	{
		text: "Встретила светлячка, который предложил ей светлую ночь под звездным небом",
		feed: 5,
		happiness: 25
	},
	{
		text: "Капелька попала прямо на букашку, в такие дни лучше оставаться в сухом местечке",
		feed: -4,
		happiness: -3
	},
	{
		text: "Она попала в ловушку паука, но смекалка помогла ей выбраться",
		feed: -5,
		happiness: 10
	},
	{
		text: "Встретила старую пчелу, которая рассказала ей восхитительные истории о жизни на улье",
		feed: 0,
		happiness: 20
	},
	{
		text: "Букашка нашла блестящий камушек и подумала, что это волшебный артефакт, но даже если и так, то у нее врядли получилось бы его утащить ((",
		feed: -1,
		happiness: 10
	},
	{
		text: "Букашка поймала ветерок и хорошо повеселилась",
		feed: 0,
		happiness: 15
	},
	{
		text: "Букашка узнала что муравьи очень хорошие друзья",
		feed: 5,
		happiness: 10
	},
	{
		text: "Во время прогулки по саду букашка обнаруживает спелые клубники, прятавшиеся под зелеными листьями",
		feed: 15,
		happiness: 20
	},
	{
		text: "Букашка замечает цветущий куст малины и решает полакомиться",
		feed: 12,
		happiness: 15
	},
	{
		text: "В лесу букашка встречает грибницу и находит много съедобных грибов",
		feed: 20,
		happiness: 10
	},
	{
		text: "Она наткнулась на заброшенную ферму и обнаружила полные корзины с яблоками, которые все переели червяки, но несколько еще остались вкусными и свежими",
		feed: 10,
		happiness: 5
	},
	{
		text: "Во время дождя букашка находит спрятанные соки в трещинах древесины и устраивает праздник с тропическими вкусами",
		feed: 8,
		happiness: 25
	},
	{
		text: "Букашка неожиданно сталкивается с большой крысой, которая пытается поймать её. Её страх охватывает, но она находит путь к безопасности, прятаться под листьями.",
		feed: -3,
		happiness: -10
	},
	{
		text: "Во время сильного дождя букашка оказывается в потоке воды, который стремительно уносит её от дома. Ей было непросто вернуться домой",
		feed: -8,
		happiness: -8
	},
	{
		text: "Она попадает под лапу гуляющей собаки, которая с любопытством пытается её рассмотреть, но к счастью всё обошлось простым испугом",
		feed: -4,
		happiness: -5
	},
	{
		text: "Букашка оказывается в луже, где неожиданно появляется гигантская жаба. Она с испугом наблюдает, как жаба ловит муху, осознавая, что сама может стать её следующей жертвой",
		feed: -6,
		happiness: -12
	},
	{
		text: "Бродя вдоль края пруда, букашка была вовлечена в попытку жабы поймать её, и когда язык жабы резким движением проскользнул в нескольких сантиметрах от неё, у букашки словно вся жизнь пронеслась перед глазами",
		feed: -7,
		happiness: -15
	}
];

// Функция для проверки, находится ли букашка в приключении
const isInAdventure = (userId) => {
	return adventureTimers[userId] !== undefined;
};

// Функция для получения оставшегося времени приключения
const getAdventureTimeLeft = (userId) => {
	if (!adventureStartTime[userId]) return 0;
	const now = Date.now();
	const timeLeft = 6 * 60 * 60 * 1000 - (now - adventureStartTime[userId]);
	return Math.max(0, timeLeft);
};

// Функция для форматирования оставшегося времени
const formatTimeLeft = (timeLeft) => {
	const hours = Math.floor(timeLeft / (60 * 60 * 1000));
	const minutes = Math.floor((timeLeft % (60 * 60 * 1000)) / (60 * 1000));
	return `${hours} ч. ${minutes} мин.`;
};

// Функция для экранирования специальных символов в тексте
const escapeMarkdown = (text) => {
	if (!text) return '';
	return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&').replace(/!/g, '\\!');
};

// Функция для форматирования сообщений в MarkdownV2
const formatMessage = (text) => {
	if (!text) return '';
	
	// Список специальных символов, которые нужно экранировать
	const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
	
	// Экранируем каждый специальный символ
	let result = text;
	specialChars.forEach(char => {
		const regex = new RegExp(`\\${char}`, 'g');
		result = result.replace(regex, `\\${char}`);
	});
	
	return result;
};

// Функция для завершения приключения
const completeAdventure = async (userId, chatId) => {
	if (!isInAdventure(userId)) return;

	const bukashka = userBukashki[userId];
	if (!bukashka) return;

	// Выбираем случайное приключение
	const adventure = adventures[Math.floor(Math.random() * adventures.length)];

	// Применяем эффекты приключения
	bukashka.feed = Math.max(0, Math.min(100, bukashka.feed + adventure.feed));
	bukashka.happy = Math.max(0, Math.min(100, bukashka.happy + adventure.happiness));

	// Очищаем таймер и время начала
	clearTimeout(adventureTimers[userId]);
	delete adventureTimers[userId];
	delete adventureStartTime[userId];

	// Отправляем сообщение о результатах приключения
	const resultMessage = formatMessage(`
🎒 *Приключение завершено!* 🎒

${adventure.text}

Эффекты:
${adventure.feed > 0 ? '+' : ''}${adventure.feed} к сытости 🌱
${adventure.happiness > 0 ? '+' : ''}${adventure.happiness} к счастью 😊
`);

	await bot.sendMessage(chatId, resultMessage, {
		parse_mode: "MarkdownV2",
	});

	// Проверяем, не умерла ли букашка от последствий приключения
	if (bukashka.feed === 0) {
		await killBukashka(userId, chatId, "последствий приключения");
		return;
	}

	// Показываем обновленную информацию о букашке
	await sendBukashkaInfo(chatId, bukashka);
};

// Функция для форматирования информации о букашке
const formatBukashkaInfo = (bukashka, feedChange = 0, happinessChange = 0) => {
	const feedDisplay = feedChange
		? `${bukashka.feed} (+${feedChange})`
		: bukashka.feed;

	const happinessDisplay = happinessChange
		? `${bukashka.happy} (+${happinessChange})`
		: bukashka.happy;

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
		ageDisplay = `${days} дн. ${remainingHours} ч.`;
	} else if (hours > 0) {
		const remainingMinutes = minutes % 60;
		ageDisplay = `${hours} ч. ${remainingMinutes} мин.`;
	} else {
		ageDisplay = `${minutes} мин.`;
	}

	// Проверяем статус приключения
	const adventureStatus = isInAdventure(bukashka.userId) 
		? `\n**Статус:** В приключении 🎒\nОсталось времени: ${formatTimeLeft(getAdventureTimeLeft(bukashka.userId))}`
		: '';

	return formatMessage(`
✨ Информация о вашей букашке! 🐛

**Имя:** ${bukashka.name}  
**Возраст:** ${ageDisplay}  
**Уровень:** ${bukashka.level}  
**Сытость:** ${feedDisplay} 🌱  
**Счастье:** ${happinessDisplay} 😊${adventureStatus}

${
	feedChange || happinessChange
		? "Спасибо, что покормили вашу букашку! 💖"
		: "Ваша букашка очень рада вас видеть! 💖"
}
  `);
};

// Функция для отправки информации о букашке
const sendBukashkaInfo = async (chatId, bukashka, feedChange = 0, happinessChange = 0) => {
	const message = formatBukashkaInfo(bukashka, feedChange, happinessChange);

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
};

// Функция для запуска таймера уменьшения сытости
const startFeedTimer = (userId, chatId) => {
	// Останавливаем предыдущий таймер, если он существует
	if (feedTimers[userId]) {
		clearInterval(feedTimers[userId]);
	}

	// Запускаем новый таймер
	feedTimers[userId] = setInterval(async () => {
		if (userBukashki[userId]) {
			// Проверяем, не находится ли букашка в приключении
			if (isInAdventure(userId)) {
				return; // Пропускаем уменьшение сытости во время приключения
			}

			const bukashka = userBukashki[userId];
			bukashka.feed = Math.max(0, bukashka.feed - 1); // Уменьшаем сытость, но не ниже 0

			// Если букашка голодная, отправляем уведомление
			if (bukashka.feed < 10) {
				// Отправляем уведомление только при определенных уровнях сытости
				if ([10, 5, 1].includes(bukashka.feed)) {
					const hungerMessage = formatMessage(`
⚠️ *Внимание!* Ваша букашка ${bukashka.name} голодна! 🐛

Текущий уровень сытости: ${bukashka.feed} 🌱
Пожалуйста, покормите вашего питомца, используя команду "⭐️ Покормить"!
`);

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
};

// Функция для остановки таймера
const stopFeedTimer = (userId) => {
	if (feedTimers[userId]) {
		clearInterval(feedTimers[userId]);
		delete feedTimers[userId];
	}
};

// Функция для убийства букашки
const killBukashka = async (userId, chatId, reason) => {
	if (userBukashki[userId]) {
		const bukashka = userBukashki[userId];
		const deathMessage = formatMessage(`
💀 *Ваша букашка ${bukashka.name} умерла!* 

Причина смерти: ${reason}
Возраст на момент смерти: ${calculateAge(bukashka.creationDate)}

Нажмите "⭐️ Взять букашку", чтобы завести нового питомца. 🐛
`);

		// Останавливаем таймер
		stopFeedTimer(userId);

		// Удаляем букашку
		delete userBukashki[userId];

		await bot.sendMessage(chatId, deathMessage, {
			parse_mode: "MarkdownV2",
		});
	}
};

// Функция для расчета возраста букашки
const calculateAge = (creationDate) => {
	const now = new Date();
	const creation = new Date(creationDate);
	const ageDiff = now - creation;

	const minutes = Math.floor(ageDiff / (1000 * 60));
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		const remainingHours = hours % 24;
		return `${days} дн. ${remainingHours} ч.`;
	} else if (hours > 0) {
		const remainingMinutes = minutes % 60;
		return `${hours} ч. ${remainingMinutes} мин.`;
	} else {
		return `${minutes} мин.`;
	}
};

// Функция для определения результата кормления
const getFeedResult = (bukashkaName) => {
	const random = Math.random() * 100; // Генерируем число от 0 до 100

	if (random < 5) {
		return {
			type: "говняшка",
			amount: -5,
			happiness: -10,
			message: formatMessage(`😱 *О нет!* Ваша ${bukashkaName} случайно съела говняшку! 💩\nСытость уменьшилась на 5 🌱\nСчастье уменьшилось на 10 😢`),
		};
	} else if (random < 60) {
		return {
			type: "водичку",
			amount: 5,
			happiness: 0,
			message: formatMessage(`${bukashkaName} выпила водичку 🍽️\nСытость увеличилась на 5 🌱`),
		};
	} else if (random < 90) {
		return {
			type: "листик",
			amount: 10,
			happiness: 5,
			message: formatMessage(`${bukashkaName} съела листик 🍽️\nСытость увеличилась на 10 🌱\nСчастье увеличилось на 5 😊`),
		};
	} else {
		return {
			type: "яблочко",
			amount: 20,
			happiness: 15,
			message: formatMessage(`🎉 *Невероятно!* 🎉\n\nВаша ${bukashkaName} нашла и съела яблочко! 🍎\nСытость увеличилась на 20 🌱\nСчастье увеличилось на 15 😊\n\nВаша букашка очень счастлива! 💖`),
		};
	}
};

// Функция для нормализации текста команды
const normalizeCommand = (text) => {
	// Удаляем все символы, кроме букв, цифр и пробелов, и приводим к нижнему регистру
	return text.toLowerCase().replace(/[^а-яёa-z0-9\s]/gi, '').trim();
};

//Устанавливаем меню команд
bot.setMyCommands(commands);

bot.on("text", async (msg) => {
	try {
		const normalizedText = normalizeCommand(msg.text);
		console.log('Normalized text:', normalizedText); // Добавляем для отладки

		if (msg.text.startsWith("/start")) {
			await bot.sendMessage(msg.chat.id, `Вы запустили бота! 👋🏻`, {
				reply_markup: {
					keyboard: [
						["⭐️ Взять букашку", "⭐️ Покормить"],
						["⭐️ Моя букашка", "❓ Где букашка"],
						["🎒 Букашку в приключение"],
					],
					resize_keyboard: true,
				},
			});
		} else if (msg.text === "/help" || normalizedText === "help") {
			const helpMessage = formatMessage(`
Доступные команды бота: 🐛

/start - Запуск бота и получение основного меню
/help - Показать это сообщение с описанием команд

Основные действия:
⭐️ Взять букашку - Завести нового питомца
⭐️ Покормить - Покормить вашу букашку
⭐️ Моя букашка - Посмотреть информацию о вашем питомце
⭐️ Картинка - Отправить фото для вашей букашки
🎒 Букашку в приключение - Отправить букашку в 6-часовое приключение
❓ Где букашка - Проверить статус приключения

Важно знать:
• Если сытость упадет до 0, букашка умрет от голода
• Во время приключения нельзя кормить букашку
• Команда "раздавить букашку" позволит вам избавиться от питомца

Нажмите на команду, чтобы использовать её!
`);

			await bot.sendMessage(msg.chat.id, helpMessage, {
				disable_web_page_preview: true,
			});
		} else if (normalizedText === "взять букашку") {
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
						userId: userId,
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
		} else if (normalizedText === "покормить") {
			const userId = msg.from.id;
			if (userBukashki[userId]) {
				if (isInAdventure(userId)) {
					await bot.sendMessage(
						msg.chat.id,
						formatMessage("Ваша букашка сейчас в приключении и не может есть! Подождите, пока она вернется. 🎒"),
						{ parse_mode: "MarkdownV2" }
					);
					return;
				}

				// Проверяем, прошло ли 3 секунды с последнего кормления
				const now = Date.now();
				const lastFeed = lastFeedTime[userId] || 0;

				if (now - lastFeed < 3000) {
					const remainingTime = Math.ceil((3000 - (now - lastFeed)) / 1000);
					await bot.sendMessage(
						msg.chat.id,
						formatMessage(`Подождите еще ${remainingTime} сек. перед следующим кормлением! ⏳`),
						{ parse_mode: "MarkdownV2" }
					);
					return;
				}

				try {
					const bukashka = userBukashki[userId];
					const feedResult = getFeedResult(bukashka.name);

					// Обновляем время последнего кормления
					lastFeedTime[userId] = now;

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
						await killBukashka(userId, msg.chat.id, "Поела говна и померла 😢");
						return;
					}

					await sendBukashkaInfo(msg.chat.id, bukashka, feedResult.amount, feedResult.happiness);
				} catch (error) {
					await bot.sendMessage(msg.chat.id, "Произошла ошибка при кормлении букашки. Попробуйте еще раз.");
				}
			} else {
				await bot.sendMessage(
					msg.chat.id,
					formatMessage("У вас пока нет букашки! Используйте команду 'взять букашку', чтобы завести питомца. 🐛"),
					{ parse_mode: "MarkdownV2" }
				);
			}
		} else if (normalizedText === "моя букашка") {
			const userId = msg.from.id;
			if (userBukashki[userId]) {
				const bukashka = userBukashki[userId];
				await sendBukashkaInfo(msg.chat.id, bukashka);
			} else {
				await bot.sendMessage(
					msg.chat.id,
					"У вас пока нет букашки! Используйте команду 'взять букашку', чтобы завести питомца. 🐛",
					{ parse_mode: "MarkdownV2" }
				);
			}
		} else if (normalizedText === "букашку в приключение") {
			const userId = msg.from.id;
			if (!userBukashki[userId]) {
				await bot.sendMessage(
					msg.chat.id,
					"У вас пока нет букашки! Используйте команду 'взять букашку', чтобы завести питомца. 🐛",
					{ parse_mode: "MarkdownV2" }
				);
				return;
			}

			if (isInAdventure(userId)) {
				const timeLeft = getAdventureTimeLeft(userId);
				await bot.sendMessage(
					msg.chat.id,
					formatMessage(`Ваша букашка ${userBukashki[userId].name} уже в приключении! 🎒\n\nОсталось времени: ${formatTimeLeft(timeLeft)}`),
					{ parse_mode: "MarkdownV2" }
				);
				return;
			}

			// Начинаем приключение
			adventureStartTime[userId] = Date.now();
			adventureTimers[userId] = setTimeout(() => {
				completeAdventure(userId, msg.chat.id);
			}, 30 * 1000); // 30 секунд

			await bot.sendMessage(
				msg.chat.id,
				formatMessage(`Ваша букашка ${userBukashki[userId].name} отправилась в приключение! 🎒\n\nОна вернется через 30 секунд.\n\nВо время приключения вы не сможете кормить букашку.`),
				{ parse_mode: "MarkdownV2" }
			);
		} else if (normalizedText === "где букашка") {
			const userId = msg.from.id;
			if (!userBukashki[userId]) {
				await bot.sendMessage(
					msg.chat.id,
					"У вас пока нет букашки! Используйте команду 'взять букашку', чтобы завести питомца. 🐛",
					{ parse_mode: "MarkdownV2" }
				);
				return;
			}

			if (isInAdventure(userId)) {
				const timeLeft = getAdventureTimeLeft(userId);
				const timeLeftFormatted = formatTimeLeft(timeLeft);
				await bot.sendMessage(
					msg.chat.id,
					formatMessage(`Ваша букашка ${userBukashki[userId].name} сейчас в приключении! 🎒\n\nОсталось времени: ${timeLeftFormatted}\n\nВы можете проверить её состояние, используя команду "Моя букашка".`),
					{ parse_mode: "MarkdownV2" }
				);
			} else {
				await bot.sendMessage(
					msg.chat.id,
					formatMessage(`Ваша букашка ${userBukashki[userId].name} сейчас дома и готова к новым приключениям! 🏠\n\nИспользуйте команду "Букашку в приключение", чтобы отправить её в путешествие.`),
					{ parse_mode: "MarkdownV2" }
				);
			}
		} else if (normalizedText === "раздавить букашку") {
			const userId = msg.from.id;
			if (userBukashki[userId]) {
				await killBukashka(userId, msg.chat.id, "раздавлена хозяином");
			} else {
				await bot.sendMessage(
					msg.chat.id,
					formatMessage("У вас нет букашки, которую можно раздавить! 🐛"),
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
				caption: formatMessage(`Привет, ${bukashka.name}!`),
				parse_mode: "MarkdownV2",
			});
		}
	} catch (error) {
		console.log(error);
	}
});
