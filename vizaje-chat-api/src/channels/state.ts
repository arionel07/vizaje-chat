import type { CategoryId, Lang } from './menu'

// Навигация по меню — ничего не весит, процесс перезапустят — человек
// просто снова нажмёт /start. Не в БД: это не история переписки, а UI-состояние
export type Step = 'entry' | 'lang' | 'category' | 'support'
// categoryAnnounced — тема уже отправлена оператору системным сообщением для
// ТЕКУЩЕГО захода в режим поддержки; promptFreeText (см. flow.ts) каждый раз
// заводит новый ChatState без этого поля, поэтому при возврате в меню и
// повторном выборе темы (та же или другая — человек вернулся с новым
// вопросом) оно снова не выставлено и тема присылается заново
export type ChatState = {
	step: Step
	lang?: Lang
	categoryId?: CategoryId
	categoryAnnounced?: boolean
}

const states = new Map<string, ChatState>()

export function getChatState(chatId: string): ChatState {
	return states.get(chatId) ?? { step: 'entry' }
}

export function setChatState(chatId: string, state: ChatState) {
	states.set(chatId, state)
}
