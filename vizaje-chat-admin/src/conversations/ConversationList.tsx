import { CircleAlert, Lock, LogOut, MessageSquare, Search, User, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	CONVERSATIONS_PAGE_SIZE,
	fetchConversations,
	fetchCounts,
	type Conversation,
	type ConversationCounts,
	type ConversationFilter
} from '../lib/api'
import { formatListTime, initials } from '../lib/format'
import { connectAdminWs } from '../lib/ws'
import {
	ensureNotificationPermission,
	playChime,
	showBrowserNotification,
	updateFaviconBadge,
	updateTitle
} from '../notifications/alerts'
import { SoundToggle } from '../notifications/SoundToggle'
import { ThemeToggle } from '../theme/ThemeToggle'

const NOTIFICATION_TEXT_LIMIT = 200

// беседа ещё не подгружена в список (например, отфильтрована) — минимальная заглушка;
// корректные данные подтянутся ближайшей перезагрузкой списка (onSync)
function conversationStub(id: number): Conversation {
	return {
		id,
		sessionId: '',
		status: 'open',
		createdAt: new Date().toISOString(),
		visitorLastReadAt: null,
		assigneeId: null,
		assigneeEmail: null,
		lastMessageText: null,
		lastMessageSender: null,
		lastMessageAt: null,
		unreadCount: 0
	}
}

const MAX_RELOAD = 100 // максимум, который отдаёт API за один запрос
const TYPING_SHOW_MS = 5000
const SEARCH_DEBOUNCE_MS = 350

const FILTERS: { id: ConversationFilter; label: string }[] = [
	{ id: 'all', label: 'Все' },
	{ id: 'mine', label: 'Мои' },
	{ id: 'unread', label: 'Непрочитанные' },
	{ id: 'open', label: 'Открытые' },
	{ id: 'closed', label: 'Закрытые' }
]

// то же множество (без лишнего рендера), если состояние не изменилось
function withTyping(prev: Set<number>, id: number, typing: boolean) {
	if (prev.has(id) === typing) return prev
	const next = new Set(prev)
	if (typing) next.add(id)
	else next.delete(id)
	return next
}

function countFor(id: ConversationFilter, counts: ConversationCounts | null) {
	if (!counts) return null
	if (id === 'all') return counts.open + counts.closed
	return counts[id]
}

export function ConversationList({
	token,
	onSelect,
	onSync,
	selectedId,
	refreshKey,
	onLogout
}: {
	token: string
	onSelect: (conversation: Conversation) => void
	// свежие данные выбранной беседы (например, статус) после перезагрузки списка
	onSync: (conversation: Conversation) => void
	selectedId: number | null
	refreshKey: number
	onLogout: () => void
}) {
	const [conversations, setConversations] = useState<Conversation[]>([])
	const [counts, setCounts] = useState<ConversationCounts | null>(null)
	const [filter, setFilter] = useState<ConversationFilter>('all')
	// searchInput — то, что видно в поле; search — применённое (после debounce) значение
	const [searchInput, setSearchInput] = useState('')
	const [search, setSearch] = useState('')
	const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const [hasMore, setHasMore] = useState(false)
	const [loading, setLoading] = useState(true)
	const [loadingMore, setLoadingMore] = useState(false)
	const [loadFailed, setLoadFailed] = useState(false)
	// беседы, где посетитель сейчас печатает (гаснет через TYPING_SHOW_MS)
	const [typingIds, setTypingIds] = useState<Set<number>>(new Set())
	const typingTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())
	const countRef = useRef(0)
	const requestRef = useRef(0)
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	// свежие значения для колбэков, чтобы не пересоздавать WS и эффекты
	const selectedIdRef = useRef(selectedId)
	const onSyncRef = useRef(onSync)
	const onSelectRef = useRef(onSelect)
	const conversationsRef = useRef(conversations)
	useEffect(() => {
		selectedIdRef.current = selectedId
		onSyncRef.current = onSync
		onSelectRef.current = onSelect
		conversationsRef.current = conversations
	}, [selectedId, onSync, onSelect, conversations])

	// запрашиваем разрешение на уведомления один раз при заходе в админку;
	// если пользователь уже ответил (разрешил или отказал), повторно не спрашиваем
	useEffect(() => {
		ensureNotificationPermission()
	}, [])

	// счётчик непрочитанных бесед — на favicon и в заголовке вкладки
	useEffect(() => {
		const unread = counts?.unread ?? 0
		updateFaviconBadge(unread)
		updateTitle(unread)
	}, [counts])
	useEffect(
		() => () => {
			updateFaviconBadge(0)
			updateTitle(0)
		},
		[]
	)

	// клик по системному уведомлению — фокусирует вкладку (в showBrowserNotification)
	// и открывает нужную беседу
	const openConversation = useCallback((conversationId: number) => {
		const found = conversationsRef.current.find(c => c.id === conversationId)
		onSelectRef.current(found ?? conversationStub(conversationId))
	}, [])

	// перезагружает уже показанные беседы; устаревшие ответы игнорируются
	const reload = useCallback(async () => {
		const requestId = ++requestRef.current
		const limit = Math.min(
			Math.max(countRef.current, CONVERSATIONS_PAGE_SIZE),
			MAX_RELOAD
		)
		try {
			const [page, newCounts] = await Promise.all([
				fetchConversations(token, { limit, filter, q: search }),
				fetchCounts(token)
			])
			if (requestId !== requestRef.current) return
			countRef.current = page.length
			setConversations(page)
			setCounts(newCounts)
			setHasMore(page.length === limit)
			setLoadFailed(false)
			const selected = page.find(c => c.id === selectedIdRef.current)
			if (selected) onSyncRef.current(selected)
		} catch (e) {
			if (requestId === requestRef.current) setLoadFailed(true)
			throw e
		} finally {
			if (requestId === requestRef.current) setLoading(false)
		}
	}, [token, filter, search])

	// несколько событий подряд (или отправка своего сообщения) — одна перезагрузка
	const scheduleReload = useCallback(() => {
		clearTimeout(timerRef.current)
		timerRef.current = setTimeout(() => reload().catch(() => {}), 250)
	}, [reload])

	function changeFilter(next: ConversationFilter) {
		if (next === filter) return
		countRef.current = 0 // новый фильтр — начинаем с первой страницы
		setLoading(true)
		setFilter(next)
	}

	// debounce: не долбим бэкенд на каждую нажатую букву
	function handleSearchInput(value: string) {
		setSearchInput(value)
		clearTimeout(searchTimerRef.current)
		searchTimerRef.current = setTimeout(() => {
			countRef.current = 0 // новый поиск — начинаем с первой страницы
			setLoading(true)
			setSearch(value.trim())
		}, SEARCH_DEBOUNCE_MS)
	}

	// крестик в поле — очищает сразу, не дожидаясь debounce
	function clearSearch() {
		clearTimeout(searchTimerRef.current)
		setSearchInput('')
		if (search) {
			countRef.current = 0
			setLoading(true)
			setSearch('')
		}
	}

	useEffect(() => () => clearTimeout(searchTimerRef.current), [])

	useEffect(() => {
		reload().catch(() => {})
	}, [reload, refreshKey])

	const setTyping = useCallback((conversationId: number, typing: boolean) => {
		const timers = typingTimersRef.current
		clearTimeout(timers.get(conversationId))
		timers.delete(conversationId)
		if (typing) {
			timers.set(
				conversationId,
				setTimeout(() => {
					timers.delete(conversationId)
					setTypingIds(prev => withTyping(prev, conversationId, false))
				}, TYPING_SHOW_MS)
			)
		}
		setTypingIds(prev => withTyping(prev, conversationId, typing))
	}, [])

	// сообщения и события «прочитано» (admin:global) обновляют превью и счётчики;
	// «печатает» — только пометка в списке; sent/error касаются лишь окна чата
	const handleWsEvent = useCallback(
		(msg: {
			type?: string
			from?: string
			sender?: string
			conversationId?: number
			text?: string
		}) => {
			if (msg.type === 'typing') {
				if (msg.from === 'visitor' && msg.conversationId)
					setTyping(msg.conversationId, true)
				return
			}
			if (msg.type === 'sent' || msg.type === 'error') return
			if (msg.sender === 'visitor' && msg.conversationId) {
				setTyping(msg.conversationId, false)
				// звук — всегда (можно выключить кнопкой), системное уведомление — только
				// когда вкладка неактивна, иначе оператор и так видит сообщение на экране
				playChime()
				if (document.hidden) {
					const conversationId = msg.conversationId
					showBrowserNotification(
						`Беседа #${conversationId}`,
						(msg.text ?? '').slice(0, NOTIFICATION_TEXT_LIMIT) || 'Новое сообщение',
						`chat-${conversationId}`,
						() => openConversation(conversationId)
					)
				}
			}
			scheduleReload()
		},
		[scheduleReload, setTyping, openConversation]
	)

	useEffect(() => {
		const ws = connectAdminWs(token, handleWsEvent, scheduleReload)
		const timers = typingTimersRef.current
		return () => {
			clearTimeout(timerRef.current)
			timers.forEach(clearTimeout)
			timers.clear()
			ws.close()
		}
	}, [token, handleWsEvent, scheduleReload])

	async function loadMore() {
		setLoadingMore(true)
		try {
			const page = await fetchConversations(token, {
				offset: countRef.current,
				filter,
				q: search
			})
			countRef.current += page.length
			setConversations(prev => [...prev, ...page])
			setHasMore(page.length === CONVERSATIONS_PAGE_SIZE)
		} catch {
			setLoadFailed(true)
		} finally {
			setLoadingMore(false)
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
				<h1 className="text-xl font-semibold tracking-tight">Беседы</h1>
				<div className="flex items-center">
					<SoundToggle />
					<ThemeToggle compact />
					<button
						type="button"
						onClick={onLogout}
						aria-label="Выйти"
						title="Выйти"
						className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30"
					>
						<LogOut aria-hidden="true" className="h-5 w-5" />
					</button>
				</div>
			</header>

			<div className="px-4 pb-3">
				<div className="relative">
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
					/>
					<input
						type="text"
						value={searchInput}
						onChange={e => handleSearchInput(e.target.value)}
						placeholder="Поиск по перепискам…"
						aria-label="Поиск по беседам"
						className="h-10 w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-9 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20"
					/>
					{searchInput && (
						<button
							type="button"
							onClick={clearSearch}
							aria-label="Очистить поиск"
							className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
						>
							<X aria-hidden="true" className="h-4 w-4" />
						</button>
					)}
				</div>
			</div>

			<div
				role="group"
				aria-label="Фильтр бесед"
				className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			>
				{FILTERS.map(f => {
					const n = countFor(f.id, counts)
					const active = filter === f.id
					return (
						<button
							key={f.id}
							type="button"
							onClick={() => changeFilter(f.id)}
							aria-pressed={active}
							className={`flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-300/30 ${
								active
									? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
									: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
							}`}
						>
							{f.label}
							{n !== null && (
								<span
									className={
										active
											? 'text-white/70 dark:text-zinc-900/60'
											: f.id === 'unread' && n > 0
												? 'text-red-600 dark:text-red-400'
												: 'text-zinc-500 dark:text-zinc-400'
									}
								>
									{n}
								</span>
							)}
						</button>
					)
				})}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
				{loadFailed && (
					<div
						role="alert"
						className="m-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
					>
						<CircleAlert
							aria-hidden="true"
							className="mt-0.5 h-4 w-4 shrink-0"
						/>
						<span>
							Не удалось загрузить беседы. Проверьте, что API запущен и схема БД
							применена (bunx drizzle-kit push).
						</span>
					</div>
				)}

				{!loading && !loadFailed && conversations.length === 0 && (
					<div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-zinc-500 dark:text-zinc-400">
						<MessageSquare aria-hidden="true" className="h-10 w-10" />
						<p className="text-base">{search ? 'Ничего не найдено' : 'Нет бесед'}</p>
					</div>
				)}

				<ul className="m-0 list-none p-2">
					{conversations.map(c => {
						const selected = c.id === selectedId
						const unread = selected ? 0 : c.unreadCount
						return (
							<li key={c.id}>
								<button
									type="button"
									onClick={() => onSelect(c)}
									aria-current={selected ? 'true' : undefined}
									className={`flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-300/30 ${
										selected
											? 'bg-zinc-100 dark:bg-zinc-800'
											: 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
									}`}
								>
									<span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
										<User aria-hidden="true" className="h-5 w-5" />
										{c.assigneeEmail && (
											<span
												title={`Назначена: ${c.assigneeEmail}`}
												className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white ring-2 ring-white dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-900"
											>
												{initials(c.assigneeEmail)}
											</span>
										)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex items-baseline justify-between gap-2">
											<span
												className={`flex min-w-0 items-center gap-1.5 text-base ${
													unread ? 'font-semibold' : 'font-medium'
												}`}
											>
												<span className="truncate">Беседа #{c.id}</span>
												{c.status === 'closed' && (
													<Lock
														aria-label="Закрыта"
														className="h-3.5 w-3.5 shrink-0 text-zinc-400"
													/>
												)}
											</span>
											{c.lastMessageAt && (
												<span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
													{formatListTime(c.lastMessageAt)}
												</span>
											)}
										</span>
										<span className="mt-0.5 flex items-center justify-between gap-2">
											<span
												className={`truncate text-sm ${
													typingIds.has(c.id)
														? 'text-emerald-600 dark:text-emerald-400'
														: unread
															? 'text-zinc-900 dark:text-zinc-100'
															: 'text-zinc-500 dark:text-zinc-400'
												}`}
											>
												{typingIds.has(c.id)
													? 'печатает…'
													: c.lastMessageText
														? `${c.lastMessageSender === 'admin' ? 'Вы: ' : ''}${c.lastMessageText}`
														: 'Нет сообщений'}
											</span>
											{unread > 0 && (
												<span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
													{unread}
												</span>
											)}
										</span>
									</span>
								</button>
							</li>
						)
					})}
				</ul>

				{hasMore && (
					<div className="px-4 pb-4 text-center">
						<button
							type="button"
							onClick={loadMore}
							disabled={loadingMore}
							className="h-10 cursor-pointer rounded-lg border border-zinc-300 bg-transparent px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
						>
							{loadingMore ? 'Загрузка…' : 'Загрузить ещё'}
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
