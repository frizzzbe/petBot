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
				const bukashka = userBukashki[userId];
				bukashka.feed += 1;

				await sendBukashkaInfo(msg.chat.id, bukashka, 1);
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
