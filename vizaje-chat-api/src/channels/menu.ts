// Содержимое меню бота — просто редактируемые объекты, без логики.
// Добавить/поменять вопрос — поменять строку здесь, код трогать не нужно.

export type Lang = 'ru' | 'ro'
export type CategoryId = 'retail' | 'app' | 'site' | 'other'

export const GREETING =
	'Здравствуйте! 👋 Я бот поддержки Vizaje-Nica.\nВыберите язык:'

export const CATEGORY_LABELS: Record<CategoryId, Record<Lang, string>> = {
	retail: { ru: 'Розница', ro: 'Cu amănuntul' },
	app: { ru: 'Приложение', ro: 'Aplicație' },
	site: { ru: 'Сайт', ro: 'Site' },
	other: { ru: 'Другое', ro: 'Altele' }
}

export const BACK_LABEL: Record<Lang, string> = { ru: '⬅️ Назад', ro: '⬅️ Înapoi' }
// после выбора любой категории — сразу просим описать проблему своими словами,
// без промежуточного FAQ-меню с готовыми вопросами
export const ASK_TEXT_PROMPT: Record<Lang, string> = {
	ru: 'Опишите вашу проблему или вопрос — оператор ответит здесь же, в этом чате.',
	ro: 'Descrieți problema sau întrebarea dvs. — operatorul va răspunde chiar aici, în acest chat.'
}
export const THANKS_FORWARDED: Record<Lang, string> = {
	ru: 'Спасибо! Передал оператору, скоро ответит.',
	ro: 'Mulțumim! Am transmis operatorului, va răspunde în curând.'
}

// отправляется вместо THANKS_FORWARDED, если сообщение пришло вне рабочего
// графика (см. settings/service.ts) — тот же текст, что в offline-баннере
// виджета (widget.js), просто с добавленным «спасибо», т.к. здесь нет
// отдельного постоянного баннера, только разовое сообщение в чат
export function offlineReplyText(lang: Lang, scheduleSummary: string): string {
	// пустая строка — график выключен целиком (ни одного рабочего дня),
	// тогда не упоминаем часы вообще, как и offline-баннер виджета в этом случае
	if (!scheduleSummary) {
		return lang === 'ro'
			? 'Mulțumim pentru mesaj! Acum suntem offline.'
			: 'Спасибо за сообщение! Сейчас мы не в сети.'
	}
	return lang === 'ro'
		? `Mulțumim pentru mesaj! Acum suntem offline. De obicei răspundem în orele de program: ${scheduleSummary}.`
		: `Спасибо за сообщение! Сейчас мы не в сети. Обычно отвечаем в рабочие часы: ${scheduleSummary}.`
}
