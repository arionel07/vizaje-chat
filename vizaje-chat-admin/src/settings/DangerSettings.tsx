import { TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchConversationDeleteEnabled, updateConversationDeleteEnabled } from '../lib/api'

// Переключатель-предохранитель: пока выключено, кнопка удаления беседы
// нигде не работает (бэкенд отдаёт 403 независимо от фронта) — включать
// точечно, когда реально нужно почистить беседы, и выключать обратно
export function DangerSettings({ token }: { token: string }) {
	const [enabled, setEnabled] = useState<boolean | null>(null)
	const [loadFailed, setLoadFailed] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		fetchConversationDeleteEnabled(token)
			.then(setEnabled)
			.catch(() => setLoadFailed(true))
	}, [token])

	async function toggle() {
		if (enabled === null || saving) return
		setSaving(true)
		setError(null)
		try {
			setEnabled(await updateConversationDeleteEnabled(token, !enabled))
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Не удалось сохранить')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="px-4 py-4 md:px-6">
			{loadFailed && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
				>
					<TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
					<span>Не удалось загрузить настройку.</span>
				</div>
			)}

			{enabled !== null && (
				<>
					<p className="mb-4 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
						Пока выключено — кнопки удаления беседы нигде не работают. Включайте
						только на то время, пока реально нужно удалить беседу (например, пустые
						тестовые), и выключайте обратно — удаление необратимо.
					</p>

					<label className="flex max-w-sm items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3.5 py-3 dark:border-zinc-800">
						<span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
							Разрешить удаление бесед
						</span>
						<button
							type="button"
							role="switch"
							aria-checked={enabled}
							onClick={toggle}
							disabled={saving}
							className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
								enabled ? 'bg-red-600' : 'bg-zinc-300 dark:bg-zinc-700'
							}`}
						>
							<span
								className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
									enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
								}`}
							/>
						</button>
					</label>

					{error && (
						<p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
							{error}
						</p>
					)}
				</>
			)}
		</div>
	)
}
