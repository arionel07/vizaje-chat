import { eq, sql } from 'drizzle-orm'
import { ATTACHMENT_RETENTION_DAYS } from '../config'
import { db } from '../db/client'
import { messages } from '../db/schema'
import { deleteUploadFile } from './service'

const retentionDays = Math.max(Math.trunc(ATTACHMENT_RETENTION_DAYS), 0)

// находит вложения старше ATTACHMENT_RETENTION_DAYS, удаляет файл с диска и
// очищает поля вложения у сообщения — само сообщение (текст, если был) остаётся
export async function cleanupOldAttachments() {
	const expired = await db
		.select({ id: messages.id, attachmentUrl: messages.attachmentUrl })
		.from(messages)
		.where(
			sql`${messages.attachmentUrl} is not null
				and ${messages.createdAt} < now() - interval '${sql.raw(String(retentionDays))} days'`
		)

	for (const row of expired) {
		if (!row.attachmentUrl) continue
		const filename = row.attachmentUrl.split('/').pop()
		if (filename) await deleteUploadFile(filename)
		await db
			.update(messages)
			.set({
				attachmentUrl: null,
				attachmentType: null,
				attachmentName: null,
				attachmentSize: null
			})
			.where(eq(messages.id, row.id))
	}

	return expired.length
}

// раз в сутки, не блокируя старт сервера; первая проверка — тоже сразу при старте,
// чтобы не ждать сутки после деплоя, если уже накопились старые вложения
export function startAttachmentCleanup() {
	cleanupOldAttachments().catch(error =>
		console.error('Attachment cleanup failed:', error)
	)
	const DAY_MS = 24 * 60 * 60 * 1000
	const timer = setInterval(() => {
		cleanupOldAttachments().catch(error =>
			console.error('Attachment cleanup failed:', error)
		)
	}, DAY_MS)
	timer.unref()
	return timer
}
