import { Check, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
	fetchWidgetTheme,
	updateWidgetTheme,
	WIDGET_THEMES,
	type WidgetTheme
} from '../lib/api'

// Label по ключу темы — единственное, что нужно дописать для нового сезона
// (Spring/Summer/Autumn), кроме самого ключа в WIDGET_THEMES на бэкенде и здесь
const THEME_LABELS: Record<WidgetTheme, string> = {
	classic: 'Classic',
	winter: 'Winter'
}

// Сезонное оформление виджета на сайте (сейчас — падающие снежинки в Winter).
// Применяется сразу всем посетителям, обновляется виджетом при следующей загрузке страницы
export function ThemeSettings({ token }: { token: string }) {
	const [theme, setTheme] = useState<WidgetTheme | null>(null)
	const [loading, setLoading] = useState(true)
	const [loadFailed, setLoadFailed] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)

	useEffect(() => {
		fetchWidgetTheme(token)
			.then(setTheme)
			.catch(() => setLoadFailed(true))
			.finally(() => setLoading(false))
	}, [token])

	async function handleSave() {
		if (!theme) return
		setSaving(true)
		setError(null)
		try {
			setTheme(await updateWidgetTheme(token, theme))
			setSaved(true)
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Не удалось сохранить')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="px-4 py-4 md:px-6">
			{loading && <p className="text-sm text-zinc-500 dark:text-zinc-400">Загрузка…</p>}

			{loadFailed && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
				>
					<TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
					<span>Не удалось загрузить тему.</span>
				</div>
			)}

			{theme && (
				<>
					<p className="mb-4 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
						Сезонное оформление виджета на сайте — применяется сразу всем посетителям.
					</p>

					<label className="flex max-w-xs flex-col gap-1.5 text-sm">
						<span className="font-medium text-zinc-700 dark:text-zinc-300">Тема виджета</span>
						<select
							value={theme}
							onChange={e => {
								setTheme(e.target.value as WidgetTheme)
								setSaved(false)
							}}
							className="h-10 cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20"
						>
							{WIDGET_THEMES.map(id => (
								<option key={id} value={id}>
									{THEME_LABELS[id]}
								</option>
							))}
						</select>
					</label>

					{error && (
						<p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
							{error}
						</p>
					)}

					<button
						type="button"
						onClick={handleSave}
						disabled={saving}
						className="mt-4 flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
					>
						{saved && !saving && <Check aria-hidden="true" className="h-4 w-4" />}
						{saving ? 'Сохранение…' : saved ? 'Сохранено' : 'Сохранить'}
					</button>
				</>
			)}
		</div>
	)
}
