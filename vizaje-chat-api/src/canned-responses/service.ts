import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { cannedResponses } from '../db/schema'

export type CannedResponseInput = { title: string; textRu: string; textRo: string }

// пустой заголовок или текст — бесполезная заготовка, которую потом не найти в списке
function validate(input: Partial<CannedResponseInput>) {
	const title = input.title?.trim()
	const textRu = input.textRu?.trim()
	const textRo = input.textRo?.trim()
	if (!title) throw new Error('title обязателен')
	if (!textRu) throw new Error('textRu обязателен')
	if (!textRo) throw new Error('textRo обязателен')
	return { title, textRu, textRo }
}

export async function listCannedResponses() {
	return db.select().from(cannedResponses).orderBy(desc(cannedResponses.id))
}

export async function createCannedResponse(input: Partial<CannedResponseInput>) {
	const values = validate(input)
	const [row] = await db.insert(cannedResponses).values(values).returning()
	if (!row) throw new Error('Failed to insert canned response')
	return row
}

// частичное обновление: поля, которых нет в body, остаются прежними
export async function updateCannedResponse(
	id: number,
	input: Partial<CannedResponseInput>
) {
	const [existing] = await db
		.select()
		.from(cannedResponses)
		.where(eq(cannedResponses.id, id))
	if (!existing) return null

	const values = validate({
		title: input.title ?? existing.title,
		textRu: input.textRu ?? existing.textRu,
		textRo: input.textRo ?? existing.textRo
	})
	const [row] = await db
		.update(cannedResponses)
		.set(values)
		.where(eq(cannedResponses.id, id))
		.returning()
	return row ?? null
}

export async function deleteCannedResponse(id: number) {
	const [row] = await db
		.delete(cannedResponses)
		.where(eq(cannedResponses.id, id))
		.returning({ id: cannedResponses.id })
	return !!row
}
