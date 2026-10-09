import { useState } from 'react'
import type { CannedResponse } from '../lib/api'

const LANG_KEY = 'canned_lang'
type Lang = 'ru' | 'ro'

// выбор языка запоминается между сессиями (localStorage), а не только на время чата
function readLang(): Lang {
	try {
		return localStorage.getItem(LANG_KEY) === 'ro' ? 'ro' : 'ru'
	} catch {
		return 'ru'
	}
}
function saveLang(lang: Lang) {
	try {
		localStorage.setItem(LANG_KEY, lang)
	} catch {}
}

// Панель шаблонов ответов: переключатель RU/RO + фильтр по заголовку + список.
// Клик вставляет текст в поле ввода, не отправляя — как у панели эмодзи
export function CannedResponsesPanel({
	items,
	onPick
}: {
	items: CannedResponse[]
	onPick: (text: string) => void
}) {
	const [lang, setLang] = useState<Lang>(readLang)
	const [query, setQuery] = useState('')

	function changeLang(next: Lang) {
		setLang(next)
		saveLang(next)
	}

	const filtered = query.trim()
		? items.filter(i => i.title.toLowerCase().includes(query.trim().toLowerCase()))
		: items

	return (
		<div
			// кнопки не забирают фокус у поля ввода
			onPointerDown={e => e.preventDefault()}
			className="flex h-60 flex-col border-t border-zinc-200 dark:border-zinc-800"
		>
			<div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
				<div role="tablist" aria-label="Язык шаблона" className="flex shrink-0 gap-0.5">
					{(['ru', 'ro'] as const).map(l => (
						<button
							key={l}
							type="button"
							role="tab"
							aria-selected={lang === l}
							onClick={() => changeLang(l)}
							className={`h-8 w-10 cursor-pointer rounded-lg border-0 text-sm font-semibold uppercase ${
								lang === l
									? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
									: 'bg-transparent text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
							}`}
						>
							{l}
						</button>
					))}
				</div>
				<input
					value={query}
					onChange={e => setQuery(e.target.value)}
					placeholder="Поиск по заголовку…"
					aria-label="Поиск шаблонов"
					className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20"
				/>
			</div>
			<div className="flex-1 overflow-y-auto p-2">
				{filtered.length === 0 ? (
					<p className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
						{items.length === 0
							? 'Шаблонов пока нет — добавьте их в настройках'
							: 'Ничего не найдено'}
					</p>
				) : (
					<ul className="m-0 flex list-none flex-col gap-0.5 p-0">
						{filtered.map(item => (
							<li key={item.id}>
								<button
									type="button"
									onClick={() => onPick(lang === 'ru' ? item.textRu : item.textRo)}
									className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
								>
									<span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
										{item.title}
									</span>
									<span className="line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
										{lang === 'ru' ? item.textRu : item.textRo}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}
