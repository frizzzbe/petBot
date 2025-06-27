// Массив с объектами для меню команд
const COMMANDS = [
  { command: "start", description: "Запуск бота" },
  { command: "help", description: "Раздел помощи" },
  { command: "menu", description: "Меню команд" },
  { command: "take", description: "Взять букашку" },
];

const DEFAULT_BUKASHKA = {
  level: 1,
  feed: 39,
  happy: 50,
  image: null,
  isAdventuring: false,
  adventureResult: null,
  coins: 0
};

const INTERVALS = {
  FEED: 3 * 1000, // кормление
  ADVENTURE: 60 * 1000, // приключения
  GAME: 60 * 1000, // игра
  FEED_DECAY: 15 * 60 * 1000, // голодание
  FEED_BOOST_DURATION: 15 * 60 * 1000 // длительность буста на голодание (15 минут)
};

const VALUE = {
  FEED_DECAY: 3, // голодание
  HAPPY_DECAY: 3, // счастье
  ADVENTURE_DECAY: 2, // приключения
  GAME_DECAY: 1 // игра
}

const SHOP_PRICES = {
  adventure_boost: 100,
  happy_boost: 80,
  feed_boost: 65,
  rabbit: 50,
  PRICE: 20,
  WIN: {
    happy: 10,
    coins: 80
  },
  JACKPOT: {
    happy: 30,
    coins: 500
  }
};

// Массив с возможными приключениями и их эффектами
const ADVENTURES = [
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
    happiness: 12
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
    happiness: -11
  },
  {
    text: "Во время сильного дождя букашка оказывается в потоке воды, который стремительно уносит её от дома. Ей было непросто вернуться домой",
    feed: -10,
    happiness: -12
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

const STICKERS = {
  RABBIT: [
    'CAACAgIAAxkBAAEOyQFoXBZNWnOa5nbYR0dwpfM3aOO1IwACqXIAAhXz2Ukp0-p_2K-SsDYE', 
    'CAACAgIAAxkBAAEOyQNoXBi0LYpPm9bTWqSy-oDEln98LwACR3IAAvh12UkchR4TkjidKjYE', 
    'CAACAgIAAxkBAAEOyQVoXBi7QEdEGBeQO_F_poBpNro3XAACt3IAAqfb2EnMgR5Jj052YTYE', 
    'CAACAgIAAxkBAAEOyQdoXBjNSgcXeXkD2z3m7hInsXAVrAACkm0AAjiN2EksurBJyQM_1jYE'
  ]
}

module.exports = {
  COMMANDS,
  DEFAULT_BUKASHKA,
  ADVENTURES,
  INTERVALS,
  VALUE,
  STICKERS,
  SHOP_PRICES
};
