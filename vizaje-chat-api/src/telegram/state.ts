import type { CategoryId, Lang } from './menu'

// Навигация по меню — ничего не весит, процесс перезапустят — человек
// просто снова нажмёт /start. Не в БД: это не история переписки, а UI-состояние
export type Step = 'entry' | 'lang' | 'category' | 'support'
export type ChatState = { step: Step; lang?: Lang; categoryId?: CategoryId }

const states = new Map<string, ChatState>()

export function getChatState(chatId: string): ChatState {
	return states.get(chatId) ?? { step: 'entry' }
}

export function setChatState(chatId: string, state: ChatState) {
	states.set(chatId, state)
}
