import { useCallback, useEffect, useRef, useState } from 'react'
import { DICTATION_LANG } from '../lib/config'

// Web Speech API в lib.dom нет — описываем только то, чем пользуемся
type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> }
type SpeechErrorEvent = { error: string }
interface SpeechRecognitionLike {
	lang: string
	continuous: boolean
	interimResults: boolean
	maxAlternatives: number
	onresult: ((e: SpeechResultEvent) => void) | null
	onerror: ((e: SpeechErrorEvent) => void) | null
	onend: (() => void) | null
	start(): void
	stop(): void
	abort(): void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

const Ctor: SpeechRecognitionCtor | undefined =
	typeof window === 'undefined'
		? undefined
		: (window as unknown as Record<string, SpeechRecognitionCtor | undefined>)
				.SpeechRecognition ??
			(window as unknown as Record<string, SpeechRecognitionCtor | undefined>)
				.webkitSpeechRecognition

const ERRORS: Record<string, string> = {
	'not-allowed': 'Нет доступа к микрофону. Разрешите его в настройках браузера.',
	'service-not-allowed': 'Нет доступа к микрофону. Разрешите его в настройках браузера.',
	'audio-capture': 'Микрофон не найден.',
	network: 'Нет связи с сервисом распознавания речи.',
	'no-speech': 'Речь не распознана. Попробуйте ещё раз.',
	'language-not-supported': 'Этот язык не поддерживается браузером.'
}
const NOTICE_KEY = 'admin_dictation_notice'

export type DictationNote = { text: string; error: boolean } | null

// Диктовка: речь → текст в поле ввода (распознаёт браузер). Надиктованное вставляется
// в позицию курсора, текст до и после сохраняется.
export function useDictation({
	inputRef,
	setValue,
	onText
}: {
	inputRef: React.RefObject<HTMLInputElement | null>
	setValue: (value: string) => void
	onText?: (value: string) => void // например, «печатает» собеседнику
}) {
	const [listening, setListening] = useState(false)
	const [note, setNote] = useState<DictationNote>(null)
	const recRef = useRef<SpeechRecognitionLike | null>(null)
	const noteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const onTextRef = useRef(onText)
	useEffect(() => {
		onTextRef.current = onText
	}, [onText])

	const showNote = useCallback((text: string, error = false, ms = 6000) => {
		clearTimeout(noteTimerRef.current)
		setNote({ text, error })
		noteTimerRef.current = setTimeout(() => setNote(null), ms)
	}, [])

	const start = useCallback(() => {
		const input = inputRef.current
		if (!Ctor || recRef.current || !input) return

		// первое использование: честно говорим, куда уходит звук
		let seen = true
		try {
			seen = !!localStorage.getItem(NOTICE_KEY)
			localStorage.setItem(NOTICE_KEY, '1')
		} catch {
			// приватный режим — подсказка просто покажется снова
		}
		if (!seen) {
			showNote('Речь распознаёт ваш браузер: аудио передаётся на серверы Google или Apple.', false, 8000)
		}

		const from = input.selectionStart ?? input.value.length
		const to = input.selectionEnd ?? from
		let prefix = input.value.slice(0, from)
		let suffix = input.value.slice(to)
		if (prefix && !/\s$/.test(prefix)) prefix += ' '
		if (suffix && !/^\s/.test(suffix)) suffix = ' ' + suffix

		const rec = new Ctor()
		rec.lang = DICTATION_LANG
		rec.continuous = true
		rec.interimResults = true
		rec.maxAlternatives = 1
		rec.onresult = e => {
			if (recRef.current !== rec) return
			// текст собираем из всех результатов заново, а не дописываем кусками:
			// так не бывает дублей (известная проблема на части Android-устройств)
			let text = ''
			for (let i = 0; i < e.results.length; i++) text += e.results[i]![0]!.transcript
			const value = prefix + text.replace(/^\s+/, '') + suffix
			setValue(value)
			onTextRef.current?.(value)
		}
		rec.onerror = e => {
			if (recRef.current !== rec || e.error === 'aborted') return
			showNote(ERRORS[e.error] ?? 'Не удалось распознать речь.', true)
		}
		rec.onend = () => {
			if (recRef.current !== rec) return
			recRef.current = null
			setListening(false)
		}
		try {
			recRef.current = rec
			rec.start()
			setListening(true)
		} catch {
			recRef.current = null
			setListening(false)
			showNote('Не удалось включить голосовой ввод.', true)
		}
	}, [inputRef, setValue, showNote])

	// остановить и дождаться последних слов («стоп»)
	const stop = useCallback(() => recRef.current?.stop(), [])

	// прервать сразу, поздние результаты игнорируются (отправка, смена беседы)
	const abort = useCallback(() => {
		const rec = recRef.current
		if (!rec) return
		recRef.current = null
		setListening(false)
		try {
			rec.abort()
		} catch {
			// уже остановлено
		}
	}, [])

	const toggle = useCallback(() => (recRef.current ? stop() : start()), [start, stop])

	useEffect(
		() => () => {
			clearTimeout(noteTimerRef.current)
			const rec = recRef.current
			recRef.current = null
			try {
				rec?.abort()
			} catch {
				// уже остановлено
			}
		},
		[]
	)

	return { supported: !!Ctor, listening, note, toggle, abort }
}
