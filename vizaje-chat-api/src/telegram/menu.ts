// Содержимое меню бота — просто редактируемые объекты, без логики.
// Добавить/поменять вопрос — поменять строку здесь, код трогать не нужно.

export type Lang = 'ru' | 'ro'
export type CategoryId = 'retail' | 'app' | 'site'

export const GREETING =
	'Здравствуйте! 👋 Я бот поддержки Vizaje-Nica.\nВыберите язык:'

export const CATEGORY_LABELS: Record<CategoryId, Record<Lang, string>> = {
	retail: { ru: 'Розница', ro: 'Cu amănuntul' },
	app: { ru: 'Приложение', ro: 'Aplicație' },
	site: { ru: 'Сайт', ro: 'Site' }
}

// заглушки — замените на реальные вопросы/ответы, формат тот же (вопрос: ответ)
export const FAQ: Record<CategoryId, Record<Lang, Record<string, string>>> = {
	retail: {
		ru: {
			'Есть ли доставка по Молдове?': 'Да, доставляем по всей стране, обычно 2–3 дня.',
			'Как оплатить заказ?': 'Картой онлайн на сайте или наличными при получении.'
		},
		ro: {
			'Aveți livrare în Moldova?': 'Da, livrăm în toată țara, de obicei 2–3 zile.',
			'Cum pot plăti comanda?': 'Card online pe site sau numerar la livrare.'
		}
	},
	app: {
		ru: {
			'Приложение не открывается': 'Попробуйте переустановить приложение и проверьте обновления ОС.',
			'Как сбросить пароль?': 'На экране входа нажмите «Забыли пароль» — придёт письмо со ссылкой.'
		},
		ro: {
			'Aplicația nu se deschide': 'Încercați să reinstalați aplicația și verificați actualizările OS.',
			'Cum resetez parola?': 'Pe ecranul de autentificare apăsați „Ați uitat parola" — veți primi un e-mail.'
		}
	},
	site: {
		ru: {
			'Не загружается страница': 'Попробуйте очистить кэш браузера или открыть в другом браузере.',
			'Где посмотреть статус заказа?': 'В личном кабинете → «Мои заказы»'
		},
		ro: {
			'Pagina nu se încarcă': 'Încercați să ștergeți cache-ul browserului sau deschideți în alt browser.',
			'Unde văd statusul comenzii?': 'În contul personal → „Comenzile mele"'
		}
	}
}

export const BACK_LABEL: Record<Lang, string> = { ru: '⬅️ Назад', ro: '⬅️ Înapoi' }
export const OTHER_QUESTION_LABEL: Record<Lang, string> = {
	ru: '💬 Другой вопрос',
	ro: '💬 Altă întrebare'
}
export const ASK_TEXT_PROMPT: Record<Lang, string> = {
	ru: 'Напишите ваш вопрос — оператор ответит здесь же, в этом чате.',
	ro: 'Scrieți întrebarea dvs. — operatorul va răspunde chiar aici, în acest chat.'
}
export const THANKS_FORWARDED: Record<Lang, string> = {
	ru: 'Спасибо! Передал оператору, скоро ответит.',
	ro: 'Mulțumim! Am transmis operatorului, va răspunde în curând.'
}
