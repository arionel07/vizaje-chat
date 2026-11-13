import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { allowVisitorUpload } from '../chat/rate-limit'
import { isSafeFilename, saveUpload, uploadFilePath } from '../uploads/service'
import { verifySessionToken } from '../widget/service'

export const uploadsRoutes = new Elysia()
	// посетитель — только если у него уже есть сессия; лимит по sessionId,
	// чтобы не упираться в общий IP-лимит на людной Wi-Fi сети
	.post(
		'/widget/upload',
		async ({ headers, body, set }) => {
			const session = verifySessionToken(headers.authorization)
			if (!session) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			if (!allowVisitorUpload(session.sessionId)) {
				set.status = 429
				return { error: 'Too many uploads' }
			}
			const result = await saveUpload(body.file)
			if (!result.ok) {
				set.status = 422
				return { error: result.error }
			}
			return result.upload
		},
		{ body: t.Object({ file: t.File() }) }
	)
	.post(
		'/admin/upload',
		async ({ headers, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			const result = await saveUpload(body.file)
			if (!result.ok) {
				set.status = 422
				return { error: result.error }
			}
			return result.upload
		},
		{ body: t.Object({ file: t.File() }) }
	)
	// отдача загруженных файлов — без авторизации, как и сами ссылки в сообщениях;
	// имя — UUID, подбором не найти, значит доступ по факту такой же, как у ссылки
	.get('/uploads/:filename', async ({ params, set }) => {
		if (!isSafeFilename(params.filename)) {
			set.status = 404
			return { error: 'Not found' }
		}
		const file = Bun.file(uploadFilePath(params.filename))
		if (!(await file.exists())) {
			set.status = 404
			return { error: 'Not found' }
		}
		return file
	})
