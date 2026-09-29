import {
	ArrowLeft,
	Check,
	Lock,
	RotateCcw,
	Send,
	User
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	fetchMessages,
	markRead,
	MESSAGES_PAGE_SIZE,
	updateStatus,
	type Conversation
} from '../lib/api'
import { formatTime } from '../lib/format'
import { connectAdminWs, type AdminWs } from '../lib/ws'
import { TypingDots } from './TypingDots'

type Message = {
	id: number
	conversationId?: number
	sender: string
	text: string
	createdAt: string
	clientId?: string // только для отправленных отсюда сообщений
	pending?: boolean // отправлено, серверное подтверждение (sent) ещё не пришло
	failed?: boolean // сервер отклонил сообщение
}

const NEAR_BOTTOM_PX = 150
const TYPING_EMIT_MS = 3000 // не чаще, чем раз в 3 с сообщаем «печатаю»
const TYPING_SHOW_MS = 5000 // «печатает» гаснет, если событий больше нет

// Компонент нужно монтировать с key={conversation.id}: состояние привязано к беседе
export function ChatWindow({
	token,
	conversation,
	onBack,
	onActivity,
	onStatusChange
}: {
	token: string
	conversation: Conversation
	onBack: () => void // на телефоне — вернуться к списку
	onActivity?: () => void // сообщение отправлено или беседа прочитана — обновить список
	onStatusChange: (status: 'open' | 'closed') => void
}) {
	const conversationId = conversation.id
	const closed = conversation.status === 'closed'
	const [messages, setMessages] = useState<Message[]>([])
	const [input, setInput] = useState('')
	const [hasMore, setHasMore] = useState(false)
	const [loadingMore, setLoadingMore] = useState(false)
	const [toggling, setToggling] = useState(false)
	const [visitorTyping, setVisitorTyping] = useState(false)
	const [readEventAt, setReadEventAt] = useState(0) // «прочитано» из живого события
	const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const lastTypingSentRef = useRef(0)
	const sendSeqRef = useRef(0)
	const wsRef = useRef<AdminWs | null>(null)
	const listRef = useRef<HTMLDivElement | null>(null)
	const nearBottomRef = useRef(true)
	const skipScrollRef = useRef(false)

	// onActivity — новая функция на каждый рендер App; держим свежую в ref,
	// чтобы не переподключать WS и не перезапускать эффекты
	const onActivityRef = useRef(onActivity)
	useEffect(() => {
		onActivityRef.current = onActivity
	}, [onActivity])

	// помечает беседу прочитанной и просит обновить список; сбой сети не критичен
	const syncRead = useCallback(() => {
		markRead(token, conversationId)
			.then(() => onActivityRef.current?.())
			.catch(() => {})
	}, [token, conversationId])

	// беседа открыта — считаем прочитанной
	useEffect(() => {
		syncRead()
	}, [syncRead])

	// последняя страница истории; заменяет показанные сообщения
	const applyLatest = useCallback((page: Message[]) => {
		nearBottomRef.current = true
		setMessages(page)
		setHasMore(page.length === MESSAGES_PAGE_SIZE)
	}, [])

	const loadLatest = useCallback(
		() => fetchMessages(token, conversationId).then(applyLatest),
		[token, conversationId, applyLatest]
	)

	useEffect(() => {
		fetchMessages(token, conversationId).then(applyLatest).catch(() => {})
	}, [token, conversationId, applyLatest])

	// прокрутка вниз: при загрузке, своих сообщениях и новых, если читаем низ чата
	useEffect(() => {
		if (skipScrollRef.current) {
			skipScrollRef.current = false
			return
		}
		const list = listRef.current
		if (list && nearBottomRef.current) list.scrollTop = list.scrollHeight
	}, [messages])

	function handleScroll() {
		const list = listRef.current
		if (!list) return
		nearBottomRef.current =
			list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX
	}

	async function loadOlder() {
		// самое старое сообщение — первое; оптимистичные (Date.now()) добавляются в конец
		const oldest = messages[0]
		if (!oldest || loadingMore) return
		setLoadingMore(true)
		try {
			const older = await fetchMessages(token, conversationId, oldest.id)
			const list = listRef.current
			const prevHeight = list?.scrollHeight ?? 0
			skipScrollRef.current = true // подгрузка истории не должна прокручивать вниз
			setMessages(prev => [...older, ...prev])
			setHasMore(older.length === MESSAGES_PAGE_SIZE)
			// после рендера сохраняем позицию прокрутки, чтобы список не «прыгал»
			requestAnimationFrame(() => {
				if (list) list.scrollTop += list.scrollHeight - prevHeight
			})
		} catch {
			// сеть недоступна — кнопка останется, можно повторить
		} finally {
			setLoadingMore(false)
		}
	}

	useEffect(() => {
		const ws = connectAdminWs(
			token,
			(msg: Message & Record<string, unknown>) => {
				// служебные события: подтверждение отправки, ошибка, «печатает», «прочитано»
				switch (msg.type) {
					case 'sent':
						setMessages(prev =>
							prev.map(m =>
								m.clientId && m.clientId === msg.clientId
									? {
											...m,
											id: msg.id as number,
											createdAt: msg.createdAt as string,
											pending: false
										}
									: m
							)
						)
						return
					case 'error':
						setMessages(prev =>
							prev.map(m =>
								m.clientId && m.clientId === msg.clientId
									? { ...m, pending: false, failed: true }
									: m
							)
						)
						return
					case 'typing':
						if (msg.from === 'visitor' && msg.conversationId === conversationId) {
							setVisitorTyping(true)
							clearTimeout(typingTimerRef.current)
							typingTimerRef.current = setTimeout(
								() => setVisitorTyping(false),
								TYPING_SHOW_MS
							)
						}
						return
					case 'read':
						if (msg.by === 'visitor' && msg.conversationId === conversationId) {
							setReadEventAt(Date.parse(msg.at as string) || 0)
						}
						return
				}
				if (msg.conversationId === conversationId) {
					if (msg.sender === 'visitor') setVisitorTyping(false)
					setMessages(prev => [...prev, msg])
					// открытая беседа: новое сообщение посетителя сразу считаем прочитанным
					if (msg.sender === 'visitor') {
						syncRead()
					}
				}
			},
			// после обрыва могли быть пропущены сообщения — подтягиваем историю заново
			() => {
				loadLatest().catch(() => {})
				syncRead()
			}
		)
		wsRef.current = ws
		return () => {
			clearTimeout(typingTimerRef.current)
			ws.close()
		}
	}, [token, conversationId, loadLatest, syncRead])

	// «печатает» появилось внизу — показываем, если читаем конец беседы
	useEffect(() => {
		const list = listRef.current
		if (visitorTyping && list && nearBottomRef.current) {
			list.scrollTop = list.scrollHeight
		}
	}, [visitorTyping])

	// «Прочитано» — под последним сообщением оператора, которое посетитель уже видел.
	// Сравниваем только серверное время (у неподтверждённых сообщений его ещё нет)
	const lastReadAdminId = useMemo(() => {
		const readAt = Math.max(
			Date.parse(conversation.visitorLastReadAt ?? '') || 0,
			readEventAt
		)
		if (!readAt) return null
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i]!
			if (
				m.sender === 'admin' &&
				!m.pending &&
				!m.failed &&
				Date.parse(m.createdAt) <= readAt
			) {
				return m.id
			}
		}
		return null
	}, [messages, conversation.visitorLastReadAt, readEventAt])

	function sendMessage() {
		const text = input.trim()
		if (!text || !wsRef.current) return
		// нет соединения — не теряем текст и не рисуем «отправленное» сообщение
		const clientId = `${Date.now().toString(36)}-${++sendSeqRef.current}`
		if (!wsRef.current.send(JSON.stringify({ conversationId, text, clientId }))) return
		nearBottomRef.current = true
		setMessages(prev => [
			...prev,
			{
				id: Date.now(),
				sender: 'admin',
				text,
				createdAt: new Date().toISOString(),
				clientId,
				pending: true
			}
		]) // optimistic: id и время заменит подтверждение sent
		setInput('')
		onActivityRef.current?.()
	}

	async function toggleStatus() {
		if (toggling) return
		const next = closed ? 'open' : 'closed'
		setToggling(true)
		try {
			await updateStatus(token, conversationId, next)
			onStatusChange(next)
		} catch {
			// сеть недоступна — статус не меняем
		} finally {
			setToggling(false)
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex items-center gap-2 border-b border-zinc-200 px-2 py-3 dark:border-zinc-800 md:px-4">
				<button
					type="button"
					onClick={onBack}
					aria-label="Назад к списку бесед"
					className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30 md:hidden"
				>
					<ArrowLeft aria-hidden="true" className="h-5 w-5" />
				</button>
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
					<User aria-hidden="true" className="h-5 w-5" />
				</span>
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-base font-semibold leading-tight">
						Беседа #{conversationId}
					</h2>
					<p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
						<span
							aria-hidden="true"
							className={`h-2 w-2 rounded-full ${
								closed ? 'bg-zinc-400' : 'bg-emerald-500'
							}`}
						/>
						{closed ? 'Закрыта' : 'Открыта'}
					</p>
				</div>
				<button
					type="button"
					onClick={toggleStatus}
					disabled={toggling}
					className="flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 bg-transparent px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30"
				>
					{closed ? (
						<RotateCcw aria-hidden="true" className="h-4 w-4" />
					) : (
						<Check aria-hidden="true" className="h-4 w-4" />
					)}
					{closed ? 'Открыть' : 'Закрыть'}
				</button>
			</header>

			<div
				ref={listRef}
				onScroll={handleScroll}
				className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
			>
				{hasMore && (
					<div className="pb-3 text-center">
						<button
							type="button"
							onClick={loadOlder}
							disabled={loadingMore}
							className="h-9 cursor-pointer rounded-lg border border-zinc-300 bg-transparent px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
						>
							{loadingMore ? 'Загрузка…' : 'Загрузить ещё'}
						</button>
					</div>
				)}
				<div className="flex flex-col gap-1.5">
					{messages.map(m => {
						if (m.sender === 'system') {
							return (
								<div
									key={m.id}
									className="my-2 text-center text-xs text-zinc-500 dark:text-zinc-400"
								>
									{m.text}
								</div>
							)
						}
						const mine = m.sender === 'admin'
						return (
							<div
								key={m.id}
								className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
							>
								<div
									className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-base md:max-w-[70%] ${
										m.failed
											? 'rounded-br-md border border-red-500 text-red-600 dark:text-red-400'
											: mine
												? 'rounded-br-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
												: 'rounded-bl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
									}`}
								>
									{m.text}
								</div>
								<span
									className={`mt-0.5 px-1 text-[11px] ${
										m.failed
											? 'text-red-600 dark:text-red-400'
											: 'text-zinc-400 dark:text-zinc-500'
									}`}
								>
									{m.failed
										? 'Не отправлено'
										: `${formatTime(m.createdAt)}${m.id === lastReadAdminId ? ' · Прочитано' : ''}`}
								</span>
							</div>
						)
					})}
					{visitorTyping && (
						<div className="flex items-start">
							<div className="rounded-2xl rounded-bl-md bg-zinc-100 px-4 py-3.5 dark:bg-zinc-800">
								<TypingDots label="Посетитель печатает" />
							</div>
						</div>
					)}
				</div>
			</div>

			{closed && (
				<div className="flex items-center justify-center gap-1.5 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
					<Lock aria-hidden="true" className="h-3.5 w-3.5" />
					Беседа закрыта
				</div>
			)}

			<form
				onSubmit={e => {
					e.preventDefault()
					sendMessage()
				}}
				className="flex items-center gap-2 border-t border-zinc-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-800"
			>
				<input
					value={input}
					onChange={e => {
						setInput(e.target.value)
						// сообщаем посетителю «печатает» (не чаще раза в TYPING_EMIT_MS)
						const now = Date.now()
						if (e.target.value.trim() && now - lastTypingSentRef.current > TYPING_EMIT_MS) {
							lastTypingSentRef.current = now
							wsRef.current?.send(JSON.stringify({ type: 'typing', conversationId }))
						}
					}}
					placeholder="Ответ…"
					aria-label="Сообщение"
					autoComplete="off"
					className="box-border h-11 min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-4 text-base text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20"
				/>
				<button
					type="submit"
					disabled={!input.trim()}
					aria-label="Отправить"
					className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-zinc-950 text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-white/60 dark:focus-visible:ring-offset-zinc-900"
				>
					<Send aria-hidden="true" className="h-5 w-5" />
				</button>
			</form>
		</div>
	)
}
