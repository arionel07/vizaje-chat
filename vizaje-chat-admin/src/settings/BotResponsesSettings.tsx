import { Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
	createBotResponse,
	deleteBotResponse,
	fetchBotResponses,
	updateBotResponse,
	type BotResponse,
	type BotResponseInput
} from '../lib/api'

const inputClass =
	'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20'

const EMPTY_FORM: BotResponseInput = { triggerText: '', answerRu: '', answerRo: '' }

// Автоответы бота: точное совпадение сообщения посетителя (или клика по
// quick-reply кнопке виджета) с triggerText → бот отвечает сам, без оператора
export function BotResponsesSettings({ token }: { token: string }) {
	const [items, setItems] = useState<BotResponse[]>([])
	const [loading, setLoading] = useState(true)
	const [loadFailed, setLoadFailed] = useState(false)
	// editingId: null — форма закрыта, 0 — создание нового, иначе — id редактируемого
	const [editingId, setEditingId] = useState<number | null>(null)
	const [form, setForm] = useState<BotResponseInput>(EMPTY_FORM)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// не сбрасывает loading в true на повторных вызовах (после сохранения/удаления) —
	// список уже показан, нет смысла прятать его на время обновления
	function load() {
		fetchBotResponses(token)
			.then(list => {
				setItems(list)
				setLoadFailed(false)
			})
			.catch(() => setLoadFailed(true))
			.finally(() => setLoading(false))
	}

	useEffect(load, [token])

	function startCreate() {
		setEditingId(0)
		setForm(EMPTY_FORM)
		setError(null)
	}
	function startEdit(item: BotResponse) {
		setEditingId(item.id)
		setForm({
			triggerText: item.triggerText,
			answerRu: item.answerRu,
			answerRo: item.answerRo
		})
		setError(null)
	}
	function cancelForm() {
		setEditingId(null)
		setError(null)
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		setError(null)
		try {
			if (editingId) await updateBotResponse(token, editingId, form)
			else await createBotResponse(token, form)
			setEditingId(null)
			load()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Не удалось сохранить')
		} finally {
			setSaving(false)
		}
	}

	async function handleDelete(item: BotResponse) {
		if (!confirm(`Удалить автоответ «${item.triggerText}»?`)) return
		try {
			await deleteBotResponse(token, item.id)
			setItems(prev => prev.filter(i => i.id !== item.id))
		} catch {
			// сеть недоступна — список останется прежним, можно повторить
		}
	}

	return (
		<div className="px-4 py-4 md:px-6">
			{loadFailed && (
				<div
					role="alert"
					className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
				>
					<TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
					<span>Не удалось загрузить автоответы.</span>
				</div>
			)}

			{editingId === null ? (
				<button
					type="button"
					onClick={startCreate}
					className="mb-4 flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
				>
					<Plus aria-hidden="true" className="h-4 w-4" />
					Новый автоответ
				</button>
			) : (
				<form
					onSubmit={handleSubmit}
					className="mb-4 flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
				>
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-semibold">
							{editingId ? 'Изменить автоответ' : 'Новый автоответ'}
						</h3>
						<button
							type="button"
							onClick={cancelForm}
							aria-label="Отменить"
							className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
						>
							<X aria-hidden="true" className="h-4 w-4" />
						</button>
					</div>

					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-zinc-700 dark:text-zinc-300">
							Триггер (точный текст вопроса или quick-reply кнопки)
						</span>
						<input
							value={form.triggerText}
							onChange={e => setForm(f => ({ ...f, triggerText: e.target.value }))}
							placeholder="Например: Сроки доставки"
							required
							className={inputClass}
						/>
					</label>

					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-zinc-700 dark:text-zinc-300">Ответ (RU)</span>
						<textarea
							value={form.answerRu}
							onChange={e => setForm(f => ({ ...f, answerRu: e.target.value }))}
							rows={3}
							required
							className={`${inputClass} resize-y`}
						/>
					</label>

					<label className="flex flex-col gap-1 text-sm">
						<span className="font-medium text-zinc-700 dark:text-zinc-300">Ответ (RO)</span>
						<textarea
							value={form.answerRo}
							onChange={e => setForm(f => ({ ...f, answerRo: e.target.value }))}
							rows={3}
							required
							className={`${inputClass} resize-y`}
						/>
					</label>

					{error && (
						<p role="alert" className="text-sm text-red-600 dark:text-red-400">
							{error}
						</p>
					)}

					<div className="flex gap-2">
						<button
							type="submit"
							disabled={saving}
							className="flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
						>
							{saving ? 'Сохранение…' : 'Сохранить'}
						</button>
						<button
							type="button"
							onClick={cancelForm}
							className="flex h-10 cursor-pointer items-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
						>
							Отмена
						</button>
					</div>
				</form>
			)}

			{loading ? (
				<p className="text-sm text-zinc-500 dark:text-zinc-400">Загрузка…</p>
			) : items.length === 0 ? (
				<p className="text-sm text-zinc-500 dark:text-zinc-400">
					Пока нет ни одного автоответа.
				</p>
			) : (
				<ul className="m-0 flex list-none flex-col gap-2 p-0">
					{items.map(item => (
						<li
							key={item.id}
							className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
									{item.triggerText}
								</p>
								<p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
									{item.answerRu}
								</p>
							</div>
							<button
								type="button"
								onClick={() => startEdit(item)}
								aria-label={`Изменить «${item.triggerText}»`}
								className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
							>
								<Pencil aria-hidden="true" className="h-4 w-4" />
							</button>
							<button
								type="button"
								onClick={() => handleDelete(item)}
								aria-label={`Удалить «${item.triggerText}»`}
								className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
							>
								<Trash2 aria-hidden="true" className="h-4 w-4" />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
