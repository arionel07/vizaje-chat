import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { botResponses } from '../db/schema'

export type BotResponseInput = { triggerText: string; answerRu: string; answerRo: string }

// пустой триггер или ответ — бот никогда не сработает или ответит пустотой
function validate(input: Partial<BotResponseInput>) {
	const triggerText = input.triggerText?.trim()
	const answerRu = input.answerRu?.trim()
	const answerRo = input.answerRo?.trim()
	if (!triggerText) throw new Error('triggerText обязателен')
	if (!answerRu) throw new Error('answerRu обязателен')
	if (!answerRo) throw new Error('answerRo обязателен')
	return { triggerText, answerRu, answerRo }
}

export async function listBotResponses() {
	return db.select().from(botResponses).orderBy(desc(botResponses.id))
}

export async function createBotResponse(input: Partial<BotResponseInput>) {
	const values = validate(input)
	const [row] = await db.insert(botResponses).values(values).returning()
	if (!row) throw new Error('Failed to insert bot response')
	return row
}

// частичное обновление: поля, которых нет в body, остаются прежними
export async function updateBotResponse(id: number, input: Partial<BotResponseInput>) {
	const [existing] = await db.select().from(botResponses).where(eq(botResponses.id, id))
	if (!existing) return null

	const values = validate({
		triggerText: input.triggerText ?? existing.triggerText,
		answerRu: input.answerRu ?? existing.answerRu,
		answerRo: input.answerRo ?? existing.answerRo
	})
	const [row] = await db
		.update(botResponses)
		.set(values)
		.where(eq(botResponses.id, id))
		.returning()
	return row ?? null
}

export async function deleteBotResponse(id: number) {
	const [row] = await db
		.delete(botResponses)
		.where(eq(botResponses.id, id))
		.returning({ id: botResponses.id })
	return !!row
}

// точное совпадение текста сообщения с триггером (сообщение уже обрезано/trim'лено
// на входе в WS) — первое совпадение, если их вдруг несколько
export async function findBotResponseByTrigger(text: string) {
	const [row] = await db
		.select()
		.from(botResponses)
		.where(eq(botResponses.triggerText, text))
	return row ?? null
}
