import {
	ArrowLeft,
	Bot,
	Check,
	Download,
	Lock,
	MessageSquareText,
	Mic,
	MoreVertical,
	Paperclip,
	Reply,
	RotateCcw,
	Send,
	Smile,
	Square,
	Trash2,
	User,
	X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
	deleteConversation,
	exportConversation,
	fetchConversationDeleteEnabled,
	fetchMessages,
	markRead,
	MESSAGES_PAGE_SIZE,
	REACTION_EMOJIS,
	removeMessageReaction,
	setMessageReaction,
	updateAssignee,
	updateStatus,
	uploadAttachment,
	type CannedResponse,
	type Conversation,
	type MessageReaction,
	type Operator,
	type UploadedAttachment
} from '../lib/api'
import { API_URL } from '../lib/config'
import { formatTime } from '../lib/format'
import { connectAdminWs, type AdminWs } from '../lib/ws'
import { InstagramIcon } from '../icons/InstagramIcon'
import { CannedResponsesPanel } from './CannedResponsesPanel'
import { EmojiPicker } from './EmojiPicker'
import { pushRecentEmoji } from './emoji-data'
import { TypingDots } from './TypingDots'
import { useDictation } from './useDictation'

type ReplyTo = { id: number; sender: string; text: string }

type Message = {
	id: number
	replyTo?: ReplyTo | null // цитата сообщения, на которое это — ответ
	conversationId?: number
	sender: string
	text: string
	createdAt: string
	clientId?: string // только для отправленных отсюда сообщений
	pending?: boolean // отправлено, серверное подтверждение (sent) ещё не пришло
	failed?: boolean // сервер отклонил сообщение
	attachmentUrl?: string | null
	attachmentName?: string | null
	reactions?: MessageReaction[]
}

const NEAR_BOTTOM_PX = 150
const TYPING_EMIT_MS = 3000 // не чаще, чем раз в 3 с сообщаем «печатаю»
const TYPING_SHOW_MS = 5000 // «печатает» гаснет, если событий больше нет
const LONG_PRESS_MS = 450 // долгое нажатие на сообщение (телефон) — ответить
const QUOTE_LENGTH = 200
const MAX_SEARCH_PAGES = 10 // сколько страниц истории подгружать в поисках исходного сообщения
const ALLOWED_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
// поле ввода растёт вниз по мере текста (как в Telegram/виджете, см. widget.js),
// не скроллит содержимое вбок — дальше этой высоты появляется внутренний скролл
const MAX_INPUT_HEIGHT = 120

// реакции сообщения, сгруппированные по эмодзи — для рендера пилюль под пузырём
function groupReactions(reactions: MessageReaction[] | undefined, meId: number | null) {
	if (!reactions?.length) return []
	const order: string[] = []
	const counts = new Map<string, number>()
	const mineSet = new Set<string>()
	for (const r of reactions) {
		if (!counts.has(r.emoji)) order.push(r.emoji)
		counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1)
		if (r.adminId === meId) mineSet.add(r.emoji)
	}
	return order.map(emoji => ({
		emoji,
		count: counts.get(emoji)!,
		mine: mineSet.has(emoji)
	}))
}

const authorLabel = (sender: string) =>
	sender === 'admin' ? 'Вы' : sender === 'bot' ? 'Бот' : 'Посетитель'

// Компонент нужно монтировать с key={conversation.id}: состояние привязано к беседе
export function ChatWindow({
	token,
	conversation,
	meId,
	operators,
	cannedResponses,
	onBack,
	onActivity,
	onStatusChange,
	onAssigneeChange,
	onDelete
}: {
	token: string
	conversation: Conversation
	meId: number | null // свой id — чтобы понимать, какая из реакций своя
	operators: Operator[] // для дропдауна «Назначить»
	cannedResponses: CannedResponse[] // для панели шаблонов ответов
	onBack: () => void // на телефоне — вернуться к списку
	onActivity?: () => void // сообщение отправлено или беседа прочитана — обновить список
	onStatusChange: (status: 'open' | 'closed') => void
	onAssigneeChange: (assigneeId: number | null, assigneeEmail: string | null) => void
	onDelete: () => void // беседа удалена — вернуться к списку и обновить его
}) {
	const conversationId = conversation.id
	const closed = conversation.status === 'closed'
	const [messages, setMessages] = useState<Message[]>([])
	const [input, setInput] = useState('')
	const [hasMore, setHasMore] = useState(false)
	const [loadingMore, setLoadingMore] = useState(false)
	const [toggling, setToggling] = useState(false)
	const [assigning, setAssigning] = useState(false)
	const [exporting, setExporting] = useState(false)
	const [deleteEnabled, setDeleteEnabled] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const [visitorTyping, setVisitorTyping] = useState(false)
	const [replyTarget, setReplyTarget] = useState<ReplyTo | null>(null)
	const [emojiOpen, setEmojiOpen] = useState(false)
	const [cannedOpen, setCannedOpen] = useState(false)
	// на телефоне вторичные действия хедера (назначить/скачать/удалить/закрыть)
	// спрятаны за одной кнопкой «⋮», как в Telegram — на десктопе не используется
	const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
	// эмодзи/прикрепить/шаблоны — за одной кнопкой «⋮» в композере, как в Telegram
	const [composerMenuOpen, setComposerMenuOpen] = useState(false)
	// id сообщения, у которого сейчас открыт пикер реакций (❤️ 👍 🔥 🙏), и
	// координаты кнопки-триггера — пикер рендерится порталом в body (см. ниже),
	// иначе его обрезает overflow-y-auto списка сообщений, если открыть рядом
	// с сообщением у самого верха/низа видимой области
	const [reactionPickerFor, setReactionPickerFor] = useState<number | null>(null)
	const [reactionPickerRect, setReactionPickerRect] = useState<DOMRect | null>(null)
	const [pendingAttachment, setPendingAttachment] = useState<UploadedAttachment | null>(null)
	const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null)
	const [uploadingAttachment, setUploadingAttachment] = useState(false)
	const [attachmentError, setAttachmentError] = useState<string | null>(null)
	const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [flashId, setFlashId] = useState<number | null>(null)
	const flashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const pressRef = useRef<{ timer?: ReturnType<typeof setTimeout>; x: number; y: number }>({
		x: 0,
		y: 0
	})
	const inputRef = useRef<HTMLTextAreaElement | null>(null)
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

	useEffect(() => {
		fetchConversationDeleteEnabled(token)
			.then(setDeleteEnabled)
			.catch(() => setDeleteEnabled(false))
	}, [token])

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

	// Программная вставка текста в input требует обхода React дважды: обычное
	// `el.value = ...` (и el.setRangeText — тоже под капотом присваивание) идёт через
	// сеттер, который React переопределяет НА САМОМ УЗЛЕ, чтобы отслеживать value
	// (внутренний _valueTracker). Если задать значение через ОРИГИНАЛЬНЫЙ сеттер из
	// прототипа (в обход переопределения на узле), трекер не узнает об изменении —
	// а раз не узнает, то и последующий React-рендер не считает нужным подтверждать
	// новое value, и при следующем ререндере controlled input откатится к старому
	// значению. Поэтому после подмены value нужно ещё явно продиспатчить 'input':
	// на это событие у React есть отдельная проверка «tracker vs node.value»,
	// которая обновляет трекер и сама вызывает наш onChange — ровно так, как если
	// бы текст напечатал пользователь.
	function insertAtCursor(el: HTMLTextAreaElement, text: string) {
		const start = el.selectionStart ?? el.value.length
		const end = el.selectionEnd ?? el.value.length
		const value = el.value.slice(0, start) + text + el.value.slice(end)
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
		if (setter) setter.call(el, value)
		else el.value = value
		const pos = start + text.length
		el.setSelectionRange(pos, pos)
		el.dispatchEvent(new Event('input', { bubbles: true }))
	}

	// вставка эмодзи в позицию курсора (выделение сохраняется, даже если поле потеряло фокус)
	function insertEmoji(emoji: string) {
		const el = inputRef.current
		if (!el) return
		insertAtCursor(el, emoji) // onChange (см. insertAtCursor) сам вызовет setInput
		pushRecentEmoji(emoji)
		// на телефоне не поднимаем клавиатуру заново
		if (window.matchMedia('(hover: hover)').matches) el.focus()
	}

	// вставка шаблона ответа — в позицию курсора, как эмодзи; не отправляет само
	function insertCanned(text: string) {
		const el = inputRef.current
		if (!el) {
			setInput(prev => prev + text)
			return
		}
		insertAtCursor(el, text)
		setCannedOpen(false)
		if (window.matchMedia('(hover: hover)').matches) el.focus()
	}

	// сообщаем посетителю «печатает» (не чаще раза в TYPING_EMIT_MS)
	// растёт вниз вместе с текстом вместо горизонтального скролла; срабатывает
	// и на обычный ввод, и на вставку эмодзи/шаблона/диктовку (все идут через
	// setInput), и на очистку после отправки — везде, где меняется input
	useEffect(() => {
		const el = inputRef.current
		if (!el) return
		el.style.height = 'auto'
		el.style.height = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT) + 'px'
	}, [input])

	function notifyTyping(value: string) {
		const now = Date.now()
		if (value.trim() && now - lastTypingSentRef.current > TYPING_EMIT_MS) {
			lastTypingSentRef.current = now
			wsRef.current?.send(JSON.stringify({ type: 'typing', conversationId }))
		}
	}

	const dictation = useDictation({
		inputRef,
		setValue: setInput,
		onText: notifyTyping
	})

	function startReply(m: Message) {
		if (m.pending || m.failed || m.sender === 'system') return // у сообщения нет серверного id
		setReplyTarget({ id: m.id, sender: m.sender, text: m.text.slice(0, QUOTE_LENGTH) })
		inputRef.current?.focus()
	}

	// один оператор — одна реакция на сообщение (как на бэкенде): повторный тап
	// тем же эмодзи снимает реакцию, другим — заменяет. Оптимистично обновляем
	// сразу, настоящее состояние придёт следом по WS всем открытым вкладкам
	// (включая эту же — обновление просто совпадёт)
	async function toggleReaction(m: Message, emoji: string) {
		if (meId == null || m.pending || m.failed) return
		setReactionPickerFor(null)
		const mine = m.reactions?.find(r => r.adminId === meId)
		const removing = mine?.emoji === emoji
		setMessages(prev =>
			prev.map(x => {
				if (x.id !== m.id) return x
				const rest = (x.reactions ?? []).filter(r => r.adminId !== meId)
				return {
					...x,
					reactions: removing ? rest : [...rest, { emoji, adminId: meId, adminEmail: '' }]
				}
			})
		)
		try {
			if (removing) await removeMessageReaction(token, m.id)
			else await setMessageReaction(token, m.id, emoji)
		} catch {
			// сервер поправит по WS-событию при следующем изменении; специально
			// не откатываем оптимистичное обновление — редкий сбой сети не стоит
			// того, чтобы реакция на экране «моргала» обратно
		}
	}

	// долгое нажатие на сообщение (сенсорный экран) — ответить
	function pressStart(e: React.PointerEvent, m: Message) {
		if (e.pointerType !== 'touch') return
		pressRef.current = {
			x: e.clientX,
			y: e.clientY,
			timer: setTimeout(() => {
				startReply(m)
				navigator.vibrate?.(15)
			}, LONG_PRESS_MS)
		}
	}
	function pressCancel() {
		clearTimeout(pressRef.current.timer)
	}
	function pressMove(e: React.PointerEvent) {
		const { x, y } = pressRef.current
		if (Math.abs(e.clientX - x) > 8 || Math.abs(e.clientY - y) > 8) pressCancel()
	}

	// прокрутка к исходному сообщению; если оно в ещё не загруженной истории — подгружаем
	async function scrollToMessage(id: number) {
		const find = () => listRef.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`)
		let el = find()
		let before = messages[0]?.id
		let more = hasMore
		for (let i = 0; !el && more && before && i < MAX_SEARCH_PAGES; i++) {
			try {
				const older = await fetchMessages(token, conversationId, before)
				skipScrollRef.current = true
				flushSync(() => {
					setMessages(prev => [...older, ...prev])
					setHasMore(older.length === MESSAGES_PAGE_SIZE)
				})
				more = older.length === MESSAGES_PAGE_SIZE
				before = older[0]?.id
			} catch {
				return // сеть недоступна
			}
			el = find()
		}
		if (!el) return // исходного сообщения нет (слишком давно или удалено)
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
		el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
		setFlashId(id)
		clearTimeout(flashTimerRef.current)
		flashTimerRef.current = setTimeout(() => setFlashId(null), 1400)
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
					case 'reaction':
						if (msg.conversationId === conversationId) {
							const messageId = msg.messageId as number
							const reactions = msg.reactions as MessageReaction[]
							setMessages(prev =>
								prev.map(m => (m.id === messageId ? { ...m, reactions } : m))
							)
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
			clearTimeout(flashTimerRef.current)
			clearTimeout(pressRef.current.timer)
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

	function clearAttachment() {
		setPendingAttachment(null)
		setUploadingAttachment(false)
		setAttachmentPreviewUrl(prev => {
			if (prev) URL.revokeObjectURL(prev)
			return null
		})
		if (fileInputRef.current) fileInputRef.current.value = ''
	}

	async function handleFileSelect(file: File | undefined) {
		if (!file) return
		setAttachmentError(null)
		if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
			setAttachmentError('Поддерживаются только картинки: JPEG, PNG, WEBP, AVIF.')
			if (fileInputRef.current) fileInputRef.current.value = ''
			return
		}
		if (file.size > MAX_ATTACHMENT_SIZE) {
			setAttachmentError('Файл слишком большой — максимум 10MB.')
			if (fileInputRef.current) fileInputRef.current.value = ''
			return
		}

		setAttachmentPreviewUrl(URL.createObjectURL(file))
		setUploadingAttachment(true)
		try {
			const uploaded = await uploadAttachment(token, file)
			setPendingAttachment(uploaded)
		} catch (e) {
			setAttachmentError(e instanceof Error ? e.message : 'Не удалось загрузить файл')
			clearAttachment()
		} finally {
			setUploadingAttachment(false)
		}
	}

	function sendMessage() {
		const text = input.trim()
		if ((!text && !pendingAttachment) || !wsRef.current || uploadingAttachment) return
		// нет соединения — не теряем текст и не рисуем «отправленное» сообщение
		const clientId = `${Date.now().toString(36)}-${++sendSeqRef.current}`
		dictation.abort()
		const replyToId = replyTarget?.id
		const attachment = pendingAttachment
		if (
			!wsRef.current.send(
				JSON.stringify({
					conversationId,
					text,
					clientId,
					...(replyToId ? { replyToId } : {}),
					...(attachment
						? {
								attachmentUrl: attachment.url,
								attachmentType: attachment.type,
								attachmentName: attachment.name,
								attachmentSize: attachment.size
							}
						: {})
				})
			)
		)
			return
		nearBottomRef.current = true
		setMessages(prev => [
			...prev,
			{
				id: Date.now(),
				sender: 'admin',
				text,
				createdAt: new Date().toISOString(),
				clientId,
				pending: true,
				replyTo: replyTarget,
				attachmentUrl: attachment?.url,
				attachmentName: attachment?.name
			}
		]) // optimistic: id и время заменит подтверждение sent
		setReplyTarget(null)
		setInput('')
		clearAttachment()
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

	async function handleExport() {
		if (exporting) return
		setExporting(true)
		try {
			const { blob, filename } = await exportConversation(token, conversationId)
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = filename
			document.body.appendChild(a)
			a.click()
			a.remove()
			URL.revokeObjectURL(url)
		} catch {
			// сеть недоступна — молча ничего не скачиваем
		} finally {
			setExporting(false)
		}
	}

	async function handleDelete() {
		if (deleting) return
		if (!confirm(`Удалить беседу #${conversationId}? Это необратимо.`)) return
		setDeleting(true)
		try {
			await deleteConversation(token, conversationId)
			onDelete()
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Не удалось удалить беседу')
			setDeleting(false)
		}
	}

	async function handleAssign(value: string) {
		if (assigning) return
		const assigneeId = value ? Number(value) : null
		setAssigning(true)
		try {
			const updated = await updateAssignee(token, conversationId, assigneeId)
			onAssigneeChange(updated.assigneeId, updated.assigneeEmail)
			onActivityRef.current?.()
		} catch {
			// сеть недоступна — назначение не меняем
		} finally {
			setAssigning(false)
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-2 py-3 dark:border-zinc-800 md:px-4">
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
					<h2 className="flex items-center gap-1.5 truncate text-base font-semibold leading-tight">
						<span className="truncate">Беседа #{conversationId}</span>
						{conversation.channel === 'telegram' && (
							<Send
								aria-label="Telegram"
								className="h-3.5 w-3.5 shrink-0 text-sky-500"
							/>
						)}
						{conversation.channel === 'instagram' && (
							<InstagramIcon
								aria-label="Instagram"
								className="h-3.5 w-3.5 shrink-0 text-pink-500"
							/>
						)}
					</h2>
					<p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
						<span
							aria-hidden="true"
							className={`h-2 w-2 rounded-full ${
								closed ? 'bg-zinc-400' : 'bg-emerald-500'
							}`}
						/>
						{closed ? 'Закрыта' : 'Открыта'}
						{conversation.channel === 'telegram' && ' · Telegram'}
						{conversation.channel === 'instagram' && ' · Instagram'}
					</p>
				</div>
				{/* ПК — как и было, все действия видны сразу в хедере */}
				<div className="hidden shrink-0 items-center gap-2 md:flex">
					<select
						value={conversation.assigneeId ?? ''}
						onChange={e => handleAssign(e.target.value)}
						disabled={assigning}
						aria-label="Назначить оператора"
						title="Назначить оператора"
						className="h-10 shrink-0 cursor-pointer rounded-lg border border-zinc-300 bg-transparent px-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30"
					>
						<option value="">Не назначено</option>
						{operators.map(o => (
							<option key={o.id} value={o.id}>
								{o.email}
							</option>
						))}
					</select>
					<button
						type="button"
						onClick={handleExport}
						disabled={exporting}
						aria-label="Скачать историю переписки"
						title="Скачать историю переписки"
						className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 bg-transparent text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30"
					>
						<Download aria-hidden="true" className="h-4 w-4" />
					</button>
					{deleteEnabled && (
						<button
							type="button"
							onClick={handleDelete}
							disabled={deleting}
							aria-label="Удалить беседу"
							title="Удалить беседу"
							className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 bg-transparent text-zinc-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
						>
							<Trash2 aria-hidden="true" className="h-4 w-4" />
						</button>
					)}
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
				</div>
				{/* телефон — те же действия за одной кнопкой «⋮», как в Telegram:
				    в хедере остаётся только имя/статус беседы, без тесноты */}
				<div className="relative shrink-0 md:hidden">
					<button
						type="button"
						onClick={() => setHeaderMenuOpen(v => !v)}
						aria-label="Действия с беседой"
						aria-expanded={headerMenuOpen}
						className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30 ${
							headerMenuOpen ? 'bg-zinc-100 dark:bg-zinc-800' : 'bg-transparent'
						}`}
					>
						<MoreVertical aria-hidden="true" className="h-5 w-5" />
					</button>
					{headerMenuOpen && (
						<>
							<div
								className="fixed inset-0 z-40"
								onClick={() => setHeaderMenuOpen(false)}
							/>
							<div className="absolute right-0 top-12 z-50 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
								<label className="block px-1 pb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
									Назначить оператора
								</label>
								<select
									value={conversation.assigneeId ?? ''}
									onChange={e => {
										handleAssign(e.target.value)
										setHeaderMenuOpen(false)
									}}
									disabled={assigning}
									className="mb-1 h-10 w-full cursor-pointer rounded-lg border border-zinc-300 bg-transparent px-2 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
								>
									<option value="">Не назначено</option>
									{operators.map(o => (
										<option key={o.id} value={o.id}>
											{o.email}
										</option>
									))}
								</select>
								<button
									type="button"
									onClick={() => {
										handleExport()
										setHeaderMenuOpen(false)
									}}
									disabled={exporting}
									className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800"
								>
									<Download aria-hidden="true" className="h-4 w-4" />
									Скачать историю
								</button>
								<button
									type="button"
									onClick={() => {
										toggleStatus()
										setHeaderMenuOpen(false)
									}}
									disabled={toggling}
									className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800"
								>
									{closed ? (
										<RotateCcw aria-hidden="true" className="h-4 w-4" />
									) : (
										<Check aria-hidden="true" className="h-4 w-4" />
									)}
									{closed ? 'Открыть беседу' : 'Закрыть беседу'}
								</button>
								{deleteEnabled && (
									<button
										type="button"
										onClick={() => {
											handleDelete()
											setHeaderMenuOpen(false)
										}}
										disabled={deleting}
										className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-500/10"
									>
										<Trash2 aria-hidden="true" className="h-4 w-4" />
										Удалить беседу
									</button>
								)}
							</div>
						</>
					)}
				</div>
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
								data-mid={m.id}
								className={`group flex flex-col ${mine ? 'items-end' : 'items-start'}`}
							>
								<div
									className={`flex max-w-[85%] items-center gap-1 md:max-w-[70%] ${
										mine ? 'flex-row-reverse' : ''
									}`}
								>
									<div
										onPointerDown={e => pressStart(e, m)}
										onPointerMove={pressMove}
										onPointerUp={pressCancel}
										onPointerCancel={pressCancel}
										onPointerLeave={pressCancel}
										className={`min-w-0 whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-base transition-shadow [@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none] ${
											flashId === m.id ? 'ring-2 ring-zinc-900 dark:ring-white' : ''
										} ${
											m.failed
												? 'rounded-br-md border border-red-500 text-red-600 dark:text-red-400'
												: mine
													? 'rounded-br-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
													: 'rounded-bl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
										}`}
									>
										{m.replyTo && (
											<button
												type="button"
												onClick={() => scrollToMessage(m.replyTo!.id)}
												onPointerDown={e => e.stopPropagation()}
												aria-label="Перейти к исходному сообщению"
												className="mb-1.5 block w-full cursor-pointer rounded-md border-0 border-l-[3px] border-solid border-current bg-black/10 px-2 py-1 text-left text-[13px] leading-snug text-inherit dark:bg-white/10"
											>
												<span className="block font-semibold opacity-85">
													{authorLabel(m.replyTo.sender)}
												</span>
												<span className="line-clamp-2 block break-words opacity-85">
													{m.replyTo.text}
												</span>
											</button>
										)}
										{m.attachmentUrl && (
											<img
												src={`${API_URL}${m.attachmentUrl}`}
												alt={m.attachmentName ?? ''}
												loading="lazy"
												onClick={() => setLightboxUrl(`${API_URL}${m.attachmentUrl}`)}
												className={`block max-h-56 max-w-56 cursor-zoom-in rounded-xl object-cover ${m.text ? 'mb-1.5' : ''}`}
											/>
										)}
										{m.text}
									</div>
									{!m.pending && !m.failed && (
										<button
											type="button"
											onClick={() => startReply(m)}
											aria-label="Ответить на сообщение"
											title="Ответить"
											className="hidden h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-900 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 group-hover:opacity-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-300/30 [@media(hover:hover)]:flex"
										>
											<Reply aria-hidden="true" className="h-4 w-4" />
										</button>
									)}
									{!m.pending && !m.failed && meId != null && (
										<button
											type="button"
											onClick={e => {
												if (reactionPickerFor === m.id) {
													setReactionPickerFor(null)
													return
												}
												setReactionPickerRect(e.currentTarget.getBoundingClientRect())
												setReactionPickerFor(m.id)
											}}
											aria-label="Поставить реакцию"
											title="Реакция"
											className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-zinc-500 opacity-70 transition-opacity hover:bg-zinc-100 hover:text-zinc-900 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-300/30"
										>
											<Smile aria-hidden="true" className="h-4 w-4" />
										</button>
									)}
								</div>
								{groupReactions(m.reactions, meId).length > 0 && (
									<div
										className={`mt-0.5 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}
									>
										{groupReactions(m.reactions, meId).map(r => (
											<button
												key={r.emoji}
												type="button"
												onClick={() => toggleReaction(m, r.emoji)}
												className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-none ${
													r.mine
														? 'border-zinc-900 bg-zinc-900/5 dark:border-zinc-100 dark:bg-zinc-100/10'
														: 'border-zinc-200 bg-transparent dark:border-zinc-700'
												}`}
											>
												<span>{r.emoji}</span>
												{r.count > 1 && (
													<span className="text-zinc-500 dark:text-zinc-400">
														{r.count}
													</span>
												)}
											</button>
										))}
									</div>
								)}
								<span
									className={`mt-0.5 flex items-center gap-1 px-1 text-[11px] ${
										m.failed
											? 'text-red-600 dark:text-red-400'
											: 'text-zinc-400 dark:text-zinc-500'
									}`}
								>
									{m.sender === 'bot' && (
										<Bot aria-label="Автоответ бота" className="h-3 w-3 shrink-0" />
									)}
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

			{dictation.note && (
				<div
					role="status"
					className={`border-t border-zinc-200 bg-zinc-50 px-4 py-1.5 text-center text-xs dark:border-zinc-800 dark:bg-zinc-800/50 ${
						dictation.note.error
							? 'text-red-600 dark:text-red-400'
							: 'text-zinc-500 dark:text-zinc-400'
					}`}
				>
					{dictation.note.text}
				</div>
			)}

			{replyTarget && (
				<div className="flex items-center gap-2 border-t border-zinc-200 bg-zinc-50 py-2 pl-4 pr-2 dark:border-zinc-800 dark:bg-zinc-800/50">
					<div className="min-w-0 flex-1 border-l-[3px] border-zinc-900 pl-2 dark:border-zinc-100">
						<div className="text-xs font-semibold">{authorLabel(replyTarget.sender)}</div>
						<div className="truncate text-[13px] text-zinc-500 dark:text-zinc-400">
							{replyTarget.text}
						</div>
					</div>
					<button
						type="button"
						onClick={() => {
							setReplyTarget(null)
							inputRef.current?.focus()
						}}
						aria-label="Отменить ответ"
						className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-zinc-500 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30"
					>
						<X aria-hidden="true" className="h-4 w-4" />
					</button>
				</div>
			)}

			{attachmentError && (
				<div
					role="status"
					className="border-t border-zinc-200 bg-zinc-50 px-4 py-1.5 text-center text-xs text-red-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-red-400"
				>
					{attachmentError}
				</div>
			)}
			{attachmentPreviewUrl && (
				<div className="flex items-center gap-2 border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
					<div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
						<img
							src={attachmentPreviewUrl}
							alt=""
							className={`h-full w-full object-cover ${uploadingAttachment ? 'opacity-40' : ''}`}
						/>
						{uploadingAttachment && (
							<span className="absolute inset-0 flex items-center justify-center">
								<span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-600 dark:border-t-zinc-200" />
							</span>
						)}
					</div>
					<button
						type="button"
						onClick={clearAttachment}
						aria-label="Убрать файл"
						className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-zinc-500 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30"
					>
						<X aria-hidden="true" className="h-4 w-4" />
					</button>
				</div>
			)}

			<form
				onSubmit={e => {
					e.preventDefault()
					sendMessage()
				}}
				className="flex items-end gap-2 border-t border-zinc-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-800"
			>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/jpeg,image/png,image/webp,image/avif"
					hidden
					onChange={e => handleFileSelect(e.target.files?.[0])}
				/>
				<div className="relative shrink-0">
					<button
						type="button"
						onClick={() => setComposerMenuOpen(o => !o)}
						aria-label="Ещё"
						aria-expanded={composerMenuOpen}
						className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-300/30 ${
							composerMenuOpen || emojiOpen || cannedOpen
								? 'bg-zinc-100 dark:bg-zinc-800'
								: 'bg-transparent'
						}`}
					>
						<MoreVertical aria-hidden="true" className="h-5 w-5" />
					</button>
					{composerMenuOpen && (
						<>
							<div
								className="fixed inset-0 z-40"
								onClick={() => setComposerMenuOpen(false)}
							/>
							<div className="absolute bottom-full left-0 z-50 mb-2 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
								<button
									type="button"
									onClick={() => {
										setEmojiOpen(o => !o)
										setCannedOpen(false)
										setComposerMenuOpen(false)
									}}
									aria-expanded={emojiOpen}
									aria-controls="emoji-panel"
									className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
								>
									<Smile aria-hidden="true" className="h-4 w-4" />
									Эмодзи
								</button>
								<button
									type="button"
									onClick={() => {
										fileInputRef.current?.click()
										setComposerMenuOpen(false)
									}}
									className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
								>
									<Paperclip aria-hidden="true" className="h-4 w-4" />
									Прикрепить изображение
								</button>
								<button
									type="button"
									onClick={() => {
										setCannedOpen(o => !o)
										setEmojiOpen(false)
										setComposerMenuOpen(false)
									}}
									aria-expanded={cannedOpen}
									aria-controls="canned-panel"
									className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
								>
									<MessageSquareText aria-hidden="true" className="h-4 w-4" />
									Шаблоны ответов
								</button>
							</div>
						</>
					)}
				</div>
				<textarea
					ref={inputRef}
					value={input}
					rows={1}
					onKeyDown={e => {
						if (e.key === 'Escape') {
							if (emojiOpen) setEmojiOpen(false)
							else if (cannedOpen) setCannedOpen(false)
							else if (replyTarget) setReplyTarget(null)
							return
						}
						// Enter — отправить, Shift+Enter — новая строка; не мешаем IME-вводу
						// (тот же приём, что в виджете, см. widget.js)
						if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault()
							sendMessage()
						}
					}}
					onChange={e => {
						setInput(e.target.value)
						notifyTyping(e.target.value)
					}}
					onPaste={e => {
						// скриншот/картинка из буфера обмена (Ctrl+V) — тот же путь, что
						// и выбор файла через меню «⋮»; если в буфере не картинка, просто
						// даём браузеру вставить текст как обычно
						const file = Array.from(e.clipboardData.items)
							.find(item => item.type.startsWith('image/'))
							?.getAsFile()
						if (!file) return
						e.preventDefault()
						handleFileSelect(file)
					}}
					placeholder={dictation.listening ? 'Говорите…' : 'Ответ…'}
					aria-label="Сообщение"
					className="box-border max-h-[120px] min-h-[44px] min-w-0 flex-1 resize-none overflow-y-auto rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-base leading-6 text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20"
				/>
				{dictation.supported && (
					<button
						type="button"
						onClick={dictation.toggle}
						aria-label={dictation.listening ? 'Остановить диктовку' : 'Надиктовать сообщение'}
						aria-pressed={dictation.listening}
						title="Голосовой ввод: речь распознаёт ваш браузер"
						className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-300/30 ${
							dictation.listening
								? 'bg-red-500 text-white motion-safe:animate-pulse'
								: 'bg-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
						}`}
					>
						{dictation.listening ? (
							<Square aria-hidden="true" className="h-4 w-4 fill-current" />
						) : (
							<Mic aria-hidden="true" className="h-5 w-5" />
						)}
					</button>
				)}
				<button
					type="submit"
					disabled={(!input.trim() && !pendingAttachment) || uploadingAttachment}
					aria-label="Отправить"
					className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-zinc-950 text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-white/60 dark:focus-visible:ring-offset-zinc-900"
				>
					<Send aria-hidden="true" className="h-5 w-5" />
				</button>
			</form>
			{emojiOpen && <EmojiPicker onPick={insertEmoji} />}
			{cannedOpen && (
				<CannedResponsesPanel items={cannedResponses} onPick={insertCanned} />
			)}
			{reactionPickerFor !== null &&
				reactionPickerRect &&
				createPortal(
					<>
						<div
							className="fixed inset-0 z-40"
							onClick={() => setReactionPickerFor(null)}
						/>
						<div
							className="fixed z-50 flex gap-0.5 rounded-full border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
							style={{
								bottom: window.innerHeight - reactionPickerRect.top + 4,
								left: Math.min(
									Math.max(8, reactionPickerRect.left - 60),
									window.innerWidth - 180
								)
							}}
						>
							{REACTION_EMOJIS.map(emoji => (
								<button
									key={emoji}
									type="button"
									onClick={() => {
										const m = messages.find(x => x.id === reactionPickerFor)
										if (m) toggleReaction(m, emoji)
									}}
									aria-label={emoji}
									className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
								>
									{emoji}
								</button>
							))}
						</div>
					</>,
					document.body
				)}
			{lightboxUrl && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
					onClick={() => setLightboxUrl(null)}
				>
					<img src={lightboxUrl} alt="" className="max-h-full max-w-full rounded-lg" />
					<button
						type="button"
						onClick={() => setLightboxUrl(null)}
						aria-label="Закрыть"
						className="absolute right-4 top-4 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white hover:bg-white/20"
					>
						<X aria-hidden="true" className="h-5 w-5" />
					</button>
				</div>
			)}
		</div>
	)
}
