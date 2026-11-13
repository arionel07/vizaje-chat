import { useState } from 'react'
import { EMOJI_CATEGORIES, readRecentEmoji, type EmojiCategory } from './emoji-data'

// Панель эмодзи: вкладки категорий + сетка. Выбор вставляет эмодзи через onPick
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
	const [categoryId, setCategoryId] = useState('smileys')
	// «Недавние» читаем при каждом рендере: после выбора родитель обновляет список
	const recent = readRecentEmoji()
	const categories: EmojiCategory[] = [
		...(recent.length
			? [{ id: 'recent', label: 'Недавние', icon: '🕘', emojis: recent }]
			: []),
		...EMOJI_CATEGORIES
	]
	const current = categories.find(c => c.id === categoryId) ?? categories[0]!

	return (
		<div
			id="emoji-panel"
			// кнопки не забирают фокус у поля ввода
			onPointerDown={e => e.preventDefault()}
			className="flex h-60 flex-col border-t border-zinc-200 dark:border-zinc-800"
		>
			<div
				role="tablist"
				aria-label="Категории эмодзи"
				className="flex gap-0.5 overflow-x-auto border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800"
			>
				{categories.map(c => (
					<button
						key={c.id}
						type="button"
						role="tab"
						aria-selected={c.id === current.id}
						aria-label={c.label}
						onClick={() => setCategoryId(c.id)}
						className={`h-8 w-9 shrink-0 cursor-pointer rounded-lg border-0 text-lg ${
							c.id === current.id
								? 'bg-zinc-100 dark:bg-zinc-800'
								: 'bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
						}`}
					>
						{c.icon}
					</button>
				))}
			</div>
			<div
				role="tabpanel"
				className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(2.4rem,1fr))] content-start gap-0.5 overflow-y-auto p-2"
			>
				{current.emojis.map(emoji => (
					<button
						key={emoji}
						type="button"
						aria-label={emoji}
						onClick={() => onPick(emoji)}
						className="h-10 cursor-pointer rounded-lg border-0 bg-transparent text-2xl leading-none hover:bg-zinc-100 dark:hover:bg-zinc-800"
					>
						{emoji}
					</button>
				))}
			</div>
		</div>
	)
}
