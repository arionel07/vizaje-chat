import { randomUUID } from 'crypto'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { MAX_UPLOAD_SIZE, UPLOAD_DIR } from '../config'

export const ALLOWED_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/avif'
] as const
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

const EXTENSION_BY_MIME: Record<AllowedMimeType, string> = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
	'image/avif': '.avif'
}

export function isAllowedMimeType(type: string): type is AllowedMimeType {
	return (ALLOWED_MIME_TYPES as readonly string[]).includes(type)
}

export type SavedUpload = {
	filename: string
	url: string
	type: string
	name: string
	size: number
}

// принимает Blob/File из multipart-тела (Elysia отдаёт File), пишет на диск
// под случайным именем (UUID, не оригинальным — чтобы не было коллизий/path traversal)
export async function saveUpload(file: File): Promise<
	| { ok: true; upload: SavedUpload }
	| { ok: false; error: string }
> {
	if (!isAllowedMimeType(file.type)) {
		return { ok: false, error: 'Unsupported file type' }
	}
	if (file.size > MAX_UPLOAD_SIZE) {
		return { ok: false, error: 'File too large' }
	}

	const filename = `${randomUUID()}${EXTENSION_BY_MIME[file.type]}`
	const path = join(UPLOAD_DIR, filename)
	await Bun.write(path, file)

	return {
		ok: true,
		upload: {
			filename,
			url: `/uploads/${filename}`,
			type: file.type,
			name: file.name || filename,
			size: file.size
		}
	}
}

// безопасно: только имя файла, без слэшей/".." — защита от выхода за пределы UPLOAD_DIR
export function isSafeFilename(filename: string) {
	return /^[\w.-]+$/.test(filename) && !filename.includes('..')
}

export function uploadFilePath(filename: string) {
	return join(UPLOAD_DIR, filename)
}

export async function deleteUploadFile(filename: string) {
	await unlink(uploadFilePath(filename)).catch(() => {})
}

export type AttachmentInput = {
	attachmentUrl?: string
	attachmentType?: string
	attachmentName?: string
	attachmentSize?: number
}

// превращает поля вложения из тела запроса/WS-сообщения в Attachment для
// addMessage — доверяем только тому, что сами же вернули из /widget|admin/upload
// (url — наш собственный /uploads/<uuid>.<ext>), но всё равно проверяем форму
export function parseAttachmentInput(
	input: AttachmentInput
): { url: string; type: string; name: string; size: number } | null {
	const { attachmentUrl, attachmentType, attachmentName, attachmentSize } = input
	if (!attachmentUrl) return null
	if (!attachmentUrl.startsWith('/uploads/') || !isSafeFilename(attachmentUrl.slice(9))) {
		return null
	}
	if (!attachmentType || !isAllowedMimeType(attachmentType)) return null
	if (typeof attachmentSize !== 'number' || attachmentSize <= 0 || attachmentSize > MAX_UPLOAD_SIZE) {
		return null
	}
	return {
		url: attachmentUrl,
		type: attachmentType,
		name: attachmentName?.slice(0, 255) || attachmentUrl.slice(9),
		size: attachmentSize
	}
}
